/**
 * operators/livres-t/vitais.js — CV-70 Sinais vitais sem contato (81, 82).
 *
 *   vitais.respiracao  frequência respiratória pela oscilação do tórax (ROI + FFT)
 *   vitais.cardiaca    frequência cardíaca rPPG pela pele do rosto (rosto.malha + POS/CHROM/verde)
 *
 * A amostra é tirada em TODO quadro (média de pixels, ~1 ms), não só quando
 * um modelo termina: a taxa de amostragem é a do vídeo. A estimativa sai com
 * a faixa de confiança e os avisos de condição (luz, movimento, taxa).
 * NÃO É DISPOSITIVO MÉDICO: sem faixa "normal", sem diagnóstico.
 */
import { clone } from '../../core.js';
import { Respiracao, Pulso, roisDoRosto, mediaRGBRois, METODOS_RPPG } from '../../runtime/livres-t/vitais.js';
import { publicar, studioAberto, geracaoAtual } from '../../runtime/livres-t/canal.js';
import { FONTES, AVISO_SAUDE } from '../../runtime/livres-t/clinica.js';
import { instante, obterPose, PARAMS_POSE, bannerista, COR, num, copiaQuadro, AVISO_CURTO } from './comum.js';

const G = 'CV-70';
export const FUNC_TORAX = 'vitais_torax';
export const FUNC_PELE = 'vitais_pele';

function caixaDaMarcacao(ctx, funcao) {
  const it = ctx.marcacoes && ctx.marcacoes.itens.find((i) => i.funcao === funcao && i.caixa);
  return it ? { x1: it.caixa.x1 * ctx.w, y1: it.caixa.y1 * ctx.h, x2: it.caixa.x2 * ctx.w, y2: it.caixa.y2 * ctx.h } : null;
}
const paraSrc = (c, src, ctx) => ({ x1: (c.x1 * src.width) / ctx.w, x2: (c.x2 * src.width) / ctx.w, y1: (c.y1 * src.height) / ctx.h, y2: (c.y2 * src.height) / ctx.h });

function bannersVitais(ctx, e, rot, un) {
  const ban = bannerista(ctx.overlay, ctx);
  ban(`⚠ ${AVISO_CURTO}`, COR.aviso);
  if (!e || e[rot] == null) { ban(`${un}: ${e && e.avisos && e.avisos[0] ? e.avisos[0] : 'juntando sinal…'}`, '#22d3ee'); return; }
  const cor = e.confianca >= 0.6 ? COR.ok : e.confianca >= 0.3 ? COR.aviso : COR.alerta;
  ban(`${num(e[rot], 0)} ${un} (faixa ${num(e.faixa[0], 0)}–${num(e.faixa[1], 0)}) · confiança ${num(e.confianca * 100, 0)} %`, cor);
  for (const a of (e.avisos || []).slice(0, 2)) ban('⚠ ' + a, COR.alerta);
}

export const respiracao = {
  op: 'vitais.respiracao',
  label: 'Frequência respiratória (tórax, sem contato)',
  group: G, overlayOnly: true,
  desc: 'Respirações por minuto pela oscilação do tórax: perfil vertical do gradiente numa ROI do tórax (da pose, de uma ' +
        'área "Vitais · tórax" ou do centro), deslocamento sub-pixel e pico do espectro (FFT) em 6–42 rpm, com faixa de ' +
        'confiança e avisos de luz e movimento. Pessoa parada, sentada ou deitada. ' + AVISO_SAUDE,
  params: {
    roi: { type: 'enum', options: ['pose (tórax)', 'marcação', 'centro do quadro'], default: 'pose (tórax)', label: 'Região do tórax' },
    janelaS: { type: 'int', min: 15, max: 120, step: 5, default: 30, label: 'Janela (s)' },
    minRpm: { type: 'int', min: 3, max: 20, step: 1, default: 6, label: 'Mínimo (rpm)' },
    maxRpm: { type: 'int', min: 20, max: 80, step: 1, default: 42, label: 'Máximo (rpm)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (!state.est || state.ger !== geracaoAtual()) { state.est = new Respiracao(); state.ger = geracaoAtual(); state.e = null; }
    Object.assign(state.est.cfg, { janelaS: p.janelaS, minRpm: p.minRpm, maxRpm: p.maxRpm });
    let caixa = null, origem = p.roi;
    if (p.roi === 'marcação') caixa = caixaDaMarcacao(ctx, FUNC_TORAX);
    if (p.roi === 'pose (tórax)') {
      const R = obterPose(src, p, state, ctx);
      if (R.P) {
        const q = (i) => (R.P[i] && R.P[i].v >= p.minVis ? R.P[i] : null);
        const oe = q(11), od = q(12), qe = q(23), qd = q(24);
        if (oe && od) {
          const sx = ctx.w / R.w, sy = ctx.h / R.h, L = Math.abs(oe.x - od.x);
          const yQ = qe && qd ? (qe.y + qd.y) / 2 : Math.max(oe.y, od.y) + 1.4 * L;
          const yO = (oe.y + od.y) / 2;
          // terço superior do tronco (o peito), sem os braços
          state.caixaPose = { x1: (Math.min(oe.x, od.x) + 0.15 * L) * sx, x2: (Math.max(oe.x, od.x) - 0.15 * L) * sx, y1: (yO + 0.12 * (yQ - yO)) * sy, y2: (yO + 0.55 * (yQ - yO)) * sy };
        }
      } else ctx.metrics['respiração'] = R.espera;
      caixa = state.caixaPose || null;   // a ROI fica fixa entre as poses (o tórax não anda)
    }
    if (!caixa) { caixa = { x1: 0.3 * ctx.w, x2: 0.7 * ctx.w, y1: 0.35 * ctx.h, y2: 0.65 * ctx.h }; if (p.roi !== 'centro do quadro') origem = 'centro (sem ' + (p.roi === 'marcação' ? 'área "Vitais · tórax"' : 'pose') + ')'; }
    const t = instante(ctx);
    if (t != null) state.est.adicionar(t, src, paraSrc(caixa, src, ctx));
    const agora = t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
    if (state.tEst == null || agora - state.tEst > 1000 || agora < state.tEst) { state.tEst = agora; state.e = state.est.estimar(); }
    const e = state.e;
    ctx.overlay.push({ type: 'rect', x: caixa.x1, y: caixa.y1, w: caixa.x2 - caixa.x1, h: caixa.y2 - caixa.y1, color: '#22d3ee', label: 'tórax' });
    if (!studioAberto()) bannersVitais(ctx, e, 'rpm', 'rpm');
    ctx.metrics['respiração'] = e && e.rpm != null ? `${num(e.rpm, 0)} rpm (${num(e.faixa[0], 0)}–${num(e.faixa[1], 0)})` : (e && e.avisos[0]) || '—';
    publicar('vitais.respiracao', {
      titulo: 'Frequência respiratória', saude: true, vitais: true,
      principal: { valor: e && e.rpm, unidade: 'rpm', faixa: e && e.faixa, rotulo: 'respirações por minuto' },
      linhas: [['Confiança', e && e.confianca != null ? num(e.confianca * 100, 0) + ' %' : '—'], ['SNR', e && e.snr != null ? num(e.snr, 1) + ' dB' : '—'],
        ['Janela', e ? num(e.duracaoS, 0) + ' s' : '—'], ['Amostras/s', e && e.fs ? num(e.fs, 1) : '—'], ['Região', origem]],
      avisos: e ? e.avisos : [], serie: e && e.serie ? { ...e.serie, rotulo: 'deslocamento do tórax (px)' } : null, espectro: e && e.espectro,
      fonte: 'Método: perfil vertical + FFT (pico em 6–42 rpm).', estimativa: e,
    }, studioAberto() ? copiaQuadro(src) : null);
    return clone(src);
  },
};

export const cardiaca = {
  op: 'vitais.cardiaca',
  label: 'Frequência cardíaca rPPG (rosto, sem contato)',
  group: G, overlayOnly: true,
  desc: 'Batimentos por minuto pela variação de cor da pele (rPPG): testa e bochechas pela Malha do rosto (coloque ' +
        'rosto.malha ANTES na cadeia) ou uma área "Vitais · pele", método POS (Wang 2017), CHROM (de Haan 2013) ou só o ' +
        'canal verde, pico do espectro em 42–180 bpm, faixa de confiança e avisos de luz e movimento. Rosto parado, luz ' +
        'contínua e de frente. Nenhuma identificação facial. ' + AVISO_SAUDE,
  params: {
    metodo: { type: 'enum', options: Object.keys(METODOS_RPPG), default: 'POS (Wang 2017)', label: 'Método' },
    janelaS: { type: 'int', min: 8, max: 60, step: 1, default: 15, label: 'Janela (s)' },
    minBpm: { type: 'int', min: 30, max: 80, step: 1, default: 42, label: 'Mínimo (bpm)' },
    maxBpm: { type: 'int', min: 100, max: 240, step: 5, default: 180, label: 'Máximo (bpm)' },
  },
  apply(src, p, state, ctx) {
    if (!state.est || state.ger !== geracaoAtual()) { state.est = new Pulso(); state.ger = geracaoAtual(); state.e = null; }
    const metodo = METODOS_RPPG[p.metodo] || 'pos';
    if (state.est.cfg.metodo !== metodo) state.est.zerar();
    Object.assign(state.est.cfg, { janelaS: p.janelaS, minBpm: p.minBpm, maxBpm: p.maxBpm, metodo });
    let rois = [], origem = '';
    const f = Array.isArray(ctx.faceMesh) && ctx.faceMesh[0];
    if (f) { rois = roisDoRosto(f.pts, src.width, src.height); origem = 'malha do rosto (testa + bochechas)'; }
    else { const c = caixaDaMarcacao(ctx, FUNC_PELE); if (c) { rois = [paraSrc(c, src, ctx)]; origem = 'área "Vitais · pele"'; } }
    const t = instante(ctx);
    let mov = 0;
    if (rois.length) {
      const c0 = rois[0], cx = (c0.x1 + c0.x2) / 2, cy = (c0.y1 + c0.y2) / 2, L = c0.x2 - c0.x1;
      if (state.c0) mov = Math.hypot(cx - state.c0.x, cy - state.c0.y) / Math.max(1, 3 * L);
      state.c0 = { x: cx, y: cy };
      if (t != null) state.est.adicionar(t, mediaRGBRois(src, rois, 2), mov);
    }
    const agora = t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
    if (state.tEst == null || agora - state.tEst > 1000 || agora < state.tEst) { state.tEst = agora; state.e = rois.length ? state.est.estimar() : null; }
    const e = state.e;
    const kx = ctx.w / src.width, ky = ctx.h / src.height;
    for (const c of rois) ctx.overlay.push({ type: 'rect', x: c.x1 * kx, y: c.y1 * ky, w: (c.x2 - c.x1) * kx, h: (c.y2 - c.y1) * ky, color: '#f472b6' });
    const avisos = rois.length ? (e ? e.avisos : []) : ['sem pele: ponha "Malha do rosto" antes na cadeia ou desenhe uma área "Vitais · pele"'];
    if (!studioAberto()) bannersVitais(ctx, rois.length ? e : { avisos }, 'bpm', 'bpm');
    ctx.metrics['FC rPPG'] = e && e.bpm != null ? `${num(e.bpm, 0)} bpm (${num(e.faixa[0], 0)}–${num(e.faixa[1], 0)})` : avisos[0] || '—';
    publicar('vitais.cardiaca', {
      titulo: 'Frequência cardíaca (rPPG)', saude: true, vitais: true,
      principal: { valor: e && e.bpm, unidade: 'bpm', faixa: e && e.faixa, rotulo: 'batimentos por minuto' },
      linhas: [['Método', p.metodo], ['Confiança', e && e.confianca != null ? num(e.confianca * 100, 0) + ' %' : '—'], ['SNR', e && e.snr != null ? num(e.snr, 1) + ' dB' : '—'],
        ['Janela', e ? num(e.duracaoS, 0) + ' s' : '—'], ['Amostras/s', e && e.fs ? num(e.fs, 1) : '—'], ['Região', origem || '—']],
      avisos, serie: e && e.pulso ? { ts: e.pulso.s.map((_, i) => (i * 1000) / e.pulso.fs), ys: e.pulso.s, rotulo: 'sinal de pulso' } : null, espectro: e && e.espectro,
      fonte: metodo === 'chrom' ? FONTES.chrom : metodo === 'pos' ? FONTES.pos : 'Canal verde normalizado (sem combinação de cor).', estimativa: e,
    }, studioAberto() ? copiaQuadro(src) : null);
    return clone(src);
  },
};

export default [respiracao, cardiaca];
