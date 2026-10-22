/**
 * layout/organizador.js — onde cada painel ancorado fica na tela.
 *
 * Antes as colunas tinham posição FIXA no CSS (left, left2, right2, right) e,
 * abaixo de 1600 px, as internas eram empilhadas por cima das externas com
 * max-height: 46vh. Resultado: duas colunas no mesmo x, painéis cortados, a
 * coluna rolando por dentro e o vídeo espremido. Agora quem decide é um
 * planejador só, a partir da largura e da altura reais da janela:
 *
 *   1. cada painel vai para a coluna do lado preferido (store.dock) que ainda
 *      tem espaço para ele; senão para qualquer coluna com espaço;
 *   2. não coube em nenhuma e há largura: abre a próxima coluna (left2, right2…);
 *   3. não há largura: entra na coluna menos ocupada e os painéis dela
 *      encolhem por igual (o corpo rola, o cabeçalho fica) até a altura mínima;
 *   4. nem a altura mínima cabe: o painel MAIS ANTIGO da coluna recolhe para só
 *      o cabeçalho, com um aviso curto.
 *
 * A largura das colunas nunca invade a área central do vídeo: no computador
 * ela fica com pelo menos max(40% da janela, 480 px). Com a Via aberta numa
 * janela estreita a Via encolhe para 340 px e o mínimo cai para 360 px — a
 * alternativa seria fechar todos os painéis por causa do assistente.
 *
 * Celular (≤ 600 px): uma coluna só, abaixo da barra, um painel aberto por vez
 * (acordeão: os outros ficam só com o cabeçalho). Tablet (601–999 px): uma
 * coluna estreita de um lado, acima da barra de vídeo.
 *
 * A atribuição é PEGAJOSA: um painel não troca de coluna porque outro abriu
 * ou porque o conteúdo cresceu — só quando a coluna dele deixa de existir
 * (janela encolheu) ou no «Organizar», que replaneja tudo do zero.
 */

import { createStore, store } from '../state/store.js';

export const COL_MAX = 316;     // largura padrão de uma coluna
export const COL_MIN = 260;     // abaixo disto os painéis não cabem sem rolar de lado
export const GAP = 10;          // entre colunas e entre painéis
export const MARGEM = 14;       // da borda da janela
export const BASE = 34;         // folga no rodapé (linha de atalhos)
export const CAB = 42;          // painel recolhido = só o cabeçalho
export const MIN_H = 150;       // altura mínima útil de um painel aberto
export const CELULAR = 600;
const VIA_W = 440;

/*
 * Área mínima do vídeo no computador: max(40% da janela, 480 px) pedido, com
 * piso de 520 px — é a largura da barra de vídeo numa linha só (com 480 ela
 * quebrava em duas linhas e roubava altura dos widgets).
 */
export function videoMinimo(W) { return Math.max(520, Math.round(W * 0.4)); }

/*
 * Estado que os painéis leem (Panel.js): recolhido? altura mínima? Fica fora
 * do store principal porque muda a cada medição e não é preferência.
 */
export const layoutStore = createStore({ paineis: {}, modo: 'desktop' });

// estado pegajoso do planejador (módulo, não React: sobrevive a re-render)
let atrib = null;          // { id: 'L0' | 'R1' … }
let recAuto = new Set();   // recolhidos pelo planejador (não pelo usuário)
const nat = {};            // altura natural medida de cada painel
let ultimaArea = { x0: 0, x1: typeof window !== 'undefined' ? window.innerWidth : 1280 };

/** Área livre do vídeo (entre as colunas) do último plano: os widgets se posicionam por ela. */
export function areaLivre() { return { ...ultimaArea }; }

/** «Organizar»: esquece colunas e recolhimentos automáticos e replaneja. */
export function organizar() {
  atrib = null;
  recAuto = new Set();
}

/**
 * Botão ▾/▸ do cabeçalho. Abrir um painel recolhido o torna o mais NOVO (o
 * planejador recolhe outro, mais antigo, se faltar altura); recolher é do
 * usuário e fica guardado.
 */
export function alternarRecolhido(id) {
  const st = store.get();
  const rec = { ...(st.recolhidos || {}) };
  const estaRec = Boolean(rec[id]) || recAuto.has(id) || Boolean((layoutStore.get().paineis[id] || {}).rec);
  if (estaRec) {
    delete rec[id];
    recAuto.delete(id);
    const ordem = (st.ordem || []).filter((x) => x !== id).concat(id);
    store.set({ recolhidos: rec, ordem });
  } else {
    rec[id] = true;
    store.set({ recolhidos: rec });
  }
}

// ------------------------------------------------------------------ medição

/** Altura natural (cabeçalho + conteúdo inteiro) de cada painel ancorado aberto. */
export function medirNaturais() {
  let mudou = false;
  for (const el of document.querySelectorAll('.rail section.panel[data-painel]')) {
    if (el.classList.contains('recolhido')) continue;
    const id = el.getAttribute('data-painel');
    const fixo = parseInt(el.getAttribute('data-alt') || '', 10);
    let h;
    if (fixo > 0) h = fixo;
    else {
      const head = el.querySelector(':scope > .panel-head');
      const body = el.querySelector(':scope > .panel-body');
      h = (head ? head.offsetHeight : 0) + (body ? body.scrollHeight : 0) + 2;
    }
    if (!nat[id] || Math.abs(nat[id] - h) > 8) { nat[id] = h; mudou = true; }
  }
  return mudou;
}

// ------------------------------------------------------------------ plano

/**
 * Função pura (fora o estado pegajoso que recebe e devolve).
 * @param o.W,o.H     janela
 * @param o.topo      base da barra do topo (--rail-top)
 * @param o.fundo     reserva no rodapé
 * @param o.ids       painéis ancorados abertos, do mais antigo ao mais novo
 * @param o.lado      id → 'L' | 'R' (preferência, de store.dock)
 * @param o.recUsu    Set dos recolhidos pelo usuário
 * @param o.via       gaveta da Via aberta
 * @param o.reservas  áreas RESERVADAS por widgets, em px da janela:
 *                    [{ tipo: 'ferr' | 'player', x0, y0, x1, y1 }] — as
 *                    Ferramentas de mouse e a barra de vídeo (computador)
 */
export function planejar(o) {
  const { W, H, topo, ids, recUsu, via } = o;
  const modo = W <= CELULAR ? 'celular' : W < 1000 ? 'tablet' : 'desktop';
  const fundo = o.fundo != null ? o.fundo : BASE;
  if (modo === 'desktop') return planoComputador(o, fundo);
  const { Hc, rec, dem, mn, soma } = medidas(H, topo, fundo, ids, recUsu);

  // ---- celular: acordeão, um aberto (o mais novo que o usuário não recolheu)
  if (modo === 'celular') {
    const abertos = ids.filter((id) => !recUsu.has(id));
    const vivo = abertos[abertos.length - 1];
    for (const id of ids) if (id !== vivo) rec.add(id);
    const col = { chave: 'left', lado: 'L', ids: [...ids], x: 10, w: W - 20 };
    return fechar({ modo, cols: ids.length ? [col] : [], rec, recAuto: new Set(), atrib: {}, Hc, topo, fundo, W, viaW: 0, area: { x0: 0, x1: W } });
  }

  // ---- tablet: uma coluna estreita; recolhe os mais antigos se faltar altura
  const viaLado = via && W > 820;
  let w = Math.min(380, Math.max(300, Math.round(W * 0.44)));
  if (viaLado) w = Math.max(240, Math.min(w, W - 2 * MARGEM - VIA_W - GAP));
  const ra = new Set([...recAuto].filter((id) => ids.includes(id)));
  for (const id of ra) rec.add(id);
  for (const id of ids) { if (soma(ids, mn) <= Hc) break; if (!rec.has(id) && id !== ids[ids.length - 1]) { rec.add(id); ra.add(id); } }
  desrecolher(ids, ra, rec, () => soma(ids, mn) <= Hc && soma(ids, dem) <= Hc);
  const L = viaLado;
  const col = { chave: L ? 'left' : 'right', lado: L ? 'L' : 'R', ids: [...ids], x: MARGEM, w };
  const area = L ? { x0: MARGEM + w + GAP, x1: W - (viaLado ? MARGEM + VIA_W + GAP : 0) } : { x0: 0, x1: W - MARGEM - w - GAP };
  return fechar({ modo, cols: ids.length ? [col] : [], rec, recAuto: ra, atrib: {}, Hc, topo, fundo, W, viaW: 0, area });
}

/** Altura útil das colunas e as funções de demanda/mínimo de cada painel. */
function medidas(H, topo, fundo, ids, recUsu) {
  const Hc = Math.max(CAB, H - topo - fundo);
  // teto da DEMANDA de um painel: metade da coluna — dois painéis altos dividem uma coluna sem encolher
  const cap = Math.floor((Hc - GAP) / 2);
  const n0 = (id) => nat[id] || 300;
  const rec = new Set([...recUsu].filter((id) => ids.includes(id)));
  const dem = (id) => (rec.has(id) ? CAB : Math.min(n0(id), cap));
  const mn = (id) => (rec.has(id) ? CAB : Math.min(n0(id), MIN_H));
  const soma = (lista, f) => lista.reduce((a, id) => a + f(id), 0) + GAP * Math.max(0, lista.length - 1);
  return { Hc, rec, dem, mn, soma };
}

/*
 * Computador, com as ÁREAS RESERVADAS (Ferramentas de mouse e barra de vídeo):
 *
 *   Ferramentas  as colunas de cada lado são postas da borda para dentro e
 *                CONTORNAM o widget: a coluna que cairia sobre ele começa logo
 *                depois dele (encostada à borda esquerda, a 1ª coluna da
 *                esquerda começa à direita dele). A largura que isso consome
 *                sai da conta das colunas, não da área mínima do vídeo.
 *   Player       a barra de vídeo é larga e baixa: se cruza uma coluna, as
 *                colunas terminam acima dela (ou começam abaixo, se ela foi
 *                levada para a metade de cima da tela).
 *
 * Como a posição das colunas depende do número delas e vice-versa, replaneja
 * algumas vezes até estabilizar (2–3 voltas na prática).
 */
function planoComputador(o, fundo0) {
  const { W, H } = o;
  const reservas = (o.reservas || []).filter((r) => r && r.x1 - r.x0 > 2 && r.y1 - r.y0 > 2);
  let topo = o.topo, fundo = fundo0;
  let extra = { L: 0, R: 0 };
  let p = null;
  for (let volta = 0; volta < 6; volta++) {
    p = colunasComputador(o, topo, fundo, extra);
    const banda = (r) => r.y0 < H - fundo && r.y1 > topo;
    // barra de vídeo que cruza uma coluna: as colunas terminam acima dela (ou começam abaixo)
    let mudouV = false;
    for (const r of reservas) {
      if (r.tipo !== 'player' || !banda(r)) continue;
      if (!p.cols.some((c) => cruzaX(r, xDaColuna(c, W)))) continue;
      if ((r.y0 + r.y1) / 2 > H / 2) fundo = Math.max(fundo, Math.round(H - r.y0 + GAP));
      else topo = Math.max(topo, Math.round(r.y1 + GAP));
      mudouV = true;
    }
    if (mudouV) continue;
    // posiciona da borda para dentro, contornando as Ferramentas
    const obst = reservas.filter((r) => r.tipo !== 'player' && banda(r));
    const usado = contornar(p, obst, W);
    if (usado.L <= extra.L && usado.R <= extra.R) break;
    // só cresce: sem isto, 2 colunas que não cabem ↔ 1 coluna que sobra ficariam alternando
    extra = { L: Math.max(extra.L, usado.L), R: Math.max(extra.R, usado.R) };
  }
  // a última volta mexeu no topo/fundo: planeja de novo com eles
  if (p.topo !== topo || p.fundo !== fundo) {
    p = colunasComputador(o, topo, fundo, extra);
    contornar(p, reservas.filter((r) => r.tipo !== 'player' && r.y0 < H - fundo && r.y1 > topo), W);
  }
  // área livre do vídeo: entre os blocos de colunas e os widgets encostados neles
  const fimL = Math.max(0, ...p.cols.filter((c) => c.lado === 'L').map((c) => c.x + c.w + GAP));
  const fimR = Math.max(0, ...p.cols.filter((c) => c.lado === 'R').map((c) => c.x + c.w + GAP), p.viaW ? MARGEM + p.viaW + GAP : 0);
  let x0 = fimL, x1 = W - fimR;
  for (const r of reservas) {
    if (r.tipo === 'player' || !(r.y0 < H - fundo && r.y1 > topo)) continue;
    if ((r.x0 + r.x1) / 2 < W / 2 && r.x0 <= x0 + GAP + 4) x0 = Math.max(x0, r.x1 + GAP);
    else if ((r.x0 + r.x1) / 2 >= W / 2 && r.x1 >= x1 - GAP - 4) x1 = Math.min(x1, r.x0 - GAP);
  }
  p.area = { x0: x0 > 0 ? Math.round(x0) : 0, x1: Math.round(x1) };
  p.topo = topo;
  p.fundo = fundo;
  return p;
}

const cruzaX = (r, c) => r.x0 < c.x1 && r.x1 > c.x0;

/** Extensão horizontal de uma coluna em px da janela (as da direita guardam x a partir da borda direita). */
function xDaColuna(c, W) {
  const x0 = c.lado === 'L' ? c.x : W - c.x - c.w;
  return { x0, x1: x0 + c.w };
}

/**
 * Põe cada coluna de um lado na primeira posição, da borda para dentro, que
 * não cruza um obstáculo. Devolve quanto cada lado consumiu A MAIS que o
 * normal (para o planejador descontar da largura das colunas).
 */
function contornar(p, obst, W) {
  const usado = { L: 0, R: 0 };
  for (const ld of ['L', 'R']) {
    const cols = p.cols.filter((c) => c.lado === ld).sort((a, b) => a.idx - b.idx);
    if (!cols.length) continue;
    // obstáculos medidos a partir da borda do lado (px da borda para dentro)
    const ob = obst.map((r) => (ld === 'L' ? { a: r.x0, b: r.x1 } : { a: W - r.x1, b: W - r.x0 }));
    let x = MARGEM + (ld === 'R' && p.viaW ? p.viaW + GAP : 0);
    const x00 = x;
    for (const c of cols) {
      for (let k = 0; k < 8; k++) {
        const bate = ob.find((q) => q.a < x + c.w + GAP && q.b + GAP > x);
        if (!bate) break;
        x = Math.round(bate.b + GAP);
      }
      c.x = x;
      x += c.w + GAP;
    }
    usado[ld] = Math.max(0, x - x00 - cols.length * (cols[0].w + GAP));
  }
  return usado;
}

/** O planejamento das colunas do computador (quantas, de que lado, quem vai em qual). */
function colunasComputador(o, topo, fundo, extra) {
  const { W, ids, lado, recUsu, via } = o;
  const modo = 'desktop';
  const { Hc, rec, dem, mn, soma } = medidas(o.H, topo, fundo, ids, recUsu);
  // largura que as colunas podem usar: a janela menos o que contornar as Ferramentas consome
  const Wc = W - extra.L - extra.R;
  let viaW = via ? VIA_W : 0;
  let vmin = videoMinimo(W);
  const cabem = (n, vm, vw) => (Wc - 2 * MARGEM - (vw ? vw + GAP : 0) - vm) / n - GAP >= COL_MIN;
  let maxN = 0;
  while (maxN < 6 && cabem(maxN + 1, vmin, viaW)) maxN++;
  if (via && maxN === 0 && ids.length) {
    viaW = 340; vmin = Math.max(360, Math.round(W * 0.3));
    while (maxN < 6 && cabem(maxN + 1, vmin, viaW)) maxN++;
  }
  maxN = Math.max(1, maxN);

  let cols = [];          // { lado, idx, ids }
  let ra = new Set();
  // estado pegajoso: vale se as colunas ainda cabem e a altura mínima de cada uma fecha
  if (atrib) {
    const porChave = {};
    for (const id of ids) if (atrib[id]) (porChave[atrib[id]] = porChave[atrib[id]] || []).push(id);
    const chaves = Object.keys(porChave);
    ra = new Set([...recAuto].filter((id) => ids.includes(id)));
    for (const id of ra) rec.add(id);
    const ok = chaves.length <= maxN && chaves.every((k) => soma(porChave[k], mn) <= Hc);
    if (ok) cols = chaves.map((k) => ({ lado: k[0], idx: +k.slice(1), ids: porChave[k] }));
    else { for (const id of ra) if (!recUsu.has(id)) rec.delete(id); ra = new Set(); }
  }
  const novos = ids.filter((id) => !cols.some((c) => c.ids.includes(id)));
  const livre = (c) => Hc - soma(c.ids, dem) - (c.ids.length ? GAP : 0);
  const porLivre = (a, b) => livre(b) - livre(a) || a.idx - b.idx;
  for (const id of novos) {
    const ld = lado(id);
    const d = dem(id);
    const doLado = cols.filter((c) => c.lado === ld);
    // coluna nova: no lado preferido, a menos que ele já tenha mais colunas que o outro (equilibra o vídeo no meio)
    const nova = () => {
      const outro = ld === 'L' ? 'R' : 'L';
      const nOutro = cols.filter((c) => c.lado === outro).length;
      const lc = doLado.length > nOutro ? outro : ld;
      const c = { lado: lc, idx: cols.filter((k) => k.lado === lc).length, ids: [] };
      cols.push(c);
      return c;
    };
    // 1) coluna do lado preferido com espaço; 2) o lado ainda não tem coluna: abre a primeira dele;
    // 3) qualquer coluna com espaço; 4) abre a próxima coluna do lado preferido
    let alvo = doLado.filter((c) => livre(c) >= d).sort(porLivre)[0]
      || (!doLado.length && cols.length < maxN ? nova() : null)
      || cols.filter((c) => livre(c) >= d).sort(porLivre)[0]
      || (cols.length < maxN ? nova() : null);
    if (!alvo) alvo = cols.filter((c) => soma([...c.ids, id], mn) <= Hc).sort(porLivre)[0];
    if (!alvo) {
      alvo = cols.slice().sort((a, b) => soma(a.ids, mn) - soma(b.ids, mn))[0];
      // recolhe os mais antigos dessa coluna até a altura mínima fechar
      for (const o2 of ids) {
        if (soma([...alvo.ids, id], mn) <= Hc) break;
        if (alvo.ids.includes(o2) && !rec.has(o2)) { rec.add(o2); ra.add(o2); }
      }
    }
    alvo.ids.push(id);
    if (soma(alvo.ids, mn) > Hc && !rec.has(id)) { rec.add(id); ra.add(id); }
  }
  // fechou um painel e sobrou altura: devolve quem foi recolhido automaticamente
  for (const c of cols) desrecolher(c.ids, ra, rec, () => soma(c.ids, mn) <= Hc && soma(c.ids, dem) <= Hc);

  // compacta: sem coluna vazia no meio, índices 0.. por lado
  cols = cols.filter((c) => c.ids.length);
  const nAtual = cols.length;
  const w = Math.round(Math.max(COL_MIN, Math.min(COL_MAX,
    (Wc - 2 * MARGEM - (viaW ? viaW + GAP : 0) - vmin) / Math.max(1, nAtual) - GAP)));
  const novaAtrib = {};
  for (const ld of ['L', 'R']) {
    cols.filter((c) => c.lado === ld).sort((a, b) => a.idx - b.idx).forEach((c, i) => {
      c.idx = i;
      c.chave = (ld === 'L' ? 'left' : 'right') + (i ? i + 1 : '');
      c.x = MARGEM + (ld === 'R' && viaW ? viaW + GAP : 0) + i * (w + GAP);
      c.w = w;
      for (const id of c.ids) novaAtrib[id] = ld + i;
    });
  }
  return fechar({ modo, cols, rec, recAuto: ra, atrib: novaAtrib, Hc, topo, fundo, W, viaW, area: { x0: 0, x1: W }, vmin });
}

function desrecolher(ids, ra, rec, cabe) {
  for (const id of [...ids].reverse()) {
    if (!ra.has(id)) continue;
    rec.delete(id);
    if (cabe()) ra.delete(id); else rec.add(id);
  }
}

function fechar(p) {
  p.minH = {};
  for (const c of p.cols) for (const id of c.ids) p.minH[id] = p.rec.has(id) ? 0 : Math.min(nat[id] || MIN_H, MIN_H);
  return p;
}

/**
 * Depois do render: guarda o estado pegajoso, publica o que os painéis e os
 * widgets leem e devolve os ids recolhidos AGORA pelo planejador (para o aviso).
 */
export function aplicarPlano(p) {
  const antes = recAuto;
  if (p.modo === 'desktop') atrib = p.atrib;
  recAuto = p.recAuto;
  ultimaArea = { ...p.area };
  const paineis = {};
  for (const c of p.cols) for (const id of c.ids) paineis[id] = { rec: p.rec.has(id), minH: p.minH[id] };
  layoutStore.set({ paineis, modo: p.modo });
  const raiz = document.documentElement.style;
  if (p.modo === 'desktop') {
    raiz.setProperty('--area-x0', p.area.x0 + 'px');
    raiz.setProperty('--area-w', (p.area.x1 - p.area.x0) + 'px');
    raiz.setProperty('--area-cx', Math.round((p.area.x0 + p.area.x1) / 2) + 'px');
  } else {
    raiz.removeProperty('--area-x0'); raiz.removeProperty('--area-w'); raiz.removeProperty('--area-cx');
  }
  if (p.viaW && p.viaW !== VIA_W) raiz.setProperty('--via-w', p.viaW + 'px');
  else raiz.removeProperty('--via-w');
  return [...p.recAuto].filter((id) => !antes.has(id));
}

/** Estilo inline de uma coluna do plano. */
export function estiloColuna(c, p) {
  const s = { top: p.topo + 'px', bottom: p.fundo + 'px', width: c.w + 'px' };
  if (c.lado === 'L') { s.left = c.x + 'px'; s.right = 'auto'; } else { s.right = c.x + 'px'; s.left = 'auto'; }
  return s;
}

// ------------------------------------------------------------------ widgets

/*
 * Registro de retângulos ocupados: colunas (cada painel visível), painéis
 * soltos, barra do topo, barra de vídeo, Ferramentas de mouse, Seção da
 * correia e a gaveta da Via. Lido do DOM na hora (é o que está pintado),
 * então nenhum widget precisa avisar os outros quando se mexe.
 */
const SELETORES_OCUPADOS = '.menubar, .rail > .panel, .panel.floating, .vctl, .ferr, .bss, .panel.via-gaveta';

export function ocupados(excluir = null) {
  const out = [];
  for (const el of document.querySelectorAll(SELETORES_OCUPADOS)) {
    if ([].concat(excluir || []).some((x) => el === x || (typeof x === 'string' && el.matches(x)))) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom });
  }
  return out;
}

const bate = (a, b, folga = 6) => a.x0 < b.x1 + folga && a.x1 + folga > b.x0 && a.y0 < b.y1 + folga && a.y1 + folga > b.y0;

/**
 * Primeiro lugar livre para uma caixa w×h dentro da área do vídeo, testando
 * cantos e bordas (embaixo à esquerda primeiro, depois em cima, depois à
 * direita) e, em cada um, deslizando para longe do que já está lá. Sem lugar
 * livre, devolve o canto que menos sobrepõe.
 */
export function acharLugar(w, h, excluir = null, topo = 0, flexivel = true) {
  const W = window.innerWidth, H = window.innerHeight;
  const a = areaLivre();
  const x0 = a.x0 ? a.x0 : 4, x1 = a.x1 < W ? a.x1 : W - 4;
  const y0 = Math.max(8, topo), y1 = H - 8;
  const occ = ocupados(excluir);
  const cands = [];
  const passo = 12;
  // colunas candidatas: bordas da área e encostado (8 px) em cada obstáculo; linhas: idem, mais um passo de 12 px
  const xs = [x0, x1 - w];
  const ys = [y1 - h, y0];
  for (const o of occ) { xs.push(o.x1 + 8, o.x0 - w - 8); ys.push(o.y0 - h - 8, o.y1 + 8); }
  for (let yy = y1 - h; yy >= y0; yy -= passo) ys.push(yy);
  for (let xx = x0; xx + w <= x1; xx += passo) xs.push(xx);
  const xsOk = [...new Set(xs.map(Math.round))].filter((x) => x >= x0 && x + w <= x1).sort((p, q) => p - q);
  const ysOk = [...new Set(ys.map(Math.round))].filter((y) => y >= y0 && y + h <= y1).sort((p, q) => q - p);
  // de baixo para cima; em cada altura, da esquerda para a direita
  for (const yy of ysOk) for (const xx of xsOk) cands.push({ x: xx, y: yy });
  cands.push({ x: x0, y: y0 });
  let melhor = null, menor = Infinity;
  for (const c of cands) {
    const r = { x0: c.x, y0: c.y, x1: c.x + w, y1: c.y + h };
    let area = 0;
    for (const o of occ) if (bate(r, o)) area += Math.max(0, Math.min(r.x1, o.x1) - Math.max(r.x0, o.x0)) * Math.max(0, Math.min(r.y1, o.y1) - Math.max(r.y0, o.y0)) + 1;
    if (area === 0) return { x: Math.round(c.x), y: Math.round(c.y) };
    if (area < menor) { menor = area; melhor = c; }
  }
  /*
   * Sem lugar livre: as Ferramentas de mouse encurtam sozinhas para terminar
   * acima do que está embaixo delas (FerramentasMouse.js) — tenta de novo
   * ignorando-as, de preferência no canto de baixo.
   */
  if (flexivel && document.querySelector('.ferr')) {
    const sem = acharLugar(w, h, excluir ? [].concat(excluir, '.ferr') : '.ferr', topo, false);
    if (sem) return sem;
  }
  if (!flexivel) return null;
  return melhor ? { x: Math.round(melhor.x), y: Math.round(melhor.y) } : { x: x0, y: Math.max(y0, y1 - h) };
}
