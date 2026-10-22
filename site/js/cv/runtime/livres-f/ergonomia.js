/**
 * cv/runtime/livres-f/ergonomia.js — RULA e REBA a partir da pose, só matemática.
 *
 * Nada aqui toca em DOM, canvas ou modelo: recebe os 17 pontos COCO da pose
 * (RTMO, coordenadas 0..1 do quadro) e, se houver, as mãos MediaPipe (21
 * pontos), e devolve ângulos por segmento, os escores RULA e REBA com as
 * tabelas oficiais, o nível de ação, recomendações e a sessão no tempo
 * (% do tempo por nível, pico, postura crítica, alertas). É o que os testes
 * no node exercitam.
 *
 * ============================ TABELAS ============================
 *
 *   RULA — McAtamney & Corlett, Applied Ergonomics 24(2):91–99, 1993.
 *   REBA — Hignett & McAtamney, Applied Ergonomics 31(2):201–205, 2000.
 *   Conferidas célula a célula com as fichas de avaliação de A. Hedge
 *   (Cornell / Ergonomics Plus), que reproduzem as tabelas dos artigos.
 *
 * ============================ CONVENÇÕES ============================
 *
 * Ângulos em graus, no plano da imagem (2D), vista LATERAL:
 *   tronco     quadril→ombro em relação à VERTICAL; + = flexão (para a
 *              frente), − = extensão.
 *   pescoço    ombro→orelha em relação à linha do tronco; + = flexão.
 *              Referência: na postura neutra orelha, ombro, quadril,
 *              joelho e tornozelo ficam no mesmo prumo.
 *   braço      ombro→cotovelo em relação ao tronco (ombro→quadril); + =
 *              flexão (braço à frente), − = extensão (para trás).
 *   antebraço  flexão do cotovelo = 180° − ângulo interno ombro–cotovelo–
 *              punho (0° = braço esticado; 60–100° é a faixa neutra).
 *   punho      só com as mãos (21 pontos): o antebraço (cotovelo→punho)
 *              é decomposto na base da mão (eixo punho→dedo médio, normal
 *              da palma): flexão/extensão e desvio radial/ulnar.
 *   joelho     flexão = 180° − ângulo interno quadril–joelho–tornozelo.
 * "Frente" = para onde o nariz aponta em relação às orelhas (ou as mãos).
 * Vista FRONTAL dá inclinação lateral do tronco e do pescoço, abdução do
 * braço e o antebraço cruzando a linha média; as flexões ali saem
 * subestimadas (o segmento aponta para a câmera) — por isso o aviso.
 *
 * Tolerância de "neutro": ±5° (a pose estimada tem ruído de alguns graus;
 * sem ela, um tronco ereto oscilaria entre 1 e 2).
 */

// ------------------------------------------------------------ tabelas

/** RULA Tabela A: [braço 1..6][antebraço 1..3][(punho 1..4 − 1)·2 + (torção 1..2 − 1)]. */
export const RULA_A = [
  [[1, 2, 2, 2, 2, 3, 3, 3], [2, 2, 2, 2, 3, 3, 3, 3], [2, 3, 3, 3, 3, 3, 4, 4]],
  [[2, 3, 3, 3, 3, 4, 4, 4], [3, 3, 3, 3, 3, 4, 4, 4], [3, 4, 4, 4, 4, 4, 5, 5]],
  [[3, 3, 4, 4, 4, 4, 5, 5], [3, 4, 4, 4, 4, 4, 5, 5], [4, 4, 4, 4, 4, 5, 5, 5]],
  [[4, 4, 4, 4, 4, 5, 5, 5], [4, 4, 4, 4, 4, 5, 5, 5], [4, 4, 4, 5, 5, 5, 6, 6]],
  [[5, 5, 5, 5, 5, 6, 6, 7], [5, 6, 6, 6, 6, 7, 7, 7], [6, 6, 6, 7, 7, 7, 7, 8]],
  [[7, 7, 7, 7, 7, 8, 8, 9], [8, 8, 8, 8, 8, 9, 9, 9], [9, 9, 9, 9, 9, 9, 9, 9]],
];
/** RULA Tabela B: [pescoço 1..6][(tronco 1..6 − 1)·2 + (pernas 1..2 − 1)]. */
export const RULA_B = [
  [1, 3, 2, 3, 3, 4, 5, 5, 6, 6, 7, 7],
  [2, 3, 2, 3, 4, 5, 5, 5, 6, 7, 7, 7],
  [3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7],
  [5, 5, 5, 6, 6, 7, 7, 7, 7, 7, 8, 8],
  [7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8],
  [8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9],
];
/** RULA Tabela C: [punho/braço 1..8+][pescoço/tronco/pernas 1..7+]. */
export const RULA_C = [
  [1, 2, 3, 3, 4, 5, 5],
  [2, 2, 3, 4, 4, 5, 5],
  [3, 3, 3, 4, 4, 5, 6],
  [3, 3, 3, 4, 5, 6, 6],
  [4, 4, 4, 5, 6, 7, 7],
  [4, 4, 5, 6, 6, 7, 7],
  [5, 5, 6, 6, 7, 7, 7],
  [5, 5, 6, 7, 7, 7, 7],
];
/** REBA Tabela A: [tronco 1..5][pescoço 1..3][pernas 1..4]. */
export const REBA_A = [
  [[1, 2, 3, 4], [1, 2, 3, 4], [3, 3, 5, 6]],
  [[2, 3, 4, 5], [3, 4, 5, 6], [4, 5, 6, 7]],
  [[2, 4, 5, 6], [4, 5, 6, 7], [5, 6, 7, 8]],
  [[3, 5, 6, 7], [5, 6, 7, 8], [6, 7, 8, 9]],
  [[4, 6, 7, 8], [6, 7, 8, 9], [7, 8, 9, 9]],
];
/** REBA Tabela B: [braço 1..6][antebraço 1..2][punho 1..3]. */
export const REBA_B = [
  [[1, 2, 2], [1, 2, 3]],
  [[1, 2, 3], [2, 3, 4]],
  [[3, 4, 5], [4, 5, 5]],
  [[4, 5, 5], [5, 6, 7]],
  [[6, 7, 8], [7, 8, 8]],
  [[7, 8, 8], [8, 9, 9]],
];
/** REBA Tabela C: [escore A 1..12][escore B 1..12]. */
export const REBA_C = [
  [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7],
  [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8],
  [2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 8],
  [3, 4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9],
  [4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9, 9],
  [6, 6, 6, 7, 8, 8, 9, 9, 10, 10, 10, 10],
  [7, 7, 7, 8, 9, 9, 9, 10, 10, 11, 11, 11],
  [8, 8, 8, 9, 10, 10, 10, 10, 10, 11, 11, 11],
  [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12],
  [10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 12],
  [11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12],
  [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
];

const prende = (v, a, b) => Math.max(a, Math.min(b, Math.round(v)));

// ------------------------------------------------------ níveis de ação

/**
 * Faixa comum de risco 0..4 (cor no overlay e no painel). O RULA tem 4
 * níveis de ação (faixas 1..4); o REBA tem 5 (0..4).
 */
export const FAIXAS = [
  { nome: 'desprezível', cor: '#22c55e' },
  { nome: 'baixo', cor: '#4ade80' },
  { nome: 'médio', cor: '#facc15' },
  { nome: 'alto', cor: '#fb923c' },
  { nome: 'muito alto', cor: '#ef4444' },
];
export const NIVEIS = {
  RULA: [
    { de: 1, ate: 2, faixa: 1, nome: 'Aceitável', acao: 'Postura aceitável se não for mantida ou repetida por longos períodos.' },
    { de: 3, ate: 4, faixa: 2, nome: 'Investigar', acao: 'Investigar mais; mudanças podem ser necessárias.' },
    { de: 5, ate: 6, faixa: 3, nome: 'Mudar em breve', acao: 'Investigar e mudar em breve.' },
    { de: 7, ate: 7, faixa: 4, nome: 'Mudar já', acao: 'Investigar e mudar imediatamente.' },
  ],
  REBA: [
    { de: 1, ate: 1, faixa: 0, nome: 'Desprezível', acao: 'Risco desprezível; nenhuma ação necessária.' },
    { de: 2, ate: 3, faixa: 1, nome: 'Baixo', acao: 'Risco baixo; mudança pode ser necessária.' },
    { de: 4, ate: 7, faixa: 2, nome: 'Médio', acao: 'Risco médio; investigar e mudar em breve.' },
    { de: 8, ate: 10, faixa: 3, nome: 'Alto', acao: 'Risco alto; investigar e implementar mudanças logo.' },
    { de: 11, ate: 15, faixa: 4, nome: 'Muito alto', acao: 'Risco muito alto; implementar mudanças imediatamente.' },
  ],
};
/** Nível de ação de uma nota final. */
export function nivel(metodo, nota) {
  const L = NIVEIS[metodo] || NIVEIS.RULA;
  if (!(nota >= 1)) return null;
  return L.find((n) => nota >= n.de && nota <= n.ate) || L[L.length - 1];
}
export const faixaDe = (metodo, nota) => { const n = nivel(metodo, nota); return n ? n.faixa : null; };
export const corDe = (metodo, nota) => { const f = faixaDe(metodo, nota); return f == null ? '#94a3b8' : FAIXAS[f].cor; };

/**
 * Cor de um SEGMENTO pelo próprio escore: 1 = verde, e sobe até vermelho
 * no topo da escala daquele segmento.
 */
const ESCALAS = {
  RULA: { braco: 6, antebraco: 3, punho: 4, pescoco: 6, tronco: 6, pernas: 2 },
  REBA: { braco: 6, antebraco: 2, punho: 3, pescoco: 3, tronco: 5, pernas: 4 },
};
export function faixaSegmento(metodo, seg, escore) {
  const max = (ESCALAS[metodo] || ESCALAS.RULA)[seg];
  if (!max || !(escore >= 1)) return null;
  if (escore <= 1) return 1;
  if (max === 2) return 3;
  const r = (escore - 1) / (max - 1);          // 0..1
  return r >= 0.6 ? 4 : r >= 0.34 ? 3 : 2;
}
export const corSegmento = (metodo, seg, escore) => {
  const f = faixaSegmento(metodo, seg, escore);
  return f == null ? '#94a3b8' : FAIXAS[f].cor;
};

// ----------------------------------------------- escores por segmento

export const TOL = 5;            // ° de tolerância do "neutro"
export const LIM_ABDUCAO = 30;   // ° (vista frontal) para contar braço abduzido
export const LIM_LATERAL = 10;   // ° de inclinação lateral do tronco/pescoço
export const LIM_DESVIO = 15;    // ° de desvio radial/ulnar do punho

/** Braço (RULA e REBA têm a mesma escala). aj = { ombroElevado, abduzido, apoiado }. */
export function escoreBraco(flex, aj = {}) {
  let s;
  if (flex < -20) s = 2;
  else if (flex <= 20) s = 1;
  else if (flex <= 45) s = 2;
  else if (flex <= 90) s = 3;
  else s = 4;
  s += (aj.ombroElevado ? 1 : 0) + (aj.abduzido ? 1 : 0) - (aj.apoiado ? 1 : 0);
  return prende(s, 1, 6);
}
export function rulaAntebraco(flex, cruza = false) {
  return prende((flex >= 60 && flex <= 100 ? 1 : 2) + (cruza ? 1 : 0), 1, 3);
}
export const rebaAntebraco = (flex) => (flex >= 60 && flex <= 100 ? 1 : 2);
/** RULA punho: neutro 1, até 15° 2, mais de 15° 3; +1 desviado. */
export function rulaPunho(flex, desviado = false) {
  const a = Math.abs(flex);
  return prende((a <= TOL ? 1 : a <= 15 ? 2 : 3) + (desviado ? 1 : 0), 1, 4);
}
/** REBA punho: 0–15° 1, mais de 15° 2; +1 desviado ou torcido. */
export function rebaPunho(flex, desviadoOuTorcido = false) {
  return prende((Math.abs(flex) <= 15 ? 1 : 2) + (desviadoOuTorcido ? 1 : 0), 1, 3);
}
/** RULA pescoço: 0–10° 1, 10–20° 2, >20° 3, extensão 4; +1 torcido, +1 inclinado. */
export function rulaPescoco(flex, aj = {}) {
  const s = flex < -TOL ? 4 : flex <= 10 ? 1 : flex <= 20 ? 2 : 3;
  return prende(s + (aj.torcido ? 1 : 0) + (aj.inclinado ? 1 : 0), 1, 6);
}
/** REBA pescoço: 0–20° 1, >20° ou extensão 2; +1 torcido/inclinado. */
export function rebaPescoco(flex, aj = {}) {
  const s = flex < -TOL || flex > 20 ? 2 : 1;
  return prende(s + (aj.torcido ? 1 : 0) + (aj.inclinado ? 1 : 0), 1, 3);
}
/**
 * RULA tronco: ereto 1, 0–20° 2, 20–60° 3, >60° 4; +1 torcido, +1 inclinado.
 * O RULA não pontua a extensão: aqui ela conta como 0–20° (2), a leitura
 * conservadora usada nas fichas.
 */
export function rulaTronco(flex, aj = {}) {
  const s = Math.abs(flex) <= TOL ? 1 : flex < 0 ? 2 : flex <= 20 ? 2 : flex <= 60 ? 3 : 4;
  return prende(s + (aj.torcido ? 1 : 0) + (aj.inclinado ? 1 : 0), 1, 6);
}
/** REBA tronco: ereto 1, 0–20° flexão ou extensão 2, 20–60° ou extensão >20° 3, >60° 4; +1. */
export function rebaTronco(flex, aj = {}) {
  let s;
  if (Math.abs(flex) <= TOL) s = 1;
  else if (flex < 0) s = flex >= -20 ? 2 : 3;
  else s = flex <= 20 ? 2 : flex <= 60 ? 3 : 4;
  return prende(s + (aj.torcido || aj.inclinado ? 1 : 0) + (aj.torcido && aj.inclinado ? 1 : 0), 1, 5);
}
/** RULA pernas: apoiadas e equilibradas 1, senão 2. */
export const rulaPernas = (apoiadas) => (apoiadas ? 1 : 2);
/** REBA pernas: apoio bilateral/sentado 1, unilateral 2; +1 joelho 30–60°, +2 >60° (não sentado). */
export function rebaPernas(bilateral, sentado, joelhoFlex) {
  let s = bilateral || sentado ? 1 : 2;
  if (!sentado && Number.isFinite(joelhoFlex)) s += joelhoFlex > 60 ? 2 : joelhoFlex >= 30 ? 1 : 0;
  return prende(s, 1, 4);
}

// ------------------------------------------------- notas pelas tabelas

/**
 * RULA a partir dos escores de segmento. e = { braco, antebraco, punho,
 * torcao (1..2), pescoco, tronco, pernas, musculo (0|1), carga (0..3) }.
 * Músculo e carga entram nos dois grupos, como na ficha.
 */
export function rulaDeEscores(e) {
  const postA = RULA_A[prende(e.braco, 1, 6) - 1][prende(e.antebraco, 1, 3) - 1][(prende(e.punho, 1, 4) - 1) * 2 + prende(e.torcao || 1, 1, 2) - 1];
  const postB = RULA_B[prende(e.pescoco, 1, 6) - 1][(prende(e.tronco, 1, 6) - 1) * 2 + prende(e.pernas, 1, 2) - 1];
  const extra = (e.musculo ? 1 : 0) + prende(e.carga || 0, 0, 3);
  const A = postA + extra, B = postB + extra;
  const final = RULA_C[Math.min(A, 8) - 1][Math.min(B, 7) - 1];
  return { postA, postB, A, B, final, nivel: nivel('RULA', final) };
}
/**
 * REBA a partir dos escores de segmento. e = { tronco, pescoco, pernas,
 * carga (0..2), choque (0|1), braco, antebraco, punho, pega (0..3),
 * atividade (0..3) }.
 */
export function rebaDeEscores(e) {
  const tabA = REBA_A[prende(e.tronco, 1, 5) - 1][prende(e.pescoco, 1, 3) - 1][prende(e.pernas, 1, 4) - 1];
  const tabB = REBA_B[prende(e.braco, 1, 6) - 1][prende(e.antebraco, 1, 2) - 1][prende(e.punho, 1, 3) - 1];
  const A = tabA + prende(e.carga || 0, 0, 2) + (e.choque ? 1 : 0);
  const B = tabB + prende(e.pega || 0, 0, 3);
  const C = REBA_C[Math.min(A, 12) - 1][Math.min(B, 12) - 1];
  const final = C + prende(e.atividade || 0, 0, 3);
  return { tabA, tabB, A, B, C, final, nivel: nivel('REBA', final) };
}

// ----------------------------------------------------- pontos e ângulos

/** Índices COCO por lado ANATÔMICO do modelo (e = o que o modelo chama de esquerdo). */
const COCO = {
  e: { orelha: 3, ombro: 5, cotovelo: 7, punho: 9, quadril: 11, joelho: 13, tornozelo: 15 },
  d: { orelha: 4, ombro: 6, cotovelo: 8, punho: 10, quadril: 12, joelho: 14, tornozelo: 16 },
};
export const NARIZ = 0;

const grau = (r) => (r * 180) / Math.PI;
const norm180 = (a) => { let x = a; while (x > 180) x -= 360; while (x <= -180) x += 360; return x; };
/** Ângulo interno em B (graus, 0..180). */
export function anguloInterno(A, B, C) {
  const ux = A.x - B.x, uy = A.y - B.y, vx = C.x - B.x, vy = C.y - B.y;
  const d = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!(d > 0)) return null;
  return grau(Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / d))));
}
const media = (ps) => {
  if (!ps.length) return null;
  let x = 0, y = 0;
  for (const p of ps) { x += p.x; y += p.y; }
  return { x: x / ps.length, y: y / ps.length };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Mede a postura de UMA pessoa.
 * kps: 17 pontos COCO {x, y, score} em 0..1 do quadro.
 * o = { w, h, kpConf, espelhada, vista ('automática'|'lateral'|'frontal'),
 *       maos: [{ pts: 21×{x,y,z} em 0..1 (z na escala de x) }] }.
 * Devolve medidas em graus (null = não medido), os pontos em px e avisos.
 */
export function medirPostura(kps, o = {}) {
  const w = o.w || 1, h = o.h || 1, cf = o.kpConf ?? 0.3;
  const P = kps.map((k) => ({ x: k.x * w, y: k.y * h, v: k.score ?? k.v ?? 1 }));
  const vis = (i) => (P[i] && P[i].v >= cf ? P[i] : null);
  // lado anatômico real: com a imagem espelhada, o "esquerdo" do modelo é o direito da pessoa
  const idx = o.espelhada ? { e: COCO.d, d: COCO.e } : { e: COCO.e, d: COCO.d };
  const pt = (l, parte) => vis(idx[l][parte]);
  const avisos = [];

  const ombros = ['e', 'd'].map((l) => pt(l, 'ombro')).filter(Boolean);
  const quadris = ['e', 'd'].map((l) => pt(l, 'quadril')).filter(Boolean);
  const mOmbro = media(ombros), mQuadril = media(quadris);
  const torsoLen = mOmbro && mQuadril ? dist(mOmbro, mQuadril) : null;

  // ---- vista: largura dos ombros / comprimento do tronco
  let razao = null;
  if (ombros.length === 2 && torsoLen > 0) razao = dist(ombros[0], ombros[1]) / torsoLen;
  let vista = o.vista === 'lateral' || o.vista === 'frontal' ? o.vista : null;
  if (!vista) vista = razao == null ? 'lateral' : razao < 0.32 ? 'lateral' : razao > 0.58 ? 'frontal' : 'oblíqua';
  if (!o.vista || o.vista === 'automática') {
    if (vista === 'frontal') avisos.push('Vista frontal: as flexões (tronco, pescoço, braços) saem subestimadas. Para RULA/REBA filme de lado (90°).');
    else if (vista === 'oblíqua') avisos.push('Vista oblíqua: ângulos aproximados. Gire a câmera para ficar perpendicular ao trabalhador.');
  }

  // ---- direção da frente (+1 = para a direita da imagem)
  let dir = 0;
  const nariz = vis(NARIZ);
  const orelhas = ['e', 'd'].map((l) => pt(l, 'orelha')).filter(Boolean);
  const mOrelha = media(orelhas);
  if (nariz && mOrelha && Math.abs(nariz.x - mOrelha.x) > (torsoLen || 50) * 0.04) dir = Math.sign(nariz.x - mOrelha.x);
  if (!dir && mOmbro) {
    const punhos = ['e', 'd'].map((l) => pt(l, 'punho')).filter(Boolean);
    const mp = media(punhos);
    if (mp && Math.abs(mp.x - mOmbro.x) > (torsoLen || 50) * 0.1) dir = Math.sign(mp.x - mOmbro.x);
  }
  if (!dir) { dir = 1; if (vista !== 'frontal') avisos.push('Não deu para saber para que lado a pessoa está virada (rosto fora do quadro).'); }

  // ângulo de um vetor em relação a "para cima", + = para a frente
  const daVertical = (v) => grau(Math.atan2(v.x * dir, -v.y));
  // em relação a "para baixo", + = para a frente
  const daBaixo = (v) => grau(Math.atan2(v.x * dir, v.y));

  // ---- tronco
  let tronco = null, troncoLat = null;
  if (mOmbro && mQuadril) {
    const v = { x: mOmbro.x - mQuadril.x, y: mOmbro.y - mQuadril.y };
    if (vista === 'frontal') { troncoLat = Math.abs(grau(Math.atan2(v.x, -v.y))); tronco = 0; }
    else tronco = daVertical(v);
  } else avisos.push('Ombros ou quadris fora do quadro: tronco não medido.');

  // ---- pescoço: orelha do lado mais visível
  let pescoco = null, pescocoLat = null;
  if (vista === 'frontal') {
    pescoco = 0;
    const oe = pt('e', 'orelha'), od = pt('d', 'orelha'), se = pt('e', 'ombro'), sd = pt('d', 'ombro');
    if (oe && od && se && sd) {
      const a1 = grau(Math.atan2(od.y - oe.y, od.x - oe.x)), a2 = grau(Math.atan2(sd.y - se.y, sd.x - se.x));
      pescocoLat = Math.abs(norm180(a1 - a2));
      if (pescocoLat > 90) pescocoLat = 180 - pescocoLat;
    }
  } else {
    let melhor = null;
    for (const l of ['e', 'd']) {
      const or = pt(l, 'orelha'), om = pt(l, 'ombro') || mOmbro;
      if (or && om && (!melhor || or.v > melhor.or.v)) melhor = { or, om };
    }
    if (melhor && tronco != null) pescoco = daVertical({ x: melhor.or.x - melhor.om.x, y: melhor.or.y - melhor.om.y }) - tronco;
    else avisos.push('Cabeça (orelhas) fora do quadro: pescoço não medido.');
  }

  // ---- membros superiores, por lado
  const largOmbros = ombros.length === 2 ? dist(ombros[0], ombros[1]) : null;
  const lados = {};
  for (const l of ['e', 'd']) {
    const S = pt(l, 'ombro'), E = pt(l, 'cotovelo'), W = pt(l, 'punho');
    const H = pt(l, 'quadril') || mQuadril;
    const r = { ok: false, braco: null, antebraco: null, abducao: null, cruza: false, punho: null, conf: 0 };
    if (S && E) {
      const ref = H ? daBaixo({ x: H.x - S.x, y: H.y - S.y }) : 0;
      r.braco = vista === 'frontal' ? 0 : norm180(daBaixo({ x: E.x - S.x, y: E.y - S.y }) - ref);
      if (vista === 'frontal' && H) {
        r.abducao = anguloInterno(E, S, H);
      }
      r.conf = Math.min(S.v, E.v);
      r.ok = true;
      if (W) {
        const a = anguloInterno(S, E, W);
        r.antebraco = a == null ? null : 180 - a;
        r.conf = Math.min(r.conf, W.v);
        if (vista === 'frontal' && mOmbro && largOmbros) {
          // cruza a linha média (punho do outro lado do centro) ou trabalha afastado para o lado
          const lado = Math.sign(S.x - mOmbro.x) || 1;
          const rel = (W.x - mOmbro.x) * lado;
          if (rel < -0.15 * largOmbros || rel > 1.1 * largOmbros) r.cruza = true;
        }
        // punho pelas mãos (se houver): mão mais perto deste punho
        if (o.maos && o.maos.length) r.punho = punhoPelaMao(E, W, o.maos, w, h, dist(E, W));
      }
    }
    lados[l] = r;
  }
  if (!lados.e.ok && !lados.d.ok) avisos.push('Braços fora do quadro: membros superiores não medidos.');

  // ---- pernas
  const joelho = {};
  let sentado = null, bilateral = null;
  for (const l of ['e', 'd']) {
    const H = pt(l, 'quadril'), K = pt(l, 'joelho'), A = pt(l, 'tornozelo');
    joelho[l] = H && K && A ? 180 - anguloInterno(H, K, A) : null;
    if (H && K && sentado == null) {
      const coxa = { x: K.x - H.x, y: K.y - H.y };
      if (vista === 'frontal') {
        if (A) sentado = dist(H, K) < 0.5 * dist(K, A);
      } else {
        // coxa perto da horizontal E canela perto da vertical = sentado; no
        // agachamento a canela tomba para a frente (> 30°)
        const coxaH = grau(Math.atan2(Math.abs(coxa.y), Math.abs(coxa.x))) < 35;
        const canelaV = A ? grau(Math.atan2(Math.abs(A.x - K.x), Math.abs(A.y - K.y))) < 30 : true;
        sentado = coxaH && canelaV;
      }
    }
  }
  const te = pt('e', 'tornozelo'), td = pt('d', 'tornozelo');
  if (te && td) {
    const pern = (torsoLen || 100) * 1.6;
    bilateral = Math.abs(te.y - td.y) < 0.15 * pern;
  } else if (!sentado) avisos.push('Pés fora do quadro: assumido apoio nos dois pés.');

  return {
    vista, razao, dir, tronco, troncoLat, pescoco, pescocoLat, lados, joelho, sentado, bilateral, avisos,
    pts: P, mOmbro, mQuadril, torsoLen,
  };
}

/**
 * Punho pelos 21 pontos da mão. A mão é associada pelo ponto 0 (punho)
 * mais próximo do punho do corpo (até 60% do antebraço). O antebraço f
 * (no plano da imagem) é escrito na base da mão: u = punho→dedo médio
 * (ponto 9), n = normal da palma (0→5 × 0→17), v = n × u. Flexão =
 * atan2(f·n, f·u); desvio = atan2(f·v, f·u).
 */
export function punhoPelaMao(E, W, maos, w, h, antebracoPx) {
  let melhor = null, dm = Infinity;
  for (const m of maos) {
    const p0 = m.pts[0];
    const d = Math.hypot(p0.x * w - W.x, p0.y * h - W.y);
    if (d < dm) { dm = d; melhor = m; }
  }
  if (!melhor || dm > 0.6 * (antebracoPx || 1)) return null;
  const q = (i) => ({ x: melhor.pts[i].x * w, y: melhor.pts[i].y * h, z: (melhor.pts[i].z || 0) * w });
  const p0 = q(0), p5 = q(5), p9 = q(9), p17 = q(17);
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const cruz = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const pe = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const un = (a) => { const n = Math.hypot(a.x, a.y, a.z); return n > 0 ? { x: a.x / n, y: a.y / n, z: a.z / n } : null; };
  const u = un(sub(p9, p0));
  const n0 = un(cruz(sub(p5, p0), sub(p17, p0)));
  const f = un({ x: W.x - E.x, y: W.y - E.y, z: 0 });
  if (!u || !n0 || !f) return null;
  // n ortogonal a u (os pontos da mão não são exatamente coplanares)
  const n = un(sub(n0, { x: u.x * pe(n0, u), y: u.y * pe(n0, u), z: u.z * pe(n0, u) }));
  if (!n) return null;
  const v = cruz(n, u);
  const fu = pe(f, u), fv = pe(f, v), fn = pe(f, n);
  return { flex: grau(Math.atan2(fn, fu)), desvio: grau(Math.atan2(fv, fu)) };
}

// --------------------------------------------------------- avaliação

/** Parâmetros padrão de avaliação (os mesmos nomes dos parâmetros do operador). */
export const CFG_PADRAO = {
  metodo: 'RULA', lado: 'pior lado', sentado: 'automático',
  cargaRula: 0, musculoRula: false, punhoTorcao: 1, punhoSemMaos: 2,
  cargaReba: 0, choque: false, pega: 0, estatica: false, repetitiva: false, instavel: false, estaticaAuto: true,
  ombroElevado: false, bracoApoiado: false, troncoTorcido: false, pescocoTorcido: false,
};

/**
 * RULA e REBA de uma pessoa a partir das medidas. ext = { estatica } (a
 * postura estática detectada pela sessão). Os segmentos não medidos
 * entram com o escore neutro (1) e ficam marcados em `assumidos`.
 */
export function avaliar(m, cfgIn = {}, ext = {}) {
  const cfg = { ...CFG_PADRAO, ...cfgIn };
  const assumidos = [];
  const sentado = cfg.sentado === 'sim' ? true : cfg.sentado === 'não' ? false : Boolean(m.sentado);
  const tronco = m.tronco ?? null, pescoco = m.pescoco ?? null;
  if (tronco == null) assumidos.push('tronco');
  if (pescoco == null) assumidos.push('pescoco');
  const inclTronco = m.troncoLat != null && m.troncoLat > LIM_LATERAL;
  const inclPescoco = m.pescocoLat != null && m.pescocoLat > LIM_LATERAL;
  const joelhos = ['e', 'd'].map((l) => m.joelho && m.joelho[l]).filter((x) => Number.isFinite(x));
  const joelhoMax = joelhos.length ? Math.max(...joelhos) : null;
  const bilateral = m.bilateral == null ? true : m.bilateral;
  const estatica = Boolean(cfg.estatica || (cfg.estaticaAuto && ext.estatica));

  // grupo do pescoço/tronco/pernas (o mesmo para os dois lados)
  const rula = {
    pescoco: tronco == null && pescoco == null ? 1 : rulaPescoco(pescoco ?? 0, { torcido: cfg.pescocoTorcido, inclinado: inclPescoco }),
    tronco: rulaTronco(tronco ?? 0, { torcido: cfg.troncoTorcido, inclinado: inclTronco }),
    pernas: rulaPernas(sentado || bilateral),
  };
  const reba = {
    pescoco: rebaPescoco(pescoco ?? 0, { torcido: cfg.pescocoTorcido, inclinado: inclPescoco }),
    tronco: rebaTronco(tronco ?? 0, { torcido: cfg.troncoTorcido, inclinado: inclTronco }),
    pernas: rebaPernas(bilateral, sentado, joelhoMax),
  };
  const musculo = cfg.musculoRula || estatica ? 1 : 0;
  const atividade = (estatica ? 1 : 0) + (cfg.repetitiva ? 1 : 0) + (cfg.instavel ? 1 : 0);

  const porLado = {};
  for (const l of ['e', 'd']) {
    const L = m.lados && m.lados[l];
    if (!L || !L.ok) { porLado[l] = null; continue; }
    const aj = { ombroElevado: cfg.ombroElevado, abduzido: L.abducao != null && L.abducao > LIM_ABDUCAO, apoiado: cfg.bracoApoiado };
    const braco = escoreBraco(L.braco ?? 0, aj);
    const ante = L.antebraco ?? 80;
    const semPunho = !L.punho;
    const desviado = Boolean(L.punho && Math.abs(L.punho.desvio) > LIM_DESVIO);
    const sr = {
      braco, antebraco: rulaAntebraco(ante, L.cruza),
      punho: semPunho ? prende(cfg.punhoSemMaos, 1, 3) : rulaPunho(L.punho.flex, desviado),
      torcao: prende(cfg.punhoTorcao, 1, 2),
    };
    const sb = {
      braco, antebraco: rebaAntebraco(ante),
      punho: semPunho ? (cfg.punhoSemMaos >= 3 ? 2 : 1) + (cfg.punhoTorcao >= 2 ? 1 : 0)
        : rebaPunho(L.punho.flex, desviado || cfg.punhoTorcao >= 2),
    };
    const R = rulaDeEscores({ ...sr, ...rula, musculo, carga: cfg.cargaRula });
    const E = rebaDeEscores({ ...sb, ...reba, carga: cfg.cargaReba, choque: cfg.choque, pega: cfg.pega, atividade });
    porLado[l] = {
      rula: { seg: sr, ...R }, reba: { seg: sb, ...E },
      ang: { braco: L.braco, antebraco: L.antebraco, punho: L.punho ? L.punho.flex : null,
        punhoDesvio: L.punho ? L.punho.desvio : null, abducao: L.abducao },
      semPunho, semAntebraco: L.antebraco == null, conf: L.conf,
    };
  }
  const validos = ['e', 'd'].filter((l) => porLado[l]);
  if (!validos.length) return { ok: false, assumidos, avisos: m.avisos || [] };

  // lado escolhido; "pior lado" = maior nota no método do painel (empate: maior grupo A)
  const met = cfg.metodo === 'REBA' ? 'reba' : 'rula';
  let lado;
  if (cfg.lado === 'esquerdo' && porLado.e) lado = 'e';
  else if (cfg.lado === 'direito' && porLado.d) lado = 'd';
  else {
    lado = validos.reduce((a, b) => {
      const A = porLado[a][met], B = porLado[b][met];
      if (B.final !== A.final) return B.final > A.final ? b : a;
      return B.A > A.A ? b : a;
    });
  }
  const X = porLado[lado];
  if (X.semPunho) assumidos.push('punho');
  if (X.semAntebraco) assumidos.push('antebraco');
  return {
    ok: true, lado, porLado, assumidos, avisos: m.avisos || [], estatica,
    rula: { ...X.rula, seg: { ...X.rula.seg, ...rula }, musculo, carga: cfg.cargaRula },
    reba: { ...X.reba, seg: { ...X.reba.seg, ...reba }, carga: cfg.cargaReba, choque: cfg.choque ? 1 : 0, pega: cfg.pega, atividade },
    ang: { ...X.ang, tronco, pescoco, troncoLat: m.troncoLat, pescocoLat: m.pescocoLat, joelho: joelhoMax },
    sentado, bilateral, vista: m.vista,
  };
}

/** Nota final no método pedido ('RULA' | 'REBA'). */
export const notaDe = (av, metodo) => (av && av.ok ? (metodo === 'REBA' ? av.reba.final : av.rula.final) : null);

// ------------------------------------------------------ recomendações

/**
 * Recomendações em linguagem simples, por segmento, a partir de uma
 * avaliação (normalmente a do pior momento). Cada item: { seg, nivel
 * (faixa 2..4), texto }. Ordenadas da mais grave para a menos.
 */
export function recomendacoes(av, cfg = {}) {
  if (!av || !av.ok) return [];
  const g = av.ang || {}, out = [];
  const add = (seg, nivelR, texto) => out.push({ seg, nivel: nivelR, texto });
  const tr = g.tronco, pe = g.pescoco, br = g.braco, ab = g.antebraco, pu = g.punho;
  if (tr != null) {
    if (tr > 60) add('Tronco', 4, 'Tronco muito inclinado (mais de 60°): evite pegar no chão — use mesa elevatória, plataforma ou suporte que traga a peça à altura da cintura.');
    else if (tr > 20) add('Tronco', 3, 'Tronco inclinado para a frente: eleve a bancada ou aproxime a peça do corpo para trabalhar mais ereto.');
    else if (tr < -TOL) add('Tronco', 2, 'Tronco inclinado para trás: baixe o ponto de trabalho ou aproxime o alcance para não estender as costas.');
  }
  if (g.troncoLat != null && g.troncoLat > LIM_LATERAL) add('Tronco', 3, 'Tronco inclinado para o lado: centralize a peça à frente do corpo.');
  if (cfg.troncoTorcido) add('Tronco', 3, 'Tronco torcido: reorganize o posto para que peça e destino fiquem à frente; gire com os pés, não com a cintura.');
  if (pe != null) {
    if (pe > 20) add('Pescoço', 3, 'Pescoço muito fletido: eleve a peça, a tela ou o desenho, ou incline o plano de trabalho em direção ao trabalhador.');
    else if (pe > 10) add('Pescoço', 2, 'Pescoço levemente fletido: suba um pouco o ponto de visão (tela, peça) ou melhore a iluminação para não aproximar o rosto.');
    else if (pe < -TOL) add('Pescoço', 3, 'Pescoço em extensão (olhando para cima): baixe o que é visto ou use plataforma para ficar mais alto.');
  }
  if (g.pescocoLat != null && g.pescocoLat > LIM_LATERAL) add('Pescoço', 2, 'Cabeça inclinada para o lado: centralize tela e peça na linha dos olhos.');
  if (br != null) {
    if (br > 90) add('Braço', 4, 'Braço acima do ombro: baixe a peça ou use plataforma/escada; ferramentas com extensão evitam trabalhar com as mãos acima da cabeça.');
    else if (br > 45) add('Braço', 3, 'Braço elevado (45–90°): aproxime a peça e baixe o ponto de trabalho para manter os cotovelos perto do corpo.');
    else if (br > 20) add('Braço', 2, 'Braço um pouco à frente: aproxime a peça ou o comando para reduzir o alcance.');
    else if (br < -20) add('Braço', 2, 'Braço estendido para trás: traga o material para a frente do corpo.');
  }
  if (g.abducao != null && g.abducao > LIM_ABDUCAO) add('Braço', 3, 'Braço afastado do corpo (abdução): aproxime a peça ou baixe a bancada para os cotovelos ficarem junto ao tronco.');
  if (cfg.ombroElevado) add('Ombro', 3, 'Ombros elevados: baixe a bancada ou suba a cadeira; apoie os antebraços.');
  if (ab != null) {
    if (ab < 60) add('Antebraço', 2, 'Cotovelo muito aberto (alcance longo): aproxime a peça ou a ferramenta do corpo.');
    else if (ab > 100) add('Antebraço', 2, 'Cotovelo muito fechado: baixe o ponto de trabalho ou afaste um pouco a peça (cotovelo perto de 90°).');
  }
  if (av.porLado && Object.values(av.porLado).some((x) => x && x.rula.seg.antebraco === 3)) {
    add('Antebraço', 2, 'Mão cruzando a linha do corpo ou muito para o lado: reposicione a peça à frente.');
  }
  if (pu != null && Math.abs(pu) > 15) add('Punho', 3, 'Punho dobrado: mantenha-o reto — troque a pega, use ferramenta de cabo angulado ou mude a orientação da peça.');
  else if (g.punhoDesvio != null && Math.abs(g.punhoDesvio) > LIM_DESVIO) add('Punho', 2, 'Punho desviado para o lado: alinhe mão e antebraço (cabo angulado, peça girada).');
  if (cfg.punhoTorcao >= 2) add('Punho', 2, 'Punho torcido no limite: evite girar a mão até o fim do movimento (aparafusadora em vez de chave manual).');
  const j = g.joelho;
  if (!av.sentado && j != null && j > 60) add('Pernas', 3, 'Agachado ou joelhos muito dobrados: eleve o trabalho ou ofereça banco baixo/joelheira para tarefas no chão.');
  else if (!av.sentado && j != null && j >= 30) add('Pernas', 2, 'Joelhos dobrados: suba a peça para trabalhar em pé com as pernas retas.');
  if (av.bilateral === false && !av.sentado) add('Pernas', 2, 'Peso num pé só: ofereça apoio para os pés e espaço para ficar com os dois pés no chão.');
  if (cfg.cargaRula >= 2 || cfg.cargaReba >= 1) add('Carga', 3, 'Carga relevante: reduza o peso por pega, use talha, carrinho ou dispositivo de auxílio.');
  if (cfg.pega >= 2) add('Pega', 2, 'Pega ruim: adicione alças ou empunhaduras, ou use caixas com recortes para as mãos.');
  if (av.estatica || cfg.repetitiva) add('Atividade', 2, 'Postura mantida ou repetitiva: faça pausas curtas e alterne tarefas a cada poucos minutos.');
  if (cfg.instavel) add('Atividade', 2, 'Base instável ou mudanças bruscas: organize o piso e o fluxo para movimentos mais suaves.');
  return out.sort((a, b) => b.nivel - a.nivel);
}

// ------------------------------------------------------------ rastreio

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy, u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0 ? inter / u : 0;
}
export { iou as iouCaixas };

/**
 * Rastreio simples por caixa: associação gulosa por IoU (ou centro perto)
 * com as trilhas vistas nos últimos `validadeMs`. IDs crescem e não se
 * reaproveitam na sessão.
 */
export class Rastreador {
  constructor(validadeMs = 3000) { this.validade = validadeMs; this.zerar(); }
  zerar() { this.trilhas = []; this.prox = 1; }
  /** caixas: [{x1,y1,x2,y2}] em 0..1; devolve um ID por caixa. */
  atualizar(caixas, t) {
    this.trilhas = this.trilhas.filter((tr) => t - tr.t <= this.validade);
    const pares = [];
    caixas.forEach((c, i) => this.trilhas.forEach((tr, j) => {
      const s = iou(c, tr.caixa);
      const cx = (c.x1 + c.x2) / 2 - (tr.caixa.x1 + tr.caixa.x2) / 2, cy = (c.y1 + c.y2) / 2 - (tr.caixa.y1 + tr.caixa.y2) / 2;
      const diag = Math.hypot(c.x2 - c.x1, c.y2 - c.y1);
      const perto = Math.hypot(cx, cy) < 0.35 * diag;
      if (s > 0.2 || perto) pares.push({ i, j, s: s + (perto ? 0.1 : 0) });
    }));
    pares.sort((a, b) => b.s - a.s);
    const ids = new Array(caixas.length).fill(null), usadas = new Set();
    for (const p of pares) {
      if (ids[p.i] != null || usadas.has(p.j)) continue;
      ids[p.i] = this.trilhas[p.j].id; usadas.add(p.j);
      this.trilhas[p.j].caixa = caixas[p.i]; this.trilhas[p.j].t = t;
    }
    caixas.forEach((c, i) => {
      if (ids[i] != null) return;
      const id = this.prox++;
      ids[i] = id;
      this.trilhas.push({ id, caixa: c, t });
    });
    return ids;
  }
}

// -------------------------------------------------------------- sessão

/**
 * Sessão no tempo, por pessoa e por método: tempo em cada faixa de risco,
 * nota média, pico (com a postura do pior momento), série 1 Hz para a
 * linha do tempo, detecção de postura estática (> 1 min parada) e alertas
 * (nota na faixa ≥ limite por N segundos seguidos). t em ms.
 */
export class Sessao {
  constructor() { this.zerar(); }
  zerar() {
    this.pessoas = new Map();
    this.alertas = [];
    this.t0 = null;
    this.tUlt = null;
  }
  pessoa(id) {
    let p = this.pessoas.get(id);
    if (!p) {
      p = {
        id, primeiro: null, ultimo: null, tempo: 0,
        faixas: { RULA: [0, 0, 0, 0, 0], REBA: [0, 0, 0, 0, 0] },
        soma: { RULA: 0, REBA: 0 },
        pico: { RULA: null, REBA: null },
        serie: [], hist: [], alerta: { desde: null, ativo: false, metodo: null, n: 0 }, ultimaAval: null,
      };
      this.pessoas.set(id, p);
    }
    return p;
  }
  /** Postura parada há ≥ 60 s (braço, tronco e pescoço variando ≤ 15°)? */
  estatica(id, t) {
    const p = this.pessoas.get(id);
    if (!p || p.hist.length < 10) return false;
    const h = p.hist.filter((x) => t - x.t <= 60000);
    if (!h.length || t - h[0].t < 55000) return false;
    // sem buracos grandes (pessoa sumiu e voltou)
    for (let i = 1; i < h.length; i++) if (h[i].t - h[i - 1].t > 5000) return false;
    for (const k of ['braco', 'tronco', 'pescoco']) {
      const v = h.map((x) => x[k]).filter((x) => x != null);
      if (v.length < h.length * 0.6) return false;
      if (Math.max(...v) - Math.min(...v) > 15) return false;
    }
    return true;
  }
  /**
   * Registra uma avaliação. o = { metodo, alertaFaixa, alertaSeg }.
   * Devolve { novoPico: {RULA?, REBA?}, alerta: objeto do alerta novo | null }.
   */
  registrar(id, t, av, o = {}) {
    if (!av || !av.ok) return { novoPico: {}, alerta: null };
    if (this.t0 == null) this.t0 = t;
    this.tUlt = t;
    const p = this.pessoa(id);
    const dt = p.ultimo != null && t - p.ultimo < 1500 ? Math.min(500, t - p.ultimo) / 1000 : 0;
    if (p.primeiro == null) p.primeiro = t;
    p.ultimo = t;
    p.tempo += dt;
    p.ultimaAval = av;
    const notas = { RULA: av.rula.final, REBA: av.reba.final };
    const novoPico = {};
    for (const M of ['RULA', 'REBA']) {
      const f = faixaDe(M, notas[M]);
      p.faixas[M][f] += dt;
      p.soma[M] += notas[M] * dt;
      const pk = p.pico[M];
      const forca = M === 'RULA' ? av.rula.A + av.rula.B : av.reba.A + av.reba.B;
      if (!pk || notas[M] > pk.nota || (notas[M] === pk.nota && forca > pk.forca + 1)) {
        p.pico[M] = { nota: notas[M], forca, t, aval: av, thumb: pk ? pk.thumb : null, pose: pk ? pk.pose : null, fresco: true };
        novoPico[M] = true;
      }
    }
    // histórico para a postura estática (2 Hz)
    const ul = p.hist[p.hist.length - 1];
    if (!ul || t - ul.t >= 500) {
      p.hist.push({ t, braco: av.ang.braco, tronco: av.ang.tronco, pescoco: av.ang.pescoco });
      while (p.hist.length && t - p.hist[0].t > 65000) p.hist.shift();
    }
    // série 1 Hz
    const us = p.serie[p.serie.length - 1];
    if (!us || t - us.t >= 1000) {
      const a = av.ang;
      p.serie.push({ t, rula: notas.RULA, reba: notas.REBA, lado: av.lado, vista: av.vista,
        tronco: a.tronco, pescoco: a.pescoco, braco: a.braco, antebraco: a.antebraco, punho: a.punho, joelho: a.joelho });
      if (p.serie.length > 7200) p.serie.shift();
    }
    // alerta
    const M = o.metodo === 'REBA' ? 'REBA' : 'RULA';
    const lim = o.alertaFaixa ?? 3, seg = o.alertaSeg ?? 10;
    const A = p.alerta;
    if (A.metodo !== M) { A.metodo = M; A.desde = null; A.ativo = false; }
    let alerta = null;
    if (faixaDe(M, notas[M]) >= lim) {
      if (A.desde == null) A.desde = t;
      if (!A.ativo && t - A.desde >= seg * 1000) {
        A.ativo = true; A.n++;
        alerta = { id, metodo: M, nota: notas[M], inicio: A.desde, t, fim: null, pico: notas[M] };
        this.alertas.push(alerta);
        if (this.alertas.length > 500) this.alertas.shift();
        A.atual = alerta;
      } else if (A.ativo && A.atual) A.atual.pico = Math.max(A.atual.pico, notas[M]);
    } else {
      if (A.ativo && A.atual) A.atual.fim = t;
      A.desde = null; A.ativo = false; A.atual = null;
    }
    return { novoPico, alerta };
  }
  /** Marca o fim de ausência: pessoa que sumiu encerra o alerta em curso. */
  ausentes(idsPresentes, t) {
    for (const p of this.pessoas.values()) {
      if (idsPresentes.has(p.id)) continue;
      if (p.alerta.ativo && p.alerta.atual && t - p.ultimo > 1500) {
        p.alerta.atual.fim = p.ultimo; p.alerta.ativo = false; p.alerta.desde = null; p.alerta.atual = null;
      } else if (!p.alerta.ativo && t - p.ultimo > 1500) p.alerta.desde = null;
    }
  }
  /** Resumo de uma pessoa num método: % por faixa, média, pico. */
  resumo(id, metodo = 'RULA') {
    const p = this.pessoas.get(id);
    if (!p) return null;
    const M = metodo === 'REBA' ? 'REBA' : 'RULA';
    const tot = p.faixas[M].reduce((a, b) => a + b, 0);
    return {
      id, tempo: p.tempo, pct: p.faixas[M].map((x) => (tot > 0 ? (100 * x) / tot : 0)),
      media: tot > 0 ? p.soma[M] / tot : null, pico: p.pico[M], alertas: p.alerta.n,
      alertaAtivo: p.alerta.metodo === M && p.alerta.ativo,
    };
  }
  ids() { return [...this.pessoas.keys()]; }
}

// ------------------------------------------------------------ formatos

export function num(x, casas = 0) {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = casas > 0 ? x.toFixed(casas).replace('.', ',') : String(Math.round(x));
  return s.replace(/^-/, '−').replace(/^−0(,0+)?$/, '0$1');
}
export const NOMES_SEG = {
  braco: 'Braço', antebraco: 'Antebraço', punho: 'Punho', torcao: 'Torção do punho',
  pescoco: 'Pescoço', tronco: 'Tronco', pernas: 'Pernas',
};
export const TEXTO_CARGA_RULA = ['< 2 kg intermitente', '2–10 kg intermitente', '2–10 kg estática ou repetida', '> 10 kg, repetida ou com choques'];
export const TEXTO_CARGA_REBA = ['< 5 kg', '5–10 kg', '> 10 kg'];
export const TEXTO_PEGA = ['boa (alça adequada)', 'razoável', 'ruim', 'inaceitável (sem pega, insegura)'];
export const TEXTO_PUNHO_SEM_MAOS = ['', 'neutro', 'até 15°', 'mais de 15°'];
