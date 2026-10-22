/**
 * cv/runtime/face.js — detecção, alinhamento e embedding facial.
 *
 * Separado dos operadores porque o módulo de autenticação usa estas funções
 * diretamente, sem passar por pipeline: no cadastro e no login o que se quer
 * é UM embedding de UMA face, não um overlay por frame.
 *
 * ALINHAMENTO IMPORTA. O SFace foi treinado em faces alinhadas por template
 * de 5 pontos; jogar um recorte cru de 112×112 nele derruba a similaridade a
 * ponto de a mesma pessoa não bater consigo mesma. Aqui usamos os dois olhos
 * do YuNet para uma transformação de similaridade (rotação + escala +
 * translação), que é a aproximação padrão de 2 pontos do template ArcFace.
 */

import { MODELS, run, makeTensor, isReady, loadModel } from './onnx.js';
import { toTensorData, nms } from './tensor.js';

/** Template canônico ArcFace/SFace em 112×112 — olho esq., olho dir. */
const TPL_LEFT_EYE = { x: 38.2946, y: 51.6963 };
const TPL_RIGHT_EYE = { x: 73.5318, y: 51.5014 };

const scratch = {};

function canvasOf(key, w, h) {
  let c = scratch[key];
  if (!c) c = scratch[key] = document.createElement('canvas');
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

export async function ensureFaceModels(withRecognition = true) {
  const jobs = [loadModel('yunet')];
  if (withRecognition) jobs.push(loadModel('sface'));
  await Promise.all(jobs);
}

export function faceModelsReady(withRecognition = true) {
  return isReady('yunet') && (!withRecognition || isReady('sface'));
}

// ------------------------------------------------------------ detecção

/**
 * Detecta faces num ImageData.
 * Devolve caixas e os 5 landmarks em coordenadas da imagem original.
 */
export async function detectFaces(image, { conf = 0.75, iou = 0.3, max = 10 } = {}) {
  const spec = MODELS.yunet;
  const H = spec.input[2], W = spec.input[3];

  // letterbox manual: precisamos do mapeamento para desfazer nos landmarks
  const src = canvasOf('src', image.width, image.height);
  src.getContext('2d').putImageData(image, 0, 0);

  const dst = canvasOf('det', W, H);
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const scale = Math.min(W / image.width, H / image.height);
  const dw = image.width * scale, dh = image.height * scale;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  ctx.drawImage(src, 0, 0, image.width, image.height, dx, dy, dw, dh);

  const input = ctx.getImageData(0, 0, W, H);
  const tensor = await makeTensor(toTensorData(input, spec), spec.input);
  const out = await run('yunet', tensor);

  const faces = [];
  for (const stride of spec.strides) {
    const cls = out['cls_' + stride];
    const obj = out['obj_' + stride];
    const box = out['bbox_' + stride];
    const kps = out['kps_' + stride];
    if (!cls || !obj || !box || !kps) continue;

    const cols = Math.floor(W / stride);
    const rows = Math.floor(H / stride);
    const n = Math.min(cls.data.length, rows * cols);

    for (let i = 0; i < n; i++) {
      // score = sqrt(cls * obj), como no wrapper do OpenCV
      const c = clamp01(cls.data[i]);
      const o = clamp01(obj.data[i]);
      const score = Math.sqrt(c * o);
      if (score < conf) continue;

      const cx = (i % cols) * stride;
      const cy = Math.floor(i / cols) * stride;
      const b = i * 4;
      const x = (box.data[b] * stride) + cx;
      const y = (box.data[b + 1] * stride) + cy;
      const w = Math.exp(box.data[b + 2]) * stride;
      const h = Math.exp(box.data[b + 3]) * stride;

      const pts = [];
      for (let k = 0; k < 5; k++) {
        pts.push({
          x: (kps.data[i * 10 + k * 2] * stride + cx - dx) / scale,
          y: (kps.data[i * 10 + k * 2 + 1] * stride + cy - dy) / scale,
        });
      }

      // (x, y) é o CENTRO da face, como no FaceDetectorYN do OpenCV — tratar
      // como canto deslocava a caixa meia largura para a direita e meia altura para baixo
      faces.push({
        x1: (x - w / 2 - dx) / scale, y1: (y - h / 2 - dy) / scale,
        x2: (x + w / 2 - dx) / scale, y2: (y + h / 2 - dy) / scale,
        score, landmarks: pts,
      });
    }
  }
  return nms(faces, iou).slice(0, max);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------ alinhamento

/**
 * Recorta e alinha a face em 112×112 usando os dois olhos.
 *
 * Monta a transformação de similaridade que leva os olhos detectados às
 * posições canônicas do template e deixa o canvas aplicá-la — assim a
 * interpolação sai da GPU em vez de um laço em JS.
 */
export function alignFace(image, face) {
  const S = 112;
  const [le, re] = face.landmarks;   // YuNet: 0 = olho direito da imagem? ver nota

  const dx = re.x - le.x, dy = re.y - le.y;
  const distSrc = Math.hypot(dx, dy) || 1;
  const distTpl = TPL_RIGHT_EYE.x - TPL_LEFT_EYE.x;
  const scale = distTpl / distSrc;
  const angle = Math.atan2(dy, dx);

  const src = canvasOf('src', image.width, image.height);
  src.getContext('2d').putImageData(image, 0, 0);

  const dst = canvasOf('align', S, S);
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);

  const cos = Math.cos(-angle) * scale;
  const sin = Math.sin(-angle) * scale;
  // leva (le.x, le.y) para (TPL_LEFT_EYE.x, TPL_LEFT_EYE.y) já rotacionado
  const tx = TPL_LEFT_EYE.x - (cos * le.x - sin * le.y);
  const ty = TPL_LEFT_EYE.y - (sin * le.x + cos * le.y);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(cos, sin, -sin, cos, tx, ty);
  ctx.drawImage(src, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  return ctx.getImageData(0, 0, S, S);
}

// ------------------------------------------------------------ embedding

/** Embedding L2-normalizado de 128 dimensões de uma face já alinhada. */
export async function embedFace(alignedImage) {
  const spec = MODELS.sface;
  const tensor = await makeTensor(toTensorData(alignedImage, spec), spec.input);
  const out = await run('sface', tensor);
  const raw = out[Object.keys(out)[0]].data;

  const v = new Float32Array(raw.length);
  let norm = 0;
  for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < raw.length; i++) v[i] = raw[i] / norm;
  return v;
}

/**
 * Similaridade de cosseno. Como os vetores já vêm normalizados, é só o
 * produto interno. Acima de MODELS.sface.cosineThreshold é a mesma pessoa,
 * segundo o limiar que o OpenCV documenta para este modelo.
 */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function faceThreshold() {
  return MODELS.sface.cosineThreshold;
}

/** Caminho completo: imagem -> maior face -> alinhada -> embedding. */
export async function embedLargestFace(image, opts) {
  const faces = await detectFaces(image, opts);
  if (!faces.length) return null;
  faces.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1));
  const face = faces[0];
  const aligned = alignFace(image, face);
  const vector = await embedFace(aligned);
  return { face, vector, aligned };
}

/**
 * Detector de vivacidade PASSIVO e fraco: mede variação temporal na região
 * da face. Uma foto parada não varia; uma pessoa sempre varia um pouco.
 *
 * NÃO é anti-spoofing de verdade — um vídeo, ou a foto tremida na mão,
 * passam. Está aqui para tornar o ataque mais chato, não para impedi-lo.
 * Anti-spoofing sério exige sensor de profundidade, IR ou desafio ativo.
 */
export function livenessScore(state, image, face) {
  const S = 24;
  const c = canvasOf('live', S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const src = canvasOf('src', image.width, image.height);
  src.getContext('2d').putImageData(image, 0, 0);
  const w = face.x2 - face.x1, h = face.y2 - face.y1;
  ctx.drawImage(src, face.x1, face.y1, w, h, 0, 0, S, S);
  const d = ctx.getImageData(0, 0, S, S).data;

  const cur = new Float32Array(S * S);
  for (let i = 0, p = 0; i < cur.length; i++, p += 4) {
    cur[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) / 255;
  }
  if (!state.prev || state.prev.length !== cur.length) {
    state.prev = cur;
    state.hist = [];
    return 0;
  }
  let diff = 0;
  for (let i = 0; i < cur.length; i++) diff += Math.abs(cur[i] - state.prev[i]);
  diff /= cur.length;
  state.prev = cur;

  state.hist = state.hist || [];
  state.hist.push(diff);
  if (state.hist.length > 30) state.hist.shift();
  const mean = state.hist.reduce((a, b) => a + b, 0) / state.hist.length;
  return Math.min(1, mean * 120);
}
