/* Pure post-processing shared by the worker and the tests: letterbox geometry, NMS,
 * detector decoding for the two exported layouts, and the relation decode — a line-by-line
 * port of deploy/postprocess.py + relsgg/scoring.py (the ONE score contract:
 * sigmoid(a * (pred_logit + w * pair_logit) + b)). No DOM, no ORT. */
(function (root) {
  'use strict';

  function letterboxGeometry(w, h, size) {
    const r = Math.min(size / h, size / w);
    const nw = Math.round(w * r), nh = Math.round(h * r);
    return { r, nw, nh, dw: Math.floor((size - nw) / 2), dh: Math.floor((size - nh) / 2) };
  }

  /** greedy class-agnostic NMS on xyxy boxes (callers offset per class); returns kept indices */
  function nms(boxes, scores, iouThr, maxDet) {
    const n = scores.length;
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const areas = new Float32Array(n);
    for (let i = 0; i < n; i++) areas[i] = Math.max(0, boxes[i][2] - boxes[i][0]) * Math.max(0, boxes[i][3] - boxes[i][1]);
    const keep = [], suppressed = new Uint8Array(n);
    for (let oi = 0; oi < n && keep.length < maxDet; oi++) {
      const i = order[oi];
      if (suppressed[i]) continue;
      keep.push(i);
      const [x1, y1, x2, y2] = boxes[i];
      for (let oj = oi + 1; oj < n; oj++) {
        const j = order[oj];
        if (suppressed[j]) continue;
        const xx1 = Math.max(x1, boxes[j][0]), yy1 = Math.max(y1, boxes[j][1]);
        const xx2 = Math.min(x2, boxes[j][2]), yy2 = Math.min(y2, boxes[j][3]);
        const inter = Math.max(0, xx2 - xx1) * Math.max(0, yy2 - yy1);
        const iou = inter / (areas[i] + areas[j] - inter + 1e-9);
        if (iou > iouThr) suppressed[j] = 1;
      }
    }
    return keep;
  }

  function undoLetterbox(b, g, W, H) {
    return [
      Math.min(Math.max((b[0] - g.dw) / g.r, 0), W - 1), Math.min(Math.max((b[1] - g.dh) / g.r, 0), H - 1),
      Math.min(Math.max((b[2] - g.dw) / g.r, 0), W - 1), Math.min(Math.max((b[3] - g.dh) / g.r, 0), H - 1),
    ];
  }

  /** Detector outputs -> {boxes (xyxy, original pixels), confs, cls}.
   *  kind 'boxes_conf_cls': boxes [1,4,A] cxcywh in letterboxed px, conf [1,A], cls [1,A] (raw head + in-graph max/argmax)
   *  kind 'e2e_xyxy'      : rows [1,N,6] xyxy conf cls in letterboxed px, already NMS-free (YOLO26) */
  function decodeDetections(kind, out, geom, W, H, cfg) {
    const conf = cfg.conf, iouThr = cfg.iou ?? 0.5, maxDet = cfg.maxDet ?? 40, imgsz = cfg.imgsz ?? 640;
    const allow = cfg.allowedClasses || null;                  // Set of class ids, or null = all
    let boxes = [], scores = [], cls = [], anchor = [];
    if (kind === 'boxes_conf_cls') {
      const A = out.conf.length, bx = out.boxes;                // bx is [4*A] laid out [4][A]
      for (let a = 0; a < A; a++) {
        const c = out.conf[a];
        if (c < conf) continue;
        const k = Number(out.cls[a]);
        if (allow && !allow.has(k)) continue;
        const cx = bx[a], cy = bx[A + a], bw = bx[2 * A + a], bh = bx[3 * A + a];
        boxes.push([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2]); scores.push(c); cls.push(k); anchor.push(a);
      }
      // class-aware NMS via per-class coordinate offset (ultralytics convention)
      const off = boxes.map((b, i) => { const o = cls[i] * (imgsz + 1); return [b[0] + o, b[1] + o, b[2] + o, b[3] + o]; });
      const keep = nms(off, scores, iouThr, maxDet);
      return { boxes: keep.map(i => undoLetterbox(boxes[i], geom, W, H)), confs: keep.map(i => scores[i]), cls: keep.map(i => cls[i]),
               anchors: keep.map(i => anchor[i]), lbBoxes: keep.map(i => boxes[i]) };
    }
    if (kind === 'e2e_xyxy' || kind === 'e2e_xyxy_seg') {
      // one row per detection, already NMS-free and confidence-sorted:
      //   [x1, y1, x2, y2, conf, cls]  (+ 32 mask coefficients for the -seg checkpoints)
      const rows = out.rows, stride = out.rowLen || 6, N = (rows.length / stride) | 0;
      const res = { boxes: [], confs: [], cls: [], lbBoxes: [], coefRows: [], anchors: [] };
      for (let i = 0; i < N && res.boxes.length < maxDet; i++) {
        const o = i * stride, c = rows[o + 4];
        if (c < conf) continue;
        const k = Math.round(rows[o + 5]);
        if (allow && !allow.has(k)) continue;
        const lb = [rows[o], rows[o + 1], rows[o + 2], rows[o + 3]];
        res.boxes.push(undoLetterbox(lb, geom, W, H));
        res.confs.push(c); res.cls.push(k); res.lbBoxes.push(lb); res.coefRows.push(o + 6); res.anchors.push(i);
      }
      return res;
    }
    throw new Error('unknown detector layout ' + kind);
  }

  /** numerically stable sigmoid, exact at the infinities (decode_decomposed masks columns with -Infinity) */
  function sigmoid(z) {
    if (z >= 0) return 1 / (1 + Math.exp(-z));
    const e = Math.exp(z); return e / (1 + e);
  }

  /** Port of deploy/postprocess.decode. pred: Float32Array [K*V], pair: [K], sub/obj: index arrays [K],
   *  valid: [K] truthy. Returns ranked triplets [{s, o, p, score}] (p = predicate index). */
  function decodeRelations(pred, pair, sub, obj, valid, K, V, cfg) {
    const a = cfg.calibA ?? 1, b = cfg.calibB ?? 0, w = cfg.pairWeight ?? 1;
    const thrVec = cfg.thresholds;                             // Float32Array [V] (global floor + per-predicate)
    const nBoxes = cfg.nBoxes, bs = cfg.boxScores || null, topk = cfg.topk ?? 20;
    const maxPerPair = cfg.maxPerPair ?? 1, boxWeight = cfg.boxScoreWeight ?? true;
    const mask = cfg.columnMask || null;                       // Uint8Array [V] or null (two-graph decode)
    const cands = [];
    for (let k = 0; k < K; k++) {
      if (!valid[k]) continue;
      const si = Number(sub[k]), oi = Number(obj[k]);
      if (si >= nBoxes || oi >= nBoxes || si === oi) continue; // padding-referencing / degenerate slots
      const bw = (boxWeight && bs) ? bs[si] * bs[oi] : 1;
      let best = -1, bestScore = -Infinity;
      const row = k * V;
      const scores = new Float32Array(V);
      for (let v = 0; v < V; v++) {
        let z = pred[row + v];
        if (mask && !mask[v]) z = -Infinity;
        const s = sigmoid(a * (z + w * pair[k]) + b);
        scores[v] = s;
        if (s > bestScore) { bestScore = s; best = v; }
      }
      if (maxPerPair === 1) {
        if (best >= 0 && scores[best] >= thrVec[best]) cands.push({ s: si, o: oi, p: best, score: scores[best], rank: scores[best] * bw });
      } else {
        for (let v = 0; v < V; v++) if (scores[v] >= thrVec[v]) cands.push({ s: si, o: oi, p: v, score: scores[v], rank: scores[v] * bw });
      }
    }
    cands.sort((x, y) => y.rank - x.rank);
    return cands.slice(0, topk).map(({ s, o, p, score }) => ({ s, o, p, score }));
  }

  /** Two graphs from the same outputs: spatial and semantic columns decoded independently. */
  function decodeDecomposed(pred, pair, sub, obj, valid, K, V, cfg, isSpatial) {
    const sp = new Uint8Array(V), se = new Uint8Array(V);
    for (let v = 0; v < V; v++) { sp[v] = isSpatial[v] ? 1 : 0; se[v] = isSpatial[v] ? 0 : 1; }
    return {
      spatial: sp.some(x => x) ? decodeRelations(pred, pair, sub, obj, valid, K, V, { ...cfg, columnMask: sp }) : [],
      semantic: se.some(x => x) ? decodeRelations(pred, pair, sub, obj, valid, K, V, { ...cfg, columnMask: se }) : [],
    };
  }

  /** per-predicate threshold vector: global floor, overridden by calibrated bank thresholds mapped through
   *  the SAME calibration affine (sigmoid(a*logit(t)+b)), as ScenePipeline does — explicit user overrides win. */
  function thresholdVector(predicates, globalThr, bankThr, calibA, calibB, overrides) {
    const v = new Float32Array(predicates.length).fill(globalThr);
    for (let i = 0; i < predicates.length; i++) {
      const name = predicates[i];
      if (overrides && overrides[name] !== undefined) { v[i] = overrides[name]; continue; }
      const t = bankThr ? bankThr[i] : null;
      if (t === null || t === undefined || !isFinite(t)) continue;
      const tc = Math.min(Math.max(t, 1e-6), 1 - 1e-6);
      const z = Math.log(tc / (1 - tc));
      v[i] = 1 / (1 + Math.exp(-(calibA * z + calibB)));
    }
    return v;
  }

  /** Instance masks from YOLOE's prototype branch — the numpy of ultralytics' ops.process_mask, written to
   *  produce ONE index map instead of N float masks so the page uploads a single small texture per frame.
   *
   *  mask logit(x, y) for detection n = sum_k coef_n[k] * proto[k, y, x]; positive means inside. The two
   *  checkpoint families store those coefficients differently, so the caller passes a base offset per
   *  detection and the stride between k: YOLOE's anchor-major head is (anchor, A), a [1,300,6+nm] end-to-end
   *  seg row is (rowStart+6, 1). Same hot loop either way.
   *  Cropped to the detection box scaled into prototype space, exactly as process_mask(upsample=False) does.
   *  Painted largest box first, so a small object in front of a large one keeps its pixels.
   *
   *  @returns Uint8Array [mh*mw]: 0 = background, n+1 = detection n.
   */
  function decodeMasks(coef, proto, bases, kStride, md, mh, mw, lbBoxes, imgsz) {
    const out = new Uint8Array(mh * mw), P = mh * mw;
    const area = b => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
    const order = bases.map((_, n) => n).sort((a, b) => area(lbBoxes[b]) - area(lbBoxes[a]));
    for (const n of order) {
      const base = bases[n], b = lbBoxes[n];
      // crop_mask keeps column r when (r >= x1 && r < x2) on the UNROUNDED scaled box, so both bounds are
      // ceil() with a half-open loop. floor() on the low side leaks one column of neighbouring object.
      const x1 = Math.max(0, Math.ceil(b[0] * mw / imgsz)), x2 = Math.min(mw, Math.ceil(b[2] * mw / imgsz));
      const y1 = Math.max(0, Math.ceil(b[1] * mh / imgsz)), y2 = Math.min(mh, Math.ceil(b[3] * mh / imgsz));
      for (let y = y1; y < y2; y++) {
        const row = y * mw;
        for (let x = x1; x < x2; x++) {
          const o = row + x;
          let sum = 0;
          for (let k = 0; k < md; k++) sum += coef[base + k * kStride] * proto[k * P + o];
          if (sum > 0) out[o] = n + 1;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------- colour naming (class-agnostic detectors)
  // FastSAM segments "objects" and never names them, so the demo names each instance by the colour a person
  // would call it. Every pixel of the instance is binned into one of thirteen colour words and the fullest bin
  // wins: a plurality survives texture and shading where a mean RGB does not — the mean of a red-and-white
  // striped shirt is pink, its plurality is red.
  const COLOUR_WORDS = ['black', 'white', 'gray', 'red', 'orange', 'brown', 'beige', 'yellow',
                        'green', 'teal', 'blue', 'purple', 'pink'];
  const NO_SHADE = new Set([0, 1, 5, 6, 12]);        // words that already carry their own lightness

  /** one RGB triple (0..1) -> index into COLOUR_WORDS */
  function colourBin(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const v = mx, s = mx <= 1e-6 ? 0 : d / mx;
    if (v < 0.16) return 0;                                          // black
    if (s < 0.12) return v > 0.86 ? 1 : 2;                           // white / gray
    let h;
    if (mx === r) h = 60 * (((g - b) / d) % 6);
    else if (mx === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    if (h < 0) h += 360;
    if (h < 12 || h >= 345)                                          // brown / pink / red
      return (v < 0.62 && s < 0.62) ? 5 : ((s < 0.5 && v > 0.72) ? 12 : 3);   // dark unsaturated red is skin, wood, rust
    if (h < 45) return v < 0.55 && s > 0.25 ? 5                       // brown / beige / orange
                       : ((s < 0.35 || (v > 0.7 && s < 0.45)) ? 6 : 4);  // pale warm tones (wood, skin, sand) read beige
    if (h < 66) return v < 0.45 ? 5 : (s < 0.30 ? 6 : 7);            // brown / beige / yellow
    if (h < 160) return 8;
    if (h < 200) return 9;
    if (h < 258) return 10;
    if (h < 300) return 11;
    return 12;
  }

  /** Names N instances from their pixels. px = letterboxed CHW float image (0..1) at `size`.
   *  Pixels come from the instance mask when there is one (masks = {data, mh, mw} in prototype space, 0 =
   *  background, i+1 = instance i) and from the middle of the box otherwise. Returns one label per box. */
  function colourLabels(px, size, lbBoxes, masks) {
    const N = lbBoxes.length, P = size * size, W = COLOUR_WORDS.length;
    const hist = [], vsum = new Float64Array(N * W), ssum = new Float64Array(N * W);
    for (let i = 0; i < N; i++) hist.push(new Int32Array(W));
    const add = (i, o) => {
      const r = px[o], g = px[P + o], b = px[2 * P + o], k = colourBin(r, g, b);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      hist[i][k]++; vsum[i * W + k] += mx; ssum[i * W + k] += mx <= 1e-6 ? 0 : (mx - mn) / mx;
    };
    if (masks && masks.data) {
      const { data, mh, mw } = masks, kx = size / mw, ky = size / mh;
      for (let y = 0; y < mh; y++) {
        const iy = Math.min(size - 1, (y * ky) | 0) * size;
        for (let x = 0; x < mw; x++) {
          const k = data[y * mw + x];
          if (k > 0 && k <= N) add(k - 1, iy + Math.min(size - 1, (x * kx) | 0));
        }
      }
    }
    for (let i = 0; i < N; i++) {
      let n = 0; for (let k = 0; k < W; k++) n += hist[i][k];
      if (n >= 24) continue;                                         // enough mask pixels; keep them
      // no mask (or the instance is fully occluded by the ones painted over it): read the middle of the box,
      // inset so the sample is the object rather than whatever the box corners caught.
      hist[i].fill(0); vsum.fill(0, i * W, i * W + W); ssum.fill(0, i * W, i * W + W);
      const b = lbBoxes[i], cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      const hw = Math.max(1, (b[2] - b[0]) * 0.3), hh = Math.max(1, (b[3] - b[1]) * 0.3);
      const x1 = Math.max(0, Math.round(cx - hw)), x2 = Math.min(size - 1, Math.round(cx + hw));
      const y1 = Math.max(0, Math.round(cy - hh)), y2 = Math.min(size - 1, Math.round(cy + hh));
      const sx = Math.max(1, ((x2 - x1) / 24) | 0), sy = Math.max(1, ((y2 - y1) / 24) | 0);
      for (let y = y1; y <= y2; y += sy) for (let x = x1; x <= x2; x += sx) add(i, y * size + x);
    }
    const words = [];
    for (let i = 0; i < N; i++) {
      let best = 0; for (let k = 1; k < W; k++) if (hist[i][k] > hist[i][best]) best = k;
      const n = Math.max(1, hist[i][best]), v = vsum[i * W + best] / n, s = ssum[i * W + best] / n;
      let w = COLOUR_WORDS[best];
      if (best === 2) w = v > 0.6 ? 'light gray' : (v < 0.32 ? 'dark gray' : 'gray');
      else if (!NO_SHADE.has(best)) w = v < 0.42 ? 'dark ' + w : (v > 0.82 && s < 0.6 ? 'light ' + w : w);
      words.push(w);
    }
    // Two objects the same colour need telling apart, so a repeated word is numbered for every instance of it.
    // The numbering runs left to right rather than by confidence, so "brown object 3" is findable in the picture.
    const groups = new Map();
    words.forEach((w, i) => { if (!groups.has(w)) groups.set(w, []); groups.get(w).push(i); });
    const out = new Array(N);
    for (const [w, ids] of groups) {
      if (ids.length === 1) { out[ids[0]] = w + ' object'; continue; }
      ids.sort((a, b) => (lbBoxes[a][0] + lbBoxes[a][2]) - (lbBoxes[b][0] + lbBoxes[b][2]));
      ids.forEach((i, k) => { out[i] = `${w} object ${k + 1}`; });
    }
    return out;
  }

  root.RAPipeline = { letterboxGeometry, nms, undoLetterbox, decodeDetections, sigmoid, decodeRelations, decodeDecomposed, thresholdVector, decodeMasks, colourLabels, colourBin };
})(typeof self !== 'undefined' ? self : globalThis);
