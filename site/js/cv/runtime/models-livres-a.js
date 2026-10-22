/**
 * Modelos livres — grupo A (ver o comentário em onnx.js).
 *
 * Todos os pesos foram baixados direto na VPS e verificados com onnxruntime
 * (formas lidas do grafo, pré e pós-processo conferidos com imagens reais).
 * Onde o original era grande demais para o navegador, a conversão está
 * descrita no próprio item:
 *
 *   "w16"  = pesos guardados em fp16 com um Cast para fp32 logo depois de
 *            cada inicializador. Metade do download, cálculo inteiro em fp32
 *            — o WASM não tem kernels fp16 e um modelo fp16 "de verdade" cai
 *            em casts implícitos ou simplesmente não carrega.
 *   "w8"   = pesos int8 por canal (simétrico) + DequantizeLinear → cálculo
 *            em fp32. Um quarto do download. A quantização dinâmica do
 *            onnxruntime (ConvInteger) NÃO serve: o onnxruntime-web não tem
 *            ConvInteger e a sessão nem abre ("Could not find an
 *            implementation for ConvInteger(10)").
 */
export default {
  // ---- CV-17 · OCR PT-BR: PP-OCRv5 mobile (detector DB + reconhecedor latino)
  'ocr5-det': {
    file: 'models/livres/a/ocr/ppocrv5_mobile_det.onnx', bytes: 4826518,
    name: 'PP-OCRv5 mobile — detecção de texto', task: 'text_detection',
    license: 'Apache-2.0', source: 'PaddlePaddle/PP-OCRv5_mobile_det_onnx',
    // entrada DINÂMICA [1,3,H,W] com H e W múltiplos de 32; o input abaixo é
    // só o tamanho nominal. Saída [1,1,H,W] = probabilidade de texto (DB).
    input: [1, 3, 960, 960], layout: 'nchw',
    // PaddleOCR lê a imagem em BGR e aplica a média ImageNet NESSA ordem
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255, bgr: true,
    stride: 32,
  },
  'ocr5-latin': {
    file: 'models/livres/a/ocr/latin_ppocrv5_mobile_rec.onnx', bytes: 8042023,
    name: 'PP-OCRv5 mobile — reconhecedor latino (836 caracteres, com acentos)', task: 'text_recognition',
    license: 'Apache-2.0', source: 'PaddlePaddle/latin_PP-OCRv5_mobile_rec_onnx',
    // [1,3,48,W] com W livre; saída [1,T,838] JÁ em softmax:
    // 0 = blank, 1..836 = dicionário, 837 = espaço
    input: [1, 3, 48, 320], layout: 'nchw',
    mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], scale: 1 / 255, bgr: true,
    dict: 'models/livres/a/ocr/latin_dict.json',
  },
  // ---- CV-18 · RTMO-s (MMPose): pose multi-pessoa em um estágio, 17 pontos COCO
  'rtmo-s': {
    file: 'models/livres/a/rtmo/rtmo-s_body7_640_w16.onnx', bytes: 19892289,
    name: 'RTMO-s — pose multi-pessoa (17 pontos COCO), w16', task: 'pose',
    license: 'Apache-2.0 (MMPose; treinado no Body7)',
    source: 'download.openmmlab.com rtmo-s_8xb32-600e_body7-640x640 (onnx_sdk), convertido para w16',
    // BGR cru 0..255, letterbox com 114. Saídas já com NMS dentro do grafo:
    // dets [1,N,5] = x1,y1,x2,y2,score e keypoints [1,N,17,3] = x,y,score (px do input)
    input: [1, 3, 640, 640], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1, bgr: true,
    keypoints: 17,
  },
  // ---- CV-19 · Re-ID de pessoas (Tencent Youtu, via OpenCV Zoo), w8
  'reid-youtu': {
    file: 'models/livres/a/reid/person_reid_youtu_2021nov_w8.onnx', bytes: 27228712,
    name: 'Youtu ReID — embedding de pessoa (768-d), w8', task: 'reid',
    license: 'Apache-2.0', source: 'OpenCV Zoo person_reid_youtureid (2021nov), convertido para w8',
    // recorte da pessoa esticado para 128×256 (L×A), RGB, ImageNet; lote dinâmico.
    // Saída [N,768,1,1], sem normalizar — o operador faz L2.
    input: [1, 3, 256, 128], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
    embedding: 768,
    // medido no ReID_extra_testdata (Market-1501): mesma pessoa ≥ 0,66,
    // pessoas diferentes ≤ 0,48 de cosseno (w8: 0,9998 de cosseno contra o fp32)
    cosineThreshold: 0.55,
  },
  // ---- CV-20 · BiRefNet lite (MIT): recorte de fundo / matting
  'birefnet-lite': {
    file: 'models/livres/a/birefnet/birefnet_lite_512_w8.onnx', bytes: 50629199,
    name: 'BiRefNet lite 512 — recorte de fundo, w8', task: 'matting',
    license: 'MIT', source: 'ZhengPeng7/BiRefNet_lite, reexportado em 512×512',
    /*
     * O ONNX publicado (onnx-community) é FIXO em 1024² — o grafo tem Splits
     * com 1024 cravado — e a 1024² custa ~17 s por imagem em 4 núcleos de CPU
     * e mais de 4 GB de RAM, o que estoura o WASM. Reexportado do PyTorch em
     * 512² (deform_conv2d reescrito com GridSample): ~1,5 s na mesma CPU,
     * IoU 0,89-0,97 contra o 1024 nas imagens de teste. Pesos em w8: IoU
     * 0,998 contra o fp32 e o mesmo tempo no WASM (~1,4 s no Chrome, M-series).
     * Saída [1,1,512,512] em LOGITS (sigmóide no operador).
     */
    input: [1, 3, 512, 512], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
  },
};
