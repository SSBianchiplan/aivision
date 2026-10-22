/**
 * cv/speech/engine-server.js — legendas em fluxo pelo servidor (Vosk no VPS).
 *
 * ================= POR QUE ESTE É O MOTOR PADRÃO =================
 *
 * Dos três motores, é o único que junta as três coisas que "legenda ao vivo"
 * pede: reconhece em FLUXO (parciais palavra a palavra, finais a cada pausa),
 * funciona em QUALQUER aparelho (o iPhone não baixa nada nem processa nada),
 * e não manda o áudio para terceiro — vai do navegador para o SEU VPS, por
 * wss://, e morre lá.
 *
 * O nativo depende do Google e só ouve o microfone; o Whisper local é bom no
 * desktop mas pede 75 MB e transcreve em trechos. Este é o meio-termo que
 * simplesmente funciona.
 *
 * ================= O PROTOCOLO =================
 *
 * O mesmo do vosk-server oficial (tools/vps/asr_server.py):
 *
 *   -> {"config":{"sample_rate":16000}}     uma vez, ao abrir
 *   -> bytes PCM 16 bits little-endian mono  a cada ~100 ms
 *   <- {"partial":"..."}                    enquanto a pessoa fala
 *   <- {"text":"...","result":[...]}         quando fecha uma frase
 *   -> {"eof":1}                             ao parar, para receber o resto
 *
 * O áudio é capturado a 16 kHz num AudioWorklet — a taxa do modelo — e
 * convertido para inteiros de 16 bits aqui, porque é isso que o Vosk lê.
 * ================================================
 */

export const PADRAO_URL = 'wss://rtmp.gplansis.com/asr';

export function nome() { return 'servidor (Vosk no VPS)'; }

export function disponivel() {
  return typeof WebSocket !== 'undefined'
    && typeof window !== 'undefined'
    && Boolean(window.AudioContext || window.webkitAudioContext);
}

/** Sonda barata: o endpoint responde ao upgrade? Não abre áudio. */
export async function alcancavel(url = PADRAO_URL, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let ws;
    const t = setTimeout(() => { try { ws && ws.close(); } catch (_) { /* */ } resolve(false); }, timeoutMs);
    try {
      ws = new WebSocket(url);
      ws.onopen = () => { clearTimeout(t); try { ws.close(); } catch (_) { /* */ } resolve(true); };
      ws.onerror = () => { clearTimeout(t); resolve(false); };
    } catch (_) { clearTimeout(t); resolve(false); }
  });
}

export class MotorServidor {
  /**
   * @param stream  MediaStream com áudio (microfone ou fonte)
   * @param opts    { url, onResultado, onEstado }
   */
  constructor(stream, { url = PADRAO_URL, onResultado, onEstado } = {}) {
    this.stream = stream;
    this.url = url;
    this.onResultado = onResultado;
    this.onEstado = onEstado;
    this.ws = null;
    this.ctx = null;
    this.no = null;
    this.ativo = false;
    this.inicioTrecho = 0;
    this.fila = [];                 // PCM acumulado enquanto o socket ainda abre
  }

  async start() {
    if (this.ativo) return;
    if (!this.stream || !this.stream.getAudioTracks().length) {
      throw new Error('A fonte escolhida não tem trilha de áudio.');
    }
    this.ativo = true;
    this.onEstado && this.onEstado('carregando', 'conectando ao servidor de legendas');

    await this.#abrirSocket();
    await this.#capturar();
    this.inicioTrecho = Date.now();
    this.onEstado && this.onEstado('ouvindo');
  }

  #abrirSocket() {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(new Error('Endereço do servidor inválido: ' + this.url)); return; }
      ws.binaryType = 'arraybuffer';
      const t = setTimeout(() => {
        try { ws.close(); } catch (_) { /* */ }
        reject(new Error('O servidor de legendas não respondeu em 8 s (' + this.url + ').'));
      }, 8000);

      ws.onopen = () => {
        clearTimeout(t);
        ws.send(JSON.stringify({ config: { sample_rate: 16000 } }));
        for (const b of this.fila) ws.send(b);
        this.fila = [];
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error('Não foi possível conectar ao servidor de legendas. O VPS está de pé?'));
      };
      ws.onclose = (ev) => {
        if (!this.ativo) return;
        /*
         * Fechou com a gente ainda ativa: o servidor recusou (ocupado,
         * inatividade) ou a rede caiu. Não religa em laço — diz e para.
         * Religar sozinho num link ruim só produz legenda picada sem aviso.
         */
        this.onEstado && this.onEstado('erro',
          ev.code === 1013 ? 'O servidor de legendas está ocupado (limite de transcrições simultâneas). Tente em instantes.'
                           : 'A conexão com o servidor de legendas caiu (código ' + ev.code + ').');
        this.stop();
      };
      ws.onmessage = (ev) => this.#receber(ev.data);
      this.ws = ws;
    });
  }

  #receber(dado) {
    let m;
    try { m = JSON.parse(typeof dado === 'string' ? dado : new TextDecoder().decode(dado)); }
    catch (_) { return; }
    const agora = Date.now();
    if (m.error) {
      this.onEstado && this.onEstado('erro', 'Servidor: ' + (m.detalhe || m.error));
      this.stop();
      return;
    }
    if (typeof m.partial === 'string') {
      if (m.partial.trim() && this.onResultado) {
        this.onResultado({ texto: m.partial, final: false, inicio: this.inicioTrecho, fim: agora });
      }
      return;
    }
    if (typeof m.text === 'string') {
      if (m.text.trim() && this.onResultado) {
        // o Vosk dá o tempo de cada palavra; usamos a primeira e a última
        const r = Array.isArray(m.result) && m.result.length ? m.result : null;
        const ini = r ? this.inicioTrecho : this.inicioTrecho;
        const fim = agora;
        this.onResultado({ texto: m.text, final: true, inicio: ini, fim, confianca: r ? media(r) : null });
      }
      this.inicioTrecho = agora;
    }
  }

  async #capturar() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ sampleRate: 16000 });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const fonte = this.ctx.createMediaStreamSource(this.stream);

    const enviar = (pcm) => {
      if (!this.ativo) return;
      const i16 = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) {
        const v = Math.max(-1, Math.min(1, pcm[i]));
        i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(i16.buffer);
      else if (this.fila.length < 50) this.fila.push(i16.buffer);
    };

    if (this.ctx.audioWorklet) {
      /*
       * Blocos de 1600 amostras = 100 ms: pequeno o bastante para a parcial
       * parecer "ao vivo", grande o bastante para não afogar o socket.
       */
      const codigo = `
        class Captura extends AudioWorkletProcessor {
          constructor() { super(); this.buf = new Float32Array(1600); this.n = 0; }
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (!ch) return true;
            for (let i = 0; i < ch.length; i++) {
              this.buf[this.n++] = ch[i];
              if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(1600); this.n = 0; }
            }
            return true;
          }
        }
        registerProcessor('iav-captura-16k', Captura);`;
      const url = URL.createObjectURL(new Blob([codigo], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.no = new AudioWorkletNode(this.ctx, 'iav-captura-16k', { numberOfOutputs: 0 });
      this.no.port.onmessage = (e) => enviar(e.data);
      fonte.connect(this.no);
    } else {
      this.no = this.ctx.createScriptProcessor(2048, 1, 1);
      this.no.onaudioprocess = (e) => enviar(new Float32Array(e.inputBuffer.getChannelData(0)));
      fonte.connect(this.no);
      this.no.connect(this.ctx.destination);
    }
    this.fonteNo = fonte;
  }

  stop() {
    const estava = this.ativo;
    this.ativo = false;
    try { if (this.no) this.no.disconnect(); } catch (_) { /* */ }
    try { if (this.fonteNo) this.fonteNo.disconnect(); } catch (_) { /* */ }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    if (this.ws) {
      const ws = this.ws; this.ws = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          // pede o resto da frase antes de fechar; o servidor responde e encerra
          ws.onmessage = (ev) => this.#receber(ev.data);
          ws.send(JSON.stringify({ eof: 1 }));
          setTimeout(() => { try { ws.close(1000, 'fim'); } catch (_) { /* */ } }, 600);
        } else {
          ws.close();
        }
      } catch (_) { /* já fechado */ }
    }
    this.fila = [];
    if (estava && this.onEstado) this.onEstado('parado');
  }
}

function media(palavras) {
  const c = palavras.map((p) => (typeof p.conf === 'number' ? p.conf : null)).filter((x) => x !== null);
  return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null;
}
