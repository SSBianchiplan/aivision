/**
 * cv/runtime/livres-n/veredito.js — regras de veredito do CV-40 (porte de
 * domain/verdict.py do GPlanSiS|Inspect). JS puro, sem DOM.
 *
 *   status de ferramenta  PASS · FAIL · UNCERTAIN · ERROR (os mesmos nomes do Inspect,
 *                         para o JSON exportado ser lido lá; a tela mostra OK/NOK/INCERTO/ERRO)
 *   veredito da peça      OK · NOK · INCERTO
 *
 * Só ferramentas CRÍTICAS decidem. Uma reprovação crítica = NOK; senão, uma
 * incerteza (ou erro) crítica = INCERTO; senão OK. ERRO nunca aprova em
 * silêncio: conta como incerto. "A máquina propõe, o humano confirma": OK
 * segue; NOK e INCERTO vão para a fila de revisão.
 */

export const PASS = 'PASS', FAIL = 'FAIL', UNCERTAIN = 'UNCERTAIN', ERROR = 'ERROR';
export const OK = 'OK', NOK = 'NOK', INCERTO = 'INCERTO';

/** Rótulo em português do status de uma ferramenta. */
export const ROTULO_STATUS = { PASS: 'OK', FAIL: 'NOK', UNCERTAIN: 'INCERTO', ERROR: 'ERRO' };
export const RANK = { PASS: 0, UNCERTAIN: 1, ERROR: 1, FAIL: 2 };

/**
 * PASS dentro de [lo, hi]; UNCERTAIN a menos de `band` (relativo à faixa ou
 * ao limite) de uma borda; FAIL fora da faixa além da margem.
 *
 * `scale` troca a referência da margem em limite unilateral de métrica
 * limitada: solidez ≥ 0,95 vive em [0,95; 1], então a margem é band·0,05 e
 * não band·0,95 — senão a peça perfeita (0,996) cairia na incerteza.
 * (Escrita igual à de judge_range, inclusive a precedência dos `or`.)
 */
export function julgarFaixa(v, lo, hi, band, scale = null) {
  const temLo = lo != null, temHi = hi != null;
  const span = scale ? scale : (temLo && temHi && hi > lo) ? hi - lo : Math.max(Math.abs(lo || 0), Math.abs(hi || 0), 1e-9);
  const m = band * span;
  if ((temLo && v < lo - m) || (temHi && v > hi + m)) return FAIL;
  if ((temLo && v < lo + m) || (temHi && v > hi - m)) return UNCERTAIN;
  return PASS;
}

/**
 * Agrega os resultados das ferramentas no veredito da peça.
 * { veredito, nFerramentas, nFalhas, nIncertas } — lança erro sem ferramentas.
 */
export function agregar(resultados) {
  if (!resultados.length) throw new Error('programa sem ferramentas');
  const crit = resultados.filter((r) => r.critical);
  const nFalhas = crit.filter((r) => r.status === FAIL).length;
  const nIncertas = crit.filter((r) => r.status === UNCERTAIN || r.status === ERROR).length;
  const veredito = nFalhas ? NOK : nIncertas ? INCERTO : OK;
  return { veredito, nFerramentas: resultados.length, nFalhas, nIncertas };
}

/** Resultado de ferramenta no formato do ToolResult do Inspect (as_dict). */
export function resultado(spec, status, extra = {}) {
  return {
    code: spec.code, type: spec.type, status, critical: spec.critical !== false,
    value: null, expected: '', confidence: null, detail: {}, overlays: [], ms: 0, ...extra,
  };
}
