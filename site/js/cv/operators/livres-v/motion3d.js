/**
 * operators/livres-v/motion3d.js — motion3d.captura (CV-88 Motion 3D Studio).
 *
 * Captura de movimento ao vivo de UMA fonte do iaVision (câmera, arquivo, tela, YouTube):
 * YOLOX acha a pessoa, BlazePose segue o recorte e devolve os 33 pontos 2D e os 33 pontos 3D
 * "do mundo" (runtime/livres-v/pose3d.js — o mesmo modelo, nenhuma inferência a mais). Cada
 * pose vai para o canal (runtime/livres-v/canal.js), que suaviza com o One Euro do
 * GPlanSiS|ROBO, mede taxa e latência e grava a tomada que o Studio pede. As mãos da cadeia
 * (maos.gestos antes deste nó) vão junto, para o Studio desenhar os dedos.
 *
 * Fora do Studio o nó desenha o esqueleto verde-água sobre o vídeo; com o Studio aberto quem
 * desenha é o Studio. Processamento NO APARELHO: nenhum quadro sai do navegador. Ângulos e 3D
 * monocular são estimativas educacionais — não é laudo.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { resolverEspelho } from '../../runtime/livres-h/pose.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import { tempoDaFonte } from '../../runtime/livres-m/canal.js';
import { RastreadorMotion } from '../../runtime/livres-v/pose3d.js';
import { canalMotion } from '../../runtime/livres-v/canal.js';
import { bannerista } from '../livres-h/comum.js';

const G = 'CV-88';
export const COR_MOCAP = '#2EF2D0';   // verde-água do Studio (acento do tema escuro)

/** Ligações do esqueleto desenhado (MediaPipe 33). */
export const LIGACOES = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [15, 19], [15, 17], [17, 19], [12, 14], [14, 16], [16, 20], [16, 18], [18, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 2], [0, 5], [2, 7], [5, 8], [9, 10],
];

export const motion3dCaptura = {
  op: 'motion3d.captura',
  label: 'Motion 3D — captura (Live Link)',
  group: G,
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Captura de movimento 3D ao vivo de uma câmera ou vídeo: BlazePose com os 33 pontos 3D do mundo, suavização ' +
        'One Euro (GPlanSiS|ROBO), taxa e latência, gravação de tomadas para o Motion 3D Studio (esqueleto 2D e 3D, ' +
        'retarget, BVH/GLB/JSON/CSV). Tudo no aparelho. 3D de uma câmera é estimado (escala e profundidade aproximadas).',
  params: {
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.4, label: 'Visibilidade mín.' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 4000, label: 'Re-detectar pessoa (ms)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms) — Update Rate' },
    suavizar: { type: 'bool', default: true, label: 'Suavizar (One Euro)' },
    minCorte: { type: 'float', min: 0.1, max: 10, step: 0.1, default: 1.2, label: 'One Euro: corte mín. (Hz)' },
    beta: { type: 'float', min: 0, max: 5, step: 0.05, default: 0.4, label: 'One Euro: beta' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar esqueleto (fora do Studio)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const esp = resolverEspelho(p.espelhada, ctx);
    if (!state.rast) state.rast = new RastreadorMotion();
    if (state.esp !== esp) { state.rast.zerar(); state.esp = esp; }
    const f = canalMotion.filtro();
    if (f.ligado !== p.suavizar || f.minCorte !== p.minCorte || f.beta !== p.beta) canalMotion.configurarFiltro({ ligado: p.suavizar, minCorte: p.minCorte, beta: p.beta });
    state.maos = Array.isArray(ctx.hands) ? ctx.hands : null;

    schedule(state, p.everyMs,
      () => {
        if (quadroRepetido(state, src, ctx, { forcar: convergindo(state.rast, state.results) })) return null;
        const fv = tempoDaFonte();
        if (fv.video && fv.pausado && !ctx.fonteParada) return null;
        const t = fv.video ? fv.t * 1000 : performance.now();
        if (fv.video && state.tUlt != null && t === state.tUlt) return null;   // mesmo quadro do vídeo
        state.tUlt = t;
        const prep = state.rast.preparar(src, performance.now(), { esp, detectarMs: p.detectarMs });
        return { ...prep, tFonte: t, t0: performance.now(), maos: state.maos, img: canalMotion.precisaQuadro() ? clone(src) : null };
      },
      async (prep) => {
        const r = await state.rast.estimar(prep);
        const latMs = performance.now() - prep.t0;
        if (r.sem) {
          canalMotion.publicar({ t: prep.tFonte, P: null, W: null, w: prep.w, h: prep.h, latMs, img: prep.img, maos: prep.maos, esp });
          return { sem: true };
        }
        canalMotion.publicar({ t: prep.tFonte, P: r.P, W: r.W, w: prep.w, h: prep.h, vis: r.vis, latMs, img: prep.img, maos: prep.maos, esp, aquecendo: Boolean(r.aquecendo) });
        return { P: r.P, W: r.W, w: prep.w, h: prep.h };
      });

    if (state.inferMs) ctx.metrics['motion3d ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['motion3d erro'] = state.error;
    const R = state.results;
    const desenhar = p.desenhar && !canalMotion.studioAberto();
    const ban = bannerista(ctx.overlay, ctx);
    if (!R || R.sem) {
      ctx.metrics['motion3d'] = 'procurando a pessoa';
      if (desenhar) ban('Motion 3D: procurando a pessoa (corpo inteiro no quadro)…', '#FFD84D');
      return clone(src);
    }
    ctx.metrics['motion3d'] = R.W ? '3D ok' : '2D (sem 3D)';
    const st = canalMotion.estatisticas();
    if (st.gravando) ctx.metrics['motion3d ● REC'] = `${st.gravadas} poses`;
    if (!desenhar) return clone(src);
    const sx = ctx.w / R.w, sy = ctx.h / R.h;
    for (const [a, b] of LIGACOES) {
      const A = R.P[a], B = R.P[b];
      if (!A || !B || A.v < p.minVis || B.v < p.minVis) continue;
      ctx.overlay.push({ type: 'line', x1: A.x * sx, y1: A.y * sy, x2: B.x * sx, y2: B.y * sy, color: COR_MOCAP, width: 3 });
    }
    for (let i = 0; i < 33; i++) {
      const A = R.P[i];
      if (A && A.v >= p.minVis) ctx.overlay.push({ type: 'point', x: A.x * sx, y: A.y * sy, r: 3, color: '#E8FFFB' });
    }
    if (st.gravando) ban(`● REC Motion 3D · ${st.gravadas} poses`, '#f87171');
    return clone(src);
  },
};

export default [motion3dCaptura];
