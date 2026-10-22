/**
 * operators/livres-i/pose.js — pose de UMA pessoa para o Swing e o VBT.
 *
 * Mesmo par de modelos do CV-06 (YOLOX acha a pessoa, BlazePose estima os 33
 * pontos no recorte), com o recorte seguindo os pontos auxiliares que o
 * próprio BlazePose devolve (33 = centro do quadril, 34 = escala/rotação),
 * como o MediaPipe faz: o YOLOX (lento no WASM) só roda para achar a pessoa,
 * quando a pose se perde e, como rede de segurança, a cada `detectarMs`.
 *
 * Espelho: o BlazePose não é simétrico. Com o quadro espelhado (padrão do
 * app), o recorte é DESESPELHADO antes do modelo e os pontos voltam com
 * esquerda/direita trocadas — os índices que saem daqui são sempre
 * ANATÔMICOS (11 = ombro esquerdo da pessoa), o que o swing precisa para
 * saber qual é o braço líder.
 *
 * Tudo aqui roda dentro do `infer` assíncrono do schedule: uma inferência por
 * vez, na fila única do ONNX. Quem chama passa um canvas com a cópia do
 * quadro (nunca o `src`, que volta ao pool).
 */
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { letterbox, toTensorData, decodeYolox, unletterbox } from '../../runtime/tensor.js';
import { sigmoid } from '../../runtime/opkit.js';
import { COCO_CLASSES } from '../../runtime/labels.js';

export const novoCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

/** Pares esquerda↔direita dos 33 pontos MediaPipe. */
export const TROCA_LADO = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21,
  24, 23, 26, 25, 28, 27, 30, 29, 32, 31];

/** Ligações do esqueleto (para desenhar). */
export const OSSOS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [0, 11], [0, 12]];

/*
 * ROI girada: centro (cx, cy), lado s e direção "para cima" (ux, uy) unitária.
 * recorte→quadro: f = C + k·(u'·a + v'·b), k = s/S, u' = u − S/2, v' = v − S/2,
 * a = (−uy, ux) (direita do recorte), b = (−ux, −uy) (baixo do recorte).
 */
function recortar(fonte, roi, S, st) {
  if (!st.cc) st.cc = novoCanvas(S, S);
  const g = st.cc.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const k = roi.s / S, ax = -roi.uy, ay = roi.ux, bx = -roi.ux, by = -roi.uy;
  g.setTransform(ax / k, bx / k, ay / k, by / k, S / 2 - (ax * roi.cx + ay * roi.cy) / k, S / 2 - (bx * roi.cx + by * roi.cy) / k);
  g.drawImage(fonte, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return g.getImageData(0, 0, S, S);
}
function paraQuadro(roi, S, u, v) {
  const k = roi.s / S, up = u - S / 2, vp = v - S / 2;
  return { x: roi.cx + k * (up * -roi.uy + vp * -roi.ux), y: roi.cy + k * (up * roi.ux + vp * -roi.uy) };
}
function espelhar(img) {
  const W = img.width, H = img.height, a = img.data, out = new ImageData(W, H), b = out.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, j = (y * W + (W - 1 - x)) * 4;
    b[i] = a[j]; b[i + 1] = a[j + 1]; b[i + 2] = a[j + 2]; b[i + 3] = 255;
  }
  return out;
}

/**
 * Detector: pessoas e (opcional) implementos (raquete, taco, bola) no quadro.
 * `lb` = letterbox feito no prep (síncrono, sobre o src). Devolve caixas em px do quadro.
 */
export async function detectar(lbData) {
  const det = MODELS.yolox;
  const o = await run('yolox', await makeTensor(lbData.data, det.input));
  const k = Object.keys(o)[0];
  return decodeYolox(o[k].data, o[k].dims, det, 0.3, 0.45, 20).map((b) => {
    const u = unletterbox(b, lbData.lb);
    return { x1: u.x1, y1: u.y1, x2: u.x2, y2: u.y2, score: b.score, classe: COCO_CLASSES[b.classId] || `#${b.classId}`, classId: b.classId };
  });
}
/** Prepara (síncrono, no prep do schedule) o tensor do YOLOX a partir do src. */
export function prepararDeteccao(src) {
  const det = MODELS.yolox;
  const lb = letterbox(src, det.input[3], det.input[2]);
  return { data: toTensorData(lb.data, det), lb };
}

/**
 * Uma estimativa numa ROI. Devolve { P (33, x/y/z em px do quadro, v), proxima (ROI seguinte) } ou null.
 * esp = quadro espelhado (o recorte vai desespelhado para o modelo).
 */
async function estimar(fonte, roi, st, esp) {
  const ps = MODELS.pose, S = ps.input[2];
  let crop = recortar(fonte, roi, S, st);
  if (esp) crop = espelhar(crop);
  const out = await run('pose', await makeTensor(toTensorData(crop, ps), ps.input));
  let lms = null;
  for (const key of Object.keys(out)) {
    const d = out[key];
    if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) lms = d.data;
  }
  if (!lms) return null;
  const k = roi.s / S;
  const A = [];
  for (let i = 0; i < 35; i++) {
    // passada no recorte desespelhado: u volta espelhado; o índice NÃO troca —
    // espelhar a imagem não muda a anatomia (11 continua sendo o ombro esquerdo)
    const o = i * ps.stride;
    const u = esp ? S - lms[o] : lms[o], v = lms[o + 1];
    const f = paraQuadro(roi, S, u, v);
    A.push({ x: f.x, y: f.y, z: lms[o + 2] * k, v: i < 33 ? sigmoid(lms[o + 3]) : 1 });
  }
  const P = A.slice(0, 33), c = A[33], e = A[34];
  const dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy);
  const proxima = d > 2 ? { cx: c.x, cy: c.y, s: 2 * d * 1.25, ux: dx / d, uy: dy / d } : null;
  return { P, proxima };
}

/** Caixa dos pontos visíveis. */
export function caixaPontos(P, minV = 0.3) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of P) {
    if (p.v < minV) continue;
    if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x; if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
}

const NUCLEO = [11, 12, 23, 24, 25, 26, 27, 28];

/**
 * Passo do rastreador (dentro do infer). st = estado do nó.
 * entrada = { fonte (canvas do quadro), w, h, t, esp, det (deteccoes já feitas ou null) }
 * Devolve { P, roi } ou { sem: true }.
 */
export async function passoPose(st, { fonte, w, h, t, esp, deteccoes }) {
  if (deteccoes) {
    st.tDet = t;
    const pessoas = deteccoes.filter((b) => b.classId === 0);
    if (!pessoas.length) { st.roi = null; return { sem: true }; }
    // a maior pessoa (quem está sendo filmado), preferindo a que já estava sendo seguida
    const ref = st.roi;
    pessoas.sort((a, b) => {
      const pa = (a.x2 - a.x1) * (a.y2 - a.y1), pb = (b.x2 - b.x1) * (b.y2 - b.y1);
      if (!ref) return pb - pa;
      const da = Math.hypot((a.x1 + a.x2) / 2 - ref.cx, (a.y1 + a.y2) / 2 - ref.cy);
      const db = Math.hypot((b.x1 + b.x2) / 2 - ref.cx, (b.y1 + b.y2) / 2 - ref.cy);
      return pb - pa + (da - db) * 20;
    });
    const b = pessoas[0];
    const semente = { cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, s: Math.max(b.x2 - b.x1, b.y2 - b.y1) * 1.25, ux: 0, uy: -1 };
    if (!st.roi || Math.hypot(semente.cx - st.roi.cx, semente.cy - st.roi.cy) > 0.5 * semente.s) {
      st.roi = semente; st.aquecer = 2;
    }
    st.sAncora = null;   // a escala de referência sai da 1ª estimativa (a dos auxiliares não é a da caixa)
  }
  const roi = st.roi;
  if (!roi) return { sem: true };
  let est = await estimar(fonte, roi, st, esp);
  if (st.aquecer > 0 && est && est.proxima) {
    // logo depois do detector: refina a ROI pelos auxiliares antes de medir
    st.aquecer--;
    const ref = await estimar(fonte, est.proxima, st, esp);
    if (ref) { est = ref; st.roi = est.proxima || st.roi; }
  }
  if (!est) { st.roi = null; return { sem: true }; }
  const { P, proxima } = est;
  const vMed = NUCLEO.reduce((s, i) => s + P[i].v, 0) / NUCLEO.length;
  if (vMed < 0.3 || !proxima || proxima.s < 0.06 * Math.min(w, h) || proxima.s > 3 * Math.max(w, h)) {
    st.roi = null; return { sem: true };
  }
  if (!st.sAncora) st.sAncora = proxima.s;
  st.vBaixa = vMed < 0.45 ? (st.vBaixa || 0) + 1 : 0;
  if (st.vBaixa >= 5 || (st.sAncora && (proxima.s < 0.5 * st.sAncora || proxima.s > 2 * st.sAncora))) { st.redetectar = true; st.vBaixa = 0; }
  // ROI do próximo quadro (suavizada contra tremor; leve, o swing é rápido)
  const m = 0.8, r0 = st.roi;
  const ux = r0.ux + m * (proxima.ux - r0.ux), uy = r0.uy + m * (proxima.uy - r0.uy), nu = Math.hypot(ux, uy) || 1;
  st.roi = { cx: r0.cx + m * (proxima.cx - r0.cx), cy: r0.cy + m * (proxima.cy - r0.cy), s: r0.s + m * (proxima.s - r0.s), ux: ux / nu, uy: uy / nu };
  return { P, roi: { ...roi }, vMed };
}

/** Precisa do detector neste quadro? */
export function precisaDetectar(st, t, detectarMs) {
  return !st.roi || !st.tDet || t - st.tDet > detectarMs || st.redetectar || t < st.tDet;
}

/** Copia o src para o canvas do quadro (no prep, síncrono). */
export function copiarQuadro(st, src) {
  if (!st.fc || st.fc.width !== src.width || st.fc.height !== src.height) st.fc = novoCanvas(src.width, src.height);
  st.fc.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
  return st.fc;
}

/** Miniatura quadrada (lado L) em volta de uma caixa {cx, cy, s}, alinhada ao quadro. */
export function miniatura(fonte, caixa, L, st) {
  if (!st.mc || st.mc.width !== L) st.mc = novoCanvas(L, L);
  const g = st.mc.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, L, L);
  const k = L / caixa.s, x0 = caixa.cx - caixa.s / 2, y0 = caixa.cy - caixa.s / 2;
  g.drawImage(fonte, -x0 * k, -y0 * k, fonte.width * k, fonte.height * k);
  return { img: g.getImageData(0, 0, L, L), x0, y0, s: caixa.s, L };
}
export function dataUrl(img) {
  try {
    if (typeof document === 'undefined') return null;
    const a = document.createElement('canvas'); a.width = img.width; a.height = img.height;
    a.getContext('2d').putImageData(img, 0, 0);
    return a.toDataURL('image/jpeg', 0.82);
  } catch (_) { return null; }
}

/** Espelho efetivo: 'automático' segue a Fonte (ctx.mirrored). */
export function resolverEspelho(v, ctx) {
  if (v === 'sim') return true;
  if (v === 'não') return false;
  return Boolean(ctx && ctx.mirrored);
}
