/**
 * cv/runtime/livres-t/sinais.js — processamento de sinal da onda 2-c (CV-70..77),
 * sem DOM e sem modelo (roda no node, testado com sinais sintéticos):
 *
 *   reamostrar        série irregular (t em ms) → grade uniforme (fs Hz), interpolação linear
 *   tirarTendencia    remove média e reta (mínimos quadrados)
 *   passaAlta         subtrai a média móvel (janela em amostras)
 *   fft               FFT radix-2 in-place (re, im)
 *   picoEspectral     periodograma com janela de Hann e zero-padding; pico na banda com
 *                     interpolação parabólica, SNR (pico + 1º harmônico × resto da banda) e
 *                     a FAIXA DE CONFIANÇA (meia largura a −3 dB do pico, nunca menor que a
 *                     resolução da janela / 2)
 *   rppgPOS, rppgCHROM  pulso a partir das médias RGB da pele (Wang 2017; de Haan 2013)
 *   dtw               alinhamento temporal (Sakoe-Chiba) entre séries vetoriais com buracos
 *   ciclos            picos com histerese (contagem de repetições/braçadas/saltos)
 *   eixoPrincipal     projeção 2D no eixo de maior variância (tremor)
 *
 * Tempos em ms nas entradas; frequências em Hz nas saídas.
 */

const fin = Number.isFinite;

export function media(xs) { let s = 0, n = 0; for (const x of xs) if (fin(x)) { s += x; n++; } return n ? s / n : null; }
export function desvio(xs) {
  const m = media(xs); if (m == null) return null;
  let s = 0, n = 0; for (const x of xs) if (fin(x)) { s += (x - m) ** 2; n++; }
  return n > 1 ? Math.sqrt(s / (n - 1)) : 0;
}
export function mediana(xs) {
  const v = xs.filter(fin).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = v.length >> 1;
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}

/** Taxa efetiva de amostragem (Hz) pela mediana dos intervalos. */
export function taxaHz(ts) {
  if (ts.length < 3) return null;
  const d = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  const m = mediana(d.filter((x) => x > 0));
  return m ? 1000 / m : null;
}

/**
 * Reamostra (ts ms, ys) em fs Hz. Buracos (ys não finito) são interpolados
 * entre os vizinhos válidos. Devolve { t0, fs, ys: Float64Array }.
 */
export function reamostrar(ts, ys, fs) {
  const pares = [];
  for (let i = 0; i < ts.length; i++) if (fin(ts[i]) && fin(ys[i])) pares.push([ts[i], ys[i]]);
  if (pares.length < 2) return { t0: pares.length ? pares[0][0] : 0, fs, ys: new Float64Array(0) };
  const t0 = pares[0][0], t1 = pares[pares.length - 1][0];
  const n = Math.max(0, Math.floor(((t1 - t0) / 1000) * fs) + 1);
  const out = new Float64Array(n);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + (k * 1000) / fs;
    while (j < pares.length - 2 && pares[j + 1][0] < t) j++;
    const [ta, ya] = pares[j], [tb, yb] = pares[j + 1];
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    out[k] = ya + f * (yb - ya);
  }
  return { t0, fs, ys: out };
}

export function tirarTendencia(ys) {
  const n = ys.length, out = new Float64Array(n);
  if (!n) return out;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxx += i * i; sxy += i * ys[i]; }
  const den = n * sxx - sx * sx;
  const b = den ? (n * sxy - sx * sy) / den : 0, a = (sy - b * sx) / n;
  for (let i = 0; i < n; i++) out[i] = ys[i] - (a + b * i);
  return out;
}

/** Passa-alta simples: x − média móvel centrada de `k` amostras. */
export function passaAlta(ys, k) {
  const n = ys.length, out = new Float64Array(n), h = Math.max(1, k >> 1);
  const acc = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) acc[i + 1] = acc[i] + ys[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - h), b = Math.min(n, i + h + 1);
    out[i] = ys[i] - (acc[b] - acc[a]) / (b - a);
  }
  return out;
}

/** Média móvel centrada (passa-baixa leve). */
export function suavizar(ys, k) {
  const hp = passaAlta(ys, k), out = new Float64Array(ys.length);
  for (let i = 0; i < ys.length; i++) out[i] = ys[i] - hp[i];
  return out;
}

/** FFT radix-2 in-place; n potência de 2. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Periodograma (Hann, zero-padding até ≥ 8× e ≥ 2048 pontos). Devolve { f: Float64Array (Hz), p }. */
export function espectro(ys, fs) {
  const n = ys.length;
  let N = 2048; while (N < 8 * n) N <<= 1;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < n; i++) re[i] = ys[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  fft(re, im);
  const M = N / 2 + 1, f = new Float64Array(M), p = new Float64Array(M);
  for (let k = 0; k < M; k++) { f[k] = (k * fs) / N; p[k] = re[k] * re[k] + im[k] * im[k]; }
  return { f, p, N };
}

/**
 * Pico dominante na banda [fMin, fMax] Hz. Devolve null sem dados, ou
 * { f, porMin (f×60), snr (dB), meiaLarguraHz, faixaPorMin [lo, hi], confianca 0–1,
 *   espectro { f, p } recortado na banda (para desenhar) }.
 *
 * SNR como em de Haan & Jeanne 2013: potência a ±0,1 Hz (ou ±1 bin de
 * resolução, o maior) do pico e do 1º harmônico sobre a potência do resto
 * da banda. A faixa de confiança é a meia largura a −3 dB do pico (a
 * resolução da janela já entra nela), somada à incerteza da taxa de amostragem.
 */
export function picoEspectral(ys, fs, fMin, fMax, { harmonico = true } = {}) {
  const n = ys.length;
  if (n < 8 || !(fs > 0)) return null;
  const x = tirarTendencia(ys);
  let energia = 0; for (const v of x) energia += v * v;
  if (!(energia > 1e-18)) return null;
  const { f, p } = espectro(x, fs);
  const df = f[1] - f[0];
  const k0 = Math.max(1, Math.ceil(fMin / df)), k1 = Math.min(f.length - 2, Math.floor(fMax / df));
  if (k1 <= k0) return null;
  let kp = k0;
  for (let k = k0; k <= k1; k++) if (p[k] > p[kp]) kp = k;
  // interpolação parabólica no log da potência
  let fPico = f[kp];
  if (kp > 0 && kp < f.length - 1 && p[kp - 1] > 0 && p[kp + 1] > 0) {
    const a = Math.log(p[kp - 1]), b = Math.log(p[kp]), c = Math.log(p[kp + 1]);
    const d = a - 2 * b + c;
    if (d < 0) fPico = f[kp] + (0.5 * (a - c) / d) * df;
  }
  // meia largura a −3 dB
  const meio = p[kp] / 2;
  let a = kp, b = kp;
  while (a > 0 && p[a] > meio) a--;
  while (b < f.length - 1 && p[b] > meio) b++;
  const resol = fs / n;   // resolução da janela (Hz)
  const meiaL = Math.max(resol / 2, ((b - a) * df) / 2);
  // SNR
  const larg = Math.max(0.1, resol);
  let sinal = 0, ruido = 0;
  for (let k = k0; k <= k1; k++) {
    const perto = Math.abs(f[k] - fPico) <= larg || (harmonico && Math.abs(f[k] - 2 * fPico) <= larg);
    if (perto) sinal += p[k]; else ruido += p[k];
  }
  // harmônico fora da banda conta também
  if (harmonico && 2 * fPico > fMax) for (let k = k1 + 1; k < f.length && f[k] <= 2 * fPico + larg; k++) if (Math.abs(f[k] - 2 * fPico) <= larg) sinal += p[k];
  const snr = 10 * Math.log10((sinal + 1e-30) / (ruido + 1e-30));
  // confiança: SNR de −3 dB → 0, +6 dB → 1 (escala logística simples)
  const confianca = Math.max(0, Math.min(1, (snr + 3) / 9));
  const banda = { f: f.slice(k0, k1 + 1), p: p.slice(k0, k1 + 1) };
  return {
    f: fPico, porMin: fPico * 60, snr, meiaLarguraHz: meiaL,
    faixaPorMin: [Math.max(fMin, fPico - meiaL) * 60, Math.min(fMax, fPico + meiaL) * 60],
    confianca, espectro: banda, n, fs, duracaoS: n / fs,
  };
}

/**
 * rPPG POS (Wang, den Brinker, Stuijk & de Haan, IEEE TBME 64(7), 2017):
 * janelas deslizantes de ~1,6 s; normaliza cada canal pela média da janela,
 * projeta no plano ortogonal ao tom de pele (S1 = G − B, S2 = −2R + G + B),
 * combina h = S1 + (σ1/σ2)·S2 e soma com sobreposição.
 */
export function rppgPOS(R, G, B, fs) {
  const n = R.length, L = Math.max(4, Math.round(1.6 * fs)), H = new Float64Array(n);
  for (let m = 0; m + L <= n; m++) {
    let mr = 0, mg = 0, mb = 0;
    for (let i = m; i < m + L; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
    mr /= L; mg /= L; mb /= L;
    if (!(mr > 0 && mg > 0 && mb > 0)) continue;
    const s1 = new Float64Array(L), s2 = new Float64Array(L);
    for (let i = 0; i < L; i++) {
      const r = R[m + i] / mr, g = G[m + i] / mg, b = B[m + i] / mb;
      s1[i] = g - b; s2[i] = -2 * r + g + b;
    }
    const d1 = desvioF(s1), d2 = desvioF(s2);
    const alfa = d2 > 1e-12 ? d1 / d2 : 0;
    const h = new Float64Array(L);
    let mh = 0;
    for (let i = 0; i < L; i++) { h[i] = s1[i] + alfa * s2[i]; mh += h[i]; }
    mh /= L;
    for (let i = 0; i < L; i++) H[m + i] += h[i] - mh;
  }
  return H;
}

/**
 * rPPG CHROM (de Haan & Jeanne, IEEE TBME 60(10), 2013): Xs = 3R − 2G,
 * Ys = 1,5R + G − 1,5B (canais normalizados pela média), S = X − α·Y com
 * α = σX/σY, em janelas com sobreposição.
 */
export function rppgCHROM(R, G, B, fs) {
  const n = R.length, L = Math.max(4, Math.round(1.6 * fs)), S = new Float64Array(n);
  const passo = Math.max(1, L >> 1);
  for (let m = 0; m + L <= n; m += passo) {
    let mr = 0, mg = 0, mb = 0;
    for (let i = m; i < m + L; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
    mr /= L; mg /= L; mb /= L;
    if (!(mr > 0 && mg > 0 && mb > 0)) continue;
    const X = new Float64Array(L), Y = new Float64Array(L);
    for (let i = 0; i < L; i++) {
      const r = R[m + i] / mr, g = G[m + i] / mg, b = B[m + i] / mb;
      X[i] = 3 * r - 2 * g; Y[i] = 1.5 * r + g - 1.5 * b;
    }
    const dx = desvioF(X), dy = desvioF(Y), a = dy > 1e-12 ? dx / dy : 0;
    let ms = 0;
    for (let i = 0; i < L; i++) ms += X[i] - a * Y[i];
    ms /= L;
    for (let i = 0; i < L; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / L);   // Hann para o overlap-add
      S[m + i] += w * (X[i] - a * Y[i] - ms);
    }
  }
  return S;
}

function desvioF(a) {
  let m = 0; for (const v of a) m += v; m /= a.length;
  let s = 0; for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / a.length);
}

/**
 * DTW entre A (n×d) e B (m×d) — linhas são vetores (ângulos), com valores
 * não finitos ignorados na distância (média do |Δ| nas dimensões presentes
 * nos dois). Banda de Sakoe-Chiba `banda` (fração de max(n, m)).
 * Devolve { custo (média por passo do caminho), caminho [[i, j]…] }.
 */
export function dtw(A, B, { banda = 0.25 } = {}) {
  const n = A.length, m = B.length;
  if (!n || !m) return { custo: Infinity, caminho: [] };
  const w = Math.max(Math.abs(n - m) + 1, Math.ceil(banda * Math.max(n, m)));
  const INF = Infinity;
  const D = new Float64Array((n + 1) * (m + 1)).fill(INF);
  const idx = (i, j) => i * (m + 1) + j;
  D[0] = 0;
  const dist = (a, b) => {
    let s = 0, k = 0;
    for (let d = 0; d < a.length; d++) if (fin(a[d]) && fin(b[d])) { s += Math.abs(a[d] - b[d]); k++; }
    return k ? s / k : 90;   // sem dimensão em comum: custo alto (90°)
  };
  for (let i = 1; i <= n; i++) {
    const jc = Math.round((i * m) / n);
    for (let j = Math.max(1, jc - w); j <= Math.min(m, jc + w); j++) {
      const c = dist(A[i - 1], B[j - 1]);
      D[idx(i, j)] = c + Math.min(D[idx(i - 1, j)], D[idx(i, j - 1)], D[idx(i - 1, j - 1)]);
    }
  }
  if (!fin(D[idx(n, m)])) return { custo: Infinity, caminho: [] };
  const caminho = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    caminho.push([i - 1, j - 1]);
    const a = D[idx(i - 1, j - 1)], b = D[idx(i - 1, j)], c = D[idx(i, j - 1)];
    if (a <= b && a <= c) { i--; j--; } else if (b <= c) i--; else j--;
  }
  caminho.reverse();
  return { custo: D[idx(n, m)] / caminho.length, caminho };
}

/**
 * Ciclos (picos) com histerese: um pico conta quando o sinal sobe acima de
 * (nível + amp/2·limiar) depois de ter descido abaixo de (nível − amp/2·limiar),
 * com intervalo mínimo `minMs`. amp = p90 − p10 da série (robusto); nível = mediana.
 * Devolve [{ t, i, y }] dos picos.
 */
export function ciclos(ts, ys, { limiar = 0.35, minMs = 250, ampMin = 0 } = {}) {
  const v = ys.filter(fin);
  if (v.length < 5) return [];
  const s = v.slice().sort((a, b) => a - b);
  const p10 = s[Math.floor(0.1 * (s.length - 1))], p90 = s[Math.ceil(0.9 * (s.length - 1))];
  const amp = p90 - p10;
  if (!(amp > ampMin) || !(amp > 0)) return [];
  const nivel = (p10 + p90) / 2, hi = nivel + (amp / 2) * limiar, lo = nivel - (amp / 2) * limiar;
  const picos = [];
  let armado = false, melhor = null;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (!fin(y)) continue;
    if (!armado) { if (y < lo) armado = true; continue; }
    if (y > hi) { if (!melhor || y > melhor.y) melhor = { t: ts[i], i, y }; }
    else if (melhor && y < lo) {
      if (!picos.length || melhor.t - picos[picos.length - 1].t >= minMs) picos.push(melhor);
      melhor = null;
    }
  }
  return picos;
}

/** Ritmo por minuto e regularidade (CV dos intervalos) de uma lista de instantes (ms). */
export function ritmo(tsEventos) {
  if (tsEventos.length < 2) return { porMin: null, cv: null, intervaloMs: null };
  const d = [];
  for (let i = 1; i < tsEventos.length; i++) d.push(tsEventos[i] - tsEventos[i - 1]);
  const m = mediana(d), sd = desvio(d), mu = media(d);
  return { porMin: m ? 60000 / m : null, cv: mu ? sd / mu : null, intervaloMs: m };
}

/** Projeta pontos 2D no eixo de maior variância (PCA 2×2). Devolve { s: Float64Array, ang (rad) }. */
export function eixoPrincipal(xs, ys) {
  const n = xs.length;
  const mx = media(xs), my = media(ys);
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const c = Math.cos(ang), s = Math.sin(ang), out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (xs[i] - mx) * c + (ys[i] - my) * s;
  return { s: out, ang };
}

/** RMS. */
export function rms(ys) { let s = 0; for (const v of ys) s += v * v; return ys.length ? Math.sqrt(s / ys.length) : 0; }
