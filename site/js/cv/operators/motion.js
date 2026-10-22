/**
 * cv/operators/motion.js — operadores COM ESTADO entre frames.
 *
 * Provam que o executor mantém `state` por nó ao longo do tempo. É o
 * mesmo mecanismo que o tracking (CV-04) vai usar para carregar IDs de
 * track de um frame para o próximo.
 */

import { alloc, fromGray, toGray, clone } from '../core.js';

const G = 'CV-04';

export const frameDiff = {
  op: 'video.frame_diff',
  label: 'Frame Difference',
  group: G,
  desc: 'absdiff contra o frame anterior. O jeito mais barato de detectar ' +
        'movimento — e a baseline honesta para comparar com detectores.',
  params: {
    thresh: { type: 'int', min: 0, max: 120, step: 1, default: 18, label: 'Limiar' },
    amplify: { type: 'float', min: 1, max: 10, step: 0.5, default: 3, label: 'Ganho' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    if (!state.prev || state.prev.length !== gray.length) {
      state.prev = new Uint8ClampedArray(gray);
      return fromGray(gray, w, h);
    }
    const out = new Uint8ClampedArray(gray.length);
    let moved = 0;
    for (let i = 0; i < gray.length; i++) {
      const d = Math.abs(gray[i] - state.prev[i]);
      if (d > p.thresh) {
        out[i] = Math.min(255, d * p.amplify);
        moved++;
      }
    }
    state.prev.set(gray);
    ctx.metrics.motion = ((moved / gray.length) * 100).toFixed(1) + '%';
    return fromGray(out, w, h);
  },
};

export const backgroundSubtract = {
  op: 'video.background_subtractor',
  label: 'Background Subtract',
  group: G,
  desc: 'Modelo de fundo por média corrente (aproximação leve do MOG2). ' +
        'Aprende a cena e destaca o que não pertence a ela.',
  params: {
    rate: { type: 'float', min: 0.005, max: 0.3, step: 0.005, default: 0.04, label: 'Taxa de aprendizado' },
    thresh: { type: 'int', min: 5, max: 120, step: 1, default: 28, label: 'Limiar' },
    mask: { type: 'bool', default: false, label: 'Só a máscara' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const n = gray.length;
    if (!state.bg || state.bg.length !== n) {
      state.bg = new Float32Array(n);
      for (let i = 0; i < n; i++) state.bg[i] = gray[i];
    }
    const bg = state.bg;
    const a = p.rate;
    let fg = 0;

    if (p.mask) {
      const out = new Uint8ClampedArray(n);
      for (let i = 0; i < n; i++) {
        const on = Math.abs(gray[i] - bg[i]) > p.thresh;
        if (on) fg++;
        out[i] = on ? 255 : 0;
        bg[i] = bg[i] * (1 - a) + gray[i] * a;
      }
      ctx.metrics.foreground = ((fg / n) * 100).toFixed(1) + '%';
      return fromGray(out, w, h);
    }

    // mantém a cor no primeiro plano, escurece o fundo
    const out = alloc(w, h);
    const s = src.data, d = out.data;
    for (let i = 0, q = 0; i < n; i++, q += 4) {
      const on = Math.abs(gray[i] - bg[i]) > p.thresh;
      if (on) fg++;
      const k = on ? 1 : 0.15;
      d[q] = s[q] * k;
      d[q + 1] = s[q + 1] * k;
      d[q + 2] = s[q + 2] * k;
      d[q + 3] = 255;
      bg[i] = bg[i] * (1 - a) + gray[i] * a;
    }
    ctx.metrics.foreground = ((fg / n) * 100).toFixed(1) + '%';
    return out;
  },
};

export const trails = {
  op: 'video.motion_trails',
  label: 'Motion Trails',
  group: G,
  desc: 'Decaimento temporal — o movimento deixa rastro. Bom para visualizar ' +
        'trajetória antes de existir tracking de verdade.',
  params: {
    decay: { type: 'float', min: 0.5, max: 0.98, step: 0.01, default: 0.88, label: 'Persistência' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const n = gray.length;
    if (!state.acc || state.acc.length !== n) state.acc = new Float32Array(n);
    if (!state.prev || state.prev.length !== n) {
      state.prev = new Uint8ClampedArray(gray);
      return fromGray(gray, w, h);
    }
    const acc = state.acc;
    const out = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const d = Math.abs(gray[i] - state.prev[i]);
      acc[i] = Math.max(acc[i] * p.decay, d * 4);
      out[i] = acc[i];
    }
    state.prev.set(gray);
    return fromGray(out, w, h);
  },
};

export default [frameDiff, backgroundSubtract, trails];
