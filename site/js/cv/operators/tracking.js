/**
 * cv/operators/tracking.js — CV-04 Tracking com IDs (ByteTrack simplificado, sem modelo).
 *
 * Consome as caixas do detector anterior na cadeia (ctx.detections) e devolve
 * as mesmas caixas com um ID estável entre frames. A ideia do ByteTrack: casar
 * primeiro as detecções de alta confiança, depois usar as de baixa confiança
 * só para NÃO perder trilhas já existentes (oclusão parcial, borrão).
 *
 * ================== TEMPO REAL ==================
 * O detector infere fora do laço de quadros: RF-DETR em WASM entrega ~3
 * resultados/s, YOLOX no WebGPU ~15. Entre um resultado e outro, a MESMA
 * lista de caixas era republicada a cada quadro, e este operador:
 *   - re-casava a mesma caixa como se fosse nova — a velocidade decaía a
 *     zero e a previsão nunca servia;
 *   - desenhava a caixa onde o veículo ESTAVA no quadro inferido: a 300 px/s
 *     e 400 ms de inferência, 120 px atrás do carro («caixa fantasma»).
 * Agora:
 *   1. só processa detecção NOVA — pelo carimbo do detector (seq + instante
 *      do quadro inferido, cv/runtime/tempo-real/carimbo.js) ou, sem carimbo,
 *      por uma impressão digital das caixas;
 *   2. cada trilha tem um Kalman de velocidade constante em TEMPO (ms), e o
 *      casamento compara a detecção com a trilha prevista para o instante em
 *      que aquele quadro foi capturado; se o IoU não casa (objeto rápido,
 *      detector lento), casa pela distância dos centros;
 *   3. o DESENHO é a trilha prevista para o instante do quadro EXIBIDO
 *      (ctx.tExibir, ou o quadro atual); quando chega detecção nova, a
 *      diferença entre a caixa velha e a nova se desfaz em ~80 ms em vez de
 *      saltar;
 *   4. trilha perdida não é desenhada — só a posição prevista, tracejada e
 *      esmaecida, por `fantasmaMs`;
 *   5. as caixas cruas do detector (marcadas `det`) saem do desenho: só as
 *      trilhas aparecem, sem duplicata atrasada por baixo.
 * O que vai para a cadeia (ctx.detections, ctx.tracks) continua sendo a
 * detecção REAL — zonas, linhas e contagens não contam posição inventada.
 * ctx.sincronia publica a latência para o Viewport atrasar a imagem
 * (arquivo e YouTube) e caixa e imagem baterem.
 * ================================================
 *
 * Contagem por linha: uma linha horizontal ou vertical no meio; cada trilha que
 * a cruza conta uma vez, por sentido.
 */
import { clone } from '../core.js';
import { iou, colorFor } from '../runtime/opkit.js';
import { carimboAtual } from '../runtime/tempo-real/carimbo.js';
import { novoEixo, prever, atualizar, posEm } from '../runtime/tempo-real/kalman.js';
import { registrarRegiao, arred } from '../regioes.js';

const G = 'CV-04';
/** Constante de tempo da correção suave do desenho (ms). */
const TAU_MS = 80;
/** Previsão máxima à frente da última medida (ms): mais que isto, a caixa para. */
const MAX_PREV_MS = 1000;

function casar(trilhas, dets, thr) {
  // guloso por IoU decrescente: barato e suficiente para dezenas de objetos
  const pares = [];
  trilhas.forEach((t, i) => dets.forEach((d, j) => { const v = iou(t.pred, d); if (v >= thr) pares.push([v, i, j]); }));
  pares.sort((a, b) => b[0] - a[0]);
  const ut = new Set(), ud = new Set(), out = [];
  for (const [, i, j] of pares) { if (ut.has(i) || ud.has(j)) continue; ut.add(i); ud.add(j); out.push([i, j]); }
  return { pares: out, trilhasLivres: trilhas.map((_, i) => i).filter((i) => !ut.has(i)), detsLivres: dets.map((_, j) => j).filter((j) => !ud.has(j)) };
}

/**
 * Segunda chance pela DISTÂNCIA dos centros (em tamanhos da trilha), para o
 * objeto que andou mais que o próprio tamanho entre duas inferências: o IoU
 * da previsão dá zero enquanto a velocidade ainda não é conhecida.
 */
function casarDistancia(trilhas, dets, maxTam) {
  const pares = [];
  trilhas.forEach((t, i) => {
    if (t.perdido > 3) return;                               // previsão velha demais para confiar
    const tw = t.pred.x2 - t.pred.x1, th = t.pred.y2 - t.pred.y1;
    const cx = (t.pred.x1 + t.pred.x2) / 2, cy = (t.pred.y1 + t.pred.y2) / 2;
    dets.forEach((d, j) => {
      const r = ((d.x2 - d.x1) * (d.y2 - d.y1)) / Math.max(1e-9, tw * th);
      if (r < 0.4 || r > 2.5) return;                       // tamanho muito diferente: outro objeto
      const dist = Math.hypot(((d.x1 + d.x2) / 2 - cx) / Math.max(1e-6, tw), ((d.y1 + d.y2) / 2 - cy) / Math.max(1e-6, th));
      // trilha de uma medida só: velocidade desconhecida, o objeto pode ter andado mais
      if (dist <= (t.hits <= 1 ? maxTam * 2.5 : maxTam)) pares.push([dist, i, j]);
    });
  });
  pares.sort((a, b) => a[0] - b[0]);
  const ut = new Set(), ud = new Set(), out = [];
  for (const [, i, j] of pares) { if (ut.has(i) || ud.has(j)) continue; ut.add(i); ud.add(j); out.push([i, j]); }
  return { pares: out, trilhasLivres: trilhas.map((_, i) => i).filter((i) => !ut.has(i)), detsLivres: dets.map((_, j) => j).filter((j) => !ud.has(j)) };
}

/** Impressão digital de uma lista de caixas (detector sem carimbo). */
function digital(dets) {
  let h = dets.length;
  for (const d of dets) h = (h * 31 + d.x1 * 7919 + d.y1 * 104729 + d.x2 * 1299709 + d.y2 * 15485863 + (d.score || 0) * 32452843) % 1e12;
  return h;
}

/** Caixa (centro previsto, tamanho filtrado) da trilha `dt` s depois da última medida. */
function caixaEm(t, dt) {
  const cx = posEm(t.kx, dt), cy = posEm(t.ky, dt);
  return { x1: cx - t.w / 2, y1: cy - t.h / 2, x2: cx + t.w / 2, y2: cy + t.h / 2 };
}
const centro = (b) => [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];

/** Associação de uma detecção NOVA (quadro capturado em tDet) com as trilhas. */
function associar(p, state, dets, tDet) {
  // 1. previsão para o instante do quadro inferido
  for (const t of state.trilhas) {
    t.pred = caixaEm(t, Math.max(0, Math.min(tDet - t.tUlt, 2000)) / 1000);
    t.idade++;
  }
  const altas = dets.filter((d) => d.score >= p.altaConf), baixas = dets.filter((d) => d.score < p.altaConf);
  const medir = (t, d) => {
    // onde a caixa estava sendo desenhada antes desta medida (para a correção suave)
    const antes = t.exib && Number.isFinite(t.tExib) ? caixaEm(t, Math.min(t.tExib - t.tUlt, MAX_PREV_MS) / 1000) : null;
    const dt = Math.max(0, Math.min(tDet - t.tUlt, 2000)) / 1000;
    const [cx, cy] = centro(d);
    prever(t.kx, dt, t.w); prever(t.ky, dt, t.h);
    if (t.hits === 1 && dt > 0) {
      // segunda medida: a velocidade é a diferença, sem esperar o filtro convergir
      t.kx.v = (cx - t.kx.p + t.kx.v * dt) / dt; t.ky.v = (cy - t.ky.p + t.ky.v * dt) / dt;
      t.kx.p = cx; t.ky.p = cy;
    } else {
      atualizar(t.kx, cx, t.w); atualizar(t.ky, cy, t.h);
    }
    t.w += 0.6 * ((d.x2 - d.x1) - t.w); t.h += 0.6 * ((d.y2 - d.y1) - t.h);
    t.tUlt = tDet;
    if (antes) {
      const novo = caixaEm(t, Math.min(t.tExib - t.tUlt, MAX_PREV_MS) / 1000);
      const [ax, ay] = centro(antes), [nx, ny] = centro(novo);
      t.off = { dx: ax - nx, dy: ay - ny, t: t.tExib };
    }
    t.box = { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }; t.score = d.score; t.name = d.name || t.name;
    t.perdido = 0; t.hits++;
    // contagem: cruzou a linha entre o último centro e este?
    if (p.linha !== 'nenhuma' && t.ultimo) {
      // ida = do lado negativo para o positivo da linha A→B (horizontal: para baixo; vertical: para a direita)
      const [A, B] = linhaDe(p);
      const a = lado(A, B, t.ultimo.cx, t.ultimo.cy), b = lado(A, B, cx, cy);
      if (a !== b && cruzaSegmento(A, B, [t.ultimo.cx, t.ultimo.cy], [cx, cy])) {
        if (a < 0 && b >= 0) state.contagem.ida++;
        else if (a >= 0 && b < 0) state.contagem.volta++;
      }
    }
    t.ultimo = { cx, cy };
    if (p.rastro) { t.rastro.push([cx, cy]); if (t.rastro.length > p.rastro) t.rastro.shift(); }
    d.id = t.id;
  };
  // 2. altas × todas as trilhas: IoU com a previsão, depois distância dos centros
  const m = casar(state.trilhas, altas, p.iouMin);
  m.pares.forEach(([i, j]) => medir(state.trilhas[i], altas[j]));
  const restoT = m.trilhasLivres.map((i) => state.trilhas[i]), restoD = m.detsLivres.map((j) => altas[j]);
  const md = casarDistancia(restoT, restoD, 1.2);
  md.pares.forEach(([i, j]) => medir(restoT[i], restoD[j]));
  // 3. as baixas só com trilhas que sobraram (recupera oclusão), sem criar trilha nova
  const sobra = md.trilhasLivres.map((i) => restoT[i]);
  const m2 = casar(sobra, baixas, Math.max(0.2, p.iouMin - 0.1));
  m2.pares.forEach(([i, j]) => medir(sobra[i], baixas[j]));
  for (const i of m2.trilhasLivres) sobra[i].perdido++;
  // 4. novas trilhas com as altas que sobraram
  for (const j of md.detsLivres) {
    const d = restoD[j];
    const dw = d.x2 - d.x1, dh = d.y2 - d.y1;
    const [cx, cy] = centro(d);
    const t = { id: state.proxId++, box: { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 }, pred: null,
                kx: novoEixo(cx, dw), ky: novoEixo(cy, dh), w: dw, h: dh, tUlt: tDet,
                score: d.score, name: d.name, hits: 1, idade: 1, perdido: 0, rastro: p.rastro ? [[cx, cy]] : [],
                ultimo: { cx, cy }, off: null, exib: null, tExib: NaN };
    state.trilhas.push(t);
    d.id = t.id;
  }
  // 5. esquece o que sumiu
  state.trilhas = state.trilhas.filter((t) => t.perdido <= p.perder);
}

export const byteTrack = {
  op: 'track.bytetrack',
  label: 'Tracking com IDs (ByteTrack)',
  group: G, overlayOnly: true,
  // desenha a trilha prevista para ctx.tExibir: o executor não re-sincroniza (tempo-real/sincronizar.js)
  sincroniza: true,
  desc: 'IDs estáveis para os objetos do detector anterior na cadeia, rastro e ' +
        'contagem por linha. Sem modelo: IoU + Kalman de velocidade no tempo, em duas ' +
        'passadas (alta e baixa confiança), como o ByteTrack. A caixa desenhada é a ' +
        'prevista para o quadro exibido (tempo real); a cadeia recebe a detecção real.',
  params: {
    altaConf: { type: 'float', min: 0.2, max: 0.9, step: 0.05, default: 0.5, label: 'Confiança alta' },
    iouMin: { type: 'float', min: 0.1, max: 0.8, step: 0.05, default: 0.3, label: 'IoU mínimo para casar' },
    nascer: { type: 'int', min: 1, max: 10, step: 1, default: 2, label: 'Detecções para confirmar' },
    perder: { type: 'int', min: 1, max: 120, step: 1, default: 30, label: 'Detecções até esquecer' },
    rastro: { type: 'int', min: 0, max: 90, step: 5, default: 30, label: 'Rastro (pontos)' },
    linha: { type: 'enum', options: ['nenhuma', 'horizontal', 'vertical'], default: 'nenhuma', label: 'Linha de contagem' },
    posicao: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.5, label: 'Posição da linha' },
    linhaPts: { type: 'text', default: '', max: 60, label: 'Linha livre (x1,y1,x2,y2 em 0–1; arraste no vídeo)' },
    mostrarNome: { type: 'bool', default: true, label: 'Mostrar classe' },
    prever: { type: 'bool', default: true, label: 'Desenhar a posição prevista (tempo real)' },
    fantasmaMs: { type: 'int', min: 0, max: 2000, step: 50, default: 300, label: 'Trilha perdida: mostrar prevista por (ms)' },
    ocultarDetector: { type: 'bool', default: true, label: 'Esconder as caixas cruas do detector' },
    sincronizar: { type: 'enum', options: ['auto', 'sempre', 'nunca'], default: 'auto',
                   label: 'Atrasar a imagem para casar com as caixas (auto: arquivo e YouTube)' },
    maxAtrasoMs: { type: 'int', min: 50, max: 1500, step: 50, default: 600, label: 'Atraso máximo da imagem (ms)' },
  },
  apply(src, p, state, ctx) {
    const dets = Array.isArray(ctx.detections) ? ctx.detections : null;
    if (!state.trilhas) { state.trilhas = []; state.proxId = 1; state.contagem = { ida: 0, volta: 0 }; }
    if (!dets) { ctx.metrics['tracking'] = 'coloque um detector antes (YOLOX, YOLO26, YOLOE)'; return clone(src); }

    // relógio: o do quadro (hospedeiro) > o do vídeo (testes) > o da página
    const tAgora = Number.isFinite(ctx.tQuadro) ? ctx.tQuadro
      : Number.isFinite(ctx.tempoS) ? ctx.tempoS * 1000 : performance.now();
    const car = carimboAtual(ctx);
    let nova, tDet;
    if (car) {
      nova = car.seq !== state.seq;
      tDet = Number.isFinite(car.t) ? car.t : tAgora;
    } else {
      // sem carimbo: lista vazia conta como nova (como antes); repetida idêntica, não
      const fp = dets.length ? digital(dets) : null;
      nova = fp === null || fp !== state.fp;
      state.fp = fp;
      tDet = tAgora;
    }
    // o relógio voltou (vídeo recomeçou, testes): recomeça o rastreio
    if (nova && Number.isFinite(state.tDet) && tDet < state.tDet - 1500) {
      state.trilhas = []; state.tDet = undefined; state.latMs = undefined; state.perMs = undefined;
    }

    if (nova) {
      if (car) state.seq = car.seq;
      // latência (captura → resultado) e período entre resultados: sincronia e telemetria
      if (car && Number.isFinite(car.t)) {
        const lat = Math.max(0, tAgora - tDet);
        state.latMs = state.latMs === undefined ? lat : state.latMs * 0.8 + lat * 0.2;
        if (Number.isFinite(state.tDet) && tDet > state.tDet) {
          const per = Math.min(2000, tDet - state.tDet);
          state.perMs = state.perMs === undefined ? per : state.perMs * 0.8 + per * 0.2;
        }
      }
      associar(p, state, dets, tDet);
      state.tDet = tDet;
      state.saida = state.trilhas.filter((t) => t.hits >= p.nascer && t.perdido === 0);
    }

    // ---- desenho: a posição prevista para o instante do quadro exibido
    const { w, h } = ctx;
    const tExib = ctx.fonteParada ? (Number.isFinite(state.tDet) ? state.tDet : tAgora)
      : Number.isFinite(ctx.tExibir) ? ctx.tExibir : tAgora;
    if (p.ocultarDetector) {
      for (let i = ctx.overlay.length - 1; i >= 0; i--) if (ctx.overlay[i] && ctx.overlay[i].det) ctx.overlay.splice(i, 1);
    }
    const vivas = state.saida || [];
    for (const t of state.trilhas) {
      if (t.hits < p.nascer) continue;
      const desdeMs = tExib - t.tUlt;
      const perdida = t.perdido > 0;
      if (perdida && !(p.prever && desdeMs <= p.fantasmaMs)) continue;
      let b = t.box;
      if (p.prever) {
        b = caixaEm(t, Math.min(desdeMs, MAX_PREV_MS) / 1000);
        // correção suave: o salto da previsão velha para a nova se desfaz em ~TAU
        if (t.off) {
          const k = Math.exp(-Math.max(0, tExib - t.off.t) / TAU_MS);
          if (k > 0.02) b = { x1: b.x1 + t.off.dx * k, y1: b.y1 + t.off.dy * k, x2: b.x2 + t.off.dx * k, y2: b.y2 + t.off.dy * k };
          else t.off = null;
        }
      }
      t.exib = b; t.tExib = tExib;
      const cor = colorFor(t.id);
      const rot = p.mostrarNome ? `#${t.id} ${t.name || ''}` : `#${t.id}`;
      ctx.overlay.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: (b.x2 - b.x1) * w, h: (b.y2 - b.y1) * h,
                         color: cor, label: rot, ...(perdida ? { alpha: 0.45, dash: true } : {}) });
      if (!perdida && t.rastro.length) {
        const pts = p.prever ? t.rastro.concat([centro(b)]) : t.rastro;
        for (let i = 1; i < pts.length; i++) {
          ctx.overlay.push({ type: 'line', x1: pts[i - 1][0] * w, y1: pts[i - 1][1] * h, x2: pts[i][0] * w, y2: pts[i][1] * h,
                             color: cor, width: 1 + 2 * (i / pts.length) });
        }
      }
    }
    if (p.linha !== 'nenhuma') {
      const [A, B] = linhaDe(p);
      ctx.overlay.push({ type: 'line', x1: A[0] * w, y1: A[1] * h, x2: B[0] * w, y2: B[1] * h, color: '#f87171', width: 2 });
      ctx.overlay.push({ type: 'banner', x: 10, y: 10, text: `cruzaram: ${state.contagem.ida} ↓/→ · ${state.contagem.volta} ↑/←`, color: '#f87171' });
    }
    // para a cadeia: a detecção REAL (a mesma até chegar a próxima), com o instante dela
    ctx.tracks = vivas.map((t) => ({ id: t.id, name: t.name, box: t.box, score: t.score, idade: t.idade,
                                     pred: t.exib || t.box, vx: t.kx.v, vy: t.ky.v, tDet: t.tUlt }));
    ctx.detections = vivas.map((t) => ({ ...t.box, score: t.score, name: t.name, id: t.id }));
    ctx.tracksT = state.tDet;
    ctx.metrics['trilhas'] = vivas.length;
    ctx.metrics['ids emitidos'] = state.proxId - 1;
    if (state.perMs) ctx.metrics['detecções/s'] = (1000 / state.perMs).toFixed(1);
    if (state.latMs !== undefined) ctx.metrics['latência det. ms'] = state.latMs.toFixed(0);
    // atraso a cobrir para caixa e imagem baterem: captura→resultado + um período
    if (state.latMs !== undefined && p.sincronizar !== 'nunca') {
      ctx.sincronia = { modo: p.sincronizar, atrasoMs: Math.min(p.maxAtrasoMs, state.latMs + (state.perMs || 0)) };
    }
    return clone(src);
  },
};

/** A linha de contagem (0–1 do quadro): a livre arrastada no vídeo ou a horizontal/vertical na posição. */
function linhaDe(p) {
  const v = String(p.linhaPts || '').split(',').map(Number);
  if (v.length === 4 && v.every(Number.isFinite) && Math.hypot(v[2] - v[0], v[3] - v[1]) > 0.01) return [[v[0], v[1]], [v[2], v[3]]];
  return p.linha === 'vertical' ? [[p.posicao, 1], [p.posicao, 0]] : [[0, p.posicao], [1, p.posicao]];
}
const lado = (A, B, x, y) => ((B[0] - A[0]) * (y - A[1]) - (B[1] - A[1]) * (x - A[0]) >= 0 ? 1 : -1);
/** O passo do centro (P→Q) cruza o SEGMENTO A–B (não a reta inteira)? Linha de ponta a ponta: sempre. */
function cruzaSegmento(A, B, P, Q) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return d(P, Q, A) * d(P, Q, B) <= 0;
}

// linha de contagem editável com o mouse (cv/regioes.js)
registrarRegiao('track.bytetrack', {
  chave: 'linha', nome: 'Rastreio · linha de contagem', tipo: 'linha', cor: '#f87171', ferramentas: ['linha'],
  ler: (p) => (p.linha === 'nenhuma' ? null : linhaDe(p)),
  campos: ['linhaPts'],
  gravar: (p, pts) => ({ linhaPts: arred(pts).flat().join(',') }),
  apagar: () => ({ linha: 'nenhuma', linhaPts: '' }),
});

export default [byteTrack];
