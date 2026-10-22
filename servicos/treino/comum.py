"""Partes comuns ao serviço (app.py) e aos treinos (job.py): pastas, status dos treinos e publicação no site.

Publicar = copiar o ONNX do treino para /custom/<id>.onnx e pôr a ficha em /custom/index.json, que o iaVision
lê no navegador. O id do modelo é estável (<projeto>-<treino>); o nome mostrado é o nome do treino.
"""
import fcntl
import json
import os
import re
import shutil
import time
from contextlib import contextmanager

DATA = os.getenv("AIV_DATA", "/data")
CUSTOM = os.getenv("AIV_CUSTOM", "/custom")          # = /opt/aivision/site/models/custom
PROJ = os.path.join(DATA, "projetos")
TID_RE = re.compile(r"^\d{8}-\d{6}(-\d)?$")
ATIVOS = ("fila", "preparando", "treinando", "extraindo", "calibrando", "exportando", "validando")
MOTORES = {
    "yolo26": "YOLO26 (Ultralytics)",
    "rfdetr": "RF-DETR (Roboflow)",
    "patchcore": "PatchCore (anomalia)",
}
LICENCAS = {
    "yolo26": "AGPL-3.0 (Ultralytics YOLO26)",
    "rfdetr": "Apache-2.0 (RF-DETR, Roboflow; backbone DINOv2 Apache-2.0)",
    "patchcore": "Apache-2.0 (PatchCore implementado pela GPlanSiS; backbone ResNet-18 torchvision BSD-3-Clause, pesos ImageNet)",
}


def ler_json(f, padrao=None):
    try:
        with open(f, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return padrao


def gravar_json(f, d):
    tmp = f + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, f)


def pasta_treino(pid, tid):
    return os.path.join(PROJ, pid, "treinos", tid)


@contextmanager
def trava(nome):
    """Trava entre processos (API e treino escrevem no mesmo status/índice)."""
    os.makedirs(os.path.join(DATA, ".travas"), exist_ok=True)
    with open(os.path.join(DATA, ".travas", nome), "w") as fh:
        fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


def atualizar_status(pid, tid, **kw):
    f = os.path.join(pasta_treino(pid, tid), "status.json")
    with trava("status-" + tid):
        s = ler_json(f, {}) or {}
        s.update(kw)
        s["atualizado"] = int(time.time())
        gravar_json(f, s)
    return s


def nome_padrao(proj, st):
    """Nome para treinos antigos, criados antes de os treinos terem nome."""
    cfg = st.get("cfg") or {}
    motor = cfg.get("motor") or "yolo26"
    tid = st.get("id", "")
    try:   # o id do treino está em UTC (relógio do contêiner); o nome mostra o horário de Brasília (UTC−3)
        import datetime as _dt
        t = _dt.datetime.strptime(tid[:15], "%Y%m%d-%H%M%S") - _dt.timedelta(hours=3)
        data = t.strftime("%d/%m %H:%M")
    except ValueError:
        data = tid
    if motor == "patchcore":
        desc = f"PatchCore {cfg.get('backbone', 'resnet18')}"
    elif motor == "rfdetr":
        desc = f"RF-DETR {cfg.get('variante', 'nano')} · {cfg.get('epocas', '?')} épocas"
    else:
        desc = f"{cfg.get('base', 'yolo26n')} · {cfg.get('epocas', '?')} épocas"
    return f"{proj.get('nome', st.get('projeto', ''))} · {desc} · {data}"


# ---------------------------------------------------------------- índice de modelos publicados
def _idx():
    return os.path.join(CUSTOM, "index.json")


def ler_indice():
    lst = ler_json(_idx(), [])
    return lst if isinstance(lst, list) else []


def modelo_id(pid, tid):
    return f"{pid}-{tid}".lower()


def arquivo_onnx_treino(pid, tid):
    """ONNX final de um treino: modelo.onnx (novos) ou run/weights/best.onnx (YOLO26 antigos)."""
    td = pasta_treino(pid, tid)
    for f in (os.path.join(td, "modelo.onnx"), os.path.join(td, "run", "weights", "best.onnx")):
        if os.path.exists(f):
            return f
    return None


def ficha_treino(pid, tid):
    """Ficha do index.json para um treino pronto (modelo.json dos novos; montada do status nos antigos)."""
    td = pasta_treino(pid, tid)
    st = ler_json(os.path.join(td, "status.json"), {}) or {}
    proj = ler_json(os.path.join(PROJ, pid, "projeto.json"), {}) or {}
    ficha = ler_json(os.path.join(td, "modelo.json"))
    onnx = arquivo_onnx_treino(pid, tid)
    if not onnx:
        return None
    mid = modelo_id(pid, tid)
    if not ficha:   # treino YOLO26 da primeira versão do serviço
        cfg = st.get("cfg") or {}
        ficha = {"arquitetura": "yolo26", "classes": st.get("classes") or proj.get("classes", []),
                 "imgsz": cfg.get("imgsz", 640), "base": cfg.get("base", "yolo26n"),
                 "metricas": st.get("melhor") or st.get("metricas") or {}, "licenca": LICENCAS["yolo26"]}
    ficha = dict(ficha)
    ficha.update({"id": mid, "nome": st.get("nome") or nome_padrao(proj, st), "projeto": pid, "treino": tid,
                  "arquivo": f"models/custom/{mid}.onnx", "bytes": os.path.getsize(onnx),
                  "criado": st.get("fim") or int(time.time())})
    if ficha.get("arquitetura") == "yolo26":
        ficha.pop("arquitetura")   # sem o campo = yolo26 (compatível com o operador antigo)
    return ficha


def publicar(pid, tid):
    ficha = ficha_treino(pid, tid)
    if not ficha:
        raise RuntimeError("Este treino não tem modelo pronto para publicar.")
    destino = os.path.join(CUSTOM, ficha["id"] + ".onnx")
    with trava("indice"):
        shutil.copy(arquivo_onnx_treino(pid, tid), destino + ".tmp")
        os.replace(destino + ".tmp", destino)
        lst = [m for m in ler_indice() if m.get("id") != ficha["id"]] + [ficha]
        gravar_json(_idx(), lst)
    atualizar_status(pid, tid, publicado=True, modelo=ficha["id"])
    return ficha


def despublicar_id(mid):
    with trava("indice"):
        lst = [m for m in ler_indice() if m.get("id") != mid]
        gravar_json(_idx(), lst)
        f = os.path.join(CUSTOM, mid + ".onnx")
        if os.path.exists(f):
            os.remove(f)
    return lst


def renomear_publicado(mid, nome):
    with trava("indice"):
        lst = ler_indice()
        mudou = False
        for m in lst:
            if m.get("id") == mid:
                m["nome"] = nome
                mudou = True
        if mudou:
            gravar_json(_idx(), lst)
