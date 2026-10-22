/**
 * cv/audio.js — de onde vem o áudio de uma gravação.
 *
 * ================= NÃO EXISTE UMA RESPOSTA SÓ =================
 *
 * A imagem gravada é o canvas de exibição, que não tem som. O áudio precisa
 * vir de outro lugar, e o lugar certo depende da fonte da imagem:
 *
 *   câmera do aparelho     o stream é aberto sem áudio (autoplay e privacidade).
 *                          Quem fala é a pessoa segurando o aparelho: MICROFONE.
 *
 *   Osmo por WebRTC        o WebRTC não transporta AAC, então o MediaMTX
 *                          descarta a trilha de áudio da câmera antes de ela
 *                          chegar aqui. Não há o que capturar da fonte: MICROFONE.
 *
 *   Osmo por HLS           a trilha AAC vem inteira dentro do HLS. Dá para
 *                          capturá-la do próprio <video> com WebAudio — e é
 *                          o único jeito de gravar o SOM DA CENA, não o do
 *                          operador: FONTE.
 *
 *   arquivo de vídeo       idem: a trilha do arquivo, pelo <video>: FONTE.
 *
 * `escolherModo()` é a decisão, pura, testável. `obterTrilha()` executa.
 *
 * ================= COMO SE CAPTURA DE UM <video> =================
 *
 * `createMediaElementSource(video)` desvia o áudio do elemento para dentro
 * de um grafo WebAudio; um `MediaStreamAudioDestinationNode` devolve isso
 * como trilha de MediaStream, que entra no MediaRecorder junto do vídeo do
 * canvas. Três armadilhas, todas tratadas aqui:
 *
 *   1. O elemento está `muted` (obrigatório para autoplay). Muted e volume
 *      valem TAMBÉM para o que entra no grafo — então desligamos o muted
 *      enquanto grava, mas NÃO ligamos o grafo aos alto-falantes. Resultado:
 *      o som é gravado sem tocar na sala.
 *   2. Desligar o muted exige gesto do usuário. Gravar começa num clique, e
 *      é dentro dele que chamamos isto.
 *   3. Mídia de outra origem sem CORS deixa o grafo em silêncio total, sem
 *      erro. O <video> do stream é criado com crossOrigin="anonymous" e o
 *      servidor de mídia responde Access-Control-Allow-Origin — sem isso a
 *      gravação sairia muda e ninguém saberia por quê.
 * ==================================================================
 */

/** Decide de onde vem o áudio. `pref` é a preferência salva do usuário. */
export function escolherModo(source, pref) {
  if (pref === 'off') return 'off';
  const kind = source && source.kind;

  if (kind === 'file') return 'fonte';
  if (kind === 'stream') {
    // HLS traz a trilha; WebRTC não
    return source.modo === 'hls' ? 'fonte' : 'mic';
  }
  if (kind === 'screen') {
    // aba compartilhada COM som traz uma trilha pronta; janela e monitor, não
    return source.audioTrack ? 'fonte' : 'mic';
  }
  return 'mic';                       // câmera, ou fonte desconhecida
}

export function rotuloModo(modo) {
  return modo === 'fonte' ? 'som da fonte'
       : modo === 'mic'   ? 'microfone'
       : 'sem áudio';
}

let ctx = null;

/**
 * Devolve { track, modo, liberar } ou { track: null, modo: 'off' }.
 * `liberar()` desfaz o que foi feito (para o microfone, religa o muted).
 * Nunca lança: áudio que falha não pode impedir a gravação do vídeo.
 */
export async function obterTrilha(source, pref) {
  const modo = escolherModo(source, pref);
  if (modo === 'off') return { track: null, modo, liberar() {} };

  if (modo === 'fonte' && source && source.kind === 'screen' && source.audioTrack) {
    /*
     * Captura de tela: a trilha já é um MediaStreamTrack — não precisa de
     * WebAudio nem de mexer no muted. Clonada, para o gravador poder
     * encerrar a cópia sem derrubar o áudio da fonte.
     */
    const track = source.audioTrack.clone();
    return { track, modo, liberar() { try { track.stop(); } catch (_) { /* já parada */ } } };
  }

  if (modo === 'fonte') {
    const video = source && source.video;
    if (!video) return { track: null, modo: 'off', liberar() {}, motivo: 'fonte sem elemento de vídeo' };
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) throw new Error('WebAudio indisponível');
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') await ctx.resume();

      const src = ctx.createMediaElementSource(video);
      const dest = ctx.createMediaStreamDestination();
      src.connect(dest);                // e NÃO em ctx.destination: grava sem tocar

      const eraMudo = video.muted;
      const volumeAntes = video.volume;
      video.muted = false;
      video.volume = 1;

      const track = dest.stream.getAudioTracks()[0] || null;
      return {
        track, modo,
        liberar() {
          try { src.disconnect(); } catch (_) { /* já desconectado */ }
          try { dest.disconnect(); } catch (_) { /* idem */ }
          video.muted = eraMudo;
          video.volume = volumeAntes;
        },
      };
    } catch (err) {
      /*
       * Cai para o microfone: pior gravar a voz do operador que gravar mudo.
       * Chamada DIRETA a pedirMicrofone(), não a obterTrilha() de novo — a
       * decisão de modo devolveria 'fonte' outra vez e isto viraria recursão
       * infinita (foi a primeira versão deste trecho).
       */
      const r = await pedirMicrofone();
      return { ...r, motivo: 'trilha da fonte indisponível (' + (err.message || err) + ')' + (r.motivo ? '; ' + r.motivo : '') };
    }
  }

  return pedirMicrofone();
}

/** Abre o microfone. Nunca lança. */
async function pedirMicrofone() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return { track: null, modo: 'off', liberar() {}, motivo: 'getUserMedia indisponível' };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const track = stream.getAudioTracks()[0] || null;
    return {
      track, modo: 'mic',
      liberar() { for (const t of stream.getTracks()) t.stop(); },
    };
  } catch (err) {
    const negado = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    return {
      track: null, modo: 'off', liberar() {},
      motivo: negado
        ? 'microfone negado — a gravação segue sem áudio'
        : 'microfone indisponível: ' + (err.message || err.name),
    };
  }
}
