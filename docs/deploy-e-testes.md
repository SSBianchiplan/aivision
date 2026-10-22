# Desenvolvimento, testes e publicação

## Rodar localmente

```bash
# servidor com os cabeçalhos da produção (COOP/COEP/CORP), fila de conexões grande
python3 serve-aiv.py site 8800        # ver modelo abaixo
```

`serve-aiv.py` mínimo:

```python
import sys, http.server, functools, mimetypes
mimetypes.add_type('text/javascript', '.mjs'); mimetypes.add_type('application/wasm', '.wasm')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
class S(http.server.ThreadingHTTPServer):
    request_queue_size = 256; daemon_threads = True
S(('127.0.0.1', int(sys.argv[2])), functools.partial(H, directory=sys.argv[1])).serve_forever()
```

- Pesos: copie de produção (`rsync vps2:/opt/aivision/site/models/... site/models/...`) só os que for testar.
- Login: para testar o app sem a API, crie `site/api/me` com `{"authenticated": true, "challenge_required": false, "csrf": "x", "user": {...}}` (não publicar).
- O executor roda fora do app: importe `js/cv/executor.js` + `js/cv/registry.js` numa página de teste, monte `ImageData` de uma imagem e chame `run(frame, nodes, i)` em laço até a inferência assíncrona terminar.

## Testes automatizados no navegador

Chrome headless pelo DevTools Protocol (Node 24, sem dependências): abre a URL, imprime `console`/exceções, avalia uma expressão (com `await`), emula a viewport (`Emulation.setDeviceMetricsOverride`) e tira screenshot. Flags úteis:

| Flag | Para |
|---|---|
| `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=video.y4m` | câmera simulada com um vídeo |
| `--auto-accept-this-tab-capture` | captura da própria aba (fonte YouTube) |
| `--autoplay-policy=no-user-gesture-required` | tocar áudio/vídeo sem gesto |

Arquivo de vídeo como fonte: `DataTransfer` + `input[type=file]` + evento `change`. Teclas de mídia: `KeyboardEvent('keydown', {key: 'MediaPlayPause'})`.

O que a regressão final cobre: os 65 operadores em imagens reais, os 70 presets, desktop (1920/1440/1100) e celular (390/430), páginas e serviços em produção (cabeçalhos, 401 sem login, entradas maliciosas, pacote AGPL).

## Publicar

1. Suba **juntos** `VERSION` em `site/sw.js` e o `?v=` dos CSS em `site/app.html` (o iPhone mistura CSS velho com JS novo se só um mudar).
2. `node --input-type=module --check` em todo JS alterado.
3. Backup em produção: `tar czf /opt/aivision/bak/site-antes-vNN-$(date +%Y%m%d-%H%M%S).tgz --exclude=site/models --exclude=site/vendor --exclude=site/relacoes/models site`.
4. Publicação seletiva: liste os arquivos alterados e envie só eles (`rsync -az --checksum -R --files-from=lista.txt . vps2:/opt/aivision/site/`), depois `chown caddy:caddy`. Nunca `--delete` sobre a produção.
5. Regenerar o pacote AGPL (site sem pesos + `servicos/treino` sem `.env`/`dados` + `servicos/youtube`) em `/opt/aivision/site/codigo-fonte/aivision-fonte.tar.gz`.
6. Fumaça em produção: páginas 200, `sw.js` com a versão nova, `import('/js/cv/registry.js')` com 35 módulos / 65 operadores, `/api/yt` e `/api/treino` com 401 sem credencial.

Serviços: `cd /opt/aivision/{treino,yt} && docker compose up -d --build` (o de treino só sem treino rodando).
