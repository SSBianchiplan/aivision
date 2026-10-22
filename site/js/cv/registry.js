/**
 * cv/registry.js — whitelist de operadores e catálogo de módulos.
 *
 * Contraparte no cliente do backend/app/cv/registry.py (SPEC ADR-4):
 * o pipeline referencia operadores por NOME, nunca por código. Um nome
 * fora deste registry é rejeitado — no protótipo isso já vale, para o
 * hábito não ter que ser aprendido depois.
 *
 * Para adicionar uma capacidade nova: crie o arquivo em operators/,
 * importe aqui e registre o módulo em MODULES. Nada mais no app muda.
 */

import classical from './operators/classical.js';
import features from './operators/features.js';
import motion from './operators/motion.js';
import models from './operators/models.js';
import face from './operators/face.js';
import yolo26 from './operators/yolo26.js';
import code from './operators/code.js';
import relations from './operators/relations.js';
import openvocab from './operators/openvocab.js';
import sam from './operators/sam.js';
import depth from './operators/depth.js';
import zeroshot from './operators/zeroshot.js';
import tracking from './operators/tracking.js';
import custom from './operators/custom.js';
import livresA, { MODULES_A } from './operators/livres-a.js';
import livresB, { MODULES_B } from './operators/livres-b.js';
import livresC, { MODULES_C } from './operators/livres-c.js';
import livresD, { MODULES_D } from './operators/livres-d.js';
import livresE, { MODULES_E } from './operators/livres-e.js';
import livresF, { MODULES_F } from './operators/livres-f.js';
import livresG, { MODULES_G } from './operators/livres-g.js';
import livresH, { MODULES_H } from './operators/livres-h.js';
import livresI, { MODULES_I } from './operators/livres-i.js';
import livresJ, { MODULES_J } from './operators/livres-j.js';
import livresK, { MODULES_K } from './operators/livres-k.js';
import livresL, { MODULES_L } from './operators/livres-l.js';   // CV-38 Contagem em esteira (CounterVision)
import cena, { MODULES_CENA } from './operators/cena.js';   // CV-37 Ferramentas de cena (zonas e linhas)
import livresN, { MODULES_N } from './operators/livres-n.js';   // CV-40 Inspeção visual (Inspect)
import livresM, { MODULES_M } from './operators/livres-m.js';   // CV-39 Tempo de posto (Takt)
import livresO, { MODULES_O } from './operators/livres-o.js';   // CV-46 OEE pela câmera (onda 1-b)
import livresP, { MODULES_P } from './operators/livres-p.js';   // CV-47 Fisio (goniometria, TUG, sentar-levantar)
import livresQ, { MODULES_Q } from './operators/livres-q.js';   // CV-48 Monitor de EPI
import livresOA, { MODULES_OA } from './operators/livres-oa.js';   // CV-41..45 onda 1-a (CVC, instrumentos, segurança por pose, fotocélula, logística) + cena.mapa_calor
import livresS, { MODULES_S } from './operators/livres-s.js';   // CV-60..67 onda 2-b (NR-17, predial, varejo, produto, ocupação, medidor, resumo, velocidade)

/**
 * Catálogo de módulos, espelhando o catálogo de capacidades do SPEC §4.2.
 * `status`:
 *   'ready'   — operadores rodando no cliente, agora
 *   'planned' — declarado no spec, ainda sem implementação
 *   'locked'  — bloqueado por pré-requisito não técnico (ver `blockedBy`)
 */
export const MODULES = [
  {
    id: 'CV-01',
    name: 'Classical CV',
    status: 'ready',
    runtime: 'client',
    desc: 'Filtros, bordas, limiar, morfologia e realce — puro JS sobre ImageData.',
  },
  {
    id: 'CV-04',
    name: 'Motion & Tracking',
    status: 'ready',
    runtime: 'client',
    desc: 'Operadores com estado entre frames — e o tracking com IDs (ByTeTrack sem modelo: ' +
          'IoU + velocidade, duas passadas), com rastro e contagem por linha.',
  },
  {
    id: 'CV-02',
    name: 'Image Classification',
    status: 'ready',
    runtime: 'onnx',
    weights: ['mobilenetv2'],
    desc: 'MobileNetV2 no ImageNet, 1000 classes, top-k com score.',
  },
  {
    id: 'CV-03',
    name: 'Object Detection',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox'],
    desc: 'YOLOX-S no COCO, 80 classes. Apache-2.0 — sem a contaminação AGPL ' +
          'que o YOLO da Ultralytics traria (RSK-03 do SPEC).',
  },
  {
    id: 'CV-05',
    name: 'Segmentation',
    status: 'ready',
    runtime: 'onnx',
    weights: ['pphumanseg'],
    desc: 'PP-HumanSeg: máscara pessoa/fundo, com modos de composição.',
  },
  {
    id: 'CV-06',
    name: 'Keypoint / Pose',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'BlazePose com 33 landmarks, em dois estágios sobre o recorte do YOLOX.',
  },
  {
    id: 'CV-07',
    name: 'OCR',
    status: 'ready',
    runtime: 'onnx',
    weights: ['ppocr_det', 'crnn'],
    desc: 'PP-OCRv3 detecta as regiões, CRNN lê com decode CTC.',
  },
  {
    id: 'CV-10',
    name: 'Códigos (QR e barras)',
    status: 'ready',
    runtime: 'client',
    desc: '12 formatos: QR, EAN-13/8, UPC, Code 128/39, ITF, Codabar, ' +
          'Data Matrix, PDF417 e Aztec. Usa o decodificador nativo quando ' +
          'existe e cai no ZXing no Safari e Firefox. Cada leitura nova abre ' +
          'o painel de Códigos.',
  },
  {
    id: 'CV-09',
    name: 'Ultralytics YOLO26',
    status: 'ready',
    runtime: 'onnx',
    agpl: true,
    weights: ['yolo26n', 'yolo26n-seg', 'yolo26n-pose', 'yolo26n-obb',
              'yolo26n-cls', 'yolo26n-sem', 'yolo26n-depth', 'yolo26n-reid'],
    desc: 'Suíte completa: detecção, instâncias, pose multi-pessoa, caixas ' +
          'orientadas, classificação, semântica, profundidade e tracking por ' +
          're-ID. ⚠ AGPL-3.0 — desligado por padrão; o detector default é o ' +
          'YOLOX-S (Apache-2.0).',
  },
  {
    id: 'CV-11',
    name: 'Relações entre objetos',
    status: 'ready',
    runtime: 'onnx',
    weights: ['relate'],
    desc: 'RelateAnything (DINOv3 ViT-S/16+, 53M): recebe as caixas do detector ' +
          'da cadeia (YOLOX ou YOLO26 antes dele — ou roda o YOLOX sozinho) e diz ' +
          'como os objetos se relacionam: pessoa VESTINDO luva, xícara SOBRE mesa. ' +
          '35 predicados de vocabulário aberto, grafo espacial e semântico. ' +
          'Apache-2.0; pesos derivados de DINOv3 (licença Meta).',
  },
  {
    id: 'CV-12',
    name: 'Detecção de vocabulário aberto',
    status: 'ready',
    runtime: 'onnx',
    agpl: true,
    weights: ['yoloe-pf', 'yoloe-text', 'clip-blt-text'],
    desc: 'YOLOE-11s: 4.585 classes sem lista (prompt-free) ou as classes que você ' +
          'digitar (text-prompt, re-parametrizado ao vivo via MobileCLIP). Substitui ' +
          'as 80 classes fixas do COCO. ⚠ AGPL-3.0, atrás do mesmo aceite do YOLO26.',
  },
  {
    id: 'CV-13',
    name: 'Segmentação por prompt (SAM)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['mobilesam-enc', 'mobilesam-dec'],
    desc: 'MobileSAM: máscara de alta resolução para cada objeto detectado (prompt = ' +
          'caixa) ou para o centro da imagem. Codificador TinyViT uma vez por frame, ' +
          'decodificador leve por objeto. Apache-2.0.',
  },
  {
    id: 'CV-14',
    name: 'Profundidade',
    status: 'ready',
    runtime: 'onnx',
    weights: ['depth-anything'],
    desc: 'Depth Anything V2 small (24,8M, int8): mapa de profundidade relativa de um ' +
          'só frame — perto/longe por objeto, mapa de cor, cinza ou mistura. Apache-2.0.',
  },
  {
    id: 'CV-16',
    name: 'Modelos treinados',
    status: 'ready',
    runtime: 'onnx',
    agpl: true,
    weights: [],
    desc: 'Detectores YOLO26 que você treinou com as suas imagens (menu › Treinar). ' +
          'Rotule, treine no servidor e use aqui na câmera. AGPL-3.0.',
  },
  {
    id: 'CV-15',
    name: 'Zero-shot por texto (CLIP)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['mclip2-visual', 'mclip2-text'],
    desc: 'MobileCLIP2-S0: classifica a cena ou cada objeto contra frases que você ' +
          'escreve ("caixa amassada", "EPI correto"), sem treinar. Licença Apple MobileCLIP.',
  },
  {
    id: 'CV-08',
    name: 'Face Recognition',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yunet', 'sface'],
    sensitive: true,
    desc: 'YuNet + SFace: detecção, alinhamento e embedding de 128-d. ' +
          'Biometria facial é dado pessoal SENSÍVEL (LGPD art. 5º, II) — ' +
          'o cofre implementa consentimento, retenção com expurgo, eliminação ' +
          'e portabilidade. Ainda falta a base legal formal e a DPIA.',
  },
];
MODULES.push(...MODULES_A, ...MODULES_B, ...MODULES_C, ...MODULES_D, ...MODULES_E,
  ...MODULES_F, ...MODULES_G, ...MODULES_H, ...MODULES_I, ...MODULES_J, ...MODULES_K);
MODULES.push(...MODULES_N);
MODULES.push(...MODULES_CENA, ...MODULES_L);
MODULES.push(...MODULES_M);
MODULES.push(...MODULES_OA);
MODULES.push(...MODULES_O, ...MODULES_P, ...MODULES_Q);
MODULES.push(...MODULES_S);

// -------------------------------------------------------------- operadores

const ALL = [...classical, ...features, ...motion, ...tracking, ...models, ...face, ...yolo26, ...relations,
             ...openvocab, ...sam, ...depth, ...zeroshot, ...code, ...custom,
             ...livresA, ...livresB, ...livresC, ...livresD, ...livresE,
             ...livresF, ...livresG, ...livresH, ...livresI, ...livresJ, ...livresK, ...livresL, ...cena, ...livresM, ...livresN, ...livresOA,
             ...livresO, ...livresP, ...livresQ, ...livresS];

/** op name -> definição */
export const OPERATORS = new Map(ALL.map((o) => [o.op, o]));

export function getOperator(op) {
  return OPERATORS.get(op) || null;
}

export function isAllowed(op) {
  return OPERATORS.has(op);
}

/** Lista de operadores de um módulo. */
export function operatorsOf(moduleId) {
  return ALL.filter((o) => o.group === moduleId);
}

/** Módulos que têm ao menos um operador utilizável. */
export function readyModules() {
  return MODULES.filter((m) => m.status === 'ready');
}

/** Preenche os params ausentes com os defaults declarados. */
export function defaultParams(op) {
  const def = getOperator(op);
  if (!def) return {};
  const out = {};
  for (const [k, s] of Object.entries(def.params || {})) out[k] = s.default;
  return out;
}

/**
 * Valida e coage params contra o schema do operador. Descarta chave
 * desconhecida e prende número na faixa — mesma disciplina que a API
 * vai aplicar via JSON Schema (SPEC §5.2 invariante 5).
 */
export function coerceParams(op, params) {
  const def = getOperator(op);
  if (!def) return {};
  const out = {};
  for (const [k, s] of Object.entries(def.params || {})) {
    let v = params && k in params ? params[k] : s.default;
    if (s.type === 'int') {
      v = Math.round(Number(v));
      if (!Number.isFinite(v)) v = s.default;
      if (s.step === 2 && v % 2 === 0) v += 1; // kernels precisam ser ímpares
      v = Math.min(s.max, Math.max(s.min, v));
    } else if (s.type === 'float') {
      v = Number(v);
      if (!Number.isFinite(v)) v = s.default;
      v = Math.min(s.max, Math.max(s.min, v));
    } else if (s.type === 'bool') {
      v = Boolean(v);
    } else if (s.type === 'enum') {
      if (!s.options.includes(v)) v = s.default;
    } else if (s.type === 'text') {
      v = String(v ?? s.default ?? '').slice(0, s.max || 400);
    }
    out[k] = v;
  }
  return out;
}

export const OPERATOR_COUNT = ALL.length;
