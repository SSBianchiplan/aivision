/**
 * cv/runtime/livres-v/levantar-worker.js — o passe de QUALIDADE do levantamento 2D→3D fora da
 * thread da interface (nada de long task): recebe a tomada (p2d, trilhaBruta, aspecto, fps) e
 * devolve a trilha refinada (levantar.js · refinarTrilha), com progresso.
 */
import { refinarTrilha } from './levantar.js';

self.onmessage = (ev) => {
  const d = ev.data || {};
  try {
    const r = refinarTrilha({ ...d, aoProgresso: (f) => self.postMessage({ progresso: f }) });
    self.postMessage({ ok: true, trilha: r.trilha, inclinacaoGraus: r.inclinacaoGraus });
  } catch (e) { self.postMessage({ ok: false, erro: String(e && e.message ? e.message : e) }); }
};
