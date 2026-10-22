/**
 * cv/runtime/livres-s/produto.js — FOTO DE PRODUTO para e-commerce (V4):
 * máscara do BiRefNet (CV-20) → recorte do objeto → enquadramento padrão
 * (quadrado/4:5/…, margem fixa, centralizado, apoiado na base) → fundo branco,
 * cor ou transparente → sombra suave de contato. Mesma composição na prévia
 * ao vivo, no "Exportar foto" e no LOTE (várias fotos do celular → ZIP).
 *
 * comporProduto() trabalha em ImageData/Float32Array (testável sem modelo);
 * mascaraBiRefNet() roda o modelo pela fila única do ORT.
 */
import { MODELS, loadModel, run, makeTensor } from '../onnx.js';
import { stretch, toTensorData } from '../tensor.js';
import { sigmoid, bilinear } from '../opkit.js';

export const MODELO = 'birefnet-lite';
export const PROPORCOES = { '1:1': 1, '4:5': 4 / 5, '3:4': 3 / 4, '16:9': 16 / 9 };

/** BiRefNet numa imagem → { m (0–1, W×H), W, H }. A imagem é copiada antes do await. */
export async function mascaraBiRefNet(img) {
  await loadModel(MODELO);
  const spec = MODELS[MODELO];
  const S = spec.input[2];
  const data = toTensorData(stretch(img, S, S), spec);
  const out = await run(MODELO, await makeTensor(data, spec.input));
  const o = out[Object.keys(out)[0]];
  const W = o.dims[o.dims.length - 1], H = o.dims[o.dims.length - 2];
  const m = new Float32Array(W * H);
  for (let i = 0; i < m.length; i++) m[i] = sigmoid(o.data[i]);
  return { m, W, H };
}

/** Caixa (px de w×h) do primeiro plano: pixels com alfa ≥ lim. null se vazio. */
export function caixaDaMascara(mask, w, h, lim = 0.5) {
  const { m, W, H } = mask;
  let x1 = W, y1 = H, x2 = -1, y2 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (m[y * W + x] < lim) continue;
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  if (x2 < 0) return null;
  const kx = w / W, ky = h / H;
  return { x1: x1 * kx, y1: y1 * ky, x2: (x2 + 1) * kx, y2: (y2 + 1) * ky };
}

const hex = (s) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(s || '').trim()); const n = m ? parseInt(m[1], 16) : 0xffffff; return [n >> 16, (n >> 8) & 255, n & 255]; };

/**
 * Compõe a foto. img: ImageData (a foto); mask: { m, W, H } (0–1).
 * o = { saida (px do lado maior), proporcao ('1:1'…), margem (fração), fundo ('branco'|'transparente'|'cor'),
 *       cor ('#rrggbb'), sombra (0–1), dureza (0–1), limiar, base ('centro'|'apoiado') }
 * Devolve { img: ImageData Wo×Ho, caixa (do produto na saída, px), escala, origem (caixa na foto) } ou null sem objeto.
 */
export function comporProduto(img, mask, o = {}) {
  const lim = o.limiar ?? 0.5;
  const cx = caixaDaMascara(mask, img.width, img.height, lim);
  if (!cx) return null;
  const prop = PROPORCOES[o.proporcao] || 1;
  const L = o.saida || 1200;
  const Wo = prop >= 1 ? L : Math.round(L * prop), Ho = prop >= 1 ? Math.round(L / prop) : L;
  const mg = Math.max(0, Math.min(0.4, o.margem ?? 0.08));
  const bw = cx.x2 - cx.x1, bh = cx.y2 - cx.y1;
  const k = Math.min((Wo * (1 - 2 * mg)) / bw, (Ho * (1 - 2 * mg)) / bh);
  const pw = bw * k, ph = bh * k;
  const ox = (Wo - pw) / 2;
  const oy = o.base === 'apoiado' ? Ho - Ho * mg - ph : (Ho - ph) / 2;
  const transp = o.fundo === 'transparente';
  const [fr, fg, fb] = o.fundo === 'cor' ? hex(o.cor) : [255, 255, 255];
  const out = new ImageData(Wo, Ho);
  const od = out.data, sd = img.data, W = img.width, H = img.height;
  const { m, W: MW, H: MH } = mask;
  const mkx = MW / W, mky = MH / H;
  const dureza = o.dureza ?? 0.3, ganho = 1 / Math.max(0.02, 1 - dureza);
  // alfa do produto em cada pixel da saída (amostragem bilinear da máscara e vizinho mais próximo da foto)
  const alfa = new Float32Array(Wo * Ho);
  for (let y = 0; y < Ho; y++) {
    const sy = cx.y1 + (y + 0.5 - oy) / k;
    for (let x = 0; x < Wo; x++) {
      const sx = cx.x1 + (x + 0.5 - ox) / k;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      let a = bilinear(m, MW, MH, sx * mkx - 0.5, sy * mky - 0.5);
      if (dureza > 0) a = Math.min(1, Math.max(0, (a - lim) * ganho + 0.5));
      alfa[y * Wo + x] = a;
    }
  }
  // sombra de contato: elipse achatada sob a base do produto, borrada (gaussiana radial)
  const sombra = Math.max(0, Math.min(1, o.sombra ?? 0.35));
  const scx = ox + pw / 2, scy = oy + ph, srx = pw * 0.48, sry = Math.max(4, ph * 0.045);
  for (let y = 0; y < Ho; y++) {
    for (let x = 0; x < Wo; x++) {
      const i = y * Wo + x, q = i * 4;
      let r = fr, g = fg, b = fb, al = transp ? 0 : 255;
      if (sombra > 0) {
        const dx = (x + 0.5 - scx) / srx, dy = (y + 0.5 - scy) / sry, d2 = dx * dx + dy * dy;
        if (d2 < 4) {
          const s = sombra * 0.55 * Math.exp(-d2 * 1.6);
          if (transp) { r = 0; g = 0; b = 0; al = Math.round(255 * s); } else { r *= 1 - s; g *= 1 - s; b *= 1 - s; }
        }
      }
      const a = alfa[i];
      if (a > 0) {
        const sx = Math.min(W - 1, Math.floor(cx.x1 + (x + 0.5 - ox) / k)), sy = Math.min(H - 1, Math.floor(cx.y1 + (y + 0.5 - oy) / k));
        const p = (sy * W + sx) * 4;
        if (transp) {
          const A = a + (al / 255) * (1 - a);
          if (A > 0) { r = (sd[p] * a + r * (al / 255) * (1 - a)) / A; g = (sd[p + 1] * a + g * (al / 255) * (1 - a)) / A; b = (sd[p + 2] * a + b * (al / 255) * (1 - a)) / A; }
          al = Math.round(A * 255);
        } else { r = sd[p] * a + r * (1 - a); g = sd[p + 1] * a + g * (1 - a); b = sd[p + 2] * a + b * (1 - a); }
      }
      od[q] = r; od[q + 1] = g; od[q + 2] = b; od[q + 3] = al;
    }
  }
  return { img: out, caixa: { x1: ox, y1: oy, x2: ox + pw, y2: oy + ph }, escala: k, origem: cx };
}

/** ImageData → Blob (PNG para transparente, JPEG 92 % senão). */
export async function paraBlob(im, transparente) {
  const c = document.createElement('canvas');
  c.width = im.width; c.height = im.height;
  c.getContext('2d').putImageData(im, 0, 0);
  return new Promise((ok) => c.toBlob(ok, transparente ? 'image/png' : 'image/jpeg', 0.92));
}

/** Arquivo de imagem (File/Blob) → ImageData, com o lado maior limitado a `max` px. */
export async function imagemDeArquivo(f, max = 2400) {
  const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return g.getImageData(0, 0, w, h);
}
