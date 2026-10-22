/**
 * cv/runtime/livres-u/agro.js — agro e pecuária (CV-85), sem DOM:
 *
 *   indiceVerde      ExG = 2g − r − b ou ExG − ExR (cromáticas r,g,b) → cobertura verde (%)
 *   contarInsetos    armadilha adesiva: escuros sobre o cartão, sem as linhas da grade,
 *                    grudados separados pela área típica
 *   escoreLocomocao  trajetória de um animal (caixas com ID) → 1..5 + motivos (triagem)
 *   areaDorsal       maior região do animal na área marcada (Otsu, polaridade automática)
 *   pesoPorArea / ajustarPotencia   kg = a · A(m²)^b, calibrado com pares da balança
 */
import { cinza, otsuPlano, componentes, mediana, dentroPoligono } from './imagem.js';

// ------------------------------------------------------------------ índice de verde

/**
 * Índice de verde na ROI {x,y,w,h} (px); `poli` opcional (px) limita a um polígono.
 * o = { indice: 'ExG'|'ExG−ExR', limiar: número | 'otsu', passo }.
 * Devolve { cobertura (0–1), media, mediaVerde, limiar, n, mascara (Uint8Array w×h do passo) }.
 */
export function indiceVerde(img, roi, o = {}, poli = null) {
  const W = img.width, d = img.data;
  const x0 = Math.max(0, Math.round(roi.x)), y0 = Math.max(0, Math.round(roi.y));
  const w = Math.min(W - x0, Math.round(roi.w)), h = Math.min(img.height - y0, Math.round(roi.h));
  const passo = Math.max(1, o.passo | 0 || 1);
  const gw = Math.ceil(w / passo), gh = Math.ceil(h / passo);
  const v = new Float32Array(gw * gh).fill(NaN);
  const exgr = o.indice === 'ExG−ExR' || o.indice === 'ExG-ExR';
  let soma = 0, n = 0;
  for (let gy = 0; gy < gh; gy++) {
    const y = y0 + gy * passo;
    for (let gx = 0; gx < gw; gx++) {
      const x = x0 + gx * passo;
      if (poli && !dentroPoligono(x + 0.5, y + 0.5, poli)) continue;
      const q = (y * W + x) * 4, R = d[q], G = d[q + 1], B = d[q + 2], s = R + G + B;
      if (s < 30) continue;   // escuro demais: a cromática vira ruído
      const r = R / s, g = G / s, b = B / s;
      let e = 2 * g - r - b;
      if (exgr) e -= 1.4 * r - g;
      v[gy * gw + gx] = e; soma += e; n++;
    }
  }
  let lim = o.limiar;
  if (lim === 'otsu' || !Number.isFinite(lim)) {
    // Otsu sobre o índice mapeado de [−1, 2] para 0–255
    const g8 = new Float32Array(n);
    let k = 0;
    for (const e of v) if (Number.isFinite(e)) g8[k++] = Math.max(0, Math.min(255, ((e + 1) / 3) * 255));
    lim = (otsuPlano(g8) / 255) * 3 - 1;
    if (!exgr) lim = Math.max(lim, 0.02);
  }
  const masc = new Uint8Array(gw * gh);
  let nv = 0, sv = 0;
  for (let i = 0; i < v.length; i++) if (Number.isFinite(v[i]) && v[i] > lim) { masc[i] = 1; nv++; sv += v[i]; }
  return { cobertura: n ? nv / n : 0, media: n ? soma / n : NaN, mediaVerde: nv ? sv / nv : NaN, limiar: lim, n, mascara: masc, gw, gh, passo, x0, y0 };
}

// ------------------------------------------------------------------ armadilha adesiva

/**
 * Insetos na ROI (px): pixels mais escuros que `contraste` × o fundo (mediana
 * local do cartão), componentes entre `minPx` e `maxPx`, sem os traços finos
 * da grade (alongados). Componente com área > 2,2× a mediana conta como vários.
 * Devolve { n, blobs: [{cx, cy, area, k}], fundo, medianaArea }.
 */
export function contarInsetos(img, roi, o = {}) {
  const C = cinza(img, roi);
  const { g, w, h } = C;
  const contraste = o.contraste ?? 0.35, minPx = o.minPx ?? 6, maxPx = o.maxPx ?? (w * h) / 50;
  // fundo por blocos de 32 px (o cartão tem gradiente de luz)
  const B = 32, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const fundo = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    const vals = [];
    for (let y = by * B; y < Math.min(h, by * B + B); y += 2) for (let x = bx * B; x < Math.min(w, bx * B + B); x += 2) vals.push(g[y * w + x]);
    fundo[by * bw + bx] = percentil(vals, 0.7);
  }
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = fundoBil(fundo, bw, bh, (x + 0.5) / B - 0.5, (y + 0.5) / B - 0.5);
    if (g[y * w + x] < f * (1 - contraste)) m[y * w + x] = 1;
  }
  // traços finos (grade impressa, ≤ 2·r px de largura) somem na erosão; o inseto sobrevive
  const r = Math.max(0, o.larguraTraco ?? 1);
  // abertura (erosão + dilatação): o inseto encostado numa linha da grade se separa dela
  const ab = r ? dilatar(erodir(m, w, h, r), w, h, r) : m;
  const { comps } = componentes(ab, w, h, minPx);
  const bons = comps.filter((c) => {
    const bw2 = c.x2 - c.x1 + 1, bh2 = c.y2 - c.y1 + 1;
    const along = Math.max(bw2, bh2) / Math.max(1, Math.min(bw2, bh2));
    const cheio = c.area / (bw2 * bh2);
    if (c.area > maxPx) return false;
    if (along > 5 && cheio < 0.5) return false;           // traço da grade
    if (bw2 > w * 0.5 || bh2 > h * 0.5) return false;     // linha longa
    return true;
  });
  const medA = mediana(bons.map((c) => c.area)) || 0;
  let n = 0;
  const blobs = bons.map((c) => {
    const k = medA > 0 && c.area > 2.2 * medA ? Math.round(c.area / medA) : 1;
    n += k;
    return { cx: c.cx + C.x0, cy: c.cy + C.y0, area: c.area, k, x1: c.x1 + C.x0, y1: c.y1 + C.y0, x2: c.x2 + C.x0, y2: c.y2 + C.y0 };
  });
  return { n, blobs, medianaArea: medA };
}

/** Erosão binária por quadrado (2r+1)². */
function erodir(m, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 1;
    for (let k = -r; k <= r && ok; k++) { const xx = x + k; if (xx < 0 || xx >= w || !m[y * w + xx]) ok = 0; }
    tmp[y * w + x] = ok;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 1;
    for (let k = -r; k <= r && ok; k++) { const yy = y + k; if (yy < 0 || yy >= h || !tmp[yy * w + x]) ok = 0; }
    out[y * w + x] = ok;
  }
  return out;
}

/** Dilatação binária por quadrado (2r+1)². */
function dilatar(m, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 0;
    for (let k = -r; k <= r && !ok; k++) { const xx = x + k; if (xx >= 0 && xx < w && m[y * w + xx]) ok = 1; }
    tmp[y * w + x] = ok;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ok = 0;
    for (let k = -r; k <= r && !ok; k++) { const yy = y + k; if (yy >= 0 && yy < h && tmp[yy * w + x]) ok = 1; }
    out[y * w + x] = ok;
  }
  return out;
}

function percentil(a, p) { if (!a.length) return 0; const s = a.sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function fundoBil(f, bw, bh, fx, fy) {
  fx = Math.max(0, Math.min(bw - 1, fx)); fy = Math.max(0, Math.min(bh - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(bw - 1, x0 + 1), y1 = Math.min(bh - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  return (f[y0 * bw + x0] * (1 - tx) + f[y0 * bw + x1] * tx) * (1 - ty) + (f[y1 * bw + x0] * (1 - tx) + f[y1 * bw + x1] * tx) * ty;
}

// ------------------------------------------------------------------ locomoção

export const ROTULO_LOCOMOCAO = { 1: 'normal', 2: 'levemente alterada', 3: 'alterada (moderada)', 4: 'claudicante', 5: 'claudicação severa' };

/**
 * Trajetória [{t, cx, cy, w, h}] (px ou 0–1, mesma unidade) de UM animal
 * atravessando a cena de lado. o = { lento (CC/s), cvMax, bobMax (fração da altura), paradaV (CC/s), paradaS }.
 * CC = comprimento do corpo (mediana da largura da caixa).
 * Devolve { escore 1..5, rotulo, motivos[], vMed (CC/s), cv, paradas, bob, duracao, ok }.
 */
export function escoreLocomocao(traj, o = {}) {
  const op = { lento: 0.45, cvMax: 0.35, bobMax: 0.035, paradaV: 0.12, paradaS: 0.4, ...o };
  if (!traj || traj.length < 10) return { ok: false, motivo: 'trajetória curta' };
  const t = traj.map((p) => p.t), dur = t[t.length - 1] - t[0];
  const cc = mediana(traj.map((p) => p.w)), alt = mediana(traj.map((p) => p.h));
  if (!(cc > 0) || dur < 1.5) return { ok: false, motivo: 'trajetória curta' };
  const desloc = Math.abs(traj[traj.length - 1].cx - traj[0].cx) / cc;
  if (desloc < 1.0) return { ok: false, motivo: 'andou menos de 1 corpo' };
  // velocidade em janelas de ~0,3 s (diferença centrada)
  const vs = [];
  for (let i = 0; i < traj.length; i++) {
    let j0 = i, j1 = i;
    while (j0 > 0 && t[i] - t[j0] < 0.15) j0--;
    while (j1 < traj.length - 1 && t[j1] - t[i] < 0.15) j1++;
    if (t[j1] - t[j0] > 0) vs.push({ t: t[i], v: Math.abs(traj[j1].cx - traj[j0].cx) / cc / (t[j1] - t[j0]) });
  }
  const vv = vs.map((x) => x.v);
  const vMed = vv.reduce((s, x) => s + x, 0) / vv.length;
  const sd = Math.sqrt(vv.reduce((s, x) => s + (x - vMed) ** 2, 0) / vv.length);
  const cv = vMed > 0 ? sd / vMed : 0;
  // paradas no meio da passagem
  let paradas = 0, ini = null;
  for (const x of vs) {
    if (x.v < op.paradaV) { if (ini == null) ini = x.t; }
    else { if (ini != null && x.t - ini >= op.paradaS) paradas++; ini = null; }
  }
  // balanço vertical do topo (cabeça/dorso): topo menos a média móvel de 1 s, RMS ÷ altura
  const topo = traj.map((p) => p.cy - p.h / 2);
  let s2 = 0;
  for (let i = 0; i < traj.length; i++) {
    let s = 0, k = 0;
    for (let j = 0; j < traj.length; j++) if (Math.abs(t[j] - t[i]) <= 0.5) { s += topo[j]; k++; }
    s2 += (topo[i] - s / k) ** 2;
  }
  const bob = Math.sqrt(s2 / traj.length) / alt;
  const motivos = [];
  let escore = 1;
  if (vMed < op.lento) { escore++; motivos.push(`lento (${vMed.toFixed(2)} corpos/s)`); }
  if (cv > op.cvMax) { escore++; motivos.push(`passo irregular (CV ${(cv * 100).toFixed(0)}%)`); }
  if (paradas > 0) { escore++; motivos.push(`${paradas} parada(s)`); }
  if (bob > op.bobMax) { escore++; motivos.push(`balanço vertical ${(bob * 100).toFixed(1)}% da altura`); }
  escore = Math.min(5, escore);
  return { ok: true, escore, rotulo: ROTULO_LOCOMOCAO[escore], motivos, vMed, cv, paradas, bob, duracao: dur };
}

// ------------------------------------------------------------------ peso pela área dorsal

/**
 * Maior região do animal na ROI (px): Otsu; a polaridade é a que dá a maior
 * região SEM tocar a borda da área (o piso toca). Devolve { areaPx, comp, polaridade } ou null.
 */
export function areaDorsal(img, roi) {
  const C = cinza(img, roi);
  const thr = otsuPlano(C.g);
  let melhor = null;
  for (const claro of [true, false]) {
    const m = new Uint8Array(C.w * C.h);
    for (let i = 0; i < m.length; i++) m[i] = (C.g[i] > thr) === claro ? 1 : 0;
    const { comps } = componentes(m, C.w, C.h, 20);
    for (const c of comps) {
      const toca = c.x1 <= 0 || c.y1 <= 0 || c.x2 >= C.w - 1 || c.y2 >= C.h - 1;
      if (toca) continue;
      if (!melhor || c.area > melhor.areaPx) melhor = { areaPx: c.area, comp: { ...c, cx: c.cx + C.x0, cy: c.cy + C.y0, x1: c.x1 + C.x0, y1: c.y1 + C.y0, x2: c.x2 + C.x0, y2: c.y2 + C.y0 }, polaridade: claro ? 'claro' : 'escuro' };
    }
  }
  return melhor;
}

export function pesoPorArea(aM2, a, b) { return aM2 > 0 && a > 0 ? a * Math.pow(aM2, b) : NaN; }

/** Ajuste kg = a·A^b por mínimos quadrados em log–log. pares = [{area (m²), kg}]. Devolve { a, b, r2, n } ou null. */
export function ajustarPotencia(pares) {
  const p = pares.filter((x) => x.area > 0 && x.kg > 0);
  if (p.length < 2) return null;
  const X = p.map((x) => Math.log(x.area)), Y = p.map((x) => Math.log(x.kg));
  const n = p.length, mx = X.reduce((s, x) => s + x, 0) / n, my = Y.reduce((s, y) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
  if (sxx < 1e-12) return null;
  // com 2 pares ou áreas quase iguais o expoente fica instável: prende b em [0,5; 2,5]
  let b = sxy / sxx;
  b = Math.max(0.5, Math.min(2.5, b));
  const a = Math.exp(my - b * mx);
  let sr = 0;
  for (let i = 0; i < n; i++) sr += (Y[i] - (Math.log(a) + b * X[i])) ** 2;
  return { a, b, r2: syy > 0 ? 1 - sr / syy : 1, n };
}
