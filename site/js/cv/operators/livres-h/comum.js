/**
 * operators/livres-h/comum.js — desenho compartilhado do Salto e da Corrida:
 * esqueleto por lado, linha do chão e o passo dos banners em px do quadro.
 */
import { OSSOS } from '../../runtime/livres-h/comum.js';

export const COR = { e: '#22d3ee', d: '#fb923c', meio: '#e5e7eb', chao: 'rgba(255,216,77,.85)', ok: '#4ade80', alerta: '#f87171', aviso: '#FFD84D', neutro: '#94a3b8' };

/** Esqueleto: lado esquerdo em ciano, direito em laranja (ou tudo em `corUnica`); pontos com visibilidade baixa ficam de fora. */
export function esqueleto(ov, P, sx, sy, minVis, destaque = null, corUnica = null) {
  const q = (i) => (P[i] && P[i].v >= minVis ? { x: P[i].x * sx, y: P[i].y * sy } : null);
  for (const l of ['e', 'd']) {
    const w = destaque && destaque !== l ? 2 : 3;
    for (const [a, b] of OSSOS[l]) {
      const A = q(a), B = q(b);
      if (A && B) ov.push({ type: 'line', x1: A.x, y1: A.y, x2: B.x, y2: B.y, color: corUnica || COR[l], width: w });
    }
  }
  for (const [a, b] of OSSOS.meio) {
    const A = q(a), B = q(b);
    if (A && B) ov.push({ type: 'line', x1: A.x, y1: A.y, x2: B.x, y2: B.y, color: COR.meio, width: 2 });
  }
  for (const i of [25, 26, 27, 28, 29, 30, 31, 32]) {
    const A = q(i);
    if (A) ov.push({ type: 'point', x: A.x, y: A.y, r: i >= 29 ? 3 : 4, color: corUnica || COR[i % 2 ? 'e' : 'd'] });
  }
}

/** Linha do chão sob os pés (só a região da pessoa, para não riscar o quadro todo). */
export function linhaChao(ov, P, chaoY, sx, sy, cor = COR.chao) {
  if (chaoY == null) return;
  const xs = [27, 28, 29, 30, 31, 32].map((i) => P[i] && P[i].x).filter((x) => x != null);
  if (!xs.length) return;
  const x1 = Math.min(...xs), x2 = Math.max(...xs), m = Math.max(40, (x2 - x1) * 0.8);
  ov.push({ type: 'line', x1: (x1 - m) * sx, y1: chaoY * sy, x2: (x2 + m) * sx, y2: chaoY * sy, color: cor, width: 1.6 });
}

/** Banners empilhados (o passo acompanha a escala da exibição, como no Bike Fit). */
export function bannerista(ov, ctx) {
  let y = 8;
  const passo = Math.max(24, (22 * ctx.w) / 400);
  return (text, color) => { ov.push({ type: 'banner', x: 8, y, text, color }); y += passo; };
}

export const rotulo = (ov, x, y, texto, cor) => ov.push({ type: 'rect', x, y, w: 0, h: 0, color: cor, label: texto });
