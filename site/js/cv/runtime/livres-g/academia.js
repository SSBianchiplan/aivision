/**
 * cv/runtime/livres-g/academia.js — academia (repetições e forma), só matemática.
 *
 * Nada aqui toca em DOM, canvas ou modelo: recebe os 33 pontos do BlazePose
 * (MediaPipe, em PIXELS do quadro, cada um com visibilidade `v` 0..1) e
 * devolve medidas, a classificação do exercício, as repetições, as séries e
 * as checagens de forma. É o que os testes no node exercitam.
 *
 * ============================ CONVENÇÕES ============================
 *
 * Ângulos de articulação INTERNOS, em graus, 0..180, no plano da imagem
 * (2D). 180° = segmento reto.
 *
 *   joelho      quadril–JOELHO–tornozelo   (em pé ≈ 170–180°)
 *   quadril     ombro–QUADRIL–joelho       (em pé ≈ 170°, fechado no fundo)
 *   cotovelo    ombro–COTOVELO–punho       (braço estendido ≈ 160–180°)
 *   abdução     quadril–OMBRO–punho        (braço ao lado do corpo ≈ 10–30°,
 *                                           acima da cabeça ≈ 150–180°)
 *   braço/tronco quadril–OMBRO–cotovelo    (cotovelo colado no tronco ≈ 0–20°)
 *   tronco      inclinação quadril→ombro em relação à VERTICAL
 *               (0° = em pé, 90° = deitado)
 *   linha do corpo  ombro–QUADRIL–tornozelo; o desvio do quadril é a
 *               distância do quadril à reta ombro→tornozelo em fração dessa
 *               reta, POSITIVO = quadril abaixo da reta (caindo), negativo =
 *               quadril alto.
 *
 * Uma REPETIÇÃO é um ciclo repouso → trabalho → repouso da articulação
 * principal (ver DetectorRep). O lado do repouso é do exercício:
 * agachamento começa em pé (ângulo ALTO), desenvolvimento começa com a
 * barra nos ombros (ângulo BAIXO) etc.
 *
 * Limiares: compilados de referências públicas de treino e biomecânica,
 * como faixas usuais — NSCA (Essentials of Strength Training, 4ª ed.,
 * técnica dos exercícios), Schoenfeld 2010 (J Strength Cond Res, agachamento:
 * profundidade e tronco), Escamilla 2001 (Med Sci Sports Exerc, joelho no
 * agachamento), Hewett et al. 2005 (valgo dinâmico), Farrokhi et al. 2008
 * (tronco no afundo), McGill (prancha e coluna neutra). Pose 2D estimada sem
 * marcadores: espere alguns graus de erro; são ALERTAS de treino, não
 * diagnóstico.
 */

// -------------------------------------------------------------- landmarks

/** Índices MediaPipe por lado do MODELO (e = esquerdo, d = direito). */
export const LM = {
  nariz: 0, orelha: { e: 7, d: 8 },
  ombro: { e: 11, d: 12 }, cotovelo: { e: 13, d: 14 }, punho: { e: 15, d: 16 },
  quadril: { e: 23, d: 24 }, joelho: { e: 25, d: 26 }, tornozelo: { e: 27, d: 28 },
  calcanhar: { e: 29, d: 30 }, pe: { e: 31, d: 32 },
};
const PARTES = ['orelha', 'ombro', 'cotovelo', 'punho', 'quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'];
export function indicesLado(l) {
  const o = {};
  for (const k of PARTES) o[k] = LM[k][l];
  return o;
}

// -------------------------------------------------------------- geometria

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const meio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Ângulo interno em B (graus, 0..180). */
export function ang3(a, b, c) {
  if (!a || !b || !c) return null;
  const ux = a.x - b.x, uy = a.y - b.y, vx = c.x - b.x, vy = c.y - b.y;
  const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
  if (!(nu > 1e-6 && nv > 1e-6)) return null;
  const c0 = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)));
  return (Math.acos(c0) * 180) / Math.PI;
}

/** Inclinação do vetor a→b em relação à vertical para CIMA (0° = b acima de a, 90° = deitado). */
export function inclinacaoVertical(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!(Math.hypot(dx, dy) > 1e-6)) return null;
  return (Math.atan2(Math.abs(dx), -dy) * 180) / Math.PI;
}

/**
 * Desvio do ponto H em relação à reta A→B, em fração de |AB|.
 * Positivo = H abaixo da reta (no sentido da gravidade, y da imagem para baixo).
 */
export function desvioDaReta(A, B, H) {
  if (!A || !B || !H) return null;
  const L = dist(A, B);
  if (!(L > 1e-6)) return null;
  let nx = -(B.y - A.y) / L, ny = (B.x - A.x) / L;
  if (ny < 0) { nx = -nx; ny = -ny; }
  return ((H.x - A.x) * nx + (H.y - A.y) * ny) / L;
}

// -------------------------------------------------------------- estatística

export function mediana(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export function quantil(xs, q) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const p = (v.length - 1) * q, i = Math.floor(p), f = p - i;
  return i + 1 < v.length ? v[i] * (1 - f) + v[i + 1] * f : v[i];
}
/** Amplitude robusta (p90 − p10). */
export function faixa(xs) {
  const a = quantil(xs, 0.1), b = quantil(xs, 0.9);
  return a == null ? null : b - a;
}
export function media(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}
/** Mediana móvel de 3 (tira picos de um quadro só da pose). */
export function mediana3(xs) {
  return xs.map((x, i) => {
    if (i === 0 || i === xs.length - 1) return x;
    return mediana([xs[i - 1], x, xs[i + 1]]);
  });
}

export function num(x, casas = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toFixed(casas).replace('.', ',');
}
/** 75 → "1:15"; 9.4 → "0:09". */
export function mmss(s) {
  if (s == null || !Number.isFinite(s)) return '—';
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

// -------------------------------------------------------------- medidas

const vis = (p) => (p && Number.isFinite(p.v) ? p.v : 0);

/**
 * Lado mais perto da câmera (na vista lateral o lado de trás é inventado
 * pelo modelo). Soma a visibilidade de ombro, cotovelo, punho, quadril,
 * joelho e tornozelo de cada lado, com histerese contra a troca a cada quadro.
 */
export function ladoPerto(P, anterior = null) {
  const nota = (l) => ['ombro', 'cotovelo', 'punho', 'quadril', 'joelho', 'tornozelo'].reduce((s, k) => s + vis(P[LM[k][l]]), 0);
  const e = nota('e'), d = nota('d');
  if (anterior && Math.abs(e - d) < 0.4) return anterior;
  return e >= d ? 'e' : 'd';
}

/**
 * Vista da câmera pela razão largura dos ombros / comprimento do tronco:
 * de frente (ou de costas) os ombros aparecem largos (≈ 0,7–0,9 do tronco);
 * de lado, quase sobrepostos (< 0,3). Entre os dois, 'oblíqua'.
 */
export const VISTA = { frontal: 0.5, lateral: 0.3 };
export function vistaDe(P, minVis = 0.5, anterior = null) {
  const oe = P[11], od = P[12], qe = P[23], qd = P[24];
  if (vis(oe) < minVis * 0.6 || vis(od) < minVis * 0.6 || vis(qe) < minVis * 0.6 || vis(qd) < minVis * 0.6) return null;
  const tronco = dist(meio(oe, od), meio(qe, qd));
  if (!(tronco > 1)) return null;
  const r = dist(oe, od) / tronco;
  // histerese: a vista só troca quando a razão passa do limiar com folga
  if (anterior === 'lateral' && r < VISTA.lateral + 0.06) return 'lateral';
  if (anterior === 'frontal' && r > VISTA.frontal - 0.06) return 'frontal';
  return r >= VISTA.frontal ? 'frontal' : r <= VISTA.lateral ? 'lateral' : 'obliqua';
}

/**
 * Todas as medidas de um quadro. `P` = 33 pontos {x, y, v} em px.
 * Devolve null para o que não está visível. `ant` = medidas do quadro
 * anterior (para a histerese do lado); `quadro` = {w, h} (pontos fora dele
 * contam como não visíveis).
 */
export function medir(P, minVis = 0.5, ant = null, quadro = null) {
  // fora do quadro (com 3% de folga) = não visível: o BlazePose "completa" as
  // pernas cortadas pela borda com pontos inventados e visibilidade ainda alta
  const dentro = (p) => !quadro || (p.x > -0.03 * quadro.w && p.x < 1.03 * quadro.w && p.y > -0.03 * quadro.h && p.y < 1.03 * quadro.h);
  const ok = (i) => P[i] && vis(P[i]) >= minVis && dentro(P[i]);
  const pt = (i) => (ok(i) ? P[i] : null);
  const L = {};
  for (const l of ['e', 'd']) {
    const I = indicesLado(l);
    const o = pt(I.ombro), c = pt(I.cotovelo), p = pt(I.punho), q = pt(I.quadril), j = pt(I.joelho),
      t = pt(I.tornozelo), ca = pt(I.calcanhar), pe = pt(I.pe), or = pt(I.orelha);
    L[l] = {
      ombro: o, cotovelo: c, punho: p, quadril: q, joelho: j, tornozelo: t, calcanhar: ca, pe, orelha: or,
      angJoelho: ang3(q, j, t),
      angQuadril: ang3(o, q, j),
      angCotovelo: ang3(o, c, p),
      abducao: ang3(q, o, p || c),
      bracoTronco: ang3(q, o, c),
      linha: ang3(o, q, t),
      desvioQuadril: desvioDaReta(o, t, q),
      pescoco: ang3(q, o, or),
      alturaQuadril: q && t ? t.y - q.y : null,
      coxa: q && j ? dist(q, j) : null,
      canela: j && t ? dist(j, t) : null,
      braco: o && c ? dist(o, c) : null,
    };
  }
  const lado = ladoPerto(P, ant && ant.lado);
  const perto = L[lado], longe = L[lado === 'e' ? 'd' : 'e'];
  const vista = vistaDe(P.map((p, i) => (ok(i) ? p : { ...p, v: 0 })), minVis, ant && ant.vista);
  const pernaDe = (s) => (s.coxa && s.canela ? s.coxa + s.canela : null);
  const perna = media([pernaDe(L.e), pernaDe(L.d)]) || null;
  const coxa = media([L.e.coxa, L.d.coxa]);
  const braco = media([L.e.braco, L.d.braco]);

  const oM = L.e.ombro && L.d.ombro ? meio(L.e.ombro, L.d.ombro) : (perto.ombro || longe.ombro);
  const qM = L.e.quadril && L.d.quadril ? meio(L.e.quadril, L.d.quadril) : (perto.quadril || longe.quadril);
  const troncoVert = inclinacaoVertical(qM, oM);
  const troncoLen = oM && qM ? dist(oM, qM) : null;

  // para onde a pessoa olha (vista lateral): ponta do pé à frente do calcanhar;
  // sem os pés, o nariz em relação aos ombros
  let dir = 0;
  if (perto.pe && perto.calcanhar && Math.abs(perto.pe.x - perto.calcanhar.x) > 2) dir = Math.sign(perto.pe.x - perto.calcanhar.x);
  else if (ok(0) && oM && Math.abs(P[0].x - oM.x) > 3) dir = Math.sign(P[0].x - oM.x);
  // tronco: + inclinado para a frente, − para trás (só com a direção)
  const troncoFrente = troncoVert != null && dir && oM && qM ? troncoVert * Math.sign((oM.x - qM.x) * dir || 1) : null;

  const sepX = (k) => (L.e[k] && L.d[k] ? Math.abs(L.e[k].x - L.d[k].x) : null);
  const sepJ = sepX('joelho'), sepT = sepX('tornozelo');
  const sepQ = sepX('quadril');
  const punhos = [L.e.punho, L.d.punho].filter(Boolean);
  const ombros = [L.e.ombro, L.d.ombro].filter(Boolean);
  const yOmbro = ombros.length ? media(ombros.map((o) => o.y)) : null;

  const m = {
    lado, vista, perna, coxa, braco, troncoVert, troncoFrente, troncoLen, dir,
    L,
    // lado perto (vista lateral)
    joelhoFrente: perto.joelho && perto.pe && dir && perna ? ((perto.joelho.x - perto.pe.x) * dir) / perna : null,
    quadrilAbaixo: null,
    // vista frontal
    razaoValgo: sepJ != null && sepT != null && sepT > 0.05 * (perna || 100) ? sepJ / sepT : null,
    sepPes: sepT != null && sepQ ? sepT / sepQ : null,
    sepPesPerna: sepT != null && perna ? sepT / perna : null,
    dyJoelhos: L.e.joelho && L.d.joelho && perna ? Math.abs(L.e.joelho.y - L.d.joelho.y) / perna : null,
    // inclinação da linha do quadril (graus, com sinal: + = quadril esquerdo do modelo mais baixo)
    inclPelve: L.e.quadril && L.d.quadril && sepQ > 2
      ? (Math.atan2(L.e.quadril.y - L.d.quadril.y, sepQ) * 180) / Math.PI : null,
    punhoAcimaOmbro: punhos.length && yOmbro != null ? punhos.filter((p) => p.y < yOmbro).length / punhos.length : null,
    punhoAcimaCabeca: punhos.length && ok(0) ? punhos.filter((p) => p.y < P[0].y).length / punhos.length : null,
    punhoPe: perto.punho && perto.pe && perto.tornozelo && perna
      ? Math.abs(perto.punho.x - (perto.pe.x + perto.tornozelo.x) / 2) / perna : null,
    ombroSobreCotovelo: perto.ombro && perto.cotovelo && perto.braco ? Math.abs(perto.ombro.x - perto.cotovelo.x) / perto.braco : null,
    difPunhoY: L.e.punho && L.d.punho && braco ? Math.abs(L.e.punho.y - L.d.punho.y) / braco : null,
  };
  // profundidade: quadril abaixo do joelho, em fração da coxa (+ = abaixo)
  {
    const qs = [L.e, L.d].filter((s) => s.quadril && s.joelho && s.coxa);
    const usar = vista === 'lateral' && perto.quadril && perto.joelho && perto.coxa ? [perto] : qs;
    if (usar.length) m.quadrilAbaixo = media(usar.map((s) => (s.quadril.y - s.joelho.y) / s.coxa));
  }
  return m;
}

/**
 * Valor de uma medida por lado: na vista lateral o lado perto (o de trás é
 * inventado); nas outras, a média dos dois lados visíveis.
 */
export function dosLados(m, k) {
  const e = m.L.e[k], d = m.L.d[k];
  if (m.vista === 'lateral') return m.L[m.lado][k] ?? (m.lado === 'e' ? d : e) ?? null;
  if (e != null && d != null) return (e + d) / 2;
  return e ?? d ?? null;
}
/** Diferença esquerda − direita (só com os dois lados vistos e fora da vista lateral). */
export function difLados(m, k) {
  if (m.vista === 'lateral') return null;
  const e = m.L.e[k], d = m.L.d[k];
  return e != null && d != null ? e - d : null;
}

/**
 * Joelho "equivalente" pela altura do quadril: de frente (ou na oblíqua) o
 * ângulo 2D do joelho quase não muda no agachamento — a coxa vem na direção
 * da câmera. A altura vertical quadril→tornozelo muda: com coxa ≈ canela e o
 * quadril sobre o tornozelo, altura = perna·sen(θ/2), então θ = 2·asen(altura/perna).
 * `pernaRef` = comprimento da perna em pé (px). `qual` = 'media' | 'min'.
 * No agachamento sintético (quadril para trás, canela inclinada) dá −6° a +5°
 * do ângulo real entre 120° e 55°.
 */
export function joelhoEquivalente(m, pernaRef, qual = 'media') {
  if (!(pernaRef > 0)) return null;
  const hs = [m.L.e.alturaQuadril, m.L.d.alturaQuadril].filter((h) => h != null);
  if (!hs.length) return null;
  const h = qual === 'min' ? Math.min(...hs) : hs.reduce((s, x) => s + x, 0) / hs.length;
  const r = Math.max(0, Math.min(1, h / pernaRef));
  return (2 * Math.asin(r) * 180) / Math.PI;
}
/** Joelho para o sinal: o ângulo de verdade de lado; de frente, o equivalente pela altura do quadril. */
function sinalJoelho(m, c, qual) {
  if (m.vista === 'lateral' || !(c && c.pernaRef)) {
    if (qual === 'min') {
      const e = m.L.e.angJoelho, d = m.L.d.angJoelho;
      return e != null && d != null ? Math.min(e, d) : (e ?? d ?? null);
    }
    return dosLados(m, 'angJoelho');
  }
  return joelhoEquivalente(m, c.pernaRef, qual);
}

// -------------------------------------------------------------- exercícios

/**
 * Cada exercício:
 *   sinal(m, c) ângulo da articulação principal (graus) neste quadro;
 *               c = { pernaRef } (perna em pé, px) para o joelho de frente
 *   repouso     'alto' | 'baixo' — onde o sinal fica entre as repetições
 *   primeira    fase de repouso→trabalho: 'exc' (excêntrica) | 'con'
 *   ampMin      variação mínima (graus) para contar como repetição
 *   alvo        { trabalho, repouso }: o ângulo a atingir no fundo (trabalho)
 *               e no fim (repouso); fora disso = amplitude incompleta
 *   checar(ctx) checagens de forma por repetição (ver checagens abaixo)
 */
export const EXERCICIOS = {
  agachamento: {
    nome: 'Agachamento', art: 'joelho', repouso: 'alto', primeira: 'exc', ampMin: 30,
    sinal: (m, c) => sinalJoelho(m, c, 'media'),
    alvo: { trabalho: 100, repouso: 155 },
    fases: ['descida', 'subida'],
  },
  flexao: {
    nome: 'Flexão de braço', art: 'cotovelo', repouso: 'alto', primeira: 'exc', ampMin: 30,
    sinal: (m) => dosLados(m, 'angCotovelo'),
    alvo: { trabalho: 100, repouso: 150 },
    fases: ['descida', 'subida'],
  },
  rosca: {
    nome: 'Rosca bíceps', art: 'cotovelo', repouso: 'alto', primeira: 'con', ampMin: 45,
    sinal: (m) => dosLados(m, 'angCotovelo'),
    alvo: { trabalho: 65, repouso: 140 },
    fases: ['subida', 'descida'],
  },
  desenvolvimento: {
    // como no terra, conta ao TRAVAR em cima (é onde os braços aparecem melhor;
    // embaixo, de costas, o modelo perde os cotovelos). Começando com a barra
    // nos ombros, a primeira subida já conta.
    nome: 'Desenvolvimento de ombro', art: 'cotovelo', repouso: 'alto', primeira: 'exc', ampMin: 40, subidaInicial: true,
    sinal: (m) => dosLados(m, 'angCotovelo'),
    alvo: { trabalho: 105, repouso: 155 },
    fases: ['descida', 'subida'],
  },
  terra: {
    // repouso em pé (travado): conta ao travar o quadril depois de cada descida.
    // Começando do chão (convencional) ou de pé (romeno), o total sai igual.
    nome: 'Levantamento terra', art: 'quadril', repouso: 'alto', primeira: 'exc', ampMin: 40, subidaInicial: true,
    sinal: (m) => dosLados(m, 'angQuadril'),
    alvo: { trabalho: null, repouso: 160 },
    fases: ['descida', 'subida'],
  },
  afundo: {
    nome: 'Afundo (lunge)', art: 'joelho da frente', repouso: 'alto', primeira: 'exc', ampMin: 30,
    // joelho da frente = o mais dobrado dos dois; de lado, o de trás é inventado,
    // mas no afundo os dois dobram ~90°: o mínimo dos dois continua sendo o da frente
    sinal: (m, c) => sinalJoelho(m, c, 'min'),
    // sem alvo em cima: na passada parada a perna de trás nunca estende de todo
    alvo: { trabalho: 105, repouso: null },
    fases: ['descida', 'subida'],
  },
  polichinelo: {
    nome: 'Polichinelo', art: 'ombro (abdução)', repouso: 'baixo', primeira: 'con', ampMin: 60, durMin: 350,
    sinal: (m) => dosLados(m, 'abducao'),
    alvo: { trabalho: 140, repouso: 50 },
    fases: ['abertura', 'fechamento'],
  },
  abdominal: {
    nome: 'Abdominal', art: 'quadril', repouso: 'alto', primeira: 'con', ampMin: 20,
    sinal: (m) => dosLados(m, 'angQuadril'),
    alvo: { trabalho: null, repouso: null },
    fases: ['subida', 'descida'],
  },
  prancha: {
    nome: 'Prancha', art: 'linha do corpo', isometrico: true,
    sinal: (m) => dosLados(m, 'linha'),
    fases: [],
  },
};
export const IDS = Object.keys(EXERCICIOS);
export const NOMES = IDS.map((k) => EXERCICIOS[k].nome);
export const OPCOES_EXERCICIO = ['automático', ...NOMES];
/** 'Agachamento' | 'agachamento' | 'automático' → id ou null (automático). */
export function idExercicio(v) {
  if (!v || v === 'automático' || v === 'auto') return null;
  if (EXERCICIOS[v]) return v;
  const k = IDS.find((i) => EXERCICIOS[i].nome === v);
  return k || null;
}

/** Tolerância: multiplica os limites no sentido de aceitar mais (rigorosa < 1 < tolerante). */
export const TOLERANCIAS = { rigorosa: 0.88, normal: 1, tolerante: 1.15 };

/**
 * Limites das checagens de forma (antes da tolerância). Os comentários dizem
 * de onde vem cada número.
 */
export const LIMITES = {
  // tronco no fundo do agachamento: 30–45° é o usual no agachamento livre
  // (Schoenfeld 2010); acima de ~50° a carga vai para a lombar.
  troncoAgachamento: 50,
  // afundo: tronco quase vertical; inclinação > ~25–30° muda a demanda para o quadril (Farrokhi 2008)
  troncoAfundo: 30,
  // joelho à frente da ponta do pé, em fração da perna (15% ≈ 13 cm). Passar um
  // pouco da ponta é normal no agachamento profundo; o alerta é para o exagero.
  joelhoFrente: 0.15,
  // valgo: (distância entre joelhos / entre tornozelos) no fundo, relativa à
  // mesma razão em pé. Joelho acompanhando a ponta do pé mantém ou abre a razão;
  // valgo dinâmico a fecha (Hewett 2005). Alerta abaixo de 80% da razão em pé.
  valgo: 0.8,
  // desvio do quadril da reta ombro–tornozelo (fração): caindo / alto
  quadrilCaindo: 0.06, quadrilAlto: 0.1,
  // rosca: braço abrindo/saindo do tronco no pico (graus entre braço e tronco)
  cotoveloRosca: 35,
  // rosca: balanço do tronco durante a repetição (variação, graus)
  balanco: 12,
  // desenvolvimento: tronco inclinando para trás (graus)
  troncoTras: 15,
  // terra: ângulo quadril–ombro–orelha (cabeça/ombros "caindo" à frente) e encurtamento do tronco
  pescocoTerra: 130, encurtamentoTronco: 0.12,
  // terra: punho (barra) longe do meio do pé, fração da perna
  barraLonge: 0.22,
  // assimetria entre os lados (graus) e inclinação da pelve (graus)
  assimetria: 15, pelve: 8,
  // polichinelo: pés abertos / largura do quadril no pico
  pesPolichinelo: 1.6,
  // abdominal: o tronco precisa subir pelo menos isto (graus) a partir de deitado
  subidaAbdominal: 30,
  // prancha: ombro longe da vertical do cotovelo (fração do braço)
  ombroCotovelo: 0.5,
};

/** Alerta de forma: cod (estável), msg (painel) e curta (texto grande no vídeo). */
const A = (cod, curta, msg) => ({ cod, curta, msg });

/**
 * Checagens de forma de uma repetição. `r` = resumo da repetição:
 *   { vMin, vMax, amp, ex, tol, vista, fundo (medidas no ponto de trabalho),
 *     topo (medidas no repouso), amostras: [{t, m, v}] }
 * Devolve [{cod, curta, msg}].
 */
export function checarForma(r) {
  const ex = EXERCICIOS[r.ex];
  const tol = r.tol || 1;
  const L = LIMITES;
  const al = [];
  const f = r.fundo || {}, ms = r.amostras.map((a) => a.m);
  const lateral = r.vista === 'lateral', frontal = r.vista === 'frontal';
  const serie = (k) => ms.map((m) => m[k]);
  const desdeLado = (k) => ms.map((m) => dosLados(m, k));

  // amplitude: fundo e fim da repetição (no sentido do exercício)
  const fundo = ex.repouso === 'alto' ? r.vMin : r.vMax;
  // fim: o repouso ANTES da repetição (o depois ainda não aconteceu quando ela fecha)
  const fim = r.vRepouso != null
    ? (ex.repouso === 'alto' ? Math.max(r.vMax, r.vRepouso) : Math.min(r.vMin, r.vRepouso))
    : (ex.repouso === 'alto' ? r.vMax : r.vMin);
  if (ex.alvo && ex.alvo.trabalho != null && fundo != null) {
    const alvo = ex.repouso === 'alto' ? ex.alvo.trabalho * tol : ex.alvo.trabalho / tol;
    const falta = ex.repouso === 'alto' ? fundo > alvo : fundo < alvo;
    // agachamento: o quadril abaixo do joelho também vale como profundidade
    const fundoOk = r.ex === 'agachamento' && f.quadrilAbaixo != null && f.quadrilAbaixo >= 0;
    if (falta && !fundoOk) {
      const msgs = {
        agachamento: A('amplitude', 'DESÇA MAIS', `Amplitude incompleta: joelho a ${Math.round(fundo)}° no fundo (alvo ≤ ${Math.round(alvo)}° ou quadril na linha do joelho).`),
        flexao: A('amplitude', 'DESÇA MAIS', `Amplitude incompleta: cotovelo a ${Math.round(fundo)}° no fundo (alvo ≤ ${Math.round(alvo)}°).`),
        rosca: A('amplitude', 'SUBA ATÉ O FIM', `Amplitude incompleta: cotovelo fechou só até ${Math.round(fundo)}° (alvo ≤ ${Math.round(alvo)}°).`),
        desenvolvimento: A('amplitude', 'DESÇA ATÉ O QUEIXO', `Amplitude curta embaixo: cotovelo a ${Math.round(fundo)}° (alvo ≤ ${Math.round(alvo)}°).`),
        afundo: A('amplitude', 'DESÇA MAIS', `Amplitude incompleta: joelho da frente a ${Math.round(fundo)}° (alvo ≤ ${Math.round(alvo)}°).`),
        polichinelo: A('amplitude', 'BRAÇOS ACIMA DA CABEÇA', `Amplitude incompleta: braços subiram só até ${Math.round(fundo)}° (alvo ≥ ${Math.round(alvo)}°).`),
      };
      if (msgs[r.ex]) al.push(msgs[r.ex]);
    }
  }
  if (ex.alvo && ex.alvo.repouso != null && fim != null) {
    const alvo = ex.repouso === 'alto' ? ex.alvo.repouso / tol : ex.alvo.repouso * tol;
    const falta = ex.repouso === 'alto' ? fim < alvo : fim > alvo;
    if (falta) {
      const msgs = {
        agachamento: A('extensao', 'ESTENDA NO ALTO', `Não estendeu no alto: joelho a ${Math.round(fim)}° (alvo ≥ ${Math.round(alvo)}°).`),
        flexao: A('extensao', 'ESTENDA OS BRAÇOS', `Não estendeu os braços em cima: cotovelo a ${Math.round(fim)}° (alvo ≥ ${Math.round(alvo)}°).`),
        rosca: A('extensao', 'ESTENDA EMBAIXO', `Não estendeu o braço embaixo: cotovelo a ${Math.round(fim)}° (alvo ≥ ${Math.round(alvo)}°).`),
        desenvolvimento: A('extensao', 'ESTENDA OS BRAÇOS', `Não estendeu em cima: cotovelo a ${Math.round(fim)}° (alvo ≥ ${Math.round(alvo)}°).`),
        terra: A('extensao', 'TRAVE O QUADRIL', `Extensão incompleta: quadril a ${Math.round(fim)}° no alto (alvo ≥ ${Math.round(alvo)}°).`),
        polichinelo: A('extensao', 'FECHE OS BRAÇOS', `Não fechou os braços: ${Math.round(fim)}° (alvo ≤ ${Math.round(alvo)}°).`),
      };
      if (msgs[r.ex]) al.push(msgs[r.ex]);
    }
  }
  if (r.retornoIncompleto && !al.some((a) => a.cod === 'extensao')) {
    al.push(A('extensao', 'VOLTE À POSIÇÃO INICIAL', 'A repetição não voltou à posição inicial antes da próxima.'));
  }

  // assimetria esquerda/direita (bilaterais, fora da vista lateral)
  const assim = (k, nome) => {
    const d = mediana(ms.map((m) => difLados(m, k)));
    if (d != null && Math.abs(d) > L.assimetria * tol) {
      const maisFechado = d < 0 ? 'esquerdo' : 'direito';
      al.push(A('assimetria', 'ASSIMETRIA E/D', `Assimetria esquerda/direita: ${nome} ${Math.round(Math.abs(d))}° de diferença (lado ${r.esp ? (maisFechado === 'esquerdo' ? 'direito' : 'esquerdo') : maisFechado} mais fechado).`));
    }
  };

  switch (r.ex) {
    case 'agachamento': {
      if (lateral && f.troncoVert != null && f.troncoVert > L.troncoAgachamento * tol) {
        al.push(A('tronco', 'TRONCO MAIS ERGUIDO', `Tronco inclinado demais: ${Math.round(f.troncoVert)}° da vertical no fundo (até ${Math.round(L.troncoAgachamento * tol)}°).`));
      }
      if (lateral && f.joelhoFrente != null && f.joelhoFrente > L.joelhoFrente * tol) {
        al.push(A('joelho_pe', 'QUADRIL PARA TRÁS', `Joelho bem à frente da ponta do pé (${Math.round(f.joelhoFrente * 100)}% da perna): leve o quadril para trás.`));
      }
      if (frontal) {
        const amp = r.vMax - r.vMin;
        const emCima = r.amostras.filter((a) => a.v >= r.vMax - 0.2 * amp).map((a) => a.m.razaoValgo);
        const embaixo = r.amostras.filter((a) => a.v <= r.vMin + 0.3 * amp).map((a) => a.m.razaoValgo);
        const rc = mediana(emCima), rb = quantil(embaixo, 0.25);
        if (rc && rb != null && rb / rc < L.valgo / tol) {
          al.push(A('valgo', 'JOELHOS PARA FORA', `Joelhos para dentro (valgo): a distância entre os joelhos caiu para ${Math.round((rb / rc) * 100)}% da posição em pé.`));
        }
        // assimetria: joelho equivalente de cada lado (altura do quadril) e pelve
        if (r.pernaRef) {
          const baixo = r.amostras.filter((a) => a.v <= r.vMin + 0.3 * amp);
          const d = mediana(baixo.map((a) => {
            const e = a.m.L.e.alturaQuadril, dd = a.m.L.d.alturaQuadril;
            if (e == null || dd == null) return null;
            const eq = (h) => (2 * Math.asin(Math.max(0, Math.min(1, h / r.pernaRef))) * 180) / Math.PI;
            return eq(e) - eq(dd);
          }));
          if (d != null && Math.abs(d) > L.assimetria * tol) {
            const l = d < 0 ? 'esquerdo' : 'direito';
            al.push(A('assimetria', 'ASSIMETRIA E/D', `Assimetria esquerda/direita: ${Math.round(Math.abs(d))}° de diferença entre os joelhos (lado ${r.esp ? (l === 'esquerdo' ? 'direito' : 'esquerdo') : l} desce mais).`));
          }
        }
        // pelve: a inclinação no fundo RELATIVA à de pé (a câmera de lado/do alto já inclina a linha do quadril)
        const pb = mediana(r.amostras.filter((a) => a.v <= r.vMin + 0.3 * amp).map((a) => a.m.inclPelve));
        const pt = mediana(r.amostras.filter((a) => a.v >= r.vMax - 0.2 * amp).map((a) => a.m.inclPelve));
        const pv = pb != null && pt != null ? Math.abs(pb - pt) : null;
        if (pv != null && pv > L.pelve * tol && !al.some((a) => a.cod === 'assimetria')) {
          al.push(A('assimetria', 'QUADRIL TORTO', `Quadril inclinando para um lado no fundo (${Math.round(pv)}° a mais que em pé): peso desigual entre as pernas.`));
        }
      }
      break;
    }
    case 'afundo': {
      if (lateral && f.troncoVert != null && f.troncoVert > L.troncoAfundo * tol) {
        al.push(A('tronco', 'TRONCO ERGUIDO', `Tronco inclinado: ${Math.round(f.troncoVert)}° da vertical (até ${Math.round(L.troncoAfundo * tol)}°).`));
      }
      if (lateral && f.joelhoFrente != null && f.joelhoFrente > L.joelhoFrente * tol) {
        al.push(A('joelho_pe', 'PASSO MAIS LONGO', `Joelho da frente passou bem da ponta do pé (${Math.round(f.joelhoFrente * 100)}% da perna): dê um passo mais longo.`));
      }
      if (frontal) {
        // valgo do joelho da frente: desvio para dentro da linha quadril–tornozelo
        const dv = mediana(r.amostras.slice(-Math.max(3, r.amostras.length >> 1)).map((a) => valgoLado(a.m)));
        if (dv != null && dv > 0.08 / tol) al.push(A('valgo', 'JOELHO PARA FORA', `Joelho da frente caindo para dentro (${Math.round(dv * 100)}% da perna).`));
      }
      break;
    }
    case 'flexao': {
      const dq = mediana(desdeLado('desvioQuadril'));
      if (dq != null && dq > L.quadrilCaindo * tol) al.push(A('quadril_caindo', 'QUADRIL CAINDO', `Quadril caindo: ${Math.round(dq * 100)}% abaixo da linha ombro–tornozelo. Contraia abdômen e glúteos.`));
      else if (dq != null && dq < -L.quadrilAlto * tol) al.push(A('quadril_alto', 'QUADRIL ALTO', `Quadril alto: ${Math.round(-dq * 100)}% acima da linha ombro–tornozelo.`));
      assim('angCotovelo', 'cotovelos');
      break;
    }
    case 'rosca': {
      // no pico da contração o braço deve continuar colado ao tronco
      const bt = quantil(desdeLado('bracoTronco'), 0.9);
      if (bt != null && bt > L.cotoveloRosca * tol) {
        al.push(A('cotovelo', 'COTOVELO PARADO', `Cotovelo saindo do lugar: braço a ${Math.round(bt)}° do tronco (até ${Math.round(L.cotoveloRosca * tol)}°). Mantenha o cotovelo junto ao corpo.`));
      }
      const bal = faixa(serie('troncoVert'));
      if (bal != null && bal > L.balanco * tol) al.push(A('balanco', 'SEM BALANÇO', `Balanço do tronco de ${Math.round(bal)}°: o movimento está "roubando" com o corpo.`));
      assim('angCotovelo', 'cotovelos');
      break;
    }
    case 'desenvolvimento': {
      const tf = quantil(serie('troncoFrente'), 0.1);
      if (lateral && tf != null && tf < -L.troncoTras * tol) al.push(A('lombar', 'NÃO ARQUEIE', `Tronco inclinando para trás (${Math.round(-tf)}°): lombar arqueando — contraia o abdômen.`));
      const dp = quantil(serie('difPunhoY'), 0.8);
      if (frontal && dp != null && dp > 0.4 * tol) al.push(A('assimetria', 'BRAÇOS JUNTOS', `Um braço sobe antes do outro (punhos desnivelados ${Math.round(dp * 100)}% do braço).`));
      assim('angCotovelo', 'cotovelos');
      break;
    }
    case 'terra': {
      if (lateral) {
        const pc = f.pescoco != null ? f.pescoco : null;
        const trs = serie('troncoLen').filter((x) => x > 0);
        const ref = quantil(trs, 0.9), noFundo = f.troncoLen;
        const enc = ref && noFundo ? 1 - noFundo / ref : null;
        if ((pc != null && pc < L.pescocoTerra / tol) || (enc != null && enc > L.encurtamentoTronco * tol)) {
          al.push(A('costas', 'COLUNA NEUTRA', `Costas arredondadas (aproximação${enc != null ? `: tronco ${Math.round(enc * 100)}% mais curto no fundo` : ''}${pc != null ? `, cabeça/ombros a ${Math.round(pc)}°` : ''}). Peito aberto, coluna neutra.`));
        }
        if (f.punhoPe != null && f.punhoPe > L.barraLonge * tol) al.push(A('barra', 'BARRA RENTE', `Barra longe do corpo (${Math.round(f.punhoPe * 100)}% da perna à frente do meio do pé).`));
      }
      break;
    }
    case 'polichinelo': {
      const pes = quantil(serie('sepPes'), 0.9);
      if (pes != null && pes < L.pesPolichinelo / tol) al.push(A('pernas', 'ABRA AS PERNAS', `Pernas pouco abertas (pés a ${num(pes, 1)}× a largura do quadril).`));
      const d = quantil(ms.map((m) => difLados(m, 'abducao')).map(Math.abs), 0.8);
      if (d != null && d > 25 * tol) al.push(A('assimetria', 'BRAÇOS IGUAIS', `Braços assimétricos (${Math.round(d)}° de diferença).`));
      break;
    }
    case 'abdominal': {
      const tv = serie('troncoVert');
      const sub = (quantil(tv, 0.9) ?? 0) - (quantil(tv, 0.05) ?? 0);
      if (Number.isFinite(sub) && sub < L.subidaAbdominal / tol) al.push(A('amplitude', 'SUBA MAIS', `Amplitude incompleta: o tronco subiu ${Math.round(sub)}° (alvo ≥ ${Math.round(L.subidaAbdominal / tol)}°).`));
      break;
    }
    default: break;
  }
  // um alerta por código (a primeira mensagem de cada)
  return al.filter((a, i) => al.findIndex((b) => b.cod === a.cod) === i);
}

/** Afundo, vista frontal: desvio do joelho mais dobrado para DENTRO da linha quadril–tornozelo (fração da perna, + = dentro). */
function valgoLado(m) {
  const e = m.L.e, d = m.L.d;
  if (!(e.angJoelho != null && d.angJoelho != null)) return null;
  const s = e.angJoelho <= d.angJoelho ? e : d;
  if (!s.quadril || !s.joelho || !s.tornozelo || !m.perna) return null;
  const meioX = (e.quadril && d.quadril) ? (e.quadril.x + d.quadril.x) / 2 : null;
  if (meioX == null) return null;
  const k = (s.joelho.y - s.quadril.y) / ((s.tornozelo.y - s.quadril.y) || 1);
  const xLinha = s.quadril.x + k * (s.tornozelo.x - s.quadril.x);
  const paraDentro = Math.sign(meioX - xLinha) || 1;
  return ((s.joelho.x - xLinha) * paraDentro) / m.perna;
}

/**
 * Prancha (isométrico), um quadro: em posição? e os alertas ao vivo.
 * Em posição = corpo quase horizontal (tronco > 55° da vertical), linha
 * ombro–quadril–tornozelo razoavelmente reta (> 140°) e apoio nos braços
 * (ombro acima do cotovelo).
 */
export function pranchaQuadro(m, tol = 1) {
  const linha = dosLados(m, 'linha');
  const s = m.L[m.lado];
  const apoio = s.ombro && s.cotovelo ? s.cotovelo.y > s.ombro.y : null;
  const emPosicao = m.troncoVert != null && m.troncoVert > 55 && linha != null && linha > 140 && apoio !== false;
  const al = [];
  if (!emPosicao) return { emPosicao, linha, alertas: al, desvio: null };
  const dq = dosLados(m, 'desvioQuadril');
  if (dq != null && dq > LIMITES.quadrilCaindo * tol) al.push(A('quadril_caindo', 'QUADRIL CAINDO', `Quadril caindo (${Math.round(dq * 100)}% abaixo da linha): contraia abdômen e glúteos.`));
  else if (dq != null && dq < -LIMITES.quadrilAlto * tol) al.push(A('quadril_alto', 'QUADRIL ALTO', `Quadril alto (${Math.round(-dq * 100)}% acima da linha): abaixe até alinhar.`));
  if (m.vista === 'lateral' && m.ombroSobreCotovelo != null && m.ombroSobreCotovelo > LIMITES.ombroCotovelo * tol) {
    al.push(A('ombro', 'OMBROS SOBRE COTOVELOS', 'Ombros fora da linha dos cotovelos: alinhe o ombro em cima do cotovelo.'));
  }
  return { emPosicao, linha, desvio: dq, alertas: al };
}

// -------------------------------------------------------------- classificação automática

/**
 * Exercício pelo padrão dos últimos segundos (regras sobre ângulos e
 * trajetórias). `janela` = [{t, m}] (~4 s). Devolve { ex, motivo } ou
 * { ex: null, motivo } quando não há movimento reconhecível.
 *
 *   corpo deitado (tronco > 55° da vertical):
 *     joelho dobrado (< 135°) e o quadril variando  → abdominal
 *     corpo reto (linha > 140°) e cotovelo variando → flexão
 *     corpo reto e parado                           → prancha
 *   corpo em pé:
 *     braços abrindo ≥ 70° e pés abrindo            → polichinelo
 *     só o cotovelo varia (≥ 50°, pernas paradas):
 *        punhos acima dos ombros                    → desenvolvimento
 *        punhos abaixo                              → rosca
 *     quadril/joelho variando:
 *        pés afastados na passada ou joelhos em alturas diferentes → afundo
 *        joelho varia pouco perto do quadril e o tronco inclina   → terra
 *        senão                                                    → agachamento
 */
export function classificar(janela) {
  const ms = janela.map((a) => a.m).filter(Boolean);
  if (ms.length < 8) return { ex: null, motivo: 'poucas amostras' };
  const S = (f) => ms.map(f);
  const tronco = mediana(S((m) => m.troncoVert));
  if (tronco == null) return { ex: null, motivo: 'tronco não visível' };
  // pernas fora do quadro (só o tronco filmado): o modelo inventa joelhos
  // tremendo na borda — as regras das pernas só valem com pernas visíveis
  const pernas = ms.filter((m) => (m.L.e.joelho && m.L.e.tornozelo) || (m.L.d.joelho && m.L.d.tornozelo)).length / ms.length >= 0.6;
  const rJoelho = pernas ? faixa(S((m) => dosLados(m, 'angJoelho'))) ?? 0 : 0;
  const rQuadril = pernas ? faixa(S((m) => dosLados(m, 'angQuadril'))) ?? 0 : 0;
  const rCotovelo = faixa(S((m) => dosLados(m, 'angCotovelo'))) ?? 0;
  const rAbd = faixa(S((m) => dosLados(m, 'abducao'))) ?? 0;
  const rTronco = faixa(S((m) => m.troncoVert)) ?? 0;
  if (tronco > 55) {
    const joelho = mediana(S((m) => dosLados(m, 'angJoelho')));
    const linha = mediana(S((m) => dosLados(m, 'linha')));
    // apoio nas mãos: punhos bem abaixo dos ombros (flexão, prancha); no
    // abdominal as mãos ficam no peito/cabeça. De frente (cabeça para a câmera)
    // as pernas encurtam e o "joelho dobrado" engana — o apoio não.
    const apoio = mediana(S((m) => {
      const s = m.L[m.lado];
      return s.punho && s.ombro && m.braco ? (s.punho.y - s.ombro.y > 0.6 * m.braco ? 1 : 0) : null;
    }));
    if (apoio === 1) {
      if (rCotovelo > 28) return { ex: 'flexao', motivo: 'apoio nas mãos, cotovelos dobrando' };
      if (rCotovelo < 15 && rQuadril < 15 && linha != null && linha > 140) return { ex: 'prancha', motivo: 'corpo reto e parado' };
      return { ex: null, motivo: 'apoio nas mãos, sem padrão' };
    }
    if (joelho != null && joelho < 135 && (rQuadril > 18 || rTronco > 18)) return { ex: 'abdominal', motivo: 'deitado, joelhos dobrados, tronco subindo' };
    if (linha != null && linha > 140) {
      if (rCotovelo > 28) return { ex: 'flexao', motivo: 'corpo reto, cotovelos dobrando' };
      if (rCotovelo < 15 && rQuadril < 15) return { ex: 'prancha', motivo: 'corpo reto e parado' };
    }
    return { ex: null, motivo: 'deitado, sem padrão' };
  }
  const rPes = faixa(S((m) => m.sepPes)) ?? 0;
  if (rAbd > 70 && rPes > 0.5) return { ex: 'polichinelo', motivo: 'braços e pernas abrindo juntos' };
  if (rCotovelo > 50 && rJoelho < 25 && rQuadril < 25) {
    const acima = mediana(S((m) => m.punhoAcimaOmbro));
    return acima != null && acima > 0.5
      ? { ex: 'desenvolvimento', motivo: 'cotovelo variando, punhos acima dos ombros' }
      : { ex: 'rosca', motivo: 'cotovelo variando, punhos abaixo dos ombros' };
  }
  if (rQuadril > 35 || rJoelho > 30) {
    const lateral = ms.filter((m) => m.vista === 'lateral').length > ms.length / 2;
    const passada = lateral ? quantil(S((m) => (m.L.e.tornozelo && m.L.d.tornozelo && m.perna ? Math.abs(m.L.e.tornozelo.x - m.L.d.tornozelo.x) / m.perna : null)), 0.5) : null;
    const dyJ = quantil(S((m) => m.dyJoelhos), 0.75);
    if ((passada != null && passada > 0.45) || (dyJ != null && dyJ > 0.25)) return { ex: 'afundo', motivo: 'pés em passada / joelhos em alturas diferentes' };
    if (rJoelho < 0.55 * rQuadril && rTronco > 30) return { ex: 'terra', motivo: 'quadril dobrando com joelho quase fixo e tronco inclinando' };
    return { ex: 'agachamento', motivo: 'joelho e quadril dobrando juntos' };
  }
  return { ex: null, motivo: 'parado' };
}

// -------------------------------------------------------------- repetições

/**
 * Detector de repetição sobre o ângulo da articulação principal.
 *
 * Trabalha com u = ±ângulo, de modo que o REPOUSO é sempre o lado alto de u
 * e o TRABALHO o baixo. A amostragem é irregular (a inferência tem ritmo
 * próprio), então a suavização é exponencial com constante de TEMPO.
 *
 *   repouso → ida     u caiu hEnt abaixo do topo recente (max(0,35·ampMin, 6°))
 *   ida → volta       u subiu hRev acima do fundo (max(0,3·ampMin, 0,2·amplitude, 5°))
 *   volta → repouso   u voltou a 80% do caminho (topo − 0,2·amplitude): REPETIÇÃO
 *   volta → ida       u voltou a cair antes disso: repetição com retorno incompleto
 *
 * Os tempos t1 (saída do repouso) e t2 (chegada) são os cruzamentos do nível
 * topo − 0,2·amplitude, interpolados entre amostras: a fase útil, sem a pausa
 * parada em cima. Amplitude < ampMin ou duração < durMin (0,6 s; 0,35 s no
 * polichinelo) = "movimento curto" (não conta): um corte no vídeo ou a pose
 * saltando de um quadro para o outro faz um "ciclo" de poucos décimos.
 */
export class DetectorRep {
  constructor({ repouso = 'alto', ampMin = 30, tauMs = 70, durMin = 600, subidaInicial = false } = {}) {
    this.k = repouso === 'alto' ? 1 : -1;
    this.ampMin = ampMin; this.tauMs = tauMs; this.durMin = durMin; this.subidaInicial = subidaInicial;
    this.zerar();
  }
  zerar() {
    this.us = null; this.tUlt = null; this.estado = 'repouso';
    this.hist = []; this.rep = []; this.topoRep = null; this.fundo = null; this.tFundo = null; this.pico = null; this.tIni = null;
    this.ini = null; this.feitaInicial = !this.subidaInicial;
  }
  /**
   * Levantamento terra começa EMBAIXO (barra no chão): a primeira subida
   * até travar já é uma repetição, sem descida antes. Conta quando o sinal
   * subiu ≥ ampMin desde o ponto mais baixo e parou de subir (250 ms sem
   * novo topo) acima de 80% do caminho — ou, sem pausa em cima, quando
   * começa a descer.
   */
  primeiraSubida(t, us, forcar = false) {
    if (this.ini == null || us < this.ini.u) this.ini = { u: us, t };
    const topo = this.topo();
    let tTopo = null;
    for (const h of this.rep) if (h.u === topo) tTopo = h.t;
    const amp = topo - this.ini.u;
    if (amp < this.ampMin || tTopo == null || tTopo < this.ini.t) return null;
    // sem forçar, espera parar de subir; forçado = já começou a descer (toque e volta)
    if (!forcar && (us < this.ini.u + 0.8 * amp || t - tTopo < 250)) return null;
    this.feitaInicial = true;
    const n1 = this.ini.u + 0.2 * amp, n2 = this.ini.u + 0.8 * amp;
    let t1 = this.ini.t, t2 = tTopo;
    const H = this.hist;
    for (let i = 1; i < H.length; i++) {
      const a = H[i - 1], b = H[i];
      if (a.t < this.ini.t) continue;
      if (t1 === this.ini.t && a.u < n1 && b.u >= n1) t1 = a.t + ((n1 - a.u) / (b.u - a.u || 1)) * (b.t - a.t);
      if (a.u < n2 && b.u >= n2) { t2 = a.t + ((n2 - a.u) / (b.u - a.u || 1)) * (b.t - a.t); break; }
    }
    return {
      tipo: t2 - t1 >= this.durMin * 0.5 ? 'rep' : 'curta', t1, tW: t1, t2, inicial: true,
      vRepouso: this.ang(topo), vTrabalho: this.ang(this.ini.u), amp, retornoIncompleto: false,
    };
  }
  /** Topo do repouso: máximo de u nos últimos 3 s em repouso. */
  topo() {
    let mx = -Infinity;
    for (const h of this.rep) if (h.u > mx) mx = h.u;
    return Number.isFinite(mx) ? mx : null;
  }
  /** Ângulo de volta (desfaz o sinal). */
  ang(u) { return u == null ? null : this.k * u; }
  /** Devolve [] ou [{tipo: 'rep'|'curta', t1, tW, t2, vRepouso, vTrabalho, amp, retornoIncompleto}]. */
  add(t, v) {
    if (!Number.isFinite(v)) return [];
    const u = this.k * v;
    if (this.us == null || this.tUlt == null || t - this.tUlt > 3000) {
      this.zerar(); this.us = u;
    } else {
      const dt = Math.max(0, t - this.tUlt);
      this.us += (1 - Math.exp(-dt / this.tauMs)) * (u - this.us);
    }
    this.tUlt = t;
    const us = this.us;
    this.hist.push({ t, u: us });
    while (this.hist.length > 2 && this.hist[0].t < t - 20000) this.hist.shift();
    const ev = [];
    const hEnt = Math.max(0.35 * this.ampMin, 6);
    // ponto mais baixo antes da primeira repetição (vale em qualquer estado:
    // a pessoa ainda se ajeitando embaixo pode abrir uma "ida" curta)
    if (!this.feitaInicial && (this.ini == null || us < this.ini.u)) this.ini = { u: us, t };
    if (this.estado === 'repouso') {
      this.rep.push({ t, u: us });
      while (this.rep.length > 2 && this.rep[0].t < t - 3000) this.rep.shift();
      if (!this.feitaInicial) { const e = this.primeiraSubida(t, us); if (e) ev.push(e); }
      const topo = this.topo();
      if (topo != null && us < topo - hEnt) {
        if (!this.feitaInicial) { const e = this.primeiraSubida(t, us, true); if (e) ev.push(e); }
        this.estado = 'ida'; this.topoRep = topo; this.fundo = us; this.tFundo = t; this.tIni = t;
      }
    } else if (this.estado === 'ida') {
      if (us < this.fundo) { this.fundo = us; this.tFundo = t; }
      const amp = this.topoRep - this.fundo;
      if (us > this.fundo + Math.max(0.3 * this.ampMin, 0.2 * amp, 5)) { this.estado = 'volta'; this.pico = us; }
      else if (t - this.tIni > 12000) {
        // ficou parado embaixo (barra no chão entre séries): novo repouso, e a
        // próxima subida pode ser a primeira repetição de novo (terra)
        this.voltarAoRepouso(t, us);
        this.feitaInicial = !this.subidaInicial; this.ini = null;
      }
    } else if (this.estado === 'volta') {
      if (us < this.fundo) { this.estado = 'ida'; this.fundo = us; this.tFundo = t; return ev; }
      if (us > this.pico) this.pico = us;
      const amp = this.topoRep - this.fundo;
      const nivel = this.topoRep - 0.2 * amp;
      if (us >= nivel) {
        const e = this.fechar(nivel, t, false);
        ev.push(e);
        if (e.tipo === 'rep') this.feitaInicial = true;
        this.voltarAoRepouso(t, us);
      } else if (us < this.pico - Math.max(0.3 * this.ampMin, 0.25 * (this.pico - this.fundo), 5)) {
        // voltou a descer sem chegar em cima: fecha no pico e começa outra ida
        const ampP = this.pico - this.fundo;
        if (ampP >= this.ampMin) { ev.push(this.fechar(this.pico - 1e-6, this.tempoDoPico(), true)); this.feitaInicial = true; }
        this.topoRep = this.pico; this.fundo = us; this.tFundo = t; this.tIni = t; this.estado = 'ida';
      }
    }
    return ev;
  }
  voltarAoRepouso(t, us) {
    this.estado = 'repouso'; this.rep = [{ t, u: us }];
    this.topoRep = null; this.fundo = null; this.pico = null;
  }
  tempoDoPico() {
    let melhor = null;
    for (let i = this.hist.length - 1; i >= 0 && this.hist[i].t >= this.tFundo; i--) {
      if (!melhor || this.hist[i].u >= melhor.u) melhor = this.hist[i];
    }
    return melhor ? melhor.t : this.tUlt;
  }
  /** Cruzamento do nível antes do fundo (t1) e depois dele (t2), interpolados. */
  fechar(nivel, tFim, incompleto) {
    const H = this.hist;
    let t1 = null;
    for (let i = H.length - 1; i > 0; i--) {
      const a = H[i - 1], b = H[i];
      if (b.t > this.tFundo) continue;
      if (a.u >= nivel && b.u < nivel) { t1 = a.t + ((a.u - nivel) / (a.u - b.u || 1)) * (b.t - a.t); break; }
    }
    if (t1 == null) t1 = this.tIni;
    let t2 = tFim;
    if (!incompleto) {
      for (let i = H.length - 1; i > 0; i--) {
        const a = H[i - 1], b = H[i];
        if (a.t < this.tFundo) break;
        if (a.u < nivel && b.u >= nivel) { t2 = a.t + ((nivel - a.u) / (b.u - a.u || 1)) * (b.t - a.t); break; }
      }
    }
    const amp = (incompleto ? this.pico : this.topoRep) - this.fundo;
    // curta: pouca amplitude, ou rápida demais para ser gente (corte de vídeo, pose saltando)
    return {
      tipo: amp >= this.ampMin && t2 - t1 >= this.durMin ? 'rep' : 'curta', t1, tW: this.tFundo, t2,
      vRepouso: this.ang(this.topoRep), vTrabalho: this.ang(this.fundo), amp, retornoIncompleto: incompleto,
    };
  }
  /** Fase atual para exibição: 'repouso' | 'ida' | 'volta'. */
  fase() { return this.estado; }
}

/** Abaixo disto (poses por segundo) repetições rápidas (polichinelo, flexão rápida) podem se perder. */
export const TAXA_MIN_HZ = 6;

/** Movimento mínimo da imagem (p95 da diferença entre quadros, 0..255) para uma repetição valer. Foto parada dá 0. */
export const MOV_MIN = 1.5;

// -------------------------------------------------------------- treino (sessão)

/**
 * O treino: recebe uma amostra por inferência ({t, m, mov}) e devolve os
 * eventos (repetição, série fechada, exercício reconhecido). Guarda as
 * repetições com a qualidade, as séries e o registro para exportar.
 *
 * cfg = { exercicio: id|null (null = automático), pausaSerieS, tol, esp, metaSeries, metaReps, descansoS }
 */
export class Treino {
  constructor() { this.zerar(); }
  zerar() {
    this.t0 = null; this.tUlt = null;
    this.exAtual = null; this.exCand = null; this.nCand = 0; this.tClass = 0; this.motivo = '';
    this.det = null;
    this.buf = [];          // amostras recentes {t, m, v, mov}
    this.janela = [];       // para a classificação
    this.reps = [];         // todas as repetições
    this.series = [];       // séries fechadas e a aberta (última, aberta = !fechada)
    this.curtas = 0; this.descartes = 0;
    this.registro = [];     // amostras leves para exportar
    this.ultimaRep = null;
    this.alertasVivos = [];
    this.isom = null;       // prancha em andamento {tIni, tUlt, dur, durAlerta, cods, fora}
    this.vAtual = null;
    this.pernas = [];
  }
  /** Amostras de pose por segundo nos últimos ~4 s (null = poucas amostras). */
  taxaHz() {
    const ts = this.janela.map((a) => a.t);
    if (ts.length < 6) return null;
    const span = ts[ts.length - 1] - ts[0];
    return span > 0 ? ((ts.length - 1) * 1000) / span : null;
  }
  /** Contexto do sinal: a perna em pé (p90 dos últimos 20 s). */
  ctxSinal() {
    return { pernaRef: this.pernas.length >= 3 ? quantil(this.pernas.map((x) => x.p), 0.9) : null };
  }
  serieAberta() {
    const s = this.series[this.series.length - 1];
    return s && !s.fechada ? s : null;
  }
  /** Troca o exercício: fecha a série aberta e recomeça o detector. */
  definirExercicio(id, t) {
    if (id === this.exAtual) return false;
    this.fecharSerie(t);
    this.exAtual = id;
    const ex = id ? EXERCICIOS[id] : null;
    this.det = ex && !ex.isometrico
      ? new DetectorRep({ repouso: ex.repouso, ampMin: ex.ampMin, durMin: ex.durMin || 600, subidaInicial: !!ex.subidaInicial }) : null;
    this.isom = null;
    return true;
  }
  fecharSerie(t) {
    const s = this.serieAberta();
    if (this.isom) this.fecharIsometrico(t);
    if (!s) return null;
    s.fechada = true;
    s.tFechada = t != null ? t - this.t0 : s.tFim;
    return s;
  }
  adicionar(a, cfg = {}, { gravar = true } = {}) {
    const ev = [];
    const t = a.t;
    if (this.t0 == null) this.t0 = t;
    this.tUlt = t;
    const pausa = Math.max(1, cfg.pausaSerieS || 10) * 1000;
    // série fechada pela pausa (sem repetição há mais de N s, o detector em repouso)
    const s0 = this.serieAberta();
    if (s0 && !s0.isometrica && t - (this.t0 + s0.tFim * 1000) > pausa && (!this.det || this.det.fase() === 'repouso')) {
      this.fecharSerie(t); ev.push({ tipo: 'serie', serie: s0 });
    }
    if (!a.m) return ev;
    const m = a.m;
    // exercício: manual ou automático
    const manual = cfg.exercicio ? idExercicio(cfg.exercicio) : null;
    let reconhecido = false;
    this.janela.push({ t, m });
    while (this.janela.length > 2 && this.janela[0].t < t - 4000) this.janela.shift();
    if (manual) {
      if (this.definirExercicio(manual, t)) ev.push({ tipo: 'exercicio', ex: manual, auto: false });
      this.motivo = 'escolhido no painel';
    } else if (t - this.tClass > 400) {
      this.tClass = t;
      const c = classificar(this.janela);
      this.ultClass = c;
      const travado = this.serieAberta() && this.exAtual;   // não troca no meio da série
      if (c.ex && c.ex !== this.exAtual && !travado) {
        if (c.ex === this.exCand) this.nCand++; else { this.exCand = c.ex; this.nCand = 1; this.tCand = t; }
        // trocar um exercício já reconhecido pede o novo padrão por mais tempo (2 s)
        if (this.nCand >= 3 && (!this.exAtual || t - this.tCand >= 2000)) {
          this.definirExercicio(c.ex, t); this.motivo = c.motivo; reconhecido = true;
          ev.push({ tipo: 'exercicio', ex: c.ex, auto: true, motivo: c.motivo });
        }
      } else if (c.ex === this.exAtual) { this.nCand = 0; this.motivo = c.motivo; }
    }
    const ex = this.exAtual ? EXERCICIOS[this.exAtual] : null;
    // exercício acabou de ser reconhecido: as amostras dos últimos segundos
    // (que serviram para reconhecer) passam pelo detector — a primeira
    // repetição não se perde
    if (ex && reconhecido && !ex.isometrico) {
      for (const x of this.buf) {
        if (x.t < t - 10000) continue;
        x.v = ex.sinal(x.m, this.ctxSinal());
        this.processar(x, cfg, ev, gravar);
      }
    }
    if (m.perna > 0) { this.pernas.push({ t, p: m.perna }); while (this.pernas.length > 2 && this.pernas[0].t < t - 20000) this.pernas.shift(); }
    const v = ex ? ex.sinal(m, this.ctxSinal()) : null;
    this.vAtual = v;
    const amostra = { t, m, v, mov: a.mov };
    this.buf.push(amostra);
    while (this.buf.length > 2 && this.buf[0].t < t - 20000) this.buf.shift();
    if (gravar && this.registro.length < 30000) {
      this.registro.push({ t, ex: this.exAtual, v, vista: m.vista, troncoVert: m.troncoVert, mov: a.mov });
    }
    if (!ex) return ev;
    if (ex.isometrico) { this.passoIsometrico(amostra, cfg, ev, gravar); return ev; }
    this.processar(amostra, cfg, ev, gravar);
    return ev;
  }
  /** Uma amostra pelo detector de repetição; repetições viram eventos. */
  processar(amostra, cfg, ev, gravar) {
    for (const e of this.det.add(amostra.t, amostra.v)) {
      if (e.tipo === 'curta') { this.curtas++; continue; }
      const rep = this.montarRep(e, cfg);
      if (!rep || !gravar) continue;
      const s = this.serieAberta() || this.abrirSerie(e.t1);
      rep.serie = s.n; rep.nSerie = s.reps.length + 1; rep.n = this.reps.length + 1;
      s.reps.push(rep); this.reps.push(rep);
      this.atualizarSerie(s);
      this.ultimaRep = rep;
      ev.push({ tipo: 'rep', rep, serie: s });
    }
  }
  abrirSerie(t1) {
    const s = { n: this.series.length + 1, ex: this.exAtual, reps: [], tIni: (t1 - this.t0) / 1000, tFim: (t1 - this.t0) / 1000, fechada: false };
    // descanso de verdade: do fim da série anterior até o começo desta
    const ant = this.series[this.series.length - 1];
    if (ant) s.descansoAntes = s.tIni - ant.tFim;
    this.series.push(s);
    return s;
  }
  atualizarSerie(s) {
    const r = s.reps;
    s.tFim = r[r.length - 1].tFim;
    s.boas = r.filter((x) => x.boa).length;
    s.alerta = r.length - s.boas;
    s.tut = r.reduce((sm, x) => sm + (x.dur || 0), 0);
    s.amplMed = media(r.map((x) => x.amp));
    // ritmo: repetições por minuto pelo intervalo médio entre os fins das repetições
    if (r.length >= 2) s.ritmo = (60 * (r.length - 1)) / Math.max(0.1, r[r.length - 1].tFim - r[0].tFim);
    else s.ritmo = r[0].dur ? 60 / r[0].dur : null;
  }
  /** Resumo de uma repetição detectada + checagens de forma. */
  montarRep(e, cfg) {
    const ex = EXERCICIOS[this.exAtual];
    const amostras = this.buf.filter((x) => x.t >= e.t1 - 150 && x.t <= e.t2 + 100 && x.v != null);
    if (amostras.length < 3) return null;
    // imagem parada (foto, vídeo pausado): a pose oscila, mas ninguém se mexeu
    const movs = amostras.map((x) => x.mov).filter(Number.isFinite);
    const movMed = movs.length >= 3 ? mediana(movs) : null;
    if (movMed != null && movMed < MOV_MIN) { this.descartes++; return null; }
    const vs = mediana3(amostras.map((x) => x.v));
    const vMin = Math.min(...vs), vMax = Math.max(...vs);
    // medidas no ponto de trabalho (fundo) e no repouso
    const iW = vs.indexOf(ex.repouso === 'alto' ? vMin : vMax);
    const fundo = amostras[Math.max(0, iW)].m;
    const vistas = amostras.map((x) => x.m.vista).filter(Boolean);
    const vista = ['lateral', 'frontal', 'obliqua'].map((k) => [k, vistas.filter((x) => x === k).length]).sort((a, b) => b[1] - a[1])[0];
    const r = {
      ex: this.exAtual, tol: cfg.tol || 1, esp: !!cfg.esp, vista: vista && vista[1] ? vista[0] : null,
      vMin, vMax, amp: vMax - vMin, fundo, amostras, retornoIncompleto: e.retornoIncompleto,
      vRepouso: e.vRepouso, pernaRef: this.ctxSinal().pernaRef,
    };
    const alertas = checarForma(r);
    const d1 = (e.tW - e.t1) / 1000, d2 = (e.t2 - e.tW) / 1000;
    let exc = ex.primeira === 'exc' ? d1 : d2, con = ex.primeira === 'exc' ? d2 : d1;
    if (e.inicial) { exc = null; con = (e.t2 - e.t1) / 1000; }   // só a subida (terra a partir do chão)
    const prof = this.exAtual === 'agachamento' && fundo.quadrilAbaixo != null ? fundo.quadrilAbaixo : null;
    return {
      ex: this.exAtual, t: (e.t1 - this.t0) / 1000, tFim: (e.t2 - this.t0) / 1000,
      dur: (e.t2 - e.t1) / 1000, fase1: d1, fase2: d2, exc: ex.fases[0] === 'abertura' ? null : exc, con: ex.fases[0] === 'abertura' ? null : con,
      vMin, vMax, amp: vMax - vMin, prof, vista: r.vista,
      troncoFundo: fundo.troncoVert, alertas, boa: alertas.length === 0,
    };
  }
  /** Prancha: tempo em posição, tempo com alerta; cada sustentação é uma série de uma "repetição". */
  passoIsometrico(a, cfg, ev, gravar) {
    const q = pranchaQuadro(a.m, cfg.tol || 1);
    this.alertasVivos = q.alertas;
    this.prancha = q;
    const t = a.t;
    const pausa = Math.max(1, Math.min(cfg.pausaSerieS || 10, 5)) * 1000;
    if (q.emPosicao) {
      if (!this.isom) {
        this.isom = { tIni: t, tUlt: t, dur: 0, durAlerta: 0, cods: {}, desvios: [] };
        if (gravar) {
          const s = this.abrirSerie(t); s.isometrica = true;
        }
      } else {
        const dt = Math.min(500, t - this.isom.tUlt) / 1000;
        this.isom.dur += dt;
        if (q.alertas.length) {
          this.isom.durAlerta += dt;
          for (const al of q.alertas) this.isom.cods[al.cod] = { ...al, s: ((this.isom.cods[al.cod] || {}).s || 0) + dt };
        }
        this.isom.tUlt = t;
        if (q.desvio != null) this.isom.desvios.push(q.desvio);
      }
      const s = this.serieAberta();
      if (s && s.isometrica) { s.tFim = (t - this.t0) / 1000; s.dur = this.isom.dur; }
    } else if (this.isom && t - this.isom.tUlt > pausa) {
      const s = this.serieAberta();
      const rep = this.fecharIsometrico(t);
      if (rep && s) ev.push({ tipo: 'rep', rep, serie: s }, { tipo: 'serie', serie: s });
      if (s) { s.fechada = true; s.tFechada = (t - this.t0) / 1000; }
    }
  }
  fecharIsometrico() {
    const i = this.isom;
    this.isom = null;
    const s = this.serieAberta();
    if (!i || !s || !s.isometrica) return null;
    if (i.dur < 2) {   // sustentação curta demais: não vira série
      this.series.pop();
      return null;
    }
    const alinhado = i.dur > 0 ? 1 - i.durAlerta / i.dur : 1;
    const alertas = Object.values(i.cods).filter((c) => c.s >= Math.max(1.5, 0.15 * i.dur))
      .map(({ cod, curta, msg, s: seg }) => ({ cod, curta, msg: `${msg} (${num(seg, 0)} s)` }));
    const rep = {
      ex: 'prancha', t: (i.tIni - this.t0) / 1000, tFim: (i.tUlt - this.t0) / 1000, dur: i.dur, alinhado,
      desvioMed: mediana(i.desvios), alertas, boa: alinhado >= 0.8 && alertas.length === 0,
      exc: null, con: null, vMin: null, vMax: null, amp: null, prof: null,
      serie: s.n, nSerie: 1, n: this.reps.length + 1,
    };
    s.reps.push(rep); this.reps.push(rep);
    s.tFim = rep.tFim; s.boas = rep.boa ? 1 : 0; s.alerta = rep.boa ? 0 : 1; s.tut = i.dur; s.ritmo = null; s.amplMed = null; s.alinhado = alinhado;
    this.ultimaRep = rep;
    return rep;
  }
  /** Prancha em andamento (para o placar): segundos e fração alinhada. */
  isometricoAgora() {
    const i = this.isom;
    return i ? { dur: i.dur, alinhado: i.dur > 0 ? 1 - i.durAlerta / i.dur : 1 } : null;
  }
  /**
   * Descanso: segundos desde o fim da última série (ou da última repetição,
   * se a série ainda está aberta mas parada). null se em movimento.
   */
  descanso(tAgora = this.tUlt) {
    const ult = this.series[this.series.length - 1];
    if (!ult || tAgora == null) return null;
    if (this.isom) return null;
    const s = (tAgora - this.t0) / 1000 - ult.tFim;
    return s > 0 ? s : null;
  }
  /** Resumo do treino inteiro e por exercício. */
  resumo() {
    const porEx = {};
    for (const r of this.reps) {
      const o = porEx[r.ex] = porEx[r.ex] || { ex: r.ex, nome: EXERCICIOS[r.ex].nome, reps: 0, boas: 0, alerta: 0, series: new Set(), tut: 0, amps: [], excs: [], cons: [], cods: {} };
      o.reps++; if (r.boa) o.boas++; else o.alerta++;
      o.series.add(r.serie); o.tut += r.dur || 0;
      if (r.amp != null) o.amps.push(r.amp);
      if (r.exc != null) o.excs.push(r.exc);
      if (r.con != null) o.cons.push(r.con);
      for (const a of r.alertas) o.cods[a.cod] = { n: ((o.cods[a.cod] || {}).n || 0) + 1, curta: a.curta };
    }
    const lista = Object.values(porEx).map((o) => ({
      ex: o.ex, nome: o.nome, reps: o.reps, boas: o.boas, alerta: o.alerta, series: o.series.size, tut: o.tut,
      amplMed: media(o.amps), excMed: media(o.excs), conMed: media(o.cons),
      alertas: Object.entries(o.cods).map(([cod, v]) => ({ cod, n: v.n, curta: v.curta })).sort((a, b) => b.n - a.n),
    }));
    const tot = this.reps.length;
    const boas = this.reps.filter((r) => r.boa).length;
    return {
      reps: tot, boas, alerta: tot - boas, series: this.series.length,
      tut: this.reps.reduce((s, r) => s + (r.dur || 0), 0),
      duracao: this.tUlt != null && this.t0 != null ? (this.tUlt - this.t0) / 1000 : 0,
      qualidade: tot ? boas / tot : null,
      porExercicio: lista,
    };
  }
}
