/**
 * cv/runtime/livres-j/quadras.js — geometria dos campos e quadras (CV-35).
 *
 * Coordenadas da quadra em METROS: x ao longo do comprimento (0..L, da linha
 * de fundo "esquerda" do radar à "direita"), y ao longo da largura (0..W, de
 * cima para baixo no radar). Medidas oficiais embutidas:
 *
 *   futebol  105 × 68 (FIFA, recomendado; aceita 90–120 × 45–90)
 *   futsal    40 × 20 (FIFA; aceita 25–42 × 16–25)
 *   basquete  28 × 15 (FIBA)
 *   vôlei     18 × 9  (FIVB, quadra; rede no meio)
 *   tênis  23,77 × 10,97 (ITF, duplas; simples 8,23)
 *   padel     20 × 10 (FIP; vidro/grade ao redor)
 *
 * Também a homografia (imagem ↔ quadra) por 4 ou mais pares de pontos, por
 * mínimos quadrados (DLT com h33 = 1), sem dependências — e as zonas de
 * cada esporte. Nada aqui toca no DOM: roda no node para os testes.
 */

// ------------------------------------------------------------ desenho de linhas

const seg = (x1, y1, x2, y2) => [x1, y1, x2, y2];
function retangulo(x1, y1, x2, y2) {
  return [seg(x1, y1, x2, y1), seg(x2, y1, x2, y2), seg(x2, y2, x1, y2), seg(x1, y2, x1, y1)];
}
/** Arco de círculo em segmentos (ângulos em graus, 0 = +x, sentido de +y). */
function arco(cx, cy, r, a0, a1, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180, t1 = ((a0 + ((a1 - a0) * (i + 1)) / n) * Math.PI) / 180;
    out.push(seg(cx + r * Math.cos(t0), cy + r * Math.sin(t0), cx + r * Math.cos(t1), cy + r * Math.sin(t1)));
  }
  return out;
}
/** Espelha segmentos na linha do meio (x → L − x): o outro lado do campo. */
const espelhar = (segs, L) => segs.map(([a, b, c, d]) => [L - a, b, L - c, d]);
const graus = (r) => (r * 180) / Math.PI;

// ------------------------------------------------------------ esportes

/**
 * Cada esporte: nome, medidas (L, W, ajustáveis ou não), linhas(L, W),
 * pontos(L, W) de referência para a calibração ({ id: [x, y, nome] }), a
 * sugestão de 4 pontos, zona(x, y), raio de posse (m), se há posse/rally/
 * arremessos, como separar os times e a velocidade máxima plausível de um
 * jogador (m/s, acima disso é troca de ID ou erro de projeção).
 */
export const ESPORTES = {
  futebol: {
    nome: 'Futebol', L: 105, W: 68, ajustavel: { L: [90, 120], W: [45, 90] },
    posse: true, rally: false, arremessos: false, times: 'cor', raioPosse: 1.8, vMax: 11,
    linhas(L, W) {
      const m = W / 2, ga = 20.16, pa = 9.16, th = graus(Math.acos(5.5 / 9.15));
      const lado = [
        ...retangulo(0, m - ga, 16.5, m + ga), ...retangulo(0, m - pa, 5.5, m + pa),
        ...arco(11, m, 9.15, -th, th, 10),
      ];
      return [
        ...retangulo(0, 0, L, W), seg(L / 2, 0, L / 2, W), ...arco(L / 2, m, 9.15, 0, 360, 36),
        ...lado, ...espelhar(lado, L),
      ];
    },
    pontos(L, W) {
      const m = W / 2;
      return {
        c00: [0, 0, 'Canto (esq., em cima)'], c0W: [0, W, 'Canto (esq., embaixo)'],
        cL0: [L, 0, 'Canto (dir., em cima)'], cLW: [L, W, 'Canto (dir., embaixo)'],
        m0: [L / 2, 0, 'Meio-campo × lateral de cima'], mW: [L / 2, W, 'Meio-campo × lateral de baixo'],
        mc0: [L / 2, m - 9.15, 'Círculo central × meio (em cima)'], mcW: [L / 2, m + 9.15, 'Círculo central × meio (embaixo)'],
        ga1: [0, m - 20.16, 'Grande área esq. × fundo (em cima)'], ga2: [0, m + 20.16, 'Grande área esq. × fundo (embaixo)'],
        ga3: [16.5, m - 20.16, 'Grande área esq., canto frontal (em cima)'], ga4: [16.5, m + 20.16, 'Grande área esq., canto frontal (embaixo)'],
        gb1: [L, m - 20.16, 'Grande área dir. × fundo (em cima)'], gb2: [L, m + 20.16, 'Grande área dir. × fundo (embaixo)'],
        gb3: [L - 16.5, m - 20.16, 'Grande área dir., canto frontal (em cima)'], gb4: [L - 16.5, m + 20.16, 'Grande área dir., canto frontal (embaixo)'],
        pa1: [5.5, m - 9.16, 'Pequena área esq., canto (em cima)'], pa2: [5.5, m + 9.16, 'Pequena área esq., canto (embaixo)'],
        pb1: [L - 5.5, m - 9.16, 'Pequena área dir., canto (em cima)'], pb2: [L - 5.5, m + 9.16, 'Pequena área dir., canto (embaixo)'],
        pe: [11, m, 'Marca do pênalti esq.'], pd: [L - 11, m, 'Marca do pênalti dir.'],
      };
    },
    sugestao: ['c00', 'cL0', 'cLW', 'c0W'],
    zonas: ['área esq.', 'terço esq.', 'terço central', 'terço dir.', 'área dir.'],
    zona(x, y, L, W) {
      const m = W / 2;
      if (Math.abs(y - m) <= 20.16 && x <= 16.5) return 'área esq.';
      if (Math.abs(y - m) <= 20.16 && x >= L - 16.5) return 'área dir.';
      return x < L / 3 ? 'terço esq.' : x > (2 * L) / 3 ? 'terço dir.' : 'terço central';
    },
  },

  futsal: {
    nome: 'Futsal', L: 40, W: 20, ajustavel: { L: [25, 42], W: [16, 25] },
    posse: true, rally: false, arremessos: false, times: 'cor', raioPosse: 1.3, vMax: 10,
    linhas(L, W) {
      const m = W / 2;
      // área: quartos de círculo de 6 m a partir de cada poste (gol de 3 m), unidos por 3,16 m
      const lado = [...arco(0, m - 1.58, 6, -90, 0, 12), seg(6, m - 1.58, 6, m + 1.58), ...arco(0, m + 1.58, 6, 0, 90, 12)];
      return [...retangulo(0, 0, L, W), seg(L / 2, 0, L / 2, W), ...arco(L / 2, m, 3, 0, 360, 28), ...lado, ...espelhar(lado, L)];
    },
    pontos(L, W) {
      const m = W / 2;
      return {
        c00: [0, 0, 'Canto (esq., em cima)'], c0W: [0, W, 'Canto (esq., embaixo)'],
        cL0: [L, 0, 'Canto (dir., em cima)'], cLW: [L, W, 'Canto (dir., embaixo)'],
        m0: [L / 2, 0, 'Meio × lateral de cima'], mW: [L / 2, W, 'Meio × lateral de baixo'],
        mc0: [L / 2, m - 3, 'Círculo central × meio (em cima)'], mcW: [L / 2, m + 3, 'Círculo central × meio (embaixo)'],
        ae1: [0, m - 7.58, 'Área esq. × fundo (em cima)'], ae2: [0, m + 7.58, 'Área esq. × fundo (embaixo)'],
        ad1: [L, m - 7.58, 'Área dir. × fundo (em cima)'], ad2: [L, m + 7.58, 'Área dir. × fundo (embaixo)'],
        pe: [6, m, 'Marca do pênalti esq. (6 m)'], pd: [L - 6, m, 'Marca do pênalti dir. (6 m)'],
        se: [10, m, 'Tiro livre esq. (10 m)'], sd: [L - 10, m, 'Tiro livre dir. (10 m)'],
      };
    },
    sugestao: ['c00', 'cL0', 'cLW', 'c0W'],
    zonas: ['área esq.', 'terço esq.', 'terço central', 'terço dir.', 'área dir.'],
    zona(x, y, L, W) {
      const m = W / 2, dy = Math.max(0, Math.abs(y - m) - 1.58);
      if (Math.hypot(x, dy) <= 6) return 'área esq.';
      if (Math.hypot(L - x, dy) <= 6) return 'área dir.';
      return x < L / 3 ? 'terço esq.' : x > (2 * L) / 3 ? 'terço dir.' : 'terço central';
    },
  },

  basquete: {
    nome: 'Basquete', L: 28, W: 15, ajustavel: null,
    posse: true, rally: false, arremessos: true, times: 'cor', raioPosse: 1.4, vMax: 10,
    // aro: centro a 1,575 m da linha de fundo; 3 pontos 6,75 m (0,90 m da lateral nas retas)
    linhas(L, W) {
      const m = W / 2, ax = 1.575, dx = Math.sqrt(6.75 * 6.75 - (m - 0.9) * (m - 0.9));
      const th = graus(Math.asin((m - 0.9) / 6.75));
      const lado = [
        ...retangulo(0, m - 2.45, 5.8, m + 2.45), ...arco(5.8, m, 1.8, -90, 90, 14),
        seg(0, 0.9, ax + dx, 0.9), seg(0, W - 0.9, ax + dx, W - 0.9), ...arco(ax, m, 6.75, -th, th, 30),
        ...arco(ax, m, 0.225, 0, 360, 10),
      ];
      return [...retangulo(0, 0, L, W), seg(L / 2, 0, L / 2, W), ...arco(L / 2, m, 1.8, 0, 360, 24), ...lado, ...espelhar(lado, L)];
    },
    pontos(L, W) {
      const m = W / 2;
      return {
        c00: [0, 0, 'Canto (esq., em cima)'], c0W: [0, W, 'Canto (esq., embaixo)'],
        cL0: [L, 0, 'Canto (dir., em cima)'], cLW: [L, W, 'Canto (dir., embaixo)'],
        m0: [L / 2, 0, 'Meio × lateral de cima'], mW: [L / 2, W, 'Meio × lateral de baixo'],
        ge1: [0, m - 2.45, 'Garrafão esq. × fundo (em cima)'], ge2: [0, m + 2.45, 'Garrafão esq. × fundo (embaixo)'],
        ge3: [5.8, m - 2.45, 'Garrafão esq. × lance livre (em cima)'], ge4: [5.8, m + 2.45, 'Garrafão esq. × lance livre (embaixo)'],
        gd1: [L, m - 2.45, 'Garrafão dir. × fundo (em cima)'], gd2: [L, m + 2.45, 'Garrafão dir. × fundo (embaixo)'],
        gd3: [L - 5.8, m - 2.45, 'Garrafão dir. × lance livre (em cima)'], gd4: [L - 5.8, m + 2.45, 'Garrafão dir. × lance livre (embaixo)'],
        te1: [0, 0.9, '3 pontos esq. × fundo (em cima)'], te2: [0, W - 0.9, '3 pontos esq. × fundo (embaixo)'],
        td1: [L, 0.9, '3 pontos dir. × fundo (em cima)'], td2: [L, W - 0.9, '3 pontos dir. × fundo (embaixo)'],
      };
    },
    sugestao: ['c00', 'm0', 'mW', 'c0W'],
    zonas: ['garrafão', 'meia distância', '3 pontos', 'quadra de defesa'],
    zona(x, y, L, W) {
      const m = W / 2;
      const perto = x < L / 2 ? x : L - x;          // distância à linha de fundo mais próxima
      if (perto <= 5.8 && Math.abs(y - m) <= 2.45) return 'garrafão';
      const d = Math.hypot(perto - 1.575, y - m);
      const dentro3 = (y >= 0.9 && y <= W - 0.9) && (perto <= 1.575 || d <= 6.75);
      return dentro3 ? 'meia distância' : '3 pontos';
    },
  },

  'vôlei': {
    nome: 'Vôlei', L: 18, W: 9, ajustavel: null,
    posse: false, rally: true, arremessos: false, times: 'lado', raioPosse: 1, vMax: 8, rede: true,
    linhas(L, W) { return [...retangulo(0, 0, L, W), seg(L / 2, -0.5, L / 2, W + 0.5), seg(6, 0, 6, W), seg(12, 0, 12, W)]; },
    pontos(L, W) {
      return {
        c00: [0, 0, 'Canto (esq., em cima)'], c0W: [0, W, 'Canto (esq., embaixo)'],
        cL0: [L, 0, 'Canto (dir., em cima)'], cLW: [L, W, 'Canto (dir., embaixo)'],
        r0: [9, 0, 'Linha central × lateral de cima'], rW: [9, W, 'Linha central × lateral de baixo'],
        a1: [6, 0, 'Ataque esq. × lateral de cima'], a2: [6, W, 'Ataque esq. × lateral de baixo'],
        a3: [12, 0, 'Ataque dir. × lateral de cima'], a4: [12, W, 'Ataque dir. × lateral de baixo'],
      };
    },
    sugestao: ['c00', 'cL0', 'cLW', 'c0W'],
    zonas: ['ataque', 'defesa'],
    zona(x) { return Math.abs(x - 9) <= 3 ? 'ataque' : 'defesa'; },
  },

  'tênis': {
    nome: 'Tênis', L: 23.77, W: 10.97, ajustavel: null,
    posse: false, rally: true, arremessos: false, times: 'lado', raioPosse: 1, vMax: 9, rede: true, quique: true,
    linhas(L, W) {
      const s = 1.37, xs1 = L / 2 - 6.4, xs2 = L / 2 + 6.4;
      return [
        ...retangulo(0, 0, L, W), seg(0, s, L, s), seg(0, W - s, L, W - s), seg(L / 2, -0.914, L / 2, W + 0.914),
        seg(xs1, s, xs1, W - s), seg(xs2, s, xs2, W - s), seg(xs1, W / 2, xs2, W / 2),
        seg(0, W / 2, 0.1, W / 2), seg(L, W / 2, L - 0.1, W / 2),
      ];
    },
    pontos(L, W) {
      const s = 1.37, xs1 = L / 2 - 6.4, xs2 = L / 2 + 6.4;
      return {
        c00: [0, 0, 'Canto duplas (esq., em cima)'], c0W: [0, W, 'Canto duplas (esq., embaixo)'],
        cL0: [L, 0, 'Canto duplas (dir., em cima)'], cLW: [L, W, 'Canto duplas (dir., embaixo)'],
        s00: [0, s, 'Canto simples (esq., em cima)'], s0W: [0, W - s, 'Canto simples (esq., embaixo)'],
        sL0: [L, s, 'Canto simples (dir., em cima)'], sLW: [L, W - s, 'Canto simples (dir., embaixo)'],
        q1: [xs1, s, 'Linha de saque esq. × simples (em cima)'], q2: [xs1, W - s, 'Linha de saque esq. × simples (embaixo)'],
        q3: [xs2, s, 'Linha de saque dir. × simples (em cima)'], q4: [xs2, W - s, 'Linha de saque dir. × simples (embaixo)'],
        t1: [xs1, W / 2, '"T" esq.'], t2: [xs2, W / 2, '"T" dir.'],
        r0: [L / 2, 0, 'Rede × lateral de duplas (em cima)'], rW: [L / 2, W, 'Rede × lateral de duplas (embaixo)'],
      };
    },
    sugestao: ['c00', 'cL0', 'cLW', 'c0W'],
    zonas: ['junto à rede', 'zona de saque', 'fundo', 'atrás da linha de base'],
    zona(x, y, L) {
      const d = Math.abs(x - L / 2);
      return d < 3.5 ? 'junto à rede' : d <= 6.4 ? 'zona de saque' : d <= L / 2 ? 'fundo' : 'atrás da linha de base';
    },
  },

  padel: {
    nome: 'Padel', L: 20, W: 10, ajustavel: null,
    posse: false, rally: true, arremessos: false, times: 'lado', raioPosse: 1, vMax: 8, rede: true, quique: true,
    linhas(L, W) {
      return [...retangulo(0, 0, L, W), seg(L / 2, -0.3, L / 2, W + 0.3), seg(3.05, 0, 3.05, W), seg(L - 3.05, 0, L - 3.05, W),
        seg(3.05 - 0.2, W / 2, L - 3.05 + 0.2, W / 2)];
    },
    pontos(L, W) {
      return {
        c00: [0, 0, 'Canto (esq., em cima)'], c0W: [0, W, 'Canto (esq., embaixo)'],
        cL0: [L, 0, 'Canto (dir., em cima)'], cLW: [L, W, 'Canto (dir., embaixo)'],
        r0: [L / 2, 0, 'Rede × parede de cima'], rW: [L / 2, W, 'Rede × parede de baixo'],
        q1: [3.05, 0, 'Linha de saque esq. (em cima)'], q2: [3.05, W, 'Linha de saque esq. (embaixo)'],
        q3: [L - 3.05, 0, 'Linha de saque dir. (em cima)'], q4: [L - 3.05, W, 'Linha de saque dir. (embaixo)'],
        t1: [3.05, W / 2, '"T" esq.'], t2: [L - 3.05, W / 2, '"T" dir.'],
      };
    },
    sugestao: ['c00', 'cL0', 'cLW', 'c0W'],
    zonas: ['junto à rede', 'meio', 'fundo'],
    zona(x, y, L) { const d = Math.abs(x - L / 2); return d < 3 ? 'junto à rede' : d <= 6.95 ? 'meio' : 'fundo'; },
  },

  // beach tennis (ITF): 16 × 8 m (duplas), rede no meio; sem linhas de saque
  'beach tennis': {
    nome: 'Beach tennis', L: 16, W: 8, ajustavel: null,
    posse: false, rally: true, arremessos: false, times: 'lado', raioPosse: 1, vMax: 8, rede: true, quique: false,
    linhas(L, W) { return [...retangulo(0, 0, L, W), seg(L / 2, -0.3, L / 2, W + 0.3)]; },
    pontos(L, W) {
      return {
        c00: [0, 0, 'Canto (esq., em cima)'], c0W: [0, W, 'Canto (esq., embaixo)'],
        cL0: [L, 0, 'Canto (dir., em cima)'], cLW: [L, W, 'Canto (dir., embaixo)'],
        r0: [L / 2, 0, 'Rede × lateral (em cima)'], rW: [L / 2, W, 'Rede × lateral (embaixo)'],
      };
    },
    sugestao: ['c00', 'cL0', 'cLW', 'c0W'],
    zonas: ['junto à rede', 'meio', 'fundo'],
    zona(x, y, L) { const d = Math.abs(x - L / 2); return d < 2.5 ? 'junto à rede' : d <= 5.5 ? 'meio' : 'fundo'; },
  },
};
export const NOMES_ESPORTES = Object.keys(ESPORTES);

/** Medidas efetivas (futebol/futsal aceitam comprimento/largura do campo real). */
export function medidas(esporte, comprimento, largura) {
  const e = ESPORTES[esporte] || ESPORTES.futebol;
  let L = e.L, W = e.W;
  if (e.ajustavel) {
    if (comprimento > 0) L = Math.min(e.ajustavel.L[1], Math.max(e.ajustavel.L[0], comprimento));
    if (largura > 0) W = Math.min(e.ajustavel.W[1], Math.max(e.ajustavel.W[0], largura));
  }
  return { L, W };
}

export function dentroDaQuadra(x, y, L, W, margem = 0) {
  return x >= -margem && x <= L + margem && y >= -margem && y <= W + margem;
}
/** Distância (m) à borda mais próxima: positiva dentro, negativa fora. */
export function distanciaBorda(x, y, x1, y1, x2, y2) {
  const dentro = x >= x1 && x <= x2 && y >= y1 && y <= y2;
  if (dentro) return Math.min(x - x1, x2 - x, y - y1, y2 - y);
  const dx = Math.max(x1 - x, 0, x - x2), dy = Math.max(y1 - y, 0, y - y2);
  return -Math.hypot(dx, dy);
}

// ------------------------------------------------------------ homografia

/** Resolve A·x = b (n×n) por eliminação de Gauss com pivô parcial. null se singular. */
function resolver(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Homografia imagem → quadra por mínimos quadrados (≥ 4 pares).
 * img: [[u, v]] (normalizados 0..1), quadra: [[x, y]] (metros).
 * Normaliza as duas nuvens (centro e escala, à moda de Hartley) para o
 * sistema 8×8 ficar bem condicionado. Devolve a matriz 3×3 (linha a linha).
 */
export function homografia(img, quadra) {
  const n = Math.min(img.length, quadra.length);
  if (n < 4) return null;
  const norm = (P) => {
    let cx = 0, cy = 0;
    for (const [x, y] of P) { cx += x; cy += y; }
    cx /= P.length; cy /= P.length;
    let d = 0;
    for (const [x, y] of P) d += Math.hypot(x - cx, y - cy);
    const s = d > 0 ? (Math.SQRT2 * P.length) / d : 1;
    return { T: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], P: P.map(([x, y]) => [s * (x - cx), s * (y - cy)]) };
  };
  const A1 = norm(img.slice(0, n)), B1 = norm(quadra.slice(0, n));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
  const add = (row, val) => {
    for (let i = 0; i < 8; i++) { Atb[i] += row[i] * val; for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j]; }
  };
  for (let i = 0; i < n; i++) {
    const [u, v] = A1.P[i], [x, y] = B1.P[i];
    add([u, v, 1, 0, 0, 0, -u * x, -v * x], x);
    add([0, 0, 0, u, v, 1, -u * y, -v * y], y);
  }
  const h = resolver(AtA, Atb);
  if (!h) return null;
  const Hn = [...h, 1];
  // H = Tb⁻¹ · Hn · Ta
  const H = mul3(inv3(B1.T), mul3(Hn, A1.T));
  if (!H || !H.every(Number.isFinite)) return null;
  const k = H[8];
  return Math.abs(k) > 1e-12 ? H.map((x) => x / k) : H;
}

export function mul3(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return o;
}
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
/** Aplica H a (x, y). null se o ponto cai atrás da câmera / no infinito. */
export function aplicar(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (!(Math.abs(w) > 1e-9)) return null;
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w, w];
}

/**
 * Calibração completa a partir dos pares guardados no parâmetro do nó.
 * cal = { esporte, pares: [{ id, u, v }], aros: [[u, v]], w, h }
 * Devolve { H, Hi, erroM, mPorPx, aviso } ou null.
 */
export function montarCalibracao(cal, esporte, L, W) {
  if (!cal || !Array.isArray(cal.pares)) return null;
  const pts = ESPORTES[esporte] ? ESPORTES[esporte].pontos(L, W) : {};
  const pares = cal.pares.filter((p) => pts[p.id] && Number.isFinite(p.u) && Number.isFinite(p.v));
  if (pares.length < 4) return null;
  const img = pares.map((p) => [p.u, p.v]), q = pares.map((p) => [pts[p.id][0], pts[p.id][1]]);
  // 3 pontos alinhados na quadra (ex.: 3 cantos de uma mesma linha) não fecham a homografia
  if (!naoColineares(q)) return { erro: 'Os pontos escolhidos estão alinhados na quadra: use pontos que formem um quadrilátero.' };
  const H = homografia(img, q);
  const Hi = H && inv3(H);
  if (!H || !Hi) return { erro: 'Não foi possível calcular a homografia (pontos repetidos ou alinhados na imagem).' };
  // erro de reprojeção (m) — só tem sentido com mais de 4 pares
  let s2 = 0;
  for (let i = 0; i < img.length; i++) {
    const r = aplicar(H, img[i][0], img[i][1]);
    s2 += r ? (r[0] - q[i][0]) ** 2 + (r[1] - q[i][1]) ** 2 : 1e4;
  }
  const erroM = pares.length > 4 ? Math.sqrt(s2 / img.length) : null;
  // resolução: quantos metros um pixel de processamento vale no ponto mais distante
  const wpx = cal.w || 640, hpx = cal.h || 360;
  let mPorPx = 0;
  for (const [x, y] of [[0, 0], [L, 0], [L, W], [0, W]]) {
    const p = aplicar(Hi, x, y);
    if (!p) continue;
    const a = aplicar(H, p[0], p[1]), b = aplicar(H, p[0] + 1 / wpx, p[1]), c = aplicar(H, p[0], p[1] + 1 / hpx);
    if (!a || !b || !c) continue;
    mPorPx = Math.max(mPorPx, Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
  }
  // a quadra inteira tem que cair na frente da câmera (w com o mesmo sinal)
  const sinais = [[0, 0], [L, 0], [L, W], [0, W]].map(([x, y]) => Math.sign(Hi[6] * x + Hi[7] * y + Hi[8]));
  const aviso = sinais.some((s) => s !== sinais[0]) ? 'Parte da quadra fica atrás da câmera nesta calibração: confira os pontos.' : null;
  return { H, Hi, erroM, mPorPx, aviso, n: pares.length };
}

function naoColineares(P) {
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (let k = j + 1; k < P.length; k++) {
    const a = P[i], b = P[j], c = P[k];
    if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-3) return true;
  }
  return false;
}

/** Linhas da quadra projetadas na imagem (normalizadas), para conferir a calibração. */
export function linhasNaImagem(esporte, L, W, Hi) {
  const e = ESPORTES[esporte] || ESPORTES.futebol, out = [];
  for (const [x1, y1, x2, y2] of e.linhas(L, W)) {
    const a = aplicar(Hi, x1, y1), b = aplicar(Hi, x2, y2);
    if (!a || !b || a[2] <= 0 !== b[2] <= 0) continue;
    if (Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1])) > 4) continue;
    out.push([a[0], a[1], b[0], b[1]]);
  }
  return out;
}

/** Texto curto de um número em pt-BR. */
export function num(x, d = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  return x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
