/**
 * cv/operators/livres-s/velocidade.js — CV-67 Velocidade média por duas linhas (T2).
 *
 *   transito.velocidade  duas linhas "Trânsito · velocidade" (a 1ª desenhada é A,
 *                        a 2ª é B) atravessando a via a uma DISTÂNCIA conhecida
 *                        (medida no local ou pela régua calibrada no plano da
 *                        via). Cada veículo com ID (Tracking com IDs antes) que
 *                        cruza as duas tem v = distância / Δt, com o instante de
 *                        cada cruzamento interpolado entre quadros. Média,
 *                        mediana, V85, máxima e excessos por classe e sentido.
 *
 * Independente do trafego.cvc (CV-41): não lê nem altera a contagem dele.
 * A ocupação de vagas (a outra metade do T2) é o ocupacao.zona (CV-64).
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao } from '../../runtime/livres-oa/canal.js';
import { VelocidadeDuasLinhas } from '../../runtime/livres-s/velocidade.js';
import { passoTempo, fmtBR } from '../../runtime/livres-s/comum.js';
import { colorFor } from '../../runtime/opkit.js';

export const G_VELOCIDADE = 'CV-67';
export const FUNCAO_VELOCIDADE = 'velocidade';

export const velocidade = {
  op: 'transito.velocidade',
  label: 'Velocidade média por duas linhas',
  group: G_VELOCIDADE, overlayOnly: true,
  desc: 'Duas linhas "Trânsito · velocidade" (A e B) atravessando a via a uma distância conhecida: cada veículo ' +
        'rastreado que cruza as duas tem v = distância / tempo (instante interpolado entre quadros). Média, mediana, ' +
        'V85, máxima e excessos sobre o limite, por classe e sentido; CSV no Medições. Coloque depois do detector + ' +
        'Tracking com IDs. Use vídeo em tempo real ou arquivo (o tempo é o do vídeo).',
  params: {
    distancia: { type: 'float', min: 0, max: 500, step: 0.1, default: 20, label: 'Distância entre as linhas (m; 0 = régua)' },
    limite: { type: 'int', min: 0, max: 200, step: 5, default: 40, label: 'Limite de velocidade (km/h; 0 = sem)' },
    classes: { type: 'text', default: 'carro, moto, ônibus, caminhão, bicicleta', max: 200, label: 'Classes (vazio = todas)' },
    ponto: { type: 'enum', options: ['base', 'centro'], default: 'base', label: 'Ponto do veículo' },
    maxS: { type: 'float', min: 1, max: 600, step: 1, default: 30, label: 'Tempo máximo entre as linhas (s)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar linhas e velocidades' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('velocidade', state) || !state.v) { state.v = new VelocidadeDuasLinhas(); state.rot = new Map(); }
    const { t, relogio } = passoTempo(state, ctx, Infinity);
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const linhas = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_VELOCIDADE && i.tipo === 'linha' && i.px.length >= 2) : [];
    if (linhas.length < 2) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Velocidade: desenhe DUAS linhas "Trânsito · velocidade" atravessando a via' });
      publicar('velocidade', { medidas: [], resumo: {}, linhas: linhas.length });
      return clone(src);
    }
    const [LA, LB] = linhas;
    // distância: o parâmetro, ou a régua calibrada entre os centros das linhas (aproximação no plano da via)
    let dist = p.distancia, origemDist = 'informada';
    if (!(dist > 0)) {
      const esc = mq.escala && mq.escala.mmPorPxQuadro;
      const cA = [(LA.px[0][0] + LA.px[1][0]) / 2, (LA.px[0][1] + LA.px[1][1]) / 2], cB = [(LB.px[0][0] + LB.px[1][0]) / 2, (LB.px[0][1] + LB.px[1][1]) / 2];
      dist = esc ? (Math.hypot(cA[0] - cB[0], cA[1] - cB[1]) * esc) / 1000 : 0;
      origemDist = esc ? 'régua (aprox.)' : 'sem distância';
    }
    const dets = Array.isArray(ctx.detections) ? ctx.detections : [];
    const filtro = String(p.classes || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const objs = dets.filter((d) => d.id != null && (!filtro.length || filtro.includes(String(d.name).toLowerCase())))
      .map((d) => ({ id: d.id, classe: String(d.name), p: [((d.x1 + d.x2) / 2) * w, (p.ponto === 'base' ? d.y2 : (d.y1 + d.y2) / 2) * h] }));
    const semId = dets.length > 0 && !dets.some((d) => d.id != null);
    if (!ctx.fonteParada && t !== state.tUlt && dist > 0) {
      const novas = state.v.passo(objs, t, LA.px, LB.px, dist, { maxS: p.maxS });
      for (const m of novas) state.rot.set(m.id, { v: m.v, ate: t + 3 });
    }
    state.tUlt = t;
    if (p.desenhar) {
      for (const [L, nome] of [[LA, 'A'], [LB, 'B']]) {
        ctx.overlay.push({ type: 'line', x1: L.px[0][0], y1: L.px[0][1], x2: L.px[1][0], y2: L.px[1][1], color: '#38bdf8', width: 2.5 });
        ctx.overlay.push({ type: 'banner', x: L.px[0][0], y: L.px[0][1] - 22, color: '#38bdf8', text: `${nome}: ${L.nome}` });
      }
      for (const d of dets) {
        const r = state.rot.get(d.id);
        if (!r || r.ate < t) continue;
        const exc = p.limite > 0 && r.v > p.limite;
        ctx.overlay.push({ type: 'rect', x: d.x1 * w, y: d.y1 * h, w: (d.x2 - d.x1) * w, h: (d.y2 - d.y1) * h, color: exc ? '#FF4D4D' : colorFor(d.id), label: `${Math.round(r.v)} km/h` });
      }
    }
    for (const [id, r] of state.rot) if (r.ate < t - 10) state.rot.delete(id);
    const resumo = state.v.resumo(p.limite);
    const T = resumo.todos;
    ctx.metrics['velocidade'] = T.n ? `${T.n} veíc. · média ${fmtBR(T.media, 1)} · V85 ${fmtBR(T.v85, 1)} km/h` : (semId ? 'sem IDs — ponha Tracking com IDs' : dist > 0 ? 'aguardando veículos' : 'informe a distância');
    publicar('velocidade', { medidas: state.v.medidas.slice(-2000), resumo, distancia: dist, origemDist, limite: p.limite, relogio, semId, linhas: [LA.nome, LB.nome] });
    return clone(src);
  },
};

export default [velocidade];
