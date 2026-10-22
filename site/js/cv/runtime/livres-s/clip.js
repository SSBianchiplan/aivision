/**
 * cv/runtime/livres-s/clip.js — vetores do MobileCLIP2 (CV-15) para o
 * planograma (74): imagem → 512-d unitário; frase → 512-d unitário (cache).
 * Cópia local do pré/pós-processo de operators/zeroshot.js (lá não é
 * exportado) — mesmo modelo, mesma fila de inferência do ORT.
 */
import { MODELS, run, runFeeds, makeTensor, ensureOrt } from '../onnx.js';
import { cropResize, toTensorData } from '../tensor.js';
import { loadClipTokenizer } from '../clip_tokenizer.js';

export const VIS = 'mclip2-visual', TXT = 'mclip2-text';

export function normalizar(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / s;
  return o;
}

export function cosseno(a, b) {
  if (!a || !b || a.length !== b.length) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

const textos = new Map();
export async function vetorTexto(frase) {
  if (textos.has(frase)) return textos.get(frase);
  const tok = await loadClipTokenizer();
  const ort = await ensureOrt();
  const ids32 = tok.encodeClip(frase, 77);
  const ids = BigInt64Array.from(Array.from(ids32, (v) => BigInt(v)));
  const out = await runFeeds(TXT, { input_ids: new ort.Tensor('int64', ids, [1, 77]) });
  const v = normalizar(out[Object.keys(out)[0]].data.slice());
  textos.set(frase, v);
  return v;
}

/** Tensor (dados) de um recorte {x,y,w,h} (px de `img`) — síncrono, antes do primeiro await. */
export function dadosRecorte(img, r) {
  const spec = MODELS[VIS];
  return toTensorData(cropResize(img, r.x, r.y, Math.max(2, r.w), Math.max(2, r.h), spec.input[3], spec.input[2]), spec);
}

/** Vetor de imagem de dados já preparados por dadosRecorte. */
export async function vetorImagem(dados) {
  const spec = MODELS[VIS];
  const out = await run(VIS, await makeTensor(dados, spec.input));
  return normalizar(out[Object.keys(out)[0]].data.slice());
}

/** Probabilidades (softmax na escala do modelo) de um vetor de imagem contra vetores de texto. */
export function probabilidades(e, vecs) {
  const escala = (MODELS[VIS] && MODELS[VIS].logitScale) || 64.33;
  const l = vecs.map((v) => cosseno(e, v) * escala);
  const mx = Math.max(...l);
  const ex = l.map((x) => Math.exp(x - mx)), z = ex.reduce((a, b) => a + b, 0);
  return ex.map((x) => x / z);
}
