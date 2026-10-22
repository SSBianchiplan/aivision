# Desempenho

Medições em Chrome num Mac Apple Silicon, vídeo `ciclista.webm` (640×360, 25 fps); "4×" é a CPU da thread principal reduzida 4× e "4G" é 300 ms de latência.

## Placa de vídeo (WebGPU)

`site/js/cv/runtime/onnx.js` testa um adaptador real (`navigator.gpu.requestAdapter()`). Com adaptador, carrega `vendor/ort/ort.webgpu.min.js` (ORT 1.20.1); sem, o `ort.min.js` só com WASM. Cada modelo roda em WebGPU **só se estiver na lista `EP_WEBGPU`** — modelo novo, inclusive os treinados pelo usuário, fica em WASM até ser medido. Se a sessão WebGPU falhar na criação ou na primeira execução, o modelo é recriado em WASM sozinho. `modelStates()` mostra o EP real, o tempo de execução e o último erro de GPU. Para diagnóstico: `localStorage['iav.ort.ep'] = 'wasm' | 'webgpu'`.

| Modelo | WASM (ms) | WebGPU (ms) | Decisão |
|---|---|---|---|
| Pose (BlazePose) | 25,7 | 9,9 | WebGPU |
| YOLOX | 209 | 43 | WebGPU |
| YuNet | 19,7 | 12,1 | WebGPU |
| RTMO-s | 240 | 63 | WebGPU |
| YOLO26n / pose / seg | 51 / 56 / 67 | 19 / 37 / 32 | WebGPU |
| MobileSAM (encoder) | 623 | 220 | WebGPU |
| MobileCLIP2 (imagem) | 138 | 16,5 | WebGPU |
| Depth Anything q8, RF-DETR int8, SAM2 mm8 | — | sem ganho ou pior | WASM (quantizados não aceleram) |
| BiRefNet, PP-HumanSeg, YOLO26-depth | — | saída errada sem exceção | WASM |
| SFace, MediaPipe palma/malha | — | falha ou mais lento | WASM |

Ângulos do Bike Fit com a mesma entrada: diferença 0,000°; médias da sessão diferem < 0,15° (o rastreio amplifica diferenças de 0,03 px no recorte). A lista foi medida em GPU Apple; outras GPUs podem divergir em silêncio — a queda automática só pega exceções.

## Fila com prioridade

Continua uma inferência por vez (o proxy do ORT troca respostas de execuções simultâneas), mas com duas prioridades: **rápida** (modelos de tempo real ou com média < 100 ms) e **lenta**. Pedido rápido pendente passa na frente dos lentos; contra a fome, depois de um lento terminar, o próximo lento entra após 2× a duração dele (0,3–10 s), mesmo com rápidos na fila.

| Cenário (poses/s, 1× / 4×) | Antes | Agora |
|---|---|---|
| Bike Fit sozinho | 22,7 / 20,1 | 23,7 / 21,2 (limitado pelo vídeo) |
| Bike Fit + profundidade | 1,17 / 0,83 | 15,6 / 10,5 |
| Bike Fit + profundidade + detecção + rosto | 0,92 / 0,58 | 13,4 / 8,5 |

Custo: a profundidade cai de ~0,9 para 0,33–0,5 inferências/s quando divide o worker com modelos de tempo real (mapa até 2–3 s atrasado).

## Abertura

`site/js/app.js` carrega só a tela de login (`AccessGate`, `store`, `auth/api`, `vendor`); o resto do sistema está em `site/js/workspace.js` e é importado em segundo plano assim que o login pinta. Painéis grandes (esportes, Studio, Bike Fit 3D, Contexto, Legendas) usam `components/SobDemanda.js` e carregam ao abrir. `app.html` tem `modulepreload` do caminho do login.

| Medida (4G + CPU 4×) | Antes | Agora |
|---|---|---|
| JS até a tela de login | 155 requisições, 743 KB gzip | 8 requisições, 61 KB gzip |
| Tela de login visível (1ª visita) | 9,8–10,0 s | 1,4 s |
| Sessão ativa → app (1ª visita) | 10,0 s | 2,1 s |

## Service worker

- Pesos `.onnx` num cache de nome fixo (`iav-models-v1`): sobrevivem às publicações. Antes, cada deploy apagava os modelos baixados.
- `.wasm` do runtime e `models/custom/` (treinados, podem ser republicados com o mesmo nome) num cache por versão.
- Primeira visita não recarrega mais a página quando o service worker assume.

## Desenho

- **Studio Bike Fit** redesenha só o que mudou: vídeo quando o Viewport pinta um quadro novo (contador `display.quadros`), gráficos quando chega amostra, parte estática num canvas fora da tela, séries limpas incrementalmente. Thread principal a 4×: 11,4 % → 5,4 % tocando, 8,9 % → 0,2 % pausado. Gravando, desenha sempre a 30 q/s.
- Canvases lidos de volta pelos operadores de pose e pelo letterbox usam `willReadFrequently`.
- Celular (`pointer: coarse`): sem `backdrop-filter` na barra, painéis e barra de vídeo.

## Pendente

Casca do app servida do cache do service worker com manifesto pré-cacheado (visita repetida ~0,3 s); separar o manifesto dos operadores livres do código de cada um; validar a lista WebGPU em GPUs de celular.

## Auditoria de outubro (v84 → v85)

Chrome headless, Mac Apple Silicon, janela de 12 s por cenário, 1× e CPU 4×. "ms/quadro" = tempo de tarefas da thread principal dividido pelos quadros pintados pelo Viewport. Ferramentas em `scratchpad/perf2/` (instrumentação de renders do React, rAF, timers, listeners, observadores, `getBoundingClientRect` e chamadas de canvas por arquivo). Outros agentes rodavam ao mesmo tempo: variação de ±20 % entre execuções iguais.

| Cenário | CPU | fps | ms/quadro | thread ocupada | long tasks (n/ms) |
|---|---|---|---|---|---|
| Só vídeo | 4× | 25 → 25 | 3,4 → 3,0 | 8,5 → 7,4 % | 0 → 0 |
| Bike Fit + Studio | 4× | 19 → 25 | 39,5 → 19,9 | 75 → 50 % | 10/585 → 0 |
| BeltScan (ensaio + Seção) | 1× | 13 → 28 | 54 → 17 | 73 → 48 % | 72/3863 → 0 |
| BeltScan (ensaio + Seção) | 4× | 6,3 → 13,2 | 150 → 57 | 95 → 75 % | 76/9782 → 102/5431 |
| Studio BeltScan | 1× | 13 → 24,5 | 58 → 20 | 76 → 48 % | 96/5556 → 0 |
| CounterVision por cor | 4× | 21,5 → 29 | 25 → 14 | 54 → 41 % | 0 → 0 |
| Takt | 4× | 9 → 15 | 92 → 39 | 84 → 58 % | 94/8083 → 2/101 |
| Inspect com programa | 4× | 9,2 → 9,7 | 41 → 20 | 38 → 20 % | 3/1090 → 2/404 |
| Ferramentas (24 marcações + lupa/grade/mira/réguas) | 4× | 25 → 25 | 13,2 → 5,6 | 34 → 14 % | 0 → 0 |
| 18 painéis abertos | 4× | 25 → 25 | 6,0 → 2,2 | 15 → 5,5 % | 0 → 0 |
| +Projeto com 100 prints | 4× | 25 → 25 | 3,6 → 2,5 | 9 → 6 % | 0 → 0 |
| Via, 79 mensagens, digitando | 4× | tecla 3,1 → 1,6 ms | 7,6 → 7,5 | 19 → 19 % | 0 → 0 |

Memória: 2 min por cenário com GC forçado no início e no fim; sem vazamento (crescimento de 1–3 MB = sessão/histórico do próprio cenário; nós de DOM e listeners estáveis).

O que mudou:
- **Quadro pleno primeiro** (`Viewport.js` + `quadroPleno: true` no operador BeltScan): ler vídeo decodificado na GPU para canvas de CPU custa uma cópia do quadro inteiro (4–13 ms a 1280×720) qualquer que seja o destino. Com só operadores `quadroPleno` no pipeline, a fonte é lida uma vez em resolução plena e o quadro de trabalho sai dela por redução canvas→canvas. Os pixels que o operador lê (grabFull) são os mesmos de antes.
- Tamanho do canvas de exibição por `ResizeObserver` (era `getBoundingClientRect` por quadro): 33 → 5 leituras/s.
- fps da barra do topo e da barra de vídeo em componentes próprios (a MenuBar re-renderizava 4×/s e cada render media a barra com layout forçado); o pulso de 8 Hz da barra de vídeo só re-renderiza quando algo visível mudou (YouTube segue sempre).
- `Panel.js`: `railTop()` (getComputedStyle) no inicializador preguiçoso do `useState` — rodava a cada render de cada painel.
- `cv/numfmt.js`: `Intl.NumberFormat` em cache no lugar de `toLocaleString('pt-BR', {…})` nas faixas e indicadores do BeltScan, CounterVision, Takt e Inspect (texto idêntico, conferido em 14 mil combinações).
- Studio CounterVision: vídeo redesenhado só com quadro novo/retrato novo/clique/tamanho/tema (era a cada rAF, também pausado).
- Auxílios de exibição (lupa, grade, mira, réguas): redesenho coalescido em um por quadro de tela; o quadro do vídeo desenha na hora.
- Widget Seção da correia: lugar automático em cache até mudar o plano das colunas, a janela ou um widget (eram ~70 `getBoundingClientRect`/s).
- Via: `Markdown` memorizado pelo texto (cada tecla reanalisava todas as respostas).
- Service worker: vídeo/áudio fora do cache da casca e gravação só do que mudou (ETag ou Last-Modified + tamanho) — antes cada abertura regravava ~200 respostas.
- Celular: sem `backdrop-filter` também nas Ferramentas, listas/cartões delas e no widget Seção.

Propostas maiores (não aplicadas): pipeline JS (BeltScan, CounterVision cor, Takt) num Worker com `VideoFrame` transferido — maior ganho restante (BeltScan: 35–47 % da thread é o núcleo), risco alto; leitura do quadro de trabalho por GPU (canvas acelerado + leitura pequena) — 2–8 ms/quadro, muda pixels (revalidar módulos); `miniCinza` amostrando a cada 2 px (−75 %, muda limiares do quadro parado); recorte do Bike Fit com `imageSmoothingQuality 'low'`; miniaturas pequenas no +Projeto (IndexedDB); fontes do Google sem bloquear a renderização; pré-cache da casca por manifesto.
