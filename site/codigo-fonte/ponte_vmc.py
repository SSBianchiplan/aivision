#!/usr/bin/env python3
"""
ponte_vmc.py — ponte WebSocket → UDP para a saída VMC do GPlanSiS|iaVision Motion 3D Studio.

O navegador não envia UDP. O Studio monta os pacotes OSC do protocolo VMC (bundles de até ~1400
bytes) e os manda por WebSocket; esta ponte só repassa cada mensagem binária como UM datagrama
UDP para o receptor VMC (Unity com EVMC4U, Unreal com VMC4UE, Blender com VMC Link, VSeeFace…).
Não interpreta, não grava, não envia nada para fora da máquina. Só a biblioteca padrão do Python 3.8+.

MODO LOCAL (padrão): o Studio, aberto NESTE computador, conecta em ws://127.0.0.1:39541.
    python3 ponte_vmc.py                       # repassa para udp 127.0.0.1:39539
    python3 ponte_vmc.py --udp 192.168.0.20:39539 --porta 39541
  Só aceita conexões de 127.0.0.1 e de páginas com Origin na lista (--origem para acrescentar).
  O Chrome 147+ pede a permissão "rede local / loopback" na primeira conexão: aceite.

MODO REMOTO: o Studio em outro aparelho (celular, outro PC) envia pelo servidor do iaVision
(aivision-motion, que só repassa e exige a sessão); esta ponte conecta como RECEPTORA:
    python3 ponte_vmc.py --remoto wss://aivision.gplansis.com/api/v1/motion/vmc/ws --token <token do Studio>

Licença: AGPL-3.0 (como o iaVision). Protocolo VMC: https://protocol.vmc.info/ (MIT).
"""
import argparse
import asyncio
import base64
import hashlib
import os
import socket
import ssl
import struct
import sys
import urllib.parse

GUID = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
ORIGENS = ["https://aivision.gplansis.com", "http://127.0.0.1", "http://localhost", "https://127.0.0.1", "https://localhost"]
MAX_MSG = 64 * 1024


class Udp:
    def __init__(self, alvo):
        h, p = alvo.rsplit(":", 1)
        self.alvo = (h, int(p))
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.n = 0
        self.bytes = 0

    def enviar(self, dados):
        self.s.sendto(dados, self.alvo)
        self.n += 1
        self.bytes += len(dados)


async def ler_quadro(r):
    """Um quadro WebSocket → (opcode, payload). Desmascara se vier mascarado."""
    b0, b1 = await r.readexactly(2)
    fin, op, mask, n = b0 & 0x80, b0 & 0x0F, b1 & 0x80, b1 & 0x7F
    if n == 126:
        n = struct.unpack(">H", await r.readexactly(2))[0]
    elif n == 127:
        n = struct.unpack(">Q", await r.readexactly(8))[0]
    if n > MAX_MSG:
        raise ValueError("mensagem grande demais")
    chave = await r.readexactly(4) if mask else None
    dados = bytearray(await r.readexactly(n))
    if chave:
        for i in range(n):
            dados[i] ^= chave[i & 3]
    return op, bytes(dados), bool(fin)


def quadro(op, dados=b"", mascarar=False):
    cab = bytearray([0x80 | op])
    n = len(dados)
    m = 0x80 if mascarar else 0
    if n < 126:
        cab.append(m | n)
    elif n < 65536:
        cab.append(m | 126)
        cab += struct.pack(">H", n)
    else:
        cab.append(m | 127)
        cab += struct.pack(">Q", n)
    if mascarar:
        k = os.urandom(4)
        cab += k
        dados = bytes(b ^ k[i & 3] for i, b in enumerate(dados))
    return bytes(cab) + dados


async def repassar(r, w, udp, mascarar):
    """Laço comum: binário → UDP; ping → pong; close → fim."""
    partes = b""
    while True:
        op, dados, fin = await ler_quadro(r)
        if op == 0x8:
            w.write(quadro(0x8, dados[:2], mascarar))
            await w.drain()
            return
        if op == 0x9:
            w.write(quadro(0xA, dados, mascarar))
            await w.drain()
            continue
        if op in (0x2, 0x0):
            partes += dados
            if fin:
                udp.enviar(partes)
                partes = b""
                if udp.n % 300 == 0:
                    print(f"  {udp.n} pacotes · {udp.bytes // 1024} KB → udp {udp.alvo[0]}:{udp.alvo[1]}", flush=True)


async def servidor_local(args, udp):
    origens = ORIGENS + (args.origem or [])

    async def cliente(r, w):
        ip = w.get_extra_info("peername")[0]
        try:
            linhas = []
            while True:
                l = await asyncio.wait_for(r.readline(), 10)
                if l in (b"\r\n", b"\n", b""):
                    break
                linhas.append(l.decode("latin-1").strip())
            cab = {k.lower(): v.strip() for k, v in (x.split(":", 1) for x in linhas[1:] if ":" in x)}
            origem = cab.get("origin", "")
            if ip not in ("127.0.0.1", "::1") or (origem and not any(origem == o or origem.startswith(o + ":") for o in origens)):
                w.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                await w.drain()
                print(f"recusado: {ip} origem={origem!r}", flush=True)
                return
            chave = cab.get("sec-websocket-key", "")
            aceite = base64.b64encode(hashlib.sha1(chave.encode() + GUID).digest()).decode()
            w.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     f"Sec-WebSocket-Accept: {aceite}\r\n\r\n").encode())
            await w.drain()
            print(f"Studio conectado ({origem or 'sem origem'})", flush=True)
            await repassar(r, w, udp, False)
        except (asyncio.IncompleteReadError, ConnectionError, asyncio.TimeoutError, ValueError) as e:
            print(f"conexão encerrada: {e.__class__.__name__}", flush=True)
        finally:
            w.close()

    srv = await asyncio.start_server(cliente, "127.0.0.1", args.porta)
    print(f"Ponte VMC: ws://127.0.0.1:{args.porta} → udp {udp.alvo[0]}:{udp.alvo[1]} (Ctrl+C para sair)", flush=True)
    async with srv:
        await srv.serve_forever()


async def cliente_remoto(args, udp):
    u = urllib.parse.urlparse(args.remoto)
    if u.scheme not in ("wss", "ws"):
        sys.exit("--remoto precisa ser wss://…")
    porta = u.port or (443 if u.scheme == "wss" else 80)
    ctx = ssl.create_default_context() if u.scheme == "wss" else None
    caminho = (u.path or "/") + "?" + urllib.parse.urlencode({"papel": "receptor", "token": args.token})
    while True:
        try:
            r, w = await asyncio.open_connection(u.hostname, porta, ssl=ctx, server_hostname=u.hostname if ctx else None)
            chave = base64.b64encode(os.urandom(16)).decode()
            w.write((f"GET {caminho} HTTP/1.1\r\nHost: {u.hostname}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     f"Sec-WebSocket-Key: {chave}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: ponte-vmc/1.0\r\n\r\n").encode())
            await w.drain()
            status = await r.readline()
            while (await r.readline()) not in (b"\r\n", b""):
                pass
            if b" 101 " not in status:
                print("servidor recusou:", status.decode(errors="replace").strip(), flush=True)
                if b" 401 " in status or b" 403 " in status or b" 404 " in status:
                    return
            else:
                print(f"conectado ao iaVision ({u.hostname}) → udp {udp.alvo[0]}:{udp.alvo[1]}", flush=True)
                await repassar(r, w, udp, True)
        except (OSError, asyncio.IncompleteReadError, ValueError) as e:
            print(f"desconectado: {e.__class__.__name__}; nova tentativa em 3 s", flush=True)
        await asyncio.sleep(3)


def main():
    ap = argparse.ArgumentParser(description="Ponte WebSocket → UDP (VMC) do iaVision Motion 3D Studio")
    ap.add_argument("--udp", default="127.0.0.1:39539", help="receptor VMC (host:porta), padrão 127.0.0.1:39539")
    ap.add_argument("--porta", type=int, default=39541, help="porta WebSocket local (modo local), padrão 39541")
    ap.add_argument("--origem", action="append", help="Origin extra aceita (ex.: http://127.0.0.1:8893)")
    ap.add_argument("--remoto", help="modo remoto: URL wss do repasse do aivision-motion")
    ap.add_argument("--token", default="", help="token do canal (mostrado no Studio) para o modo remoto")
    a = ap.parse_args()
    udp = Udp(a.udp)
    try:
        asyncio.run(cliente_remoto(a, udp) if a.remoto else servidor_local(a, udp))
    except KeyboardInterrupt:
        print(f"\n{udp.n} pacotes repassados.")


if __name__ == "__main__":
    main()
