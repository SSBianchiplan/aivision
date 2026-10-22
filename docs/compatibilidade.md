# Compatibilidade por navegador

O iaVision decide quase tudo por **detecção de recurso**: testa se a API existe (e, quando importa, se funciona) e escolhe o caminho. O user agent só é usado para separar celular de computador (YouTube, seletor de câmera) e para um rótulo do motor de fala do Safari.

Legenda: ✅ funciona · ⚠️ funciona com limitação · ❌ não funciona · — não se aplica.
«Testado» = WebKit do Playwright 1.63 (Safari 26.6, macOS) e Chrome 14x no computador, com o servidor de teste (COOP/COEP como a produção). O Safari 15–18 não foi testado aqui: a coluna segue o que o código detecta e o que essas versões suportam.

## Resumo por funcionalidade

| Funcionalidade | Chrome / Edge | Safari 26 (macOS) | Safari 15–18 (macOS) | Firefox | Celular |
|---|---|---|---|---|---|
| Login, painéis, barra, hub, presets | ✅ | ✅ testado (34/34 da regressão) | ✅ | ✅ | ✅ |
| Isolamento (threads do ONNX) | ✅ | ✅ testado, também sob o service worker | ✅ (15.2+) | ✅ | ✅ |
| **Fonte › Câmera** (USB, integrada, Continuity Camera) | ✅ | ✅ testado (câmera simulada, 28 fps) | ✅ | ✅ | ✅ |
| Fonte › Arquivo (imagem/vídeo) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Fonte › Captura de tela | ✅ aba, janela ou tela | ✅ janela ou tela | ✅ | ✅ | ❌ (o celular não expõe) |
| Fonte › RTMP / câmera IP (WHEP) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Fonte › YouTube** (assistir) | ✅ embutido | ✅ testado, **janela própria** | ⚠️ janela própria | ⚠️ janela própria | ✅ Chrome Android embutido · iPhone: link |
| **Fonte › YouTube** (usar como fonte, quadros) | ✅ Element/Region Capture da aba | ✅ testado, **captura da janela** recortada | ⚠️ idem | ⚠️ idem | ❌ |
| Pipeline / modelos (WASM multithread) | ✅ | ✅ testado | ✅ | ✅ | ✅ |
| Modelos em WebGPU | ✅ | ✅ testado (YOLO26n em WebGPU, 7 detecções na foto) | ❌ sem adaptador → WASM | ⚠️ depende da versão → WASM | ⚠️ |
| Códigos (QR, EAN…) | ✅ BarcodeDetector | ✅ ZXing | ✅ ZXing | ✅ ZXing | ✅ |
| Legendas (fala) | ✅ | ✅ nativo (Apple) ou Whisper; Whisper cai para WASM se o WebGPU falhar | ✅ | ⚠️ sem reconhecimento nativo → Whisper/servidor | ⚠️ |
| Gravação (REC) | ✅ MP4/WebM | ✅ MP4 (H.264 + AAC) | ✅ MP4 | ✅ WebM | ⚠️ |
| Salvar gravação com «Salvar como…» | ✅ | ⚠️ baixa direto (sem `showSaveFilePicker`) | ⚠️ idem | ⚠️ idem | ⚠️ |
| Buffer de replay (WebCodecs) | ✅ | ✅ testado (VP9/VP8/H.264) | ✅ 16.4+; antes, buffer sem compressão | ✅ | ✅ |
| **Studios** (Bike Fit, BeltScan, Inspect, Takt…) | ✅ | ✅ (abrem na regressão) | ✅ | ✅ | ✅ |
| **Editor de vídeo** (GPlanSiS\|Vídeo) | ✅ | ✅ abre; WebCodecs de vídeo e áudio presentes | ⚠️ 16.4+ quadro exato **sem áudio** (sem AudioEncoder); antes, tempo real (MediaRecorder MP4) | ✅ | ⚠️ |
| **Treinar** (imagens, rótulos, treino) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Treinar › colar print | ✅ | ⚠️ ⌘V ou o botão (o Safari pede permissão para ler a área de transferência) | ⚠️ idem | ⚠️ só ⌘V | ⚠️ |
| Treinar › Do YouTube | ✅ «Compartilhar esta aba» | ✅ testado, «Compartilhar a janela do player» | ⚠️ idem | ⚠️ idem | ❌ |
| **+Projeto** (prints, marcações) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Menu de contexto › Copiar imagem | ✅ | ✅ (corrigido: o gesto não se perde mais) | ✅ 13.1+ | ⚠️ 127+ | ⚠️ |
| **Via** (assistente) | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Playlists** do YouTube | ✅ | ✅ tocam na janela do player | ⚠️ idem | ⚠️ idem | ✅ |
| Teclas de mídia (Media Session) | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Ferramentas** (desenho, medidas, zoom) | ✅ | ✅ pinça no trackpad corrigida (GestureEvent) | ✅ | ✅ | ✅ toque |
| Dados locais (IndexedDB, cache de modelos) | ✅ | ⚠️ o Safari pode apagar após 7 dias sem uso (site não instalado); os modelos baixam de novo | ⚠️ idem | ✅ | ⚠️ |

## Recursos do navegador (Safari 26, medido no WebKit)

| Recurso | Safari 26 | Como o iaVision lida |
|---|---|---|
| `crossOriginIsolated` / `SharedArrayBuffer` | ✅ | `numThreads` = min(4, núcleos); sem isolamento, 1 thread |
| WebGPU (`navigator.gpu.requestAdapter`) | ✅ adaptador Apple | `temWebGPU()` testa o adaptador; modelos de `EP_WEBGPU` tentam `webgpu` e caem para `wasm` se a sessão ou a 1ª execução falhar |
| WebCodecs (`VideoEncoder/Decoder`, `AudioEncoder/Decoder`) | ✅ H.264, VP9, VP8, AAC | `isConfigSupported` antes de usar; sem eles, MediaRecorder |
| MediaRecorder | ✅ `video/mp4;codecs=avc1,mp4a` (e WebM) | `isTypeSupported` em ordem (MP4 primeiro) |
| `requestVideoFrameCallback` | ✅ (também em `<video>` fora da página) | timer/rAF como reserva |
| OffscreenCanvas | ✅ | `<canvas>` como reserva |
| BarcodeDetector | ❌ | ZXing vendorizado |
| `iframe credentialless` | ❌ | **YouTube em janela própria** (`/yt/player.html`) |
| Element Capture / Region Capture | ❌ | **captura da janela** + recorte automático/manual |
| `getDisplayMedia` | ✅ janela ou tela (sem `preferCurrentTab`) | opções do Chrome são ignoradas sem erro |
| `enumerateDevices`, Continuity Camera | ✅ | os IDs mudam por sessão no Safari: a câmera salva cai na escolha automática |
| `navigator.clipboard.read` / `ClipboardItem` | ✅ com permissão / gesto | ler: botão ou ⌘V; escrever imagem: `ClipboardItem` com **promessa**, chamado dentro do clique |
| `showSaveFilePicker` | ❌ | `<a download>` |
| CSS `backdrop-filter`, `:has()`, `@container`, `dvh` | ✅ | `-webkit-backdrop-filter` junto nos painéis flutuantes (Safari ≤ 17 só tem o prefixado) |
| Pinça no trackpad | `gesturestart/change/end` (não roda + Ctrl) | Viewport e editor do +Projeto tratam `GestureEvent` |
| Web Audio / AudioWorklet | ✅ | `webkitAudioContext` como reserva |
| `SpeechRecognition` | ✅ (`webkitSpeechRecognition`) | motor nativo das Legendas |
| BroadcastChannel, `structuredClone`, `Array.prototype.at` | ✅ | — |
| `requestIdleCallback` | ❌ | `setTimeout` como reserva |
| `HTMLMediaElement.captureStream` | ❌ | gravar uma fonte HLS nativa avisa que não dá |

## YouTube: os três caminhos

| Caminho | Onde | Como |
|---|---|---|
| **Element Capture** | Chrome/Edge 132+ | iframe `credentialless` atrás do canvas; captura da aba restrita ao player |
| **Region Capture** | Chrome/Edge 104–131 | tela dividida; captura da aba recortada no retângulo do player |
| **Janela própria** | Safari, Firefox, Chrome < 110 (computador) | `/yt/player.html` (sem isolamento) numa janela, comandada por BroadcastChannel; `getDisplayMedia` da janela, recorte automático (barra de título, faixas pretas) e «Ajustar recorte» |

Detalhes em [fontes.md](fontes.md#youtube-no-safari-e-no-firefox). O trecho do Caddy que tira o isolamento só de `/yt/*` está em [servicos.md](servicos.md).

## Limitações conhecidas

- **Janela do YouTube coberta**: a captura de janela mostra o que estiver por cima. Deixe a janela do player ao lado do iaVision.
- **Som no Safari**: o player começa mudo. Se o 🔊 não ligar o som, clique uma vez no vídeo da janela (política de reprodução automática do Safari).
- **Pop-up bloqueado**: colar um link abre a janela no mesmo clique; se o Safari bloquear, o painel mostra «Abrir a janela do player».
- **Fechar a janela pelo app**: se o navegador não deixar o app fechar a janela (vínculo cortado pelo COOP), ela para o vídeo e diz que pode ser fechada.
- **Safari 15–18 no editor de vídeo**: sem `AudioEncoder`, a exportação com quadro exato sai sem áudio (a interface avisa).
- **Safari Technology Preview / WebDriver**: para automatizar o Safari real (`safaridriver`), é preciso ligar «Permitir automação remota» em Ajustes › Desenvolvedor.
