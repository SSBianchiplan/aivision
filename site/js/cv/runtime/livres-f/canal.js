/**
 * cv/runtime/livres-f/canal.js — ponte entre o operador Ergonomia e o painel.
 *
 * O executor não expõe o ctx do quadro a ninguém fora da cadeia, então o
 * operador publica aqui um retrato do que avaliou (pessoas, notas, avisos) e
 * o painel assina — no máximo 4×/s. A SESSÃO (tempo por nível, picos,
 * alertas) e o RASTREADOR (IDs das pessoas) também moram aqui, e não no
 * estado do nó: "Nova sessão" no painel precisa zerá-los, e apagar/recriar
 * o nó no Pipeline não deve jogar fora uma sessão gravada.
 */
import { Sessao, Rastreador } from './ergonomia.js';

const sessao = new Sessao();
const rastreador = new Rastreador();
const ouvintes = new Set();
let retrato = null;
let gravando = true;
let geracao = 0;
let timer = null;
let ultimoAviso = 0;

export function obterSessao() { return sessao; }
export function obterRastreador() { return rastreador; }
export function estaGravando() { return gravando; }
export function geracaoSessao() { return geracao; }
export function instantaneo() { return retrato; }

/** O operador chama a cada quadro; o painel é avisado no máximo a cada 250 ms. */
export function publicar(r) {
  retrato = r;
  avisar();
}

function avisar(ja = false) {
  if (ja) {
    ultimoAviso = performance.now();
    for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } }
    return;
  }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => {
    timer = null; ultimoAviso = performance.now();
    for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } }
  }, espera);
}

export function assinar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function zerarSessao() {
  sessao.zerar();
  rastreador.zerar();
  geracao++;
  gravando = true;
  // o retrato não pode carregar as pessoas da sessão anterior
  if (retrato) retrato = { ...retrato, pessoas: [] };
  avisar(true);
}

export function definirGravando(v) {
  gravando = Boolean(v);
  avisar(true);
}
