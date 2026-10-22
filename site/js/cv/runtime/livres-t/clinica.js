/**
 * cv/runtime/livres-t/clinica.js — a matemática da parte clínica da onda 2-c,
 * sem DOM e sem modelo (testável no node):
 *
 *   H4  rosto: assimetria de olho, sobrancelha e comissura em expressões guiadas
 *   85  orofacial: abertura, sorriso, bico, lateralização — repetições e amplitude
 *   83  tremor de mão: frequência (FFT 3–12 Hz) e amplitude (pico a pico)
 *   84  postura estática: ombros, pelve, cabeça, desvio lateral do tronco, linha de prumo
 *   86  marcha clínica: velocidade no piso calibrado (duas linhas), cadência, passada, apoio
 *   H5  higiene das mãos: os 6 movimentos da OMS por geometria das duas mãos (INDICATIVO)
 *
 * NADA AQUI É DIAGNÓSTICO: são medidas para apoio ao profissional.
 * Coordenadas em px do quadro, y para baixo; tempos em ms.
 */
import { ear, EAR_DIR, EAR_ESQ } from '../livres-d/facemesh.js';
import { angulo, pt, mediana as medianaH } from '../livres-h/comum.js';
import { reamostrar, passaAlta, eixoPrincipal, picoEspectral, rms, ciclos, ritmo, taxaHz, mediana, media } from './sinais.js';

const fin = Number.isFinite;
const graus = (r) => (r * 180) / Math.PI;

export const AVISO_SAUDE = 'Não é dispositivo médico: medida de apoio ao profissional habilitado, sem diagnóstico. Pose e malha 2D sem marcador têm erro; confira a filmagem.';

/** Fontes citadas nas telas e relatórios (só o que foi conferido). */
export const FONTES = {
  pos: 'Wang W, den Brinker AC, Stuijk S, de Haan G. Algorithmic principles of remote PPG. IEEE Trans Biomed Eng. 2017;64(7):1479-1491.',
  chrom: 'de Haan G, Jeanne V. Robust pulse rate from chrominance-based rPPG. IEEE Trans Biomed Eng. 2013;60(10):2878-2886.',
  houseBrackmann: 'House JW, Brackmann DE. Facial nerve grading system. Otolaryngol Head Neck Surg. 1985;93(2):146-147 (a gradação clínica continua sendo do profissional).',
  assimetria: 'Índices de assimetria por pares de pontos da malha: arXiv 2103.11059; MediaPipe Face Mesh em paralisia de Bell: MATRIX (2026), ojs2.pnb.ac.id/index.php/MATRIX/article/view/3069.',
  sapo: 'Ferreira EA, Duarte M, Maldonado EP, Burke TN, Marques AP. Postural assessment software (PAS/SAPO): validation and reliability. Clinics. 2010;65(7):675-681.',
  marcha: 'Bohannon RW, Williams Andrews A. Normal walking speed: a descriptive meta-analysis. Physiotherapy. 2011;97(3):182-189.',
  apoio: 'Perry J, Burnfield JM. Gait Analysis: Normal and Pathological Function. 2ª ed. SLACK; 2010 (apoio ≈ 60 % e balanço ≈ 40 % do ciclo na marcha normal).',
  oms: 'OMS. WHO Guidelines on Hand Hygiene in Health Care. Genebra: WHO; 2009 (fricção antisséptica 20–30 s; lavagem com água e sabão 40–60 s).',
};

// ===================================================================== rosto (H4, 85)

/** Referencial do rosto: origem no meio dos olhos, u = olho dir.→olho esq. da pessoa, v = para baixo; unidade = distância entre os olhos. */
export function referencialRosto(pts, W = 1, H = 1) {
  const P = (i) => ({ x: pts[i].x * W, y: pts[i].y * H });
  const c = (a, b) => { const A = P(a), B = P(b); return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }; };
  const oD = c(33, 133), oE = c(362, 263);
  const D = Math.hypot(oE.x - oD.x, oE.y - oD.y);
  if (!(D > 1e-6)) return null;
  const ux = (oE.x - oD.x) / D, uy = (oE.y - oD.y) / D;
  const O = { x: (oD.x + oE.x) / 2, y: (oD.y + oE.y) / 2 };
  const em = (i) => { const q = P(i); const dx = q.x - O.x, dy = q.y - O.y; return { u: (dx * ux + dy * uy) / D, v: (-dx * uy + dy * ux) / D }; };
  return { em, D, O, ux, uy, roll: graus(Math.atan2(uy, ux)), P };
}

/**
 * Medidas por lado (d = direito da PESSOA, e = esquerdo), em unidades de
 * distância entre os olhos: abertura do olho (EAR), altura da sobrancelha
 * acima do olho, elevação e afastamento da comissura labial; e as da boca.
 */
export function medidasRosto(pts, W = 1, H = 1) {
  const R = referencialRosto(pts, W, H);
  if (!R) return null;
  const P = pts.map((q) => ({ x: q.x * W, y: q.y * H }));
  const centroOlho = (a, b) => { const A = R.em(a), B = R.em(b); return { u: (A.u + B.u) / 2, v: (A.v + B.v) / 2 }; };
  const oD = centroOlho(33, 133), oE = centroOlho(362, 263);
  const sD = R.em(105), sE = R.em(334);
  const lsup = R.em(13), linf = R.em(14), cD = R.em(61), cE = R.em(291);
  const bocaV = (lsup.v + linf.v) / 2;
  const meioU = (R.em(1).u + R.em(168).u + R.em(152).u) / 3;   // linha média: nariz, entre os olhos, queixo
  return {
    roll: R.roll, D: R.D,
    olho: { d: ear(P, EAR_DIR), e: ear(P, EAR_ESQ) },
    sobrancelha: { d: oD.v - sD.v, e: oE.v - sE.v },
    comissuraElev: { d: bocaV - cD.v, e: bocaV - cE.v },
    comissuraLat: { d: meioU - cD.u, e: cE.u - meioU },
    abertura: linf.v - lsup.v,
    largura: cE.u - cD.u,
    lateral: (cD.u + cE.u) / 2 - meioU,      // + = boca desviada para a esquerda da pessoa
    bochechas: Math.abs(R.em(454).u - R.em(234).u),
  };
}

export const EXPRESSOES = {
  repouso: { nome: 'repouso (rosto relaxado)', medida: null },
  olhos: { nome: 'fechar os olhos com força', medida: 'olho', sinal: -1 },
  sobrancelhas: { nome: 'elevar as sobrancelhas (testa)', medida: 'sobrancelha', sinal: 1 },
  sorriso: { nome: 'sorrir mostrando os dentes', medida: 'comissuraLat', sinal: 1, extra: 'comissuraElev' },
  bico: { nome: 'fazer bico (assobio)', medida: 'comissuraLat', sinal: -1 },
};

/** Índice de assimetria (%) entre dois valores de mesma natureza: |d − e| / média(|d|, |e|). */
export function indiceAssim(d, e) {
  if (!fin(d) || !fin(e)) return null;
  const m = (Math.abs(d) + Math.abs(e)) / 2;
  return m > 1e-9 ? (100 * Math.abs(d - e)) / m : 0;
}

/**
 * Assimetria de uma expressão em relação ao repouso: excursão de cada lado
 * (Δ = expressão − repouso, no sentido do movimento) e o índice entre elas.
 * O lado com menos excursão é o que "mexe menos" (sem dizer por quê).
 */
export function assimetriaExpressao(base, pico, chave) {
  const ex = EXPRESSOES[chave];
  if (!ex || !ex.medida || !base || !pico) return null;
  const k = ex.medida, s = ex.sinal;
  const dd = s * (pico[k].d - base[k].d), de = s * (pico[k].e - base[k].e);
  const r = { chave, nome: ex.nome, excursao: { d: dd, e: de }, indice: indiceAssim(dd, de), menor: Math.abs(dd) < Math.abs(de) ? 'direito' : 'esquerdo' };
  if (ex.extra) {
    const k2 = ex.extra;
    r.excursao2 = { d: pico[k2].d - base[k2].d, e: pico[k2].e - base[k2].e };
    r.indice2 = indiceAssim(r.excursao2.d, r.excursao2.e);
  }
  return r;
}

/** Assimetria em repouso (estática): olho, sobrancelha e comissura. */
export function assimetriaRepouso(m) {
  if (!m) return null;
  return {
    olho: indiceAssim(m.olho.d, m.olho.e),
    sobrancelha: indiceAssim(m.sobrancelha.d, m.sobrancelha.e),
    comissura: fin(m.comissuraElev.d) ? 100 * Math.abs(m.comissuraElev.d - m.comissuraElev.e) : null,   // % da distância entre os olhos
    roll: m.roll,
  };
}

/** Exercícios orofaciais: a medida (em distâncias entre os olhos) e o sentido do esforço. */
export const OROFACIAL = {
  abrir: { nome: 'abrir bem a boca', medida: (m) => m.abertura, sinal: 1 },
  sorriso: { nome: 'sorriso largo (lábios fechados)', medida: (m) => m.largura, sinal: 1 },
  bico: { nome: 'bico (protrusão dos lábios)', medida: (m) => m.largura, sinal: -1 },
  lateral: { nome: 'boca para os lados (alternar)', medida: (m) => m.lateral, sinal: 0 },
  bochechas: { nome: 'inflar as bochechas', medida: (m) => m.bochechas, sinal: 1 },
};

/**
 * Série de um exercício orofacial → repetições (ciclos com histerese sobre a
 * excursão em relação ao repouso), amplitude por repetição e tempo sustentado
 * (acima de 70 % do máximo). `lateral` conta para cada lado.
 */
export function analisarOrofacial(ts, vals, chave, base = null) {
  const ex = OROFACIAL[chave];
  if (!ex || ts.length < 5) return { reps: 0, amplitudes: [], max: null };
  const b = fin(base) ? base : mediana(vals.slice(0, Math.min(vals.length, 15)));
  if (chave === 'lateral') {
    const exc = vals.map((v) => (fin(v) ? v - b : NaN));
    const pe = ciclos(ts, exc, { minMs: 400 }), pd = ciclos(ts, exc.map((v) => -v), { minMs: 400 });
    const ampE = pe.map((p) => p.y), ampD = pd.map((p) => p.y);
    return { reps: Math.min(pe.length, pd.length), repsE: pe.length, repsD: pd.length, amplitudes: [...ampE, ...ampD], ampE: media(ampE), ampD: media(ampD),
      max: Math.max(0, ...ampE, ...ampD), simetria: ampE.length && ampD.length ? 100 - indiceAssim(media(ampE), media(ampD)) : null };
  }
  const exc = vals.map((v) => (fin(v) ? ex.sinal * (v - b) : NaN));
  const picos = ciclos(ts, exc, { minMs: 500 });
  const max = Math.max(0, ...exc.filter(fin));
  let sust = 0, atual = 0;
  for (let i = 1; i < ts.length; i++) {
    if (fin(exc[i]) && exc[i] >= 0.7 * max && max > 0) { atual += ts[i] - ts[i - 1]; sust = Math.max(sust, atual); } else atual = 0;
  }
  return { reps: picos.length, amplitudes: picos.map((p) => p.y), max, ampMedia: media(picos.map((p) => p.y)), sustentadoMs: sust, base: b };
}

// ===================================================================== tremor (83)

/**
 * Tremor de um ponto da mão: ts (ms), xs, ys (px), comprimento da mão (px,
 * punho → ponta do dedo médio) e o comprimento real (cm, informado).
 * Tira o movimento voluntário (passa-alta ~2 Hz), projeta no eixo principal,
 * pico em 3–12 Hz (limitado pela taxa), amplitude pico a pico = 2√2·RMS.
 */
export function analisarTremor(ts, xs, ys, maoPx, maoCm = 18) {
  const fsReal = taxaHz(ts);
  if (!fsReal || ts.length < 30) return { hz: null, avisos: ['juntando amostras (mão parada na frente da câmera)'] };
  const fs = Math.min(60, fsReal);
  const X = reamostrar(ts, xs, fs).ys, Y = reamostrar(ts, ys, fs).ys;
  const k = Math.max(3, Math.round(fs / 2));          // média móvel de 0,5 s → corta abaixo de ~2 Hz
  const hx = passaAlta(X, k), hy = passaAlta(Y, k);
  const { s, ang } = eixoPrincipal(Array.from(hx), Array.from(hy));
  const fMax = Math.min(12, fs / 2 - 0.2);
  const avisos = [];
  if (fMax < 12) avisos.push(`taxa de ${fsReal.toFixed(0)} amostras/s: só mede tremor até ${fMax.toFixed(1)} Hz (use câmera de 30–60 fps e "Intervalo mín." 0)`);
  if (fMax <= 3.2) return { hz: null, avisos };
  const pk = picoEspectral(s, fs, 3, fMax, { harmonico: false });
  const ppPx = 2 * Math.SQRT2 * rms(s);
  const cmPorPx = maoPx > 10 ? maoCm / maoPx : null;
  if (!pk) return { hz: null, ppPx, avisos: [...avisos, 'sem oscilação'] };
  if (pk.confianca < 0.4) avisos.push('oscilação fraca ou irregular: frequência incerta');
  return {
    hz: pk.f, faixaHz: [pk.f - pk.meiaLarguraHz, pk.f + pk.meiaLarguraHz], confianca: pk.confianca, snr: pk.snr,
    ppPx, ppCm: cmPorPx ? ppPx * cmPorPx : null, ppPctMao: maoPx > 0 ? (100 * ppPx) / maoPx : null,
    eixoGraus: graus(ang), fs: fsReal, duracaoS: (ts[ts.length - 1] - ts[0]) / 1000, espectro: pk.espectro, avisos,
    serie: Array.from(s.slice(-Math.round(fs * 4))),
  };
}

// ===================================================================== postura (84)

/**
 * Postura estática pela pose BlazePose (33 pontos, px). vista 'frontal'
 * (de frente ou de costas) ou 'lateral'. Ângulos em graus; desvios em % da
 * largura dos ombros (frontal) ou da altura ombro–tornozelo (lateral).
 */
export function medirPostura(P, vista = 'frontal', minVis = 0.4) {
  const g = (parte, l) => pt(P, parte, l, minVis);
  const inclin = (A, B) => (A && B ? graus(Math.atan2(B.y - A.y, Math.abs(B.x - A.x) || 1e-9)) * (B.x >= A.x ? 1 : -1) : null);
  const out = { vista };
  if (vista === 'frontal') {
    const oe = g('ombro', 'e'), od = g('ombro', 'd'), qe = g('quadril', 'e'), qd = g('quadril', 'd');
    const ye = g('olho', 'e'), yd = g('olho', 'd'), te = g('tornozelo', 'e'), td = g('tornozelo', 'd');
    // inclinação = quanto o lado ESQUERDO da pessoa está mais baixo (graus, + = esquerdo mais baixo)
    const lado = (E, D) => (E && D ? graus(Math.atan2(E.y - D.y, Math.abs(E.x - D.x) || 1e-9)) : null);
    out.ombros = lado(oe, od);
    out.pelve = lado(qe, qd);
    out.cabeca = lado(ye, yd);
    if (oe && od && qe && qd) {
      const mo = { x: (oe.x + od.x) / 2, y: (oe.y + od.y) / 2 }, mq = { x: (qe.x + qd.x) / 2, y: (qe.y + qd.y) / 2 };
      const lo = Math.hypot(oe.x - od.x, oe.y - od.y);
      // desvio lateral do tronco: meio dos ombros em relação ao meio da pelve, sentido da pessoa (+ = para a esquerda dela)
      const sx = Math.sign(oe.x - od.x) || 1;
      out.troncoDesvioPct = lo > 0 ? (100 * (mo.x - mq.x) * sx) / lo : null;
      out.troncoInclin = graus(Math.atan2((mo.x - mq.x) * sx, mq.y - mo.y));
      // diferença entre a inclinação dos ombros e a da pelve: compensação (indicador de escoliose APARENTE)
      out.ombrosMenosPelve = out.ombros != null && out.pelve != null ? out.ombros - out.pelve : null;
      if (te && td) {
        const mt = { x: (te.x + td.x) / 2, y: (te.y + td.y) / 2 };
        out.prumoPct = lo > 0 ? (100 * (mo.x - mt.x) * sx) / lo : null;   // meio dos ombros × meio dos tornozelos
        out.linhas = { mo, mq, mt };
      } else out.linhas = { mo, mq };
    }
  } else {
    // lateral: o lado mais visível (perto da câmera)
    const vis = (l) => ['orelha', 'ombro', 'quadril', 'joelho', 'tornozelo'].reduce((s, k) => s + ((P[LMi(k, l)] || {}).v || 0), 0);
    const l = vis('e') >= vis('d') ? 'e' : 'd';
    const or = g('orelha', l), om = g('ombro', l), qu = g('quadril', l), jo = g('joelho', l), to = g('tornozelo', l), na = pt(P, 'nariz', null, minVis);
    const frente = na && or ? Math.sign(na.x - or.x) || 1 : 1;
    const vert = (A, B) => (A && B ? graus(Math.atan2((B.x - A.x) * frente, A.y - B.y)) : null);   // + = B à frente de A
    out.lado = l;
    out.cabecaAnterior = vert(om, or);          // orelha à frente do ombro (graus da vertical)
    out.tronco = vert(qu, om);
    out.quadrilJoelho = vert(jo, qu);
    out.joelho = jo && qu && to ? 180 - angulo(qu, jo, to) : null;   // 0 = estendido; + flexionado (sem distinguir hiperextensão)
    if (to && om) {
      const alt = Math.abs(to.y - (or ? or.y : om.y)) || 1;
      out.prumo = {};
      for (const [k, A] of [['orelha', or], ['ombro', om], ['quadril', qu], ['joelho', jo]]) out.prumo[k] = A ? (100 * (A.x - to.x) * frente) / alt : null;
      out.linhas = { to, or, om, qu, jo };
    }
  }
  return out;
}
const LMi = (k, l) => ({ orelha: { e: 7, d: 8 }, ombro: { e: 11, d: 12 }, quadril: { e: 23, d: 24 }, joelho: { e: 25, d: 26 }, tornozelo: { e: 27, d: 28 } })[k][l];

/** Mediana de cada campo numérico de várias medidas (captura estável de ~2 s). */
export function medianaPostura(lista) {
  if (!lista.length) return null;
  const out = { vista: lista[0].vista, lado: lista[lista.length - 1].lado, linhas: lista[lista.length - 1].linhas };
  const chaves = new Set();
  for (const m of lista) for (const [k, v] of Object.entries(m)) if (fin(v)) chaves.add(k);
  for (const k of chaves) out[k] = mediana(lista.map((m) => m[k]));
  const pr = lista.filter((m) => m.prumo);
  if (pr.length) { out.prumo = {}; for (const k of Object.keys(pr[0].prumo)) out.prumo[k] = mediana(pr.map((m) => m.prumo[k])); }
  return out;
}

// ===================================================================== marcha clínica (86)

/**
 * Marcha pela vista lateral. amostras: [{ t, pel: {x,y}, pes: { e: {ax,y}, d } , perna }]
 * (extrairCorrida do motor da Corrida dá esses campos). Apoio de cada pé =
 * pé quase parado na horizontal (< 25 % da velocidade do quadril) — vale
 * com duplo apoio, onde o "pé mais baixo" da Corrida não separa os passos.
 * cfg: { mPorPx (do piso calibrado ou da estatura) }.
 */
export function analisarMarcha(amostras, cfg = {}) {
  const out = { contatos: [], cadencia: null, apoioPct: {}, passadaM: null, velocidade: null, avisos: [] };
  const a = amostras.filter((x) => x.pel);
  if (a.length < 15) return out;
  const ts = a.map((x) => x.t);
  const fs = taxaHz(ts) || 15;
  if (fs < 8) out.avisos.push(`taxa de ${fs.toFixed(0)} amostras/s: contatos imprecisos (ideal ≥ 15)`);
  // velocidade do quadril (px/s), robusta
  const vx = [];
  for (let i = 1; i < a.length; i++) vx.push((a[i].pel.x - a[i - 1].pel.x) / ((ts[i] - ts[i - 1]) / 1000));
  const vq = Math.abs(mediana(vx) || 0);
  if (vq < 5) { out.avisos.push('a pessoa não está andando de lado para a câmera'); return out; }
  const dir = Math.sign(mediana(vx)) || 1;
  out.vQuadrilPx = vq;
  for (const l of ['e', 'd']) {
    const x = a.map((s) => (s.pes[l] ? s.pes[l].ax : NaN));
    const st = [];
    for (let i = 0; i < a.length; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(a.length - 1, i + 1);
      const v = fin(x[i0]) && fin(x[i1]) && ts[i1] > ts[i0] ? ((x[i1] - x[i0]) * dir) / ((ts[i1] - ts[i0]) / 1000) : NaN;
      st.push(fin(v) ? v < 0.25 * vq : null);
    }
    // apoio = trechos contínuos ≥ 120 ms; contato inicial = começo do trecho
    const trechos = [];
    let ini = null;
    for (let i = 0; i <= st.length; i++) {
      const on = i < st.length && st[i] === true;
      if (on && ini == null) ini = i;
      if (!on && ini != null) { if (ts[i - 1] - ts[ini] >= 120) trechos.push({ l, t0: ts[ini], t1: ts[i - 1], ini, fim: i - 1 }); ini = null; }
    }
    // ciclos completos: contato → próximo contato do mesmo pé
    const pct = [];
    for (let k = 0; k + 1 < trechos.length; k++) {
      const ciclo = trechos[k + 1].t0 - trechos[k].t0;
      if (ciclo > 400 && ciclo < 3000) pct.push((100 * (trechos[k].t1 - trechos[k].t0 + 1000 / fs)) / ciclo);
    }
    out.apoioPct[l] = pct.length ? mediana(pct) : null;
    out.contatos.push(...trechos);
  }
  out.contatos.sort((p, q) => p.t0 - q.t0);
  // cadência: contatos alternados (pés diferentes) consecutivos
  const dts = [];
  for (let k = 1; k < out.contatos.length; k++) {
    const p = out.contatos[k - 1], q = out.contatos[k];
    if (p.l !== q.l && q.t0 - p.t0 > 200 && q.t0 - p.t0 < 1500) dts.push(q.t0 - p.t0);
  }
  if (dts.length >= 2) {
    out.tPassoMs = mediana(dts);
    out.cadencia = 60000 / out.tPassoMs;
  }
  if (cfg.mPorPx) {
    out.velocidade = vq * cfg.mPorPx;
    if (out.tPassoMs) out.passadaM = out.velocidade * (2 * out.tPassoMs) / 1000;
  }
  const ap = [out.apoioPct.e, out.apoioPct.d].filter(fin);
  out.apoioMedio = ap.length ? media(ap) : null;
  return out;
}

/**
 * Tempo para cruzar o percurso entre duas linhas verticais do piso (px no
 * quadro) pela pelve: { t0, t1, tempoS, velocidade (m/s) } quando cruzou as
 * duas. linhas = [xA, xB]; distanciaM entre elas.
 */
export class Cronometro2Linhas {
  constructor() { this.zerar(); }
  zerar() { this.prev = null; this.tA = null; this.ladoA = null; this.res = null; this.ultimas = []; }
  passo(t, x, xA, xB, distanciaM) {
    let r = null;
    if (this.prev) {
      const [tp, xp] = this.prev;
      const cruzou = (xl) => (xp - xl) * (x - xl) < 0 || (x === xl && xp !== xl);
      const tC = (xl) => tp + ((t - tp) * (xl - xp)) / ((x - xp) || 1e-9);
      for (const [nome, xl] of [['A', xA], ['B', xB]]) {
        if (!cruzou(xl)) continue;
        const tc = tC(xl);
        if (this.tA == null) { this.tA = tc; this.ladoA = nome; }
        else if (nome !== this.ladoA) {
          const tempoS = (tc - this.tA) / 1000;
          if (tempoS > 0.3) { r = { t0: this.tA, t1: tc, tempoS, velocidade: distanciaM / tempoS, sentido: `${this.ladoA}→${nome}` }; this.res = r; this.ultimas.push(r); }
          this.tA = null; this.ladoA = null;
        } else { this.tA = tc; }
      }
    }
    this.prev = [t, x];
    return r;
  }
}

// ===================================================================== higiene das mãos (H5)

/** Os 6 movimentos de fricção (OMS 2009, "Como fazer a fricção antisséptica das mãos"), passos 2 a 7 do cartaz. */
export const PASSOS_OMS = [
  { id: 1, nome: 'palma com palma' },
  { id: 2, nome: 'palma sobre o dorso, dedos entrelaçados' },
  { id: 3, nome: 'palma com palma, dedos entrelaçados' },
  { id: 4, nome: 'dorso dos dedos na palma oposta (dedos travados)' },
  { id: 5, nome: 'polegar girando dentro da outra mão' },
  { id: 6, nome: 'pontas dos dedos girando na palma oposta' },
];

const PALMA = [0, 5, 9, 13, 17];
const PONTAS = [8, 12, 16, 20];
const centro = (pts, idx) => ({ x: idx.reduce((s, i) => s + pts[i].x, 0) / idx.length, y: idx.reduce((s, i) => s + pts[i].y, 0) / idx.length });
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const dirDedos = (p) => { const dx = p[9].x - p[0].x, dy = p[9].y - p[0].y, n = Math.hypot(dx, dy) || 1; return { x: dx / n, y: dy / n }; };
/** Dedos dobrados: ponta mais perto do punho que a articulação MCP. */
const dobrados = (p) => PONTAS.filter((i) => d2(p[i], p[0]) < d2(p[i - 3], p[0]) * 1.05).length;
const caixa = (p) => { const xs = p.map((q) => q.x), ys = p.map((q) => q.y); return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }; };
const dentroCx = (q, c, m = 0) => q.x >= c.x1 - m && q.x <= c.x2 + m && q.y >= c.y1 - m && q.y <= c.y2 + m;

/**
 * Classifica UM quadro com as duas mãos (21 pontos cada, px). INDICATIVO:
 * com uma câmera 2D as mãos se escondem uma atrás da outra; o resultado é
 * o movimento mais compatível com a geometria, ou null.
 * Devolve { passo, juntas, conf, feat }.
 */
export function classificarMaos(A, B) {
  if (!A || !B) return { passo: null, juntas: false };
  const tam = (d2(A[0], A[9]) + d2(B[0], B[9])) / 2 || 1;
  const cA = centro(A, PALMA), cB = centro(B, PALMA);
  const dist = d2(cA, cB) / tam;
  const juntas = dist < 1.3;
  if (!juntas) return { passo: null, juntas: false, feat: { dist } };
  const uA = dirDedos(A), uB = dirDedos(B);
  const cos = uA.x * uB.x + uA.y * uB.y;
  const angDedos = graus(Math.acos(Math.max(-1, Math.min(1, cos))));
  // entrelaçamento: as pontas de uma mão caem ENTRE as pontas da outra (meio espaçamento de dedo de
  // distância lateral), e não sobre elas (palma com palma, dedos coincidindo)
  const entreDedos = (P, Q, u) => {
    const lat = (q) => -q.x * u.y + q.y * u.x;
    const lq = PONTAS.map((i) => lat(Q[i])).sort((a, b) => a - b);
    const esp = (lq[3] - lq[0]) / 3;
    if (!(esp > 1e-6)) return 0;
    let n = 0;
    for (const i of PONTAS) {
      const x = lat(P[i]);
      if (x < lq[0] - 0.7 * esp || x > lq[3] + 0.7 * esp) continue;
      const dmin = Math.min(...lq.map((y) => Math.abs(x - y))) / esp;
      if (dmin > 0.25 && dmin < 0.75) n++;
    }
    return n / 4;
  };
  const cxA = caixa(A), cxB = caixa(B);
  const sobrepostas = PONTAS.some((i) => dentroCx(A[i], cxB, 0.05 * tam)) || PONTAS.some((i) => dentroCx(B[i], cxA, 0.05 * tam));
  const entre = sobrepostas ? (entreDedos(A, B, uB) + entreDedos(B, A, uA)) / 2 : 0;
  const dobA = dobrados(A), dobB = dobrados(B);
  // polegar de uma mão dentro do "punho" da outra
  const polegarPreso = (P, Q) => dentroCx(P[4], caixa(Q), 0.05 * tam) && dobrados(Q) >= 3 && dobrados(P) <= 1;
  // pontas agrupadas (mão em "bico") apoiadas na palma da outra
  const bico = (P) => { const c = centro(P, PONTAS); return PONTAS.every((i) => d2(P[i], c) < 0.18 * tam); };
  const pontasNaPalma = (P, Q) => bico(P) && d2(centro(P, PONTAS), centro(Q, PALMA)) < 0.6 * tam;
  const feat = { dist, angDedos, entre, dobA, dobB };
  let passo = null, conf = 0;
  if (pontasNaPalma(A, B) || pontasNaPalma(B, A)) { passo = 6; conf = 0.6; }
  else if (polegarPreso(A, B) || polegarPreso(B, A)) { passo = 5; conf = 0.55; }
  else if (angDedos > 130 && (dobA >= 3 || dobB >= 3)) { passo = 4; conf = 0.55; }
  else if (entre >= 0.5 && angDedos < 60) { passo = dist < 0.45 ? 3 : 2; conf = 0.45; }
  else if (angDedos < 45 && dist < 0.7) { passo = 1; conf = 0.5; }
  return { passo, juntas: true, conf, feat };
}

/**
 * Sessão de higienização: começa com as mãos juntas por ≥ 1 s e termina
 * separadas por ≥ 2 s. Soma o tempo de fricção e o tempo de cada passo
 * (um passo "conta" com ≥ 2 s acumulados). Meta de tempo pelo método.
 */
export class SessaoMaos {
  constructor() { this.zerar(); }
  zerar() { this.atual = null; this.sessoes = []; this.tJuntas = null; this.tSep = null; this.tUlt = null; }
  passo(t, cls, metaS = 20) {
    const dt = this.tUlt != null ? Math.min(500, Math.max(0, t - this.tUlt)) : 0;
    this.tUlt = t;
    let fechada = null;
    if (cls.juntas) {
      this.tSep = null;
      if (this.tJuntas == null) this.tJuntas = t;
      if (!this.atual && t - this.tJuntas >= 1000) this.atual = { t0: this.tJuntas, friccaoMs: 0, passos: {}, metaS };
      if (this.atual) {
        this.atual.friccaoMs += dt;
        if (cls.passo) this.atual.passos[cls.passo] = (this.atual.passos[cls.passo] || 0) + dt;
      }
    } else {
      this.tJuntas = null;
      if (this.tSep == null) this.tSep = t;
      if (this.atual && t - this.tSep >= 2000) { fechada = this.fechar(t); }
    }
    return fechada;
  }
  fechar(t) {
    const s = this.atual;
    if (!s) return null;
    s.t1 = t;
    s.friccaoS = s.friccaoMs / 1000;
    s.feitos = PASSOS_OMS.filter((p) => (s.passos[p.id] || 0) >= 2000).map((p) => p.id);
    s.tempoOk = s.friccaoS >= s.metaS;
    this.sessoes.push(s);
    this.atual = null;
    return s;
  }
}

export { medianaH };
