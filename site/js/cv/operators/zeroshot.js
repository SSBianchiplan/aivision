/**
 * cv/operators/zeroshot.js — CV-15 Classificação zero-shot (MobileCLIP2-S0, Apple).
 *
 * Imagem e texto no mesmo espaço de 512-d: a classe é uma FRASE, não um índice.
 * "caixa amassada, caixa ok, prateleira vazia" vira três vetores de texto (uma
 * vez, em cache); a cada frame a imagem vira um vetor e o cosseno decide, com
 * softmax na escala do modelo (64,3). Sem treino. Modelo em inglês: frases em
 * inglês funcionam melhor; português simples também responde.
 *
 * Por objeto: com um detector antes na cadeia, classifica o RECORTE de cada
 * caixa — o detector diz "onde", o CLIP diz "o quê", com o seu vocabulário.
 */
import { clone } from '../core.js';
import { MODELS, run, runFeeds, makeTensor, ensureOrt } from '../runtime/onnx.js';
import { cropResize, toTensorData } from '../runtime/tensor.js';
import { ensure, schedule, detectionsFromCtx, colorFor, listaTexto } from '../runtime/opkit.js';
import { loadClipTokenizer } from '../runtime/clip_tokenizer.js';

const G = 'CV-15';
const textCache = new Map();          // frase -> Float32Array(512) unit-norm

function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }

async function encodeText(frase) {
  if (textCache.has(frase)) return textCache.get(frase);
  const tok = await loadClipTokenizer();
  const ort = await ensureOrt();
  const ids32 = tok.encodeClip(frase, 77);
  const ids = BigInt64Array.from(Array.from(ids32, (v) => BigInt(v)));
  const out = await runFeeds('mclip2-text', { input_ids: new ort.Tensor('int64', ids, [1, 77]) });
  const v = norm(out[Object.keys(out)[0]].data);
  textCache.set(frase, v);
  return v;
}

/** recorte quadrado central (lado menor), 256², como o pré-processo do CLIP */
function centroQuadrado(src, spec) {
  const s = Math.min(src.width, src.height);
  return toTensorData(cropResize(src, (src.width - s) / 2, (src.height - s) / 2, s, s, spec.input[3], spec.input[2]), spec);
}

export const clipClassify = {
  op: 'clip.classify',
  label: 'Zero-shot por texto (MobileCLIP2)',
  group: G, model: 'mclip2-visual', overlayOnly: true,
  desc: 'Classifica a cena — ou cada objeto detectado — contra frases que você ' +
        'escreve, sem treinar nada. Softmax sobre o cosseno imagem×texto.',
  params: {
    classes: { type: 'text', default: 'a person, a dog, a cat, a car, a cardboard box, a tool, an empty room', placeholder: 'frases separadas por vírgula', label: 'Classes (frases)' },
    modelo: { type: 'text', default: 'a photo of {}', placeholder: 'a photo of {}', label: 'Molde da frase ({} = classe)' },
    porObjeto: { type: 'bool', default: false, label: 'Classificar cada objeto detectado' },
    topK: { type: 'int', min: 1, max: 6, step: 1, default: 3, label: 'Mostrar top-k' },
    minimo: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0.2, label: 'Probabilidade mínima' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 400, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('mclip2-visual', state, ctx) || !ensure('mclip2-text', state, ctx)) return clone(src);
    const spec = MODELS['mclip2-visual'];
    const escala = spec.logitScale || 64.33;
    // vetores de texto: só quando a lista ou o molde mudam
    const chave = p.classes + '|' + p.modelo;
    if (state.chave !== chave && !state.codificando) {
      state.chave = chave; state.codificando = true;
      (async () => {
        const nomes = listaTexto(p.classes);
        const molde = p.modelo.includes('{}') ? p.modelo : p.modelo + ' {}';
        const vecs = [];
        for (const n of nomes) vecs.push(await encodeText(molde.replace('{}', n)));
        state.nomes = nomes; state.vecs = vecs;
      })().catch((e) => { state.error = String(e.message || e); }).finally(() => { state.codificando = false; });
    }
    if (!state.vecs || !state.vecs.length) { ctx.metrics['clip'] = 'codificando frases…'; return clone(src); }
    const dets = p.porObjeto ? detectionsFromCtx(ctx, 12) : null;

    schedule(state, p.everyMs,
      () => {
        if (dets) {
          const crops = dets.map((b) => {
            const x = b.x1 * src.width, y = b.y1 * src.height, w = (b.x2 - b.x1) * src.width, h = (b.y2 - b.y1) * src.height;
            return toTensorData(cropResize(src, x, y, Math.max(2, w), Math.max(2, h), spec.input[3], spec.input[2]), spec);
          });
          return { crops, dets, vecs: state.vecs, nomes: state.nomes };
        }
        return { crops: [centroQuadrado(src, spec)], dets: null, vecs: state.vecs, nomes: state.nomes };
      },
      async ({ crops, dets: ds, vecs, nomes }) => {
        const res = [];
        for (const data of crops) {
          const t = await makeTensor(data, spec.input);
          const out = await run('mclip2-visual', t);
          const e = norm(out[Object.keys(out)[0]].data);
          const logits = vecs.map((v) => { let s = 0; for (let i = 0; i < e.length; i++) s += e[i] * v[i]; return s * escala; });
          const mx = Math.max(...logits);
          const ex = logits.map((l) => Math.exp(l - mx)), z = ex.reduce((a, b) => a + b, 0);
          const probs = ex.map((v) => v / z);
          res.push(probs.map((pr, i) => ({ nome: nomes[i], p: pr })).sort((a, b) => b.p - a.p));
        }
        return { res, dets: ds };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['clip ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['clip erro'] = state.error;
    if (!R) return clone(src);
    const { w, h } = ctx;
    if (R.dets) {
      R.dets.forEach((b, i) => {
        const top = R.res[i] && R.res[i][0];
        if (!top || top.p < p.minimo) return;
        ctx.overlay.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: (b.x2 - b.x1) * w, h: (b.y2 - b.y1) * h,
                           color: colorFor(state.nomes.indexOf(top.nome)), label: `${top.nome} ${(top.p * 100) | 0}%` });
        b.clip = top.nome; b.clipP = top.p;
      });
      ctx.metrics['clip objetos'] = R.dets.length;
    } else {
      const lista = (R.res[0] || []).slice(0, p.topK).filter((r) => r.p >= p.minimo);
      lista.forEach((r, i) => ctx.overlay.push({ type: 'banner', x: 10, y: 10 + i * 22, text: `${r.nome}  ${(r.p * 100) | 0}%`, color: colorFor(state.nomes.indexOf(r.nome)) }));
      if (lista.length) ctx.metrics['cena'] = `${lista[0].nome} ${(lista[0].p * 100) | 0}%`;
      ctx.zeroshot = R.res[0];
    }
    return clone(src);
  },
};

export default [clipClassify];
