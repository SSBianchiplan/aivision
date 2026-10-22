/**
 * cv/operators/relations.js — CV-11 Relações entre objetos (RelateAnything).
 *
 * O modelo NÃO detecta: recebe as caixas de um detector e responde, para cada
 * par, QUAL relação existe — contra um vocabulário de predicados em texto que
 * entra na inferência como dado (matriz W do banco). Aqui o vocabulário são
 * os 35 predicados padrão do checkpoint (models/relate_bank.json), com o
 * gate alpha e o limiar calibrado de cada um.
 *
 * De onde vêm as caixas: do detector que estiver ANTES na cadeia (YOLOX ou
 * YOLO26 publicam `ctx.detections`). Sem detector na cadeia, roda o YOLOX
 * sozinho — o operador funciona colocado direto na câmera.
 *
 * Contrato do score (deploy/postprocess.decode):
 *   s = sigmoid(a · (ℓ_pred + w · ℓ_par) + b), a/b da calibração Platt do
 *   checkpoint; um predicado por par (o melhor), acima do limiar.
 *
 * Fonte: github.com/Maelic/RelateAnything (Apache-2.0), arXiv:2609.12552.
 * Pesos derivados de DINOv3 (licença Meta) — mesmos arquivos de /relacoes/.
 */

import { clone, snapshot } from '../core.js';
import {
  MODELS, loadModel, isReady, run, runFeeds, makeTensor, modelStates, ensureOrt,
} from '../runtime/onnx.js';
import { letterbox, unletterbox, stretch, toTensorData, decodeYolox } from '../runtime/tensor.js';
import { COCO_CLASSES } from '../runtime/labels.js';

const COR_ESPACIAL = '#38bdf8';   // layout: sobre, atrás, ao lado…
const COR_SEMANTICA = '#4ade80';  // conteúdo: vestindo, segurando, montando…
const COR_CAIXA = '#FFD84D';

// ------------------------------------------------------------- banco de predicados
let bank = null, bankPromise = null, bankError = null;
function ensureBank() {
  if (bank || bankPromise) return;
  bankPromise = fetch(MODELS.relate.bank)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} no banco de predicados`); return r.json(); })
    .then((b) => {
      const V = b.names.length, d = b.dim;
      const W = new Float32Array(V * d);
      for (let i = 0; i < V; i++) W.set(b.W[i], i * d);
      bank = { names: b.names, V, dim: d, W, alpha: Float32Array.from(b.alpha),
               thr: b.thr, isSpatial: b.is_spatial, cal: b.calibration || { a: 1, b: 0 },
               size: b.img_size || 448, maxBoxes: b.max_boxes || 32 };
    })
    .catch((err) => { bankError = String(err && err.message ? err.message : err); });
}

function ensure(id, state, ctx) {
  if (isReady(id)) return true;
  if (!state['req_' + id]) {
    state['req_' + id] = true;
    loadModel(id).catch((err) => { state.loadError = String(err && err.message ? err.message : err); });
  }
  const st = modelStates()[id];
  if (state.loadError || (st && st.status === 'error')) {
    ctx.metrics[id] = 'erro: ' + (state.loadError || st.error);
  } else {
    const pct = Math.round((st ? st.progress : 0) * 100);
    ctx.metrics[id] = pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
  }
  return false;
}

function schedule(state, minIntervalMs, prep, infer) {
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

const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Port de deploy/postprocess.decode: melhor predicado por par, acima do limiar. */
function decodeRelations(pred, pair, sub, obj, valid, K, V, dets, p) {
  const { a, b } = bank.cal;
  const w = p.pesoPar;
  const out = [];
  for (let k = 0; k < K; k++) {
    if (!Number(valid[k])) continue;
    const s = Number(sub[k]), o = Number(obj[k]);
    if (s === o || s >= dets.length || o >= dets.length) continue;
    let best = -1, bestScore = 0;
    for (let v = 0; v < V; v++) {
      const score = sigmoid(a * (pred[k * V + v] + w * pair[k]) + b);
      const thr = p.usarLimiarDoBanco ? Math.max(p.limiar, sigmoid(a * Math.log(bank.thr[v] / (1 - bank.thr[v])) + b)) : p.limiar;
      if (score >= thr && score > bestScore) { best = v; bestScore = score; }
    }
    if (best < 0) continue;
    // classificação: o score do par pesa a confiança das duas caixas
    const rank = bestScore * Math.sqrt(Math.max(1e-3, dets[s].score) * Math.max(1e-3, dets[o].score));
    out.push({ s, o, p: best, score: bestScore, rank, spatial: Boolean(bank.isSpatial[best]) });
  }
  out.sort((x, y) => y.rank - x.rank);
  return out.slice(0, p.topK);
}

async function detectarYolox(src, p) {
  const spec = MODELS.yolox;
  const lb = letterbox(src, spec.input[3], spec.input[2]);
  const t = await makeTensor(toTensorData(lb.data, spec), spec.input);
  const out = await run('yolox', t);
  const key = Object.keys(out)[0];
  return decodeYolox(out[key].data, out[key].dims, spec, p.confDet, 0.45, p.maxObj).map((b) => {
    const u = unletterbox(b, lb);
    return { x1: u.x1 / src.width, y1: u.y1 / src.height, x2: u.x2 / src.width, y2: u.y2 / src.height,
             score: b.score, name: COCO_CLASSES[b.classId] || `#${b.classId}` };
  });
}

export const relateGraph = {
  op: 'relate.graph',
  label: 'Relações entre objetos',
  group: 'CV-11',
  model: 'relate',
  overlayOnly: true,
  desc: 'Grafo de cena: para cada par de objetos detectados, a relação mais provável ' +
        'entre 35 predicados (vestindo, segurando, sobre, atrás…). Usa as caixas do ' +
        'detector anterior na cadeia; sem ele, roda o YOLOX. Linhas azuis = relação ' +
        'espacial, verdes = semântica.',
  params: {
    limiar: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.45, label: 'Score mínimo' },
    topK: { type: 'int', min: 1, max: 40, step: 1, default: 12, label: 'Máx. relações' },
    maxObj: { type: 'int', min: 2, max: 32, step: 1, default: 16, label: 'Máx. objetos' },
    pesoPar: { type: 'float', min: 0, max: 2, step: 0.1, default: 1, label: 'Peso "existe relação"' },
    confDet: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.35, label: 'Confiança do YOLOX (sem detector)' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 250, label: 'Intervalo mín. (ms)' },
    usarLimiarDoBanco: { type: 'bool', default: false, label: 'Limiar calibrado por predicado' },
    mostrarCaixas: { type: 'bool', default: true, label: 'Desenhar caixas' },
    mostrarLista: { type: 'bool', default: true, label: 'Listar relações no canto' },
    soSemantica: { type: 'bool', default: false, label: 'Só relações semânticas (ações)' },
  },
  apply(src, p, state, ctx) {
    ensureBank();
    if (bankError) { ctx.metrics['relate banco'] = 'erro: ' + bankError; return clone(src); }
    if (!ensure('relate', state, ctx)) return clone(src);
    if (!bank) { ctx.metrics.relate = 'banco de predicados…'; return clone(src); }
    // caixas: do detector antes na cadeia, senão as nossas (YOLOX)
    const externas = Array.isArray(ctx.detections) && ctx.detections.length ? ctx.detections : null;
    if (!externas && !ensure('yolox', state, ctx)) return clone(src);

    schedule(state, p.everyMs,
      () => {
        const spec = MODELS.relate;
        // redimensionamento simples (anisotrópico), como no treino — sem letterbox
        const img = toTensorData(stretch(src, bank.size, bank.size), spec);
        return { img, dets: externas ? externas.slice(0, Math.min(p.maxObj, bank.maxBoxes)) : null,
                 src: externas ? null : snapshot(src) };
      },
      async ({ img, dets, src: frame }) => {
        const t0 = performance.now();
        if (!dets) dets = (await detectarYolox(frame, p)).slice(0, Math.min(p.maxObj, bank.maxBoxes));
        const tDet = performance.now() - t0;
        if (dets.length < 2) return { dets, trip: [], tDet, tRel: 0 };
        const ort = await ensureOrt();
        const Nmax = bank.maxBoxes, n = dets.length;
        const bx = new Float32Array(Nmax * 4);
        for (let i = 0; i < n; i++) {
          const b = dets[i];
          bx[i * 4] = (b.x1 + b.x2) / 2; bx[i * 4 + 1] = (b.y1 + b.y2) / 2;
          bx[i * 4 + 2] = b.x2 - b.x1; bx[i * 4 + 3] = b.y2 - b.y1;
        }
        const t1 = performance.now();
        const out = await runFeeds('relate', {
          image: new ort.Tensor('float32', img, [1, 3, bank.size, bank.size]),
          boxes: new ort.Tensor('float32', bx, [1, Nmax, 4]),
          box_counts: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
          // cópias: com ort.env.wasm.proxy o buffer de entrada é transferido ao
          // worker e fica com length 0; o banco é reaproveitado em todo run
          W: new ort.Tensor('float32', bank.W.slice(), [bank.V, bank.dim]),
          alpha: new ort.Tensor('float32', bank.alpha.slice(), [bank.V]),
        });
        const K = out.pred_logits.dims[1];
        let trip = decodeRelations(out.pred_logits.data, out.pair_logits.data, out.sub_idx.data,
                                   out.obj_idx.data, out.valid_mask.data, K, bank.V, dets, p);
        if (p.soSemantica) trip = trip.filter((t) => !t.spatial);
        return { dets, trip, tDet, tRel: performance.now() - t1 };
      });

    const r = state.results;
    if (r) {
      const W = ctx.w, H = ctx.h;
      const usados = new Set();
      r.trip.forEach((t) => { usados.add(t.s); usados.add(t.o); });
      if (p.mostrarCaixas) {
        for (const i of usados) {
          const b = r.dets[i];
          ctx.overlay.push({ type: 'rect', x: b.x1 * W, y: b.y1 * H, w: (b.x2 - b.x1) * W, h: (b.y2 - b.y1) * H,
                             color: COR_CAIXA, label: `${i + 1} ${b.name}` });
        }
      }
      for (const t of r.trip) {
        const a = r.dets[t.s], b = r.dets[t.o];
        const ax = (a.x1 + a.x2) / 2 * W, ay = (a.y1 + a.y2) / 2 * H;
        const bxc = (b.x1 + b.x2) / 2 * W, byc = (b.y1 + b.y2) / 2 * H;
        const cor = t.spatial ? COR_ESPACIAL : COR_SEMANTICA;
        ctx.overlay.push({ type: 'line', x1: ax, y1: ay, x2: bxc, y2: byc, color: cor, width: 1.2 + 2.4 * t.score });
        ctx.overlay.push({ type: 'point', x: bxc, y: byc, r: 4, color: cor });
        // o predicado no meio da linha, na cor do tipo
        ctx.overlay.push({ type: 'banner', x: (ax + bxc) / 2 - 30, y: (ay + byc) / 2 - 10,
                           text: bank.names[t.p], color: cor });
      }
      if (p.mostrarLista) {
        r.trip.slice(0, 8).forEach((t, i) => {
          ctx.overlay.push({ type: 'banner', x: 10, y: 10 + i * 22,
                             text: `${r.dets[t.s].name} ${bank.names[t.p]} ${r.dets[t.o].name}  ${t.score.toFixed(2)}`,
                             color: t.spatial ? COR_ESPACIAL : COR_SEMANTICA });
        });
      }
      ctx.relations = r.trip.map((t) => ({ sujeito: r.dets[t.s].name, predicado: bank.names[t.p],
                                            objeto: r.dets[t.o].name, score: t.score, espacial: t.spatial }));
      ctx.metrics['relações'] = r.trip.length;
      ctx.metrics['objetos (rel)'] = r.dets.length + (externas ? ' (da cadeia)' : ' (YOLOX próprio)');
      if (r.tRel) ctx.metrics['relate ms'] = r.tRel.toFixed(0);
      if (r.tDet) ctx.metrics['detect ms (rel)'] = r.tDet.toFixed(0);
    }
    if (state.error) ctx.metrics['relate erro'] = state.error;
    return clone(src);
  },
};

export default [relateGraph];
