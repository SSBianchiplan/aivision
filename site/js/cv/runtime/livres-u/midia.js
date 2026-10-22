/**
 * cv/runtime/livres-u/midia.js — mídia (CV-84), sem DOM:
 *
 *   DetectorCortes     corte seco de cena: histograma HSV (Bhattacharyya) + diferença da
 *                      miniatura cinza, limiar adaptativo (k × mediana recente) e cena mínima
 *   notaMiniatura      nitidez (variância do Laplaciano) + rosto (tamanho, terço, olhos) + exposição
 *   buscarIndice       busca semântica: cosseno imagem×texto por segundo + texto da transcrição,
 *                      picos separados por ≥ `separacao` s
 *   segmentosLegenda   transcrição (chunks com tempo) → blocos de legenda ≤ N caracteres / 2 linhas
 *   srt / vtt          arquivos de legenda
 *   capitulos          pausas + mudança de assunto (TextTiling simples) → capítulos com título
 *   melhoresTrechos    janelas de 15–60 s com mais fala e palavras-chave
 *   tempoNaTimeline    instante da MÍDIA → instante da timeline do editor (clipes)
 */
import { histHSV, bhattacharyya, miniGray, mediana } from './imagem.js';

// ------------------------------------------------------------------ cortes de cena

export function assinaturaQuadro(img) { return { h: histHSV(img), m: miniGray(img, 32, 18) }; }

export function distanciaQuadros(a, b) {
  let s = 0;
  for (let i = 0; i < a.m.length; i++) s += Math.abs(a.m[i] - b.m[i]);
  return 0.6 * bhattacharyya(a.h, b.h) + 0.4 * (s / a.m.length / 255) * 2;
}

/**
 * Detector incremental. passo(t, img) → { corte: bool, d, limiar }.
 * o = { k (× mediana), minimo (distância absoluta), cenaMinS }.
 */
export class DetectorCortes {
  constructor(o = {}) { this.o = { k: 4, minimo: 0.28, cenaMinS: 0.6, ...o }; this.ant = null; this.hist = []; this.ultimoCorte = -Infinity; this.cortes = []; }
  configurar(o) { Object.assign(this.o, o); }
  passo(t, img) { return this.passoAss(t, assinaturaQuadro(img)); }
  passoAss(t, a) {
    let corte = false, d = 0, lim = this.o.minimo;
    if (this.ant) {
      d = distanciaQuadros(this.ant, a);
      const base = this.hist.length >= 3 ? mediana(this.hist) : 0.02;
      lim = Math.max(this.o.minimo, this.o.k * base);
      if (d > lim && t - this.ultimoCorte >= this.o.cenaMinS) {
        corte = true; this.ultimoCorte = t; this.cortes.push({ t, d });
        this.hist = [];                    // a nova cena tem o seu próprio "ruído"
      } else {
        this.hist.push(d); if (this.hist.length > 20) this.hist.shift();
      }
    }
    this.ant = a;
    return { corte, d, limiar: lim };
  }
}

// ------------------------------------------------------------------ miniatura

/**
 * Nota de um quadro para miniatura (0–1). `nit` = variância do Laplaciano,
 * `nitRef` = a maior vista até agora (normaliza); `rostos` = [{x1..y2 0–1, olhosAbertos?}];
 * `luma` = { media 0–255, estourado (fração > 250), preto (fração < 5) }.
 */
export function notaMiniatura({ nit, nitRef, rostos = [], luma = null }, o = {}) {
  const pesoRosto = o.pesoRosto ?? 0.4;
  const n = nitRef > 0 ? Math.min(1, nit / nitRef) : 0;
  let r = 0;
  if (rostos.length) {
    const f = [...rostos].sort((a, b) => (b.y2 - b.y1) - (a.y2 - a.y1))[0];
    const alt = f.y2 - f.y1, cx = (f.x1 + f.x2) / 2, cy = (f.y1 + f.y2) / 2;
    const tam = alt < 0.08 ? alt / 0.08 : alt > 0.6 ? Math.max(0, 1 - (alt - 0.6) / 0.4) : 1;
    // perto de um dos terços (ou do centro) na horizontal; olhos no terço de cima
    const tx = Math.min(Math.abs(cx - 1 / 3), Math.abs(cx - 0.5), Math.abs(cx - 2 / 3));
    const comp = Math.max(0, 1 - tx / 0.25) * Math.max(0, 1 - Math.max(0, Math.abs(cy - 0.4) - 0.1) / 0.4);
    r = 0.6 * tam + 0.4 * comp;
    if (f.olhosAbertos === false) r *= 0.4;
  }
  let exp = 1;
  if (luma) {
    exp = Math.max(0, 1 - Math.abs(luma.media - 120) / 120);
    exp *= Math.max(0, 1 - 2 * (luma.estourado + luma.preto));
  }
  const base = rostos.length || o.exigirRosto ? (1 - pesoRosto) * n + pesoRosto * r : n;
  return Math.max(0, Math.min(1, base * (0.5 + 0.5 * exp)));
}

/** Média de luma e frações estourada/preta (amostrado). */
export function lumaQuadro(img) {
  const d = img.data, n = img.width * img.height, passo = Math.max(1, Math.floor(n / 20000));
  let s = 0, e = 0, p = 0, k = 0;
  for (let i = 0; i < n; i += passo) {
    const q = i * 4, l = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
    s += l; if (l > 250) e++; if (l < 5) p++; k++;
  }
  return { media: s / k, estourado: e / k, preto: p / k };
}

// ------------------------------------------------------------------ busca semântica

/** Remove acentos e pontuação; minúsculas. */
export function normalizarTexto(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const VAZIAS = new Set('a o e de da do das dos em no na nos nas um uma uns umas para por com que se ao aos as os eh e é foi ser ter tem nao sim mais muito isso esse essa este esta aqui ali la entao tipo ne pra pro'.split(' '));

export function palavras(s) { return normalizarTexto(s).split(' ').filter((w) => w.length > 2 && !VAZIAS.has(w)); }

/**
 * indice = { ts: number[] (s), emb: Float32Array (n×dim, unit-norm), dim, segs: [{t0,t1,texto}] }.
 * q = { vetor (unit-norm) | null, texto }. Devolve [{ t, nota, tipo: 'imagem'|'fala'|'ambos', texto? }].
 */
export function buscarIndice(indice, q, o = {}) {
  const k = o.k ?? 8, sep = o.separacao ?? 4, pesoFala = o.pesoFala ?? 0.5;
  const cands = [];
  if (q.vetor && indice.emb && indice.ts.length) {
    const dim = indice.dim, sims = new Float32Array(indice.ts.length);
    for (let i = 0; i < indice.ts.length; i++) {
      let s = 0;
      for (let j = 0; j < dim; j++) s += indice.emb[i * dim + j] * q.vetor[j];
      sims[i] = s;
    }
    // z-score dentro do vídeo: o cosseno absoluto do CLIP varia pouco (0,15–0,35)
    let m = 0;
    for (const s of sims) m += s;
    m /= sims.length;
    let v = 0;
    for (const s of sims) v += (s - m) ** 2;
    const sd = Math.sqrt(v / sims.length) || 1;
    for (let i = 0; i < sims.length; i++) cands.push({ t: indice.ts[i], nota: (sims[i] - m) / sd, sim: sims[i], tipo: 'imagem' });
  }
  const qp = palavras(q.texto || '');
  if (qp.length && indice.segs && indice.segs.length) {
    for (const s of indice.segs) {
      const sp = new Set(palavras(s.texto));
      let hit = 0;
      for (const w of qp) if (sp.has(w) || [...sp].some((x) => x.startsWith(w) && w.length >= 4)) hit++;
      if (!hit) continue;
      const frac = hit / qp.length;
      cands.push({ t: s.t0, nota: 1.5 + 2.5 * frac * (1 + pesoFala), tipo: 'fala', texto: s.texto, t1: s.t1 });
    }
  }
  cands.sort((a, b) => b.nota - a.nota);
  const out = [];
  for (const c of cands) {
    const viz = out.find((x) => Math.abs(x.t - c.t) < sep);
    if (viz) { if (viz.tipo !== c.tipo) { viz.tipo = 'ambos'; viz.nota += 0.5; if (c.texto && !viz.texto) viz.texto = c.texto; } continue; }
    out.push({ ...c });
  }
  return out.sort((a, b) => b.nota - a.nota).slice(0, k);
}

/** Cosseno de dois vetores unitários. */
export function cosseno(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

// ------------------------------------------------------------------ legendas, capítulos, trechos

/**
 * Chunks do Whisper [{ timestamp: [t0, t1], text }] → segmentos [{t0, t1, texto}],
 * quebrando frases longas em blocos de no máximo `maxChars` × 2 linhas
 * (tempo dividido pelo número de caracteres).
 */
export function segmentosLegenda(chunks, maxChars = 42) {
  const out = [];
  let ultimoFim = 0;
  for (const c of chunks || []) {
    const texto = String(c.text || '').trim();
    if (!texto) continue;
    let [t0, t1] = c.timestamp || [];
    if (!Number.isFinite(t0)) t0 = ultimoFim;
    if (!Number.isFinite(t1) || t1 <= t0) t1 = t0 + Math.max(1, texto.length / 15);
    ultimoFim = t1;
    const lim = maxChars * 2;
    if (texto.length <= lim) { out.push({ t0, t1, texto }); continue; }
    const pal = texto.split(/\s+/), blocos = [];
    let cur = '';
    for (const w of pal) { if ((cur + ' ' + w).trim().length > lim && cur) { blocos.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
    if (cur) blocos.push(cur);
    const total = blocos.reduce((s, b) => s + b.length, 0);
    let t = t0;
    for (const b of blocos) { const dt = ((t1 - t0) * b.length) / total; out.push({ t0: t, t1: t + dt, texto: b }); t += dt; }
  }
  return out;
}

/** Quebra um texto em até 2 linhas de ≤ maxChars (equilibradas). */
export function duasLinhas(texto, maxChars = 42) {
  if (texto.length <= maxChars) return texto;
  const pal = texto.split(' ');
  let melhor = null;
  for (let i = 1; i < pal.length; i++) {
    const a = pal.slice(0, i).join(' '), b = pal.slice(i).join(' ');
    const custo = Math.max(a.length, b.length);
    if (!melhor || custo < melhor.c) melhor = { c: custo, t: a + '\n' + b };
  }
  return melhor ? melhor.t : texto;
}

const tc = (s, sepMs) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), ss = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}${sepMs}${String(r).padStart(3, '0')}`;
};

export function srt(segs, maxChars = 42) {
  return segs.map((s, i) => `${i + 1}\n${tc(s.t0, ',')} --> ${tc(s.t1, ',')}\n${duasLinhas(s.texto, maxChars)}\n`).join('\n');
}

export function vtt(segs, maxChars = 42) {
  return 'WEBVTT\n\n' + segs.map((s) => `${tc(s.t0, '.')} --> ${tc(s.t1, '.')}\n${duasLinhas(s.texto, maxChars)}\n`).join('\n');
}

/** "mm:ss" ou "h:mm:ss" (capítulos do YouTube). */
export function relogio(s) {
  const t = Math.max(0, Math.floor(s)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), ss = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Capítulos: fronteira candidata em toda pausa ≥ `pausaS` e onde o
 * vocabulário das janelas de `janelaS` antes e depois mais muda (cosseno de
 * frequências baixo). Capítulos com pelo menos `minS`. O título são as 3–4
 * palavras mais frequentes e próprias do capítulo.
 * Devolve [{ t0, t1, titulo }].
 */
export function capitulos(segs, o = {}) {
  const pausaS = o.pausaS ?? 2.0, minS = o.minS ?? 30, janelaS = o.janelaS ?? 30;
  if (!segs.length) return [];
  const fim = segs[segs.length - 1].t1, ini = segs[0].t0;
  const bag = (a, b) => {
    const m = new Map();
    for (const s of segs) if (s.t1 > a && s.t0 < b) for (const w of palavras(s.texto)) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const cos = (x, y) => {
    let s = 0, nx = 0, ny = 0;
    for (const [k, v] of x) { nx += v * v; if (y.has(k)) s += v * y.get(k); }
    for (const v of y.values()) ny += v * v;
    return nx && ny ? s / Math.sqrt(nx * ny) : 0;
  };
  const cand = [];
  for (let i = 1; i < segs.length; i++) {
    const t = segs[i].t0, pausa = t - segs[i - 1].t1;
    const muda = 1 - cos(bag(t - janelaS, t), bag(t, t + janelaS));
    const nota = muda + (pausa >= pausaS ? 0.6 + Math.min(0.6, (pausa - pausaS) / 5) : 0);
    cand.push({ t, nota });
  }
  cand.sort((a, b) => b.nota - a.nota);
  const cortes = [];
  const maxCap = o.max ?? Math.max(1, Math.floor((fim - ini) / minS));
  for (const c of cand) {
    if (c.nota < (o.minNota ?? 0.75)) break;
    if (c.t - ini < minS || fim - c.t < minS * 0.5) continue;
    if (cortes.some((x) => Math.abs(x - c.t) < minS)) continue;
    cortes.push(c.t);
    if (cortes.length >= maxCap - 1) break;
  }
  cortes.sort((a, b) => a - b);
  const lim = [ini, ...cortes, fim];
  const caps = [];
  const glob = bag(ini, fim);
  for (let i = 0; i < lim.length - 1; i++) {
    const b = bag(lim[i], lim[i + 1]);
    const top = [...b.entries()].map(([w, n]) => [w, n * Math.log(1 + (glob.get(w) ? (b.get(w) / glob.get(w)) * lim.length : 1))])
      .sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w]) => w);
    caps.push({ t0: i === 0 ? 0 : lim[i], t1: lim[i + 1], titulo: top.length ? top.join(', ') : `Parte ${i + 1}` });
  }
  return caps;
}

/** Texto de capítulos para colar na descrição do YouTube ("00:00 título"). */
export function textoCapitulos(caps) { return caps.map((c) => `${relogio(c.t0)} ${c.titulo}`).join('\n'); }

/**
 * Melhores trechos: janelas começando em cada segmento, crescendo até
 * `durMax` sem atravessar pausa > `pausaS`; nota = palavras/s (densidade de
 * fala) + 2 × acertos de palavras-chave − penalidade fora de [durMin, durMax].
 * Sem sobreposição. Devolve [{ t0, t1, nota, texto }] (n melhores, em ordem de tempo).
 */
export function melhoresTrechos(segs, o = {}) {
  const durMin = o.durMin ?? 15, durMax = o.durMax ?? 60, n = o.n ?? 3, pausaS = o.pausaS ?? 2.5;
  const chaves = palavras(o.palavrasChave || '');
  const cand = [];
  for (let i = 0; i < segs.length; i++) {
    let palavrasN = 0, hits = 0, texto = '';
    for (let j = i; j < segs.length; j++) {
      if (j > i && segs[j].t0 - segs[j - 1].t1 > pausaS) break;
      const dur = segs[j].t1 - segs[i].t0;
      if (dur > durMax) break;
      const ps = palavras(segs[j].texto);
      palavrasN += String(segs[j].texto).split(/\s+/).filter(Boolean).length;
      for (const w of ps) if (chaves.some((k) => w === k || (k.length >= 4 && w.startsWith(k)))) hits++;
      texto += (texto ? ' ' : '') + segs[j].texto;
      if (dur >= durMin) cand.push({ t0: segs[i].t0, t1: segs[j].t1, nota: palavrasN / dur + 2 * hits + (o.preferirLongos ? dur / durMax : 0), texto });
    }
  }
  cand.sort((a, b) => b.nota - a.nota);
  const out = [];
  for (const c of cand) {
    if (out.some((x) => c.t0 < x.t1 && c.t1 > x.t0)) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out.sort((a, b) => a.t0 - b.t0);
}

// ------------------------------------------------------------------ editor

/**
 * Instante da MÍDIA (µs) → instante na timeline do editor (µs), pelos
 * clipes { a, b (quadros da mídia), em (µs na timeline) } e v.pts (µs por quadro).
 * null se aquele trecho da mídia não está em nenhum clipe.
 */
export function tempoNaTimeline(v, clipes, tUs) {
  for (const c of clipes) {
    const a = v.pts[c.a], b = v.pts[c.b];
    if (tUs >= a && tUs < b) return c.em + (tUs - a);
  }
  return null;
}

/** Quadro da mídia (índice) no instante tUs (busca binária em v.pts). */
export function quadroEmUs(v, tUs) {
  let lo = 0, hi = v.n;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (v.pts[m] <= tUs) lo = m; else hi = m; }
  return lo;
}

/**
 * Clipes do editor só com os trechos [{t0, t1}] (s, da mídia), em sequência
 * (sem lacunas). `novoId` vem do editor (edl.js).
 */
export function clipesDosTrechos(v, trechos, novoId) {
  const out = [];
  let em = 0;
  for (const tr of [...trechos].sort((x, y) => x.t0 - y.t0)) {
    const a = quadroEmUs(v, tr.t0 * 1e6), b = Math.min(v.n, Math.max(a + 1, quadroEmUs(v, tr.t1 * 1e6)));
    out.push({ id: novoId(), a, b, em });
    em += v.pts[b] - v.pts[a];
  }
  return out;
}

/** Lê um arquivo .srt ou .vtt → segmentos [{t0, t1, texto}]. */
export function lerLegenda(txt) {
  const s = String(txt || '').replace(/\r/g, '');
  const out = [];
  const re = /(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{2})[,.](\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const seg = (h, m, ss, ms) => (h ? parseInt(h, 10) * 3600 : 0) + parseInt(m, 10) * 60 + parseInt(ss, 10) + parseInt(ms, 10) / 1000;
  for (const m of s.matchAll(re)) {
    const texto = m[9].split('\n').map((l) => l.trim()).filter(Boolean).join(' ').replace(/<[^>]+>/g, '');
    if (texto) out.push({ t0: seg(m[1], m[2], m[3], m[4]), t1: seg(m[5], m[6], m[7], m[8]), texto });
  }
  return out;
}
