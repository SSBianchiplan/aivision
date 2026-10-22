/**
 * components/motion3d/gravador.js — exportação de vídeo e imagens do Motion 3D Studio v2.
 *
 *   gravarAoVivo(canvas)        MediaRecorder sobre canvas.captureStream (o que o navegador
 *                               aceitar: MP4/H.264 ou WebM/VP9/VP8 — melhorFormato do iaVision);
 *   exportarMP4(...)            quadro a quadro de uma tomada, exato: WebCodecs (VideoEncoder) +
 *                               mp4-muxer 5.2.2 (já vendorizado pelo editor de vídeo);
 *   exportarPNGzip(...)         sequência PNG COM ALFA (fundo transparente) num .zip sem
 *                               compressão (o PNG já é comprimido) — escritor ZIP mínimo aqui.
 * O vídeo não guarda transparência (o suporte a alfa em MediaRecorder/WebCodecs não é confiável):
 * para compor com fundo, use a sequência PNG ou o fundo chroma.
 */
import { Muxer, ArrayBufferTarget } from '../../../vendor/mp4-muxer-5.2.2.mjs';
import { melhorFormato } from '../../cv/recorder.js';

/** Grava o canvas ao vivo. Devolve { parar(): Promise<{ blob, ext, mime }>, formato }. */
export function gravarAoVivo(canvas, fps = 30, bitrate = 8_000_000, preferir = null) {
  let fmt = null;
  if (preferir === 'webm') for (const mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) { try { if (MediaRecorder.isTypeSupported(mime)) { fmt = { mime, ext: 'webm', nome: 'WebM' }; break; } } catch (_) { /* próximo */ } }
  if (!fmt) fmt = melhorFormato(false);
  if (!fmt || !canvas.captureStream) throw new Error('Este navegador não grava o canvas (MediaRecorder).');
  const stream = canvas.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bitrate });
  const partes = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) partes.push(e.data); };
  rec.start(500);
  const t0 = performance.now();
  return {
    formato: fmt,
    inicio: t0,
    parar: () => new Promise((ok) => {
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); ok({ blob: new Blob(partes, { type: fmt.mime }), ext: fmt.ext, mime: fmt.mime, segundos: (performance.now() - t0) / 1000 }); };
      rec.stop();
    }),
  };
}

const par = (v) => Math.max(2, Math.round(v / 2) * 2);

/**
 * MP4 exato quadro a quadro: `desenhar(i)` deixa o quadro i pronto no `canvas` (já no tamanho
 * de saída, par). `aoProgresso(f)` de 0 a 1. Devolve Blob video/mp4.
 */
export async function exportarMP4({ canvas, n, fps = 30, desenhar, aoProgresso = () => {}, bitrate = 6_000_000 }) {
  if (typeof VideoEncoder === 'undefined') throw new Error('Este navegador não tem WebCodecs (VideoEncoder): use a gravação ao vivo (WebM).');
  const W = par(canvas.width), H = par(canvas.height);
  let cfg = null;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42001f']) {
    const c = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (_) { /* próximo */ }
  }
  if (!cfg) throw new Error(`O navegador não codifica H.264 em ${W}×${H}.`);
  const alvo = new ArrayBufferTarget();
  const muxer = new Muxer({ target: alvo, video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let erro = null;
  const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { erro = e; } });
  enc.configure(cfg);
  const passo = 1e6 / fps;
  for (let i = 0; i < n; i++) {
    if (erro) throw erro;
    await desenhar(i);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * passo), duration: Math.round(passo) });
    enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
    if (i % 5 === 0) { aoProgresso(i / n); await new Promise((r) => setTimeout(r, 0)); }   // sem long task
  }
  await enc.flush();
  enc.close();
  muxer.finalize();
  aoProgresso(1);
  return new Blob([alvo.buffer], { type: 'video/mp4' });
}

// ------------------------------------------------------------------ ZIP (store) mínimo

const TAB = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = TAB[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Monta um .zip (método store) de [{ nome, dados: Uint8Array }]. */
export function montarZip(arquivos) {
  const enc = new TextEncoder();
  const locais = [], centrais = [];
  let off = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome), crc = crc32(a.dados), n = a.dados.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true);
    h.setUint16(26, nome.length, true); h.setUint16(28, 0, true);
    locais.push(new Uint8Array(h.buffer), nome, a.dados);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true);
    c.setUint16(28, nome.length, true); c.setUint32(42, off, true);
    centrais.push(new Uint8Array(c.buffer), nome);
    off += 30 + nome.length + n;
  }
  const tamC = centrais.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamC, true); fim.setUint32(16, off, true);
  return new Blob([...locais, ...centrais, new Uint8Array(fim.buffer)], { type: 'application/zip' });
}

/** Sequência PNG (com alfa, se o canvas for transparente) num .zip. */
export async function exportarPNGzip({ canvas, n, desenhar, prefixo = 'quadro', aoProgresso = () => {} }) {
  const arqs = [];
  for (let i = 0; i < n; i++) {
    await desenhar(i);
    const b = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
    arqs.push({ nome: `${prefixo}_${String(i + 1).padStart(4, '0')}.png`, dados: new Uint8Array(await b.arrayBuffer()) });
    if (i % 3 === 0) aoProgresso(i / n);
  }
  aoProgresso(1);
  return montarZip(arqs);
}
