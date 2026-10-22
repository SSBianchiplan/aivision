/**
 * cv/operators/livres-r/pokayoke.js — CV-49 Poka-yoke de sequência de
 * montagem (I2).
 *
 *   pokayoke.sequencia  as MÃOS (maos.gestos; ou os punhos da pose RTMO como
 *                       reserva) entram nas áreas "Poka-yoke · caixa" — uma
 *                       por caixa/gaveta de peça. Ficar ≥ tMin na caixa =
 *                       PEGOU. A ordem esperada vem do texto ("Base; Placa;
 *                       Parafuso x4; Tampa") ou dos nomes das áreas em ordem.
 *                       Fora de ordem, peça a mais, caixa errada, passo
 *                       pulado e montagem concluída sem um passo (área
 *                       "Poka-yoke · conclusão", o gabarito) são DESVIOS:
 *                       aviso na hora (faixa vermelha + alarme ISA-18.2) e
 *                       registro com o ciclo. Ciclo = da 1ª pegada à
 *                       conclusão (ou ao último passo, sem área de conclusão).
 *
 * Indicador de qualidade, não intertravamento. Não identifica a pessoa: só
 * mãos e tempos. JS puro; nada sai do navegador.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { Alarmes, COR_PRIO } from '../../runtime/livres-oa/alarmes.js';
import { lerSequencia, SequenciaPokaYoke, Permanencia, norm } from '../../runtime/livres-r/sequencia.js';
import { marcas, dentro, tomarComandos } from './comum.js';

export const G_POKA = 'CV-49';
const alarmes = new Alarmes();
export function alarmesPoka() { return alarmes; }

/** Pontos de cada mão (0–1 do quadro): ponta do indicador, centro da palma ou todos os dedos. */
function pontosMaos(ctx, modo) {
  const out = [];
  if (Array.isArray(ctx.hands) && ctx.hands.length) {
    for (const h of ctx.hands) {
      const P = h.pts;
      if (!P || P.length < 21) continue;
      if (modo === 'ponta do indicador') out.push([P[8].x, P[8].y]);
      else if (modo === 'qualquer dedo') for (const i of [4, 8, 12, 16, 20]) out.push([P[i].x, P[i].y]);
      else { let x = 0, y = 0; for (const i of [0, 5, 9, 13, 17]) { x += P[i].x; y += P[i].y; } out.push([x / 5, y / 5]); }
    }
    return { pts: out, fonte: 'mãos' };
  }
  if (Array.isArray(ctx.poses)) {
    // reserva: punho prolongado 35% do antebraço (≈ centro da mão)
    for (const p of ctx.poses) {
      const k = p.keypoints;
      if (!k) continue;
      for (const [c, w] of [[7, 9], [8, 10]]) {
        if (k[c] && k[w] && k[c].score > 0.3 && k[w].score > 0.3) out.push([k[w].x + 0.35 * (k[w].x - k[c].x), k[w].y + 0.35 * (k[w].y - k[c].y)]);
      }
    }
    return { pts: out, fonte: 'pose' };
  }
  return { pts: out, fonte: null };
}

export const sequencia = {
  op: 'pokayoke.sequencia',
  label: 'Poka-yoke de sequência de montagem',
  group: G_POKA, overlayOnly: true,
  desc: 'Confere a ORDEM em que a mão pega as peças: uma área "Poka-yoke · caixa" por caixa/gaveta e (opcional) a área ' +
        '"Poka-yoke · conclusão" no gabarito. Sequência em texto ("Base; Placa; Parafuso x4; Tampa") ou pela ordem dos ' +
        'nomes. Desvio (fora de ordem, a mais, pulou, faltou passo) avisa na hora, alarme ISA-18.2 e registro por ciclo. ' +
        'Use depois de "Mãos e gestos" (câmera de cima).',
  params: {
    sequencia: { type: 'text', default: '', max: 400, label: 'Sequência (ex.: Base; Placa; Parafuso x4; Tampa) — vazio = ordem dos nomes' },
    ponto: { type: 'enum', options: ['centro da palma', 'ponta do indicador', 'qualquer dedo'], default: 'centro da palma', label: 'Ponto da mão' },
    tMin: { type: 'float', min: 0, max: 5, step: 0.05, default: 0.3, label: 'Tempo na caixa para contar a pegada (s)' },
    tSaida: { type: 'float', min: 0, max: 5, step: 0.05, default: 0.4, label: 'Tempo fora para soltar a caixa (s)' },
    modo: { type: 'enum', options: ['bloquear', 'seguir'], default: 'bloquear', label: 'Fora de ordem: esperar o passo certo (bloquear) ou seguir dali' },
    tCicloMax: { type: 'float', min: 5, max: 3600, step: 5, default: 120, label: 'Ciclo parado no meio = abandonado após (s)' },
    alarmeSeg: { type: 'float', min: 0.5, max: 60, step: 0.5, default: 3, label: 'Aviso de desvio visível por (s)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar caixas e mãos' },
  },
  apply(src, p, state, ctx) {
    const zerou = conferirGeracao('r.pokayoke', state);
    const caixas = marcas(ctx, 'pk_caixa');
    const fim = marcas(ctx, 'pk_fim')[0] || null;
    const nomes = caixas.map((c) => c.nome);
    const chave = `${p.sequencia}|${nomes.join('|')}|${fim ? fim.nome : ''}|${p.modo}|${p.tCicloMax}`;
    if (zerou || !state.sq || state.chave !== chave) {
      state.chave = chave;
      state.passos = lerSequencia(p.sequencia, nomes);
      state.sq = new SequenciaPokaYoke(state.passos, { modo: p.modo, fim: fim ? fim.nome : null, tCicloMax: p.tCicloMax });
      state.perm = new Permanencia();
      state.ultDesvio = null;
    }
    for (const c of tomarComandos('r.pokayoke')) {
      if (c.acao === 'reconhecer') alarmes.reconhecer(null, tempoDe(ctx).t);
      if (c.acao === 'reiniciar_ciclo') state.sq.reiniciar();
    }
    const { w, h } = ctx;
    if (!caixas.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Poka-yoke: desenhe uma área por caixa de peça com a função "Poka-yoke · caixa"' });
      publicar('r.pokayoke', { semCaixas: true, passos: [], ciclos: [], desvios: [], resumo: state.sq.resumo(), alarmes: alarmes.resumo() });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const { pts, fonte } = pontosMaos(ctx, p.ponto);
    const sq = state.sq;
    const ocorr = [];
    const todas = fim ? [...caixas, fim] : caixas;
    if (!ctx.fonteParada) {
      for (const z of todas) {
        const d = pts.some(([x, y]) => dentro(z, x, y));
        if (state.perm.passo(z.id, d, t, p.tMin, p.tSaida) === 'entrou') ocorr.push(...sq.evento(z.nome, t));
      }
      ocorr.push(...sq.tick(t));
    }
    for (const o of ocorr) if (o.ev === 'desvio') state.ultDesvio = o;
    const desvioAtivo = state.ultDesvio && t - state.ultDesvio.t < p.alarmeSeg && t >= state.ultDesvio.t;
    alarmes.passo('POKA desvio', { prio: 2, texto: state.ultDesvio ? state.ultDesvio.texto : 'Desvio de sequência', atrasoOn: 0, atrasoOff: 0 },
      Boolean(desvioAtivo), !desvioAtivo, state.ultDesvio ? state.ultDesvio.ciclo : NaN, t);
    const esp = sq.esperado;
    const r = sq.resumo();
    ctx.metrics['poka-yoke'] = `${r.ok}/${r.ciclos} ciclos OK · ${r.desvios} desvios`;
    if (p.desenhar) {
      const feitos = new Set(sq.passos.slice(0, sq.i).map((x) => norm(x.zona)));
      for (const z of todas) {
        const c = z.caixa;
        const ehFim = fim && z.id === fim.id;
        const ehEsp = esp ? norm(esp.zona) === norm(z.nome) : ehFim;
        const pegando = state.perm.ativo(z.id);
        const cor = desvioAtivo && state.ultDesvio && norm(state.ultDesvio.pegou) === norm(z.nome) ? '#FF4D4D'
          : ehEsp ? '#4ade80' : feitos.has(norm(z.nome)) ? '#94a3b8' : ehFim ? '#a78bfa' : '#38bdf8';
        let rot = z.nome;
        if (ehEsp && esp) rot = `PRÓXIMO: ${z.nome}${esp.vezes > 1 ? ` (${sq.c + 1}/${esp.vezes})` : ''}`;
        else if (ehEsp && ehFim) rot = `CONCLUIR: ${z.nome}`;
        ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor, label: pegando ? `✋ ${rot}` : rot });
      }
      for (const [x, y] of pts) ctx.overlay.push({ type: 'point', x: x * w, y: y * h, r: 5, color: '#FFD84D' });
      if (desvioAtivo) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: COR_PRIO[2], text: `DESVIO: ${state.ultDesvio.texto}` });
      else ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#4ade80',
        text: `Ciclo ${sq.nCiclo} · passo ${Math.min(sq.i + 1, sq.passos.length)}/${sq.passos.length}${esp ? ` → ${esp.zona}` : fim ? ` → ${fim.nome}` : ''} · ${r.ok}/${r.ciclos} OK` });
      if (!fonte) ctx.overlay.push({ type: 'banner', x: 8, y: 32, color: '#F2A900', text: 'Sem mãos: ponha "Mãos e gestos" (ou a pose RTMO) antes no Pipeline' });
    }
    alarmes.limpar(t, 3600);
    publicar('r.pokayoke', {
      passos: sq.passos, i: sq.i, c: sq.c, nCiclo: sq.nCiclo, inicio: sq.inicio, fim: fim ? fim.nome : null, fonte, relogio, t,
      ciclos: sq.ciclos.slice(-300), desvios: sq.desvios.slice(-300), resumo: r, alarmes: alarmes.resumo(), desvioAtivo: desvioAtivo ? state.ultDesvio : null,
    });
    return clone(src);
  },
};

export default [sequencia];
