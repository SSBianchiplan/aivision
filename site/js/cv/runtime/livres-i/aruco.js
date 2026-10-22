/**
 * cv/runtime/livres-i/aruco.js — detector de marcadores ArUco 4×4 (dicionário
 * DICT_4X4_50 do OpenCV) em JavaScript puro, sem dependências: roda no
 * navegador e no node (testes).
 *
 * O ZXing vendorizado lê QR/Data Matrix/Aztec, mas não marcadores fiduciais,
 * e um QR preso na ponta da barra borra com o movimento muito antes de um
 * ArUco: o 4×4 tem células grandes (1/6 do lado) e se lê com 15–20 px.
 *
 * Etapas (o mesmo raciocínio do detector do OpenCV, implementação própria):
 *   1. limiar adaptativo pela média local (imagem integral): "escuro" é o que
 *      fica C níveis abaixo da média da janela;
 *   2. componentes conexos do escuro (a borda preta do marcador é um anel
 *      fechado, ligado às células pretas internas);
 *   3. para cada componente de tamanho plausível: envoltória convexa → 4
 *      cantos (diagonal mais longa + pontos mais afastados dela), teste de
 *      convexidade e de área; cantos refinados por retas ajustadas (mínimos
 *      quadrados) aos pixels de borda de cada lado e, depois, pela transição
 *      de intensidade preto→branco ao longo de cada lado (subpixel);
 *   4. homografia quadrado-unitário → quadrilátero, leitura da grade 6×6
 *      (borda + 4×4 bits) com limiar de Otsu entre as amostras do próprio
 *      marcador, borda toda preta, e busca no dicionário nas 4 rotações (e
 *      espelhado, porque o app espelha o quadro por padrão), aceitando até
 *      1 bit errado (a distância mínima do DICT_4X4_50 permite).
 *
 * Saída: [{ id, cantos: [{x,y}×4] (canto 0 = canto superior esquerdo do
 * marcador impresso, sentido horário), centro, lado (px, média dos lados),
 * ladoEscala (px, o maior par de lados opostos — robusto a giro fora do plano),
 * erros (bits corrigidos), espelhado }].
 */

/** DICT_4X4_50 do OpenCV: 16 bits por marcador, linha a linha, 1 = branco. */
export const DICT_4X4_50 = [46386, 3994, 13101, 39238, 21662, 31181, 40494, 50418, 65242, 53078, 63889, 4519,
  3767, 10767, 9393, 9790, 18021, 26112, 27742, 30383, 34443, 45099, 52437, 56706, 65095, 38001, 44260, 42324,
  8483, 13423, 17429, 22450, 40655, 61643, 2222, 2345, 6261, 1279, 3574, 7258, 5912, 10792, 12940, 14514, 9448,
  12011, 11583, 19300, 20526, 20499];

/** Bits (matriz 4×4 de 0/1) de um id — usado pela página de impressão e pelos testes. */
export function bitsDoId(id) {
  const v = DICT_4X4_50[id];
  const m = [];
  for (let r = 0; r < 4; r++) {
    const linha = [];
    for (let c = 0; c < 4; c++) linha.push((v >> (15 - (r * 4 + c))) & 1);
    m.push(linha);
  }
  return m;
}

const girar = (v) => {
  // rotação de 90° no sentido horário da matriz 4×4: novo[r][c] = velho[3-c][r]
  let o = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const b = (v >> (15 - ((3 - c) * 4 + r))) & 1;
    o = (o << 1) | b;
  }
  return o;
};
const espelharBits = (v) => {
  let o = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o = (o << 1) | ((v >> (15 - (r * 4 + (3 - c)))) & 1);
  return o;
};
const popcount = (x) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

/**
 * Busca no dicionário. Devolve { id, rot, erros, espelhado } ou null.
 * rot = quantas rotações horárias de 90° levam a leitura ao marcador canônico.
 */
export function identificar(v, maxErros = 1, aceitarEspelho = true) {
  let melhor = null;
  const tentar = (base, esp) => {
    let x = base;
    for (let rot = 0; rot < 4; rot++) {
      for (let id = 0; id < DICT_4X4_50.length; id++) {
        const e = popcount(x ^ DICT_4X4_50[id]);
        if (e <= maxErros && (!melhor || e < melhor.erros)) melhor = { id, rot, erros: e, espelhado: esp };
      }
      x = girar(x);
    }
  };
  tentar(v, false);
  if (aceitarEspelho && (!melhor || melhor.erros > 0)) tentar(espelharBits(v), true);
  return melhor;
}

/** Cinza (0..255) a partir de RGBA. */
export function cinzaDe(rgba, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  return g;
}

/** Máscara do escuro por limiar adaptativo (média da janela − C), restrita a uma ROI. */
function limiarAdaptativo(g, w, h, roi, janela, C) {
  const { x0, y0, x1, y1 } = roi;
  const rw = x1 - x0, rh = y1 - y0;
  const I = new Float64Array((rw + 1) * (rh + 1));
  for (let y = 0; y < rh; y++) {
    let acc = 0;
    const base = (y0 + y) * w + x0;
    for (let x = 0; x < rw; x++) {
      acc += g[base + x];
      I[(y + 1) * (rw + 1) + x + 1] = I[y * (rw + 1) + x + 1] + acc;
    }
  }
  const r = janela >> 1;
  const m = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(rh, y + r + 1);
    for (let x = 0; x < rw; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(rw, x + r + 1);
      const s = I[yb * (rw + 1) + xb] - I[ya * (rw + 1) + xb] - I[yb * (rw + 1) + xa] + I[ya * (rw + 1) + xa];
      const media = s / ((yb - ya) * (xb - xa));
      if (g[(y0 + y) * w + x0 + x] < media - C) m[y * rw + x] = 1;
    }
  }
  return m;
}

/** Componentes conexos (4-vizinhança) com pixels de borda externa e extremos por linha. */
function componentes(m, rw, rh, minPx, maxPx) {
  const rot = new Int32Array(rw * rh);
  const pilha = new Int32Array(rw * rh);
  const out = [];
  let n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i] || rot[i]) continue;
    n++;
    let topo = 0, cont = 0;
    pilha[topo++] = i; rot[i] = n;
    let x1 = rw, y1 = rh, x2 = -1, y2 = -1;
    const px = [];
    while (topo) {
      const p = pilha[--topo];
      cont++;
      const x = p % rw, y = (p - x) / rw;
      if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
      if (cont <= maxPx) px.push(p);
      if (x > 0 && m[p - 1] && !rot[p - 1]) { rot[p - 1] = n; pilha[topo++] = p - 1; }
      if (x < rw - 1 && m[p + 1] && !rot[p + 1]) { rot[p + 1] = n; pilha[topo++] = p + 1; }
      if (y > 0 && m[p - rw] && !rot[p - rw]) { rot[p - rw] = n; pilha[topo++] = p - rw; }
      if (y < rh - 1 && m[p + rw] && !rot[p + rw]) { rot[p + rw] = n; pilha[topo++] = p + rw; }
    }
    if (cont < minPx || cont > maxPx) continue;
    const bw = x2 - x1 + 1, bh = y2 - y1 + 1;
    if (bw < 8 || bh < 8 || bw > 6 * bh || bh > 6 * bw) continue;
    // na borda da ROI o marcador está cortado
    if (x1 === 0 || y1 === 0 || x2 === rw - 1 || y2 === rh - 1) continue;
    out.push({ rotulo: n, px, cont, x1, y1, x2, y2 });
  }
  return { comps: out, rot };
}

function envoltoria(pts) {
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cruz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo = [], hi = [];
  for (const p of pts) { while (lo.length >= 2 && cruz(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (hi.length >= 2 && cruz(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  lo.pop(); hi.pop();
  return lo.concat(hi);
}
const areaPoligono = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a / 2; };
const distReta = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return ((p.x - a.x) * dy - (p.y - a.y) * dx) / L; };

/** 4 cantos da envoltória: diagonal mais longa + mais afastados de cada lado dela. */
function quatroCantos(H) {
  if (H.length < 4) return null;
  let A = 0, C = 0, dm = -1;
  for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) {
    const d = (H[i].x - H[j].x) ** 2 + (H[i].y - H[j].y) ** 2;
    if (d > dm) { dm = d; A = i; C = j; }
  }
  let B = -1, D = -1, db = 0, dd = 0;
  for (let i = 0; i < H.length; i++) {
    const d = distReta(H[i], H[A], H[C]);
    if (d > db) { db = d; B = i; }
    if (d < dd) { dd = d; D = i; }
  }
  if (B < 0 || D < 0) return null;
  // ordem ao longo da envoltória (que é anti-horária em coordenadas de tela com y para baixo → horária visual)
  const idx = [A, B, C, D].sort((a, b) => a - b);
  return idx.map((i) => H[i]);
}

/** Reta por mínimos quadrados totais: { px, py (ponto), dx, dy (direção) }. */
function ajustarReta(pts) {
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(ang), dy: Math.sin(ang) };
}
function intersecao(r, s) {
  const det = r.dx * s.dy - r.dy * s.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((s.px - r.px) * s.dy - (s.py - r.py) * s.dx) / det;
  return { x: r.px + t * r.dx, y: r.py + t * r.dy };
}

/** Homografia do quadrado unitário (0,0)(1,0)(1,1)(0,1) para os 4 cantos. */
export function homografia(Q) {
  const [p0, p1, p2, p3] = Q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x, b = p3.x - p0.x + h * p3.x, c = p0.x;
  const d = p1.y - p0.y + g * p1.y, e = p3.y - p0.y + h * p3.y, f = p0.y;
  return (u, v) => { const z = g * u + h * v + 1; return { x: (a * u + b * v + c) / z, y: (d * u + e * v + f) / z }; };
}

function amostra(g, w, h, x, y) {
  const xi = Math.max(0, Math.min(w - 2, Math.floor(x))), yi = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const tx = Math.max(0, Math.min(1, x - xi)), ty = Math.max(0, Math.min(1, y - yi));
  const i = yi * w + xi;
  return (g[i] * (1 - tx) + g[i + 1] * tx) * (1 - ty) + (g[i + w] * (1 - tx) + g[i + w + 1] * tx) * ty;
}

/**
 * Refino subpixel dos 4 lados pela transição de intensidade: em vários pontos
 * de cada lado, o perfil perpendicular entre o preto da borda (dentro) e o
 * branco da margem (fora) cruza a média dos dois exatamente na borda. O
 * contorno do limiar fica ~0,3 px para dentro (o pixel misturado da borda não
 * passa no "média − C"): num marcador de 25 px isso é 2–3% de escala — e de
 * velocidade. Retas pelos pontos de cruzamento → cantos.
 */
function refinarBordas(g, w, h, Q) {
  const cx = (Q[0].x + Q[1].x + Q[2].x + Q[3].x) / 4, cy = (Q[0].y + Q[1].y + Q[2].y + Q[3].y) / 4;
  const retas = [];
  for (let i = 0; i < 4; i++) {
    const A = Q[i], B = Q[(i + 1) % 4];
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    if (L < 8) return null;
    const tx = (B.x - A.x) / L, ty = (B.y - A.y) / L;
    let nx = -ty, ny = tx;
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }     // normal para FORA
    const d = Math.max(1, Math.min(3, (L / 6) * 0.45));
    const pts = [];
    const N = Math.max(6, Math.min(24, Math.round(L / 2)));
    for (let k = 0; k < N; k++) {
      const f = 0.15 + (0.7 * k) / (N - 1);
      const px = A.x + (B.x - A.x) * f, py = A.y + (B.y - A.y) * f;
      const dentro = amostra(g, w, h, px - nx * d, py - ny * d), fora = amostra(g, w, h, px + nx * d, py + ny * d);
      if (fora - dentro < 20) continue;
      const meio = (dentro + fora) / 2;
      // varre de dentro para fora em passos de 0,1 px até cruzar a média
      let ant = dentro, achou = null;
      for (let s = -d + 0.1; s <= d + 1e-9; s += 0.1) {
        const val = amostra(g, w, h, px + nx * s, py + ny * s);
        if (val >= meio) { const fr = (meio - ant) / ((val - ant) || 1); achou = s - 0.1 + 0.1 * fr; break; }
        ant = val;
      }
      if (achou != null) pts.push({ x: px + nx * achou, y: py + ny * achou });
    }
    if (pts.length < 4) return null;
    retas.push(ajustarReta(pts));
  }
  const novos = [];
  for (let i = 0; i < 4; i++) novos.push(intersecao(retas[(i + 3) % 4], retas[i]));
  return novos.every(Boolean) ? novos : null;
}

/** Lê a grade 6×6 do quadrilátero: { borda (pretas na borda), bits (16), contraste }. */
function lerGrade(g, w, h, Q) {
  const H = homografia(Q);
  const cel = [];
  const k = [0.3, 0.5, 0.7];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) {
    let s = 0;
    for (const a of k) for (const b of k) { const p = H((c + a) / 6, (r + b) / 6); s += amostra(g, w, h, p.x, p.y); }
    cel.push(s / 9);
  }
  // limiar de Otsu entre as 36 células
  const ord = cel.slice().sort((a, b) => a - b);
  let melhor = -1, lim = (ord[0] + ord[35]) / 2;
  for (let i = 1; i < 36; i++) {
    const n0 = i, n1 = 36 - i;
    const m0 = ord.slice(0, i).reduce((s, v) => s + v, 0) / n0, m1 = ord.slice(i).reduce((s, v) => s + v, 0) / n1;
    const v = n0 * n1 * (m1 - m0) ** 2;
    if (v > melhor) { melhor = v; lim = (ord[i - 1] + ord[i]) / 2; }
  }
  const borda = [];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) if (r === 0 || r === 5 || c === 0 || c === 5) borda.push(cel[r * 6 + c]);
  const bordaClara = borda.filter((v) => v > lim).length;
  let bits = 0;
  for (let r = 1; r < 5; r++) for (let c = 1; c < 5; c++) bits = (bits << 1) | (cel[r * 6 + c] > lim ? 1 : 0);
  return { bordaClara, bits, contraste: ord[35] - ord[0], lim };
}

/**
 * Detecta marcadores na imagem em cinza `g` (w×h).
 * opts: { roi: {x0,y0,x1,y1} (padrão: imagem toda), ids (Set ou null = todos),
 *         ladoMin (px, padrão 12), janela (px; padrão ~1/12 do menor lado da ROI), C (padrão 7) }
 */
export function detectarAruco(g, w, h, opts = {}) {
  const roi = opts.roi ? {
    x0: Math.max(0, Math.floor(opts.roi.x0)), y0: Math.max(0, Math.floor(opts.roi.y0)),
    x1: Math.min(w, Math.ceil(opts.roi.x1)), y1: Math.min(h, Math.ceil(opts.roi.y1)),
  } : { x0: 0, y0: 0, x1: w, y1: h };
  const rw = roi.x1 - roi.x0, rh = roi.y1 - roi.y0;
  if (rw < 16 || rh < 16) return [];
  const ladoMin = opts.ladoMin || 12;
  const janelas = opts.janela ? [opts.janela] : [Math.max(7, (Math.round(Math.min(rw, rh) / 12) | 1)), Math.max(5, (Math.round(Math.min(rw, rh) / 30) | 1))];
  const C = opts.C == null ? 7 : opts.C;
  const achados = [];
  for (const janela of janelas) {
    const m = limiarAdaptativo(g, w, h, roi, janela, C);
    // anel preto de lado L tem ~ (36−16)/36·L² … L² pixels escuros (depende dos bits)
    const minPx = Math.max(30, 0.25 * ladoMin * ladoMin);
    const maxPx = Math.floor(rw * rh * 0.6);
    const { comps } = componentes(m, rw, rh, minPx, maxPx);
    for (const cp of comps) {
      // pontos extremos por linha e por coluna (superconjunto dos vértices da envoltória)
      const ext = new Map();
      const extC = new Map();
      for (const p of cp.px) {
        const x = p % rw, y = (p - x) / rw;
        const e = ext.get(y);
        if (!e) ext.set(y, [x, x]); else { if (x < e[0]) e[0] = x; if (x > e[1]) e[1] = x; }
        const f = extC.get(x);
        if (!f) extC.set(x, [y, y]); else { if (y < f[0]) f[0] = y; if (y > f[1]) f[1] = y; }
      }
      const pts = [];
      for (const [y, [a, b]] of ext) { pts.push({ x: a, y }, { x: b + 1, y }, { x: a, y: y + 1 }, { x: b + 1, y: y + 1 }); }
      const H = envoltoria(pts);
      const Q = quatroCantos(H);
      if (!Q) continue;
      const aH = Math.abs(areaPoligono(H)), aQ = Math.abs(areaPoligono(Q));
      if (aQ < ladoMin * ladoMin || aQ < 0.88 * aH) continue;          // não é quadrilátero
      const lados = Q.map((p, i) => Math.hypot(Q[(i + 1) % 4].x - p.x, Q[(i + 1) % 4].y - p.y));
      const lmin = Math.min(...lados), lmax = Math.max(...lados);
      if (lmin < ladoMin || lmax > 4 * lmin) continue;
      if (cp.cont < 0.3 * aQ) continue;                                 // anel fino demais: não é a borda de um marcador
      // refino: reta ajustada aos pixels de borda externa perto de cada lado
      const bordaPts = [];
      for (const [y, [a, b]] of ext) { bordaPts.push({ x: a, y: y + 0.5 }, { x: b + 1, y: y + 0.5 }); }
      for (const [x, [a, b]] of extC) { bordaPts.push({ x: x + 0.5, y: a }, { x: x + 0.5, y: b + 1 }); }
      const tol = Math.max(1.5, lmin * 0.06);
      const retas = [];
      for (let i = 0; i < 4; i++) {
        const A = Q[i], B = Q[(i + 1) % 4];
        const L = Math.hypot(B.x - A.x, B.y - A.y);
        const sel = bordaPts.filter((p) => {
          const t = ((p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y)) / (L * L);
          return t > 0.12 && t < 0.88 && Math.abs(distReta(p, A, B)) < tol;
        });
        retas.push(sel.length >= 4 ? ajustarReta(sel) : null);
      }
      let R = Q;
      if (retas.every(Boolean)) {
        const novos = [];
        for (let i = 0; i < 4; i++) novos.push(intersecao(retas[(i + 3) % 4], retas[i]));
        if (novos.every((p, i) => p && Math.hypot(p.x - Q[i].x, p.y - Q[i].y) < Math.max(3, lmin * 0.15))) R = novos;
      }
      R = R.map((p) => ({ x: p.x + roi.x0, y: p.y + roi.y0 }));
      const fino = refinarBordas(g, w, h, R);
      if (fino && fino.every((p, i) => Math.hypot(p.x - R[i].x, p.y - R[i].y) < Math.max(2, lmin * 0.1))) R = fino;
      const grade = lerGrade(g, w, h, R);
      if (grade.contraste < 30 || grade.bordaClara > 1) continue;
      const id = identificar(grade.bits, opts.maxErros == null ? 1 : opts.maxErros);
      if (!id) continue;
      if (opts.ids && !opts.ids.has(id.id)) continue;
      // canto 0 = canto superior esquerdo do marcador canônico
      let cantos = R.slice();
      if (id.espelhado) {
        // leitura espelhada: a ordem dos cantos inverte (0↔1, 3↔2) antes da rotação
        cantos = [R[1], R[0], R[3], R[2]];
      }
      for (let k = 0; k < id.rot; k++) cantos = [cantos[3], cantos[0], cantos[1], cantos[2]];
      const centro = intersecao(
        { px: cantos[0].x, py: cantos[0].y, dx: cantos[2].x - cantos[0].x, dy: cantos[2].y - cantos[0].y },
        { px: cantos[1].x, py: cantos[1].y, dx: cantos[3].x - cantos[1].x, dy: cantos[3].y - cantos[1].y },
      ) || { x: (R[0].x + R[2].x) / 2, y: (R[0].y + R[2].y) / 2 };
      const ls = cantos.map((p, i) => Math.hypot(cantos[(i + 1) % 4].x - p.x, cantos[(i + 1) % 4].y - p.y));
      // escala: o maior dos dois pares de lados opostos. Marcador girado fora do
      // plano (barra não perpendicular à câmera) encurta UMA das direções; a
      // outra continua com o tamanho real
      const ladoEscala = Math.max((ls[0] + ls[2]) / 2, (ls[1] + ls[3]) / 2);
      const novo = { id: id.id, cantos, centro, lado: ls.reduce((s, v) => s + v, 0) / 4, ladoEscala, erros: id.erros, espelhado: id.espelhado };
      if (!achados.some((a) => a.id === novo.id && Math.hypot(a.centro.x - novo.centro.x, a.centro.y - novo.centro.y) < novo.lado * 0.5)) achados.push(novo);
    }
    if (achados.length) break;
  }
  return achados;
}
