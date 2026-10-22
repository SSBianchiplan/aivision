/**
 * Operadores livres — grupo C · CV-24 Modelos treinados livres.
 *
 * Modelos que você treina em /treino/ com motores de licença livre:
 *   - RF-DETR (Roboflow, Apache-2.0): detector de objetos com as suas classes;
 *   - PatchCore (implementação GPlanSiS, Apache-2.0; ResNet-18 torchvision BSD): inspeção de anomalias
 *     treinada só com fotos de peças boas.
 * A lista vem de /models/custom/index.json (o mesmo do CV-16), filtrada pelo campo `arquitetura`.
 * Cada modelo é registrado em MODELS (não AGPL) na hora do uso, como o CV-16 faz com AGPL_MODELS.
 *
 * RF-DETR · entrada [1,3,S,S] esticada (sem letterbox), normalização ImageNet. Saídas "dets" [1,Q,4]
 *   (cx,cy,w,h normalizados na imagem inteira) e "labels" [1,Q,C+1] (logits; sigmoide; a última fatia é o
 *   fundo). Sem NMS no modelo (DETR): uma consulta por objeto; aplicamos um NMS leve só contra duplicatas.
 * PatchCore · entrada [1,3,S,S] esticada, ImageNet. Saídas "mapa" [1,1,S,S] (distância de cada ponto ao
 *   vizinho mais próximo no banco de peças boas) e "nota" [1] (máximo do mapa). nota ≥ limiar = anomalia.
 */
import { clone, alloc } from '../core.js';
import { MODELS, run, makeTensor } from '../runtime/onnx.js';
import { stretch, toTensorData } from '../runtime/tensor.js';
import { ensure, schedule, bilinear, colorFor, nmsBoxes, sigmoid } from '../runtime/opkit.js';

const G = 'CV-24';

export const MODULES_C = [
  {
    id: G,
    name: 'Modelos treinados livres',
    status: 'ready',
    runtime: 'onnx',
    weights: [],
    desc: 'Modelos que você treina em “Treinar modelos” com licença livre: detector RF-DETR (Apache-2.0) ' +
          'com as suas classes, e inspeção de anomalia PatchCore (Apache-2.0) treinada só com fotos de ' +
          'peças boas — mostra o mapa de calor, a nota e OK/REPROVADO.',
  },
];

// ---------------------------------------------------------------- catálogo (/models/custom/index.json)
let catalogo = null;
let carregando = null;

function lerCatalogo() {
  if (!carregando) {
    carregando = fetch('/models/custom/index.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => { catalogo = Array.isArray(l) ? l.slice().sort((a, b) => (b.criado || 0) - (a.criado || 0)) : []; })
      .catch(() => { catalogo = catalogo || []; })
      .finally(() => { setTimeout(() => { carregando = null; }, 30000); });   // relê a cada 30 s
  }
  return catalogo;
}

/** Escolhe o modelo pelo identificador (ou o mais recente da arquitetura). */
function escolher(arquitetura, q) {
  const lista = lerCatalogo();
  if (!lista) return { lista: null, m: null };
  const daArq = lista.filter((x) => x.arquitetura === arquitetura);
  const t = String(q || '').trim();
  const m = t ? daArq.find((x) => x.id === t || x.id.endsWith(t) || x.nome === t) : daArq[0];
  return { lista: daArq, m: m || null };
}

function registrar(m) {
  const id = 'livre:' + m.id;
  const e = m.entrada || {};
  const S = m.imgsz;
  // renomear o treino troca o nome no índice: o rótulo acompanha
  MODELS[id] = Object.assign(MODELS[id] || {}, {
    file: m.arquivo, bytes: m.bytes, name: m.nome, task: m.arquitetura === 'patchcore' ? 'anomaly' : 'detection',
    license: m.licenca || 'Apache-2.0', source: 'GPlanSiS (treinado em /treino/)',
    input: e.forma || [1, 3, S, S], layout: 'nchw', mean: e.media || [0.485, 0.456, 0.406],
    std: e.desvio || [0.229, 0.224, 0.225], scale: e.escala || 1 / 255,
  });
  return id;
}

/** Registra todos os modelos livres treinados em MODELS (para um painel de modelos listar). */
export async function registrarTreinadosLivres() {
  lerCatalogo();
  if (carregando) await carregando.catch(() => {});
  return (catalogo || []).filter((m) => m.arquitetura === 'rfdetr' || m.arquitetura === 'patchcore').map(registrar);
}

function semModelo(ctx, chave, lista, q, tipo) {
  ctx.metrics[chave] = !lista ? 'lendo a lista de modelos…'
    : lista.length ? 'modelo não encontrado: ' + q
    : `nenhum ${tipo} treinado ainda (menu › Treinar modelos)`;
}

/** O operador trocou de modelo: zera o que é do modelo anterior. */
function trocar(state, id) {
  if (state.id === id) return;
  for (const k of Object.keys(state)) delete state[k];
  state.id = id;
}

// ---------------------------------------------------------------- RF-DETR
export const rfdetrTreinado = {
  op: 'livres.rfdetr',
  label: 'Detector treinado (RF-DETR, livre)',
  group: G,
  overlayOnly: true,
  desc: 'Roda um detector RF-DETR que você treinou em “Treinar modelos” (Apache-2.0, sem obrigações ' +
        'de código aberto). Campo Modelo vazio = o mais recente; ou cole o identificador da aba Modelos. ' +
        'Publica ctx.detections para os próximos operadores (tracking, relações, CLIP, profundidade).',
  params: {
    modelo: { type: 'text', default: '', label: 'Modelo (identificador)' },
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.5, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 300, step: 1, default: 50, label: 'Máx. detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
  },
  apply(src, p, state, ctx) {
    const { lista, m } = escolher('rfdetr', p.modelo);
    if (!m) { semModelo(ctx, 'rf-detr', lista, p.modelo, 'detector RF-DETR'); return clone(src); }
    const id = registrar(m);
    trocar(state, id);
    if (!ensure(id, state, ctx)) return clone(src);
    const spec = MODELS[id];
    const S = spec.input[2];
    const nc = m.classes.length;
    const conf = p.conf, maxDet = p.maxDet;
    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, S, S), spec),
      async (data) => {
        const out = await run(id, await makeTensor(data, spec.input));
        const nomes = Object.keys(out);
        // pelo nome; se o export mudar os nomes, pela forma (caixas têm 4 na última dimensão)
        const dets = out.dets || out[nomes.find((k) => out[k].dims[2] === 4)] || out[nomes[0]];
        const lg = out.labels || out[nomes.find((k) => out[k] !== dets)] || out[nomes[1]];
        const Q = dets.dims[1], C1 = lg.dims[2];
        const b = dets.data, l = lg.data;
        const res = [];
        for (let q = 0; q < Q; q++) {
          let best = -Infinity, cls = 0;
          for (let c = 0; c < Math.min(nc, C1 - 1); c++) { const v = l[q * C1 + c]; if (v > best) { best = v; cls = c; } }
          const score = sigmoid(best);
          if (score < conf) continue;
          const cx = b[q * 4], cy = b[q * 4 + 1], w = b[q * 4 + 2], h = b[q * 4 + 3];
          res.push({ x1: Math.max(0, cx - w / 2), y1: Math.max(0, cy - h / 2), x2: Math.min(1, cx + w / 2), y2: Math.min(1, cy + h / 2), score, cls });
        }
        return nmsBoxes(res, 0.7, maxDet, true);
      });

    const res = state.results || [];
    for (const d of res) {
      const name = m.classes[d.cls] || `#${d.cls}`;
      ctx.overlay.push({ type: 'rect', x: d.x1 * ctx.w, y: d.y1 * ctx.h, w: (d.x2 - d.x1) * ctx.w, h: (d.y2 - d.y1) * ctx.h,
        color: colorFor(d.cls), label: p.showScore ? `${name} ${(d.score * 100) | 0}%` : name });
    }
    ctx.detections = res.map((d) => ({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, score: d.score, name: m.classes[d.cls] || `#${d.cls}` }));
    ctx.metrics['modelo'] = m.nome;
    ctx.metrics['objetos'] = res.length;
    if (m.conf_sugerida) ctx.metrics['conf. sugerida no treino'] = m.conf_sugerida;
    if (state.inferMs) ctx.metrics['rf-detr ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['rf-detr erro'] = state.error;
    return clone(src);
  },
};

// ---------------------------------------------------------------- PatchCore
// rampa do mapa de calor: transparente abaixo de ~1/3 do caminho até o limiar, amarelo perto, vermelho acima
const RAMPA = [[34, 211, 238], [74, 222, 128], [255, 216, 77], [251, 146, 60], [239, 68, 68]];
function corCalor(t) {
  const u = Math.min(0.9999, Math.max(0, t)) * (RAMPA.length - 1), i = u | 0, f = u - i;
  const a = RAMPA[i], b = RAMPA[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const patchcoreInspecao = {
  op: 'livres.patchcore',
  label: 'Inspeção de anomalia (PatchCore)',
  group: G,
  desc: 'Compara a imagem com o “banco” de peças boas aprendido em “Treinar modelos” (projeto de ' +
        'anomalia). Pinta o mapa de calor onde a peça foge do normal, mostra a nota e OK/REPROVADO ' +
        'pelo limiar calibrado no treino (ajuste com o fator). Enquadre a peça como nas fotos do treino.',
  params: {
    modelo: { type: 'text', default: '', label: 'Modelo (identificador)' },
    fator: { type: 'float', min: 0.5, max: 2, step: 0.05, default: 1, label: 'Limiar (× calibrado)' },
    modo: { type: 'enum', options: ['mapa de calor', 'só onde passa do limiar', 'só nota'], default: 'mapa de calor', label: 'Mostrar' },
    alpha: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.55, label: 'Opacidade do mapa' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    const { lista, m } = escolher('patchcore', p.modelo);
    if (!m) { semModelo(ctx, 'patchcore', lista, p.modelo, 'modelo de anomalia'); return clone(src); }
    const id = registrar(m);
    trocar(state, id);
    if (!ensure(id, state, ctx)) return clone(src);
    const spec = MODELS[id];
    const S = spec.input[2];
    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, S, S), spec),
      async (data) => {
        const out = await run(id, await makeTensor(data, spec.input));
        const mapa = out.mapa || Object.values(out).find((t) => t.dims.length === 4);
        const nota = out.nota || Object.values(out).find((t) => t.dims.length === 1);
        const d = Float32Array.from(mapa.data);
        let mx = -Infinity;
        if (!nota) for (let i = 0; i < d.length; i++) if (d[i] > mx) mx = d[i];
        return { d, W: mapa.dims[3], H: mapa.dims[2], nota: nota ? nota.data[0] : mx };
      });

    const lim = (m.limiar || 1) * p.fator;
    if (state.inferMs) ctx.metrics['patchcore ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['patchcore erro'] = state.error;
    const R = state.results;
    if (!R) return clone(src);
    const ok = R.nota < lim;
    const { w, h } = ctx;
    ctx.metrics['modelo'] = m.nome;
    ctx.metrics['nota'] = R.nota.toFixed(3);
    ctx.metrics['limiar'] = lim.toFixed(3);
    ctx.metrics['resultado'] = ok ? 'OK' : 'REPROVADO';
    ctx.anomaly = { score: R.nota, threshold: lim, ok, map: R.d, w: R.W, h: R.H, model: m.id };
    ctx.overlay.push({ type: 'banner', x: 10, y: 10,
      text: `${ok ? '✔ OK' : '✖ REPROVADO'} · nota ${R.nota.toFixed(2)} / limiar ${lim.toFixed(2)}`,
      color: ok ? '#4ade80' : '#ef4444' });
    if (p.modo === 'só nota') return clone(src);

    // mapa de calor: 0 no nível típico das peças boas, 1 no limiar
    const lo = Math.min(m.mapa_lo != null ? m.mapa_lo : lim * 0.5, lim * 0.9);
    const span = Math.max(1e-6, lim - lo);
    const so = p.modo === 'só onde passa do limiar';
    const out = alloc(w, h);
    const od = out.data, sd = src.data;
    const kx = R.W / w, ky = R.H / h;
    for (let y = 0; y < h; y++) {
      const fy = (y + 0.5) * ky - 0.5;
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        const t = (bilinear(R.d, R.W, R.H, (x + 0.5) * kx - 0.5, fy) - lo) / span;
        let a = 0, c = null;
        if (so) { if (t >= 1) { a = p.alpha; c = RAMPA[4]; } }
        else if (t > 0.35) { a = p.alpha * Math.min(1, (t - 0.35) / 0.4); c = corCalor((t - 0.35) / 0.75); }
        if (c) {
          od[q] = sd[q] * (1 - a) + c[0] * a; od[q + 1] = sd[q + 1] * (1 - a) + c[1] * a; od[q + 2] = sd[q + 2] * (1 - a) + c[2] * a;
        } else { od[q] = sd[q]; od[q + 1] = sd[q + 1]; od[q + 2] = sd[q + 2]; }
        od[q + 3] = 255;
      }
    }
    return out;
  },
};

export default [rfdetrTreinado, patchcoreInspecao];
