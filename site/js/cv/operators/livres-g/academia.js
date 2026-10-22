/**
 * operators/livres-g/academia.js — CV-30 Academia (repetições e forma).
 *
 * Pose de uma pessoa (YOLOX + BlazePose seguido, ver pose-seguida.js) →
 * medidas por quadro → exercício (escolhido ou reconhecido) → repetições,
 * séries, tempos e checagens de forma (runtime/livres-g/academia.js). O
 * treino mora no canal (runtime/livres-g/canal.js), que o painel Academia
 * assina.
 *
 * No vídeo: esqueleto, o ângulo da articulação principal, o placar em
 * números GRANDES (feitos de linhas — o overlay não tem texto grande, ver
 * fonte-traco.js) e o feedback de cada repetição ("BOA!" ou o alerta).
 * Opcional: bipe a cada repetição (agudo = boa, dois graves = com alerta).
 *
 * Tudo roda no navegador; nada da imagem sai do aparelho.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import {
  EXERCICIOS, OPCOES_EXERCICIO, TOLERANCIAS, TAXA_MIN_HZ, idExercicio, medir, indicesLado, num, mmss,
} from '../../runtime/livres-g/academia.js';
import { textoTraco, quebrar, larguraTexto } from '../../runtime/livres-g/fonte-traco.js';
import { obterTreino, publicar, estaGravando, geracaoTreino, bipe } from '../../runtime/livres-g/canal.js';
import { preparar, seguir, espelhoEfetivo } from './pose-seguida.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';

/** Articulação principal (pontos A–B–C, ângulo em B) por exercício. */
const ARTIC = {
  agachamento: ['quadril', 'joelho', 'tornozelo'], afundo: ['quadril', 'joelho', 'tornozelo'],
  flexao: ['ombro', 'cotovelo', 'punho'], rosca: ['ombro', 'cotovelo', 'punho'], desenvolvimento: ['ombro', 'cotovelo', 'punho'],
  terra: ['ombro', 'quadril', 'joelho'], abdominal: ['ombro', 'quadril', 'joelho'],
  polichinelo: ['quadril', 'ombro', 'punho'], prancha: ['ombro', 'quadril', 'tornozelo'],
};
const OSSOS = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27],
  [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32]];
const ESQ = new Set([11, 13, 15, 23, 25, 27, 29, 31]);
const COR = { ok: '#4ade80', alerta: '#fb923c', info: '#22d3ee', neutro: '#e5e7eb', aviso: '#FFD84D' };
const NOME_FASE = (ex, fase) => {
  const e = EXERCICIOS[ex];
  if (!e || !e.fases.length || !fase) return '';
  if (fase === 'repouso') return 'pronto';
  return fase === 'ida' ? e.fases[0] : e.fases[1];
};

/** px de TELA por px do quadro (o traço do texto grande acompanha a letra). Lê o canvas do Viewport, 1×/s. */
function escalaTela(state, ctx) {
  const agora = performance.now();
  if (state.escT && agora - state.escT < 1000) return state.esc;
  state.escT = agora;
  try {
    const c = typeof document !== 'undefined' && document.querySelector('canvas.stage');
    if (c) { const r = c.getBoundingClientRect(); state.esc = Math.min(r.width / ctx.w, r.height / ctx.h) || 1; }
  } catch (_) { /* sem DOM (teste) */ }
  return state.esc || 1;
}

function cfgDe(p, esp) {
  return {
    exercicio: idExercicio(p.exercicio), pausaSerieS: p.pausaSerieS, tol: TOLERANCIAS[p.tolerancia] || 1, esp,
    metaSeries: p.metaSeries, metaReps: p.metaReps, metaSegundos: p.metaSegundos, descansoS: p.descansoS,
  };
}

export const treinoOp = {
  op: 'academia.treino',
  label: 'Academia — repetições e forma',
  group: 'CV-30',
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Conta repetições e séries de agachamento, flexão, rosca, desenvolvimento, terra, afundo, polichinelo e ' +
        'abdominal (e o tempo da prancha) pela pose BlazePose, com o exercício escolhido ou reconhecido sozinho. ' +
        'Mede amplitude, profundidade, tempos excêntrico/concêntrico e sob tensão, e checa a forma (tronco, ' +
        'joelho × ponta do pé, valgo, quadril caindo, cotovelo, costas, assimetria). Placar grande no vídeo e bipe ' +
        'opcional. Tudo no navegador. Abra o painel Academia para metas, lista de repetições e relatório.',
  params: {
    exercicio: { type: 'enum', options: OPCOES_EXERCICIO, default: 'automático', label: 'Exercício' },
    metaSeries: { type: 'int', min: 1, max: 20, step: 1, default: 3, label: 'Meta: séries' },
    metaReps: { type: 'int', min: 1, max: 100, step: 1, default: 10, label: 'Meta: repetições por série' },
    metaSegundos: { type: 'int', min: 5, max: 600, step: 5, default: 30, label: 'Meta: segundos de prancha' },
    descansoS: { type: 'int', min: 0, max: 600, step: 5, default: 60, label: 'Descanso entre séries (s)' },
    pausaSerieS: { type: 'int', min: 2, max: 60, step: 1, default: 10, label: 'Pausa que fecha a série (s)' },
    tolerancia: { type: 'enum', options: ['normal', 'rigorosa', 'tolerante'], default: 'normal', label: 'Tolerância das checagens' },
    bipe: { type: 'bool', default: false, label: 'Bipe a cada repetição' },
    textoGrande: { type: 'bool', default: true, label: 'Placar e feedback grandes no vídeo' },
    esqueleto: { type: 'bool', default: true, label: 'Desenhar o esqueleto' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.5, label: 'Visibilidade mín.' },
    detectarMs: { type: 'int', min: 2000, max: 60000, step: 1000, default: 12000, label: 'Re-detectar a pessoa (ms, rede de segurança)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const treino = obterTreino();
    const esp = espelhoEfetivo(p.espelhada, ctx);
    if (state.geracao !== geracaoTreino()) { state.geracao = geracaoTreino(); state.feedback = null; state.mAnt = null; }

    schedule(state, p.everyMs,
      () => {
        // fonte parada (YouTube pausado, histórico): não re-infere o mesmo quadro
        // nem soma amostras. Só o sinal explícito: prancha e isometria são
        // medidas com a pessoa imóvel (ver cv/runtime/parado.js).
        if (quadroRepetido(state, src, ctx, { forcar: convergindo(state, state.results) })) return null;
        // o detector periódico (rede de segurança) espera o fim da repetição:
        // o buraco de 0,3–2 s que ele abre na amostragem engoliria o fundo
        const meioRep = treino.det && treino.det.fase() !== 'repouso';
        const dMs = meioRep && state.roi && !state.redetectar ? Math.max(p.detectarMs, 30000) : p.detectarMs;
        return { ...preparar(src, state, performance.now(), dMs), q: { ...p, esp } };
      },
      async (ent) => {
        const { t, q, mov } = ent;
        const r = await seguir(state, ent, q.esp);
        const cfg = cfgDe(q, q.esp);
        const gravar = estaGravando();
        if (r.sem || r.aquecendo) {
          // sem pessoa: o tempo passa (a série fecha pela pausa), sem medida
          const evs = treino.adicionar({ t, m: null, mov }, cfg, { gravar });
          treinoOp.reagir(evs, q, state, t);
          treinoOp.publicarRetrato(treino, q, state, t, { sem: !!r.sem, aquecendo: !!r.aquecendo });
          return { ...r, t, w: ent.w, h: ent.h };
        }
        const m = medir(r.P, q.minVis, state.mAnt, { w: ent.w, h: ent.h });
        state.mAnt = m;
        const evs = treino.adicionar({ t, m, mov }, cfg, { gravar });
        treinoOp.reagir(evs, q, state, t);
        treinoOp.publicarRetrato(treino, q, state, t, { m });
        return { P: r.P, m, t, w: ent.w, h: ent.h };
      });

    const r = state.results;
    if (state.inferMs) ctx.metrics['academia ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['academia erro'] = state.error;
    if (!r || r.sem) {
      ctx.metrics.academia = 'sem pessoa';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Academia: procurando a pessoa…', color: COR.aviso });
      treinoOp.desenharTexto(p, state, ctx, treino);
      return clone(src);
    }
    if (r.aquecendo) {
      ctx.metrics.academia = 'ajustando…';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Academia: ajustando a pose…', color: COR.aviso });
      return clone(src);
    }
    treinoOp.desenhar(r, p, state, ctx, treino);
    return clone(src);
  },

  /** Eventos do treino → feedback na tela e bipe. */
  reagir(evs, q, state, t) {
    for (const e of evs) {
      if (e.tipo === 'rep') {
        const rep = e.rep;
        if (rep.ex === 'prancha') {
          state.feedback = { texto: rep.boa ? `PRANCHA ${mmss(rep.dur)} ✓` : `PRANCHA ${mmss(rep.dur)}`, cor: rep.boa ? COR.ok : COR.alerta, ate: t + 3000 };
        } else if (rep.boa) {
          const meta = q.metaReps && rep.nSerie === q.metaReps;
          state.feedback = { texto: meta ? 'META DA SÉRIE!' : 'BOA!', cor: COR.ok, ate: t + (meta ? 2600 : 1600) };
        } else {
          state.feedback = { texto: rep.alertas[0].curta, cor: COR.alerta, ate: t + 2400 };
        }
        if (q.bipe) bipe(rep.boa ? 'boa' : 'alerta');
      } else if (e.tipo === 'serie') {
        const s = e.serie;
        if (!state.feedback || state.feedback.ate < t + 500) state.feedback = { texto: `SÉRIE ${s.n} CONCLUÍDA`, cor: COR.info, ate: t + 2600 };
        if (q.bipe) bipe('serie');
      } else if (e.tipo === 'exercicio' && e.auto) {
        state.feedback = { texto: EXERCICIOS[e.ex].nome, cor: COR.info, ate: t + 1800 };
      }
    }
  },

  publicarRetrato(treino, q, state, t, extra) {
    const s = treino.serieAberta();
    const ultima = treino.series[treino.series.length - 1] || null;
    publicar({
      t, sem: !!extra.sem, aquecendo: !!extra.aquecendo,
      ex: treino.exAtual, auto: !idExercicio(q.exercicio), motivo: treino.motivo, candidato: treino.ultClass ? treino.ultClass.ex : null,
      vista: extra.m ? extra.m.vista : null, fase: treino.det ? treino.det.fase() : null, v: treino.vAtual,
      alertasVivos: treino.exAtual === 'prancha' ? treino.alertasVivos : [],
      serie: s ? { n: s.n, reps: s.reps.length, boas: s.boas || 0, alerta: s.alerta || 0 } : null,
      ultimaSerie: ultima ? { n: ultima.n, reps: ultima.reps.length, fechada: !!ultima.fechada } : null,
      isom: treino.isometricoAgora(), descanso: treino.descanso(t), ultimaRep: treino.ultimaRep,
      feedback: state.feedback && state.feedback.ate > t ? state.feedback : null,
      gravando: estaGravando(), espelhada: q.esp, inferMs: performance.now() - t, taxa: treino.taxaHz(),
      cfg: { exercicio: q.exercicio, metaSeries: q.metaSeries, metaReps: q.metaReps, metaSegundos: q.metaSegundos, descansoS: q.descansoS, pausaSerieS: q.pausaSerieS, tolerancia: q.tolerancia },
    });
  },

  desenhar(r, p, state, ctx, treino) {
    const ov = ctx.overlay;
    const sx = ctx.w / r.w, sy = ctx.h / r.h;
    const P = r.P.map((pt) => ({ x: pt.x * sx, y: pt.y * sy, v: pt.v }));
    const vis = (i) => P[i].v >= p.minVis;
    const m = r.m;
    const ex = treino.exAtual;
    const lateral = m.vista === 'lateral';
    const temAlerta = (treino.alertasVivos || []).length > 0 || (state.feedback && state.feedback.cor === COR.alerta && state.feedback.ate > performance.now());
    if (p.esqueleto) {
      for (const [a, b] of OSSOS) {
        if (!vis(a) || !vis(b)) continue;
        const longe = lateral && (m.lado === 'e' ? !ESQ.has(a) || !ESQ.has(b) : ESQ.has(a) || ESQ.has(b));
        ov.push({ type: 'line', x1: P[a].x, y1: P[a].y, x2: P[b].x, y2: P[b].y, color: longe ? 'rgba(229,231,235,.35)' : (temAlerta ? 'rgba(251,146,60,.9)' : COR.neutro), width: longe ? 1.6 : 3 });
      }
      for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]) if (vis(i)) ov.push({ type: 'point', x: P[i].x, y: P[i].y, r: 3.5, color: COR.aviso });
    }
    // articulação principal (lado perto; de frente, os dois)
    if (ex && ARTIC[ex]) {
      const lados = lateral ? [m.lado] : ['e', 'd'];
      for (const l of lados) {
        const I = indicesLado(l);
        const [a, b, c] = ARTIC[ex].map((k) => I[k]);
        if (!(vis(a) && vis(b) && vis(c))) continue;
        ov.push({ type: 'line', x1: P[a].x, y1: P[a].y, x2: P[b].x, y2: P[b].y, color: COR.info, width: 4 });
        ov.push({ type: 'line', x1: P[b].x, y1: P[b].y, x2: P[c].x, y2: P[c].y, color: COR.info, width: 4 });
        ov.push({ type: 'point', x: P[b].x, y: P[b].y, r: 6, color: COR.info });
      }
      const I = indicesLado(lateral ? m.lado : 'e');
      const b = I[ARTIC[ex][1]];
      if (vis(b) && treino.vAtual != null) ov.push({ type: 'rect', x: P[b].x + 10, y: P[b].y, w: 0, h: 0, color: COR.info, label: `${Math.round(treino.vAtual)}°` });
    }
    // faixas no canto
    // a faixa tem 20 px de TELA: o passo em px do quadro depende da escala de exibição
    const passo = 25 / escalaTela(state, ctx);
    let hud = 8;
    // tela pequena (celular, vídeo deitado): o quadro tem ~200 px de altura —
    // só a primeira faixa; o placar grande já mostra as repetições
    const compacto = ctx.h * escalaTela(state, ctx) < 400;
    let nFaixas = 0;
    const banner = (text, color) => {
      if (compacto && nFaixas >= 1) return;
      nFaixas++;
      ov.push({ type: 'banner', x: 8, y: hud, text, color }); hud += passo;
    };
    const nome = ex ? EXERCICIOS[ex].nome : 'reconhecendo o exercício…';
    banner(compacto ? `${nome}${ex && !idExercicio(p.exercicio) ? ' (auto)' : ''}` : `Academia · ${nome}${ex && !idExercicio(p.exercicio) ? ' (auto)' : ''} · ${m.vista === 'obliqua' ? 'oblíqua' : m.vista || '—'}`, COR.info);
    const s = treino.serieAberta();
    const nSerie = s ? s.n : treino.series.length + 1;
    if (ex === 'prancha') {
      const i = treino.isometricoAgora();
      banner(`Série ${nSerie}/${p.metaSeries} · ${i ? mmss(i.dur) : '0:00'} de ${mmss(p.metaSegundos)}${i ? ` · alinhado ${Math.round(i.alinhado * 100)}%` : ''}`, i ? COR.ok : '#94a3b8');
    } else if (ex) {
      banner(`Série ${nSerie}/${p.metaSeries} · ${s ? s.reps.length : 0}/${p.metaReps} reps · ✓${s ? s.boas || 0 : 0} ⚠${s ? s.alerta || 0 : 0}`, COR.ok);
      const fase = NOME_FASE(ex, treino.det && treino.det.fase());
      if (treino.vAtual != null) banner(`${fase} · ${EXERCICIOS[ex].art} ${Math.round(treino.vAtual)}°`, '#a78bfa');
    }
    for (const a of (treino.alertasVivos || []).slice(0, 2)) banner('⚠ ' + a.msg, '#f87171');
    const hz = treino.taxaHz();
    if (hz != null && hz < TAXA_MIN_HZ) banner(`⚠ Amostragem baixa: ${num(hz, 1)} poses/s (mín. ${TAXA_MIN_HZ}) — repetições rápidas podem não contar`, '#f87171');
    ctx.metrics.academia = `${nome}${m.vista ? ' · ' + m.vista : ''}${r.esp ? ' · espelhada' : ''}`;
    ctx.metrics.repetições = treino.reps.length;
    ctx.metrics.séries = treino.series.length;
    if (treino.vAtual != null && ex) ctx.metrics[EXERCICIOS[ex].art] = num(treino.vAtual, 0) + '°';
    treinoOp.desenharTexto(p, state, ctx, treino);
  },

  /** Placar e feedback em letras grandes (linhas). */
  desenharTexto(p, state, ctx, treino) {
    if (!p.textoGrande) return;
    const ov = ctx.overlay;
    const esc = escalaTela(state, ctx);
    const W = ctx.w, H = ctx.h, agora = performance.now();
    const ex = treino.exAtual;
    const s = treino.serieAberta();
    // placar: no alto, ao centro (os cantos costumam ficar sob os painéis);
    // em tela pequena, no canto direito (a faixa ocupa o esquerdo)
    const compacto = H * esc < 400;
    const xP = compacto ? W - 0.03 * W : W / 2, alP = compacto ? 'direita' : 'centro';
    if (ex === 'prancha') {
      const i = treino.isometricoAgora();
      if (i) textoTraco(ov, mmss(i.dur), { x: xP, y: 0.03 * H, alt: 0.11 * H, cor: i.dur >= p.metaSegundos ? COR.ok : '#f5f5f4', alinhar: alP, escala: esc });
    } else if (ex) {
      const n = s ? s.reps.length : 0;
      const meta = `/${p.metaReps}`;
      const recuo = compacto ? larguraTexto(meta, 0.06 * H) + 0.012 * W : 0;
      const box = textoTraco(ov, String(n), { x: xP - recuo, y: 0.03 * H, alt: (compacto ? 0.18 : 0.13) * H, cor: n >= p.metaReps ? COR.ok : '#f5f5f4', alinhar: alP, escala: esc });
      const am = (compacto ? 0.06 : 0.045) * H;
      textoTraco(ov, meta, { x: box.x + box.w + 0.012 * W, y: box.y + box.h - am, alt: am, cor: '#cbd5e1', alinhar: 'esquerda', escala: esc });
    }
    // feedback: no terço de baixo, centralizado
    let texto = null, cor = '#f5f5f4';
    const fb = state.feedback;
    if (fb && fb.ate > agora) { texto = fb.texto; cor = fb.cor; }
    else if (ex === 'prancha' && treino.alertasVivos && treino.alertasVivos.length) { texto = treino.alertasVivos[0].curta; cor = COR.alerta; }
    else if (!s && treino.series.length && !treino.isom) {
      const d = treino.descanso();
      if (d != null && d > p.pausaSerieS - 0.5) {
        const feitas = treino.series.length;
        if (feitas >= p.metaSeries) { texto = 'TREINO CONCLUÍDO!'; cor = COR.ok; }
        else if (d <= p.descansoS) { texto = `DESCANSO ${mmss(p.descansoS - d)}`; cor = '#f5f5f4'; }
        else { texto = `PRÓXIMA SÉRIE (${feitas + 1}/${p.metaSeries})`; cor = COR.aviso; }
      }
    }
    if (texto) {
      const q = quebrar(texto, 0.92 * W, 0.075 * H, 2);
      // acima da barra de controles do vídeo (que ocupa o rodapé com fonte de arquivo)
      let y = 0.86 * H - q.linhas.length * q.alt * 1.35;
      for (const l of q.linhas) { textoTraco(ov, l, { x: W / 2, y, alt: q.alt, cor, alinhar: 'centro', escala: esc }); y += q.alt * 1.35; }
    }
  },
};

export default [treinoOp];
