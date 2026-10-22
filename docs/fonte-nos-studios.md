# Fonte dos Studios ()

## O que é
Um botão **Fonte** na barra de cada Studio (BikeFit, BeltScan, CounterVision, Takt, Inspect e o editor GPlanSiS|Vídeo). Ele abre um popover para trocar a fonte **sem fechar o Studio**:

- **Câmeras**: a lista mostra o rótulo, o tipo, a câmera «em uso» e a resolução e os fps que ela entregou. Um clique troca de câmera **a quente**: a nova abre antes de a anterior ser solta, então o pipeline, os operadores e os gráficos continuam. Se a nova falhar, a anterior segue ligada.
- **Resolução e quadros/s**: o popover mostra o pedido e o que a câmera entregou de fato, e avisa quando a câmera não chega ao pedido (mostrando o máximo dela).
- **Celular**: botões Traseira e Frontal (`facingMode`).
- **«Prévia…», «Wi-Fi / IP» e «Bluetooth»** abrem o seletor completo (`components/SeletorCamera.js`). Ele agora fica por cima do Studio.
- **Arquivo, Tela e YouTube**. No YouTube: colar o link → **Abrir** → **Analisar**. São dois cliques porque o Safari exige que a captura comece no gesto do usuário. No Safari e no Firefox o player abre numa janela própria.
- **Indicador de estado**: uma bolinha no botão (verde = imagem entrando, cinza = parada, vermelha = erro ou câmera desconectada). O aviso do app (permissão negada, câmera em uso, câmera desconectada) aparece dentro do popover e, com um Studio aberto, o toast também passa a ficar por cima dele.

## Arquivos
- `js/components/studio/FonteStudio.js` (novo): a interface. A API está documentada no topo do arquivo.
- `css/fonte-studio.css` (novo): injetado pelo próprio componente. Usa só os tokens do tema (escuro, claro e Code).
- `js/camera/fonte-app.js` (novo, sem interface): o workspace registra aqui as ações de fonte, e o arquivo também vigia a câmera (queda e `devicechange`).

## API para Studios novos
```js
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
// barra:
<${FonteStudio} classeBotao="oee-btn" />          // semTexto=${true} mostra só o ícone
// Esc do Studio (keydown em window, fase de captura), antes de fechar:
if (e.key === 'Escape' && fonteStudioAberta()) return;
```
O Studio não precisa receber nenhuma prop de fonte: as ações vêm do workspace (`registrarFonteApp`).

## Comportamentos corrigidos (núcleo)
- **Câmera desplugada ou permissão retirada**: antes, o app seguia «câmera ligada» com a imagem congelada. Agora aparece um aviso claro e, quando a câmera volta (`devicechange`, mesmo id ou mesmo rótulo), ela reabre sozinha.
- **Câmera → arquivo**: antes, o pipeline congelava (o `requestVideoFrameCallback` ficava pendurado no vídeo antigo). Agora uma vigia no Viewport resolve.
- **Tela → câmera**: antes, a captura de tela continuava ativa. **Tela/stream → arquivo**: idem. Agora a fonte anterior é solta.
- **Troca a quente com falha**: a câmera anterior continua e `cameraOn` fica correto.
- **«Gravar trecho» do editor GPlanSiS|Vídeo com câmera**: antes, a gravação congelava ao trocar de câmera no meio. Agora ela grava por um canvas-relé e acompanha a câmera nova.
- **Celular**: a troca a quente fica desligada, porque o iOS só mantém uma câmera aberta. Lá a troca fecha a câmera antes de abrir a outra, como antes.
