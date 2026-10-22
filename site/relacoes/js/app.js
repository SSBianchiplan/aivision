/* RelateAnything browser demo — page logic. Talks to js/worker.js; draws masks, boxes and relation edges.
 *
 * The page has two modes and one renderer. In PRECOMPUTED mode it decodes a stored capture of the relation
 * head's raw outputs for a sample photo (assets/data/*.json) with js/pipeline.js — the same decode the worker
 * runs — so a first visitor drives the real thing (words, threshold, top-k, two-graph decode) before a single
 * model byte is downloaded. In LIVE mode the worker owns the pipeline and the same renderer draws its results.
 * Everything below the decode is shared: one drawOverlay, one triplet list, one set of controls. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const P = window.RAPipeline;
  const canvas = $('canvas'), ctx = canvas.getContext('2d'), video = $('video');
  const frameCanvas = document.createElement('canvas'), fctx = frameCanvas.getContext('2d', { willReadFrequently: true });
  const maskCanvas = document.createElement('canvas'), mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const PALETTE = ['#4da3ff', '#ff7ab6', '#7bd88f', '#ffd166', '#c792ea', '#ff9e64', '#5ad4e6', '#f78c6c', '#a5e3a1', '#e0a3ff', '#8ecae6', '#ffb4a2'];
  const RGB = PALETTE.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const DEFAULT_TEXT_CLASSES = ['person', 'man', 'woman', 'boy', 'girl', 'chair', 'table', 'desk', 'couch', 'bed', 'cup', 'mug', 'bottle', 'bowl', 'plate', 'fork', 'knife', 'spoon',
    'laptop', 'keyboard', 'mouse', 'monitor', 'cell phone', 'book', 'pen', 'bag', 'backpack', 'handbag', 'hat', 'glasses', 'shirt', 'jacket', 'shoe', 'dog', 'cat', 'horse', 'bicycle',
    'car', 'motorcycle', 'bus', 'truck', 'umbrella', 'plant', 'lamp', 'clock', 'television', 'window', 'door', 'ball', 'skateboard', 'pizza', 'cake', 'apple', 'banana', 'tree', 'building', 'road', 'grass'];
  const MINIMAL = ['holding', 'wearing', 'riding', 'sitting on', 'on', 'in front of', 'behind', 'next to'];
  // The two detectors the front panel offers directly; the other six stay in Advanced. Both have a precomputed
  // capture for every sample, which is what lets the "names / colours" switch work before anything is loaded.
  const FRONT_DETS = {
    'yoloe-11s-pf': 'YOLOE names each object from 4,585 built-in classes.',
    'fastsam-s': 'FastSAM returns segments with no class names, so each is named by its own colour. The relation head never reads object names, so the graph is the same either way.',
  };

  const state = { manifest: null, worker: null, req: 0, pending: new Map(), webgpu: false, epUsed: {},
    loaded: { relation: false, detector: null, predicate: false, mobileclip: false }, detSpec: null,
    still: null, lastShow: null, lastResult: null, running: false, busy: false, rerun: false, stream: null,
    graphView: 'merged', predBank: null, cards: {}, hl: -1, renders: 0, confTouched: false,
    mode: 'preview', goingLive: null, universe: null, credits: [],
    preview: { img: null, det: 'yoloe-11s-pf', data: null, bitmap: null, cache: new Map(), images: new Map() } };

  const fmtMB = b => (b / 1e6).toFixed(b < 20e6 ? 1 : 0) + ' MB';
  const size = spec => spec.files.reduce((a, f) => a + f.size, 0);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const parseList = s => { const seen = new Set(), out = []; for (let x of s.split(/[,\n;]+/)) { x = x.trim().replace(/\s+/g, ' ').toLowerCase(); if (x && !seen.has(x)) { seen.add(x); out.push(x); } } return out; };
  const opts = () => ({ detConf: +$('detconf').value, threshold: +$('thr').value, topk: +$('topk').value, maxDet: +$('maxdet').value,
    decompose: $('decompose').checked, useBankThr: $('bankthr').checked, pairWeight: +$('pairw').value, masks: $('masks').checked });
  const chosenEP = () => { const v = $('backend-select').value; return v === 'auto' ? (state.webgpu ? 'webgpu' : 'wasm') : v; };
  const ready = () => state.loaded.relation && !!state.loaded.detector;
  const hint = msg => { $('hint').textContent = msg; $('hint').hidden = !msg; };
  const hud = (html, err) => { $('hud').innerHTML = html; $('hud').className = 'hud' + (err ? ' err' : ''); };

  // ------------------------------------------------------------------ worker RPC
  function call(type, payload = {}, transfer = []) {
    return new Promise((res, rej) => { const req = ++state.req; state.pending.set(req, { res, rej }); state.worker.postMessage({ type, req, ...payload }, transfer); });
  }
  function onMessage(ev) {
    const m = ev.data;
    if (m.type === 'progress') return onProgress(m);
    if (m.type === 'stage') return onStage(m);
    if (m.type === 'log') return console.log('[worker]', m.msg);
    const p = state.pending.get(m.req); if (!p) return; state.pending.delete(m.req);
    m.type === 'error' ? p.rej(new Error(m.msg)) : p.res(m);
  }
  function onStage(m) {                       // download finished, something slow but unmeasurable is happening
    const c = state.cards[m.id];
    if (c) { c.progress.hidden = true; c.status.textContent = m.text; c.status.className = 'status'; }
    if (state.goingLive) modeStatus(m.text);
  }
  function onProgress(m) {
    const c = state.cards[m.id];
    if (c) {
      c.progress.hidden = false; c.progress.max = m.total || 1; c.progress.value = m.loaded;
      c.status.textContent = `downloading ${fmtMB(m.loaded)} / ${fmtMB(m.total)}`;
    }
    // Advanced is collapsed by default, so a download started from the big button has to report in the mode card.
    if (state.goingLive) {
      const p = $('mode-progress'); p.hidden = false; p.max = m.total || 1; p.value = m.loaded;
      modeStatus(`downloading ${fmtMB(m.loaded)} / ${fmtMB(m.total)}`);
    }
  }

  // ------------------------------------------------------------------ mode card
  const modeStatus = (text, cls) => { const s = $('mode-status'); s.textContent = text || ''; s.className = 'status ' + (cls || ''); };
  function modeCard(which, detail) {
    const card = $('mode'), k = $('mode-k'), t = $('mode-text'), b = $('btn-golive');
    card.classList.toggle('live', which === 'live');
    if (which === 'preview') {
      k.textContent = 'precomputed · nothing downloaded';
      t.textContent = "These are the relation head's own outputs for this photo, decoded in your browser as you change the words. It is the same decode the live model uses. Load the models to run it on your own images, video or webcam.";
      b.hidden = false; b.disabled = false; b.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg> Run it live · 129 MB';
      $('mode-progress').hidden = true; modeStatus('');
    } else if (which === 'loading') {
      k.textContent = 'loading the models';
      t.textContent = 'Relation model and detector are downloading into this page. They are cached afterwards, so this happens once per browser.';
      b.disabled = true; b.textContent = 'loading…';
    } else if (which === 'live') {
      k.textContent = 'live · running on your machine';
      t.textContent = 'The models are in this page now. Open an image, a video or the webcam; nothing is uploaded.';
      b.hidden = true; $('mode-progress').hidden = true;
      modeStatus(`${state.detSpec ? state.detSpec.name : 'detector'} · ${state.epUsed.relation || '?'}`, 'ok');
    } else if (which === 'failed') {
      k.textContent = 'could not load';
      b.hidden = false; b.disabled = false; b.textContent = 'try again';
      $('mode-progress').hidden = true; modeStatus(detail || 'load failed', 'err');
    }
  }

  // ------------------------------------------------------------------ model cards
  function card(container, id, name, desc, meta, btnLabel, license) {
    const el = document.createElement('div'); el.className = 'card'; el.dataset.id = id;
    el.innerHTML = `<div class="top"><span class="name"></span><span class="meta"></span></div>
      <div class="desc"></div><progress hidden></progress>
      <div class="foot"><span class="status"></span>${license ? `<span class="lic">${esc(license)}</span>` : ''}<button class="small"></button></div>`;
    el.querySelector('.name').textContent = name; el.querySelector('.desc').textContent = desc; el.querySelector('.meta').textContent = meta;
    const btn = el.querySelector('button'); btn.textContent = btnLabel;
    container.appendChild(el);
    return state.cards[id] = { el, btn, status: el.querySelector('.status'), progress: el.querySelector('progress') };
  }
  function setStatus(c, text, cls) { c.status.textContent = text; c.status.className = 'status ' + (cls || ''); c.progress.hidden = true; }

  async function loadRelation() {
    const spec = state.manifest.relation, c = state.cards[spec.id];
    c.btn.disabled = true; setStatus(c, 'loading…');
    try {
      const r = await call('loadRelation', { spec, ep: chosenEP(), predicates: livePredicates() });
      state.loaded.relation = true; state.epUsed.relation = r.ep;
      setStatus(c, `ready · ${r.ep}`, 'ok'); c.btn.textContent = 'reload';
      showPredicateChips(r.vocab); c.btn.disabled = false; return true;
    } catch (e) { setStatus(c, 'failed: ' + e.message, 'err'); c.btn.disabled = false; throw e; }
  }
  async function loadDetector(spec) {
    const c = state.cards[spec.id]; c.btn.disabled = true; setStatus(c, 'loading…');
    try {
      const custom = document.querySelector('input[name=objmode]:checked').value === 'custom';
      const defaults = custom && $('classes').value.trim() ? parseList($('classes').value) : DEFAULT_TEXT_CLASSES;
      const r = await call('loadDetector', { spec, ep: chosenEP(), defaultClasses: defaults, strict: false });
      state.loaded.detector = spec.id; state.detSpec = spec; state.epUsed.detector = r.ep;
      if (r.defaultConf !== undefined && !state.confTouched) { $('detconf').value = r.defaultConf; $('detconf-v').textContent = (+r.defaultConf).toFixed(2); }
      $('masks').disabled = !r.masks;
      $('masks').closest('.switch').title = !r.masks ? `${spec.name} is a detection-only model — pick a -seg or YOLOE checkpoint for masks`
        : spec.labels === 'color' ? `Instance masks from ${spec.name}'s prototype branch. They are decoded either way here — the colour names are read off them.`
        : `Instance masks from ${spec.name}'s prototype branch`;
      // a class-agnostic detector has no vocabulary to filter or re-parameterise
      const agn = spec.vocab === 'agnostic';
      for (const rb of document.querySelectorAll('input[name=objmode]')) rb.disabled = agn;
      if (agn) document.querySelector('input[name=objmode][value=asis]').checked = true;
      $('classes').disabled = agn || document.querySelector('input[name=objmode]:checked').value !== 'custom';
      $('btn-apply-classes').disabled = agn;
      Object.values(state.cards).forEach(x => x.el.classList.remove('active')); c.el.classList.add('active');
      setStatus(c, `active · ${r.ep}`, 'ok'); c.btn.textContent = 'in use';
      for (const d of state.manifest.detectors) if (d.id !== spec.id && state.cards[d.id].btn.textContent === 'in use') { setStatus(state.cards[d.id], 'downloaded', ''); state.cards[d.id].btn.textContent = 'use'; }
      describeClasses(r.classes);
      if (spec.vocab === 'dynamic' && !custom) $('classes').value = r.classes.classes.join(', ');
      syncFrontDetector(spec.id);
      c.btn.disabled = false; return true;
    } catch (e) { setStatus(c, 'failed: ' + e.message, 'err'); c.btn.disabled = false; throw e; }
  }
  async function loadEncoder(role, spec) {
    const c = state.cards[spec.id]; c.btn.disabled = true; setStatus(c, 'loading…');
    try {
      await call('loadTextEncoder', { role, spec }); state.loaded[role] = true;
      setStatus(c, 'ready · any string can be encoded', 'ok'); c.btn.textContent = 'loaded';
      if (role === 'predicate') $('predicates-info').textContent = 'any string can be encoded now';
    } catch (e) { setStatus(c, 'failed: ' + e.message, 'err'); c.btn.disabled = false; }
  }
  function renderCards(man) {
    const rel = man.relation;
    const c = card($('relation-card'), rel.id, rel.name, `${rel.meta.backbone} · ${rel.precision}`, fmtMB(size(rel)), 'download', 'DINOv3');
    c.btn.onclick = () => goLive();
    for (const d of man.detectors) {
      const bits = [d.description]; if (d.masks) bits.push('Emits instance masks.');
      const cc = card($('detector-cards'), d.id, (d.recommended ? '★ ' : '') + d.name, bits.join(' '), fmtMB(size(d)), 'download', d.license);
      cc.btn.onclick = () => useDetector(d);
    }
    const te = man.text_encoders;
    const p = card($('encoder-cards'), te.predicate.id, 'Predicate text encoder',
      'Type predicates outside the 81-word bank — a distilled dino.txt student encodes them here.', fmtMB(size(te.predicate)), 'download', 'DINOv3');
    p.btn.onclick = () => loadEncoder('predicate', te.predicate);
    const m = card($('encoder-cards'), te['mobileclip-blt-text'].id, 'MobileCLIP text encoder',
      'Lets the YOLOE text-prompt detector take class names outside its 1,760-name bank.', fmtMB(size(te['mobileclip-blt-text'])), 'download', 'MobileCLIP');
    m.btn.onclick = () => loadEncoder('mobileclip', te['mobileclip-blt-text']);
  }

  // ------------------------------------------------------------------ going live
  /** Download the relation model and one detector, then re-run the picture on screen. Every path that needs a
   *  real forward pass (webcam, video, a dropped file, a detector card) funnels through here, and a second
   *  caller joins the load already in flight rather than starting another. */
  function goLive(detId) {
    if (state.goingLive) return state.goingLive;
    const run = (async () => {
      modeCard('loading');
      try {
        if (!state.loaded.relation) {
          await loadRelation();
          // The vocabulary in force changes with the models: 263 strings captured with the sample, 81 in the
          // shipped bank. The preset buttons have to count what is actually available now.
          if (state.predBank) renderPresets({ names: state.predBank.names, is_spatial: state.predBank.is_spatial, default: state.predBank.default });
        }
        const want = detId || state.preview.det;
        const spec = state.manifest.detectors.find(d => d.id === want) || state.manifest.detectors.find(d => d.recommended) || state.manifest.detectors[0];
        if (state.loaded.detector !== spec.id) await loadDetector(spec);
        state.mode = 'live'; setLiveControls(true); modeCard('live');
        await applyPredicates({ silent: true });
      } catch (e) {
        modeCard('failed', e.message); state.goingLive = null; throw e;
      }
      state.goingLive = null;
      // Same picture, now computed here: the visitor sees the real latency on something they already know.
      if (!state.still && state.preview.img) await openSample(state.preview.img);
      else if (state.still) await runStill();
    })();
    state.goingLive = run;
    return run.catch(e => { hud('could not load the models: ' + esc(e.message), true); });
  }
  async function useDetector(spec) {
    if (!state.loaded.relation) return goLive(spec.id);
    try { await loadDetector(spec); } catch (e) { return; }
    state.mode = 'live'; setLiveControls(true); modeCard('live');
    if (state.still) runStill();
  }
  /** Controls that only mean something once a detector is actually running. */
  function setLiveControls(on) {
    for (const id of ['detconf', 'maxdet']) $(id).disabled = !on;
    $('live-only-note').hidden = on;
    $('btn-apply-classes').disabled = !on;
  }
  function syncFrontDetector(id) {
    for (const b of $('detseg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.det === id);
    $('detnote').textContent = FRONT_DETS[id] || (state.detSpec ? state.detSpec.description : '');
  }

  // ------------------------------------------------------------------ vocabulary
  function describeClasses(r) {
    const info = $('classes-info');
    if (r.mode === 'agnostic') info.textContent = 'class-agnostic — every segment is named by its own colour';
    else if (r.mode === 'as-is') info.textContent = `${r.classes.length.toLocaleString()} built-in classes`;
    else if (r.mode === 'filter') info.textContent = `filtered to ${r.classes.length} of the built-in classes` + (r.unknown && r.unknown.length ? ` · unknown: ${r.unknown.slice(0, 6).join(', ')}` : '');
    else info.textContent = `re-parameterised to ${r.classes.length} classes (${r.source.filter(s => s === 'encoder').length} via MobileCLIP)`;
  }
  async function applyClasses() {
    if (!state.loaded.detector) return;
    const custom = document.querySelector('input[name=objmode]:checked').value === 'custom';
    const names = custom ? parseList($('classes').value) : null;
    $('btn-apply-classes').disabled = true;
    try { const r = await call('setClasses', { names, strict: true }); describeClasses(r.classes); if (state.still) runStill(); }
    catch (e) { $('classes-info').textContent = e.message; $('classes-info').className = 'msg'; setTimeout(() => $('classes-info').className = 'micro', 6000); }
    $('btn-apply-classes').disabled = false;
  }

  /** The words to send the worker: what is typed, minus anything the loaded models cannot encode. The
   *  precomputed capture carries 263 strings and the shipped bank 81, so a visitor arriving from precomputed
   *  mode is usually asking for words that need the 23 MB predicate encoder. Say which, rather than failing. */
  function livePredicates() {
    const typed = parseList($('predicates').value);
    if (state.loaded.predicate || !state.predBank) return typed;
    const known = new Set(state.predBank.names);
    return typed.filter(n => known.has(n));
  }
  /** "default" until the typed list stops being the preset the page opened with. */
  function markVocabBadge() {
    const b = $('badge-vocab'), d = state.universe && state.universe.default;
    const typed = parseList($('predicates').value);
    const custom = !d || typed.length !== d.length || typed.some((n, i) => n !== d[i]);
    b.textContent = custom ? 'edited' : 'default';
    b.className = 'badge' + (custom ? ' ok' : '');
  }
  function showPredicateChips(v) {
    const known = new Set(v.names);
    const dropped = parseList($('predicates').value).filter(n => !known.has(n));
    $('pred-chips').innerHTML = v.names.map((n, i) =>
        `<span class="chip ${v.is_spatial[i] ? 'sp' : 'se'} ${v.source[i] !== 'bank' ? 'enc' : ''}" title="${esc(v.source[i])} · gate α=${v.alpha[i].toFixed(2)}">${esc(n)}</span>`).join('')
      + dropped.map(n => `<span class="chip off" title="not in the ${state.predBank ? state.predBank.names.length + '-word' : ''} bank — load the predicate text encoder in Advanced to use it">${esc(n)}</span>`).join('');
    $('predicates-info').className = 'micro';
    $('predicates-info').textContent = `${v.names.length} words · ${v.is_spatial.filter(Boolean).length} spatial`
      + (dropped.length ? ` · ${dropped.length} need the predicate encoder (Advanced)` : '');
    markVocabBadge();
  }
  async function applyPredicates(o = {}) {
    if (state.mode !== 'live') return renderPreview();
    if (!state.loaded.relation) return;
    const names = livePredicates();
    if (!names.length) { $('predicates-info').textContent = 'none of these words can be encoded yet — load the predicate text encoder in Advanced'; $('predicates-info').className = 'msg'; return; }
    $('btn-apply-predicates').disabled = true;
    try { const r = await call('setPredicates', { names }); showPredicateChips(r.vocab); if (state.still && !o.silent) runStill(); }
    catch (e) { $('predicates-info').textContent = e.message; $('predicates-info').className = 'msg'; }
    $('btn-apply-predicates').disabled = false;
  }
  /** Presets over whichever vocabulary is in force: the 263-string capture in precomputed mode, the 81-word
   *  bank once the relation model is loaded. Same five buttons either way. */
  function renderPresets(u) {
    state.universe = u;
    const sp = u.names.filter((n, i) => u.is_spatial[i]), se = u.names.filter((n, i) => !u.is_spatial[i]);
    const presets = [['default', u.default], [`all ${u.names.length}`, u.names], [`spatial ${sp.length}`, sp], [`semantic ${se.length}`, se], ['minimal', MINIMAL]];
    $('pred-presets').innerHTML = '';
    for (const [label, list] of presets) {
      const b = document.createElement('button'); b.className = 'small'; b.textContent = label;
      b.onclick = () => { $('predicates').value = list.join(', '); applyPredicates(); };
      $('pred-presets').appendChild(b);
    }
    if (!$('predicates').value.trim()) $('predicates').value = u.default.join(', ');
  }

  // ------------------------------------------------------------------ precomputed mode
  async function previewData(img, det) {
    const key = img + '/' + det;
    if (!state.preview.cache.has(key)) state.preview.cache.set(key, fetch(`assets/data/${img}_${det}.json`).then(r => {
      if (!r.ok) throw new Error(`${r.status} loading the capture for ${img}`);
      return r.json();
    }).then(d => {
      const r = d.raw;
      r.pred_logits = Float32Array.from(r.pred_logits); r.pair_logits = Float32Array.from(r.pair_logits);
      if (d.masks) { const s = atob(d.masks.b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); d.masks.data = u; }
      return d;
    }));
    return state.preview.cache.get(key);
  }
  function previewImage(img) {
    if (!state.preview.images.has(img)) state.preview.images.set(img, new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('cannot load ' + img)); im.src = `assets/samples/${img}.jpg`;
    }));
    return state.preview.images.get(img);
  }
  async function showPreview(img, det) {
    state.preview.img = img || state.preview.img; state.preview.det = det || state.preview.det;
    for (const b of $('samples').querySelectorAll('button')) b.classList.toggle('on', b.dataset.img === state.preview.img);
    syncFrontDetector(state.preview.det);
    try {
      const [d, im] = await Promise.all([previewData(state.preview.img, state.preview.det), previewImage(state.preview.img)]);
      state.preview.data = d; state.preview.bitmap = im; state.still = null;
      renderPreview();
    } catch (e) { hud('could not load the sample: ' + esc(e.message), true); }
  }
  /** The demo's own decode (js/pipeline.js) over stored logits: threshold, top-k, relatedness weight, the
   *  calibrated per-predicate thresholds and the two-graph decode all do here exactly what they do live. */
  function renderPreview() {
    const d = state.preview.data, im = state.preview.bitmap;
    if (state.mode !== 'preview' || !d || !im) return;
    const o = opts(), r = d.raw, V = r.V;
    const idx = new Map(r.names.map((n, i) => [n, i]));
    const typed = parseList($('predicates').value), sel = [], missing = [];
    for (const n of typed) (idx.has(n) ? sel : missing).push(n);
    const base = new Uint8Array(V);
    for (const n of sel) base[idx.get(n)] = 1;
    const thrVec = o.useBankThr ? P.thresholdVector(r.names, o.threshold, r.thr, r.calibration.a, r.calibration.b, null)
                                : new Float32Array(V).fill(o.threshold);
    const cfg = { calibA: r.calibration.a, calibB: r.calibration.b, pairWeight: o.pairWeight, topk: o.topk,
                  maxPerPair: 1, boxScoreWeight: true, nBoxes: r.nBoxes, boxScores: d.confs, thresholds: thrVec };
    const dec = mask => mask.some(x => x)
      ? P.decodeRelations(r.pred_logits, r.pair_logits, r.sub_idx, r.obj_idx, r.valid_mask, r.K, V, { ...cfg, columnMask: mask })
         .map(t => ({ ...t, predicate: r.names[t.p], spatial: !!r.is_spatial[t.p] }))
      : [];
    const only = f => { const m = new Uint8Array(V); for (let v = 0; v < V; v++) m[v] = (base[v] && f(v)) ? 1 : 0; return m; };
    const res = { W: d.W, H: d.H, boxes: d.boxes, labels: d.labels, confs: d.confs,
                  masks: o.masks ? d.masks : null, triplets: dec(base), preview: true };
    if (o.decompose) res.graphs = { spatial: dec(only(v => r.is_spatial[v])), semantic: dec(only(v => !r.is_spatial[v])) };

    state.lastShow = im; state.lastResult = res;
    drawFrame(im, res.W, res.H); drawMasks(res); drawOverlay(res); listTriplets(res);
    $('graph-tabs').hidden = !res.graphs;
    hud(statusLine(res));
    // Chips mirror live mode: the words in force, then the ones this capture cannot score.
    $('pred-chips').innerHTML = sel.map(n => { const i = idx.get(n); return `<span class="chip ${r.is_spatial[i] ? 'sp' : 'se'}">${esc(n)}</span>`; }).join('')
      + missing.map(n => `<span class="chip off" title="not in this capture — load the models to encode any string">${esc(n)}</span>`).join('');
    $('predicates-info').className = 'micro';
    $('predicates-info').textContent = `${sel.length} words · ${sel.filter(n => r.is_spatial[idx.get(n)]).length} spatial`
      + (missing.length ? ` · ${missing.length} not in this capture — load the models to score any string` : '');
    markVocabBadge();
    hint(res.boxes.length < 2 ? 'this capture has fewer than two objects' : '');
  }

  // ------------------------------------------------------------------ sources
  function stopAll() {
    state.running = false;
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    video.pause(); video.srcObject = null; video.removeAttribute('src'); video.load();
    $('btn-stop').hidden = true; $('btn-cam').textContent = 'Webcam';
    for (const b of document.querySelectorAll('.sources .segbtn')) b.classList.remove('on');
  }
  async function setStill(bitmap) {
    stopAll(); if (state.still) state.still.close(); state.still = bitmap; state.lastResult = null;
    drawFrame(bitmap, bitmap.width, bitmap.height);
    if (ready()) await runStill(); else hud('loading the models to run this picture…');
  }
  async function runStill() {
    if (!state.still || !ready()) return;
    // A knob moved (or a vocabulary changed) while an inference is in flight must not be lost: remember that a
    // re-run is due and take it as soon as the current one lands. Dropping it left the canvas showing a result
    // for settings the panel no longer claims, which is worse than being one frame late.
    if (state.busy) { state.rerun = true; return; }
    state.busy = true;
    try {
      const send = await createImageBitmap(state.still);
      const r = await call('infer', { bitmap: send, opts: opts() }, [send]);
      render(state.still, r.result);
    } catch (e) { hud('error: ' + esc(e.message), true); }
    state.busy = false;
    if (state.rerun) { state.rerun = false; runStill(); }
  }
  async function loopTick() {
    if (!state.running) return;
    if (!state.busy && video.readyState >= 2 && video.videoWidth) {
      state.busy = true;
      try {
        frameCanvas.width = video.videoWidth; frameCanvas.height = video.videoHeight; fctx.drawImage(video, 0, 0);
        const [show, send] = await Promise.all([createImageBitmap(frameCanvas), createImageBitmap(frameCanvas)]);
        const r = await call('infer', { bitmap: send, opts: opts() }, [send]);
        if (state.lastShow && state.lastShow !== state.still && state.lastShow.close) state.lastShow.close();
        render(show, r.result);
      } catch (e) { hud('error: ' + esc(e.message), true); state.running = false; }
      state.busy = false;
    }
    if (state.running) requestAnimationFrame(loopTick);
  }
  async function startVideo(file, btn) {
    stopAll();
    if (!ready()) { hud('loading the models first — the video starts when they are in'); await goLive(); if (!ready()) return; }
    video.src = URL.createObjectURL(file); video.loop = true; video.muted = true;
    await video.play(); state.running = true; $('btn-stop').hidden = false; if (btn) btn.classList.add('on'); loopTick();
  }
  async function startWebcam() {
    stopAll();
    if (!ready()) { hud('loading the models first — the camera starts when they are in'); await goLive(); if (!ready()) return; }
    try { state.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' }, audio: false }); }
    catch (e) { hud('webcam: ' + esc(e.message), true); return; }
    video.srcObject = state.stream; await video.play(); state.running = true;
    $('btn-stop').hidden = false; $('btn-cam').textContent = 'Webcam · live'; $('btn-cam').classList.add('on'); loopTick();
  }
  async function openFile(file, btn) {
    if (!file) return;
    if (file.type.startsWith('video/')) return startVideo(file, btn);
    try {
      await setStill(await createImageBitmap(file));
      if (btn) btn.classList.add('on');
      if (!ready()) { await goLive(); }
    } catch (e) { hud('cannot open ' + esc(file.name) + ': ' + esc(e.message), true); }
  }
  async function openSample(img) {
    const url = `assets/samples/${img}.jpg`;
    for (const b of $('samples').querySelectorAll('button')) b.classList.toggle('on', b.dataset.img === img);
    state.preview.img = img;
    try { await setStill(await createImageBitmap(await (await fetch(url)).blob())); }
    catch (e) { hud('cannot open the sample: ' + esc(e.message), true); }
  }

  // ------------------------------------------------------------------ rendering
  function drawFrame(bitmap, W, H) { $('placeholder').hidden = true; canvas.hidden = false; canvas.width = W; canvas.height = H; ctx.drawImage(bitmap, 0, 0, W, H); }
  function currentTriplets(r) { if (state.graphView === 'merged' || !r.graphs) return r.triplets; return r.graphs[state.graphView] || []; }

  /** The line over the picture. Both modes report what is on screen — which is why switching graph tab has to
   *  rebuild it rather than leave the merged graph's count standing. */
  function statusLine(r) {
    const head = `<b>${r.boxes.length}</b> objects <span class="sep">·</span> <b>${currentTriplets(r).length}</b> relations`;
    if (r.preview) return head + `<span class="sep">|</span> precomputed capture of the model's own outputs, decoded here`;
    const t = r.timings, fps = t.total ? (1000 / t.total).toFixed(1) : '-', seg = (l, v) => `${l} <b>${v}</b>`;
    return head
      + `<span class="sep">|</span> ${seg('detector', t.detector.toFixed(0) + ' ms')} <span class="sep">·</span> ${seg('relation', t.relation.toFixed(0) + ' ms')}`
      + (t.mask ? ` <span class="sep">·</span> ${seg('masks', t.mask.toFixed(0) + ' ms')}` : '')
      + ` <span class="sep">·</span> ${seg('total', t.total.toFixed(0) + ' ms')} (${fps} FPS, ${state.epUsed.relation || '?'})`;
  }
  function render(bitmap, r) {
    state.lastShow = bitmap; state.lastResult = r; $('hud').dataset.n = ++state.renders;
    drawFrame(bitmap, r.W, r.H); drawMasks(r); drawOverlay(r); listTriplets(r);
    hud(statusLine(r));
    if (r.boxes.length < 2) hint(`only ${r.boxes.length} object${r.boxes.length === 1 ? '' : 's'} found — lower the detector confidence in Advanced, or try another detector`);
    else hint('');
    $('graph-tabs').hidden = !r.graphs;
  }
  function redraw() {
    const r = state.lastResult;
    if (state.lastShow && r) { drawFrame(state.lastShow, r.W, r.H); drawMasks(r); drawOverlay(r); listTriplets(r); hud(statusLine(r)); }
  }
  /** A knob moved: precomputed mode re-decodes here, live mode re-runs the pipeline. */
  function rerun() { state.mode === 'preview' ? renderPreview() : runStill(); }

  /** Instance masks: one index map in prototype space (0 = background, i+1 = object i), from the worker in live
   *  mode and from the stored capture in precomputed mode. Colouring stays here so it follows the palette, and
   *  the letterbox is undone by drawImage's source rect. */
  function drawMasks(r) {
    const m = r.masks; if (!m || !m.data) return;
    const { data, mh, mw } = m;
    maskCanvas.width = mw; maskCanvas.height = mh;
    const img = mctx.createImageData(mw, mh), px = img.data;
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      const v = data[i]; if (!v) continue;
      const c = RGB[(v - 1) % RGB.length];
      px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255;
    }
    mctx.putImageData(img, 0, 0);
    ctx.save();
    ctx.globalAlpha = 0.3; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(maskCanvas, m.sx, m.sy, m.sw, m.sh, 0, 0, r.W, r.H);
    ctx.restore();
  }

  /** Place a label without overlapping what is already drawn; returns the chosen rect. */
  function placeLabel(placed, cands, w, h) {
    const hits = q => placed.some(p => !(q.x + w <= p.x || p.x + p.w <= q.x || q.y + h <= p.y || p.y + p.h <= q.y));
    for (const [x, y] of cands) { const rect = { x: x - w / 2, y: y - h / 2, w, h }; if (!hits(rect)) { placed.push(rect); return rect; } }
    const rect = { x: cands[0][0] - w / 2, y: cands[0][1] - h / 2, w, h }; placed.push(rect); return rect;
  }
  function roundRect(x, y, w, h, rad) { ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad); ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad); ctx.closePath(); }

  function drawOverlay(r) {
    const W = r.W, H = r.H;
    // Text is drawn in image pixels but read at display size, so a 1280-wide frame shown 390 px wide needs a
    // proportionally larger font to stay legible. Size for ~13 rendered px, and label less on a small screen —
    // four labels that can be read beat twelve that cannot.
    const scale = Math.max(0.1, (canvas.clientWidth || W) / W);
    const fs = Math.min(W / 26, Math.max(11, 13 / scale)), lw = Math.max(1.5, Math.min(W / 320, 1.7 / scale));
    ctx.font = `600 ${fs}px "Fira Sans", ui-sans-serif, system-ui, sans-serif`; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const trips = currentTriplets(r), used = new Set(); trips.forEach(t => { used.add(t.s); used.add(t.o); });
    const placed = [], th = fs + 7, tight = scale < 0.5;
    // A crowded scene cannot carry twenty readable edge labels. Label the strongest few (plus whatever is
    // hovered); every edge is still drawn, and the list below the image has them all, with their scores.
    const labelled = new Set(trips.map((t, k) => [k, t.score]).sort((x, y) => y[1] - x[1]).slice(0, Math.min(trips.length, tight ? 2 : 4)).map(x => x[0]));
    if (state.hl >= 0) labelled.add(state.hl);
    // On a narrow screen only the objects of the labelled relations are named; the rest keep their box.
    const named = tight ? new Set([...labelled].flatMap(k => [trips[k].s, trips[k].o])) : used;

    r.boxes.forEach((b, i) => {
      const col = PALETTE[i % PALETTE.length], on = used.has(i);
      ctx.strokeStyle = col; ctx.lineWidth = on ? lw * 1.5 : lw; ctx.globalAlpha = on ? 1 : 0.4;
      ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); ctx.globalAlpha = 1;
      if ((!on || !named.has(i)) && trips.length) return;
      const tag = r.labels[i], tw = ctx.measureText(tag).width + 10;
      const cands = [];
      for (const [ax, ay] of [[b[0] + tw / 2, b[1] - th / 2], [b[2] - tw / 2, b[1] - th / 2], [b[0] + tw / 2, b[3] + th / 2],
                              [b[2] - tw / 2, b[3] + th / 2], [b[0] + tw / 2, b[1] + th / 2], [b[2] - tw / 2, b[3] - th / 2]])
        for (const dy of [0, -th, -2 * th, th]) cands.push([ax, ay + dy]);
      const rect = placeLabel(placed, cands, tw, th);
      ctx.fillStyle = col; roundRect(rect.x, rect.y, tw, th, 4); ctx.fill();
      ctx.fillStyle = '#08131f'; ctx.fillText(tag, rect.x + 5, rect.y + th / 2);
    });

    // edges out of one subject fan apart so their labels do not land on the same pixel
    const bySub = new Map(); trips.forEach((t, k) => { const a = bySub.get(t.s) || []; a.push(k); bySub.set(t.s, a); });
    const bend = new Array(trips.length).fill(0);
    for (const idxs of bySub.values()) idxs.forEach((k, j) => { bend[k] = (j - (idxs.length - 1) / 2) * Math.min(52, 340 / Math.max(1, idxs.length)); });
    const c = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

    trips.forEach((t, k) => {
      const [x1, y1] = c(r.boxes[t.s]), [x2, y2] = c(r.boxes[t.o]);
      const col = t.spatial ? '#ffb347' : '#7bd88f', hi = state.hl === k, dim = state.hl >= 0 && !hi;
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const px = -dy / len, py = dx / len, off = bend[k] * (W / 900);
      const cx = (x1 + x2) / 2 + px * off, cy = (y1 + y2) / 2 + py * off;
      const ang = Math.atan2(y2 - cy, x2 - cx), head = lw * 4.5;
      const ex = x2 - Math.cos(ang) * lw * 3, ey = y2 - Math.sin(ang) * lw * 3;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = hi ? lw * 2.4 : lw * 1.25; ctx.globalAlpha = dim ? 0.22 : 0.9;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - head * Math.cos(ang - 0.45), ey - head * Math.sin(ang - 0.45));
      ctx.lineTo(ex - head * Math.cos(ang + 0.45), ey - head * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(x1, y1, lw * 1.8, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      if (!labelled.has(k)) return;
      const label = `${t.predicate} ${t.score.toFixed(2)}`, tw = ctx.measureText(label).width + 10;
      const ax = 0.25 * x1 + 0.5 * cx + 0.25 * x2, ay = 0.25 * y1 + 0.5 * cy + 0.25 * y2;
      const cands = [[ax, ay]];
      for (const d of [1, -1, 2, -2, 3, -3, 4, -4]) cands.push([ax + px * d * th * 0.9, ay + py * d * th * 0.9]);
      for (const d of [1, -1, 2, -2, 3, -3]) cands.push([ax + dx * 0.16 * d, ay + dy * 0.16 * d]);
      for (const d of [1, -1, 2, -2, 3, -3, 4, -4]) cands.push([ax, ay + d * th]);
      const rect = placeLabel(placed, cands.map(([qx, qy]) => [clamp(qx, tw / 2, W - tw / 2), clamp(qy, th / 2, H - th / 2)]), tw, th);
      const lx = rect.x + tw / 2, ly = rect.y + th / 2;
      ctx.globalAlpha = dim ? 0.3 : 1;
      if (Math.hypot(lx - ax, ly - ay) > th * 1.2) {
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, lw * 0.6); ctx.globalAlpha = dim ? 0.2 : 0.5;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(lx, ly); ctx.stroke(); ctx.globalAlpha = dim ? 0.3 : 1;
      }
      ctx.fillStyle = 'rgba(6,13,20,.9)'; roundRect(rect.x, rect.y, tw, th, 4); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1; roundRect(rect.x, rect.y, tw, th, 4); ctx.stroke();
      ctx.fillStyle = col; ctx.fillText(label, rect.x + 5, rect.y + th / 2);
      ctx.globalAlpha = 1;
    });
  }

  function listTriplets(r) {
    const trips = currentTriplets(r);
    $('triplets').innerHTML = trips.length ? trips.map((t, k) => {
      const cls = t.spatial ? '' : 'sem';
      return `<div class="trip" data-k="${k}">`
        + `<span><span class="s">${esc(r.labels[t.s])}</span> <span class="p ${cls}">${esc(t.predicate)}</span> <span class="s">${esc(r.labels[t.o])}</span></span>`
        + `<span class="bar"><i class="${cls}" style="width:${Math.round(t.score * 100)}%"></i></span>`
        + `<span class="score">${t.score.toFixed(2)}</span></div>`;
    }).join('') : `<div class="trip empty">${r.boxes.length < 2 ? 'fewer than two objects detected' : 'no relations above the threshold — lower it in Advanced, or add words'}</div>`;
    for (const el of $('triplets').querySelectorAll('.trip[data-k]')) {
      el.onmouseenter = () => { state.hl = +el.dataset.k; redraw(); };
      el.onmouseleave = () => { state.hl = -1; redraw(); };
    }
  }

  // ------------------------------------------------------------------ init
  async function init() {
    for (const [id, out, dec] of [['detconf', 'detconf-v', 2], ['thr', 'thr-v', 2], ['topk', 'topk-v', 0], ['maxdet', 'maxdet-v', 0], ['pairw', 'pairw-v', 1]]) {
      $(id).oninput = () => { $(out).textContent = (+$(id).value).toFixed(dec); };
      $(id).onchange = () => { if (id === 'detconf') state.confTouched = true; rerun(); };
    }
    $('decompose').onchange = () => {
      state.graphView = 'merged';
      for (const x of $('graph-tabs').querySelectorAll('button')) x.classList.toggle('on', x.dataset.g === 'merged');
      if (!$('decompose').checked) $('graph-tabs').hidden = true;
      rerun();
    };
    $('bankthr').onchange = rerun;
    $('masks').onchange = rerun;
    for (const b of $('graph-tabs').querySelectorAll('button'))
      b.onclick = () => { state.graphView = b.dataset.g; for (const x of $('graph-tabs').querySelectorAll('button')) x.classList.toggle('on', x === b); redraw(); };
    for (const rb of document.querySelectorAll('input[name=objmode]'))
      rb.onchange = () => { $('classes').disabled = rb.value !== 'custom' || !rb.checked; if (rb.checked && rb.value === 'asis') applyClasses(); };
    $('btn-apply-classes').onclick = applyClasses;
    $('btn-apply-predicates').onclick = () => applyPredicates();
    $('predicates').addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') applyPredicates(); });
    $('btn-golive').onclick = () => goLive();
    for (const b of $('detseg').querySelectorAll('button'))
      b.onclick = () => {
        if (state.mode === 'preview') return showPreview(null, b.dataset.det);
        const spec = state.manifest && state.manifest.detectors.find(d => d.id === b.dataset.det);
        if (spec) useDetector(spec);
      };
    $('file-image').onchange = e => openFile(e.target.files[0], $('lbl-image'));
    $('file-video').onchange = e => openFile(e.target.files[0], $('lbl-video'));
    $('btn-cam').onclick = () => (state.running && state.stream) ? stopAll() : startWebcam();
    $('btn-stop').onclick = stopAll;
    // Label size is chosen from the canvas's DISPLAY width, so anything that changes it — a window resize, the
    // panel wrapping under the picture, a phone rotating — has to redraw. Only a real change in scale counts,
    // otherwise redrawing the canvas would feed its own observer.
    let rz = 0, lastScale = 0;
    const onResize = () => {
      const r = state.lastResult; if (!r || !canvas.clientWidth) return;
      const sc = canvas.clientWidth / r.W;
      if (Math.abs(sc - lastScale) < 0.02 * Math.max(sc, lastScale)) return;
      lastScale = sc; clearTimeout(rz); rz = setTimeout(redraw, 120);
    };
    if (window.ResizeObserver) new ResizeObserver(onResize).observe($('stage'));
    window.addEventListener('resize', onResize);
    document.body.addEventListener('dragover', e => e.preventDefault());
    document.body.addEventListener('drop', e => { e.preventDefault(); openFile(e.dataTransfer.files[0], null); });
    $('btn-clear-cache').onclick = async () => { await call('clearCache'); modeStatus('model cache cleared — the next load downloads again'); };
    $('backend-select').onchange = async () => { if (state.loaded.relation) await loadRelation(); if (state.detSpec) await loadDetector(state.detSpec); };
    // Advanced stays where the visitor left it, so a researcher opens it once rather than on every reload.
    try { if (localStorage.getItem('ra-advanced') === '1') $('advanced').open = true; } catch (e) {}
    $('advanced').addEventListener('toggle', () => { try { localStorage.setItem('ra-advanced', $('advanced').open ? '1' : '0'); } catch (e) {} });
    setLiveControls(false);

    // 1. the picture first: samples, the capture's vocabulary, one decoded graph — no models, no worker.
    try {
      const cr = state.credits = await (await fetch('assets/samples/credits.json')).json();
      $('samples').innerHTML = cr.map(c => {
        const img = c.file.replace(/\.jpg$/, '');
        return `<button data-img="${esc(img)}" title="${esc(c.title)} — ${esc(c.artist)} (${esc(c.license)})"><img src="assets/samples/${esc(c.file)}" alt="${esc(c.title)}" loading="lazy"></button>`;
      }).join('');
      for (const b of $('samples').querySelectorAll('button'))
        b.onclick = () => (state.mode === 'preview' ? showPreview(b.dataset.img) : openSample(b.dataset.img));
      $('credits').innerHTML = cr.map(c => `<a href="${c.page}" rel="noopener">${esc(c.title)}</a> by ${esc(c.artist)} (<a href="${c.license_url || '#'}" rel="noopener">${esc(c.license)}</a>)`).join('; ');
      const u = await (await fetch('assets/data/vocab.json')).json();
      renderPresets({ names: u.names, is_spatial: u.is_spatial, default: (u.groups.find(g => g.id === 'default') || { names: u.names }).names });
      await showPreview(cr[0].file.replace(/\.jpg$/, ''), 'yoloe-11s-pf');
    } catch (e) { hud('could not start the precomputed demo: ' + esc(e.message), true); console.warn(e); }

    // 2. then the worker, so the models are one click away. Nothing here downloads a model.
    state.manifest = await (await fetch('models/manifest.json')).json();
    renderCards(state.manifest);
    state.worker = new Worker('js/worker.js'); state.worker.onmessage = onMessage;
    state.worker.onerror = e => hud('worker error: ' + esc(e.message), true);
    try {
      const r = await call('init', { base: document.baseURI });
      state.webgpu = r.webgpu; state.predBank = r.predBank;
      if (!r.predBank.hasThresholds) {          // uncalibrated bank: the switch would be a no-op, so say so
        const t = $('bankthr'); t.disabled = true;
        t.closest('.switch').title = 'This checkpoint ships no per-predicate thresholds — score scales do not transfer between checkpoints, so they have to be measured per model.';
        t.parentElement.querySelector('em').textContent = 'not calibrated for this checkpoint';
      }
      $('backend').textContent = (r.webgpu ? `WebGPU${r.adapterInfo ? ' · ' + r.adapterInfo : ''}` : 'WebAssembly')
        + ` · ${r.threads} thread${r.threads > 1 ? 's' : ''}` + (r.isolated ? '' : ' · not isolated') + ` · ort ${r.ortVersion}`;
      $('backend').classList.toggle('ok', r.webgpu);
      if (!r.webgpu) $('backend-select').querySelector('option[value=webgpu]').disabled = true;
    } catch (e) { $('backend').textContent = 'worker failed'; modeStatus('the pipeline worker failed to start: ' + e.message, 'err'); }
  }
  init();
})();
