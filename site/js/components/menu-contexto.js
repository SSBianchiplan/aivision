/**
 * components/menu-contexto.js — o MENU DE CONTEXTO (clique direito) sobre uma
 * área da imagem: no vídeo ao vivo (marcacoes-vista.js) e no editor de prints
 * do +Projeto (projeto-editor.js) — e o MENU DA TELA (layout/menu-tela.js), no
 * fundo da tela principal e no cartão inicial, com as funções gerais.
 *
 * É um REGISTRO DE AÇÕES extensível: cada módulo registra os seus itens com
 * `registrarAcao({ id, rotulo, grupo, ordem, quando(ctx), itens(ctx), executar(ctx, sub) })`
 * e o menu mostra, na ordem dos grupos, só os itens cuja condição vale para
 * aquele clique. Aqui moram as funções do SISTEMA (detectar, OCR, código,
 * Via, copiar, duplicar, apagar); o +Projeto registra as suas em
 * projeto/acoes.js e as marcações (ROI, exclusão, zona, medir, Inspect) em
 * marcacoes-vista.js.
 *
 * Cada ação vale para os contextos de `contextos` (padrão ['video', 'editor']):
 * o menu da tela ('tela') só mostra as ações registradas para ele.
 *
 * Submenus aninham: um item de `itens(ctx)` com `itens: [...]` abre outro
 * nível (▸); `{ sep: true }` separa grupos; `tecla` aparece à direita.
 *
 * O CONTEXTO (`ctx`) é montado por quem abriu o menu:
 *   origem       'video' | 'editor' | 'tela'
 *   area         { x1, y1, x2, y2 } em 0–1 da imagem (null = a imagem inteira)
 *   item         a forma clicada { id, tipo, cls?, funcao?, nome? } ou null
 *   recorte()    Promise<canvas> da área (ou da imagem inteira), em px da imagem
 *   retanguloTela()  { x, y, w, h } da área em px da janela (onde pôr o balão)
 *   adaptadores opcionais — a ação só aparece se quem abriu oferece:
 *     rotular(cls) · trocarClasse(cls) · apagar() · duplicar() ·
 *     adicionarCaixas([{ x1, y1, x2, y2, nome, score, cls? }]) · criar(ferr, pts, extra) ·
 *     definirFuncao(funcao) · moverParaPasta(pasta) · usarComoRotulo(texto)
 *
 * Os RESULTADOS (texto lido, objetos, códigos) aparecem num BALÃO junto da
 * área, com botões para virar rótulo/caixa.
 *
 * Acessível: role="menu"/"menuitem", setas, Home/End, → abre submenu, ←
 * volta, Enter/Espaço executa, Esc fecha e devolve o foco; Shift+F10 e a
 * tecla Menu abrem (quem abre trata a tecla); no celular, toque longo. Só
 * intercepta o menu do navegador SOBRE o vídeo/editor — fora deles fica o
 * menu de sempre.
 */

// ------------------------------------------------------------- registro

const acoes = new Map();
const GRUPOS = {
  // menu da tela (layout/menu-tela.js)
  'tela.fonte': 1, 'tela.projeto': 2, 'tela.paineis': 3, 'tela.layout': 4, 'tela.tema': 5, 'tela.util': 6,
  projeto: 10, sistema: 20, processamento: 30, marcacao: 40,
  tela: 90,   // «Tela ▸» no fim do menu do vídeo
};

/**
 * def: { id, rotulo (texto ou fn(ctx)), grupo, ordem, contextos (['video', 'editor']),
 *        quando(ctx) → bool, tecla,
 *        itens(ctx) → [{ id, rotulo, cor, desativado, tecla, itens?, sep? }] (submenu),
 *        executar(ctx, subId) }
 */
export function registrarAcao(def) {
  if (!def || !def.id) throw new Error('ação sem id');
  acoes.set(def.id, def);
  return () => acoes.delete(def.id);
}

export function listarAcoes(ctx) {
  const out = [];
  for (const a of acoes.values()) {
    if (ctx && ctx.origem && !(a.contextos || ['video', 'editor']).includes(ctx.origem)) continue;
    let ok = false;
    try { ok = !a.quando || a.quando(ctx); } catch (_) { ok = false; }
    if (!ok) continue;
    let sub = null;
    if (a.itens) { try { sub = a.itens(ctx) || []; } catch (_) { sub = []; } if (!sub.length) continue; }
    out.push({ a, sub, rotulo: typeof a.rotulo === 'function' ? a.rotulo(ctx) : a.rotulo, tecla: a.tecla });
  }
  return out.sort((x, y) => (GRUPOS[x.a.grupo] || 50) - (GRUPOS[y.a.grupo] || 50) || (x.a.ordem || 0) - (y.a.ordem || 0));
}

// ------------------------------------------------------------- CSS

let cssPosto = false;
export function injetarCssProjeto() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-projeto]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/projeto.css' + (v ? '?v=' + v : ''); l.dataset.aivProjeto = '1';
  document.head.appendChild(l);
}

// ------------------------------------------------------------- menu

let aberto = null;   // { menus: [el…], ctx, foco, fora }

const estreito = () => window.innerWidth <= 600;

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function posicionar(m, x, y, junto = null) {
  m.style.left = '0px'; m.style.top = '0px';
  const r = m.getBoundingClientRect();
  const W = window.innerWidth, H = window.innerHeight;
  let l = x, t = y;
  if (junto) {
    l = junto.right - 2; t = junto.top - 4;
    if (l + r.width > W - 6) l = Math.max(6, junto.left - r.width + 2);
  }
  if (l + r.width > W - 6) l = Math.max(6, W - r.width - 6);
  if (t + r.height > H - 6) t = Math.max(6, H - r.height - 6);
  m.style.left = Math.round(l) + 'px'; m.style.top = Math.round(t) + 'px';
}

/** Fecha o menu (e os submenus). `foco` devolve o foco a quem estava com ele. */
export function fecharMenu(foco = true) {
  if (!aberto) return;
  const a = aberto;
  aberto = null;
  for (const m of a.menus) m.remove();
  document.removeEventListener('pointerdown', a.fora, true);
  window.removeEventListener('resize', a.fecha);
  window.removeEventListener('blur', a.fecha);
  if (foco && a.foco && a.foco.focus) { try { a.foco.focus({ preventScroll: true }); } catch (_) { /* segue */ } }
}

export const menuAberto = () => Boolean(aberto);

/**
 * Abre o menu em (x, y) — px da janela — para o contexto `ctx`.
 * Devolve false se não há nenhuma ação para ele.
 */
export function abrirMenu(ctx, x, y) {
  injetarCssProjeto();
  fecharMenu(false);
  const lista = listarAcoes(ctx);
  if (!lista.length) return false;
  const foco = document.activeElement;
  aberto = { menus: [], ctx, foco };
  aberto.fora = (e) => { if (!e.target.closest || !e.target.closest('.mctx')) fecharMenu(false); };
  aberto.fecha = () => fecharMenu(false);
  document.addEventListener('pointerdown', aberto.fora, true);
  window.addEventListener('resize', aberto.fecha);
  window.addEventListener('blur', aberto.fecha);
  const raiz = montarMenu(ctx, lista, 0, titulo(ctx));
  document.body.appendChild(raiz);
  aberto.menus.push(raiz);
  posicionar(raiz, x, y);
  const p = raiz.querySelector('[role^=menuitem]');
  if (p) p.focus({ preventScroll: true });
  return true;
}

function titulo(ctx) {
  if (ctx.origem === 'tela') return ctx.titulo || 'Tela';
  if (ctx.item) return ctx.item.nome || 'Marcação';
  if (ctx.area) {
    const a = ctx.area;
    return `Área ${Math.round(Math.abs(a.x2 - a.x1) * 100)}% × ${Math.round(Math.abs(a.y2 - a.y1) * 100)}%`;
  }
  return ctx.origem === 'editor' ? 'Imagem inteira' : 'Quadro inteiro';
}

function montarMenu(ctx, lista, nivel, cab, voltar = null) {
  const m = el('div', 'mctx' + (nivel ? ' mctx-sub' : ''));
  m.setAttribute('role', 'menu');
  m.setAttribute('aria-label', cab);
  m.dataset.nivel = nivel;
  m.addEventListener('keydown', (e) => teclas(e, m));
  m.addEventListener('contextmenu', (e) => e.preventDefault());
  const h = el('div', 'mctx-cab', cab);
  h.setAttribute('aria-hidden', 'true');
  m.appendChild(h);
  if (voltar) {
    const b = item('‹ Voltar', () => voltar());
    b.classList.add('mctx-voltar');
    m.appendChild(b);
  }
  let grupo = null;
  for (const it of lista) {
    if (it.a && grupo != null && it.a.grupo !== grupo) { const s = el('div', 'mctx-sep'); s.setAttribute('role', 'separator'); m.appendChild(s); }
    if (it.a) grupo = it.a.grupo;
    m.appendChild(it.sub ? itemSub(ctx, it, nivel, m) : item(it.rotulo, () => executar(ctx, it.a), it.cor, it.desativado, it.tecla));
  }
  return m;
}

function item(rotulo, fazer, cor = null, desativado = false, tecla = null) {
  const b = el('button', 'mctx-i');
  b.type = 'button';
  b.setAttribute('role', 'menuitem');
  b.tabIndex = -1;
  if (cor) { const i = el('i', 'mctx-cor'); i.style.background = cor; b.appendChild(i); }
  b.appendChild(el('span', null, rotulo));
  if (tecla) b.appendChild(el('em', 'mctx-tecla', tecla));
  if (desativado) b.disabled = true;
  b.addEventListener('click', (e) => { e.stopPropagation(); fazer(); });
  b.addEventListener('pointerenter', () => { b.focus({ preventScroll: true }); fecharSubsDepois(+b.closest('.mctx').dataset.nivel); });
  return b;
}

function itemSub(ctx, it, nivel, menu) {
  const b = item(it.rotulo, () => abrirSub(ctx, it, nivel, b, menu, true));
  b.setAttribute('aria-haspopup', 'menu');
  b.setAttribute('aria-expanded', 'false');
  b.appendChild(el('em', 'mctx-seta', '▸'));
  b.dataset.sub = '1';
  b.addEventListener('pointerenter', () => { if (!estreito()) abrirSub(ctx, it, nivel, b, menu, false); });
  b._abrir = (focar) => abrirSub(ctx, it, nivel, b, menu, focar);
  return b;
}

function fecharSubsDepois(nivel) {
  if (!aberto) return;
  while (aberto.menus.length > nivel + 1) {
    const m = aberto.menus.pop();
    m.remove();
  }
  const m = aberto.menus[nivel];
  if (m) for (const b of m.querySelectorAll('[aria-expanded=true]')) b.setAttribute('aria-expanded', 'false');
}

/**
 * Itens de um submenu: folha executa a ação com o id do item; item com
 * `itens` abre mais um nível; `{ sep: true }` vira separador.
 */
function preencherSub(ctx, it, sub, nivel) {
  for (const s of it.sub) {
    if (s.sep) { if (sub.lastChild && !sub.lastChild.classList.contains('mctx-sep') && sub.querySelector('[role=menuitem]')) { const d = el('div', 'mctx-sep'); d.setAttribute('role', 'separator'); sub.appendChild(d); } continue; }
    if (s.itens) {
      if (!s.itens.length) continue;
      sub.appendChild(itemSub(ctx, { a: it.a, sub: s.itens, rotulo: s.rotulo }, nivel, sub));
    } else sub.appendChild(item(s.rotulo, () => executar(ctx, it.a, s.id), s.cor, s.desativado, s.tecla));
  }
}

function abrirSub(ctx, it, nivel, botao, menu, focar) {
  if (!aberto) return;
  fecharSubsDepois(nivel);
  if (estreito()) {
    // celular: o submenu ENTRA no lugar do menu, com «‹ Voltar»
    const r = menu.getBoundingClientRect();
    const voltar = () => { sub.remove(); aberto.menus.pop(); menu.style.display = ''; const f = menu.querySelector('[role=menuitem]'); if (f) f.focus(); };
    const sub = montarMenu(ctx, [], nivel + 1, it.rotulo, voltar);
    preencherSub(ctx, it, sub, nivel + 1);
    menu.style.display = 'none';
    document.body.appendChild(sub);
    aberto.menus.push(sub);
    posicionar(sub, r.left, r.top);
    const p = sub.querySelector('[role=menuitem]:not(.mctx-voltar)') || sub.querySelector('[role=menuitem]');
    if (p) p.focus({ preventScroll: true });
    return;
  }
  const sub = montarMenu(ctx, [], nivel + 1, it.rotulo);
  preencherSub(ctx, it, sub, nivel + 1);
  document.body.appendChild(sub);
  aberto.menus.push(sub);
  sub._botao = botao;
  botao.setAttribute('aria-expanded', 'true');
  posicionar(sub, 0, 0, botao.getBoundingClientRect());
  if (focar) { const p = sub.querySelector('[role=menuitem]'); if (p) p.focus({ preventScroll: true }); }
}

function teclas(e, m) {
  const its = [...m.querySelectorAll('[role=menuitem]:not([disabled])')];
  const i = its.indexOf(document.activeElement);
  const k = e.key;
  const nivel = +m.dataset.nivel;
  if (k === 'ArrowDown') its[(i + 1) % its.length].focus();
  else if (k === 'ArrowUp') its[(i - 1 + its.length) % its.length].focus();
  else if (k === 'Home') its[0].focus();
  else if (k === 'End') its[its.length - 1].focus();
  else if (k === 'ArrowRight' && i >= 0 && its[i]._abrir) its[i]._abrir(true);
  else if (k === 'ArrowLeft' && nivel > 0) {
    const v = m.querySelector('.mctx-voltar');
    if (v) v.click();
    else { const b = m._botao; fecharSubsDepois(nivel - 1); if (b) b.focus(); }
  } else if (k === 'Escape') fecharMenu(true);
  else if (k === 'Tab') { fecharMenu(true); }
  else if (k === 'Enter' || k === ' ') { if (i >= 0) its[i].click(); }
  else return;
  e.preventDefault();
  e.stopPropagation();
}

async function executar(ctx, a, sub) {
  fecharMenu(true);
  try {
    await a.executar(ctx, sub);
  } catch (e) {
    console.error('[menu de contexto]', a.id, e);
    mostrarBalao(ctx, { titulo: typeof a.rotulo === 'function' ? a.rotulo(ctx) : a.rotulo, linhas: ['⚠ ' + (e && e.message ? e.message : 'falhou')] });
  }
}

// ------------------------------------------------------------- balão

let balao = null;

/**
 * Balão de resultado junto da área: { titulo, linhas: [texto], acoes: [{ rotulo, fazer }], carregando }.
 * Devolve { atualizar(conteudo), fechar() }. Um balão por vez.
 */
export function mostrarBalao(ctx, conteudo) {
  injetarCssProjeto();
  fecharBalao();
  const b = el('div', 'mctx-balao');
  b.setAttribute('role', 'status');
  b.setAttribute('aria-live', 'polite');
  document.body.appendChild(b);
  const h = { el: b, ctx };
  const pintar = (c) => {
    b.textContent = '';
    const cab = el('div', 'mctx-balao-cab');
    cab.appendChild(el('b', null, c.titulo || 'Resultado'));
    const x = el('button', 'mctx-balao-x', '✕');
    x.type = 'button'; x.setAttribute('aria-label', 'Fechar o resultado');
    x.addEventListener('click', fecharBalao);
    cab.appendChild(x);
    b.appendChild(cab);
    if (c.carregando) b.appendChild(el('p', 'mctx-balao-l mctx-carregando', c.carregando));
    for (const l of c.linhas || []) b.appendChild(el('p', 'mctx-balao-l', l));
    if (c.acoes && c.acoes.length) {
      const f = el('div', 'mctx-balao-acoes');
      for (const a of c.acoes) {
        const bt = el('button', 'btn tiny' + (a.destaque ? ' accent' : ''), a.rotulo);
        bt.type = 'button';
        bt.addEventListener('click', async () => { try { await a.fazer(); if (!a.manter) fecharBalao(); } catch (e) { pintar({ ...c, linhas: [...(c.linhas || []), '⚠ ' + e.message] }); } });
        f.appendChild(bt);
      }
      b.appendChild(f);
    }
    // junto da área (à direita; sem espaço, embaixo; no celular, no rodapé)
    let r = null;
    try { r = ctx && ctx.retanguloTela ? ctx.retanguloTela() : null; } catch (_) { r = null; }
    const W = window.innerWidth, H = window.innerHeight;
    const bw = b.offsetWidth, bh = b.offsetHeight;
    let l, t;
    if (!r || W <= 600) { l = (W - bw) / 2; t = H - bh - 12; }
    else {
      l = r.x + r.w + 10; t = r.y;
      if (l + bw > W - 8) { l = Math.max(8, Math.min(r.x, W - bw - 8)); t = r.y + r.h + 10; }
      if (t + bh > H - 8) t = Math.max(8, r.y - bh - 10);
    }
    b.style.left = Math.max(8, Math.round(l)) + 'px';
    b.style.top = Math.max(8, Math.round(t)) + 'px';
  };
  h.atualizar = (c) => { if (balao === h) pintar(c); };
  h.fechar = () => { if (balao === h) fecharBalao(); };
  balao = h;
  pintar(conteudo);
  return h;
}

export function fecharBalao() {
  if (balao) { balao.el.remove(); balao = null; }
}

// ------------------------------------------------------------- utilidades para as ações

/** Canvas → ImageData. */
export function dadosDe(c) {
  return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
}

const blobDe = (c, tipo = 'image/png', q) => new Promise((res) => c.toBlob(res, tipo, q));

/** Área do contexto (ou a imagem inteira) em 0–1. */
export const areaDe = (ctx) => ctx.area || { x1: 0, y1: 0, x2: 1, y2: 1 };

const pct = (s) => `${Math.round(s * 100)}%`;

// ------------------------------------------------------------- ações do sistema

registrarAcao({
  id: 'sis.detectar', grupo: 'sistema', ordem: 10, rotulo: 'Detectar objetos aqui',
  async executar(ctx) {
    const h = mostrarBalao(ctx, { titulo: 'Objetos', carregando: 'detectando (YOLOX · COCO)…' });
    const c = await ctx.recorte();
    if (!c) throw new Error('sem imagem');
    const m = await import('../cv/runtime/livres-n/modelos.js');
    const r = await m.detectar(dadosDe(c), { modelo: 'yolox', conf: 0.35 });
    const a = areaDe(ctx), aw = a.x2 - a.x1, ah = a.y2 - a.y1;
    const objs = r.dets.slice(0, 30).map((d) => ({
      x1: a.x1 + (d[0] / c.width) * aw, y1: a.y1 + (d[1] / c.height) * ah, x2: a.x1 + (d[2] / c.width) * aw, y2: a.y1 + (d[3] / c.height) * ah,
      score: d[4], nome: r.rotulos[d[5]] || `#${d[5]}`,
    }));
    h.atualizar({
      titulo: `Objetos (${objs.length})`,
      linhas: objs.length ? objs.map((o) => `${o.nome} · ${pct(o.score)}`) : ['nada encontrado com confiança ≥ 35%'],
      acoes: objs.length && ctx.adicionarCaixas ? [{ rotulo: 'Marcar como caixas', destaque: true, fazer: () => ctx.adicionarCaixas(objs) }] : [],
    });
  },
});

registrarAcao({
  id: 'sis.ocr', grupo: 'sistema', ordem: 20, rotulo: 'Ler texto (OCR) aqui',
  async executar(ctx) {
    const h = mostrarBalao(ctx, { titulo: 'Texto', carregando: 'lendo (PP-OCRv5)…' });
    const c = await ctx.recorte();
    if (!c) throw new Error('sem imagem');
    const m = await import('../cv/runtime/livres-n/modelos.js');
    const linhas = await m.lerTexto(dadosDe(c));
    const txt = linhas.map((l) => l.text).join(' ').trim();
    ctx.ultimoTexto = txt;
    h.atualizar({
      titulo: `Texto (${linhas.length} ${linhas.length === 1 ? 'linha' : 'linhas'})`,
      linhas: linhas.length ? linhas.map((l) => `${l.text}  · ${pct(l.score)}`) : ['nenhum texto encontrado'],
      acoes: txt ? [
        { rotulo: 'Copiar texto', fazer: () => navigator.clipboard && navigator.clipboard.writeText(txt) },
        ...(ctx.usarComoRotulo ? [{ rotulo: 'Usar como rótulo', destaque: true, fazer: () => ctx.usarComoRotulo(txt) }] : []),
      ] : [],
    });
  },
});

registrarAcao({
  id: 'sis.codigo', grupo: 'sistema', ordem: 30, rotulo: 'Ler código aqui',
  async executar(ctx) {
    const h = mostrarBalao(ctx, { titulo: 'Códigos', carregando: 'lendo QR / código de barras…' });
    const c = await ctx.recorte();
    if (!c) throw new Error('sem imagem');
    const m = await import('../cv/runtime/livres-n/modelos.js');
    const r = await m.lerCodigos(dadosDe(c));
    const txt = r.map((x) => x.text).join('\n');
    h.atualizar({
      titulo: `Códigos (${r.length})`,
      linhas: r.length ? r.map((x) => `${x.format}: ${x.text}`) : ['nenhum código encontrado'],
      acoes: r.length ? [
        { rotulo: 'Copiar', fazer: () => navigator.clipboard && navigator.clipboard.writeText(txt) },
        ...(ctx.usarComoRotulo ? [{ rotulo: 'Usar como rótulo', destaque: true, fazer: () => ctx.usarComoRotulo(r[0].text) }] : []),
      ] : [],
    });
  },
});

registrarAcao({
  id: 'sis.via', grupo: 'sistema', ordem: 40, rotulo: 'Perguntar à Via sobre esta área',
  async executar(ctx) {
    const c = await ctx.recorte();
    if (!c) throw new Error('sem imagem');
    const b = await blobDe(c, 'image/jpeg', 0.9);
    const { pedirVia } = await import('../via/base.js');
    pedirVia({ anexos: [new File([b], 'recorte.jpg', { type: 'image/jpeg' })], texto: 'O que há nesta área da imagem? ' });
  },
});

registrarAcao({
  id: 'sis.copiar', grupo: 'sistema', ordem: 50, rotulo: 'Copiar imagem',
  quando: () => typeof ClipboardItem !== 'undefined' && navigator.clipboard && navigator.clipboard.write,
  async executar(ctx) {
    // Safari: clipboard.write tem de ser chamado AINDA dentro do clique — esperar o recorte e o PNG
    // antes perde o gesto (NotAllowedError). A imagem entra no ClipboardItem como promessa.
    let c = null;
    const png = (async () => {
      c = await ctx.recorte();
      if (!c) throw new Error('sem imagem');
      return blobDe(c, 'image/png');
    })();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    mostrarBalao(ctx, { titulo: 'Copiar imagem', linhas: [`${c.width} × ${c.height} px copiados para a área de transferência.`] });
  },
});

registrarAcao({
  id: 'sis.duplicar', grupo: 'marcacao', ordem: 80, rotulo: 'Duplicar',
  quando: (ctx) => ctx.item && ctx.duplicar, executar: (ctx) => ctx.duplicar(),
});
registrarAcao({
  id: 'sis.apagar', grupo: 'marcacao', ordem: 90, rotulo: 'Apagar marcação',
  quando: (ctx) => ctx.item && ctx.apagar, executar: (ctx) => ctx.apagar(),
});
