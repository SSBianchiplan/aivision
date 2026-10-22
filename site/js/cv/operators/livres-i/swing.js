/**
 * operators/livres-i/swing.js — CV-33 Swing (golfe e raquete).
 *
 * Pose BlazePose (pose.js: YOLOX só para achar a pessoa, recorte seguindo os
 * pontos auxiliares) a cada quadro NOVO de vídeo, no tempo do quadro
 * (runtime/livres-i/relogio.js). O que importa num swing é o downswing: 0,25–
 * 0,35 s no golfe. A 15–25 poses/s isso dá 4–8 amostras; com o vídeo a 0,25×
 * (botão no painel) o mesmo downswing ganha 4× mais, e os tempos continuam
 * certos porque o relógio é o do vídeo, não o da página.
 *
 * Opcional: o YOLOX também procura o implemento ('tennis racket' ou
 * 'baseball bat' — o COCO não tem taco de golfe; o de beisebol às vezes pega)
 * a cada `implementoMs`, para desenhar a trajetória dele. Cada rodada do YOLOX
 * custa 0,3–2 s de fila no WASM, por isso vem desligado.
 *
 * A matemática (fases, métricas) está em runtime/livres-i/swing.js; a sessão
 * e o painel, em runtime/livres-i/canal.js.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { PERFIS_SWING, perfilDe, FASES, NOME_FASE, num, status, COR_STATUS } from '../../runtime/livres-i/swing.js';
import { canalSwing as canal } from '../../runtime/livres-i/canal.js';
import { tempoDoQuadro, aoQuadro, quadrosAtivos, desenharComoPipeline } from '../../runtime/livres-i/relogio.js';
import { store } from '../../../state/store.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import {
  passoPose, precisaDetectar, prepararDeteccao, detectar, copiarQuadro, resolverEspelho, miniatura, dataUrl, OSSOS, novoCanvas,
} from './pose.js';

const LADO_MINI = 120;

export const analise = {
  op: 'swing.analise',
  label: 'Swing — golfe e raquete',
  group: 'CV-33',
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Análise do swing pela pose BlazePose: fases (preparação, backswing, topo, downswing, impacto, ' +
        'follow-through) pela velocidade das mãos, quadros-chave congelados, tempo e razão backswing/downswing, ' +
        'rotação de ombros e quadril, X-factor, coluna, braço líder, cabeça, velocidade das mãos e transferência ' +
        'de peso. Golfe, tênis, padel, beach tennis e beisebol. Abra o painel Swing para comparar e exportar.',
  params: {
    perfil: { type: 'enum', options: PERFIS_SWING, default: 'Golfe · Drive', label: 'Esporte e golpe' },
    dominante: { type: 'enum', options: ['destro', 'canhoto'], default: 'destro', label: 'Mão dominante' },
    vista: { type: 'enum', options: ['frente', 'linha do alvo'], default: 'frente', label: 'Vista da câmera' },
    alturaCm: { type: 'int', min: 0, max: 230, step: 1, default: 0, label: 'Altura do atleta (cm, 0 = sem escala)' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    implemento: { type: 'bool', default: false, label: 'Seguir raquete/taco (YOLOX, mais lento)' },
    implementoMs: { type: 'int', min: 150, max: 3000, step: 50, default: 400, label: 'Intervalo do detector de implemento (ms)' },
    lento: { type: 'float', min: 1, max: 16, step: 0.5, default: 1, label: 'Vídeo em câmera lenta (×)' },
    vMin: { type: 'float', min: 0, max: 30, step: 0.5, default: 0, label: 'Pico mín. das mãos (troncos/s, 0 = do esporte)' },
    rastro: { type: 'bool', default: true, label: 'Rastro das mãos' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 6000, label: 'Re-detectar pessoa (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const esp = resolverEspelho(p.espelhada, ctx);
    const perfil = perfilDe(p.perfil);
    const assinatura = `${p.perfil}|${p.dominante}|${p.vista}|${esp}`;
    if (state.assinatura && state.assinatura !== assinatura) { canal.zerarSessao(); state.trilha = []; }
    state.assinatura = assinatura;
    if (state.geracao !== canal.geracaoSessao()) { state.geracao = canal.geracaoSessao(); state.trilha = []; state.ring = []; }

    // Quadro e tempo do MESMO instante: com vídeo, o quadro é copiado no
    // callback de requestVideoFrameCallback (relogio.js), onde o <video> mostra
    // exatamente o quadro do tempo informado; no loop de desenho o quadro às
    // vezes já é o seguinte — 33 ms de erro num downswing de 300 ms.
    const tq = tempoDoQuadro('swing.analise');
    state.vivoAte = performance.now() + 700;
    state.proc = { w: src.width, h: src.height, esp: Boolean(ctx.mirrored) };
    if (!state.cancelar) state.cancelar = aoQuadro((q) => capturar(state, q));
    schedule(state, 0,
      () => {
        // fonte parada (YouTube pausado, histórico): não re-infere o mesmo quadro
        if (quadroRepetido(state, src, ctx, { forcar: convergindo(state, state.results) })) return null;
        let fonte, t, img;
        if (quadrosAtivos()) {
          if (!state.capNovo || !state.capC) return null;
          state.capNovo = false;
          const W = state.capC.width, H = state.capC.height;
          if (!state.fc || state.fc.width !== W || state.fc.height !== H) state.fc = novoCanvas(W, H);
          const g = state.fc.getContext('2d', { willReadFrequently: true });
          g.drawImage(state.capC, 0, 0);
          fonte = state.fc; t = state.capT;
          img = () => g.getImageData(0, 0, W, H);
        } else {
          if (!tq.novo) return null;
          fonte = copiarQuadro(state, src); t = tq.t;
          img = () => src;
        }
        t /= p.lento || 1;
        const quer = precisaDetectar(state, t, p.detectarMs) || (p.implemento && (!state.tImpl || Math.abs(t - state.tImpl) > p.implementoMs));
        return { fonte, w: fonte.width, h: fonte.height, t, det: quer ? prepararDeteccao(img()) : null };
      },
      async ({ fonte, w, h, t, det }) => {
        let deteccoes = null;
        if (det) {
          deteccoes = await detectar(det);
          state.tImpl = t; state.redetectar = false;
          const alvo = perfil.implemento;
          const impl = deteccoes.filter((b) => alvo.includes(b.classe)).sort((a, b) => b.score - a.score)[0];
          state.impl = impl ? { ...impl, t } : (state.impl && Math.abs(t - state.impl.t) < 600 ? state.impl : null);
          // só re-semeia a pessoa quando precisa (o detector também rodou pelo implemento)
          if (state.roi && !precisaDetectar(state, t, p.detectarMs)) deteccoes = null;
        }
        const r = await passoPose(state, { fonte, w, h, t, esp, deteccoes });
        if (r.sem) {
          canal.publicar({ t, sem: true, perfil: p.perfil, nSwings: canal.obterSessao().swings.length, avisos: ['Ninguém na imagem.'] });
          return { sem: true, t };
        }
        // taxa de amostragem (poses por segundo de vídeo)
        state.tempos = (state.tempos || []).filter((x) => x > t - 2000 && x <= t);
        state.tempos.push(t);
        const taxa = state.tempos.length > 3 ? ((state.tempos.length - 1) * 1000) / (t - state.tempos[0]) : null;
        // miniatura do quadro (para os quadros-chave do swing, que só se fecha depois)
        const caixa = { cx: r.roi.cx, cy: r.roi.cy, s: r.roi.s * 1.1 };
        const mini = miniatura(fonte, caixa, LADO_MINI, state);
        state.ring = state.ring || [];
        state.ring.push({ t, mini, f: 1000 / w });
        while (state.ring.length > 110) state.ring.shift();
        const impl = state.impl && Math.abs(state.impl.t - t) < 250 ? { x: (state.impl.x1 + state.impl.x2) / 2, y: (state.impl.y1 + state.impl.y2) / 2 } : null;
        const sessao = canal.obterSessao();
        let swing = null;
        if (canal.estaGravando()) {
          // a sessão guarda posições em U = milésimos da largura do quadro: o
          // pipeline troca a largura de processamento sozinho (qualidade automática)
          const f = 1000 / w;
          const PU = r.P.map((q) => ({ x: q.x * f, y: q.y * f, z: q.z * f, v: q.v }));
          swing = sessao.adicionar({ t, P: PU, impl: impl ? { x: impl.x * f, y: impl.y * f } : null }, { perfil: p.perfil, dominante: p.dominante, vista: p.vista, alturaCm: p.alturaCm, vMin: p.vMin || undefined });
        }
        if (swing) {
          for (const f of FASES) {
            const q = swing.quadros[f];
            let melhor = null;
            for (const c of state.ring) if (!melhor || Math.abs(c.t - q.t) < Math.abs(melhor.t - q.t)) melhor = c;
            if (melhor && Math.abs(melhor.t - q.t) < 150) {
              const m = melhor.mini, k = m.L / m.s, f = melhor.f;
              q.thumb = dataUrl(m.img);
              q.pontos = q.P.map((pt) => ({ x: (pt.x / f - m.x0) * k, y: (pt.y / f - m.y0) * k, v: pt.v }));
            }
            delete q.P;   // a pose inteira em px do quadro não precisa ir para o relatório
          }
        }
        const avisos = [];
        if (taxa != null && taxa < 20) avisos.push(`Amostragem de ${Math.round(taxa)} poses/s: o downswing fica com poucas amostras. Use 0,25× no painel Swing.`);
        if (r.vMed < 0.5) avisos.push('Corpo pouco visível: enquadre o atleta inteiro, da cabeça aos pés.');
        canal.publicar({
          t, perfil: p.perfil, velAgora: sessao.velAgora, nSwings: sessao.swings.length, taxa, avisos,
          ultimo: sessao.swings[sessao.swings.length - 1] || null, novo: Boolean(swing),
        }, Boolean(swing));
        return { P: r.P, t, w, h, avisos, taxa };
      });

    const r = state.results;
    if (state.inferMs) ctx.metrics['swing ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['swing erro'] = state.error;
    if (!r || r.sem) {
      ctx.metrics['swing'] = 'sem atleta';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Swing: procurando o atleta…', color: '#FFD84D' });
      return clone(src);
    }
    desenhar(r, p, perfil, state, ctx);
    return clone(src);
  },
};

/** Callback de quadro do vídeo: copia o quadro (no tamanho e espelho do pipeline) com o seu tempo. */
function capturar(state, q) {
  const agora = performance.now();
  if (!state.vivoAte || agora > state.vivoAte) {
    if (state.cancelar && agora > (state.vivoAte || 0) + 5000) { state.cancelar(); state.cancelar = null; }
    return;
  }
  const { w, h, esp } = state.proc;
  if (!state.capC || state.capC.width !== w || state.capC.height !== h) state.capC = novoCanvas(w, h);
  const g = state.capC.getContext('2d', { willReadFrequently: true });
  desenharComoPipeline(g, q.video, w, h, esp, store.get().zoom);
  state.capT = q.t;
  state.capNovo = true;
}

function desenhar(r, p, perfil, state, ctx) {
  const ov = ctx.overlay;
  const sx = ctx.w / r.w, sy = ctx.h / r.h;
  const P = r.P.map((q) => ({ x: q.x * sx, y: q.y * sy, v: q.v }));
  const vis = (i) => P[i].v >= 0.4;
  const passo = Math.max(24, (22 * ctx.w) / 400);
  let hud = 8;
  const banner = (text, color) => { ov.push({ type: 'banner', x: 8, y: hud, text, color }); hud += passo; };
  for (const [a, b] of OSSOS) if (vis(a) && vis(b)) ov.push({ type: 'line', x1: P[a].x, y1: P[a].y, x2: P[b].x, y2: P[b].y, color: '#e5e7eb', width: 2.4 });
  for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) if (vis(i)) ov.push({ type: 'point', x: P[i].x, y: P[i].y, r: 3.5, color: '#FFD84D' });
  // linhas de ombros e quadril (rotação)
  if (vis(11) && vis(12)) ov.push({ type: 'line', x1: P[11].x, y1: P[11].y, x2: P[12].x, y2: P[12].y, color: '#22d3ee', width: 3 });
  if (vis(23) && vis(24)) ov.push({ type: 'line', x1: P[23].x, y1: P[23].y, x2: P[24].x, y2: P[24].y, color: '#a78bfa', width: 3 });
  // rastro das mãos (normalizado, sobrevive à troca de resolução)
  const m = perfil.maos === 'ambas' ? { x: (P[15].x + P[16].x) / 2, y: (P[15].y + P[16].y) / 2 } : (p.dominante === 'canhoto' ? P[15] : P[16]);
  const tr = state.trilha = state.trilha || [];
  if (!tr.length || tr[tr.length - 1].t !== r.t) {
    if (tr.length && r.t < tr[tr.length - 1].t) tr.length = 0;
    tr.push({ t: r.t, x: m.x / ctx.w, y: m.y / ctx.h });
    while (tr.length && tr[0].t < r.t - 2500) tr.shift();
  }
  if (p.rastro) {
    for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      const v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t) * 1000;   // fração do quadro por s
      const cor = v > 2 ? '#f87171' : v > 0.8 ? '#fb923c' : '#22d3ee';
      ov.push({ type: 'line', x1: a.x * ctx.w, y1: a.y * ctx.h, x2: b.x * ctx.w, y2: b.y * ctx.h, color: cor, width: 2.2 });
    }
  }
  if (state.impl && Math.abs(state.impl.t - r.t) < 600) {
    const b = state.impl;
    ov.push({ type: 'rect', x: b.x1 * sx, y: b.y1 * sy, w: (b.x2 - b.x1) * sx, h: (b.y2 - b.y1) * sy, color: '#f472b6', label: b.classe === 'tennis racket' ? 'raquete' : 'taco' });
  }
  const sessao = canal.obterSessao();
  const ult = sessao.swings[sessao.swings.length - 1];
  banner(`Swing · ${perfil.esporte} · ${perfil.golpe} · ${p.dominante} · ${p.vista}`, '#22d3ee');
  const v = sessao.velAgora;
  banner(v != null && v > perfil.vMin * 0.5 ? `Em movimento · mãos ${num(v, 1)} troncos/s` : `Aguardando swing · ${sessao.swings.length} gravados`, v != null && v > perfil.vMin * 0.5 ? '#fb923c' : '#94a3b8');
  if (ult) {
    const M = ult.metricas, ref = perfil.ref || {};
    banner(`Swing ${ult.n}: tempo ${num(M.tempoBack, 2)}/${num(M.tempoDown, 2)} s (${num(M.razaoTempo, 1)}:1)`, COR_STATUS[status(M.razaoTempo, ref.razaoTempo, 0.3)]);
    banner(`Ombros ${num(M.rotOmbros, 0)}° · quadril ${num(M.rotQuadril, 0)}° · X-factor ${num(M.xfactor, 0)}°`, COR_STATUS[status(M.xfactor, ref.xfactor)]);
    banner(`Cabeça ${num(M.cabeca, 0)}% do tronco · mãos ${num(M.velMaos, 1)} tr/s${M.velMaosMs ? ` (${num(M.velMaosMs, 1)} m/s)` : ''}`, COR_STATUS[status(M.cabeca, ref.cabeca)]);
    // trajetória das mãos do último swing, apagada
    const T = ult.trajetoPx;           // em U (milésimos da largura)
    if (p.rastro && T) {
      const k = ctx.w / 1000;
      for (let i = 1; i < T.length; i++) ov.push({ type: 'line', x1: T[i - 1].x * k, y1: T[i - 1].y * k, x2: T[i].x * k, y2: T[i].y * k, color: 'rgba(250,204,21,.45)', width: 1.6 });
    }
  }
  for (const a of (r.avisos || []).slice(0, 2)) banner('⚠ ' + a, '#f87171');
  ctx.metrics['swing'] = `${perfil.esporte} · ${perfil.golpe}`;
  ctx.metrics['swings'] = sessao.swings.length;
  if (r.taxa) ctx.metrics['poses/s'] = Math.round(r.taxa);
  if (ult) {
    ctx.metrics['razão de tempo'] = num(ult.metricas.razaoTempo, 1) + ':1';
    ctx.metrics['X-factor'] = num(ult.metricas.xfactor, 0) + '°';
    ctx.metrics['fases'] = FASES.map((f) => NOME_FASE[f]).join(' › ');
  }
}

export default [analise];
