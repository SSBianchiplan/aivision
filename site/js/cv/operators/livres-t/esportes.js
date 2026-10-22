/**
 * operators/livres-t/esportes.js — CV-76 Esportes de ciclo (87–90).
 *
 *   corda.saltos        pular corda: o MOTOR DO SALTO (SessaoSalto, "saltos contínuos")
 *   luta.golpes         golpes de punho: contagem por mão e velocidade do punho
 *   basquete.arremesso  ângulo de soltura e acerto por zona do aro
 *   natacao.bracadas    braçadas e ritmo
 */
import { clone } from '../../core.js';
import { SessaoSalto } from '../../runtime/livres-h/salto.js';
import { escalaPerna } from '../../runtime/livres-h/corrida.js';
import { pernaPx } from '../../runtime/livres-h/comum.js';
import { dentro } from '../../marcacoes.js';
import { resumoCorda, DetectorGolpes, DetectorArremesso, anguloBola, ContadorBracadas } from '../../runtime/livres-t/esportes.js';
import { publicar, registrar, registrosDe, consumirPedido, geracaoAtual } from '../../runtime/livres-t/canal.js';
import { obterPose, PARAMS_POSE, esqueleto, bannerista, COR, num } from './comum.js';

const G = 'CV-76';
export const FUNC_ARO = 'basquete_aro';
export const FUNC_ZONA = 'basquete_zona';
const altura = { type: 'int', min: 0, max: 220, step: 1, default: 0, label: 'Estatura do atleta (cm, 0 = sem escala)' };

/** cm por px pela perna (estatura informada), mediana das últimas poses. */
function cmPorPx(state, P, alturaCm) {
  if (!(alturaCm > 0)) return null;
  const l = [pernaPx(P, 'e'), pernaPx(P, 'd')].filter(Boolean);
  if (l.length) { (state.pernas || (state.pernas = [])).push(Math.max(...l)); if (state.pernas.length > 90) state.pernas.shift(); }
  const s = (state.pernas || []).slice().sort((a, b) => a - b);
  return s.length ? escalaPerna(s[s.length >> 1], alturaCm) : null;
}

function semPose(op, titulo, R, ctx) {
  bannerista(ctx.overlay, ctx)(`${titulo}: ${R.espera}`, COR.aviso);
  publicar(op, { titulo, avisos: [R.espera], linhas: [] });
}

// ------------------------------------------------------------------ 87 corda

export const corda = {
  op: 'corda.saltos',
  label: 'Pular corda — saltos e ritmo',
  group: G, overlayOnly: true,
  desc: 'Conta os saltos de corda e mede o ritmo (saltos/min), a regularidade, as paradas, o tempo de voo e de contato e a ' +
        'altura pelo tempo de voo — com o motor do Salto (CV-31, teste de saltos contínuos), de lado ou de frente, corpo inteiro.',
  params: { alturaCm: altura, janelaS: { type: 'int', min: 10, max: 300, step: 10, default: 120, label: 'Série analisada (s)' }, ...PARAMS_POSE },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.ss = new SessaoSalto(); state.r = null; }
    const R = obterPose(src, p, state, ctx);
    if (!R.P) { semPose('corda.saltos', 'Corda', R, ctx); return clone(src); }
    esqueleto(ctx.overlay, R.P, ctx.w / R.w, ctx.h / R.h, p.minVis);
    if (R.novo) {
      state.ss.adicionar(R.t, R.P, p.minVis);
      const am = state.ss.amostras;
      let k = 0; while (k < am.length && am[k].t < R.t - p.janelaS * 1000) k++;
      if (k > 0) { am.splice(0, k); state.ss.sujo = true; }
    }
    const agora = R.t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
    if (state.tA == null || agora - state.tA > 500 || agora < state.tA) { state.tA = agora; const a = state.ss.analisar({ teste: 'continuo', alturaCm: p.alturaCm || null, vista: 'lateral' }); state.r = resumoCorda(a.tentativas); }
    const r = state.r || { saltos: 0 };
    const ped = consumirPedido('corda.saltos');
    if (ped && ped.acao === 'registrar') registrar('corda.saltos', { saltos: r.saltos, porMin: r.porMin, paradas: r.paradas, vooMs: r.vooMs, contatoMs: r.contatoMs, regularidadeCV: r.regularidadeCV });
    bannerista(ctx.overlay, ctx)(`corda: ${r.saltos} saltos · ${num(r.porMin, 0)}/min · paradas ${r.paradas ?? 0}`, '#22d3ee');
    ctx.metrics['corda'] = `${r.saltos} saltos`;
    publicar('corda.saltos', {
      titulo: 'Pular corda', acaoRegistrar: 'Registrar série',
      principal: { valor: r.saltos, unidade: 'saltos', rotulo: `nos últimos ${p.janelaS} s`, casas: 0 },
      linhas: [['Ritmo', num(r.porMin, 0) + ' saltos/min'], ['Regularidade (CV dos intervalos)', r.regularidadeCV != null ? num(r.regularidadeCV * 100, 0) + ' %' : '—'], ['Paradas', String(r.paradas ?? 0)],
        ['Tempo de voo', num(r.vooMs, 0) + ' ms'], ['Contato', num(r.contatoMs, 0) + ' ms'], ['Altura (pelo voo)', num(r.alturaCm, 1) + ' cm']],
      avisos: ['Câmera parada, pés à vista; ≥ 30 quadros/s para o tempo de voo.'], registros: registrosDe('corda.saltos'),
      colunas: ['n', 'quando', 'saltos', 'porMin', 'paradas', 'vooMs', 'contatoMs', 'regularidadeCV'], fonte: 'Motor do Salto (CV-31): tempo de voo e contato por quadro.',
    });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 88 luta

export const luta = {
  op: 'luta.golpes',
  label: 'Golpes de luta — contagem e velocidade do punho',
  group: G, overlayOnly: true,
  desc: 'Conta os golpes de punho (jab, direto, cruzado) por mão — o braço estende a ≥ 85 % do comprimento com pico de ' +
        'velocidade — e mede a velocidade do punho (em comprimentos de braço/s e, com a estatura, em m/s), o ritmo por ' +
        'minuto e a maior velocidade. De frente ou de lado para a câmera.',
  params: {
    alturaCm: altura,
    extensao: { type: 'float', min: 0.6, max: 0.98, step: 0.01, default: 0.85, label: 'Golpe: braço estendido a (fração)' },
    vMin: { type: 'float', min: 1, max: 10, step: 0.5, default: 3, label: 'Golpe: punho acima de (braços/s)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.d = new DetectorGolpes(); }
    Object.assign(state.d.cfg, { extensao: p.extensao, vMin: p.vMin });
    const R = obterPose(src, p, state, ctx);
    if (!R.P) { semPose('luta.golpes', 'Golpes', R, ctx); return clone(src); }
    const sx = ctx.w / R.w, sy = ctx.h / R.h;
    esqueleto(ctx.overlay, R.P, sx, sy, p.minVis);
    if (R.novo) {
      const evs = state.d.passo(R.t, R.P, p.minVis, cmPorPx(state, R.P, p.alturaCm));
      for (const g of evs) { state.flash = { ...g, ate: performance.now() + 500 }; }
    }
    const s = state.d.resumo();
    if (state.flash && state.flash.ate > performance.now()) {
      const P = R.P[state.flash.lado === 'e' ? 15 : 16];
      ctx.overlay.push({ type: 'point', x: P.x * sx, y: P.y * sy, r: 16, color: '#f87171' });
    }
    const ped = consumirPedido('luta.golpes');
    if (ped && ped.acao === 'registrar') registrar('luta.golpes', { total: s.total, esquerda: s.e, direita: s.d, porMin: s.porMin, vMaxMs: s.vMaxMs, vMediaMs: s.vMediaMs, vMaxBracos: s.vMaxBracos });
    bannerista(ctx.overlay, ctx)(`golpes ${s.total} (E ${s.e} · D ${s.d}) · máx ${s.vMaxMs != null ? num(s.vMaxMs, 1) + ' m/s' : num(s.vMaxBracos, 1) + ' braços/s'}`, '#22d3ee');
    ctx.metrics['golpes'] = s.total;
    publicar('luta.golpes', {
      titulo: 'Golpes de luta', acaoRegistrar: 'Registrar round',
      principal: { valor: s.total, unidade: 'golpes', rotulo: `esquerda ${s.e} · direita ${s.d}`, casas: 0 },
      linhas: [['Ritmo', num(s.porMin, 0) + ' golpes/min'], ['Punho: velocidade máxima', s.vMaxMs != null ? num(s.vMaxMs, 1) + ' m/s' : `${num(s.vMaxBracos, 1)} braços/s (informe a estatura para m/s)`],
        ['Punho: velocidade média', s.vMediaMs != null ? num(s.vMediaMs, 1) + ' m/s' : '—']],
      avisos: ['Velocidade 2D: golpe em direção à câmera aparece mais lento. Filme de lado para medir velocidade; ≥ 30 quadros/s.'],
      registros: registrosDe('luta.golpes'), colunas: ['n', 'quando', 'total', 'esquerda', 'direita', 'porMin', 'vMaxMs', 'vMediaMs', 'vMaxBracos'],
    });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 89 basquete

export const basquete = {
  op: 'basquete.arremesso',
  label: 'Arremesso de basquete — soltura e acerto por zona',
  group: G, overlayOnly: true,
  desc: 'Detecta a soltura do arremesso (cotovelo estendendo com o punho acima da cabeça) e mede o ângulo de soltura — pela ' +
        'parábola da BOLA quando um detector antes na cadeia acha "sports ball"/bola, senão pela direção do punho. Acerto: ' +
        'a bola entra descendo na área "Basquete · aro" (ou marque Cesta/Erro no painel). Zona do arremesso: os pés dentro ' +
        'das áreas "Basquete · zona" (nome = zona). Aproveitamento por zona.',
  params: { esperaS: { type: 'float', min: 1, max: 6, step: 0.5, default: 3, label: 'Esperar a bola até (s)' }, ...PARAMS_POSE },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.d = new DetectorArremesso(); state.atual = null; state.bola = []; }
    const R = obterPose(src, p, state, ctx);
    const ban = bannerista(ctx.overlay, ctx);
    const mq = ctx.marcacoes ? ctx.marcacoes.itens : [];
    const aro = mq.find((i) => i.funcao === FUNC_ARO && i.caixa);
    const zonas = mq.filter((i) => i.funcao === FUNC_ZONA && i.caixa);
    // bola da cadeia (detector antes)
    const dets = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => /ball|bola/i.test(String(d.name || d.label || ''))) : [];
    const t = R.t ?? performance.now();
    if (dets.length) {
      const b = dets.sort((a, c) => (c.score || 0) - (a.score || 0))[0];
      const x = ((b.x1 + b.x2) / 2) * (b.x2 <= 1.5 ? ctx.w : 1), y = ((b.y1 + b.y2) / 2) * (b.y2 <= 1.5 ? ctx.h : 1);
      state.bola.push({ t, x, y }); while (state.bola.length > 200) state.bola.shift();
      ctx.overlay.push({ type: 'point', x, y, r: 6, color: '#fb923c' });
    }
    if (R.P) {
      const sx = ctx.w / R.w, sy = ctx.h / R.h;
      esqueleto(ctx.overlay, R.P, sx, sy, p.minVis);
      if (R.novo) {
        const ar = state.d.passo(R.t, R.P, p.minVis);
        if (ar) {
          let zona = null;
          if (ar.pe) { const u = (ar.pe.x * sx) / ctx.w, v = (ar.pe.y * sy) / ctx.h; const z = zonas.find((i) => dentro(i, u, v)); zona = z ? z.nome : null; }
          state.atual = { ...ar, zona, anguloBola: null, resultado: null, tFim: ar.t + p.esperaS * 1000 };
        }
      }
    } else if (!state.atual) ban(`Basquete: ${R.espera}`, COR.aviso);
    const a = state.atual;
    if (a && !a.resultado) {
      const depois = state.bola.filter((q) => q.t >= a.t - 50);
      if (a.anguloBola == null) { const ini = depois.filter((q) => q.t <= a.t + 350); if (ini.length >= 4) a.anguloBola = anguloBola(ini); }
      if (aro) {
        for (let i = 1; i < depois.length; i++) {
          const q = depois[i], q0 = depois[i - 1];
          if (q.y > q0.y && dentro(aro, q.x / ctx.w, q.y / ctx.h)) { a.resultado = 'cesta'; break; }
        }
      }
      const ped = consumirPedido('basquete.arremesso');
      if (ped && (ped.acao === 'cesta' || ped.acao === 'erro')) a.resultado = ped.acao;
      if (!a.resultado && t > a.tFim && aro && depois.length >= 3) a.resultado = 'erro';
      if (a.resultado || t > a.tFim + 4000) {
        registrar('basquete.arremesso', { zona: a.zona || '—', resultado: a.resultado || 'sem confirmação', anguloBola: a.anguloBola, anguloPunho: a.anguloPunho, cotovelo: a.cotovelo, mao: a.lado === 'e' ? 'esquerda' : 'direita' });
        state.ultimo = a; state.atual = null;
      }
    } else consumirPedido('basquete.arremesso');
    const reg = registrosDe('basquete.arremesso');
    const porZona = {};
    for (const r of reg) { const z = (porZona[r.zona] = porZona[r.zona] || { n: 0, c: 0 }); if (r.resultado === 'cesta' || r.resultado === 'erro') { z.n++; if (r.resultado === 'cesta') z.c++; } }
    const u = state.atual || state.ultimo;
    if (u) ban(`soltura: ${u.anguloBola != null ? num(u.anguloBola, 0) + '° (bola)' : num(u.anguloPunho, 0) + '° (punho, aprox.)'}${u.zona ? ' · zona ' + u.zona : ''}${u.resultado ? ' · ' + u.resultado.toUpperCase() : state.atual ? ' · aguardando…' : ''}`, u.resultado === 'cesta' ? COR.ok : '#22d3ee');
    if (!aro) ban('Desenhe a área "Basquete · aro" para o acerto automático (ou use Cesta/Erro no painel)', COR.neutro);
    ctx.metrics['arremessos'] = reg.length;
    const cestas = reg.filter((r) => r.resultado === 'cesta').length, valid = reg.filter((r) => r.resultado === 'cesta' || r.resultado === 'erro').length;
    publicar('basquete.arremesso', {
      titulo: 'Arremesso de basquete', acoes: ['cesta', 'erro'],
      principal: { valor: valid ? (100 * cestas) / valid : null, unidade: '%', rotulo: `aproveitamento (${cestas}/${valid})`, casas: 0 },
      linhas: [['Último ângulo de soltura', u ? (u.anguloBola != null ? num(u.anguloBola, 1) + '° (parábola da bola)' : num(u.anguloPunho, 1) + '° (direção do punho)') : '—'],
        ['Bola na cadeia', dets.length ? 'sim' : 'não (ângulo pelo punho)'], ...Object.entries(porZona).map(([z, v]) => [`Zona ${z}`, v.n ? `${v.c}/${v.n} (${num((100 * v.c) / v.n, 0)} %)` : '—'])],
      avisos: ['Câmera de lado para o ângulo; o ângulo 2D só vale com o arremesso no plano da imagem.'], registros: reg,
      colunas: ['n', 'quando', 'zona', 'resultado', 'anguloBola', 'anguloPunho', 'cotovelo', 'mao'],
    });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 90 natação

const ESTILOS = { 'crawl ou costas (volta do braço)': 'rotacao', 'peito ou borboleta (ciclo)': 'ciclo' };

export const natacao = {
  op: 'natacao.bracadas',
  label: 'Natação — braçadas e ritmo',
  group: G, overlayOnly: true,
  desc: 'Conta as braçadas — no crawl e no costas cada volta completa de um braço (ângulo ombro→punho desenrolado), no ' +
        'peito e na borboleta o ciclo do punho — e mede o ritmo (braçadas/min) e a regularidade de cada braço. Vídeo ' +
        'de lado (borda da piscina ou subaquático); a pose dentro d\'água falha mais: confira.',
  params: { estilo: { type: 'enum', options: Object.keys(ESTILOS), default: 'crawl ou costas (volta do braço)', label: 'Estilo' }, ...PARAMS_POSE, minVis: { ...PARAMS_POSE.minVis, default: 0.3 } },
  apply(src, p, state, ctx) {
    if (state.ger !== geracaoAtual()) { state.ger = geracaoAtual(); state.c = new ContadorBracadas(); }
    const R = obterPose(src, p, state, ctx);
    if (!R.P) { semPose('natacao.bracadas', 'Natação', R, ctx); return clone(src); }
    esqueleto(ctx.overlay, R.P, ctx.w / R.w, ctx.h / R.h, p.minVis);
    if (R.novo) state.c.passo(R.t, R.P, p.minVis);
    const est = ESTILOS[p.estilo] || 'rotacao';
    const s = state.c.resumo(est);
    const ped = consumirPedido('natacao.bracadas');
    if (ped && ped.acao === 'registrar') registrar('natacao.bracadas', { estilo: p.estilo, bracadas: s.bracadas, porMin: s.porMin, esquerda: s.e ?? null, direita: s.d ?? null });
    bannerista(ctx.overlay, ctx)(`braçadas ${s.bracadas} · ${num(s.porMin, 0)}/min`, '#22d3ee');
    ctx.metrics['braçadas'] = s.bracadas;
    publicar('natacao.bracadas', {
      titulo: 'Natação', acaoRegistrar: 'Registrar piscina',
      principal: { valor: s.bracadas, unidade: 'braçadas', rotulo: p.estilo, casas: 0 },
      linhas: [['Ritmo', num(s.porMin, 0) + ' braçadas/min'], ...(est === 'rotacao' ? [['Esquerda / direita', `${s.e} / ${s.d}`], ['Regularidade E / D (CV)', `${s.cvE != null ? num(s.cvE * 100, 0) : '—'} / ${s.cvD != null ? num(s.cvD * 100, 0) : '—'} %`]] : [['Regularidade (CV)', s.cv != null ? num(s.cv * 100, 0) + ' %' : '—']])],
      avisos: ['Pose sob a água e com respingos é instável; revise a contagem no vídeo.'], registros: registrosDe('natacao.bracadas'),
      colunas: ['n', 'quando', 'estilo', 'bracadas', 'porMin', 'esquerda', 'direita'],
    });
    return clone(src);
  },
};

export default [corda, luta, basquete, natacao];
