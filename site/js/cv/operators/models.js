/**
 * cv/operators/models.js — operadores de deep learning (CV-02/03/05/06/07).
 *
 * O PONTO CENTRAL DESTE ARQUIVO: inferência NÃO roda dentro do frame.
 *
 * YOLOX-S em 640² no WASM leva de 300 ms a 2 s. Rodar isso dentro do loop de
 * render daria 0,5-3 fps e uma UI travada. Então:
 *
 *   - o loop de render segue em 30-60 fps desenhando o vídeo
 *   - a inferência roda por fora, no seu próprio ritmo
 *   - cada frame desenha o ÚLTIMO resultado conhecido
 *
 * Custo: a caixa fica alguns frames atrás do vídeo. É o mesmo compromisso que
 * qualquer sistema de visão em tempo real faz, e é muito melhor que a
 * alternativa (vídeo travado esperando o modelo).
 *
 * Resultados são guardados em coordenadas NORMALIZADAS (0..1), então continuam
 * corretos se a largura de processamento mudar entre a inferência e o desenho.
 */

import { clone, alloc, toGray, snapshot, camadaNova, camadaPintar, camadaPor, usarCamada } from '../core.js';
import {
  MODELS, loadModel, isReady, run, makeTensor, modelStates,
} from '../runtime/onnx.js';
import {
  letterbox, stretch, cropResize, toTensorData, softmax, topK,
  decodeYolox, unletterbox, ctcGreedy, nms,
} from '../runtime/tensor.js';
import {
  COCO_CLASSES, CHARSET_EN, POSE_CONNECTIONS, POSE_VISIBLE_LANDMARKS,
  loadImagenetLabels,
} from '../runtime/labels.js';
import { ENTRADAS, preparar, inferir, medir, intervaloAuto } from '../runtime/tempo-real/entrada.js';
import { carimbar } from '../runtime/tempo-real/carimbo.js';
import { listaTexto, normalizar } from '../runtime/opkit.js';

/**
 * Garante o modelo carregado sem bloquear. Devolve true quando pronto.
 * Enquanto baixa, informa o progresso no painel de telemetria.
 */
function ensure(id, state, ctx) {
  if (isReady(id)) return true;
  // um pedido POR MODELO: com um `state.requested` só, o operador de dois
  // modelos (pose = YOLOX + BlazePose, OCR = detector + CRNN) pedia o primeiro
  // e nunca o segundo — ficava em "carregando…" para sempre
  const k = 'req_' + id, ke = 'err_' + id;
  if (!state[k]) {
    state[k] = true;
    loadModel(id).catch((err) => {
      state[ke] = String(err && err.message ? err.message : err);
    });
  }
  const st = modelStates()[id];
  if (state[ke] || (st && st.status === 'error')) {
    ctx.metrics[id] = 'erro: ' + (state[ke] || st.error);
  } else {
    const pct = Math.round((st ? st.progress : 0) * 100);
    ctx.metrics[id] = pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
  }
  return false;
}

/**
 * Dispara inferência se o modelo estiver livre e já tiver passado o intervalo.
 * `prep` roda SÍNCRONO (pré-processo, barato); `infer` roda async.
 */
function schedule(state, minIntervalMs, prep, infer, tCaptura) {
  const now = performance.now();
  const tCap = Number.isFinite(tCaptura) ? tCaptura : now;
  if (state.busy) return;
  if (state.lastStart && now - state.lastStart < minIntervalMs) return;

  let input;
  try {
    input = prep();
  } catch (err) {
    state.error = String(err.message || err);
    return;
  }
  if (!input) return;

  state.busy = true;
  state.lastStart = now;
  Promise.resolve()
    .then(() => infer(input))
    .then((res) => {
      state.results = res;
      state.inferMs = performance.now() - now;
      state.error = null;
      // carimbo do quadro inferido (ver opkit.schedule)
      state.resultsSeq = (state.resultsSeq | 0) + 1;
      state.resultsT = tCap;
    })
    .catch((err) => {
      state.error = String(err && err.message ? err.message : err);
    })
    .finally(() => {
      state.busy = false;
    });
}

const nz = (v) => (Number.isFinite(v) ? v : 0);

// =============================================================== CV-02

export const classify = {
  op: 'dnn.classify',
  label: 'Image Classification',
  group: 'CV-02',
  model: 'mobilenetv2',
  overlayOnly: true,
  desc: 'MobileNetV2 no ImageNet (1000 classes). Mostra o top-k com score. ' +
        'Roda fora do loop de render — o vídeo não trava esperando.',
  params: {
    topk: { type: 'int', min: 1, max: 5, step: 1, default: 3, label: 'Top-k' },
    everyMs: { type: 'int', min: 100, max: 3000, step: 100, default: 400, label: 'Intervalo (ms)' },
    minScore: { type: 'float', min: 0, max: 0.9, step: 0.05, default: 0.1, label: 'Score mínimo' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('mobilenetv2', state, ctx)) return clone(src);
    if (!state.labels) {
      state.labels = [];
      loadImagenetLabels().then((l) => { state.labels = l; });
    }
    const spec = MODELS.mobilenetv2;

    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, spec.input[3], spec.input[2]), spec),
      async (data) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('mobilenetv2', t);
        const logits = out[Object.keys(out)[0]].data;
        const probs = softmax(logits);
        return topK(probs, 5);
      });

    const res = state.results || [];
    let row = 0;
    for (const r of res.slice(0, p.topk)) {
      if (r.score < p.minScore) continue;
      const name = state.labels[r.index] || `classe ${r.index}`;
      ctx.overlay.push({
        type: 'banner',
        x: 8, y: 8 + row * 20,
        text: `${name}  ${(r.score * 100).toFixed(1)}%`,
        color: row === 0 ? '#FFD84D' : '#8b8b93',
      });
      row++;
    }
    if (state.inferMs) ctx.metrics['classify ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['classify erro'] = state.error;
    return clone(src);
  },
};

// =============================================================== CV-03

export const detect = {
  op: 'dnn.detect',
  label: 'Object Detection',
  group: 'CV-03',
  model: 'yolox',
  overlayOnly: true,
  desc: 'YOLOX-S no COCO (80 classes), Apache-2.0. Decodifica as 8400 âncoras ' +
        'das strides 8/16/32 e aplica NMS. Caixas vão no overlay, em coordenadas ' +
        'normalizadas.',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.35, label: 'Confiança' },
    iou: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.45, label: 'IoU (NMS)' },
    maxDet: { type: 'int', min: 1, max: 100, step: 1, default: 30, label: 'Máx. detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
    // 'quadro' = como sempre (o quadro de trabalho em procWidth); os outros
    // leem a fonte em resolução plena, recortam a ROI e podem ladrilhar
    // (ver cv/runtime/tempo-real/entrada.js) — objetos pequenos em quadro largo
    entrada: { type: 'enum', options: ENTRADAS, default: 'quadro', label: 'Entrada do modelo' },
    classes: { type: 'text', default: '', max: 300, label: 'Só estas classes (vírgula; vazio = todas)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    const spec = MODELS.yolox;
    const S = spec.input[2];
    const decodificar = (out) => {
      const key = Object.keys(out)[0];
      return decodeYolox(out[key].data, out[key].dims, spec, p.conf, p.iou, p.maxDet);
    };

    if (p.entrada === 'quadro') {
      schedule(state, p.everyMs,
        () => {
          const lb = letterbox(src, spec.input[3], spec.input[2]);
          return { data: toTensorData(lb.data, spec), lb, w: src.width, h: src.height };
        },
        async ({ data, lb, w, h }) => {
          const t = await makeTensor(data, spec.input);
          const boxes = decodificar(await run('yolox', t));
          // normaliza para 0..1 para sobreviver a mudança de resolução
          return boxes.map((b) => {
            const u = unletterbox(b, lb);
            return {
              x1: u.x1 / w, y1: u.y1 / h, x2: u.x2 / w, y2: u.y2 / h,
              score: b.score, classId: b.classId,
            };
          });
        }, ctx.tQuadro);
    } else {
      schedule(state, intervaloAuto(p, state),
        () => preparar(src, ctx, { modo: p.entrada, S, ajuste: 'letterbox', msPorRun: state.msPorRun || 0, prepMs: state.prepMs || 0 }),
        async (prep) => {
          const t0 = performance.now();
          const res = await inferir(prep, async (img) => {
            const t = await makeTensor(toTensorData(img, spec), spec.input);
            return decodificar(await run('yolox', t)).map((b) => ({ ...b, cls: b.classId }));
          }, { iouNms: p.iou, maxDet: p.maxDet });
          medir(state, prep, t0);
          return res.map(({ cls, ...b }) => ({ ...b, classId: cls }));
        }, ctx.tQuadro);
    }

    const filtro = listaTexto(p.classes);
    const res = (state.results || []).filter((b) => !filtro.length
      || filtro.some((f) => normalizar(COCO_CLASSES[b.classId] || '').includes(f)));
    for (const b of res) {
      const x = b.x1 * ctx.w, y = b.y1 * ctx.h;
      const w = (b.x2 - b.x1) * ctx.w, h = (b.y2 - b.y1) * ctx.h;
      if (!(w > 1 && h > 1)) continue;
      const name = COCO_CLASSES[b.classId] || `#${b.classId}`;
      ctx.overlay.push({
        type: 'rect',
        x: nz(x), y: nz(y), w: nz(w), h: nz(h),
        color: colorFor(b.classId),
        label: p.showScore ? `${name} ${(b.score * 100) | 0}%` : name,
        det: true,       // caixa crua do detector: o rastreio pode escondê-la (ver tracking.js)
      });
    }
    // As caixas ficam no contexto do frame para quem vem depois na cadeia
    // (CV-11 Relações consome exatamente isto): normalizadas, com nome.
    ctx.detections = res.map((b) => ({
      x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: b.score,
      name: COCO_CLASSES[b.classId] || `#${b.classId}`,
    }));
    // carimbo: de qual inferência e de que instante são estas caixas
    carimbar(ctx, state);
    ctx.metrics['objetos'] = res.length;
    if (state.inferMs) ctx.metrics['detect ms'] = state.inferMs.toFixed(0);
    if (state.ladrilhos > 1) ctx.metrics['ladrilhos'] = state.ladrilhos;
    if (state.error) ctx.metrics['detect erro'] = state.error;
    return clone(src);
  },
};

const PALETTE = ['#FFD84D', '#22d3ee', '#4ade80', '#fbbf24', '#f472b6', '#a78bfa', '#38bdf8', '#fb923c'];
const colorFor = (i) => PALETTE[i % PALETTE.length];

// =============================================================== CV-05

export const segmentPerson = {
  op: 'dnn.segment_person',
  label: 'Person Segmentation',
  group: 'CV-05',
  model: 'pphumanseg',
  desc: 'PP-HumanSeg: máscara pessoa/fundo em 192×192, reescalada e composta ' +
        'sobre o frame (camada por cima do vídeo nítido; «só máscara» troca a imagem).',
  // destaque, fundo escuro e croma são uma camada sobre o vídeo; «só máscara» substitui a imagem
  overlayOnly: (p) => p.mode !== 'só máscara',
  params: {
    mode: { type: 'enum', options: ['destaque', 'fundo escuro', 'só máscara', 'croma'], default: 'destaque', label: 'Modo' },
    thresh: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.5, label: 'Limiar' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('pphumanseg', state, ctx)) return clone(src);
    const spec = MODELS.pphumanseg;
    const S = spec.input[2];

    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, S, S), spec),
      async (data) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('pphumanseg', t);
        const o = out[Object.keys(out)[0]];
        // saída (1,2,S,S) já com softmax: canal 1 é "pessoa"
        const d = o.data;
        const plane = S * S;
        const mask = new Float32Array(plane);
        for (let i = 0; i < plane; i++) mask[i] = d[plane + i];
        return mask;
      });

    const mask = state.results;
    if (state.inferMs) ctx.metrics['seg ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['seg erro'] = state.error;
    if (!mask) return clone(src);

    const { w, h } = ctx;
    // A máscara é 192×192 e o frame é maior: amostrar por vizinho mais
    // próximo dava blocos de vários pixels na borda. Bilinear + uma rampa
    // de 6% em volta do limiar dá borda suave que acompanha a pessoa.
    const kx = S / w, ky = S / h;
    const alfaEm = (x, y) => {
      const fy = Math.min(S - 1.001, Math.max(0, (y + 0.5) * ky - 0.5));
      const yi = fy | 0, ty = fy - yi, row = yi * S;
      const fx = Math.min(S - 1.001, Math.max(0, (x + 0.5) * kx - 0.5));
      const xi = fx | 0, tx = fx - xi, i00 = row + xi;
      const m = (mask[i00] * (1 - tx) + mask[i00 + 1] * tx) * (1 - ty)
              + (mask[i00 + S] * (1 - tx) + mask[i00 + S + 1] * tx) * ty;
      return Math.min(1, Math.max(0, (m - p.thresh) / 0.12 + 0.5));   // 0..1, suave
    };

    if (p.mode === 'só máscara') {
      const out = alloc(w, h);
      const o = out.data;
      let fg = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = alfaEm(x, y);
          if (a >= 0.5) fg++;
          const q = (y * w + x) * 4, v = (a * 255) | 0;
          o[q] = v; o[q + 1] = v; o[q + 2] = v; o[q + 3] = 255;
        }
      }
      ctx.metrics['pessoa'] = ((fg / (w * h)) * 100).toFixed(1) + '%';
      return out;
    }

    /*
     * Os outros modos são uma CAMADA sobre o vídeo (o mesmo resultado da
     * mistura nos pixels): destaque = vermelho a 25%·a, fundo escuro = preto
     * a 82%·(1−a), croma = verde (0,200,0) a (1−a). Montada uma vez por máscara.
     */
    const prim = camadaPor(state, [mask, w, h, p.mode, p.thresh], () => {
      const L = camadaNova(w, h), o = L.data;
      let fg = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const a = alfaEm(x, y);
          if (a >= 0.5) fg++;
          const q = (y * w + x) * 4;
          if (p.mode === 'croma') camadaPintar(o, q, 0, 200, 0, 1 - a);
          else if (p.mode === 'fundo escuro') camadaPintar(o, q, 0, 0, 0, 0.82 * (1 - a));
          else camadaPintar(o, q, 255, 0, 0, 0.25 * a);   // destaque: tinge o primeiro plano
        }
      }
      state.fg = fg / (w * h);
      return L;
    });
    ctx.metrics['pessoa'] = ((state.fg || 0) * 100).toFixed(1) + '%';
    return usarCamada(src, ctx, prim);
  },
};

// =============================================================== CV-06

export const pose = {
  op: 'dnn.pose',
  label: 'Keypoint / Pose',
  group: 'CV-06',
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Dois estágios: o YOLOX acha a pessoa, o BlazePose estima 33 landmarks ' +
        'no recorte. Estimar pose no frame inteiro degrada muito — daí o recorte.',
  params: {
    minVis: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.5, label: 'Visibilidade mín.' },
    margin: { type: 'float', min: 0, max: 0.5, step: 0.05, default: 0.15, label: 'Margem do recorte' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showBox: { type: 'bool', default: false, label: 'Mostrar recorte' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const det = MODELS.yolox;
    const ps = MODELS.pose;

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, det.input[3], det.input[2]);
        return {
          detData: toTensorData(lb.data, det),
          lb, src: snapshot(src), w: src.width, h: src.height,
        };
      },
      async ({ detData, lb, src: frame, w, h }) => {
        // estágio 1: onde está a pessoa
        const t1 = await makeTensor(detData, det.input);
        const o1 = await run('yolox', t1);
        const k1 = Object.keys(o1)[0];
        const boxes = decodeYolox(o1[k1].data, o1[k1].dims, det, 0.4, 0.45, 10)
          .filter((b) => b.classId === 0)         // só "pessoa"
          .map((b) => unletterbox(b, lb));
        if (!boxes.length) return null;

        // maior área
        boxes.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1));
        const b = boxes[0];
        const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
        const mx = bw * p.margin, my = bh * p.margin;
        const cx = Math.max(0, b.x1 - mx), cy = Math.max(0, b.y1 - my);
        const cw = Math.min(w - cx, bw + 2 * mx), ch = Math.min(h - cy, bh + 2 * my);
        if (cw < 8 || ch < 8) return null;

        // estágio 2: pose no recorte
        const crop = cropResize(frame, cx, cy, cw, ch, ps.input[2], ps.input[1]);
        const t2 = await makeTensor(toTensorData(crop, ps), ps.input);
        const o2 = await run('pose', t2);

        // procura a saída de 195 valores (39 landmarks × 5)
        let lms = null;
        for (const key of Object.keys(o2)) {
          const d = o2[key];
          if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) { lms = d.data; break; }
        }
        if (!lms) return null;

        const S = ps.input[2];
        const pts = [];
        for (let i = 0; i < POSE_VISIBLE_LANDMARKS; i++) {
          const o = i * ps.stride;
          pts.push({
            x: (cx + (lms[o] / S) * cw) / w,       // normalizado no frame
            y: (cy + (lms[o + 1] / S) * ch) / h,
            v: sigmoid(lms[o + 3]),
          });
        }
        return { pts, box: { x: cx / w, y: cy / h, w: cw / w, h: ch / h } };
      });

    const r = state.results;
    if (state.inferMs) ctx.metrics['pose ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['pose erro'] = state.error;
    if (!r) {
      ctx.metrics['pose'] = 'sem pessoa';
      return clone(src);
    }

    if (p.showBox) {
      ctx.overlay.push({
        type: 'rect',
        x: r.box.x * ctx.w, y: r.box.y * ctx.h,
        w: r.box.w * ctx.w, h: r.box.h * ctx.h,
        color: '#3f3f46',
      });
    }

    for (const [a, b] of POSE_CONNECTIONS) {
      const p1 = r.pts[a], p2 = r.pts[b];
      if (!p1 || !p2 || p1.v < p.minVis || p2.v < p.minVis) continue;
      ctx.overlay.push({
        type: 'line',
        x1: p1.x * ctx.w, y1: p1.y * ctx.h,
        x2: p2.x * ctx.w, y2: p2.y * ctx.h,
        color: '#22d3ee', width: 2,
      });
    }
    let n = 0;
    for (const pt of r.pts) {
      if (pt.v < p.minVis) continue;
      n++;
      ctx.overlay.push({ type: 'point', x: pt.x * ctx.w, y: pt.y * ctx.h, r: 3, color: '#FFD84D' });
    }
    ctx.metrics['landmarks'] = n;
    return clone(src);
  },
};

const sigmoid = (v) => 1 / (1 + Math.exp(-v));

// =============================================================== CV-07

export const ocr = {
  op: 'dnn.ocr',
  label: 'OCR — Texto',
  group: 'CV-07',
  model: 'ppocr_det',
  needs: ['crnn'],
  overlayOnly: true,
  desc: 'PP-OCRv3 gera o mapa de probabilidade de texto; a binarização vira ' +
        'caixas por componentes conexos, e o CRNN lê cada recorte com decode CTC. ' +
        'Só alfanumérico latino (o CRNN aqui é o modelo EN) e funciona com PALAVRAS SOLTAS: ' +
        'uma linha com várias palavras vira uma caixa só e sai ilegível. Para linhas de ' +
        'texto e português, use o OCR PT-BR (ocr.ptbr).',
  params: {
    thresh: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.3, label: 'Limiar do mapa' },
    minArea: { type: 'int', min: 20, max: 5000, step: 20, default: 120, label: 'Área mín. (px)' },
    maxBoxes: { type: 'int', min: 1, max: 30, step: 1, default: 8, label: 'Máx. caixas' },
    recognize: { type: 'bool', default: true, label: 'Reconhecer texto (CRNN)' },
    everyMs: { type: 'int', min: 100, max: 4000, step: 100, default: 700, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('ppocr_det', state, ctx)) return clone(src);
    if (p.recognize && !ensure('crnn', state, ctx)) return clone(src);
    const dspec = MODELS.ppocr_det;
    const rspec = MODELS.crnn;
    const S = dspec.input[2];

    schedule(state, p.everyMs,
      () => {
        const lb = letterbox(src, S, S, 0);
        return { data: toTensorData(lb.data, dspec), lb, src: p.recognize ? snapshot(src) : null, w: src.width, h: src.height };
      },
      async ({ data, lb, src: frame, w, h }) => {
        const t = await makeTensor(data, dspec.input);
        const out = await run('ppocr_det', t);
        const o = out[Object.keys(out)[0]];
        const map = o.data;   // (S,S) probabilidade

        const boxes = boxesFromProbMap(map, S, S, p.thresh, p.minArea)
          .slice(0, p.maxBoxes)
          .map((b) => ({
            x1: (b.x1 - lb.dx) / lb.scale, y1: (b.y1 - lb.dy) / lb.scale,
            x2: (b.x2 - lb.dx) / lb.scale, y2: (b.y2 - lb.dy) / lb.scale,
          }))
          .filter((b) => b.x2 > b.x1 + 4 && b.y2 > b.y1 + 4);

        const results = [];
        for (const b of boxes) {
          const bx = Math.max(0, b.x1), by = Math.max(0, b.y1);
          const bw = Math.min(w - bx, b.x2 - b.x1), bh = Math.min(h - by, b.y2 - b.y1);
          if (bw < 4 || bh < 4) continue;
          let text = '', score = 0;
          if (p.recognize) {
            const crop = cropResize(frame, bx, by, bw, bh, rspec.input[3], rspec.input[2]);
            const rt = await makeTensor(toTensorData(crop, rspec), rspec.input);
            const ro = await run('crnn', rt);
            const rd = ro[Object.keys(ro)[0]];
            const dec = ctcGreedy(rd.data, rd.dims, CHARSET_EN);
            text = dec.text;
            score = dec.score;
          }
          results.push({
            x: bx / w, y: by / h, w: bw / w, h: bh / h, text, score,
          });
        }
        return results;
      });

    const res = state.results || [];
    for (const r of res) {
      ctx.overlay.push({
        type: 'rect',
        x: r.x * ctx.w, y: r.y * ctx.h, w: r.w * ctx.w, h: r.h * ctx.h,
        color: '#4ade80',
        label: r.text || null,
      });
    }
    ctx.metrics['textos'] = res.length;
    if (state.inferMs) ctx.metrics['ocr ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['ocr erro'] = state.error;
    return clone(src);
  },
};

/**
 * Extrai caixas de um mapa de probabilidade por componentes conexos.
 * Mesma estratégia do operador de blobs do CV-01 — o DB do PP-OCR produz
 * um mapa denso, e a caixa de cada componente é a região de texto.
 */
function boxesFromProbMap(map, w, h, thresh, minArea) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const boxes = [];

  for (let i = 0; i < n; i++) {
    if (seen[i] || map[i] < thresh) continue;
    let head = 0, tail = 0;
    queue[tail++] = i;
    seen[i] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;

    while (head < tail) {
      const j = queue[head++];
      const y = (j / w) | 0, x = j - y * w;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x > 0 && !seen[j - 1] && map[j - 1] >= thresh) { seen[j - 1] = 1; queue[tail++] = j - 1; }
      if (x < w - 1 && !seen[j + 1] && map[j + 1] >= thresh) { seen[j + 1] = 1; queue[tail++] = j + 1; }
      if (y > 0 && !seen[j - w] && map[j - w] >= thresh) { seen[j - w] = 1; queue[tail++] = j - w; }
      if (y < h - 1 && !seen[j + w] && map[j + w] >= thresh) { seen[j + w] = 1; queue[tail++] = j + w; }
    }
    if (area < minArea) continue;
    // dilata um pouco: o DB encolhe a região de texto por construção
    const px = Math.round((maxX - minX) * 0.08) + 2;
    const py = Math.round((maxY - minY) * 0.25) + 2;
    boxes.push({
      x1: minX - px, y1: minY - py, x2: maxX + px, y2: maxY + py, area,
    });
  }
  boxes.sort((a, b) => b.area - a.area);
  return boxes;
}

export default [classify, detect, segmentPerson, pose, ocr];
