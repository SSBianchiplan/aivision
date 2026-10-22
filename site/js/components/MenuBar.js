/**
 * components/MenuBar.js — a barra de menu flutuante.
 *
 * Arrastável por qualquer ponto que não seja botão, memoriza a posição, e se
 * prende à borda mais próxima ao soltar. Reposiciona-se sozinha no resize.
 *
 * A captura de ponteiro é feita no MESMO elemento que carrega os handlers —
 * capturar num ancestral faz o pointerup nunca chegar, e a barra fica grudada
 * no cursor. Mesmo cuidado do Panel.js.
 *
 * ========================== ORGANIZAÇÃO DA BARRA ==========================
 *
 * A barra tinha 22 controles numa fila só, na ordem em que foram nascendo.
 * Agora ela tem só o que se usa COM O VÍDEO RODANDO, em grupos que leem da
 * esquerda para a direita como o caminho do dado:
 *
 *   [⏸ Rodando] | Núcleo   — de onde vem o vídeo e o que roda nele
 *                            (Fonte, Pipeline, Módulos, Modelos)
 *               | Domínios — os hubs de aplicação (Coisas, Esportes,
 *                            Bike Fit, e Industrial quando existir)
 *               | Análise  — o que se lê do resultado (Telemetria,
 *                            Contexto, Códigos, Legendas)
 *               | Player, Ferramentas de mouse, +Projeto e Via (widgets e
 *                 assistente sobre o vídeo; o +Projeto cria um modelo novo a
 *                 partir das marcações — components/ProjetoPanel.js)
 *               | fps · avatar
 *
 * O que é da SESSÃO e não do vídeo — configurar, contas, exportar, treinar,
 * e as ações de uso raro com atalho de teclado (comparar, capturar,
 * organizar), mais o tema e o sair — mora no menu do avatar. São coisas que
 * se fazem de vez em quando; na barra, competiam por espaço com o que se
 * usa o tempo todo.
 * ==========================================================================
 */

import { html, useState, useEffect, useRef, useCallback, useLayoutEffect } from '../vendor.js';
import { useStore, store, persist } from '../state/store.js';
import { useNarrow } from '../state/breakpoint.js';
import { OPERATOR_COUNT } from '../cv/registry.js';

const POS_KEY = 'gplansis.menubar.pos';

/*
 * A largura de corte mora em state/breakpoint.js. Abaixo dela (ou quando a
 * barra medida não cabe nem sem rótulos) vira hambúrguer: rolagem horizontal
 * num celular esconde metade das funções atrás de um gesto que ninguém
 * descobre.
 */
const THEME_KEY = 'gplansis.theme';

/**
 * Tema: escuro (iaVision), claro ou Code Dark.
 *
 * O padrão é ESCURO e não "o do sistema": o palco desta aplicação é vídeo, e
 * fundo claro em volta de imagem falseia o contraste percebido — o mesmo
 * frame parece mais escuro do que é. O tema claro existe para quem trabalha
 * sob luz forte, onde a tela escura vira espelho. O Code Dark são os cinzas
 * do Visual Studio Code com o amarelo do iaVision como realce (css/theme.css).
 *
 * A escolha é aplicada em <html data-theme>, e o app.html a lê antes de
 * pintar para não haver flash de tema errado no carregamento. O
 * `color-scheme` (barras de rolagem e controles nativos) do code é 'dark'.
 */
export const TEMAS = [
  { id: 'dark', nome: 'Escuro', sub: 'iaVision', titulo: 'Escuro (iaVision) — o padrão: verde-petróleo e amarelo' },
  { id: 'light', nome: 'Claro', sub: 'iaVision', titulo: 'Claro — para luz forte, onde a tela escura vira espelho' },
  { id: 'code', nome: 'Code Dark', sub: 'iaVision', titulo: 'Code Dark — os cinzas do Visual Studio Code com o amarelo do iaVision' },
];
const temaValido = (t) => (TEMAS.some((x) => x.id === t) ? t : 'dark');
function useTheme() {
  const [theme, setTheme] = useState(() => {
    try { return temaValido(localStorage.getItem(THEME_KEY)); } catch (_) { return 'dark'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
    // cor da barra do navegador/PWA: a barra de título do VS Code no code, o verde da marca nos outros
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'code' ? '#181818' : '#04413C');
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* segue sem persistir */ }
  }, [theme]);
  // o menu da tela (layout/menu-tela.js: clique direito → Tema ▸) escolhe por aqui — uma lógica só
  useEffect(() => {
    const f = (e) => { if (e.detail) setTheme(temaValido(e.detail)); };
    window.addEventListener('aiv:tema', f);
    return () => window.removeEventListener('aiv:tema', f);
  }, []);
  return [theme, (t) => setTheme(temaValido(t))];
}

/*
 * Hub Industrial (components/industrial/IndustrialPanel.js, `case
 * 'industrial'` em workspace.js): ocupa o fim do grupo Domínios, ícone de
 * fábrica, sem atalho — `i` já é o conta-gotas das Ferramentas de mouse.
 * O BeltScan abre de dentro do hub, não tem botão próprio. Se o painel sair
 * do ar, false tira o item da barra e do ☰ sem mexer em mais nada.
 */
const INDUSTRIAL_PRONTO = true;

/**
 * Painéis da barra, em grupos. `tecla` é o atalho de workspace.js — aparece
 * no tooltip; mudar lá exige mudar aqui.
 */
const GRUPOS = [
  { id: 'nucleo', rotulo: 'Núcleo', itens: [
    { id: 'camera',   icon: 'cam',    label: 'Fonte',    tecla: 'f' },
    { id: 'pipeline', icon: 'chain',  label: 'Pipeline', tecla: 'p' },
    { id: 'modules',  icon: 'grid',   label: 'Módulos',  tecla: 'm' },
    { id: 'models',   icon: 'chip',   label: 'Modelos',  tecla: 'd' },
  ] },
  { id: 'dominios', rotulo: 'Domínios', itens: [
    { id: 'coisas',   icon: 'tag',    label: 'Coisas' },
    { id: 'esportes', icon: 'trofeu', label: 'Esportes' },
    { id: 'bikefit',  icon: 'bike',   label: 'Bike Fit' },
    ...(INDUSTRIAL_PRONTO ? [{ id: 'industrial', icon: 'fabrica', label: 'Industrial' }] : []),
  ] },
  { id: 'analise', rotulo: 'Análise', itens: [
    { id: 'stats',    icon: 'pulse',  label: 'Telemetria', tecla: 't' },
    { id: 'context',  icon: 'brain',  label: 'Contexto',   tecla: 'x' },
    { id: 'codes',    icon: 'qr',     label: 'Códigos',    tecla: 'q' },
    { id: 'captions', icon: 'mic',    label: 'Legendas',   tecla: 'l' },
  ] },
];

/** Painéis que moram no menu do avatar (não na barra nem no hambúrguer). */
const CONTA = [
  { id: 'config', icon: 'gear', label: 'Configurações', tecla: 'g' },
  { id: 'auth',   icon: 'lock', label: 'Acesso',        tecla: 'a' },
  { id: 'export', icon: 'down', label: 'Exportar',      tecla: 'e' },
  { id: 'train',  icon: 'alvo', label: 'Treinar',       href: '/treino/' },
];

const comTecla = (b) => (b.tecla ? `${b.label} (${b.tecla})` : b.label);

/** Iniciais para o avatar: «Stéfano Bianchi» → SB; só e-mail → a primeira letra. */
function iniciais(u) {
  const partes = String(u.nome || u.email || '?').trim().split(/[\s@._-]+/).filter(Boolean);
  if (!partes.length) return '?';
  const a = partes[0][0], b = partes.length > 1 && u.nome ? partes[partes.length - 1][0] : '';
  return (a + b).toUpperCase();
}

/*
 * Navegação de teclado num menu (padrão WAI-ARIA "menu button"): setas
 * percorrem os itens, Home/End vão às pontas, Esc fecha e devolve o foco ao
 * botão que abriu, Tab fecha e segue. O stopPropagation impede que a seta e
 * o espaço cheguem ao atalho global do workspace (que pausaria o vídeo ou
 * andaria um frame).
 */
function teclaNoMenu(e, fechar) {
  const its = [...e.currentTarget.querySelectorAll('[role^="menuitem"]:not([disabled])')];
  if (!its.length) return;
  const i = its.indexOf(document.activeElement);
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowRight') its[(i + 1) % its.length].focus();
  else if (k === 'ArrowUp' || k === 'ArrowLeft') its[(i - 1 + its.length) % its.length].focus();
  else if (k === 'Home') its[0].focus();
  else if (k === 'End') its[its.length - 1].focus();
  else if (k === 'Escape') fechar(true);
  else if (k === 'Tab') { fechar(false); return; }
  else if (k === ' ' || k === 'Enter') { if (i >= 0) its[i].click(); }
  else return;
  e.preventDefault();
  e.stopPropagation();
}

/*
 * fps da barra num componente PRÓPRIO: o store publica fps 4×/s e, com ele no
 * seletor da MenuBar, a barra inteira re-renderizava 4×/s — e cada render roda
 * o useLayoutEffect que mede a barra (getBoundingClientRect + scrollWidth =
 * layout forçado). Agora só este número muda.
 */
function MedidorFps({ unidade = false }) {
  const fps = useStore(store, (st) => st.fps);
  return html`
    <div class="mb-fps ${fps && fps < 15 ? 'warn' : ''}" title="Frames por segundo">
      <b>${fps || '—'}</b>${unidade ? html`<em>fps</em>` : null}
    </div>`;
}

export function MenuBar({ onSnapshot, onToggleRun, onToggleCompare, onTidy, onLogout, session }) {
  const s = useStore(store, (st) => ({
    panels: st.panels,
    running: st.running,
    compare: st.compare,
    nodeCount: st.nodes.filter((n) => n.enabled).length,
    floatingCount: Object.keys(st.floating || {}).length,
    ferramentas: st.ferramentas !== false,
    player: st.player !== false,
  }));
  // widget de Ferramentas de mouse (marcação de área, linha, régua… sobre o vídeo)
  const toggleFerramentas = () => { store.set((st) => ({ ferramentas: st.ferramentas === false })); persist(); };
  // widget Player (VideoControls: ⏮▶⏸⏹⟲⏭, zoom, mic, gravar, linha do tempo) — mesmo esquema, atalho ⇧B
  const togglePlayer = () => { store.set((st) => ({ player: st.player === false })); persist(); };
  const TIT_PLAYER = 'Player — controles de vídeo: tocar/pausar, zoom, gravar, linha do tempo (⇧B)';
  const TIT_PROJETO = '+Projeto — criar um modelo novo: prints, marcações com classes, treinar e usar no Pipeline';

  const barRef = useRef(null);
  const avatarRef = useRef(null);
  const contaRef = useRef(null);
  const burgerRef = useRef(null);
  const burgerPopRef = useRef(null);
  const [pos, setPos] = useState(() => loadPos());
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);     // hambúrguer
  const [contaOpen, setContaOpen] = useState(false);   // menu do avatar
  const [contaLado, setContaLado] = useState('');      // 'acima' / 'esq' conforme onde a barra está
  /*
   * Encaixe medido, não chutado: cada botão novo empurrava a barra para fora
   * da tela entre os breakpoints fixos. Agora a barra se mede depois de
   * pintar e, se não couber, sobe um degrau:
   *   1 esconde os rótulos de Análise e Ferramentas/Via · 2 esconde todos os
   *   rótulos · 3 esconde o "ops" e aperta os separadores · 4 vira hambúrguer.
   * Redimensionar a janela volta ao degrau 0 e mede de novo.
   */
  const [fit, setFit] = useState(0);
  const narrow = useNarrow() || fit >= 4;
  const [theme, escolherTema] = useTheme();
  const drag = useRef(null);

  // fecha os menus; `foco` devolve o foco a quem abriu (Esc pelo teclado)
  const fecharConta = useCallback((foco) => {
    setContaOpen(false);
    if (foco && avatarRef.current) avatarRef.current.focus();
  }, []);
  const fecharMenu = useCallback((foco) => {
    setMenuOpen(false);
    if (foco && burgerRef.current) burgerRef.current.focus();
  }, []);

  // fecha o popover ao tocar fora ou apertar Esc (com o foco fora do menu)
  useEffect(() => {
    if (!menuOpen && !contaOpen) return;
    const away = (e) => {
      if (e.target.closest('.mb-pop, .mb-burger, .mb-avatar')) return;
      setMenuOpen(false); setContaOpen(false);
    };
    const esc = (e) => { if (e.key === 'Escape') { setMenuOpen(false); setContaOpen(false); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuOpen, contaOpen]);

  // ao abrir, o foco vai para o primeiro item (setas seguem dali)
  useEffect(() => {
    const el = contaOpen ? contaRef.current : menuOpen ? burgerPopRef.current : null;
    if (!el) return;
    const primeiro = el.querySelector('[role^="menuitem"]:not([disabled])');
    if (primeiro) primeiro.focus({ preventScroll: true });
  }, [contaOpen, menuOpen]);

  useEffect(() => {
    const reset = () => setFit(0);
    window.addEventListener('resize', reset);
    window.addEventListener('orientationchange', reset);
    return () => { window.removeEventListener('resize', reset); window.removeEventListener('orientationchange', reset); };
  }, []);

  useLayoutEffect(() => {
    // com o menu do avatar aberto o popover faz parte da caixa da barra; mede-se fechado
    if (narrow || contaOpen) return;
    const el = barRef.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    if (w > window.innerWidth - 16 || el.scrollWidth > el.clientWidth + 1) setFit((f) => Math.min(4, f + 1));
  });

  /*
   * Sem posição salva, a barra nasce centralizada no topo. Antes o -1 de
   * "ainda não medi" ia direto para o style (left: -1px, barra colada e
   * cortada na borda) até o primeiro resize. Recentraliza também quando o
   * encaixe muda a largura — enquanto ninguém a arrastou.
   */
  useLayoutEffect(() => {
    if (narrow) return;
    let salva = null;
    try { salva = localStorage.getItem(POS_KEY); } catch (_) { /* storage bloqueado */ }
    if (salva) return;
    const c = clampPos({ x: -1, y: -1 }, barRef.current);
    setPos((p) => (p.x === c.x && p.y === c.y ? p : c));
  }, [fit, narrow, collapsed]);

  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, barRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /*
   * =============== POR QUE A BARRA MEDE A SI MESMA ===============
   *
   * As colunas de painéis começavam num número fixo — 76px no computador,
   * 68px no celular. Num iPhone com Dynamic Island a barra desce
   * env(safe-area-inset-top) ≈ 59px e termina perto de 103px: o painel
   * abria 35px POR BAIXO dela, que foi o defeito relatado.
   *
   * Não existe constante certa. A altura da barra muda com o recorte do
   * aparelho, com a rotação da tela, com o tema e com o tamanho de fonte
   * do sistema — e no computador a barra ainda pode ser arrastada. Então
   * ela mede a própria base e publica em --rail-top; o CSS lê de lá.
   *
   * Barra arrastada para a metade de baixo não empurra nada: aí ela não
   * está mais no caminho das colunas, e forçá-las para baixo desperdiçaria
   * a tela inteira.
   * ===============================================================
   */
  const publicarBase = useCallback(() => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.height) return;
    const topo = r.top < window.innerHeight / 2 ? Math.round(r.bottom + 10) : 76;
    document.documentElement.style.setProperty('--rail-top', topo + 'px');
    // os paineis flutuantes reclampam a posicao (Panel.js escuta)
    window.dispatchEvent(new CustomEvent('railtop', { detail: topo }));
  }, []);

  useEffect(() => {
    publicarBase();
    const el = barRef.current;
    let ro = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(publicarBase);
      ro.observe(el);
    }
    window.addEventListener('resize', publicarBase);
    window.addEventListener('orientationchange', publicarBase);
    // iPhone: a barra de endereço recolhe/expande sem disparar resize na janela
    const vv = window.visualViewport;
    if (vv) { vv.addEventListener('resize', publicarBase); vv.addEventListener('scroll', publicarBase); }
    // e mede de novo depois que as fontes e o safe-area assentam
    const t1 = setTimeout(publicarBase, 300), t2 = setTimeout(publicarBase, 1500);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', publicarBase);
      window.removeEventListener('orientationchange', publicarBase);
      if (vv) { vv.removeEventListener('resize', publicarBase); vv.removeEventListener('scroll', publicarBase); }
      clearTimeout(t1); clearTimeout(t2);
    };
  }, [publicarBase, narrow]);

  // arrastar move a barra: a base muda a cada quadro do arrasto
  useEffect(() => { publicarBase(); }, [publicarBase, pos.x, pos.y, collapsed]);

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    setPos((p) => {
      const snapped = snapToEdge(p, barRef.current);
      savePos(snapped);
      return snapped;
    });
  }, []);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    // botões e o interior dos menus não arrastam a barra
    if (e.target.closest('button, a, .mb-pop')) return;
    const el = barRef.current;
    const rect = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* fallback global */ }
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!drag.current) return;
    setPos(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, barRef.current));
  }, []);

  const onPointerUp = useCallback((e) => {
    if (!drag.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    endDrag();
  }, [endDrag]);

  // rede de segurança: evento perdido não pode deixar a barra presa
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

  const toggle = (id) => {
    store.set((st) => ({ panels: { ...st.panels, [id]: !st.panels[id] } }));
    persist();
  };

  const toggleAnd = (id) => { toggle(id); setMenuOpen(false); };

  /*
   * Quem está conectado vira um avatar no fim da barra.
   *
   * Não é enfeite: o sistema tem papéis com poderes bem diferentes — um
   * leitor não escreve pipeline, um operador não gerencia contas — e a
   * pergunta «por que este botão não funciona para mim?» quase sempre se
   * responde com «você entrou com a outra conta». As iniciais ficam sempre à
   * vista (inclusive no celular, onde o nome não cabia); nome, e-mail e
   * papel estão no tooltip e no topo do menu, ao lado do Sair.
   */
  const u = (session && session.user) || null;
  const papelRotulo = u ? (u.papel_rotulo || u.papel || '') : '';
  const foto = u && (u.foto || u.foto_url || u.avatar || u.avatar_url || u.picture);
  const contaAtiva = CONTA.some((b) => s.panels[b.id]) || s.compare;

  const abrirConta = () => {
    setMenuOpen(false);
    setContaOpen((aberto) => {
      if (!aberto) {
        // a barra pode ter sido arrastada para baixo ou para a esquerda: o menu abre para onde houver espaço
        const r = barRef.current ? barRef.current.getBoundingClientRect() : null;
        const lados = [];
        if (r && r.top > window.innerHeight / 2) lados.push('acima');
        if (r && r.right < 320) lados.push('esq');
        setContaLado(lados.join(' '));
      }
      return !aberto;
    });
  };

  const avatar = html`
    <button
      ref=${avatarRef}
      class="mb-avatar ${contaOpen ? 'aberto' : ''} ${contaAtiva ? 'on' : ''}"
      onClick=${abrirConta}
      aria-haspopup="menu"
      aria-expanded=${contaOpen}
      aria-controls="mb-conta"
      aria-label=${u ? `Conta de ${u.nome || u.email} — abrir menu` : 'Abrir menu da conta'}
      title=${u ? [u.nome || u.email, papelRotulo].filter(Boolean).join(' · ') : 'Conta'}
    >
      ${foto
        ? html`<img src=${foto} alt="" referrerpolicy="no-referrer" />`
        : html`<span>${u ? iniciais(u) : '?'}</span>`}
      ${contaAtiva && html`<i class="mb-avatar-dot" aria-hidden="true"></i>`}
    </button>
  `;

  const fechaE = (fn) => () => { setContaOpen(false); fn(); };

  // um item do menu: ícone, rótulo, estado e atalho à direita
  const mi = ({ k, ic, label, tecla, on, check, onClick, cls = '', disabled, title, externo }) => html`
    <button key=${k} type="button" tabindex="-1"
            class="mb-mi ${on ? 'on' : ''} ${cls}"
            role=${check ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked=${check ? !!on : undefined}
            disabled=${disabled} title=${title} onClick=${onClick}>
      ${ic}
      <span>${label}</span>
      ${check && on && html`<i class="mb-mi-on" aria-hidden="true"></i>`}
      ${tecla ? html`<kbd>${tecla}</kbd>` : externo ? html`<em aria-hidden="true">↗</em>` : null}
    </button>
  `;

  const contaMenu = contaOpen && html`
    <div id="mb-conta" ref=${contaRef}
         class="mb-pop mb-conta ${contaLado}"
         role="menu" aria-label="Conta e ações"
         onKeyDown=${(e) => teclaNoMenu(e, fecharConta)}>
      ${u && html`
        <div class="mb-conta-quem" role="none">
          <div class="mb-avatar grande" aria-hidden="true">
            ${foto ? html`<img src=${foto} alt="" referrerpolicy="no-referrer" />` : html`<span>${iniciais(u)}</span>`}
          </div>
          <div>
            <b>${u.nome || u.email}</b>
            ${u.nome && u.email && html`<em>${u.email}</em>`}
            ${papelRotulo && html`<small>${papelRotulo}</small>`}
          </div>
        </div>
      `}

      ${CONTA.map((b) => mi({
        k: b.id, ic: icon(b.icon), label: b.label, tecla: b.tecla, externo: !!b.href,
        on: !b.href && s.panels[b.id], check: !b.href,
        title: b.href ? 'Abre o treino de modelos numa aba nova' : undefined,
        onClick: fechaE(() => (b.href ? window.open(b.href, '_blank', 'noopener') : toggle(b.id))),
      }))}

      <div class="mb-mi-sep" role="separator"></div>

      ${mi({ k: 'compare', ic: icon('split'), label: 'Comparar', tecla: 'c', on: s.compare, check: true,
             title: 'Comparar original e processado', onClick: fechaE(onToggleCompare) })}
      ${mi({ k: 'shot', ic: icon('shot'), label: 'Capturar PNG', tecla: 's', onClick: fechaE(onSnapshot) })}
      ${mi({ k: 'tidy', ic: icon('tidy'),
             label: s.floatingCount ? `Organizar painéis (${s.floatingCount} soltos)` : 'Organizar painéis',
             tecla: 'o', cls: s.floatingCount ? 'alert' : '', disabled: !s.floatingCount,
             title: 'Devolver os painéis flutuantes para as colunas', onClick: fechaE(onTidy) })}

      <div class="mb-mi-sep" role="separator"></div>

      <div class="mb-tema" role="group" aria-label="Tema">
        <span class="mb-tema-t" aria-hidden="true">${theme === 'light' ? ICON_SUN : ICON_MOON}Tema</span>
        <div class="mb-tema-seg">
          ${TEMAS.map((t) => html`
            <button key=${t.id} type="button" tabindex="-1" role="menuitemradio"
                    class="mb-tema-op mb-tema-${t.id} ${theme === t.id ? 'on' : ''}"
                    aria-checked=${theme === t.id} aria-label=${`${t.nome} (${t.sub})`}
                    title=${t.titulo} onClick=${() => escolherTema(t.id)}>
              <i class="mb-tema-amostra" aria-hidden="true"></i>
              <b>${t.nome}</b><small>${t.sub}</small>
            </button>
          `)}
        </div>
      </div>
      ${mi({ k: 'sair', ic: icon('sair'), label: 'Sair', cls: 'danger',
             title: 'Sair e encerrar a sessão', onClick: fechaE(onLogout) })}
    </div>
  `;

  const pipelineBadge = (b) => b.id === 'pipeline' && s.nodeCount > 0
    && html`<i class="mb-badge">${s.nodeCount}</i>`;

  /* ---------------------------------------------------------- celular / hambúrguer */
  if (narrow) {
    const ativos = GRUPOS.reduce((n, g) => n + g.itens.filter((b) => s.panels[b.id]).length, 0)
      + (s.panels.via ? 1 : 0) + (s.panels.projeto ? 1 : 0);   // Player e Ferramentas vêm ligados por padrão: não contam
    const pb = (b, extra = {}) => html`
      <button key=${b.id} type="button" tabindex="-1"
              class="mb-pop-b ${(extra.on !== undefined ? extra.on : s.panels[b.id]) ? 'on' : ''}"
              role="menuitemcheckbox"
              aria-checked=${!!(extra.on !== undefined ? extra.on : s.panels[b.id])}
              title=${extra.title || comTecla(b)}
              onClick=${extra.onClick || (() => toggleAnd(b.id))}>
        ${icon(b.icon)}<span>${b.label}</span>${pipelineBadge(b)}
      </button>
    `;
    return html`
      <div ref=${barRef} class="menubar narrow" role="toolbar" aria-label="Barra de ferramentas">
        <div class="mb-brand">
          <strong>GPlanSiS<i>|</i>iaVision</strong>
        </div>

        <button
          class="mb-btn primary ${s.running ? 'on' : ''}"
          onClick=${onToggleRun}
          aria-label=${s.running ? 'Pausar' : 'Retomar'}
        >${icon(s.running ? 'pause' : 'play')}</button>

        <${MedidorFps} />

        <button
          ref=${burgerRef}
          class="mb-burger ${menuOpen ? 'on' : ''}"
          onClick=${() => { setContaOpen(false); setMenuOpen((o) => !o); }}
          aria-haspopup="menu"
          aria-expanded=${menuOpen}
          aria-label="Abrir menu de painéis"
        >
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
               stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          ${ativos > 0 && html`<i class="mb-badge">${ativos}</i>`}
        </button>

        ${avatar}

        ${menuOpen && html`
          <div class="mb-pop" role="menu" aria-label="Painéis" ref=${burgerPopRef}
               onKeyDown=${(e) => teclaNoMenu(e, fecharMenu)}>
            ${GRUPOS.map((g) => html`
              <div key=${g.id} role="group" aria-label=${g.rotulo}>
                <div class="mb-pop-t" aria-hidden="true">${g.rotulo}</div>
                <div class="mb-pop-grid">${g.itens.map((b) => pb(b))}</div>
              </div>
            `)}
            <div role="group" aria-label="Ferramentas">
              <div class="mb-pop-t" aria-hidden="true">Ferramentas</div>
              <div class="mb-pop-grid">
                ${pb({ id: 'player', icon: 'player', label: 'Player' }, {
                  on: s.player, title: TIT_PLAYER,
                  onClick: () => { togglePlayer(); setMenuOpen(false); },
                })}
                ${pb({ id: 'ferramentas', icon: 'mira', label: 'Ferramentas' }, {
                  on: s.ferramentas,
                  title: 'Ferramentas de mouse sobre o vídeo: áreas, linhas de contagem, régua, ROI',
                  onClick: () => { toggleFerramentas(); setMenuOpen(false); },
                })}
                ${pb({ id: 'projeto', icon: 'mais', label: '+Projeto' }, { title: TIT_PROJETO })}
                ${pb({ id: 'via', icon: 'via', label: 'Via', tecla: '⌘/Ctrl+K' })}
                <a class="mb-pop-b" href="/relacoes/" target="_blank" rel="noopener" role="menuitem" tabindex="-1"
                   title="Relações entre objetos (RelateAnything) — grafo de cena de vocabulário aberto, no navegador">
                  ${icon('chain')}<span>Relações</span><em aria-hidden="true">↗</em>
                </a>
              </div>
            </div>
          </div>
        `}
        ${contaMenu}
      </div>
    `;
  }

  /* ---------------------------------------------------------- computador */
  const botao = (b) => html`
    <button
      key=${b.id}
      class="mb-btn ${s.panels[b.id] ? 'on' : ''}"
      onClick=${() => toggle(b.id)}
      title=${comTecla(b)}
      aria-pressed=${!!s.panels[b.id]}
    >
      ${icon(b.icon)}
      <span>${b.label}</span>
      ${pipelineBadge(b)}
    </button>
  `;

  return html`
    <div
      ref=${barRef}
      class="menubar ${dragging ? 'dragging' : ''} ${collapsed ? 'collapsed' : ''} ${fit ? 'fit-' + fit : ''}"
      style=${{ left: pos.x + 'px', top: pos.y + 'px' }}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${onPointerUp}
      onPointerCancel=${onPointerUp}
      role="toolbar"
      aria-label="Barra de ferramentas"
    >
      <div class="mb-grip" title="Arraste para mover"><span></span><span></span><span></span></div>

      <div class="mb-brand">
        <strong>GPlanSiS<i>|</i>iaVision</strong>
        <em>${OPERATOR_COUNT} ops</em>
      </div>

      ${!collapsed && html`
        <div class="mb-sep"></div>

        <button
          class="mb-btn primary ${s.running ? 'on' : ''}"
          onClick=${onToggleRun}
          title=${s.running ? 'Pausar (espaço)' : 'Retomar (espaço)'}
          aria-pressed=${s.running}
        >
          ${icon(s.running ? 'pause' : 'play')}
          <span>${s.running ? 'Rodando' : 'Pausado'}</span>
        </button>

        ${GRUPOS.map((g) => html`
          <div key=${'s-' + g.id} class="mb-sep"></div>
          <div key=${g.id} class="mb-grp mb-grp-${g.id}" role="group" aria-label=${g.rotulo}>
            ${g.itens.map(botao)}
          </div>
        `)}

        <div class="mb-sep"></div>

        <div class="mb-grp mb-grp-assist" role="group" aria-label="Ferramentas">
          <button
            class="mb-btn ${s.player ? 'on' : ''}"
            onClick=${togglePlayer}
            title=${TIT_PLAYER}
            aria-pressed=${s.player}
          >${icon('player')}<span>Player</span></button>
          <button
            class="mb-btn ${s.ferramentas ? 'on' : ''}"
            onClick=${toggleFerramentas}
            title="Ferramentas de mouse sobre o vídeo — área, polígono, ROI, linha de contagem, régua, ângulo, conta-gotas"
            aria-pressed=${s.ferramentas}
          >${icon('mira')}<span>Ferramentas</span></button>
          <button
            class="mb-btn ${s.panels.projeto ? 'on' : ''}"
            onClick=${() => toggle('projeto')}
            title=${TIT_PROJETO}
            aria-pressed=${!!s.panels.projeto}
          >${icon('mais')}<span>+Projeto</span></button>
          ${botao({ id: 'via', icon: 'via', label: 'Via', tecla: '⌘/Ctrl+K' })}
        </div>

        <div class="mb-sep"></div>

        <${MedidorFps} unidade=${true} />
      `}

      ${avatar}

      <button
        class="mb-collapse"
        onClick=${() => setCollapsed((c) => !c)}
        title=${collapsed ? 'Expandir' : 'Recolher'}
        aria-label=${collapsed ? 'Expandir a barra' : 'Recolher a barra'}
      >${collapsed ? '⟩' : '⟨'}</button>

      ${contaMenu}
    </div>
  `;
}

// ------------------------------------------------------------ posição

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* storage bloqueado */ }
  return { x: -1, y: -1 };   // -1 = centraliza no topo no primeiro layout
}

function savePos(p) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (_) { /* ignora */ }
}

function clampPos(p, el) {
  const w = el ? el.offsetWidth : 640;
  const h = el ? el.offsetHeight : 56;
  const m = 8;
  if (p.x < 0 || p.y < 0) {
    // padrão: topo centralizado — deixa as duas colunas laterais livres
    return { x: Math.max(m, (window.innerWidth - w) / 2), y: 14 };
  }
  return {
    x: Math.min(Math.max(m, p.x), Math.max(m, window.innerWidth - w - m)),
    y: Math.min(Math.max(m, p.y), Math.max(m, window.innerHeight - h - m)),
  };
}

function snapToEdge(p, el) {
  const w = el ? el.offsetWidth : 640;
  const h = el ? el.offsetHeight : 56;
  const m = 14, snap = 44;
  const out = { ...p };
  if (p.x < snap) out.x = m;
  if (window.innerWidth - (p.x + w) < snap) out.x = window.innerWidth - w - m;
  if (p.y < snap) out.y = m;
  if (window.innerHeight - (p.y + h) < snap) out.y = window.innerHeight - h - m;
  return clampPos(out, el);
}

// ------------------------------------------------------------ ícones

const ICON_SUN = html`
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>`;

const ICON_MOON = html`
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
  </svg>`;


const PATHS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  tag: 'M3 12V4h8l9 9-8 8-9-9zM7.5 8.5h.01',
  trofeu: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4',
  bike: 'M5.5 17.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM18.5 17.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM5.5 14l4-6h6l3 6M9.5 8L12 14h-6.5M15 5h2.5l1 3M9 5h2',
  chip: 'M7 7h10v10H7zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3',
  chain: 'M9 7H7a5 5 0 000 10h2M15 7h2a5 5 0 010 10h-2M8 12h8',
  cam: 'M4 8h9v8H4zM13 11l6-3v8l-6-3',
  pulse: 'M3 12h4l2-6 3 12 3-8 2 2h4',
  down: 'M12 4v10M8 11l4 4 4-4M5 19h14',
  split: 'M12 4v16M4 6h5v12H4zM15 6h5v12h-5z',
  shot: 'M4 8h4l1-2h6l1 2h4v11H4zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  mira: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M12 9v6M9 12h6',
  tidy: 'M4 5h7v6H4zM13 5h7v14h-7zM4 13h7v6H4z',
  exit: 'M6 6l12 12M18 6L6 18',
  player: 'M3 5.5h18v13H3zM10 9v6l5-3z',
  sair: 'M14 4h5v16h-5M10 8l-4 4 4 4M5.5 12H16',
  alvo: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM12 12.5a.5.5 0 100-1 .5.5 0 000 1z',
  fabrica: 'M3 20V10l5 3V10l5 3V6h3l1-3h2l1 3v14zM7 17h2M12 17h2M17 17h1',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 016 0v3',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-2 5.2A3 3 0 006 17a3 3 0 003 3V4zM15 4a3 3 0 013 3 3 3 0 012 5.2A3 3 0 0118 17a3 3 0 01-3 3V4zM12 4v16',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  mais: 'M12 5v14M5 12h14M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4',
  via: 'M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9zM18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  gear: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H2a2 2 0 110-4h.1A1.6 1.6 0 003.6 8a1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H8a1.6 1.6 0 001-1.5V2a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V8a1.6 1.6 0 001.5 1H22a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
};

const FILLED = new Set(['play', 'pause', 'grid', 'cam']);

export function icon(name) {
  const d = PATHS[name];
  if (!d) return null;
  const filled = FILLED.has(name);
  return html`
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"
         fill=${filled ? 'currentColor' : 'none'}
         stroke=${filled ? 'none' : 'currentColor'}
         stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d=${d} />
    </svg>
  `;
}
