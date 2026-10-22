/**
 * cv/runtime/livres-p/fisio.js — CV-47 Fisio: goniometria e testes funcionais,
 * só matemática (roda no node; o teste exercita com pose sintética).
 *
 * Entrada: a pose BlazePose de 33 pontos em PIXELS do quadro (rótulos
 * esquerda/direita ANATÔMICOS, como devolve runtime/livres-h/pose.js), com o
 * instante de cada amostra em ms. Reusa a geometria do Salto e da Corrida
 * (runtime/livres-h/comum.js).
 *
 * ======================= GONIOMETRIA (ADM ativa) =======================
 * Ângulo 2D no plano da câmera, por articulação e lado, com a posição neutra
 * = 0° (como o goniômetro universal): flexão do joelho = 180° − ângulo
 * quadril–joelho–tornozelo, do quadril = 180° − ombro–quadril–joelho, do
 * cotovelo = 180° − ombro–cotovelo–punho; ombro (flexão na vista lateral,
 * abdução na frontal) = ângulo quadril–ombro–cotovelo; abdução do quadril
 * (frontal) = ângulo quadril oposto–quadril–joelho − 90°; tornozelo = 90° −
 * ângulo joelho–tornozelo–ponta do pé (+ dorsiflexão, − flexão plantar).
 * Série suavizada (mediana de 5), máximo e mínimo da tentativa, amplitude.
 * Referência (ADM média do adulto): AAOS — Greene & Heckman, "The Clinical
 * Measurement of Joint Motion", AAOS 1994. Pose sem marcador tem erro de
 * alguns graus (ICC 0,74–0,93 em quadril e joelho; PMC11783685): é triagem e
 * acompanhamento, não substitui o goniômetro em laudo.
 *
 * ================== SENTAR ↔ LEVANTAR (TUG e STS) ==================
 * Sinal principal: a SUBIDA DO QUADRIL em comprimentos de coxa,
 *   s(t) = (y do quadril sentado − y do quadril) ÷ coxa
 * (0 = sentado; ≈ 0,9–1 = em pé). A coxa é o percentil 90 da distância
 * quadril–joelho (sentado, na vista lateral, ela aparece inteira). Base
 * (sentado) = mediana de ≥ 0,6 s parado com a coxa perto da horizontal.
 * INÍCIO do movimento: primeiro instante em que o tronco (meio dos ombros) se
 * afasta da base OU o quadril sobe — d(t) = max(s, deslocamento do tronco ÷
 * coxa) — com a reta ajustada às amostras de d entre 0,05 e 0,25 estendida
 * até d = 0 (corta o atraso de um limiar). EM PÉ: a rampa de subida (s entre
 * 0,3 e 0,7) estendida até o patamar em pé; SENTADO: a rampa de descida
 * estendida até o patamar sentado. Com rampas lineares o instante sai exato;
 * no real, ± 1–2 quadros.
 *
 * TUG (Podsiadlo & Richardson 1991, J Am Geriatr Soc 39:142): levantar, andar
 * 3 m, girar, voltar e sentar. Tempo = início do movimento → sentado. Fases
 * (como a segmentação por visão de PMC12762308): levantar, ida, giro, volta,
 * girar e sentar — ida/giro/volta pela velocidade horizontal do quadril (vista
 * LATERAL ao percurso): giro = |vx| abaixo de 40% da marcha até voltar no
 * sentido oposto. Referência: ≥ 13,5 s = risco aumentado de queda em idosos
 * da comunidade (Shumway-Cook, Brauer & Woollacott 2000, Phys Ther 80:896).
 *
 * Sentar e levantar 5× (Csuka & McCarty 1985; Bohannon 2006): início → 5ª
 * vez em pé (ou → sentar depois da 5ª, opção). Referência: ≥ 12 s = risco de
 * queda (Tiedemann et al. 2008, Age Ageing 37:430).
 * Sentar e levantar 30 s (Jones, Rikli & Beam 1999, Res Q Exerc Sport 70:113):
 * vezes em pé em 30 s; no fim, mais da metade da subida conta como uma.
 * Faixa normal (percentis 25–75) por idade e sexo: Rikli & Jones 1999,
 * J Aging Phys Act 7:162.
 *
 * NÃO É DISPOSITIVO MÉDICO: apoio à avaliação por profissional habilitado.
 */
import { LM, ok, dist, meio, angulo, pt, pelve, percentil, mediana, num } from '../livres-h/comum.js';

export { num };
const fin = Number.isFinite;

// ===================================================================== goniometria

/** Articulações medidas: rótulo, vista, como calcular (P, lado) e a referência AAOS (graus). */
export const ARTICULACOES = {
  joelho_flexao: {
    nome: 'Joelho — flexão', vista: 'lateral', ref: [0, 135], movimento: 'flexão',
    calc: (P, l, v) => { const a = angulo(pt(P, 'quadril', l, v), pt(P, 'joelho', l, v), pt(P, 'tornozelo', l, v)); return a == null ? null : 180 - a; },
    pontos: (l) => [LM.quadril[l], LM.joelho[l], LM.tornozelo[l]],
  },
  quadril_flexao: {
    nome: 'Quadril — flexão', vista: 'lateral', ref: [0, 120], movimento: 'flexão',
    calc: (P, l, v) => { const a = angulo(pt(P, 'ombro', l, v), pt(P, 'quadril', l, v), pt(P, 'joelho', l, v)); return a == null ? null : 180 - a; },
    pontos: (l) => [LM.ombro[l], LM.quadril[l], LM.joelho[l]],
  },
  quadril_abducao: {
    nome: 'Quadril — abdução', vista: 'frontal', ref: [0, 45], movimento: 'abdução',
    calc: (P, l, v) => {
      const o = l === 'e' ? 'd' : 'e';
      const a = angulo(pt(P, 'quadril', o, v), pt(P, 'quadril', l, v), pt(P, 'joelho', l, v));
      return a == null ? null : a - 90;
    },
    pontos: (l) => [LM.quadril[l === 'e' ? 'd' : 'e'], LM.quadril[l], LM.joelho[l]],
  },
  ombro_flexao: {
    nome: 'Ombro — flexão', vista: 'lateral', ref: [0, 180], movimento: 'flexão',
    calc: (P, l, v) => angulo(pt(P, 'quadril', l, v), pt(P, 'ombro', l, v), pt(P, 'cotovelo', l, v)),
    pontos: (l) => [LM.quadril[l], LM.ombro[l], LM.cotovelo[l]],
  },
  ombro_abducao: {
    nome: 'Ombro — abdução', vista: 'frontal', ref: [0, 180], movimento: 'abdução',
    calc: (P, l, v) => angulo(pt(P, 'quadril', l, v), pt(P, 'ombro', l, v), pt(P, 'cotovelo', l, v)),
    pontos: (l) => [LM.quadril[l], LM.ombro[l], LM.cotovelo[l]],
  },
  cotovelo_flexao: {
    nome: 'Cotovelo — flexão', vista: 'lateral', ref: [0, 150], movimento: 'flexão',
    calc: (P, l, v) => { const a = angulo(pt(P, 'ombro', l, v), pt(P, 'cotovelo', l, v), pt(P, 'punho', l, v)); return a == null ? null : 180 - a; },
    pontos: (l) => [LM.ombro[l], LM.cotovelo[l], LM.punho[l]],
  },
  tornozelo: {
    nome: 'Tornozelo — dorsi/plantar', vista: 'lateral', ref: [-50, 20], movimento: 'dorsiflexão (+) / flexão plantar (−)',
    calc: (P, l, v) => { const a = angulo(pt(P, 'joelho', l, v), pt(P, 'tornozelo', l, v), pt(P, 'pe', l, v)); return a == null ? null : 90 - a; },
    pontos: (l) => [LM.joelho[l], LM.tornozelo[l], LM.pe[l]],
  },
};
export const FONTE_ADM = 'AAOS — Greene & Heckman, The Clinical Measurement of Joint Motion (1994)';

/** Lado com melhor visibilidade dos pontos da articulação. */
export function melhorLado(P, art) {
  const A = ARTICULACOES[art];
  const vis = (l) => A.pontos(l).reduce((s, i) => s + (P[i] && fin(P[i].v) ? P[i].v : 0), 0);
  return vis('e') >= vis('d') ? 'e' : 'd';
}

/** Mediana móvel (janela ímpar k) — corta o salto isolado de um ponto. */
export function medianaMovel(xs, k = 5) {
  const h = Math.floor(k / 2), out = new Array(xs.length).fill(null);
  for (let i = 0; i < xs.length; i++) {
    const w = [];
    for (let j = Math.max(0, i - h); j <= Math.min(xs.length - 1, i + h); j++) if (xs[j] != null) w.push(xs[j]);
    out[i] = w.length ? mediana(w) : null;
  }
  return out;
}

/** Resumo de uma série de ângulos: atual, mín, máx, amplitude (sobre a série suavizada). */
export function resumoAngulos(serie) {
  const sm = medianaMovel(serie.map((a) => a.ang), 5);
  const v = sm.filter((x) => x != null);
  if (!v.length) return { n: 0, atual: null, min: null, max: null, amplitude: null, suave: sm };
  const min = Math.min(...v), max = Math.max(...v);
  return { n: v.length, atual: sm[sm.length - 1], min, max, amplitude: max - min, suave: sm,
    tMin: serie[sm.indexOf(min)].t, tMax: serie[sm.indexOf(max)].t };
}

// ===================================================================== sentar ↔ levantar

export const NIVEL = { inicio: 0.08, emPe: 0.75, sentado: 0.25, ruido: 0.02 };

const reta = (ts, ys) => {
  const n = ts.length;
  if (n < 2) return null;
  let st = 0, sy = 0, stt = 0, sty = 0;
  for (let i = 0; i < n; i++) { st += ts[i]; sy += ys[i]; stt += ts[i] * ts[i]; sty += ts[i] * ys[i]; }
  const d = n * stt - st * st;
  if (Math.abs(d) < 1e-9) return null;
  const b = (n * sty - st * sy) / d, a = (sy - b * st) / n;
  return { a, b };
};
/** Instante (ms, interpolado) em que y cruza `nivel` entre as amostras i-1 e i. */
const cruza = (t, y, i, nivel) => t[i - 1] + ((nivel - y[i - 1]) / (y[i] - y[i - 1])) * (t[i] - t[i - 1]);

/**
 * Sinais do teste a partir das amostras [{ t, P }]: subida do quadril s,
 * deslocamento do tronco, d = max(s, tronco), velocidade horizontal vx (coxas/s),
 * a base sentada e o início do movimento.
 */
export function sinais(amostras, { minVis = 0.4 } = {}) {
  const n = amostras.length;
  const ts = amostras.map((a) => a.t);
  const quad = [], omb = [], coxas = [], sentPose = [];
  for (const { P } of amostras) {
    const q = pelve(P, minVis);
    const oe = pt(P, 'ombro', 'e', minVis), od = pt(P, 'ombro', 'd', minVis);
    const o = oe && od ? meio(oe, od) : (oe || od);
    quad.push(q); omb.push(o);
    // coxa e "sentado": o lado mais visível
    let melhor = null;
    for (const l of ['e', 'd']) {
      const Q = pt(P, 'quadril', l, minVis), J = pt(P, 'joelho', l, minVis);
      if (!Q || !J) continue;
      const v = (P[LM.quadril[l]].v || 0) + (P[LM.joelho[l]].v || 0);
      if (!melhor || v > melhor.v) melhor = { v, Q, J };
    }
    if (melhor) {
      const c = dist(melhor.Q, melhor.J);
      coxas.push(c);
      const incl = Math.abs(Math.atan2(melhor.J.y - melhor.Q.y, Math.abs(melhor.J.x - melhor.Q.x))) * 180 / Math.PI;
      sentPose.push(incl < 35);
    } else sentPose.push(false);
  }
  const coxa = percentil(coxas, 0.9);
  const out = { ts, coxa, s: new Array(n).fill(null), tronco: new Array(n).fill(null), d: new Array(n).fill(null), vx: new Array(n).fill(null),
    base: null, iBase: -1, iInicio: -1, tInicio: null, sentPose };
  if (!coxa || n < 3) return out;

  // base sentada: a última janela parada (≥ 0,6 s) ANTES do início; o início é procurado com a base vigente
  const buf = [];
  let base = null;
  for (let i = 0; i < n; i++) {
    if (base) {
      const s = quad[i] ? (base.y - quad[i].y) / coxa : null;
      const tr = omb[i] && base.o ? dist(omb[i], base.o) / coxa : null;
      const dd = Math.max(s == null ? -1 : s, tr == null ? -1 : tr);
      if (dd >= NIVEL.inicio) { out.iInicio = i; break; }
    }
    // depois que o tronco ou o quadril já se afastam da base (metade do limiar), ela congela até o início
    const longe = base && ((quad[i] && (base.y - quad[i].y) / coxa >= NIVEL.inicio / 2) || (omb[i] && base.o && dist(omb[i], base.o) / coxa >= NIVEL.inicio / 2));
    if (sentPose[i] && quad[i] && !longe) {
      buf.push(i);
      while (buf.length && ts[i] - ts[buf[0]] > 1000) buf.shift();
      if (buf.length >= 3 && ts[i] - ts[buf[0]] >= 600) {
        const ys = buf.map((k) => quad[k].y);
        const my = ys.reduce((a, b) => a + b, 0) / ys.length;
        const sd = Math.sqrt(ys.reduce((a, b) => a + (b - my) ** 2, 0) / ys.length);
        const os = buf.map((k) => omb[k]).filter(Boolean);
        const ox = os.map((q) => q.x), mx = ox.reduce((a, b) => a + b, 0) / (ox.length || 1);
        const sdo = ox.length ? Math.sqrt(ox.reduce((a, b) => a + (b - mx) ** 2, 0) / ox.length) : 0;
        if (sd < 0.03 * coxa && sdo < 0.03 * coxa) {
          base = { y: mediana(ys), x: mediana(buf.map((k) => quad[k].x)), o: os.length ? { x: mediana(os.map((q) => q.x)), y: mediana(os.map((q) => q.y)) } : null, i, i0: buf[0] };
        }
      }
    } else buf.length = 0;
  }
  if (!base) return out;
  out.base = base; out.iBase = base.i;
  for (let i = 0; i < n; i++) {
    out.s[i] = quad[i] ? (base.y - quad[i].y) / coxa : null;
    out.tronco[i] = omb[i] && base.o ? dist(omb[i], base.o) / coxa : null;
    const a = out.s[i], b = out.tronco[i];
    out.d[i] = a == null && b == null ? null : Math.max(a == null ? -1 : a, b == null ? -1 : b);
  }
  // vx: diferença central sobre ±100 ms (coxas/s)
  for (let i = 0; i < n; i++) {
    let a = i, b = i;
    while (a > 0 && ts[i] - ts[a - 1] <= 100) a--;
    while (b < n - 1 && ts[b + 1] - ts[i] <= 100) b++;
    if (b > a && quad[a] && quad[b]) out.vx[i] = ((quad[b].x - quad[a].x) / coxa) / ((ts[b] - ts[a]) / 1000);
  }
  // início do movimento: reta nas amostras com 0,05 ≤ d ≤ 0,25 logo após o cruzamento, estendida até d = 0
  if (out.iInicio > 0) {
    const i0 = out.iInicio;
    const T = [], Y = [];
    let k = i0;
    while (k > 0 && out.d[k - 1] != null && out.d[k - 1] >= 0.05) k--;
    for (; k < n && out.d[k] != null && out.d[k] <= 0.25; k++) if (out.d[k] >= 0.05) { T.push(ts[k] - ts[i0]); Y.push(out.d[k]); }
    let t = cruza(ts, out.d.map((x) => (x == null ? 0 : x)), i0, NIVEL.inicio);
    const r = reta(T, Y);
    if (r && r.b > 1e-6) {
      const tz = ts[i0] + -r.a / r.b;
      // não antes da base sentada, nem depois do cruzamento
      t = Math.min(t, Math.max(tz, ts[base.i0]));
    }
    out.tInicio = t;
  }
  return out;
}

/**
 * Transições depois do início: em pé (subidas) e sentado (descidas), cada uma
 * com o instante estendido até o patamar. [{ tipo: 'emPe'|'sentado', t, i }]
 */
export function transicoes(sg) {
  const { ts, s } = sg;
  const n = ts.length;
  const ev = [];
  if (sg.iInicio < 0) return ev;
  let estado = 'sentado';
  /*
   * Patamar alcançado depois do cruzamento: no 1 s seguinte, o extremo
   * robusto (p90 subindo, p10 descendo) e a mediana das amostras a até 0,06
   * dele — a rampa que ainda sobe/desce fica de fora.
   */
  const JANELA_PATAMAR = 1000;
  const patamar = (i, dir) => {
    const v = [];
    for (let k = i; k < n && ts[k] - ts[i] <= JANELA_PATAMAR; k++) if (s[k] != null) v.push(s[k]);
    if (!v.length) return null;
    const ext = percentil(v, dir > 0 ? 0.9 : 0.1);
    const perto = v.filter((x) => Math.abs(x - ext) <= 0.06);
    return perto.length ? mediana(perto) : ext;
  };
  for (let i = Math.max(1, sg.iInicio); i < n; i++) {
    if (s[i] == null || s[i - 1] == null) continue;
    if (estado === 'sentado' && s[i] >= NIVEL.emPe && s[i - 1] < NIVEL.emPe) {
      const tc = cruza(ts, s, i, NIVEL.emPe);
      if (ts[n - 1] - ts[i] < JANELA_PATAMAR) break;     // o patamar ainda não chegou: fecha no próximo quadro
      const alto = patamar(i, 1);
      const T = [], Y = [];
      for (let k = i; k >= 0 && s[k] != null && s[k] >= 0.3 && ts[i] - ts[k] < 3000; k--) if (s[k] <= 0.7) { T.push(ts[k] - ts[i]); Y.push(s[k]); }
      const r = reta(T, Y);
      let t = tc;
      if (r && r.b > 1e-6 && alto != null && alto > NIVEL.emPe) t = Math.max(tc, Math.min(ts[i] + (alto - r.a) / r.b, tc + 1500));
      ev.push({ tipo: 'emPe', t, i, nivel: alto });
      estado = 'emPe';
    } else if (estado === 'emPe' && s[i] <= NIVEL.sentado && s[i - 1] > NIVEL.sentado) {
      const tc = cruza(ts, s, i, NIVEL.sentado);
      // patamar sentado: precisa do 1 s depois; sem ele a transição ainda não fecha
      if (ts[n - 1] - ts[i] < JANELA_PATAMAR) break;
      const baixo = patamar(i, -1);
      const T = [], Y = [];
      for (let k = i; k >= 0 && s[k] != null && s[k] >= NIVEL.sentado && ts[i] - ts[k] < 3000; k--) if (s[k] <= 0.6) { T.push(ts[k] - ts[i]); Y.push(s[k]); }
      for (let k = i; k < n && s[k] != null && s[k] >= 0.08 && s[k] <= NIVEL.sentado; k++) { T.push(ts[k] - ts[i]); Y.push(s[k]); }
      const r = reta(T, Y);
      let t = tc;
      if (r && r.b < -1e-6 && baixo != null && baixo < NIVEL.sentado) t = Math.max(tc, Math.min(ts[i] + (baixo - r.a) / r.b, tc + 1500));
      ev.push({ tipo: 'sentado', t, i, nivel: baixo });
      estado = 'sentado';
    }
  }
  return ev;
}

/** Tempo (ms, interpolado) em que |vx|·sentido cruza `lim` entre t0 e t1, procurando para frente (dir=1) ou para trás. */
function cruzaVel(sg, t0, t1, sentido, lim, subindo, dir = 1) {
  const { ts, vx } = sg;
  const idx = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] >= t0 && ts[i] <= t1 && vx[i] != null) idx.push(i);
  if (dir < 0) idx.reverse();
  for (let k = 1; k < idx.length; k++) {
    const a = idx[k - 1], b = idx[k];
    const va = vx[a] * sentido, vb = vx[b] * sentido;
    const ok1 = dir > 0 ? (subindo ? va < lim && vb >= lim : va >= lim && vb < lim) : (subindo ? vb < lim && va >= lim : vb >= lim && va < lim);
    if (ok1) return ts[a] + ((lim - va) / (vb - va)) * (ts[b] - ts[a]);
  }
  return null;
}

/** TUG: tempo total e fases. cfg: { distanciaM } */
export function analisarTUG(sg, cfg = {}) {
  const ev = transicoes(sg);
  const res = { teste: 'tug', estado: estadoDe(sg, ev), tInicio: sg.tInicio, total: null, fases: null, eventos: ev, avisos: [] };
  if (sg.tInicio == null) return res;
  const emPe = ev.find((e) => e.tipo === 'emPe');
  const sent = emPe && ev.find((e) => e.tipo === 'sentado' && e.t > emPe.t);
  if (!emPe || !sent) return res;
  res.total = (sent.t - sg.tInicio) / 1000;
  res.tFim = sent.t;
  res.estado = 'concluído';
  // fases pela velocidade horizontal do quadril
  const { ts, vx } = sg;
  const vs = [];
  for (let i = 0; i < ts.length; i++) if (ts[i] >= emPe.t && ts[i] <= sent.t && vx[i] != null) vs.push(Math.abs(vx[i]));
  const vRef = percentil(vs, 0.8);
  const fases = { levantar: (emPe.t - sg.tInicio) / 1000, ida: null, giro: null, volta: null, sentar: null };
  if (vRef && vRef > 0.6) {
    // sentido da ida: o da maior velocidade logo depois de ficar em pé
    let sentido = 0;
    for (let i = 0; i < ts.length && !sentido; i++) if (ts[i] >= emPe.t - 500 && vx[i] != null && Math.abs(vx[i]) >= 0.5 * vRef) sentido = Math.sign(vx[i]);
    const lim = 0.4 * vRef;
    const tAnda = cruzaVel(sg, emPe.t - 1500, sent.t, sentido, lim, true) ?? emPe.t;
    const g0 = cruzaVel(sg, Math.max(tAnda, emPe.t), sent.t, sentido, lim, false);
    const g1 = g0 != null ? cruzaVel(sg, g0, sent.t, -sentido, lim, true) : null;
    // fim da volta: antes de o quadril começar a descer (a descida também anda para trás, sobre a cadeira)
    let tDesce = sent.t;
    for (let i = sent.i; i > 0 && ts[i] > (g1 ?? sent.t); i--) if (sg.s[i] != null && sg.s[i] >= 0.9 * (emPe.nivel || 0.9)) { tDesce = ts[i]; break; }
    const v1 = g1 != null ? cruzaVel(sg, g1, tDesce, -sentido, lim, false, -1) : null;
    if (g0 != null && g1 != null && v1 != null && v1 > g1) {
      fases.ida = (g0 - emPe.t) / 1000; fases.giro = (g1 - g0) / 1000; fases.volta = (v1 - g1) / 1000; fases.sentar = (sent.t - v1) / 1000;
      res.marcas = { emPe: emPe.t, giro0: g0, giro1: g1, volta1: v1 };
      const d = cfg.distanciaM || 3;
      if (fases.ida + fases.volta > 0) res.velocidade = (2 * d) / (fases.ida + fases.volta);
    } else res.avisos.push('Fases da marcha não separadas: filme de lado para o percurso (a câmera vê a pessoa ir e voltar).');
  } else res.avisos.push('Pouco deslocamento lateral: as fases ida/giro/volta pedem a câmera de lado para o percurso.');
  res.fases = fases;
  res.risco = res.total >= REF.tug ? 'alto' : 'baixo';
  return res;
}

/** Sentar e levantar 5×: tempo até a 5ª vez em pé (ou até sentar depois dela). cfg: { fim: 'emPe'|'sentado' } */
export function analisarSTS5(sg, cfg = {}) {
  const ev = transicoes(sg);
  const res = { teste: 'sts5', estado: estadoDe(sg, ev), tInicio: sg.tInicio, total: null, reps: [], eventos: ev, avisos: [] };
  if (sg.tInicio == null) return res;
  const subidas = ev.filter((e) => e.tipo === 'emPe');
  let tAnt = sg.tInicio;
  subidas.forEach((e, k) => { res.reps.push({ n: k + 1, t: e.t, dur: (e.t - tAnt) / 1000 }); tAnt = e.t; });
  res.n = subidas.length;
  if (subidas.length >= 5) {
    let fim = subidas[4].t;
    if (cfg.fim === 'sentado') {
      const s5 = ev.find((e) => e.tipo === 'sentado' && e.t > subidas[4].t);
      fim = s5 ? s5.t : null;
    }
    if (fim != null) {
      res.total = (fim - sg.tInicio) / 1000; res.tFim = fim; res.estado = 'concluído';
      res.risco = res.total >= REF.sts5 ? 'alto' : 'baixo';
    }
  }
  return res;
}

/** Sentar e levantar 30 s: quantas vezes em pé até início + 30 s (meia subida no fim conta). */
export function analisarSTS30(sg, cfg = {}) {
  const ev = transicoes(sg);
  const dur = (cfg.duracaoS || 30) * 1000;
  const res = { teste: 'sts30', estado: estadoDe(sg, ev), tInicio: sg.tInicio, n: 0, eventos: ev, avisos: [], restante: null };
  if (sg.tInicio == null) return res;
  const lim = sg.tInicio + dur;
  const ultimo = sg.ts[sg.ts.length - 1];
  const subidas = ev.filter((e) => e.tipo === 'emPe' && e.t <= lim);
  res.n = subidas.length;
  res.reps = subidas.map((e, k) => ({ n: k + 1, t: e.t }));
  res.restante = Math.max(0, (lim - ultimo) / 1000);
  if (ultimo >= lim) {
    // no apito: mais da metade da subida conta como uma (Jones et al. 1999)
    let i = sg.ts.findIndex((t) => t >= lim);
    if (i < 0) i = sg.ts.length - 1;
    const sAgora = sg.s[i];
    const subindo = sg.s[i] != null && sg.s[i - 1] != null && sg.s[i] > sg.s[i - 1];
    const emPeAgora = ev.some((e) => e.tipo === 'emPe' && e.t <= lim) && !ev.some((e) => e.tipo === 'sentado' && e.t <= lim && e.t > subidas[subidas.length - 1]?.t);
    if (!emPeAgora && sAgora != null && sAgora >= 0.5 && subindo) { res.n++; res.meia = true; }
    res.total = dur / 1000; res.tFim = lim; res.estado = 'concluído';
  }
  return res;
}

function estadoDe(sg, ev) {
  if (!sg.coxa) return 'procurando a pessoa';
  if (!sg.base) return 'aguardando sentado e parado';
  if (sg.tInicio == null) return 'pronto — pode levantar';
  const u = ev[ev.length - 1];
  return u && u.tipo === 'emPe' ? 'em pé' : 'em teste';
}

/** Referências com fonte (s ou repetições). */
export const REF = {
  tug: 13.5,       // Shumway-Cook, Brauer & Woollacott 2000
  sts5: 12,        // Tiedemann et al. 2008
};
export const FONTES = {
  tug: 'Shumway-Cook A, Brauer S, Woollacott M. Phys Ther 2000;80(9):896-903 — TUG ≥ 13,5 s: risco aumentado de queda (idosos da comunidade).',
  tugProto: 'Podsiadlo D, Richardson S. J Am Geriatr Soc 1991;39(2):142-8 — protocolo do Timed Up and Go (3 m).',
  sts5: 'Tiedemann A et al. Age Ageing 2008;37(4):430-5 — sentar e levantar 5× ≥ 12 s: risco de queda.',
  sts30: 'Jones CJ, Rikli RE, Beam WC. Res Q Exerc Sport 1999;70(2):113-9 — protocolo de 30 s; normas: Rikli RE, Jones CJ. J Aging Phys Act 1999;7:162-81.',
  adm: FONTE_ADM,
};
/** Faixa normal (percentis 25–75) do sentar e levantar 30 s por idade e sexo — Rikli & Jones 1999. */
export const NORMA_STS30 = [
  // [idade mín, idade máx, mulheres [p25, p75], homens [p25, p75]]
  [60, 64, [12, 17], [14, 19]], [65, 69, [11, 16], [12, 18]], [70, 74, [10, 15], [12, 17]], [75, 79, [10, 15], [11, 17]],
  [80, 84, [9, 14], [10, 15]], [85, 89, [8, 13], [8, 14]], [90, 94, [4, 11], [7, 12]],
];
export function normaSTS30(idade, sexo) {
  if (!fin(idade)) return null;
  const l = NORMA_STS30.find(([a, b]) => idade >= a && idade <= b);
  if (!l) return null;
  return sexo === 'M' ? l[3] : sexo === 'F' ? l[2] : null;
}

// ===================================================================== sessão

export const TESTES = {
  goniometria: { nome: 'Goniometria (ADM)', curto: 'ADM' },
  tug: { nome: 'Timed Up and Go (TUG)', curto: 'TUG' },
  sts5: { nome: 'Sentar e levantar 5×', curto: '5× STS' },
  sts30: { nome: 'Sentar e levantar 30 s', curto: '30 s STS' },
};

const MAX_MS = 120000;

/**
 * Sessão do paciente: amostras da tentativa em curso, tentativas concluídas
 * (testes cronometrados) e medidas registradas (goniometria).
 */
export class SessaoFisio {
  constructor() { this.zerar(); }
  zerar() { this.amostras = []; this.tentativas = []; this.medidas = []; this.angulos = []; this.ultimo = null; this.seq = 0; this.t0 = null; }

  /** Pose nova (t em ms). Testes cronometrados guardam a pose; a goniometria, o ângulo. */
  adicionar(t, P, cfg) {
    if (this.t0 == null) this.t0 = t;
    if (cfg.teste === 'goniometria') {
      const art = ARTICULACOES[cfg.articulacao] ? cfg.articulacao : 'joelho_flexao';
      const l = cfg.lado === 'e' || cfg.lado === 'd' ? cfg.lado : melhorLado(P, art);
      const ang = ARTICULACOES[art].calc(P, l, cfg.minVis ?? 0.4);
      this.angulos.push({ t, ang, art, l });
      while (this.angulos.length && t - this.angulos[0].t > 60000) this.angulos.shift();
      return;
    }
    this.amostras.push({ t, P: P.map((p) => ({ x: p.x, y: p.y, v: p.v })) });
    while (this.amostras.length && t - this.amostras[0].t > MAX_MS) this.amostras.shift();
  }

  /** Análise da tentativa em curso. */
  analisar(cfg) {
    if (cfg.teste === 'goniometria') {
      const serie = this.angulos.filter((a) => a.art === cfg.articulacao);
      const r = resumoAngulos(serie);
      return { teste: 'goniometria', art: cfg.articulacao, lado: serie.length ? serie[serie.length - 1].l : null, serie, ...r };
    }
    const sg = sinais(this.amostras, { minVis: cfg.minVis ?? 0.4 });
    const res = cfg.teste === 'sts5' ? analisarSTS5(sg, cfg) : cfg.teste === 'sts30' ? analisarSTS30(sg, cfg) : analisarTUG(sg, cfg);
    res.sinais = sg;
    this.ultimo = res;
    return res;
  }

  /**
   * Fecha a tentativa concluída (o teste cronometrado terminou e a pessoa está
   * sentada de novo): guarda e recomeça a série a partir dali. Devolve a tentativa.
   */
  arquivar(res, cfg) {
    if (!res || res.estado !== 'concluído') return null;
    const tent = {
      n: ++this.seq, teste: res.teste, quando: new Date().toISOString(), total: res.total, fases: res.fases || null,
      reps: res.reps || null, nRep: res.n ?? null, velocidade: res.velocidade ?? null, risco: res.risco || null, meia: Boolean(res.meia),
      avisos: res.avisos.slice(), cfg: { distanciaM: cfg.distanciaM, fim: cfg.fim },
      curva: res.sinais ? reduzirCurva(res.sinais, res.tInicio, res.tFim) : null, marcas: res.marcas || null,
      tInicio: res.tInicio, tFim: res.tFim,
    };
    this.tentativas.push(tent);
    // recomeça: só as amostras depois do fim (a pessoa sentada vira a base da próxima)
    const corte = res.tFim != null ? res.tFim : this.amostras.length ? this.amostras[this.amostras.length - 1].t : 0;
    this.amostras = this.amostras.filter((a) => a.t >= corte);
    return tent;
  }

  descartarTentativa() { this.amostras = []; }

  /** Goniometria: registra a medida atual (mín/máx da série) e recomeça a série. */
  registrarMedida(res, extra = {}) {
    if (!res || res.teste !== 'goniometria' || res.max == null) return null;
    const A = ARTICULACOES[res.art];
    const m = {
      n: this.medidas.length + 1, art: res.art, nome: A.nome, lado: res.lado, min: res.min, max: res.max, amplitude: res.amplitude,
      ref: A.ref, pctRef: A.ref[1] > 0 ? (res.max / A.ref[1]) : null, vista: A.vista, quando: new Date().toISOString(),
      curva: res.serie.map((a, i) => [a.t, res.suave[i]]).filter((q) => q[1] != null).filter((_, i, arr) => i % Math.max(1, Math.ceil(arr.length / 400)) === 0),
      ...extra,
    };
    this.medidas.push(m);
    this.angulos = this.angulos.filter((a) => a.art !== res.art);
    return m;
  }
}

/** Curva reduzida (≤ 400 pontos) para o relatório: [t (s desde o início), s, vx]. */
function reduzirCurva(sg, t0, t1) {
  const out = [];
  const a = (t0 ?? sg.ts[0]) - 1000, b = (t1 ?? sg.ts[sg.ts.length - 1]) + 1000;
  for (let i = 0; i < sg.ts.length; i++) {
    if (sg.ts[i] < a || sg.ts[i] > b) continue;
    out.push([(sg.ts[i] - (t0 ?? sg.ts[0])) / 1000, sg.s[i], sg.vx[i]]);
  }
  const k = Math.max(1, Math.ceil(out.length / 400));
  return out.filter((_, i) => i % k === 0);
}

export { ok };
