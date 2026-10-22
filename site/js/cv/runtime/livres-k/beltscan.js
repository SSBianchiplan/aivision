/**
 * cv/runtime/livres-k/beltscan.js — núcleo do GPlanSiS|BeltScan (CV-36):
 * volumetria de correia transportadora por triangulação laser–câmera.
 *
 * Porte do GPlanSiS|BELTSCAN v4 (HTML standalone + programa de borda em
 * Python/OpenCV). A REFERÊNCIA NUMÉRICA é o Python (nucleo.py, geometria.py,
 * correia.py, bancada.py, beltscan.py): cada passo abaixo reproduz o passo de
 * lá, inclusive os arredondamentos do OpenCV em uint8, para que o mesmo vídeo
 * com o mesmo JSON dê a mesma seção, vazão e volume. Onde o HTML e o Python
 * divergem, vale o Python (anotado no ponto).
 *
 * Cadeia por quadro:
 *   linha laser (subpixel, por coluna) → altura por triangulação com o ângulo
 *   da câmera → escala para a calha (DIN 22101) → seção, enchimento, vazão,
 *   massa seca, centralização, pico → nível representativo e portão "acima da
 *   altura limite" → alarmes ISA-18.2; em paralelo, a medição REAL da bancada
 *   (seção em mm² × velocidade do papel por correlação de fase).
 *
 * Modelo (SPEC-GPS-BSC-001):
 *   φ = atan(s·(v − c_v)/f_px)   θ = α + φ   z = H_c − b/tan θ
 *   x = (u − c_u)·b·cos φ/(f_px·sen θ)   dz/dv = b·cos²φ/(f_px·sen²θ)
 *   mira α = atan(b/H_c)   sombra = h·tan θ
 *   A_th = k_δ·A1 + A2 (DIN 22101)   Q = A·v·3600   ṁ_seca = Q·ρ·(1−U)/1000
 *
 * Desempenho: tudo em typed arrays reaproveitados entre quadros; o sinal só é
 * calculado na faixa de busca (ROI) com a margem que o filtro precisa; o
 * top-hat vertical usa van Herk/Gil-Werman (3 comparações por pixel, qualquer
 * altura de janela) e a mediana por coluna usa histograma (o sinal é uint8).
 *
 * Sem DOM: roda no navegador (operador) e no Node (validação contra o Python).
 */

// ------------------------------------------------------------------ configuração

export const ESQUEMA = 'beltscan/4';

/** Configuração padrão: a do HTML (ensaio da bancada, 848×480, ganho 8×). */
export const PADRAO = {
  schema: ESQUEMA,
  extraction: {
    mode: 'red', tophat: true, tophat_k: 15, thr: 25, half_win: 3, contrast_k: 2.5,
    max_shift_px: 25, despike_win: 9, despike_tol: 6, roi: [110, 180, 700, 330],
    ref_frames: 20, auto_ref: true, exclude: [], ref_mode: 'frames', env_pct: 95, fit_order: 2, fit_tol_px: 1.5,
  },
  geo: { Hc_mm: 400, b_mm: 250, alpha_deg: 32, hfov_deg: 70, f_mm: 0, pix_um: 0, v_sign: -1, roll_deg: 0, camera: 'custom', auto_alpha: false },
  bench: {
    speed_src: 'flow', speed_mm_s: 25, flow_near_px: 30, flow_far_px: 190, flow_max_px: 40, flow_min_conf: 0.15, flow_tau_s: 0.4,
    noise_mm: 1.0, rho_kgm3: 780, reset_on_loop: true,
  },
  cal: { height_mm: 10, frames: 15, min_px: 1.5, fit_b: false, points: [] },
  belt: {
    B_mm: 1600, roll_mm: 600, trough_deg: 45, surcharge_deg: 20, incline_deg: 15, on_incline: true,
    plane_perp: true, speed_ms: 2.5, rho_kgm3: 330, moisture: 0.5, sp_tsa_h: 0,
  },
  mapping: { scale_xy: 0, height_gain: 8 },
  limit: { ref: 'thickness', h_mm: 250, min_width_pct: 4, gate_db_mm: 10, min_thick_mm: 15 },
  analysis: {
    tau_s: 0.5, zero_frac: 0.003, median_win: 7, reject_mm: 50, neg_clip_mm: 20,
    peak_win: 21, q_good: 0.85, q_unc: 0.60, temporal_alpha: 1,
  },
  alarms: [
    { tag: 'HI-101 HH', kind: 'excess', on: true, gate: true, prio: 1, thr: 80, db: 10, delay_s: 0.5, off_delay_s: 1, text: 'Produto acima da altura limite (mm de excesso)', act: 'Reduzir o alimentador imediatamente' },
    { tag: 'HI-101 H', kind: 'excess', on: true, gate: true, prio: 2, thr: 25, db: 8, delay_s: 1, off_delay_s: 2, text: 'Produto acima da altura limite (mm de excesso)', act: 'Reduzir o alimentador' },
    { tag: 'LI-101 HH', kind: 'fill', on: true, gate: true, prio: 1, thr: 95, db: 3, delay_s: 2, off_delay_s: 2, text: 'Enchimento da seção (%)', act: 'Reduzir o alimentador' },
    { tag: 'LI-101 H', kind: 'fill', on: true, gate: true, prio: 2, thr: 85, db: 3, delay_s: 5, off_delay_s: 3, text: 'Enchimento da seção (%)', act: 'Verificar alimentador e pilha' },
    { tag: 'AI-102', kind: 'peak', on: true, gate: true, prio: 2, thr: 90, db: 10, delay_s: 0.3, off_delay_s: 1, text: 'Pico local sobre a média vizinha (mm)', act: 'Desviar ou parar antes da peneira' },
    { tag: 'ZI-103', kind: 'center', on: true, gate: true, prio: 2, thr: 4, db: 1, delay_s: 5, off_delay_s: 3, text: 'Carga descentralizada (% de B)', act: 'Inspecionar o chute de carga', min_fill: 10 },
    { tag: 'FI-104', kind: 'mdry_dev', on: true, gate: true, prio: 3, thr: 10, db: 2, delay_s: 45, off_delay_s: 10, text: 'Massa seca fora do setpoint (±%)', act: 'Conferir modo e densidade' },
    { tag: 'QI-105', kind: 'coverage_low', on: true, gate: true, prio: 3, thr: 85, db: 3, delay_s: 3, off_delay_s: 3, text: 'Cobertura de colunas abaixo de (%)', act: 'Checar encoder, luz, túnel e janela' },
  ],
  ui: { theme: 'auto', trend_window_s: 60 },
  ref_rows: null,
};

export const clonar = (o) => JSON.parse(JSON.stringify(o));

/** Funde `add` sobre `base` (objetos por chave; listas e valores substituem). */
export function fundir(base, add) {
  for (const k in add) {
    const a = add[k], b = base[k];
    if (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)) fundir(b, a);
    else base[k] = a;
  }
  return base;
}

/** Esquema antigo (beltscan/1–2): alarmes de outro formato são descartados (como no HTML e no Python). */
export function atualizarEsquema(d) {
  if (d && d.schema !== 'beltscan/4' && d.schema !== 'beltscan/3') delete d.alarms;
  if (d) d.schema = ESQUEMA;
  return d;
}

/** Lê um JSON "beltscan/4" (do HTML, do Python ou exportado aqui) sobre o padrão. */
export function normalizarConfig(d) {
  const c = fundir(clonar(PADRAO), atualizarEsquema(clonar(d || {})));
  // alarmes: completa campos que faltam com os do padrão da mesma tag (default_alarms do Python)
  const porTag = Object.fromEntries(PADRAO.alarms.map((a) => [a.tag, a]));
  c.alarms = (Array.isArray(c.alarms) && c.alarms.length ? c.alarms : clonar(PADRAO.alarms))
    .map((a) => ({ ...(porTag[a.tag] || {}), ...a }));
  if (!Array.isArray(c.extraction.exclude)) c.extraction.exclude = [];
  if (!Array.isArray(c.cal.points)) c.cal.points = [];
  return c;
}

/** Predefinição dos ensaios com feijão (câmera Logitech BCC950, b 250, H_c 210). */
export function predefFeijao(c) {
  Object.assign(c.extraction, { roi: [60, 250, 940, 520], max_shift_px: 90, ref_mode: 'fit', ref_frames: 30, env_pct: 95, fit_order: 1, fit_tol_px: 1.5, auto_ref: true, exclude: [] });
  Object.assign(c.geo, { Hc_mm: 210, b_mm: 250, v_sign: -1, roll_deg: 0, camera: 'bcc950', hfov_deg: 70.42, f_mm: 0, pix_um: 0, auto_alpha: true });
  c.mapping.height_gain = 1; c.mapping.scale_xy = 0;
  Object.assign(c.limit, { ref: 'thickness', h_mm: 80, min_width_pct: 4, gate_db_mm: 8, min_thick_mm: 8 });
  c.alarms.forEach((a) => { if (a.tag === 'HI-101 H') a.thr = 15; if (a.tag === 'HI-101 HH') a.thr = 40; if (a.tag === 'AI-102') a.thr = 60; });
  Object.assign(c.bench, { speed_src: 'flow', rho_kgm3: 780 });
}

/** Predefinições da aba Arquivo (as do BeltScan). */
export const PREDEFINICOES = {
  'Bancada — demonstração (ganho 8×, limite 250 mm)': (c) => { c.mapping.height_gain = 8; c.limit.h_mm = 250; c.limit.ref = 'thickness'; },
  'Bancada — escala geométrica (ganho 1×, limite 30 mm)': (c) => { c.mapping.height_gain = 1; c.limit.h_mm = 30; c.limit.ref = 'thickness'; },
  'Ensaio com feijão — BCC950 (b 250, H_c 210)': predefFeijao,
  'Geometria de campo — SPEC-GPS-BSC-001': (c) => {
    Object.assign(c.geo, { Hc_mm: 950, b_mm: 350, alpha_deg: 20.2, f_mm: 4, pix_um: 5.86, hfov_deg: 109, camera: 'imx249_4mm' });
    c.mapping.height_gain = 1; c.extraction.mode = 'mono'; c.extraction.max_shift_px = 400;
    c.limit.ref = 'z'; c.limit.h_mm = 424;
  },
  'Só alarmes de diagnóstico sem exigir altura (QI-105 livre)': (c) => { c.alarms.forEach((a) => { if (a.tag === 'QI-105') a.gate = false; }); },
};

export const CAMERAS = {
  custom: { label: 'Personalizada' },
  bcc950: { label: 'Logitech BCC950 (HFOV 70,42°)', hfov_deg: 70.42, f_mm: 0, pix_um: 0 },
  imx249_4mm: { label: 'Daheng IMX249 + lente 4 mm (campo)', hfov_deg: 109, f_mm: 4, pix_um: 5.86 },
};

/**
 * Ensaios gravados (amostras/beltscan/): vídeo + configuração. A configuração
 * dos feijões é a de python/configs (com a referência vazia já capturada); a
 * da bancada é o padrão.
 */
export const ENSAIOS = {
  feijao1: { rotulo: 'Feijão 1 — BCC950', video: 'amostras/beltscan/feijao1.mp4', config: 'amostras/beltscan/feijao1.json', volPython: 618 },
  feijao2: { rotulo: 'Feijão 2 — BCC950', video: 'amostras/beltscan/feijao2.mp4', config: 'amostras/beltscan/feijao2.json', volPython: 494 },
  feijao3: { rotulo: 'Feijão 3 — BCC950', video: 'amostras/beltscan/feijao3.mp4', config: 'amostras/beltscan/feijao3.json', volPython: 305 },
  bancada: { rotulo: 'Bancada — descanso de panela (1º ensaio)', video: 'amostras/beltscan/ensaio_bancada.mp4', config: null },
};

// ------------------------------------------------------------------ utilidades numéricas

const GRAUS = Math.PI / 180;
const fin = Number.isFinite;

/** Mediana de `n` valores de `a` (ordena `a` no lugar); par = média dos dois do meio (numpy). */
function medianaInPlace(a, n) {
  if (n <= 0) return NaN;
  const v = a.subarray ? a.subarray(0, n) : a.slice(0, n);
  v.sort();
  const h = n >> 1;
  return n & 1 ? v[h] : 0.5 * (v[h - 1] + v[h]);
}

/** Mediana de janela ímpar pequena (k ≤ 101) por inserção, em `tmp`. */
function medianaJanela(tmp, k) {
  for (let i = 1; i < k; i++) {
    const x = tmp[i]; let j = i - 1;
    while (j >= 0 && tmp[j] > x) { tmp[j + 1] = tmp[j]; j--; }
    tmp[j + 1] = x;
  }
  return tmp[k >> 1];
}

/** Percentil com interpolação linear (np.nanpercentile padrão) dos `n` valores já ordenados. */
function percentilOrdenado(v, n, p) {
  if (n <= 0) return NaN;
  const pos = (p / 100) * (n - 1), i = Math.floor(pos), f = pos - i;
  return i + 1 < n ? v[i] + (v[i + 1] - v[i]) * f : v[n - 1];
}

/**
 * Ajuste polinomial de mínimos quadrados (np.polyfit), com u normalizado para
 * a conta ficar bem condicionada. Devolve uma função u → v.
 */
export function ajustePolinomio(us, vs, n, ordem) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { if (us[i] < mn) mn = us[i]; if (us[i] > mx) mx = us[i]; }
  const u0 = (mn + mx) / 2, su = Math.max(1, (mx - mn) / 2), m = ordem + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  const p = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const t = (us[i] - u0) / su; p[0] = 1;
    for (let k = 1; k < m; k++) p[k] = p[k - 1] * t;
    for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) A[r][c] += p[r] * p[c]; A[r][m] += p[r] * vs[i]; }
  }
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    if (Math.abs(A[c][c]) < 1e-300) continue;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  const co = A.map((row, i) => (Math.abs(row[i]) < 1e-300 ? 0 : row[m] / row[i]));
  return (u) => { const t = (u - u0) / su; let v = 0, q = 1; for (const c of co) { v += c * q; q *= t; } return v; };
}

// ------------------------------------------------------------------ geometria (geometria.py)

/** Geometria resolvida para um quadro W×H (intrínsecos derivados da configuração). */
export function geometria(geo, W, H) {
  const fpx = geo.f_mm > 0 && geo.pix_um > 0 ? (geo.f_mm * 1000) / geo.pix_um : (W / 2) / Math.tan((geo.hfov_deg * GRAUS) / 2);
  return {
    W, H, fpx, cu: (W - 1) / 2, cv: (H - 1) / 2,
    Hc: +geo.Hc_mm, b: +geo.b_mm, a: geo.alpha_deg * GRAUS, s: geo.v_sign < 0 ? -1 : 1,
    tr: Math.tan((geo.roll_deg || 0) * GRAUS), alphaDeg: +geo.alpha_deg,
  };
}
const LIM_TH = Math.PI / 2 - 1e-3;
export function zDeV(G, v) {
  let t = G.a + Math.atan((G.s * (v - G.cv)) / G.fpx);
  t = t < 1e-3 ? 1e-3 : t > LIM_TH ? LIM_TH : t;
  return G.Hc - G.b / Math.tan(t);
}
export function xDeUV(G, u, v) {
  const phi = Math.atan((G.s * (v - G.cv)) / G.fpx);
  let t = G.a + phi;
  t = t < 1e-3 ? 1e-3 : t > LIM_TH ? LIM_TH : t;
  return ((u - G.cu) * G.b * Math.cos(phi)) / (G.fpx * Math.sin(t));
}
export const desgirar = (G, u, v) => v - (u - G.cu) * G.tr;
export function vDeZ(G, z) { const t = Math.atan2(G.b, G.Hc - z); return G.cv + G.s * G.fpx * Math.tan(t - G.a); }
export function dzdv(G, v) { const phi = Math.atan((G.s * (v - G.cv)) / G.fpx), t = G.a + phi; return (G.b * Math.cos(phi) ** 2) / (G.fpx * Math.sin(t) ** 2); }
export function sombra(G, h) { const t = Math.atan2(G.b, Math.max(G.Hc - h, 1e-3)); return h * Math.tan(t); }
export const miraDeg = (geo) => Math.atan2(geo.b_mm, geo.Hc_mm) / GRAUS;

/** Resumo de projeto (geometria.py › summary): resolução, faixa de z, campo, linha no quadro. */
export function resumoGeometria(G) {
  const v0 = vDeZ(G, 0), z0 = zDeV(G, 0), z1 = zDeV(G, G.H - 1);
  return {
    fpx: G.fpx, mira: Math.atan2(G.b, G.Hc) / GRAUS, v0, dz: dzdv(G, v0), dzSub: dzdv(G, v0) / 10,
    th: (G.a + Math.atan((G.s * (v0 - G.cv)) / G.fpx)) / GRAUS,
    zmin: Math.min(z0, z1), zmax: Math.max(z0, z1), campo: xDeUV(G, G.W - 1, v0) - xDeUV(G, 0, v0),
    noQuadro: v0 >= 0 && v0 <= G.H - 1,
  };
}

/** Geometria de campo da SPEC (galeria da correia de campo): resolução na correia com α 25° e a mira real. */
export function resumoCampo() {
  const G = geometria({ Hc_mm: 950, b_mm: 350, alpha_deg: 25, f_mm: 4, pix_um: 5.86, v_sign: -1 }, 1920, 1200);
  return resumoGeometria(G);
}

/**
 * Ajuste de α (e b) por blocos (geometria.py › fit_angle): pontos [v_ref, v_obj, h_mm].
 * Varre α de 2° a 85° a cada 0,25° nos dois sentidos de v (e b de 0,4× a 2,5×) e refina a 0,005°.
 */
export function ajustarAngulo(geo, W, H, pontos, ajustarB = false) {
  const P = pontos.map((p) => p.map(Number));
  const bGrade = ajustarB && P.length >= 2
    ? Array.from({ length: 85 }, (_, i) => geo.b_mm * 0.4 + ((geo.b_mm * 2.5 - geo.b_mm * 0.4) * i) / 84) : [geo.b_mm];
  const sse = (g) => { const G = geometria(g, W, H); let e = 0; for (const [vr, vo, h] of P) { const r = zDeV(G, vo) - zDeV(G, vr) - h; e += r * r; } return e; };
  let best = null;
  for (const s of [1, -1]) for (const b of bGrade) for (let i = 0; 2 + 0.25 * i < 85; i++) {
    const a = 2 + 0.25 * i, e = sse({ ...geo, v_sign: s, b_mm: b, alpha_deg: a });
    if (!best || e < best.e) best = { e, a, b, s };
  }
  const a0 = best.a;
  for (let i = 0; a0 - 0.3 + 0.005 * i < a0 + 0.3; i++) {
    const a = a0 - 0.3 + 0.005 * i, e = sse({ ...geo, v_sign: best.s, b_mm: best.b, alpha_deg: a });
    if (e < best.e) best = { ...best, e, a };
  }
  const G = geometria({ ...geo, v_sign: best.s, b_mm: best.b, alpha_deg: best.a }, W, H);
  const res = P.map(([vr, vo, h]) => zDeV(G, vo) - zDeV(G, vr) - h);
  return { a: best.a, b: best.b, s: best.s, rms: Math.sqrt(res.reduce((q, r) => q + r * r, 0) / res.length), max: Math.max(...res.map(Math.abs)) };
}

// ------------------------------------------------------------------ correia (correia.py)

export function din22101(belt) {
  const b = (0.9 * belt.B_mm) / 1000 - 0.05, l3 = belt.roll_mm / 1000;
  const lam = belt.trough_deg * GRAUS, beta = belt.surcharge_deg * GRAUS;
  const A1 = ((l3 + (b - l3) * Math.cos(lam)) ** 2 * Math.tan(beta)) / 6;
  const A2 = (l3 + ((b - l3) / 2) * Math.cos(lam)) * (((b - l3) / 2) * Math.sin(lam));
  let k = 1;
  if (belt.on_incline) {
    const d = belt.incline_deg * GRAUS;
    k = Math.sqrt(Math.max(0, (Math.cos(d) ** 2 - Math.cos(beta) ** 2) / (1 - Math.cos(beta) ** 2)));
  }
  return { b, A1, A2, k, Ath: k * A1 + A2, Qth: (k * A1 + A2) * belt.speed_ms * 3600 };
}
export const meiaPlana = (belt) => belt.roll_mm / 2;
export const pontaAsa = (belt) => belt.roll_mm / 2 + belt.roll_mm * Math.cos(belt.trough_deg * GRAUS);
/** Superfície da correia vazia (mm) na posição x a partir do eixo. */
export function calhaZ(belt, x) {
  const ax = Math.abs(x), hp = belt.roll_mm / 2, tip = pontaAsa(belt);
  return ax <= hp ? 0 : (Math.min(ax, tip) - hp) * Math.tan(belt.trough_deg * GRAUS);
}

// ------------------------------------------------------------------ extração (nucleo.py)

/**
 * Mínimo (ou máximo) deslizante de janela k centrada (raio r = k>>1) por
 * van Herk/Gil-Werman. `src` tem n valores; out[i] = ext(src[i−r..i+r]) para
 * i em [r, n−r). g/h são áreas de trabalho de tamanho ≥ n.
 */
function deslizante(src, n, k, out, g, h, minimo) {
  const r = k >> 1;
  for (let b0 = 0; b0 < n; b0 += k) {
    const b1 = Math.min(n, b0 + k);
    g[b0] = src[b0];
    for (let i = b0 + 1; i < b1; i++) g[i] = minimo ? Math.min(g[i - 1], src[i]) : Math.max(g[i - 1], src[i]);
    h[b1 - 1] = src[b1 - 1];
    for (let i = b1 - 2; i >= b0; i--) h[i] = minimo ? Math.min(h[i + 1], src[i]) : Math.max(h[i + 1], src[i]);
  }
  for (let i = r; i < n - r; i++) out[i] = minimo ? Math.min(h[i - r], g[i + r]) : Math.max(h[i - r], g[i + r]);
}

/**
 * Extrai a linha laser: por coluna da faixa de busca, o pico do sinal (com a
 * referência, só na faixa ±max_shift_px em torno dela), centroide subpixel com
 * meia janela, validade por limiar e contraste local, e o despike.
 */
export class Extrator {
  constructor() {
    this.W = 0; this.H = 0;
    this.rows = null; this.picos = null; this.picosValidos = [];
    this.raw = new Uint8Array(0); this.blur = new Uint8Array(0);
    this.col = new Float32Array(0); this.colA = new Float32Array(0); this.colE = new Float32Array(0); this.colD = new Float32Array(0);
    this.g = new Float32Array(0); this.h = new Float32Array(0);
    this.hist = new Uint32Array(256);
    this.dsIdx = new Int32Array(0); this.dsVal = new Float32Array(0); this.dsPad = new Float32Array(0); this.dsTmp = new Float32Array(101);
  }

  _preparar(W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.rows = new Float32Array(W); this.picos = new Float32Array(W);
    this.dsIdx = new Int32Array(W); this.dsVal = new Float32Array(W); this.dsPad = new Float32Array(W + 102);
  }

  static roi(E, W, H) {
    const r = E.roi || [0, 0, 0, 0];
    if (r[2] > r[0] && r[3] > r[1]) {
      const x0 = Math.max(0, Math.min(W, Math.round(r[0]))), y0 = Math.max(0, Math.min(H, Math.round(r[1])));
      const x1 = Math.max(x0, Math.min(W, Math.round(r[2]))), y1 = Math.max(y0, Math.min(H, Math.round(r[3])));
      if (x1 - x0 >= 2 && y1 - y0 >= 2) return [x0, y0, x1, y1];
    }
    return [0, 0, W, H];
  }

  /**
   * @param {ImageData|{width,height,data}} img  RGBA
   * @param {object} E    configuração "extraction"
   * @param {Float32Array|null} ref  linha de referência (NaN fora da faixa) ou null
   * @param {boolean} espelhado  o quadro chegou espelhado (desfaz aqui: as colunas são as da câmera)
   * @returns {Float32Array} rows (NaN onde não há linha), reaproveitado
   */
  extrair(img, E, ref, espelhado = false) {
    const W = img.width, H = img.height, d = img.data;
    this._preparar(W, H);
    const [x0, y0, x1, y1] = Extrator.roi(E, W, H);
    const w = x1 - x0, h = y1 - y0;
    const th = Boolean(E.tophat);
    const k = Math.max(3, (E.tophat_k | 0) | 1), r = th ? k >> 1 : 0;
    // região do sinal bruto: a faixa + a margem que o desfoque (1) e o top-hat (2r) pedem
    const ya = Math.max(0, y0 - 2 * r - 1), yb = Math.min(H, y1 + 2 * r + 1);
    const xa = Math.max(0, x0 - 1), xb = Math.min(W, x1 + 1);
    const rw = xb - xa, rh = yb - ya;
    if (this.raw.length < rw * rh) this.raw = new Uint8Array(rw * rh);
    const raw = this.raw, mono = E.mode === 'mono';
    for (let y = ya; y < yb; y++) {
      let q = (y - ya) * rw;
      const base = y * W;
      for (let x = xa; x < xb; x++, q++) {
        const p = (base + (espelhado ? W - 1 - x : x)) * 4;
        const R = d[p], Gc = d[p + 1], B = d[p + 2];
        if (mono) raw[q] = (R * 4899 + Gc * 9617 + B * 1868 + 8192) >> 14;    // cv2 BGR2GRAY
        else { const v = R - ((Gc + B) >> 1); raw[q] = v < 0 ? 0 : v; }        // excesso de vermelho
      }
    }
    // GaussianBlur 3×3 (bit-exato em uint8: [1 2 1]⊗[1 2 1]/16 com arredondamento), borda reflect101
    const ba = Math.max(0, y0 - 2 * r), bb = Math.min(H, y1 + 2 * r), bh = bb - ba;
    if (this.blur.length < w * bh) this.blur = new Uint8Array(w * bh);
    const blur = this.blur;
    const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
    for (let y = ba; y < bb; y++) {
      const rm = (refl(y - 1, H) - ya) * rw, r0 = (y - ya) * rw, rp = (refl(y + 1, H) - ya) * rw;
      let q = (y - ba) * w;
      for (let x = x0; x < x1; x++, q++) {
        const cm = refl(x - 1, W) - xa, c0 = x - xa, cp = refl(x + 1, W) - xa;
        const s = raw[rm + cm] + 2 * raw[rm + c0] + raw[rm + cp]
          + 2 * (raw[r0 + cm] + 2 * raw[r0 + c0] + raw[r0 + cp])
          + raw[rp + cm] + 2 * raw[rp + c0] + raw[rp + cp];
        blur[q] = (s + 8) >> 4;
      }
    }
    // por coluna: top-hat vertical (abertura 1×k, borda ignorada), mediana, pico, centroide
    const n = h + 4 * r;
    if (this.colA.length < n) {
      this.colA = new Float32Array(n); this.colE = new Float32Array(n); this.colD = new Float32Array(n);
      this.g = new Float32Array(n); this.h = new Float32Array(n);
    }
    if (this.col.length < h) this.col = new Float32Array(h);
    const A = this.colA, Ero = this.colE, Dil = this.colD, col = this.col, hist = this.hist;
    const rows = this.rows, pk = this.picos;
    rows.fill(NaN); pk.fill(0);
    const pv = this.picosValidos; pv.length = 0;
    const thr = +E.thr, ck = +E.contrast_k, hw = E.half_win | 0, ms = +E.max_shift_px;
    const comRef = Boolean(ref && ref.length === W);
    for (let x = x0; x < x1; x++) {
      const cx = x - x0;
      if (th) {
        // A: sinal desfocado nas linhas [y0−2r, y1+2r); fora do quadro = 255 (não entra no mínimo)
        for (let i = 0; i < n; i++) { const y = y0 - 2 * r + i; A[i] = y < 0 || y >= H ? 255 : blur[(y - ba) * w + cx]; }
        deslizante(A, n, k, Ero, this.g, this.h, true);
        // erosão fora do quadro = 0 (não entra no máximo da dilatação)
        for (let i = r; i < n - r; i++) { const y = y0 - 2 * r + i; if (y < 0 || y >= H) Ero[i] = 0; }
        for (let i = 0; i < r; i++) { Ero[i] = 0; Ero[n - 1 - i] = 0; }
        deslizante(Ero, n, k, Dil, this.g, this.h, false);
        for (let j = 0; j < h; j++) col[j] = A[j + 2 * r] - Dil[j + 2 * r];
      } else {
        for (let j = 0; j < h; j++) col[j] = blur[(y0 + j - ba) * w + cx];
      }
      // mediana da coluna inteira da faixa (np.median, par = média dos dois do meio)
      hist.fill(0);
      for (let j = 0; j < h; j++) hist[col[j]]++;
      let med;
      {
        const alvo1 = (h - 1) >> 1, alvo2 = h >> 1; let acc = 0, m1 = -1, m2 = -1;
        for (let v = 0; v < 256; v++) {
          acc += hist[v];
          if (m1 < 0 && acc > alvo1) m1 = v;
          if (acc > alvo2) { m2 = v; break; }
        }
        med = 0.5 * (m1 + m2);
      }
      // pico: com referência, só dentro de ±max_shift_px dela
      let lo = 0, hi = h - 1;
      if (comRef) {
        const c = ref[x] - y0;
        if (!fin(c)) { pk[x] = 0; continue; }
        lo = Math.max(0, Math.ceil(c - ms)); hi = Math.min(h - 1, Math.floor(c + ms));
        if (hi < lo) { pk[x] = 0; continue; }
      }
      let am = lo, peak = -1;
      for (let j = lo; j <= hi; j++) if (col[j] > peak) { peak = col[j]; am = j; }
      pk[x] = peak;
      if (!(peak >= thr && peak >= ck * med + 5)) continue;
      let num = 0, den = 0;
      for (let j = -hw; j <= hw; j++) {
        const yy = Math.min(h - 1, Math.max(0, am + j));
        const v = col[yy] - thr * 0.5;
        if (v > 0) { num += yy * v; den += v; }
      }
      rows[x] = (den > 0 ? num / den : am) + y0;
      pv.push(peak);
    }
    this._despike(E.despike_win | 1, +E.despike_tol);
    return rows;
  }

  /** Rejeita pontos que destoam da mediana móvel (reflexo, partícula, borda). */
  _despike(k, tol) {
    const r = this.rows, W = this.W, idx = this.dsIdx, val = this.dsVal;
    let n = 0;
    for (let i = 0; i < W; i++) if (fin(r[i])) { idx[n] = i; val[n] = r[i]; n++; }
    if (n < k) return;
    const hk = k >> 1, pad = this.dsPad.length >= n + 2 * hk ? this.dsPad : (this.dsPad = new Float32Array(n + 2 * hk));
    for (let i = 0; i < n + 2 * hk; i++) pad[i] = val[Math.min(n - 1, Math.max(0, i - hk))];
    const tmp = this.dsTmp.length >= k ? this.dsTmp : (this.dsTmp = new Float32Array(k));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < k; j++) tmp[j] = pad[i + j];
      const m = medianaJanela(tmp, k);
      if (Math.abs(val[i] - m) > tol) r[idx[i]] = NaN;
    }
  }
}

// ------------------------------------------------------------------ FFT e correlação de fase (cv2.phaseCorrelate)

/** Menor 2^a·3^b·5^c ≥ n (cv2.getOptimalDFTSize). */
export function tamanhoOtimoDFT(n) {
  for (let m = Math.max(1, n); ; m++) {
    let x = m;
    for (const p of [2, 3, 5]) while (x % p === 0) x /= p;
    if (x === 1) return m;
  }
}

const planos = new Map();
/** DFT complexa de tamanho n qualquer (radix-2 direto, Bluestein para o resto), in-place. */
function plano(n) {
  let P = planos.get(n);
  if (P) return P;
  const pot2 = (n & (n - 1)) === 0;
  const m = pot2 ? n : 1 << Math.ceil(Math.log2(2 * n - 1));
  const radix = (len) => {
    const rev = new Uint32Array(len), bits = Math.log2(len) | 0;
    for (let i = 0; i < len; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } rev[i] = y; }
    const cs = new Float64Array(len / 2), sn = new Float64Array(len / 2);
    for (let i = 0; i < len / 2; i++) { cs[i] = Math.cos((2 * Math.PI * i) / len); sn[i] = -Math.sin((2 * Math.PI * i) / len); }
    return { len, rev, cs, sn };
  };
  P = { n, pot2, m, R: radix(m) };
  if (!pot2) {
    // chirp w_k = exp(−iπk²/n), com k² mod 2n para não perder precisão
    P.wr = new Float64Array(n); P.wi = new Float64Array(n);
    for (let k = 0; k < n; k++) { const ang = (Math.PI * ((k * k) % (2 * n))) / n; P.wr[k] = Math.cos(ang); P.wi[k] = -Math.sin(ang); }
    P.Br = new Float64Array(m); P.Bi = new Float64Array(m);
    P.Br[0] = P.wr[0]; P.Bi[0] = -P.wi[0];
    for (let k = 1; k < n; k++) { P.Br[k] = P.Br[m - k] = P.wr[k]; P.Bi[k] = P.Bi[m - k] = -P.wi[k]; }
    fftRadix2(P.R, P.Br, P.Bi, false);
    P.ar = new Float64Array(m); P.ai = new Float64Array(m);
  }
  planos.set(n, P);
  return P;
}
function fftRadix2(R, re, im, inversa) {
  const n = R.len, rev = R.rev;
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, kk = 0; j < half; j++, kk += step) {
        const c = R.cs[kk], s = inversa ? -R.sn[kk] : R.sn[kk];
        const a = i + j, b = a + half;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
/*
 * Cooley–Tukey misto (fatores 2, 3, 4, 5) para os tamanhos ótimos do OpenCV:
 * recursivo, decimação no tempo, saída numa área separada e sem alocar nada
 * por chamada. 320 pontos custam ~1/8 do Bluestein (3 FFTs de 1024).
 */
const mistos = new Map();
function planoMisto(n) {
  let P = mistos.get(n);
  if (P) return P;
  const fat = []; let x = n;
  for (const f of [4, 2, 3, 5]) while (x % f === 0) { fat.push(f); x /= f; }
  if (x !== 1) return null;
  const c = new Float64Array(n), sn = new Float64Array(n);
  for (let j = 0; j < n; j++) { c[j] = Math.cos((2 * Math.PI * j) / n); sn[j] = -Math.sin((2 * Math.PI * j) / n); }
  P = { n, fat, c, s: sn, sr: new Float64Array(n), si: new Float64Array(n), tr: new Float64Array(5), ti: new Float64Array(5) };
  mistos.set(n, P);
  return P;
}
function fftMisto(P, inR, inI, io, passo, n, nivel, oR, oI, oo, sg) {
  if (n === 1) { oR[oo] = inR[io]; oI[oo] = inI[io]; return; }
  const p = P.fat[nivel], m = n / p, N = P.n, tr = P.tr, ti = P.ti;
  for (let q = 0; q < p; q++) fftMisto(P, inR, inI, io + q * passo, passo * p, m, nivel + 1, oR, oI, oo + q * m, sg);
  const kn = N / n, kp = N / p, C = P.c, S = P.s;
  for (let k = 0; k < m; k++) {
    for (let q = 0; q < p; q++) {
      const i = oo + q * m + k, j = q * k * kn;        // q·k·N/n < N: sem módulo
      const wr = C[j], wi = sg * S[j], a = oR[i], b = oI[i];
      tr[q] = a * wr - b * wi; ti[q] = a * wi + b * wr;
    }
    if (p === 2) {
      oR[oo + k] = tr[0] + tr[1]; oI[oo + k] = ti[0] + ti[1];
      oR[oo + m + k] = tr[0] - tr[1]; oI[oo + m + k] = ti[0] - ti[1];
      continue;
    }
    if (p === 4) {
      // borboleta de 4 pontos: X_s = Σ t_q·(−i·sg)^{q·s}
      const ar = tr[0] + tr[2], ai = ti[0] + ti[2], br = tr[0] - tr[2], bi = ti[0] - ti[2];
      const cr = tr[1] + tr[3], ci = ti[1] + ti[3], dr = tr[1] - tr[3], di = ti[1] - ti[3];
      oR[oo + k] = ar + cr; oI[oo + k] = ai + ci;
      oR[oo + 2 * m + k] = ar - cr; oI[oo + 2 * m + k] = ai - ci;
      // (−i·sg)·d = sg·(di − i·dr)
      oR[oo + m + k] = br + sg * di; oI[oo + m + k] = bi - sg * dr;
      oR[oo + 3 * m + k] = br - sg * di; oI[oo + 3 * m + k] = bi + sg * dr;
      continue;
    }
    for (let s2 = 0; s2 < p; s2++) {
      let sr = 0, si = 0;
      for (let q = 0; q < p; q++) {
        const j = ((q * s2) % p) * kp, wr = P.c[j], wi = sg * P.s[j];
        sr += tr[q] * wr - ti[q] * wi; si += tr[q] * wi + ti[q] * wr;
      }
      oR[oo + s2 * m + k] = sr; oI[oo + s2 * m + k] = si;
    }
  }
}

/** DFT (sem escala) de `re/im` de tamanho n, in-place. inversa = sinal +. */
function dft(re, im, n, inversa) {
  const Q = planoMisto(n);
  if (Q) {
    Q.sr.set(re.subarray ? re.subarray(0, n) : re.slice(0, n)); Q.si.set(im.subarray ? im.subarray(0, n) : im.slice(0, n));
    fftMisto(Q, Q.sr, Q.si, 0, 1, n, 0, re, im, 0, inversa ? -1 : 1);
    return;
  }
  const P = plano(n);
  if (P.pot2) { fftRadix2(P.R, re, im, inversa); return; }
  if (inversa) for (let i = 0; i < n; i++) im[i] = -im[i];   // IDFT = conj(DFT(conj(x)))
  const ar = P.ar, ai = P.ai, m = P.m;
  ar.fill(0); ai.fill(0);
  for (let k = 0; k < n; k++) { ar[k] = re[k] * P.wr[k] - im[k] * P.wi[k]; ai[k] = re[k] * P.wi[k] + im[k] * P.wr[k]; }
  fftRadix2(P.R, ar, ai, false);
  for (let k = 0; k < m; k++) { const r = ar[k] * P.Br[k] - ai[k] * P.Bi[k], i = ar[k] * P.Bi[k] + ai[k] * P.Br[k]; ar[k] = r; ai[k] = i; }
  fftRadix2(P.R, ar, ai, true);
  for (let k = 0; k < n; k++) {
    const cr = ar[k] / m, ci = ai[k] / m;
    re[k] = cr * P.wr[k] - ci * P.wi[k];
    im[k] = cr * P.wi[k] + ci * P.wr[k];
    if (inversa) im[k] = -im[k];
  }
}
/** DFT 2D in-place (M linhas × N colunas). */
function dft2(re, im, M, N, inversa, tr, ti) {
  for (let y = 0; y < M; y++) {
    const o = y * N;
    for (let x = 0; x < N; x++) { tr[x] = re[o + x]; ti[x] = im[o + x]; }
    dft(tr, ti, N, inversa);
    for (let x = 0; x < N; x++) { re[o + x] = tr[x]; im[o + x] = ti[x]; }
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < M; y++) { tr[y] = re[y * N + x]; ti[y] = im[y * N + x]; }
    dft(tr, ti, M, inversa);
    for (let y = 0; y < M; y++) { re[y * N + x] = tr[y]; im[y * N + x] = ti[y]; }
  }
}

/** Janela de Hanning de cv2.createHanningWindow (com a raiz final). */
function hanning(rows, cols) {
  const w = new Float64Array(rows * cols);
  const c0 = (2 * Math.PI) / (cols - 1), c1 = (2 * Math.PI) / (rows - 1);
  for (let i = 0; i < rows; i++) {
    const wr = 0.5 * (1 - Math.cos(c1 * i));
    for (let j = 0; j < cols; j++) w[i * cols + j] = Math.sqrt(wr * 0.5 * (1 - Math.cos(c0 * j)));
  }
  return w;
}

/**
 * Correlação de fase com o mesmo algoritmo do cv2.phaseCorrelate(a, b, janela):
 * janela, preenchimento até o tamanho ótimo de DFT, espectro cruzado
 * normalizado, DFT inversa, fftShift por quadrantes, pico e centroide 5×5.
 * Devolve { dx, dy, resp }. Buffers reaproveitados por tamanho.
 */
export class CorrelacaoFase {
  constructor() { this.chave = ''; }
  _preparar(rows, cols) {
    const ch = rows + 'x' + cols;
    if (ch === this.chave) return;
    this.chave = ch;
    const M = tamanhoOtimoDFT(rows), N = tamanhoOtimoDFT(cols);
    Object.assign(this, {
      rows, cols, M, N, jan: hanning(rows, cols),
      r1: new Float64Array(M * N), i1: new Float64Array(M * N), r2: new Float64Array(M * N), i2: new Float64Array(M * N),
      C: new Float64Array(M * N), ci: new Float64Array(M * N), tr: new Float64Array(Math.max(M, N)), ti: new Float64Array(Math.max(M, N)),
    });
  }
  correlacionar(a, b, rows, cols) {
    this._preparar(rows, cols);
    const { M, N, jan, r1, i1, r2, i2, C, tr, ti } = this;
    r1.fill(0); i1.fill(0); r2.fill(0); i2.fill(0);
    // o OpenCV só aplica a janela quando há preenchimento (medido no cv2: sem
    // preenchimento, com e sem janela dão o mesmo resultado) — reproduzido aqui
    const usaJan = M !== rows || N !== cols;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const k = y * cols + x, w = usaJan ? jan[k] : 1;
      r1[y * N + x] = a[k] * w; r2[y * N + x] = b[k] * w;
    }
    // as duas entradas são reais: uma DFT só de z = a + i·b, e
    // A_k = (Z_k + conj Z_−k)/2, B_k = (Z_k − conj Z_−k)/(2i)
    for (let k = 0; k < M * N; k++) i1[k] = r2[k];
    dft2(r1, i1, M, N, false, tr, ti);
    for (let y = 0; y < M; y++) {
      const ny = y ? M - y : 0;
      for (let x = 0; x < N; x++) {
        const k = y * N + x, kk = ny * N + (x ? N - x : 0);
        const zr = r1[k], zi = i1[k], wr = r1[kk], wi = -i1[kk];
        r2[k] = 0.5 * (zr + wr); i2[k] = 0.5 * (zi + wi);              // F1 (guardado em r2/i2)
        C[k] = 0.5 * (zi - wi); this.ci[k] = -0.5 * (zr - wr);          // F2
      }
    }
    // P = F1·conj(F2) / |F1·conj(F2)|
    const ci = this.ci;
    for (let k = 0; k < M * N; k++) {
      const ar = r2[k], ai = i2[k], br = C[k], bi = ci[k];
      const pr = ar * br + ai * bi, pi = ai * br - ar * bi;
      const mg = Math.sqrt(pr * pr + pi * pi);
      if (mg > 0) { r1[k] = pr / mg; i1[k] = pi / mg; } else { r1[k] = 0; i1[k] = 0; }
    }
    dft2(r1, i1, M, N, true, tr, ti);
    // fftShift do OpenCV: troca de quadrantes de tamanho (N>>1)×(M>>1)
    const xm = N >> 1, ym = M >> 1;
    for (let k = 0; k < M * N; k++) C[k] = r1[k];
    const troca = (ax, ay, bx, by) => {
      for (let y = 0; y < ym; y++) for (let x = 0; x < xm; x++) {
        const p = (ay + y) * N + ax + x, q = (by + y) * N + bx + x;
        const t = C[p]; C[p] = C[q]; C[q] = t;
      }
    };
    if (xm && ym) { troca(0, 0, xm, ym); troca(xm, 0, 0, ym); }
    let pk = 0;
    for (let k = 1; k < M * N; k++) if (C[k] > C[pk]) pk = k;
    const py = (pk / N) | 0, px = pk % N;
    const minr = Math.max(0, py - 2), maxr = Math.min(M - 1, py + 2), minc = Math.max(0, px - 2), maxc = Math.min(N - 1, px + 2);
    let sx = 0, sy = 0, sw = 0;
    for (let y = minr; y <= maxr; y++) for (let x = minc; x <= maxc; x++) { const v = C[y * N + x]; sx += x * v; sy += y * v; sw += v; }
    const resp = sw / (M * N);
    sw += 2.220446049250313e-16;
    return { dx: N / 2 - sx / sw, dy: M / 2 - sy / sw, resp };
  }
}

// ------------------------------------------------------------------ alarmes ISA-18.2

export const ROTULO_ESTADO = { NORMAL: 'normal', ATIVO_NR: 'ativo, não reconhecido', ATIVO_R: 'ativo, reconhecido', RTN_NR: 'voltou ao normal, não reconhecido' };
export const SHELVING_MS = 600000;

// ------------------------------------------------------------------ motor

/**
 * O BeltScan inteiro: configuração, referência, calibração, extração,
 * alturas, análise na correia, medição da bancada, alarmes, totais, histórico
 * de alarmes, tendência e gravação das tags. Um por app (ver canal.js).
 */
export class MotorBeltScan {
  constructor(config = null) {
    this.ext = new Extrator();
    this.pc = new CorrelacaoFase();
    this.C = normalizarConfig(config || PADRAO);
    this.W = 0; this.H = 0;
    this.ref = null;
    this.status = '';
    this.reiniciar(false);
    this.journal = [];
    this.shelf = {};
    this.csv = null;
    this.alteracoes = 0;     // sobe a cada mudança da configuração (quem salva compara)
    this._carregarRef();
  }

  // -------------------------------------------------- configuração
  _carregarRef() {
    const rr = this.C.ref_rows;
    this.ref = Array.isArray(rr) && rr.length ? Float32Array.from(rr, (v) => (v == null ? NaN : v)) : null;
  }
  /** Troca a configuração inteira (ensaio, importação, predefinição). */
  definirConfig(cfg, { manterRef = true } = {}) {
    this.C = normalizarConfig(cfg);
    if (manterRef) this._carregarRef(); else { this.ref = null; this.C.ref_rows = null; }
    this.W = 0; this.H = 0;   // força a checagem de resolução no próximo quadro
    this.reiniciar(false);
    this.mudou();
  }
  mudou() { this.alteracoes++; }
  /** JSON "beltscan/4" compatível com o HTML e com o beltscan.py --config. */
  exportar() {
    const c = clonar(this.C);
    c.schema = ESQUEMA;
    c.ref_rows = this.ref ? Array.from(this.ref, (v) => (fin(v) ? +v.toFixed(3) : null)) : null;
    return c;
  }

  /** Zera estado de execução (não a configuração). `limparRef` apaga a referência vazia. */
  reiniciar(limparRef = false) {
    if (limparRef) { this.ref = null; this.C.ref_rows = null; this.mudou(); }
    Object.assign(this, {
      modo: null, refAcc: [], calAcc: [], Af: null, tLast: null, vol: 0, dry: 0, lam: 1, xc: 0,
      gate: false, hEma: null, alarm: {}, tAnt: null, voltas: 0,
      flowPrev: null, vBench: null, flowOk: false, flowConf: 0, bVol: 0, bLast: NaN, bT: null,
      tend: [], retrato: null, quadros: 0,
    });
    this.alarm = {};
  }

  /**
   * A resolução do quadro mudou em relação à da configuração (ROI, exclusões,
   * referência e pontos de calibração estão em pixels): reescala tudo.
   * A largura de base é ui.frame_w (gravada aqui) ou o tamanho de ref_rows.
   */
  _ajustarResolucao(W, H) {
    const C = this.C;
    const bw = C.ui.frame_w || (this.ref ? this.ref.length : 0);
    const bh = C.ui.frame_h || (bw ? Math.round((bw * H) / W) : 0);
    if (bw && (bw !== W || bh !== H)) {
      const kx = W / bw, ky = H / bh;
      const E = C.extraction;
      if (E.roi && E.roi[2] > E.roi[0]) E.roi = [Math.round(E.roi[0] * kx), Math.round(E.roi[1] * ky), Math.round(E.roi[2] * kx), Math.round(E.roi[3] * ky)];
      E.exclude = (E.exclude || []).map(([a, b]) => [Math.round(a * kx), Math.round(b * kx)]);
      C.cal.points = (C.cal.points || []).map(([vr, vo, h]) => [vr * ky, vo * ky, h]);
      if (this.ref) {
        const nr = new Float32Array(W);
        for (let u = 0; u < W; u++) {
          const s = u / kx, i = Math.floor(s), f = s - i;
          const a = this.ref[Math.min(bw - 1, i)], b = this.ref[Math.min(bw - 1, i + 1)];
          nr[u] = (fin(a) && fin(b) ? a + (b - a) * f : fin(a) ? a : b) * ky;
        }
        this.ref = nr;
      }
      E.max_shift_px = Math.max(1, Math.round(E.max_shift_px * ky));
      this.status = `Resolução ${W}×${H} diferente da configuração (${bw}×${bh}): faixa, exclusões e referência reescaladas.`;
      this.mudou();
    }
    C.ui.frame_w = W; C.ui.frame_h = H;
    this.W = W; this.H = H;
    this.hEma = null;
    const n = W;
    this.x = new Float32Array(n); this.h = new Float32Array(n);
    this.xb = new Float32Array(n); this.hb = new Float32Array(n); this.hv = new Float32Array(n);
    this.hf = new Float64Array(n); this.lvl = new Float32Array(n); this.lv = new Float32Array(n);
    this.limV = new Float32Array(n); this.limH = new Float32Array(n); this.tmpK = new Float64Array(128);
    this.dxs = new Float64Array(n);
  }

  get roi() { return Extrator.roi(this.C.extraction, this.W || 1, this.H || 1); }
  _excluido(u) { for (const [a, b] of this.C.extraction.exclude) if (u >= (a | 0) && u < (b | 0)) return true; return false; }

  // -------------------------------------------------- comandos
  capturarReferencia() { this.modo = 'ref'; this.refAcc = []; this.status = 'Capturando referência. Mantenha a área vazia.'; }
  calibrar() {
    if (!this.ref) { this.status = 'Capture a referência antes de calibrar.'; return false; }
    this.modo = 'cal'; this.calAcc = []; return true;
  }
  limparCalibracao() { this.C.cal.points = []; this.mudou(); this.status = 'Calibração apagada. Valem os valores de geometria informados.'; }
  reajustarCalibracao() {
    const pts = this.C.cal.points;
    if (!pts.length || !this.W) return null;
    const f = ajustarAngulo(this.C.geo, this.W, this.H, pts, this.C.cal.fit_b);
    Object.assign(this.C.geo, { alpha_deg: +f.a.toFixed(3), b_mm: +f.b.toFixed(1), v_sign: f.s });
    this.mudou();
    return f;
  }
  inverterV() { this.C.geo.v_sign *= -1; this.mudou(); this.status = `Sentido de v: ${this.C.geo.v_sign > 0 ? '+' : '−'}.`; }
  aplicarGiro() {
    if (!this.ref) { this.status = 'Sem referência para estimar o giro.'; return null; }
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    this.ref.forEach((v, u) => { if (fin(v)) { n++; sx += u; sy += v; sxx += u * u; sxy += u * v; } });
    if (n < 20) return null;
    const g = Math.atan((n * sxy - sx * sy) / (n * sxx - sx * sx)) / GRAUS;
    this.C.geo.roll_deg = +g.toFixed(3); this.mudou();
    this.status = `Giro aplicado: ${g.toFixed(2).replace('.', ',')}°.`;
    return g;
  }
  limiarAutomatico() {
    const p = this.ext.picosValidos.slice().sort((a, b) => a - b);
    if (p.length < 20) { this.status = 'Linha laser insuficiente para estimar o limiar.'; return null; }
    const md = p[p.length >> 1];
    this.C.extraction.thr = Math.round(Math.min(200, Math.max(8, 0.4 * md)));
    this.mudou();
    this.status = `Limiar ajustado para ${this.C.extraction.thr} (40 % da mediana dos picos, ${Math.round(md)}).`;
    return this.C.extraction.thr;
  }
  /** α = θ0 − atan((v_ref − c_v)/(s·f_px)), θ0 = atan(b/H_c), v_ref no centro da faixa (bancada.py). */
  estimarAlfa() {
    if (!this.ref || !this.W) { this.status = 'Capture a referência antes de estimar α.'; return null; }
    const [x0, , x1] = this.roi;
    let v = this.ref[(x0 + x1) >> 1];
    if (!fin(v)) { const f = Array.from(this.ref).filter(fin).sort((a, b) => a - b); if (!f.length) return null; v = f[f.length >> 1]; }
    const G = geometria(this.C.geo, this.W, this.H);
    const a = (Math.atan2(G.b, G.Hc) - Math.atan((v - G.cv) / (G.s * G.fpx))) / GRAUS;
    this.C.geo.alpha_deg = +a.toFixed(3); this.mudou();
    return a;
  }
  zerarTotais() { this.vol = 0; this.dry = 0; this.bVol = 0; this.bLast = NaN; this.status = 'Totais zerados.'; }
  definirROI(r) { this.C.extraction.roi = r.map((v) => Math.round(v)); this.mudou(); this.status = 'Faixa de busca definida. Capture a referência de novo.'; }
  adicionarExclusao(a, b) {
    this.C.extraction.exclude.push([Math.round(Math.min(a, b)), Math.round(Math.max(a, b))]); this.mudou();
    this.status = `Zona de exclusão: colunas ${Math.round(Math.min(a, b))} a ${Math.round(Math.max(a, b))}.`;
  }
  limparExclusoes() { this.C.extraction.exclude = []; this.mudou(); this.status = 'Zonas de exclusão removidas.'; }
  /** Troca todas as zonas de exclusão (colunas [a, b)) — edição na imagem do app (beltscan-marcas.js). */
  definirExclusoes(lista) {
    this.C.extraction.exclude = lista.map(([a, b]) => [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))]);
    this.mudou();
    this.status = lista.length ? `Zonas de exclusão: ${lista.length} (definidas na imagem).` : 'Zonas de exclusão removidas.';
  }
  /**
   * Faixa da imagem onde o fluxo óptico da bancada mede a velocidade, em px do
   * quadro: [x0, y0, x1, y1, v_mediana_da_referência, s]. É a mesma conta de
   * _fluxo (flow_near_px/flow_far_px a partir da linha de referência, 70 %
   * centrais da faixa de busca). null sem referência.
   */
  faixaVelocidade() {
    const ref = this.ref, Bc = this.C.bench;
    if (!ref || !this.W) return null;
    const [x0, , x1] = this.roi;
    const v = [];
    for (let u = x0; u < x1; u++) if (fin(ref[u])) v.push(ref[u]);
    if (!v.length) return null;
    const vm = medianaInPlace(Float64Array.from(v), v.length), s = this.C.geo.v_sign < 0 ? -1 : 1;
    const ya = Math.round(vm - s * Bc.flow_near_px), yb = Math.round(vm - s * Bc.flow_far_px);
    const xa = x0 + Math.trunc((x1 - x0) * 0.15), xb = x1 - Math.trunc((x1 - x0) * 0.15);
    return [xa, Math.max(0, Math.min(ya, yb)), xb, Math.min(this.H - 1, Math.max(ya, yb)), vm, s];
  }
  /** Define flow_near_px/flow_far_px pelas bordas (px do quadro) de um retângulo desenhado. */
  definirFaixaVelocidade(yTopo, yBase) {
    const f = this.faixaVelocidade();
    if (!f) return false;
    const vm = f[4], s = f[5], t = Math.min(yTopo, yBase), b = Math.max(yTopo, yBase);
    const near = Math.max(0, Math.round(s > 0 ? vm - b : t - vm));
    const far = Math.max(near + 40, Math.round(s > 0 ? vm - t : b - vm));
    const Bc = this.C.bench;
    if (near === Bc.flow_near_px && far === Bc.flow_far_px) return false;
    Bc.flow_near_px = near; Bc.flow_far_px = far; this.flowPrev = null;
    this.mudou();
    this.status = `Faixa de velocidade: ${near} a ${far} px após a linha (definida na imagem).`;
    return true;
  }

  reconhecer() {
    for (const a of this.C.alarms) {
      const s = this.alarm[a.tag]; if (!s) continue;
      if (s.state === 'ATIVO_NR') { s.state = 'ATIVO_R'; this._log(a, 'reconhecido', s.val); }
      else if (s.state === 'RTN_NR') { s.state = 'NORMAL'; this._log(a, 'reconhecido (já normal)', s.val); }
    }
  }
  /** Shelving ISA-18.2: suprime o anúncio por 10 min (ou retira a supressão). */
  suprimir(tag, agora = Date.now()) {
    if ((this.shelf[tag] || 0) > agora) { this.shelf[tag] = 0; this._log(this.C.alarms.find((x) => x.tag === tag) || { tag, prio: 3 }, 'supressão retirada', NaN); return false; }
    this.shelf[tag] = agora + SHELVING_MS;
    const a = this.C.alarms.find((x) => x.tag === tag) || { tag, prio: 3 };
    this._log(a, 'suprimido 10 min', this.alarm[tag] ? this.alarm[tag].val : NaN);
    return true;
  }
  _log(a, ev, v) {
    this.journal.unshift({ wall: new Date().toLocaleTimeString('pt-BR'), data: new Date().toISOString(), vt: this.tAtual ?? 0, tag: a.tag, prio: a.prio, ev, v, lvl: this.retrato ? this.retrato.lvlRep : NaN });
    if (this.journal.length > 1000) this.journal.length = 1000;
  }

  // -------------------------------------------------- referência e calibração
  _alimentarRef(rows) {
    const C = this.C, E = C.extraction;
    this.refAcc.push(Float32Array.from(rows));
    if (this.refAcc.length < E.ref_frames) return null;
    const W = this.W, n = this.refAcc.length, [x0, , x1] = this.roi;
    const s = C.geo.v_sign < 0 ? -1 : 1, ajuste = E.ref_mode === 'fit';
    const env = new Float32Array(W).fill(NaN), tmp = new Float32Array(n), ruido = [];
    for (let u = x0; u < x1; u++) {
      let k = 0;
      for (const r of this.refAcc) if (fin(r[u])) tmp[k++] = r[u];
      if (!k) continue;
      const v = tmp.subarray(0, k).sort();
      if (ajuste) env[u] = percentilOrdenado(v, k, s < 0 ? E.env_pct : 100 - E.env_pct);
      else {
        env[u] = k & 1 ? v[k >> 1] : 0.5 * (v[(k >> 1) - 1] + v[k >> 1]);
        let m = 0; for (let i = 0; i < k; i++) m += v[i]; m /= k;
        let q = 0; for (let i = 0; i < k; i++) q += (v[i] - m) ** 2;
        ruido.push(Math.sqrt(q / k));
      }
    }
    const ref = new Float32Array(W).fill(NaN);
    let info = '';
    if (ajuste) {
      // envelope do lado vazio + ajuste unilateral (o material só levanta a linha): bancada.py › fit_reference
      const ordem = E.fit_order | 0, tol = +E.fit_tol_px;
      const mask = new Uint8Array(W);
      for (let u = x0; u < x1; u++) if (!this._excluido(u)) mask[u] = 1;
      let ok = Uint8Array.from(mask, (m, u) => (m && fin(env[u]) ? 1 : 0));
      let cont = ok.reduce((a, b) => a + b, 0);
      if (cont < ordem + 5) { this.refAcc = []; this.status = 'Referência: colunas insuficientes para o ajuste.'; return null; }
      const us = new Float64Array(W), vs = new Float64Array(W);
      let f = null;
      for (let it = 0; it < 8; it++) {
        let k = 0;
        for (let u = 0; u < W; u++) if (ok[u]) { us[k] = u; vs[k] = env[u]; k++; }
        f = ajustePolinomio(us, vs, k, ordem);
        const novo = new Uint8Array(W); let nn = 0;
        for (let u = 0; u < W; u++) {
          if (!mask[u] || !fin(env[u])) continue;
          const r = s * (env[u] - f(u));
          if (r < tol && r > -4 * tol) { novo[u] = 1; nn++; }
        }
        if (nn < ordem + 3) break;
        ok = novo; cont = nn;
      }
      for (let u = x0; u < x1; u++) ref[u] = f(u);
      info = ` Ajuste de grau ${ordem} com ${cont} colunas (as demais tinham material).`;
    } else {
      // mediana de quadros com a área vazia, interpolada nas colunas sem linha (np.interp)
      const us = [], vs = [];
      for (let u = 0; u < W; u++) if (fin(env[u])) { us.push(u); vs.push(env[u]); }
      if (us.length > 10) {
        let j = 0;
        for (let u = x0; u < x1; u++) {
          while (j < us.length - 1 && us[j + 1] <= u) j++;
          if (u <= us[0]) ref[u] = vs[0];
          else if (u >= us[us.length - 1]) ref[u] = vs[vs.length - 1];
          else ref[u] = vs[j] + ((vs[j + 1] - vs[j]) * (u - us[j])) / (us[j + 1] - us[j]);
        }
      } else for (let u = x0; u < x1; u++) ref[u] = env[u];
    }
    this.ref = ref; this.refAcc = []; this.hEma = null;
    if (C.geo.auto_alpha) { const a = this.estimarAlfa(); if (a != null) info += ` α estimado: ${a.toFixed(2).replace('.', ',')}°.`; }
    this.mudou();
    ruido.sort((a, b) => a - b);
    this.status = `Referência capturada (${ajuste ? 'envelope + ajuste' : 'mediana de quadros'}).${info}`
      + (ruido.length ? ` Ruído ${ruido[ruido.length >> 1].toFixed(2).replace('.', ',')} px.` : '');
    return true;
  }

  _alimentarCal(rows) {
    const C = this.C, G = geometria(C.geo, this.W, this.H), ref = this.ref;
    const a = [], b = [];
    for (let u = 0; u < this.W; u++) {
      const r = ref[u], v = rows[u];
      if (fin(r) && fin(v)) { const d = r - v; if (Math.abs(d) > C.cal.min_px && Math.abs(d) <= C.extraction.max_shift_px) { a.push(desgirar(G, u, r)); b.push(desgirar(G, u, v)); } }
    }
    if (a.length > 5) this.calAcc.push([medianaInPlace(Float64Array.from(a), a.length), medianaInPlace(Float64Array.from(b), b.length)]);
    if (this.calAcc.length < C.cal.frames) { this.status = `Calibrando com bloco de ${C.cal.height_mm} mm: ${this.calAcc.length}/${C.cal.frames}`; return null; }
    const ma = medianaInPlace(Float64Array.from(this.calAcc.map((p) => p[0])), this.calAcc.length);
    const mb = medianaInPlace(Float64Array.from(this.calAcc.map((p) => p[1])), this.calAcc.length);
    C.cal.points.push([+ma.toFixed(3), +mb.toFixed(3), C.cal.height_mm]);
    this.calAcc = [];
    const f = this.reajustarCalibracao();
    this.status = `Calibrado: α ${f.a.toFixed(2).replace('.', ',')}°, b ${Math.round(f.b)} mm, sentido v ${f.s > 0 ? '+' : '−'}, erro rms ${f.rms.toFixed(2).replace('.', ',')} mm (máx ${f.max.toFixed(2).replace('.', ',')}).`;
    return f;
  }

  // -------------------------------------------------- alturas (beltscan.py › heights)
  _alturas(rows, G) {
    const W = this.W, [x0, , x1] = this.roi, x = this.x, h = this.h, ref = this.ref, C = this.C;
    let nRoi = 0, cobre = 0;
    for (let u = x0; u < x1; u++) if (!this._excluido(u)) nRoi++;
    if (!ref) {
      for (let u = x0; u < x1; u++) if (!this._excluido(u) && fin(rows[u])) cobre++;
      return { comRef: false, cov: nRoi ? cobre / nRoi : 0 };
    }
    const ms = C.extraction.max_shift_px, al = Math.min(1, Math.max(0.01, +C.analysis.temporal_alpha || 1));
    if (al < 1 && (!this.hEma || this.hEma.length !== W)) this.hEma = new Float32Array(W).fill(NaN);
    for (let u = 0; u < W; u++) {
      const r = ref[u];
      if (!fin(r)) { x[u] = NaN; h[u] = NaN; continue; }
      const vr = desgirar(G, u, r);
      x[u] = xDeUV(G, u, vr);
      const v = rows[u];
      if (this._excluido(u) || !fin(v) || Math.abs(r - v) > ms) { h[u] = NaN; continue; }
      let hv = zDeV(G, desgirar(G, u, v)) - zDeV(G, vr);
      if (al < 1) { const p = this.hEma[u]; if (fin(p)) hv = p + al * (hv - p); this.hEma[u] = hv; }
      h[u] = hv;
      if (u >= x0 && u < x1) cobre++;
    }
    return { comRef: true, cov: nRoi ? cobre / nRoi : 0 };
  }

  // -------------------------------------------------- análise na correia (correia.py › LevelAnalyzer)
  _analisar(cov, t, comRef) {
    const C = this.C, P = C.analysis, B = C.belt, L = C.limit, din = din22101(B);
    const q = cov >= P.q_good ? 'BOM' : cov >= P.q_unc ? 'INCERTO' : 'RUIM';
    const m = {
      din, cov, q, A: NaN, fill: NaN, hmax: NaN, center: NaN, Q: NaN, mdry: NaN, peak: NaN,
      lvlRep: NaN, lvlMax: NaN, exRep: NaN, exWidth: 0, gate: false, vol: this.vol, dry: this.dry, perfil: false,
    };
    const W = this.W, x = this.x, h = this.h;
    // map_profile: escala bancada → calha pela largura medida (ou escala fixa)
    let xmin = Infinity, xmax = -Infinity, nok = 0;
    if (comRef) for (let u = 0; u < W; u++) if (fin(x[u]) && fin(h[u])) { nok++; if (x[u] < xmin) xmin = x[u]; if (x[u] > xmax) xmax = x[u]; }
    if (!comRef || nok < 5) {
      this.gate = false;
      if (!comRef) m.q = 'SEM REF';
      this._alarmes(m, t);     // como no Python: sem perfil, o relógio do filtro não anda
      return m;
    }
    const tip = pontaAsa(B), lam = C.mapping.scale_xy > 0 ? +C.mapping.scale_xy : (2 * tip) / Math.max(xmax - xmin, 1e-6);
    this.lam = lam; this.xc = 0.5 * (xmax + xmin);
    const gain = +C.mapping.height_gain, xb = this.xb, hb = this.hb, hv = this.hv, hf = this.hf;
    for (let u = 0; u < W; u++) {
      xb[u] = fin(x[u]) ? (x[u] - this.xc) * lam : NaN;
      hb[u] = fin(h[u]) ? h[u] * lam * gain : NaN;
      hv[u] = fin(hb[u]) ? hb[u] : 0;
    }
    // filtro de perfil da SPEC: mediana de 7 vizinhas, rejeita > 50 mm acima dela, corta o negativo
    const k = (P.median_win | 0) | 1, hk = k >> 1, tmp = this.tmpK.length >= k ? this.tmpK : (this.tmpK = new Float64Array(k));
    for (let u = 0; u < W; u++) {
      for (let j = 0; j < k; j++) tmp[j] = hv[Math.min(W - 1, Math.max(0, u - hk + j))];
      const md = medianaJanela(tmp, k);
      const v = hv[u] - md > P.reject_mm ? md : hv[u];
      hf[u] = Math.max(v, -P.neg_clip_mm);
    }
    let nd = 0;
    for (let u = 1; u < W; u++) { const a = xb[u], b = xb[u - 1]; if (fin(a) && fin(b)) this.dxs[nd++] = Math.abs(a - b); }
    const dx = nd ? medianaInPlace(this.dxs, nd) : 0;
    let soma = 0, hmax = -Infinity, sh = 0, sxh = 0, nIn = 0, nLv = 0;
    const lvl = this.lvl, lv = this.lv;
    for (let u = 0; u < W; u++) {
      lvl[u] = NaN;
      if (!fin(xb[u]) || Math.abs(xb[u]) > tip) continue;
      nIn++; soma += hf[u]; sh += hf[u]; sxh += xb[u] * hf[u];
      if (hf[u] > hmax) hmax = hf[u];
      if (fin(hb[u]) && hf[u] > L.min_thick_mm) { lvl[u] = L.ref === 'z' ? calhaZ(B, xb[u]) + hf[u] : hf[u]; lv[nLv++] = lvl[u]; }
    }
    if (nIn < W) hmax = Math.max(hmax, 0);    // hp = where(inside, h, 0): fora da calha conta 0
    let A = soma * dx * 1e-6;
    if (A < P.zero_frac * din.Ath) A = 0;
    // filtro de 1ª ordem τ (a mesma conta do Python: dt 0 = salto direto)
    if (this.Af == null || this.tLast == null || !fin(this.Af)) this.Af = A;
    else { const dt = Math.max(0, t - this.tLast); const a = dt > 0 ? dt / (P.tau_s + dt) : 1; this.Af += a * (A - this.Af); }
    const Af = this.Af;
    // AI-102: pico local sobre a média de peak_win colunas (hp: fora da calha = 0)
    const pw = (P.peak_win | 0) | 1, ph = pw >> 1;
    const hp = (u) => (fin(xb[u]) && Math.abs(xb[u]) <= tip ? hf[u] : 0);
    let peak = -Infinity, run = 0;
    for (let j = -ph; j <= ph; j++) run += hp(Math.min(W - 1, Math.max(0, j)));
    for (let u = 0; u < W; u++) {
      const d = hp(u) - run / pw; if (d > peak) peak = d;
      run += hp(Math.min(W - 1, u + ph + 1)) - hp(Math.max(0, u - ph));
    }
    const cosf = B.plane_perp || !B.on_incline ? 1 : Math.cos(B.incline_deg * GRAUS);
    const Q = Af * B.speed_ms * 3600 * cosf, mdry = (Q * B.rho_kgm3 * (1 - B.moisture)) / 1000;
    if (this.tLast != null && q !== 'RUIM') {
      const dt = Math.min(1, Math.max(0, t - this.tLast));   // HTML: no máximo 1 s (pausa, salto no vídeo)
      this.vol += (Q / 3600) * dt; this.dry += (mdry / 3600) * dt;
    }
    this.tLast = t;
    // nível representativo: o maior nível que ocupa pelo menos a largura mínima da calha
    const lvs = lv.subarray(0, nLv).sort().reverse();
    const kRep = Math.max(1, Math.ceil((nIn * L.min_width_pct) / 100));
    const lvlRep = nLv >= kRep ? lvs[kRep - 1] : NaN;
    const exRep = fin(lvlRep) ? lvlRep - L.h_mm : -Infinity;
    if (!this.gate && exRep > 0) this.gate = true;
    else if (this.gate && !(exRep > -L.gate_db_mm)) this.gate = false;
    let acima = 0; for (let i = 0; i < nLv; i++) if (lvs[i] > L.h_mm) acima++;
    Object.assign(m, {
      A: Af, fill: (100 * Af) / din.Ath, hmax, Q, mdry, peak, vol: this.vol, dry: this.dry, perfil: true,
      lvlRep, lvlMax: nLv ? lvs[0] : NaN, exRep: fin(exRep) ? exRep : NaN, exWidth: (acima / Math.max(nIn, 1)) * 100, gate: this.gate,
      center: A > 0 && sh > 1e-6 ? Math.max(-50, Math.min(50, (sxh / sh / B.B_mm) * 100)) : 0,
    });
    this._alarmes(m, t);
    return m;
  }

  _valorAlarme(a, m) {
    switch (a.kind) {
      case 'excess': return m.exRep;
      case 'fill': return m.fill;
      case 'peak': return m.peak;
      case 'center': return fin(m.fill) && m.fill > (a.min_fill ?? 10) ? Math.abs(m.center) : 0;
      case 'mdry_dev': return this.C.belt.sp_tsa_h > 0 && fin(m.mdry) ? Math.abs(m.mdry / this.C.belt.sp_tsa_h - 1) * 100 : 0;
      case 'coverage_low': return m.cov * 100;
      default: return NaN;
    }
  }

  /** Máquina de estados ISA-18.2 (correia.py › Alarm.step + o shelving do HTML). */
  _alarmes(m, t) {
    m.gate = this.gate;
    const agora = Date.now(), speedOk = this.C.belt.speed_ms > 0;
    for (const a of this.C.alarms) {
      const st = this.alarm[a.tag] || (this.alarm[a.tag] = { state: 'NORMAL', onSince: null, offSince: null, val: NaN });
      const v = this._valorAlarme(a, m); st.val = v;
      const low = a.kind === 'coverage_low', thr = +a.thr, db = +a.db || 0;
      const gated = a.gate && !this.gate, ok = fin(v);
      let raw = a.on && m.q !== 'SEM REF' && !gated && ok && (low ? v < thr : v > thr);
      if (low && !speedOk && !gated) raw = Boolean(a.on);
      const clearOk = !ok || (low ? v > thr + db : v < thr - db);
      st.shelved = (this.shelf[a.tag] || 0) > agora;
      const ativo = st.state === 'ATIVO_NR' || st.state === 'ATIVO_R';
      if (!ativo) {
        if (raw) {
          if (st.onSince == null || t < st.onSince) st.onSince = t;
          if (t - st.onSince >= a.delay_s) { st.state = 'ATIVO_NR'; st.offSince = null; this._log(a, 'ativou', v); }
        } else st.onSince = null;
      } else if (!a.on || gated || (clearOk && !raw)) {
        if (st.offSince == null || t < st.offSince) st.offSince = t;
        if (!a.on || gated || t - st.offSince >= (a.off_delay_s || 0)) {
          st.state = st.state === 'ATIVO_NR' ? 'RTN_NR' : 'NORMAL'; st.onSince = null;
          this._log(a, gated ? 'normalizou (abaixo da altura limite)' : 'normalizou', v);
        }
      } else st.offSince = null;
    }
  }

  /** Maior prioridade ativa e anunciada (não suprimida); 0 = nenhuma. */
  prioridadeAtiva() {
    let p = 0;
    for (const a of this.C.alarms) {
      const s = this.alarm[a.tag];
      if (s && (s.state === 'ATIVO_NR' || s.state === 'ATIVO_R') && !s.shelved && (!p || a.prio < p)) p = a.prio;
    }
    return p;
  }

  // -------------------------------------------------- bancada (bancada.py › BenchFlow)
  _fluxo(img, G, t, espelhado) {
    const Bc = this.C.bench, ref = this.ref;
    if (!ref) { this.flowPrev = null; return; }
    const [x0, , x1] = this.roi;
    let k = 0; const tmp = this.dxs;
    for (let u = x0; u < x1; u++) if (fin(ref[u])) tmp[k++] = ref[u];
    if (!k) return;
    const vm = medianaInPlace(tmp, k), s = G.s, W = img.width, H = img.height, d = img.data;
    const ya = Math.round(vm - s * Bc.flow_near_px), yb = Math.round(vm - s * Bc.flow_far_px);
    const y0 = Math.max(0, Math.min(ya, yb)), y1 = Math.min(H - 1, Math.max(ya, yb));
    const xa = x0 + Math.trunc((x1 - x0) * 0.15), xb = x1 - Math.trunc((x1 - x0) * 0.15);
    if (y1 - y0 < 40 || xb - xa < 40) return;
    const bw0 = xb - xa, bh0 = y1 - y0, bw = bw0 >> 1, bh = bh0 >> 1;
    // cinza uint8 (cv2) e redução 2× bilinear (cv2.resize INTER_LINEAR)
    if (!this.cinza || this.cinza.length < bw0 * bh0) this.cinza = new Float64Array(bw0 * bh0);
    const g = this.cinza;
    for (let y = 0; y < bh0; y++) for (let x = 0; x < bw0; x++) {
      const xx = xa + x, p = ((y0 + y) * W + (espelhado ? W - 1 - xx : xx)) * 4;
      g[y * bw0 + x] = (d[p] * 4899 + d[p + 1] * 9617 + d[p + 2] * 1868 + 8192) >> 14;
    }
    // duas bandas alternadas (a atual e a anterior): nada é alocado por quadro
    if (!this.bandas || this.bandas[0].length !== bw * bh) this.bandas = [new Float64Array(bw * bh), new Float64Array(bw * bh)];
    const banda = this.bandas[this.flowPrev && this.flowPrev.banda === this.bandas[0] ? 1 : 0], sx = bw0 / bw, sy = bh0 / bh;
    for (let j = 0; j < bh; j++) {
      let fy = (j + 0.5) * sy - 0.5; let iy = Math.floor(fy); fy -= iy;
      if (iy < 0) { iy = 0; fy = 0; } if (iy >= bh0 - 1) { iy = bh0 - 1; fy = 0; }
      const iy1 = Math.min(bh0 - 1, iy + 1);
      for (let i = 0; i < bw; i++) {
        let fx = (i + 0.5) * sx - 0.5; let ix = Math.floor(fx); fx -= ix;
        if (ix < 0) { ix = 0; fx = 0; } if (ix >= bw0 - 1) { ix = bw0 - 1; fx = 0; }
        const ix1 = Math.min(bw0 - 1, ix + 1);
        const a = g[iy * bw0 + ix] * (1 - fx) + g[iy * bw0 + ix1] * fx;
        const b = g[iy1 * bw0 + ix] * (1 - fx) + g[iy1 * bw0 + ix1] * fx;
        banda[j * bw + i] = a * (1 - fy) + b * fy;
      }
    }
    const p = this.flowPrev;
    this.flowPrev = { banda, bw, bh, t, vc: (y0 + y1) / 2 };
    if (!p || p.bw !== bw || p.bh !== bh) return;
    const dt = t - p.t;
    if (!(dt > 0 && dt <= 0.5)) return;
    const r = this.pc.correlacionar(p.banda, banda, bh, bw);
    this.flowConf = r.resp;
    const dy = r.dy * 2;
    if (r.resp < Bc.flow_min_conf || Math.abs(dy) > Bc.flow_max_px) { this.flowOk = false; return; }
    this.flowOk = true;
    const dOf = (v) => { let th = G.a + Math.atan((G.s * (v - G.cv)) / G.fpx); th = th < 1e-3 ? 1e-3 : th > LIM_TH ? LIM_TH : th; return G.Hc * Math.tan(th); };
    const vInst = -(dOf(p.vc + dy / 2) - dOf(p.vc - dy / 2)) / dt;   // + : do plano do laser para a câmera
    const a = dt / (Bc.flow_tau_s + dt);
    this.vBench = this.vBench == null ? vInst : this.vBench + a * (vInst - this.vBench);
  }

  _medirBancada(t, q, comRef) {
    const Bc = this.C.bench, [x0, , x1] = this.roi;
    const v = Bc.speed_src === 'flow' ? this.vBench || 0 : +Bc.speed_mm_s;
    let A = 0;
    if (comRef) {
      const x = this.x, h = this.h; let nd = 0;
      for (let u = x0 + 1; u < x1; u++) if (fin(x[u]) && fin(x[u - 1])) this.dxs[nd++] = Math.abs(x[u] - x[u - 1]);
      const dx = nd ? medianaInPlace(this.dxs, nd) : 0;
      for (let u = x0; u < x1; u++) if (fin(h[u]) && h[u] > Bc.noise_mm) A += h[u] * dx;
    }
    const Q = (A * v) / 1000;   // cm³/s
    if (this.bT != null && t > this.bT && q !== 'RUIM' && q !== 'SEM REF') this.bVol += Q * Math.min(0.5, t - this.bT);
    this.bT = t;
    return { A_b: A, v_b: v, Q_b: Q, vol_b: this.bVol, mass_b: (this.bVol * Bc.rho_kgm3) / 1000, last_b: this.bLast, ok: this.flowOk, conf: this.flowConf };
  }

  // -------------------------------------------------- quadro
  /**
   * Processa um quadro. `t` em segundos: tempo do vídeo (arquivo) ou do relógio
   * (câmera). Um `t` que volta mais de 0,3 s = o vídeo deu a volta (novo ciclo).
   * @returns o retrato do quadro (arrays reaproveitados: copie se for guardar)
   */
  processar(img, t, { espelhado = false, video = false } = {}) {
    const C = this.C;
    if (img.width !== this.W || img.height !== this.H) this._ajustarResolucao(img.width, img.height);
    if (video && this.tAnt != null && t + 0.3 < this.tAnt) {
      // o vídeo deu a volta: novo ciclo da bancada (como o HTML)
      this.voltas++; this.flowPrev = null; this.bT = null; this.tLast = null;
      if (C.bench.reset_on_loop) {
        this.bLast = this.bVol; this.bVol = 0;
        this._log({ tag: 'FQ-201', prio: 3 }, `ciclo concluído: ${Math.round(this.bLast)} cm³`, this.bLast);
      }
      this.tend = this.tend.filter((p) => p.t <= t);
    }
    this.tAnt = t; this.tAtual = t; this.quadros++;
    if (!this.ref && !this.modo && C.extraction.auto_ref) { this.modo = 'ref'; this.refAcc = []; this.status = 'Capturando referência automática nos primeiros quadros…'; }
    const usarRef = this.ref && this.modo !== 'ref' ? this.ref : null;
    const rows = this.ext.extrair(img, C.extraction, usarRef, espelhado);
    if (this.modo === 'ref') {
      const r = this._alimentarRef(rows);
      if (r) this.modo = null; else if (this.modo === 'ref' && this.refAcc.length) this.status = `Capturando referência ${this.refAcc.length}/${C.extraction.ref_frames}…`;
    } else if (this.modo === 'cal') {
      const f = this._alimentarCal(rows);
      if (f) this.modo = null;
    }
    const Gv = geometria(C.geo, this.W, this.H);   // α/b podem ter mudado na referência/calibração
    const { comRef, cov } = this._alturas(rows, Gv);
    this._fluxo(img, Gv, t, espelhado);
    const m = this._analisar(cov, t, comRef);
    m.bench = this._medirBancada(t, m.q, comRef);
    // altura limite levada de volta para a bancada e projetada na imagem
    const L = C.limit, limV = this.limV, limH = this.limH, gain = +C.mapping.height_gain;
    limV.fill(NaN); limH.fill(NaN);
    if (comRef && m.perfil) {
      for (let u = 0; u < this.W; u++) {
        const r = this.ref[u], x = this.xb[u];
        if (!fin(r) || !fin(x)) continue;
        const esp = L.ref === 'z' ? L.h_mm - calhaZ(C.belt, x) : L.h_mm;
        const hb = esp / (this.lam * gain);
        limH[u] = hb;
        if (hb > 0) limV[u] = vDeZ(Gv, zDeV(Gv, desgirar(Gv, u, r)) + hb) + (u - Gv.cu) * Gv.tr;
      }
    }
    const pr = this.prioridadeAtiva();
    this._tendencia({ t, lrep: m.lvlRep, lmax: m.lvlMax, pr, Q: m.Q, A: m.A, Qb: m.bench.Q_b, fill: m.fill });
    if (this.csv) this.csv.push(this._linhaCSV(t, m));
    this.retrato = Object.assign(m, {
      t, W: this.W, H: this.H, G: Gv, rows, ref: this.ref, x: this.x, h: comRef ? this.h : null, xb: this.xb, hb: this.hf,
      lvl: this.lvl, limV, limH, lam: this.lam, modo: this.modo, status: this.status, pr, espelhado,
    });
    return this.retrato;
  }

  _tendencia(p) {
    const T = this.tend;
    if (T.length && p.t < T[T.length - 1].t) { let i = T.length; while (i && T[i - 1].t > p.t) i--; T.length = i; }
    T.push(p);
    const janela = Math.max(10, +this.C.ui.trend_window_s || 60) * 4;    // guarda 4× a janela (vídeo inteiro curto)
    while (T.length > 2 && T[0].t < p.t - janela) T.shift();
    if (T.length > 6000) T.splice(0, T.length - 6000);
  }

  // -------------------------------------------------- CSV
  iniciarCSV() {
    this.csv = ['t_s;qualidade;QI105_cob;acima_limite;HI101_nivel_rep_mm;HI101_excesso_mm;largura_acima_pct;LI101_pct;AI101_m2;HI101_max_mm;AI102_pico_mm;ZI103_pctB;FI101_m3h;FI104_tsah;FQ101_m3;FQ101_tsa;bancada_secao_mm2;bancada_v_mm_s;bancada_Q_cm3_s;bancada_vol_cm3;alfa;b_mm;alarmes'];
  }
  pararCSV() { const c = this.csv; this.csv = null; return c ? c.join('\n') : ''; }
  _linhaCSV(t, m) {
    const n = (v, d) => (fin(v) ? v.toFixed(d) : '');
    const b = m.bench || {};
    const ativos = this.C.alarms.filter((a) => /ATIVO/.test((this.alarm[a.tag] || {}).state || '')).map((a) => a.tag).join('|');
    return [t.toFixed(3), m.q, m.cov.toFixed(3), m.gate ? 1 : 0, n(m.lvlRep, 1), n(m.exRep, 1), n(m.exWidth, 1), n(m.fill, 2), n(m.A, 5), n(m.hmax, 1), n(m.peak, 1),
      n(m.center, 2), n(m.Q, 2), n(m.mdry, 3), n(m.vol, 4), n(m.dry, 5), n(b.A_b, 1), n(b.v_b, 2), n(b.Q_b, 3), n(b.vol_b, 2), this.C.geo.alpha_deg, this.C.geo.b_mm, ativos].join(';');
  }
  csvHistorico() {
    const n = (v, d) => (fin(v) ? v.toFixed(d) : '');
    return 'data_hora;hora;t_video_s;prioridade;tag;evento;valor;nivel_rep_mm\n'
      + this.journal.map((e) => [e.data, e.wall, n(e.vt, 3), e.prio, e.tag, e.ev, n(e.v, 2), n(e.lvl, 1)].join(';')).join('\n');
  }
}
