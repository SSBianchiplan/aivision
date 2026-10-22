/**
 * cv/operators/livres-r/comum.js — utilidades dos operadores da onda 2-a
 * (grupo livres-r): marcações por função, recorte em px na imagem de
 * análise, escala mm/px, alarmes de limite (ISA-18.2, motor da onda 1-a) e o
 * canal de COMANDOS do painel para o operador (gravar referência, encerrar
 * conferência…). O canal de dados é o da onda 1-a (runtime/livres-oa/canal.js),
 * lido pelo painel Medições.
 */
import { dentro } from '../../marcacoes.js';
import { limitesDoTexto, faixaDoNome } from '../livres-oa/mostrador.js';
export { limitesDoTexto, faixaDoNome, dentro };

export const AREAS = ['retangulo', 'poligono', 'elipse', 'mascara'];
const SET_AREAS = new Set(AREAS);

/** Marcações de uma função (áreas por padrão). */
export function marcas(ctx, funcao, tipos = SET_AREAS) {
  const mq = ctx.marcacoes;
  if (!mq) return [];
  const T = tipos instanceof Set ? tipos : new Set(tipos);
  return mq.itens.filter((i) => i.funcao === funcao && T.has(i.tipo) && (i.caixa || (i.px && i.px.length)));
}

/** Caixa {x,y,w,h} (px de `img`) de uma área de ctx.marcacoes. */
export function roiDe(it, img) {
  const c = it.caixa;
  const x = Math.max(0, Math.floor(c.x1 * img.width)), y = Math.max(0, Math.floor(c.y1 * img.height));
  const x2 = Math.min(img.width, Math.ceil(c.x2 * img.width)), y2 = Math.min(img.height, Math.ceil(c.y2 * img.height));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

/** Função (x, y em px de `img`) → dentro da área? (null para retângulo: o recorte já basta.) */
export function mascaraDe(it, img) {
  if (it.tipo === 'retangulo') return null;
  return (x, y) => dentro(it, x / img.width, y / img.height);
}

/**
 * Imagem de análise: o quadro em resolução plena (ctx.grabFull) quando dá,
 * senão o próprio src. → { img, k } com k = px de img por px do quadro.
 */
export function imagemAnalise(ctx, src, largura) {
  const full = ctx.grabFull ? ctx.grabFull(largura) : null;
  if (full && full.width >= src.width) return { img: full, k: full.width / src.width };
  return { img: src, k: 1 };
}

/** mm por px do quadro (régua calibrada nas Ferramentas de mouse) ou null. */
export function mmPorPxQuadro(ctx) {
  const e = ctx.marcacoes && ctx.marcacoes.escala;
  return e && e.mmPorPxQuadro > 0 ? e.mmPorPxQuadro : null;
}

export const fmtN = (v, c = 1) => (Number.isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');

const PRIO_NIVEL = { HH: 1, LL: 1, H: 2, L: 2 };

/** Passo dos alarmes de limite de uma variável (v > H ativa; v < H − banda normaliza). */
export function passoLimites(alarmes, nome, v, limites, banda, p, t, unidade = '') {
  for (const L of limites) {
    const alto = L.nivel[0] === 'H';
    const ok = Number.isFinite(v);
    const bruto = ok && (alto ? v > L.limiar : v < L.limiar);
    const normalOk = !ok || (alto ? v < L.limiar - banda : v > L.limiar + banda);
    alarmes.passo(`${nome} ${L.nivel}`, { prio: PRIO_NIVEL[L.nivel], texto: `${nome}: ${alto ? 'acima' : 'abaixo'} de ${String(L.limiar).replace('.', ',')} ${unidade}`.trim(),
      atrasoOn: p.atrasoOn, atrasoOff: p.atrasoOff }, bruto, normalOk, v, t);
  }
}

export const ALARMES_PARAMS = {
  bandaPct: { type: 'float', min: 0, max: 20, step: 0.5, default: 1, label: 'Banda morta (% do limite)' },
  atrasoOn: { type: 'float', min: 0, max: 600, step: 0.5, default: 2, label: 'Atraso para ativar (s)' },
  atrasoOff: { type: 'float', min: 0, max: 600, step: 0.5, default: 2, label: 'Atraso para normalizar (s)' },
};

// ------------------------------------------------------------------ comandos painel → operador

const fila = new Map();
/** O painel pede uma ação (o operador executa no próximo quadro). */
export function comandar(chave, cmd) {
  if (!fila.has(chave)) fila.set(chave, []);
  fila.get(chave).push(cmd);
}
/** O operador retira os comandos pendentes da sua chave. */
export function tomarComandos(chave) {
  const l = fila.get(chave);
  if (!l || !l.length) return [];
  fila.set(chave, []);
  return l;
}

/** Histórico [[t, v]…] com teto. */
export function empurrar(hist, t, v, max = 3600) {
  hist.push([t, v]);
  if (hist.length > max) hist.splice(0, hist.length - max);
}
