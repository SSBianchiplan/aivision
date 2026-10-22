/**
 * cv/operators/classical.js — CV-01 Classical Computer Vision.
 *
 * Cada operador é um objeto declarativo com o mesmo contrato que o backend
 * vai expor em GET /api/v1/operators (SPEC §6): op, label, group, params.
 * O nome em `op` é intencionalmente igual ao do OpenCV para a porta ser 1:1.
 *
 * Contrato de apply(src, p, state, ctx):
 *   src   ImageData de entrada (não mutar)
 *   p     params já validados/defaultados
 *   state objeto persistente entre frames deste nó
 *   ctx   { w, h, overlay[], frameIndex }
 *   →     ImageData novo (vindo do pool)
 */

import {
  alloc, allocLike, clone, toGray, fromGray, gaussKernel, separable,
  sobel, boxMean, histogram, otsu, clampi,
} from '../core.js';

const G = 'CV-01';

// ------------------------------------------------------------ cor

export const cvtColor = {
  op: 'imgproc.cvt_color',
  label: 'Grayscale',
  group: G,
  desc: 'Converte para luminância (Rec.601), igual ao cv2.COLOR_BGR2GRAY.',
  params: {},
  apply(src, p, state, ctx) {
    return fromGray(toGray(src), ctx.w, ctx.h);
  },
};

export const invert = {
  op: 'imgproc.bitwise_not',
  label: 'Invert',
  group: G,
  desc: 'Negativo da imagem.',
  params: {},
  apply(src) {
    const out = allocLike(src);
    const s = src.data, d = out.data;
    for (let i = 0; i < s.length; i += 4) {
      d[i] = 255 - s[i];
      d[i + 1] = 255 - s[i + 1];
      d[i + 2] = 255 - s[i + 2];
      d[i + 3] = 255;
    }
    return out;
  },
};

export const colorMap = {
  op: 'imgproc.apply_color_map',
  label: 'Color Map',
  group: G,
  desc: 'Mapeia intensidade em cor — leitura de mapas de calor e profundidade.',
  params: {
    map: { type: 'enum', options: ['jet', 'hot', 'viridis'], default: 'jet', label: 'Mapa' },
  },
  apply(src, p, state, ctx) {
    const gray = toGray(src);
    const out = alloc(ctx.w, ctx.h);
    const d = out.data;
    const lut = colorLut(p.map);
    for (let i = 0, q = 0; i < gray.length; i++, q += 4) {
      const c = (gray[i] * 3) | 0;
      d[q] = lut[c];
      d[q + 1] = lut[c + 1];
      d[q + 2] = lut[c + 2];
      d[q + 3] = 255;
    }
    return out;
  },
};

const lutCache = {};
function colorLut(name) {
  if (lutCache[name]) return lutCache[name];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r, g, b;
    if (name === 'hot') {
      r = Math.min(1, t * 3);
      g = Math.min(1, Math.max(0, t * 3 - 1));
      b = Math.min(1, Math.max(0, t * 3 - 2));
    } else if (name === 'viridis') {
      r = 0.28 + t * (0.99 - 0.28) * Math.pow(t, 0.6);
      g = 0.0 + t * 0.9;
      b = 0.33 + Math.sin(Math.PI * t) * 0.42 - t * 0.3;
    } else {
      // jet
      r = clamp01(1.5 - Math.abs(4 * t - 3));
      g = clamp01(1.5 - Math.abs(4 * t - 2));
      b = clamp01(1.5 - Math.abs(4 * t - 1));
    }
    lut[i * 3] = clamp01(r) * 255;
    lut[i * 3 + 1] = clamp01(g) * 255;
    lut[i * 3 + 2] = clamp01(b) * 255;
  }
  return (lutCache[name] = lut);
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ------------------------------------------------------------ suavização

export const gaussianBlur = {
  op: 'imgproc.gaussian_blur',
  label: 'Gaussian Blur',
  group: G,
  desc: 'Suavização gaussiana separável. sigma=0 deriva do ksize (fórmula OpenCV).',
  params: {
    ksize: { type: 'int', min: 1, max: 31, step: 2, default: 5, label: 'Kernel' },
    sigma: { type: 'float', min: 0, max: 10, step: 0.1, default: 0, label: 'Sigma' },
  },
  apply(src, p) {
    return separable(src, gaussKernel(p.ksize, p.sigma));
  },
};

export const boxBlur = {
  op: 'imgproc.blur',
  label: 'Box Blur',
  group: G,
  desc: 'Média simples — mais rápido que o gaussiano, borda mais dura.',
  params: {
    ksize: { type: 'int', min: 1, max: 31, step: 2, default: 5, label: 'Kernel' },
  },
  apply(src, p) {
    const k = new Float32Array(p.ksize).fill(1 / p.ksize);
    return separable(src, k);
  },
};

export const medianBlur = {
  op: 'imgproc.median_blur',
  label: 'Median Blur',
  group: G,
  desc: 'Mediana 3x3/5x5 — remove ruído sal-e-pimenta sem borrar bordas.',
  params: {
    ksize: { type: 'enum', options: [3, 5], default: 3, label: 'Kernel' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const out = new Uint8ClampedArray(w * h);
    const r = (p.ksize - 1) / 2;
    const win = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        win.length = 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = clampi(y + dy, 0, h - 1) * w;
          for (let dx = -r; dx <= r; dx++) {
            win.push(gray[yy + clampi(x + dx, 0, w - 1)]);
          }
        }
        win.sort((a, b) => a - b);
        out[y * w + x] = win[(win.length - 1) >> 1];
      }
    }
    return fromGray(out, w, h);
  },
};

// ------------------------------------------------------------ bordas

export const sobelOp = {
  op: 'imgproc.sobel',
  label: 'Sobel',
  group: G,
  desc: 'Magnitude do gradiente 3x3.',
  params: {
    scale: { type: 'float', min: 0.1, max: 4, step: 0.1, default: 1, label: 'Escala' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const { gx, gy } = sobel(toGray(src), w, h);
    const out = new Uint8ClampedArray(w * h);
    for (let i = 0; i < out.length; i++) {
      out[i] = Math.hypot(gx[i], gy[i]) * p.scale;
    }
    return fromGray(out, w, h);
  },
};

export const laplacian = {
  op: 'imgproc.laplacian',
  label: 'Laplacian',
  group: G,
  desc: 'Segunda derivada — realça detalhe fino e ruído.',
  params: {
    scale: { type: 'float', min: 0.1, max: 4, step: 0.1, default: 1, label: 'Escala' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = clampi(y - 1, 0, h - 1) * w, y1 = y * w, y2 = clampi(y + 1, 0, h - 1) * w;
      for (let x = 0; x < w; x++) {
        const x0 = clampi(x - 1, 0, w - 1), x2 = clampi(x + 1, 0, w - 1);
        const v = gray[y0 + x] + gray[y2 + x] + gray[y1 + x0] + gray[y1 + x2] - 4 * gray[y1 + x];
        out[y1 + x] = Math.abs(v) * p.scale;
      }
    }
    return fromGray(out, w, h);
  },
};

export const canny = {
  op: 'imgproc.canny',
  label: 'Canny',
  group: G,
  desc: 'Canny completo: gradiente → supressão não-máxima → histerese. ' +
        'Não borra internamente (igual ao cv2.Canny) — encadeie um blur antes.',
  params: {
    low: { type: 'int', min: 0, max: 255, step: 1, default: 50, label: 'Thresh baixo' },
    high: { type: 'int', min: 0, max: 255, step: 1, default: 150, label: 'Thresh alto' },
    l2: { type: 'bool', default: false, label: 'L2 gradient' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const { gx, gy } = sobel(gray, w, h);
    const n = w * h;

    // magnitude
    const mag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      mag[i] = p.l2 ? Math.hypot(gx[i], gy[i]) : Math.abs(gx[i]) + Math.abs(gy[i]);
    }

    // supressão não-máxima na direção do gradiente (quantizada em 4)
    const nms = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const ang = Math.atan2(gy[i], gx[i]) * (180 / Math.PI);
        const a = ((ang % 180) + 180) % 180;
        let a1, a2;
        if (a < 22.5 || a >= 157.5) { a1 = mag[i - 1]; a2 = mag[i + 1]; }
        else if (a < 67.5) { a1 = mag[i - w + 1]; a2 = mag[i + w - 1]; }
        else if (a < 112.5) { a1 = mag[i - w]; a2 = mag[i + w]; }
        else { a1 = mag[i - w - 1]; a2 = mag[i + w + 1]; }
        nms[i] = mag[i] >= a1 && mag[i] >= a2 ? mag[i] : 0;
      }
    }

    // histerese: forte vira borda; fraco só se conectado a forte (BFS)
    const lo = Math.min(p.low, p.high), hi = Math.max(p.low, p.high);
    const out = new Uint8ClampedArray(n);
    const stack = [];
    for (let i = 0; i < n; i++) {
      if (nms[i] >= hi) {
        out[i] = 255;
        stack.push(i);
      }
    }
    while (stack.length) {
      const i = stack.pop();
      const y = (i / w) | 0, x = i - y * w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= h || nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (out[j] === 0 && nms[j] >= lo) {
            out[j] = 255;
            stack.push(j);
          }
        }
      }
    }
    return fromGray(out, w, h);
  },
};

// ------------------------------------------------------------ limiar

export const threshold = {
  op: 'imgproc.threshold',
  label: 'Threshold',
  group: G,
  desc: 'Binarização global. Otsu escolhe o limiar automaticamente por frame.',
  params: {
    thresh: { type: 'int', min: 0, max: 255, step: 1, default: 127, label: 'Limiar' },
    otsu: { type: 'bool', default: false, label: 'Otsu (auto)' },
    inv: { type: 'bool', default: false, label: 'Inverter' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const t = p.otsu ? otsu(gray) : p.thresh;
    state.lastThresh = t; // exposto no painel de stats
    const out = new Uint8ClampedArray(w * h);
    for (let i = 0; i < gray.length; i++) {
      const on = gray[i] > t;
      out[i] = (p.inv ? !on : on) ? 255 : 0;
    }
    return fromGray(out, w, h);
  },
};

export const adaptiveThreshold = {
  op: 'imgproc.adaptive_threshold',
  label: 'Adaptive Threshold',
  group: G,
  desc: 'Limiar por vizinhança — aguenta iluminação desigual, útil antes de OCR.',
  params: {
    block: { type: 'int', min: 3, max: 51, step: 2, default: 11, label: 'Bloco' },
    C: { type: 'int', min: -30, max: 30, step: 1, default: 5, label: 'C' },
    inv: { type: 'bool', default: false, label: 'Inverter' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const mean = boxMean(gray, w, h, (p.block - 1) >> 1);
    const out = new Uint8ClampedArray(w * h);
    for (let i = 0; i < gray.length; i++) {
      const on = gray[i] > mean[i] - p.C;
      out[i] = (p.inv ? !on : on) ? 255 : 0;
    }
    return fromGray(out, w, h);
  },
};

// ------------------------------------------------------------ morfologia

export const morphology = {
  op: 'imgproc.morphology_ex',
  label: 'Morphology',
  group: G,
  desc: 'Erode/dilate e as composições open/close, com kernel retangular.',
  params: {
    mode: { type: 'enum', options: ['erode', 'dilate', 'open', 'close'], default: 'dilate', label: 'Operação' },
    ksize: { type: 'int', min: 1, max: 21, step: 2, default: 3, label: 'Kernel' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    let gray = toGray(src);
    const r = (p.ksize - 1) >> 1;
    const seq = p.mode === 'open' ? ['erode', 'dilate']
              : p.mode === 'close' ? ['dilate', 'erode']
              : [p.mode];
    for (const step of seq) gray = rank(gray, w, h, r, step === 'dilate');
    return fromGray(gray, w, h);
  },
};

/** Min/max separável (erode/dilate de kernel retangular). */
function rank(gray, w, h, r, isMax) {
  const pick = isMax ? Math.max : Math.min;
  const tmp = new Uint8ClampedArray(w * h);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = gray[row + x];
      for (let i = -r; i <= r; i++) v = pick(v, gray[row + clampi(x + i, 0, w - 1)]);
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let v = tmp[y * w + x];
      for (let i = -r; i <= r; i++) v = pick(v, tmp[clampi(y + i, 0, h - 1) * w + x]);
      out[y * w + x] = v;
    }
  }
  return out;
}

// ------------------------------------------------------------ realce

export const equalizeHist = {
  op: 'imgproc.equalize_hist',
  label: 'Equalize Hist',
  group: G,
  desc: 'Equalização global de histograma pela CDF.',
  params: {},
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const hist = histogram(gray);
    const cdf = new Uint8ClampedArray(256);
    const total = gray.length;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      cdf[i] = (acc / total) * 255;
    }
    const out = new Uint8ClampedArray(total);
    for (let i = 0; i < total; i++) out[i] = cdf[gray[i]];
    return fromGray(out, w, h);
  },
};

export const clahe = {
  op: 'imgproc.clahe',
  label: 'CLAHE',
  group: G,
  desc: 'Equalização adaptativa com limite de contraste, por tiles com ' +
        'interpolação bilinear — não estoura o ruído como a global.',
  params: {
    tiles: { type: 'int', min: 2, max: 16, step: 1, default: 8, label: 'Grade' },
    clip: { type: 'float', min: 1, max: 8, step: 0.5, default: 2, label: 'Clip limit' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const nx = p.tiles, ny = p.tiles;
    const tw = Math.ceil(w / nx), th = Math.ceil(h / ny);
    // uma LUT por tile
    const luts = [];
    for (let ty = 0; ty < ny; ty++) {
      for (let tx = 0; tx < nx; tx++) {
        const hist = new Uint32Array(256);
        const x0 = tx * tw, y0 = ty * th;
        const x1 = Math.min(x0 + tw, w), y1 = Math.min(y0 + th, h);
        let count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            hist[gray[y * w + x]]++;
            count++;
          }
        }
        // clip + redistribuição do excedente
        const limit = Math.max(1, (p.clip * count) / 256);
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > limit) {
            excess += hist[i] - limit;
            hist[i] = limit;
          }
        }
        const share = excess / 256;
        let acc = 0;
        const lut = new Uint8ClampedArray(256);
        for (let i = 0; i < 256; i++) {
          acc += hist[i] + share;
          lut[i] = (acc / count) * 255;
        }
        luts.push(lut);
      }
    }
    // interpolação bilinear entre as LUTs dos tiles vizinhos
    const out = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y++) {
      const fy = y / th - 0.5;
      const iy = Math.floor(fy);
      const wy = fy - iy;
      const y0 = clampi(iy, 0, ny - 1), y1 = clampi(iy + 1, 0, ny - 1);
      for (let x = 0; x < w; x++) {
        const fx = x / tw - 0.5;
        const ix = Math.floor(fx);
        const wx = fx - ix;
        const x0 = clampi(ix, 0, nx - 1), x1 = clampi(ix + 1, 0, nx - 1);
        const v = gray[y * w + x];
        const a = luts[y0 * nx + x0][v], b = luts[y0 * nx + x1][v];
        const c = luts[y1 * nx + x0][v], d = luts[y1 * nx + x1][v];
        out[y * w + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
      }
    }
    return fromGray(out, w, h);
  },
};

export const brightnessContrast = {
  op: 'photo.convert_scale_abs',
  label: 'Brightness / Contrast',
  group: G,
  desc: 'Ajuste linear: out = alpha·in + beta.',
  params: {
    alpha: { type: 'float', min: 0.1, max: 3, step: 0.05, default: 1, label: 'Contraste' },
    beta: { type: 'int', min: -100, max: 100, step: 1, default: 0, label: 'Brilho' },
  },
  apply(src, p) {
    const out = allocLike(src);
    const s = src.data, d = out.data;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = i * p.alpha + p.beta;
    for (let i = 0; i < s.length; i += 4) {
      d[i] = lut[s[i]];
      d[i + 1] = lut[s[i + 1]];
      d[i + 2] = lut[s[i + 2]];
      d[i + 3] = 255;
    }
    return out;
  },
};

export const flip = {
  op: 'core.flip',
  label: 'Flip',
  group: G,
  desc: 'Espelha horizontal e/ou vertical.',
  params: {
    h: { type: 'bool', default: true, label: 'Horizontal' },
    v: { type: 'bool', default: false, label: 'Vertical' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const out = alloc(w, h);
    const s = src.data, d = out.data;
    for (let y = 0; y < h; y++) {
      const sy = p.v ? h - 1 - y : y;
      for (let x = 0; x < w; x++) {
        const sx = p.h ? w - 1 - x : x;
        const sp = (sy * w + sx) * 4, dp = (y * w + x) * 4;
        d[dp] = s[sp];
        d[dp + 1] = s[sp + 1];
        d[dp + 2] = s[sp + 2];
        d[dp + 3] = 255;
      }
    }
    return out;
  },
};

export default [
  cvtColor, invert, colorMap,
  gaussianBlur, boxBlur, medianBlur,
  sobelOp, laplacian, canny,
  threshold, adaptiveThreshold,
  morphology,
  equalizeHist, clahe, brightnessContrast, flip,
];
