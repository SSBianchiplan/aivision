/**
 * components/Panel.js — casca de painel, em dois modos.
 *
 *   ancorado  fica numa das colunas laterais; a coluna é um flex container,
 *             então a não-sobreposição é garantida pelo layout, não por
 *             coordenadas calculadas na mão
 *   flutuante o usuário arrastou para fora; aí sim é posição absoluta
 *
 * Arrastar o cabeçalho de um painel ancorado o solta da coluna (só depois
 * de mover alguns pixels: um clique não solta mais nada). O botão
 * "Organizar" devolve todo mundo para as colunas.
 *
 * Ancorado, o painel encolhe junto com os vizinhos quando a coluna enche
 * (o corpo rola, o cabeçalho fica) até a altura mínima que o organizador
 * publica (layout/organizador.js); sem altura nem para isso, ele recolhe
 * para só o cabeçalho — ▸ abre de novo.
 *
 * Solto, o ▾/▸ ao lado do ✕ também recolhe para só o cabeçalho, no mesmo
 * lugar (guardado em store.recolhidos, como o dos ancorados). Arrastar e
 * redimensionar encaixam na grade invisível e nos vizinhos (layout/grade.js);
 * Alt/⌥ solta o encaixe.
 */

import { html, useState, useRef, useCallback, useEffect } from '../vendor.js';
import { railTop, NARROW } from '../state/breakpoint.js';
import { aceitaComando } from '../via/comandos.js';
import { useStore, store } from '../state/store.js';
import { layoutStore, alternarRecolhido } from '../layout/organizador.js';
import { encaixarMover, encaixarTamanho, limparGuias, PASSO } from '../layout/grade.js';
import { CampoComando } from '../via/CampoComando.js';

let zTop = 100;
const SEM_LAYOUT = {};
const LIMIAR_SOLTAR = 6;   // px de arrasto antes de soltar o painel da coluna

export function Panel({
  id, title, subtitle, onClose, children,
  docked = false, onUndock, pos, onMove, width = 316,
}) {
  const ref = useRef(null);
  /*
   * Tamanho por painel, guardado por id.
   *
   * Ancorado, só a ALTURA é do usuário — a largura é da coluna, senão um
   * painel largo empurraria os vizinhos e quebraria a garantia de não
   * sobreposição. Flutuante, as duas dimensões são livres.
   */
  const [size, setSize] = useState(() => loadSize(id));
  const resizing = useRef(null);
  const [z, setZ] = useState(() => ++zTop);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  // inicializador preguiçoso: railTop() lê getComputedStyle (e mede a barra no celular) e rodava a CADA render do painel
  const [local, setLocal] = useState(() => pos || { x: 24, y: railTop() });
  const lay = useStore(layoutStore, (st) => st.paineis[id] || SEM_LAYOUT);
  const recSolto = useStore(store, (st) => Boolean(st.recolhidos && st.recolhidos[id]));
  // ancorado: quem decide é o organizador (usuário ou falta de altura); solto: só o usuário
  const recolhido = docked ? Boolean(lay.rec) : recSolto;

  useEffect(() => {
    // A posicao guardada pode vir de outra tela (ou de antes da barra crescer):
    // entra sempre pelo clamp, nunca crua.
    if (pos) setLocal(clamp(pos, ref.current));
  }, [pos && pos.x, pos && pos.y]);

  useEffect(() => {
    if (docked) return;
    // primeiro render e cada vez que a barra republica --rail-top
    const re = () => setLocal((p) => clamp(p, ref.current));
    re();
    window.addEventListener('railtop', re);
    return () => window.removeEventListener('railtop', re);
  }, [docked]);

  useEffect(() => {
    if (docked) return;
    const onResize = () => setLocal((p) => clamp(p, ref.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [docked]);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    limparGuias();
    setLocal((p) => {
      onMove && onMove(p);
      return p;
    });
  }, [onMove]);

  /*
   * A captura de ponteiro TEM que ser no mesmo elemento que tem os handlers.
   * Capturar no <section> com os handlers no <header> redireciona os eventos
   * seguintes para a section — e como eventos não descem para descendentes,
   * o pointerup nunca chega no header: o painel fica grudado no cursor.
   * Era exatamente esse o bug de "widget não solta". Por isso e.currentTarget.
   */
  const down = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input, select, a, textarea')) return;

    const rect = ref.current.getBoundingClientRect();
    // ao soltar da coluna, mantém o painel exatamente onde já estava na tela
    const start = { x: rect.left, y: rect.top };
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, x0: e.clientX, y0: e.clientY, start, solto: !docked };
    setZ(++zTop);
    if (!docked) { setLocal(start); setDragging(true); }
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* fallback global cobre */ }
  }, [docked]);

  const move = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    if (!d.solto) {
      // ancorado: só solta da coluna depois de um arrasto de verdade
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < LIMIAR_SOLTAR) return;
      d.solto = true;
      setLocal(d.start);
      setDragging(true);
      if (onUndock) onUndock(d.start);
    }
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= 3) d.movido = true;
    // grade invisível + ímã nas bordas e nos vizinhos (Alt/⌥ desliga)
    const el = ref.current;
    const p = encaixarMover({ x: e.clientX - d.dx, y: e.clientY - d.dy, w: el ? el.offsetWidth : width, h: el ? el.offsetHeight : 200 },
      { excluir: el, livre: e.altKey });
    setLocal(clamp(p, el));
  }, [onUndock, width]);

  const up = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    if (!d.solto) {
      // clique sem arrastar: no recolhido, abre
      drag.current = null;
      if (recolhido && e.type === 'pointerup') alternarRecolhido(id);
      return;
    }
    // solto e recolhido: um clique (sem arrastar) no cabeçalho também abre
    if (!d.movido && recolhido && !docked && e.type === 'pointerup') alternarRecolhido(id);
    endDrag();
  }, [endDrag, recolhido, id, docked]);

  /*
   * Rede de segurança: alt-tab, pointerup fora da janela ou cancelamento do
   * browser soltam o painel do mesmo jeito. Sem isso, um evento perdido deixa
   * o widget preso para sempre — que é o pior modo de falha possível aqui.
   */
  useEffect(() => {
    if (!dragging) return;
    const stop = () => endDrag();
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
  }, [dragging, endDrag]);

  const startResize = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    const r = ref.current.getBoundingClientRect();
    resizing.current = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* fallback global */ }
  }, []);

  const doResize = useCallback((e) => {
    const r = resizing.current;
    if (!r) return;
    let w = r.w + (e.clientX - r.x), h = r.h + (e.clientY - r.y);
    const el = ref.current;
    if (!docked && el) {
      // solto: a borda direita e a de baixo grudam nos vizinhos; sem vizinho, passos da grade
      const q = el.getBoundingClientRect();
      ({ w, h } = encaixarTamanho({ x: q.left, y: q.top, w, h }, { excluir: el, livre: e.altKey }));
    } else if (!e.altKey) h = Math.round(h / PASSO) * PASSO;   // ancorado: só a altura, em passos da grade
    // limites: menor que isto o cabeçalho não cabe; maior estoura a viewport
    w = Math.max(240, Math.min(window.innerWidth - 40, w));
    h = Math.max(120, Math.min(window.innerHeight - 60, h));
    setSize({ w: Math.round(w), h: Math.round(h) });
  }, [docked]);

  const endResize = useCallback((e) => {
    if (!resizing.current) return;
    resizing.current = null;
    limparGuias();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    setSize((sz) => { saveSize(id, sz); return sz; });
  }, [id]);

  /*
   * Ancorado: a altura escolhida vira a BASE do flex (encolhe com os vizinhos
   * se a coluna encher); o piso é a altura mínima do organizador.
   */
  const style = docked && !dragging
    ? {
        ...(size.h && !recolhido ? { flexBasis: size.h + 'px', maxHeight: 'none' } : {}),
        ...(lay.minH ? { minHeight: lay.minH + 'px' } : {}),
      }
    : {
        left: local.x + 'px', top: local.y + 'px',
        width: (size.w || width) + 'px',
        ...(size.h && !recolhido ? { height: size.h + 'px', maxHeight: 'none' } : {}),
        zIndex: z,
      };

  return html`
    <section
      ref=${ref}
      class="panel ${docked && !dragging ? 'docked' : 'floating'} ${dragging ? 'dragging' : ''} ${recolhido ? 'recolhido' : ''}"
      style=${style}
      data-painel=${id}
      data-alt=${docked && size.h ? size.h : null}
      onPointerDown=${() => setZ(++zTop)}
      role="dialog"
      aria-label=${title}
    >
      <header
        class="panel-head"
        onPointerDown=${down}
        onPointerMove=${move}
        onPointerUp=${up}
        onPointerCancel=${up}
        title=${docked
          ? (recolhido ? 'Clique para abrir · arraste para soltar da coluna' : 'Arraste para soltar da coluna')
          : (recolhido ? 'Clique para abrir · arraste para mover (Alt/⌥: sem encaixe)' : 'Arraste para mover (Alt/⌥: sem encaixe)')}
      >
        <div class="panel-title">
          <b>${title}</b>
          ${subtitle && html`<em>${subtitle}</em>`}
        </div>
        <button class="panel-rec" onClick=${() => alternarRecolhido(id)} aria-expanded=${!recolhido}
          title=${recolhido ? 'Abrir' : 'Recolher'}
          aria-label=${recolhido ? 'Abrir o painel' : 'Recolher o painel'}>${recolhido ? '▸' : '▾'}</button>
        <button class="panel-x" onClick=${onClose} title="Fechar" aria-label="Fechar painel">✕</button>
      </header>
      <div class="panel-body">${children}</div>

      <div
        class="panel-grip"
        onPointerDown=${startResize}
        onPointerMove=${doResize}
        onPointerUp=${endResize}
        onPointerCancel=${endResize}
        onDoubleClick=${() => { setSize({}); clearSize(id); }}
        title="Arraste para redimensionar · duplo clique volta ao automático"
        role="separator"
        aria-label="Redimensionar painel"
      ></div>
    </section>
  `;
}

function clamp(p, el) {
  const w = el ? el.offsetWidth : 316;
  const h = el ? el.offsetHeight : 200;
  const m = 8;
  /*
   * No CELULAR o teto é a base da barra de menu, não a borda da tela.
   *
   * A barra ali é fixa, ocupa a largura toda e não sai do lugar — qualquer
   * painel acima dela fica escondido, sem nenhum jeito de o usuário
   * recuperá-lo, porque o que ele arrastaria é justamente a parte coberta.
   *
   * No computador o teto continua sendo a borda: lá a barra é estreita,
   * pode ser arrastada para longe, e forçar todo painel para baixo dela
   * jogaria fora uma faixa inteira de tela útil.
   */
  const teto = window.innerWidth < NARROW ? railTop() : m;
  return {
    x: Math.min(Math.max(m, p.x), Math.max(m, window.innerWidth - w - m)),
    y: Math.min(Math.max(teto, p.y), Math.max(teto, window.innerHeight - Math.min(h, 120) - m)),
  };
}

// ------------------------------------------------------- tamanho

/**
 * Tamanho escolhido pelo usuário, por painel.
 *
 * Objeto vazio significa "automático": ancorado, a altura vem do conteúdo;
 * flutuante, a largura vem da prop. É o estado inicial e o que o duplo
 * clique na alça restaura.
 */
function loadSize(id) {
  try {
    const raw = localStorage.getItem('vlc.size.' + id);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* modo privado ou storage bloqueado */ }
  return {};
}

function saveSize(id, sz) {
  try {
    localStorage.setItem('vlc.size.' + id, JSON.stringify(sz));
  } catch (_) { /* segue sem persistir */ }
}

function clearSize(id) {
  try {
    localStorage.removeItem('vlc.size.' + id);
  } catch (_) { /* ignora */ }
}

// ------------------------------------------------------- controles de param

/**
 * Renderiza um controle a partir do schema declarado no operador.
 * `op`/`nodeId` (opcionais, vindos do Pipeline): campo de texto que aceita
 * comando ganha ★ (comandos salvos) e ✨ Via (via/CampoComando.js).
 */
export function ParamControl({ name, schema, value, onChange, op = null, nodeId = null }) {
  const label = schema.label || name;

  if (schema.type === 'bool') {
    return html`
      <label class="ctl ctl-bool">
        <input type="checkbox" checked=${Boolean(value)}
               onChange=${(e) => onChange(e.target.checked)} />
        <span>${label}</span>
      </label>
    `;
  }

  if (schema.type === 'text' && op && aceitaComando(op, name, schema)) {
    return html`
      <div class="ctl ctl-text ctl-cmd">
        <label>
          <span class="ctl-label">${label}</span>
          <input type="text" value=${String(value ?? '')} placeholder=${schema.placeholder || ''}
                 spellcheck="false" autocapitalize="off"
                 onChange=${(e) => onChange(e.target.value)}
                 onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
        </label>
        <${CampoComando} op=${op} nome=${name} schema=${schema} value=${value} onChange=${onChange} nodeId=${nodeId} />
      </div>
    `;
  }

  if (schema.type === 'text') {
    // texto livre (lista de classes, frases): aplica ao sair do campo ou no Enter,
    // não a cada tecla — cada mudança re-parametriza um modelo
    return html`
      <label class="ctl ctl-text">
        <span class="ctl-label">${label}</span>
        <input type="text" value=${String(value ?? '')} placeholder=${schema.placeholder || ''}
               spellcheck="false" autocapitalize="off"
               onChange=${(e) => onChange(e.target.value)}
               onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
      </label>
    `;
  }

  if (schema.type === 'enum') {
    return html`
      <label class="ctl">
        <span class="ctl-label">${label}</span>
        <select value=${String(value)} onChange=${(e) => {
          const raw = e.target.value;
          const match = schema.options.find((o) => String(o) === raw);
          onChange(match !== undefined ? match : raw);
        }}>
          ${schema.options.map((o) => html`<option key=${String(o)} value=${String(o)}>${o}</option>`)}
        </select>
      </label>
    `;
  }

  const step = schema.step || (schema.type === 'int' ? 1 : 0.1);
  return html`
    <label class="ctl">
      <span class="ctl-label">${label}<b>${fmt(value)}</b></span>
      <input type="range" min=${schema.min} max=${schema.max} step=${step}
             value=${value}
             onInput=${(e) => onChange(schema.type === 'int'
               ? parseInt(e.target.value, 10)
               : parseFloat(e.target.value))} />
    </label>
  `;
}

function fmt(v) {
  if (typeof v !== 'number') return String(v);
  return Number.isInteger(v) ? v : v.toFixed(2);
}
