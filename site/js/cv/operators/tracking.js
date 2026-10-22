/**
 * cv/operators/tracking.js — CV-04 Tracking com IDs (ByteTrack simplificado, sem modelo).
 *
 * Consome as caixas do detector anterior na cadeia (ctx.detections) e devolve
 * as mesmas caixas com um ID estável entre frames. A ideia do ByteTrack: casar
 * primeiro as detecções de alta confiança, depois usar as de baixa confiança
 * só para NÃO perder trilhas já existentes (oclusão parcial, borrão). O estado
 * de cada trilha é um filtro de velocidade constante (posição + velocidade,
 * suavizados) — o suficiente para prever onde a caixa estará no próximo frame.
 *
 * Contagem por linha: uma linha horizontal ou vertical no meio; cada trilha que
 * a cruza conta uma vez, por sentido. Publica ctx.tracks e reescreve
 * ctx.detections com `id`, para os operadores seguintes (relações, SAM, CLIP).
 */
import { clone } from '../core.js';
import { iou, colorFor } from '../runtime/opkit.js';

const G = 'CV-04';

function casar(trilhas, dets, thr) {
  // guloso por IoU decrescente: barato e suficiente para dezenas de objetos
  const pares = [];
  trilhas.forEach((t, i) => dets.forEach((d, j) => { const v = iou(t.pred, d); if (v >= thr) pares.push([v, i, j]); }));
  pares.sort((a, b) => b[0] - a[0]);
  const ut = new Set(), ud = new Set(), out = [];
  for (const [, i, j] of pares) { if (ut.has(i) || ud.has(j)) continue; ut.add(i); ud.add(j); out.push([i, j]); }
  return { pares: out, trilhasLivres: trilhas.map((_, i) => i).filter((i) => !ut.has(i)), detsLivres: dets.map((_, j) => j).filter((j) => !ud.has(j)) };
}

export const byteTrack = {
  op: 'track.bytetrack',
  label: 'Tracking com IDs (ByteTrack)',
  group: G, overlayOnly: true,
  desc: 'IDs estáveis para os objetos do detector anterior na cadeia, rastro e ' +
        'contagem por linha. Sem modelo: IoU + previsão de velocidade, em duas ' +
        'passadas (alta e baixa confiança), como o ByteTrack.',
  params: {
    altaConf: { type: 'float', min: 0.2, max: 0.9, step: 0.05, default: 0.5, label: 'Confiança alta' },
    iouMin: { type: 'float', min: 0.1, max: 0.8, step: 0.05, default: 0.3, label: 'IoU mínimo para casar' },
    nascer: { type: 'int', min: 1, max: 10, step: 1, default: 2, label: 'Frames para confirmar' },
    perder: { type: 'int', min: 1, max: 120, step: 1, default: 30, label: 'Frames até esquecer' },
    rastro: { type: 'int', min: 0, max: 90, step: 5, default: 30, label: 'Rastro (pontos)' },
    linha: { type: 'enum', options: ['nenhuma', 'horizontal', 'vertical'], default: 'nenhuma', label: 'Linha de contagem' },
    posicao: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.5, label: 'Posição da linha' },
    mostrarNome: { type: 'bool', default: true, label: 'Mostrar classe' },
  },
  apply(src, p, state, ctx) {
    const dets = Array.isArray(ctx.detections) ? ctx.detections : null;
    if (!state.trilhas) { state.trilhas = []; state.proxId = 1; state.contagem = { ida: 0, volta: 0 }; }
    if (!dets) { ctx.metrics['tracking'] = 'coloque um detector antes (YOLOX, YOLO26, YOLOE)'; return clone(src); }

    // 1. previsão
    for (const t of state.trilhas) {
      t.pred = { x1: t.box.x1 + t.vx, y1: t.box.y1 + t.vy, x2: t.box.x2 + t.vx, y2: t.box.y2 + t.vy };
      t.idade++;
    }
    const altas = dets.filter((d) => d.score >= p.altaConf), baixas = dets.filter((d) => d.score < p.altaConf);
    const atualizar = (t, d) => {
      const vx = ((d.x1 + d.x2) - (t.box.x1 + t.box.x2)) / 2, vy = ((d.y1 + d.y2) - (t.box.y1 + t.box.y2)) / 2;
      t.vx = t.vx * 0.6 + vx * 0.4; t.vy = t.vy * 0.6 + vy * 0.4;
      t.box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }; t.score = d.score; t.name = d.name || t.name;
      t.perdido = 0; t.hits++;
      const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
      // contagem: cruzou a linha entre o último centro e este?
      if (p.linha !== 'nenhuma' && t.ultimo) {
        const a = p.linha === 'horizontal' ? t.ultimo.cy : t.ultimo.cx, b = p.linha === 'horizontal' ? cy : cx;
        if (a < p.posicao && b >= p.posicao) state.contagem.ida++;
        else if (a >= p.posicao && b < p.posicao) state.contagem.volta++;
      }
      t.ultimo = { cx, cy };
      if (p.rastro) { t.rastro.push([cx, cy]); if (t.rastro.length > p.rastro) t.rastro.shift(); }
      d.id = t.id;
    };
    // 2. casa as altas com todas as trilhas
    let m = casar(state.trilhas, altas, p.iouMin);
    m.pares.forEach(([i, j]) => atualizar(state.trilhas[i], altas[j]));
    // 3. as baixas só com trilhas que sobraram (recupera oclusão), sem criar trilha nova
    const sobra = m.trilhasLivres.map((i) => state.trilhas[i]);
    const m2 = casar(sobra, baixas, Math.max(0.2, p.iouMin - 0.1));
    m2.pares.forEach(([i, j]) => atualizar(sobra[i], baixas[j]));
    const semPar = new Set(m2.trilhasLivres.map((i) => sobra[i]));
    for (const t of semPar) t.perdido++;
    // 4. novas trilhas com as altas que sobraram
    for (const j of m.detsLivres) {
      const d = altas[j];
      state.trilhas.push({ id: state.proxId++, box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, pred: null, vx: 0, vy: 0,
                           score: d.score, name: d.name, hits: 1, idade: 1, perdido: 0, rastro: [], ultimo: null });
      d.id = state.trilhas[state.trilhas.length - 1].id;
    }
    // 5. esquece o que sumiu
    state.trilhas = state.trilhas.filter((t) => t.perdido <= p.perder);

    // saída: caixas confirmadas com id, rastro e linha
    const { w, h } = ctx;
    const vivas = state.trilhas.filter((t) => t.hits >= p.nascer && t.perdido === 0);
    for (const t of vivas) {
      const cor = colorFor(t.id);
      ctx.overlay.push({ type: 'rect', x: t.box.x1 * w, y: t.box.y1 * h, w: (t.box.x2 - t.box.x1) * w, h: (t.box.y2 - t.box.y1) * h,
                         color: cor, label: p.mostrarNome ? `#${t.id} ${t.name || ''}` : `#${t.id}` });
      for (let i = 1; i < t.rastro.length; i++) {
        ctx.overlay.push({ type: 'line', x1: t.rastro[i - 1][0] * w, y1: t.rastro[i - 1][1] * h, x2: t.rastro[i][0] * w, y2: t.rastro[i][1] * h,
                           color: cor, width: 1 + 2 * (i / t.rastro.length) });
      }
    }
    if (p.linha !== 'nenhuma') {
      const L = p.linha === 'horizontal'
        ? { x1: 0, y1: p.posicao * h, x2: w, y2: p.posicao * h } : { x1: p.posicao * w, y1: 0, x2: p.posicao * w, y2: h };
      ctx.overlay.push({ type: 'line', ...L, color: '#f87171', width: 2 });
      ctx.overlay.push({ type: 'banner', x: 10, y: 10, text: `cruzaram: ${state.contagem.ida} ↓/→ · ${state.contagem.volta} ↑/←`, color: '#f87171' });
    }
    ctx.tracks = vivas.map((t) => ({ id: t.id, name: t.name, box: t.box, score: t.score, idade: t.idade }));
    ctx.detections = vivas.map((t) => ({ ...t.box, score: t.score, name: t.name, id: t.id }));
    ctx.metrics['trilhas'] = vivas.length;
    ctx.metrics['ids emitidos'] = state.proxId - 1;
    return clone(src);
  },
};

export default [byteTrack];
