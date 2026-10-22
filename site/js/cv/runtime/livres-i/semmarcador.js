/**
 * cv/runtime/livres-i/semmarcador.js — o modo SEM marcador do VBT: que ponto
 * do corpo seguir, em que eixo medir e com que escala. Sem DOM (testes no node).
 *
 * Unidades: as posições chegam em U = milésimos da LARGURA do quadro (o mesmo
 * espaço do modo marcador); a escala sai em cm por U.
 *
 * Escalas:
 *   altura     estatura em px = nariz → meio dos tornozelos ÷ 0,88 (o nariz fica
 *              a ~92% da altura e o tornozelo a ~4%); o maior valor dos últimos
 *              10 s (atleta de pé). SÓ vale com o corpo inteiro no quadro.
 *   segmento   coxa (quadril→joelho) ou canela (joelho→tornozelo) medida em cm,
 *              ou estimada da altura (0,245·H e 0,246·H, Drillis & Contini);
 *              percentil 90 dos últimos 10 s (o segmento inclinado em relação à
 *              câmera encurta; o mais longo é o mais perto do real).
 *   2 cliques  dois pontos marcados no vídeo e a distância real entre eles
 *              (anilha de 45 cm, largura do banco…). A mais confiável sem marcador.
 */

/** Índices MediaPipe. */
const I = { nariz: 0, ombroE: 11, ombroD: 12, punhoE: 15, punhoD: 16, quadrilE: 23, quadrilD: 24, joelhoE: 25, joelhoD: 26, tornE: 27, tornD: 28 };

export const PONTOS = ['automático', 'punhos (barra)', 'quadril', 'ombros'];
export const ESCALAS = ['altura', 'segmento', '2 cliques'];

/** Ponto efetivo: 'automático' segue o exercício. */
export function resolverPonto(param, ex) {
  if (param === 'quadril') return 'quadril';
  if (param === 'ombros') return 'ombros';
  if (param === 'punhos (barra)') return 'punhos';
  return (ex && ex.ponto) || 'punhos';
}

/** Média dos visíveis de um par (ou o único visível). Devolve { x, y, v } ou null. */
function par(P, a, b, minV) {
  const A = P[a], B = P[b];
  const va = A && A.v >= minV, vb = B && B.v >= minV;
  if (va && vb) return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, v: Math.min(A.v, B.v) };
  if (va) return { x: A.x, y: A.y, v: A.v * 0.9 };
  if (vb) return { x: B.x, y: B.y, v: B.v * 0.9 };
  return null;
}

/** Posição do ponto seguido (px do quadro) ou null se pouco visível. */
export function pontoSeguido(P, ponto, minV = 0.5) {
  if (ponto === 'quadril') return par(P, I.quadrilE, I.quadrilD, minV);
  if (ponto === 'ombros') return par(P, I.ombroE, I.ombroD, minV);
  return par(P, I.punhoE, I.punhoD, minV);
}

/** "x1,y1,x2,y2" → [{x,y},{x,y}] ou null. */
export function lerPontos(txt) {
  const n = String(txt || '').split(/[,;\s]+/).filter(Boolean).map(Number);
  if (n.length !== 4 || !n.every(Number.isFinite)) return null;
  const A = { x: n[0], y: n[1] }, B = { x: n[2], y: n[3] };
  return Math.hypot(B.x - A.x, B.y - A.y) > 1 ? [A, B] : null;
}
export const escreverPontos = (A, B) => [A.x, A.y, B.x, B.y].map((v) => Math.round(v * 10) / 10).join(',');

/**
 * Eixo "para cima" (unitário, coordenadas de imagem com y para baixo) a partir
 * de uma referência marcada: tipo 'vertical' (prumo do rack, batente) ou
 * 'horizontal' (chão, borda do banco). Sem referência: (0, −1).
 */
export function eixoCima(ref, tipo = 'vertical') {
  if (!ref) return { x: 0, y: -1, graus: 0 };
  const [A, B] = ref;
  let dx = B.x - A.x, dy = B.y - A.y;
  const L = Math.hypot(dx, dy);
  dx /= L; dy /= L;
  let ux, uy;
  if (tipo === 'horizontal') { ux = dy; uy = -dx; } else { ux = dx; uy = dy; }
  if (uy > 0) { ux = -ux; uy = -uy; }                    // sempre apontando para cima
  return { x: ux, y: uy, graus: (Math.atan2(ux, -uy) * 180) / Math.PI };
}

/** Coordenadas no eixo: u (para cima, ao longo de `cima`) e w (perpendicular, para a direita). */
export function projetar(p, cima) {
  return { u: p.x * cima.x + p.y * cima.y, w: p.x * -cima.y + p.y * cima.x };
}

/** Corpo inteiro no quadro? Devolve a lista do que falta (vazia = ok). */
export function cortes(P, w, h, minV = 0.5) {
  const falta = [];
  const nariz = P[I.nariz];
  if (!nariz || nariz.v < minV || nariz.y < 0.02 * h || nariz.x < 0 || nariz.x > w) falta.push('cabeça');
  const pes = [P[I.tornE], P[I.tornD]].filter((q) => q && q.v >= minV && q.y < 0.985 * h && q.y > 0);
  if (!pes.length) falta.push('pés');
  return falta;
}

const pct = (arr, p) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };

/** Comprimento (px) do segmento mais visível dos dois lados, ou null. */
export function segmentoPx(P, qual, minV = 0.6) {
  const [a, b] = qual === 'canela' ? [[I.joelhoE, I.tornE], [I.joelhoD, I.tornD]] : [[I.quadrilE, I.joelhoE], [I.quadrilD, I.joelhoD]];
  const c = [a, b].map(([i, j]) => ({ L: Math.hypot(P[i].x - P[j].x, P[i].y - P[j].y), v: Math.min(P[i].v, P[j].v) })).filter((s) => s.v >= minV);
  if (!c.length) return null;
  c.sort((x, y) => y.v - x.v);
  return c[0].L;
}

/** Fração da estatura por segmento (Drillis & Contini). */
export const FRACAO_SEGMENTO = { coxa: 0.245, canela: 0.246 };

/**
 * Escala da pose ao longo do tempo. adicionar(t, P, w, h) a cada pose;
 * escala(cfg) → { cmU (cm por U), fonte (texto), confiavel, avisos }.
 * cfg = { escala, alturaCm, segmento, segmentoCm, calib (pontos em U), calibCm }.
 */
export class EscalaPose {
  constructor() { this.am = []; }
  zerar() { this.am = []; }
  adicionar(t, P, w, h) {
    const nariz = P[I.nariz];
    const pes = [P[I.tornE], P[I.tornD]].filter((q) => q.v >= 0.5);
    const est = nariz.v >= 0.5 && pes.length
      ? Math.hypot(nariz.x - pes.reduce((s, q) => s + q.x, 0) / pes.length, nariz.y - pes.reduce((s, q) => s + q.y, 0) / pes.length) / 0.88 : null;
    this.am.push({ t, w, est, coxa: segmentoPx(P, 'coxa'), canela: segmentoPx(P, 'canela'), cortes: cortes(P, w, h) });
    while (this.am.length && this.am[0].t < t - 10000) this.am.shift();
    if (this.am.length && t < this.am[this.am.length - 1].t - 1) this.am = [this.am[this.am.length - 1]];
  }
  escala(cfg = {}) {
    const avisos = [];
    const ult = this.am[this.am.length - 1];
    const w = ult ? ult.w : 1000;
    const kU = w / 1000;                               // px por U
    if (cfg.escala === '2 cliques') {
      const c = cfg.calib;
      if (c && cfg.calibCm > 0) {
        const dU = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
        return { cmU: cfg.calibCm / dU, fonte: `2 cliques (${fmt(cfg.calibCm)} cm)`, confiavel: true, avisos };
      }
      avisos.push('Marque os 2 pontos no vídeo e informe a distância real entre eles.');
      return { cmU: null, fonte: '2 cliques (não marcados)', confiavel: false, avisos };
    }
    if (!this.am.length) return { cmU: null, fonte: cfg.escala, confiavel: false, avisos };
    if (cfg.escala === 'segmento') {
      const qual = cfg.segmento === 'canela' ? 'canela' : 'coxa';
      const px = pct(this.am.map((a) => a[qual]).filter(Boolean), 0.9);
      const cm = cfg.segmentoCm > 0 ? cfg.segmentoCm : FRACAO_SEGMENTO[qual] * (cfg.alturaCm || 175);
      if (!px) { avisos.push(`${qual === 'coxa' ? 'Coxa' : 'Canela'} pouco visível: troque o segmento ou use 2 cliques.`); return { cmU: null, fonte: `segmento (${qual})`, confiavel: false, avisos }; }
      const estimado = !(cfg.segmentoCm > 0);
      if (estimado) avisos.push(`${qual === 'coxa' ? 'Coxa' : 'Canela'} estimada da altura (${fmt(cm)} cm): meça e informe para mais precisão.`);
      return { cmU: (cm / px) * kU, fonte: `${qual} ${fmt(cm)} cm${estimado ? ' (estimada)' : ''}`, confiavel: true, avisos };
    }
    // altura
    const recentes = this.am.slice(-30);
    const cortados = recentes.filter((a) => a.cortes.length).length > recentes.length / 2;
    const px = pct(this.am.map((a) => a.est).filter(Boolean), 0.9);
    if (cortados || !px) {
      const falta = [...new Set(recentes.flatMap((a) => a.cortes))].join(' e ');
      avisos.push(`${falta ? falta[0].toUpperCase() + falta.slice(1) : 'Corpo'} fora do quadro: a escala pela altura não vale. Use "segmento" ou "2 cliques" — as velocidades abaixo NÃO são confiáveis.`);
      return { cmU: px ? ((cfg.alturaCm || 175) / px) * kU : null, fonte: 'altura (corpo cortado)', confiavel: false, avisos };
    }
    return { cmU: ((cfg.alturaCm || 175) / px) * kU, fonte: `altura ${cfg.alturaCm || 175} cm`, confiavel: true, avisos };
  }
}
const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
