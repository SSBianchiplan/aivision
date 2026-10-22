/**
 * components/ferramentas-mais.js — o POPOVER "⋯ Mais ferramentas" do widget
 * de Ferramentas de mouse e o CATÁLOGO de tudo o que ele oferece.
 *
 * O catálogo junta os MODOS do mouse (cv/marcacoes.js › FERRAMENTAS) e as
 * AÇÕES/alternâncias (desfazer, grade, lupa, alinhar…), cada um com
 * categoria, ícone, nome, atalho e descrição curta. O popover mostra tudo em
 * grade, agrupado por categoria (Desenhar · Inteligentes · Medir/Analisar ·
 * Exibição · Organizar), com busca por nome/descrição e o alfinete "fixar na
 * barra": o usuário escolhe quais aparecem na barra vertical e em que ordem
 * (arrastar, ou Alt+←/→ no teclado); o resto fica só aqui. A escolha fica no
 * aparelho (localStorage).
 *
 * Acessível: role="dialog", foco na busca ao abrir, setas percorrem os itens,
 * Esc fecha e devolve o foco ao botão ⋯. Abre para o lado livre da tela (o
 * widget fica colado à esquerda: abre à direita); no celular, folha de baixo.
 */

import { html, useState, useEffect, useRef } from '../vendor.js';
import { FERRAMENTAS } from '../cv/marcacoes.js';
import { ocupados } from '../layout/organizador.js';
import { FOLGA } from '../layout/grade.js';
import { railTop } from '../state/breakpoint.js';

/**
 * Lugar do popover: ao lado do widget, no LADO LIVRE — testa à direita e à
 * esquerda (afastado FOLGA px, a mesma folga do ímã da grade) e fica com o
 * que cabe na janela e menos cobre o que o organizador marca como ocupado
 * (colunas de painéis, barra de vídeo, Seção da correia, gaveta da Via).
 * Sem lado que caiba (tela estreita): null = folha de baixo.
 */
export function ladoLivre(ancora, w, h) {
  const W = window.innerWidth, H = window.innerHeight;
  const r = ancora.getBoundingClientRect();
  const y = Math.max(Math.min(railTop(), r.top), Math.min(r.top, H - h - 8));
  const occ = ocupados(['.ferr', '.ferr-pop']);
  const cobre = (x) => {
    let a = 0;
    for (const o of occ) a += Math.max(0, Math.min(x + w, o.x1) - Math.max(x, o.x0)) * Math.max(0, Math.min(y + h, o.y1) - Math.max(y, o.y0));
    return a;
  };
  const cands = [r.right + FOLGA, r.left - w - FOLGA].filter((x) => x >= 4 && x + w <= W - 4);
  if (!cands.length) return null;
  cands.sort((a, b) => cobre(a) - cobre(b));
  return { x: Math.round(cands[0]), y: Math.round(Math.max(8, y)) };
}

export const CATEGORIAS = [
  ['desenhar', 'Desenhar'],
  ['inteligentes', 'Inteligentes'],
  ['medir', 'Medir / Analisar'],
  ['exibicao', 'Exibição'],
  ['organizar', 'Organizar'],
];

/** Ações e alternâncias (o que não é modo do mouse). O widget liga cada id ao que faz. */
export const ACOES = [
  { id: 'desfazer', cat: 'organizar', nome: 'Desfazer', tecla: 'Ctrl/⌘+Z', desc: 'Volta a última mudança das marcações' },
  { id: 'refazer', cat: 'organizar', nome: 'Refazer', tecla: 'Ctrl/⌘+Y', desc: 'Refaz o que foi desfeito' },
  { id: 'visivel', cat: 'exibicao', nome: 'Mostrar / ocultar marcações', tecla: '⇧H', desc: 'Só a exibição: ROI, zonas e contagens continuam valendo' },
  { id: 'limpar', cat: 'organizar', nome: 'Limpar tudo', tecla: '', desc: 'Apaga todas as marcações (dá para desfazer)' },
  { id: 'lista', cat: 'organizar', nome: 'Lista de marcações', tecla: '⇧K', desc: 'Nomes, funções, camadas, cadeado, calibração, exportar' },
  { id: 'capturar', cat: 'exibicao', nome: 'Capturar PNG com as marcações', tecla: 'S', desc: 'Quadro atual com os desenhos (sem grade, lupa e mira)' },
  { id: 'encaixe', cat: 'inteligentes', nome: 'Encaixar na borda', tecla: '⇧N', desc: 'Vértices vão para a borda (gradiente) mais forte por perto' },
  { id: 'grade', cat: 'exibicao', nome: 'Grade / terços', tecla: 'U', desc: 'Alterna terços → grade N×N → desligada' },
  { id: 'lupa', cat: 'exibicao', nome: 'Lupa sob o cursor', tecla: 'Z', desc: 'Amplia os pixels da fonte (3×; ajuste na lista)' },
  { id: 'mira', cat: 'exibicao', nome: 'Mira com coordenadas', tecla: '⇧Z', desc: 'Cruz no cursor com x, y em px (e mm calibrado)' },
  { id: 'reguas', cat: 'exibicao', nome: 'Réguas nas bordas', tecla: '', desc: 'Escala em px ou mm no topo e à esquerda; segue o zoom' },
  { id: 'analise', cat: 'medir', nome: 'Cartão de análise', tecla: '', desc: 'Histograma ou perfil da marcação selecionada, ao vivo' },
  { id: 'travar', cat: 'organizar', nome: 'Travar / destravar seleção', tecla: 'Alt+L', desc: 'Cadeado: não move, não edita, a borracha não apaga' },
  { id: 'agrupar', cat: 'organizar', nome: 'Agrupar seleção (camada)', tecla: 'Alt+G', desc: 'Põe as selecionadas num grupo: mostrar/ocultar/travar juntas' },
  { id: 'alEsq', cat: 'organizar', nome: 'Alinhar à esquerda', tecla: 'Alt+A', desc: 'Selecione 2+ com ⇧+clique (Selecionar)' },
  { id: 'alCx', cat: 'organizar', nome: 'Centralizar na horizontal', tecla: 'Alt+H', desc: 'Centros alinhados numa vertical' },
  { id: 'alDir', cat: 'organizar', nome: 'Alinhar à direita', tecla: 'Alt+D', desc: 'Bordas direitas alinhadas' },
  { id: 'alTopo', cat: 'organizar', nome: 'Alinhar ao topo', tecla: 'Alt+W', desc: 'Bordas de cima alinhadas' },
  { id: 'alCy', cat: 'organizar', nome: 'Centralizar na vertical', tecla: 'Alt+V', desc: 'Centros alinhados numa horizontal' },
  { id: 'alBase', cat: 'organizar', nome: 'Alinhar à base', tecla: 'Alt+S', desc: 'Bordas de baixo alinhadas' },
  { id: 'distH', cat: 'organizar', nome: 'Distribuir na horizontal', tecla: 'Alt+⇧H', desc: 'Espaços iguais entre 3+ selecionadas' },
  { id: 'distV', cat: 'organizar', nome: 'Distribuir na vertical', tecla: 'Alt+⇧V', desc: 'Espaços iguais entre 3+ selecionadas' },
];

/** Catálogo completo: { id, tipo: 'ferr'|'acao', cat, nome, tecla, desc }. */
export const CATALOGO = [
  ...FERRAMENTAS.map((f) => ({ ...f, tipo: 'ferr' })),
  ...ACOES.map((a) => ({ ...a, tipo: 'acao' })),
];

const BARRA_KEY = 'gplansis.ferramentas.barra';

/** O que vinha na barra antes do popover: as 15 ferramentas e as 6 ações de sempre. */
export const BARRA_PADRAO = [
  'mover', 'selecionar', 'retangulo', 'poligono', 'elipse', 'exemplo', 'roi', 'exclusao', 'linha', 'regua',
  'angulo', 'ponto', 'texto', 'contagotas', 'borracha', 'desfazer', 'refazer', 'visivel', 'limpar', 'lista', 'capturar',
];

export function lerBarra() {
  try {
    const l = JSON.parse(localStorage.getItem(BARRA_KEY) || 'null');
    if (Array.isArray(l)) return l.filter((id) => CATALOGO.some((c) => c.id === id));
  } catch (_) { /* storage bloqueado ou JSON corrompido */ }
  return BARRA_PADRAO.slice();
}

export function salvarBarra(l) {
  try { localStorage.setItem(BARRA_KEY, JSON.stringify(l)); } catch (_) { /* segue sem guardar */ }
}

/** Nome sem a instrução entre parênteses (ela já está na descrição). */
const curto = (n) => String(n).replace(/\s*\((clique|3 pontos|cor|A→B|aberta|anotação|região|polígono|caixa|esqueleto|4 pontos)[^)]*\)\s*$/, '');

/** Normaliza para busca: minúsculas, sem acento. */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Popover. Props:
 *   ancora   ref do widget (abre ao lado dele)   direita  o widget está na metade direita
 *   barra    ids fixados (ordem)                  setBarra(l)
 *   ativo(id) → bool (ferramenta/alternância ligada)   desativado(id) → bool
 *   escolher(id)   icone(id) → vnode   onFechar(devolverFoco)
 */
export function MaisFerramentas({ ancora, direita, barra, setBarra, ativo, desativado, escolher, icone, onFechar }) {
  const [busca, setBusca] = useState('');
  const [arrastando, setArrastando] = useState(null);
  const ref = useRef(null);
  const buscaRef = useRef(null);

  useEffect(() => {
    if (buscaRef.current) buscaRef.current.focus({ preventScroll: true });
    const fora = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.ferr-b-mais')) return;   // o próprio botão ⋯ alterna
      onFechar(false);
    };
    document.addEventListener('pointerdown', fora, true);
    return () => document.removeEventListener('pointerdown', fora, true);
  }, []);

  const W = window.innerWidth, H = window.innerHeight;
  const larg = Math.min(560, W - 24), alt = Math.min(H - 16, 620);
  const lugar = W > 640 && ancora.current ? ladoLivre(ancora.current, larg, alt) : null;
  const folha = !lugar;
  let sty = { left: lugar ? lugar.x + 'px' : 0, top: lugar ? lugar.y + 'px' : 0, width: larg + 'px' };
  if (folha) {
    // folha de baixo, mas acima da barra de vídeo (que mora embaixo, em outra camada)
    const vc = document.querySelector('.vctl');
    const vr = vc && vc.getBoundingClientRect();
    const fundo = vr && vr.height && vr.top > H / 2 ? Math.max(0, H - vr.top + 6) : 0;
    sty = { bottom: fundo + 'px', maxHeight: `min(72vh, calc(100vh - ${fundo + 70}px))` };
  }

  const q = norm(busca.trim());
  const casa = (c) => !q || norm(c.nome).includes(q) || norm(c.desc).includes(q) || norm(c.tecla) === q || norm(c.id).includes(q);
  const grupos = CATEGORIAS.map(([cat, rot]) => [cat, rot, CATALOGO.filter((c) => c.cat === cat && casa(c))]).filter((g) => g[2].length);
  const nAchados = grupos.reduce((s, g) => s + g[2].length, 0);

  const fixar = (id) => setBarra(barra.includes(id) ? barra.filter((x) => x !== id) : [...barra, id]);
  const mover = (id, d) => {
    const i = barra.indexOf(id), j = i + d;
    if (i < 0 || j < 0 || j >= barra.length) return;
    const l = barra.slice(); [l[i], l[j]] = [l[j], l[i]]; setBarra(l);
  };
  const soltarEm = (alvo) => {
    if (!arrastando || arrastando === alvo) return;
    const l = barra.filter((x) => x !== arrastando);
    l.splice(l.indexOf(alvo), 0, arrastando);
    setBarra(l);
  };

  const teclas = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar(true); return; }
    const its = [...ref.current.querySelectorAll('.ferr-pop-b:not([disabled])')];
    const i = its.indexOf(document.activeElement);
    const emBusca = e.target === buscaRef.current;
    if (e.key === 'ArrowDown' && emBusca) { e.preventDefault(); if (its[0]) its[0].focus(); return; }
    if (i < 0) return;
    // a grade tem 2 colunas (1 na folha): ↑/↓ pulam uma linha, ←/→ um item
    const col = folha ? 1 : 2;
    let j = -1;
    if (e.key === 'ArrowRight') j = i + 1;
    else if (e.key === 'ArrowLeft') j = i - 1;
    else if (e.key === 'ArrowDown') j = i + col;
    else if (e.key === 'ArrowUp') { j = i - col; if (j < 0) { e.preventDefault(); buscaRef.current.focus(); return; } }
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = its.length - 1;
    else return;
    e.preventDefault();
    if (its[Math.max(0, Math.min(its.length - 1, j))]) its[Math.max(0, Math.min(its.length - 1, j))].focus();
  };

  const porId = (id) => CATALOGO.find((c) => c.id === id);

  return html`
    <div ref=${ref} class="ferr-pop ${folha ? 'folha' : ''}" style=${sty} role="dialog" aria-modal="false"
         aria-label="Mais ferramentas" onKeyDown=${teclas}>
      <div class="ferr-pop-h">
        <b id="ferr-pop-tit">Mais ferramentas</b>
        <input ref=${buscaRef} class="ferr-pop-busca" type="search" value=${busca} placeholder="Buscar ferramenta…"
               aria-label="Buscar ferramenta pelo nome" onInput=${(e) => setBusca(e.target.value)} />
        <button class="ferr-x" onClick=${() => onFechar(true)} aria-label="Fechar mais ferramentas">✕</button>
      </div>
      <div class="ferr-pop-corpo">
        ${!nAchados && html`<p class="ferr-vazio">Nada com «${busca}».</p>`}
        ${grupos.map(([cat, rot, itens]) => html`
          <section key=${cat} class="ferr-pop-sec" aria-label=${rot}>
            <h3>${rot}</h3>
            <ul class="ferr-pop-grade" role="list">
              ${itens.map((c) => {
                const fix = barra.includes(c.id);
                const des = desativado(c.id);
                return html`
                  <li key=${c.id} class="ferr-pop-i ${ativo(c.id) ? 'on' : ''}">
                    <button class="ferr-pop-b" data-id=${c.id} disabled=${des} aria-pressed=${ativo(c.id) ? 'true' : 'false'}
                            onClick=${() => escolher(c.id)} title=${c.desc}>
                      <span class="ferr-pop-ic">${icone(c.id)}</span>
                      <span class="ferr-pop-t"><span class="ferr-pop-n">${curto(c.nome)}</span><small>${c.desc}</small></span>
                      ${c.tecla && html`<kbd>${c.tecla}</kbd>`}
                    </button>
                    <button class="ferr-pop-pin ${fix ? 'on' : ''}" aria-pressed=${fix ? 'true' : 'false'}
                            title=${fix ? 'Tirar da barra' : 'Fixar na barra'} aria-label=${(fix ? 'Tirar da barra: ' : 'Fixar na barra: ') + c.nome}
                            onClick=${() => fixar(c.id)}>${PIN}</button>
                  </li>`;
              })}
            </ul>
          </section>`)}
      </div>
      <div class="ferr-pop-f">
        <div class="ferr-pop-ft"><b>Na barra</b> <span>arraste para ordenar · Alt+←/→ no teclado · ✕ tira</span>
          <button class="btn tiny" onClick=${() => setBarra(BARRA_PADRAO.slice())} title="Volta à barra de fábrica">Restaurar</button></div>
        <ol class="ferr-pop-ord" aria-label="Ordem da barra">
          ${barra.map((id) => { const c = porId(id); return c && html`
            <li key=${id} class="ferr-pop-chip ${arrastando === id ? 'arr' : ''}" draggable="true" tabindex="0"
                aria-label=${c.nome + ' — Alt+setas para mover'} title=${c.nome}
                onDragStart=${(e) => { setArrastando(id); try { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; } catch (_) { /* segue */ } }}
                onDragOver=${(e) => { e.preventDefault(); }}
                onDrop=${(e) => { e.preventDefault(); soltarEm(id); setArrastando(null); }}
                onDragEnd=${() => setArrastando(null)}
                onKeyDown=${(e) => {
                  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) { e.preventDefault(); e.stopPropagation(); mover(id, -1); requestAnimationFrame(() => { const el = ref.current && ref.current.querySelector(`.ferr-pop-chip[data-id="${id}"]`); if (el) el.focus(); }); }
                  else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); mover(id, 1); requestAnimationFrame(() => { const el = ref.current && ref.current.querySelector(`.ferr-pop-chip[data-id="${id}"]`); if (el) el.focus(); }); }
                  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); fixar(id); }
                }}
                data-id=${id}>
              <span class="ferr-pop-ic">${icone(id)}</span>
              <button class="ferr-pop-chip-x" tabindex="-1" aria-label=${'Tirar da barra: ' + c.nome} onClick=${() => fixar(id)}>✕</button>
            </li>`; })}
        </ol>
      </div>
    </div>`;
}

// ------------------------------------------------------------- ícones novos

const svg = (d, extra = null) => html`
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} />${extra}</svg>`;

const PIN = svg('M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6');

export const ICONES = {
  polilinha: svg('M3 18l5-9 5 6 4-9 4 4'),
  seta: svg('M5 19L19 5M19 5h-8M19 5v8'),
  circulo3: svg('M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z', html`<circle cx="12" cy="4" r="1.6" fill="currentColor" /><circle cx="5.1" cy="16" r="1.6" fill="currentColor" /><circle cx="18.9" cy="16" r="1.6" fill="currentColor" />`),
  pincel: svg('M18.5 3.5l2 2-9 9-2-2zM9.5 12.5c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2.5 2.5 1 1.5 3 2 4.5 2 2.5 0 4-1.8 4-4z'),
  borrachaMascara: svg('M15 4l5 5-9 9H6l-3-3zM9 10l5 5M15 20h.01M18 20h.01M21 20h.01'),
  pontosChave: svg('M12 3.5a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zM12 8v6M7 11l5-2 5 2M8.5 21l3.5-7 3.5 7'),
  varinha: svg('M4 20l11-11M15 5V3M15 13v-2M19 9h2M11 9h2M18 6l1.5-1.5M18 12l1.5 1.5M12 6l-1.5-1.5'),
  sam: svg('M12 3a9 9 0 1 0 9 9M12 8a4 4 0 1 0 4 4M12 12h.01M18 2v4M16 4h4'),
  medirArea: svg('M4 8l8-5 8 5-3 11H7zM8 12h8M10 15.5h4'),
  perfil: svg('M3 20h18M3 20V4M6 15l3-5 3 3 3-7 3 4'),
  histograma: svg('M3 20h18M6 20v-6M10 20V8M14 20v-9M18 20v-4'),
  analise: svg('M3 20h18M6 20v-6M10 20V8M14 20v-9M18 20v-4M16 4l4 4'),
  distancia: svg('M4 6v12M20 6v12M7 12h10M7 12l2.5-2.5M7 12l2.5 2.5M17 12l-2.5-2.5M17 12l-2.5 2.5'),
  contador: svg('M5 10a2 2 0 1 0 0 .01M11 5a2 2 0 1 0 0 .01M10 14a2 2 0 1 0 0 .01M14 18h7M17.5 14.5v7'),
  cronometro: svg('M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M10 2h4M12 2v3'),
  trajetoria: svg('M3 19c4 0 4-8 8-8s4-6 7-6', html`<circle cx="19" cy="5" r="2.2" fill="currentColor" /><circle cx="3" cy="19" r="1.2" fill="currentColor" />`),
  perspectiva: svg('M6 5h12l4 14H2zM10 5L8 19M14 5l2 14M3.7 12h16.6'),
  encaixe: svg('M6 4v7a6 6 0 0 0 12 0V4h-4v7a2 2 0 0 1-4 0V4zM6 8h4M14 8h4'),
  grade: svg('M4 4h16v16H4zM9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16'),
  lupa: svg('M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L21 21M8 10.5h5M10.5 8v5'),
  mira: svg('M12 3v6M12 15v6M3 12h6M15 12h6', html`<circle cx="12" cy="12" r="1.3" fill="currentColor" />`),
  reguas: svg('M3 3h18v4H3zM3 7v14h4V7M7 5v2M11 5v2M15 5v2M19 5v2M5 11h2M5 15h2M5 19h2'),
  travar: svg('M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3'),
  agrupar: svg('M4 4h7v7H4zM13 13h7v7h-7zM4 15v5h5M20 9V4h-5'),
  alEsq: svg('M4 3v18M8 7h10v4H8zM8 14h6v4H8z'),
  alCx: svg('M12 3v18M6 7h12v4H6zM8 14h8v4H8z'),
  alDir: svg('M20 3v18M6 7h10v4H6zM10 14h6v4h-6z'),
  alTopo: svg('M3 4h18M7 8h4v10H7zM14 8h4v6h-4z'),
  alCy: svg('M3 12h18M7 6h4v12H7zM14 8h4v8h-4z'),
  alBase: svg('M3 20h18M7 6h4v10H7zM14 10h4v6h-4z'),
  distH: svg('M4 3v18M20 3v18M9 8h6v8H9z'),
  distV: svg('M3 4h18M3 20h18M8 9h8v6H8z'),
  mais: svg('M5 12h.01M12 12h.01M19 12h.01', null),
};
