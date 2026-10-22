"""
aivision-via — memória da Via (assistente de IA do iaVision): conversas e base de conhecimento.

O QUE ESTE SERVIÇO GUARDA (E O QUE NÃO GUARDA)
  A conversa com a IA continua indo DIRETO do navegador para a Anthropic, com a chave do usuário.
  Depois de cada turno, se o usuário deixou ligado «Salvar conversas no servidor da GPlanSiS», o
  navegador manda para cá o texto da pergunta e da resposta, os comandos propostos e os METADADOS
  das imagens anexadas (sha256, largura, altura). Nunca a imagem, nunca a chave: qualquer campo com
  cara de chave da Anthropic («sk-ant-…») é recusado.

    POST   /api/via/registro                 grava um turno (pergunta, resposta, comandos, anexos)
    PATCH  /api/via/comandos/{id}            marca um comando como aplicado/salvo
    POST   /api/via/anexos/treinar           anota para qual projeto do Treinar foram as imagens
    POST   /api/via/conhecimento             salva um trecho na base («Salvar na base»)
    GET    /api/via/conhecimento             lista o que o usuário vê (os dele + os compartilhados)
    PATCH  /api/via/conhecimento/{id}        compartilhar / deixar de compartilhar (só admin)
    DELETE /api/via/conhecimento/{id}        apaga (o dono; admin também apaga compartilhados)
    GET    /api/via/busca?q=&n=              RAG: full-text português sem acento + trigram
    GET    /api/via/historico                conversas do usuário
    GET    /api/via/historico/{id}           mensagens de uma conversa
    DELETE /api/via/historico/{id}           apaga uma conversa (LGPD)
    DELETE /api/via/historico                apaga TODAS as conversas do usuário (LGPD)
    GET    /api/via/eu                       {email, admin}
    GET    /api/via/saude                    sem autenticação

AUTENTICAÇÃO
  Igual ao aivision-yt: o cabeçalho Cookie é repassado para a API PHP de login (AIV_ME_URL); exige-se
  {"authenticated": true}. O usuário (id e e-mail) vem SEMPRE de /api/me — nunca do corpo do pedido.
  Cache de 60 s por hash do cookie; consultas novas limitadas por IP; 503 se o login não responder.
  Admins (podem compartilhar itens da base com todos): e-mails em AIV_VIA_ADMINS (vírgulas).
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from collections import OrderedDict
from typing import Any, Optional

import httpx
import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel, Field

ME_URL = os.environ.get("AIV_ME_URL", "https://gplansis.com/aivision-api/api/me")
ADMINS = {e.strip().lower() for e in os.environ.get("AIV_VIA_ADMINS", "").split(",") if e.strip()}
EMBEDDINGS = os.environ.get("AIV_VIA_EMBEDDINGS", "0") == "1"   # próximo passo; desligado
DSN = "host={h} port=5432 dbname={d} user={u} password={p} connect_timeout=5".format(
    h=os.environ.get("VIA_DB_HOST", "db"), d=os.environ.get("VIA_DB_NOME", "via"),
    u=os.environ.get("VIA_DB_USUARIO", "via"), p=os.environ.get("VIA_DB_SENHA", ""))
MAX_CORPO = 2_000_000          # o Caddy deixa passar 20 MB; aqui um turno de texto não passa de 2 MB
CHAVE_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}")
SHA_RE = r"^[0-9a-f]{64}$"

app = FastAPI(title="aivision-via", docs_url=None, redoc_url=None, openapi_url=None)
_http = httpx.Client(timeout=10, follow_redirects=False)
pool = ConnectionPool(DSN, min_size=1, max_size=6, open=False, kwargs={"row_factory": dict_row, "autocommit": False})


# ------------------------------------------------------------------ utilidades (mesmas do aivision-yt)

class TTLCache:
    """Cache LRU com validade por item. Thread-safe (FastAPI roda `def` num pool)."""

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
    """Janela deslizante por IP: no máximo `n` chamadas em `janela` segundos."""

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


def sem_chave(obj: Any):
    """Recusa qualquer texto com cara de chave da Anthropic, em qualquer campo."""
    if isinstance(obj, str):
        if CHAVE_RE.search(obj):
            raise HTTPException(400, "Isto parece uma chave de API (sk-ant-…). Chaves não são guardadas aqui.")
    elif isinstance(obj, dict):
        for v in obj.values():
            sem_chave(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            sem_chave(v)


# ------------------------------------------------------------------ autenticação

_sessoes = TTLCache(2000)
_lim_login = Limite(30)       # consultas NOVAS à API de login por IP/min (cookie fora do cache)
_lim_escrita = Limite(90)
_lim_leitura = Limite(240)


class LoginIndisponivel(Exception):
    """A API PHP de login não respondeu direito: não é «não logado», é «não deu para saber»."""


def validar_cookie(cookie: str, ip: str = "") -> Optional[dict]:
    """{id, email, admin} se o cookie é de uma sessão válida; None se não. Cache: 60 s / 10 s."""
    if not cookie:
        return None
    chave = hashlib.sha256(cookie.encode()).hexdigest()
    em_cache = _sessoes.get(chave)
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
            eu = {"id": uid, "email": email[:200], "admin": bool(email) and email in ADMINS}
    _sessoes.put(chave, eu or False, 60 if eu else 10)
    return eu


def usuario(req: Request) -> dict:
    ip = ip_de(req)
    try:
        u = validar_cookie(req.headers.get("cookie", ""), ip)
    except LoginIndisponivel:
        raise HTTPException(503, "O login do iaVision não respondeu agora. Tente de novo em instantes.")
    if not u:
        raise HTTPException(401, "Entre no iaVision para usar a memória da Via.")
    return {**u, "ip": ip}


def escrita(u: dict = Depends(usuario)) -> dict:
    _lim_escrita.checar(u["ip"])
    return u


def leitura(u: dict = Depends(usuario)) -> dict:
    _lim_leitura.checar(u["ip"])
    return u


@app.middleware("http")
async def limite_corpo(request: Request, call_next):
    n = request.headers.get("content-length")
    if n and n.isdigit() and int(n) > MAX_CORPO:
        return JSONResponse({"detail": "Pedido grande demais."}, status_code=413)
    return await call_next(request)


# ------------------------------------------------------------------ banco

def _migrar():
    """Aplica schema.sql (idempotente) com trava consultiva; espera o Postgres subir."""
    sql = open(os.path.join(os.path.dirname(__file__), "schema.sql"), encoding="utf-8").read()
    for tentativa in range(60):
        try:
            with psycopg.connect(DSN, autocommit=True) as c:
                c.execute("SELECT pg_advisory_lock(7130001)")
                try:
                    c.execute(sql)
                finally:
                    c.execute("SELECT pg_advisory_unlock(7130001)")
            return
        except psycopg.OperationalError:
            time.sleep(2)
    raise RuntimeError("Postgres não respondeu em 2 minutos")


@app.on_event("startup")
def _iniciar():
    _migrar()
    pool.open(wait=True, timeout=30)


@app.on_event("shutdown")
def _parar():
    pool.close()


# ------------------------------------------------------------------ modelos de entrada

class Comando(BaseModel):
    op: str = Field(..., min_length=1, max_length=80)
    parametro: Optional[str] = Field(None, max_length=80)
    valor: str = Field("", max_length=5000)
    aplicado: bool = False
    salvo: bool = False


class Anexo(BaseModel):
    sha256: str = Field(..., pattern=SHA_RE)
    largura: Optional[int] = Field(None, ge=1, le=20000)
    altura: Optional[int] = Field(None, ge=1, le=20000)


class Registro(BaseModel):
    conversa_id: Optional[int] = None
    titulo: str = Field("", max_length=200)
    pergunta: str = Field(..., max_length=20000)
    resposta: str = Field("", max_length=100000)
    modelo: Optional[str] = Field(None, max_length=80)
    tokens_in: Optional[int] = Field(None, ge=0, le=10_000_000)
    tokens_out: Optional[int] = Field(None, ge=0, le=10_000_000)
    comandos: list[Comando] = Field(default_factory=list, max_length=50)
    anexos: list[Anexo] = Field(default_factory=list, max_length=8)


class MarcaComando(BaseModel):
    aplicado: Optional[bool] = None
    salvo: Optional[bool] = None


class AnexosTreinar(BaseModel):
    sha256: list[str] = Field(..., min_length=1, max_length=8)
    projeto: str = Field(..., pattern=r"^[a-z0-9][a-z0-9-]{1,40}$")


class Conhecimento(BaseModel):
    titulo: str = Field(..., min_length=1, max_length=200)
    texto: str = Field(..., min_length=1, max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=12)
    compartilhado: bool = False
    origem_mensagem_id: Optional[int] = None


class Compartilhar(BaseModel):
    compartilhado: bool


def _tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        t = " ".join(str(t).split())[:40].lower()
        if t and t not in out:
            out.append(t)
    return out


# ------------------------------------------------------------------ conversas

@app.post("/api/via/registro")
def registro(b: Registro, u: dict = Depends(escrita)):
    d = b.model_dump()
    sem_chave(d)
    with pool.connection() as c:
        cid = b.conversa_id
        if cid is not None:
            r = c.execute("SELECT id FROM conversas WHERE id = %s AND usuario_id = %s", (cid, u["id"])).fetchone()
            if not r:
                raise HTTPException(404, "Conversa não encontrada.")
        else:
            titulo = " ".join((b.titulo or b.pergunta).split())[:120]
            cid = c.execute("INSERT INTO conversas (usuario_id, email, titulo) VALUES (%s, %s, %s) RETURNING id",
                            (u["id"], u["email"], titulo)).fetchone()["id"]
        mu = c.execute("INSERT INTO mensagens (conversa_id, papel, texto) VALUES (%s, 'user', %s) RETURNING id",
                       (cid, b.pergunta)).fetchone()["id"]
        mv = c.execute("INSERT INTO mensagens (conversa_id, papel, texto, modelo, tokens_in, tokens_out) "
                       "VALUES (%s, 'assistant', %s, %s, %s, %s) RETURNING id",
                       (cid, b.resposta, b.modelo, b.tokens_in, b.tokens_out)).fetchone()["id"]
        ids_cmd = [c.execute("INSERT INTO comandos (mensagem_id, op, parametro, valor, aplicado, salvo) "
                             "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                             (mv, k.op, k.parametro, k.valor, k.aplicado, k.salvo)).fetchone()["id"] for k in b.comandos]
        ids_anx = [c.execute("INSERT INTO anexos (mensagem_id, sha256, largura, altura) VALUES (%s, %s, %s, %s) RETURNING id",
                             (mu, a.sha256, a.largura, a.altura)).fetchone()["id"] for a in b.anexos]
    return {"conversa_id": cid, "mensagem_usuario_id": mu, "mensagem_via_id": mv, "comandos": ids_cmd, "anexos": ids_anx}


@app.patch("/api/via/comandos/{cid}")
def marcar_comando(cid: int, b: MarcaComando, u: dict = Depends(escrita)):
    with pool.connection() as c:
        r = c.execute("""UPDATE comandos k SET aplicado = coalesce(%s, k.aplicado), salvo = coalesce(%s, k.salvo)
                           FROM mensagens m JOIN conversas v ON v.id = m.conversa_id
                          WHERE k.id = %s AND m.id = k.mensagem_id AND v.usuario_id = %s
                      RETURNING k.id, k.aplicado, k.salvo""", (b.aplicado, b.salvo, cid, u["id"])).fetchone()
    if not r:
        raise HTTPException(404, "Comando não encontrado.")
    return r


@app.post("/api/via/anexos/treinar")
def anexos_treinar(b: AnexosTreinar, u: dict = Depends(escrita)):
    shas = [s for s in b.sha256 if re.match(SHA_RE, s)]
    with pool.connection() as c:
        n = c.execute("""UPDATE anexos a SET enviado_treinar_projeto = %s
                           FROM mensagens m JOIN conversas v ON v.id = m.conversa_id
                          WHERE a.mensagem_id = m.id AND v.usuario_id = %s AND a.sha256 = ANY(%s)""",
                      (b.projeto, u["id"], shas)).rowcount
    return {"atualizados": n}


@app.get("/api/via/historico")
def historico(limite: int = Query(30, ge=1, le=200), u: dict = Depends(leitura)):
    with pool.connection() as c:
        rs = c.execute("""SELECT v.id, v.titulo, v.criada_em, count(m.id) AS mensagens, max(m.criada_em) AS ultima
                            FROM conversas v LEFT JOIN mensagens m ON m.conversa_id = v.id
                           WHERE v.usuario_id = %s GROUP BY v.id ORDER BY max(m.criada_em) DESC NULLS LAST LIMIT %s""",
                       (u["id"], limite)).fetchall()
        total = c.execute("SELECT count(*) AS n FROM conversas WHERE usuario_id = %s", (u["id"],)).fetchone()["n"]
    return {"total": total, "conversas": rs}


@app.get("/api/via/historico/{cid}")
def conversa(cid: int, u: dict = Depends(leitura)):
    with pool.connection() as c:
        v = c.execute("SELECT id, titulo, criada_em FROM conversas WHERE id = %s AND usuario_id = %s", (cid, u["id"])).fetchone()
        if not v:
            raise HTTPException(404, "Conversa não encontrada.")
        ms = c.execute("""SELECT m.id, m.papel, m.texto, m.modelo, m.tokens_in, m.tokens_out, m.criada_em,
                                 coalesce((SELECT json_agg(json_build_object('id', k.id, 'op', k.op, 'parametro', k.parametro,
                                          'valor', k.valor, 'aplicado', k.aplicado, 'salvo', k.salvo) ORDER BY k.id)
                                           FROM comandos k WHERE k.mensagem_id = m.id), '[]') AS comandos,
                                 coalesce((SELECT json_agg(json_build_object('sha256', a.sha256, 'largura', a.largura,
                                          'altura', a.altura, 'enviado_treinar_projeto', a.enviado_treinar_projeto) ORDER BY a.id)
                                           FROM anexos a WHERE a.mensagem_id = m.id), '[]') AS anexos
                            FROM mensagens m WHERE m.conversa_id = %s ORDER BY m.id""", (cid,)).fetchall()
    return {**v, "mensagens": ms}


@app.delete("/api/via/historico/{cid}")
def apagar_conversa(cid: int, u: dict = Depends(escrita)):
    with pool.connection() as c:
        n = c.execute("DELETE FROM conversas WHERE id = %s AND usuario_id = %s", (cid, u["id"])).rowcount
    if not n:
        raise HTTPException(404, "Conversa não encontrada.")
    return {"ok": True}


@app.delete("/api/via/historico")
def apagar_todas(u: dict = Depends(escrita)):
    with pool.connection() as c:
        n = c.execute("DELETE FROM conversas WHERE usuario_id = %s", (u["id"],)).rowcount
    return {"ok": True, "apagadas": n}


# ------------------------------------------------------------------ base de conhecimento

COLS = "id, titulo, texto, tags, compartilhado, aprovado_por, criado_em, origem_mensagem_id, (usuario_id = %s) AS meu"


@app.post("/api/via/conhecimento")
def salvar_conhecimento(b: Conhecimento, u: dict = Depends(escrita)):
    sem_chave(b.model_dump())
    if b.compartilhado and not u["admin"]:
        raise HTTPException(403, "Só um administrador pode compartilhar itens da base com todos.")
    with pool.connection() as c:
        origem = None
        if b.origem_mensagem_id is not None:
            r = c.execute("""SELECT m.id FROM mensagens m JOIN conversas v ON v.id = m.conversa_id
                              WHERE m.id = %s AND v.usuario_id = %s""", (b.origem_mensagem_id, u["id"])).fetchone()
            origem = r["id"] if r else None
        r = c.execute(f"""INSERT INTO conhecimento (usuario_id, email, origem_mensagem_id, titulo, texto, tags,
                                                    compartilhado, aprovado_por)
                          VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING {COLS}""",
                      (u["id"], u["email"], origem, " ".join(b.titulo.split()), b.texto.strip(), _tags(b.tags),
                       b.compartilhado, u["email"] if b.compartilhado else None, u["id"])).fetchone()
    return r


@app.get("/api/via/conhecimento")
def listar_conhecimento(escopo: str = Query("todos", pattern="^(meus|todos)$"), limite: int = Query(100, ge=1, le=300),
                        u: dict = Depends(leitura)):
    filtro = "usuario_id = %s" if escopo == "meus" else "(usuario_id = %s OR compartilhado)"
    with pool.connection() as c:
        rs = c.execute(f"SELECT {COLS} FROM conhecimento WHERE {filtro} ORDER BY criado_em DESC LIMIT %s",
                       (u["id"], u["id"], limite)).fetchall()
    return rs


@app.patch("/api/via/conhecimento/{kid}")
def compartilhar(kid: int, b: Compartilhar, u: dict = Depends(escrita)):
    if not u["admin"]:
        raise HTTPException(403, "Só um administrador pode compartilhar itens da base com todos.")
    with pool.connection() as c:
        r = c.execute(f"""UPDATE conhecimento SET compartilhado = %s, aprovado_por = CASE WHEN %s THEN %s ELSE NULL END
                           WHERE id = %s AND (usuario_id = %s OR compartilhado) RETURNING {COLS}""",
                      (b.compartilhado, b.compartilhado, u["email"], kid, u["id"], u["id"])).fetchone()
    if not r:
        raise HTTPException(404, "Item não encontrado.")
    return r


@app.delete("/api/via/conhecimento/{kid}")
def apagar_conhecimento(kid: int, u: dict = Depends(escrita)):
    with pool.connection() as c:
        n = c.execute("DELETE FROM conhecimento WHERE id = %s AND (usuario_id = %s OR (%s AND compartilhado))",
                      (kid, u["id"], u["admin"])).rowcount
    if not n:
        raise HTTPException(404, "Item não encontrado (ou não é seu).")
    return {"ok": True}


@app.get("/api/via/busca")
def busca(q: str = Query("", max_length=300), n: int = Query(5, ge=1, le=20), u: dict = Depends(leitura)):
    q = " ".join(q.split())
    if len(q) < 2:
        raise HTTPException(400, "Digite pelo menos dois caracteres.")
    with pool.connection() as c:
        rs = c.execute("SELECT * FROM via_busca(%s, %s, %s)", (q, u["id"], n)).fetchall()
    return {"q": q, "modo": "texto+trigram", "trechos": [{**r, "score": round(float(r["score"]), 4)} for r in rs]}


@app.get("/api/via/eu")
def eu(u: dict = Depends(leitura)):
    return {"email": u["email"], "admin": u["admin"], "embeddings": EMBEDDINGS}


@app.get("/api/via/saude")
def saude():
    try:
        with pool.connection(timeout=3) as c:
            c.execute("SELECT 1")
        return {"ok": True}
    except Exception:  # noqa: BLE001
        return JSONResponse({"ok": False}, status_code=503)
