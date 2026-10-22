/**
 * cv/runtime/livres-u/canal.js — canal entre os operadores do grupo U (onda 2-d,
 * CV-80..87) e o painel «Aplicações» (components/livres-u/AplicacoesPanel.js).
 *
 * Reaproveita o canal da onda 1-a (publicar/ler/assinar/zerar por chave, no
 * máximo 4 avisos/s) com chaves prefixadas "u_". Acrescenta COMANDOS do painel
 * para o operador (calibrar o mouse, gravar exemplo de letra, registrar folha,
 * guardar foto…): o painel `pedir(chave, cmd)`, o operador `tomar(chave)` no
 * próximo quadro. Nada sai do navegador.
 */
export { publicar, ler, assinar, zerar, conferirGeracao, tempoDe, csv, hora, vivo } from '../livres-oa/canal.js';

const filas = new Map();

/** Painel → operador: enfileira um comando ({ tipo, ... }). */
export function pedir(chave, cmd) {
  if (!filas.has(chave)) filas.set(chave, []);
  const f = filas.get(chave);
  f.push(cmd);
  if (f.length > 20) f.shift();
}

/** Operador: tira todos os comandos pendentes da chave. */
export function tomar(chave) {
  const f = filas.get(chave);
  if (!f || !f.length) return [];
  filas.set(chave, []);
  return f;
}

/** Guarda/lê JSON no localStorage sem estourar (modo privado, cota). */
export function lerLocal(k, padrao = null) {
  try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : padrao; } catch (_) { return padrao; }
}
export function gravarLocal(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; }
}
