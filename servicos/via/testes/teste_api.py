"""Teste funcional do aivision-via DENTRO do contêiner (usa o banco real, com usuários de teste
«teste-rag-*», e apaga tudo no fim). /api/me é simulado num servidor local.
Uso: docker exec -i aivision-via python - < testes/teste_api.py"""
import json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

USU = {"c1": {"id": "teste-rag-1", "email": "Usuario.Teste@Exemplo.com "},
       "c2": {"id": "teste-rag-2", "email": "outro@exemplo.com"},
       "adm": {"id": "teste-rag-adm", "email": "admin.teste@exemplo.com"}}


class Me(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        ck = (self.headers.get("Cookie") or "").replace("s=", "")
        u = USU.get(ck)
        b = json.dumps({"authenticated": True, "user": u} if u else {"authenticated": False}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)


srv = HTTPServer(("127.0.0.1", 8765), Me)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["AIV_ME_URL"] = "http://127.0.0.1:8765/me"
os.environ["AIV_VIA_ADMINS"] = "admin.teste@exemplo.com"
sys.path.insert(0, "/app")
import app as A  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

falhas = []
def ok(nome, cond, extra=""):
    print(("OK   " if cond else "FALHA"), nome, extra)
    if not cond:
        falhas.append(nome)

with TestClient(A.app) as t:
    H1, H2, HA = {"Cookie": "s=c1"}, {"Cookie": "s=c2"}, {"Cookie": "s=adm"}
    ok("sem cookie 401", t.get("/api/via/eu").status_code == 401)
    ok("cookie inválido 401", t.get("/api/via/eu", headers={"Cookie": "s=nada"}).status_code == 401)
    r = t.get("/api/via/eu", headers=H1).json()
    ok("eu (e-mail normalizado, não admin)", r["email"] == "usuario.teste@exemplo.com" and r["admin"] is False, str(r))
    ok("eu admin", t.get("/api/via/eu", headers=HA).json()["admin"] is True)
    # registro
    sha = "a" * 64
    r = t.post("/api/via/registro", headers=H1, json={"pergunta": "Como iluminar uma esteira?", "resposta": "Use luz difusa.",
               "modelo": "claude-opus-5-5", "tokens_in": 100, "tokens_out": 20,
               "comandos": [{"op": "yoloe.prompt", "parametro": "classes", "valor": "box, person"}],
               "anexos": [{"sha256": sha, "largura": 800, "altura": 600}]})
    ok("registro 200", r.status_code == 200, r.text[:200]); reg = r.json()
    r2 = t.post("/api/via/registro", headers=H1, json={"conversa_id": reg["conversa_id"], "pergunta": "e à noite?", "resposta": "IR."})
    ok("registro na mesma conversa", r2.status_code == 200 and r2.json()["conversa_id"] == reg["conversa_id"])
    ok("registro em conversa alheia 404", t.post("/api/via/registro", headers=H2, json={"conversa_id": reg["conversa_id"], "pergunta": "x"}).status_code == 404)
    ok("chave sk-ant recusada (registro)", t.post("/api/via/registro", headers=H1, json={"pergunta": "minha chave sk-ant-api03-abcdefghijklmnop"}).status_code == 400)
    ok("chave sk-ant recusada em comando", t.post("/api/via/registro", headers=H1, json={"pergunta": "x", "comandos": [{"op": "a", "valor": "sk-ant-api03-zzzzzzzzzzzz"}]}).status_code == 400)
    ok("sha inválido 422", t.post("/api/via/registro", headers=H1, json={"pergunta": "x", "anexos": [{"sha256": "xyz"}]}).status_code == 422)
    ok("marcar comando", t.patch(f"/api/via/comandos/{reg['comandos'][0]}", headers=H1, json={"aplicado": True}).json().get("aplicado") is True)
    ok("marcar comando alheio 404", t.patch(f"/api/via/comandos/{reg['comandos'][0]}", headers=H2, json={"salvo": True}).status_code == 404)
    ok("anexo → treinar", t.post("/api/via/anexos/treinar", headers=H1, json={"sha256": [sha], "projeto": "epi-obra"}).json()["atualizados"] == 1)
    h = t.get("/api/via/historico", headers=H1).json()
    ok("histórico", h["total"] == 1 and h["conversas"][0]["mensagens"] == 4, str(h)[:200])
    c = t.get(f"/api/via/historico/{reg['conversa_id']}", headers=H1).json()
    ok("conversa com comandos/anexos", c["mensagens"][1]["comandos"][0]["aplicado"] is True and c["mensagens"][0]["anexos"][0]["enviado_treinar_projeto"] == "epi-obra")
    ok("conversa alheia 404", t.get(f"/api/via/historico/{reg['conversa_id']}", headers=H2).status_code == 404)
    # conhecimento
    itens = [
        (H1, {"titulo": "Iluminação de esteira", "texto": "Para inspeção em esteira use iluminação difusa e câmera com obturador global; evite reflexo especular.", "tags": ["Iluminação", "esteira"], "origem_mensagem_id": reg["mensagem_via_id"]}),
        (H1, {"titulo": "Classes de EPI no YOLOE", "texto": "hard hat rende melhor que helmet; use safety vest e gloves.", "tags": ["epi", "yoloe"]}),
        (H2, {"titulo": "Segredo do outro usuário", "texto": "iluminação particular que ninguém mais vê"}),
        (HA, {"titulo": "Câmeras industriais: exposição", "texto": "Exposição curta congela movimento; aumente o ganho com cuidado. Iluminacao estroboscópica ajuda.", "compartilhado": True}),
    ]
    ids = []
    for hh, b in itens:
        r = t.post("/api/via/conhecimento", headers=hh, json=b); ok("salvar " + b["titulo"], r.status_code == 200, r.text[:150]); ids.append(r.json()["id"])
    ok("não admin não compartilha (403)", t.post("/api/via/conhecimento", headers=H1, json={"titulo": "x", "texto": "y", "compartilhado": True}).status_code == 403)
    ok("chave sk-ant recusada (conhecimento)", t.post("/api/via/conhecimento", headers=H1, json={"titulo": "x", "texto": "sk-ant-api03-qqqqqqqqqqqq"}).status_code == 400)
    b = t.get("/api/via/busca", headers=H1, params={"q": "iluminacao esteira", "n": 5}).json()
    tit = [x["titulo"] for x in b["trechos"]]
    print("     busca 'iluminacao esteira' →", [(x["titulo"], x["score"], x["meu"]) for x in b["trechos"]])
    ok("busca sem acento acha o meu", tit and tit[0] == "Iluminação de esteira")
    ok("busca acha o compartilhado", "Câmeras industriais: exposição" in tit)
    ok("busca NÃO acha o item privado alheio", "Segredo do outro usuário" not in tit)
    b = t.get("/api/via/busca", headers=H1, params={"q": "capacete hard hat"}).json()
    ok("busca por termo em inglês", b["trechos"] and b["trechos"][0]["titulo"] == "Classes de EPI no YOLOE", str(b)[:200])
    b = t.get("/api/via/busca", headers=H1, params={"q": "ilumnacao"}).json()   # erro de digitação → trigram
    ok("busca tolera erro de digitação (trigram)", any(x["titulo"] == "Iluminação de esteira" for x in b["trechos"]), str([x["titulo"] for x in b["trechos"]]))
    ok("busca q curta 400", t.get("/api/via/busca", headers=H1, params={"q": "a"}).status_code == 400)
    lst = t.get("/api/via/conhecimento", headers=H1).json()
    ok("lista = meus + compartilhados", sorted(x["titulo"] for x in lst) == sorted(["Iluminação de esteira", "Classes de EPI no YOLOE", "Câmeras industriais: exposição"]))
    ok("PATCH compartilhar não admin 403", t.patch(f"/api/via/conhecimento/{ids[0]}", headers=H1, json={"compartilhado": True}).status_code == 403)
    ok("apagar item alheio 404", t.delete(f"/api/via/conhecimento/{ids[2]}", headers=H1).status_code == 404)
    ok("apagar compartilhado de outro (não admin) 404", t.delete(f"/api/via/conhecimento/{ids[3]}", headers=H1).status_code == 404)
    ok("apagar o próprio", t.delete(f"/api/via/conhecimento/{ids[1]}", headers=H1).status_code == 200)
    ok("apagar conversa alheia 404", t.delete(f"/api/via/historico/{reg['conversa_id']}", headers=H2).status_code == 404)
    r = t.delete("/api/via/historico", headers=H1).json()
    ok("LGPD: apagar todas as conversas", r["apagadas"] == 1)
    lst = t.get("/api/via/conhecimento", headers=H1, params={"escopo": "meus"}).json()
    ok("conhecimento fica, origem vira NULL", lst and lst[0]["origem_mensagem_id"] is None, str(lst)[:150])
    # limpeza
    with A.pool.connection() as c:
        c.execute("DELETE FROM conhecimento WHERE usuario_id LIKE 'teste-rag-%%'")
        c.execute("DELETE FROM conversas WHERE usuario_id LIKE 'teste-rag-%%'")
        n = c.execute("SELECT (SELECT count(*) FROM conhecimento WHERE usuario_id LIKE 'teste-rag-%%') + (SELECT count(*) FROM conversas WHERE usuario_id LIKE 'teste-rag-%%') AS n").fetchone()["n"]
    ok("limpeza", n == 0)
srv.shutdown()
print("RESULTADO:", "TUDO OK" if not falhas else f"{len(falhas)} falha(s): {falhas}")
