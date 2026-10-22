/**
 * cv/operators/livres-d/rosto.js — CV-26 Malha do rosto.
 *
 * YuNet (o detector do CV-08) acha o rosto; o Face Landmarker do MediaPipe
 * (Apache-2.0, 4,9 MB) estima 478 pontos 3D num recorte girado. Entre um
 * quadro e outro o recorte vem da malha anterior e o YuNet só roda a cada
 * segundo — ver runtime/livres-d/facemesh.js.
 *
 * Publica ctx.faceMesh = [{ pts (478, x/y em 0..1 do quadro, z na escala de
 * x), pose {yaw,pitch,roll}, box, presenca, t, seq }]. O operador de olhos
 * (CV-27), se vier DEPOIS deste na cadeia, usa esta malha em vez de rodar a
 * dele — o modelo roda uma vez só.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { trackFaces, headPose, MESH_ID } from '../../runtime/livres-d/facemesh.js';
import * as C from '../../runtime/livres-d/facemesh-conexoes.js';

const G = 'CV-26';

const CONTORNOS = [
  [C.OVAL, '#a1a1aa'], [C.LABIOS, '#f472b6'],
  [C.OLHO_DIR, '#22d3ee'], [C.OLHO_ESQ, '#22d3ee'],
  [C.SOBRANCELHA_DIR, '#FFD84D'], [C.SOBRANCELHA_ESQ, '#FFD84D'],
  [C.IRIS_DIR, '#4ade80'], [C.IRIS_ESQ, '#4ade80'],
];

function copyOf(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/** Inferência compartilhada com o operador de olhos: malha normalizada + pose. */
export async function inferirMalha(img, memo, p) {
  const W = img.width, H = img.height;
  const faces = await trackFaces(img, memo, {
    conf: p.conf, max: p.max, seguir: p.seguir !== false,
  });
  memo.seq = (memo.seq || 0) + 1;
  const t = performance.now();
  return faces.map((f) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < 468; i++) {
      const q = f.pts[i];
      if (q.x < x1) x1 = q.x; if (q.x > x2) x2 = q.x;
      if (q.y < y1) y1 = q.y; if (q.y > y2) y2 = q.y;
    }
    return {
      pts: f.pts.map((q) => ({ x: q.x / W, y: q.y / H, z: q.z / W })),
      pose: headPose(f.pts),
      box: { x1: x1 / W, y1: y1 / H, x2: x2 / W, y2: y2 / H },
      presenca: f.presenca, t, seq: memo.seq,
    };
  });
}

/** Desenha pares de índices achatados (a0,b0,a1,b1…) como linhas. */
export function linhas(ctx, P, pares, cor, largura = 1) {
  for (let i = 0; i < pares.length; i += 2) {
    const a = P[pares[i]], b = P[pares[i + 1]];
    ctx.overlay.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: cor, width: largura });
  }
}

export const malha = {
  op: 'rosto.malha',
  label: 'Malha do rosto',
  group: G,
  model: MESH_ID,
  needs: ['yunet'],
  overlayOnly: true,
  desc: 'MediaPipe Face Landmarker (Apache-2.0): 468 pontos do rosto + 10 da íris sobre o ' +
        'detector YuNet. Desenha a malha, os pontos ou só os contornos (olhos, sobrancelhas, ' +
        'lábios, oval) e estima a orientação da cabeça (yaw, pitch, roll). Publica ctx.faceMesh.',
  params: {
    conf: { type: 'float', min: 0.3, max: 0.99, step: 0.05, default: 0.7, label: 'Confiança do rosto' },
    max: { type: 'int', min: 1, max: 4, step: 1, default: 1, label: 'Máximo de rostos' },
    desenho: { type: 'enum', options: ['contornos', 'malha', 'pontos', 'nenhum'], default: 'contornos', label: 'Desenhar' },
    pose: { type: 'bool', default: true, label: 'Orientação da cabeça' },
    seguir: { type: 'bool', default: true, label: 'Seguir entre quadros' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yunet', state, ctx)) return clone(src);
    if (!ensure(MESH_ID, state, ctx)) return clone(src);
    const memo = state.memo || (state.memo = {});

    schedule(state, p.everyMs, () => ({ img: copyOf(src) }), ({ img }) => inferirMalha(img, memo, p));

    const faces = state.results || [];
    ctx.faceMesh = faces;
    const W = ctx.w, H = ctx.h;
    faces.forEach((f, k) => {
      const P = f.pts.map((q) => ({ x: q.x * W, y: q.y * H }));
      if (p.desenho === 'malha') linhas(ctx, P, C.TESSELACAO, 'rgba(163,230,53,.55)', 0.7);
      if (p.desenho === 'contornos' || p.desenho === 'malha') {
        for (const [pares, cor] of CONTORNOS) linhas(ctx, P, pares, cor, p.desenho === 'malha' ? 1.2 : 1.6);
      }
      if (p.desenho === 'pontos') {
        P.forEach((q, i) => ctx.overlay.push({ type: 'point', x: q.x, y: q.y, r: i < 468 ? 1 : 1.6, color: i < 468 ? '#4ade80' : '#f472b6' }));
      }
      const pose = f.pose;
      if (p.pose) {
        ctx.overlay.push({
          type: 'rect',
          x: f.box.x1 * W, y: f.box.y1 * H, w: (f.box.x2 - f.box.x1) * W, h: (f.box.y2 - f.box.y1) * H,
          color: '#fb923c',
          label: `yaw ${pose.yaw.toFixed(0)}° pitch ${pose.pitch.toFixed(0)}° roll ${pose.roll.toFixed(0)}°`,
        });
      }
      if (p.pose) {
        // seta saindo do nariz na direção para onde o rosto aponta
        const r = (Math.PI / 180), L = (f.box.x2 - f.box.x1) * W * 0.6;
        const dx = Math.sin(pose.yaw * r) * Math.cos(pose.pitch * r), dy = -Math.sin(pose.pitch * r);
        const n = P[1];
        ctx.overlay.push({ type: 'line', x1: n.x, y1: n.y, x2: n.x + dx * L, y2: n.y + dy * L, color: '#fb923c', width: 3 });
        ctx.overlay.push({ type: 'point', x: n.x, y: n.y, r: 3, color: '#fb923c' });
      }
      if (k === 0) {
        ctx.metrics['yaw'] = pose.yaw.toFixed(0) + '°';
        ctx.metrics['pitch'] = pose.pitch.toFixed(0) + '°';
        ctx.metrics['roll'] = pose.roll.toFixed(0) + '°';
      }
    });
    ctx.metrics['rostos (malha)'] = faces.length;
    if (state.inferMs) ctx.metrics['malha ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['malha erro'] = state.error;
    return clone(src);
  },
};

export default [malha];
