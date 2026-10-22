/**
 * operators/livres-g/pose-seguida.js — pose de UMA pessoa, seguida quadro a
 * quadro, para a Academia (CV-30).
 *
 * Mesmos modelos do dnn.pose (CV-06): YOLOX acha a pessoa e o BlazePose
 * (MediaPipe, Apache-2.0) estima os 33 pontos no recorte. O caminho é o do
 * Bike Fit (CV-28), com o que muda na academia:
 *
 *   1. O YOLOX (0,3–2 s no WASM) só roda quando a pose se perde ou degrada
 *      e, como rede de segurança, a cada `detectarMs`. No resto do tempo o
 *      recorte segue os pontos auxiliares do próprio BlazePose (33 = centro,
 *      34 = escala/rotação), como o MediaPipe faz. Assim a pose sai a
 *      10–25 por segundo e a repetição rápida (polichinelo, ~0,8 s) não se perde.
 *   2. Recorte QUADRADO e GIRADO para o tronco ficar em pé, o protocolo com
 *      que o modelo foi treinado. Na academia a pessoa pode estar DEITADA
 *      (flexão, prancha, abdominal): na semente do detector a pose é tentada
 *      em 0°, ±90° e ±45° e fica a que melhor cobre a caixa da pessoa
 *      (IoU entre os 33 pontos e a caixa do YOLOX). Num recorte reto, o
 *      corpo deitado vira um "em pé" encolhido.
 *   3. Espelho: o BlazePose não é simétrico. Com a imagem espelhada, o
 *      recorte é desespelhado antes do modelo e os pontos voltam espelhados,
 *      com esquerda/direita trocadas: o modelo sempre vê a orientação real.
 *
 * Também mede o MOVIMENTO da imagem entre amostras (miniatura cinza de
 * 64 px, p95 da diferença): foto ou vídeo parado não conta repetição.
 */
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { letterbox, toTensorData, decodeYolox, unletterbox } from '../../runtime/tensor.js';
import { sigmoid } from '../../runtime/opkit.js';

export const novoCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

/** Espelho efetivo: 'automático' segue a Fonte (ctx.mirrored). */
export function espelhoEfetivo(v, ctx) {
  if (v === 'sim' || v === true) return true;
  if (v === 'não' || v === false) return false;
  return Boolean(ctx && ctx.mirrored);
}

// ROI girada: centro (cx, cy), lado s e direção "para cima" (ux, uy) unitária.
// recorte→quadro: f = C + k·(u'·a + v'·b), u' = u − S/2, v' = v − S/2, k = s/S,
// a = (−uy, ux) (direita do recorte) e b = (−ux, −uy) (baixo do recorte).
const eixos = (roi) => ({ a: { x: -roi.uy, y: roi.ux }, b: { x: -roi.ux, y: -roi.uy } });

function recortar(fonte, roi, S, st) {
  if (!st.cc) st.cc = novoCanvas(S, S);
  const g = st.cc.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const k = roi.s / S, { a, b } = eixos(roi);
  g.setTransform(a.x / k, b.x / k, a.y / k, b.y / k,
    S / 2 - (a.x * roi.cx + a.y * roi.cy) / k, S / 2 - (b.x * roi.cx + b.y * roi.cy) / k);
  g.imageSmoothingQuality = 'medium';
  g.drawImage(fonte, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return g.getImageData(0, 0, S, S);
}
function paraQuadro(roi, S, u, v) {
  const k = roi.s / S, { a, b } = eixos(roi);
  const up = u - S / 2, vp = v - S / 2;
  return { x: roi.cx + k * (up * a.x + vp * b.x), y: roi.cy + k * (up * a.y + vp * b.y) };
}
function roiDosAuxiliares(c, e) {
  const dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy);
  if (!(d > 2)) return null;
  return { cx: c.x, cy: c.y, s: 2 * d * 1.25, ux: dx / d, uy: dy / d };
}
function espelharImg(img) {
  const W = img.width, H = img.height, a = img.data, out = new ImageData(W, H), b = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = (y * W + (W - 1 - x)) * 4;
      b[i] = a[j]; b[i + 1] = a[j + 1]; b[i + 2] = a[j + 2]; b[i + 3] = 255;
    }
  }
  return out;
}
// pares esquerda↔direita dos 33 pontos MediaPipe
const TROCA = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21,
  24, 23, 26, 25, 28, 27, 30, 29, 32, 31];

export function caixaPontos(P) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < 33; i++) {
    const p = P[i];
    if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2 };
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy, u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0 ? inter / u : 0;
}

/** Uma passada do BlazePose na ROI: 33 pontos + 2 auxiliares, em px do quadro. */
async function estimar(fonte, roi, st, esp) {
  const ps = MODELS.pose, S = ps.input[2];
  const crop = recortar(fonte, roi, S, st);
  const o = await run('pose', await makeTensor(toTensorData(esp ? espelharImg(crop) : crop, ps), ps.input));
  let lms = null;
  for (const k of Object.keys(o)) {
    const d = o[k];
    if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) lms = d.data;
  }
  if (!lms) return null;
  const P = [];
  for (let i = 0; i < 35; i++) {
    const j = (esp && i < 33 ? TROCA[i] : i) * ps.stride;
    const u = esp ? S - lms[j] : lms[j];
    const f = paraQuadro(roi, S, u, lms[j + 1]);
    P.push({ x: f.x, y: f.y, v: i < 33 ? sigmoid(lms[j + 3]) : 1 });
  }
  const aux = P.splice(33, 2);
  return { P, proxima: roiDosAuxiliares(aux[0], aux[1]) };
}

/** Movimento entre amostras (p95 da diferença, 0..255) numa miniatura cinza de 64 px. */
const LARG = 64;
export function medirMovimento(fonte, w, h, st) {
  const mh = Math.max(8, Math.round((LARG * h) / w));
  if (!st.movc || st.movc.height !== mh) { st.movc = novoCanvas(LARG, mh); st.movAnt = null; }
  const g = st.movc.getContext('2d', { willReadFrequently: true });
  g.drawImage(fonte, 0, 0, LARG, mh);
  const d = g.getImageData(0, 0, LARG, mh).data;
  const cinza = new Uint8Array(LARG * mh);
  for (let i = 0, j = 0; j < cinza.length; i += 4, j++) cinza[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  const ant = st.movAnt;
  st.movAnt = cinza;
  if (!ant || ant.length !== cinza.length) return null;
  const hist = new Uint32Array(256);
  for (let j = 0; j < cinza.length; j++) hist[Math.abs(cinza[j] - ant[j])]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= 0.95 * cinza.length) return v; }
  return 255;
}

/**
 * Preparo SÍNCRONO (dentro do quadro): copia o quadro para um canvas do
 * estado (o `src` volta ao pool depois) e, se precisar, monta a entrada do
 * YOLOX. Devolve o que o passo assíncrono usa.
 */
export function preparar(src, st, t, detectarMs) {
  const w = src.width, h = src.height;
  if (!st.fc || st.fc.width !== w || st.fc.height !== h) st.fc = novoCanvas(w, h);
  st.fc.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
  const mov = medirMovimento(st.fc, w, h, st);
  const out = { w, h, t, mov };
  if (!st.roi || !st.tDet || t - st.tDet > detectarMs || st.redetectar) {
    st.redetectar = false;
    const det = MODELS.yolox;
    const lb = letterbox(src, det.input[3], det.input[2]);
    out.det = { data: toTensorData(lb.data, det), lb };
  }
  return out;
}

const NUCLEO = [11, 12, 23, 24, 25, 26, 27, 28];
const ROTACOES = [0, 90, -90, 45, -45];

/**
 * Passo ASSÍNCRONO: detector (se pedido) + BlazePose na ROI seguida.
 * Devolve { P, roi } | { sem: true } | { aquecendo: true, P }.
 */
export async function seguir(st, ent, esp) {
  const { w, h, t, det: dIn } = ent;
  if (dIn) {
    const det = MODELS.yolox;
    const o1 = await run('yolox', await makeTensor(dIn.data, det.input));
    const k1 = Object.keys(o1)[0];
    const caixas = decodeYolox(o1[k1].data, o1[k1].dims, det, 0.35, 0.45, 10)
      .filter((b) => b.classId === 0).map((b) => unletterbox(b, dIn.lb));
    st.tDet = t;
    if (!caixas.length) { st.roi = null; return { sem: true }; }
    caixas.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1));
    const b = caixas[0];
    st.caixa = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
    const semente = { cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, s: Math.max(b.x2 - b.x1, b.y2 - b.y1) * 1.25, ux: 0, uy: -1 };
    const cobre = st.Pult ? iou(caixaPontos(st.Pult), st.caixa) : 0;
    if (!st.roi || cobre < 0.45 || Math.hypot(semente.cx - st.roi.cx, semente.cy - st.roi.cy) > 0.5 * semente.s) {
      st.roi = semente; st.semente = true; st.aquecer = 3;
    }
  }
  let roi = st.roi;
  if (!roi) return { sem: true };
  let est;
  if (st.semente && st.caixa) {
    st.semente = false;
    let melhor = null;
    for (const graus of ROTACOES) {
      const r = (graus * Math.PI) / 180;
      let cand = await estimar(st.fc, { ...roi, ux: Math.sin(r), uy: -Math.cos(r) }, st, esp);
      if (cand && cand.proxima) {
        const ref = await estimar(st.fc, cand.proxima, st, esp);
        if (ref) { ref.roiUsada = cand.proxima; cand = ref; }
      }
      if (!cand) continue;
      cand.nota = iou(caixaPontos(cand.P), st.caixa);
      if (!melhor || cand.nota > melhor.nota) melhor = cand;
      if (cand.nota > 0.75) break;
    }
    est = melhor;
    if (est && est.roiUsada) roi = est.roiUsada;
    if (est && est.proxima) st.sAncora = est.proxima.s;
  } else {
    est = await estimar(st.fc, roi, st, esp);
  }
  if (!est) { st.roi = null; return { sem: true }; }
  const { P } = est;
  st.Pult = P;
  const vMed = NUCLEO.reduce((s, i) => s + P[i].v, 0) / NUCLEO.length;
  const prox = est.proxima;
  if (vMed < 0.3 || !prox || prox.s < 0.08 * Math.min(w, h) || prox.s > 3 * Math.max(w, h)) {
    st.roi = null; return { sem: true };
  }
  st.vBaixa = vMed < 0.45 ? (st.vBaixa || 0) + 1 : 0;
  const fugiu = st.sAncora && (prox.s < 0.55 * st.sAncora || prox.s > 1.8 * st.sAncora);
  if (st.vBaixa >= 5 || fugiu) { st.redetectar = true; st.vBaixa = 0; }
  const m = 0.7;
  const ux = roi.ux + m * (prox.ux - roi.ux), uy = roi.uy + m * (prox.uy - roi.uy), nu = Math.hypot(ux, uy) || 1;
  st.roi = { cx: roi.cx + m * (prox.cx - roi.cx), cy: roi.cy + m * (prox.cy - roi.cy), s: roi.s + m * (prox.s - roi.s), ux: ux / nu, uy: uy / nu };
  if (st.aquecer > 0) { st.aquecer--; return { aquecendo: true, P }; }
  return { P, roi: { ...roi }, vMed };
}
