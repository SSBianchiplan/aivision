/**
 * cv/runtime/tempo-real/carimbo.js — de QUANDO são as detecções da cadeia.
 *
 * O detector infere fora do laço de quadros (opkit.schedule): o resultado de
 * uma inferência é republicado em ctx.detections a cada quadro até o próximo
 * chegar. Para quem vem depois, isso parecia «detecção nova» a cada quadro —
 * o rastreio re-casava a MESMA caixa, zerava a velocidade e desenhava a
 * caixa onde o veículo ESTAVA quando o quadro inferido foi capturado.
 *
 * O carimbo diz qual inferência (seq) e o instante do quadro inferido (t, no
 * relógio de ctx.tQuadro). Vale só para a lista que o detector publicou: se
 * outro nó trocar ctx.detections depois, `lista` deixa de bater e quem lê
 * ignora o carimbo.
 */

/** Publica o carimbo do resultado atual de `state` (ver opkit.schedule). */
export function carimbar(ctx, state) {
  ctx.detectionsCarimbo = { seq: state.resultsSeq | 0, t: state.resultsT, lista: ctx.detections };
}

/** Carimbo válido para a lista atual de ctx.detections, ou null. */
export function carimboAtual(ctx) {
  const c = ctx && ctx.detectionsCarimbo;
  return c && c.lista === ctx.detections ? c : null;
}

/**
 * Relógio do quadro em execução (ms, o mesmo de ctx.tQuadro), mantido pelo executor durante a
 * cadeia. É o carimbo padrão de quem agenda inferência (opkit.schedule) sem passar o instante: o
 * preparo da entrada roda dentro do apply, então o quadro inferido é o deste relógio.
 */
export const relogio = { tQuadro: NaN };

/** Para quem guarda o resultado fora do `state` do nó: o desenho deste quadro é do instante `t`. */
export function carimbarDesenho(ctx, t) {
  if (ctx && Number.isFinite(t)) ctx.tResultado = t;
}
