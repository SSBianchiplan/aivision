/**
 * cv/operators/yolo26.js — CV-09 Ultralytics YOLO26 (AGPL-3.0, opcional).
 *
 * ================== POR QUE ESTE ARQUIVO É SEPARADO ==================
 *
 * Estes pesos são AGPL-3.0. O código aqui só EXECUTA se o usuário aceitar as
 * obrigações da licença em Modelos › YOLO26. Manter os operadores num arquivo
 * próprio, com os pesos numa pasta própria, deixa a fronteira de licença
 * fisicamente visível — em vez de espalhada por um catálogo misto.
 *
 * O caminho padrão do sistema continua no YOLOX-S (Apache-2.0).
 * =====================================================================
 *
 * A boa notícia técnica: YOLO26 é END-TO-END. A saída já vem com 300
 * detecções decodificadas, em pixels do input e ordenadas por score — sem
 * grade de âncoras, sem exponencial de w/h, sem NMS. O decode que no YOLOX
 * ocupa 40 linhas aqui vira um laço com break antecipado.
 */

import { clone, alloc } from '../core.js';
import {
  AGPL_MODELS, loadModel, isReady, run, makeTensor, modelStates, agplAccepted,
} from '../runtime/onnx.js';
import { letterbox, stretch, toTensorData, softmax, topK } from '../runtime/tensor.js';
import { COCO_CLASSES, loadImagenetLabels } from '../runtime/labels.js';

const G = 'CV-09';

/** COCO-17: nomes e esqueleto, para o operador de pose. */
const COCO_SKELETON = [
  [15, 13], [13, 11], [16, 14], [14, 12], [11, 12],
  [5, 11], [6, 12], [5, 6], [5, 7], [6, 8], [7, 9], [8, 10],
  [1, 2], [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6],
];

/** DOTAv1-15, na ordem dos metadados do modelo de caixas orientadas (imagens aéreas). */
const DOTA_CLASSES = [
  'avião', 'navio', 'tanque de armazenamento', 'campo de beisebol', 'quadra de tênis',
  'quadra de basquete', 'pista de atletismo', 'porto', 'ponte', 'veículo grande',
  'veículo pequeno', 'helicóptero', 'rotatória', 'campo de futebol', 'piscina',
];

/** Cityscapes-19, do modelo de segmentação semântica. */
const CITYSCAPES = [
  'estrada', 'calçada', 'prédio', 'muro', 'cerca', 'poste', 'semáforo',
  'placa', 'vegetação', 'terreno', 'céu', 'pessoa', 'ciclista', 'carro',
  'caminhão', 'ônibus', 'trem', 'moto', 'bicicleta',
];
const CITY_COLORS = [
  [128, 64, 128], [244, 35, 232], [70, 70, 70], [102, 102, 156], [190, 153, 153],
  [153, 153, 153], [250, 170, 30], [220, 220, 0], [107, 142, 35], [152, 251, 152],
  [70, 130, 180], [220, 20, 60], [255, 0, 0], [0, 0, 142], [0, 0, 70],
  [0, 60, 100], [0, 80, 100], [0, 0, 230], [119, 11, 32],
];

// ------------------------------------------------------------ infra

function ensure(id, state, ctx) {
  if (!agplAccepted()) {
    ctx.metrics['yolo26'] = 'bloqueado: licença AGPL não aceita';
    return false;
  }
  if (isReady(id)) return true;
  // um pedido por modelo (o tracking usa dois: yolo26n + re-ID)
  const k = 'req_' + id, ke = 'err_' + id;
  if (!state[k]) {
    state[k] = true;
    loadModel(id).catch((e) => { state[ke] = String(e.message || e); });
  }
  const st = modelStates()[id];
  const pct = Math.round((st ? st.progress : 0) * 100);
  ctx.metrics['yolo26'] = state[ke] ? 'erro: ' + state[ke]
    : pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
  return false;
}

function schedule(state, minMs, prep, infer) {
  const now = performance.now();
  if (state.busy) return;
  if (state.lastStart && now - state.lastStart < minMs) return;
  let input;
  try { input = prep(); } catch (e) { state.error = String(e.message || e); return; }
  if (!input) return;
  state.busy = true;
  state.lastStart = now;
  Promise.resolve().then(() => infer(input))
    .then((r) => { state.results = r; state.inferMs = performance.now() - now; state.error = null; })
    .catch((e) => { state.error = String(e && e.message ? e.message : e); })
    .finally(() => { state.busy = false; });
}

function copyOf(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/**
 * Decode end-to-end: a saída já vem ordenada por score, então o `break` no
 * primeiro abaixo do limiar economiza o resto do laço.
 */
function decodeRows(data, count, stride, conf) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    const score = data[o + 4];
    if (score < conf) break;
    rows.push({ o, score, cls: Math.round(data[o + 5]) });
  }
  return rows;
}

const PALETTE = ['#FFD84D', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#fb923c'];
const colorFor = (i) => PALETTE[i % PALETTE.length];
const sigmoid = (v) => 1 / (1 + Math.exp(-v));

// =============================================================== detecção

export const y26detect = {
  op: 'yolo26.detect',
  label: 'YOLO26 — Detecção',
  group: G,
  model: 'yolo26n',
  agpl: true,
  overlayOnly: true,
  desc: 'Detecção end-to-end nas 80 classes COCO. Saída já decodificada e ' +
        'ordenada, sem NMS. AGPL-3.0.',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.35, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 300, step: 1, default: 50, label: 'Máx. detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n', state, ctx)) return clone(src);
    const spec = AGPL_MODELS['yolo26n'];
    const S = spec.input[2];

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, S, S);
        return { data: toTensorData(lb.data, spec), lb, w: src.width, h: src.height };
      },
      async ({ data, lb, w, h }) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n', t);
        const d = out[Object.keys(out)[0]].data;
        return decodeRows(d, 300, spec.stride, p.conf).slice(0, p.maxDet).map((r) => ({
          x1: ((d[r.o] - lb.dx) / lb.scale) / w,
          y1: ((d[r.o + 1] - lb.dy) / lb.scale) / h,
          x2: ((d[r.o + 2] - lb.dx) / lb.scale) / w,
          y2: ((d[r.o + 3] - lb.dy) / lb.scale) / h,
          score: r.score, cls: r.cls,
        }));
      });

    const res = state.results || [];
    for (const b of res) {
      const name = COCO_CLASSES[b.cls] || `#${b.cls}`;
      ctx.overlay.push({
        type: 'rect',
        x: b.x1 * ctx.w, y: b.y1 * ctx.h,
        w: (b.x2 - b.x1) * ctx.w, h: (b.y2 - b.y1) * ctx.h,
        color: colorFor(b.cls),
        label: p.showScore ? `${name} ${(b.score * 100) | 0}%` : name,
      });
    }
    ctx.detections = res.map((b) => ({
      x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: b.score,
      name: COCO_CLASSES[b.cls] || `#${b.cls}`,
    }));
    ctx.metrics['objetos'] = res.length;
    if (state.inferMs) ctx.metrics['y26 ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['y26 erro'] = state.error;
    return clone(src);
  },
};

// =============================================================== instâncias

export const y26segment = {
  op: 'yolo26.segment',
  label: 'YOLO26 — Instâncias',
  group: G,
  model: 'yolo26n-seg',
  agpl: true,
  desc: 'Segmentação de INSTÂNCIAS nas 80 classes: cada objeto ganha máscara ' +
        'própria. A máscara sai do produto dos 32 coeficientes pelos protótipos ' +
        '32×160×160. É o que o PP-HumanSeg não faz (ele só separa pessoa/fundo).',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.4, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 30, step: 1, default: 10, label: 'Máx. instâncias' },
    alpha: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.5, label: 'Opacidade' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n-seg', state, ctx)) return clone(src);
    const spec = AGPL_MODELS['yolo26n-seg'];
    const S = spec.input[2], P = spec.protoSize, NC = spec.maskCoeffs;

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, S, S);
        return { data: toTensorData(lb.data, spec), lb };
      },
      async ({ data, lb }) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n-seg', t);
        const keys = Object.keys(out);
        // [1,300,38] é o de rank 3; [1,32,160,160] é o de rank 4
        const detKey = keys.find((k) => out[k].dims.length === 3);
        const protoKey = keys.find((k) => out[k].dims.length === 4);
        const d = out[detKey].data;
        const proto = out[protoKey].data;

        const rows = decodeRows(d, 300, spec.stride, p.conf).slice(0, p.maxDet);
        const insts = [];
        for (const r of rows) {
          // Logits CONTÍNUOS (coefs · protótipos) no espaço 160×160, sem
          // binarizar aqui: a decisão fica para a hora de desenhar, com
          // interpolação bilinear — é o que tira o serrilhado de 4 px.
          // Recortados pela caixa (como no pós-processo do Ultralytics): o
          // protótipo "vaza" para fora do objeto, e a caixa é o limite dele.
          const logit = new Float32Array(P * P).fill(-30);
          const k = P / S;
          const x0 = Math.max(0, Math.floor(d[r.o] * k)), y0 = Math.max(0, Math.floor(d[r.o + 1] * k));
          const x1 = Math.min(P, Math.ceil(d[r.o + 2] * k)), y1 = Math.min(P, Math.ceil(d[r.o + 3] * k));
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              let acc = 0;
              const pi = y * P + x;
              for (let c = 0; c < NC; c++) acc += d[r.o + 6 + c] * proto[c * P * P + pi];
              logit[pi] = acc;
            }
          }
          insts.push({
            logit,
            box: [d[r.o], d[r.o + 1], d[r.o + 2], d[r.o + 3]],
            score: r.score, cls: r.cls,
          });
        }
        return { insts, lb };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['seg ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['seg erro'] = state.error;
    if (!R || !R.insts.length) {
      ctx.metrics['instâncias'] = 0;
      return clone(src);
    }

    const { w, h } = ctx;
    const out = alloc(w, h);
    out.data.set(src.data);
    const od = out.data;
    const { lb } = R;

    // amostragem bilinear do logit no espaço do protótipo; borda suave em
    // ~1,5 células — o contorno acompanha o objeto em vez dos blocos
    const amostra = (lg, mx, my) => {
      const fx = Math.min(P - 1.001, Math.max(0, mx - 0.5)), fy = Math.min(P - 1.001, Math.max(0, my - 0.5));
      const xi = fx | 0, yi = fy | 0, tx = fx - xi, ty = fy - yi;
      const i00 = yi * P + xi;
      const a = lg[i00] * (1 - tx) + lg[i00 + 1] * tx;
      const b = lg[i00 + P] * (1 - tx) + lg[i00 + P + 1] * tx;
      return a * (1 - ty) + b * ty;
    };
    const kx = (src.width * lb.scale) * (P / S) / w, ky = (src.height * lb.scale) * (P / S) / h;
    const ox = lb.dx * (P / S), oy = lb.dy * (P / S);

    R.insts.forEach((inst, idx) => {
      // cor por INSTÂNCIA: duas camas ou dois cachorros não podem sair iguais
      const col = hexToRgb(colorFor(idx));
      // só a região da caixa (com 2% de folga), não o frame inteiro
      const bx0 = Math.max(0, (((inst.box[0] - lb.dx) / lb.scale / src.width) * w - 2) | 0);
      const by0 = Math.max(0, (((inst.box[1] - lb.dy) / lb.scale / src.height) * h - 2) | 0);
      const bx1 = Math.min(w, (((inst.box[2] - lb.dx) / lb.scale / src.width) * w + 3) | 0);
      const by1 = Math.min(h, (((inst.box[3] - lb.dy) / lb.scale / src.height) * h + 3) | 0);
      for (let y = by0; y < by1; y++) {
        const my = y * ky + oy;
        for (let x = bx0; x < bx1; x++) {
          const lg = amostra(inst.logit, x * kx + ox, my);
          // sigmoid(lg) > 0,5 é a fronteira; a rampa de ±1,2 no logit vira
          // anti-serrilhado: meio pixel de transição em vez de degrau
          const a = Math.min(1, Math.max(0, lg / 2.4 + 0.5));
          if (a <= 0.02) continue;
          const q = (y * w + x) * 4, k = a * p.alpha;
          od[q] = od[q] * (1 - k) + col[0] * k;
          od[q + 1] = od[q + 1] * (1 - k) + col[1] * k;
          od[q + 2] = od[q + 2] * (1 - k) + col[2] * k;
        }
      }
      // contorno da caixa por cima, com o rótulo
      const bx = (inst.box[0] - lb.dx) / lb.scale / src.width;
      const by = (inst.box[1] - lb.dy) / lb.scale / src.height;
      const bw = (inst.box[2] - inst.box[0]) / lb.scale / src.width;
      const bh = (inst.box[3] - inst.box[1]) / lb.scale / src.height;
      ctx.overlay.push({
        type: 'rect',
        x: bx * w, y: by * h, w: bw * w, h: bh * h,
        color: colorFor(idx),
        label: `${COCO_CLASSES[inst.cls] || inst.cls} ${(inst.score * 100) | 0}%`,
      });
    });
    ctx.metrics['instâncias'] = R.insts.length;
    return out;
  },
};

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// =============================================================== pose

export const y26pose = {
  op: 'yolo26.pose',
  label: 'YOLO26 — Pose',
  group: G,
  model: 'yolo26n-pose',
  agpl: true,
  overlayOnly: true,
  desc: 'Pose COCO de 17 keypoints, MULTI-PESSOA e em um estágio só — ' +
        'diferente do BlazePose, que precisa do recorte de uma pessoa.',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.4, label: 'Confiança' },
    kptConf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.3, label: 'Confiança do ponto' },
    maxDet: { type: 'int', min: 1, max: 20, step: 1, default: 6, label: 'Máx. pessoas' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n-pose', state, ctx)) return clone(src);
    const spec = AGPL_MODELS['yolo26n-pose'];
    const S = spec.input[2];

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, S, S);
        return { data: toTensorData(lb.data, spec), lb, w: src.width, h: src.height };
      },
      async ({ data, lb, w, h }) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n-pose', t);
        const d = out[Object.keys(out)[0]].data;
        const un = (v, off, s) => ((v - off) / lb.scale) / s;
        return decodeRows(d, 300, spec.stride, p.conf).slice(0, p.maxDet).map((r) => {
          const kpts = [];
          for (let k = 0; k < spec.keypoints; k++) {
            const o = r.o + 6 + k * 3;
            kpts.push({ x: un(d[o], lb.dx, w), y: un(d[o + 1], lb.dy, h), c: d[o + 2] });
          }
          return {
            x1: un(d[r.o], lb.dx, w), y1: un(d[r.o + 1], lb.dy, h),
            x2: un(d[r.o + 2], lb.dx, w), y2: un(d[r.o + 3], lb.dy, h),
            score: r.score, kpts,
          };
        });
      });

    const res = state.results || [];
    let pts = 0;
    for (const pr of res) {
      for (const [a, b] of COCO_SKELETON) {
        const p1 = pr.kpts[a], p2 = pr.kpts[b];
        if (!p1 || !p2 || p1.c < p.kptConf || p2.c < p.kptConf) continue;
        ctx.overlay.push({
          type: 'line',
          x1: p1.x * ctx.w, y1: p1.y * ctx.h,
          x2: p2.x * ctx.w, y2: p2.y * ctx.h,
          color: '#22d3ee', width: 2,
        });
      }
      for (const k of pr.kpts) {
        if (k.c < p.kptConf) continue;
        pts++;
        ctx.overlay.push({ type: 'point', x: k.x * ctx.w, y: k.y * ctx.h, r: 3, color: '#FFD84D' });
      }
    }
    ctx.metrics['pessoas'] = res.length;
    ctx.metrics['keypoints'] = pts;
    if (state.inferMs) ctx.metrics['pose ms'] = state.inferMs.toFixed(0);
    return clone(src);
  },
};

// =============================================================== OBB

export const y26obb = {
  op: 'yolo26.obb',
  label: 'YOLO26 — Caixas orientadas',
  group: G,
  model: 'yolo26n-obb',
  agpl: true,
  overlayOnly: true,
  desc: 'Caixas com ÂNGULO (15 classes DOTA, imagens aéreas). Entrada 1024² — ' +
        'o operador mais pesado do conjunto.',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.35, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 50, step: 1, default: 20, label: 'Máx. objetos' },
    everyMs: { type: 'int', min: 200, max: 5000, step: 100, default: 1000, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n-obb', state, ctx)) return clone(src);
    const spec = AGPL_MODELS['yolo26n-obb'];
    const S = spec.input[2];

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, S, S);
        return { data: toTensorData(lb.data, spec), lb, w: src.width, h: src.height };
      },
      async ({ data, lb, w, h }) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n-obb', t);
        const d = out[Object.keys(out)[0]].data;
        const rows = [];
        for (let i = 0; i < 300; i++) {
          const o = i * spec.stride;
          const score = d[o + 4];   // saída: cx,cy,w,h,score,classe,ângulo
          if (score < p.conf) break;
          rows.push({
            cx: ((d[o] - lb.dx) / lb.scale) / w,
            cy: ((d[o + 1] - lb.dy) / lb.scale) / h,
            bw: (d[o + 2] / lb.scale) / w,
            bh: (d[o + 3] / lb.scale) / h,
            angle: d[o + 6],
            score, cls: Math.round(d[o + 5]),
          });
          if (rows.length >= p.maxDet) break;
        }
        return rows;
      });

    for (const b of state.results || []) {
      // 4 cantos girados pelo ângulo, desenhados como 4 linhas
      const cx = b.cx * ctx.w, cy = b.cy * ctx.h;
      const hw = (b.bw * ctx.w) / 2, hh = (b.bh * ctx.h) / 2;
      const c = Math.cos(b.angle), s = Math.sin(b.angle);
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
        .map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
      for (let i = 0; i < 4; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % 4];
        ctx.overlay.push({ type: 'line', x1, y1, x2, y2, color: colorFor(b.cls), width: 2 });
      }
      ctx.overlay.push({
        type: 'rect', x: pts[0][0], y: pts[0][1], w: 0.01, h: 0.01,
        color: colorFor(b.cls),
        label: `${DOTA_CLASSES[b.cls] || b.cls} ${(b.score * 100) | 0}%`,
      });
    }
    ctx.metrics['obb'] = (state.results || []).length;
    if (state.inferMs) ctx.metrics['obb ms'] = state.inferMs.toFixed(0);
    return clone(src);
  },
};

// =============================================================== classificação

export const y26classify = {
  op: 'yolo26.classify',
  label: 'YOLO26 — Classificação',
  group: G,
  model: 'yolo26n-cls',
  agpl: true,
  overlayOnly: true,
  desc: 'Classificação ImageNet (1000 classes), entrada 224².',
  params: {
    topk: { type: 'int', min: 1, max: 5, step: 1, default: 3, label: 'Top-k' },
    everyMs: { type: 'int', min: 100, max: 3000, step: 100, default: 400, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n-cls', state, ctx)) return clone(src);
    if (!state.labels) {
      state.labels = [];
      loadImagenetLabels().then((l) => { state.labels = l; });
    }
    const spec = AGPL_MODELS['yolo26n-cls'];

    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, spec.input[3], spec.input[2]), spec),
      async (data) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n-cls', t);
        const raw = out[Object.keys(out)[0]].data;
        // a cabeça de classificação do YOLO26 já sai normalizada; softmax é idempotente o bastante
        const sum = raw.reduce((a, b) => a + b, 0);
        const probs = Math.abs(sum - 1) < 0.05 ? raw : softmax(raw);
        return topK(probs, 5);
      });

    (state.results || []).slice(0, p.topk).forEach((r, i) => {
      ctx.overlay.push({
        type: 'banner', x: 8, y: 8 + i * 20,
        text: `${state.labels[r.index] || 'classe ' + r.index}  ${(r.score * 100).toFixed(1)}%`,
        color: i === 0 ? '#FFD84D' : '#8b8b93',
      });
    });
    if (state.inferMs) ctx.metrics['cls ms'] = state.inferMs.toFixed(0);
    return clone(src);
  },
};

// =============================================================== semântica

export const y26semantic = {
  op: 'yolo26.semantic',
  label: 'YOLO26 — Semântica',
  group: G,
  model: 'yolo26n-sem',
  agpl: true,
  desc: 'Segmentação semântica Cityscapes (19 classes: estrada, prédio, ' +
        'pessoa, carro…). Cada pixel recebe uma classe. Entrada 1024².',
  params: {
    alpha: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.55, label: 'Opacidade' },
    everyMs: { type: 'int', min: 200, max: 5000, step: 100, default: 900, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n-sem', state, ctx)) return clone(src);
    const spec = AGPL_MODELS['yolo26n-sem'];
    const S = spec.input[2];

    schedule(state, p.everyMs,
      () => ({ data: toTensorData(stretch(src, S, S), spec) }),
      async ({ data }) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n-sem', t);
        const o = out[Object.keys(out)[0]];
        return { map: o.data, size: o.dims[o.dims.length - 1] };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['sem ms'] = state.inferMs.toFixed(0);
    if (!R) return clone(src);

    const { w, h } = ctx;
    const out = alloc(w, h);
    const s = src.data, od = out.data;
    const M = R.size;
    const seen = new Set();
    for (let y = 0; y < h; y++) {
      const my = Math.min(M - 1, ((y * M) / h) | 0) * M;
      for (let x = 0; x < w; x++) {
        const cls = Math.round(R.map[my + Math.min(M - 1, ((x * M) / w) | 0)]);
        const col = CITY_COLORS[cls] || [0, 0, 0];
        seen.add(cls);
        const q = (y * w + x) * 4;
        od[q] = s[q] * (1 - p.alpha) + col[0] * p.alpha;
        od[q + 1] = s[q + 1] * (1 - p.alpha) + col[1] * p.alpha;
        od[q + 2] = s[q + 2] * (1 - p.alpha) + col[2] * p.alpha;
        od[q + 3] = 255;
      }
    }
    ctx.metrics['classes'] = Array.from(seen).slice(0, 4)
      .map((c) => CITYSCAPES[c] || c).join(', ');
    return out;
  },
};

// =============================================================== profundidade

export const y26depth = {
  op: 'yolo26.depth',
  label: 'YOLO26 — Profundidade',
  group: G,
  model: 'yolo26n-depth',
  agpl: true,
  desc: 'Profundidade monocular: estima distância a partir de UMA câmera, sem ' +
        'estéreo. Saída em mapa de cor, normalizada por frame.',
  params: {
    map: { type: 'enum', options: ['turbo', 'cinza', 'inferno'], default: 'turbo', label: 'Mapa' },
    invert: { type: 'bool', default: false, label: 'Inverter' },
    everyMs: { type: 'int', min: 200, max: 5000, step: 100, default: 700, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolo26n-depth', state, ctx)) return clone(src);
    const spec = AGPL_MODELS['yolo26n-depth'];
    const S = spec.input[2];

    schedule(state, p.everyMs,
      () => ({ data: toTensorData(stretch(src, S, S), spec) }),
      async ({ data }) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('yolo26n-depth', t);
        const o = out[Object.keys(out)[0]];
        const d = o.data;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < d.length; i++) {
          if (d[i] < lo) lo = d[i];
          if (d[i] > hi) hi = d[i];
        }
        return { map: d, size: o.dims[o.dims.length - 1], lo, hi };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['depth ms'] = state.inferMs.toFixed(0);
    if (!R) return clone(src);

    const { w, h } = ctx;
    const out = alloc(w, h);
    const od = out.data;
    const M = R.size;
    const range = (R.hi - R.lo) || 1;
    for (let y = 0; y < h; y++) {
      const my = Math.min(M - 1, ((y * M) / h) | 0) * M;
      for (let x = 0; x < w; x++) {
        let t = (R.map[my + Math.min(M - 1, ((x * M) / w) | 0)] - R.lo) / range;
        if (p.invert) t = 1 - t;
        const [r, g, b] = depthColor(t, p.map);
        const q = (y * w + x) * 4;
        od[q] = r; od[q + 1] = g; od[q + 2] = b; od[q + 3] = 255;
      }
    }
    ctx.metrics['depth'] = `${R.lo.toFixed(2)} … ${R.hi.toFixed(2)}`;
    return out;
  },
};

function depthColor(t, name) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (name === 'cinza') { const v = t * 255; return [v, v, v]; }
  if (name === 'inferno') {
    return [
      Math.min(255, t * 340),
      Math.max(0, (t - 0.35) * 300),
      Math.max(0, (t - 0.75) * 700),
    ];
  }
  // turbo aproximado
  return [
    Math.max(0, Math.min(255, 255 * (1.4 - Math.abs(3.2 * t - 2.4)))),
    Math.max(0, Math.min(255, 255 * (1.3 - Math.abs(2.8 * t - 1.4)))),
    Math.max(0, Math.min(255, 255 * (1.4 - Math.abs(3.2 * t - 0.7)))),
  ];
}

// =============================================================== re-ID / tracking

export const y26track = {
  op: 'yolo26.track',
  label: 'YOLO26 — Tracking (re-ID)',
  group: G,
  model: 'yolo26n-reid',
  needs: ['yolo26n'],
  agpl: true,
  overlayOnly: true,
  desc: 'Detecção + re-identificação por aparência: cada objeto recebe um ID ' +
        'que PERSISTE entre frames, e sobrevive a oclusão curta — o embedding ' +
        'de 512-d reencontra o objeto quando ele reaparece, coisa que ' +
        'associação só por posição não faz.',
  params: {
    conf: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.45, label: 'Confiança' },
    maxTrack: { type: 'int', min: 1, max: 8, step: 1, default: 4, label: 'Máx. rastreados' },
    simMin: { type: 'float', min: 0.3, max: 0.98, step: 0.02, default: 0.72, label: 'Similaridade mín.' },
    ttl: { type: 'int', min: 1, max: 90, step: 1, default: 30, label: 'Sobrevida (frames)' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 120, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    // O yolo26n-reid nao exporta na versao atual do ultralytics (ReidModel ausente):
    // o tracking com IDs do hub e' o track.bytetrack (CV-04), sem modelo.
    ctx.metrics['yolo26 track'] = 'indisponível — use "Tracking com IDs (ByteTrack)" em CV-04 depois de um detector';
    return clone(src);
  },
  applyOriginal(src, p, state, ctx) {
    if (!ensure('yolo26n', state, ctx)) return clone(src);
    if (!ensure('yolo26n-reid', state, ctx)) return clone(src);
    const det = AGPL_MODELS['yolo26n'];
    const rid = AGPL_MODELS['yolo26n-reid'];
    const S = det.input[2];
    const RS = rid.input[2];

    if (!state.tracks) { state.tracks = []; state.nextId = 1; }

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, S, S);
        return {
          data: toTensorData(lb.data, det),
          lb, frame: copyOf(src), w: src.width, h: src.height,
        };
      },
      async ({ data, lb, frame, w, h }) => {
        const t = await makeTensor(data, det.input);
        const out = await run('yolo26n', t);
        const d = out[Object.keys(out)[0]].data;
        const rows = decodeRows(d, 300, det.stride, p.conf).slice(0, p.maxTrack);

        // embedding de aparência por caixa
        const obs = [];
        for (const r of rows) {
          const x1 = Math.max(0, (d[r.o] - lb.dx) / lb.scale);
          const y1 = Math.max(0, (d[r.o + 1] - lb.dy) / lb.scale);
          const x2 = Math.min(w, (d[r.o + 2] - lb.dx) / lb.scale);
          const y2 = Math.min(h, (d[r.o + 3] - lb.dy) / lb.scale);
          if (x2 - x1 < 8 || y2 - y1 < 8) continue;

          const crop = cropTo(frame, x1, y1, x2 - x1, y2 - y1, RS, RS);
          const rt = await makeTensor(toTensorData(crop, rid), rid.input);
          const ro = await run('yolo26n-reid', rt);
          const raw = ro[Object.keys(ro)[0]].data;
          let norm = 0;
          for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
          norm = Math.sqrt(norm) || 1;
          const vec = new Float32Array(raw.length);
          for (let i = 0; i < raw.length; i++) vec[i] = raw[i] / norm;

          obs.push({
            x: x1 / w, y: y1 / h, w: (x2 - x1) / w, h: (y2 - y1) / h,
            score: r.score, cls: r.cls, vec,
          });
        }
        return obs;
      });

    // ---- associação gulosa por similaridade de aparência
    const obs = state.results;
    if (obs && obs !== state.lastObs) {
      state.lastObs = obs;
      for (const t of state.tracks) t.age++;

      const taken = new Set();
      for (const o of obs) {
        let best = null, bestSim = -1;
        for (const t of state.tracks) {
          if (taken.has(t.id) || t.cls !== o.cls) continue;
          const sim = dot(t.vec, o.vec);
          if (sim > bestSim) { bestSim = sim; best = t; }
        }
        if (best && bestSim >= p.simMin) {
          taken.add(best.id);
          best.x = o.x; best.y = o.y; best.w = o.w; best.h = o.h;
          best.score = o.score; best.age = 0; best.hits++;
          // média móvel do embedding: absorve variação de pose sem derivar
          for (let i = 0; i < best.vec.length; i++) {
            best.vec[i] = best.vec[i] * 0.8 + o.vec[i] * 0.2;
          }
        } else {
          state.tracks.push({
            id: state.nextId++, ...o, vec: new Float32Array(o.vec), age: 0, hits: 1,
          });
        }
      }
      state.tracks = state.tracks.filter((t) => t.age <= p.ttl);
    }

    for (const t of state.tracks || []) {
      if (t.age > 0) continue;    // só desenha quem foi visto neste ciclo
      ctx.overlay.push({
        type: 'rect',
        x: t.x * ctx.w, y: t.y * ctx.h, w: t.w * ctx.w, h: t.h * ctx.h,
        color: colorFor(t.id),
        label: `#${t.id} ${COCO_CLASSES[t.cls] || t.cls}`,
      });
    }
    const live = (state.tracks || []).filter((t) => t.age === 0).length;
    ctx.metrics['tracks'] = `${live} ativos / ${state.nextId - 1} vistos`;
    if (state.inferMs) ctx.metrics['track ms'] = state.inferMs.toFixed(0);
    return clone(src);
  },
};

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const cropCanvas = {};
function cropTo(img, x, y, w, h, outW, outH) {
  if (!cropCanvas.src) {
    cropCanvas.src = document.createElement('canvas');
    cropCanvas.dst = document.createElement('canvas');
  }
  const sc = cropCanvas.src;
  if (sc.width !== img.width || sc.height !== img.height) {
    sc.width = img.width;
    sc.height = img.height;
  }
  sc.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
  const dc = cropCanvas.dst;
  if (dc.width !== outW || dc.height !== outH) { dc.width = outW; dc.height = outH; }
  const c = dc.getContext('2d', { willReadFrequently: true });
  c.drawImage(sc, x, y, w, h, 0, 0, outW, outH);
  return c.getImageData(0, 0, outW, outH);
}

export default [
  y26detect, y26segment, y26pose, y26obb,
  y26classify, y26semantic, y26depth, y26track,
];
