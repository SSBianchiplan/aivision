/**
 * cv/runtime/livres-n/modelos.js — a LEITURA das ferramentas com modelo do
 * CV-40 (parte 2), com o que o iaVision já tem: o OCR PT-BR do CV-17
 * (PP-OCRv5 det + reconhecedor latino), o leitor de códigos do CV-10
 * (BarcodeDetector nativo ou ZXing), os detectores YOLOX (CV-07), RF-DETR
 * (CV-23) e os RF-DETR treinados no Treinar (CV-24), o MobileNetV2 (ImageNet)
 * e os classificadores publicados, e o PatchCore treinado no Treinar (CV-24).
 *
 * Só leitura/inferência: a decisão OK/NOK/INCERTO é a de marcacao.js e
 * aprendidas.js (porte do Inspect, testada contra o Python). Carregado sob
 * demanda (import dinâmico em ferramentas.js): quem não usa ferramenta com
 * modelo não baixa nada.
 *
 * Regras do runtime (ver onnx.js e opkit.js): a inferência passa pela fila do
 * ORT (serial, fora do laço de quadros); a região é COPIADA antes do primeiro
 * await (o quadro do pipeline é reaproveitado); as saídas são copiadas
 * (.slice) antes do próximo await.
 *
 * Modelos de /models/custom/index.json (o mesmo catálogo do CV-16/CV-24):
 *   arquitetura 'rfdetr'        detector (registrado como 'livre:<id>', igual ao CV-24)
 *   arquitetura 'patchcore'     anomalia ('livre:<id>'); calibração do Inspect a partir
 *                               das notas de validação (boas × ruins) da ficha
 *   arquitetura 'classificador' classificador (entrada esticada ImageNet, saída logits,
 *                               `classes`, `calibracao` {temperature, qhat, alpha}) — pronto
 *                               para quando o Treinar publicar classificadores
 */
import { MODELS, loadModel, run, makeTensor } from '../onnx.js';
import { letterbox, stretch, cropResize, toTensorData } from '../tensor.js';
import { readCodes } from '../code.js';
import { COCO_CLASSES, loadImagenetLabels } from '../labels.js';
import { loadDict, componentes as componentesDb, ctc } from '../../operators/livres-a/ocr.js';
import { COCO91_IDS } from '../../operators/livres-b/rfdetr.js';
import { FORMATO_INSPECT } from './marcacao.js';
import { geometria, decodificarYolox, decodificarDetr, calibrarAnomalia } from './aprendidas.js';

// ------------------------------------------------------------------ imagem

/** {width, height, data} → ImageData (sem cópia quando já é). */
export function paraImageData(r) {
  if (typeof ImageData !== 'undefined' && r instanceof ImageData) return r;
  return new ImageData(r.data instanceof Uint8ClampedArray ? r.data : new Uint8ClampedArray(r.data), r.width, r.height);
}

/** Cópia da região com margem constante `m` px de cor `cor` (o leitor 1D/2D precisa de zona quieta). */
function comMargem(im, m, cor = 255, k = 1) {
  const w = Math.round(im.width * k), h = Math.round(im.height * k);
  const W = w + 2 * m, H = h + 2 * m;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = `rgb(${cor},${cor},${cor})`; g.fillRect(0, 0, W, H);
  const s = document.createElement('canvas');
  s.width = im.width; s.height = im.height;
  s.getContext('2d').putImageData(im, 0, 0);
  g.imageSmoothingEnabled = k !== 1;
  g.drawImage(s, 0, 0, im.width, im.height, m, m, w, h);
  return g.getImageData(0, 0, W, H);
}

// ------------------------------------------------------------------ catálogo /models/custom

let catalogo = null, lendo = null, lidoEm = 0;
/** Catálogo dos modelos publicados pelo Treinar (relido a cada 30 s). */
export async function catalogoCustom() {
  if (catalogo && performance.now() - lidoEm < 30000) return catalogo;
  if (!lendo) {
    lendo = fetch('/models/custom/index.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => { catalogo = Array.isArray(l) ? l.slice().sort((a, b) => (b.criado || 0) - (a.criado || 0)) : []; lidoEm = performance.now(); })
      .catch(() => { catalogo = catalogo || []; })
      .finally(() => { lendo = null; });
  }
  await lendo;
  return catalogo || [];
}

/** Registra um modelo do catálogo em MODELS como 'livre:<id>' (o mesmo registro do CV-24). */
function registrar(m) {
  const id = 'livre:' + m.id;
  const e = m.entrada || {};
  const S = m.imgsz;
  MODELS[id] = Object.assign(MODELS[id] || {}, {
    file: m.arquivo, bytes: m.bytes, name: m.nome,
    task: m.arquitetura === 'patchcore' ? 'anomaly' : m.arquitetura === 'classificador' ? 'classification' : 'detection',
    license: m.licenca || 'Apache-2.0', source: 'GPlanSiS (treinado em /treino/)',
    input: e.forma || [1, 3, S, S], layout: 'nchw', mean: e.media || [0.485, 0.456, 0.406],
    std: e.desvio || [0.229, 0.224, 0.225], scale: e.escala || 1 / 255,
  });
  return id;
}

const daArq = (lista, arq, q) => {
  const l = lista.filter((x) => x.arquitetura === arq);
  const t = String(q || '').replace(/^livre:/, '').trim();
  return t ? l.find((x) => x.id === t || x.id.endsWith(t) || x.nome === t) || null : l[0] || null;
};

/** Opções para o editor: { detectores, classificadores, anomalia: [{id, nome}] }. */
export async function opcoesModelos() {
  const l = await catalogoCustom();
  return {
    detectores: [
      { id: 'yolox', nome: 'YOLOX-S · COCO 80 classes (Apache-2.0)' },
      { id: 'rfdetr-nano', nome: 'RF-DETR nano · COCO (Apache-2.0)' },
      { id: 'rfdetr-small', nome: 'RF-DETR small · COCO (Apache-2.0)' },
      ...l.filter((m) => m.arquitetura === 'rfdetr').map((m) => ({ id: 'livre:' + m.id, nome: `${m.nome} · ${m.classes.join(', ')}`, classes: m.classes })),
    ],
    classificadores: [
      { id: 'mobilenetv2', nome: 'MobileNetV2 · ImageNet 1000 classes (Apache-2.0)' },
      ...l.filter((m) => m.arquitetura === 'classificador').map((m) => ({ id: 'livre:' + m.id, nome: `${m.nome} · ${(m.classes || []).join(', ')}`, classes: m.classes })),
    ],
    anomalia: l.filter((m) => m.arquitetura === 'patchcore').map((m) => ({ id: 'livre:' + m.id, nome: m.nome, limiar: m.limiar })),
  };
}

/** Classes do detector (para exigidas/proibidas). */
export async function classesDetector(modelo) {
  if (!modelo || modelo === 'yolox' || modelo.startsWith('rfdetr-')) return COCO_CLASSES.slice();
  const m = daArq(await catalogoCustom(), 'rfdetr', modelo);
  return m ? m.classes.slice() : [];
}

// ------------------------------------------------------------------ OCR (PP-OCRv5, como o CV-17)

const DET = 'ocr5-det', REC = 'ocr5-latin';
let DICT = null;

/**
 * Linhas de texto na região: [{ text, score, poly }] em px da região.
 * Como o PaddleOCR 3 (o engine do Inspect): lado MENOR ≥ 64 px (limit_type
 * 'min'), múltiplos de 32, DB com thresh 0,3, box_thresh 0,6, unclip 1,5;
 * cada caixa lida em altura 48, CTC guloso, score = média das probabilidades.
 * Uma margem de 8 px (cor da borda) evita perder texto encostado na ROI.
 */
export async function lerTexto(reg) {
  const im0 = paraImageData(reg);
  await Promise.all([loadModel(DET), loadModel(REC)]);
  if (!DICT) DICT = await loadDict();
  const ds = MODELS[DET], rs = MODELS[REC];
  const m = 8;
  // cor da margem: mediana grosseira da borda da região
  const d = im0.data, W0 = im0.width, H0 = im0.height;
  let soma = 0, n = 0;
  for (let x = 0; x < W0; x += 2) { for (const y of [0, H0 - 1]) { const p = (y * W0 + x) * 4; soma += (d[p] + d[p + 1] + d[p + 2]) / 3; n++; } }
  const im = comMargem(im0, m, Math.round(soma / Math.max(1, n)));
  const w = im.width, h = im.height;
  let k = Math.min(w, h) < 64 ? 64 / Math.min(w, h) : 1;
  if (Math.max(w, h) * k > 1280) k = 1280 / Math.max(w, h);
  const nw = Math.max(32, Math.round((w * k) / 32) * 32), nh = Math.max(32, Math.round((h * k) / 32) * 32);
  const data = toTensorData(stretch(im, nw, nh), { ...ds, input: [1, 3, nh, nw] });
  const out = await run(DET, await makeTensor(data, [1, 3, nh, nw]));
  const o = out[Object.keys(out)[0]];
  const MW = o.dims[o.dims.length - 1], MH = o.dims[o.dims.length - 2];
  const mapa = o.data.slice();
  const kx = w / MW, ky = h / MH;
  const caixas = componentesDb(mapa, MW, MH, 0.3, 4)
    .filter((c) => c.score >= 0.6)
    .map((c) => {
      const dd = (c.area * 1.5) / (2 * ((c.x1 - c.x0) + (c.y1 - c.y0)));
      return { x1: Math.max(0, (c.x0 - dd) * kx), y1: Math.max(0, (c.y0 - dd) * ky), x2: Math.min(w, (c.x1 + dd) * kx), y2: Math.min(h, (c.y1 + dd) * ky) };
    })
    .filter((b) => b.x2 - b.x1 >= 4 && b.y2 - b.y1 >= 4)
    .slice(0, 40);
  const linhas = [];
  for (const b of caixas) {
    const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
    const rw = Math.min(3200, Math.max(16, Math.ceil((48 * bw) / bh)));
    const crop = cropResize(im, b.x1, b.y1, bw, bh, rw, 48);
    const ro = await run(REC, await makeTensor(toTensorData(crop, { ...rs, input: [1, 3, 48, rw] }), [1, 3, 48, rw]));
    const r = ro[Object.keys(ro)[0]];
    const dec = ctc(r.data.slice(), r.dims[1], r.dims[2], DICT);
    if (!dec.text) continue;
    const X1 = Math.round(b.x1 - m), Y1 = Math.round(b.y1 - m), X2 = Math.round(b.x2 - m), Y2 = Math.round(b.y2 - m);
    linhas.push({ text: dec.text, score: dec.score, poly: [[X1, Y1], [X2, Y1], [X2, Y2], [X1, Y2]] });
  }
  return linhas;
}

// ------------------------------------------------------------------ códigos (CV-10)

const mapaFormato = (f) => FORMATO_INSPECT[f] || f;

/**
 * Códigos na região: [{ text, format (nome do zxing-cpp), pts }] em px da
 * região. Primeiro como está; sem leitura, de novo ampliado 2× com 16 px de
 * margem branca (zona quieta) — ROI justa demais ou código pequeno.
 */
export async function lerCodigos(reg) {
  const im = paraImageData(reg);
  const conv = (lista, k = 1, m = 0) => lista.map((a) => ({
    text: a.text, format: mapaFormato(a.format), pts: (a.corners || []).map((p) => [(p.x - m) / k, (p.y - m) / k]),
  }));
  let r = conv(await readCodes(im));
  if (!r.length) {
    const k = Math.max(im.width, im.height) < 400 ? 2 : 1, m = 16;
    r = conv(await readCodes(comMargem(im, m, 255, k)), k, m);
  }
  return r;
}

// ------------------------------------------------------------------ detectores

/** COCO80 em inglês (os nomes do Inspect, detectors.COCO80), na ordem das classes — o iaVision rotula em português. */
export const COCO80_EN = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant',
  'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard',
  'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli',
  'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet',
  'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
  'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'];
/** inglês → português (COCO), para programas importados do Inspect com classes em inglês. */
export const COCO_EN_PT = Object.fromEntries(COCO80_EN.map((n, i) => [n, COCO_CLASSES[i]]));

const NOMES91 = (() => { const o = new Array(91).fill(null); COCO91_IDS.forEach((id, i) => { o[id] = COCO_CLASSES[i]; }); return o.map((v, i) => v || `#${i}`); })();

async function resolverDetector(modelo) {
  const q = modelo || 'yolox';
  if (q === 'yolox') return { id: 'yolox', formato: 'yolox', rotulos: COCO_CLASSES, modo: 'letterbox' };
  if (q === 'rfdetr-nano' || q === 'rfdetr-small') return { id: q, formato: 'detr', rotulos: NOMES91, modo: 'resize' };
  const m = daArq(await catalogoCustom(), 'rfdetr', q);
  if (!m) throw new Error(`detector não encontrado: ${q} (Treinar › Modelos)`);
  return { id: registrar(m), formato: 'detr', rotulos: m.classes, nc: m.classes.length, modo: 'resize', nome: m.nome };
}

/** Detecções na região: { dets [x1,y1,x2,y2,score,classe] (px da região), rotulos, formato }. */
export async function detectar(reg, s) {
  const im = paraImageData(reg);
  const d = await resolverDetector(s.modelo);
  await loadModel(d.id);
  const spec = MODELS[d.id];
  const H = spec.input[2], W = spec.input[3];
  const g = geometria(im.height, im.width, [H, W], d.modo);
  const pix = d.modo === 'letterbox' ? letterbox(im, W, H, 114).data : stretch(im, W, H);
  const out = await run(d.id, await makeTensor(toTensorData(pix, spec), spec.input));
  const conf = s.conf == null ? 0.35 : +s.conf;
  let dets;
  if (d.formato === 'yolox') {
    const o = out[Object.keys(out)[0]];
    dets = decodificarYolox(o.data.slice(), o.dims, g, conf, spec.strides || [8, 16, 32]);
  } else {
    const nomes = Object.keys(out);
    const cx = out.dets || out[nomes.find((k) => out[k].dims[out[k].dims.length - 1] === 4)];
    const lg = out.labels || out[nomes.find((k) => out[k] !== cx)];
    dets = decodificarDetr(lg.data.slice(), lg.dims, cx.data.slice(), g, conf, { sigmoid: true, nc: d.nc || null });
  }
  return { dets, rotulos: d.rotulos, formato: d.formato === 'yolox' ? 'yolox' : 'detr', modelo: d.id, coco: !d.nc };
}

// ------------------------------------------------------------------ classificadores

let IMAGENET = null;
async function resolverClassificador(modelo) {
  const q = modelo || 'mobilenetv2';
  if (q === 'mobilenetv2') {
    if (!IMAGENET) IMAGENET = await loadImagenetLabels();
    return { id: 'mobilenetv2', rotulos: IMAGENET.length ? IMAGENET : Array.from({ length: 1000 }, (_, i) => `classe ${i}`), cal: null };
  }
  const m = daArq(await catalogoCustom(), 'classificador', q);
  if (!m) throw new Error(`classificador não encontrado: ${q}`);
  return { id: registrar(m), rotulos: m.classes || [], cal: m.calibracao || null, nome: m.nome };
}

/** Rótulos do classificador (para ok_labels e as amostras de calibração). */
export async function rotulosClassificador(modelo) { return (await resolverClassificador(modelo)).rotulos; }

/** Logits na região: { logits Float32Array, rotulos, cal (do modelo, se houver) }. */
export async function classificar(reg, s) {
  const im = paraImageData(reg);
  const c = await resolverClassificador(s.modelo);
  await loadModel(c.id);
  const spec = MODELS[c.id];
  const out = await run(c.id, await makeTensor(toTensorData(stretch(im, spec.input[3], spec.input[2]), spec), spec.input));
  const o = out[Object.keys(out)[0]];
  return { logits: o.data.slice(), rotulos: c.rotulos, cal: c.cal, modelo: c.id };
}

// ------------------------------------------------------------------ PatchCore (CV-24)

const calCache = new Map();
/**
 * Calibração do Inspect (calibrate.anomaly) a partir das notas de validação
 * gravadas na ficha do treino (boas = 0, ruins = 1). Sem notas: o limiar do
 * treino vira 0,5 na escala [mapa_lo, 2·limiar − mapa_lo].
 */
export function calibracaoPatchcore(m) {
  if (calCache.has(m.id)) return calCache.get(m.id);
  let r;
  const nb = m.notas && m.notas.boas, nr = m.notas && m.notas.ruins;
  if (nb && nb.length >= 2 && nr && nr.length >= 1) {
    const sc = [...nb.map((x) => +x[1]), ...nr.map((x) => +x[1])];
    const lb = [...nb.map(() => 0), ...nr.map(() => 1)];
    r = calibrarAnomalia(sc, lb, null);
    r.origem = `calibrate.anomaly em ${nb.length} boas + ${nr.length} ruins do treino`;
  } else {
    const lim = +m.limiar || 1, lo = m.mapa_lo != null ? +m.mapa_lo : lim * 0.5;
    r = { threshold: 0.5, calibration: { score_min: lo, score_max: lim + (lim - lo) }, origem: 'limiar do treino (sem notas de validação)' };
  }
  calCache.set(m.id, r);
  return r;
}

async function resolverPatchcore(modelo) {
  const m = daArq(await catalogoCustom(), 'patchcore', modelo);
  if (!m) throw new Error(modelo ? `modelo de anomalia não encontrado: ${modelo}` : 'nenhum modelo de anomalia treinado ainda (Treinar › projeto de anomalia)');
  return m;
}

/** Nota e mapa do PatchCore na região: { nota, mapa {data,W,H}, cal, limiar, modelo, nome }. */
export async function anomalia(reg, s) {
  const im = paraImageData(reg);
  const m = await resolverPatchcore(s.modelo);
  const id = registrar(m);
  await loadModel(id);
  const spec = MODELS[id];
  const out = await run(id, await makeTensor(toTensorData(stretch(im, spec.input[3], spec.input[2]), spec), spec.input));
  const mp = out.mapa || Object.values(out).find((t) => t.dims.length === 4);
  const nt = out.nota || Object.values(out).find((t) => t.dims.length === 1);
  const data = Float32Array.from(mp.data);
  let nota = nt ? nt.data[0] : -Infinity;
  if (!nt) for (let i = 0; i < data.length; i++) if (data[i] > nota) nota = data[i];
  const c = calibracaoPatchcore(m);
  return { nota, mapa: { data, W: mp.dims[3], H: mp.dims[2] }, cal: c.calibration, limiar: c.threshold, modelo: id, nome: m.nome, origem: c.origem };
}

// ------------------------------------------------------------------ aquecimento

/** Começa a baixar/abrir os modelos que a ferramenta vai usar (não espera). */
export async function aquecer(s) {
  try {
    if (s.type === 'ocr' || (s.type === 'serial' && s.source !== 'code')) { await Promise.all([loadModel(DET), loadModel(REC)]); if (!DICT) DICT = await loadDict(); }
    else if (s.type === 'detect') await loadModel((await resolverDetector(s.modelo)).id);
    else if (s.type === 'classify') await loadModel((await resolverClassificador(s.modelo)).id);
    else if (s.type === 'anomaly') await loadModel(registrar(await resolverPatchcore(s.modelo)));
  } catch (_) { /* o erro aparece na inspeção, na ferramenta */ }
}
