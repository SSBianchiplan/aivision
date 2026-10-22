/**
 * cv/marcacoes-analise.js — o que as ferramentas de mouse "inteligentes" e de
 * análise calculam sobre os PIXELS da fonte (não sobre o canvas de exibição,
 * que tem os desenhos por cima):
 *
 *   histogramaDe(it)       histograma RGB / HSV / cinza, média e desvio dentro da forma (Fiji: Histogram)
 *   perfilDe(it)           intensidade ao longo de uma linha/polilinha (Fiji: Plot Profile)
 *   varinha(p, opc)        região de cor parecida a partir do clique (Photoshop: varinha mágica,
 *                          tolerância 0–255 por canal, contígua ou não) → polígono ou máscara
 *   segmentarSam(pontos)   MobileSAM com pontos positivos/negativos (CVAT/Roboflow: clique → máscara
 *                          → polígono), pela fila do runtime ONNX (cv/runtime/onnx.js)
 *   encaixarBorda(p)       leva o ponto ao gradiente mais forte por perto (Sobel)
 *   passoTrajetorias()     segue os pontos das trajetórias a cada quadro novo, por correlação
 *                          normalizada (ZNCC) de um modelo 17×17 (Kinovea: trajetória)
 *
 * Coordenadas: tudo entra e sai em 0–1 da FONTE inteira (o espaço das
 * marcações, cv/marcacoes.js). A leitura desfaz o espelho do quadro gravado
 * (vista.fs), como o conta-gotas e projeto/captura.js.
 */

import {
  vista, marcStore, mascaraBits, caixaItem, editarSemHistorico, tempoAgora, MAX_RASTRO, codificarMascara, rt,
} from './marcacoes.js';
import { MODELS, loadModel, isReady, runFeeds, ensureOrt, modelStates } from './runtime/onnx.js';

// ------------------------------------------------------------- leitura da fonte

let tela = null;

/**
 * Região da fonte (px da fonte, X0,Y0,w,h) como ImageData, reduzida por `k`
 * (k ≤ 1). Fora da imagem vem transparente. null se a fonte não deixa ler
 * (vídeo de outra origem) ou não há fonte.
 */
export function lerRegiao(X0, Y0, w, h, k = 1, fonte = null) {
  const el = fonte || vista.el;
  if (!el || !vista.ok) return null;
  const ow = Math.max(1, Math.round(w * k)), oh = Math.max(1, Math.round(h * k));
  if (!tela) tela = document.createElement('canvas');
  tela.width = ow; tela.height = oh;
  const g = tela.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, ow, oh);
  try {
    g.save();
    if (vista.fs) {
      // o elemento já está espelhado: lê o trecho espelhado e desvira
      g.translate(ow, 0); g.scale(-1, 1);
      g.drawImage(el, vista.W - X0 - w, Y0, w, h, 0, 0, ow, oh);
    } else g.drawImage(el, X0, Y0, w, h, 0, 0, ow, oh);
    g.restore();
    return g.getImageData(0, 0, ow, oh);
  } catch (_) { g.restore(); return null; }
}

/** Ponto (0–1 da fonte) dentro da marcação de área, no espaço da fonte. */
export function dentroFonte(it, u, v) {
  const p = it.pts;
  if (it.tipo === 'retangulo') {
    return u >= Math.min(p[0][0], p[1][0]) && u <= Math.max(p[0][0], p[1][0]) && v >= Math.min(p[0][1], p[1][1]) && v <= Math.max(p[0][1], p[1][1]);
  }
  if (it.tipo === 'elipse') {
    const cx = (p[0][0] + p[1][0]) / 2, cy = (p[0][1] + p[1][1]) / 2;
    const rx = Math.abs(p[1][0] - p[0][0]) / 2, ry = Math.abs(p[1][1] - p[0][1]) / 2;
    if (!rx || !ry) return false;
    const dx = (u - cx) / rx, dy = (v - cy) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (it.tipo === 'mascara') {
    const m = it.mask, b = mascaraBits(m);
    const fx = (u - p[0][0]) / (p[1][0] - p[0][0] || 1e-9), fy = (v - p[0][1]) / (p[1][1] - p[0][1] || 1e-9);
    if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) return false;
    return b[Math.floor(fy * m.h) * m.w + Math.floor(fx * m.w)] === 1;
  }
  if (it.tipo === 'poligono') {
    let d = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > v) !== (p[j][1] > v) && u < ((p[j][0] - p[i][0]) * (v - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) d = !d;
    }
    return d;
  }
  return false;
}

// ------------------------------------------------------------- histograma

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  return [h, mx ? (d / mx) * 255 : 0, mx];
}

/**
 * Histograma da área (até ~260 mil pixels lidos; acima disso a região é
 * reduzida). { n, canais: { r,g,b,cinza,h,s,v: { hist: Uint32Array(256), media, desvio, min, max } }, k }
 * O matiz vai em 256 caixas de 360/256°; média/desvio do matiz em graus (média circular).
 */
export function histogramaDe(it) {
  const W = vista.W, H = vista.H;
  const c = caixaItem(it);
  const X0 = Math.floor(c.x1 * W), Y0 = Math.floor(c.y1 * H);
  const w = Math.max(1, Math.ceil(c.x2 * W) - X0), h = Math.max(1, Math.ceil(c.y2 * H) - Y0);
  const k = Math.min(1, Math.sqrt(260000 / (w * h)));
  const im = lerRegiao(X0, Y0, w, h, k);
  if (!im) return null;
  const nomes = ['r', 'g', 'b', 'cinza', 'h', 's', 'v'];
  const hist = nomes.map(() => new Uint32Array(256));
  const soma = new Float64Array(7), soma2 = new Float64Array(7), mn = new Float64Array(7).fill(1e9), mx = new Float64Array(7).fill(-1e9);
  let n = 0, hs = 0, hc = 0;
  const d = im.data;
  for (let y = 0; y < im.height; y++) {
    const v = (Y0 + (y + 0.5) / k) / H;
    for (let x = 0; x < im.width; x++) {
      const q = (y * im.width + x) * 4;
      if (!d[q + 3]) continue;
      const u = (X0 + (x + 0.5) / k) / W;
      if (it.tipo !== 'retangulo' && !dentroFonte(it, u, v)) continue;
      const r = d[q], g = d[q + 1], b = d[q + 2];
      const [hh, ss, vv] = hsv(r, g, b);
      const val = [r, g, b, 0.299 * r + 0.587 * g + 0.114 * b, hh, ss, vv];
      for (let i = 0; i < 7; i++) {
        const z = val[i];
        hist[i][i === 4 ? Math.min(255, Math.floor((z / 360) * 256)) : Math.min(255, Math.round(z))]++;
        if (i !== 4) { soma[i] += z; soma2[i] += z * z; }
        if (z < mn[i]) mn[i] = z; if (z > mx[i]) mx[i] = z;
      }
      if (ss > 8) { hs += Math.sin((hh * Math.PI) / 180); hc += Math.cos((hh * Math.PI) / 180); }
      n++;
    }
  }
  if (!n) return { n: 0, canais: null, k };
  const canais = {};
  nomes.forEach((nm, i) => {
    let media, desvio;
    if (i === 4) {
      // matiz é circular: média pelo vetor; desvio circular √(−2 ln R)
      const R = Math.hypot(hs, hc) / n;
      media = ((Math.atan2(hs, hc) * 180) / Math.PI + 360) % 360;
      desvio = R > 0 ? (Math.sqrt(-2 * Math.log(Math.min(1, R))) * 180) / Math.PI : 0;
    } else {
      media = soma[i] / n;
      desvio = Math.sqrt(Math.max(0, soma2[i] / n - media * media));
    }
    canais[nm] = { hist: hist[i], media, desvio, min: mn[i], max: mx[i] };
  });
  return { n, canais, k };
}

// ------------------------------------------------------------- perfil

/**
 * Perfil de intensidade ao longo dos segmentos da marcação (régua, linha,
 * perfil, polilinha, seta). Uma amostra por px da fonte (máx. 4000),
 * interpolação bilinear. { d: [px], r, g, b, cinza: Float32Array, comprimento }
 */
export function perfilDe(it) {
  const W = vista.W, H = vista.H;
  const pts = it.pts.map(([u, v]) => [u * W, v * H]);
  if (pts.length < 2) return null;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const N = Math.max(2, Math.min(4000, Math.round(L) + 1));
  const c = caixaItem(it);
  const X0 = Math.max(0, Math.floor(c.x1 * W) - 1), Y0 = Math.max(0, Math.floor(c.y1 * H) - 1);
  const w = Math.max(2, Math.min(W - X0, Math.ceil(c.x2 * W) + 2 - X0)), h = Math.max(2, Math.min(H - Y0, Math.ceil(c.y2 * H) + 2 - Y0));
  const k = Math.min(1, 2048 / Math.max(w, h));
  const im = lerRegiao(X0, Y0, w, h, k);
  if (!im) return null;
  const out = { d: new Float32Array(N), r: new Float32Array(N), g: new Float32Array(N), b: new Float32Array(N), cinza: new Float32Array(N), comprimento: L };
  const amostra = (x, y, o) => {
    const fx = Math.max(0, Math.min(im.width - 1.001, (x - X0) * k - 0.5)), fy = Math.max(0, Math.min(im.height - 1.001, (y - Y0) * k - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const x1 = Math.min(im.width - 1, x0 + 1), y1 = Math.min(im.height - 1, y0 + 1);
    for (let ch = 0; ch < 3; ch++) {
      const p = (yy, xx) => im.data[(yy * im.width + xx) * 4 + ch];
      o[ch] = (p(y0, x0) * (1 - ax) + p(y0, x1) * ax) * (1 - ay) + (p(y1, x0) * (1 - ax) + p(y1, x1) * ax) * ay;
    }
  };
  const tmp = [0, 0, 0];
  let seg = 1, acum = 0;
  for (let i = 0; i < N; i++) {
    const s = (L * i) / (N - 1);
    while (seg < pts.length - 1 && s > acum + Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1])) {
      acum += Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]); seg++;
    }
    const a = pts[seg - 1], b = pts[seg];
    const ls = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.max(0, Math.min(1, (s - acum) / ls));
    amostra(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, tmp);
    out.d[i] = s; out.r[i] = tmp[0]; out.g[i] = tmp[1]; out.b[i] = tmp[2];
    out.cinza[i] = 0.299 * tmp[0] + 0.587 * tmp[1] + 0.114 * tmp[2];
  }
  return out;
}

// ------------------------------------------------------------- contorno → polígono

const DX = [1, 1, 0, -1, -1, -1, 0, 1];   // E, SE, S, SW, W, NW, N, NE (horário com y para baixo)
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/**
 * Contorno EXTERNO do componente que contém `semente` (ou do maior, sem
 * semente) — rastreio de vizinhança de Moore com o critério de parada de
 * Jacob. Devolve [[x, y]…] em px da grade (centros dos pixels de borda).
 */
export function contornoExterno(bits, w, h, semente = null) {
  // isola o componente (8-conectado) da semente; sem semente, o maior
  const lab = new Int32Array(w * h);
  let melhor = 0, melhorN = 0, nl = 0;
  const pilha = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!bits[i] || lab[i]) continue;
    nl++;
    let sp = 0, n = 0;
    pilha[sp++] = i; lab[i] = nl;
    while (sp) {
      const q = pilha[--sp];
      n++;
      const x = q % w, y = (q / w) | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const r = ny * w + nx;
        if (bits[r] && !lab[r]) { lab[r] = nl; pilha[sp++] = r; }
      }
    }
    if (n > melhorN) { melhorN = n; melhor = nl; }
  }
  if (!nl) return null;
  let alvo = melhor;
  if (semente) {
    const sx = Math.max(0, Math.min(w - 1, Math.round(semente[0]))), sy = Math.max(0, Math.min(h - 1, Math.round(semente[1])));
    if (lab[sy * w + sx]) alvo = lab[sy * w + sx];
  }
  let s = -1;
  for (let i = 0; i < w * h; i++) if (lab[i] === alvo) { s = i; break; }
  const sx = s % w, sy = (s / w) | 0;
  const em = (x, y) => x >= 0 && y >= 0 && x < w && y < h && lab[y * w + x] === alvo;
  const out = [[sx, sy]];
  let cx = sx, cy = sy, d = 6, primeira = -1;
  for (let passo = 0; passo < 4 * w * h + 8; passo++) {
    const ini = (d + 6 - (d & 1)) % 8;
    let nd = -1;
    for (let i = 0; i < 8; i++) { const t = (ini + i) % 8; if (em(cx + DX[t], cy + DY[t])) { nd = t; break; } }
    if (nd < 0) break;                                           // pixel isolado
    if (cx === sx && cy === sy && passo > 0 && nd === primeira) break;
    if (primeira < 0) primeira = nd;
    cx += DX[nd]; cy += DY[nd]; d = nd;
    out.push([cx, cy]);
  }
  if (out.length > 1 && out[out.length - 1][0] === sx && out[out.length - 1][1] === sy) out.pop();
  return out;
}

/** Douglas–Peucker num contorno FECHADO (corta nos dois pontos mais distantes). */
export function simplificar(pts, eps) {
  if (pts.length < 4) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const dp = (a) => {
    if (a.length < 3) return a;
    const [x1, y1] = a[0], [x2, y2] = a[a.length - 1];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1e-9;
    let im = 0, md = -1;
    for (let i = 1; i < a.length - 1; i++) {
      const d = Math.abs((y2 - y1) * a[i][0] - (x2 - x1) * a[i][1] + x2 * y1 - y2 * x1) / L;
      if (d > md) { md = d; im = i; }
    }
    if (md <= eps) return [a[0], a[a.length - 1]];
    const e = dp(a.slice(0, im + 1)), f = dp(a.slice(im));
    return [...e.slice(0, -1), ...f];
  };
  const A = dp(pts.slice(0, far + 1)), B = dp([...pts.slice(far), pts[0]]);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

/** Grade de bits (região X0,Y0 reduzida por k) → polígono em 0–1 da fonte. */
function poligonoDe(bits, w, h, X0, Y0, kx, ky, semente, eps = 1) {
  const c = contornoExterno(bits, w, h, semente);
  if (!c || c.length < 3) return null;
  const s = simplificar(c, eps);
  if (s.length < 3) return null;
  return s.map(([x, y]) => [(X0 + (x + 0.5) / kx) / vista.W, (Y0 + (y + 0.5) / ky) / vista.H]);
}

// ------------------------------------------------------------- varinha mágica

/**
 * Varinha mágica a partir de `p` (0–1 da fonte). Tolerância por canal (como
 * no Photoshop: 0–255, padrão 32). Contígua: preenchimento 4-conectado a
 * partir do clique → POLÍGONO do contorno externo. Não contígua: todos os
 * pixels parecidos da imagem → MÁSCARA (vários pedaços).
 * Lê a fonte reduzida a no máximo 900 px de lado.
 * { tipo: 'poligono', pts } | { tipo: 'mascara', pts, mask } | null
 */
export function varinha(p, { tolerancia = 32, contiguo = true } = {}) {
  const W = vista.W, H = vista.H;
  const k = Math.min(1, 900 / Math.max(W, H));
  const im = lerRegiao(0, 0, W, H, k);
  if (!im) return null;
  const w = im.width, h = im.height, d = im.data;
  const sx = Math.max(0, Math.min(w - 1, Math.floor(p[0] * W * k))), sy = Math.max(0, Math.min(h - 1, Math.floor(p[1] * H * k)));
  const q0 = (sy * w + sx) * 4;
  const r0 = d[q0], g0 = d[q0 + 1], b0 = d[q0 + 2];
  const tol = Math.max(0, Math.min(255, tolerancia));
  const parece = (i) => { const q = i * 4; return Math.abs(d[q] - r0) <= tol && Math.abs(d[q + 1] - g0) <= tol && Math.abs(d[q + 2] - b0) <= tol; };
  const bits = new Uint8Array(w * h);
  if (contiguo) {
    const pilha = new Int32Array(w * h);
    let sp = 0;
    pilha[sp++] = sy * w + sx; bits[sy * w + sx] = 1;
    while (sp) {
      const i = pilha[--sp];
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && !bits[i - 1] && parece(i - 1)) { bits[i - 1] = 1; pilha[sp++] = i - 1; }
      if (x < w - 1 && !bits[i + 1] && parece(i + 1)) { bits[i + 1] = 1; pilha[sp++] = i + 1; }
      if (y > 0 && !bits[i - w] && parece(i - w)) { bits[i - w] = 1; pilha[sp++] = i - w; }
      if (y < h - 1 && !bits[i + w] && parece(i + w)) { bits[i + w] = 1; pilha[sp++] = i + w; }
    }
    const pts = poligonoDe(bits, w, h, 0, 0, w / W, h / H, [sx, sy], 1);
    let n = 0; for (let i = 0; i < bits.length; i++) n += bits[i];
    return pts ? { tipo: 'poligono', pts, pixels: n / (k * k) } : null;
  }
  let n = 0;
  for (let i = 0; i < w * h; i++) if (parece(i)) { bits[i] = 1; n++; }
  return mascaraDeGrade(bits, w, h, k, n);
}

/** Grade de bits da imagem inteira (reduzida por k) → item de máscara recortado. */
function mascaraDeGrade(bits, w, h, k, n) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bits[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1, nb = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) nb.set(bits.subarray((y + y0) * w + x0, (y + y0) * w + x0 + nw), y * nw);
  return { tipo: 'mascara', mask: codificarMascara(nb, nw, nh), pts: [[x0 / w, y0 / h], [(x1 + 1) / w, (y1 + 1) / h]], pixels: n / (k * k) };
}

// ------------------------------------------------------------- encaixar na borda

/**
 * Leva `p` (0–1 da fonte) ao pixel de gradiente (Sobel) mais forte num raio
 * de ~`raioTela` px de TELA (convertido para px da fonte com o zoom atual).
 * Fraco demais (sem borda por perto): devolve `p` como veio.
 */
export function encaixarBorda(p, raioTela = 9) {
  const W = vista.W, H = vista.H;
  const pxFonte = (vista.sw / Math.max(1, vista.dw)) * vista.dpr;
  const R = Math.max(3, Math.min(48, Math.round(raioTela * pxFonte)));
  const X = Math.round(p[0] * W), Y = Math.round(p[1] * H);
  const X0 = X - R - 1, Y0 = Y - R - 1, n = 2 * R + 3;
  const im = lerRegiao(X0, Y0, n, n, 1);
  if (!im) return p;
  const gr = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) gr[i] = 0.299 * im.data[i * 4] + 0.587 * im.data[i * 4 + 1] + 0.114 * im.data[i * 4 + 2];
  let best = 0, bx = X, by = Y;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const dx = x - R - 1, dy = y - R - 1;
      const dist = Math.hypot(dx, dy);
      if (dist > R) continue;
      const a = (yy, xx) => gr[yy * n + xx];
      const gx = a(y - 1, x + 1) + 2 * a(y, x + 1) + a(y + 1, x + 1) - a(y - 1, x - 1) - 2 * a(y, x - 1) - a(y + 1, x - 1);
      const gy = a(y + 1, x - 1) + 2 * a(y + 1, x) + a(y + 1, x + 1) - a(y - 1, x - 1) - 2 * a(y - 1, x) - a(y - 1, x + 1);
      const m = Math.hypot(gx, gy) * (1 - 0.35 * (dist / R));   // perto do clique vale um pouco mais
      if (m > best) { best = m; bx = X0 + x; by = Y0 + y; }
    }
  }
  if (best < 60) return p;
  return [Math.max(0, Math.min(1, (bx + 0.5) / W)), Math.max(0, Math.min(1, (by + 0.5) / H))];
}

// ------------------------------------------------------------- SAM com um clique

const S = 1024;
/*
 * O decodificador ONNX do MobileSAM foi exportado com o recorte da máscara
 * FIXO em 683×1024 (a imagem de exemplo do SAM, 3:2: 1800×1200 → 683 linhas
 * no quadrado de 1024) — `orig_im_size` só muda o tamanho final. Medido no
 * teste sintético: com uma imagem 4:3 a máscara saía esticada 1,125× na
 * vertical. Então a imagem vai para o codificador cabendo em 1024×683 e o
 * tamanho pedido é exatamente esse: a máscara volta no espaço do codificador.
 */
const SH = 683;
const sam = { chave: null, emb: null, dims: null, w: 0, h: 0, k: 1, prep: null };

/** Situação do MobileSAM para a dica: 'pronto' | 'baixando 40%' | 'carregando…' | 'erro: …'. */
export function situacaoSam() {
  if (isReady('mobilesam-enc') && isReady('mobilesam-dec')) return 'pronto';
  const st = modelStates();
  for (const id of ['mobilesam-enc', 'mobilesam-dec']) {
    const s = st[id];
    if (s && s.status === 'error') return 'erro: ' + (s.error || 'falhou');
  }
  const p = ['mobilesam-enc', 'mobilesam-dec'].map((id) => (st[id] ? st[id].progress || 0 : 0));
  const pct = Math.round(((p[0] * 28 + p[1] * 16.5) / 44.5) * 100);
  return pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
}

/** Chave do quadro: o tempo do vídeo (arquivo) ou, ao vivo, a sessão de cliques. */
function chaveQuadro(sessao) {
  const t = tempoAgora();
  return `${vista.W}x${vista.H}|${vista.fs ? 1 : 0}|${t.relogio === 'video' ? t.t.toFixed(3) : 's' + sessao}`;
}

/**
 * Segmenta com o MobileSAM. `pontos`: [{ u, v, pos: true|false }] em 0–1 da
 * fonte. O codificador roda uma vez por quadro (por sessão de cliques ao
 * vivo); cada clique só roda o decodificador. → { pts (polígono 0–1), area (px²), iou } | null
 */
export async function segmentarSam(pontos, sessao = 0, caixa = null) {
  if (!pontos.length && !caixa) return null;
  await Promise.all([loadModel('mobilesam-enc'), loadModel('mobilesam-dec')]);
  const ort = await ensureOrt();
  const chave = chaveQuadro(sessao);
  if (sam.chave !== chave || !sam.emb) {
    const W = vista.W, H = vista.H;
    const k = Math.min(S / W, SH / H);
    const im = lerRegiao(0, 0, W, H, k);
    if (!im) throw new Error('esta fonte não deixa ler os pixels');
    const spec = MODELS['mobilesam-enc'];
    const x = new Float32Array(3 * S * S), plano = S * S;
    for (let y = 0; y < im.height; y++) {
      for (let xx = 0; xx < im.width; xx++) {
        const q = (y * im.width + xx) * 4, i = y * S + xx;
        x[i] = (im.data[q] - spec.mean[0]) / spec.std[0];
        x[plano + i] = (im.data[q + 1] - spec.mean[1]) / spec.std[1];
        x[2 * plano + i] = (im.data[q + 2] - spec.mean[2]) / spec.std[2];
      }
    }
    const enc = await runFeeds('mobilesam-enc', { input_image: new ort.Tensor('float32', x, [1, 3, S, S]) });
    const e = enc.image_embeddings;
    sam.emb = Float32Array.from(e.data); sam.dims = e.dims.slice();
    sam.w = im.width; sam.h = im.height; sam.k = k; sam.chave = chave;
  }
  // pontos (+ caixa, rótulos 2 e 3) e, sem caixa, o ponto de preenchimento (0,0) com rótulo −1 (exportação ONNX do SAM)
  const n = pontos.length + (caixa ? 2 : 1);
  const coords = new Float32Array(n * 2), labels = new Float32Array(n);
  pontos.forEach((p, i) => { coords[i * 2] = p.u * vista.W * sam.k; coords[i * 2 + 1] = p.v * vista.H * sam.k; labels[i] = p.pos ? 1 : 0; });
  if (caixa) {
    const i = pontos.length;
    coords[i * 2] = caixa.x1 * vista.W * sam.k; coords[i * 2 + 1] = caixa.y1 * vista.H * sam.k; labels[i] = 2;
    coords[i * 2 + 2] = caixa.x2 * vista.W * sam.k; coords[i * 2 + 3] = caixa.y2 * vista.H * sam.k; labels[i + 1] = 3;
  } else labels[n - 1] = -1;
  const out = await runFeeds('mobilesam-dec', {
    image_embeddings: new ort.Tensor('float32', sam.emb.slice(), sam.dims),
    point_coords: new ort.Tensor('float32', coords, [1, n, 2]),
    point_labels: new ort.Tensor('float32', labels, [1, n]),
    mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor('float32', new Float32Array([SH, S]), [2]),
  }, ['masks', 'iou_predictions']);
  const m = out.masks, mh = m.dims[2], mw = m.dims[3];
  const logit = m.data;
  const bits = new Uint8Array(mw * mh);
  let nOn = 0;
  for (let i = 0; i < mw * mh; i++) if (logit[i] > 0) { bits[i] = 1; nOn++; }
  const iou = Number(out.iou_predictions.data[0]);
  if (!nOn) return { pts: null, area: 0, iou };
  const kx = sam.k * (mw / S), ky = sam.k * (mh / SH);   // px da máscara por px da fonte
  const pos = pontos.find((p) => p.pos);
  const semente = pos ? [pos.u * vista.W * kx, pos.v * vista.H * ky] : caixa ? [((caixa.x1 + caixa.x2) / 2) * vista.W * kx, ((caixa.y1 + caixa.y2) / 2) * vista.H * ky] : null;
  const pts = poligonoDe(bits, mw, mh, 0, 0, kx, ky, semente, 1.2);
  return { pts, area: nOn / (kx * ky), iou, dims: [mw, mh] };
}

/** Esquece o quadro codificado (nova sessão ao vivo). */
export function esquecerSam() { sam.chave = null; sam.emb = null; }

// ------------------------------------------------------------- trajetórias

const T = 8;                      // meia largura do modelo (17×17)
const modelos = new Map();        // id → { tpl: Float32Array, media, norma, ultT, perdas }

function cinzaDe(im) {
  const g = new Float32Array(im.width * im.height);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * im.data[i * 4] + 0.587 * im.data[i * 4 + 1] + 0.114 * im.data[i * 4 + 2];
  return g;
}

function pegarModelo(X, Y, ler = (a, b, c, d) => lerRegiao(a, b, c, d, 1)) {
  const n = 2 * T + 1;
  // pixel i tem o centro em i + 0,5: o modelo fica centrado no pixel que contém (X, Y)
  const im = ler(Math.floor(X) - T, Math.floor(Y) - T, n, n);
  if (!im) return null;
  const tpl = cinzaDe(im);
  let m = 0; for (const v of tpl) m += v; m /= tpl.length;
  let s = 0; for (let i = 0; i < tpl.length; i++) { tpl[i] -= m; s += tpl[i] * tpl[i]; }
  return { tpl, norma: Math.sqrt(s) || 1 };
}

/**
 * Um passo de rastreio para cada trajetória ATIVA, se o quadro mudou desde o
 * último (tempo do vídeo; ao vivo, sempre). Busca num raio `raio` px da fonte
 * em volta do último ponto; ajuste sub-pixel por parábola. Correlação < 0,5
 * = alvo perdido (a trajetória pausa). Chamado pelo desenho de cada quadro.
 */
/** VideoFrame do quadro na tela (vídeo), ou null (imagem, canvas, navegador sem WebCodecs). */
function quadroAtual() {
  const el = vista.el;
  if (el && typeof VideoFrame !== 'undefined' && typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement && el.readyState >= 2) {
    try { return new VideoFrame(el); } catch (_) { return null; }
  }
  return null;
}

/**
 * Pega o modelo da trajetória JÁ, no quadro em que o usuário clicou — se
 * esperasse o próximo quadro pintado, com o vídeo andando o modelo sairia
 * deslocado do clique (medido: 2 px de viés constante no teste sintético).
 */
export function iniciarTrajetoria(id, p) {
  const vf = quadroAtual();
  try {
    const agora = tempoAgora();
    if (vf && agora.relogio === 'video' && Number.isFinite(vf.timestamp)) agora.t = vf.timestamp / 1e6;
    const X = p[0] * vista.W, Y = p[1] * vista.H;
    const m = pegarModelo(X, Y, (a, b, c, d) => lerRegiao(a, b, c, d, 1, vf));
    if (m) modelos.set(id, { ...m, ultT: agora.t, dx: X - (Math.floor(X) + 0.5), dy: Y - (Math.floor(Y) + 0.5) });
    return agora.t;
  } finally { if (vf) vf.close(); }
}

export function passoTrajetorias(raio = 28) {
  const st = marcStore.get();
  if (!vista.ok || !st.itens.some((i) => i.tipo === 'trajetoria' && i.ativo)) return;
  /*
   * Vídeo: lê o quadro como VideoFrame — os pixels E o instante (timestamp)
   * do MESMO quadro. Com currentTime ou o mediaTime do
   * requestVideoFrameCallback o drawImage podia trazer outro quadro e o tempo
   * saía 1–3 quadros desalinhado (medido no teste do ponto sintético).
   */
  const vf = quadroAtual();
  try {
    passo(raio, vf);
  } finally {
    if (vf) vf.close();
  }
}

function passo(raio, vf) {
  const st = marcStore.get();
  const ativas = st.itens.filter((i) => i.tipo === 'trajetoria' && i.ativo);
  if (!ativas.length || !vista.ok || rt.arrastando) return;
  const agora = tempoAgora();
  if (vf && agora.relogio === 'video' && Number.isFinite(vf.timestamp)) agora.t = vf.timestamp / 1e6;
  const ler = (X0, Y0, w, h) => lerRegiao(X0, Y0, w, h, 1, vf);
  const W = vista.W, H = vista.H;
  const novos = new Map();
  for (const it of ativas) {
    let md = modelos.get(it.id);
    const ult = it.pts[it.pts.length - 1];
    const X = ult[0] * W, Y = ult[1] * H;
    if (!md) {
      const m = pegarModelo(X, Y, ler);
      if (!m) continue;
      // o clique raramente cai no centro do pixel: guarda a diferença e devolve nos pontos seguidos
      md = { ...m, ultT: agora.t, dx: X - (Math.floor(X) + 0.5), dy: Y - (Math.floor(Y) + 0.5) };
      modelos.set(it.id, md);
      continue;
    }
    if (agora.t === md.ultT) continue;                 // mesmo quadro (pausado)
    if (agora.relogio === 'video' && agora.t < md.ultT - 1e-3) { novos.set(it.id, { parar: 'o vídeo voltou no tempo' }); continue; }   // voltou no tempo
    md.ultT = agora.t;
    const n = 2 * (raio + T) + 1;
    const cx = Math.floor(X - md.dx), cy = Math.floor(Y - md.dy);   // pixel do centro do modelo no quadro anterior
    const X0 = cx - raio - T, Y0 = cy - raio - T;
    const im = ler(X0, Y0, n, n);
    if (!im) continue;
    const g = cinzaDe(im);
    const tw = 2 * T + 1;
    const sc = new Float32Array((2 * raio + 1) * (2 * raio + 1));
    let best = -2, bi = 0, bj = 0;
    for (let j = 0; j <= 2 * raio; j++) {
      for (let i = 0; i <= 2 * raio; i++) {
        let m = 0;
        for (let y = 0; y < tw; y++) { const o = (j + y) * n + i; for (let x = 0; x < tw; x++) m += g[o + x]; }
        m /= tw * tw;
        let s = 0, ss = 0;
        for (let y = 0; y < tw; y++) {
          const o = (j + y) * n + i, t = y * tw;
          for (let x = 0; x < tw; x++) { const v = g[o + x] - m; s += v * md.tpl[t + x]; ss += v * v; }
        }
        const z = ss > 1e-6 ? s / (Math.sqrt(ss) * md.norma) : -1;
        sc[j * (2 * raio + 1) + i] = z;
        if (z > best) { best = z; bi = i; bj = j; }
      }
    }
    if (best < 0.5) { novos.set(it.id, { parar: `alvo perdido (correlação ${best.toFixed(2)})` }); continue; }
    const L = 2 * raio + 1;
    const par = (a, b, c) => { const d = a - 2 * b + c; return Math.abs(d) > 1e-6 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0; };
    const ox = bi > 0 && bi < 2 * raio ? par(sc[bj * L + bi - 1], sc[bj * L + bi], sc[bj * L + bi + 1]) : 0;
    const oy = bj > 0 && bj < 2 * raio ? par(sc[(bj - 1) * L + bi], sc[bj * L + bi], sc[(bj + 1) * L + bi]) : 0;
    // centro do modelo na posição achada (px contínuo) + a diferença do clique
    const nx = cx - raio + bi + ox + 0.5 + md.dx, ny = cy - raio + bj + oy + 0.5 + md.dy;
    // o modelo acompanha devagar (luz, rotação), só com correlação alta
    if (best > 0.85) {
      const m2 = pegarModelo(nx - md.dx, ny - md.dy, ler);
      if (m2) { for (let i = 0; i < md.tpl.length; i++) md.tpl[i] = md.tpl[i] * 0.9 + m2.tpl[i] * 0.1; let s = 0; for (const v of md.tpl) s += v * v; md.norma = Math.sqrt(s) || 1; }
    }
    novos.set(it.id, { p: [nx / W, ny / H], t: agora.t, score: best });
  }
  if (!novos.size) return;
  editarSemHistorico((itens) => itens.map((it) => {
    const r = novos.get(it.id);
    if (!r) return it;
    if (r.parar) { modelos.delete(it.id); return { ...it, ativo: false, perdido: r.parar }; }
    const pts = [...it.pts, r.p], ts = [...(it.ts || []), r.t];
    if (pts.length > MAX_RASTRO) { pts.splice(0, pts.length - MAX_RASTRO); ts.splice(0, ts.length - MAX_RASTRO); }
    return { ...it, pts, ts, score: r.score };
  }));
}

/** Esquece o modelo (ao pausar/retomar a trajetória ela pega um novo no ponto atual). */
export function soltarModelo(id) { modelos.delete(id); }

/** Velocidade recente (px da fonte por s) nos últimos ~0,3 s do rastro. */
export function velocidadePx(it) {
  const ts = it.ts || [];
  const n = Math.min(ts.length, it.pts.length);
  if (n < 2) return null;
  const W = vista.W, H = vista.H;
  let i = n - 2;
  while (i > 0 && ts[n - 1] - ts[i] < 0.3) i--;
  const dt = ts[n - 1] - ts[i];
  if (!(dt > 0)) return null;
  let d = 0;
  for (let k = i + 1; k < n; k++) d += Math.hypot((it.pts[k][0] - it.pts[k - 1][0]) * W, (it.pts[k][1] - it.pts[k - 1][1]) * H);
  return d / dt;
}
