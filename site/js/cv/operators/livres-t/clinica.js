/**
 * operators/livres-t/clinica.js — CV-72 Movimento clínico (83, 84, 86).
 *
 *   clinica.tremor   tremor de mão: frequência e amplitude (Mãos e gestos antes, ou o punho da pose)
 *   clinica.postura  postura estática por foto/vídeo: ombros, pelve, cabeça, tronco, linha de prumo
 *   clinica.marcha   marcha clínica sobre o motor da Corrida (extração de pés e pelve), com
 *                    piso calibrado: duas linhas "Marcha · piso" a uma distância conhecida
 */
import { clone } from '../../core.js';
import { analisarTremor, medirPostura, medianaPostura, analisarMarcha, Cronometro2Linhas, FONTES, AVISO_SAUDE } from '../../runtime/livres-t/clinica.js';
import { extrairCorrida, escalaPerna } from '../../runtime/livres-h/corrida.js';
import { publicar, registrar, registrosDe, consumirPedido, geracaoAtual, studioAberto } from '../../runtime/livres-t/canal.js';
import { instante, obterPose, PARAMS_POSE, esqueleto, bannerista, COR, num, AVISO_CURTO, copiaQuadro } from './comum.js';

const G = 'CV-72';
export const FUNC_PISO = 'marcha_piso';

// ------------------------------------------------------------------ 83 tremor

const PONTOS_MAO = { 'ponta do indicador': 8, 'dorso da mão (base do dedo médio)': 9, 'punho': 0 };

export const tremor = {
  op: 'clinica.tremor',
  label: 'Tremor de mão (frequência e amplitude)',
  group: G, overlayOnly: true,
  desc: 'Frequência (Hz) e amplitude pico a pico (cm, pelo comprimento da mão informado) do tremor de um ponto da mão: ' +
        'tira o movimento voluntário (< 2 Hz), projeta no eixo principal e procura o pico do espectro em 3–12 Hz. Use ' +
        '"Mãos e gestos" antes na cadeia (sem ela, o punho da pose). A taxa de quadros limita a frequência medida. ' + AVISO_SAUDE,
  params: {
    mao: { type: 'enum', options: ['qualquer', 'direita', 'esquerda'], default: 'qualquer', label: 'Mão' },
    ponto: { type: 'enum', options: Object.keys(PONTOS_MAO), default: 'ponta do indicador', label: 'Ponto medido' },
    condicao: { type: 'enum', options: ['repouso (mão apoiada)', 'postural (braço estendido)', 'ação (dedo ao nariz)'], default: 'repouso (mão apoiada)', label: 'Condição do teste' },
    maoCm: { type: 'float', min: 10, max: 25, step: 0.5, default: 18, label: 'Comprimento da mão (punho → ponta do médio, cm)' },
    janelaS: { type: 'int', min: 4, max: 30, step: 1, default: 10, label: 'Janela (s)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.ts = []; state.xs = []; state.ys = []; state.L = []; state.r = null; }
    const ban = bannerista(ctx.overlay, ctx);
    ban(`⚠ ${AVISO_CURTO}`, COR.aviso);
    let q = null, L = null, origem = '';
    const hs = Array.isArray(ctx.hands) ? ctx.hands.filter((h) => p.mao === 'qualquer' || h.lado === p.mao) : [];
    const t = instante(ctx);
    if (hs.length) {
      const h = hs[0], i = PONTOS_MAO[p.ponto] ?? 8;
      q = { x: h.pts[i].x * ctx.w, y: h.pts[i].y * ctx.h };
      L = Math.hypot((h.pts[12].x - h.pts[0].x) * ctx.w, (h.pts[12].y - h.pts[0].y) * ctx.h);
      origem = 'Mãos e gestos (21 pontos)';
    } else {
      const R = obterPose(src, p, state, ctx);
      if (R.P && R.novo) {
        const lado = p.mao === 'esquerda' ? 15 : p.mao === 'direita' ? 16 : (R.P[15].v >= R.P[16].v ? 15 : 16);
        const P = R.P[lado], C = R.P[lado - 2];
        if (P.v >= p.minVis) { q = { x: P.x * ctx.w / R.w, y: P.y * ctx.h / R.h }; L = C && C.v >= p.minVis ? 0.75 * Math.hypot((P.x - C.x) * ctx.w / R.w, (P.y - C.y) * ctx.h / R.h) : null; }
        origem = 'punho da pose (ponha "Mãos e gestos" antes para mais precisão)';
      }
    }
    if (q && t != null && (!state.ts.length || t > state.ts[state.ts.length - 1])) {
      state.ts.push(t); state.xs.push(q.x); state.ys.push(q.y); if (L) state.L.push(L);
      while (state.ts.length && state.ts[0] < t - p.janelaS * 1000) { state.ts.shift(); state.xs.shift(); state.ys.shift(); }
      while (state.L.length > 300) state.L.shift();
      ctx.overlay.push({ type: 'point', x: q.x, y: q.y, r: 6, color: '#FFD84D' });
    }
    const agora = t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
    if (state.tA == null || agora - state.tA > 700 || agora < state.tA) {
      state.tA = agora;
      const Ls = state.L.slice().sort((a, b) => a - b);
      state.r = analisarTremor(state.ts, state.xs, state.ys, Ls.length ? Ls[Ls.length >> 1] : null, p.maoCm);
    }
    const r = state.r || { hz: null, avisos: [] };
    if (!q && !hs.length) r.avisos = ['sem mão no quadro', ...(r.avisos || [])];
    const ped = consumirPedido('clinica.tremor');
    if (ped && ped.acao === 'registrar' && r.hz != null) registrar('clinica.tremor', { condicao: p.condicao, ponto: p.ponto, hz: r.hz, ppCm: r.ppCm, ppPctMao: r.ppPctMao, confianca: r.confianca, fs: r.fs, duracaoS: r.duracaoS });
    if (r.hz != null) ban(`tremor ${num(r.hz, 1)} Hz · ${r.ppCm != null ? num(r.ppCm, 2) + ' cm' : num(r.ppPx, 1) + ' px'} pico a pico · confiança ${num(r.confianca * 100, 0)} %`, r.confianca >= 0.5 ? COR.ok : COR.aviso);
    else ban(`tremor: ${(r.avisos && r.avisos[0]) || 'juntando amostras'}`, '#22d3ee');
    for (const a of (r.avisos || []).slice(r.hz != null ? 0 : 1, 2)) ban('⚠ ' + a, COR.alerta);
    ctx.metrics['tremor'] = r.hz != null ? `${num(r.hz, 1)} Hz` : '—';
    publicar('clinica.tremor', {
      titulo: 'Tremor de mão', saude: true, vitais: true, acaoRegistrar: 'Registrar medida',
      principal: { valor: r.hz, unidade: 'Hz', faixa: r.faixaHz, rotulo: `frequência dominante — ${p.condicao}`, casas: 1 },
      linhas: [['Amplitude pico a pico', r.ppCm != null ? num(r.ppCm, 2) + ' cm' : r.ppPx != null ? num(r.ppPx, 1) + ' px' : '—'], ['% do comprimento da mão', num(r.ppPctMao, 1) + ' %'],
        ['Confiança', r.confianca != null ? num(r.confianca * 100, 0) + ' %' : '—'], ['Amostras/s', num(r.fs, 0)], ['Fonte dos pontos', origem || '—']],
      avisos: r.avisos || [], espectro: r.espectro, serie: r.serie ? { ts: r.serie.map((_, i) => (i * 1000) / Math.min(60, r.fs)), ys: r.serie, rotulo: 'oscilação (px, sem o movimento voluntário)' } : null,
      registros: registrosDe('clinica.tremor'), colunas: ['n', 'quando', 'condicao', 'ponto', 'hz', 'ppCm', 'ppPctMao', 'confianca', 'fs', 'duracaoS'],
      fonte: 'Medida de frequência e amplitude; nenhuma classificação do tipo de tremor.',
    }, studioAberto() ? copiaQuadro(src) : null);
    return clone(src);
  },
};

// ------------------------------------------------------------------ 84 postura

export const postura = {
  op: 'clinica.postura',
  label: 'Postura estática (ombros, pelve, escoliose aparente)',
  group: G, overlayOnly: true,
  desc: 'Avaliação postural por foto ou vídeo, pessoa parada: de frente/costas, inclinação dos ombros, da pelve e da cabeça, ' +
        'desvio lateral do tronco e a diferença ombros − pelve (indicador de escoliose APARENTE, que não substitui o teste ' +
        'de Adams nem a radiografia); de lado, cabeça anteriorizada, tronco, quadril e a linha de prumo. Mediana de ~2 s, ' +
        'linhas de referência no vídeo e registro por captura. ' + AVISO_SAUDE,
  params: {
    vista: { type: 'enum', options: ['frontal', 'lateral'], default: 'frontal', label: 'Vista (frontal = de frente ou de costas)' },
    janelaS: { type: 'float', min: 0.5, max: 10, step: 0.5, default: 2, label: 'Mediana dos últimos (s)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.buf = []; }
    const R = obterPose(src, p, state, ctx);
    const ban = bannerista(ctx.overlay, ctx);
    ban(`⚠ ${AVISO_CURTO}`, COR.aviso);
    if (!R.P) { ban(`Postura: ${R.espera}`, COR.aviso); publicar('clinica.postura', { titulo: 'Postura estática', saude: true, avisos: [R.espera], linhas: [] }); return clone(src); }
    const sx = ctx.w / R.w, sy = ctx.h / R.h;
    esqueleto(ctx.overlay, R.P, sx, sy, p.minVis);
    if (R.novo) {
      state.buf.push({ t: R.t, m: medirPostura(R.P, p.vista, p.minVis) });
      while (state.buf.length && state.buf[0].t < R.t - p.janelaS * 1000) state.buf.shift();
    }
    const m = medianaPostura(state.buf.map((x) => x.m)) || {};
    // linhas de referência
    const L = m.linhas || {};
    const hor = (pt, cor) => pt && ctx.overlay.push({ type: 'line', x1: (pt.x - 120) * sx, y1: pt.y * sy, x2: (pt.x + 120) * sx, y2: pt.y * sy, color: cor, width: 1.5 });
    if (p.vista === 'frontal') {
      for (const [a, b, cor] of [[11, 12, '#22d3ee'], [23, 24, '#fb923c'], [2, 5, '#a78bfa']]) {
        const A = R.P[a], B = R.P[b];
        if (A && B && A.v >= p.minVis && B.v >= p.minVis) ctx.overlay.push({ type: 'line', x1: A.x * sx, y1: A.y * sy, x2: B.x * sx, y2: B.y * sy, color: cor, width: 3 });
      }
      hor(L.mo, 'rgba(255,255,255,.5)'); hor(L.mq, 'rgba(255,255,255,.5)');
      if (L.mt) ctx.overlay.push({ type: 'line', x1: L.mt.x * sx, y1: L.mt.y * sy, x2: L.mt.x * sx, y2: (L.mo ? L.mo.y - 80 : L.mt.y - 400) * sy, color: '#FFD84D', width: 1.5 });
    } else if (L.to) ctx.overlay.push({ type: 'line', x1: L.to.x * sx, y1: L.to.y * sy, x2: L.to.x * sx, y2: ((L.or || L.om).y - 40) * sy, color: '#FFD84D', width: 1.5 });
    const lado = (v) => (v == null ? '—' : `${num(Math.abs(v), 1)}° ${Math.abs(v) < 0.5 ? '(nivelado)' : v > 0 ? '(esquerdo mais baixo)' : '(direito mais baixo)'}`);
    const linhas = p.vista === 'frontal'
      ? [['Ombros', lado(m.ombros)], ['Pelve', lado(m.pelve)], ['Cabeça (olhos)', lado(m.cabeca)],
        ['Desvio lateral do tronco', m.troncoDesvioPct != null ? `${num(Math.abs(m.troncoDesvioPct), 0)} % da largura dos ombros (${m.troncoDesvioPct > 0 ? 'para a esquerda' : 'para a direita'})` : '—'],
        ['Ombros − pelve (escoliose aparente)', m.ombrosMenosPelve != null ? num(m.ombrosMenosPelve, 1) + '°' : '—'],
        ['Prumo: ombros × tornozelos', m.prumoPct != null ? num(m.prumoPct, 0) + ' %' : '—']]
      : [['Cabeça anteriorizada (orelha × ombro)', num(m.cabecaAnterior, 1) + '°'], ['Tronco (da vertical)', num(m.tronco, 1) + '°'], ['Quadril × joelho', num(m.quadrilJoelho, 1) + '°'],
        ['Joelho (flexão)', num(m.joelho, 0) + '°'], ...Object.entries(m.prumo || {}).map(([k, v]) => [`Prumo: ${k} à frente do tornozelo`, num(v, 0) + ' % da altura'])];
    const ped = consumirPedido('clinica.postura');
    if (ped && ped.acao === 'registrar') registrar('clinica.postura', { vista: p.vista, ...Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'number')) });
    if (p.vista === 'frontal') ban(`ombros ${lado(m.ombros)} · pelve ${lado(m.pelve)}`, '#22d3ee');
    else ban(`cabeça ${num(m.cabecaAnterior, 0)}° · tronco ${num(m.tronco, 0)}°`, '#22d3ee');
    const avisos = ['Pessoa parada, câmera nivelada (na altura do quadril) e perpendicular; roupa justa ajuda.'];
    if (R.fonte.startsWith('cadeia')) avisos.push('pose de 17 pontos: sem pés (o prumo usa os tornozelos)');
    publicar('clinica.postura', {
      titulo: 'Postura estática', saude: true, acaoRegistrar: 'Capturar',
      principal: p.vista === 'frontal' ? { valor: m.ombros != null ? Math.abs(m.ombros) : null, unidade: '°', rotulo: 'inclinação dos ombros', casas: 1 }
        : { valor: m.cabecaAnterior, unidade: '°', rotulo: 'cabeça anteriorizada', casas: 1 },
      linhas, avisos, registros: registrosDe('clinica.postura'), fonte: FONTES.sapo,
      colunas: ['n', 'quando', 'vista', 'ombros', 'pelve', 'cabeca', 'troncoDesvioPct', 'ombrosMenosPelve', 'prumoPct', 'cabecaAnterior', 'tronco', 'quadrilJoelho', 'joelho'],
    });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 86 marcha

export const marcha = {
  op: 'clinica.marcha',
  label: 'Marcha clínica (velocidade, passada, cadência, apoio)',
  group: G, overlayOnly: true,
  calibravel: { rotulo: 'Calibrar piso (2 linhas a distância conhecida)' },
  desc: 'Marcha de lado para a câmera, sobre o motor da Corrida (pés e pelve por quadro): cadência, tempo de passo, % de ' +
        'apoio de cada pé e, com o PISO CALIBRADO (duas linhas "Marcha · piso" a uma distância conhecida), a velocidade ' +
        'pelo tempo entre as linhas e o comprimento da passada. Sem as linhas, escala aproximada pela estatura. ' + AVISO_SAUDE,
  params: {
    distanciaM: { type: 'float', min: 1, max: 20, step: 0.5, default: 4, label: 'Distância entre as linhas do piso (m)' },
    alturaCm: { type: 'int', min: 0, max: 220, step: 1, default: 0, label: 'Estatura (cm, 0 = sem; escala de reserva)' },
    janelaS: { type: 'int', min: 5, max: 60, step: 1, default: 12, label: 'Janela analisada (s)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.am = []; state.cr = new Cronometro2Linhas(); state.r = null; }
    const R = obterPose(src, p, state, ctx);
    const ban = bannerista(ctx.overlay, ctx);
    ban(`⚠ ${AVISO_CURTO}`, COR.aviso);
    const linhasPiso = ctx.marcacoes ? ctx.marcacoes.itens.filter((i) => i.funcao === FUNC_PISO && i.px && i.px.length >= 2) : [];
    const xs = linhasPiso.slice(0, 2).map((i) => (i.px[0][0] + i.px[1][0]) / 2).sort((a, b) => a - b);
    let mPorPx = null, escalaTxt = 'sem escala (desenhe 2 linhas "Marcha · piso" ou informe a estatura)';
    if (xs.length === 2 && xs[1] - xs[0] > 20) { mPorPx = p.distanciaM / (xs[1] - xs[0]); escalaTxt = `piso calibrado: ${num(p.distanciaM, 1)} m entre as linhas`; }
    if (!R.P) { ban(`Marcha: ${R.espera}`, COR.aviso); publicar('clinica.marcha', { titulo: 'Marcha clínica', saude: true, avisos: [R.espera], linhas: [] }); return clone(src); }
    const sx = ctx.w / R.w, sy = ctx.h / R.h;
    esqueleto(ctx.overlay, R.P, sx, sy, p.minVis);
    if (R.novo) {
      const a = extrairCorrida(R.P, p.minVis); a.t = R.t;
      // em px do OVERLAY: as linhas do piso estão nesse espaço
      if (a.pel) a.pel = { x: a.pel.x * sx, y: a.pel.y * sy };
      for (const l of ['e', 'd']) if (a.pes[l]) a.pes[l] = { ...a.pes[l], ax: a.pes[l].ax * sx, x: a.pes[l].x * sx, y: a.pes[l].y * sy };
      if (a.perna) a.perna *= sy;
      state.am.push(a);
      while (state.am.length && state.am[0].t < R.t - p.janelaS * 1000) state.am.shift();
      if (a.pel && xs.length === 2) {
        const c = state.cr.passo(R.t, a.pel.x, xs[0], xs[1], p.distanciaM);
        if (c) registrar('clinica.marcha', { tempoS: c.tempoS, velocidade: c.velocidade, sentido: c.sentido, cadencia: state.r && state.r.cadencia, apoioE: state.r && state.r.apoioPct.e, apoioD: state.r && state.r.apoioPct.d, passadaM: state.r && state.r.tPassoMs ? c.velocidade * 2 * state.r.tPassoMs / 1000 : null });
      }
    }
    if (!mPorPx && p.alturaCm > 0) {
      const pernas = state.am.map((a) => a.perna).filter(Number.isFinite).sort((a, b) => a - b);
      const k = pernas.length ? escalaPerna(pernas[pernas.length >> 1], p.alturaCm) : null;   // cm/px
      if (k) { mPorPx = k / 100; escalaTxt = 'aproximada pela estatura (perna ≈ 0,491 × estatura)'; }
    }
    const agora = R.t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
    if (state.tA == null || agora - state.tA > 500 || agora < state.tA) { state.tA = agora; state.r = analisarMarcha(state.am, { mPorPx }); }
    const r = state.r || { apoioPct: {}, avisos: [] };
    const ult = state.cr.res;
    for (const x of xs) ctx.overlay.push({ type: 'line', x1: x, y1: 0, x2: x, y2: ctx.h, color: '#FFD84D', width: 1.5 });
    ban(`cadência ${num(r.cadencia, 0)} passos/min · apoio E ${num(r.apoioPct.e, 0)} % D ${num(r.apoioPct.d, 0)} %`, '#22d3ee');
    if (ult) ban(`último percurso: ${num(ult.tempoS, 2)} s → ${num(ult.velocidade, 2)} m/s`, COR.ok);
    for (const a of (r.avisos || []).slice(0, 1)) ban('⚠ ' + a, COR.alerta);
    ctx.metrics['marcha'] = `${num(r.cadencia, 0)} passos/min`;
    const vel = ult ? ult.velocidade : r.velocidade;
    publicar('clinica.marcha', {
      titulo: 'Marcha clínica', saude: true,
      principal: { valor: vel, unidade: 'm/s', rotulo: ult ? 'velocidade no percurso entre as linhas' : 'velocidade (escala aproximada)', casas: 2 },
      linhas: [['Cadência', num(r.cadencia, 0) + ' passos/min'], ['Tempo de passo', num(r.tPassoMs, 0) + ' ms'], ['Passada', r.passadaM != null ? num(r.passadaM, 2) + ' m' : '—'],
        ['Apoio pé esquerdo', num(r.apoioPct.e, 0) + ' %'], ['Apoio pé direito', num(r.apoioPct.d, 0) + ' %'], ['Escala', escalaTxt]],
      avisos: r.avisos || [], registros: registrosDe('clinica.marcha'), fonte: FONTES.marcha + ' ' + FONTES.apoio,
      colunas: ['n', 'quando', 'tempoS', 'velocidade', 'sentido', 'cadencia', 'passadaM', 'apoioE', 'apoioD'],
    });
    return clone(src);
  },
};

export default [tremor, postura, marcha];
