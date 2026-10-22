/**
 * operators/livres-h/corrida.js — CV-32 Corrida (marcha).
 *
 * Câmera de lado (esteira ou pista) ou de trás/frente.
 *
 * UMA pessoa (completo): pose BlazePose seguida pelos próprios pontos
 * (runtime/livres-h/pose.js), com a checagem de coerência — pose de duas
 * pessoas fundidas não entra e força re-detecção, que prefere quem já era
 * seguido (ou o corredor escolhido no painel) em vez do maior.
 *
 * VÁRIAS pessoas: RTMO (todas, 17 pontos) ou BlazePose por recorte (as N
 * maiores, 33 pontos) — runtime/livres-h/multi-pose.js —, uma sessão por ID
 * (runtime/livres-h/multi.js). Com a Pose multi-pessoa (RTMO) antes na
 * cadeia, usa o ctx.poses dela em vez de rodar o modelo de novo; IDs de um
 * Re-ID/tracking da cadeia têm preferência.
 *
 * Nos dois modos, o movimento da câmera (panorâmica de transmissão) é
 * medido pelo fundo a cada quadro (runtime/livres-h/camera.js): a oscilação
 * vertical deixa de ser medida e o painel avisa.
 *
 * A matemática dos passos está em runtime/livres-h/corrida.js; a sessão no
 * canal, que o painel Corrida lê.
 */
import { clone } from '../../core.js';
import { ensure, schedule, colorFor } from '../../runtime/opkit.js';
import { RastreadorPose, resolverEspelho, assinaturaQuadro, caixaPose } from '../../runtime/livres-h/pose.js';
import { resumoCorrida, alertasCorrida } from '../../runtime/livres-h/corrida.js';
import { canalCorrida } from '../../runtime/livres-h/canal.js';
import { num, LM, basePe } from '../../runtime/livres-h/comum.js';
import { MotorMulti, FONTES_MULTI } from '../../runtime/livres-h/multi-pose.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import { cocoParaBlaze } from '../../runtime/livres-h/multi.js';
import { perfisFundo, MonitorCamera } from '../../runtime/livres-h/camera.js';
import { COR, esqueleto, linhaChao, bannerista, rotulo } from './comum.js';

export const OPCOES_VISTA = { 'lateral': 'lateral', 'trás/frente': 'posterior' };
export const OPCOES_PESSOAS = ['uma (completo)', 'várias'];

export function cfgCorrida(p) {
  return {
    vista: OPCOES_VISTA[p.vista] || 'lateral', alturaCm: p.alturaCm || 0, velocidadeKmh: p.velocidadeKmh || 0, lenta: p.lenta || 1,
    multi: p.pessoas === 'várias', fonteMulti: FONTES_MULTI[p.fonteMulti] || 'rtmo',
  };
}

/** Joelho no contato para o overlay: só o plausível; o resto vira "?" (pose duvidosa). */
const textoJoelho = (p) => (p.joelhoContato != null ? `contato ${Math.round(p.joelhoContato)}°` : p.joelhoDuvidoso ? 'contato ?°' : null);

export const marcha = {
  op: 'corrida.marcha',
  label: 'Corrida — análise da marcha',
  group: 'CV-32',
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Corrida vista de lado (esteira ou pista): cadência, tempo de contato e de voo, fases de apoio e ' +
        'balanço, oscilação vertical, joelho no contato e flexão máxima, tornozelo, padrão de pisada ' +
        '(retropé/médio-pé/antepé), overstriding, inclinação do tronco e simetria esquerda/direita. ' +
        'De trás ou de frente: queda da pelve e cruzamento. Uma pessoa (BlazePose, completo) ou várias ' +
        '(RTMO ou BlazePose por recorte, um ID e uma sessão por corredor). Avisa quando a câmera se move. Painel Corrida.',
  params: {
    vista: { type: 'enum', options: Object.keys(OPCOES_VISTA), default: 'lateral', label: 'Vista da câmera' },
    pessoas: { type: 'enum', options: OPCOES_PESSOAS, default: 'uma (completo)', label: 'Pessoas' },
    maxPessoas: { type: 'int', min: 1, max: 20, step: 1, default: 6, label: 'Várias: até N corredores' },
    fonteMulti: { type: 'enum', options: Object.keys(FONTES_MULTI), default: 'RTMO (todas)', label: 'Várias: pose (RTMO 17 pontos | BlazePose por recorte, 33)' },
    alturaCm: { type: 'int', min: 0, max: 230, step: 1, default: 0, label: 'Altura do corredor (cm, 0 = sem escala)' },
    velocidadeKmh: { type: 'float', min: 0, max: 30, step: 0.1, default: 0, label: 'Velocidade da esteira (km/h, opcional)' },
    lenta: { type: 'int', min: 1, max: 16, step: 1, default: 1, label: 'Câmera lenta (fator)' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.3, label: 'Visibilidade mín.' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 6000, label: 'Re-detectar corredor (ms)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    const canal = canalCorrida;
    const esp = resolverEspelho(p.espelhada, ctx);
    const cfg = cfgCorrida(p);
    const assinatura = `${p.vista}|${esp}|${p.pessoas}|${p.fonteMulti}`;
    if (state.assinatura && state.assinatura !== assinatura) {
      canal.zerar();
      if (state.rast) state.rast.zerar();
      if (state.motor) state.motor.zerar();
      state.results = null;
    }
    state.assinatura = assinatura;

    // ---- câmera: deslocamento do fundo a cada quadro (barato), fora das pessoas
    if (!state.cam) state.cam = new MonitorCamera();
    const caixasPessoas = (state.results && state.results.pessoas ? state.results.pessoas.map((x) => x.caixa)
      : state.results && state.results.P ? [caixaPose(state.results.P)] : []).filter(Boolean);
    state.camUlt = state.cam.adicionar(performance.now(), perfisFundo(src, caixasPessoas));

    return cfg.multi ? aplicarVarias(src, p, state, ctx, cfg, esp) : aplicarUma(src, p, state, ctx, cfg, esp);
  },
};

// ======================================================================= uma pessoa

function aplicarUma(src, p, state, ctx, cfg, esp) {
  if (!ensure('yolox', state, ctx)) return clone(src);
  if (!ensure('pose', state, ctx)) return clone(src);
  const canal = canalCorrida, sessao = canal.sessao;
  if (!state.rast) state.rast = new RastreadorPose();
  // corredor escolhido no painel (no modo várias): preferido quando há gente sobreposta
  const a = canal.alvoCaixa && canal.selecionado != null ? canal.alvoCaixa : null;
  const alvo = a ? { x1: a.x1 * src.width, y1: a.y1 * src.height, x2: a.x2 * src.width, y2: a.y2 * src.height } : null;

  schedule(state, p.everyMs,
    () => {
      // quadro parado (YouTube pausado, tela/câmera congelada, histórico): não
      // re-infere — a pose tremia com a ROI realimentando a mesma imagem e o
      // retrato mudava sem o vídeo andar. Corredor parado não tem passada a medir.
      if (quadroRepetido(state, src, ctx, { imagem: true, forcar: convergindo(state.rast, state.results) })) return null;
      return { ...state.rast.preparar(src, performance.now(), { esp, detectarMs: p.detectarMs, coerencia: true, alvo }), ass: assinaturaQuadro(src) };
    },
    async (prep) => {
      const r = await state.rast.estimar(prep);
      if (r.sem) {
        canal.publicar({ t: prep.t, sem: true, cfg, r: null, res: null, alertas: [] });
        return { sem: true };
      }
      if (r.aquecendo) return { P: r.P, w: prep.w, h: prep.h, aquecendo: true };
      // quadro repetido (pausa/congelado) não é amostra nova; pose incoerente (dois atletas fundidos) também não
      const novo = prep.ass !== state.assAnt; state.assAnt = prep.ass;
      if (novo && !r.incoerente && canal.gravando() && canal.origem.tipo === 'ao vivo') {
        sessao.adicionar(prep.t / (cfg.lenta || 1), r.P, p.minVis, { cam: state.camUlt });
      }
      const agora = performance.now();
      if (!state.tAnal || agora - state.tAnal > 400) {
        state.an = sessao.analisar(cfg); state.res = resumoCorrida(state.an, cfg); state.tAnal = agora;
      }
      canal.publicar({
        t: prep.t, cfg, r: state.an, res: state.res, P: r.P, w: prep.w, h: prep.h, esp, cam: state.camUlt,
        incoerente: Boolean(r.incoerente), motivo: r.motivo,
        alertas: alertasCorrida(state.an, state.res, cfg), inferMs: performance.now() - prep.t,
      });
      return { P: r.P, w: prep.w, h: prep.h, an: state.an, res: state.res, incoerente: Boolean(r.incoerente), motivo: r.motivo };
    });

  if (state.inferMs) ctx.metrics['corrida ms'] = state.inferMs.toFixed(0);
  if (state.error) ctx.metrics['corrida erro'] = state.error;
  const r = state.results;
  const ban = bannerista(ctx.overlay, ctx);
  if (!r || r.sem) {
    ctx.metrics['corrida'] = 'procurando o corredor';
    ban('Corrida: procurando o corredor…', COR.aviso);
    return clone(src);
  }
  const sx = ctx.w / r.w, sy = ctx.h / r.h;
  if (r.incoerente) {
    // esqueleto cinza: não é uma pessoa só (fundiu com o vizinho) — não entra na sessão
    esqueletoCinza(ctx.overlay, r.P, sx, sy, p.minVis);
    ban(`Corrida: pose duvidosa (${r.motivo}) — re-detectando o corredor`, COR.aviso);
    return clone(src);
  }
  esqueleto(ctx.overlay, r.P, sx, sy, p.minVis);
  if (r.aquecendo) { ban('Corrida: ajustando a pose…', COR.aviso); return clone(src); }
  const an = r.an, res = r.res;
  if (an && res) {
    if (!an.camMovel) linhaChao(ctx.overlay, r.P, an.chaoAtual, sx, sy);
    // pé em apoio agora: o mais baixo, marcado no chão
    if (an.contatoAgora) {
      const be = basePe(r.P, 'e', p.minVis), bd = basePe(r.P, 'd', p.minVis);
      const b = be && bd ? (be.y >= bd.y ? { ...be, l: 'e' } : { ...bd, l: 'd' }) : be ? { ...be, l: 'e' } : bd ? { ...bd, l: 'd' } : null;
      if (b) ctx.overlay.push({ type: 'point', x: b.x * sx, y: b.y * sy, r: 7, color: COR.ok });
    }
    const ult = an.passos[an.passos.length - 1];
    ban(`Corrida · ${cfg.vista === 'lateral' ? 'lateral' : 'trás/frente'}${an.dt ? ` · ${Math.round(1000 / an.dt)} Hz` : ''}`, '#22d3ee');
    ban(`Cadência ${res.cadencia ? Math.round(res.cadencia) : '—'} passos/min · ${res.passos} passos`, res.cadencia ? COR.ok : COR.neutro);
    if (res.tc.n) ban(`Contato ${Math.round(res.tc.media)} ms · voo ${res.tf.n ? Math.round(res.tf.media) : '—'} ms · apoio ${res.apoioPct != null ? Math.round(res.apoioPct) + '%' : '—'}`, '#e5e7eb');
    if (ult && cfg.vista === 'lateral') {
      const j = LM.joelho[ult.l === 'e' ? 'e' : 'd'];
      const pj = r.P[j], txt = textoJoelho(ult);
      if (pj && pj.v >= p.minVis && txt) rotulo(ctx.overlay, pj.x * sx + 8, pj.y * sy, txt, ult.joelhoContato != null ? (ult.l === 'e' ? COR.e : COR.d) : COR.neutro);
      if (ult.pisada) ban(`Último passo (${an.ladosOk ? ult.lado : ult.lado === 'E' ? 'A' : 'B'}): ${ult.pisada}${ult.overstriding ? ' · overstriding' : ''}`, ult.overstriding ? COR.alerta : COR.neutro);
    }
    bannerCamera(ban, state.camUlt);
    const at = alertasCorrida(an, res, cfg).filter((x) => x.nivel === 'atencao' && !/Câmera/.test(x.texto));
    if (at.length) ban('⚠ ' + at.slice(0, 2).map((a) => a.curto).join(' · '), COR.alerta);
    ctx.metrics['cadência'] = res.cadencia ? Math.round(res.cadencia) + ' ppm' : '—';
    ctx.metrics['contato'] = res.tc.n ? Math.round(res.tc.media) + ' ms' : '—';
    ctx.metrics['passos'] = res.passos;
    if (res.osc.n) ctx.metrics['oscilação'] = num(res.osc.media, 1) + ' cm';
  }
  ctx.metrics['corrida'] = `${p.vista}${esp ? ' · espelhada' : ''}`;
  return clone(src);
}

const esqueletoCinza = (ov, P, sx, sy, minVis) => esqueleto(ov, P, sx, sy, minVis, null, COR.neutro);

function bannerCamera(ban, cam) {
  if (cam && cam.movendo) ban(`Câmera em movimento (${Math.round(Math.hypot(cam.vx, cam.vy))} px/s): oscilação suspensa`, COR.aviso);
}

// ======================================================================= várias pessoas

function aplicarVarias(src, p, state, ctx, cfg, esp) {
  const canal = canalCorrida, grupo = canal.grupo;
  if (!state.motor) state.motor = new MotorMulti();
  state.motor.configurar({ fonte: cfg.fonteMulti, maxPessoas: p.maxPessoas });
  if (canal.zerarMotor) { state.motor.zerar(); canal.zerarMotor = false; state.results = null; }
  // poses da cadeia (Pose multi-pessoa antes): não roda o RTMO de novo
  const daCadeia = cfg.fonteMulti === 'rtmo' && Array.isArray(ctx.poses) && ctx.poses.length > 0;
  if (!daCadeia) for (const m of state.motor.modelos()) if (!ensure(m, state, ctx)) return clone(src);
  const W = src.width, H = src.height;
  const externas = Array.isArray(ctx.detections)
    ? ctx.detections.filter((d) => d && d.id != null && d.x2 != null).map((d) => {
      const norm = d.x2 <= 1.5 && d.y2 <= 1.5;          // caixas 0..1 (RTMO, Re-ID) ou px
      return { id: d.id, caixa: norm ? { x1: d.x1 * W, y1: d.y1 * H, x2: d.x2 * W, y2: d.y2 * H } : { x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 } };
    }) : null;
  const alvoId = canal.soSelecionado && canal.selecionado != null ? canal.selecionado : null;
  const gravar = canal.gravando() && canal.origem.tipo === 'ao vivo';
  const registrar = (pessoas, t, ass) => {
    const novo = ass !== state.assAnt; state.assAnt = ass;
    if (!novo || !gravar) return;
    for (const pe of pessoas) {
      if (pe.incoerente || pe.aquecendo) continue;
      grupo.adicionar(pe.id, t / (cfg.lenta || 1), pe.P, p.minVis, { pontos: pe.pontos, caixa: pe.caixa, cam: state.camUlt, quadro: { w: W, h: H } });
    }
  };

  if (daCadeia) {
    // a cadeia já deu as pessoas deste quadro: IDs pelo rastreio daqui (ou da cadeia), instante = agora
    const t = performance.now();
    const sig = ctx.poses.map((q) => (q.box ? q.box.x1.toFixed(4) : '')).join('|');
    if (sig !== state.sigCadeia) {
      state.sigCadeia = sig;
      const caixas = ctx.poses.map((q) => ({ x1: q.box.x1 * W, y1: q.box.y1 * H, x2: q.box.x2 * W, y2: q.box.y2 * H }));
      const ids = state.motor._ids(caixas, t, externas);
      let pessoas = ctx.poses.map((q, i) => ({
        id: ids[i], caixa: caixas[i], pontos: 17,
        P: cocoParaBlaze(q.keypoints.map((k) => ({ x: k.x, y: k.y, score: k.score })), W, H, { espelhar: esp }),
      }));
      if (alvoId != null) pessoas = pessoas.filter((x) => x.id === alvoId);
      pessoas = pessoas.slice(0, p.maxPessoas);
      registrar(pessoas, t, sig);
      state.results = { pessoas, w: W, h: H, fonte: 'cadeia' };
    }
  } else {
    schedule(state, p.everyMs,
      () => {
        if (quadroRepetido(state, src, ctx, { imagem: true })) return null;     // quadro parado: ver aplicarUma
        return { ...state.motor.preparar(src, performance.now(), { esp, alvoId, externas }), ass: assinaturaQuadro(src) };
      },
      async (prep) => {
        const pessoas = await state.motor.estimar(prep);
        registrar(pessoas, prep.t, prep.ass);
        return { pessoas, w: prep.w, h: prep.h, fonte: cfg.fonteMulti };
      });
  }

  // resumo por corredor, no máximo ~2×/s (cada análise percorre a série toda)
  const agora = performance.now();
  if (!state.tAnalMulti || agora - state.tAnalMulti > 500) {
    state.tAnalMulti = agora;
    state.resumos = new Map(grupo.resumos(cfg).map((l) => [l.id, l]));
    canal.publicar({ t: agora, cfg, multi: true, cam: state.camUlt, n: state.resumos.size, ids: [...state.resumos.keys()] });
  }

  if (state.inferMs) ctx.metrics['corrida ms'] = state.inferMs.toFixed(0);
  if (state.error) ctx.metrics['corrida erro'] = state.error;
  const r = state.results;
  const ban = bannerista(ctx.overlay, ctx);
  const nomeFonte = daCadeia ? 'RTMO da cadeia' : cfg.fonteMulti === 'rtmo' ? 'RTMO' : 'BlazePose por recorte';
  if (!r || !r.pessoas) {
    ban(`Corrida · várias (${nomeFonte}): procurando corredores…`, COR.aviso);
    ctx.metrics['corrida'] = 'várias · procurando';
    return clone(src);
  }
  const sx = ctx.w / r.w, sy = ctx.h / r.h;
  for (const pe of r.pessoas) {
    const sel = canal.selecionado != null && pe.id === canal.selecionado;
    const linha = state.resumos && state.resumos.get(pe.id);
    if (pe.incoerente) esqueletoCinza(ctx.overlay, pe.P, sx, sy, p.minVis);
    else esqueleto(ctx.overlay, pe.P, sx, sy, p.minVis);
    const b = pe.caixa;
    if (b) {
      const cor = pe.incoerente ? COR.neutro : sel ? COR.aviso : colorFor(typeof pe.id === 'number' ? pe.id : String(pe.id).length);
      const cad = linha && linha.res.cadencia ? `${Math.round(linha.res.cadencia)} ppm` : '— ppm';
      ctx.overlay.push({ type: 'rect', x: b.x1 * sx, y: b.y1 * sy, w: (b.x2 - b.x1) * sx, h: (b.y2 - b.y1) * sy, color: cor,
        label: pe.incoerente ? `#${pe.id} · pose duvidosa` : `#${pe.id} · ${cad}`, width: sel ? 3 : 1.5 });
    }
  }
  const n = state.resumos ? state.resumos.size : 0;
  ban(`Corrida · várias (${nomeFonte}) · ${r.pessoas.length} no quadro · ${n} com dados${alvoId != null ? ` · só #${alvoId}` : ''}`, '#22d3ee');
  const sel = canal.selecionado != null && state.resumos ? state.resumos.get(canal.selecionado) : null;
  if (sel) {
    const res = sel.res;
    ban(`#${sel.id}: cadência ${res.cadencia ? Math.round(res.cadencia) : '—'} · contato ${res.tc.n ? Math.round(res.tc.media) : '—'} ms · apoio ${res.apoioPct != null ? Math.round(res.apoioPct) + '%' : '—'}`, COR.ok);
  }
  bannerCamera(ban, state.camUlt);
  ctx.metrics['corredores'] = n;
  ctx.metrics['corrida'] = `várias · ${nomeFonte}${esp ? ' · espelhada' : ''}`;
  return clone(src);
}

export default [marcha];
