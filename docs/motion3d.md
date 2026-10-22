# Motion 3D Studio v2 (CV-88) — documentação para integrar

## O que é novo

### 1. Vídeo → 3D realista (levantamento 2D→3D com restrições)
`js/cv/runtime/livres-v/levantar.js` (puro, < 1 ms por pose). O 3D exibido, gravado, retargetado e enviado
por VMC passa a ser reconstruído do 2D, osso a osso, em perspectiva (raio da câmera × esfera do osso):
- comprimentos de osso fixos (percentil alto do W, com faixas antropométricas pelo tronco);
- escala px/m pelos ossos do tronco e dos braços corrigidos pelo ângulo do W (mediana, mudança ≤ 4 %/quadro);
- **híbrido W × 2D por osso**: onde o osso do W é coerente com a imagem, o W é o candidato preferido; onde
  contradiz (perna "reta pendurada" de quem está ajoelhada de costas, oclusão), o 2D decide;
- sinais de profundidade escolhidos por custo: W (perda robusta), continuidade, joelho só dobra para trás,
  tornozelo até a ponta de dança (~90° de flexão plantar), extensão de quadril limitada, nariz à frente,
  torção tronco×pelve, equilíbrio (centro de massa de Winter dentro da base de apoio);
- perna reta no 2D → candidato de perna reta; joelho oculto (tutu, saia) com tornozelo visível → IK de duas barras;
- pernas fundidas/trocadas no 2D: rótulos trocados corrigidos pela continuidade; fundidas → a perna livre
  herda a solução anterior (não cola nas duas); com o RTMO (`pose.rtmo`) na cadeia, ele separa as duas;
- chão: contatos (pés, ponta, calcanhar, joelhos, quadril sentado, mãos), raiz descendo até o contato mais
  baixo, pulo pela linha do chão NA IMAGEM (≤ 1,2 m, ≤ 1,5 s), pé em contato travado (sem deslizar);
- "para cima": inclinação da câmera pelas pernas retas (ou manual em Physics); deitada → usa o W;
- One Euro + limite de 7 m/s por junta.
- **Modo qualidade** (⋯ › Refinar (qualidade), Worker `levantar-worker.js`): o levantamento nos dois sentidos
  da tomada + pós-processamento do robo (lacunas, Butterworth fase zero, ossos rígidos) → tomada `_HQ`.
- Physics: liga/desliga, campo de visão da câmera, inclinação, diagnóstico (contato, apoio, pernas fundidas).

### 2. Várias pessoas (até 4)
Parâmetro `pessoas` do `motion3d.captura` (Sources › Atores). YOLOX + um BlazePose por pessoa (o
`MotorMulti` da Corrida, agora com `fabrica` para o rastreador 3D). Vagas estáveis "Ator 1…4" (ID do
rastreador + continuidade de posição, 6 s de memória, reinício quando o vídeo volta). Cada ator: levantamento
próprio, posição relativa real no piso, cor e rótulo no vídeo e no 3D, entrada no Outliner e nas Sources,
"dirigir avatar" por ator, avatar próprio quando há modelo. Tomada multiator; exportar BVH por ator (.zip)
e GLB com todos.

### 3. Avatar importado
Characters: exemplos gerados em código (VRM 1.0 em T com cabelo em spring bone e expressões; GLB Mixamo em A
com dedos e morph targets ARKit; CC0) e modelos importados (GLB/GLTF autocontido, VRM 0.x/1.0, FBX), com
miniatura, no IndexedDB. Retarget direto (`retarget.js`, `avatar.js`): mede o repouso do modelo (T/A corrigido
sozinho), dedos pelos 21 pontos da mão, cabeça e expressões pela malha do rosto (`extras.js`), spring bones do
VRM, editor de mapeamento ossos × juntas (Avatar), "Ver repouso", "Conferir ângulos", exportar a tomada como
GLB do próprio avatar. Peças da cadeia ligáveis no painel: Mãos e gestos, Malha do rosto.

### 4. Marionete 2D
Vista "Marionete 2D": imagem → recorte (BiRefNet, pincel, limiar) → esqueleto (pose do iaVision ou padrão,
arrastável) → malha em grade com costuras entre partes distantes cortadas → pesos geodésicos só entre ossos
vizinhos → LBS 2D → move com a fonte ou com a tomada. Exporta WebM/MP4 ao vivo, MP4 exato da tomada, PNG com
alfa (.zip). Salva em Characters.

### 5. Estúdio
Câmera virtual (livre, seguir, close, plano americano, plano geral, travelling lateral, órbita), fundo (tema,
cor, gradiente, imagem/panorama 2:1, HDRI .hdr, chroma), gravação do viewport (MP4/WebM), janela limpa para OBS,
saída VMC/OSC (`vmc.js`) por ponte WebSocket→UDP: local (`ponte_vmc.py`, ws://127.0.0.1:39541 → udp 39539) ou
remota pelo `aivision-motion` 1.1 (`/api/v1/motion/vmc/*`, só repassa, com sessão).

### 6. API estável (`js/components/motion3d/api.js`)
`motion3dAPI`: `criarTomada(trilha 33×3, opc)`, `listarTomadas()`, `lerTomada(id)`, `aplicarTomada(id)`,
`estado()`, `aberto()`, `versao`. O gancho [VIA] da v99 foi preservado no merge.

### Em espera (decisão do dono)
Imagem → avatar 3D (conector image-to-3D no servidor) e o modo Billboard 2.5D: não implementados; ver
`aivision-docs-internos/motion3d-pesquisa.md` §4c.

## Desempenho
- Sem long tasks no Studio ao vivo (10 s, 30 poses/s): vídeo, 3D, 3D com retarget e avatar VRM.
- "Show Retarget" ao vivo calculado direto (sem gerar/reler BVH): script 0,152 → 0,136 s em 10 s.
- Tamanho do vídeo por ResizeObserver e cores do tema em cache (sem getBoundingClientRect/getComputedStyle por quadro);
  o vídeo não é redesenhado com a vista só 3D. O levantamento custa ~0,1–0,8 ms por pose.

## Números (detalhe em `motion3d-v2-tools/media/*.md`)
- Sintético (14 cenas × 60 quadros, W simulado com as falhas do BlazePose): MPJPE 213 → 143 mm; joelho 44° → 23°;
  quadril 35° → 13°; ajoelhada de costas 321 → 80 mm e joelho 151° → 2°.
- Vídeo renderizado + BlazePose REAL (11 cenas): MPJPE 205 → 189 mm; joelho 36° → 27°; contato 96 → 86 mm;
  ajoelhada de costas 377 → 213 mm, joelho 135° → 31°, menor altura 146 → 30 mm. Pioram: agachada (+30 mm),
  5ª posição (+43 mm), deitada (+34 mm). 2º vídeo (6 cenas): joelho 38° → 27°, mas agachada/sentada pioram.
- O levantamento pode ser desligado em Physics (volta ao W com "pés no chão").
