/**
 * camera/screen.js — a tela do computador como fonte de vídeo.
 *
 * `getDisplayMedia()` pede ao usuário que escolha uma aba, uma janela ou o
 * monitor inteiro, e devolve isso como stream. Daí em diante o pipeline não
 * sabe a diferença para a câmera: o mesmo contrato `element` / `size` que
 * CameraSource, FileSource e StreamSource cumprem.
 *
 * ================= O QUE É DIFERENTE DE UMA CÂMERA =================
 *
 *   1. A PESSOA PODE PARAR POR FORA. O navegador mostra uma barra "parar
 *      compartilhamento" que encerra a trilha sem passar pela nossa
 *      interface. Escutamos `ended` na trilha e avisamos o app — senão a tela
 *      congelaria no último quadro e o botão diria «tela ativa».
 *
 *   2. NUNCA ESPELHAR. Espelho é para selfie; numa tela ele inverte todo o
 *      texto que o OCR devia ler. O app força mirror=false ao ligar.
 *
 *   3. ÁUDIO DA ABA. Quando o usuário compartilha uma aba com som, o stream
 *      traz uma trilha de áudio — é o único caso em que gravar «som da fonte»
 *      captura exatamente o que a tela está tocando (cv/audio.js usa isto).
 *
 *   4. SÓ EXISTE NO DESKTOP. iOS e Android não implementam getDisplayMedia;
 *      `disponivel()` diz isso antes de a pessoa clicar num botão morto.
 * ====================================================================
 */

export function disponivel() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}

export class ScreenSource {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;          // autoplay só é permitido sem som
    this.stream = null;
    this.onEnded = null;              // o app pendura aqui o "parou por fora"
  }

  get kind() { return 'screen'; }

  get element() {
    return this.stream && this.video.readyState >= 2 ? this.video : null;
  }

  get size() {
    return { width: this.video.videoWidth || 0, height: this.video.videoHeight || 0 };
  }

  get isRunning() {
    return Boolean(this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  /** A trilha de áudio da aba compartilhada, se houver. */
  get audioTrack() {
    return this.stream ? (this.stream.getAudioTracks()[0] || null) : null;
  }

  /** Rótulo do que está sendo capturado: "aba", "janela" ou "monitor". */
  get rotulo() {
    const t = this.stream && this.stream.getVideoTracks()[0];
    const s = t && t.getSettings ? t.getSettings() : {};
    return { browser: 'aba', window: 'janela', monitor: 'monitor' }[s.displaySurface] || 'tela';
  }

  async start() {
    if (!disponivel()) {
      throw new Error(
        'Este navegador não captura a tela. Funciona no Chrome, Edge, Firefox e ' +
        'Safari de computador — celulares não expõem esse recurso.'
      );
    }
    this.stop();

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          // sem redimensionar: OCR e detecção querem os pixels originais
          width: { ideal: 1920 }, height: { ideal: 1080 },
        },
        /*
         * Áudio pedido, não exigido: só a aba oferece; janela e monitor não.
         * O Chrome ainda pergunta se a pessoa quer compartilhar o som.
         */
        audio: true,
        // Chrome: sugere a aba atual como primeira opção e esconde o "esta aba"
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'include',
      });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
        throw new Error('Captura de tela cancelada.');
      }
      throw new Error('Não foi possível capturar a tela: ' + (err.message || err.name));
    }

    this.stream = stream;
    this.video.srcObject = stream;

    const trilha = stream.getVideoTracks()[0];
    trilha.addEventListener('ended', () => {
      // a pessoa clicou em "parar compartilhamento" na barra do navegador
      this.stop();
      if (this.onEnded) this.onEnded();
    });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('A tela não entregou vídeo em 8 s.')), 8000);
      const ok = () => {
        if (this.video.videoWidth > 0) { clearTimeout(t); this.video.removeEventListener('loadeddata', ok); resolve(); }
      };
      this.video.addEventListener('loadeddata', ok);
      this.video.play().catch(() => {});
      ok();
    });
    return this.size;
  }

  stop() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
  }
}
