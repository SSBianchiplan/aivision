/**
 * cv/recorder.js — gravação do vídeo processado.
 *
 * ==================== QUAL FORMATO, E POR QUÊ ====================
 *
 * A pergunta "qual a melhor extensão" tem resposta objetiva quando o critério
 * é abrir em Windows, macOS, iOS e Android sem instalar nada:
 *
 *   MP4 com H.264 (avc1)  — abre em TODOS. Windows (Filmes e TV), QuickTime,
 *                           Fotos do iPhone, Galeria do Android, WhatsApp,
 *                           Premiere, DaVinci. É o denominador comum real.
 *
 *   WebM com VP8/VP9      — ótimo tecnicamente e menor, mas NÃO abre no
 *                           QuickTime nem no app Fotos do iOS. Mandar um
 *                           .webm para alguém de iPhone é mandar um arquivo
 *                           que a pessoa não consegue abrir.
 *
 * Então: MP4/H.264 quando o navegador souber gravar nisso, WebM só como
 * último recurso — e nesse caso a interface AVISA, em vez de entregar em
 * silêncio um arquivo que pode não abrir no destino.
 *
 * Quem grava MP4 nativamente hoje: Safari (macOS e iOS) desde sempre, e o
 * Chrome desde a versão 130. Chrome antigo e Firefox só fazem WebM.
 *
 * ==================== O QUE É GRAVADO ====================
 *
 * O CANVAS DE EXIBIÇÃO, não o stream cru da câmera. Ou seja: o vídeo sai com
 * as caixas de detecção, o esqueleto de pose, as máscaras e o texto do OCR
 * já embutidos. Gravar a câmera crua daria um arquivo bonito e inútil — o
 * valor deste sistema está no que ele desenha por cima.
 * =========================================================
 */

/** Candidatos em ordem de preferência. O primeiro suportado vence. */
const CANDIDATOS = [
  /*
   * Com áudio, o codec de áudio vai declarado: AAC (mp4a.40.2) é o que
   * QuickTime, Fotos do iPhone e WhatsApp abrem sem conversão. Opus em MP4
   * funciona no Chrome, mas o iPhone não toca — por isso vem depois.
   * O perfil de vídeo continua H.264 baseline 3.0, o mais compatível.
   */
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4', nome: 'MP4 · H.264 + AAC', universal: true, audio: true },
  { mime: 'video/mp4;codecs=avc1.42E01E,opus',      ext: 'mp4', nome: 'MP4 · H.264 + Opus', universal: false, audio: true },
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', nome: 'MP4 · H.264', universal: true },
  { mime: 'video/mp4;codecs=avc1',        ext: 'mp4', nome: 'MP4 · H.264', universal: true },
  { mime: 'video/mp4',                    ext: 'mp4', nome: 'MP4',         universal: true },
  { mime: 'video/webm;codecs=vp9,opus',   ext: 'webm', nome: 'WebM · VP9 + Opus', universal: false, audio: true },
  { mime: 'video/webm;codecs=vp9',        ext: 'webm', nome: 'WebM · VP9', universal: false },
  { mime: 'video/webm;codecs=vp8,opus',   ext: 'webm', nome: 'WebM · VP8 + Opus', universal: false, audio: true },
  { mime: 'video/webm;codecs=vp8',        ext: 'webm', nome: 'WebM · VP8', universal: false },
  { mime: 'video/webm',                   ext: 'webm', nome: 'WebM',       universal: false },
];

export function suportado() {
  return typeof MediaRecorder !== 'undefined'
      && typeof HTMLCanvasElement !== 'undefined'
      && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

/**
 * O melhor formato que este navegador grava. Null se não gravar nenhum.
 * Com `comAudio`, prefere os que declaram codec de áudio; sem trilha de
 * áudio, um MIME com codec de áudio declarado faria o MediaRecorder recusar.
 */
export function melhorFormato(comAudio = false) {
  if (typeof MediaRecorder === 'undefined') return null;
  const lista = CANDIDATOS.filter((c) => Boolean(c.audio) === Boolean(comAudio));
  for (const c of lista) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch (_) { /* navegador antigo lança em vez de devolver false */ }
  }
  // sem candidato exato: qualquer um que o navegador aceite
  for (const c of CANDIDATOS) {
    try { if (MediaRecorder.isTypeSupported(c.mime)) return c; } catch (_) { /* idem */ }
  }
  return null;
}

export class Recorder {
  constructor() {
    this.rec = null;
    this.chunks = [];
    this.formato = null;
    this.startedAt = 0;
    this.bytes = 0;
    this.onTick = null;
    this.timer = null;
    this.erro = null;
  }

  get gravando() {
    return Boolean(this.rec && this.rec.state === 'recording');
  }

  get pausado() {
    return Boolean(this.rec && this.rec.state === 'paused');
  }

  get segundos() {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  /**
   * Começa a gravar o canvas dado.
   * `fps` é o que se PEDE ao captureStream; o real acompanha o render.
   */
  start(canvas, { fps = 30, bitrate = 6_000_000, audioTrack = null } = {}) {
    if (this.gravando) return;
    if (!suportado()) throw new Error('Este navegador não grava vídeo (MediaRecorder ausente).');
    if (!canvas || !canvas.width) throw new Error('Sem imagem para gravar.');

    const fmt = melhorFormato(Boolean(audioTrack));
    if (!fmt) throw new Error('Nenhum formato de vídeo suportado por este navegador.');
    this.formato = fmt;
    this.comAudio = Boolean(audioTrack);

    /*
     * Vídeo do canvas + a trilha de áudio que veio de fora (cv/audio.js),
     * num MediaStream só. O canvas nunca tem som; quem decide de onde vem
     * o áudio é o chamador — aqui só se junta.
     */
    const video = canvas.captureStream(fps);
    const trilhas = [...video.getVideoTracks()];
    if (audioTrack) trilhas.push(audioTrack);
    const stream = new MediaStream(trilhas);

    this.chunks = [];
    this.bytes = 0;
    this.erro = null;

    this.rec = new MediaRecorder(stream, {
      mimeType: fmt.mime,
      videoBitsPerSecond: bitrate,
      audioBitsPerSecond: 128_000,
    });

    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        this.chunks.push(e.data);
        this.bytes += e.data.size;
      }
    };
    this.rec.onerror = (e) => {
      this.erro = String((e && e.error && e.error.message) || 'falha na gravação');
    };

    /*
     * Fatias de 1 s, em vez de um único blob no fim.
     *
     * Sem timeslice, uma gravação longa vive inteira na memória do
     * MediaRecorder e só materializa no stop — e se a aba morrer, perde-se
     * tudo. Com fatias, os pedaços já estão em mãos e o contador de tamanho
     * pode ser mostrado ao vivo.
     */
    this.rec.start(1000);
    this.startedAt = Date.now();

    this.timer = setInterval(() => { if (this.onTick) this.onTick(this); }, 250);
  }

  pause() {
    if (this.gravando && this.rec.pause) this.rec.pause();
  }

  resume() {
    if (this.pausado && this.rec.resume) this.rec.resume();
  }

  /** Encerra e devolve { blob, nome, formato, segundos }. */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.rec) return reject(new Error('Não há gravação em andamento.'));
      const fmt = this.formato;
      const dur = this.segundos;

      this.rec.onstop = () => {
        clearInterval(this.timer);
        this.timer = null;
        const blob = new Blob(this.chunks, { type: fmt.mime.split(';')[0] });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const nome = `iavision-${stamp}.${fmt.ext}`;
        this.rec = null;
        this.chunks = [];
        this.startedAt = 0;
        resolve({ blob, nome, formato: fmt, segundos: dur, bytes: blob.size, comAudio: this.comAudio });
      };

      try {
        this.rec.stop();
      } catch (err) {
        clearInterval(this.timer);
        this.rec = null;
        reject(err);
      }
    });
  }

  /** Descarta sem salvar. */
  cancel() {
    clearInterval(this.timer);
    this.timer = null;
    if (this.rec) {
      this.rec.onstop = null;
      try { this.rec.stop(); } catch (_) { /* já parado */ }
    }
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
    this.bytes = 0;
  }
}

/**
 * Salva o arquivo. Usa a caixa de diálogo nativa quando existe, para o
 * usuário escolher a pasta — no celular isso manda direto para Downloads
 * ou para o app de arquivos, em vez de um link que alguns navegadores
 * bloqueiam.
 */
export async function salvar({ blob, nome }) {
  if (window.showSaveFilePicker) {
    try {
      const h = await window.showSaveFilePicker({
        suggestedName: nome,
        types: [{
          description: nome.endsWith('.mp4') ? 'Vídeo MP4' : 'Vídeo WebM',
          accept: { [blob.type || 'video/mp4']: ['.' + nome.split('.').pop()] },
        }],
      });
      const w = await h.createWritable();
      await w.write(blob);
      await w.close();
      return 'escolhido';
    } catch (err) {
      // AbortError = o usuário cancelou; não é falha, e não deve virar download
      if (err && err.name === 'AbortError') return 'cancelado';
      // qualquer outro problema: cai para o download comum
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'baixado';
}

export function formatarBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(0) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

export function formatarTempo(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
