/**
 * components/video/onda.js — forma de onda da trilha de áudio (GPlanSiS|Vídeo).
 *
 * Decodifica o áudio INTEIRO em segundo plano, mas não guarda o PCM: só o
 * pico de cada fatia de 1/400 s (um byte). Dez minutos de áudio viram
 * 240 KB, e a timeline desenha de qualquer zoom lendo esse vetor.
 *
 *   1º caminho  Worker (onda-worker.js) com AudioDecoder sobre os pacotes do
 *               índice (midia.js): a decodificação e o cálculo dos picos não
 *               tocam a thread principal; chegam trechos a cada ~200 ms;
 *   2º          o mesmo na thread principal (navegador sem AudioDecoder em
 *               Worker), cedendo a vez a cada bloco;
 *   reserva     decodeAudioData (Web Audio) do arquivo inteiro, só até 300 MB.
 *
 * PIRÂMIDE: além das fatias de 1/400 s há níveis com o máximo de 8, 64, 512…
 * fatias. Com a timeline afastada a forma de onda lê o nível certo e o
 * desenho fica O(largura em px), seja o vídeo de 10 s ou de 10 h.
 *
 * Os picos ficam em TEMPO DA MÍDIA (µs); a timeline converte cada clipe.
 */
import { lerAmostras } from './midia.js';

// mesmo deslocamento do exportador (o decodificador prende timestamps negativos no zero)
export const DESLOC_AUDIO = 10_000_000;

export const FATIAS_POR_S = 400;
const RAMO = 8;

/**
 * Soma ao vetor de picos o AudioData `d` (que começa em `ts` µs). Usada aqui e
 * no worker. Devolve [fatia inicial, fatia final] tocadas, ou null.
 */
export function registrarPicos(p, d, ts, fps, estado) {
  const n = d.numberOfFrames, sr = d.sampleRate;
  const nc = Math.min(2, d.numberOfChannels);
  const canais = [];
  for (let c = 0; c < nc; c++) {
    const b = new Float32Array(n);
    d.copyTo(b, { planeIndex: c, format: 'f32-planar' });
    canais.push(b);
  }
  return registrarCanais(p, canais, n, sr, ts, fps, estado);
}

export function registrarCanais(p, canais, n, sr, ts, fps, estado) {
  const porFatia = sr / fps;
  let f = Math.floor((ts / 1e6) * fps);
  const f0 = f;
  let acum = 0, cont = (ts / 1e6) * sr - f * porFatia;
  const c0 = canais[0], c1 = canais[1];
  for (let i = 0; i < n; i++) {
    let m = c0[i] < 0 ? -c0[i] : c0[i];
    if (c1) { const b = c1[i] < 0 ? -c1[i] : c1[i]; if (b > m) m = b; }
    if (m > acum) acum = m;
    if (++cont >= porFatia) {
      if (f >= 0 && f < p.length) { const val = Math.min(255, Math.round(Math.sqrt(acum) * 255)); if (val > p[f]) p[f] = val; }
      f++; cont -= porFatia; acum = 0;
    }
  }
  if (f >= 0 && f < p.length && acum > 0) { const val = Math.min(255, Math.round(Math.sqrt(acum) * 255)); if (val > p[f]) p[f] = val; }
  if (estado && f > estado.feito) estado.feito = f;
  return f >= f0 ? [f0, f] : null;
}

export class Onda {
  constructor(blob, ix, aoProgresso) {
    this.blob = blob;
    this.ix = ix;
    this.aoProgresso = aoProgresso;
    const dur = (ix && ix.duracaoUs ? ix.duracaoUs : 0) / 1e6;
    this.picos = new Uint8Array(Math.max(1, Math.ceil(dur * FATIAS_POR_S) + 4));
    this.niveis = [this.picos];
    this.pronto = false;
    this.feito = 0;      // até que fatia já tem dado
    this.temAudio = Boolean(ix && ix.audio);
    this.erro = null;
    this.vivo = true;
    this.w = null;
  }

  async calcular() {
    try {
      if (this.ix.audio && typeof Worker !== 'undefined' && await this.noWorker()) return;
      if (!this.vivo) return;
      if (this.ix.audio && typeof AudioDecoder !== 'undefined' && await this.webcodecs()) return;
      if (!this.vivo) return;
      // sem índice (contêiner ilegível) não se sabe se há áudio: tenta o Web Audio
      if (this.ix.audio || this.ix.sintetico) await this.webaudio();
    } catch (e) {
      this.erro = e;
      this.aoProgresso(1);
    }
  }

  /** Recalcula a pirâmide de máximos (barato: O(n), com n = fatias). */
  refazerNiveis() {
    const niv = [this.picos];
    let ant = this.picos;
    while (ant.length > 64) {
      const m = Math.ceil(ant.length / RAMO);
      const nv = new Uint8Array(m);
      for (let i = 0, j = 0; i < m; i++) {
        let x = 0;
        const fim = Math.min(ant.length, j + RAMO);
        for (; j < fim; j++) if (ant[j] > x) x = ant[j];
        nv[i] = x;
      }
      niv.push(nv);
      ant = nv;
    }
    this.niveis = niv;
  }

  /** Nível da pirâmide para `fatPorPx` fatias por pixel: { dados, fator }. */
  nivel(fatPorPx) {
    let i = 0, fator = 1;
    while (i + 1 < this.niveis.length && fatPorPx / (fator * RAMO) >= 1) { i++; fator *= RAMO; }
    return { dados: this.niveis[i], fator };
  }

  noWorker() {
    const a = this.ix.audio;
    return new Promise((res) => {
      let w;
      try { w = new Worker(new URL('./onda-worker.js', import.meta.url), { type: 'module' }); }
      catch (_) { res(false); return; }
      this.w = w;
      let ultimoNiveis = 0;
      w.onmessage = (ev) => {
        const m = ev.data;
        if (!this.vivo) { w.terminate(); res(true); return; }
        if (m.tipo === 'parcial') {
          this.picos.set(m.dados, m.f0);
          this.feito = Math.max(this.feito, m.f0 + m.dados.length);
          // a pirâmide acompanha no máximo a cada 1 s (custa O(n))
          const agora = performance.now();
          if (agora - ultimoNiveis > 1000) { this.refazerNiveis(); ultimoNiveis = agora; }
          else if (this.niveis.length > 1) this.atualizarNiveis(m.f0, m.f0 + m.dados.length);
          this.aoProgresso(m.pct);
        } else if (m.tipo === 'fim') {
          this.picos = m.picos;
          this.refazerNiveis();
          this.pronto = true;
          this.feito = this.picos.length;
          w.terminate(); this.w = null;
          this.aoProgresso(1);
          res(true);
        } else if (m.tipo === 'semSuporte') {
          w.terminate(); this.w = null;
          res(false);
        } else if (m.tipo === 'erro') {
          this.erro = new Error(m.msg);
          w.terminate(); this.w = null;
          this.aoProgresso(1);
          res(true);
        }
      };
      w.onerror = () => { try { w.terminate(); } catch (_) { /* ok */ } this.w = null; res(false); };
      w.postMessage({
        tipo: 'calcular', blob: this.blob, duracaoUs: this.ix.duracaoUs, fatiasPorS: FATIAS_POR_S,
        audio: { codec: a.codec, descricao: a.descricao, taxa: a.taxa, canais: a.canais, n: a.n, dec: a.dec },
      });
    });
  }

  /** Atualiza só o trecho [f0, f1) dos níveis da pirâmide. */
  atualizarNiveis(f0, f1) {
    let a = f0, b = f1;
    for (let k = 1; k < this.niveis.length; k++) {
      const ant = this.niveis[k - 1], nv = this.niveis[k];
      a = Math.floor(a / RAMO); b = Math.min(nv.length, Math.ceil(b / RAMO));
      for (let i = a; i < b; i++) {
        let x = 0;
        const fim = Math.min(ant.length, (i + 1) * RAMO);
        for (let j = i * RAMO; j < fim; j++) if (ant[j] > x) x = ant[j];
        nv[i] = x;
      }
    }
  }

  /** Mesmo cálculo na thread principal (sem AudioDecoder em Worker), cedendo a vez a cada bloco. */
  async webcodecs() {
    const a = this.ix.audio;
    const cfg = { codec: a.codec, sampleRate: a.taxa, numberOfChannels: a.canais };
    if (a.descricao) cfg.description = a.descricao;
    let ok = false;
    try { ok = (await AudioDecoder.isConfigSupported(cfg)).supported; } catch (_) { ok = false; }
    if (!ok) return false;
    let erro = null;
    let ultimoAviso = 0;
    const dec = new AudioDecoder({
      output: (d) => {
        try { registrarPicos(this.picos, d, d.timestamp - DESLOC_AUDIO, FATIAS_POR_S, this); } finally { d.close(); }
      },
      error: (e) => { erro = e; },
    });
    dec.configure(cfg);
    try {
      await lerAmostras(this.blob, a.dec, 0, a.n, async (i, bytes) => {
        if (erro) throw erro;
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: a.dec.pts[i] + DESLOC_AUDIO, data: bytes }));
        if (dec.decodeQueueSize > 32) await new Promise((r) => setTimeout(r, 0));
        if (i - ultimoAviso > 400) { ultimoAviso = i; this.aoProgresso(i / a.n); }
      }, { cancelado: () => !this.vivo, maxBloco: 16 << 20 });
      if (this.vivo) await dec.flush();
    } finally { if (dec.state !== 'closed') dec.close(); }
    if (erro) throw erro;
    this.refazerNiveis();
    this.pronto = true;
    this.aoProgresso(1);
    return true;
  }

  async webaudio() {
    if (this.blob.size > 300 * 1048576) throw new Error('arquivo grande demais para a forma de onda sem WebCodecs');
    const ac = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100);
    const buf = await ac.decodeAudioData(await this.blob.arrayBuffer());
    const canais = [];
    for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) canais.push(buf.getChannelData(c));
    this.temAudio = true;
    const need = Math.ceil(buf.duration * FATIAS_POR_S) + 4;
    if (need > this.picos.length) this.picos = new Uint8Array(need);
    registrarCanais(this.picos, canais, buf.length, buf.sampleRate, 0, FATIAS_POR_S, this);
    this.refazerNiveis();
    this.pronto = true;
    this.aoProgresso(1);
  }

  liberar() {
    this.vivo = false;
    if (this.w) { try { this.w.terminate(); } catch (_) { /* ok */ } this.w = null; }
  }
}
