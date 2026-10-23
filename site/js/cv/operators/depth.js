/**
 * cv/operators/depth.js — CV-14 Profundidade (Depth Anything V2 small, Apache-2.0).
 *
 * Um único frame RGB -> mapa de profundidade RELATIVA (inversa: maior = mais
 * perto), 518×518, int8. Não é metro: é ordem — o que está na frente do quê.
 * Normalizado por frame com uma média móvel dos extremos, para o mapa não
 * piscar. Publica ctx.depth para quem vier depois; com detector antes na
 * cadeia, rotula cada objeto como perto / médio / longe pela mediana da caixa.
 */
import { clone, alloc, camadaNova, camadaPintar, camadaPor, usarCamada } from '../core.js';
import { MODELS, run, makeTensor } from '../runtime/onnx.js';
import { stretch, toTensorData } from '../runtime/tensor.js';
import { ensure, schedule, bilinear, detectionsFromCtx, colorFor } from '../runtime/opkit.js';

const G = 'CV-14';

// rampa "turbo" resumida em 8 pontos (perto = vermelho/amarelo, longe = azul)
const TURBO = [[48, 18, 59], [70, 107, 227], [40, 187, 208], [67, 235, 108], [190, 230, 40], [250, 170, 32], [230, 80, 22], [122, 4, 3]];
function cor(t) {
  const u = Math.min(0.9999, Math.max(0, t)) * (TURBO.length - 1), i = u | 0, f = u - i;
  const a = TURBO[i], b = TURBO[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const depthMap = {
  op: 'depth.map',
  label: 'Profundidade (Depth Anything V2)',
  group: G, model: 'depth-anything',
  desc: 'Mapa de profundidade relativa de um só frame, 24,8M parâmetros, int8. ' +
        'Modos: mapa de cor (perto quente, longe frio), cinza, mistura com o vídeo, ' +
        'ou só rotular os objetos detectados como perto/médio/longe.',
  // «misturar» é uma camada sobre o vídeo nítido e «só objetos» só rotula; os mapas cheios trocam a imagem
  overlayOnly: (p) => p.modo === 'misturar' || p.modo === 'só objetos',
  params: {
    modo: { type: 'enum', options: ['mapa de cor', 'cinza', 'misturar', 'só objetos'], default: 'misturar', label: 'Modo' },
    alpha: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.6, label: 'Opacidade (misturar)' },
    inverter: { type: 'bool', default: false, label: 'Inverter (longe quente)' },
    suavizar: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0.7, label: 'Estabilidade dos extremos' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 300, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('depth-anything', state, ctx)) return clone(src);
    const spec = MODELS['depth-anything'];
    const S = spec.input[2];
    schedule(state, p.everyMs,
      () => toTensorData(stretch(src, S, S), spec),
      async (data) => {
        const t = await makeTensor(data, spec.input);
        const out = await run('depth-anything', t);
        const o = out[Object.keys(out)[0]];
        const d = Float32Array.from(o.data), H = o.dims[o.dims.length - 2], W = o.dims[o.dims.length - 1];
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < d.length; i++) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; }
        return { d, W, H, lo, hi };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['depth ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['depth erro'] = state.error;
    if (!R) return clone(src);
    // extremos com média móvel: o mapa não pisca quando a cena muda pouco
    if (state.lo === undefined) { state.lo = R.lo; state.hi = R.hi; }
    else { state.lo = state.lo * p.suavizar + R.lo * (1 - p.suavizar); state.hi = state.hi * p.suavizar + R.hi * (1 - p.suavizar); }
    const lo = state.lo, span = Math.max(1e-6, state.hi - lo);
    const { w, h } = ctx;
    const { d, W, H } = R;
    ctx.depth = { data: d, w: W, h: H, lo, hi: state.hi };

    const dets = detectionsFromCtx(ctx, 32);
    if (dets) {
      // mediana da profundidade dentro de cada caixa (amostra 7×7)
      const vals = dets.map((b) => {
        const arr = [];
        for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
          const fx = (b.x1 + (b.x2 - b.x1) * (i + 0.5) / 7) * W, fy = (b.y1 + (b.y2 - b.y1) * (j + 0.5) / 7) * H;
          arr.push(bilinear(d, W, H, fx, fy));
        }
        arr.sort((a, c) => a - c);
        return (arr[24] - lo) / span;              // 0 longe … 1 perto
      });
      dets.forEach((b, i) => {
        const t = vals[i];
        const rot = t > 0.66 ? 'perto' : t > 0.33 ? 'médio' : 'longe';
        ctx.overlay.push({ type: 'banner', x: b.x1 * w, y: b.y2 * h - 22, text: `${b.name}: ${rot} (${(t * 100) | 0})`, color: `rgb(${cor(p.inverter ? 1 - t : t).map(Math.round).join(',')})` });
        b.depth = t; b.depthLabel = rot;
      });
      ctx.metrics['perto'] = vals.filter((v) => v > 0.66).length;
    }
    if (p.modo === 'só objetos') return clone(src);

    const legenda = { type: 'banner', x: 10, y: h - 30, text: p.inverter ? 'frio = perto · quente = longe' : 'quente = perto · frio = longe', color: '#FFD84D' };
    if (p.modo === 'misturar') {
      /*
       * Camada com o mapa de cor a `alpha` sobre o vídeo nítido. Os extremos
       * andam um pouco a cada quadro (média móvel): remonta quando o
       * resultado muda ou os extremos andaram mais de 1% da faixa.
       */
      const ch = state.camadaChave;
      const lo0 = ch && ch[0] === R && ch[1] === w && ch[2] === h && ch[3] === p.alpha && ch[4] === p.inverter
        && Math.abs(ch[5] - lo) < span * 0.01 && Math.abs(ch[6] - state.hi) < span * 0.01 ? ch[5] : lo;
      const hi0 = lo0 === lo ? state.hi : ch[6];
      const prim = camadaPor(state, [R, w, h, p.alpha, p.inverter, lo0, hi0], () => {
        const L = camadaNova(w, h), od = L.data;
        const kx = W / w, ky = H / h, sp = Math.max(1e-6, hi0 - lo0);
        for (let y = 0; y < h; y++) {
          const fy = (y + 0.5) * ky - 0.5;
          for (let x = 0; x < w; x++) {
            let t = (bilinear(d, W, H, (x + 0.5) * kx - 0.5, fy) - lo0) / sp;
            t = Math.min(1, Math.max(0, t));
            if (p.inverter) t = 1 - t;
            const [r, g, b] = cor(t);
            camadaPintar(od, (y * w + x) * 4, r, g, b, p.alpha);
          }
        }
        return L;
      });
      const saida = usarCamada(src, ctx, prim);
      ctx.overlay.push(legenda);
      return saida;
    }

    const out = alloc(w, h);
    const od = out.data, sd = src.data;
    const kx = W / w, ky = H / h;
    const mist = p.modo === 'misturar' ? p.alpha : 1;
    for (let y = 0; y < h; y++) {
      const fy = (y + 0.5) * ky - 0.5;
      for (let x = 0; x < w; x++) {
        let t = (bilinear(d, W, H, (x + 0.5) * kx - 0.5, fy) - lo) / span;
        t = Math.min(1, Math.max(0, t));
        if (p.inverter) t = 1 - t;
        const q = (y * w + x) * 4;
        let r, g, b;
        if (p.modo === 'cinza') { r = g = b = t * 255; }
        else { [r, g, b] = cor(t); }
        od[q] = sd[q] * (1 - mist) + r * mist;
        od[q + 1] = sd[q + 1] * (1 - mist) + g * mist;
        od[q + 2] = sd[q + 2] * (1 - mist) + b * mist;
        od[q + 3] = 255;
      }
    }
    ctx.overlay.push(legenda);
    return out;
  },
};

export default [depthMap];
