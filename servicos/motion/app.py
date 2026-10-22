"""
aivision-motion — conectores de SERVIDOR do Motion 3D Studio (CV-88) do iaVision: GVHMR, ExMR e
FlowHMR como jobs de processamento de vídeo, no contrato da especificação MotionAI
(contracts/openapi.yaml: /v1/motion/* atrás de https://aivision.gplansis.com/api).

O QUE ESTE SERVIÇO FAZ (E O QUE NÃO FAZ)
  - Diz, com honestidade, o estado de cada motor (disponível, não instalado, licença pendente, não
    verificado). Nada de pesos de terceiros vem com ele; motor ausente responde HTTP 501 e NENHUM
    resultado é simulado.
  - Recebe um vídeo SÓ com consentimento explícito (cabeçalho X-Motion-Consent) e só se o motor pedido
    estiver disponível — a checagem vem ANTES de ler o corpo: sem motor, o vídeo nem é recebido.
  - Fila com um trabalhador (GPU é uma só), cancelamento, cota por usuário, expurgo automático
    (vídeo apagado ao fim do job; artefatos e sessões em até AIV_MOTION_RETER_H horas).
  - O comando de cada motor vem do servidor (motores.py), nunca do cliente.

ROTAS (prefixo /api/v1/motion — o Caddy repassa `handle /api/v1/motion/*` para 127.0.0.1:8988)
    GET    /health                      sem autenticação
    GET    /capabilities                motores e limites
    POST   /sessions                    cria sessão (metadados)               201
    GET    /sessions/{id}               sessão do usuário
    DELETE /sessions/{id}               apaga sessão, uploads e artefatos (LGPD)  204
    POST   /uploads?engine=             vídeo (multipart "video") + X-Motion-Consent   201 | 400 | 413 | 415 | 501
    POST   /jobs                        pede reconstrução                     202 | 400 | 404 | 409 | 422 | 429 | 501
    GET    /jobs/{id}                   estado e progresso
    POST   /jobs/{id}/cancel            cancela                               200 | 409
    GET    /jobs/{id}/artifacts         artefatos (JSON motionai.pose.v1)

AUTENTICAÇÃO
  Igual ao aivision-via/aivision-yt: o cabeçalho Cookie vai para a API PHP de login (AIV_ME_URL) e
  exige-se {"authenticated": true}; o usuário vem SEMPRE de /api/me, nunca do corpo. Cache de 60 s
  por hash do cookie; consultas novas limitadas por IP; 503 se o login não responder. (O contrato
  propõe bearer JWT; no iaVision a sessão é cookie HttpOnly de mesma origem — o que o próprio
  documento 04 prefere.)
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import queue
import re
import shutil
import threading
import time
import uuid
from collections import OrderedDict
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from motores import ESTADOS, MOTORES, SO_IMPORTACAO

VERSAO = "1.0.0"
ME_URL = os.environ.get("AIV_ME_URL", "https://gplansis.com/aivision-api/api/me")
DADOS = os.environ.get("AIV_MOTION_DADOS", "/dados")
MAX_UPLOAD_MB = int(os.environ.get("AIV_MOTION_MAX_MB", "300"))
MAX_CORPO_JSON = 64_000
MAX_JOBS_ATIVOS = int(os.environ.get("AIV_MOTION_MAX_JOBS", "2"))
RETER_H = float(os.environ.get("AIV_MOTION_RETER_H", "24"))
PREFIXO = "/api/v1/motion"
ID_RE = re.compile(r"^[a-z]{2,4}_[0-9a-f]{32}$")
log = logging.getLogger("aivision-motion")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
ROTULO = {"disponivel": "disponível", "nao_instalado": "não instalado", "licenca_pendente": "licença pendente", "nao_verificado": "não verificado"}

app = FastAPI(title="aivision-motion", version=VERSAO, docs_url=None, redoc_url=None, openapi_url=None)
_http = httpx.Client(timeout=10, follow_redirects=False)


# ------------------------------------------------------------------ utilidades (as do aivision-via)

class TTLCache:
    def __init__(self, maximo: int):
        self.maximo = maximo
        self.d: OrderedDict = OrderedDict()
        self.lock = threading.Lock()

    def get(self, k):
        with self.lock:
            v = self.d.get(k)
            if not v:
                return None
            if v[0] < time.monotonic():
                self.d.pop(k, None)
                return None
            self.d.move_to_end(k)
            return v[1]

    def put(self, k, valor, ttl: float):
        with self.lock:
            self.d[k] = (time.monotonic() + ttl, valor)
            self.d.move_to_end(k)
            while len(self.d) > self.maximo:
                self.d.popitem(last=False)


class Limite:
    def __init__(self, n: int, janela: float = 60):
        self.n, self.janela = n, janela
        self.d: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def checar(self, ip: str):
        agora = time.monotonic()
        with self.lock:
            if len(self.d) > 5000:
                self.d = {k: v for k, v in self.d.items() if v and v[-1] > agora - self.janela}
            l = [t for t in self.d.get(ip, []) if t > agora - self.janela]
            if len(l) >= self.n:
                self.d[ip] = l
                raise HTTPException(429, "Muitas chamadas seguidas. Espere um minuto e tente de novo.")
            l.append(agora)
            self.d[ip] = l


def ip_de(req: Request) -> str:
    xff = req.headers.get("x-forwarded-for", "")
    return (xff.split(",")[0].strip() if xff else "") or (req.client.host if req.client else "?")


def novo_id(prefixo: str) -> str:
    return f"{prefixo}_{uuid.uuid4().hex}"


# ------------------------------------------------------------------ autenticação

_sessoes_login = TTLCache(2000)
_lim_login = Limite(30)
_lim_leitura = Limite(240)
_lim_escrita = Limite(60)
_lim_upload = Limite(6)


class LoginIndisponivel(Exception):
    pass


def validar_cookie(cookie: str, ip: str = "") -> Optional[dict]:
    if not cookie:
        return None
    chave = hashlib.sha256(cookie.encode()).hexdigest()
    em_cache = _sessoes_login.get(chave)
    if em_cache is not None:
        return em_cache or None
    _lim_login.checar(ip or "?")
    try:
        h = {"Cookie": cookie, "Accept": "application/json"}
        if ip:
            h["X-Forwarded-For"] = ip
            h["X-Real-IP"] = ip
        r = _http.get(ME_URL, headers=h)
    except httpx.HTTPError as e:
        raise LoginIndisponivel() from e
    if r.status_code != 200:
        raise LoginIndisponivel()
    try:
        corpo = r.json()
    except ValueError as e:
        raise LoginIndisponivel() from e
    if not isinstance(corpo, dict):
        raise LoginIndisponivel()
    u = corpo.get("user") if corpo.get("authenticated") is True else None
    eu = None
    if isinstance(u, dict):
        email = "".join(str(u.get("email") or "").split()).lower()
        uid = str(u.get("id") if u.get("id") is not None else email)[:120]
        if uid:
            # pseudônimo estável nos logs e nos diretórios (sem e-mail em claro)
            eu = {"id": uid, "pseud": hashlib.sha256(("aivm:" + uid).encode()).hexdigest()[:16]}
    _sessoes_login.put(chave, eu or False, 60 if eu else 10)
    return eu


def usuario(req: Request) -> dict:
    ip = ip_de(req)
    try:
        u = validar_cookie(req.headers.get("cookie", ""), ip)
    except LoginIndisponivel:
        raise HTTPException(503, "O login do iaVision não respondeu agora. Tente de novo em instantes.")
    if not u:
        raise HTTPException(401, "Entre no iaVision para usar os motores de servidor do Motion 3D Studio.")
    return {**u, "ip": ip}


def leitura(u: dict = Depends(usuario)) -> dict:
    _lim_leitura.checar(u["ip"])
    return u


def escrita(u: dict = Depends(usuario)) -> dict:
    _lim_escrita.checar(u["ip"])
    return u


@app.middleware("http")
async def limite_corpo(request: Request, call_next):
    n = request.headers.get("content-length")
    limite = MAX_UPLOAD_MB * 1024 * 1024 + 64_000 if request.url.path.endswith("/uploads") else MAX_CORPO_JSON
    if n and n.isdigit() and int(n) > limite:
        return JSONResponse({"detail": f"Pedido grande demais (máximo {MAX_UPLOAD_MB} MB para vídeo)."}, status_code=413)
    resp = await call_next(request)
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    return resp


# ------------------------------------------------------------------ estado (memória + disco)

_lock = threading.Lock()
SESSOES: dict[str, dict] = {}
UPLOADS: dict[str, dict] = {}
JOBS: dict[str, dict] = {}
IDEMP: dict[tuple, str] = {}
FILA: "queue.Queue[str]" = queue.Queue()


def _dir_usuario(u: dict, tipo: str) -> str:
    d = os.path.join(DADOS, tipo, u["pseud"])
    os.makedirs(d, mode=0o700, exist_ok=True)
    return d


def _dono(obj: Optional[dict], u: dict, oque: str) -> dict:
    if not obj or obj["dono"] != u["id"]:
        raise HTTPException(404, f"{oque} não encontrado.")
    return obj


def _estado_motor(mid: str) -> tuple[str, str]:
    m = MOTORES.get(mid)
    return m.estado() if m else ("nao_instalado", "")


def _publico_job(j: dict) -> dict:
    return {"job_id": j["id"], "status": j["status"], "engine": j["engine"], "percent_complete": j["pct"],
            "session_id": j["session_id"], "created_at": j["criado"], "error": j.get("erro"),
            "artifacts": [{"artifact_id": a["id"], "kind": a["tipo"], "bytes": a["bytes"]} for a in j["artefatos"]]}


def _expurgar():
    """Apaga o que passou do prazo (sessões, uploads, artefatos). Roda no trabalhador."""
    limite = time.time() - RETER_H * 3600
    with _lock:
        for uid, up in list(UPLOADS.items()):
            if up["t"] < limite:
                _apagar_arquivo(up["caminho"])
                UPLOADS.pop(uid, None)
        for jid, j in list(JOBS.items()):
            if j["t"] < limite and j["status"] in ("completed", "failed", "canceled"):
                shutil.rmtree(j["dir"], ignore_errors=True)
                JOBS.pop(jid, None)
        for sid, s in list(SESSOES.items()):
            if s["t"] < limite:
                SESSOES.pop(sid, None)


def _apagar_arquivo(p: str):
    try:
        os.remove(p)
    except OSError:
        pass


def _trabalhador():
    while True:
        try:
            jid = FILA.get(timeout=300)
        except queue.Empty:
            _expurgar()
            continue
        with _lock:
            j = JOBS.get(jid)
            if not j or j["status"] != "queued":
                continue
            j["status"], j["pct"] = "running", 5
        t0 = time.monotonic()
        try:
            motor = MOTORES[j["engine"]]
            estado, _ = motor.estado()
            if estado != "disponivel":
                raise RuntimeError("o motor deixou de estar disponível")
            up = UPLOADS.get(j["input_artifact_id"])
            if not up:
                raise RuntimeError("o vídeo de entrada expirou")
            os.makedirs(j["dir"], mode=0o700, exist_ok=True)
            saida = motor.executar(up["caminho"], j["dir"])
            with open(saida, encoding="utf-8") as f:
                conteudo = json.load(f)   # só confere que é JSON; a validação de contrato é do Studio ao importar
            with _lock:
                if j["status"] == "canceled":
                    continue
                j["artefatos"].append({"id": novo_id("art"), "tipo": "motionai.take+json", "caminho": saida, "bytes": os.path.getsize(saida)})
                j["status"], j["pct"] = "completed", 100
            del conteudo
        except Exception as e:  # noqa: BLE001 — o job falha com mensagem genérica, sem vazar caminho
            with _lock:
                if j["status"] != "canceled":
                    j["status"], j["erro"] = "failed", str(e)[:200]
        finally:
            # o vídeo sai do servidor assim que o job termina (minimização)
            up = UPLOADS.pop(j["input_artifact_id"], None)
            if up:
                _apagar_arquivo(up["caminho"])
            log.info("job=%s engine=%s user=%s status=%s duration_ms=%d", jid, j["engine"], j["pseud"], j["status"], (time.monotonic() - t0) * 1000)
        _expurgar()


_t = threading.Thread(target=_trabalhador, name="motion-worker", daemon=True)
_t.start()


# ------------------------------------------------------------------ rotas

@app.get(PREFIXO + "/health")
def health():
    disponiveis = [k for k, m in MOTORES.items() if m.estado()[0] == "disponivel"]
    return {"status": "ok", "version": VERSAO, "real_inference": bool(disponiveis), "engines_available": disponiveis}


@app.get(PREFIXO + "/capabilities")
def capabilities(u: dict = Depends(leitura)):
    engines = {}
    for k, m in MOTORES.items():
        st, det = m.estado()
        engines[k] = {"status": st, "detail": det, "version": m.versao() if st == "disponivel" else None, "name": m.nome,
                      "license": m.licenca, "repository": m.repositorio, "role": m.papel, "mode": "offline_gpu_video"}
    for k, det in SO_IMPORTACAO.items():
        engines[k] = {"status": "import_only", "detail": det, "name": "FreeMoCap", "mode": "multicamera_external"}
    engines["mediapipe"] = {"status": "browser", "detail": "BlazePose 3D roda no navegador (ORT-web), nunca aqui.", "name": "BlazePose / MediaPipe Pose", "mode": "live"}
    return {"version": VERSAO, "engines": engines, "states": list(ESTADOS),
            "limits": {"max_upload_mb": MAX_UPLOAD_MB, "max_active_jobs": MAX_JOBS_ATIVOS, "retention_hours": RETER_H}}


class NovaSessao(BaseModel):
    source_id: str = Field(min_length=1, max_length=120)
    display_name: Optional[str] = Field(default=None, max_length=120)


@app.post(PREFIXO + "/sessions", status_code=201)
def criar_sessao(s: NovaSessao, u: dict = Depends(escrita)):
    sid = novo_id("ses")
    with _lock:
        if sum(1 for x in SESSOES.values() if x["dono"] == u["id"]) >= 200:
            raise HTTPException(429, "Sessões demais abertas; apague as antigas.")
        SESSOES[sid] = {"id": sid, "dono": u["id"], "source_id": s.source_id, "nome": s.display_name, "t": time.time(),
                        "criado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    return {"session_id": sid}


@app.get(PREFIXO + "/sessions/{session_id}")
def ler_sessao(session_id: str, u: dict = Depends(leitura)):
    if not ID_RE.match(session_id):
        raise HTTPException(400, "Identificador inválido.")
    s = _dono(SESSOES.get(session_id), u, "Sessão")
    jobs = [_publico_job(j) for j in JOBS.values() if j["session_id"] == session_id and j["dono"] == u["id"]]
    return {"session_id": s["id"], "source_id": s["source_id"], "display_name": s["nome"], "created_at": s["criado"], "jobs": jobs}


@app.delete(PREFIXO + "/sessions/{session_id}", status_code=204)
def apagar_sessao(session_id: str, u: dict = Depends(escrita)):
    if not ID_RE.match(session_id):
        raise HTTPException(400, "Identificador inválido.")
    with _lock:
        _dono(SESSOES.get(session_id), u, "Sessão")
        for jid, j in list(JOBS.items()):
            if j["session_id"] == session_id and j["dono"] == u["id"]:
                j["status"] = "canceled" if j["status"] in ("queued", "running") else j["status"]
                shutil.rmtree(j["dir"], ignore_errors=True)
                JOBS.pop(jid, None)
        for aid, up in list(UPLOADS.items()):
            if up.get("session_id") == session_id and up["dono"] == u["id"]:
                _apagar_arquivo(up["caminho"])
                UPLOADS.pop(aid, None)
        SESSOES.pop(session_id, None)
    return Response(status_code=204)


ASSINATURAS = [(4, b"ftyp", "mp4"), (0, b"\x1aE\xdf\xa3", "webm"), (0, b"RIFF", "avi")]


@app.post(PREFIXO + "/uploads", status_code=201)
async def upload(request: Request, engine: str = "", session_id: str = "", u: dict = Depends(usuario)):
    _lim_upload.checar(u["ip"])
    if engine not in MOTORES:
        raise HTTPException(422, "Motor desconhecido (gvhmr, exmr ou flowhmr).")
    consentimento = request.headers.get("x-motion-consent", "").strip()
    if not consentimento:
        raise HTTPException(400, "Sem consentimento explícito: o vídeo não foi recebido.")
    estado, det = _estado_motor(engine)
    if estado != "disponivel":
        # antes de ler o corpo: sem motor, o vídeo nem entra no servidor
        raise HTTPException(501, f"{MOTORES[engine].nome}: {ROTULO.get(estado, estado)}. {det} O vídeo não foi recebido.")
    try:
        form = await request.form(max_files=1, max_fields=4, max_part_size=MAX_UPLOAD_MB * 1024 * 1024)
    except Exception:  # noqa: BLE001 — multipart malformado ou parte grande demais
        raise HTTPException(413, f"Vídeo grande demais ou envio malformado (máximo {MAX_UPLOAD_MB} MB).")
    arq = form.get("video")
    if arq is None or not hasattr(arq, "read"):
        raise HTTPException(400, "Envie o arquivo no campo 'video'.")
    cab = await arq.read(16)
    tipo = next((t for off, sig, t in ASSINATURAS if cab[off:off + len(sig)] == sig), None)
    if not tipo:
        await form.close()
        raise HTTPException(415, "Formato não reconhecido: envie MP4/MOV, WebM/MKV ou AVI.")
    aid = novo_id("upl")
    destino = os.path.join(_dir_usuario(u, "uploads"), f"{aid}.{tipo}")
    total = len(cab)
    with open(destino, "wb") as f:
        os.chmod(destino, 0o600)
        f.write(cab)
        while True:
            bloco = await arq.read(1 << 20)
            if not bloco:
                break
            total += len(bloco)
            if total > MAX_UPLOAD_MB * 1024 * 1024:
                f.close()
                _apagar_arquivo(destino)
                await form.close()
                raise HTTPException(413, f"Vídeo grande demais (máximo {MAX_UPLOAD_MB} MB).")
            f.write(bloco)
    await form.close()
    with _lock:
        UPLOADS[aid] = {"id": aid, "dono": u["id"], "caminho": destino, "bytes": total, "t": time.time(), "engine": engine,
                        "consentimento": consentimento[:120], "session_id": session_id if ID_RE.match(session_id or "") else None}
    log.info("upload=%s engine=%s user=%s bytes=%d consent=yes", aid, engine, u["pseud"], total)
    return {"artifact_id": aid, "bytes": total, "kind": tipo}


class PedidoJob(BaseModel):
    session_id: str = Field(min_length=1, max_length=80)
    engine: str = Field(min_length=1, max_length=20)
    input_artifact_id: str = Field(min_length=1, max_length=80)
    consent_reference: str = Field(default="", max_length=120)
    idempotency_key: Optional[str] = Field(default=None, max_length=200)
    requested_output: list[str] = Field(default_factory=list, max_length=8)


@app.post(PREFIXO + "/jobs", status_code=202)
def criar_job(p: PedidoJob, u: dict = Depends(escrita)):
    if p.engine in SO_IMPORTACAO:
        raise HTTPException(501, SO_IMPORTACAO[p.engine])
    if p.engine not in MOTORES:
        raise HTTPException(422, "Motor desconhecido (gvhmr, exmr ou flowhmr).")
    if not p.consent_reference.strip():
        raise HTTPException(400, "Sem referência de consentimento: o job não foi criado.")
    estado, det = _estado_motor(p.engine)
    if estado != "disponivel":
        raise HTTPException(501, f"{MOTORES[p.engine].nome}: {ROTULO.get(estado, estado)}. {det} Nenhum resultado é simulado.")
    chave = (u["id"], p.idempotency_key) if p.idempotency_key else None
    with _lock:
        if chave and chave in IDEMP and IDEMP[chave] in JOBS:
            return _publico_job(JOBS[IDEMP[chave]])
        up = UPLOADS.get(p.input_artifact_id)
        if not up or up["dono"] != u["id"]:
            raise HTTPException(404, "Vídeo de entrada não encontrado (envie em /uploads antes).")
        if up["engine"] != p.engine:
            raise HTTPException(409, "O vídeo foi enviado para outro motor.")
        ativos = sum(1 for j in JOBS.values() if j["dono"] == u["id"] and j["status"] in ("queued", "running"))
        if ativos >= MAX_JOBS_ATIVOS:
            raise HTTPException(429, f"Já há {ativos} job(s) seus na fila; espere terminar.")
        jid = novo_id("job")
        JOBS[jid] = {"id": jid, "dono": u["id"], "pseud": u["pseud"], "engine": p.engine, "session_id": p.session_id,
                     "input_artifact_id": p.input_artifact_id, "status": "queued", "pct": 0, "artefatos": [], "t": time.time(),
                     "criado": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "dir": os.path.join(_dir_usuario(u, "jobs"), jid),
                     "consentimento": p.consent_reference[:120], "saidas": p.requested_output}
        if chave:
            IDEMP[chave] = jid
    FILA.put(jid)
    return _publico_job(JOBS[jid])


def _job_do(job_id: str, u: dict) -> dict:
    if not ID_RE.match(job_id):
        raise HTTPException(400, "Identificador inválido.")
    return _dono(JOBS.get(job_id), u, "Job")


@app.get(PREFIXO + "/jobs/{job_id}")
def ler_job(job_id: str, u: dict = Depends(leitura)):
    return _publico_job(_job_do(job_id, u))


@app.post(PREFIXO + "/jobs/{job_id}/cancel")
def cancelar_job(job_id: str, u: dict = Depends(escrita)):
    with _lock:
        j = _job_do(job_id, u)
        if j["status"] not in ("queued", "running"):
            raise HTTPException(409, f"O job já está {j['status']}.")
        j["status"] = "canceled"
    return _publico_job(j)


@app.get(PREFIXO + "/jobs/{job_id}/artifacts")
def artefatos(job_id: str, u: dict = Depends(leitura)):
    j = _job_do(job_id, u)
    return {"job_id": j["id"], "status": j["status"], "artifacts": [{"artifact_id": a["id"], "kind": a["tipo"], "bytes": a["bytes"]} for a in j["artefatos"]]}


@app.get(PREFIXO + "/jobs/{job_id}/artifacts/{artifact_id}")
def baixar_artefato(job_id: str, artifact_id: str, u: dict = Depends(leitura)):
    j = _job_do(job_id, u)
    a = next((x for x in j["artefatos"] if x["id"] == artifact_id), None)
    if not a:
        raise HTTPException(404, "Artefato não encontrado.")
    with open(a["caminho"], "rb") as f:
        return Response(f.read(), media_type="application/json")


@app.exception_handler(HTTPException)
async def erro_http(request: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers={"Cache-Control": "no-store"})

