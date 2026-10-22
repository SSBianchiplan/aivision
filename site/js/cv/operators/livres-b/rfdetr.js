/**
 * cv/operators/livres-b/rfdetr.js — CV-23 RF-DETR (Roboflow, Apache-2.0), COCO.
 *
 * A alternativa livre ao YOLO26 (AGPL): um DETR em tempo real com backbone
 * DINOv2. Duas diferenças para o YOLOX/YOLO26 que mudam o código:
 *
 * 1. SEM NMS E SEM ÂNCORAS. São 300 consultas; cada uma já é UMA caixa
 *    candidata, cx,cy,w,h normalizados em 0..1. Basta o sigmoid nos logits
 *    e o limiar. (Fica um NMS leve, IoU 0,7 por classe, só para o raro par de
 *    consultas que ainda cai no mesmo objeto.)
 *
 * 2. IDs DE CLASSE DO COCO DE 91, não o 0..79 do YOLO. O logit de índice 17
 *    é "gato", o 75 é "controle remoto"; os buracos (12, 26, 29, 30, 45, 66,
 *    68, 69, 71, 83) nunca disparam. Conferido com onnxruntime em fotos do
 *    val2017 — o exportado devolve [1,300,91], e o índice 0 é de fundo.
 *
 * Pré-processo: estica para o quadrado (sem letterbox — é como o rfdetr
 * treina e infere), ImageNet em 0..1.
 */
import { clone } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { stretch, toTensorData } from '../../runtime/tensor.js';
import { COCO_CLASSES } from '../../runtime/labels.js';
import { ensure, schedule, colorFor, nmsBoxes, sigmoid, listaTexto, normalizar } from '../../runtime/opkit.js';
import { ENTRADAS, preparar, inferir, medir, intervaloAuto } from '../../runtime/tempo-real/entrada.js';
import { carimbar } from '../../runtime/tempo-real/carimbo.js';

const G = 'CV-23';

/** id COCO-91 de cada uma das 80 classes, na ordem do COCO_CLASSES. */
export const COCO91_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
  27, 28, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51,
  52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 67, 70, 72, 73, 74, 75, 76, 77,
  78, 79, 80, 81, 82, 84, 85, 86, 87, 88, 89, 90,
];
/** id COCO-91 -> índice 0..79 (-1 nos buracos e no fundo). */
const TO80 = new Int16Array(91).fill(-1);
COCO91_IDS.forEach((id, i) => { TO80[id] = i; });

export const VARIANTES = { 'nano (384²)': 'rfdetr-nano', 'small (512²)': 'rfdetr-small' };

/**
 * Decodifica as saídas do RF-DETR em caixas normalizadas x1,y1,x2,y2.
 * Por consulta, a classe de maior logit (o pós-processo oficial faz top-k
 * sobre 300×91, o que pode repetir a mesma caixa com duas classes).
 */
export function decodeRfdetr(dets, logits, nQ, nC, conf, maxDet) {
  const out = [];
  const zConf = Math.log(conf / (1 - conf));           // compara logit, não sigmoid: 27 mil exp a menos
  for (let q = 0; q < nQ; q++) {
    let best = -Infinity, bc = -1;
    const o = q * nC;
    for (let c = 1; c < nC; c++) { const z = logits[o + c]; if (z > best) { best = z; bc = c; } }
    if (best < zConf || TO80[bc] < 0) continue;
    const cx = dets[q * 4], cy = dets[q * 4 + 1], w = dets[q * 4 + 2], h = dets[q * 4 + 3];
    out.push({
      x1: Math.max(0, cx - w / 2), y1: Math.max(0, cy - h / 2),
      x2: Math.min(1, cx + w / 2), y2: Math.min(1, cy + h / 2),
      score: sigmoid(best), cls: TO80[bc],
    });
  }
  return nmsBoxes(out, 0.7, maxDet, true);
}

/**
 * Pré-processo SÍNCRONO (dentro do frame: o ImageData pode voltar ao pool
 * logo depois) e inferência assíncrona — separados para o SAM 2 reusar.
 */
export function prepRfdetr(src, id) {
  const spec = MODELS[id];
  return toTensorData(stretch(src, spec.input[3], spec.input[2]), spec);
}
export async function inferRfdetr(data, id, conf, maxDet) {
  const spec = MODELS[id];
  const out = await run(id, await makeTensor(data, spec.input));
  const d = out.dets, l = out.labels;
  return decodeRfdetr(d.data, l.data, d.dims[1], l.dims[2], conf, maxDet)
    .map((b) => ({ ...b, name: COCO_CLASSES[b.cls] || `#${b.cls}` }));
}

export const rfdetrDetect = {
  op: 'rfdetr.detect',
  label: 'RF-DETR — Detecção (Apache-2.0)',
  group: G, model: 'rfdetr-nano', overlayOnly: true,
  desc: 'RF-DETR no COCO (80 classes), Apache-2.0 — a alternativa livre ao YOLO26. ' +
        'Transformer de detecção sem NMS: 300 consultas, cada uma já é uma caixa. ' +
        'Nano (384², 39 MB) para tempo real; small (512², 41 MB) acha objetos menores. ' +
        'Publica as caixas para os operadores seguintes (SAM, relações, tracking…).',
  params: {
    variante: { type: 'enum', options: Object.keys(VARIANTES), default: 'nano (384²)', label: 'Variante' },
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.5, label: 'Confiança' },
    maxDet: { type: 'int', min: 1, max: 100, step: 1, default: 30, label: 'Máx. detecções' },
    classes: { type: 'text', default: '', max: 300, label: 'Só estas classes (vírgula; vazio = todas)' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
    showScore: { type: 'bool', default: true, label: 'Mostrar score' },
    // 'quadro' = como sempre; os outros leem a fonte em resolução plena, recortam
    // a ROI e podem ladrilhar (cv/runtime/tempo-real/entrada.js)
    entrada: { type: 'enum', options: ENTRADAS, default: 'quadro', label: 'Entrada do modelo' },
  },
  apply(src, p, state, ctx) {
    const id = VARIANTES[p.variante] || 'rfdetr-nano';
    if (!ensure(id, state, ctx)) return clone(src);
    // trocar de variante descarta o resultado antigo (caixas de outro modelo)
    if (state.id !== id) { state.id = id; state.results = null; }

    if (p.entrada === 'quadro' || !p.entrada) {
      schedule(state, p.everyMs, () => prepRfdetr(src, id), (data) => inferRfdetr(data, id, p.conf, p.maxDet), ctx.tQuadro);
    } else {
      const spec = MODELS[id], S = spec.input[2];
      schedule(state, intervaloAuto(p, state),
        () => preparar(src, ctx, { modo: p.entrada, S, ajuste: 'esticar', msPorRun: state.msPorRun || 0, prepMs: state.prepMs || 0 }),
        async (prep) => {
          const t0 = performance.now();
          // RF-DETR devolve 0..1 do ladrilho: leva para px do modelo, o desfazer cuida do resto
          const res = await inferir(prep, async (img) => (await inferRfdetr(toTensorData(img, spec), id, p.conf, p.maxDet))
            .map((b) => ({ ...b, x1: b.x1 * S, y1: b.y1 * S, x2: b.x2 * S, y2: b.y2 * S })), { iouNms: 0.7, maxDet: p.maxDet });
          medir(state, prep, t0);
          return res;
        }, ctx.tQuadro);
    }

    const filtro = listaTexto(p.classes);
    const res = (state.results || []).filter((b) => !filtro.length || filtro.some((f) => normalizar(b.name).includes(f)));
    const { w, h } = ctx;
    for (const b of res) {
      const bw = (b.x2 - b.x1) * w, bh = (b.y2 - b.y1) * h;
      if (!(bw > 1 && bh > 1)) continue;
      ctx.overlay.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: bw, h: bh, color: colorFor(b.cls),
                         label: p.showScore ? `${b.name} ${(b.score * 100) | 0}%` : b.name, det: true });
    }
    // mesmo formato do dnn.detect: normalizadas, com nome — o resto da cadeia consome isto
    ctx.detections = res.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: b.score, name: b.name, classId: b.cls }));
    carimbar(ctx, state);
    if (state.ladrilhos > 1) ctx.metrics['ladrilhos'] = state.ladrilhos;
    ctx.metrics['objetos'] = res.length;
    if (state.inferMs) ctx.metrics['rf-detr ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['rf-detr erro'] = state.error;
    return clone(src);
  },
};

export default [rfdetrDetect];
