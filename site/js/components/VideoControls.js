/**
 * components/VideoControls.js — controles de vídeo flutuantes.
 *
 * Visual da referência: seis botões circulares de vidro fosco e uma linha
 * do tempo abaixo. Adaptado ao tema do sistema — o mesmo laranja #FFD84D,
 * o mesmo vidro com blur da barra de menu e dos painéis.
 *
 * O QUE OS BOTÕES FAZEM AQUI. Numa fonte ao vivo, "voltar" e "avançar" só
 * fazem sentido se existir histórico — por isso operam sobre o FrameRing
 * (cv/ringbuffer.js), que guarda os últimos segundos. Em arquivo de vídeo,
 * os mesmos botões controlam a reprodução de verdade.
 *
 *   ⏮  volta um frame no buffer (ou -1s no vídeo)
 *   ▶  volta a acompanhar o vivo (ou dá play)
 *   ⏸  congela no frame atual, sem parar a câmera
 *   ⏹  para a fonte
 *   ↻  reinicia: limpa buffer, zera estado temporal dos operadores
 *   ⏭  avança um frame (passar do fim devolve ao vivo)
 */

import { html, useState, useEffect, useRef, useCallback } from '../vendor.js';
import { useStore, store, persist } from '../state/store.js';
import {
  Recorder, melhorFormato, salvar, formatarBytes, formatarTempo,
} from '../cv/recorder.js';
import { obterTrilha, rotuloModo } from '../cv/audio.js';
import { setZoom } from './Viewport.js';
import { QUALIDADES, rotuloReal, suporte as suporteYt } from '../camera/youtube.js';
import { abrirEditorVideo, guardarGravacao } from './video/ponte.js';
import { encaixarMover, limparGuias } from '../layout/grade.js';

const POS_KEY = 'gplansis.videoctl.pos';
const MINI_KEY = 'gplansis.videoctl.mini';   // barra recolhida (vale para o sistema todo, neste aparelho)

/*
 * PADRÃO no rodapé centralizado, em FAIXA FINA (recolhida), acima da linha de
 * atalhos — mas ARRASTÁVEL como os demais widgets, com grade invisível e ímã
 * (layout/grade.js; Alt/⌥ desliga). As colunas de painéis terminam acima
 * dela quando a cruzam (layout/organizador.js trata a barra como reservada).
 *
 * O padrão fixo continua sendo o certo — é onde todo player põe o controle
 * de transporte, e quem nunca mexer nunca precisa procurar. O que muda é
 * que agora dá para tirar dali quando a barra cobre justamente a região da
 * imagem que se quer olhar.
 *
 * Duplo clique no punho devolve ao rodapé: sem essa saída, "perder" a barra
 * num canto vira um estado do qual o usuário não sabe voltar.
 */
export function VideoControls({ ring, source, youtube, onUseYouTube, onStop, onReload, onFlip, displayCanvas }) {
  const s = useStore(store, (st) => ({
    running: st.running,
    cameraOn: st.cameraOn,
    sourceKind: st.sourceKind,
    facing: st.facing,
    hasMultiCam: st.hasMultiCam,
    zoom: st.zoom,
    loop: st.loop !== false,
  }));

  const [, tick] = useState(0);
  const [usando, setUsando] = useState(false);   // «Analisar este vídeo» esperando o diálogo de compartilhar
  const barRef = useRef(null);
  const [pos, setPos] = useState(() => loadPos());
  const [dragging, setDragging] = useState(false);
  const [mini, setMiniBruto] = useState(() => { try { return localStorage.getItem(MINI_KEY) === '1'; } catch (_) { return false; } });
  const setMini = (v) => {
    setMiniBruto(v);
    try { v ? localStorage.setItem(MINI_KEY, '1') : localStorage.removeItem(MINI_KEY); } catch (_) { /* storage bloqueado */ }
  };
  // a barra cresce ao abrir: se ela foi arrastada para perto da borda, traz de volta para dentro da tela
  useEffect(() => {
    const id = requestAnimationFrame(() => setPos((p) => (p ? clampPos(p, barRef.current) : p)));
    return () => cancelAnimationFrame(id);
  }, [mini]);
  const drag = useRef(null);

  /*
   * O buffer muda fora do React; um pulso a 8 Hz mantém a régua honesta. Só
   * re-renderiza quando algo VISÍVEL mudou (posição da régua no passo dela,
   * tempo em segundos, tamanho do buffer…): câmera ao vivo com o buffer cheio
   * ou vídeo pausado deixam de redesenhar a barra inteira 8×/s. Com o player
   * do YouTube aberto (estado lido dele a cada render) o pulso segue sempre.
   */
  useEffect(() => {
    let ant = '';
    const t = setInterval(() => {
      const src = source.current;
      const yp = youtube && youtube.current && youtube.current.carregado;
      if (yp || (src && src.kind === 'youtube')) { tick((n) => n + 1); return; }
      const v = src && src.kind === 'video' ? src.video : null;
      const rr = ring.current;
      const tm = src && src.size;
      const sig = (src ? src.kind : '') + '|' + (tm ? tm.width + 'x' + tm.height : '')
        + '|' + (v ? Math.floor(v.currentTime) + ':' + Math.round((1000 * v.currentTime) / (v.duration || 1)) + ':' + (v.duration || 0) : '')
        + '|' + (rr ? rr.length + ':' + rr.live + ':' + Math.round(rr.ratio * 1000) + ':' + rr.behindSeconds.toFixed(1) + ':' + rr.spanSeconds.toFixed(1) : '');
      if (sig !== ant) { ant = sig; tick((n) => n + 1); }
    }, 125);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampPos(p, barRef.current) : p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---------------------------------------------------------- arrastar

  const endDrag = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    limparGuias();
    setPos((p) => { savePos(p); return p; });
    // o organizador remede as áreas reservadas e reposiciona colunas e widgets
    window.dispatchEvent(new CustomEvent('aiv:widget-movido'));
  }, []);

  const down = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('button, input')) return;
    const r = barRef.current.getBoundingClientRect();
    // ao soltar do rodapé, começa exatamente onde já estava
    setPos({ x: r.left, y: r.top });
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    setDragging(true);
    // captura no MESMO elemento dos handlers: capturar num ancestral faz o
    // pointerup nunca chegar e a barra fica grudada no cursor
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* fallback global */ }
  }, []);

  const move = useCallback((e) => {
    if (!drag.current) return;
    const el = barRef.current;
    const p = encaixarMover({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy,
                              w: el ? el.offsetWidth : 460, h: el ? el.offsetHeight : 60 },
                            { excluir: el, livre: e.altKey });
    setPos(clampPos(p, el));
  }, []);

  const up = useCallback((e) => {
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

  // lugar e forma padrão: faixa fina centrada embaixo (duplo clique no punho, «Organizar»)
  const resetPos = () => { setPos(null); clearPos(); setMini(true); window.dispatchEvent(new CustomEvent('aiv:widget-movido')); };
  // «Organizar» (menu do avatar, tecla o) devolve a barra ao lugar automático: centrada na área livre do vídeo (app.css, --area-cx)
  useEffect(() => { addEventListener('aiv:organizar', resetPos); return () => removeEventListener('aiv:organizar', resetPos); }, []);

  // ---------------------------------------------------------- gravação

  const rec = useRef(null);
  if (!rec.current) rec.current = new Recorder();
  const [gravando, setGravando] = useState(false);
  const [recInfo, setRecInfo] = useState({ s: 0, b: 0 });
  const [recRes, setRecRes] = useState('');
  const fmt = useRef(null);
  if (fmt.current === null) fmt.current = melhorFormato();

  /*
   * Áudio da gravação. A preferência é 'auto' ou 'off' (store.recordAudio);
   * de onde o som vem de fato — microfone ou trilha da fonte — é decidido
   * na hora de gravar, em cv/audio.js, porque depende da fonte ativa.
   */
  const audioPref = useStore(store, (st) => st.recordAudio || 'auto');
  const audio = useRef(null);            // { track, modo, liberar } da gravação corrente
  const [audioModo, setAudioModo] = useState('off');
  const toggleAudio = () => {
    store.set({ recordAudio: audioPref === 'off' ? 'auto' : 'off' });
    persist();
  };

  useEffect(() => {
    rec.current.onTick = (r) => setRecInfo({ s: r.segundos, b: r.bytes });
    return () => { rec.current.cancel(); };
  }, []);

  const toggleRec = async () => {
    const r = rec.current;
    if (r.gravando) {
      try {
        const out = await r.stop();
        guardarGravacao(out);   // o editor (✂) oferece "Editar a última gravação"
        setGravando(false);
        if (audio.current) { audio.current.liberar(); audio.current = null; }
        const onde = await salvar(out);
        store.set({
          notice: onde === 'cancelado'
            ? 'Gravação descartada.'
            : `Vídeo salvo: ${out.nome} · ${formatarTempo(out.segundos)} · ` +
              `${formatarBytes(out.bytes)}` +
              (out.comAudio ? ` · áudio: ${rotuloModo(audioModo)}` : ' · sem áudio') +
              (out.formato.universal ? '' :
                ' — formato WebM: não abre no app Fotos do iPhone nem no QuickTime.') +
              ' · ✂ na barra abre a gravação no editor.',
        });
      } catch (err) {
        setGravando(false);
        if (audio.current) { audio.current.liberar(); audio.current = null; }
        store.set({ notice: 'Falha ao salvar: ' + err.message });
      }
      return;
    }
    const cv = displayCanvas && displayCanvas.current;
    if (!cv || !cv.width) {
      store.set({ notice: 'Sem imagem para gravar. Ligue a câmera antes.' });
      return;
    }
    try {
      /*
       * O áudio é pedido AQUI, dentro do clique: desligar o muted do <video>
       * e abrir o microfone exigem gesto do usuário. Falha de áudio nunca
       * impede a gravação — segue sem som e avisa o motivo.
       */
      const a = await obterTrilha(source.current, audioPref);
      audio.current = a;
      setAudioModo(a.modo);
      r.start(cv, { fps: 30, bitrate: bitrateGravacao(cv.width, cv.height, 30), audioTrack: a.track });
      setRecRes(`${cv.width}×${cv.height}`);
      setGravando(true);
      setRecInfo({ s: 0, b: 0 });
      if (a.motivo) store.set({ notice: 'Gravando sem áudio: ' + a.motivo });
    } catch (err) {
      if (audio.current) { audio.current.liberar(); audio.current = null; }
      store.set({ notice: err.message });
    }
  };

  // ---------------------------------------------------------- ações

  const isFile = s.sourceKind === 'file';
  // captura de tela, YouTube e stream se comportam como câmera: ao vivo, com buffer
  const isScreen = s.sourceKind === 'screen' || s.sourceKind === 'youtube';
  // YouTube: play/pausa também mandam no player oficial (camera/youtube.js)
  const yt = source.current && source.current.kind === 'youtube' ? source.current : null;
  /*
   * Player do YouTube aberto — como FONTE ou só para assistir. Com ele aberto,
   * a barra vira o controle do vídeo: ⏮/⏭ = −10/+10 s, ▶/⏸ tocam e pausam o
   * player, a linha do tempo é a do vídeo, e aparecem velocidade e som.
   */
  const ytp = youtube && youtube.current && youtube.current.carregado ? youtube.current : null;
  const ytEstado = ytp ? ytp._cmd('getPlayerState') : null;   // 1 tocando · 2 pausado · 3 carregando · 0 fim
  const ytTocando = ytEstado === 1 || ytEstado === 3;
  const ytDur = ytp ? ytp.duracao : 0;
  const ytT = ytp ? ytp.tempo : 0;
  const video = source.current && source.current.kind === 'video' ? source.current.video : null;
  const r = ring.current;

  const prev = () => {
    if (ytp) { ytp.avancar(-10); return; }
    if (video) { video.currentTime = Math.max(0, video.currentTime - 1); return; }
    r.step(-1);
    store.set({ running: false });
  };

  const next = () => {
    if (ytp) { ytp.avancar(10); return; }
    if (video) { video.currentTime = Math.min(video.duration || 0, video.currentTime + 1); return; }
    r.step(1);
    if (r.live) store.set({ running: true });
  };

  const play = () => {
    if (ytp && !yt) { ytp.play(); return; }      // só assistindo: não mexe no pipeline
    if (video) video.play().catch(() => {});
    if (yt) yt.play();
    r.resume();
    store.set({ running: true });
  };

  const pause = () => {
    if (ytp && !yt) { ytp.pause(); return; }
    if (video) video.pause();
    if (yt) yt.pause();
    r.pause();
    store.set({ running: false });
  };

  const reload = () => {
    r.clear();
    onReload();
  };

  const live = r.live && s.running;
  const ratio = ytp && ytDur
    ? ytT / ytDur
    : video && video.duration
      ? video.currentTime / video.duration
      : r.ratio;

  const onSeek = (e) => {
    const v = parseFloat(e.target.value);
    if (ytp && ytDur) { ytp.irPara(v * ytDur); return; }
    if (video && video.duration) {
      video.currentTime = v * video.duration;
      return;
    }
    r.seekRatio(v);
    store.set({ running: false });
  };

  const behind = r.behindSeconds;
  /*
   * Resolução REAL da fonte (o que a câmera/arquivo/captura entrega, não o que
   * foi pedido). YouTube só assistindo: o nível que o player informa.
   */
  const tam = source.current && source.current.size;
  const resolucao = ytp && !yt
    ? (ytp.qualidadeReal.nivel || '')
    : tam && tam.width ? `${tam.width}×${tam.height}` + (yt && yt.qualidadeReal.nivel ? ` (${yt.qualidadeReal.nivel})` : '') : '';
  const statusText = ytp
    ? fmtTime(ytT) + ' / ' + fmtTime(ytDur)
    : live
    ? 'AO VIVO'
    : video
      ? fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration || 0)
      : behind > 0.05
        ? `−${behind.toFixed(1)}s`
        : 'PAUSADO';

  return html`
    <div
      ref=${barRef}
      class="vctl ${mini ? 'mini' : ''} ${pos ? 'moved' : ''} ${dragging ? 'dragging' : ''}"
      style=${pos ? { left: pos.x + 'px', top: pos.y + 'px' } : null}
      role="group"
      aria-label="Controles de vídeo"
    >
      <div
        class="vctl-grip"
        onPointerDown=${down}
        onPointerMove=${move}
        onPointerUp=${up}
        onPointerCancel=${up}
        onDoubleClick=${resetPos}
        title="Arraste para mover (Alt/⌥: sem encaixe) · duplo clique volta ao rodapé, em faixa fina"
      ><span></span><span></span><span></span></div>
      <button class="vctl-min" onClick=${() => { setMini(!mini); window.dispatchEvent(new CustomEvent('aiv:widget-movido')); }} aria-expanded=${!mini}
              title=${mini ? 'Abrir' : 'Recolher'}
              aria-label=${mini ? 'Abrir os controles de vídeo' : 'Recolher os controles de vídeo numa faixa fina'}
      >${mini ? '▸' : '▾'}</button>

      <div class="vctl-row">
        <${Btn} icon="prev" title=${ytp ? 'Voltar 10 s' : 'Frame anterior (←)'} onClick=${prev}
                disabled=${!ytp && !isFile && !r.length} />
        <${Btn} icon="play" title=${ytp ? 'Tocar o vídeo' : 'Ao vivo / reproduzir (espaço)'} onClick=${play}
                active=${ytp ? ytTocando : live} />
        <${Btn} icon="pause" title=${ytp ? 'Pausar o vídeo' : 'Congelar frame (espaço)'} onClick=${pause}
                active=${ytp ? !ytTocando : !live && (s.cameraOn || isFile || isScreen)} />
        <${Btn} icon="stop" title=${ytp && !yt ? 'Fechar o player' : 'Parar a fonte'}
                onClick=${ytp && !yt ? () => ytp.fechar() : onStop}
                disabled=${!ytp && !s.cameraOn && !isFile && !isScreen && s.sourceKind !== 'stream'} />
        <${Btn} icon="reload" title="Reiniciar buffer e estado dos operadores" onClick=${reload} />
        <${Btn} icon="next" title=${ytp ? 'Avançar 10 s' : 'Próximo frame (→)'} onClick=${next}
                disabled=${!ytp && !isFile && !r.length} />

        ${(ytp || isFile) && html`
          <button class="vctl-yt vctl-loop ${s.loop ? 'on' : ''}" aria-pressed=${s.loop}
                  title=${s.loop ? 'Repetir: ligado — o vídeo recomeça ao terminar (clique para desligar)' : 'Repetir: desligado (clique para ligar)'}
                  onClick=${() => { store.set({ loop: !s.loop }); persist(); }}>⟲</button>
        `}
        ${ytp && html`
          <button class="vctl-yt" title="Velocidade do vídeo (clique para trocar)"
                  onClick=${() => {
                    const seq = [1, 1.25, 1.5, 2, 0.5, 0.75];
                    const i = seq.indexOf(ytp.taxa);
                    ytp.velocidade(seq[(i + 1) % seq.length]);
                  }}>${String(ytp.taxa).replace('.', ',')}×</button>
          ${suporteYt().captura && suporteYt().captura !== 'janela' && html`
            <select class="vctl-yt vctl-qual" value=${ytp.qualidade} aria-label="Qualidade do vídeo do YouTube"
                    title=${'Qualidade pedida ao YouTube (ele decide; pedimos pelo tamanho do player e da captura)' +
                            (rotuloReal(ytp) ? ' — chegando: ' + rotuloReal(ytp) : '')}
                    onChange=${(e) => ytp.setQualidade(e.target.value)}>
              ${Object.entries(QUALIDADES).map(([k, q]) => html`<option key=${k} value=${k}>${k === 'auto' ? 'Auto' : k === 'max' ? 'Máx' : q.rotulo}</option>`)}
            </select>
          `}
          <button class="vctl-yt" title=${ytp.mudo ? 'Ligar o som' : 'Tirar o som'}
                  aria-pressed=${!ytp.mudo}
                  onClick=${() => ytp.som(ytp.mudo)}>${ytp.mudo ? '🔇' : '🔊'}</button>
        `}

        ${s.hasMultiCam && !isFile && html`
          <${Btn} icon="flip"
                  title=${`Virar câmera (agora: ${s.facing === 'environment' ? 'traseira' : 'frontal'})`}
                  onClick=${onFlip}
                  active=${s.facing === 'environment'} />
        `}

        <div class="vctl-zoom" role="group" aria-label="Zoom da imagem">
          <button class="vctl-yt" title="Reduzir o zoom (−)"
                  onClick=${() => setZoom({ ...s.zoom, z: (s.zoom.z || 1) / 1.25 })}
                  disabled=${!(s.zoom && s.zoom.z > 1)}>−</button>
          <button class="vctl-yt vctl-zval" title="Zoom da imagem — clique volta ao quadro inteiro (0). Arraste a imagem para enquadrar; Ctrl/⌘ + roda ou pinça amplia no ponto."
                  onClick=${() => setZoom({ z: 1 })}>🔍 ${String(Math.round(((s.zoom && s.zoom.z) || 1) * 10) / 10).replace('.', ',')}×</button>
          <button class="vctl-yt" title="Ampliar (+)"
                  onClick=${() => setZoom({ ...s.zoom, z: ((s.zoom && s.zoom.z) || 1) * 1.25 })}
                  disabled=${s.zoom && s.zoom.z >= 8}>+</button>
        </div>

        <button class="vctl-yt vctl-editar" style=${{ marginLeft: '3px' }}
                title=${isFile && video ? 'Editar este vídeo (GPlanSiS|Vídeo): cortar, recortar, exportar' : 'Editor de vídeo (GPlanSiS|Vídeo): abrir arquivo, última gravação ou gravar um trecho da fonte'}
                aria-label="Abrir o editor de vídeo"
                onClick=${() => abrirEditorVideo(isFile && video && source.current.url ? { url: source.current.url, nome: 'video-da-fonte', origem: 'fonte' } : null)}>✂</button>

        <div class="vctl-sep"></div>

        <button
          class="vctl-mic ${audioPref === 'off' ? 'off' : ''}"
          onClick=${toggleAudio}
          disabled=${gravando}
          title=${audioPref === 'off'
            ? 'Áudio desligado na gravação — clique para ligar'
            : 'Gravar com áudio (som da fonte quando houver; senão, microfone) — clique para desligar'}
          aria-label=${audioPref === 'off' ? 'Ligar áudio da gravação' : 'Desligar áudio da gravação'}
          aria-pressed=${audioPref !== 'off'}
        >${audioPref === 'off' ? ICON_MIC_OFF : ICON_MIC}</button>

        <button
          class="vctl-rec ${gravando ? 'on' : ''}"
          onClick=${toggleRec}
          disabled=${!fmt.current}
          title=${!fmt.current
            ? 'Este navegador não grava vídeo'
            : gravando
              ? 'Parar e salvar'
              : `Gravar em ${fmt.current.nome}`}
          aria-label=${gravando ? 'Parar gravação' : 'Gravar'}
        >
          <span class="vctl-rec-dot"></span>
        </button>
      </div>

      ${gravando && html`
        <div class="vctl-recbar">
          <b>REC</b>
          <span>${formatarTempo(recInfo.s)}</span>
          <em>${formatarBytes(recInfo.b)} · ${recRes ? recRes + ' · ' : ''}${fmt.current.nome} · ${rotuloModo(audioModo)}</em>
        </div>
      `}

      <div class="vctl-track">
        <input type="range" min="0" max="1" step="0.001" value=${ratio}
               onInput=${onSeek}
               disabled=${!ytp && !isFile && r.length < 2}
               aria-label="Linha do tempo" />
      </div>

      ${ytp && !yt && onUseYouTube && html`
        <button class="vctl-usar ${usando ? 'busy' : ''}" disabled=${usando}
                onClick=${async () => {
                  setUsando(true);
                  try { await onUseYouTube(); }
                  catch (err) { store.set({ notice: (err && err.message) || 'Não foi possível analisar o vídeo.' }); }
                  finally { setUsando(false); }
                }}
                title="O vídeo está só tocando: o pipeline (Bike Fit, detecção…) não vê a imagem. Clique para analisar — o navegador pede para compartilhar esta aba.">
          ${usando ? 'Aguardando você escolher «esta aba» no aviso do navegador…' : '▶ Analisar este vídeo no pipeline'}
        </button>
      `}

      <div class="vctl-status">
        <span class=${live && !(mini && video && !ytp) ? 'live' : ''}>${mini && video && !ytp ? fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration || 0) : statusText}</span>
        <em>
          ${ytp ? (yt ? 'YouTube · fonte do pipeline' : 'YouTube · só assistindo') : isFile ? 'arquivo' : `${isScreen ? (s.sourceKind === 'youtube' ? 'YouTube · ' : 'tela · ') : ''}buffer ${r.length}f · ${r.spanSeconds.toFixed(1)}s`}
          ${resolucao ? ` · ${resolucao}` : ''}
          <${FpsTexto} />
        </em>
      </div>
    </div>
  `;
}

/* fps num componente próprio: com ele no seletor, a barra inteira re-renderizava 4×/s (o store publica fps 4×/s) */
function FpsTexto() {
  const fps = useStore(store, (st) => st.fps);
  return fps ? ` · ${fps} fps` : '';
}

/**
 * Bitrate da gravação proporcional à área do canvas: ~0,1 bit por pixel por
 * quadro (H.264 limpo para imagem com texto e linhas finas), de 6 a 25 Mbit/s.
 * Antes era 6 Mbit/s fixo — numa tela retina (canvas 2560×1600) isso dava
 * 0,05 bit/pixel e borrava o overlay nas cenas com movimento.
 */
export function bitrateGravacao(w, h, fps = 30) {
  return Math.round(Math.max(6e6, Math.min(25e6, w * h * fps * 0.1)));
}

function fmtTime(t) {
  if (!Number.isFinite(t)) return '0:00';
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// ------------------------------------------------------------ ícones do áudio

const ICON_MIC = html`
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" />
  </svg>`;

const ICON_MIC_OFF = html`
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 9v5a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.6-1.5" />
    <path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.4 2.3M12 18v3M8 21h8M3 3l18 18" />
  </svg>`;

// ------------------------------------------------------------ botão

function Btn({ icon, title, onClick, disabled, active }) {
  return html`
    <button
      class="vctl-btn ${active ? 'active' : ''}"
      onClick=${onClick}
      disabled=${disabled}
      title=${title}
      aria-label=${title}
    >
      ${ICONS[icon]}
    </button>
  `;
}

const ICONS = {
  prev: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M7 5h2.4v14H7zM19 5v14l-9.2-7z" /></svg>`,
  play: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l13-7.5z" /></svg>`,
  pause: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" /></svg>`,
  stop: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <rect x="6.2" y="6.2" width="11.6" height="11.6" rx="1" /></svg>`,
  reload: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></svg>`,
  next: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M14.6 5H17v14h-2.4zM5 5v14l9.2-7z" /></svg>`,
  // virar câmera: só aparece em aparelho com mais de uma lente
  flip: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 8h3l1.4-2h7.2L17 8h3v11H4z" />
    <path d="M9.5 13.5a2.5 2.5 0 015 0" />
    <path d="M12 11v2.5M10.6 15.4l1.4-1.4 1.4 1.4" /></svg>`,
};

// ------------------------------------------------------------ posição

function loadPos() {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* storage bloqueado */ }
  return null;      // null = rodapé centralizado, pelo CSS
}

function savePos(p) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (_) { /* ignora */ }
}

function clearPos() {
  try { localStorage.removeItem(POS_KEY); } catch (_) { /* ignora */ }
}

function clampPos(p, el) {
  const w = el ? el.offsetWidth : 460;
  const h = el ? el.offsetHeight : 120;
  const m = 8;
  return {
    x: Math.min(Math.max(m, p.x), Math.max(m, window.innerWidth - w - m)),
    y: Math.min(Math.max(m, p.y), Math.max(m, window.innerHeight - h - m)),
  };
}
