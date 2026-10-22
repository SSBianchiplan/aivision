"""Detecção de anomalias PatchCore (Roth et al., 2022), implementação própria em PyTorch — sem anomalib.

Por que própria: o anomalib (Apache-2.0) traz Lightning, OpenVINO e dezenas de dependências para usar ~150
linhas de algoritmo, e o export dele não junta a busca no banco de memória ao grafo. Aqui tudo vira UM ONNX.

Como funciona:
  1. Backbone ResNet-18 (torchvision, BSD-3-Clause; pesos ImageNet) congelado. Features das camadas 2 (stride 8)
     e 3 (stride 16), cada uma com média local 3×3 (contexto do vizinho), camada 3 ampliada para a grade da 2,
     concatenadas → 384 dimensões por "patch" (com 256 px: grade 32×32 = 1.024 patches por imagem).
  2. Banco de memória: patches de TODAS as fotos boas de treino, reduzido por coreset guloso (k-center
     greedy, numa projeção aleatória de 128 dimensões para ficar rápido) até `banco` vetores.
  3. Nota de cada patch = distância ao vizinho mais próximo do banco, calculada no grafo como
     ||a||² + ||b||² − 2ab e min (operações exportáveis). Mapa: grade → S×S (bilinear) + suavização gaussiana
     (σ = 4). Nota da imagem = máximo do mapa.
  4. Limiar automático: com fotos ruins, o ponto que melhor separa boas de ruins (acurácia balanceada);
     sem ruins, a maior nota das boas de validação + margem.
ONNX: entrada "imagem" [1,3,S,S] normalizada ImageNet; saídas "mapa" [1,1,S,S] e "nota" [1].
"""
import json
import math
import os
import random
import time

import numpy as np
from PIL import Image

from comum import DATA, LICENCAS

MEDIA = [0.485, 0.456, 0.406]
DESVIO = [0.229, 0.224, 0.225]


def grupos(P):
    g = {}
    try:
        g = json.load(open(os.path.join(P, "grupos.json"), encoding="utf-8"))
    except (OSError, ValueError):
        pass
    nomes = sorted(os.listdir(os.path.join(P, "imagens")))
    return [n for n in nomes if g.get(n, "boa") == "boa"], [n for n in nomes if g.get(n) == "ruim"]


def carregar(caminho, S):
    im = Image.open(caminho).convert("RGB").resize((S, S), Image.BILINEAR)
    x = np.asarray(im, dtype=np.float32) / 255.0
    return ((x - MEDIA) / DESVIO).transpose(2, 0, 1).astype(np.float32)


def construir(torch, nn, F):
    class Extrator(nn.Module):
        def __init__(self, rede):
            super().__init__()
            self.stem = nn.Sequential(rede.conv1, rede.bn1, rede.relu, rede.maxpool, rede.layer1)
            self.l2, self.l3 = rede.layer2, rede.layer3

        def forward(self, x):
            f2 = self.l2(self.stem(x))
            f3 = self.l3(f2)
            f2 = F.avg_pool2d(f2, 3, 1, 1)
            f3 = F.avg_pool2d(f3, 3, 1, 1)
            f3 = F.interpolate(f3, size=f2.shape[-2:], mode="bilinear", align_corners=False)
            return torch.cat([f2, f3], 1)                     # [B, 384, S/8, S/8]

    class PatchCore(nn.Module):
        def __init__(self, extrator, banco, S, sigma=4.0):
            super().__init__()
            self.ext = extrator
            self.register_buffer("banco_t", banco.t().contiguous())            # [D, K]
            self.register_buffer("banco_n2", (banco * banco).sum(1)[None])    # [1, K]
            r = int(math.ceil(3 * sigma))
            k = torch.arange(-r, r + 1, dtype=torch.float32)
            k = torch.exp(-(k ** 2) / (2 * sigma * sigma))
            k = k / k.sum()
            self.register_buffer("gx", k.view(1, 1, 1, -1))
            self.register_buffer("gy", k.view(1, 1, -1, 1))
            self.r, self.S = r, S

        def forward(self, x):
            f = self.ext(x)
            _, D, h, w = f.shape
            a = f.reshape(D, h * w).t()                                     # [P, D]
            d2 = (a * a).sum(1, keepdim=True) + self.banco_n2 - 2.0 * (a @ self.banco_t)
            dist = torch.sqrt(torch.clamp(d2.min(1).values, min=0.0))      # [P]
            m = dist.reshape(1, 1, h, w)
            m = F.interpolate(m, size=(self.S, self.S), mode="bilinear", align_corners=False)
            m = F.conv2d(F.pad(m, (self.r, self.r, 0, 0), mode="replicate"), self.gx)
            m = F.conv2d(F.pad(m, (0, 0, self.r, self.r), mode="replicate"), self.gy)
            return m, m.amax(dim=(1, 2, 3))

    return Extrator, PatchCore


def coreset(torch, X, K, st, semente=0):
    """k-center guloso: escolhe K vetores que cobrem o conjunto (cada novo = o mais distante dos já escolhidos)."""
    N = X.shape[0]
    if K >= N:
        return torch.arange(N)
    g = torch.Generator().manual_seed(semente)
    proj = torch.randn(X.shape[1], 128, generator=g) / math.sqrt(128)
    Z = X @ proj
    escolhidos = torch.empty(K, dtype=torch.long)
    i = int(torch.randint(N, (1,), generator=g))
    mind = torch.full((N,), float("inf"))
    ult = time.time()
    for k in range(K):
        escolhidos[k] = i
        d = ((Z - Z[i]) ** 2).sum(1)
        mind = torch.minimum(mind, d)
        i = int(torch.argmax(mind))
        if time.time() - ult > 5:
            ult = time.time()
            st(etapa=f"Coreset: {k + 1}/{K} vetores escolhidos", progresso=round(0.45 + 0.35 * (k + 1) / K, 3))
    return escolhidos


def auroc(boas, ruins):
    if not boas or not ruins:
        return None
    gan = sum((r > b) + 0.5 * (r == b) for r in ruins for b in boas)
    return gan / (len(boas) * len(ruins))


def calibrar(boas, ruins, margem):
    """Devolve (limiar, como). Com ruins: maximiza a acurácia balanceada; empate → meio do intervalo."""
    if ruins:
        cand = sorted(set(boas + ruins))
        melhor, lim = -1, None
        for i in range(len(cand)):
            t = (cand[i] + cand[i + 1]) / 2 if i + 1 < len(cand) else cand[i] * 1.001
            acc = (sum(b < t for b in boas) / len(boas) + sum(r >= t for r in ruins) / len(ruins)) / 2
            if acc > melhor + 1e-9:
                melhor, lim = acc, t
        # se separou 100%, centraliza o limiar no vão entre a maior boa e a menor ruim
        if max(boas) < min(ruins):
            lim = (max(boas) + min(ruins)) / 2
        return float(lim), "acurácia balanceada (boas × ruins de validação)"
    return float(max(boas) * (1 + margem)), f"maior nota das boas de validação + {round(margem * 100)}%"


def rodar(c):
    cfg, st, P = c.cfg, c.st, c.P
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torchvision.models import ResNet18_Weights, resnet18

    torch.set_num_threads(3)
    S = int(cfg.get("imgsz", 256))
    boas, ruins = grupos(P)
    rnd = random.Random(42)
    rnd.shuffle(boas)
    nval = max(2, int(round(len(boas) * float(cfg.get("val", 0.2)))))
    val_b, trn = boas[:nval], boas[nval:]
    if len(trn) < 3:
        raise RuntimeError("Poucas fotos boas: envie pelo menos 8 (o ideal é 30 a 200).")
    print(f"Fotos: {len(trn)} boas para o banco, {len(val_b)} boas e {len(ruins)} ruins para calibrar.", flush=True)
    st(estado="extraindo", imagens_treino=len(trn), imagens_val=len(val_b) + len(ruins), etapa="Lendo features",
       progresso=0.02)

    os.environ.setdefault("TORCH_HOME", os.path.join(DATA, "pesos", "torch"))
    Extrator, PatchCore = construir(torch, nn, F)
    ext = Extrator(resnet18(weights=ResNet18_Weights.IMAGENET1K_V1)).eval()
    t0 = time.time()
    feats = []
    with torch.no_grad():
        for i in range(0, len(trn), 8):
            x = torch.from_numpy(np.stack([carregar(os.path.join(P, "imagens", n), S) for n in trn[i:i + 8]]))
            f = ext(x)
            feats.append(f.permute(0, 2, 3, 1).reshape(-1, f.shape[1]))
            st(etapa=f"Features: {min(i + 8, len(trn))}/{len(trn)} fotos", progresso=round(0.05 + 0.4 * min(i + 8, len(trn)) / len(trn), 3))
    X = torch.cat(feats)
    del feats
    lim_patches = 400_000
    if X.shape[0] > lim_patches:
        X = X[torch.randperm(X.shape[0], generator=torch.Generator().manual_seed(1))[:lim_patches]]
    N, D = X.shape
    K = int(min(int(cfg.get("banco", 10000)), max(1000, round(N * float(cfg.get("coreset", 0.1))))))
    K = min(K, N)
    print(f"{N} patches de {D} dimensões → coreset de {K} ({K / N:.1%}).", flush=True)
    st(estado="treinando", etapa=f"Coreset de {K} vetores", progresso=0.45)
    idx = coreset(torch, X, K, st)
    banco = X[idx].contiguous()
    del X
    st(estado="calibrando", etapa="Calculando as notas de validação", progresso=0.82, duracao_treino_s=int(time.time() - t0))

    modelo = PatchCore(ext, banco, S).eval()

    def notas(lst):
        out = []
        with torch.no_grad():
            for n in lst:
                _, s = modelo(torch.from_numpy(carregar(os.path.join(P, "imagens", n), S))[None])
                out.append(float(s[0]))
        return out

    nb, nr = notas(val_b), notas(ruins)
    margem = float(cfg.get("margem", 0.1))
    limiar, como = calibrar(nb, nr, margem)
    ac_b = sum(v < limiar for v in nb) / len(nb)
    ac_r = (sum(v >= limiar for v in nr) / len(nr)) if nr else None
    au = auroc(nb, nr)
    sep = ((min(nr) - max(nb)) / limiar) if nr else None
    met = {"auroc": None if au is None else round(au, 4), "acerto_boas": round(ac_b, 4),
           "acerto_ruins": None if ac_r is None else round(ac_r, 4),
           "acuracia": round((ac_b + ac_r) / 2 if ac_r is not None else ac_b, 4),
           "separacao": None if sep is None else round(sep, 4), "banco": K, "dimensoes": D}
    print(f"Limiar {limiar:.3f} ({como}). Métricas: {met}", flush=True)

    # mapa: nível típico das boas (para a escala de cores do mapa de calor)
    with torch.no_grad():
        m0, _ = modelo(torch.from_numpy(carregar(os.path.join(P, "imagens", val_b[0]), S))[None])
    mapa_lo = float(torch.quantile(m0.flatten(), 0.5))

    st(estado="exportando", etapa="Exportando ONNX", progresso=0.9)
    arq = os.path.join(c.TD, "modelo.onnx")
    x0 = torch.from_numpy(carregar(os.path.join(P, "imagens", val_b[0]), S))[None]
    kw = {"dynamo": False} if "dynamo" in torch.onnx.export.__code__.co_varnames else {}
    torch.onnx.export(modelo, x0, arq, input_names=["imagem"], output_names=["mapa", "nota"], opset_version=17,
                      do_constant_folding=True, **kw)

    st(estado="validando", etapa="Conferindo o ONNX com onnxruntime", progresso=0.95)
    import onnxruntime as ort
    s = ort.InferenceSession(arq, providers=["CPUExecutionProvider"])
    formas = {o.name: o.shape for o in s.get_outputs()}
    dif = 0.0
    amostra = (val_b + ruins)[:6]
    ref = dict(zip(val_b + ruins, nb + nr))
    t1 = time.time()
    for n in amostra:
        mp, sc = s.run(None, {"imagem": carregar(os.path.join(P, "imagens", n), S)[None]})
        dif = max(dif, abs(float(sc[0]) - ref[n]) / max(1e-6, ref[n]))
    ms = (time.time() - t1) * 1000 / max(1, len(amostra))
    print(f"ONNX {os.path.getsize(arq) / 1e6:.1f} MB · saídas {formas} · diferença relativa máx. {dif:.2e} · "
          f"{ms:.0f} ms/imagem (CPU do servidor)", flush=True)
    if dif > 1e-3 or list(formas.get("mapa", [])) != [1, 1, S, S]:
        raise RuntimeError(f"ONNX não confere com o PyTorch (dif {dif:.2e}, formas {formas}).")

    return {
        "arquitetura": "patchcore", "licenca": LICENCAS["patchcore"], "base": "resnet18 (ImageNet)",
        "classes": ["anomalia"], "imgsz": S, "limiar": round(limiar, 5), "limiar_como": como,
        "mapa_lo": round(mapa_lo, 5), "metricas": met,
        "notas": {"boas": [[n, round(v, 4)] for n, v in zip(val_b, nb)],
                  "ruins": [[n, round(v, 4)] for n, v in zip(ruins, nr)]},
        "validacao_onnx": {"dif_relativa_max": float(f"{dif:.3e}"), "ms_por_imagem": round(ms, 1), "saidas": formas},
        "entrada": {"nome": "imagem", "forma": [1, 3, S, S], "redimensionar": "esticar", "escala": 1 / 255,
                    "media": MEDIA, "desvio": DESVIO, "layout": "nchw", "rgb": True},
        "saida": {"formato": "patchcore", "mapa": "mapa", "nota": "nota",
                  "mapa_forma": [1, 1, S, S], "nota_forma": [1],
                  "explicacao": "distância ao vizinho mais próximo no banco de peças boas; nota ≥ limiar = anomalia"},
        "origem": "implementação GPlanSiS (PatchCore, arXiv:2106.08265) com torchvision " +
                  __import__("torchvision").__version__,
    }
