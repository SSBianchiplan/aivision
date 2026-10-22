/**
 * cv/runtime/livres-u/fisica.js — matemática do Laboratório de física por
 * vídeo (CV-80, D1), sem DOM:
 *
 *   ajustePolinomio   mínimos quadrados de grau 1 ou 2 (t centrado: bem condicionado)
 *   derivadasLocais   v e a por parábola local em janela (Savitzky–Golay p/ t irregular)
 *   analisarQueda     y(t) = y0 + v0·t − g·t²/2 (eixo y para CIMA) → g, v0, R²
 *   analisarPendulo   período pelos cruzamentos da média (interpolados) → g = 4π²L/T²
 *   analisarRampa     aceleração ao longo da direção principal (plano inclinado)
 *
 * As amostras chegam em METROS, com y já invertido (para cima) pelo operador.
 */

/** Ajuste polinomial de grau 1 ou 2. Devolve { c: [c0, c1, c2], r2, rms } em t original. */
export function ajustePolinomio(ts, ys, grau = 2) {
  const n = ts.length;
  if (n < grau + 1) return null;
  let tm = 0;
  for (const t of ts) tm += t;
  tm /= n;
  const k = grau + 1;
  const A = Array.from({ length: k }, () => new Float64Array(k)), b = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    const u = ts[i] - tm, pw = [1, u, u * u];
    for (let r = 0; r < k; r++) {
      b[r] += pw[r] * ys[i];
      for (let c = 0; c < k; c++) A[r][c] += pw[r] * pw[c];
    }
  }
  const x = resolverPequeno(A, b);
  if (!x) return null;
  // volta de u = t − tm para t
  const a0 = x[0], a1 = x[1], a2 = grau === 2 ? x[2] : 0;
  const c = [a0 - a1 * tm + a2 * tm * tm, a1 - 2 * a2 * tm, a2];
  let sr = 0, st = 0, ym = 0;
  for (const y of ys) ym += y;
  ym /= n;
  for (let i = 0; i < n; i++) {
    const f = c[0] + c[1] * ts[i] + c[2] * ts[i] * ts[i];
    sr += (ys[i] - f) ** 2; st += (ys[i] - ym) ** 2;
  }
  return { c, r2: st > 0 ? 1 - sr / st : 1, rms: Math.sqrt(sr / n) };
}

function resolverPequeno(A, b) {
  const n = b.length, M = A.map((l, i) => [...l, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-15) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let q = c; q <= n; q++) M[r][q] -= f * M[c][q];
    }
  }
  return M.map((l, i) => l[n] / l[i]);
}

/**
 * Velocidade e aceleração em cada amostra por parábola local numa janela de
 * `meia` vizinhos de cada lado (nas pontas a janela encolhe para dentro).
 */
export function derivadasLocais(ts, xs, meia = 3) {
  const n = ts.length, v = new Float64Array(n).fill(NaN), a = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, Math.min(i - meia, n - 2 * meia - 1)), i1 = Math.min(n - 1, i0 + 2 * meia);
    if (i1 - i0 < 2) continue;
    const tt = [], yy = [];
    for (let j = i0; j <= i1; j++) { tt.push(ts[j] - ts[i]); yy.push(xs[j]); }
    const f = ajustePolinomio(tt, yy, 2);
    if (!f) continue;
    v[i] = f.c[1]; a[i] = 2 * f.c[2];
  }
  return { v, a };
}

/**
 * Queda livre / lançamento: y para CIMA (m), x (m), t (s).
 * Devolve { g, v0y, vx, r2, rms, n, y0 } — g positivo para a queda normal.
 */
export function analisarQueda(am) {
  if (am.length < 5) return null;
  const ts = am.map((p) => p.t), ys = am.map((p) => p.y), xs = am.map((p) => p.x);
  const fy = ajustePolinomio(ts, ys, 2), fx = ajustePolinomio(ts, xs, 1);
  if (!fy) return null;
  const t0 = ts[0];
  return {
    g: -2 * fy.c[2], v0y: fy.c[1] + 2 * fy.c[2] * t0, vx: fx ? fx.c[1] : NaN, r2: fy.r2, rms: fy.rms, n: am.length,
    y0: fy.c[0] + fy.c[1] * t0 + fy.c[2] * t0 * t0, ajuste: fy.c,
  };
}

/**
 * Pêndulo: período pelos cruzamentos ascendentes de x pela média (interpolados).
 * `L` (m, opcional) dá g = 4π²L/T². Devolve { T, f, n, g, amp }.
 */
export function analisarPendulo(am, L = 0) {
  if (am.length < 8) return null;
  const xs = am.map((p) => p.x), ts = am.map((p) => p.t);
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const cruz = [];
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1] - m, b = xs[i] - m;
    if (a < 0 && b >= 0) cruz.push(ts[i - 1] + (ts[i] - ts[i - 1]) * (-a / (b - a)));
  }
  if (cruz.length < 2) return null;
  const T = (cruz[cruz.length - 1] - cruz[0]) / (cruz.length - 1);
  let amp = 0;
  for (const x of xs) amp = Math.max(amp, Math.abs(x - m));
  return { T, f: 1 / T, n: cruz.length - 1, g: L > 0 ? (4 * Math.PI * Math.PI * L) / (T * T) : NaN, amp };
}

/**
 * Plano inclinado: projeta na direção principal do movimento (do 1º ao
 * último ponto) e ajusta s(t) = s0 + v0·t + a·t²/2. Devolve { a, v0, r2, angulo (graus da horizontal) }.
 */
export function analisarRampa(am) {
  if (am.length < 5) return null;
  const p0 = am[0], p1 = am[am.length - 1];
  const dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy);
  if (L < 1e-9) return null;
  const ux = dx / L, uy = dy / L;
  const ts = am.map((p) => p.t), ss = am.map((p) => (p.x - p0.x) * ux + (p.y - p0.y) * uy);
  const f = ajustePolinomio(ts, ss, 2);
  if (!f) return null;
  const t0 = ts[0];
  return { a: 2 * f.c[2], v0: f.c[1] + 2 * f.c[2] * t0, r2: f.r2, angulo: (Math.atan2(Math.abs(uy), Math.abs(ux)) * 180) / Math.PI };
}
