/**
 * operators/livres-t/comum.js — o que os operadores da onda 2-c (CV-70..77)
 * repetem: o instante da amostra (tempo do VÍDEO num arquivo, relógio ao
 * vivo), a pose de UMA pessoa e o desenho básico.
 *
 * Pose: se a cadeia já tem pose multi-pessoa (RTMO/YOLO26-pose publica
 * ctx.poses), usa a maior pessoa dela (17 pontos convertidos para os índices
 * BlazePose; sem calcanhar/ponta do pé). Senão roda o MESMO caminho do Salto,
 * da Corrida e do Fisio (runtime/livres-h/pose.js: YOLOX acha a pessoa,
 * BlazePose 33 pontos seguido pelos auxiliares). Nenhum modelo novo.
 */
import { ensure, schedule } from '../../runtime/opkit.js';
import { RastreadorPose, resolverEspelho } from '../../runtime/livres-h/pose.js';
import { cocoParaBlaze } from '../../runtime/livres-h/multi.js';
import { tempoDaFonte } from '../../runtime/livres-m/canal.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import { esqueleto, bannerista, COR } from '../livres-h/comum.js';
import { store } from '../../../state/store.js';

export { esqueleto, bannerista, COR };
export const AVISO_CURTO = 'Não é dispositivo médico · sem diagnóstico';

/** Instante da amostra (ms): o do vídeo (arquivo), senão o relógio. null = vídeo pausado (não amostra). */
export function instante(ctx) {
  const fv = tempoDaFonte();
  if (fv.video) return fv.pausado && !ctx.fonteParada ? null : fv.t * 1000;
  return performance.now();
}

/** Parâmetros comuns da pose (para espalhar nos params de cada operador). */
export const PARAMS_POSE = {
  espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
  minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.4, label: 'Visibilidade mín.' },
  detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 4000, label: 'Re-detectar pessoa (ms)' },
};

/**
 * Pose de uma pessoa neste quadro. Devolve { P (33, px), w, h, t, novo, fonte }
 * ou { espera: 'motivo' }. `novo` = amostra que ainda não foi entregue ao operador.
 */
export function obterPose(src, p, state, ctx) {
  const w = src.width, h = src.height;
  const esp = resolverEspelho(p.espelhada, ctx);
  if (Array.isArray(ctx.poses) && ctx.poses.length) {
    const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
    const pe = ctx.poses.slice().sort((a, b) => area(b.box) - area(a.box))[0];
    const t = instante(ctx);
    if (t == null) return { espera: 'vídeo pausado' };
    const P = cocoParaBlaze(pe.keypoints, w, h, { espelhar: esp });
    const ass = pe.keypoints.reduce((s, q) => s + q.x * 7 + q.y * 13, 0);
    const novo = ass !== state.assRtmo && (state.tUlt == null || t > state.tUlt);
    state.assRtmo = ass;
    if (novo) state.tUlt = t;
    return { P, w, h, t: state.tUlt ?? t, novo, fonte: 'cadeia (17 pontos)' };
  }
  if (!ensure('yolox', state, ctx)) return { espera: 'carregando o detector' };
  if (!ensure('pose', state, ctx)) return { espera: 'carregando a pose' };
  if (!state.rast) state.rast = new RastreadorPose();
  if (state.esp !== esp) { state.rast.zerar(); state.esp = esp; }
  schedule(state, p.everyMs || 0,
    () => {
      if (quadroRepetido(state, src, ctx, { forcar: convergindo(state.rast, state.results) })) return null;
      const t = instante(ctx);
      if (t == null || (state.tPrep != null && t <= state.tPrep)) return null;
      state.tPrep = t;
      return { ...state.rast.preparar(src, performance.now(), { esp, detectarMs: p.detectarMs || 4000 }), tFonte: t };
    },
    async (prep) => {
      const r = await state.rast.estimar(prep);
      state.seq = (state.seq || 0) + 1;
      if (r.sem || r.aquecendo) return { sem: Boolean(r.sem), aquecendo: Boolean(r.aquecendo), seq: state.seq };
      return { P: r.P, w: prep.w, h: prep.h, t: prep.tFonte, seq: state.seq };
    });
  const R = state.results;
  if (state.error) ctx.metrics['pose erro'] = state.error;
  if (!R) return { espera: 'procurando a pessoa' };
  if (R.sem || !R.P) return { espera: R.aquecendo ? 'ajustando a pose' : 'procurando a pessoa (corpo inteiro no quadro)' };
  const novo = R.seq !== state.seqEntregue;
  state.seqEntregue = R.seq;
  return { P: R.P, w: R.w, h: R.h, t: R.t, novo, fonte: 'BlazePose (33 pontos)' };
}

/** Escala de P (px do quadro analisado) para o overlay. */
export const escala = (R, ctx) => ({ sx: ctx.w / R.w, sy: ctx.h / R.h });

/** Formatação pt-BR. */
export const num = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d).replace('.', ','));

/** Cópia do quadro (para o Studio, só quando aberto). */
export function copiaQuadro(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/** O operador `op` está ligado na cadeia? (para dizer "aguardando" em vez de "coloque antes"). */
export function naCadeia(op) { return (store.get().nodes || []).some((n) => n.op === op && n.enabled); }
/** Mensagem quando falta a saída de um operador anterior: ainda carregando, ou ausente. */
export function faltaAntes(op, nome) { return naCadeia(op) ? `aguardando "${nome}" (modelo carregando ou nada no quadro)` : `coloque "${nome}" (${op}) ANTES na cadeia`; }
