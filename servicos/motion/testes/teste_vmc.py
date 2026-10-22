"""
teste_vmc.py — repasse VMC (aivision-motion 1.1) e a ponte_vmc.py, de ponta a ponta, sem rede externa:
  - POST /vmc/canais sem cookie → 401; com cookie → canal + token;
  - emissor sem cookie / canal alheio → fechado; receptor com token errado → fechado;
  - ponte_vmc.py --remoto (receptora) + emissor com cookie → os pacotes OSC chegam em UDP;
  - ponte_vmc.py local (ws://127.0.0.1:PORTA) → UDP; Origin estranha → 403.
uso: AIV_TESTE_BASE=http://127.0.0.1:8894 python testes/teste_vmc.py   (o serviço já rodando com AIV_ME_URL de teste)
"""
import asyncio
import os
import socket
import subprocess
import sys
import time

import httpx
import websockets

BASE = os.environ.get("AIV_TESTE_BASE", "http://127.0.0.1:8894")
WS = BASE.replace("http", "ws") + "/api/v1/motion/vmc/ws"
PONTE = os.path.join(os.path.dirname(__file__), "..", "ponte_vmc.py")
UDP_PORTA = int(os.environ.get("AIV_TESTE_UDP", "39601"))
WS_LOCAL = int(os.environ.get("AIV_TESTE_WS", "39602"))
ok = 0


def confere(cond, msg):
    global ok
    if not cond:
        print("FALHOU:", msg)
        sys.exit(1)
    ok += 1
    print("ok ·", msg)


def osc(endereco: str) -> bytes:
    def s(x):
        b = x.encode() + b"\0"
        return b + b"\0" * ((4 - len(b) % 4) % 4)
    return s(endereco) + s(",i") + (1).to_bytes(4, "big")


async def principal():
    r = httpx.post(BASE + "/api/v1/motion/vmc/canais")
    confere(r.status_code == 401, "canal sem sessão → 401")
    r = httpx.post(BASE + "/api/v1/motion/vmc/canais", headers={"Cookie": "sessao=teste"})
    confere(r.status_code == 201 and r.json()["token"], "canal com sessão → 201 + token")
    canal, token = r.json()["canal"], r.json()["token"]
    # recusas
    for url, hdr, nome in [(f"{WS}?papel=emissor&canal={canal}", {}, "emissor sem cookie"), (f"{WS}?papel=receptor&token=errado", {}, "receptor com token errado"), (f"{WS}?papel=x", {}, "papel inválido")]:
        try:
            async with websockets.connect(url, additional_headers=hdr) as w:
                await asyncio.wait_for(w.recv(), 2)
            confere(False, nome)
        except Exception:
            confere(True, f"{nome} → fechado")
    # receptor = ponte remota; UDP de escuta
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    udp.bind(("127.0.0.1", UDP_PORTA))
    udp.settimeout(5)
    pr = subprocess.Popen([sys.executable, PONTE, "--remoto", WS, "--token", token, "--udp", f"127.0.0.1:{UDP_PORTA}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        time.sleep(1.5)
        async with websockets.connect(f"{WS}?papel=emissor&canal={canal}", additional_headers={"Cookie": "sessao=teste"}) as w:
            for _ in range(5):
                await w.send(osc("/VMC/Ext/OK"))
            await asyncio.sleep(0.5)
        recebidos = []
        try:
            for _ in range(5):
                recebidos.append(udp.recvfrom(2048)[0])
        except socket.timeout:
            pass
        confere(len(recebidos) == 5 and recebidos[0].startswith(b"/VMC/Ext/OK"), f"repasse remoto: {len(recebidos)}/5 pacotes OSC em UDP")
    finally:
        pr.terminate(); pr.wait(5)
    # ponte local
    pl = subprocess.Popen([sys.executable, PONTE, "--porta", str(WS_LOCAL), "--udp", f"127.0.0.1:{UDP_PORTA}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        time.sleep(1.0)
        async with websockets.connect(f"ws://127.0.0.1:{WS_LOCAL}", origin="http://127.0.0.1:8893") as w:
            await w.send(osc("/VMC/Ext/T"))
            await asyncio.sleep(0.3)
        dado = udp.recvfrom(2048)[0]
        confere(dado.startswith(b"/VMC/Ext/T"), "ponte local: WebSocket → UDP")
        try:
            async with websockets.connect(f"ws://127.0.0.1:{WS_LOCAL}", origin="https://site-estranho.example") as w:
                await w.send(osc("/x"))
            confere(False, "origem estranha recusada")
        except Exception:
            confere(True, "ponte local: Origin estranha → 403")
    finally:
        pl.terminate(); pl.wait(5)
    udp.close()


asyncio.run(principal())
print(f"{ok} verificações ok")
