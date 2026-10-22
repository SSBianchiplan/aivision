/**
 * cv/runtime/livres-b/florence.js — lado da thread principal do Florence-2.
 *
 * O modelo roda em florence-worker.js (ver lá o porquê). Este módulo guarda
 * UM worker por página, expõe o estado de carga no mesmo formato que o
 * onnx.js usa (status/progress/error/ep/ms) e transforma `run` em promessa.
 *
 * Pesos: onnx-community/Florence-2-base-ft (MIT, Microsoft), servidos do
 * próprio site em models/livres/b/florence2/ — nada vai ao Hugging Face.
 *
 * Mistura de precisões escolhida por teste no navegador (ver DTYPE): o
 * codificador visual e o embed em int8, codificador/decodificador de texto em
 * q4 — 227 MB no total, contra 1,1 GB em fp32.
 */

export const FLORENCE_ID = 'florence2';
const BASE = 'models/livres/b/';

/** Precisão de cada sub-modelo (sufixos do onnx-community: q8 = _quantized, q4 = _q4). */
export const DTYPE = {
  vision_encoder: 'q8',
  embed_tokens: 'q8',
  encoder_model: 'q4',
  decoder_model_merged: 'q4',
};

/** Arquivos que o DTYPE acima puxa, com o tamanho exato (para o painel Modelos). */
export const FLORENCE_FILES = {
  'config.json': 5432,
  'generation_config.json': 292,
  'preprocessor_config.json': 2673,
  'tokenizer.json': 2297961,
  'tokenizer_config.json': 197658,
  'onnx/vision_encoder_quantized.onnx': 93746540,
  'onnx/embed_tokens_quantized.onnx': 39390433,
  'onnx/encoder_model_q4.onnx': 30058778,
  'onnx/decoder_model_merged_q4.onnx': 64393474,
};

let worker = null;
let loadPromise = null;
let seq = 0;
const pend = new Map();
const st = { status: 'idle', progress: 0, error: null, ep: null, ms: 0 };
const listeners = new Set();

function emit() { for (const fn of listeners) fn({ ...st }); }
export function onFlorenceState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function florenceState() { return { ...st }; }
export function florenceReady() { return st.status === 'ready'; }

/**
 * Carrega (uma vez). `onProgress(0..1)` opcional — é a assinatura que um
 * `spec.loader` no onnx.js usaria para o painel Modelos.
 */
/*
 * Dispositivo: WASM, de propósito. Com estes pesos int8/q4 o WebGPU gerou
 * lixo (":<loc_659><loc_659>:", ": to: to to::") no mesmo teste em que o WASM
 * acertou a legenda — os kernels quantizados do WebGPU não são confiáveis.
 * WebGPU exigiria visão/embed em fp16 (+260 MB). Como roda num worker, o
 * WASM não trava o render; custa 4-12 s por resposta.
 */
export function loadFlorence(onProgress, { device = 'wasm', dtype = DTYPE } = {}) {
  if (loadPromise) return loadPromise;
  st.status = 'loading'; st.progress = 0; st.error = null; emit();
  loadPromise = new Promise((resolve, reject) => {
    worker = new Worker(new URL('./florence-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.type === 'progress') {
        st.progress = m.total ? m.loaded / m.total : 0;
        if (onProgress) onProgress(st.progress);
        emit();
      } else if (m.type === 'ready') {
        Object.assign(st, { status: 'ready', progress: 1, ep: m.device, ms: m.ms });
        emit();
        resolve(st);
      } else if (m.type === 'result' || (m.type === 'error' && m.id != null)) {
        const p = pend.get(m.id);
        if (p) { pend.delete(m.id); m.type === 'result' ? p.resolve(m) : p.reject(new Error(m.message)); }
      } else if (m.type === 'error') {
        Object.assign(st, { status: 'error', error: m.message });
        emit();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      const msg = 'worker do Florence falhou: ' + (e.message || 'erro desconhecido');
      Object.assign(st, { status: 'error', error: msg });
      emit();
      reject(new Error(msg));
    };
    worker.postMessage({
      type: 'load', modelId: FLORENCE_ID, dtype, device,
      base: new URL(BASE, document.baseURI).href,
    });
  });
  // erro de carga: deixa tentar de novo depois (ex.: rede caiu no meio)
  loadPromise.catch(() => { loadPromise = null; if (worker) worker.terminate(); worker = null; });
  return loadPromise;
}

/**
 * Uma geração. `image` é um ImageData — o buffer é COPIADO e transferido,
 * então o frame da câmera segue intacto na thread principal.
 */
export function runFlorence(image, task, text = '', maxTokens = 64) {
  if (!worker || st.status !== 'ready') return Promise.reject(new Error('Florence-2 não carregado'));
  const id = ++seq;
  const data = new Uint8ClampedArray(image.data);
  return new Promise((resolve, reject) => {
    pend.set(id, { resolve, reject });
    worker.postMessage({ type: 'run', id, task, text, maxTokens,
                         image: { data, width: image.width, height: image.height } }, [data.buffer]);
  });
}

/** Encerra o worker e libera a memória do modelo. */
export function unloadFlorence() {
  if (worker) worker.terminate();
  worker = null; loadPromise = null;
  for (const p of pend.values()) p.reject(new Error('Florence-2 descarregado'));
  pend.clear();
  Object.assign(st, { status: 'idle', progress: 0, error: null, ep: null, ms: 0 });
  emit();
}
