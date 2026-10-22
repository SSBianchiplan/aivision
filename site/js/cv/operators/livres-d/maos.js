/**
 * cv/operators/livres-d/maos.js — CV-25 Mãos e gestos.
 *
 * MediaPipe Hands do OpenCV Zoo (Apache-2.0, ~8 MB nos dois estágios): palma no
 * quadro inteiro, 21 pontos por mão num recorte girado (runtime/livres-d/hands.js),
 * gesto por regras sobre os pontos (runtime/livres-d/gestos.js).
 *
 * LADO DA MÃO E ESPELHO. O modelo diz "direita" para a mão direita da pessoa
 * numa imagem NÃO espelhada (conferido em fotos). A câmera frontal do app é
 * espelhada por padrão, o que troca os lados — o parâmetro "Imagem espelhada"
 * em "automático" segue o Espelhar da Fonte (ctx.mirrored do executor).
 *
 * Publica ctx.hands (coordenadas em 0..1 do quadro) e, se pedido, as caixas
 * das mãos em ctx.detections, para o tracking e as relações usarem.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { detectHands, PALM_ID, HAND_ID } from '../../runtime/livres-d/hands.js';
import { classifyGesture, HAND_CONNECTIONS } from '../../runtime/livres-d/gestos.js';

const G = 'CV-25';
const COR = { direita: '#22d3ee', esquerda: '#f472b6' };
const PONTAS = [4, 8, 12, 16, 20];

/** Cópia do frame: o buffer original volta ao pool antes da inferência terminar. */
function copyOf(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

export const maos = {
  op: 'maos.gestos',
  label: 'Mãos e gestos',
  group: G,
  model: HAND_ID,
  needs: [PALM_ID],
  overlayOnly: true,
  desc: 'MediaPipe Hands (Apache-2.0): acha a palma, estima 21 pontos por mão e diz o lado ' +
        '(direita/esquerda) e o gesto — mão aberta, punho, polegar para cima/baixo, apontando, ' +
        'V, OK, chifres ou a contagem de dedos levantados. Publica ctx.hands.',
  params: {
    conf: { type: 'float', min: 0.2, max: 0.95, step: 0.05, default: 0.5, label: 'Confiança da palma' },
    minHand: { type: 'float', min: 0.2, max: 0.99, step: 0.05, default: 0.6, label: 'Confiança da mão' },
    max: { type: 'int', min: 1, max: 4, step: 1, default: 2, label: 'Máximo de mãos' },
    espelhado: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (selfie)' },
    desenho: { type: 'enum', options: ['esqueleto', 'pontos', 'só caixa'], default: 'esqueleto', label: 'Desenhar' },
    gestos: { type: 'bool', default: true, label: 'Reconhecer gestos' },
    deteccoes: { type: 'bool', default: false, label: 'Publicar mãos como detecções' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure(PALM_ID, state, ctx)) return clone(src);
    if (!ensure(HAND_ID, state, ctx)) return clone(src);

    schedule(state, p.everyMs,
      () => ({ img: copyOf(src) }),
      async ({ img }) => {
        const W = img.width, H = img.height;
        const hs = await detectHands(img, { conf: p.conf, minHand: p.minHand, max: p.max });
        return hs.map((h) => {
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          for (const q of h.pts) {
            if (q.x < x1) x1 = q.x; if (q.x > x2) x2 = q.x;
            if (q.y < y1) y1 = q.y; if (q.y > y2) y2 = q.y;
          }
          return {
            pts: h.pts.map((q) => ({ x: q.x / W, y: q.y / H, z: q.z / W })),
            box: { x1: Math.max(0, x1 / W), y1: Math.max(0, y1 / H), x2: Math.min(1, x2 / W), y2: Math.min(1, y2 / H) },
            direita: h.direita, score: h.conf, gesto: classifyGesture(h.pts),
          };
        });
      });

    const res = state.results || [];
    const hands = res.map((h) => {
      // automático = segue o "Espelhar" da Fonte (ctx.mirrored); true/false antigos continuam valendo
      const esp = p.espelhado === 'automático' ? Boolean(ctx.mirrored) : p.espelhado === 'sim' || p.espelhado === true;
      const dir = esp ? h.direita < 0.5 : h.direita >= 0.5;
      return {
        lado: dir ? 'direita' : 'esquerda',
        gesto: p.gestos ? h.gesto.nome : null,
        dedos: h.gesto.dedos,
        score: h.score, pts: h.pts, box: h.box,
      };
    });
    ctx.hands = hands;
    if (p.deteccoes && hands.length) {
      const dets = hands.map((h) => ({ ...h.box, score: h.score, name: 'mão ' + h.lado }));
      ctx.detections = (Array.isArray(ctx.detections) ? ctx.detections : []).concat(dets);
    }

    const W = ctx.w, H = ctx.h;
    for (const h of hands) {
      const cor = COR[h.lado];
      const P = h.pts.map((q) => ({ x: q.x * W, y: q.y * H }));
      const label = 'mão ' + h.lado + (h.gesto ? ' · ' + h.gesto : '');
      ctx.overlay.push({
        type: 'rect',
        x: h.box.x1 * W, y: h.box.y1 * H, w: (h.box.x2 - h.box.x1) * W, h: (h.box.y2 - h.box.y1) * H,
        color: cor, label,
      });
      if (p.desenho === 'só caixa') continue;
      if (p.desenho === 'esqueleto') {
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.overlay.push({ type: 'line', x1: P[a].x, y1: P[a].y, x2: P[b].x, y2: P[b].y, color: cor, width: 2 });
        }
      }
      P.forEach((q, i) => ctx.overlay.push({
        type: 'point', x: q.x, y: q.y,
        r: PONTAS.includes(i) ? 3.5 : 2.5,
        color: PONTAS.includes(i) && h.gesto !== null ? '#FFD84D' : '#f5f5f4',
      }));
    }

    ctx.metrics['mãos'] = hands.length;
    if (hands.length) {
      ctx.metrics['gestos'] = hands.map((h) => `${h.lado}: ${h.gesto || h.dedos + ' dedos'}`).join(' · ');
      ctx.metrics['dedos levantados'] = hands.reduce((s, h) => s + h.dedos, 0);
    }
    if (state.inferMs) ctx.metrics['mãos ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['mãos erro'] = state.error;
    return clone(src);
  },
};

export default [maos];
