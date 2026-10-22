/**
 * cv/codecring.js — buffer de frames COMPRIMIDO com WebCodecs.
 *
 * ===================== POR QUE ISTO EXISTE =====================
 *
 * O FrameRing guarda canvas RGBA cru. A 320 px isso dá 307 KB por frame:
 * 60 frames = 18 MB para 2 segundos de histórico numa resolução ruim.
 *
 * Aqui os frames passam por um VideoEncoder de hardware. A 640 px e 2 Mbit/s
 * cada frame custa ~8 KB — cerca de 40× menos, com o DOBRO da resolução.
 * O mesmo orçamento de memória compra um minuto de histórico em vez de dois
 * segundos, e a codificação sai da CPU.
 *
 * O CUSTO é que vídeo comprimido não é acesso aleatório: um frame delta só
 * existe em relação ao anterior. Para exibir o frame N é preciso decodificar
 * do keyframe anterior até ele. Por isso forçamos keyframe a cada
 * `gopSize` frames — com GOP 12, rebobinar decodifica no máximo 12 frames,
 * o que leva poucos milissegundos.
 *
 * A decodificação é ASSÍNCRONA, mas o loop de render chama `current()` de
 * forma síncrona. A saída fica num canvas de destino que é atualizado quando
 * o decode termina: arrastar a régua mostra o frame com um atraso de alguns
 * milissegundos, o que é imperceptível numa ação feita à mão.
 *
 * Se WebCodecs não existir, `isSupported()` devolve false e o app cai no
 * FrameRing — mesma interface, sem ramificação no chamador.
 * ===============================================================
 */

const CODECS = [
  // ordem de preferência: qualidade por bit, depois disponibilidade
  { codec: 'vp09.00.10.08', name: 'VP9' },
  { codec: 'vp8', name: 'VP8' },
  { codec: 'avc1.42001E', name: 'H.264 baseline' },
];

export function isSupported() {
  return typeof VideoEncoder !== 'undefined' &&
         typeof VideoDecoder !== 'undefined' &&
         typeof VideoFrame !== 'undefined';
}

export class CodecRing {
  constructor({ capacity = 300, width = 640, bitrate = 2_000_000, gopSize = 12 } = {}) {
    this.capacity = capacity;
    this.width = width;
    this.bitrate = bitrate;
    this.gopSize = gopSize;

    this.chunks = [];          // ring de { bytes, type, ts, t }
    this.head = 0;
    this.count = 0;
    this.cursor = -1;          // -1 = ao vivo
    this.byteCount = 0;

    this.encoder = null;
    this.decoder = null;
    this.codecName = null;
    this.dims = null;          // { w, h } com que o encoder foi configurado
    this.frameIndex = 0;
    this.failed = false;

    this.scratch = null;       // canvas de entrada do encoder
    this.out = document.createElement('canvas');   // canvas de saída do decode
    this.outValid = false;
    this.pending = null;       // índice pedido enquanto um decode corre
    this.decoding = false;
    this.decodedIndex = -1;
  }

  get live() { return this.cursor < 0; }
  get length() { return this.count; }
  get bytes() { return this.byteCount; }

  // ------------------------------------------------------------ encode

  async #ensureEncoder(w, h) {
    if (this.encoder && this.dims && this.dims.w === w && this.dims.h === h) return true;
    if (this.failed) return false;

    this.#closeEncoder();

    for (const c of CODECS) {
      const config = {
        codec: c.codec,
        width: w,
        height: h,
        bitrate: this.bitrate,
        framerate: 30,
        latencyMode: 'realtime',   // sem lookahead: o encoder não segura frames
      };
      let ok = false;
      try {
        const probe = await VideoEncoder.isConfigSupported(config);
        ok = probe && probe.supported;
      } catch (_) {
        ok = false;
      }
      if (!ok) continue;

      try {
        this.encoder = new VideoEncoder({
          output: (chunk) => this.#onChunk(chunk),
          error: () => { this.failed = true; this.#closeEncoder(); },
        });
        this.encoder.configure(config);
        this.codecName = c.name;
        this.dims = { w, h };
        this.frameIndex = 0;
        return true;
      } catch (_) {
        this.#closeEncoder();
      }
    }
    this.failed = true;      // nenhum codec aceitou: o chamador usa o fallback
    return false;
  }

  #onChunk(chunk) {
    const bytes = new Uint8Array(chunk.byteLength);
    chunk.copyTo(bytes);

    const slot = { bytes, type: chunk.type, ts: chunk.timestamp, t: performance.now() };

    if (this.count === this.capacity) {
      const old = this.chunks[this.head];
      if (old) this.byteCount -= old.bytes.length;
    }
    this.chunks[this.head] = slot;
    this.byteCount += bytes.length;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    /*
     * Descartar o começo do ring pode deixar o buffer começando num frame
     * delta, que é indecodificável sozinho. Aparar até o primeiro keyframe
     * mantém a invariante "o índice 0 é sempre decodificável".
     */
    this.#trimToKeyframe();
  }

  #trimToKeyframe() {
    if (this.count < this.capacity) return;
    let drop = 0;
    while (drop < this.count && this.at(drop) && this.at(drop).type !== 'key') drop++;
    if (drop === 0 || drop >= this.count) return;
    for (let i = 0; i < drop; i++) {
      const s = this.at(i);
      if (s) this.byteCount -= s.bytes.length;
    }
    const start = (this.head + drop) % this.capacity;
    const kept = [];
    for (let i = drop; i < this.count; i++) kept.push(this.at(i));
    this.chunks = kept;
    this.head = kept.length % this.capacity;
    this.count = kept.length;
    void start;
  }

  /** Grava o frame atual. Assinatura idêntica à do FrameRing. */
  push(source, srcW, srcH, mirror) {
    if (!srcW || !srcH || this.failed) return;

    // codecs exigem dimensões pares
    const w = Math.max(2, Math.round(Math.min(this.width, srcW) / 2) * 2);
    const h = Math.max(2, Math.round(((w * srcH) / srcW) / 2) * 2);

    if (!this.scratch) this.scratch = document.createElement('canvas');
    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
    }
    const ctx = this.scratch.getContext('2d');
    ctx.save();
    if (mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    try {
      ctx.drawImage(source, 0, 0, w, h);
    } catch (_) {
      ctx.restore();
      return;
    }
    ctx.restore();

    if (!this.encoder || !this.dims || this.dims.w !== w || this.dims.h !== h) {
      // configura fora do caminho síncrono; os frames deste intervalo se perdem
      this.#ensureEncoder(w, h);
      return;
    }
    // fila cheia significa encoder afogado — descartar é melhor que atrasar
    if (this.encoder.encodeQueueSize > 4) return;

    let frame;
    try {
      frame = new VideoFrame(this.scratch, { timestamp: this.frameIndex * 33333 });
    } catch (_) {
      return;
    }
    try {
      this.encoder.encode(frame, { keyFrame: this.frameIndex % this.gopSize === 0 });
      this.frameIndex++;
    } catch (_) {
      this.failed = true;
    } finally {
      frame.close();          // VideoFrame não fechado vaza memória de GPU
    }
  }

  // ------------------------------------------------------------ acesso

  physical(i) {
    const start = this.count === this.capacity ? this.head : 0;
    return (start + i) % this.capacity;
  }

  at(i) {
    if (i < 0 || i >= this.count) return null;
    return this.chunks[this.physical(i)] || null;
  }

  /**
   * Devolve o canvas com o frame do cursor. Se o decode ainda não terminou,
   * devolve o último frame decodificado — melhor um quadro velho por alguns
   * milissegundos do que piscar preto.
   */
  current() {
    if (this.live) return null;
    const want = Math.min(this.cursor, this.count - 1);
    if (want !== this.decodedIndex) this.#requestDecode(want);
    return this.outValid ? { canvas: this.out } : null;
  }

  #requestDecode(index) {
    if (this.decoding) { this.pending = index; return; }
    this.decoding = true;
    this.#decodeTo(index)
      .catch(() => {})
      .finally(() => {
        this.decoding = false;
        if (this.pending !== null && this.pending !== index) {
          const nxt = this.pending;
          this.pending = null;
          this.#requestDecode(nxt);
        } else {
          this.pending = null;
        }
      });
  }

  async #decodeTo(index) {
    // recua até o keyframe: frame delta não se decodifica sozinho
    let start = index;
    while (start > 0 && this.at(start) && this.at(start).type !== 'key') start--;
    const first = this.at(start);
    if (!first || first.type !== 'key') return;

    const codec = CODECS.find((c) => c.name === this.codecName);
    if (!codec || !this.dims) return;

    let last = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        if (last) last.close();
        last = frame;
      },
      error: () => {},
    });
    try {
      decoder.configure({
        codec: codec.codec,
        codedWidth: this.dims.w,
        codedHeight: this.dims.h,
        optimizeForLatency: true,
      });
      for (let i = start; i <= index; i++) {
        const s = this.at(i);
        if (!s) break;
        decoder.decode(new EncodedVideoChunk({
          type: s.type, timestamp: s.ts, data: s.bytes,
        }));
      }
      await decoder.flush();

      if (last) {
        if (this.out.width !== last.displayWidth || this.out.height !== last.displayHeight) {
          this.out.width = last.displayWidth;
          this.out.height = last.displayHeight;
        }
        this.out.getContext('2d').drawImage(last, 0, 0);
        this.outValid = true;
        this.decodedIndex = index;
      }
    } finally {
      if (last) last.close();
      try { decoder.close(); } catch (_) { /* já fechado */ }
    }
  }

  // ------------------------------------------------------------ navegação

  resume() { this.cursor = -1; }

  pause() { if (this.live) this.cursor = Math.max(0, this.count - 1); }

  step(delta) {
    if (this.live) this.cursor = Math.max(0, this.count - 1);
    const next = this.cursor + delta;
    if (next >= this.count) { this.resume(); return; }
    this.cursor = Math.max(0, next);
  }

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

  get spanSeconds() {
    if (this.count < 2) return 0;
    const a = this.at(0), b = this.at(this.count - 1);
    return a && b ? Math.max(0, (b.t - a.t) / 1000) : 0;
  }

  get behindSeconds() {
    if (this.live || !this.count) return 0;
    const cur = this.at(Math.min(this.cursor, this.count - 1));
    const last = this.at(this.count - 1);
    return cur && last ? Math.max(0, (last.t - cur.t) / 1000) : 0;
  }

  // ------------------------------------------------------------ ciclo de vida

  #closeEncoder() {
    if (this.encoder) {
      try { this.encoder.close(); } catch (_) { /* já fechado */ }
    }
    this.encoder = null;
    this.dims = null;
  }

  clear() {
    this.chunks = [];
    this.head = 0;
    this.count = 0;
    this.cursor = -1;
    this.byteCount = 0;
    this.outValid = false;
    this.decodedIndex = -1;
    this.frameIndex = 0;
    if (this.encoder) {
      // recomeçar num keyframe: senão o primeiro frame do buffer novo é delta
      try { this.encoder.flush(); } catch (_) { /* ignora */ }
    }
  }

  resize(capacity, width) {
    if (capacity === this.capacity && width === this.width) return;
    this.clear();
    this.#closeEncoder();
    this.capacity = Math.max(4, capacity);
    this.width = Math.max(64, width);
    this.failed = false;
  }

  /** Rótulo para a UI: qual codec pegou e quanto está custando por frame. */
  get info() {
    const perFrame = this.count ? this.byteCount / this.count : 0;
    return {
      codec: this.codecName || (this.failed ? 'indisponível' : 'iniciando'),
      perFrameKB: perFrame / 1024,
      gop: this.gopSize,
    };
  }
}

/**
 * Escolhe o melhor buffer disponível. O chamador não precisa saber qual saiu:
 * a interface é a mesma.
 */
export async function createRing(FrameRing, opts) {
  if (isSupported()) {
    const ring = new CodecRing({
      capacity: opts.codecCapacity || 300,
      width: opts.codecWidth || 640,
      bitrate: opts.bitrate || 2_000_000,
    });
    // confirma que ALGUM codec aceita antes de entregar
    for (const c of CODECS) {
      try {
        const probe = await VideoEncoder.isConfigSupported({
          codec: c.codec, width: 640, height: 480, bitrate: 2_000_000, framerate: 30,
        });
        if (probe && probe.supported) return ring;
      } catch (_) { /* tenta o próximo */ }
    }
  }
  return new FrameRing({ capacity: opts.capacity, width: opts.width });
}
