/**
 * cv/ringbuffer.js — buffer circular dos frames recentes.
 *
 * É o que dá sentido a controles de vídeo numa fonte AO VIVO. Sem ele,
 * "voltar um frame" na câmera não significa nada; com ele, dá para pausar,
 * rebobinar e examinar quadro a quadro a detecção que passou voando — que
 * é exatamente o que se quer inspecionar num sistema de visão.
 *
 * Os frames são guardados REDUZIDOS e em <canvas>, não em ImageData:
 *
 *   - canvas fica na GPU e o desenho de volta é uma cópia de textura;
 *     ImageData obrigaria a manter o array na heap do JS.
 *   - a 320 px de largura, 60 frames ocupam ~18 MB. A resolução plena
 *     custaria 10× isso e o navegador começaria a matar abas.
 *
 * O que se perde ao rebobinar é resolução, não conteúdo: o pipeline
 * reprocessa o frame do buffer normalmente, então detecção e overlay
 * continuam funcionando no histórico.
 */

const DEFAULT_CAPACITY = 60;
const DEFAULT_WIDTH = 320;

export class FrameRing {
  constructor({ capacity = DEFAULT_CAPACITY, width = DEFAULT_WIDTH } = {}) {
    this.capacity = capacity;
    this.width = width;
    this.frames = [];      // [{ canvas, t, w, h }]
    this.head = 0;         // próxima posição de escrita
    this.count = 0;
    this.cursor = -1;      // -1 = ao vivo; >=0 = índice lógico dentro do buffer
    this.pool = [];
  }

  get live() {
    return this.cursor < 0;
  }

  /** Quantos frames existem para rebobinar. */
  get length() {
    return this.count;
  }

  acquire(w, h) {
    let c = this.pool.pop();
    if (!c) c = document.createElement('canvas');
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return c;
  }

  /**
   * Grava o frame atual. Recebe qualquer coisa que o drawImage aceite
   * (video, canvas), então serve tanto para câmera quanto para arquivo.
   */
  push(source, srcW, srcH, mirror) {
    if (!srcW || !srcH) return;
    const w = Math.min(this.width, srcW);
    const h = Math.max(1, Math.round((w * srcH) / srcW));

    let slot;
    if (this.count === this.capacity) {
      // reaproveita o canvas mais antigo em vez de alocar
      slot = this.frames[this.head];
      if (slot && (slot.canvas.width !== w || slot.canvas.height !== h)) {
        slot.canvas.width = w;
        slot.canvas.height = h;
      }
    }
    if (!slot) slot = { canvas: this.acquire(w, h), t: 0 };

    const ctx = slot.canvas.getContext('2d');
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    try {
      ctx.drawImage(source, 0, 0, w, h);
    } catch (_) {
      ctx.restore();
      return;                       // frame indisponível: não corrompe o buffer
    }
    ctx.restore();
    slot.t = performance.now();

    this.frames[this.head] = slot;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Índice físico do frame lógico `i` (0 = mais antigo). */
  physical(i) {
    const start = this.count === this.capacity ? this.head : 0;
    return (start + i) % this.capacity;
  }

  /** Frame numa posição lógica, ou null. */
  at(i) {
    if (i < 0 || i >= this.count) return null;
    return this.frames[this.physical(i)] || null;
  }

  /** O frame que deve ser exibido agora (null = usar a fonte ao vivo). */
  current() {
    if (this.live) return null;
    return this.at(Math.min(this.cursor, this.count - 1));
  }

  // ---------------------------------------------------------- navegação

  /** Volta ao vivo. */
  resume() {
    this.cursor = -1;
  }

  /** Congela na posição mais recente. */
  pause() {
    if (this.live) this.cursor = Math.max(0, this.count - 1);
  }

  /** Passo relativo. Passar do fim volta ao vivo — é o comportamento esperado. */
  step(delta) {
    if (this.live) this.cursor = Math.max(0, this.count - 1);
    const next = this.cursor + delta;
    if (next >= this.count) {
      this.resume();
      return;
    }
    this.cursor = Math.max(0, next);
  }

  /** Posição normalizada 0..1 dentro do buffer. */
  seekRatio(r) {
    if (!this.count) return;
    const i = Math.round(r * (this.count - 1));
    this.cursor = Math.max(0, Math.min(this.count - 1, i));
  }

  get ratio() {
    if (!this.count) return 1;
    if (this.live) return 1;
    return this.cursor / Math.max(1, this.count - 1);
  }

  /** Segundos de histórico entre o frame mais antigo e o mais novo. */
  get spanSeconds() {
    if (this.count < 2) return 0;
    const first = this.at(0), last = this.at(this.count - 1);
    if (!first || !last) return 0;
    return Math.max(0, (last.t - first.t) / 1000);
  }

  /** Quanto tempo atrás está o frame exibido. */
  get behindSeconds() {
    if (this.live || !this.count) return 0;
    const cur = this.current(), last = this.at(this.count - 1);
    if (!cur || !last) return 0;
    return Math.max(0, (last.t - cur.t) / 1000);
  }

  clear() {
    for (const f of this.frames) if (f && this.pool.length < 8) this.pool.push(f.canvas);
    this.frames = [];
    this.head = 0;
    this.count = 0;
    this.cursor = -1;
  }

  resize(capacity, width) {
    if (capacity === this.capacity && width === this.width) return;
    this.clear();
    this.capacity = Math.max(2, capacity);
    this.width = Math.max(64, width);
  }

  /** Uso aproximado de memória, para o painel de configurações. */
  get bytes() {
    let n = 0;
    for (const f of this.frames) if (f) n += f.canvas.width * f.canvas.height * 4;
    return n;
  }
}
