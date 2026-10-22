/**
 * operators/livres-i/vbt.js — CV-34 VBT (velocidade da barra).
 *
 * Modo MARCADOR (padrão): um ArUco 4×4 impresso (página marcadores/aruco-4x4.html)
 * preso na ponta da barra, câmera de lado. O detector é JavaScript puro
 * (runtime/livres-i/aruco.js), roda no próprio apply, quadro a quadro, sem
 * modelo e sem fila do ONNX:
 *   - procura no quadro em resolução maior (ctx.grabFull, padrão 960 px) —
 *     a 480 px do pipeline um marcador de 5 cm a 2 m fica com ~15 px;
 *   - depois de achado, procura só numa janela em volta da última posição
 *     (barato); perdido, varre o quadro inteiro no máximo a cada 120 ms;
 *   - escala = tamanho real do marcador (cm) ÷ lado medido (px): calibração
 *     automática, sem medir nada na cena;
 *   - tempo = tempo do QUADRO (runtime/livres-i/relogio.js): quadro repetido
 *     não vira amostra e vídeo em câmera lenta mede certo.
 * Modo PUNHO (aproximado): sem marcador, a barra é a média dos punhos do
 * BlazePose e a escala vem da altura do atleta. Avisado na tela: a pose
 * oscila alguns cm e a escala é grosseira.
 *
 * A matemática (velocidade, repetições, potência, zonas, perda) está em
 * runtime/livres-i/vbt.js; a sessão e o painel, em runtime/livres-i/canal.js.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { detectarAruco } from '../../runtime/livres-i/aruco.js';
import { NOMES_EXERCICIOS, exercicioDe, zonaDe, num, alertaPerda, suavizar, configSessao } from '../../runtime/livres-i/vbt.js';
import {
  PONTOS, ESCALAS, resolverPonto, pontoSeguido, lerPontos, eixoCima, projetar, EscalaPose,
} from '../../runtime/livres-i/semmarcador.js';
import { canalVbt as canal } from '../../runtime/livres-i/canal.js';
import { tempoDoQuadro, aoQuadro, quadrosAtivos, desenharComoPipeline } from '../../runtime/livres-i/relogio.js';
import { store } from '../../../state/store.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import { passoPose, precisaDetectar, prepararDeteccao, detectar, copiarQuadro, resolverEspelho } from './pose.js';

const COR_ZONA = (v) => { const z = zonaDe(v); return z ? z.cor : '#94a3b8'; };

/** Eixo "para cima" da cena (referência marcada pelo usuário, ou a vertical da imagem). */
function eixoDaCena(p) {
  return eixoCima(lerPontos(p.vertical), p.verticalTipo === 'horizontal' ? 'horizontal' : 'vertical');
}

/**
 * Uma amostra nova para a sessão (as duas fontes passam por aqui).
 * amostra = { t, x, y (U), cmPx (cm por U), wRef? (U, referência do tronco para eixo horizontal) }.
 */
function registrar(state, p, amostra, fonte, extra = {}) {
  const sessao = canal.obterSessao();
  if (state.geracao !== canal.geracaoSessao()) { state.geracao = canal.geracaoSessao(); state.trilha = []; }
  state.trilha = state.trilha || [];
  if (state.trilha.length && amostra.t < state.trilha[state.trilha.length - 1].t) state.trilha = [];
  state.trilha.push({ x: amostra.x, y: amostra.y, t: amostra.t });
  while (state.trilha.length > 2 && state.trilha[0].t < amostra.t - 4000) state.trilha.shift();
  state.ultAmostra = performance.now();
  // eixo da concêntrica: vertical corrigida pela referência; horizontal = aproximar do tronco
  const ex = exercicioDe(p.exercicio), cima = eixoDaCena(p);
  const pr = projetar(amostra, cima);
  let u = pr.u;
  if (ex.eixo === 'horizontal') {
    if (p.sentidoH === 'para a direita') u = pr.w;
    else if (p.sentidoH === 'para a esquerda' || amostra.wRef == null) u = -pr.w;
    else u = -Math.abs(pr.w - amostra.wRef);
  }
  if (!canal.estaGravando()) return [];
  const novas = sessao.adicionar({ ...amostra, u, w: pr.w }, configSessao(p, fonte !== 'marcador', extra.escala && !extra.escala.confiavel));
  for (const r of novas) r.aprox = Boolean(extra.escala && !extra.escala.confiavel);
  const res = sessao.resumo();
  canal.publicar({
    t: amostra.t, fonte, exercicio: p.exercicio, cargaKg: p.cargaKg, marcadorCm: p.marcadorCm, limitePerda: p.limitePerda,
    vAgora: sessao.vAgora, resumo: res, nReps: sessao.todasReps.length, serie: sessao.series.length,
    alerta: alertaPerda(sessao.serie.reps, p.limitePerda), cmPx: amostra.cmPx, novas: novas.length,
    escala: extra.escala || null, ponto: extra.ponto || null, inclinacao: cima.graus, descartes: sessao.descartes,
    quadro: state.proc ? { w: state.proc.w, h: state.proc.h } : null,
  }, novas.length > 0);
  return novas;
}

export const barra = {
  op: 'vbt.barra',
  label: 'VBT — velocidade da barra',
  group: 'CV-34',
  overlayOnly: true,
  desc: 'Velocidade da barra pelo marcador ArUco impresso na ponta (vista lateral): trajetória, ' +
        'deslocamento, velocidade média e de pico da fase concêntrica, potência com a carga informada, ' +
        'repetições, perda de velocidade da série e zonas de velocidade. Sem marcador, modo aproximado ' +
        'pelos punhos (BlazePose). Abra o painel VBT para a tabela e o relatório.',
  params: {
    modo: { type: 'enum', options: ['marcador', 'punho (aproximado)'], default: 'marcador', label: 'Fonte da posição (punho (aproximado) = sem marcador, pela pose)' },
    exercicio: { type: 'enum', options: NOMES_EXERCICIOS, default: 'Agachamento', label: 'Exercício' },
    cargaKg: { type: 'float', min: 0, max: 500, step: 0.5, default: 60, label: 'Carga (kg)' },
    marcadorCm: { type: 'float', min: 1, max: 30, step: 0.1, default: 5, label: 'Lado do marcador impresso (cm)' },
    marcadorId: { type: 'int', min: -1, max: 49, step: 1, default: -1, label: 'Id do marcador (−1 = qualquer)' },
    limitePerda: { type: 'int', min: 5, max: 60, step: 1, default: 20, label: 'Alerta de perda de velocidade (%)' },
    deslMinCm: { type: 'int', min: 0, max: 80, step: 1, default: 0, label: 'Deslocamento mín. da repetição (cm, 0 = do exercício)' },
    pausaSerieS: { type: 'int', min: 0, max: 600, step: 5, default: 30, label: 'Pausa que abre nova série (s, 0 = manual)' },
    resolucao: { type: 'int', min: 320, max: 1920, step: 160, default: 960, label: 'Largura para achar o marcador (px)' },
    lento: { type: 'float', min: 1, max: 16, step: 0.5, default: 1, label: 'Vídeo em câmera lenta (×)' },
    ponto: { type: 'enum', options: PONTOS, default: 'automático', label: 'Ponto seguido sem marcador (automático = pelo exercício)' },
    escala: { type: 'enum', options: ESCALAS, default: 'altura', label: 'Escala sem marcador' },
    alturaCm: { type: 'int', min: 100, max: 230, step: 1, default: 175, label: 'Altura do atleta (cm)' },
    segmento: { type: 'enum', options: ['coxa', 'canela'], default: 'coxa', label: 'Segmento da escala' },
    segmentoCm: { type: 'float', min: 0, max: 80, step: 0.5, default: 0, label: 'Comprimento do segmento (cm, 0 = estimado da altura)' },
    calib2p: { type: 'text', default: '', label: '2 cliques: pontos (x1,y1,x2,y2 em milésimos da largura)' },
    calibCm: { type: 'float', min: 1, max: 500, step: 0.5, default: 45, label: '2 cliques: distância real (cm)' },
    vertical: { type: 'text', default: '', label: 'Referência de inclinação (x1,y1,x2,y2; vazio = vertical da imagem)' },
    verticalTipo: { type: 'enum', options: ['vertical', 'horizontal'], default: 'vertical', label: 'A referência é uma linha vertical ou horizontal (chão/banco)' },
    sentidoH: { type: 'enum', options: ['automático', 'para a esquerda', 'para a direita'], default: 'automático', label: 'Exercício horizontal: sentido da concêntrica' },
    minVis: { type: 'float', min: 0.3, max: 0.9, step: 0.05, default: 0.5, label: 'Visibilidade mínima do ponto (pose)' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (pose)' },
    rastro: { type: 'bool', default: true, label: 'Desenhar a trajetória' },
  },
  apply(src, p, state, ctx) {
    if (p.modo === 'marcador') marcador(src, p, state, ctx);
    else punho(src, p, state, ctx);
    desenhar(p, state, ctx, src);
    return clone(src);
  },
};

/*
 * Dois caminhos para o mesmo detector:
 *   - VÍDEO (arquivo, câmera, tela): o quadro é capturado no callback de
 *     requestVideoFrameCallback (runtime/livres-i/relogio.js), onde o <video>
 *     mostra exatamente o quadro do tempo informado. Mede TODO quadro do
 *     vídeo, no tempo certo, mesmo com o pipeline mais lento que o vídeo.
 *   - sem vídeo (imagem, navegador sem rVFC): mede no apply, com o quadro do
 *     pipeline (grabFull para resolução maior) e o relógio da página.
 * O apply só desenha e mantém o assinante vivo.
 */
function marcador(src, p, state, ctx) {
  const tq = tempoDoQuadro('vbt.barra');
  const agora = performance.now();
  state.vivoAte = agora + 700;
  state.p = p;
  state.proc = { w: src.width, h: src.height, esp: Boolean(ctx.mirrored) };
  if (!state.cancelar) state.cancelar = aoQuadro((q) => quadroDoVideo(state, q));
  ctx.metrics['vbt relógio'] = tq.fonte + (tq.taxa !== 1 ? ` ${num(tq.taxa, 2)}×` : '');
  if (quadrosAtivos()) return;            // o callback do vídeo mede
  if (!tq.novo) return;
  let img = null;
  if (ctx.grabFull && p.resolucao > src.width) img = ctx.grabFull(p.resolucao);
  if (!img || img.width < src.width) img = src;
  medir(state, p, img, 1000 / img.width, false, tq.t);
}

/** Callback de quadro do vídeo: captura (na resolução de busca) e mede. */
function quadroDoVideo(state, q) {
  const agora = performance.now();
  if (!state.vivoAte || agora > state.vivoAte) {
    // nó apagado/desligado ou pipeline parado: larga o assinante depois de um tempo
    if (state.cancelar && agora > (state.vivoAte || 0) + 5000) { state.cancelar(); state.cancelar = null; }
    return;
  }
  const p = state.p, v = q.video;
  if (!p || p.modo !== 'marcador' || !v.videoWidth) return;
  // captura no espaço do pipeline (zoom + espelho do app): a largura de busca
  // é a do recorte, limitada à resolução nativa dele
  const zoom = store.get().zoom, z = Math.max(1, (zoom && zoom.z) || 1);
  const W = Math.round(Math.min(p.resolucao, v.videoWidth / z)), H = Math.round((W * v.videoHeight) / v.videoWidth);
  if (!state.capC || state.capC.width !== W || state.capC.height !== H) {
    state.capC = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  }
  const g = state.capC.getContext('2d', { willReadFrequently: true });
  // só a janela de busca (ou o quadro todo, se perdido) vira pixels
  const ult = state.ult, kU = 1000 / W;   // posições guardadas em U = milésimos da largura do quadro
  const recente = ult && agora - ult.quando < 600;
  if (!recente && state.ultVarredura && agora - state.ultVarredura < 120) return;
  let jan = { x0: 0, y0: 0, x1: W, y1: H };
  if (recente) {
    const r = Math.max((3 * ult.lado) / kU, 60);
    const ux = ult.x / kU, uy = ult.y / kU;
    jan = { x0: Math.max(0, Math.floor(ux - r)), y0: Math.max(0, Math.floor(uy - r)), x1: Math.min(W, Math.ceil(ux + r)), y1: Math.min(H, Math.ceil(uy + r)) };
  } else state.ultVarredura = agora;
  const jw = jan.x1 - jan.x0, jh = jan.y1 - jan.y0;
  if (jw < 16 || jh < 16) { state.ult = null; return; }
  desenharComoPipeline(g, v, W, H, state.proc.esp, zoom);
  const img = g.getImageData(jan.x0, jan.y0, jw, jh);
  medir(state, p, img, kU, true, q.t, jan);
}

/**
 * Detecta o marcador em `img` e registra a amostra.
 * Unidade das posições: U = milésimos da LARGURA do quadro. O pipeline muda a
 * largura de processamento sozinho (qualidade automática) e a captura tem a
 * sua: em px, uma troca no meio da série viraria um salto da barra.
 * k = U por px de `img`; desloc = janela de img dentro da captura (caminho do
 * vídeo, que não vem espelhado: o espelho do app é aplicado aqui).
 */
function medir(state, p, img, k, doVideo, tMs, desloc = null) {
  const t0 = performance.now(), agora = t0;
  const ult = state.ult;
  const recente = ult && agora - ult.quando < 600;
  const W = img.width, H = img.height;
  if (!state.cinza || state.cinza.length < W * H) state.cinza = new Uint8Array(W * H);
  const g = state.cinza.length === W * H ? state.cinza : state.cinza.subarray(0, W * H);
  let roi = null;
  if (doVideo) {
    const d = img.data;
    for (let i = 0, j = 0; j < W * H; i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  } else {
    if (!recente && state.ultVarredura && agora - state.ultVarredura < 120) return;
    if (recente) {
      const r = Math.max((3 * ult.lado) / k, 60);
      roi = { x0: ult.x / k - r, y0: ult.y / k - r, x1: ult.x / k + r, y1: ult.y / k + r };
    } else state.ultVarredura = agora;
    const d = img.data;
    const x0 = roi ? Math.max(0, Math.floor(roi.x0)) : 0, x1 = roi ? Math.min(W, Math.ceil(roi.x1)) : W;
    const y0 = roi ? Math.max(0, Math.floor(roi.y0)) : 0, y1 = roi ? Math.min(H, Math.ceil(roi.y1)) : H;
    for (let y = y0; y < y1; y++) {
      for (let x = x0, i = (y * W + x0) * 4, j = y * W + x0; x < x1; x++, i += 4, j++) g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    }
  }
  // id travado: depois de ver um marcador, só aceita o mesmo id por 3 s (um
  // falso positivo de outro id no fundo não "teleporta" a barra)
  const trava = state.trava && agora - state.trava.quando < 3000 ? state.trava.id : null;
  const ids = p.marcadorId >= 0 ? new Set([p.marcadorId]) : trava != null ? new Set([trava]) : null;
  const achados = detectarAruco(g, W, H, { roi: roi || undefined, ids, ladoMin: 10 });
  state.detMs = performance.now() - t0;
  if (!achados.length) {
    // dois quadros sem achar na janela (borrão de movimento, oclusão): volta a varrer o quadro todo
    state.perdidos = (state.perdidos || 0) + 1;
    if (state.perdidos > 2) { state.marcador = null; state.ult = null; }
    return;
  }
  achados.sort((a, b) => (ult && a.id === ult.id ? -1e6 : 0) - (ult && b.id === ult.id ? -1e6 : 0) || b.lado - a.lado);
  const m = achados[0];
  // para U: desloca a janela e escala (a captura já vem no espaço do pipeline)
  const paraProc = (q) => {
    const x = (q.x + (desloc ? desloc.x0 : 0)) * k;
    const y = (q.y + (desloc ? desloc.y0 : 0)) * k;
    return { x, y };
  };
  const c = paraProc(m.centro);
  const ladoProc = (m.ladoEscala || m.lado) * k;
  // Consistência com o que vinha sendo seguido: o lado não muda mais que 15% e
  // o centro não salta mais do que a barra andaria a 4 m/s. Fora disso é
  // detecção errada (borrão, reflexo) — ignora, a não ser que se repita 3×
  // seguidas no mesmo lugar (aí o marcador mudou mesmo de lugar ou de tamanho).
  const ref = state.ladoRef;
  if (ult && recente && ref) {
    const dtS = Math.max(0.03, (agora - ult.quando) / 1000);
    const maxPx = ladoProc * 2 + (400 / (p.marcadorCm / ladoProc)) * dtS;   // 4 m/s em px
    const salto = Math.hypot(c.x - ult.x, c.y - ult.y) > maxPx || Math.abs(ladoProc - ref) / ref > 0.15;
    if (salto) {
      const s0 = state.suspeito;
      state.suspeito = s0 && Math.hypot(c.x - s0.x, c.y - s0.y) < ladoProc ? { ...c, n: s0.n + 1 } : { ...c, n: 1 };
      state.descartes = (state.descartes || 0) + 1;
      if (state.suspeito.n < 3) return;
    }
  }
  state.suspeito = null;
  state.perdidos = 0;
  state.ladoRef = ref ? ref * 0.9 + ladoProc * 0.1 : ladoProc;
  state.trava = { id: m.id, quando: agora };
  state.ult = { x: c.x, y: c.y, lado: ladoProc, id: m.id, quando: agora };
  state.marcador = { cantos: m.cantos.map(paraProc), id: m.id, lado: ladoProc };
  // mesma imagem de novo (sem rVFC, o quadro desenhado pode ser o anterior com
  // o relógio já adiantado): posição idêntica com tempo novo = degrau falso
  const ant = state.antPos;
  state.antPos = { x: c.x, y: c.y, t: tMs };
  if (!doVideo && ant && Math.abs(ant.x - c.x) < 1e-3 && Math.abs(ant.y - c.y) < 1e-3 && tMs - ant.t < 100) return;
  registrar(state, p, { t: tMs / (p.lento || 1), x: c.x, y: c.y, cmPx: p.marcadorCm / ladoProc }, 'marcador',
    { escala: { cmU: p.marcadorCm / ladoProc, fonte: `marcador ${num(p.marcadorCm, 1)} cm`, confiavel: true, avisos: [] }, ponto: 'marcador' });
}

function punho(src, p, state, ctx) {
  if (!ensure('yolox', state, ctx)) return;
  if (!ensure('pose', state, ctx)) return;
  const esp = resolverEspelho(p.espelhada, ctx);
  state.proc = { w: src.width, h: src.height, esp };
  schedule(state, 0,
    () => {
      // fonte parada (YouTube pausado, histórico): não re-infere o mesmo quadro
      if (quadroRepetido(state, src, ctx, { forcar: convergindo(state, state.results) })) return null;
      const tq = tempoDoQuadro('vbt.punho');
      if (!tq.novo) return null;
      const fonte = copiarQuadro(state, src);
      return { fonte, w: src.width, h: src.height, t: tq.t, det: precisaDetectar(state, tq.t, 6000) ? prepararDeteccao(src) : null };
    },
    async ({ fonte, w, h, t, det }) => {
      const deteccoes = det ? await detectar(det) : null;
      if (deteccoes) state.redetectar = false;
      const r = await passoPose(state, { fonte, w, h, t, esp, deteccoes });
      if (r.sem) return { sem: true, t };
      const P = r.P;
      const ex = exercicioDe(p.exercicio);
      const ponto = resolverPonto(p.ponto, ex);
      if (!state.escalaPose || state.geracaoEsc !== canal.geracaoSessao()) { state.escalaPose = new EscalaPose(); state.geracaoEsc = canal.geracaoSessao(); }
      state.escalaPose.adicionar(t, P, w, h);
      const escala = state.escalaPose.escala({
        escala: p.escala, alturaCm: p.alturaCm, segmento: p.segmento, segmentoCm: p.segmentoCm,
        calib: lerPontos(p.calib2p), calibCm: p.calibCm,
      });
      state.escala = escala;
      const alvo = pontoSeguido(P, ponto, p.minVis);
      // sem ponto visível ou sem escala: não mede, mas conta ao painel o porquê
      const status = (motivo) => {
        const sessao = canal.obterSessao();
        canal.publicar({
          t, fonte: 'pose', exercicio: p.exercicio, limitePerda: p.limitePerda, vAgora: null, resumo: sessao.resumo(),
          nReps: sessao.todasReps.length, serie: sessao.series.length, alerta: alertaPerda(sessao.serie.reps, p.limitePerda),
          escala, ponto, motivo, inclinacao: eixoDaCena(p).graus, descartes: sessao.descartes, quadro: { w, h },
        });
      };
      if (!alvo) { status(`${ponto} pouco visível`); return { P, t, w, ponto, semPonto: true }; }
      if (!escala.cmU) { status('sem escala'); return { P, t, w, ponto, alvo }; }
      const f = 1000 / w;
      // referência do tronco (para exercício horizontal: concêntrica = aproximar)
      const tronco = pontoSeguido(P, 'ombros', 0.3) || pontoSeguido(P, 'quadril', 0.3);
      const cima = eixoDaCena(p);
      const wRef = tronco ? projetar({ x: tronco.x * f, y: tronco.y * f }, cima).w : null;
      registrar(state, p, { t: t / (p.lento || 1), x: alvo.x * f, y: alvo.y * f, cmPx: escala.cmU, wRef }, 'pose', { escala, ponto });
      return { P, t, w, ponto, alvo };
    });
  if (state.error) ctx.metrics['vbt erro'] = state.error;
}

function desenhar(p, state, ctx, src) {
  const ov = ctx.overlay;
  const sessao = canal.obterSessao();
  const res = sessao.resumo();
  const passo = Math.max(24, (22 * ctx.w) / 400);
  let hud = 8;
  const banner = (text, color) => { ov.push({ type: 'banner', x: 8, y: hud, text, color }); hud += passo; };
  const sx = ctx.w / 1000;            // posições em U (milésimos da largura)

  // marcador
  if (p.modo === 'marcador' && state.marcador) {
    const C = state.marcador.cantos;
    for (let i = 0; i < 4; i++) ov.push({ type: 'line', x1: C[i].x * sx, y1: C[i].y * sx, x2: C[(i + 1) % 4].x * sx, y2: C[(i + 1) % 4].y * sx, color: '#22d3ee', width: 2.4 });
    ov.push({ type: 'point', x: C[0].x * sx, y: C[0].y * sx, r: 3, color: '#f472b6' });
  }
  const semMarc = p.modo !== 'marcador';
  if (semMarc && state.results && state.results.P) {
    // esqueleto discreto: o que importa é o ponto seguido
    const P = state.results.P, sp = ctx.w / state.results.w;
    for (const [a, b] of [[11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28], [11, 13], [13, 15], [12, 14], [14, 16]]) {
      if (P[a].v > 0.4 && P[b].v > 0.4) ov.push({ type: 'line', x1: P[a].x * sp, y1: P[a].y * sp, x2: P[b].x * sp, y2: P[b].y * sp, color: 'rgba(229,231,235,.45)', width: 1.4 });
    }
  }
  // referências marcadas pelo usuário (inclinação e 2 cliques)
  const ref = lerPontos(p.vertical);
  if (ref) ov.push({ type: 'line', x1: ref[0].x * sx, y1: ref[0].y * sx, x2: ref[1].x * sx, y2: ref[1].y * sx, color: 'rgba(167,139,250,.9)', width: 1.6 });
  const cal = semMarc && p.escala === '2 cliques' ? lerPontos(p.calib2p) : null;
  if (cal) {
    ov.push({ type: 'line', x1: cal[0].x * sx, y1: cal[0].y * sx, x2: cal[1].x * sx, y2: cal[1].y * sx, color: 'rgba(52,211,153,.9)', width: 1.6 });
    for (const q of cal) ov.push({ type: 'point', x: q.x * sx, y: q.y * sx, r: 3, color: '#34d399' });
  }
  // trajetória viva SUAVIZADA (a pose treme; o traço cru vira rabisco)
  const tr = state.trilha || [];
  if (p.rastro && tr.length > 2) {
    const ts = tr.map((q) => q.t);
    const xs = semMarc ? suavizar(ts, tr.map((q) => q.x), 90) : tr.map((q) => q.x);
    const ys = semMarc ? suavizar(ts, tr.map((q) => q.y), 90) : tr.map((q) => q.y);
    for (let i = 1; i < tr.length; i++) {
      if (Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) > 250) continue;   // salto (trecho novo): não liga
      const alfa = (0.15 + 0.6 * (i / tr.length)).toFixed(2);                  // o passado mais apagado
      ov.push({ type: 'line', x1: xs[i - 1] * sx, y1: ys[i - 1] * sx, x2: xs[i] * sx, y2: ys[i] * sx, color: `rgba(255,255,255,${alfa})`, width: 2 });
    }
  }
  const reps = sessao.serie.reps;
  const ultRep = reps[reps.length - 1];
  if (p.rastro && ultRep && ultRep.trajeto.length > 1) {
    const cor = COR_ZONA(ultRep.vm), T = ultRep.trajeto;
    for (let i = 1; i < T.length; i++) ov.push({ type: 'line', x1: T[i - 1].x * sx, y1: T[i - 1].y * sx, x2: T[i].x * sx, y2: T[i].y * sx, color: cor, width: 3 });
    // prumo a partir do início da concêntrica: mostra o desvio horizontal
    const y0 = Math.min(...T.map((q) => q.y)), y1 = Math.max(...T.map((q) => q.y));
    ov.push({ type: 'line', x1: T[0].x * sx, y1: y0 * sx, x2: T[0].x * sx, y2: y1 * sx, color: 'rgba(255,255,255,.35)', width: 1 });
    // início e fim da repetição
    const A = T[0], B = T[T.length - 1], esc = Math.max(0.8, ctx.w / 640);
    ov.push({ type: 'point', x: A.x * sx, y: A.y * sx, r: 5 * esc, color: '#4ade80' });
    ov.push({ type: 'point', x: B.x * sx, y: B.y * sx, r: 5 * esc, color: '#f87171' });
    ov.push({ type: 'rect', x: A.x * sx + 8, y: A.y * sx + 4, w: 0, h: 0, color: '#4ade80', label: `início ${ultRep.n}` });
    ov.push({ type: 'rect', x: B.x * sx + 8, y: B.y * sx - 4, w: 0, h: 0, color: '#f87171', label: `fim ${ultRep.n}` });
  }
  const vivo = state.ultAmostra && performance.now() - state.ultAmostra < 800;
  if (tr.length && vivo) {
    // ponto seguido em destaque (anel + miolo)
    const u = tr[tr.length - 1], esc = Math.max(0.8, ctx.w / 640);
    ov.push({ type: 'point', x: u.x * sx, y: u.y * sx, r: 9 * esc, color: 'rgba(255,216,77,.35)' });
    ov.push({ type: 'point', x: u.x * sx, y: u.y * sx, r: 4.5 * esc, color: '#FFD84D' });
  }

  const NOME_PONTO = { quadril: 'quadril', punhos: 'punhos', ombros: 'ombros' };
  const pontoEf = semMarc ? resolverPonto(p.ponto, exercicioDe(p.exercicio)) : null;
  const modoTxt = !semMarc ? `marcador ${num(p.marcadorCm, 1)} cm` : `sem marcador · ${NOME_PONTO[pontoEf]}`;
  banner(`VBT · ${p.exercicio} · ${num(p.cargaKg, p.cargaKg % 1 ? 1 : 0)} kg · ${modoTxt}`, '#22d3ee');
  if (!semMarc && !state.marcador) banner('Procurando o marcador ArUco…', '#FFD84D');
  const esc = semMarc ? state.escala : null;
  if (semMarc) {
    if (esc && esc.cmU) banner(`Escala: ${esc.fonte} · ${num((esc.cmU * 10000) / ctx.w, 2)} mm/px`, esc.confiavel ? '#94a3b8' : '#f87171');
    if (esc && !esc.confiavel) banner('⚠ Velocidades NÃO confiáveis: ' + (esc.avisos[0] || 'escala indefinida').slice(0, 90), '#f87171');
    if (state.results && state.results.semPonto) banner(`⚠ ${NOME_PONTO[pontoEf]} pouco visível neste quadro`, '#FFD84D');
  }
  const v = sessao.vAgora;
  if (v != null && vivo) banner(`Agora ${num(v, 2)} m/s · série ${sessao.series.length} · ${reps.length} reps`, '#94a3b8');
  if (ultRep) {
    const z = zonaDe(ultRep.vm);
    banner(`Rep ${ultRep.n}: média ${ultRep.aprox ? '≈' : ''}${num(ultRep.vm, 2)} m/s · pico ${num(ultRep.pico, 2)} · ${num(ultRep.desl, 0)} cm${ultRep.potMedia ? ` · ${Math.round(ultRep.potMedia)} W` : ''}`, z ? z.cor : '#4ade80');
    if (z) banner(`Zona: ${z.nome}`, z.cor);
  }
  if (res.perda != null) {
    const alerta = alertaPerda(reps, p.limitePerda);
    const poucas = reps.length < 3;
    banner(`${alerta ? '⚠ ' : ''}Perda de velocidade ${num(res.perda, 0)}% (limite ${p.limitePerda}%)${poucas ? ' · alerta a partir de 3 reps' : ''}`, alerta ? '#f87171' : '#4ade80');
  }
  ctx.metrics['vbt'] = !semMarc ? (state.marcador ? `marcador #${state.marcador.id} · ${num((state.marcador.lado * ctx.w) / 1000, 0)} px` : 'sem marcador') : `pose · ${pontoEf}`;
  if (esc && esc.cmU) ctx.metrics['vbt escala'] = `${num(esc.cmU, 3)} cm/U · ${esc.fonte}`;
  if (state.detMs != null) ctx.metrics['vbt busca ms'] = state.detMs.toFixed(1);
  ctx.metrics['repetições'] = reps.length;
  if (ultRep) { ctx.metrics['vel. média'] = num(ultRep.vm, 2) + ' m/s'; ctx.metrics['vel. pico'] = num(ultRep.pico, 2) + ' m/s'; }
  if (res.perda != null) ctx.metrics['perda vel.'] = num(res.perda, 0) + '%';
}

export default [barra];
