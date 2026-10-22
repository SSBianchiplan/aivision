/**
 * cv/operators/livres-a/ocr.js — CV-17 OCR PT-BR (PP-OCRv5 mobile, Apache-2.0).
 *
 * O OCR antigo (CV-07) lê com um CRNN de 37 caracteres: sem acento, sem
 * minúscula, sem pontuação — "AÇÚCAR" sai "ACCAR". Este usa o reconhecedor
 * LATINO do PP-OCRv5 (836 caracteres: á é í ó ú â ê ô ã õ ç, pontuação, R$,
 * €, º/ª…), o mesmo do PaddleOCR 3, e o detector DB do PP-OCRv5 mobile.
 *
 * Pipeline, como no PaddleOCR:
 *   1. detector em resolução DINÂMICA (lado maior → `lado`, múltiplos de 32),
 *      BGR com média ImageNet — sem letterbox, a imagem é só redimensionada;
 *   2. mapa de probabilidade → componentes conexos → caixa de cada um, com
 *      score = média da probabilidade dentro do componente (box_thresh);
 *   3. "unclip": o DB encolhe a região de texto por construção, então a caixa
 *      cresce d = área·r / perímetro (r = 1,5, o unclip_ratio do Paddle);
 *   4. cada caixa é recortada em altura 48 mantendo a proporção e lida pelo
 *      reconhecedor; a saída já vem em softmax e o decode é CTC guloso.
 *
 * Validado na VPS: "Validade: 12/2027 — Lote AÇÚCAR ÇÃO", "Coração, maçã, pão
 * e açaí" e "Preço: R$ 4,99 (até 31/12)" lidos certos, confiança ≥ 0,98 (o
 * travessão longo vira hífen). Só caixas alinhadas aos eixos: texto muito
 * inclinado ou curvo sai mal.
 *
 * Publica ctx.textos = [{ text, score, x1, y1, x2, y2 }] (coordenadas 0..1).
 * loadDict, componentes e ctc são exportados: o OCR de marcação do Inspect
 * (CV-40, runtime/livres-n/modelos.js) usa o mesmo pipeline numa ROI.
 */
import { clone, snapshot } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { stretch, cropResize, toTensorData } from '../../runtime/tensor.js';
import { ensure, schedule } from '../../runtime/opkit.js';

const G = 'CV-17';
const DET = 'ocr5-det', REC = 'ocr5-latin';

// dicionário: 836 entradas num JSON (lista), baixado uma vez por sessão
let dictPromise = null, DICT = null;
export function loadDict() {
  if (!dictPromise) {
    dictPromise = fetch(MODELS[REC].dict)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o dicionário do OCR`); return r.json(); })
      .then((lista) => { DICT = lista.concat([' ']); return DICT; })   // o último índice é o espaço
      .catch((err) => { dictPromise = null; throw err; });
  }
  return dictPromise;
}

/**
 * Componentes conexos (4-vizinhança) do mapa binarizado, com a média da
 * probabilidade dentro de cada um — é o box_score do DBPostProcess.
 */
export function componentes(map, W, H, thresh, minArea) {
  const n = W * H, seen = new Uint8Array(n), fila = new Int32Array(n), out = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || map[i] < thresh) continue;
    let head = 0, tail = 0, area = 0, soma = 0;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    fila[tail++] = i; seen[i] = 1;
    while (head < tail) {
      const j = fila[head++], y = (j / W) | 0, x = j - y * W;
      area++; soma += map[j];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && !seen[j - 1] && map[j - 1] >= thresh) { seen[j - 1] = 1; fila[tail++] = j - 1; }
      if (x < W - 1 && !seen[j + 1] && map[j + 1] >= thresh) { seen[j + 1] = 1; fila[tail++] = j + 1; }
      if (y > 0 && !seen[j - W] && map[j - W] >= thresh) { seen[j - W] = 1; fila[tail++] = j - W; }
      if (y < H - 1 && !seen[j + W] && map[j + W] >= thresh) { seen[j + W] = 1; fila[tail++] = j + W; }
    }
    if (area >= minArea) out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, area, score: soma / area });
  }
  return out;
}

/** CTC guloso sobre probabilidades [T, C]: colapsa repetições, tira o blank (0). */
export function ctc(data, T, C, dict) {
  let txt = '', prev = 0, soma = 0, n = 0;
  for (let t = 0; t < T; t++) {
    const o = t * C;
    let best = 0, bv = data[o];
    for (let c = 1; c < C; c++) if (data[o + c] > bv) { bv = data[o + c]; best = c; }
    if (best !== 0 && best !== prev) { txt += dict[best - 1] || ''; soma += bv; n++; }
    prev = best;
  }
  // o dicionário tem acentos compostos e decompostos; NFC junta "c" + "̧" em "ç"
  return { text: txt.normalize('NFC').trim(), score: n ? soma / n : 0 };
}

export const ocrPtbr = {
  op: 'ocr.ptbr',
  label: 'OCR PT-BR (PP-OCRv5)',
  group: G, model: DET, needs: [REC], overlayOnly: true,
  desc: 'Lê texto em português com acentos e pontuação (ç, ã, õ, é, R$, º…): detector ' +
        'DB do PP-OCRv5 mobile + reconhecedor latino de 836 caracteres, decode CTC. ' +
        'Publica os textos para os operadores seguintes. Só texto aproximadamente horizontal.',
  params: {
    lado: { type: 'int', min: 320, max: 1600, step: 32, default: 960, label: 'Lado maior na detecção (px)' },
    thresh: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.3, label: 'Limiar do mapa' },
    boxThresh: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.6, label: 'Score mín. da caixa' },
    unclip: { type: 'float', min: 1, max: 3, step: 0.1, default: 1.5, label: 'Expansão da caixa (unclip)' },
    minConf: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.5, label: 'Confiança mín. da leitura' },
    maxBoxes: { type: 'int', min: 1, max: 60, step: 1, default: 24, label: 'Máx. linhas' },
    mostrarLista: { type: 'bool', default: true, label: 'Listar textos no canto' },
    everyMs: { type: 'int', min: 100, max: 5000, step: 100, default: 800, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure(DET, state, ctx) || !ensure(REC, state, ctx)) return clone(src);
    if (!DICT) {
      if (!state.dictReq) { state.dictReq = true; loadDict().catch((e) => { state.dictErr = String(e.message || e); state.dictReq = false; }); }
      ctx.metrics['ocr5'] = state.dictErr ? 'erro: ' + state.dictErr : 'carregando dicionário…';
      return clone(src);
    }
    const ds = MODELS[DET], rs = MODELS[REC];

    schedule(state, p.everyMs,
      () => {
        // lado maior -> p.lado, os dois lados arredondados para múltiplos de 32
        const k = p.lado / Math.max(src.width, src.height);
        const nw = Math.max(32, Math.round((src.width * k) / 32) * 32);
        const nh = Math.max(32, Math.round((src.height * k) / 32) * 32);
        const data = toTensorData(stretch(src, nw, nh), { ...ds, input: [1, 3, nh, nw] });
        return { data, nw, nh, frame: snapshot(src), w: src.width, h: src.height, p: { ...p } };
      },
      async ({ data, nw, nh, frame, w, h, p: q }) => {
        const out = await run(DET, await makeTensor(data, [1, 3, nh, nw]));
        const o = out[Object.keys(out)[0]];
        const W = o.dims[o.dims.length - 1], H = o.dims[o.dims.length - 2];
        const kx = w / W, ky = h / H;
        const caixas = componentes(o.data, W, H, q.thresh, 6)
          .filter((c) => c.score >= q.boxThresh)
          .map((c) => {
            // unclip com a área do componente e o perímetro da caixa
            const d = (c.area * q.unclip) / (2 * ((c.x1 - c.x0) + (c.y1 - c.y0)));
            return { x1: Math.max(0, (c.x0 - d) * kx), y1: Math.max(0, (c.y0 - d) * ky),
                     x2: Math.min(w, (c.x1 + d) * kx), y2: Math.min(h, (c.y1 + d) * ky), det: c.score, area: c.area };
          })
          .filter((b) => b.x2 - b.x1 >= 6 && b.y2 - b.y1 >= 6)
          .sort((a, b) => b.area - a.area).slice(0, q.maxBoxes);

        const res = [];
        for (const b of caixas) {
          const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
          // altura 48 mantendo a proporção (RecResizeImg do Paddle)
          const rw = Math.min(1600, Math.max(16, Math.ceil((48 * bw) / bh)));
          const crop = cropResize(frame, b.x1, b.y1, bw, bh, rw, 48);
          const ro = await run(REC, await makeTensor(toTensorData(crop, { ...rs, input: [1, 3, 48, rw] }), [1, 3, 48, rw]));
          const r = ro[Object.keys(ro)[0]];
          const dec = ctc(r.data, r.dims[1], r.dims[2], DICT);
          if (!dec.text || dec.score < q.minConf) continue;
          res.push({ text: dec.text, score: dec.score, det: b.det, x1: b.x1 / w, y1: b.y1 / h, x2: b.x2 / w, y2: b.y2 / h });
        }
        // ordem de leitura: linhas de cima para baixo, depois da esquerda para a direita
        res.sort((a, b) => (Math.abs(a.y1 - b.y1) < 0.5 * (a.y2 - a.y1) ? a.x1 - b.x1 : a.y1 - b.y1));
        return res;
      });

    const res = state.results || [];
    const { w, h } = ctx;
    for (const r of res) {
      ctx.overlay.push({ type: 'rect', x: r.x1 * w, y: r.y1 * h, w: (r.x2 - r.x1) * w, h: (r.y2 - r.y1) * h,
                         color: '#4ade80', label: r.text });
    }
    if (p.mostrarLista) {
      // no rodapé, de baixo para cima: no topo cobriria justamente o texto lido
      const lista = res.slice(0, 8);
      lista.forEach((r, i) => ctx.overlay.push({ type: 'banner', x: 10, y: h - 30 - (lista.length - 1 - i) * 24,
        text: `${r.text}  (${(r.score * 100) | 0}%)`, color: '#4ade80' }));
    }
    ctx.textos = res;
    ctx.metrics['textos'] = res.length;
    if (state.inferMs) ctx.metrics['ocr5 ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['ocr5 erro'] = state.error;
    return clone(src);
  },
};

export default [ocrPtbr];
