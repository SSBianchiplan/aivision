/**
 * cv/core.js — primitivas de ImageData e kernels.
 *
 * Espelha o papel de backend/app/cv/ (helpers compartilhados pelos operadores).
 * Nenhum operador aloca ImageData direto: tudo passa pelo pool, senão o GC
 * mata o framerate em tempo real.
 */

// ---------------------------------------------------------------- pool

const pool = new Map(); // "wxh" -> ImageData[]
let stats = { allocs: 0, reuses: 0 };

function key(w, h) {
  return w + 'x' + h;
}

/** Pega um ImageData do pool (conteúdo indefinido) ou aloca um novo. */
export function alloc(w, h) {
  const bucket = pool.get(key(w, h));
  if (bucket && bucket.length) {
    stats.reuses++;
    return bucket.pop();
  }
  stats.allocs++;
  return new ImageData(w, h);
}

/** Devolve um ImageData ao pool. Ignora null e o frame original da câmera. */
export function free(img) {
  if (!img) return;
  const k = key(img.width, img.height);
  let bucket = pool.get(k);
  if (!bucket) pool.set(k, (bucket = []));
  if (bucket.length < 8) bucket.push(img); // teto: evita segurar memória demais
}

export function allocLike(src) {
  return alloc(src.width, src.height);
}

export function poolStats() {
  return { ...stats, buckets: pool.size };
}

/**
 * Cópia FORA do pool, para levar o frame a uma inferência assíncrona: o
 * executor devolve o src ao pool logo depois do apply e o operador seguinte
 * reaproveita o buffer, então guardar a referência faria o callback ler a
 * imagem já alterada. O GC recolhe a cópia quando a inferência termina.
 */
export function snapshot(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/** Copia src para um buffer novo do pool. */
export function clone(src) {
  const out = allocLike(src);
  out.data.set(src.data);
  return out;
}

// ---------------------------------------------------------------- gray

/**
 * Extrai luminância (Rec.601, mesma constante do cv2.COLOR_BGR2GRAY)
 * para um Uint8ClampedArray de 1 canal, w*h.
 */
export function toGray(src, out) {
  const d = src.data;
  const n = src.width * src.height;
  const g = out && out.length === n ? out : new Uint8ClampedArray(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    g[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
  }
  return g;
}

/** Escreve um plano de 1 canal nos 3 canais RGB de um ImageData. */
export function fromGray(gray, w, h, out) {
  const img = out || alloc(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i];
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  return img;
}

// ---------------------------------------------------------------- kernels

/** Kernel gaussiano 1D normalizado. sigma<=0 usa a fórmula do OpenCV. */
export function gaussKernel(ksize, sigma) {
  if (ksize % 2 === 0) ksize += 1;
  if (ksize < 1) ksize = 1;
  if (!sigma || sigma <= 0) sigma = 0.3 * ((ksize - 1) * 0.5 - 1) + 0.8;
  const r = (ksize - 1) / 2;
  const k = new Float32Array(ksize);
  let sum = 0;
  for (let i = 0; i < ksize; i++) {
    const x = i - r;
    k[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += k[i];
  }
  for (let i = 0; i < ksize; i++) k[i] /= sum;
  return k;
}

const clampi = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Convolução separável nos canais RGB. Borda replicada (BORDER_REPLICATE).
 * Dois passes com buffer intermediário — O(n·k) em vez de O(n·k²).
 */
export function separable(src, kernel) {
  const { width: w, height: h, data: sd } = src;
  const r = (kernel.length - 1) / 2;
  const tmp = new Float32Array(w * h * 3);
  const out = alloc(w, h);
  const od = out.data;

  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const p = (row + clampi(x + i, 0, w - 1)) * 4;
        const kv = kernel[i + r];
        a += sd[p] * kv;
        b += sd[p + 1] * kv;
        c += sd[p + 2] * kv;
      }
      const t = (row + x) * 3;
      tmp[t] = a;
      tmp[t + 1] = b;
      tmp[t + 2] = c;
    }
  }

  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let i = -r; i <= r; i++) {
        const t = (clampi(y + i, 0, h - 1) * w + x) * 3;
        const kv = kernel[i + r];
        a += tmp[t] * kv;
        b += tmp[t + 1] * kv;
        c += tmp[t + 2] * kv;
      }
      const p = (y * w + x) * 4;
      od[p] = a;
      od[p + 1] = b;
      od[p + 2] = c;
      od[p + 3] = 255;
    }
  }
  return out;
}

/**
 * Gradientes Sobel 3x3 sobre um plano gray.
 * Retorna Float32Array gx e gy (mesmo tamanho do plano).
 */
export function sobel(gray, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = clampi(y - 1, 0, h - 1) * w;
    const y1 = y * w;
    const y2 = clampi(y + 1, 0, h - 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = clampi(x - 1, 0, w - 1);
      const x2 = clampi(x + 1, 0, w - 1);
      const p00 = gray[y0 + x0], p01 = gray[y0 + x], p02 = gray[y0 + x2];
      const p10 = gray[y1 + x0],                     p12 = gray[y1 + x2];
      const p20 = gray[y2 + x0], p21 = gray[y2 + x], p22 = gray[y2 + x2];
      const i = y1 + x;
      gx[i] = -p00 + p02 - 2 * p10 + 2 * p12 - p20 + p22;
      gy[i] = -p00 - 2 * p01 - p02 + p20 + 2 * p21 + p22;
    }
  }
  return { gx, gy };
}

/** Filtro de média (box) separável sobre um plano gray → Float32Array. */
export function boxMean(gray, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let i = -radius; i <= radius; i++) acc += gray[row + clampi(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc -= gray[row + clampi(x - radius, 0, w - 1)];
      acc += gray[row + clampi(x + radius + 1, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -radius; i <= radius; i++) acc += tmp[clampi(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc -= tmp[clampi(y - radius, 0, h - 1) * w + x];
      acc += tmp[clampi(y + radius + 1, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** Histograma de 256 bins de um plano gray. */
export function histogram(gray) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  return hist;
}

/** Limiar de Otsu: maximiza a variância entre classes. */
export function otsu(gray) {
  const hist = histogram(gray);
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) {
      bestVar = v;
      best = t;
    }
  }
  return best;
}

export { clampi };
