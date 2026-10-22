/**
 * cv/runtime/livres-n/visao.js — primitivas de visão clássica em JS puro,
 * para as ferramentas do CV-40 (Inspeção visual, porte do GPlanSiS|Inspect).
 *
 * O Inspect (Python) usa OpenCV; aqui não há OpenCV.js (o projeto evita
 * dependências pesadas), então cada primitiva que as ferramentas pedem foi
 * reescrita sobre ImageData/Uint8Array, seguindo o comportamento do OpenCV
 * onde ele importa para o número final:
 *
 *   cinza            BGR2GRAY em ponto fixo (4899·R + 9617·G + 1868·B, >>14) — bit a bit
 *   desfoque 5×5     GaussianBlur((5,5), 0): núcleo fixo [1 4 6 4 1]/16, borda REFLECT_101
 *   Otsu             getThreshVal_Otsu_8u (mesma varredura, inclusive o FLT_EPSILON)
 *   adaptativo       limiar pela média do bloco (ADAPTIVE_THRESH_MEAN_C), por imagem integral
 *   componentes      connectedComponentsWithStats, conectividade 8 (union-find em duas passadas)
 *   morfologia       abertura/fechamento com a elipse 5×5 do OpenCV (decomposta em linhas)
 *   preencher        drawContours(FILLED) dos contornos externos = tapar os furos (fundo 4-conexo
 *                    que não toca a borda)
 *   contorno         seguimento de borda de Suzuki (o mesmo do findContours, CHAIN_APPROX_NONE):
 *                    área por shoelace (contourArea), perímetro (arcLength), casco convexo
 *                    (cadeia monótona), menor retângulo girado (rotating calipers)
 *   NCC              matchTemplate TM_CCOEFF_NORMED, com o mesmo tratamento de janela lisa
 *   Lab / ΔE2000     BGR2LAB de 8 bits (sRGB, D65; L·255/100, a+128, b+128) e a fórmula CIEDE2000
 *   HSV              BGR2HSV de 8 bits em ponto fixo (H 0–179) — bit a bit
 *   remap bilinear   coordenadas quantizadas em 1/32 px (INTER_BITS = 5), borda constante 0
 *
 * SEM ALOCAÇÃO POR QUADRO: os buffers grandes vêm de um pool por nome
 * (`buf`) que só cresce. As ferramentas rodam quando o gatilho dispara, não a
 * cada quadro, mas um programa com várias ferramentas numa peça por segundo
 * não deve encher o coletor de lixo de Uint8Arrays de 1 MB.
 *
 * Nada aqui depende do DOM: o mesmo arquivo roda no Node (testes JS × Python).
 */

// ------------------------------------------------------------------ pool

const pool = new Map();

/** Buffer reaproveitável `nome` com pelo menos `n` elementos do tipo `Tipo` (subarray de tamanho n). */
export function buf(nome, Tipo, n) {
  let b = pool.get(nome);
  if (!b || !(b instanceof Tipo) || b.length < n) {
    b = new Tipo(Math.max(n, b && b instanceof Tipo ? Math.ceil(b.length * 1.5) : 0, 16));
    pool.set(nome, b);
  }
  return b.subarray(0, n);
}

/** Lista que cresce (pares/inteiros) sem realocar a cada uso. */
export class ListaI32 {
  constructor(nome) { this.nome = nome; this.a = buf(nome, Int32Array, 1024); this.n = 0; }
  limpar() { this.n = 0; return this; }
  push(v) {
    if (this.n >= this.a.length) {
      const b = new Int32Array(this.a.length * 2); b.set(this.a); this.a = b; pool.set(this.nome, b);
    }
    this.a[this.n++] = v;
  }
}

// ------------------------------------------------------------------ recorte e cinza

/** Retângulo {x,y,w,h} preso à imagem, como base.py::crop (x0 = min(x, w−1)…). */
export function recorte(img, roi) {
  const W = img.width, H = img.height;
  if (!roi) return { x: 0, y: 0, w: W, h: H };
  const x0 = Math.max(0, Math.min(Math.round(roi.x), W - 1)), y0 = Math.max(0, Math.min(Math.round(roi.y), H - 1));
  const x1 = Math.max(x0 + 1, Math.min(Math.round(roi.x + roi.w), W)), y1 = Math.max(y0 + 1, Math.min(Math.round(roi.y + roi.h), H));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Cinza do OpenCV (BGR2GRAY em ponto fixo) do recorte r → Uint8Array w·h. */
export function cinza(img, r, out) {
  const W = img.width, d = img.data, w = r.w, h = r.h;
  const o = out || buf('cinza', Uint8Array, w * h);
  for (let y = 0; y < h; y++) {
    let p = ((r.y + y) * W + r.x) * 4, q = y * w;
    for (let x = 0; x < w; x++, p += 4) o[q++] = (d[p] * 4899 + d[p + 1] * 9617 + d[p + 2] * 1868 + 8192) >> 14;
  }
  return o;
}

// ------------------------------------------------------------------ desfoque

const refl = (i, n) => {
  if (n === 1) return 0;
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - 2 - i;   // REFLECT_101: −1→1, n→n−2
  return i;
};

/**
 * GaussianBlur((5,5), 0) do OpenCV em 8 bits: núcleo fixo [1,4,6,4,1]/16 nos
 * dois eixos; a soma inteira (÷256) arredonda como o caminho bit-exato.
 */
export function desfoque5(src, w, h, out) {
  const tmp = buf('desf.tmp', Uint16Array, w * h);
  const o = out || buf('desf.out', Uint8Array, w * h);
  for (let y = 0; y < h; y++) {
    const b = y * w;
    for (let x = 0; x < w; x++) {
      if (x >= 2 && x < w - 2) {
        tmp[b + x] = src[b + x - 2] + 4 * src[b + x - 1] + 6 * src[b + x] + 4 * src[b + x + 1] + src[b + x + 2];
      } else {
        tmp[b + x] = src[b + refl(x - 2, w)] + 4 * src[b + refl(x - 1, w)] + 6 * src[b + x] + 4 * src[b + refl(x + 1, w)] + src[b + refl(x + 2, w)];
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const a = refl(y - 2, h) * w, b = refl(y - 1, h) * w, c = y * w, e = refl(y + 1, h) * w, f = refl(y + 2, h) * w;
    for (let x = 0; x < w; x++) o[c + x] = (tmp[a + x] + 4 * tmp[b + x] + 6 * tmp[c + x] + 4 * tmp[e + x] + tmp[f + x] + 128) >> 8;
  }
  return o;
}

// ------------------------------------------------------------------ limiares

const FLT_EPSILON = 1.1920928955078125e-7;

/** getThreshVal_Otsu_8u do OpenCV (a mesma varredura). */
export function otsu(g, n) {
  const hist = buf('otsu.h', Float64Array, 256).fill(0);
  for (let i = 0; i < n; i++) hist[g[i]]++;
  const scale = 1 / n;
  let mu = 0;
  for (let i = 0; i < 256; i++) mu += i * hist[i];
  mu *= scale;
  let mu1 = 0, q1 = 0, maxSigma = 0, maxVal = 0;
  for (let i = 0; i < 256; i++) {
    const pi = hist[i] * scale;
    mu1 *= q1;
    q1 += pi;
    const q2 = 1 - q1;
    if (Math.min(q1, q2) < FLT_EPSILON || Math.max(q1, q2) > 1 - FLT_EPSILON) continue;
    mu1 = (mu1 + i * pi) / q1;
    const mu2 = (mu - q1 * mu1) / q2;
    const sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
    if (sigma > maxSigma) { maxSigma = sigma; maxVal = i; }
  }
  return maxVal;
}

/** THRESH_BINARY (claro → 255) ou THRESH_BINARY_INV (escuro → 255) com limiar `t`: src > t. */
export function limiarizar(g, n, t, escuro, out) {
  const o = out || buf('lim.out', Uint8Array, n);
  if (escuro) for (let i = 0; i < n; i++) o[i] = g[i] > t ? 0 : 255;
  else for (let i = 0; i < n; i++) o[i] = g[i] > t ? 255 : 0;
  return o;
}

/**
 * Limiar adaptativo pela média do bloco (ADAPTIVE_THRESH_MEAN_C): o pixel é
 * "objeto" quando passa da média da vizinhança bloco×bloco menos C. Serve a
 * iluminação irregular, onde um limiar global (Otsu) corta metade da peça.
 */
export function limiarAdaptativo(g, w, h, bloco, C, escuro, out) {
  const o = out || buf('lim.out', Uint8Array, w * h);
  const W1 = w + 1;
  const it = buf('adapt.int', Float64Array, W1 * (h + 1)).fill(0);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) { s += g[y * w + x]; it[(y + 1) * W1 + x + 1] = it[y * W1 + x + 1] + s; }
  }
  const r = Math.max(1, bloco >> 1);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const m = (it[y1 * W1 + x1] - it[y0 * W1 + x1] - it[y1 * W1 + x0] + it[y0 * W1 + x0]) / ((y1 - y0) * (x1 - x0));
      const v = g[y * w + x];
      // OpenCV: THRESH_BINARY → v > m − C; THRESH_BINARY_INV → v ≤ m − C
      o[y * w + x] = escuro ? (v > m - C ? 0 : 255) : (v > m - C ? 255 : 0);
    }
  }
  return o;
}

// ------------------------------------------------------------------ componentes conexos

/**
 * connectedComponentsWithStats(mask, 8): rótulos em `lab` (0 = fundo) e as
 * estatísticas por componente 1..n: área, caixa (x0,y0,x1,y1 inclusivos) e
 * soma de x/y (centroide). Devolve { n, lab, area, x0, y0, x1, y1, sx, sy }.
 */
export function componentes(mask, w, h) {
  const N = w * h;
  const lab = buf('cc.lab', Int32Array, N);
  let pai = buf('cc.pai', Int32Array, 1024);
  let prox = 1;
  const achar = (a) => { while (pai[a] !== a) { pai[a] = pai[pai[a]]; a = pai[a]; } return a; };
  const unir = (a, b) => { a = achar(a); b = achar(b); if (a < b) pai[b] = a; else if (b < a) pai[a] = b; return a < b ? a : b; };
  /*
   * Árvore de decisão de Wu (conectividade 8): com o vizinho N rotulado, ele
   * já foi unido a NW, NE e W em passos anteriores — basta herdar. Sem N, só
   * NE e W (ou NE e NW) podem ser componentes ainda separados.
   */
  for (let y = 0; y < h; y++) {
    const b = y * w;
    for (let x = 0; x < w; x++) {
      const i = b + x;
      if (!mask[i]) { lab[i] = 0; continue; }
      let l = 0;
      const n = y > 0 ? lab[i - w] : 0;
      if (n) l = n;
      else {
        const ne = y > 0 && x < w - 1 ? lab[i - w + 1] : 0;
        const ww = x > 0 ? lab[i - 1] : 0;
        const nw = y > 0 && x > 0 ? lab[i - w - 1] : 0;
        if (ne) l = ww ? unir(ne, ww) : nw ? unir(ne, nw) : ne;
        else l = ww || nw;
      }
      if (!l) {
        if (prox >= pai.length) { const p2 = new Int32Array(pai.length * 2); p2.set(pai); pai = p2; pool.set('cc.pai', p2); }
        pai[prox] = prox; l = prox++;
      }
      lab[i] = l;
    }
  }
  // raízes → rótulos compactos 1..n, na ordem de aparição (como o OpenCV)
  const mapa = buf('cc.mapa', Int32Array, prox).fill(0);
  let n = 0;
  for (let l = 1; l < prox; l++) { const r = achar(l); if (!mapa[r]) mapa[r] = ++n; mapa[l] = mapa[r]; }
  const area = buf('cc.area', Int32Array, n + 1).fill(0);
  const x0 = buf('cc.x0', Int32Array, n + 1).fill(2147483647), y0 = buf('cc.y0', Int32Array, n + 1).fill(2147483647);
  const x1 = buf('cc.x1', Int32Array, n + 1).fill(-1), y1 = buf('cc.y1', Int32Array, n + 1).fill(-1);
  const sx = buf('cc.sx', Float64Array, n + 1).fill(0), sy = buf('cc.sy', Float64Array, n + 1).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!lab[i]) continue;
      const k = (lab[i] = mapa[lab[i]]);
      area[k]++; sx[k] += x; sy[k] += y;
      if (x < x0[k]) x0[k] = x; if (x > x1[k]) x1[k] = x;
      if (y < y0[k]) y0[k] = y; if (y > y1[k]) y1[k] = y;
    }
  }
  return { n, lab, area, x0, y0, x1, y1, sx, sy };
}

// ------------------------------------------------------------------ morfologia (elipse 5×5)

/*
 * getStructuringElement(MORPH_ELLIPSE, (5,5)) do OpenCV:
 *   . . X . .
 *   X X X X X
 *   X X X X X
 *   X X X X X
 *   . . X . .
 * = linhas −1..1 com largura 5 + o pixel central das linhas ±2. Fora da
 * imagem o pixel é ignorado (o borderValue padrão da erosão é +∞ e o da
 * dilatação, −∞).
 */
function morf(src, w, h, erodir, out) {
  // máscaras binárias (0/255): erosão = E bit a bit (mínimo), dilatação = OU (máximo)
  const hz = buf('morf.h', Uint8Array, w * h);
  const o = out;
  for (let y = 0; y < h; y++) {
    const b = y * w;
    for (let x = 0; x < w; x++) {
      if (x === 2 && w > 4) {
        // miolo da linha: os 5 vizinhos sempre existem
        const fim = b + w - 2;
        if (erodir) for (let i = b + 2; i < fim; i++) hz[i] = src[i - 2] & src[i - 1] & src[i] & src[i + 1] & src[i + 2];
        else for (let i = b + 2; i < fim; i++) hz[i] = src[i - 2] | src[i - 1] | src[i] | src[i + 1] | src[i + 2];
        x = w - 3;
        continue;
      }
      const a = x > 1 ? x - 2 : 0, c = x < w - 2 ? x + 2 : w - 1;
      let v = src[b + a];
      if (erodir) for (let k = a + 1; k <= c; k++) v &= src[b + k];
      else for (let k = a + 1; k <= c; k++) v |= src[b + k];
      hz[b + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    const b = y * w;
    const c1 = y > 0 ? -w : 0, b1 = y < h - 1 ? w : 0, c2 = y > 1 ? -2 * w : 0, b2 = y < h - 2 ? 2 * w : 0;
    // linha fora da imagem → deslocamento 0 (o próprio pixel, que já está no núcleo): a borda fica neutra
    if (erodir) for (let i = b; i < b + w; i++) o[i] = hz[i] & hz[i + c1] & hz[i + b1] & src[i + c2] & src[i + b2];
    else for (let i = b; i < b + w; i++) o[i] = hz[i] | hz[i + c1] | hz[i + b1] | src[i + c2] | src[i + b2];
  }
  return o;
}
export function erodir(src, w, h, out) { return morf(src, w, h, true, out); }
export function dilatar(src, w, h, out) { return morf(src, w, h, false, out); }
/** Abertura e depois fechamento, como object_mask do Inspect. Resultado em `m` (no lugar). */
export function abrirFechar(m, w, h) {
  const t = buf('morf.t', Uint8Array, w * h);
  erodir(m, w, h, t); dilatar(t, w, h, m);     // abertura
  dilatar(m, w, h, t); erodir(t, w, h, m);     // fechamento
  return m;
}

/**
 * Tapa os furos (drawContours FILLED dos contornos externos): o fundo
 * 4-conexo que não alcança a borda vira objeto. No lugar.
 */
export function taparFuros(m, w, h) {
  const N = w * h;
  const vis = buf('furo.vis', Uint8Array, N).fill(0);
  const fila = buf('furo.fila', Int32Array, N);
  let ini = 0, fim = 0;
  const semear = (i) => { if (!m[i] && !vis[i]) { vis[i] = 1; fila[fim++] = i; } };
  for (let x = 0; x < w; x++) { semear(x); semear((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { semear(y * w); semear(y * w + w - 1); }
  while (ini < fim) {
    const i = fila[ini++], x = i % w;
    if (x > 0) semear(i - 1);
    if (x < w - 1) semear(i + 1);
    if (i >= w) semear(i - w);
    if (i < N - w) semear(i + w);
  }
  for (let i = 0; i < N; i++) if (!m[i] && !vis[i]) m[i] = 255;
  return m;
}

// ------------------------------------------------------------------ contorno (Suzuki)

const DX = [1, 1, 0, -1, -1, -1, 0, 1];   // 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (horário na tela)
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Borda externa do componente `k` (rótulos de `componentes`), começando no
 * primeiro pixel em ordem de varredura — o seguimento de Suzuki que o
 * findContours usa. Pontos (x,y) intercalados em `lista` (ListaI32).
 */
export function contornoExterno(lab, w, h, k, xIni, yIni, lista) {
  lista.limpar();
  // primeiro pixel do componente na varredura (a partir da linha da caixa)
  let p0 = -1;
  for (let y = yIni; y < h && p0 < 0; y++) for (let x = xIni; x < w; x++) if (lab[y * w + x] === k) { p0 = y * w + x; break; }
  if (p0 < 0) return lista;
  const x0 = p0 % w, y0 = (p0 / w) | 0;
  const ok = (x, y) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === k;
  // 3.1: a partir do vizinho W (fundo), sentido horário, o primeiro do componente
  let d1 = -1;
  for (let s = 0; s < 8; s++) { const d = (4 + s) & 7; if (ok(x0 + DX[d], y0 + DY[d])) { d1 = d; break; } }
  if (d1 < 0) { lista.push(x0); lista.push(y0); return lista; }   // pixel isolado
  const x1 = x0 + DX[d1], y1 = y0 + DY[d1];
  // 3.2..3.5: p2 = p1, p3 = p0; gira anti-horário a partir do vizinho seguinte a p2
  let x3 = x0, y3 = y0, dAnt = d1;   // direção de p3 para p2
  for (let guarda = 0; guarda < 4 * w * h + 8; guarda++) {
    lista.push(x3); lista.push(y3);
    let d4 = -1;
    for (let s = 1; s <= 8; s++) { const d = (dAnt - s + 8) & 7; if (ok(x3 + DX[d], y3 + DY[d])) { d4 = d; break; } }
    const x4 = x3 + DX[d4], y4 = y3 + DY[d4];
    if (x4 === x0 && y4 === y0 && x3 === x1 && y3 === y1) break;
    // a próxima busca começa no vizinho de p4 que é p3 (direção oposta)
    dAnt = (d4 + 4) & 7;
    x3 = x4; y3 = y4;
  }
  return lista;
}

/** contourArea (shoelace, valor absoluto) de pontos intercalados. */
export function areaContorno(a, n) {
  const m = n >> 1;
  if (m < 3) return 0;
  let s = 0;
  for (let i = 0, j = m - 1; i < m; j = i++) s += a[2 * j] * a[2 * i + 1] - a[2 * i] * a[2 * j + 1];
  return Math.abs(s) / 2;
}

/** arcLength(fechado). */
export function perimetro(a, n) {
  const m = n >> 1;
  if (m < 2) return 0;
  let s = 0;
  for (let i = 0, j = m - 1; i < m; j = i++) s += Math.hypot(a[2 * i] - a[2 * j], a[2 * i + 1] - a[2 * j + 1]);
  return s;
}

/** Casco convexo (cadeia monótona de Andrew) → pontos intercalados em `saida` (ListaI32). */
export function casco(a, n, saida) {
  const m = n >> 1;
  const idx = buf('casco.idx', Int32Array, m);
  for (let i = 0; i < m; i++) idx[i] = i;
  idx.sort((p, q) => a[2 * p] - a[2 * q] || a[2 * p + 1] - a[2 * q + 1]);
  const st = buf('casco.st', Int32Array, 2 * m + 2);
  let k = 0;
  const cruz = (o, p, q) => (a[2 * p] - a[2 * o]) * (a[2 * q + 1] - a[2 * o + 1]) - (a[2 * p + 1] - a[2 * o + 1]) * (a[2 * q] - a[2 * o]);
  for (let t = 0; t < m; t++) { const i = idx[t]; while (k >= 2 && cruz(st[k - 2], st[k - 1], i) <= 0) k--; st[k++] = i; }
  for (let t = m - 2, lo = k + 1; t >= 0; t--) { const i = idx[t]; while (k >= lo && cruz(st[k - 2], st[k - 1], i) <= 0) k--; st[k++] = i; }
  saida.limpar();
  for (let t = 0; t < Math.max(1, k - 1); t++) { saida.push(a[2 * st[t]]); saida.push(a[2 * st[t] + 1]); }
  return saida;
}

/** Menor retângulo girado (rotating calipers sobre o casco): { w, h, angulo (graus 0–90) }. */
export function retanguloMinimo(c, n) {
  const m = n >> 1;
  if (m < 3) {
    let w = 0, h = 0;
    if (m === 2) { w = Math.hypot(c[2] - c[0], c[3] - c[1]); }
    return { w, h, angulo: 0 };
  }
  let melhor = Infinity, res = { w: 0, h: 0, angulo: 0 };
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    let ex = c[2 * j] - c[2 * i], ey = c[2 * j + 1] - c[2 * i + 1];
    const L = Math.hypot(ex, ey);
    if (!L) continue;
    ex /= L; ey /= L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let t = 0; t < m; t++) {
      const px = c[2 * t] - c[2 * i], py = c[2 * t + 1] - c[2 * i + 1];
      const u = px * ex + py * ey, v = -px * ey + py * ex;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const A = (u1 - u0) * (v1 - v0);
    if (A < melhor) {
      melhor = A;
      let ang = (Math.atan2(ey, ex) * 180) / Math.PI;
      ang = ((ang % 90) + 90) % 90;
      res = { w: u1 - u0, h: v1 - v0, angulo: ang };
    }
  }
  return res;
}

// ------------------------------------------------------------------ NCC (TM_CCOEFF_NORMED)

/** Média em blocos f×f (pirâmide grosseira para a busca do NCC). */
function reduzir(g, w, h, f, nome) {
  const W = Math.floor(w / f), H = Math.floor(h / f);
  const o = buf(nome, Float32Array, Math.max(1, W * H));
  const k = 1 / (f * f);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let j = 0; j < f; j++) { const b = (y * f + j) * w + x * f; for (let i = 0; i < f; i++) s += g[b + i]; }
      o[y * W + x] = s * k;
    }
  }
  return { g: o, w: W, h: H };
}

/**
 * Coeficiente de correlação normalizado do molde `t` (tw×th, já com a média
 * subtraída em `tz`, norma `tn`) na posição (px,py) de `g` (w de largura).
 * Mesmo tratamento do OpenCV para janela lisa (denominador ~0).
 */
function nccEm(g, w, tz, tw, th, tn, px, py, I) {
  let s = 0;
  for (let j = 0; j < th; j++) {
    const b = (py + j) * w + px, tb = j * tw;
    for (let i = 0; i < tw; i++) s += tz[tb + i] * g[b + i];
  }
  // somas da janela pelas integrais (Σv e Σv²)
  const W1 = w + 1, a = py * W1 + px, c = (py + th) * W1 + px;
  const s1 = I.s[c + tw] - I.s[a + tw] - I.s[c] + I.s[a];
  const s2 = I.q[c + tw] - I.q[a + tw] - I.q[c] + I.q[a];
  const n = tw * th;
  const t = Math.sqrt(Math.max(s2 - (s1 * s1) / n, 0)) * tn;
  if (Math.abs(s) < t) return s / t;
  if (Math.abs(s) < t * 1.125) return s > 0 ? 1 : -1;
  return 0;
}

/** Integrais de v e v² (Float64, (w+1)×(h+1)). */
function integrais(g, w, h, nome) {
  const W1 = w + 1, N = W1 * (h + 1);
  const S = buf(nome + '.s', Float64Array, N), Q = buf(nome + '.q', Float64Array, N);
  for (let x = 0; x < W1; x++) { S[x] = 0; Q[x] = 0; }
  for (let y = 0; y < h; y++) {
    let a = 0, b = 0;
    S[(y + 1) * W1] = 0; Q[(y + 1) * W1] = 0;
    for (let x = 0; x < w; x++) {
      const v = g[y * w + x];
      a += v; b += v * v;
      S[(y + 1) * W1 + x + 1] = S[y * W1 + x + 1] + a;
      Q[(y + 1) * W1 + x + 1] = Q[y * W1 + x + 1] + b;
    }
  }
  return { s: S, q: Q };
}

function moldeZero(t, n, nome) {
  let m = 0;
  for (let i = 0; i < n; i++) m += t[i];
  m /= n;
  const tz = buf(nome, Float32Array, n);
  let q = 0;
  for (let i = 0; i < n; i++) { const v = t[i] - m; tz[i] = v; q += v * v; }
  return { tz, tn: Math.sqrt(q) };
}

/**
 * matchTemplate(TM_CCOEFF_NORMED) + minMaxLoc: { score, x, y } da melhor
 * posição do molde `t` (tw×th, cinza) em `g` (w×h, cinza).
 *
 * Busca exaustiva quando cabe (≤ 10⁷ multiplicações); acima disso, em
 * pirâmide: mapa NCC completo numa escala reduzida (média em blocos f×f), os
 * 5 melhores picos refinados em resolução plena numa janela de ±(f+1) px. O
 * score devolvido é sempre o NCC exato na posição final. O OpenCV usa FFT e é
 * exaustivo; com um pico único (o caso da presença de peça) dá a mesma
 * posição — com dois picos quase iguais a pirâmide pode escolher o outro.
 */
export function ncc(g, w, h, t, tw, th) {
  if (tw > w || th > h || !tw || !th) return { score: 0, x: 0, y: 0 };
  const nx = w - tw + 1, ny = h - th + 1;
  const { tz, tn } = moldeZero(t, tw * th, 'ncc.tz');
  const I = integrais(g, w, h, 'ncc.I');
  const custo = nx * ny * tw * th;
  if (custo <= 1e7 || Math.min(tw, th) < 16) {
    let best = -2, bx = 0, by = 0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const r = nccEm(g, w, tz, tw, th, tn, x, y, I);
      if (r > best) { best = r; bx = x; by = y; }
    }
    return { score: best, x: bx, y: by };
  }
  let f = 2;
  while (f < 16 && (Math.floor(w / f) - Math.floor(tw / f) + 1) * (Math.floor(h / f) - Math.floor(th / f) + 1)
         * Math.floor(tw / f) * Math.floor(th / f) > 1e7 && Math.min(tw, th) / (f * 2) >= 8) f *= 2;
  const G = reduzir(g, w, h, f, 'ncc.G'), T = reduzir(t, tw, th, f, 'ncc.T');
  const z = moldeZero(T.g, T.w * T.h, 'ncc.Tz');
  const IG = integrais(G.g, G.w, G.h, 'ncc.IG');
  const NX = G.w - T.w + 1, NY = G.h - T.h + 1;
  const mapa = buf('ncc.mapa', Float32Array, NX * NY);
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) mapa[y * NX + x] = nccEm(G.g, G.w, z.tz, T.w, T.h, z.tn, x, y, IG);
  // 5 picos com supressão de vizinhança (meio molde)
  const picos = [];
  const raioX = Math.max(1, T.w >> 1), raioY = Math.max(1, T.h >> 1);
  for (let k = 0; k < 5; k++) {
    let best = -3, bi = -1;
    for (let i = 0; i < NX * NY; i++) if (mapa[i] > best) { best = mapa[i]; bi = i; }
    if (bi < 0 || best <= -2) break;
    const px = bi % NX, py = (bi / NX) | 0;
    picos.push([px, py]);
    for (let y = Math.max(0, py - raioY); y <= Math.min(NY - 1, py + raioY); y++)
      for (let x = Math.max(0, px - raioX); x <= Math.min(NX - 1, px + raioX); x++) mapa[y * NX + x] = -3;
  }
  let best = -2, bx = 0, by = 0;
  for (const [px, py] of picos) {
    const cx = px * f, cy = py * f;
    for (let y = Math.max(0, cy - f - 1); y <= Math.min(ny - 1, cy + f + 1); y++)
      for (let x = Math.max(0, cx - f - 1); x <= Math.min(nx - 1, cx + f + 1); x++) {
        const r = nccEm(g, w, tz, tw, th, tn, x, y, I);
        if (r > best) { best = r; bx = x; by = y; }
      }
  }
  return { score: best, x: bx, y: by };
}

// ------------------------------------------------------------------ cor

/*
 * BGR2LAB de 8 bits do OpenCV, bit a bit (RGB2Lab_b de color_lab.cpp): gama
 * sRGB em tabela (×8), matriz sRGB→XYZ/D65 em ponto fixo (×4096), raiz
 * cúbica em tabela (×32768) e L, a, b com arredondamento CV_DESCALE.
 */
const LAB_SHIFT = 12, GAMMA_SHIFT = 3, LAB_SHIFT2 = LAB_SHIFT + GAMMA_SHIFT;
const GAMA_B = new Int32Array(256), CBRT_B = new Int32Array(256 * 3 / 2 * (1 << GAMMA_SHIFT));
const fr = Math.fround;
for (let i = 0; i < 256; i++) {
  const x = fr(i * fr(1 / 255));
  const gm = x <= fr(0.04045) ? fr(x * fr(1 / 12.92)) : fr(Math.pow((x + 0.055) * (1 / 1.055), 2.4));
  GAMA_B[i] = Math.min(65535, Math.max(0, Math.round(fr(255 * (1 << GAMMA_SHIFT) * gm))));
}
for (let i = 0; i < CBRT_B.length; i++) {
  const x = fr(i * fr(1 / (255 * (1 << GAMMA_SHIFT))));
  const v = x < fr(0.008856) ? fr(fr(x * fr(7.787)) + fr(0.13793103448275862)) : fr(Math.cbrt(x));
  CBRT_B[i] = Math.min(65535, Math.max(0, Math.round(fr((1 << LAB_SHIFT2) * v))));
}
const M_XYZ = [0.412453, 0.35758, 0.180423, 0.212671, 0.71516, 0.072169, 0.019334, 0.119193, 0.950227];
const BRANCO = [0.950456, 1, 1.088754];
const CLAB = new Int32Array(9);
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) CLAB[i * 3 + j] = Math.round(((1 << LAB_SHIFT) * M_XYZ[i * 3 + j]) / BRANCO[i]);
const LSCALE = Math.trunc((116 * 255 + 50) / 100), LSHIFT = -Math.trunc((16 * 255 * (1 << LAB_SHIFT2) + 50) / 100);
const desc = (x, n) => (x + (1 << (n - 1))) >> n;
const sat8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** sRGB 8 bits → Lab em 8 bits do OpenCV (L·255/100, a+128, b+128), em `out` [L8,a8,b8]. */
export function lab8(r, g, b, out) {
  const R = GAMA_B[r], G = GAMA_B[g], B = GAMA_B[b];
  const fX = CBRT_B[desc(R * CLAB[0] + G * CLAB[1] + B * CLAB[2], LAB_SHIFT)];
  const fY = CBRT_B[desc(R * CLAB[3] + G * CLAB[4] + B * CLAB[5], LAB_SHIFT)];
  const fZ = CBRT_B[desc(R * CLAB[6] + G * CLAB[7] + B * CLAB[8], LAB_SHIFT)];
  out[0] = sat8(desc(LSCALE * fY + LSHIFT, LAB_SHIFT2));
  out[1] = sat8(desc(500 * (fX - fY) + 128 * (1 << LAB_SHIFT2), LAB_SHIFT2));
  out[2] = sat8(desc(200 * (fY - fZ) + 128 * (1 << LAB_SHIFT2), LAB_SHIFT2));
  return out;
}

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** Lab CIE (L 0–100, a, b) de um RGB 8 bits, sem quantizar (para mostrar a cor de referência). */
export function labDeRgb(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.412453 * R + 0.35758 * G + 0.180423 * B) / 0.950456;
  const Y = 0.212671 * R + 0.71516 * G + 0.072169 * B;
  const Z = (0.019334 * R + 0.119193 * G + 0.950227 * B) / 1.088754;
  const fy = fLab(Y);
  return [Y > 0.008856 ? 116 * fy - 16 : 903.3 * Y, 500 * (fLab(X) - fy), 200 * (fy - fLab(Z))];
}

/** Lab → sRGB 8 bits (para pintar a amostra da cor de referência). */
export function rgbDeLab(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (f) => (f > 0.206893 ? f * f * f : (f - 16 / 116) / 7.787);
  const X = inv(fx) * 0.950456, Y = L > 8 ? inv(fy) : L / 903.3, Z = inv(fz) * 1.088754;
  const R = 3.240479 * X - 1.53715 * Y - 0.498535 * Z;
  const G = -0.969256 * X + 1.875992 * Y + 0.041556 * Z;
  const B = 0.055648 * X - 0.204043 * Y + 1.057311 * Z;
  const gam = (c) => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(c * 255))); };
  return [gam(R), gam(G), gam(B)];
}

const rad = (d) => (d * Math.PI) / 180, grau = (r) => (r * 180) / Math.PI;

/** CIEDE2000 — mesma escrita de classic.py::delta_e2000. */
export function deltaE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const m360 = (v) => ((v % 360) + 360) % 360;
  const h1p = m360(grau(Math.atan2(b1, a1p))), h2p = m360(grau(Math.atan2(b2, a2p)));
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dh / 2));
  const Lpm = (L1 + L2) / 2, Cpm = (C1p + C2p) / 2;
  const hs = h1p + h2p;
  let hpm;
  if (C1p * C2p === 0) hpm = hs;
  else if (Math.abs(h1p - h2p) <= 180) hpm = hs / 2;
  else hpm = hs < 360 ? (hs + 360) / 2 : (hs - 360) / 2;
  const T = 1 - 0.17 * Math.cos(rad(hpm - 30)) + 0.24 * Math.cos(rad(2 * hpm))
    + 0.32 * Math.cos(rad(3 * hpm + 6)) - 0.2 * Math.cos(rad(4 * hpm - 63));
  const dth = 30 * Math.exp(-(((hpm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(rad(2 * dth)) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/*
 * BGR2HSV de 8 bits do OpenCV, em ponto fixo (hsv_shift = 12): tabelas de
 * divisão para S e para H (H em 0–179). Bit a bit com o cv2.cvtColor.
 */
const HSV_SHIFT = 12;
const SDIV = new Int32Array(256), HDIV = new Int32Array(256);
for (let i = 1; i < 256; i++) { SDIV[i] = Math.round((255 << HSV_SHIFT) / i); HDIV[i] = Math.round((180 << HSV_SHIFT) / (6 * i)); }

/** HSV do OpenCV (H 0–179, S e V 0–255) do recorte r → Uint8Array w·h·3. */
export function hsv(img, r) {
  const W = img.width, d = img.data, w = r.w, h = r.h;
  const o = buf('hsv', Uint8Array, w * h * 3);
  const meio = 1 << (HSV_SHIFT - 1);
  for (let y = 0; y < h; y++) {
    let p = ((r.y + y) * W + r.x) * 4, q = y * w * 3;
    for (let x = 0; x < w; x++, p += 4, q += 3) {
      const R = d[p], G = d[p + 1], B = d[p + 2];
      let v = B, vmin = B;
      if (G > v) v = G; if (R > v) v = R;
      if (G < vmin) vmin = G; if (R < vmin) vmin = R;
      const diff = v - vmin;
      const vr = v === R ? -1 : 0, vg = v === G ? -1 : 0;
      const s = (diff * SDIV[v] + meio) >> HSV_SHIFT;
      let hh = (vr & (G - B)) + (~vr & ((vg & (B - R + 2 * diff)) + (~vg & (R - G + 4 * diff))));
      hh = (hh * HDIV[diff] + meio) >> HSV_SHIFT;
      if (hh < 0) hh += 180;
      o[q] = hh; o[q + 1] = s; o[q + 2] = v;
    }
  }
  return o;
}

// ------------------------------------------------------------------ amostragem bilinear (remap)

/**
 * Valor bilinear de `g` (Float32 ou Uint8, w×h) em (x,y), como o cv2.remap
 * com INTER_LINEAR: coordenada quantizada em 1/32 px e borda constante 0.
 */
export function bilinear(g, w, h, x, y) {
  const X = Math.round(x * 32), Y = Math.round(y * 32);
  const ix = X >> 5, iy = Y >> 5, fx = (X & 31) / 32, fy = (Y & 31) / 32;
  const px = (xx, yy) => (xx >= 0 && yy >= 0 && xx < w && yy < h ? g[yy * w + xx] : 0);
  return (1 - fy) * ((1 - fx) * px(ix, iy) + fx * px(ix + 1, iy)) + fy * ((1 - fx) * px(ix, iy + 1) + fx * px(ix + 1, iy + 1));
}
