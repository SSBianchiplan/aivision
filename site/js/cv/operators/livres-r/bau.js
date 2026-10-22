/**
 * cv/operators/livres-r/bau.js — CV-58 Ocupação do baú do caminhão (64).
 *
 *   logistica.ocupacao_bau  sobre a profundidade RELATIVA do Depth Anything V2
 *                           (operador depth.map antes na cadeia): retângulo
 *                           "Baú · porta" na moldura da porta e "Baú · fundo"
 *                           na parede do fundo. A razão de tamanhos dá a
 *                           profundidade relativa do fundo; a profundidade
 *                           de cada raio que chegaria ao fundo dá onde a
 *                           carga começa → % de ocupação ESTIMADA
 *                           (runtime/livres-r/medidas.js › ocupacaoBau).
 *                           "Gravar baú vazio" no painel guarda a referência
 *                           do fundo e melhora a estimativa.
 *
 * É ESTIMATIVA: supõe carga encostada no fundo e câmera no eixo do baú; a
 * profundidade monocular não é métrica.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { ocupacaoBau, mediana } from '../../runtime/livres-r/medidas.js';
import { marcas, tomarComandos, empurrar, fmtN } from './comum.js';

export const G_BAU = 'CV-58';
export const AVISO_BAU = 'ESTIMATIVA pela profundidade relativa de uma câmera: supõe carga encostada no fundo e câmera no ' +
  'eixo do baú. Não substitui cubagem nem conferência.';

const corF = (f) => (f > 0.66 ? '#f87171' : f > 0.33 ? '#FFD84D' : '#4ade80');

export const ocupacao = {
  op: 'logistica.ocupacao_bau',
  label: 'Ocupação do baú (estimativa por profundidade)',
  group: G_BAU, overlayOnly: true,
  desc: 'Ocupação do baú do caminhão em %, ESTIMADA pela profundidade relativa (ponha "Profundidade (Depth Anything)" ' +
        'antes): retângulo "Baú · porta" na moldura da porta e "Baú · fundo" na parede do fundo. Grave o baú vazio no ' +
        'painel para referência. ' + AVISO_BAU,
  params: {
    intervalo: { type: 'int', min: 0, max: 10000, step: 100, default: 500, label: 'Calcular a cada (ms)' },
    suavizar: { type: 'int', min: 1, max: 30, step: 1, default: 5, label: 'Mediana das últimas N leituras' },
    mostrarGrade: { type: 'bool', default: true, label: 'Mostrar a grade de enchimento' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.bau', state) || !state.hist) { state.hist = []; state.ult = []; state.r = null; state.tLer = 0; state.dVazio = null; }
    const cmds = tomarComandos('r.bau');
    const porta = marcas(ctx, 'bau_porta')[0], fundo = marcas(ctx, 'bau_fundo')[0];
    const { w, h } = ctx;
    ctx.overlay.push({ type: 'banner', x: 8, y: h - 28, color: '#F2A900', text: 'Ocupação do baú: ESTIMATIVA (profundidade relativa)' });
    if (!porta || !fundo) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Baú: desenhe os retângulos "Baú · porta" (moldura) e "Baú · fundo" (parede do fundo)' });
      publicar('r.bau', { sem: 'marcações', aviso: AVISO_BAU });
      return clone(src);
    }
    if (!ctx.depth) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Baú: ponha "Profundidade (Depth Anything V2)" antes no Pipeline' });
      publicar('r.bau', { sem: 'profundidade', aviso: AVISO_BAU });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const dep = ctx.depth;
    for (const c of cmds) {
      if (c.acao === 'vazio') {
        const f = fundo.caixa, v = [];
        for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
          const x = Math.min(dep.w - 1, Math.floor((f.x1 + (f.x2 - f.x1) * (i + 0.5) / 12) * dep.w)), y = Math.min(dep.h - 1, Math.floor((f.y1 + (f.y2 - f.y1) * (j + 0.5) / 12) * dep.h));
          v.push(dep.data[y * dep.w + x]);
        }
        state.dVazio = mediana(v);
      }
      if (c.acao === 'sem_vazio') state.dVazio = null;
    }
    const agora = performance.now();
    if (!ctx.fonteParada && agora - state.tLer >= p.intervalo) {
      state.tLer = agora;
      const r = ocupacaoBau(dep, porta.caixa, fundo.caixa, state.dVazio);
      state.r = r;
      if (r && Number.isFinite(r.ocupacao)) {
        state.ult.push(r.ocupacao); if (state.ult.length > p.suavizar) state.ult.splice(0, state.ult.length - p.suavizar);
        empurrar(state.hist, t, 100 * mediana(state.ult));
      }
    }
    const r = state.r;
    const occ = state.ult.length ? 100 * mediana(state.ult) : NaN;
    const pc = porta.caixa, fc = fundo.caixa;
    ctx.overlay.push({ type: 'rect', x: pc.x1 * w, y: pc.y1 * h, w: (pc.x2 - pc.x1) * w, h: (pc.y2 - pc.y1) * h, color: '#38bdf8', label: `porta · ocupação ≈ ${fmtN(occ, 0)}%` });
    ctx.overlay.push({ type: 'rect', x: fc.x1 * w, y: fc.y1 * h, w: (fc.x2 - fc.x1) * w, h: (fc.y2 - fc.y1) * h, color: '#a78bfa', label: 'fundo' });
    if (p.mostrarGrade && r && r.grade) {
      const G = r.G;
      for (let j = 0; j < G; j += 2) for (let i = 0; i < G; i += 2) { const q = r.grade[j * G + i]; ctx.overlay.push({ type: 'point', x: q.x * w, y: q.y * h, r: 3, color: corF(q.f) }); }
    }
    if (r && r.erro) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: `Baú: ${r.erro}` });
    ctx.metrics['ocupação do baú'] = `≈ ${fmtN(occ, 0)}%${r && r.semRef ? ' (sem ref. vazio)' : ''}`;
    publicar('r.bau', { ocupacao: occ, semRef: r ? Boolean(r.semRef) : true, erro: r && r.erro, k: r && r.k, hist: state.hist.slice(-600),
                        comVazio: Number.isFinite(state.dVazio), aviso: AVISO_BAU, relogio });
    return clone(src);
  },
};

export default [ocupacao];
