/**
 * cv/runtime/livres-n/gatilhos.js — QUANDO a peça é inspecionada (porte de
 * cameras/trigger.py do GPlanSiS|Inspect; o de presença é o mesmo algoritmo
 * de frontend/src/lib/presence.ts). Uma única inspeção por passagem.
 *
 *   presenca   fundo aprendido + histerese: a ocupação da ROI (pixels que
 *              diferem do fundo) passa de `on_ratio` → "entrando"; depois de
 *              `stable_frames` quadros com pouco movimento (peça assentada),
 *              dispara UMA vez; volta a "vazio" só abaixo de `off_ratio`. O
 *              fundo só aprende com a ROI vazia — peça parada não vira fundo.
 *   linha      esteira contínua (a peça não para): dispara quando o centróide
 *              do que difere do fundo cruza a linha vertical no meio da faixa,
 *              no sentido escolhido, uma vez por objeto.
 *   intervalo  a cada N segundos.
 *   manual     só pelo botão "Inspecionar agora" (ou pelo Studio).
 *
 * Operam na imagem REDUZIDA do pipeline (o quadro que o executor entrega),
 * como o Inspect, e ainda numa grade fixa de até 64×64 células da ROI
 * (lumaEmGrade): o app muda a resolução do pipeline sozinho e o fundo
 * aprendido não pode depender disso. `min_pixels` do gatilho de linha conta
 * CÉLULAS dessa grade. A inspeção em si usa o quadro em resolução plena.
 * Sem alocação por quadro: o fundo e a luminância da ROI são Float32Array
 * reaproveitados (só realocam quando o tamanho da ROI muda).
 */

/** Luminância (0,299 R + 0,587 G + 0,114 B) da ROI x,y,w,h de um ImageData em `out`. */
export function lumaDaRoi(img, x, y, w, h, out) {
  const W = img.width, d = img.data;
  for (let j = 0; j < h; j++) {
    let p = ((y + j) * W + x) * 4, q = j * w;
    for (let i = 0; i < w; i++, p += 4) out[q++] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  return out;
}

/**
 * Luminância da ROI numa GRADE de tamanho fixo (média por célula, amostrando
 * de 2 em 2 px): o pipeline muda de resolução sozinho (qualidade adaptativa,
 * zoom), e o fundo aprendido não pode depender disso — com a grade, a mesma
 * ROI dá o mesmo vetor em 480 ou 960 px de largura. Também sai mais barato.
 */
export function lumaEmGrade(img, x, y, w, h, gw, gh, out) {
  const W = img.width, d = img.data;
  const kx = w / gw, ky = h / gh;
  const passo = kx > 3 && ky > 3 ? 2 : 1;
  for (let j = 0; j < gh; j++) {
    const ya = y + Math.floor(j * ky), yb = Math.max(ya + 1, y + Math.floor((j + 1) * ky));
    for (let i = 0; i < gw; i++) {
      const xa = x + Math.floor(i * kx), xb = Math.max(xa + 1, x + Math.floor((i + 1) * kx));
      let s = 0, n = 0;
      for (let yy = ya; yy < yb; yy += passo) {
        let p = (yy * W + xa) * 4;
        for (let xx = xa; xx < xb; xx += passo, p += 4 * passo) { s += 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]; n++; }
      }
      out[j * gw + i] = n ? s / n : 0;
    }
  }
  return out;
}

export class GatilhoPresenca {
  constructor({ on_ratio = 0.08, off_ratio = 0.03, diff_thr = 25, stable_frames = 3, motion_max = 0.02, learn_rate = 0.05 } = {}) {
    Object.assign(this, { onRatio: on_ratio, offRatio: off_ratio, diffThr: diff_thr, stableFrames: stable_frames, motionMax: motion_max, learnRate: learn_rate });
    this.modo = 'presenca';
    this.reiniciar();
  }
  reiniciar() { this.bg = null; this.estado = 'vazio'; this.estavel = 0; this.ant = 0; this.ocupacao = 0; this.disparos = this.disparos || 0; }
  /** `g` = luminância da ROI já recortada. true uma única vez por peça, quando assenta. */
  atualizar(g) {
    if (!this.bg || this.bg.length !== g.length) { this.bg = Float32Array.from(g); return false; }
    const bg = this.bg, thr = this.diffThr;
    let dif = 0;
    for (let i = 0; i < g.length; i++) if (Math.abs(g[i] - bg[i]) > thr) dif++;
    const occ = dif / g.length;
    const mov = Math.abs(occ - this.ant);
    this.ant = occ; this.ocupacao = occ;
    let dispara = false;
    if (this.estado === 'vazio') {
      if (occ >= this.onRatio) { this.estado = 'entrando'; this.estavel = 0; }
      else { const k = this.learnRate; for (let i = 0; i < g.length; i++) bg[i] += k * (g[i] - bg[i]); }   // luz muda só com ROI vazia
    } else if (this.estado === 'entrando') {
      if (occ < this.offRatio) this.estado = 'vazio';
      else if (mov <= this.motionMax) {
        if (++this.estavel >= this.stableFrames) { this.estado = 'inspecionada'; dispara = true; this.disparos++; }
      } else this.estavel = 0;
    } else if (occ < this.offRatio) this.estado = 'vazio';
    return dispara;
  }
}

export class GatilhoLinha {
  /** `direction` +1 esquerda→direita, −1 direita→esquerda; `min_pixels` na imagem reduzida. */
  constructor({ direction = 1, diff_thr = 25, min_pixels = 150 } = {}) {
    Object.assign(this, { direcao: direction >= 0 ? 1 : -1, diffThr: diff_thr, minPixels: min_pixels });
    this.modo = 'linha';
    this.reiniciar();
  }
  reiniciar() { this.bg = null; this.cxAnt = null; this.ocupacao = 0; this.estado = 'vazio'; this.disparos = this.disparos || 0; }
  /** `g` = luminância da faixa (w de largura). */
  atualizar(g, w) {
    if (!this.bg || this.bg.length !== g.length) { this.bg = Float32Array.from(g); return false; }
    const bg = this.bg, thr = this.diffThr;
    let n = 0, sx = 0;
    for (let i = 0; i < g.length; i++) if (Math.abs(g[i] - bg[i]) > thr) { n++; sx += i % w; }
    this.ocupacao = n / g.length;
    if (n < this.minPixels) {
      for (let i = 0; i < g.length; i++) bg[i] += 0.05 * (g[i] - bg[i]);
      this.cxAnt = null; this.estado = 'vazio';
      return false;
    }
    const cx = sx / n, linha = w / 2, a = this.cxAnt;
    const cruzou = a != null && ((this.direcao > 0 && a < linha && linha <= cx) || (this.direcao < 0 && a > linha && linha >= cx));
    this.cxAnt = cx;
    this.estado = cruzou ? 'inspecionada' : 'entrando';
    if (cruzou) this.disparos++;
    return cruzou;
  }
}

export class GatilhoIntervalo {
  constructor({ seconds = 1 } = {}) { this.segundos = Math.max(0.05, +seconds || 1); this.modo = 'intervalo'; this.reiniciar(); }
  reiniciar() { this.prox = 0; this.estado = 'vazio'; this.ocupacao = 0; this.disparos = this.disparos || 0; }
  atualizar(_g, _w, agora = performance.now() / 1000) {
    if (agora >= this.prox) { this.prox = agora + this.segundos; this.disparos++; return true; }
    return false;
  }
}

export class GatilhoManual {
  constructor() { this.modo = 'manual'; this.reiniciar(); }
  reiniciar() { this.estado = 'vazio'; this.ocupacao = 0; this.disparos = this.disparos || 0; }
  atualizar() { return false; }
}

/** Monta o gatilho da configuração do programa (mesmas chaves do `trigger` de câmera do Inspect). */
export function criarGatilho(cfg = {}) {
  const modo = cfg.mode || 'presence';
  if (modo === 'interval') return new GatilhoIntervalo(cfg);
  if (modo === 'line') return new GatilhoLinha(cfg);
  if (modo === 'manual') return new GatilhoManual(cfg);
  return new GatilhoPresenca(cfg);
}

export const MODOS_GATILHO = [
  ['presence', 'Presença (fundo aprendido + histerese)'],
  ['line', 'Linha (esteira contínua)'],
  ['interval', 'Intervalo (segundos)'],
  ['manual', 'Manual (botão)'],
];
