"""GPlanSiS|iaVision · serviço de treino de modelos.

v2.2: origem de cada imagem (print, arquivo, quadro do YouTube) em origens.json, deduplicação por sha256 no
envio e GET /projetos/{p}/origens (json/csv/md). O serviço não baixa nada da internet.

Tipos de projeto:
  detector — imagens com caixas (formato YOLO); motores RF-DETR (Apache-2.0, padrão) ou YOLO26 (AGPL-3.0)
  anomalia — só fotos de peças boas (e, opcionalmente, algumas ruins para calibrar); motor PatchCore (Apache-2.0)
Cada projeto tem vários treinos com nome; os treinos entram numa fila e rodam um de cada vez (subprocesso
job.py). O modelo pronto é exportado para ONNX e publicado em /models/custom/ do site, de onde os operadores
do iaVision carregam no navegador. Projetos e treinos antigos (sem tipo/motor/nome) continuam como YOLO26.
Acesso por senha (AIV_TREINO_SENHA); o token é HMAC com validade de 12 h.
Entrada sem senha (SSO) para os administradores do iaVision: POST /api/treino/sessao repassa o cookie de sessão
para a API PHP de login (AIV_ME_URL, como o serviço aivision-yt) e, se o e-mail estiver em AIV_TREINO_ADMINS,
emite o MESMO token da senha. A decisão é só aqui no servidor.
"""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from PIL import Image, ImageOps

from comum import (ATIVOS, CUSTOM, LICENCAS, MOTORES, PROJ, TID_RE, arquivo_onnx_treino, atualizar_status,
                   despublicar_id, ler_indice, ler_json, modelo_id, nome_padrao, pasta_treino, publicar,
                   renomear_publicado, trava)

DATA = os.getenv("AIV_DATA", "/data")
SENHA = os.getenv("AIV_TREINO_SENHA", "")
SEGREDO = (os.getenv("AIV_TREINO_SEGREDO") or hashlib.sha256((SENHA + "aiv").encode()).hexdigest()).encode()
MAX_IMG = int(os.getenv("AIV_MAX_IMAGENS", "3000"))
os.makedirs(PROJ, exist_ok=True)
os.makedirs(CUSTOM, exist_ok=True)
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
IMG_RE = re.compile(r"^[A-Za-z0-9_.-]{1,120}\.jpg$")
ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
ME_URL = os.getenv("AIV_ME_URL", "https://gplansis.com/aivision-api/api/me")
# e-mails (vírgulas) que entram no Treinar pela sessão do iaVision, sem a senha
ADMINS = {e.strip().lower() for e in os.getenv("AIV_TREINO_ADMINS", "").split(",") if e.strip()}

app = FastAPI(title="iaVision · treino", docs_url=None, redoc_url=None)
_lock = threading.Lock()
_job = {"proc": None, "pid": None, "tid": None}
_falhas: dict = {}


# ---------------------------------------------------------------- acesso
def _token(exp: int) -> str:
    msg = str(exp).encode()
    return base64.urlsafe_b64encode(msg + b"." + hmac.new(SEGREDO, msg, hashlib.sha256).digest()).decode()


def _valido(tok: str) -> bool:
    try:
        raw = base64.urlsafe_b64decode(tok.encode())
        msg, sig = raw.split(b".", 1)
        return hmac.compare_digest(sig, hmac.new(SEGREDO, msg, hashlib.sha256).digest()) and int(msg) > time.time()
    except Exception:
        return False


def auth(request: Request):
    h = request.headers.get("authorization", "")
    tok = h[7:] if h.lower().startswith("bearer ") else request.query_params.get("t", "")
    if not SENHA or not _valido(tok):
        raise HTTPException(401, "Entre com a senha do treino.")


@app.post("/api/treino/entrar")
async def entrar(request: Request):
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]
    agora = time.time()
    lst = [t for t in _falhas.get(ip, []) if agora - t < 900]
    if len(lst) >= 8:
        raise HTTPException(429, "Muitas tentativas. Aguarde 15 minutos.")
    b = await request.json()
    if not SENHA or not hmac.compare_digest(str(b.get("senha", "")), SENHA):
        _falhas[ip] = lst + [agora]
        raise HTTPException(401, "Senha incorreta.")
    _falhas.pop(ip, None)
    exp = int(agora) + 12 * 3600
    return {"token": _token(exp), "expira": exp}


# ---------------------------------------------------------------- entrada pela sessão do iaVision (SSO)
_sessoes: dict = {}          # sha256(cookie) -> (validade, usuário|None)
_consultas: dict = {}        # ip -> [instantes] das consultas novas à API de login
_sso_lock = threading.Lock()


class LoginIndisponivel(Exception):
    """A API PHP de login não respondeu direito: não é «não logado», é «não deu para saber»."""


def _ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    return (xff.split(",")[0].strip() if xff else "") or (request.client.host if request.client else "?")


def _usuario_da_sessao(cookie: str, ip: str):
    """O usuário de /api/me para este cookie (dict) ou None. Cache 60 s (válida) / 10 s (inválida).
    Cookie fora do cache conta no limite por IP (30/min) antes de ir à hospedagem."""
    if not cookie:
        return None
    chave = hashlib.sha256(cookie.encode()).hexdigest()
    agora = time.monotonic()
    with _sso_lock:
        if len(_sessoes) > 2000:
            for k in [k for k, v in _sessoes.items() if v[0] < agora]:
                _sessoes.pop(k, None)
        v = _sessoes.get(chave)
        if v and v[0] > agora:
            return v[1]
        lst = [t for t in _consultas.get(ip, []) if t > agora - 60]
        if len(lst) >= 30:
            _consultas[ip] = lst
            raise HTTPException(429, "Muitas tentativas seguidas. Espere um minuto.")
        _consultas[ip] = lst + [agora]
    req = urllib.request.Request(ME_URL, headers={"Cookie": cookie, "Accept": "application/json",
                                                  "X-Forwarded-For": ip, "X-Real-IP": ip,
                                                  "User-Agent": "aivision-treino/2"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status != 200:
                raise LoginIndisponivel()
            corpo = json.loads(r.read(200_000).decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise LoginIndisponivel() from e
    if not isinstance(corpo, dict):
        raise LoginIndisponivel()
    u = corpo.get("user") if corpo.get("authenticated") is True else None
    u = u if isinstance(u, dict) else None
    with _sso_lock:
        _sessoes[chave] = (agora + (60 if u else 10), u)
    return u


@app.post("/api/treino/sessao")
def sessao(request: Request):
    """Entra no Treinar sem senha se a sessão do iaVision é de um e-mail em AIV_TREINO_ADMINS."""
    if not SENHA or not ADMINS:
        raise HTTPException(403, "Entrada pela conta não está habilitada. Use a senha do treino.")
    try:
        u = _usuario_da_sessao(request.headers.get("cookie", ""), _ip(request))
    except LoginIndisponivel:
        raise HTTPException(503, "O login do iaVision não respondeu agora. Tente de novo ou use a senha.")
    email = "".join(str((u or {}).get("email") or "").split()).lower()
    if not email or email not in ADMINS:
        raise HTTPException(403, "Esta conta não entra no Treinar sem senha. Use a senha do treino.")
    exp = int(time.time()) + 12 * 3600
    return {"token": _token(exp), "expira": exp, "email": email, "admin": True}


# ---------------------------------------------------------------- utilidades
def _p(pid: str, *parts) -> str:
    if not ID_RE.match(pid or ""):
        raise HTTPException(400, "Projeto inválido")
    return os.path.join(PROJ, pid, *parts)


def _tid(tid: str) -> str:
    if not TID_RE.match(tid or ""):
        raise HTTPException(400, "Treino inválido")
    return tid


def _normalizar(d: dict) -> dict:
    """Projetos antigos não têm tipo nem motor: são detectores YOLO26."""
    d.setdefault("tipo", "detector")
    if d["tipo"] == "detector":
        d.setdefault("motor", "yolo26")
    else:
        d["motor"] = "patchcore"
    return d


def _proj(pid: str) -> dict:
    f = _p(pid, "projeto.json")
    if not os.path.exists(f):
        raise HTTPException(404, "Projeto não encontrado")
    with open(f, encoding="utf-8") as fh:
        return _normalizar(json.load(fh))


def _salvar(pid: str, d: dict):
    tmp = _p(pid, "projeto.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, indent=1)
    os.replace(tmp, _p(pid, "projeto.json"))


def _slug(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:36]
    return s or "projeto"


def _rotulos(pid: str, nome: str) -> list:
    f = _p(pid, "rotulos", nome[:-4] + ".txt")
    out = []
    if os.path.exists(f):
        for ln in open(f, encoding="utf-8").read().split("\n"):
            pt = ln.split()
            if len(pt) == 5:
                try:
                    out.append([int(pt[0])] + [round(float(x), 6) for x in pt[1:]])
                except ValueError:
                    pass
    return out


def _grupos(pid: str) -> dict:
    return ler_json(_p(pid, "grupos.json"), {}) or {}


def _salvar_grupos(pid: str, g: dict):
    tmp = _p(pid, "grupos.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(g, fh, ensure_ascii=False)
    os.replace(tmp, _p(pid, "grupos.json"))


# ---------------------------------------------------------------- origem de cada imagem (v2.2)
# origens.json no projeto: {nome.jpg: {fonte, origem, titulo, autor, licenca, url, video, t, capturado,
# arquivo, sha256, sha256_original, importado}}. Só metadado: o serviço NUNCA baixa nada da internet —
# prints e quadros do YouTube são feitos no navegador e chegam pelo upload de sempre.
FONTES = {"print": "Print (área de transferência)", "arquivo": "Arquivo enviado", "youtube": "Quadro de vídeo do YouTube",
          "zip": "ZIP importado"}
LIC_PADRAO = {"print": "desconhecida (print — confira os direitos de quem fez a imagem)",
              "youtube": "do dono do vídeo no YouTube (uso sujeito aos termos do YouTube e aos direitos do autor)",
              "arquivo": "não informada"}
HEX64 = re.compile(r"^[0-9a-f]{64}$")
YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")


def _origens(pid: str) -> dict:
    o = ler_json(_p(pid, "origens.json"), {}) or {}
    return o if isinstance(o, dict) else {}


def _salvar_origens(pid: str, o: dict):
    tmp = _p(pid, "origens.json.tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(o, fh, ensure_ascii=False, indent=0)
    os.replace(tmp, _p(pid, "origens.json"))


def _txt(v, n: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(v or "")).strip()[:n]


def _meta_limpa(m) -> dict:
    """Metadado de origem mandado pelo navegador, só com os campos e formatos aceitos."""
    m = m if isinstance(m, dict) else {}
    fonte = m.get("fonte") if m.get("fonte") in ("print", "arquivo", "youtube") else "arquivo"
    out = {"fonte": fonte}
    for k, n in (("origem", 200), ("titulo", 200), ("autor", 120), ("licenca", 160), ("capturado", 40), ("arquivo", 120)):
        v = _txt(m.get(k), n)
        if v:
            out[k] = v
    if fonte == "youtube":
        vid = str(m.get("video") or "")
        if not YT_ID.match(vid):
            fonte = out["fonte"] = "arquivo"
        else:
            out["video"] = vid
            try:
                t = max(0.0, min(360000.0, float(m.get("t") or 0)))
            except (TypeError, ValueError):
                t = 0.0
            out["t"] = round(t, 2)
            # o link é montado AQUI (nunca o texto do navegador): só youtube.com/watch
            out["url"] = f"https://www.youtube.com/watch?v={vid}&t={int(t)}s"
            if not out.get("origem"):
                out["origem"] = f"YouTube {vid} @ {int(t) // 60:02d}:{int(t) % 60:02d}"
    sha = str(m.get("sha256_original") or "").lower()
    if HEX64.match(sha):
        out["sha256_original"] = sha
    out.setdefault("licenca", LIC_PADRAO[fonte])
    return out


def _hashes(orig: dict) -> set:
    hs = set()
    for v in orig.values():
        if isinstance(v, dict):
            hs.update(x for x in (v.get("sha256"), v.get("sha256_original")) if x)
    return hs


def _resumo(pid: str) -> dict:
    d = _proj(pid)
    imgs = sorted(os.listdir(_p(pid, "imagens"))) if os.path.isdir(_p(pid, "imagens")) else []
    if d["tipo"] == "anomalia":
        g = _grupos(pid)
        ruins = sum(1 for n in imgs if g.get(n) == "ruim")
        return {**d, "imagens": len(imgs), "boas": len(imgs) - ruins, "ruins": ruins, "rotuladas": len(imgs),
                "caixas_por_classe": []}
    rot = [n for n in imgs if os.path.exists(_p(pid, "rotulos", n[:-4] + ".txt"))]
    cont = [0] * len(d["classes"])
    for n in rot:
        for r in _rotulos(pid, n):
            if 0 <= r[0] < len(cont):
                cont[r[0]] += 1
    return {**d, "imagens": len(imgs), "rotuladas": len(rot), "caixas_por_classe": cont}


def _versao(pkg):
    from importlib.metadata import PackageNotFoundError, version
    try:
        return version(pkg)
    except PackageNotFoundError:
        return None


# ---------------------------------------------------------------- projetos
@app.get("/api/treino/estado", dependencies=[Depends(auth)])
def estado():
    du = shutil.disk_usage(DATA)
    fila = _fila()
    return {"ultralytics": _versao("ultralytics"), "rfdetr": _versao("rfdetr"), "torch": _versao("torch"),
            "cpus": os.cpu_count(), "livre_gb": round(du.free / 1e9, 1), "motores": MOTORES, "licencas": LICENCAS,
            "treinando": _job["tid"] if _rodando() else None,
            "treinando_projeto": _job["pid"] if _rodando() else None, "fila": [f"{p}/{t}" for p, t, _ in fila]}


@app.get("/api/treino/projetos", dependencies=[Depends(auth)])
def projetos():
    out = []
    for pid in sorted(os.listdir(PROJ)):
        if os.path.exists(os.path.join(PROJ, pid, "projeto.json")):
            try:
                out.append(_resumo(pid))
            except Exception:
                pass
    return out


@app.post("/api/treino/projetos", dependencies=[Depends(auth)])
async def novo_projeto(request: Request):
    b = await request.json()
    nome = str(b.get("nome", "")).strip()[:60]
    tipo = b.get("tipo") if b.get("tipo") in ("detector", "anomalia") else "detector"
    motor = "patchcore" if tipo == "anomalia" else (b.get("motor") if b.get("motor") in ("rfdetr", "yolo26") else "rfdetr")
    classes = [str(c).strip()[:40] for c in (b.get("classes") or []) if str(c).strip()][:80]
    if not nome:
        raise HTTPException(400, "Informe o nome do projeto.")
    if tipo == "detector" and not classes:
        raise HTTPException(400, "Informe pelo menos uma classe.")
    if len(set(classes)) != len(classes):
        raise HTTPException(400, "Há classes repetidas.")
    pid = _slug(nome)
    base = pid
    i = 2
    while os.path.exists(os.path.join(PROJ, pid)):
        pid = f"{base}-{i}"
        i += 1
    os.makedirs(_p(pid, "imagens"))
    os.makedirs(_p(pid, "rotulos"))
    _salvar(pid, {"id": pid, "nome": nome, "tarefa": "anomaly" if tipo == "anomalia" else "detect", "tipo": tipo,
                  "motor": motor, "classes": classes if tipo == "detector" else [], "criado": int(time.time())})
    return _resumo(pid)


@app.patch("/api/treino/projetos/{pid}", dependencies=[Depends(auth)])
async def editar_projeto(pid: str, request: Request):
    d = _proj(pid)
    b = await request.json()
    if "nome" in b:
        d["nome"] = str(b["nome"]).strip()[:60] or d["nome"]
    if "motor" in b and d["tipo"] == "detector" and b["motor"] in ("rfdetr", "yolo26"):
        d["motor"] = b["motor"]
    if "classes" in b and d["tipo"] == "detector":
        novas = [str(c).strip()[:40] for c in b["classes"] if str(c).strip()][:80]
        if len(novas) < len(d["classes"]):
            raise HTTPException(400, "Só dá para acrescentar classes ou renomear; remover mudaria os rótulos já feitos.")
        d["classes"] = novas
    _salvar(pid, d)
    return _resumo(pid)


@app.delete("/api/treino/projetos/{pid}", dependencies=[Depends(auth)])
def apagar_projeto(pid: str):
    _proj(pid)
    if _job["pid"] == pid and _rodando():
        raise HTTPException(409, "Há um treino deste projeto em andamento.")
    shutil.rmtree(_p(pid))
    return {"ok": True}


# ---------------------------------------------------------------- imagens e rótulos
@app.get("/api/treino/projetos/{pid}/imagens", dependencies=[Depends(auth)])
def imagens(pid: str):
    d = _proj(pid)
    g = _grupos(pid) if d["tipo"] == "anomalia" else {}
    orig = _origens(pid)
    out = []
    for n in sorted(os.listdir(_p(pid, "imagens"))):
        if d["tipo"] == "anomalia":
            it = {"nome": n, "caixas": [], "rotulada": True, "grupo": g.get(n, "boa")}
        else:
            it = {"nome": n, "caixas": _rotulos(pid, n),
                  "rotulada": os.path.exists(_p(pid, "rotulos", n[:-4] + ".txt"))}
        if n in orig:
            it["origem"] = orig[n]
        out.append(it)
    return out


def _gravar_imagem(pid: str, im, base: str) -> str:
    im.thumbnail((1280, 1280))
    base = re.sub(r"[^A-Za-z0-9_-]+", "_", base)[:60] or "img"
    nome = f"{base}.jpg"
    k = 2
    while os.path.exists(_p(pid, "imagens", nome)):
        nome = f"{base}_{k}.jpg"
        k += 1
    im.save(_p(pid, "imagens", nome), "JPEG", quality=90)
    return nome


@app.post("/api/treino/projetos/{pid}/imagens", dependencies=[Depends(auth)])
async def enviar_imagens(pid: str, arquivos: list[UploadFile] = File(...), grupo: str = "", meta: str = Form("")):
    """Envio de imagens. `meta` (opcional, v2.2): JSON com uma lista na MESMA ordem dos arquivos, cada item
    {fonte: print|arquivo|youtube, origem, titulo, autor, licenca, capturado, arquivo, video, t, sha256_original}.
    Repetidas (mesmo sha256 do arquivo recebido ou do original informado) são puladas e voltam em `repetidas`."""
    d = _proj(pid)
    ja = len(os.listdir(_p(pid, "imagens")))
    ok, erros, repetidas = [], [], []
    g = _grupos(pid) if d["tipo"] == "anomalia" else None
    try:
        metas = json.loads(meta) if meta else []
    except ValueError:
        raise HTTPException(400, "meta inválido (esperado JSON com uma lista).")
    if not isinstance(metas, list):
        metas = []
    # lê tudo ANTES da trava: a trava é de arquivo (fcntl) e não pode ficar presa num await
    lidos = [(f.filename or "img", await f.read()) for f in arquivos]
    with trava("origens-" + pid):
        orig = _origens(pid)
        vistos = _hashes(orig)
        mudou = False
        for i, (fn, raw) in enumerate(lidos):
            if ja + len(ok) >= MAX_IMG:
                erros.append(f"{fn}: limite de {MAX_IMG} imagens")
                break
            try:
                if len(raw) > 25e6:
                    raise ValueError("maior que 25 MB")
                m = _meta_limpa(metas[i] if i < len(metas) else None)
                sha = hashlib.sha256(raw).hexdigest()
                if sha in vistos or m.get("sha256_original") in vistos:
                    repetidas.append(fn)
                    continue
                im = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
                nome = _gravar_imagem(pid, im, os.path.splitext(fn)[0])
                ok.append(nome)
                if g is not None:
                    g[nome] = "ruim" if grupo == "ruim" else "boa"
                m.update(sha256=sha, importado=int(time.time()))
                m.setdefault("arquivo", _txt(fn, 120))
                orig[nome] = m
                vistos.update(x for x in (sha, m.get("sha256_original")) if x)
                mudou = True
            except Exception as e:
                erros.append(f"{fn}: {str(e)[:60]}")
        if mudou:
            _salvar_origens(pid, orig)
    if g is not None:
        _salvar_grupos(pid, g)
    return {"enviadas": ok, "erros": erros, "repetidas": repetidas}


@app.get("/api/treino/projetos/{pid}/imagens/{nome}", dependencies=[Depends(auth)])
def ver_imagem(pid: str, nome: str):
    if not IMG_RE.match(nome):
        raise HTTPException(400, "Nome inválido")
    f = _p(pid, "imagens", nome)
    if not os.path.exists(f):
        raise HTTPException(404, "Imagem não encontrada")
    return FileResponse(f, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600",
                                                            "Cross-Origin-Resource-Policy": "same-origin"})


@app.put("/api/treino/projetos/{pid}/imagens/{nome}/rotulos", dependencies=[Depends(auth)])
async def salvar_rotulos(pid: str, nome: str, request: Request):
    d = _proj(pid)
    if not IMG_RE.match(nome) or not os.path.exists(_p(pid, "imagens", nome)):
        raise HTTPException(404, "Imagem não encontrada")
    b = await request.json()
    linhas = []
    for c in (b.get("caixas") or [])[:500]:
        cls, cx, cy, w, h = int(c[0]), *[min(1.0, max(0.0, float(v))) for v in c[1:5]]
        if not 0 <= cls < len(d["classes"]) or w <= 0.002 or h <= 0.002:
            continue
        linhas.append(f"{cls} {cx:.6f} {cy:.6f} {w:.6f} {h:.6f}")
    with open(_p(pid, "rotulos", nome[:-4] + ".txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(linhas) + ("\n" if linhas else ""))
    return {"ok": True, "caixas": len(linhas)}


@app.put("/api/treino/projetos/{pid}/imagens/{nome}/grupo", dependencies=[Depends(auth)])
async def mudar_grupo(pid: str, nome: str, request: Request):
    """Projetos de anomalia: a foto é de peça boa ou ruim."""
    _proj(pid)
    if not IMG_RE.match(nome) or not os.path.exists(_p(pid, "imagens", nome)):
        raise HTTPException(404, "Imagem não encontrada")
    b = await request.json()
    g = _grupos(pid)
    g[nome] = "ruim" if b.get("grupo") == "ruim" else "boa"
    _salvar_grupos(pid, g)
    return {"ok": True, "grupo": g[nome]}


@app.delete("/api/treino/projetos/{pid}/imagens/{nome}", dependencies=[Depends(auth)])
def apagar_imagem(pid: str, nome: str):
    if not IMG_RE.match(nome):
        raise HTTPException(400, "Nome inválido")
    for f in (_p(pid, "imagens", nome), _p(pid, "rotulos", nome[:-4] + ".txt")):
        if os.path.exists(f):
            os.remove(f)
    g = _grupos(pid)
    if g.pop(nome, None):
        _salvar_grupos(pid, g)
    with trava("origens-" + pid):
        o = _origens(pid)
        if o.pop(nome, None) is not None:
            _salvar_origens(pid, o)
    return {"ok": True}


RUIM_RE = re.compile(r"(^|/)(ruim|ruins|bad|defeito|defeitos|defect|defects|ng|nok|reprovad[ao]s?|anomal\w*)(/|$)", re.I)


@app.post("/api/treino/projetos/{pid}/importar", dependencies=[Depends(auth)])
async def importar(pid: str, arquivo: UploadFile = File(...)):
    """Detector: ZIP no formato YOLO (imagens + .txt de mesmo nome em labels/; classes de data.yaml ou
    classes.txt). Anomalia: ZIP com pastas boas/ e ruins/ (também good/, bad/, defeito/…); sem pasta = boa."""
    d = _proj(pid)
    raw = await arquivo.read()
    if len(raw) > 400e6:
        raise HTTPException(413, "ZIP maior que 400 MB")
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Arquivo não é um ZIP válido")
    nomes = [n for n in z.namelist() if not n.endswith("/") and "__MACOSX" not in n]
    if d["tipo"] == "anomalia":
        g = _grupos(pid)
        nb = nr = 0
        for n in nomes:
            if not n.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
                continue
            try:
                im = ImageOps.exif_transpose(Image.open(io.BytesIO(z.read(n)))).convert("RGB")
            except Exception:
                continue
            nome = _gravar_imagem(pid, im, os.path.splitext(os.path.basename(n))[0])
            ruim = bool(RUIM_RE.search(os.path.dirname(n)))
            g[nome] = "ruim" if ruim else "boa"
            nr += ruim
            nb += not ruim
        _salvar_grupos(pid, g)
        return {"imagens": nb + nr, "boas": nb, "ruins": nr, "caixas": 0, "classes": []}
    externos = []
    for n in nomes:
        b = os.path.basename(n).lower()
        if b == "classes.txt":
            externos = [x.strip() for x in z.read(n).decode("utf-8", "ignore").split("\n") if x.strip()]
        elif b in ("data.yaml", "data.yml") and not externos:
            txt = z.read(n).decode("utf-8", "ignore")
            m = re.search(r"names\s*:\s*\[([^\]]*)\]", txt)
            if m:
                externos = [x.strip().strip("'\"") for x in m.group(1).split(",") if x.strip()]
            else:
                externos = [v.strip().strip("'\"") for _k, v in re.findall(r"^\s*(\d+)\s*:\s*(.+)$", txt, re.M)]
    mapa = {}
    for i, c in enumerate(externos):
        if c not in d["classes"]:
            d["classes"].append(c[:40])
        mapa[i] = d["classes"].index(c[:40])
    _salvar(pid, d)
    rot = {os.path.splitext(os.path.basename(n))[0]: n for n in nomes if n.lower().endswith(".txt") and "/labels" in "/" + n.lower()}
    n_img = n_cx = 0
    for n in nomes:
        if not n.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
            continue
        base = os.path.splitext(os.path.basename(n))[0]
        try:
            im = ImageOps.exif_transpose(Image.open(io.BytesIO(z.read(n)))).convert("RGB")
        except Exception:
            continue
        im.thumbnail((1280, 1280))
        nome = re.sub(r"[^A-Za-z0-9_-]+", "_", base)[:60] + ".jpg"
        im.save(_p(pid, "imagens", nome), "JPEG", quality=90)
        n_img += 1
        if base in rot:
            linhas = []
            for ln in z.read(rot[base]).decode("utf-8", "ignore").split("\n"):
                pt = ln.split()
                if len(pt) == 5:
                    c = mapa.get(int(float(pt[0])), int(float(pt[0])))
                    if 0 <= c < len(d["classes"]):
                        linhas.append(" ".join([str(c)] + pt[1:]))
            with open(_p(pid, "rotulos", nome[:-4] + ".txt"), "w", encoding="utf-8") as fh:
                fh.write("\n".join(linhas) + "\n" if linhas else "")
            n_cx += len(linhas)
    return {"imagens": n_img, "caixas": n_cx, "classes": d["classes"]}


@app.get("/api/treino/projetos/{pid}/exportar", dependencies=[Depends(auth)])
def exportar(pid: str):
    d = _proj(pid)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if d["tipo"] == "anomalia":
            g = _grupos(pid)
            for n in os.listdir(_p(pid, "imagens")):
                z.write(_p(pid, "imagens", n), ("ruins/" if g.get(n) == "ruim" else "boas/") + n)
        else:
            z.writestr("classes.txt", "\n".join(d["classes"]) + "\n")
            z.writestr("data.yaml", "names: [" + ", ".join(json.dumps(c, ensure_ascii=False) for c in d["classes"]) + "]\n")
            for n in os.listdir(_p(pid, "imagens")):
                z.write(_p(pid, "imagens", n), "images/" + n)
                lf = _p(pid, "rotulos", n[:-4] + ".txt")
                if os.path.exists(lf):
                    z.write(lf, "labels/" + n[:-4] + ".txt")
        orig = _origens(pid)
        if orig:
            z.writestr("ORIGENS.csv", _origens_csv(pid, orig))
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                             headers={"Content-Disposition": f'attachment; filename="{pid}-dataset.zip"'})


COLS_ORIGEM = ("imagem", "fonte", "origem", "titulo", "autor", "licenca", "url", "capturado", "importado", "sha256")


def _linhas_origem(pid: str, orig: dict) -> list:
    imgs = set(os.listdir(_p(pid, "imagens")))
    out = []
    for n in sorted(imgs):
        m = orig.get(n) or {"fonte": "", "licenca": "não registrada (imagem anterior à v2.2 ou de ZIP)"}
        imp = m.get("importado")
        out.append({"imagem": n, "fonte": FONTES.get(m.get("fonte"), m.get("fonte", "")), "origem": m.get("origem", ""),
                    "titulo": m.get("titulo", ""), "autor": m.get("autor", ""), "licenca": m.get("licenca", ""),
                    "url": m.get("url", ""), "capturado": m.get("capturado", ""),
                    "importado": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(imp)) if imp else "",
                    "sha256": m.get("sha256", "")})
    return out


def _origens_csv(pid: str, orig: dict) -> str:
    import csv
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLS_ORIGEM)
    w.writeheader()
    for ln in _linhas_origem(pid, orig):
        # sem fórmulas no Excel/LibreOffice (=, +, -, @ no início)
        w.writerow({k: ("'" + v if isinstance(v, str) and v[:1] in "=+-@" else v) for k, v in ln.items()})
    return "\ufeff" + buf.getvalue()


@app.get("/api/treino/projetos/{pid}/origens", dependencies=[Depends(auth)])
def origens(pid: str, fmt: str = "json"):
    """Origem/licença/autor de cada imagem (atribuições): fmt=json (padrão), csv ou md."""
    d = _proj(pid)
    orig = _origens(pid)
    if fmt == "csv":
        return Response(_origens_csv(pid, orig), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{pid}-origens.csv"'})
    if fmt == "md":
        esc = lambda v: str(v).replace("|", "\\|").replace("\n", " ")
        L = [f"# Origens das imagens · {d.get('nome', pid)}", "",
             "Prints e quadros de vídeo podem ter direitos autorais de terceiros: confira antes de uso comercial.", "",
             "| Imagem | Fonte | Origem | Título | Autor/canal | Licença | Link |", "|---|---|---|---|---|---|---|"]
        for ln in _linhas_origem(pid, orig):
            L.append("| " + " | ".join(esc(ln[k]) for k in ("imagem", "fonte", "origem", "titulo", "autor", "licenca", "url")) + " |")
        return Response("\n".join(L) + "\n", media_type="text/markdown; charset=utf-8",
                        headers={"Content-Disposition": f'attachment; filename="{pid}-origens.md"'})
    return _linhas_origem(pid, orig)


# ---------------------------------------------------------------- fila de treinos
def _treinos_dir(pid):
    p = _p(pid, "treinos")
    os.makedirs(p, exist_ok=True)
    return p


def _rodando() -> bool:
    return bool(_job["proc"] and _job["proc"].poll() is None)


def _fila():
    """Treinos esperando, de todos os projetos, na ordem em que entraram: [(pid, tid, enfileirado)]."""
    out = []
    for pid in os.listdir(PROJ):
        tdir = os.path.join(PROJ, pid, "treinos")
        if not os.path.isdir(tdir):
            continue
        for tid in os.listdir(tdir):
            s = ler_json(os.path.join(tdir, tid, "status.json"), {}) or {}
            if s.get("estado") == "fila" and s.get("enfileirado"):
                out.append((pid, tid, s["enfileirado"]))
    return sorted(out, key=lambda t: (t[2], t[1]))


def _disparar():
    """Se nada está rodando, começa o próximo da fila (um treino por vez: 4 CPUs / 6 GB)."""
    with _lock:
        if _rodando():
            return
        if _job["proc"] is not None:
            _job.update(proc=None, pid=None, tid=None)
        fila = _fila()
        if not fila:
            return
        pid, tid, _ = fila[0]
        td = pasta_treino(pid, tid)
        atualizar_status(pid, tid, estado="preparando", inicio=int(time.time()))
        log = open(os.path.join(td, "log.txt"), "a", encoding="utf-8")
        _job.update(proc=subprocess.Popen([sys.executable, "/app/job.py", pid, tid], stdout=log,
                                          stderr=subprocess.STDOUT, start_new_session=True, cwd="/app",
                                          env={**os.environ, "NO_COLOR": "1", "TERM": "dumb", "COLUMNS": "110"}),
                    pid=pid, tid=tid)


def _vigia():
    while True:
        try:
            _disparar()
        except Exception as e:  # noqa: BLE001
            print("fila:", e, flush=True)
        time.sleep(3)


@app.on_event("startup")
def _iniciar_fila():
    threading.Thread(target=_vigia, daemon=True).start()


def _status(pid, tid, proj=None, fila=None, indice=None) -> dict:
    f = os.path.join(_treinos_dir(pid), tid, "status.json")
    st = ler_json(f)
    if st is None:
        return {"id": tid, "estado": "desconhecido", "nome": tid}
    st.setdefault("id", tid)
    if st.get("estado") in ATIVOS and st.get("estado") != "fila" and not (_job["tid"] == tid and _rodando()):
        st["estado"] = "interrompido"
    if st.get("estado") == "fila":
        fila = _fila() if fila is None else fila
        pos = [i for i, (p, t, _) in enumerate(fila) if p == pid and t == tid]
        st["posicao"] = pos[0] + 1 if pos else None
        st["na_frente"] = (1 if _rodando() else 0) + (pos[0] if pos else 0)
    cfg = st.setdefault("cfg", {})
    cfg.setdefault("motor", "yolo26")
    if not st.get("nome"):
        st["nome"] = nome_padrao(proj or _proj(pid), st)
        st["nome_gerado"] = True
    indice = ler_indice() if indice is None else indice
    mid = modelo_id(pid, tid)
    st["publicado"] = any(m.get("id") == mid for m in indice)
    st["modelo"] = mid
    st["tem_modelo"] = arquivo_onnx_treino(pid, tid) is not None
    st["licenca"] = LICENCAS.get(cfg["motor"])
    if st.get("estado") in ATIVOS or st.get("estado") == "erro":
        lg = os.path.join(_treinos_dir(pid), tid, "log.txt")
        if os.path.exists(lg):
            with open(lg, encoding="utf-8", errors="ignore") as fh:
                fh.seek(max(0, os.path.getsize(lg) - 6000))
                txt = ANSI_RE.sub("", fh.read())
                st["log"] = [ln for ln in txt.split("\n") if "Warning" not in ln and ln.strip()][-25:]
    return st


def _cfg(d: dict, b: dict) -> dict:
    motor = "patchcore" if d["tipo"] == "anomalia" else (b.get("motor") if b.get("motor") in ("rfdetr", "yolo26") else d["motor"])
    val = max(0.05, min(0.5, float(b.get("val") or 0.2)))
    if motor == "patchcore":
        return {"motor": motor, "backbone": "resnet18", "val": val,
                "imgsz": int(b.get("imgsz") or 256) if int(b.get("imgsz") or 256) in (224, 256, 320) else 256,
                "banco": max(1000, min(16000, int(b.get("banco") or 10000))),
                "coreset": max(0.01, min(0.5, float(b.get("coreset") or 0.1))),
                "margem": max(0.0, min(1.0, float(b.get("margem") if b.get("margem") is not None else 0.1)))}
    if motor == "rfdetr":
        var = b.get("variante") if b.get("variante") in ("nano", "small", "medium", "base") else "nano"
        div = 56 if var == "base" else 32
        imgsz = max(div * 6, min(div * 20, int(b.get("imgsz") or 384) // div * div))
        return {"motor": motor, "variante": var, "imgsz": imgsz, "val": val,
                "epocas": max(1, min(200, int(b.get("epocas") or 20))),
                "lote": max(1, min(8, int(b.get("lote") or 2))),
                "acumular": max(1, min(16, int(b.get("acumular") or 4))),
                "lr": max(1e-6, min(1e-3, float(b.get("lr") or 1e-4))),
                "paciencia": max(0, min(100, int(b.get("paciencia") if b.get("paciencia") is not None else 10)))}
    return {"motor": "yolo26", "base": b.get("base") if b.get("base") in ("yolo26n", "yolo26s") else "yolo26n",
            "epocas": max(1, min(300, int(b.get("epocas") or 50))),
            "imgsz": max(320, min(1280, int(b.get("imgsz") or 640) // 32 * 32)),
            "lote": max(1, min(32, int(b.get("lote") or 8))),
            "paciencia": max(0, min(100, int(b.get("paciencia") or 20))), "val": val}


@app.post("/api/treino/projetos/{pid}/treinar", dependencies=[Depends(auth)])
async def treinar(pid: str, request: Request):
    d = _resumo(pid)
    b = await request.json()
    cfg = _cfg(d, b)
    cfg["publicar"] = b.get("publicar", True) is not False
    nome = str(b.get("nome") or "").strip()[:100]
    if not nome:
        raise HTTPException(400, "Dê um nome ao treino (ex.: “RF-DETR nano 30 épocas, fotos de outubro”).")
    if d["tipo"] == "anomalia":
        if d["boas"] < 8:
            raise HTTPException(400, "Envie pelo menos 8 fotos de peças boas (o ideal é 30 a 200).")
    elif d["rotuladas"] < 4:
        raise HTTPException(400, "Rotule pelo menos 4 imagens (o ideal é 50+ por classe) antes de treinar.")
    with _lock:
        tid = time.strftime("%Y%m%d-%H%M%S")
        k = 1
        while os.path.exists(os.path.join(_treinos_dir(pid), tid)):
            tid = time.strftime("%Y%m%d-%H%M%S") + f"-{k}"
            k += 1
        td = os.path.join(_treinos_dir(pid), tid)
        os.makedirs(td)
        total = cfg.get("epocas", 1)
        with open(os.path.join(td, "status.json"), "w", encoding="utf-8") as fh:
            json.dump({"id": tid, "projeto": pid, "nome": nome, "nota": str(b.get("nota") or "").strip()[:500],
                       "estado": "fila", "cfg": cfg, "enfileirado": time.time(), "criado": int(time.time()),
                       "epoca": 0, "total": total, "historico": []}, fh, ensure_ascii=False)
    threading.Thread(target=_disparar, daemon=True).start()
    return _status(pid, tid)


@app.get("/api/treino/projetos/{pid}/treinos", dependencies=[Depends(auth)])
def treinos(pid: str):
    d = _proj(pid)
    fila, idx = _fila(), ler_indice()
    out = [_status(pid, t, d, fila, idx) for t in os.listdir(_treinos_dir(pid)) if TID_RE.match(t)]
    return sorted(out, key=lambda s: s["id"], reverse=True)[:100]


@app.get("/api/treino/projetos/{pid}/treinos/{tid}", dependencies=[Depends(auth)])
def treino(pid: str, tid: str):
    _tid(tid)
    return _status(pid, tid)


@app.patch("/api/treino/projetos/{pid}/treinos/{tid}", dependencies=[Depends(auth)])
async def editar_treino(pid: str, tid: str, request: Request):
    _tid(tid)
    if not os.path.isdir(pasta_treino(pid, tid)):
        raise HTTPException(404, "Treino não encontrado")
    b = await request.json()
    mud = {}
    if "nome" in b:
        nome = str(b["nome"]).strip()[:100]
        if not nome:
            raise HTTPException(400, "O nome não pode ficar vazio.")
        mud["nome"] = nome
    if "nota" in b:
        mud["nota"] = str(b["nota"] or "").strip()[:500]
    atualizar_status(pid, tid, **mud)
    if "nome" in mud:
        renomear_publicado(modelo_id(pid, tid), mud["nome"])
    return _status(pid, tid)


@app.post("/api/treino/projetos/{pid}/treinos/{tid}/cancelar", dependencies=[Depends(auth)])
def cancelar(pid: str, tid: str):
    _tid(tid)
    if _job["tid"] == tid and _job["pid"] == pid and _rodando():
        os.killpg(_job["proc"].pid, signal.SIGTERM)
        return {"ok": True}
    st = ler_json(os.path.join(pasta_treino(pid, tid), "status.json"), {}) or {}
    if st.get("estado") == "fila":
        atualizar_status(pid, tid, estado="cancelado", fim=int(time.time()))
        return {"ok": True}
    raise HTTPException(409, "Este treino não está rodando nem na fila.")


@app.delete("/api/treino/projetos/{pid}/treinos/{tid}", dependencies=[Depends(auth)])
def apagar_treino(pid: str, tid: str, despublicar: bool = False):
    _tid(tid)
    td = pasta_treino(pid, tid)
    if not os.path.isdir(td):
        raise HTTPException(404, "Treino não encontrado")
    if _job["tid"] == tid and _job["pid"] == pid and _rodando():
        raise HTTPException(409, "Cancele o treino antes de apagar.")
    mid = modelo_id(pid, tid)
    if despublicar:
        despublicar_id(mid)
    shutil.rmtree(td)
    return {"ok": True, "publicado": any(m.get("id") == mid for m in ler_indice())}


@app.post("/api/treino/projetos/{pid}/treinos/{tid}/publicar", dependencies=[Depends(auth)])
def publicar_treino(pid: str, tid: str):
    _tid(tid)
    try:
        return publicar(pid, tid)
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@app.post("/api/treino/projetos/{pid}/treinos/{tid}/despublicar", dependencies=[Depends(auth)])
def despublicar_treino(pid: str, tid: str):
    _tid(tid)
    despublicar_id(modelo_id(pid, tid))
    atualizar_status(pid, tid, publicado=False)
    return {"ok": True}


@app.get("/api/treino/projetos/{pid}/treinos/{tid}/modelo", dependencies=[Depends(auth)])
def baixar_modelo(pid: str, tid: str, fmt: str = "onnx"):
    _tid(tid)
    td = pasta_treino(pid, tid)
    if fmt == "pt":
        cands = [os.path.join(td, "run", "weights", "best.pt"), os.path.join(td, "run", "checkpoint_best_total.pth")]
        f = next((c for c in cands if os.path.exists(c)), None)
    else:
        f = arquivo_onnx_treino(pid, tid)
    if not f:
        raise HTTPException(404, "Modelo ainda não disponível")
    ext = os.path.splitext(f)[1]
    return FileResponse(f, filename=f"{pid}-{tid}{ext}")


@app.delete("/api/treino/modelos/{mid}", dependencies=[Depends(auth)])
def despublicar(mid: str):
    if not re.match(r"^[a-z0-9-]{3,80}$", mid):
        raise HTTPException(400, "Modelo inválido")
    return {"ok": True, "modelos": despublicar_id(mid)}


@app.get("/api/treino/saude")
def saude():
    return {"ok": True, "senha_configurada": bool(SENHA), "sso": bool(ADMINS)}
