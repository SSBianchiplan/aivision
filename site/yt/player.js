/* iaVision · /yt/player.html — o player oficial do YouTube numa janela só dele.
   Script clássico, sem dependências do app (esta página não é isolada; o app é).
   Protocolo (BroadcastChannel 'aiv-yt-janela', mensagens com a «sessão» da URL):
     app → janela  { s, para: 'janela', tipo: 'carregar', id }
                   { s, para: 'janela', tipo: 'cmd', nome, args }      (lista CMDS abaixo)
                   { s, para: 'janela', tipo: 'fechar' } · { s, para: 'janela', tipo: 'ping' }
     janela → app  { s, de: 'janela', tipo: 'estado', ... }          (4×/s e a cada evento)
                   { s, de: 'janela', tipo: 'evento', nome: 'ready'|'state'|'error', dados }
                   { s, de: 'janela', tipo: 'fechou' }
   Nada é baixado do YouTube: o vídeo toca aqui, no player oficial; o app tira os quadros
   capturando ESTA janela (getDisplayMedia), no navegador da própria pessoa. */
'use strict';
(function () {
  const CANAL = 'aiv-yt-janela';
  const YT_ID = /^[A-Za-z0-9_-]{11}$/;
  // os mesmos do núcleo (js/camera/youtube-nucleo.js): o YouTube às vezes recusa a reprodução
  // embutida sem avisar («Ocorreu um erro… ID de reprodução»); tenta de novo pelo outro domínio
  const HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com'];
  const DEFINITIVOS = [100, 101, 150];
  const ESPERA_INICIO_MS = 12000;
  // comandos que o app pode mandar (os nomes da IFrame API)
  const CMDS = ['playVideo', 'pauseVideo', 'seekTo', 'setPlaybackRate', 'mute', 'unMute', 'setVolume', 'stopVideo'];

  const q = new URLSearchParams(location.search);
  const sessao = q.get('s') || '';
  const controles = q.get('c') === '1';
  let videoId = YT_ID.test(q.get('v') || '') ? q.get('v') : '';
  let inicio = Math.max(0, parseFloat(q.get('t')) || 0);
  let player = null, pronto = false, estado = -1, tentativa = 0, vigia = 0, api = null;

  const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CANAL) : null;
  const enviar = (m) => { if (canal) { try { canal.postMessage(Object.assign({ s: sessao, de: 'janela' }, m)); } catch (_) { /* fechando */ } } };
  const cmd = (nome, ...a) => { if (!player || typeof player[nome] !== 'function') return undefined; try { return player[nome](...a); } catch (_) { return undefined; } };

  function semLegenda() {
    for (const [nome, ...args] of [['setOption', 'captions', 'track', {}], ['unloadModule', 'captions'], ['unloadModule', 'cc']]) cmd(nome, ...args);
  }

  /** Tudo o que o app precisa para responder na hora (getters síncronos lá). */
  function estadoAtual() {
    const d = cmd('getVideoData') || {};
    return {
      tipo: 'estado', videoId, pronto, estado, tentativa, host: HOSTS[tentativa % HOSTS.length],
      t: cmd('getCurrentTime') || 0, d: cmd('getDuration') || 0, taxa: cmd('getPlaybackRate') || 1,
      taxas: cmd('getAvailablePlaybackRates') || null, mudo: Boolean(cmd('isMuted')),
      titulo: d.title || '', autor: d.author || '', qualidade: cmd('getPlaybackQuality') || '',
      // geometria da janela: dica para achar o vídeo dentro da captura (barra de título etc.)
      jan: { iw: innerWidth, ih: innerHeight, ow: outerWidth, oh: outerHeight, dpr: devicePixelRatio || 1 },
      ts: Date.now(),
    };
  }
  const publicar = () => enviar(estadoAtual());

  function carregarApi() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (api) return api;
    api = new Promise((resolve, reject) => {
      const t = setTimeout(() => { api = null; reject(new Error('O player do YouTube não carregou (rede ou bloqueador de conteúdo?).')); }, 15000);
      window.onYouTubeIframeAPIReady = () => { clearTimeout(t); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { clearTimeout(t); api = null; reject(new Error('Não foi possível carregar o player do YouTube.')); };
      document.head.appendChild(s);
    });
    return api;
  }

  function erro(codigo, texto) {
    enviar({ tipo: 'evento', nome: 'error', dados: codigo, texto: texto || '' });
    publicar();
  }

  /** Cria (ou recria, na nova tentativa) o player para `id`, começando em `de` segundos. */
  async function montar(id, de) {
    let YT;
    try { YT = await carregarApi(); } catch (e) { erro('api', e.message); return; }
    if (id !== videoId) return;                       // trocaram de vídeo enquanto carregava
    clearTimeout(vigia);
    if (player) { try { player.destroy(); } catch (_) { /* já destruído */ } }
    player = null; pronto = false; estado = -1;
    const box = document.getElementById('player');
    box.replaceChildren();
    const ifr = document.createElement('iframe');
    ifr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    ifr.title = 'Player do YouTube';
    ifr.referrerPolicy = 'strict-origin-when-cross-origin';
    const p = new URLSearchParams({
      enablejsapi: '1', origin: location.origin, playsinline: '1', rel: '0', iv_load_policy: '3',
      modestbranding: '1', autoplay: '1', mute: '1', controls: controles ? '1' : '0', cc_load_policy: '0',
      disablekb: controles ? '0' : '1',
    });
    if (de > 0.5) p.set('start', String(Math.floor(de)));
    ifr.src = `https://${HOSTS[tentativa % HOSTS.length]}/embed/${id}?${p}`;
    box.appendChild(ifr);
    document.getElementById('espera').hidden = true;
    const essa = tentativa;
    player = new YT.Player(ifr, { events: {
      onReady: () => {
        pronto = true;
        semLegenda();
        cmd('playVideo');
        enviar({ tipo: 'evento', nome: 'ready' });
        publicar();
        // recusa silenciosa: sem começar em ~12 s, recria pelo outro domínio (2 vezes)
        vigia = setTimeout(() => { if (id === videoId && essa === tentativa && ![1, 2, 3].includes(estado)) recusou(id); }, ESPERA_INICIO_MS);
      },
      onStateChange: (e) => {
        estado = e.data;
        if (e.data === 1) { clearTimeout(vigia); semLegenda(); }
        enviar({ tipo: 'evento', nome: 'state', dados: e.data });
        publicar();
      },
      onError: (e) => {
        if (DEFINITIVOS.includes(e.data)) { clearTimeout(vigia); erro(e.data); return; }
        recusou(id, e.data);
      },
    } });
  }

  function recusou(id, codigo) {
    if (id !== videoId) return;
    clearTimeout(vigia);
    if (tentativa < 2) { tentativa++; montar(id, cmd('getCurrentTime') || inicio); return; }
    erro(codigo || 'recusa', 'O YouTube recusou tocar este vídeo agora.');
  }

  function abrir(id, de) {
    if (!YT_ID.test(id || '')) return;
    videoId = id; inicio = de || 0; tentativa = 0;
    document.title = 'Player do YouTube — iaVision';
    if (player && pronto && typeof player.loadVideoById === 'function') {
      clearTimeout(vigia);
      estado = -1;
      try { player.loadVideoById({ videoId: id, startSeconds: inicio }); } catch (_) { montar(id, inicio); return; }
      const essa = tentativa;
      vigia = setTimeout(() => { if (id === videoId && essa === tentativa && ![1, 2, 3].includes(estado)) recusou(id); }, ESPERA_INICIO_MS);
      publicar();
      return;
    }
    montar(id, inicio);
  }

  if (canal) {
    canal.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.para !== 'janela' || m.s !== sessao) return;
      if (m.tipo === 'carregar') abrir(m.id, m.inicio);
      else if (m.tipo === 'cmd' && CMDS.includes(m.nome)) { cmd(m.nome, ...(Array.isArray(m.args) ? m.args : [])); setTimeout(publicar, 60); }
      else if (m.tipo === 'fechar') {
        enviar({ tipo: 'fechou' });
        window.close();
        // o navegador pode recusar (a janela perdeu o vínculo com o app por causa do COOP): para o vídeo e avisa
        setTimeout(() => {
          clearTimeout(vigia);
          if (player) { try { player.destroy(); } catch (_) { /* já destruído */ } }
          player = null; pronto = false; estado = -1; videoId = '';
          document.getElementById('player').replaceChildren();
          const e = document.getElementById('espera');
          e.textContent = 'O iaVision fechou o player. Pode fechar esta janela.';
          e.hidden = false;
        }, 300);
      }
      else if (m.tipo === 'ping') publicar();
    };
  }
  setInterval(publicar, 250);
  addEventListener('pagehide', () => enviar({ tipo: 'fechou' }));
  addEventListener('resize', publicar);
  // as teclas da página não vão para o player (disablekb): espaço/setas daqui também comandam
  addEventListener('keydown', (e) => {
    if (!player || e.target !== document.body) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); if (estado === 1) cmd('pauseVideo'); else cmd('playVideo'); }
    else if (e.key === 'ArrowLeft') cmd('seekTo', Math.max(0, (cmd('getCurrentTime') || 0) - 10), true);
    else if (e.key === 'ArrowRight') cmd('seekTo', (cmd('getCurrentTime') || 0) + 10, true);
    else return;
    setTimeout(publicar, 60);
  });

  if (videoId) abrir(videoId, inicio);
  publicar();
})();
