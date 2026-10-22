/**
 * operators/livres-h/salto.js — CV-31 Salto e testes físicos.
 *
 * Pose BlazePose seguida pelos próprios pontos (runtime/livres-h/pose.js), a
 * matemática em runtime/livres-h/salto.js e a sessão no canal
 * (runtime/livres-h/canal.js), que o painel Salto lê. Ao vivo, o instante de
 * cada amostra é o do quadro capturado (dividido pelo fator de câmera lenta);
 * a amostragem real aparece na incerteza de cada salto. Para a medida mais
 * fina, o painel analisa um arquivo quadro a quadro (runtime/livres-h/arquivo.js).
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { RastreadorPose, resolverEspelho, assinaturaQuadro } from '../../runtime/livres-h/pose.js';
import { TESTES, resumoSaltos, alertasSalto } from '../../runtime/livres-h/salto.js';
import { canalSalto } from '../../runtime/livres-h/canal.js';
import { num } from '../../runtime/livres-h/comum.js';
import { COR, esqueleto, linhaChao, bannerista } from './comum.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';

/** Rótulos do parâmetro → chave interna. */
export const OPCOES_TESTE = { 'CMJ': 'cmj', 'squat jump': 'sj', 'drop jump': 'dj', 'contínuos': 'continuo', 'horizontal': 'horizontal' };
export const ROTULO_TESTE = Object.fromEntries(Object.entries(OPCOES_TESTE).map(([k, v]) => [v, k]));

/** Configuração da análise a partir dos parâmetros do nó. */
export function cfgSalto(p) {
  return { teste: OPCOES_TESTE[p.teste] || 'cmj', alturaCm: p.alturaCm || 0, vista: p.vista === 'frontal' ? 'frontal' : 'lateral', lenta: p.lenta || 1 };
}

export const teste = {
  op: 'salto.teste',
  label: 'Salto — testes físicos',
  group: 'CV-31',
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Salto vertical (CMJ, squat jump), drop jump com tempo de contato e RSI, saltos contínuos com fadiga ' +
        'e salto horizontal. Altura pelo tempo de voo (h = g·t²/8) e pela subida do centro de massa, ' +
        'contramovimento, tempo de carga, ângulos na decolagem e na aterrissagem, valgo na vista frontal, ' +
        'com a incerteza da amostragem. Pose BlazePose no navegador. Painel Salto para as tentativas e o relatório.',
  params: {
    teste: { type: 'enum', options: Object.keys(OPCOES_TESTE), default: 'CMJ', label: 'Teste' },
    vista: { type: 'enum', options: ['lateral', 'frontal'], default: 'lateral', label: 'Vista da câmera' },
    alturaCm: { type: 'int', min: 0, max: 230, step: 1, default: 0, label: 'Altura da pessoa (cm, 0 = sem escala)' },
    lenta: { type: 'int', min: 1, max: 16, step: 1, default: 1, label: 'Câmera lenta (fator: 240 fps exibido a 30 = 8)' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.4, label: 'Visibilidade mín.' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 6000, label: 'Re-detectar pessoa (ms)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const canal = canalSalto, sessao = canal.sessao;
    const esp = resolverEspelho(p.espelhada, ctx);
    const cfg = cfgSalto(p);
    if (!state.rast) state.rast = new RastreadorPose();
    // trocar vista ou espelho mistura dois regimes de medida: sessão nova
    const assinatura = `${p.vista}|${esp}`;
    if (state.assinatura && state.assinatura !== assinatura) { canal.zerar(); state.rast.zerar(); }
    state.assinatura = assinatura;

    schedule(state, p.everyMs,
      () => {
        // fonte parada (YouTube pausado, histórico): não re-infere o mesmo quadro.
        // Só o sinal explícito — a pessoa parada antes do salto é medida.
        if (quadroRepetido(state, src, ctx, { forcar: convergindo(state.rast, state.results) })) return null;
        return { ...state.rast.preparar(src, performance.now(), { esp, detectarMs: p.detectarMs }), ass: assinaturaQuadro(src) };
      },
      async (prep) => {
        const r = await state.rast.estimar(prep);
        const tReal = prep.t / (cfg.lenta || 1);
        if (r.sem) {
          canal.publicar({ t: prep.t, sem: true, cfg, res: null, avisos: ['Ninguém no quadro.'] });
          return { sem: true };
        }
        if (r.aquecendo) return { P: r.P, w: prep.w, h: prep.h, aquecendo: true };
        // análise de arquivo em curso escreve na mesma sessão: o ao vivo espera
        // quadro repetido (pausa/congelado) não é amostra nova
        const novo = prep.ass !== state.assAnt; state.assAnt = prep.ass;
        if (novo && canal.gravando() && canal.origem.tipo === 'ao vivo') sessao.adicionar(tReal, r.P, p.minVis);
        // a análise completa é O(n): no máximo ~3×/s
        const agora = performance.now();
        if (!state.tAnal || agora - state.tAnal > 300) { state.res = sessao.analisar(cfg); state.tAnal = agora; }
        const res = state.res;
        canal.publicar({
          t: prep.t, cfg, res, P: r.P, w: prep.w, h: prep.h, vis: r.vis, esp,
          avisos: alertasSalto(res, cfg), inferMs: performance.now() - prep.t,
        });
        return { P: r.P, w: prep.w, h: prep.h, res };
      });

    if (state.inferMs) ctx.metrics['salto ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['salto erro'] = state.error;
    const r = state.results;
    const ban = bannerista(ctx.overlay, ctx);
    if (!r || r.sem) {
      ctx.metrics['salto'] = 'procurando a pessoa';
      ban('Salto: procurando a pessoa…', COR.aviso);
      return clone(src);
    }
    const sx = ctx.w / r.w, sy = ctx.h / r.h;
    esqueleto(ctx.overlay, r.P, sx, sy, p.minVis);
    if (r.aquecendo) { ban('Salto: ajustando a pose…', COR.aviso); return clone(src); }
    const res = r.res;
    if (res) {
      linhaChao(ctx.overlay, r.P, res.chaoAtual, sx, sy, res.estado === 'no ar' ? COR.ok : COR.chao);
      const tent = res.tentativas.filter((t) => !t.descartada);
      const ult = tent[tent.length - 1];
      const rs = resumoSaltos(res.tentativas, cfg.teste);
      ban(`${TESTES[cfg.teste].curto} · ${res.estado === 'no ar' ? 'NO AR' : res.estado}${res.dt ? ` · ${Math.round(1000 / res.dt)} Hz` : ''}`, res.estado === 'no ar' ? COR.ok : '#22d3ee');
      if (ult) {
        const v = cfg.teste === 'horizontal'
          ? `${ult.dist != null ? num(ult.dist, 0) + ' cm' : num(ult.distPx, 0) + ' px'}`
          : `${num(ult.hVoo, 1)} ± ${num(ult.hVooInc, 1)} cm (voo ${Math.round(ult.tv)} ms)`;
        ban(`Salto ${ult.n}: ${v}${ult.rsi != null ? ` · RSI ${num(ult.rsi, 2)}` : ''}`, COR.ok);
        if (rs.melhor && rs.n > 1) ban(`Melhor ${num(rs.melhor[rs.chave], 1)} cm · média ${num(rs.media, 1)} cm (${rs.n})`, '#e5e7eb');
        for (const a of ult.avisos.slice(0, 1)) ban('⚠ ' + a, COR.alerta);
        ctx.metrics['último salto'] = v;
      } else {
        ban(cfg.teste === 'dj' ? 'Suba na caixa, deixe-se cair e salte o mais rápido possível' : 'Fique parado de corpo inteiro e salte', COR.neutro);
      }
      ctx.metrics['saltos'] = tent.length;
      ctx.metrics['estado'] = res.estado;
    }
    ctx.metrics['salto'] = `${TESTES[cfg.teste].curto} · ${p.vista}${esp ? ' · espelhada' : ''}`;
    return clone(src);
  },
};

export default [teste];
