# GPlanSiS|iaVision

Visão computacional em tempo real, na tela e na palma da sua mão.

Aplicação web (React UMD + htm, ES modules, ONNX Runtime Web) que roda os modelos **no próprio navegador**: câmera, arquivo, tela, câmera RTMP ou vídeo do YouTube entram num pipeline de operadores encadeáveis — 40 módulos e 80 operadores, do processamento clássico ao vocabulário aberto, aos módulos de esporte e biomecânica e ao módulo Industrial (volumetria de correia, contagem em esteira, tempo de posto e inspeção visual), com a assistente de IA Via. Os modelos rodam na placa de vídeo (WebGPU) quando o aparelho permite. Em produção em https://aivision.gplansis.com.

## Documentação

Tudo em [`docs/`](docs/README.md): [arquitetura](docs/arquitetura.md) · [interface](docs/interface.md) · [fontes e YouTube](docs/fontes.md) · [catálogo de módulos](docs/modulos.md) · [esportes e Studio Bike Fit](docs/esportes.md) · [Industrial](docs/industrial.md) · [Via](docs/via.md) · [Bike Fit](docs/bike-fit.md) · [Bike Fit 3D](docs/bike-fit-3d.md) · [desempenho](docs/desempenho.md) · [Treinar](docs/treinar.md) · [serviços](docs/servicos.md) · [deploy e testes](docs/deploy-e-testes.md) · [licenças](docs/licencas.md) · [histórico](CHANGELOG.md).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `site/` | o site publicado: página inicial, sistema (`app.html`), Treinar (`treino/`), Relações (`relacoes/`) |
| `site/js/app.js`, `site/js/workspace.js` | tela de login (carga mínima) e o sistema, importado depois |
| `site/js/components/esportes/` | hub Esportes, painéis de cada esporte, Studio Bike Fit, Bike Fit 3D |
| `site/js/cv/` | runtime ONNX, registro de módulos e operadores (`operators/`, `operators/livres-a … livres-j`) |
| `servicos/treino/` | serviço de treino (FastAPI): RF-DETR, PatchCore e YOLO26, treinos com nome e fila |
| `servicos/youtube/` | serviço de busca do YouTube (só metadados; o vídeo toca no player oficial) |
| `servicos/via/` | memória da Via: conversas e base de conhecimento em PostgreSQL (pgvector) |
| `site/js/components/industrial/` | hub Industrial e os Studios BeltScan, CounterVision, Takt e Inspect |

Os **pesos dos modelos não estão no repositório** (≈1,4 GB): ficam no servidor em `site/models/` e `site/relacoes/models/`. Cada spec em `site/js/cv/runtime/onnx.js` e `models-livres-*.js` registra arquivo, tamanho, licença e origem.

## Rodar localmente

A página precisa de isolamento entre origens (threads do ONNX Runtime): sirva `site/` com os cabeçalhos
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp` e
`Cross-Origin-Resource-Policy: same-origin`, e coloque os pesos em `site/models/`.

Os serviços têm `Dockerfile`, `docker-compose.yml` e `LEIA-ME.md` próprios. Segredos (senha do Treinar etc.) vêm de variáveis de ambiente / `.env`, que não são versionados.

## Licença

AGPL-3.0 (ver `LICENSE`) — exigida pelos modelos Ultralytics YOLO26/YOLOE quando habilitados. Os demais modelos têm a licença de cada um registrada no catálogo (Apache-2.0, MIT, BSD…).
