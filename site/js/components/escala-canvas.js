/**
 * components/escala-canvas.js — densidade de pixels dos canvases de vídeo com teto de ÁREA.
 *
 * Num monitor grande com Retina (3162×1553 px CSS × 2 = 6324×3106, quase 20 MP), o canvas de
 * exibição era redesenhado inteiro a cada quadro, e o Studio copiava esse canvas para o seu:
 * medido no Motion 3D com o YouTube compartilhado, 13 fps, 54 ms por quadro e 73 travadas em
 * 10 s — e no aparelho do usuário 1,6 a 7 fps, com a GPU disputada pela inferência. Um vídeo de
 * 1080p não ganha nada acima de ~4 MP de canvas: o teto devolve a densidade que cabe na área
 * (nunca acima de 2, nunca abaixo de 0,8) e o navegador amplia o resto, como faz com o <video>.
 * Em telas comuns (até ~1440×900 CSS com Retina) nada muda.
 */
export const TETO_VIDEO = 4.2e6;    // canvas de vídeo principal (~2730×1536)
export const TETO_STUDIO = 3e6;     // canvases de vídeo/3D dentro dos Studios

/** Densidade efetiva para um canvas de `wCss`×`hCss` px CSS, com no máximo `teto` pixels. */
export function dprCanvas(wCss, hCss, teto = TETO_VIDEO) {
  const d = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const a = (wCss || 0) * (hCss || 0);
  if (!a) return d;
  return Math.max(Math.min(d, 0.8), Math.min(d, Math.sqrt(teto / a)));
}
