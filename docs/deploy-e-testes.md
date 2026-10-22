# Desenvolvimento, testes e publicação

## Rodar localmente

Resumo (detalhes no [README](../README.md#como-rodar-localmente) e no [CONTRIBUTING](../CONTRIBUTING.md)):

```bash
ferramentas/baixar-wasm.sh          # .wasm do ONNX Runtime Web 1.20.1 (e 1.29.0 da página Relações)
python3 ferramentas/servir.py       # http://localhost:8800 com COOP/COEP/CORP, MIME de .mjs/.wasm, sem cache
```

- `ferramentas/servir.py` usa só a biblioteca padrão do Python, manda os cabeçalhos da produção (exceto em `/yt/player.html`, que na produção é servido sem isolamento) e tem fila de conexões grande, porque o app abre muitos módulos em paralelo.
- Pesos: o app baixa de `models/...` e `relacoes/models/...` (caminhos no campo `file`/`files` de cada spec em `site/js/cv/runtime/onnx.js` e `models-livres-*.js`). Baixe só os que for testar do sistema no ar, por exemplo `curl --create-dirs -o site/models/yolox.onnx https://aivision.gplansis.com/models/yolox.onnx`. Quem tem acesso ao servidor pode usar `rsync vps2:/opt/aivision/site/models/... site/models/...`.
- Login: para testar o app sem a API PHP, crie `site/api/me` (pasta ignorada pelo git) com `{"authenticated": true, "challenge_required": false, "csrf": "x", "user": {"id": 1, "name": "Dev", "email": "dev@exemplo.local", "scopes": []}}`. Não publique esse arquivo.
- O executor roda fora do app: importe `js/cv/executor.js` + `js/cv/registry.js` numa página de teste, monte `ImageData` de uma imagem e chame `run(frame, nodes, i)` em laço até a inferência assíncrona terminar.

## Testes automatizados no navegador

Chrome headless pelo DevTools Protocol (Node 24, sem dependências): abre a URL, imprime `console`/exceções, avalia uma expressão (com `await`), emula a viewport (`Emulation.setDeviceMetricsOverride`) e tira screenshot. Flags úteis:

| Flag | Para |
|---|---|
| `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream --use-file-for-fake-video-capture=video.y4m` | câmera simulada com um vídeo |
| `--auto-accept-this-tab-capture` | captura da própria aba (fonte YouTube) |
| `--autoplay-policy=no-user-gesture-required` | tocar áudio/vídeo sem gesto |

Arquivo de vídeo como fonte: `DataTransfer` + `input[type=file]` + evento `change`. Teclas de mídia: `KeyboardEvent('keydown', {key: 'MediaPlayPause'})`.

O que a regressão final cobre: todos os operadores (80 na v86) em imagens reais, todos os presets (81), desktop (1920/1440/1100) e celular (390/430), páginas e serviços em produção (cabeçalhos, 401 sem login, entradas maliciosas, pacote AGPL).

## Publicar

1. Suba **juntos** `VERSION` em `site/sw.js` e o `?v=` dos CSS em `site/app.html` (o iPhone mistura CSS velho com JS novo se só um mudar).
2. `node --input-type=module --check` em todo JS alterado.
3. Backup em produção: `tar czf /opt/aivision/bak/site-antes-vNN-$(date +%Y%m%d-%H%M%S).tgz --exclude=site/models --exclude=site/vendor --exclude=site/relacoes/models site`.
4. Publicação seletiva: liste os arquivos alterados e envie só eles (`rsync -az --checksum -R --files-from=lista.txt . vps2:/opt/aivision/site/`), depois `chown caddy:caddy`. Nunca `--delete` sobre a produção.
5. Regenerar o pacote AGPL (site sem pesos + `servicos/treino` sem `.env`/`dados` + `servicos/youtube`) em `/opt/aivision/site/codigo-fonte/aivision-fonte.tar.gz`.
6. Fumaça em produção: páginas 200, `sw.js` com a versão nova, `import('/js/cv/registry.js')` com 48 módulos / 94 operadores (v86), `/api/yt` e `/api/treino` com 401 sem credencial.

Serviços: `cd /opt/aivision/{treino,yt} && docker compose up -d --build` (o de treino só sem treino rodando).
