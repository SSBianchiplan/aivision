/**
 * cv/runtime/livres-oa/nucleo.js — a matemática dos operadores da onda 1-a,
 * sem DOM e sem modelo (testável com quadros sintéticos):
 *
 *   pessoasComId       poses do RTMO com ID (do rastreio da cadeia ou próprio)
 *   lerAgulha          ângulo da agulha de um mostrador: gradiente (Sobel) com
 *                      votação de Hough restrita a retas pelo centro marcado
 *   valorDoAngulo      ângulo → valor na escala (zero, fundo, sentido)
 *   lerDisplay7        display de 7 segmentos: Otsu, projeção de colunas, 7 janelas
 *   cruzamento         fração sub-quadro em que um ponto cruza uma reta (fotocélula)
 *   chaveNFe, cnpjOk, rastreioCorreios   validação de etiquetas de transporte
 */

// ------------------------------------------------------------------ pessoas com ID

const KP = { OMBRO_E: 5, OMBRO_D: 6, QUADRIL_E: 11, QUADRIL_D: 12 };
export { KP };

function iouCaixa(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1), x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - i;
  return u > 0 ? i / u : 0;
}

/**
 * Pessoas da cadeia (ctx.poses do RTMO/YOLO26-pose) com um ID estável:
 * o do Tracking com IDs quando ele vem depois da pose (casado por IoU com
 * ctx.detections), senão um rastreio próprio por vizinho mais próximo.
 * Devolve [{ id, kp: [{x, y, score}] (0–1 do quadro), box }].
 */
export function pessoasComId(ctx, st) {
  const poses = Array.isArray(ctx.poses) ? ctx.poses.filter((p) => p && Array.isArray(p.keypoints)) : [];
  if (!poses.length) { envelhecer(st); return []; }
  const comId = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => d && d.id != null) : [];
  const out = [];
  const livres = [];
  for (const p of poses) {
    let melhor = null, mv = 0.3;
    for (const d of comId) { const v = iouCaixa(p.box, d); if (v > mv) { mv = v; melhor = d; } }
    if (melhor) out.push({ id: 't' + melhor.id, kp: p.keypoints, box: p.box });
    else livres.push(p);
  }
  if (livres.length) {
    const T = st.__trk || (st.__trk = { prox: 1, lista: [] });
    const usados = new Set();
    for (const p of livres) {
      const cx = (p.box.x1 + p.box.x2) / 2, cy = (p.box.y1 + p.box.y2) / 2, h = Math.max(0.02, p.box.y2 - p.box.y1);
      let m = null, md = 0.6 * h;
      for (const t of T.lista) {
        if (usados.has(t)) continue;
        const d = Math.hypot(t.cx - cx, t.cy - cy);
        if (d < md) { md = d; m = t; }
      }
      if (!m) { m = { id: T.prox++, cx, cy, perdido: 0 }; T.lista.push(m); }
      m.cx = cx; m.cy = cy; m.perdido = 0; usados.add(m);
      out.push({ id: 'p' + m.id, kp: p.keypoints, box: p.box });
    }
    for (const t of T.lista) if (!usados.has(t)) t.perdido++;
    T.lista = T.lista.filter((t) => t.perdido < 30);
  } else envelhecer(st);
  return out;
}

function envelhecer(st) {
  const T = st.__trk;
  if (!T) return;
  for (const t of T.lista) t.perdido++;
  T.lista = T.lista.filter((t) => t.perdido < 30);
}

/** Ponto médio de dois keypoints visíveis (ou o que estiver visível), ou null. */
export function medio(kp, a, b, conf) {
  const A = kp[a], B = kp[b];
  const va = A && A.score >= conf, vb = B && B.score >= conf;
  if (va && vb) return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  if (va) return { x: A.x, y: A.y };
  if (vb) return { x: B.x, y: B.y };
  return null;
}

// ------------------------------------------------------------------ mostrador analógico

const TAU = Math.PI * 2;
export const mod2pi = (a) => ((a % TAU) + TAU) % TAU;

/**
 * Ângulo da agulha. `img` ImageData; `c` = [cx, cy] e `R` (raio até o zero)
 * em px da imagem; `faixa` = { de, ate } em rad no sentido de varredura
 * (opcional: limita a busca); o = { r0, r1 } frações do raio onde a agulha é
 * procurada (fora dos traços da escala e longe do eixo).
 *
 * Votação: cada pixel do anel com gradiente forte e TANGENCIAL (a borda de
 * uma reta que passa pelo centro tem gradiente perpendicular ao raio) vota
 * no ângulo dele, com peso ∝ módulo × raio (a ponta longa da agulha vence a
 * cauda curta). Histograma em 0,5°, suavizado, pico com refino parabólico.
 * Devolve { ang (rad, atan2 de tela, y para baixo), conf (pico ÷ média) }.
 */
export function lerAgulha(img, c, R, faixa = null, o = {}) {
  const W = img.width, H = img.height, d = img.data;
  const r0 = (o.r0 ?? 0.15) * R, r1 = (o.r1 ?? 0.75) * R;
  const N = 720, hist = new Float64Array(N);
  const x0 = Math.max(1, Math.floor(c[0] - r1)), x1 = Math.min(W - 2, Math.ceil(c[0] + r1));
  const y0 = Math.max(1, Math.floor(c[1] - r1)), y1 = Math.min(H - 2, Math.ceil(c[1] + r1));
  if (x1 <= x0 || y1 <= y0) return null;
  const gw = x1 - x0 + 3, gh = y1 - y0 + 3;
  const g = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const yy = Math.min(H - 1, Math.max(0, y0 - 1 + y));
    for (let x = 0; x < gw; x++) {
      const xx = Math.min(W - 1, Math.max(0, x0 - 1 + x)), q = (yy * W + xx) * 4;
      g[y * gw + x] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
    }
  }
  const r02 = r0 * r0, r12 = r1 * r1;
  for (let y = y0; y <= y1; y++) {
    const dy = y - c[1];
    for (let x = x0; x <= x1; x++) {
      const dx = x - c[0], rr = dx * dx + dy * dy;
      if (rr < r02 || rr > r12) continue;
      const i = (y - y0 + 1) * gw + (x - x0 + 1);
      const gx = (g[i - gw + 1] + 2 * g[i + 1] + g[i + gw + 1]) - (g[i - gw - 1] + 2 * g[i - 1] + g[i + gw - 1]);
      const gy = (g[i + gw - 1] + 2 * g[i + gw] + g[i + gw + 1]) - (g[i - gw - 1] + 2 * g[i - gw] + g[i - gw + 1]);
      const m = Math.hypot(gx, gy);
      if (m < 40) continue;
      const r = Math.sqrt(rr), ux = dx / r, uy = dy / r;
      const tang = Math.abs(gx * uy - gy * ux), rad = Math.abs(gx * ux + gy * uy);
      const w = tang - 2 * rad;
      if (w <= 0) continue;
      const a = mod2pi(Math.atan2(dy, dx));
      hist[Math.floor((a / TAU) * N) % N] += w * (r / R);
    }
  }
  // suaviza (gaussiana σ = 1,5 bin, circular)
  const k = [0.05, 0.12, 0.2, 0.26, 0.2, 0.12, 0.05];
  const hs = new Float64Array(N);
  let soma = 0;
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += hist[(i + j + N) % N] * k[j + 3];
    hs[i] = s; soma += s;
  }
  const media = soma / N || 1e-9;
  let best = -1, bv = -1;
  for (let i = 0; i < N; i++) {
    if (faixa) {
      const a = (i + 0.5) / N * TAU;
      if (!dentroDaFaixa(a, faixa)) continue;
    }
    if (hs[i] > bv) { bv = hs[i]; best = i; }
  }
  if (best < 0 || bv <= 0) return null;
  const ym = hs[(best - 1 + N) % N], yp = hs[(best + 1) % N];
  const den = ym - 2 * bv + yp;
  const off = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (ym - yp) / den)) : 0;
  return { ang: mod2pi(((best + 0.5 + off) / N) * TAU), conf: bv / media };
}

/** Ângulo `a` dentro do arco que começa em `faixa.de` e varre `faixa.varre` rad no sentido `faixa.sinal` (+1 horário de tela). */
function dentroDaFaixa(a, f) {
  const d = mod2pi((a - f.de) * f.sinal);
  return d <= f.varre || d >= TAU - f.margem;
}

/**
 * Geometria do mostrador a partir de três pontos (px): zero, centro, fundo
 * de escala, e o sentido ('horário' | 'anti-horário'). A varredura de 0 a
 * 360° é o arco do zero ao fundo NESSE sentido.
 */
export function geometriaMostrador(zero, centro, fundo, sentido = 'horário') {
  const sinal = sentido === 'anti-horário' ? -1 : 1;
  const a0 = Math.atan2(zero[1] - centro[1], zero[0] - centro[0]);
  const a1 = Math.atan2(fundo[1] - centro[1], fundo[0] - centro[0]);
  let varre = mod2pi((a1 - a0) * sinal);
  if (varre < 1e-3) varre = TAU;
  const R = Math.hypot(zero[0] - centro[0], zero[1] - centro[1]);
  return { a0, a1, sinal, varre, R, c: centro, margem: Math.min(0.2, (TAU - varre) / 2) };
}

/** Ângulo da agulha → valor (linear). Fora da escala: prende no limite e marca `fora`. */
export function valorDoAngulo(ang, geo, vMin, vMax) {
  let d = mod2pi((ang - geo.a0) * geo.sinal);
  let fora = 0;
  if (d > geo.varre + 1e-9) {
    // além do fundo ou antes do zero: o lado mais perto
    if (d - geo.varre < TAU - d) { fora = 1; d = geo.varre; } else { fora = -1; d = 0; }
  }
  return { valor: vMin + (d / geo.varre) * (vMax - vMin), fora, frac: d / geo.varre };
}

// ------------------------------------------------------------------ display de 7 segmentos

const SEG_DIG = {
  '1111110': '0', '0110000': '1', '1101101': '2', '1111001': '3', '0110011': '4', '1011011': '5',
  '1011111': '6', '1110000': '7', '1111111': '8', '1111011': '9', '1110011': '9', '0011111': '6',
  '1110010': '7', '0000001': '-', '0001110': 'L', '1001111': 'E', '1000111': 'F',
};

function otsu(hist, n) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/**
 * Lê um display de 7 segmentos na `roi` {x,y,w,h} (px de `img`).
 * o = { polaridade: 'auto'|'claro'|'escuro' (cor do segmento aceso), inclinacao (graus, itálico) }
 * Devolve { texto, digitos: [{ch, x, w}], ok } — '?' para padrão desconhecido.
 */
export function lerDisplay7(img, roi, o = {}) {
  const W = img.width, d = img.data;
  const rx = Math.max(0, Math.round(roi.x)), ry = Math.max(0, Math.round(roi.y));
  const rw = Math.min(W - rx, Math.round(roi.w)), rh = Math.min(img.height - ry, Math.round(roi.h));
  if (rw < 8 || rh < 8) return { texto: '', digitos: [], ok: false };
  const g = new Uint8Array(rw * rh), hist = new Uint32Array(256);
  const sh = Math.tan(((o.inclinacao || 0) * Math.PI) / 180);
  for (let y = 0; y < rh; y++) {
    const desl = (rh / 2 - y) * sh;   // itálico (topo para a direita, > 0): desfaz a inclinação
    for (let x = 0; x < rw; x++) {
      const xs = Math.min(rw - 1, Math.max(0, Math.round(x + desl)));
      const q = ((ry + y) * W + rx + xs) * 4;
      // V do HSV (o maior canal): LED vermelho/verde aceso fica claro mesmo com luma baixa
      const v = Math.max(d[q], d[q + 1], d[q + 2]) | 0;
      g[y * rw + x] = v; hist[v]++;
    }
  }
  const thr = otsu(hist, rw * rh);
  let claros = 0;
  for (let i = 0; i < g.length; i++) if (g[i] > thr) claros++;
  const segClaro = o.polaridade === 'claro' ? true : o.polaridade === 'escuro' ? false : claros < g.length / 2;
  let fg = mascara(g, thr, segClaro, rw, rh);
  // a moldura/parede dentro da área encosta na borda: sem ela sobrar nada, a polaridade era a outra
  if (o.polaridade !== 'claro' && o.polaridade !== 'escuro') {
    let n = 0;
    for (let i = 0; i < fg.length; i++) n += fg[i];
    if (n < fg.length * 0.01) fg = mascara(g, thr, !segClaro, rw, rh);
  }
  // projeção de colunas → grupos (dígitos)
  const col = new Uint32Array(rw);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) col[x] += fg[y * rw + x];
  const minCol = Math.max(1, Math.round(rh * 0.03));
  const grupos = [];
  let ini = -1;
  for (let x = 0; x <= rw; x++) {
    const on = x < rw && col[x] >= minCol;
    if (on && ini < 0) ini = x;
    if (!on && ini >= 0) { grupos.push([ini, x - 1]); ini = -1; }
  }
  const caixas = grupos.map(([a, b]) => {
    let t = rh, f = -1;
    for (let y = 0; y < rh; y++) for (let x = a; x <= b; x++) if (fg[y * rw + x]) { if (y < t) t = y; if (y > f) f = y; break; }
    return { x: a, w: b - a + 1, t, h: f - t + 1 };
  }).filter((c) => c.h > 0);
  if (!caixas.length) return { texto: '', digitos: [], ok: false };
  const Hd = Math.max(...caixas.map((c) => c.h));
  const topo = Math.min(...caixas.filter((c) => c.h > 0.6 * Hd).map((c) => c.t));
  const fill = (x0, x1, y0, y1) => {
    let n = 0, s = 0;
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(rh, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(rw, Math.round(x1)); x++) { n++; s += fg[y * rw + x]; }
    }
    return n ? s / n : 0;
  };
  const digitos = [];
  for (const c of caixas) {
    const baixo = c.t > topo + 0.6 * Hd, meio = c.t > topo + 0.3 * Hd && c.t + c.h < topo + 0.7 * Hd;
    if (c.h < 0.3 * Hd && c.w < 0.35 * Hd && baixo) { digitos.push({ ch: '.', x: c.x, w: c.w }); continue; }
    if (c.h < 0.3 * Hd && meio) { digitos.push({ ch: '-', x: c.x, w: c.w }); continue; }
    if (c.h < 0.6 * Hd) continue;   // ruído
    if (c.w < 0.3 * Hd) { digitos.push({ ch: '1', x: c.x, w: c.w }); continue; }
    const x0 = c.x, w = c.w, y0 = topo, h = Hd;
    const S = [
      fill(x0 + 0.3 * w, x0 + 0.7 * w, y0, y0 + 0.16 * h),            // a
      fill(x0 + 0.72 * w, x0 + w, y0 + 0.2 * h, y0 + 0.4 * h),         // b
      fill(x0 + 0.72 * w, x0 + w, y0 + 0.6 * h, y0 + 0.8 * h),         // c
      fill(x0 + 0.3 * w, x0 + 0.7 * w, y0 + 0.84 * h, y0 + h),         // d
      fill(x0, x0 + 0.28 * w, y0 + 0.6 * h, y0 + 0.8 * h),             // e
      fill(x0, x0 + 0.28 * w, y0 + 0.2 * h, y0 + 0.4 * h),             // f
      fill(x0 + 0.3 * w, x0 + 0.7 * w, y0 + 0.42 * h, y0 + 0.58 * h),  // g
    ];
    const k = S.map((v) => (v > 0.3 ? '1' : '0')).join('');
    digitos.push({ ch: SEG_DIG[k] || '?', x: c.x, w: c.w, seg: k });
  }
  const texto = digitos.map((x) => x.ch).join('');
  return { texto, digitos, ok: texto.length > 0 && !texto.includes('?') };
}

/** Máscara binária do segmento aceso, sem os componentes que tocam a borda da área (moldura, parede). */
function mascara(g, thr, claro, rw, rh) {
  const fg = new Uint8Array(rw * rh);
  for (let i = 0; i < g.length; i++) fg[i] = (g[i] > thr) === claro ? 1 : 0;
  const pilha = [];
  const semear = (i) => { if (fg[i]) { fg[i] = 0; pilha.push(i); } };
  for (let x = 0; x < rw; x++) { semear(x); semear((rh - 1) * rw + x); }
  for (let y = 0; y < rh; y++) { semear(y * rw); semear(y * rw + rw - 1); }
  while (pilha.length) {
    const i = pilha.pop(), x = i % rw, y = (i / rw) | 0;
    if (x > 0) semear(i - 1);
    if (x < rw - 1) semear(i + 1);
    if (y > 0) semear(i - rw);
    if (y < rh - 1) semear(i + rw);
  }
  return fg;
}

// ------------------------------------------------------------------ fotocélula virtual

/**
 * O ponto andou de p0 a p1 (px) entre dois quadros: cruzou a reta a→b?
 * Devolve { f (fração 0–1 do intervalo entre os quadros), sentido (+1: de
 * um lado para o outro conforme a seta a→b), u (posição ao longo de a→b) }
 * ou null. `tol` aceita o cruzamento um pouco além das pontas do segmento.
 */
export function cruzamento(p0, p1, a, b, tol = 0.15) {
  const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey);
  if (L < 1e-6) return null;
  const s0 = (ex * (p0[1] - a[1]) - ey * (p0[0] - a[0])) / L;
  const s1 = (ex * (p1[1] - a[1]) - ey * (p1[0] - a[0])) / L;
  if (s0 === 0 && s1 === 0) return null;
  if ((s0 < 0 && s1 < 0) || (s0 > 0 && s1 > 0) || s0 === s1) return null;
  if (s0 === 0) return null;   // estava sobre a linha no quadro anterior: já contou
  const f = s0 / (s0 - s1);
  const px = p0[0] + f * (p1[0] - p0[0]), py = p0[1] + f * (p1[1] - p0[1]);
  const u = ((px - a[0]) * ex + (py - a[1]) * ey) / (L * L);
  if (u < -tol || u > 1 + tol) return null;
  return { f, sentido: s0 < 0 ? 1 : -1, u };
}

// ------------------------------------------------------------------ etiquetas de transporte

export const UF_IBGE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB',
  26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS',
  51: 'MT', 52: 'GO', 53: 'DF',
};
const MODELO_DOC = { 55: 'NF-e', 57: 'CT-e', 58: 'MDF-e', 59: 'CF-e SAT', 65: 'NFC-e', 67: 'CT-e OS' };

/** Dígito verificador módulo 11 (pesos 2..9 da direita para a esquerda; resto 0 ou 1 → 0). */
export function dvMod11(digitos) {
  let s = 0, p = 2;
  for (let i = digitos.length - 1; i >= 0; i--) { s += (digitos.charCodeAt(i) - 48) * p; p = p === 9 ? 2 : p + 1; }
  const r = s % 11;
  return r < 2 ? 0 : 11 - r;
}

export function cnpjOk(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base, pesos) => { let s = 0; for (let i = 0; i < pesos.length; i++) s += (+base[i]) * pesos[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], p2 = [6, ...p1];
  return dv(c, p1) === +c[12] && dv(c, p2) === +c[13];
}

export function cpfOk(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => { let s = 0; for (let i = 0; i < n; i++) s += (+c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +c[9] && dv(10) === +c[10];
}

/**
 * Chave de acesso de 44 dígitos (NF-e, NFC-e, CT-e, MDF-e): confere o dígito
 * verificador (módulo 11) e abre os campos. null se não tem 44 dígitos.
 */
export function chaveNFe(texto) {
  const k = String(texto || '').replace(/\D/g, '');
  if (k.length !== 44) return null;
  const dv = dvMod11(k.slice(0, 43));
  const uf = +k.slice(0, 2), mod = +k.slice(20, 22);
  const emit = k.slice(6, 20);
  const emitOk = cnpjOk(emit) || (/^000/.test(emit) && cpfOk(emit.slice(3)));
  return {
    chave: k, valida: dv === +k[43], dvEsperado: dv,
    uf: UF_IBGE[uf] || `?${uf}`, ufOk: Boolean(UF_IBGE[uf]),
    aamm: `${k.slice(4, 6)}/20${k.slice(2, 4)}`, emitente: emit, emitenteOk: emitOk,
    modelo: MODELO_DOC[mod] || `modelo ${mod}`, serie: +k.slice(22, 25), numero: +k.slice(25, 34),
    tpEmis: +k[34], codigo: k.slice(35, 43),
  };
}

/**
 * Procura chaves de 44 dígitos num conjunto de linhas (OCR): por linha e
 * emendando linhas vizinhas. Só entram linhas majoritariamente numéricas (a
 * troca O→0, I→1 não pode fabricar dígitos de "Consulta em…"), e numa mesma
 * sequência uma chave válida tira as janelas que se sobrepõem a ela.
 */
export function acharChaves(linhas) {
  const numericas = [];
  for (const l of linhas) {
    const t = String(l || '').replace(/\s+/g, '');
    const dig = (t.match(/\d/g) || []).length;
    if (t.length && dig / t.length >= 0.7) numericas.push(t.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/\D/g, ''));
    else numericas.push(null);
  }
  const achadas = new Map();
  const tentar = (s) => {
    for (let i = 0; i + 44 <= s.length; i++) {
      const c = chaveNFe(s.slice(i, i + 44));
      if (c && c.valida && c.ufOk) { achadas.set(c.chave, c); i += 43; }
    }
  };
  for (let i = 0; i < numericas.length; i++) {
    if (!numericas[i]) continue;
    tentar(numericas[i]);
    let acc = numericas[i];
    for (let j = i + 1; j < Math.min(numericas.length, i + 4) && numericas[j] && acc.length < 60; j++) { acc += numericas[j]; tentar(acc); }
  }
  return [...achadas.values()];
}

/** Objeto registrado dos Correios (AA123456785BR): dígito com pesos 8,6,4,2,3,5,9,7. */
export function rastreioCorreios(texto) {
  const m = /\b([A-Z]{2})(\d{8})(\d)([A-Z]{2})\b/.exec(String(texto || '').toUpperCase().replace(/\s+/g, ''));
  if (!m) return null;
  const pesos = [8, 6, 4, 2, 3, 5, 9, 7];
  let s = 0;
  for (let i = 0; i < 8; i++) s += (+m[2][i]) * pesos[i];
  const r = s % 11;
  const dv = r === 0 ? 5 : r === 1 ? 0 : 11 - r;
  return { codigo: m[0], valido: dv === +m[3], servico: m[1], pais: m[4] };
}
