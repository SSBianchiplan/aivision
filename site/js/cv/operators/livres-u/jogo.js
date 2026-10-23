/**
 * cv/operators/livres-u/jogo.js — jogo.camera (CV-86, E1 Câmera de jogo amador).
 *
 * Uma câmera grande-angular fixa filma a quadra inteira; este operador acha o
 * centro da jogada (bola e jogadores do detector da cadeia — ou os da Quadra,
 * que passam pelo mesmo ctx.detections) e REENQUADRA ao vivo: o recorte segue
 * a jogada e é ampliado para o quadro inteiro (vai assim para a gravação).
 *
 * A suavização é a MESMA do «Seguir sujeito» do editor GPlanSiS|Vídeo
 * (components/video/seguir.js › suavizarTrajetoria: mediana, One Euro ida e
 * volta, câmera virtual com zona morta e limite de velocidade), importada sob
 * demanda e aplicada numa janela deslizante dos últimos segundos — sem mudar
 * nada no editor. Com a fonte em ARQUIVO, as amostras (tempo do vídeo, centro)
 * ficam guardadas e o painel aplica o reenquadramento no editor como keyframes
 * do Seguir sujeito (keyframesDaAnalise), para exportar em 16:9, 9:16 etc.
 */
import { alloc } from '../../core.js';
import { publicar, tempoDe, conferirGeracao } from '../../runtime/livres-u/canal.js';
import { listaTexto } from '../../runtime/opkit.js';
import { mediana } from '../../runtime/livres-u/imagem.js';

const G = 'CV-86';

let seguirMod = null, pedindo = false;
function carregarSeguir() {
  if (seguirMod || pedindo) return;
  pedindo = true;
  import('../../../components/video/seguir.js').then((m) => { seguirMod = m; }).catch((e) => { console.warn('[jogo.camera] seguir.js não carregou:', e && e.message); }).finally(() => { pedindo = false; });
}

/** Centro da jogada (0–1) a partir das detecções. */
export function alvoDaJogada(dets, o, mem) {
  const cb = o.classesBola, cj = o.classesJogador;
  const nome = (d) => String(d.name || '').toLowerCase();
  const bolas = dets.filter((d) => cb.some((c) => nome(d).includes(c)));
  const jog = dets.filter((d) => cj.some((c) => nome(d).includes(c)));
  let bola = null;
  if (bolas.length) {
    const ult = mem.bola;
    bolas.sort((a, b) => (ult ? Math.hypot((a.x1 + a.x2) / 2 - ult.x, (a.y1 + a.y2) / 2 - ult.y) - Math.hypot((b.x1 + b.x2) / 2 - ult.x, (b.y1 + b.y2) / 2 - ult.y) : (b.score || 0) - (a.score || 0)));
    bola = { x: (bolas[0].x1 + bolas[0].x2) / 2, y: (bolas[0].y1 + bolas[0].y2) / 2, t: o.t };
    mem.bola = bola;
  } else if (mem.bola && o.t - mem.bola.t < o.memoriaBolaS) bola = mem.bola;
  const js = jog.map((d) => ({ x: (d.x1 + d.x2) / 2, y: d.y1 + 0.55 * (d.y2 - d.y1) }));
  const mj = js.length ? { x: mediana(js.map((q) => q.x)), y: mediana(js.map((q) => q.y)) } : null;
  let spread = null;
  if (js.length >= 2) { const xs = js.map((q) => q.x).sort((a, b) => a - b); spread = xs[Math.floor(xs.length * 0.85)] - xs[Math.floor(xs.length * 0.15)]; }
  if (bola && mj) return { x: o.pesoBola * bola.x + (1 - o.pesoBola) * mj.x, y: o.pesoBola * bola.y + (1 - o.pesoBola) * mj.y, bola: true, spread };
  if (bola) return { x: bola.x, y: bola.y, bola: true, spread };
  if (mj) return { x: mj.x, y: mj.y, bola: false, spread };
  return null;
}

export const camera = {
  op: 'jogo.camera',
  label: 'Câmera de jogo (segue a jogada)',
  group: G,
  // reenquadrado, o quadro sai ampliado (pixels); senão só o retângulo da jogada por cima
  overlayOnly: (p) => !p.reenquadrar,
  desc: 'Reenquadramento automático ao vivo para jogo amador filmado com câmera fixa: o recorte segue a bola e os ' +
        'jogadores (detector antes na cadeia; com a Quadra, os mesmos) com a suavização do «Seguir sujeito» do editor. ' +
        'O quadro sai ampliado (gravável). Com vídeo em arquivo, o painel aplica a trajetória no editor GPlanSiS|Vídeo ' +
        'para exportar em 16:9 ou 9:16.',
  params: {
    classesBola: { type: 'text', default: 'bola, sports ball, ball', max: 120, label: 'Classes da bola' },
    classesJogador: { type: 'text', default: 'pessoa, jogador, person', max: 120, label: 'Classes dos jogadores' },
    pesoBola: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.65, label: 'Peso da bola no centro' },
    zoom: { type: 'float', min: 1, max: 4, step: 0.1, default: 1.8, label: 'Ampliação' },
    zoomAuto: { type: 'bool', default: true, label: 'Abrir quando os jogadores se espalham' },
    suavidade: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.6, label: 'Suavidade (como no Seguir sujeito)' },
    zonaMorta: { type: 'float', min: 0, max: 0.1, step: 0.005, default: 0.02, label: 'Zona morta (fração da largura)' },
    vMax: { type: 'float', min: 0.1, max: 3, step: 0.05, default: 0.7, label: 'Velocidade máx. (larguras/s)' },
    reenquadrar: { type: 'bool', default: true, label: 'Sair reenquadrado (senão, só o retângulo)' },
  },
  apply(src, p, state, ctx) {
    carregarSeguir();
    if (conferirGeracao('u_jogo', state) || !state.janela) { state.janela = []; state.gravadas = []; state.mem = {}; state.c = { x: 0.5, y: 0.5 }; state.z = p.zoom; }
    const { t, relogio } = tempoDe(ctx);
    if (state.tAnt != null && t < state.tAnt - 0.05) { state.janela = []; state.gravadas = state.gravadas.filter((a) => a.t < t); }
    const o = { classesBola: listaTexto(p.classesBola), classesJogador: listaTexto(p.classesJogador), pesoBola: p.pesoBola, t, memoriaBolaS: 1.0 };
    const alvo = alvoDaJogada(ctx.detections || [], o, state.mem);
    // tamanho do recorte (mesma proporção do quadro)
    let zAlvo = p.zoom;
    if (p.zoomAuto && alvo && alvo.spread != null) zAlvo = Math.max(1, Math.min(p.zoom, 1 / Math.max(0.05, alvo.spread * 1.5)));
    state.z += (zAlvo - state.z) * 0.03;
    const tam = { w: 1 / state.z, h: 1 / state.z };
    const novo = state.tAnt == null || t > state.tAnt + 1e-4;
    if (novo && !ctx.fonteParada) {
      state.janela.push({ t, cx: alvo ? alvo.x : NaN, cy: alvo ? alvo.y : NaN });
      while (state.janela.length && t - state.janela[0].t > 4) state.janela.shift();
      if (relogio === 'video' && alvo) { state.gravadas.push({ t, cx: alvo.x, cy: alvo.y }); if (state.gravadas.length > 120000) state.gravadas.shift(); }
      state.tAnt = t;
    }
    let c = null;
    if (seguirMod && state.janela.length >= 3) {
      const tr = seguirMod.suavizarTrajetoria(state.janela, tam, { suavidade: p.suavidade, zonaMorta: p.zonaMorta, vMax: p.vMax });
      if (tr) c = { x: tr[tr.length - 1].cx, y: tr[tr.length - 1].cy };
    }
    if (!c && alvo) { const k = 0.08; c = { x: state.c.x + (alvo.x - state.c.x) * k, y: state.c.y + (alvo.y - state.c.y) * k }; }
    if (c) state.c = c;
    const R = { x: Math.min(1 - tam.w, Math.max(0, state.c.x - tam.w / 2)), y: Math.min(1 - tam.h, Math.max(0, state.c.y - tam.h / 2)), w: tam.w, h: tam.h };
    publicar('u_jogo', { amostras: state.gravadas, n: state.gravadas.length, ret: R, relogio, suavizacao: seguirMod ? 'Seguir sujeito (editor)' : 'simples (carregando…)', bola: Boolean(alvo && alvo.bola) });
    const { w, h } = ctx;
    if (!p.reenquadrar) {
      ctx.overlay.push({ type: 'rect', x: R.x * w, y: R.y * h, w: R.w * w, h: R.h * h, color: '#FFD84D', label: alvo && alvo.bola ? 'jogada (bola)' : 'jogada' });
      const out = alloc(w, h); out.data.set(src.data); return out;
    }
    // amplia o recorte para o quadro inteiro (bilinear)
    const out = alloc(w, h), s = src.data, d = out.data;
    const x0 = R.x * w, y0 = R.y * h, kx = (R.w * w) / w, ky = (R.h * h) / h;
    for (let y = 0; y < h; y++) {
      const fy = Math.min(h - 1.001, y0 + (y + 0.5) * ky - 0.5), iy = Math.max(0, fy | 0), ty = Math.max(0, fy - iy);
      for (let x = 0; x < w; x++) {
        const fx = Math.min(w - 1.001, x0 + (x + 0.5) * kx - 0.5), ix = Math.max(0, fx | 0), tx = Math.max(0, fx - ix);
        const a = (iy * w + ix) * 4, b = a + 4, c2 = a + w * 4, e = c2 + 4, q = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) d[q + k] = (s[a + k] * (1 - tx) + s[b + k] * tx) * (1 - ty) + (s[c2 + k] * (1 - tx) + s[e + k] * tx) * ty;
        d[q + 3] = 255;
      }
    }
    // as caixas dos operadores anteriores não batem mais com a imagem ampliada
    ctx.overlay.length = 0;
    return out;
  },
};

export default [camera];
