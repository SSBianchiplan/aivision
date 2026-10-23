/**
 * dialogo.js — modais do próprio sistema no lugar das janelas nativas do
 * navegador (confirm, alert e prompt, que mostravam «aivision.gplansis.com diz…»).
 *
 * DOM puro, sem React: serve ao app, a /treino/ (script clássico, via import()) e a /yt/.
 *
 *   await confirmar(msg, { titulo, ok: 'Apagar', cancelar: 'Cancelar', perigo: true })  → true | false
 *   await avisar(msg, { titulo, ok })                                                   → (fecha)
 *   await perguntar(msg, { titulo, padrao, placeholder, validar, ok, cancelar })        → string | null
 *   anunciar(msg, { acao: 'Desfazer', onAcao, duracao })                                 → aviso que some sozinho
 *
 * - Fila: chamadas simultâneas abrem uma de cada vez, na ordem.
 * - Acessibilidade: role="alertdialog", aria-modal, foco preso no modal, Esc cancela,
 *   Enter confirma (foco no OK ou no campo; no Cancelar, cancela), o foco volta ao
 *   elemento de antes e a rolagem do fundo fica travada.
 * - Teclado: o ouvinte é posto em window, na captura, quando o módulo carrega — ANTES
 *   dos atalhos dos Studios (que também ouvem em window/captura). Com um modal aberto,
 *   nenhuma tecla chega ao app: o Esc fecha o modal, não o Studio.
 * - Sobreposição: z-index 9000 (acima dos Studios 5000–6000, dos popovers e da gaveta
 *   da Via). Em tela cheia, o modal entra no elemento em tela cheia (senão não aparece)
 *   e muda junto se a tela cheia mudar com ele aberto.
 * - validar(valor) devolve uma mensagem de erro (string) para manter aberto, ou nada.
 * - CSS próprio (css/dialogo.css), injetado uma vez, com os tokens dos 3 temas.
 *
 * O que NÃO dá para trocar: «beforeunload» precisa do diálogo nativo (o navegador não
 * espera uma Promise ao sair da página). Hoje o código não usa beforeunload.
 */

/* ------------------------------------------------------------------ CSS */
let cssPosto = false;
function injetarCss() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-dlg]')) return;
  const url = new URL('../../css/dialogo.css', import.meta.url);
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = new URL(import.meta.url).searchParams.get('v') || (base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '');
  if (v) url.searchParams.set('v', v);
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = url.href; l.dataset.aivDlg = '1';
  document.head.appendChild(l);
}

/* ------------------------------------------------------------------ util */
let seq = 0;
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const MIDIA = /^(VIDEO|CANVAS|IMG|IFRAME|EMBED|OBJECT)$/;

/** Onde o modal entra: o elemento em tela cheia, se houver (senão o modal some atrás dele). */
function alvo() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (fs && MIDIA.test(fs.tagName)) {   // mídia em tela cheia não tem filhos visíveis: sai da tela cheia
    try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (_) { /* segue */ }
    return document.body;
  }
  return fs || document.body;
}

const FOCAVEIS = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* ------------------------------------------------------------------ fila */
const fila = [];
let aberto = null;   // { raiz, caixa, teclas(e) }

function enfileirar(montar) {
  injetarCss();
  return new Promise((resolve) => { fila.push({ montar, resolve }); proximo(); });
}

function proximo() {
  if (aberto || !fila.length) return;
  const { montar, resolve } = fila.shift();
  abrir(montar, (v) => { resolve(v); setTimeout(proximo, 0); });
}

/** true enquanto há um modal do sistema na tela (ou na fila). */
export function dialogoAberto() { return !!aberto || fila.length > 0; }

/* ------------------------------------------------------------------ teclado (global, na captura) */
function teclaGlobal(e) {
  if (!aberto) return;
  // nada chega aos atalhos do app/Studios enquanto o modal está aberto; o padrão do campo (digitar) continua
  e.stopImmediatePropagation();
  if (e.type === 'keydown') aberto.teclas(e);
}
if (typeof window !== 'undefined') {
  for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, teclaGlobal, true);
  // o foco não sai do modal (clique em algo de fora, programa que chama .focus()). O foco que
  // ENTRA no modal não é anunciado a outras «armadilhas de foco» do app (ex.: o modal das
  // Playlists, que puxaria o foco de volta para ele — pingue-pongue até estourar a pilha).
  let puxando = false;
  document.addEventListener('focusin', (e) => {
    if (!aberto) return;
    if (aberto.caixa.contains(e.target)) { e.stopImmediatePropagation(); return; }
    if (puxando) return;
    puxando = true;
    try { aberto.focarPrimeiro(); } finally { puxando = false; }
  }, true);
}

/* ------------------------------------------------------------------ montagem */
function abrir(montar, fim) {
  const antes = document.activeElement;
  const id = 'aiv-dlg-' + (++seq);
  const o = montar();   // { tipo, mensagem, titulo, okTxt, cancelarTxt, perigo, campo }

  const raiz = el('div', 'aiv-dlg-fundo');
  raiz.dataset.aivDialogo = o.tipo;
  const caixa = el('div', 'aiv-dlg' + (o.perigo ? ' aiv-dlg-perigoso' : ''));
  caixa.setAttribute('role', 'alertdialog');
  caixa.setAttribute('aria-modal', 'true');
  caixa.tabIndex = -1;
  const tit = el('h2', 'aiv-dlg-tit', o.titulo); tit.id = id + '-t';
  const msg = el('p', 'aiv-dlg-msg', o.mensagem); msg.id = id + '-m';
  caixa.setAttribute('aria-labelledby', tit.id);
  caixa.setAttribute('aria-describedby', msg.id);
  caixa.append(tit, msg);

  let campo = null, erro = null;
  if (o.campo) {
    campo = el('input', 'aiv-dlg-campo');
    campo.type = 'text';
    campo.value = o.campo.padrao != null ? String(o.campo.padrao) : '';
    if (o.campo.placeholder) campo.placeholder = o.campo.placeholder;
    campo.setAttribute('aria-labelledby', msg.id);
    campo.autocomplete = 'off'; campo.spellcheck = false;
    erro = el('p', 'aiv-dlg-erro'); erro.id = id + '-e'; erro.setAttribute('role', 'alert'); erro.hidden = true;
    campo.setAttribute('aria-describedby', erro.id);
    campo.addEventListener('input', () => { erro.hidden = true; campo.removeAttribute('aria-invalid'); });
    caixa.append(campo, erro);
  }

  const acoes = el('div', 'aiv-dlg-acoes');
  let bCancelar = null;
  if (o.cancelarTxt) { bCancelar = el('button', 'aiv-dlg-btn', o.cancelarTxt); bCancelar.type = 'button'; acoes.append(bCancelar); }
  const bOk = el('button', 'aiv-dlg-btn aiv-dlg-ok' + (o.perigo ? ' aiv-dlg-perigo' : ''), o.okTxt);
  bOk.type = 'button';
  acoes.append(bOk);
  caixa.append(acoes);
  raiz.append(caixa);

  // rolagem do fundo travada (devolvida ao fechar)
  const html = document.documentElement;
  const ovAntes = html.style.overflow;
  html.style.overflow = 'hidden';
  html.classList.add('aiv-dlg-aberto');

  const focaveis = () => [...caixa.querySelectorAll(FOCAVEIS)];
  const focarPrimeiro = () => { (campo || bOk).focus({ preventScroll: true }); };

  let feito = false;
  const fechar = (v) => {
    if (feito) return;
    feito = true;
    document.removeEventListener('fullscreenchange', mudouTela);
    document.removeEventListener('webkitfullscreenchange', mudouTela);
    raiz.remove();
    aberto = null;
    html.style.overflow = ovAntes;
    if (!fila.length) html.classList.remove('aiv-dlg-aberto');
    if (antes && antes.isConnected && typeof antes.focus === 'function') {
      try { antes.focus({ preventScroll: true }); } catch (_) { /* segue */ }
    }
    fim(v);
  };
  const cancelar = () => fechar(o.tipo === 'perguntar' ? null : o.tipo === 'confirmar' ? false : undefined);
  const confirmarOk = () => {
    if (campo) {
      const v = campo.value;
      const r = typeof o.campo.validar === 'function' ? o.campo.validar(v) : null;
      if (typeof r === 'string' && r) {
        erro.textContent = r; erro.hidden = false; campo.setAttribute('aria-invalid', 'true'); campo.focus();
        return;
      }
      fechar(v);
    } else fechar(o.tipo === 'confirmar' ? true : undefined);
  };

  bOk.addEventListener('click', confirmarOk);
  if (bCancelar) bCancelar.addEventListener('click', cancelar);
  // clique no fundo (começado e terminado nele) = cancelar
  let noFundo = false;
  raiz.addEventListener('pointerdown', (e) => { noFundo = e.target === raiz; });
  raiz.addEventListener('click', (e) => { if (noFundo && e.target === raiz) cancelar(); noFundo = false; });
  // os cliques dentro do modal não vazam para o app (menus que fecham ao clicar fora etc.)
  for (const t of ['pointerdown', 'mousedown', 'click', 'contextmenu', 'wheel']) raiz.addEventListener(t, (e) => e.stopPropagation());

  const teclas = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); cancelar(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (bCancelar && document.activeElement === bCancelar) cancelar();
      else confirmarOk();
      return;
    }
    if (e.key === 'Tab') {
      const f = focaveis(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i === f.length - 1 ? 0 : i + 1);
      f[n].focus();
    }
  };

  const mudouTela = () => { if (!feito) { alvo().append(raiz); focarPrimeiro(); } };
  document.addEventListener('fullscreenchange', mudouTela);
  document.addEventListener('webkitfullscreenchange', mudouTela);

  aberto = { raiz, caixa, teclas, focarPrimeiro };
  alvo().append(raiz);
  focarPrimeiro();
  if (campo) campo.select();
}

/* ------------------------------------------------------------------ API */

/** Substitui o confirm nativo: resolve true (OK) ou false (Cancelar, Esc, clique fora). */
export function confirmar(mensagem, op = {}) {
  return enfileirar(() => ({
    tipo: 'confirmar', mensagem: String(mensagem ?? ''),
    titulo: op.titulo || 'Confirmar', okTxt: op.ok || 'OK', cancelarTxt: op.cancelar || 'Cancelar', perigo: !!op.perigo,
  }));
}

/** Substitui o alert nativo: resolve quando a pessoa fecha. */
export function avisar(mensagem, op = {}) {
  return enfileirar(() => ({
    tipo: 'avisar', mensagem: String(mensagem ?? ''),
    titulo: op.titulo || 'Aviso', okTxt: op.ok || 'Entendi', cancelarTxt: null, perigo: false,
  }));
}

/** Substitui o prompt nativo: resolve com o texto digitado (pode ser '') ou null se cancelar. */
export function perguntar(mensagem, op = {}) {
  return enfileirar(() => ({
    tipo: 'perguntar', mensagem: String(mensagem ?? ''),
    titulo: op.titulo || 'Informe', okTxt: op.ok || 'OK', cancelarTxt: op.cancelar || 'Cancelar', perigo: false,
    campo: { padrao: op.padrao ?? '', placeholder: op.placeholder || '', validar: op.validar },
  }));
}

/* ------------------------------------------------------------------ aviso com «Desfazer» */
let avisoAtual = null;

/**
 * Aviso curto embaixo da tela, que some sozinho (padrão «desfazer» em vez de perguntar antes):
 *   anunciar('2 marcações apagadas', { acao: 'Desfazer', onAcao: desfazer })
 */
export function anunciar(mensagem, op = {}) {
  if (typeof document === 'undefined') return;
  injetarCss();
  if (avisoAtual) avisoAtual.fechar();
  const raiz = el('div', 'aiv-dlg-aviso');
  raiz.setAttribute('role', 'status');
  raiz.setAttribute('aria-live', 'polite');
  raiz.append(el('span', 'aiv-dlg-aviso-txt', String(mensagem ?? '')));
  let t = 0;
  const fechar = () => { clearTimeout(t); raiz.remove(); if (avisoAtual && avisoAtual.raiz === raiz) avisoAtual = null; };
  if (op.acao && typeof op.onAcao === 'function') {
    const b = el('button', 'aiv-dlg-aviso-acao', op.acao); b.type = 'button';
    b.addEventListener('click', () => { fechar(); op.onAcao(); });
    raiz.append(b);
  }
  const x = el('button', 'aiv-dlg-aviso-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar aviso');
  x.addEventListener('click', fechar);
  raiz.append(x);
  // parar o tempo com o mouse em cima (dá tempo de achar o «Desfazer»)
  const dur = op.duracao || 7000;
  const armar = () => { clearTimeout(t); t = setTimeout(fechar, dur); };
  raiz.addEventListener('pointerenter', () => clearTimeout(t));
  raiz.addEventListener('pointerleave', armar);
  for (const ev of ['pointerdown', 'mousedown', 'click']) raiz.addEventListener(ev, (e) => e.stopPropagation());
  alvo().append(raiz);
  armar();
  avisoAtual = { raiz, fechar };
  return fechar;
}
