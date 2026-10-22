/**
 * cv/runtime/livres-s/niosh.js — EQUAÇÃO REVISADA DO NIOSH para levantamento
 * de carga (Waters, Putz-Anderson, Garg & Fine, Ergonomics 36(7):749–776, 1993;
 * NIOSH Applications Manual for the Revised Lifting Equation, pub. 94-110).
 * Sem DOM e sem modelo (testável):
 *
 *   LPR (RWL) = LC · HM · VM · DM · AM · FM · CM          LC = 23 kg
 *     HM = 25 / H            H (cm) 25–63; < 25 → 1; > 63 → 0
 *     VM = 1 − 0,003·|V − 75| V (cm) 0–175; > 175 → 0
 *     DM = 0,82 + 4,5 / D    D (cm) 25–175; < 25 → 1; > 175 → 0
 *     AM = 1 − 0,0032·A      A (°) 0–135; > 135 → 0
 *     FM tabela 5 (frequência × duração × V < 75 cm), interpolada entre linhas
 *     CM tabela 7 (pega boa / razoável / ruim × V < 75 cm)
 *   IL (LI) = carga / LPR
 *
 * A câmera mede H e V (pose + escala); D sai do par origem → destino de cada
 * levantamento; A (assimetria), a pega, a duração e a carga são ENTRADAS
 * MANUAIS — a imagem 2D não as mede com confiança.
 */

export const LC = 23;

/** Tabela 5 do manual: [freq (lev./min), ≤1 h V<75, ≤1 h V≥75, ≤2 h V<75, ≤2 h V≥75, ≤8 h V<75, ≤8 h V≥75]. */
export const TABELA_FM = [
  [0.2, 1.00, 1.00, 0.95, 0.95, 0.85, 0.85],
  [0.5, 0.97, 0.97, 0.92, 0.92, 0.81, 0.81],
  [1, 0.94, 0.94, 0.88, 0.88, 0.75, 0.75],
  [2, 0.91, 0.91, 0.84, 0.84, 0.65, 0.65],
  [3, 0.88, 0.88, 0.79, 0.79, 0.55, 0.55],
  [4, 0.84, 0.84, 0.72, 0.72, 0.45, 0.45],
  [5, 0.80, 0.80, 0.60, 0.60, 0.35, 0.35],
  [6, 0.75, 0.75, 0.50, 0.50, 0.27, 0.27],
  [7, 0.70, 0.70, 0.42, 0.42, 0.22, 0.22],
  [8, 0.60, 0.60, 0.35, 0.35, 0.18, 0.18],
  [9, 0.52, 0.52, 0.30, 0.30, 0.00, 0.15],
  [10, 0.45, 0.45, 0.26, 0.26, 0.00, 0.13],
  [11, 0.41, 0.41, 0.00, 0.23, 0.00, 0.00],
  [12, 0.37, 0.37, 0.00, 0.21, 0.00, 0.00],
  [13, 0.00, 0.34, 0.00, 0.00, 0.00, 0.00],
  [14, 0.00, 0.31, 0.00, 0.00, 0.00, 0.00],
  [15, 0.00, 0.28, 0.00, 0.00, 0.00, 0.00],
];
export const DURACOES = ['até 1 h', '1 a 2 h', '2 a 8 h'];
export const PEGAS = ['boa', 'razoável', 'ruim'];

export const hm = (H) => (!(H >= 0) ? NaN : H <= 25 ? 1 : H > 63 ? 0 : 25 / H);
export const vm = (V) => (!Number.isFinite(V) ? NaN : V < 0 || V > 175 ? 0 : 1 - 0.003 * Math.abs(V - 75));
export const dm = (D) => (!(D >= 0) ? NaN : D <= 25 ? 1 : D > 175 ? 0 : 0.82 + 4.5 / D);
export const am = (A) => (!(A >= 0) ? NaN : A > 135 ? 0 : 1 - 0.0032 * A);

/** FM pela tabela 5; `duracao` 0 (≤1 h), 1 (≤2 h), 2 (≤8 h). Interpolação linear entre linhas. */
export function fm(F, duracao, V) {
  const col = 1 + 2 * Math.max(0, Math.min(2, duracao | 0)) + (V >= 75 ? 1 : 0);
  if (!(F >= 0)) return NaN;
  if (F <= 0.2) return TABELA_FM[0][col];
  if (F > 15) return 0;
  for (let i = 1; i < TABELA_FM.length; i++) {
    const a = TABELA_FM[i - 1], b = TABELA_FM[i];
    if (F <= b[0]) {
      const k = (F - a[0]) / (b[0] - a[0]);
      return Math.round((a[col] + (b[col] - a[col]) * k) * 1000) / 1000;
    }
  }
  return 0;
}

/** CM pela tabela 7; `pega` 0 boa, 1 razoável, 2 ruim. */
export function cm(pega, V) {
  if (pega === 0) return 1;
  if (pega === 1) return V < 75 ? 0.95 : 1;
  return 0.9;
}

/** LPR e IL de uma situação (origem OU destino). e = { H, V, D, A, F, duracao, pega, carga }. */
export function equacao(e) {
  const M = { HM: hm(e.H), VM: vm(e.V), DM: dm(e.D), AM: am(e.A || 0), FM: fm(e.F, e.duracao, e.V), CM: cm(e.pega, e.V) };
  const rwl = LC * M.HM * M.VM * M.DM * M.AM * M.FM * M.CM;
  const li = rwl > 0 ? e.carga / rwl : Infinity;
  return { ...M, RWL: rwl, LI: li };
}

/** Classe do IL (as faixas usuais da literatura). */
export function classeIL(li) {
  if (!Number.isFinite(li)) return { nivel: 3, nome: 'inviável (LPR = 0)', cor: '#ef4444' };
  if (li <= 1) return { nivel: 0, nome: 'aceitável (IL ≤ 1)', cor: '#4ade80' };
  if (li <= 2) return { nivel: 1, nome: 'risco aumentado (1 < IL ≤ 2)', cor: '#facc15' };
  if (li <= 3) return { nivel: 2, nome: 'risco alto (2 < IL ≤ 3)', cor: '#fb923c' };
  return { nivel: 3, nome: 'risco muito alto (IL > 3)', cor: '#ef4444' };
}

// ------------------------------------------------------------------ medidas pela pose

const NARIZ = 0, PUNHO_E = 9, PUNHO_D = 10, TORN_E = 15, TORN_D = 16;

/**
 * H e V (cm) de uma pose COCO-17 (pontos em px). `cmPorPx` vem da régua
 * calibrada ou da estatura. `tornozeloCm` = altura do maléolo acima do piso.
 * Devolve { H, V, maos: [x, y], pes: [x, y], piso } ou null sem os pontos.
 */
export function medirHV(kp, cmPorPx, { kpConf = 0.3, tornozeloCm = 8 } = {}) {
  const ok = (i) => kp[i] && kp[i].score >= kpConf;
  const med = (a, b) => (ok(a) && ok(b) ? [(kp[a].x + kp[b].x) / 2, (kp[a].y + kp[b].y) / 2] : ok(a) ? [kp[a].x, kp[a].y] : ok(b) ? [kp[b].x, kp[b].y] : null);
  const maos = med(PUNHO_E, PUNHO_D), pes = med(TORN_E, TORN_D);
  if (!maos || !pes || !(cmPorPx > 0)) return null;
  const piso = pes[1] + tornozeloCm / cmPorPx;
  return { H: Math.abs(maos[0] - pes[0]) * cmPorPx, V: (piso - maos[1]) * cmPorPx, maos, pes, piso };
}

/** Distância nariz → tornozelos (px), para a escala pela estatura (só em pé). */
export function alturaNarizTornozelo(kp, kpConf = 0.3) {
  const ok = (i) => kp[i] && kp[i].score >= kpConf;
  if (!ok(NARIZ) || !(ok(TORN_E) || ok(TORN_D))) return null;
  const yT = ok(TORN_E) && ok(TORN_D) ? (kp[TORN_E].y + kp[TORN_D].y) / 2 : ok(TORN_E) ? kp[TORN_E].y : kp[TORN_D].y;
  return yT - kp[NARIZ].y;
}
/** Nariz → maléolo ≈ 0,88 da estatura (tabelas antropométricas: nariz ≈ 0,92 E, maléolo ≈ 0,04 E). */
export const FRACAO_NARIZ_TORNOZELO = 0.88;

/**
 * Detector de levantamentos por ZIGUE-ZAGUE com histerese na altura das mãos:
 * um extremo (mínimo ou máximo de V) só se confirma quando V volta `amp` cm.
 * Cada par de extremos consecutivos com |ΔV| ≥ amp é um movimento: subida =
 * levantamento (origem no mínimo, destino no máximo); descida = abaixamento.
 */
/** Variação (cm) abaixo da qual as mãos contam como paradas no extremo. */
const TOL_PARADO = 2;

export class Levantamentos {
  constructor() { this.zerar(); }
  zerar() { this.dir = 0; this.mn = null; this.mx = null; this.ext = null; this.ultimoExt = null; this.movs = []; this.t0 = null; this.tUlt = null; }

  /**
   * amostra = { t (s), H, V }. Devolve o movimento fechado neste passo (ou null).
   * `estavelS`: o extremo também se confirma quando as mãos param nele por
   * esse tempo (a carga pousada no destino fecha o levantamento sem esperar
   * o próximo ciclo).
   */
  passo(a, amp = 30, estavelS = 1) {
    if (this.t0 == null) this.t0 = a.t;
    this.tUlt = a.t;
    this.amp = amp;
    if (this.dir === 0) {
      if (!this.mn || a.V < this.mn.V) this.mn = { ...a };
      if (!this.mx || a.V > this.mx.V) this.mx = { ...a };
      if (a.V >= this.mn.V + amp) { this._confirmar(this.mn, -1); this.dir = 1; this.ext = { ...a }; }
      else if (a.V <= this.mx.V - amp) { this._confirmar(this.mx, 1); this.dir = -1; this.ext = { ...a }; }
      return null;
    }
    let fechado = null;
    if (this.dir === 1) {
      if (a.V >= this.ext.V) this.ext = a.V - this.ext.V > TOL_PARADO ? { ...a } : { ...a, t: this.ext.t };   // subindo: novo máximo (parado = mesmo instante)
      else if (a.V <= this.ext.V - amp || (a.t - this.ext.t >= estavelS && this._longe(this.ext))) {
        fechado = this._confirmar(this.ext, 1); this.dir = -1; this.ext = { ...a };   // máximo confirmado
      }
    } else {
      if (a.V <= this.ext.V) this.ext = this.ext.V - a.V > TOL_PARADO ? { ...a } : { ...a, t: this.ext.t };   // descendo: novo mínimo
      else if (a.V >= this.ext.V + amp || (a.t - this.ext.t >= estavelS && this._longe(this.ext))) {
        fechado = this._confirmar(this.ext, -1); this.dir = 1; this.ext = { ...a };   // mínimo confirmado
      }
    }
    return fechado;
  }

  /** O extremo em curso já está a ≥ amp do último confirmado? */
  _longe(e) { return this.ultimoExt != null && Math.abs(e.V - this.ultimoExt.V) >= this.amp; }

  _confirmar(e, tipo) {
    const ant = this.ultimoExt;
    this.ultimoExt = { ...e, tipo };
    if (!ant || ant.tipo === tipo || Math.abs(e.V - ant.V) < this.amp) return null;
    const m = { tipo: tipo === 1 ? 'levantamento' : 'abaixamento', origem: ant, destino: e, D: Math.abs(e.V - ant.V), t: e.t };
    this.movs.push(m);
    if (this.movs.length > 2000) this.movs.shift();
    return m;
  }

  /** Frequência (por minuto) dos movimentos do `tipo` no tempo observado. */
  frequencia(tipo = 'levantamento') {
    const dur = this.tUlt != null && this.t0 != null ? this.tUlt - this.t0 : 0;
    if (dur < 10) return null;
    return (this.movs.filter((m) => tipo === 'ambos' || m.tipo === tipo).length / dur) * 60;
  }
}

/**
 * Avalia um movimento com as entradas manuais. Calcula na ORIGEM e no
 * DESTINO (o manual pede o destino quando há controle da carga lá); o IL
 * da tarefa é o maior dos dois.
 */
export function avaliarMovimento(m, ent) {
  const base = { D: m.D, A: ent.A, F: ent.F, duracao: ent.duracao, pega: ent.pega, carga: ent.carga };
  const o = equacao({ ...base, H: m.origem.H, V: m.origem.V });
  const d = equacao({ ...base, H: m.destino.H, V: m.destino.V });
  const li = Math.max(o.LI, d.LI);
  return { origem: o, destino: d, LI: li, RWL: Math.min(o.RWL, d.RWL), classe: classeIL(li) };
}
