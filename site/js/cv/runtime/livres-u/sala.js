/**
 * cv/runtime/livres-u/sala.js — sala de aula (CV-83), sem DOM:
 *
 *   layoutGabarito     geometria da folha-resposta (A4, mm): 4 marcos de canto,
 *                      matrícula (0–8 dígitos) e N questões × K alternativas em colunas
 *   folhaSVG           a folha imprimível (SVG em mm) — a MESMA geometria que o leitor usa
 *   lerGabarito        acha os 4 marcos, homografia folha→imagem, escurecimento de cada bolha
 *   decidir / corrigir resposta por questão (marcada, branco, dupla, incerta) e nota
 *   lerChave           "ABCDE…", "1A 2C 3B…" ou "1-A, 2-C" → ['A','C',…]
 *   maoLevantada       punho acima da cabeça (pose COCO-17) — sem identificação
 */
import { cinza, otsuPlano, componentes, homografia, aplicarH } from './imagem.js';

export const FOLHA = { W: 210, H: 297, marco: 10, margem: 10 };
const LETRAS = 'ABCDEFGH';

/**
 * Geometria da folha. o = { questoes, alternativas, colunas, digitos }.
 * Devolve { marcos: [[x,y]×4] (centros, mm: TL, TR, BL, BR), bolhas: [{q, alt, x, y, r}],
 *           matricula: [{d, val, x, y, r}], cabecalhoY, capacidade, ok, erro }.
 */
export function layoutGabarito(o = {}) {
  const Q = Math.max(1, Math.min(200, o.questoes | 0 || 20)), A = Math.max(2, Math.min(8, o.alternativas | 0 || 5));
  const C = Math.max(1, Math.min(4, o.colunas | 0 || 2)), D = Math.max(0, Math.min(8, o.digitos | 0));
  const { W, H, marco, margem } = FOLHA;
  const m = margem + marco / 2;
  const marcos = [[m, m], [W - m, m], [m, H - m], [W - m, H - m]];
  const r = 2.4, passoX = 6.6, passoY = 6.6;
  const matricula = [];
  let y0 = 46;
  if (D > 0) {
    const larg = D * passoX, x0 = (W - larg) / 2 + passoX / 2;
    for (let d = 0; d < D; d++) for (let v = 0; v < 10; v++) matricula.push({ d, val: v, x: x0 + d * passoX, y: y0 + 6 + v * passoY, r });
    y0 += 6 + 10 * passoY + 6;
  }
  const yIni = y0 + 6, yFim = H - margem - marco - 6;
  const porCol = Math.max(1, Math.floor((yFim - yIni) / passoY) + 1);
  const capacidade = porCol * C;
  const bolhas = [];
  const largCol = (W - 2 * (margem + marco)) / C;
  const blocoW = 9 + A * passoX;
  for (let q = 0; q < Q; q++) {
    const c = Math.floor(q / porCol), lin = q % porCol;
    if (c >= C) break;
    const xc = margem + marco + c * largCol + (largCol - blocoW) / 2 + 9;
    for (let a = 0; a < A; a++) bolhas.push({ q, alt: a, x: xc + a * passoX + passoX / 2, y: yIni + lin * passoY, r });
  }
  return { Q, A, C, D, marcos, bolhas, matricula, cabecalhoY: 22, capacidade, passoX, passoY, ok: Q <= capacidade,
    erro: Q > capacidade ? `cabem ${capacidade} questões com ${C} colunas` : null };
}

/** Folha-resposta em SVG (unidades em mm; imprimir a 100%, A4). */
export function folhaSVG(o = {}, titulo = 'Folha de respostas') {
  const L = layoutGabarito(o), { W, H, marco } = FOLHA;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">`);
  p.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  for (const [x, y] of L.marcos) p.push(`<rect x="${x - marco / 2}" y="${y - marco / 2}" width="${marco}" height="${marco}" fill="#000"/>`);
  p.push(`<text x="${W / 2}" y="16" font-size="5" text-anchor="middle" font-weight="bold">${esc(titulo)}</text>`);
  p.push(`<text x="26" y="${L.cabecalhoY + 6}" font-size="3.6">Nome: ______________________________________________   Turma: ________</text>`);
  p.push(`<text x="26" y="${L.cabecalhoY + 14}" font-size="2.8" fill="#444">Preencha a bolha inteira com caneta preta ou azul escura. Não rasure nem dobre os cantos pretos.</text>`);
  if (L.D) {
    const x0 = L.matricula[0].x - L.passoX / 2;
    p.push(`<text x="${x0 - 2}" y="${L.matricula[0].y - 5}" font-size="3" font-weight="bold">Matrícula</text>`);
    for (const b of L.matricula) {
      p.push(`<circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="none" stroke="#000" stroke-width="0.3"/>`);
      p.push(`<text x="${b.x}" y="${b.y + 1}" font-size="2.6" text-anchor="middle" fill="#aaa">${b.val}</text>`);
    }
  }
  const porQ = new Map();
  for (const b of L.bolhas) { if (!porQ.has(b.q)) porQ.set(b.q, []); porQ.get(b.q).push(b); }
  for (const [q, lista] of porQ) {
    p.push(`<text x="${lista[0].x - 5.5}" y="${lista[0].y + 1.2}" font-size="3.2" text-anchor="end" font-weight="bold">${q + 1}</text>`);
    for (const b of lista) {
      p.push(`<circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="none" stroke="#000" stroke-width="0.3"/>`);
      p.push(`<text x="${b.x}" y="${b.y + 1}" font-size="2.6" text-anchor="middle" fill="#aaa">${LETRAS[b.alt]}</text>`);
    }
  }
  p.push(`<text x="${W / 2}" y="${H - 4}" font-size="2.4" text-anchor="middle" fill="#666">GPlanSiS|iaVision · ${L.Q} questões · ${L.A} alternativas · ${L.C} coluna(s)${L.D ? ` · matrícula ${L.D} dígitos` : ''}</text>`);
  p.push('</svg>');
  return p.join('');
}

/** Página HTML pronta para imprimir com a folha (uma ou várias cópias). */
export function folhaHTML(o = {}, titulo = 'Folha de respostas', copias = 1) {
  const svg = folhaSVG(o, titulo);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}.f{width:210mm;height:297mm;page-break-after:always;overflow:hidden}.f svg{display:block}</style>
</head><body>${Array.from({ length: Math.max(1, copias) }, () => `<div class="f">${svg}</div>`).join('')}</body></html>`;
}

/**
 * Marcos de canto no plano cinza `G` (w×h): blobs escuros, quadrados e
 * cheios (cheio > 0,86 — a bolha preenchida é um disco, π/4 ≈ 0,79), o mais
 * perto de cada canto da área. Devolve [TL, TR, BL, BR] em px de G, ou null.
 */
export function acharMarcos(G, w, h, thr) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = G[i] < thr ? 1 : 0;
  const minA = Math.max(12, w * h * 0.00025);
  const { comps } = componentes(m, w, h, minA);
  const cand = comps.filter((c) => {
    const bw = c.x2 - c.x1 + 1, bh = c.y2 - c.y1 + 1, asp = bw / bh;
    return asp > 0.6 && asp < 1.65 && c.area / (bw * bh) > 0.86 && bw < w * 0.2;
  });
  if (cand.length < 4) return null;
  const cantos = [[0, 0], [w, 0], [0, h], [w, h]];
  const usados = new Set();
  const out = [];
  for (const [cx, cy] of cantos) {
    let best = null, bd = Infinity;
    for (const c of cand) {
      if (usados.has(c)) continue;
      const d = Math.hypot(c.cx - cx, c.cy - cy);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best || bd > Math.hypot(w, h) * 0.45) return null;
    usados.add(best); out.push([best.cx + 0.5, best.cy + 0.5]);
  }
  // os 4 marcos têm áreas parecidas (a folha inteira, sem objetos espúrios)
  return out;
}

/**
 * Lê a folha em `img` dentro da `roi` (px; null = quadro inteiro).
 * Devolve { ok, motivo?, marcos (px do quadro), preench: number[][] (fração escura por bolha, [q][alt]),
 *           matricula: number[][] ([d][0..9]), H }.
 */
export function lerGabarito(img, roi, layout) {
  const C = cinza(img, roi);
  if (C.w < 40 || C.h < 40) return { ok: false, motivo: 'área pequena' };
  const thr = otsuPlano(C.g);
  const mk = acharMarcos(C.g, C.w, C.h, thr);
  if (!mk) return { ok: false, motivo: 'não achei os 4 cantos pretos' };
  const H = homografia(layout.marcos, mk);
  if (!H) return { ok: false, motivo: 'cantos degenerados' };
  // tamanho aparente de 1 mm (px) para checar a escala
  const a = aplicarH(H, 0, 0), b = aplicarH(H, 10, 0);
  const pxMm = Math.hypot(b[0] - a[0], b[1] - a[1]) / 10;
  if (pxMm < 1.2) return { ok: false, motivo: 'folha pequena demais no quadro (aproxime a câmera)' };
  // limiar das bolhas: meio-termo entre o papel (margem direita, sem impressão) e o preto dos marcos
  const amostra = (x, y) => { const [u, v] = aplicarH(H, x, y); const xi = Math.round(u), yi = Math.round(v); return xi >= 0 && yi >= 0 && xi < C.w && yi < C.h ? C.g[yi * C.w + xi] : NaN; };
  const papel = [], preto = [];
  for (let y = 30; y <= 265; y += 5) papel.push(amostra(FOLHA.W - 4.5, y));
  for (const [mx, my] of layout.marcos) for (let k = -2; k <= 2; k++) preto.push(amostra(mx + k, my), amostra(mx, my + k));
  const med = (a) => { const b = a.filter(Number.isFinite).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : NaN; };
  const claro = med(papel), negro = med(preto);
  const thrB = Number.isFinite(claro) && Number.isFinite(negro) && claro - negro > 40 ? (claro + negro) / 2 : thr;
  const escuro = (bo) => {
    let n = 0, e = 0;
    const R = bo.r * 0.62;
    for (let iy = -3; iy <= 3; iy++) {
      for (let ix = -3; ix <= 3; ix++) {
        const dx = (ix / 3) * R, dy = (iy / 3) * R;
        if (dx * dx + dy * dy > R * R) continue;
        const [x, y] = aplicarH(H, bo.x + dx, bo.y + dy);
        const xi = Math.round(x), yi = Math.round(y);
        if (xi < 0 || yi < 0 || xi >= C.w || yi >= C.h) continue;
        n++; if (C.g[yi * C.w + xi] < thrB) e++;
      }
    }
    return n ? e / n : 0;
  };
  const preench = Array.from({ length: layout.Q }, () => new Array(layout.A).fill(0));
  for (const bo of layout.bolhas) preench[bo.q][bo.alt] = escuro(bo);
  const matricula = Array.from({ length: layout.D }, () => new Array(10).fill(0));
  for (const bo of layout.matricula) matricula[bo.d][bo.val] = escuro(bo);
  return { ok: true, preench, matricula, pxMm, marcos: mk.map(([x, y]) => [x + C.x0, y + C.y0]), H };
}

/** Decide uma linha de frações: { resp: índice|null, estado: 'ok'|'branco'|'dupla'|'incerta' }. */
export function decidir(f, marca = 0.5, vazio = 0.25) {
  const ord = f.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const [v1, i1] = ord[0], v2 = ord[1] ? ord[1][0] : 0;
  if (v1 < vazio) return { resp: null, estado: 'branco' };
  if (v2 >= marca) return { resp: null, estado: 'dupla' };
  if (v1 >= marca && v2 < vazio) return { resp: i1, estado: 'ok' };
  if (v1 >= marca && v1 - v2 > 0.3) return { resp: i1, estado: 'ok' };
  return { resp: null, estado: 'incerta' };
}

/** Chave → array de letras (A–H) por questão; '*' ou '?' anula a questão (todos ganham). */
export function lerChave(txt) {
  const s = String(txt || '').toUpperCase();
  if (/\d/.test(s)) {
    const out = [];
    for (const m of s.matchAll(/(\d+)\s*[-.:)]?\s*([A-H*?])/g)) out[(+m[1]) - 1] = m[2];
    return Array.from(out, (x) => x || null);
  }
  return [...s.replace(/[^A-H*?]/g, '')];
}

/** Corrige uma leitura: { respostas: ['A'|null…], estados, acertos, total, nota (0–10), matricula }. */
export function corrigir(leitura, chave, o = {}) {
  const respostas = [], estados = [];
  let acertos = 0, total = 0;
  leitura.preench.forEach((f, q) => {
    const d = decidir(f, o.marca, o.vazio);
    respostas.push(d.resp == null ? null : LETRAS[d.resp]);
    estados.push(d.estado);
    const k = chave[q];
    if (k) { total++; if (k === '*' || k === '?' || (d.estado === 'ok' && LETRAS[d.resp] === k)) acertos++; }
  });
  let matricula = '';
  for (const f of leitura.matricula || []) { const d = decidir(f, o.marca, o.vazio); matricula += d.estado === 'ok' ? String(d.resp) : '?'; }
  return { respostas, estados, acertos, total, nota: total ? (10 * acertos) / total : null, matricula };
}

// ------------------------------------------------------------------ mãos levantadas

/**
 * Pose COCO-17 (keypoints 0–1 com score): mão levantada se o punho está acima
 * do nariz (ou, sem nariz, 0,6 tronco acima do ombro) E o cotovelo está na
 * altura do ombro ou acima. `aspecto` = w/h. Devolve 'esquerda'|'direita'|'ambas'|null.
 */
export function maoLevantada(kp, conf = 0.3, aspecto = 1) {
  const v = (i) => kp[i] && kp[i].score >= conf ? kp[i] : null;
  const nariz = v(0), oe = v(5), od = v(6), qe = v(11), qd = v(12);
  if (!oe && !od) return null;
  const ombroY = oe && od ? (oe.y + od.y) / 2 : (oe || od).y;
  let tronco;
  if ((qe || qd) && (oe || od)) tronco = Math.abs(((qe && qd) ? (qe.y + qd.y) / 2 : (qe || qd).y) - ombroY);
  else if (oe && od) tronco = Math.hypot((oe.x - od.x) * aspecto, oe.y - od.y) * 1.4;
  else return null;
  if (!(tronco > 0.01)) return null;
  const lado = (iO, iC, iP) => {
    const o = v(iO), c = v(iC), p = v(iP);
    if (!o || !p) return false;
    const acimaCabeca = nariz ? p.y < nariz.y - 0.05 * tronco : p.y < o.y - 0.6 * tronco;
    const cotovelo = !c || c.y < o.y + 0.15 * tronco;
    return acimaCabeca && cotovelo && p.y < o.y - 0.3 * tronco;
  };
  const e = lado(5, 7, 9), d = lado(6, 8, 10);
  return e && d ? 'ambas' : e ? 'esquerda' : d ? 'direita' : null;
}
