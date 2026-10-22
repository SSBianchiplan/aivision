/**
 * cv/runtime/livres-h/multi.js — Corrida com VÁRIAS pessoas (CV-32), só
 * matemática (roda no node).
 *
 *  - cocoParaBlaze: os 17 pontos COCO do RTMO no arranjo de 33 do BlazePose
 *    (o resto da análise é o mesmo). Calcanhar e ponta do pé não existem no
 *    COCO: ficam ausentes, e o que depende deles (pisada, tornozelo) sai "—".
 *    A base do pé cai no tornozelo (comum.js · basePe), o que basta para o
 *    contato e a cadência.
 *  - RastreadorPessoas: IDs estáveis por caixa (IoU com a caixa prevista pela
 *    velocidade de cada um + distância dos centros). Numa panorâmica todos
 *    andam juntos na imagem: o deslocamento comum (mediana dos pareados)
 *    entra na previsão de quem não foi visto. IDs de um Re-ID/tracking da
 *    cadeia têm preferência (o operador decide).
 *  - GrupoCorrida: uma SessaoCorrida por ID e o resumo de todos.
 */
import { SessaoCorrida, resumoCorrida, alertasCorrida } from './corrida.js';
import { mediana } from './comum.js';

/** COCO-17 → índice BlazePose-33 (rótulos anatômicos nos dois). */
export const COCO_PARA_BLAZE = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
/** Pontos que o RTMO não dá (índices BlazePose): pisada e tornozelo ficam sem medida. */
export const AUSENTES_COCO = [29, 30, 31, 32];

/**
 * kps: 17 pontos {x, y, score|v} normalizados (0..1) ou em px (px = true).
 * espelhar: o quadro está espelhado — os rótulos do modelo saem trocados
 * (a esquerda da pessoa aparece à direita), então trocam de volta.
 */
export function cocoParaBlaze(kps, w, h, { px = false, espelhar = false } = {}) {
  const P = Array.from({ length: 33 }, () => ({ x: NaN, y: NaN, v: 0 }));
  const troca = [0, 2, 1, 4, 3, 6, 5, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15];
  for (let k = 0; k < 17 && k < kps.length; k++) {
    const q = kps[espelhar ? troca[k] : k];
    if (!q) continue;
    const v = q.score != null ? q.score : q.v != null ? q.v : 1;
    P[COCO_PARA_BLAZE[k]] = { x: px ? q.x : q.x * w, y: px ? q.y : q.y * h, v };
  }
  return P;
}

export function iouCaixa(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy, u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0 ? inter / u : 0;
}
const centro = (b) => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });
const mover = (b, dx, dy) => ({ x1: b.x1 + dx, y1: b.y1 + dy, x2: b.x2 + dx, y2: b.y2 + dy });

/**
 * IDs estáveis por caixa. atualizar(caixas, t) → ids (números), na ordem
 * das caixas. Caixas em qualquer unidade (px ou 0..1), desde que constante.
 */
export class RastreadorPessoas {
  constructor({ vidaMs = 1500, iouMin = 0.2 } = {}) { this.vidaMs = vidaMs; this.iouMin = iouMin; this.zerar(); }
  zerar() { this.trilhas = []; this.prox = 1; }
  /** Posição conhecida de um ID (rastreador de pose entre detecções): mantém a trilha viva e atual. */
  observar(id, b, t) {
    const tr = this.trilhas.find((x) => x.id === id);
    if (!tr) { this.trilhas.push({ id, b, t, v: null, n: 1 }); if (id >= this.prox) this.prox = id + 1; return; }
    const dt = Math.max(1, t - tr.t), c0 = centro(tr.b), c1 = centro(b);
    const v = { x: (c1.x - c0.x) / dt, y: (c1.y - c0.y) / dt };
    tr.v = tr.v ? { x: 0.7 * tr.v.x + 0.3 * v.x, y: 0.7 * tr.v.y + 0.3 * v.y } : v;
    tr.b = b; tr.t = t; tr.n++;
  }
  atualizar(caixas, t) {
    // previsão: velocidade própria; quem não tem, o deslocamento comum (panorâmica)
    const prev = this.trilhas.map((tr) => {
      const dt = t - tr.t;
      return { tr, b: tr.v ? mover(tr.b, tr.v.x * dt, tr.v.y * dt) : tr.b };
    });
    const pares = [];
    caixas.forEach((c, i) => prev.forEach((p, j) => {
      const s = iouCaixa(c, p.b);
      const cc = centro(c), cp = centro(p.b), tam = Math.max(c.x2 - c.x1, c.y2 - c.y1, 1e-9);
      const d = Math.hypot(cc.x - cp.x, cc.y - cp.y) / tam;
      // custo: IoU alto ou centro perto (pessoas rápidas: IoU zera entre amostras espaçadas)
      // tolerância cresce com o tempo sem ver a trilha (pose a 1–3 Hz ao vivo: entre amostras o corredor anda)
      const dMax = 0.6 + Math.min(1.2, Math.max(0, t - p.tr.t) / 1000);
      const nota = s > 0 ? s + 0.5 : d < dMax ? 0.5 - (d / dMax) * 0.5 : -1;
      if (s >= this.iouMin || d < dMax) pares.push({ i, j, nota });
    }));
    pares.sort((a, b) => b.nota - a.nota);
    const usadoI = new Set(), usadoJ = new Set(), ids = new Array(caixas.length).fill(null);
    const desloc = [];
    for (const { i, j } of pares) {
      if (usadoI.has(i) || usadoJ.has(j)) continue;
      usadoI.add(i); usadoJ.add(j);
      const tr = prev[j].tr, c = caixas[i], dt = Math.max(1, t - tr.t);
      const c0 = centro(tr.b), c1 = centro(c);
      const v = { x: (c1.x - c0.x) / dt, y: (c1.y - c0.y) / dt };
      tr.v = tr.v ? { x: 0.5 * tr.v.x + 0.5 * v.x, y: 0.5 * tr.v.y + 0.5 * v.y } : v;
      desloc.push(v);
      tr.b = c; tr.t = t; tr.n++;
      ids[i] = tr.id;
    }
    const vComum = desloc.length ? { x: mediana(desloc.map((v) => v.x)), y: mediana(desloc.map((v) => v.y)) } : null;
    for (const tr of this.trilhas) if (!usadoJ.has(prev.findIndex((p) => p.tr === tr)) && vComum && !tr.v) tr.v = vComum;
    caixas.forEach((c, i) => {
      if (ids[i] != null) return;
      const tr = { id: this.prox++, b: c, t, v: vComum, n: 1 };
      this.trilhas.push(tr); ids[i] = tr.id;
    });
    this.trilhas = this.trilhas.filter((tr) => t - tr.t <= this.vidaMs);
    return ids;
  }
}

/**
 * Uma SessaoCorrida por corredor. `pontos` = 17 (RTMO) ou 33 (BlazePose).
 * Guarda até `max` corredores: os que somem cedo e quase sem amostras saem
 * primeiro, para um "fantasma" de um quadro não ocupar a tabela.
 */
export class GrupoCorrida {
  constructor({ max = 60 } = {}) { this.max = max; this.zerar(); }
  zerar() { this.mapa = new Map(); this.geracao = (this.geracao || 0) + 1; }
  obter(id, pontos = 17) {
    let c = this.mapa.get(id);
    if (!c) {
      c = { id, sessao: new SessaoCorrida(), pontos, visto: 0, primeiro: null, area: 0, caixa: null };
      this.mapa.set(id, c);
      if (this.mapa.size > this.max) this._podar();
    }
    return c;
  }
  _podar() {
    // nunca quem foi visto nos últimos 3 s (está correndo agora); dos outros, sai quem tem menos amostras
    const agora = Math.max(...[...this.mapa.values()].map((c) => c.visto));
    const lista = [...this.mapa.values()].filter((c) => agora - c.visto > 3000)
      .sort((a, b) => a.sessao.amostras.length - b.sessao.amostras.length || a.visto - b.visto);
    while (this.mapa.size > this.max && lista.length) this.mapa.delete(lista.shift().id);
  }
  /** Amostra de um corredor. meta = { caixa, pontos, cam }. Devolve a amostra aceita (ou null). */
  adicionar(id, t, P, minVis, meta = {}) {
    const c = this.obter(id, meta.pontos || 17);
    if (meta.pontos) c.pontos = meta.pontos;
    if (meta.quadro) c.quadro = meta.quadro;
    if (meta.caixa) { c.caixa = meta.caixa; c.area = 0.8 * c.area + 0.2 * (meta.caixa.x2 - meta.caixa.x1) * (meta.caixa.y2 - meta.caixa.y1); }
    c.visto = t; if (c.primeiro == null) c.primeiro = t;
    return c.sessao.adicionar(t, P, minVis, meta);
  }
  /** Corredores com amostras suficientes (≥ minAmostras e ≥ 1,5 s de série), do maior (mais perto da câmera) ao menor. */
  lista(minAmostras = 8, minMs = 1500) {
    return [...this.mapa.values()].filter((c) => {
      const a = c.sessao.amostras;
      return a.length >= minAmostras && a[a.length - 1].t - a[0].t >= minMs;
    }).sort((a, b) => b.area - a.area);
  }
  get(id) { return this.mapa.get(id) || null; }
  /** Uma linha por corredor: análise, resumo e alertas. */
  resumos(cfg, minAmostras = 8) {
    return this.lista(minAmostras).map((c) => {
      const cfgC = { ...cfg, pontos: c.pontos };
      const r = c.sessao.analisar(cfgC);
      const res = resumoCorrida(r, cfgC);
      return { id: c.id, pontos: c.pontos, amostras: c.sessao.amostras.length, r, res, alertas: alertasCorrida(r, res, cfgC) };
    });
  }
}
