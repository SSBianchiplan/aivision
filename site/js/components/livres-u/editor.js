/**
 * components/livres-u/editor.js — o painel Aplicações (onda 2-d) conversando com
 * o editor GPlanSiS|Vídeo e lendo arquivos de vídeo:
 *
 *   arquivoDaFonte     o vídeo em arquivo que está na Fonte ({ blob, nome }) ou null
 *   abrirNoEditor      abre (ou reaproveita, se já aberto) a mídia e aplica `depois`
 *   marcadoresNoEditor instantes da MÍDIA (s) → marcadores na timeline (somados aos existentes)
 *   irNoEditor         abre e vai ao instante (s da mídia)
 *   trechosNoEditor    só os trechos [{t0,t1}] na timeline (melhores trechos)
 *   seguirNoEditor     trajetória da câmera de jogo → keyframes do «Seguir sujeito»
 *   varrerVideo        percorre um arquivo por busca (<video> oculto), um quadro a cada `passo` s
 *
 * Usa só a porta pública do editor (components/video/ponte.js) e funções puras
 * de seguir.js/edl.js (importadas, sem alterar nada).
 */
import { abrirEditorVideo } from '../video/ponte.js';
import { tempoNaTimeline, clipesDosTrechos } from '../../cv/runtime/livres-u/midia.js';

/** O arquivo de vídeo da Fonte (kind 'video' com URL blob:/http). */
const cacheBlob = new Map();   // url → Blob (o mesmo Blob: o editor reconhece a mídia já aberta)
export async function arquivoDaFonte(source) {
  const s = source && source.current;
  if (!s || s.kind !== 'video' || !s.url) return null;
  let blob = cacheBlob.get(s.url);
  if (!blob) { blob = await (await fetch(s.url)).blob(); cacheBlob.clear(); cacheBlob.set(s.url, blob); }
  // o mesmo nome que o editor usa em «Abrir o vídeo da Fonte» (a edição salva é reencontrada)
  return { blob, nome: 'video-da-fonte' };
}

export function abrirNoEditor(arq, depois) {
  abrirEditorVideo({ blob: arq.blob, nome: arq.nome, origem: 'aplicacoes', depois });
}

/** Marcadores (µs da timeline) para cada instante da mídia (s); mantém os que já existiam. */
export function marcadoresNoEditor(arq, temposS, rotulo = 'marcadores') {
  abrirNoEditor(arq, ({ v, clipes, marcadores }) => {
    const novos = [];
    for (const t of temposS) { const tt = tempoNaTimeline(v, clipes, t * 1e6); if (tt != null) novos.push(Math.round(tt)); }
    const tol = 1e6 / (v.fps || 30) / 2;
    const todos = [...marcadores];
    for (const m of novos) if (!todos.some((x) => Math.abs(x - m) < tol)) todos.push(m);
    todos.sort((a, b) => a - b);
    return { marcadores: todos, rotulo: `${novos.length} ${rotulo} no editor`, irPara: novos[0] };
  });
}

export function irNoEditor(arq, tS) {
  abrirNoEditor(arq, ({ v, clipes }) => {
    const tt = tempoNaTimeline(v, clipes, tS * 1e6);
    return { irPara: tt != null ? tt : tS * 1e6, rotulo: tt == null ? 'Esse instante foi cortado da edição atual' : null };
  });
}

/** Só os trechos na timeline (o resto sai); marcadores no início de cada um. Desfaz com Ctrl+Z no editor. */
export function trechosNoEditor(arq, trechos) {
  abrirNoEditor(arq, ({ v, novoId }) => {
    const clipes = clipesDosTrechos(v, trechos, novoId);
    return { clipes, marcadores: clipes.map((c) => c.em), rotulo: `${clipes.length} trecho(s) montados na timeline (Ctrl+Z desfaz)`, irPara: 0 };
  });
}

/**
 * Câmera de jogo: amostras [{t (s da mídia), cx, cy}] → keyframes do Seguir
 * sujeito em cada clipe, com a proporção pedida e o zoom.
 */
export async function seguirNoEditor(arq, amostras, prop = 16 / 9, zoom = 1.8, opcoes = {}) {
  const seg = await import('../video/seguir.js');
  const rep = await import('../video/reprodutor.js');
  abrirNoEditor(arq, ({ v, clipes }) => {
    const pn = (prop * v.altura) / v.largura;
    const max = rep.ajustarProporcao({ x: 0, y: 0, w: 1, h: 1 }, pn);
    const tam = { w: max.w / Math.max(1, zoom), h: max.h / Math.max(1, zoom) };
    let n = 0;
    const novos = clipes.map((c) => {
      const t0 = v.pts[c.a] / 1e6, t1 = v.pts[c.b] / 1e6;
      const am = amostras.filter((a) => a.t >= t0 - 0.5 && a.t <= t1 + 0.5);
      if (am.length < 3) return c;
      const r = seg.keyframesDaAnalise(v, c, am, tam, { ...seg.SUAVIZACAO_PADRAO, ...opcoes });
      if (!r || !r.k.length) return c;
      n += r.k.length;
      const x = { ...c, seg: { k: r.k, motor: 'jogo.camera', prop: 'jogo' } };
      delete x.kb;
      return x;
    });
    if (!n) return { rotulo: 'Sem amostras da câmera de jogo nesta mídia (toque o vídeo com o operador ligado).' };
    return { clipes: novos, recorte: { x: (1 - tam.w) / 2, y: (1 - tam.h) / 2, w: tam.w, h: tam.h }, rotulo: `Câmera de jogo: ${n} keyframes do Seguir sujeito` };
  });
}

/**
 * Percorre o vídeo `blob` de `passo` em `passo` segundos: aoQuadro(ImageData, t) (pode ser async).
 * o = { maxW, sinal: { cancelar }, progresso(f) }. Devolve a duração.
 */
export async function varrerVideo(blob, passo, aoQuadro, o = {}) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('não consegui ler o vídeo')); });
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0) throw new Error('vídeo sem duração conhecida');
    const maxW = o.maxW || 480, k = Math.min(1, maxW / v.videoWidth);
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(v.videoWidth * k)); cv.height = Math.max(2, Math.round(v.videoHeight * k));
    const g = cv.getContext('2d', { willReadFrequently: true });
    for (let t = 0; t < dur; t += passo) {
      if (o.sinal && o.sinal.cancelar) break;
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(dur - 0.001, t); });
      g.drawImage(v, 0, 0, cv.width, cv.height);
      await aoQuadro(g.getImageData(0, 0, cv.width, cv.height), v.currentTime);
      if (o.progresso) o.progresso(Math.min(1, t / dur));
    }
    return dur;
  } finally {
    v.removeAttribute('src'); v.load();
    URL.revokeObjectURL(url);
  }
}

/** Um quadro em resolução plena no instante t (s). */
export async function quadroEm(blob, t) {
  let out = null;
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('não consegui ler o vídeo')); });
    await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(v.duration - 0.001, Math.max(0, t)); });
    const cv = document.createElement('canvas');
    cv.width = v.videoWidth; cv.height = v.videoHeight;
    cv.getContext('2d').drawImage(v, 0, 0);
    out = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
  } finally { URL.revokeObjectURL(url); }
  return out;
}
