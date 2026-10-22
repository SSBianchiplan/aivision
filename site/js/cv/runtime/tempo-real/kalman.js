/**
 * cv/runtime/tempo-real/kalman.js — filtro de velocidade constante por eixo,
 * com o TEMPO de verdade (ms), não «por quadro».
 *
 * O rastreio antigo guardava a velocidade em «unidades por chamada»: com o
 * detector a 3 inferências/s e o laço a 30 quadros/s, a mesma caixa voltava
 * 10 vezes e a velocidade decaía a zero entre uma inferência e outra. Aqui
 * cada eixo (centro x, centro y) é um Kalman 1-D de posição e velocidade:
 * prever(dt) anda a posição, atualizar(z) corrige com a medida. As
 * unidades são as da caixa (normalizadas no quadro); `escala` (a largura da
 * caixa) dimensiona os ruídos — um carro de 40 px e um de 400 px têm o mesmo
 * comportamento relativo.
 */

/** Aceleração aparente esperada (larguras de caixa / s²) — perspectiva, frenagem. */
const ACEL = 1.5;
/** Ruído da medida (fração da largura da caixa). */
const RUIDO = 0.06;
/** Incerteza inicial da velocidade (larguras / s). */
const V0 = 4;

export function novoEixo(z, escala) {
  const r = (RUIDO * escala) ** 2;
  return { p: z, v: 0, a: r, b: 0, c: (V0 * escala) ** 2 };
}

/** Anda o eixo `dt` segundos (in place). */
export function prever(e, dt, escala) {
  if (!(dt > 0)) return e;
  const q = (ACEL * escala) ** 2;
  const dt2 = dt * dt, dt3 = dt2 * dt;
  e.p += e.v * dt;
  // P = F P F' + Q (aceleração branca)
  const a = e.a + 2 * dt * e.b + dt2 * e.c + (q * dt3) / 3;
  const b = e.b + dt * e.c + (q * dt2) / 2;
  const c = e.c + q * dt;
  e.a = a; e.b = b; e.c = c;
  return e;
}

/** Corrige com a medida `z` (in place). */
export function atualizar(e, z, escala) {
  const r = (RUIDO * escala) ** 2;
  const s = e.a + r;
  const k0 = e.a / s, k1 = e.b / s;
  const y = z - e.p;
  e.p += k0 * y;
  e.v += k1 * y;
  const a = (1 - k0) * e.a, b = (1 - k0) * e.b, c = e.c - k1 * e.b;
  e.a = a; e.b = b; e.c = c;
  return e;
}

/** Posição prevista `dt` s à frente, sem mexer no estado. */
export function posEm(e, dt) {
  return e.p + e.v * (dt > 0 || dt < 0 ? dt : 0);
}
