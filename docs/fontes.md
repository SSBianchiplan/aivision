# Fontes de imagem

Todas as fontes entram no mesmo pipeline. Escolha no painel **Fonte** (tecla `f`).

| Fonte | Como usar | Observações |
|---|---|---|
| **Câmera** | **📷 Abrir câmera** (seletor) ou "Ligar câmera" + select de dispositivo | Ver «Escolher a câmera» abaixo. No celular, alterna frontal/traseira no seletor ou pela barra de vídeo. "Espelhar (selfie)" espelha a imagem antes de processar — operadores que dependem de esquerda/direita (mãos, Bike Fit) leem isso sozinhos. |
| **Câmera Wi-Fi / IP** | seção Câmera › «📶 Câmera Wi-Fi / IP» | RTSP/ONVIF pelo MediaMTX local (RTSP → WebRTC/WHEP). Ver abaixo. |
| **Arquivo** | "Abrir imagem / vídeo" | Imagem ou vídeo local, repetível — bom para comparar pipelines. A barra de vídeo controla a reprodução (±1 s, linha do tempo). |
| **Tela** | "Capturar tela" (só computador) | Aba, janela ou monitor. Compartilhando uma aba com som, a gravação leva o áudio. |
| **Câmera RTMP** | seção RTMP | DJI Osmo, Action, drone, OBS publicam em `rtmp://rtmp.gplansis.com:1935/live` (com credencial); o app lê por WebRTC (WHEP) ou HLS. |
| **YouTube** | seção YouTube | Ver abaixo. |

Largura de processamento (slider no painel Fonte ou em Config › Desempenho) é o principal controle de fps: o custo cresce com a área.

## Escolher a câmera (📷 Abrir câmera)

O botão **📷 Abrir câmera** (seção Câmera do painel Fonte) abre um seletor (popover; no celular, folha presa embaixo) com:

- **Lista agrupada por tipo**, com ícone: 💻 integrada (FaceTime, Integrated, Built-in), 🔌 USB / externa (webcams, capturadoras HDMI-USB como Cam Link), 📱 celular como webcam (Continuity Camera do iPhone, DroidCam, Camo, Iriun), 🎛 virtual (OBS, NDI, Snap), 🌡 infravermelha (Windows Hello — imagem preta fora da autenticação). O navegador não informa o tipo: é **heurística pelo rótulo** (`classificar()` em `js/camera/seletor.js`), só para o ícone — nada depende dela. No celular aparecem só as câmeras do aparelho (frontal/traseira) e os botões **📷 Traseira / 🤳 Frontal**, que pedem por `facingMode` (o sistema escolhe a lente principal; o `deviceId` acertaria a lente errada em aparelhos com três traseiras).
- **Prévia ao vivo pequena** ao passar o mouse (ou focar/tocar), com a resolução e os fps **entregues** (`track.getSettings()`) e o máximo da câmera (`getCapabilities()`). «Usar» (ou duplo clique / Enter) liga a câmera como fonte.
- **Permitir câmera**: antes da permissão o navegador devolve as câmeras sem rótulo; o botão pede a permissão (abre e fecha) e relista.
- **Atualizar lista** e atualização automática no evento `devicechange` (plugar/desplugar USB, iPhone que se aproxima do Mac).
- **Última câmera** lembrada neste aparelho (`localStorage['gplansis.camera.ultima']`, por id e, se o id mudar, pelo rótulo); «Ligar câmera» sem escolha na sessão usa a última.
- **Câmera em uso por outro app** (Teams, Zoom, OBS — `NotReadableError`): aviso ao lado da câmera. Uma escolha explícita **não cai mais em outra câmera em silêncio** (`device.js`: com `deviceId`, a nova tentativa só acontece se o problema foi a resolução); câmera desplugada vira «não está mais conectada».
- A seção Câmera mostra o **dispositivo atual** com o ícone do tipo e a resolução/fps entregues. O select «Dispositivo», a resolução e os fps continuam como antes.

### Câmera Wi-Fi / IP (RTSP / ONVIF)

O navegador não lê RTSP. O caminho é o **MediaMTX** na máquina da pessoa: `câmera ──RTSP──▶ MediaMTX ──WebRTC (WHEP)──▶ navegador`, o mesmo servidor da seção RTMP.

1. Preencha marca (atalhos de caminho: genérica/ONVIF, Hikvision, Dahua/Intelbras, Reolink, Tapo, app IP Webcam, «só MJPEG por HTTP»), IP, porta, caminho, usuário e senha.
2. O seletor gera o **trecho do `mediamtx.yml`** (`paths: cam1: source: rtsp://usuario:senha@IP:554/… · sourceOnDemand: yes`; usuário e senha codificados para URL). **Copiar trecho** / **Baixar .yml**. Na tela a senha aparece como ●●●●.
3. **Conectar** no endereço WHEP (padrão `http://localhost:8889/cam1/whep`). Usa o `StreamSource` de `js/camera/stream.js` com `cfg.whep` (endereço completo) e `cfg.origem = 'ip'` (mensagens de erro próprias: MediaMTX fora do ar, caminho sem vídeo, H.265).

**Segredos**: usuário e senha só existem na memória da página e no texto gerado — não vão a servidor nenhum nosso e não são guardados; o navegador lembra só nome, IP, porta, caminho, marca e WHEP (`localStorage['gplansis.camera.ip']`).

**Limites honestos**: página em **HTTPS** não fala com `http://localhost:8889` (bloqueio medido — ver `stream.js`): use o túnel HTTPS (`https://<túnel>/media/whep/cam1/whep`) ou a instalação local. Câmera em **H.265** não toca no WebRTC do navegador — use o substream H.264. **MJPEG por HTTP** (`http://IP:8080/video`, apps como IP Webcam) não carrega direto: a página roda isolada (COEP `require-corp`) e a câmera não manda `Cross-Origin-Resource-Policy`; a opção «Só MJPEG por HTTP» gera um `runOnInit` com **ffmpeg** que converte para H.264 dentro do MediaMTX.

### Bluetooth

Item só explicativo, sem botão que finja funcionar: navegadores não recebem vídeo por Bluetooth (o Web Bluetooth não transporta vídeo). Câmeras «Bluetooth» usam o BT para parear/controlar e transmitem por **Wi-Fi** (→ Câmera Wi-Fi / IP) ou aparecem como **webcam USB/UVC** (→ já estão na lista).

Arquivos: `js/camera/seletor.js` (lógica, sem interface — usada também pelo Treinar), `js/components/SeletorCamera.js` (React), `css/camera-seletor.css` (injetado pelo componente; só tokens de tema).

## YouTube

O vídeo **não é baixado**: toca no player oficial do YouTube, embutido do tamanho da área da câmera. O iaVision lê a imagem capturando a própria aba restrita ao player.

1. Em **Fonte › YouTube**, busque (título, canal) ou cole um link/ID e clique em **Abrir**. A busca usa o serviço `aivision-yt` (só metadados).
2. O player abre — neste estado o vídeo está **só assistindo**: o pipeline **não** vê a imagem.
3. Para analisar, clique em **Usar como fonte** (no painel) ou **▶ Analisar este vídeo no pipeline** (na barra de vídeo). O navegador pede para compartilhar **esta aba**: aceite.
   - **Element Capture** (Chrome/Edge 132+): só o player é capturado, mesmo com o resultado processado por cima. "Ver original" traz o player para a frente.
   - **Region Capture** (Chrome 104–131): tela dividida — player à esquerda, processado à direita. Painel arrastado por cima do player entra na captura.
   - **Safari e Firefox (computador)**: o player abre numa **janela própria** e a captura é dessa janela — ver [YouTube no Safari e no Firefox](#youtube-no-safari-e-no-firefox).
   - Celular: só assistir (Chrome Android) ou só o link "Abrir no YouTube" (iPhone/iPad).
4. **Quadros para treino**: "Capturar quadro" ou "Capturar a cada N s" (até 300), com miniaturas; "Baixar ZIP" ou "Enviar ao Treinar" (pede a senha do Treinar, escolhe projeto e, em anomalia, boa/ruim). Os quadros vêm limpos (sem desenho) e só quando o vídeo está tocando há 5 s (sem a interface do player).
5. Legendas automáticas são desligadas para não entrarem nos quadros.

### YouTube no Safari e no Firefox

O site é isolado (COOP `same-origin` + COEP `require-corp`, por causa das threads do ONNX Runtime). Numa página assim o embed do YouTube só carrega como `<iframe credentialless>`, que só o Chrome/Edge 110+ têm; no Safari o player embutido falhava com «Ocorreu um erro… (ID de reprodução)». E recortar a captura da própria aba no player (Element/Region Capture) também é só do Chromium. Por isso, quando `suporte()` vê que não há `credentialless` (ou Element/Region Capture) num navegador de computador com `getDisplayMedia`, `BroadcastChannel` e `canvas.captureStream`, a fonte entra no **modo janela** (`captura: 'janela'`):

1. **Abrir** (ou clicar num resultado da busca / numa playlist) abre `/yt/player.html` numa janela de 960×540 de área útil (16:9 exato), título **«Player do YouTube — iaVision»**. Ela mostra só o player oficial, fundo preto, `controls=0`, sem nada do iaVision na imagem. O `window.open` acontece dentro do clique; se o navegador bloquear o pop-up, o painel mostra **Abrir a janela do player**.
2. A página `/yt/*` é servida **sem** COOP/COEP/CORP (trecho do Caddy em [servicos.md](servicos.md)) e não importa nada do app. O app a comanda por **BroadcastChannel** `aiv-yt-janela` (mesma origem; funciona mesmo com o COOP do app cortando o vínculo com a janela). Cada janela tem uma «sessão» na URL; o app só ouve a sua.
3. `PlayerJanela` (`js/camera/youtube-janela.js`) imita a parte da IFrame API que o app usa (`getPlayerState`, `getCurrentTime`, `seekTo`, `playVideo`, `setPlaybackRate`, `mute`…), a partir do estado que a janela publica 4×/s; o tempo anda sozinho entre publicações. Por isso o painel, a barra de vídeo (±10 s, linha do tempo, velocidade, som), as teclas de mídia, as playlists e o «Repetir» funcionam sem mudança.
4. A janela tenta de novo pelo outro domínio do YouTube (youtube-nocookie ↔ youtube.com) quando o vídeo não começa em 12 s, como o núcleo.
5. **Usar como fonte (compartilhar a janela)** chama `getDisplayMedia` comum. Escolha a janela «Player do YouTube — iaVision». O `Recortador` olha ~8 imagens da captura e acha o retângulo do vídeo: tira a barra de título (faixa parada em cima, separada por preto ou que deixa o resto em 16:9) e as faixas pretas (pixel não preto em ≥ 1/4 das imagens). A geometria que a janela publica (área útil × janela inteira) ajuda quando a captura é da janela. O resultado vira um `MediaStream` (`canvas.captureStream`, ~30 fps) que entra no pipeline como o Element Capture.
6. **Ajustar recorte**: arraste um retângulo sobre a captura bruta (Enter aplica, Esc cancela). O recorte manual vale para a sessão (`sessionStorage`). Se você compartilhar a tela inteira, é por aqui que se marca o player.
7. Deixe a janela do player **visível** (ao lado do iaVision): a captura de janela mostra o que estiver por cima dela se for coberta. A qualidade acompanha o tamanho da janela (o YouTube escolhe pelo tamanho do player): aumente a janela para subir a resolução.
8. Som: o player começa mudo. No Safari, se o som não ligar pelo 🔊, clique uma vez no vídeo da janela (política de reprodução automática).

Nada é baixado do YouTube em nenhum dos modos: o vídeo toca no player oficial e os quadros são da tela, tirados no navegador.

### Controles do player

Com o player aberto (fonte ou só assistindo), a **barra de vídeo** controla o vídeo:

| Controle | Ação |
|---|---|
| ⏮ / ⏭ | −10 s / +10 s |
| ▶ / ⏸ | tocar / pausar |
| ⏹ | fecha o player (ou para a fonte) |
| linha do tempo | ir para o ponto (mostra `tempo / duração`) |
| **1×** | velocidade: 1 → 1,25 → 1,5 → 2 → 0,5 → 0,75 |
| **🔊/🔇** | som |

### Teclas de mídia do teclado

Windows, macOS e Linux: as teclas de mídia (▶⏸, ⏭, ⏮, ⏹ — ou Fn+F7/F8/F9) controlam o player. O iaVision toca um áudio silencioso enquanto o vídeo toca para ser a "sessão de mídia" ativa do navegador; a Media Session API entrega as teclas ao player e mostra título, canal e miniatura no controle de mídia do sistema (Central de Controle do macOS, painel de mídia do Windows, MPRIS no Linux).

| Tecla | Ação |
|---|---|
| ▶⏸ | tocar / pausar |
| ⏭ / ⏮ | +10 s / −10 s |
| ⏹ | pausar |
| arrastar no controle do sistema | ir para o ponto |
