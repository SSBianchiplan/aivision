/**
 * cv/runtime/livres-j/canal.js — ponte entre o operador quadra.analise e o
 * painel Quadra (o executor não expõe o ctx a ninguém fora da cadeia).
 *
 * Mora aqui a SESSÃO (a súmula da partida), e não no estado do nó: "Nova
 * sessão" no painel precisa zerá-la, e apagar/recriar o nó não deve jogar
 * fora uma partida já medida. O painel também pede por aqui um quadro
 * (miniatura JPEG) para a calibração por cliques.
 */
import { Sessao } from './sessao.js';

const sessao = new Sessao();
const ouvintes = new Set();
let retrato = null;
let quadro = null;            // { url, w, h, t }
let querQuadro = 0;           // até quando (ms) o painel quer miniaturas
let pausado = false;
let geracao = 0;
let timer = null;
let ultimoAviso = 0;

export function obterSessao() { return sessao; }
export function instantaneo() { return retrato; }
export function ultimoQuadro() { return quadro; }
export function geracaoSessao() { return geracao; }
export function estaPausado() { return pausado; }

/** O operador chama a cada inferência nova; o painel é avisado no máximo 4×/s. */
export function publicar(r) { retrato = r; avisar(); }
export function publicarQuadro(q) { quadro = q; avisar(true); }

/** O painel pede miniaturas por alguns segundos (renova enquanto calibra). */
export function pedirQuadro(ms = 4000) { querQuadro = performance.now() + ms; }
export function quadroPedido() { return performance.now() < querQuadro; }

function avisar(ja = false) {
  if (ja) { ultimoAviso = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } } return; }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => {
    timer = null; ultimoAviso = performance.now();
    for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } }
  }, espera);
}

export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

export function zerarSessao() {
  sessao.zerar();
  geracao++;
  retrato = null;
  avisar(true);
}
export function definirPausado(v) { pausado = Boolean(v); avisar(true); }
