/**
 * layout/menu-tela.js — o MENU DA TELA: clique direito no fundo da tela
 * principal e no cartão inicial (sem fonte), com as funções gerais do sistema.
 *
 * É o mesmo componente do menu do vídeo (components/menu-contexto.js), num
 * contexto novo, 'tela':
 *
 *   Ligar câmera · Abrir imagem ou vídeo… · Capturar tela · YouTube…
 *   Colar print no +Projeto
 *   Abrir painel ▸ (Fonte, Pipeline, Módulos…, +Projeto, Via) · Player · Ferramentas
 *   Organizar · Recolher todos os painéis · Abrir todos os painéis
 *   Tema ▸ (os mesmos do menu do avatar: Escuro iaVision, Claro iaVision, Code Dark)
 *   Comparar · Capturar PNG · Atalhos de teclado
 *
 * Com vídeo na tela, o clique direito no canvas continua abrindo o menu do
 * vídeo (ações de área) e estas mesmas funções entram no fim, em «Tela ▸».
 *
 * O menu do navegador só é trocado no FUNDO: html/body/#root e a área do
 * vídeo (.viewport). Campos, links e texto selecionado dos painéis ficam com
 * o menu de sempre — e qualquer outro elemento também. Teclado: Shift+F10 ou
 * a tecla Menu com o foco no fundo da página.
 *
 * O workspace liga as ações que dependem dele (fontes, comparar, PNG,
 * organizar) com `ligarTela({ … })`; o tema é trocado pelo próprio seletor
 * do menu do avatar (MenuBar.js escuta 'aiv:tema'), sem lógica duplicada.
 */

import { store, persist } from '../state/store.js';
import { registrarAcao, abrirMenu, mostrarBalao } from '../components/menu-contexto.js';
import { alternarRecolhido } from './organizador.js';
import { alternarVia } from '../via/base.js';
import { abrirPainel as abrirProjeto, avisar as avisarProjeto, adicionarPrint } from '../projeto/base.js';
import { TEMAS } from '../components/MenuBar.js';

let acoes = null;   // { ligarCamera, abrirArquivo(file), capturarTela, comparar, capturarPng, organizar }

/** O workspace entrega as ações que só ele sabe fazer (e `null` ao desmontar). */
export function ligarTela(a) {
  acoes = a;
  instalar();
}

// ------------------------------------------------------------- painéis

/** Painéis do submenu «Abrir painel», na ordem da barra do topo. */
const PAINEIS = [
  ['camera', 'Fonte', 'f'], ['pipeline', 'Pipeline', 'p'], ['modules', 'Módulos', 'm'], ['models', 'Modelos', 'd'],
  ['coisas', 'Coisas'], ['esportes', 'Esportes'], ['industrial', 'Industrial'], ['stats', 'Telemetria', 't'],
  ['context', 'Contexto', 'x'], ['codes', 'Códigos', 'q'], ['captions', 'Legendas', 'l'], ['projeto', '+Projeto'],
  ['via', 'Via', 'Ctrl/⌘+K'],
];

function alternarPainel(id) {
  if (id === 'via') { alternarVia(); return; }
  const st = store.get();
  const aberto = Boolean(st.panels[id]);
  // aberto mas recolhido: abre o corpo em vez de fechar
  if (aberto && st.recolhidos && st.recolhidos[id]) { alternarRecolhido(id); persist(); return; }
  store.set({ panels: { ...st.panels, [id]: !aberto } });
  persist();
}

/** Espera algo aparecer no DOM (painel sob demanda carregando). */
async function esperar(f, ms = 4000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const v = f();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 60));
  }
  return null;
}

/** «YouTube…»: abre o painel Fonte já na seção do YouTube, com o foco no campo do link. */
async function irParaYouTube() {
  const st = store.get();
  if (!st.panels.camera) { store.set({ panels: { ...st.panels, camera: true } }); persist(); }
  else if (st.recolhidos && st.recolhidos.camera) alternarRecolhido('camera');
  const sec = await esperar(() => [...document.querySelectorAll('[data-painel="camera"] .fonte-sec')]
    .find((s) => /YouTube/.test((s.querySelector('.fonte-sec-t') || {}).textContent || '')));
  if (!sec) return;
  if (!sec.classList.contains('aberta')) { const h = sec.querySelector('.fonte-sec-h'); if (h) h.click(); }
  const campo = await esperar(() => sec.querySelector('input[type="url"], input[type="text"], input'), 1500);
  sec.scrollIntoView({ block: 'nearest' });
  if (campo) campo.focus({ preventScroll: true });
}

function abrirArquivo() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*,video/*';
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; if (f && acoes) acoes.abrirArquivo(f); });
  inp.click();
}

/** «Colar print»: imagem da área de transferência vira print do projeto ativo (+Projeto). */
async function colarPrint() {
  const dica = 'Abra o +Projeto e use Ctrl/⌘+V para colar.';
  if (!navigator.clipboard || !navigator.clipboard.read) { abrirProjeto(); avisarProjeto(dica); return; }
  let itens;
  try { itens = await navigator.clipboard.read(); } catch (_) { abrirProjeto(); avisarProjeto('O navegador não liberou a área de transferência. ' + dica); return; }
  let n = 0;
  for (const it of itens) {
    const tipo = it.types.find((t) => t.startsWith('image/'));
    if (!tipo) continue;
    await adicionarPrint(await it.getType(tipo), { origem: 'colado' });
    n++;
  }
  abrirProjeto();
  avisarProjeto(n ? `${n} ${n === 1 ? 'imagem colada' : 'imagens coladas'} no +Projeto.` : 'Não há imagem na área de transferência.');
}

/** Recolher/abrir todos os painéis abertos (colunas e soltos) e a Via. */
function recolherTodos(recolher) {
  const st = store.get();
  const rec = {};
  if (recolher) for (const [id, on] of Object.entries(st.panels)) if (on && id !== 'via') rec[id] = true;
  store.set({ recolhidos: rec });
  persist();
  window.dispatchEvent(new CustomEvent('aiv:via-recolher', { detail: recolher }));
}

// ------------------------------------------------------------- tema

/** Os temas são os do seletor do menu do avatar (MenuBar.js): a mesma lista, o mesmo caminho. */
const temas = () => TEMAS.map((t) => [t.id, t.nome + (t.id === 'code' ? '' : ' ' + t.sub)]);

const temaAtual = () => document.documentElement.getAttribute('data-theme') || 'dark';

// ------------------------------------------------------------- atalhos

const ATALHOS = [
  'espaço — pausar / continuar · ← → — frame anterior / próximo',
  'c — comparar · s — capturar PNG · o — organizar',
  'm módulos · d modelos · p pipeline · f fonte · t telemetria',
  'a acesso · g config · x contexto · q códigos · l legendas',
  '⇧B — mostrar/ocultar o Player · Ctrl/⌘+K — Via',
  'v r ⇧P ⇧L ⇧M… — ferramentas de mouse',
  'Alt/⌥ ao arrastar — sem grade nem ímã',
  'Shift+F10 ou tecla Menu — este menu',
];

// ------------------------------------------------------------- itens

/*
 * Uma lista só: cada item vira uma ação do menu da tela e, no menu do vídeo,
 * um item do submenu «Tela ▸».
 */
const ITENS = [
  { id: 'camera', grupo: 'tela.fonte', rotulo: 'Ligar câmera', fazer: () => acoes && acoes.ligarCamera() },
  { id: 'arquivo', grupo: 'tela.fonte', rotulo: 'Abrir imagem ou vídeo…', fazer: abrirArquivo },
  { id: 'captura', grupo: 'tela.fonte', rotulo: 'Capturar tela…', fazer: () => acoes && acoes.capturarTela() },
  { id: 'youtube', grupo: 'tela.fonte', rotulo: 'YouTube…', fazer: irParaYouTube },
  { id: 'colar', grupo: 'tela.projeto', rotulo: 'Colar print no +Projeto', tecla: 'Ctrl/⌘+V', fazer: colarPrint },
  {
    id: 'painel', grupo: 'tela.paineis', rotulo: 'Abrir painel',
    itens: () => PAINEIS.map(([id, nome, tecla]) => ({ id, rotulo: (store.get().panels[id] ? '✓ ' : '') + nome, tecla })),
    fazer: alternarPainel,
  },
  { id: 'player', grupo: 'tela.paineis', rotulo: () => (store.get().player !== false ? 'Ocultar o Player' : 'Mostrar o Player'), tecla: '⇧B',
    fazer: () => { store.set((st) => ({ player: st.player === false })); persist(); } },
  { id: 'ferramentas', grupo: 'tela.paineis', rotulo: () => (store.get().ferramentas !== false ? 'Ocultar as Ferramentas' : 'Mostrar as Ferramentas'),
    fazer: () => { store.set((st) => ({ ferramentas: st.ferramentas === false })); persist(); } },
  { id: 'organizar', grupo: 'tela.layout', rotulo: 'Organizar', tecla: 'o', fazer: () => acoes && acoes.organizar() },
  { id: 'recolher', grupo: 'tela.layout', rotulo: 'Recolher todos os painéis', fazer: () => recolherTodos(true) },
  { id: 'abrir', grupo: 'tela.layout', rotulo: 'Abrir todos os painéis', fazer: () => recolherTodos(false) },
  {
    id: 'tema', grupo: 'tela.tema', rotulo: 'Tema',
    itens: () => temas().map(([id, nome]) => ({ id, rotulo: (temaAtual() === id ? '✓ ' : '') + nome })),
    fazer: (t) => window.dispatchEvent(new CustomEvent('aiv:tema', { detail: t })),
  },
  { id: 'comparar', grupo: 'tela.util', rotulo: () => (store.get().compare ? 'Parar de comparar' : 'Comparar (antes/depois)'), tecla: 'c', fazer: () => acoes && acoes.comparar() },
  { id: 'png', grupo: 'tela.util', rotulo: 'Capturar PNG', tecla: 's', fazer: () => acoes && acoes.capturarPng() },
  { id: 'atalhos', grupo: 'tela.util', rotulo: 'Atalhos de teclado', fazer: (_, ctx) => mostrarBalao(ctx, { titulo: 'Atalhos de teclado', linhas: ATALHOS }) },
];

const rotuloDe = (d) => (typeof d.rotulo === 'function' ? d.rotulo() : d.rotulo);

ITENS.forEach((d, i) => registrarAcao({
  id: 'tela.' + d.id, grupo: d.grupo, ordem: i, contextos: ['tela'], tecla: d.tecla,
  rotulo: () => rotuloDe(d),
  quando: () => Boolean(acoes),
  itens: d.itens,
  executar: (ctx, sub) => d.fazer(sub, ctx),
}));

// no menu do vídeo: as mesmas funções, no fim, em «Tela ▸»
registrarAcao({
  id: 'tela.sub', grupo: 'tela', ordem: 0, contextos: ['video'], rotulo: 'Tela',
  quando: () => Boolean(acoes),
  itens: () => {
    const out = [];
    let g = null;
    for (const d of ITENS) {
      if (g && d.grupo !== g) out.push({ sep: true });
      g = d.grupo;
      out.push(d.itens
        ? { id: d.id, rotulo: rotuloDe(d), itens: d.itens().map((s) => ({ ...s, id: d.id + '|' + s.id })) }
        : { id: d.id, rotulo: rotuloDe(d), tecla: d.tecla });
    }
    return out;
  },
  executar: (ctx, sub) => {
    const [id, resto] = String(sub).split('|');
    const d = ITENS.find((x) => x.id === id);
    if (d) return d.fazer(resto, ctx);
    return undefined;
  },
});

// ------------------------------------------------------------- abrir

function contextoTela(x, y) {
  return { origem: 'tela', area: null, item: null, retanguloTela: () => ({ x, y, w: 1, h: 1 }) };
}

/** Abre o menu da tela em (x, y), px da janela. */
export function abrirMenuTela(x, y) {
  if (!acoes) return false;
  return abrirMenu(contextoTela(x, y), x, y);
}

/** Fundo da tela: html/body/#root e a área do vídeo — nunca campo, link ou texto editável. */
function ehFundo(t) {
  if (!t || t.nodeType !== 1) return false;
  if (t.closest('input, textarea, select, a[href], [contenteditable=""], [contenteditable="true"]')) return false;
  if (t === document.documentElement || t === document.body || t.id === 'root') return true;
  return Boolean(t.closest('.viewport'));
}

const logado = () => Boolean(document.querySelector('.menubar')) && !document.querySelector('.gate');

function onContexto(e) {
  // quem já tratou (menu do vídeo, editor do +Projeto) marcou o evento
  if (e.defaultPrevented || !acoes || !logado() || !ehFundo(e.target)) return;
  const sel = window.getSelection ? String(window.getSelection() || '') : '';
  if (sel.trim()) return;   // texto selecionado: o menu do navegador (copiar)
  e.preventDefault();
  abrirMenuTela(e.clientX, e.clientY);
}

function onTecla(e) {
  if (e.defaultPrevented || !acoes || !logado()) return;
  if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) return;
  const a = document.activeElement;
  if (a && a !== document.body && a !== document.documentElement) return;
  e.preventDefault();
  abrirMenuTela(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 3));
}

let instalado = false;
function instalar() {
  if (instalado || typeof document === 'undefined') return;
  instalado = true;
  document.addEventListener('contextmenu', onContexto);
  document.addEventListener('keydown', onTecla);
}
