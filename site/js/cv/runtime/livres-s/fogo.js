/**
 * cv/runtime/livres-s/fogo.js — indício de CHAMA por cor e cintilação, sem
 * treino (68). JS puro, numa grade pequena:
 *
 *   cor          regra RGB/saturação de Chen, Wu & Chiou (ICIP 2004): R ≥ Rt,
 *                R ≥ G > B e S ≥ (255 − R)·St/Rt — vermelho/laranja/amarelo vivo.
 *   cintilação   média exponencial de |ΔR| entre quadros por pixel: a chama
 *                tremula (≈ 1–15 Hz) mesmo parada; um objeto laranja PARADO
 *                não tremula, e um que só ANDA tremula apenas na borda.
 *   candidato    pixel de cor de fogo com cintilação ≥ `cint`; a região conta
 *                se a FRAÇÃO cintilante dos pixels de cor for ≥ `fracCint` e a
 *                área ≥ `areaMin` (fração do quadro ou da ROI).
 *
 * INDICATIVO: não substitui detector de fumaça/chama certificado nem o
 * sistema de alarme de incêndio (ABNT NBR 17240) — reflexos, luz de LED
 * piscando e telas podem enganar; ausência de alerta não garante nada.
 */
export const AVISO_FOGO = 'INDICATIVO — não substitui detector de fumaça/chama certificado nem o sistema de detecção e ' +
  'alarme de incêndio (ABNT NBR 17240). Reflexos, LEDs piscando e telas podem gerar falso alarme; a ausência de ' +
  'alerta não garante nada.';

/** Regra de cor de Chen et al. (pixel RGB 0–255). */
export function corDeFogo(r, g, b, Rt = 135, St = 55) {
  if (r < Rt || r < g || g <= b) return false;
  const mx = r, mn = Math.min(g, b);
  const s = mx > 0 ? (255 * (mx - mn)) / mx : 0;
  return s >= ((255 - r) * St) / Rt;
}

export class DetectorFogo {
  constructor() { this.zerar(); }
  zerar() { this.w = 0; this.h = 0; this.antR = null; this.cint = null; this.n = 0; }

  /**
   * Um quadro (ImageData). o = { larg, Rt, St, cint, fracCint, alfa, mascara (Uint8Array w×h ou null) }.
   * Devolve { area (fração), fracCint, caixa {x1..y2 em 0–1} | null, candidatos, cor }.
   */
  quadro(img, o = {}) {
    const larg = o.larg || 160;
    const W = img.width, H = img.height, d = img.data;
    const w = Math.min(larg, W), h = Math.max(1, Math.round((H * w) / W));
    if (w !== this.w || h !== this.h) { this.w = w; this.h = h; this.antR = new Float32Array(w * h); this.cint = new Float32Array(w * h); this.n = 0; }
    const kx = W / w, ky = H / h, a = o.alfa ?? 0.3, Rt = o.Rt ?? 135, St = o.St ?? 55, lim = o.cint ?? 10;
    const M = o.mascara || null;
    let nCor = 0, nCand = 0, nTot = 0, x1 = w, y1 = h, x2 = -1, y2 = -1;
    const cand = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const yy = Math.min(H - 1, Math.floor((y + 0.5) * ky));
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const q = (yy * W + Math.min(W - 1, Math.floor((x + 0.5) * kx))) * 4;
        const r = d[q], g = d[q + 1], b = d[q + 2];
        const dR = this.n ? Math.abs(r - this.antR[i]) : 0;
        this.cint[i] += (dR - this.cint[i]) * a;
        this.antR[i] = r;
        if (M && !M[i]) continue;
        nTot++;
        if (!corDeFogo(r, g, b, Rt, St)) continue;
        nCor++;
        if (this.cint[i] >= lim) {
          nCand++; cand[i] = 1;
          if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
        }
      }
    }
    this.n++;
    const fracCint = nCor ? nCand / nCor : 0;
    return {
      area: nTot ? nCand / nTot : 0, cor: nTot ? nCor / nTot : 0, fracCint, candidatos: nCand, mapa: cand, w, h,
      caixa: x2 >= 0 ? { x1: x1 / w, y1: y1 / h, x2: (x2 + 1) / w, y2: (y2 + 1) / h } : null,
    };
  }
}
