"""Detector RF-DETR (Roboflow, Apache-2.0) treinado em CPU a partir das imagens rotuladas (formato YOLO).

Variantes aceitas: nano, small, medium e base — código e pesos sob Apache-2.0 (backbone DINOv2, Apache-2.0).
As variantes XL/2XL (licença PML) e as de segmentação não são oferecidas.

Passos: YOLO → COCO (train/valid/test com _annotations.coco.json; raiz id 0 + classes 1..n) · treino (PyTorch Lightning do pacote rfdetr)
· export ONNX (entrada "input" [1,3,S,S]; saídas "dets" [1,Q,4] cxcywh normalizado e "labels" [1,Q,C+1] logits,
última fatia = fundo) · quantização int8 dos MatMul (arquivo ~4× menor para o navegador), mantida só se a
validação no ONNX não piorar · validação com onnxruntime nas imagens de validação, com o mesmo pré-processo
do navegador (esticar para S×S, normalização ImageNet).
"""
import glob
import json
import os
import shutil
import time

import numpy as np
from PIL import Image

from comum import DATA, LICENCAS

VARIANTES = {"nano": "RFDETRNano", "small": "RFDETRSmall", "medium": "RFDETRMedium", "base": "RFDETRBase"}
DIVISOR = {"nano": 32, "small": 32, "medium": 32, "base": 56}     # patch_size × num_windows
MEDIA = [0.485, 0.456, 0.406]
DESVIO = [0.229, 0.224, 0.225]


def _coco(c, pasta, lst, classes):
    os.makedirs(pasta, exist_ok=True)
    imgs, anns = [], []
    for i, n in enumerate(lst):
        src = os.path.join(c.P, "imagens", n)
        os.link(src, os.path.join(pasta, n))
        W, H = Image.open(src).size
        imgs.append({"id": i, "file_name": n, "width": W, "height": H})
        for cl, cx, cy, w, h in c.caixas(n):
            if 0 <= cl < len(classes):
                anns.append({"id": len(anns), "image_id": i, "category_id": cl + 1, "iscrowd": 0, "area": w * W * h * H,
                             "bbox": [(cx - w / 2) * W, (cy - h / 2) * H, w * W, h * H]})
    json.dump({"images": imgs, "annotations": anns,
               # convenção do Roboflow: id 0 = categoria-raiz sem anotações (o rfdetr a descarta), classes 1..n.
               # Com a classe real no id 0, o rfdetr 1.11 não aprendia a primeira classe.
               "categories": [{"id": 0, "name": "objetos", "supercategory": "none"}] +
                             [{"id": i + 1, "name": n, "supercategory": "objetos"} for i, n in enumerate(classes)]},
              open(os.path.join(pasta, "_annotations.coco.json"), "w", encoding="utf-8"), ensure_ascii=False)
    return len(anns)


def preprocessar(caminho, S):
    im = Image.open(caminho).convert("RGB")
    W, H = im.size
    x = np.asarray(im.resize((S, S), Image.BILINEAR), dtype=np.float32) / 255.0
    x = (x - MEDIA) / DESVIO
    return x.transpose(2, 0, 1)[None].astype(np.float32), W, H


def decodificar(dets, logits, nc, conf):
    """Igual ao operador do navegador: sigmoide, melhor classe por consulta (sem a fatia de fundo)."""
    p = 1 / (1 + np.exp(-logits[0, :, :nc]))
    sc, cl = p.max(1), p.argmax(1)
    out = []
    for q in np.where(sc >= conf)[0]:
        cx, cy, w, h = dets[0, q]
        out.append((int(cl[q]), float(sc[q]), cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2))
    return sorted(out, key=lambda t: -t[1])


def _iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


def avaliar_onnx(c, arquivo, val, S, nc, confs=(0.3, 0.4, 0.5, 0.6)):
    """Precisão/recall/F1 com IoU ≥ 0,5 no ONNX exportado, imagem a imagem (o que o navegador vai ver), em vários
    limiares de confiança; devolve o de melhor F1 (empate → o mais alto) e a tabela completa."""
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = 3
    s = ort.InferenceSession(arquivo, so, providers=["CPUExecutionProvider"])
    nomes = [o.name for o in s.get_outputs()]
    cont = {k: [0, 0, 0] for k in confs}           # tp, fp, fn
    ms = []
    for n in val:
        x, W, H = preprocessar(os.path.join(c.P, "imagens", n), S)
        t0 = time.time()
        out = dict(zip(nomes, s.run(None, {s.get_inputs()[0].name: x})))
        ms.append((time.time() - t0) * 1000)
        todas = decodificar(out["dets"], out["labels"], nc, min(confs))
        gts = [(cl, cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) for cl, cx, cy, w, h in c.caixas(n)]
        for conf in confs:
            usados = set()
            for cl, _sc, *bx in (p for p in todas if p[1] >= conf):
                j = max(((k, _iou(bx, g[1:])) for k, g in enumerate(gts) if g[0] == cl and k not in usados),
                        key=lambda t: t[1], default=(None, 0))
                if j[0] is not None and j[1] >= 0.5:
                    usados.add(j[0])
                    cont[conf][0] += 1
                else:
                    cont[conf][1] += 1
            cont[conf][2] += len(gts) - len(usados)
    tab = []
    for conf in confs:
        tp, fp, fn = cont[conf]
        pr = tp / (tp + fp) if tp + fp else 0.0
        rc = tp / (tp + fn) if tp + fn else 0.0
        tab.append({"conf": conf, "precisao": round(pr, 4), "recall": round(rc, 4),
                    "f1": round(2 * pr * rc / (pr + rc) if pr + rc else 0, 4)})
    melhor = max(reversed(tab), key=lambda t: t["f1"])
    return {**melhor, "por_confianca": tab, "imagens": len(val),
            "ms_por_imagem": round(float(np.median(ms)), 1) if ms else None, "saidas": nomes}


def rodar(c):
    cfg, st = c.cfg, c.st
    classes = c.proj["classes"]
    var = cfg.get("variante", "nano")
    if var not in VARIANTES:
        raise RuntimeError("Variante RF-DETR não permitida (só nano, small, medium e base, todas Apache-2.0).")
    S = int(cfg["imgsz"])
    if S % DIVISOR[var]:
        raise RuntimeError(f"Para RF-DETR {var} o tamanho da imagem precisa ser múltiplo de {DIVISOR[var]}.")

    trn, val = c.itens_rotulados()
    ds = os.path.join(c.TD, "dataset")
    na = _coco(c, os.path.join(ds, "train"), trn, classes)
    nv = _coco(c, os.path.join(ds, "valid"), val, classes)
    _coco(c, os.path.join(ds, "test"), val, classes)
    print(f"Dataset COCO: {len(trn)} imagens de treino ({na} caixas), {len(val)} de validação ({nv} caixas), "
          f"{len(classes)} classes.", flush=True)
    st(estado="treinando", imagens_treino=len(trn), imagens_val=len(val), classes=classes)

    os.environ.setdefault("HF_HOME", os.path.join(DATA, "pesos", "hf"))
    import rfdetr
    import rfdetr.training as RT
    from pytorch_lightning import Callback

    hist = []
    total = int(cfg["epocas"])
    ult = [0.0]

    class Progresso(Callback):
        def on_train_batch_end(self, trainer, *_a, **_k):
            agora = time.time()
            if agora - ult[0] > 8:
                ult[0] = agora
                nb = trainer.num_training_batches or 1
                st(passo=int(trainer.fit_loop.epoch_loop.batch_progress.current.completed), passos=int(nb),
                   epoca_atual=int(trainer.current_epoch) + 1)

        def on_validation_epoch_end(self, trainer, *_a, **_k):
            if trainer.sanity_checking:
                return
            m = {k: float(v) for k, v in trainer.callback_metrics.items() if k.startswith("val/")}
            g = (lambda k: m.get("val/ema_" + k, m.get("val/" + k, 0.0)))
            e = {"epoca": int(trainer.current_epoch) + 1, "map50": round(g("mAP_50"), 4),
                 "map50_95": round(g("mAP_50_95"), 4), "precisao": round(m.get("val/precision", 0.0), 4),
                 "recall": round(m.get("val/recall", 0.0), 4), "f1": round(m.get("val/F1", 0.0), 4)}
            if hist and hist[-1]["epoca"] == e["epoca"]:
                hist.pop()
            hist.append(e)
            print(f"Época {e['epoca']}/{total}: mAP50 {e['map50']:.3f} · mAP50-95 {e['map50_95']:.3f} · "
                  f"precisão {e['precisao']:.3f} · recall {e['recall']:.3f}", flush=True)
            st(epoca=e["epoca"], metricas=e, historico=hist[-300:])

    orig = RT.build_trainer

    def build_trainer(*a, **k):
        t = orig(*a, **k)
        t.callbacks.append(Progresso())
        return t

    RT.build_trainer = build_trainer
    pesos = os.path.join(DATA, "pesos")
    os.makedirs(pesos, exist_ok=True)
    os.chdir(pesos)                        # pesos pré-treinados (COCO, Apache-2.0) ficam em cache aqui
    Classe = getattr(rfdetr, VARIANTES[var])
    model = Classe()
    run = os.path.join(c.TD, "run")
    t0 = time.time()
    pac = int(cfg.get("paciencia") or 0)
    model.train(dataset_dir=ds, epochs=total, batch_size=int(cfg.get("lote", 2)),
                grad_accum_steps=int(cfg.get("acumular", 4)), lr=float(cfg.get("lr", 1e-4)), resolution=S,
                output_dir=run, device="cpu", num_workers=0, tensorboard=False, multi_scale=False,
                checkpoint_interval=10000, early_stopping=pac > 0, early_stopping_patience=max(1, pac))
    best = os.path.join(run, "checkpoint_best_total.pth")
    if not os.path.exists(best):
        raise RuntimeError("O treino terminou sem gerar checkpoint_best_total.pth")
    for f in glob.glob(os.path.join(run, "*.pth")) + glob.glob(os.path.join(run, "*.ckpt")):
        if os.path.basename(f) != "checkpoint_best_total.pth":
            os.remove(f)               # só o melhor fica (cada checkpoint tem centenas de MB)
    st(estado="exportando", duracao_treino_s=int(time.time() - t0))

    print("Exportando para ONNX…", flush=True)
    m2 = Classe(pretrain_weights=best)
    exp = os.path.join(c.TD, "export")
    onnx32 = str(m2.export(output_dir=exp, verbose=False))
    st(estado="validando")
    nc = len(classes)
    v32 = avaliar_onnx(c, onnx32, val, S, nc)
    print(f"ONNX fp32 ({os.path.getsize(onnx32) / 1e6:.1f} MB): {v32}", flush=True)
    escolhido, val_final, precisao_pesos = onnx32, v32, "fp32"
    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        onnx8 = os.path.join(exp, "modelo-int8.onnx")
        quantize_dynamic(onnx32, onnx8, op_types_to_quantize=["MatMul", "Gemm"], weight_type=QuantType.QInt8)
        v8 = avaliar_onnx(c, onnx8, val, S, nc)
        print(f"ONNX int8 ({os.path.getsize(onnx8) / 1e6:.1f} MB): {v8}", flush=True)
        if v8["f1"] >= v32["f1"] - 0.02:
            escolhido, val_final, precisao_pesos = onnx8, v8, "int8 (MatMul quantizado)"
        else:
            print("int8 piorou a validação: publicando fp32.", flush=True)
    except Exception as e:  # noqa: BLE001
        print("Quantização int8 falhou, segue fp32:", e, flush=True)
    shutil.copy(escolhido, os.path.join(c.TD, "modelo.onnx"))
    melhor = max(hist, key=lambda e: e["map50_95"]) if hist else {}
    return {
        "arquitetura": "rfdetr", "licenca": LICENCAS["rfdetr"], "base": f"rf-detr-{var}", "variante": var,
        "classes": classes, "imgsz": S, "metricas": melhor, "validacao_onnx": val_final,
        "precisao_pesos": precisao_pesos, "conf_sugerida": val_final["conf"],
        "entrada": {"nome": "input", "forma": [1, 3, S, S], "redimensionar": "esticar", "escala": 1 / 255,
                    "media": MEDIA, "desvio": DESVIO, "layout": "nchw", "rgb": True},
        "saida": {"formato": "rfdetr", "caixas": "dets", "logits": "labels", "consultas": 300,
                  "caixa": "cx,cy,w,h normalizados 0..1 na imagem inteira",
                  "classes": "logits [1,Q,C+1]: sigmoide nas C primeiras; a última fatia é fundo (ignorar)",
                  "nms": False},
        "origem": "rfdetr " + getattr(rfdetr, "__version__", "?") + " (github.com/roboflow/rf-detr)",
    }
