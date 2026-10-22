/**
 * operators/livres-m/privacidade.js — privacidade.borrar_rostos (CV-39).
 *
 * Porte de vision/worker/privacy.py do GPlanSiS|Takt: "privacidade por
 * construção" (LGPD art. 6º — finalidade, necessidade, minimização). O rosto
 * é localizado pelos keypoints da CABEÇA da pose (nariz, olhos, orelhas) —
 * não há detector facial, nem reconhecimento, nem embedding — e a região é
 * pixelada (6×6) e desfocada. Com "topo das caixas", o fallback conservador
 * do Takt: o topo (22 %) de toda caixa de pessoa também é borrado, para a
 * cabeça de costas ou fora da pose não escapar.
 *
 * Este operador MUDA OS PIXELS (não é só overlay): o vídeo exibido passa a
 * ser o quadro processado, e é ele que entra na gravação e no PNG capturado
 * (ambos copiam o canvas de exibição). Exceção: o modo Comparar mostra a
 * metade "ORIGINAL" sem borrão — ver os riscos em docs/industrial.md.
 *
 * Pose: usa o ctx.poses da cadeia (Pose multi-pessoa RTMO antes dele) ou roda
 * o próprio RTMO aqui dentro (mesmo modelo e fila de inferência, desenho
 * descartado). O operador takt.posto já borra quando a opção está ligada (o
 * padrão); este nó serve a qualquer outra cadeia com pessoas.
 */
import { clone, free } from '../../core.js';
import { poseRtmo } from '../livres-a/pose.js';
import { regioesRosto, borrarRegioes } from '../../runtime/livres-m/takt-nucleo.js';

const G = 'CV-39';

/**
 * As poses da cadeia (ctx.poses) ou as do RTMO rodado aqui. Devolve
 * { poses, fonte: 'cadeia' | 'própria', nova } — `nova` = há uma inferência
 * nova desde a última chamada (para não medir o mesmo esqueleto duas vezes).
 */
export function obterPoses(src, state, ctx, { conf = 0.3, kpConf = 0.3, maxPessoas = 20, everyMs = 0 } = {}) {
  if (Array.isArray(ctx.poses)) {
    const sig = ctx.poses.map((q) => (q.box ? `${q.box.x1.toFixed(4)},${q.box.y2.toFixed(4)}` : '')).join('|');
    const nova = sig !== state._sigPoses;
    state._sigPoses = sig;
    return { poses: ctx.poses, fonte: 'cadeia', nova };
  }
  if (!state.rtmo) state.rtmo = {};
  const sub = { w: ctx.w, h: ctx.h, overlay: [], metrics: {}, mirrored: ctx.mirrored, frameIndex: ctx.frameIndex };
  const r = poseRtmo.apply(src, { conf, kpConf, maxPessoas, caixa: false, corPorPessoa: false, everyMs }, state.rtmo, sub);
  free(r);
  for (const [k, v] of Object.entries(sub.metrics)) if (k !== 'pessoas' && k !== 'pontos visíveis') ctx.metrics[k] = v;
  const res = state.rtmo.results || null;
  const nova = res !== state._resPoses;
  state._resPoses = res;
  return { poses: sub.poses || [], fonte: 'própria', nova };
}

/** Pessoas (poses normalizadas) → regiões em px do quadro w×h. */
export function regioesDasPoses(poses, w, h, { minConf = 0.2, caixas = true } = {}) {
  const pessoas = poses.map((q) => ({
    k: q.keypoints.map((kp) => [kp.x * w, kp.y * h]),
    s: q.keypoints.map((kp) => kp.score),
    caixa: q.box ? [q.box.x1 * w, q.box.y1 * h, q.box.x2 * w, q.box.y2 * h] : null,
  }));
  // 18 px do Python valem para quadros de câmera ~1280 px; o pipeline roda em procWidth
  const rMin = Math.max(6, (18 * w) / 1280);
  return regioesRosto(pessoas, { minConf, caixas, rMin });
}

/** Cópia do quadro com os rostos borrados; devolve { img, n }. */
export function borrarQuadro(src, poses, opts) {
  const out = clone(src);
  const n = poses && poses.length ? borrarRegioes(out, regioesDasPoses(poses, src.width, src.height, opts)) : 0;
  return { img: out, n };
}

export const borrarRostos = {
  op: 'privacidade.borrar_rostos',
  label: 'Privacidade — borrar rostos (LGPD)',
  group: G,
  desc: 'Borra o rosto de cada pessoa a partir dos pontos da cabeça da pose (nariz, olhos, orelhas), sem ' +
        'detector facial nem reconhecimento — porte do privacy.py do GPlanSiS|Takt. Muda os pixels: o vídeo, a ' +
        'gravação e o PNG saem borrados. Coloque depois da Pose multi-pessoa (ou ele roda o RTMO sozinho).',
  params: {
    minConf: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.2, label: 'Confiança mín. do ponto da cabeça' },
    caixas: { type: 'bool', default: true, label: 'Borrar também o topo da caixa de cada pessoa (conservador)' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. da pose própria (ms)' },
  },
  apply(src, p, state, ctx) {
    const { poses } = obterPoses(src, state, ctx, { everyMs: p.everyMs });
    const { img, n } = borrarQuadro(src, poses, { minConf: p.minConf, caixas: p.caixas });
    ctx.metrics['rostos borrados'] = n;
    return img;
  },
};

export default [borrarRostos];
