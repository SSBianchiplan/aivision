/**
 * components/video/reprodutor.js — o visor do GPlanSiS|Vídeo: reprodução da
 * TIMELINE (não do arquivo) com controle de quadro exato, e o recorte.
 *
 * O <video> toca a mídia original; quem decide o que aparece é a EDL:
 *
 *   parado     o playhead fica sempre no início de um quadro. Buscar o
 *              quadro q é pôr currentTime no MEIO dele (pts + dur/2): sem
 *              ambiguidade de arredondamento entre dois quadros vizinhos.
 *              Buscas seguidas (arrastar o playhead, J) são coalescidas —
 *              só a última pendente é feita.
 *   tocando    requestVideoFrameCallback diz qual quadro foi apresentado
 *              (metadata.mediaTime); dele sai a posição na timeline. Ao
 *              passar do fim de um clipe: o próximo clipe contíguo na mídia
 *              segue sem busca; senão, busca e continua; lacuna = preto,
 *              no relógio.
 *   J/K/L      L acelera (1×, 2×, 4×), J faz o mesmo para trás por buscas
 *              sucessivas (o <video> não toca de ré), K pausa.
 *
 * Calibração: o primeiro quadro apresentado com currentTime = 0 diz se o
 * relógio do elemento tem deslocamento em relação ao pts do índice
 * (midia.js) — MP4 sem edit list, por exemplo. O deslocamento entra em todas
 * as buscas.
 *
 * O canvas do visor mostra a SAÍDA (recorte, Ken Burns ou o reenquadramento
 * "Seguir sujeito" aplicados) ou, no modo recorte, o quadro inteiro com o
 * retângulo e as alças. No modo 'alvo' (Seguir sujeito: "clique no sujeito",
 * ou reposicionar um keyframe) mostra o quadro inteiro com o enquadramento
 * atual e o clique devolve o ponto normalizado em `aoAlvo(nx, ny)`.
 */
import { ordenar, fimClipe, clipeEm, quadroNoClipe, tempoDoQuadro, enquadramento, ajustarAoQuadro } from './edl.js';
import { quadroEm } from './midia.js';

const ALCA = 9;

/**
 * Chama `cb(meta)` a cada quadro apresentado pelo <video> enquanto ela
 * devolver true. Usa requestVideoFrameCallback; sem ele (Safari < 15.4,
 * Firefox antigo) cai para rAF + currentTime (meta.mediaTime = currentTime,
 * sem a garantia de quadro exato). Devolve uma função que para.
 */
export function seguirQuadros(el, cb) {
  let vivo = true;
  if ('requestVideoFrameCallback' in el) {
    const f = (agora, meta) => { if (vivo && cb(meta)) el.requestVideoFrameCallback(f); };
    el.requestVideoFrameCallback(f);
  } else {
    let ult = -1;
    const f = () => {
      if (!vivo) return;
      const t = el.currentTime;
      if (t !== ult) { ult = t; if (!cb({ mediaTime: t, aproximado: true })) return; }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }
  return () => { vivo = false; };
}

export class Reprodutor {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLCanvasElement} canvas
   * @param {object} cb  { obter(): {v, clipes, recorte, fps, entrada, saida, loop, modo, retEdicao, proporcao},
   *                       aoTempo(t, tocando), aoRet(ret, final), aoEstado() }
   */
  constructor(video, canvas, cb) {
    this.video = video;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = cb;
    this.t = 0;
    this.tocando = false;
    this.taxa = 1;
    this.desloc = 0;
    this.qAtual = -1;
    this.qMostrado = -1;
    this.alvoQ = -1;
    this.buscando = false;
    this.clipeAtual = null;
    this.lacuna = true;
    this.geracao = 0;
    this.arrasto = null;
    this.ro = new ResizeObserver(() => this.medir());
    this.ro.observe(canvas);
    this.medir();
    this.h_ = { down: (e) => this.down(e), move: (e) => this.move(e), up: (e) => this.up(e) };
    canvas.addEventListener('pointerdown', this.h_.down);
    canvas.addEventListener('pointermove', this.h_.move);
    canvas.addEventListener('pointerup', this.h_.up);
    canvas.addEventListener('pointercancel', this.h_.up);
  }

  destruir() {
    this.geracao++;
    this.tocando = false;
    this.ro.disconnect();
    try { this.video.pause(); } catch (_) { /* ok */ }
    const c = this.cv;
    c.removeEventListener('pointerdown', this.h_.down);
    c.removeEventListener('pointermove', this.h_.move);
    c.removeEventListener('pointerup', this.h_.up);
    c.removeEventListener('pointercancel', this.h_.up);
  }

  medir() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(10, r.width); this.h = Math.max(10, r.height);
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    this.desenhar();
  }

  get e() { return this.cb.obter(); }

  /** Tempo do elemento <video> para mostrar o quadro q. */
  tempoEl(q) {
    const v = this.e.v;
    return (v.pts[q] + (v.pts[q + 1] - v.pts[q]) / 2) / 1e6 + this.desloc;
  }

  /** Mede o deslocamento entre o relógio do <video> e o pts do índice. */
  async calibrar() {
    const v = this.e.v;
    const el = this.video;
    if (!('requestVideoFrameCallback' in el) || !v || v.sintetico) return;
    await new Promise((r) => { if (el.readyState >= 2) r(); else el.addEventListener('loadeddata', r, { once: true }); });
    // um quadro um pouco adiante do primeiro (o 1º pode ser o "meio quadro" que a edit list corta)
    const q0 = Math.min(v.n - 1, 2);
    const meta = await new Promise((r) => {
      const to = setTimeout(() => r(null), 1500);
      el.requestVideoFrameCallback((_, m) => { clearTimeout(to); r(m); });
      el.currentTime = (v.pts[q0] + (v.pts[q0 + 1] - v.pts[q0]) / 2) / 1e6;
    });
    this.desloc = 0;
    if (meta && Number.isFinite(meta.mediaTime)) {
      const m = meta.mediaTime;
      const quarto = (v.pts[q0 + 1] - v.pts[q0]) / 4e6;
      // Candidatos conhecidos: 0 (Chrome/ffmpeg: o 1º quadro inteiro da edit
      // list é o zero) e v.deslocAlt (Safari/QuickTime: o zero é o media_time
      // da edit list, até um quadro antes). Vale o que alinha o quadro que
      // apareceu com a grade do índice.
      const alinha = (c) => {
        for (let q = Math.max(0, q0 - 2); q <= Math.min(v.n - 1, q0 + 2); q++) if (Math.abs(m - (v.pts[q] / 1e6 + c)) < quarto) return true;
        return false;
      };
      if (alinha(0)) this.desloc = 0;
      else if (v.deslocAlt && alinha(v.deslocAlt)) this.desloc = v.deslocAlt;
      else {
        // nenhum: mede (só corrige diferenças grandes, mais que 1/4 de quadro)
        const d = m - v.pts[q0] / 1e6;
        this.desloc = Math.abs(d) > quarto ? d : 0;
      }
    }
    this.qAtual = -1;
  }

  /* ---------------------------------------------------------- busca */

  /** Mostra o instante t da timeline (parado). */
  irPara(t, { ajustar = true } = {}) {
    const e = this.e;
    if (!e.v) return;
    if (ajustar) t = ajustarAoQuadro(e.v, e.clipes, t, e.v.fps);
    this.t = Math.max(0, t);
    const c = clipeEm(e.v, e.clipes, this.t);
    this.clipeAtual = c;
    if (!c) { this.lacuna = true; this.desenhar(); return; }
    this.lacuna = false;
    this.buscar(quadroNoClipe(e.v, c, this.t));
  }

  buscar(q) {
    this.alvoQ = q;
    if (this.buscando) return;
    this.buscando = true;
    const g = this.geracao;
    const passo = () => {
      if (g !== this.geracao) { this.buscando = false; return; }
      if (this.alvoQ === this.qAtual && this.qMostrado === this.qAtual) { this.buscando = false; this.desenhar(); return; }
      const q2 = this.alvoQ;
      const el = this.video;
      let feito = false;
      const fim = () => {
        if (feito) return;
        feito = true;
        clearTimeout(to);
        el.removeEventListener('seeked', fim);
        this.qAtual = q2; this.qMostrado = q2;
        this.desenhar();
        passo();
      };
      const to = setTimeout(fim, 2500);
      el.addEventListener('seeked', fim);
      el.currentTime = this.tempoEl(q2);
    };
    passo();
  }

  /** Promessa que resolve quando a busca pendente termina. */
  async ocioso() {
    while (this.buscando) await new Promise((r) => setTimeout(r, 10));
  }

  /* ---------------------------------------------------------- reprodução */

  async tocar(taxa = 1) {
    const e = this.e;
    if (!e.v) return;
    this.geracao++;
    const g = this.geracao;
    this.buscando = false;
    this.taxa = taxa;
    this.tocando = true;
    this.cb.aoEstado();
    const fim = this.limiteFim();
    if (taxa > 0 && this.t >= fim - 1) this.t = this.limiteIni();
    if (taxa < 0) { this.reverso(g); return; }
    this.continuarEm(this.t, g);
  }

  limiteIni() { const e = this.e; return e.loop && e.entrada !== null ? e.entrada : 0; }
  limiteFim() {
    const e = this.e;
    const fimT = Math.max(...e.clipes.map((c) => fimClipe(e.v, c)), 0);
    return e.loop && e.saida !== null ? Math.min(e.saida, fimT) : fimT;
  }

  /** Começa (ou retoma) a reprodução no instante t. */
  async continuarEm(t, g) {
    const e = this.e;
    const el = this.video;
    this.t = t;
    const c = clipeEm(e.v, e.clipes, t);
    if (!c) { el.pause(); this.lacunaAte(t, g); return; }
    this.clipeAtual = c;
    this.lacuna = false;
    const q = quadroNoClipe(e.v, c, t);
    if (Math.abs(el.currentTime - this.tempoEl(q)) > 1e-3 || this.qAtual !== q) {
      await new Promise((r) => {
        const to = setTimeout(r, 2500);
        el.addEventListener('seeked', () => { clearTimeout(to); r(); }, { once: true });
        el.currentTime = this.tempoEl(q);
      });
      this.qAtual = q; this.qMostrado = q;
    }
    if (g !== this.geracao) return;
    el.playbackRate = Math.abs(this.taxa);
    el.play().catch((err) => {
      if (g !== this.geracao) return;
      // sem gesto do usuário o navegador não toca com som: segue mudo e avisa
      if (err && err.name === 'NotAllowedError' && !el.muted) {
        el.muted = true;
        if (this.cb.aoAviso) this.cb.aoAviso('O navegador bloqueou o som: tocando sem áudio (🔊 religa).');
        el.play().catch(() => this.pausar());
      } else this.pausar();
    });
    seguirQuadros(el, (meta) => {
      if (g !== this.geracao || !this.tocando) return false;
      this.aoQuadroApresentado(meta, g);
      return g === this.geracao && this.tocando && !el.paused;
    });
  }

  aoQuadroApresentado(meta, g) {
    const e = this.e;
    const v = e.v;
    const c = this.clipeAtual;
    if (!c) return;
    const ts = Math.round((meta.mediaTime - this.desloc) * 1e6);
    const q = quadroEm(v.pts, v.n, ts + 500);
    if (q < c.a) return;          // quadro velho, de antes da busca
    if (q >= c.b) { this.proximoClipe(c, g); return; }   // passou do fim do clipe
    this.qAtual = q; this.qMostrado = q;
    this.t = tempoDoQuadro(v, c, q);
    const fim = this.limiteFim();
    if (this.t >= fim) { this.chegouAoFim(g); return; }
    this.desenhar();
    this.cb.aoTempo(this.t, true);
  }

  proximoClipe(c, g) {
    const e = this.e;
    const v = e.v;
    const fimC = fimClipe(v, c);
    const ord = ordenar(e.clipes);
    const prox = ord.find((x) => x.em >= fimC - 1 && x.id !== c.id);
    if (fimC >= this.limiteFim() - 1 || !prox) { this.chegouAoFim(g); return; }
    const dq = 1e6 / v.fps;
    if (prox.em > fimC + dq / 2) { this.video.pause(); this.t = fimC; this.lacunaAte(fimC, g); return; }
    if (prox.a === c.b) { this.clipeAtual = prox; return; }   // contíguo na mídia: segue sem buscar
    this.video.pause();
    this.continuarEm(prox.em, g);
  }

  chegouAoFim(g) {
    const e = this.e;
    if (e.loop && e.entrada !== null) { this.continuarEm(this.limiteIni(), g); return; }
    this.pausar();
    this.irPara(this.limiteFim() - 1);
  }

  /** Lacuna na timeline: preto, avançando no relógio até o próximo clipe. */
  lacunaAte(t, g) {
    const e = this.e;
    this.lacuna = true;
    this.clipeAtual = null;
    this.desenhar();
    const prox = ordenar(e.clipes).find((x) => x.em > t);
    if (!prox) { this.chegouAoFim(g); return; }
    let ultimo = performance.now();
    const passo = (agora) => {
      if (g !== this.geracao || !this.tocando) return;
      this.t += (agora - ultimo) * 1000 * Math.abs(this.taxa);
      ultimo = agora;
      if (this.t >= prox.em) { this.continuarEm(prox.em, g); return; }
      if (this.t >= this.limiteFim()) { this.chegouAoFim(g); return; }
      this.cb.aoTempo(this.t, true);
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  /** Ré (J): o <video> não toca para trás — busca quadro a quadro no relógio. */
  reverso(g) {
    this.video.pause();
    let ultimo = performance.now();
    const passo = (agora) => {
      if (g !== this.geracao || !this.tocando) return;
      const dt = (agora - ultimo) * 1000;
      ultimo = agora;
      const ini = this.limiteIni();
      let t = this.t - dt * Math.abs(this.taxa);
      if (t <= ini) { t = ini; this.t = t; this.irPara(t); this.pausar(); return; }
      this.t = t;
      const e = this.e;
      const c = clipeEm(e.v, e.clipes, t);
      this.clipeAtual = c;
      this.lacuna = !c;
      if (c) this.buscar(quadroNoClipe(e.v, c, t)); else this.desenhar();
      this.cb.aoTempo(t, true);
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }

  pausar() {
    const estava = this.tocando;
    this.geracao++;
    this.tocando = false;
    this.buscando = false;
    this.video.pause();
    this.video.playbackRate = 1;
    const e = this.e;
    if (e.v) {
      // fica no início do quadro que está na tela
      const c = clipeEm(e.v, e.clipes, this.t);
      if (c && this.qMostrado >= c.a && this.qMostrado < c.b) this.t = tempoDoQuadro(e.v, c, this.qMostrado);
      else this.t = ajustarAoQuadro(e.v, e.clipes, this.t, e.v.fps);
      this.irPara(this.t, { ajustar: false });
    }
    if (estava) this.cb.aoEstado();
    this.cb.aoTempo(this.t, false);
  }

  /* ---------------------------------------------------------- desenho */

  /** Retângulo (CSS px) onde o quadro inteiro aparece no modo recorte. */
  areaQuadro() {
    const v = this.e.v;
    const vw = (v && v.largura) || this.video.videoWidth || 16, vh = (v && v.altura) || this.video.videoHeight || 9;
    const m = 14;
    const k = Math.min((this.w - 2 * m) / vw, (this.h - 2 * m) / vh);
    const fw = vw * k, fh = vh * k;
    return { x: (this.w - fw) / 2, y: (this.h - fh) / 2, w: fw, h: fh };
  }

  /**
   * Onde o quadro da mídia está no visor, em px do canvas, e o enquadramento mostrado (Ferramentas do
   * Studio: components/studio/FerramentasStudio.js — as marcações em 0–1 da mídia).
   */
  geometria() {
    const e = this.e;
    if (!e || !e.v) return null;
    const el = this.video;
    const vw = el.videoWidth || e.v.largura, vh = el.videoHeight || e.v.altura;
    if (!vw || !vh) return null;
    let ret = { x: 0, y: 0, w: 1, h: 1 }, a;
    if (e.modo === 'recorte' || e.modo === 'alvo') a = this.areaQuadro();
    else {
      const c = this.clipeAtual;
      ret = c && this.qMostrado >= 0 ? enquadramento(e.v, c, Math.min(c.b - 1, Math.max(c.a, this.qMostrado)), e.recorte) : e.recorte;
      const sw = ret.w * vw, sh = ret.h * vh, k = Math.min(this.w / sw, this.h / sh);
      a = { x: (this.w - sw * k) / 2, y: (this.h - sh * k) / 2, w: sw * k, h: sh * k };
    }
    const d = this.dpr || 1;
    return { ox: a.x * d, oy: a.y * d, dw: a.w * d, dh: a.h * d, dpr: d,
      vista: { W: vw, H: vh, sx: ret.x * vw, sy: ret.y * vh, sw: ret.w * vw, sh: ret.h * vh, fs: false, fd: false } };
  }

  desenhar() {
    const { ctx } = this;
    const e = this.e;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.w, this.h);
    if (!e.v) return;
    const el = this.video;
    const temQuadro = !this.lacuna && el.readyState >= 2;
    const vw = el.videoWidth || e.v.largura, vh = el.videoHeight || e.v.altura;
    if (e.modo === 'alvo') { this.desenharAlvo(temQuadro); return; }
    if (e.modo === 'recorte') {
      const a = this.areaQuadro();
      if (temQuadro) ctx.drawImage(el, a.x, a.y, a.w, a.h);
      const r = e.retEdicao;
      // escurece fora do retângulo
      ctx.fillStyle = 'rgba(0,0,0,.58)';
      const rx = a.x + r.x * a.w, ry = a.y + r.y * a.h, rw = r.w * a.w, rh = r.h * a.h;
      ctx.fillRect(a.x, a.y, a.w, ry - a.y);
      ctx.fillRect(a.x, ry + rh, a.w, a.y + a.h - ry - rh);
      ctx.fillRect(a.x, ry, rx - a.x, rh);
      ctx.fillRect(rx + rw, ry, a.x + a.w - rx - rw, rh);
      ctx.strokeStyle = '#FFD84D'; ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);
      // terços
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 3; i++) { ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); }
      ctx.stroke();
      ctx.fillStyle = '#FFD84D';
      for (const [hx, hy] of this.alcas(rx, ry, rw, rh)) ctx.fillRect(hx - 5, hy - 5, 10, 10);
      // tamanho em pixels da mídia
      ctx.font = '600 12px "IBM Plex Mono", ui-monospace, monospace';
      const txt = `${Math.round(r.w * vw)}×${Math.round(r.h * vh)}${e.rotuloEdicao ? ' · ' + e.rotuloEdicao : ''}`;
      const tw = ctx.measureText(txt).width;
      // dentro do retângulo, no canto de baixo (em cima, a barra do recorte cobriria)
      const ly = Math.min(ry + rh - 6, this.h - 6);
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(rx + 6, ly - 18, tw + 12, 20);
      ctx.fillStyle = '#FFD84D'; ctx.fillText(txt, rx + 12, ly - 3);
      return;
    }
    // saída: o enquadramento (recorte geral ou Ken Burns do clipe) ocupando o visor
    const c = this.clipeAtual;
    const ret = c && this.qMostrado >= 0 ? enquadramento(e.v, c, Math.min(c.b - 1, Math.max(c.a, this.qMostrado)), e.recorte) : e.recorte;
    const sw = ret.w * vw, sh = ret.h * vh;
    const k = Math.min(this.w / sw, this.h / sh);
    const dw = sw * k, dh = sh * k;
    const dx = (this.w - dw) / 2, dy = (this.h - dh) / 2;
    if (temQuadro) ctx.drawImage(el, ret.x * vw, ret.y * vh, sw, sh, dx, dy, dw, dh);
    else {
      ctx.fillStyle = '#0b0b0b'; ctx.fillRect(dx, dy, dw, dh);
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.lacuna ? 'lacuna (preto na exportação)' : 'carregando…', this.w / 2, this.h / 2);
      ctx.textAlign = 'start';
    }
  }

  /** Modo 'alvo': quadro inteiro, enquadramento atual escurecendo o resto, mira no ponteiro. */
  desenharAlvo(temQuadro) {
    const { ctx } = this;
    const e = this.e;
    const a = this.areaQuadro();
    if (temQuadro) ctx.drawImage(this.video, a.x, a.y, a.w, a.h);
    const c = this.clipeAtual;
    const r = c && this.qMostrado >= 0 ? enquadramento(e.v, c, Math.min(c.b - 1, Math.max(c.a, this.qMostrado)), e.recorte) : e.recorte;
    const rx = a.x + r.x * a.w, ry = a.y + r.y * a.h, rw = r.w * a.w, rh = r.h * a.h;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(a.x, a.y, a.w, ry - a.y);
    ctx.fillRect(a.x, ry + rh, a.w, a.y + a.h - ry - rh);
    ctx.fillRect(a.x, ry, rx - a.x, rh);
    ctx.fillRect(rx + rw, ry, a.x + a.w - rx - rw, rh);
    ctx.strokeStyle = 'rgba(255,216,77,.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.strokeRect(rx, ry, rw, rh); ctx.setLineDash([]);
    // caixas candidatas (pessoas detectadas no quadro), se houver
    if (Array.isArray(e.alvoCaixas)) {
      ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2;
      for (const b of e.alvoCaixas) ctx.strokeRect(a.x + b.x1 * a.w, a.y + b.y1 * a.h, (b.x2 - b.x1) * a.w, (b.y2 - b.y1) * a.h);
    }
    if (this.mira) {
      const { x, y } = this.mira;
      ctx.strokeStyle = '#FFD84D'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.moveTo(x - 22, y); ctx.lineTo(x - 6, y); ctx.moveTo(x + 6, y); ctx.lineTo(x + 22, y);
      ctx.moveTo(x, y - 22); ctx.lineTo(x, y - 6); ctx.moveTo(x, y + 6); ctx.lineTo(x, y + 22); ctx.stroke();
    }
    const txt = e.rotuloAlvo || 'Clique no sujeito';
    ctx.font = '600 13px "IBM Plex Sans", system-ui, sans-serif';
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(a.x + 10, a.y + a.h - 34, tw + 20, 24);
    ctx.fillStyle = '#FFD84D'; ctx.fillText(txt, a.x + 20, a.y + a.h - 17);
  }

  alcas(x, y, w, h) {
    return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
  }

  /* ---------------------------------------------------------- recorte (ponteiro) */

  pos(ev) { const r = this.cv.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }

  down(ev) {
    const e = this.e;
    if (e.modo === 'alvo' && e.v) {
      const { x, y } = this.pos(ev);
      const a = this.areaQuadro();
      const nx = (x - a.x) / a.w, ny = (y - a.y) / a.h;
      if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
      ev.preventDefault();
      if (this.cb.aoAlvo) this.cb.aoAlvo(nx, ny);
      return;
    }
    if (e.modo !== 'recorte' || !e.v) return;
    const { x, y } = this.pos(ev);
    const a = this.areaQuadro();
    const r = e.retEdicao;
    const rx = a.x + r.x * a.w, ry = a.y + r.y * a.h, rw = r.w * a.w, rh = r.h * a.h;
    const tol = ev.pointerType === 'touch' ? 18 : ALCA;
    const hs = this.alcas(rx, ry, rw, rh);
    let alca = -1;
    for (let i = 0; i < hs.length; i++) if (Math.abs(hs[i][0] - x) <= tol && Math.abs(hs[i][1] - y) <= tol) { alca = i; break; }
    const nx = (x - a.x) / a.w, ny = (y - a.y) / a.h;
    if (alca >= 0) this.arrasto = { tipo: 'alca', alca, r0: { ...r } };
    else if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) this.arrasto = { tipo: 'mover', nx, ny, r0: { ...r } };
    else if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) this.arrasto = { tipo: 'novo', nx, ny, r0: { ...r } };
    else return;
    try { this.cv.setPointerCapture(ev.pointerId); } catch (_) { /* ok */ }
    ev.preventDefault();
  }

  move(ev) {
    const e = this.e;
    if (e.modo === 'alvo') { this.cv.style.cursor = 'crosshair'; this.mira = this.pos(ev); this.desenhar(); return; }
    this.mira = null;
    if (e.modo !== 'recorte') { this.cv.style.cursor = ''; return; }
    const { x, y } = this.pos(ev);
    const a = this.areaQuadro();
    const nx = Math.min(1, Math.max(0, (x - a.x) / a.w)), ny = Math.min(1, Math.max(0, (y - a.y) / a.h));
    if (!this.arrasto) {
      const r = e.retEdicao;
      const rx = a.x + r.x * a.w, ry = a.y + r.y * a.h, rw = r.w * a.w, rh = r.h * a.h;
      const hs = this.alcas(rx, ry, rw, rh);
      const CUR = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];
      let cur = x >= rx && x <= rx + rw && y >= ry && y <= ry + rh ? 'move' : 'crosshair';
      for (let i = 0; i < hs.length; i++) if (Math.abs(hs[i][0] - x) <= ALCA && Math.abs(hs[i][1] - y) <= ALCA) cur = CUR[i];
      this.cv.style.cursor = cur;
      return;
    }
    const d = this.arrasto;
    const v = e.v;
    // proporção no espaço normalizado: (w·vw)/(h·vh) = p  →  w/h = p·vh/vw
    const pn = e.proporcao ? e.proporcao * v.altura / v.largura : null;
    const minW = 16 / v.largura, minH = 16 / v.altura;
    let r;
    if (d.tipo === 'mover') {
      r = { ...d.r0, x: d.r0.x + nx - d.nx, y: d.r0.y + ny - d.ny };
      r.x = Math.min(1 - r.w, Math.max(0, r.x)); r.y = Math.min(1 - r.h, Math.max(0, r.y));
    } else if (d.tipo === 'novo') {
      let w = Math.abs(nx - d.nx), h = Math.abs(ny - d.ny);
      if (pn) { if (w / h > pn) h = w / pn; else w = h * pn; }
      r = { x: nx < d.nx ? d.nx - w : d.nx, y: ny < d.ny ? d.ny - h : d.ny, w: Math.max(minW, w), h: Math.max(minH, h) };
      r = caber(r, pn);
    } else {
      const r0 = d.r0;
      let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
      const i = d.alca;
      const moveL = i === 0 || i === 6 || i === 7, moveR = i === 2 || i === 3 || i === 4;
      const moveT = i === 0 || i === 1 || i === 2, moveB = i === 4 || i === 5 || i === 6;
      if (moveL) x0 = Math.min(nx, x1 - minW);
      if (moveR) x1 = Math.max(nx, x0 + minW);
      if (moveT) y0 = Math.min(ny, y1 - minH);
      if (moveB) y1 = Math.max(ny, y0 + minH);
      if (pn) {
        let w = x1 - x0, h = y1 - y0;
        if (i === 1 || i === 5) w = h * pn;           // borda de cima/baixo: largura acompanha
        else if (i === 3 || i === 7) h = w / pn;      // laterais: altura acompanha
        else if (w / h > pn) h = w / pn; else w = h * pn;
        if (moveL) x0 = x1 - w; else if (moveR) x1 = x0 + w; else { const cx = (r0.x + r0.w / 2); x0 = cx - w / 2; x1 = cx + w / 2; }
        if (moveT) y0 = y1 - h; else if (moveB) y1 = y0 + h; else { const cy = (r0.y + r0.h / 2); y0 = cy - h / 2; y1 = cy + h / 2; }
      }
      r = caber({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, pn);
    }
    this.cb.aoRet(r, false);
  }

  up(ev) {
    if (!this.arrasto) return;
    try { this.cv.releasePointerCapture(ev.pointerId); } catch (_) { /* ok */ }
    this.arrasto = null;
    this.cb.aoRet(this.e.retEdicao, true);
  }
}

/** Mantém o retângulo dentro do quadro, preservando a proporção pedida. */
export function caber(r, pn) {
  let { x, y, w, h } = r;
  w = Math.min(w, 1); h = Math.min(h, 1);
  if (pn) {
    if (w / h > pn) w = h * pn; else h = w / pn;
    if (w > 1) { w = 1; h = w / pn; }
    if (h > 1) { h = 1; w = h * pn; }
  }
  x = Math.min(1 - w, Math.max(0, x));
  y = Math.min(1 - h, Math.max(0, y));
  return { x, y, w, h };
}

/** Maior retângulo da proporção pn (normalizada) centrado em r. */
export function ajustarProporcao(r, pn) {
  if (!pn) return r;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = r.w, h = r.h;
  if (w / h > pn) w = h * pn; else h = w / pn;
  // tenta crescer até o máximo que cabe no quadro mantendo o centro
  const k = Math.min(1 / w, 1 / h);
  if (r.w >= 0.999 || r.h >= 0.999) { w *= k; h *= k; }
  return caber({ x: cx - w / 2, y: cy - h / 2, w, h }, pn);
}
