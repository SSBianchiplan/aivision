/**
 * cv/runtime/livres-b/florence-worker.js — Florence-2 (MIT) num Web Worker.
 *
 * ================= POR QUE UM WORKER PRÓPRIO =================
 *
 * 1. AMBIENTE ISOLADO. O `env` do transformers.js é um objeto global do
 *    módulo. O Whisper (speech/engine-whisper.js) usa o mesmo arquivo com
 *    allowLocalModels=false e pesos do Hugging Face. O Florence precisa do
 *    oposto: pesos SÓ do próprio site (a página roda com COEP require-corp e
 *    a decisão é não depender do HF). Num worker, o import cria outra
 *    instância do módulo — cada um configura o seu `env` sem pisar no outro.
 *
 * 2. NÃO TRAVA O RENDER. Uma geração do Florence são dezenas de passos do
 *    decodificador mais um codificador visual de 768² — segundos de WASM.
 *    O transformers.js não liga o `proxy` do ORT; aqui o worker inteiro é o
 *    proxy, e a thread principal só desenha.
 *
 * Protocolo (postMessage):
 *   → { type:'load', base, dtype, device }
 *   ← { type:'progress', loaded, total } … { type:'ready', device, ms }
 *   → { type:'run', id, task, text, maxTokens, image:{ data, width, height } }
 *   ← { type:'result', id, task, raw, result, ms }   ou   { type:'error', id, message }
 * ============================================================
 */

const LIB = new URL('../../../../vendor/transformers.min.js', import.meta.url).href;

let T = null;          // módulo transformers.js
let model = null, processor = null, tokenizer = null;
let device = 'wasm';

async function carregar({ base, dtype, device: pedido, modelId }) {
  const t0 = performance.now();
  T = await import(LIB);
  const env = T.env;
  /*
   * Só arquivos locais: localModelPath + 'florence2/…' vira
   * /models/livres/b/florence2/config.json etc. allowRemoteModels=false
   * garante que um arquivo faltando dá erro claro em vez de ir ao HF.
   */
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = base;
  env.useBrowserCache = true;
  if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
    // mesmo runtime WASM que o Whisper usa (jsdelivr responde com CORP cross-origin)
    env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/dist/';
    env.backends.onnx.wasm.numThreads = Math.min(4, (self.navigator && navigator.hardwareConcurrency) || 2);
  }

  device = pedido === 'webgpu' || (pedido === 'auto' && self.navigator && 'gpu' in navigator && (await temAdaptador()))
    ? 'webgpu' : 'wasm';

  // progresso por bytes somados de todos os arquivos
  const vistos = new Map();
  const progress_callback = (p) => {
    if (!p || p.status !== 'progress' || !p.total) return;
    vistos.set(p.file, { loaded: p.loaded, total: p.total });
    let loaded = 0, total = 0;
    for (const v of vistos.values()) { loaded += v.loaded; total += v.total; }
    postMessage({ type: 'progress', loaded, total });
  };

  const opts = { local_files_only: true, progress_callback };
  [model, processor, tokenizer] = await Promise.all([
    T.Florence2ForConditionalGeneration.from_pretrained(modelId, { ...opts, dtype, device }),
    T.AutoProcessor.from_pretrained(modelId, opts),
    T.AutoTokenizer.from_pretrained(modelId, opts),
  ]);
  return { device, ms: performance.now() - t0 };
}

async function temAdaptador() {
  try { return Boolean(await navigator.gpu.requestAdapter()); } catch (_) { return false; }
}

async function rodar({ task, text, maxTokens, image }) {
  const t0 = performance.now();
  const img = new T.RawImage(new Uint8ClampedArray(image.data), image.width, image.height, 4).rgb();
  // tarefas com entrada levam o texto colado ao token: '<CAPTION_TO_PHRASE_GROUNDING>a red car'
  const prompts = processor.construct_prompts(text ? task + text : task);
  const textInputs = tokenizer(prompts);
  const visionInputs = await processor(img);
  const ids = await model.generate({
    ...textInputs, ...visionInputs,
    max_new_tokens: maxTokens,
    num_beams: 1, do_sample: false,     // guloso: busca em feixe custaria 3× no navegador
  });
  const raw = tokenizer.batch_decode(ids, { skip_special_tokens: false })[0];
  const post = processor.post_process_generation(raw, task, img.size);
  return { raw, result: post[task], ms: performance.now() - t0 };
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  try {
    if (m.type === 'load') {
      const r = await carregar(m);
      postMessage({ type: 'ready', ...r });
    } else if (m.type === 'run') {
      const r = await rodar(m);
      postMessage({ type: 'result', id: m.id, task: m.task, ...r });
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id ?? null, phase: m.type, message: String(err && err.message ? err.message : err) });
  }
};
