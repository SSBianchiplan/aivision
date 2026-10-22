/**
 * cv/runtime/livres-r/medidas.js — medidas geométricas da onda 2-a, sem DOM
 * (testável no Node):
 *
 *   perfilCaixa       um quadro do perfil laser (linha por coluna, do Extrator
 *                     do BeltScan) contra a referência da correia vazia →
 *                     alturas por coluna pela MESMA triangulação do BeltScan
 *                     (zDeV/xDeUV) e o trecho mais largo acima da altura
 *                     mínima: largura (mm) e altura (mm) da caixa nesse quadro
 *   SeparadorCaixas   caixa a caixa ao longo do tempo: início/fim pela borda
 *                     (meio entre o último quadro sem e o primeiro com caixa),
 *                     comprimento = velocidade × tempo, altura e largura pela
 *                     mediana dos quadros centrais
 *   retanguloDePontos menor retângulo girado de uma nuvem de pontos (px)
 *   ocupacaoBau       ocupação do baú pela profundidade relativa (Depth Anything:
 *                     disparidade afim) + razão de tamanho porta/fundo
 */
import { zDeV, xDeUV, desgirar } from '../livres-k/beltscan.js';

const fin = Number.isFinite;

function mediana(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function percentil(a, p) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const k = Math.min(s.length - 1, Math.max(0, (s.length - 1) * p));
  const i = Math.floor(k), f = k - i;
  return i + 1 < s.length ? s[i] * (1 - f) + s[i + 1] * f : s[i];
}
export { mediana, percentil };

// ------------------------------------------------------------------ cubagem na esteira (L1)

/**
 * Referência da correia vazia: mediana, por coluna, das linhas de N quadros.
 * `quadros` = lista de Float32Array (NaN onde não há linha).
 */
export function referenciaLaser(quadros) {
  const W = quadros[0].length, ref = new Float32Array(W).fill(NaN);
  const tmp = [];
  for (let u = 0; u < W; u++) {
    tmp.length = 0;
    for (const q of quadros) if (fin(q[u])) tmp.push(q[u]);
    if (tmp.length >= Math.max(2, quadros.length * 0.5)) ref[u] = mediana(tmp);
  }
  return ref;
}

/**
 * Um quadro: alturas sobre a correia e o trecho da caixa.
 *   rows, ref  Float32Array(W) (linhas do laser; NaN = sem linha)
 *   G          geometria do BeltScan (geometria(geo, W, H))
 *   o          { hMin (mm), lacuna (colunas sem linha toleradas), largMin (mm), x0, x1 (colunas) }
 * → { h: Float32Array, x: Float32Array, caixa: null | { u0, u1, larg, alt, altMax, cobertura } }
 */
export function perfilCaixa(rows, ref, G, o = {}) {
  const W = rows.length;
  const hMin = o.hMin ?? 15, lac = o.lacuna ?? 4, largMin = o.largMin ?? 40;
  const x0 = Math.max(0, o.x0 ?? 0), x1 = Math.min(W, o.x1 ?? W);
  const h = o.h && o.h.length === W ? o.h : new Float32Array(W);
  const x = o.x && o.x.length === W ? o.x : new Float32Array(W);
  // x no TOPO medido (a escala transversal muda com a altura: o topo está mais perto da câmera)
  const xt = o.xt && o.xt.length === W ? o.xt : new Float32Array(W);
  for (let u = 0; u < W; u++) {
    const r = ref[u];
    if (!fin(r) || u < x0 || u >= x1) { h[u] = NaN; x[u] = NaN; xt[u] = NaN; continue; }
    const vr = desgirar(G, u, r);
    x[u] = xDeUV(G, u, vr);
    const v = rows[u];
    if (fin(v)) { const vv = desgirar(G, u, v); h[u] = zDeV(G, vv) - zDeV(G, vr); xt[u] = xDeUV(G, u, vv); }
    else { h[u] = NaN; xt[u] = NaN; }
  }
  // trechos acima de hMin (lacunas curtas de coluna sem linha não quebram o trecho)
  let melhor = null, ini = -1, ultimo = -1, buraco = 0;
  const fechar = () => {
    if (ini < 0) return;
    const larg = Math.abs(xt[ultimo] - xt[ini]);
    if (!melhor || larg > melhor.larg) melhor = { u0: ini, u1: ultimo, larg };
    ini = -1;
  };
  for (let u = x0; u < x1; u++) {
    const v = h[u];
    if (fin(v) && v >= hMin) { if (ini < 0) ini = u; ultimo = u; buraco = 0; }
    else if (ini >= 0 && (!fin(v) ? ++buraco > lac : true)) fechar();
  }
  fechar();
  if (!melhor) return { h, x, xt, caixa: null };
  // meia coluna de cada lado: a borda real fica entre a última coluna dentro e a primeira fora
  const passo = (u) => { const v = desgirar(G, u, rows[u]); return Math.abs(xDeUV(G, u + 0.5, v) - xDeUV(G, u - 0.5, v)) || 0; };
  const larg = melhor.larg + (passo(melhor.u0) + passo(melhor.u1)) / 2;
  if (larg < largMin) return { h, x, xt, caixa: null };
  const n = melhor.u1 - melhor.u0 + 1, m0 = melhor.u0 + Math.floor(n * 0.2), m1 = melhor.u1 - Math.floor(n * 0.2);
  const hs = [], todos = [];
  let validas = 0;
  for (let u = melhor.u0; u <= melhor.u1; u++) {
    if (!fin(h[u])) continue;
    validas++; todos.push(h[u]);
    if (u >= m0 && u <= m1) hs.push(h[u]);
  }
  return { h, x, xt, caixa: { u0: melhor.u0, u1: melhor.u1, larg, alt: mediana(hs.length ? hs : todos), altMax: percentil(todos, 0.95), cobertura: validas / n } };
}

/**
 * Caixa a caixa. passo(t, caixaDoQuadro|null, extra) devolve a caixa
 * FECHADA (ou null). A caixa abre com `confirma` quadros seguidos com
 * perfil e fecha com `confirma` quadros seguidos sem.
 *   o { velocidade (mm/s), confirma (2), fator (kg/m³ do peso cubado) }
 *   extra { codigo, vista: { comp, larg, nota } } — o melhor código/vista do período
 */
export class SeparadorCaixas {
  constructor(o = {}) { this.o = { velocidade: 300, confirma: 2, fator: 300, ...o }; this.zerar(); }
  zerar() { this.aberta = null; this.tSem = null; this.tCom = null; this.seqCom = 0; this.seqSem = 0; this.caixas = []; this.n = 0; this.pend = []; this.tUltSem = null; this.tUltCom = null; }

  passo(t, cx, extra = {}) {
    if (cx) {
      this.seqCom++; this.seqSem = 0;
      if (!this.aberta) {
        this.pend.push({ t, larg: cx.larg, alt: cx.alt, altMax: cx.altMax });
        if (this.seqCom === 1) this.tPrimCom = t;
        if (this.seqCom >= this.o.confirma) {
          const t0 = this.tUltSem != null ? (this.tUltSem + this.tPrimCom) / 2 : this.tPrimCom;
          this.aberta = { t0, quadros: this.pend.slice(), codigo: null, vista: null };
          this.pend = [];
        }
      } else this.aberta.quadros.push({ t, larg: cx.larg, alt: cx.alt, altMax: cx.altMax });
      if (this.aberta) {
        if (extra.codigo) this.aberta.codigo = extra.codigo;
        if (extra.vista && (!this.aberta.vista || extra.vista.nota > this.aberta.vista.nota)) this.aberta.vista = extra.vista;
      }
      this.tUltCom = t;
      return null;
    }
    this.seqSem++; this.seqCom = 0; this.pend = [];
    if (!this.aberta) { this.tUltSem = t; return null; }
    if (this.seqSem === 1) this.tPrimSem = t;
    if (this.seqSem < this.o.confirma) return null;
    const A = this.aberta;
    this.aberta = null;
    this.tUltSem = t;
    const t1 = (this.tUltCom + this.tPrimSem) / 2;
    const Q = A.quadros, n = Q.length;
    const c0 = Math.floor(n * 0.2), c1 = Math.max(c0 + 1, n - Math.floor(n * 0.2));
    const meio = Q.slice(c0, c1);
    const altura = mediana(meio.map((q) => q.alt)), largLaser = mediana(meio.map((q) => q.larg));
    const compVel = this.o.velocidade * (t1 - A.t0);
    const comp = A.vista && fin(A.vista.comp) ? A.vista.comp : compVel;
    const larg = A.vista && fin(A.vista.larg) ? A.vista.larg : largLaser;
    const vol = (altura * larg * comp) / 1e9;    // m³
    const caixa = {
      n: ++this.n, t0: A.t0, t1, quadros: n, altura, largura: larg, comprimento: comp, largLaser, compVel,
      fonteComp: A.vista && fin(A.vista.comp) ? 'vista' : 'velocidade', volume: vol, pesoCubado: vol * this.o.fator,
      altMax: percentil(Q.map((q) => q.altMax), 0.9), codigo: A.codigo,
    };
    this.caixas.push(caixa);
    if (this.caixas.length > 5000) this.caixas.shift();
    return caixa;
  }
}

// ------------------------------------------------------------------ retângulo mínimo (cubagem por foto, vista)

/** Casco convexo (cadeia monótona) de [[x,y]…]. */
export function casco(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

/**
 * Menor retângulo girado (rotating calipers): { comp ≥ larg, angulo (graus
 * do lado maior), cantos [[x,y]×4], area }.
 */
export function retanguloDePontos(pts) {
  const c = casco(pts);
  if (c.length < 3) return null;
  let best = null;
  for (let i = 0; i < c.length; i++) {
    const a = c[i], b = c[(i + 1) % c.length];
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey);
    if (!L) continue;
    ex /= L; ey /= L;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of c) {
      const u = q[0] * ex + q[1] * ey, v = -q[0] * ey + q[1] * ex;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const A = (u1 - u0) * (v1 - v0);
    if (!best || A < best.area) best = { area: A, ex, ey, u0, u1, v0, v1 };
  }
  const { ex, ey, u0, u1, v0, v1 } = best;
  const P = (u, v) => [u * ex - v * ey, u * ey + v * ex];
  const du = u1 - u0, dv = v1 - v0;
  const ang = du >= dv ? Math.atan2(ey, ex) : Math.atan2(ex, -ey);
  return { comp: Math.max(du, dv), larg: Math.min(du, dv), angulo: ((ang * 180) / Math.PI + 360) % 180, area: best.area,
           cantos: [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)] };
}

/**
 * Silhueta de um objeto contra um fundo aprendido (vista de cima da
 * esteira, L1): pixels com |cinza − fundo| > limiar dentro da caixa
 * `roi` {x,y,w,h} → maior componente 8-conexo → retângulo mínimo em px.
 * `cinza` e `fundo` Float32Array do tamanho do recorte. `nota` alta quando
 * o objeto está inteiro e longe das bordas do recorte.
 */
export function silhueta(cinza, fundo, w, h, limiar = 25, areaMin = 80) {
  const N = w * h, m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = Math.abs(cinza[i] - fundo[i]) > limiar ? 1 : 0;
  // abertura 3×3 simples (tira ruído de 1 px)
  const e = new Uint8Array(N);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    e[i] = m[i] & m[i - 1] & m[i + 1] & m[i - w] & m[i + w];
  }
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    m[i] = e[i] | e[i - 1] | e[i + 1] | e[i - w] | e[i + w];
  }
  const lab = new Int32Array(N), fila = new Int32Array(N);
  let melhor = null, k = 0;
  for (let s = 0; s < N; s++) {
    if (!m[s] || lab[s]) continue;
    k++;
    let a = 0, b = 0, toca = false;
    lab[s] = k; fila[b++] = s;
    const borda = [];
    while (a < b) {
      const i = fila[a++], x = i % w, y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) toca = true;
      let ehBorda = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) { ehBorda = true; continue; }
        const j = yy * w + xx;
        if (!m[j]) { ehBorda = true; continue; }
        if (!lab[j]) { lab[j] = k; fila[b++] = j; }
      }
      if (ehBorda) borda.push([x + 0.5, y + 0.5]);
    }
    if (b >= areaMin && (!melhor || b > melhor.area)) melhor = { area: b, toca, borda };
  }
  if (!melhor) return null;
  // o contorno de pixels inteiros: os cantos externos ficam meio pixel para fora
  const pts = [];
  for (const [x, y] of melhor.borda) pts.push([x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]);
  const r = retanguloDePontos(pts);
  if (!r) return null;
  return { ...r, areaPx: melhor.area, toca: melhor.toca };
}

// ------------------------------------------------------------------ ocupação do baú (64)

/**
 * Ocupação do baú pela profundidade RELATIVA.
 *
 * O Depth Anything V2 dá disparidade afim: d = a/z + b com a, b
 * desconhecidos. Dois planos de referência resolvem a e b:
 *   – a PORTA (z = 1): mediana de d na faixa logo para dentro da moldura
 *     marcada (paredes, piso e teto junto da porta);
 *   – o FUNDO (z = k): k = z_fundo/z_porta sai da razão de tamanhos dos dois
 *     retângulos marcados (câmera pinhole: tamanho aparente ∝ 1/z); d do
 *     fundo vem da referência do baú VAZIO, ou — sem ela — do percentil 5
 *     da área do fundo (supõe que alguma fresta mostra a parede).
 * Cada pixel do retângulo do fundo é um raio que, no baú vazio, chegaria à
 * parede do fundo; a carga o interrompe em z → enchimento (k − z)/(k − 1).
 * Ocupação = média dos raios. É ESTIMATIVA: supõe carga encostada no fundo
 * e a câmera no eixo do baú.
 *
 *   dep { data, w, h }   porta, fundo {x1,y1,x2,y2} (0–1)   dVazio = d do fundo vazio | null
 *   → { ocupacao (0–1), k, dPorta, dFundo, grade: [{x,y,f}], semRef }
 */
export function ocupacaoBau(dep, porta, fundo, dVazio = null, o = {}) {
  const { data, w, h } = dep;
  const amostra = (x, y) => {
    const xx = Math.min(w - 1, Math.max(0, x * w - 0.5)), yy = Math.min(h - 1, Math.max(0, y * h - 0.5));
    const x0 = Math.floor(xx), y0 = Math.floor(yy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = xx - x0, fy = yy - y0;
    return (1 - fy) * ((1 - fx) * data[y0 * w + x0] + fx * data[y0 * w + x1]) + fy * ((1 - fx) * data[y1 * w + x0] + fx * data[y1 * w + x1]);
  };
  const wp = porta.x2 - porta.x1, hp = porta.y2 - porta.y1, wf = fundo.x2 - fundo.x1, hf = fundo.y2 - fundo.y1;
  if (!(wp > 0 && hp > 0 && wf > 0 && hf > 0)) return null;
  const k = Math.sqrt((wp * hp) / (wf * hf));
  if (!(k > 1.05)) return { erro: 'o retângulo do fundo precisa ser menor que o da porta (perspectiva)' };
  // anel da porta: entre a moldura (s = 0) e 12% do caminho até o fundo
  const anel = [];
  const N = o.amostras ?? 24;
  for (let s = 0.02; s <= 0.12; s += 0.05) {
    const L = (a, b) => a + (b - a) * s;
    const R = { x1: L(porta.x1, fundo.x1), y1: L(porta.y1, fundo.y1), x2: L(porta.x2, fundo.x2), y2: L(porta.y2, fundo.y2) };
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N;
      anel.push(amostra(R.x1 + (R.x2 - R.x1) * f, R.y1), amostra(R.x1 + (R.x2 - R.x1) * f, R.y2),
                amostra(R.x1, R.y1 + (R.y2 - R.y1) * f), amostra(R.x2, R.y1 + (R.y2 - R.y1) * f));
    }
  }
  const dPorta = mediana(anel);
  const G = o.grade ?? 24;
  const ds = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) ds.push(amostra(fundo.x1 + wf * (i + 0.5) / G, fundo.y1 + hf * (j + 0.5) / G));
  const semRef = !(Number.isFinite(dVazio));
  const dFundo = semRef ? percentil(ds, 0.05) : dVazio;
  if (!(dPorta > dFundo)) return { erro: 'a porta não está mais perto que o fundo na profundidade (confira as marcações)', k, dPorta, dFundo };
  const a = (dPorta - dFundo) / (1 - 1 / k), b = dPorta - a;
  let soma = 0;
  const grade = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const d = ds[j * G + i];
    let z = d - b > 1e-9 ? a / (d - b) : k;
    z = Math.min(k, Math.max(1, z));
    const f = (k - z) / (k - 1);
    soma += f;
    grade.push({ x: fundo.x1 + wf * (i + 0.5) / G, y: fundo.y1 + hf * (j + 0.5) / G, f });
  }
  return { ocupacao: soma / (G * G), k, dPorta, dFundo, grade, G, semRef };
}
