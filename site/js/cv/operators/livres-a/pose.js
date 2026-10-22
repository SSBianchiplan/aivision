/**
 * cv/operators/livres-a/pose.js — CV-18 Pose multi-pessoa (RTMO-s, MMPose, Apache-2.0).
 *
 * O CV-06 é de dois estágios (YOLOX acha UMA pessoa, BlazePose estima no
 * recorte): com cinco pessoas na cena, quatro ficam sem esqueleto. O RTMO é
 * de um estágio: um único passe em 640² devolve todas as pessoas, cada uma
 * com caixa e os 17 pontos do COCO. O NMS já está dentro do grafo (export
 * "end2end" do MMDeploy), então aqui é só filtrar por score e desfazer o
 * letterbox.
 *
 * Entrada: BGR cru 0..255, letterbox com cinza 114 (o pipeline.json do SDK).
 * Saídas: dets [1,N,5] (x1,y1,x2,y2,score) e keypoints [1,N,17,3] (x,y,score).
 *
 * Validado na VPS com fotos do COCO val: 14 de 14 crianças numa foto de grupo
 * com score > 0,3, todas com nariz acima do quadril; ~0,8-1 s por frame em 4
 * núcleos de CPU no Python.
 *
 * Publica ctx.detections (as pessoas, name 'pessoa', com `keypoints`) — então
 * Re-ID, tracking, SAM etc. podem vir depois na cadeia — e ctx.poses.
 */
import { clone } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { letterbox, toTensorData } from '../../runtime/tensor.js';
import { ensure, schedule, colorFor } from '../../runtime/opkit.js';

const G = 'CV-18';
const M = 'rtmo-s';

export const KP_NOMES = ['nariz', 'olho esq.', 'olho dir.', 'orelha esq.', 'orelha dir.', 'ombro esq.', 'ombro dir.',
  'cotovelo esq.', 'cotovelo dir.', 'punho esq.', 'punho dir.', 'quadril esq.', 'quadril dir.',
  'joelho esq.', 'joelho dir.', 'tornozelo esq.', 'tornozelo dir.'];
// esqueleto COCO (pares de índices)
export const KP_LIGACOES = [[15, 13], [13, 11], [16, 14], [14, 12], [11, 12], [5, 11], [6, 12], [5, 6], [5, 7],
  [6, 8], [7, 9], [8, 10], [1, 2], [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6]];

export const poseRtmo = {
  op: 'pose.rtmo',
  label: 'Pose multi-pessoa (RTMO)',
  group: G, model: M, overlayOnly: true,
  desc: 'Todas as pessoas da cena num único passe, cada uma com caixa e 17 pontos (COCO). ' +
        'Sem detector separado. Publica as caixas das pessoas para os operadores seguintes ' +
        '(Re-ID, tracking, SAM).',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mín. da pessoa' },
    kpConf: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.3, label: 'Score mín. do ponto' },
    maxPessoas: { type: 'int', min: 1, max: 50, step: 1, default: 20, label: 'Máx. pessoas' },
    caixa: { type: 'bool', default: true, label: 'Mostrar caixa' },
    corPorPessoa: { type: 'bool', default: true, label: 'Uma cor por pessoa' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure(M, state, ctx)) return clone(src);
    const spec = MODELS[M];
    const S = spec.input[2];
    schedule(state, p.everyMs,
      () => { const lb = letterbox(src, S, S, 114); return { data: toTensorData(lb.data, spec), lb, w: src.width, h: src.height }; },
      async ({ data, lb, w, h }) => {
        const out = await run(M, await makeTensor(data, spec.input));
        const dets = out.dets, kps = out.keypoints;
        const N = dets.dims[1], K = kps.dims[2];
        // px do input -> 0..1 do frame
        const fx = (v) => (v - lb.dx) / lb.scale / w, fy = (v) => (v - lb.dy) / lb.scale / h;
        const res = [];
        for (let i = 0; i < N; i++) {
          const o = i * 5, score = dets.data[o + 4];
          const pts = [];
          for (let k = 0; k < K; k++) {
            const q = (i * K + k) * 3;
            pts.push({ x: fx(kps.data[q]), y: fy(kps.data[q + 1]), v: kps.data[q + 2] });
          }
          res.push({ x1: fx(dets.data[o]), y1: fy(dets.data[o + 1]), x2: fx(dets.data[o + 2]), y2: fy(dets.data[o + 3]), score, pts });
        }
        return res.sort((a, b) => b.score - a.score);
      });

    if (state.inferMs) ctx.metrics['rtmo ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['rtmo erro'] = state.error;
    const pessoas = (state.results || []).filter((r) => r.score >= p.conf).slice(0, p.maxPessoas);
    const { w, h } = ctx;
    pessoas.forEach((r, i) => {
      const cor = p.corPorPessoa ? colorFor(i) : '#22d3ee';
      if (p.caixa) {
        ctx.overlay.push({ type: 'rect', x: r.x1 * w, y: r.y1 * h, w: (r.x2 - r.x1) * w, h: (r.y2 - r.y1) * h,
                           color: cor, label: `pessoa ${(r.score * 100) | 0}%` });
      }
      for (const [a, b] of KP_LIGACOES) {
        const p1 = r.pts[a], p2 = r.pts[b];
        if (p1.v < p.kpConf || p2.v < p.kpConf) continue;
        ctx.overlay.push({ type: 'line', x1: p1.x * w, y1: p1.y * h, x2: p2.x * w, y2: p2.y * h, color: cor, width: 2 });
      }
      for (const pt of r.pts) if (pt.v >= p.kpConf) ctx.overlay.push({ type: 'point', x: pt.x * w, y: pt.y * h, r: 3, color: '#FFD84D' });
    });
    ctx.poses = pessoas.map((r) => ({ box: { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 }, score: r.score,
      keypoints: r.pts.map((pt, k) => ({ nome: KP_NOMES[k], x: pt.x, y: pt.y, score: pt.v })) }));
    ctx.detections = pessoas.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, score: r.score, name: 'pessoa', keypoints: r.pts }));
    ctx.metrics['pessoas'] = pessoas.length;
    ctx.metrics['pontos visíveis'] = pessoas.reduce((a, r) => a + r.pts.filter((pt) => pt.v >= p.kpConf).length, 0);
    return clone(src);
  },
};

export default [poseRtmo];
