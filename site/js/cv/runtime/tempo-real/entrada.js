/**
 * cv/runtime/tempo-real/entrada.js — entrada do detector em alta resolução,
 * recorte da ROI e ladrilhos (tiles).
 *
 * POR QUE: o pipeline roda em procWidth (480 por padrão; a qualidade
 * automática baixa até 160). Numa via expressa filmada do alto, em 16:9, um
 * carro de 60 px na fonte 1920 vira 15 px no quadro de trabalho — e o
 * letterbox 640² ainda joga fora 44% do quadrado em faixas cinzas. O detector
 * vê borrões e devolve 40–50% de confiança, quando devolve.
 *
 * O que muda, só quando o operador pede (`entrada` ≠ 'quadro'):
 *   1. a imagem vem do grabFull (resolução plena, até 1920), não do quadro
 *      de trabalho — só no instante de inferir, não a cada quadro;
 *   2. com ROI ligada nas Ferramentas de mouse, recorta a caixa da ROI (o
 *      resto já era preto): o modelo gasta os pixels na via;
 *   3. 'plena + ladrilhos' (ou 'auto' num quadro largo) parte a região em 2
 *      ou 3 ladrilhos quase quadrados com 12% de sobreposição: cada um é um
 *      run do modelo, e um quadro 16:9 deixa de ser achatado no quadrado.
 *      As caixas voltam ao quadro inteiro e as que a emenda cortou em duas
 *      são fundidas.
 *
 * 'quadro' é o comportamento antigo, intacto: o detector nem chama isto.
 */
import { iou } from '../opkit.js';

/** Modos de entrada aceitos pelos detectores (parâmetro `entrada`). */
export const ENTRADAS = ['quadro', 'plena', 'plena + ladrilhos', 'auto'];

const SOBRE = 0.12;              // sobreposição entre ladrilhos vizinhos (fração do ladrilho)
const BORDA = 0.004;             // caixa a menos disto da emenda = cortada pela emenda

// canvases próprios (os do tensor.js são reusados dentro do mesmo quadro)
const tela = { base: null, dst: null };
function canvas(k, w, h) {
  if (!tela[k]) tela[k] = document.createElement('canvas');
  const c = tela[k];
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Caixa (normalizada) das áreas de ROI ligadas, com folga; null = quadro inteiro. */
export function regiaoRoi(ctx) {
  const mq = ctx && ctx.marcacoes;
  if (!mq || !mq.roi || !Array.isArray(mq.itens)) return null;
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0, n = 0;
  for (const it of mq.itens) {
    if (it.funcao !== 'roi' || !it.caixa) continue;
    x1 = Math.min(x1, it.caixa.x1); y1 = Math.min(y1, it.caixa.y1);
    x2 = Math.max(x2, it.caixa.x2); y2 = Math.max(y2, it.caixa.y2); n++;
  }
  if (!n) return null;
  const f = 0.01;
  x1 = Math.max(0, x1 - f); y1 = Math.max(0, y1 - f); x2 = Math.min(1, x2 + f); y2 = Math.min(1, y2 + f);
  if (x2 - x1 < 0.05 || y2 - y1 < 0.05) return null;
  return { x1, y1, x2, y2 };
}

/**
 * Quantos ladrilhos (colunas × linhas) para uma região de proporção `asp`
 * (largura/altura em px). `msPorRun` = custo medido de um run do modelo; no
 * 'auto' só ladrilha se couber (≤ 70 ms por run: YOLOX/YOLO26 no WebGPU).
 */
export function grade(modo, asp, msPorRun = 0, prepMs = 0) {
  if (modo === 'plena') return { cols: 1, rows: 1 };
  // auto: ladrilhar só se o modelo é rápido (WebGPU). Aparelho lento não perde
  // os ladrilhos (o carro pequeno some sem eles): espaça as inferências (intervaloAuto)
  void prepMs;
  if (modo === 'auto' && msPorRun > 70) return { cols: 1, rows: 1 };
  if (asp >= 2.4) return { cols: 3, rows: 1 };
  if (asp >= 1.3) return { cols: 2, rows: 1 };
  if (asp <= 1 / 1.3) return { cols: 1, rows: 2 };
  return { cols: 1, rows: 1 };
}

/**
 * Prepara as entradas do modelo — SÍNCRONO, dentro do quadro (o grabFull só
 * vale aqui). Devolve { ladrilhos: [{ img: ImageData S×S, map }], cols, rows }.
 *   S       lado do modelo (entrada quadrada)
 *   ajuste  'letterbox' (YOLOX, YOLO26) | 'esticar' (RF-DETR)
 */
export function preparar(src, ctx, { modo, S, ajuste = 'letterbox', pad = 114, msPorRun = 0, prepMs = 0 }) {
  const R = regiaoRoi(ctx) || { x1: 0, y1: 0, x2: 1, y2: 1 };
  const Wq = src.width, Hq = src.height;
  const asp = ((R.x2 - R.x1) * Wq) / Math.max(1, (R.y2 - R.y1) * Hq);
  const { cols, rows } = grade(modo, asp, msPorRun, prepMs);
  // resolução da base: o bastante para cada ladrilho chegar ao S do modelo, até 1920
  const precisa = Math.ceil((S * (cols - (cols - 1) * SOBRE)) / Math.max(0.05, R.x2 - R.x1));
  const maxW = Math.max(640, Math.min(1920, precisa));
  const t0 = performance.now();
  // fonte: o canvas pleno do hospedeiro (sem leitura de pixels) > o ImageData pleno > o quadro de trabalho
  let bc = null, BW = 0, BH = 0;
  if (ctx && typeof ctx.grabCanvas === 'function') {
    try { const g = ctx.grabCanvas(maxW); if (g && g.canvas && g.w) { bc = g.canvas; BW = g.w; BH = g.h; } } catch (_) { bc = null; }
  }
  if (!bc) {
    let base = null;
    if (ctx && typeof ctx.grabFull === 'function') {
      try { base = ctx.grabFull(maxW); } catch (_) { base = null; }
    }
    if (!base || !base.width) base = src;
    BW = base.width; BH = base.height;
    bc = canvas('base', BW, BH);
    bc.getContext('2d', { willReadFrequently: true }).putImageData(base, 0, 0);
  }

  const rx = R.x1 * BW, ry = R.y1 * BH, rw = (R.x2 - R.x1) * BW, rh = (R.y2 - R.y1) * BH;
  const tw = rw / (cols - (cols - 1) * SOBRE), th = rh / (rows - (rows - 1) * SOBRE);
  const dc = canvas('dst', S, S);
  const d = dc.getContext('2d', { willReadFrequently: true });
  d.imageSmoothingEnabled = true;
  d.imageSmoothingQuality = 'medium';
  const ladrilhos = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bx = rx + c * tw * (1 - SOBRE), by = ry + r * th * (1 - SOBRE);
      let map;
      if (ajuste === 'esticar') {
        d.drawImage(bc, bx, by, tw, th, 0, 0, S, S);
        map = { bx, by, sx: S / tw, sy: S / th, dx: 0, dy: 0, BW, BH };
      } else {
        const sc = Math.min(S / tw, S / th);
        const dw = Math.round(tw * sc), dh = Math.round(th * sc);
        const dx = Math.floor((S - dw) / 2), dy = Math.floor((S - dh) / 2);
        d.fillStyle = `rgb(${pad},${pad},${pad})`;
        d.fillRect(0, 0, S, S);
        d.drawImage(bc, bx, by, tw, th, dx, dy, dw, dh);
        map = { bx, by, sx: sc, sy: sc, dx, dy, BW, BH };
      }
      // limites do ladrilho no quadro (normalizados) e quais lados são emenda
      map.t = { x1: bx / BW, y1: by / BH, x2: (bx + tw) / BW, y2: (by + th) / BH };
      map.emenda = { e: c > 0, d: c < cols - 1, c: r > 0, b: r < rows - 1 };
      ladrilhos.push({ img: d.getImageData(0, 0, S, S), map });
    }
  }
  return { ladrilhos, cols, rows, baseW: BW, prepMs: performance.now() - t0 };
}

/**
 * Intervalo mínimo entre inferências no modo 'auto' (salto adaptativo de
 * quadros): o preparo roda na thread principal, então ele não pode passar
 * de ~20% do tempo — num aparelho lento (CPU 4×) a inferência espaça e a
 * exibição continua fluida; a previsão do rastreio cobre o intervalo.
 */
export function intervaloAuto(p, state) {
  const base = p.everyMs || 0;
  return p.entrada === 'auto' && state.prepMs ? Math.max(base, state.prepMs * 5) : base;
}

/** Guarda as medidas do preparo/inferência no estado do nó (para o 'auto'). */
export function medir(state, prep, t0) {
  state.msPorRun = (performance.now() - t0) / prep.ladrilhos.length;
  state.ladrilhos = prep.ladrilhos.length;
  // custo estimado de um preparo de 2 ladrilhos (estável: não oscila ao trocar 1 ↔ 2)
  const est = (prep.prepMs / prep.ladrilhos.length) * 2;
  state.prepMs = state.prepMs === undefined ? est : state.prepMs * 0.7 + est * 0.3;
}

/** Caixa em px do modelo (x1..y2) → normalizada no quadro inteiro. */
export function desfazer(b, map) {
  return {
    ...b,
    x1: Math.max(0, (map.bx + (b.x1 - map.dx) / map.sx) / map.BW),
    y1: Math.max(0, (map.by + (b.y1 - map.dy) / map.sy) / map.BH),
    x2: Math.min(1, (map.bx + (b.x2 - map.dx) / map.sx) / map.BW),
    y2: Math.min(1, (map.by + (b.y2 - map.dy) / map.sy) / map.BH),
  };
}

function naEmenda(b, map) {
  const t = map.t, e = map.emenda;
  return (e.e && b.x1 - t.x1 < BORDA) || (e.d && t.x2 - b.x2 < BORDA)
      || (e.c && b.y1 - t.y1 < BORDA) || (e.b && t.y2 - b.y2 < BORDA);
}

function ios(a, b) {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (w <= 0 || h <= 0) return 0;
  const m = Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1));
  return m > 0 ? (w * h) / m : 0;
}

/**
 * Roda o modelo em cada ladrilho, EM SÉRIE (a fila de inferência é única) e
 * junta as caixas. `rodar(img, i)` → Promise de caixas em px do modelo
 * ({x1,y1,x2,y2,score,cls}). Devolve caixas normalizadas no quadro.
 */
export async function inferir(prep, rodar, { iouNms = 0.5, maxDet = 100 } = {}) {
  const todas = [];
  for (let i = 0; i < prep.ladrilhos.length; i++) {
    const { img, map } = prep.ladrilhos[i];
    const caixas = await rodar(img, i);
    for (const b of caixas) {
      const n = desfazer(b, map);
      if (!(n.x2 > n.x1 && n.y2 > n.y1)) continue;
      n.lad = i; n.emenda = prep.ladrilhos.length > 1 && naEmenda(n, map);
      todas.push(n);
    }
  }
  return juntar(todas, { iouNms, maxDet });
}

/**
 * NMS por classe entre ladrilhos + fusão do objeto cortado na emenda: duas
 * caixas de ladrilhos diferentes, uma delas encostada na emenda, que se
 * cobrem (interseção/menor > 0,5) viram a união.
 */
export function juntar(caixas, { iouNms = 0.5, maxDet = 100 } = {}) {
  const ord = caixas.slice().sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of ord) {
    let fora = false;
    for (const k of keep) {
      if (k.cls !== d.cls) continue;
      if (iou(k, d) > iouNms) { fora = true; break; }
      if (k.lad !== d.lad && (k.emenda || d.emenda) && ios(k, d) > 0.5) {
        k.x1 = Math.min(k.x1, d.x1); k.y1 = Math.min(k.y1, d.y1);
        k.x2 = Math.max(k.x2, d.x2); k.y2 = Math.max(k.y2, d.y2);
        k.emenda = k.emenda && d.emenda;
        fora = true; break;
      }
    }
    if (!fora) { keep.push({ ...d }); if (keep.length >= maxDet) break; }
  }
  return keep.map(({ lad, emenda, ...b }) => b);
}
