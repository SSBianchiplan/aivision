/**
 * camera/youtube.js — um vídeo do YouTube como fonte do pipeline, por STREAMING.
 *
 * Nada é baixado. O vídeo toca no player OFICIAL do YouTube (iframe
 * youtube-nocookie.com, controlado pela IFrame API) e o navegador captura a
 * PRÓPRIA ABA com getDisplayMedia; a trilha capturada é recortada no elemento
 * do player. Daí em diante é igual à captura de tela: o mesmo contrato
 * `element` / `size` / `kind` que CameraSource e ScreenSource cumprem.
 *
 * ================= DECISÕES =================
 *
 *   1. COEP require-corp. A página é isolada (threads do ONNX Runtime). Um
 *      iframe de outra origem só carrega num documento assim se a resposta
 *      dele se declarar compatível — o embed do YouTube não declara. O
 *      atributo `credentialless` (Chrome/Edge 110+) resolve: o iframe carrega
 *      sem cookies, num contexto próprio, e o COEP aceita. Com
 *      youtube-nocookie não há cookie a perder. O script iframe_api responde
 *      Cross-Origin-Resource-Policy: cross-origin, então carrega normalmente
 *      (verificado; o widgetapi que ele puxa também).
 *
 *   2. ELEMENT CAPTURE (Chrome 132+), o caminho principal.
 *      RestrictionTarget.fromElement(host) + track.restrictTo(): a trilha
 *      passa a conter SÓ o que o elemento desenha, mesmo que outra coisa
 *      esteja por cima. Por isso o player fica ATRÁS do canvas do Viewport,
 *      exatamente na área onde o vídeo aparece: o que a pessoa vê é o quadro
 *      processado, e o que o pipeline recebe é o quadro limpo — o canvas
 *      processado nunca volta para a captura (sem realimentação), e painéis
 *      ou a barra de controles por cima também não entram.
 *
 *   3. REGION CAPTURE (Chrome 104–131), a reserva. CropTarget + cropTo()
 *      recorta a aba no RETÂNGULO do player — e aí tudo que estiver pintado
 *      naquele retângulo entra junto. Se o canvas processado ficasse por cima
 *      do player, o pipeline processaria a própria saída (realimentação).
 *      Solução: tela dividida. O player ocupa a metade ESQUERDA, visível e
 *      descoberto; o canvas do Viewport é empurrado para a metade direita
 *      (classe `yt-lado` no <body>, css/youtube.css). Painéis arrastados para
 *      cima do player entrariam na captura — o painel avisa.
 *
 *   4. Safari e Firefox no computador: sem iframe `credentialless` (o COEP
 *      bloqueia o embed) nem Element/Region Capture. O player vai para uma
 *      JANELA PRÓPRIA (/yt/player.html, servida sem isolamento), comandada
 *      por BroadcastChannel com a mesma interface do YT.Player; a captura é
 *      da janela (getDisplayMedia comum), recortada no vídeo por detecção de
 *      bordas ou à mão (camera/youtube-janela.js). modo === 'janela'.
 *
 *   5. Celular: `suporte()` diz o que dá para fazer: assistir aqui (Chrome
 *      Android) ou só abrir no YouTube.
 * ==============================================
 */

import { store } from '../state/store.js';

import {
  YT_ID, JANELA_UI_MS, extrairId, suporte, carregarApi, ERROS_PLAYER, criarIframe, semLegenda,
  HOSTS_PLAYER, ERROS_DEFINITIVOS, ESPERA_INICIO_MS,
  capturarAba, quadroJpegDe,
  PlayerJanela, capturarJanela, Recortador, ajustarRecorte,
} from './youtube-nucleo.js';

// o núcleo (sem dependências) fica em youtube-nucleo.js para o Treinar usar o mesmo mecanismo;
// quem importava daqui continua importando daqui
export { YT_ID, extrairId, suporte };

export const ASPECTOS = { '16:9': 16 / 9, '4:3': 4 / 3, '9:16': 9 / 16, '1:1': 1 };

/*
 * ================= QUALIDADE (medido em out/2026) =================
 *
 * `setPlaybackQuality` / `suggestedQuality` da IFrame API são IGNORADOS: pedir
 * 'small' num player 2560×1440 continua em hd1440. Quem decide é o YouTube,
 * pelo tamanho em PIXELS FÍSICOS em que o player é desenhado (e pela banda):
 * 640×360 → 480p, 1280×720 → 720p, 1920×1080 → 1080p, 2560×1440 → 1440p.
 * `getPlaybackQuality()` ainda informa o que está tocando.
 *
 * Então pedimos qualidade mexendo no tamanho:
 *   - só assistindo: o iframe é desenhado MAIOR (ou menor) que a área visível
 *     e reduzido com transform: scale — o YouTube vê o tamanho grande;
 *   - capturando: o Chrome renderiza a aba capturada numa escala maior para
 *     entregar o tamanho pedido ao getDisplayMedia (player 1280×720 pedindo
 *     1920×1080 → quadro 1920×1080 e o YouTube sobe para 1080p sozinho). A
 *     escala é fixada no PEDIDO INICIAL: applyConstraints depois só reduz.
 *     Por isso a qualidade escolhida entra no pedido da captura, e subir
 *     durante a captura exige começar a captura de novo.
 * ==================================================================
 */
// chaves não numéricas: chave tipo '480' passaria na frente na ordem do objeto
export const QUALIDADES = {
  auto: { rotulo: 'Automática', curto: 0 },
  '480p': { rotulo: '480p', curto: 480 },
  '720p': { rotulo: '720p', curto: 720 },
  '1080p': { rotulo: '1080p', curto: 1080 },
  max: { rotulo: 'Máxima', curto: 2160 },
};
const QUAL_KEY = 'gplansis.yt.qualidade';
/** Lado curto pedido à captura quando a qualidade é automática (o comportamento de antes). */
const CURTO_AUTO = 1080;

/** Nome que o YouTube usa → rótulo para a pessoa. */
const NIVEIS_YT = {
  tiny: '144p', small: '240p', medium: '360p', large: '480p', hd720: '720p',
  hd1080: '1080p', hd1440: '1440p', hd2160: '4K', highres: '4K+',
};
export const rotuloNivel = (n) => NIVEIS_YT[n] || '';

/** «1080p · captura 1920×1080»: o que está chegando de verdade (vazio enquanto não se sabe). */
export function rotuloReal(yt) {
  const r = yt.qualidadeReal;
  return [r.nivel, r.captura && 'captura ' + r.captura].filter(Boolean).join(' · ');
}

function lerQualidade() {
  try {
    const v = localStorage.getItem(QUAL_KEY);
    if (v && QUALIDADES[v]) return v;
  } catch (_) { /* storage bloqueado */ }
  return 'auto';
}

// ---------------------------------------------------------------- fonte

export class YouTubeSource {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.stream = null;
    this.host = null;          // <div class="yt-host"> que recebe o iframe e é o alvo da captura
    this.player = null;        // YT.Player
    this.videoId = null;
    this.aspecto = '16:9';
    this.modo = null;          // 'element' | 'region' | 'janela' enquanto captura
    this.recorte = null;       // Recortador (modo janela): captura bruta → só o vídeo
    this.original = false;     // mostrar o player por cima do canvas (só Element Capture)
    this.estado = -1;          // YT.PlayerState
    this.mudouEm = 0;          // performance.now() da última mudança de estado ou pulo
    this.erro = null;
    this.onEnded = null;       // o app pendura aqui o "parou por fora"
    this.aoTerminar = null;    // fila da playlist (youtube/fila.js): () => true se carregou o próximo
    this.fila = null;          // a mesma fila, para as teclas de mídia próximo/anterior
    this.ouvintes = new Set(); // a interface escuta mudanças (estado, erro, captura)
    this.qualidade = lerQualidade();   // chave de QUALIDADES, guardada no aparelho
    this.avisoQualidade = null;        // texto quando a captura não chega à qualidade pedida
    this._reposicionar = () => this.posicionar();
  }

  get kind() { return 'youtube'; }

  get element() {
    return this.stream && this.video.readyState >= 2 ? this.video : null;
  }

  get size() {
    return { width: this.video.videoWidth || 0, height: this.video.videoHeight || 0 };
  }

  get isRunning() {
    return Boolean(this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live'));
  }

  /** Captura de aba sem áudio: a gravação cai no microfone (cv/audio.js). */
  get audioTrack() { return null; }

  get carregado() { return Boolean(this.player && this.videoId); }

  ouvir(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); }
  _avisar() { for (const fn of this.ouvintes) { try { fn(this); } catch (_) { /* ouvinte ruim */ } } }

  // ------------------------------------------------------------ layout

  /**
   * A «área da câmera»: o retângulo onde o Viewport desenha o vídeo. O
   * Viewport encaixa a fonte (fit, centralizada) no canvas, que ocupa a tela
   * inteira; com o player em 16:9 e o quadro capturado também em 16:9, o
   * retângulo calculado aqui coincide com o desenhado lá. No modo Region
   * Capture a área é a metade esquerda (o canvas vai para a direita).
   */
  posicionar() {
    if (!this.host) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const lado = document.body.classList.contains('yt-lado');
    const aw = lado ? vw / 2 : vw;
    const r = ASPECTOS[this.aspecto] || 16 / 9;
    let w = aw, h = aw / r;
    if (h > vh) { h = vh; w = vh * r; }
    const x = (aw - w) / 2, y = (vh - h) / 2;
    Object.assign(this.host.style, {
      left: Math.round(x) + 'px', top: Math.round(y) + 'px',
      width: Math.round(w) + 'px', height: Math.round(h) + 'px',
    });
    this._escalarIframe(Math.round(w), Math.round(h));
  }

  /**
   * Quanto o iframe é desenhado maior (k > 1) ou menor (k < 1) que a área
   * visível, para o YouTube escolher a qualidade pedida. O host continua do
   * tamanho da área (é ele o alvo da captura); o iframe dentro dele é
   * reduzido/ampliado com transform: scale(1/k), em 2D (o Element Capture não
   * aceita transform 3D no alvo). Capturando, só reduz: para subir, quem
   * escala é o próprio Chrome (ver QUALIDADES).
   */
  _fatorQualidade(w, h) {
    // Automática capturando: o player do tamanho da captura (CURTO_AUTO). Sem isso, num Mac com
    // DPR 2 o YouTube decodificava 1440p60 para uma captura de 1080p — CPU/GPU gastos à toa
    const curto = (QUALIDADES[this.qualidade] || QUALIDADES.auto).curto || (this.stream ? CURTO_AUTO : 0);
    if (!curto || !w || !h || !suporte().captura) return 1;
    const fisico = Math.min(w, h) * (window.devicePixelRatio || 1);
    let k = curto / fisico;
    if (this.stream) k = Math.min(1, k);
    k = Math.max(0.25, Math.min(3, k));
    return Math.abs(k - 1) < 0.04 ? 1 : k;
  }

  _escalarIframe(w, h) {
    const ifr = this.host && this.host.querySelector('iframe');
    if (!ifr) return;
    const k = this._fatorQualidade(w, h);
    this.fator = k;
    if (k === 1) {
      Object.assign(ifr.style, { width: '', height: '', transform: '', transformOrigin: '' });
    } else {
      Object.assign(ifr.style, {
        width: Math.round(w * k) + 'px', height: Math.round(h * k) + 'px',
        transform: `scale(${1 / k})`, transformOrigin: '0 0',
      });
    }
  }

  /** Tamanho pedido à captura: lado curto da qualidade escolhida, na proporção do player. */
  _restricoesCaptura() {
    const curto = (QUALIDADES[this.qualidade] || QUALIDADES.auto).curto || CURTO_AUTO;
    const r = ASPECTOS[this.aspecto] || 16 / 9;
    const w = r >= 1 ? Math.round(curto * r) : curto;
    const h = r >= 1 ? curto : Math.round(curto / r);
    return { frameRate: { ideal: 30, max: 30 }, width: { ideal: w }, height: { ideal: h } };
  }

  /**
   * Troca a qualidade (guardada no aparelho). Assistindo, vale na hora (o
   * iframe muda de tamanho). Capturando, a trilha é ajustada; se o pedido
   * passar do que a captura em curso consegue, avisa para recomeçar.
   */
  async setQualidade(q) {
    if (!QUALIDADES[q]) return;
    this.qualidade = q;
    this.avisoQualidade = null;
    try { q === 'auto' ? localStorage.removeItem(QUAL_KEY) : localStorage.setItem(QUAL_KEY, q); } catch (_) { /* storage bloqueado */ }
    this.posicionar();
    const t = this.stream && this.stream.getVideoTracks()[0];
    if (t) {
      const c = this._restricoesCaptura();
      try { await t.applyConstraints(c); } catch (_) { /* fica no que estava */ }
      // o teto da trilha é o tamanho com que a captura começou
      let cap = {};
      try { cap = t.getCapabilities() || {}; } catch (_) { /* sem capabilities */ }
      const tem = Math.min((cap.width || {}).max || 0, (cap.height || {}).max || 0);
      const quer = Math.min(c.width.ideal, c.height.ideal);
      if (tem && tem < quer * 0.95) {
        this.avisoQualidade = `A captura começou num tamanho menor (até ${tem}p). ` +
          'Para subir, pare a fonte e clique «Usar como fonte» de novo.';
      }
    }
    this._avisar();
  }

  /**
   * O que está chegando de verdade: o nível que o YouTube informa (pode vir
   * vazio) e o tamanho do quadro capturado que o pipeline recebe.
   */
  get qualidadeReal() {
    const nivel = rotuloNivel(this._cmd('getPlaybackQuality'));
    const { width, height } = this.size;
    return { nivel, captura: this.stream && width ? `${width}×${height}` : '' };
  }

  /** Atrás do canvas (capturando com Element Capture) ou na frente (assistir / Region Capture). */
  _camada() {
    if (!this.host) return;
    const atras = this.modo === 'element' && !this.original;
    this.host.classList.toggle('yt-atras', atras);
    this.host.classList.toggle('yt-frente', !atras);
  }

  mostrarOriginal(v) {
    this.original = Boolean(v);
    this._camada();
    this._avisar();
  }

  // ------------------------------------------------------------ player

  /** Monta (ou troca) o vídeo no player oficial, na frente, sem capturar ainda. */
  async carregar(id, { aspecto, _tentativa = 0 } = {}) {
    if (!YT_ID.test(id || '')) throw new Error('Identificador de vídeo inválido.');
    if (aspecto && ASPECTOS[aspecto]) this.aspecto = aspecto;
    this.erro = null;
    // Safari/Firefox: janela própria. Síncrono até o window.open (precisa do clique).
    if (suporte().janela) return this._carregarJanela(id);
    if (!_tentativa && this.player && this.videoId && typeof this.player.loadVideoById === 'function') {
      this.videoId = id;
      this.posicionar();
      this.player.loadVideoById(id);
      this._avisar();
      return;
    }
    const YT = await carregarApi();
    this.fechar();

    const host = document.createElement('div');
    host.className = 'yt-host yt-frente';
    // controls 0 onde a página captura: os controles da página (painel Fonte e barra de
    // vídeo) mandam no player, e a barra/ícones do YouTube não entram nos quadros.
    // cc_load_policy 0 + _semLegenda(): o player começa mudo e o YouTube liga a
    // legenda automática sozinho — ela ficaria gravada nos quadros do pipeline.
    clearTimeout(this._vigia);
    const iframe = criarIframe(id, { host: HOSTS_PLAYER[_tentativa % HOSTS_PLAYER.length] });
    host.appendChild(iframe);
    // ANTES do #root: com a mesma camada, o Viewport (depois no DOM) pinta por cima
    const root = document.getElementById('root');
    document.body.insertBefore(host, root || document.body.firstChild);

    this.host = host;
    this.videoId = id;
    document.body.classList.add('yt-player');  // esconde o cartão de espera do Viewport (css/youtube.css)
    this.posicionar();
    window.addEventListener('resize', this._reposicionar);

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('O player do YouTube não respondeu em 20 s.')), 20000);
      this.player = new YT.Player(iframe, {
        events: {
          onReady: () => {
            clearTimeout(t);
            this._semLegenda();
            try { this.player.playVideo(); } catch (_) { /* segue */ }
            // recusa silenciosa do YouTube: sem começar em ~12 s, recria pelo outro domínio (2 vezes)
            this._vigia = setTimeout(() => {
              if (this.videoId !== id || [1, 2, 3].includes(this.estado)) return;
              if (_tentativa < 2) this.carregar(id, { aspecto, _tentativa: _tentativa + 1 }).catch(() => {});
              else { this.erro = 'O YouTube recusou tocar este vídeo agora. Tente de novo em instantes ou outro vídeo.'; this._avisar(); }
            }, ESPERA_INICIO_MS);
            resolve();
          },
          onStateChange: (e) => this._mudouEstado(e.data),
          onError: (e) => {
            if (!ERROS_DEFINITIVOS.has(e.data) && _tentativa < 2 && this.videoId === id) {
              clearTimeout(this._vigia);
              this.carregar(id, { aspecto, _tentativa: _tentativa + 1 }).catch(() => {});
              return;
            }
            this.erro = ERROS_PLAYER[e.data] || ('O player do YouTube falhou (código ' + e.data + ').');
            this._avisar();
          },
        },
      });
    });
    this._avisar();
  }

  _mudouEstado(st) {
    this.estado = st;
    this.mudouEm = performance.now();
    if (st === 1) this._semLegenda();  // o módulo de legenda volta a cada vídeo
    if (st === 0) {
      // Repetir ligado repete o vídeo atual; senão a playlist em sequência (se houver) segue
      if (store.get().loop) { this._cmd('seekTo', 0, true); this._cmd('playVideo'); this.mudouEm = performance.now(); }
      else if (!(this.aoTerminar && this.aoTerminar())) this._fim();
    }
    this._avisar();
  }

  /** Player em janela própria (modo janela). */
  get janela() { return Boolean(this.player && this.player.janela); }

  /**
   * Modo janela: abre /yt/player.html (ou troca o vídeo nela). O window.open
   * acontece ANTES de qualquer await — precisa do gesto do usuário. Se o
   * navegador bloquear, fica o erro e o painel oferece «Abrir a janela do player».
   */
  async _carregarJanela(id) {
    if (this.janela && this.videoId) {
      this.videoId = id;
      this.estado = -1;
      this.mudouEm = performance.now();
      this.player.loadVideoById(id);            // reabre a janela se a pessoa a fechou
      this._avisar();
      return;
    }
    this.fechar();
    this.videoId = id;
    const p = new PlayerJanela(id, { events: {
      onStateChange: (e) => { if (this.player === p) this._mudouEstado(e.data); },
      onError: (e) => {
        if (this.player !== p) return;
        this.erro = ERROS_PLAYER[e.data] || e.texto || ('O player do YouTube falhou (código ' + e.data + ').');
        this._avisar();
      },
    } });
    this.player = p;
    p.ouvir(() => this._avisar());
    this._avisar();
    try {
      await p.pronta();
      if (this.player === p) this.erro = null;
    } catch (err) {
      if (this.player === p) this.erro = err.message;
    }
    this._avisar();
  }

  /** Modo janela: reabre a janela do player (chamar no clique). */
  abrirJanela() {
    if (!this.janela) return false;
    this.erro = null;
    const ok = this.player.abrir();
    this.player.pronta().then(() => { this.erro = null; this._avisar(); }, (e) => { this.erro = e.message; this._avisar(); });
    this._avisar();
    return ok;
  }

  /** Modo janela: a janela está aberta e falando com o app. */
  get janelaAberta() { return this.janela && (this.player.aberta || this.player.esperando); }

  /** Comandos do player. Silenciosos se o player ainda não existe. */
  _cmd(nome, ...args) {
    const p = this.player;
    if (!p || typeof p[nome] !== 'function') return undefined;
    try { return p[nome](...args); } catch (_) { return undefined; }
  }
  /** Desliga a legenda (automática ou não): o texto entraria nos quadros capturados. */
  _semLegenda() { semLegenda(this.player); }

  /**
   * Vídeo terminou. A tela final do YouTube (título, canal, «repetir», sugestões)
   * entraria no pipeline: enquanto captura, volta para o último quadro e pausa.
   */
  _fim() {
    if (!this.stream) return;
    // getDuration arredonda para cima (639 num vídeo que acaba em 638,16): o fim real é o tempo atual
    const fimReal = this._cmd('getCurrentTime') || this._cmd('getDuration') || 0;
    if (fimReal > 1.5) this._cmd('seekTo', fimReal - 1, true);
    this._cmd('pauseVideo');
    // pausado, o player desenha os botões por cima: congela o pipeline no último quadro
    if (store.get().sourceKind === 'youtube') store.set({ running: false });
  }

  /** Tocando há mais de JANELA_UI_MS desde a última mudança: o quadro não tem a interface do YouTube. */
  get limpo() {
    return this.estado === 1 && performance.now() - this.mudouEm > JANELA_UI_MS;
  }

  play() { this._cmd('playVideo'); }
  pause() { this._cmd('pauseVideo'); }
  avancar(seg) {
    const t = this._cmd('getCurrentTime') || 0;
    const d = this._cmd('getDuration') || 0;
    this._cmd('seekTo', Math.max(0, d ? Math.min(d - 0.5, t + seg) : t + seg), true);
    this.mudouEm = performance.now();
  }
  irPara(seg) { this._cmd('seekTo', Math.max(0, seg), true); this.mudouEm = performance.now(); }
  velocidade(v) { this._cmd('setPlaybackRate', v); }
  get velocidades() { return this._cmd('getAvailablePlaybackRates') || [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]; }
  get taxa() { return this._cmd('getPlaybackRate') || 1; }
  get mudo() { return Boolean(this._cmd('isMuted')); }
  som(ligar) { if (ligar) { this._cmd('unMute'); this._cmd('setVolume', 80); } else this._cmd('mute'); }
  get tempo() { return this._cmd('getCurrentTime') || 0; }
  get duracao() { return this._cmd('getDuration') || 0; }
  get titulo() {
    const d = this._cmd('getVideoData');
    return (d && d.title) || '';
  }

  setAspecto(a) {
    if (!ASPECTOS[a]) return;
    this.aspecto = a;
    this.posicionar();
    this._avisar();
  }

  // ------------------------------------------------------------ captura

  /**
   * Captura a própria aba e recorta no player. Precisa de gesto do usuário
   * (clique): o Chrome mostra o diálogo «compartilhar esta aba».
   */
  async start() {
    const sup = suporte();
    if (!sup.captura) throw new Error(sup.motivo);
    if (!this.carregado) throw new Error('Escolha um vídeo antes.');
    this.stopCaptura();
    if (sup.captura === 'janela') return this._startJanela();

    if (sup.captura === 'region') {
      // tela dividida ANTES de capturar: o retângulo do player não pode ter o canvas por cima
      document.body.classList.add('yt-lado');
      this.posicionar();
    }

    let stream;
    try {
      // sem o ideal, o Chrome entrega a aba recortada em ~800 px de largura; o tamanho
      // pedido AQUI fixa a escala da captura (e, com ela, a qualidade que o YouTube escolhe)
      stream = await capturarAba(this.host, sup.captura, this._restricoesCaptura());
    } catch (err) {
      document.body.classList.remove('yt-lado');
      this.posicionar();
      throw err;
    }

    const trilha = stream.getVideoTracks()[0];
    this.stream = stream;
    this.modo = sup.captura;
    this.original = false;
    this.avisoQualidade = null;
    this.video.srcObject = stream;
    this._camada();
    this.posicionar();

    trilha.addEventListener('ended', () => {
      // «parar compartilhamento» na barra do navegador
      this.stopCaptura();
      if (this.onEnded) this.onEnded();
    });

    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('A captura do player não entregou vídeo em 8 s.')), 8000);
      const ok = () => {
        if (this.video.videoWidth > 0) { clearTimeout(t); this.video.removeEventListener('loadeddata', ok); resolve(); }
      };
      this.video.addEventListener('loadeddata', ok);
      this.video.play().catch(() => {});
      ok();
    }).catch((err) => { this.stopCaptura(); throw err; });

    this._avisar();
    return this.size;
  }

  /**
   * Modo janela: a pessoa escolhe a janela «Player do YouTube — iaVision» (ou
   * uma tela); o Recortador acha o vídeo na captura e entrega só ele.
   * getDisplayMedia é a primeira coisa assíncrona: ainda dentro do clique.
   */
  async _startJanela() {
    const bruto = await capturarJanela();
    const rec = new Recortador(bruto, { aspecto: ASPECTOS[this.aspecto] || 16 / 9, dica: () => this.player && this.player.geometria });
    try {
      await rec.iniciar();
    } catch (err) {
      rec.parar();
      throw err;
    }
    this.recorte = rec;
    rec.ouvir(() => this._avisar());
    this.stream = rec.saida;
    this.modo = 'janela';
    this.original = false;
    this.avisoQualidade = null;
    this.video.srcObject = rec.saida;
    bruto.getVideoTracks()[0].addEventListener('ended', () => {
      // «parar compartilhamento» do navegador (ou a janela fechou)
      this.stopCaptura();
      if (this.onEnded) this.onEnded();
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('A captura da janela não entregou vídeo em 8 s.')), 8000);
      const ok = () => {
        if (this.video.videoWidth > 0) { clearTimeout(t); clearInterval(iv); resolve(); }
      };
      const iv = setInterval(ok, 100);
      this.video.play().catch(() => {});
      ok();
    }).catch((err) => { this.stopCaptura(); throw err; });
    this._avisar();
    return this.size;
  }

  /** Modo janela: abre o «Ajustar recorte» (arrastar um retângulo sobre a captura). */
  async ajustarRecorte() {
    if (!this.recorte) return false;
    const ok = await ajustarRecorte(this.recorte);
    this._avisar();
    return ok;
  }

  /** Para só a captura; o player continua (na frente, para assistir). */
  stopCaptura() {
    if (this.recorte) { this.recorte.parar(); this.recorte = null; }
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.modo = null;
    this.original = false;
    document.body.classList.remove('yt-lado');
    this.posicionar();
    this._camada();
    this._avisar();
  }

  /** Contrato das fontes: parar = soltar a captura e fechar o player. */
  stop() { this.fechar(); }

  fechar() {
    clearTimeout(this._vigia);
    this.stopCaptura();
    if (this.player && typeof this.player.destroy === 'function') {
      try { this.player.destroy(); } catch (_) { /* já destruído */ }
    }
    this.player = null;
    if (this.host) this.host.remove();
    this.host = null;
    this.videoId = null;
    this.estado = -1;
    document.body.classList.remove('yt-player');
    window.removeEventListener('resize', this._reposicionar);
    this._avisar();
  }

  /**
   * Quadro LIMPO (sem overlay) do stream capturado, em JPEG.
   * Vem da trilha, não do canvas de exibição — é o que vai para o treino.
   */
  async quadroJpeg(maxW = 1920, qualidade = 0.92) {
    const el = this.element;
    if (!el) return null;
    const q = await quadroJpegDe(el, maxW, qualidade);
    return q ? { ...q, t: this.tempo, videoId: this.videoId } : null;
  }
}

// ---------------------------------------------------------------- quadros coletados

/**
 * Quadros coletados para treino. Fica no módulo (e não no estado do painel)
 * para sobreviver a fechar e reabrir o painel Fonte.
 */
export const MAX_QUADROS = 300;

export const quadros = {
  lista: [],
  subs: new Set(),
  seq: 0,
  ouvir(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  _avisar() { for (const fn of this.subs) fn(this.lista); },
  adicionar(q) {
    if (this.lista.length >= MAX_QUADROS) return false;
    const n = ++this.seq;
    const nome = `yt-${q.videoId}-${String(Math.floor(q.t)).padStart(5, '0')}s-${String(n).padStart(3, '0')}.jpg`;
    this.lista = [...this.lista, { ...q, id: n, nome, url: URL.createObjectURL(q.blob) }];
    this._avisar();
    return true;
  },
  remover(id) {
    const q = this.lista.find((x) => x.id === id);
    if (q) URL.revokeObjectURL(q.url);
    this.lista = this.lista.filter((x) => x.id !== id);
    this._avisar();
  },
  limpar() {
    for (const q of this.lista) URL.revokeObjectURL(q.url);
    this.lista = [];
    this._avisar();
  },
};

// ---------------------------------------------------------------- ZIP (store, sem compressão)

let tabelaCrc = null;
function crc32(buf) {
  if (!tabelaCrc) {
    tabelaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      tabelaCrc[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = tabelaCrc[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * ZIP «store» (sem compressão — JPEG já é comprimido) com os arquivos dados.
 * arquivos: [{ nome, blob }]. Devolve um Blob application/zip.
 */
export async function zipStore(arquivos) {
  const enc = new TextEncoder();
  const partes = [];
  const central = [];
  let off = 0;
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  for (const a of arquivos) {
    const dados = new Uint8Array(await a.blob.arrayBuffer());
    const nome = enc.encode(a.nome);
    const crc = crc32(dados);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true); loc.setUint16(10, hora, true); loc.setUint16(12, data, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, dados.length, true); loc.setUint32(22, dados.length, true);
    loc.setUint16(26, nome.length, true); loc.setUint16(28, 0, true);
    partes.push(loc.buffer, nome, dados);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, hora, true);
    cen.setUint16(14, data, true); cen.setUint32(16, crc, true); cen.setUint32(20, dados.length, true);
    cen.setUint32(24, dados.length, true); cen.setUint16(28, nome.length, true);
    cen.setUint32(42, off, true);
    central.push(cen.buffer, nome);
    off += 30 + nome.length + dados.length;
  }
  const tamCentral = central.reduce((s, p) => s + (p.byteLength || p.length), 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, off, true);
  return new Blob([...partes, ...central, fim.buffer], { type: 'application/zip' });
}

export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
