/**
 * cv/runtime/onnx.js — carga e execução de modelos ONNX no browser.
 *
 * Contraparte no cliente de backend/app/cv/runtimes/onnx.py (SPEC ADR-5).
 * Mesmo papel: esconder o runtime atrás de uma interface estreita, para o
 * operador não saber se rodou em WebGPU, WASM ou (depois) no worker.
 *
 * Três decisões que importam:
 *
 * 1. CARGA PREGUIÇOSA. O ort.min.js (446 KB) e os pesos (94 MB no total) só
 *    baixam quando alguém usa o primeiro modelo. Quem só quer Canny não paga.
 *
 * 2. WEBGPU COM FALLBACK, DE VERDADE. Até out/2026 o vendor tinha só o
 *    ort.min.js, que registra cpu/wasm/webgl: o pedido de 'webgpu' falhava com
 *    "[webgpu] backend not found" e TODOS os modelos rodavam em WASM, em
 *    silêncio. Agora: se o navegador entrega um adaptador WebGPU real
 *    (navigator.gpu sozinho não basta — vários Android/Windows expõem a API e
 *    devolvem adaptador null), carrega o ort.webgpu.min.js (mesma 1.20.1, usa a
 *    ort-wasm-simd-threaded.jsep.wasm, que serve também ao EP wasm). Sem
 *    adaptador, segue o caminho antigo, só wasm. Modelos quantizados (int8/q8)
 *    ficam em wasm: só vai ao WebGPU quem está em EP_WEBGPU. Se a sessão webgpu falhar ao
 *    criar ou na primeira execução, o modelo cai para wasm sozinho e o EP real
 *    aparece em modelStates().
 *
 * 3. INFERÊNCIA NUNCA BLOQUEIA O RENDER. Quem chama recebe o último resultado
 *    conhecido na hora e a inferência acontece por fora. Ver operators/models.js.
 *
 * 4. FILA COM PRIORIDADE. Todas as sessões dividem um único worker (proxy do
 *    ORT), então a execução é serial — mas modelos rápidos (pose, rosto) passam
 *    na frente dos lentos (profundidade, SAM). Ver "FILA COM DUAS PRIORIDADES".
 */

const ORT_DIR = 'vendor/ort/';

let ortPromise = null;
let ortEnvReady = false;
let ortComGPU = false;        // o bundle carregado tem o backend webgpu?
let gpuPromise = null;

/*
 * Preferência de EP para diagnóstico, gravada no navegador:
 *   localStorage['iav.ort.ep'] = 'wasm'  → nunca tenta WebGPU (nem baixa o bundle)
 *   localStorage['iav.ort.ep'] = 'webgpu' → ignora EP_WEBGPU (tenta webgpu em todos)
 * Sem a chave (padrão): automático.
 */
function preferenciaEp() {
  try { return localStorage.getItem('iav.ort.ep') || 'auto'; } catch (_) { return 'auto'; }
}

/**
 * Há um adaptador WebGPU utilizável? Resolve uma vez só.
 * `navigator.gpu` existir não garante nada: requestAdapter() devolve null em
 * GPU na lista negra, em VM e em vários Android. Esse é o teste que vale.
 */
export function temWebGPU() {
  if (!gpuPromise) {
    gpuPromise = (async () => {
      if (preferenciaEp() === 'wasm') return false;
      if (typeof navigator === 'undefined' || !navigator.gpu) return false;
      try {
        const a = await navigator.gpu.requestAdapter();
        return Boolean(a);
      } catch (_) {
        return false;
      }
    })();
  }
  return gpuPromise;
}

/** Injeta o bundle do ORT uma única vez e configura o ambiente. */
export function ensureOrt() {
  if (ortPromise) return ortPromise;
  ortPromise = temWebGPU().then((gpu) => new Promise((resolve, reject) => {
    if (window.ort) {
      // outro trecho já injetou um ORT: só tem webgpu se o bundle registrou
      ortComGPU = gpu && Boolean(window.ort.env && window.ort.env.webgpu);
      return resolve(window.ort);
    }
    /*
     * ort.webgpu.min.js (334 KB) traz os EPs webgpu E wasm, sobre a
     * jsep.wasm (21,7 MB, 4,8 MB comprimida). O ort.min.js (446 KB) usa a
     * wasm comum (11,2 MB) e serve a quem não tem GPU — não muda nada para
     * esses aparelhos.
     */
    const arq = gpu ? 'ort.webgpu.min.js' : 'ort.min.js';
    const s = document.createElement('script');
    s.src = ORT_DIR + arq;
    s.async = true;
    s.onload = () => {
      if (!window.ort) return reject(new Error(arq + ' carregou mas não expôs window.ort'));
      ortComGPU = gpu;
      resolve(window.ort);
    };
    s.onerror = () => reject(new Error('Falha ao carregar ' + ORT_DIR + arq));
    document.head.appendChild(s);
  })).then((ort) => {
    if (!ortEnvReady) {
      /*
       * wasmPaths TEM que ser URL absoluta.
       *
       * O ORT 1.20 carrega o glue do WASM com import() dinâmico, e
       * 'vendor/ort/' não é um module specifier válido — specifier tem que
       * começar com ./ , / ou ser URL absoluta. Com o caminho relativo o
       * erro que aparece é "no available backend found. ERR: [wasm]
       * TypeError: Failed to resolve module specifier
       * 'vendor/ort/ort-wasm-simd-threaded.mjs'", que não diz nada sobre a
       * causa real. Resolver contra o baseURI mata o problema.
       */
      ort.env.wasm.wasmPaths = new URL(ORT_DIR, document.baseURI).href;
      // threads só existem sob cross-origin isolation; serve.py manda COOP/COEP
      const isolated = self.crossOriginIsolated === true;
      ort.env.wasm.numThreads = isolated
        ? Math.min(4, navigator.hardwareConcurrency || 2)
        : 1;
      ort.env.wasm.simd = true;

      /*
       * ================= O QUE CONSERTA O FPS =================
       *
       * O backend WASM roda SÍNCRONO NA THREAD PRINCIPAL. `await session.run()`
       * parece assíncrono, mas a promessa só resolve depois que o WASM terminou
       * — e enquanto ele calcula, o event loop está parado. Uma inferência de
       * 500 ms trava o requestAnimationFrame por 500 ms inteiros. Resultado
       * observado: 2 fps com um único operador de modelo ativo.
       *
       * `proxy = true` move a sessão para um Web Worker. A thread principal
       * fica livre para desenhar, e o vídeo segue em 30-60 fps enquanto a
       * inferência corre por fora — que é a arquitetura que operators/models.js
       * já assumia, mas que não se realizava por causa disto.
       *
       * Custo: os tensores são copiados para o worker. Para entradas de
       * 640×640×3 float32 (4,9 MB) a cópia é da ordem de 1-2 ms, contra as
       * centenas de ms que se ganha.
       * ========================================================
       */
      ort.env.wasm.proxy = true;

      ort.env.logLevel = 'error';
      ortEnvReady = true;
    }
    return ort;
  });
  return ortPromise;
}

/**
 * A API existe no navegador (não garante adaptador). Para a decisão real use
 * temWebGPU(); depois que o ORT carregou, `ortTemWebGPU()` diz o que valeu.
 */
export function supportsWebGPU() {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function ortTemWebGPU() {
  return ortComGPU;
}

export function isIsolated() {
  return self.crossOriginIsolated === true;
}

// ---------------------------------------------------------------- catálogo

/**
 * Catálogo de modelos. `input` e `layout` foram VERIFICADOS carregando cada
 * arquivo no OpenCV e inspecionando as formas reais — não vieram da
 * documentação, que diverge em alguns casos (o pose do MediaPipe é NHWC).
 */
export const MODELS = {
  'mobilenetv2': {
    file: 'models/mobilenetv2.onnx',
    bytes: 13964571,
    name: 'MobileNetV2',
    task: 'classification',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 3, 224, 224],
    layout: 'nchw',
    // normalização ImageNet
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    scale: 1 / 255,
  },
  'yolox': {
    file: 'models/yolox.onnx',
    bytes: 35858002,
    name: 'YOLOX-S',
    task: 'detection',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 3, 640, 640],
    layout: 'nchw',
    // YOLOX do zoo consome BGR cru em 0..255, sem normalizar
    mean: [0, 0, 0],
    std: [1, 1, 1],
    scale: 1,
    bgr: true,
    strides: [8, 16, 32],
  },
  'pphumanseg': {
    file: 'models/pphumanseg.onnx',
    bytes: 6163938,
    name: 'PP-HumanSeg',
    task: 'segmentation',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 3, 192, 192],
    layout: 'nchw',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    scale: 1 / 255,
  },
  'pose': {
    file: 'models/pose.onnx',
    bytes: 5557238,
    name: 'MediaPipe Pose',
    task: 'pose',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 256, 256, 3],
    layout: 'nhwc',            // verificado: este é NHWC, não NCHW
    mean: [0, 0, 0],
    std: [1, 1, 1],
    scale: 1 / 255,
    landmarks: 39,
    stride: 5,                 // x, y, z, visibility, presence
  },
  'ppocr_det': {
    file: 'models/ppocr_det.onnx',
    bytes: 2423490,
    name: 'PP-OCRv3 (detecção)',
    task: 'text_detection',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 3, 736, 736],
    layout: 'nchw',
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    scale: 1 / 255,
  },
  'yunet': {
    file: 'models/yunet.onnx',
    bytes: 232589,
    name: 'YuNet (detecção de face)',
    task: 'face_detection',
    license: 'MIT',
    source: 'OpenCV Zoo',
    /*
     * ENTRADA FIXA em 640×640 — lida do grafo com onnxruntime.
     *
     * Uma verificação anterior via cv2.dnn sugeriu que a entrada era
     * dinâmica, porque o OpenCV RESHAPE modelos de shape fixo por conta
     * própria. O ONNX Runtime não faz isso: passar 256×320 dá
     * "Got invalid dimensions for input... Expected: 640".
     * Regra: shape de modelo se lê do grafo, não se descobre por tentativa
     * num runtime que é permissivo.
     *
     * Com 640: grade 80²=6400 (stride 8), 40²=1600 (16), 20²=400 (32),
     * que é exatamente o tamanho das saídas cls_8/cls_16/cls_32.
     */
    input: [1, 3, 640, 640],
    layout: 'nchw',
    mean: [0, 0, 0],
    std: [1, 1, 1],
    scale: 1,
    strides: [8, 16, 32],
  },
  'sface': {
    file: 'models/sface.onnx',
    bytes: 38696353,
    name: 'SFace (embedding facial)',
    task: 'face_recognition',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 3, 112, 112],
    layout: 'nchw',
    mean: [0, 0, 0],
    std: [1, 1, 1],
    scale: 1,
    embedding: 128,
    // limiar de cosseno documentado pelo OpenCV para o SFace
    cosineThreshold: 0.363,
  },
  'crnn': {
    file: 'models/crnn.onnx',
    bytes: 33823087,
    name: 'CRNN (reconhecimento)',
    task: 'text_recognition',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo',
    input: [1, 1, 32, 100],
    layout: 'nchw',
    gray: true,
    mean: [0.5],
    std: [0.5],
    scale: 1 / 255,
  },
  relate: {
    // RelateAnything (Maëlic Neau, arXiv:2609.12552): cabeça de relações sobre
    // DINOv3 ViT-S/16+. Não detecta: recebe as boxes de um detector e diz como
    // os objetos se relacionam, contra um vocabulário de predicados em texto.
    // Pesos fp16 em dados externos (.data0/.data1), os mesmos de /relacoes/.
    file: 'relacoes/models/relateanything_vits16plus_w16.onnx',
    files: ['relacoes/models/relateanything_vits16plus_w16.onnx',
            'relacoes/models/relateanything_vits16plus_w16.data0',
            'relacoes/models/relateanything_vits16plus_w16.data1'],
    bytes: 104730631,
    name: 'RelateAnything ViT-S+/16 (relações)',
    task: 'relations',
    license: 'Apache-2.0 (código) · pesos derivados de DINOv3',
    source: 'maelic/relsgg-vits16plus',
    input: [1, 3, 448, 448], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    bank: 'models/relate_bank.json',
    maxBoxes: 32,
  },
  // ---- CV-13 · MobileSAM (Apache-2.0): codificador TinyViT + decodificador por prompt
  'mobilesam-enc': {
    file: 'models/mobile_sam_encoder.onnx', bytes: 28016162,
    name: 'MobileSAM — codificador de imagem (TinyViT)', task: 'sam', license: 'Apache-2.0', source: 'ChaoningZhang/MobileSAM',
    input: [1, 3, 1024, 1024], layout: 'nchw',
    mean: [123.675, 116.28, 103.53], std: [58.395, 57.12, 57.375], scale: 1,
  },
  'mobilesam-dec': {
    file: 'models/mobile_sam_decoder.onnx', bytes: 16500644,
    name: 'MobileSAM — decodificador de máscara', task: 'sam', license: 'Apache-2.0', source: 'ChaoningZhang/MobileSAM',
    input: [1, 256, 64, 64], layout: 'nchw',
  },
  // ---- CV-14 · Depth Anything V2 small (Apache-2.0), int8
  'depth-anything': {
    file: 'models/depth_anything_v2_small_q8.onnx', bytes: 27258801,
    name: 'Depth Anything V2 small — profundidade relativa', task: 'depth', license: 'Apache-2.0', source: 'onnx-community/depth-anything-v2-small',
    input: [1, 3, 518, 518], layout: 'nchw',
    mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 1 / 255,
  },
  // ---- CV-15 · MobileCLIP2-S0 (Apple), int8: imagem e texto no mesmo espaço de 512-d
  'mclip2-visual': {
    // fp32 com dados externos: a versao int8 do encoder visual sai errada
    // (testado: cavalo -> "sala vazia"); o de texto int8 esta bom.
    file: 'models/mclip2/visual.onnx',
    files: ['models/mclip2/visual.onnx', 'models/mclip2/visual.onnx.data'],
    bytes: 46633052,
    name: 'MobileCLIP2-S0 — imagem', task: 'clip', license: 'Apple ML MobileCLIP', source: 'RuteNL/MobileCLIP2-S0-OpenCLIP-ONNX',
    input: [1, 3, 256, 256], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255, embedding: 512, logitScale: 64.33,
  },
  'mclip2-text': {
    file: 'models/mclip2_text_model_quantized.onnx', bytes: 64326073,
    name: 'MobileCLIP2-S0 — texto', task: 'clip-text', license: 'Apple ML MobileCLIP', source: 'felixhrdyn/mobileclip2-s0-onnx',
    input: [1, 77], embedding: 512,
  },
  // ---- CV-12 · texto do YOLOE (Apple MobileCLIP-BLT), pesos fp16 externos, os de /relacoes/
  'clip-blt-text': {
    file: 'relacoes/models/mobileclip_blt_text_w16.onnx',
    files: ['relacoes/models/mobileclip_blt_text_w16.onnx', 'relacoes/models/mobileclip_blt_text_w16.data0', 'relacoes/models/mobileclip_blt_text_w16.data1'],
    bytes: 127107310,
    name: 'MobileCLIP-BLT — texto (classes do YOLOE)', task: 'clip-text', license: 'Apple ML MobileCLIP', source: 'ultralytics mobileclip_blt.ts',
    input: [1, 77], embedding: 512,
  },
};

/*
 * Modelos livres (Apache-2.0 / MIT) adicionados em out/2026, um arquivo por grupo
 * para que cada frente evolua sem mexer neste catálogo:
 *   a = OCR PT-BR, pose RTMO, re-ID, recorte BiRefNet
 *   b = Florence-2, SAM 2, RF-DETR (COCO)
 *   c = modelos treinados livres (RF-DETR e PatchCore) — registrados em tempo de uso
 */
import LIVRES_A from './models-livres-a.js';
import LIVRES_B from './models-livres-b.js';
import LIVRES_C from './models-livres-c.js';
import LIVRES_D from './models-livres-d.js';   // d = mãos, malha do rosto e olhos
import LIVRES_E from './models-livres-e.js';   // e = bike fit (biomecânica)
import LIVRES_F from './models-livres-f.js';   // f = ergonomia RULA/REBA
import LIVRES_G from './models-livres-g.js';   // g = academia (repetições e forma)
import LIVRES_H from './models-livres-h.js';   // h = salto e corrida
import LIVRES_I from './models-livres-i.js';   // i = swing (golfe/raquete) e VBT
import LIVRES_J from './models-livres-j.js';   // j = esportes coletivos
import LIVRES_K from './models-livres-k.js';   // k = industrial (volumetria de correia: sem modelo)
import LIVRES_L from './models-livres-l.js';   // l = contagem em esteira (motor COR: sem modelo)
Object.assign(MODELS, LIVRES_A, LIVRES_B, LIVRES_C, LIVRES_D, LIVRES_E, LIVRES_F, LIVRES_G, LIVRES_H, LIVRES_I, LIVRES_J, LIVRES_K, LIVRES_L);
import LIVRES_N from './models-livres-n.js';   // n = inspeção visual (CV-40 Inspect: sem modelo na parte 1)
Object.assign(MODELS, LIVRES_N);

/**
 * =================== MODELOS AGPL-3.0, DESLIGADOS POR PADRÃO ===================
 *
 * YOLO26 é da Ultralytics, sob AGPL-3.0. Distribuir o sistema ou expô-lo na
 * rede com estes pesos ativos obriga a abrir TODO o código sob AGPL, ou a
 * comprar uma Enterprise License. Rodar localmente, só para você, não dispara.
 *
 * Por isso eles ficam atrás de `AGPL_GATE`: declarados, baixáveis sob aviso
 * explícito, e fora do caminho padrão. O YOLOX-S (Apache-2.0) segue sendo o
 * detector default.
 *
 * As formas abaixo foram lidas do grafo com onnxruntime, não deduzidas.
 * Saída do YOLO26 é END-TO-END: 300 detecções já decodificadas, ordenadas por
 * score e SEM NMS — o modelo faz a supressão internamente.
 * ==============================================================================
 */
export const AGPL_MODELS = {
  // ---- CV-12 · YOLOE (AGPL-3.0): detecção de vocabulário aberto, arquivos de /relacoes/
  'yoloe-pf': {
    file: 'relacoes/models/yoloe-11s-pf.onnx', bytes: 23983366,
    name: 'YOLOE-11s prompt-free — 4.585 classes', task: 'detect',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 640, 640], layout: 'nchw', mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    classes: 'relacoes/models/yoloe-11s-pf.classes.json', kind: 'boxes_conf_cls',
  },
  'yoloe-text': {
    file: 'relacoes/models/yoloe-11s-text.onnx', bytes: 23988211,
    name: 'YOLOE-11s text-prompt — classes por texto', task: 'detect',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 640, 640], layout: 'nchw', mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    bank: 'relacoes/assets/banks/yoloe-11s_classbank.json', kind: 'boxes_conf_cls', txtDim: 512,
  },
  'yolo26n': {
    file: 'models/yolo26/yolo26n.onnx',
    bytes: 9942036,
    name: 'YOLO26n — Detecção',
    task: 'detection',
    license: 'AGPL-3.0',
    source: 'Ultralytics',
    agpl: true,
    input: [1, 3, 640, 640],
    layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    // saída [1,300,6]: x1,y1,x2,y2,score,classe — em pixels do input
    stride: 6, endToEnd: true, classes: 80,
  },
  'yolo26n-seg': {
    file: 'models/yolo26/yolo26n-seg.onnx',
    bytes: 11219166,
    name: 'YOLO26n — Segmentação de instâncias',
    task: 'instance_segmentation',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 640, 640], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    // [1,300,38] = 6 + 32 coeficientes; protótipos [1,32,160,160]
    stride: 38, endToEnd: true, classes: 80, maskCoeffs: 32, protoSize: 160,
  },
  'yolo26n-pose': {
    file: 'models/yolo26/yolo26n-pose.onnx',
    bytes: 12126176,
    name: 'YOLO26n — Pose',
    task: 'pose',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 640, 640], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    // [1,300,57] = 6 + 17 keypoints * (x,y,conf)
    stride: 57, endToEnd: true, keypoints: 17,
  },
  'yolo26n-obb': {
    file: 'models/yolo26/yolo26n-obb.onnx',
    bytes: 10207638,
    name: 'YOLO26n — Caixas orientadas',
    task: 'obb',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 1024, 1024], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    // [1,300,7] = cx,cy,w,h,score,classe,angulo — 15 classes DOTAv1
    stride: 7, endToEnd: true, classes: 15,
  },
  'yolo26n-cls': {
    file: 'models/yolo26/yolo26n-cls.onnx',
    bytes: 11293167,
    name: 'YOLO26n — Classificação',
    task: 'classification',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 224, 224], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    classes: 1000,
  },
  'yolo26n-sem': {
    file: 'models/yolo26/yolo26n-sem.onnx',
    bytes: 6284626,
    name: 'YOLO26n — Segmentação semântica',
    task: 'semantic_segmentation',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 1024, 1024], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    // [1,1024,1024] com o índice da classe por pixel — 19 classes Cityscapes
    classes: 19,
  },
  'yolo26n-depth': {
    file: 'models/yolo26/yolo26n-depth.onnx',
    bytes: 20772235,
    name: 'YOLO26n — Profundidade',
    task: 'depth',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 768, 768], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
  },
  'yolo26n-reid': {
    file: 'models/yolo26/yolo26n-reid.onnx',
    bytes: 9873245,
    name: 'YOLO26n — Re-identificação',
    task: 'reid',
    license: 'AGPL-3.0', source: 'Ultralytics', agpl: true,
    input: [1, 3, 448, 448], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
    embedding: 512,
  },
};

const AGPL_KEY = 'gplansis.agpl.accepted';

/** O usuário aceitou explicitamente as obrigações da AGPL nesta instalação? */
export function agplAccepted() {
  try {
    // Instalação de protótipos na VPS: AGPL aceita por padrão (código-fonte em /codigo-fonte/).
    // Quem desligar no painel grava 'no' e a trava volta.
    return localStorage.getItem(AGPL_KEY) !== 'no';
  } catch (_) {
    return true;
  }
}

export function setAgplAccepted(v) {
  try {
    if (v) localStorage.setItem(AGPL_KEY, 'yes');
    else localStorage.setItem(AGPL_KEY, 'no');
  } catch (_) { /* storage bloqueado: fica desligado */ }
  emit();
}

export function isAgpl(id) {
  return Boolean(AGPL_MODELS[id]);
}

/** Catálogo efetivo: os AGPL só aparecem depois do aceite. */
export function allModels() {
  return agplAccepted() ? { ...MODELS, ...AGPL_MODELS } : { ...MODELS };
}

function specOf(id) {
  return MODELS[id] || AGPL_MODELS[id] || null;
}

/*
 * ================== QUAL EP CADA MODELO USA ==================
 *
 * WebGPU não é sempre melhor, e às vezes ERRA EM SILÊNCIO. Medido em
 * out/2026 (Mac M-series, Chrome, ORT 1.20.1 com proxy; mediana de execução
 * e comparação das saídas webgpu × wasm na mesma imagem real):
 *   - quantizados (q8/int8/mm8): DynamicQuantizeLinear, MatMulInteger e
 *     afins não têm kernel WebGPU; caem para a CPU dentro da sessão. Depth
 *     Anything q8 1392 → 1317 ms, RF-DETR nano 376 → 514 ms (pior);
 *   - BiRefNet: um Concat de 50 entradas passa do limite de 8 storage
 *     buffers do WebGPU → saída errada SEM exceção, e o pipeline inválido fica
 *     no cache do ORT e estraga os modelos que rodam depois;
 *   - PP-HumanSeg e YOLO26n-depth: saída diverge do wasm na imagem real
 *     (diferença média 0,28 na probabilidade; 3,0 na profundidade);
 *   - SFace: o run no WebGPU aborta;
 *   - MediaPipe palma (23 → 28 ms) e malha do rosto (7 → 52 ms): mais lentos
 *     no WebGPU (modelos pequenos: o custo de despacho domina);
 *   - PP-OCRv3 det: ganho pequeno (75 → 57-70 ms) e não validado com texto.
 * Por isso a regra é LISTA DE PERMISSÃO: só vai para o WebGPU quem foi medido
 * e validado. Modelo novo (inclusive os treinados pelo usuário) roda em wasm
 * até entrar aqui. Ganhos medidos (wasm → webgpu, ms):
 *   pose 25,7 → 9,9 · yolox 209 → 43 · yunet 19,7 → 12,1 · rtmo-s 240 → 63
 *   yolo26n 51 → 19 · yolo26n-pose 56-102 → 37-41 · yolo26n-seg 67 → 32
 *   yolo26n-cls 8 → 4,2 · yolo26n-sem 108 → 39 · yolo26n-obb 122 → 41
 *   yoloe-pf 405 → 106 · mobilesam-enc 623 → 220 · mclip2-visual 138 → 16,5
 *   reid-youtu 52 → 35 · mp-mao 10,8 → 5,3 · mobilenetv2 10,6 → 8,2
 *   ocr5-det 213 → 132 · ocr5-latin 62 → 9,4 · crnn 32 → 13
 * (saídas iguais ao wasm até ~1e-5 relativo; nas detecções end-to-end,
 * as mesmas caixas, classes e scores.)
 *
 * Ordem de decisão:
 *   1. `spec.ep` ('wasm' | 'webgpu') na spec manda, se existir;
 *   2. localStorage['iav.ort.ep'] = 'webgpu' tenta webgpu em todos (para medir);
 *   3. EP_WEBGPU (abaixo) → webgpu, com queda automática para wasm;
 *   4. o resto → wasm.
 * =============================================================
 */
const EP_WEBGPU = new Set([
  'pose', 'yolox', 'yunet', 'rtmo-s', 'mobilenetv2', 'reid-youtu', 'mp-mao',
  'ocr5-det', 'ocr5-latin', 'crnn', 'mobilesam-enc', 'mclip2-visual',
  'yolo26n', 'yolo26n-pose', 'yolo26n-seg', 'yolo26n-cls', 'yolo26n-sem', 'yolo26n-obb',
  'yoloe-pf',
]);

/*
 * Modelos de tempo real (fila rápida mesmo antes de medir, e mesmo num
 * aparelho lento onde a média passa de RAPIDO_MS). `spec.realtime` também vale.
 */
const TEMPO_REAL = new Set(['pose', 'yunet', 'mp-palma', 'mp-mao', 'mp-malha', 'rtmo-s', 'yolo26n-pose']);

function epDoModelo(id, spec) {
  if (spec && (spec.ep === 'wasm' || spec.ep === 'webgpu')) return spec.ep;
  const pref = preferenciaEp();
  if (pref === 'wasm' || pref === 'webgpu') return pref;
  return EP_WEBGPU.has(id) ? 'webgpu' : 'wasm';
}

// ---------------------------------------------------------------- sessões

const sessions = new Map();   // id -> { status, session, error, progress, ep }
const listeners = new Set();

export function onModelState(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snap = modelStates();
  for (const fn of listeners) fn(snap);
}

export function modelStates() {
  const out = {};
  for (const id of Object.keys(allModels())) {
    const s = sessions.get(id);
    out[id] = s
      ? { status: s.status, progress: s.progress || 0, error: s.error || null, ep: s.ep || null, ms: s.ms || 0,
          // runMs: média móvel do tempo de execução no worker (sem a espera na fila)
          runMs: s.runMs ? Math.round(s.runMs * 10) / 10 : 0, fila: s.session ? classeDe(id) : null,
          erroGpu: s.erroGpu || null }
      : { status: 'idle', progress: 0, error: null, ep: null, ms: 0, runMs: 0, fila: null, erroGpu: null };
  }
  return out;
}

export function isReady(id) {
  const s = sessions.get(id);
  return Boolean(s && s.status === 'ready');
}

/**
 * Carrega um modelo. Chamadas concorrentes compartilham a mesma promise —
 * dois operadores pedindo o mesmo modelo não baixam 35 MB duas vezes.
 */
export function loadModel(id) {
  const spec = specOf(id);
  if (!spec) return Promise.reject(new Error('modelo desconhecido: ' + id));
  // trava AGPL: pesos sob AGPL só carregam após aceite explícito
  if (spec.agpl && !agplAccepted()) {
    return Promise.reject(new Error(
      'Modelo sob AGPL-3.0 bloqueado. Habilite em Modelos › Ultralytics YOLO26 ' +
      'depois de ler as obrigações da licença.'
    ));
  }

  const existing = sessions.get(id);
  if (existing && existing.promise) return existing.promise;

  const entry = { status: 'loading', progress: 0, promise: null };
  sessions.set(id, entry);
  emit();

  /*
   * Modelo com carregador próprio (ex.: Florence-2, que roda no transformers.js
   * dentro de um worker, não no ORT daqui). O spec traz `loader(onProgress)`;
   * o estado continua passando por aqui para o painel Modelos acompanhar.
   */
  if (typeof spec.loader === 'function') {
    const t0 = performance.now();
    entry.promise = Promise.resolve(spec.loader((p) => { entry.progress = p; emit(); }))
      .then((r) => {
        Object.assign(entry, { status: 'ready', progress: 1, ep: (r && (r.device || r.ep)) || spec.runtime || 'externo', ms: performance.now() - t0, session: r });
        emit();
        return r;
      })
      .catch((err) => {
        entry.status = 'error';
        entry.error = String(err && err.message ? err.message : err);
        emit();
        throw err;
      });
    return entry.promise;
  }

  entry.promise = (async () => {
    const t0 = performance.now();
    const ort = await ensureOrt();

    // baixa com progresso: 35 MB sem feedback parece travamento
    // grafo + dados externos (pesos fp16 fora do .onnx): baixa todos com um
    // progresso só e entrega ao ORT como externalData, pelo nome do arquivo
    const arquivos = spec.files || [spec.file];
    const feitos = new Array(arquivos.length).fill(0);
    const bufs = [];
    for (let i = 0; i < arquivos.length; i++) {
      bufs.push(await fetchWithProgress(arquivos[i], (p) => {
        feitos[i] = p;
        entry.progress = feitos.reduce((acc, v) => acc + v, 0) / arquivos.length;
        emit();
      }));
    }
    const buf = bufs[0];
    const externalData = arquivos.length > 1
      ? arquivos.slice(1).map((f, i) => ({ data: bufs[i + 1], path: f.split('/').pop() }))
      : undefined;

    const providers = ortComGPU && epDoModelo(id, spec) === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'];
    let session = null, lastErr = null, used = null;
    for (const ep of providers) {
      try {
        /*
         * Com proxy, o create TRANSFERE o buffer do modelo para o worker (o
         * Uint8Array fica destacado, length 0). Se a tentativa webgpu falhar,
         * o wasm precisa de um buffer inteiro: o webgpu recebe uma cópia.
         */
        const modelo = ep === 'webgpu' ? buf.slice() : buf;
        session = await naFila(() => criarSessao(ort, modelo, ep, externalData), 'criar');
        used = ep;
        break;
      } catch (err) {
        lastErr = err;
        if (ep === 'webgpu') entry.erroGpu = String(err && err.message ? err.message : err).slice(0, 300);
      }
    }
    if (!session) throw lastErr || new Error('nenhum execution provider aceitou o modelo');

    entry.session = session;
    entry.status = 'ready';
    entry.ep = used;
    entry.progress = 1;
    entry.ms = performance.now() - t0;
    /*
     * Rede de segurança da 1ª execução: há operador que o WebGPU aceita na
     * criação e recusa ao rodar (forma dinâmica, tipo sem kernel). Guarda o
     * buffer original até a primeira execução dar certo; se falhar, recria em
     * wasm e repete (ver run()).
     */
    if (used === 'webgpu') entry.reserva = () => criarSessao(ort, buf, 'wasm', externalData);
    emit();
    return session;
  })().catch((err) => {
    entry.status = 'error';
    entry.error = String(err && err.message ? err.message : err);
    emit();
    throw err;
  });

  return entry.promise;
}

function criarSessao(ort, modelo, ep, externalData) {
  return ort.InferenceSession.create(modelo, {
    executionProviders: [ep],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,   // sem os avisos "Removing initializer…" do PP-OCRv5 no console
    ...(externalData ? { externalData } : {}),
  });
}

export function getSession(id) {
  const s = sessions.get(id);
  return s && s.status === 'ready' ? s.session : null;
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Roda uma sessão. `feeds` é um mapa nome->Tensor; se o nome for null usa o
 * primeiro input declarado pelo modelo (evita hardcodar nome de input, que
 * varia entre os modelos do zoo).
 */
/*
 * ================== UMA INFERÊNCIA POR VEZ ==================
 *
 * Com `wasm.proxy = true` todas as sessões vivem no MESMO worker, e o proxy
 * do ORT não casa direito respostas de chamadas simultâneas: com YOLOX e
 * MobileSAM na mesma cadeia, o detector recebeu o erro do decodificador do
 * SAM ("Invalid rank for input: image_embeddings") e as duas inferências
 * falharam. O worker executa uma de cada vez de qualquer jeito, então a fila
 * não custa desempenho — só põe ordem. Criação de sessão entra na mesma fila.
 * =============================================================
 *
 * ================== FILA COM DUAS PRIORIDADES ==================
 *
 * Fila única em ordem de chegada tinha um defeito caro: com Bike Fit +
 * profundidade, a Depth Anything q8 (2-3 s por inferência) entrava toda vez
 * que a pose terminava, e a pose caía de ~15 para 0,2-0,4 por segundo.
 *
 * Agora há duas filas, e o worker continua serial:
 *   - RÁPIDA: modelo em TEMPO_REAL (ou `realtime: true` na spec), ou com
 *     média medida de execução < RAPIDO_MS. Passa na frente dos lentos.
 *   - LENTA: o resto, e a criação de sessões.
 *
 * Só "passar na frente" não basta: a pose pede uma inferência por quadro, e
 * entre o fim de uma e o pedido da próxima há uma bolha de meio quadro. Um
 * lento que chegasse nessa bolha ocuparia o worker por 2-3 s do mesmo jeito.
 * Por isso, enquanto o FLUXO RÁPIDO está ativo (há rápido pendente, ou um
 * rápido terminou há menos de JANELA_RAPIDA_MS), o lento espera.
 *
 * Contra a fome dos lentos: é um ciclo de trabalho. Passado um intervalo
 * proporcional à duração do último lento, contado do FIM dele, o próximo
 * lento entra mesmo com rápidos na fila. Isso garante aos lentos COTA_LENTA
 * do tempo do worker sob disputa (com 1/3: a profundidade de 2,5 s roda uma
 * vez a cada ~7,5 s, e os rápidos ficam com 2/3), nunca menos que
 * PAUSA_MIN_LENTO_MS nem mais que PAUSA_MAX_LENTO_MS de pausa. Contar do fim
 * do último lento (e não da espera de cada pedido) impede que vários modelos
 * lentos, revezando, somem mais que a cota. Sem disputa (nenhum modelo em
 * tempo real na cadeia) nada muda: o lento entra na hora.
 * =============================================================
 */
const RAPIDO_MS = 100;          // média de execução abaixo disto = fila rápida
const JANELA_RAPIDA_MS = 150;   // > 1 quadro de vídeo de 25 fps + preparo do recorte
const COTA_LENTA = 1 / 3;       // fração do worker garantida aos lentos sob disputa
const PAUSA_MIN_LENTO_MS = 300;
const PAUSA_MAX_LENTO_MS = 10000;   // teto: um lento nunca espera mais que isto

const filaRapida = [];
const filaLenta = [];
let ocupado = false;
let ultimoRapidoFim = -Infinity;
let ultimoLentoMs = 0;
let ultimoLentoFim = -Infinity;
let relogio = null;

/*
 * ECONOMIA (arquivo e YouTube com sincronia): o WASM com 4 threads a ~95% do tempo deixava o
 * processo em 400–490% de CPU, e a captura da aba caía para 13–22 fps num Mac carregado. Com a
 * imagem atrasada pela sincronia, inferir um pouco menos não aparece no desenho (ele é
 * interpolado): depois de cada execução em WASM o worker descansa `economia` × a duração dela
 * (0,5 → no máximo ~2/3 do tempo ocupado). WebGPU e câmera ao vivo não descansam.
 */
let economia = 0;
let descansoAte = -Infinity;
/** Fração de descanso após cada inferência WASM (0 desliga). Chamado pelo Viewport. */
export function definirEconomia(f) {
  economia = Math.max(0, Math.min(2, Number(f) || 0));
  if (!economia) descansoAte = -Infinity;
}

/** Leitura (só leitura) das filas e da economia, para a telemetria (cv/runtime/telemetria.js). */
export function estadoFila() {
  return {
    rapida: filaRapida.length, lenta: filaLenta.length, total: filaRapida.length + filaLenta.length,
    ocupado, economia, descansando: performance.now() < descansoAte,
  };
}

/** Classe de fila de um modelo: 'rapida' ou 'lenta'. */
function classeDe(id) {
  const spec = specOf(id);
  if ((spec && spec.realtime) || TEMPO_REAL.has(id)) return 'rapida';
  const s = sessions.get(id);
  // a 1ª execução (compilação de shaders, aquecimento) não entra na média
  return s && s.nRun >= 2 && s.runMs < RAPIDO_MS ? 'rapida' : 'lenta';
}

/** Pausa mínima, desde o fim do último lento, antes de outro furar o fluxo rápido. */
function pausaLento() {
  return Math.min(PAUSA_MAX_LENTO_MS,
    Math.max(PAUSA_MIN_LENTO_MS, ultimoLentoMs * (1 - COTA_LENTA) / COTA_LENTA));
}

/**
 * Põe `fn` na fila. `classe`: 'rapida', 'lenta' ou 'criar' (criação de
 * sessão: vai para a fila lenta, mas não conta como "último lento" para a cota).
 * `id` (opcional): o modelo, para medir a duração de execução.
 */
function naFila(fn, classe = 'lenta', id = null) {
  return new Promise((resolve, reject) => {
    const tarefa = { fn, resolve, reject, classe, id };
    (classe === 'rapida' ? filaRapida : filaLenta).push(tarefa);
    despachar();
  });
}

function despachar() {
  if (ocupado) return;
  if (relogio) { clearTimeout(relogio); relogio = null; }
  const agora = performance.now();
  if (agora < descansoAte && (filaRapida.length || filaLenta.length)) {
    relogio = setTimeout(despachar, Math.max(1, descansoAte - agora + 1));
    return;
  }
  let tarefa = null;
  if (filaLenta.length) {
    // a pausa conta do fim do último lento (o primeiro lento entra direto)
    const desde = agora - ultimoLentoFim;
    const pausa = pausaLento();
    const fluxoRapido = filaRapida.length > 0 || agora - ultimoRapidoFim < JANELA_RAPIDA_MS;
    if (!fluxoRapido || desde >= pausa) {
      tarefa = filaLenta.shift();
    } else if (!filaRapida.length) {
      // ninguém rápido pendente, mas o fluxo está quente: reavalia quando a
      // janela fechar ou a pausa vencer — o que vier primeiro
      const ate = Math.min(pausa - desde, JANELA_RAPIDA_MS - (agora - ultimoRapidoFim));
      relogio = setTimeout(despachar, Math.max(1, ate + 1));
      return;
    }
  }
  if (!tarefa && filaRapida.length) tarefa = filaRapida.shift();
  if (!tarefa) return;

  ocupado = true;
  const ini = performance.now();
  Promise.resolve().then(tarefa.fn).then(
    (r) => { concluir(tarefa, ini, true); tarefa.resolve(r); },
    (e) => { concluir(tarefa, ini, false); tarefa.reject(e); },
  );
}

function concluir(tarefa, ini, ok) {
  const fim = performance.now();
  const dur = fim - ini;
  if (tarefa.classe === 'rapida') ultimoRapidoFim = fim;
  else if (tarefa.classe === 'lenta') { ultimoLentoMs = dur; ultimoLentoFim = fim; }
  if (ok && tarefa.id) {
    const s = sessions.get(tarefa.id);
    if (economia && s && s.ep === 'wasm') descansoAte = fim + dur * economia;
    if (s) {
      s.nRun = (s.nRun || 0) + 1;
      // média móvel exponencial; a 1ª execução (aquecimento) é descartada
      if (s.nRun === 2) s.runMs = dur;
      else if (s.nRun > 2) s.runMs = s.runMs * 0.8 + dur * 0.2;
    }
  }
  ocupado = false;
  // despacha no próximo microtask: quem esperava esta resposta pode já
  // enfileirar a seguinte antes da decisão
  Promise.resolve().then(despachar);
}

/** Cópia dos tensores de entrada (o proxy transfere os buffers ao worker). */
function copiarFeeds(ort, feeds) {
  const out = {};
  for (const [k, t] of Object.entries(feeds)) {
    out[k] = t && t.data && t.data.slice ? new ort.Tensor(t.type, t.data.slice(), t.dims) : t;
  }
  return out;
}

/**
 * Executa na fila certa. Na 1ª execução de uma sessão WebGPU guarda uma cópia
 * das entradas: se o WebGPU falhar ao rodar, recria o modelo em wasm e repete
 * — quem chamou nem fica sabendo, e modelStates() passa a mostrar 'wasm'.
 */
async function executar(id, feeds, fetches) {
  const entry = sessions.get(id);
  const session = entry && entry.status === 'ready' ? entry.session : null;
  if (!session) throw new Error('modelo não carregado: ' + id);
  const chamar = (sess, f) => (fetches ? sess.run(f, fetches) : sess.run(f));
  if (!entry.reserva) return naFila(() => chamar(session, feeds), classeDe(id), id);

  const ort = await ensureOrt();
  const copia = copiarFeeds(ort, feeds);
  try {
    const r = await naFila(() => chamar(session, feeds), classeDe(id), id);
    entry.reserva = null;   // WebGPU rodou: solta o buffer do modelo
    return r;
  } catch (err) {
    const recriar = entry.reserva;
    if (!recriar || entry.session !== session) throw err;
    // entrada errada (forma, tipo, nome) é erro de quem chamou: no wasm daria
    // o mesmo erro, e o modelo perderia a GPU à toa
    if (/invalid (dimensions|rank)|input|data type/i.test(String(err && err.message ? err.message : err))) throw err;
    entry.reserva = null;
    entry.erroGpu = String(err && err.message ? err.message : err).slice(0, 300);
    let nova;
    try {
      nova = await naFila(recriar, 'criar');
    } catch (_) {
      throw err;
    }
    try { session.release(); } catch (_) { /* já liberada */ }
    entry.session = nova;
    entry.ep = 'wasm';
    entry.nRun = 0; entry.runMs = 0;
    emit();
    return naFila(() => chamar(nova, copia), classeDe(id), id);
  }
}

export async function run(id, tensor) {
  const session = getSession(id);
  if (!session) throw new Error('modelo não carregado: ' + id);
  const feeds = {};
  feeds[session.inputNames[0]] = tensor;
  return executar(id, feeds, null);
}

/** Vários tensores de entrada, pelo nome (a cabeça de relações tem cinco). */
export async function runFeeds(id, feeds, fetches) {
  // `fetches` (nomes de saída) deixa o ORT podar o grafo: sem os protótipos
  // de máscara o YOLOE custa quase metade
  return executar(id, feeds, fetches);
}
export async function makeTensor(data, dims) {
  const ort = await ensureOrt();
  return new ort.Tensor('float32', data, dims);
}

/** Libera a sessão e a memória de GPU/WASM. */
export function unload(id) {
  const s = sessions.get(id);
  if (s && s.session && s.session.release) {
    try { s.session.release(); } catch (_) { /* já liberada */ }
  }
  sessions.delete(id);
  emit();
}

export function totalBytes(ids) {
  const all = { ...MODELS, ...AGPL_MODELS };
  return (ids || Object.keys(MODELS)).reduce((a, id) => a + (all[id] ? all[id].bytes : 0), 0);
}

export function getSpec(id) {
  return specOf(id);
}
