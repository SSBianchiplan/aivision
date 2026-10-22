/* RelateAnything pipeline worker: model download/cache, ONNX Runtime Web sessions (WebGPU or WASM),
 * preprocessing, detector -> relation head -> decode. The page only sends frames and knobs. */
'use strict';
importScripts('../vendor/ort/ort.min.js', 'tokenizer_clip.js', 'pipeline.js');
const P = self.RAPipeline;
const CACHE = 'relateanything-models-v1';
let BASE = '';
const S = { ep: 'wasm', webgpu: false, det: null, rel: null, predEnc: null, clipEnc: null, tok: null,
            predBank: null, classBank: null, corpusMap: null, predCache: new Map(), classCache: new Map() };

const post = (m, t) => self.postMessage(m, t || []);
const log = (msg) => post({ type: 'log', msg });

// ----------------------------------------------------------------------------- downloads
async function fetchBytes(path, onProgress, sha) {
  // The cache key carries the file's hash, so re-exporting a model under the same name can never serve a
  // stale cached copy. Pages ignores the query string; the bytes are the same file.
  const url = new URL(path + (sha ? '?h=' + sha.slice(0, 12) : ''), BASE).href;
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) { cache = null; }
  if (cache) {
    const hit = await cache.match(url);
    if (hit) { const buf = new Uint8Array(await hit.arrayBuffer()); onProgress(buf.length, buf.length, true); return buf; }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${path}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = []; let loaded = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length; onProgress(loaded, total, false);
  }
  const buf = new Uint8Array(loaded); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  if (cache) { try { await cache.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { log('cache put failed: ' + e.message); } }
  return buf;
}

async function loadFiles(role, id, files) {
  const total = files.reduce((a, f) => a + f.size, 0), done = new Array(files.length).fill(0);
  const report = () => post({ type: 'progress', role, id, loaded: done.reduce((a, b) => a + b, 0), total });
  const bufs = [];
  for (let i = 0; i < files.length; i++) {
    bufs.push(await fetchBytes(files[i].path, (l) => { done[i] = l; report(); }, files[i].sha256));
  }
  return bufs;
}

async function createSession(role, id, files, epWanted, warmup) {
  const bufs = await loadFiles(role, id, files);
  const build = async (eps) => {
    const opts = { executionProviders: eps, graphOptimizationLevel: 'all' };
    if (files.length > 1) opts.externalData = files.slice(1).map((f, i) => ({ data: bufs[i + 1], path: f.path.split('/').pop() }));
    return await ort.InferenceSession.create(bufs[0], opts);
  };
  if (epWanted === 'webgpu' && S.webgpu) {
    let s = null;
    try {
      s = await build(['webgpu']);
      // WebGPU compiles its shaders on the FIRST run, not at session creation: a graph the adapter cannot bind
      // (a kernel over its storage-buffer budget, a missing feature) throws here, not above. Running one dummy
      // inference inside the try is what makes the WASM fallback actually cover those devices — and it moves
      // seconds of shader compilation off the user's first real frame. WASM needs neither, so it is not warmed.
      if (warmup) { post({ type: 'stage', role, id, text: 'compiling WebGPU shaders…' }); await warmup(s); }
      return { session: s, ep: 'webgpu' };
    } catch (e) {
      log(`${id}: WebGPU failed (${(e.message || e).toString().slice(0, 140)}), falling back to WASM`);
      if (s) { try { await s.release(); } catch (_) {} }
    }
  }
  return { session: await build(['wasm']), ep: 'wasm' };
}

function warmRelation(meta) {
  // shapes only — the values are irrelevant, this run exists to compile shaders and surface binding failures
  const S_ = meta.img_size, N = meta.max_boxes, dim = meta.text_dim, V = 2, n = 2;
  const bx = new Float32Array(N * 4);
  for (let i = 0; i < n; i++) { bx[i * 4] = 0.3 + 0.2 * i; bx[i * 4 + 1] = 0.4; bx[i * 4 + 2] = 0.2; bx[i * 4 + 3] = 0.2; }
  const W = new Float32Array(V * dim).fill(1 / Math.sqrt(dim));
  return (sess) => sess.run({ image: new ort.Tensor('float32', new Float32Array(3 * S_ * S_), [1, 3, S_, S_]),
    boxes: new ort.Tensor('float32', bx, [1, N, 4]), box_counts: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
    W: new ort.Tensor('float32', W, [V, dim]), alpha: new ort.Tensor('float32', new Float32Array(V).fill(0.5), [V]) });
}

function warmDetector(spec) {
  const z = spec.imgsz, dim = spec.txt_feats_dim || 512, C = 2;
  return (sess) => {
    const feeds = { images: new ort.Tensor('float32', new Float32Array(3 * z * z), [1, 3, z, z]) };
    if (spec.vocab === 'dynamic') feeds.txt_feats = new ort.Tensor('float32', new Float32Array(C * dim).fill(1 / Math.sqrt(dim)), [1, C, dim]);
    return sess.run(feeds);
  };
}

// ----------------------------------------------------------------------------- preprocessing
const scratch = new Map();                  // one canvas per size, reused: toCHW runs twice per frame
function toCHW(bitmap, size, letterbox) {
  let s = scratch.get(size);
  if (!s) { const cv = new OffscreenCanvas(size, size); s = { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) }; scratch.set(size, s); }
  const ctx = s.ctx;
  ctx.clearRect(0, 0, size, size);
  let geom = null;
  if (letterbox) {
    geom = P.letterboxGeometry(bitmap.width, bitmap.height, size);
    ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(bitmap, geom.dw, geom.dh, geom.nw, geom.nh);
  } else {
    ctx.drawImage(bitmap, 0, 0, size, size);              // plain (anisotropic) resize, as in training
  }
  const d = ctx.getImageData(0, 0, size, size).data, n = size * size, out = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { out[i] = d[j] / 255; out[n + i] = d[j + 1] / 255; out[2 * n + i] = d[j + 2] / 255; }
  return { x: out, geom };
}

// ----------------------------------------------------------------------------- vocabularies
function padIds(rows, L) {
  // FIXED width, exactly like PredicateTextStudent.tokenize: it always returns [N, max_len] zero-padded, so the
  // exported graph's positional slice is traced at that width. Padding to the longest row instead makes the
  // graph fail on any vocabulary whose longest template is shorter than max_len.
  const ids = new BigInt64Array(rows.length * L);            // pad id 0 (student PAD), masked by ids==0 in-graph
  rows.forEach((r, i) => r.slice(0, L).forEach((v, j) => { ids[i * L + j] = BigInt(v); }));
  return { ids, dims: [rows.length, L] };
}

async function encodePredicate(name) {
  if (S.predCache.has(name)) return S.predCache.get(name);
  if (!S.predEnc) throw new Error(`"${name}" is not in the predicate bank — download the predicate text encoder to type new predicates`);
  const rows = S.predEnc.templates.map(t => S.tok.encodeHF(t.replace('{p}', name), S.predEnc.maxLen));
  const { ids, dims } = padIds(rows, S.predEnc.maxLen);
  const out = await S.predEnc.session.run({ ids: new ort.Tensor('int64', ids, dims) });
  const r = { W: Float32Array.from(out.W.data), alpha: Number(out.alpha.data[0]) };
  S.predCache.set(name, r); return r;
}

async function setPredicates(names) {
  if (!S.rel) throw new Error('load the relation model first');
  const V = names.length, dim = S.rel.meta.text_dim, W = new Float32Array(V * dim), alpha = new Float32Array(V);
  const thr = new Array(V).fill(null), isSp = new Uint8Array(V), src = new Array(V);
  const bank = S.predBank, idx = bank ? new Map(bank.names.map((n, i) => [n, i])) : new Map();
  for (let v = 0; v < V; v++) {
    const n = names[v], i = idx.get(n);
    if (i !== undefined) { W.set(bank.W[i], v * dim); alpha[v] = bank.alpha[i]; thr[v] = bank.thr[i]; isSp[v] = bank.is_spatial[i]; src[v] = 'bank'; }
    else {
      const e = await encodePredicate(n); W.set(e.W, v * dim); alpha[v] = e.alpha;
      if (S.corpusMap && n in S.corpusMap) { isSp[v] = S.corpusMap[n] ? 1 : 0; src[v] = 'encoder+corpus'; }
      else { isSp[v] = e.alpha >= 0.5 ? 1 : 0; src[v] = 'encoder+gate'; }
    }
  }
  S.rel.vocab = { names: names.slice(), W, alpha, thr, isSpatial: isSp, source: src, dim };
  return { names, source: src, is_spatial: Array.from(isSp), alpha: Array.from(alpha) };
}

async function encodeClass(name) {
  if (S.classCache.has(name)) return S.classCache.get(name);
  if (!S.clipEnc) throw new Error(`"${name}" is not in the class bank — download the MobileCLIP text encoder to type new classes`);
  const tok = S.tok.encodeClip(name, S.clipEnc.ctx);
  const out = await S.clipEnc.session.run({ tokens: new ort.Tensor('int32', tok, [1, S.clipEnc.ctx]) });
  const r = Float32Array.from(out.feat.data); S.classCache.set(name, r); return r;
}

async function setClasses(names, strict = true) {
  if (!S.det) throw new Error('load a detector first');
  const det = S.det, norm = s => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (det.vocab === 'dynamic') {
    const list = (names && names.length) ? names.map(norm).filter(Boolean) : det.defaultClasses;
    const dim = det.spec.txt_feats_dim || 512, tf = new Float32Array(list.length * dim), src = [], kept = [], dropped = [];
    const bank = S.classBank, idx = bank ? new Map(bank.names.map((n, i) => [n, i])) : new Map();
    for (let c = 0; c < list.length; c++) {
      const i = idx.get(list[c]);
      if (i !== undefined) { tf.set(bank.vec.subarray(i * dim, (i + 1) * dim), c * dim); src.push('bank'); kept.push(list[c]); }
      else if (S.clipEnc || strict) { tf.set(await encodeClass(list[c]), c * dim); src.push('encoder'); kept.push(list[c]); }
      else dropped.push(list[c]);
    }
    const tf2 = tf.subarray(0, kept.length * dim);
    if (!kept.length) throw new Error('no usable class names');
    det.classes = kept; det.txtFeats = Float32Array.from(tf2); det.allowed = null;
    return { mode: 'reparam', classes: kept, source: src, dropped };
  }
  if (det.vocab === 'agnostic') { det.allowed = null; return { mode: 'agnostic', classes: det.classes, unknown: [] }; }
  // fixed-vocabulary detector: a custom list becomes a filter over its built-in classes
  if (!names || !names.length) { det.allowed = null; return { mode: 'as-is', classes: det.classes, unknown: [] }; }
  const idx = new Map(det.classes.map((n, i) => [norm(n), i])), allowed = new Set(), unknown = [];
  for (const n of names.map(norm).filter(Boolean)) { const i = idx.get(n); if (i === undefined) unknown.push(n); else allowed.add(i); }
  det.allowed = allowed;
  return { mode: 'filter', classes: Array.from(allowed).map(i => det.classes[i]), unknown };
}

// ----------------------------------------------------------------------------- inference
async function infer(bitmap, o) {
  const det = S.det, rel = S.rel;
  if (!det || !rel || !rel.vocab) throw new Error('models not ready');
  const W0 = bitmap.width, H0 = bitmap.height;
  const t0 = performance.now();
  const pre = toCHW(bitmap, det.spec.imgsz, true);
  const feeds = { images: new ort.Tensor('float32', pre.x, [1, 3, det.spec.imgsz, det.spec.imgsz]) };
  if (det.vocab === 'dynamic') feeds.txt_feats = new ort.Tensor('float32', det.txtFeats, [1, det.classes.length, det.spec.txt_feats_dim || 512]);
  // Fetching a subset of outputs lets onnxruntime prune the graph: with masks off the prototype branch
  // (a ConvTranspose head at 160x160) is never executed, which is most of the segmentation model's extra cost.
  // The prototype branch is also where colour naming gets its pixels, so a colour-labelled detector always runs
  // it — the overlay is still only drawn when the user asked for it.
  const byColour = det.spec.labels === 'color';
  const wantMasks = !!(det.spec.masks && (o.masks || byColour));
  const e2e = det.spec.kind === 'e2e_xyxy' || det.spec.kind === 'e2e_xyxy_seg';
  const fetches = e2e ? null : (wantMasks ? ['boxes', 'conf', 'cls', 'mask_coef', 'proto'] : ['boxes', 'conf', 'cls']);
  const dout = fetches ? await det.session.run(feeds, fetches) : await det.session.run(feeds);
  const raw = e2e ? { rows: dout.output0.data, rowLen: dout.output0.dims[dout.output0.dims.length - 1] }
                  : { boxes: dout.boxes.data, conf: dout.conf.data, cls: dout.cls.data };
  const maxDet = Math.min(o.maxDet || 32, rel.meta.max_boxes);
  const d = P.decodeDetections(det.spec.kind, raw, pre.geom, W0, H0, { conf: o.detConf, iou: 0.5, maxDet, imgsz: det.spec.imgsz, allowedClasses: det.allowed });
  const labels = d.cls.map(k => det.classes[k] ?? String(k));
  const t1 = performance.now();
  const result = { boxes: d.boxes, labels, confs: d.confs, triplets: [], graphs: null, masks: null, W: W0, H: H0, timings: { detector: t1 - t0, relation: 0, mask: 0, decode: 0 } };

  // instance masks (any segmentation checkpoint): one index map, painted per detection
  // YOLOE keeps the coefficients in a separate anchor-major tensor; the end-to-end seg heads put them in the
  // trailing columns of each detection row. decodeMasks takes (base, stride) so both feed the same painter.
  let masksForColour = null;
  const protoT = dout.proto || dout.output1;
  const coefT = dout.mask_coef || dout.output0;
  if (wantMasks && coefT && protoT && d.boxes.length) {
    const tm = performance.now(), pd = protoT.dims, mh = pd[2], mw = pd[3];
    const bases = det.spec.kind === 'e2e_xyxy_seg' ? d.coefRows : d.anchors;
    const kStride = det.spec.kind === 'e2e_xyxy_seg' ? 1 : dout.conf.dims[dout.conf.dims.length - 1];
    const idxMap = P.decodeMasks(coefT.data, protoT.data, bases, kStride, pd[1], mh, mw, d.lbBoxes, det.spec.imgsz);
    const kx = mw / det.spec.imgsz, ky = mh / det.spec.imgsz;      // prototype space is the letterboxed square
    const layer = { data: idxMap, mh, mw, sx: pre.geom.dw * kx, sy: pre.geom.dh * ky, sw: pre.geom.nw * kx, sh: pre.geom.nh * ky };
    if (o.masks) result.masks = layer;
    if (byColour) masksForColour = layer;
    result.timings.mask = performance.now() - tm;
  }
  // class-agnostic detector: the segments have no names, so name each one by its own colour
  if (byColour) result.labels = P.colourLabels(pre.x, det.spec.imgsz, d.lbBoxes, masksForColour);
  if (d.boxes.length < 2) { result.timings.total = t1 - t0; return result; }

  // relation head: plain-resized image + normalized cxcywh boxes, zero-padded to the graph's box slots
  const size = rel.meta.img_size, Nmax = rel.meta.max_boxes, n = Math.min(d.boxes.length, Nmax);
  const rp = toCHW(bitmap, size, false);
  const bx = new Float32Array(Nmax * 4);
  for (let i = 0; i < n; i++) {
    const b = d.boxes[i], x1 = b[0] / W0, y1 = b[1] / H0, x2 = b[2] / W0, y2 = b[3] / H0;
    bx[i * 4] = (x1 + x2) / 2; bx[i * 4 + 1] = (y1 + y2) / 2; bx[i * 4 + 2] = x2 - x1; bx[i * 4 + 3] = y2 - y1;
  }
  const vb = rel.vocab, V = vb.names.length;
  const rout = await rel.session.run({
    image: new ort.Tensor('float32', rp.x, [1, 3, size, size]), boxes: new ort.Tensor('float32', bx, [1, Nmax, 4]),
    box_counts: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
    W: new ort.Tensor('float32', vb.W, [V, vb.dim]), alpha: new ort.Tensor('float32', vb.alpha, [V]),
  });
  const t2 = performance.now();
  const K = rout.pred_logits.dims[1];
  const cal = rel.meta.calibration || { a: 1, b: 0 };
  const cfg = { calibA: cal.a, calibB: cal.b, pairWeight: o.pairWeight ?? 1, topk: o.topk, maxPerPair: 1, boxScoreWeight: true,
                nBoxes: n, boxScores: d.confs, thresholds: P.thresholdVector(vb.names, o.threshold, o.useBankThr ? vb.thr : null, cal.a, cal.b, null) };
  const args = [rout.pred_logits.data, rout.pair_logits.data, rout.sub_idx.data, rout.obj_idx.data, rout.valid_mask.data, K, V, cfg];
  const trip = P.decodeRelations(...args);
  const toOut = t => ({ s: t.s, o: t.o, p: t.p, predicate: vb.names[t.p], score: t.score, spatial: !!vb.isSpatial[t.p] });
  result.triplets = trip.map(toOut);
  // opts.raw: also return the head's outputs, so a caller can re-run the decode with a different vocabulary
  // subset or threshold without another forward pass (the project page's precomputed figures are built this way)
  if (o.raw) result.raw = { pred_logits: Float32Array.from(rout.pred_logits.data), pair_logits: Float32Array.from(rout.pair_logits.data),
                            sub_idx: Array.from(rout.sub_idx.data, Number), obj_idx: Array.from(rout.obj_idx.data, Number),
                            valid_mask: Array.from(rout.valid_mask.data, Number), K, V, names: vb.names.slice(), is_spatial: Array.from(vb.isSpatial, Boolean),
                            alpha: Array.from(vb.alpha), thr: vb.thr ? Array.from(vb.thr) : null, calibration: cal, nBoxes: n, lbBoxes: d.lbBoxes };
  if (o.decompose) { const g = P.decodeDecomposed(...args, vb.isSpatial); result.graphs = { spatial: g.spatial.map(toOut), semantic: g.semantic.map(toOut) }; }
  const t3 = performance.now();
  result.timings.relation = t2 - t1; result.timings.decode = t3 - t2; result.timings.total = t3 - t0;
  return result;
}

// ----------------------------------------------------------------------------- message loop
self.onmessage = async (ev) => {
  const m = ev.data, reply = (extra) => post({ type: 'done', req: m.req, ...extra });
  try {
    switch (m.type) {
      case 'init': {
        BASE = m.base;
        ort.env.wasm.wasmPaths = new URL('vendor/ort/', BASE).href;
        // hc, not hc-1: this worker is the only compute on the page, and scaling measured 1.96x/1.87x/1.45x
        // at 2/4/8 threads but REGRESSES at 16, so 8 is the cap that matters, not leaving a core spare.
        const threads = self.crossOriginIsolated ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)) : 1;
        ort.env.wasm.numThreads = threads;
        ort.env.webgpu.powerPreference = 'high-performance';
        let webgpu = false, adapterInfo = null;
        if (self.navigator.gpu) {
          try { const a = await navigator.gpu.requestAdapter(); if (a) { webgpu = true; const i = a.info || {}; adapterInfo = `${i.vendor || ''} ${i.architecture || ''} ${i.description || ''}`.trim(); } } catch (e) { webgpu = false; }
        }
        S.webgpu = webgpu;
        S.tok = await ClipTokenizer.load(new URL('assets/tokenizer/', BASE).href);
        S.predBank = await (await fetch(new URL('assets/banks/predicate_bank.json', BASE))).json();
        S.corpusMap = await (await fetch(new URL('assets/banks/corpus_type_map.json', BASE))).json();
        reply({ webgpu, adapterInfo, threads, isolated: !!self.crossOriginIsolated, ortVersion: ort.env.versions ? ort.env.versions.web : '?', predBank: { names: S.predBank.names, default: S.predBank.default, is_spatial: S.predBank.is_spatial,
                       // a bank ships NaN thresholds unless the checkpoint was calibrated (they never transfer
                       // between checkpoints), and the UI must not offer a switch that would do nothing
                       hasThresholds: S.predBank.thr.some(t => t !== null && isFinite(t)) } });
        break;
      }
      case 'loadRelation': {
        const { session, ep } = await createSession('relation', m.spec.id, m.spec.files, m.ep, warmRelation(m.spec.meta));
        S.rel = { session, ep, spec: m.spec, meta: m.spec.meta, vocab: null };
        const vocab = await setPredicates(m.predicates || m.spec.meta.default_predicates);
        reply({ ep, vocab }); break;
      }
      case 'loadDetector': {
        const spec = m.spec, { session, ep } = await createSession('detector', spec.id, spec.files, m.ep, warmDetector(spec));
        let classes = [], defaultClasses = null;
        if (spec.classes) classes = await (await fetch(new URL(spec.classes, BASE))).json();
        if (spec.vocab === 'dynamic') {
          if (!S.classBank) {
            const meta = await (await fetch(new URL(spec.bank, BASE))).json();
            const bin = await fetchBytes(new URL(spec.bank, BASE).pathname.replace(/[^/]+$/, meta.bin), () => {}, meta.sha256);
            const f16 = new Uint16Array(bin.buffer, bin.byteOffset, bin.byteLength / 2), vec = new Float32Array(f16.length);
            for (let i = 0; i < f16.length; i++) vec[i] = f16tof32(f16[i]);
            S.classBank = { names: meta.names, vec, dim: meta.dim };
          }
          defaultClasses = m.defaultClasses || [];
        }
        S.det = { session, ep, spec, vocab: spec.vocab, classes, defaultClasses, txtFeats: null, allowed: null };
        const cls = await setClasses(spec.vocab === 'dynamic' ? defaultClasses : null, !!m.strict);
        reply({ ep, classes: cls, bankNames: S.classBank ? S.classBank.names : null, defaultConf: spec.default_conf, masks: !!spec.masks }); break;
      }
      case 'loadTextEncoder': {
        const spec = m.spec, { session, ep } = await createSession('text', spec.id, spec.files, 'wasm');
        if (m.role === 'predicate') S.predEnc = { session, templates: spec.templates, maxLen: spec.max_len };
        else S.clipEnc = { session, ctx: spec.ctx };
        reply({ ep }); break;
      }
      case 'setPredicates': reply({ vocab: await setPredicates(m.names) }); break;
      case 'setClasses': reply({ classes: await setClasses(m.names, m.strict !== false) }); break;
      case 'infer': {
        const r = await infer(m.bitmap, m.opts); m.bitmap.close();
        post({ type: 'done', req: m.req, result: r }, r.masks ? [r.masks.data.buffer] : []); break;
      }
      case 'clearCache': { try { await caches.delete(CACHE); } catch (e) {} reply({}); break; }
      default: throw new Error('unknown message ' + m.type);
    }
  } catch (e) {
    if (m.bitmap && m.bitmap.close) { try { m.bitmap.close(); } catch (_) {} }
    post({ type: 'error', req: m.req, msg: e && e.message ? e.message : String(e) });
  }
};

function f16tof32(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
