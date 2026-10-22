/**
 * components/livres-u/transcricao.js — Whisper LOCAL sobre um arquivo (M2 e K4).
 *
 * O áudio do arquivo é decodificado no navegador (decodeAudioData), vira mono a
 * 16 kHz (OfflineAudioContext) e vai inteiro para o Whisper do transformers.js
 * vendorizado (o mesmo de cv/speech/engine-whisper.js, com o mesmo ambiente),
 * em janelas de 30 s com sobreposição e marcas de tempo. Só o MODELO é baixado
 * (Hugging Face, cache do navegador); o áudio nunca sai da máquina.
 * O resultado fica no IndexedDB ('fala:' + mídia) para a busca do K4.
 */
import { MODELOS } from '../../cv/speech/engine-whisper.js';
import { gravar } from '../../cv/runtime/livres-u/db.js';
import { segmentosLegenda } from '../../cv/runtime/livres-u/midia.js';
import { chaveDe } from './busca.js';

let libP = null;
function lib() {
  if (libP) return libP;
  libP = import(new URL('../../../vendor/transformers.min.js', import.meta.url).href).then((m) => {
    m.env.allowLocalModels = false;
    m.env.useBrowserCache = true;
    if (m.env.backends && m.env.backends.onnx && m.env.backends.onnx.wasm) m.env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/';
    return m;
  }).catch((e) => { libP = null; throw e; });
  return libP;
}

const pipes = new Map();
async function pipeDe(modelo, progresso, forcar = null) {
  const chave = modelo + '|' + (forcar || 'auto');
  if (pipes.has(chave)) return pipes.get(chave);
  const { pipeline } = await lib();
  let dev = 'wasm';
  if (!forcar && navigator.gpu) { try { if (await navigator.gpu.requestAdapter()) dev = 'webgpu'; } catch (_) { /* wasm */ } }
  if (forcar) dev = forcar;
  const criar = (device) => pipeline('automatic-speech-recognition', MODELOS[modelo].id, {
    dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device,
    progress_callback: (p) => { if (progresso && p && typeof p.progress === 'number') progresso({ fase: 'modelo', pct: Math.round(p.progress), arquivo: p.file }); },
  });
  let p;
  try { p = await criar(dev); } catch (e) { if (dev !== 'webgpu') throw e; p = await criar('wasm'); }
  pipes.set(chave, p);
  return p;
}

/** Saída claramente errada? (marcas além da duração ou vazias, texto demais para a duração, muita escrita não latina) */
export function suspeita(saida, dur) {
  const ch = (saida && saida.chunks) || [];
  if (ch.some((c) => c.timestamp && c.timestamp[0] > dur + 2)) return true;
  if (ch.length > 1 && ch.some((c) => !c.timestamp || c.timestamp[0] == null)) return true;
  const t = String((saida && saida.text) || '');
  if (dur > 0 && t.length / dur > 35) return true;          // fala real: ~10–20 caracteres/s; laço de alucinação passa disso
  const letras = t.match(/\p{L}/gu) || [];
  const fora = letras.filter((c) => !/\p{Script=Latin}/u.test(c)).length;
  return letras.length > 20 && fora / letras.length > 0.2;
}

/** Áudio do arquivo → Float32Array mono 16 kHz. */
export async function audio16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let buf;
  try { buf = await ac.decodeAudioData(await blob.arrayBuffer()); }
  catch (_) { throw new Error('o arquivo não tem áudio legível por este navegador'); }
  finally { ac.close().catch(() => {}); }
  const n = Math.ceil(buf.duration * 16000);
  const off = new OfflineAudioContext(1, Math.max(1, n), 16000);
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  const r = await off.startRendering();
  return r.getChannelData(0);
}

/**
 * Transcreve `arq` ({blob, nome}). o = { modelo: 'tiny'|'base'|'small', idioma, dispositivo: 'auto'|'wasm', progresso({fase, pct}) }.
 * Devolve { segs: [{t0,t1,texto}], chunks, texto, modelo }.
 */
export async function transcreverArquivo(arq, o = {}) {
  const modelo = MODELOS[o.modelo] ? o.modelo : 'base';
  o.progresso && o.progresso({ fase: 'áudio', pct: 0 });
  const pcm = await audio16k(arq.blob);
  const opts = { language: o.idioma || 'pt', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: true };
  let pipe = await pipeDe(modelo, o.progresso, o.dispositivo === 'wasm' ? 'wasm' : null);
  o.progresso && o.progresso({ fase: 'transcrevendo', pct: 0 });
  let saida = await pipe(pcm, opts);
  let refeito = false;
  // WebGPU com driver/emulação ruim devolve lixo (tempos além do fim, texto em várias escritas): refaz no WASM
  if (o.dispositivo !== 'wasm' && suspeita(saida, pcm.length / 16000)) {
    o.progresso && o.progresso({ fase: 'refazendo na CPU (WASM)', pct: 0 });
    pipe = await pipeDe(modelo, o.progresso, 'wasm');
    saida = await pipe(pcm, opts);
    refeito = true;
  }
  const chunks = (saida && saida.chunks) || [{ timestamp: [0, pcm.length / 16000], text: (saida && saida.text) || '' }];
  const segs = segmentosLegenda(chunks, 42);
  const r = { segs, chunks, texto: String((saida && saida.text) || '').trim(), modelo, criado: Date.now(), dur: pcm.length / 16000, refeitoWasm: refeito };
  await gravar('indices', 'fala:' + chaveDe(arq), r);
  return r;
}
