/**
 * camera/device.js — acesso à câmera via getUserMedia.
 *
 * getUserMedia exige SECURE CONTEXT: https:// ou http://localhost.
 * Abrir o index.html por file:// falha — é por isso que existe o serve.py.
 *
 * Também encapsula a ordem correta de enumerateDevices: antes da permissão
 * o browser devolve labels vazias, então só reenumeramos depois do getUserMedia.
 */

/**
 * Câmeras de celular.
 *
 * `facingMode` é o caminho CERTO no mobile, e `deviceId` é o errado: os ids
 * mudam entre sessões, e num aparelho com três câmeras traseiras (larga,
 * ultra-larga, teleobjetiva) escolher por id acerta a lente errada. Pedindo
 * `environment`, o sistema operacional entrega a lente principal — que é o
 * que o usuário quer dizer com "câmera de trás".
 */
export const FACING = {
  user: { label: 'Frontal', icon: 'selfie' },
  environment: { label: 'Traseira', icon: 'rear' },
};

export const RESOLUTIONS = [
  { label: '320 × 240', width: 320, height: 240 },
  { label: '640 × 480', width: 640, height: 480 },
  { label: '960 × 720', width: 960, height: 720 },
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  // só aparecem habilitadas quando a câmera diz que chega lá (getCapabilities)
  { label: '2560 × 1440', width: 2560, height: 1440 },
  { label: '3840 × 2160 (4K)', width: 3840, height: 2160 },
];

/*
 * Quadros por segundo pedidos à câmera. 60 só ajuda quando a câmera entrega
 * (muitas webcams só fazem 60 em 720p ou menos) e dobra o trabalho do
 * pipeline — é escolha da pessoa, guardada no aparelho; o padrão segue 30.
 */
export const FPS_OPCOES = [30, 60];
const FPS_KEY = 'gplansis.camera.fps';
export function fpsPreferido() {
  try { const v = parseInt(localStorage.getItem(FPS_KEY), 10); if (FPS_OPCOES.includes(v)) return v; } catch (_) { /* storage bloqueado */ }
  return 30;
}
export function definirFps(v) {
  try { v === 30 ? localStorage.removeItem(FPS_KEY) : localStorage.setItem(FPS_KEY, String(v)); } catch (_) { /* storage bloqueado */ }
}

/**
 * O que a câmera em uso entregou de fato e até onde ela vai — para o painel
 * Fonte mostrar a resolução real ao lado da pedida. Atualizado a cada start().
 */
export const cameraAtual = { pedido: null, settings: null, caps: null };

export function isSupported() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function isSecureContextOk() {
  return window.isSecureContext ||
         location.protocol === 'https:' ||
         location.hostname === 'localhost' ||
         location.hostname === '127.0.0.1';
}

/** Diagnóstico legível para a UI, antes de tentar abrir a câmera. */
export function preflight() {
  if (!isSupported()) {
    return { ok: false, code: 'UNSUPPORTED', message: 'Este browser não expõe getUserMedia.' };
  }
  if (!isSecureContextOk()) {
    return {
      ok: false,
      code: 'INSECURE_CONTEXT',
      message: 'A câmera exige contexto seguro. Sirva por http://localhost ' +
               '(rode: python serve.py) — file:// não funciona.',
    };
  }
  return { ok: true };
}

export class CameraSource {
  constructor() {
    this.stream = null;
    this.video = document.createElement('video');
    this.video.autoplay = true;
    // playsInline é obrigatório no iOS: sem ele o Safari abre o vídeo em
    // tela cheia nativa e o canvas nunca recebe frame
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('webkit-playsinline', '');
    this.video.muted = true;
    this.devices = [];
    this.activeDeviceId = null;
    this.settings = null;
    this.facing = null;
    this.onEnded = null;       // ({ id, rotulo }) — a câmera caiu por fora (ver start)
  }

  /** O aparelho tem mais de uma lente para alternar? */
  static async hasMultipleCameras() {
    if (!isSupported()) return false;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'videoinput').length > 1;
    } catch (_) {
      return false;
    }
  }

  /** Alterna frontal <-> traseira mantendo a resolução atual. */
  async flip(width, height) {
    const next = this.facing === 'environment' ? 'user' : 'environment';
    return this.start({ facing: next, width, height, preferColor: false });
  }

  async listDevices() {
    if (!isSupported()) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => {
        const label = d.label || `Câmera ${i + 1}`;
        return { id: d.deviceId, label, ir: isInfrared(label) };
      });
    return this.devices;
  }

  /**
   * Abre (ou troca) a câmera. Resolução é `ideal`, não `exact`: se a webcam
   * não suportar, o browser negocia a mais próxima em vez de estourar
   * OverconstrainedError.
   */
  async start({ deviceId = null, facing = null, width = 640, height = 480, preferColor = true } = {}) {
    const pf = preflight();
    if (!pf.ok) throw Object.assign(new Error(pf.message), { code: pf.code });

    /*
     * Troca A QUENTE (outra câmera com uma já ligada — o seletor do Studio,
     * o painel Fonte): a nova abre ANTES de soltar a atual. Se a nova falhar
     * (em uso por outro app, desplugada), a atual continua e o pipeline nem
     * pisca; se abrir, o mesmo <video> só troca de srcObject — o Viewport,
     * os operadores e os gráficos dos Studios seguem sem reiniciar. A mesma
     * câmera (mudar resolução/fps) fecha antes: no Windows, abrir o mesmo
     * dispositivo duas vezes falha.
     */
    const anterior = this.stream;
    /*
     * Celular/tablet: NÃO. O iOS (e vários Android) só mantêm uma câmera
     * aberta — abrir a segunda encerra a primeira por fora, o que pareceria
     * «câmera desconectada». Lá a troca fecha antes, como sempre foi.
     */
    const movel = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
      || (/Macintosh/.test(navigator.userAgent || '') && (navigator.maxTouchPoints || 0) > 1);
    const quente = Boolean(!movel && anterior && anterior.active && deviceId && deviceId !== this.activeDeviceId);
    if (!quente) this.stop();
    this._trocando = true;   // um «ended» da anterior durante a troca não é queda
    try {
      let novo = null;

      /*
       * `facingMode` como IDEAL, não exact.
       *
       * Com `exact`, um notebook sem câmera traseira responde
       * OverconstrainedError e o usuário vê "erro" em vez de sua webcam. Com
       * `ideal`, o navegador entrega a câmera mais próxima do pedido — no
       * celular acerta a traseira, no desktop cai na única que existe.
       */
      const video = {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: fpsPreferido() },
      };
      if (deviceId) {
        video.deviceId = { exact: deviceId };
      } else {
        video.facingMode = { ideal: facing || this.facing || 'user' };
      }

      try {
        novo = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      } catch (err) {
        /*
         * Uma tentativa sem restrição de lente antes de desistir. Aparelho que
         * recusa a combinação resolução+facing costuma aceitar o pedido nu, e
         * uma câmera funcionando vale mais que a resolução pedida.
         */
        /*
         * Câmera escolhida por id (seletor «Abrir câmera») só repete com o MESMO
         * id e só quando o que falhou foi a resolução: cair em «qualquer câmera»
         * trocaria em silêncio a escolha da pessoa — e uma câmera em uso por
         * outro app viraria outra câmera sem aviso.
         */
        if (deviceId && err && err.name !== 'OverconstrainedError') throw translateError(err);
        try {
          novo = await navigator.mediaDevices.getUserMedia({
            audio: false, video: deviceId ? { deviceId: { exact: deviceId } } : true,
          });
        } catch (_) {
          throw translateError(err);
        }
      }

      // a nova abriu: agora sim solta a anterior (nenhuma trilha fica viva sem dono)
      if (quente) for (const t of anterior.getTracks()) t.stop();
      this.stream = novo;
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      await this.waitForFrame();

      const track = this.stream.getVideoTracks()[0];
      /*
       * Câmera desplugada, celular (Continuity/DroidCam) que se afastou ou
       * permissão revogada: a trilha termina POR FORA («ended» não dispara no
       * track.stop() nosso). Sem isto o app seguia «câmera ligada» com a imagem
       * congelada; agora solta tudo e avisa quem pendurou `onEnded` (o
       * workspace, por camera/fonte-app.js), que mostra a mensagem e reconecta
       * quando ela voltar (devicechange).
       */
      if (track) {
        const meu = this.stream;
        track.addEventListener('ended', () => {
          if (this.stream !== meu || this._trocando) return;
          const info = { id: this.activeDeviceId, rotulo: track.label || '' };
          this.stop();
          if (this.onEnded) this.onEnded(info);
        });
      }
      this.settings = track ? track.getSettings() : null;
      cameraAtual.pedido = { width, height, fps: video.frameRate.ideal };
      cameraAtual.settings = this.settings;
      try { cameraAtual.caps = track && track.getCapabilities ? track.getCapabilities() : null; } catch (_) { cameraAtual.caps = null; }
      this.activeDeviceId = (this.settings && this.settings.deviceId) || deviceId;
      // o que o aparelho REALMENTE entregou pode diferir do pedido
      this.facing = (this.settings && this.settings.facingMode)
        || facing || this.facing || 'user';
      await this.listDevices(); // agora com labels, pois a permissão já foi dada

      /*
       * Notebooks com Windows Hello (ThinkPad, Dell, etc.) expõem DUAS câmeras
       * no mesmo módulo USB: a RGB e a infravermelha. A IR entrega imagem preta
       * fora de uma autenticação do Hello, porque o emissor IR não está aceso —
       * e o browser pode perfeitamente escolher ela como padrão.
       *
       * Sintoma: "a câmera liga mas a tela fica preta". Então: se caímos numa IR
       * e existe uma colorida, troca sozinho. Escolha explícita do usuário é
       * respeitada (preferColor=false), inclusive para usar a IR de propósito.
       */
      if (preferColor && !deviceId) {
        const active = this.devices.find((d) => d.id === this.activeDeviceId);
        const rgb = this.devices.find((d) => !d.ir);
        if (active && active.ir && rgb) {
          this._trocando = false;
          return this.start({ deviceId: rgb.id, width, height, preferColor: false });
        }
      }
      return this.settings;
    } finally {
      this._trocando = false;
    }
  }

  /** Espera metadata + dimensões reais; sem isso o primeiro draw sai 0x0. */
  waitForFrame() {
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        if (v.videoWidth > 0) {
          v.removeEventListener('loadeddata', done);
          resolve();
        }
      };
      v.addEventListener('loadeddata', done);
      setTimeout(resolve, 3000); // não travar a UI se o evento não vier
    });
  }

  stop() {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    cameraAtual.settings = null;
  }

  /**
   * O elemento que o Viewport desenha no canvas.
   *
   * Tem que existir com o mesmo nome no FileSource: é o contrato que deixa o
   * Viewport tratar câmera e arquivo sem saber a diferença. Faltar este getter
   * não dá erro — `undefined` só faz o loop de render abortar todo frame, e o
   * sintoma é tela preta com FPS zerado.
   */
  get element() {
    return this.stream ? this.video : null;
  }

  get isRunning() {
    return Boolean(this.stream && this.stream.active);
  }

  get size() {
    return { width: this.video.videoWidth || 0, height: this.video.videoHeight || 0 };
  }
}

/**
 * Reconhece câmera infravermelha pelo rótulo. Cobre as grafias que Windows,
 * Linux e os fabricantes usam de fato.
 */
export function isInfrared(label) {
  return /\b(ir|infra-?red|infravermelh\w+)\b/i.test(label || '');
}

function translateError(err) {
  const name = err && err.name ? err.name : '';
  // id que sumiu (câmera USB desplugada, celular que se afastou) chega como «restrição deviceId»
  if (name === 'OverconstrainedError' && err.constraint === 'deviceId') {
    return Object.assign(new Error('Esta câmera não está mais conectada. Plugue de novo ou escolha outra em «📷 Abrir câmera».'), { code: 'NotFoundError' });
  }
  const map = {
    NotAllowedError: 'Permissão de câmera negada. Libere no ícone de câmera da barra de endereço e tente de novo.',
    PermissionDeniedError: 'Permissão de câmera negada.',
    NotFoundError: 'Nenhuma câmera encontrada nesta máquina.',
    DevicesNotFoundError: 'Nenhuma câmera encontrada.',
    NotReadableError: 'A câmera está em uso por outro app (Teams, Zoom, Meet, OBS?). Feche-o e tente de novo.',
    TrackStartError: 'A câmera está em uso por outro app.',
    OverconstrainedError: 'A resolução pedida não é suportada por esta câmera.',
    AbortError: 'A inicialização da câmera foi abortada.',
  };
  return Object.assign(new Error(map[name] || `Falha ao abrir a câmera: ${name || err}`), { code: name });
}

/**
 * Fonte alternativa: arquivo de imagem ou vídeo. Mesma interface da câmera,
 * para o Viewport não precisar saber a diferença.
 */
export class FileSource {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.loop = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.image = null;
    this.kind = null;
    this.url = null;
  }

  async load(file) {
    this.release();
    this.url = URL.createObjectURL(file);
    // identidade do arquivo: a calibração da quadra fica salva por fonte (components/calibrar.js)
    this.nomeArquivo = file && file.name ? `${file.name}|${file.size || 0}` : null;
    if (file.type.startsWith('video/')) {
      this.kind = 'video';
      this.video.src = this.url;
      await this.video.play().catch(() => {});
      return { width: this.video.videoWidth, height: this.video.videoHeight };
    }
    this.kind = 'image';
    this.image = new Image();
    await new Promise((res, rej) => {
      this.image.onload = res;
      this.image.onerror = () => rej(new Error('Arquivo de imagem inválido.'));
      this.image.src = this.url;
    });
    return { width: this.image.naturalWidth, height: this.image.naturalHeight };
  }

  get element() {
    return this.kind === 'video' ? this.video : this.image;
  }

  get size() {
    if (this.kind === 'video') return { width: this.video.videoWidth, height: this.video.videoHeight };
    if (this.image) return { width: this.image.naturalWidth, height: this.image.naturalHeight };
    return { width: 0, height: 0 };
  }

  get isRunning() {
    return Boolean(this.element);
  }

  release() {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.image = null;
    this.video.removeAttribute('src');
    this.kind = null;
  }
}
