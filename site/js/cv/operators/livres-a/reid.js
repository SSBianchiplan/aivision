/**
 * cv/operators/livres-a/reid.js — CV-19 Re-identificação de pessoas
 * (Youtu ReID via OpenCV Zoo, Apache-2.0, pesos w8).
 *
 * O tracking do CV-04 casa caixas por IoU: se a pessoa some atrás de uma
 * coluna ou sai de cena e volta, ganha um ID novo. Aqui o ID é da APARÊNCIA:
 * cada pessoa vira um vetor de 768 números (roupa, cores, silhueta), e quem
 * aparece é comparado por cosseno com uma galeria de identidades já vistas.
 * Substitui o re-ID do YOLO26, que não exporta para ONNX.
 *
 *   - caixas de pessoa vêm do detector anterior na cadeia (ctx.detections:
 *     YOLOX, RTMO, YOLO26…); sem detector, roda o YOLOX sozinho;
 *   - cada recorte vai esticado para 128×256, todos num lote só;
 *   - associação gulosa pela maior similaridade, um ID por pessoa por frame;
 *     abaixo do limiar nasce um ID novo;
 *   - a galeria guarda a MÉDIA MÓVEL do embedding (renormalizada), então o ID
 *     se adapta devagar a mudanças de pose e luz sem "trocar de dono".
 *
 * Validado na VPS com o ReID_extra_testdata (Market-1501): cosseno entre
 * fotos da mesma pessoa em câmeras diferentes 0,66-0,93; entre pessoas
 * diferentes ≤ 0,48 (média 0,13). Limiar padrão 0,55. O w8 dá cosseno
 * 0,9998 contra o fp32 original.
 *
 * Re-ID é por roupa, não por rosto: duas pessoas de uniforme igual tendem a
 * se confundir, e a mesma pessoa que tira o casaco vira outra.
 *
 * Reescreve ctx.detections com `id` (como o tracking) e publica ctx.reid.
 */
import { clone, snapshot } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { cropResize, toTensorData } from '../../runtime/tensor.js';
import { ensure, schedule, colorFor, iou, detectYolox } from '../../runtime/opkit.js';

const G = 'CV-19';
const M = 'reid-youtu';
const PESSOA = /^(pessoa|person|people|pedestre|humano)/i;

function normaliza(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = 1 / Math.sqrt(s || 1);
  for (let i = 0; i < v.length; i++) v[i] *= s;
  return v;
}
function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

export const reidPessoas = {
  op: 'reid.pessoas',
  label: 'Re-ID de pessoas (aparência)',
  group: G, model: M, overlayOnly: true,
  desc: 'IDs persistentes por aparência: a mesma pessoa mantém o número depois de oclusão ou ' +
        'de sair e voltar à cena. Usa as caixas do detector anterior (YOLOX, RTMO…) — ou o YOLOX ' +
        'sozinho — e uma galeria de embeddings de 768-d com média móvel e cosseno.',
  params: {
    limiar: { type: 'float', min: 0.3, max: 0.9, step: 0.01, default: 0.55, label: 'Similaridade mín. (cosseno)' },
    momento: { type: 'float', min: 0, max: 0.98, step: 0.02, default: 0.9, label: 'Inércia da galeria (média móvel)' },
    minScore: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.4, label: 'Score mín. da pessoa' },
    minAltura: { type: 'float', min: 0, max: 0.5, step: 0.01, default: 0.08, label: 'Altura mín. (fração do frame)' },
    maxPessoas: { type: 'int', min: 1, max: 32, step: 1, default: 12, label: 'Máx. pessoas por frame' },
    esquecerS: { type: 'int', min: 0, max: 3600, step: 10, default: 600, label: 'Esquecer ID após (s, 0 = nunca)' },
    maxGaleria: { type: 'int', min: 4, max: 500, step: 1, default: 100, label: 'Tamanho máx. da galeria' },
    soPessoas: { type: 'bool', default: true, label: 'Só pessoas (ignora outras classes)' },
    limpar: { type: 'bool', default: false, label: 'Limpar galeria (ligue e desligue)' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 150, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!state.gal) { state.gal = []; state.proxId = 1; }
    if (p.limpar) { state.gal = []; state.proxId = 1; state.results = null; ctx.metrics['reid'] = 'galeria limpa'; return clone(src); }
    if (!ensure(M, state, ctx)) return clone(src);

    /*
     * Detector na cadeia = ctx.detections é um array (mesmo vazio). Sem ele,
     * espera 10 s antes de baixar o YOLOX próprio: o detector anterior pode
     * estar só baixando o peso dele (o RTMO, por exemplo, não publica nada
     * até carregar) e baixar 35 MB à toa é pior que esperar.
     */
    const agora0 = performance.now();
    if (!state.inicio) state.inicio = agora0;
    const dets = Array.isArray(ctx.detections) ? ctx.detections.slice(0, 64) : null;
    if (dets) state.ultimoDet = agora0;
    const proprio = !dets && agora0 - (state.ultimoDet || state.inicio) > 10000;
    if (!dets && !proprio) { ctx.metrics['reid'] = 'aguardando detector na cadeia…'; return clone(src); }
    if (proprio && !ensure('yolox', state, ctx)) return clone(src);
    const filtra = (ds) => ds.filter((d) => (!p.soPessoas || PESSOA.test(d.name || '')) && (d.score === undefined || d.score >= p.minScore)
                                   && d.y2 - d.y1 >= p.minAltura).slice(0, p.maxPessoas);
    const spec = MODELS[M];
    const [, , RH, RW] = spec.input;

    schedule(state, p.everyMs,
      () => {
        const ds = dets ? filtra(dets).map((d) => ({ ...d })) : null;
        if (ds && !ds.length) return null;               // ninguém na cena: nada a inferir
        return { frame: snapshot(src), dets: ds, q: { ...p } };
      },
      async ({ frame, dets: ds, q }) => {
        const w = frame.width, h = frame.height;
        if (!ds) ds = filtra(await detectYolox(frame, q.minScore, 32));
        if (!ds.length) return { boxes: [], t: performance.now() };
        // lote [N,3,256,128]
        const plano = 3 * RH * RW, lote = new Float32Array(ds.length * plano);
        ds.forEach((d, i) => {
          const x = Math.max(0, d.x1 * w), y = Math.max(0, d.y1 * h);
          const bw = Math.min(w, d.x2 * w) - x, bh = Math.min(h, d.y2 * h) - y;
          lote.set(toTensorData(cropResize(frame, x, y, Math.max(1, bw), Math.max(1, bh), RW, RH), spec), i * plano);
        });
        const out = await run(M, await makeTensor(lote, [ds.length, 3, RH, RW]));
        const o = out[Object.keys(out)[0]], D = o.dims[1];
        const embs = ds.map((_, i) => normaliza(Float32Array.from(o.data.subarray(i * D, (i + 1) * D))));

        // ---- associação com a galeria (a galeria vive no state: este callback é o único que a muda)
        const agora = performance.now();
        if (q.esquecerS > 0) state.gal = state.gal.filter((g) => agora - g.visto < q.esquecerS * 1000);
        const pares = [];
        embs.forEach((e, i) => state.gal.forEach((g, j) => {
          let s = dot(e, g.emb);
          // desempate leve: quem estava no mesmo lugar há pouco tempo ganha 0,03
          if (agora - g.visto < 2000 && iou(ds[i], g.box) > 0.3) s += 0.03;
          if (s >= q.limiar) pares.push([s, i, j]);
        }));
        pares.sort((a, b) => b[0] - a[0]);
        const usadosI = new Set(), usadosJ = new Set(), sim = new Array(ds.length).fill(0), ids = new Array(ds.length).fill(0);
        for (const [s, i, j] of pares) {
          if (usadosI.has(i) || usadosJ.has(j)) continue;
          usadosI.add(i); usadosJ.add(j);
          const g = state.gal[j];
          const m = q.momento;
          for (let k = 0; k < D; k++) g.emb[k] = m * g.emb[k] + (1 - m) * embs[i][k];
          normaliza(g.emb);
          g.visto = agora; g.box = { x1: ds[i].x1, y1: ds[i].y1, x2: ds[i].x2, y2: ds[i].y2 }; g.vezes++;
          ids[i] = g.id; sim[i] = Math.min(1, s);
        }
        for (let i = 0; i < ds.length; i++) {
          if (ids[i]) continue;
          const g = { id: state.proxId++, emb: embs[i], visto: agora, criado: agora, vezes: 1,
                      box: { x1: ds[i].x1, y1: ds[i].y1, x2: ds[i].x2, y2: ds[i].y2 } };
          state.gal.push(g); ids[i] = g.id; sim[i] = null;   // null = ID nascido agora
        }
        // galeria cheia: sai quem foi visto há mais tempo
        if (state.gal.length > q.maxGaleria) {
          state.gal.sort((a, b) => b.visto - a.visto);
          state.gal.length = q.maxGaleria;
        }
        return { boxes: ds.map((d, i) => ({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, score: d.score, name: d.name || 'pessoa', id: ids[i], sim: sim[i] })), t: agora };
      });

    if (state.inferMs) ctx.metrics['reid ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['reid erro'] = state.error;
    const R = state.results;
    if (!R) return clone(src);

    // o resultado chega atrasado: as caixas DESTE frame herdam o ID da caixa
    // inferida que mais se sobrepõe (sem detector próprio, usa as inferidas)
    let saida;
    if (!proprio) {
      saida = filtra(dets).map((d) => {
        let best = null, bi = 0.3;
        for (const r of R.boxes) { const v = iou(d, r); if (v > bi) { bi = v; best = r; } }
        return best ? { ...d, id: best.id, sim: best.sim } : { ...d };
      });
    } else saida = R.boxes.map((b) => ({ ...b }));

    const { w, h } = ctx;
    for (const d of saida) {
      if (!d.id) continue;
      ctx.overlay.push({ type: 'rect', x: d.x1 * w, y: d.y1 * h, w: (d.x2 - d.x1) * w, h: (d.y2 - d.y1) * h,
                         color: colorFor(d.id), label: d.sim == null ? `ID ${d.id} · novo` : `ID ${d.id} · ${(d.sim * 100) | 0}%` });
    }
    // mantém as outras classes na cadeia; as pessoas ganham `id`
    const outras = !proprio && p.soPessoas ? dets.filter((d) => !PESSOA.test(d.name || '')) : [];
    ctx.detections = saida.concat(outras);
    ctx.reid = { ids: state.gal.map((g) => ({ id: g.id, vezes: g.vezes, vistoMsAtras: performance.now() - g.visto })) };
    ctx.metrics['pessoas'] = saida.filter((d) => d.id).length;
    ctx.metrics['ids na galeria'] = state.gal.length;
    ctx.metrics['ids emitidos'] = state.proxId - 1;
    return clone(src);
  },
};

export default [reidPessoas];
