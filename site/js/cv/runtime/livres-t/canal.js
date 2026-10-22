/**
 * cv/runtime/livres-t/canal.js — ponte entre os operadores da onda 2-c
 * (CV-70..77) e o painel/Studio, no padrão dos outros canais: o operador
 * publica um RETRATO por chave (o op), o painel assina (no máximo a cada
 * 250 ms); os REGISTROS (medidas fechadas: uma tentativa, uma série, uma
 * captura) ficam aqui, fora do estado do nó, para "Zerar" no painel e para
 * sobreviver à troca de parâmetros. O último quadro é guardado só quando o
 * Studio está aberto. Nada sai do aparelho.
 *
 * Retrato padrão (o painel desenha qualquer operador com ele):
 *   { op, titulo, principal: { valor, unidade, faixa?, rotulo }, linhas: [[rótulo, valor]…],
 *     avisos: [..], saude: bool, serie?: { ts, ys, rotulo }, espectro?: { f, p }, extra? }
 */
const retratos = new Map();
const registros = new Map();
const ouvintes = new Set();
let timer = null, ultimoAviso = 0, studio = false, quadro = null, geracao = 0;

export function publicar(op, r, img = null) {
  retratos.set(op, { ...r, op, tWall: performance.now() });
  if (studio && img) quadro = img;
  avisar();
}
export function instantaneo(op) { return retratos.get(op) || null; }
export function todos() { return retratos; }
export function ultimoQuadro() { return quadro; }
export function definirStudio(v) { studio = Boolean(v); if (!studio) quadro = null; }
export function studioAberto() { return studio; }
/** Operadores (estado do nó) comparam com a sua cópia para zerar junto com o painel. */
export function geracaoAtual() { return geracao; }

export function registrar(op, item) {
  const l = registros.get(op) || [];
  const reg = { n: l.length + 1, quando: new Date().toISOString(), ...item };
  l.push(reg);
  registros.set(op, l);
  avisar(true);
  return reg;
}
export function registrosDe(op) { return registros.get(op) || []; }
export function zerar(op = null) {
  if (op) { registros.delete(op); retratos.delete(op); } else { registros.clear(); retratos.clear(); }
  geracao++;
  avisar(true);
}

/** Pedidos do painel ao operador (gravar referência, capturar…): o operador consome no próximo quadro. */
const pedidos = new Map();
export function pedir(op, acao, dados = null) { pedidos.set(op, { acao, dados, t: performance.now() }); }
export function consumirPedido(op) { const p = pedidos.get(op); if (p) pedidos.delete(op); return p || null; }

function avisar(ja = false) {
  const chamar = () => { for (const f of ouvintes) { try { f(); } catch (_) { /* painel desmontando */ } } };
  if (ja) { ultimoAviso = performance.now(); chamar(); return; }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => { timer = null; ultimoAviso = performance.now(); chamar(); }, espera);
}
export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

// ------------------------------------------------------------- persistência leve (referências)

const CHAVE = 'aiv.onda2c.v1';
function ler() { try { return JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (_) { return {}; } }
function gravar(o) { try { localStorage.setItem(CHAVE, JSON.stringify(o)); return true; } catch (_) { return false; } }
/** Referências salvas (movimento e poses de yoga): { [tipo]: { [nome]: dados } }. Só neste navegador. */
export function referencias(tipo) { return (ler().ref || {})[tipo] || {}; }
export function salvarReferencia(tipo, nome, dados) {
  const o = ler(); o.ref = o.ref || {}; o.ref[tipo] = o.ref[tipo] || {};
  o.ref[tipo][nome] = { ...dados, salvo: new Date().toISOString() };
  const ok = gravar(o); avisar(true); return ok;
}
export function apagarReferencia(tipo, nome) {
  const o = ler(); if (o.ref && o.ref[tipo]) delete o.ref[tipo][nome]; gravar(o); avisar(true);
}
/** Tabela PROESP-BR carregada pelo usuário (CSV do manual): ver runtime/livres-t/esportes.js. */
export function tabelaProesp() { return ler().proesp || null; }
export function salvarTabelaProesp(t) { const o = ler(); o.proesp = t; const ok = gravar(o); avisar(true); return ok; }
