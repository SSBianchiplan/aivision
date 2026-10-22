/**
 * cv/runtime/livres-r/imagem.js — análises de imagem da onda 2-a em JS puro,
 * sem DOM (o mesmo arquivo roda no Node, nos testes com quadros sintéticos):
 *
 *   cinzaRoi / luminanciaLinear     recorte em cinza (0–255) ou Y linear (0–1)
 *   nivelVisor        (54) interface líquido/ar no visor: perfil vertical da
 *                     coluna central, degrau mais forte, refino subpixel
 *   DetectorGotas     (55) gotas que caem: diferença entre quadros, manchas
 *                     pequenas seguidas por vizinho mais próximo; poça: área
 *                     que mudou contra o fundo de referência
 *   bordasCorreia     (56) as duas bordas da correia pelo perfil transversal
 *   marcaTorque       (57) a tinta da marca de torque pela cor (ΔE2000):
 *                     eixo da tinta na cabeça × direção da tinta na base
 *   corRegiao, cctMcCamy  (58) cor média (Lab) da região clara e temperatura
 *                     de cor correlata aproximada
 *   pontosSolda       (59) mancha circular de raio r em cada posição nominal
 *                     (disco × anel, por imagem integral) e manchas sobrando
 *   opacidadeFumaca   (61) opacidade da pluma contra o céu (Y linear) e o
 *                     número de Ringelmann equivalente — INDICATIVO
 *   medirFissuras     (C2) fissura escura: fundo por média larga, histerese,
 *                     esqueleto (Zhang-Suen), comprimento pela direção local e largura
 *                     pela área do vale no perfil normal ao eixo
 */
import { labDeRgb, deltaE2000 } from '../livres-n/visao.js';
export { labDeRgb, deltaE2000 };

const fin = Number.isFinite;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Retângulo inteiro dentro da imagem a partir de {x,y,w,h} em px. */
export function caixaPx(img, r) {
  const x0 = clamp(Math.floor(r.x), 0, img.width - 1), y0 = clamp(Math.floor(r.y), 0, img.height - 1);
  const x1 = clamp(Math.ceil(r.x + r.w), x0 + 1, img.width), y1 = clamp(Math.ceil(r.y + r.h), y0 + 1, img.height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Cinza (0–255, Rec.601) do recorte → Float32Array w·h. */
export function cinzaRoi(img, r, out) {
  const W = img.width, d = img.data;
  const o = out && out.length === r.w * r.h ? out : new Float32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    let p = ((r.y + y) * W + r.x) * 4, q = y * r.w;
    for (let x = 0; x < r.w; x++, p += 4) o[q++] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
  }
  return o;
}

export const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const gama = (c) => { c = clamp(c, 0, 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
export { gama };

/** Luminância relativa Y (linear, 0–1) de um pixel RGB 8 bits. */
export const yLin = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];

function mediana(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/** Refino parabólico do pico em i de um vetor. */
function parabola(v, i) {
  if (i <= 0 || i >= v.length - 1) return i;
  const a = v[i - 1], b = v[i], c = v[i + 1], den = a - 2 * b + c;
  return den ? i + clamp(0.5 * (a - c) / den, -0.5, 0.5) : i;
}

// ------------------------------------------------------------------ 54 nível pelo visor

/**
 * Nível no visor (tubo de vidro, janela do silo). `r` = recorte em px do
 * visor (de cima para baixo). Usa a faixa central (frac da largura) para
 * fugir dos reflexos da borda do vidro. Perfil por linha (média) do canal:
 *   'luz'  luminância;  'cor'  saturação (líquido colorido × ar)
 * O degrau mais forte (gradiente suavizado, σ ≈ 2 px) é a interface;
 * polaridade 'auto' aceita os dois sentidos, 'escuro'/'claro' = como o
 * produto aparece EMBAIXO. Devolve { frac (0 = fundo, 1 = topo), y (px),
 * forca (degrau ÷ ruído), perfil }.
 */
export function nivelVisor(img, r, o = {}) {
  const W = img.width, d = img.data;
  const fr = o.frac ?? 0.5, canal = o.canal || 'luz';
  const xa = r.x + Math.floor(r.w * (1 - fr) / 2), xb = Math.max(xa + 1, r.x + Math.ceil(r.w * (1 + fr) / 2));
  const P = new Float64Array(r.h);
  for (let y = 0; y < r.h; y++) {
    let s = 0;
    for (let x = xa; x < xb; x++) {
      const p = ((r.y + y) * W + x) * 4, R = d[p], G = d[p + 1], B = d[p + 2];
      if (canal === 'cor') { const mx = Math.max(R, G, B), mn = Math.min(R, G, B); s += mx ? (255 * (mx - mn)) / mx : 0; }
      else s += 0.299 * R + 0.587 * G + 0.114 * B;
    }
    P[y] = s / (xb - xa);
  }
  // suaviza (gaussiana σ = 2) e deriva (diferença central)
  const k = [0.054, 0.242, 0.399, 0.242, 0.054];
  const S = new Float64Array(r.h);
  for (let y = 0; y < r.h; y++) { let s = 0, wsum = 0; for (let j = -2; j <= 2; j++) { const yy = y + j * 1; if (yy < 0 || yy >= r.h) continue; s += P[yy] * k[j + 2]; wsum += k[j + 2]; } S[y] = s / wsum; }
  const D = new Float64Array(r.h);
  for (let y = 2; y < r.h - 2; y++) D[y] = (S[y + 2] - S[y - 2]) / 4;   // + = mais claro embaixo
  const pol = o.polaridade || 'auto';
  const A = new Float64Array(r.h);
  for (let y = 0; y < r.h; y++) A[y] = pol === 'escuro' ? -D[y] : pol === 'claro' ? D[y] : Math.abs(D[y]);
  let best = -1, bv = 0;
  for (let y = 3; y < r.h - 3; y++) if (A[y] > bv) { bv = A[y]; best = y; }
  if (best < 0) return null;
  // ruído = desvio robusto do gradiente
  const ad = Array.from(A).slice(3, r.h - 3).sort((a, b) => a - b);
  const ruido = (ad[ad.length >> 1] || 0) * 1.4826 + 0.05;
  const ys = parabola(A, best);
  return { frac: clamp(1 - (ys + 0.5) / r.h, 0, 1), y: r.y + ys + 0.5, forca: bv / ruido, perfil: S };
}

// ------------------------------------------------------------------ 55 gotejamento / vazamento

/**
 * Detector de gotas e de poça numa área. Recebe o cinza do recorte a cada
 * quadro (já reduzido). Gota = mancha que destoa de um FUNDO MÓVEL (média
 * que só aprende onde não há mancha, α = aprender) com área [aMin, aMax];
 * manchas de quadros seguidos se ligam pelo vizinho mais próximo (até
 * `salto` px, sem subir) — cada trilha nova que dura ≥ minQuadros e DESCE
 * (≥ descidaMin px) é uma gota. Poça = fração de pixels que diferem do fundo
 * de REFERÊNCIA (média dos primeiros quadros) por mais que limiarPoca em ≥ 3
 * quadros seguidos; a poça não vira gota (é maior que aMax e não desce).
 */
export class DetectorGotas {
  constructor(o = {}) {
    this.o = { limiar: 22, aMin: 3, aMax: 400, salto: 40, minQuadros: 2, descidaMin: 2, limiarPoca: 18, fundoQuadros: 10, aprender: 0.05, ...o };
    this.zerar();
  }
  zerar() { this.bg = null; this.trilhas = []; this.gotas = []; this.prox = 1; this.fundo = null; this.nf = 0; this.acum = null; this.persist = null; this.serie = []; this.t0 = null; }

  passo(g, w, h, t) {
    const o = this.o, N = w * h;
    const novas = [];
    if (this.t0 == null) this.t0 = t;
    if (this.bg && this.bg.length === N) {
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) m[i] = Math.abs(g[i] - this.bg[i]) > o.limiar ? 1 : 0;
      const manchas = manchasDe(m, w, h, o.aMin, o.aMax);
      const usadas = new Set();
      for (const tr of this.trilhas) {
        let melhor = -1, md = o.salto;
        manchas.forEach((b, j) => {
          if (usadas.has(j)) return;
          const dd = Math.hypot(b.x - tr.x, b.y - tr.y);
          if (dd < md && b.y >= tr.y - 3) { md = dd; melhor = j; }
        });
        if (melhor >= 0) {
          const b = manchas[melhor]; usadas.add(melhor);
          tr.x = b.x; tr.y = b.y; tr.n++; tr.perdido = 0; tr.yMax = Math.max(tr.yMax, b.y);
          if (!tr.contada && tr.n >= o.minQuadros && tr.yMax - tr.y0 >= o.descidaMin) {
            tr.contada = true;
            const gt = { t, id: tr.id, x: tr.x, y: tr.y };
            this.gotas.push(gt); novas.push(gt);
            if (this.gotas.length > 10000) this.gotas.shift();
          }
        } else tr.perdido++;
      }
      this.trilhas = this.trilhas.filter((tr) => tr.perdido < 3);
      manchas.forEach((b, j) => { if (!usadas.has(j)) this.trilhas.push({ id: this.prox++, x: b.x, y: b.y, y0: b.y, yMax: b.y, n: 1, perdido: 0, contada: false }); });
      // fundo móvel: aprende só fora das manchas
      const a = o.aprender;
      for (let i = 0; i < N; i++) if (!m[i]) this.bg[i] += a * (g[i] - this.bg[i]);
    } else this.bg = Float32Array.from(g);
    // fundo de referência (média dos primeiros quadros) e poça persistente
    if (this.nf < o.fundoQuadros) {
      if (!this.acum || this.acum.length !== N) { this.acum = new Float64Array(N); this.nf = 0; }
      for (let i = 0; i < N; i++) this.acum[i] += g[i];
      this.nf++;
      if (this.nf === o.fundoQuadros) { this.fundo = new Float32Array(N); for (let i = 0; i < N; i++) this.fundo[i] = this.acum[i] / this.nf; this.persist = new Uint8Array(N); }
    }
    let poca = NaN;
    if (this.fundo && this.fundo.length === N) {
      let n = 0;
      for (let i = 0; i < N; i++) {
        if (Math.abs(g[i] - this.fundo[i]) > o.limiarPoca) { if (this.persist[i] < 255) this.persist[i]++; } else this.persist[i] = 0;
        if (this.persist[i] >= 3) n++;
      }
      poca = n / N;
      this.serie.push([t, poca]);
      if (this.serie.length > 3600) this.serie.shift();
    }
    return { novas, poca };
  }

  /** Gotas por minuto na janela [t − jan, t]. */
  taxa(t, jan = 60) {
    let n = 0;
    for (let i = this.gotas.length - 1; i >= 0 && this.gotas[i].t >= t - jan; i--) n++;
    const dur = Math.min(jan, t - (this.t0 ?? t));
    return dur < 5 ? NaN : (n * 60) / dur;
  }

  /** Inclinação (fração/min) da poça nos últimos `jan` s (mínimos quadrados). */
  tendenciaPoca(t, jan = 120) { return inclinacao(this.serie.filter(([tt]) => tt >= t - jan)) * 60; }
}

/** Componentes 8-conexos de uma máscara binária com área em [aMin, aMax] → [{x, y, area}] (centroides). */
export function manchasDe(m, w, h, aMin, aMax) {
  const lab = new Int32Array(w * h), fila = new Int32Array(w * h), out = [];
  let k = 0;
  for (let s = 0; s < w * h; s++) {
    if (!m[s] || lab[s]) continue;
    k++; let a = 0, b = 0, sx = 0, sy = 0;
    lab[s] = k; fila[b++] = s;
    while (a < b) {
      const i = fila[a++], x = i % w, y = (i - x) / w;
      sx += x; sy += y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (m[j] && !lab[j]) { lab[j] = k; fila[b++] = j; }
      }
    }
    if (b >= aMin && b <= aMax) out.push({ x: sx / b, y: sy / b, area: b });
  }
  return out;
}

/** Inclinação por mínimos quadrados de [[t, v]…] (unidade de v por s). */
export function inclinacao(serie) {
  const n = serie.length;
  if (n < 3) return NaN;
  let st = 0, sv = 0;
  for (const [t, v] of serie) { st += t; sv += v; }
  const mt = st / n, mv = sv / n;
  let num = 0, den = 0;
  for (const [t, v] of serie) { num += (t - mt) * (v - mv); den += (t - mt) ** 2; }
  return den ? num / den : NaN;
}

// ------------------------------------------------------------------ 56 desalinhamento de correia

/**
 * Bordas da correia num recorte. `eixo` = direção do MOVIMENTO da correia
 * na imagem: 'vertical' (a correia corre de cima para baixo; bordas são
 * colunas) ou 'horizontal'. Perfil transversal = média ao longo do
 * movimento (borra a textura da carga), gradiente σ ≈ 1,5 px, a borda
 * esquerda é o maior |gradiente| na metade esquerda e a direita na metade
 * direita; subpixel por parábola. → { e, d, centro, largura } em px da imagem.
 */
export function bordasCorreia(img, r, eixo = 'vertical') {
  const W = img.width, d = img.data;
  const vert = eixo !== 'horizontal';
  const n = vert ? r.w : r.h, m = vert ? r.h : r.w;
  const P = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) {
      const x = vert ? r.x + i : r.x + j, y = vert ? r.y + j : r.y + i;
      const p = (y * W + x) * 4;
      s += 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    }
    P[i] = s / m;
  }
  const k = [0.0545, 0.2442, 0.4026, 0.2442, 0.0545];
  const S = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0, ws = 0; for (let j = -2; j <= 2; j++) { const ii = i + j; if (ii < 0 || ii >= n) continue; s += P[ii] * k[j + 2]; ws += k[j + 2]; } S[i] = s / ws; }
  const G = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) G[i] = Math.abs(S[i + 1] - S[i - 1]) / 2;
  const meio = n >> 1;
  let ie = -1, ve = 0, id = -1, vd = 0;
  for (let i = 2; i < meio; i++) if (G[i] > ve) { ve = G[i]; ie = i; }
  for (let i = meio; i < n - 2; i++) if (G[i] > vd) { vd = G[i]; id = i; }
  if (ie < 0 || id < 0) return null;
  const ad = Array.from(G).slice(2, n - 2).sort((a, b) => a - b);
  const ruido = (ad[ad.length >> 1] || 0) * 1.4826 + 0.05;
  const base = vert ? r.x : r.y;
  const e = base + parabola(G, ie) + 0.5, dd = base + parabola(G, id) + 0.5;
  return { e, d: dd, centro: (e + dd) / 2, largura: dd - e, forca: Math.min(ve, vd) / ruido };
}

// ------------------------------------------------------------------ 57 marca de torque

/** "#e8d020" → [r, g, b]. */
export function hexRgb(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lab de um pixel com cache por cor (5 bits por canal). */
const cacheLab = new Map();
function labRapido(r, g, b) {
  const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
  let v = cacheLab.get(k);
  if (!v) { v = labDeRgb((r & 0xf8) | 4, (g & 0xf8) | 4, (b & 0xf8) | 4); cacheLab.set(k, v); }
  return v;
}

/**
 * Marca de torque num parafuso/porca. `c` = centro [x,y] e `R` = raio
 * externo (px) da área marcada; `rCab` = fração do raio da cabeça/porca.
 * Tinta = pixels com ΔE2000 ≤ tol da cor de referência.
 *   cabeça (r < rCab·R·0,95): eixo principal da tinta (PCA, sem sentido)
 *   base   (rCab·R·1,08 < r ≤ R): direção do centro ao centroide da tinta
 * Desvio = ângulo entre o eixo da cabeça e a direção da base (0–90°). Com
 * referência (ref = { cab, base } gravados com a marca alinhada) o desvio é
 * a rotação da cabeça relativa à base desde a referência.
 * → { ok, desvio (graus), angCab, angBase, nCab, nBase }
 */
export function marcaTorque(img, c, R, o = {}) {
  const W = img.width, H = img.height, d = img.data;
  const cor = hexRgb(o.cor || '#e8d020') || [232, 208, 32];
  const lr = labDeRgb(cor[0], cor[1], cor[2]);
  const tol = o.tol ?? 18, rc = (o.rCab ?? 0.55) * R;
  let nC = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  let nB = 0, bx = 0, by = 0;
  const x0 = Math.max(0, Math.floor(c[0] - R)), x1 = Math.min(W - 1, Math.ceil(c[0] + R));
  const y0 = Math.max(0, Math.floor(c[1] - R)), y1 = Math.min(H - 1, Math.ceil(c[1] + R));
  const mascara = o.mascara ? [] : null;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], rr = Math.hypot(dx, dy);
    if (rr > R) continue;
    const p = (y * W + x) * 4;
    const lab = labRapido(d[p], d[p + 1], d[p + 2]);
    if (deltaE2000(lab, lr) > tol) continue;
    if (mascara) mascara.push([x, y]);
    if (rr < rc * 0.95) { nC++; sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    else if (rr > rc * 1.08) { nB++; bx += dx; by += dy; }
  }
  const minPx = o.minPx ?? 12;
  if (nC < minPx || nB < minPx / 2) return { ok: false, motivo: nC < minPx ? 'tinta não achada na cabeça' : 'tinta não achada na base', nCab: nC, nBase: nB, mascara };
  const mx = sx / nC, my = sy / nC;
  const cxx = sxx / nC - mx * mx, cyy = syy / nC - my * my, cxy = sxy / nC - mx * my;
  const angCab = 0.5 * Math.atan2(2 * cxy, cxx - cyy);           // eixo (−90°, 90°]
  const alongamento = Math.sqrt(Math.max(1e-9, (cxx + cyy + Math.hypot(cxx - cyy, 2 * cxy)) / Math.max(1e-9, cxx + cyy - Math.hypot(cxx - cyy, 2 * cxy))));
  const angBase = Math.atan2(by / nB, bx / nB);
  const eixo = (a) => { let v = ((a % Math.PI) + Math.PI) % Math.PI; if (v > Math.PI / 2) v -= Math.PI; return v; };   // (−90°, 90°]
  let desvio;
  if (o.ref && fin(o.ref.cab) && fin(o.ref.base)) desvio = eixo((angCab - o.ref.cab) - (angBase - o.ref.base));
  else desvio = eixo(angCab - angBase);
  return { ok: true, desvio: Math.abs(desvio) * 180 / Math.PI, desvioSinal: desvio * 180 / Math.PI, angCab, angBase, nCab: nC, nBase: nB, alongamento, mascara };
}

// ------------------------------------------------------------------ 58 cor de chama / forno

/**
 * Cor média da região: média em RGB LINEAR dos pixels com luminância no
 * percentil ≥ pClaro (a chama/abertura do forno, não a moldura escura),
 * convertida para Lab (D65). `mascara(x,y)` opcional (polígono/elipse).
 * → { lab, rgb, Y, n, x, y (cromaticidade), cct }
 */
export function corRegiao(img, r, o = {}) {
  const W = img.width, d = img.data;
  const pClaro = o.pClaro ?? 0.5;
  const ys = [];
  const passo = Math.max(1, Math.floor(Math.sqrt((r.w * r.h) / 40000)));
  for (let y = r.y; y < r.y + r.h; y += passo) for (let x = r.x; x < r.x + r.w; x += passo) {
    if (o.mascara && !o.mascara(x + 0.5, y + 0.5)) continue;
    const p = (y * W + x) * 4;
    ys.push(yLin(d[p], d[p + 1], d[p + 2]));
  }
  if (!ys.length) return null;
  const ord = Float64Array.from(ys).sort();
  const lim = ord[Math.min(ord.length - 1, Math.floor(ord.length * pClaro))];
  let R = 0, G = 0, B = 0, n = 0;
  for (let y = r.y; y < r.y + r.h; y += passo) for (let x = r.x; x < r.x + r.w; x += passo) {
    if (o.mascara && !o.mascara(x + 0.5, y + 0.5)) continue;
    const p = (y * W + x) * 4;
    if (yLin(d[p], d[p + 1], d[p + 2]) < lim) continue;
    R += LIN[d[p]]; G += LIN[d[p + 1]]; B += LIN[d[p + 2]]; n++;
  }
  if (!n) return null;
  R /= n; G /= n; B /= n;
  const rgb = [Math.round(gama(R) * 255), Math.round(gama(G) * 255), Math.round(gama(B) * 255)];
  const lab = labLinear(R, G, B);
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const s = X + Y + Z;
  const cx = s ? X / s : NaN, cy = s ? Y / s : NaN;
  return { lab, rgb, Y, n, x: cx, y: cy, cct: cctMcCamy(cx, cy) };
}

/** Lab (D65) de RGB linear (0–1), sem quantizar. */
export function labLinear(R, G, B) {
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = (0.412453 * R + 0.35758 * G + 0.180423 * B) / 0.950456;
  const Y = 0.212671 * R + 0.71516 * G + 0.072169 * B;
  const Z = (0.019334 * R + 0.119193 * G + 0.950227 * B) / 1.088754;
  const fy = f(Y);
  return [Y > 0.008856 ? 116 * fy - 16 : 903.3 * Y, 500 * (f(X) - fy), 200 * (fy - f(Z))];
}

/** Temperatura de cor correlata (K) pela fórmula de McCamy (1992); válida ~2 000–12 500 K. */
export function cctMcCamy(x, y) {
  if (!fin(x) || !fin(y)) return NaN;
  const n = (x - 0.332) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}

// ------------------------------------------------------------------ 59 pontos de solda

/** Imagem integral (w+1)×(h+1) de um Float32Array w×h. */
export function integral(g, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) { s += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; }
  }
  return I;
}
const somaCaixa = (I, w, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];

/**
 * Resposta "mancha de raio r" em (x,y): média do quadrado interno (lado
 * ≈ 1,6r, cabe no disco) menos a média do anel quadrado entre 2,2r e 3r.
 * Positivo = mancha mais clara. Integral `I` de um recorte w×h.
 */
export function respostaMancha(I, w, h, x, y, r) {
  const a = Math.max(1, Math.round(0.8 * r)), b0 = Math.round(1.6 * r), b1 = Math.max(b0 + 1, Math.round(2.4 * r));
  const X = Math.round(x), Y = Math.round(y);
  if (X - b1 < 0 || Y - b1 < 0 || X + b1 + 1 > w || Y + b1 + 1 > h) return NaN;
  const sIn = somaCaixa(I, w, X - a, Y - a, X + a + 1, Y + a + 1), nIn = (2 * a + 1) ** 2;
  const sOut = somaCaixa(I, w, X - b1, Y - b1, X + b1 + 1, Y + b1 + 1) - somaCaixa(I, w, X - b0, Y - b0, X + b0 + 1, Y + b0 + 1);
  const nOut = (2 * b1 + 1) ** 2 - (2 * b0 + 1) ** 2;
  return sIn / nIn - sOut / nOut;
}

/**
 * Pontos de solda. `g` cinza do recorte w×h (origem ox, oy na imagem),
 * `posicoes` [{ id, x, y }] em px da imagem, r = raio nominal (px), busca =
 * raio de procura em torno da posição, contraste mínimo e polaridade
 * ('escuro' | 'claro' | 'auto'). Manchas fora das posições contam como
 * SOBRANDO (varredura em grade de passo r/2, supressão de não-máximos).
 * → { pos: [{ id, ok, x, y, erro (px), resp }], extras: [{x, y, resp}] }
 */
export function pontosSolda(g, w, h, ox, oy, posicoes, o = {}) {
  const r = Math.max(1.5, o.r ?? 6), busca = o.busca ?? 1.5 * r, cmin = o.contraste ?? 18, pol = o.polaridade || 'auto';
  const I = integral(g, w, h);
  const sinal = (v) => (pol === 'escuro' ? -v : pol === 'claro' ? v : Math.abs(v));
  const pos = [];
  for (const p of posicoes) {
    const px = p.x - ox - 0.5, py = p.y - oy - 0.5;   // em índice de pixel (centro do quadrado)
    let best = -Infinity, bx = px, by = py;
    const passo = Math.max(1, Math.round(r / 4));
    for (let y = py - busca; y <= py + busca; y += passo) for (let x = px - busca; x <= px + busca; x += passo) {
      if ((x - px) ** 2 + (y - py) ** 2 > busca * busca) continue;
      const v = sinal(respostaMancha(I, w, h, x, y, r));
      if (fin(v) && v > best) { best = v; bx = x; by = y; }
    }
    // refino fino (passo 1 px) e centroide ponderado 3×3
    let fb = best, fx = bx, fy = by;
    for (let y = Math.round(by) - passo; y <= Math.round(by) + passo; y++) for (let x = Math.round(bx) - passo; x <= Math.round(bx) + passo; x++) {
      const v = sinal(respostaMancha(I, w, h, x, y, r));
      if (fin(v) && v > fb) { fb = v; fx = x; fy = y; }
    }
    // subpixel: parábola em x e em y sobre a resposta em torno do máximo inteiro
    const R0 = sinal(respostaMancha(I, w, h, fx, fy, r));
    const par = (a, c) => { const den = a - 2 * R0 + c; return fin(a) && fin(c) && den < 0 ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0; };
    const sx = par(sinal(respostaMancha(I, w, h, fx - 1, fy, r)), sinal(respostaMancha(I, w, h, fx + 1, fy, r)));
    const sy = par(sinal(respostaMancha(I, w, h, fx, fy - 1, r)), sinal(respostaMancha(I, w, h, fx, fy + 1, r)));
    // o quadrado centrado no pixel X cobre [X − a, X + a + 1): o centro é X + 0,5
    fx += sx + 0.5; fy += sy + 0.5;
    const ok = fin(fb) && fb >= cmin;
    pos.push({ id: p.id, nome: p.nome, ok, x: fx + ox, y: fy + oy, erro: Math.hypot(fx - 0.5 - px, fy - 0.5 - py), resp: fb });
  }
  const extras = [];
  if (o.extras !== false) {
    const passo = Math.max(1, Math.round(r / 2));
    const cand = [];
    for (let y = 0; y < h; y += passo) for (let x = 0; x < w; x += passo) {
      const v = sinal(respostaMancha(I, w, h, x, y, r));
      if (fin(v) && v >= cmin) cand.push({ x, y, v });
    }
    cand.sort((a, b) => b.v - a.v);
    const aceitos = [];
    for (const c of cand) {
      if (aceitos.some((a) => (a.x - c.x) ** 2 + (a.y - c.y) ** 2 < (2.5 * r) ** 2)) continue;
      aceitos.push(c);
    }
    for (const a of aceitos) {
      const X = a.x + 0.5 + ox, Y = a.y + 0.5 + oy;
      // perto de uma posição nominal (ou do ponto achado nela) não é "sobrando"
      if (posicoes.some((q) => (q.x - X) ** 2 + (q.y - Y) ** 2 < (busca + r) ** 2)) continue;
      if (pos.some((p) => p.ok && (p.x - X) ** 2 + (p.y - Y) ** 2 < (2.5 * r) ** 2)) continue;
      extras.push({ x: X, y: Y, resp: a.v });
    }
  }
  return { pos, extras };
}

// ------------------------------------------------------------------ 61 opacidade de fumaça (Ringelmann)

/**
 * Opacidade da pluma por contraste com o céu, em luminância LINEAR:
 *   Y_pluma = T·Y_céu + (1 − T)·Y_fumaça   →   opacidade = 1 − T
 * Fumaça preta: Y_fumaça ≈ 0 (padrão). Ringelmann N = 5 × opacidade
 * (1 = 20 %, …, 5 = 100 %). Pluma mais clara que o céu = vapor ou fumaça
 * branca: a escala de Ringelmann (para fumaça escura) não se aplica.
 * yPluma e yCeu: medianas da luminância linear das áreas.
 */
export function opacidadeFumaca(yPluma, yCeu, yFumaca = 0) {
  if (!(yCeu > yFumaca + 1e-4)) return { valido: false, motivo: 'céu escuro demais para comparar' };
  if (yPluma > yCeu * 1.04) return { valido: false, clara: true, motivo: 'pluma mais clara que o céu (vapor ou fumaça branca): Ringelmann não se aplica' };
  const T = clamp((yPluma - yFumaca) / (yCeu - yFumaca), 0, 1);
  const op = 1 - T;
  return { valido: true, opacidade: op, ringelmann: 5 * op };
}

/** Mediana da luminância linear de um recorte (com máscara opcional). */
export function yMediana(img, r, mascara = null) {
  const W = img.width, d = img.data, v = [];
  const passo = Math.max(1, Math.floor(Math.sqrt((r.w * r.h) / 20000)));
  for (let y = r.y; y < r.y + r.h; y += passo) for (let x = r.x; x < r.x + r.w; x += passo) {
    if (mascara && !mascara(x + 0.5, y + 0.5)) continue;
    const p = (y * W + x) * 4;
    v.push(yLin(d[p], d[p + 1], d[p + 2]));
  }
  return mediana(v);
}

// ------------------------------------------------------------------ C2 fissuras

/** Média em caixa (2r+1)² por imagem integral (borda: só os pixels dentro). */
export function mediaCaixa(g, w, h, r) {
  const I = integral(g, w, h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      o[y * w + x] = somaCaixa(I, w, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
    }
  }
  return o;
}

/** Afinamento de Zhang-Suen (no lugar) de uma máscara 0/1. */
export function esqueleto(m, w, h) {
  const apagar = [];
  let mudou = true;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? m[y * w + x] : 0);
  while (mudou) {
    mudou = false;
    for (let passo = 0; passo < 2; passo++) {
      apagar.length = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
        if (A !== 1) continue;
        if (passo === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        apagar.push(y * w + x);
      }
      if (apagar.length) { mudou = true; for (const i of apagar) m[i] = 0; }
    }
  }
  return m;
}

const ANEL = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
/** Tira do esqueleto as quinas de escada que não ligam nada (no lugar). */
export function podarQuinas(sk, w, h) {
  let mudou = true;
  const viz = [];
  while (mudou) {
    mudou = false;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!sk[i]) continue;
      const N = sk[i - w], S = sk[i + w], E = sk[i + 1], O = sk[i - 1];
      if (!((N && E) || (E && S) || (S && O) || (O && N))) continue;
      viz.length = 0;
      for (const [dx, dy] of ANEL) if (sk[i + dy * w + dx]) viz.push([dx, dy]);
      if (viz.length < 2) continue;
      // grupos 8-conexos entre os vizinhos (sem o centro)
      const grupo = viz.map((_, k) => k);
      const raiz = (k) => { while (grupo[k] !== k) k = grupo[k]; return k; };
      for (let a = 0; a < viz.length; a++) for (let b = a + 1; b < viz.length; b++) {
        if (Math.abs(viz[a][0] - viz[b][0]) <= 1 && Math.abs(viz[a][1] - viz[b][1]) <= 1) grupo[raiz(a)] = raiz(b);
      }
      let n = 0;
      for (let k = 0; k < viz.length; k++) if (raiz(k) === k) n++;
      if (n === 1) { sk[i] = 0; mudou = true; }
    }
  }
  return sk;
}

/** Amostragem bilinear de um Float32Array w×h (borda presa). */
function bil(g, w, h, x, y) {
  x = clamp(x, 0, w - 1.001); y = clamp(y, 0, h - 1.001);
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = y0 * w + x0;
  return (1 - fy) * ((1 - fx) * g[i] + fx * g[i + 1]) + fy * ((1 - fx) * g[i + w] + fx * g[i + w + 1]);
}

/**
 * Fissuras escuras num recorte em cinza `g` (w×h).
 *   o.raioFundo   raio da média larga que estima o fundo (px; > 3× a fissura mais larga)
 *   o.kAlto/kBaixo  limiares de histerese em múltiplos do ruído (MAD do contraste)
 *   o.areaMin     componentes menores são descartados (px)
 *   o.alongMin    comprimento do esqueleto ÷ √área mínimo (fissura é alongada)
 *   o.escuroCheio contraste de uma fissura "cheia" (larga) — 0 = automático
 * Largura: no perfil normal ao eixo, área do vale ÷ contraste cheio (vale
 * para fissura estreita borrada, abaixo de 1 px) e, quando o vale é largo e
 * chato, a largura a meia altura; a maior das duas não passa da outra + 1 px.
 * → { fissuras: [{ id, comprimento, larguraMax, larguraMedia, larguraP95, pontos: [{x,y,l}] }],
 *     comprimento, larguraMax, ruido, escuroCheio, mascara? }
 */
export function medirFissuras(g, w, h, o = {}) {
  const rf = o.raioFundo ?? 12;
  const bg = mediaCaixa(g, w, h, rf);
  const N = w * h, D = new Float32Array(N);
  for (let i = 0; i < N; i++) D[i] = Math.max(0, bg[i] - g[i]);
  // 2ª passada do fundo SEM os pixels escuros (a própria fissura puxava a média para baixo)
  {
    let s = 0, n = 0;
    for (let i = 0; i < N; i += 7) { s += Math.abs(bg[i] - g[i]); n++; }
    const corte = 3 * (s / Math.max(1, n)) + 2;
    const val = new Float32Array(N), ok = new Float32Array(N);
    for (let i = 0; i < N; i++) if (D[i] <= corte) { val[i] = g[i]; ok[i] = 1; }
    const Iv = integral(val, w, h), Io = integral(ok, w, h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - rf), y1 = Math.min(h, y + rf + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rf), x1 = Math.min(w, x + rf + 1);
        const c = somaCaixa(Io, w, x0, y0, x1, y1);
        if (c > 0) bg[y * w + x] = somaCaixa(Iv, w, x0, y0, x1, y1) / c;
      }
    }
    for (let i = 0; i < N; i++) D[i] = Math.max(0, bg[i] - g[i]);
  }
  // ruído: MAD do contraste com sinal (as fissuras são poucas: não pesam na mediana)
  const amostra = [];
  const st = Math.max(1, Math.floor(N / 40000));
  for (let i = 0; i < N; i += st) amostra.push(bg[i] - g[i]);
  amostra.sort((a, b) => a - b);
  const med = amostra[amostra.length >> 1];
  const dev = amostra.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const ruido = Math.max(0.5, 1.4826 * dev[dev.length >> 1]);
  const tA = (o.kAlto ?? 5) * ruido, tB = (o.kBaixo ?? 2.5) * ruido;
  // histerese
  const m = new Uint8Array(N), fila = new Int32Array(N);
  let b = 0;
  for (let i = 0; i < N; i++) if (D[i] > tA) { m[i] = 1; fila[b++] = i; }
  for (let a = 0; a < b; a++) {
    const i = fila[a], x = i % w, y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!m[j] && D[j] > tB) { m[j] = 1; fila[b++] = j; }
    }
  }
  // componentes: área e alongamento
  const lab = new Int32Array(N), comps = [];
  let k = 0;
  for (let s = 0; s < N; s++) {
    if (!m[s] || lab[s]) continue;
    k++; let a = 0, bb = 0;
    lab[s] = k; fila[bb++] = s;
    while (a < bb) {
      const i = fila[a++], x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (m[j] && !lab[j]) { lab[j] = k; fila[bb++] = j; }
      }
    }
    comps.push({ k, area: bb });
  }
  const areaMin = o.areaMin ?? 30;
  const valido = new Uint8Array(k + 1);
  for (const c of comps) if (c.area >= areaMin) valido[c.k] = 1;
  const sk = new Uint8Array(N);
  for (let i = 0; i < N; i++) sk[i] = m[i] && valido[lab[i]] ? 1 : 0;
  esqueleto(sk, w, h);
  // quinas redundantes (escada 4-conexa que o Zhang-Suen deixa): o pixel com
  // vizinhos ortogonais em L sai do esqueleto quando os vizinhos continuam
  // ligados entre si sem ele (um só grupo 8-conexo no anel 3×3)
  podarQuinas(sk, w, h);
  // comprimento: cada pixel do esqueleto vale 1/max(|cos θ|, |sen θ|) na direção
  // local θ (PCA dos vizinhos num raio de 3 px) — uma reta digital tem um pixel
  // por coluna (ou linha) do eixo maior, em qualquer ângulo
  const comp = new Float64Array(k + 1), pts = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!sk[i]) continue;
    const c = lab[i];
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, q = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || !sk[yy * w + xx] || dx * dx + dy * dy > 9) continue;
      sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; q++;
    }
    let passo = 1;
    if (q >= 3) {
      const mx = sx / q, my = sy / q, th = 0.5 * Math.atan2(2 * (sxy / q - mx * my), (sxx / q - mx * mx) - (syy / q - my * my));
      passo = 1 / Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
    }
    comp[c] += passo;
    if (!pts.has(c)) pts.set(c, []);
    pts.get(c).push([x, y]);
  }
  const alongMin = o.alongMin ?? 3;
  const fiss = [];
  for (const c of comps) {
    if (!valido[c.k] || !pts.has(c.k)) continue;
    const L = comp[c.k];
    if (L / Math.sqrt(c.area) < alongMin && L < 4 * Math.sqrt(c.area)) continue;
    fiss.push({ k: c.k, comprimento: L, esq: pts.get(c.k) });
  }
  // contraste "cheio": automático = percentil 90 do pico do vale nos trechos largos
  const passoAm = o.passo ?? 2, meiaJan = o.janela ?? 12;
  const perfis = [];
  for (const f of fiss) {
    const E = f.esq, set = new Set(E.map(([x, y]) => y * w + x));
    f.pontos = [];
    for (let n = 0; n < E.length; n += passoAm) {
      const [x, y] = E[n];
      // direção local: PCA dos pontos do esqueleto num raio de 4 px
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, q = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dy * dy > 16) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !set.has(yy * w + xx)) continue;
        sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; q++;
      }
      if (q < 3) continue;
      const mx = sx / q, my = sy / q, cxx = sxx / q - mx * mx, cyy = syy / q - my * my, cxy = sxy / q - mx * my;
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      const nx = -Math.sin(th), ny = Math.cos(th);
      // perfil normal (passo 0,25 px), centrado no mínimo local
      const S = [];
      for (let s = -meiaJan; s <= meiaJan; s += 0.25) S.push(bil(D, w, h, x + nx * s, y + ny * s));
      const c0 = S.length >> 1;
      let pk = c0;
      for (let j = c0 - 8; j <= c0 + 8; j++) if (S[j] > S[pk]) pk = j;
      const pico = S[pk];
      if (!(pico > tB)) continue;
      // desce até o contraste cair abaixo de 10% do pico (ou subir de novo)
      let e = pk, d2 = pk;
      while (e > 0 && S[e - 1] > pico * 0.1 && S[e - 1] <= S[e] + ruido) e--;
      while (d2 < S.length - 1 && S[d2 + 1] > pico * 0.1 && S[d2 + 1] <= S[d2] + ruido) d2++;
      let area = 0;
      for (let j = e; j <= d2; j++) area += S[j] * 0.25;
      // meia altura
      let me = pk, md = pk;
      while (me > e && S[me] > pico / 2) me--;
      while (md < d2 && S[md] > pico / 2) md++;
      const interp = (j0, j1) => { const a = S[j0], bv = S[j1]; return a === bv ? 0 : (pico / 2 - a) / (bv - a); };
      const fwhm = ((md - me) - interp(me, me + 1) - (1 - interp(md - 1, md))) * 0.25;
      perfis.push({ f, x, y, area, pico, fwhm });
    }
  }
  let cheio = o.escuroCheio || 0;
  if (!cheio) {
    const largos = perfis.filter((p) => p.fwhm >= 3).map((p) => p.pico).sort((a, b) => a - b);
    const todos = perfis.map((p) => p.pico).sort((a, b) => a - b);
    cheio = largos.length >= 5 ? largos[Math.floor(largos.length * 0.5)] : todos.length ? todos[Math.floor(todos.length * 0.98)] : 0;
  }
  for (const p of perfis) {
    const lInt = cheio > 0 ? p.area / cheio : p.fwhm;
    // vale chato e largo (pico ≈ cheio): FWHM é a medida direta; estreito: área ÷ cheio
    const l = p.pico >= 0.9 * cheio && p.fwhm >= 2 ? Math.min(p.fwhm, lInt + 1) : lInt;
    p.f.pontos.push({ x: p.x, y: p.y, l });
  }
  // mediana espacial (raio 5 px): um perfil isolado ruim (bifurcação, poro) não vira a abertura máxima
  for (const f of fiss) {
    const P = f.pontos, grade = new Map(), cel = (x, y) => `${Math.floor(x / 5)},${Math.floor(y / 5)}`;
    for (const q of P) { const k = cel(q.x, q.y); if (!grade.has(k)) grade.set(k, []); grade.get(k).push(q); }
    const novos = P.map((q) => {
      const v = [];
      const cx = Math.floor(q.x / 5), cy = Math.floor(q.y / 5);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) for (const r of grade.get(`${cx + i},${cy + j}`) || []) if ((r.x - q.x) ** 2 + (r.y - q.y) ** 2 <= 25) v.push(r.l);
      v.sort((a, b) => a - b);
      return v[v.length >> 1];
    });
    P.forEach((q, i) => { q.l = novos[i]; });
  }
  const out = [];
  let id = 1;
  for (const f of fiss) {
    if (!f.pontos.length) continue;
    const ls = f.pontos.map((p) => p.l).sort((a, b) => a - b);
    out.push({ id: id++, comprimento: f.comprimento, larguraMax: ls[ls.length - 1], larguraMedia: ls.reduce((a, v) => a + v, 0) / ls.length,
               larguraP95: ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.95))], pontos: f.pontos });
  }
  out.sort((a, b) => b.comprimento - a.comprimento);
  return { fissuras: out, comprimento: out.reduce((a, f) => a + f.comprimento, 0), larguraMax: out.reduce((a, f) => Math.max(a, f.larguraMax), 0),
           ruido, escuroCheio: cheio };
}

/**
 * Classe da abertura (mm) na nomenclatura usual de patologia de edificações
 * no Brasil (capilar < 0,2; fissura ≤ 0,5; trinca ≤ 1,5; rachadura ≤ 5; fenda > 5).
 */
export function classeAbertura(mm) {
  if (!fin(mm)) return '—';
  if (mm < 0.2) return 'capilar';
  if (mm <= 0.5) return 'fissura';
  if (mm <= 1.5) return 'trinca';
  if (mm <= 5) return 'rachadura';
  return 'fenda';
}
export const COR_ABERTURA = { capilar: '#4ade80', fissura: '#FFD84D', trinca: '#fb923c', rachadura: '#f87171', fenda: '#e11d48', '—': '#94a3b8' };
