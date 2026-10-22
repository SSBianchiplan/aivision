# Catálogo de módulos, operadores e modelos

> Gerado a partir do código (`site/js/cv/registry.js`, `site/js/cv/runtime/onnx.js` e `models-livres-*.js`) — não editar à mão.

**40 módulos · 80 operadores · 38 modelos.**

## Módulos

| ID | Módulo | Operadores | Execução | Licença |
|---|---|---|---|---|
| CV-01 | Classical CV | 18 | client | livre |
| CV-02 | Image Classification | 1 | onnx | livre |
| CV-03 | Object Detection | 1 | onnx | livre |
| CV-04 | Motion & Tracking | 4 | client | livre |
| CV-05 | Segmentation | 1 | onnx | livre |
| CV-06 | Keypoint / Pose | 1 | onnx | livre |
| CV-07 | OCR | 1 | onnx | livre |
| CV-08 | Face Recognition | 2 | onnx | livre |
| CV-09 | Ultralytics YOLO26 | 8 | onnx | AGPL-3.0 (com aceite) |
| CV-10 | Códigos (QR e barras) | 1 | client | livre |
| CV-11 | Relações entre objetos | 1 | onnx | livre |
| CV-12 | Detecção de vocabulário aberto | 2 | onnx | AGPL-3.0 (com aceite) |
| CV-13 | Segmentação por prompt (SAM) | 1 | onnx | livre |
| CV-14 | Profundidade | 1 | onnx | livre |
| CV-15 | Zero-shot por texto (CLIP) | 1 | onnx | livre |
| CV-16 | Modelos treinados | 1 | onnx | AGPL-3.0 (com aceite) |
| CV-17 | OCR PT-BR | 1 | onnx | livre |
| CV-18 | Pose multi-pessoa (RTMO) | 1 | onnx | livre |
| CV-19 | Re-identificação de pessoas | 1 | onnx | livre |
| CV-20 | Recorte de fundo | 1 | onnx | livre |
| CV-21 | Florence-2 (descrever, detectar, ler) | 1 | transformers.js | livre |
| CV-22 | SAM 2 (seguir objeto) | 1 | onnx | livre |
| CV-23 | RF-DETR (detecção livre) | 1 | onnx | livre |
| CV-24 | Modelos treinados livres | 2 | onnx | livre |
| CV-25 | Mãos e gestos | 1 | onnx | livre |
| CV-26 | Malha do rosto | 1 | onnx | livre |
| CV-27 | Olhos (íris, piscadas, sonolência) | 1 | onnx | livre |
| CV-28 | Bike Fit (biomecânica) | 1 | onnx | livre |
| CV-29 | Ergonomia (RULA/REBA) | 1 | onnx | livre |
| CV-30 | Academia (repetições e forma) | 1 | onnx | livre |
| CV-31 | Salto e testes físicos | 1 | onnx | livre |
| CV-32 | Corrida (marcha) | 1 | onnx | livre |
| CV-33 | Swing (golfe e raquete) | 1 | onnx | livre |
| CV-34 | VBT (velocidade da barra) | 1 | client | livre |
| CV-35 | Esportes coletivos e de quadra | 1 | onnx | livre |
| CV-36 | Industrial — volumetria de correia (BeltScan) | 1 | client | livre |
| CV-37 | Ferramentas de cena | 1 | client | livre |
| CV-38 | Contagem em esteira (CounterVision) | 4 | client | livre |
| CV-39 | Industrial — tempo de posto (Takt) | 2 | client | livre |
| CV-40 | Inspeção visual (Inspect) | 7 | client | livre |

## Operadores por módulo

### CV-01 · Classical CV

Filtros, bordas, limiar, morfologia e realce — puro JS sobre ImageData.

#### Grayscale — `imgproc.cvt_color`

Converte para luminância (Rec.601), igual ao cv2.COLOR_BGR2GRAY.

#### Invert — `imgproc.bitwise_not`

Negativo da imagem.

#### Color Map — `imgproc.apply_color_map`

Mapeia intensidade em cor — leitura de mapas de calor e profundidade.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Mapa (`map`) | enum | jet | jet, hot, viridis |

#### Gaussian Blur — `imgproc.gaussian_blur`

Suavização gaussiana separável. sigma=0 deriva do ksize (fórmula OpenCV).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Kernel (`ksize`) | int | 5 | 1 – 31 |
| Sigma (`sigma`) | float | 0 | 0 – 10 |

#### Box Blur — `imgproc.blur`

Média simples — mais rápido que o gaussiano, borda mais dura.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Kernel (`ksize`) | int | 5 | 1 – 31 |

#### Median Blur — `imgproc.median_blur`

Mediana 3x3/5x5 — remove ruído sal-e-pimenta sem borrar bordas.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Kernel (`ksize`) | enum | 3 | 3, 5 |

#### Sobel — `imgproc.sobel`

Magnitude do gradiente 3x3.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Escala (`scale`) | float | 1 | 0.1 – 4 |

#### Laplacian — `imgproc.laplacian`

Segunda derivada — realça detalhe fino e ruído.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Escala (`scale`) | float | 1 | 0.1 – 4 |

#### Canny — `imgproc.canny`

Canny completo: gradiente → supressão não-máxima → histerese. Não borra internamente (igual ao cv2.Canny) — encadeie um blur antes.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Thresh baixo (`low`) | int | 50 | 0 – 255 |
| Thresh alto (`high`) | int | 150 | 0 – 255 |
| L2 gradient (`l2`) | bool | False |  |

#### Threshold — `imgproc.threshold`

Binarização global. Otsu escolhe o limiar automaticamente por frame.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Limiar (`thresh`) | int | 127 | 0 – 255 |
| Otsu (auto) (`otsu`) | bool | False |  |
| Inverter (`inv`) | bool | False |  |

#### Adaptive Threshold — `imgproc.adaptive_threshold`

Limiar por vizinhança — aguenta iluminação desigual, útil antes de OCR.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Bloco (`block`) | int | 11 | 3 – 51 |
| C (`C`) | int | 5 | -30 – 30 |
| Inverter (`inv`) | bool | False |  |

#### Morphology — `imgproc.morphology_ex`

Erode/dilate e as composições open/close, com kernel retangular.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Operação (`mode`) | enum | dilate | erode, dilate, open, close |
| Kernel (`ksize`) | int | 3 | 1 – 21 |

#### Equalize Hist — `imgproc.equalize_hist`

Equalização global de histograma pela CDF.

#### CLAHE — `imgproc.clahe`

Equalização adaptativa com limite de contraste, por tiles com interpolação bilinear — não estoura o ruído como a global.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Grade (`tiles`) | int | 8 | 2 – 16 |
| Clip limit (`clip`) | float | 2 | 1 – 8 |

#### Brightness / Contrast — `photo.convert_scale_abs`

Ajuste linear: out = alpha·in + beta.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Contraste (`alpha`) | float | 1 | 0.1 – 3 |
| Brilho (`beta`) | int | 0 | -100 – 100 |

#### Flip — `core.flip`

Espelha horizontal e/ou vertical.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Horizontal (`h`) | bool | True |  |
| Vertical (`v`) | bool | False |  |

#### Corner Detection — `features.good_features_to_track`

Cantos de Harris (R = det − k·tr²) com supressão não-máxima. Saída vai no overlay, não nos pixels.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Qualidade (`quality`) | float | 0.08 | 0.01 – 0.5 |
| Máx. cantos (`maxCorners`) | int | 120 | 10 – 500 |
| Dist. mín. (`minDist`) | int | 10 | 3 – 40 |

#### Contours / Blobs — `imgproc.find_contours`

Rotula componentes conexos de uma imagem binária e desenha a caixa de cada blob. Encadeie depois de um Threshold.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Área mín. (px) (`minArea`) | int | 300 | 10 – 20000 |
| Máx. blobs (`maxBlobs`) | int | 40 | 1 – 200 |
| Mostrar área (`showArea`) | bool | False |  |

### CV-02 · Image Classification

MobileNetV2 no ImageNet, 1000 classes, top-k com score.

Modelos: `mobilenetv2`

#### Image Classification — `dnn.classify`

MobileNetV2 no ImageNet (1000 classes). Mostra o top-k com score. Roda fora do loop de render — o vídeo não trava esperando.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Top-k (`topk`) | int | 3 | 1 – 5 |
| Intervalo (ms) (`everyMs`) | int | 400 | 100 – 3000 |
| Score mínimo (`minScore`) | float | 0.1 | 0 – 0.9 |

### CV-03 · Object Detection

YOLOX-S no COCO, 80 classes. Apache-2.0 — sem a contaminação AGPL que o YOLO da Ultralytics traria (RSK-03 do SPEC).

Modelos: `yolox`

#### Object Detection — `dnn.detect`

YOLOX-S no COCO (80 classes), Apache-2.0. Decodifica as 8400 âncoras das strides 8/16/32 e aplica NMS. Caixas vão no overlay, em coordenadas normalizadas.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.35 | 0.05 – 0.9 |
| IoU (NMS) (`iou`) | float | 0.45 | 0.1 – 0.9 |
| Máx. detecções (`maxDet`) | int | 30 | 1 – 100 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |
| Mostrar score (`showScore`) | bool | True |  |

### CV-04 · Motion & Tracking

Operadores com estado entre frames — e o tracking com IDs (ByTeTrack sem modelo: IoU + velocidade, duas passadas), com rastro e contagem por linha.

#### Frame Difference — `video.frame_diff`

absdiff contra o frame anterior. O jeito mais barato de detectar movimento — e a baseline honesta para comparar com detectores.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Limiar (`thresh`) | int | 18 | 0 – 120 |
| Ganho (`amplify`) | float | 3 | 1 – 10 |

#### Background Subtract — `video.background_subtractor`

Modelo de fundo por média corrente (aproximação leve do MOG2). Aprende a cena e destaca o que não pertence a ela.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Taxa de aprendizado (`rate`) | float | 0.04 | 0.005 – 0.3 |
| Limiar (`thresh`) | int | 28 | 5 – 120 |
| Só a máscara (`mask`) | bool | False |  |

#### Motion Trails — `video.motion_trails`

Decaimento temporal — o movimento deixa rastro. Bom para visualizar trajetória antes de existir tracking de verdade.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Persistência (`decay`) | float | 0.88 | 0.5 – 0.98 |

#### Tracking com IDs (ByteTrack) — `track.bytetrack`

IDs estáveis para os objetos do detector anterior na cadeia, rastro e contagem por linha. Sem modelo: IoU + previsão de velocidade, em duas passadas (alta e baixa confiança), como o ByteTrack.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança alta (`altaConf`) | float | 0.5 | 0.2 – 0.9 |
| IoU mínimo para casar (`iouMin`) | float | 0.3 | 0.1 – 0.8 |
| Frames para confirmar (`nascer`) | int | 2 | 1 – 10 |
| Frames até esquecer (`perder`) | int | 30 | 1 – 120 |
| Rastro (pontos) (`rastro`) | int | 30 | 0 – 90 |
| Linha de contagem (`linha`) | enum | nenhuma | nenhuma, horizontal, vertical |
| Posição da linha (`posicao`) | float | 0.5 | 0.1 – 0.9 |
| Mostrar classe (`mostrarNome`) | bool | True |  |

### CV-05 · Segmentation

PP-HumanSeg: máscara pessoa/fundo, com modos de composição.

Modelos: `pphumanseg`

#### Person Segmentation — `dnn.segment_person`

PP-HumanSeg: máscara pessoa/fundo em 192×192, reescalada e composta sobre o frame. Diferente dos outros modelos, este ALTERA os pixels.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modo (`mode`) | enum | destaque | destaque, fundo escuro, só máscara, croma |
| Limiar (`thresh`) | float | 0.5 | 0.1 – 0.9 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-06 · Keypoint / Pose

BlazePose com 33 landmarks, em dois estágios sobre o recorte do YOLOX.

Modelos: `yolox`, `pose`

#### Keypoint / Pose — `dnn.pose`

Dois estágios: o YOLOX acha a pessoa, o BlazePose estima 33 landmarks no recorte. Estimar pose no frame inteiro degrada muito — daí o recorte.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Visibilidade mín. (`minVis`) | float | 0.5 | 0 – 1 |
| Margem do recorte (`margin`) | float | 0.15 | 0 – 0.5 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |
| Mostrar recorte (`showBox`) | bool | False |  |

### CV-07 · OCR

PP-OCRv3 detecta as regiões, CRNN lê com decode CTC.

Modelos: `ppocr_det`, `crnn`

#### OCR — Texto — `dnn.ocr`

PP-OCRv3 gera o mapa de probabilidade de texto; a binarização vira caixas por componentes conexos, e o CRNN lê cada recorte com decode CTC. Só alfanumérico latino (o CRNN aqui é o modelo EN) e funciona com PALAVRAS SOLTAS: uma linha com várias palavras vira uma caixa só e sai ilegível. Para linhas de texto e português, use o OCR PT-BR (ocr.ptbr).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Limiar do mapa (`thresh`) | float | 0.3 | 0.1 – 0.9 |
| Área mín. (px) (`minArea`) | int | 120 | 20 – 5000 |
| Máx. caixas (`maxBoxes`) | int | 8 | 1 – 30 |
| Reconhecer texto (CRNN) (`recognize`) | bool | True |  |
| Intervalo (ms) (`everyMs`) | int | 700 | 100 – 4000 |

### CV-08 · Face Recognition

YuNet + SFace: detecção, alinhamento e embedding de 128-d. Biometria facial é dado pessoal SENSÍVEL (LGPD art. 5º, II) — o cofre implementa consentimento, retenção com expurgo, eliminação e portabilidade. Ainda falta a base legal formal e a DPIA.

Modelos: `yunet`, `sface`

#### Face Detection — `objdetect.face_detect`

YuNet (MIT, 230 KB): caixa da face + 5 landmarks (olhos, nariz, cantos da boca). É o estágio que alimenta o reconhecimento e o login.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.8 | 0.3 – 0.99 |
| Mostrar landmarks (`landmarks`) | bool | True |  |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

#### Face Recognition — `objdetect.face_recognize`

YuNet + SFace: alinha a face pelo template de 5 pontos e extrai o embedding de 128-d. A COMPARAÇÃO é feita no servidor — o template de ninguém é enviado ao navegador. Confere contra o seu próprio cadastro, e exige sessão ativa.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança da face (`conf`) | float | 0.8 | 0.3 – 0.99 |
| Ajuste do limiar (`margin`) | float | 0 | -0.2 – 0.3 |
| Indicar vivacidade (`liveness`) | bool | True |  |
| Intervalo (ms) (`everyMs`) | int | 1500 | 500 – 5000 |

### CV-09 · Ultralytics YOLO26

Suíte completa: detecção, instâncias, pose multi-pessoa, caixas orientadas, classificação, semântica, profundidade e tracking por re-ID. ⚠ AGPL-3.0 — desligado por padrão; o detector default é o YOLOX-S (Apache-2.0).

Modelos: `yolo26n`, `yolo26n-seg`, `yolo26n-pose`, `yolo26n-obb`, `yolo26n-cls`, `yolo26n-sem`, `yolo26n-depth`, `yolo26n-reid`

#### YOLO26 — Detecção — `yolo26.detect` · AGPL

Detecção end-to-end nas 80 classes COCO. Saída já decodificada e ordenada, sem NMS. AGPL-3.0.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.35 | 0.05 – 0.9 |
| Máx. detecções (`maxDet`) | int | 50 | 1 – 300 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |
| Mostrar score (`showScore`) | bool | True |  |

#### YOLO26 — Instâncias — `yolo26.segment` · AGPL

Segmentação de INSTÂNCIAS nas 80 classes: cada objeto ganha máscara própria. A máscara sai do produto dos 32 coeficientes pelos protótipos 32×160×160. É o que o PP-HumanSeg não faz (ele só separa pessoa/fundo).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.4 | 0.05 – 0.9 |
| Máx. instâncias (`maxDet`) | int | 10 | 1 – 30 |
| Opacidade (`alpha`) | float | 0.5 | 0.1 – 1 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |

#### YOLO26 — Pose — `yolo26.pose` · AGPL

Pose COCO de 17 keypoints, MULTI-PESSOA e em um estágio só — diferente do BlazePose, que precisa do recorte de uma pessoa.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.4 | 0.05 – 0.9 |
| Confiança do ponto (`kptConf`) | float | 0.3 | 0.05 – 0.9 |
| Máx. pessoas (`maxDet`) | int | 6 | 1 – 20 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |

#### YOLO26 — Caixas orientadas — `yolo26.obb` · AGPL

Caixas com ÂNGULO (15 classes DOTA, imagens aéreas). Entrada 1024² — o operador mais pesado do conjunto.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.35 | 0.05 – 0.9 |
| Máx. objetos (`maxDet`) | int | 20 | 1 – 50 |
| Intervalo (ms) (`everyMs`) | int | 1000 | 200 – 5000 |

#### YOLO26 — Classificação — `yolo26.classify` · AGPL

Classificação ImageNet (1000 classes), entrada 224².

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Top-k (`topk`) | int | 3 | 1 – 5 |
| Intervalo (ms) (`everyMs`) | int | 400 | 100 – 3000 |

#### YOLO26 — Semântica — `yolo26.semantic` · AGPL

Segmentação semântica Cityscapes (19 classes: estrada, prédio, pessoa, carro…). Cada pixel recebe uma classe. Entrada 1024².

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Opacidade (`alpha`) | float | 0.55 | 0.1 – 1 |
| Intervalo (ms) (`everyMs`) | int | 900 | 200 – 5000 |

#### YOLO26 — Profundidade — `yolo26.depth` · AGPL

Profundidade monocular: estima distância a partir de UMA câmera, sem estéreo. Saída em mapa de cor, normalizada por frame.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Mapa (`map`) | enum | turbo | turbo, cinza, inferno |
| Inverter (`invert`) | bool | False |  |
| Intervalo (ms) (`everyMs`) | int | 700 | 200 – 5000 |

#### YOLO26 — Tracking (re-ID) — `yolo26.track` · AGPL

Detecção + re-identificação por aparência: cada objeto recebe um ID que PERSISTE entre frames, e sobrevive a oclusão curta — o embedding de 512-d reencontra o objeto quando ele reaparece, coisa que associação só por posição não faz.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.45 | 0.1 – 0.9 |
| Máx. rastreados (`maxTrack`) | int | 4 | 1 – 8 |
| Similaridade mín. (`simMin`) | float | 0.72 | 0.3 – 0.98 |
| Sobrevida (frames) (`ttl`) | int | 30 | 1 – 90 |
| Intervalo mín. (ms) (`everyMs`) | int | 120 | 0 – 2000 |

### CV-10 · Códigos (QR e barras)

12 formatos: QR, EAN-13/8, UPC, Code 128/39, ITF, Codabar, Data Matrix, PDF417 e Aztec. Usa o decodificador nativo quando existe e cai no ZXing no Safari e Firefox. Cada leitura nova abre o painel de Códigos.

#### QR / Código de barras — `code.scan`

Lê QR Code, EAN, Code 128, Data Matrix, PDF417 e mais 7 formatos. Usa o decodificador nativo do navegador quando existe e cai no ZXing vendorizado no Safari e Firefox, que não o têm. Cada leitura nova abre o painel de Códigos.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Intervalo (ms) (`everyMs`) | int | 150 | 0 – 2000 |
| Repetir o mesmo após (ms) (`repeatMs`) | int | 4000 | 500 – 30000 |
| Mostrar o conteúdo (`showText`) | bool | True |  |
| Bipe na leitura (`beep`) | bool | True |  |
| Resolução da leitura (`scanWidth`) | enum | 960 | 480, 720, 960, 1280, 1600 |

### CV-11 · Relações entre objetos

RelateAnything (DINOv3 ViT-S/16+, 53M): recebe as caixas do detector da cadeia (YOLOX ou YOLO26 antes dele — ou roda o YOLOX sozinho) e diz como os objetos se relacionam: pessoa VESTINDO luva, xícara SOBRE mesa. 35 predicados de vocabulário aberto, grafo espacial e semântico. Apache-2.0; pesos derivados de DINOv3 (licença Meta).

Modelos: `relate`

#### Relações entre objetos — `relate.graph`

Grafo de cena: para cada par de objetos detectados, a relação mais provável entre 35 predicados (vestindo, segurando, sobre, atrás…). Usa as caixas do detector anterior na cadeia; sem ele, roda o YOLOX. Linhas azuis = relação espacial, verdes = semântica.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Score mínimo (`limiar`) | float | 0.45 | 0.05 – 0.95 |
| Máx. relações (`topK`) | int | 12 | 1 – 40 |
| Máx. objetos (`maxObj`) | int | 16 | 2 – 32 |
| Peso "existe relação" (`pesoPar`) | float | 1 | 0 – 2 |
| Confiança do YOLOX (sem detector) (`confDet`) | float | 0.35 | 0.05 – 0.9 |
| Intervalo mín. (ms) (`everyMs`) | int | 250 | 0 – 3000 |
| Limiar calibrado por predicado (`usarLimiarDoBanco`) | bool | False |  |
| Desenhar caixas (`mostrarCaixas`) | bool | True |  |
| Listar relações no canto (`mostrarLista`) | bool | True |  |
| Só relações semânticas (ações) (`soSemantica`) | bool | False |  |

### CV-12 · Detecção de vocabulário aberto

YOLOE-11s: 4.585 classes sem lista (prompt-free) ou as classes que você digitar (text-prompt, re-parametrizado ao vivo via MobileCLIP). Substitui as 80 classes fixas do COCO. ⚠ AGPL-3.0, atrás do mesmo aceite do YOLO26.

Modelos: `yoloe-pf`, `yoloe-text`, `clip-blt-text`

#### YOLOE — Detecta qualquer coisa — `yoloe.detect` · AGPL

4.585 classes embutidas (LVIS + Objects365), sem lista. O filtro por texto mantém só as classes citadas ("forklift, helmet, pallet"), sem retreinar. Nomes em inglês, como no vocabulário do modelo.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança (`conf`) | float | 0.25 | 0.05 – 0.9 |
| Só estas classes (`filtro`) | text |  |  |
| Máx. detecções (`maxDet`) | int | 30 | 1 – 100 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |
| Mostrar score (`showScore`) | bool | True |  |

#### YOLOE — Classes por texto — `yoloe.prompt` · AGPL

Digite as classes e o detector é re-parametrizado ao vivo: os vetores de texto entram no grafo como txt_feats. 1.760 nomes vêm de um banco pronto; um nome novo baixa o codificador MobileCLIP-BLT (127 MB) uma vez. Inglês.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Classes (`classes`) | text | person, forklift, helmet, box, pallet |  |
| Confiança (`conf`) | float | 0.15 | 0.05 – 0.9 |
| Máx. detecções (`maxDet`) | int | 30 | 1 – 100 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |
| Mostrar score (`showScore`) | bool | True |  |

### CV-13 · Segmentação por prompt (SAM)

MobileSAM: máscara de alta resolução para cada objeto detectado (prompt = caixa) ou para o centro da imagem. Codificador TinyViT uma vez por frame, decodificador leve por objeto. Apache-2.0.

Modelos: `mobilesam-enc`, `mobilesam-dec`

#### SAM — Máscaras finas — `sam.mascaras`

MobileSAM: máscara de alta resolução para cada objeto detectado (prompt = caixa do detector anterior; sem detector, roda o YOLOX) ou para o que está no centro da imagem. Codificador uma vez por frame, decodificador por objeto.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Prompt (`alvo`) | enum | objetos detectados | objetos detectados, centro da imagem |
| Máx. objetos (`maxObj`) | int | 6 | 1 – 12 |
| Opacidade (`alpha`) | float | 0.55 | 0.1 – 1 |
| Confiança do YOLOX (sem detector) (`confDet`) | float | 0.35 | 0.05 – 0.9 |
| Intervalo mín. (ms) (`everyMs`) | int | 800 | 100 – 5000 |
| Desenhar caixas e nomes (`caixas`) | bool | True |  |
| Só a máscara (fundo escuro) (`soMascara`) | bool | False |  |

### CV-14 · Profundidade

Depth Anything V2 small (24,8M, int8): mapa de profundidade relativa de um só frame — perto/longe por objeto, mapa de cor, cinza ou mistura. Apache-2.0.

Modelos: `depth-anything`

#### Profundidade (Depth Anything V2) — `depth.map`

Mapa de profundidade relativa de um só frame, 24,8M parâmetros, int8. Modos: mapa de cor (perto quente, longe frio), cinza, mistura com o vídeo, ou só rotular os objetos detectados como perto/médio/longe.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modo (`modo`) | enum | misturar | mapa de cor, cinza, misturar, só objetos |
| Opacidade (misturar) (`alpha`) | float | 0.6 | 0.1 – 1 |
| Inverter (longe quente) (`inverter`) | bool | False |  |
| Estabilidade dos extremos (`suavizar`) | float | 0.7 | 0 – 0.95 |
| Intervalo mín. (ms) (`everyMs`) | int | 300 | 0 – 3000 |

### CV-15 · Zero-shot por texto (CLIP)

MobileCLIP2-S0: classifica a cena ou cada objeto contra frases que você escreve ("caixa amassada", "EPI correto"), sem treinar. Licença Apple MobileCLIP.

Modelos: `mclip2-visual`, `mclip2-text`

#### Zero-shot por texto (MobileCLIP2) — `clip.classify`

Classifica a cena — ou cada objeto detectado — contra frases que você escreve, sem treinar nada. Softmax sobre o cosseno imagem×texto.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Classes (frases) (`classes`) | text | a person, a dog, a cat, a car, a cardboard box, a tool, an empty room |  |
| Molde da frase ({} = classe) (`modelo`) | text | a photo of {} |  |
| Classificar cada objeto detectado (`porObjeto`) | bool | False |  |
| Mostrar top-k (`topK`) | int | 3 | 1 – 6 |
| Probabilidade mínima (`minimo`) | float | 0.2 | 0 – 0.95 |
| Intervalo mín. (ms) (`everyMs`) | int | 400 | 0 – 3000 |

### CV-16 · Modelos treinados

Detectores YOLO26 que você treinou com as suas imagens (menu › Treinar). Rotule, treine no servidor e use aqui na câmera. AGPL-3.0.

#### Modelo treinado (GPlanSiS) — `custom.detect` · AGPL

Roda um detector que você treinou em “Treinar modelos” (menu). Campo Modelo vazio = o mais recente; ou cole o identificador da aba Modelos. Publica ctx.detections para os próximos operadores (tracking, relações, CLIP).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modelo (identificador) (`modelo`) | text |  |  |
| Confiança (`conf`) | float | 0.4 | 0.05 – 0.95 |
| Máx. detecções (`maxDet`) | int | 50 | 1 – 300 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |
| Mostrar score (`showScore`) | bool | True |  |

### CV-17 · OCR PT-BR

PP-OCRv5 mobile: detector DB + reconhecedor latino de 836 caracteres — lê português com acentos, cedilha e pontuação ("AÇÚCAR", "R$ 4,99", "até 31/12"). Apache-2.0.

Modelos: `ocr5-det`, `ocr5-latin`

#### OCR PT-BR (PP-OCRv5) — `ocr.ptbr`

Lê texto em português com acentos e pontuação (ç, ã, õ, é, R$, º…): detector DB do PP-OCRv5 mobile + reconhecedor latino de 836 caracteres, decode CTC. Publica os textos para os operadores seguintes. Só texto aproximadamente horizontal.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Lado maior na detecção (px) (`lado`) | int | 960 | 320 – 1600 |
| Limiar do mapa (`thresh`) | float | 0.3 | 0.1 – 0.9 |
| Score mín. da caixa (`boxThresh`) | float | 0.6 | 0.1 – 0.95 |
| Expansão da caixa (unclip) (`unclip`) | float | 1.5 | 1 – 3 |
| Confiança mín. da leitura (`minConf`) | float | 0.5 | 0 – 1 |
| Máx. linhas (`maxBoxes`) | int | 24 | 1 – 60 |
| Listar textos no canto (`mostrarLista`) | bool | True |  |
| Intervalo (ms) (`everyMs`) | int | 800 | 100 – 5000 |

### CV-18 · Pose multi-pessoa (RTMO)

RTMO-s (MMPose): todas as pessoas da cena num único passe, 17 pontos COCO cada, sem detector separado. Publica as caixas para Re-ID e tracking. Apache-2.0.

Modelos: `rtmo-s`

#### Pose multi-pessoa (RTMO) — `pose.rtmo`

Todas as pessoas da cena num único passe, cada uma com caixa e 17 pontos (COCO). Sem detector separado. Publica as caixas das pessoas para os operadores seguintes (Re-ID, tracking, SAM).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Score mín. da pessoa (`conf`) | float | 0.3 | 0.05 – 0.95 |
| Score mín. do ponto (`kpConf`) | float | 0.3 | 0 – 1 |
| Máx. pessoas (`maxPessoas`) | int | 20 | 1 – 50 |
| Mostrar caixa (`caixa`) | bool | True |  |
| Uma cor por pessoa (`corPorPessoa`) | bool | True |  |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |

### CV-19 · Re-identificação de pessoas

Youtu ReID (OpenCV Zoo): IDs persistentes por aparência — a pessoa mantém o número depois de oclusão ou de sair e voltar. Galeria com média móvel e cosseno sobre as caixas do detector anterior. Apache-2.0; substitui o re-ID do YOLO26.

Modelos: `reid-youtu`

#### Re-ID de pessoas (aparência) — `reid.pessoas`

IDs persistentes por aparência: a mesma pessoa mantém o número depois de oclusão ou de sair e voltar à cena. Usa as caixas do detector anterior (YOLOX, RTMO…) — ou o YOLOX sozinho — e uma galeria de embeddings de 768-d com média móvel e cosseno.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Similaridade mín. (cosseno) (`limiar`) | float | 0.55 | 0.3 – 0.9 |
| Inércia da galeria (média móvel) (`momento`) | float | 0.9 | 0 – 0.98 |
| Score mín. da pessoa (`minScore`) | float | 0.4 | 0.1 – 0.95 |
| Altura mín. (fração do frame) (`minAltura`) | float | 0.08 | 0 – 0.5 |
| Máx. pessoas por frame (`maxPessoas`) | int | 12 | 1 – 32 |
| Esquecer ID após (s, 0 = nunca) (`esquecerS`) | int | 600 | 0 – 3600 |
| Tamanho máx. da galeria (`maxGaleria`) | int | 100 | 4 – 500 |
| Só pessoas (ignora outras classes) (`soPessoas`) | bool | True |  |
| Limpar galeria (ligue e desligue) (`limpar`) | bool | False |  |
| Intervalo mín. (ms) (`everyMs`) | int | 150 | 0 – 3000 |

### CV-20 · Recorte de fundo

BiRefNet lite: separa o objeto principal do fundo com borda fina, para qualquer objeto. Remover fundo (xadrez/alfa), fundo escuro, desfoque, croma ou só máscara. MIT.

Modelos: `birefnet-lite`

#### Recorte de fundo (BiRefNet) — `seg.birefnet`

Separa o objeto principal do fundo com borda fina (cabelo, fios, alças), para qualquer coisa — não só pessoas. Modos: remover fundo (xadrez ou canal alfa), fundo escuro, desfocar fundo, croma verde ou só a máscara. Lento na CPU: infere a cada intervalo e reaproveita a última máscara.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modo (`modo`) | enum | remover fundo (xadrez) | remover fundo (xadrez), transparente (alfa), fundo escuro, desfocar fundo, croma, só máscara |
| Dureza da borda (`dureza`) | float | 0.3 | 0 – 1 |
| Limiar (borda dura) (`limiar`) | float | 0.5 | 0.05 – 0.95 |
| Raio do desfoque (px) (`raio`) | int | 16 | 4 – 60 |
| Brilho do fundo escuro (`escuro`) | float | 0.15 | 0 – 1 |
| Intervalo mín. (ms) (`everyMs`) | int | 1500 | 0 – 10000 |

### CV-21 · Florence-2 (descrever, detectar, ler)

Florence-2 base (Microsoft, 230M): um só modelo de visão-linguagem que descreve a cena, detecta objetos de vocabulário livre, lê texto e acha o que você escrever. Roda num worker a cada poucos segundos; responde em inglês. MIT.

Modelos: `florence2`

#### Florence-2 — descrever, detectar e ler — `florence2.tarefa`

Florence-2 base (Microsoft, MIT), 230 MB, no navegador: descreve a cena (curto ou detalhado), detecta objetos de vocabulário livre, lê texto (OCR) ou acha na imagem o que você escrever. Pesado: roda num worker a cada poucos segundos e o vídeo segue fluido. Responde em inglês; os nomes de objeto comuns são traduzidos.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Tarefa (`tarefa`) | enum | descrever (curto) | descrever (curto), descrever (detalhado), detectar objetos, ler texto (OCR), achar o que eu escrever |
| O que achar (de preferência em inglês) (`texto`) | text | a person |  |
| Intervalo mín. (ms) (`everyMs`) | int | 4000 | 1000 – 60000 |
| Traduzir nomes de objeto (`traduzir`) | bool | True |  |
| Desenhar caixas (`caixas`) | bool | True |  |
| Caracteres por linha do texto (`largura`) | int | 70 | 30 – 140 |

### CV-22 · SAM 2 (seguir objeto)

SAM 2.1 tiny (Meta): marque um objeto — por classe de uma detecção ou por um ponto — e ele é seguido com máscara e contorno, re-promptando com a caixa da máscara anterior. Ou uma máscara por detecção. Apache-2.0.

Modelos: `sam2-enc`, `sam2-dec`, `rfdetr-nano`

#### SAM 2 — seguir objeto — `sam2.seguir`

SAM 2.1 tiny (Apache-2.0): marque um objeto — pela classe de uma detecção anterior na cadeia (ou do RF-DETR embutido) ou por um ponto — e ele é seguido com máscara e contorno: a cada quadro o prompt é a caixa da máscara anterior. Se a máscara some, procura de novo. No modo "todas as detecções" faz uma máscara por caixa.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modo (`modo`) | enum | seguir objeto | seguir objeto, todas as detecções |
| Como marcar o objeto (`alvo`) | enum | detecção por classe | detecção por classe, ponto na imagem |
| Classe (vazio = qualquer) (`classe`) | text |  |  |
| Qual delas (0 = maior score) (`indice`) | int | 0 | 0 – 20 |
| Ponto X (0–1) (`pontoX`) | float | 0.5 | 0 – 1 |
| Ponto Y (0–1) (`pontoY`) | float | 0.5 | 0 – 1 |
| Folga da caixa no re-prompt (`margem`) | float | 0.1 | 0 – 0.5 |
| Limiar de presença (logit) (`minObj`) | float | 0 | -5 – 10 |
| Área mínima (fração do quadro) (`minArea`) | float | 0.0005 | 0 – 0.05 |
| Máx. objetos (todas) (`maxObj`) | int | 6 | 1 – 12 |
| Confiança do RF-DETR (sem detector) (`confDet`) | float | 0.45 | 0.1 – 0.9 |
| Opacidade (`alpha`) | float | 0.5 | 0.1 – 1 |
| Semelhança de cor mínima (perda) (`minCor`) | float | 0.45 | 0 – 1 |
| Desenhar contorno (`contorno`) | bool | True |  |
| Reiniciar alvo (alternar) (`reiniciar`) | bool | False |  |
| Intervalo mín. (ms) (`everyMs`) | int | 200 | 0 – 5000 |

### CV-23 · RF-DETR (detecção livre)

RF-DETR nano/small (Roboflow) no COCO, 80 classes: transformer de detecção sem NMS, a alternativa Apache-2.0 ao YOLO26 (AGPL). Publica as caixas para o resto da cadeia.

Modelos: `rfdetr-nano`, `rfdetr-small`

#### RF-DETR — Detecção (Apache-2.0) — `rfdetr.detect`

RF-DETR no COCO (80 classes), Apache-2.0 — a alternativa livre ao YOLO26. Transformer de detecção sem NMS: 300 consultas, cada uma já é uma caixa. Nano (384², 39 MB) para tempo real; small (512², 41 MB) acha objetos menores. Publica as caixas para os operadores seguintes (SAM, relações, tracking…).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Variante (`variante`) | enum | nano (384²) | nano (384²), small (512²) |
| Confiança (`conf`) | float | 0.5 | 0.05 – 0.95 |
| Máx. detecções (`maxDet`) | int | 30 | 1 – 100 |
| Só estas classes (vírgula; vazio = todas) (`classes`) | text |  |  |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 3000 |
| Mostrar score (`showScore`) | bool | True |  |

### CV-24 · Modelos treinados livres

Modelos que você treina em “Treinar modelos” com licença livre: detector RF-DETR (Apache-2.0) com as suas classes, e inspeção de anomalia PatchCore (Apache-2.0) treinada só com fotos de peças boas — mostra o mapa de calor, a nota e OK/REPROVADO.

#### Detector treinado (RF-DETR, livre) — `livres.rfdetr`

Roda um detector RF-DETR que você treinou em “Treinar modelos” (Apache-2.0, sem obrigações de código aberto). Campo Modelo vazio = o mais recente; ou cole o identificador da aba Modelos. Publica ctx.detections para os próximos operadores (tracking, relações, CLIP, profundidade).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modelo (identificador) (`modelo`) | text |  |  |
| Confiança (`conf`) | float | 0.5 | 0.05 – 0.95 |
| Máx. detecções (`maxDet`) | int | 50 | 1 – 300 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 2000 |
| Mostrar score (`showScore`) | bool | True |  |

#### Inspeção de anomalia (PatchCore) — `livres.patchcore`

Compara a imagem com o “banco” de peças boas aprendido em “Treinar modelos” (projeto de anomalia). Pinta o mapa de calor onde a peça foge do normal, mostra a nota e OK/REPROVADO pelo limiar calibrado no treino (ajuste com o fator). Enquadre a peça como nas fotos do treino.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Modelo (identificador) (`modelo`) | text |  |  |
| Limiar (× calibrado) (`fator`) | float | 1 | 0.5 – 2 |
| Mostrar (`modo`) | enum | mapa de calor | mapa de calor, só onde passa do limiar, só nota |
| Opacidade do mapa (`alpha`) | float | 0.55 | 0.1 – 1 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 3000 |

### CV-25 · Mãos e gestos

MediaPipe Hands (OpenCV Zoo, 8 MB): detector de palma + 21 pontos por mão, até 4 mãos, lado direita/esquerda e gestos por regras — mão aberta, punho, polegar para cima/baixo, apontando, V, OK e contagem de dedos. Apache-2.0.

Modelos: `mp-palma`, `mp-mao`

#### Mãos e gestos — `maos.gestos`

MediaPipe Hands (Apache-2.0): acha a palma, estima 21 pontos por mão e diz o lado (direita/esquerda) e o gesto — mão aberta, punho, polegar para cima/baixo, apontando, V, OK, chifres ou a contagem de dedos levantados. Publica ctx.hands.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança da palma (`conf`) | float | 0.5 | 0.2 – 0.95 |
| Confiança da mão (`minHand`) | float | 0.6 | 0.2 – 0.99 |
| Máximo de mãos (`max`) | int | 2 | 1 – 4 |
| Imagem espelhada (selfie) (`espelhado`) | enum | automático | automático, sim, não |
| Desenhar (`desenho`) | enum | esqueleto | esqueleto, pontos, só caixa |
| Reconhecer gestos (`gestos`) | bool | True |  |
| Publicar mãos como detecções (`deteccoes`) | bool | False |  |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-26 · Malha do rosto

MediaPipe Face Landmarker (4,9 MB) sobre o YuNet: 468 pontos do rosto + íris, malha completa ou contornos, e orientação da cabeça (yaw, pitch, roll). Segue o rosto entre quadros pela própria malha. Apache-2.0.

Modelos: `yunet`, `mp-malha`

#### Malha do rosto — `rosto.malha`

MediaPipe Face Landmarker (Apache-2.0): 468 pontos do rosto + 10 da íris sobre o detector YuNet. Desenha a malha, os pontos ou só os contornos (olhos, sobrancelhas, lábios, oval) e estima a orientação da cabeça (yaw, pitch, roll). Publica ctx.faceMesh.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança do rosto (`conf`) | float | 0.7 | 0.3 – 0.99 |
| Máximo de rostos (`max`) | int | 1 | 1 – 4 |
| Desenhar (`desenho`) | enum | contornos | contornos, malha, pontos, nenhum |
| Orientação da cabeça (`pose`) | bool | True |  |
| Seguir entre quadros (`seguir`) | bool | True |  |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-27 · Olhos (íris, piscadas, sonolência)

Íris e direção aproximada do olhar, olho aberto/fechado pelo EAR, piscadas por minuto, PERCLOS e alerta de sonolência configurável. Reusa a malha do CV-26 quando ele vem antes na cadeia. Apache-2.0.

Modelos: `yunet`, `mp-malha`

#### Olhos: íris, piscadas e sonolência — `olhos.iris`

Íris (centro e raio), direção aproximada do olhar, olho aberto/fechado pelo EAR, piscadas por minuto, PERCLOS e alerta de sonolência quando os olhos ficam fechados por mais de N segundos. Usa a malha do "Malha do rosto" se ele vier antes na cadeia.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| EAR de olho fechado (`limEar`) | float | 0.15 | 0.08 – 0.35 |
| Sonolência após (s) (`sonoSeg`) | float | 2 | 0.5 – 10 |
| Limiar olhar lateral (`limH`) | float | 0.08 | 0.02 – 0.3 |
| Limiar olhar vertical (`limV`) | float | 0.06 | 0.02 – 0.3 |
| Desenhar íris e pálpebras (`iris`) | bool | True |  |
| Confiança do rosto (`conf`) | float | 0.7 | 0.3 – 0.99 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-28 · Bike Fit (biomecânica)

Ajuste biomecânico do ciclista pela câmera, no navegador: ângulos de joelho (PMI/PMS), quadril, tronco, ombro, cotovelo e tornozelo na vista lateral; cadência e pedaladas pela trajetória do pé; KOPS aproximado; alinhamento e simetria dos joelhos na vista frontal; faixas por perfil (estrada, MTB, contrarrelógio, urbano) e recomendações de selim e guidão. Painel Bike Fit com relatório CSV/JSON/PDF. Usa a pose do CV-06 (Apache-2.0).

Modelos: `yolox`, `pose`

#### Bike Fit — análise do ciclista — `bikefit.analise`

Biomecânica do ciclista com a pose BlazePose: ângulos de joelho, quadril, tronco, ombro, cotovelo e tornozelo na articulação, PMI/PMS e cadência pela trajetória do pé, KOPS aproximado, alinhamento dos joelhos na vista frontal e recomendações por perfil. Tudo no navegador. Abra o painel Bike Fit para a tabela, o relatório e o guia de filmagem.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Vista da câmera (`vista`) | enum | lateral | lateral, frontal |
| Perfil (`perfil`) | enum | Estrada | Estrada, Mountain bike, Contrarrelógio/Triathlon, Urbano/Conforto |
| Lado analisado (`lado`) | enum | automático | automático, esquerdo, direito |
| Imagem espelhada (automático = segue a Fonte) (`espelhada`) | enum | automático | automático, sim, não |
| Visibilidade mín. (`minVis`) | float | 0.5 | 0.1 – 0.95 |
| Pedaladas na estatística (`nCiclos`) | int | 10 | 3 – 50 |
| Rastro do joelho e tornozelo (`rastro`) | bool | True |  |
| Altura do ciclista (cm; vale a do perfil do atleta, se houver; 0 = sem escala) (`alturaCm`) | int | 0 | 0 – 230 |
| Perna trocânter–tornozelo (cm, opcional) (`pernaCm`) | int | 0 | 0 – 130 |
| Fundir as duas orientações (estável, 2× custo) (`passadaDupla`) | bool | False |  |
| Re-detectar ciclista (ms, rede de segurança) (`detectarMs`) | int | 8000 | 1000 – 30000 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-29 · Ergonomia (RULA/REBA)

Avaliação postural do trabalho pela câmera, no navegador: RULA (membros superiores) e REBA (corpo inteiro) com as tabelas oficiais, uma nota por pessoa (várias pessoas, ID estável), ângulos de braço, antebraço, punho (com as mãos do CV-25), pescoço, tronco e pernas, nível de ação, % do tempo em cada nível, pior postura congelada e alertas. Painel Ergonomia com recomendações e relatório CSV/JSON/PDF. Estimativa sem marcadores. Usa a pose do CV-18 (Apache-2.0).

Modelos: `rtmo-s`

#### Ergonomia (RULA/REBA) — `ergonomia.avaliar`

Avaliação postural RULA (membros superiores) e REBA (corpo inteiro) pela pose, uma nota por pessoa: ângulos de braço, antebraço, punho, pescoço, tronco e pernas (vista lateral), tabelas oficiais, nível de ação, % do tempo em cada nível, pior postura e alertas. Usa a pose RTMO da cadeia ou roda a sua; mãos (MediaPipe) opcionais para o punho. Painel Ergonomia com relatório.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Método (`metodo`) | enum | RULA | RULA, REBA |
| Lado avaliado (`lado`) | enum | pior lado | pior lado, esquerdo, direito |
| Vista da câmera (`vista`) | enum | automática | automática, lateral, frontal |
| Trabalho sentado (`sentado`) | enum | automático | automático, sim, não |
| RULA: carga/força (0 <2 kg … 3 >10 kg) (`cargaRula`) | int | 0 | 0 – 3 |
| RULA: uso muscular (estática ou >4×/min) (`musculoRula`) | bool | False |  |
| Torção do punho (1 meio, 2 fim do curso) (`punhoTorcao`) | int | 1 | 1 – 2 |
| Punho sem mãos (1 neutro, 2 ≤15°, 3 >15°) (`punhoSemMaos`) | int | 2 | 1 – 3 |
| REBA: carga (0 <5 kg, 1 5–10, 2 >10) (`cargaReba`) | int | 0 | 0 – 2 |
| REBA: choque ou força brusca (`choque`) | bool | False |  |
| REBA: pega (0 boa … 3 inaceitável) (`pega`) | int | 0 | 0 – 3 |
| REBA: parte do corpo parada >1 min (`estatica`) | bool | False |  |
| Ações repetidas >4×/min (`repetitiva`) | bool | False |  |
| REBA: mudanças bruscas / base instável (`instavel`) | bool | False |  |
| Detectar postura estática (>1 min) (`estaticaAuto`) | bool | True |  |
| Ombro elevado (`ombroElevado`) | bool | False |  |
| Braço apoiado (`bracoApoiado`) | bool | False |  |
| Tronco torcido (`troncoTorcido`) | bool | False |  |
| Pescoço torcido (`pescocoTorcido`) | bool | False |  |
| Mãos (punho) (`maos`) | enum | da cadeia | da cadeia, rodar aqui, não usar |
| Imagem espelhada (`espelhada`) | enum | automático | automático, sim, não |
| Alertar a partir da faixa (2 médio, 3 alto, 4 muito alto) (`alertaFaixa`) | int | 3 | 2 – 4 |
| Alertar após (s) (`alertaSeg`) | int | 10 | 1 – 300 |
| Score mín. da pessoa (`conf`) | float | 0.3 | 0.05 – 0.95 |
| Score mín. do ponto (`kpConf`) | float | 0.3 | 0 – 1 |
| Máx. pessoas (`maxPessoas`) | int | 10 | 1 – 20 |
| Suavização (s) (`suavizar`) | float | 0.3 | 0 – 2 |
| Desenhar esqueleto (`esqueleto`) | bool | True |  |
| Intervalo mín. da pose (ms) (`everyMs`) | int | 0 | 0 – 2000 |

### CV-30 · Academia (repetições e forma)

Contador de repetições e treinador de forma pela câmera, no navegador: agachamento, flexão de braço, rosca bíceps, desenvolvimento de ombro, levantamento terra, afundo, polichinelo, abdominal e prancha (tempo e alinhamento), com o exercício escolhido ou reconhecido automaticamente. Séries pela pausa, amplitude, profundidade, tempos excêntrico/concêntrico e sob tensão, ritmo e checagens de forma (tronco, joelho × ponta do pé, valgo, quadril caindo, cotovelo abrindo, costas, assimetria) com repetição boa × com alerta, placar grande no vídeo e bipe. Painel Academia com metas, lista de repetições e relatório CSV/JSON/HTML. Usa a pose do CV-06 (Apache-2.0).

Modelos: `yolox`, `pose`

#### Academia — repetições e forma — `academia.treino`

Conta repetições e séries de agachamento, flexão, rosca, desenvolvimento, terra, afundo, polichinelo e abdominal (e o tempo da prancha) pela pose BlazePose, com o exercício escolhido ou reconhecido sozinho. Mede amplitude, profundidade, tempos excêntrico/concêntrico e sob tensão, e checa a forma (tronco, joelho × ponta do pé, valgo, quadril caindo, cotovelo, costas, assimetria). Placar grande no vídeo e bipe opcional. Tudo no navegador. Abra o painel Academia para metas, lista de repetições e relatório.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Exercício (`exercicio`) | enum | automático | automático, Agachamento, Flexão de braço, Rosca bíceps, Desenvolvimento de ombro, Levantamento terra, Afundo (lunge), Polichinelo, Abdominal, Prancha |
| Meta: séries (`metaSeries`) | int | 3 | 1 – 20 |
| Meta: repetições por série (`metaReps`) | int | 10 | 1 – 100 |
| Meta: segundos de prancha (`metaSegundos`) | int | 30 | 5 – 600 |
| Descanso entre séries (s) (`descansoS`) | int | 60 | 0 – 600 |
| Pausa que fecha a série (s) (`pausaSerieS`) | int | 10 | 2 – 60 |
| Tolerância das checagens (`tolerancia`) | enum | normal | normal, rigorosa, tolerante |
| Bipe a cada repetição (`bipe`) | bool | False |  |
| Placar e feedback grandes no vídeo (`textoGrande`) | bool | True |  |
| Desenhar o esqueleto (`esqueleto`) | bool | True |  |
| Imagem espelhada (automático = segue a Fonte) (`espelhada`) | enum | automático | automático, sim, não |
| Visibilidade mín. (`minVis`) | float | 0.5 | 0.1 – 0.95 |
| Re-detectar a pessoa (ms, rede de segurança) (`detectarMs`) | int | 12000 | 2000 – 60000 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-31 · Salto e testes físicos

Testes de salto pela câmera, no navegador: salto com contramovimento (CMJ), squat jump, drop jump (tempo de contato e RSI), saltos contínuos (média e fadiga) e salto horizontal. Altura pelo tempo de voo (h = g·t²/8) e pela subida do centro de massa com escala pela altura da pessoa, profundidade do contramovimento, tempo de carga, ângulos de joelho e quadril na decolagem e na aterrissagem, aterrissagem assimétrica e valgo (vista frontal), sempre com a incerteza da taxa de quadros. Análise quadro a quadro de vídeo (inclusive câmera lenta). Painel Salto com tentativas, comparação e relatório CSV/JSON/PDF. Usa a pose do CV-06 (Apache-2.0).

Modelos: `yolox`, `pose`

#### Salto — testes físicos — `salto.teste`

Salto vertical (CMJ, squat jump), drop jump com tempo de contato e RSI, saltos contínuos com fadiga e salto horizontal. Altura pelo tempo de voo (h = g·t²/8) e pela subida do centro de massa, contramovimento, tempo de carga, ângulos na decolagem e na aterrissagem, valgo na vista frontal, com a incerteza da amostragem. Pose BlazePose no navegador. Painel Salto para as tentativas e o relatório.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Teste (`teste`) | enum | CMJ | CMJ, squat jump, drop jump, contínuos, horizontal |
| Vista da câmera (`vista`) | enum | lateral | lateral, frontal |
| Altura da pessoa (cm, 0 = sem escala) (`alturaCm`) | int | 0 | 0 – 230 |
| Câmera lenta (fator: 240 fps exibido a 30 = 8) (`lenta`) | int | 1 | 1 – 16 |
| Imagem espelhada (automático = segue a Fonte) (`espelhada`) | enum | automático | automático, sim, não |
| Visibilidade mín. (`minVis`) | float | 0.4 | 0.1 – 0.95 |
| Re-detectar pessoa (ms) (`detectarMs`) | int | 6000 | 1000 – 30000 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-32 · Corrida (marcha)

Análise da corrida em esteira ou pista, câmera de lado: cadência, tempo de contato e de voo, fases de apoio e balanço, oscilação vertical do quadril, joelho no contato e flexão máxima, tornozelo, padrão de pisada (retropé, médio-pé, antepé), overstriding, inclinação do tronco e simetria esquerda/direita; de trás ou de frente, queda da pelve e cruzamento. Comprimento da passada com a velocidade da esteira. Painel Corrida com resumo por lado, alertas e relatório. Usa a pose do CV-06 (Apache-2.0).

Modelos: `yolox`, `pose`

#### Corrida — análise da marcha — `corrida.marcha`

Corrida vista de lado (esteira ou pista): cadência, tempo de contato e de voo, fases de apoio e balanço, oscilação vertical, joelho no contato e flexão máxima, tornozelo, padrão de pisada (retropé/médio-pé/antepé), overstriding, inclinação do tronco e simetria esquerda/direita. De trás ou de frente: queda da pelve e cruzamento. Uma pessoa (BlazePose, completo) ou várias (RTMO ou BlazePose por recorte, um ID e uma sessão por corredor). Avisa quando a câmera se move. Painel Corrida.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Vista da câmera (`vista`) | enum | lateral | lateral, trás/frente |
| Pessoas (`pessoas`) | enum | uma (completo) | uma (completo), várias |
| Várias: até N corredores (`maxPessoas`) | int | 6 | 1 – 20 |
| Várias: pose (RTMO 17 pontos \| BlazePose por recorte, 33) (`fonteMulti`) | enum | RTMO (todas) | RTMO (todas), BlazePose por recorte |
| Altura do corredor (cm, 0 = sem escala) (`alturaCm`) | int | 0 | 0 – 230 |
| Velocidade da esteira (km/h, opcional) (`velocidadeKmh`) | float | 0 | 0 – 30 |
| Câmera lenta (fator) (`lenta`) | int | 1 | 1 – 16 |
| Imagem espelhada (automático = segue a Fonte) (`espelhada`) | enum | automático | automático, sim, não |
| Visibilidade mín. (`minVis`) | float | 0.3 | 0.1 – 0.95 |
| Re-detectar corredor (ms) (`detectarMs`) | int | 6000 | 1000 – 30000 |
| Intervalo mín. (ms) (`everyMs`) | int | 0 | 0 – 1000 |

### CV-33 · Swing (golfe e raquete)

Análise do swing pela câmera ou por vídeo, no navegador: fases detectadas pela velocidade das mãos (preparação, backswing, topo, downswing, impacto, follow-through) com quadros-chave congelados; tempo de backswing/downswing e razão (≈3:1 no golfe), rotação de ombros e quadril, X-factor, inclinação da coluna, braço líder, estabilidade da cabeça, velocidade das mãos e angular do punho, trajetória das mãos (e da raquete/taco, se o detector achar) e transferência de peso. Golfe, tênis, padel, beach tennis e beisebol. Painel Swing: lista, comparação lado a lado, CSV/JSON/relatório. Usa a pose do CV-06 (Apache-2.0).

Modelos: `yolox`, `pose`

#### Swing — golfe e raquete — `swing.analise`

Análise do swing pela pose BlazePose: fases (preparação, backswing, topo, downswing, impacto, follow-through) pela velocidade das mãos, quadros-chave congelados, tempo e razão backswing/downswing, rotação de ombros e quadril, X-factor, coluna, braço líder, cabeça, velocidade das mãos e transferência de peso. Golfe, tênis, padel, beach tennis e beisebol. Abra o painel Swing para comparar e exportar.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Esporte e golpe (`perfil`) | enum | Golfe · Drive | Golfe · Drive, Golfe · Ferro, Tênis · Saque, Tênis · Forehand, Tênis · Backhand, Padel · Forehand, Padel · Backhand, Padel · Smash, Padel · Bandeja, Beach tennis · Forehand, Beach tennis · Backhand, Beach tennis · Smash, Beach tennis · Saque, Beisebol · Rebatida |
| Mão dominante (`dominante`) | enum | destro | destro, canhoto |
| Vista da câmera (`vista`) | enum | frente | frente, linha do alvo |
| Altura do atleta (cm, 0 = sem escala) (`alturaCm`) | int | 0 | 0 – 230 |
| Imagem espelhada (automático = segue a Fonte) (`espelhada`) | enum | automático | automático, sim, não |
| Seguir raquete/taco (YOLOX, mais lento) (`implemento`) | bool | False |  |
| Intervalo do detector de implemento (ms) (`implementoMs`) | int | 400 | 150 – 3000 |
| Vídeo em câmera lenta (×) (`lento`) | float | 1 | 1 – 16 |
| Pico mín. das mãos (troncos/s, 0 = do esporte) (`vMin`) | float | 0 | 0 – 30 |
| Rastro das mãos (`rastro`) | bool | True |  |
| Re-detectar pessoa (ms) (`detectarMs`) | int | 6000 | 1000 – 30000 |

### CV-34 · VBT (velocidade da barra)

Treino baseado em velocidade com um marcador ArUco impresso na ponta da barra (vista lateral): trajetória, deslocamento, velocidade média, propulsiva e de pico da fase concêntrica, potência com a carga, repetições, perda de velocidade da série com alerta e zonas de velocidade. Calibra pelo tamanho real do marcador. Sem marcador, modo aproximado pelos punhos (BlazePose). Painel VBT com tabela, CSV/JSON/relatório e a página para imprimir o marcador.

Modelos: `yolox`, `pose`

#### VBT — velocidade da barra — `vbt.barra`

Velocidade da barra pelo marcador ArUco impresso na ponta (vista lateral): trajetória, deslocamento, velocidade média e de pico da fase concêntrica, potência com a carga informada, repetições, perda de velocidade da série e zonas de velocidade. Sem marcador, modo aproximado pelos punhos (BlazePose). Abra o painel VBT para a tabela e o relatório.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Fonte da posição (punho (aproximado) = sem marcador, pela pose) (`modo`) | enum | marcador | marcador, punho (aproximado) |
| Exercício (`exercicio`) | enum | Agachamento | Agachamento, Supino, Levantamento terra, Desenvolvimento, Remada curvada, Remada (horizontal), Power clean, Hip thrust, Glute bridge (ponte), Outro |
| Carga (kg) (`cargaKg`) | float | 60 | 0 – 500 |
| Lado do marcador impresso (cm) (`marcadorCm`) | float | 5 | 1 – 30 |
| Id do marcador (−1 = qualquer) (`marcadorId`) | int | -1 | -1 – 49 |
| Alerta de perda de velocidade (%) (`limitePerda`) | int | 20 | 5 – 60 |
| Deslocamento mín. da repetição (cm, 0 = do exercício) (`deslMinCm`) | int | 0 | 0 – 80 |
| Pausa que abre nova série (s, 0 = manual) (`pausaSerieS`) | int | 30 | 0 – 600 |
| Largura para achar o marcador (px) (`resolucao`) | int | 960 | 320 – 1920 |
| Vídeo em câmera lenta (×) (`lento`) | float | 1 | 1 – 16 |
| Ponto seguido sem marcador (automático = pelo exercício) (`ponto`) | enum | automático | automático, punhos (barra), quadril, ombros |
| Escala sem marcador (`escala`) | enum | altura | altura, segmento, 2 cliques |
| Altura do atleta (cm) (`alturaCm`) | int | 175 | 100 – 230 |
| Segmento da escala (`segmento`) | enum | coxa | coxa, canela |
| Comprimento do segmento (cm, 0 = estimado da altura) (`segmentoCm`) | float | 0 | 0 – 80 |
| 2 cliques: pontos (x1,y1,x2,y2 em milésimos da largura) (`calib2p`) | text |  |  |
| 2 cliques: distância real (cm) (`calibCm`) | float | 45 | 1 – 500 |
| Referência de inclinação (x1,y1,x2,y2; vazio = vertical da imagem) (`vertical`) | text |  |  |
| A referência é uma linha vertical ou horizontal (chão/banco) (`verticalTipo`) | enum | vertical | vertical, horizontal |
| Exercício horizontal: sentido da concêntrica (`sentidoH`) | enum | automático | automático, para a esquerda, para a direita |
| Visibilidade mínima do ponto (pose) (`minVis`) | float | 0.5 | 0.3 – 0.9 |
| Imagem espelhada (pose) (`espelhada`) | enum | automático | automático, sim, não |
| Desenhar a trajetória (`rastro`) | bool | True |  |

### CV-35 · Esportes coletivos e de quadra

Futebol, futsal, basquete, vôlei, tênis e padel com uma câmera: jogadores e bola, IDs, times pela cor do uniforme, calibração da quadra por 4+ pontos (homografia) com as medidas oficiais, radar 2D, mapa de calor, distância e velocidade por jogador, tempo por zona; posse e passes, quique dentro/fora, rally e arremessos. Painel Quadra com exportação CSV/JSON e relatório. Usa o RF-DETR (Apache-2.0) ou o detector da cadeia.

Modelos: `rfdetr-small`, `rfdetr-nano`

#### Quadra — esportes coletivos e de quadra — `quadra.analise`

Jogadores e bola (do detector anterior na cadeia ou RF-DETR próprio), IDs, times pela cor do uniforme, calibração da quadra por 4+ pontos (homografia) → radar 2D, mapa de calor, distância, velocidade e zonas por jogador; posse e passes (futebol, futsal, basquete), quique dentro/fora e rally (tênis, padel, vôlei), arremessos com o aro marcado (basquete). Abra o painel Quadra para calibrar, ver o radar e exportar.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Esporte (`esporte`) | enum | futebol | futebol, futsal, basquete, vôlei, tênis, padel |
| Comprimento do campo (m, 0 = oficial) (`comprimento`) | float | 0 | 0 – 120 |
| Largura do campo (m, 0 = oficial) (`largura`) | float | 0 | 0 – 90 |
| Detector (automático = o da cadeia, senão RF-DETR small) (`detector`) | enum | automático | automático, cadeia, RF-DETR small, RF-DETR nano, YOLOX |
| Confiança (jogadores) (`conf`) | float | 0.35 | 0.1 – 0.9 |
| Confiança (bola) (`confBola`) | float | 0.15 | 0.05 – 0.9 |
| Bola: 2ª passada ampliada (2× custo) (`bolaZoom`) | enum | desligado | desligado, perto da última bola, perto da bola + varredura |
| Classes de jogador (`classesJogador`) | text | pessoa, person, player, jogador, goalkeeper, goleiro, referee, árbitro |  |
| Classes de bola (`classesBola`) | text | bola, sports ball, ball |  |
| Times por (`times`) | enum | automático | automático, cor do uniforme, lado da quadra, não separar |
| Só quem está na quadra (com calibração) (`soQuadra`) | bool | True |  |
| Margem além das linhas (m) (`margem`) | float | 2 | 0 – 10 |
| Tênis: dentro/fora pelas linhas de duplas (`duplas`) | bool | False |  |
| Fim do rally sem bola (s) (`fimRallyS`) | float | 2.5 | 1 – 8 |
| Calibração (preenchida pelo painel Quadra) (`calibracao`) | text |  |  |
| Desenhar as linhas da quadra calibrada (`mostrarLinhas`) | bool | True |  |
| Radar no vídeo (`radar`) | enum | canto inferior direito | nenhum, canto inferior direito, canto inferior esquerdo, canto superior direito |
| Rótulos (`rotulos`) | enum | id e velocidade | id e velocidade, id, nenhum |
| Rastro da bola (`rastroBola`) | bool | True |  |
| Intervalo mín. do detector próprio (ms) (`everyMs`) | int | 0 | 0 – 2000 |

### CV-36 · Industrial — volumetria de correia (BeltScan)

Volumetria de correia transportadora pela câmera e uma linha laser, no navegador: linha subpixel, altura por triangulação com o ângulo da câmera, seção na calha (DIN 22101), vazão m³/h, massa seca t/h, nível representativo com altura limite e alarmes ISA-18.2 (banda morta, retardos, prioridade, supressão, reconhecimento, histórico CSV). Na bancada, seção em mm² × velocidade por correlação de fase = cm³/s e volume. Configuração "beltscan/4" compatível com o GPlanSiS\|BELTSCAN (HTML e Python). Tela cheia GPlanSiS\|BeltScan com ensaios de feijão.

#### BeltScan — volumetria de correia — `beltscan.volumetria`

Volumetria de correia transportadora por triangulação laser–câmera (porte do GPlanSiS\|BELTSCAN): linha laser subpixel, altura pela geometria da câmera, seção DIN 22101, vazão, massa seca, nível representativo com altura limite e alarmes ISA-18.2; na bancada, seção × velocidade por correlação de fase. Configuração "beltscan/4" (a mesma do HTML e do Python). Abra a tela GPlanSiS\|BeltScan para configurar, calibrar e acompanhar.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Largura de análise (px; a configuração se reescala) (`largura`) | int | 1280 | 320 – 1920 |
| Desenhar no vídeo (linha, referência, limite) (`desenhar`) | bool | True |  |
| Faixa com seção, vazão e volume (`faixa`) | bool | True |  |

### CV-37 · Ferramentas de cena

Marcações desenhadas com o mouse sobre o vídeo controlando o processamento: ROI ("processar só aqui") e exclusão aplicadas antes da cadeia, zonas que contam ocupação, entradas e permanência, linhas que contam cruzamentos por sentido, régua calibrada em mm e ângulo. Usa as caixas do detector, poses, mãos ou rostos da cadeia; com rastreio, conta por ID. Exportação CSV dos eventos.

#### Zonas e linhas (contagem) — `cena.zonas`

Conta por ZONA (ocupação, máxima, entradas, permanência) e por LINHA (cruzamentos nos dois sentidos) desenhadas com as Ferramentas de mouse. Coloque depois do detector (e do Tracking com IDs, para contar por ID e cruzamentos).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Objetos de (`fonte`) | enum | automático | automático, detecções, poses, mãos, rostos, caixas desenhadas |
| Ponto de referência (`ponto`) | enum | base (pés) | base (pés), centro |
| Só estas classes (vírgula; vazio = todas) (`classes`) | text |  |  |
| Confiança mínima (`confMin`) | float | 0 | 0 – 0.95 |
| Quadros fora até contar saída (`sair`) | int | 8 | 1 – 90 |
| Mostrar pontos de referência (`mostrarPontos`) | bool | True |  |
| Linha: cada ID conta uma vez (`umaVez`) | bool | False |  |

### CV-38 · Contagem em esteira (CounterVision)

Contagem de peças em esteira, no navegador (porte do GPlanSiS\|CounterVision): motor COR sem modelo (amostra por clique, tolerância, máscara, separação de peças encostadas, rastreio com ID) ou detector (YOLOX, RF-DETR, o seu .onnx) + rastreio; conta pelas linhas (com sentido) e zonas das Ferramentas de mouse; peças/min e /h, turnos e metas, alarmes de parada e de taxa, eventos e CSV, fila guardada neste navegador e captura de quadros com caixas YOLO para o Treinar. Tela GPlanSiS\|CounterVision.

#### Contagem — motor COR (sem modelo) — `contagem.cor`

Detecta peças pela COR, sem modelo: amostre clicando numa peça (Studio CounterVision › Calibrar cor) ou escolha a cor. Máscara HSV com tolerância, abertura, componentes conectados, separa peças encostadas pela área típica (k-means) e rastreia por centroide com ID. Coloque Zonas e linhas e a Contagem em esteira depois.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Resolução de análise (px) (`work`) | int | 320 | 160 – 640 |
| Tolerância de cor (+° de matiz) (`tol`) | int | 6 | 0 – 40 |
| Tamanho típico (×) (`tamMul`) | float | 1 | 0.4 – 2.5 |
| Área mínima (fração do típico) (`minFrac`) | float | 0.35 | 0.05 – 0.9 |
| Área mínima sem tamanho típico (px) (`minPx`) | int | 12 | 4 – 400 |
| Remover ruído (abertura) (`abertura`) | bool | True |  |
| Separar peças encostadas (k-means) (`separar`) | bool | True |  |
| Quadros para confirmar a peça (`minHits`) | int | 3 | 1 – 10 |
| Quadros tolerados sem ver (`maxMiss`) | int | 6 | 1 – 30 |
| Raio de associação (× tamanho) (`gate`) | float | 1.5 | 0.4 – 4 |
| Suavização da posição (`ema`) | float | 0.5 | 0.05 – 1 |
| Desenhar peças e IDs (`desenhar`) | bool | True |  |

#### Contagem — detector ONNX do usuário — `contagem.onnx`

Roda o .onnx de detector escolhido no painel Contagem em esteira (fica neste navegador; saída [1,N,6] fim a fim ou [1,4+C,N] estilo YOLO). Para detector livre já pronto, use YOLOX ou RF-DETR. Ponha Tracking com IDs depois, para contar por linha.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança mínima (`conf`) | float | 0.35 | 0.05 – 0.95 |
| IoU do NMS (`iou`) | float | 0.5 | 0.2 – 0.9 |
| Máximo de detecções (`maxDet`) | int | 300 | 1 – 600 |
| Intervalo mínimo (ms) (`everyMs`) | int | 0 | 0 – 2000 |

#### Contagem — rastreio por centroide (esteira) — `contagem.rastreio`

O rastreador do CounterVision para as caixas de um detector (YOLOX, RF-DETR, o seu .onnx): associação por distância com previsão de velocidade, mesma classe, confirmação e tolerância a falhas. Na esteira (peças andando mais que o próprio tamanho entre duas inferências) segura o ID melhor que o casamento por IoU.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança mínima (`confMin`) | float | 0.3 | 0 – 0.95 |
| Inferências para confirmar (`minHits`) | int | 2 | 1 – 10 |
| Inferências toleradas sem ver (`maxMiss`) | int | 5 | 1 – 30 |
| Raio de associação (× tamanho) (`gate`) | float | 1.5 | 0.4 – 4 |
| Suavização da posição (`ema`) | float | 0.6 | 0.05 – 1 |
| Desenhar IDs (`desenhar`) | bool | True |  |

#### Contagem em esteira (CounterVision) — `contagem.esteira`

Produção a partir das linhas e zonas (coloque depois de Zonas e linhas): total por sentido e classe, peças/min e /h, gráfico por minuto, turnos com meta e projeção, alarmes de parada e de taxa baixa/alta, eventos com hora, ID, sentido, classe e confiança, fila guardada neste navegador e CSV. Tela GPlanSiS\|CounterVision.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Contar por (`base`) | enum | automático | automático, linhas, zonas, linhas e zonas |
| Sentido que conta (linhas) (`sentido`) | enum | ambos (soma) | ambos (soma), ida, volta, líquido (ida − volta) |
| Confiança mínima do evento (`confMin`) | float | 0 | 0 – 0.95 |
| Janela da taxa (s) (`janelaS`) | int | 60 | 10 – 600 |
| Meta por turno (peças; 0 = sem) (`meta`) | int | 0 | 0 – 1000000 |
| Turnos (nome hh:mm-hh:mm; …) (`turnos`) | text | T1 06:00-14:00; T2 14:00-22:00; T3 22:00-06:00 |  |
| Alarme de parada após (s sem peça; 0 = desligado) (`paradaS`) | int | 30 | 0 – 3600 |
| Alarme taxa baixa (peças/min; 0 = desligado) (`taxaMin`) | float | 0 | 0 – 100000 |
| Alarme taxa alta (peças/min; 0 = desligado) (`taxaMax`) | float | 0 | 0 – 100000 |
| Faixa com total e taxa no vídeo (`faixa`) | bool | True |  |

### CV-39 · Industrial — tempo de posto (Takt)

Tempo de posto pela câmera, no navegador (porte do GPlanSiS\|Takt): postos marcados na imagem, pessoas pela pose multi-pessoa com IDs, escore de atividade (mãos no posto, movimento dos punhos, orientação), estados produtivo / ocioso no posto / vago / pausa programada / não observado com histerese e tempos mínimos, agenda de turnos e pausas, KPI por turno, alarmes, homografia do piso em metros (erro de reprojeção) e rostos borrados por padrão (LGPD) também na gravação e no PNG. Tela cheia GPlanSiS\|Takt com Gantt, ranking, planta do piso e CSV.

Modelos: `rtmo-s`

#### Takt — tempo de posto — `takt.posto`

Tempo de posto (porte do GPlanSiS\|Takt): para cada área marcada com a função "Takt · posto", associa as pessoas (pose multi-pessoa + IDs), mede a atividade (mãos na área, movimento dos punhos, orientação) e decide produtivo, ocioso no posto, vago, pausa programada ou não observado, com histerese e tempos mínimos. Turnos e pausas, piso calibrado em metros, rostos borrados (LGPD), KPIs, alarmes e CSV no Studio Takt.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Borrar rostos (LGPD) (`borrarRostos`) | bool | True |  |
| Desenhar postos e pessoas no vídeo (`desenhar`) | bool | True |  |
| Esqueleto (quando a pose é própria) (`esqueleto`) | bool | True |  |
| Score mín. da pessoa (pose própria) (`conf`) | float | 0.3 | 0.05 – 0.95 |
| Máx. pessoas (pose própria) (`maxPessoas`) | int | 12 | 1 – 30 |
| Intervalo mín. da pose própria (ms) (`everyMs`) | int | 0 | 0 – 2000 |

#### Privacidade — borrar rostos (LGPD) — `privacidade.borrar_rostos`

Borra o rosto de cada pessoa a partir dos pontos da cabeça da pose (nariz, olhos, orelhas), sem detector facial nem reconhecimento — porte do privacy.py do GPlanSiS\|Takt. Muda os pixels: o vídeo, a gravação e o PNG saem borrados. Coloque depois da Pose multi-pessoa (ou ele roda o RTMO sozinho).

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Confiança mín. do ponto da cabeça (`minConf`) | float | 0.2 | 0.05 – 0.9 |
| Borrar também o topo da caixa de cada pessoa (conservador) (`caixas`) | bool | True |  |
| Intervalo mín. da pose própria (ms) (`everyMs`) | int | 0 | 0 – 2000 |

### CV-40 · Inspeção visual (Inspect)

Inspeção de qualidade pela câmera, no navegador (porte do GPlanSiS\|Inspect): presença por molde (NCC), contagem de manchas/furos (Otsu, adaptativo), paquímetro em mm com sub-pixel, cor por ΔE2000, forma (Ø equivalente, circularidade, solidez, alongamento), área de defeito por HSV, OCR de lote e validade (PP-OCRv5, {LOT}/{TODAY}, validade mínima), códigos QR/DataMatrix/EAN com GS1 e GTIN, número de série com sequência, detector (YOLOX/RF-DETR/treinado), classificação conformal e anomalia PatchCore com mapa de calor, cada uma lendo a ROI das marcações "Inspect · …". Programa (receita) versionado com gatilho de presença, linha, intervalo ou manual, alinhamento à peça de referência, veredito OK / NOK / INCERTO, histórico, fila de revisão humana, CSV, alarmes de sequência e Cpk. Tela cheia GPlanSiS\|Inspect.

#### Inspeção visual — programa com gatilho — `inspect.programa`

Roda o PROGRAMA de inspeção ativo (receita versionada: ferramentas, ROIs, limites, gatilho) quando o gatilho dispara — presença (fundo aprendido + histerese), linha, intervalo ou manual. Congela o quadro em resolução plena, alinha à peça de referência (opcional), roda presença, contagem, paquímetro, cor, forma, área de defeito, OCR de lote/validade, código, serial, detector, classificação e anomalia (as com modelo fora do laço de quadros; o veredito espera por elas) e dá o veredito OK / NOK / INCERTO, com histórico, fila de revisão humana e CSV. Abra a tela GPlanSiS\|Inspect para montar o programa e acompanhar.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Largura da inspeção (px do quadro congelado) (`largura`) | int | 1280 | 320 – 1920 |
| Desenhar gatilho e resultados no vídeo (`desenhar`) | bool | True |  |
| Modelo de programa (presets) (`modelo`) | enum | — | —, presenca, dimensional, cor_defeito |

#### Inspeção — presença (molde NCC) — `inspect.presenca`

Presença de peça/componente por correlação normalizada (NCC, como o matchTemplate do OpenCV): o molde é a caixa da marcação "Inspect · presença" na primeira passada (peça boa na frente); a busca vai até a folga em volta. OK com NCC ≥ mínimo, INCERTO perto do limite, NOK abaixo.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| NCC mínimo (`min_score`) | float | 0.8 | 0.3 – 1 |
| Folga da busca (fração da caixa) (`folga`) | float | 0.25 | 0 – 1 |
| Recapturar o molde (alterne) (`recapturar`) | bool | False |  |
| Rodar a cada (ms) (`intervalo`) | int | 300 | 50 – 5000 |
| Largura de análise (px) (`largura`) | int | 1280 | 320 – 1920 |
| Faixa de incerteza (fração do limite) (`faixa`) | float | 0.05 | 0 – 0.5 |
| Desenhar no vídeo (`desenhar`) | bool | True |  |

#### Inspeção — contagem (blobs) — `inspect.blobs`

Conta manchas/furos/componentes na área "Inspect · contagem": desfoque 5×5, limiar Otsu, fixo ou adaptativo (luz irregular), componentes conexos 8, faixa de área. OK com a contagem dentro da faixa.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Contar o que é (`polaridade`) | enum | escuro | escuro, claro |
| Limiar (`limiar`) | enum | Otsu | Otsu, fixo, adaptativo |
| Limiar fixo (0–255) (`valor`) | int | 128 | 0 – 255 |
| Bloco do adaptativo (px) (`bloco`) | int | 31 | 3 – 151 |
| Área mínima (px) (`area_min`) | int | 30 | 1 – 1000000 |
| Área máxima (px) (`area_max`) | int | 100000 | 1 – 10000000 |
| Contagem mínima (`cont_min`) | int | 1 | 0 – 10000 |
| Contagem máxima (`cont_max`) | int | 10 | 0 – 10000 |
| Rodar a cada (ms) (`intervalo`) | int | 300 | 50 – 5000 |
| Largura de análise (px) (`largura`) | int | 1280 | 320 – 1920 |
| Faixa de incerteza (fração do limite) (`faixa`) | float | 0.05 | 0 – 0.5 |
| Desenhar no vídeo (`desenhar`) | bool | True |  |

#### Inspeção — paquímetro (mm) — `inspect.paquimetro`

Mede a distância entre a primeira e a última borda ao longo de uma linha/régua "Inspect · paquímetro": perfil médio numa faixa de largura, gradiente, refino sub-pixel no pico; mm pela calibração da régua. OK dentro de nominal ± tolerância.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Nominal (mm) (`nominal`) | float | 50 | 0.01 – 10000 |
| Tolerância ± (mm) (`tol`) | float | 0.5 | 0.001 – 1000 |
| Largura do perfil (px) (`largura_perfil`) | int | 9 | 1 – 101 |
| Contraste mínimo da borda (`contraste`) | float | 20 | 1 – 255 |
| Rodar a cada (ms) (`intervalo`) | int | 300 | 50 – 5000 |
| Largura de análise (px) (`largura`) | int | 1280 | 320 – 1920 |
| Faixa de incerteza (fração do limite) (`faixa`) | float | 0.05 | 0 – 0.5 |
| Desenhar no vídeo (`desenhar`) | bool | True |  |

#### Inspeção — cor (ΔE2000) — `inspect.cor`

Compara a cor mediana (Lab) da área "Inspect · cor" com a referência pela fórmula CIEDE2000. Sem referência digitada, aprende a primeira leitura (peça boa na frente). OK com ΔE00 ≤ máximo.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Referência "L a b" (vazio = aprender) (`ref`) | text |  |  |
| ΔE00 máximo (`max_de`) | float | 3 | 0.1 – 50 |
| Reaprender a referência (alterne) (`reaprender`) | bool | False |  |
| Rodar a cada (ms) (`intervalo`) | int | 300 | 50 – 5000 |
| Largura de análise (px) (`largura`) | int | 1280 | 320 – 1920 |
| Faixa de incerteza (fração do limite) (`faixa`) | float | 0.05 | 0 – 0.5 |
| Desenhar no vídeo (`desenhar`) | bool | True |  |

#### Inspeção — forma do objeto — `inspect.forma`

Segmenta o objeto da área "Inspect · forma" (Otsu, polaridade pela borda, abertura/fechamento, furos tapados) e mede o maior contorno: Ø equivalente e área em mm (com a régua), circularidade 4πA/P², solidez A/A_casco (mordida, trinca, falta de material) e alongamento (menor retângulo girado). Zero = critério desligado.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Objeto (`polaridade`) | enum | auto | auto, escuro, claro |
| Área mínima (px) (`area_min_px`) | int | 500 | 1 – 10000000 |
| Ø equivalente nominal (mm; 0 = não) (`diam_nom`) | float | 0 | 0 – 10000 |
| Ø tolerância ± (mm) (`diam_tol`) | float | 1 | 0 – 1000 |
| Circularidade mínima (0 = não) (`circ_min`) | float | 0 | 0 – 1 |
| Solidez mínima (0 = não) (`solidez_min`) | float | 0.95 | 0 – 1 |
| Alongamento mínimo (0 = não) (`aspecto_min`) | float | 0 | 0 – 100 |
| Alongamento máximo (0 = não) (`aspecto_max`) | float | 0 | 0 – 100 |
| Rodar a cada (ms) (`intervalo`) | int | 300 | 50 – 5000 |
| Largura de análise (px) (`largura`) | int | 1280 | 320 – 1920 |
| Faixa de incerteza (fração do limite) (`faixa`) | float | 0.05 | 0 – 0.5 |
| Desenhar no vídeo (`desenhar`) | bool | True |  |

#### Inspeção — área de defeito (HSV) — `inspect.defeito_area`

Mede a área de defeito por cor (faixas HSV do OpenCV) DENTRO do objeto da área "Inspect · área de defeito": queimado, ferrugem, mofo, corpo estranho azul ou metálico, ou uma faixa sua. % da área do objeto e número de manchas; OK abaixo dos limites.

| Parâmetro | Tipo | Padrão | Faixa / opções |
|---|---|---|---|
| Defeito (`defeito`) | enum | queimado | queimado, ferrugem, mofo, corpo estranho azul, metal, personalizada |
| Faixa personalizada "h0-h1, s0-s1, v0-v1" (`hsv`) | text | 0-179, 0-255, 0-55 |  |
| Só dentro do objeto (`dentro_objeto`) | bool | True |  |
| Área máxima (%) (`max_pct`) | float | 2 | 0 – 100 |
| Mancha mínima (px) (`mancha_min`) | int | 20 | 1 – 100000 |
| Máximo de manchas (−1 = sem limite) (`max_manchas`) | int | -1 | -1 – 1000 |
| Rodar a cada (ms) (`intervalo`) | int | 300 | 50 – 5000 |
| Largura de análise (px) (`largura`) | int | 1280 | 320 – 1920 |
| Faixa de incerteza (fração do limite) (`faixa`) | float | 0.05 | 0 – 0.5 |
| Desenhar no vídeo (`desenhar`) | bool | True |  |

## Modelos

| ID | Modelo | Tarefa | Entrada | Tamanho | Licença | Origem |
|---|---|---|---|---|---|---|
| `birefnet-lite` | BiRefNet lite 512 — recorte de fundo, w8 | matting | 1×3×512×512 | 50.6 MB | MIT | ZhengPeng7/BiRefNet_lite, reexportado em 512×512 |
| `clip-blt-text` | MobileCLIP-BLT — texto (classes do YOLOE) | clip-text | 1×77 | 127.1 MB | Apple ML MobileCLIP | ultralytics mobileclip_blt.ts |
| `crnn` | CRNN (reconhecimento) | text_recognition | 1×1×32×100 | 33.8 MB | Apache-2.0 | OpenCV Zoo |
| `depth-anything` | Depth Anything V2 small — profundidade relativa | depth | 1×3×518×518 | 27.3 MB | Apache-2.0 | onnx-community/depth-anything-v2-small |
| `florence2` | Florence-2 base — legenda, objetos, OCR e grounding | vlm | 1×3×768×768 | 230.1 MB | MIT | microsoft/Florence-2-base-ft · onnx-community/Florence-2-base-ft (visão/embed int8, texto q4) |
| `mclip2-text` | MobileCLIP2-S0 — texto | clip-text | 1×77 | 64.3 MB | Apple ML MobileCLIP | felixhrdyn/mobileclip2-s0-onnx |
| `mclip2-visual` | MobileCLIP2-S0 — imagem | clip | 1×3×256×256 | 46.6 MB | Apple ML MobileCLIP | RuteNL/MobileCLIP2-S0-OpenCLIP-ONNX |
| `mobilenetv2` | MobileNetV2 | classification | 1×3×224×224 | 14.0 MB | Apache-2.0 | OpenCV Zoo |
| `mobilesam-dec` | MobileSAM — decodificador de máscara | sam | 1×256×64×64 | 16.5 MB | Apache-2.0 | ChaoningZhang/MobileSAM |
| `mobilesam-enc` | MobileSAM — codificador de imagem (TinyViT) | sam | 1×3×1024×1024 | 28.0 MB | Apache-2.0 | ChaoningZhang/MobileSAM |
| `mp-malha` | MediaPipe Face Landmarker (478 pontos com íris) | face_landmarks | 1×256×256×3 | 4.9 MB | Apache-2.0 | Google MediaPipe · senty-au/face_landmarks_detector-ONNX |
| `mp-mao` | MediaPipe Hand Landmarks (21 pontos) | hand_landmarks | 1×224×224×3 | 4.1 MB | Apache-2.0 | OpenCV Zoo · opencv/handpose_estimation_mediapipe |
| `mp-palma` | MediaPipe Palm Detection (palma) | palm_detection | 1×192×192×3 | 3.9 MB | Apache-2.0 | OpenCV Zoo · opencv/palm_detection_mediapipe |
| `ocr5-det` | PP-OCRv5 mobile — detecção de texto | text_detection | 1×3×960×960 | 4.8 MB | Apache-2.0 | PaddlePaddle/PP-OCRv5_mobile_det_onnx |
| `ocr5-latin` | PP-OCRv5 mobile — reconhecedor latino (836 caracteres, com acentos) | text_recognition | 1×3×48×320 | 8.0 MB | Apache-2.0 | PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx |
| `pose` | MediaPipe Pose | pose | 1×256×256×3 | 5.6 MB | Apache-2.0 | OpenCV Zoo |
| `pphumanseg` | PP-HumanSeg | segmentation | 1×3×192×192 | 6.2 MB | Apache-2.0 | OpenCV Zoo |
| `ppocr_det` | PP-OCRv3 (detecção) | text_detection | 1×3×736×736 | 2.4 MB | Apache-2.0 | OpenCV Zoo |
| `reid-youtu` | Youtu ReID — embedding de pessoa (768-d), w8 | reid | 1×3×256×128 | 27.2 MB | Apache-2.0 | OpenCV Zoo person_reid_youtureid (2021nov), convertido para w8 |
| `relate` | RelateAnything ViT-S+/16 (relações) | relations | 1×3×448×448 | 104.7 MB | Apache-2.0 (código) · pesos derivados de DINOv3 | maelic/relsgg-vits16plus |
| `rfdetr-nano` | RF-DETR nano — Detecção COCO (384²) | detection | 1×3×384×384 | 38.8 MB | Apache-2.0 | roboflow/rf-detr (rfdetr 1.11.2, rf-detr-nano.pth) |
| `rfdetr-small` | RF-DETR small — Detecção COCO (512²) | detection | 1×3×512×512 | 41.4 MB | Apache-2.0 | roboflow/rf-detr (rfdetr 1.11.2, rf-detr-small.pth) |
| `rtmo-s` | RTMO-s — pose multi-pessoa (17 pontos COCO), w16 | pose | 1×3×640×640 | 19.9 MB | Apache-2.0 (MMPose; treinado no Body7) | download.openmmlab.com rtmo-s_8xb32-600e_body7-640x640 (onnx_sdk), convertido para w16 |
| `sam2-dec` | SAM 2.1 tiny — prompt + decodificador de máscara | sam | 1×256×64×64 | 9.0 MB | Apache-2.0 | facebook/sam2.1-hiera-tiny · onnx-community/sam2.1-hiera-tiny-ONNX |
| `sam2-enc` | SAM 2.1 tiny — codificador de imagem (Hiera) | sam | 1×3×1024×1024 | 54.2 MB | Apache-2.0 | facebook/sam2.1-hiera-tiny · onnx-community/sam2.1-hiera-tiny-ONNX |
| `sface` | SFace (embedding facial) | face_recognition | 1×3×112×112 | 38.7 MB | Apache-2.0 | OpenCV Zoo |
| `yolo26n` | YOLO26n — Detecção | detection | 1×3×640×640 | 9.9 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-cls` | YOLO26n — Classificação | classification | 1×3×224×224 | 11.3 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-depth` | YOLO26n — Profundidade | depth | 1×3×768×768 | 20.8 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-obb` | YOLO26n — Caixas orientadas | obb | 1×3×1024×1024 | 10.2 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-pose` | YOLO26n — Pose | pose | 1×3×640×640 | 12.1 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-reid` | YOLO26n — Re-identificação | reid | 1×3×448×448 | 9.9 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-seg` | YOLO26n — Segmentação de instâncias | instance_segmentation | 1×3×640×640 | 11.2 MB | AGPL-3.0 | Ultralytics |
| `yolo26n-sem` | YOLO26n — Segmentação semântica | semantic_segmentation | 1×3×1024×1024 | 6.3 MB | AGPL-3.0 | Ultralytics |
| `yoloe-pf` | YOLOE-11s prompt-free — 4.585 classes | detect | 1×3×640×640 | 24.0 MB | AGPL-3.0 | Ultralytics |
| `yoloe-text` | YOLOE-11s text-prompt — classes por texto | detect | 1×3×640×640 | 24.0 MB | AGPL-3.0 | Ultralytics |
| `yolox` | YOLOX-S | detection | 1×3×640×640 | 35.9 MB | Apache-2.0 | OpenCV Zoo |
| `yunet` | YuNet (detecção de face) | face_detection | 1×3×640×640 | 0.2 MB | MIT | OpenCV Zoo |
