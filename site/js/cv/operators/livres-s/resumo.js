/**
 * cv/operators/livres-s/resumo.js — CV-66 Resumo de vídeo por eventos (100).
 *
 *   video.resumo  subtração de fundo → atividade por quadro → EVENTOS (início,
 *                 fim, pico, miniatura com a região do movimento BORRADA — LGPD).
 *                 No painel Medições: linha do tempo clicável (leva o vídeo ao
 *                 instante), lista e CSV, e "Abrir no GPlanSiS|Vídeo" com um
 *                 marcador no início de cada evento (fonte arquivo).
 *                 Opcional: só dentro das áreas "Resumo · área de interesse".
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao } from '../../runtime/livres-oa/canal.js';
import { FundoMedio, Segmentador, cobertura } from '../../runtime/livres-s/resumo.js';
import { mascaraZona } from '../../runtime/livres-s/cena-ref.js';
import { passoTempo } from '../../runtime/livres-s/comum.js';

export const G_RESUMO = 'CV-66';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
export const FUNCAO_RESUMO = 'resumo_area';

/** Miniatura (data URL) do quadro com a caixa do movimento BORRADA (quem se move pode ser gente). */
export function miniaturaBorrada(src, caixa, larg = 200, borrar = true) {
  try {
    if (typeof document === 'undefined') return null;
    const c0 = document.createElement('canvas'); c0.width = src.width; c0.height = src.height;
    c0.getContext('2d').putImageData(src, 0, 0);
    const k = larg / src.width, H = Math.round(src.height * k);
    const c = document.createElement('canvas'); c.width = larg; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(c0, 0, 0, larg, H);
    if (borrar && caixa) {
      const x = caixa.x1 * larg, y = caixa.y1 * H, w = (caixa.x2 - caixa.x1) * larg, h = (caixa.y2 - caixa.y1) * H;
      // pixelado grosso (1/12) + desfoque: forma e cor do movimento, sem rosto legível
      const p = document.createElement('canvas'); p.width = Math.max(1, Math.round(w / 12)); p.height = Math.max(1, Math.round(h / 12));
      p.getContext('2d').drawImage(c, x, y, w, h, 0, 0, p.width, p.height);
      g.save(); g.imageSmoothingEnabled = true; g.filter = 'blur(3px)'; g.drawImage(p, 0, 0, p.width, p.height, x, y, w, h); g.restore();
      g.strokeStyle = '#facc15'; g.lineWidth = 2; g.strokeRect(x, y, w, h);
    }
    return c.toDataURL('image/jpeg', 0.75);
  } catch (_) { return null; }
}

export const resumoVideo = {
  op: 'video.resumo',
  label: 'Resumo de vídeo por eventos',
  group: G_RESUMO, overlayOnly: true,
  desc: 'Subtração de fundo → atividade → linha do tempo de EVENTOS (movimento acima do limiar por um tempo mínimo), ' +
        'com miniatura (região do movimento borrada). No painel Medições: clique leva o vídeo ao instante; CSV; e ' +
        '"Abrir no GPlanSiS|Vídeo" com um marcador por evento. Opcional: áreas "Resumo · área de interesse".',
  params: {
    limiar: { type: 'float', min: 0.001, max: 0.5, step: 0.001, default: 0.01, label: 'Atividade mínima (fração da imagem)' },
    minS: { type: 'float', min: 0, max: 30, step: 0.1, default: 0.5, label: 'Duração mínima do evento (s)' },
    silencioS: { type: 'float', min: 0.2, max: 120, step: 0.1, default: 2, label: 'Fecha após quietude de (s)' },
    sensibilidade: { type: 'int', min: 5, max: 100, step: 1, default: 26, label: 'Diferença de brilho (níveis)' },
    aprendizado: { type: 'float', min: 0.002, max: 0.3, step: 0.002, default: 0.03, label: 'Aprendizado do fundo' },
    miniaturas: { type: 'bool', default: true, label: 'Guardar miniatura de cada evento' },
    borrar: { type: 'bool', default: true, label: 'Borrar a região do movimento na miniatura (LGPD)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar a região do movimento' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('resumo', state) || !state.fundo) { state.fundo = new FundoMedio(); state.seg = new Segmentador(); state.t0 = null; state.mascSig = ''; }
    const { t, relogio } = passoTempo(state, ctx, 5);
    const { w, h } = ctx;
    if (state.t0 == null) state.t0 = t;
    // áreas de interesse (opcional)
    const mq = ctx.marcacoes;
    const areas = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_RESUMO && AREAS.has(i.tipo)) : [];
    let masc = null;
    if (areas.length && state.fundo.w) {
      const sig = areas.map((a) => a.id + a.pts.flat().join(',')).join('|') + `@${state.fundo.w}x${state.fundo.h}`;
      if (sig !== state.mascSig) {
        state.mascSig = sig;
        state.masc = new Uint8Array(state.fundo.w * state.fundo.h);
        for (const a of areas) { const m = mascaraZona(a, state.fundo.w, state.fundo.h); for (let i = 0; i < m.length; i++) if (m[i]) state.masc[i] = 1; }
      }
      masc = state.masc;
    }
    let r = state.ult || { frac: 0, caixa: null };
    // quadro repetido (fonte parada, vídeo pausado ou laço mais rápido que o vídeo): não mede de novo
    if (!ctx.fonteParada && t !== state.tUlt) {
      r = state.fundo.quadro(src, { taxa: p.aprendizado, limiar: p.sensibilidade, mascara: masc });
      state.ult = r;
      const { abriu } = state.seg.passo(t, r.frac, r.caixa, { limiar: p.limiar, minS: p.minS, silencioS: p.silencioS });
      const ev = state.seg.aberto;
      if (p.miniaturas && ev && (abriu || ev.novoPico) && performance.now() - (state.tMini || 0) > 500) {
        ev.novoPico = false; state.tMini = performance.now();
        ev.thumb = miniaturaBorrada(src, r.caixa, 200, p.borrar) || ev.thumb;
      }
    }
    state.tUlt = t;
    const evs = state.seg.todos();
    const dur = Math.max(0, t - state.t0);
    const cob = cobertura(evs, dur);
    if (p.desenhar && r.caixa && r.frac >= p.limiar) {
      const c = r.caixa;
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: state.seg.aberto ? '#facc15' : '#94a3b8',
        label: state.seg.aberto ? `evento ${state.seg.aberto.id}` : 'movimento' });
    }
    ctx.metrics['eventos'] = `${evs.length} · ${Math.round(cob.frac * 100)} % do tempo`;
    ctx.metrics['atividade'] = `${(r.frac * 100).toFixed(1)} %`;
    publicar('resumo', {
      eventos: evs.map((e) => ({ id: e.id, t0: e.t0, t1: e.t1, pico: e.pico, tPico: e.tPico, caixa: e.caixa, thumb: e.thumb, aberto: e === state.seg.aberto })),
      serie: state.seg.serie.slice(-4000), t0: state.t0, t, relogio, cobertura: cob, limiar: p.limiar,
    });
    return clone(src);
  },
};

export default [resumoVideo];
