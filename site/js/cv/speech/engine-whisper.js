/**
 * cv/speech/engine-whisper.js — transcrição LOCAL, com Whisper no navegador.
 *
 * ================= POR QUE UM SEGUNDO MOTOR =================
 *
 * O nativo só ouve o microfone e, no Chrome, manda o áudio para fora. Este
 * ouve QUALQUER MediaStream — microfone, a aba capturada, o Osmo por HLS via
 * WebAudio — e processa tudo aqui, com o mesmo ONNX Runtime que o resto do
 * sistema já usa. Nada sai da máquina. É o motor coerente com um sistema
 * que trata dado sensível.
 *
 * O preço: um download de modelo na primeira vez (fica em cache) e um atraso
 * de alguns segundos, porque o Whisper transcreve TRECHOS, não fluxo — ele
 * precisa ouvir um pedaço inteiro antes de dizer o que era.
 *
 * ================= COMO O FLUXO VIRA TRECHO =================
 *
 * Um AudioWorklet (ou ScriptProcessor onde não há Worklet) recebe o áudio a
 * 16 kHz mono — a taxa nativa do Whisper — e acumula numa janela. A cada
 * `janelaS` segundos a janela fecha e vai para o modelo. Janela sem energia
 * (RMS abaixo do limiar) é descartada sem inferência: silêncio custa zero e
 * não vira alucinação, que é o defeito conhecido do Whisper com entrada vazia.
 *
 * Enquanto a janela ainda está aberta, não há texto provisório como no
 * nativo — a legenda ao vivo mostra "…ouvindo" para a pessoa saber que o
 * motor está de pé.
 *
 * ================= O MODELO =================
 *
 *   whisper-tiny   ~40 MB  rápido, fraco em português — bom para testar
 *   whisper-base   ~75 MB  o equilíbrio: entende pt-BR, roda em laptop
 *   whisper-small  ~250 MB melhor qualidade; só com WebGPU faz sentido
 *
 * Padrão: base. Quantizado (q8), do repositório onnx-community, servido pelo
 * Hugging Face com CORS — e cacheado pelo navegador depois da primeira vez.
 * =============================================================
 */

const MODELOS = {
  tiny:  { id: 'onnx-community/whisper-tiny',  nome: 'Whisper tiny · ~40 MB',  mb: 40 },
  base:  { id: 'onnx-community/whisper-base',  nome: 'Whisper base · ~75 MB',  mb: 75 },
  small: { id: 'onnx-community/whisper-small', nome: 'Whisper small · ~250 MB', mb: 250 },
};
export { MODELOS };

export function nome() { return 'local (Whisper)'; }

export function disponivel() {
  return typeof window !== 'undefined'
    && Boolean(window.AudioContext || window.webkitAudioContext)
    && typeof WebAssembly !== 'undefined';
}

let libPromise = null;

/** Carrega o transformers.js vendorizado, uma vez. */
async function lib() {
  if (libPromise) return libPromise;
  libPromise = import(new URL('../../../vendor/transformers.min.js', import.meta.url).href)
    .then((m) => {
      /*
       * O runtime WASM do transformers.js vem do jsdelivr, que responde com
       * Cross-Origin-Resource-Policy: cross-origin — o que a página, em
       * isolamento (COEP require-corp), exige para aceitar. Verificado por
       * cabeçalho antes de fixar aqui.
       */
      m.env.allowLocalModels = false;
      m.env.useBrowserCache = true;
      if (m.env.backends && m.env.backends.onnx && m.env.backends.onnx.wasm) {
        m.env.backends.onnx.wasm.wasmPaths =
          'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/';
      }
      return m;
    });
  return libPromise;
}

export class MotorWhisper {
  /**
   * @param stream   MediaStream com ao menos uma trilha de áudio
   * @param opts     { modelo: 'tiny'|'base'|'small', idioma: 'pt', janelaS, onResultado, onEstado, onProgresso }
   */
  constructor(stream, {
    modelo = 'base', idioma = 'pt', janelaS = 6,
    onResultado, onEstado, onProgresso,
  } = {}) {
    this.stream = stream;
    this.modelo = MODELOS[modelo] ? modelo : 'base';
    this.idioma = idioma;
    this.janelaS = Math.max(3, Math.min(15, janelaS));
    this.onResultado = onResultado;
    this.onEstado = onEstado;
    this.onProgresso = onProgresso;

    this.ctx = null;
    this.pipe = null;
    this.buf = [];
    this.amostras = 0;
    this.inicioJanela = 0;
    this.ativo = false;
    this.fila = Promise.resolve();
  }

  async start() {
    if (this.ativo) return;
    if (!this.stream || !this.stream.getAudioTracks().length) {
      throw new Error('A fonte escolhida não tem trilha de áudio.');
    }
    this.ativo = true;
    this.onEstado && this.onEstado('carregando', MODELOS[this.modelo].nome);

    const { pipeline } = await lib();
    const criar = (device) => pipeline('automatic-speech-recognition', MODELOS[this.modelo].id, {
      dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
      device,
      progress_callback: (p) => {
        if (this.onProgresso && p && typeof p.progress === 'number') {
          this.onProgresso({ arquivo: p.file, pct: Math.round(p.progress) });
        }
      },
    });
    const dispositivo = await this.#dispositivo();
    try {
      this.pipe = await criar(dispositivo);
    } catch (err) {
      // WebGPU novo (Safari 26) ou driver ruim: a sessão q8 pode não subir — tenta no WASM
      if (dispositivo !== 'webgpu') throw err;
      console.warn('[whisper] WebGPU falhou, usando WASM:', err && err.message);
      this.pipe = await criar('wasm');
    }
    if (!this.ativo) return;            // parado durante o download

    await this.#capturar();
    this.onEstado && this.onEstado('ouvindo');
  }

  async #dispositivo() {
    // WebGPU quando existe: o decoder do Whisper é o que mais pesa
    if (navigator.gpu) {
      try { if (await navigator.gpu.requestAdapter()) return 'webgpu'; } catch (_) { /* wasm */ }
    }
    return 'wasm';
  }

  async #capturar() {
    const AC = window.AudioContext || window.webkitAudioContext;
    // 16 kHz direto: evita reamostrar depois
    this.ctx = new AC({ sampleRate: 16000 });
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const fonte = this.ctx.createMediaStreamSource(this.stream);
    this.inicioJanela = Date.now();

    const receber = (pcm) => {
      if (!this.ativo) return;
      this.buf.push(pcm);
      this.amostras += pcm.length;
      if (this.amostras >= this.janelaS * this.ctx.sampleRate) this.#fecharJanela();
    };

    if (this.ctx.audioWorklet) {
      const codigo = `
        class Captura extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0] && inputs[0][0];
            if (ch) this.port.postMessage(new Float32Array(ch));
            return true;
          }
        }
        registerProcessor('iav-captura', Captura);`;
      const url = URL.createObjectURL(new Blob([codigo], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.no = new AudioWorkletNode(this.ctx, 'iav-captura', { numberOfOutputs: 0 });
      this.no.port.onmessage = (e) => receber(e.data);
      fonte.connect(this.no);
    } else {
      // Safari antigo: ScriptProcessor, obsoleto mas funciona
      this.no = this.ctx.createScriptProcessor(4096, 1, 1);
      this.no.onaudioprocess = (e) => receber(new Float32Array(e.inputBuffer.getChannelData(0)));
      fonte.connect(this.no);
      this.no.connect(this.ctx.destination);   // exigido pelo Chrome para processar; silencioso
    }
    this.fonteNo = fonte;
  }

  #fecharJanela() {
    const total = this.amostras;
    const pcm = new Float32Array(total);
    let o = 0;
    for (const b of this.buf) { pcm.set(b, o); o += b.length; }
    this.buf = [];
    this.amostras = 0;
    const inicio = this.inicioJanela;
    const fim = Date.now();
    this.inicioJanela = fim;

    /*
     * Portão de energia. Whisper com silêncio inventa frases ("Obrigado por
     * assistir", "Legendas pela comunidade…") — é um defeito conhecido do
     * modelo, treinado em legendas de vídeo. Janela quase muda não entra.
     */
    let soma = 0;
    for (let i = 0; i < pcm.length; i++) soma += pcm[i] * pcm[i];
    const rms = Math.sqrt(soma / Math.max(1, pcm.length));
    if (rms < 0.006) return;

    // uma inferência por vez, em ordem: a fila serializa
    this.fila = this.fila.then(() => this.#transcrever(pcm, inicio, fim)).catch(() => {});
  }

  async #transcrever(pcm, inicio, fim) {
    if (!this.ativo || !this.pipe) return;
    this.onEstado && this.onEstado('transcrevendo');
    try {
      const saida = await this.pipe(pcm, {
        language: this.idioma,
        task: 'transcribe',
        chunk_length_s: 30,
        return_timestamps: false,
      });
      const texto = String(saida && saida.text || '').trim();
      if (texto && this.onResultado) {
        this.onResultado({ texto, final: true, inicio, fim, confianca: null });
      }
    } catch (err) {
      this.onEstado && this.onEstado('erro', 'Falha na transcrição: ' + (err.message || err));
    } finally {
      if (this.ativo) this.onEstado && this.onEstado('ouvindo');
    }
  }

  stop() {
    this.ativo = false;
    try { if (this.no) this.no.disconnect(); } catch (_) { /* já */ }
    try { if (this.fonteNo) this.fonteNo.disconnect(); } catch (_) { /* já */ }
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    this.buf = []; this.amostras = 0;
    this.onEstado && this.onEstado('parado');
  }
}
