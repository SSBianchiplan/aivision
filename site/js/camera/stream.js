/**
 * camera/stream.js — fonte de vídeo vinda de RTMP, via WebRTC.
 *
 * ================= O CAMINHO QUE O VÍDEO PERCORRE =================
 *
 *   Osmo Pocket 3 ──Wi-Fi──▶ MediaMTX ──WebRTC──▶ este navegador
 *      (app Mimo)             (seu PC)              (o pipeline)
 *        RTMP                  :1935                 :8889/whep
 *
 * O navegador NÃO toca RTMP — o protocolo morreu com o Flash, e não há
 * biblioteca que resolva isso, porque é TCP puro e não HTTP. Alguém tem que
 * converter, e é o que o MediaMTX faz.
 *
 * A saída escolhida é WebRTC (WHEP) e não HLS por causa da latência: HLS
 * entrega em 6 a 30 segundos, WebRTC em menos de um. Num sistema de visão
 * isso decide se a caixa de detecção descreve a cena atual ou uma que já
 * passou.
 *
 * WHEP é só HTTP: um POST com a oferta SDP, uma resposta com a resposta SDP.
 * Não precisa de biblioteca — RTCPeerConnection é nativo em todo navegador
 * que nos interessa.
 *
 * ================= A RESTRIÇÃO QUE VOCÊ VAI ENCONTRAR =================
 *
 * Uma página servida por HTTPS não pode falar com http://192.168.x.x — o
 * navegador bloqueia como conteúdo misto, e não há como contornar do lado
 * do código. Então o RTMP funciona a partir da instalação LOCAL
 * (http://localhost:8001), não do site publicado. Isso está dito na
 * interface, porque descobrir sozinho custa uma hora.
 * ======================================================================
 */

/** hls.js vendorizado, carregado só quando um navegador sem HLS nativo precisa. */
let hlsPromise = null;
function carregarHlsJs() {
  if (window.Hls) return Promise.resolve();
  if (hlsPromise) return hlsPromise;
  hlsPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'vendor/hls.js';
    el.async = true;
    el.onload = () => (window.Hls ? resolve() : reject(new Error('hls.js carregou sem expor window.Hls')));
    el.onerror = () => reject(new Error('Falha ao carregar vendor/hls.js'));
    document.head.appendChild(el);
  });
  return hlsPromise;
}

export const PADRAO = {
  host: '',            // IP da máquina na rede local (o que o Osmo alcança)
  webrtcPort: 8889,
  hlsPort: 8888,
  rtmpPort: 1935,
  path: 'live/stream',
  /*
   * Servidor de mídia por HTTPS — a URL do túnel (tools/tunel.cmd).
   *
   * Quando preenchido, a negociação WebRTC e o HLS saem por ele em vez do
   * IP local: HTTPS falando com HTTPS, e o bloqueio de conteúdo misto que
   * impedia o site publicado de usar o RTMP deixa de existir. O `host`
   * continua importando para o app da câmera, que publica pela rede local.
   */
  base: '',
};

/** Normaliza a URL do túnel: https, sem barra final, sem caminho residual. */
export function baseHttps(cfg) {
  let b = String((cfg && cfg.base) || '').trim();
  if (!b) return '';
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  try {
    const u = new URL(b);
    return u.origin;          // só a origem: quem cola "…/live/stream" não quebra nada
  } catch (_) {
    return '';
  }
}

/**
 * A página está em HTTPS e o servidor de mídia em HTTP? Então é bloqueio.
 *
 * Esta função já abriu exceção para localhost, pela ideia — comum e errada —
 * de que o navegador trata a origem de loopback como confiável e portanto
 * deixaria passar. MEDIDO na origem real (https://aivision.gplansis.com,
 * Edge headless, fetch para o MediaMTX na mesma máquina):
 *
 *     localhost:8889   Failed to fetch
 *     127.0.0.1:8889   Failed to fetch
 *     192.168.0.114    Failed to fetch
 *
 * Os três bloqueados. A carve-out de loopback existe para o que conta como
 * "origem potencialmente confiável" — outra coisa —, e o Private Network
 * Access ainda exigiria do servidor um cabeçalho que o MediaMTX não manda.
 *
 * Então: página em HTTPS não fala com servidor de mídia em HTTP, ponto. A
 * exceção antiga só servia para deixar o usuário tentar e receber um
 * "Failed to fetch" sem explicação.
 */
export function conteudoMisto(host, cfg) {
  if (location.protocol !== 'https:') return false;
  // câmera Wi-Fi / IP: o endereço WHEP completo decide (camera/seletor.js)
  if (cfg && cfg.whep) return /^http:/i.test(cfg.whep);
  // com túnel HTTPS não há mistura: a mídia vem pela mesma classe de origem
  if (cfg && baseHttps(cfg).startsWith('https://')) return false;
  return Boolean(String(host || '').trim());
}

/*
 * Com túnel, as URLs passam pelo proxy do roteador local (/media/whep e
 * /media/hls, ver tools/router.php), que encaminha para o MediaMTX. Sem
 * túnel, vão direto às portas dele no IP da rede.
 */
export function urlWhep(cfg) {
  // câmera Wi-Fi / IP: endereço WHEP completo, como o MediaMTX publica (…:8889/cam1/whep)
  if (cfg && cfg.whep) return cfg.whep;
  const b = baseHttps(cfg);
  if (b) return `${b}/media/whep/${cfg.path}/whep`;
  return `http://${cfg.host}:${cfg.webrtcPort}/${cfg.path}/whep`;
}

export function urlHls(cfg) {
  const b = baseHttps(cfg);
  if (b) return `${b}/media/hls/${cfg.path}/index.m3u8`;
  return `http://${cfg.host}:${cfg.hlsPort}/${cfg.path}/index.m3u8`;
}

/**
 * O endereço é de rede local?
 *
 * Existe porque o padrão do painel era `location.hostname`, e quando alguém
 * abre o SITE PUBLICADO isso vira `aivision.gplansis.com` — que o usuário
 * então copia para o app da câmera e tenta publicar em
 * `rtmp://aivision.gplansis.com:1935`. Não existe servidor RTMP nesse
 * endereço, e a mensagem de erro do app da câmera é «falha ao conectar»,
 * que não ajuda em nada. Melhor detectar e dizer.
 */
export function ehRedeLocal(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  if (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  // 172.16.0.0 – 172.31.255.255
  const m = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (h.endsWith('.local')) return true;       // mDNS/Bonjour
  return false;
}

export function urlRtmp(cfg) {
  // o que se digita no Mimo: endereço e chave separados
  const partes = String(cfg.path).split('/');
  const chave = partes.pop();
  const base = partes.join('/') || 'live';
  return { servidor: `rtmp://${cfg.host}:${cfg.rtmpPort}/${base}`, chave };
}

/**
 * ==================== DIAGNÓSTICO ====================
 *
 * "Não conectou" pode ser cinco coisas muito diferentes, e a diferença entre
 * elas é a diferença entre resolver em 30 segundos e passar uma hora. Esta
 * função testa cada elo na ordem e devolve o PRIMEIRO que quebrou:
 *
 *   1. página em HTTPS falando com servidor HTTP  → bloqueio do navegador
 *   2. servidor não responde                      → não subiu, ou firewall
 *   3. servidor responde mas o caminho não existe → a câmera não publicou
 *   4. tudo certo                                 → é só clicar em Conectar
 *
 * O teste de alcance é um GET no endpoint WHEP. O MediaMTX responde 405
 * (método não permitido) — o que é uma resposta perfeitamente boa aqui,
 * porque prova que ele está de pé e que o CORS deixa a página falar com ele.
 * =====================================================
 */
export async function diagnosticar(cfg) {
  const c = { ...PADRAO, ...cfg };
  const passos = [];
  const add = (nome, estado, detalhe) => passos.push({ nome, estado, detalhe });

  if (!c.host) {
    add('Endereço', 'erro', 'Informe o IP da máquina que roda o MediaMTX.');
    return { ok: false, passos };
  }

  const tunel = baseHttps(c);
  if (conteudoMisto(c.host, c)) {
    add('Origem da página', 'erro',
        'A página está em HTTPS e o servidor de mídia em HTTP. O navegador ' +
        'bloqueia, e não há contorno pelo código. Abra o iaVision pela ' +
        'instalação local (http://localhost:8001).');
    return { ok: false, passos };
  }
  add('Origem da página', 'ok', location.origin);

  if (tunel) {
    add('Túnel HTTPS', 'ok', tunel);
  } else if (!ehRedeLocal(c.host)) {
    add('Endereço do servidor', 'erro',
        `"${c.host}" não é um endereço de rede local. O MediaMTX roda na SUA ` +
        'máquina, então aqui vai o IP dela na Wi-Fi (algo como 192.168.0.114), ' +
        'nunca o domínio do site. O tools/rtmp.cmd mostra o IP certo na tela.');
    return { ok: false, passos };
  }
  if (!tunel) add('Endereço do servidor', 'ok', `${c.host} é da rede local`);

  // ---- 2. o servidor está de pé e alcançável?
  const alvo = urlWhep(c);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(alvo, { method: 'GET', signal: ctrl.signal });
    clearTimeout(t);
    add('Servidor de mídia', 'ok',
        (tunel ? 'túnel' : `${c.host}:${c.webrtcPort}`) + ` respondeu (HTTP ${r.status})`);
  } catch (_) {
    /*
     * fetch não distingue "recusou" de "bloqueado por CORS" de "sumiu no
     * firewall" — o navegador esconde isso de propósito. Então listamos as
     * três causas, em ordem de frequência real.
     */
    add('Servidor de mídia', 'erro', tunel
        ? `Não alcancei o túnel ${tunel}. Ou o tools/tunel.cmd não está ` +
          'rodando, ou a URL mudou — ela é nova a cada execução; copie a que ' +
          'está na janela dele.'
        : `Não alcancei ${c.host}:${c.webrtcPort}. Em ordem de probabilidade: ` +
          '(1) o tools/rtmp.cmd não está rodando; (2) o Firewall do Windows ' +
          'não foi liberado — rode o rtmp.cmd como administrador; (3) o IP ' +
          'está errado (o rtmp.cmd mostra o certo na tela).');
    return { ok: false, passos };
  }

  // ---- 3. alguém está publicando neste caminho?
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.addTransceiver('video', { direction: 'recvonly' });
    const o = await pc.createOffer();
    await pc.setLocalDescription(o);
    const r = await fetch(alvo, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body: pc.localDescription.sdp,
    });
    // a sessão criada pelo teste tem que morrer, senão fica pendurada no servidor
    if (r.ok) {
      const loc = r.headers.get('location');
      if (loc) {
        const url = new URL(loc, alvo).href;
        fetch(url, { method: 'DELETE' }).catch(() => {});
      }
    }
    try { pc.close(); } catch (_) { /* já fechada */ }

    if (r.status === 404) {
      add('Transmissão', 'erro',
          `O servidor está de pé, mas ninguém está publicando em "${c.path}". ` +
          'Inicie a transmissão no app DJI Mimo (Transmissão ao vivo › RTMP ' +
          'Personalizado) e teste de novo. Se o Mimo diz que está transmitindo, ' +
          'o celular não está alcançando a porta 1935 — é firewall.');
      return { ok: false, passos };
    }
    if (!r.ok) {
      add('Transmissão', 'erro', `O servidor recusou a negociação (HTTP ${r.status}).`);
      return { ok: false, passos };
    }
    add('Transmissão', 'ok', `"${c.path}" está no ar`);
  } catch (err) {
    add('Transmissão', 'erro', String((err && err.message) || err));
    return { ok: false, passos };
  }

  return { ok: true, passos };
}

/**
 * Fonte de stream. Expõe `element` e `size` como CameraSource e FileSource —
 * é o contrato que deixa o Viewport tratar as três sem saber a diferença.
 */
export class StreamSource {
  constructor() {
    this.video = document.createElement('video');
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;          // autoplay só é permitido sem som
    this.video.controls = false;
    /*
     * CORS no elemento. Sem isto, capturar o áudio do HLS com WebAudio
     * (cv/audio.js) produz silêncio absoluto e nenhum erro — mídia de outra
     * origem sem CORS entra "opaca" no grafo. O servidor de mídia já manda
     * Access-Control-Allow-Origin; este atributo é o outro lado do aperto.
     */
    this.video.crossOrigin = 'anonymous';
    this.pc = null;
    this.cfg = null;
    this.sessao = null;               // URL da sessão WHEP, para encerrar direito
    this.estado = 'parado';           // parado | conectando | ao-vivo | erro
    this.erro = null;
    this.onEstado = null;
  }

  get kind() { return 'stream'; }

  get element() {
    return this.pc && this.video.readyState >= 2 ? this.video : null;
  }

  get size() {
    return { width: this.video.videoWidth || 0, height: this.video.videoHeight || 0 };
  }

  get isRunning() {
    return this.estado === 'ao-vivo';
  }

  #setEstado(e, erro = null) {
    this.estado = e;
    this.erro = erro;
    if (this.onEstado) this.onEstado(e, erro);
  }

  /** Conecta ao endpoint WHEP do MediaMTX. */
  async connect(cfg) {
    this.disconnect();
    this.cfg = { ...PADRAO, ...cfg };

    if (conteudoMisto(this.cfg.host, this.cfg)) {
      const e = 'Esta página está em HTTPS e o servidor de mídia em HTTP. ' +
                'O navegador bloqueia essa combinação — inclusive para ' +
                'localhost, que foi verificado. Abra o iaVision pela ' +
                'instalação local (http://localhost:8001) para usar o RTMP.';
      this.#setEstado('erro', e);
      throw new Error(e);
    }

    this.#setEstado('conectando');
    this.modo = 'webrtc';

    /*
     * Sem servidores ICE: o celular e o computador estão na mesma rede.
     * Consultar um STUN público só acrescentaria uma viagem à internet a
     * uma negociação que se resolve localmente.
     */
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    this.pc = pc;

    // WHEP é só recepção
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.ontrack = (e) => {
      if (e.streams && e.streams[0]) this.video.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const s = pc.connectionState;
      if (s === 'connected') this.#setEstado('ao-vivo');
      else if (s === 'failed') this.#setEstado('erro', 'A conexão WebRTC falhou.');
      else if (s === 'disconnected' || s === 'closed') this.#setEstado('parado');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    /*
     * Espera a coleta de candidatos ICE terminar antes de mandar a oferta.
     * WHEP não tem canal para trickle ICE, então a oferta precisa já conter
     * todos os candidatos. Com teto de 1,5 s: em rede local eles aparecem em
     * milissegundos, e esperar o `complete` de verdade pode travar quando
     * uma interface não responde.
     */
    await this.#esperarIce(pc, 1500);

    const url = urlWhep(this.cfg);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
      });
    } catch (err) {
      this.disconnect();
      const e = this.cfg.origem === 'ip'
        ? `Não alcancei ${url}. O MediaMTX está rodando nesta máquina, com o trecho ` +
          'do mediamtx.yml colado e reiniciado depois? (no terminal dele aparece ' +
          '«[WebRTC] listener opened on :8889»)'
        : `Não alcancei ${url}. Verifique se o MediaMTX está rodando e ` +
          'se o firewall do Windows liberou as portas 1935 e 8889.';
      this.#setEstado('erro', e);
      throw new Error(e);
    }

    if (res.status === 404) {
      this.disconnect();
      const e = this.cfg.origem === 'ip'
        ? `O MediaMTX respondeu, mas o caminho "${this.cfg.path}" não tem vídeo. ` +
          'Confira se o nome é o mesmo de «paths:» no mediamtx.yml e, no terminal ' +
          'do MediaMTX, se a câmera aceitou o IP, o usuário, a senha e o caminho RTSP.'
        : `O caminho "${this.cfg.path}" não existe no servidor. ` +
          'Isso significa que o Osmo ainda não começou a transmitir — ' +
          'inicie a transmissão no app Mimo e tente de novo.';
      this.#setEstado('erro', e);
      throw new Error(e);
    }
    if (!res.ok) {
      this.disconnect();
      const e = `O servidor recusou (HTTP ${res.status}).`;
      this.#setEstado('erro', e);
      throw new Error(e);
    }

    /*
     * O WHEP devolve em Location a URL desta sessão. Guardar é o que permite
     * encerrá-la de verdade no disconnect: sem isso o MediaMTX só a derruba
     * por tempo esgotado, e nesse intervalo ela continua contando como leitor
     * do caminho.
     */
    const loc = res.headers.get('location');
    this.sessao = loc ? new URL(loc, url).href : null;

    const answer = await res.text();
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    try {
      await this.#esperarFrame(8000);
    } catch (err) {
      /*
       * ================= POR QUE CAIR PARA HLS =================
       *
       * O WebRTC negocia pelo túnel, mas a MÍDIA vai direto do PC ao
       * navegador. Na mesma Wi-Fi isso fecha em milissegundos. De outra
       * rede — 4G, outro escritório — os candidatos ICE são IPs privados
       * que o navegador não alcança, e a conexão fica em «connecting» até
       * morrer. Sem túnel TCP para a mídia, não há como o WebRTC atravessar.
       *
       * O HLS é HTTP puro: passa inteiro pelo túnel. Custa 1 a 3 s de
       * atraso, mas é a diferença entre ver a câmera e não ver nada. Só
       * tentamos quando há túnel: no caminho local (http://192.168…) um
       * WebRTC que falhou é firewall ou stream parado, e o HLS falharia
       * pelo mesmo motivo.
       */
      if (!baseHttps(this.cfg)) throw err;
      this.#fecharPc();
      await this.#conectarHls();
    }
    return this.size;
  }

  #fecharPc() {
    if (this.sessao) {
      fetch(this.sessao, { method: 'DELETE' }).catch(() => {});
      this.sessao = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (_) { /* já fechada */ }
      this.pc = null;
    }
  }

  /**
   * Reprodução HLS pelo túnel.
   *
   * Safari (macOS e iOS) toca HLS nativamente no <video>. Chrome, Edge e
   * Firefox não — para eles carregamos o hls.js vendorizado, sob demanda.
   * A ordem é essa de propósito: onde há suporte nativo, a biblioteca só
   * adicionaria 200 KB e uma camada de bugs em cima de algo que já funciona.
   */
  async #conectarHls() {
    const v = this.video;
    const url = urlHls(this.cfg);
    this.modo = 'hls';
    this.#setEstado('conectando');

    if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
    } else {
      await carregarHlsJs();
      const H = window.Hls;
      if (!H || !H.isSupported()) {
        const e = 'Este navegador não toca HLS e o WebRTC não completou. ' +
                  'Na mesma Wi-Fi do PC o WebRTC funciona; fora dela, use Safari ou Chrome.';
        this.#setEstado('erro', e);
        throw new Error(e);
      }
      this.hls = new H({
        lowLatencyMode: true,
        liveSyncDurationCount: 2,       // fica perto da borda: menos atraso
        enableWorker: true,
      });
      this.hls.loadSource(url);
      this.hls.attachMedia(v);
    }

    /*
     * `element` só devolve o vídeo quando há um pc aberto; em HLS não há.
     * Um marcador cumpre o contrato do Viewport sem mentir sobre o modo.
     */
    this.pc = { hls: true, close() {} };
    await this.#esperarFrame(15000);
    this.#setEstado('ao-vivo');
  }

  #esperarIce(pc, timeoutMs) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener('icegatheringstatechange', check);
        clearTimeout(t);
        resolve();
      };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, timeoutMs);
      pc.addEventListener('icegatheringstatechange', check);
    });
  }

  /** Sem o primeiro frame decodificado, videoWidth é 0 e o canvas sai vazio. */
  #esperarFrame(timeoutMs) {
    const v = this.video;
    if (v.readyState >= 2 && v.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = () => {
        if (v.videoWidth > 0) {
          v.removeEventListener('loadeddata', ok);
          clearTimeout(t);
          resolve();
        }
      };
      const t = setTimeout(() => {
        v.removeEventListener('loadeddata', ok);
        if (v.videoWidth > 0) return resolve();
        reject(new Error(this.cfg && this.cfg.origem === 'ip'
          ? 'Conectou ao MediaMTX, mas nenhum vídeo chegou. A câmera pode estar em ' +
            'H.265 (HEVC), que o WebRTC do navegador não toca: mude o stream para ' +
            'H.264 no app da câmera (o «substream» costuma ser H.264).'
          : 'Conectou, mas nenhum vídeo chegou em 8 s. ' +
            'A transmissão no Mimo está mesmo ativa?'));
      }, timeoutMs);
      v.addEventListener('loadeddata', ok);
      v.play().catch(() => {});
    });
  }

  disconnect() {
    if (this.sessao) {
      // sem await: fechar a fonte não pode esperar a rede
      fetch(this.sessao, { method: 'DELETE' }).catch(() => {});
      this.sessao = null;
    }
    if (this.hls) {
      try { this.hls.destroy(); } catch (_) { /* já destruído */ }
      this.hls = null;
    }
    if (this.pc) {
      try { this.pc.close(); } catch (_) { /* já fechada */ }
      this.pc = null;
    }
    this.video.removeAttribute('src');
    if (this.video.srcObject) {
      for (const t of this.video.srcObject.getTracks()) t.stop();
      this.video.srcObject = null;
    }
    this.#setEstado('parado');
  }

  /** Estatísticas ao vivo, para a interface mostrar se está mesmo chegando. */
  async stats() {
    if (!this.pc) return null;
    if (this.modo === 'hls') {
      const v = this.video;
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      return {
        fps: 0, kbps: 0, perdidos: q ? q.droppedVideoFrames : 0, jitter: null,
        modo: 'HLS pelo túnel (1–3 s de atraso)',
      };
    }
    try {
      const r = await this.pc.getStats();
      let inb = null;
      r.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') inb = s;
      });
      if (!inb) return null;
      return {
        fps: Math.round(inb.framesPerSecond || 0),
        kbps: Math.round(((inb.bytesReceived || 0) * 8) / 1000),
        perdidos: inb.packetsLost || 0,
        jitter: inb.jitter ? (inb.jitter * 1000).toFixed(0) : null,
      };
    } catch (_) {
      return null;
    }
  }
}
