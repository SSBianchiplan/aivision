/**
 * operators/livres-t/rosto.js — CV-71 Rosto clínico (H4, 85), sobre a Malha
 * do rosto (rosto.malha ANTES na cadeia publica ctx.faceMesh). Só geometria
 * de pontos: nenhuma identificação facial, nenhuma imagem guardada.
 *
 *   rosto.assimetria  olho, sobrancelha e comissura em expressões guiadas; a
 *                     excursão de cada lado em relação ao repouso e o índice
 *   rosto.orofacial   exercícios de fono: repetições, amplitude e tempo sustentado
 */
import { clone } from '../../core.js';
import { medidasRosto, assimetriaRepouso, assimetriaExpressao, EXPRESSOES, OROFACIAL, analisarOrofacial, FONTES, AVISO_SAUDE } from '../../runtime/livres-t/clinica.js';
import { publicar, registrar, registrosDe, consumirPedido, geracaoAtual } from '../../runtime/livres-t/canal.js';
import { instante, bannerista, COR, num, AVISO_CURTO, faltaAntes } from './comum.js';

const G = 'CV-71';
const OPC_EXP = Object.fromEntries(Object.entries(EXPRESSOES).map(([k, e]) => [e.nome, k]));
const OPC_ORO = Object.fromEntries(Object.entries(OROFACIAL).map(([k, e]) => [e.nome, k]));

function mediaCampos(lista) {
  if (!lista.length) return null;
  const out = {};
  for (const k of Object.keys(lista[0])) {
    const v = lista[0][k];
    if (typeof v === 'number') out[k] = lista.reduce((s, m) => s + m[k], 0) / lista.length;
    else if (v && typeof v === 'object') out[k] = { d: lista.reduce((s, m) => s + m[k].d, 0) / lista.length, e: lista.reduce((s, m) => s + m[k].e, 0) / lista.length };
  }
  return out;
}

export const assimetria = {
  op: 'rosto.assimetria',
  label: 'Assimetria facial (expressões guiadas)',
  group: G, overlayOnly: true,
  desc: 'Mede a assimetria de olho (abertura), sobrancelha e comissura labial pela malha de 478 pontos, em repouso e nas ' +
        'expressões guiadas (fechar os olhos, elevar as sobrancelhas, sorrir, bico): a excursão de cada lado em relação ' +
        'ao repouso e o índice |D − E| / média. Registra cada expressão para acompanhar a evolução. Não gradua ' +
        '(House-Brackmann é do profissional). Coloque rosto.malha antes. ' + AVISO_SAUDE,
  params: {
    expressao: { type: 'enum', options: Object.keys(OPC_EXP), default: EXPRESSOES.repouso.nome, label: 'Expressão pedida' },
    rollMax: { type: 'int', min: 3, max: 30, step: 1, default: 12, label: 'Cabeça inclinada: avisar acima de (°)' },
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.base = null; state.buf = []; state.pico = null; }
    const chave = OPC_EXP[p.expressao] || 'repouso';
    if (state.chave !== chave) { state.chave = chave; state.pico = null; state.buf = []; }
    const f = Array.isArray(ctx.faceMesh) && ctx.faceMesh[0];
    const ban = bannerista(ctx.overlay, ctx);
    ban(`⚠ ${AVISO_CURTO}`, COR.aviso);
    if (!f) { const semMalha = faltaAntes('rosto.malha', 'Malha do rosto'); ban(semMalha, COR.alerta); publicar('rosto.assimetria', { titulo: 'Assimetria facial', saude: true, avisos: [semMalha], linhas: [] }); return clone(src); }
    const m = medidasRosto(f.pts, ctx.w, ctx.h);
    const t = instante(ctx);
    const avisos = [];
    if (Math.abs(m.roll) > p.rollMax) avisos.push(`cabeça inclinada ${num(m.roll, 0)}°: endireite (o índice é corrigido, mas a malha piora)`);
    if (f.pose && Math.abs(f.pose.yaw) > 12) avisos.push(`rosto virado ${num(f.pose.yaw, 0)}°: olhe para a câmera (de lado, um lado encolhe na imagem)`);
    state.buf.push({ t, m }); while (state.buf.length > 30) state.buf.shift();
    let exp = null;
    if (chave === 'repouso') state.base = mediaCampos(state.buf.slice(-15).map((x) => x.m));
    else if (state.base) {
      const a = assimetriaExpressao(state.base, m, chave);
      const tam = a ? Math.abs(a.excursao.d) + Math.abs(a.excursao.e) : 0;
      if (a && (!state.pico || tam > state.pico.tam)) state.pico = { ...a, tam, t };
      exp = state.pico;
    } else avisos.push('registre primeiro o REPOUSO (rosto relaxado) para medir as excursões');
    const rep = assimetriaRepouso(state.base || m);
    const ped = consumirPedido('rosto.assimetria');
    if (ped && ped.acao === 'registrar') {
      registrar('rosto.assimetria', chave === 'repouso'
        ? { expressao: 'repouso', olho: rep.olho, sobrancelha: rep.sobrancelha, comissura: rep.comissura }
        : { expressao: EXPRESSOES[chave].nome, indice: exp && exp.indice, indice2: exp && exp.indice2, menor: exp && exp.menor, excD: exp && exp.excursao.d, excE: exp && exp.excursao.e });
      state.pico = null;
    }
    // desenho: linha dos olhos e da boca
    const P = (i) => ({ x: f.pts[i].x * ctx.w, y: f.pts[i].y * ctx.h });
    for (const [a, b, cor] of [[33, 263, '#22d3ee'], [61, 291, '#f472b6'], [105, 334, '#FFD84D']]) { const A = P(a), B = P(b); ctx.overlay.push({ type: 'line', x1: A.x, y1: A.y, x2: B.x, y2: B.y, color: cor, width: 2 }); }
    if (chave === 'repouso') ban(`repouso · olho ${num(rep.olho, 0)} % · sobrancelha ${num(rep.sobrancelha, 0)} % · comissura ${num(rep.comissura, 1)} % (assimetria)`, '#22d3ee');
    else if (exp) ban(`${EXPRESSOES[chave].nome}: índice ${num(exp.indice, 0)} % · lado com menos movimento: ${exp.menor}`, exp.indice > 30 ? COR.alerta : COR.ok);
    for (const a of avisos.slice(0, 2)) ban('⚠ ' + a, COR.alerta);
    ctx.metrics['assimetria'] = exp ? `${num(exp.indice, 0)} %` : `repouso ${num(rep.olho, 0)}/${num(rep.sobrancelha, 0)} %`;
    publicar('rosto.assimetria', {
      titulo: 'Assimetria facial', saude: true, acaoRegistrar: 'Registrar expressão',
      principal: chave === 'repouso' ? { valor: rep.comissura, unidade: '%', rotulo: 'comissura em repouso (% da distância entre os olhos)' }
        : { valor: exp && exp.indice, unidade: '%', rotulo: `assimetria da excursão — ${EXPRESSOES[chave].nome}` },
      linhas: chave === 'repouso'
        ? [['Olho (abertura)', num(rep.olho, 0) + ' %'], ['Sobrancelha (altura)', num(rep.sobrancelha, 0) + ' %'], ['Comissura (altura)', num(rep.comissura, 1) + ' %'], ['Inclinação da cabeça', num(m.roll, 0) + '°']]
        : [['Excursão direita', exp ? num(exp.excursao.d * 100, 1) : '—'], ['Excursão esquerda', exp ? num(exp.excursao.e * 100, 1) : '—'],
          ['Lado com menos movimento', exp ? exp.menor : '—'], ...(exp && exp.indice2 != null ? [['Elevação da comissura (índice)', num(exp.indice2, 0) + ' %']] : [])],
      avisos, registros: registrosDe('rosto.assimetria'), fonte: FONTES.assimetria + ' ' + FONTES.houseBrackmann,
      colunas: ['n', 'quando', 'expressao', 'olho', 'sobrancelha', 'comissura', 'indice', 'indice2', 'menor', 'excD', 'excE'],
    });
    return clone(src);
  },
};

export const orofacial = {
  op: 'rosto.orofacial',
  label: 'Exercícios orofaciais (fono)',
  group: G, overlayOnly: true,
  desc: 'Exercícios de motricidade orofacial pela malha do rosto: abrir a boca, sorriso largo, bico, boca para os lados e ' +
        'inflar as bochechas. Conta as repetições, mede a amplitude (em distâncias entre os olhos, independente da ' +
        'distância da câmera) e o tempo sustentado; na lateralização compara os dois lados. Coloque rosto.malha antes. ' + AVISO_SAUDE,
  params: {
    exercicio: { type: 'enum', options: Object.keys(OPC_ORO), default: OROFACIAL.abrir.nome, label: 'Exercício' },
    metaReps: { type: 'int', min: 1, max: 100, step: 1, default: 10, label: 'Meta de repetições' },
    janelaS: { type: 'int', min: 10, max: 300, step: 5, default: 60, label: 'Janela analisada (s)' },
  },
  apply(src, p, state, ctx) {
    const chave = OPC_ORO[p.exercicio] || 'abrir';
    if (state.ger !== geracaoAtual() || state.chave !== chave) { state.ger = geracaoAtual(); state.chave = chave; state.ts = []; state.vs = []; state.base = null; state.r = null; }
    const f = Array.isArray(ctx.faceMesh) && ctx.faceMesh[0];
    const ban = bannerista(ctx.overlay, ctx);
    ban(`⚠ ${AVISO_CURTO}`, COR.aviso);
    if (!f) { const semMalha = faltaAntes('rosto.malha', 'Malha do rosto'); ban(semMalha, COR.alerta); publicar('rosto.orofacial', { titulo: 'Orofacial', saude: true, avisos: [semMalha], linhas: [] }); return clone(src); }
    const t = instante(ctx);
    const m = medidasRosto(f.pts, ctx.w, ctx.h);
    const v = OROFACIAL[chave].medida(m);
    if (t != null && (!state.ts.length || t > state.ts[state.ts.length - 1])) {
      state.ts.push(t); state.vs.push(v);
      while (state.ts.length && state.ts[0] < t - p.janelaS * 1000) { state.ts.shift(); state.vs.shift(); }
      if (state.base == null && state.ts.length >= 15) state.base = state.vs.slice(0, 15).sort((a, b) => a - b)[7];
    }
    const agora = t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
    if (state.tA == null || agora - state.tA > 300 || agora < state.tA) { state.tA = agora; state.r = analisarOrofacial(state.ts, state.vs, chave, state.base); }
    const r = state.r || { reps: 0 };
    const ped = consumirPedido('rosto.orofacial');
    if (ped && ped.acao === 'registrar') { registrar('rosto.orofacial', { exercicio: OROFACIAL[chave].nome, reps: r.reps, ampMedia: r.ampMedia ?? r.max, max: r.max, sustentadoS: r.sustentadoMs != null ? r.sustentadoMs / 1000 : null, simetria: r.simetria ?? null }); state.ts = []; state.vs = []; }
    const P = (i) => ({ x: f.pts[i].x * ctx.w, y: f.pts[i].y * ctx.h });
    for (const [a, b] of [[61, 291], [13, 14]]) { const A = P(a), B = P(b); ctx.overlay.push({ type: 'line', x1: A.x, y1: A.y, x2: B.x, y2: B.y, color: '#f472b6', width: 2 }); }
    ban(`${OROFACIAL[chave].nome}: ${r.reps}/${p.metaReps} repetições · amplitude máx ${num((r.max || 0) * 100, 0)}`, r.reps >= p.metaReps ? COR.ok : '#22d3ee');
    if (state.base == null) ban('fique com o rosto relaxado ~1 s para a referência', COR.aviso);
    ctx.metrics['orofacial'] = `${r.reps} rep.`;
    publicar('rosto.orofacial', {
      titulo: 'Exercícios orofaciais', saude: true, acaoRegistrar: 'Registrar série',
      principal: { valor: r.reps, unidade: `/ ${p.metaReps}`, rotulo: `repetições — ${OROFACIAL[chave].nome}`, casas: 0 },
      linhas: [['Amplitude média', num((r.ampMedia ?? 0) * 100, 1) + ' (% da dist. entre olhos)'], ['Amplitude máxima', num((r.max || 0) * 100, 1)],
        ...(r.sustentadoMs != null ? [['Sustentado (≥ 70 % do máx.)', num(r.sustentadoMs / 1000, 1) + ' s']] : []),
        ...(chave === 'lateral' ? [['Esquerda / direita', `${r.repsE ?? 0} / ${r.repsD ?? 0}`], ['Simetria das amplitudes', num(r.simetria, 0) + ' %']] : [])],
      avisos: [], registros: registrosDe('rosto.orofacial'), serie: { ts: state.ts.slice(), ys: state.vs.slice(), rotulo: 'medida (dist. entre olhos)' },
      colunas: ['n', 'quando', 'exercicio', 'reps', 'ampMedia', 'max', 'sustentadoS', 'simetria'],
    });
    return clone(src);
  },
};

export default [assimetria, orofacial];
