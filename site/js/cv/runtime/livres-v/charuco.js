/**
 * cv/runtime/livres-v/charuco.js — CV-88 Motion 3D Studio: tabuleiro ChArUco para a calibração
 * multicâmera do FreeMoCap (Anipose), feito com o dicionário ArUco que o iaVision já tem
 * (runtime/livres-i/aruco.js, DICT_4X4_50 — os 50 primeiros marcadores do DICT_4X4_250 do
 * OpenCV, que é o do FreeMoCap, são os mesmos).
 *
 * Geometria (OpenCV CharucoBoard): xadrez de C × L quadrados, canto superior esquerdo PRETO,
 * marcadores nos quadrados BRANCOS, ids 0, 1, 2… em ordem de leitura. Com número ÍMPAR de
 * linhas (5×3, 7×5) o padrão "legado" e o novo (OpenCV ≥ 4.6) coincidem — por isso só esses
 * tamanhos são oferecidos. Ainda assim, para calibrar NO FreeMoCap, o guia recomenda o
 * tabuleiro oficial do FreeMoCap; este serve para conferir, com a câmera, quantos marcadores
 * cada vista enxerga (detectarAruco, no aparelho) antes de gravar.
 */
import { bitsDoId, cinzaDe, detectarAruco } from '../livres-i/aruco.js';

export const TABULEIROS = {
  '5x3': { colunas: 5, linhas: 3, rotulo: '5 × 3 (padrão do FreeMoCap)' },
  '7x5': { colunas: 7, linhas: 5, rotulo: '7 × 5 (volume maior)' },
};

/** Ids dos marcadores do tabuleiro (quadrados brancos em ordem de leitura). */
export function idsDoTabuleiro(colunas, linhas) {
  const ids = [];
  let id = 0;
  for (let l = 0; l < linhas; l++) for (let c = 0; c < colunas; c++) if ((l + c) % 2 === 1) ids.push(id++);
  return ids;
}

/**
 * SVG do tabuleiro em milímetros reais (imprima em 100 %, sem "ajustar à página").
 * quadradoMm: lado do quadrado; marcador = 0,75 do quadrado (razão usual do FreeMoCap/Anipose).
 */
export function svgTabuleiro({ colunas = 5, linhas = 3, quadradoMm = 50, razaoMarcador = 0.75, margemMm = 10 } = {}) {
  if (colunas * linhas / 2 > 50) throw new Error('Tabuleiro grande demais para o dicionário 4×4 de 50 marcadores.');
  const W = colunas * quadradoMm + 2 * margemMm, H = linhas * quadradoMm + 2 * margemMm + 12;
  const partes = [];
  let id = 0;
  for (let l = 0; l < linhas; l++) {
    for (let c = 0; c < colunas; c++) {
      const x = margemMm + c * quadradoMm, y = margemMm + l * quadradoMm;
      if ((l + c) % 2 === 0) { partes.push(`<rect x="${x}" y="${y}" width="${quadradoMm}" height="${quadradoMm}" fill="#000"/>`); continue; }
      // marcador ArUco 4×4: borda preta de 1 célula + 4×4 bits (1 = branco) → 6×6 células
      const lado = quadradoMm * razaoMarcador, cel = lado / 6;
      const mx = x + (quadradoMm - lado) / 2, my = y + (quadradoMm - lado) / 2;
      partes.push(`<rect x="${mx}" y="${my}" width="${lado}" height="${lado}" fill="#000"/>`);
      const bits = bitsDoId(id++);
      for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) if (bits[r][k]) partes.push(`<rect x="${(mx + (k + 1) * cel).toFixed(3)}" y="${(my + (r + 1) * cel).toFixed(3)}" width="${cel.toFixed(3)}" height="${cel.toFixed(3)}" fill="#fff"/>`);
    }
  }
  const legenda = `ChArUco ${colunas}×${linhas} · quadrado ${quadradoMm} mm · marcador ${(quadradoMm * razaoMarcador).toFixed(1)} mm · DICT_4X4_50/250 · ids 0–${id - 1} · GPlanSiS|iaVision Motion 3D Studio`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${partes.join('')}` +
    `<text x="${margemMm}" y="${H - 4}" font-family="Arial, sans-serif" font-size="4" fill="#000">${legenda}</text></svg>`;
}

/**
 * Confere uma imagem (ImageData) contra o tabuleiro: quais ids aparecem e a fração vista.
 * Roda no aparelho, com o detector ArUco do VBT. Devolve { ids, fracao, marcadores }.
 */
export function conferirTabuleiro(img, colunas = 5, linhas = 3) {
  const esperados = idsDoTabuleiro(colunas, linhas);
  const g = cinzaDe(img.data, img.width, img.height);
  const achados = detectarAruco(g, img.width, img.height, { ids: new Set(esperados), ladoMin: 10 });
  const ids = [...new Set(achados.map((m) => m.id))].sort((a, b) => a - b);
  return { ids, fracao: esperados.length ? ids.length / esperados.length : 0, marcadores: achados };
}

/** Passo a passo da calibração multicâmera (FreeMoCap/Anipose e o modo "pelo corpo" do robo). */
export const GUIA_CALIBRACAO = [
  'Imprima o tabuleiro em 100 % (sem ajustar à página), cole numa placa rígida e meça o quadrado com régua: o FreeMoCap pede esse tamanho em mm.',
  'Posicione 2 a 4 câmeras fixas (tripé) em volta do volume, a 2–4 m, todas vendo a pessoa de corpo inteiro; evite contraluz.',
  'Grave as câmeras ao mesmo tempo. No FreeMoCap: aba de calibração, mostre o tabuleiro a TODAS as câmeras, girando e inclinando devagar por 20–30 s, cobrindo o volume.',
  'Aqui no Studio, "Conferir tabuleiro" mostra quantos marcadores cada vista lê: busque ≥ 60 % dos ids em cada câmera, com o tabuleiro em várias posições.',
  'Sem tabuleiro? A Multicâmera do Studio (MoCap do GPlanSiS|ROBO) calibra PELO CORPO: ande, gire e mexa braços e pernas por ~10 s à vista de todas as câmeras; informe sua altura para a escala.',
  'Depois de processar no FreeMoCap, importe output_data/mediapipe_body_3d_xyz.npy (ou o CSV) no Content Browser: o Studio alinha o mundo, mostra em 3D e exporta BVH/GLB para o Blender.',
];
