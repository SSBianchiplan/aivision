/**
 * components/CaptionsPanel.js — Legendas: ouvir, gerar texto, legendar ao vivo.
 *
 * Dois motores, escolhidos pelo que a pessoa precisa e pelo que o navegador
 * oferece (ver cv/speech/engine-native.js e engine-whisper.js). O painel
 * decide de onde vem o áudio, liga o motor, mostra a transcrição acumulada e
 * exporta em SRT/VTT/TXT. A legenda ao vivo não é desenhada aqui — é o
 * Viewport que a pinta dentro do vídeo, para sair também na gravação.
 */

import { html, useState, useEffect, useRef } from '../vendor.js';
import { Panel } from './Panel.js';
import { useStore, store } from '../state/store.js';
import * as nativo from '../cv/speech/engine-native.js';
import * as whisper from '../cv/speech/engine-whisper.js';
import * as servidor from '../cv/speech/engine-server.js';
import {
  novaSessao, acrescentar, duracao, exportarSrt, exportarVtt, exportarTexto,
  ligarLegenda, atualizarVivo,
} from '../cv/speech/captions.js';

const IDIOMAS = [
  ['pt-BR', 'pt', 'Português (Brasil)'],
  ['pt-PT', 'pt', 'Português (Portugal)'],
  ['en-US', 'en', 'Inglês'],
  ['es-ES', 'es', 'Espanhol'],
];

export function CaptionsPanel({ onClose, source, ...layout }) {
  const s = useStore(store, (st) => ({ sourceKind: st.sourceKind, cameraOn: st.cameraOn }));

  const temNativo = nativo.disponivel();
  /*
   * Padrão: SERVIDOR. É o único que reconhece em fluxo, roda em qualquer
   * aparelho sem baixar nada e não manda áudio para terceiro. O nativo e o
   * Whisper local ficam como alternativas quando o VPS não estiver de pé.
   */
  const [motor, setMotor] = useState('servidor');
  const [fonteAudio, setFonteAudio] = useState('mic');      // 'mic' | 'fonte'
  const [idioma, setIdioma] = useState('pt-BR');
  const [modelo, setModelo] = useState('base');
  const [estado, setEstado] = useState('parado');           // parado|carregando|ouvindo|transcrevendo|erro
  const [detalhe, setDetalhe] = useState('');
  const [progresso, setProgresso] = useState(null);
  const [sessao, setSessao] = useState(novaSessao());
  const [naTela, setNaTela] = useState(true);

  const inst = useRef(null);
  const sessRef = useRef(sessao);
  useEffect(() => { sessRef.current = sessao; }, [sessao]);

  const rodando = estado !== 'parado' && estado !== 'erro';

  // a fonte atual tem áudio capturável?
  const src = source && source.current;
  const fonteTemAudio = Boolean(src && (
    (src.kind === 'screen' && src.audioTrack) ||
    (src.kind === 'stream' && src.modo === 'hls') ||
    src.kind === 'file'
  ));

  // whisper ouve a fonte; o nativo só o microfone
  useEffect(() => { if (motor === 'nativo') setFonteAudio('mic'); }, [motor]);

  const receber = (r) => {
    if (r.final) {
      const prox = acrescentar(sessRef.current, r);
      sessRef.current = prox;
      setSessao(prox);
      atualizarVivo({ final: r.texto, interim: '' });
    } else {
      atualizarVivo({ interim: r.texto });
    }
  };

  const mudarEstado = (e, d) => { setEstado(e); setDetalhe(d || ''); if (e === 'erro') parar(false); };

  const parar = (limparEstado = true) => {
    if (inst.current) { try { inst.current.stop(); } catch (_) { /* já */ } inst.current = null; }
    ligarLegenda(false);
    if (limparEstado) { setEstado('parado'); setDetalhe(''); }
    setProgresso(null);
  };

  const ligar = async () => {
    setDetalhe('');
    // feedback IMEDIATO: o clique tem que mudar a tela antes de qualquer await
    setEstado('carregando');
    const nomeMotor = motor === 'nativo' ? nativo.nome() : motor === 'servidor' ? servidor.nome() : whisper.nome();
    const sess = { ...sessRef.current, motor: nomeMotor, idioma };
    sessRef.current = sess; setSessao(sess);
    ligarLegenda(naTela);
    try {
      if (motor === 'nativo') {
        const m = new nativo.MotorNativo({ idioma, onResultado: receber, onEstado: mudarEstado });
        inst.current = m;
        m.start();
        return;
      }
      // servidor e whisper: precisam de um MediaStream de áudio
      let stream;
      if (fonteAudio === 'fonte' && fonteTemAudio) {
        stream = await streamDaFonte(src);
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }, video: false,
        });
      }
      if (motor === 'servidor') {
        const m = new servidor.MotorServidor(stream, { onResultado: receber, onEstado: mudarEstado });
        inst.current = m;
        await m.start();
        return;
      }
      const cod = (IDIOMAS.find((i) => i[0] === idioma) || IDIOMAS[0])[1];
      const m = new whisper.MotorWhisper(stream, {
        modelo, idioma: cod, janelaS: 6,
        onResultado: receber, onEstado: mudarEstado,
        onProgresso: (p) => setProgresso(p),
      });
      inst.current = m;
      await m.start();
    } catch (err) {
      mudarEstado('erro', err.message || String(err));
    }
  };

  useEffect(() => () => parar(false), []);        // desmontar não deixa microfone aberto
  useEffect(() => { ligarLegenda(rodando && naTela); }, [naTela, rodando]);

  const baixar = (conteudo, ext, tipo) => {
    const blob = new Blob([conteudo], { type: tipo });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `legendas-${new Date(sessao.inicio || Date.now()).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const segs = sessao.segmentos;

  return html`
    <${Panel} id="captions" title="Legendas"
              subtitle=${rodando ? (estado === 'transcrevendo' ? 'transcrevendo…' : 'ouvindo') : (segs.length ? `${segs.length} trecho(s)` : 'áudio → texto')}
              onClose=${onClose} ...${layout}>

      <p class="hint">
        Ouve, transcreve e legenda <b>ao vivo</b> — a legenda entra no vídeo e
        sai na gravação. Exporta em <b>SRT</b> (Premiere, DaVinci, YouTube), <b>VTT</b> e texto.
      </p>

      <div class="ctx-tasks">
        <button class="ctx-task ${motor === 'servidor' ? 'on' : ''}" disabled=${rodando}
                onClick=${() => setMotor('servidor')}>
          <b>SERVIDOR</b><em>Vosk no seu VPS · em fluxo · qualquer aparelho</em>
        </button>
        <button class="ctx-task ${motor === 'nativo' ? 'on' : ''}" disabled=${!temNativo || rodando}
                onClick=${() => setMotor('nativo')}>
          <b>NATIVO</b><em>${temNativo ? 'navegador · só microfone' : 'indisponível neste navegador'}</em>
        </button>
        <button class="ctx-task ${motor === 'whisper' ? 'on' : ''}" disabled=${rodando}
                onClick=${() => setMotor('whisper')}>
          <b>LOCAL</b><em>Whisper no navegador · sem rede</em>
        </button>
      </div>

      ${motor === 'servidor' && html`
        <div class="notice">
          O áudio vai por <b>wss://</b> para o <b>seu VPS</b> (rtmp.gplansis.com),
          onde o <b>Vosk</b> (código aberto, Apache-2.0) reconhece em fluxo — a
          legenda aparece palavra a palavra. Nada vai a terceiros. Funciona no
          celular sem baixar modelo.
        </div>
      `}

      ${motor === 'nativo' && html`
        <div class="notice">
          O motor nativo processa a fala <b>${nativo.ondeProcessa()}</b> e ouve
          apenas o <b>microfone</b>. Para legendar o áudio de uma aba ou do
          Osmo, use <b>SERVIDOR</b>; para nada sair da máquina, <b>LOCAL</b>.
        </div>
      `}

      ${(motor === 'whisper' || motor === 'servidor') && html`
        <label class="ctl">
          <span class="ctl-label">Áudio</span>
          <select value=${fonteAudio} disabled=${rodando} onChange=${(e) => setFonteAudio(e.target.value)}>
            <option value="mic">Microfone do aparelho</option>
            <option value="fonte" disabled=${!fonteTemAudio}>
              Áudio da fonte ${fonteTemAudio ? '' : '(a fonte atual não tem áudio capturável)'}
            </option>
          </select>
        </label>
      `}
      ${motor === 'whisper' && html`
        <label class="ctl">
          <span class="ctl-label">Modelo</span>
          <select value=${modelo} disabled=${rodando} onChange=${(e) => setModelo(e.target.value)}>
            ${Object.entries(whisper.MODELOS).map(([k, m]) => html`<option key=${k} value=${k}>${m.nome}</option>`)}
          </select>
        </label>
        <p class="hint tight">
          Tudo é processado <b>nesta máquina</b>; o modelo baixa uma vez e fica
          em cache. Transcreve em trechos de ~6 s — a legenda chega com esse
          atraso, não palavra a palavra. <b>base</b> é o equilíbrio para pt-BR.
        </p>
      `}

      <label class="ctl">
        <span class="ctl-label">Idioma</span>
        <select value=${idioma} disabled=${rodando} onChange=${(e) => setIdioma(e.target.value)}>
          ${IDIOMAS.map(([v, , r]) => html`<option key=${v} value=${v}>${r}</option>`)}
        </select>
      </label>

      <label class="ctl ctl-bool">
        <input type="checkbox" checked=${naTela} onChange=${(e) => setNaTela(e.target.checked)} />
        <span>Mostrar legenda no vídeo (e na gravação)</span>
      </label>

      ${detalhe && html`<div class=${estado === 'erro' ? 'mdl-err' : 'notice'}>${detalhe}</div>`}
      ${progresso && estado === 'carregando' && html`
        <div class="cap-prog"><i style=${{ width: progresso.pct + '%' }}></i>
          <span>${progresso.pct}% · ${String(progresso.arquivo || '').split('/').pop()}</span></div>
      `}

      <div class="row">
        ${rodando
          ? html`<button class="btn danger" onClick=${() => parar()}>■ Parar</button>`
          : html`<button class="btn accent" onClick=${ligar}>● Ouvir</button>`}
        ${rodando && html`<div class="ctx-live"><i></i><span>${estado === 'carregando' ? (motor === 'nativo' ? 'iniciando…' : 'carregando modelo…') : estado === 'transcrevendo' ? 'transcrevendo…' : 'ouvindo'}</span></div>`}
      </div>

      ${segs.length > 0 && html`
        <div class="ctx-trans">
          <div class="ctx-trans-h">
            <b>Transcrição</b>
            <em>${segs.length} trecho(s) · ${Math.round(duracao(sessao) / 1000)}s de fala</em>
          </div>
          <div class="ctx-trans-body" role="log" aria-live="polite">
            ${segs.slice(-40).reverse().map((g, i) => html`
              <div key=${g.inicio + '-' + i} class="ctx-trans-l">
                <time>${new Date(g.inicio).toLocaleTimeString('pt-BR')}</time>
                <span>${g.texto}</span>
              </div>
            `)}
          </div>
          <div class="row">
            <button class="btn tiny" onClick=${() => baixar(exportarSrt(sessao), 'srt', 'application/x-subrip')}>Exportar .srt</button>
            <button class="btn tiny" onClick=${() => baixar(exportarVtt(sessao), 'vtt', 'text/vtt')}>.vtt</button>
            <button class="btn tiny" onClick=${() => baixar(exportarTexto(sessao), 'txt', 'text/plain;charset=utf-8')}>.txt</button>
            <button class="btn tiny" disabled=${rodando}
                    onClick=${() => { sessRef.current = novaSessao(); setSessao(sessRef.current); }}>Limpar</button>
          </div>
        </div>
      `}
    <//>
  `;
}

/**
 * MediaStream de áudio a partir da fonte de vídeo ativa.
 *
 * Captura de tela já traz a trilha. Arquivo e HLS passam pelo WebAudio, o
 * mesmo caminho de cv/audio.js — o <video> precisa estar sem `muted` para o
 * grafo receber som, e o grafo não vai aos alto-falantes.
 */
async function streamDaFonte(src) {
  if (src.kind === 'screen' && src.audioTrack) return new MediaStream([src.audioTrack]);
  const video = src.video;
  if (!video) throw new Error('A fonte não tem elemento de vídeo.');
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  if (ctx.state === 'suspended') await ctx.resume();
  const no = ctx.createMediaElementSource(video);
  const dest = ctx.createMediaStreamDestination();
  no.connect(dest);
  video.muted = false;
  video.volume = 1;
  return dest.stream;
}
