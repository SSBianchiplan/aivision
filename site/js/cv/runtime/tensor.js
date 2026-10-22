/**
 * cv/runtime/tensor.js — ponte entre ImageData e tensor, e os decodificadores.
 *
 * O redimensionamento passa por <canvas>.drawImage de propósito: é filtrado
 * pela GPU e sai muito mais barato que um laço bilinear em JS. Num YOLOX
 * 640×640 o pré-processo deixa de aparecer no perfil.
 */

// ------------------------------------------------------------ scratch

const scratch = { src: null, dst: null };

function srcCanvas(w, h) {
  if (!scratch.src) scratch.src = document.createElement('canvas');
  const c = scratch.src;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

function dstCanvas(w, h) {
  if (!scratch.dst) scratch.dst = document.createElement('canvas');
  const c = scratch.dst;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Redimensiona com letterbox (mantém proporção, preenche o resto) e devolve
 * o ImageData no tamanho do modelo mais o mapeamento de volta.
 *
 * Distorcer a imagem para caber no quadrado degrada a detecção; o letterbox
 * evita isso ao custo de guardar scale/padding para desfazer nas caixas.
 */
export function letterbox(image, outW, outH, pad = 114) {
  const sc = srcCanvas(image.width, image.height);
  sc.getContext('2d', { willReadFrequently: true }).putImageData(image, 0, 0);

  const dc = dstCanvas(outW, outH);
  const ctx = dc.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = `rgb(${pad},${pad},${pad})`;
  ctx.fillRect(0, 0, outW, outH);

  const scale = Math.min(outW / image.width, outH / image.height);
  const dw = Math.round(image.width * scale);
  const dh = Math.round(image.height * scale);
  const dx = Math.floor((outW - dw) / 2);
  const dy = Math.floor((outH - dh) / 2);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(sc, 0, 0, image.width, image.height, dx, dy, dw, dh);

  return { data: ctx.getImageData(0, 0, outW, outH), scale, dx, dy, dw, dh };
}

/** Redimensiona esticando (sem letterbox) — para modelos que esperam isso. */
export function stretch(image, outW, outH) {
  const sc = srcCanvas(image.width, image.height);
  sc.getContext('2d', { willReadFrequently: true }).putImageData(image, 0, 0);
  const dc = dstCanvas(outW, outH);
  const ctx = dc.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(sc, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

/** Recorta uma região do ImageData e redimensiona para outW×outH. */
export function cropResize(image, x, y, w, h, outW, outH) {
  const sc = srcCanvas(image.width, image.height);
  sc.getContext('2d', { willReadFrequently: true }).putImageData(image, 0, 0);
  const dc = dstCanvas(outW, outH);
  const ctx = dc.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(sc, x, y, w, h, 0, 0, outW, outH);
  return ctx.getImageData(0, 0, outW, outH);
}

/**
 * ImageData -> Float32Array no layout e normalização que o modelo pede.
 *
 * ============== POR QUE ALOCA SEMPRE, EM VEZ DE REUSAR ==============
 *
 * A versão anterior mantinha um cache de buffers por formato, para não
 * alocar 4,9 MB de floats a cada frame. Isso ficou INCORRETO no momento em
 * que `ort.env.wasm.proxy = true` foi ligado (para tirar a inferência da
 * thread principal e resolver os 2 fps).
 *
 * Em modo proxy o ONNX Runtime TRANSFERE o ArrayBuffer do tensor para o Web
 * Worker. Transferência destaca o buffer da thread de origem: o mesmo
 * Float32Array que estava no cache passa a ter byteLength 0. A primeira
 * inferência funcionava; a segunda falhava com
 *
 *     Tensor's size(1228800) does not match data length(0)
 *
 * — mensagem que aponta para o tamanho, não para a causa.
 *
 * Os pontos de chamada que faziam `.slice()` escapavam por acidente, o que
 * é pior que falhar sempre: o bug ficava dependendo de quem lembrou de
 * copiar. Alocar aqui torna a função segura por construção, e o custo é
 * desprezível perto da inferência que vem a seguir (dezenas a centenas de ms).
 * ====================================================================
 */
export function toTensorData(img, spec) {
  const [n, a, b, c] = spec.input;
  const nchw = spec.layout !== 'nhwc';
  const H = nchw ? b : a;
  const W = nchw ? c : b;
  const C = nchw ? a : c;

  const out = new Float32Array(n * C * H * W);

  const d = img.data;
  const mean = spec.mean || [0, 0, 0];
  const std = spec.std || [1, 1, 1];
  const scale = spec.scale === undefined ? 1 / 255 : spec.scale;
  const plane = H * W;

  if (C === 1) {
    // tons de cinza (CRNN)
    const m = mean[0], s = std[0];
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      const v = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) * scale;
      out[i] = (v - m) / s;
    }
    return out;
  }

  // ordem dos canais: alguns modelos do zoo foram treinados em BGR
  const i0 = spec.bgr ? 2 : 0;
  const i2 = spec.bgr ? 0 : 2;

  if (nchw) {
    for (let i = 0, p = 0; i < plane; i++, p += 4) {
      out[i] = (d[p + i0] * scale - mean[0]) / std[0];
      out[plane + i] = (d[p + 1] * scale - mean[1]) / std[1];
      out[2 * plane + i] = (d[p + i2] * scale - mean[2]) / std[2];
    }
  } else {
    for (let i = 0, p = 0, q = 0; i < plane; i++, p += 4, q += 3) {
      out[q] = (d[p + i0] * scale - mean[0]) / std[0];
      out[q + 1] = (d[p + 1] * scale - mean[1]) / std[1];
      out[q + 2] = (d[p + i2] * scale - mean[2]) / std[2];
    }
  }
  return out;
}

// ------------------------------------------------------------ decoders

export function softmax(arr) {
  let max = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  let sum = 0;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = Math.exp(arr[i] - max);
    sum += out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= sum;
  return out;
}

export function topK(arr, k) {
  const idx = Array.from({ length: arr.length }, (_, i) => i);
  idx.sort((a, b) => arr[b] - arr[a]);
  return idx.slice(0, k).map((i) => ({ index: i, score: arr[i] }));
}

/**
 * Decodifica a saída do YOLOX: [1, 8400, 85].
 *
 * As 8400 âncoras são as grades das strides 8/16/32 concatenadas
 * (80²+40²+20²). Para cada uma: cx,cy são offsets em células da grade e
 * w,h vêm em log — daí o *stride e o exp.
 */
export function decodeYolox(data, dims, spec, conf, iou, maxDet) {
  const [, num, step] = dims;
  const numClasses = step - 5;
  const size = spec.input[2];
  const strides = spec.strides || [8, 16, 32];

  // reconstrói a grade na mesma ordem em que o modelo concatenou
  const grid = [];
  for (const s of strides) {
    const n = size / s;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) grid.push(x, y, s);
  }

  const boxes = [];
  for (let i = 0; i < num; i++) {
    const o = i * step;
    const obj = data[o + 4];
    if (obj < conf) continue;

    let best = 0, bestScore = data[o + 5];
    for (let c = 1; c < numClasses; c++) {
      if (data[o + 5 + c] > bestScore) {
        bestScore = data[o + 5 + c];
        best = c;
      }
    }
    const score = obj * bestScore;
    if (score < conf) continue;

    const g = i * 3;
    const gx = grid[g], gy = grid[g + 1], st = grid[g + 2];
    const cx = (data[o] + gx) * st;
    const cy = (data[o + 1] + gy) * st;
    const w = Math.exp(data[o + 2]) * st;
    const h = Math.exp(data[o + 3]) * st;

    boxes.push({
      x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2,
      score, classId: best,
    });
  }
  return nms(boxes, iou).slice(0, maxDet);
}

/** Non-maximum suppression, guloso por score. */
export function nms(boxes, iouThresh) {
  boxes.sort((a, b) => b.score - a.score);
  const keep = [];
  const dead = new Uint8Array(boxes.length);
  for (let i = 0; i < boxes.length; i++) {
    if (dead[i]) continue;
    keep.push(boxes[i]);
    for (let j = i + 1; j < boxes.length; j++) {
      if (!dead[j] && iou(boxes[i], boxes[j]) > iouThresh) dead[j] = 1;
    }
  }
  return keep;
}

export function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const w = x2 - x1, h = y2 - y1;
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

/** Desfaz o letterbox: coordenadas do modelo -> coordenadas da imagem. */
export function unletterbox(box, lb) {
  return {
    ...box,
    x1: (box.x1 - lb.dx) / lb.scale,
    y1: (box.y1 - lb.dy) / lb.scale,
    x2: (box.x2 - lb.dx) / lb.scale,
    y2: (box.y2 - lb.dy) / lb.scale,
  };
}

/**
 * Decode CTC guloso: colapsa repetições e remove o blank.
 * O CRNN sai [T, 1, C] com o blank no índice 0.
 */
export function ctcGreedy(data, dims, charset) {
  const [T, , C] = dims;
  let out = '';
  let prev = -1;
  let conf = 0, n = 0;
  for (let t = 0; t < T; t++) {
    const o = t * C;
    let best = 0, bestVal = data[o];
    for (let c = 1; c < C; c++) {
      if (data[o + c] > bestVal) {
        bestVal = data[o + c];
        best = c;
      }
    }
    if (best !== prev && best !== 0) {
      out += charset[best - 1] || '';
      conf += bestVal;
      n++;
    }
    prev = best;
  }
  return { text: out, score: n ? conf / n : 0 };
}
