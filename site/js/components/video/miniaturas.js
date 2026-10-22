/**
 * components/video/miniaturas.js — miniaturas da trilha de vídeo, em segundo
 * plano e sob demanda (GPlanSiS|Vídeo).
 *
 * CAMINHO PRINCIPAL: um Worker (miniaturas-worker.js) decodifica com
 * WebCodecs só as amostras necessárias, direto do Blob, e devolve bitmaps de
 * 160 px já reduzidos — nada disso passa pela thread principal nem disputa o
 * <video> do visor. Pedidos do mesmo GOP saem de uma passada só.
 *
 * RESERVA (sem Worker/WebCodecs, codec que o navegador não decodifica,
 * índice sintético ou vídeo com rotação na matriz — o WebCodecs não gira):
 * um <video> OCULTO busca o quadro e o reduz (createImageBitmap com resize).
 *
 * Nos dois caminhos a timeline pede apenas as miniaturas VISÍVEIS; a lista
 * pedida é trocada a cada desenho (o que saiu da tela é cancelado) e o cache
 * é LRU com LIMITE bitmaps (~23 MB). Com a timeline afastada (cada miniatura
 * cobrindo muitos quadros) o pedido é arredondado ao QUADRO-CHAVE mais
 * próximo: decodificar um quadro-chave não exige o GOP — rolar um vídeo de
 * 10 min fica instantâneo. De perto, a miniatura é do quadro exato.
 */

const LARG = 160;
const LIMITE = 400;

export class Miniaturas {
  /**
   * @param {object} o
   * @param {Blob}   o.blob      a mídia (para o Worker)
   * @param {string} o.url       object URL da mídia (para a reserva com <video>)
   * @param {object} o.v         índice de vídeo (midia.js)
   * @param {number} o.desloc    segundos a somar ao pts para virar currentTime (calibração)
   * @param {() => void} o.aoChegar  uma miniatura nova ficou pronta (pede redesenho)
   */
  constructor({ blob, url, v, desloc, aoChegar }) {
    this.v = v;
    this.url = url;
    this.desloc = desloc || 0;
    this.aoChegar = aoChegar;
    this.cache = new Map();          // q → ImageBitmap (ordem de inserção = LRU)
    this.querer = [];                // pedidos do desenho atual
    this.querSet = new Set();
    this.ultimaLista = '';
    this.faltando = 0;               // miniaturas que faltaram no último desenho (diagnóstico/teste)
    this.vivo = true;
    this.modo = 'iniciando';         // 'worker' | 'video'
    this.alt = Math.round(LARG * (v.altura || 9) / (v.largura || 16)) || 90;
    // quadros-chave em ordem de apresentação (para o arredondamento de longe)
    this.chaves = [];
    if (v.dec) for (let i = 0; i < v.n; i++) if (v.dec.chave[v.decDe[i]]) this.chaves.push(i);
    this.agendado = false;
    if (podeWorker(v, blob)) this.iniciarWorker(blob);
    else this.iniciarVideo();
  }

  get proporcao() { return this.alt / LARG; }

  /* ------------------------------------------------------------ caminhos */

  iniciarWorker(blob) {
    let w;
    try { w = new Worker(new URL('./miniaturas-worker.js', import.meta.url), { type: 'module' }); }
    catch (_) { this.iniciarVideo(); return; }
    this.w = w;
    const v = this.v;
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.tipo === 'quadro') { this.guardar(m.q, m.bmp); return; }
      if (m.tipo === 'pronto') {
        if (!this.vivo) return;
        if (m.ok) { this.modo = 'worker'; this.enviar(true); }
        else { console.info('[vídeo] miniaturas sem worker:', m.motivo); this.pararWorker(); this.iniciarVideo(); }
      }
    };
    w.onerror = () => { if (this.modo !== 'video') { this.pararWorker(); this.iniciarVideo(); } };
    w.postMessage({
      tipo: 'iniciar', blob, larg: LARG, alt: this.alt,
      video: {
        codec: v.codec, descricao: v.descricao, largura: v.largura, altura: v.altura, n: v.n,
        pts: v.pts, decDe: v.decDe, dec: { pos: v.dec.pos, tam: v.dec.tam, pts: v.dec.pts, chave: v.dec.chave },
      },
    });
  }

  pararWorker() {
    if (!this.w) return;
    try { this.w.postMessage({ tipo: 'fim' }); } catch (_) { /* ok */ }
    const w = this.w;
    this.w = null;
    setTimeout(() => w.terminate(), 200);
  }

  iniciarVideo() {
    this.modo = 'video';
    this.pilha = [];
    this.ocupado = false;
    const el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    el.src = this.url;
    this.el = el;
    this.pronto = new Promise((r) => { el.onloadeddata = r; el.onerror = r; });
    this.enviar(true);
  }

  /* ------------------------------------------------------------ API da timeline */

  /** Quadro a pedir para uma miniatura que cobre `passo` quadros a partir de q. */
  alvo(q, passo) {
    if (passo < 12 || this.chaves.length < 2) return q;
    // quadro-chave mais próximo do meio do intervalo
    const meio = q + passo / 2;
    let lo = 0, hi = this.chaves.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.chaves[m] < meio) lo = m + 1; else hi = m; }
    const a = this.chaves[lo], b = lo > 0 ? this.chaves[lo - 1] : a;
    const k = Math.abs(a - meio) < Math.abs(b - meio) ? a : b;
    return Math.abs(k - meio) <= passo ? k : q;
  }

  /** Bitmap do quadro q, se já existir; senão pede (fica para depois deste desenho) e devolve null. */
  obter(q) {
    const b = this.cache.get(q);
    if (b) { this.cache.delete(q); this.cache.set(q, b); return b; }   // LRU: usado agora vai para o fim
    this.faltando++;
    if (!this.querSet.has(q)) { this.querSet.add(q); this.querer.push(q); }
    if (!this.agendado) {
      this.agendado = true;
      queueMicrotask(() => { this.agendado = false; this.enviar(); });
    }
    return null;
  }

  /** Começo de um desenho: a lista de pedidos passa a ser só o que este desenho pedir. */
  esquecerPedidos() { this.querer = []; this.querSet.clear(); this.faltando = 0; }

  /**
   * Pausa (true) ou retoma: durante a exportação o decodificador das
   * miniaturas cede a CPU/o codec a quem exporta.
   */
  pausar(sim) {
    this.pausado = Boolean(sim);
    this.enviar(true);
  }

  /** Entrega a lista atual ao caminho ativo (só se mudou). */
  enviar(forcar = false) {
    if (!this.vivo) return;
    const lista = this.pausado ? [] : this.querer.slice(0, 160);
    const chave = lista.join(',');
    if (!forcar && chave === this.ultimaLista) return;
    this.ultimaLista = chave;
    if (this.modo === 'worker' && this.w) this.w.postMessage({ tipo: 'pedir', lista });
    else if (this.modo === 'video') { this.pilha = lista.slice().reverse(); this.rodarVideo(); }
  }

  guardar(q, bmp) {
    if (!this.vivo) { if (bmp && bmp.close) bmp.close(); return; }
    const velho = this.cache.get(q);
    if (velho && velho !== bmp && velho.close) velho.close();
    this.cache.delete(q);
    this.cache.set(q, bmp);
    while (this.cache.size > LIMITE) {
      const k = this.cache.keys().next().value;
      const b = this.cache.get(k);
      this.cache.delete(k);
      if (b && b.close) b.close();
    }
    this.aoChegar();
  }

  /* ------------------------------------------------------------ reserva: <video> oculto */

  async rodarVideo() {
    if (this.ocupado || !this.vivo) return;
    this.ocupado = true;
    try {
      await this.pronto;
      while (this.vivo && this.modo === 'video' && this.pilha.length) {
        const q = this.pilha.pop();
        if (this.cache.has(q)) continue;
        const v = this.v;
        const t = (v.pts[q] + (v.pts[q + 1] - v.pts[q]) / 2) / 1e6 + this.desloc;
        await new Promise((r) => {
          const fim = () => { clearTimeout(to); this.el.removeEventListener('seeked', fim); r(); };
          const to = setTimeout(fim, 3000);
          this.el.addEventListener('seeked', fim);
          this.el.currentTime = Math.max(0, t);
        });
        if (!this.vivo) break;
        try {
          this.guardar(q, await createImageBitmap(this.el, { resizeWidth: LARG, resizeHeight: this.alt, resizeQuality: 'low' }));
        } catch (_) { /* quadro ilegível: fica sem miniatura */ }
      }
    } finally { this.ocupado = false; }
  }

  liberar() {
    this.vivo = false;
    this.pararWorker();
    for (const b of this.cache.values()) if (b && b.close) b.close();
    this.cache.clear();
    if (this.el) {
      this.el.removeAttribute('src');
      try { this.el.load(); } catch (_) { /* ok */ }
    }
  }
}

/** O caminho do Worker serve para esta mídia? */
function podeWorker(v, blob) {
  return Boolean(blob && v && v.dec && v.codec && !v.sintetico && !v.rotacao &&
    typeof Worker !== 'undefined' && typeof VideoDecoder !== 'undefined');
}
