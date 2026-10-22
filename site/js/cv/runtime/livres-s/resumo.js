/**
 * cv/runtime/livres-s/resumo.js — RESUMO DE VÍDEO POR EVENTOS (100), sem DOM:
 *
 *   FundoMedio     subtração de fundo por média corrente (a mesma ideia do
 *                  video.background_subtractor do CV-04) numa grade pequena:
 *                  fração do quadro em primeiro plano e a caixa dele.
 *   Segmentador    atividade ≥ `limiar` por ≥ `minS` abre um EVENTO; ele fecha
 *                  depois de `silencioS` abaixo do limiar. Cada evento guarda
 *                  início, fim, pico, a caixa do movimento e uma miniatura.
 */

export class FundoMedio {
  constructor() { this.zerar(); }
  zerar() { this.bg = null; this.w = 0; this.h = 0; this.n = 0; }

  /** img (ImageData) → { frac, caixa (0–1) | null }. taxa = aprendizado; limiar em níveis de cinza. */
  quadro(img, { larg = 120, taxa = 0.03, limiar = 26, mascara = null } = {}) {
    const W = img.width, H = img.height, d = img.data;
    const w = Math.min(larg, W), h = Math.max(1, Math.round((H * w) / W));
    if (w !== this.w || h !== this.h || !this.bg) { this.w = w; this.h = h; this.bg = null; }
    const kx = W / w, ky = H / h;
    const g = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const yy = Math.min(H - 1, Math.floor((y + 0.5) * ky));
      for (let x = 0; x < w; x++) {
        const q = (yy * W + Math.min(W - 1, Math.floor((x + 0.5) * kx))) * 4;
        g[y * w + x] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
      }
    }
    if (!this.bg) { this.bg = g; this.n = 1; return { frac: 0, caixa: null }; }
    // aprendizado mais rápido nos primeiros quadros (o fundo se forma)
    const a = this.n < 20 ? Math.max(taxa, 1 / (this.n + 1)) : taxa;
    let fg = 0, tot = 0, x1 = w, y1 = h, x2 = -1, y2 = -1;
    for (let i = 0; i < g.length; i++) {
      const on = Math.abs(g[i] - this.bg[i]) > limiar;
      this.bg[i] += (g[i] - this.bg[i]) * a;
      if (mascara && !mascara[i]) continue;
      tot++;
      if (on) {
        fg++;
        const x = i % w, y = (i / w) | 0;
        if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      }
    }
    this.n++;
    return { frac: tot ? fg / tot : 0, caixa: x2 >= 0 ? { x1: x1 / w, y1: y1 / h, x2: (x2 + 1) / w, y2: (y2 + 1) / h } : null };
  }
}

export class Segmentador {
  constructor() { this.zerar(); }
  zerar() { this.eventos = []; this.aberto = null; this.acima = null; this.abaixo = null; this.serie = []; this.prox = 1; }

  /**
   * Um passo: t (s), atividade (fração 0–1), caixa. o = { limiar, minS, silencioS }.
   * Devolve { abriu, fechou } (o evento) para quem quer guardar miniatura.
   */
  passo(t, atv, caixa, o = {}) {
    const lim = o.limiar ?? 0.01, minS = o.minS ?? 0.5, sil = o.silencioS ?? 2;
    const ult = this.serie[this.serie.length - 1];
    if (!ult || t - ult[0] >= 0.25) { this.serie.push([t, atv]); if (this.serie.length > 40000) this.serie.shift(); }
    else if (atv > ult[1]) ult[1] = atv;
    let abriu = null, fechou = null;
    if (atv >= lim) {
      this.abaixo = null;
      if (this.acima == null) this.acima = t;
      if (!this.aberto && t - this.acima >= minS) {
        this.aberto = { id: this.prox++, t0: this.acima, t1: t, pico: atv, tPico: t, caixa: caixa ? { ...caixa } : null, thumb: null };
        abriu = this.aberto;
      }
      if (this.aberto) {
        const e = this.aberto;
        e.t1 = t;
        if (atv > e.pico) { e.pico = atv; e.tPico = t; e.novoPico = true; }
        if (caixa) e.caixa = e.caixa ? { x1: Math.min(e.caixa.x1, caixa.x1), y1: Math.min(e.caixa.y1, caixa.y1), x2: Math.max(e.caixa.x2, caixa.x2), y2: Math.max(e.caixa.y2, caixa.y2) } : { ...caixa };
      }
    } else {
      this.acima = null;
      if (this.aberto) {
        if (this.abaixo == null) this.abaixo = t;
        if (t - this.abaixo >= sil) {
          fechou = this.aberto;
          this.eventos.push(fechou);
          if (this.eventos.length > 2000) this.eventos.shift();
          this.aberto = null; this.abaixo = null;
        }
      }
    }
    return { abriu, fechou };
  }

  /** Eventos fechados + o aberto. */
  todos() { return this.aberto ? [...this.eventos, this.aberto] : this.eventos.slice(); }
}

/** Tempo total com evento e fração do observado. */
export function cobertura(eventos, dur) {
  const s = eventos.reduce((a, e) => a + Math.max(0, e.t1 - e.t0), 0);
  return { s, frac: dur > 0 ? s / dur : 0 };
}
