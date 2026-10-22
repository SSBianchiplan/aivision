/**
 * auth/face.js — captura de amostras faciais para cadastro.
 *
 * Só a captura mora aqui. O template resultante vai para o SERVIDOR
 * (auth/api.js → POST /api/face/enroll) e a comparação acontece lá. Nada de
 * biometria fica guardado no navegador — o que antes vivia em IndexedDB
 * saiu junto com o sistema de login local.
 */

import { embedLargestFace, ensureFaceModels } from '../cv/runtime/face.js';

/**
 * Captura `count` amostras da mesma pessoa, espaçadas no tempo.
 *
 * O intervalo não é enfeite: amostras tiradas no mesmo instante são quase
 * idênticas e não acrescentam informação. Espaçadas, pegam variação natural
 * de pose e luz, que é justamente o que derruba a falsa rejeição depois.
 */
export async function captureSamples(getFrame, { count = 5, intervalMs = 500, onProgress } = {}) {
  await ensureFaceModels(true);
  const vectors = [];
  const rejected = [];

  for (let i = 0; i < count; i++) {
    const frame = getFrame();
    if (!frame) {
      rejected.push('sem imagem da câmera');
    } else {
      const r = await embedLargestFace(frame, { conf: 0.8 });
      if (!r) rejected.push('nenhuma face detectada');
      else if ((r.face.x2 - r.face.x1) < 60) rejected.push('face pequena demais — aproxime-se');
      else vectors.push(r.vector);
    }
    if (onProgress) onProgress({ done: i + 1, total: count, captured: vectors.length });
    if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (!vectors.length) throw new Error('Nenhuma amostra válida. ' + (rejected[0] || ''));
  return { vectors, rejected };
}
