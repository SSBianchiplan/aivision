/**
 * cv/runtime/livres-v/angulos.js — CV-88: ângulos das articulações em 3D.
 *
 * O cálculo é o do MoCap do GPlanSiS|ROBO (core/mocap/posproc.ts › angulos: flexão de joelho e
 * cotovelo, flexão de quadril e elevação do ombro em relação ao tronco, em 3D) e as faixas de
 * referência são as da Fisio do iaVision (runtime/livres-p/fisio.js › ARTICULACOES, AAOS) — nada
 * reescrito. Acrescenta só a inclinação do tronco em relação à vertical (a da Ergonomia, em 3D).
 * EDUCACIONAL: estimativa por vídeo, não é laudo médico, ergonômico nem goniometria clínica.
 */
import { angulos as angulosRobo } from '../../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';
import { ARTICULACOES, FONTE_ADM } from '../livres-p/fisio.js';

export const AVISO_ANGULOS = 'Estimativa educacional por vídeo (3D aproximado com uma câmera): não é laudo médico, ergonômico nem goniometria clínica.';
export { FONTE_ADM };

/** Rótulo do robo → articulação da Fisio (referência AAOS) e índices para a confiança. */
export const MAPA = {
  'joelho esq.': { art: 'joelho_flexao', idx: [23, 25, 27] }, 'joelho dir.': { art: 'joelho_flexao', idx: [24, 26, 28] },
  'cotovelo esq.': { art: 'cotovelo_flexao', idx: [11, 13, 15] }, 'cotovelo dir.': { art: 'cotovelo_flexao', idx: [12, 14, 16] },
  'quadril esq.': { art: 'quadril_flexao', idx: [11, 23, 25] }, 'quadril dir.': { art: 'quadril_flexao', idx: [12, 24, 26] },
  'ombro esq.': { art: 'ombro_flexao', idx: [23, 11, 13] }, 'ombro dir.': { art: 'ombro_flexao', idx: [24, 12, 14] },
};

/**
 * Ângulos de um quadro (33 × [x,y,z] | null). vis (33, opcional) e minVis: ponto pouco
 * visível invalida o ângulo (null + qualidade "inválido"), nunca um 0° falso.
 */
export function angulosQuadro(q, vis = null, minVis = 0.4) {
  const a = angulosRobo(q);
  const out = [];
  for (const [nome, v] of Object.entries(a)) {
    const m = MAPA[nome];
    const ref = m ? ARTICULACOES[m.art].ref : null;
    const conf = vis && m ? Math.min(...m.idx.map((i) => (Number.isFinite(vis[i]) ? vis[i] : 0))) : null;
    const invalido = v == null || (conf != null && conf < minVis);
    out.push({ nome, valor: invalido ? null : v, ref, convencao: m ? ARTICULACOES[m.art].movimento : '', confianca: conf, qualidade: invalido ? 'inválido' : conf != null && conf < 0.7 ? 'degradado' : 'bom' });
  }
  // tronco: ombros (meio) → quadris (meio) contra a vertical; 0° = em pé
  const mo = q[11] && q[12] ? [(q[11][0] + q[12][0]) / 2, (q[11][1] + q[12][1]) / 2, (q[11][2] + q[12][2]) / 2] : null;
  const mq = q[23] && q[24] ? [(q[23][0] + q[24][0]) / 2, (q[23][1] + q[24][1]) / 2, (q[23][2] + q[24][2]) / 2] : null;
  let tronco = null;
  if (mo && mq) {
    const d = [mo[0] - mq[0], mo[1] - mq[1], mo[2] - mq[2]], n = Math.hypot(...d);
    if (n > 1e-6) tronco = (Math.acos(Math.max(-1, Math.min(1, d[1] / n))) * 180) / Math.PI;
  }
  out.push({ nome: 'tronco (inclinação)', valor: tronco, ref: [0, 20], convencao: 'inclinação em relação à vertical', confianca: null, qualidade: tronco == null ? 'inválido' : 'bom' });
  return out;
}
