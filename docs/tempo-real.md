# Detecção em tempo real: previsão, ladrilhos e sincronia (trânsito)

O problema era o vídeo com a imagem atrasada em relação às caixas. O veículo passava e a caixa ficava para trás, além de aparecerem caixas vazias ("fantasma"), caixas maiores que o carro e muitos carros sem caixa numa via expressa. A causa e a correção estão descritas abaixo. Nada sai do navegador e não foi criado nenhum modelo novo.

## Causa (medida)

1. **Detector lento.** O preset de trânsito usava RF-DETR int8. Ele roda em WASM, porque o quantizado não acelera no WebGPU, e leva de 300 a 500 ms. Com isso saíam de 1,7 a 3 resultados por segundo.
2. **O mesmo resultado parecia novo a cada quadro.** O detector republica a última lista de caixas em todos os quadros até chegar a próxima. O ByteTrack tratava a lista repetida como detecção nova. Ele re-casava a mesma caixa, a velocidade caía a zero e a previsão nunca era usada. A caixa ficava desenhada onde o carro estava no quadro inferido: 70 px atrás (70% da largura do carro), ou cerca de 725 ms.
3. **Caixas cruas do detector desenhadas junto.** Além das trilhas, apareciam as caixas cruas do detector (o "carro 47%" da captura), também atrasadas.
4. **Resolução de entrada baixa.** O detector recebia o quadro de trabalho, em procWidth (480 por padrão; a qualidade automática baixa até 160). O letterbox de 640² ainda achata o 16:9. Um carro de 50 px na fonte 1920 chegava ao modelo com cerca de 12 px. O recall na via expressa ficava entre 0 e 0,4%.
5. **Limiar desencontrado.** O detector usava 0,4, mas o rastreio só criava trilha com confiança 0,5. Por isso as detecções de 47–48% da captura nunca viravam trilha.

Também foi verificado que o YOLOX e o YOLO26 têm entrada estática (640²). Não dá para usar uma entrada menor (416/320) sem reexportar os modelos.

## O que mudou

### Detectores (`dnn.detect`, `rfdetr.detect`, `yolo26.detect`)

- **Carimbo.** Cada resultado novo ganha `state.resultsSeq` e `state.resultsT`, que é o instante do quadro inferido (`opkit.schedule` e as cópias locais em models.js e yolo26.js). O detector publica `ctx.detectionsCarimbo = { seq, t, lista }` (`runtime/tempo-real/carimbo.js`). O carimbo só vale se `lista === ctx.detections`.
- **Novo parâmetro `entrada`:** `quadro` (padrão, comportamento antigo intacto) | `plena` | `plena + ladrilhos` | `auto` (`runtime/tempo-real/entrada.js`).
  - Lê a fonte em resolução plena pelo novo `ctx.grabCanvas`, sem leitura de pixels (cai no `grabFull` com ROI ligada).
  - Recorta a caixa da ROI quando a ROI está ligada nas Ferramentas de mouse.
  - Parte em 2 ou 3 ladrilhos quase quadrados, com 12% de sobreposição, quando o quadro é largo. No `auto`, isso só acontece se o modelo roda a até 70 ms por run (WebGPU).
  - As caixas voltam ao quadro inteiro. Faz NMS por classe e funde o objeto cortado na emenda.
  - **Salto adaptativo:** no `auto`, o intervalo mínimo entre inferências é 5× o custo do preparo na thread principal. Num aparelho lento, a exibição continua fluida e a previsão cobre o intervalo.
- **`classes`** (filtro por nome) agora existe também no `dnn.detect` e no `yolo26.detect`.
- **`yolo26.detect` → `reserva`.** Sem a licença AGPL aceita, ou se o YOLO26n falhar, ele cai no YOLOX-S com o mesmo contrato de saída.
- As caixas cruas do detector levam `det: true` no overlay.

### Rastreio (`track.bytetrack`, CV-04) — reescrito, mesmo contrato

- Só processa detecção **nova**: pelo carimbo, ou, sem carimbo, por uma impressão digital da lista. Lista vazia conta como nova.
- **Kalman de velocidade constante no TEMPO** (`runtime/tempo-real/kalman.js`), por eixo, com os ruídos em escala do tamanho da caixa. O casamento usa a trilha prevista para o instante do quadro inferido. Há também uma segunda chance pela distância dos centros: 1,2 tamanhos, ou 3 tamanhos para trilha de uma medida só. Isso cobre o carro rápido com detector lento.
- **O desenho é a posição prevista para o quadro exibido** (`ctx.tExibir`, ou o próprio quadro). Quando chega uma detecção nova, a diferença entre a caixa velha e a nova se desfaz em cerca de 80 ms, sem salto. A previsão vai no máximo 1 s à frente.
- **Trilha perdida não é desenhada.** Só a posição prevista aparece, tracejada e com alfa 0,45, por `fantasmaMs` (300 ms).
- O tamanho da caixa é suavizado a partir das medidas. Ele não infla.
- `ocultarDetector` (padrão ligado) tira as caixas `det` do desenho.
- **A cadeia recebe a detecção REAL** (`ctx.detections` e `ctx.tracks`, a mesma até a próxima chegar), como antes. `ctx.tracks` ganhou `pred`, `vx`, `vy` e `tDet`. `ctx.tracksT` traz o instante.
- Telemetria nova: `detecções/s` e `latência det. ms`.
- **Mudou o sentido de dois parâmetros:** `nascer` e `perder` agora contam **detecções** (inferências), não quadros. Antes, a lista repetida fazia `nascer: 2` valer "o 2º quadro".
- Parâmetros novos:
  - `prever` (ligado);
  - `fantasmaMs` (300);
  - `ocultarDetector` (ligado);
  - `sincronizar` (`auto` | `sempre` | `nunca`);
  - `maxAtrasoMs` (600).

### Sincronia da imagem (Viewport)

- **`components/video/sincronia.js` (`AtrasoQuadros`).** Guarda cópias curtas do quadro na resolução de exibição (drawImage vídeo→canvas, de GPU para GPU) num anel de canvases reaproveitados. O teto é de 64 MB e 48 quadros, e nunca passa do atraso + 250 ms. Uma pausa ou busca maior que 1 s esvazia o anel.
- **Quando liga.** Só no caminho overlay, fora do histórico e com `track.bytetrack` na cadeia. No `auto`, liga só para arquivo e YouTube; câmera, tela e stream ficam ao vivo, com previsão.
- **Quanto atrasa.** O atraso é a latência da detecção mais um período (`ctx.sincronia.atrasoMs`, devolvido pelo executor), limitado a `maxAtrasoMs`. Aparece o rótulo "SINCRONIA −N ms" no canto, como o "HISTÓRICO".
- **Executor.** Passa `tQuadro`, `tExibir` e `grabCanvas` ao ctx e devolve `sincronia`.
- **drawOverlay.** O rect aceita `alpha` e `dash`.

### Presets de Trânsito (`presets-onda1a.js`)

- **Cadeia:** `dnn.detect` (YOLOX-S, Apache-2.0, WebGPU) com `{ classes: veículos + pessoa, conf: 0,25, iou: 0,45, maxDet: 100, entrada: 'auto' }`, seguido de `track.bytetrack { rastro: 15, perder: 30, altaConf: 0,4, nascer: 1 }`, das zonas e da CVC.
- **Por que `nascer: 1`.** Com detector mais lento, a trilha confirmada na 2ª detecção já saiu da zona de origem.
- **Por que não o YOLO26n.** Foi medido e não virou padrão. É mais rápido, mas achou 0% dos carros na via expressa e 67–77% na pista, contra 99–100% do YOLOX. Continua escolhível no nó, com `reserva`.

## Medições (Chrome 155 headless, Mac M, WebGPU real)

Os vídeos sintéticos usam como sprites carros recortados da captura do usuário (via expressa real).

- **"pista":** 1280×720, 4 faixas, carros de 65–115 px, 60–120 px/s.
- **"expressa":** 1920×1080, 9 faixas nos dois sentidos, 107 carros de 35–75 px, 150–350 px/s, perfil parecido com a via da captura.

Cada medição tem 8 s, com gabarito analítico por quadro exibido. O tempo de mídia vem do requestVideoFrameCallback e o desenho é capturado no canvas de exibição.

- **Erro:** distância do centro da caixa #id ao veículo.
- **Recall:** veículos com caixa a menos de 0,5 largura.
- **Fantasma:** caixa a mais de 1 largura de qualquer veículo.

| Cenário | Antes (preset RF-DETR) | Depois (preset YOLOX + previsão + sincronia) |
|---|---|---|
| Pista: erro caixa↔veículo | 70,5 px (69,5% da largura) | **2,5 px (2,9%)** |
| Pista: latência percebida (mediana) | 725 ms | **≈ 5 ms** (p90 ≈ 30 ms) |
| Pista: recall | 6,3% | **100%** |
| Pista: fantasmas por quadro | 1,32 (+1,8 de caixas cruas) | **0** |
| Pista: fps de exibição | 30 | 30 |
| Pista: inferências/s | 1,9 | 10,6 runs/s = 5,8 detecções/s (2 ladrilhos) |
| Pista, CPU 4×: erro / recall / fps | 73,5 px (71%) / 4,4% / 29,1 | **2,1 px (2,4%) / 100% / 24,6** |
| Pista, sem sincronia (como a câmera ao vivo) | — | 3,0 px (3,3%), recall 99,6% |
| Pista, YOLOX em WASM (sem WebGPU) | YOLOX antigo: 60 px (66%) | 2,9 px (3,1%), recall 99,6% |
| Expressa: recall | 0,2% | **61%** (42% sem sincronia; 76–80% em execuções isoladas) |
| Expressa: erro | 18 px (50%) | **2,5 px (5%)** |
| Expressa: fantasmas por quadro | 0,46 (+1,9 de caixas cruas) | 1,06 em ~29 caixas (3,7%; quase todas na borda do quadro) |
| Expressa: fps | 30 | 29,9 |
| Expressa, CPU 4× | recall 0,1%, 24,2 fps | recall 36%, erro 8,1 px (16%), 23,6 fps |

- **Melhor caso antigo:** o YOLOX no WebGPU já existia, mas sem previsão. Dava 14,3 px (15,8%) e 141 ms na pista, e 0,4% de recall na expressa.
- **Teste unitário de desenho:** 4 carros de 60–350 px/s, detector com latência/período de 70/60, 330/300 e 450/400 ms.
  - Antes: 20 / 38 / 48 px.
  - Depois, sem sincronia: 3,4 / 6,4 / 8,4 px.
  - Depois, com sincronia: 1,8 / 2,7 / 3,7 px.

### Contagens da CVC (18 movimentos da onda 1-a)

- **Teste original:** aprovado, com 18 exatos e 1 sem destino.
- **Detector com período e latência reais** (republicando a lista, como no app):
  - **33 e 70 ms:** 18 exatos com os parâmetros padrão, antes e depois.
  - **300 ms:**
    - antes: 0 movimentos e 211 IDs;
    - depois com `nascer: 1` (preset): **18 exatos, 19 IDs**;
    - depois com `nascer: 2`: 7.
  - **450 ms:** antes 0; depois 15 de 18. O carro passa pela zona de origem entre duas detecções.

### Regressão (vídeo "pista", linha no meio, gabarito de 13 cruzamentos)

| Cadeia | Antes | Depois |
|---|---|---|
| CounterVision YOLOX + ByteTrack | 12 (6/6), 21 IDs | 12 (6/6), 20 IDs |
| Zonas YOLOX + rastreio | 12, 21 IDs | 12, 20 IDs |
| Zonas RF-DETR + rastreio | 2, 91 IDs | 5, 18 IDs |
| Quadra RF-DETR + rastreio | sem erro, 103 IDs | sem erro, 17 IDs |

- **E2E dos 26 presets da onda 1-a:** todos aplicam, nenhum nó desliga e o console fica limpo (só o 404 de `models/custom/index.json` da cópia local).
- **Sincronia:** o buffer guardou 17 quadros de 1280×720 (62,7 MB, dentro do teto). A política `auto` ficou desligada em câmera, tela e stream.
- **Câmera falsa:** não pôde ser testada E2E no Chrome headless, que deu NotReadableError.

## Limites

- O recall na via expressa ainda depende do YOLOX-S. Carros abaixo de ~35 px na fonte continuam escapando. Uma grade 2×2 (4 runs) seria o próximo passo para câmera 4K.
- Em WASM, o `auto` não ladrilha, porque 2 × 400 ms é caro. Os carros pequenos da via expressa ficam com recall baixo (3–4%), mas a caixa dos achados bate (5 px).
- A sincronia atrasa a imagem do arquivo e do YouTube em até 600 ms. As marcações e os overlays que não são do rastreio continuam no tempo do quadro atual.
- Ainda não houve teste com um vídeo real gravado. O vídeo sintético usa carros reais recortados da captura.
- Ferramentas de teste: /Volumes/Armazena2/zz-staging/transito-rt-tools
  - `lag.mjs` com `testes/lag-e2e.js`: erro, latência, recall, fps e inf/s;
  - `testes/t-rt.mjs`: CVC com detector lento e erro de desenho;
  - `regr.sh`: regressão;
  - `gerar_video.py`: vídeos com gabarito;
  - `medicoes-antes2.txt` e `medicoes-depois2.txt`.
