/**
 * components/video/timeline.js — a timeline do GPlanSiS|Vídeo, num <canvas>.
 *
 *   régua      tempo (timecode), marcadores (M), faixa de entrada/saída (I/O);
 *              clicar/arrastar move o playhead
 *   V1         clipes com miniaturas (miniaturas.js), seleção, aparo nas
 *              bordas, arrastar para mover/reordenar, navalha
 *   keyframes  losangos na base da faixa V1 do clipe (reenquadramento
 *              "Seguir sujeito"): clique seleciona e leva o playhead,
 *              arrastar move no tempo (sem cruzar os vizinhos), ⌥/Alt+clique
 *              apaga (Delete apaga o selecionado, no StudioVideo)
 *   A1         forma de onda (onda.js) dos mesmos clipes
 *   rolagem    barra fina embaixo (arrastável)
 *
 * Zoom: Ctrl/⌘ + roda (ou pinça no trackpad/tela) em torno do ponteiro,
 * de "o vídeo inteiro" até ~80 px por quadro. Roda sem tecla rola na
 * horizontal.
 *
 * DESEMPENHO. O desenho só acontece quando algo muda (`pedir()` agenda um
 * rAF; vários pedidos no mesmo quadro viram um desenho). Em DUAS CAMADAS:
 * a base (régua, clipes, miniaturas, onda, marcadores) fica num canvas fora
 * da tela e só é refeita quando a vista ou a edição mudam; o playhead, que
 * anda a cada quadro tocando ou arrastando, é só "copiar a base + uma
 * linha" (`pedir(true)`). A forma de onda lê o nível da pirâmide de picos
 * (onda.js) adequado ao zoom: custo O(largura), qualquer duração. Cores do
 * tema são lidas uma vez e relidas só quando o tema troca.
 *
 * A edição em si (cortar, aparar, mover) é de edl.js: aqui só se calcula a
 * PRÉVIA durante o arrasto e, ao soltar, entrega a lista nova por
 * `aoAlterar(clipes, rotulo)` — uma entrada só no desfazer.
 */
import { fimClipe, quadroNoClipe, tempoDoQuadro, aparar, mover, keyframesVisiveis, moverKeyframe, apagarKeyframe } from './edl.js';
import { quadroEm } from './midia.js';
import { FATIAS_POR_S } from './onda.js';

const ROT = 46;          // coluna dos rótulos V1/A1
const REGUA = 26;
const GAP = 5;
const V1 = 60;
const A1 = 42;
const BARRA = 9;
const BORDA = 7;         // px de tolerância para pegar a borda de um clipe
const ENCAIXE = 8;       // px de atração do encaixe

const INTERVALOS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

export const ALTURA_TIMELINE = REGUA + GAP + V1 + GAP + A1 + GAP + BARRA + 2;

export class Timeline {
  constructor(canvas, cb) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;                 // { aoPlayhead(t, arrastando), aoSelecionar(set), aoAlterar(clipes, rotulo), aoCortar(t), aoVista() }
    this.e = { clipes: [], sel: new Set(), playhead: 0, marcadores: [], entrada: null, saida: null, ferramenta: 'selecao', encaixe: true };
    this.pxPorS = 50;
    this.inicio = 0;              // µs no canto esquerdo
    this.w = 300; this.h = ALTURA_TIMELINE;
    this.arrasto = null;
    this.previa = null;
    this.hover = null;
    this.ponteiros = new Map();
    this.cores = null;
    this.raf = 0;
    this.sujo = true;             // a camada de base precisa ser refeita
    this.base = document.createElement('canvas');
    this.bctx = this.base.getContext('2d');
    this.lerCores();
    this.obsTema = new MutationObserver(() => { this.lerCores(); this.pedir(); });
    this.obsTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.ro = new ResizeObserver(() => this.medir());
    this.ro.observe(canvas);
    this.medir();
    this.h_ = {
      down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e),
      wheel: (e) => this.roda(e), leave: () => { this.hover = null; this.pedir(); },
      dbl: (e) => this.duplo(e),
      // pinça do trackpad no Safari: gesturestart/gesturechange/gestureend (não vem como roda + Ctrl)
      gIni: (e) => { e.preventDefault(); if (!this.e.v) return; const r = this.cv.getBoundingClientRect(); this.gesto = { z0: this.pxPorS, t: this.tDe(Math.max(ROT, (e.clientX || r.left + r.width / 2) - r.left)) }; },
      gMuda: (e) => { e.preventDefault(); if (this.gesto && e.scale > 0) this.zoomPara(this.gesto.z0 * e.scale, this.gesto.t); },
      gFim: (e) => { e.preventDefault(); this.gesto = null; },
    };
    this.gesto = null;
    this.temGesto = typeof window.GestureEvent === 'function';
    canvas.addEventListener('pointerdown', this.h_.down);
    canvas.addEventListener('pointermove', this.h_.move);
    canvas.addEventListener('pointerup', this.h_.up);
    canvas.addEventListener('pointercancel', this.h_.up);
    canvas.addEventListener('pointerleave', this.h_.leave);
    canvas.addEventListener('wheel', this.h_.wheel, { passive: false });
    canvas.addEventListener('dblclick', this.h_.dbl);
    if (this.temGesto) {
      canvas.addEventListener('gesturestart', this.h_.gIni);
      canvas.addEventListener('gesturechange', this.h_.gMuda);
      canvas.addEventListener('gestureend', this.h_.gFim);
    }
  }

  destruir() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.obsTema.disconnect();
    const c = this.cv;
    c.removeEventListener('pointerdown', this.h_.down);
    c.removeEventListener('pointermove', this.h_.move);
    c.removeEventListener('pointerup', this.h_.up);
    c.removeEventListener('pointercancel', this.h_.up);
    c.removeEventListener('pointerleave', this.h_.leave);
    c.removeEventListener('wheel', this.h_.wheel);
    c.removeEventListener('dblclick', this.h_.dbl);
    if (this.temGesto) {
      c.removeEventListener('gesturestart', this.h_.gIni);
      c.removeEventListener('gesturechange', this.h_.gMuda);
      c.removeEventListener('gestureend', this.h_.gFim);
    }
  }

  lerCores() {
    const s = getComputedStyle(this.cv);
    const g = (n, pad) => (s.getPropertyValue(n) || '').trim() || pad;
    this.cores = {
      fundo: g('--vde-tl-fundo', '#022621'), trilha: g('--vde-tl-trilha', '#03342F'), linha: g('--vde-linha', 'rgba(255,255,255,.12)'),
      tinta: g('--vde-tinta', '#fff'), tinta3: g('--vde-tinta3', 'rgba(207,235,228,.62)'), acento: g('--vde-acento', '#FFD84D'),
      clipe: g('--vde-clipe', '#1F6F8B'), clipeA: g('--vde-clipe-audio', '#2E7D5B'), onda: g('--vde-onda', '#BFF3DA'),
      sel: g('--vde-sel', '#FFD84D'), playhead: g('--vde-playhead', '#FF5A4E'), io: g('--vde-io', 'rgba(255,216,77,.16)'),
      marcador: g('--vde-marcador', '#58B4FF'), regua: g('--vde-regua', '#012420'),
    };
  }

  medir() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(100, r.width);
    this.h = Math.max(60, r.height);
    this.cv.width = Math.round(this.w * dpr);
    this.cv.height = Math.round(this.h * dpr);
    this.base.width = this.cv.width;
    this.base.height = this.cv.height;
    this.dpr = dpr;
    this.sujo = true;
    this.limitar();
    this.pedir();
    if (this.cb.aoVista) this.cb.aoVista();
  }

  /* ---------------------------------------------------------- estado/vista */

  setEstado(p) {
    Object.assign(this.e, p);
    if (p.v && !this.vInit) { this.vInit = true; this.ajustar(); }
    // só o playhead mudou: não refaz a base
    let soCabeca = true;
    for (const k in p) if (k !== 'playhead') { soCabeca = false; break; }
    this.pedir(soCabeca);
  }

  get v() { return this.e.v; }
  get duracao() {
    const v = this.e.v;
    if (!v) return 1e6;
    let f = 0;
    for (const c of this.e.clipes) f = Math.max(f, fimClipe(v, c));
    return Math.max(f, 1e5);
  }
  get larguraUtil() { return Math.max(50, this.w - ROT - 12); }
  get zoomMin() { return this.larguraUtil / (this.duracao / 1e6) * 0.5; }
  get zoomMax() { return 80 * ((this.e.v && this.e.v.fps) || 30); }
  /** zoom 0..1 em escala logarítmica (para o slider) */
  get zoomNorm() { const a = Math.log(this.zoomMin), b = Math.log(this.zoomMax); return (Math.log(this.pxPorS) - a) / (b - a); }
  setZoomNorm(f, ancora) {
    const a = Math.log(this.zoomMin), b = Math.log(this.zoomMax);
    this.zoomPara(Math.exp(a + (b - a) * Math.min(1, Math.max(0, f))), ancora);
  }

  xDe(t) { return ROT + (t - this.inicio) / 1e6 * this.pxPorS; }
  tDe(x) { return this.inicio + (x - ROT) / this.pxPorS * 1e6; }

  limitar() {
    const visivel = this.larguraUtil / this.pxPorS * 1e6;
    const max = Math.max(0, this.duracao + visivel * 0.25 - visivel);
    this.inicio = Math.min(Math.max(0, this.inicio), max);
  }

  zoomPara(px, ancoraT) {
    const t = ancoraT !== undefined ? ancoraT : this.e.playhead;
    const x = this.xDe(t);
    this.pxPorS = Math.min(this.zoomMax, Math.max(this.zoomMin, px));
    this.inicio = t - (x - ROT) / this.pxPorS * 1e6;
    if (ancoraT === undefined && (x < ROT || x > this.w)) this.inicio = t - this.larguraUtil / 2 / this.pxPorS * 1e6;
    this.limitar();
    this.pedir();
    if (this.cb.aoVista) this.cb.aoVista();
  }

  /** Ajusta o zoom para o vídeo inteiro caber (⇧Z). */
  ajustar() {
    this.pxPorS = Math.max(1e-3, this.larguraUtil / (this.duracao / 1e6));
    this.inicio = 0;
    this.pedir();
    if (this.cb.aoVista) this.cb.aoVista();
  }

  /** Zoom de quadro: ~40 px por quadro em volta do playhead. */
  zoomQuadro() { this.zoomPara(40 * ((this.e.v && this.e.v.fps) || 30)); }

  /** Rola para manter o playhead visível (reprodução). */
  seguir(t) {
    const x = this.xDe(t);
    if (x < ROT || x > this.w - 20) {
      this.inicio = t - this.larguraUtil * 0.1 / this.pxPorS * 1e6;
      this.limitar();
      if (this.cb.aoVista) this.cb.aoVista();
      this.pedir();
      return;
    }
    this.pedir(true);
  }

  /** Agenda um desenho. `soCabeca`: só o playhead mudou (a base continua valendo). */
  pedir(soCabeca = false) {
    if (!soCabeca) this.sujo = true;
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.desenhar(); });
  }

  /* ---------------------------------------------------------- desenho */

  /** Desenha: refaz a base se precisar (ou se `forcar`) e põe o playhead por cima. */
  desenhar(forcar = false) {
    if (forcar) this.sujo = true;
    if (this.sujo) {
      const real = this.ctx;
      this.ctx = this.bctx;
      try { this.desenharBase(); } finally { this.ctx = real; }
      this.sujo = false;
    }
    const { ctx, e } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.base, 0, 0);
    if (!e.v) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const yB = REGUA + GAP + V1 + GAP + A1 + GAP;
    const xp = this.xDe(e.playhead);
    if (xp >= ROT - 1 && xp <= this.w + 1) {
      ctx.fillStyle = this.cores.playhead;
      ctx.fillRect(Math.round(xp) - 1, 0, 2, yB);
      ctx.beginPath(); ctx.moveTo(xp - 7, 0); ctx.lineTo(xp + 7, 0); ctx.lineTo(xp + 7, 8); ctx.lineTo(xp, 15); ctx.lineTo(xp - 7, 8); ctx.closePath(); ctx.fill();
    }
  }

  desenharBase() {
    const { ctx, cores: k, e } = this;
    const v = e.v;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = k.fundo;
    ctx.fillRect(0, 0, this.w, this.h);
    const yV = REGUA + GAP, yA = yV + V1 + GAP, yB = yA + A1 + GAP;
    // trilhas
    ctx.fillStyle = k.trilha;
    ctx.fillRect(ROT, yV, this.w - ROT, V1);
    ctx.fillRect(ROT, yA, this.w - ROT, A1);
    if (!v) { this.rotulos(yV, yA); return; }
    const clipes = this.previa || e.clipes;
    // faixa de entrada/saída
    if (e.entrada !== null || e.saida !== null) {
      const x0 = this.xDe(e.entrada !== null ? e.entrada : 0);
      const x1 = this.xDe(e.saida !== null ? e.saida : this.duracao);
      ctx.fillStyle = k.io;
      ctx.fillRect(Math.max(ROT, x0), 0, Math.max(0, Math.min(this.w, x1) - Math.max(ROT, x0)), yB);
    }
    // clipes
    const mini = this.cb.miniaturas && this.cb.miniaturas();
    if (mini) mini.esquecerPedidos();
    for (const c of clipes) this.clipe(c, yV, yA);
    // fantasma do arrasto de mover
    if (this.arrasto && this.arrasto.tipo === 'mover' && this.arrasto.ativo) {
      const c = this.arrasto.c;
      const x0 = this.xDe(this.arrasto.em), x1 = this.xDe(this.arrasto.em + v.pts[c.b] - v.pts[c.a]);
      ctx.strokeStyle = k.sel; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.strokeRect(x0 + 1, yV + 1, x1 - x0 - 2, V1 - 2);
      ctx.strokeRect(x0 + 1, yA + 1, x1 - x0 - 2, A1 - 2);
      ctx.setLineDash([]);
    }
    this.regua();
    // marcadores
    ctx.fillStyle = k.marcador;
    for (const m of e.marcadores) {
      const x = this.xDe(m);
      if (x < ROT - 6 || x > this.w + 6) continue;
      ctx.beginPath(); ctx.moveTo(x - 5, 2); ctx.lineTo(x + 5, 2); ctx.lineTo(x + 5, 10); ctx.lineTo(x, 15); ctx.lineTo(x - 5, 10); ctx.closePath(); ctx.fill();
      ctx.fillRect(x - 0.5, 15, 1, yB - 15);
    }
    // entrada / saída na régua
    ctx.fillStyle = k.acento;
    ctx.font = '700 10px "IBM Plex Mono", ui-monospace, monospace';
    if (e.entrada !== null) { const x = this.xDe(e.entrada); if (x >= ROT - 2) { ctx.fillRect(x, 0, 2, REGUA); ctx.fillText('I', x + 4, REGUA - 4); } }
    if (e.saida !== null) { const x = this.xDe(e.saida); if (x >= ROT - 2) { ctx.fillRect(x - 2, 0, 2, REGUA); ctx.fillText('O', x - 12, REGUA - 4); } }
    // navalha (prévia)
    if (e.ferramenta === 'navalha' && this.hover && this.hover.t !== undefined) {
      const x = this.xDe(this.hover.t);
      ctx.strokeStyle = k.tinta; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x + 0.5, yV); ctx.lineTo(x + 0.5, yA + A1); ctx.stroke(); ctx.setLineDash([]);
    }
    this.rotulos(yV, yA);
    // barra de rolagem
    const dur = this.duracao, vis = this.larguraUtil / this.pxPorS * 1e6;
    const tot = Math.max(dur, this.inicio + vis);
    const bx = ROT + (this.inicio / tot) * (this.w - ROT - 4);
    const bw = Math.max(24, (vis / tot) * (this.w - ROT - 4));
    ctx.fillStyle = k.linha;
    ctx.fillRect(ROT, yB, this.w - ROT, BARRA);
    ctx.fillStyle = k.tinta3;
    ctx.globalAlpha = 0.6;
    roundRect(ctx, bx, yB + 1, Math.min(bw, this.w - bx), BARRA - 2, 4); ctx.fill();
    ctx.globalAlpha = 1;
    this.barra = { y: yB, x: bx, w: bw, tot };
  }

  rotulos(yV, yA) {
    const { ctx, cores: k } = this;
    ctx.fillStyle = k.regua;
    ctx.fillRect(0, 0, ROT, this.h);
    ctx.fillStyle = k.tinta3;
    ctx.font = '700 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText('V1', 14, yV + V1 / 2 + 4);
    ctx.fillText('A1', 14, yA + A1 / 2 + 4);
    ctx.fillStyle = k.linha;
    ctx.fillRect(ROT - 1, 0, 1, this.h);
  }

  regua() {
    const { ctx, cores: k, e } = this;
    const fps = (e.v && e.v.fps) || 30;
    ctx.fillStyle = k.regua;
    ctx.fillRect(ROT, 0, this.w - ROT, REGUA);
    ctx.fillStyle = k.linha;
    ctx.fillRect(ROT, REGUA - 1, this.w - ROT, 1);
    // intervalo principal: o menor com pelo menos 90 px
    const pxQuadro = this.pxPorS / fps;
    let passoUs, emQuadros = false;
    const opQ = [1, 2, 5, 10];
    let achou = false;
    for (const q of opQ) if (q * pxQuadro >= 90 && q < fps) { passoUs = q * 1e6 / fps; emQuadros = true; achou = true; break; }
    if (!achou) { const s = INTERVALOS_S.find((x) => x * this.pxPorS >= 90) || 3600; passoUs = s * 1e6; }
    const sub = emQuadros ? Math.max(1, Math.round(passoUs * fps / 1e6)) : 5;
    const t0 = Math.floor(this.inicio / passoUs) * passoUs;
    const tFim = this.tDe(this.w);
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textBaseline = 'alphabetic';
    for (let t = t0; t <= tFim; t += passoUs) {
      const x = Math.round(this.xDe(t)) + 0.5;
      if (x >= ROT) {
        ctx.fillStyle = k.tinta3;
        ctx.fillRect(x - 0.5, 10, 1, REGUA - 10);
        ctx.fillStyle = k.tinta;
        ctx.fillText(rotuloTempo(t, fps, emQuadros || passoUs < 1e6), x + 3, 11);
      }
      // subdivisões
      ctx.fillStyle = k.linha;
      for (let i = 1; i < sub; i++) {
        const xs = Math.round(this.xDe(t + passoUs * i / sub));
        if (xs >= ROT) ctx.fillRect(xs, REGUA - 6, 1, 5);
      }
    }
  }

  clipe(c, yV, yA) {
    const { ctx, cores: k, e } = this;
    const v = e.v;
    const x0 = this.xDe(c.em), x1 = this.xDe(fimClipe(v, c));
    if (x1 < ROT || x0 > this.w) return;
    const xa = Math.max(ROT, x0), xb = Math.min(this.w, x1);
    const sel = e.sel.has(c.id);
    // vídeo
    ctx.save();
    ctx.beginPath(); roundRect(ctx, x0 + 0.5, yV + 0.5, Math.max(1, x1 - x0 - 1), V1 - 1, 5); ctx.clip();
    ctx.fillStyle = k.clipe;
    ctx.fillRect(xa, yV, xb - xa, V1);
    this.miniaturasClipe(c, x0, xa, xb, yV + 14, V1 - 15);
    // faixa de título
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(xa, yV, xb - xa, 14);
    ctx.fillStyle = '#fff';
    ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
    if (x1 - x0 > 50) ctx.fillText(`q${c.a}–${c.b - 1}${c.seg ? ' · SEGUIR' : c.kb ? ' · KB' : ''}`, Math.max(x0, ROT) + 5, yV + 10.5);
    ctx.restore();
    this.keyframesClipe(c, yV + V1 - 8);
    // áudio
    ctx.save();
    ctx.beginPath(); roundRect(ctx, x0 + 0.5, yA + 0.5, Math.max(1, x1 - x0 - 1), A1 - 1, 5); ctx.clip();
    ctx.fillStyle = k.clipeA;
    ctx.fillRect(xa, yA, xb - xa, A1);
    this.ondaClipe(c, x0, xa, xb, yA, A1);
    ctx.restore();
    // contorno
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeStyle = sel ? k.sel : 'rgba(0,0,0,.45)';
    roundRect(ctx, x0 + (sel ? 1 : 0.5), yV + (sel ? 1 : 0.5), Math.max(1, x1 - x0 - (sel ? 2 : 1)), V1 - (sel ? 2 : 1), 5); ctx.stroke();
    roundRect(ctx, x0 + (sel ? 1 : 0.5), yA + (sel ? 1 : 0.5), Math.max(1, x1 - x0 - (sel ? 2 : 1)), A1 - (sel ? 2 : 1), 5); ctx.stroke();
    // alças de aparo (hover)
    if (this.hover && this.hover.c && this.hover.c.id === c.id && this.hover.borda) {
      ctx.fillStyle = k.sel;
      const xb2 = this.hover.borda === 'a' ? x0 : x1 - 4;
      ctx.fillRect(xb2, yV, 4, V1);
      ctx.fillRect(xb2, yA, 4, A1);
    }
  }

  /** Losangos dos keyframes do reenquadramento, na faixa de título do clipe. */
  keyframesClipe(c, y) {
    const idx = keyframesVisiveis(c);
    if (!idx.length) return;
    const { ctx, cores: k, e } = this;
    const v = e.v;
    // linha fina ligando os keyframes: o trecho com reenquadramento
    const xs = idx.map((i) => this.xDe(tempoDoQuadro(v, c, c.seg.k[i][0])));
    ctx.strokeStyle = 'rgba(255,216,77,.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.max(ROT, xs[0]), y + 0.5); ctx.lineTo(Math.min(this.w, xs[xs.length - 1]), y + 0.5); ctx.stroke();
    const sel = e.kfSel && e.kfSel.id === c.id ? e.kfSel.i : -1;
    idx.forEach((i, j) => {
      const x = xs[j];
      if (x < ROT - 6 || x > this.w + 6) return;
      const r = i === sel ? 6 : 4.5;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.fillStyle = i === sel ? '#fff' : k.acento; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1; ctx.stroke();
    });
  }

  /** Keyframe sob (x, y), se houver: { c, i }. */
  acertarKeyframe(x, y) {
    const v = this.e.v;
    const yK = REGUA + GAP + V1 - 8;   // linha dos losangos (base da faixa V1)
    if (!v || y < yK - 9 || y > yK + 9) return null;
    let melhor = null, dist = 7;
    for (const c of this.e.clipes) {
      for (const i of keyframesVisiveis(c)) {
        const d = Math.abs(this.xDe(tempoDoQuadro(v, c, c.seg.k[i][0])) - x);
        if (d < dist) { dist = d; melhor = { c, i }; }
      }
    }
    return melhor;
  }

  miniaturasClipe(c, x0, xa, xb, y, h) {
    const mini = this.cb.miniaturas && this.cb.miniaturas();
    if (!mini) return;
    const v = this.e.v;
    const tw = Math.max(16, Math.round(h / mini.proporcao));
    // a grade das miniaturas é fixa no clipe (não "nada" ao rolar)
    const usPorPx = 1e6 / this.pxPorS;
    const i0 = Math.max(0, Math.floor((xa - x0) / tw));
    const usTile = tw * usPorPx;
    const passoQ = Math.max(1, usTile * v.fps / 1e6);
    for (let i = i0; ; i++) {
      const xt = x0 + i * tw;
      if (xt > xb) break;
      const ts = v.pts[c.a] + i * usTile;
      if (ts >= v.pts[c.b]) break;
      let q = quadroEm(v.pts, v.n, ts);
      q = Math.min(c.b - 1, Math.max(c.a, mini.alvo(q, passoQ)));
      const b = mini.obter(q);
      if (b) this.ctx.drawImage(b, xt, y, tw, h);
      else { this.ctx.fillStyle = 'rgba(0,0,0,.18)'; this.ctx.fillRect(xt + 1, y + 1, tw - 2, h - 2); }
    }
  }

  ondaClipe(c, x0, xa, xb, y, h) {
    const onda = this.cb.onda && this.cb.onda();
    if (!onda || !onda.temAudio) {
      if (onda && !onda.temAudio && xb - xa > 60) {
        this.ctx.fillStyle = 'rgba(255,255,255,.55)';
        this.ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
        this.ctx.fillText('sem áudio', xa + 6, y + h / 2 + 3);
      }
      return;
    }
    const v = this.e.v;
    const ctx = this.ctx;
    const meio = y + h / 2, amp = h / 2 - 3;
    // nível da pirâmide: no máximo ~8 valores lidos por pixel em qualquer zoom
    const { dados: p, fator } = onda.nivel(FATIAS_POR_S / this.pxPorS);
    const fatPorPx = FATIAS_POR_S / this.pxPorS / fator;
    const base = (v.pts[c.a] / 1e6) * FATIAS_POR_S / fator;
    const fimF = (v.pts[c.b] / 1e6) * FATIAS_POR_S / fator;
    ctx.fillStyle = this.cores.onda;
    ctx.globalAlpha = 0.85;
    for (let x = Math.floor(xa); x < xb; x++) {
      const f0 = base + (x - x0) * fatPorPx;
      if (f0 >= fimF) break;
      const f1 = Math.min(fimF, f0 + Math.max(1, fatPorPx));
      let m = 0;
      for (let f = Math.floor(f0); f < f1; f++) if (p[f] > m) m = p[f];
      if (m) { const a = (m / 255) * amp; ctx.fillRect(x, meio - a, 1, a * 2 || 1); }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(xa, meio, xb - xa, 1);
  }

  /* ---------------------------------------------------------- interação */

  zona(x, y) {
    const yV = REGUA + GAP, yA = yV + V1 + GAP, yB = yA + A1 + GAP;
    if (y < REGUA) return 'regua';
    if (y >= yB - 1) return 'barra';
    if (x < ROT) return 'rotulo';
    if (y >= yV && y < yA + A1) return 'trilha';
    return 'vazio';
  }

  acertar(x) {
    const v = this.e.v;
    if (!v) return null;
    const t = this.tDe(x);
    let melhor = null;
    for (const c of this.e.clipes) {
      const x0 = this.xDe(c.em), x1 = this.xDe(fimClipe(v, c));
      const larg = x1 - x0;
      const tol = Math.min(BORDA, larg / 3);
      if (x >= x0 - tol && x <= x0 + tol) melhor = { c, borda: 'a' };
      else if (x >= x1 - tol && x <= x1 + tol && !(melhor && melhor.borda === 'a')) melhor = { c, borda: 'b' };
      else if (!melhor && x > x0 && x < x1) melhor = { c, borda: null };
    }
    return melhor ? { ...melhor, t } : { c: null, t };
  }

  /** Atrai t para bordas de clipes, playhead, marcadores e entrada/saída. */
  encaixar(t, ignorar) {
    if (!this.e.encaixe) return t;
    const v = this.e.v;
    const tol = ENCAIXE / this.pxPorS * 1e6;
    let melhor = t, dist = tol;
    const tenta = (p) => { if (p === null || p === undefined) return; const d = Math.abs(p - t); if (d < dist) { dist = d; melhor = p; } };
    tenta(0); tenta(this.e.playhead); tenta(this.e.entrada); tenta(this.e.saida);
    for (const m of this.e.marcadores) tenta(m);
    for (const c of this.e.clipes) { if (ignorar && c.id === ignorar) continue; tenta(c.em); tenta(fimClipe(v, c)); }
    return melhor;
  }

  pos(e) {
    const r = this.cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  down(ev) {
    if (!this.e.v) return;
    const { x, y } = this.pos(ev);
    this.ponteiros.set(ev.pointerId, { x, y });
    try { this.cv.setPointerCapture(ev.pointerId); } catch (_) { /* ok */ }
    if (this.ponteiros.size === 2) {
      // pinça: zoom com dois dedos
      const [a, b] = [...this.ponteiros.values()];
      this.arrasto = { tipo: 'pinca', d0: Math.hypot(a.x - b.x, a.y - b.y), z0: this.pxPorS, t: this.tDe((a.x + b.x) / 2) };
      this.previa = null;
      return;
    }
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    const z = this.zona(x, y);
    if (z === 'regua' || z === 'rotulo') {
      this.arrasto = { tipo: 'playhead' };
      this.cb.aoPlayhead(this.tDe(Math.max(ROT, x)), true);
      return;
    }
    if (z === 'barra') {
      const b = this.barra;
      const dentro = b && x >= b.x && x <= b.x + b.w;
      if (!dentro && b) { this.inicio = ((x - ROT - b.w / 2) / (this.w - ROT - 4)) * b.tot; this.limitar(); this.pedir(); }
      this.arrasto = { tipo: 'rolar', x0: x, i0: this.inicio };
      return;
    }
    const kf = this.e.ferramenta !== 'navalha' ? this.acertarKeyframe(x, y) : null;
    if (kf) {
      const v = this.e.v;
      if (ev.altKey) { this.cb.aoAlterar(apagarKeyframe(this.e.clipes, kf.c.id, kf.i), 'Keyframe apagado'); this.arrasto = { tipo: 'nada' }; return; }
      if (this.cb.aoKeyframe) this.cb.aoKeyframe({ id: kf.c.id, i: kf.i });
      this.cb.aoPlayhead(tempoDoQuadro(v, kf.c, kf.c.seg.k[kf.i][0]), false);
      this.arrasto = { tipo: 'kf', c: kf.c, i: kf.i, x0: x, ativo: false };
      return;
    }
    const h = this.acertar(x);
    if (this.e.ferramenta === 'navalha') {
      if (h && h.c) this.cb.aoCortar(h.t);
      return;
    }
    if (!h || !h.c) {
      // vazio: limpa a seleção (e começa a arrastar o playhead, como na régua, no toque)
      if (!(ev.shiftKey || ev.ctrlKey || ev.metaKey)) this.cb.aoSelecionar(new Set());
      this.arrasto = { tipo: 'nada' };
      return;
    }
    const sel = new Set(this.e.sel);
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      if (sel.has(h.c.id)) sel.delete(h.c.id); else sel.add(h.c.id);
      this.cb.aoSelecionar(sel);
      this.arrasto = { tipo: 'nada' };
      return;
    }
    if (!sel.has(h.c.id)) this.cb.aoSelecionar(new Set([h.c.id]));
    if (h.borda) this.arrasto = { tipo: 'aparar', c: h.c, lado: h.borda, x0: x, ativo: false };
    else this.arrasto = { tipo: 'mover', c: h.c, x0: x, em: h.c.em, ativo: false, tPega: h.t - h.c.em };
  }

  move(ev) {
    const { x, y } = this.pos(ev);
    if (this.ponteiros.has(ev.pointerId)) this.ponteiros.set(ev.pointerId, { x, y });
    const a = this.arrasto;
    const v = this.e.v;
    if (!a) {
      // cursor conforme o que está embaixo
      if (!v) return;
      const z = this.zona(x, y);
      let cursor = 'default';
      let hover = null;
      if (z === 'regua' || z === 'rotulo') cursor = 'ew-resize';
      else if (z === 'trilha' && this.e.ferramenta !== 'navalha' && this.acertarKeyframe(x, y)) cursor = 'ew-resize';
      else if (z === 'trilha') {
        const h = this.acertar(x);
        hover = h;
        if (this.e.ferramenta === 'navalha') { cursor = 'crosshair'; if (h && h.c) hover = { ...h, t: tempoDoQuadro(v, h.c, quadroNoClipe(v, h.c, h.t)) }; }
        else if (h && h.c) cursor = h.borda ? 'col-resize' : 'grab';
      }
      this.cv.style.cursor = cursor;
      const mudou = (hover && hover.c && hover.c.id) !== (this.hover && this.hover.c && this.hover.c.id) ||
        (hover && hover.borda) !== (this.hover && this.hover.borda) || this.e.ferramenta === 'navalha';
      this.hover = hover;
      if (mudou) this.pedir();
      return;
    }
    if (a.tipo === 'pinca') {
      const [p1, p2] = [...this.ponteiros.values()];
      if (!p2) return;
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (a.d0 > 10) this.zoomPara(a.z0 * d / a.d0, a.t);
      return;
    }
    if (a.tipo === 'playhead') { this.cb.aoPlayhead(this.tDe(Math.max(ROT, x)), true); this.autoRolar(x); return; }
    if (a.tipo === 'kf') {
      if (!a.ativo && Math.abs(x - a.x0) < 3) return;
      a.ativo = true;
      const c = a.c;
      const t = Math.max(c.em, Math.min(fimClipe(v, c) - 1, this.tDe(x)));
      const q = quadroNoClipe(v, c, t);
      this.previa = moverKeyframe(this.e.clipes, c.id, a.i, q);
      const n = this.previa.find((k) => k.id === c.id);
      if (n && n.seg) this.cb.aoPlayhead(tempoDoQuadro(v, c, n.seg.k[a.i][0]), true);
      this.autoRolar(x);
      this.pedir();
      return;
    }
    if (a.tipo === 'rolar') {
      const b = this.barra;
      this.inicio = a.i0 + (x - a.x0) / (this.w - ROT - 4) * (b ? b.tot : this.duracao);
      this.limitar(); this.pedir();
      if (this.cb.aoVista) this.cb.aoVista();
      return;
    }
    if (a.tipo === 'aparar') {
      if (!a.ativo && Math.abs(x - a.x0) < 3) return;
      a.ativo = true;
      const c = a.c;
      let t = this.encaixar(this.tDe(x), c.id);
      // quadro da mídia correspondente à nova borda
      const alvo = v.pts[c.a] + (t - c.em);
      let q = quadroEm(v.pts, v.n, alvo + (1e6 / v.fps) / 2);
      if (alvo >= v.pts[v.n]) q = v.n;
      if (alvo <= v.pts[0]) q = 0;
      this.previa = aparar(v, this.e.clipes, c.id, a.lado, q, ev.shiftKey);
      const n = this.previa.find((k) => k.id === c.id);
      if (n) this.cb.aoPlayhead(a.lado === 'a' ? n.em : fimClipe(v, n) - (v.pts[n.b] - v.pts[n.b - 1]), true, true);
      this.autoRolar(x);
      this.pedir();
      return;
    }
    if (a.tipo === 'mover') {
      if (!a.ativo && Math.abs(x - a.x0) < 4) return;
      a.ativo = true;
      this.cv.style.cursor = 'grabbing';
      let em = this.tDe(x) - a.tPega;
      // encaixa pela borda esquerda ou pela direita, a que estiver mais perto
      const dur = v.pts[a.c.b] - v.pts[a.c.a];
      const e1 = this.encaixar(em, a.c.id), e2 = this.encaixar(em + dur, a.c.id) - dur;
      em = Math.abs(e1 - em) <= Math.abs(e2 - em) ? e1 : e2;
      a.em = Math.max(0, em);
      this.autoRolar(x);
      this.pedir();
    }
  }

  autoRolar(x) {
    const margem = 30;
    let d = 0;
    if (x < ROT + margem) d = -(ROT + margem - x);
    else if (x > this.w - margem) d = x - (this.w - margem);
    if (d) { this.inicio += d / this.pxPorS * 1e6 * 0.3; this.limitar(); this.pedir(); if (this.cb.aoVista) this.cb.aoVista(); }
  }

  up(ev) {
    this.ponteiros.delete(ev.pointerId);
    try { this.cv.releasePointerCapture(ev.pointerId); } catch (_) { /* ok */ }
    const a = this.arrasto;
    this.arrasto = null;
    if (!a) return;
    const v = this.e.v;
    if (a.tipo === 'playhead') this.cb.aoPlayhead(null, false);
    else if (a.tipo === 'kf' && a.ativo && this.previa) {
      const p = this.previa;
      this.previa = null;
      this.cb.aoAlterar(p, 'Keyframe movido');
    } else if (a.tipo === 'aparar' && a.ativo && this.previa) {
      const p = this.previa;
      this.previa = null;
      this.cb.aoAlterar(p, 'Aparar');
    } else if (a.tipo === 'mover' && a.ativo) {
      this.cb.aoAlterar(mover(v, this.e.clipes, a.c.id, a.em), 'Mover clipe');
    } else if (a.tipo === 'nada' && ev.pointerType !== 'mouse') {
      const { x } = this.pos(ev);
      this.cb.aoPlayhead(this.tDe(Math.max(ROT, x)), false);
    }
    this.previa = null;
    this.cv.style.cursor = '';
    this.pedir();
  }

  duplo(ev) {
    const { x, y } = this.pos(ev);
    if (this.zona(x, y) !== 'trilha') return;
    const h = this.acertar(x);
    if (h && h.c) this.cb.aoPlayhead(h.c.em, false);
  }

  roda(ev) {
    if (!this.e.v) return;
    ev.preventDefault();
    const { x } = this.pos(ev);
    if (ev.ctrlKey || ev.metaKey) {
      if (this.gesto) return;   // pinça do Safari já tratada pelos eventos de gesto
      const f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomPara(this.pxPorS * f, this.tDe(Math.max(ROT, x)));
      return;
    }
    const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
    this.inicio += (d * (ev.deltaMode === 1 ? 20 : 1)) / this.pxPorS * 1e6;
    this.limitar();
    this.pedir();
    if (this.cb.aoVista) this.cb.aoVista();
  }
}

function rotuloTempo(t, fps, comQuadro) {
  const f = Math.round(fps);
  const totalQ = Math.floor(t * fps / 1e6 + 1e-3);
  const s = Math.floor(totalQ / f), ff = totalQ % f;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const base = (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
  return comQuadro ? base + ':' + String(ff).padStart(2, '0') : base;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
