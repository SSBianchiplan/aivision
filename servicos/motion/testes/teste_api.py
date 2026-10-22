"""
Testes do aivision-motion (sem rede, sem motor real). Rodar:
    python -m venv .venv && .venv/bin/pip install -r requirements.txt
    AIV_MOTION_DADOS=$(mktemp -d) .venv/bin/python testes/teste_api.py
ou no contêiner:  docker exec -i aivision-motion python - < testes/teste_api.py

O validador de sessão é trocado SÓ dentro deste processo (como no teste do aivision-yt). A parte
"motor disponível" usa um ADAPTADOR FALSO de teste (escreve um JSON mínimo) para exercitar a fila;
nenhum motor real é simulado na API — sem instalação, tudo responde 501.
"""
import io
import json
import os
import sys
import tempfile
import time

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(AQUI))
os.environ.setdefault("AIV_MOTION_DADOS", tempfile.mkdtemp(prefix="aivm-"))
os.environ["AIV_MOTION_MAX_MB"] = "2"
for k in list(os.environ):
    if k.startswith("AIV_MOTION_") and k.endswith(("_DIR", "_LICENCA", "_VERIFICADO")):
        del os.environ[k]

import app  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

USUARIOS = {"a=1": {"id": "u1", "pseud": "p1"}, "b=2": {"id": "u2", "pseud": "p2"}}
app.validar_cookie = lambda c, ip="": USUARIOS.get(c)
c = TestClient(app.app)
A, B = {"Cookie": "a=1"}, {"Cookie": "b=2"}
P = app.PREFIXO
falhas = 0


def ok(cond, msg):
    global falhas
    print(("OK   " if cond else "FALHA") + " " + msg)
    if not cond:
        falhas += 1


MP4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 2000

# ---------------------------------------------------------------- sem nada instalado
r = c.get(P + "/health")
ok(r.status_code == 200 and r.json()["real_inference"] is False, f"health sem autenticação, real_inference=false ({r.json()})")
ok(c.get(P + "/capabilities").status_code == 401, "capabilities sem cookie → 401")
r = c.get(P + "/capabilities", headers=A)
eng = r.json()["engines"]
ok(r.status_code == 200 and eng["gvhmr"]["status"] == "nao_instalado" and eng["flowhmr"]["status"] == "nao_instalado", "GVHMR e FlowHMR: não instalado")
ok(eng["exmr"]["status"] == "nao_verificado", "ExMR: não verificado (sem fonte confirmada)")
ok(eng["freemocap"]["status"] == "import_only" and eng["mediapipe"]["status"] == "browser", "FreeMoCap só importação; MediaPipe/BlazePose no navegador")
ok("não comercial" in eng["gvhmr"]["license"].lower() or "NÃO comercial" in eng["gvhmr"]["license"], "licença do GVHMR/SMPL declarada")

s = c.post(P + "/sessions", json={"source_id": "camera_1"}, headers=A)
ok(s.status_code == 201, "cria sessão 201")
sid = s.json()["session_id"]
job = {"session_id": sid, "engine": "gvhmr", "input_artifact_id": "upl_" + "0" * 32, "consent_reference": "consent_x", "idempotency_key": "k1"}
r = c.post(P + "/jobs", json=job, headers=A)
ok(r.status_code == 501 and "Nenhum resultado é simulado" in r.json()["detail"], f"POST /jobs gvhmr não instalado → 501 ({r.status_code})")
r = c.post(P + "/jobs", json={**job, "engine": "flowhmr"}, headers=A)
ok(r.status_code == 501, "POST /jobs flowhmr → 501")
r = c.post(P + "/jobs", json={**job, "engine": "exmr"}, headers=A)
ok(r.status_code == 501 and "não verificado" in r.json()["detail"], "POST /jobs exmr → 501 não verificado")
r = c.post(P + "/jobs", json={**job, "engine": "freemocap"}, headers=A)
ok(r.status_code == 501, "POST /jobs freemocap → 501 (só importação no Studio)")
r = c.post(P + "/jobs", json={**job, "engine": "rm -rf /"}, headers=A)
ok(r.status_code == 422, "motor fora da lista → 422")
r = c.post(P + "/jobs", json={**job, "consent_reference": ""}, headers=A)
ok(r.status_code in (400, 501), "sem consentimento → recusado")
ok(c.post(P + "/jobs", json=job).status_code == 401, "jobs sem cookie → 401")
r = c.post(P + "/uploads?engine=gvhmr", files={"video": ("v.mp4", io.BytesIO(MP4), "video/mp4")}, headers={**A, "X-Motion-Consent": "sim"})
ok(r.status_code == 501 and "não foi recebido" in r.json()["detail"], "upload com motor ausente → 501 sem receber o vídeo")
r = c.post(P + "/uploads?engine=gvhmr", files={"video": ("v.mp4", io.BytesIO(MP4), "video/mp4")}, headers=A)
ok(r.status_code == 400, "upload sem X-Motion-Consent → 400")
r = c.post(P + "/sessions", content=b"x" * 70000, headers={**A, "Content-Type": "application/json"})
ok(r.status_code == 413, "corpo JSON grande demais → 413")
ok(c.get(P + "/sessions/" + sid, headers=B).status_code == 404, "sessão de outro usuário → 404")
ok(c.get(P + "/sessions/../../etc", headers=A).status_code in (400, 404), "id com travessia recusado")
ok(len(os.listdir(os.path.join(os.environ["AIV_MOTION_DADOS"]))) == 0 or not os.path.exists(os.path.join(os.environ["AIV_MOTION_DADOS"], "uploads")), "nada gravado em disco sem motor")

# ---------------------------------------------------------------- motor de TESTE instalado (adaptador falso)
d = tempfile.mkdtemp(prefix="motor-teste-")
with open(os.path.join(d, "falso.py"), "w") as f:
    f.write("import sys, json, os\nv = sys.argv[sys.argv.index('--video') + 1]; s = sys.argv[sys.argv.index('--saida') + 1]\n"
            "assert os.path.getsize(v) > 0\njson.dump({'format': 'gplansis.iavision.motion3d.take/1', 'frames': []}, open(os.path.join(s, 'motionai.json'), 'w'))\n")
with open(os.path.join(d, "iavision-adaptador.json"), "w") as f:
    json.dump({"versao": "teste", "comando": [sys.executable, "falso.py", "--video", "{video}", "--saida", "{saida}"], "tempo_max_s": 30, "saida": "motionai.json"}, f)
os.environ["AIV_MOTION_GVHMR_DIR"] = d
eng = c.get(P + "/capabilities", headers=A).json()["engines"]
ok(eng["gvhmr"]["status"] == "licenca_pendente", "instalado sem licença aceita → licença pendente")
ok(c.post(P + "/jobs", json=job, headers=A).status_code == 501, "licença pendente → 501")
os.environ["AIV_MOTION_GVHMR_LICENCA"] = "aceita"
ok(c.get(P + "/capabilities", headers=A).json()["engines"]["gvhmr"]["status"] == "disponivel", "com adaptador e licença → disponível")
r = c.post(P + "/uploads?engine=gvhmr", files={"video": ("v.txt", io.BytesIO(b"nao e video" * 10), "text/plain")}, headers={**A, "X-Motion-Consent": "sim"})
ok(r.status_code == 415, "arquivo que não é vídeo → 415")
r = c.post(P + "/uploads?engine=gvhmr", files={"video": ("v.mp4", io.BytesIO(MP4 + b"\x00" * (3 * 1024 * 1024)), "video/mp4")}, headers={**A, "X-Motion-Consent": "sim"})
ok(r.status_code == 413, "vídeo acima do limite → 413")
r = c.post(P + "/uploads?engine=gvhmr&session_id=" + sid, files={"video": ("v.mp4", io.BytesIO(MP4), "video/mp4")}, headers={**A, "X-Motion-Consent": "sim"})
ok(r.status_code == 201, f"upload com consentimento → 201 ({r.status_code})")
aid = r.json()["artifact_id"]
r = c.post(P + "/jobs", json={**job, "input_artifact_id": aid}, headers=B)
ok(r.status_code == 404, "outro usuário não usa o vídeo alheio → 404")
r = c.post(P + "/jobs", json={**job, "input_artifact_id": aid}, headers=A)
ok(r.status_code == 202 and r.json()["status"] in ("queued", "running", "completed"), f"job aceito 202 ({r.status_code})")
jid = r.json()["job_id"]
r2 = c.post(P + "/jobs", json={**job, "input_artifact_id": aid}, headers=A)
ok(r2.json()["job_id"] == jid, "idempotência: mesma chave → mesmo job")
for _ in range(50):
    st = c.get(P + "/jobs/" + jid, headers=A).json()
    if st["status"] in ("completed", "failed"):
        break
    time.sleep(0.1)
ok(st["status"] == "completed" and st["percent_complete"] == 100 and len(st["artifacts"]) == 1, f"job concluído com 1 artefato ({st['status']}, {st.get('error')})")
ok(c.get(P + "/jobs/" + jid, headers=B).status_code == 404, "job de outro usuário → 404")
ok(not any(f.endswith(".mp4") for _, _, fs in os.walk(os.environ["AIV_MOTION_DADOS"]) for f in fs), "vídeo apagado ao fim do job")
art = st["artifacts"][0]["artifact_id"]
ok(c.get(f"{P}/jobs/{jid}/artifacts/{art}", headers=A).json()["format"].startswith("gplansis"), "artefato JSON baixável pelo dono")
ok(c.post(f"{P}/jobs/{jid}/cancel", headers=A).status_code == 409, "cancelar job concluído → 409")
ok(c.delete(P + "/sessions/" + sid, headers=A).status_code == 204, "apagar sessão (LGPD) → 204")
ok(c.get(P + "/jobs/" + jid, headers=A).status_code == 404, "jobs da sessão apagada somem")

print(f"\n{'FALHOU ' + str(falhas) if falhas else 'OK'} — aivision-motion {app.VERSAO}")
sys.exit(1 if falhas else 0)
