# GPlanSiS|Vídeo — editor de vídeo interno

Tela cheia de edição com **controle de quadro exato** e timeline no estilo DaVinci Resolve: cortar (navalha), selecionar, apagar com ou sem fechar a lacuna, aparar, reordenar, marcadores, entrada/saída, zoom da timeline até o nível de quadro, recorte do quadro (crop) com proporções, zoom/pan por clipe (Ken Burns) e exportação MP4 quadro a quadro. Tudo roda no navegador; a mídia original nunca é alterada.

Abre pelo botão **✂** da barra de vídeo (`VideoControls.js`). Carregado sob demanda (`SobDemanda.js`): quem não edita vídeo não baixa nada.

## Abrir

| De onde | Como |
|---|---|
| Vídeo da Fonte | com a Fonte em **arquivo**, o ✂ abre direto esse vídeo (o mesmo objeto, lido do `blob:` da Fonte). A Fonte pausa enquanto se edita e volta ao fechar. |
| Outro arquivo | **📂 Abrir** › *Abrir arquivo de vídeo…*, ou arrastar o arquivo para a tela (MP4, MOV, M4V, WebM, MKV). |
| Gravação do app | a barra de vídeo entrega cada gravação concluída ao editor; **📂 Abrir** › *Última gravação*. |
| Câmera, tela, YouTube, RTMP | **📂 Abrir** › *Gravar trecho para editar*: grava com `MediaRecorder` o que o navegador já recebe da fonte (a `MediaStream` da câmera/tela/aba do YouTube, ou `captureStream()` do `<video>` do stream) e abre o resultado ao parar. |
| Outros módulos | `window.dispatchEvent(new CustomEvent('aiv:editar-video', { detail: { blob, nome } }))` ou `abrirEditorVideo({ blob, nome })` de `js/components/video/ponte.js`. |

**YouTube:** o iaVision não baixa vídeo do YouTube. O editor só recebe o que já está sendo capturado da aba (o vídeo do player oficial, como o pipeline vê), gravado em tempo real — a qualidade é a da captura, não a do arquivo original.

## Interface

- **Barra**: Abrir, desfazer/refazer, Recorte, Exportar, Quadros, mensagens, inspetor (☰), atalhos (?), fechar.
- **Visor**: mostra a **saída** (recorte e Ken Burns aplicados). Em modo recorte, o quadro inteiro com o retângulo, alças, terços e o tamanho em pixels. Lacuna = preto.
- **Transporte**: timecode `HH:MM:SS:FF` do playhead, clipe e quadro da mídia sob o playhead; ⏮ ◀| ◀◀ ▶ ▶▶ |▶ ⏭; I/O; repetir o trecho I→O; som.
- **Ferramentas**: Seleção / Navalha, Cortar no playhead, Apagar, Apagar e fechar, Marcador, Dividir nos pontos (marcadores + entrada/saída), Fechar lacunas, Encaixe (🧲), Ajustar, zoom (−, slider, +), Quadro (zoom de quadro).
- **Timeline** (canvas): régua com timecode, marcadores e faixa I/O; **V1** com miniaturas; **A1** com forma de onda; barra de rolagem.
- **Inspetor**: mídia (resolução, nº de quadros, fps — editável, duração, codecs), clipe selecionado (entrada/saída na mídia, duração, posição; Ken Burns), recorte (proporções, tamanho de saída, origem).

### Atalhos

| Tecla | Ação |
|---|---|
| Espaço | tocar / pausar |
| J · K · L | ré · pausa · avanço; repetir J ou L dobra a velocidade (1×, 2×, 4×) |
| ← → · ⇧← ⇧→ | 1 quadro · 10 quadros |
| ↑ ↓ | ponto de edição anterior / próximo |
| Home · End | início · fim |
| I · O | entrada · saída (a saída inclui o quadro do playhead); ⌥I, ⌥O, ⌥X limpam |
| M | marcador no playhead (de novo, remove) |
| B · Ctrl/⌘+B | cortar no playhead |
| ⇧B · A | ferramenta navalha · ferramenta seleção |
| clique · ⇧/Ctrl+clique · Ctrl/⌘+A | selecionar · somar à seleção · tudo |
| Delete · ⇧Delete | apagar a seleção deixando a lacuna · apagar e fechar (ripple). Sem seleção, agem no trecho I→O |
| arrastar clipe | mover; soltar sobre outro clipe reordena (inserção) |
| arrastar borda | aparar; ⇧ na saída empurra/puxa os clipes seguintes |
| Ctrl/⌘+Z · Ctrl/⌘+Y (⇧Z) | desfazer · refazer (200 passos) |
| C | recorte |
| N | encaixe nas bordas, playhead, marcadores e I/O |
| = · − · Ctrl/⌘+roda · pinça | zoom da timeline no ponteiro |
| ⇧Z · Z | ajustar à timeline · zoom de quadro |
| Ctrl/⌘+E | exportar |
| Esc | fecha diálogo / sai do recorte / limpa seleção / volta à seleção |

Com o editor aberto o teclado é dele (escuta em captura e para a propagação); Ctrl/⌘+K continua abrindo a Via. As ferramentas de mouse do app são desligadas enquanto o editor está aberto e voltam ao fechar.

## Como funciona

### Índice de quadros (`midia.js`)

O `<video>` só informa segundos; para parar no quadro N, cortar entre dois quadros e exportar sem perder ou duplicar nenhum, o editor lê o **contêiner**:

- **MP4/MOV**: `moov/trak/stbl` (`stts`, `ctts`, `stss`, `stsz`/`stz2`, `stsc`, `stco`/`co64`), MP4 **fragmentado** (`moof/traf/tfhd/tfdt/trun` — é o que o MediaRecorder do Chrome grava) e edit list (`elst`, abaixo). Codecs: `avc1/avc3` (avcC), `hvc1/hev1`, `vp09`, `av01`, `mp4a` (ASC do `esds`), `Opus`.
- **`ctts` sempre com sinal**, também na versão 0 (como o ffmpeg): o QuickTime/Fotos do macOS e do iPhone gravam `ctts` v0 com deslocamentos **negativos** (com `cslg`). Lido sem sinal, −1000 virava 4 294 966 296 ticks = +39 h 46 min a 30000/s — era a "duração de quase 40 horas" de um `.mov` de 17 s (out/2026).
- **Edit list** (`elst`): edições vazias viram atraso; a janela `[media_time, media_time + duração)` (duração convertida da escala do filme para a da mídia; trechos seguintes contíguos são somados) decide **quais amostras são apresentadas** — a mesma regra do ffmpeg, que é o demuxer do Chrome: `cts ≥ início` e `cts < fim`. As de fora (o GOP que um corte "sem reencode" do QuickTime/Fotos/`ffmpeg -ss -c copy` guarda antes do ponto de corte) ficam só no índice de **decodificação** (`presDe = −1`): o exportador ainda decodifica a partir delas. O primeiro quadro apresentado é o zero; o áudio começa exatamente em `media_time`. Trechos não contíguos (montagem dentro do contêiner) não são suportados: fica o primeiro e um aviso.
- **Ponto único de verdade da duração**: o índice — pts do último quadro apresentado + a duração dele (`stts`; sem ela, a mediana dos últimos intervalos). Se o cabeçalho (`tkhd` do vídeo ou `mvhd`) divergir mais que 1 s / 10 %, vale o índice e sai `console.warn('[vídeo] índice MP4: …')` (também em `ix.avisos` e no título do campo Duração do inspetor).
- `v.deslocAlt`: no Safari/QuickTime o zero do relógio é o `media_time` (até um quadro antes do primeiro quadro inteiro). A calibração do visor escolhe entre 0 e esse valor (abaixo).
- `v.rotacao`: rotação da matriz do `tkhd` (vídeo de celular em pé).
- **WebM/MKV**: EBML — `Info`, `Tracks`, `Cluster`, `SimpleBlock`/`BlockGroup`, tamanho desconhecido (MediaRecorder), `CodecDelay` do Opus.

Só cabeçalhos são lidos (`Blob.slice`); os bytes das amostras são lidos sob demanda na exportação. Tempos em µs, já em tempo de apresentação. O resultado: `pts[]` de cada quadro (ordem de apresentação), mapa apresentação↔decodificação, quadros-chave, e a lista de pacotes de áudio. fps nominal = mediana dos intervalos (arredondada a 23,976/24/25/29,97/30/50/59,94/60…); taxa variável é detectada e preservada.

Contêiner ilegível: o editor estima os quadros pela duração e pelo fps medido com `requestVideoFrameCallback` (sem garantia de quadro exato; a exportação vira tempo real).

### Modelo de edição (`edl.js`)

EDL não destrutiva: `{ id, a, b, em, kb? }` — quadros `[a, b)` da mídia, posição `em` (µs) na timeline e, opcionalmente, Ken Burns `{ a: ret, b: ret }`. A duração do clipe é a soma das durações **reais** dos quadros (`pts[b] − pts[a]`): vídeo de taxa variável não acelera ao ser editado e o áudio continua sincronizado. Retângulos normalizados 0..1. O playhead parado fica sempre no início de um quadro.

Salvo no `localStorage` por mídia (`gplansis.video.edl.<tamanho-duração-quadros-nome>`, 12 mais recentes): abrir o mesmo arquivo restaura clipes, marcadores, I/O, recorte e fps.

### Visor (`reprodutor.js`)

- Parado: buscar o quadro q = `currentTime` no **meio** do quadro (`pts + dur/2`), sem ambiguidade de arredondamento; buscas seguidas são coalescidas.
- Tocando: `requestVideoFrameCallback` informa o quadro apresentado (`mediaTime`), de onde sai a posição na timeline. Fim de clipe: o próximo contíguo na mídia segue sem busca; senão busca e continua; lacuna anda no relógio, em preto.
- J (ré) é feito por buscas sucessivas no relógio (o `<video>` não toca para trás).
- Calibração ao abrir: busca o meio do quadro 2 e lê o `mediaTime` apresentado. Candidatos conhecidos: 0 (Chrome/ffmpeg) e `v.deslocAlt` (Safari/QuickTime com edit list fora da grade de quadros); vale o que alinha o quadro mostrado com a grade do índice; nenhum alinhando, mede o deslocamento como antes.
- Sem `requestVideoFrameCallback` (Safari < 15.4, Firefox antigo) a reprodução e a exportação em tempo real seguem por rAF + `currentTime` (`seguirQuadros()` em `reprodutor.js`), sem a garantia de quadro exato.
- Sem gesto do usuário o navegador bloqueia o som: o editor segue tocando mudo e avisa.

### Timeline (`timeline.js`, `miniaturas.js`, `onda.js`)

Canvas redesenhado só quando algo muda (um `requestAnimationFrame` por lote de pedidos), em **duas camadas**: a base (régua, clipes, miniaturas, onda, marcadores, I/O) fica num canvas fora da tela e só é refeita quando a vista ou a edição mudam; o playhead — que anda a cada quadro tocando ou arrastando — é "copiar a base + uma linha" (`pedir(true)`, ~0,05 ms). Cores do tema lidas uma vez (relidas ao trocar o tema). Zoom de "vídeo inteiro" até ~80 px por quadro; roda + Ctrl/⌘, pinça de toque e, no Safari, a pinça do trackpad (`gesturestart/gesturechange/gestureend`).

O playhead e o timecode ficam **fora do React**: o timecode é escrito direto no DOM (um rAF por lote) e o slider de zoom é atualizado pela `ref` — rolar, dar zoom, tocar ou arrastar não re-renderiza a tela.

- **Miniaturas** (`miniaturas.js` + `miniaturas-worker.js`): um **Worker** decodifica com `VideoDecoder` (software, para não disputar o decodificador de hardware do visor) só as amostras necessárias, direto do `Blob`; pedidos do mesmo GOP saem de uma passada; cada quadro é reduzido a 160 px (`createImageBitmap` com resize, ou `OffscreenCanvas`) e o bitmap é **transferido**. A timeline pede só as visíveis; cada desenho troca a lista (o que saiu da tela é cancelado, inclusive no meio de um GOP). Cache **LRU** de 400 bitmaps (~23 MB). De longe, o pedido é arredondado ao **quadro-chave** mais próximo. O decodificador do worker é fechado após 1,5 s parado. Reserva (sem Worker/WebCodecs, codec não suportado, índice sintético ou vídeo com rotação): um `<video>` oculto busca o quadro, como antes.
- **Forma de onda** (`onda.js` + `onda-worker.js`): o áudio inteiro é decodificado num **Worker** (`AudioDecoder` sobre os pacotes do índice, leitura em blocos), guardando só o pico de cada 1/400 s (1 byte): 10 min = 240 KB; trechos chegam a cada ~200 ms. Uma **pirâmide de máximos** (×8 por nível) deixa o desenho O(largura) em qualquer zoom e duração. Reservas: o mesmo na thread principal (sem `AudioDecoder` em Worker); `decodeAudioData` até 300 MB.

### Exportar vídeo (`exportar.js`)

Caminho exato (WebCodecs + MP4):

1. para cada trecho da EDL, lê as amostras a partir do quadro-chave anterior ao primeiro quadro;
2. `VideoDecoder`; cada `VideoFrame` traz o `pts` da amostra → sabe-se exatamente qual quadro da mídia é; o pré-rolo é descartado;
3. desenha o quadro recortado (recorte ou Ken Burns interpolado, suave nas pontas) num `OffscreenCanvas` do tamanho de saída e codifica com `VideoEncoder`: **H.264** (`avc1.640034` High 5.2 … `avc1.42001f`, o primeiro que o navegador aceitar), senão VP9 ou AV1; bitrate ~0,12 bit/pixel/quadro (2–40 Mbit/s) × qualidade (Alta 1,6 · Normal 1 · Leve 0,55); quadro-chave a cada 2 s; cada quadro mantém sua duração original; lacunas viram quadros pretos no fps nominal;
4. **áudio**: `AudioDecoder` só nos pacotes dos trechos (3 de pré-rolo), cortado na **amostra** exata do início/fim de cada trecho, lacunas em silêncio, `AudioEncoder` **AAC** (`mp4a.40.2`, 160 kbit/s), Opus como reserva;
5. **mp4-muxer 5.2.2** (MIT, `vendor/mp4-muxer-5.2.2.mjs`) com `StreamTarget`: o arquivo é montado em pedaços (o remendo final do tamanho do `mdat` é aplicado no lugar), áudio intercalado com o vídeo por timestamp.

Dois detalhes de sincronismo, medidos:

- o `AudioDecoder` do Chrome numera a saída a partir do timestamp do primeiro pacote e **prende timestamps negativos no zero** — e o primeiro pacote de um AAC com edit list tem `pts` negativo (priming). Tudo entra no decodificador deslocado em +10 s e volta ao sair;
- o codificador AAC acrescenta ~2112 amostras de *priming* e o MP4 gerado não tem edit list: o atraso é **medido** (codifica um impulso, decodifica, procura o pico) e os pacotes inteiros de atraso são descartados. Sobra < 1,5 ms.

Saída: tamanho do recorte × escala (100/75/50/25 %), sempre em números pares. Trecho: timeline inteira ou entrada→saída. Barra de progresso e **Cancelar**. Resultado: **Baixar** (caixa "Salvar como" quando existe), **Usar como fonte** (abre como arquivo no iaVision e fecha o editor), **Abrir no editor**.

**Sem codificador de áudio** (Safari 16.4–18: WebCodecs de vídeo, mas sem `AudioEncoder`): com áudio na mídia, o diálogo oferece **Tempo real, com som** (padrão; `MediaRecorder` grava o som) ou **Quadro exato, sem som** (`sondarExportacao()` em `exportar.js`; opção `modo` de `exportarVideo`).

**Reserva (tempo real)**: sem WebCodecs, codec que o navegador não decodifica ou contêiner ilegível — toca cada trecho num `<video>` oculto, desenha num canvas e grava com `MediaRecorder` (WebM VP9/VP8 + Opus; MP4 no Safari). Leva o tempo do vídeo e não garante quadro exato; a interface avisa.

### Exportar quadros → +Projeto / Treinar

**🖼 Quadros**: clipes selecionados, entrada→saída ou tudo; um a cada N quadros ou N segundos; largura máxima; recorte e Ken Burns aplicados; JPEG 0,92. Decodifica com o mesmo caminho exato (os quadros são os da mídia, não capturas de tela). Destinos:

- **+Projeto/Treinar** — evento no `window`:

  ```js
  window.dispatchEvent(new CustomEvent('aiv:prints', { detail: {
    imagens: [Blob, ...],        // image/jpeg, na ordem da timeline
    origem: 'video',             // etiqueta curta (o +Projeto usa como origem do print)
    nomes: ['video-00-00-01-15-q45.jpg', ...],
    detalhes: { midia, trecho: { t0, t1 }, quadros: [q, ...], tempos: [µs, ...] },
  } }));
  ```

  O +Projeto (`js/projeto/base.js`) escuta e guarda as imagens como prints (e abre o painel); o Treinar as recebe por lá. Função: `emitirPrints(imagens, nomes, detalhes)` em `js/components/video/ponte.js`.
- **ZIP** de JPEG (sem compressão, nomes UTF-8) — `zip.js`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `js/components/video/StudioVideo.js` | a tela (React/htm), teclado, abrir/gravar, diálogos; injeta `css/video-editor.css` |
| `js/components/video/midia.js` | índice MP4/WebM, leitura de amostras, utilitários de quadro |
| `js/components/video/edl.js` | modelo, operações (cortar, apagar, ripple, aparar, mover, fechar lacunas), desfazer, timecode, persistência |
| `js/components/video/reprodutor.js` | visor, reprodução da timeline, J/K/L, recorte com alças |
| `js/components/video/timeline.js` | timeline em canvas e interação |
| `js/components/video/miniaturas.js` · `miniaturas-worker.js` | miniaturas: cache LRU na página, decodificação (WebCodecs) no Worker |
| `js/components/video/onda.js` · `onda-worker.js` | forma de onda: pirâmide de picos na página, decodificação no Worker |
| `js/components/video/exportar.js` · `zip.js` | exportação de vídeo e de quadros |
| `js/components/video/ponte.js` | entrada pelo app (✂, gravações, `aiv:editar-video`, `aiv:prints`) |
| `css/video-editor.css` | tema `.vde` (claro e escuro; visor e timeline no palco escuro) |
| `vendor/mp4-muxer-5.2.2.mjs` | muxer MP4 (MIT) |
| `js/components/VideoControls.js` | botão ✂ e entrega da gravação (mudança mínima) |
| `js/workspace.js` | registra a tela sob demanda (`studioVideo` no store) |

Gancho de teste: `window.aivVideo` (estado, abrir, irPara, passo, cortarEm, aplicar, exportar, quadros, timeline, reprodutor…).

## Testes (out/2026, Chrome 1440 e 390, claro e escuro)

Vídeos gerados com ffmpeg: `testsrc2` 1080p30 com o **número do quadro desenhado em 12 blocos binários** e áudio com um tom de 1 kHz nos primeiros 100 ms de cada segundo; variantes WebM VP9/Opus 720p25, MP4 fragmentado e 10 min 1080p (850 MB). O número de cada quadro exportado é lido de volta dos pixels (ffmpeg + numpy).

| Teste | Resultado |
|---|---|
| clipes [30,90) + lacuna de 10 + [300,345) + [1000] | 116 quadros: 30…89, 10 pretos, 300…344, 1000 — exatos |
| recorte 600×1000 em (16,16), quadros [100,160) | 600×1000, 60 quadros 100…159 |
| recorte 960×540 + Ken Burns no 2º clipe | 960×540, 120 quadros, sequência exata |
| WebM VP9/Opus, MP4 fragmentado, 10 min (quadros 9000–9089) | sequências exatas; MP4 H.264 + AAC |
| áudio após cortes | início do tom em 1,0011 s / 2,3345 s / 3,3344 s (esperado 1,0 / 2,3333 / 3,3333) — < 2 ms |
| visor: ←/→, ⇧→, ir ao quadro 900, fronteira de corte 29→60 | quadro mostrado = quadro pedido (lido dos pixels do `<video>`) |
| tocar atravessando um corte; L 2×; J | nenhum quadro do trecho cortado aparece; para no quadro que está na tela |
| aparar, navalha, reordenar e seleção por ponteiro; roda + Ctrl; régua | conforme a EDL esperada |
| gravar trecho da câmera (falsa) | MP4 fragmentado do MediaRecorder indexado e editável |
| quadros → `aiv:prints` | 7 JPEG chegaram ao +Projeto, painel abriu |
| reserva tempo real | WebM VP9 + Opus, ~2 quadros perdidos em 60 (esperado nesse modo) |
| regressão da barra (`regressao.js`) | sem falhas |

Desempenho (10 min 1080p, 850 MB, GOP 250): índice em ~0,18 s; busca de quadro 16–100 ms; desenho da timeline < 0,3 ms; ~17 miniaturas na tela na primeira passada; forma de onda em segundo plano; exportar 90 quadros 1080p ~0,45 s; heap ~54 MB.

### Duração e quadros × ffprobe (out/2026, depois da correção)

`.mov` reais do QuickTime/Fotos (Feijao1/2/3, ensaio de bancada) e sintéticos com o número do quadro desenhado: VFR (15 → 30 fps + jitter) com timescale 600 e 90000, corte sem reencode (`-ss -c copy`: edit list fora da grade de quadros, timescale 19200), o mesmo com `+faststart`, `ctts` v0 negativo + edit list (estilo Apple), 2 min 720p 22 MB estilo Apple, 10 min 1080p.

| arquivo | antes (quadros · duração) | depois | ffprobe (quadros decodificados · último pts + dur) |
|---|---|---|---|
| Feijao2_edit.mov (o do relato) | 514 · 39:46:22 (143 182 s) · 15 fps "variável" | 499 · 16,633 s · 30 fps | 499 · 16,633 s (trilha 16,622 s) |
| Feijao1_trim.mov | 355 · 143 177 s | 354 · 11,800 s | 354 · 11,800 s |
| Feijao3_Trim.mov | 443 · 143 180 s | 441 · 14,700 s | 441 · 14,700 s |
| ensaio_bancada_original.mov | 626 · 20,867 s | 626 · 20,867 s | 626 · 20,867 s |
| vfr600.mov / vfr90k.mov | 540 · 20 s | 540 · 20 s (VFR) | 540 · 20 s |
| elst.mov / elst_fs.mov | 540 · 16,63 s (51 quadros a mais) | 489 · 16,6 s | 489 · 16,6 s |
| neg_v0.mov | 330 · 143 176 s | 315 · 10,5 s | 315 · 10,5 s |
| longo720.mov | 3632 · 143 286 s | 3621 · 120,7 s | 3621 · 120,7 s |
| teste60 / frag / teste12.webm / teste600 | iguais | iguais | iguais |

Em todos, a lista de pts do índice é idêntica à do ffprobe (diferença máx. 0 ms). No Chrome, o quadro mostrado pelo visor (lido dos pixels) é o do índice em 20 posições por arquivo + passos de quadro, e a exportação de dois trechos com lacuna sai com a sequência exata (vfr600, vfr90k, elst, elst_fs, neg_v0, longo720).

### Desempenho antes × depois (Chrome headless 1440×900, mediana de 2 rodadas alternadas)

| operação | Feijao2 22 MB 720p | longo720 21 MB 2 min 720p | teste60 55 MB 1080p | teste600 360 MB 10 min 1080p |
|---|---|---|---|---|
| índice | 3 → 3,5 ms | 16 → 7 ms | 7,5 → 7,5 ms | 188 → 20 ms |
| 1º quadro | 234 → 128 ms | 304 → 134 ms | 142 → 142 ms | 368 → 218 ms |
| miniaturas visíveis prontas | 305 → 180 ms | 380 → 174 ms | 245 → 235 ms | 473 → 284 ms |
| forma de onda pronta | 608 → 200 ms | 2296 → 773 ms | 583 → 522 ms | 4630 → 3448 ms |
| tarefas longas (> 50 ms) ao abrir | 393 → 0 ms | 1348 → 0 ms | 0 → 0 | 202 → 0 ms |
| arrastar o playhead | 5,5 → 32,9 quadros/s | 6,8 → 54,8 | 48,5 → 50 | 22,6 → 24,5 |
| tocar: rAF médio / desenho da timeline | 87 → 16,7 ms / 90 → 0,02 ms | 80 → 16,7 / 81 → 0,02 | 16,7 → 16,7 / 0,2 → 0,02 | 16,7 → 16,7 / 0,5 → 0,02 |
| redesenho completo da timeline | 79 → 0,1 ms | 84 → 0,1 ms | 0,1 → 0,1 ms | 0,4 → 0,2 ms |
| rolagem (rAF médio) | 59 → 16,7 ms | 62 → 16,7 ms | 16,7 → 16,7 | 16,7 → 16,7 |
| heap JS | 65 → 10 MB | 66 → 11 MB | 10 → 10 MB | 31 → 13 MB |
| exportar 90 quadros | 358 → 360 ms | 341 → 326 ms | 506 → 490 ms | 555 → 528 ms |

Tocar: 29,5 fps, 0 quadros perdidos em todos. Regressão (t1–t12 do editor, `regressao.js` da barra): sem falhas; exatidão de quadro, recorte, Ken Burns e áudio (< 2 ms) iguais.

## Limitações

- **YouTube**: só o trecho capturado em tempo real (o que a aba mostra), nunca o arquivo original; a qualidade é a da captura.
- Uma mídia por projeto (sem mesclar arquivos diferentes na mesma timeline); uma trilha de vídeo e uma de áudio; sem transições, títulos ou ajuste de volume.
- Ken Burns: dois enquadramentos (início e fim do clipe) com interpolação suave; a proporção é a do recorte geral.
- Arrastar um clipe sobre outros reordena e encosta os seguintes (as lacunas depois do ponto de inserção somem).
- A mídia não fica salva no navegador, só a edição: para continuar, abra o mesmo arquivo. Gravações e exportações vivem na memória da aba até serem baixadas.
- Exportação de vídeo longo guarda o arquivo de saída na memória antes de baixar (~1× o tamanho do MP4).
- Arquivos HEVC/AV1 dependem do suporte do navegador ao decodificador; sem ele, exportação em tempo real.
- Timecode sem drop-frame (29,97 conta 30 quadros por "segundo" de timecode).
- O áudio de saída tem a taxa e os canais da mídia (até 2); AAC depende do codificador do sistema (Opus como reserva).
- Vídeo com **rotação** na matriz (`tkhd`, celular em pé): o visor mostra em pé (o `<video>` gira), mas a exportação quadro a quadro e o recorte usam o quadro codificado, sem girar; as miniaturas usam a reserva com `<video>`.
- Edit list com vários trechos não contíguos: só o primeiro trecho é usado (aviso no console).
- Busca no visor (arrastar o playhead) depende do `<video>` do navegador: num arquivo com GOP longo (quadro-chave a cada 8 s, 1080p) são ~10–20 quadros/s mostrados; com GOP de 1–2 s, 30–45.
