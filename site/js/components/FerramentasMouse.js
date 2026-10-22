/**
 * components/FerramentasMouse.js — o widget vertical "Ferramentas" sobre o vídeo.
 *
 * Botões-ícone empilhados com as ferramentas de mouse (área, polígono,
 * elipse, ROI, exclusão, linha de contagem, régua, ângulo, ponto, texto,
 * conta-gotas, seleção, borracha) e as ações (desfazer, refazer, mostrar,
 * limpar, lista de marcações, capturar PNG). Mesmo padrão da barra de vídeo
 * (VideoControls): arrastável pelo punho •••, duplo clique no punho devolve
 * ao lugar, recolhível pelo botão do canto, estado guardado no aparelho.
 *
 * O desenho e os gestos sobre o vídeo moram em marcacoes-vista.js; o modelo
 * (formas, desfazer, ROI, resultados) em cv/marcacoes.js. Aqui fica só a UI.
 *
 * MAIS FERRAMENTAS (out/2026). O botão ⋯ no fim da barra (tecla .) abre o
 * popover com o catálogo inteiro por categoria (components/ferramentas-mais.js):
 * polilinha, seta, círculo por 3 pontos, pincel de máscara, pontos-chave,
 * varinha mágica, SAM com um clique, encaixar na borda, área e perímetro,
 * perfil, histograma, distância, contador, cronômetro, trajetória, grade,
 * lupa, mira, réguas, camadas, cadeado, alinhar/distribuir. A barra mostra só
 * o que o usuário fixou (padrão: o conjunto de antes), na ordem dele; a
 * ferramenta ativa que não está fixada aparece num lugar provisório antes
 * do ⋯. Opções da ferramenta e o cartão de análise: ferramentas-analise.js.
 *
 * POSIÇÃO. Sem posição guardada, o widget fica COLADO NA BORDA ESQUERDA da
 * tela (8 px), logo abaixo da barra do topo, e as colunas de painéis da
 * esquerda começam à direita dele (layout/organizador.js o trata como área
 * reservada — também quando ele é movido). Nunca desce sobre a barra de
 * vídeo nem sobre a linha de atalhos: a altura disponível é medida e, se não
 * couber uma coluna, os botões quebram em duas. Arrastar encaixa na grade
 * invisível e nos vizinhos (layout/grade.js; Alt/⌥ desliga).
 */

import { html, useState, useEffect, useRef, useCallback } from '../vendor.js';
import { useStore, store, persist } from '../state/store.js';
import { railTop } from '../state/breakpoint.js';
import { encaixarMover, limparGuias } from '../layout/grade.js';
import { defaultParams, getOperator } from '../cv/registry.js';
import { newNodeId } from '../cv/executor.js';
import {
  FERRAMENTAS, TECLAS, marcStore, carregarMarcacoes, setFerramenta, setVisivel, setRoiLigada,
  desfazer, refazer, limparTudo, apagar, atualizar, inverter, selecionar, calibrar, definirEscala,
  exportarJSON, importarJSON, eventosCSV, eventos, zerarContagens, resultados, fresco, baixar,
  funcoesDe, COR_FUNC, AREAS, usarConjunto, apagarConjunto, comprimentoPx, anguloGraus, areaPx,
  fmtComprimento, fmtArea, mmPorPx,
  setExib, setOpc, alinhar, selecionados, travar, definirGrupo, contadoresCSV,
} from '../cv/marcacoes.js';
import { MaisFerramentas, CATALOGO, ICONES, lerBarra, salvarBarra } from './ferramentas-mais.js';
import { OpcoesFerramenta, CartaoAnalise, Camadas, BarraAlinhar, detalheNovo, AcoesItem, ALINHAR } from './ferramentas-analise.js';
import {
  leituraStore, cancelarRascunho, fecharPoligono, desfazerPonto, soltarLeitura, pontoNaJanela, abrirMenuTeclado,
} from './marcacoes-vista.js';
import { projStore, ativo as projetoAtivo, abrirPainel as abrirProjeto, setClasseAtiva, avisar as avisarProjeto } from '../projeto/base.js';
import { salvarQuadroComoPrint, exemplosAoVivo } from '../projeto/exemplos.js';
import { dadosExemplo } from '../cv/marcacoes.js';

/**
 * +Projeto: "Salvar estes exemplos" — o quadro atual e as marcações de
 * exemplo viram um print rotulado no projeto ativo (projeto/exemplos.js).
 */
async function salvarExemplos() {
  try {
    const pr = await salvarQuadroComoPrint({});
    avisarProjeto(`Print salvo com ${pr.caixas.length} ${pr.caixas.length === 1 ? 'exemplo' : 'exemplos'} em «${pr.pasta || (projetoAtivo() || {}).nome || ''}».`);
    abrirProjeto();
    return pr;
  } catch (e) { window.alert(e.message); return null; }
}

const POS_KEY = 'gplansis.ferramentas.pos';
const MINI_KEY = 'gplansis.ferramentas.mini';

/** CSS próprio, carregado uma vez com a mesma versão (?v=) dos demais. */
function carregarCss() {
  if (document.querySelector('link[data-ferramentas]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/ferramentas.css' + (v ? '?' + v : '');
  l.setAttribute('data-ferramentas', '');
  document.head.appendChild(l);
}

/** Operadores que entregam caixas (ctx.detections) para contar. */
const DETECTORES = new Set(['dnn.detect', 'yolo26.detect', 'rfdetr.detect', 'yoloe.detect', 'yoloe.prompt',
  'custom.detect', 'livres.rfdetr', 'florence2.tarefa', 'pose.rtmo', 'maos.gestos', 'yolo26.pose', 'yolo26.segment']);
/** Operadores que dão ID estável às caixas. */
const RASTREIO = new Set(['track.bytetrack', 'reid.pessoas']);

function no(op, over = {}) {
  return { id: newNodeId(), op, params: { ...defaultParams(op), ...over }, enabled: true };
}

/**
 * Põe a contagem no pipeline: o operador de zonas no fim e, se faltar, um
 * detector antes e o rastreio (para linhas e permanência por ID).
 */
function adicionarContagem({ rastreio }) {
  let nodes = store.get().nodes.slice();
  const ativos = nodes.filter((n) => n.enabled).map((n) => n.op);
  if (!ativos.some((op) => DETECTORES.has(op))) nodes.unshift(no('dnn.detect', { conf: 0.35 }));
  const temRastreio = nodes.some((n) => n.enabled && RASTREIO.has(n.op));
  const iZona = nodes.findIndex((n) => n.op === 'cena.zonas');
  if (rastreio && !temRastreio && getOperator('track.bytetrack')) {
    const t = no('track.bytetrack');
    if (iZona >= 0) nodes.splice(iZona, 0, t); else nodes.push(t);
  }
  if (!nodes.some((n) => n.op === 'cena.zonas')) nodes.push(no('cena.zonas'));
  else nodes = nodes.map((n) => (n.op === 'cena.zonas' ? { ...n, enabled: true } : n));
  store.set({ nodes });
  persist();
}

// ------------------------------------------------------------- widget

export function FerramentasMouse({ onSnapshot }) {
  const m = useStore(marcStore, (st) => ({
    ferramenta: st.ferramenta, visivel: st.visivel, podeDesfazer: st.podeDesfazer,
    podeRefazer: st.podeRefazer, n: st.itens.length, editando: st.editando, analise: st.analise, sel: st.sel,
  }));
  const ativo = useStore(store, (st) => st.ferramentas !== false);
  const nEx = useStore(marcStore, (st) => ({ n: st.itens.filter((i) => i.funcao === 'projeto_exemplo').length })).n;
  useStore(projStore, (st) => ({ a: st.ativo, p: st.projetos }));
  const [lista, setLista] = useState(false);
  const [mais, setMais] = useState(false);
  const [barra, setBarraBruta] = useState(lerBarra);
  const setBarra = (l) => { setBarraBruta(l); salvarBarra(l); };
  const ex = useStore(marcStore, (st) => st.exib);
  const nSel = useStore(marcStore, (st) => ({ n: st.selN.length })).n;
  const maisRef = useRef(null);
  const [mini, setMiniBruto] = useState(() => { try { return localStorage.getItem(MINI_KEY) === '1'; } catch (_) { return false; } });
  const setMini = (v) => {
    setMiniBruto(v);
    try { v ? localStorage.setItem(MINI_KEY, '1') : localStorage.removeItem(MINI_KEY); } catch (_) { /* storage bloqueado */ }
  };
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (_) { return null; } });
  const [lay, setLay] = useState({ x: 8, y: 80, rows: 99, btn: 32 });
  const [dragging, setDragging] = useState(false);
  const boxRef = useRef(null);
  const drag = useRef(null);

  useEffect(() => { carregarCss(); carregarMarcacoes(); }, []);

  // escondido pela barra do topo: volta ao "Mover", para o vídeo responder como antes
  useEffect(() => { if (!ativo) { setFerramenta('mover'); setLista(false); setMais(false); } }, [ativo]);

  // ---------------------------------------------------------- layout medido
  const medir = useCallback(() => {
    const W = window.innerWidth, H = window.innerHeight;
    const pequeno = W <= 480 || H <= 560;
    const btn = pequeno ? 30 : 32, gap = pequeno ? 2 : 3;
    let x, y;
    if (pos) { x = pos.x; y = pos.y; } else {
      // colada na borda esquerda, abaixo da barra do topo; as colunas da esquerda se afastam dela
      x = 8;
      y = railTop();
    }
    const larg = boxRef.current ? boxRef.current.offsetWidth : 44;
    // nunca por cima da barra do topo
    const bar = document.querySelector('.menubar');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.height && x < r.right && x + larg > r.left && y < r.bottom + 6 && y + 60 > r.top) y = Math.round(r.bottom + 8);
    }
    // nem por cima da barra de vídeo nem da Seção da correia: a altura útil termina acima delas
    const atalhos = document.querySelector('.hotkeys');
    let fundo = atalhos && getComputedStyle(atalhos).display !== 'none' ? H - 30 : H - 8;
    for (const vc of document.querySelectorAll('.vctl, .bss')) {
      const r = vc.getBoundingClientRect();
      if (r.height && x < r.right && x + larg > r.left && r.top > y + 80) fundo = Math.min(fundo, r.top - 8);
    }
    x = Math.max(4, Math.min(x, W - larg - 4));
    y = Math.max(4, Math.min(y, H - 120));
    const util = fundo - y - 36;                     // linha do alto (punho e ▾) + folga
    const rows = Math.max(4, Math.floor((util + gap) / (btn + gap)));
    // durante o arrasto a forma não muda (senão a largura pula no meio do encaixe); ao soltar, remede
    if (drag.current) { setLay((l) => (l.x === x && l.y === y ? l : { ...l, x, y })); return; }
    setLay((l) => (l.x === x && l.y === y && l.rows === rows && l.btn === btn ? l : { x, y, rows, btn }));
  }, [pos]);

  useEffect(() => {
    medir();
    const t = setInterval(medir, 700);
    addEventListener('resize', medir);
    return () => { clearInterval(t); removeEventListener('resize', medir); };
  }, [medir, mini]);

  // ---------------------------------------------------------- arrastar (punho)
  const down = useCallback((e) => {
    if (e.button !== 0) return;
    const r = boxRef.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue */ }
  }, []);
  const move = useCallback((e) => {
    if (!drag.current) return;
    const el = boxRef.current;
    // grade invisível + ímã nas bordas e nos vizinhos (Alt/⌥ desliga)
    const p = encaixarMover({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy, w: el.offsetWidth, h: el.offsetHeight },
      { excluir: el, livre: e.altKey });
    const x = Math.max(4, Math.min(p.x, window.innerWidth - el.offsetWidth - 4));
    const y = Math.max(4, Math.min(p.y, window.innerHeight - 60));
    setPos({ x, y });
  }, []);
  const up = useCallback((e) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    limparGuias();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    setPos((p) => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (_) { /* segue */ } return p; });
    // o organizador remede as áreas reservadas: as colunas se afastam do widget onde ele ficou
    window.dispatchEvent(new CustomEvent('aiv:widget-movido'));
  }, []);
  // lugar padrão: colada na borda esquerda, aberta (no celular continua como a pessoa deixou)
  const resetPos = () => {
    setPos(null);
    try { localStorage.removeItem(POS_KEY); } catch (_) { /* segue */ }
    if (window.innerWidth > 600) { setMiniBruto(false); try { localStorage.removeItem(MINI_KEY); } catch (_) { /* segue */ } }
    window.dispatchEvent(new CustomEvent('aiv:widget-movido'));
  };
  // «Organizar» (menu do avatar, tecla o) devolve o widget ao lugar automático
  useEffect(() => { addEventListener('aiv:organizar', resetPos); return () => removeEventListener('aiv:organizar', resetPos); }, []);

  // ---------------------------------------------------------- teclado
  useEffect(() => {
    if (!ativo) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.pje, .vde')) return;   // editor do +Projeto ou de vídeo aberto: as teclas são dele
      const pega = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      const st = marcStore.get();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey && st.podeDesfazer) { pega(); desfazer(); }
        else if (((k === 'z' && e.shiftKey) || k === 'y') && st.podeRefazer) { pega(); refazer(); }
        return;
      }
      // Shift+F10 / tecla Menu: menu de contexto da marcação selecionada (components/menu-contexto.js)
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { if (abrirMenuTeclado()) pega(); return; }
      // Alt+letra (como no Figma): alinhar/distribuir a seleção, travar, agrupar — pelo código da tecla (no Mac, Option muda o caractere)
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const c = e.code;
        const mapa = e.shiftKey ? { KeyH: 'distH', KeyV: 'distV' } : { KeyA: 'esq', KeyH: 'cx', KeyD: 'dir', KeyW: 'topo', KeyV: 'cy', KeyS: 'base' };
        if (mapa[c] && selecionados().length >= 2) { pega(); alinhar(selecionados(), mapa[c]); return; }
        if (c === 'KeyL' && !e.shiftKey && selecionados().length) { pega(); const ids = selecionados(); travar(ids, !ids.every((id) => (st.itens.find((i) => i.id === id) || {}).travado)); return; }
        if (c === 'KeyG' && !e.shiftKey && selecionados().length) { pega(); const g = window.prompt('Nome do grupo (camada) — vazio tira do grupo:', ''); if (g != null) definirGrupo(selecionados(), g); return; }
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') { if (cancelarRascunho()) pega(); else if (st.sel) { selecionar(null); } return; }
      if (e.key === '.') { pega(); setMais((v) => !v); return; }
      // contador: 1–9 escolhem a classe
      if (st.ferramenta === 'contador' && /^[1-9]$/.test(e.key)) { pega(); setOpc({ contClasse: `Classe ${e.key}` }); return; }
      if (e.key === 'Enter') {
        if (fecharPoligono()) { pega(); return; }
        // BeltScan: Enter conclui a edição na imagem (a configuração já foi aplicada ao soltar)
        const it = st.sel && st.itens.find((i) => i.id === st.sel);
        if (it && String(it.funcao).startsWith('bs_')) { pega(); selecionar(null); setFerramenta('mover'); }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (desfazerPonto()) pega();
        else if (st.sel) { pega(); apagar(st.sel); }
        return;
      }
      if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
      const k = e.shiftKey ? e.key.toUpperCase() : e.key.toLowerCase();
      if (TECLAS[k]) { pega(); escolher(TECLAS[k]); return; }
      if (k === 'H') { pega(); setVisivel(!st.visivel); return; }
      if (k === 'K') { pega(); setLista((v) => !v); return; }
      if (k === 'u') { pega(); alternarGrade(); return; }
      if (k === 'z') { pega(); setExib({ lupa: !st.exib.lupa }); return; }
      if (k === 'Z') { pega(); setExib({ mira: !st.exib.mira }); return; }
      if (k === 'N') { pega(); setExib({ encaixe: !st.exib.encaixe }); }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, [ativo]);

  if (!ativo) return null;

  const direita = lay.x > window.innerWidth / 2;
  const acoes = [
    { id: 'desfazer', nome: 'Desfazer', tecla: 'Ctrl/⌘+Z', icon: 'desfazer', disabled: !m.podeDesfazer, onClick: desfazer },
    { id: 'refazer', nome: 'Refazer', tecla: 'Ctrl/⌘+Y', icon: 'refazer', disabled: !m.podeRefazer, onClick: refazer },
    { id: 'visivel', nome: m.visivel ? 'Ocultar marcações' : 'Mostrar marcações', tecla: '⇧H', icon: m.visivel ? 'olho' : 'olhoFechado', on: !m.visivel, onClick: () => setVisivel(!m.visivel) },
    { id: 'limpar', nome: 'Limpar tudo', tecla: '', icon: 'limpar', disabled: !m.n, onClick: () => { if (window.confirm(`Apagar as ${m.n} marcações? (dá para desfazer)`)) limparTudo(); } },
    { id: 'lista', nome: 'Lista de marcações', tecla: '⇧K', icon: 'lista', on: lista, badge: m.n || null, onClick: () => setLista((v) => !v) },
    { id: 'capturar', nome: 'Capturar PNG com as marcações', tecla: 'S', icon: 'capturar', onClick: () => onSnapshot && onSnapshot() },
    ...(nEx ? [{ id: 'salvarEx', nome: `+Projeto: salvar estes exemplos (${nEx}) como print rotulado`, tecla: '', icon: 'salvarEx', badge: nEx, onClick: salvarExemplos }] : []),
  ];
  const atual = FERRAMENTAS.find((f) => f.id === m.ferramenta) || FERRAMENTAS[0];

  // ações/alternâncias do catálogo (ferramentas-mais.js): o que cada id faz e se está ligado
  const sel2 = nSel >= 2, sel3 = nSel >= 3;
  const extras = {
    encaixe: { on: ex.encaixe, onClick: () => setExib({ encaixe: !ex.encaixe }) },
    grade: { on: Boolean(ex.grade), onClick: alternarGrade, nome: ex.grade === 1 ? 'Grade: terços (U troca para N×N)' : ex.grade ? `Grade ${ex.gradeN}×${ex.gradeN} (U desliga)` : 'Grade / terços' },
    lupa: { on: ex.lupa, onClick: () => setExib({ lupa: !ex.lupa }) },
    mira: { on: ex.mira, onClick: () => setExib({ mira: !ex.mira }) },
    reguas: { on: ex.reguas, onClick: () => setExib({ reguas: !ex.reguas }) },
    analise: { on: Boolean(m.analise), disabled: !m.sel && !m.analise,
      onClick: () => { const st = marcStore.get(); marcStore.set({ analise: st.analise ? null : st.sel }); } },
    travar: { disabled: !nSel && !m.sel, onClick: () => { const ids = selecionados(); const it = marcStore.get().itens; travar(ids, !ids.every((id) => (it.find((i) => i.id === id) || {}).travado)); } },
    agrupar: { disabled: !nSel && !m.sel, onClick: () => { const g = window.prompt('Nome do grupo (camada) — vazio tira do grupo:', ''); if (g != null) definirGrupo(selecionados(), g); } },
  };
  for (const [id, modo] of ALINHAR) extras[id] = { disabled: modo.startsWith('dist') ? !sel3 : !sel2, onClick: () => alinhar(selecionados(), modo) };
  const porId = {};
  for (const a of acoes) porId[a.id] = a;
  /** Botão do catálogo pelo id (ferramenta ou ação). */
  const doCatalogo = (id) => {
    const c = CATALOGO.find((x) => x.id === id);
    if (!c) return null;
    if (c.tipo === 'ferr') return { id, nome: c.nome, tecla: c.tecla, icon: id, on: m.ferramenta === id, onClick: () => escolher(id), cat: c.cat, grupo: 'f' + c.grupo };
    const a = porId[id] || extras[id] || {};
    return { id, nome: a.nome || c.nome, tecla: c.tecla, icon: a.icon || id, cat: c.cat, grupo: 'a', on: a.on, disabled: a.disabled, badge: a.badge, onClick: a.onClick || (() => {}) };
  };
  const naBarra = barra.map(doCatalogo).filter(Boolean);
  // ferramenta ativa que não está fixada: lugar provisório antes do ⋯
  const provisoria = m.ferramenta !== 'mover' && !barra.includes(m.ferramenta) ? doCatalogo(m.ferramenta) : null;

  const botao = (b, extraCls = '') => html`
    <button key=${b.id} class="ferr-b ${b.on ? 'on' : ''} ${extraCls}" onClick=${b.onClick} disabled=${b.disabled}
            data-tip=${b.nome + (b.tecla ? ` (${b.tecla})` : '')} aria-label=${b.nome} aria-pressed=${b.on ? 'true' : 'false'}
            title=${b.nome + (b.tecla ? ` (${b.tecla})` : '')}>
      ${ICONS[b.icon] || ICONES[b.icon]}
      ${b.badge ? html`<i class="ferr-badge">${b.badge}</i>` : null}
    </button>`;

  // ⋯ também no recolhido: no celular o widget nasce recolhido e o catálogo inteiro fica a um toque
  const botaoMais = (cls) => html`
    <button key="mais" ref=${maisRef} class="ferr-b ferr-b-mais ${cls} ${mais ? 'on' : ''}" onClick=${() => setMais((v) => !v)}
            aria-haspopup="dialog" aria-expanded=${mais ? 'true' : 'false'} aria-label="Mais ferramentas"
            data-tip="Mais ferramentas (.)" title="Mais ferramentas (.)">${ICONES.mais}</button>`;

  const nBotoes = naBarra.length + (provisoria ? 1 : 0) + (nEx ? 1 : 0) + 1;
  const rows = Math.min(nBotoes, lay.rows);

  return html`
    <div ref=${boxRef}
         class="ferr ${mini ? 'mini' : ''} ${dragging ? 'dragging' : ''} ${direita ? 'direita' : ''}"
         style=${{ left: lay.x + 'px', top: lay.y + 'px' }}
         role="toolbar" aria-orientation="vertical" aria-label="Ferramentas de mouse">
      <div class="ferr-grip" title="Arraste para mover (Alt/⌥: sem encaixe) · duplo clique devolve à borda esquerda"
           onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
           onDoubleClick=${resetPos}><span></span><span></span><span></span></div>
      <button class="ferr-min" onClick=${() => { setMini(!mini); window.dispatchEvent(new CustomEvent('aiv:widget-movido')); }} aria-expanded=${!mini}
              title=${mini ? 'Abrir' : 'Recolher'}
              aria-label=${mini ? 'Abrir as ferramentas de mouse' : 'Recolher as ferramentas de mouse'}>${mini ? '▸' : '▾'}</button>
      ${mini
        ? html`<div class="ferr-grade">
            ${botao({ id: atual.id, nome: atual.nome + ' — clique para voltar a Mover', tecla: atual.tecla, icon: atual.id,
                      on: atual.id !== 'mover', onClick: () => setFerramenta('mover') })}
            ${botaoMais('')}
          </div>`
        : html`<div class="ferr-grade" style=${{ gridTemplateRows: `repeat(${rows}, ${lay.btn}px)` }}>
            ${naBarra.map((b, i) => botao(b, i && naBarra[i - 1].grupo !== b.grupo ? 'g-ini' : ''))}
            ${provisoria && botao(provisoria, 'g-ini provisoria')}
            ${nEx ? botao(acoes.find((a) => a.id === 'salvarEx'), 'g-ini') : null}
            ${botaoMais('g-ini')}
          </div>`}
    </div>
    ${m.ferramenta !== 'mover' && !mini && html`<${Dica} ferramenta=${m.ferramenta} lay=${lay} box=${boxRef} direita=${direita} />`}
    ${!mini && html`<${OpcoesFerramenta} ferramenta=${m.ferramenta} box=${boxRef} direita=${direita} />`}
    ${mais && html`<${MaisFerramentas} ancora=${boxRef} direita=${direita} barra=${barra} setBarra=${setBarra}
        ativo=${(id) => { const b = doCatalogo(id); return Boolean(b && b.on); }}
        desativado=${(id) => { const b = doCatalogo(id); return Boolean(b && b.disabled); }}
        escolher=${(id) => { const b = doCatalogo(id); if (b) b.onClick(); const c = CATALOGO.find((x) => x.id === id); if (c && c.tipo === 'ferr') setMais(false); }}
        icone=${(id) => { const b = doCatalogo(id); const k = b ? b.icon : id; return ICONS[k] || ICONES[k]; }}
        onFechar=${(foco) => { setMais(false); if (foco && maisRef.current) maisRef.current.focus(); }} />`}
    <${CartaoAnalise} box=${boxRef} direita=${direita} deslocar=${lista ? 368 : 0} />
    ${lista && html`<${ListaMarcacoes} box=${boxRef} direita=${direita} onFechar=${() => setLista(false)} />`}
    ${m.ferramenta === 'contagotas' && html`<${Leitura} />`}
    ${m.editando && html`<${EditorTexto} id=${m.editando} />`}
  `;
}

/** Grade: desligada → terços → N×N → desligada (tecla U). */
function alternarGrade() {
  const g = marcStore.get().exib.grade || 0;
  setExib({ grade: (g + 1) % 3 });
}

/** Escolhe a ferramenta; a de exemplo sem projeto ativo abre o +Projeto para criar um. */
function escolher(f) {
  setFerramenta(f);
  if (f === 'exemplo' && !projetoAtivo()) { abrirProjeto(); avisarProjeto('Crie um projeto e as classes: os exemplos desenhados no vídeo usam a classe ativa.'); }
}

// ------------------------------------------------------------- dica da ferramenta

const DICAS = {
  selecionar: 'Clique numa marcação para selecionar · arraste para mover · alças movem os vértices · Delete apaga · na linha selecionada, clique na seta para inverter',
  exemplo: 'Arraste uma caixa sobre o objeto: vira exemplo da classe ativa do +Projeto · 1–9 na lista troca a classe · "Salvar estes exemplos" leva quadro e caixas',
  retangulo: 'Arraste (ou clique e clique) para a área · conta quem está dentro com "Zonas e linhas"',
  poligono: 'Clique ponto a ponto · duplo clique, Enter ou clique no 1º ponto fecha · Backspace tira o último · Esc cancela',
  elipse: 'Arraste para o círculo/elipse',
  roi: 'Arraste: o pipeline passa a processar SÓ dentro desta área',
  exclusao: 'Arraste: o pipeline passa a IGNORAR o que está dentro',
  linha: 'Arraste de A para B · conta quem cruza nos dois sentidos (precisa de rastreio)',
  regua: 'Arraste para medir · calibre na lista (esta régua mede X mm) para medir em mm/cm',
  angulo: 'Clique 3 pontos: o do meio é o vértice',
  ponto: 'Clique para marcar um ponto',
  texto: 'Clique para escrever uma anotação (duplo clique num texto com Selecionar edita)',
  contagotas: 'Passe o cursor para ler a cor · clique fixa e copia',
  borracha: 'Clique ou arraste sobre as marcações para apagar (as travadas 🔒 ficam)',
  polilinha: 'Clique ponto a ponto · duplo clique ou Enter conclui · Backspace tira o último · mede o comprimento',
  seta: 'Arraste da base para a ponta',
  circulo3: 'Clique 3 pontos da borda: o círculo passa por eles (diâmetro, área, perímetro)',
  pincel: 'Arraste para pintar a máscara · com uma máscara selecionada, pinta nela · vira ROI/exclusão na lista',
  borrachaMascara: 'Arraste sobre a máscara selecionada (ou a que está sob o cursor) para apagar pixels',
  pontosChave: 'Clique os 17 pontos na ordem (nariz, olhos, orelhas, ombros…) · Enter conclui antes · Backspace volta',
  varinha: 'Clique numa região: a cor parecida (tolerância) vira polígono · não contígua: máscara com todos os pedaços',
  sam: 'Clique no objeto (⇧+clique: tirar região) · cada clique refina · Enter conclui · Esc cancela',
  medirArea: 'Clique ponto a ponto · Enter ou duplo clique fecha · mostra área e perímetro (mm² com a régua calibrada)',
  perfil: 'Arraste uma linha: o cartão mostra a intensidade R, G, B e cinza ao longo dela',
  histograma: 'Arraste uma área: o cartão mostra o histograma RGB/HSV, média e desvio',
  distancia: 'Clique em dois objetos (ou pontos): a distância liga os centroides e acompanha se eles mudarem',
  contador: 'Cada clique conta 1 na classe ativa · 1–9 trocam a classe · ⇧+clique tira o mais perto',
  cronometro: 'Clique para pôr um cronômetro no instante atual · clique nele para parar · de novo recomeça',
  trajetoria: 'Clique num ponto bem marcado (contraste) e dê play: ele é seguido e o rastro mostra a velocidade',
  perspectiva: 'Clique os 4 cantos do plano na ordem (ex.: sup. esq., sup. dir., inf. dir., inf. esq.)',
};

function Dica({ ferramenta, box, direita }) {
  const el = box.current;
  if (!el || window.innerWidth <= 640) return null;
  const r = el.getBoundingClientRect();
  const st = direita ? { right: (window.innerWidth - r.left + 8) + 'px', top: r.top + 'px' } : { left: (r.right + 8) + 'px', top: r.top + 'px' };
  const p = ferramenta === 'exemplo' && projetoAtivo();
  const c = p && p.classes[p.classe];
  return html`<div class="ferr-dica" style=${st} role="status">${c ? html`<b style=${{ color: c.cor }}>■ ${c.nome}</b> · ` : ''}${DICAS[ferramenta] || ''}</div>`;
}

// ------------------------------------------------------------- conta-gotas

function Leitura() {
  const { leitura: l } = useStore(leituraStore, (s) => ({ leitura: s.leitura }));
  useEffect(() => () => soltarLeitura(), []);
  if (!l) return null;
  const W = window.innerWidth, H = window.innerHeight;
  const x = l.cx + 250 > W ? l.cx - 244 : l.cx + 18;
  const y = l.cy + 120 > H ? l.cy - 112 : l.cy + 18;
  const hex = '#' + l.rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  return html`
    <div class="ferr-cor" style=${{ left: x + 'px', top: y + 'px' }} role="status">
      <div class="ferr-cor-l"><i style=${{ background: `rgb(${l.rgb.join(',')})` }}></i><b>${hex.toUpperCase()}</b>
        ${l.fixa && html`<em>fixada · copiada</em>`}</div>
      <div>RGB <b>${l.rgb.join(' · ')}</b></div>
      <div>HSV <b>${l.hsv[0]}° · ${l.hsv[1]}% · ${l.hsv[2]}%</b></div>
      <div>Cinza <b>${l.cinza}</b> · px <b>${l.x}, ${l.y}</b></div>
      <div class="ferr-cor-l"><i style=${{ background: `rgb(${l.media.join(',')})` }}></i><span title="média da região 11×11 px">média <b>${l.media.join(' · ')}</b></span></div>
    </div>`;
}

// ------------------------------------------------------------- editor de texto

function EditorTexto({ id }) {
  const it = useStore(marcStore, (s) => ({ it: s.itens.find((i) => i.id === id) })).it;
  const ref = useRef(null);
  const [v, setV] = useState(() => (it && it.texto) || '');
  useEffect(() => { if (ref.current) ref.current.focus(); }, []);
  if (!it) return null;
  const p = pontoNaJanela(it.pts[0][0], it.pts[0][1]);
  if (!p) return null;
  const fechar = (salvar) => {
    const txt = v.trim();
    if (salvar && txt) atualizar(id, { texto: txt });
    else if (!it.texto && !txt) apagar(id);
    marcStore.set({ editando: null });
  };
  return html`
    <input ref=${ref} class="ferr-texto" style=${{ left: Math.min(p.x, window.innerWidth - 230) + 'px', top: Math.max(4, p.y - 30) + 'px' }}
           value=${v} placeholder="Escreva e Enter" maxlength="200" aria-label="Texto da anotação"
           onInput=${(e) => setV(e.target.value)}
           onKeyDown=${(e) => { if (e.key === 'Enter') fechar(true); else if (e.key === 'Escape') { e.stopPropagation(); fechar(false); } }}
           onBlur=${() => fechar(true)} />`;
}

// ------------------------------------------------------------- lista de marcações

function ListaMarcacoes({ box, direita, onFechar }) {
  const st = useStore(marcStore, (s) => ({
    itens: s.itens, sel: s.sel, escala: s.escala, roiLigada: s.roiLigada, conjunto: s.conjunto, conjuntos: s.conjuntos,
    selN: s.selN, exib: s.exib,
  }));
  const nodes = useStore(store, (s) => ({ nodes: s.nodes })).nodes;
  const [, pulso] = useState(0);
  const [msg, setMsg] = useState('');
  const arq = useRef(null);
  const [cal, setCal] = useState({});   // id → { v, u }

  // resultados mudam a 30 Hz fora do React: 2×/s basta para a lista
  useEffect(() => { const t = setInterval(() => pulso((n) => n + 1), 500); return () => clearInterval(t); }, []);

  const el = box.current;
  const r = el ? el.getBoundingClientRect() : { left: 8, right: 52, top: 80 };
  const W = window.innerWidth;
  const estreito = W <= 640;
  const sty = estreito
    ? { left: '8px', right: '8px', top: r.top + 'px' }
    : direita ? { right: (W - r.left + 8) + 'px', top: r.top + 'px' } : { left: (r.right + 8) + 'px', top: r.top + 'px' };

  const ops = nodes.filter((n) => n.enabled).map((n) => n.op);
  const temContagem = st.itens.some((i) => i.funcao === 'zona' || i.funcao === 'cruzamento');
  const temLinha = st.itens.some((i) => i.funcao === 'cruzamento');
  const temOp = ops.includes('cena.zonas');
  const temRastreio = ops.some((op) => RASTREIO.has(op));
  const semId = st.itens.some((i) => { const x = resultados.get(i.id); return i.funcao === 'cruzamento' && fresco(x) && x.semId; });
  const k = mmPorPx();

  const importar = async (f) => {
    try { const n = importarJSON(await f.text()); setMsg(`${n} marcações importadas`); }
    catch (err) { setMsg('Falha ao importar: ' + err.message); }
  };

  const detalhe = (it) => {
    const novo = detalheNovo(it);
    if (novo != null) return novo + (it.grupo ? ` · grupo ${it.grupo}` : '');
    const x = resultados.get(it.id);
    if (it.tipo === 'regua') return fmtComprimento(comprimentoPx(it)) + (k ? '' : ` · ${comprimentoPx(it).toFixed(0)} px`);
    if (it.tipo === 'angulo') { const a = anguloGraus(it); return a == null ? '—' : a.toFixed(1) + '°'; }
    if (it.funcao === 'zona') {
      const area = fmtArea(areaPx(it));
      if (!fresco(x)) return `${area} · sem contagem (adicione "Zonas e linhas")`;
      const perm = x.permanencia.length ? ' · ' + x.permanencia.slice(0, 4).map((p) => `#${p.id} ${p.s.toFixed(0)}s`).join(' ') : '';
      return `${x.ocupacao} agora · máx ${x.max} · ${x.entradas} entradas · ${x.saidas} saídas${x.mediaS != null ? ` · média ${x.mediaS.toFixed(1)} s` : ''}${perm}`;
    }
    if (it.funcao === 'cruzamento') {
      if (!fresco(x)) return 'sem contagem (adicione "Zonas e linhas" + rastreio)';
      if (x.semId) return 'sem IDs: adicione o rastreio (Tracking com IDs)';
      const pc = Object.entries(x.porClasse).map(([c, v]) => `${c} ${v.ida}/${v.volta}`).join(' · ');
      return `${x.ida} ida · ${x.volta} volta${pc ? ' · ' + pc : ''}`;
    }
    if (AREAS.has(it.tipo)) return fmtArea(areaPx(it));
    if (it.tipo === 'texto') return it.texto || '';
    return '';
  };

  return html`
    <div class="ferr-lista" style=${sty} role="dialog" aria-label="Marcações">
      <div class="ferr-lista-h">
        <b>Marcações</b>
        <select value=${st.conjunto} title="Conjunto de marcações" aria-label="Conjunto"
                onChange=${(e) => usarConjunto(e.target.value)}>
          ${st.conjuntos.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}
        </select>
        <button class="btn tiny" title="Novo conjunto (as marcações atuais ficam salvas no conjunto atual)"
                onClick=${() => { const n = window.prompt('Nome do novo conjunto de marcações:'); if (n) usarConjunto(n); }}>+</button>
        <button class="btn tiny" title="Apagar este conjunto" disabled=${st.conjuntos.length < 2}
                onClick=${() => { if (window.confirm(`Apagar o conjunto «${st.conjunto}»?`)) apagarConjunto(); }}>−</button>
        <button class="ferr-x" onClick=${onFechar} aria-label="Fechar a lista">✕</button>
      </div>

      ${temContagem && !temOp && html`
        <div class="ferr-aviso">
          Zonas e linhas só contam com o operador <b>Zonas e linhas</b> no Pipeline.
          <button class="btn tiny accent" onClick=${() => adicionarContagem({ rastreio: temLinha })}>Adicionar contagem ao Pipeline</button>
        </div>`}
      ${temLinha && (semId || (temOp && !temRastreio)) && html`
        <div class="ferr-aviso">
          Contar cruzamentos precisa de ID de rastreio.
          <button class="btn tiny accent" onClick=${() => adicionarContagem({ rastreio: true })}>Adicionar rastreio (ByteTrack)</button>
        </div>`}

      ${st.itens.some((i) => i.funcao === 'projeto_exemplo') && html`
        <div class="ferr-aviso">
          Exemplos do <b>+Projeto</b> (${st.itens.filter((i) => i.funcao === 'projeto_exemplo').length}): o quadro e as caixas viram um print rotulado.
          <button class="btn tiny accent" onClick=${async () => { const pr = await salvarExemplos(); if (pr) setMsg(`Print salvo com ${pr.caixas.length} caixas.`); }}>Salvar estes exemplos</button>
        </div>`}
      ${!st.itens.length && html`<p class="ferr-vazio">Nenhuma marcação. Escolha uma ferramenta no widget e desenhe sobre o vídeo.</p>`}
      <${BarraAlinhar} icone=${(id) => ICONS[id] || ICONES[id]} />
      <${Camadas} />
      <ul class="ferr-itens">
        ${st.itens.map((it) => html`
          <li key=${it.id} class=${it.id === st.sel || st.selN.includes(it.id) ? 'sel' : ''} onClick=${(e) => selecionar(it.id, e.shiftKey)}>
            <div class="ferr-it-l">
              <input type="color" value=${it.cor} title="Cor" aria-label="Cor"
                     onChange=${(e) => atualizar(it.id, { cor: e.target.value })} />
              <input key=${it.id + it.nome} class="ferr-nome" defaultValue=${it.nome} aria-label="Nome" maxlength="60"
                     onBlur=${(e) => { const v = e.target.value.trim(); if (v && v !== it.nome) atualizar(it.id, { nome: v }); }}
                     onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
              <select value=${it.funcao} aria-label="Função" title="Função"
                      onChange=${(e) => { const f = e.target.value; atualizar(it.id, { funcao: f, ...(COR_FUNC[f] ? { cor: COR_FUNC[f] } : {}), ...(f === 'projeto_exemplo' ? dadosExemplo() : {}) }); }}>
                ${funcoesDe(it.tipo, it.funcao).map(([v, l]) => html`<option key=${v} value=${v}>${l}</option>`)}
              </select>
              <label class="ferr-vis" title="Visível"><input type="checkbox" checked=${it.visivel}
                     onChange=${(e) => atualizar(it.id, { visivel: e.target.checked })} />👁</label>
              <button class="ferr-cad ${it.travado ? 'on' : ''}" aria-pressed=${it.travado ? 'true' : 'false'}
                      title=${it.travado ? 'Destravar' : 'Travar (não move, não edita, a borracha não apaga)'} aria-label=${it.travado ? 'Destravar' : 'Travar'}
                      onClick=${(e) => { e.stopPropagation(); travar([it.id], !it.travado); }}>${it.travado ? '🔒' : '🔓'}</button>
              <button class="ferr-del" title="Apagar" aria-label="Apagar" onClick=${(e) => { e.stopPropagation(); apagar(it.id); }}>✕</button>
            </div>
            <div class="ferr-it-d">${detalhe(it)}</div>
            ${it.tipo === 'linha' && html`
              <div class="ferr-it-a"><button class="btn tiny" onClick=${() => inverter(it.id)}>Inverter sentido</button></div>`}
            <${AcoesItem} it=${it} />
            ${it.funcao === 'projeto_exemplo' && html`<${ClasseExemplo} it=${it} />`}
            ${(it.funcao === 'zona' || it.funcao === 'cruzamento') && html`
              <div class="ferr-it-a">
                <input key=${it.id + 'c' + it.classes} class="ferr-cls" defaultValue=${it.classes} placeholder="classes (ex.: pessoa, carro) — vazio = todas"
                       aria-label="Filtro de classes" onBlur=${(e) => { if (e.target.value !== it.classes) atualizar(it.id, { classes: e.target.value }); }}
                       onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
              </div>`}
            ${it.tipo === 'regua' && html`
              <div class="ferr-it-a">
                esta régua mede
                <input class="ferr-num" inputmode="decimal" value=${(cal[it.id] || {}).v || ''} placeholder="0"
                       onInput=${(e) => setCal({ ...cal, [it.id]: { ...(cal[it.id] || { u: 'mm' }), v: e.target.value } })} />
                <select value=${(cal[it.id] || {}).u || 'mm'}
                        onChange=${(e) => setCal({ ...cal, [it.id]: { ...(cal[it.id] || {}), u: e.target.value } })}>
                  <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
                </select>
                <button class="btn tiny accent" onClick=${() => {
                  const c = cal[it.id] || {};
                  setMsg(calibrar(it.id, c.v, c.u || 'mm') ? 'Escala calibrada: régua, áreas e ctx.marcacoes passam a usar mm' : 'Informe um valor maior que zero');
                }}>Calibrar</button>
              </div>`}
          </li>`)}
      </ul>

      <div class="ferr-escala">
        ${st.escala && k
          ? html`Escala: 1 px = <b>${k.toFixed(4)} mm</b> (${st.escala.ref} = ${st.escala.medida})
              <button class="btn tiny" onClick=${() => definirEscala(null)}>remover</button>`
          : html`Sem calibração: medidas em px da fonte. Desenhe uma régua sobre algo de tamanho conhecido e calibre.`}
      </div>
      <label class="ferr-roi"><input type="checkbox" checked=${st.roiLigada} onChange=${(e) => setRoiLigada(e.target.checked)} />
        Aplicar ROI e exclusão ao processamento</label>
      <div class="ferr-exib" role="group" aria-label="Exibição">
        <label>Lupa <select value=${st.exib.lupaZoom} aria-label="Ampliação da lupa" onChange=${(e) => setExib({ lupaZoom: +e.target.value })}>
          ${[2, 3, 4, 6, 8].map((z) => html`<option key=${z} value=${z}>${z}×</option>`)}</select></label>
        <label>Grade <input class="ferr-num" type="number" min="2" max="24" value=${st.exib.gradeN} aria-label="Divisões da grade"
               onChange=${(e) => setExib({ gradeN: Math.max(2, Math.min(24, +e.target.value || 6)) })} /> divisões</label>
      </div>

      <div class="ferr-lista-f">
        <button class="btn tiny" disabled=${!st.itens.length}
                onClick=${() => baixar(`marcacoes-${st.conjunto}.json`, exportarJSON())}>Exportar JSON</button>
        <button class="btn tiny" onClick=${() => arq.current && arq.current.click()}>Importar JSON</button>
        <button class="btn tiny" disabled=${!eventos.length}
                onClick=${() => baixar(`eventos-marcacoes-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, eventosCSV(), 'text/csv')}>
          CSV de eventos (${eventos.length})</button>
        <button class="btn tiny" onClick=${zerarContagens}>Zerar contagens</button>
        ${st.itens.some((i) => i.tipo === 'contador') && html`
          <button class="btn tiny" onClick=${() => baixar(`contador-${st.conjunto}.csv`, contadoresCSV(), 'text/csv')}>CSV do contador</button>`}
        <input ref=${arq} type="file" accept=".json,application/json" hidden
               onChange=${(e) => { const f = e.target.files[0]; if (f) importar(f); e.target.value = ''; }} />
      </div>
      ${msg && html`<div class="ferr-msg" role="status">${msg}</div>`}
    </div>`;
}

/** Classe de uma marcação de exemplo (as do projeto ativo; 1–9 com o foco no seletor). */
function ClasseExemplo({ it }) {
  const p = useStore(projStore, (s) => ({ p: s.projetos.find((x) => x.id === s.ativo) })).p;
  if (!p) return html`<div class="ferr-it-a">Sem projeto ativo: abra o <button class="btn tiny" onClick=${abrirProjeto}>+Projeto</button></div>`;
  const k = p.classes.findIndex((c) => c.nome === it.classe);
  return html`
    <div class="ferr-it-a">
      classe
      <select value=${k} aria-label="Classe do exemplo" onClick=${(e) => e.stopPropagation()}
              onChange=${(e) => { const i = +e.target.value; atualizar(it.id, dadosExemplo(i)); setClasseAtiva(i); }}>
        ${k < 0 && html`<option value="-1">${it.classe || '(sem classe)'}</option>`}
        ${p.classes.map((c, i) => html`<option key=${i} value=${i}>${i < 9 ? i + 1 + ' · ' : ''}${c.nome}</option>`)}
      </select>
    </div>`;
}

// ------------------------------------------------------------- ícones

const svg = (d, extra = null) => html`
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} />${extra}</svg>`;

const ICONS = {
  mover: svg('M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3'),
  selecionar: svg('M6 3l12 9-5.5 1.2L15 19l-2.4 1.1-2.6-5.7L6 18z'),
  retangulo: svg('M4 6h16v12H4z'),
  exemplo: svg('M4 6h11M4 6v12h16v-5M15 6M18 3v6M15 6h6'),
  salvarEx: svg('M5 4h11l3 3v13H5zM8 4v5h7V4M12 13v5M9.5 15.5h5'),
  poligono: svg('M5 9l7-5 7 5-2.5 10h-9z'),
  elipse: svg('M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z'),
  roi: svg('M4 9V6h3M17 6h3v3M20 15v3h-3M7 18H4v-3M10 12h4M12 10v4'),
  exclusao: svg('M4 6h16v12H4zM4 13l7-7M8 18l12-12M14 18l6-6'),
  linha: svg('M4 18L20 6M10 8l4 6M14 14v-3.6M14 14h-3.6'),
  regua: svg('M3 16.5L16.5 3 21 7.5 7.5 21zM7 12.5l2 2M10 9.5l2 2M13 6.5l2 2'),
  angulo: svg('M4 19h16M4 19L14 5M10 19a6 6 0 0 0-2.4-4.8'),
  ponto: svg('M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'),
  texto: svg('M5 7V5h14v2M12 5v14M9 19h6'),
  contagotas: svg('M14.5 4.5l5 5-2 2-5-5zM13 7.5l-8 8V19h3.5l8-8'),
  borracha: svg('M15 4l5 5-9 9H6l-3-3zM9 10l5 5M11 20h9'),
  desfazer: svg('M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3'),
  refazer: svg('M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3'),
  olho: svg('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
  olhoFechado: svg('M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 3l18 18'),
  limpar: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  lista: svg('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'),
  capturar: svg('M4 8h4l1-2h6l1 2h4v11H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z'),
};
