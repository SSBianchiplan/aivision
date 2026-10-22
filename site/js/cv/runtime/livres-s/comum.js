/**
 * cv/runtime/livres-s/comum.js — utilitários do grupo S (CV-60..67):
 * passo de tempo do quadro, miniatura com rosto borrado (LGPD), números
 * pt-BR e leitura de parâmetros vindos do NOME de uma marcação.
 */
import { tempoDe } from '../livres-oa/canal.js';
import { borrarQuadro } from '../../operators/livres-m/privacidade.js';

/**
 * Instante e passo do quadro (s). dt = 0 com a fonte parada, no primeiro
 * quadro, num salto para trás ou numa lacuna > `maxDt` (vídeo pulado).
 */
export function passoTempo(state, ctx, maxDt = 1) {
  const { t, relogio } = tempoDe(ctx);
  let dt = 0;
  if (state.__t != null && !ctx.fonteParada) {
    const d = t - state.__t;
    if (d > 0 && d <= maxDt) dt = d;
  }
  state.__t = t;
  return { t, dt, relogio };
}

/** "Bicicletário (8)", "Vagas 1-12 [12]" → 8 / 12; senão `padrao`. */
export function capacidadeDoNome(nome, padrao = 1) {
  const m = /[([]\s*(\d{1,4})\s*[)\]]\s*$/.exec(String(nome || ''));
  return m ? Math.max(1, +m[1]) : padrao;
}

/** Número pt-BR: "1.234,56", "R$ 4,99", "4.99" → número (ou NaN). */
export function numeroBR(s) {
  let t = String(s ?? '').replace(/R\$|\s/gi, '').replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  const v = t.lastIndexOf(','), p = t.lastIndexOf('.');
  if (v >= 0 && p >= 0) t = v > p ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (v >= 0) t = t.replace(/\./g, '').replace(',', '.');
  // só pontos: "1.234" / "1.234.567" = milhar (pt-BR); "4.99" = decimal
  else if (p >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

export const fmtBR = (v, c = 2) => (Number.isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');

let cvTmp = null;
/**
 * Miniatura JPEG (data URL) da `caixa` (0–1, com margem) do quadro `src`,
 * com os rostos BORRADOS pelas poses da cadeia (privacidade.borrar_rostos;
 * sem pose, o terço de cima da caixa é borrado — conservador). Nada sai do
 * navegador: a miniatura vai só para o relatório local.
 */
export function miniatura(src, caixa, poses, lado = 220) {
  try {
    if (typeof document === 'undefined') return null;
    let img = src;
    let tem = Array.isArray(poses) && poses.length > 0;
    if (tem) { const r = borrarQuadro(src, poses, { minConf: 0.2, caixas: true }); img = r.img; }
    const W = img.width, H = img.height;
    if (!cvTmp) cvTmp = document.createElement('canvas');
    if (cvTmp.width !== W || cvTmp.height !== H) { cvTmp.width = W; cvTmp.height = H; }
    const g0 = cvTmp.getContext('2d', { willReadFrequently: true });
    g0.putImageData(img, 0, 0);
    const cx = ((caixa.x1 + caixa.x2) / 2) * W, cy = ((caixa.y1 + caixa.y2) / 2) * H;
    const s = Math.max(16, Math.max((caixa.x2 - caixa.x1) * W, (caixa.y2 - caixa.y1) * H) * 1.15);
    const c = document.createElement('canvas'); c.width = lado; c.height = lado;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, lado, lado);
    g.drawImage(cvTmp, cx - s / 2, cy - s / 2, s, s, 0, 0, lado, lado);
    if (!tem) {
      // sem pose: borra o topo da caixa (onde estaria a cabeça)
      const k = lado / s, y0 = (caixa.y1 * H - (cy - s / 2)) * k, hh = (caixa.y2 - caixa.y1) * H * k * 0.3;
      g.filter = 'blur(8px)';
      g.drawImage(c, 0, Math.max(0, y0), lado, Math.max(1, hh), 0, Math.max(0, y0), lado, Math.max(1, hh));
      g.filter = 'none';
    }
    return c.toDataURL('image/jpeg', 0.8);
  } catch (_) { return null; }
}

/** Distância normalizada no quadro com proporção (w, h): sqrt(dx² + (dy·h/w)²). */
export const distQuadro = (a, b, w, h) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * (h / w));
