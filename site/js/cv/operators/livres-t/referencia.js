/**
 * operators/livres-t/referencia.js — CV-75 Comparar com a referência (E3, 91).
 *
 *   referencia.comparar  grava um movimento de referência (o professor, o vídeo
 *                        modelo) e compara cada tentativa: DTW entre as séries de
 *                        ângulos, nota e articulação mais divergente por fase
 *   yoga.pose            pose de referência capturada, semelhança ao vivo e tempo sustentado
 *
 * As referências ficam só neste navegador (localStorage), como ângulos e
 * esqueleto normalizado — nenhuma imagem.
 */
import { clone } from '../../core.js';
import { vetorAngulos, poseNormalizada, compactar, compararMovimento, GatilhoMovimento, semelhancaPose, Sustentacao, NOMES_ANG, FONTES_ESP } from '../../runtime/livres-t/esportes.js';
import { publicar, registrar, registrosDe, consumirPedido, geracaoAtual, referencias, salvarReferencia, studioAberto } from '../../runtime/livres-t/canal.js';
import { obterPose, PARAMS_POSE, esqueleto, bannerista, COR, num, copiaQuadro } from './comum.js';

const G = 'CV-75';
const sinal = (d) => (Math.abs(d) < 0.5 ? '0' : (d > 0 ? '+' : '') + num(d, 0));

export const comparar = {
  op: 'referencia.comparar',
  label: 'Comparar com o movimento de referência',
  group: G, overlayOnly: true,
  desc: 'Grave o movimento modelo (saque, chute, golpe, passo de dança, exercício) e compare cada tentativa: as séries de ' +
        'ângulos (cotovelos, ombros, quadris, joelhos, tronco) são alinhadas no tempo por DTW, e cada FASE ganha uma nota ' +
        '0–100, a articulação que mais diverge (com o sinal) e o ritmo relativo. Gatilho automático pelo movimento ou ' +
        'manual. Studio com a referência e a tentativa lado a lado.',
  params: {
    modo: { type: 'enum', options: ['comparar com a referência', 'gravar referência'], default: 'comparar com a referência', label: 'Modo' },
    referencia: { type: 'text', default: 'movimento 1', max: 60, label: 'Nome da referência' },
    gatilho: { type: 'enum', options: ['automático (movimento)', 'manual (painel)'], default: 'automático (movimento)', label: 'Início e fim' },
    nFases: { type: 'int', min: 2, max: 8, step: 1, default: 4, label: 'Fases' },
    espelho: { type: 'bool', default: true, label: 'Aceitar o lado trocado (canhoto × destro)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.gat = new GatilhoMovimento(); state.grav = null; state.ult = null; }
    const R = obterPose(src, p, state, ctx);
    const ban = bannerista(ctx.overlay, ctx);
    const gravarRef = p.modo === 'gravar referência';
    const ref = referencias('movimento')[p.referencia];
    const ped = consumirPedido('referencia.comparar');
    if (ped && ped.acao === 'iniciar') state.grav = [];
    let terminou = ped && ped.acao === 'parar' && state.grav;
    if (R.P) {
      const sx = ctx.w / R.w, sy = ctx.h / R.h;
      esqueleto(ctx.overlay, R.P, sx, sy, p.minVis, null, state.grav ? '#f87171' : null);
      if (R.novo) {
        const ang = vetorAngulos(R.P, p.minVis);
        if (p.gatilho.startsWith('automático')) {
          const ev = state.gat.passo(R.t, ang);
          if (ev === 'inicio' && !state.grav) state.grav = [];
          if (ev === 'fim' && state.grav) terminou = true;
        }
        if (state.grav) { state.grav.push({ t: R.t, ang, pose: poseNormalizada(R.P, p.minVis) }); if (state.grav.length > 3000) terminou = true; }
      }
    } else ban(`Referência: ${R.espera}`, COR.aviso);
    if (terminou) {
      const g = state.grav; state.grav = null;
      const dur = g.length > 1 ? (g[g.length - 1].t - g[0].t) / 1000 : 0;
      if (g.length >= 8 && dur >= 0.4) {
        const t0 = g[0].t, am = compactar(g.map((a) => ({ ...a, t: a.t - t0 })), 240);
        if (gravarRef) { salvarReferencia('movimento', p.referencia, { amostras: am, duracaoS: dur }); state.ult = { gravada: true, nome: p.referencia, duracaoS: dur }; }
        else if (ref) {
          const c = compararMovimento(ref.amostras, am, { nFases: p.nFases, espelho: p.espelho });
          if (c) {
            state.ult = { ...c, tent: am, nome: p.referencia };
            const linha = { referencia: p.referencia, nota: c.nota, duracaoS: c.duracaoTent, duracaoRefS: c.duracaoRef, lado: c.lado };
            c.fases.forEach((f) => { linha['fase' + f.n] = f.nota; linha['pior' + f.n] = f.pior ? `${f.pior.nome} ${sinal(f.pior.delta)}°` : ''; });
            registrar('referencia.comparar', linha);
          }
        }
      }
    }
    const u = state.ult;
    if (state.grav) ban(`● gravando ${gravarRef ? 'a REFERÊNCIA' : 'a tentativa'} (${state.grav.length} quadros)`, COR.alerta);
    else if (gravarRef) ban(u && u.gravada ? `Referência "${u.nome}" gravada (${num(u.duracaoS, 1)} s). Mude o modo para comparar.` : `Faça o movimento modelo: "${p.referencia}"`, '#22d3ee');
    else if (!ref) ban(`Não há referência "${p.referencia}": grave primeiro (modo "gravar referência")`, COR.aviso);
    else if (u && u.fases) {
      ban(`nota ${num(u.nota, 0)} · ` + u.fases.map((f) => `F${f.n} ${num(f.nota, 0)}`).join(' · '), u.nota >= 80 ? COR.ok : u.nota >= 60 ? COR.aviso : COR.alerta);
      const pior = u.fases.slice().sort((a, b) => a.nota - b.nota)[0];
      if (pior && pior.pior) ban(`fase ${pior.n}: ${pior.pior.nome} ${sinal(pior.pior.delta)}° em relação à referência`, COR.neutro);
    } else ban(`Pronto: faça o movimento (referência "${p.referencia}", ${num(ref.duracaoS, 1)} s)`, '#22d3ee');
    ctx.metrics['referência'] = u && u.nota != null ? `${num(u.nota, 0)}` : '—';
    publicar('referencia.comparar', {
      titulo: 'Comparar com a referência', comparacao: true,
      principal: { valor: u && u.nota, unidade: '/ 100', rotulo: `nota da última tentativa — "${p.referencia}"`, casas: 0 },
      linhas: u && u.fases ? [...u.fases.map((f) => [`Fase ${f.n}`, `${num(f.nota, 0)} · ${f.pior ? f.pior.nome + ' ' + sinal(f.pior.delta) + '°' : '—'} · ritmo ${num(f.tempoRel, 2)}×`]),
        ['Duração (tentativa / referência)', `${num(u.duracaoTent, 2)} / ${num(u.duracaoRef, 2)} s`], ['Lado', u.lado === 'trocado' ? 'trocado (espelhado)' : 'o mesmo']]
        : [['Referência', ref ? `"${p.referencia}" (${num(ref.duracaoS, 1)} s)` : 'nenhuma'], ['Gatilho', p.gatilho]],
      avisos: ['Mesma vista de câmera na referência e na tentativa (ângulos 2D).'], acoes: ['iniciar', 'parar'],
      registros: registrosDe('referencia.comparar'), colunas: ['n', 'quando', 'referencia', 'nota', 'duracaoS', 'duracaoRefS', 'lado', ...Array.from({ length: p.nFases }, (_, i) => [`fase${i + 1}`, `pior${i + 1}`]).flat()],
      fonte: 'Alinhamento temporal: ' + FONTES_ESP.dtw, extra: { ref: ref ? ref.amostras : null, tent: u && u.tent, caminho: u && u.caminho, poseAgora: R.P ? poseNormalizada(R.P, p.minVis) : null, gravando: Boolean(state.grav) },
    }, studioAberto() ? copiaQuadro(src) : null);
    return clone(src);
  },
};

export const yoga = {
  op: 'yoga.pose',
  label: 'Yoga — pose de referência e tempo sustentado',
  group: G, overlayOnly: true,
  desc: 'Capture a pose de referência (o professor na pose, botão "Capturar pose" no painel) e o aluno a reproduz: ' +
        'semelhança 0–100 pelos ângulos das articulações, a articulação mais longe da referência e o tempo sustentado ' +
        'acima do limiar (quedas curtas toleradas). Aceita o lado trocado. Registra cada sustentação.',
  params: {
    referencia: { type: 'text', default: 'pose 1', max: 60, label: 'Nome da pose de referência' },
    limiar: { type: 'int', min: 50, max: 98, step: 1, default: 80, label: 'Conta como "na pose" acima de' },
    espelho: { type: 'bool', default: true, label: 'Aceitar o lado trocado' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.sus = new Sustentacao(); state.s = null; }
    const R = obterPose(src, p, state, ctx);
    const ban = bannerista(ctx.overlay, ctx);
    const ref = referencias('yoga')[p.referencia];
    const ped = consumirPedido('yoga.pose');
    if (!R.P) { ban(`Yoga: ${R.espera}`, COR.aviso); publicar('yoga.pose', { titulo: 'Yoga', avisos: [R.espera], linhas: [], acoes: ['capturar'] }); return clone(src); }
    const ang = vetorAngulos(R.P, p.minVis);
    if (ped && ped.acao === 'capturar') salvarReferencia('yoga', (ped.dados && ped.dados.nome) || p.referencia, { ang, pose: poseNormalizada(R.P, p.minVis) });
    if (R.novo && ref) {
      state.s = semelhancaPose(ref.ang, ang, { espelho: p.espelho });
      const f = state.sus.passo(R.t, state.s ? state.s.nota : null, p.limiar);
      if (f) registrar('yoga.pose', { pose: p.referencia, sustentadoS: f.durS, limiar: p.limiar });
    }
    const s = state.s;
    const na = s && s.nota >= p.limiar;
    esqueleto(ctx.overlay, R.P, ctx.w / R.w, ctx.h / R.h, p.minVis, null, ref ? (na ? COR.ok : null) : null);
    if (!ref) ban(`Sem a pose "${p.referencia}": faça a pose e toque em "Capturar pose" no painel`, COR.aviso);
    else if (s) {
      ban(`${p.referencia}: ${num(s.nota, 0)} / 100 ${na ? '· NA POSE ' + num(state.sus.atualMs / 1000, 1) + ' s' : ''}`, na ? COR.ok : s.nota >= p.limiar - 15 ? COR.aviso : COR.alerta);
      if (s.pior && Math.abs(s.pior.delta) > 10) ban(`${s.pior.nome}: ${sinal(s.pior.delta)}° (${s.pior.delta > 0 ? 'mais aberto' : 'mais fechado'} que a referência)`, COR.neutro);
    }
    ctx.metrics['yoga'] = s ? num(s.nota, 0) : '—';
    publicar('yoga.pose', {
      titulo: 'Yoga — pose de referência', acoes: ['capturar'],
      principal: { valor: s && s.nota, unidade: '/ 100', rotulo: ref ? `semelhança com "${p.referencia}"` : 'sem referência', casas: 0 },
      linhas: [['Na pose agora', na ? num(state.sus.atualMs / 1000, 1) + ' s' : '—'], ['Melhor sustentação', num(state.sus.melhorMs / 1000, 1) + ' s'],
        ['Mais longe da referência', s && s.pior ? `${s.pior.nome} ${sinal(s.pior.delta)}°` : '—'], ['Lado', s ? (s.lado === 'trocado' ? 'trocado' : 'o mesmo') : '—']],
      avisos: ['Mesma vista de câmera na captura e na prática.'], registros: registrosDe('yoga.pose'), colunas: ['n', 'quando', 'pose', 'sustentadoS', 'limiar'],
      extra: { refPose: ref ? ref.pose : null, poseAgora: poseNormalizada(R.P, p.minVis), nomes: NOMES_ANG },
    });
    return clone(src);
  },
};

export default [comparar, yoga];
