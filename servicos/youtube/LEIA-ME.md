# aivision-yt — busca do YouTube para a fonte «YouTube» do iaVision

Este serviço só ajuda a **escolher** o vídeo. Ele nunca baixa nem repassa mídia.
O vídeo toca no player oficial do YouTube (iframe `youtube-nocookie.com`) dentro do
iaVision. O navegador captura a própria aba e recorta a captura no player
(Element Capture). Ver `js/camera/youtube.js` no site.

| Rota | O que faz |
|---|---|
| `GET /api/yt/busca?q=&n=` | `[{id, titulo, canal, duracao}]` via yt-dlp `--flat-playlist` (só metadados). Cache de 1 h. Limite de 20 buscas/min por IP. |
| `GET /api/yt/info?v=` | `{id, titulo, canal}` via oEmbed. Aceita o id (11 caracteres `[A-Za-z0-9_-]`) ou um link (watch, youtu.be, shorts, live, embed). 404 com mensagem quando o vídeo não existe ou o dono bloqueou a incorporação. |
| `GET /api/yt/miniatura/{id}` | Proxy de `i.ytimg.com/vi/{id}/hqdefault.jpg` com `Cross-Origin-Resource-Policy: same-origin`, necessário porque a página usa COEP require-corp. Cache de 24 h. |
| `GET /api/yt/saude` | `{"ok": true}`, sem autenticação. |

## Autenticação

Só funciona para quem está logado no iaVision. O cabeçalho `Cookie` vai para
`AIV_ME_URL` (`https://gplansis.com/aivision-api/api/me`, a mesma API PHP que o Caddy
atende em `/api/me`). O serviço exige `{"authenticated": true}` e responde 401 nos
outros casos. O resultado fica em cache pelo SHA-256 do cookie: 60 s quando a sessão
é válida, 10 s quando não é. O nome `gplansis.com` aponta para a origem
`45.132.157.26` (`extra_hosts` no compose), com Host e SNI `gplansis.com`, como no
Caddy.

## Por que yt-dlp só na busca

O IP da vps2 recebe «Sign in to confirm you're not a bot» quando abre a página de um
vídeo. A página de resultados e o oEmbed continuam funcionando. Não use yt-dlp aqui
para extrair stream ou metadados de um vídeo só.

## Implantação (vps2)

```
/opt/aivision/yt/  app.py  Dockerfile  docker-compose.yml  requirements.txt
cd /opt/aivision/yt && docker compose up -d --build
```

- O contêiner `aivision-yt` escuta em `127.0.0.1:8994`. A porta 8995 já é do `/opt/roadmap`.
- No Caddy (`/etc/caddy/aivision.caddy`), `handle /api/yt/*` → `reverse_proxy 127.0.0.1:8994`
  fica **antes** de `handle /api/*`, que é o login PHP. Os backups ficam em `/opt/aivision/bak/aivision.caddy.*`.
- Se a busca parar de funcionar, reconstrua sem cache para atualizar o yt-dlp:
  `docker compose build --no-cache && docker compose up -d`.

## Testes

```
curl -s 127.0.0.1:8994/api/yt/saude                       # {"ok":true}
curl -s -w '%{http_code}\n' '127.0.0.1:8994/api/yt/busca?q=gatos'   # 401 sem cookie
# caminho autenticado, sem sessão real (o validador é trocado só dentro do processo de teste):
docker exec -i aivision-yt python - <<'EOF'
import app; app.validar_cookie = lambda c, ip="": True
from fastapi.testclient import TestClient
c = TestClient(app.app); h = {"Cookie": "x=1"}
print(c.get("/api/yt/busca", params={"q": "big buck bunny", "n": 3}, headers=h).json())
print(c.get("/api/yt/info", params={"v": "https://youtu.be/aqz-KE-bpKQ"}, headers=h).json())
print(c.get("/api/yt/miniatura/aqz-KE-bpKQ", headers=h).headers["cross-origin-resource-policy"])
EOF
```
