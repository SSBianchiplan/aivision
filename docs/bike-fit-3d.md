# Bike Fit 3D — especificação de câmeras e protótipo

Referência: Velogic Studio 4, que faz captura de movimento 3D para bike fit com câmeras de profundidade (ver a matéria do [Bikerumor](https://bikerumor.com/velogic-doubles-up-on-3d-motion-capture-bike-fits/)). Esta especificação descreve três montagens possíveis para o iaVision, do celular até o sensor ToF, e o protótipo **Bike Fit 3D** que já roda no navegador nos níveis 1 e 2.

> **Estado atual.** O nível 1 é o Bike Fit (CV-28) que já está no ar. O nível 2 é o protótipo *Bike Fit 3D*, que trabalha com duas ou três câmeras comuns e funde as vistas. O nível 3 (ToF) está só especificado: o navegador não acessa câmeras Orbbec ou Kinect diretamente e precisaria de uma ponte nativa, descrita na seção 7.

## 1. Como a referência funciona (Velogic Studio 4)

| | Studio 4 Pro (dupla face) | Studio 4 Essentials |
|---|---|---|
| Câmeras | 2× **Orbbec Femto Mega**: ToF com a tecnologia do Azure Kinect e NVIDIA Jetson embarcado. Profundidade até 1024×1024 a 15 fps (campo largo) ou 640×576 a 30 fps (campo estreito); RGB até 3840×2160 a 25 fps; campo de ~120° | 1× Kinect v2 (USB) |
| Sincronismo | 1 Orbbec Sync Hub + 2 adaptadores, para que as duas câmeras ToF não se interfiram | — |
| Ligação | Ethernet Cat6 (PoE) | USB 3 |
| Software | FrameBlaster | idem |
| Assinatura | US$ 450/mês ou US$ 4.500/ano no 1º ano; depois US$ 180/mês ou US$ 1.800/ano | US$ 300/mês ou US$ 3.000/ano no 1º ano; depois US$ 120/mês ou US$ 1.200/ano |

Fontes: [loja Velogic](https://shop.velogicfit.com/products/velogic-studio-4-pro-camera-equipment-double-sided), [Endurance Business](https://endurance.biz/2024/industry-news/velogic-studio-4-offers-up-3d-motion-capture-bike-fit-and-rider-analysis/), [Tegakari (Femto Mega)](https://www.tegakari.net/en/2024/08/orbbec_femto_mega/), [anúncio do Studio 4](https://velogicfit.com/blog/announcing-velogic-studio-4/), [preços](https://velogicfit.com/pricing/) (lidos em 20/10/2026). A loja não vende mais o kit de câmeras do Pro: o BuiltWith registrou 6.940 (moeda não indicada) até jan/2025. Hoje ela vende avulsos: Kinect for Xbox One a US$ 176, Startup Kit (Kinect) a US$ 352, bastão a US$ 88 e fita de marcação VF Tape a partir de US$ 20.

**O que a Velogic recomenda para a montagem** ([docs](https://docs.velogicfit.com/section-01-getting-started/setting-up-fit-area)):

- câmera a **180–220 cm** da bike, lente a **95 cm** do chão, mirando o meio entre guidão e selim, nivelada e perpendicular ao plano da bike;
- com o Femto, a distância horizontal é aproximadamente igual à altura visível (a 7 pés, vê 7 pés);
- a montagem dupla face precisa de cerca de **4,5 m** de largura (alternativas: plataforma giratória ou bike na diagonal);
- tripé ou suporte de parede; luz do sol direta atrapalha o ToF;
- luz difusa e uniforme, fundo claro, exposição abaixo de 33 ms para manter 30 fps (o Kinect cai para 15 fps com pouca luz);
- calibração com um bastão encostado em 5 pontos: parafuso da mesa (centro da tampa da caixa de direção), centro do selim, ponto baixo na linha média do quadro e 2 pontos de mesma altura (eixos dianteiro e traseiro, ou o chão). Isso corrige pitch, yaw e roll da bike em relação à câmera. Sem calibração, os ângulos articulares continuam valendo, mas quadril–pé, joelho–pé, tronco/braço e deslocamento do joelho perdem precisão.

**A crítica conhecida** é que duas câmeras laterais dão um plano sagital de cada lado (e frontal, quando há), e isso "não é 3D de verdade". O protótipo do iaVision tem o mesmo limite no nível 2: é **3D por fusão de vistas 2D**.

## 2. Os três níveis

| | Nível 1 — Web, 1 câmera | Nível 2 — Web, 2–3 câmeras | Nível 3 — Profissional ToF |
|---|---|---|---|
| Onde roda | navegador (Bike Fit CV-28) | navegador (protótipo Bike Fit 3D) | ponte nativa no PC + navegador |
| Câmeras | celular ou webcam 1080p30 | 2 webcams 1080p60 (lateral + frontal); opcional 3ª (lateral oposta). iPhone via Continuidade também serve | 2× Orbbec Femto Mega/Bolt, ou Azure Kinect (usado), ou Intel RealSense D455 |
| Resolução e fps mínimos | 1280×720 a 30 fps; recomendado 1920×1080 a 30 fps; ciclista ≥ 70% da altura do quadro | 1280×720 a 60 fps (o C922 faz); recomendado 1920×1080 a 60 fps | profundidade 640×576 a 30 fps (Femto, campo estreito sem binning); RGB 1080p30 |
| Entrega | 2D sagital: ângulos (joelho PMI/PMS, quadril, tronco, ombro, cotovelo, tornozelo), KOPS aproximado, cadência. A vista frontal é feita em outra sessão | tudo do nível 1, mais Z lateral: **knee travel** (mm), alinhamento quadril–joelho–pé, ângulos 3D, posição lateral dos pés. Com a 3ª câmera, simetria esquerda/direita real | 3D real por quadro (mm), dois lados ao mesmo tempo, área frontal (aero) |
| Precisão esperada | ±5–8° entre pedaladas (pose sem marcadores) | ângulos como no nível 1; Z do joelho com poucos mm **no ciclo médio** de ≥ 20 pedaladas, com boa calibração e luz | ~1–2 cm por junta no body tracking ToF; melhor com marcadores |
| Custo de equipamento (aprox.) | R$ 0 (celular) a R$ 400 | R$ 1.000–2.500 | US$ 1.000–1.600 só em câmeras, sem o PC |

### 2.1 Equipamento e preços

Preços pesquisados em 20/10/2026. Os valores em R$ são preços pedidos em anúncios no Brasil e os em US$ vêm das lojas oficiais. Não fiz conversão de câmbio. Onde está "não encontrado", não houve preço confiável.

**Nível 1 — Web, 1 câmera**

| Item | US$ | R$ | Fonte |
|---|---|---|---|
| Celular com câmera 1080p30 (o que o fitter já tem) | — | — | — |
| ou Logitech C920s (1080p30) | 59,99 | 345–369 | [Zoom](https://www.zoom.com.br/webcam/webcam-logitech-c920), [Amazon BR](https://www.amazon.com.br/Chamadas-Grava%C3%A7%C3%B5es-Widescreen-Logitech-Equipamentos/dp/B006JH8T3S) |
| Tripé de 2 m (iluminação/câmera) | — | 34–92 | [Kabum](https://www.kabum.com.br/produto/318603/tripe-de-iluminacao-2-metros-para-foto-e-iluminacao), [Amazon BR](https://www.amazon.com.br/Trip%C3%A9-ilumina%C3%A7%C3%A3o-altura-m%C3%A1xima-metros/dp/B07QMYRTLJ) |
| Par de softbox LED + tripés | — | 161–290 (sem lâmpadas) · ~630 (com 8 lâmpadas LED) | [Amazon BR](https://www.amazon.com.br/Kit-Youtuber-Softbox-E27-Trip%C3%A9s/dp/B00AG9G0SG), [Amazon BR](https://www.amazon.com.br/Ilumina%C3%A7%C3%A3o-Fotogr%C3%A1fica-Profissional-Fotografia-Profissionais/dp/B0GWNK2Y3N) |

**Nível 2 — Web, 2–3 câmeras**

| Item | Qtd. | US$ | R$ | Fonte |
|---|---|---|---|---|
| Logitech Brio 4K (1080p60 / 4K30) — recomendada | 2 (3) | 169,99 | 890–1.090 | [Logitech](https://www.logitech.com/en-us/shop/c/webcams), [Amazon BR](https://www.amazon.com.br/Logitech-960-001105-Webcam-BRIO/dp/B01N5UOYC4) |
| ou Logitech Brio 500 (1080p30) | 2 (3) | 129,99 | 636–720 | [Amazon BR](https://www.amazon.com.br/Webcam-Logitech-BRIO-500-Grafite/dp/B0BGT1VQGJ), [Mercado Livre](https://www.mercadolivre.com.br/webcam-full-hd-logitech-brio-500-grafite/p/MLB20940530) |
| ou Logitech C922 Pro (1080p30, 720p60) — opção barata a 60 fps | 2 (3) | 119,99 | 512–580 | [Kabum](https://www.kabum.com.br/produto/93393/webcam-full-hd-logitech-c922-pro-stream-com-microfone-embutido-1080p-e-tripe-incluso-compativel-logitech-capture-960-001087) |
| ou Razer Kiyo Pro (1080p60) | 2 (3) | não encontrado | 1.180–1.699 | [Mercado Livre](https://www.mercadolivre.com.br/cmera-web-razer-kiyo-pro-full-hd-60fps-cor-preto/p/MLB19174198) |
| ou Elgato Facecam (1080p60) | 2 (3) | ~199,99 | 1.499–2.406 | [Mercado Livre](https://lista.mercadolivre.com.br/elgato-facecam) |
| ou iPhone XR ou mais novo via Câmera de Continuidade (Mac) | 1–2 | — | — | — |
| Extensor USB 3.0 **ativo** de 5 m (os de R$ 35–65 costumam ser passivos) | 2 | — | 120–200 | [Amazon BR](https://www.amazon.com.br/UGreen-Extensor-Extens%C3%A3o-Ativo-Alimentado/dp/B01FQ88CE6) |
| Tripé de 2 m | 2 (3) | — | 34–92 cada | idem nível 1 |
| Par de softbox LED | 1 | — | 161–630 | idem nível 1 |

Total aproximado: **R$ 1.300–2.700** com duas Brio ou **R$ 1.000–1.600** com duas C922, mais luz e tripés. Cada câmera 1080p60 precisa de uma porta USB 3 própria, de preferência em controladoras diferentes: duas câmeras no mesmo hub USB costumam cair para 720p ou 30 fps.

**Nível 3 — Profissional ToF**

| Item | Qtd. | US$ | R$ | Fonte | Observação |
|---|---|---|---|---|---|
| Orbbec **Femto Mega** (ToF + RGB 4K, Ethernet PoE, Jetson embarcado) | 2 | 695 (oficial) · 799 (RobotShop) | não encontrado | [Orbbec](https://store.orbbec.com/collections/all), [RobotShop](https://www.robotshop.com/es/products/camara-profundidad-y-rgb-programable-femto-mega-ethernet-usb) | é o que a Velogic usa |
| ou Orbbec **Femto Bolt** (mesmo ToF, USB-C, sem computação embarcada) | 2 | 418 (oficial) | não encontrado | [Orbbec](https://store.orbbec.com/collections/all) | mais barato, cabo USB limita a distância até o PC |
| Orbbec Sync Hub Pro | 1 | ~70 (Knox Labs) | não encontrado | [Knox Labs](https://www.knoxlabs.com/products/orbbec-multi-camera-sync-hub-pro) | sincroniza as câmeras para os pulsos de IR não se cruzarem |
| ou Sync Hub Dev (Daisy Chain / Star) | 1 | 35 (oficial) · 43,75 (Star, Knox) | não encontrado | [Orbbec](https://store.orbbec.com/products/sync-hub-dev-daisy-chain) | 1 primária + até 4 secundárias |
| Adaptador de sincronismo 8 pinos → RJ45 | 2 | ~8,75 (preço também "sob consulta") | não encontrado | [Knox Labs](https://www.knoxlabs.com/products/orbbec-sync-adaptor-8-pin-to-rj45) | um por câmera |
| Cabo Cat6 | 2–4 | — | 12–45 (2 m) | [Mercado Livre](https://lista.mercadolivre.com.br/cabo-rede-cat6-2m) | comprimentos maiores e injetor/switch PoE 802.3at não foram pesquisados |
| Alternativa: Microsoft **Azure Kinect DK** (descontinuado em out/2023) | 2 | usado 390–700 · lacrado 620–650 | anúncio "novo" a R$ 8.500 | [eBay](https://www.ebay.com/p/10037673569), [Mercado Livre](https://www.mercadolivre.com.br/microsoft-azure-kinect-dk/up/MLBU1161511028) | sem garantia nem suporte |
| Alternativa: Intel **RealSense D455** (estéreo ativo, não ToF) | 2 | 499 (D455f: 525) | não encontrado | [RealSense](https://www.realsenseai.com/products/real-sense-depth-camera-d455f/) | a RealSense virou empresa independente em 2025 ([Vision Systems](https://vision-systems.com/embedded/article/55303384/intel-completes-realsense-spinoff)); estéreo não interfere entre câmeras, mas tem mais ruído de profundidade que o ToF a 2 m |
| Alternativa de entrada: Kinect v2 usado + adaptador para PC | 1 | sensor 38–135 | sensor 150–400 · adaptador genérico 183–196 · oficial 475 | [Mercado Livre](https://lista.mercadolivre.com.br/kinect-xbox-one-usado), [Amazon BR](https://www.amazon.com.br/Kinect-Adapter-Windows-Supply-Connect/dp/B07JHJM9FG) | é o "Essentials" da Velogic; só Windows, SDK antigo |
| PC com GPU NVIDIA (body tracking) | 1 | — | — | não pesquisado | o Body Tracking SDK do Azure Kinect exige GPU com CUDA para rodar em tempo real |

Total só de câmeras e sincronismo: cerca de **US$ 1.500** com dois Femto Mega ou **US$ 950** com dois Femto Bolt, mais o PC.

## 3. Posicionamento

### 3.1 Medidas

| | Lateral (C1, e C3 do outro lado) | Frontal (C2) |
|---|---|---|
| Distância | **180–220 cm** do plano médio da bike (webcam de ~78° na diagonal: até 250 cm para caber cabeça e roda) | **250–300 cm** à frente do movimento central (≈ 2 m à frente da roda dianteira); atrás também serve |
| Altura da lente | **95 cm** do chão | na altura do selim, **95–105 cm** |
| Mira | meio entre guidão e selim | movimento central / linha média da bike |
| Ângulo | eixo óptico perpendicular ao plano da bike (±3°); câmera nivelada (rolar < 2°) | eixo óptico paralelo ao eixo da bike (±3°); nivelada |
| Orientação | paisagem (16:9) | paisagem; retrato também serve |
| Quadro | cabeça, pedal no PMI e as duas rodas inteiras visíveis | do capacete ao pedal, os dois pés visíveis o ciclo todo |

O protótipo mede e avisa: inclinação da linha dos eixos acima de 5°, guinada da bike acima de 8° em relação à frontal, rolar da frontal acima de 5° e erro dos cliques acima de 3 cm.

**Espaço no chão:** com uma lateral e a frontal, cerca de **3 m de largura × 5–5,5 m de comprimento** (bike de 1,75 m, mais 2,5–3 m até a frontal). Com as duas laterais, **4,5 m de largura**, como a Velogic.

### 3.2 Planta (vista de cima)

```
  fundo claro e liso (sem janela atrás do ciclista)
  ═══════════════════════════════════════════════════════════════════
        (C3) lateral oposta — opcional
          │ 180–220 cm
          │
   ○━━━━━━━━━━━●━━━━━━━━━━━○ ─────────── 250–300 cm ──────────── (C2) frontal
 roda T       MC        roda D   → X (frente)                   lente 95–105 cm,
   │←──────── ~175 cm ────────→│                                no eixo da bike
          │
          │ 180–220 cm                        Z (direita do ciclista) ↓
          │                                   (com C1 deste lado, como aqui)
        (C1) lateral — lente a 95 cm, mira entre selim e guidão
  ───────────────────────────────────────────────────────────────────
   largura: 1 lateral ≈ 3 m · 2 laterais ≈ 4,5 m      comprimento ≈ 5–5,5 m
   luz: 2 softboxes a ~45° na frente dos lados, à altura do tronco
```

### 3.3 Vista de lado (alturas)

```
 cm
 180 ┤              ◯  capacete
 150 ┤             ╱│
 120 ┤   ombro ── ╱ └── guidão                  softbox (≈160 cm, difusa)
 100 ┤  selim ●──╱                              ▢ ─ ─ ─ ─ ─ (C2) frontal 95–105 cm
  95 ┤ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ eixo óptico da C1 (sai do papel)
  60 ┤        ╲  joelho
  30 ┤    ○    ● MC     ○       roda de 700c: eixo a ~34 cm do chão
   0 ┼────┴────────────┴──────────────────────────────── chão
```

## 4. Iluminação, roupa e marcadores

- **Luz:** difusa e uniforme, 500–1.000 lux no ciclista (2 softboxes a 45°), sem contraluz (janela atrás) e sem sol direto na cena (o ToF piora; webcam estoura).
- **Exposição:** no pé, o pedal anda a 2π × 17,25 cm × 1,5 Hz ≈ **1,6 m/s** a 90 rpm. A 1/60 s o borrão é de ~2,7 cm; a 1/250 s, de ~6,5 mm. Com luz fraca a webcam alonga a exposição e cai de 60 para 30 fps (como o Kinect, que cai para 15 fps). Para 30 fps a exposição tem de ficar abaixo de 33 ms; o ideal é ≤ 4 ms com bastante luz.
- **Fundo:** claro e liso; nada de outra pessoa no quadro.
- **Roupa:** justa (bermuda e camisa de ciclismo), em cor que contraste com o fundo e com a bike; pernas à mostra ou meia de cor clara. Para ToF, evite tecido preto fosco (absorve IR) e tecido muito brilhante.
- **Marcadores (opcional):** adesivos redondos de 2–3 cm, de alto contraste, no trocânter maior, epicôndilo lateral do joelho, maléolo lateral, 5º metatarso, acrômio, epicôndilo do cotovelo e punho; na frontal, centro da patela e tuberosidade da tíbia. O protótipo **ainda não detecta marcadores**: eles servem para conferir visualmente e para uma versão futura (detecção de marcador refinando a pose). No ToF, marcador retrorrefletivo pode saturar o sensor; a Velogic vende uma fita própria (VF Tape).
- Adesivos também nos **5 pontos de calibração** (mesa, selim, movimento central, eixos) facilitam os cliques.

## 5. Sincronização

| Nível | Como |
|---|---|
| 1 | uma câmera só, nada a sincronizar |
| 2 (padrão) | **pela fase da pedalada**: cada vista vira um ciclo médio em 36 faixas de 10°. Na lateral, a fase é o ângulo do eixo do pedal estimado em volta do centro da trajetória dele. Na frontal, a fase vem dos picos de altura do pé interpolados no tempo, com o deslocamento "pé mais alto → pedal em cima" medido na própria lateral. Serve para câmeras sem relógio comum, para dois arquivos de vídeo e para inferência alternada |
| 2 (opcional) | **pelo relógio do navegador** (`performance.now()` na captura), com um campo de atraso da frontal em ms. As webcams USB têm latência diferente (30–100 ms), então use só com as duas câmeras ao vivo e confira o atraso |
| 3 | **por hardware**: Sync Hub (primária/secundária) e carimbo de tempo do dispositivo; as câmeras ToF disparam defasadas para não se interferirem |

## 6. Calibração passo a passo (níveis 2 e 3)

1. **Nivele a bike no rolo:** os dois eixos na mesma altura (confira com nível de bolha ou trena eixo–chão). O eixo X do sistema da bike segue a linha dos eixos.
2. **Meça com trena:** o entre-eixos (centro do cubo a centro do cubo, em cm); a distância da câmera lateral ao plano médio da bike; e, se quiser, a da frontal ao movimento central (o protótipo estima essa se ficar 0).
3. **Posicione e nivele as câmeras** conforme a seção 3, com nível de bolha ou app de nível no celular.
4. **Lateral, 5 cliques na ordem:** mesa (centro da tampa da caixa de direção), centro do selim, ponto baixo (movimento central), eixo dianteiro, eixo traseiro. É o bastão da Velogic trocado pelo clique.
5. **Confira:** o protótipo mostra "selim–MC" em cm (compare com a trena), a inclinação da linha dos eixos e o lado da câmera (direito/esquerdo).
6. **Frontal, os mesmos 5 pontos.** Os pontos ficam quase numa vertical. Se o eixo traseiro estiver escondido atrás do pneu dianteiro, clique o ponto da linha média na altura dele.
7. **Confira** a distância estimada, a guinada (bike torta em relação à câmera), o rolar e o "erro dos cliques" (< 1 cm é bom; > 3 cm, refaça).
8. **Lateral oposta (opcional):** os mesmos 5 cliques.
9. **Pedale 1–2 min** em cadência constante (60–90 rpm): as métricas usam o ciclo médio.

**O que a calibração calcula** (`site/js/cv/runtime/livres-e/fit3d.js`):

- **Sistema da bike:** origem no movimento central, X para a frente ao longo dos eixos, Y para cima, Z para a direita do ciclista, em cm.
- **Lateral:** os 5 pontos ficam no plano médio, à mesma distância da câmera, então determinam uma *semelhança* (rotação + escala pelo entre-eixos + origem). Isso corrige o rolar da câmera e o pitch da bike. Uma homografia exigiria 4 pontos com coordenadas conhecidas no plano, e os cliques só fixam uma distância; com a câmera perpendicular a diferença é desprezível. A perspectiva fora do plano (a perna do lado da câmera está ~10–15 cm mais perto e aparece ~6% maior a 2 m) é corrigida com o Z vindo da frontal: `Q = C + (Q_plano − C)·(D − δ)/D`.
- **Frontal:** modelo pinhole com o centro óptico no centro da imagem. O rolar vem das direções eixo dianteiro→mesa e MC→selim. Por mínimos quadrados, usando as alturas e posições X dos pontos medidas na lateral, saem a focal, a altura da câmera, a distância D (se não for informada), o deslocamento lateral e a **guinada** da bike. Daí, Z de qualquer junta: `Z = σ·(x'·prof/f − c − X·sen ψ)/cos ψ`.
- **Fusão:** X e Y vêm da lateral, do lado que a câmera vê de verdade. Z vem da frontal para ombro, cotovelo, punho, quadril, joelho, tornozelo, calcanhar e pé, dos dois lados. Lateral e frontal dependem uma da outra (profundidade × perspectiva), por isso são feitas duas iterações. O lado oposto à câmera lateral vem da lateral oposta, se houver; senão, da perna da câmera defasada 180° (pedalada simétrica), com o Z próprio medido na frontal.

## 7. Nível 3: ponte ToF (arquitetura, não implementada)

O navegador **não acessa** câmeras ToF Orbbec nem Kinect. O `getUserMedia` só entrega o RGB, quando entrega, e nunca a profundidade nem o body tracking. É preciso um programa nativo no PC do estúdio:

```
 Femto Mega (C1) ─┐  Ethernet/PoE    ┌──────────── PC do estúdio ─────────────┐
 Femto Mega (C2) ─┼─ switch PoE ────►│ aivision-ponte-tof (C++ ou Python)      │
   │  sync 8p→RJ45│                  │  • Orbbec SDK v2 (pyorbbecsdk): profun- │
   └─ Sync Hub Pro┘                  │    didade + cor alinhadas, carimbo HW   │
                                     │  • body tracking: K4A Body Tracking SDK │
                                     │    (via wrapper K4A da Orbbec, GPU      │
                                     │    CUDA) ou pose 2D no RGB + profund.   │
                                     │  • calibração por bastão: Kabsch        │
                                     │    câmera→bike com os 5 pontos 3D       │
                                     │  • fusão das 2 câmeras (média ponderada │
                                     │    pela confiança, mesmo carimbo)       │
                                     │  • WebSocket ws://127.0.0.1:8765        │
                                     └──────────────────┬──────────────────────┘
                                                        │ JSON por quadro (~30 Hz)
                                                        ▼
                         navegador: iaVision Bike Fit 3D (mesma tela, fonte "ToF")
```

- **Mensagem** (uma por quadro fundido): `{"t": 123456.789, "fonte": "tof", "cameras": ["C1","C2"], "juntas": {"joelho_d": [x, y, z, conf], …}, "unidade": "mm", "sistema": "bike"}`. Também há uma mensagem de estado (`{"tipo":"estado","cameras":[…],"fps":30,"sync":"ok"}`) e os comandos `calibrar` e `parar`, vindos do navegador.
- **Segurança:** a ponte escuta só em `127.0.0.1`, com um token gerado na instalação que o navegador envia no primeiro quadro. O Chrome pede permissão de *acesso à rede local* quando um site público fala com `localhost`; um WebSocket para `ws://127.0.0.1` não esbarra no COEP/COOP da página.
- **Reaproveitamento:** a calibração por cliques e a matemática de ângulos e knee travel continuam em `fit3d.js`. A ponte entrega pontos 3D já no sistema da bike, e a fusão por fase deixa de ser necessária (o sincronismo é de hardware).
- **Alternativa sem ponte:** gravar no FrameBlaster ou no Orbbec Viewer e importar arquivo (MKV com profundidade). Exigiria um leitor de MKV/profundidade em WASM, que é mais trabalho que a ponte.

## 8. Protótipo no navegador: "Bike Fit 3D (protótipo)"

Arquivos:

- `site/js/components/esportes/BikeFit3D.js`: a tela, `BikeFit3D({ onClose })`, em tela cheia.
- `site/js/cv/runtime/livres-e/fit3d.js`: a matemática pura (calibração, fusão, ângulos 3D, knee travel, CSV), testada no node.
- `site/css/bikefit-3d.css`: os estilos.

**Fontes.** Três vistas: lateral, frontal e lateral oposta (opcional). Cada uma recebe uma câmera escolhida pelo dispositivo ou um arquivo de vídeo. Arquivos são analisados **quadro a quadro** (pausa, busca o tempo, estima, avança 1/15 s; o passo é ajustável). Se a busca devolver quadro preto ou não responder, como acontece com alguns WebM sem índice, o arquivo passa a tocar em laço a 0,25× e o quadro da tela é amostrado. Atenção: a câmera simulada do Chrome entrega o *mesmo* arquivo para todos os dispositivos. Para testar duas vistas, use dois arquivos de vídeo.

**Pose.** YOLOX acha a pessoa; o BlazePose estima 33 pontos no recorte girado, que segue os pontos auxiliares do próprio modelo, como no operador do Bike Fit. Sem pessoa no detector, o recorte semeia com o quadro inteiro. As vistas são processadas **uma por vez, em rodízio**, e cada inferência espera a anterior, de modo que a fila única do ONNX (regra 2 de `arquitetura.md`) nunca recebe duas chamadas simultâneas desta tela.

**Visualização 3D.** Renderizador próprio em canvas 2D com projeção perspectiva, em vez de three.js. São ~40 segmentos e 4 trajetórias, o que não justifica 600 kB de biblioteca. O PNG é `toBlob` do mesmo canvas, e nada de fora entra na página (COEP intacto). Arrastar gira, a roda do mouse aproxima, e há vistas prontas (lateral, frontal, topo, 3/4). Mostra o esqueleto (ciclo médio animado ou ao vivo), o plano da bike, as rodas, o chão, os eixos X/Y/Z e as trajetórias 3D do joelho e do tornozelo dos dois lados.

**Métricas.**

- Ângulos 3D de joelho (PMI/PMS), quadril, tornozelo, cotovelo, ombro e tronco, comparados com os ângulos 2D do Bike Fit (pixels crus da lateral).
- **Knee travel**: amplitude do Z do joelho no ciclo, em mm.
- Desvio do joelho em relação à linha quadril–tornozelo (+ para fora), médio e no PMS.
- Posição lateral de quadril, joelho e pé em relação à linha média.
- Simetria direita − esquerda. Ela só é "real" nos ângulos quando há a lateral oposta.

**Exportar.** JSON (calibração, opções, métricas, ciclo médio com o esqueleto), CSV (36 faixas × 67 colunas) e PNG da vista 3D.

### Validação

- **Node, sintético:** esqueleto 3D conhecido com joelho oscilando para os lados, projetado em duas câmeras pinhole com rolar e guinada de 1,5–3°, ruído de 1 px nos pontos e de 1,5 px nos cliques, frontal a 25 fps e defasada da lateral a 30 fps (sem sincronia), 90 rpm, 20 s.
  - Joelho PMI 169,8° (verdade 170,4°) e PMS 72,9° (verdade 73,0°).
  - Knee travel 55,2 mm no lado da câmera (verdade 54,8) e 29,3 mm no oposto (verdade 28,5).
  - Desvio do joelho em relação à linha quadril–tornozelo 6,6 / −4,9 mm (verdade 6,3 / −4,7).
  - Erro RMS por faixa: ângulos de joelho, quadril e tornozelo de 0,9–1,9°; posição do joelho de 0,9–1,0 cm.
  - A distância da frontal foi estimada em 256 cm (verdade 255) e a guinada em 3,0° (verdade 3°).
  - Com ruído de 2 px e cliques com 3 px: PMI/PMS com erro de até 0,5°, knee travel 55,1 / 28,5 mm.
  - Sincronia pelo tempo, com câmeras sincronizadas: 53,8 / 29,8 mm.
  - Frontal esparsa (8 quadros/s com 30% perdidos): knee travel 49,5 / 35,2 mm; com 6 quadros/s e 30% perdidos a 80 rpm, 46,0 / 30,1 mm. A medida degrada, mas não explode, porque intervalos entre picos que valem 2–3 pedaladas são divididos pelo período medido por autocorrelação.
  - Cadência por autocorrelação da altura do tornozelo: 60,0 / 80,0 / 90,0 / 110,0 rpm medidos para 60 / 80 / 90 / 110 rpm reais. No vídeo real deu 106,6 rpm (referência independente ~110). Os outros métodos falharam com a pose ruidosa e a amostragem de 10 quadros/s: picos isolados deram 37 rpm e a fase geométrica, 25 rpm.
- **Navegador** (Chrome headless, máquina carregada, 20–1.200 ms por pose):
  - Dois vídeos ao mesmo tempo: a lateral real do teste do Bike Fit (rolo, Commons, CC BY 2.0) e uma frontal sintética renderizada do mesmo modelo 3D do teste do node. Calibração pelos cliques, análise quadro a quadro a 10 quadros/s, pose em rodízio, fusão, 3D e métricas, em 1440 e 390 px.
  - Na lateral real, em três rodadas: cadência de 105–106 rpm (referência independente ~110); joelho PMI de 148,8–151,3° em 3D contra 150,2–152,9° em 2D (o Bike Fit 2D mediu 142–145° ± 7 neste vídeo); PMS de 72,7–76,2°; tronco de 44–45° em 3D contra 42° em 2D.
  - O knee travel desse par não tem verdade: são dois ciclistas diferentes, e o BlazePose acerta mal o boneco sintético (PMI de 177° contra 170° de verdade). O par serve para provar o fluxo; a precisão foi validada no node.
  - Falta um vídeo frontal real com licença livre: no Commons não há ciclista filmado de frente com o corpo inteiro.

### Limitações e próximos passos

- É 3D **por fusão** de duas vistas 2D sem marcadores. O ruído da pose (±1–2 cm por junta) só se reduz com a média de muitas pedaladas. O knee travel de um único ciclo não é confiável.
- A fase da frontal precisa de ≥ 6 amostras por pedalada. Com câmeras ao vivo e inferência alternada, isso pede uma máquina rápida (WebGPU) ou cadência de 60–80 rpm durante a captura. Gravar e analisar o arquivo quadro a quadro resolve.
- Sem a lateral oposta, o lado de lá é a perna da câmera defasada 180°: serve para o Z (medido), mas não para comparar ângulos esquerda × direita.
- A guinada da câmera lateral não é estimada (só a da frontal). Mantenha a lateral perpendicular.
- A fase geométrica da lateral (ângulo do pedal estimado) depende de o pé estar visível no PMI. No vídeo real de teste ela trava perto do ponto morto inferior. O ciclo médio absorve isso, mas é o ponto mais frágil da fusão sem marcadores; um adesivo no pedivela ou no pé resolveria.
- A análise quadro a quadro de arquivo precisa de busca no vídeo. Arquivos abertos pelo seletor são Blobs e sempre aceitam busca. Vídeo servido sem `Range` ou WebM sem índice cai sozinho para "tocar a 0,25×".
- Próximos passos: (1) a ponte ToF (seção 7); (2) detecção de marcadores adesivos para refinar joelho e tornozelo; (3) `requestVideoFrameCallback` com o `captureTime` para a sincronia pelo relógio; (4) relatório HTML como o do Bike Fit.
