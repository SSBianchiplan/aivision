/**
 * cv/numfmt.js — número no formato brasileiro com Intl.NumberFormat EM CACHE.
 *
 * `v.toLocaleString('pt-BR', { … })` cria um formatador novo a CADA chamada
 * (resolve locale e opções toda vez): nas faixas e indicadores redesenhados a
 * cada quadro (BeltScan, CounterVision, Takt, Inspect) isso somava 2–3 % da
 * thread principal. Pela especificação, toLocaleString(loc, opç) é exatamente
 * new Intl.NumberFormat(loc, opç).format(v) — o texto é idêntico.
 */
const cache = new Map();

/** Igual a v.toLocaleString('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max }). */
export function numBR(v, min, max) {
  const k = min + '|' + max;
  let f = cache.get(k);
  if (!f) {
    const o = {};
    if (min !== undefined) o.minimumFractionDigits = min;
    if (max !== undefined) o.maximumFractionDigits = max;
    f = new Intl.NumberFormat('pt-BR', o);
    cache.set(k, f);
  }
  return f.format(v);
}
