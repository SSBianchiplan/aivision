/**
 * components/studio/FonteStudio.js — o seletor de FONTE dos Studios.
 *
 * ============================ COMO USAR (API) ============================
 *
 *   import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
 *
 *   // 1. na barra do Studio (classeBotao = a classe de botão do seu Studio):
 *   <${FonteStudio} classeBotao="oee-btn" />
 *
 *   // 2. no Esc do Studio (keydown em window, fase de captura), ANTES de fechar:
 *   if (e.key === 'Escape' && fonteStudioAberta()) return;   // o popover trata o Esc
 *
 *   Props (todas opcionais):
 *     classeBotao  classe extra do botão, para herdar o visual da barra
 *     rotulo       texto fixo no botão (padrão: nome da fonte atual)
 *     semTexto     só ícone + bolinha de estado (barras apertadas)
 *
 *   Mais nada: as ações (trocar câmera, arquivo, tela, YouTube) vêm do
 *   workspace por camera/fonte-app.js — o Studio não recebe prop de fonte.
 *   CSS próprio (css/fonte-studio.css), injetado por este módulo.
 * ========================================================================
 *
 * O botão mostra a fonte atual com uma bolinha (verde = entrando imagem,
 * cinza = parada, vermelha = erro/desconectada). O popover tem:
 *   - Câmeras: a lista (rótulo, tipo, «em uso», resolução e fps entregues),
 *     troca com UM clique sem fechar o Studio — a troca é a quente
 *     (camera/device.js): o pipeline, os operadores e os gráficos seguem;
 *     resolução e fps pedidos, com o que a câmera entregou de fato; no
 *     celular, Traseira/Frontal; «Mais opções» abre o seletor completo
 *     (prévia, Wi-Fi/IP, Bluetooth — components/SeletorCamera.js);
 *   - Arquivo, YouTube (colar link → abrir → analisar) e Tela;
 *   - o aviso de erro do app (permissão negada, câmera em uso, desconectada),
 *     que antes ficava atrás da tela cheia.
 *
 * Lógica de câmera: camera/seletor.js (a mesma do painel Fonte e do Treinar).
 */

import { html, ReactDOM, useState, useEffect, useRef, useLayoutEffect } from '../../vendor.js';
import { store, useStore, persist } from '../../state/store.js';
import * as sel from '../../camera/seletor.js';
import { RESOLUTIONS, FPS_OPCOES, fpsPreferido, definirFps, cameraAtual } from '../../camera/device.js';
import { disponivel as telaDisponivel } from '../../camera/screen.js';
import { suporte as suporteYt, extrairId } from '../../camera/youtube.js';
import { acoesFonte, estadoFonte, ouvirFonte, usarCamera, cameraPerdida } from '../../camera/fonte-app.js';
import { SeletorCamera } from '../SeletorCamera.js';

/* folha de estilo própria, injetada uma vez (mesmo ?v= do app.css) */
let cssPosto = false;
function injetarCss() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-fst]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/fonte-studio.css' + (v ? '?v=' + v : ''); l.dataset.aivFst = '1';
  document.head.appendChild(l);
}
injetarCss();

let abertos = 0;
/** true enquanto o popover (ou o seletor completo) está aberto: o Esc é dele, não do Studio. */
export function fonteStudioAberta() { return abertos > 0; }

const ICONE = { camera: '📷', arquivo: '🎞', tela: '🖥', youtube: '▶', ip: sel.ICONE_IP, rtmp: '📡', nenhuma: '📷' };

/** Onde o portal entra: dentro do elemento em tela cheia, se houver (senão o popover some). */
const alvoPortal = () => document.fullscreenElement || document.webkitFullscreenElement || document.body;

function posicao(ancora) {
  const W = window.innerWidth, H = window.innerHeight;
  if (W < 640 || !ancora) return null;
  const r = ancora.getBoundingClientRect();
  const larg = Math.min(380, W - 16);
  const left = Math.max(8, Math.min(r.left, W - larg - 8));
  const top = Math.min(r.bottom + 6, H - 200);
  return { left, top, width: larg, maxHeight: H - top - 8 };
}

export function FonteStudio({ classeBotao = '', rotulo = null, semTexto = false }) {
  const s = useStore(store, (st) => ({ k: st.sourceKind, on: st.cameraOn, dev: st.deviceId, devs: st.devices, notice: st.notice, res: st.resolution }));
  const [aberto, setAberto] = useState(false);
  const [cheio, setCheio] = useState(null);     // seletor completo: null | 'lista' | 'ip' | 'bt'
  const [, setV] = useState(0);
  const btn = useRef(null);

  useEffect(() => ouvirFonte(() => setV((n) => n + 1)), []);
  // vivo/parado muda sem evento (quadro chegando): um pulso leve
  useEffect(() => { const t = setInterval(() => setV((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!aberto && !cheio) return undefined;
    abertos++;
    return () => { abertos--; };
  }, [aberto, cheio]);

  const e = estadoFonte();
  const erro = e.erro || Boolean(s.notice && !e.vivo);
  const cor = erro ? 'erro' : e.vivo ? 'vivo' : 'parada';
  const texto = rotulo || (e.tipo === 'camera' ? encurtar(e.rotulo, 22) : e.rotulo);
  const titulo = `Fonte: ${e.rotulo}${e.detalhe ? ' · ' + e.detalhe : ''} — trocar câmera, arquivo, YouTube ou tela`;

  const a = acoesFonte();
  const ipAtivo = e.tipo === 'ip';

  return html`
    <span class="fst">
      <button ref=${btn} class=${`fst-btn ${classeBotao || 'fst-neutro'} ${aberto ? 'on' : ''}`} aria-haspopup="dialog" aria-expanded=${aberto}
              title=${a ? titulo : 'Fonte: o app ainda está abrindo'} aria-label=${titulo} data-estado=${cor} disabled=${!a}
              onClick=${() => { setCheio(null); setAberto(!aberto); }}>
        <i class=${`fst-luz ${cor}`} aria-hidden="true"></i>
        <span aria-hidden="true">${ICONE[e.tipo] || '📷'}</span>
        ${!semTexto && html`<span class="fst-rot">${texto}</span>`}
        <span class="fst-seta" aria-hidden="true">▾</span>
      </button>
      ${aberto && a && html`<${Popover} ancora=${btn} estado=${e} s=${s} onFechar=${() => setAberto(false)}
                          onCheio=${(m) => { setAberto(false); setCheio(m); }} />`}
      ${cheio && a && html`
        <${SeletorCamera} key=${cheio} ancora=${btn} modoInicial=${cheio}
          atualId=${s.dev} cameraLigada=${s.on && s.k === 'camera'}
          onEscolher=${(c) => usarCamera({ id: c.id })} onFacing=${(f) => usarCamera({ facing: f })}
          onConectarIp=${async (cfg) => { try { await a.conectarStream(cfg); return null; } catch (x) { return (x && x.message) || 'Não conectou.'; } }}
          ipAtivo=${ipAtivo} onDesconectarIp=${() => a.desconectarStream()}
          onFechar=${() => setCheio(null)} />`}
    </span>
  `;
}

function encurtar(t, n) { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

// =============================================================== popover

function Popover({ ancora, estado: e, s, onFechar, onCheio }) {
  const [pos, setPos] = useState(() => posicao(ancora && ancora.current));
  const [lista, setLista] = useState({ cameras: [], semPermissao: false, carregando: true });
  const [ocupado, setOcupado] = useState(null);   // id da câmera (ou 'tela', 'yt'…) em andamento
  const [erros, setErros] = useState({});
  const [msg, setMsg] = useState(null);
  const [fps, setFps] = useState(fpsPreferido);
  const [ytLink, setYtLink] = useState('');
  const [, setV] = useState(0);
  const ref = useRef(null);
  const arq = useRef(null);
  const a = acoesFonte();
  const movel = sel.ehAparelhoMovel();
  const yt = a && a.youtube && a.youtube.current;
  const supYt = suporteYt();

  useLayoutEffect(() => {
    const f = () => setPos(posicao(ancora && ancora.current));
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [ancora]);

  const atualizar = async () => { const l = await sel.listarCameras(); setLista({ ...l, carregando: false }); return l; };
  useEffect(() => {
    atualizar();
    const off1 = sel.ouvirMudancas(async () => { const l = await atualizar(); setMsg({ ok: true, t: `Lista atualizada: ${l.cameras.length} câmera(s).` }); });
    const off2 = yt ? yt.ouvir(() => setV((n) => n + 1)) : () => {};
    return () => { off1(); off2(); };
  }, []);

  // Esc e clique fora fecham (o botão que abriu alterna sozinho)
  useEffect(() => {
    const k = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); onFechar(); if (ancora.current) ancora.current.focus(); } };
    const m = (ev) => {
      if (ref.current && ref.current.contains(ev.target)) return;
      if (ancora && ancora.current && ancora.current.contains(ev.target)) return;
      onFechar();
    };
    document.addEventListener('keydown', k, true);
    document.addEventListener('pointerdown', m, true);
    return () => { document.removeEventListener('keydown', k, true); document.removeEventListener('pointerdown', m, true); };
  }, [onFechar, ancora]);

  // foco no primeiro controle ao abrir (teclado)
  useEffect(() => { const b = ref.current && (ref.current.querySelector('.fst-i:not(:disabled)') || ref.current.querySelector('button')); if (b) b.focus({ preventScroll: true }); }, []);

  const camEmUso = s.k === 'camera' && s.on;

  const trocar = async (c) => {
    if (!c.id) return;
    setOcupado(c.id); setMsg(null);
    const erro = await usarCamera({ id: c.id });
    setOcupado(null);
    if (erro) { setErros((x) => ({ ...x, [c.id]: erro })); setMsg({ ok: false, t: erro }); return; }
    setErros((x) => { const y = { ...x }; delete y[c.id]; return y; });
    setMsg({ ok: true, t: `Câmera em uso: ${c.rotulo}${cameraAtual.settings ? ' · ' + sel.textoSettings(cameraAtual.settings) : ''}.` });
    atualizar();
  };
  const facing = async (f) => {
    setOcupado(f); setMsg(null);
    const erro = await usarCamera({ facing: f });
    setOcupado(null);
    setMsg(erro ? { ok: false, t: erro } : { ok: true, t: f === 'environment' ? 'Câmera traseira.' : 'Câmera frontal.' });
  };
  const permitir = async () => {
    setMsg(null);
    try { await sel.pedirPermissao(); await atualizar(); } catch (x) { setMsg({ ok: false, t: x.message }); }
  };
  const mudarRes = async (v) => {
    const [w, h] = v.split('x').map(Number);
    store.set({ resolution: { width: w, height: h } }); persist();
    if (camEmUso) { setOcupado('res'); await a.ligarCamera(s.dev, { width: w, height: h }); setOcupado(null); }
  };
  const mudarFps = async (f) => {
    definirFps(f); setFps(f);
    if (camEmUso) { setOcupado('res'); await a.ligarCamera(s.dev); setOcupado(null); }
  };
  const tela = async () => {
    setOcupado('tela'); setMsg(null);
    await a.ligarTela();
    setOcupado(null);
    if (store.get().sourceKind === 'screen') onFechar(); else setMsg({ ok: false, t: store.get().notice || 'A captura de tela não começou.' });
  };
  const abrirYt = async () => {
    const id = extrairId(ytLink);
    if (!id) { setMsg({ ok: false, t: 'Cole um link do YouTube (youtube.com/watch?v=…, youtu.be/…, Shorts) ou o ID de 11 caracteres.' }); return; }
    setOcupado('yt'); setMsg({ ok: true, t: 'Abrindo o vídeo no player oficial…' });
    try {
      await yt.carregar(id, { aspecto: /\/shorts\//.test(ytLink) ? '9:16' : undefined });
      setMsg({ ok: true, t: yt.erro || 'Vídeo aberto. Agora «Analisar» para mandar ao pipeline.' });
    } catch (x) { setMsg({ ok: false, t: x.message }); }
    setOcupado(null);
  };
  const analisarYt = async () => {
    // getDisplayMedia logo no clique (o Safari exige o gesto)
    setOcupado('yt'); setMsg(null);
    try { await a.ligarYouTube(); onFechar(); }
    catch (x) { setMsg({ ok: false, t: x.message }); }
    setOcupado(null);
  };

  const grupos = movel ? sel.agrupar(lista.cameras.filter((c) => c.tipo !== 'virtual' && c.tipo !== 'ir')) : sel.agrupar(lista.cameras);
  const st = cameraAtual.settings;
  const caps = cameraAtual.caps;
  const pedido = cameraAtual.pedido;
  const diverge = camEmUso && st && pedido && (Math.abs(st.width - pedido.width) > 8 || (st.frameRate && Math.abs(st.frameRate - pedido.fps) > 2));
  const perdida = cameraPerdida();
  const estilo = pos ? { left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px', maxHeight: pos.maxHeight + 'px' } : undefined;

  return ReactDOM.createPortal(html`
    <div class=${`fst-pop ${pos ? '' : 'folha'}`} ref=${ref} style=${estilo} role="dialog" aria-label="Fonte do Studio">
      <div class="fst-cab">
        <b>Fonte</b>
        <span class="fst-estado"><i class=${`fst-luz ${e.erro ? 'erro' : e.vivo ? 'vivo' : 'parada'}`} aria-hidden="true"></i>
          ${e.rotulo}${e.detalhe ? html` <em>${e.detalhe}</em>` : ''}${!e.vivo && e.tipo !== 'nenhuma' ? html` <em>· sem imagem</em>` : ''}</span>
        <button class="btn tiny" onClick=${onFechar} aria-label="Fechar" title="Fechar (Esc)">✕</button>
      </div>

      ${s.notice && html`<div class="fst-aviso" role="alert"><span>${s.notice}</span>
        <button class="btn tiny" onClick=${() => store.set({ notice: null })} aria-label="Dispensar aviso">✕</button></div>`}
      ${perdida && !s.on && html`<div class="fst-aviso">Esperando «${perdida.rotulo || 'a câmera'}» voltar — plugue de novo ou escolha outra abaixo.</div>`}

      <div class="fst-sec">Câmera</div>
      ${movel && html`<div class="fst-facing">
        <button class="btn accent" disabled=${Boolean(ocupado)} onClick=${() => facing('environment')}>📷 Traseira</button>
        <button class="btn" disabled=${Boolean(ocupado)} onClick=${() => facing('user')}>🤳 Frontal</button></div>`}
      ${lista.semPermissao && html`<div class="fst-aviso">O navegador só mostra o nome das câmeras depois da permissão.
        <button class="btn tiny accent" onClick=${permitir}>Permitir câmera</button></div>`}
      ${!lista.carregando && !lista.cameras.length && html`<div class="fst-vazio">Nenhuma câmera encontrada. Plugue uma webcam USB,
        ligue o DroidCam/Camo ou aproxime o iPhone do Mac — a lista atualiza sozinha.</div>`}
      ${!lista.semPermissao && html`<div class="fst-lista" role="listbox" aria-label="Câmeras">
        ${grupos.map((g) => g.itens.map((c) => {
          const em = camEmUso && c.id === s.dev;
          return html`<button key=${c.id || c.rotulo} class=${`fst-i ${em ? 'em' : ''} ${erros[c.id] ? 'erro' : ''}`} role="option" aria-selected=${em}
              disabled=${Boolean(ocupado) || !c.id} onClick=${() => (em ? null : trocar(c))}
              title=${em ? 'Em uso' : 'Usar esta câmera (troca sem parar a análise)'}>
            <span class="fst-ic" aria-hidden="true">${g.icone}</span>
            <span class="fst-n"><b>${c.rotulo}</b>
              <small>${em ? `em uso${st ? ' · ' + sel.textoSettings(st) : ''}` : ocupado === c.id ? 'abrindo…' : g.nome}${c.tipo === 'ir' ? ' · imagem preta fora do Windows Hello' : ''}</small>
              ${erros[c.id] && html`<small class="fst-err">${erros[c.id]}</small>`}</span>
            ${em ? html`<span class="fst-tag">●</span>` : html`<span class="fst-usar">Usar</span>`}
          </button>`;
        }))}
      </div>`}

      <div class="fst-grade">
        <label class="ctl"><span class="ctl-label">Resolução</span>
          <select value=${s.res.width + 'x' + s.res.height} disabled=${ocupado === 'res'} onChange=${(ev) => mudarRes(ev.target.value)}>
            ${RESOLUTIONS.map((r) => {
              const alem = camEmUso && caps && caps.width && caps.width.max && r.width > caps.width.max;
              return html`<option key=${r.label} value=${r.width + 'x' + r.height}>${r.label}${alem ? ' (acima da câmera)' : ''}</option>`;
            })}
          </select></label>
        <label class="ctl"><span class="ctl-label">Quadros/s</span>
          <select value=${String(fps)} disabled=${ocupado === 'res'} onChange=${(ev) => mudarFps(parseInt(ev.target.value, 10))}>
            ${FPS_OPCOES.map((f) => html`<option key=${f} value=${String(f)}>${f} fps</option>`)}
          </select></label>
      </div>
      ${camEmUso && st && st.width && html`<p class=${`fst-dica ${diverge ? 'amb' : ''}`}>Entregue: <b>${sel.textoSettings(st)}</b>${
        diverge ? ` — a câmera não chegou ao pedido (${pedido.width}×${pedido.height} · ${pedido.fps} fps)${caps && caps.width && caps.width.max ? `; máximo dela: ${caps.width.max}×${caps.height.max}` : ''}.` : '.'}</p>`}
      <div class="fst-linha">
        <button class="btn tiny" onClick=${() => onCheio('lista')} title="Prévia ao vivo de cada câmera antes de usar">Prévia…</button>
        <button class="btn tiny" onClick=${() => onCheio('ip')} title="Câmera de segurança / IP pelo MediaMTX">${sel.ICONE_IP} Wi-Fi / IP</button>
        <button class="btn tiny" onClick=${() => onCheio('bt')}>${sel.ICONE_BT} Bluetooth</button>
        <button class="btn tiny" onClick=${async () => { const l = await atualizar(); setMsg({ ok: true, t: `${l.cameras.length} câmera(s) encontrada(s).` }); }}>↻</button>
        ${camEmUso && html`<button class="btn tiny danger" onClick=${() => a.pararCamera()}>Parar</button>`}
      </div>

      <div class="fst-sec">Outras fontes</div>
      <div class="fst-outras">
        <button class=${`btn ${e.tipo === 'arquivo' ? 'accent' : ''}`} onClick=${() => arq.current.click()} title="Imagem ou vídeo do computador / celular">🎞 Arquivo</button>
        ${telaDisponivel() && html`<button class=${`btn ${e.tipo === 'tela' ? 'accent' : ''}`} disabled=${ocupado === 'tela'}
            onClick=${() => (e.tipo === 'tela' ? a.pararTela() : tela())} title="Aba, janela ou monitor">${e.tipo === 'tela' ? '■ Parar tela' : '🖥 Tela'}</button>`}
        ${e.tipo === 'youtube' && html`<button class="btn" onClick=${() => a.pararYouTube()}>■ Parar YouTube</button>`}
      </div>
      <input ref=${arq} type="file" accept="image/*,video/*" hidden
             onChange=${(ev) => { const f = ev.target.files && ev.target.files[0]; ev.target.value = ''; if (f) { a.abrirArquivo(f); onFechar(); } }} />

      ${yt && e.tipo !== 'youtube' && html`
        <div class="fst-yt">
          ${!supYt.captura
            ? html`<p class="fst-dica">${supYt.motivo}</p>`
            : html`
              <div class="fst-linha">
                <input class="txt" placeholder="Link ou ID do YouTube" value=${ytLink} spellcheck="false" autocapitalize="off" inputmode="url"
                       aria-label="Link do vídeo do YouTube"
                       onInput=${(ev) => setYtLink(ev.target.value)} onKeyDown=${(ev) => { if (ev.key === 'Enter') abrirYt(); }} />
                <button class="btn tiny" disabled=${ocupado === 'yt' || !ytLink.trim()} onClick=${abrirYt}>Abrir</button>
              </div>
              ${yt.carregado && html`<button class="btn accent fst-larga" disabled=${ocupado === 'yt'} onClick=${analisarYt}
                  title="Captura o player e manda ao pipeline">▶ Analisar ${yt.titulo ? '«' + encurtar(yt.titulo, 34) + '»' : 'o vídeo do YouTube'}</button>`}
              ${supYt.janela && html`<p class="fst-dica">${supYt.explica}</p>`}
              ${supYt.captura === 'region' && html`<p class="fst-dica amb">Neste Chrome (anterior ao 132) a captura recorta a área do player na tela:
                com o Studio por cima ela pegaria o próprio Studio. Atualize o Chrome, ou feche o Studio para analisar o YouTube.</p>`}
              ${yt.erro && html`<p class="fst-err">${yt.erro}</p>`}`}
        </div>`}

      ${msg && html`<div class=${`fst-msg ${msg.ok ? 'ok' : 'no'}`} role="status">${msg.t}</div>`}
      <p class="fst-dica">Trocar de câmera não zera a análise nem os gráficos. Arquivo, tela e YouTube começam uma leitura nova.</p>
    </div>
  `, alvoPortal());
}

export default FonteStudio;
