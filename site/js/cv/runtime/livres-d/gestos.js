/**
 * cv/runtime/livres-d/gestos.js — gestos por REGRAS sobre os 21 pontos da mão.
 *
 * Sem modelo: o que decide é a geometria. Os pontos seguem o MediaPipe Hands:
 *   0 pulso · 1-4 polegar (CMC, MCP, IP, ponta) · 5-8 indicador (MCP, PIP, DIP,
 *   ponta) · 9-12 médio · 13-16 anelar · 17-20 mínimo.
 *
 * Tudo é medido em unidades do PALMO (pulso → base do médio), para não
 * depender da distância da mão à câmera, e com distâncias e ângulos — nunca
 * com "y menor = para cima" — para valer com a mão girada. A única exceção é
 * polegar para cima/baixo, que por definição se refere à vertical da imagem.
 *
 * Arquivo puro (sem DOM): dá para testar com node.
 */

export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Ângulo (graus) entre os vetores a→b e c→e. 0 = mesma direção (dedo reto). */
function bend(a, b, c, e) {
  const ux = b.x - a.x, uy = b.y - a.y, vx = e.x - c.x, vy = e.y - c.y;
  const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
  if (!n) return 180;
  return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n))) * 180) / Math.PI;
}

/**
 * Quais dedos estão esticados: [polegar, indicador, médio, anelar, mínimo].
 *
 * Dedo longo: ponta mais longe do pulso que a junta do meio (PIP) e a falange
 * MCP→PIP alinhada com DIP→ponta. No punho a ponta volta para perto do pulso.
 * Polegar: reto (CMC→MCP alinhado com IP→ponta) E com a ponta afastada da base
 * do indicador — no punho ele cruza por cima dos outros dedos.
 */
export function fingerStates(P) {
  const palm = d(P[0], P[9]) || 1;
  const longos = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].map(([m, p, q, t]) =>
    d(P[0], P[t]) > d(P[0], P[p]) * 1.1 && bend(P[m], P[p], P[q], P[t]) < 60);
  const polegar = bend(P[1], P[2], P[3], P[4]) < 40 &&
    d(P[4], P[5]) > 0.55 * palm && d(P[4], P[9]) > d(P[3], P[9]) * 1.05;
  return [polegar, ...longos];
}

/**
 * Classifica. Devolve { nome, dedos (contagem), estados }.
 * Ordem importa: OK antes de "mão aberta" (no OK três dedos ficam esticados).
 */
export function classifyGesture(P) {
  const palm = d(P[0], P[9]) || 1;
  const est = fingerStates(P);
  const [po, ind, med, ane, min] = est;
  const n = est.filter(Boolean).length;
  let nome;

  const pinca = d(P[4], P[8]) < 0.35 * palm;
  const vertPolegar = (P[2].y - P[4].y) / palm;          // >0: ponta acima da base
  const vertical = Math.abs(P[4].y - P[2].y) > 1.5 * Math.abs(P[4].x - P[2].x);

  if (pinca && med && ane && min) nome = 'OK';
  else if (n === 5) nome = 'mão aberta';
  else if (!ind && !med && !ane && !min && po && vertical && vertPolegar > 0.5) nome = 'polegar para cima';
  else if (!ind && !med && !ane && !min && po && vertical && vertPolegar < -0.5) nome = 'polegar para baixo';
  else if (!ind && !med && !ane && !min && !po) nome = 'punho';
  else if (ind && med && !ane && !min) nome = 'V';
  else if (ind && !med && !ane && !min) nome = 'apontando';
  else if (ind && !med && !ane && min) nome = 'chifres';
  else nome = n + (n === 1 ? ' dedo' : ' dedos');
  return { nome, dedos: n, estados: est };
}
