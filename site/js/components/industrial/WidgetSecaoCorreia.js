/**
 * components/industrial/WidgetSecaoCorreia.js — widget flutuante "Seção da
 * correia" (CV-36), por cima do vídeo do app, sem abrir a tela cheia.
 *
 *   Aparece sozinho quando há um nó beltscan.volumetria LIGADO no Pipeline
 *   (o workspace só o monta nesse caso) e some quando não há. Fechado (✕),
 *   fica fechado até o nó ser removido e readicionado (a chave guarda o id do
 *   nó) ou até o botão "Seção da correia" do painel BeltScan reabri-lo.
 *
 *   Mesmo comportamento da barra de vídeo (VideoControls.js) e do widget de
 *   ferramentas (FerramentasMouse.js): punho ••• para arrastar (duplo clique
 *   devolve ao lugar), botão de recolher no canto — recolhido vira uma faixa
 *   fina com seção, vazão, nível e o selo de qualidade/alarme — e canto para
 *   redimensionar (mínimo 260×180). Posição, tamanho e estado ficam no
 *   aparelho (localStorage). Nunca por cima da barra do topo; no celular
 *   (≤ 480 px) abre recolhido e ocupa a largura útil. Arrastar e
 *   redimensionar encaixam na grade invisível e nos vizinhos (layout/grade.js;
 *   Alt/⌥ desliga). Sem posição guardada, procura lugar livre ao lado/acima
 *   das Ferramentas e da barra de vídeo — de novo quando elas se movem.
 *   Recolher/abrir (▾/▸ ao lado do ✕) mantém o canto onde ele está.
 *
 *   O desenho da seção é o MESMO da tela cheia (desenharCorreia, em
 *   beltscan-comum.js): rolos, acamamento DIN 22101, perfil do material,
 *   altura limite com H/HH, excesso em vermelho e a barra LI-101. Os dados
 *   vêm do canal (runtime/livres-k/canal.js), como na StudioBeltScan; o
 *   canvas só é redesenhado quando chega retrato novo (no máximo 4×/s) ou o
 *   tamanho muda — sem rAF contínuo.
 *
 * Gancho de teste: window.aivSecaoCorreia (estado, abrir, recolher…).
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { marcStore } from '../../cv/marcacoes.js';
import { acharLugar, layoutStore } from '../../layout/organizador.js';
import { encaixarMover, encaixarTamanho, limparGuias } from '../../layout/grade.js';
import { editando as editandoNaImagem, concluirEdicao } from '../../cv/runtime/livres-k/beltscan-marcas.js';
import { assinar, instantaneo, obterMotor, recente, studioAberto } from '../../cv/runtime/livres-k/canal.js';
import {
  OP, fmt, COR_Q, corPrio, desenharCorreia, abrirStudioBeltScan, editarNaImagem, CHAVE_SECAO_FECHADO, EVENTO_SECAO,
} from './beltscan-comum.js';

const POS_KEY = 'aiv.beltscan.secao.pos';
const TAM_KEY = 'aiv.beltscan.secao.tam';
const MINI_KEY = 'aiv.beltscan.secao.mini';
const MIN_W = 260, MIN_H = 180, MARGEM = 8;
const CELULAR = 480;

const ler = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const gravar = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* storage bloqueado */ } };
const lerJSON = (k) => { try { return JSON.parse(ler(k) || 'null'); } catch (_) { return null; } };

/** Base da barra do topo (o widget nunca sobe acima dela). */
function baseDaBarra() {
  const bar = document.querySelector('.menubar');
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  return r.height ? Math.round(r.bottom) : 0;
}

/** Tamanho do widget aberto, dentro da janela. */
function limitarTam(t) {
  const W = window.innerWidth, H = window.innerHeight;
  const celular = W <= CELULAR;
  const padrao = celular ? { w: W - 2 * MARGEM, h: 400 } : { w: 400, h: 400 };
  const v = t || padrao;
  const topo = baseDaBarra() + 6;
  return {
    w: Math.round(Math.max(Math.min(MIN_W, W - 2 * MARGEM), Math.min(v.w, W - 2 * MARGEM))),
    h: Math.round(Math.max(Math.min(MIN_H, H - topo - MARGEM), Math.min(v.h, H - topo - MARGEM))),
  };
}

/** Posição padrão: canto inferior esquerdo do palco, depois das colunas da esquerda e do widget de ferramentas. */
function posPadrao(w, h) {
  const W = window.innerWidth;
  if (W <= CELULAR) return { x: MARGEM, y: baseDaBarra() + 8 };
  // lugar livre na área do vídeo, fora das colunas, da barra de vídeo e das Ferramentas (layout/organizador.js)
  return acharLugar(w, h, '.bss', baseDaBarra() + 8);
}

/** Mantém a caixa dentro da janela e abaixo da barra do topo. */
function limitarPos(p, w, h) {
  const W = window.innerWidth, H = window.innerHeight;
  const topo = baseDaBarra() + 6;
  return {
    x: Math.round(Math.min(Math.max(MARGEM, p.x), Math.max(MARGEM, W - w - MARGEM))),
    y: Math.round(Math.min(Math.max(topo, p.y), Math.max(topo, H - h - MARGEM))),
  };
}

export function WidgetSecaoCorreia() {
  // o workspace só monta com o nó ligado; o id distingue "removido e readicionado"
  const noId = useStore(store, (st) => { const n = st.nodes.find((x) => x.op === OP && x.enabled); return n ? n.id : null; });
  const studio = useStore(store, (st) => Boolean(st.studioBeltScan));
  const naImagem = useStore(marcStore, (st) => editandoNaImagem(st));
  const [aviso, setAviso] = useState('');
  const avisoT = useRef(null);
  const avisar = (t) => { setAviso(t); clearTimeout(avisoT.current); avisoT.current = setTimeout(() => setAviso(''), 6000); };
  const motor = obterMotor();

  const [fechadoEm, setFechadoEm] = useState(() => ler(CHAVE_SECAO_FECHADO));
  const [mini, setMiniBruto] = useState(() => {
    const v = ler(MINI_KEY);
    return v == null ? window.innerWidth <= CELULAR : v === '1';
  });
  const [tam, setTam] = useState(() => limitarTam(lerJSON(TAM_KEY)));
  const [pos, setPos] = useState(() => lerJSON(POS_KEY));
  const [r, setR] = useState(() => instantaneo());
  const [vivo, setVivo] = useState(() => recente(3000));
  const [arrastando, setArrastando] = useState(false);
  const caixa = useRef(null);
  const cv = useRef(null);
  const rRef = useRef(r);
  const drag = useRef(null);
  const redim = useRef(null);

  const setMini = useCallback((v) => { setMiniBruto(v); gravar(MINI_KEY, v ? '1' : '0'); }, []);
  const fechado = Boolean(noId) && fechadoEm === noId;
  const visivel = Boolean(noId) && !fechado && !studio;

  // dados: o canal avisa no máximo 4×/s; com a tela cheia por cima, nada a fazer
  useEffect(() => assinar((x) => { if (!studioAberto()) { rRef.current = x; setR(x); setVivo(true); } }), []);
  // "sem imagem" sem rAF: uma checagem leve a cada 1,5 s, só muda o estado quando vira
  useEffect(() => { const t = setInterval(() => setVivo((v) => { const n = recente(3000); return n === v ? v : n; }), 1500); return () => clearInterval(t); }, []);

  // reabrir pelo painel BeltScan
  useEffect(() => {
    const f = () => { setFechadoEm(null); setMini(false); };
    window.addEventListener(EVENTO_SECAO, f);
    return () => window.removeEventListener(EVENTO_SECAO, f);
  }, [setMini]);

  // o nó mudou (removido/readicionado): a chave de fechado de outro nó não vale mais
  useEffect(() => {
    if (noId && fechadoEm && fechadoEm !== noId) { setFechadoEm(null); gravar(CHAVE_SECAO_FECHADO, null); }
  }, [noId]);

  // ---------------------------------------------------------- desenho
  const desenhar = useCallback(() => {
    if (cv.current && cv.current.getBoundingClientRect().width > 0) desenharCorreia(cv.current, rRef.current, motor);
  }, [motor]);
  useEffect(() => { if (visivel && !mini) desenhar(); }, [r, visivel, mini, tam.w, tam.h, motor.alteracoes]);
  // o canvas muda de tamanho com o redimensionar e com o resto do layout (dica, faixa de alarme)
  useEffect(() => {
    if (!visivel || mini || !cv.current || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => desenhar());
    ro.observe(cv.current);
    return () => ro.disconnect();
  }, [visivel, mini, desenhar]);

  // ---------------------------------------------------------- posição
  const medida = () => {
    const el = caixa.current;
    return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: tam.w, h: mini ? 34 : tam.h };
  };
  /*
   * Lugar automático (sem posição guardada) em cache: acharLugar mede TODOS os
   * retângulos ocupados (getComputedStyle + getBoundingClientRect de cada
   * painel) e o widget re-renderiza 4–7×/s com os dados do BeltScan. Só procura
   * de novo quando algo do layout muda: tamanho do widget ou da janela, o plano
   * das colunas (layoutStore), ou um evento de widget movido/organizar/resize.
   */
  const lugarCache = useRef({ chave: '', plano: null, p: null });
  const posReal = () => {
    const { w, h } = medida();
    if (pos) return limitarPos(pos, w, h);
    const lc = lugarCache.current, plano = layoutStore.get();
    const chave = `${w}x${h}|${window.innerWidth}x${window.innerHeight}|${layoutV}|${baseDaBarra()}`;
    if (!lc.p || lc.chave !== chave || lc.plano !== plano) { lc.p = posPadrao(w, h); lc.chave = chave; lc.plano = plano; }
    return limitarPos(lc.p, w, h);
  };
  const [layoutV, setLayoutV] = useState(0);
  // janela mudou, barra do topo mudou de altura, recolheu/abriu: re-encaixa
  useEffect(() => {
    if (!visivel) return undefined;
    const ajustar = () => { setTam((t) => { const n = limitarTam(t); return n.w === t.w && n.h === t.h ? t : n; }); setLayoutV((n) => n + 1); };
    const id = requestAnimationFrame(ajustar);
    addEventListener('resize', ajustar);
    // Ferramentas/barra de vídeo movidas ou colunas replanejadas: procura lugar de novo (no quadro seguinte, já pintado)
    const outro = () => requestAnimationFrame(() => requestAnimationFrame(ajustar));
    addEventListener('aiv:widget-movido', outro);
    addEventListener('aiv:organizar', outro);
    return () => { cancelAnimationFrame(id); removeEventListener('resize', ajustar); removeEventListener('aiv:widget-movido', outro); removeEventListener('aiv:organizar', outro); };
  }, [visivel, mini]);

  const down = (e) => {
    if (e.button !== 0) return;
    const rc = caixa.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - rc.left, dy: e.clientY - rc.top };
    setArrastando(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue */ }
  };
  const move = (e) => {
    if (!drag.current) return;
    const { w, h } = medida();
    const p = encaixarMover({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy, w, h }, { excluir: caixa.current, livre: e.altKey });
    setPos(limitarPos(p, w, h));
  };
  const up = (e) => {
    if (!drag.current) return;
    drag.current = null;
    setArrastando(false);
    limparGuias();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    setPos((p) => { if (p) gravar(POS_KEY, JSON.stringify(p)); return p; });
  };
  const voltarAoLugar = () => { setPos(null); gravar(POS_KEY, null); };
  // «Organizar» (menu do avatar, tecla o) devolve o widget ao lugar automático
  useEffect(() => { addEventListener('aiv:organizar', voltarAoLugar); return () => removeEventListener('aiv:organizar', voltarAoLugar); }, []);

  // ---------------------------------------------------------- redimensionar (canto)
  const rDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    redim.current = { x: e.clientX, y: e.clientY, w: tam.w, h: tam.h };
    setArrastando(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue */ }
  };
  const rMove = (e) => {
    const R = redim.current;
    if (!R) return;
    const p = posReal();
    const W = window.innerWidth, H = window.innerHeight;
    const t = encaixarTamanho({ x: p.x, y: p.y, w: R.w + e.clientX - R.x, h: R.h + e.clientY - R.y }, { excluir: caixa.current, livre: e.altKey });
    setTam({
      w: Math.round(Math.max(MIN_W, Math.min(t.w, W - p.x - MARGEM))),
      h: Math.round(Math.max(MIN_H, Math.min(t.h, H - p.y - MARGEM))),
    });
  };
  const rUp = (e) => {
    if (!redim.current) return;
    redim.current = null;
    setArrastando(false);
    limparGuias();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    // guarda a posição de agora junto: senão a caixa maior "pularia" ao recarregar
    setPos((p) => { const q = p || posReal(); gravar(POS_KEY, JSON.stringify(q)); return q; });
    setTam((t) => { gravar(TAM_KEY, JSON.stringify(t)); return t; });
  };

  const fechar = () => { setFechadoEm(noId); gravar(CHAVE_SECAO_FECHADO, noId); };

  // gancho de teste (CDP)
  useEffect(() => {
    window.aivSecaoCorreia = {
      estado: () => ({ visivel, fechado, mini, tam, pos: posReal(), vivo, q: r ? r.q : null, gate: Boolean(r && r.gate) }),
      recolher: (v = true) => setMini(v), fechar, tamanho: (w, h) => setTam(limitarTam({ w, h })),
      mover: (x, y) => setPos(limitarPos({ x, y }, medida().w, medida().h)),
    };
  });
  useEffect(() => () => { delete window.aivSecaoCorreia; }, []);

  if (!visivel) return null;

  const C = motor.C;
  const q = r ? r.q : 'SEM REF';
  const ativos = C.alarms.filter((a) => motor.alarm[a.tag] && motor.alarm[a.tag].state !== 'NORMAL').sort((x, y) => x.prio - y.prio);
  const gate = Boolean(r && r.gate);
  const alarme = gate || ativos.some((a) => a.prio === 1);
  const semLaser = vivo && q === 'RUIM';
  const p = posReal();
  const estilo = mini ? { left: p.x + 'px', top: p.y + 'px' } : { left: p.x + 'px', top: p.y + 'px', width: tam.w + 'px', height: tam.h + 'px' };
  const seloAlarme = ativos.length
    ? html`<span class="bss-al" style=${{ '--a': corPrio(ativos[0].prio) }} title=${ativos.map((a) => a.tag).join(', ')}>▲ ${ativos[0].tag}${ativos.length > 1 ? ` +${ativos.length - 1}` : ''}</span>`
    : gate ? html`<span class="bss-al" style=${{ '--a': corPrio(1) }}>▲ limite</span>` : null;

  return html`
    <div ref=${caixa} class="bss ${mini ? 'mini' : ''} ${arrastando ? 'dragging' : ''} ${alarme ? 'alarme' : ''}"
         style=${estilo} role="region" aria-label="Seção da correia (BeltScan)">
      <div class="bss-grip" title="Arraste para mover (Alt/⌥: sem encaixe) · duplo clique devolve ao lugar"
           onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}
           onDoubleClick=${voltarAoLugar}><span></span><span></span><span></span></div>
      <button class="bss-min" onClick=${() => { setPos((q) => q || posReal()); setMini(!mini); }} aria-expanded=${!mini}
              title=${mini ? 'Abrir' : 'Recolher'}
              aria-label=${mini ? 'Abrir a seção da correia' : 'Recolher a seção da correia numa faixa fina'}>${mini ? '▸' : '▾'}</button>
      <button class="bss-x" onClick=${fechar} title="Fechar (reabre pelo painel BeltScan)" aria-label="Fechar a seção da correia">✕</button>

      ${mini ? html`
        <div class="bss-faixa" title="Seção da correia · vazão · nível representativo">
          <b>${r ? fmt(r.A, 4) : '—'}</b><em>m²</em>
          <b>${r ? fmt(r.Q, 1) : '—'}</b><em>m³/h</em>
          <b>${r ? fmt(r.lvlRep, 0) : '—'}</b><em>mm</em>
          <span class="bss-q" style=${{ '--q': (vivo && COR_Q[q]) || COR_Q['SEM REF'] }}>${vivo ? q : 'SEM IMAGEM'}</span>
          ${seloAlarme}
        </div>` : html`
        <div class="bss-cab">
          <b class="bss-titulo">Seção da correia</b>
          <small>B ${C.belt.B_mm} · ${C.belt.trough_deg}°</small>
          <span class="bss-q" style=${{ '--q': (vivo && COR_Q[q]) || COR_Q['SEM REF'] }}>${vivo ? q : 'SEM IMAGEM'}</span>
        </div>
        <div class="bss-portao ${gate ? 'acima' : ''}" role="status">${gate
          ? `Acima da altura limite: nível ${fmt(r.lvlRep, 0)} mm, excesso ${fmt(r.exRep, 0)} mm em ${fmt(r.exWidth, 1)} % da largura.`
          : `Abaixo da altura limite (${fmt(C.limit.h_mm, 0)} mm) · nível ${fmt(r ? r.lvlRep : NaN, 0)} mm.`}
          ${ativos.length ? html` <b class="bss-ativos">${ativos.length} ${ativos.length === 1 ? 'alarme' : 'alarmes'}: ${ativos.slice(0, 2).map((a) => `P${a.prio} ${a.tag}`).join(', ')}${ativos.length > 2 ? '…' : ''}</b>` : ''}
        </div>
        <canvas ref=${cv} class="bss-cv" aria-label="Seção da calha com o produto, a altura limite, H/HH, o excesso e a barra LI-101"></canvas>
        <div class="bss-kpis">
          <div><b>${r ? fmt(r.A, 4) : '—'}</b><em>m² seção</em></div>
          <div><b>${r ? fmt(r.Q, 1) : '—'}</b><em>m³/h vazão</em></div>
          <div><b>${r ? fmt(r.mdry, 2) : '—'}</b><em>t/h seca</em></div>
          <div><b>${r ? fmt(r.lvlRep, 0) : '—'}</b><em>mm nível rep.</em></div>
          <div><b style=${{ color: COR_Q[q] }}>${q}</b><em>cob. ${r ? fmt(r.cov * 100, 0) : '—'} %</em></div>
          <div><b>${fmt(C.belt.speed_ms, 2)}</b><em>m/s correia</em></div>
        </div>
        ${!vivo && html`<p class="bss-dica">Aguardando imagem: abra um ensaio no painel BeltScan ou escolha a fonte.</p>`}
        ${semLaser && html`<p class="bss-dica laser">Sem linha de laser detectada — o BeltScan mede pela linha do laser sobre o material. Use um vídeo/câmera com laser (ex.: ensaios Feijão) ou ajuste a faixa de busca.</p>`}
        ${aviso && html`<p class="bss-dica" role="status">${aviso}</p>`}
        <div class="bss-acoes">
          ${naImagem
            ? html`<button class="bss-btn acento" onClick=${() => { concluirEdicao(); avisar('Edição concluída: faixa de busca, exclusões e velocidade aplicadas.'); }}
                title="Concluir a edição na imagem (Enter)">✓ Concluir</button>`
            : html`<button class="bss-btn" onClick=${() => { avisar(editarNaImagem()); if (window.innerWidth <= CELULAR) setMini(true); }}
                title="Faixa de busca, exclusões e faixa de velocidade como marcações sobre o vídeo, com alças">Editar na imagem</button>`}
          <button class="bss-btn ${naImagem ? '' : 'acento'}" onClick=${() => abrirStudioBeltScan()} title="Tela cheia: câmera, seção, perfil, tendência, indicadores e alarmes">Abrir Studio</button>
          <button class="bss-btn" onClick=${() => abrirStudioBeltScan({ configurar: 'Extração' })} title="Tela cheia já em Configurar (faixa de busca, limiar, geometria…)">Configurar</button>
        </div>
        <div class="bss-canto" title="Arraste para redimensionar"
             onPointerDown=${rDown} onPointerMove=${rMove} onPointerUp=${rUp} onPointerCancel=${rUp}></div>`}
    </div>
  `;
}

export default WidgetSecaoCorreia;
