/**
 * camera/youtube-midia.js — teclas de mídia do teclado no player do YouTube.
 *
 * Windows, macOS e Linux mandam as teclas de mídia (▶⏸, ⏭, ⏮, ⏹ — nos
 * teclados de notebook, Fn+F7/F8/F9 ou as teclas dedicadas) para a "sessão
 * de mídia" do navegador que tocou por último. Com o YouTube embutido, o som
 * sai do iframe, que é de outra origem: a sessão é DELE e os comandos nunca
 * chegam aqui — e com o player mudo nem sessão existe.
 *
 * A saída é a mesma do player do Mesa: enquanto o vídeo toca, esta página
 * toca junto um áudio SILENCIOSO (WAV de 10 s em loop, gerado em memória),
 * o que faz do iaVision a sessão ativa. Aí a Media Session API entrega as
 * teclas aos handlers abaixo, e o sistema ainda mostra título, canal e
 * miniatura no controle de mídia (Central de Controle do macOS, painel de
 * mídia do Windows, MPRIS no Linux, tela de bloqueio).
 *
 *   ▶⏸  tocar / pausar          ⏭  avançar 10 s      ⏮  voltar 10 s
 *   ⏹   pausar                   arrastar no controle do sistema = ir para o ponto
 *
 * Com a página em foco e sem sessão de mídia, as mesmas teclas também chegam
 * como keydown (MediaPlayPause etc.) — tratadas no fim deste arquivo.
 */

const SALTO = 10;   // segundos por ⏮/⏭ e pelos botões ±10 s do sistema

// ------------------------------------------------------------ áudio silencioso

let mudo = null;
function silencio() {
  if (mudo) return mudo;
  const sr = 8000, n = sr * 10, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  w(36, 'data'); v.setUint32(40, n, true); new Uint8Array(buf, 44).fill(128);   // PCM 8 bits: 128 = silêncio
  mudo = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  mudo.loop = true;
  mudo.preload = 'auto';
  return mudo;
}

/** Liga/desliga o áudio que segura a sessão. `retomar` reinicia para tomar o foco de volta. */
function segurar(ligar, retomar = false) {
  try {
    const a = silencio();
    if (ligar) {
      if (retomar) a.pause();
      if (a.paused) a.play().catch(() => { /* sem gesto do usuário ainda: tenta no próximo */ });
    } else if (!a.paused) a.pause();
  } catch (_) { /* navegador sem Audio */ }
}

// ------------------------------------------------------------ comandos

let ultimo = { k: '', t: 0 };

function agir(yt, k, d) {
  if (!yt || !yt.carregado) return;
  // a mesma tecla pode chegar duas vezes (keydown + sessão de mídia): ignora a repetida
  const agora = Date.now();
  if (ultimo.k === k && agora - ultimo.t < 350) return;
  ultimo = { k, t: agora };
  const tocando = estado(yt) === 1 || estado(yt) === 3;
  if (k === 'toggle') { if (tocando) yt.pause(); else yt.play(); }
  else if (k === 'play') yt.play();
  else if (k === 'pause' || k === 'stop') yt.pause();
  // tocando uma playlist (youtube/fila.js): próximo/anterior trocam de vídeo
  else if ((k === 'next' || k === 'prev') && yt.fila && yt.fila.ativa) { if (k === 'next') yt.fila.proximo(); else yt.fila.anterior(); }
  else if (k === 'fwd' || k === 'next') yt.avancar((d && d.seekOffset) || SALTO);
  else if (k === 'back' || k === 'prev') yt.avancar(-((d && d.seekOffset) || SALTO));
  else if (k === 'seek' && d && Number.isFinite(d.seekTime)) yt.irPara(d.seekTime);
  setTimeout(() => atualizar(yt), 120);
}

const estado = (yt) => (yt && yt.carregado ? yt._cmd('getPlayerState') : -1);

// ------------------------------------------------------------ sessão de mídia

let idAtual = null;

function metadados(yt) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  const d = yt._cmd('getVideoData') || {};
  const chave = yt.videoId + '|' + (d.title || '');
  if (chave === idAtual) return;
  idAtual = chave;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: d.title || 'Vídeo do YouTube',
      artist: d.author || 'YouTube',
      album: 'GPlanSiS|iaVision',
      // a miniatura vem do próprio site (CORP same-origin): i.ytimg.com seria barrado pelo COEP
      artwork: yt.videoId ? [{ src: '/api/yt/miniatura/' + yt.videoId, sizes: '480x360', type: 'image/jpeg' }] : [],
    });
  } catch (_) { /* metadados são cosméticos */ }
}

function atualizar(yt) {
  if (!('mediaSession' in navigator)) return;
  const M = navigator.mediaSession;
  if (!yt || !yt.carregado) {
    segurar(false);
    try { M.playbackState = 'none'; M.metadata = null; } catch (_) { /* ok */ }
    idAtual = null;
    return;
  }
  const st = estado(yt);
  const tocando = st === 1 || st === 3;
  metadados(yt);
  try { M.playbackState = tocando ? 'playing' : 'paused'; } catch (_) { /* ok */ }
  segurar(tocando);
  try {
    const dur = yt.duracao;
    if (dur > 0) M.setPositionState({ duration: dur, position: Math.min(dur, Math.max(0, yt.tempo)), playbackRate: yt.taxa || 1 });
  } catch (_) { /* posição inválida no instante do pulo */ }
}

/**
 * Liga as teclas de mídia à fonte YouTube. Chamar uma vez, com a instância
 * única de YouTubeSource do app. Devolve a função que desliga tudo.
 */
export function ligarTeclasMidia(yt) {
  const temSessao = 'mediaSession' in navigator;
  if (temSessao) {
    const M = navigator.mediaSession;
    const mapa = [['play', 'play'], ['pause', 'pause'], ['stop', 'stop'], ['previoustrack', 'prev'],
      ['nexttrack', 'next'], ['seekbackward', 'back'], ['seekforward', 'fwd'], ['seekto', 'seek']];
    for (const [acao, k] of mapa) {
      try { M.setActionHandler(acao, (d) => agir(yt, k, d)); } catch (_) { /* ação não suportada neste navegador */ }
    }
  }

  // foco/teclado sem sessão: as teclas chegam como keydown com estes nomes
  const TECLAS = { MediaPlayPause: 'toggle', MediaPlay: 'play', MediaPause: 'pause', MediaStop: 'stop',
    MediaTrackNext: 'next', MediaTrackPrevious: 'prev', MediaFastForward: 'fwd', MediaRewind: 'back' };
  const onKey = (e) => {
    const k = TECLAS[e.key];
    if (!k || !yt.carregado) return;
    e.preventDefault();
    agir(yt, k);
  };
  addEventListener('keydown', onKey, true);

  // a cada mudança do player (abrir, tocar, pausar, fechar) e 1×/s para a posição
  let antes = -2;
  const mudou = () => {
    const st = estado(yt);
    // começou a tocar: reinicia o silêncio para a página retomar a sessão do iframe
    if ((st === 1) && antes !== 1) segurar(true, true);
    antes = st;
    atualizar(yt);
  };
  const tirar = yt.ouvir(mudou);
  const relogio = setInterval(mudou, 1000);

  return () => {
    tirar();
    clearInterval(relogio);
    removeEventListener('keydown', onKey, true);
    segurar(false);
  };
}
