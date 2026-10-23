"""
aivision-yt — busca do YouTube para a fonte «YouTube» do iaVision.

O QUE ESTE SERVIÇO FAZ (E O QUE NÃO FAZ)
  O vídeo NUNCA passa por aqui. O navegador toca o vídeo no player oficial do
  YouTube (iframe youtube-nocookie) e captura a própria aba; este serviço só
  ajuda a ESCOLHER o vídeo:

    GET /api/yt/busca?q=&n=        -> [{id, titulo, canal, duracao}]   (yt-dlp --flat-playlist)
    GET /api/yt/info?v=            -> {id, titulo, canal}              (oEmbed; aceita URL ou id)
    GET /api/yt/miniatura/{id}     -> JPEG de i.ytimg.com (hqdefault) com CORP same-origin
    GET /api/yt/saude              -> {"ok": true}                     (sem autenticação)

  Por que existe um proxy de miniatura: a página do iaVision roda com
  COEP require-corp (threads do ONNX Runtime). Uma <img> de i.ytimg.com sem
  Cross-Origin-Resource-Policy é bloqueada; servida daqui, é same-origin.

  Por que yt-dlp só na BUSCA: o IP do servidor recebe «confirm you're not a bot»
  ao abrir a página de um vídeo, mas a página de resultados e o oEmbed passam.
  Nada aqui extrai stream nem baixa mídia.

AUTENTICAÇÃO
  Só quem está logado no iaVision. O cabeçalho Cookie da requisição é repassado
  para a API PHP de login (AIV_ME_URL, a mesma que o Caddy atende em /api/me);
  exige-se {"authenticated": true}. O resultado fica em cache curto pelo hash do
  cookie, para a busca digitada não virar uma chamada à hospedagem por tecla.
"""

from __future__ import annotations

import hashlib
import os
import re
import threading
import time
from collections import OrderedDict
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response

ME_URL = os.environ.get("AIV_ME_URL", "https://gplansis.com/aivision-api/api/me")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
YT_ID = re.compile(r"\A[A-Za-z0-9_-]{11}\Z")
YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
            "youtu.be", "www.youtube-nocookie.com", "youtube-nocookie.com"}

app = FastAPI(title="aivision-yt", docs_url=None, redoc_url=None, openapi_url=None)
_http = httpx.Client(timeout=10, headers={"User-Agent": UA}, follow_redirects=False)


# ------------------------------------------------------------------ utilidades

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
            if len(self.d) > 5000:          # limpeza ocasional de IPs parados
                self.d = {k: v for k, v in self.d.items() if v and v[-1] > agora - self.janela}
            l = [t for t in self.d.get(ip, []) if t > agora - self.janela]
            if len(l) >= self.n:
                self.d[ip] = l
                raise HTTPException(429, "Muitas consultas seguidas. Espere um minuto e tente de novo.")
            l.append(agora)
            self.d[ip] = l


def ip_de(req: Request) -> str:
    # o Caddy (único cliente, em 127.0.0.1) põe o IP real em X-Forwarded-For
    xff = req.headers.get("x-forwarded-for", "")
    return (xff.split(",")[0].strip() if xff else "") or (req.client.host if req.client else "?")


def id_de(texto: str) -> str:
    """Aceita o id (11 caracteres) ou um link do YouTube em qualquer formato comum."""
    t = (texto or "").strip()
    if YT_ID.match(t):
        return t
    if not re.match(r"^https?://", t):
        t = "https://" + t
    u = urlparse(t)
    host = (u.hostname or "").lower()
    if host not in YT_HOSTS:
        raise HTTPException(400, "Use um link do YouTube ou o identificador do vídeo (11 caracteres).")
    if host == "youtu.be":
        vid = u.path.strip("/").split("/")[0]
    else:
        vid = (parse_qs(u.query).get("v") or [""])[0]
        partes = u.path.split("/")
        if not vid and len(partes) > 2 and partes[1] in ("shorts", "live", "embed", "v"):
            vid = partes[2]
    if not YT_ID.match(vid or ""):
        raise HTTPException(400, "Link do YouTube sem um vídeo.")
    return vid


# ------------------------------------------------------------------ autenticação

_sessoes = TTLCache(2000)


class LoginIndisponivel(Exception):
    """A API PHP de login não respondeu direito: não é «não logado», é «não deu para saber»."""


_lim_login = Limite(30)   # consultas NOVAS à API de login por IP/min (cookie fora do cache)


def validar_cookie(cookie: str, ip: str = "") -> bool:
    """True se o cookie pertence a uma sessão válida do iaVision. Cache: 60 s (válida) / 10 s (inválida).

    Cookie que não está no cache conta no limite por IP antes de ir à hospedagem: cookies
    falsos diferentes a cada requisição não viram uma chamada ao PHP cada (429).
    LoginIndisponivel quando a API de login cai ou responde algo que não é o JSON esperado.
    """
    if not cookie:
        return False
    chave = hashlib.sha256(cookie.encode()).hexdigest()
    em_cache = _sessoes.get(chave)
    if em_cache is not None:
        return em_cache
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
    ok = corpo.get("authenticated") is True
    _sessoes.put(chave, ok, 60 if ok else 10)
    return ok


def logado(req: Request) -> str:
    ip = ip_de(req)
    try:
        ok = validar_cookie(req.headers.get("cookie", ""), ip)
    except LoginIndisponivel:
        # não cacheia: na próxima tentativa consulta de novo
        raise HTTPException(503, "O login do iaVision não respondeu agora. Tente de novo em instantes.")
    if not ok:
        raise HTTPException(401, "Entre no iaVision para usar a busca do YouTube.")
    return ip


# ------------------------------------------------------------------ busca

_lim_busca = Limite(20)
_lim_info = Limite(60)
_lim_mini = Limite(400)
_cache_busca = TTLCache(500)
_cache_info = TTLCache(2000)
_cache_mini = TTLCache(400)
_yt_sem = threading.Semaphore(2)     # yt-dlp é pesado: no máximo duas buscas simultâneas


class Ocupado(Exception):
    """As duas vagas do yt-dlp seguiram ocupadas por 20 s."""


def _buscar(q: str, n: int) -> list[dict]:
    import yt_dlp
    opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "skip_download": True,
            "cachedir": False, "noplaylist": False, "socket_timeout": 15, "http_headers": {"User-Agent": UA}}
    # espera limitada pela vaga: com o YouTube lento, as buscas não se acumulam no pool
    if not _yt_sem.acquire(timeout=20):
        raise Ocupado()
    try:
        with yt_dlp.YoutubeDL(opts) as y:
            info = y.extract_info(f"ytsearch{n}:{q}", download=False) or {}
    finally:
        _yt_sem.release()
    out, vistos = [], set()
    for e in info.get("entries") or []:
        vid = (e or {}).get("id") or ""
        if not YT_ID.match(vid) or vid in vistos or e.get("ie_key") not in (None, "Youtube"):
            continue
        vistos.add(vid)
        dur = e.get("duration")
        out.append({"id": vid, "titulo": e.get("title") or vid,
                    "canal": e.get("channel") or e.get("uploader") or "",
                    "duracao": int(dur) if isinstance(dur, (int, float)) else None})
    return out


@app.get("/api/yt/busca")
def busca(q: str = Query("", max_length=200), n: int = Query(12, ge=1, le=25), ip: str = Depends(logado)):
    q = " ".join(q.split())
    if len(q) < 2:
        raise HTTPException(400, "Digite pelo menos dois caracteres.")
    chave = (q.lower(), n)
    r = _cache_busca.get(chave)
    if r is not None:
        return r
    _lim_busca.checar(ip)
    try:
        r = _buscar(q, n)
    except Ocupado:
        raise HTTPException(503, "A busca do YouTube está ocupada agora. Tente de novo em instantes.")
    except Exception as e:  # yt-dlp levanta tipos variados
        raise HTTPException(502, "A busca do YouTube falhou agora. Tente de novo em instantes.") from e
    _cache_busca.put(chave, r, 3600)
    return r


@app.get("/api/yt/info")
def info(v: str = Query(..., max_length=300), ip: str = Depends(logado)):
    vid = id_de(v)
    r = _cache_info.get(vid)
    if r is not None:
        return r
    _lim_info.checar(ip)
    try:
        resp = _http.get("https://www.youtube.com/oembed",
                         params={"url": "https://www.youtube.com/watch?v=" + vid, "format": "json"})
    except httpx.HTTPError as e:
        raise HTTPException(502, "O YouTube não respondeu.") from e
    if resp.status_code in (400, 401, 403, 404):
        # 401/403: o dono desativou a incorporação; 404: não existe ou é privado
        msg = ("Este vídeo não permite ser incorporado em outros sites."
               if resp.status_code in (401, 403) else "Vídeo não encontrado (privado ou removido).")
        raise HTTPException(404, msg)
    if resp.status_code != 200:
        raise HTTPException(502, "O YouTube não respondeu.")
    try:
        o = resp.json()
    except ValueError as e:
        raise HTTPException(502, "O YouTube não respondeu.") from e
    if not isinstance(o, dict):
        raise HTTPException(502, "O YouTube não respondeu.")
    r = {"id": vid, "titulo": o.get("title") or vid,
         "canal": re.sub(r"\s*-\s*Topic$", "", o.get("author_name") or "")}
    _cache_info.put(vid, r, 6 * 3600)
    return r


@app.get("/api/yt/miniatura/{vid}")
def miniatura(vid: str, ip: str = Depends(logado)):
    if not YT_ID.match(vid):
        raise HTTPException(400, "Identificador inválido.")
    corpo = _cache_mini.get(vid)
    if corpo is None:
        _lim_mini.checar(ip)
        try:
            resp = _http.get(f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg")
        except httpx.HTTPError as e:
            raise HTTPException(502, "Miniatura indisponível.") from e
        if resp.status_code != 200 or not resp.headers.get("content-type", "").startswith("image/"):
            raise HTTPException(404, "Miniatura indisponível.")
        corpo = resp.content
        _cache_mini.put(vid, corpo, 24 * 3600)
    return Response(corpo, media_type="image/jpeg", headers={
        # a página tem COEP require-corp: a imagem precisa se declarar same-origin
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, max-age=86400",
    })


@app.get("/api/yt/saude")
def saude():
    return {"ok": True}
