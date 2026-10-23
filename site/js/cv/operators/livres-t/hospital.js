/**
 * operators/livres-t/hospital.js — CV-74 Hospital e ILPI (H5).
 *
 *   hospital.maos   higiene das mãos: sessões, tempo de fricção e os 6 movimentos
 *                   da OMS reconhecidos pela geometria das duas mãos (INDICATIVO),
 *                   sobre "Mãos e gestos" (ctx.hands) antes na cadeia
 *   hospital.queda  queda e imobilidade de paciente: IMPORTA o seguranca.queda
 *                   (CV-43) sem alterá-lo e acrescenta o modo "só esqueleto"
 *                   (o vídeo vira fundo escuro; a pose do RTMO continua desenhada)
 */
import { clone } from '../../core.js';
import { queda } from '../livres-oa/seguranca.js';
import { classificarMaos, SessaoMaos, PASSOS_OMS, FONTES, AVISO_SAUDE } from '../../runtime/livres-t/clinica.js';
import { publicar, registrar, registrosDe, geracaoAtual } from '../../runtime/livres-t/canal.js';
import { instante, bannerista, COR, num, faltaAntes } from './comum.js';

const G = 'CV-74';
const METAS = { 'fricção com álcool (20–30 s)': 20, 'água e sabão (40–60 s)': 40 };

export const maos = {
  op: 'hospital.maos',
  label: 'Higiene das mãos (passos da OMS, indicativo)',
  group: G, overlayOnly: true,
  desc: 'Conta as higienizações (mãos juntas friccionando), o tempo de fricção contra a meta da OMS (20–30 s com álcool, ' +
        '40–60 s com água e sabão) e os 6 movimentos (palma com palma, dorsos, entrelaçados, dedos travados, polegar, ' +
        'pontas dos dedos) pela geometria das duas mãos — INDICATIVO: com uma câmera as mãos se escondem. Coloque ' +
        '"Mãos e gestos" (máx. 2 mãos) antes. Sem identificar ninguém. Apoio à auditoria da CCIH, não a substitui.',
  params: {
    metodo: { type: 'enum', options: Object.keys(METAS), default: 'fricção com álcool (20–30 s)', label: 'Método' },
    minPassoS: { type: 'float', min: 0.5, max: 10, step: 0.5, default: 2, label: 'Passo conta com (s acumulados)' },
  },
  apply(src, p, state, ctx) {
    if (!state.s || state.ger !== geracaoAtual()) { state.s = new SessaoMaos(); state.ger = geracaoAtual(); }
    const ban = bannerista(ctx.overlay, ctx);
    const hs = Array.isArray(ctx.hands) ? ctx.hands : null;
    if (!hs) { const m = faltaAntes('maos.gestos', 'Mãos e gestos'); ban(m, COR.alerta); publicar('hospital.maos', { titulo: 'Higiene das mãos', avisos: [m], linhas: [] }); return clone(src); }
    const px = (h) => h.pts.map((q) => ({ x: q.x * ctx.w, y: q.y * ctx.h }));
    const cls = hs.length >= 2 ? classificarMaos(px(hs[0]), px(hs[1])) : { passo: null, juntas: false };
    const t = instante(ctx) ?? performance.now();
    const meta = METAS[p.metodo] || 20;
    const fechada = state.s.passo(t, cls, meta);
    if (fechada) {
      const feitos = PASSOS_OMS.filter((x) => (fechada.passos[x.id] || 0) >= p.minPassoS * 1000).map((x) => x.id);
      registrar('hospital.maos', { metodo: p.metodo, friccaoS: fechada.friccaoS, metaS: meta, tempoOk: fechada.friccaoS >= meta ? 'sim' : 'não', passos: feitos.join(','), nPassos: feitos.length });
    }
    const a = state.s.atual;
    const ok = (id) => a && (a.passos[id] || 0) >= p.minPassoS * 1000;
    if (a) {
      ban(`higienizando · ${num(a.friccaoMs / 1000, 0)} / ${meta} s · ${cls.passo ? 'passo ' + cls.passo + ': ' + PASSOS_OMS[cls.passo - 1].nome : 'movimento não reconhecido'}`, a.friccaoMs / 1000 >= meta ? COR.ok : '#22d3ee');
      ban('OMS: ' + PASSOS_OMS.map((x) => (ok(x.id) ? '✓' : '·') + x.id).join(' '), COR.neutro);
    } else ban(`Higiene das mãos: ${hs.length < 2 ? 'mostre as duas mãos' : 'junte as mãos para começar'} · ${state.s.sessoes.length} registradas`, COR.neutro);
    ban('Indicativo: confira visualmente', COR.aviso);
    ctx.metrics['higienizações'] = state.s.sessoes.length;
    const reg = registrosDe('hospital.maos');
    publicar('hospital.maos', {
      titulo: 'Higiene das mãos (indicativo)',
      principal: { valor: a ? a.friccaoMs / 1000 : reg.length ? reg[reg.length - 1].friccaoS : null, unidade: `s / ${meta} s`, rotulo: a ? 'fricção em curso' : 'última higienização', casas: 0 },
      linhas: [...PASSOS_OMS.map((x) => [`${x.id}. ${x.nome}`, a ? `${num((a.passos[x.id] || 0) / 1000, 1)} s${ok(x.id) ? ' ✓' : ''}` : '—']),
        ['Higienizações registradas', String(reg.length)], ['Com tempo ≥ meta', String(reg.filter((r) => r.tempoOk === 'sim').length)]],
      avisos: ['Indicativo: a câmera 2D não vê as mãos por inteiro; serve para triagem e treino, não como auditoria final.'],
      registros: reg, colunas: ['n', 'quando', 'metodo', 'friccaoS', 'metaS', 'tempoOk', 'passos', 'nPassos'], fonte: FONTES.oms,
    });
    return clone(src);
  },
};

export const quedaHospital = {
  op: 'hospital.queda',
  label: 'Queda de paciente (hospital/ILPI), só esqueleto',
  group: G,
  // «só esqueleto» troca a imagem por fundo escuro (privacidade); «vídeo normal» só desenha
  overlayOnly: (p) => p.privacidade !== 'só esqueleto',
  desc: 'O detector de queda e imobilidade do CV-43 (seguranca.queda, importado sem mudança) com os ajustes de quarto ' +
        '(alarme de pessoa no chão em 10 s, imobilidade em 60 s) e o modo "só esqueleto": o vídeo vira fundo escuro e ' +
        'fica só a pose — sem rosto, sem imagem do paciente. Coloque a Pose multi-pessoa (RTMO) antes. Indicador de apoio ' +
        'à equipe; não substitui a ronda nem sensor homologado.',
  params: {
    privacidade: { type: 'enum', options: ['só esqueleto', 'vídeo normal'], default: 'só esqueleto', label: 'Exibição' },
    noChaoS: { type: 'float', min: 1, max: 600, step: 1, default: 10, label: 'Alarme de pessoa no chão após (s)' },
    imovelS: { type: 'float', min: 2, max: 600, step: 1, default: 60, label: 'Imobilidade: parado por (s)' },
    kpConf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mínimo do ponto' },
  },
  apply(src, p, state, ctx) {
    if (!state.q) state.q = {};
    const pq = { ...Object.fromEntries(Object.entries(queda.params).map(([k, d]) => [k, d.default])), noChaoS: p.noChaoS, imovelS: p.imovelS, kpConf: p.kpConf };
    queda.apply(src, pq, state.q, ctx);
    const pessoas = Array.isArray(ctx.poses) ? ctx.poses.length : 0;
    publicar('hospital.queda', {
      titulo: 'Queda (hospital/ILPI)', principal: { valor: Number(ctx.metrics['quedas'] || 0), unidade: 'quedas', rotulo: `${pessoas} pessoa(s) na cena`, casas: 0 },
      linhas: [['Exibição', p.privacidade], ['Alarme no chão', `${p.noChaoS} s`], ['Imobilidade', `${p.imovelS} s`]],
      avisos: Array.isArray(ctx.poses) ? [] : [faltaAntes('pose.rtmo', 'Pose multi-pessoa (RTMO)')], fonte: 'Regra de queda do CV-43 (painel Medições › Segurança tem os alarmes e o CSV).',
    });
    if (p.privacidade !== 'só esqueleto') return clone(src);
    const out = new ImageData(src.width, src.height);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 8; d[i + 1] = 20; d[i + 2] = 24; d[i + 3] = 255; }
    return out;
  },
};

export default [maos, quedaHospital];
export { AVISO_SAUDE };
