/**
 * cv/runtime/livres-d/geom.js — o recorte que os modelos do MediaPipe pedem.
 *
 * Mão e malha do rosto são modelos de SEGUNDO ESTÁGIO: não olham o quadro
 * inteiro, olham um quadrado em volta do alvo, GIRADO para que ele fique na
 * pose em que o modelo foi treinado (mão em pé, olhos na horizontal). O
 * cropResize de tensor.js só recorta alinhado aos eixos — daí este arquivo.
 *
 * Um ROI é { cx, cy, size, ang } em pixels da imagem. O ponto (u,v) do
 * recorte S×S corresponde a  c + R(ang)·((u − S/2)·k, (v − S/2)·k), k = size/S.
 * Fora da imagem o recorte é PRETO, como o MediaPipe faz (o letterbox de
 * tensor.js preenche com 114, que é a convenção do YOLOX, não desta família).
 *
 * ================ REDUÇÃO FORTE PRECISA DE PIRÂMIDE ================
 * O drawImage do canvas reduz com filtro bilinear SEM pré-filtro: de 960 px
 * para 192 (5×) ele amostra pixels soltos e a imagem sai serrilhada. O
 * detector de palma é sensível a isso — na mesma foto, com redução por área
 * (cv2.INTER_AREA) achou a mão com 0,90; com bilinear achou um falso positivo
 * no rosto com 0,57 e perdeu a mão. Por isso, quando a escala fica abaixo de
 * 1/2, o recorte sai de uma pirâmide de metades (cada metade = média 2×2),
 * que equivale à redução por área.
 * ===================================================================
 */

const scratch = {};
const piramides = new WeakMap();   // canvas do quadro -> { niveis: [½, ¼, …], validos }
function canvasOf(key, w, h) {
  let c = scratch[key];
  if (!c) c = scratch[key] = document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Põe o ImageData num canvas reaproveitado (uma vez por inferência, vários recortes). */
export function frameCanvas(img, key = 'quadro') {
  const c = canvasOf(key, img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  const pir = piramides.get(c);
  if (pir) pir.validos = 0;        // quadro novo: os níveis (reaproveitados) ficam velhos
  return c;
}

/** Nível `lv` da pirâmide de metades do canvas (0 = o próprio). */
function nivel(canvas, lv) {
  if (!lv) return canvas;
  let pir = piramides.get(canvas);
  if (!pir) piramides.set(canvas, (pir = { niveis: [], validos: 0 }));
  for (let i = pir.validos; i < lv; i++) {
    const ant = i ? pir.niveis[i - 1] : canvas;
    const c = pir.niveis[i] || (pir.niveis[i] = document.createElement('canvas'));
    const w = Math.max(1, Math.ceil(ant.width / 2)), h = Math.max(1, Math.ceil(ant.height / 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(ant, 0, 0, ant.width / 2, ant.height / 2);
    pir.validos = i + 1;
  }
  return pir.niveis[lv - 1];
}

/** Recorte girado S×S de `canvas` no ROI. */
export function rotCrop(canvas, roi, S) {
  const c = canvasOf('rec' + S, S, S);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  const k = S / roi.size;
  let lv = 0;
  while (k * (1 << lv) < 0.5 && lv < 6) lv++;
  const f = 1 << lv;                  // 1 px do nível = f px da imagem
  g.translate(S / 2, S / 2);
  g.scale(k, k);
  g.rotate(-roi.ang);
  g.translate(-roi.cx, -roi.cy);
  g.scale(f, f);
  g.drawImage(nivel(canvas, lv), 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return g.getImageData(0, 0, S, S);
}

/** Ponto do recorte (u,v em 0..S) -> pixels da imagem. */
export function cropToImage(roi, S, u, v) {
  const k = roi.size / S, c = Math.cos(roi.ang), s = Math.sin(roi.ang);
  const x = (u - S / 2) * k, y = (v - S / 2) * k;
  return { x: roi.cx + c * x - s * y, y: roi.cy + s * x + c * y };
}

/**
 * ROI a partir de pontos: gira pelo ângulo `ang`, pega a caixa dos pontos no
 * referencial girado, desloca o centro por (shiftX, shiftY)×(lado da caixa) e
 * faz o quadrado de lado max(w,h)·scale.
 */
export function roiFromPoints(pts, ang, scale, shiftX = 0, shiftY = 0) {
  const c = Math.cos(ang), s = Math.sin(ang);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    const u = c * p.x + s * p.y, v = -s * p.x + c * p.y;    // R(−ang)·p
    if (u < x0) x0 = u; if (u > x1) x1 = u;
    if (v < y0) y0 = v; if (v > y1) y1 = v;
  }
  const w = x1 - x0, h = y1 - y0;
  const u = (x0 + x1) / 2 + shiftX * w, v = (y0 + y1) / 2 + shiftY * h;
  return { cx: c * u - s * v, cy: s * u + c * v, size: Math.max(w, h) * scale, ang };
}

/** Os 4 cantos do ROI em pixels da imagem (para desenhar o recorte). */
export function roiCorners(roi) {
  const h = roi.size / 2, c = Math.cos(roi.ang), s = Math.sin(roi.ang);
  return [[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, y]) => ({ x: roi.cx + c * x - s * y, y: roi.cy + s * x + c * y }));
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
