/**
 * cv/operators/features.js — cantos, contornos e blobs.
 *
 * Estes operadores demonstram o canal de OVERLAY: em vez de queimar o
 * desenho nos pixels, empurram formas vetoriais em ctx.overlay e o Viewport
 * desenha com Canvas2D. É o mesmo caminho que bbox/keypoints/máscara vão
 * usar quando CV-03/CV-06 entrarem — o desenho nunca destrói a imagem.
 */

import { clone, toGray, sobel, boxMean, clampi } from '../core.js';

const G = 'CV-01';

export const harris = {
  op: 'features.good_features_to_track',
  label: 'Corner Detection',
  group: G,
  desc: 'Cantos de Harris (R = det − k·tr²) com supressão não-máxima. ' +
        'Saída vai no overlay, não nos pixels.',
  params: {
    quality: { type: 'float', min: 0.01, max: 0.5, step: 0.01, default: 0.08, label: 'Qualidade' },
    maxCorners: { type: 'int', min: 10, max: 500, step: 10, default: 120, label: 'Máx. cantos' },
    minDist: { type: 'int', min: 3, max: 40, step: 1, default: 10, label: 'Dist. mín.' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const { gx, gy } = sobel(gray, w, h);
    const n = w * h;

    // tensor de estrutura, suavizado por janela box
    const ixx = new Float32Array(n), iyy = new Float32Array(n), ixy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      ixx[i] = gx[i] * gx[i];
      iyy[i] = gy[i] * gy[i];
      ixy[i] = gx[i] * gy[i];
    }
    const sxx = boxMean(ixx, w, h, 2), syy = boxMean(iyy, w, h, 2), sxy = boxMean(ixy, w, h, 2);

    const R = new Float32Array(n);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      const det = sxx[i] * syy[i] - sxy[i] * sxy[i];
      const tr = sxx[i] + syy[i];
      const r = det - 0.04 * tr * tr;
      R[i] = r;
      if (r > maxR) maxR = r;
    }

    // candidatos acima do limiar relativo, ordenados por resposta
    const thresh = maxR * p.quality;
    const cand = [];
    for (let y = 3; y < h - 3; y++) {
      for (let x = 3; x < w - 3; x++) {
        const i = y * w + x;
        if (R[i] < thresh) continue;
        // máximo local 3x3
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (R[i + dy * w + dx] > R[i]) { isMax = false; break; }
          }
        }
        if (isMax) cand.push([R[i], x, y]);
      }
    }
    cand.sort((a, b) => b[0] - a[0]);

    // distância mínima entre cantos aceitos
    const kept = [];
    const d2 = p.minDist * p.minDist;
    for (const [, x, y] of cand) {
      if (kept.length >= p.maxCorners) break;
      let ok = true;
      for (const k of kept) {
        const ddx = k.x - x, ddy = k.y - y;
        if (ddx * ddx + ddy * ddy < d2) { ok = false; break; }
      }
      if (ok) kept.push({ x, y });
    }

    for (const k of kept) {
      ctx.overlay.push({ type: 'point', x: k.x, y: k.y, r: 3, color: '#FFD84D' });
    }
    state.count = kept.length;
    ctx.metrics.corners = kept.length;
    return clone(src);
  },
};

export const contours = {
  op: 'imgproc.find_contours',
  label: 'Contours / Blobs',
  group: G,
  desc: 'Rotula componentes conexos de uma imagem binária e desenha a caixa ' +
        'de cada blob. Encadeie depois de um Threshold.',
  params: {
    minArea: { type: 'int', min: 10, max: 20000, step: 10, default: 300, label: 'Área mín. (px)' },
    maxBlobs: { type: 'int', min: 1, max: 200, step: 1, default: 40, label: 'Máx. blobs' },
    showArea: { type: 'bool', default: false, label: 'Mostrar área' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gray = toGray(src);
    const n = w * h;
    const labels = new Int32Array(n).fill(-1);
    const boxes = [];
    const queue = new Int32Array(n); // BFS iterativo: recursão estoura a stack

    for (let i = 0; i < n; i++) {
      if (gray[i] < 128 || labels[i] !== -1) continue;
      const id = boxes.length;
      let head = 0, tail = 0;
      queue[tail++] = i;
      labels[i] = id;
      let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;

      while (head < tail) {
        const j = queue[head++];
        const y = (j / w) | 0, x = j - y * w;
        area++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // vizinhança-4
        if (x > 0 && gray[j - 1] >= 128 && labels[j - 1] === -1) { labels[j - 1] = id; queue[tail++] = j - 1; }
        if (x < w - 1 && gray[j + 1] >= 128 && labels[j + 1] === -1) { labels[j + 1] = id; queue[tail++] = j + 1; }
        if (y > 0 && gray[j - w] >= 128 && labels[j - w] === -1) { labels[j - w] = id; queue[tail++] = j - w; }
        if (y < h - 1 && gray[j + w] >= 128 && labels[j + w] === -1) { labels[j + w] = id; queue[tail++] = j + w; }
      }
      boxes.push({ minX, minY, maxX, maxY, area });
    }

    const big = boxes.filter((b) => b.area >= p.minArea)
                     .sort((a, b) => b.area - a.area)
                     .slice(0, p.maxBlobs);

    for (const b of big) {
      ctx.overlay.push({
        type: 'rect',
        x: b.minX, y: b.minY, w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1,
        color: '#22d3ee',
        label: p.showArea ? String(b.area) + 'px' : null,
      });
    }
    state.count = big.length;
    ctx.metrics.blobs = big.length;
    return clone(src);
  },
};

export default [harris, contours];
