/**
 * operators/livres-j/quadra.js — CV-35 Esportes coletivos e de quadra.
 *
 * Um operador genérico com perfil de esporte (futebol, futsal, basquete,
 * vôlei, tênis, padel). Ele NÃO traz modelo novo: os jogadores (pessoa) e a
 * bola ("bola" = sports ball do COCO) vêm do detector anterior na cadeia — YOLOX, RF-DETR ou
 * um RF-DETR treinado no módulo Treinar com classes próprias ("bola",
 * "jogador"…) — ou, sem detector, do RF-DETR (Apache-2.0) rodado aqui.
 *
 *   1. IDs: os da cadeia (ByteTrack, re-ID) ou um rastreador próprio simples
 *      (IoU + distância do centro, com previsão de velocidade).
 *   2. Times: cor do tronco em Lab → k-means (2 times + "outros"), ou o lado
 *      da quadra (tênis, padel, vôlei com calibração).
 *   3. Quadra: o painel Quadra grava no parâmetro `calibracao` os pares
 *      (ponto conhecido da quadra ↔ clique na imagem). Com ≥ 4 pares sai a
 *      homografia; o pé de cada jogador (meio da base da caixa) vira metros:
 *      radar, mapa de calor, distância, velocidade, zonas.
 *   4. Bola: trajetória, velocidade (projeção no chão), posse e passes por
 *      proximidade, quique dentro/fora, rally, arremessos (aro marcado).
 *      Opcional: 2ª passada ampliada em volta da última bola (e varredura
 *      em 4 ladrilhos quando ela some) — a bola tem 3–10 px no quadro.
 *
 * Inferência fora do loop (schedule); a súmula mora no canal
 * (runtime/livres-j/canal.js) e o painel Quadra assina.
 */
import { clone } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { letterbox, unletterbox, toTensorData, decodeYolox, cropResize } from '../../runtime/tensor.js';
import { COCO_CLASSES } from '../../runtime/labels.js';
import { ensure, schedule, iou, listaTexto, normalizar } from '../../runtime/opkit.js';
import { prepRfdetr, inferRfdetr } from '../livres-b/rfdetr.js';
import { ESPORTES, NOMES_ESPORTES, medidas, montarCalibracao, aplicar, linhasNaImagem, dentroDaQuadra, num } from '../../runtime/livres-j/quadras.js';
import { corTronco } from '../../runtime/livres-j/sessao.js';
import {
  obterSessao, publicar, publicarQuadro, quadroPedido, geracaoSessao, estaPausado,
} from '../../runtime/livres-j/canal.js';
import { registrarRegiao, arred } from '../../regioes.js';
import { vista } from '../../marcacoes.js';

const G = 'CV-35';
const DETECTORES = { 'RF-DETR small': 'rfdetr-small', 'RF-DETR nano': 'rfdetr-nano', YOLOX: 'yolox' };
const MODO_TIMES = { 'automático': 'automático', 'cor do uniforme': 'cor', 'lado da quadra': 'lado', 'não separar': 'não separar' };

// ------------------------------------------------------------ detector próprio

function recortarImagem(img, x, y, w, h, S) { return cropResize(img, x, y, w, h, S, S); }

/** Preparo síncrono (o src volta ao pool depois): tensor do quadro e, se pedido, do recorte ampliado. */
function preparar(src, id, zoom, full) {
  const spec = MODELS[id];
  const out = { id };
  if (id === 'yolox') {
    const lb = letterbox(src, spec.input[3], spec.input[2]);
    out.data = toTensorData(lb.data, spec); out.lb = lb; out.w = src.width; out.h = src.height;
  } else out.data = prepRfdetr(src, id);
  if (zoom) {
    // recorte quadrado na resolução plena (quando o hospedeiro oferece): é o que faz a bola aparecer
    const base = full || src, Wf = base.width, Hf = base.height;
    const lado = Math.min(Wf, Hf, Math.max(spec.input[3] * 1.0, Math.min(Wf, Hf) * 0.42));
    const cx = zoom.u * Wf, cy = zoom.v * Hf;
    const x = Math.max(0, Math.min(Wf - lado, cx - lado / 2)), y = Math.max(0, Math.min(Hf - lado, cy - lado / 2));
    const S = spec.input[3];
    const crop = recortarImagem(base, x, y, lado, lado, S);
    out.zoom = { x: x / Wf, y: y / Hf, w: lado / Wf, h: lado / Hf };
    if (id === 'yolox') { const lb = letterbox(crop, S, S); out.zoom.data = toTensorData(lb.data, spec); out.zoom.lb = lb; }
    else out.zoom.data = prepRfdetr(crop, id);
  }
  return out;
}

async function inferirYolox(data, lb, w, h, conf) {
  const spec = MODELS.yolox;
  const o = await run('yolox', await makeTensor(data, spec.input));
  const k = Object.keys(o)[0];
  return decodeYolox(o[k].data, o[k].dims, spec, conf, 0.45, 60).map((b) => {
    const u = unletterbox(b, lb);
    return { x1: u.x1 / w, y1: u.y1 / h, x2: u.x2 / w, y2: u.y2 / h, score: b.score, name: COCO_CLASSES[b.classId] || `#${b.classId}` };
  });
}

async function inferir(inp, conf, confBola, ehBola) {
  const c = Math.min(conf, confBola);
  let dets = inp.id === 'yolox'
    ? await inferirYolox(inp.data, inp.lb, inp.w, inp.h, c)
    : await inferRfdetr(inp.data, inp.id, c, 80);
  dets = dets.filter((d) => d.score >= (ehBola(d.name) ? confBola : conf));
  if (inp.zoom) {
    const z = inp.zoom, S = MODELS[inp.id].input[3];
    const zd = inp.id === 'yolox' ? await inferirYolox(z.data, z.lb, S, S, confBola) : await inferRfdetr(z.data, inp.id, confBola, 20);
    for (const d of zd) {
      if (!ehBola(d.name)) continue;
      const b = { ...d, x1: z.x + d.x1 * z.w, y1: z.y + d.y1 * z.h, x2: z.x + d.x2 * z.w, y2: z.y + d.y2 * z.h, zoom: true };
      // a mesma bola nas duas passadas: fica a do recorte (caixa mais precisa)
      dets = dets.filter((o) => !(ehBola(o.name) && iou(o, b) > 0.2));
      dets.push(b);
    }
  }
  return dets;
}

// ------------------------------------------------------------ rastreador próprio

/** Sem IDs na cadeia: guloso por IoU (ou centro perto, em alturas de caixa), com previsão de velocidade. */
function rastrear(trk, dets, t) {
  if (!trk.lista) { trk.lista = []; trk.prox = 1; }
  const L = trk.lista;
  for (const r of L) {
    const dtn = (t - r.t) / 1000;
    r.pred = { x1: r.box.x1 + r.vx * dtn, y1: r.box.y1 + r.vy * dtn, x2: r.box.x2 + r.vx * dtn, y2: r.box.y2 + r.vy * dtn };
  }
  const pares = [];
  L.forEach((r, i) => dets.forEach((d, j) => {
    const v = iou(r.pred, d);
    const h = Math.max(1e-3, d.y2 - d.y1);
    const dc = Math.hypot((r.pred.x1 + r.pred.x2 - d.x1 - d.x2) / 2, (r.pred.y2 - d.y2)) / h;
    const nota = v > 0.15 ? v + 1 : dc < 0.6 ? 1 - dc : -1;
    if (nota > 0) pares.push([nota, i, j]);
  }));
  pares.sort((a, b) => b[0] - a[0]);
  const ur = new Set(), ud = new Set();
  for (const [, i, j] of pares) {
    if (ur.has(i) || ud.has(j)) continue;
    ur.add(i); ud.add(j);
    const r = L[i], d = dets[j], dt = Math.max(0.03, (t - r.t) / 1000);
    const vx = ((d.x1 + d.x2) - (r.box.x1 + r.box.x2)) / 2 / dt, vy = ((d.y1 + d.y2) - (r.box.y1 + r.box.y2)) / 2 / dt;
    r.vx = 0.6 * r.vx + 0.4 * vx; r.vy = 0.6 * r.vy + 0.4 * vy;
    r.box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }; r.t = t; r.hits++;
    d.id = r.id;
  }
  dets.forEach((d, j) => {
    if (ud.has(j)) return;
    const r = { id: trk.prox++, box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, vx: 0, vy: 0, t, hits: 1 };
    L.push(r); d.id = r.id;
  });
  trk.lista = L.filter((r) => t - r.t < 1500);
  return dets;
}

// ------------------------------------------------------------ calibração

function lerCalibracao(texto) {
  if (!texto) return null;
  try {
    const c = JSON.parse(texto);
    return c && typeof c === 'object' ? c : null;
  } catch (_) { return null; }
}

function miniaturaDoQuadro(src) {
  try {
    if (typeof document === 'undefined') return null;
    const k = Math.min(1, 640 / src.width);
    const a = document.createElement('canvas'); a.width = src.width; a.height = src.height;
    a.getContext('2d').putImageData(src, 0, 0);
    if (k === 1) return a.toDataURL('image/jpeg', 0.82);
    const b = document.createElement('canvas'); b.width = Math.round(src.width * k); b.height = Math.round(src.height * k);
    b.getContext('2d').drawImage(a, 0, 0, b.width, b.height);
    return b.toDataURL('image/jpeg', 0.82);
  } catch (_) { return null; }
}

// ------------------------------------------------------------ operador

export const analise = {
  op: 'quadra.analise',
  label: 'Quadra — esportes coletivos e de quadra',
  group: G,
  model: 'rfdetr-small',
  overlayOnly: true,
  // «⚙ Calibrar quadra» (components/calibrar.js): no nó do Pipeline, nos painéis e no radar do vídeo
  calibravel: { rotulo: 'Calibrar quadra (esporte e 4 cantos)' },
  desc: 'Jogadores e bola (do detector anterior na cadeia ou RF-DETR próprio), IDs, times pela cor do ' +
        'uniforme, calibração da quadra por 4+ pontos (homografia) → radar 2D, mapa de calor, distância, ' +
        'velocidade e zonas por jogador; posse e passes (futebol, futsal, basquete), quique dentro/fora e ' +
        'rally (tênis, padel, vôlei), arremessos com o aro marcado (basquete). Abra o painel Quadra para ' +
        'calibrar, ver o radar e exportar.',
  params: {
    esporte: { type: 'enum', options: NOMES_ESPORTES, default: 'futebol', label: 'Esporte' },
    comprimento: { type: 'float', min: 0, max: 120, step: 0.5, default: 0, label: 'Comprimento do campo (m, 0 = oficial)' },
    largura: { type: 'float', min: 0, max: 90, step: 0.5, default: 0, label: 'Largura do campo (m, 0 = oficial)' },
    detector: { type: 'enum', options: ['automático', 'cadeia', 'RF-DETR small', 'RF-DETR nano', 'YOLOX'], default: 'automático', label: 'Detector (automático = o da cadeia, senão RF-DETR small)' },
    conf: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.35, label: 'Confiança (jogadores)' },
    confBola: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.15, label: 'Confiança (bola)' },
    bolaZoom: { type: 'enum', options: ['desligado', 'perto da última bola', 'perto da bola + varredura'], default: 'desligado', label: 'Bola: 2ª passada ampliada (2× custo)' },
    classesJogador: { type: 'text', default: 'pessoa, person, player, jogador, goalkeeper, goleiro, referee, árbitro', max: 200, label: 'Classes de jogador' },
    classesBola: { type: 'text', default: 'bola, sports ball, ball', max: 120, label: 'Classes de bola' },
    times: { type: 'enum', options: Object.keys(MODO_TIMES), default: 'automático', label: 'Times por' },
    soQuadra: { type: 'bool', default: true, label: 'Só quem está na quadra (com calibração)' },
    margem: { type: 'float', min: 0, max: 10, step: 0.5, default: 2, label: 'Margem além das linhas (m)' },
    duplas: { type: 'bool', default: false, label: 'Tênis: dentro/fora pelas linhas de duplas' },
    fimRallyS: { type: 'float', min: 1, max: 8, step: 0.5, default: 2.5, label: 'Fim do rally sem bola (s)' },
    calibracao: { type: 'text', default: '', max: 2400, label: 'Calibração (preenchida pelo painel Quadra)' },
    mostrarLinhas: { type: 'bool', default: true, label: 'Desenhar as linhas da quadra calibrada' },
    radar: { type: 'enum', options: ['nenhum', 'canto inferior direito', 'canto inferior esquerdo', 'canto superior direito'], default: 'canto inferior direito', label: 'Radar no vídeo' },
    radarCaixa: { type: 'text', default: '', max: 60, label: 'Radar: posição e tamanho (x1,y1,x2,y2 em 0–1; arraste no vídeo)' },
    rotulos: { type: 'enum', options: ['id e velocidade', 'id', 'nenhum'], default: 'id e velocidade', label: 'Rótulos' },
    rastroBola: { type: 'bool', default: true, label: 'Rastro da bola' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. do detector próprio (ms)' },
  },

  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const esp = ESPORTES[p.esporte] || ESPORTES.futebol;
    const { L, W } = medidas(p.esporte, p.comprimento, p.largura);
    const sessao = obterSessao();

    // ---- calibração (cache pelo texto + medidas)
    const chave = `${p.esporte}|${L}|${W}|${p.calibracao}`;
    if (state.chaveCal !== chave) {
      state.chaveCal = chave;
      const c = lerCalibracao(p.calibracao);
      state.calTexto = c;
      state.cal = c && c.esporte === p.esporte ? montarCalibracao(c, p.esporte, L, W) : null;
      if (state.cal && state.cal.erro) { state.calErro = state.cal.erro; state.cal = null; } else state.calErro = null;
      state.linhas = state.cal ? linhasNaImagem(p.esporte, L, W, state.cal.Hi) : null;
    }
    const cal = state.cal;
    if (state.geracao !== geracaoSessao()) { state.geracao = geracaoSessao(); state.trk = {}; state.vis = null; }
    if (state.esporte && state.esporte !== p.esporte) { state.trk = {}; }
    state.esporte = p.esporte;

    const filtroJ = listaTexto(p.classesJogador), filtroB = listaTexto(p.classesBola);
    const casa = (f, n) => { const s = normalizar(n); return f.some((x) => s === x || s.includes(x)); };
    const ehBola = (n) => casa(filtroB, n);
    const ehJogador = (n) => !ehBola(n) && casa(filtroJ, n);

    // ---- de onde vêm as caixas
    const daCadeia = Array.isArray(ctx.detections) ? ctx.detections : null;
    const usarCadeia = p.detector === 'cadeia' || (p.detector === 'automático' && daCadeia);
    let novas = null, tNovas = performance.now();
    if (usarCadeia) {
      if (!daCadeia) ctx.metrics['quadra'] = 'coloque um detector antes (RF-DETR, YOLOX, treinado) ou use o detector próprio';
      else {
        // o detector da cadeia repete o último resultado entre inferências: só quadro NOVO entra na súmula
        const imp = daCadeia.map((d) => `${(d.x1 * 1e4) | 0},${(d.y2 * 1e4) | 0},${d.id || ''}`).join(';');
        if (imp !== state.impressao) { state.impressao = imp; novas = daCadeia.map((d) => ({ ...d })); }
      }
    } else {
      const id = DETECTORES[p.detector] || 'rfdetr-small';
      if (!ensure(id, state, ctx)) return clone(src);
      if (state.idDet !== id) { state.idDet = id; state.results = null; }
      schedule(state, p.everyMs,
        () => {
          let zoom = null;
          if (p.bolaZoom !== 'desligado') {
            const u = sessao.bola.ult;
            if (u && performance.now() - u.t < 1200) zoom = { u: u.u, v: u.v };
            else if (p.bolaZoom === 'perto da bola + varredura') {
              state.ladrilho = ((state.ladrilho || 0) + 1) % 4;
              zoom = { u: state.ladrilho % 2 ? 0.75 : 0.25, v: state.ladrilho < 2 ? 0.3 : 0.7 };
            }
          }
          const full = zoom && ctx.grabFull ? ctx.grabFull(1920) : null;
          return { t: performance.now(), inp: preparar(src, id, zoom, full) };
        },
        async ({ t, inp }) => ({ t, dets: await inferir(inp, p.conf, p.confBola, ehBola) }));
      if (state.results && state.results !== state.processado) {
        state.processado = state.results;
        novas = state.results.dets.map((d) => ({ ...d }));
        tNovas = state.results.t;
      }
      if (state.inferMs) ctx.metrics['quadra ms'] = state.inferMs.toFixed(0);
      if (state.error) ctx.metrics['quadra erro'] = state.error;
    }

    // ---- súmula
    if (novas) {
      let jog = novas.filter((d) => ehJogador(d.name) && d.x2 - d.x1 > 0.003 && d.y2 - d.y1 > 0.01);
      const bolasDet = novas.filter((d) => ehBola(d.name));
      if (jog.some((d) => d.id == null)) jog = rastrear(state.trk || (state.trk = {}), jog, tNovas);
      const corPorCor = p.times !== 'lado da quadra' && p.times !== 'não separar';
      const jogadores = [];
      for (const d of jog) {
        const pe = [(d.x1 + d.x2) / 2, d.y2];
        let P = null;
        // caixa cortada na borda de baixo: o pé está fora do quadro, a posição seria inventada
        const cortada = d.y2 > 0.99;
        if (cal && !cortada) {
          const r = aplicar(cal.H, pe[0], pe[1]);
          P = r ? [r[0], r[1]] : null;
          if (p.soQuadra && (!P || !dentroDaQuadra(P[0], P[1], L, W, p.margem))) continue;
        } else if (cal && cortada && p.soQuadra) continue;
        jogadores.push({ id: d.id, box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, pe, P, lab: corPorCor ? corTronco(src, d) : null });
      }
      const bolas = bolasDet.map((d) => {
        const u = (d.x1 + d.x2) / 2, v = (d.y1 + d.y2) / 2;
        const r = cal ? aplicar(cal.H, u, v) : null;
        return { u, v, P: r ? [r[0], r[1]] : null, score: d.score, box: d };
      });
      const cfg = {
        esporte: p.esporte, L, W, calibrada: Boolean(cal), times: MODO_TIMES[p.times] || 'automático',
        aros: state.calTexto && Array.isArray(state.calTexto.aros) && state.calTexto.esporte === p.esporte ? state.calTexto.aros : [],
        aroR: state.calTexto && state.calTexto.aroR, aspecto: h / w, duplas: p.duplas, fimRallyS: p.fimRallyS,
      };
      if (!estaPausado()) sessao.atualizar(tNovas, { jogadores, bolas }, cfg);
      const ret = sessao.retrato(cfg);
      ret.cal = cal ? { n: cal.n, erroM: cal.erroM, mPorPx: cal.mPorPx, aviso: cal.aviso } : null;
      ret.calErro = state.calErro; ret.w = w; ret.h = h; ret.pausado = estaPausado();
      ret.fonte = usarCadeia ? 'cadeia' : p.detector === 'automático' ? 'RF-DETR small' : p.detector;
      ret.deteccoes = { jogadores: jogadores.length, descartados: jog.length - jogadores.length, bolas: bolas.length };
      publicar(ret);
      state.vis = { jogadores, bola: ret.bola, ret };
    }

    // ---- miniatura para a calibração (só enquanto o painel pede)
    const agora = performance.now();
    if (quadroPedido() && (!state.tQuadro || agora - state.tQuadro > 1200)) {
      state.tQuadro = agora;
      const url = miniaturaDoQuadro(src);
      if (url) publicarQuadro({ url, w, h, t: agora });
    }

    analise.desenhar(ctx, p, state, esp, L, W);
    return clone(src);
  },

  desenhar(ctx, p, state, esp, L, W) {
    const { w, h } = ctx, ov = ctx.overlay, cal = state.cal, v = state.vis;
    if (cal && p.mostrarLinhas && state.linhas) {
      for (const [x1, y1, x2, y2] of state.linhas) ov.push({ type: 'line', x1: x1 * w, y1: y1 * h, x2: x2 * w, y2: y2 * h, color: 'rgba(255,255,255,0.55)', width: 1.2, agora: true });
    }
    if (!v) {
      ctx.metrics['quadra'] = ctx.metrics['quadra'] || 'aguardando detecções…';
      return;
    }
    const r = v.ret, porId = new Map(r.jogadores.map((j) => [j.id, j]));
    const cor = (t) => (t && r.times[t] ? r.times[t].cor : '#FFD84D');
    for (const o of v.jogadores) {
      const j = porId.get(o.id) || {};
      const b = o.box;
      let rot = '';
      if (p.rotulos !== 'nenhum') {
        rot = `#${o.id}`;
        if (p.rotulos === 'id e velocidade' && j.vAtual != null) rot += ` ${num(j.vAtual, 0)} km/h`;
        if (r.posse && r.posse.dono === o.id) rot += ' ●';
      }
      ov.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: (b.x2 - b.x1) * w, h: (b.y2 - b.y1) * h, color: cor(j.time), label: rot || undefined });
      ov.push({ type: 'point', x: o.pe[0] * w, y: o.pe[1] * h, r: 3, color: cor(j.time) });
    }
    const bl = r.bola;
    if (bl.agora) {
      if (p.rastroBola) {
        const tr = bl.traj;
        for (let i = 1; i < tr.length; i++) ov.push({ type: 'line', x1: tr[i - 1].u * w, y1: tr[i - 1].v * h, x2: tr[i].u * w, y2: tr[i].v * h, color: '#fde047', width: 1 + (2 * i) / tr.length });
      }
      ov.push({ type: 'point', x: bl.agora.u * w, y: bl.agora.v * h, r: 5, color: '#fde047' });
    }
    // aros marcados (basquete)
    const ct = state.calTexto;
    if (ct && ct.esporte === p.esporte && Array.isArray(ct.aros)) {
      const rr = (ct.aroR || 0.012) * w;
      ct.aros.forEach(([u, vv]) => ov.push({ type: 'line', x1: u * w - rr, y1: vv * h, x2: u * w + rr, y2: vv * h, color: '#fb923c', width: 3 }));
    }
    if (p.radar !== 'nenhum') analise.radar(ov, p, r, w, h, esp, L, W, cor);

    // faixa de resumo
    let txt = `${esp.nome}`;
    if (!cal) txt += ' · sem calibração';
    if (esp.posse && r.times.A.possePct != null) txt += ` · posse A ${num(r.times.A.possePct, 0)}% B ${num(r.times.B.possePct, 0)}% · passes ${r.times.A.passes}/${r.times.B.passes}`;
    if (esp.rally) txt += ` · rally ${r.rally.ativo ? r.rally.golpes : '—'} · ${r.rallies.length} pontos`;
    if (esp.arremessos && r.arremessos.tent) txt += ` · arremessos ${r.arremessos.cestas}/${r.arremessos.tent}`;
    if (bl.vAtual != null && cal) txt += ` · bola ${num(bl.vAtual, 0)} km/h`;
    ov.push({ type: 'banner', x: 10, y: 10, text: txt, color: '#22d3ee' });
    ctx.metrics['jogadores'] = r.jogadores.filter((j) => j.ativo).length;
    ctx.metrics['bola vista'] = `${Math.round(100 * r.taxaBola)}%`;
    if (cal) ctx.metrics['m/px (fundo)'] = num(cal.mPorPx, 2);
    if (state.calErro) ctx.metrics['calibração'] = state.calErro;
  },

  /** Radar no canto do vídeo: só linhas e pontos (o overlay não tem preenchimento). */
  radar(ov, p, r, w, h, esp, L, W, cor) {
    // caixa do radar: a arrastada no vídeo (radarCaixa, cv/regioes.js) ou a do canto escolhido
    const cx = caixaRadar(p, w, h, L, W);
    const k = cx.larg / L;
    const x0 = cx.x0, y0 = cx.y0;
    const X = (x) => x0 + x * k, Y = (y) => y0 + y * k;
    for (const [a, b, c, d] of esp.linhas(L, W)) ov.push({ type: 'line', x1: X(a), y1: Y(b), x2: X(c), y2: Y(d), color: 'rgba(255,255,255,0.85)', width: 1, agora: true });
    if (!r.cfg || !r.cfg.calibrada) {
      ov.push({ type: 'line', x1: X(0), y1: Y(0), x2: X(L), y2: Y(W), color: 'rgba(248,113,113,0.7)', width: 1, agora: true });
      ov.push({ type: 'line', x1: X(L), y1: Y(0), x2: X(0), y2: Y(W), color: 'rgba(248,113,113,0.7)', width: 1, agora: true });
      // convite: clicar no radar (região editável, cv/regioes.js) abre «⚙ Calibrar quadra»
      ov.push({ type: 'banner', x: X(0) + 2, y: Y(0) + 2, text: 'Sem calibração — clique para calibrar', color: '#f87171', agora: true });
      return;
    }
    for (const j of r.jogadores) {
      if (!j.ativo || !j.P) continue;
      ov.push({ type: 'point', x: X(j.P[0]), y: Y(j.P[1]), r: 4, color: cor(j.time) });
    }
    if (r.bola.agora && r.bola.agora.P) {
      const [bx, by] = r.bola.agora.P;
      if (dentroDaQuadra(bx, by, L, W, 3)) ov.push({ type: 'point', x: X(bx), y: Y(by), r: 3, color: '#fde047' });
    }
  },
};

/** Caixa do radar em px (x0, y0, larg, alt), com a proporção da quadra. */
function caixaRadar(p, w, h, L, W) {
  const c = lerCaixa(p.radarCaixa);
  if (c) {
    // cabe na caixa arrastada, com a proporção L×W, encostado no canto de cima à esquerda dela
    const bw = (c[2] - c[0]) * w, bh = (c[3] - c[1]) * h;
    const larg = Math.max(20, Math.min(bw, bh * (L / W)));
    return { x0: c[0] * w, y0: c[1] * h, larg, alt: larg * (W / L) };
  }
  // margens proporcionais à largura (10 e 28 px num quadro de 480): a caixa padrão, em 0–1, não muda
  // quando o modo automático troca a largura do pipeline (a região arrastável fica estável)
  const larg = Math.min(0.34 * w, 0.42 * h * (L / W)), alt = W * (larg / L), m = w * (10 / 480);
  const x0 = p.radar.includes('esquerdo') ? m : w - larg - m;
  const y0 = p.radar.includes('superior') ? m + w * (28 / 480) : h - alt - m;
  return { x0, y0, larg, alt };
}
function lerCaixa(t) {
  const v = String(t || '').split(',').map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  const c = [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])];
  return c[2] - c[0] > 0.01 && c[3] - c[1] > 0.01 ? c : null;
}

// ------------------------------------------------------------ regiões editáveis com o mouse (cv/regioes.js)

const CANTOS = ['c00', 'cL0', 'cLW', 'c0W'];
const lerCal = (p) => { try { const c = JSON.parse(p.calibracao || 'null'); return c && typeof c === 'object' ? c : null; } catch (_) { return null; } };
/** Os 4 cantos da quadra no quadro (0–1), pela homografia da calibração atual. */
function cantosDaCalibracao(p) {
  const c = lerCal(p);
  if (!c || c.esporte !== p.esporte) return null;
  const { L, W } = medidas(p.esporte, p.comprimento, p.largura);
  const cal = montarCalibracao(c, p.esporte, L, W);
  if (!cal || cal.erro) return null;
  const out = [];
  for (const [x, y] of [[0, 0], [L, 0], [L, W], [0, W]]) {
    const q = aplicar(cal.Hi, x, y);
    if (!q || q[2] <= 0 || Math.abs(q[0]) > 3 || Math.abs(q[1]) > 3) return null;
    out.push([q[0], q[1]]);
  }
  return out;
}
registrarRegiao('quadra.analise', {
  chave: 'cantos', nome: 'Quadra · cantos', tipo: 'perspectiva', cor: '#22d3ee',
  rotulos: ['canto (0, 0)', 'canto (L, 0)', 'canto (L, W)', 'canto (0, W)'],
  ferramentas: ['perspectiva', 'retangulo'],
  ler: (p) => cantosDaCalibracao(p),
  // sem calibração: um trapézio de transmissão (fundo perto embaixo) para arrastar até as linhas
  padrao: () => [[0.16, 0.86], [0.3, 0.36], [0.7, 0.36], [0.84, 0.86]],
  gravar(p, pts) {
    const c = lerCal(p) || {};
    const pares = CANTOS.map((id, i) => ({ id, u: Math.round(pts[i][0] * 1e4) / 1e4, v: Math.round(pts[i][1] * 1e4) / 1e4 }));
    return { calibracao: JSON.stringify({ esporte: p.esporte, pares, aros: c.esporte === p.esporte && Array.isArray(c.aros) ? c.aros : [],
      w: c.w || 640, h: c.h || 360, ...(c.aroR ? { aroR: c.aroR } : {}) }) };
  },
  apagar: () => ({ calibracao: '' }),
  // prévia das linhas pela geometria arrastada (antes de soltar, o operador ainda desenha a anterior)
  desenho(pts, p) {
    const { L, W } = medidas(p.esporte, p.comprimento, p.largura);
    const cal = montarCalibracao({ pares: CANTOS.map((id, i) => ({ id, u: pts[i][0], v: pts[i][1] })) }, p.esporte, L, W);
    return cal && !cal.erro ? linhasNaImagem(p.esporte, L, W, cal.Hi) : [];
  },
});
registrarRegiao('quadra.analise', {
  chave: 'radar', nome: 'Quadra · radar', tipo: 'retangulo', cor: '#fde047',
  campos: ['radarCaixa'],
  ferramentas: ['retangulo'],
  ler(p) {
    if (p.radar === 'nenhum') return null;
    // o tamanho do quadro do pipeline (as margens do radar são em px dele)
    const w = 480, h = w * ((vista.sh || 9) / (vista.sw || 16));
    const { L, W } = medidas(p.esporte, p.comprimento, p.largura);
    const c = caixaRadar(p, w, h, L, W);
    return [[c.x0 / w, c.y0 / h], [(c.x0 + c.larg) / w, (c.y0 + c.alt) / h]];
  },
  gravar(p, pts) {
    const [a, b] = arred(pts);
    return { radarCaixa: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])].join(','),
      ...(p.radar === 'nenhum' ? { radar: 'canto inferior direito' } : {}) };
  },
  apagar: () => ({ radar: 'nenhum', radarCaixa: '' }),
  // sem calibração, clicar no radar abre o assistente (components/calibrar.js)
  aoClicar(p) {
    if (cantosDaCalibracao(p) || typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('aiv:calibrar', { detail: { op: 'quadra.analise' } }));
  },
});

export default [analise];
