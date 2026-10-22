/**
 * cv/runtime/livres-i/vbt.js — matemática do VBT (treino baseado em
 * velocidade), sem DOM: roda no navegador e no node (testes).
 *
 * Entrada: amostras { t (ms), x, y (px do quadro, y para baixo), cmPx (escala
 * daquela amostra) }. A escala vem do lado do marcador impresso (tamanho real
 * em cm ÷ lado em px) ou, no modo aproximado, da altura do atleta.
 *
 * Velocidade: regressão linear local da posição no tempo (janela de ±N ms),
 * que aceita amostragem irregular (o pipeline não entrega quadros a passo
 * fixo) e já suaviza o ruído do canto.
 *
 * Repetição = fase CONCÊNTRICA (barra subindo): começa no último cruzamento
 * de v pelo limiar `vLimiar` (0,05 m/s) antes de a velocidade passar de
 * `vDisparo` e termina no primeiro cruzamento seguinte (os instantes saem interpolados entre as
 * amostras). Vale se o deslocamento passar do mínimo do exercício.
 *   velocidade média (VM)  = deslocamento ÷ duração da concêntrica
 *   velocidade média propulsiva (VMP) = até a aceleração cair abaixo de −g
 *   pico                    = máximo de v na fase
 *   potência média          = m·g·VM   (a energia cinética é zero nas pontas)
 *   potência de pico        = máx. de m·(g + a)·v
 *   perda de velocidade (%) = (melhor VM da série − VM da última) ÷ melhor VM
 */

export const G = 9.81;

/**
 * Por exercício:
 *   deslMin   amplitude concêntrica mínima (cm) para contar a repetição
 *   ponto     o que o modo SEM marcador segue: 'quadril' | 'punhos' | 'ombros'
 *   eixo      'vertical' (concêntrica = subir) ou 'horizontal' (concêntrica =
 *             aproximar do tronco, vista lateral)
 *   dur       duração plausível da concêntrica (s): fora disso é ruído/outra coisa
 * Agachamento segue o QUADRIL: a barra nas costas anda com ele (e os punhos,
 * segurando a barra atrás da cabeça, somem do quadro com facilidade).
 */
export const EXERCICIOS = {
  'Agachamento': { deslMin: 20, ponto: 'quadril', eixo: 'vertical', dur: [0.25, 5] },
  'Supino': { deslMin: 12, ponto: 'punhos', eixo: 'vertical', dur: [0.2, 5] },
  'Levantamento terra': { deslMin: 20, ponto: 'punhos', eixo: 'vertical', dur: [0.25, 6] },
  'Desenvolvimento': { deslMin: 18, ponto: 'punhos', eixo: 'vertical', dur: [0.2, 5] },
  'Remada curvada': { deslMin: 10, ponto: 'punhos', eixo: 'vertical', dur: [0.15, 4] },
  'Remada (horizontal)': { deslMin: 15, ponto: 'punhos', eixo: 'horizontal', dur: [0.15, 4] },
  'Power clean': { deslMin: 30, ponto: 'punhos', eixo: 'vertical', dur: [0.15, 3] },
  'Hip thrust': { deslMin: 8, ponto: 'quadril', eixo: 'vertical', dur: [0.2, 5] },
  'Glute bridge (ponte)': { deslMin: 6, ponto: 'quadril', eixo: 'vertical', dur: [0.2, 5] },
  'Outro': { deslMin: 10, ponto: 'punhos', eixo: 'vertical', dur: [0.15, 6] },
};
export function exercicioDe(nome) { return EXERCICIOS[nome] || EXERCICIOS.Outro; }

/**
 * Configuração da sessão a partir dos parâmetros do nó. Sem marcador (pose):
 * suaviza a posição (±90 ms) e sobe os limiares — o ponto da pose treme.
 */
export function configSessao(p, pose = false, aprox = false) {
  const ex = exercicioDe(p.exercicio);
  const c = { deslMin: p.deslMinCm > 0 ? p.deslMinCm : ex.deslMin, massa: p.cargaKg, pausaSerieS: p.pausaSerieS, dur: ex.dur };
  if (pose) Object.assign(c, { suaveMs: 90, meia: 120, vLimiar: 0.06, vDisparo: 0.12, meioPasso: true, ajuste: true, aprox });
  return c;
}
export const NOMES_EXERCICIOS = Object.keys(EXERCICIOS);

/** Zonas de velocidade pela velocidade média concêntrica (m/s). */
export const ZONAS = [
  { nome: 'Força máxima', de: 0, ate: 0.5, cor: '#ef4444' },
  { nome: 'Força acelerativa', de: 0.5, ate: 0.75, cor: '#f97316' },
  { nome: 'Força-velocidade', de: 0.75, ate: 1.0, cor: '#eab308' },
  { nome: 'Velocidade-força', de: 1.0, ate: 1.3, cor: '#22c55e' },
  { nome: 'Velocidade', de: 1.3, ate: Infinity, cor: '#38bdf8' },
];
export function zonaDe(v) {
  if (v == null || !Number.isFinite(v)) return null;
  return ZONAS.find((z) => v >= z.de && v < z.ate) || ZONAS[ZONAS.length - 1];
}

export const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d).replace('.', ','));
const mediana = (a) => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Velocidade e aceleração por regressão local (linear para v, quadrática
 * para a) na janela ±meia (ms). pos = array de números (m), ts = ms.
 */
export function derivadas(ts, pos, meia = 70, minPts = 5) {
  const n = ts.length, v = new Float64Array(n), a = new Float64Array(n);
  let i0 = 0, i1 = 0;
  for (let i = 0; i < n; i++) {
    while (ts[i0] < ts[i] - meia) i0++;
    if (i1 < i) i1 = i;
    while (i1 + 1 < n && ts[i1 + 1] <= ts[i] + meia) i1++;
    let a0 = i0, a1 = i1;
    // poucas amostras na janela: alarga para pelo menos 2 de cada lado
    while (a1 - a0 < minPts - 1 && (a0 > 0 || a1 < n - 1)) { if (a0 > 0) a0--; if (a1 < n - 1) a1++; }
    const m = a1 - a0 + 1;
    if (m < 2) continue;
    // quadrática centrada em ts[i] (s): p = c0 + c1·τ + c2·τ²
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, P0 = 0, P1 = 0, P2 = 0;
    for (let k = a0; k <= a1; k++) {
      const tau = (ts[k] - ts[i]) / 1000, p = pos[k];
      const t2 = tau * tau;
      S0 += 1; S1 += tau; S2 += t2; S3 += t2 * tau; S4 += t2 * t2;
      P0 += p; P1 += p * tau; P2 += p * t2;
    }
    if (m >= 5) {
      // resolve o sistema 3×3 (Cramer)
      const d = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S3 * S2) + S2 * (S1 * S3 - S2 * S2);
      if (Math.abs(d) > 1e-12) {
        const c1 = (S0 * (P1 * S4 - S3 * P2) - P0 * (S1 * S4 - S3 * S2) + S2 * (S1 * P2 - P1 * S2)) / d;
        const c2 = (S0 * (S2 * P2 - P1 * S3) - S1 * (S1 * P2 - P1 * S2) + P0 * (S1 * S3 - S2 * S2)) / d;
        v[i] = c1; a[i] = 2 * c2;
        continue;
      }
    }
    const den = S0 * S2 - S1 * S1;
    v[i] = Math.abs(den) > 1e-12 ? (S0 * P1 - S1 * P0) / den : 0;
  }
  return { v, a };
}

/** Instante (interpolado) em que v cruza o nível `lim` entre as amostras k e k+1. */
function cruzamento(ts, v, k, lim = 0) {
  const v0 = v[k] - lim, v1 = v[k + 1] - lim;
  if (v1 === v0) return ts[k];
  const f = Math.max(0, Math.min(1, v0 / (v0 - v1)));
  return ts[k] + f * (ts[k + 1] - ts[k]);
}
function interp(ts, arr, t) {
  let k = 0;
  while (k < ts.length - 2 && ts[k + 1] < t) k++;
  const f = ts[k + 1] === ts[k] ? 0 : Math.max(0, Math.min(1, (t - ts[k]) / (ts[k + 1] - ts[k])));
  return arr[k] + f * (arr[k + 1] - arr[k]);
}

/** Posição suavizada por regressão quadrática local (±meia ms; Savitzky–Golay irregular). */
export function suavizar(ts, pos, meia) {
  const n = ts.length, out = new Float64Array(n);
  let i0 = 0, i1 = 0;
  for (let i = 0; i < n; i++) {
    while (ts[i0] < ts[i] - meia) i0++;
    if (i1 < i) i1 = i;
    while (i1 + 1 < n && ts[i1 + 1] <= ts[i] + meia) i1++;
    // pelo menos 5 pontos (±2): com 3, a quadrática só interpola e não suaviza nada
    const a0 = Math.min(i0, Math.max(0, i - 2)), a1 = Math.max(i1, Math.min(n - 1, i + 2));
    let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, P0 = 0, P1 = 0, P2 = 0;
    for (let k = a0; k <= a1; k++) {
      const t = (ts[k] - ts[i]) / 1000, p = pos[k], t2 = t * t;
      S0 += 1; S1 += t; S2 += t2; S3 += t2 * t; S4 += t2 * t2; P0 += p; P1 += p * t; P2 += p * t2;
    }
    const d = S0 * (S2 * S4 - S3 * S3) - S1 * (S1 * S4 - S3 * S2) + S2 * (S1 * S3 - S2 * S2);
    out[i] = a1 - a0 >= 3 && Math.abs(d) > 1e-15
      ? (P0 * (S2 * S4 - S3 * S3) - S1 * (P1 * S4 - S3 * P2) + S2 * (P1 * S3 - S2 * P2)) / d
      : P0 / S0;
  }
  return out;
}

/** Ajuste da subida suave (ver detectarReps). Devolve { t0, t1, y0, y1 } ou null. */
export function ajustarSubida(ts, y, t0i, t1i) {
  const a = t0i - 350, b = t1i + 350;
  const idx = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] >= a && ts[i] <= b) idx.push(i);
  if (idx.length < 6) return null;
  let melhor = null;
  const forma = (t, t0, t1) => (t <= t0 ? 0 : t >= t1 ? 1 : (1 - Math.cos((Math.PI * (t - t0)) / (t1 - t0))) / 2);
  const tenta = (t0, t1) => {
    if (t1 - t0 < 80) return;
    let Sf = 0, Sff = 0, Sy = 0, Sfy = 0, Syy = 0;
    for (const i of idx) { const f = forma(ts[i], t0, t1), v = y[i]; Sf += f; Sff += f * f; Sy += v; Sfy += f * v; Syy += v * v; }
    const n = idx.length, det = n * Sff - Sf * Sf;
    if (Math.abs(det) < 1e-12) return;
    const D = (n * Sfy - Sf * Sy) / det, y0 = (Sy - D * Sf) / n;
    const sse = Syy + n * y0 * y0 + D * D * Sff - 2 * y0 * Sy - 2 * D * Sfy + 2 * y0 * D * Sf;
    if (D > 0 && (!melhor || sse < melhor.sse)) melhor = { sse, t0, t1, y0, y1: y0 + D };
  };
  // grade grossa (10 ms, ±160 ms) e depois fina (2 ms, ±12 ms) em volta do melhor
  for (let d0 = -160; d0 <= 160; d0 += 10) for (let d1 = -160; d1 <= 160; d1 += 10) tenta(t0i + d0, t1i + d1);
  if (!melhor) return null;
  const c0 = melhor.t0, c1 = melhor.t1;
  for (let d0 = -12; d0 <= 12; d0 += 2) for (let d1 = -12; d1 <= 12; d1 += 2) tenta(c0 + d0, c1 + d1);
  return melhor;
}

/**
 * Detecta repetições concêntricas num trecho contínuo.
 * am = [{t, x, y, cmPx}], opts = { deslMin (cm), vDisparo (m/s), meia (ms), massa (kg), aPartirDe (ms) }.
 * Devolve { reps, ultimoFim } — ultimoFim = t do fim da última repetição fechada.
 */
export function detectarReps(am, opts = {}) {
  const n = am.length;
  if (n < 5) return { reps: [], ultimoFim: null, v: null };
  const esc = mediana(am.map((s) => s.cmPx).filter((c) => c > 0)) || 0.1;     // cm/px estável no trecho
  const ts = am.map((s) => s.t);
  // coordenada ao longo do eixo da concêntrica (u, + = sentido concêntrico) e
  // perpendicular (w). Sem u/w na amostra: u = −y (subir), w = x — o caso do marcador.
  const yM = am.map((s) => ((s.u != null ? s.u : -s.y) * esc) / 100);           // m, sentido concêntrico
  const xM = am.map((s) => ((s.w != null ? s.w : s.x) * esc) / 100);
  if (opts.suaveMs > 0) {
    // pose: suaviza a POSIÇÃO antes de derivar (regressão quadrática local,
    // o Savitzky–Golay para amostragem irregular) — o punho/quadril da pose
    // treme 1–3 cm de um quadro ao outro, o que viraria ±0,5 m/s
    const ys = suavizar(ts, yM, opts.suaveMs), xs = suavizar(ts, xM, opts.suaveMs);
    for (let i = 0; i < n; i++) { yM[i] = ys[i]; xM[i] = xs[i]; }
  }
  const { v, a } = derivadas(ts, yM, opts.meia || 70);
  const vf = derivadas(ts, yM, 0, 3).v;
  const tmp = (i) => (ts[i] + ts[i + 1]) / 2;
  const vmp = (i) => (yM[i + 1] - yM[i]) / Math.max(1e-6, (ts[i + 1] - ts[i]) / 1000);
  // início/fim da concêntrica: cruzamento de vLim (não de zero — com a barra
  // parada, o ruído cruza o zero o tempo todo e esticaria a fase)
  const vLim = opts.vLimiar || 0.05;
  const vD = opts.vDisparo || 0.1, deslMin = (opts.deslMin || 10) / 100, massa = opts.massa || 0;
  const reps = [];
  let k = 0, ultimoFim = null;
  const rejeitadas = [];      // início (ms) das fases descartadas por amplitude/duração/pico implausíveis
  while (k < n) {
    if (v[k] < vD || (opts.aPartirDe != null && ts[k] <= opts.aPartirDe)) { k++; continue; }
    let s = k;
    while (s > 0 && v[s - 1] > vLim && (opts.aPartirDe == null || ts[s - 1] > opts.aPartirDe)) s--;
    let e = k;
    while (e < n - 1 && v[e + 1] > vLim) e++;
    // ainda subindo — ou a queda está nas últimas amostras, onde a regressão
    // só vê um lado e a velocidade sai falsa: espera mais amostras
    if (e >= n - 1 || ts[n - 1] - ts[e + 1] < (opts.meia || 70) + (opts.suaveMs || 0)) break;
    // Pontas da fase. O cruzamento direto do limiar erra por ±1 amostra: a
    // derivada discreta espalha a velocidade para antes do início e depois do
    // fim. Em vez disso, as pontas são extrapoladas da reta que passa pelos
    // cruzamentos de 25% e 50% do pico (subida e descida) até v = 0 — no
    // perfil meio-seno o erro disso é 0,6% da duração.
    let pk = s;
    for (let i = s; i <= e; i++) if (v[i] > v[pk]) pk = i;
    const vpk = v[pk];
    const L1 = Math.max(0.25 * vpk, vLim), L2 = Math.max(0.5 * vpk, 2 * vLim);
    // os cruzamentos usam a derivada curta (3 amostras): a suavizada achata o
    // pico e alarga a curva, o que puxaria o início para antes e o fim para depois
    // Sem marcador (amostragem de 10–20 Hz): velocidade de MEIO-PASSO da
    // posição suavizada, buscando os cruzamentos a partir do pico para fora,
    // (y[i+1] − y[i]) / Δt no instante médio — a diferença central espalha a
    // borda da fase por ±Δ (67 ms a 15 Hz), o meio-passo só por ±Δ/2.
    const mp = opts.meioPasso;
    const subida = mp
      ? (L) => { for (let i = Math.min(pk, n - 2) - 1; i >= Math.max(s - 3, 0); i--) if (vmp(i) < L && vmp(i + 1) >= L) return tmp(i) + ((L - vmp(i)) / (vmp(i + 1) - vmp(i))) * (tmp(i + 1) - tmp(i)); return null; }
      : (L) => { for (let i = Math.max(s - 2, 1); i <= pk; i++) if (vf[i] >= L) return cruzamento(ts, vf, i - 1, L); return null; };
    const descida = mp
      ? (L) => { for (let i = Math.max(pk - 1, 0); i < Math.min(e + 3, n - 2); i++) if (vmp(i) >= L && vmp(i + 1) < L) return tmp(i) + ((vmp(i) - L) / (vmp(i) - vmp(i + 1))) * (tmp(i + 1) - tmp(i)); return null; }
      : (L) => { for (let i = pk; i < Math.min(e + 3, n - 1); i++) if (vf[i + 1] < L) return cruzamento(ts, vf, i, L); return null; };
    const sA = subida(L1), sB = subida(L2), dA = descida(L1), dB = descida(L2);
    const tLimS = s > 0 ? cruzamento(ts, v, s - 1, vLim) : ts[s];
    const tLimE = cruzamento(ts, v, e, vLim);
    let t0 = sA != null && sB != null && sB > sA ? sA - ((sB - sA) * L1) / (L2 - L1) : tLimS;
    let t1 = dA != null && dB != null && dA > dB ? dA + ((dA - dB) * L1) / (L2 - L1) : tLimE;
    t0 = Math.max(t0, tLimS - 120); t1 = Math.min(t1, tLimE + 120);
    let y0 = interp(ts, yM, t0), y1 = interp(ts, yM, t1);
    if (opts.ajuste) {
      // Sem marcador: as pontas pelos cruzamentos ainda oscilam ±10% com o
      // tremor da pose. Ajusta por mínimos quadrados uma subida suave
      // y = y0 + D·(1 − cos πu)/2 a TODAS as amostras em volta da fase (busca
      // de t0 e t1 em grade de 5 ms; y0 e D saem lineares) — o ruído de cada
      // amostra pesa pouco.
      const f = ajustarSubida(ts, yM, t0, t1);
      if (f) ({ t0, t1, y0, y1 } = f);
    }
    const desl = y1 - y0, dur = (t1 - t0) / 1000;
    k = e + 1;
    const [durMin, durMax] = opts.dur || [0.12, 8];
    if (desl < deslMin || dur < durMin || dur > durMax) { if (desl >= deslMin * 0.5) rejeitadas.push(Math.round(t0)); continue; }
    let pico = 0, tPico = ts[s], potPico = 0, fimProp = t1, xMin = Infinity, xMax = -Infinity;
    let propFechou = false;
    const x0 = interp(ts, xM, t0);
    let desvio = 0;
    for (let i = s; i <= e; i++) {
      if (v[i] > pico) { pico = v[i]; tPico = ts[i]; }
      if (massa) potPico = Math.max(potPico, massa * (G + a[i]) * v[i]);
      if (!propFechou && i > s && ts[i] > tPico && a[i] < -G) { fimProp = ts[i]; propFechou = true; }
      if (xM[i] < xMin) xMin = xM[i]; if (xM[i] > xMax) xMax = xM[i];
      desvio = Math.max(desvio, Math.abs(xM[i] - x0));
    }
    const yProp = interp(ts, yM, fimProp);
    const durProp = (fimProp - t0) / 1000;
    const vm = desl / dur;
    // pico fisicamente impossível para uma barra (> 4 m/s) = salto da detecção
    if (pico > (opts.vMax || 4)) { rejeitadas.push(Math.round(t0)); ultimoFim = t1; continue; }
    reps.push({
      t0, t1, dur, desl: desl * 100, vm, vmp: durProp > 0.05 ? (yProp - y0) / durProp : vm, pico, tPico,
      potMedia: massa ? massa * G * vm : null, potPico: massa ? potPico : null,
      desvioH: desvio * 100, larguraH: (xMax - xMin) * 100,
      // trajetória em px do quadro, para desenhar: o trecho inteiro da concêntrica
      trajeto: am.slice(s, e + 1).map((q) => ({ x: q.x, y: q.y })), cmPx: esc,
    });
    ultimoFim = t1;
  }
  return { reps, ultimoFim, v, ts, rejeitadas };
}

/** Perda de velocidade da série (%): melhor VM × VM da última repetição. */
export function perdaVelocidade(reps) {
  if (!reps || reps.length < 2) return null;
  const melhor = Math.max(...reps.map((r) => r.vm));
  const ult = reps[reps.length - 1].vm;
  return melhor > 0 ? ((melhor - ult) / melhor) * 100 : null;
}

/**
 * O alerta de perda só dispara com dados que o sustentam: pelo menos 3
 * repetições válidas e a melhor acima de um piso (0,15 m/s) — com duas
 * repetições ou velocidades no nível do ruído, "63% de perda" é só ruído.
 */
export function alertaPerda(reps, limite, piso = 0.15) {
  if (!reps || reps.length < 3) return false;
  const melhor = Math.max(...reps.map((r) => r.vm));
  if (!(melhor >= piso)) return false;
  const p = perdaVelocidade(reps);
  return p != null && p > limite;
}

/**
 * Sessão: amostras em trechos contínuos (quebra em salto de tempo para trás —
 * vídeo voltou — ou buraco > lacunaMs), repetições fechadas em séries.
 */
export class SessaoVbt {
  constructor() { this.zerar(); }
  zerar() {
    this.trecho = [];          // amostras do trecho atual
    this.series = [{ reps: [], inicio: null }];
    this.nAmostras = 0;
    this.ultimoFim = null;     // t do fim da última repetição (no trecho atual)
    this.ultimaRepT = null;
    this.vAgora = null;
    this.descartes = 0;
    this.vistasRej = new Set();
    this.t0 = null;
    this.trajetoVivo = [];
  }
  get serie() { return this.series[this.series.length - 1]; }
  get todasReps() { return this.series.flatMap((s, i) => s.reps.map((r) => ({ ...r, serie: i + 1 }))); }
  novaSerie() {
    if (this.serie.reps.length) this.series.push({ reps: [], inicio: null });
  }
  /**
   * cfg = { deslMin, massa, pausaSerieS, meia }. Devolve as repetições novas.
   * a = { t, x, y, cmPx }.
   */
  adicionar(a, cfg = {}) {
    if (this.t0 == null || a.t < this.t0) this.t0 = a.t;   // vídeo que volta ao início: os tempos do relatório não ficam negativos
    const ult = this.trecho[this.trecho.length - 1];
    if (ult && (a.t <= ult.t - 1 || a.t - ult.t > (cfg.lacunaMs || 600))) {
      // trecho novo: o anterior já foi processado amostra a amostra
      this.trecho = [];
      this.ultimoFim = null;
      // o vídeo voltou (repetição do arquivo, salto para trás): é outra série
      if (a.t <= ult.t - 1) { this.novaSerie(); this.ultimaRepT = null; }
    }
    if (ult && Math.abs(a.t - ult.t) < 0.5) return [];          // quadro repetido
    this.trecho.push(a);
    this.nAmostras++;
    // janela de trabalho: as amostras desde ~1 s antes do fim da última repetição
    const corte = (this.ultimoFim != null ? this.ultimoFim : -Infinity) - 1500;
    while (this.trecho.length > 20 && this.trecho[0].t < corte) this.trecho.shift();
    if (this.trecho.length > 900) this.trecho.splice(0, this.trecho.length - 900);   // uma concêntrica nunca passa de ~5 s
    const r = detectarReps(this.trecho, { ...cfg, aPartirDe: this.ultimoFim });
    // a mesma fase rejeitada reaparece a cada amostra (a janela não anda): conta uma vez
    for (const t0 of r.rejeitadas || []) if (![...this.vistasRej].some((x) => Math.abs(x - t0) < 150)) { this.vistasRej.add(t0); this.descartes++; }
    if (this.vistasRej.size > 200) this.vistasRej = new Set([...this.vistasRej].slice(-100));
    if (r.v && r.v.length) this.vAgora = r.v[Math.max(0, r.v.length - 3)];
    const novas = [];
    for (const rep of r.reps) {
      const pausa = cfg.pausaSerieS == null ? 30 : cfg.pausaSerieS;
      if (this.ultimaRepT != null && pausa > 0 && rep.t0 - this.ultimaRepT > pausa * 1000 && this.serie.reps.length) this.novaSerie();
      if (this.serie.inicio == null) this.serie.inicio = rep.t0;
      rep.n = this.serie.reps.length + 1;
      rep.zona = zonaDe(rep.vm).nome;
      this.serie.reps.push(rep);
      rep.perdaAcum = perdaVelocidade(this.serie.reps);
      this.ultimaRepT = rep.t1;
      novas.push(rep);
    }
    if (r.ultimoFim != null) this.ultimoFim = r.ultimoFim;
    return novas;
  }
  /** Resumo da série atual. */
  resumo() {
    const reps = this.serie.reps;
    if (!reps.length) return { n: 0 };
    const vms = reps.map((r) => r.vm);
    const melhor = Math.max(...vms);
    return {
      n: reps.length, melhor, ultima: vms[vms.length - 1], media: vms.reduce((s, v) => s + v, 0) / vms.length,
      perda: perdaVelocidade(reps), picoMax: Math.max(...reps.map((r) => r.pico)),
      potMedia: reps[0].potMedia == null ? null : reps.reduce((s, r) => s + r.potMedia, 0) / reps.length,
    };
  }
}
