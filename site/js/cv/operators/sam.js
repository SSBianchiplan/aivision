/**
 * cv/operators/sam.js — CV-13 Segmentação por prompt (MobileSAM, Apache-2.0).
 *
 * SAM em duas metades: o codificador (TinyViT, 1024²) vê a imagem UMA vez por
 * frame e produz embeddings 256×64×64; o decodificador é leve e roda uma vez
 * por prompt. O prompt aqui é a CAIXA de cada objeto detectado (dois pontos,
 * rótulos 2 e 3) — ou um ponto no centro da imagem, para segmentar "o que está
 * na mira" sem detector nenhum. A máscara sai em logits na resolução do frame:
 * é o que resolve o limite de 160² das máscaras do YOLO.
 *
 * Pré-processo do SAM: imagem no canto superior esquerdo do quadrado 1024²,
 * resto zero DEPOIS da normalização (mean/std ImageNet em 0..255).
 *
 * RECORTE FIXO DO DECODIFICADOR (corrigido em out/2026): o ONNX do MobileSAM
 * foi exportado com o recorte da máscara constante em 683×1024 (a imagem de
 * exemplo do SAM, 3:2) — `orig_im_size` só muda o tamanho final. Com o lado
 * maior em 1024, uma imagem 4:3 saía com a máscara esticada 1,125× na vertical
 * (e cortada embaixo). Agora a imagem é reduzida para CABER em 1024×683, pede-se
 * exatamente 683×1024 e a máscara é recortada à área da imagem antes de pintar.
 */
import { clone, snapshot, camadaNova, camadaPintar, camadaPor, usarCamada } from '../core.js';
import { MODELS, runFeeds, ensureOrt } from '../runtime/onnx.js';
import { ensure, schedule, colorFor, hexToRgb, detectionsFromCtx, detectYolox, paintMask } from '../runtime/opkit.js';

const G = 'CV-13';
const S = 1024;
const SH = 683;   // altura do recorte fixo do decodificador (ver o cabeçalho)
let canvas = null, c2d = null;

function preprocess(src) {
  if (!canvas) { canvas = document.createElement('canvas'); canvas.width = S; canvas.height = S; c2d = canvas.getContext('2d', { willReadFrequently: true }); }
  const k = Math.min(S / src.width, SH / src.height);
  const nw = Math.round(src.width * k), nh = Math.round(src.height * k);
  c2d.clearRect(0, 0, S, S);
  // ImageData -> canvas: via bitmap temporário
  const tmp = document.createElement('canvas'); tmp.width = src.width; tmp.height = src.height;
  tmp.getContext('2d').putImageData(src, 0, 0);
  c2d.drawImage(tmp, 0, 0, nw, nh);
  const d = c2d.getImageData(0, 0, S, S).data;
  const spec = MODELS['mobilesam-enc'];
  const out = new Float32Array(3 * S * S), plane = S * S;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x, q = i * 4;
      if (x >= nw || y >= nh) continue;                       // preenchimento = 0 (já normalizado)
      out[i] = (d[q] - spec.mean[0]) / spec.std[0];
      out[plane + i] = (d[q + 1] - spec.mean[1]) / spec.std[1];
      out[2 * plane + i] = (d[q + 2] - spec.mean[2]) / spec.std[2];
    }
  }
  return { x: out, k, nw, nh };
}

/** Logits 683×1024 do decodificador → só a área da imagem (nw×nh), que o paintMask estica no quadro. */
function recortar(data, mw, nw, nh) {
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) out.set(data.subarray(y * mw, y * mw + nw), y * nw);
  return out;
}

export const samObjetos = {
  op: 'sam.mascaras',
  label: 'SAM — Máscaras finas',
  group: G, model: 'mobilesam-enc',
  overlayOnly: true,   // máscaras (e o fundo escurecido do «só a máscara») numa camada sobre o vídeo nítido
  desc: 'MobileSAM: máscara de alta resolução para cada objeto detectado (prompt = ' +
        'caixa do detector anterior; sem detector, roda o YOLOX) ou para o que está ' +
        'no centro da imagem. Codificador uma vez por frame, decodificador por objeto.',
  params: {
    alvo: { type: 'enum', options: ['objetos detectados', 'centro da imagem'], default: 'objetos detectados', label: 'Prompt' },
    maxObj: { type: 'int', min: 1, max: 12, step: 1, default: 6, label: 'Máx. objetos' },
    alpha: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.55, label: 'Opacidade' },
    confDet: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.35, label: 'Confiança do YOLOX (sem detector)' },
    everyMs: { type: 'int', min: 100, max: 5000, step: 100, default: 800, label: 'Intervalo mín. (ms)' },
    caixas: { type: 'bool', default: true, label: 'Desenhar caixas e nomes' },
    soMascara: { type: 'bool', default: false, label: 'Só a máscara (fundo escuro)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('mobilesam-enc', state, ctx) || !ensure('mobilesam-dec', state, ctx)) return clone(src);
    const centro = p.alvo === 'centro da imagem';
    const externas = centro ? null : detectionsFromCtx(ctx, p.maxObj);
    if (!centro && !externas && !ensure('yolox', state, ctx)) return clone(src);

    schedule(state, p.everyMs,
      () => ({ pre: preprocess(src), dets: externas, W: src.width, H: src.height,
              frame: !centro && !externas ? snapshot(src) : null }),
      async ({ pre, dets, W, H, frame }) => {
        const ort = await ensureOrt();
        const t0 = performance.now();
        const enc = await runFeeds('mobilesam-enc', { input_image: new ort.Tensor('float32', pre.x, [1, 3, S, S]) });
        const emb = enc.image_embeddings;
        const tEnc = performance.now() - t0;
        if (!centro && !dets) dets = (await detectYolox(frame, p.confDet, p.maxObj));
        const prompts = centro
          ? [{ coords: [0.5 * W * pre.k, 0.5 * H * pre.k], labels: [1], name: 'centro', box: null }]
          : (dets || []).slice(0, p.maxObj).map((b) => ({
              coords: [b.x1 * W * pre.k, b.y1 * H * pre.k, b.x2 * W * pre.k, b.y2 * H * pre.k], labels: [2, 3], name: b.name, box: b }));
        // máscaras na resolução do FRAME (o decodificador reescala)
        const masks = [];
        for (let i = 0; i < prompts.length; i++) {
          const pr = prompts[i];
          const n = pr.labels.length;
          // o proxy do ORT transfere o buffer do tensor para o worker: reusar
          // `emb` no 2º objeto dava "ArrayBuffer is detached". Cópia para todos
          // menos o último, que pode levar o original.
          const embI = i === prompts.length - 1 ? emb : new ort.Tensor('float32', emb.data.slice(), emb.dims);
          const out = await runFeeds('mobilesam-dec', {
            image_embeddings: embI,
            point_coords: new ort.Tensor('float32', Float32Array.from(pr.coords), [1, n, 2]),
            point_labels: new ort.Tensor('float32', Float32Array.from(pr.labels), [1, n]),
            mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
            has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
            orig_im_size: new ort.Tensor('float32', new Float32Array([SH, S]), [2]),
          }, ['masks', 'iou_predictions']);
          const m = out.masks;
          // a saída está no espaço do codificador (683×1024): fica só a área da imagem
          const nw = Math.min(pre.nw, m.dims[3]), nh = Math.min(pre.nh, m.dims[2]);
          masks.push({ logit: recortar(m.data, m.dims[3], nw, nh), mh: nh, mw: nw, iou: Number(out.iou_predictions.data[0]), name: pr.name, box: pr.box });
        }
        return { masks, tEnc, tTotal: performance.now() - t0 };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['sam ms'] = state.inferMs.toFixed(0);
    if (R && R.tEnc) ctx.metrics['sam enc ms'] = R.tEnc.toFixed(0);
    if (state.error) ctx.metrics['sam erro'] = state.error;
    if (!R || !R.masks.length) { ctx.metrics['máscaras'] = 0; return clone(src); }

    const { w, h } = ctx;
    // camada: fundo escurecido (só a máscara: preto a 80%) + máscaras; uma vez por resultado
    const prim = camadaPor(state, [R, w, h, p.alpha, p.soMascara], () => {
      const L = camadaNova(w, h), od = L.data;
      if (p.soMascara) for (let i = 0; i < od.length; i += 4) camadaPintar(od, i, 0, 0, 0, 0.8);
      R.masks.forEach((m, idx) => {
        const region = m.box ? { x0: (m.box.x1 * w - 4) | 0, y0: (m.box.y1 * h - 4) | 0, x1: (m.box.x2 * w + 5) | 0, y1: (m.box.y2 * h + 5) | 0 } : null;
        paintMask(od, w, h, m.logit, m.mw, m.mh, hexToRgb(colorFor(idx)), p.soMascara ? 1 : p.alpha, region, true);
      });
      return L;
    });
    const out = usarCamada(src, ctx, prim);
    R.masks.forEach((m, idx) => {
      if (p.caixas && m.box) {
        ctx.overlay.push({ type: 'rect', x: m.box.x1 * w, y: m.box.y1 * h, w: (m.box.x2 - m.box.x1) * w, h: (m.box.y2 - m.box.y1) * h,
                           color: colorFor(idx), label: `${m.name} · iou ${(m.iou * 100) | 0}%` });
      }
      if (!m.box) ctx.overlay.push({ type: 'point', x: w / 2, y: h / 2, r: 6, color: colorFor(idx) });
    });
    ctx.masks = R.masks.map((m) => ({ name: m.name, iou: m.iou, box: m.box }));
    ctx.metrics['máscaras'] = R.masks.length;
    return out;
  },
};

export default [samObjetos];
