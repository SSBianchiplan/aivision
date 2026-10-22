/**
 * components/motion3d/via-motion.js — o que a Via GERA para o Motion 3D Studio (CV-88).
 *
 * Arquivo NOVO e isolado de propósito: o Studio só tem um gancho mínimo (ligarViaMotion) e
 * todo o resto mora aqui. A parte de matemática é PURA (roda no node: via-modulos-tools/testes).
 *
 *   animação por texto  a Via devolve KEYFRAMES de ângulos por junta (tool use com esquema);
 *                       aqui eles viram uma TOMADA normal — trilha 33 × [x, y, z] a 30 fps na
 *                       convenção do robo (metros, y para cima, +x esquerda da pessoa, +z frente) —
 *                       por cinemática direta num ESQUELETO PADRÃO (ossos rígidos por construção).
 *   validação física    limites articulares (AAOS / juntas CORPO do GPlanSiS|ROBO), continuidade
 *                       (velocidade angular e da raiz entre keyframes), pés no chão (o quadril
 *                       desce/sobe para o pé de apoio tocar o piso; nada atravessa o chão) e
 *                       ossos rígidos (conferidos depois da cinemática). Pouco fora do limite é
 *                       CORRIGIDO e avisado; impossível é REJEITADO com a lista dos motivos.
 *   coreografia         encadeia tomadas com transição suave (blend com smoothstep + ossos
 *                       restaurados nos quadros misturados).
 *   ajustes             cortar, velocidade, espelhar, girar membro (ex.: braço esquerdo mais alto),
 *                       deslocar, suavizar, repetir, inverter, apoiar no chão — sempre numa CÓPIA.
 *   análise             amplitude dos ângulos, simetria esquerda × direita, ritmo (autocorrelação),
 *                       trajetória do quadril — com o aviso educacional.
 *   perfis de retarget  renomeia as 15 juntas do BVH do robo (Mixamo, UE5, Rigify) e a escala.
 *
 * A tomada gerada passa pelo MESMO pipeline das capturadas (processarTomada → BVH/GLB/JSON/CSV).
 */
import { ORIGENS, processarTomada, novoId } from '../../cv/runtime/livres-v/tomada.js';
import { angulos as angulosRobo } from '../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';

// Proveniência honesta: dado SINTÉTICO gerado por IA (o contrato motionai.pose.v1 tem synthetic_demo).
if (ORIGENS && !ORIGENS.via) {
  ORIGENS.via = { rotulo: 'Gerada pela Via (IA, a partir de texto)', source_type: 'synthetic_demo', reference_frame: 'world', units: 'm',
    flags: ['synthetic_ai_generated', 'not_a_capture'] };
}

export const FPS = 30;
export const AVISO_EDUCACIONAL = 'Educacional/experimental: estimativa por vídeo ou dado sintético — não é laudo médico, ergonômico nem medição biomecânica calibrada.';
const fin = Number.isFinite;
const D2R = Math.PI / 180;

// =====================================================================================
// Esqueleto padrão (adulto de ~1,75 m). Comprimentos em metros.
// =====================================================================================
export const ESQUELETO = Object.freeze({
  quadrilMeia: 0.095, coxa: 0.44, perna: 0.43, tornozeloAltura: 0.07,
  troncoAltura: 0.50, ombroMeia: 0.185, braco: 0.29, antebraco: 0.26,
});
/** Altura do centro do quadril em pé (pés no chão). */
export const ALTURA_QUADRIL_EM_PE = ESQUELETO.coxa + ESQUELETO.perna + ESQUELETO.tornozeloAltura;

/** Ossos conferidos depois da cinemática: [a, b, comprimento esperado]. */
export const OSSOS_PADRAO = [
  [11, 13, ESQUELETO.braco], [13, 15, ESQUELETO.antebraco], [12, 14, ESQUELETO.braco], [14, 16, ESQUELETO.antebraco],
  [23, 25, ESQUELETO.coxa], [25, 27, ESQUELETO.perna], [24, 26, ESQUELETO.coxa], [26, 28, ESQUELETO.perna],
  [11, 12, ESQUELETO.ombroMeia * 2], [23, 24, ESQUELETO.quadrilMeia * 2],
];

/**
 * Juntas aceitas nos keyframes (graus) com os limites. Base: juntas CORPO do GPlanSiS|ROBO
 * (robot-spec) e faixas de ADM da AAOS (as mesmas da Fisio), alargadas para o humano.
 * Convenção: flexão + = para a frente; abdução + = para fora; rotação + = interna (membros)
 * ou para a esquerda (tronco/cabeça); inclinação + = para a esquerda.
 */
const J = (min, max, desc) => ({ min, max, desc });
export const JUNTAS = Object.freeze({
  tronco_flexao: J(-30, 90, 'tronco para a frente (+) / para trás (−)'),
  tronco_inclinacao: J(-35, 35, 'tronco inclinado para a esquerda (+) / direita (−)'),
  tronco_rotacao: J(-45, 45, 'tronco girado para a esquerda (+) / direita (−)'),
  cabeca_flexao: J(-50, 60, 'queixo ao peito (+) / olhar para cima (−)'),
  cabeca_rotacao: J(-70, 70, 'cabeça para a esquerda (+) / direita (−)'),
  ombro_esq_flexao: J(-50, 180, 'braço para a frente/cima (0 = ao lado do corpo, 90 = à frente, 180 = acima da cabeça)'),
  ombro_esq_abducao: J(-10, 180, 'braço para o lado (90 = horizontal, 180 = acima da cabeça)'),
  ombro_esq_rotacao: J(-90, 90, 'rotação interna (+) / externa (−) do braço'),
  cotovelo_esq: J(0, 150, 'flexão do cotovelo (0 = esticado)'),
  punho_esq: J(-70, 70, 'flexão (+) / extensão (−) do punho'),
  ombro_dir_flexao: J(-50, 180, 'idem, lado direito'),
  ombro_dir_abducao: J(-10, 180, 'idem, lado direito'),
  ombro_dir_rotacao: J(-90, 90, 'idem, lado direito'),
  cotovelo_dir: J(0, 150, 'idem, lado direito'),
  punho_dir: J(-70, 70, 'idem, lado direito'),
  quadril_esq_flexao: J(-30, 125, 'coxa para a frente (+) / para trás (−)'),
  quadril_esq_abducao: J(-20, 50, 'perna para o lado (+)'),
  quadril_esq_rotacao: J(-45, 45, 'rotação interna (+) / externa (−) da coxa'),
  joelho_esq: J(0, 150, 'flexão do joelho (0 = esticado)'),
  tornozelo_esq: J(-50, 30, 'dorsiflexão (+, ponta do pé para cima) / flexão plantar (−, na ponta do pé)'),
  quadril_dir_flexao: J(-30, 125, 'idem, lado direito'),
  quadril_dir_abducao: J(-20, 50, 'idem, lado direito'),
  quadril_dir_rotacao: J(-45, 45, 'idem, lado direito'),
  joelho_dir: J(0, 150, 'idem, lado direito'),
  tornozelo_dir: J(-50, 30, 'idem, lado direito'),
});
export const NOMES_JUNTAS = Object.keys(JUNTAS);
/** Canais da raiz: deslocamento no piso (m), giro em torno da vertical (graus, livre) e elevação (m, salto). */
export const RAIZ = Object.freeze({ x: [-20, 20], z: [-20, 20], giro: [-1080, 1080], elevacao: [0, 1.2], altura_quadril: [0.3, 1.3] });

/** Tolerância: até isto além do limite é corrigido (com aviso); mais que isto é impossível. */
export const TOLERANCIA_GRAUS = 20;
/** Velocidade angular entre keyframes: acima de AVISO avisa; acima de MAX é impossível (teletransporte). */
export const VEL_ANG_AVISO = 900, VEL_ANG_MAX = 2500;
export const VEL_RAIZ_MAX = 10;          // m/s no piso (velocista de elite ~ 12 m/s; acima disso, salto de keyframe)
export const VEL_VERTICAL_MAX = 5;       // m/s (impulsão de um salto ~ 3 m/s)
export const MAX_KEYFRAMES = 240, MAX_DURACAO_S = 60;

// =====================================================================================
// Matrizes 3×3 (linha-maior) e cinemática direta
// =====================================================================================
const Rx = (g) => { const c = Math.cos(g * D2R), s = Math.sin(g * D2R); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (g) => { const c = Math.cos(g * D2R), s = Math.sin(g * D2R); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (g) => { const c = Math.cos(g * D2R), s = Math.sin(g * D2R); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
function mm(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  return r;
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const soma = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const esc = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norma = (a) => Math.hypot(a[0], a[1], a[2]);
const cruz = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const prod = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const n = norma(a); return n > 1e-12 ? esc(a, 1 / n) : [0, 0, 0]; };
const cadeia = (...ms) => ms.reduce((a, b) => mm(a, b));

/** Rotação de v em torno do eixo unitário k por g graus (Rodrigues). */
function rodar(v, k, g) {
  const c = Math.cos(g * D2R), s = Math.sin(g * D2R);
  return soma(soma(esc(v, c), esc(cruz(k, v), s)), esc(k, prod(k, v) * (1 - c)));
}

// pontos do rosto e das mãos, nos referenciais locais
const ROSTO = { 0: [0, 0.17, 0.10], 1: [0.015, 0.20, 0.09], 2: [0.033, 0.205, 0.085], 3: [0.05, 0.20, 0.075], 4: [-0.015, 0.20, 0.09], 5: [-0.033, 0.205, 0.085],
  6: [-0.05, 0.20, 0.075], 7: [0.075, 0.18, 0], 8: [-0.075, 0.18, 0], 9: [0.025, 0.13, 0.09], 10: [-0.025, 0.13, 0.09] };
const MAO = { minimo: [0, -0.08, -0.03], indicador: [0, -0.09, 0.025], polegar: [0, -0.045, 0.05] };
const PE = { calcanhar: [0, -0.06, -0.05], ponta: [0, -0.07, 0.15] };

/**
 * Pose (ângulos em graus; ausentes = 0) → 33 pontos relativos ao centro do quadril, com o giro
 * da raiz aplicado. Os comprimentos dos ossos são os do ESQUELETO por construção.
 */
export function poseRelativa(a = {}, giro = 0) {
  const v = (k) => (fin(a[k]) ? a[k] : 0);
  const E = ESQUELETO;
  const P = new Array(33).fill(null);
  const Rp = Ry(giro);
  const Rt = cadeia(Rp, Ry(v('tronco_rotacao')), Rz(-v('tronco_inclinacao')), Rx(v('tronco_flexao')));
  const pescoco = mv(Rt, [0, E.troncoAltura, 0]);
  const Rh = cadeia(Rt, Ry(v('cabeca_rotacao')), Rx(v('cabeca_flexao')));
  for (const [i, o] of Object.entries(ROSTO)) P[+i] = soma(pescoco, mv(Rh, o));
  for (const [lado, s, iO, iC, iP, iMin, iInd, iPol, iQ, iJ, iT, iCal, iPon] of [
    ['esq', 1, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31], ['dir', -1, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32]]) {
    // braço
    const ombro = mv(Rt, [s * E.ombroMeia, E.troncoAltura, 0]);
    const Rb = cadeia(Rt, Rz(s * v(`ombro_${lado}_abducao`)), Rx(-v(`ombro_${lado}_flexao`)), Ry(-s * v(`ombro_${lado}_rotacao`)));
    const cotovelo = soma(ombro, mv(Rb, [0, -E.braco, 0]));
    const Ra = mm(Rb, Rx(-v(`cotovelo_${lado}`)));
    const punho = soma(cotovelo, mv(Ra, [0, -E.antebraco, 0]));
    const Rm = mm(Ra, Rx(-v(`punho_${lado}`)));
    P[iO] = ombro; P[iC] = cotovelo; P[iP] = punho;
    P[iMin] = soma(punho, mv(Rm, MAO.minimo)); P[iInd] = soma(punho, mv(Rm, MAO.indicador)); P[iPol] = soma(punho, mv(Rm, [s * 0.015, MAO.polegar[1], MAO.polegar[2]]));
    // perna
    const quadril = mv(Rp, [s * E.quadrilMeia, 0, 0]);
    const Rc = cadeia(Rp, Rz(s * v(`quadril_${lado}_abducao`)), Rx(-v(`quadril_${lado}_flexao`)), Ry(-s * v(`quadril_${lado}_rotacao`)));
    const joelho = soma(quadril, mv(Rc, [0, -E.coxa, 0]));
    const Rj = mm(Rc, Rx(v(`joelho_${lado}`)));
    const tornozelo = soma(joelho, mv(Rj, [0, -E.perna, 0]));
    const Rpe = mm(Rj, Rx(-v(`tornozelo_${lado}`)));
    P[iQ] = quadril; P[iJ] = joelho; P[iT] = tornozelo;
    P[iCal] = soma(tornozelo, mv(Rpe, PE.calcanhar)); P[iPon] = soma(tornozelo, mv(Rpe, PE.ponta));
  }
  return P;
}

// =====================================================================================
// Validação do pedido da Via
// =====================================================================================
const r1 = (x) => Math.round(x * 10) / 10;
const rotJ = (k) => k.replace(/_/g, ' ');

/**
 * Confere e normaliza a especificação devolvida pela ferramenta gerar_animacao_motion3d.
 * Devolve { ok, erros[], correcoes[], avisos[], spec (normalizada) }. Nunca lança.
 */
export function validarSpec(entrada) {
  const erros = [], correcoes = [], avisos = [];
  const s = entrada && typeof entrada === 'object' ? entrada : {};
  const nome = String(s.nome || 'Via_Animacao').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Via_Animacao';
  const kfs0 = Array.isArray(s.keyframes) ? s.keyframes : [];
  if (!kfs0.length) erros.push('keyframes vazio: mande pelo menos 2 keyframes (t em segundos + juntas em graus).');
  if (kfs0.length > MAX_KEYFRAMES) erros.push(`keyframes demais (${kfs0.length}); o máximo é ${MAX_KEYFRAMES}.`);
  let duracao = Number(s.duracao_s);
  const ultimoT = kfs0.reduce((m, k) => (k && fin(+k.t) ? Math.max(m, +k.t) : m), 0);
  if (!fin(duracao) || duracao <= 0) { duracao = ultimoT; if (duracao > 0) correcoes.push(`duracao_s ausente: usei o último keyframe (${r1(duracao)} s).`); }
  if (!(duracao > 0)) erros.push('duração precisa ser maior que zero.');
  if (duracao > MAX_DURACAO_S) erros.push(`duração de ${r1(duracao)} s passa do máximo de ${MAX_DURACAO_S} s.`);
  const interpolacao = s.interpolacao === 'linear' ? 'linear' : 'suave';
  const contato = ['chao', 'livre'].includes(s.contato) ? s.contato : 'chao';
  const kfs = [];
  kfs0.forEach((k, i) => {
    if (!k || typeof k !== 'object') { erros.push(`keyframe ${i + 1} não é um objeto.`); return; }
    const t = Number(k.t);
    if (!fin(t) || t < 0) { erros.push(`keyframe ${i + 1}: t inválido (${JSON.stringify(k.t)}).`); return; }
    if (t > duracao + 1e-6) { erros.push(`keyframe ${i + 1}: t = ${t} s passa da duração (${r1(duracao)} s).`); return; }
    const juntas = {};
    const jin = k.juntas && typeof k.juntas === 'object' ? k.juntas : {};
    for (const [nomeJ, val] of Object.entries(jin)) {
      const L = JUNTAS[nomeJ];
      if (!L) { erros.push(`keyframe ${i + 1}: junta desconhecida «${nomeJ}». Use só: ${NOMES_JUNTAS.join(', ')}.`); continue; }
      const x = Number(val);
      if (!fin(x)) { erros.push(`keyframe ${i + 1}: ${nomeJ} não é número.`); continue; }
      if (x < L.min - TOLERANCIA_GRAUS || x > L.max + TOLERANCIA_GRAUS) {
        erros.push(`impossível: ${rotJ(nomeJ)} = ${r1(x)}° no keyframe ${i + 1} (t = ${t} s); o limite articular é ${L.min}° a ${L.max}°.`);
        continue;
      }
      if (x < L.min || x > L.max) {
        const c = Math.min(L.max, Math.max(L.min, x));
        correcoes.push(`${rotJ(nomeJ)} = ${r1(x)}° (t = ${t} s) passava do limite; corrigido para ${c}°.`);
        juntas[nomeJ] = c;
      } else juntas[nomeJ] = x;
    }
    const raiz = {};
    const rin = k.raiz && typeof k.raiz === 'object' ? k.raiz : {};
    for (const [c, val] of Object.entries(rin)) {
      const L = RAIZ[c];
      if (!L) { erros.push(`keyframe ${i + 1}: canal de raiz desconhecido «${c}» (use x, z, giro, elevacao, altura_quadril).`); continue; }
      const x = Number(val);
      if (!fin(x)) { erros.push(`keyframe ${i + 1}: raiz.${c} não é número.`); continue; }
      if (c === 'elevacao' && x < 0) { correcoes.push(`raiz.elevacao negativa (${x} m) no keyframe ${i + 1}: o corpo não atravessa o chão — usei 0.`); raiz[c] = 0; continue; }
      if (x < L[0] || x > L[1]) { erros.push(`impossível: raiz.${c} = ${x} no keyframe ${i + 1}; a faixa aceita é ${L[0]} a ${L[1]}.`); continue; }
      raiz[c] = x;
    }
    kfs.push({ t, juntas, raiz });
  });
  kfs.sort((a, b) => a.t - b.t);
  for (let i = 1; i < kfs.length; i++) if (Math.abs(kfs[i].t - kfs[i - 1].t) < 1e-6) erros.push(`dois keyframes no mesmo instante (t = ${kfs[i].t} s).`);
  if (kfs.length === 1) erros.push('um keyframe só não é animação: mande pelo menos 2.');
  if (kfs.length && kfs[0].t > 0) { correcoes.push(`o primeiro keyframe estava em ${kfs[0].t} s: a pose dele vale desde 0 s.`); kfs.unshift({ ...kfs[0], t: 0 }); }
  if (kfs.length && kfs[kfs.length - 1].t < duracao - 1e-6) kfs.push({ ...kfs[kfs.length - 1], t: duracao });
  // juntas não citadas num keyframe herdam o valor anterior (ou 0, a pose neutra em pé)
  const cheio = [];
  let ant = Object.fromEntries(NOMES_JUNTAS.map((k) => [k, 0]));
  let antR = { x: 0, z: 0, giro: 0, elevacao: 0, altura_quadril: ALTURA_QUADRIL_EM_PE };
  for (const k of kfs) { ant = { ...ant, ...k.juntas }; antR = { ...antR, ...k.raiz }; cheio.push({ t: k.t, j: ant, r: antR }); }
  // laço: o fim precisa voltar ao começo
  const loop = Boolean(s.loop);
  if (loop && cheio.length >= 2) {
    const a = cheio[0], b = cheio[cheio.length - 1];
    const dif = NOMES_JUNTAS.filter((k) => Math.abs(a.j[k] - b.j[k]) > 5);
    if (dif.length) { correcoes.push(`loop: a pose final não voltava à inicial (${dif.slice(0, 4).map(rotJ).join(', ')}${dif.length > 4 ? '…' : ''}); o último keyframe foi igualado ao primeiro.`); b.j = { ...a.j }; }
  }
  // continuidade entre keyframes
  const velMax = {};
  for (let i = 1; i < cheio.length; i++) {
    const a = cheio[i - 1], b = cheio[i], dt = b.t - a.t;
    if (dt <= 0) continue;
    for (const k of NOMES_JUNTAS) {
      const w = Math.abs(b.j[k] - a.j[k]) / dt;
      if (w > (velMax[k] || 0)) velMax[k] = w;
      if (w > VEL_ANG_MAX) erros.push(`descontínuo: ${rotJ(k)} vai de ${r1(a.j[k])}° a ${r1(b.j[k])}° em ${r1(dt * 1000)} ms (${Math.round(w)}°/s; acima de ${VEL_ANG_MAX}°/s é teletransporte). Espace os keyframes.`);
    }
    const vh = Math.hypot(b.r.x - a.r.x, b.r.z - a.r.z) / dt;
    if (vh > VEL_RAIZ_MAX) erros.push(`descontínuo: a raiz anda ${r1(Math.hypot(b.r.x - a.r.x, b.r.z - a.r.z))} m em ${r1(dt)} s (${r1(vh)} m/s; máximo ${VEL_RAIZ_MAX} m/s).`);
    const vv = Math.abs(b.r.elevacao - a.r.elevacao) / dt;
    if (vv > VEL_VERTICAL_MAX) erros.push(`descontínuo: a elevação muda ${r1(Math.abs(b.r.elevacao - a.r.elevacao))} m em ${r1(dt)} s (${r1(vv)} m/s; máximo ${VEL_VERTICAL_MAX} m/s).`);
  }
  const rapidas = Object.entries(velMax).filter(([, w]) => w > VEL_ANG_AVISO && w <= VEL_ANG_MAX);
  if (rapidas.length) avisos.push(`movimento muito rápido em ${rapidas.map(([k, w]) => `${rotJ(k)} (${Math.round(w)}°/s)`).join(', ')} — possível, mas de atleta.`);
  // salto: a altura bate com o tempo no ar? h = g·T²/8
  const elevMax = Math.max(0, ...cheio.map((k) => k.r.elevacao));
  if (elevMax > 0.02) {
    const noAr = cheio.filter((k) => k.r.elevacao > 0.02);
    const T = noAr.length ? noAr[noAr.length - 1].t - noAr[0].t : 0;
    const hFis = (9.81 * T * T) / 8;
    if (T > 0 && (elevMax > hFis * 2.5 + 0.05)) avisos.push(`salto de ${r1(elevMax * 100)} cm em ~${r1(T)} s no ar: pela gravidade caberia ~${r1(hFis * 100)} cm (ficou «flutuando»).`);
  }
  const ancoragem = ['pes', 'raiz'].includes(s.ancoragem) ? s.ancoragem
    : cheio.some((k) => Math.abs(k.r.x) > 1e-6 || Math.abs(k.r.z) > 1e-6) ? 'raiz' : 'pes';
  return {
    ok: erros.length === 0, erros, correcoes, avisos,
    spec: { nome, descricao: String(s.descricao || '').slice(0, 300), duracao_s: duracao, loop, interpolacao, contato, ancoragem, keyframes: cheio,
      velMaxGrausS: Object.fromEntries(Object.entries(velMax).map(([k, w]) => [k, Math.round(w)])) },
  };
}

// =====================================================================================
// Interpolação e síntese da trilha
// =====================================================================================
/** Valor no tempo t de um canal com keyframes [{t, v}] (Catmull-Rom não uniforme ou linear). */
export function interpolar(kfs, t, modo = 'suave') {
  const n = kfs.length;
  if (t <= kfs[0].t) return kfs[0].v;
  if (t >= kfs[n - 1].t) return kfs[n - 1].v;
  let i = 0;
  while (i + 1 < n && kfs[i + 1].t < t) i++;
  const a = kfs[i], b = kfs[i + 1], h = b.t - a.t, u = (t - a.t) / h;
  if (modo === 'linear') return a.v + (b.v - a.v) * u;
  const tg = (j) => {
    if (j <= 0 || j >= n - 1) return 0;                       // pontas paradas (começa e termina em repouso)
    const p = kfs[j - 1], q = kfs[j + 1];
    // keyframe de máximo/mínimo local: tangente zero (sem passar do pico)
    if ((kfs[j].v - p.v) * (q.v - kfs[j].v) <= 0) return 0;
    return (q.v - p.v) / (q.t - p.t);
  };
  const m0 = tg(i) * h, m1 = tg(i + 1) * h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a.v + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b.v + (u3 - u2) * m1;
}

const PES = [27, 28, 29, 30, 31, 32];
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * Especificação validada → tomada (trilha a 30 fps) + relatório da física.
 * Pés no chão: com contato «chao», a altura do quadril é a que faz o ponto mais baixo do pé
 * tocar o piso (+ a elevação do salto). Nada atravessa o chão (mãos, joelhos: o corpo sobe).
 * Ancoragem «pes»: o pé de apoio fica parado no piso (o corpo anda pelo movimento das pernas).
 */
export function sintetizar(specValida) {
  const s = specValida;
  const n = Math.max(2, Math.round(s.duracao_s * FPS) + 1);
  const canais = {};
  for (const k of NOMES_JUNTAS) canais[k] = s.keyframes.map((f) => ({ t: f.t, v: f.j[k] }));
  for (const k of Object.keys(RAIZ)) canais['raiz.' + k] = s.keyframes.map((f) => ({ t: f.t, v: f.r[k] }));
  const trilha = [];
  const correcoes = [];
  let atravessou = 0, ancora = null, pePrev = null, deslize = 0, quadrosApoio = 0;
  let offX = 0, offZ = 0;
  for (let f = 0; f < n; f++) {
    const t = Math.min(s.duracao_s, f / FPS);
    const a = {};
    for (const k of NOMES_JUNTAS) { const L = JUNTAS[k]; a[k] = Math.min(L.max, Math.max(L.min, interpolar(canais[k], t, s.interpolacao))); }
    const R = {};
    for (const k of Object.keys(RAIZ)) R[k] = interpolar(canais['raiz.' + k], t, s.interpolacao);
    R.elevacao = Math.max(0, R.elevacao);
    const rel = poseRelativa(a, R.giro);
    const minPe = Math.min(...PES.map((i) => rel[i][1]));
    let py = s.contato === 'chao' ? -minPe + R.elevacao : R.altura_quadril + R.elevacao;
    const minTudo = Math.min(...rel.map((p) => p[1])) + py;
    if (minTudo < -0.005) { py -= minTudo; atravessou++; }
    // ancoragem pelo pé de apoio
    let x = R.x, z = R.z;
    if (s.ancoragem === 'pes') {
      const pe = (rel[29][1] + rel[31][1]) / 2 <= (rel[30][1] + rel[32][1]) / 2 ? 'esq' : 'dir';
      const centro = pe === 'esq' ? [(rel[29][0] + rel[31][0]) / 2, (rel[29][2] + rel[31][2]) / 2] : [(rel[30][0] + rel[32][0]) / 2, (rel[30][2] + rel[32][2]) / 2];
      const noChao = R.elevacao < 0.01;
      if (noChao) {
        if (!ancora || ancora.pe !== pe) ancora = { pe, x: centro[0] + offX, z: centro[1] + offZ };
        offX = ancora.x - centro[0]; offZ = ancora.z - centro[1];
      } else ancora = null;   // no ar: conserva o deslocamento
      x = offX; z = offZ;
    }
    const q = rel.map((p) => [r4(p[0] + x), r4(p[1] + py), r4(p[2] + z)]);
    // deslize do pé de apoio (só informativo)
    const apoio = [29, 31, 30, 32].filter((i) => q[i][1] < 0.03);
    if (apoio.length && pePrev) {
      const d = apoio.reduce((acc, i) => acc + Math.hypot(q[i][0] - pePrev[i][0], q[i][2] - pePrev[i][2]), 0) / apoio.length;
      deslize += d; quadrosApoio++;
    }
    pePrev = q;
    trilha.push(q);
  }
  if (atravessou) correcoes.push(`em ${atravessou} quadro(s) uma parte do corpo atravessava o chão: o corpo foi erguido até apoiar.`);
  // ossos rígidos: conferência depois da cinemática
  let desvio = 0;
  for (const q of trilha) for (const [a, b, L] of OSSOS_PADRAO) desvio = Math.max(desvio, Math.abs(norma(sub(q[b], q[a])) - L));
  const alturaPes = trilha.map((q) => Math.min(...PES.map((i) => q[i][1])));
  return {
    trilha, correcoes,
    fisica: {
      quadros: n, fps: FPS, duracao_s: r4((n - 1) / FPS),
      ossos_rigidos_desvio_max_mm: r4(desvio * 1000),
      pes_no_chao_pct: Math.round((100 * alturaPes.filter((y) => y < 0.01).length) / n),
      altura_max_pes_cm: Math.round(Math.max(...alturaPes) * 100),
      deslize_medio_pe_apoio_cm_s: quadrosApoio ? r4((deslize / quadrosApoio) * FPS * 100) : 0,
      vel_angular_max_graus_s: s.velMaxGrausS,
    },
  };
}

/** Pedido da Via → { ok, erros, correcoes, avisos, tomada?, fisica? } (a tomada ainda NÃO está salva). */
export function gerarTomada(entrada) {
  const v = validarSpec(entrada);
  if (!v.ok) return { ok: false, erros: v.erros, correcoes: v.correcoes, avisos: v.avisos };
  const s = sintetizar(v.spec);
  if (s.fisica.ossos_rigidos_desvio_max_mm > 1) return { ok: false, erros: [`ossos não ficaram rígidos (${s.fisica.ossos_rigidos_desvio_max_mm} mm)`], correcoes: v.correcoes, avisos: v.avisos };
  const tomada = {
    id: novoId('tk'), nome: `A_Via_${v.spec.nome}`.slice(0, 48), pasta: 'Animation', criado: new Date().toISOString(),
    fps: FPS, origem: 'via', fonteId: 'Via (IA) · keyframes', cameras: [], p2d: null, trilha: s.trilha,
    corte: { ini: 0, fim: s.trilha.length - 1 },
    via: { tipo: 'animacao', descricao: v.spec.descricao, spec: entrada, fisica: s.fisica },
  };
  return { ok: true, erros: [], correcoes: [...v.correcoes, ...s.correcoes], avisos: v.avisos, tomada, fisica: s.fisica, spec: v.spec };
}

// =====================================================================================
// Utilidades de trilha (para coreografia, ajustes e análise)
// =====================================================================================
const copiaQ = (q) => q.map((p) => (p ? [p[0], p[1], p[2]] : null));
const centroQuadril = (q) => (q && q[23] && q[24] ? [(q[23][0] + q[24][0]) / 2, (q[23][1] + q[24][1]) / 2, (q[23][2] + q[24][2]) / 2] : null);

/** Trilha do corte atual da tomada (sem mexer na original). */
export function trilhaDoCorte(t) {
  const n = t.trilha.length;
  const ini = Math.max(0, Math.min(n - 1, t.corte ? t.corte.ini : 0));
  const fim = Math.max(ini, Math.min(n - 1, t.corte ? t.corte.fim : n - 1));
  return t.trilha.slice(ini, fim + 1).map(copiaQ);
}

/** Reamostra uma trilha de fpsDe para fpsPara (interpolação linear por ponto). */
export function reamostrarTrilha(tr, fpsDe, fpsPara) {
  if (Math.abs(fpsDe - fpsPara) < 1e-6 || tr.length < 2) return tr.map(copiaQ);
  const dur = (tr.length - 1) / fpsDe, n = Math.max(2, Math.round(dur * fpsPara) + 1), out = [];
  for (let f = 0; f < n; f++) {
    const x = Math.min(tr.length - 1, (f / fpsPara) * fpsDe), i = Math.floor(x), u = x - i, a = tr[i], b = tr[Math.min(tr.length - 1, i + 1)];
    out.push(a.map((p, k) => (p && b[k] ? [p[0] + (b[k][0] - p[0]) * u, p[1] + (b[k][1] - p[1]) * u, p[2] + (b[k][2] - p[2]) * u] : p ? [...p] : b[k] ? [...b[k]] : null)));
  }
  return out;
}

/** Comprimento mediano dos ossos de uma trilha (para restaurar depois de misturar). */
function comprimentos(tr) {
  const L = {};
  for (const [a, b] of CADEIA) {
    const ls = tr.map((q) => (q[a] && q[b] ? norma(sub(q[b], q[a])) : NaN)).filter(fin).sort((x, y) => x - y);
    if (ls.length) L[a + '-' + b] = ls[Math.floor(ls.length / 2)];
  }
  return L;
}
const CADEIA = [[11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [27, 31], [28, 30], [28, 32]];
const FILHOS = { 13: [15, 17, 19, 21], 15: [17, 19, 21], 14: [16, 18, 20, 22], 16: [18, 20, 22], 25: [27, 29, 31], 27: [29, 31], 26: [28, 30, 32], 28: [30, 32] };
/** Restaura os comprimentos (da raiz para as pontas), levando os descendentes junto. */
function restaurarOssos(q, L) {
  for (const [a, b] of CADEIA) {
    const C = L[a + '-' + b];
    if (!C || !q[a] || !q[b]) continue;
    const nb = soma(q[a], esc(unit(sub(q[b], q[a])), C));
    const d = sub(nb, q[b]);
    q[b] = nb;
    for (const f of FILHOS[b] || []) if (q[f] && !(a === 27 || a === 28)) q[f] = soma(q[f], d);
  }
  return q;
}

/** Altura do chão (10º percentil do ponto de pé mais baixo de cada quadro). */
export function alturaChao(tr) {
  const ys = [];
  for (const q of tr) { let m = Infinity; for (const k of PES) if (q && q[k] && q[k][1] < m) m = q[k][1]; if (fin(m)) ys.push(m); }
  if (!ys.length) return 0;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length * 0.1)];
}
const deslocar = (tr, d) => tr.map((q) => q.map((p) => (p ? [p[0] + d[0], p[1] + d[1], p[2] + d[2]] : null)));
const suave = (u) => u * u * (3 - 2 * u);

/**
 * Coreografia: encadeia trechos de tomadas com transição suave.
 * itens = [{ tomada (completa), ini_s?, fim_s?, repetir? }] · transicao_s (0–2).
 * Cada trecho é alinhado ao fim do anterior (posição do quadril no piso e chão em y = 0);
 * os quadros da transição misturam as duas poses (smoothstep) e têm os ossos restaurados.
 */
export function encadear(itens, transicao_s = 0.5, nome = 'Coreografia') {
  const erros = [];
  if (!Array.isArray(itens) || itens.length < 2) erros.push('mande pelo menos 2 trechos para encadear.');
  if (!(transicao_s >= 0 && transicao_s <= 2)) erros.push('transicao_s precisa estar entre 0 e 2 s.');
  if (erros.length) return { ok: false, erros };
  const trechos = [];
  for (const [i, it] of itens.entries()) {
    const t = it.tomada;
    if (!t || !Array.isArray(t.trilha) || t.trilha.length < 2) { erros.push(`trecho ${i + 1}: tomada vazia ou não encontrada.`); continue; }
    let tr = reamostrarTrilha(trilhaDoCorte(t), t.fps || FPS, FPS);
    const n = tr.length, a = fin(it.ini_s) ? Math.max(0, Math.round(it.ini_s * FPS)) : 0, b = fin(it.fim_s) ? Math.min(n - 1, Math.round(it.fim_s * FPS)) : n - 1;
    if (b - a < 2) { erros.push(`trecho ${i + 1}: intervalo ${it.ini_s ?? 0}–${it.fim_s ?? '?'} s curto demais.`); continue; }
    tr = tr.slice(a, b + 1);
    tr = deslocar(tr, [0, -alturaChao(tr), 0]);
    const rep = Math.max(1, Math.min(10, Math.round(it.repetir || 1)));
    for (let r = 0; r < rep; r++) trechos.push({ tr: tr.map(copiaQ), origem: t.origem, nome: t.nome });
  }
  if (erros.length) return { ok: false, erros };
  const N = Math.round(transicao_s * FPS);
  const L = comprimentos(trechos[0].tr);
  let out = trechos[0].tr;
  for (let k = 1; k < trechos.length; k++) {
    const nb = Math.min(N, Math.floor(out.length / 2), Math.floor(trechos[k].tr.length / 2));
    const ref = centroQuadril(out[out.length - 1 - nb]) || [0, 0, 0];
    const c0 = centroQuadril(trechos[k].tr[0]) || [0, 0, 0];
    const B = deslocar(trechos[k].tr, [ref[0] - c0[0], 0, ref[2] - c0[2]]);
    const base = out.slice(0, out.length - nb);
    const mistura = [];
    for (let j = 0; j < nb; j++) {
      const w = suave((j + 1) / (nb + 1)), qa = out[out.length - nb + j], qb = B[j];
      mistura.push(restaurarOssos(qa.map((p, i) => (p && qb[i] ? [p[0] * (1 - w) + qb[i][0] * w, p[1] * (1 - w) + qb[i][1] * w, p[2] * (1 - w) + qb[i][2] * w] : p ? [...p] : qb[i] ? [...qb[i]] : null)), L));
    }
    out = [...base, ...mistura, ...B.slice(nb)];
  }
  const pessoal = trechos.some((t) => !['via', 'demonstracao'].includes(t.origem));
  return {
    ok: true,
    tomada: {
      id: novoId('tk'), nome: `A_Via_${String(nome).replace(/[^\w-]+/g, '_').slice(0, 36)}`, pasta: 'Animation', criado: new Date().toISOString(),
      fps: FPS, origem: pessoal ? trechos.find((t) => !['via', 'demonstracao'].includes(t.origem)).origem : 'via', fonteId: 'Via (IA) · coreografia', cameras: [], p2d: null,
      trilha: out.map((q) => q.map((p) => (p ? [r4(p[0]), r4(p[1]), r4(p[2])] : null))), corte: { ini: 0, fim: out.length - 1 },
      via: { tipo: 'coreografia', trechos: itens.map((it) => ({ tomada_id: it.tomada && it.tomada.id, nome: it.tomada && it.tomada.nome, ini_s: it.ini_s ?? null, fim_s: it.fim_s ?? null, repetir: it.repetir || 1 })), transicao_s },
    },
    resumo: { trechos: trechos.length, quadros: out.length, duracao_s: r4((out.length - 1) / FPS), transicoes: trechos.length - 1, quadros_por_transicao: N },
  };
}

// ------------------------------------------------------------------ ajustes
const PARES = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
export const MEMBROS = {
  braco_esq: { pivo: 11, pts: [13, 15, 17, 19, 21] }, braco_dir: { pivo: 12, pts: [14, 16, 18, 20, 22] },
  antebraco_esq: { pivo: 13, pts: [15, 17, 19, 21] }, antebraco_dir: { pivo: 14, pts: [16, 18, 20, 22] },
  perna_esq: { pivo: 23, pts: [25, 27, 29, 31] }, perna_dir: { pivo: 24, pts: [26, 28, 30, 32] },
  tronco: { pivo: 'quadril', pts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] },
  cabeca: { pivo: 'ombros', pts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
};
export const TIPOS_AJUSTE = ['cortar', 'velocidade', 'espelhar', 'girar_membro', 'deslocar', 'suavizar', 'repetir', 'inverter', 'apoiar_no_chao'];

/** Confere a lista de operações (antes de executar). Devolve a lista de erros. */
export function validarAjustes(ops) {
  const e = [];
  if (!Array.isArray(ops) || !ops.length) return ['operacoes vazio.'];
  if (ops.length > 12) e.push('no máximo 12 operações por vez.');
  ops.forEach((o, i) => {
    const n = `operação ${i + 1}`;
    if (!o || !TIPOS_AJUSTE.includes(o.tipo)) { e.push(`${n}: tipo desconhecido ${JSON.stringify(o && o.tipo)} (use ${TIPOS_AJUSTE.join(', ')}).`); return; }
    if (o.tipo === 'cortar' && !(fin(o.ini_s) || fin(o.fim_s))) e.push(`${n}: cortar precisa de ini_s e/ou fim_s.`);
    if (o.tipo === 'velocidade' && !(fin(o.fator) && o.fator >= 0.25 && o.fator <= 4)) e.push(`${n}: fator de velocidade entre 0,25 (4× mais lento) e 4.`);
    if (o.tipo === 'girar_membro') {
      if (!MEMBROS[o.membro]) e.push(`${n}: membro desconhecido (use ${Object.keys(MEMBROS).join(', ')}).`);
      if (!(fin(o.graus) && Math.abs(o.graus) <= 90)) e.push(`${n}: graus entre −90 e 90.`);
      if (o.direcao && !['cima', 'frente', 'fora'].includes(o.direcao)) e.push(`${n}: direcao é cima, frente ou fora.`);
    }
    if (o.tipo === 'deslocar' && ![o.x, o.y, o.z].some(fin)) e.push(`${n}: deslocar precisa de x, y ou z (m).`);
    if (o.tipo === 'deslocar' && [o.x, o.y, o.z].some((v) => fin(v) && Math.abs(v) > 20)) e.push(`${n}: deslocamento até 20 m.`);
    if (o.tipo === 'suavizar' && o.intensidade != null && !(o.intensidade >= 1 && o.intensidade <= 5)) e.push(`${n}: intensidade de 1 a 5.`);
    if (o.tipo === 'repetir' && !(Number.isInteger(o.vezes) && o.vezes >= 2 && o.vezes <= 10)) e.push(`${n}: vezes de 2 a 10.`);
  });
  return e;
}

/** Frente do corpo no quadro (horizontal), pelos ombros e quadris. */
function frente(q) {
  const l = q[11] && q[12] ? sub(q[11], q[12]) : q[23] && q[24] ? sub(q[23], q[24]) : [1, 0, 0];
  return unit([-l[2], 0, l[0]]);   // up × lateral: com +x = esquerda, a frente é +z
}

/** Aplica as operações numa CÓPIA da tomada. Devolve { tomada, notas[] }. */
export function ajustar(t, ops) {
  let tr = trilhaDoCorte(t), fps = t.fps || FPS;
  const notas = [];
  for (const o of ops) {
    const n = tr.length;
    if (o.tipo === 'cortar') {
      const a = fin(o.ini_s) ? Math.max(0, Math.round(o.ini_s * fps)) : 0, b = fin(o.fim_s) ? Math.min(n - 1, Math.round(o.fim_s * fps)) : n - 1;
      if (b - a < 2) throw new Error(`o corte ${o.ini_s ?? 0}–${o.fim_s ?? '?'} s deixaria menos de 3 quadros (a tomada tem ${(n / fps).toFixed(1)} s).`);
      tr = tr.slice(a, b + 1); notas.push(`cortada para ${(a / fps).toFixed(2)}–${(b / fps).toFixed(2)} s`);
    } else if (o.tipo === 'velocidade') {
      tr = reamostrarTrilha(tr, fps * o.fator, fps); notas.push(`velocidade ×${o.fator} (${(n / fps).toFixed(1)} s → ${(tr.length / fps).toFixed(1)} s)`);
    } else if (o.tipo === 'espelhar') {
      tr = tr.map((q) => { const m = q.map((p) => (p ? [-p[0], p[1], p[2]] : null)); for (const [a, b] of PARES) { const x = m[a]; m[a] = m[b]; m[b] = x; } return m; });
      notas.push('espelhada (esquerda ⇄ direita)');
    } else if (o.tipo === 'girar_membro') {
      const M = MEMBROS[o.membro], dir = o.direcao || 'cima';
      let limitados = 0;
      tr = tr.map((q) => {
        const piv = M.pivo === 'quadril' ? centroQuadril(q) : M.pivo === 'ombros' ? (q[11] && q[12] ? esc(soma(q[11], q[12]), 0.5) : null) : q[M.pivo];
        const dist = q[M.pts[0]];
        if (!piv || !dist) return q;
        const v = sub(dist, piv);
        const alvo = dir === 'cima' ? [0, 1, 0] : dir === 'frente' ? frente(q) : unit([v[0], 0, v[2]]);
        let k = cruz(v, alvo);
        if (norma(k) < 1e-6) return q;
        k = unit(k);
        // não passa do alvo (ex.: braço já na vertical não «vira» para o outro lado)
        const angAlvo = Math.acos(Math.max(-1, Math.min(1, prod(unit(v), alvo)))) / D2R;
        let g = o.graus;
        if (g > 0 && g > angAlvo) { g = angAlvo; limitados++; }
        const out = q.map((p) => (p ? [...p] : null));
        for (const i of M.pts) if (out[i]) out[i] = soma(piv, rodar(sub(out[i], piv), k, g));
        return out;
      });
      notas.push(`${o.membro.replace('_', ' ')} girado ${o.graus}° para ${dir}${limitados ? ` (limitado em ${limitados} quadro(s) para não passar do alvo)` : ''}`);
    } else if (o.tipo === 'deslocar') {
      tr = deslocar(tr, [o.x || 0, o.y || 0, o.z || 0]); notas.push(`deslocada (${o.x || 0}, ${o.y || 0}, ${o.z || 0}) m`);
    } else if (o.tipo === 'suavizar') {
      const w = Math.round(o.intensidade || 2);
      tr = tr.map((q, f) => q.map((p, k) => {
        if (!p) return null;
        const acc = [0, 0, 0]; let c = 0;
        for (let d = -w; d <= w; d++) { const r = tr[f + d] && tr[f + d][k]; if (r) { acc[0] += r[0]; acc[1] += r[1]; acc[2] += r[2]; c++; } }
        return esc(acc, 1 / c);
      }));
      tr = tr.map((q) => restaurarOssos(q, comprimentos(trilhaDoCorte(t))));
      notas.push(`suavizada (janela ±${w} quadros, ossos restaurados)`);
    } else if (o.tipo === 'repetir') {
      const base = tr; tr = [];
      for (let r = 0; r < o.vezes; r++) tr.push(...(r ? base.slice(1) : base).map(copiaQ));
      notas.push(`repetida ${o.vezes}×`);
    } else if (o.tipo === 'inverter') {
      tr = [...tr].reverse(); notas.push('tocada de trás para a frente');
    } else if (o.tipo === 'apoiar_no_chao') {
      const c = alturaChao(tr); tr = deslocar(tr, [0, -c, 0]); notas.push(`apoiada no chão (desceu ${Math.round(c * 100)} cm)`);
    }
  }
  const tomada = {
    ...t, id: novoId('tk'), nome: `${t.nome}_ajuste`.slice(0, 56), criado: new Date().toISOString(), fps,
    trilha: tr.map((q) => q.map((p) => (p ? [r4(p[0]), r4(p[1]), r4(p[2])] : null))), corte: { ini: 0, fim: tr.length - 1 },
    p2d: null, via: { tipo: 'ajuste', de: t.id, deNome: t.nome, operacoes: ops },
  };
  delete tomada.dono; delete tomada.alterado; delete tomada.thumb; delete tomada.trilhaBruta;
  return { tomada, notas };
}

// ------------------------------------------------------------------ análise
const est = (xs) => {
  const v = xs.filter(fin);
  if (!v.length) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return { min: Math.round(Math.min(...v)), max: Math.round(Math.max(...v)), media: Math.round(m), amplitude: Math.round(Math.max(...v) - Math.min(...v)) };
};
/** Período dominante (s) de um sinal por autocorrelação, entre 0,3 e 4 s. */
function periodo(sinal, fps) {
  const x = sinal.filter(fin);
  if (x.length < fps * 1.2) return null;
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  const d = x.map((v) => v - m);
  const e0 = d.reduce((a, v) => a + v * v, 0);
  if (e0 < 1e-8) return null;
  let melhor = null;
  for (let lag = Math.round(0.3 * fps); lag <= Math.min(Math.round(4 * fps), d.length - 2); lag++) {
    let s = 0; for (let i = 0; i + lag < d.length; i++) s += d[i] * d[i + lag];
    const r = s / e0;
    if (!melhor || r > melhor.r) melhor = { lag, r };
  }
  return melhor && melhor.r > 0.3 ? { s: r4(melhor.lag / fps), forca: Math.round(melhor.r * 100) / 100 } : null;
}

/** Análise numérica de uma tomada (para a Via comentar). Não sai nada além destes números. */
export function analisar(t) {
  const proc = processarTomada(t);
  if (!proc) throw new Error('Tomada curta demais para analisar.');
  const tr = proc.trilha, fps = t.fps || FPS;
  const angs = tr.map((q) => angulosRobo(q));
  const nomes = Object.keys(angs[0] || {});
  const angulos = Object.fromEntries(nomes.map((k) => [k, est(angs.map((a) => a[k]))]));
  const simetria = {};
  for (const base of ['joelho', 'cotovelo', 'quadril', 'ombro']) {
    const e = angulos[`${base} esq.`], d = angulos[`${base} dir.`];
    if (e && d) simetria[base] = { amplitude_esq: e.amplitude, amplitude_dir: d.amplitude, diferenca_pct: Math.round((100 * Math.abs(e.amplitude - d.amplitude)) / Math.max(1, (e.amplitude + d.amplitude) / 2)) };
  }
  const quad = tr.map(centroQuadril);
  let caminho = 0;
  for (let i = 1; i < quad.length; i++) if (quad[i] && quad[i - 1]) caminho += Math.hypot(quad[i][0] - quad[i - 1][0], quad[i][2] - quad[i - 1][2]);
  const ys = quad.map((c) => (c ? c[1] : NaN));
  const ritmo = { quadril_vertical: periodo(ys, fps), punho_esq: periodo(tr.map((q) => (q[15] ? q[15][1] : NaN)), fps), punho_dir: periodo(tr.map((q) => (q[16] ? q[16][1] : NaN)), fps),
    tornozelo_esq: periodo(tr.map((q) => (q[27] ? q[27][1] : NaN)), fps) };
  const chao = alturaChao(tr);
  const noAr = tr.filter((q) => Math.min(...PES.map((k) => (q[k] ? q[k][1] : Infinity))) > chao + 0.05).length;
  return {
    tomada: t.nome, origem: (ORIGENS[t.origem] || {}).rotulo || t.origem, quadros: tr.length, fps, duracao_s: r4((tr.length - 1) / fps),
    angulos_graus: angulos,
    convencao: 'joelho/cotovelo: 0° = esticado; quadril/ombro: ângulo com o tronco (0° = alinhado ao tronco)',
    simetria,
    ritmo,
    quadril: { caminho_no_piso_m: r4(caminho), variacao_vertical_cm: Math.round((Math.max(...ys.filter(fin)) - Math.min(...ys.filter(fin))) * 100) },
    tempo_no_ar_pct: Math.round((100 * noAr) / tr.length),
    ossos: proc.comprimentos,
    aviso: AVISO_EDUCACIONAL,
  };
}

// ------------------------------------------------------------------ perfis de retarget
export const JUNTAS_BVH = ['Hips', 'Spine', 'Neck', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const ue = { Hips: 'pelvis', Spine: 'spine_01', Neck: 'neck_01', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r' };
const rig = { Hips: 'spine', Spine: 'spine.001', Neck: 'neck', LeftArm: 'upper_arm.L', LeftForeArm: 'forearm.L', LeftHand: 'hand.L', RightArm: 'upper_arm.R', RightForeArm: 'forearm.R', RightHand: 'hand.R',
  LeftUpLeg: 'thigh.L', LeftLeg: 'shin.L', LeftFoot: 'foot.L', RightUpLeg: 'thigh.R', RightLeg: 'shin.R', RightFoot: 'foot.R' };
export const BASES_RETARGET = {
  robo15: { rotulo: 'SK_Mannequin_ROBO (15 juntas, padrão do Studio)', nomes: Object.fromEntries(JUNTAS_BVH.map((j) => [j, j])) },
  mixamo: { rotulo: 'Mixamo (mixamorig:)', nomes: Object.fromEntries(JUNTAS_BVH.map((j) => [j, `mixamorig:${j}`])) },
  ue5: { rotulo: 'Unreal Engine 5 Mannequin', nomes: ue },
  rigify: { rotulo: 'Blender Rigify (metarig)', nomes: rig },
};
const NOME_JUNTA_RE = /^[\w:.\- ]{1,48}$/;

/** Normaliza um perfil (do pedido da Via ou do armazenamento). Devolve { perfil, erros }. */
export function normalizarPerfil(p) {
  const erros = [];
  const o = p && typeof p === 'object' ? p : {};
  const base = BASES_RETARGET[o.base] ? o.base : 'robo15';
  if (o.base && !BASES_RETARGET[o.base]) erros.push(`base desconhecida «${o.base}» (use ${Object.keys(BASES_RETARGET).join(', ')}).`);
  const nomes = { ...BASES_RETARGET[base].nomes };
  for (const [k, v] of Object.entries(o.nomes && typeof o.nomes === 'object' ? o.nomes : {})) {
    if (!JUNTAS_BVH.includes(k)) { erros.push(`junta do BVH desconhecida «${k}» (são ${JUNTAS_BVH.join(', ')}).`); continue; }
    const n = String(v || '').trim().replace(/\s+/g, '_');
    if (!NOME_JUNTA_RE.test(n)) { erros.push(`nome inválido para ${k}: ${JSON.stringify(v)}.`); continue; }
    nomes[k] = n;
  }
  if (new Set(Object.values(nomes)).size !== JUNTAS_BVH.length) erros.push('dois ossos com o mesmo nome no perfil.');
  const escala = o.escala === 'm' ? 'm' : 'cm';
  const nome = String(o.nome || BASES_RETARGET[base].rotulo).trim().slice(0, 60);
  return { perfil: { nome, base, nomes, escala, descricao: String(o.descricao || '').slice(0, 200) }, erros };
}

/** BVH do robo (cm, nomes padrão) → BVH com os nomes e a escala do perfil. */
export function aplicarPerfilBVH(bvh, perfil) {
  const k = perfil.escala === 'm' ? 0.01 : 1;
  const linhas = String(bvh).split('\n');
  let motion = false, canaisRaiz = 0;
  const out = linhas.map((l) => {
    if (/^\s*MOTION/.test(l)) { motion = true; return l; }
    if (!motion) {
      const m = l.match(/^(\s*)(ROOT|JOINT)\s+(\S+)\s*$/);
      if (m) return `${m[1]}${m[2]} ${perfil.nomes[m[3]] || m[3]}`;
      const o = l.match(/^(\s*)OFFSET\s+(.+)$/);
      if (o && k !== 1) return `${o[1]}OFFSET ${o[2].trim().split(/\s+/).map((v) => (+v * k).toFixed(6)).join(' ')}`;
      if (!canaisRaiz && /CHANNELS\s+6/.test(l)) canaisRaiz = 3;
      return l;
    }
    if (k === 1 || /^(Frames|Frame Time)/.test(l) || !l.trim()) return l;
    const v = l.trim().split(/\s+/);
    for (let i = 0; i < canaisRaiz; i++) v[i] = (+v[i] * k).toFixed(6);
    return v.join(' ');
  });
  return out.join('\n');
}

// ------------------------------------------------------------------ miniatura (navegador)
const LIG = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32], [0, 7], [0, 8]];
/** Vista 3/4 (frente-esquerda): agachamento, salto e passos ficam legíveis num desenho 2D. */
const vista34 = (p) => p[0] * 0.82 - p[2] * 0.57;
/** Desenha o quadro `i` da trilha num canvas 2D (vista 3/4). Usado na miniatura e na prévia do cartão. */
export function desenharQuadro(g, tr, i, W, H, cor = '#2EF2D0', fundo = '#0b1416') {
  g.fillStyle = fundo; g.fillRect(0, 0, W, H);
  const todos = [];
  for (const q of tr) for (const p of q) if (p) todos.push(p);
  if (!todos.length) return;
  const xs = todos.map(vista34), ys = todos.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, y0 = Math.min(...ys), alt = Math.max(0.5, Math.max(...ys) - y0, Math.max(...xs) - Math.min(...xs));
  const k = (H * 0.86) / alt;
  const P = (p) => [W / 2 - (vista34(p) - cx) * k, H * 0.93 - (p[1] - y0) * k];
  g.strokeStyle = 'rgba(127,127,127,.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(4, H * 0.93); g.lineTo(W - 4, H * 0.93); g.stroke();
  const q = tr[Math.max(0, Math.min(tr.length - 1, i))];
  g.strokeStyle = cor; g.lineWidth = Math.max(1.5, W / 90); g.lineCap = 'round';
  for (const [a, b] of LIG) if (q[a] && q[b]) { const A = P(q[a]), B = P(q[b]); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); }
  if (q[0]) { const A = P(q[0]); g.beginPath(); g.arc(A[0], A[1], Math.max(3, W / 40), 0, 2 * Math.PI); g.stroke(); }
}
export function miniatura(tr) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas'); c.width = 160; c.height = 100;
  desenharQuadro(c.getContext('2d'), tr, Math.floor(tr.length / 2), 160, 100);
  return c.toDataURL('image/png');
}

// =====================================================================================
// Ponte com o Studio (o gancho mínimo em StudioMotion3D.js chama ligarViaMotion)
// =====================================================================================
let ponte = null;
const pendentes = [];
/**
 * Chamado pelo Studio ao montar (e quando as funções mudam). `api` traz as funções do Studio:
 * novaTomada, salvarTomada, recarregarLista, carregar, exportar, setOpc, play (ref), setMsg.
 * Devolve a função que desliga. Sem Via aberta não custa nada: só guarda referências.
 */
export function ligarViaMotion(api) {
  ponte = api;
  while (pendentes.length) { const fn = pendentes.shift(); try { fn(api); } catch (_) { /* segue */ } }
  return () => { if (ponte === api) ponte = null; };
}
export function ponteMotion() { return ponte; }
/** Executa já (Studio aberto) ou quando o Studio abrir. */
export function quandoStudio(fn) { if (ponte) fn(ponte); else pendentes.push(fn); }
