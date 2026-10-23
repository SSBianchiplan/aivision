/**
 * cv/operators/livres-a/recorte.js — CV-20 Recorte de fundo (BiRefNet lite, MIT).
 *
 * O PP-HumanSeg do CV-05 só conhece PESSOA e devolve 192², com borda em
 * degraus. O BiRefNet é de "dichotomous image segmentation": separa o objeto
 * principal da cena — gente, bicho, produto na bancada — com borda de matting
 * (fios, alças, raios de bicicleta), saída contínua 0..1.
 *
 * Modelo reexportado em 512² (o ONNX público é cravado em 1024², ~17 s por
 * imagem na CPU e > 4 GB de memória; ver models-livres-a.js). Na CPU do WASM
 * ainda é lento — um a alguns segundos por inferência — então o padrão é
 * inferir de vez em quando e compor TODO frame com a última máscara: para
 * câmera parada (bancada, retrato) isso basta. Com WebGPU fica bem mais ágil.
 *
 * Modos:
 *   - remover fundo (xadrez): fundo vira o xadrez clássico de "transparente";
 *   - transparente (alfa): grava a máscara no canal alfa (para exportar PNG);
 *   - fundo escuro, desfocar fundo, croma (verde), só máscara.
 *
 * Publica ctx.mask = { data, w, h } (probabilidade 0..1 de primeiro plano).
 */
import { clone, alloc, camadaNova, camadaPintar, camadaPor, usarCamada } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { stretch, toTensorData } from '../../runtime/tensor.js';
import { ensure, schedule, bilinear, sigmoid } from '../../runtime/opkit.js';

const G = 'CV-20';
/** Modos que são uma camada sobre o vídeo (o fundo vira cor/xadrez; o objeto fica o da fonte, nítido). */
const MODOS_CAMADA = new Set(['remover fundo (xadrez)', 'fundo escuro', 'croma']);
const M = 'birefnet-lite';

// canvases próprios para o desfoque (o scratch do tensor.js é de outro dono)
let cv1 = null, cv2 = null;
function canvas(c, w, h) {
  if (!c) c = document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
/**
 * Desfoque barato pela GPU do canvas: reduz por um fator ~raio/2 e amplia de
 * volta com suavização. Dois passes (1/f e depois 1/2f) tiram o aspecto de
 * blocos. Custa uma fração de um gaussiano separável de raio 20 em JS.
 */
function desfocado(src, raio) {
  const w = src.width, h = src.height, f = Math.max(2, raio / 2);
  cv1 = canvas(cv1, w, h);
  const c1 = cv1.getContext('2d', { willReadFrequently: true });
  c1.putImageData(src, 0, 0);
  const sw = Math.max(1, Math.round(w / f)), sh = Math.max(1, Math.round(h / f));
  cv2 = canvas(cv2, sw, sh);
  const c2 = cv2.getContext('2d');
  c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high';
  c2.drawImage(cv1, 0, 0, w, h, 0, 0, sw, sh);
  c1.imageSmoothingEnabled = true; c1.imageSmoothingQuality = 'high';
  c1.clearRect(0, 0, w, h);
  c1.drawImage(cv2, 0, 0, sw, sh, 0, 0, w, h);
  return c1.getImageData(0, 0, w, h);
}

export const recorteFundo = {
  op: 'seg.birefnet',
  label: 'Recorte de fundo (BiRefNet)',
  group: G, model: M,
  // desfocar fundo (o fundo é o quadro atual desfocado), alfa e só máscara continuam trocando a imagem
  overlayOnly: (p) => MODOS_CAMADA.has(p.modo),
  desc: 'Separa o objeto principal do fundo com borda fina (cabelo, fios, alças), para qualquer ' +
        'coisa — não só pessoas. Modos: remover fundo (xadrez ou canal alfa), fundo escuro, ' +
        'desfocar fundo, croma verde ou só a máscara. Lento na CPU: infere a cada intervalo e ' +
        'reaproveita a última máscara.',
  params: {
    modo: { type: 'enum', options: ['remover fundo (xadrez)', 'transparente (alfa)', 'fundo escuro', 'desfocar fundo', 'croma', 'só máscara'],
            default: 'remover fundo (xadrez)', label: 'Modo' },
    dureza: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.3, label: 'Dureza da borda' },
    limiar: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.5, label: 'Limiar (borda dura)' },
    raio: { type: 'int', min: 4, max: 60, step: 2, default: 16, label: 'Raio do desfoque (px)' },
    escuro: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.15, label: 'Brilho do fundo escuro' },
    everyMs: { type: 'int', min: 0, max: 10000, step: 100, default: 1500, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure(M, state, ctx)) return clone(src);
    const spec = MODELS[M];
    const S = spec.input[2];
    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, S, S), spec),
      async (data) => {
        const out = await run(M, await makeTensor(data, spec.input));
        const o = out[Object.keys(out)[0]];
        const W = o.dims[o.dims.length - 1], H = o.dims[o.dims.length - 2];
        const m = new Float32Array(W * H);
        for (let i = 0; i < m.length; i++) m[i] = sigmoid(o.data[i]);      // logits -> 0..1
        return { m, W, H };
      });

    if (state.inferMs) ctx.metrics['birefnet ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['birefnet erro'] = state.error;
    const R = state.results;
    if (!R) return clone(src);
    const { w, h } = ctx;
    const { m, W, H } = R;
    ctx.mask = { data: m, w: W, h: H };
    // dureza 0 = alfa contínuo do modelo; 1 = degrau no limiar
    const ganho = 1 / Math.max(0.02, 1 - p.dureza);
    const kx = W / w, ky = H / h;

    if (MODOS_CAMADA.has(p.modo)) {
      /*
       * O fundo entra com alfa (1 − a) sobre o vídeo nítido: xadrez de 12 px,
       * preto até o «brilho do fundo escuro» ou verde croma (0,177,64). Mesma
       * conta da mistura nos pixels; montada uma vez por máscara.
       */
      const prim = camadaPor(state, [R, w, h, p.modo, p.dureza, p.limiar, p.escuro], () => {
        const L = camadaNova(w, h), od = L.data;
        let frente = 0;
        for (let y = 0; y < h; y++) {
          const fy = (y + 0.5) * ky - 0.5;
          for (let x = 0; x < w; x++) {
            let a = bilinear(m, W, H, (x + 0.5) * kx - 0.5, fy);
            if (p.dureza > 0) a = Math.min(1, Math.max(0, (a - p.limiar) * ganho + 0.5));
            if (a >= 0.5) frente++;
            const q = (y * w + x) * 4, b = 1 - a;
            if (p.modo === 'fundo escuro') camadaPintar(od, q, 0, 0, 0, (1 - p.escuro) * b);
            else if (p.modo === 'croma') camadaPintar(od, q, 0, 177, 64, b);
            else { const c = ((x / 12) ^ (y / 12)) & 1 ? 204 : 255; camadaPintar(od, q, c, c, c, b); }
          }
        }
        state.frente = frente / (w * h);
        return L;
      });
      ctx.metrics['primeiro plano'] = ((state.frente || 0) * 100).toFixed(1) + '%';
      return usarCamada(src, ctx, prim);
    }

    const out = alloc(w, h);
    const od = out.data, sd = src.data;
    const fundo = p.modo === 'desfocar fundo' ? desfocado(src, p.raio).data : null;
    let frente = 0;
    for (let y = 0; y < h; y++) {
      const fy = (y + 0.5) * ky - 0.5;
      for (let x = 0; x < w; x++) {
        let a = bilinear(m, W, H, (x + 0.5) * kx - 0.5, fy);
        if (p.dureza > 0) a = Math.min(1, Math.max(0, (a - p.limiar) * ganho + 0.5));
        if (a >= 0.5) frente++;
        const q = (y * w + x) * 4, b = 1 - a;
        let r, g, bl, al = 255;
        switch (p.modo) {
          case 'transparente (alfa)':
            r = sd[q]; g = sd[q + 1]; bl = sd[q + 2]; al = a * 255; break;
          case 'fundo escuro': {
            const k = p.escuro + (1 - p.escuro) * a;
            r = sd[q] * k; g = sd[q + 1] * k; bl = sd[q + 2] * k; break;
          }
          case 'desfocar fundo':
            r = sd[q] * a + fundo[q] * b; g = sd[q + 1] * a + fundo[q + 1] * b; bl = sd[q + 2] * a + fundo[q + 2] * b; break;
          case 'croma':
            r = sd[q] * a; g = sd[q + 1] * a + 177 * b; bl = sd[q + 2] * a + 64 * b; break;
          case 'só máscara':
            r = g = bl = a * 255; break;
          default: {
            // xadrez de 12 px, cinza claro/escuro, como os editores mostram "transparente"
            const c = ((x / 12) ^ (y / 12)) & 1 ? 204 : 255;
            r = sd[q] * a + c * b; g = sd[q + 1] * a + c * b; bl = sd[q + 2] * a + c * b;
          }
        }
        od[q] = r; od[q + 1] = g; od[q + 2] = bl; od[q + 3] = al;
      }
    }
    ctx.metrics['primeiro plano'] = ((frente / (w * h)) * 100).toFixed(1) + '%';
    return out;
  },
};

export default [recorteFundo];
