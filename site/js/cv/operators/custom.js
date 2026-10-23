/**
 * CV-16 · Modelos treinados — detectores YOLO26 treinados em /treino/ (serviço na VPS).
 * A lista vem de /models/custom/index.json; cada modelo é registrado no catálogo AGPL do runtime
 * na hora do uso e decodificado como o YOLO26 de fábrica (saída [1,300,6], sem NMS).
 */
import { clone } from '../core.js';
import { AGPL_MODELS, loadModel, isReady, run, makeTensor, modelStates, agplAccepted } from '../runtime/onnx.js';
import { letterbox, toTensorData } from '../runtime/tensor.js';

const G = 'CV-16';
const PALETTE = ['#FFD84D', '#22d3ee', '#4ade80', '#f472b6', '#a78bfa', '#fb923c', '#38bdf8', '#f87171'];
let catalogo = null;          // [{id, nome, classes, imgsz, arquivo, ...}]
let carregando = null;

function lerCatalogo() {
  if (!carregando) {
    carregando = fetch('/models/custom/index.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      // só YOLO26 (sem `arquitetura` = yolo26); RF-DETR e PatchCore são do CV-24 (livres-c.js)
      .then((l) => { catalogo = Array.isArray(l) ? l.filter((m) => !m.arquitetura || m.arquitetura === 'yolo26').sort((a, b) => b.criado - a.criado) : []; })
      .catch(() => { catalogo = []; })
      .finally(() => { setTimeout(() => { carregando = null; }, 30000); });   // relê a cada 30 s
  }
  return catalogo;
}

function registrar(m) {
  const id = 'custom:' + m.id;
  if (!AGPL_MODELS[id]) {
    AGPL_MODELS[id] = {
      file: m.arquivo, bytes: m.bytes, name: m.nome, task: 'detection', license: 'AGPL-3.0', source: 'GPlanSiS (treinado)',
      agpl: true, input: [1, 3, m.imgsz, m.imgsz], layout: 'nchw', mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
      stride: 6, endToEnd: true, classes: m.classes.length,
    };
  }
  return id;
}

/** Registra todos os modelos treinados no catálogo AGPL (usado pelo painel Modelos). */
export async function registrarTreinados() {
  lerCatalogo();
  if (carregando) await carregando.catch(() => {});
  return (catalogo || []).map(registrar);
}

export const customDetect = {
  op: 'custom.detect',
  label: 'Modelo treinado (GPlanSiS)',
  group: G,
  agpl: true,
  overlayOnly: true,
  desc: 'Roda um detector que você treinou em “Treinar modelos” (menu). Campo Modelo vazio = o ' +
        'mais recente; ou cole o identificador da aba Modelos. Publica ctx.detections para os ' +
        'próximos operadores (tracking, relações, CLIP).',
  params: {
    modelo: { type: 'text', default: '', label: 'Modelo (identificador)' },
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.4, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 300, step: 1, default: 50, label: 'Máx. detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
  },
  apply(src, p, state, ctx) {
    if (!agplAccepted()) { ctx.metrics['treinado'] = 'bloqueado: licença AGPL não aceita'; return clone(src); }
    const lista = lerCatalogo();
    if (!lista) { ctx.metrics['treinado'] = 'lendo a lista de modelos…'; return clone(src); }
    const q = String(p.modelo || '').trim();
    const m = q ? lista.find((x) => x.id === q || x.id.endsWith(q)) : lista[0];
    if (!m) { ctx.metrics['treinado'] = lista.length ? 'modelo não encontrado: ' + q : 'nenhum modelo treinado ainda (menu › Treinar)'; return clone(src); }
    const id = registrar(m);
    if (state.id !== id) { Object.assign(state, { id, requested: false, loadError: null, results: null }); }
    if (!isReady(id)) {
      if (!state.requested) { state.requested = true; loadModel(id).catch((e) => { state.loadError = String(e.message || e); }); }
      const st = modelStates()[id]; const pc = Math.round((st ? st.progress : 0) * 100);
      ctx.metrics['treinado'] = state.loadError ? 'erro: ' + state.loadError : pc > 0 && pc < 100 ? `baixando ${pc}%` : 'carregando…';
      return clone(src);
    }
    const spec = AGPL_MODELS[id]; const S = spec.input[2]; const now = performance.now();
    if (!state.busy && !(state.last && now - state.last < p.everyMs)) {
      state.busy = true; state.last = now;
      const lb = letterbox(src, S, S); const w = src.width, h = src.height;
      const tCap = Number.isFinite(ctx.tQuadro) ? ctx.tQuadro : now;   // carimbo (sincronia, ver executor)
      Promise.resolve().then(async () => {
        const out = await run(id, await makeTensor(toTensorData(lb.data, spec), spec.input));
        const d = out[Object.keys(out)[0]].data; const res = [];
        for (let i = 0; i < 300 && res.length < p.maxDet; i++) {
          const o = i * 6; if (d[o + 4] < p.conf) break;
          res.push({ x1: ((d[o] - lb.dx) / lb.scale) / w, y1: ((d[o + 1] - lb.dy) / lb.scale) / h, x2: ((d[o + 2] - lb.dx) / lb.scale) / w, y2: ((d[o + 3] - lb.dy) / lb.scale) / h, score: d[o + 4], cls: Math.round(d[o + 5]) });
        }
        state.results = res; state.resultsT = tCap; state.ms = performance.now() - now; state.error = null;
      }).catch((e) => { state.error = String(e && e.message ? e.message : e); }).finally(() => { state.busy = false; });
    }
    const res = state.results || [];
    for (const b of res) {
      const name = m.classes[b.cls] || `#${b.cls}`;
      ctx.overlay.push({ type: 'rect', x: b.x1 * ctx.w, y: b.y1 * ctx.h, w: (b.x2 - b.x1) * ctx.w, h: (b.y2 - b.y1) * ctx.h,
        color: PALETTE[b.cls % PALETTE.length], label: p.showScore ? `${name} ${(b.score * 100) | 0}%` : name });
    }
    ctx.detections = res.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: b.score, name: m.classes[b.cls] || `#${b.cls}` }));
    ctx.metrics['modelo'] = m.nome; ctx.metrics['objetos'] = res.length;
    if (state.ms) ctx.metrics['ms'] = state.ms.toFixed(0);
    if (state.error) ctx.metrics['erro'] = state.error;
    return clone(src);
  },
};

export default [customDetect];
