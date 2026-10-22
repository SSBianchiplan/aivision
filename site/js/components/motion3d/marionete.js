/**
 * components/motion3d/marionete.js — IMAGEM → MOVIMENTO 2D (Motion 3D Studio v2, CV-88).
 *
 * Uma foto, um desenho ou um personagem vira uma marionete que se move com a captura:
 *   1. recorte: a máscara (BiRefNet do iaVision, ajustável a pincel) vira o canal alfa;
 *   2. esqueleto: 13 juntas (nariz, ombros, cotovelos, punhos, quadris, joelhos, tornozelos) —
 *      detectadas pela pose do iaVision na imagem ou postas à mão, sempre arrastáveis;
 *   3. malha: grade triangulada que cobre a silhueta (só células com tinta), conectada só por
 *      onde a figura é contínua — braço colado ao tronco não "gruda" se houver fundo entre eles;
 *   4. pesos: distância GEODÉSICA (caminho pela malha, Dijkstra) de cada vértice a cada osso,
 *      w ∝ 1/d⁴, os 3 maiores — o braço segue o braço mesmo encostado no corpo;
 *   5. deformação: skinning linear 2D (LBS), só entre ossos vizinhos na árvore, com as "costuras"
 *      entre partes distantes (braço × tronco) cortadas da malha. Cada osso tem rotação + translação: a direção vem
 *      da captura (projeção frontal dos 33 pontos 3D: x = esquerda da pessoa = direita da
 *      imagem, y para cima), o comprimento é o da marionete (cinemática direta a partir do
 *      quadril). Sem estiramento, a malha não rasga; a conferência conta triângulos invertidos
 *      e o maior estiramento de aresta.
 * Puro (montarMalha, pesosGeodesicos, poseMarionete, deformar) + o renderizador three.js.
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';

/** Juntas editáveis (índices do BlazePose) e rótulos. */
export const JUNTAS_2D = [[0, 'nariz'], [11, 'ombro esq.'], [12, 'ombro dir.'], [13, 'cotovelo esq.'], [14, 'cotovelo dir.'], [15, 'punho esq.'], [16, 'punho dir.'],
  [23, 'quadril esq.'], [24, 'quadril dir.'], [25, 'joelho esq.'], [26, 'joelho dir.'], [27, 'tornozelo esq.'], [28, 'tornozelo dir.']];
/** Pontos derivados: 'Q' = centro do quadril, 'O' = centro dos ombros. */
const pt = (J, k) => (k === 'Q' ? meio(J[23], J[24]) : k === 'O' ? meio(J[11], J[12]) : J[k]);
function meio(a, b) { return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null; }
/**
 * Ossos [nome, de, para, pai, prolongar]: árvore a partir do centro do quadril. `prolongar`
 * estende o osso além da junta final (mão, pé, cabeça) para cobrir a ponta da figura.
 */
export const OSSOS_2D = [
  ['tronco', 'Q', 'O', null, 0], ['cabeca', 'O', 0, 'tronco', 0.9],
  ['ombroE', 'O', 11, 'tronco', 0], ['bracoE', 11, 13, 'ombroE', 0], ['antebracoE', 13, 15, 'bracoE', 0.45],
  ['ombroD', 'O', 12, 'tronco', 0], ['bracoD', 12, 14, 'ombroD', 0], ['antebracoD', 14, 16, 'bracoD', 0.45],
  ['quadrilE', 'Q', 23, null, 0], ['coxaE', 23, 25, 'quadrilE', 0], ['canelaE', 25, 27, 'coxaE', 0.3],
  ['quadrilD', 'Q', 24, null, 0], ['coxaD', 24, 26, 'quadrilD', 0], ['canelaD', 26, 28, 'coxaD', 0.3],
];

/**
 * Esqueleto padrão dentro da caixa da figura (quando a pose não acha ninguém: desenho,
 * mascote): figura de frente, braços um pouco abertos. `cx` etc. em px da imagem.
 */
export function esqueletoPadrao(x1, y1, x2, y2) {
  const w = x2 - x1, h = y2 - y1, cx = (x1 + x2) / 2, Y = (f) => y1 + h * f, X = (f) => cx + w * f;
  // a esquerda da pessoa fica à DIREITA da imagem (figura de frente)
  return { 0: [cx, Y(0.08)], 11: [X(0.17), Y(0.2)], 12: [X(-0.17), Y(0.2)], 13: [X(0.28), Y(0.36)], 14: [X(-0.28), Y(0.36)], 15: [X(0.33), Y(0.5)], 16: [X(-0.33), Y(0.5)],
    23: [X(0.09), Y(0.52)], 24: [X(-0.09), Y(0.52)], 25: [X(0.1), Y(0.72)], 26: [X(-0.1), Y(0.72)], 27: [X(0.1), Y(0.93)], 28: [X(-0.1), Y(0.93)] };
}

/** Caixa da tinta (alfa > lim) numa máscara w×h. */
export function caixaMascara(alfa, w, h, lim = 0.5) {
  let x1 = w, y1 = h, x2 = -1, y2 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alfa[y * w + x] > lim) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  return x2 < 0 ? null : { x1, y1, x2, y2 };
}

/**
 * Malha em grade que cobre a silhueta: célula entra se alguma de 3×3 amostras dela tem tinta.
 * Devolve { V (Float32Array x,y px), T (Uint32Array), n, passo }.
 */
export function montarMalha(alfa, w, h, passo = 8, lim = 0.35) {
  const nx = Math.ceil(w / passo), ny = Math.ceil(h / passo);
  const dentro = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let ok = 0;
    for (let a = 0; a < 3 && !ok; a++) for (let b = 0; b < 3 && !ok; b++) {
      const x = Math.min(w - 1, Math.floor((i + (a + 0.5) / 3) * passo)), y = Math.min(h - 1, Math.floor((j + (b + 0.5) / 3) * passo));
      if (alfa[y * w + x] > lim) ok = 1;
    }
    dentro[j * nx + i] = ok;
  }
  const idx = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  const V = [], T = [];
  const v = (i, j) => { const k = j * (nx + 1) + i; if (idx[k] < 0) { idx[k] = V.length / 2; V.push(Math.min(w, i * passo), Math.min(h, j * passo)); } return idx[k]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!dentro[j * nx + i]) continue;
    const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
    T.push(a, b, c, a, c, d);
  }
  return { V: new Float32Array(V), T: new Uint32Array(T), n: V.length / 2, passo };
}

/** Distância de p ao segmento ab. */
function distSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

/** Segmentos de repouso dos ossos (com o prolongamento das pontas), em px. */
export function segmentosRepouso(J) {
  const segs = [];
  for (const [nome, de, para, , prol] of OSSOS_2D) {
    const a = pt(J, de), b = pt(J, para);
    if (!a || !b) { segs.push(null); continue; }
    const e = [b[0] + (b[0] - a[0]) * prol, b[1] + (b[1] - a[1]) * prol];
    segs.push({ nome, a, b, e });
  }
  return segs;
}

/**
 * Pesos geodésicos: Dijkstra pela malha a partir dos vértices junto de cada osso.
 * Devolve { I (Uint8Array n×3 ossos), Wt (Float32Array n×3 pesos) }.
 */
export function pesosGeodesicos(malha, J) {
  const { V, T, n, passo } = malha;
  const segs = segmentosRepouso(J);
  // vizinhança (arestas dos triângulos)
  const viz = Array.from({ length: n }, () => []);
  const liga = (a, b) => { if (!viz[a].includes(b)) { viz[a].push(b); viz[b].push(a); } };
  for (let k = 0; k < T.length; k += 3) { liga(T[k], T[k + 1]); liga(T[k + 1], T[k + 2]); liga(T[k + 2], T[k]); }
  const nb = OSSOS_2D.length;
  const dist = new Float32Array(n * nb).fill(Infinity);
  const heap = new Heap();
  segs.forEach((s, b) => {
    if (!s) return;
    let semente = false;
    const d0 = new Float32Array(n);
    let melhor = -1, dm = Infinity;
    for (let i = 0; i < n; i++) {
      const d = distSeg(V[2 * i], V[2 * i + 1], s.a, s.e);
      d0[i] = d;
      if (d < dm) { dm = d; melhor = i; }
      if (d <= passo * 0.9) { dist[i * nb + b] = d; heap.push(d, i); semente = true; }
    }
    if (!semente && melhor >= 0) { dist[melhor * nb + b] = dm; heap.push(dm, melhor); }
    while (heap.n) {
      const [d, i] = heap.pop();
      if (d > dist[i * nb + b]) continue;
      for (const j of viz[i]) {
        const nd = d + Math.hypot(V[2 * i] - V[2 * j], V[2 * i + 1] - V[2 * j + 1]);
        if (nd < dist[j * nb + b]) { dist[j * nb + b] = nd; heap.push(nd, j); }
      }
    }
    // pedaço desconectado da malha (traço solto): distância euclidiana, penalizada
    for (let i = 0; i < n; i++) if (!Number.isFinite(dist[i * nb + b])) dist[i * nb + b] = d0[i] * 3 + passo * 4;
  });
  const I = new Uint8Array(n * 3), Wt = new Float32Array(n * 3);
  const ordem = new Array(nb);
  const HOPS = saltosOssos();
  for (let i = 0; i < n; i++) {
    for (let b = 0; b < nb; b++) ordem[b] = b;
    ordem.sort((x, y) => dist[i * nb + x] - dist[i * nb + y]);
    let soma = 0;
    const w = [0, 0, 0];
    // só o osso dominante e os VIZINHOS dele na árvore influenciam o vértice (um braço encostado no
    // tronco não puxa pele da coxa; evita dobras e rasgos no LBS)
    for (let k = 0; k < 3; k++) { const d = dist[i * nb + ordem[k]]; w[k] = segs[ordem[k]] && HOPS[ordem[0]][ordem[k]] <= 1 ? 1 / Math.pow(d + passo * 0.75, 4) : 0; soma += w[k]; }
    for (let k = 0; k < 3; k++) { I[i * 3 + k] = ordem[k]; Wt[i * 3 + k] = soma > 0 ? w[k] / soma : k === 0 ? 1 : 0; }
  }
  return { I, Wt };
}

class Heap {
  constructor() { this.d = []; this.n = 0; }
  push(p, v) { const d = this.d; d[this.n] = [p, v]; let i = this.n++; while (i > 0) { const pa = (i - 1) >> 1; if (d[pa][0] <= d[i][0]) break; [d[pa], d[i]] = [d[i], d[pa]]; i = pa; } }
  pop() {
    const d = this.d, top = d[0]; this.n--;
    if (this.n > 0) { d[0] = d[this.n]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.n && d[l][0] < d[m][0]) m = l; if (r < this.n && d[r][0] < d[m][0]) m = r; if (m === i) break; [d[m], d[i]] = [d[i], d[m]]; i = m; } }
    return top;
  }
}

/**
 * Pose da marionete a partir da captura. `W` = 33 pontos 3D (robo) ou null; `J` = juntas de
 * repouso; `desl` = deslocamento da raiz (px). Devolve, por osso, a transformação 2D
 * { c, s (cos/sen do giro), ax, ay (junta de repouso), bx, by (junta nova) } e as juntas novas.
 */
export function poseMarionete(J, W, desl = [0, 0], dirsAnt = null) {
  const segs = segmentosRepouso(J);
  const novo = {}, tr = [];
  const raiz = pt(J, 'Q');
  const dirs = {};
  // direção de cada osso na captura, no plano da imagem (x à direita = esquerda da pessoa; y para baixo)
  const C = (k) => { if (!W) return null; if (k === 'Q') return W[23] && W[24] ? [(W[23][0] + W[24][0]) / 2, (W[23][1] + W[24][1]) / 2] : null; if (k === 'O') return W[11] && W[12] ? [(W[11][0] + W[12][0]) / 2, (W[11][1] + W[12][1]) / 2] : null; return W[k] ? [W[k][0], W[k][1]] : null; };
  OSSOS_2D.forEach(([nome, de, para]) => {
    const a = C(de), b = C(para);
    if (a && b) { const dx = b[0] - a[0], dy = -(b[1] - a[1]), L = Math.hypot(dx, dy); if (L > 1e-4) dirs[nome] = [dx / L, dy / L]; }
    if (!dirs[nome] && dirsAnt && dirsAnt[nome]) dirs[nome] = dirsAnt[nome];
  });
  const pos = { Q: raiz ? [raiz[0] + desl[0], raiz[1] + desl[1]] : null };
  OSSOS_2D.forEach(([nome, de, para, pai], k) => {
    const s = segs[k];
    if (!s) { tr.push(null); return; }
    const a0 = s.a, b0 = s.b;
    const a1 = pos[de] || [a0[0] + desl[0], a0[1] + desl[1]];
    const L = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
    const ang0 = Math.atan2(b0[1] - a0[1], b0[0] - a0[0]);
    let ang;
    if (dirs[nome]) ang = Math.atan2(dirs[nome][1], dirs[nome][0]);
    else {
      // sem dado: o giro do pai
      const tp = pai ? tr[OSSOS_2D.findIndex((o) => o[0] === pai)] : null;
      ang = ang0 + (tp ? tp.giro : 0);
    }
    const giro = ang - ang0;
    const b1 = [a1[0] + Math.cos(ang) * L, a1[1] + Math.sin(ang) * L];
    if (pos[para] === undefined) pos[para] = b1;
    tr.push({ c: Math.cos(giro), s: Math.sin(giro), giro, ax: a0[0], ay: a0[1], bx: a1[0], by: a1[1] });
  });
  for (const [k] of JUNTAS_2D) novo[k] = pos[k] || null;
  return { tr, juntas: novo, dirs };
}

/** Distância (em saltos) entre os ossos na árvore OSSOS_2D. */
let _saltos = null;
export function saltosOssos() {
  if (_saltos) return _saltos;
  const n = OSSOS_2D.length, idx = Object.fromEntries(OSSOS_2D.map((o, i) => [o[0], i]));
  const viz = Array.from({ length: n }, () => new Set());
  OSSOS_2D.forEach(([, , , pai], i) => { if (pai) { viz[i].add(idx[pai]); viz[idx[pai]].add(i); } });
  // os dois "quadris" e o tronco nascem do centro do quadril: vizinhos entre si
  for (const a of ['tronco', 'quadrilE', 'quadrilD']) for (const b of ['tronco', 'quadrilE', 'quadrilD']) if (a !== b) viz[idx[a]].add(idx[b]);
  _saltos = Array.from({ length: n }, (_, a) => {
    const d = new Array(n).fill(99); d[a] = 0; const fila = [a];
    while (fila.length) { const u = fila.shift(); for (const v of viz[u]) if (d[v] > d[u] + 1) { d[v] = d[u] + 1; fila.push(v); } }
    return d;
  });
  return _saltos;
}

/**
 * Corta da malha os triângulos que ligam partes do corpo distantes na árvore (braço × tronco,
 * perna × perna): a grade pode "costurar" o vão entre o braço e o corpo e, ao levantar o braço,
 * esse triângulo estica 20× e vira. O vão é transparente na textura: cortar não aparece.
 */
export function cortarCosturas(malha, pesos) {
  const H = saltosOssos(), T = malha.T, ok = [];
  for (let k = 0; k < T.length; k += 3) {
    const b = [T[k], T[k + 1], T[k + 2]].map((v) => pesos.I[v * 3]);
    if (H[b[0]][b[1]] <= 1 && H[b[1]][b[2]] <= 1 && H[b[0]][b[2]] <= 1) ok.push(T[k], T[k + 1], T[k + 2]);
  }
  return { ...malha, T: new Uint32Array(ok) };
}

/** LBS 2D: posições deformadas (Float32Array 2n) de todos os vértices. */
export function deformar(malha, pesos, tr, out = null) {
  const { V, n } = malha, { I, Wt } = pesos;
  const o = out || new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = V[2 * i], y = V[2 * i + 1];
    let X = 0, Y = 0, ws = 0;
    for (let k = 0; k < 3; k++) {
      const w = Wt[i * 3 + k]; if (!w) continue;
      const t = tr[I[i * 3 + k]]; if (!t) continue;
      const dx = x - t.ax, dy = y - t.ay;
      X += w * (t.bx + t.c * dx - t.s * dy); Y += w * (t.by + t.s * dx + t.c * dy); ws += w;
    }
    o[2 * i] = ws ? X / ws : x; o[2 * i + 1] = ws ? Y / ws : y;
  }
  return o;
}

/** Conferência "sem rasgar": triângulos invertidos e o maior estiramento de aresta. */
export function conferirMalha(malha, P) {
  const { V, T } = malha;
  let inv = 0, maxE = 1, area0 = 0, area1 = 0;
  for (let k = 0; k < T.length; k += 3) {
    const [a, b, c] = [T[k], T[k + 1], T[k + 2]];
    const ar = (X) => (X[2 * b] - X[2 * a]) * (X[2 * c + 1] - X[2 * a + 1]) - (X[2 * b + 1] - X[2 * a + 1]) * (X[2 * c] - X[2 * a]);
    const A0 = ar(V), A1 = ar(P);
    area0 += Math.abs(A0); area1 += Math.abs(A1);
    if (A0 * A1 < 0) inv++;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const l0 = Math.hypot(V[2 * u] - V[2 * v], V[2 * u + 1] - V[2 * v + 1]), l1 = Math.hypot(P[2 * u] - P[2 * v], P[2 * u + 1] - P[2 * v + 1]);
      if (l0 > 0) maxE = Math.max(maxE, l1 / l0);
    }
  }
  return { triangulos: T.length / 3, invertidos: inv, fracInvertidos: inv / Math.max(1, T.length / 3), maxEstiramento: +maxE.toFixed(2), razaoArea: +(area1 / Math.max(1, area0)).toFixed(3) };
}

/** Imagem + alfa → canvas RGBA (a textura da marionete). */
export function canvasRecortado(img, alfa, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) d.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, alfa[i])) * 255);
  g.putImageData(d, 0, 0);
  return c;
}

/**
 * O palco da marionete (three.js, câmera ortográfica): textura recortada sobre a malha
 * deformada. Fundo transparente (PNG com alfa) ou cor; render sob demanda.
 */
export class PalcoMarionete {
  constructor(host) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, premultipliedAlpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0);
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    this.renderer.domElement.setAttribute('aria-label', 'Marionete 2D');
    host.appendChild(this.renderer.domElement);
    this.cena = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
    this.fundo = null;
    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(host);
    this.redimensionar();
  }
  /** Monta a malha texturizada. `tex` = canvas recortado, `malha` de montarMalha. */
  montar(tex, malha, w, h) {
    if (this.mesh) { this.cena.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose(); }
    this.w = w; this.h = h; this.malha = malha;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(malha.n * 3), uv = new Float32Array(malha.n * 2);
    for (let i = 0; i < malha.n; i++) { pos[3 * i] = malha.V[2 * i]; pos[3 * i + 1] = -malha.V[2 * i + 1]; uv[2 * i] = malha.V[2 * i] / w; uv[2 * i + 1] = 1 - malha.V[2 * i + 1] / h; }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(malha.T, 1));
    const t = new THREE.CanvasTexture(tex); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, alphaTest: 0.02 }));
    this.cena.add(this.mesh);
    this.enquadrar();
    this.render();
  }
  /** Enquadra a imagem com folga (a marionete pode sair da caixa original ao se mover). */
  enquadrar(folga = 0.25) {
    if (!this.w) return;
    const cw = this._fixo ? this._fixo[0] : this.host.clientWidth || 1, ch = this._fixo ? this._fixo[1] : this.host.clientHeight || 1;
    let W = this.w * (1 + folga), H = this.h * (1 + folga);
    if (W / H > cw / ch) H = (W * ch) / cw; else W = (H * cw) / ch;
    const cx = this.w / 2, cy = -this.h / 2;
    Object.assign(this.camera, { left: cx - W / 2, right: cx + W / 2, top: cy + H / 2, bottom: cy - H / 2 });
    this.camera.updateProjectionMatrix();
  }
  definirFundo(cor) { this.fundo = cor; if (cor == null) { this.renderer.setClearColor(0x000000, 0); this.cena.background = null; } else this.cena.background = new THREE.Color(cor); this.render(); }
  atualizar(P) {
    if (!this.mesh) return;
    const a = this.mesh.geometry.attributes.position;
    for (let i = 0; i < this.malha.n; i++) { a.array[3 * i] = P[2 * i]; a.array[3 * i + 1] = -P[2 * i + 1]; }
    a.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
    this.render();
  }
  render() { this.renderer.render(this.cena, this.camera); }
  redimensionar() { if (this._fixo) return; const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1; this.renderer.setSize(w, h, false); this.enquadrar(); this.render(); }
  /** Tamanho fixo (exportação): devolve a função de volta ao tamanho do host. */
  tamanhoFixo(w, h) {
    this._fixo = [w, h];
    this.renderer.setPixelRatio(1); this.renderer.setSize(w, h, false);
    this.enquadrar();
    return () => { this._fixo = null; this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); this.redimensionar(); };
  }
  get canvas() { return this.renderer.domElement; }
  destruir() {
    this.ro.disconnect();
    if (this.mesh) { this.mesh.geometry.dispose(); this.mesh.material.map.dispose(); this.mesh.material.dispose(); }
    this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
