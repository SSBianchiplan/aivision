/**
 * cv/runtime/livres-s/cena-ref.js — CENA DE REFERÊNCIA ("vazia") para os
 * operadores do grupo S que medem ocupação SEM detector: saída de emergência
 * obstruída (CV-61), lixeira cheia e vaga por diferença (CV-64).
 *
 * Tudo em cinza numa resolução pequena (LARG px de largura): barato a 60 Hz e
 * sem guardar imagem que identifique alguém — só números de brilho de uma
 * miniatura borrada.
 *
 *   referência  capturada sob demanda («Capturar cena vazia» no Medições sobe a
 *               geração da chave no canal) ou sozinha: na primeira vez em que a
 *               cena fica parada por `estavelS` segundos.
 *   diferença   |quadro − referência| depois de compensar o ganho global
 *               (luz que muda em toda a cena não conta como objeto).
 *   parado      pixel diferente da referência E igual ao quadro de ~`lagS` s
 *               atrás: objeto que ficou, não gente passando.
 *
 * As máscaras das zonas (polígono, elipse, retângulo, pincel) são rasterizadas
 * na mesma grade uma vez por mudança de geometria.
 */
import { dentro } from '../../marcacoes.js';

export const LARG = 160;

/** Miniatura cinza (LARG × proporcional) com média 2×2 implícita pela amostragem por área. */
export function miniCinza(img, larg = LARG) {
  const W = img.width, H = img.height, d = img.data;
  const w = Math.min(larg, W), h = Math.max(1, Math.round((H * w) / W));
  const out = new Float32Array(w * h);
  const kx = W / w, ky = H / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ky), y1 = Math.max(y0 + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * kx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * kx));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 2) {
        for (let xx = x0; xx < x1; xx += 2) {
          const q = (yy * W + xx) * 4;
          s += 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]; n++;
        }
      }
      out[y * w + x] = n ? s / n : 0;
    }
  }
  return { g: out, w, h };
}

/** Máscara (Uint8Array w×h) de uma marcação de área na grade pequena. */
export function mascaraZona(it, w, h) {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) if (dentro(it, (x + 0.5) / w, v)) m[y * w + x] = 1;
  }
  return m;
}

/** Assinatura da geometria de uma marcação (para refazer a máscara só quando muda). */
export const assinatura = (it) => `${it.id}:${it.tipo}:${it.pts.map((p) => p[0].toFixed(4) + ',' + p[1].toFixed(4)).join(';')}`;

export class ReferenciaCena {
  constructor() { this.zerar(); }

  zerar() {
    this.ref = null; this.w = 0; this.h = 0;
    this.hist = [];            // [{ t, g }] para o "parado" (lag)
    this.desdeEstavel = null; this.ant = null;
    this.capturadaEm = null;
    this.masks = new Map();    // id → { sig, m, n }
  }

  /** Captura a referência agora a partir da miniatura `mc`. */
  capturar(mc, t) {
    this.ref = Float32Array.from(mc.g); this.w = mc.w; this.h = mc.h; this.capturadaEm = t;
    this.hist = [];
  }

  /** Movimento médio (níveis de cinza) entre a miniatura e a anterior. */
  static movimento(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  /**
   * Um quadro: guarda o histórico e, sem referência, captura sozinha depois
   * de `estavelS` s de cena parada (movimento médio < `movMax`).
   * Devolve { pronta, auto } (auto = acabou de capturar sozinha).
   */
  quadro(mc, t, { estavelS = 2, movMax = 2.5, lagS = 1, auto = true } = {}) {
    let capturou = false;
    if (this.ref && (this.w !== mc.w || this.h !== mc.h)) this.ref = null;   // tamanho mudou: recomeça
    if (!this.ref && auto) {
      const mov = ReferenciaCena.movimento(mc.g, this.ant);
      if (mov < movMax) {
        if (this.desdeEstavel == null) this.desdeEstavel = t;
        if (t - this.desdeEstavel >= estavelS) { this.capturar(mc, t); capturou = true; }
      } else this.desdeEstavel = null;
    }
    this.ant = mc.g;
    this.hist.push({ t, g: mc.g });
    while (this.hist.length > 2 && t - this.hist[1].t >= lagS) this.hist.shift();
    return { pronta: Boolean(this.ref), auto: capturou };
  }

  /** Ganho global (quadro/referência) medido FORA das zonas: luz que muda em toda a cena. */
  ganho(g, fora) {
    let a = 0, b = 0;
    for (let i = 0; i < g.length; i++) if (!fora || !fora[i]) { a += g[i]; b += this.ref[i]; }
    return b > 0 ? a / b : 1;
  }

  /** Máscara cacheada de uma zona nesta grade. */
  mascara(it) {
    const sig = assinatura(it) + `@${this.w}x${this.h}`;
    let e = this.masks.get(it.id);
    if (!e || e.sig !== sig) {
      const m = mascaraZona(it, this.w, this.h);
      let n = 0;
      for (let i = 0; i < m.length; i++) n += m[i];
      this.masks.set(it.id, (e = { sig, m, n }));
    }
    return e;
  }

  /**
   * Fração da zona diferente da referência (`dif`) e fração diferente E parada
   * (`parado`: igual ao quadro de ~lag s atrás, dentro de `limiar`/2).
   * `excluir(i)` opcional tira pixels (caixas de pessoas).
   */
  medir(it, mc, { limiar = 22, ganho = 1, excluir = null } = {}) {
    if (!this.ref) return { dif: 0, parado: 0, n: 0 };
    const { m, n } = this.mascara(it);
    const g = mc.g, r = this.ref, velho = this.hist.length ? this.hist[0].g : null;
    let nd = 0, np = 0, nn = 0;
    const lim2 = limiar / 2;
    for (let i = 0; i < m.length; i++) {
      if (!m[i]) continue;
      if (excluir && excluir(i)) continue;
      nn++;
      if (Math.abs(g[i] / ganho - r[i]) > limiar) {
        nd++;
        if (!velho || Math.abs(g[i] - velho[i]) <= lim2) np++;
      }
    }
    return { dif: nn ? nd / nn : 0, parado: nn ? np / nn : 0, n: nn, total: n };
  }

  /** Absorve devagar a cena atual na referência (só onde NÃO há objeto parado). */
  adaptar(mc, taxa) {
    if (!this.ref || !(taxa > 0)) return;
    const g = mc.g, r = this.ref;
    for (let i = 0; i < r.length; i++) r[i] += (g[i] - r[i]) * taxa;
  }
}

/** Máscara (grade w×h) das caixas de pessoas da cadeia, para excluir da diferença. */
export function mascaraPessoas(dets, w, h, margem = 0.02) {
  if (!Array.isArray(dets) || !dets.length) return null;
  const m = new Uint8Array(w * h);
  let algum = false;
  for (const d of dets) {
    if (!d || !/pessoa|person/i.test(String(d.name || ''))) continue;
    algum = true;
    const x1 = Math.max(0, Math.floor((d.x1 - margem) * w)), x2 = Math.min(w, Math.ceil((d.x2 + margem) * w));
    const y1 = Math.max(0, Math.floor((d.y1 - margem) * h)), y2 = Math.min(h, Math.ceil((d.y2 + margem) * h));
    for (let y = y1; y < y2; y++) m.fill(1, y * w + x1, y * w + x2);
  }
  return algum ? m : null;
}
