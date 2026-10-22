/**
 * cv/runtime/livres-j/sessao.js — a "súmula" de uma partida (CV-35).
 *
 * Recebe, a cada inferência nova, os jogadores (id, caixa, ponto do pé na
 * imagem, posição em metros quando a quadra está calibrada, cor do tronco
 * em Lab) e a bola, e acumula:
 *
 *   jogadores  distância (m), velocidade atual/máxima (km/h), tempo por zona,
 *              mapa de calor, time (cor do uniforme ou lado da quadra)
 *   times      k-means em Lab sobre a cor média de cada jogador: 2 times e,
 *              quando há um grupo pequeno e bem separado, "outros"
 *              (árbitro, goleiro de outra cor)
 *   bola       trajetória, velocidade (projeção no chão), quiques dentro/fora,
 *              rally (golpes/travessias da rede), posse por proximidade,
 *              passes e perdas, arremessos e cestas (com o aro marcado)
 *
 * Tudo puro (sem DOM): o operador alimenta, o painel e a exportação leem
 * `retrato()`. Tempos em ms (performance.now()).
 */
import { ESPORTES, dentroDaQuadra, distanciaBorda } from './quadras.js';

// ------------------------------------------------------------ cor do uniforme

function srgbLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
const LIN = new Float32Array(256).map((_, i) => srgbLin(i));
export function rgbParaLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B,
    Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function labParaHex([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const g = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = g(fx) * 0.95047, Y = g(fy), Z = g(fz) * 1.08883;
  const lin = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z];
  return '#' + lin.map((c) => {
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, s)) * 255).toString(16).padStart(2, '0');
  }).join('');
}

/**
 * Cor do tronco: miolo da caixa (25–75 % na largura, 15–50 % na altura),
 * sem o verde do gramado. Média em Lab de até ~200 pixels. img = ImageData.
 * Devolve [L, a, b] ou null.
 */
export function corTronco(img, box) {
  const W = img.width, H = img.height, d = img.data;
  const bw = (box.x2 - box.x1) * W, bh = (box.y2 - box.y1) * H;
  const x0 = Math.round(box.x1 * W + bw * 0.25), x1 = Math.round(box.x1 * W + bw * 0.75);
  const y0 = Math.round(box.y1 * H + bh * 0.15), y1 = Math.round(box.y1 * H + bh * 0.5);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  const passo = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 200)));
  let sL = 0, sa = 0, sb = 0, n = 0;
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y += passo) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += passo) {
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      // verde do gramado: g domina com saturação razoável
      if (g === mx && mx - mn > 0.22 * mx && mx > 40 && g > r * 1.08 && g > b * 1.05) continue;
      const lab = rgbParaLab(r, g, b);
      sL += lab[0]; sa += lab[1]; sb += lab[2]; n++;
    }
  }
  return n >= 6 ? [sL / n, sa / n, sb / n] : null;
}
/** Distância entre cores, com a luminância pesando metade (sombra e luz mudam L, não o tom). */
const dCor = (p, q) => Math.hypot(0.5 * (p[0] - q[0]), p[1] - q[1], p[2] - q[2]);

/** k-means determinístico (semente: ponto mais distante), k pequeno. */
export function kmeans(P, k, iter = 12) {
  if (P.length < k) return null;
  const c = [P.reduce((m, p) => (p[0] > m[0] ? p : m), P[0]).slice()];
  while (c.length < k) {
    let melhor = null, dm = -1;
    for (const p of P) { const d = Math.min(...c.map((q) => dCor(p, q))); if (d > dm) { dm = d; melhor = p; } }
    c.push(melhor.slice());
  }
  let rot = new Array(P.length).fill(0);
  for (let it = 0; it < iter; it++) {
    rot = P.map((p) => { let b = 0, bd = Infinity; c.forEach((q, j) => { const d = dCor(p, q); if (d < bd) { bd = d; b = j; } }); return b; });
    for (let j = 0; j < k; j++) {
      const m = P.filter((_, i) => rot[i] === j);
      if (m.length) c[j] = [0, 1, 2].map((e) => m.reduce((s, p) => s + p[e], 0) / m.length);
    }
  }
  const inercia = P.reduce((s, p, i) => s + dCor(p, c[rot[i]]) ** 2, 0);
  const tam = c.map((_, j) => rot.filter((r) => r === j).length);
  return { c, rot, inercia, tam };
}

/** A bola (u, v) está na caixa de algum jogador, alargada (raquete, braço, pé)? */
function pertoDeJogador(b, vivos) {
  return vivos.some((j) => j && j.box && b.u > j.box.x1 - 0.35 * (j.box.x2 - j.box.x1) && b.u < j.box.x2 + 0.35 * (j.box.x2 - j.box.x1) &&
    b.v > j.box.y1 - 0.2 * (j.box.y2 - j.box.y1) && b.v < j.box.y2 + 0.05 * (j.box.y2 - j.box.y1));
}

// ------------------------------------------------------------ sessão

const ROTULO_TIME = { A: 'Time A', B: 'Time B', O: 'Outros' };
const COR_PADRAO = { A: '#22d3ee', B: '#f472b6', O: '#a3a3a3' };

export class Sessao {
  constructor() { this.zerar(); }

  zerar() {
    this.t0 = null; this.tUlt = null; this.atualizacoes = 0; this.comBola = 0;
    this.jogadores = new Map();
    this.times = { centros: null, cores: { ...COR_PADRAO }, uniformes: {}, modo: 'cor' };
    this.calorTime = {};
    this.bola = { traj: [], ult: null, vAtual: null, vMax: 0 };
    this.quiques = [];
    this.rally = { ativo: false, inicio: 0, golpes: 0, quiques: 0, dir: 0, ext: null, lado: null, toques: 0 };
    this.rallies = [];
    this.posse = { dono: null, time: null, cand: null, candN: 0, tDono: 0, tempo: { A: 0, B: 0 }, passes: { A: 0, B: 0 }, perdas: { A: 0, B: 0 } };
    this.aros = [];
    this.arremessos = { tent: 0, cestas: 0 };
    this.eventos = [];
    this.grade = null;
  }

  evento(t, tipo, texto, extra = {}) {
    this.eventos.push({ t, s: this.t0 != null ? (t - this.t0) / 1000 : 0, tipo, texto, ...extra });
    if (this.eventos.length > 400) this.eventos.shift();
  }

  /**
   * obs = { jogadores: [{ id, box, pe:[u,v], P:[x,y]|null, lab|null }], bolas: [{ u, v, P, score }] }
   * cfg = { esporte, L, W, calibrada, times, raioPosse, aros:[[u,v]], aroR, aspecto, duplas, fimRallyS }
   */
  atualizar(t, obs, cfg) {
    const esp = ESPORTES[cfg.esporte] || ESPORTES.futebol;
    if (this.t0 == null) this.t0 = t;
    const dt = this.tUlt == null ? 0 : Math.min(1, (t - this.tUlt) / 1000);
    this.tUlt = t; this.atualizacoes++; this.esporte = cfg.esporte;
    const { L, W } = cfg;
    if (!this.grade || this.grade.L !== L || this.grade.W !== W) {
      const gx = 24, gy = Math.max(8, Math.round((24 * W) / L));
      this.grade = { L, W, gx, gy };
      this.calorTime = {};
      for (const j of this.jogadores.values()) j.calor = null;
    }
    const { gx, gy } = this.grade;

    // ---------------- jogadores
    for (const o of obs.jogadores) {
      let j = this.jogadores.get(o.id);
      if (!j) {
        j = { id: o.id, primeiro: t, ultimo: t, tempo: 0, dist: 0, vAtual: null, vMax: 0, hist: [], suave: null, ancora: null,
          zonas: {}, calor: null, lab: null, nCor: 0, votos: { A: 0, B: 0, O: 0 }, time: null, posseS: 0, passes: 0, arremessos: 0, cestas: 0 };
        this.jogadores.set(o.id, j);
      }
      const dtj = Math.min(dt, (t - j.ultimo) / 1000 || dt);
      j.ultimo = t; j.box = o.box; j.pe = o.pe; j.P = o.P;
      if (o.lab) {
        j.nCor++;
        const a = j.nCor < 5 ? 1 / j.nCor : 0.2;
        j.lab = j.lab ? j.lab.map((v, i) => v + a * (o.lab[i] - v)) : o.lab.slice();
      }
      // posição para o radar: metros (calibrada) ou a própria imagem esticada na quadra
      const R = o.P || [o.pe[0] * L, o.pe[1] * W];
      j.R = R;
      if (dtj > 0) {
        j.tempo += dtj;
        const z = cfg.calibrada ? (dentroDaQuadra(R[0], R[1], L, W, 0.5) ? esp.zona(R[0], R[1], L, W) : 'fora') : null;
        if (z) j.zonas[z] = (j.zonas[z] || 0) + dtj;
        const ix = Math.min(gx - 1, Math.max(0, Math.floor((R[0] / L) * gx))), iy = Math.min(gy - 1, Math.max(0, Math.floor((R[1] / W) * gy)));
        if (!j.calor) j.calor = new Float32Array(gx * gy);
        j.calor[iy * gx + ix] += dtj;
      }
      if (o.P) this.mover(j, t, o.P, esp, cfg);
    }

    // ---------------- times
    this.separarTimes(cfg, esp);
    for (const j of this.jogadores.values()) {
      if (j.ultimo !== t || !j.time || !j.calor) continue;
      const c = this.calorTime[j.time] || (this.calorTime[j.time] = new Float32Array(gx * gy));
      const ix = Math.min(gx - 1, Math.max(0, Math.floor((j.R[0] / L) * gx))), iy = Math.min(gy - 1, Math.max(0, Math.floor((j.R[1] / W) * gy)));
      c[iy * gx + ix] += dt;
    }

    // ---------------- bola
    const b = this.escolherBola(t, obs.bolas || []);
    const vivos = obs.jogadores.map((o) => this.jogadores.get(o.id));
    if (b) {
      this.comBola++;
      const ant = this.bola.ult;
      const s = { t, u: b.u, v: b.v, P: b.P || null };
      this.bola.traj.push(s);
      while (this.bola.traj.length && t - this.bola.traj[0].t > 4000) this.bola.traj.shift();
      this.bola.ult = s;
      if (pertoDeJogador(s, vivos)) this.bola.tPerto = t;
      this.velocidadeBola(t);
      if (esp.quique || esp.rede) this.quiqueEGolpe(t, vivos, cfg, esp);
      if (esp.rally) this.contarRally(t, s, ant, cfg, esp);
      if (esp.arremessos && cfg.aros && cfg.aros.length) this.arremesso(t, s, ant, cfg);
    }
    if (esp.rally && this.rally.ativo && (!this.bola.ult || t - this.bola.ult.t > (cfg.fimRallyS || 2.5) * 1000)) this.fecharRally(t, 'bola sumiu');
    if (esp.posse) this.atualizarPosse(t, dt, b, vivos, cfg, esp);

    // esquece quem sumiu há muito (o histórico fica para a exportação)
    for (const j of this.jogadores.values()) if (t - j.ultimo > 1500) { j.vAtual = null; j.suave = null; j.ancora = null; j.hist = []; }
  }

  /** Distância com zona morta (tremor do pé na caixa não vira quilômetros) e velocidade em janela de ~1 s. */
  mover(j, t, P, esp, cfg) {
    const tau = 0.25;
    if (!j.suave || t - j.tP > 1500) { j.suave = P.slice(); j.ancora = P.slice(); j.tP = t; j.hist = [[t, P[0], P[1]]]; return; }
    const dt = (t - j.tP) / 1000; j.tP = t;
    // salto impossível (troca de ID, pé mal projetado): recomeça sem somar distância
    const salto = Math.hypot(P[0] - j.suave[0], P[1] - j.suave[1]);
    if (dt > 0 && salto / dt > esp.vMax * 1.6 + 2) { j.suave = P.slice(); j.ancora = P.slice(); j.hist = [[t, P[0], P[1]]]; j.saltos = (j.saltos || 0) + 1; return; }
    const a = 1 - Math.exp(-dt / tau);
    j.suave = [j.suave[0] + a * (P[0] - j.suave[0]), j.suave[1] + a * (P[1] - j.suave[1])];
    const d = Math.hypot(j.suave[0] - j.ancora[0], j.suave[1] - j.ancora[1]);
    const zonaMorta = cfg.zonaMorta != null ? cfg.zonaMorta : 0.35;
    if (d > zonaMorta) { j.dist += d; j.ancora = j.suave.slice(); }
    j.hist.push([t, j.suave[0], j.suave[1]]);
    while (j.hist.length > 2 && t - j.hist[0][0] > 1000) j.hist.shift();
    const h0 = j.hist[0], tj = (t - h0[0]) / 1000;
    if (tj >= 0.5) {
      const v = (Math.hypot(j.suave[0] - h0[1], j.suave[1] - h0[2]) / tj) * 3.6;
      j.vAtual = v;
      // máxima SUSTENTADA: o mínimo das últimas 3 leituras (um pico de ruído não vira recorde)
      j.vs = (j.vs || []).concat(v).slice(-3);
      const sust = j.vs.length === 3 ? Math.min(...j.vs) : 0;
      if (sust <= esp.vMax * 3.6 && sust > j.vMax) j.vMax = sust;
    }
  }

  separarTimes(cfg, esp) {
    const modo = cfg.times === 'automático' ? (esp.times === 'lado' && cfg.calibrada ? 'lado' : 'cor') : cfg.times;
    this.times.modo = modo;
    const ativos = [...this.jogadores.values()].filter((j) => j.ultimo === this.tUlt);
    if (modo === 'não separar') { for (const j of ativos) j.time = 'A'; return; }
    if (modo === 'lado') {
      for (const j of ativos) j.time = j.R[0] < cfg.L / 2 ? 'A' : 'B';
      this.times.uniformes = {};
      return;
    }
    const comCor = [...this.jogadores.values()].filter((j) => j.lab && this.tUlt - j.ultimo < 4000);
    if (comCor.length < 2) return;
    const P = comCor.map((j) => j.lab);
    const k2 = kmeans(P, 2);
    let res = k2, k = 2;
    if (P.length >= 5) {
      const k3 = kmeans(P, 3);
      if (k3) {
        const menor = Math.min(...k3.tam);
        const ordem = k3.tam.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]);
        const [ia, ib, io] = [ordem[0][1], ordem[1][1], ordem[2][1]];
        const sep = Math.min(dCor(k3.c[io], k3.c[ia]), dCor(k3.c[io], k3.c[ib]));
        // o terceiro grupo precisa ser pequeno, bem separado e melhorar muito o ajuste
        if (menor <= Math.max(2, 0.3 * P.length) && sep > 18 && k3.inercia < 0.55 * k2.inercia) { res = k3; k = 3; }
      }
    }
    if (!res) return;
    // rótulos: os dois maiores são A/B, o menor (k = 3) é "outros"; A/B casam com os centros anteriores
    const ordem = res.tam.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    const rot = {};
    const ant = this.times.centros;
    const [i1, i2] = [ordem[0], ordem[1]];
    if (ant && ant.A && ant.B) {
      const direto = dCor(res.c[i1], ant.A) + dCor(res.c[i2], ant.B), troca = dCor(res.c[i1], ant.B) + dCor(res.c[i2], ant.A);
      rot[i1] = direto <= troca ? 'A' : 'B'; rot[i2] = direto <= troca ? 'B' : 'A';
    } else { rot[i1] = 'A'; rot[i2] = 'B'; }
    if (k === 3) rot[ordem[2]] = 'O';
    const novos = {};
    res.c.forEach((c, i) => {
      const r = rot[i];
      novos[r] = ant && ant[r] ? ant[r].map((v, e) => v + 0.3 * (c[e] - v)) : c.slice();
    });
    if (ant && ant.O && !novos.O) novos.O = ant.O;
    this.times.centros = novos;
    // desenho com cores vivas fixas (a média do uniforme costuma ser apagada); a do uniforme vai junto
    for (const r of Object.keys(novos)) this.times.uniformes[r] = labParaHex(novos[r]);
    // voto com memória: um quadro ruim não troca o jogador de time
    for (const j of comCor) {
      let best = null, bd = Infinity;
      for (const [r, c] of Object.entries(novos)) { const d = dCor(j.lab, c); if (d < bd) { bd = d; best = r; } }
      for (const r of ['A', 'B', 'O']) j.votos[r] *= 0.8;
      j.votos[best] += 1;
      j.time = Object.entries(j.votos).sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  /** A bola desta atualização: perto da prevista (se vista há pouco) ou a de maior score. */
  escolherBola(t, bolas) {
    if (!bolas.length) return null;
    const u = this.bola.ult;
    if (u && t - u.t < 800) {
      const tr = this.bola.traj, p = tr.length >= 2 ? tr[tr.length - 2] : null;
      const dtp = p ? (u.t - p.t) / 1000 : 0, dtn = (t - u.t) / 1000;
      const pu = p && dtp > 0 ? u.u + ((u.u - p.u) / dtp) * dtn : u.u, pv = p && dtp > 0 ? u.v + ((u.v - p.v) / dtp) * dtn : u.v;
      let best = null, bd = Infinity;
      for (const b of bolas) { const d = Math.hypot(b.u - pu, b.v - pv); if (d < bd) { bd = d; best = b; } }
      if (best && bd < 0.12 + 0.6 * dtn) return best;
    }
    return bolas.reduce((m, b) => (b.score > m.score ? b : m), bolas[0]);
  }

  velocidadeBola(t) {
    // bola alta (vôlei, basquete): a projeção no chão não é velocidade — não mede
    if (this.esporte === 'vôlei' || this.esporte === 'basquete') { this.bola.vAtual = null; return; }
    const tr = this.bola.traj.filter((s) => s.P && t - s.t <= 700);
    if (tr.length < 2) { this.bola.vAtual = null; return; }
    let d = 0;
    for (let i = 1; i < tr.length; i++) d += Math.hypot(tr[i].P[0] - tr[i - 1].P[0], tr[i].P[1] - tr[i - 1].P[1]);
    const s = (tr[tr.length - 1].t - tr[0].t) / 1000;
    if (s < 0.08) return;
    const v = (d / s) * 3.6;
    if (v > 260) return;                                // projeção de bola alta / troca de bola: ignora
    this.bola.vAtual = v;
    if (v > this.bola.vMax) this.bola.vMax = v;
  }

  /**
   * Quique = ponto mais baixo da bola na imagem (máximo local de v) LONGE dos
   * jogadores; perto de um jogador é golpe/toque. Com a bola no chão a
   * projeção da homografia vale: dá para dizer dentro/fora pelas linhas.
   */
  quiqueEGolpe(t, vivos, cfg, esp) {
    const tr = this.bola.traj, n = tr.length;
    if (n < 3) return;
    const a = tr[n - 3], b = tr[n - 2], c = tr[n - 1];
    if (c.t - a.t > 700) return;
    const e = 0.004;
    if (!(b.v > a.v + e && b.v > c.v + e)) return;
    if (b.marcado) return;
    b.marcado = true;
    if (pertoDeJogador(b, vivos)) {
      if (this.rally.ativo) this.rally.toques++;
      return;
    }
    if (!b.P) { this.evento(t, 'quique', 'Quique (sem calibração: dentro/fora indisponível)'); return; }
    const { L, W } = cfg;
    // projeção longe da quadra = a bola estava no ar (o ponto mais baixo na imagem não era o chão)
    if (!dentroDaQuadra(b.P[0], b.P[1], L, W, 4)) return;
    let caixa = [0, 0, L, W];
    if (cfg.esporte === 'tênis' && !cfg.duplas) caixa = [0, 1.37, L, W - 1.37];
    const m = distanciaBorda(b.P[0], b.P[1], ...caixa);
    const q = { t: b.t, s: (b.t - this.t0) / 1000, x: b.P[0], y: b.P[1], dentro: m >= 0, margemM: m, lado: b.P[0] < L / 2 ? 'esq.' : 'dir.' };
    this.quiques.push(q);
    if (this.quiques.length > 300) this.quiques.shift();
    if (this.rally.ativo) this.rally.quiques++;
    this.evento(t, 'quique', `Quique ${q.dentro ? 'DENTRO' : 'FORA'} (${q.lado}, ${Math.abs(m * 100).toFixed(0)} cm da linha)`, { dentro: q.dentro });
    if (cfg.esporte === 'vôlei') this.fecharRally(t, `bola no chão (${q.lado}, ${q.dentro ? 'dentro' : 'fora'})`);
  }

  /**
   * Rally: tênis/padel contam golpes pela inversão do sentido da bola ao
   * longo da quadra (x em metros; sem calibração, o eixo vertical da
   * imagem — câmera atrás da linha de fundo); vôlei conta travessias da rede.
   */
  contarRally(t, s, ant, cfg, esp) {
    const R = this.rally;
    const usaP = Boolean(s.P);
    const pos = usaP ? s.P[0] : s.v;
    const hist = usaP ? 1.0 : 0.04;
    if (!R.ativo) {
      Object.assign(R, { ativo: true, inicio: t, tGolpe: t, golpes: 1, quiques: 0, dir: 0, ext: pos, lado: null, toques: 0, travessias: 0 });
      this.evento(t, 'rally', 'Início de rally');
      return;
    }
    if (cfg.esporte === 'vôlei' && usaP) {
      const lado = pos < cfg.L / 2 - 0.5 ? 'esq' : pos > cfg.L / 2 + 0.5 ? 'dir' : null;
      if (lado && R.lado && lado !== R.lado) { R.travessias++; R.golpes = R.travessias; }
      if (lado) R.lado = lado;
      return;
    }
    if (R.dir === 0) {
      if (Math.abs(pos - R.ext) > hist) { R.dir = Math.sign(pos - R.ext); R.ext = pos; }
      return;
    }
    if ((R.dir > 0 && pos > R.ext) || (R.dir < 0 && pos < R.ext)) { R.ext = pos; return; }
    // inversão de sentido só vale como golpe se a bola passou perto de um jogador há pouco: a
    // bola alta projetada no chão "anda para trás" na subida e na descida sem ninguém bater nela
    if (Math.abs(pos - R.ext) > hist) {
      R.dir = -R.dir; R.ext = pos;
      // e um golpe por CONTATO NOVO (depois do último golpe contado): as oscilações da projeção não contam de novo
      if (this.bola.tPerto > (R.tGolpe || 0) && t - this.bola.tPerto < 900) { R.golpes++; R.tGolpe = t; }
    }
  }

  fecharRally(t, motivo) {
    const R = this.rally;
    if (!R.ativo) return;
    R.ativo = false;
    const dur = ((this.bola.ult ? this.bola.ult.t : t) - R.inicio) / 1000;
    if (dur < 0.6 && R.golpes <= 1) return;           // bola vista de relance: não é rally
    const r = { s: (R.inicio - this.t0) / 1000, duracaoS: Math.round(dur * 10) / 10, golpes: R.golpes, quiques: R.quiques, toques: R.toques, motivo };
    this.rallies.push(r);
    this.evento(t, 'rally', `Fim de rally: ${r.golpes} ${this.esporte === 'vôlei' ? 'travessias' : 'golpes'}, ${r.duracaoS} s (${motivo})`);
  }

  /** Posse por proximidade (m com calibração; sem ela, distância à caixa em alturas de jogador). */
  atualizarPosse(t, dt, b, vivos, cfg, esp) {
    const Ps = this.posse;
    const recente = this.bola.ult && t - this.bola.ult.t < 1500;
    if (b) {
      let melhor = null, md = Infinity;
      for (const j of vivos) {
        if (!j || j.time === 'O') continue;
        let d;
        if (b.P && j.P) d = Math.hypot(b.P[0] - j.P[0], b.P[1] - j.P[1]) / esp.raioPosse;
        else {
          const bh = j.box.y2 - j.box.y1, dx = Math.max(j.box.x1 - b.u, 0, b.u - j.box.x2), dy = Math.max(j.box.y1 - b.v, 0, b.v - j.box.y2);
          d = Math.hypot(dx, dy * 0.7) / (0.35 * bh);
        }
        if (d < md) { md = d; melhor = j; }
      }
      const cand = melhor && md <= 1 ? melhor : null;
      if (cand && Ps.cand === cand.id) Ps.candN++; else { Ps.cand = cand ? cand.id : null; Ps.candN = cand ? 1 : 0; }
      if (cand && Ps.candN >= 2 && Ps.dono !== cand.id) {
        const ant = Ps.dono != null ? this.jogadores.get(Ps.dono) : null;
        if (ant && t - Ps.tDono < 5000) {
          if (ant.time === cand.time && ant.time) { Ps.passes[ant.time] = (Ps.passes[ant.time] || 0) + 1; ant.passes++; this.evento(t, 'passe', `Passe ${ROTULO_TIME[ant.time]}: #${ant.id} → #${cand.id}`, { time: ant.time }); }
          else if (ant.time && cand.time) { Ps.perdas[ant.time] = (Ps.perdas[ant.time] || 0) + 1; this.evento(t, 'perda', `Perda ${ROTULO_TIME[ant.time]} (#${ant.id}) → ${ROTULO_TIME[cand.time]} (#${cand.id})`, { time: ant.time }); }
        }
        Ps.dono = cand.id; Ps.time = cand.time;
      }
      if (Ps.dono != null && cand && cand.id === Ps.dono) Ps.tDono = t;
    }
    if (Ps.dono != null && recente && dt > 0 && t - Ps.tDono < 3000) {
      const d = this.jogadores.get(Ps.dono);
      const tm = d && d.time ? d.time : Ps.time;
      if (tm === 'A' || tm === 'B') Ps.tempo[tm] += dt;
      if (d) d.posseS += dt;
    }
  }

  /** Arremesso (basquete): a bola sobe acima do aro marcado; desce cruzando o aro = cesta. */
  arremesso(t, s, ant, cfg) {
    const k = cfg.aspecto || 0.5625, r = cfg.aroR || 0.012;
    while (this.aros.length < cfg.aros.length) this.aros.push({ armado: false, tArm: 0, arremessador: null });
    cfg.aros.forEach(([au, av], i) => {
      const A = this.aros[i];
      const dx = s.u - au, acima = (av - s.v) * k;     // em unidades de largura
      if (!A.armado && Math.abs(dx) < 4 * r && acima > 0.3 * r && acima < 12 * r) {
        A.armado = true; A.tArm = t; A.arremessador = this.posse.dono;
        return;
      }
      if (!A.armado) return;
      if (ant && ant.v < av && s.v >= av && t - ant.t < 800) {
        const uc = ant.u + ((s.u - ant.u) * (av - ant.v)) / (s.v - ant.v || 1e-6);
        this.fecharArremesso(t, A, i, Math.abs(uc - au) <= 1.4 * r);
      } else if (t - A.tArm > 2500) this.fecharArremesso(t, A, i, false);
    });
  }
  fecharArremesso(t, A, i, cesta) {
    A.armado = false;
    this.arremessos.tent++;
    if (cesta) this.arremessos.cestas++;
    const j = A.arremessador != null ? this.jogadores.get(A.arremessador) : null;
    if (j) { j.arremessos++; if (cesta) j.cestas++; }
    this.evento(t, 'arremesso', `${cesta ? 'CESTA' : 'Arremesso errado'} no aro ${i + 1}${j ? ` (#${j.id}, ${ROTULO_TIME[j.time] || '—'})` : ''}`, { cesta });
  }

  // ------------------------------------------------------------ leitura

  retrato(cfg) {
    const t = this.tUlt || 0;
    const js = [...this.jogadores.values()];
    const ativos = js.filter((j) => t - j.ultimo < 1200);
    const times = {};
    for (const r of ['A', 'B', 'O']) {
      const m = js.filter((j) => j.time === r && j.tempo >= 1);
      times[r] = {
        nome: ROTULO_TIME[r], cor: this.times.cores[r], uniforme: this.times.uniformes[r] || null, agora: ativos.filter((j) => j.time === r).length,
        dist: m.reduce((s, j) => s + j.dist, 0), jogadores: m.length,
      };
    }
    const tp = this.posse.tempo.A + this.posse.tempo.B;
    if (tp > 0) { times.A.possePct = (100 * this.posse.tempo.A) / tp; times.B.possePct = (100 * this.posse.tempo.B) / tp; }
    times.A.passes = this.posse.passes.A; times.B.passes = this.posse.passes.B;
    times.A.perdas = this.posse.perdas.A; times.B.perdas = this.posse.perdas.B;
    const b = this.bola.ult && t - this.bola.ult.t < 1000 ? this.bola.ult : null;
    return {
      t, duracaoS: this.t0 != null ? (t - this.t0) / 1000 : 0, atualizacoes: this.atualizacoes,
      taxaBola: this.atualizacoes ? this.comBola / this.atualizacoes : 0,
      modoTimes: this.times.modo, times,
      jogadores: js.map((j) => ({
        id: j.id, time: j.time, ativo: t - j.ultimo < 1200, R: j.R, P: j.P, vAtual: t - j.ultimo < 1200 ? j.vAtual : null,
        vMax: j.vMax, dist: j.dist, tempo: j.tempo, zonas: j.zonas, posseS: j.posseS, passes: j.passes,
        arremessos: j.arremessos, cestas: j.cestas, cor: j.lab ? labParaHex(j.lab) : null, saltos: j.saltos || 0,
      })),
      bola: {
        agora: b ? { u: b.u, v: b.v, P: b.P } : null, vAtual: b ? this.bola.vAtual : null, vMax: this.bola.vMax,
        traj: this.bola.traj.filter((s) => t - s.t < 1500).map((s) => ({ u: s.u, v: s.v, P: s.P })),
      },
      posse: { dono: this.posse.dono, time: this.posse.time },
      quiques: this.quiques.slice(-30),
      rally: { ...this.rally, duracaoS: this.rally.ativo ? (t - this.rally.inicio) / 1000 : 0 },
      rallies: this.rallies.slice(),
      arremessos: { ...this.arremessos },
      eventos: this.eventos.slice(-40),
      grade: this.grade ? { gx: this.grade.gx, gy: this.grade.gy } : null,
      cfg: cfg ? { esporte: cfg.esporte, L: cfg.L, W: cfg.W, calibrada: cfg.calibrada } : null,
    };
  }

  /** Mapa de calor (grade gx × gy, soma em segundos): 'todos', 'A', 'B', 'O' ou o id de um jogador. */
  calor(qual) {
    if (!this.grade) return null;
    const { gx, gy } = this.grade;
    if (qual === 'todos') {
      const out = new Float32Array(gx * gy);
      for (const j of this.jogadores.values()) if (j.calor) for (let i = 0; i < out.length; i++) out[i] += j.calor[i];
      return { gx, gy, m: out };
    }
    if (qual === 'A' || qual === 'B' || qual === 'O') return this.calorTime[qual] ? { gx, gy, m: this.calorTime[qual] } : null;
    const j = this.jogadores.get(Number(qual));
    return j && j.calor ? { gx, gy, m: j.calor } : null;
  }
}

export { ROTULO_TIME };
