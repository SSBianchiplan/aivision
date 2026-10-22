/**
 * operators/livres-t/casa.js — CV-73 Exercício domiciliar com correção ao vivo (H3).
 *
 * NÃO reescreve o motor da Academia: fica DEPOIS de academia.treino na cadeia
 * e lê o treino dele (runtime/livres-g/canal.js — repetições, séries, alertas
 * de forma). Acrescenta o que falta para o paciente em casa: a PRESCRIÇÃO
 * (exercício, séries, repetições, descanso — também por link #presc=…),
 * a CORREÇÃO POR VOZ (síntese de voz do navegador, pt-BR: a contagem, o
 * alerta de forma e o descanso), o relato de dor e o relatório para o
 * fisioterapeuta (painel › Exportar). Nada sai do aparelho.
 */
import { clone } from '../../core.js';
import { store, persist } from '../../../state/store.js';
import { obterTreino, geracaoTreino } from '../../runtime/livres-g/canal.js';
import { EXERCICIOS, OPCOES_EXERCICIO, idExercicio } from '../../runtime/livres-g/academia.js';
import { publicar, registrar, registrosDe, consumirPedido, geracaoAtual } from '../../runtime/livres-t/canal.js';
import { AVISO_SAUDE } from '../../runtime/livres-t/clinica.js';
import { bannerista, COR, num, AVISO_CURTO } from './comum.js';

const G = 'CV-73';
export const OP_CASA = 'casa.exercicio';
const NUMEROS = ['zero', 'uma', 'duas', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];

// ------------------------------------------------------------------ voz

let ultimaFala = 0;
export function falar(texto, { urgente = false } = {}) {
  const ss = globalThis.speechSynthesis;
  if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return false;
  if (urgente) ss.cancel();
  else if (ss.pending || (ss.speaking && performance.now() - ultimaFala < 800)) return false;
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR'; u.rate = 1.05;
  const v = ss.getVoices().find((x) => /^pt(-|_)BR/i.test(x.lang)) || ss.getVoices().find((x) => /^pt/i.test(x.lang));
  if (v) u.voice = v;
  ss.speak(u);
  ultimaFala = performance.now();
  return true;
}

// ------------------------------------------------------------------ prescrição por link

/** Codifica a prescrição para o link (#presc=…). */
export function linkPrescricao(pr, base = location.href.split('#')[0]) {
  const json = JSON.stringify({ e: pr.exercicio, s: pr.series, r: pr.reps, d: pr.descansoS, o: String(pr.obs || '').slice(0, 300) });
  return `${base}#presc=${btoa(unescape(encodeURIComponent(json)))}`;
}
export function lerPrescricao(hash = (typeof location !== 'undefined' ? location.hash : '')) {
  const m = /[#&]presc=([^&]+)/.exec(hash || '');
  if (!m) return null;
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(m[1])))));
    const ex = OPCOES_EXERCICIO.includes(o.e) ? o.e : 'automático';
    return { exercicio: ex, series: Math.max(1, Math.min(20, o.s | 0 || 3)), reps: Math.max(1, Math.min(100, o.r | 0 || 10)), descansoS: Math.max(0, Math.min(600, o.d | 0 || 60)), obs: String(o.o || '') };
  } catch (_) { return null; }
}
/** Monta a cadeia academia.treino → casa.exercicio com a prescrição e abre o painel. */
export function aplicarPrescricao(pr, newNodeId) {
  const st = store.get();
  const outros = st.nodes.filter((n) => n.op !== 'academia.treino' && n.op !== OP_CASA);
  const nodes = [...outros,
    { id: newNodeId(), op: 'academia.treino', enabled: true, params: { exercicio: pr.exercicio, metaSeries: pr.series, metaReps: pr.reps, descansoS: pr.descansoS, bipe: false } },
    { id: newNodeId(), op: OP_CASA, enabled: true, params: { exercicio: pr.exercicio, series: pr.series, reps: pr.reps, descansoS: pr.descansoS, obs: pr.obs || '' } }];
  store.set({ nodes, panels: { ...st.panels, onda2c: true } });
  persist();
}
// link aberto no aparelho do paciente: aplica a prescrição quando o app terminar de montar
if (typeof location !== 'undefined' && /[#&]presc=/.test(location.hash || '')) {
  setTimeout(async () => {
    const pr = lerPrescricao();
    if (!pr) return;
    const { newNodeId } = await import('../../executor.js');
    aplicarPrescricao(pr, newNodeId);
    try { history.replaceState(null, '', location.href.split('#')[0]); } catch (_) { /* sem history */ }
  }, 1500);
}

// ------------------------------------------------------------------ operador

export const casa = {
  op: OP_CASA,
  label: 'Exercício domiciliar com correção por voz',
  group: G, overlayOnly: true,
  desc: 'Para o paciente em casa: coloque DEPOIS de "Academia — repetições e forma" (o motor que conta e corrige a forma). ' +
        'Segue a prescrição do fisioterapeuta (exercício, séries, repetições, descanso — também por link), fala a contagem e ' +
        'a correção de forma em português (síntese de voz do navegador), avisa o descanso e o fim, registra cada série ' +
        'e o relato de dor, e gera o relatório para o fisioterapeuta. ' + AVISO_SAUDE,
  params: {
    exercicio: { type: 'enum', options: OPCOES_EXERCICIO, default: 'Agachamento', label: 'Exercício prescrito' },
    series: { type: 'int', min: 1, max: 20, step: 1, default: 3, label: 'Séries' },
    reps: { type: 'int', min: 1, max: 100, step: 1, default: 10, label: 'Repetições por série' },
    descansoS: { type: 'int', min: 0, max: 600, step: 5, default: 60, label: 'Descanso (s)' },
    voz: { type: 'enum', options: ['contagem e correção', 'só correção', 'desligada'], default: 'contagem e correção', label: 'Voz' },
    obs: { type: 'text', default: '', max: 300, label: 'Orientação do fisioterapeuta' },
  },
  apply(src, p, state, ctx) {
    const tr = obterTreino();
    if (state.ger !== geracaoAtual() || state.gerT !== geracaoTreino()) { state.ger = geracaoAtual(); state.gerT = geracaoTreino(); state.nReps = tr.reps.length; state.nSeries = tr.series.filter((s) => s.fechada).length; state.fim = false; state.inicio = null; }
    const ban = bannerista(ctx.overlay, ctx);
    const temAcademia = store.get().nodes.some((n) => n.op === 'academia.treino' && n.enabled);
    if (!temAcademia) { ban('Coloque "Academia — repetições e forma" ANTES deste nó', COR.alerta); publicar(OP_CASA, { titulo: 'Exercício domiciliar', saude: true, avisos: ['falta academia.treino antes na cadeia'], linhas: [] }); return clone(src); }
    const exId = idExercicio(p.exercicio);
    const fala = p.voz !== 'desligada';
    // repetições novas
    if (tr.reps.length > state.nReps) {
      const novas = tr.reps.slice(state.nReps);
      state.nReps = tr.reps.length;
      if (!state.inicio) state.inicio = new Date().toISOString();
      const r = novas[novas.length - 1];
      if (fala) {
        if (!r.boa && r.alertas && r.alertas.length) falar(r.alertas[0].curta.toLowerCase(), { urgente: true });
        else if (p.voz === 'contagem e correção') falar(r.ex === 'prancha' ? `${Math.round(r.dur)} segundos` : (NUMEROS[r.nSerie] || String(r.nSerie)));
      }
    }
    // séries fechadas
    const fechadas = tr.series.filter((s) => s.fechada && s.reps.length);
    if (fechadas.length > state.nSeries) {
      for (const s of fechadas.slice(state.nSeries)) {
        const cods = {};
        for (const r of s.reps) for (const a of r.alertas || []) cods[a.curta] = (cods[a.curta] || 0) + 1;
        registrar(OP_CASA, { exercicio: s.reps[0].ex ? EXERCICIOS[s.reps[0].ex].nome : p.exercicio, serie: s.n, reps: s.reps.length, meta: p.reps, boas: s.boas || 0,
          comAlerta: s.alerta || 0, alertas: Object.entries(cods).map(([k, n]) => `${k} (${n})`).join(' · ') });
      }
      state.nSeries = fechadas.length;
      const feitas = fechadas.length;
      if (fala) falar(feitas >= p.series ? 'Prescrição concluída. Muito bem!' : `Série ${feitas} concluída. Descanse ${p.descansoS} segundos.`, { urgente: true });
      if (feitas >= p.series) state.fim = true;
      else state.tDescanso = performance.now();
    }
    if (state.tDescanso && performance.now() - state.tDescanso > p.descansoS * 1000) { state.tDescanso = null; if (fala) falar('Descanso terminado. Próxima série.', { urgente: true }); }
    const ped = consumirPedido(OP_CASA);
    if (ped && ped.acao === 'dor') registrar(OP_CASA, { exercicio: p.exercicio, dor: ped.dados, relato: 'dor (0–10) informada pelo paciente' });
    const s = tr.serieAberta();
    const feitas = fechadas.length;
    const resto = state.tDescanso ? Math.max(0, p.descansoS - (performance.now() - state.tDescanso) / 1000) : null;
    ban(`⚠ ${AVISO_CURTO} · pare se sentir dor`, COR.aviso);
    ban(state.fim ? 'PRESCRIÇÃO CONCLUÍDA ✓' : `Série ${Math.min(p.series, feitas + 1)} de ${p.series} · ${s ? s.reps.length : 0}/${p.reps} repetições${resto != null ? ` · descanso ${Math.ceil(resto)} s` : ''}`, state.fim ? COR.ok : '#22d3ee');
    if (exId && tr.exAtual && tr.exAtual !== exId) ban(`A Academia está em "${EXERCICIOS[tr.exAtual].nome}"; a prescrição é "${p.exercicio}"`, COR.alerta);
    ctx.metrics['domiciliar'] = `${feitas}/${p.series} séries`;
    const reg = registrosDe(OP_CASA);
    const totReps = reg.reduce((a, r) => a + (r.reps || 0), 0), totBoas = reg.reduce((a, r) => a + (r.boas || 0), 0);
    publicar(OP_CASA, {
      titulo: 'Exercício domiciliar', saude: true, prescricao: { exercicio: p.exercicio, series: p.series, reps: p.reps, descansoS: p.descansoS, obs: p.obs },
      principal: { valor: feitas, unidade: `/ ${p.series} séries`, rotulo: p.exercicio, casas: 0 },
      linhas: [['Série atual', s ? `${s.reps.length}/${p.reps} repetições` : '—'], ['Repetições registradas', String(totReps)], ['Boas (sem alerta de forma)', totReps ? `${totBoas} (${num((100 * totBoas) / totReps, 0)} %)` : '—'],
        ['Descanso', resto != null ? `${Math.ceil(resto)} s` : '—'], ...(p.obs ? [['Orientação', p.obs]] : [])],
      avisos: ['Pare e fale com o fisioterapeuta se sentir dor, tontura ou falta de ar.'], registros: reg,
      colunas: ['n', 'quando', 'exercicio', 'serie', 'reps', 'meta', 'boas', 'comAlerta', 'alertas', 'dor', 'relato'],
      fonte: 'Contagem e forma: motor da Academia (CV-30). Validação de correção por visão contra fisioterapeutas: Kaia Health, estudo clínico (JMIR 2021).',
    });
    return clone(src);
  },
};

export default [casa];
