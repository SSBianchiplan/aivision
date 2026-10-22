/**
 * cv/runtime/livres-t/esportes.js — a matemática da parte de esportes da onda
 * 2-c, sem DOM e sem modelo (testável no node). Pose BlazePose (33 pontos,
 * px, y para baixo); tempos em ms.
 *
 *   E3  comparar com o movimento de referência: DTW (Sakoe & Chiba 1978) entre
 *       as séries de ângulos, nota e articulação mais divergente por fase
 *   91  yoga: semelhança com a pose de referência e tempo sustentado
 *   87  pular corda: o motor do Salto (SessaoSalto, teste "saltos contínuos")
 *   88  golpes de luta: extensão do braço + pico de velocidade do punho
 *   89  arremesso de basquete: soltura (cotovelo estendendo com o punho acima
 *       da cabeça), ângulo pelo punho ou pela bola, acerto pela área do aro
 *   90  natação: braçadas por volta completa do braço (crawl/costas) ou ciclo
 *   D2  PROESP-BR: tabela de referência carregada do manual (CSV), sem números embutidos
 */
import { angulo, pt, inclinacaoVertical } from '../livres-h/comum.js';
import { dtw, ciclos, ritmo, mediana, media } from './sinais.js';

const fin = Number.isFinite;
const graus = (r) => (r * 180) / Math.PI;

export const FONTES_ESP = {
  dtw: 'Sakoe H, Chiba S. Dynamic programming algorithm optimization for spoken word recognition. IEEE Trans ASSP. 1978;26(1):43-49.',
  proesp: 'Gaya A, Gaya AR et al. Projeto Esporte Brasil (PROESP-BR): manual de testes e avaliação. Porto Alegre: UFRGS; 2016.',
};

// ===================================================================== ângulos

/** As articulações comparadas (nome, pontos A-B-C com o vértice em B). */
export const ARTICS = [
  ['cotovelo esq.', 11, 13, 15], ['cotovelo dir.', 12, 14, 16],
  ['ombro esq.', 23, 11, 13], ['ombro dir.', 24, 12, 14],
  ['quadril esq.', 11, 23, 25], ['quadril dir.', 12, 24, 26],
  ['joelho esq.', 23, 25, 27], ['joelho dir.', 24, 26, 28],
];
export const NOMES_ANG = [...ARTICS.map((a) => a[0]), 'tronco'];
/** Pares esquerdo↔direito no vetor (para comparar com o lado trocado). */
const TROCA = [1, 0, 3, 2, 5, 4, 7, 6, 8];

/** Vetor de ângulos (graus; NaN onde falta ponto). O tronco é a inclinação quadril→ombros da vertical. */
export function vetorAngulos(P, minVis = 0.4) {
  const v = ARTICS.map(([, a, b, c]) => {
    const A = P[a], B = P[b], C = P[c];
    if (!A || !B || !C || A.v < minVis || B.v < minVis || C.v < minVis) return NaN;
    const r = angulo(A, B, C);
    return r == null ? NaN : r;
  });
  const om = meio2(P, 11, 12, minVis), qm = meio2(P, 23, 24, minVis);
  v.push(om && qm ? Math.abs(inclinacaoVertical(qm, om, 1)) : NaN);
  return v;
}
function meio2(P, a, b, minVis) {
  const A = P[a] && P[a].v >= minVis ? P[a] : null, B = P[b] && P[b].v >= minVis ? P[b] : null;
  return A && B ? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } : (A || B);
}
export const trocarLados = (v) => TROCA.map((i) => v[i]);

/** Esqueleto normalizado (centro no meio do quadril, escala = tronco) para desenhar lado a lado. */
export function poseNormalizada(P, minVis = 0.3) {
  const qm = meio2(P, 23, 24, minVis), om = meio2(P, 11, 12, minVis);
  if (!qm || !om) return null;
  const s = Math.hypot(om.x - qm.x, om.y - qm.y) || 1;
  return P.slice(0, 33).map((q) => (q && q.v >= minVis ? [+((q.x - qm.x) / s).toFixed(3), +((q.y - qm.y) / s).toFixed(3)] : null));
}

// ===================================================================== E3: referência

/** Reduz uma gravação (amostras { t, ang, pose }) a no máximo `max` amostras, uniformes no tempo. */
export function compactar(amostras, max = 240) {
  if (amostras.length <= max) return amostras.slice();
  const out = [], t0 = amostras[0].t, T = amostras[amostras.length - 1].t - t0;
  let j = 0;
  for (let k = 0; k < max; k++) {
    const t = t0 + (T * k) / (max - 1);
    while (j < amostras.length - 1 && amostras[j + 1].t <= t) j++;
    out.push(amostras[j]);
  }
  return out;
}

/**
 * Compara a tentativa com a referência. Fases = `nFases` partes iguais do
 * tempo da referência. Nota por fase = 100·exp(−erro médio/σ), σ = 20°.
 * Devolve { nota, fases: [{ n, nota, erro, pior: {nome, delta}, tempoRel }], caminho, custo, lado }.
 * `espelho`: compara também com os lados trocados e fica com o melhor.
 */
export function compararMovimento(ref, tent, { nFases = 4, sigma = 20, espelho = true } = {}) {
  if (!ref || !tent || ref.length < 4 || tent.length < 4) return null;
  const A = ref.map((a) => a.ang), B0 = tent.map((a) => a.ang);
  let best = null;
  for (const lado of espelho ? ['mesmo', 'trocado'] : ['mesmo']) {
    const B = lado === 'mesmo' ? B0 : B0.map(trocarLados);
    const r = dtw(A, B, { banda: 0.35 });
    if (!best || r.custo < best.custo) best = { ...r, B, lado };
  }
  const { caminho, B, lado } = best;
  const t0 = ref[0].t, T = ref[ref.length - 1].t - t0 || 1;
  const faseDe = (i) => Math.min(nFases - 1, Math.floor(((ref[i].t - t0) / T) * nFases));
  const fases = Array.from({ length: nFases }, (_, n) => ({ n: n + 1, soma: 0, k: 0, porArt: new Array(NOMES_ANG.length).fill(0), nArt: new Array(NOMES_ANG.length).fill(0), jMin: Infinity, jMax: -Infinity, iMin: Infinity, iMax: -Infinity }));
  for (const [i, j] of caminho) {
    const f = fases[faseDe(i)];
    let s = 0, k = 0;
    for (let d = 0; d < NOMES_ANG.length; d++) {
      const x = A[i][d], y = B[j][d];
      if (!fin(x) || !fin(y)) continue;
      const e = y - x;
      s += Math.abs(e); k++;
      f.porArt[d] += e; f.nArt[d]++;
    }
    if (k) { f.soma += s / k; f.k++; }
    f.jMin = Math.min(f.jMin, j); f.jMax = Math.max(f.jMax, j); f.iMin = Math.min(f.iMin, i); f.iMax = Math.max(f.iMax, i);
  }
  const out = fases.map((f) => {
    const erro = f.k ? f.soma / f.k : null;
    let pior = null;
    for (let d = 0; d < NOMES_ANG.length; d++) {
      if (!f.nArt[d]) continue;
      const m = f.porArt[d] / f.nArt[d];
      if (!pior || Math.abs(m) > Math.abs(pior.delta)) pior = { nome: NOMES_ANG[d], delta: m };
    }
    const dRef = fin(f.iMax) ? ref[f.iMax].t - ref[f.iMin].t : null, dTen = fin(f.jMax) ? tent[f.jMax].t - tent[f.jMin].t : null;
    return { n: f.n, erro, nota: erro == null ? null : 100 * Math.exp(-erro / sigma), pior, tempoRel: dRef > 0 && dTen != null ? dTen / dRef : null };
  });
  const notas = out.map((f) => f.nota).filter(fin);
  return { nota: notas.length ? media(notas) : null, fases: out, caminho, custo: best.custo, lado,
    duracaoRef: T / 1000, duracaoTent: (tent[tent.length - 1].t - tent[0].t) / 1000 };
}

/**
 * Gravação automática: começa quando a velocidade angular média passa de
 * `limiar` °/s e termina parada por `paradaMs`. passo(t, ang) → 'inicio' | 'fim' | null.
 */
export class GatilhoMovimento {
  constructor(limiar = 40, paradaMs = 900) { this.limiar = limiar; this.paradaMs = paradaMs; this.zerar(); }
  zerar() { this.ant = null; this.ativo = false; this.tParado = null; this.vel = 0; }
  passo(t, ang) {
    let ev = null;
    if (this.ant) {
      const dt = (t - this.ant.t) / 1000;
      let s = 0, k = 0;
      for (let d = 0; d < ang.length; d++) if (fin(ang[d]) && fin(this.ant.ang[d])) { s += Math.abs(ang[d] - this.ant.ang[d]); k++; }
      const v = k && dt > 0 ? s / k / dt : 0;
      this.vel = 0.6 * this.vel + 0.4 * v;
      if (!this.ativo && this.vel > this.limiar) { this.ativo = true; this.tParado = null; ev = 'inicio'; }
      else if (this.ativo) {
        if (this.vel < this.limiar / 3) { if (this.tParado == null) this.tParado = t; if (t - this.tParado >= this.paradaMs) { this.ativo = false; ev = 'fim'; } }
        else this.tParado = null;
      }
    }
    this.ant = { t, ang };
    return ev;
  }
}

// ===================================================================== 91: yoga

/**
 * Semelhança (0–100) entre o vetor de ângulos atual e o da pose de
 * referência (100·exp(−erro médio/σ), σ = 15°), com a maior diferença.
 */
export function semelhancaPose(ref, atual, { sigma = 15, espelho = true } = {}) {
  const calc = (B) => {
    let s = 0, k = 0, pior = null;
    for (let d = 0; d < ref.length; d++) {
      if (!fin(ref[d]) || !fin(B[d])) continue;
      const e = B[d] - ref[d];
      s += Math.abs(e); k++;
      if (!pior || Math.abs(e) > Math.abs(pior.delta)) pior = { nome: NOMES_ANG[d], delta: e };
    }
    return k >= 4 ? { erro: s / k, pior, nota: 100 * Math.exp(-(s / k) / sigma), k } : null;
  };
  const a = calc(atual), b = espelho ? calc(trocarLados(atual)) : null;
  if (!a && !b) return null;
  const r = !b || (a && a.erro <= b.erro) ? { ...a, lado: 'mesmo' } : { ...b, lado: 'trocado' };
  return r;
}

/** Tempo sustentado acima do limiar, tolerando quedas curtas (≤ toleranciaMs). */
export class Sustentacao {
  constructor() { this.zerar(); }
  zerar() { this.t0 = null; this.tUlt = null; this.tAbaixo = null; this.melhorMs = 0; this.atualMs = 0; this.series = []; }
  passo(t, nota, limiar = 80, toleranciaMs = 600) {
    let fechou = null;
    if (nota != null && nota >= limiar) {
      if (this.t0 == null) this.t0 = t;
      this.tAbaixo = null; this.tUlt = t;
      this.atualMs = t - this.t0;
      this.melhorMs = Math.max(this.melhorMs, this.atualMs);
    } else if (this.t0 != null) {
      if (this.tAbaixo == null) this.tAbaixo = t;
      if (t - this.tAbaixo > toleranciaMs) {
        const dur = this.tUlt - this.t0;
        if (dur >= 2000) { fechou = { t0: this.t0, durS: dur / 1000 }; this.series.push(fechou); }
        this.t0 = null; this.atualMs = 0; this.tAbaixo = null;
      }
    }
    return fechou;
  }
}

// ===================================================================== 88: golpes

/**
 * Golpes de punho: um golpe = o braço estende (punho a ≥ 85 % do comprimento
 * do braço a partir do ombro) com pico de velocidade do punho acima de
 * `vMin` comprimentos de braço por segundo. Velocidade em m/s com a escala
 * cm/px (estatura informada) quando há.
 */
export class DetectorGolpes {
  constructor(cfg = {}) { this.cfg = { extensao: 0.85, vMin: 3, ...cfg }; this.zerar(); }
  zerar() { this.lados = { e: this._novo(), d: this._novo() }; this.golpes = []; }
  _novo() { return { ant: null, armado: true, pico: null, braco: null }; }
  passo(t, P, minVis = 0.4, cmPorPx = null) {
    const evs = [];
    for (const l of ['e', 'd']) {
      const o = pt(P, 'ombro', l, minVis), c = pt(P, 'cotovelo', l, minVis), p = pt(P, 'punho', l, minVis);
      const S = this.lados[l];
      if (!o || !c || !p) { S.ant = null; continue; }
      const braco = Math.hypot(c.x - o.x, c.y - o.y) + Math.hypot(p.x - c.x, p.y - c.y);
      S.braco = S.braco ? 0.95 * S.braco + 0.05 * braco : braco;
      const ext = Math.hypot(p.x - o.x, p.y - o.y) / (S.braco || braco);
      let v = null;
      if (S.ant && t > S.ant.t) v = Math.hypot(p.x - S.ant.x, p.y - S.ant.y) / ((t - S.ant.t) / 1000);
      S.ant = { t, x: p.x, y: p.y };
      if (v != null && S.armado && ext >= this.cfg.extensao * 0.8 && (!S.pico || v > S.pico.v)) S.pico = { t, v, ext };
      if (S.armado && ext >= this.cfg.extensao && S.pico && S.pico.v / S.braco >= this.cfg.vMin) {
        const g = { t: S.pico.t, lado: l, vPx: S.pico.v, vBracos: S.pico.v / S.braco, vMs: cmPorPx ? (S.pico.v * cmPorPx) / 100 : null };
        this.golpes.push(g); evs.push(g);
        S.armado = false; S.pico = null;
      }
      if (!S.armado && ext < this.cfg.extensao - 0.2) { S.armado = true; S.pico = null; }
      if (S.armado && ext < this.cfg.extensao * 0.8) S.pico = null;
    }
    return evs;
  }
  resumo(t) {
    const g = this.golpes, por = (l) => g.filter((x) => x.lado === l);
    const vs = g.map((x) => x.vMs ?? null).filter(fin);
    const t0 = g.length ? g[0].t : null;
    return { total: g.length, e: por('e').length, d: por('d').length, vMaxMs: vs.length ? Math.max(...vs) : null, vMediaMs: vs.length ? media(vs) : null,
      vMaxBracos: g.length ? Math.max(...g.map((x) => x.vBracos)) : null, porMin: g.length >= 2 ? ((g.length - 1) * 60000) / Math.max(1, g[g.length - 1].t - t0) : null };
  }
}

// ===================================================================== 89: basquete

/**
 * Soltura do arremesso: o punho do braço de arremesso acima do nariz e o
 * cotovelo atingindo a extensão máxima (≥ 150°) depois de subir. Ângulo de
 * soltura pelo PUNHO = direção da velocidade do punho nos ~100 ms antes,
 * acima da horizontal (aproximação). Com a bola detectada, o ângulo vem da
 * parábola da bola (mais fiel).
 */
export class DetectorArremesso {
  constructor() { this.zerar(); }
  zerar() { this.hist = []; this.estado = 'pronto'; this.arremessos = []; this.tUlt = -Infinity; }
  passo(t, P, minVis = 0.4) {
    const nariz = pt(P, 'nariz', null, minVis);
    let lado = null, melhor = Infinity;
    for (const l of ['e', 'd']) { const p = pt(P, 'punho', l, minVis); if (p && p.y < melhor) { melhor = p.y; lado = l; } }
    if (!lado || !nariz) { this.hist = []; return null; }
    const o = pt(P, 'ombro', lado, minVis), c = pt(P, 'cotovelo', lado, minVis), p = pt(P, 'punho', lado, minVis);
    if (!o || !c || !p) return null;
    const cot = angulo(o, c, p);
    const pes = [pt(P, 'tornozelo', 'e', minVis), pt(P, 'tornozelo', 'd', minVis)].filter(Boolean);
    const pe = pes.length ? { x: pes.reduce((s, q) => s + q.x, 0) / pes.length, y: pes.reduce((s, q) => s + q.y, 0) / pes.length } : null;
    this.hist.push({ t, x: p.x, y: p.y, cot, acima: p.y < nariz.y, lado, pe });
    while (this.hist.length > 2 && this.hist[0].t < t - 1500) this.hist.shift();
    const h = this.hist, n = h.length;
    if (n < 4 || t - this.tUlt < 1200) return null;
    // pico de extensão do cotovelo no penúltimo quadro, com o punho acima da cabeça e subindo antes
    const a = h[n - 3], b = h[n - 2], cc = h[n - 1];
    if (b.acima && b.cot >= 150 && b.cot >= a.cot && b.cot >= cc.cot - 2) {
      const antes = h.filter((q) => q.t >= b.t - 140 && q.t <= b.t);
      if (antes.length >= 2) {
        const q0 = antes[0], dx = b.x - q0.x, dy = q0.y - b.y;
        if (dy > 0) {
          const ang = graus(Math.atan2(dy, Math.abs(dx) || 1e-9));
          const ar = { t: b.t, lado: b.lado, anguloPunho: ang, cotovelo: b.cot, pe: b.pe, x: b.x, y: b.y };
          this.tUlt = b.t;
          this.arremessos.push(ar);
          return ar;
        }
      }
    }
    return null;
  }
}

/** Ângulo de saída da bola: parábola y(t) e reta x(t) nas posições até ~350 ms após a soltura. */
export function anguloBola(pos) {
  if (pos.length < 3) return null;
  const t0 = pos[0].t, T = pos.map((q) => (q.t - t0) / 1000);
  const n = T.length;
  // x: reta; y: parábola (mínimos quadrados)
  let st = 0, stt = 0, sx = 0, stx = 0;
  for (let i = 0; i < n; i++) { st += T[i]; stt += T[i] * T[i]; sx += pos[i].x; stx += T[i] * pos[i].x; }
  const den = n * stt - st * st;
  if (!(Math.abs(den) > 1e-12)) return null;
  const vx = (n * stx - st * sx) / den;
  const S = [0, 0, 0, 0, 0], Y = [0, 0, 0];
  for (let i = 0; i < n; i++) { let p = 1; for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) Y[k] += p * pos[i].y; p *= T[i]; } }
  const M = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const sol = resolver3(M, Y);
  if (!sol) return null;
  const vy = sol[1];        // dy/dt em t0 (px/s, y para baixo)
  return graus(Math.atan2(-vy, Math.abs(vx) || 1e-9));
}
function resolver3(M, y) {
  const A = M.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c; for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

// ===================================================================== 90: natação

/**
 * Braçadas: ângulo do braço (ombro→punho) desenrolado; cada volta completa
 * (360°) de um braço = 1 braçada (crawl e costas). `ciclo`: peito e
 * borboleta (o braço não dá a volta) — ciclos do punho em relação ao ombro.
 */
export class ContadorBracadas {
  constructor() { this.zerar(); }
  zerar() { this.lados = { e: { ang: null, acum: 0, voltas: 0, ts: [] }, d: { ang: null, acum: 0, voltas: 0, ts: [] } }; this.serie = { ts: [], ys: [] }; }
  passo(t, P, minVis = 0.3) {
    const evs = [];
    for (const l of ['e', 'd']) {
      const o = pt(P, 'ombro', l, minVis), p = pt(P, 'punho', l, minVis), S = this.lados[l];
      if (!o || !p) continue;
      const a = Math.atan2(p.y - o.y, p.x - o.x);
      if (S.ang != null) {
        let d = a - S.ang;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < 2.2) S.acum += d;   // salto grande = pose trocou de lado: ignora
      }
      S.ang = a;
      const v = Math.floor(Math.abs(S.acum) / (2 * Math.PI));
      if (v > S.voltas) { S.voltas = v; S.ts.push(t); evs.push({ t, lado: l }); }
    }
    const o = pt(P, 'ombro', 'e', minVis) || pt(P, 'ombro', 'd', minVis), pe = pt(P, 'punho', 'e', minVis), pd = pt(P, 'punho', 'd', minVis);
    if (o && (pe || pd)) { this.serie.ts.push(t); this.serie.ys.push(((pe || pd).x - o.x)); if (this.serie.ts.length > 3000) { this.serie.ts.splice(0, 500); this.serie.ys.splice(0, 500); } }
    return evs;
  }
  resumo(estilo = 'rotacao') {
    if (estilo === 'ciclo') {
      const pk = ciclos(this.serie.ts, this.serie.ys, { minMs: 700 });
      const r = ritmo(pk.map((p) => p.t));
      return { bracadas: pk.length, porMin: r.porMin, cv: r.cv };
    }
    const todos = [...this.lados.e.ts, ...this.lados.d.ts].sort((a, b) => a - b);
    const re = ritmo(this.lados.e.ts), rd = ritmo(this.lados.d.ts);
    // ritmo de braçadas (ciclos de braço por minuto, os dois braços somados)
    const porMin = [re.porMin, rd.porMin].filter(fin);
    return { bracadas: todos.length, e: this.lados.e.ts.length, d: this.lados.d.ts.length, porMin: porMin.length ? porMin.reduce((s, x) => s + x, 0) : null,
      cvE: re.cv, cvD: rd.cv };
  }
}

// ===================================================================== 87: corda

/** Resumo dos saltos de corda a partir das tentativas do motor do Salto. */
export function resumoCorda(tentativas) {
  const ts = tentativas.map((t) => t.tDec).sort((a, b) => a - b);
  const r = ritmo(ts);
  const d = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  const md = mediana(d);
  const paradas = md ? d.filter((x) => x > 2.2 * md).length : 0;
  return {
    saltos: ts.length, porMin: r.porMin, regularidadeCV: r.cv, paradas,
    vooMs: mediana(tentativas.map((t) => t.tv)), contatoMs: mediana(tentativas.map((t) => t.tc).filter(fin)),
    alturaCm: mediana(tentativas.map((t) => t.hVoo)),
  };
}

// ===================================================================== D2: PROESP-BR

export const TESTES_PROESP = {
  horizontal: { nome: 'Salto horizontal', un: 'cm', maiorMelhor: true },
  corrida20: { nome: 'Corrida de 20 m', un: 's', maiorMelhor: false },
  quadrado: { nome: 'Teste do quadrado (4 m)', un: 's', maiorMelhor: false },
  abdominal: { nome: 'Abdominal em 1 min', un: 'repetições', maiorMelhor: true },
};

/**
 * Tabela de referência carregada pelo usuário (CSV do manual PROESP-BR, uma
 * linha por teste/sexo/idade): `teste;sexo;idade;fraco;razoavel;bom;muito_bom;excelente`
 * (limites inferiores de cada classe; "s" = menor é melhor fica pelo teste) ou
 * `teste;sexo;idade;zona_saudavel` (ponto de corte de saúde). Linhas com # são comentário.
 * Devolve { linhas, erros }.
 */
export function lerTabelaProesp(csv) {
  const linhas = [], erros = [];
  const L = String(csv || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!L.length) return { linhas, erros: ['arquivo vazio'] };
  const cab = L[0].toLowerCase().split(/[;,\t]/).map((s) => s.trim());
  const iT = cab.indexOf('teste'), iS = cab.indexOf('sexo'), iI = cab.indexOf('idade');
  if (iT < 0 || iS < 0 || iI < 0) return { linhas, erros: ['cabeçalho precisa de teste;sexo;idade;…'] };
  const classes = cab.filter((c, i) => i !== iT && i !== iS && i !== iI);
  for (let k = 1; k < L.length; k++) {
    const c = L[k].split(/[;\t]/).map((s) => s.trim());
    const teste = c[iT], sexo = (c[iS] || '').toUpperCase().slice(0, 1), idade = Number(c[iI]);
    if (!TESTES_PROESP[teste]) { erros.push(`linha ${k + 1}: teste "${teste}" (use ${Object.keys(TESTES_PROESP).join(', ')})`); continue; }
    if (!['M', 'F'].includes(sexo) || !fin(idade)) { erros.push(`linha ${k + 1}: sexo M/F e idade numérica`); continue; }
    const lim = {};
    cab.forEach((nome, i) => { if (i !== iT && i !== iS && i !== iI) { const v = Number(String(c[i] || '').replace(',', '.')); if (fin(v)) lim[nome] = v; } });
    linhas.push({ teste, sexo, idade, lim });
  }
  return { linhas, erros, classes };
}

/** Classifica um resultado pela tabela carregada (null se não houver linha). */
export function classificarProesp(tabela, teste, sexo, idade, valor) {
  if (!tabela || !tabela.linhas || !fin(valor)) return null;
  const l = tabela.linhas.find((x) => x.teste === teste && x.sexo === sexo && x.idade === Math.floor(idade));
  if (!l) return null;
  const mm = TESTES_PROESP[teste].maiorMelhor;
  const ents = Object.entries(l.lim);
  if (ents.length === 1) {
    const [nome, corte] = ents[0];
    const ok = mm ? valor >= corte : valor <= corte;
    return { classe: ok ? nome.replace(/_/g, ' ') : 'abaixo do ponto de corte', corte };
  }
  // classes ordenadas da pior à melhor; limite = começo da classe
  let classe = null;
  for (const [nome, lim] of ents) if (mm ? valor >= lim : valor <= lim) classe = nome.replace(/_/g, ' ');
  return { classe: classe || ents[0][0].replace(/_/g, ' '), limites: l.lim };
}
