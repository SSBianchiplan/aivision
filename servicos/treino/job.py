"""Um treino (subprocesso disparado pela fila do app.py): prepara os dados, treina em CPU, exporta ONNX,
confere a saída com onnxruntime e publica no site.

Uso: python job.py <projeto> <treino>. A configuração vem do status.json do treino (cfg); o progresso volta
para o mesmo arquivo (lido pela API). Motores:
  yolo26    — detector Ultralytics YOLO26 (AGPL-3.0), mantido para compatibilidade
  rfdetr    — detector RF-DETR (Apache-2.0), padrão dos projetos novos      → treino_rfdetr.py
  patchcore — detecção de anomalias só com peças boas (Apache-2.0)         → treino_patchcore.py
"""
import json
import os
import random
import shutil
import signal
import sys
import time
import types

from comum import (DATA, LICENCAS, PROJ, atualizar_status, gravar_json, ler_json, pasta_treino, publicar)

pid, tid = sys.argv[1], sys.argv[2]
P = os.path.join(PROJ, pid)
TD = pasta_treino(pid, tid)
STF = os.path.join(TD, "status.json")
cfg = (ler_json(STF, {}) or {}).get("cfg") or (json.loads(sys.argv[3]) if len(sys.argv) > 3 else {})


def st(**kw):
    return atualizar_status(pid, tid, **kw)


def cancelar(*_):
    st(estado="cancelado", fim=int(time.time()))
    print("Treino cancelado.", flush=True)
    os._exit(1)


signal.signal(signal.SIGTERM, cancelar)


def itens_rotulados():
    """Imagens com .txt (mesmo vazio = exemplo negativo), embaralhadas sempre do mesmo jeito."""
    itens = sorted(n for n in os.listdir(os.path.join(P, "imagens"))
                   if os.path.exists(os.path.join(P, "rotulos", n[:-4] + ".txt")))
    random.Random(42).shuffle(itens)
    nval = max(1, int(round(len(itens) * cfg.get("val", 0.2))))
    val, trn = itens[:nval], itens[nval:] or itens[:1]
    return trn, val


def caixas(nome):
    out = []
    f = os.path.join(P, "rotulos", nome[:-4] + ".txt")
    for ln in open(f, encoding="utf-8").read().split("\n"):
        pt = ln.split()
        if len(pt) == 5:
            out.append([int(pt[0])] + [float(x) for x in pt[1:]])
    return out


# ---------------------------------------------------------------- YOLO26 (AGPL-3.0)
def treino_yolo26(c):
    classes = c.proj["classes"]
    ds = os.path.join(TD, "dataset")
    for sub in ("images/train", "images/val", "labels/train", "labels/val"):
        os.makedirs(os.path.join(ds, sub), exist_ok=True)
    trn, val = itens_rotulados()
    for parte, lst in (("train", trn), ("val", val)):
        for n in lst:
            os.link(os.path.join(P, "imagens", n), os.path.join(ds, "images", parte, n))
            shutil.copy(os.path.join(P, "rotulos", n[:-4] + ".txt"), os.path.join(ds, "labels", parte, n[:-4] + ".txt"))
    with open(os.path.join(ds, "data.yaml"), "w", encoding="utf-8") as fh:
        fh.write(f"path: {ds}\ntrain: images/train\nval: images/val\nnames:\n")
        for i, cl in enumerate(classes):
            fh.write(f"  {i}: {json.dumps(cl, ensure_ascii=False)}\n")
    print(f"Dataset: {len(trn)} imagens de treino, {len(val)} de validação, {len(classes)} classes.", flush=True)
    st(estado="treinando", imagens_treino=len(trn), imagens_val=len(val), classes=classes)

    os.environ.setdefault("YOLO_CONFIG_DIR", os.path.join(DATA, ".ultralytics"))
    from ultralytics import YOLO

    os.chdir(os.path.join(DATA, "pesos"))           # cache dos pesos-base oficiais (baixados uma vez)
    model = YOLO(cfg["base"] + ".pt")
    hist = []

    def fim_epoca(trainer):
        m = trainer.metrics or {}
        n = min(int(trainer.epoch) + 1, int(cfg["epocas"]))
        if hist and hist[-1]["epoca"] == n:
            hist.pop()   # validação final repete a última época
        e = {"epoca": n,
             "precisao": round(float(m.get("metrics/precision(B)", 0)), 4),
             "recall": round(float(m.get("metrics/recall(B)", 0)), 4),
             "map50": round(float(m.get("metrics/mAP50(B)", 0)), 4),
             "map50_95": round(float(m.get("metrics/mAP50-95(B)", 0)), 4)}
        hist.append(e)
        st(epoca=e["epoca"], metricas=e, historico=hist[-300:])

    model.add_callback("on_fit_epoch_end", fim_epoca)
    t0 = time.time()
    model.train(data=os.path.join(ds, "data.yaml"), epochs=cfg["epocas"], imgsz=cfg["imgsz"], batch=cfg["lote"],
                patience=cfg["paciencia"], device="cpu", workers=2, project=TD, name="run", exist_ok=True,
                plots=False, amp=False, verbose=True, seed=0, cache=False)
    best = os.path.join(TD, "run", "weights", "best.pt")
    if not os.path.exists(best):
        raise RuntimeError("O treino terminou sem gerar best.pt")

    st(estado="exportando", duracao_treino_s=int(time.time() - t0))
    import onnxruntime as ort

    def forma(f):
        return ort.InferenceSession(f, providers=["CPUExecutionProvider"]).get_outputs()[0].shape

    onnx = YOLO(best).export(format="onnx", imgsz=cfg["imgsz"], opset=17, simplify=True, dynamic=False)
    shp = forma(onnx)
    if not (len(shp) == 3 and shp[-1] == 6):
        # Ajuste fino sai com a cabeça um-para-muitos ([1, 4+nc, N]); com nms=True o export embute o NMS
        # e devolve [1, 300, 6] (x1, y1, x2, y2, score, classe), o formato que o iaVision decodifica.
        print(f"Saída {shp}: exportando de novo com NMS embutido.", flush=True)
        onnx = YOLO(best).export(format="onnx", imgsz=cfg["imgsz"], opset=17, simplify=True, dynamic=False, nms=True)
        shp = forma(onnx)
    print("Saída ONNX:", shp, flush=True)
    if not (len(shp) == 3 and shp[-1] == 6):
        raise RuntimeError(f"Saída inesperada {shp}: o iaVision espera [1, 300, 6] (YOLO26 ponta a ponta).")
    shutil.copy(onnx, os.path.join(TD, "modelo.onnx"))
    final = hist[-1] if hist else {}
    melhor = max(hist, key=lambda e: e["map50_95"]) if hist else {}
    return {"arquitetura": "yolo26", "licenca": LICENCAS["yolo26"], "classes": classes, "imgsz": cfg["imgsz"],
            "base": cfg["base"], "metricas": melhor or final,
            "saida": {"formato": "yolo26-e2e", "forma": [1, 300, 6],
                      "conteudo": "x1,y1,x2,y2 (pixels da entrada letterbox), score, classe"}}


try:
    proj = ler_json(os.path.join(P, "projeto.json"))
    motor = cfg.get("motor") or "yolo26"
    st(estado="preparando", inicio_real=int(time.time()))
    c = types.SimpleNamespace(pid=pid, tid=tid, P=P, TD=TD, cfg=cfg, proj=proj, st=st,
                              itens_rotulados=itens_rotulados, caixas=caixas)
    t0 = time.time()
    if motor == "rfdetr":
        import treino_rfdetr
        ficha = treino_rfdetr.rodar(c)
    elif motor == "patchcore":
        import treino_patchcore
        ficha = treino_patchcore.rodar(c)
    else:
        ficha = treino_yolo26(c)
    gravar_json(os.path.join(TD, "modelo.json"), ficha)
    pub = None
    if cfg.get("publicar", True):
        pub = publicar(pid, tid)
        print(f"Publicado como {pub['id']}.", flush=True)
    st(estado="pronto", fim=int(time.time()), duracao_s=int(time.time() - t0), modelo=pub["id"] if pub else None,
       publicado=bool(pub), melhor=ficha.get("metricas"), bytes=os.path.getsize(os.path.join(TD, "modelo.onnx")),
       resultado={k: ficha[k] for k in ("limiar", "notas", "validacao_onnx", "metricas", "precisao_pesos", "conf_sugerida") if k in ficha})
    print("Pronto.", flush=True)
except Exception as e:  # noqa: BLE001
    import traceback
    traceback.print_exc()
    st(estado="erro", erro=str(e)[:500], fim=int(time.time()))
    sys.exit(1)
