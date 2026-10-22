/**
 * cv/runtime/livres-h/comum.js — o que o Salto (CV-31) e a Corrida (CV-32)
 * dividem: índices dos 33 pontos MediaPipe/BlazePose, ângulos 2D, centro de
 * massa segmentar, escala pela estatura, estatística, formatação pt-BR e
 * pequenos utilitários de série temporal. Só matemática: roda no node.
 *
 * Coordenadas em PIXELS do quadro, y para BAIXO (como na imagem). "Mais
 * alto" na cena = y menor. Tempos em milissegundos.
 */

export const G = 9.81;   // m/s²

/** Índices MediaPipe por lado anatômico do MODELO (e = esquerdo, d = direito). */
export const LM = {
  nariz: 0, olho: { e: 2, d: 5 }, orelha: { e: 7, d: 8 },
  ombro: { e: 11, d: 12 }, cotovelo: { e: 13, d: 14 }, punho: { e: 15, d: 16 },
  quadril: { e: 23, d: 24 }, joelho: { e: 25, d: 26 }, tornozelo: { e: 27, d: 28 },
  calcanhar: { e: 29, d: 30 }, pe: { e: 31, d: 32 },
};

/** Ossos para desenhar (pares de índices), por lado. */
export const OSSOS = {
  e: [[11, 23], [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [11, 13], [13, 15]],
  d: [[12, 24], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [12, 14], [14, 16]],
  meio: [[11, 12], [23, 24]],
};

export const ok = (p, minVis = 0) => Boolean(p && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.v == null || p.v >= minVis));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const meio = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) });

/** Ângulo interno em B (graus, 0..180) entre BA e BC. */
export function angulo(A, B, C) {
  if (!A || !B || !C) return null;
  const ux = A.x - B.x, uy = A.y - B.y, vx = C.x - B.x, vy = C.y - B.y;
  const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
  if (!(nu > 1e-6 && nv > 1e-6)) return null;
  const c = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Inclinação do segmento A→B em relação à VERTICAL "para cima", em graus,
 * com sinal: positivo quando B está à frente de A no sentido `dir`
 * (+1 = olhando para a direita da imagem, −1 = para a esquerda).
 */
export function inclinacaoVertical(A, B, dir = 1) {
  if (!A || !B) return null;
  const dx = (B.x - A.x) * dir, dy = A.y - B.y;      // dy > 0: B acima de A
  if (!(Math.hypot(dx, dy) > 1e-6)) return null;
  return (Math.atan2(dx, dy) * 180) / Math.PI;
}

/** Ângulo do segmento A→B em relação à horizontal (graus, + = B acima de A), no sentido `dir`. */
export function inclinacaoHorizontal(A, B, dir = 1) {
  if (!A || !B) return null;
  const dx = (B.x - A.x) * dir, dy = A.y - B.y;
  if (!(Math.hypot(dx, dy) > 1e-6)) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Ponto de um lado com visibilidade mínima, ou null. */
export function pt(P, parte, l, minVis = 0) {
  const i = typeof LM[parte] === 'number' ? LM[parte] : LM[parte][l];
  const p = P[i];
  return ok(p, minVis) ? p : null;
}

/**
 * Ponto mais BAIXO do pé (y máximo entre calcanhar, ponta e tornozelo) — é o
 * que toca o chão. O tornozelo só entra se calcanhar e ponta faltarem, e aí
 * com um desconto de ~4% da perna (o maléolo fica acima do chão).
 */
export function basePe(P, l, minVis = 0) {
  const c = pt(P, 'calcanhar', l, minVis), p = pt(P, 'pe', l, minVis);
  if (c || p) {
    if (c && p) return c.y >= p.y ? { x: c.x, y: c.y, ponto: 'calcanhar' } : { x: p.x, y: p.y, ponto: 'ponta' };
    return c ? { x: c.x, y: c.y, ponto: 'calcanhar' } : { x: p.x, y: p.y, ponto: 'ponta' };
  }
  const t = pt(P, 'tornozelo', l, minVis);
  if (!t) return null;
  const q = pt(P, 'quadril', l, 0), j = pt(P, 'joelho', l, 0);
  const desc = q && j ? 0.04 * (dist(q, j) + dist(j, t)) : 0;
  return { x: t.x, y: t.y + desc, ponto: 'tornozelo' };
}

/** Comprimento da perna (quadril→joelho→tornozelo) de um lado, em px. */
export function pernaPx(P, l) {
  const q = P[LM.quadril[l]], j = P[LM.joelho[l]], t = P[LM.tornozelo[l]];
  if (!ok(q) || !ok(j) || !ok(t)) return null;
  return dist(q, j) + dist(j, t);
}

/**
 * Centro de massa 2D pelo modelo segmentar (frações de massa e posição do
 * CM no segmento de Dempster, como tabeladas em Winter, "Biomechanics and
 * Motor Control of Human Movement", 4ª ed., tab. 4.1). Segmento sem os dois
 * pontos visíveis usa o mesmo segmento do outro lado (na vista lateral a
 * altura é praticamente a mesma) ou fica de fora, renormalizando a massa.
 */
const SEGMENTOS = [
  // [massa, proximal, distal, fração do CM a partir do proximal]
  [0.028, 'ombro', 'cotovelo', 0.436],
  [0.016, 'cotovelo', 'punho', 0.430],
  [0.006, 'punho', 'punho', 0],
  [0.100, 'quadril', 'joelho', 0.433],
  [0.0465, 'joelho', 'tornozelo', 0.433],
  [0.0145, 'calcanhar', 'pe', 0.5],
];
export function centroMassa(P, minVis = 0.2) {
  let sx = 0, sy = 0, sm = 0;
  const add = (m, x, y) => { sx += m * x; sy += m * y; sm += m; };
  for (const l of ['e', 'd']) {
    const o = l === 'e' ? 'd' : 'e';
    for (const [m, a, b, f] of SEGMENTOS) {
      let A = pt(P, a, l, minVis), B = pt(P, b, l, minVis);
      if (!A || !B) { A = pt(P, a, o, minVis); B = pt(P, b, o, minVis); }
      if (A && B) add(m, A.x + f * (B.x - A.x), A.y + f * (B.y - A.y));
    }
  }
  // tronco (0,497): do meio dos ombros ao meio do quadril, CM a 50%
  const oe = pt(P, 'ombro', 'e', minVis), od = pt(P, 'ombro', 'd', minVis);
  const qe = pt(P, 'quadril', 'e', minVis), qd = pt(P, 'quadril', 'd', minVis);
  const om = oe && od ? meio(oe, od) : (oe || od), qm = qe && qd ? meio(qe, qd) : (qe || qd);
  if (om && qm) add(0.497, (om.x + qm.x) / 2, (om.y + qm.y) / 2);
  // cabeça e pescoço (0,081): orelhas, ou nariz
  const re = pt(P, 'orelha', 'e', minVis), rd = pt(P, 'orelha', 'd', minVis), n = pt(P, 'nariz', null, minVis);
  const cab = re && rd ? meio(re, rd) : (re || rd || n);
  if (cab) add(0.081, cab.x, cab.y);
  if (sm < 0.5) return null;   // falta muita coisa: não inventa
  return { x: sx / sm, y: sy / sm, massa: sm };
}

/** Meio do quadril (pelve) — a referência das oscilações. */
export function pelve(P, minVis = 0.2) {
  const qe = pt(P, 'quadril', 'e', minVis), qd = pt(P, 'quadril', 'd', minVis);
  return qe && qd ? meio(qe, qd) : (qe || qd || null);
}

/**
 * Estatura em px a partir de uma pose em pé: do chão (base dos pés) até os
 * olhos, dividido pela altura relativa dos olhos (0,936 H — Drillis &
 * Contini 1966, como em Winter, fig. 4.1). Sem olhos, o nariz (≈ 0,91 H).
 */
export function estaturaPx(P, chaoY, minVis = 0.3) {
  const ol = [pt(P, 'olho', 'e', minVis), pt(P, 'olho', 'd', minVis)].filter(Boolean);
  if (ol.length) return (chaoY - ol.reduce((s, p) => s + p.y, 0) / ol.length) / 0.936;
  const n = pt(P, 'nariz', null, minVis);
  return n ? (chaoY - n.y) / 0.91 : null;
}

// ------------------------------------------------------------- estatística

export function estat(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  const n = v.length;
  if (!n) return { n: 0, media: null, dp: null, min: null, max: null };
  const media = v.reduce((s, x) => s + x, 0) / n;
  const dp = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1)) : 0;
  return { n, media, dp, min: Math.min(...v), max: Math.max(...v) };
}

export function percentil(xs, p) {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = (v.length - 1) * p, i = Math.floor(k), f = k - i;
  return i + 1 < v.length ? v[i] + f * (v[i + 1] - v[i]) : v[i];
}
export const mediana = (xs) => percentil(xs, 0.5);

/** Índice de simetria (Robinson et al. 1987): |E − D| / média × 100. */
export function indiceSimetria(e, d) {
  if (e == null || d == null || !Number.isFinite(e) || !Number.isFinite(d)) return null;
  const m = (Math.abs(e) + Math.abs(d)) / 2;
  return m > 1e-9 ? (Math.abs(e - d) / m) * 100 : 0;
}

/** Média móvel centrada de janela ímpar `k` (ignora nulos). */
export function suavizar(xs, k = 3) {
  const h = Math.floor(k / 2), out = new Array(xs.length).fill(null);
  for (let i = 0; i < xs.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(xs.length - 1, i + h); j++) if (xs[j] != null) { s += xs[j]; n++; }
    out[i] = n ? s / n : null;
  }
  return out;
}

/** Ajuste de parábola y = a + b·t + c·t² por mínimos quadrados. */
export function ajusteParabola(ts, ys) {
  const n = ts.length;
  if (n < 4) return null;
  const t0 = ts[0];
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Y0 = 0, Y1 = 0, Y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[i] - t0, y = ys[i], t2 = t * t;
    S0++; S1 += t; S2 += t2; S3 += t2 * t; S4 += t2 * t2; Y0 += y; Y1 += t * y; Y2 += t2 * y;
  }
  // sistema normal 3×3 (Cramer)
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const D = det3(M);
  if (Math.abs(D) < 1e-12) return null;
  const R = [Y0, Y1, Y2];
  const col = (k) => M.map((row, i) => row.map((v, j) => (j === k ? R[i] : v)));
  const a = det3(col(0)) / D, b = det3(col(1)) / D, c = det3(col(2)) / D;
  let ss = 0;
  for (let i = 0; i < n; i++) { const t = ts[i] - t0; ss += (ys[i] - (a + b * t + c * t * t)) ** 2; }
  return { a, b, c, t0, rms: Math.sqrt(ss / n) };
}

// ------------------------------------------------------------- formatação

/** Número em pt-BR (vírgula decimal). */
export function num(x, d = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toFixed(d).replace('.', ',').replace(/^-0(,0+)?$/, '0$1');
}
export const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
export const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
export const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

/** Célula de CSV para o Excel em português (; e vírgula decimal). */
export const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/[;\n"]/g, ' '));
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Intervalo típico entre amostras (mediana dos Δt), em ms. */
export function passoAmostra(ts) {
  const d = [];
  for (let i = 1; i < ts.length; i++) { const x = ts[i] - ts[i - 1]; if (x > 0 && x < 1000) d.push(x); }
  return d.length ? mediana(d) : null;
}

/** Interpolação linear do instante em que a série cruza `nivel` entre i e i+1. */
export function cruzamento(t0, y0, t1, y1, nivel) {
  if (y1 === y0) return (t0 + t1) / 2;
  const f = Math.max(0, Math.min(1, (nivel - y0) / (y1 - y0)));
  return t0 + f * (t1 - t0);
}

/**
 * Instante em que o pé deixa (ou toca) o chão, a partir da altura dos pés
 * `h` (px acima do chão) por amostra. `iA` = última amostra abaixo do
 * limiar e `iB` = primeira acima (decolagem), ou o contrário (aterrissagem,
 * com `subindo` = false). Interpola o cruzamento do limiar e extrapola até a
 * altura zero com a velocidade do pé ajustada (mínimos quadrados) às
 * amostras de até ~1 quadro (mín. 25 ms) do lado do ar. O resultado fica preso
 * entre o cruzamento e a última amostra "rente ao chão" (h ≤ limiar/4).
 */
export function bordaChao(ts, h, iA, iB, limiar, subindo) {
  if (iB < 0 || iB >= ts.length || iA < 0 || iA >= ts.length) return ts[Math.max(0, Math.min(ts.length - 1, iA))];
  const tA = ts[iA], tB = ts[iB], hA = h[iA], hB = h[iB];
  if (hA == null || hB == null) return (tA + tB) / 2;
  const tc = cruzamento(tA, hA, tB, hB, limiar);
  // velocidade do pé do lado do ar
  const passo = subindo ? 1 : -1;
  const xs = [tc], ys = [limiar];
  const janela = Math.max(25, 1.3 * Math.abs(tB - tA));
  for (let i = iB; i >= 0 && i < ts.length && Math.abs(ts[i] - tc) <= janela; i += passo) {
    if (h[i] != null) { xs.push(ts[i]); ys.push(h[i]); }
  }
  let v = null;
  if (xs.length >= 2) {
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length, my = ys.reduce((s, y) => s + y, 0) / ys.length;
    let num = 0, den = 0;
    for (let k = 0; k < xs.length; k++) { num += (xs[k] - mx) * (ys[k] - my); den += (xs[k] - mx) ** 2; }
    v = den > 0 ? Math.abs(num / den) : null;
  }
  let t0 = v > 0 ? (subindo ? tc - limiar / v : tc + limiar / v) : tc;
  // limite: a última amostra rente ao chão do lado do chão
  let tRente = tA;
  for (let i = iA; i >= 0 && i < ts.length && Math.abs(ts[i] - tc) <= 250; i -= passo) {
    if (h[i] != null && h[i] <= limiar / 4) { tRente = ts[i]; break; }
    tRente = ts[i];
  }
  return subindo ? Math.max(tRente, Math.min(tc, t0)) : Math.min(tRente, Math.max(tc, t0));
}

// ------------------------------------------------------------- pose coerente?

/**
 * A pose é de UMA pessoa? Num pelotão o recorte do BlazePose pega pedaços de
 * dois atletas e monta um esqueleto só (uma perna de cada, quadril esticado
 * entre os dois). Regras de proporção 2D, folgadas o bastante para a vista
 * lateral e a de trás (encurtamento perspectivo), e apertadas o bastante para
 * a fusão de duas pessoas:
 *   - coxa ÷ perna (canela) de cada lado entre 0,5 e 2,0;
 *   - perna (coxa + canela) esquerda ÷ direita entre 0,6 e 1,65;
 *   - largura do quadril ≤ 0,9 × tronco e dos ombros ≤ 1,3 × tronco;
 *   - tronco ÷ perna entre 0,28 e 1,25;
 *   - tornozelos afastados no máximo 1,6 × perna (passada de velocista ≈ 1,2);
 *   - perna dentro de 0,6–1,6 × a referência recente (`ancora`), se houver.
 * Devolve { ok, motivo, perna }. Pontos faltando não reprovam (só não testam).
 */
export function coerenciaPose(P, ancora = null, minVis = 0.3) {
  const g = (parte, l) => pt(P, parte, l, minVis);
  const seg = (a, b) => (a && b ? dist(a, b) : null);
  const coxa = { e: seg(g('quadril', 'e'), g('joelho', 'e')), d: seg(g('quadril', 'd'), g('joelho', 'd')) };
  const can = { e: seg(g('joelho', 'e'), g('tornozelo', 'e')), d: seg(g('joelho', 'd'), g('tornozelo', 'd')) };
  const perna = { e: coxa.e && can.e ? coxa.e + can.e : null, d: coxa.d && can.d ? coxa.d + can.d : null };
  const pMax = Math.max(perna.e || 0, perna.d || 0) || null;
  const qe = g('quadril', 'e'), qd = g('quadril', 'd'), oe = g('ombro', 'e'), od = g('ombro', 'd');
  const qm = qe && qd ? meio(qe, qd) : qe || qd, om = oe && od ? meio(oe, od) : oe || od;
  const tronco = seg(qm, om);
  const falha = (motivo) => ({ ok: false, motivo, perna: pMax });
  for (const l of ['e', 'd']) {
    if (coxa[l] && can[l]) { const r = coxa[l] / can[l]; if (r < 0.5 || r > 2.0) return falha('coxa/canela'); }
  }
  if (perna.e && perna.d) { const r = perna.e / perna.d; if (r < 0.6 || r > 1.65) return falha('pernas desiguais'); }
  if (tronco) {
    if (qe && qd && dist(qe, qd) > 0.9 * tronco) return falha('quadril largo');
    if (oe && od && dist(oe, od) > 1.3 * tronco) return falha('ombros largos');
    if (pMax) { const r = tronco / pMax; if (r < 0.28 || r > 1.25) return falha('tronco/perna'); }
  }
  const te = g('tornozelo', 'e'), td = g('tornozelo', 'd');
  if (te && td && pMax && dist(te, td) > 1.6 * pMax) return falha('pés afastados');
  if (ancora && pMax && (pMax < 0.6 * ancora || pMax > 1.6 * ancora)) return falha('tamanho mudou');
  return { ok: true, motivo: null, perna: pMax };
}
