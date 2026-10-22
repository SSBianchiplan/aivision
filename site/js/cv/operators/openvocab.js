/**
 * cv/operators/openvocab.js — CV-12 Detecção de vocabulário aberto (YOLOE, AGPL-3.0).
 *
 * Dois detectores, os mesmos arquivos de /relacoes/:
 *   yoloe.detect  prompt-free: 4.585 classes embutidas (LVIS + Objects365); acha
 *                 "qualquer coisa" sem lista. Um filtro por texto recorta o que
 *                 interessa ("empilhadeira, capacete").
 *   yoloe.prompt  text-prompt: a LISTA DE CLASSES É ENTRADA DO GRAFO (txt_feats).
 *                 Digite as classes; os vetores vêm do banco de 1.760 nomes
 *                 (MobileCLIP-BLT, fp16) e, para nome fora do banco, do próprio
 *                 codificador de texto MobileCLIP-BLT (127 MB, baixado só então).
 * Saída do grafo: boxes [1,4,A] cxcywh no letterbox, conf [1,A], cls [1,A]
 * (max/argmax já no grafo) — NMS por classe aqui. Ambos publicam ctx.detections.
 */
import { clone } from '../core.js';
import { MODELS, AGPL_MODELS, runFeeds, ensureOrt } from '../runtime/onnx.js';
import { letterbox, toTensorData } from '../runtime/tensor.js';
import { ensure, schedule, nmsBoxes, colorFor, f16ToF32, listaTexto, normalizar } from '../runtime/opkit.js';
import { loadClipTokenizer } from '../runtime/clip_tokenizer.js';

const G = 'CV-12';
const nz = (v) => (Number.isFinite(v) ? v : 0);

// ------------------------------------------------------------- recursos partilhados
let classesPf = null, classesPfP = null;
function ensureClassesPf() {
  if (!classesPfP) classesPfP = fetch(AGPL_MODELS['yoloe-pf'].classes).then((r) => r.json()).then((j) => { classesPf = j; });
}
let bank = null, bankP = null, bankErr = '';
function ensureBank() {
  if (bankP) return;
  const url = AGPL_MODELS['yoloe-text'].bank;
  bankP = fetch(url).then((r) => r.json()).then(async (meta) => {
    const bin = await (await fetch(url.replace(/[^/]+$/, meta.bin))).arrayBuffer();
    const vec = meta.dtype === 'float16' ? f16ToF32(new Uint16Array(bin)) : new Float32Array(bin);
    bank = { names: meta.names, idx: new Map(meta.names.map((n, i) => [normalizar(n), i])), dim: meta.dim, vec };
  }).catch((e) => { bankErr = String(e.message || e); });
}
const textoCache = new Map();
async function encodeClasse(nome, state, ctx) {
  if (textoCache.has(nome)) return textoCache.get(nome);
  if (!ensure('clip-blt-text', state, ctx)) return null;          // baixa só quando precisa
  const tok = await loadClipTokenizer();
  const ort = await ensureOrt();
  const ids = tok.encodeClip(nome, 77);
  const out = await runFeeds('clip-blt-text', { tokens: new ort.Tensor('int32', ids, [1, 77]) });
  const v = Float32Array.from(out[Object.keys(out)[0]].data);
  textoCache.set(nome, v);
  return v;
}

function decode(out, lb, W, H, conf, iouThr, maxDet, allowed) {
  const boxes = out.boxes.data, confs = out.conf.data, cls = out.cls.data, A = confs.length;
  const dets = [];
  for (let a = 0; a < A; a++) {
    const c = confs[a];
    if (c < conf) continue;
    const k = Number(cls[a]);
    if (allowed && !allowed.has(k)) continue;
    const cx = boxes[a], cy = boxes[A + a], bw = boxes[2 * A + a], bh = boxes[3 * A + a];
    dets.push({ x1: cx - bw / 2, y1: cy - bh / 2, x2: cx + bw / 2, y2: cy + bh / 2, score: c, cls: k });
  }
  return nmsBoxes(dets, iouThr, maxDet).map((b) => ({
    x1: Math.max(0, (b.x1 - lb.dx) / lb.scale / W), y1: Math.max(0, (b.y1 - lb.dy) / lb.scale / H),
    x2: Math.min(1, (b.x2 - lb.dx) / lb.scale / W), y2: Math.min(1, (b.y2 - lb.dy) / lb.scale / H),
    score: b.score, cls: b.cls,
  }));
}

function desenhar(ctx, res, p) {
  for (const b of res) {
    const x = b.x1 * ctx.w, y = b.y1 * ctx.h, w = (b.x2 - b.x1) * ctx.w, h = (b.y2 - b.y1) * ctx.h;
    if (!(w > 1 && h > 1)) continue;
    ctx.overlay.push({ type: 'rect', x: nz(x), y: nz(y), w: nz(w), h: nz(h), color: colorFor(b.cls),
                       label: p.showScore ? `${b.name} ${(b.score * 100) | 0}%` : b.name });
  }
  ctx.detections = res.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: b.score, name: b.name }));
  ctx.metrics['objetos'] = res.length;
}

// =============================================================== prompt-free
export const yoloeDetect = {
  op: 'yoloe.detect',
  label: 'YOLOE — Detecta qualquer coisa',
  group: G, model: 'yoloe-pf', agpl: true, overlayOnly: true,
  desc: '4.585 classes embutidas (LVIS + Objects365), sem lista. O filtro por texto ' +
        'mantém só as classes citadas ("forklift, helmet, pallet"), sem retreinar. ' +
        'Nomes em inglês, como no vocabulário do modelo.',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.25, label: 'Confiança' },
    filtro: { type: 'text', default: '', placeholder: 'ex.: person, forklift, helmet (vazio = tudo)', label: 'Só estas classes' },
    maxDet: { type: 'int', min: 1, max: 100, step: 1, default: 30, label: 'Máx. detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
  },
  apply(src, p, state, ctx) {
    ensureClassesPf();
    if (!ensure('yoloe-pf', state, ctx)) return clone(src);
    if (!classesPf) { ctx.metrics['yoloe'] = 'lista de classes…'; return clone(src); }
    const spec = AGPL_MODELS['yoloe-pf'];
    // filtro por nome -> conjunto de ids (recalculado só quando o texto muda)
    if (state.filtroTxt !== p.filtro) {
      state.filtroTxt = p.filtro;
      const quer = listaTexto(p.filtro);
      state.allowed = quer.length ? new Set(classesPf.map((n, i) => [normalizar(n), i]).filter(([n]) => quer.includes(n)).map(([, i]) => i)) : null;
      state.naoAchou = quer.filter((q) => !classesPf.some((n) => normalizar(n) === q));
    }
    schedule(state, p.everyMs,
      () => { const lb = letterbox(src, spec.input[3], spec.input[2]); return { data: toTensorData(lb.data, spec), lb, W: src.width, H: src.height }; },
      async ({ data, lb, W, H }) => {
        const ort = await ensureOrt();
        const out = await runFeeds('yoloe-pf', { images: new ort.Tensor('float32', data, spec.input) }, ['boxes', 'conf', 'cls']);
        return decode(out, lb, W, H, p.conf, 0.5, p.maxDet, state.allowed).map((b) => ({ ...b, name: classesPf[b.cls] || `#${b.cls}` }));
      });
    desenhar(ctx, state.results || [], p);
    if (state.naoAchou && state.naoAchou.length) ctx.metrics['fora do vocabulário'] = state.naoAchou.join(', ');
    if (state.inferMs) ctx.metrics['yoloe ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['yoloe erro'] = state.error;
    return clone(src);
  },
};

// =============================================================== text-prompt
export const yoloePrompt = {
  op: 'yoloe.prompt',
  label: 'YOLOE — Classes por texto',
  group: G, model: 'yoloe-text', agpl: true, overlayOnly: true,
  desc: 'Digite as classes e o detector é re-parametrizado ao vivo: os vetores de ' +
        'texto entram no grafo como txt_feats. 1.760 nomes vêm de um banco pronto; ' +
        'um nome novo baixa o codificador MobileCLIP-BLT (127 MB) uma vez. Inglês.',
  params: {
    classes: { type: 'text', default: 'person, forklift, helmet, box, pallet', placeholder: 'classes separadas por vírgula', label: 'Classes' },
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.15, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 100, step: 1, default: 30, label: 'Máx. detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
  },
  apply(src, p, state, ctx) {
    ensureBank();
    if (bankErr) { ctx.metrics['yoloe banco'] = 'erro: ' + bankErr; return clone(src); }
    if (!ensure('yoloe-text', state, ctx)) return clone(src);
    if (!bank) { ctx.metrics['yoloe'] = 'banco de classes…'; return clone(src); }
    const spec = AGPL_MODELS['yoloe-text'];
    const dim = spec.txtDim || 512;
    // re-parametrização: só quando a lista muda
    if (state.classesTxt !== p.classes && !state.reparam) {
      state.classesTxt = p.classes; state.reparam = true;
      (async () => {
        const nomes = listaTexto(p.classes);
        const vecs = [], kept = [], pend = [];
        for (const n of nomes) {
          const i = bank.idx.get(n);
          if (i !== undefined) { vecs.push(bank.vec.subarray(i * dim, (i + 1) * dim)); kept.push(n); continue; }
          const v = await encodeClasse(n, state, ctx);
          if (v) { vecs.push(v); kept.push(n); } else pend.push(n);
        }
        if (kept.length) {
          const tf = new Float32Array(kept.length * dim);
          vecs.forEach((v, c) => tf.set(v, c * dim));
          state.txtFeats = tf; state.classes = kept;
        }
        state.pendentes = pend;
        // nomes pendentes (codificador ainda baixando): tenta de novo
        if (pend.length) state.classesTxt = null;
      })().finally(() => { state.reparam = false; });
    }
    if (!state.txtFeats) { ctx.metrics['yoloe'] = state.pendentes && state.pendentes.length ? 'codificando: ' + state.pendentes.join(', ') : 'preparando classes…'; return clone(src); }
    schedule(state, p.everyMs,
      () => { const lb = letterbox(src, spec.input[3], spec.input[2]); return { data: toTensorData(lb.data, spec), lb, W: src.width, H: src.height, tf: state.txtFeats, classes: state.classes }; },
      async ({ data, lb, W, H, tf, classes }) => {
        const ort = await ensureOrt();
        const out = await runFeeds('yoloe-text', {
          images: new ort.Tensor('float32', data, spec.input),
          // cópia: o proxy wasm transfere (e esvazia) o buffer; state.txtFeats é reaproveitado
          txt_feats: new ort.Tensor('float32', tf.slice(), [1, classes.length, dim]),
        }, ['boxes', 'conf', 'cls']);
        return decode(out, lb, W, H, p.conf, 0.5, p.maxDet, null).map((b) => ({ ...b, name: classes[b.cls] || `#${b.cls}` }));
      });
    desenhar(ctx, state.results || [], p);
    ctx.metrics['classes ativas'] = (state.classes || []).length + (state.pendentes && state.pendentes.length ? ` (+${state.pendentes.length} codificando)` : '');
    if (state.inferMs) ctx.metrics['yoloe ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['yoloe erro'] = state.error;
    return clone(src);
  },
};

export default [yoloeDetect, yoloePrompt];
