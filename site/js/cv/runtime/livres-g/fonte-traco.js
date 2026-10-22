/**
 * cv/runtime/livres-g/fonte-traco.js — texto GRANDE no overlay, feito de linhas.
 *
 * O overlay do Viewport só desenha ponto, retângulo, linha e faixa (banner,
 * 12 px de tela). Para o placar e o feedback em letras grandes, cada letra é
 * um traçado de segmentos numa grade 4 × 6 (y para baixo, 0 = topo,
 * 6 = linha de base), e o texto vira uma lista de `{type: 'line'}`. As
 * posições escalam com a imagem; a espessura do traço é em px de TELA, então
 * quem chama passa a escala da tela (px de tela por px do quadro) para o
 * traço acompanhar o tamanho da letra. Primeiro um contorno escuro e largo,
 * depois a cor: legível sobre qualquer fundo.
 *
 * Só maiúsculas (o texto é convertido), algarismos, pontuação usual e os
 * acentos do português (agudo, grave, circunflexo, til e cedilha).
 */

// polilinhas: [x0, y0, x1, y1, ...]
const O_ = [1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0];
const P_ = [0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3];
const G = {
  A: [[0, 6, 0, 2, 2, 0, 4, 2, 4, 6], [0, 4, 4, 4]],
  B: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [3, 3, 4, 4, 4, 5, 3, 6, 0, 6]],
  C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  D: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  F: [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]],
  G: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[4, 0, 4, 5, 3, 6, 1, 6, 0, 5]],
  K: [[0, 0, 0, 6], [4, 0, 0, 3.5], [1.3, 2.6, 4, 6]],
  L: [[0, 0, 0, 6, 4, 6]],
  M: [[0, 6, 0, 0, 2, 3, 4, 0, 4, 6]],
  N: [[0, 6, 0, 0, 4, 6, 4, 0]],
  O: [O_],
  P: [P_],
  Q: [O_, [2.5, 4.5, 4, 6.3]],
  R: [P_, [2, 3, 4, 6]],
  S: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  T: [[0, 0, 4, 0], [2, 0, 2, 6]],
  U: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]],
  V: [[0, 0, 2, 6, 4, 0]],
  W: [[0, 0, 1, 6, 2, 3, 3, 6, 4, 0]],
  X: [[0, 0, 4, 6], [4, 0, 0, 6]],
  Y: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]],
  Z: [[0, 0, 4, 0, 0, 6, 4, 6]],
  0: [O_, [3.2, 1, 0.8, 5]],
  1: [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]],
  2: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]],
  3: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1.5, 3], [3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  4: [[3, 6, 3, 0, 0, 4, 4, 4]],
  5: [[4, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  6: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 1, 3, 0, 4]],
  7: [[0, 0, 4, 0, 1.5, 6]],
  8: [[1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  9: [[4, 2, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5]],
  '!': [[2, 0, 2, 4], [2, 5.7, 2, 6]],
  '?': [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 2, 3.3, 2, 4.2], [2, 5.7, 2, 6]],
  '.': [[2, 5.7, 2, 6]],
  ',': [[2, 5.5, 1.4, 7]],
  ':': [[2, 1.7, 2, 2.1], [2, 5.6, 2, 6]],
  ';': [[2, 1.7, 2, 2.1], [2, 5.5, 1.4, 7]],
  '-': [[1, 3, 3, 3]],
  '–': [[0.5, 3, 3.5, 3]],
  '+': [[0.5, 3, 3.5, 3], [2, 1.5, 2, 4.5]],
  '/': [[4, 0, 0, 6]],
  '%': [[0, 6, 4, 0], [0.6, 0.4, 0.6, 1.3], [3.4, 4.7, 3.4, 5.6]],
  '°': [[1, 0, 2.2, 0, 2.2, 1.2, 1, 1.2, 1, 0]],
  '×': [[0.7, 2, 3.3, 5], [3.3, 2, 0.7, 5]],
  '✓': [[0, 3.5, 1.5, 5.5, 4, 0.5]],
  '⚠': [[2, 0, 4, 6, 0, 6, 2, 0], [2, 2, 2, 4], [2, 5, 2, 5.2]],
  '(': [[2.5, 0, 1.5, 1.5, 1.5, 4.5, 2.5, 6]],
  ')': [[1.5, 0, 2.5, 1.5, 2.5, 4.5, 1.5, 6]],
  '·': [[2, 3, 2, 3.2]],
  '"': [[1.3, 0, 1.3, 1.5], [2.7, 0, 2.7, 1.5]],
  "'": [[2, 0, 2, 1.5]],
  '=': [[0.5, 2.2, 3.5, 2.2], [0.5, 3.8, 3.5, 3.8]],
  ' ': [],
};
// acentos (por cima da letra; a cedilha por baixo)
const AC = {
  agudo: [[1.6, -0.6, 2.6, -1.7]],
  grave: [[1.4, -1.7, 2.4, -0.6]],
  circ: [[0.9, -0.6, 2, -1.7, 3.1, -0.6]],
  til: [[0.6, -0.8, 1.4, -1.5, 2.6, -0.9, 3.4, -1.6]],
  ced: [[2, 6, 2, 6.8, 1.2, 7.5]],
};
const ACENTOS = {
  Á: ['A', 'agudo'], À: ['A', 'grave'], Â: ['A', 'circ'], Ã: ['A', 'til'],
  É: ['E', 'agudo'], Ê: ['E', 'circ'], Í: ['I', 'agudo'],
  Ó: ['O', 'agudo'], Ô: ['O', 'circ'], Õ: ['O', 'til'], Ú: ['U', 'agudo'], Ü: ['U', null],
  Ç: ['C', 'ced'],
};

export const AVANCO = 5.6;    // largura de uma letra + espaço, em unidades da grade
export const ALTURA = 6;

/** Traços de um caractere (já em maiúscula). Desconhecido = espaço. */
export function tracos(ch) {
  if (G[ch]) return G[ch];
  const a = ACENTOS[ch];
  if (a) return [...G[a[0]], ...(a[1] ? AC[a[1]] : [])];
  return [];
}

/** Largura do texto em px para uma altura de letra `alt` (px). */
export function larguraTexto(texto, alt) {
  const n = [...String(texto)].length;
  return n ? ((n * AVANCO - (AVANCO - 4)) * alt) / ALTURA : 0;
}

/**
 * Empurra o texto como linhas em `ov`.
 * opc: { x, y (topo), alt (altura da letra, px do quadro), cor, alinhar
 *        ('esquerda' | 'centro' | 'direita'), escala (px de tela por px do
 *        quadro, para a espessura), contorno (cor) }
 * Devolve a caixa {x, y, w, h} ocupada.
 */
export function textoTraco(ov, texto, opc) {
  const t = String(texto).toUpperCase();
  const alt = opc.alt, u = alt / ALTURA;
  const w = larguraTexto(t, alt);
  const x0 = opc.alinhar === 'centro' ? opc.x - w / 2 : opc.alinhar === 'direita' ? opc.x - w : opc.x;
  const y0 = opc.y;
  const esc = opc.escala > 0 ? opc.escala : 1;
  // espessura em px de TELA: ~15% da altura da letra na tela, entre 1,6 e 9
  const larg = Math.max(1.6, Math.min(9, alt * esc * 0.15));
  const segs = [];
  let i = 0;
  for (const ch of t) {
    const ox = x0 + i * AVANCO * u;
    for (const pl of tracos(ch)) {
      for (let k = 0; k + 3 < pl.length; k += 2) {
        segs.push([ox + pl[k] * u, y0 + pl[k + 1] * u, ox + pl[k + 2] * u, y0 + pl[k + 3] * u]);
      }
      if (pl.length === 2) segs.push([ox + pl[0] * u, y0 + pl[1] * u, ox + pl[0] * u + 0.01, y0 + pl[1] * u]);
    }
    i++;
  }
  const contorno = opc.contorno === undefined ? 'rgba(2,20,18,.85)' : opc.contorno;
  if (contorno) for (const s of segs) ov.push({ type: 'line', x1: s[0], y1: s[1], x2: s[2], y2: s[3], color: contorno, width: larg + 3.2 });
  for (const s of segs) ov.push({ type: 'line', x1: s[0], y1: s[1], x2: s[2], y2: s[3], color: opc.cor || '#FFD84D', width: larg });
  return { x: x0, y: y0, w, h: alt };
}

/**
 * Quebra o texto em linhas que caibam em `maxW` px com a altura `alt`;
 * se uma palavra sozinha não couber, diminui a altura. Devolve { linhas, alt }.
 */
export function quebrar(texto, maxW, alt, maxLinhas = 2) {
  const palavras = String(texto).toUpperCase().split(/\s+/).filter(Boolean);
  const montar = (a) => {
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      const t = atual ? atual + ' ' + p : p;
      if (larguraTexto(t, a) > maxW && atual) { linhas.push(atual); atual = p; } else atual = t;
    }
    if (atual) linhas.push(atual);
    return linhas;
  };
  let a = alt, linhas = montar(a);
  for (let tent = 0; tent < 14; tent++) {
    if (linhas.length <= maxLinhas && linhas.every((l) => larguraTexto(l, a) <= maxW)) break;
    a *= 0.88;
    linhas = montar(a);
  }
  return { linhas, alt: a };
}
