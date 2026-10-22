/**
 * cv/operators/face.js — CV-08 Face Recognition.
 *
 * Dois operadores de pipeline. O módulo de autenticação NÃO passa por aqui:
 * ele chama cv/runtime/face.js direto, porque no login o que se quer é um
 * embedding sob demanda, não overlay por frame.
 *
 * Mesma disciplina assíncrona dos outros modelos: a inferência roda por fora
 * do loop de render e cada frame desenha o último resultado conhecido.
 */

import { clone } from '../core.js';
import { isReady, loadModel, modelStates } from '../runtime/onnx.js';
import {
  detectFaces, alignFace, embedFace, cosine, faceThreshold, livenessScore,
} from '../runtime/face.js';
import * as api from '../../auth/api.js';

function ensureModels(ids, state, ctx) {
  const missing = ids.filter((id) => !isReady(id));
  if (!missing.length) return true;
  if (!state.requested) {
    state.requested = true;
    Promise.all(ids.map((id) => loadModel(id))).catch((err) => {
      state.loadError = String(err && err.message ? err.message : err);
    });
  }
  const sts = modelStates();
  const prog = ids.map((id) => sts[id]).filter(Boolean);
  const pct = Math.round((prog.reduce((a, s) => a + (s.progress || 0), 0) / ids.length) * 100);
  ctx.metrics['face'] = state.loadError ? 'erro: ' + state.loadError
    : pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
  return false;
}

function schedule(state, minMs, prep, infer) {
  const now = performance.now();
  if (state.busy) return;
  if (state.lastStart && now - state.lastStart < minMs) return;
  let input;
  try { input = prep(); } catch (err) { state.error = String(err.message || err); return; }
  if (!input) return;
  state.busy = true;
  state.lastStart = now;
  Promise.resolve().then(() => infer(input))
    .then((r) => { state.results = r; state.inferMs = performance.now() - now; state.error = null; })
    .catch((err) => { state.error = String(err && err.message ? err.message : err); })
    .finally(() => { state.busy = false; });
}

// =============================================================== detecção

export const faceDetect = {
  op: 'objdetect.face_detect',
  label: 'Face Detection',
  group: 'CV-08',
  model: 'yunet',
  overlayOnly: true,
  desc: 'YuNet (MIT, 230 KB): caixa da face + 5 landmarks (olhos, nariz, cantos ' +
        'da boca). É o estágio que alimenta o reconhecimento e o login.',
  params: {
    conf: { type: 'float', min: 0.3, max: 0.99, step: 0.05, default: 0.8, label: 'Confiança' },
    landmarks: { type: 'bool', default: true, label: 'Mostrar landmarks' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensureModels(['yunet'], state, ctx)) return clone(src);

    schedule(state, p.everyMs,
      () => ({ img: copyOf(src), w: src.width, h: src.height }),
      async ({ img, w, h }) => {
        const faces = await detectFaces(img, { conf: p.conf });
        return faces.map((f) => ({
          x: f.x1 / w, y: f.y1 / h, w: (f.x2 - f.x1) / w, h: (f.y2 - f.y1) / h,
          score: f.score,
          pts: f.landmarks.map((l) => ({ x: l.x / w, y: l.y / h })),
        }));
      });

    for (const f of state.results || []) {
      ctx.overlay.push({
        type: 'rect',
        x: f.x * ctx.w, y: f.y * ctx.h, w: f.w * ctx.w, h: f.h * ctx.h,
        color: '#22d3ee',
        label: `face ${(f.score * 100) | 0}%`,
      });
      if (p.landmarks) {
        for (const pt of f.pts) {
          ctx.overlay.push({ type: 'point', x: pt.x * ctx.w, y: pt.y * ctx.h, r: 2.5, color: '#FFD84D' });
        }
      }
    }
    ctx.metrics['faces'] = (state.results || []).length;
    if (state.inferMs) ctx.metrics['face ms'] = state.inferMs.toFixed(0);
    return clone(src);
  },
};

// =============================================================== reconhecimento

export const faceRecognize = {
  op: 'objdetect.face_recognize',
  label: 'Face Recognition',
  group: 'CV-08',
  model: 'sface',
  needs: ['yunet'],
  overlayOnly: true,
  desc: 'YuNet + SFace: alinha a face pelo template de 5 pontos e extrai o ' +
        'embedding de 128-d. A COMPARAÇÃO é feita no servidor — o template ' +
        'de ninguém é enviado ao navegador. Confere contra o seu próprio ' +
        'cadastro, e exige sessão ativa.',
  params: {
    conf: { type: 'float', min: 0.3, max: 0.99, step: 0.05, default: 0.8, label: 'Confiança da face' },
    margin: { type: 'float', min: -0.2, max: 0.3, step: 0.01, default: 0, label: 'Ajuste do limiar' },
    liveness: { type: 'bool', default: true, label: 'Indicar vivacidade' },
    everyMs: { type: 'int', min: 500, max: 5000, step: 100, default: 1500, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensureModels(['yunet', 'sface'], state, ctx)) return clone(src);


    schedule(state, p.everyMs,
      () => ({ img: copyOf(src), w: src.width, h: src.height }),
      async ({ img, w, h }) => {
        const faces = await detectFaces(img, { conf: p.conf, max: 5 });
        const out = [];
        /*
         * A COMPARAÇÃO ACONTECE NO SERVIDOR.
         *
         * Antes, os templates de todo mundo eram carregados no navegador e
         * comparados aqui — o que significa que qualquer pessoa com o
         * devtools aberto lia a biometria alheia. Agora só o vetor do rosto
         * na tela sobe, e volta apenas um booleano com o score. O template
         * de ninguém chega ao cliente.
         *
         * Só o maior rosto é conferido, e no máximo uma vez por ciclo: uma
         * chamada de rede por face por frame afogaria a API sem melhorar
         * nada que o olho perceba.
         */
        let checked = null;
        if (faces.length) {
          const biggest = faces.reduce((a, b) =>
            (b.x2 - b.x1) * (b.y2 - b.y1) > (a.x2 - a.x1) * (a.y2 - a.y1) ? b : a);
          try {
            const vector = await embedFace(alignFace(img, biggest));
            const r = await api.identifyFace(vector);
            checked = { face: biggest, match: r.match, score: r.score };
          } catch (err) {
            checked = { face: biggest, error: err.message };
          }
        }

        for (const f of faces) {
          const isChecked = checked && checked.face === f;
          const live = p.liveness
            ? livenessScore(state.live || (state.live = {}), img, f)
            : null;
          out.push({
            x: f.x1 / w, y: f.y1 / h, w: (f.x2 - f.x1) / w, h: (f.y2 - f.y1) / h,
            match: isChecked && checked.match ? { name: 'você' } : null,
            score: isChecked && checked.score !== undefined ? checked.score : -1,
            checked: Boolean(isChecked),
            error: isChecked ? checked.error : null,
            live,
          });
        }
        return out;
      });

    const res = state.results || [];
    for (const f of res) {
      const known = Boolean(f.match);
      let label = f.error
        ? 'erro: ' + f.error
        : known
          ? `${f.match.name} · ${f.score.toFixed(2)}`
          : f.checked
            ? `não confere · ${f.score >= 0 ? f.score.toFixed(2) : '—'}`
            : 'face';
      if (f.live !== null && f.live !== undefined) {
        label += f.live > 0.25 ? ' ✓' : ' ⚠parado';
      }
      ctx.overlay.push({
        type: 'rect',
        x: f.x * ctx.w, y: f.y * ctx.h, w: f.w * ctx.w, h: f.h * ctx.h,
        color: known ? '#4ade80' : f.checked ? '#f87171' : '#22d3ee',
        label,
      });
    }
    ctx.metrics['reconhecidos'] = res.filter((f) => f.match).length + '/' + res.length;
    if (state.inferMs) ctx.metrics['recog ms'] = state.inferMs.toFixed(0);
    return clone(src);
  },
};

/** Cópia do frame: o buffer original volta ao pool antes da inferência terminar. */
function copyOf(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

export default [faceDetect, faceRecognize];
