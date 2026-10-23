/**
 * components/video/sincronia.js — atraso curto da IMAGEM exibida, para a
 * caixa do rastreio e o veículo baterem.
 *
 * A detecção de um quadro chega dezenas a centenas de ms depois dele. O
 * rastreio prevê a posição (track.bytetrack), mas previsão erra quando o
 * veículo freia ou muda de faixa. Num ARQUIVO ou no YouTube ninguém precisa
 * da imagem «agora»: dá para mostrar o quadro de L ms atrás, com L = a
 * latência da detecção, e desenhar as caixas daquele instante — que o
 * rastreio já conhece medido, não previsto.
 *
 * Câmera e streams ao vivo ficam de fora (modo 'auto'): lá vale a previsão.
 *
 * Memória limitada: cópias do quadro na resolução de EXIBIÇÃO (drawImage
 * vídeo→canvas, GPU para GPU, sem ler pixels), num anel de canvases
 * reaproveitados, até `maxBytes` (padrão 64 MB) e nunca mais que o atraso
 * pedido + folga.
 */

export class AtrasoQuadros {
  constructor({ maxBytes = 192e6, maxQuadros = 100 } = {}) {
    this.maxBytes = maxBytes;
    this.maxQuadros = maxQuadros;
    this.anel = [];          // [{ canvas, t }] do mais velho para o mais novo
    this.livres = [];        // canvases para reaproveitar
  }

  /** Guarda o quadro atual (recorte `c` da fonte, já espelhado se for o caso) no tamanho lw×lh. */
  guardar(el, c, mirror, t, lw, lh, atrasoMs) {
    /*
     * Tamanho guardado: o de exibição, mas nunca acima do recorte da fonte (não há o que ganhar) e,
     * com atraso longo (detector lento: RF-DETR small passa de 1 s), reduzido até caber no orçamento
     * os quadros que o atraso pede — antes o teto de memória cortava o anel e o atraso não era cumprido.
     */
    const sw = c && c.sw ? c.sw : lw;
    let k = Math.min(1, sw / lw);
    const quer = Math.ceil(((atrasoMs || 0) + 300) / 30) + 2;
    const bytes = lw * lh * 4 * k * k;
    if (bytes * quer > this.maxBytes) k *= Math.sqrt(this.maxBytes / (bytes * quer));
    k = Math.max(k, Math.min(1, 480 / lw));
    lw = Math.max(16, Math.round(lw * k)); lh = Math.max(16, Math.round(lh * k));
    const cap = Math.max(2, Math.min(this.maxQuadros, Math.floor(this.maxBytes / (lw * lh * 4))));
    // a fonte parou (pausa, busca, aba em segundo plano): o que está guardado é de antes
    const ult = this.anel[this.anel.length - 1];
    if (ult && (t - ult.t > 1000 || t < ult.t)) while (this.anel.length) this.livres.push(this.anel.shift().canvas);
    // descarta o que já passou do atraso (com folga de 250 ms) e o que excede o teto
    // (fica sempre um quadro mais velho que o alvo, para escolher() ter de onde tirar)
    while (this.anel.length > 1 && this.anel[1].t < t - atrasoMs - 250) this.livres.push(this.anel.shift().canvas);
    while (this.anel.length >= cap) this.livres.push(this.anel.shift().canvas);
    let cv = this.livres.pop();
    if (!cv) cv = document.createElement('canvas');
    if (cv.width !== lw || cv.height !== lh) { cv.width = lw; cv.height = lh; }
    const x = cv.getContext('2d', { alpha: false });
    x.save();
    if (mirror) { x.translate(lw, 0); x.scale(-1, 1); }
    try {
      x.drawImage(el, c.sx, c.sy, c.sw, c.sh, 0, 0, lw, lh);
    } catch (_) { x.restore(); this.livres.push(cv); return false; }
    x.restore();
    this.anel.push({ canvas: cv, t });
    // os livres também ocupam memória: guarda poucos
    while (this.livres.length > 2) this.livres.shift();
    return true;
  }

  /** O quadro mais novo capturado até `tAlvo` (ou o mais velho que houver). */
  escolher(tAlvo) {
    if (!this.anel.length) return null;
    let e = this.anel[0];
    for (const q of this.anel) { if (q.t <= tAlvo) e = q; else break; }
    return e;
  }

  /**
   * O quadro guardado mais PERTO de `tAlvo` (antes ou depois). Com o laço de quadros oscilando
   * alguns ms, o "mais novo até tAlvo" repete um quadro e pula o seguinte; o mais perto mantém o
   * passo do vídeo (Motion 3D: o Studio exibe o quadro e desenha a pose do instante dele).
   */
  escolherPerto(tAlvo) {
    if (!this.anel.length) return null;
    let e = this.anel[0];
    for (const q of this.anel) if (Math.abs(q.t - tAlvo) < Math.abs(e.t - tAlvo)) e = q;
    return e;
  }

  limpar() {
    this.anel.length = 0;
    this.livres.length = 0;
  }

  get tamanho() { return this.anel.length; }
}

/** A sincronia vale para esta fonte? 'auto' = arquivo e YouTube; 'sempre' = qualquer uma. */
export function sincroniaLigada(modo, sourceKind) {
  if (modo === 'sempre') return true;
  if (modo === 'auto') return sourceKind === 'file' || sourceKind === 'youtube';
  return false;
}
