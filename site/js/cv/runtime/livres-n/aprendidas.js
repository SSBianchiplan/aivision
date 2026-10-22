/**
 * cv/runtime/livres-n/aprendidas.js — a parte DETERMINÍSTICA das ferramentas
 * com modelo do CV-40 (porte de vision/tools/learned.py, vision/detectors.py e
 * scripts/calibrate.py do GPlanSiS|Inspect). JS puro, sem DOM e sem ONNX:
 * recebe as saídas do modelo (Float32Array + dims) e decide como o Inspect.
 * A execução dos modelos mora em modelos.js.
 *
 *   decodificarYolox / decodificarDetr / decodificarUltralytics
 *                   os adaptadores de detectores (um contrato de saída único:
 *                   [x1, y1, x2, y2, score, classe] em px da imagem original)
 *   nmsCv           cv2.dnn.NMSBoxes (guloso, ordem estável por score)
 *   julgarDeteccao  detect(): classes exigidas (mín–máx) e proibidas; passou por
 *                   pouco (alguma detecção colada no limiar) = INCERTO
 *   julgarClassificacao  classify(): softmax com temperatura T e conjunto
 *                   conformal {y : p_y ≥ 1 − q̂}; |conjunto| ≠ 1 = INCERTO
 *   calibrarClassificador  calibrate.classify(): T por NLL e q̂ (split conformal, 1 − α)
 *   calibrarAnomalia       calibrate.anomaly(): score_min/max e limiar por F1
 *   julgarAnomalia  anomaly(): nota bruta → [0, 1] pelo conjunto de calibração,
 *                   limiar, mapa de calor normalizado e as 5 maiores regiões acima
 */
import { PASS, FAIL, UNCERTAIN, julgarFaixa, resultado } from './veredito.js';
import { componentes } from './visao.js';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const roiOv = (s) => (s.roi ? [{ kind: 'roi', x: s.roi.x, y: s.roi.y, w: s.roi.w, h: s.roi.h }] : []);
const sig = (z) => 1 / (1 + Math.exp(-z));

// ------------------------------------------------------------------ geometria (prepare / _to_orig)

/**
 * Geometria do pré-processamento: letterbox (r igual nos dois eixos, faixas
 * left/top) ou resize (esticar). size = [H, W] da entrada da rede.
 */
export function geometria(h, w, size, modo = 'letterbox') {
  const [H, W] = size;
  if (modo === 'letterbox') {
    const r = Math.min(H / h, W / w);
    const nh = Math.round(h * r), nw = Math.round(w * r);
    return { rx: r, ry: r, left: Math.floor((W - nw) / 2), top: Math.floor((H - nh) / 2), size, nw, nh };
  }
  return { rx: W / w, ry: H / h, left: 0, top: 0, size, nw: W, nh: H };
}
const paraOrig = (b, g) => [(b[0] - g.left) / g.rx, (b[1] - g.top) / g.ry, (b[2] - g.left) / g.rx, (b[3] - g.top) / g.ry];

/** IoU de duas caixas x,y,w,h (Rect2d do OpenCV). */
function iouXywh(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = x2 > x1 && y2 > y1 ? (x2 - x1) * (y2 - y1) : 0;
  const u = a[2] * a[3] + b[2] * b[3] - inter;
  return u > 0 ? inter / u : 0;
}

/** cv2.dnn.NMSBoxes(xywh, scores, 0.0, iou): índices mantidos, por score decrescente (ordenação estável). */
export function nmsCv(xyxy, scores, iou) {
  const n = xyxy.length;
  if (!n) return [];
  const caixas = xyxy.map((b) => [b[0], b[1], b[2] - b[0], b[3] - b[1]]);
  const ordem = Array.from({ length: n }, (_, i) => i).filter((i) => scores[i] > 0).sort((a, b) => scores[b] - scores[a]);
  const keep = [];
  for (const i of ordem) {
    let ok = true;
    for (const k of keep) if (iouXywh(caixas[i], caixas[k]) > iou) { ok = false; break; }
    if (ok) keep.push(i);
  }
  return keep;
}

// ------------------------------------------------------------------ decodificadores

/**
 * decode_yolox: saída bruta (N, 5+nc) por grade — dx, dy, log w, log h, obj,
 * classes (a exportação oficial já aplica a sigmoide). Score = obj × classe,
 * NMS por classe (0,45), ordem por score.
 */
export function decodificarYolox(data, dims, g, conf, strides = [8, 16, 32]) {
  const passo = dims[dims.length - 1], N = dims[dims.length - 2];
  const nc = passo - 5;
  const [H, W] = g.size;
  const grade = [];
  for (const s of strides) {
    const hs = Math.floor(H / s), ws = Math.floor(W / s);
    for (let y = 0; y < hs; y++) for (let x = 0; x < ws; x++) grade.push([x, y, s]);
  }
  if (grade.length !== N) throw new Error(`YOLOX: ${N} âncoras na saída, ${grade.length} esperadas para ${H}×${W}`);
  const xyxy = [], sc = [], cl = [];
  for (let i = 0; i < N; i++) {
    const o = i * passo;
    const obj = data[o + 4];
    let best = 0, bv = Math.fround(obj * data[o + 5]);
    for (let c = 1; c < nc; c++) { const v = Math.fround(obj * data[o + 5 + c]); if (v > bv) { bv = v; best = c; } }
    if (!(bv >= conf)) continue;
    const [gx, gy, s] = grade[i];
    const cx = (data[o] + gx) * s, cy = (data[o + 1] + gy) * s;
    const w = Math.exp(data[o + 2]) * s, h = Math.exp(data[o + 3]) * s;
    xyxy.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]); sc.push(bv); cl.push(best);
  }
  const keep = [];
  for (const c of [...new Set(cl)].sort((a, b) => a - b)) {
    const idx = cl.map((v, i) => (v === c ? i : -1)).filter((i) => i >= 0);
    for (const k of nmsCv(idx.map((i) => xyxy[i]), idx.map((i) => sc[i]), 0.45)) keep.push(idx[k]);
  }
  keep.sort((a, b) => sc[b] - sc[a]);
  return keep.map((i) => [...paraOrig(xyxy[i], g), sc[i], cl[i]]);
}

/**
 * decode_detr: logits [Q, C] + caixas [Q, 4] cxcywh normalizadas à entrada,
 * sem NMS. `nc` limita às C primeiras colunas (os RF-DETR treinados no
 * iaVision trazem uma fatia de fundo no fim — ver docs).
 */
export function decodificarDetr(logits, ldims, caixas, g, conf, { sigmoid = true, nc = null } = {}) {
  const Q = ldims[ldims.length - 2], C = ldims[ldims.length - 1];
  const nC = nc ? Math.min(nc, C) : C;
  const [H, W] = g.size;
  const res = [];
  for (let q = 0; q < Q; q++) {
    // sigmoide por classe, ou softmax sobre TODAS as colunas; o argmax só nas nC primeiras
    let best = 0, bv = -Infinity, mx = -Infinity;
    for (let c = 0; c < nC; c++) { const z = logits[q * C + c]; if (z > bv) { bv = z; best = c; } }
    let p;
    if (sigmoid) p = sig(bv);
    else {
      for (let c = 0; c < C; c++) mx = Math.max(mx, logits[q * C + c]);
      let soma = 0;
      for (let c = 0; c < C; c++) soma += Math.exp(logits[q * C + c] - mx);
      p = Math.exp(bv - mx) / soma;
    }
    if (!(p >= conf)) continue;
    const cx = caixas[q * 4] * W, cy = caixas[q * 4 + 1] * H, w = caixas[q * 4 + 2] * W, h = caixas[q * 4 + 3] * H;
    res.push([...paraOrig([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], g), p, best]);
  }
  return res.sort((a, b) => b[4] - a[4]);
}

/**
 * decode_ultralytics: export HF (logits/pred_boxes → DETR), fim a fim
 * [N, 6] (x1,y1,x2,y2,score,cls em px da entrada) ou bruto (N, 4+nc) com NMS.
 * Saídas = { nome: {data, dims} }.
 */
export function decodificarUltralytics(saidas, g, conf) {
  if (saidas.logits && saidas.pred_boxes) return decodificarDetr(saidas.logits.data, saidas.logits.dims, saidas.pred_boxes.data, g, conf, { sigmoid: true });
  const o = Object.values(saidas)[0];
  const dims = o.dims.filter((d) => d !== 1);
  if (dims.length === 2 && dims[1] === 6) {
    const res = [];
    for (let i = 0; i < dims[0]; i++) {
      const b = Array.from(o.data.slice(i * 6, i * 6 + 6));
      if (b[4] >= conf) res.push([...paraOrig(b, g), b[4], Math.trunc(b[5])]);
    }
    return res;
  }
  // bruto: (4+nc, N) ou (N, 4+nc)
  let [a, b] = dims;
  const transp = a < b;
  const N = transp ? b : a, F = transp ? a : b;
  const at = (i, f) => (transp ? o.data[f * N + i] : o.data[i * F + f]);
  const xyxy = [], sc = [], cl = [];
  for (let i = 0; i < N; i++) {
    let best = 0, bv = at(i, 4);
    for (let f = 5; f < F; f++) if (at(i, f) > bv) { bv = at(i, f); best = f - 4; }
    if (!(bv >= conf)) continue;
    const cx = at(i, 0), cy = at(i, 1), w = at(i, 2), h = at(i, 3);
    xyxy.push([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]); sc.push(bv); cl.push(best);
  }
  return nmsCv(xyxy, sc, 0.5).map((i) => [...paraOrig(xyxy[i], g), sc[i], cl[i]]);
}

// ------------------------------------------------------------------ detect

/** repr do Python de dict/list (o `expected` do Inspect é str(s.require or s.forbid)). */
export function reprPy(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (typeof x === 'string' ? `'${x}'` : String(x))).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => `'${k}': (${x[0]}, ${x[1]})`).join(', ') + '}';
  return String(v);
}

/**
 * detect(): dets [x1,y1,x2,y2,score,classe] em px da região (origem ox, oy),
 * rótulos do modelo. require {classe: [mín, máx]}, forbid [classes].
 */
export function julgarDeteccao(dets, rotulos, s, ox = 0, oy = 0, formato = '') {
  const conf = s.conf == null ? 0.35 : +s.conf, band = s.band == null ? 0.05 : +s.band;
  const req = s.require || {}, proib = s.forbid || [];
  const cont = {};
  const ov = roiOv(s);
  let minConf = 1.0;
  for (const [x1, y1, x2, y2, sc, c] of dets) {
    const nome = c < rotulos.length && rotulos[c] != null ? rotulos[c] : String(c);
    cont[nome] = (cont[nome] || 0) + 1;
    minConf = Math.min(minConf, sc);
    ov.push({ kind: 'box', x: Math.trunc(x1 + ox), y: Math.trunc(y1 + oy), w: Math.trunc(x2 - x1), h: Math.trunc(y2 - y1),
      label: `${nome} ${sc.toFixed(2)}`, tone: proib.includes(nome) ? 'bad' : 'info' });
  }
  const motivos = Object.entries(req).filter(([k, [lo, hi]]) => !((cont[k] || 0) >= lo && (cont[k] || 0) <= hi))
    .map(([k, [lo, hi]]) => `${k}: ${cont[k] || 0} fora de ${lo}–${hi}`);
  for (const k of proib) if (cont[k]) motivos.push(`proibido: ${k}`);
  let st = motivos.length ? FAIL : PASS;
  if (st === PASS && dets.length && minConf < conf * (1 + band * 4)) st = UNCERTAIN;
  const total = Object.values(cont).reduce((a, b) => a + b, 0);
  return resultado(s, st, {
    value: total, expected: reprPy(Object.keys(req).length ? req : proib),
    confidence: dets.length ? r4(minConf) : null,
    detail: { counts: cont, reasons: motivos, format: formato, ...(st === UNCERTAIN ? { reason: `detecção colada no limiar (${r4(minConf)} < ${r4(conf * (1 + band * 4))})` } : {}) },
    overlays: ov,
  });
}

// ------------------------------------------------------------------ classify (temperatura + conformal)

/** softmax(logits / T) em float64. */
export function softmaxT(logits, T = 1) {
  const z = Array.from(logits, (v) => v / T);
  const mx = Math.max(...z);
  const e = z.map((v) => Math.exp(v - mx));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/**
 * classify(): logits do modelo, rótulos, calibração { temperature, qhat, alpha }.
 * Conjunto conformal {y : p_y ≥ 1 − q̂}: vazio ou com mais de uma classe =
 * INCERTO (o modelo não sabe); uma classe ∈ ok_labels = OK, fora = NOK.
 */
export function julgarClassificacao(logits, rotulos, cal, s) {
  const T = +(cal && cal.temperature != null ? cal.temperature : 1.0);
  const qhat = +(cal && cal.qhat != null ? cal.qhat : 0.9);
  const p = softmaxT(logits, T);
  const conj = [];
  let topI = 0;
  for (let i = 0; i < p.length; i++) { if (p[i] >= 1 - qhat) conj.push(rotulos[i] ?? String(i)); if (p[i] > p[topI]) topI = i; }
  const top = rotulos[topI] ?? String(topI);
  const okL = s.ok_labels && s.ok_labels.length ? s.ok_labels : ['ok'];
  const st = conj.length !== 1 ? UNCERTAIN : okL.includes(conj[0]) ? PASS : FAIL;
  const ordem = p.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, Math.min(p.length, 8));
  const probs = {};
  for (const [v, i] of ordem) probs[rotulos[i] ?? String(i)] = r4(v);
  return resultado(s, st, {
    value: top, expected: `∈ ${reprPy(okL)}`, confidence: r4(p[topI]),
    detail: { probs, set: conj.length > 12 ? [...conj.slice(0, 12), `… +${conj.length - 12}`] : conj, set_size: conj.length,
      alpha: cal && cal.alpha != null ? cal.alpha : null, temperature: T, qhat,
      ...(st === UNCERTAIN ? { reason: conj.length ? `conjunto conformal com ${conj.length} classes — humano decide` : 'conjunto conformal vazio — fora do que o modelo conhece' } : {}) },
    overlays: roiOv(s),
  });
}

/** np.linspace(a, b, n): a + i·passo, com o último exatamente b. */
export function linspace(a, b, n) {
  const passo = (b - a) / (n - 1);
  const out = Array.from({ length: n }, (_, i) => i * passo + a);
  out[n - 1] = b;
  return out;
}

/** np.quantile(x, q, method='higher'). */
export function quantilSuperior(x, q) {
  const s = Array.from(x).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * (s.length - 1)))];
}

/** np.percentile(x, q) linear (com o _lerp do numpy, simétrico em t = 0,5). */
export function percentil(x, q) {
  const s = Array.from(x).sort((a, b) => a - b);
  const v = (q / 100) * (s.length - 1);
  const i = Math.floor(v), t = v - i;
  if (i + 1 >= s.length) return s[s.length - 1];
  const a = s[i], b = s[i + 1], d = b - a;
  return t >= 0.5 ? b - d * (1 - t) : a + d * t;
}

/**
 * calibrate.classify(logits [n][C], rótulos [n] (índices), α): T que minimiza
 * a NLL em linspace(0,3; 5; 95), q̂ do split conformal com cobertura 1 − α.
 */
export function calibrarClassificador(logits, rotulos, alpha) {
  const n = rotulos.length;
  if (!n) throw new Error('sem amostras de calibração');
  const nll = (T) => {
    let s = 0;
    for (let k = 0; k < n; k++) {
      const z = Array.from(logits[k], (v) => v / T);
      const mx = Math.max(...z);
      let se = 0;
      for (const v of z) se += Math.exp(v - mx);
      s += -((z[rotulos[k]] - mx) - Math.log(se));
    }
    return s / n;
  };
  let T = null, melhor = Infinity;
  for (const t of linspace(0.3, 5, 95)) { const v = nll(t); if (v < melhor) { melhor = v; T = t; } }
  const P = logits.map((l) => softmaxT(l, T));
  const sc = P.map((p, k) => 1 - p[rotulos[k]]);
  const q = quantilSuperior(sc, Math.min(1.0, Math.ceil((n + 1) * (1 - alpha)) / n));
  const qhat = 1 - q;
  let cob = 0, tam = 0, unit = 0;
  for (let k = 0; k < n; k++) {
    const conj = P[k].filter((v) => v >= 1 - qhat).length;
    tam += conj; if (conj === 1) unit++;
    if (P[k][rotulos[k]] >= 1 - qhat) cob++;
  }
  return {
    threshold: null,
    calibration: { temperature: r4(T), qhat: Math.round(qhat * 1e6) / 1e6, alpha, coverage: r4(cob / n), n_cal: n },
    metrics: { avg_set_size: tam / n, singleton_rate: unit / n },
  };
}

/**
 * calibrate.anomaly(notas, rótulos 0 = boa / 1 = ruim, FN máx.): score_min =
 * percentil 1 das boas, score_max = percentil 99,5 de todas; limiar em
 * linspace(0,05; 0,95; 181) pelo melhor F1 (respeitando a taxa de FN).
 */
export function calibrarAnomalia(notas, rotulos, maxFn = null) {
  const boas = notas.filter((_, i) => rotulos[i] === 0);
  const lo = percentil(boas, 1), hi = percentil(notas, 99.5);
  const s = notas.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))));
  const nRuins = rotulos.filter((v) => v === 1).length, nBoas = rotulos.filter((v) => v === 0).length;
  let best = [0.5, -1.0];
  for (const t of linspace(0.05, 0.95, 181)) {
    let tp = 0, fp = 0, fn = 0;
    s.forEach((v, i) => { const pred = v > t; if (pred && rotulos[i] === 1) tp++; else if (pred && rotulos[i] === 0) fp++; else if (!pred && rotulos[i] === 1) fn++; });
    if (maxFn != null && fn / Math.max(nRuins, 1) > maxFn) continue;
    const f1 = (2 * tp) / Math.max(2 * tp + fp + fn, 1);
    if (f1 > best[1]) best = [t, f1];
  }
  const t = best[0];
  let fn = 0, fp = 0;
  s.forEach((v, i) => { const pred = v > t; if (!pred && rotulos[i] === 1) fn++; if (pred && rotulos[i] === 0) fp++; });
  return {
    threshold: r4(t), calibration: { score_min: lo, score_max: hi, n_cal: s.length },
    metrics: { f1: r4(best[1]), fn_rate: fn / Math.max(nRuins, 1), fp_rate: fp / Math.max(nBoas, 1) },
  };
}

// ------------------------------------------------------------------ anomaly

/** cv2.resize INTER_LINEAR (meio pixel) de um mapa Float32 W×H → w×h. */
export function redimensionarMapa(m, W, H, w, h) {
  const o = new Float32Array(w * h);
  const kx = W / w, ky = H / h;
  for (let y = 0; y < h; y++) {
    let fy = (y + 0.5) * ky - 0.5; if (fy < 0) fy = 0;
    let y0 = Math.floor(fy); if (y0 > H - 1) y0 = H - 1;
    const y1 = Math.min(H - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      let fx = (x + 0.5) * kx - 0.5; if (fx < 0) fx = 0;
      let x0 = Math.floor(fx); if (x0 > W - 1) x0 = W - 1;
      const x1 = Math.min(W - 1, x0 + 1), tx = fx - x0;
      o[y * w + x] = (m[y0 * W + x0] * (1 - tx) + m[y0 * W + x1] * tx) * (1 - ty) + (m[y1 * W + x0] * (1 - tx) + m[y1 * W + x1] * tx) * ty;
    }
  }
  return o;
}

/**
 * anomaly(): nota bruta (a "nota" do PatchCore = máximo do mapa), mapa {data,
 * W, H} (opcional), calibração { score_min, score_max } e limiar do modelo.
 * score = clip((nota − mín) / (máx − mín)); judge_range(score, None, limiar, band).
 * O mapa vai normalizado (uint8, resolução do modelo) no overlay "heat" e as
 * 5 maiores regiões acima do limiar viram caixas (tom "bad").
 */
export function julgarAnomalia(nota, mapa, cal, limiarModelo, s, regiao) {
  const lo = +(cal && cal.score_min != null ? cal.score_min : 0), hi = +(cal && cal.score_max != null ? cal.score_max : 1);
  const span = Math.max(hi - lo, 1e-9);
  const score = Math.min(1, Math.max(0, (nota - lo) / span));
  const thr = s.threshold != null && s.threshold !== '' ? +s.threshold : limiarModelo != null ? +limiarModelo : 0.5;
  const band = s.band == null ? 0.05 : +s.band;
  const st = julgarFaixa(score, null, thr, band);
  const ov = roiOv(s);
  const detail = { raw: r4(nota), threshold: thr, score_min: r4(lo), score_max: r4(hi) };
  if (mapa && regiao) {
    const { data, W, H } = mapa;
    const a8 = new Uint8Array(W * H);
    for (let i = 0; i < a8.length; i++) a8[i] = Math.trunc(Math.min(1, Math.max(0, (data[i] - lo) / span)) * 255);
    // caixas: mapa (uint8) redimensionado à região, > limiar·255, regiões externas, as 5 maiores
    const rw = Math.max(1, regiao.w), rh = Math.max(1, regiao.h);
    const g = redimensionarMapa(Float32Array.from(a8), W, H, rw, rh);
    const bin = new Uint8Array(rw * rh);
    const lim = thr * 255;
    for (let i = 0; i < bin.length; i++) bin[i] = Math.round(g[i]) > lim ? 255 : 0;
    const cc = componentes(bin, rw, rh);
    const ks = [];
    for (let k = 1; k <= cc.n; k++) ks.push(k);
    ks.sort((p, q) => cc.area[q] - cc.area[p]);
    for (const k of ks.slice(0, 5)) {
      ov.push({ kind: 'box', x: regiao.x + cc.x0[k], y: regiao.y + cc.y0[k], w: cc.x1[k] - cc.x0[k] + 1, h: cc.y1[k] - cc.y0[k] + 1, label: 'anomalia', tone: 'bad' });
    }
    ov.push({ kind: 'heat', x: regiao.x, y: regiao.y, w: rw, h: rh, W, H, a: a8, thr });
    detail.heatmap = true;
    detail.regioes = Math.min(5, ks.length);
  }
  return resultado(s, st, {
    value: r4(score), expected: `≤ ${thr}`, confidence: r4(1 - Math.abs(score - thr)), detail, overlays: ov,
  });
}
