/**
 * projeto/captura.js — o quadro ATUAL da fonte (câmera, arquivo, tela,
 * stream, YouTube) como imagem, na resolução da fonte, SEM as marcações e
 * SEM espelho — o mesmo espaço (0–1 da fonte inteira) em que as marcações
 * de cv/marcacoes.js vivem. Assim uma caixa desenhada ao vivo vira caixa do
 * print sem conversão.
 *
 * O elemento e o tamanho vêm de `vista` (o Viewport preenche a cada quadro).
 */

import { vista } from '../cv/marcacoes.js';

let tela = null;

/** Canvas com o quadro inteiro da fonte (ou só a região {x1,y1,x2,y2} em 0–1). null sem fonte. */
export function quadroCanvas(regiao = null) {
  const el = vista.el;
  if (!vista.ok || !el || !(vista.W > 1) || !(vista.H > 1)) return null;
  const W = vista.W, H = vista.H;
  const r = regiao || { x1: 0, y1: 0, x2: 1, y2: 1 };
  const sx = Math.max(0, Math.round(Math.min(r.x1, r.x2) * W)), sy = Math.max(0, Math.round(Math.min(r.y1, r.y2) * H));
  const sw = Math.max(1, Math.min(W - sx, Math.round(Math.abs(r.x2 - r.x1) * W))), sh = Math.max(1, Math.min(H - sy, Math.round(Math.abs(r.y2 - r.y1) * H)));
  const c = document.createElement('canvas');
  c.width = sw; c.height = sh;
  const g = c.getContext('2d');
  try {
    if (vista.fs) {
      // quadro do histórico gravado já espelhado: desfaz para voltar ao espaço da fonte
      if (!tela) tela = document.createElement('canvas');
      tela.width = W; tela.height = H;
      const t = tela.getContext('2d');
      t.save(); t.translate(W, 0); t.scale(-1, 1); t.drawImage(el, 0, 0, W, H); t.restore();
      g.drawImage(tela, sx, sy, sw, sh, 0, 0, sw, sh);
    } else {
      g.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh);
    }
  } catch (_) { return null; }
  return c;
}

export const paraBlob = (c, tipo = 'image/jpeg', q = 0.92) => new Promise((res) => c.toBlob(res, tipo, q));

/** Quadro atual como JPEG (Blob) ou null. */
export async function capturarQuadro(regiao = null) {
  const c = quadroCanvas(regiao);
  return c ? paraBlob(c) : null;
}

/** De onde vem o vídeo agora (vira a "origem" do print). */
export function origemAtual(st) {
  const k = st && st.sourceKind;
  return 'quadro-' + (k === 'youtube' ? 'youtube' : k === 'screen' ? 'tela' : k === 'file' ? 'arquivo' : k === 'stream' ? 'stream' : 'camera');
}
