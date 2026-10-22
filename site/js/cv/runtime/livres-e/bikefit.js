/**
 * cv/runtime/livres-e/bikefit.js — biomecânica do ciclista, só matemática.
 *
 * Nada aqui toca em DOM, canvas ou modelo: recebe pontos da pose (BlazePose,
 * 33 landmarks MediaPipe, em PIXELS do quadro) e devolve ângulos, ciclos de
 * pedalada, estatística e recomendações. É o que os testes no node exercitam.
 *
 * ============================ CONVENÇÕES ============================
 *
 * Todos os ângulos de articulação são INTERNOS, em graus, 0..180, medidos
 * no plano da imagem (2D). 180° = segmento reto (perna esticada).
 *
 *   joelho     quadril–JOELHO–tornozelo   PMI = máximo do ciclo (extensão),
 *                                         PMS = mínimo (flexão máxima).
 *                                         140–150° no PMI = 30–40° de flexão.
 *   quadril    ombro–QUADRIL–joelho       fechamento mínimo, perto do PMS.
 *   tronco     inclinação quadril→ombro em relação à HORIZONTAL
 *              (0° = deitado, 90° = em pé).
 *   ombro      quadril–OMBRO–cotovelo     (tronco × braço).
 *   cotovelo   ombro–COTOVELO–punho       180° = braço travado.
 *   tornozelo  joelho–TORNOZELO–ponta do pé; "ankling" = máx − mín no ciclo.
 *   KOPS       com o pé mais à frente (3 h), distância horizontal entre o
 *              centro do joelho e o eixo do pedal estimado (≈ metatarsos),
 *              em % do comprimento da perna (coxa + canela). Positivo =
 *              joelho À FRENTE do pedal.
 *
 * Faixas: compiladas de referências públicas de bike fit dinâmico (Holmes
 * et al. 1994 — 25–35° de flexão estática, que em vídeo dinâmico vira
 * ~30–40°; Bini et al. 2011, revisão sobre altura de selim; Ferrer-Roca
 * et al. 2012, J Strength Cond Res — 30–40° dinâmico; e as faixas usuais
 * de Retul / Specialized BG Fit / guias de fitters para tronco, ombro e
 * cotovelo por modalidade). São SUGESTÕES de partida, não diagnóstico.
 */

// -------------------------------------------------------------- landmarks

/** Índices MediaPipe por lado anatômico (e = esquerdo, d = direito). */
export const LM = {
  nariz: 0,
  ombro: { e: 11, d: 12 }, cotovelo: { e: 13, d: 14 }, punho: { e: 15, d: 16 },
  quadril: { e: 23, d: 24 }, joelho: { e: 25, d: 26 }, tornozelo: { e: 27, d: 28 },
  calcanhar: { e: 29, d: 30 }, pe: { e: 31, d: 32 },
};
const PARTES = ['ombro', 'cotovelo', 'punho', 'quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'];

/** {ombro: 11, cotovelo: 13, ...} para o lado 'e' ou 'd'. */
export function indicesLado(l) {
  const o = {};
  for (const k of PARTES) o[k] = LM[k][l];
  return o;
}

/**
 * Lado do MODELO a usar. `escolha` é anatômico ('automático' | 'esquerdo' |
 * 'direito'). Com a câmera espelhada, o lado anatômico real aparece trocado
 * para o modelo — daí a inversão.
 */
export function ladoModelo(escolha, espelhada, pts, anterior, minVis = 0.5) {
  if (escolha === 'esquerdo' || escolha === 'direito') {
    const l = escolha === 'esquerdo' ? 'e' : 'd';
    return espelhada ? (l === 'e' ? 'd' : 'e') : l;
  }
  return ladoMaisVisivel(pts, anterior, minVis);
}

/** Soma da visibilidade dos pontos da perna/tronco de cada lado, com histerese. */
export function ladoMaisVisivel(pts, anterior, minVis = 0.5) {
  const nota = (l) => ['ombro', 'cotovelo', 'quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe']
    .reduce((s, k) => s + vis(pts[LM[k][l]]), 0);
  const e = nota('e'), d = nota('d');
  if (anterior && Math.abs(e - d) < 0.35) return anterior;
  void minVis;
  return e >= d ? 'e' : 'd';
}

/**
 * Vista LATERAL, lado automático: os rótulos esquerda/direita do BlazePose
 * trocam de um quadro para o outro com o ciclista de perfil, mas a
 * visibilidade anda junto com os pontos — o membro do lado da câmera é o
 * mais visível. Então, a cada quadro, a perna mais visível (quadril, joelho,
 * tornozelo, calcanhar, pé) e o braço mais visível (ombro, cotovelo, punho)
 * são escolhidos SEPARADAMENTE. O pé seguido é sempre o físico do lado da
 * câmera, e o nome do lado vem da direção do ciclista (ladoPelaDirecao).
 */
export function indicesPerto(P, ant = null) {
  const soma = (ids) => ids.reduce((s, i) => s + vis(P[i]), 0);
  // histerese: só muda de membro com folga clara, para o pé seguido não saltar
  const escolher = (e, d, antes, folga) => {
    if (antes && Math.abs(e - d) < folga) return antes;
    return e >= d ? 'e' : 'd';
  };
  const perna = escolher(soma([25, 27, 29, 31]), soma([26, 28, 30, 32]), ant && ant.perna, 0.4);
  const braco = escolher(soma([11, 13, 15]), soma([12, 14, 16]), ant && ant.braco, 0.3);
  const I = { perna, braco };
  for (const k of ['ombro', 'cotovelo', 'punho']) I[k] = LM[k][braco];
  for (const k of ['quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe']) I[k] = LM[k][perna];
  return I;
}

/** Ciclista olhando para +x mostra o lado DIREITO à câmera; o espelho inverte. */
export function ladoPelaDirecao(dir, espelhada) {
  const direito = dir > 0;
  return (espelhada ? !direito : direito) ? 'direito' : 'esquerdo';
}

/** Rótulo anatômico do lado do modelo, desfazendo o espelho. */
export function nomeLado(l, espelhada) {
  const anat = espelhada ? (l === 'e' ? 'd' : 'e') : l;
  return anat === 'e' ? 'esquerdo' : 'direito';
}

const vis = (p) => (p && Number.isFinite(p.v) ? p.v : 0);

// -------------------------------------------------------------- geometria

export function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Ângulo interno em B (graus, 0..180) entre BA e BC. */
export function angulo3(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
  if (!(nu > 1e-9 && nv > 1e-9)) return null;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Inclinação do segmento quadril→ombro sobre a horizontal (0..90, y para baixo).
 * Ombro na altura do quadril ou abaixo dele não existe num ciclista sentado:
 * é pose errada, e sai `null` em vez de um tronco negativo.
 */
export function inclinacaoTronco(quadril, ombro) {
  const dx = Math.abs(ombro.x - quadril.x), dy = quadril.y - ombro.y;
  if (!(Math.hypot(dx, dy) > 1e-9) || !(dy > 0)) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** +1 se o ciclista olha para +x (direita da imagem), −1 se para −x. */
export function direcaoFrente(P, I) {
  const q = P[I.quadril], o = P[I.ombro], n = P[LM.nariz];
  if (q && o) {
    const tr = dist(q, o);
    if (Math.abs(o.x - q.x) > 0.12 * tr) return Math.sign(o.x - q.x);
  }
  if (n && o && Math.abs(n.x - o.x) > 1) return Math.sign(n.x - o.x);
  const t = P[I.tornozelo], pe = P[I.pe];
  if (t && pe && Math.abs(pe.x - t.x) > 1) return Math.sign(pe.x - t.x);
  return 1;
}

/**
 * Eixo do pedal estimado: sob as cabeças dos metatarsos, ~70% do calcanhar
 * até a ponta do pé (o landmark "foot index" do BlazePose é a ponta).
 */
export function pontoPedal(P, I, minVis = 0.3) {
  const c = P[I.calcanhar], pe = P[I.pe], t = P[I.tornozelo];
  if (pe && vis(pe) >= minVis && c && vis(c) >= minVis) {
    return { x: c.x + 0.7 * (pe.x - c.x), y: c.y + 0.7 * (pe.y - c.y) };
  }
  if (pe && t && vis(pe) >= minVis) return { x: t.x + 0.6 * (pe.x - t.x), y: t.y + 0.6 * (pe.y - t.y) };
  return t ? { x: t.x, y: t.y } : null;
}

/**
 * Todas as medidas da vista LATERAL para um lado.
 * P: pontos em pixels {x, y, v}; I: indicesLado(l). Ângulo sem pontos
 * suficientemente visíveis sai `null` (melhor nada que um número inventado).
 */
export function medirLateral(P, I, minVis = 0.5) {
  const ok = (...ks) => ks.every((k) => vis(P[I[k]]) >= minVis);
  const g = (k) => P[I[k]];
  const a = {
    joelho: ok('quadril', 'joelho', 'tornozelo') ? angulo3(g('quadril'), g('joelho'), g('tornozelo')) : null,
    quadril: ok('ombro', 'quadril', 'joelho') ? angulo3(g('ombro'), g('quadril'), g('joelho')) : null,
    tronco: ok('ombro', 'quadril') ? inclinacaoTronco(g('quadril'), g('ombro')) : null,
    ombro: ok('quadril', 'ombro', 'cotovelo') ? angulo3(g('quadril'), g('ombro'), g('cotovelo')) : null,
    cotovelo: ok('ombro', 'cotovelo', 'punho') ? angulo3(g('ombro'), g('cotovelo'), g('punho')) : null,
    tornozelo: ok('joelho', 'tornozelo', 'pe') ? angulo3(g('joelho'), g('tornozelo'), g('pe')) : null,
  };
  const coxa = ok('quadril', 'joelho') ? dist(g('quadril'), g('joelho')) : null;
  const canela = ok('joelho', 'tornozelo') ? dist(g('joelho'), g('tornozelo')) : null;
  const pedal = ok('tornozelo') ? pontoPedal(P, I, minVis * 0.6) : null;
  return {
    ang: a, coxa, canela, perna: coxa && canela ? coxa + canela : null,
    pedal, joelhoPt: ok('joelho') ? g('joelho') : null,
    peY: ok('tornozelo') ? g('tornozelo').y : null,
    dir: direcaoFrente(P, I),
  };
}

/** KOPS em % da perna: (joelho.x − pedal.x)·dir / perna. Positivo = joelho à frente. */
export function kopsPct(joelho, pedal, dir, perna) {
  if (!joelho || !pedal || !(perna > 0)) return null;
  return ((joelho.x - pedal.x) * dir / perna) * 100;
}

/**
 * Vista FRONTAL: desvio lateral do joelho em relação à linha quadril–tornozelo
 * da mesma perna, em % do comprimento da PERNA. Positivo = joelho para DENTRO
 * (em direção à linha média do corpo).
 *
 * `pernaRef` (px) é um comprimento ESTÁVEL da perna (Sessao.pernaPx, o
 * percentil 90 da sessão). Visto de frente, quadril–tornozelo encolhe quase
 * à metade perto do PMS (a coxa aponta para a câmera); dividir pela distância
 * do próprio quadro inflaria o % justamente onde o desvio costuma ser maior.
 * Sem referência, cai na distância do quadro.
 */
export function desvioJoelho(quadril, joelho, tornozelo, meioX, pernaRef = 0) {
  const dy = tornozelo.y - quadril.y;
  const L0 = dist(quadril, tornozelo);
  if (!(L0 > 1e-6) || Math.abs(dy) < 1e-6) return null;
  const L = pernaRef > L0 ? pernaRef : L0;
  const k = (joelho.y - quadril.y) / dy;
  const xLinha = quadril.x + k * (tornozelo.x - quadril.x);
  const dentro = Math.sign(meioX - quadril.x) || 1;
  return ((joelho.x - xLinha) * dentro / L) * 100;
}

/** Inclinação (graus, + = lado direito da IMAGEM mais baixo) de uma linha entre dois pontos. */
export function inclinacaoLinha(a, b) {
  const [p, q] = a.x <= b.x ? [a, b] : [b, a];
  return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
}

export function medirFrontal(P, minVis = 0.5, pernaRef = 0) {
  const v = (i) => vis(P[i]) >= minVis;
  const out = { e: null, d: null, pelve: null, ombros: null, peY: { e: null, d: null } };
  const qE = P[LM.quadril.e], qD = P[LM.quadril.d];
  if (!(v(LM.quadril.e) && v(LM.quadril.d))) return out;
  const meioX = (qE.x + qD.x) / 2;
  for (const l of ['e', 'd']) {
    const [q, j, t] = [LM.quadril[l], LM.joelho[l], LM.tornozelo[l]];
    if (v(q) && v(j) && v(t)) out[l] = desvioJoelho(P[q], P[j], P[t], meioX, pernaRef);
    if (v(t)) out.peY[l] = P[t].y;
  }
  out.pelve = inclinacaoLinha(qE, qD);
  if (v(LM.ombro.e) && v(LM.ombro.d)) out.ombros = inclinacaoLinha(P[LM.ombro.e], P[LM.ombro.d]);
  return out;
}

// -------------------------------------------------------------- qualidade

/**
 * Avisos de qualidade da medição. W, H em pixels; `l` = lado ('e'/'d') ou
 * os índices já escolhidos (indicesPerto). Devolve lista de textos
 * curtos; vazia = tudo certo.
 */
export function qualidade(P, vista, l, W, H, minVis = 0.5) {
  const av = [];
  if (!P || !P.length) return ['Nenhum ciclista encontrado no quadro.'];
  const I = typeof l === 'string' ? indicesLado(l) : l;
  const chaves = vista === 'frontal'
    ? [LM.ombro.e, LM.ombro.d, LM.quadril.e, LM.quadril.d, LM.joelho.e, LM.joelho.d, LM.tornozelo.e, LM.tornozelo.d]
    : [I.ombro, I.cotovelo, I.punho, I.quadril, I.joelho, I.tornozelo, I.pe];
  const vm = chaves.reduce((s, i) => s + vis(P[i]), 0) / chaves.length;
  if (vm < minVis) av.push(`Pontos pouco visíveis (${Math.round(vm * 100)}%): melhore a luz, use roupa justa e contraste com o fundo.`);

  const m = 0.01;
  // a cabeça entra no corte: cabeça fora do quadro tira a referência do
  // tronco e o modelo passa a "inventar" o resto (visto nos testes)
  const fora = [...chaves, LM.nariz].some((i) => P[i] && (P[i].x < m * W || P[i].x > (1 - m) * W || P[i].y < m * H || P[i].y > (1 - m) * H));
  if (fora) av.push('Ciclista cortado: enquadre o corpo inteiro, da cabeça ao pedal.');

  const oE = P[LM.ombro.e], oD = P[LM.ombro.d], qE = P[LM.quadril.e], qD = P[LM.quadril.d];
  if (oE && oD && qE && qD) {
    const tronco = (dist(oE, qE) + dist(oD, qD)) / 2;
    const larg = (Math.abs(oE.x - oD.x) + Math.abs(qE.x - qD.x)) / 2;
    const r = tronco > 0 ? larg / tronco : 0;
    if (vista !== 'frontal' && r > 0.38) av.push('A câmera não parece estar de lado: posicione-a perpendicular à bicicleta.');
    if (vista === 'frontal' && r < 0.3) av.push('A câmera não parece estar de frente: alinhe-a com o eixo da bicicleta.');
  }
  const q = P[I.quadril], t = P[I.tornozelo];
  if (q && t && dist(q, t) < 0.18 * H) av.push('Ciclista pequeno no quadro: aproxime a câmera (~3 m) ou aumente a resolução.');
  return av;
}

// -------------------------------------------------------------- perfis

/**
 * Faixas recomendadas por modalidade. [mín, máx] em graus (KOPS em % da
 * perna). `info: true` = indicativo, não gera recomendação de ajuste.
 */
export const PERFIS = {
  'Estrada': {
    joelhoPMI: [140, 150], joelhoPMS: [65, 80], quadrilMin: [45, 60], tronco: [35, 50],
    ombro: [80, 95], cotovelo: [150, 165], tornozeloPMI: [105, 130], ankling: [10, 30], kops: [-7, 1],
  },
  'Mountain bike': {
    joelhoPMI: [140, 150], joelhoPMS: [65, 80], quadrilMin: [50, 68], tronco: [45, 60],
    ombro: [75, 95], cotovelo: [145, 165], tornozeloPMI: [105, 130], ankling: [10, 30], kops: [-9, 0],
  },
  'Contrarrelógio/Triathlon': {
    joelhoPMI: [140, 150], joelhoPMS: [65, 80], quadrilMin: [40, 55], tronco: [15, 30],
    ombro: [80, 100], cotovelo: [85, 110], tornozeloPMI: [105, 130], ankling: [10, 30], kops: [-3, 5],
  },
  'Urbano/Conforto': {
    joelhoPMI: [140, 155], joelhoPMS: [70, 85], quadrilMin: [60, 90], tronco: [55, 80],
    ombro: [55, 85], cotovelo: [150, 175], tornozeloPMI: [105, 130], ankling: [10, 30], kops: [-12, 0],
  },
};
export const NOMES_PERFIS = Object.keys(PERFIS);

/** Desvio frontal do joelho (%): |x| ≤ 5 ok, ≤ 8 atenção. Assimetria ≤ 3 ok. */
export const FRONTAL = { desvio: [-5, 5], assimetria: 3, pelve: 3 };

/** Métricas da tabela: chave do ciclo, nome, faixa do perfil, unidade. */
export const METRICAS = [
  { k: 'joelhoMax', nome: 'Joelho no PMI', faixa: 'joelhoPMI', un: '°', vivo: 'joelho' },
  // o ângulo AO VIVO do joelho aparece uma vez só (na linha do PMI)
  { k: 'joelhoMin', nome: 'Joelho no PMS', faixa: 'joelhoPMS', un: '°', vivo: null },
  { k: 'quadrilMin', nome: 'Quadril (fech.)', faixa: 'quadrilMin', un: '°', vivo: 'quadril' },
  { k: 'troncoMed', nome: 'Tronco', faixa: 'tronco', un: '°', vivo: 'tronco' },
  { k: 'ombroMed', nome: 'Ombro', faixa: 'ombro', un: '°', vivo: 'ombro' },
  { k: 'cotoveloMed', nome: 'Cotovelo', faixa: 'cotovelo', un: '°', vivo: 'cotovelo' },
  { k: 'tornozeloPMI', nome: 'Tornozelo PMI', faixa: 'tornozeloPMI', un: '°', vivo: 'tornozelo' },
  { k: 'ankling', nome: 'Ankling', faixa: 'ankling', un: '°', vivo: null },
  { k: 'kops', nome: 'KOPS', faixa: 'kops', un: '%', vivo: null },
];

/** 'ok' dentro da faixa, 'perto' até `margem` fora, 'fora' além. */
export function status(v, faixa, margem = 5) {
  if (v == null || !Number.isFinite(v) || !faixa) return 'sem';
  const [a, b] = faixa;
  if (v >= a && v <= b) return 'ok';
  const d = v < a ? a - v : v - b;
  return d <= margem ? 'perto' : 'fora';
}
export const COR_STATUS = { ok: '#4ade80', perto: '#FFD84D', fora: '#f87171', sem: '#94a3b8' };

// -------------------------------------------------------------- números (pt-BR)

/** Número com vírgula decimal e o sinal de menos tipográfico. */
export function num(x, casas = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  const s = casas > 0 ? x.toFixed(casas).replace('.', ',') : String(Math.round(x));
  return s.replace(/^-/, '−').replace(/^−0(,0+)?$/, '0$1');
}
/** Faixa alvo legível: "140–150", "−7 a 1". */
export function faixaTxt(a) {
  if (!a) return '—';
  return a[0] < 0 || a[1] < 0 ? `${num(a[0], 0)} a ${num(a[1], 0)}` : `${a[0]}–${a[1]}`;
}
/** "Joelho no PMI 140–150° = 30–40° de flexão", conforme o perfil. */
export function textoJoelhoPMI(perfilNome, faixas = null) {
  const [a, b] = (faixas || PERFIS[perfilNome] || PERFIS.Estrada).joelhoPMI;
  return `Joelho no PMI ${a}–${b}° = ${180 - b}–${180 - a}° de flexão`;
}

// -------------------------------------------------------------- estatística

export function estatistica(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  const n = v.length;
  if (!n) return { n: 0, media: null, dp: null, min: null, max: null };
  const media = v.reduce((s, x) => s + x, 0) / n;
  const dp = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1)) : 0;
  return { n, media, dp, min: Math.min(...v), max: Math.max(...v), mediana: mediana(v) };
}

export function mediana(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// -------------------------------------------------------------- ciclo

/**
 * Detector de PMI/PMS pela trajetória VERTICAL do pé (y cresce para baixo:
 * PMI = máximo de y, PMS = mínimo). A amostragem é irregular (a inferência
 * tem ritmo próprio), então:
 *   - suavização exponencial com constante de TEMPO (não de amostras);
 *   - histerese proporcional à amplitude recente: um extremo só é confirmado
 *     quando o sinal volta `histerese × amplitude` na direção oposta;
 *   - amplitude mínima (em px) para não contar tremor de pé parado.
 * O evento devolve a amostra do extremo (`ref`), não a da confirmação.
 */
export class DetectorCiclo {
  constructor({ tauMs = 50, histerese = 0.3, janelaMs = 2500, minPeriodoMs = 260 } = {}) {
    Object.assign(this, { tauMs, histerese, janelaMs, minPeriodoMs });
    this.zerar();
  }
  zerar() {
    this.ys = null; this.tUlt = null; this.hist = []; this.modo = 'desce'; this.cand = null; this.cru = null;
    this.ultimo = { PMI: -Infinity, PMS: -Infinity };
  }
  /** y em px; minAmp em px. Devolve [] ou [{tipo, t, y, ref}]. */
  add(t, y, ref, minAmp = 4) {
    if (!Number.isFinite(y)) return [];
    if (this.ys == null || this.tUlt == null || t - this.tUlt > 1000) {
      this.ys = y; this.hist = []; this.cand = null; this.cru = null; this.modo = 'desce';
    } else {
      const dt = Math.max(0, t - this.tUlt);
      const a = 1 - Math.exp(-dt / this.tauMs);
      this.ys += a * (y - this.ys);
    }
    this.tUlt = t;
    const ys = this.ys;
    this.hist.push({ t, y: ys });
    while (this.hist.length && this.hist[0].t < t - this.janelaMs) this.hist.shift();
    let lo = Infinity, hi = -Infinity;
    for (const h of this.hist) { if (h.y < lo) lo = h.y; if (h.y > hi) hi = h.y; }
    const amp = hi - lo;
    this.amp = amp;
    const h = Math.max(minAmp * 0.5, this.histerese * amp);
    const ev = [];
    // a decisão usa o sinal suavizado; o extremo reportado é a amostra CRUA
    // de maior/menor y no meio-ciclo — a suavização atrasa ~τ, e a 90 rpm
    // 50 ms de atraso seriam 27° de pedivela.
    if (!this.cand) { this.cand = { t, y: ys, ref }; this.cru = { t, y, ref }; return ev; }
    if (this.modo === 'desce') {                   // procurando o PMI (y máximo)
      if (y >= this.cru.y) this.cru = { t, y, ref };
      if (ys >= this.cand.y) this.cand = { t, y: ys, ref };
      else if (ys < this.cand.y - h) {
        if (amp >= minAmp && this.cru.t - this.ultimo.PMI >= this.minPeriodoMs) {
          ev.push({ tipo: 'PMI', ...this.cru }); this.ultimo.PMI = this.cru.t;
        }
        this.modo = 'sobe'; this.cand = { t, y: ys, ref }; this.cru = { t, y, ref };
      }
    } else {                                       // procurando o PMS (y mínimo)
      if (y <= this.cru.y) this.cru = { t, y, ref };
      if (ys <= this.cand.y) this.cand = { t, y: ys, ref };
      else if (ys > this.cand.y + h) {
        if (amp >= minAmp && this.cru.t - this.ultimo.PMS >= this.minPeriodoMs) {
          ev.push({ tipo: 'PMS', ...this.cru }); this.ultimo.PMS = this.cru.t;
        }
        this.modo = 'desce'; this.cand = { t, y: ys, ref }; this.cru = { t, y, ref };
      }
    }
    return ev;
  }
}

/**
 * Cadência (rpm) dos últimos `n` períodos válidos (ms). A mediana só
 * descarta os discrepantes (fora de 0,7–1,4× dela); o valor é a MÉDIA dos que
 * sobram — cada período herda o jitter da amostragem nas duas pontas, e a
 * média de períodos consecutivos cancela os termos do meio.
 */
export function cadencia(periodos, n = 6) {
  const v = periodos.filter((p) => p >= 300 && p <= 3000).slice(-n);
  const m = mediana(v);
  if (!m) return null;
  const bons = v.filter((p) => p >= 0.7 * m && p <= 1.4 * m);
  return 60000 / (bons.reduce((s, p) => s + p, 0) / bons.length);
}

/** Abaixo disto (amostras de pose por segundo) PMI/PMS e cadência não se sustentam. */
export const TAXA_MIN_HZ = 10;
/**
 * Movimento mínimo da imagem (percentil 95 da diferença entre quadros,
 * 0..255, numa miniatura em cinza) para uma pedalada valer. Foto parada dá 0;
 * ruído de câmera parada fica abaixo de ~1; perna pedalando passa de 10.
 */
export const MOV_MIN = 2.5;
/**
 * Luz mínima do quadro (miniatura em cinza): brilho médio e percentil 95.
 * Fotos e vídeos de teste com luz normal: média 75–175, p95 ≥ 154; o vídeo
 * de rolo a 40% do brilho: 36/101; a 20%: 18/50.
 */
export const LUZ_MIN = { media: 45, p95: 110 };
/** Variação de joelho mínima numa pedalada real (vista lateral): PMS ~75° → PMI ~145°. */
export const JOELHO_AMP_MIN = 30;

/**
 * Extremo de uma série (t, y) por ajuste QUADRÁTICO de mínimos quadrados
 * numa janela de ±15% do período (no mínimo ±1,6 intervalo de amostragem)
 * em volta da amostra extrema. O máximo cru de amostras ruidosas puxa o PMI
 * para cima e o PMS para baixo (σ = 6° a 25 Hz: +2,4 a +4,1°), e a média
 * móvel achata o pico quando a amostragem é baixa (14 Hz: −6°). Na
 * simulação (joelho real por cinemática, PMI 142° e 156°, 60–110 rpm) o
 * ajuste ficou entre −0,9° e +2,0° a 14–25 Hz. Com menos de 4 amostras na
 * janela, vale a crua.
 */
export function extremoAjustado(serie, centroIdx, periodo, sinal) {
  const c = serie[centroIdx];
  if (!c) return null;
  const dts = [];
  for (let i = 1; i < serie.length; i++) dts.push(serie[i].t - serie[i - 1].t);
  const w = Math.max(0.15 * periodo, 1.6 * (mediana(dts) || 0));
  const sel = serie.filter((a) => Math.abs(a.t - c.t) <= w);
  if (sel.length < 4) return c.y;
  const t0 = c.t;
  const S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  for (const a of sel) {
    const x = (a.t - t0) / 100;
    let p = 1;
    for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) T[k] += p * a.y; p *= x; }
  }
  const A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
    + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const D = det(A);
  if (!(Math.abs(D) > 1e-9)) return c.y;
  const k = [0, 1, 2].map((j) => det(A.map((r, i) => r.map((v, col) => (col === j ? T[i] : v)))) / D);
  const lo = (Math.min(...sel.map((a) => a.t)) - t0) / 100, hi = (Math.max(...sel.map((a) => a.t)) - t0) / 100;
  const xs = [lo, hi];
  if (Math.abs(k[2]) > 1e-12) { const v = -k[1] / (2 * k[2]); if (v > lo && v < hi) xs.push(v); }
  const vals = xs.map((x) => k[0] + k[1] * x + k[2] * x * x);
  const r = sinal > 0 ? Math.max(...vals) : Math.min(...vals);
  // um ajuste que foge muito das amostras é ruído, não pico
  const ys = sel.map((a) => a.y);
  return r > Math.max(...ys) + 8 || r < Math.min(...ys) - 8 ? c.y : r;
}

/**
 * Sessão de análise: recebe uma amostra por inferência e fecha um CICLO a
 * cada PMI (de um PMI ao seguinte). Guarda os extremos de cada ângulo por
 * ciclo, o KOPS com o pé mais à frente e as amostras do PMI/PMS ("congeladas").
 *
 * amostra = { t, ang: {joelho, quadril, tronco, ombro, cotovelo, tornozelo},
 *             peY, pedalFrente (pedal.x·dir), kops, perna, coxa, canela,
 *             frontal, vista, mov, nAvisos, extra }
 *
 * Um ciclo fechado só vira PEDALADA se:
 *   - não houver buraco na amostragem maior que 30% do período (o PMI ou o
 *     PMS pode ter caído no buraco — ex.: o detector rodando);
 *   - for coerente: imagem em movimento (`mov`, quando o operador mede) e,
 *     na vista lateral, o joelho variando ≥ 30° (pose "pulando" numa foto
 *     parada faz o pé subir e descer sem o joelho acompanhar);
 *   - o período for plausível contra a mediana recente (0,6–1,7×). Se 3
 *     períodos seguidos "implausíveis" concordarem entre si (±15%), é uma
 *     MUDANÇA real de cadência: eles viram a nova referência e contam.
 */
export class Sessao {
  constructor() { this.zerar(); }
  zerar() {
    this.det = new DetectorCiclo();
    this.buf = [];
    this.ciclos = [];
    this.periodos = [];
    this.pendentes = [];
    this.ultPMI = null;
    this.tUltAceito = null;
    this.tPrev = null;
    this.tempos = [];
    this.medidas = [];
    this.congelado = { PMI: null, PMS: null };
    this.congelados = [];
    this.registro = [];
    this.t0 = null;
    this.pedaladas = 0;
    this.lacunas = 0;
    this.descartes = 0;
    this.pernas = [];
  }
  /** Comprimento de perna robusto (percentil 90 das últimas amostras). */
  pernaPx() {
    const v = this.pernas.slice().sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.9))] : null;
  }
  /** Amostras de pose por segundo nos últimos ~4 s (null = poucas amostras). */
  taxaHz() {
    const ts = this.tempos;
    if (ts.length < 6) return null;
    const span = ts[ts.length - 1] - ts[0];
    return span > 0 ? ((ts.length - 1) * 1000) / span : null;
  }
  /**
   * Qualidade da medição na sessão: taxa de amostragem, estabilidade da pose
   * (coxa e canela em 2D quase não mudam de comprimento numa câmera de lado;
   * se variam muito, o modelo está inventando pontos) e a fração recente de
   * quadros com aviso. Devolve { taxa, cvCoxa, cvCanela, fracAvisos, avisos[], indicativo }
   * — `indicativo` (texto ou null) rebaixa as recomendações.
   */
  estadoMedicao() {
    const taxa = this.taxaHz();
    const lat = this.medidas.filter((m) => m.vista !== 'frontal');
    const cv = (k) => {
      const v = lat.map((m) => m[k]).filter((x) => x > 0);
      if (v.length < 15) return null;
      const s = estatistica(v);
      return s.media > 0 ? s.dp / s.media : null;
    };
    const cvCoxa = cv('coxa'), cvCanela = cv('canela');
    const fracAvisos = this.medidas.length >= 10 ? this.medidas.filter((m) => m.nAvisos > 0).length / this.medidas.length : 0;
    const avisos = [];
    let indicativo = null;
    if (taxa != null && taxa < TAXA_MIN_HZ) {
      avisos.push(`Amostragem baixa (${num(taxa)} poses/s, mínimo ${TAXA_MIN_HZ}): cadência e PMI/PMS não são confiáveis — feche outros programas ou use um aparelho mais rápido.`);
    }
    const inst = Math.max(cvCoxa || 0, cvCanela || 0);
    if (inst > 0.15) {
      avisos.push(`Pose instável (coxa/canela variam ${Math.round(inst * 100)}%): pouca luz, pés escondidos ou perna errada — os ângulos podem estar deslocados.`);
      indicativo = 'pose instável';
    }
    // luz: mediana do brilho médio e do percentil 95 (0..255) do quadro
    const luzes = this.medidas.map((m) => m.luz).filter(Boolean);
    const brilho = luzes.length >= 5 ? mediana(luzes.map((l) => l.media)) : null;
    const claro = luzes.length >= 5 ? mediana(luzes.map((l) => l.p95)) : null;
    if (brilho != null && (brilho < LUZ_MIN.media || claro < LUZ_MIN.p95)) {
      avisos.push(`Pouca luz (brilho ${Math.round(brilho)}/255): ilumine o ciclista — com imagem escura a pose desloca os ângulos (nos testes, o joelho no PMI caiu ~17°).`);
      indicativo = indicativo || 'pouca luz';
    }
    if (fracAvisos > 0.3) indicativo = indicativo || 'medição com avisos';
    return { taxa, cvCoxa, cvCanela, fracAvisos, brilho, avisos, indicativo, amostragemBaixa: taxa != null && taxa < TAXA_MIN_HZ };
  }
  adicionar(s, { gravar = true, maxRegistro = 30000 } = {}) {
    if (this.t0 == null) this.t0 = s.t;
    // buraco longo: o detector recomeça, e o período que o atravessa não conta
    if (this.tPrev != null && s.t - this.tPrev > 1000) { this.ultPMI = null; this.buf = []; }
    s.gapAntes = this.tPrev != null ? s.t - this.tPrev : 0;
    this.tPrev = s.t;
    this.tempos.push(s.t);
    while (this.tempos.length > 2 && this.tempos[0] < s.t - 4000) this.tempos.shift();
    this.medidas.push({ vista: s.vista, coxa: s.coxa, canela: s.canela, nAvisos: s.nAvisos || 0, luz: s.luz || null });
    if (this.medidas.length > 60) this.medidas.shift();
    if (s.perna > 0) { this.pernas.push(s.perna); if (this.pernas.length > 90) this.pernas.shift(); }
    this.buf.push(s);
    if (gravar && this.registro.length < maxRegistro) {
      const { pose, extra, ...leve } = s;          // o registro não guarda a pose inteira
      void pose; void extra;
      this.registro.push(leve);
    }
    const perna = this.pernaPx() || 0;
    // amplitude mínima: o pé sobe e desce 2× a pedivela (~34 cm) contra uma perna
    // de ~88 cm — 30–40% dela. 15% separa pedalada de tremor da pose.
    const ev = s.peY == null ? [] : this.det.add(s.t, s.peY, s, Math.max(4, 0.15 * perna));
    const fechados = [];
    for (const e of ev) {
      const amostra = e.ref;
      this.congelado[e.tipo] = { tipo: e.tipo, t: e.t, amostra };
      this.congelados.push(this.congelado[e.tipo]);
      if (this.congelados.length > 12) this.congelados.shift();
      if (e.tipo !== 'PMI') continue;
      if (this.ultPMI != null) fechados.push(this.fecharCiclo(this.ultPMI, e.t, gravar, this.gapPMI || 0));
      this.ultPMI = e.t;
      // o PMI que vem logo depois de um buraco pode ter caído DENTRO dele
      this.gapPMI = (e.ref && e.ref.gapAntes) || 0;
      // guarda um pouco antes do PMI: o ajuste do pico usa vizinhos dos dois lados
      this.buf = this.buf.filter((x) => x.t > e.t - 400);
    }
    if (this.buf.length > 600) this.buf.splice(0, this.buf.length - 600);
    return { eventos: ev, ciclos: fechados };
  }
  /** Fecha o ciclo (ini, fim] e decide se é pedalada, lacuna ou descarte. */
  fecharCiclo(ini, fim, gravar, gapIni = 0) {
    const periodo = fim - ini;
    const amostras = this.buf.filter((x) => x.t > ini && x.t <= fim);
    const c = resumirCiclo(amostras, periodo, this.buf);
    c.inicio = ini - this.t0; c.fim = fim - this.t0;
    // maior buraco de amostragem dentro do ciclo
    let gap = gapIni, ant = ini;
    for (const a of amostras) { gap = Math.max(gap, a.t - ant); ant = a.t; }
    gap = Math.max(gap, fim - ant);
    // ... e logo depois do PMI final (ele pode ter caído no buraco que vem a seguir)
    const depois = this.buf.find((x) => x.t > fim);
    if (depois) gap = Math.max(gap, depois.t - fim);
    c.buracoMs = Math.round(gap);
    // coerência: imagem parada ou joelho que não acompanha o pé não é pedalada
    const movs = amostras.map((a) => a.mov).filter((x) => Number.isFinite(x));
    const movMed = movs.length >= 3 ? mediana(movs) : null;
    const lateral = !amostras.length || amostras[0].vista !== 'frontal';
    const jAmp = c.joelhoMax != null && c.joelhoMin != null ? c.joelhoMax - c.joelhoMin : null;
    let motivo = null;
    if (gap > 0.3 * periodo) motivo = 'buraco';
    else if (movMed != null && movMed < MOV_MIN) motivo = 'parado';
    else if (lateral && jAmp != null && jAmp < JOELHO_AMP_MIN) motivo = 'incoerente';
    if (motivo) {
      c.valido = false; c.motivo = motivo;
      if (motivo === 'buraco') this.lacunas++; else this.descartes++;
      return c;
    }
    const aceitar = (cc) => {
      cc.valido = true;
      this.periodos.push(cc.periodo);
      if (this.periodos.length > 40) this.periodos.shift();
      this.tUltAceito = Math.max(this.tUltAceito || 0, this.t0 + cc.fim);
      if (gravar) { cc.n = this.pedaladas + 1; this.ciclos.push(cc); this.pedaladas++; }
    };
    // Um PMI perdido vira um "ciclo" de duas voltas e derruba a cadência pela
    // metade; um falso PMI faz o contrário. Contra a mediana recente, isso é
    // lacuna, não pedalada — até que 3 seguidos concordem (mudança de ritmo).
    const ref = this.periodos.length ? mediana(this.periodos.slice(-20)) : null;
    const plausivel = periodo >= 300 && periodo <= 3000 && (!ref || (periodo <= 1.7 * ref && periodo >= 0.6 * ref));
    if (plausivel) { aceitar(c); this.pendentes = []; return c; }
    c.valido = false; c.motivo = 'periodo';
    this.lacunas++;
    if (periodo >= 300 && periodo <= 3000) {
      this.pendentes.push(c);
      if (this.pendentes.length > 3) this.pendentes.shift();
      if (this.pendentes.length === 3) {
        const m = mediana(this.pendentes.map((x) => x.periodo));
        if (this.pendentes.every((x) => Math.abs(x.periodo - m) <= 0.15 * m)) {
          this.periodos = [];
          for (const x of this.pendentes) { aceitar(x); x.motivo = 'novo ritmo'; }
          this.lacunas -= 3;
          this.pendentes = [];
        }
      }
    }
    return c;
  }
  /**
   * Cadência atual. `tAgora` (padrão: a última amostra) serve para zerar quando
   * o ciclista para: sem pedalada aceita há mais de max(2,5 períodos, 3 s),
   * não há cadência. Com amostragem baixa, também não.
   */
  cadencia(tAgora = this.tPrev) {
    if (this.tUltAceito == null || !this.periodos.length) return null;
    const med = mediana(this.periodos.slice(-6)) || 0;
    if (tAgora != null && tAgora - this.tUltAceito > Math.max(2.5 * med, 3000)) return null;
    const taxa = this.taxaHz();
    if (taxa != null && taxa < TAXA_MIN_HZ) return null;
    return cadencia(this.periodos);
  }
  /** Estatística das últimas n pedaladas para cada métrica do ciclo. */
  resumo(n = 10) {
    const ult = this.ciclos.slice(-n);
    const out = {};
    for (const k of CHAVES_CICLO) out[k] = estatistica(ult.map((c) => c[k]));
    out.cadencia = estatistica(ult.map((c) => c.cadencia));
    out.n = ult.length;
    return out;
  }
}

export const CHAVES_CICLO = ['joelhoMax', 'joelhoMin', 'quadrilMin', 'troncoMed', 'ombroMed', 'cotoveloMed',
  'tornozeloPMI', 'tornozeloMin', 'tornozeloMax', 'ankling', 'kops', 'desvioE', 'desvioD', 'pelveMed'];

/**
 * Extremos e médias de um ciclo a partir das suas amostras. `vizinhas` (as
 * amostras em volta, incluindo antes e depois do ciclo) alimentam o ajuste
 * do pico do joelho, que costuma cair na borda do ciclo (o PMI).
 */
export function resumirCiclo(amostras, periodo, vizinhas = amostras) {
  const col = (k) => amostras.map((a) => a.ang && a.ang[k]).filter((x) => x != null && Number.isFinite(x));
  const max = (v) => (v.length ? Math.max(...v) : null);
  const min = (v) => (v.length ? Math.min(...v) : null);
  const med = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
  const jo = col('joelho'), to = col('tornozelo');
  // joelho no PMI/PMS: ajuste quadrático em volta da amostra extrema do ciclo
  const serie = vizinhas.filter((a) => a.ang && a.ang.joelho != null && Number.isFinite(a.ang.joelho))
    .map((a) => ({ t: a.t, y: a.ang.joelho }));
  const noCiclo = new Set(amostras.map((a) => a.t));
  let iMax = -1, iMin = -1;
  serie.forEach((p, i) => {
    if (!noCiclo.has(p.t)) return;
    if (iMax < 0 || p.y > serie[iMax].y) iMax = i;
    if (iMin < 0 || p.y < serie[iMin].y) iMin = i;
  });
  const joelhoMax = iMax >= 0 && periodo > 0 ? extremoAjustado(serie, iMax, periodo, 1) : max(jo);
  const joelhoMin = iMin >= 0 && periodo > 0 ? extremoAjustado(serie, iMin, periodo, -1) : min(jo);
  // tornozelo no instante de maior extensão do joelho
  let tornozeloPMI = null, best = -Infinity;
  for (const a of amostras) {
    if (a.ang && a.ang.joelho != null && a.ang.tornozelo != null && a.ang.joelho > best) {
      best = a.ang.joelho; tornozeloPMI = a.ang.tornozelo;
    }
  }
  // KOPS com o pedal à frente (3 h): média das amostras com o pedal até 10% da
  // excursão horizontal do ponto mais à frente (≈ ±25° de pedivela em volta
  // das 3 h). Uma amostra só oscilava tanto quanto a largura da faixa alvo.
  let kops = null;
  const pf = amostras.filter((a) => a.pedalFrente != null && a.kops != null && Number.isFinite(a.kops));
  if (pf.length) {
    const xs = pf.map((a) => a.pedalFrente);
    const hi = Math.max(...xs), lo = Math.min(...xs);
    const perto = pf.filter((a) => a.pedalFrente >= hi - 0.1 * (hi - lo));
    kops = med(perto.map((a) => a.kops));
  }
  // vista frontal: maior desvio (em módulo, com sinal) de cada joelho
  const maiorDesvio = (l) => {
    let m = null;
    for (const a of amostras) {
      const d = a.frontal && a.frontal[l];
      if (d != null && Number.isFinite(d) && (m == null || Math.abs(d) > Math.abs(m))) m = d;
    }
    return m;
  };
  const pelve = amostras.map((a) => a.frontal && a.frontal.pelve).filter((x) => x != null && Number.isFinite(x));
  return {
    periodo, cadencia: periodo > 0 ? 60000 / periodo : null, amostras: amostras.length,
    joelhoMax, joelhoMin, quadrilMin: min(col('quadril')),
    troncoMed: med(col('tronco')), ombroMed: med(col('ombro')), cotoveloMed: med(col('cotovelo')),
    tornozeloPMI, tornozeloMin: min(to), tornozeloMax: max(to),
    ankling: to.length ? max(to) - min(to) : null,
    kops, desvioE: maiorDesvio('e'), desvioD: maiorDesvio('d'), pelveMed: med(pelve),
  };
}

// -------------------------------------------------------------- calibração

/** Perna (trocânter→maléolo ≈ coxa 0,245 H + canela 0,246 H; Winter, 2009). */
export const PERNA_SOBRE_ALTURA = 0.491;
export function cmPorPx(perna, { alturaCm = 0, pernaCm = 0 } = {}) {
  const ref = pernaCm > 0 ? pernaCm : alturaCm > 0 ? alturaCm * PERNA_SOBRE_ALTURA : 0;
  return ref > 0 && perna > 0 ? ref / perna : null;
}

/**
 * Quanto o selim precisa mudar (mesma unidade de coxa/canela) para o joelho
 * ir de `atual` a `alvo` graus no PMI. Lei dos cossenos: D² = T² + S² −
 * 2TS·cos θ (D = quadril→tornozelo), dD/dθ = T·S·sen θ / D. Positivo = subir.
 */
export function deltaSelim(coxa, canela, atual, alvo) {
  if (!(coxa > 0 && canela > 0) || atual == null || alvo == null) return null;
  const D = (th) => Math.sqrt(coxa * coxa + canela * canela - 2 * coxa * canela * Math.cos((th * Math.PI) / 180));
  return D(alvo) - D(atual);
}

// -------------------------------------------------------------- recomendações

const f0 = (x) => (x == null ? '—' : num(x, 0));
const fx = faixaTxt;

/**
 * Recomendações em linguagem simples a partir das MÉDIAS das últimas
 * pedaladas. `geo` = { coxa, canela, cmPx } (px e cm/px, opcionais).
 * Devolve [{ area, nivel: 'ok'|'perto'|'fora'|'sem', texto }] — prioridade:
 * altura do selim, depois recuo, depois cockpit.
 *
 * `opc.indicativo` (texto): a medição tem problema (pose instável, avisos
 * frequentes) — tudo vira "indicativo", sem cor de ok/fora, com o motivo na
 * frente. `opc.amostragemBaixa`: não há recomendação por pedalada.
 * `opc.faixas`: alvos personalizados do atleta (canal.alvosSessao), no
 * formato de PERFIS[x]; sem ele, as faixas da modalidade.
 */
export function recomendacoes(res, perfilNome, geo = {}, vista = 'lateral', opc = {}) {
  if (opc.amostragemBaixa) {
    return [{ area: 'Medição', nivel: 'fora', texto: 'Amostragem de pose baixa demais para medir pedaladas: as recomendações ficam suspensas até o aparelho analisar ao menos 10 poses por segundo.' }];
  }
  const out = vista === 'frontal' ? recomendacoesFrontal(res) : recomendacoesLateral(res, perfilNome, geo, opc.faixas);
  if (!opc.indicativo || (out.length === 1 && out[0].area === 'Geral')) return out;
  return [
    { area: 'Medição', nivel: 'fora', texto: `Resultados só indicativos (${opc.indicativo}): corrija a filmagem antes de mexer na bicicleta.` },
    ...out.map((r) => ({ ...r, nivel: 'sem', texto: `(indicativo) ${r.texto}` })),
  ];
}

function recomendacoesLateral(res, perfilNome, geo, faixas = null) {
  const P = faixas || PERFIS[perfilNome] || PERFIS.Estrada;
  const out = [];
  const m = (k) => (res && res[k] && res[k].n ? res[k].media : null);

  const jMax = m('joelhoMax');
  if (jMax != null) {
    const st = status(jMax, P.joelhoPMI, 3);
    if (st === 'ok') {
      out.push({ area: 'Altura do selim', nivel: 'ok', texto: `Joelho no PMI ${f0(jMax)}° — dentro da faixa (${fx(P.joelhoPMI)}°). Altura do selim adequada.` });
    } else {
      const baixo = jMax < P.joelhoPMI[0];
      const alvo = baixo ? P.joelhoPMI[0] + 2 : P.joelhoPMI[1] - 2;
      const d = deltaSelim(geo.coxa, geo.canela, jMax, alvo);
      let quanto = '';
      if (d != null && geo.cmPx) quanto = ` Sugestão: ${baixo ? 'subir' : 'baixar'} ~${Math.max(1, Math.round(Math.abs(d * geo.cmPx * 10)))} mm, em passos de 3–5 mm, e medir de novo.`;
      else if (d != null && geo.coxa) quanto = ` Ordem de grandeza: ~${num(Math.abs(d) / (geo.coxa + geo.canela) * 100)}% do comprimento da perna (calibre a altura para ver em mm).`;
      out.push({
        area: 'Altura do selim', nivel: st,
        texto: `Joelho no PMI ${f0(jMax)}° (alvo ${fx(P.joelhoPMI)}°): selim provavelmente ${baixo ? 'BAIXO' : 'ALTO'}.${quanto}`,
      });
    }
  }
  // KOPS: mediana das pedaladas, e só sugere mexer no recuo quando o intervalo
  // (±2 erros-padrão) inteiro cai fora da faixa — o KOPS por pedalada é ruidoso.
  const ks = res && res.kops && res.kops.n ? res.kops : null;
  if (ks) {
    const k = ks.mediana != null ? ks.mediana : ks.media;
    const meia = ks.n > 1 ? (2 * ks.dp) / Math.sqrt(ks.n) : Infinity;
    const [a, b] = P.kops;
    const cm = geo.cmPx && geo.coxa ? ` (${num(Math.abs(k / 100 * (geo.coxa + geo.canela) * geo.cmPx))} cm)` : '';
    const pos = k >= 0 ? 'à frente do' : 'atrás do';
    const base = `Joelho ${num(Math.abs(k))}%${cm} ${pos} pedal na posição de 3 h`;
    if (k >= a && k <= b) {
      out.push({ area: 'Recuo do selim', nivel: 'ok', texto: `${base} — dentro da faixa (${fx(P.kops)}%).` });
    } else if (k - meia > b || k + meia < a) {
      out.push({
        area: 'Recuo do selim', nivel: status(k, P.kops, 2),
        texto: `${base} (alvo ${fx(P.kops)}%): ` +
          (k > b ? 'considere RECUAR o selim alguns mm.' : 'considere AVANÇAR o selim alguns mm.') +
          ' Ajuste a altura antes do recuo — um muda o outro.',
      });
    } else {
      out.push({
        area: 'Recuo do selim', nivel: 'perto',
        texto: `${base} (alvo ${fx(P.kops)}%), mas a variação entre pedaladas (±${num(meia)}%) não permite afirmar que está fora. Meça mais pedaladas antes de mexer no recuo.`,
      });
    }
  }
  const q = m('quadrilMin');
  if (q != null && status(q, P.quadrilMin, 3) !== 'ok') {
    out.push(q < P.quadrilMin[0]
      ? { area: 'Quadril', nivel: status(q, P.quadrilMin, 3), texto: `Quadril muito fechado no topo: ${f0(q)}° (alvo ${fx(P.quadrilMin)}°). Guidão mais ALTO ou mais PERTO (mesa menor/mais inclinada) ou pedivela mais curto.` }
      : { area: 'Quadril', nivel: status(q, P.quadrilMin, 3), texto: `Quadril aberto no topo: ${f0(q)}° (alvo ${fx(P.quadrilMin)}°). Para esta modalidade, dá para baixar ou afastar o guidão, se for confortável.` });
  }
  const t = m('troncoMed');
  if (t != null && status(t, P.tronco, 3) !== 'ok') {
    out.push(t > P.tronco[1]
      ? { area: 'Tronco', nivel: status(t, P.tronco, 3), texto: `Tronco a ${f0(t)}° da horizontal (alvo ${fx(P.tronco)}°): mais em pé que o típico. Guidão pode ir mais BAIXO e/ou mais LONGE.` }
      : { area: 'Tronco', nivel: status(t, P.tronco, 3), texto: `Tronco a ${f0(t)}° da horizontal (alvo ${fx(P.tronco)}°): mais deitado que o típico. Guidão mais ALTO e/ou mais PERTO (espaçadores, mesa mais curta).` });
  }
  const o = m('ombroMed');
  if (o != null && status(o, P.ombro, 4) !== 'ok') {
    out.push(o > P.ombro[1]
      ? { area: 'Alcance', nivel: status(o, P.ombro, 4), texto: `Ombro ${f0(o)}° (alvo ${fx(P.ombro)}°): alcance LONGO. Aproxime o guidão (mesa mais curta) ou suba-o.` }
      : { area: 'Alcance', nivel: status(o, P.ombro, 4), texto: `Ombro ${f0(o)}° (alvo ${fx(P.ombro)}°): alcance CURTO. Guidão pode ir mais longe (mesa mais longa).` });
  }
  const c = m('cotoveloMed');
  if (c != null && status(c, P.cotovelo, 4) !== 'ok') {
    out.push(c > P.cotovelo[1]
      ? { area: 'Cotovelos', nivel: status(c, P.cotovelo, 4), texto: `Cotovelo ${f0(c)}° (alvo ${fx(P.cotovelo)}°): braços quase travados. Relaxe os cotovelos ou aproxime o guidão.` }
      : { area: 'Cotovelos', nivel: status(c, P.cotovelo, 4), texto: `Cotovelo ${f0(c)}° (alvo ${fx(P.cotovelo)}°): braços muito dobrados. O guidão pode estar perto ou baixo demais.` });
  }
  const a = m('ankling');
  if (a != null && a > P.ankling[1] + 5) {
    out.push({ area: 'Tornozelo', nivel: 'perto', texto: `Ankling de ${f0(a)}° no ciclo (típico ${fx(P.ankling)}°): pé "procurando" o pedal — costuma acompanhar selim alto. Confira a altura primeiro.` });
  }
  if (!out.length) out.push({ area: 'Geral', nivel: 'sem', texto: 'Pedale alguns ciclos com cadência constante para gerar recomendações.' });
  return out;
}

function recomendacoesFrontal(res) {
  const out = [];
  const m = (k) => (res && res[k] && res[k].n ? res[k].media : null);
  for (const [l, nome] of [['desvioE', 'esquerdo'], ['desvioD', 'direito']]) {
    const d = m(l);
    if (d == null) continue;
    const st = status(d, FRONTAL.desvio, 3);
    if (st === 'ok') out.push({ area: `Joelho ${nome}`, nivel: 'ok', texto: `Joelho ${nome} alinhado: desvio máx. ${num(Math.abs(d))}% da perna (até 5%).` });
    else out.push({
      area: `Joelho ${nome}`, nivel: st,
      texto: `Joelho ${nome} vai ${d > 0 ? 'para DENTRO' : 'para FORA'} ${num(Math.abs(d))}% da perna em relação à linha quadril–tornozelo. ` +
        'Verifique a posição do taquinho (rotação e lateral), calços/palmilha e a largura entre pedais (Q-factor).',
    });
  }
  const e = m('desvioE'), d = m('desvioD');
  if (e != null && d != null) {
    const as = Math.abs(e - d);
    out.push({ area: 'Simetria', nivel: as <= FRONTAL.assimetria ? 'ok' : as <= FRONTAL.assimetria + 3 ? 'perto' : 'fora',
      texto: `Diferença entre os joelhos: ${num(as)} pontos percentuais${as > FRONTAL.assimetria ? ' — assimetria; investigue diferença de perna, taquinhos ou mobilidade.' : '.'}` });
  }
  const p = m('pelveMed');
  if (p != null && Math.abs(p) > FRONTAL.pelve) {
    out.push({ area: 'Pelve', nivel: 'perto', texto: `Pelve inclinada ${num(Math.abs(p))}° em média: possível selim alto, quadril "balançando" ou diferença de perna.` });
  }
  if (!out.length) out.push({ area: 'Geral', nivel: 'sem', texto: 'Filme de frente, pedalando, para medir o alinhamento dos joelhos.' });
  return out;
}
