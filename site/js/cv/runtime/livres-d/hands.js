/**
 * cv/runtime/livres-d/hands.js — MediaPipe Hands em dois estágios (OpenCV Zoo,
 * Apache-2.0): detector de PALMA no quadro inteiro, depois 21 pontos por mão
 * num recorte girado.
 *
 * Por que palma e não mão: a palma é quase rígida e quadrada, então uma caixa
 * fixa a descreve bem; a mão inteira muda de forma com os dedos. O detector
 * devolve a caixa da palma mais 7 pontos (pulso, bases dos dedos); o recorte
 * para o segundo estágio sai desses pontos:
 *
 *   ângulo = pulso (0) → base do médio (2), para a mão ficar "em pé";
 *   caixa dos 7 pontos no referencial girado, centro deslocado 0,4 da altura
 *   na direção dos dedos, quadrado de lado 3× o maior lado.
 *
 * As constantes (0,4 e 3) são as do mp_handpose.py do OpenCV Zoo — o recorte
 * que esses pesos esperam. Conferido em Python contra o código de referência:
 * os pontos caem em cima dos dedos em 11 mãos de 9 fotos.
 *
 * Âncoras do detector: SSD de 192², strides 8 (2 âncoras por célula, 24²) e
 * 16 (6 por célula, 12²) = 2016, centro da célula em 0..1. Geradas aqui e
 * conferidas contra a tabela literal do OpenCV Zoo (diferença máx. 7e-9).
 */
import { MODELS, run, makeTensor } from '../onnx.js';
import { toTensorData } from '../tensor.js';
import { frameCanvas, rotCrop, cropToImage, roiFromPoints, sigmoid } from './geom.js';

export const PALM_ID = 'mp-palma';
export const HAND_ID = 'mp-mao';

let ANCHORS = null;
function anchors() {
  if (ANCHORS) return ANCHORS;
  const a = [];
  for (const [stride, n] of [[8, 2], [16, 6]]) {
    const g = 192 / stride;
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) for (let k = 0; k < n; k++) a.push((x + 0.5) / g, (y + 0.5) / g);
  }
  return (ANCHORS = new Float32Array(a));
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - ix * iy;
  return u > 0 ? (ix * iy) / u : 0;
}

/** Palmas no quadro: [{ x1,y1,x2,y2, score, kp:[7 pontos] }] em pixels. */
export async function detectPalms(canvas, W, H, { conf = 0.5, max = 4 } = {}) {
  const spec = MODELS[PALM_ID];
  const S = spec.input[1];
  // letterbox = recorte sem giro, centrado, de lado max(W,H): preto fora da imagem
  const roi = { cx: W / 2, cy: H / 2, size: Math.max(W, H), ang: 0 };
  const img = rotCrop(canvas, roi, S);
  const out = await run(PALM_ID, await makeTensor(toTensorData(img, spec), spec.input));
  let reg = null, cls = null;
  for (const k of Object.keys(out)) {
    const t = out[k];
    if (t.dims[2] === 18) reg = t.data; else if (t.dims[2] === 1) cls = t.data;
  }
  if (!reg || !cls) throw new Error('saídas inesperadas do detector de palma');
  const A = anchors();
  const k = roi.size / S, ox = roi.cx - roi.size / 2, oy = roi.cy - roi.size / 2;
  const zc = Math.log(conf / (1 - conf));         // compara logit: 2016 exp a menos
  const cands = [];
  for (let i = 0; i < 2016; i++) {
    if (cls[i] < zc) continue;
    const r = i * 18, ax = A[2 * i] * S, ay = A[2 * i + 1] * S;
    const cx = reg[r] + ax, cy = reg[r + 1] + ay, w = reg[r + 2], h = reg[r + 3];
    const kp = [];
    for (let j = 0; j < 7; j++) kp.push({ x: ox + (reg[r + 4 + 2 * j] + ax) * k, y: oy + (reg[r + 5 + 2 * j] + ay) * k });
    cands.push({
      x1: ox + (cx - w / 2) * k, y1: oy + (cy - h / 2) * k, x2: ox + (cx + w / 2) * k, y2: oy + (cy + h / 2) * k,
      score: sigmoid(cls[i]), kp,
    });
  }
  cands.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const c of cands) {
    if (keep.every((q) => iou(q, c) < 0.3)) keep.push(c);
    if (keep.length >= max) break;
  }
  return keep;
}

/** ROI do segundo estágio a partir dos 7 pontos da palma. */
export function roiFromPalm(kp) {
  const ang = Math.atan2(kp[2].x - kp[0].x, -(kp[2].y - kp[0].y));
  return roiFromPoints(kp, ang, 3, 0, -0.4);
}

/** 21 pontos de uma mão: { pts:[{x,y,z}], conf, direita (0..1), roi }. */
export async function handLandmarks(canvas, roi) {
  const spec = MODELS[HAND_ID];
  const S = spec.input[1];
  const img = rotCrop(canvas, roi, S);
  const out = await run(HAND_ID, await makeTensor(toTensorData(img, spec), spec.input));
  // Identity = pontos de tela (63), Identity_1 = presença, Identity_2 = lateralidade,
  // Identity_3 = pontos 3D "do mundo" (63) — nomes lidos do grafo com onnxruntime
  const lm = out.Identity.data, conf = out.Identity_1.data[0], lado = out.Identity_2.data[0];
  const k = roi.size / S;
  const pts = [];
  for (let i = 0; i < 21; i++) {
    const p = cropToImage(roi, S, lm[3 * i], lm[3 * i + 1]);
    pts.push({ x: p.x, y: p.y, z: lm[3 * i + 2] * k });
  }
  return { pts, conf, direita: lado, roi };
}

/**
 * Pipeline completo num ImageData. Coordenadas devolvidas em pixels.
 * `conf` = palma; `minHand` = presença no segundo estágio.
 */
export async function detectHands(img, { conf = 0.5, minHand = 0.5, max = 2 } = {}) {
  const canvas = frameCanvas(img, 'maos');
  const palms = await detectPalms(canvas, img.width, img.height, { conf, max });
  const hands = [];
  for (const p of palms) {
    const h = await handLandmarks(canvas, roiFromPalm(p.kp));
    if (h.conf < minHand) continue;
    h.palm = p;
    hands.push(h);
  }
  return hands;
}
