/**
 * cv/operators/livres-d/olhos.js — CV-27 Olhos: íris, piscadas e sonolência.
 *
 * Tudo sai dos 478 pontos do Face Landmarker (10 deles são da íris, já
 * refinados pelo próprio modelo — não precisa do MediaPipe Iris à parte):
 *
 *   ÍRIS: centro = ponto 468/473, raio = média da distância às 4 bordas.
 *   OLHAR: posição da íris entre os cantos do olho (ver eyeMetrics). É a
 *     direção NA IMAGEM e aproximada: sem calibração, bom para "esquerda /
 *     centro / direita", não para dizer em que ponto da tela a pessoa olha.
 *   OLHO FECHADO: EAR (eye aspect ratio). Medido em fotos: olhos abertos
 *     0,22-0,34; fechados 0,02-0,03; piscando um olho só, a média cai a 0,17
 *     (por isso o limiar padrão é 0,15). Histerese de 15%
 *     para uma oscilação na borda não contar duas piscadas.
 *   PISCADA: fechou e reabriu em menos que o tempo de sonolência.
 *   SONOLÊNCIA: fechado continuamente por mais de N segundos (alerta em
 *     faixa vermelha) + PERCLOS, a fração do último minuto com olho fechado.
 *
 * TAXA DE AMOSTRAGEM IMPORTA. Uma piscada dura 100-400 ms; com a inferência a
 * 3 por segundo a maioria passa entre duas amostras. Para contar piscadas é
 * preciso ≥ 10 inferências/s (intervalo mín. 0 e um rosto só).
 *
 * Se "Malha do rosto" (CV-26) vier ANTES na cadeia, usa a malha dela
 * (ctx.faceMesh) e não roda modelo nenhum; senão roda a própria.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { eyeMetrics, MESH_ID, V_CENTRO, EAR_DIR, EAR_ESQ } from '../../runtime/livres-d/facemesh.js';
import { inferirMalha, linhas } from './rosto.js';
import * as C from '../../runtime/livres-d/facemesh-conexoes.js';

const G = 'CV-27';
const JANELA = 60000;   // 1 minuto

function copyOf(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

function olharTexto(m, p) {
  const h = m.h - 0.5, v = m.v - V_CENTRO;
  const lado = h < -p.limH ? 'esquerda' : h > p.limH ? 'direita' : '';
  const alt = v < -p.limV ? 'cima' : v > p.limV ? 'baixo' : '';
  return lado && alt ? lado + ' · ' + alt : lado || alt || 'centro';
}

/**
 * Atualiza a máquina de estados de piscada com UMA amostra nova (ear, t).
 * `s` guarda: fechado, tFechou, piscadas[], amostras[] (para o PERCLOS), t0.
 * Exportada para teste.
 */
export function amostraPiscada(s, ear, t, p) {
  if (!s.t0) s.t0 = t;
  s.amostras = (s.amostras || []).filter((a) => t - a.t < JANELA);
  s.piscadas = (s.piscadas || []).filter((x) => t - x < JANELA);
  if (!s.fechado && ear < p.limEar) {
    s.fechado = true;
    s.tFechou = t;
  } else if (s.fechado && ear > p.limEar * 1.15) {
    const dur = t - s.tFechou;
    if (dur < p.sonoSeg * 1000) s.piscadas.push(t);
    s.fechado = false;
    s.ultimaDur = dur;
  }
  s.amostras.push({ t, fechado: s.fechado });
  const decorrido = Math.min(JANELA, t - s.t0);
  const fech = s.amostras.filter((a) => a.fechado).length;
  return {
    fechado: s.fechado,
    fechadoMs: s.fechado ? t - s.tFechou : 0,
    sonolento: s.fechado && t - s.tFechou > p.sonoSeg * 1000,
    piscadas: s.piscadas.length,
    porMin: decorrido >= 10000 ? (s.piscadas.length * 60000) / decorrido : null,
    perclos: s.amostras.length ? fech / s.amostras.length : 0,
    decorrido,
  };
}

/** Polígono de N lados como linhas (o desenhista não tem círculo em coordenadas da imagem). */
function circulo(ctx, x, y, r, cor, n = 18) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI, b = ((i + 1) / n) * 2 * Math.PI;
    ctx.overlay.push({ type: 'line', x1: x + r * Math.cos(a), y1: y + r * Math.sin(a), x2: x + r * Math.cos(b), y2: y + r * Math.sin(b), color: cor, width: 1.6 });
  }
}

export const olhos = {
  op: 'olhos.iris',
  label: 'Olhos: íris, piscadas e sonolência',
  group: G,
  model: MESH_ID,
  needs: ['yunet'],
  overlayOnly: true,
  desc: 'Íris (centro e raio), direção aproximada do olhar, olho aberto/fechado pelo EAR, ' +
        'piscadas por minuto, PERCLOS e alerta de sonolência quando os olhos ficam fechados ' +
        'por mais de N segundos. Usa a malha do "Malha do rosto" se ele vier antes na cadeia.',
  params: {
    limEar: { type: 'float', min: 0.08, max: 0.35, step: 0.01, default: 0.15, label: 'EAR de olho fechado' },
    sonoSeg: { type: 'float', min: 0.5, max: 10, step: 0.5, default: 2, label: 'Sonolência após (s)' },
    limH: { type: 'float', min: 0.02, max: 0.3, step: 0.01, default: 0.08, label: 'Limiar olhar lateral' },
    limV: { type: 'float', min: 0.02, max: 0.3, step: 0.01, default: 0.06, label: 'Limiar olhar vertical' },
    iris: { type: 'bool', default: true, label: 'Desenhar íris e pálpebras' },
    conf: { type: 'float', min: 0.3, max: 0.99, step: 0.05, default: 0.7, label: 'Confiança do rosto' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 50, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    // malha de quem veio antes na cadeia, ou a própria
    const deFora = Array.isArray(ctx.faceMesh) ? ctx.faceMesh : null;
    let faces;
    if (deFora) {
      faces = deFora;
    } else {
      if (!ensure('yunet', state, ctx)) return clone(src);
      if (!ensure(MESH_ID, state, ctx)) return clone(src);
      const memo = state.memo || (state.memo = {});
      schedule(state, p.everyMs, () => ({ img: copyOf(src) }),
        ({ img }) => inferirMalha(img, memo, { conf: p.conf, max: 1, seguir: true }));
      faces = state.results || [];
    }

    const W = ctx.w, H = ctx.h;
    const s = state.piscada || (state.piscada = {});
    const f = faces[0];
    if (!f) {
      // sem rosto: não dá para dizer que o olho está fechado — zera a piscada em curso
      s.fechado = false;
      ctx.metrics['olhos'] = 'sem rosto';
      return clone(src);
    }

    // métricas em pixels do quadro (a malha publicada é normalizada)
    const P = f.pts.map((q) => ({ x: q.x * W, y: q.y * H }));
    const m = eyeMetrics(P);
    // uma amostra por inferência, não por quadro: o mesmo resultado desenhado
    // em 5 quadros não pode contar como 5 amostras
    if (f.seq !== s.ultimoSeq) {
      s.ultimoSeq = f.seq;
      s.est = amostraPiscada(s, m.ear, f.t, p);
    }
    const e = s.est || { fechado: false, sonolento: false, piscadas: 0, porMin: null, perclos: 0, fechadoMs: 0, decorrido: 0 };

    if (p.iris) {
      const cor = e.fechado ? '#f87171' : '#4ade80';
      linhas(ctx, P, C.OLHO_DIR, cor, 1.4);
      linhas(ctx, P, C.OLHO_ESQ, cor, 1.4);
      if (!e.fechado) {
        for (const o of [m.dir, m.esq]) {
          circulo(ctx, o.iris.x, o.iris.y, o.iris.r, '#22d3ee');
          ctx.overlay.push({ type: 'point', x: o.iris.x, y: o.iris.y, r: 2, color: '#FFD84D' });
        }
      }
    }

    const olhar = e.fechado ? 'olhos fechados' : olharTexto(m, p);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const i of [...EAR_DIR, ...EAR_ESQ, 70, 300]) {
      const q = P[i];
      if (q.x < x1) x1 = q.x; if (q.x > x2) x2 = q.x;
      if (q.y < y1) y1 = q.y; if (q.y > y2) y2 = q.y;
    }
    ctx.overlay.push({
      type: 'rect', x: x1 - 6, y: y1 - 6, w: x2 - x1 + 12, h: y2 - y1 + 12,
      color: e.sonolento ? '#f87171' : e.fechado ? '#fbbf24' : '#4ade80',
      label: `EAR ${m.ear.toFixed(2)} · ${olhar}`,
    });
    if (e.sonolento) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#f87171', text: `⚠ SONOLÊNCIA — olhos fechados há ${(e.fechadoMs / 1000).toFixed(1)} s` });
    }

    ctx.metrics['EAR'] = `${m.ear.toFixed(3)} (d ${m.dir.ear.toFixed(2)} · e ${m.esq.ear.toFixed(2)})`;
    ctx.metrics['olhos'] = e.fechado ? 'fechados' : 'abertos';
    ctx.metrics['olhar'] = olhar;
    ctx.metrics['íris raio px'] = ((m.dir.iris.r + m.esq.iris.r) / 2).toFixed(1);
    ctx.metrics['piscadas/min'] = e.porMin === null
      ? `${e.piscadas} em ${(e.decorrido / 1000).toFixed(0)} s`
      : e.porMin.toFixed(0);
    ctx.metrics['PERCLOS'] = (e.perclos * 100).toFixed(0) + '%';
    ctx.metrics['sonolência'] = e.sonolento ? 'ALERTA' : 'não';
    if (!deFora && state.inferMs) ctx.metrics['olhos ms'] = state.inferMs.toFixed(0);
    if (!deFora && state.error) ctx.metrics['olhos erro'] = state.error;
    return clone(src);
  },
};

export default [olhos];
