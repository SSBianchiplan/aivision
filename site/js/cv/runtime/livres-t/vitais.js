/**
 * cv/runtime/livres-t/vitais.js — sinais vitais sem contato (CV-70), sem DOM:
 *
 *   respiração (81): o tórax sobe e desce. Numa ROI do tórax soma-se o
 *     |gradiente vertical| por LINHA (perfil vertical); o deslocamento do
 *     perfil em relação a um perfil de referência (deslocamento1D da Corrida,
 *     com sub-pixel) é o sinal. Pico do espectro em 0,1–0,7 Hz (6–42 rpm).
 *   frequência cardíaca rPPG (82): média RGB da pele (testa e bochechas pela
 *     malha do rosto, ou uma área marcada), POS ou CHROM, pico em 0,7–3 Hz.
 *
 * Cada estimador guarda a janela (ms) e devolve a estimativa com a FAIXA DE
 * CONFIANÇA (sinais.picoEspectral) e as condições que a invalidam
 * (iluminação variando, movimento, poucas amostras, taxa baixa).
 * NÃO É DISPOSITIVO MÉDICO.
 */
import { deslocamento1D } from '../livres-h/camera.js';
import { reamostrar, picoEspectral, rppgPOS, rppgCHROM, taxaHz, desvio, media, tirarTendencia, passaAlta } from './sinais.js';

const fin = Number.isFinite;

// --------------------------------------------------------------------- pixels

/** Média RGB numa caixa {x1,y1,x2,y2} (px), amostrando a cada `passo`. Ignora pixels saturados/escuros. */
export function mediaRGB(img, c, passo = 2) {
  const { data, width: W, height: H } = img;
  const x1 = Math.max(0, Math.floor(c.x1)), x2 = Math.min(W - 1, Math.ceil(c.x2));
  const y1 = Math.max(0, Math.floor(c.y1)), y2 = Math.min(H - 1, Math.ceil(c.y2));
  let r = 0, g = 0, b = 0, n = 0, lum = 0;
  for (let y = y1; y <= y2; y += passo) {
    for (let x = x1; x <= x2; x += passo) {
      const o = (y * W + x) * 4, R = data[o], G = data[o + 1], B = data[o + 2];
      if (R > 250 || G > 250 || R + G + B < 30) continue;   // reflexo especular / sombra
      r += R; g += G; b += B; lum += 0.299 * R + 0.587 * G + 0.114 * B; n++;
    }
  }
  return n ? { r: r / n, g: g / n, b: b / n, lum: lum / n, n } : null;
}

/**
 * ROIs de pele pela malha do rosto (478 pontos, 0–1 do quadro): testa entre
 * as sobrancelhas e o alto da testa, e as duas bochechas. Devolve caixas em px.
 */
export function roisDoRosto(pts, W, H) {
  const p = (i) => ({ x: pts[i].x * W, y: pts[i].y * H });
  const t = p(10), se = p(105), sd = p(334), oe = p(33), od = p(263);
  const larg = Math.hypot(od.x - oe.x, od.y - oe.y);
  if (!(larg > 8)) return [];
  const yS = Math.min(se.y, sd.y);
  const testa = { x1: Math.min(se.x, sd.x), x2: Math.max(se.x, sd.x), y1: t.y + 0.3 * (yS - t.y), y2: yS - 0.08 * larg };
  const lado = 0.22 * larg;
  const bo = (i) => { const q = p(i); return { x1: q.x - lado / 2, x2: q.x + lado / 2, y1: q.y - lado / 2, y2: q.y + lado / 2 }; };
  const rois = [testa, bo(50), bo(280)].filter((c) => c.x2 - c.x1 > 3 && c.y2 - c.y1 > 3);
  return rois;
}

/** Média RGB ponderada pela área em várias caixas. */
export function mediaRGBRois(img, rois, passo = 2) {
  let r = 0, g = 0, b = 0, lum = 0, n = 0;
  for (const c of rois) {
    const m = mediaRGB(img, c, passo);
    if (!m) continue;
    r += m.r * m.n; g += m.g * m.n; b += m.b * m.n; lum += m.lum * m.n; n += m.n;
  }
  return n ? { r: r / n, g: g / n, b: b / n, lum: lum / n, n } : null;
}

/** Perfil vertical: média de |∂I/∂y| por linha da caixa (px), com passo horizontal. */
export function perfilVertical(img, c, passo = 2) {
  const { data, width: W, height: H } = img;
  const x1 = Math.max(0, Math.floor(c.x1)), x2 = Math.min(W - 1, Math.ceil(c.x2));
  const y1 = Math.max(1, Math.floor(c.y1)), y2 = Math.min(H - 1, Math.ceil(c.y2));
  const n = Math.max(0, y2 - y1 + 1), out = new Float32Array(n);
  const L = (o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  for (let j = 0; j < n; j++) {
    const y = y1 + j;
    let s = 0, k = 0;
    for (let x = x1; x <= x2; x += passo) { s += Math.abs(L((y * W + x) * 4) - L(((y - 1) * W + x) * 4)); k++; }
    out[j] = k ? s / k : NaN;
  }
  return { perfil: out, y1 };
}

// --------------------------------------------------------------------- janela

class Janela {
  constructor() { this.zerar(); }
  zerar() { this.ts = []; this.cols = {}; this.extra = []; }
  add(t, valores, extra = null) {
    if (this.ts.length && t <= this.ts[this.ts.length - 1]) return false;
    this.ts.push(t);
    for (const [k, v] of Object.entries(valores)) (this.cols[k] || (this.cols[k] = new Array(this.ts.length - 1).fill(NaN))).push(v);
    for (const k of Object.keys(this.cols)) if (this.cols[k].length < this.ts.length) this.cols[k].push(NaN);
    this.extra.push(extra);
    return true;
  }
  cortar(janelaMs) {
    const t1 = this.ts[this.ts.length - 1];
    let i = 0;
    while (i < this.ts.length && this.ts[i] < t1 - janelaMs) i++;
    if (i > 0) { this.ts.splice(0, i); for (const k of Object.keys(this.cols)) this.cols[k].splice(0, i); this.extra.splice(0, i); }
  }
  get duracao() { return this.ts.length > 1 ? this.ts[this.ts.length - 1] - this.ts[0] : 0; }
}

// --------------------------------------------------------------------- respiração

export const FAIXA_RESP = { minRpm: 6, maxRpm: 42 };

/**
 * Estimador da respiração. adicionar(t, img, caixaTorax) por quadro;
 * estimar() → { rpm, faixa, confianca, snr, avisos[], serie } ou null.
 * Fonte de sinal alternativa: adicionarY(t, y) (altura dos ombros pela pose).
 */
export class Respiracao {
  constructor(cfg = {}) { this.cfg = { janelaS: 30, minRpm: FAIXA_RESP.minRpm, maxRpm: FAIXA_RESP.maxRpm, ...cfg }; this.j = new Janela(); this.zerar(); }
  zerar() { this.j.zerar(); this.ref = null; this.base = 0; this.ultimo = 0; this.tRef = 0; }
  /**
   * Deslocamento vertical do perfil do tórax em relação a um perfil de
   * REFERÊNCIA (px). Comparar sempre com o mesmo perfil evita a deriva de
   * somar deslocamentos quadro a quadro; a referência é trocada (com o nível
   * acumulado) a cada `rebaseMs` ou quando o deslocamento passa de 1/4 da busca.
   */
  adicionar(t, img, c) {
    const h = c.y2 - c.y1;
    if (!(h > 8 && c.x2 - c.x1 > 8)) return false;
    const pf = perfilVertical(img, c, 2);
    const max = Math.max(3, Math.round(0.1 * h));
    let y = NaN, conf = 0;
    const mesma = this.ref && this.ref.perfil.length === pf.perfil.length && Math.abs(this.ref.y1 - pf.y1) < 1;
    if (mesma) {
      const r = deslocamento1D(this.ref.perfil, pf.perfil, max);
      if (r) {
        y = this.base + r.d; conf = r.confianca;
        if (t - this.tRef > (this.cfg.rebaseMs || 8000) || Math.abs(r.d) > max / 4) { this.base = y; this.ref = pf; this.tRef = t; }
      }
    } else { this.ref = pf; this.tRef = t; y = this.base = this.ultimo ?? 0; }
    if (Number.isFinite(y)) this.ultimo = y;
    const lum = mediaRGB(img, c, 4);
    return this.j.add(t, { y, lum: lum ? lum.lum : NaN, conf }, { h });
  }
  adicionarY(t, y) { return this.j.add(t, { y, lum: NaN, conf: 1 }); }
  estimar() {
    const c = this.cfg, J = this.j;
    J.cortar(c.janelaS * 1000);
    const avisos = [];
    const fsReal = taxaHz(J.ts);
    if (J.duracao < 10000 || !fsReal) return { rpm: null, avisos: [`juntando sinal (${(J.duracao / 1000).toFixed(0)} de pelo menos 10 s)`], duracaoS: J.duracao / 1000 };
    const fs = Math.min(10, Math.max(2, fsReal));
    const rs = reamostrar(J.ts, J.cols.y, fs);
    const pk = picoEspectral(rs.ys, fs, c.minRpm / 60, c.maxRpm / 60, { harmonico: false });
    if (!pk) return { rpm: null, avisos: ['sem oscilação no tórax'], duracaoS: J.duracao / 1000 };
    avisos.push(...condicoes(J, fsReal, pk));
    if (J.duracao < 20000) avisos.push('janela curta (< 20 s): faixa larga');
    return {
      rpm: pk.porMin, faixa: pk.faixaPorMin, confianca: pk.confianca, snr: pk.snr, fs: fsReal, duracaoS: J.duracao / 1000,
      espectro: pk.espectro, serie: { ts: J.ts.slice(), ys: J.cols.y.slice() }, avisos,
    };
  }
}

// --------------------------------------------------------------------- rPPG

export const FAIXA_FC = { minBpm: 42, maxBpm: 180 };
export const METODOS_RPPG = { 'POS (Wang 2017)': 'pos', 'CHROM (de Haan 2013)': 'chrom', 'canal verde': 'verde' };

export class Pulso {
  constructor(cfg = {}) { this.cfg = { janelaS: 15, minBpm: FAIXA_FC.minBpm, maxBpm: FAIXA_FC.maxBpm, metodo: 'pos', ...cfg }; this.j = new Janela(); }
  zerar() { this.j.zerar(); }
  /** m = mediaRGB das ROIs; mov = deslocamento da ROI desde o quadro anterior (fração da largura do rosto). */
  adicionar(t, m, mov = 0) { if (!m) return false; return this.j.add(t, { r: m.r, g: m.g, b: m.b, lum: m.lum, mov }); }
  /** Sinal de pulso reamostrado (para o gráfico e o espectro). */
  sinal() {
    const J = this.j, fsReal = taxaHz(J.ts);
    if (!fsReal || J.ts.length < 16) return null;
    const fs = Math.min(30, Math.max(4, fsReal));
    const R = reamostrar(J.ts, J.cols.r, fs).ys, G = reamostrar(J.ts, J.cols.g, fs).ys, B = reamostrar(J.ts, J.cols.b, fs).ys;
    let s;
    if (this.cfg.metodo === 'chrom') s = rppgCHROM(R, G, B, fs);
    else if (this.cfg.metodo === 'verde') { const mg = media(G) || 1; s = new Float64Array(G.length); for (let i = 0; i < G.length; i++) s[i] = -(G[i] / mg - 1); }
    else s = rppgPOS(R, G, B, fs);
    // tira a deriva lenta (< ~0,5 Hz): média móvel de 2 s
    s = passaAlta(tirarTendencia(s), Math.round(2 * fs));
    return { s, fs, fsReal };
  }
  estimar() {
    const c = this.cfg, J = this.j;
    J.cortar(c.janelaS * 1000);
    if (J.duracao < 8000) return { bpm: null, avisos: [`juntando sinal (${(J.duracao / 1000).toFixed(0)} de pelo menos 8 s)`], duracaoS: J.duracao / 1000 };
    const sg = this.sinal();
    if (!sg) return { bpm: null, avisos: ['poucas amostras'], duracaoS: J.duracao / 1000 };
    const pk = picoEspectral(sg.s, sg.fs, c.minBpm / 60, Math.min(c.maxBpm / 60, sg.fs / 2 - 0.05));
    if (!pk) return { bpm: null, avisos: ['sem pulso no sinal da pele'], duracaoS: J.duracao / 1000 };
    const avisos = condicoes(J, sg.fsReal, pk, { nyquistHz: c.maxBpm / 60 });
    const movs = J.cols.mov ? J.cols.mov.filter(fin) : [];
    if (movs.length && media(movs) > 0.01) avisos.push('rosto se mexendo: fique parado, apoiado');
    return {
      bpm: pk.porMin, faixa: pk.faixaPorMin, confianca: pk.confianca, snr: pk.snr, fs: sg.fsReal, duracaoS: J.duracao / 1000,
      espectro: pk.espectro, pulso: { fs: sg.fs, s: Array.from(sg.s.slice(-Math.round(sg.fs * 8))) }, avisos,
    };
  }
}

/** Condições que pioram a medida: luz variando, taxa de amostragem baixa, confiança baixa. */
function condicoes(J, fsReal, pk, { nyquistHz = null } = {}) {
  const av = [];
  const lum = J.cols.lum ? J.cols.lum.filter(fin) : [];
  if (lum.length > 5) {
    const m = media(lum), sd = desvio(lum);
    if (m < 40) av.push('pouca luz: ilumine o rosto/tórax de frente, luz contínua');
    else if (sd / m > 0.06) av.push('iluminação variando (luz piscando, sombra passando)');
    if (m > 235) av.push('imagem estourada (luz demais)');
  }
  if (nyquistHz && fsReal < 2 * nyquistHz + 0.5) av.push(`taxa de ${fsReal.toFixed(1)} amostras/s: só mede até ${(fsReal * 30).toFixed(0)}/min com segurança`);
  if (fsReal < 5) av.push(`taxa baixa (${fsReal.toFixed(1)} amostras/s)`);
  if (pk.confianca < 0.4) av.push('sinal fraco (pico pouco destacado): resultado incerto');
  return av;
}
