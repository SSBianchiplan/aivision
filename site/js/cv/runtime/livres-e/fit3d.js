/**
 * cv/runtime/livres-e/fit3d.js — Bike Fit 3D (protótipo): só matemática.
 *
 * Nada aqui toca em DOM, canvas ou modelo; os testes no node exercitam tudo.
 * Entra: pontos da pose (BlazePose, 33 landmarks, em PIXELS de cada vista) e
 * os cliques de calibração. Sai: esqueleto 3D no sistema da bicicleta,
 * ângulos 3D, deslocamento lateral do joelho e alinhamento.
 *
 * ======================= SISTEMA DA BICICLETA =======================
 *
 *   origem   "ponto baixo" do quadro clicado (o movimento central)
 *   X        ao longo da bicicleta, do eixo traseiro para o dianteiro (frente +)
 *   Y        vertical, para cima (perpendicular à linha dos eixos)
 *   Z        lateral, para a DIREITA do ciclista (X × Y = Z, mão direita)
 *   unidade  cm
 *
 * ========================= CALIBRAÇÃO =========================
 *
 * Os 5 pontos da Velogic (mesa = parafuso da caixa de direção, centro do
 * selim, ponto baixo do quadro, eixo dianteiro, eixo traseiro) são clicados
 * na imagem de cada vista, em vez de tocados com o bastão.
 *
 * LATERAL. Os 5 pontos estão no plano médio da bicicleta (Z = 0), todos à
 * mesma distância da câmera, então o que os cliques determinam é uma
 * SEMELHANÇA (rotação + escala + origem): X segue a linha dos eixos (corrige
 * o rolar da câmera e o "pitch" da bike no rolo, supondo eixos na mesma
 * altura), a escala vem do entre-eixos informado em cm. Uma homografia
 * precisaria de 4 pontos com coordenadas conhecidas no plano — os cliques
 * só fixam uma distância —, e com a câmera perpendicular (como a Velogic
 * exige) a diferença é desprezível. O que a semelhança NÃO corrige é a
 * perspectiva fora do plano: a perna do lado da câmera está ~10–15 cm mais
 * perto e aparece ~6% maior a 2 m. Isso é corrigido com o Z vindo da vista
 * frontal e a distância câmera–plano (modelo pinhole, centro óptico no
 * centro da imagem):  Q = C + (Q_plano − C)·(D − δ)/D, δ = Z para o lado da câmera.
 *
 * FRONTAL. Câmera pinhole à distância D do movimento central, olhando ao
 * longo de X. As alturas Y e as posições X dos 5 pontos vêm da lateral
 * calibrada; com elas se ajusta, por mínimos quadrados:
 *   rolar   direção "para cima" média de (eixo dianteiro→mesa) e (ponto baixo→selim)
 *   f, h    −y'·prof = f·Y − f·h            (y' relativo ao centro, já sem rolar)
 *   D       entra na mesma equação (prof = D ∓ X); estimado se não informado
 *   c, ψ    x'·prof/f = c + X·sen ψ         (deslocamento e guinada da bike)
 * e o Z de uma articulação é  Z = σ·(x'·prof/f − c − X·sen ψ)/cos ψ,
 * σ = −1 com a câmera à frente (a direita do ciclista aparece à esquerda).
 *
 * ============================ FUSÃO ============================
 *
 * X e Y vêm da lateral (lado da câmera, que o BlazePose vê de verdade); Z
 * vem da frontal para ombro, cotovelo, punho, quadril, joelho, tornozelo,
 * calcanhar e pé, dos dois lados. As duas vistas raramente são
 * sincronizadas (dois vídeos, duas webcams USB, inferência alternada), então
 * o padrão é casar pela FASE DA PEDALADA:
 *   lateral   fase geométrica: ângulo do eixo do pedal estimado em volta do
 *             movimento central calibrado (0° = pedal em cima, 90° = à frente).
 *   frontal   o pé não mostra o ângulo do pedivela; a fase sai dos picos de
 *             altura do pé (PMS) interpolados no tempo, e o deslocamento entre
 *             "pé mais alto" e "pedal em cima" é medido na própria lateral.
 * Cada vista vira um CICLO MÉDIO (36 faixas de 10°); a fusão é faixa a
 * faixa. Com câmeras sincronizadas pode-se casar pelo TEMPO (relógio do
 * navegador + deslocamento). O lado oposto à câmera lateral vem da segunda
 * lateral, se houver; senão, da perna do lado da câmera defasada 180°
 * (pedalada simétrica) e com o Z próprio medido na frontal.
 */
import { LM, angulo3, pontoPedal, indicesPerto, medirLateral } from './bikefit.js';

export const PARTES = ['ombro', 'cotovelo', 'punho', 'quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'];
export const PERNA = ['quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'];
export const BRACO = ['ombro', 'cotovelo', 'punho'];

/** Os 5 pontos de referência da Velogic, na ordem dos cliques. */
export const PONTOS_REF = [
  { k: 'mesa', nome: 'Mesa', dica: 'parafuso da tampa da caixa de direção (centro)' },
  { k: 'selim', nome: 'Selim', dica: 'centro do selim (meio do comprimento, em cima)' },
  { k: 'baixo', nome: 'Ponto baixo', dica: 'movimento central (eixo do pedivela), na linha média do quadro' },
  { k: 'eixoD', nome: 'Eixo dianteiro', dica: 'centro do cubo da roda da frente' },
  { k: 'eixoT', nome: 'Eixo traseiro', dica: 'centro do cubo da roda de trás' },
];

const GRAU = 180 / Math.PI;
/** Meio fator Q típico (pé ↔ plano médio), cm: só para a perspectiva do pedal na fase. */
export const Z_PE = 8.5;
const vis = (p) => (p && Number.isFinite(p.v) ? p.v : 0);
const outro = (l) => (l === 'e' ? 'd' : 'e');

// ------------------------------------------------------------ vetores 3D
export const v3 = {
  sub: (a, b) => ({ X: a.X - b.X, Y: a.Y - b.Y, Z: a.Z - b.Z }),
  add: (a, b) => ({ X: a.X + b.X, Y: a.Y + b.Y, Z: a.Z + b.Z }),
  mul: (a, k) => ({ X: a.X * k, Y: a.Y * k, Z: a.Z * k }),
  dot: (a, b) => a.X * b.X + a.Y * b.Y + a.Z * b.Z,
  norma: (a) => Math.hypot(a.X, a.Y, a.Z),
  lerp: (a, b, t) => ({ X: a.X + (b.X - a.X) * t, Y: a.Y + (b.Y - a.Y) * t, Z: a.Z + (b.Z - a.Z) * t }),
};

/** Ângulo interno em B (graus, 0..180) entre BA e BC, em 3D. */
export function angulo3D(a, b, c) {
  if (!a || !b || !c) return null;
  const u = v3.sub(a, b), w = v3.sub(c, b);
  const nu = v3.norma(u), nw = v3.norma(w);
  if (!(nu > 1e-9 && nw > 1e-9)) return null;
  return Math.acos(Math.max(-1, Math.min(1, v3.dot(u, w) / (nu * nw)))) * GRAU;
}

/** Inclinação quadril→ombro sobre o plano horizontal (XZ), graus. */
export function troncoInclinacao3D(quadril, ombro) {
  if (!quadril || !ombro) return null;
  const d = v3.sub(ombro, quadril);
  const hz = Math.hypot(d.X, d.Z);
  if (!(Math.hypot(hz, d.Y) > 1e-9)) return null;
  return Math.atan2(d.Y, hz) * GRAU;
}

/** Mínimos quadrados pequeno (equações normais + Gauss com pivô). A: linhas, b: lado direito. */
export function minimosQuadrados(A, b) {
  const n = A[0].length;
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let r = 0; r < A.length; r++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M[i][j] += A[r][i] * A[r][j];
      M[i][n] += A[r][i] * b[r];
    }
  }
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function conferirPontos(p) {
  for (const { k, nome } of PONTOS_REF) {
    if (!p || !p[k] || !Number.isFinite(p[k].x) || !Number.isFinite(p[k].y)) throw new Error(`falta o ponto "${nome}"`);
  }
}

// ------------------------------------------------------------ lateral
/**
 * Calibração da vista lateral. `p` = {mesa, selim, baixo, eixoD, eixoT} em px.
 * opc: entreEixosCm (obrigatório, > 0), larg/alt do quadro, distCm (câmera →
 * plano da bike), espelhada.
 */
export function calibrarLateral(p, { entreEixosCm = 100, larg = 1280, alt = 720, distCm = 200, espelhada = false } = {}) {
  conferirPontos(p);
  if (!(entreEixosCm > 20)) throw new Error('informe o entre-eixos em cm');
  const dx = p.eixoD.x - p.eixoT.x, dy = p.eixoD.y - p.eixoT.y, L = Math.hypot(dx, dy);
  if (!(L > 20)) throw new Error('os eixos estão perto demais na imagem (clique os centros dos cubos)');
  const ex = { x: dx / L, y: dy / L };
  let ey = { x: ex.y, y: -ex.x };
  if (ey.y > 0) ey = { x: -ey.x, y: -ey.y };            // "para cima" na imagem é y negativo
  const cal = {
    tipo: 'lateral', o: { x: p.baixo.x, y: p.baixo.y }, ex, ey, s: entreEixosCm / L,
    larg, alt, distCm: Math.max(50, distCm || 200), espelhada: Boolean(espelhada), entreEixosCm,
  };
  // câmera do lado direito do ciclista ⇔ frente da bike à direita da imagem (sem espelho)
  cal.ladoCamera = (ex.x > 0) !== cal.espelhada ? 'd' : 'e';
  cal.sinal = cal.ladoCamera === 'd' ? 1 : -1;
  cal.centro = paraPlano(cal, larg / 2, alt / 2);
  cal.ref = {};
  for (const { k } of PONTOS_REF) cal.ref[k] = paraPlano(cal, p[k].x, p[k].y);
  // rolar da linha dos eixos em relação à horizontal da imagem (câmera torta + bike inclinada no rolo)
  cal.inclinacao = Math.atan2(-dy, Math.abs(dx)) * GRAU * Math.sign(dx || 1);
  cal.selimMC = Math.hypot(cal.ref.selim.X, cal.ref.selim.Y);   // conferência com a trena
  const avisos = [];
  if (Math.abs(cal.inclinacao) > 5) avisos.push(`A linha dos eixos está inclinada ${cal.inclinacao.toFixed(1)}° na imagem: nivele a câmera ou a bike (a calibração corrige, mas confira os cliques).`);
  if (!(cal.ref.selim.Y > 40)) avisos.push('O selim ficou baixo demais em relação ao ponto baixo: confira os cliques.');
  if (!(cal.ref.mesa.X > cal.ref.selim.X)) avisos.push('A mesa ficou atrás do selim: confira os eixos (dianteiro × traseiro).');
  cal.avisos = avisos;
  return cal;
}

function paraPlano(cal, u, v) {
  const du = u - cal.o.x, dv = v - cal.o.y;
  return { X: cal.s * (du * cal.ex.x + dv * cal.ex.y), Y: cal.s * (du * cal.ey.x + dv * cal.ey.y) };
}

/** px da lateral → bike, com a correção de perspectiva para um ponto a Z do plano médio. */
export function lateralParaBike(cal, u, v, Z = 0) {
  const q = paraPlano(cal, u, v);
  const delta = cal.sinal * (Z || 0);                      // + = mais perto da câmera
  const k = (cal.distCm - delta) / cal.distCm;
  return { X: cal.centro.X + (q.X - cal.centro.X) * k, Y: cal.centro.Y + (q.Y - cal.centro.Y) * k, Z: Z || 0 };
}

/** Inverso (para desenhar no vídeo): bike → px da lateral. */
export function bikeParaLateral(cal, P) {
  const delta = cal.sinal * (P.Z || 0);
  const k = cal.distCm / (cal.distCm - delta);
  const X = cal.centro.X + (P.X - cal.centro.X) * k, Y = cal.centro.Y + (P.Y - cal.centro.Y) * k;
  // inversa da semelhança: (du,dv) = (X·ex + Y·ey)/s
  return { x: cal.o.x + (X * cal.ex.x + Y * cal.ey.x) / cal.s, y: cal.o.y + (X * cal.ex.y + Y * cal.ey.y) / cal.s };
}

/**
 * Círculo pelos pontos (ajuste algébrico de Kåsa). O eixo do pedal estimado
 * (70% do calcanhar à ponta do pé) fica deslocado do eixo real por um vetor
 * quase constante — o pé não gira com o pedivela —, então descreve um círculo
 * do raio do pedivela com centro FORA do movimento central clicado. Medir a
 * fase em volta desse centro tira a distorção (até ±15°) da fase geométrica.
 */
export function ajustarCirculo(pts) {
  if (pts.length < 8) return null;
  const A = [], b = [];
  for (const p of pts) { A.push([p.X, p.Y, 1]); b.push(-(p.X * p.X + p.Y * p.Y)); }
  const s = minimosQuadrados(A, b);
  if (!s) return null;
  const X = -s[0] / 2, Y = -s[1] / 2, r2 = X * X + Y * Y - s[2];
  return r2 > 0 ? { X, Y, r: Math.sqrt(r2) } : null;
}

/** Centro da trajetória do pedal, se ela parece um pedivela (8–30 cm, perto do movimento central). */
export function centroPedal(amostras) {
  const pts = amostras.filter((a) => a.pedal).map((a) => a.pedal);
  if (pts.length < 30) return null;
  const c = ajustarCirculo(pts);
  if (!c || c.r < 8 || c.r > 30 || Math.hypot(c.X, c.Y) > 25) return null;
  return c;
}
const comCentro = (am, c) => (c && am.pedal ? { ...am, fase: fasePedal(am.pedal.X - c.X, am.pedal.Y - c.Y) } : am);

/** Fase do pedivela pelo eixo do pedal em coordenadas da bike (0° = em cima, 90° = à frente). */
export function fasePedal(X, Y) {
  return ((Math.atan2(X, Y) * GRAU) % 360 + 360) % 360;
}

// ------------------------------------------------------------ frontal
/**
 * Calibração da vista frontal. `p` = os 5 pontos em px da frontal; `ref` =
 * cal.ref da lateral (X, Y de cada ponto em cm). opc: larg, alt, distCm (0 =
 * estimar), posicao 'frente' | 'tras', espelhada.
 */
export function calibrarFrontal(p, ref, { larg = 1280, alt = 720, distCm = 0, posicao = 'frente', espelhada = false } = {}) {
  conferirPontos(p);
  if (!ref) throw new Error('calibre a vista lateral primeiro (as alturas vêm dela)');
  const cx = larg / 2, cy = alt / 2;
  const un = (a, b) => { const x = a.x - b.x, y = a.y - b.y, n = Math.hypot(x, y) || 1; return { x: x / n, y: y / n }; };
  const u1 = un(p.mesa, p.eixoD), u2 = un(p.selim, p.baixo);
  const up = { x: u1.x + u2.x, y: u1.y + u2.y };
  const rolar = Math.atan2(up.x, -up.y);                  // 0 = "para cima" da bike é o "para cima" da imagem
  const cal = { tipo: 'frontal', cx, cy, larg, alt, rolar, posicao, espelhada: Boolean(espelhada) };
  cal.sx = posicao === 'tras' ? 1 : -1;                     // profundidade: D ∓ X
  // σ: direção da imagem (direita) em relação a +Z
  cal.sigma = (posicao === 'tras' ? 1 : -1) * (cal.espelhada ? -1 : 1);
  const R = Object.fromEntries(PONTOS_REF.map(({ k }) => [k, girar(cal, p[k].x, p[k].y)]));
  const ks = PONTOS_REF.map((r) => r.k);
  // f, f·h e (opcional) D:  −y'·(D + sx·X) = f·Y − f·h
  let D = distCm > 0 ? distCm : null, f, h, Dest = null;
  {
    const A = [], b = [];
    for (const k of ks) { const y = R[k].y; A.push([-y, -ref[k].Y, 1]); b.push(y * cal.sx * ref[k].X); }
    const s = minimosQuadrados(A, b);
    if (s && s[0] > 60 && s[0] < 1500 && s[1] > 0) Dest = s[0];
  }
  if (D == null) D = Dest || 250;
  {
    const A = [], b = [];
    for (const k of ks) { const y = R[k].y, pr = D + cal.sx * ref[k].X; A.push([ref[k].Y, -1]); b.push(-y * pr); }
    const s = minimosQuadrados(A, b);
    if (!s || !(s[0] > 0)) throw new Error('não deu para ajustar a escala da frontal: confira os cliques');
    f = s[0]; h = s[1] / s[0];
  }
  cal.D = D; cal.Dest = Dest; cal.f = f; cal.h = h;
  // c e sen ψ:  x'·prof/f = c + X·t
  {
    const A = [], b = [];
    for (const k of ks) { const pr = D + cal.sx * ref[k].X; A.push([1, ref[k].X]); b.push((R[k].x * pr) / f); }
    const s = minimosQuadrados(A, b) || [0, 0];
    cal.c = s[0]; cal.t = Math.max(-0.7, Math.min(0.7, s[1]));
  }
  cal.guinada = Math.asin(cal.t) * GRAU;
  // resíduo vertical (cm): qualidade dos cliques
  let soma = 0;
  for (const k of ks) { const pr = D + cal.sx * ref[k].X; soma += (h - (R[k].y * pr) / f - ref[k].Y) ** 2; }
  cal.residuoCm = Math.sqrt(soma / ks.length);
  const avisos = [];
  if (Math.abs(cal.guinada) > 8) avisos.push(`A bike está ${Math.abs(cal.guinada).toFixed(0)}° fora do eixo da câmera frontal: alinhe a câmera com a bike.`);
  if (Math.abs(cal.rolar * GRAU) > 5) avisos.push(`A frontal está girada ${(cal.rolar * GRAU).toFixed(1)}°: nivele a câmera.`);
  if (cal.residuoCm > 3) avisos.push(`Os cliques da frontal não batem com as alturas da lateral (erro ${cal.residuoCm.toFixed(1)} cm): refaça a calibração das duas vistas com o mesmo ponto em cada clique.`);
  cal.avisos = avisos;
  return cal;
}

/** px → coordenadas relativas ao centro, sem o rolar (y para baixo). */
function girar(cal, u, v) {
  const du = u - cal.cx, dv = v - cal.cy, c = Math.cos(-cal.rolar), s = Math.sin(-cal.rolar);
  return { x: du * c - dv * s, y: du * s + dv * c };
}

/** px da frontal → {Y, Z} (cm) para um ponto cuja posição X (cm) é conhecida (≈0 se não for). */
export function frontalParaBike(cal, u, v, X = 0) {
  const r = girar(cal, u, v), pr = cal.D + cal.sx * (X || 0);
  const cosPsi = Math.sqrt(1 - cal.t * cal.t);
  return { Y: cal.h - (r.y * pr) / cal.f, Z: (cal.sigma * ((r.x * pr) / cal.f - cal.c - (X || 0) * cal.t)) / cosPsi };
}

/** Inverso (para desenhar): bike → px da frontal. */
export function bikeParaFrontal(cal, P) {
  const pr = cal.D + cal.sx * P.X, cosPsi = Math.sqrt(1 - cal.t * cal.t);
  const x = ((cal.sigma * P.Z * cosPsi + cal.c + P.X * cal.t) * cal.f) / pr;
  const y = ((cal.h - P.Y) * cal.f) / pr;
  const c = Math.cos(cal.rolar), s = Math.sin(cal.rolar);
  return { x: cal.cx + x * c - y * s, y: cal.cy + x * s + y * c };
}

// ------------------------------------------------------------ amostras
/**
 * Amostra da lateral: resolve o membro do lado da câmera (os rótulos do
 * BlazePose trocam com o ciclista de perfil; a visibilidade não) e calcula a
 * fase. `P` = 33 pontos {x, y, v} em px. `ant` = membros da amostra anterior.
 */
export function amostraLateral(cal, P, t, minVis = 0.5, ant = null) {
  const I = indicesPerto(P, ant);
  const perto = {}, longe = {};
  for (const k of PARTES) {
    const lPerto = BRACO.includes(k) ? I.braco : I.perna;
    const a = P[LM[k][lPerto]], b = P[LM[k][outro(lPerto)]];
    perto[k] = { x: a.x, y: a.y, v: vis(a) };
    longe[k] = { x: b.x, y: b.y, v: vis(b) };
  }
  const ped = vis(P[I.tornozelo]) >= minVis * 0.6 ? pontoPedal(P, I, minVis * 0.6) : null;
  let fase = null, pedal = null;
  // o pé do lado da câmera está ~Q/2 fora do plano médio (mais perto): corrige a perspectiva
  const zPe = cal.sinal * Z_PE;
  if (ped) { pedal = lateralParaBike(cal, ped.x, ped.y, zPe); fase = fasePedal(pedal.X, pedal.Y); }
  const tq = perto.tornozelo.v >= minVis ? lateralParaBike(cal, perto.tornozelo.x, perto.tornozelo.y, zPe).Y : null;
  const ang2d = medirLateral(P, I, minVis).ang;          // os ângulos 2D do Bike Fit, em px crus
  return { t, perto, longe, fase, pedal, tornY: tq, membros: { perna: I.perna, braco: I.braco }, ang2d };
}

/** Amostra da frontal: os pontos do modelo pelos rótulos (e/d do modelo; a troca é decidida na fusão). */
export function amostraFrontal(P, t) {
  const pts = {};
  for (const k of PARTES) for (const l of ['e', 'd']) { const a = P[LM[k][l]]; pts[k + '_' + l] = { x: a.x, y: a.y, v: vis(a) }; }
  return { t, pts };
}

// ------------------------------------------------------------ ciclo
/**
 * PMS (pé no alto) numa série {t, y}: corridas acima do meio da faixa, com
 * histerese de 15% da amplitude; o pico de cada corrida (refinado por
 * parábola) é um PMS. Devolve os tempos.
 */
export function picosAltos(serie) {
  const s = serie.filter((a) => Number.isFinite(a.y));
  if (s.length < 8) return [];
  // suaviza (média de 3)
  const y = s.map((a, i) => (s[Math.max(0, i - 1)].y + a.y + s[Math.min(s.length - 1, i + 1)].y) / 3);
  const ord = [...y].sort((a, b) => a - b);
  const lo = ord[Math.floor(ord.length * 0.05)], hi = ord[Math.floor(ord.length * 0.95)];
  const amp = hi - lo;
  if (!(amp > 1e-6)) return [];
  const meio = (lo + hi) / 2, entra = meio + 0.15 * amp, sai = meio - 0.15 * amp;
  const picos = [];
  let dentro = false, iMax = -1;
  for (let i = 0; i < y.length; i++) {
    if (!dentro && y[i] > entra) { dentro = true; iMax = i; }
    if (dentro) {
      if (y[i] > y[iMax]) iMax = i;
      if (y[i] < sai) {
        dentro = false;
        picos.push(refinarPico(s, y, iMax));
      }
    }
  }
  return picos;
}
function refinarPico(s, y, i) {
  if (i <= 0 || i >= y.length - 1) return s[i].t;
  const a = y[i - 1], b = y[i], c = y[i + 1], den = a - 2 * b + c;
  if (!(Math.abs(den) > 1e-12)) return s[i].t;
  const d = Math.max(-1, Math.min(1, (0.5 * (a - c)) / den));
  return d >= 0 ? s[i].t + d * (s[i + 1].t - s[i].t) : s[i].t + d * (s[i].t - s[i - 1].t);
}

/**
 * Fase (0..360) por interpolação entre picos consecutivos. Com amostragem
 * esparsa (inferência alternada) um pico some de vez em quando e o intervalo
 * vira 2 ou 3 períodos: com o período de referência `Tref` (da lateral), um
 * intervalo que seja múltiplo inteiro dele (±15%) é dividido; o que não for
 * é descartado (null), em vez de esticar a fase.
 */
export function faseEntrePicos(picos, t, Tref = null, maxPeriodoMs = 3000) {
  for (let i = 0; i + 1 < picos.length; i++) {
    if (t >= picos[i] && t < picos[i + 1]) {
      let T = picos[i + 1] - picos[i];
      if (Tref) {
        const k = Math.round(T / Tref);
        if (k < 1 || k > 4 || Math.abs(T / k - Tref) > 0.15 * Tref) return null;
        T /= k;
      } else if (!(T > 200 && T < maxPeriodoMs)) return null;
      return ((360 * (t - picos[i])) / T) % 360;
    }
  }
  return null;
}

/**
 * Cadência pela fase geométrica da lateral: entre amostras próximas (≤ 250 ms)
 * o pedivela anda menos de meia volta, então a diferença de fase não é
 * ambígua. A soma é com sinal, para o tremor não inflar a cadência.
 */
export function cadenciaFase(amostras) {
  let soma = 0, dtSoma = 0;
  for (let i = 1; i < amostras.length; i++) {
    const a = amostras[i - 1], b = amostras[i];
    if (a.fase == null || b.fase == null) continue;
    const dt = b.t - a.t;
    if (!(dt > 0 && dt <= 250)) continue;
    // passo com sinal em (−180, 180]: o tremor da pose para trás e para a frente se cancela
    // |passo| ≥ 150°: o pé seguido trocou de perna (rótulos do BlazePose) — não é giro
    const d = ((b.fase - a.fase + 540) % 360) - 180;
    if (Math.abs(d) >= 150) continue;
    soma += d; dtSoma += dt;
  }
  if (dtSoma < 1500) return null;
  const rpm = (soma / 360) / (dtSoma / 60000);
  return rpm > 20 && rpm < 200 ? rpm : null;
}

/**
 * Cadência pela AUTOCORRELAÇÃO de uma série periódica {t, y} (altura do
 * tornozelo): reamostra numa grade regular (buracos > 3 passos ficam de fora),
 * procura o maior pico da autocorrelação normalizada entre 0,3 e 2 s (30–200
 * rpm) e refina por parábola. Usa todas as pedaladas de uma vez, então
 * tolera pose ruidosa e amostragem esparsa melhor que picos isolados.
 */
export function cadenciaAutocorr(serie) {
  const s = serie.filter((a) => Number.isFinite(a.y)).sort((a, b) => a.t - b.t);
  if (s.length < 20) return null;
  const dts = [];
  for (let i = 1; i < s.length; i++) dts.push(s[i].t - s[i - 1].t);
  dts.sort((a, b) => a - b);
  const dt = Math.max(10, dts[Math.floor(dts.length / 2)]);
  // grade regular por trechos contínuos
  const g = [];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    if (b.t - a.t > 3 * dt) { g.push(null); continue; }
    for (let t = a.t; t < b.t; t += dt) {
      g.push(a.y + ((b.y - a.y) * (t - a.t)) / (b.t - a.t || 1));
    }
  }
  const v = g.filter((x) => x !== null);
  if (v.length < 20) return null;
  const m = v.reduce((x, y) => x + y, 0) / v.length;
  const z = g.map((x) => (x === null ? null : x - m));
  const R = (L) => {
    let num = 0, den = 0, n = 0;
    for (let i = 0; i + L < z.length; i++) {
      const a = z[i], b = z[i + L];
      if (a === null || b === null) continue;
      num += a * b; den += (a * a + b * b) / 2; n++;
    }
    return n > 10 && den > 0 ? num / den : null;
  };
  const L0 = Math.max(1, Math.floor(300 / dt)), L1 = Math.ceil(2000 / dt);
  const r = [];
  for (let L = 0; L <= L1 + 1; L++) r.push(L >= L0 - 1 ? R(L) : null);
  // máximos locais; fica com o PRIMEIRO que chega a 85% do maior (evita 2T, 3T)
  const picos = [];
  for (let L = L0; L <= L1; L++) {
    if (r[L] == null || r[L - 1] == null || r[L + 1] == null) continue;
    if (r[L] >= r[L - 1] && r[L] >= r[L + 1]) picos.push(L);
  }
  if (!picos.length) return null;
  const maior = Math.max(...picos.map((L) => r[L]));
  const best = picos.find((L) => r[L] >= 0.85 * maior);
  if (best < 0 || r[best] < 0.3) return null;
  const a = r[best - 1], b = r[best], c = r[best + 1], den = a - 2 * b + c;
  const d = Math.abs(den) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  const T = (best + d) * dt;
  return 60000 / T;
}

/** Cadência (rpm) pela mediana dos períodos entre picos. */
export function cadenciaPicos(picos) {
  const T = [];
  for (let i = 1; i < picos.length; i++) { const d = picos[i] - picos[i - 1]; if (d > 200 && d < 3000) T.push(d); }
  if (!T.length) return null;
  T.sort((a, b) => a - b);
  return 60000 / T[Math.floor(T.length / 2)];
}

const mediaCircular = (angs) => {
  let s = 0, c = 0;
  for (const a of angs) { s += Math.sin(a / GRAU); c += Math.cos(a / GRAU); }
  return angs.length ? ((Math.atan2(s, c) * GRAU) % 360 + 360) % 360 : null;
};

/**
 * Ciclo médio: média, por faixa de fase, dos pontos com visibilidade.
 * `itens` = [{fase, pts: {chave: {x, y, v}}}]. Faixas vazias são preenchidas
 * pelas vizinhas (interpolação circular). Devolve {n, faixas: [{chave: {x,y,n}}]}.
 */
export function cicloMedio(itens, nFaixas = 36, minVis = 0.5) {
  const larg = 360 / nFaixas;
  const acc = Array.from({ length: nFaixas }, () => ({}));
  let n = 0;
  for (const it of itens) {
    if (it.fase == null) continue;
    n++;
    const b = Math.floor((((it.fase % 360) + 360) % 360) / larg) % nFaixas;
    for (const [k, p] of Object.entries(it.pts)) {
      if (!p || vis(p) < minVis) continue;
      const a = acc[b][k] || (acc[b][k] = { x: 0, y: 0, n: 0 });
      a.x += p.x; a.y += p.y; a.n++;
    }
  }
  const chaves = new Set();
  for (const a of acc) for (const k of Object.keys(a)) chaves.add(k);
  const faixas = acc.map(() => ({}));
  for (const k of chaves) {
    const val = acc.map((a) => (a[k] && a[k].n ? { x: a[k].x / a[k].n, y: a[k].y / a[k].n, n: a[k].n } : null));
    const cheias = val.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    if (!cheias.length) continue;
    for (let i = 0; i < nFaixas; i++) {
      if (val[i]) { faixas[i][k] = val[i]; continue; }
      // vizinhas cheias mais próximas, circular
      let a = null, b = null;
      for (let d = 1; d < nFaixas && (a == null || b == null); d++) {
        if (a == null && val[(i - d + nFaixas) % nFaixas]) a = d;
        if (b == null && val[(i + d) % nFaixas]) b = d;
      }
      if (a == null || b == null || a + b > nFaixas / 3) continue;   // buraco grande: não inventa
      const A = val[(i - a + nFaixas) % nFaixas], B = val[(i + b) % nFaixas], w = a / (a + b);
      faixas[i][k] = { x: A.x + (B.x - A.x) * w, y: A.y + (B.y - A.y) * w, n: 0 };
    }
  }
  return { n, faixas, nFaixas };
}

/** Valor da chave numa fase qualquer (interpolação linear entre centros de faixa). */
export function noCiclo(ciclo, k, fase) {
  const N = ciclo.nFaixas, larg = 360 / N;
  const f = ((((fase - larg / 2) % 360) + 360) % 360) / larg;
  const i = Math.floor(f) % N, j = (i + 1) % N, w = f - Math.floor(f);
  const a = ciclo.faixas[i][k], b = ciclo.faixas[j][k];
  if (a && b) return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
  return a || b || null;
}

/** Interpolação no tempo numa lista de amostras ordenada ({t, pts}); null fora do intervalo ou em buraco > maxGapMs. */
export function noTempo(amostras, k, t, maxGapMs = 250) {
  let lo = 0, hi = amostras.length - 1;
  if (hi < 0 || t < amostras[0].t || t > amostras[hi].t) return null;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (amostras[m].t <= t) lo = m; else hi = m; }
  const A = amostras[lo], B = amostras[hi];
  const a = A.pts[k], b = B.pts[k];
  if (!a || !b || B.t - A.t > maxGapMs) return null;
  const w = B.t > A.t ? (t - A.t) / (B.t - A.t) : 0;
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, v: Math.min(vis(a), vis(b)) };
}

// ------------------------------------------------------------ fusão
const ptsLateral = (am, qual) => Object.fromEntries(PARTES.map((k) => [k, am[qual][k]]));

/**
 * Fusão das vistas. Entra:
 *   calL, calF, calL2   calibrações (calL obrigatória; calF para ter Z)
 *   lat, fro, lat2      listas de amostraLateral / amostraFrontal / amostraLateral
 *   opc                 {sync: 'fase' | 'tempo', offsetMs, minVis, nFaixas}
 * Sai: {faixas: [{fase, esq: {e: {parte: {X,Y,Z}}, d: {...}}, ang: {e, d}, ang2d}],
 *       metricas, trajetorias, ladoCamera, avisos, cadencia}.
 */
export function fundir({ calL, calF = null, calL2 = null, lat: latCru = [], fro = [], lat2: lat2Cru = [], opc = {} }) {
  const centro = centroPedal(latCru), centro2 = centroPedal(lat2Cru);
  const lat = latCru.map((a) => comCentro(a, centro)), lat2 = lat2Cru.map((a) => comCentro(a, centro2));
  const minVis = opc.minVis ?? 0.5, N = opc.nFaixas || 36, sync = opc.sync || 'fase', offset = opc.offsetMs || 0;
  const avisos = [];
  if (!calL) return { faixas: [], avisos: ['Calibre a vista lateral.'], metricas: null };
  const ladoC = calL.ladoCamera, ladoO = outro(ladoC);
  const larg = 360 / N, centros = Array.from({ length: N }, (_, i) => (i + 0.5) * larg);

  // ---- lateral: ciclo médio do lado da câmera (e do lado oposto cru, só como último recurso)
  const itensL = lat.filter((a) => a.fase != null);
  const cicloL = cicloMedio(itensL.map((a) => ({ fase: a.fase, pts: ptsLateral(a, 'perto') })), N, minVis);
  const cicloLlonge = cicloMedio(itensL.map((a) => ({ fase: a.fase, pts: ptsLateral(a, 'longe') })), N, minVis);
  const ang2dCiclo = media2d(itensL, N);
  if (cicloL.n < 20) avisos.push('Poucas amostras da lateral com o pé visível (precisa de algumas pedaladas).');

  // deslocamento entre "pé mais alto" (tornozelo) e "pedal em cima" (geométrico), medido na lateral
  const picosL = picosAltos(lat.map((a) => ({ t: a.t, y: a.tornY })));
  const fasesNoPico = [];
  for (const tp of picosL) {
    let melhor = null;
    for (const a of lat) if (a.fase != null && (!melhor || Math.abs(a.t - tp) < Math.abs(melhor.t - tp))) melhor = a;
    if (melhor && Math.abs(melhor.t - tp) < 120) fasesNoPico.push(melhor.fase);
  }
  const fasePicoTorn = mediaCircular(fasesNoPico) ?? 0;

  // ---- frontal
  let cicloF = null, trocar = false, cadF = null;
  if (calF && fro.length) {
    // rótulos do modelo × lado anatômico: o quadril "d" tem de ficar em Z > 0
    let zd = 0, ze = 0, nz = 0;
    for (const a of fro) {
      const qd = a.pts.quadril_d, qe = a.pts.quadril_e;
      if (vis(qd) >= minVis && vis(qe) >= minVis) {
        zd += frontalParaBike(calF, qd.x, qd.y, 0).Z; ze += frontalParaBike(calF, qe.x, qe.y, 0).Z; nz++;
      }
    }
    trocar = nz > 0 && zd < ze;
    const chave = (k, l) => `${k}_${trocar ? outro(l) : l}`;
    const anat = (a) => {
      const o = {};
      for (const k of PARTES) for (const l of ['e', 'd']) o[`${k}_${l}`] = a.pts[chave(k, l)];
      return o;
    };
    // fase: picos de altura do tornozelo do MESMO lado anatômico da lateral
    const serie = fro.map((a) => {
      const p = a.pts[chave('tornozelo', ladoC)];
      return { t: a.t, y: vis(p) >= minVis ? frontalParaBike(calF, p.x, p.y, 0).Y : NaN };
    });
    const picosF = picosAltos(serie);
    cadF = cadenciaPicos(picosF);
    // período de referência para dividir intervalos de 2–3 pedaladas: autocorrelação da
    // própria frontal; senão a da lateral
    const cadRef = cadenciaAutocorr(serie) || cadenciaAutocorr(lat.map((a) => ({ t: a.t, y: a.tornY })));
    const Tref = cadRef ? 60000 / cadRef : (cadF ? 60000 / cadF : null);
    const itensF = [];
    for (const a of fro) {
      const f = faseEntrePicos(picosF, a.t, Tref);
      itensF.push({ t: a.t, fase: f == null ? null : (f + fasePicoTorn) % 360, pts: anat(a) });
    }
    cicloF = cicloMedio(itensF, N, minVis);
    cicloF.itens = itensF;
    if (cicloF.n < 20) avisos.push('Poucas pedaladas completas na frontal (a fase sai dos picos do pé).');
  } else if (!calF) {
    avisos.push('Sem a vista frontal calibrada: Z = 0 (o esqueleto fica no plano da bike, como no 2D).');
  }

  // ---- segunda lateral (lado oposto)
  let cicloL2 = null;
  if (calL2 && lat2.length) {
    if (calL2.ladoCamera === ladoC) avisos.push('As duas laterais parecem estar do mesmo lado (confira o espelho de cada uma).');
    // fase da segunda lateral é do pé do outro lado: soma 180° para a fase do lado principal
    cicloL2 = cicloMedio(lat2.filter((a) => a.fase != null).map((a) => ({ fase: (a.fase + 180) % 360, pts: ptsLateral(a, 'perto') })), N, minVis);
  }

  // ---- monta o esqueleto 3D faixa a faixa
  const zDe = (k, l, fase, X) => {
    if (!cicloF) return 0;
    const q = noCiclo(cicloF, `${k}_${l}`, fase);
    return q ? frontalParaBike(calF, q.x, q.y, X).Z : null;
  };
  const yFrontal = (k, l, fase, X) => {
    if (!cicloF) return null;
    const q = noCiclo(cicloF, `${k}_${l}`, fase);
    return q ? frontalParaBike(calF, q.x, q.y, X).Y : null;
  };
  const ponto3D = (cal, q, k, l, fase) => {
    if (!q) return null;
    // duas passadas: Z (frontal) precisa de X (profundidade) e X (lateral) precisa de Z (perspectiva)
    let P = lateralParaBike(cal, q.x, q.y, 0);
    for (let it = 0; it < 2; it++) {
      const Z = zDe(k, l, fase, P.X);
      P = lateralParaBike(cal, q.x, q.y, Z == null ? 0 : Z);
      if (Z == null) P.semZ = true;
    }
    return P;
  };
  const faixas = centros.map((fase) => {
    const esq = { e: {}, d: {} };
    for (const k of PARTES) {
      esq[ladoC][k] = ponto3D(calL, noCiclo(cicloL, k, fase), k, ladoC, fase);
      let P = null;
      const qL2 = cicloL2 ? noCiclo(cicloL2, k, fase) : null;
      if (qL2) P = ponto3D(calL2, qL2, k, ladoO, fase);
      else {
        // sem a segunda lateral: pedalada simétrica — a perna oposta na fase φ é a do
        // lado da câmera em φ + 180° (o braço, o do lado da câmera na mesma fase).
        // X, Y saem com a perspectiva do lado da câmera (de onde vieram os pixels);
        // o Z é o do lado oposto, medido na frontal.
        const fonte = PERNA.includes(k) ? (fase + 180) % 360 : fase;
        const q = noCiclo(cicloL, k, fonte);
        if (q) {
          P = ponto3D(calL, q, k, ladoC, fonte);
          const Z = zDe(k, ladoO, fase, P.X);
          P = { X: P.X, Y: P.Y, Z: Z == null ? -P.Z : Z, semZ: Z == null || P.semZ, simetria: true };
        } else {
          const qr = noCiclo(cicloLlonge, k, fase);
          if (qr) P = ponto3D(calL, qr, k, ladoO, fase);
        }
      }
      esq[ladoO][k] = P;
    }
    const yF = cicloF ? { joelho: { e: yFrontal('joelho', 'e', fase, 0), d: yFrontal('joelho', 'd', fase, 0) } } : null;
    return { fase, esq, ang: { e: angulos3D(esq.e), d: angulos3D(esq.d) }, ang2d: noCiclo2d(ang2dCiclo, fase), yF };
  });

  const res = { faixas, centroPedal: centro, centroPedal2: centro2, ladoCamera: ladoC, trocouRotulos: trocar, fasePicoTorn, avisos, cicloL, cicloF, cicloL2, centros };
  res.cadencia = cadenciaAutocorr(lat.map((a) => ({ t: a.t, y: a.tornY }))) || cadenciaFase(lat) || cadF;
  res.metricas = metricas(res, { temL2: Boolean(cicloL2), temF: Boolean(cicloF) });

  // ---- sincronização pelo tempo: refaz o Z amostra a amostra (só com relógio comum)
  if (sync === 'tempo' && cicloF && calF) {
    res.porTempo = fundirPorTempo(calL, calF, lat, cicloF.itens, ladoC, offset, minVis);
    if (res.porTempo.n < 20) res.avisos.push('Sincronização pelo tempo: poucas amostras se sobrepõem (as câmeras estão no mesmo relógio?).');
  }
  return res;
}

/** Ângulos 2D (px crus) médios por faixa de fase: para a comparação com o Bike Fit 2D. */
function media2d(itens, N) {
  const larg = 360 / N, acc = Array.from({ length: N }, () => ({}));
  for (const a of itens) {
    const b = Math.floor(a.fase / larg) % N;
    for (const [k, v] of Object.entries(a.ang2d || {})) {
      if (v == null) continue;
      const s = acc[b][k] || (acc[b][k] = { s: 0, n: 0 });
      s.s += v; s.n++;
    }
  }
  return acc.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.s / v.n])));
}
function noCiclo2d(c, fase) {
  const N = c.length, i = Math.floor((((fase % 360) + 360) % 360) / (360 / N)) % N;
  return c[i];
}

/** Z por amostra, casando a frontal pelo relógio (câmeras sincronizadas). */
function fundirPorTempo(calL, calF, lat, itensF, ladoC, offsetMs, minVis) {
  const linhas = [];
  for (const a of lat) {
    const q = a.perto.joelho;
    if (!q || q.v < minVis) continue;
    const f = noTempo(itensF, `joelho_${ladoC}`, a.t + offsetMs);
    if (!f) continue;
    let P = lateralParaBike(calL, q.x, q.y, 0);
    const Z = frontalParaBike(calF, f.x, f.y, P.X).Z;
    P = lateralParaBike(calL, q.x, q.y, Z);
    linhas.push({ t: a.t, fase: a.fase, joelho: P });
  }
  const zs = linhas.map((l) => l.joelho.Z);
  return { n: linhas.length, linhas, kneeTravelMm: zs.length ? (Math.max(...zs) - Math.min(...zs)) * 10 : null };
}

/** Os ângulos 3D de um lado. */
export function angulos3D(s) {
  if (!s) return {};
  return {
    joelho: angulo3D(s.quadril, s.joelho, s.tornozelo),
    quadril: angulo3D(s.ombro, s.quadril, s.joelho),
    tornozelo: angulo3D(s.joelho, s.tornozelo, s.pe),
    cotovelo: angulo3D(s.ombro, s.cotovelo, s.punho),
    ombro: angulo3D(s.quadril, s.ombro, s.cotovelo),
    tronco: troncoInclinacao3D(s.quadril, s.ombro),
  };
}

/**
 * Desvio do joelho em relação à linha quadril–tornozelo no plano frontal
 * (Z × Y), em cm; positivo = para FORA (afastando da linha média).
 */
export function desvioJoelho3D(s, lado) {
  const q = s.quadril, j = s.joelho, t = s.tornozelo;
  if (!q || !j || !t || q.semZ || j.semZ || t.semZ) return null;
  const den = t.Y - q.Y;
  if (!(Math.abs(den) > 1e-6)) return null;
  const zLinha = q.Z + ((t.Z - q.Z) * (j.Y - q.Y)) / den;
  return (j.Z - zLinha) * (lado === 'd' ? 1 : -1);
}

const est = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  if (!v.length) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return { media: m, min: Math.min(...v), max: Math.max(...v), amp: Math.max(...v) - Math.min(...v), n: v.length };
};

/** Métricas do ciclo médio fundido. */
export function metricas(res, { temL2 = false, temF = true } = {}) {
  const F = res.faixas;
  if (!F.length) return null;
  const lados = {};
  for (const l of ['e', 'd']) {
    const joelho = F.map((f) => f.ang[l].joelho);
    const iPMI = argExt(joelho, 1), iPMS = argExt(joelho, -1);
    const zJ = F.map((f) => (f.esq[l].joelho && !f.esq[l].joelho.semZ ? f.esq[l].joelho.Z : null));
    const zT = F.map((f) => (f.esq[l].tornozelo && !f.esq[l].tornozelo.semZ ? f.esq[l].tornozelo.Z : null));
    const zQ = F.map((f) => (f.esq[l].quadril && !f.esq[l].quadril.semZ ? f.esq[l].quadril.Z : null));
    const zP = F.map((f) => (f.esq[l].pe && !f.esq[l].pe.semZ ? f.esq[l].pe.Z : null));
    const desv = F.map((f) => desvioJoelho3D(f.esq[l], l));
    // amplitude de um sinal ruidoso infla com o ruído: suaviza o ciclo (1-2-1, circular) antes do máx − mín
    const sJ = est(suavizarCiclo(zJ)), sT = est(suavizarCiclo(zT)), sQ = est(zQ), sP = est(zP), sD = est(desv);
    const fora = l === 'd' ? 1 : -1;
    lados[l] = {
      joelhoPMI: iPMI >= 0 ? joelho[iPMI] : null, fasePMI: iPMI >= 0 ? F[iPMI].fase : null,
      joelhoPMS: iPMS >= 0 ? joelho[iPMS] : null, fasePMS: iPMS >= 0 ? F[iPMS].fase : null,
      quadrilMin: est(F.map((f) => f.ang[l].quadril))?.min ?? null,
      tornozeloAmp: est(F.map((f) => f.ang[l].tornozelo))?.amp ?? null,
      tornozeloPMI: iPMI >= 0 ? F[iPMI].ang[l].tornozelo : null,
      cotovelo: est(F.map((f) => f.ang[l].cotovelo))?.media ?? null,
      ombro: est(F.map((f) => f.ang[l].ombro))?.media ?? null,
      tronco: est(F.map((f) => f.ang[l].tronco))?.media ?? null,
      // deslocamento lateral do joelho no ciclo (knee travel), mm
      joelhoTravelMm: temF && sJ ? sJ.amp * 10 : null,
      tornozeloTravelMm: temF && sT ? sT.amp * 10 : null,
      // posições laterais médias (mm, + = para fora da linha média)
      quadrilZmm: temF && sQ ? sQ.media * 10 * fora : null,
      joelhoZmm: temF && sJ ? sJ.media * 10 * fora : null,
      tornozeloZmm: temF && sT ? sT.media * 10 * fora : null,
      peZmm: temF && sP ? sP.media * 10 * fora : null,
      // alinhamento quadril–joelho–pé: desvio do joelho da linha quadril–tornozelo
      desvioMedioMm: sD ? sD.media * 10 : null,
      desvioAmpMm: sD ? sD.amp * 10 : null,
      desvioPMSmm: iPMS >= 0 && desv[iPMS] != null ? desv[iPMS] * 10 : null,
    };
  }
  const lc = res.ladoCamera;
  const i2 = lados[lc].fasePMI != null ? F.findIndex((f) => f.fase === lados[lc].fasePMI) : -1;
  const j2 = lados[lc].fasePMS != null ? F.findIndex((f) => f.fase === lados[lc].fasePMS) : -1;
  // 2D: extremos do próprio ciclo 2D (como o Bike Fit mede), e o valor 2D na fase do PMI 3D
  const j2d = F.map((f) => (f.ang2d ? f.ang2d.joelho : null));
  const comp = {
    joelhoPMI: { d3: lados[lc].joelhoPMI, d2: est(j2d)?.max ?? null },
    joelhoPMS: { d3: lados[lc].joelhoPMS, d2: est(j2d)?.min ?? null },
    quadrilMin: { d3: lados[lc].quadrilMin, d2: est(F.map((f) => f.ang2d?.quadril))?.min ?? null },
    tronco: { d3: lados[lc].tronco, d2: est(F.map((f) => f.ang2d?.tronco))?.media ?? null },
    ombro: { d3: lados[lc].ombro, d2: est(F.map((f) => f.ang2d?.ombro))?.media ?? null },
    cotovelo: { d3: lados[lc].cotovelo, d2: est(F.map((f) => f.ang2d?.cotovelo))?.media ?? null },
    tornozeloPMI: { d3: lados[lc].tornozeloPMI, d2: i2 >= 0 ? F[i2].ang2d?.tornozelo ?? null : null },
  };
  void j2;
  const dif = (k) => (lados.e[k] != null && lados.d[k] != null ? lados.d[k] - lados.e[k] : null);
  const simetria = {
    real: temL2,     // sem a segunda lateral, os ângulos do lado oposto são a perna da câmera defasada 180°
    joelhoPMI: dif('joelhoPMI'), joelhoPMS: dif('joelhoPMS'), quadrilMin: dif('quadrilMin'),
    joelhoTravelMm: dif('joelhoTravelMm'), desvioMedioMm: dif('desvioMedioMm'), joelhoZmm: dif('joelhoZmm'),
  };
  return { lados, ladoCamera: lc, comparacao2D: comp, simetria };
}
/** Suavização 1-2-1 circular (o ciclo fecha), ignorando faixas vazias. */
export function suavizarCiclo(xs) {
  const n = xs.length;
  return xs.map((x, i) => {
    if (x == null) return null;
    const a = xs[(i - 1 + n) % n], b = xs[(i + 1) % n];
    let s = 2 * x, w = 2;
    if (a != null) { s += a; w++; }
    if (b != null) { s += b; w++; }
    return s / w;
  });
}
function argExt(xs, sinal) {
  let i0 = -1;
  for (let i = 0; i < xs.length; i++) if (xs[i] != null && (i0 < 0 || sinal * (xs[i] - xs[i0]) > 0)) i0 = i;
  return i0;
}

/**
 * Esqueleto 3D "ao vivo": a última amostra da lateral (lado da câmera) com o
 * Z da frontal na mesma fase (ou no mesmo instante, com sync = 'tempo').
 */
export function esqueletoAgora(res, calL, calF, am0, opc = {}) {
  if (!res || !calL || !am0 || am0.fase == null) return null;
  const am = comCentro(am0, res.centroPedal);
  const ladoC = calL.ladoCamera, ladoO = outro(ladoC), minVis = opc.minVis ?? 0.5;
  const esq = { e: {}, d: {} };
  const z = (k, l, X) => {
    if (!calF || !res.cicloF) return 0;
    let q = null;
    if (opc.sync === 'tempo' && res.cicloF.itens) q = noTempo(res.cicloF.itens, `${k}_${l}`, am.t + (opc.offsetMs || 0));
    if (!q) q = noCiclo(res.cicloF, `${k}_${l}`, am.fase);
    return q ? frontalParaBike(calF, q.x, q.y, X).Z : 0;
  };
  const por = (q, k, l, cal = calL) => {
    let P = lateralParaBike(cal, q.x, q.y, 0);
    for (let it = 0; it < 2; it++) P = lateralParaBike(cal, q.x, q.y, z(k, l, P.X));
    return P;
  };
  for (const k of PARTES) {
    const q = am.perto[k];
    esq[ladoC][k] = q && q.v >= minVis ? por(q, k, ladoC) : null;
    const q2 = res.cicloL2 ? noCiclo(res.cicloL2, k, am.fase) : null;
    if (q2 && opc.calL2) { esq[ladoO][k] = por(q2, k, ladoO, opc.calL2); continue; }
    const fonte = PERNA.includes(k) ? (am.fase + 180) % 360 : am.fase;
    const qo = res.cicloL ? noCiclo(res.cicloL, k, fonte) : null;
    if (!qo) { esq[ladoO][k] = null; continue; }
    const P = por(qo, k, ladoC);
    esq[ladoO][k] = { X: P.X, Y: P.Y, Z: calF && res.cicloF ? z(k, ladoO, P.X) : 0 };
  }
  return { esq, ang: { e: angulos3D(esq.e), d: angulos3D(esq.d) }, fase: am.fase };
}

/** Trajetórias fechadas (ciclo médio) de joelho e tornozelo, para desenhar. */
export function trajetorias(res) {
  const out = {};
  for (const l of ['e', 'd']) for (const k of ['joelho', 'tornozelo']) {
    out[`${k}_${l}`] = res.faixas.map((f) => f.esq[l][k]).filter(Boolean);
  }
  return out;
}

/** CSV do ciclo médio (uma linha por faixa de fase). */
export function csvCiclo(res) {
  const cab = ['fase'];
  for (const l of ['e', 'd']) {
    for (const k of PARTES) cab.push(`${k}_${l}_X`, `${k}_${l}_Y`, `${k}_${l}_Z`);
    for (const a of ['joelho', 'quadril', 'tornozelo', 'cotovelo', 'ombro', 'tronco']) cab.push(`ang_${a}_${l}`);
  }
  for (const a of ['joelho', 'quadril', 'tornozelo', 'cotovelo', 'ombro', 'tronco']) cab.push(`ang2d_${a}`);
  const f2 = (x) => (x == null || !Number.isFinite(x) ? '' : x.toFixed(2));
  const linhas = [cab.join(';')];
  for (const f of res.faixas) {
    const row = [f.fase.toFixed(1)];
    for (const l of ['e', 'd']) {
      for (const k of PARTES) { const p = f.esq[l][k]; row.push(f2(p && p.X), f2(p && p.Y), f2(p && !p.semZ ? p.Z : null)); }
      for (const a of ['joelho', 'quadril', 'tornozelo', 'cotovelo', 'ombro', 'tronco']) row.push(f2(f.ang[l][a]));
    }
    for (const a of ['joelho', 'quadril', 'tornozelo', 'cotovelo', 'ombro', 'tronco']) row.push(f2(f.ang2d ? f.ang2d[a] : null));
    linhas.push(row.join(';'));
  }
  return linhas.join('\n');
}

// ------------------------------------------------------------ projeção (visualização)
/**
 * Câmera de órbita para o renderizador em canvas 2D: azimute/elevação em
 * graus, distância em cm, alvo {X,Y,Z}. Devolve uma função ponto → {x, y, z}
 * (px da tela; z = profundidade, para ordenar e esmaecer).
 */
export function projetor({ az = 35, el = 15, dist = 320, alvo = { X: 0, Y: 60, Z: 0 }, larg = 800, alt = 600, foco = 1.6 } = {}) {
  const a = az / GRAU, e = el / GRAU;
  // posição da câmera em volta do alvo
  const cam = { X: alvo.X + dist * Math.cos(e) * Math.sin(a), Y: alvo.Y + dist * Math.sin(e), Z: alvo.Z + dist * Math.cos(e) * Math.cos(a) };
  const fwd = v3.mul(v3.sub(alvo, cam), 1 / dist);
  // direita = fwd × up(0,1,0), normalizada
  let dir = { X: -fwd.Z, Y: 0, Z: fwd.X };
  const nd = v3.norma(dir) || 1; dir = v3.mul(dir, 1 / nd);
  const up = { X: dir.Y * fwd.Z - dir.Z * fwd.Y, Y: dir.Z * fwd.X - dir.X * fwd.Z, Z: dir.X * fwd.Y - dir.Y * fwd.X };
  const fpx = (foco * Math.min(larg, alt)) / 2;
  return (P) => {
    const d = v3.sub(P, cam);
    const z = v3.dot(d, fwd);
    if (!(z > 1)) return null;
    return { x: larg / 2 + (fpx * v3.dot(d, dir)) / z, y: alt / 2 - (fpx * v3.dot(d, up)) / z, z };
  };
}
