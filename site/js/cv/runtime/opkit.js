/**
 * cv/runtime/opkit.js — o que todo operador com modelo repete: garantir o
 * modelo carregado (com progresso nas métricas), agendar a inferência fora do
 * loop de frames, NMS, cores e o detector de reserva (YOLOX) para operadores
 * que precisam de caixas quando não há detector antes deles na cadeia.
 */
import { MODELS, loadModel, isReady, run, makeTensor, modelStates } from './onnx.js';
import { letterbox, unletterbox, toTensorData, decodeYolox } from './tensor.js';
import { COCO_CLASSES } from './labels.js';

export function ensure(id, state, ctx) {
  if (isReady(id)) return true;
  const k = 'req_' + id;
  if (!state[k]) {
    state[k] = true;
    loadModel(id).catch((err) => { state['err_' + id] = String(err && err.message ? err.message : err); });
  }
  const st = modelStates()[id];
  if (state['err_' + id] || (st && st.status === 'error')) {
    ctx.metrics[id] = 'erro: ' + (state['err_' + id] || st.error);
  } else {
    const pct = Math.round((st ? st.progress : 0) * 100);
    ctx.metrics[id] = pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
  }
  return false;
}

/** Roda `infer` fora do loop de frames, no máximo a cada `minIntervalMs`. */
export function schedule(state, minIntervalMs, prep, infer) {
  const now = performance.now();
  if (state.busy) return;
  if (state.lastStart && now - state.lastStart < minIntervalMs) return;
  let input;
  try { input = prep(); } catch (err) { state.error = String(err.message || err); return; }
  if (!input) return;
  state.busy = true; state.lastStart = now;
  Promise.resolve().then(() => infer(input))
    .then((res) => { state.results = res; state.inferMs = performance.now() - now; state.error = null; })
    .catch((err) => { state.error = String(err && err.message ? err.message : err); })
    .finally(() => { state.busy = false; });
}

export const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
export const PALETTE = ['#FFD84D', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#fb923c',
                        '#f87171', '#34d399', '#60a5fa', '#e879f9'];
export const colorFor = (i) => PALETTE[Math.abs(i | 0) % PALETTE.length];
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return ua > 0 ? inter / ua : 0;
}

/** NMS guloso sobre {x1,y1,x2,y2,score,cls}; por classe quando `porClasse`. */
export function nmsBoxes(dets, iouThr, maxDet, porClasse = true) {
  const ord = dets.slice().sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of ord) {
    let ok = true;
    for (const k of keep) {
      if (porClasse && k.cls !== d.cls) continue;
      if (iou(k, d) > iouThr) { ok = false; break; }
    }
    if (ok) { keep.push(d); if (keep.length >= maxDet) break; }
  }
  return keep;
}

/** fp16 (Uint16) -> Float32 */
export function f16ToF32(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) out[i] = s * Math.pow(2, -14) * (f / 1024);
    else if (e === 31) out[i] = f ? NaN : s * Infinity;
    else out[i] = s * Math.pow(2, e - 15) * (1 + f / 1024);
  }
  return out;
}

/** As caixas do detector anterior na cadeia; sem ele, YOLOX próprio (assíncrono). */
export function detectionsFromCtx(ctx, max) {
  const d = Array.isArray(ctx.detections) && ctx.detections.length ? ctx.detections : null;
  return d ? d.slice(0, max) : null;
}
export async function detectYolox(src, conf, maxDet) {
  const spec = MODELS.yolox;
  const lb = letterbox(src, spec.input[3], spec.input[2]);
  const t = await makeTensor(toTensorData(lb.data, spec), spec.input);
  const out = await run('yolox', t);
  const key = Object.keys(out)[0];
  return decodeYolox(out[key].data, out[key].dims, spec, conf, 0.45, maxDet).map((b) => {
    const u = unletterbox(b, lb);
    return { x1: u.x1 / src.width, y1: u.y1 / src.height, x2: u.x2 / src.width, y2: u.y2 / src.height,
             score: b.score, name: COCO_CLASSES[b.classId] || `#${b.classId}` };
  });
}

/** Amostra bilinear de um mapa `m` (largura W, altura H) em coordenadas contínuas. */
export function bilinear(m, W, H, fx, fy) {
  const x = Math.min(W - 1.001, Math.max(0, fx)), y = Math.min(H - 1.001, Math.max(0, fy));
  const xi = x | 0, yi = y | 0, tx = x - xi, ty = y - yi, i = yi * W + xi;
  return (m[i] * (1 - tx) + m[i + 1] * tx) * (1 - ty) + (m[i + W] * (1 - tx) + m[i + W + 1] * tx) * ty;
}

/** Pinta uma máscara de logits (Wm×Hm, cobrindo o frame inteiro) com borda suave. */
export function paintMask(od, w, h, logit, Wm, Hm, rgb, alpha, region) {
  const kx = Wm / w, ky = Hm / h;
  const x0 = region ? Math.max(0, region.x0) : 0, y0 = region ? Math.max(0, region.y0) : 0;
  const x1 = region ? Math.min(w, region.x1) : w, y1 = region ? Math.min(h, region.y1) : h;
  for (let y = y0; y < y1; y++) {
    const fy = (y + 0.5) * ky - 0.5;
    for (let x = x0; x < x1; x++) {
      const lg = bilinear(logit, Wm, Hm, (x + 0.5) * kx - 0.5, fy);
      const a = Math.min(1, Math.max(0, lg / 2.4 + 0.5));
      if (a <= 0.02) continue;
      const q = (y * w + x) * 4, k = a * alpha;
      od[q] = od[q] * (1 - k) + rgb[0] * k;
      od[q + 1] = od[q + 1] * (1 - k) + rgb[1] * k;
      od[q + 2] = od[q + 2] * (1 - k) + rgb[2] * k;
    }
  }
}

export function normalizar(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
export function listaTexto(s) { return String(s || '').split(/[,;\n]/).map(normalizar).filter(Boolean); }
