/**
 * components/motion3d/marionete-analise.js — o que a marionete 2D pede aos modelos do iaVision,
 * numa imagem parada, tudo no aparelho (fila única do ORT-web em cv/runtime/onnx.js):
 *   - recorte automático: BiRefNet lite 512 (CV-20, MIT) → alfa contínuo 0..1 no tamanho da imagem;
 *   - pose: YOLOX + BlazePose (o rastreador do Motion 3D, CV-88) → as 13 juntas da marionete.
 * Desenho que não parece gente: a pose falha ou dá pontos fracos e o Studio cai no esqueleto
 * padrão dentro da caixa do recorte (o usuário ajusta arrastando).
 */
import { MODELS, run, makeTensor, loadModel } from '../../cv/runtime/onnx.js';
import { stretch, toTensorData } from '../../cv/runtime/tensor.js';
import { bilinear, sigmoid } from '../../cv/runtime/opkit.js';
import { RastreadorMotion } from '../../cv/runtime/livres-v/pose3d.js';
import { JUNTAS_2D } from './marionete.js';

/** Lado máximo da imagem de trabalho (px): mais que isso só pesa na malha e na textura. */
export const LADO_MAX = 1024;

/** File/Blob/URL → { img (ImageBitmap/Image), w, h, dados (ImageData no tamanho de trabalho), temAlfa }. */
export async function lerImagem(arquivo) {
  const bmp = await createImageBitmap(arquivo);
  const k = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  const dados = g.getImageData(0, 0, w, h);
  let transp = 0;
  for (let i = 3; i < dados.data.length; i += 16) if (dados.data[i] < 250) transp++;
  return { img: c, w, h, dados, temAlfa: transp > (w * h) / 16 * 0.05 };
}

/** Alfa que a própria imagem já traz (PNG recortado). */
export function alfaDaImagem(dados) {
  const n = dados.width * dados.height, a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = dados.data[i * 4 + 3] / 255;
  return a;
}

/** BiRefNet → alfa 0..1 (w×h). */
export async function recorteAutomatico(dados, aoEstado = () => {}) {
  const M = 'birefnet-lite';
  aoEstado('carregando o BiRefNet (recorte)…');
  await loadModel(M);
  const spec = MODELS[M], S = spec.input[2];
  aoEstado('recortando…');
  // fundo transparente vira branco para o modelo (PNG recortado também funciona)
  const op = new ImageData(new Uint8ClampedArray(dados.data), dados.width, dados.height);
  for (let i = 0; i < op.data.length; i += 4) { const a = op.data[i + 3] / 255; if (a < 1) { op.data[i] = op.data[i] * a + 255 * (1 - a); op.data[i + 1] = op.data[i + 1] * a + 255 * (1 - a); op.data[i + 2] = op.data[i + 2] * a + 255 * (1 - a); op.data[i + 3] = 255; } }
  const out = await run(M, await makeTensor(toTensorData(stretch(op, S, S), spec), spec.input));
  const o = out[Object.keys(out)[0]];
  const W = o.dims[o.dims.length - 1], H = o.dims[o.dims.length - 2];
  const m = new Float32Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = sigmoid(o.data[i]);
  const w = dados.width, h = dados.height, a = new Float32Array(w * h);
  const kx = W / w, ky = H / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = bilinear(m, W, H, (x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
  return a;
}

/**
 * Pose na imagem parada → { juntas: {idx: [x, y]}, confianca (0..1) } ou null. Roda o
 * rastreador algumas vezes (a semente gira 0/±30° e o recorte converge).
 */
export async function poseAutomatica(dados, aoEstado = () => {}) {
  aoEstado('carregando YOLOX e BlazePose…');
  await loadModel('yolox'); await loadModel('pose');
  aoEstado('procurando o corpo na imagem…');
  const r = new RastreadorMotion();
  let res = null;
  for (let k = 0; k < 4; k++) {
    const prep = r.preparar(dados, k * 100, { esp: false, detectarMs: 1e9, forcar: k === 0 });
    const e = await r.estimar(prep);
    if (e && !e.sem && e.P) res = e;
    if (e && e.sem) break;
  }
  if (!res) return null;
  const juntas = {};
  let soma = 0;
  for (const [i] of JUNTAS_2D) { const p = res.P[i]; juntas[i] = [p.x, p.y]; soma += p.v; }
  return { juntas, confianca: soma / JUNTAS_2D.length };
}
