# Arquitetura

O iaVision é um site estático que roda a visão computacional **no navegador**. O servidor serve arquivos e dá três apoios: login, treino de modelos e busca no YouTube. Nenhum quadro de vídeo vai para o servidor durante a análise.

```
navegador ─────────────────────────────────────────────────────────────┐
  Fonte (câmera · arquivo · tela · RTMP · YouTube)                      │
     │  quadro (ImageData, na "largura de processamento")               │
     ▼                                                                  │
  PipelineExecutor ── operador 1 ── operador 2 ── … ── operador N       │
     │      cada operador: apply(src, params, state, ctx)               │
     │      ctx.overlay (desenho) · ctx.metrics · ctx.detections …      │
     ▼                                                                  │
  Viewport (canvas) + painéis (React UMD + htm)                         │
     │                                                                  │
  ONNX Runtime Web (WASM com threads / WebGPU) — UMA fila de inferência │
└───────────────────────────────────────────────────────────────────────┘
            │ /api/*          │ /api/treino/*        │ /api/yt/*
            ▼                 ▼                      ▼
     login (PHP, hospedagem)  aivision-treino        aivision-yt
                              (FastAPI, treino)      (FastAPI, busca)
```

## Página e isolamento

- `site/app.html` carrega React, ReactDOM e htm vendorizados (UMD, em `site/vendor/`) e o módulo `site/js/app.js`. Não há build: os arquivos ES modules são servidos como estão.
- `app.js` só monta a tela de login; o sistema (`workspace.js`) é importado em segundo plano depois que o login pinta, e os painéis grandes carregam ao abrir (`components/SobDemanda.js`). Ver [desempenho.md](desempenho.md).
- A página exige **COOP `same-origin` + COEP `require-corp`** (as threads do ONNX Runtime precisam de `crossOriginIsolated`). Por isso tudo o que a página carrega vem da própria origem ou com `Cross-Origin-Resource-Policy` adequado — miniaturas do YouTube passam pelo serviço `aivision-yt`, e o iframe do YouTube usa `credentialless`. Sem `credentialless` (Safari, Firefox), o player vai para `/yt/player.html`, a única parte do site servida sem isolamento, numa janela própria comandada por BroadcastChannel (ver [fontes.md](fontes.md#youtube-no-safari-e-no-firefox) e [compatibilidade.md](compatibilidade.md)).
- `site/sw.js` é o service worker: rede primeiro para o app, cache permanente de nome fixo para os pesos `.onnx` (sobrevive às publicações), cache por versão para o `.wasm` e os modelos treinados. A cada publicação sobem **juntos** o `VERSION` do `sw.js` e o `?v=` dos CSS em `app.html`.

## Núcleo de visão (`site/js/cv/`)

| Arquivo | Papel |
|---|---|
| `registry.js` | lista de módulos (`MODULES`) e de operadores permitidos. Operador fora do registry não executa. |
| `executor.js` | `PipelineExecutor`: roda a cadeia quadro a quadro, guarda o estado de cada nó, isola erros (nó com erro é desligado). Publica `ctx.mirrored`. |
| `core.js` | buffers de imagem (pool), cinza, desfoque, Sobel, Otsu, `snapshot()` para uso assíncrono. |
| `runtime/onnx.js` | catálogo de modelos (`MODELS`, `AGPL_MODELS` + `models-livres-*.js`), escolha WebGPU/WASM por modelo (`EP_WEBGPU`) com queda automática, carga com progresso, **fila única de inferência com prioridade**, aceite AGPL. |
| `runtime/opkit.js` | `ensure` (carrega por modelo), `schedule` (inferência fora do loop de quadros), utilitários. |
| `runtime/tensor.js` | letterbox, esticar, recortar, tensor NCHW/NHWC. |
| `operators/*.js` | os operadores (ver [modulos.md](modulos.md)). Grupos livres em `operators/livres-a … livres-j` (runtime em `runtime/livres-*`). |

### Regras que o runtime impõe (e por quê)

1. **Inferência nunca bloqueia o render.** O operador devolve o último resultado conhecido; a inferência corre por fora (`schedule`), no máximo a cada `everyMs`.
2. **Uma inferência por vez.** Com `ort.env.wasm.proxy = true` todas as sessões vivem no mesmo worker, e chamadas simultâneas trocavam respostas entre modelos. `run`/`runFeeds` passam por uma fila — com prioridade para os modelos rápidos, para que um modelo lento (profundidade) não derrube a pose.
3. **Tensor reaproveitado é copiado.** O proxy transfere (esvazia) o `ArrayBuffer` do tensor para o worker; quem reusa embeddings/texto entre execuções faz `.slice()`.
4. **Um pedido de carga por modelo.** Operadores de dois modelos (pose = YOLOX + BlazePose, OCR = detector + CRNN) pedem cada um separadamente.
5. **Quadro guardado para depois de um `await` é cópia** (`snapshot`), nunca o `src`, que volta ao pool.

## Interface (`site/js/components/`)

Painéis encaixam em colunas laterais (`rail`) ou flutuam; no celular viram uma coluna só abaixo da barra (a barra mede a própria base e publica `--rail-top`). A barra do topo se mede e, se não couber, esconde rótulos e por fim vira menu ☰. Os painéis estão descritos em [interface.md](interface.md).

## Serviços

Ver [servicos.md](servicos.md): login (PHP na hospedagem, via proxy), `aivision-treino` e `aivision-yt`.
