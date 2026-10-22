/**
 * cv/runtime/livres-i/swing.js — matemática do swing (golfe, tênis, padel,
 * beach tennis, beisebol), sem DOM: roda no navegador e no node (testes).
 *
 * Entrada: amostras da pose BlazePose (33 pontos, índices ANATÔMICOS — o
 * operador já desfaz o espelho) com o tempo do quadro:
 *   { t (ms), P: [{x, y, z, v}×33] (px do quadro), impl?: {x, y} }
 *
 * 1. Mãos: média dos punhos (golfe, beisebol: as duas mãos no taco) ou o punho
 *    da mão dominante (raquete). Velocidade por regressão local no tempo, em
 *    "troncos por segundo" (comprimento ombros–quadril), o que dispensa
 *    calibração para detectar e segmentar.
 * 2. Swing = pico de velocidade das mãos acima de `vMin`, fechado quando a
 *    velocidade cai (ou 1,2 s depois do pico). Fases:
 *      topo      golfe: mãos mais altas antes do pico · raquete/beisebol:
 *                menor velocidade antes do pico (a reversão do backswing)
 *      início    voltando do topo, o último instante com as mãos paradas
 *      impacto   golfe: mãos no ponto mais baixo depois do topo (≈ a bola) ·
 *                raquete/beisebol: pico de velocidade das mãos
 *      fim       golfe: mãos mais altas depois do impacto · outros: mãos
 *                paradas de novo
 * 3. Métricas (aproximações 2D, ver os comentários de cada uma).
 */
import { derivadas } from './vbt.js';

/** Índices MediaPipe (anatômicos). */
export const LM = {
  nariz: 0, ombroE: 11, ombroD: 12, cotoveloE: 13, cotoveloD: 14, punhoE: 15, punhoD: 16,
  quadrilE: 23, quadrilD: 24, joelhoE: 25, joelhoD: 26, tornozeloE: 27, tornozeloD: 28,
};

/**
 * Perfis. maos: 'ambas' | 'dominante'; topo/impacto: método; vMin: pico mínimo
 * (troncos/s) para contar como swing; ref: faixas de referência (só onde há
 * consenso razoável na literatura de treino — o resto aparece sem cor).
 */
export const ESPORTES = {
  'Golfe': {
    golpes: ['Drive', 'Ferro'], maos: 'ambas', topo: 'altura', impacto: 'baixo', fim: 'altura', vMin: 4,
    implemento: ['baseball bat'],
    ref: { razaoTempo: [2.5, 3.5], xfactor: [30, 60], bracoLider: [155, 185], cabeca: [0, 12], rotOmbros: [70, 110] },
  },
  'Tênis': {
    golpes: ['Saque', 'Forehand', 'Backhand'], maos: 'dominante', topo: 'reversao', impacto: 'pico', fim: 'parada', vMin: 4,
    implemento: ['tennis racket'], ref: { cabeca: [0, 20] },
  },
  'Padel': {
    golpes: ['Forehand', 'Backhand', 'Smash', 'Bandeja'], maos: 'dominante', topo: 'reversao', impacto: 'pico', fim: 'parada', vMin: 3.5,
    implemento: ['tennis racket'], ref: { cabeca: [0, 20] },
  },
  'Beach tennis': {
    golpes: ['Forehand', 'Backhand', 'Smash', 'Saque'], maos: 'dominante', topo: 'reversao', impacto: 'pico', fim: 'parada', vMin: 3.5,
    implemento: ['tennis racket'], ref: { cabeca: [0, 20] },
  },
  'Beisebol': {
    golpes: ['Rebatida'], maos: 'ambas', topo: 'reversao', impacto: 'pico', fim: 'parada', vMin: 4,
    implemento: ['baseball bat'], ref: { cabeca: [0, 15] },
  },
};
export const NOMES_ESPORTES = Object.keys(ESPORTES);
/** Golpe no formato "Esporte · Golpe" (é o que o parâmetro do nó guarda). */
export const PERFIS_SWING = NOMES_ESPORTES.flatMap((e) => ESPORTES[e].golpes.map((g) => `${e} · ${g}`));
export function perfilDe(nome) {
  const [e, g] = String(nome || '').split(' · ');
  const esp = ESPORTES[e] ? e : 'Golfe';
  const golpe = ESPORTES[esp].golpes.includes(g) ? g : ESPORTES[esp].golpes[0];
  return { esporte: esp, golpe, ...ESPORTES[esp] };
}

export const FASES = ['preparação', 'backswing', 'topo', 'downswing', 'impacto', 'finalização'];
export const NOME_FASE = {
  'preparação': 'Preparação', backswing: 'Backswing', topo: 'Topo', downswing: 'Downswing', impacto: 'Impacto', 'finalização': 'Follow-through',
};

/** Métricas mostradas (chave, nome, unidade, faixa em ref). */
export const METRICAS_SWING = [
  { k: 'tempoBack', nome: 'Tempo do backswing', un: 's', d: 2 },
  { k: 'tempoDown', nome: 'Tempo do downswing', un: 's', d: 2 },
  { k: 'razaoTempo', nome: 'Razão de tempo', un: ':1', d: 1, ref: 'razaoTempo' },
  { k: 'rotOmbros', nome: 'Rotação dos ombros (topo)', un: '°', d: 0, ref: 'rotOmbros' },
  { k: 'rotQuadril', nome: 'Rotação do quadril (topo)', un: '°', d: 0 },
  { k: 'xfactor', nome: 'Separação quadril-ombro (X-factor)', un: '°', d: 0, ref: 'xfactor' },
  { k: 'colunaAddr', nome: 'Inclinação da coluna (preparação)', un: '°', d: 0 },
  { k: 'colunaImp', nome: 'Inclinação da coluna (impacto)', un: '°', d: 0 },
  { k: 'bracoLider', nome: 'Braço líder (topo)', un: '°', d: 0, ref: 'bracoLider' },
  { k: 'cabeca', nome: 'Deslocamento da cabeça', un: '%', d: 0, ref: 'cabeca' },
  { k: 'velMaos', nome: 'Velocidade máx. das mãos', un: 'tr/s', d: 1 },
  { k: 'velAngPunho', nome: 'Vel. angular máx. do antebraço', un: '°/s', d: 0 },
  { k: 'transfImp', nome: 'Transferência de peso (impacto)', un: '%', d: 0 },
  { k: 'transfFim', nome: 'Transferência de peso (final)', un: '%', d: 0 },
];

export const num = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d).replace('.', ','));
const mediana = (a) => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const meio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const graus = (r) => (r * 180) / Math.PI;

/** Ângulo interno em B (graus, 180 = reto). */
export function anguloInterno(A, B, C) {
  const a = Math.atan2(A.y - B.y, A.x - B.x), c = Math.atan2(C.y - B.y, C.x - B.x);
  let d = Math.abs(a - c);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return graus(d);
}

/** Lado líder (anatômico) pela mão dominante: destro → esquerdo lidera (golfe, beisebol). */
export function ladoLider(dominante) { return dominante === 'canhoto' ? 'D' : 'E'; }

/** Ponto das "mãos" de uma pose. */
export function maos(P, perfil, dominante) {
  const e = P[LM.punhoE], d = P[LM.punhoD];
  if (perfil.maos === 'ambas') return meio(e, d);
  return dominante === 'canhoto' ? e : d;
}

/** Medidas instantâneas de uma pose (o que não depende do swing inteiro). */
export function medirPose(P, perfil, dominante) {
  const oE = P[LM.ombroE], oD = P[LM.ombroD], qE = P[LM.quadrilE], qD = P[LM.quadrilD];
  const mO = meio(oE, oD), mQ = meio(qE, qD);
  const lider = ladoLider(dominante);
  const L = (k) => P[LM[k + lider]];
  // braço que interessa: no golfe/beisebol o LÍDER (esquerdo do destro); na raquete o da raquete
  const braco = perfil.maos === 'ambas' ? { o: L('ombro'), c: L('cotovelo'), p: L('punho') }
    : (dominante === 'canhoto' ? { o: oE, c: P[LM.cotoveloE], p: P[LM.punhoE] } : { o: oD, c: P[LM.cotoveloD], p: P[LM.punhoD] });
  return {
    tronco: dist(mO, mQ),
    larguraOmbros: dist(oE, oD), larguraQuadril: dist(qE, qD),
    // orientação da linha (líder − trás) no plano x–z (z do BlazePose: profundidade relativa)
    angOmbrosZ: graus(Math.atan2((oE.z || 0) - (oD.z || 0), oE.x - oD.x)),
    angQuadrilZ: graus(Math.atan2((qE.z || 0) - (qD.z || 0), qE.x - qD.x)),
    // coluna: quadril→ombros em relação à vertical (graus, + = ombros à direita da imagem)
    coluna: graus(Math.atan2(mO.x - mQ.x, mQ.y - mO.y)),
    braco: anguloInterno(braco.o, braco.c, braco.p),
    antebraco: graus(Math.atan2(braco.p.y - braco.c.y, braco.p.x - braco.c.x)),
    maos: maos(P, perfil, dominante), nariz: P[LM.nariz], quadril: mQ, ombros: mO,
    base: dist(P[LM.tornozeloE], P[LM.tornozeloD]),
  };
}

/** Rotação 2D a partir da largura aparente (vista de frente): acos(largura / largura de referência). */
export function rotacaoPorLargura(larg, ref) {
  if (!(ref > 0) || !(larg >= 0)) return null;
  return graus(Math.acos(Math.max(-1, Math.min(1, larg / ref))));
}
const difAng = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

/** Desdobra uma série de ângulos (graus) para derivar sem saltos de 360°. */
function desdobrar(a) {
  const o = [a[0]];
  for (let i = 1; i < a.length; i++) o.push(o[i - 1] + difAng(a[i], a[i - 1]));
  return o;
}

/**
 * Segmenta um swing ao redor do pico `ipk` numa série já medida.
 * am[i] = { t, m (medirPose) }, vel[i] = troncos/s. Devolve índices ou null.
 */
export function segmentar(am, vel, ipk, perfil) {
  const n = am.length, t = (i) => am[i].t;
  const pico = vel[ipk];
  const parado = Math.max(0.8, 0.12 * pico);
  // ---- topo
  let topo = -1;
  if (perfil.topo === 'altura') {
    let yMin = Infinity;
    for (let i = ipk - 1; i >= 0 && t(ipk) - t(i) <= 2500; i--) {
      const y = am[i].m.maos.y;
      if (y < yMin) { yMin = y; topo = i; }
    }
  } else {
    let vm = Infinity;
    // a reversão do backswing fica perto do pico: a aceleração da raquete/taco dura < 0,8 s
    for (let i = ipk - 1; i >= 0 && t(ipk) - t(i) <= 800; i--) {
      if (t(ipk) - t(i) < 60) continue;
      if (vel[i] < vm) { vm = vel[i]; topo = i; }
    }
  }
  if (topo < 0) return null;
  // ---- início do backswing: sai da pausa do topo, depois volta até as mãos pararem
  let i = topo;
  while (i > 0 && vel[i] < parado && t(topo) - t(i) < 600) i--;
  while (i > 0 && vel[i - 1] >= parado && t(topo) - t(i - 1) <= 2500) i--;
  const inicio = Math.max(0, i - 1 >= 0 && vel[i - 1] < parado ? i - 1 : i);
  // ---- impacto
  let impacto = ipk;
  if (perfil.impacto === 'baixo') {
    let yMax = -Infinity;
    for (let k = topo + 1; k < n && t(k) - t(ipk) <= 200; k++) {
      const y = am[k].m.maos.y;
      if (y > yMax) { yMax = y; impacto = k; }
    }
  }
  // ---- fim do follow-through
  let fim = -1;
  if (perfil.fim === 'altura') {
    let yMin = Infinity;
    for (let k = impacto + 1; k < n && t(k) - t(impacto) <= 1500; k++) {
      const y = am[k].m.maos.y;
      if (y < yMin) { yMin = y; fim = k; }
    }
  } else {
    for (let k = impacto + 1; k < n && t(k) - t(impacto) <= 1500; k++) {
      fim = k;
      if (vel[k] < parado && t(k) - t(impacto) > 150) break;
    }
  }
  if (fim < 0) fim = Math.min(n - 1, impacto + 1);
  if (!(inicio < topo && topo < impacto && impacto <= fim)) return null;
  // instante do início: o limiar "parado" corta o arranque lento do takeaway;
  // extrapola a reta pelos cruzamentos de 1× e 2× o limiar até velocidade zero
  const cruza = (L) => {
    for (let k = inicio; k < topo; k++) if (vel[k] < L && vel[k + 1] >= L) return t(k) + ((L - vel[k]) / (vel[k + 1] - vel[k])) * (t(k + 1) - t(k));
    return null;
  };
  const tA = cruza(parado), tB = cruza(2 * parado);
  let tInicio = t(inicio);
  if (tA != null && tB != null && tB > tA) tInicio = Math.max(t(inicio) - 300, Math.min(tA, tA - ((tB - tA) * parado) / parado));
  return { inicio, topo, impacto, fim, pico: ipk, tInicio };
}

/** Índice da amostra mais próxima do instante t. */
function maisPerto(am, tt) {
  let b = 0;
  for (let i = 1; i < am.length; i++) if (Math.abs(am[i].t - tt) < Math.abs(am[b].t - tt)) b = i;
  return b;
}

/**
 * Métricas de um swing segmentado. cfg = { vista: 'frente'|'linha do alvo', alturaCm, dominante }.
 */
export function metricasSwing(am, vel, seg, perfil, cfg = {}) {
  const A = am[seg.inicio].m, T = am[seg.topo].m, I = am[seg.impacto].m, F = am[seg.fim].m;
  const trecho = am.slice(seg.inicio, seg.fim + 1);
  const tronco = mediana(trecho.map((a) => a.m.tronco)) || A.tronco || 1;
  const s = (i) => am[i].t / 1000;
  const tempoBack = s(seg.topo) - (seg.tInicio != null ? seg.tInicio / 1000 : s(seg.inicio)), tempoDown = s(seg.impacto) - s(seg.topo);
  // referência de largura: o maior valor na preparação (as poses perto do início)
  const pre = am.slice(Math.max(0, seg.inicio - 3), seg.inicio + 1);
  const refO = Math.max(...pre.map((a) => a.m.larguraOmbros)), refQ = Math.max(...pre.map((a) => a.m.larguraQuadril));
  let rotOmbros, rotQuadril;
  if (cfg.vista === 'linha do alvo') {
    // de trás, a largura aparente quase não muda no começo: usa a orientação no plano x–z (z do BlazePose)
    rotOmbros = Math.abs(difAng(T.angOmbrosZ, A.angOmbrosZ));
    rotQuadril = Math.abs(difAng(T.angQuadrilZ, A.angQuadrilZ));
  } else {
    rotOmbros = rotacaoPorLargura(T.larguraOmbros, refO);
    rotQuadril = rotacaoPorLargura(T.larguraQuadril, refQ);
  }
  // direção do swing (para onde as mãos vão no downswing): define "para o alvo"
  const dir = Math.sign(I.maos.x - T.maos.x) || 1;
  // cabeça: maior afastamento do nariz em relação à preparação, até o impacto, em % do tronco
  let cab = 0;
  for (let k = seg.inicio; k <= seg.impacto; k++) cab = Math.max(cab, dist(am[k].m.nariz, A.nariz));
  // velocidade angular do antebraço (graus/s), derivada robusta
  const tsA = trecho.map((a) => a.t), angA = desdobrar(trecho.map((a) => a.m.antebraco));
  const { v: wv } = derivadas(tsA, angA, 40, 3);
  let velAng = 0;
  for (let k = 0; k < wv.length; k++) {
    const tk = tsA[k];
    if (tk >= am[seg.topo].t - 50 && tk <= am[seg.impacto].t + 80) velAng = Math.max(velAng, Math.abs(wv[k]));
  }
  let velMaos = 0;
  for (let k = seg.topo; k <= seg.fim; k++) velMaos = Math.max(velMaos, vel[k]);
  const base = A.base > 0 ? A.base : tronco;
  const cmTronco = cfg.alturaCm > 0 ? 0.3 * cfg.alturaCm : null;   // ombro–quadril ≈ 30% da estatura
  const r = {
    tempoBack, tempoDown, razaoTempo: tempoDown > 0 ? tempoBack / tempoDown : null,
    rotOmbros, rotQuadril, xfactor: rotOmbros != null && rotQuadril != null ? rotOmbros - rotQuadril : null,
    colunaAddr: A.coluna * dir, colunaImp: I.coluna * dir,
    bracoLider: perfil.maos === 'ambas' ? T.braco : I.braco,
    cabeca: (cab / tronco) * 100,
    cabecaCm: cmTronco ? (cab / tronco) * cmTronco : null,
    velMaos, velMaosMs: cmTronco ? (velMaos * cmTronco) / 100 : null,
    velAngPunho: velAng,
    transfImp: ((I.quadril.x - A.quadril.x) * dir / base) * 100,
    transfFim: ((F.quadril.x - A.quadril.x) * dir / base) * 100,
    dir, tronco,
  };
  return r;
}

/** Status de um valor numa faixa: ok, perto (até `folga` fora), fora. */
export function status(v, faixa, folga) {
  if (v == null || !Number.isFinite(v) || !faixa) return 'sem';
  const [a, b] = faixa;
  if (v >= a && v <= b) return 'ok';
  const f = folga == null ? Math.max(1, (b - a) * 0.15) : folga;
  return v >= a - f && v <= b + f ? 'perto' : 'fora';
}
export const COR_STATUS = { ok: '#4ade80', perto: '#FFD84D', fora: '#f87171', sem: '#94a3b8' };

/**
 * Sessão de swings: buffer de amostras, detecção online e a lista de swings.
 */
export class SessaoSwing {
  constructor() { this.zerar(); }
  zerar() {
    this.buf = [];             // { t, P, impl, m }
    this.swings = [];
    this.ultimoFim = -Infinity;
    this.velAgora = null;
    this.t0 = null;
    this.nAmostras = 0;
    this.descartes = 0;
  }
  /**
   * a = { t, P, impl? }, cfg = { perfil (nome), dominante, vista, alturaCm, vMin? }.
   * Devolve o swing fechado nesta amostra (ou null).
   */
  adicionar(a, cfg = {}) {
    const perfil = perfilDe(cfg.perfil);
    if (this.t0 == null || a.t < this.t0) this.t0 = a.t;   // vídeo que volta ao início: os tempos do relatório não ficam negativos
    const ult = this.buf[this.buf.length - 1];
    if (ult && (a.t < ult.t - 1 || a.t - ult.t > 800)) { this.buf = []; this.ultimoFim = -Infinity; }   // vídeo voltou / buraco
    if (ult && Math.abs(a.t - ult.t) < 0.5) return null;
    const m = medirPose(a.P, perfil, cfg.dominante);
    this.buf.push({ t: a.t, P: a.P, impl: a.impl || null, m });
    this.nAmostras++;
    while (this.buf.length && this.buf[0].t < a.t - 6000) this.buf.shift();
    const n = this.buf.length;
    if (n < 6) return null;
    const tronco = mediana(this.buf.map((b) => b.m.tronco)) || 1;
    const ts = this.buf.map((b) => b.t);
    // mãos em relação ao quadril: andar ou trocar de posição na quadra não é swing
    const dx = derivadas(ts, this.buf.map((b) => (b.m.maos.x - b.m.quadril.x) / tronco), 45, 3).v;
    const dy = derivadas(ts, this.buf.map((b) => (b.m.maos.y - b.m.quadril.y) / tronco), 45, 3).v;
    const vel = Array.from(dx, (x, i) => Math.hypot(x, dy[i]));
    this.velAgora = vel[n - 1];
    // pico mais alto ainda não usado, longe o bastante do fim do buffer para o swing ter fechado
    const vMin = cfg.vMin || perfil.vMin;
    let ipk = -1;
    for (let i = 1; i < n - 1; i++) {
      if (ts[i] <= this.ultimoFim) continue;
      if (vel[i] >= vMin && vel[i] >= vel[i - 1] && vel[i] >= vel[i + 1] && (ipk < 0 || vel[i] > vel[ipk])) ipk = i;
    }
    if (ipk < 0) return null;
    // Fecha quando as mãos ficaram LENTAS por 300 ms depois do pico (ou 1,5 s
    // depois dele, para movimento contínuo). Só "caiu a velocidade" não basta:
    // o pico do backswing do golfe (4–6 troncos/s) seria fechado no topo,
    // antes de o downswing — o pico de verdade — acontecer.
    const desde = ts[n - 1] - ts[ipk];
    let ultRapido = ipk;
    for (let i = ipk + 1; i < n; i++) if (vel[i] >= 0.25 * vel[ipk]) ultRapido = i;
    const lento = ts[n - 1] - ts[ultRapido] > 300;
    if (!(desde > 1500 || (lento && desde > 600))) return null;     // swing ainda em curso
    const am = this.buf;
    const seg = segmentar(am, vel, ipk, perfil);
    // swing incompleto (começou antes do buffer — vídeo que acabou de voltar ao
    // início, pessoa que entrou no quadro já girando) ou curto demais para ser
    // um swing: descarta
    const curto = seg && ((ts[seg.topo] - (seg.tInicio ?? ts[seg.inicio])) < 150 || ts[seg.impacto] - ts[seg.topo] < 60
      || ts[seg.impacto] - ts[seg.topo] > 900);     // "downswing" de quase 1 s não é golpe
    if (!seg || seg.inicio === 0 || curto) { this.ultimoFim = Math.max(ts[ipk] + 300, seg ? ts[seg.fim] : 0); this.descartes++; return null; }
    this.ultimoFim = Math.max(am[seg.fim].t, ts[ipk]);
    const met = metricasSwing(am, vel, seg, perfil, cfg);
    const tr = met.tronco, base = am[seg.inicio].m.quadril;
    const norm = (p) => ({ x: (p.x - base.x) / tr, y: (p.y - base.y) / tr });
    const trecho = am.slice(seg.inicio, seg.fim + 1);
    const tempos = {
      'preparação': seg.tInicio != null ? seg.tInicio : am[seg.inicio].t, topo: am[seg.topo].t, impacto: am[seg.impacto].t, 'finalização': am[seg.fim].t,
    };
    tempos.backswing = am[maisPerto(am, (tempos['preparação'] + tempos.topo) / 2)].t;
    tempos.downswing = am[maisPerto(am, (tempos.topo + tempos.impacto) / 2)].t;
    const quadros = {};
    for (const f of FASES) {
      const k = maisPerto(am, tempos[f]);
      quadros[f] = { t: am[k].t, P: am[k].P, thumb: null };
    }
    const swing = {
      n: this.swings.length + 1, esporte: perfil.esporte, golpe: perfil.golpe, perfil: `${perfil.esporte} · ${perfil.golpe}`,
      t: am[seg.impacto].t, tempos, metricas: met, quadros,
      trajeto: trecho.map((b) => ({ ...norm(b.m.maos), t: b.t })),
      trajetoPx: trecho.map((b) => ({ x: b.m.maos.x, y: b.m.maos.y })),
      implemento: trecho.filter((b) => b.impl).map((b) => ({ ...norm(b.impl), t: b.t })),
      amostras: trecho.length,
      taxa: trecho.length > 1 ? ((trecho.length - 1) * 1000) / (trecho[trecho.length - 1].t - trecho[0].t) : null,
      vista: cfg.vista || 'frente', dominante: cfg.dominante || 'destro',
    };
    this.swings.push(swing);
    return swing;
  }
}
