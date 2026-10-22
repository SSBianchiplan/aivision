/**
 * Modelos livres — grupo B (ver o comentário em onnx.js).
 *
 *   CV-21 Florence-2 base (MIT)           — transformers.js num worker, NÃO pelo loadModel
 *   CV-22 SAM 2.1 tiny (Apache-2.0)       — codificador + decodificador por prompt, int8
 *   CV-23 RF-DETR nano/small (Apache-2.0) — detector COCO, alternativa livre ao YOLO26
 *
 * Todos os pesos moram em models/livres/b/ no próprio site. Formas e
 * decodificação foram conferidas com onnxruntime em fotos do COCO val2017
 * antes de fixar aqui — ver os comentários de cada entrada.
 */
import { FLORENCE_FILES, loadFlorence } from './livres-b/florence.js';

const FL = 'models/livres/b/florence2/';
const somaFlorence = Object.values(FLORENCE_FILES).reduce((a, b) => a + b, 0);   // 230.093.241

export default {
  // ---- CV-21 · Florence-2 base-ft (Microsoft, MIT). Entrada informativa:
  // quem carrega é o worker do transformers.js (runtime/livres-b/florence.js).
  // `loader` é o gancho que o loadModel do onnx.js pode chamar para o botão
  // "Pré-carregar" do painel funcionar; sem ele, o painel tentaria abrir
  // `file` no ORT do vendor/ort, que não é o caminho deste modelo.
  'florence2': {
    file: FL + 'onnx/vision_encoder_quantized.onnx',
    files: Object.keys(FLORENCE_FILES).map((f) => FL + f),
    bytes: somaFlorence,
    name: 'Florence-2 base — legenda, objetos, OCR e grounding',
    task: 'vlm',
    license: 'MIT',
    source: 'microsoft/Florence-2-base-ft · onnx-community/Florence-2-base-ft (visão/embed int8, texto q4)',
    runtime: 'transformers.js',
    loader: (onProgress) => loadFlorence(onProgress),
    input: [1, 3, 768, 768], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
  },

  // ---- CV-22 · SAM 2.1 hiera-tiny (Meta, Apache-2.0).
  // Codificador: requantizado aqui a partir do fp32 do onnx-community, int8
  // dinâmico SÓ nas MatMul — o _int8 publicado lá usa ConvInteger, que o
  // ORT-web não implementa ("Could not find an implementation for ConvInteger").
  // Entrada esticada para 1024² (sem letterbox: o Sam2Processor redimensiona
  // direto), ImageNet em 0..1. Saídas: image_embeddings.0 [1,32,256,256],
  // .1 [1,64,128,128], .2 [1,256,64,64]. vs fp32: IoU das máscaras ≥ 0,989.
  'sam2-enc': {
    file: 'models/livres/b/sam2/onnx/vision_encoder_mm8.onnx',
    bytes: 54213326,
    name: 'SAM 2.1 tiny — codificador de imagem (Hiera)', task: 'sam', license: 'Apache-2.0',
    source: 'facebook/sam2.1-hiera-tiny · onnx-community/sam2.1-hiera-tiny-ONNX',
    input: [1, 3, 1024, 1024], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
  },
  // Prompt em coordenadas do quadrado 1024². input_points [1,1,n,2] float,
  // input_labels [1,1,n] INT64 (1 pos., 0 neg., -10 = vazio), input_boxes
  // [1,nb,4] (x1,y1,x2,y2; nb pode ser 0). Saídas: iou_scores [1,k,3],
  // pred_masks [1,k,3,256,256] (logits cobrindo o quadro inteiro),
  // object_score_logits [1,k,1] (> 0 = objeto presente).
  'sam2-dec': {
    file: 'models/livres/b/sam2/onnx/prompt_encoder_mask_decoder_int8.onnx',
    files: ['models/livres/b/sam2/onnx/prompt_encoder_mask_decoder_int8.onnx',
            'models/livres/b/sam2/onnx/prompt_encoder_mask_decoder_int8.onnx_data'],
    bytes: 8951901,
    name: 'SAM 2.1 tiny — prompt + decodificador de máscara', task: 'sam', license: 'Apache-2.0',
    source: 'facebook/sam2.1-hiera-tiny · onnx-community/sam2.1-hiera-tiny-ONNX',
    input: [1, 256, 64, 64], layout: 'nchw',
  },

  // ---- CV-23 · RF-DETR (Roboflow, Apache-2.0), COCO. Exportado com o pacote
  // rfdetr 1.11.2 e quantizado int8 dinâmico SÓ nas MatMul (o ORT-web não tem ConvInteger) —
  // mesmas classes e scores ±0,05 do fp32 nas fotos de teste.
  // Entrada esticada (sem letterbox), ImageNet em 0..1. Saídas: dets [1,300,4]
  // cx,cy,w,h NORMALIZADOS; labels [1,300,91] logits (sigmoid), índice = id
  // de categoria COCO de 91 (1 = pessoa, 17 = gato, 75 = controle…), não 0..79.
  'rfdetr-nano': {
    file: 'models/livres/b/rfdetr/rfdetr-nano-int8.onnx',
    bytes: 38797176,
    name: 'RF-DETR nano — Detecção COCO (384²)', task: 'detection', license: 'Apache-2.0',
    source: 'roboflow/rf-detr (rfdetr 1.11.2, rf-detr-nano.pth)',
    input: [1, 3, 384, 384], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
    queries: 300, classes: 91,
  },
  'rfdetr-small': {
    file: 'models/livres/b/rfdetr/rfdetr-small-int8.onnx',
    bytes: 41375758,
    name: 'RF-DETR small — Detecção COCO (512²)', task: 'detection', license: 'Apache-2.0',
    source: 'roboflow/rf-detr (rfdetr 1.11.2, rf-detr-small.pth)',
    input: [1, 3, 512, 512], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
    queries: 300, classes: 91,
  },
};
