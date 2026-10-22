/**
 * operators/livres-l/contagem.js — CV-38 Contagem em esteira (porte do
 * GPlanSiS|CounterVision).
 *
 * Três operadores, para encadear com o CV-37 (Zonas e linhas) no meio:
 *
 *   contagem.cor      MOTOR COR, sem modelo: amostras de cor (clique na peça
 *                     no Studio, ou #rrggbb), máscara HSV com tolerância,
 *                     abertura, componentes conectados, separação de peças
 *                     encostadas pelo k-means e rastreio por centroide com ID.
 *                     Publica ctx.detections com classe "cor:<nome>".
 *   contagem.onnx     MOTOR DETECTOR com o .onnx do usuário (como o
 *                     CounterVision cadastrava o best.onnx) — ou use qualquer
 *                     detector livre do iaVision (YOLOX, RF-DETR) + ByteTrack.
 *   contagem.esteira  PRODUÇÃO: lê os eventos do cena.zonas (linha com
 *                     sentido, entrada em zona) e soma total, sentido, classe,
 *                     taxa peças/min e /h, turnos e meta, alarmes de parada e
 *                     de taxa, eventos com hora/ID/sentido/classe/confiança,
 *                     fila offline (IndexedDB) e CSV. Tela GPlanSiS|CounterVision.
 *
 * Cadeia típica: contagem.cor → cena.zonas (ponto = centro, cada ID uma vez)
 * → contagem.esteira. A geometria (linhas e zonas) é a das Ferramentas de
 * mouse do app (cv/marcacoes.js) — não há um segundo editor de zonas.
 *
 * QUADRO PARADO: fonte parada (YouTube pausado, histórico — ctx.fonteParada)
 * ou o mesmo instante do vídeo (o laço do app roda mais rápido que o vídeo,
 * ou vídeo pausado) não roda o detector nem o rastreio de novo: as mesmas
 * posições saem para a cadeia, nada cruza, nada conta, e o tempo da taxa não
 * anda (runtime/parado.js, livres-k/canal.js › tempoDaFonte).
 */
import { clone } from '../../core.js';
import { quadroRepetido } from '../../runtime/parado.js';
import { tempoDaFonte } from '../../runtime/livres-k/canal.js';
import { colorFor, ensure, schedule } from '../../runtime/opkit.js';
import { letterbox, toTensorData } from '../../runtime/tensor.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { RastreioCentroide } from '../../runtime/livres-l/cor.js';
import { motorCor, motorEsteira, publicar, studioAberto, lerTurnos } from '../../runtime/livres-l/esteira.js';
import { ID_MODELO, modeloGuardado, infoModelo, decodificar } from '../../runtime/livres-l/onnx-local.js';
import { numBR } from '../../numfmt.js';

const G = 'CV-38';
const fin = Number.isFinite;

/** Mesmo instante do vídeo do arquivo (ou pausado): não reprocessar. */
function instanteRepetido(state) {
  const f = tempoDaFonte();
  if (!f.video) return false;
  const rep = state._tVid === f.t;
  state._tVid = f.t;
  return rep;
}

// ======================================================================= COR

export const cor = {
  op: 'contagem.cor',
  label: 'Contagem — motor COR (sem modelo)',
  group: G, overlayOnly: true,
  desc: 'Detecta peças pela COR, sem modelo: amostre clicando numa peça (Studio CounterVision › Calibrar cor) ' +
        'ou escolha a cor. Máscara HSV com tolerância, abertura, componentes conectados, separa peças ' +
        'encostadas pela área típica (k-means) e rastreia por centroide com ID. Coloque Zonas e linhas e a ' +
        'Contagem em esteira depois.',
  params: {
    work: { type: 'int', min: 160, max: 640, step: 32, default: 320, label: 'Resolução de análise (px)' },
    tol: { type: 'int', min: 0, max: 40, step: 1, default: 6, label: 'Tolerância de cor (+° de matiz)' },
    tamMul: { type: 'float', min: 0.4, max: 2.5, step: 0.05, default: 1, label: 'Tamanho típico (×)' },
    minFrac: { type: 'float', min: 0.05, max: 0.9, step: 0.05, default: 0.35, label: 'Área mínima (fração do típico)' },
    minPx: { type: 'int', min: 4, max: 400, step: 1, default: 12, label: 'Área mínima sem tamanho típico (px)' },
    abertura: { type: 'bool', default: true, label: 'Remover ruído (abertura)' },
    separar: { type: 'bool', default: true, label: 'Separar peças encostadas (k-means)' },
    minHits: { type: 'int', min: 1, max: 10, step: 1, default: 3, label: 'Quadros para confirmar a peça' },
    maxMiss: { type: 'int', min: 1, max: 30, step: 1, default: 6, label: 'Quadros tolerados sem ver' },
    gate: { type: 'float', min: 0.4, max: 4, step: 0.1, default: 1.5, label: 'Raio de associação (× tamanho)' },
    ema: { type: 'float', min: 0.05, max: 1, step: 0.05, default: 0.5, label: 'Suavização da posição' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar peças e IDs' },
  },
  apply(src, p, state, ctx) {
    const m = motorCor();
    if (!state.trk) { state.trk = new RastreioCentroide(); state.saida = []; state.ms = 0; }
    const parado = quadroRepetido(state, src, ctx);
    const repetido = instanteRepetido(state);
    if (!(parado || repetido)) {
      const t0 = performance.now();
      const dets = m.detectar(src, p);
      const tr = state.trk.atualizar(dets, src.width / src.height, p);
      const out = [];
      for (const t of tr) {
        if (!t.ok || t.miss > 2) continue;
        const hw = t.w / 2, hh = t.h / 2;
        out.push({ x1: t.sx - hw, y1: t.sy - hh, x2: t.sx + hw, y2: t.sy + hh, score: t.score, name: 'cor:' + t.nome, id: t.id, cx: t.sx, cy: t.sy, miss: t.miss });
      }
      state.saida = out;
      state.nDet = dets.length;
      state.ms = performance.now() - t0;
    }
    ctx.detections = state.saida.map((d) => ({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, score: d.score, name: d.name, id: d.id }));
    if (p.desenhar && !studioAberto()) {
      const { w, h } = ctx;
      for (const d of state.saida) {
        const c = colorFor(d.id);
        ctx.overlay.push({ type: 'rect', x: d.x1 * w, y: d.y1 * h, w: (d.x2 - d.x1) * w, h: (d.y2 - d.y1) * h, color: c, label: `#${d.id} ${d.name.slice(4)}` });
      }
    }
    if (!m.amostras.length) ctx.metrics['COR'] = 'sem amostra: abra o Studio CounterVision › Calibrar cor';
    else ctx.metrics['COR'] = `${m.classes.length} cor(es) · ${state.nDet || 0} peças · ${state.saida.length} trilhas · ${state.ms.toFixed(1)} ms`;
    return clone(src);
  },
};

// ======================================================================= DETECTOR (ONNX do usuário)

export const onnx = {
  op: 'contagem.onnx',
  label: 'Contagem — detector ONNX do usuário',
  group: G, overlayOnly: true,
  desc: 'Roda o .onnx de detector escolhido no painel Contagem em esteira (fica neste navegador; saída ' +
        '[1,N,6] fim a fim ou [1,4+C,N] estilo YOLO). Para detector livre já pronto, use YOLOX ou RF-DETR. ' +
        'Ponha Tracking com IDs depois, para contar por linha.',
  params: {
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.35, label: 'Confiança mínima' },
    iou: { type: 'float', min: 0.2, max: 0.9, step: 0.05, default: 0.5, label: 'IoU do NMS' },
    maxDet: { type: 'int', min: 1, max: 600, step: 1, default: 300, label: 'Máximo de detecções' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mínimo (ms)' },
  },
  apply(src, p, state, ctx) {
    modeloGuardado();
    const inf = infoModelo();
    if (!inf || !MODELS[ID_MODELO]) {
      ctx.metrics['ONNX'] = 'nenhum modelo: escolha o .onnx no painel Contagem em esteira';
      return clone(src);
    }
    const chave = inf.nome + ':' + inf.bytes;
    if (state.chave !== chave) { for (const k of Object.keys(state)) delete state[k]; state.chave = chave; }
    if (!ensure(ID_MODELO, state, ctx)) return clone(src);
    const spec = MODELS[ID_MODELO], S = spec.input[2], w = src.width, h = src.height;
    if (!quadroRepetido(state, src, ctx) && !instanteRepetido(state)) {
      schedule(state, p.everyMs, () => letterbox(src, S, S), async (lb) => {
        const out = await run(ID_MODELO, await makeTensor(toTensorData(lb.data, spec), spec.input));
        return decodificar(out[Object.keys(out)[0]], lb, w, h, p.conf, p.iou, p.maxDet, inf.classes.length);
      });
    }
    const res = state.results || [];
    const nome = (k) => inf.classes[k] || `#${k}`;
    ctx.detections = res.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: b.score, name: nome(b.cls) }));
    if (!studioAberto()) {
      for (const b of res) ctx.overlay.push({ type: 'rect', x: b.x1 * ctx.w, y: b.y1 * ctx.h, w: (b.x2 - b.x1) * ctx.w, h: (b.y2 - b.y1) * ctx.h, color: colorFor(b.cls), label: `${nome(b.cls)} ${(b.score * 100) | 0}%` });
    }
    ctx.metrics['ONNX'] = `${inf.nome} · ${res.length} obj.${state.inferMs ? ` · ${state.inferMs.toFixed(0)} ms` : ''}`;
    if (state.error) ctx.metrics['ONNX erro'] = state.error;
    return clone(src);
  },
};

// ======================================================================= RASTREIO (detector)

export const rastreio = {
  op: 'contagem.rastreio',
  label: 'Contagem — rastreio por centroide (esteira)',
  group: G, overlayOnly: true,
  desc: 'O rastreador do CounterVision para as caixas de um detector (YOLOX, RF-DETR, o seu .onnx): associação por ' +
        'distância com previsão de velocidade, mesma classe, confirmação e tolerância a falhas. Na esteira (peças ' +
        'andando mais que o próprio tamanho entre duas inferências) segura o ID melhor que o casamento por IoU.',
  params: {
    confMin: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0.3, label: 'Confiança mínima' },
    minHits: { type: 'int', min: 1, max: 10, step: 1, default: 2, label: 'Inferências para confirmar' },
    maxMiss: { type: 'int', min: 1, max: 30, step: 1, default: 5, label: 'Inferências toleradas sem ver' },
    gate: { type: 'float', min: 0.4, max: 4, step: 0.1, default: 1.5, label: 'Raio de associação (× tamanho)' },
    ema: { type: 'float', min: 0.05, max: 1, step: 0.05, default: 0.6, label: 'Suavização da posição' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar IDs' },
  },
  apply(src, p, state, ctx) {
    const dets = Array.isArray(ctx.detections) ? ctx.detections : null;
    if (!dets) { ctx.metrics['rastreio'] = 'coloque um detector antes'; return clone(src); }
    if (!state.trk) { state.trk = new RastreioCentroide(); state.saida = []; state.nomes = []; }
    // o detector repete as MESMAS caixas entre inferências (roda fora do laço): só atualiza com caixas novas
    let assin = dets.length;
    for (const d of dets) assin = (assin * 31 + Math.round((d.x1 + d.y1 * 3 + d.x2 * 7 + d.y2 * 11) * 1e5)) % 1e12;
    const parado = quadroRepetido(state, src, ctx);
    if (assin !== state.assin && !parado) {
      state.assin = assin;
      const ent = [];
      for (const d of dets) {
        if (d.score != null && d.score < p.confMin) continue;
        const nome = String(d.name || 'objeto');
        let c = state.nomes.indexOf(nome);
        if (c < 0) { state.nomes.push(nome); c = state.nomes.length - 1; }
        ent.push({ x: (d.x1 + d.x2) / 2, y: (d.y1 + d.y2) / 2, w: d.x2 - d.x1, h: d.y2 - d.y1, score: d.score == null ? 1 : d.score, c: c + 1, nome });
      }
      const tr = state.trk.atualizar(ent, src.width / src.height, p);
      state.saida = tr.filter((t) => t.ok && t.miss <= 1).map((t) => ({
        x1: t.sx - t.w / 2, y1: t.sy - t.h / 2, x2: t.sx + t.w / 2, y2: t.sy + t.h / 2, score: t.score, name: t.nome, id: t.id,
      }));
    }
    ctx.detections = state.saida.map((d) => ({ ...d }));
    if (p.desenhar && !studioAberto()) {
      for (const d of state.saida) ctx.overlay.push({ type: 'rect', x: d.x1 * ctx.w, y: d.y1 * ctx.h, w: (d.x2 - d.x1) * ctx.w, h: (d.y2 - d.y1) * ctx.h, color: colorFor(d.id), label: `#${d.id} ${d.name}` });
    }
    ctx.metrics['rastreio'] = `${state.saida.length} trilhas · ${state.trk.prox - 1} IDs`;
    return clone(src);
  },
};

// ======================================================================= PRODUÇÃO

const PADRAO_TURNOS = 'T1 06:00-14:00; T2 14:00-22:00; T3 22:00-06:00';

export const esteira = {
  op: 'contagem.esteira',
  label: 'Contagem em esteira (CounterVision)',
  group: G, overlayOnly: true,
  desc: 'Produção a partir das linhas e zonas (coloque depois de Zonas e linhas): total por sentido e classe, ' +
        'peças/min e /h, gráfico por minuto, turnos com meta e projeção, alarmes de parada e de taxa baixa/alta, ' +
        'eventos com hora, ID, sentido, classe e confiança, fila guardada neste navegador e CSV. Tela ' +
        'GPlanSiS|CounterVision.',
  params: {
    base: { type: 'enum', options: ['automático', 'linhas', 'zonas', 'linhas e zonas'], default: 'automático', label: 'Contar por' },
    sentido: { type: 'enum', options: ['ambos (soma)', 'ida', 'volta', 'líquido (ida − volta)'], default: 'ambos (soma)', label: 'Sentido que conta (linhas)' },
    confMin: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0, label: 'Confiança mínima do evento' },
    janelaS: { type: 'int', min: 10, max: 600, step: 10, default: 60, label: 'Janela da taxa (s)' },
    meta: { type: 'int', min: 0, max: 1000000, step: 10, default: 0, label: 'Meta por turno (peças; 0 = sem)' },
    turnos: { type: 'text', default: PADRAO_TURNOS, max: 200, label: 'Turnos (nome hh:mm-hh:mm; …)' },
    paradaS: { type: 'int', min: 0, max: 3600, step: 5, default: 30, label: 'Alarme de parada após (s sem peça; 0 = desligado)' },
    taxaMin: { type: 'float', min: 0, max: 100000, step: 1, default: 0, label: 'Alarme taxa baixa (peças/min; 0 = desligado)' },
    taxaMax: { type: 'float', min: 0, max: 100000, step: 1, default: 0, label: 'Alarme taxa alta (peças/min; 0 = desligado)' },
    faixa: { type: 'bool', default: true, label: 'Faixa com total e taxa no vídeo' },
  },
  apply(src, p, state, ctx) {
    const M = motorEsteira();
    if (state.turnosTxt !== p.turnos) { state.turnosTxt = p.turnos; state.turnos = lerTurnos(p.turnos); }
    const mq = ctx.marcacoes;
    const temLinha = Boolean(mq && mq.itens.some((i) => i.funcao === 'cruzamento' && i.tipo === 'linha'));
    const temZona = Boolean(mq && mq.itens.some((i) => i.funcao === 'zona'));
    // tempo ativo: o do vídeo no arquivo; o do relógio ao vivo, parado com a fonte parada
    const f = tempoDaFonte();
    let dt = 0;
    if (f.video) {
      if (state.tv != null && f.t > state.tv && f.t - state.tv < 2) dt = f.t - state.tv;
      state.tv = f.t; state.tw = null;
    } else {
      const agora = performance.now() / 1000;
      if (state.tw != null && !ctx.fonteParada) dt = Math.min(1, agora - state.tw);
      state.tw = agora; state.tv = null;
    }
    const evs = ctx.cena && Array.isArray(ctx.cena.eventos) ? ctx.cena.eventos : [];
    const r = M.quadro(evs, p, dt, temLinha, state.turnos);
    publicar({
      t: performance.now(), W: ctx.w, H: ctx.h,
      dets: Array.isArray(ctx.detections) ? ctx.detections : [],
      itens: mq ? mq.itens : [], cena: ctx.cena || null, resumo: r, cfg: p, temLinha, temZona, video: f.video,
    });
    const fmt = (v, d = 1) => (fin(v) ? numBR(v, d, d) : '—');
    if (!ctx.cena) ctx.metrics['Contagem'] = 'coloque Zonas e linhas (cena.zonas) antes deste nó';
    else if (!temLinha && !temZona) ctx.metrics['Contagem'] = 'desenhe uma linha ou zona (Ferramentas de mouse)';
    else ctx.metrics['Contagem'] = `${r.total} peças · ${fmt(r.taxa)} /min · turno ${r.turno.nome} ${r.totalTurno}${r.meta ? '/' + r.meta : ''}`;
    if (p.faixa && !studioAberto()) {
      const al = r.alarmes.find((a) => a.estado !== 'RTN_NR');
      ctx.overlay.push({
        type: 'banner', x: 8, y: 8, color: al ? (al.prio === 1 ? '#FF5A5A' : '#F2A900') : '#8CE0C8',
        text: `CounterVision · ${r.total} peças · ida ${r.ida} · volta ${r.volta} · ${fmt(r.taxa)} peças/min · ${r.turno.nome} ${r.totalTurno}${r.meta ? '/' + r.meta : ''}${al ? ' · ' + al.tag : ''}`,
      });
    }
    return clone(src);
  },
};

export default [cor, onnx, rastreio, esteira];
