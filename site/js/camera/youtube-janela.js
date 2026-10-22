/**
 * camera/youtube-janela.js — o YouTube como fonte no Safari e no Firefox:
 * player em JANELA PRÓPRIA + captura dessa janela, recortada no vídeo.
 *
 * ================= POR QUE UMA JANELA =================
 *
 *   O app é isolado (COOP same-origin + COEP require-corp: threads do ONNX
 *   Runtime). Num documento assim, o embed do YouTube só carrega como
 *   `<iframe credentialless>` — e isso só existe no Chrome/Edge 110+. No
 *   Safari e no Firefox o player falha («Ocorreu um erro…»). E recortar a
 *   captura da própria aba no player (Element/Region Capture) também é só
 *   do Chromium.
 *
 *   Saída: o player toca em /yt/player.html, página do MESMO site servida
 *   SEM os cabeçalhos de isolamento (o Caddy os retira em /yt/*), aberta
 *   com window.open. O COOP do app corta o vínculo com a janela aberta
 *   (window.opener some e a referência devolvida não serve), mas o
 *   BroadcastChannel é por origem: app e janela conversam por ele.
 *
 *   PlayerJanela imita a parte da IFrame API (YT.Player) que o app usa —
 *   getPlayerState, getCurrentTime, seekTo, playVideo… — com o estado que a
 *   janela publica 4×/s. Assim YouTubeSource, a barra de vídeo, as teclas de
 *   mídia, as playlists e o Treinar usam a janela sem saber disso.
 *
 *   Captura: getDisplayMedia comum (o Safari e o Firefox oferecem janela ou
 *   tela). A pessoa escolhe a janela «Player do YouTube — iaVision»; o
 *   Recortador acha o retângulo do vídeo nas primeiras imagens (tira a barra
 *   de título e as faixas pretas) e entrega um MediaStream só com o vídeo
 *   (canvas.captureStream). «Ajustar recorte» deixa marcar à mão; o recorte
 *   manual fica guardado na sessão.
 *
 *   Nada é baixado do YouTube: o vídeo toca no player oficial; os quadros
 *   são da tela, tirados no navegador da própria pessoa.
 * =====================================================
 *
 * Sem dependências (o Treinar, página sem React nem store, usa via youtube-nucleo.js).
 */

export const CANAL = 'aiv-yt-janela';
export const TITULO_JANELA = 'Player do YouTube — iaVision';
export const URL_JANELA = '/yt/player.html';
const NOME_JANELA = 'aiv-yt';
const RECORTE_KEY = 'aiv.yt.recorte';

/** A janela é dada como viva se publicou estado nos últimos tantos ms (ela publica a cada 250 ms). */
const VIVA_MS = 2500;
/** Sem nenhuma mensagem da janela nesse tempo depois do window.open = o navegador a bloqueou. */
const BLOQUEIO_MS = 7000;

export const ERRO_BLOQUEADA = 'O navegador não abriu a janela do player (bloqueador de pop-ups?). ' +
  'Clique em «Abrir a janela do player» — ou permita pop-ups deste site.';

function novaSessao() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID().slice(0, 13); } catch (_) { /* contexto sem crypto */ }
  return Math.random().toString(36).slice(2, 15);
}

// ---------------------------------------------------------------- player (imitação do YT.Player)

/**
 * O player na janela, comandado por BroadcastChannel. Construir dentro do
 * gesto do usuário (clique): o construtor chama window.open.
 *   events  { onReady, onStateChange({data}), onError({data}) } — como na IFrame API
 */
export class PlayerJanela {
  constructor(id, { events = {}, inicio = 0 } = {}) {
    this.janela = true;
    this.events = events;
    this.sessao = novaSessao();
    this.videoId = id;
    this.s = { estado: -1, t: inicio || 0, d: 0, taxa: 1, taxas: null, mudo: true, titulo: '', autor: '', qualidade: '', ts: 0 };
    this.recebidoEm = 0;          // Date.now() da última mensagem da janela
    this.abertaEm = 0;
    this.fechou = false;
    this.ouvintes = new Set();
    this._pronta = null;
    this.canal = new BroadcastChannel(CANAL);
    this.canal.onmessage = (ev) => this._receber(ev.data || {});
    this.abrir(inicio);
  }

  /** Abre (ou reabre) a janela. Precisa de gesto do usuário. Devolve false se o navegador bloqueou na hora. */
  abrir(inicio) {
    const t = Math.max(0, Math.floor(inicio != null ? inicio : this.getCurrentTime()));
    const q = new URLSearchParams({ v: this.videoId, s: this.sessao, c: '0' });
    if (t > 0) q.set('t', String(t));
    this.fechou = false;
    this.abertaEm = Date.now();
    this.recebidoEm = 0;
    this._pronta = null;
    let w = null;
    // 960×540 de ÁREA ÚTIL = 16:9 exato: sem faixas pretas, só a barra de título a tirar
    try { w = window.open(URL_JANELA + '?' + q, NOME_JANELA, 'popup,width=960,height=540'); } catch (_) { w = null; }
    // com COOP no app o navegador devolve uma referência «fechada» mesmo abrindo; null = bloqueou
    this.bloqueada = !w;
    this._avisar();
    return Boolean(w);
  }

  /** Janela publicando estado (viva e com esta sessão). */
  get aberta() { return !this.fechou && Date.now() - this.recebidoEm < VIVA_MS; }
  /** Abriu a janela e ela ainda não falou: esperando (ou bloqueada sem o navegador avisar). */
  get esperando() { return !this.fechou && !this.recebidoEm && Date.now() - this.abertaEm < BLOQUEIO_MS && !this.bloqueada; }
  /** Geometria da janela (para achar o vídeo na captura): { iw, ih, ow, oh, dpr } ou null. */
  get geometria() { return this.s.jan || null; }

  ouvir(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); }
  _avisar() { for (const fn of this.ouvintes) { try { fn(this); } catch (_) { /* ouvinte ruim */ } } }

  /**
   * Resolve quando o player da janela fica pronto; rejeita se a janela não
   * aparecer (bloqueada) ou não ficar pronta a tempo.
   */
  pronta() {
    if (this.s.pronto && this.s.videoId === this.videoId) return Promise.resolve();
    if (this._pronta) return this._pronta.p;
    let ok, nao;
    const p = new Promise((a, b) => { ok = a; nao = b; });
    const fim = () => { clearTimeout(t1); clearTimeout(t2); this._pronta = null; };
    const t1 = setTimeout(() => { if (!this.recebidoEm) { fim(); nao(new Error(ERRO_BLOQUEADA)); } }, this.bloqueada ? 0 : BLOQUEIO_MS);
    const t2 = setTimeout(() => { fim(); nao(new Error('O player do YouTube não respondeu em 30 s.')); }, 30000);
    this._pronta = { p, ok: () => { fim(); ok(); }, nao: (e) => { fim(); nao(e); } };
    return p;
  }

  _receber(m) {
    if (m.de !== 'janela' || m.s !== this.sessao) return;
    if (m.tipo === 'fechou') { this.fechou = true; this.recebidoEm = 0; this.s.estado = -1; this._avisar(); return; }
    this.recebidoEm = Date.now();
    this.bloqueada = false;
    if (m.tipo === 'estado') {
      if (m.videoId && m.videoId !== this.videoId) return;   // estado antigo, antes de trocar de vídeo
      const antes = this.s.estado;
      this.s = { ...this.s, ...m, ts: Date.now() };
      if (m.pronto && this._pronta) this._pronta.ok();
      // a janela reabriu sozinha (recarregar): o estado chega sem evento
      if (antes !== m.estado && this.events.onStateChange && this._ultimoEvento !== m.estado) {
        this._ultimoEvento = m.estado;
        this.events.onStateChange({ data: m.estado, target: this });
      }
    } else if (m.tipo === 'evento') {
      if (m.nome === 'ready') {
        this.s.pronto = true;
        if (this._pronta) this._pronta.ok();
        if (this.events.onReady) this.events.onReady({ target: this });
      } else if (m.nome === 'state') {
        if (this._ultimoEvento === m.dados && this.s.estado === m.dados) { this._avisar(); return; }   // já visto pelo estado
        this.s.estado = m.dados;
        this.s.ts = Date.now();
        this._ultimoEvento = m.dados;
        if (this.events.onStateChange) this.events.onStateChange({ data: m.dados, target: this });
      } else if (m.nome === 'error') {
        this.s.erroTexto = m.texto || '';
        if (this._pronta) this._pronta.nao(new Error(m.texto || 'O player do YouTube falhou.'));
        if (this.events.onError) this.events.onError({ data: m.dados, texto: m.texto, target: this });
      }
    }
    this._avisar();
  }

  _enviar(m) {
    try { this.canal.postMessage({ ...m, s: this.sessao, para: 'janela' }); } catch (_) { /* canal fechado */ }
  }
  _cmd(nome, ...args) { this._enviar({ tipo: 'cmd', nome, args }); }

  // ---- a parte da IFrame API que o app usa (getters síncronos, do último estado publicado)
  getPlayerState() { return this.aberta || this.esperando ? this.s.estado : -1; }
  getCurrentTime() {
    const s = this.s;
    let t = s.t || 0;
    // entre duas publicações, o tempo anda sozinho enquanto toca
    if (s.estado === 1 && s.ts) t += ((Date.now() - s.ts) / 1000) * (s.taxa || 1);
    return s.d ? Math.min(s.d, t) : t;
  }
  getDuration() { return this.s.d || 0; }
  getPlaybackRate() { return this.s.taxa || 1; }
  getAvailablePlaybackRates() { return this.s.taxas && this.s.taxas.length ? this.s.taxas : null; }
  isMuted() { return Boolean(this.s.mudo); }
  getPlaybackQuality() { return this.s.qualidade || ''; }
  getVideoData() { return { title: this.s.titulo || '', author: this.s.autor || '', video_id: this.videoId }; }

  playVideo() { this._cmd('playVideo'); }
  pauseVideo() { this._cmd('pauseVideo'); }
  seekTo(t, ok) {
    this.s = { ...this.s, t: Math.max(0, t), ts: Date.now() };    // a barra responde na hora
    this._cmd('seekTo', t, ok !== false);
  }
  setPlaybackRate(v) { this.s = { ...this.s, taxa: v }; this._cmd('setPlaybackRate', v); }
  mute() { this.s = { ...this.s, mudo: true }; this._cmd('mute'); }
  unMute() { this.s = { ...this.s, mudo: false }; this._cmd('unMute'); }
  setVolume(v) { this._cmd('setVolume', v); }
  // a janela já tira a legenda sozinha
  setOption() {}
  unloadModule() {}

  /** Troca o vídeo. Se a pessoa fechou a janela, reabre (chamar dentro do clique). */
  loadVideoById(id) {
    const vid = typeof id === 'object' && id ? id.videoId : id;
    this.videoId = vid;
    this.s = { ...this.s, videoId: vid, estado: -1, t: 0, d: 0, titulo: '', autor: '', pronto: false, ts: Date.now() };
    if (!this.aberta && !this.esperando) { this.abrir(0); return; }
    this._enviar({ tipo: 'carregar', id: vid });
  }

  destroy() {
    this._enviar({ tipo: 'fechar' });
    if (this._pronta) this._pronta.nao(new Error('Player fechado.'));
    this.fechou = true;
    try { this.canal.close(); } catch (_) { /* já fechado */ }
    this.ouvintes.clear();
  }
}

// ---------------------------------------------------------------- captura da janela

/**
 * getDisplayMedia «comum»: a pessoa escolhe a janela do player (ou uma tela).
 * Chamar dentro do clique (o Safari exige o gesto). Devolve o MediaStream bruto.
 */
export async function capturarJanela({ frameRate = 30 } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error('Este navegador não deixa a página capturar janelas.');
  }
  try {
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: frameRate, max: frameRate } }, audio: false });
  } catch (err) {
    const cancelada = Boolean(err && (err.name === 'NotAllowedError' || err.name === 'AbortError'));
    const e = new Error(cancelada
      ? `Captura cancelada. Para usar o YouTube como fonte, compartilhe a janela «${TITULO_JANELA}».`
      : 'Não foi possível capturar a janela: ' + ((err && (err.message || err.name)) || 'erro'));
    e.cancelada = cancelada;
    throw e;
  }
}

// ---------------------------------------------------------------- detecção do retângulo do vídeo

/**
 * Acha o retângulo do vídeo em algumas imagens da captura (ImageData, todas do
 * mesmo tamanho). Pensado para a janela do player — fundo preto, vídeo no
 * meio, barra de título em cima —, mas serve para tela inteira com o player
 * à vista.
 *
 *   1. Área de busca: a imagem toda ou, se a geometria da janela bate com a
 *      captura (captura de janela), só a área útil dela (sem barra de título).
 *   2. Na área, o retângulo que contém tudo o que NÃO é preto em alguma das
 *      imagens (como o cropdetect do ffmpeg; várias imagens para uma cena
 *      escura não encolher o recorte).
 *   3. Mais alto que o formato esperado (barra de título que sobrou em
 *      cima): corta a faixa de cima ou de baixo que não se mexe.
 *
 * Devolve { x, y, w, h, confiavel } em pixels da imagem, ou null (tudo preto).
 */
export function detectarRecorte(imagens, { aspecto = 16 / 9, dica = null } = {}) {
  const lista = (imagens || []).filter(Boolean);
  if (!lista.length) return null;
  const W = lista[0].width, H = lista[0].height, N = W * H;
  const PRETO = 28;
  // por pixel: em quantas imagens não é preto, e quanto varia (movimento)
  const cont = new Uint8Array(N), maxL = new Uint8Array(N), minL = new Uint8Array(N).fill(255);
  let usadas = 0;
  for (const img of lista) {
    if (img.width !== W || img.height !== H) continue;
    usadas++;
    const d = img.data;
    for (let i = 0, p = 0; i < N; i++, p += 4) {
      const l = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
      if (l > PRETO && cont[i] < 255) cont[i]++;
      if (l > maxL[i]) maxL[i] = l;
      if (l < minL[i]) minL[i] = l;
    }
  }
  // não preto em pelo menos 1/4 das imagens: uma imagem estragada (o 1º quadro de uma captura às vezes
  // vem com lixo) não alarga o recorte, e uma cena escura passageira não o encolhe
  const minImgs = Math.max(1, Math.ceil(usadas / 4));
  // 1 · área de busca
  let ax = 0, ay = 0, aw = W, ah = H;
  const g = dica && geometriaParaArea(dica, W, H);
  if (g) { ax = g.x; ay = g.y; aw = g.w; ah = g.h; }

  // 2 · linhas e colunas com conteúdo (não preto) na área
  const naoPreto = (i) => cont[i] >= minImgs;
  const mov = new Uint32Array(ah);
  for (let y = 0; y < ah; y++) {
    const base = (ay + y) * W + ax;
    for (let x = 0; x < aw; x++) { const i = base + x; if (maxL[i] - minL[i] > 18) mov[y]++; }
  }
  /** Retângulo do que não é preto nas linhas de `de` para baixo (coordenadas da área), ou null. */
  const caixa = (de) => {
    const linha = new Uint32Array(ah), coluna = new Uint32Array(aw);
    for (let y = de; y < ah; y++) {
      const base = (ay + y) * W + ax;
      for (let x = 0; x < aw; x++) if (naoPreto(base + x)) { linha[y]++; coluna[x]++; }
    }
    const minLinha = Math.max(2, aw * 0.015), minColuna = Math.max(2, (ah - de) * 0.015);
    let y0 = de; while (y0 < ah && linha[y0] < minLinha) y0++;
    let y1 = ah - 1; while (y1 > y0 && linha[y1] < minLinha) y1--;
    let x0 = 0; while (x0 < aw && coluna[x0] < minColuna) x0++;
    let x1 = aw - 1; while (x1 > x0 && coluna[x1] < minColuna) x1--;
    if (y0 >= ah || x0 >= aw || y1 - y0 < 8 || x1 - x0 < 8) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, linha, minLinha };
  };
  const parada = (de, n, w) => { let s = 0; for (let k = de; k < de + n; k++) s += mov[k]; return s / Math.max(1, n * w); };
  let b = caixa(0);
  if (!b) return null;                                           // tudo preto: o vídeo ainda não começou
  const fora = (r) => Math.abs(r.w / r.h - aspecto) / aspecto;

  // 3a · faixa parada em cima SEPARADA do resto por linhas pretas (barra de título + área preta da
  //      janela): corta acima da separação, mesmo que o conjunto já pareça 16:9
  {
    const lim = b.y + Math.round(b.h * 0.3);
    let r1 = b.y; while (r1 < lim && b.linha[r1] >= b.minLinha) r1++;
    if (r1 < lim && r1 > b.y) {
      let r2 = r1; while (r2 < b.y + b.h && b.linha[r2] < b.minLinha) r2++;
      if (r2 - r1 >= 2 && parada(b.y, r1 - b.y, aw) < 0.004) { const r = caixa(r2); if (r) b = r; }
    }
  }

  // 3b · faixa parada em cima (barra de título/endereço) encostada no vídeo: tenta cortá-la e ver se o
  //     resto vira o formato esperado (com as faixas pretas dos lados aparecendo)
  if (aspecto && fora(b) > 0.04) {
    const limite = b.y + Math.round(b.h * 0.3);
    let melhor = null;
    for (let c = b.y + 1; c < limite; c++) {
      if (parada(b.y, c - b.y, aw) > 0.004) break;              // a faixa de cima já se mexe: não é barra
      const r = caixa(c);
      // o corte que deixa o resto mais perto do formato (a barra inteira sai, nem uma linha a mais)
      if (r && r.y === c && fora(r) <= 0.04 && (!melhor || fora(r) < fora(melhor) - 1e-4)) melhor = r;
    }
    if (melhor) b = melhor;
  }
  let { x, y, w, h } = b;

  // 4 · ainda alto demais: sobrou faixa parada em cima (barra de título) ou embaixo
  const r = w / h;
  if (aspecto && r < aspecto * 0.96) {
    const hh = Math.round(w / aspecto), sobra = h - hh;
    const cima = parada(y, sobra, w), baixo = parada(y + hh, sobra, w);
    const dentro = parada(y + (cima <= baixo ? sobra : 0), hh, w);
    // só corta se a faixa estiver parada e o resto se mexer (senão é um vídeo mais estreito, 4:3 etc.)
    const corta = Math.min(cima, baixo) < 0.004 && (dentro > 0.01 || Math.abs(cima - baixo) > 0.002 || !g);
    if (corta) { if (cima <= baixo) y += sobra; h = hh; }
  }
  const delimitado = y > ay || x > ax || y + h < ay + ah || x + w < ax + aw;
  return {
    x: ax + x, y: ay + y, w, h,
    confiavel: Boolean(g) || delimitado || Math.abs(w / h - aspecto) < aspecto * 0.04,
  };
}

/**
 * Área útil da janela dentro da captura, se a captura parece ser da janela
 * (mesma proporção da janela inteira). Sem bordas laterais (macOS/Windows);
 * a barra de título e a de endereço ficam em cima.
 */
function geometriaParaArea(j, W, H) {
  if (!j || !j.ow || !j.oh || !j.iw || !j.ih) return null;
  if (Math.abs(W / H - j.ow / j.oh) > 0.03) return null;            // não é a janela (tela inteira?)
  const s = W / j.ow;
  const w = Math.min(W, Math.round(j.iw * s)), h = Math.min(H, Math.round(j.ih * s));
  if (w < 16 || h < 16) return null;
  return { x: Math.max(0, Math.round((W - w) / 2)), y: Math.max(0, H - h), w, h };
}

function lerRecorteSessao() {
  try { return JSON.parse(sessionStorage.getItem(RECORTE_KEY) || 'null'); } catch (_) { return null; }
}
function gravarRecorteSessao(v) {
  try { if (v) sessionStorage.setItem(RECORTE_KEY, JSON.stringify(v)); else sessionStorage.removeItem(RECORTE_KEY); } catch (_) { /* storage bloqueado */ }
}

// ---------------------------------------------------------------- recortador

/**
 * Recebe a captura bruta (janela ou tela) e entrega `saida`: um MediaStream
 * só com o retângulo do vídeo, desenhado num canvas a ~30 fps.
 *   dica  () => geometria da janela (PlayerJanela.geometria), opcional
 */
export class Recortador {
  constructor(bruto, { aspecto = 16 / 9, dica = null, fps = 30 } = {}) {
    this.bruto = bruto;
    this.aspecto = aspecto;
    this.dica = dica;
    this.fps = fps;
    this.fonte = document.createElement('video');
    this.fonte.muted = true;
    this.fonte.playsInline = true;
    this.fonte.autoplay = true;
    this.fonte.srcObject = bruto;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 2; this.canvas.height = 2;
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.rect = null;             // { x, y, w, h } em pixels da captura
    this.origem = '';             // 'auto' | 'manual' | 'sessao' | 'inteira'
    this.confiavel = false;
    this.saida = null;
    this._t = 0;
    this.ouvintes = new Set();
  }

  ouvir(fn) { this.ouvintes.add(fn); return () => this.ouvintes.delete(fn); }
  _avisar() { for (const fn of this.ouvintes) { try { fn(this); } catch (_) { /* ouvinte ruim */ } } }

  get largura() { return this.fonte.videoWidth || 0; }
  get altura() { return this.fonte.videoHeight || 0; }

  /** Espera a captura entregar imagem, escolhe o recorte e começa a desenhar. */
  async iniciar() {
    this.fonte.play().catch(() => {});
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('A captura da janela não entregou vídeo em 8 s.')), 8000);
      const ok = () => { if (this.fonte.videoWidth > 0) { clearTimeout(t); clearInterval(iv); resolve(); } };
      const iv = setInterval(ok, 100);
      this.fonte.addEventListener('loadeddata', ok, { once: true });
      ok();
    });
    // a saída existe desde já (imagem inteira); o recorte entra assim que for achado
    this.definir({ x: 0, y: 0, w: this.largura, h: this.altura }, 'inteira');
    this.saida = this.canvas.captureStream(this.fps);
    this._laco();
    const salvo = lerRecorteSessao();
    if (salvo && salvo.W === this.largura && salvo.H === this.altura) {
      this.definir(salvo, 'sessao');
    } else {
      await this.detectar();
    }
    return this;
  }

  _laco() {
    clearInterval(this._t);
    // timer e não requestVideoFrameCallback: o <video> fora da página nem sempre recebe o callback
    this._t = setInterval(() => this.desenhar(), Math.round(1000 / this.fps));
  }

  desenhar() {
    const r = this.rect;
    if (!r || this.fonte.readyState < 2) return;
    try { this.ctx.drawImage(this.fonte, r.x, r.y, r.w, r.h, 0, 0, this.canvas.width, this.canvas.height); } catch (_) { /* quadro indisponível */ }
  }

  /** Algumas imagens pequenas da captura bruta (ImageData), espaçadas no tempo. */
  async amostras(n = 8, intervalo = 220, maxW = 480) {
    const W = this.largura, H = this.altura;
    if (!W || !H) return [];
    const k = Math.min(1, maxW / W);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const x = c.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (let i = 0; i < n; i++) {
      await new Promise((r) => setTimeout(r, i ? intervalo : 300));   // a 1ª espera um pouco: quadros iniciais da captura
      try { x.drawImage(this.fonte, 0, 0, c.width, c.height); out.push(x.getImageData(0, 0, c.width, c.height)); } catch (_) { /* segue */ }
    }
    return out.map((img) => Object.assign(img, { escala: k }));
  }

  /**
   * Detecta o retângulo do vídeo (até 3 tentativas: o vídeo pode estar
   * começando, tudo preto). Sem achar, fica a imagem inteira.
   */
  async detectar() {
    for (let tent = 0; tent < 3; tent++) {
      const imgs = await this.amostras();
      if (!imgs.length) break;
      const k = imgs[0].escala;
      const dica = typeof this.dica === 'function' ? this.dica() : this.dica;
      const r = detectarRecorte(imgs, { aspecto: this.aspecto, dica });
      if (r) {
        // de volta à escala da captura, com 1 px de folga para dentro (borda borrada do redimensionamento)
        const f = 1 / k;
        const rr = { x: Math.ceil(r.x * f) + 1, y: Math.ceil(r.y * f) + 1, w: Math.floor(r.w * f) - 2, h: Math.floor(r.h * f) - 2 };
        this.confiavel = r.confiavel;
        this.definir(rr, 'auto');
        return this.rect;
      }
    }
    this.confiavel = false;
    this.definir({ x: 0, y: 0, w: this.largura, h: this.altura }, 'inteira');
    return this.rect;
  }

  /** Aplica um recorte (pixels da captura). `manual` fica guardado na sessão. */
  definir(rect, origem = 'manual') {
    const W = this.largura, H = this.altura;
    if (!W || !H) return;
    let x = Math.max(0, Math.min(W - 2, Math.round(rect.x))), y = Math.max(0, Math.min(H - 2, Math.round(rect.y)));
    let w = Math.max(2, Math.min(W - x, Math.round(rect.w))), h = Math.max(2, Math.min(H - y, Math.round(rect.h)));
    // tamanho par (codificadores de vídeo e a gravação preferem)
    w -= w % 2; h -= h % 2;
    this.rect = { x, y, w, h };
    this.origem = origem;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    if (origem === 'manual') gravarRecorteSessao({ x, y, w, h, W, H });
    this.desenhar();
    this._avisar();
  }

  /** «1280×720 · automático» para a interface. */
  get rotulo() {
    if (!this.rect) return '';
    const o = { auto: 'automático', manual: 'manual', sessao: 'manual (desta sessão)', inteira: 'imagem inteira' }[this.origem] || '';
    return `${this.rect.w}×${this.rect.h}` + (o ? ' · ' + o : '');
  }

  parar() {
    clearInterval(this._t);
    for (const s of [this.saida, this.bruto]) if (s) for (const t of s.getTracks()) t.stop();
    this.fonte.srcObject = null;
    this._avisar();
    this.ouvintes.clear();
  }
}

// ---------------------------------------------------------------- «Ajustar recorte» (manual)

/**
 * Janela modal: a captura bruta com o recorte atual; arrastar marca um novo
 * retângulo. DOM puro (serve ao app e ao Treinar). Resolve true se aplicou.
 */
export function ajustarRecorte(rec) {
  return new Promise((resolve) => {
    const W = rec.largura, H = rec.altura;
    if (!W || !H) { resolve(false); return; }
    const anterior = document.activeElement;
    const fundo = document.createElement('div');
    fundo.className = 'ytj-modal';
    fundo.setAttribute('role', 'dialog');
    fundo.setAttribute('aria-modal', 'true');
    fundo.setAttribute('aria-label', 'Ajustar recorte da captura');
    Object.assign(fundo.style, {
      position: 'fixed', inset: '0', zIndex: '100000', background: 'rgba(0,0,0,.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    });
    const caixa = document.createElement('div');
    Object.assign(caixa.style, {
      background: 'var(--panel, var(--bg2, #13201f))', color: 'var(--text, var(--fg, #e9efee))',
      border: '1px solid var(--line, rgba(255,255,255,.14))', borderRadius: '10px',
      padding: '14px', maxWidth: 'min(1100px, 96vw)', maxHeight: '96vh', overflow: 'auto',
      boxShadow: '0 12px 40px rgba(0,0,0,.5)', font: '13px/1.45 var(--sans, -apple-system, BlinkMacSystemFont, sans-serif)',
    });
    const tit = document.createElement('div');
    tit.innerHTML = '<b style="font-size:15px">Ajustar recorte</b>';
    const txt = document.createElement('p');
    txt.style.margin = '6px 0 10px';
    txt.textContent = 'Arraste sobre a imagem para marcar só o vídeo (sem a barra de título nem as faixas pretas). ' +
      'É isto que o pipeline e os quadros recebem. O recorte manual vale até fechar esta aba.';
    const tela = document.createElement('canvas');
    const k = Math.min(1, (Math.min(window.innerWidth * 0.9, 1060)) / W, (window.innerHeight * 0.62) / H);
    tela.width = Math.round(W * k); tela.height = Math.round(H * k);
    Object.assign(tela.style, { display: 'block', maxWidth: '100%', cursor: 'crosshair', touchAction: 'none', background: '#000', borderRadius: '4px' });
    const info = document.createElement('div');
    info.style.margin = '8px 0';
    info.style.opacity = '.8';
    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' });
    const botao = (rotulo, fn, forte) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (forte ? ' accent pri' : '');
      b.textContent = rotulo;
      b.onclick = fn;
      barra.appendChild(b);
      return b;
    };
    caixa.append(tit, txt, tela, info, barra);
    fundo.appendChild(caixa);
    document.body.appendChild(fundo);

    let sel = rec.rect ? { ...rec.rect } : { x: 0, y: 0, w: W, h: H };
    let arrasto = null;
    const ctx = tela.getContext('2d');
    const pintar = () => {
      try { ctx.drawImage(rec.fonte, 0, 0, tela.width, tela.height); } catch (_) { /* sem quadro */ }
      const s = { x: sel.x * k, y: sel.y * k, w: sel.w * k, h: sel.h * k };
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, tela.width, s.y);
      ctx.fillRect(0, s.y + s.h, tela.width, tela.height - s.y - s.h);
      ctx.fillRect(0, s.y, s.x, s.h);
      ctx.fillRect(s.x + s.w, s.y, tela.width - s.x - s.w, s.h);
      ctx.strokeStyle = '#FFD84D';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 1, s.y + 1, Math.max(0, s.w - 2), Math.max(0, s.h - 2));
      info.textContent = `Recorte: ${Math.round(sel.w)}×${Math.round(sel.h)} px, a partir de (${Math.round(sel.x)}, ${Math.round(sel.y)}) · captura ${W}×${H}`;
    };
    const relogio = setInterval(pintar, 150);
    pintar();

    const ponto = (e) => {
      const b = tela.getBoundingClientRect();
      const sx = tela.width / b.width;
      return { x: Math.max(0, Math.min(W, ((e.clientX - b.left) * sx) / k)), y: Math.max(0, Math.min(H, ((e.clientY - b.top) * sx) / k)) };
    };
    tela.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { tela.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      arrasto = ponto(e);
    });
    tela.addEventListener('pointermove', (e) => {
      if (!arrasto) return;
      const p = ponto(e);
      sel = { x: Math.min(arrasto.x, p.x), y: Math.min(arrasto.y, p.y), w: Math.abs(p.x - arrasto.x), h: Math.abs(p.y - arrasto.y) };
      pintar();
    });
    const soltar = () => {
      if (arrasto && (sel.w < 16 || sel.h < 16)) sel = rec.rect ? { ...rec.rect } : { x: 0, y: 0, w: W, h: H };
      arrasto = null;
      pintar();
    };
    tela.addEventListener('pointerup', soltar);
    tela.addEventListener('pointercancel', soltar);

    const fechar = (aplicou) => {
      clearInterval(relogio);
      removeEventListener('keydown', tecla, true);
      fundo.remove();
      try { if (anterior && anterior.focus) anterior.focus(); } catch (_) { /* ok */ }
      resolve(aplicou);
    };
    const tecla = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); rec.definir(sel, 'manual'); fechar(true); }
    };
    addEventListener('keydown', tecla, true);
    botao('Detectar de novo', async (e) => {
      const b = e.currentTarget;
      b.disabled = true; b.textContent = 'Detectando…';
      await rec.detectar();
      sel = { ...rec.rect };
      b.disabled = false; b.textContent = 'Detectar de novo';
      pintar();
    });
    botao('Imagem inteira', () => { sel = { x: 0, y: 0, w: W, h: H }; pintar(); });
    botao('Cancelar', () => fechar(false));
    const usar = botao('Usar este recorte', () => { rec.definir(sel, 'manual'); fechar(true); }, true);
    setTimeout(() => { try { usar.focus(); } catch (_) { /* ok */ } }, 0);
  });
}
