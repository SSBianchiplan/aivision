/**
 * components/livres-u/busca.js — K4 Busca semântica em vídeo gravado.
 *
 * Indexa um arquivo: um quadro por segundo (passo ajustável) → MobileCLIP2-S0
 * (mclip2-visual, o mesmo do CV-15, pela fila única do ORT) → vetor de 512
 * normalizado. O índice (≈ 2 KB por segundo de vídeo) e a transcrição do
 * Whisper local (transcricao.js), quando existir, ficam no IndexedDB deste
 * navegador, por mídia (nome + tamanho). A busca combina o cosseno
 * imagem×texto (z-score dentro do vídeo) e as palavras da fala; cada resultado
 * leva ao instante no editor GPlanSiS|Vídeo. Nada sai do navegador.
 */
import { MODELS, run, runFeeds, makeTensor, ensureOrt, loadModel } from '../../cv/runtime/onnx.js';
import { cropResize, toTensorData } from '../../cv/runtime/tensor.js';
import { loadClipTokenizer } from '../../cv/runtime/clip_tokenizer.js';
import { ler, gravar } from '../../cv/runtime/livres-u/db.js';
import { buscarIndice } from '../../cv/runtime/livres-u/midia.js';
import { varrerVideo } from './editor.js';

export const chaveDe = (arq) => `${arq.nome}|${arq.blob.size}`;

function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }

/** Vetor da imagem (ImageData) — recorte quadrado central, como o pré-processo do CLIP. */
export async function vetorImagem(img) {
  const spec = MODELS['mclip2-visual'];
  const s = Math.min(img.width, img.height);
  const data = toTensorData(cropResize(img, (img.width - s) / 2, (img.height - s) / 2, s, s, spec.input[3], spec.input[2]), spec);
  const out = await run('mclip2-visual', await makeTensor(data, spec.input));
  return norm(out[Object.keys(out)[0]].data);
}

const cacheTexto = new Map();
export async function vetorTexto(frase) {
  if (cacheTexto.has(frase)) return cacheTexto.get(frase);
  await loadModel('mclip2-text');
  const tok = await loadClipTokenizer();
  const ort = await ensureOrt();
  const ids = BigInt64Array.from(Array.from(tok.encodeClip(frase, 77), (v) => BigInt(v)));
  const out = await runFeeds('mclip2-text', { input_ids: new ort.Tensor('int64', ids, [1, 77]) });
  const v = norm(out[Object.keys(out)[0]].data);
  cacheTexto.set(frase, v);
  return v;
}

/** Indexa `arq` ({blob, nome}). o = { passo (s), progresso(f), sinal }. Devolve o índice gravado. */
export async function indexarVideo(arq, o = {}) {
  await loadModel('mclip2-visual');
  const passo = o.passo || 1;
  const ts = [], vetores = [];
  const dur = await varrerVideo(arq.blob, passo, async (img, t) => { ts.push(t); vetores.push(await vetorImagem(img)); },
    { maxW: 384, sinal: o.sinal, progresso: o.progresso });
  const dim = vetores[0] ? vetores[0].length : 512;
  const emb = new Float32Array(ts.length * dim);
  vetores.forEach((v, i) => emb.set(v, i * dim));
  const ix = { ts, emb, dim, passo, dur, nome: arq.nome, criado: Date.now() };
  if (!(o.sinal && o.sinal.cancelar)) await gravar('indices', 'clip:' + chaveDe(arq), ix);
  return ix;
}

export async function indiceDe(arq) { return (await ler('indices', 'clip:' + chaveDe(arq))) || null; }
export async function falaDe(arq) { return (await ler('indices', 'fala:' + chaveDe(arq))) || null; }

/**
 * Busca `consulta` no índice da mídia. O CLIP foi treinado em inglês: frases em
 * inglês funcionam melhor ("a red truck at the gate"); o texto também é
 * procurado na transcrição (em português).
 */
export async function buscarNoVideo(arq, consulta, o = {}) {
  const ix = await indiceDe(arq);
  const fala = await falaDe(arq);
  const q = String(consulta || '').trim();
  if (!q) return [];
  const vetor = ix && o.imagem !== false ? await vetorTexto(o.molde ? o.molde.replace('{}', q) : `a photo of ${q}`) : null;
  return buscarIndice({ ts: ix ? ix.ts : [], emb: ix ? ix.emb : null, dim: ix ? ix.dim : 512, segs: fala ? fala.segs : [] }, { vetor, texto: q }, { k: o.k || 8 });
}
