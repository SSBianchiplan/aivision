/**
 * cv/runtime/livres-u/imagem.js — utilitários de imagem da onda 2-d (grupo U),
 * sem DOM e sem modelo: testáveis em Node com um ImageData falso.
 *
 *   cinza            luma Rec.601 numa ROI (px), opcionalmente reduzida
 *   otsu             limiar de Otsu de um histograma de 256
 *   componentes      componentes conexos (4-vizinhos) de uma máscara binária
 *   homografia       DLT de 4 pontos (sistema 8×8) e aplicação
 *   laplacianoVar    nitidez (variância do Laplaciano)
 *   miniGray         miniatura em cinza (área) para comparar quadros
 *   histHSV          histograma HSV 8×4×4 normalizado
 */

/** Luma (0–255) da ROI {x,y,w,h} (px) num Float32Array w×h. */
export function cinza(img, roi = null) {
  const W = img.width, H = img.height, d = img.data;
  const x0 = roi ? Math.max(0, Math.round(roi.x)) : 0, y0 = roi ? Math.max(0, Math.round(roi.y)) : 0;
  const w = roi ? Math.min(W - x0, Math.round(roi.w)) : W, h = roi ? Math.min(H - y0, Math.round(roi.h)) : H;
  const g = new Float32Array(Math.max(0, w) * Math.max(0, h));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const q = ((y0 + y) * W + x0 + x) * 4;
      g[y * w + x] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
    }
  }
  return { g, w, h, x0, y0 };
}

/** Limiar de Otsu sobre um histograma de 256 posições com `n` amostras. */
export function otsu(hist, n) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/** Otsu direto de um plano (valores 0–255). */
export function otsuPlano(g) {
  const h = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) h[Math.max(0, Math.min(255, g[i] | 0))]++;
  return otsu(h, g.length);
}

/**
 * Componentes conexos (4-vizinhos) de `m` (Uint8Array w×h, 1 = frente).
 * Devolve [{ area, cx, cy, x1, y1, x2, y2 }] (px da máscara).
 */
export function componentes(m, w, h, minArea = 1) {
  const rot = new Int32Array(w * h);
  const out = [];
  const pilha = [];
  let id = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || rot[i]) continue;
    id++;
    let area = 0, sx = 0, sy = 0, x1 = w, y1 = h, x2 = -1, y2 = -1;
    rot[i] = id; pilha.push(i);
    while (pilha.length) {
      const j = pilha.pop(), x = j % w, y = (j / w) | 0;
      area++; sx += x; sy += y;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (x > 0 && m[j - 1] && !rot[j - 1]) { rot[j - 1] = id; pilha.push(j - 1); }
      if (x < w - 1 && m[j + 1] && !rot[j + 1]) { rot[j + 1] = id; pilha.push(j + 1); }
      if (y > 0 && m[j - w] && !rot[j - w]) { rot[j - w] = id; pilha.push(j - w); }
      if (y < h - 1 && m[j + w] && !rot[j + w]) { rot[j + w] = id; pilha.push(j + w); }
    }
    if (area >= minArea) out.push({ id, area, cx: sx / area, cy: sy / area, x1, y1, x2, y2 });
  }
  return { comps: out, rot };
}

// ------------------------------------------------------------------ homografia

/** Resolve A·x = b (n×n) por eliminação de Gauss com pivoteamento parcial. null se singular. */
export function resolver(A, b) {
  const n = b.length;
  const M = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/** Homografia H (3×3, h33 = 1) que leva src[i] → dst[i] (4 pares [x,y]). */
export function homografia(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = resolver(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function aplicarH(H, x, y) {
  const z = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z];
}

// ------------------------------------------------------------------ nitidez e assinatura

/** Variância do Laplaciano (4-vizinhos) de um plano cinza w×h. */
export function laplacianoVar(g, w, h) {
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      s += l; s2 += l * l; n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

/** Miniatura cinza (média por área) de tamanho tw×th. */
export function miniGray(img, tw = 64, th = 36) {
  const W = img.width, H = img.height, d = img.data;
  const out = new Float32Array(tw * th), cnt = new Uint32Array(tw * th);
  const passo = Math.max(1, Math.floor(Math.min(W / tw, H / th) / 3));
  for (let y = 0; y < H; y += passo) {
    const ty = Math.min(th - 1, (y * th / H) | 0);
    for (let x = 0; x < W; x += passo) {
      const tx = Math.min(tw - 1, (x * tw / W) | 0), q = (y * W + x) * 4, k = ty * tw + tx;
      out[k] += 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]; cnt[k]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= Math.max(1, cnt[i]);
  return out;
}

/** Histograma HSV 8 (H) × 4 (S) × 4 (V), normalizado (soma 1), amostrado em grade. */
export function histHSV(img, passoAlvo = 4000) {
  const W = img.width, H = img.height, d = img.data;
  const hst = new Float32Array(128);
  const passo = Math.max(1, Math.floor(Math.sqrt((W * H) / passoAlvo)));
  let n = 0;
  for (let y = 0; y < H; y += passo) {
    for (let x = 0; x < W; x += passo) {
      const q = (y * W + x) * 4, r = d[q] / 255, g = d[q + 1] / 255, b = d[q + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
      let hh = 0;
      if (c > 1e-6) {
        if (mx === r) hh = ((g - b) / c + 6) % 6; else if (mx === g) hh = (b - r) / c + 2; else hh = (r - g) / c + 4;
      }
      const s = mx > 0 ? c / mx : 0;
      const hi = Math.min(7, (hh / 6 * 8) | 0), si = Math.min(3, (s * 4) | 0), vi = Math.min(3, (mx * 4) | 0);
      hst[hi * 16 + si * 4 + vi]++; n++;
    }
  }
  for (let i = 0; i < 128; i++) hst[i] /= Math.max(1, n);
  return hst;
}

/** Distância de Bhattacharyya (0 = iguais, 1 = disjuntos) entre histogramas normalizados. */
export function bhattacharyya(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.sqrt(a[i] * b[i]);
  return Math.sqrt(Math.max(0, 1 - s));
}

/** Retângulo (px) de uma marcação de área do ctx.marcacoes (caixa em 0–1). */
export function roiDe(item, w, h) {
  if (!item || !item.caixa) return null;
  const c = item.caixa;
  const x1 = Math.max(0, Math.min(w, c.x1 * w)), x2 = Math.max(0, Math.min(w, c.x2 * w));
  const y1 = Math.max(0, Math.min(h, c.y1 * h)), y2 = Math.max(0, Math.min(h, c.y2 * h));
  if (x2 - x1 < 4 || y2 - y1 < 4) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Ponto (px) dentro de um polígono (px) — par-ímpar. */
export function dentroPoligono(x, y, pts) {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** Mediana de um array numérico (cópia). */
export function mediana(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Cópia reduzida (média de caixa) com largura ≤ maxW; ImageData nova (fora do pool). */
export function reduzir(src, maxW = 320) {
  const W = src.width, H = src.height, k = Math.max(1, Math.ceil(W / maxW));
  const w = Math.max(1, Math.floor(W / k)), h = Math.max(1, Math.floor(H / k));
  const out = new ImageData(w, h), s = src.data, d = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let yy = 0; yy < k; yy++) { let q = ((y * k + yy) * W + x * k) * 4; for (let xx = 0; xx < k; xx++, q += 4) { r += s[q]; g += s[q + 1]; b += s[q + 2]; } }
    const n = k * k, o = (y * w + x) * 4;
    d[o] = r / n; d[o + 1] = g / n; d[o + 2] = b / n; d[o + 3] = 255;
  }
  return out;
}

/** ImageData → Blob JPEG (navegador; OffscreenCanvas ou canvas). */
export async function jpeg(img, qualidade = 0.85) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').putImageData(img, 0, 0);
    return c.convertToBlob({ type: 'image/jpeg', quality: qualidade });
  }
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', qualidade));
}
