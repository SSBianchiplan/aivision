/**
 * cv/runtime/livres-n/ferramentas.js — as ferramentas de inspeção do CV-40
 * (porte de vision/tools/classic.py e objects.py do GPlanSiS|Inspect).
 *
 * Contrato (o mesmo do Inspect): cada ferramenta é determinística dado
 * (imagem, spec, contexto) e devolve um resultado
 *   { code, type, status: PASS|FAIL|UNCERTAIN|ERROR, critical, value, expected,
 *     confidence, detail, overlays, ms }
 * com os overlays em px da imagem inspecionada (kind roi/box/line/point/poly/text).
 * Exceção vira ERROR com a mensagem (nunca PASS silencioso).
 *
 *   presence     presença por molde (NCC, TM_CCOEFF_NORMED) dentro da região de busca
 *   blob_count   contagem de manchas: desfoque 5×5, Otsu / limiar fixo / adaptativo,
 *                componentes conexos 8, faixa de área
 *   caliper      paquímetro: perfil médio (largura `width`) ao longo de p0→p1, gradiente,
 *                primeira e última borda acima do contraste, sub-pixel no pico; mm por px/mm
 *   color        cor: mediana Lab da região e ΔE2000 contra a referência
 *   shape        forma do objeto: Ø equivalente, área, circularidade, alongamento, solidez
 *   defect_area  área de defeito por faixas HSV dentro do objeto (queimado, ferrugem, mofo,
 *                corpo estranho), % e nº de manchas
 *
 * Contexto `ctx`: { pxPorMm, assets: { chave: {g, w, h} } (moldes em cinza) }.
 *
 * Parte 2 — ferramentas com leitura ou modelo, ASSÍNCRONAS (`assinc: true`):
 *   ocr          lote/validade: OCR PT-BR (PP-OCRv5) na ROI + normalize, padrão, esperado
 *                ({LOT}, {TODAY:+N|fmt}), data e validade mínima (marcacao.js)
 *   code         QR/DataMatrix/EAN/Code128… (CV-10) com formatos aceitos, padrão, GS1
 *                (AI 01/10/17/21) e GTIN; nenhum legível = NOK, dois diferentes = INCERTO
 *   serial       OCR (ou código) + padrão com (?P<n>\d+) + sequência (salto/fora de ordem
 *                = INCERTO, repetido = NOK; duplicidade no registro do canal)
 *   detect       YOLOX / RF-DETR / RF-DETR treinado: classes exigidas (mín–máx) e proibidas
 *   classify     MobileNetV2 ou classificador publicado: temperatura + conjunto conformal
 *   anomaly      PatchCore treinado no Treinar: nota normalizada, limiar, mapa de calor
 * A leitura mora em modelos.js (import dinâmico: só baixa quem usa) e a decisão
 * em marcacao.js / aprendidas.js. `rodarFerramentaAssinc` espera com prazo:
 * estourou = INCERTO (o modelo ainda carregando, por exemplo), nunca OK.
 *
 * EXTENSÍVEL: FERRAMENTAS é o catálogo (tipo → rótulo, forma da ROI, função
 * de marcação, executor, critério, esqueleto).
 */
import {
  buf, recorte, cinza, desfoque5, otsu, limiarizar, limiarAdaptativo, componentes, abrirFechar, taparFuros,
  contornoExterno, areaContorno, perimetro, casco, retanguloMinimo, ListaI32, ncc, lab8, deltaE2000, hsv, bilinear,
} from './visao.js';
import { PASS, FAIL, UNCERTAIN, ERROR, RANK, julgarFaixa, resultado } from './veredito.js';
import { julgarOcr, julgarCodigo, julgarSerial } from './marcacao.js';
import { julgarDeteccao, julgarClassificacao, julgarAnomalia, reprPy } from './aprendidas.js';

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r3 = (v) => Math.round(v * 1e3) / 1e3;
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v, d) => (Number.isFinite(+v) ? +v : d);
const banda = (s) => num(s.band, 0.05);
const roiOv = (s) => (s.roi ? [{ kind: 'roi', x: s.roi.x, y: s.roi.y, w: s.roi.w, h: s.roi.h }] : []);
const fmtN = (v) => String(+(+v).toFixed(4));

// ------------------------------------------------------------------ presença

function presence(img, s, ctx) {
  const tpl = ctx.assets && ctx.assets[s.template_key];
  if (!tpl) throw new Error(`KeyError: molde '${s.template_key}' não capturado`);
  const r = recorte(img, s.roi);
  if (tpl.w > r.w || tpl.h > r.h) throw new Error('a região de busca é menor que o molde');
  const g = cinza(img, r);
  const m = ncc(g, r.w, r.h, tpl.g, tpl.w, tpl.h);
  const minScore = num(s.min_score, 0.8);
  const st = julgarFaixa(m.score, minScore, null, banda(s));
  return resultado(s, st, {
    value: r4(m.score), expected: `≥ ${minScore}`, confidence: m.score,
    detail: { loc: [r.x + m.x, r.y + m.y] },
    overlays: [...roiOv(s), { kind: 'box', x: r.x + m.x, y: r.y + m.y, w: tpl.w, h: tpl.h, label: m.score.toFixed(2) }],
  });
}

// ------------------------------------------------------------------ contagem de manchas

function blobCount(img, s) {
  const r = recorte(img, s.roi);
  const n = r.w * r.h;
  const g = desfoque5(cinza(img, r), r.w, r.h);
  const escuro = (s.polarity || 'dark') === 'dark';
  let thr, bw;
  if (s.threshold_mode === 'adaptive') {
    thr = null;
    bw = limiarAdaptativo(g, r.w, r.h, num(s.block, 31) | 1, num(s.c, 5), escuro);
  } else if (s.threshold == null) {
    thr = otsu(g, n);
    bw = limiarizar(g, n, thr, escuro);
  } else {
    thr = num(s.threshold, 128);
    bw = limiarizar(g, n, thr, escuro);
  }
  const cc = componentes(bw, r.w, r.h);
  const amin = num(s.min_area, 20), amax = num(s.max_area, 100000);
  const areas = [], ov = roiOv(s);
  for (let k = 1; k <= cc.n; k++) {
    const a = cc.area[k];
    if (a < amin || a > amax) continue;
    areas.push(a);
    ov.push({ kind: 'box', x: r.x + cc.x0[k], y: r.y + cc.y0[k], w: cc.x1[k] - cc.x0[k] + 1, h: cc.y1[k] - cc.y0[k] + 1, label: String(a) });
  }
  const cmin = num(s.count_min, 0), cmax = num(s.count_max, 0);
  const count = areas.length;
  return resultado(s, count >= cmin && count <= cmax ? PASS : FAIL, {
    value: count, expected: `${cmin}–${cmax}`, detail: { threshold: thr, areas }, overlays: ov,
  });
}

// ------------------------------------------------------------------ paquímetro

function caliper(img, s, ctx) {
  const ppm = ctx.pxPorMm;
  if (!ppm) throw new Error('px_per_mm não calibrado (use a régua das Ferramentas de mouse ou informe px/mm no programa)');
  const [x0, y0] = s.p0, [x1, y1] = s.p1;
  const length = Math.trunc(Math.hypot(x1 - x0, y1 - y0));
  const nP = Math.max(length, 2);
  const L1 = Math.max(length, 1);
  const nx = -(y1 - y0) / L1, ny = (x1 - x0) / L1;
  const width = Math.max(1, Math.round(num(s.width, 9)));
  const meia = Math.floor(width / 2);
  // cinza só da caixa em volta da linha (o Inspect converte a imagem inteira)
  const marg = meia + 3;
  const bx = Math.max(0, Math.floor(Math.min(x0, x1) - marg)), by = Math.max(0, Math.floor(Math.min(y0, y1) - marg));
  const bx1 = Math.min(img.width, Math.ceil(Math.max(x0, x1) + marg) + 1), by1 = Math.min(img.height, Math.ceil(Math.max(y0, y1) + marg) + 1);
  const rr = { x: bx, y: by, w: Math.max(1, bx1 - bx), h: Math.max(1, by1 - by) };
  const g = cinza(img, rr);
  const prof = buf('paq.prof', Float64Array, nP);
  const nOff = 2 * meia + 1;
  for (let i = 0; i < nP; i++) {
    const t = nP > 1 ? i / (nP - 1) : 0;
    const cx = x0 + (x1 - x0) * t, cy = y0 + (y1 - y0) * t;
    let s0 = 0;
    for (let o = -meia; o <= meia; o++) {
      const X = cx + o * nx, Y = cy + o * ny;
      // fora da imagem vale 0 (borda constante do remap); dentro, a caixa cobre
      s0 += X < -1 || Y < -1 || X > img.width || Y > img.height ? 0 : bilinear(g, rr.w, rr.h, X - bx, Y - by);
    }
    prof[i] = s0 / nOff;
  }
  /*
   * O Inspect passa o perfil por GaussianBlur((1,5)) numa imagem de UMA
   * linha: o núcleo é vertical e a borda REFLECT_101 de uma linha só a
   * repete — o desfoque não muda nada. Aqui ele foi omitido de propósito,
   * para dar o mesmo número.
   */
  const grad = buf('paq.grad', Float64Array, nP);
  for (let i = 0; i < nP; i++) {
    grad[i] = i === 0 ? prof[1] - prof[0] : i === nP - 1 ? prof[nP - 1] - prof[nP - 2] : (prof[i + 1] - prof[i - 1]) / 2;
  }
  const cmin = num(s.edge_min_contrast, 20);
  let iA = -1, iB = -1;
  for (let i = 0; i < nP; i++) if (Math.abs(grad[i]) >= cmin) { if (iA < 0) iA = i; iB = i; }
  const nom = num(s.nominal_mm, 0), tol = num(s.tol_mm, 0);
  const esperado = `${nom}±${tol} mm`;
  if (iA < 0 || iA === iB) {
    return resultado(s, FAIL, { value: null, expected: esperado, detail: { reason: 'bordas não encontradas' },
      overlays: [{ kind: 'line', p0: s.p0, p1: s.p1 }] });
  }
  const subpix = (i) => {
    if (i > 0 && i < nP - 1) {
      const a = Math.abs(grad[i - 1]), b = Math.abs(grad[i]), c = Math.abs(grad[i + 1]);
      const den = a - 2 * b + c;
      return i + (den ? (0.5 * (a - c)) / den : 0);
    }
    return i;
  };
  const subir = (i, p) => { while (i + p >= 0 && i + p < nP && Math.abs(grad[i + p]) >= Math.abs(grad[i])) i += p; return i; };
  const e0 = subpix(subir(iA, 1)), e1 = subpix(subir(iB, -1));
  const mm = ((e1 - e0) * (length / Math.max(nP - 1, 1))) / ppm;
  const st = julgarFaixa(mm, nom - tol, nom + tol, banda(s));
  const pt = (e) => [Math.trunc(x0 + ((x1 - x0) * e) / Math.max(nP - 1, 1)), Math.trunc(y0 + ((y1 - y0) * e) / Math.max(nP - 1, 1))];
  return resultado(s, st, {
    value: r4(mm), expected: esperado,
    detail: { edges_px: [r2(e0), r2(e1)], px_per_mm: r4(ppm) },
    overlays: [{ kind: 'line', p0: s.p0, p1: s.p1 }, { kind: 'point', p: pt(e0) }, { kind: 'point', p: pt(e1) },
               { kind: 'text', p: pt((e0 + e1) / 2), text: `${mm.toFixed(3)} mm` }],
  });
}

// ------------------------------------------------------------------ cor

const L8 = [0, 0, 0];
/** Mediana Lab (escala CIE) da região: histograma por canal, mediana do numpy (média dos dois do meio). */
export function labMediana(img, r) {
  const hL = buf('cor.hL', Int32Array, 256).fill(0), hA = buf('cor.hA', Int32Array, 256).fill(0), hB = buf('cor.hB', Int32Array, 256).fill(0);
  const W = img.width, d = img.data;
  for (let y = 0; y < r.h; y++) {
    let p = ((r.y + y) * W + r.x) * 4;
    for (let x = 0; x < r.w; x++, p += 4) { lab8(d[p], d[p + 1], d[p + 2], L8); hL[L8[0]]++; hA[L8[1]]++; hB[L8[2]]++; }
  }
  const n = r.w * r.h;
  const med = (h) => {
    const k1 = (n - 1) >> 1, k2 = n >> 1;
    let acc = 0, v1 = -1, v2 = -1;
    for (let i = 0; i < 256; i++) {
      acc += h[i];
      if (v1 < 0 && acc > k1) v1 = i;
      if (acc > k2) { v2 = i; break; }
    }
    return (v1 + v2) / 2;
  };
  return [(med(hL) * 100) / 255, med(hA) - 128, med(hB) - 128];
}

function color(img, s) {
  const r = recorte(img, s.roi);
  const meas = labMediana(img, r);
  const ref = (s.ref_lab || [50, 0, 0]).map(Number);
  const de = deltaE2000(meas, ref);
  const max = num(s.max_delta_e, 3);
  return resultado(s, julgarFaixa(de, null, max, banda(s)), {
    value: r3(de), expected: `ΔE00 ≤ ${max}`, detail: { lab: meas.map(r2), ref_lab: ref }, overlays: roiOv(s),
  });
}

// ------------------------------------------------------------------ objeto (máscara, forma)

/**
 * object_mask do Inspect: desfoque, Otsu, polaridade pela borda ("auto": o
 * fundo toca a borda), abertura + fechamento (elipse 5×5) e furos tapados —
 * mancha, queimado ou furo DENTRO do objeto é defeito, não fundo.
 */
export function mascaraObjeto(img, r, polaridade = 'auto') {
  const n = r.w * r.h, w = r.w, h = r.h;
  const g = desfoque5(cinza(img, r), w, h);
  const t = otsu(g, n);
  const m = limiarizar(g, n, t, false, buf('obj.m', Uint8Array, n));
  let inverter = polaridade === 'dark';
  if (polaridade === 'auto') {
    let s = 0, k = 0;
    for (let x = 0; x < w; x++) { s += m[x] + m[(h - 1) * w + x]; k += 2; }
    for (let y = 0; y < h; y++) { s += m[y * w] + m[y * w + w - 1]; k += 2; }
    inverter = s / k > 127;
  }
  if (inverter) for (let i = 0; i < n; i++) m[i] = 255 - m[i];
  abrirFechar(m, w, h);
  taparFuros(m, w, h);
  return m;
}

const CONT = new ListaI32('forma.cont'), CASCO = new ListaI32('forma.casco');

/** shape_metrics: o maior objeto (área do contorno ≥ min_area) e as suas medidas, ou null. */
export function medidasForma(m, w, h, minArea) {
  const cc = componentes(m, w, h);
  let melhor = null, nObj = 0;
  for (let k = 1; k <= cc.n; k++) {
    if (cc.area[k] < minArea) continue;               // área do contorno < nº de pixels: não passaria
    contornoExterno(cc.lab, w, h, k, cc.x0[k], cc.y0[k], CONT);
    const a = areaContorno(CONT.a, CONT.n);
    if (a < minArea) continue;
    nObj++;
    if (!melhor || a > melhor.area) {
      const per = perimetro(CONT.a, CONT.n);
      casco(CONT.a, CONT.n, CASCO);
      const aH = areaContorno(CASCO.a, CASCO.n);
      const mr = retanguloMinimo(CASCO.a, CASCO.n);
      const passo = Math.max(1, Math.floor((CONT.n >> 1) / 120));
      const pts = [];
      for (let i = 0; i < CONT.n >> 1; i += passo) pts.push([CONT.a[2 * i], CONT.a[2 * i + 1]]);
      melhor = {
        area: a, per, aH, mr, pts,
        bbox: [cc.x0[k], cc.y0[k], cc.x1[k] - cc.x0[k] + 1, cc.y1[k] - cc.y0[k] + 1],
      };
    }
  }
  if (!melhor) return null;
  const { area, per, aH, mr } = melhor;
  return {
    area_px: area, perimeter_px: per, circularity: per ? (4 * Math.PI * area) / (per * per) : 0,
    solidity: aH ? area / aH : 0, aspect: Math.max(mr.w, mr.h) / Math.max(Math.min(mr.w, mr.h), 1e-6),
    angle: mr.angulo, bbox: melhor.bbox, n_objects: nObj, contour: melhor.pts,
  };
}

function shape(img, s, ctx) {
  const r = recorte(img, s.roi);
  const mask = mascaraObjeto(img, r, s.polarity || 'auto');
  const m = medidasForma(mask, r.w, r.h, num(s.min_area_px, 500));
  if (!m) return resultado(s, FAIL, { expected: 'objeto presente', detail: { reason: 'objeto não encontrado' }, overlays: roiOv(s) });
  const ppm = ctx.pxPorMm, b = banda(s);
  const checks = [];
  if (s.eq_diam_mm && ppm) {
    const [nom, tol] = s.eq_diam_mm.map(Number);
    const d = (2 * Math.sqrt(m.area_px / Math.PI)) / ppm;
    checks.push(['diâmetro eq.', julgarFaixa(d, nom - tol, nom + tol, b), d, `${nom}±${tol} mm`]);
  }
  if (s.area_mm2 && ppm) {
    const [lo, hi] = s.area_mm2.map(Number);
    const a = m.area_px / (ppm * ppm);
    checks.push(['área', julgarFaixa(a, lo, hi, b), a, `${lo}–${hi} mm²`]);
  }
  if (s.circularity_min != null) {
    const c = +s.circularity_min;
    checks.push(['circularidade', julgarFaixa(m.circularity, c, null, b, 1 - c), m.circularity, `≥ ${c}`]);
  }
  if (s.aspect_range) {
    const [lo, hi] = s.aspect_range.map(Number);
    checks.push(['alongamento', julgarFaixa(m.aspect, lo, hi, b), m.aspect, `${lo}–${hi}`]);
  }
  if (s.solidity_min != null) {
    const c = +s.solidity_min;
    checks.push(['solidez', julgarFaixa(m.solidity, c, null, b, 1 - c), m.solidity, `≥ ${c}`]);
  }
  let st = PASS, pior = null;
  for (const c of checks) if (!pior || RANK[c[1]] > RANK[pior[1]]) pior = c;
  if (pior) st = pior[1];
  const [x, y, w, h] = m.bbox;
  const contour = m.contour.map(([px, py]) => [px + r.x, py + r.y]);
  const det = {};
  for (const k of ['area_px', 'perimeter_px', 'circularity', 'solidity', 'aspect', 'angle', 'n_objects']) det[k] = typeof m[k] === 'number' && !Number.isInteger(m[k]) ? r4(m[k]) : m[k];
  if (ppm) det.eq_diam_mm = r4((2 * Math.sqrt(m.area_px / Math.PI)) / ppm);
  det.checks = checks.map((c) => ({ name: c[0], status: c[1], value: r4(c[2]), expected: c[3] }));
  return resultado(s, st, {
    value: pior ? r4(pior[2]) : Math.round(m.area_px * 10) / 10,
    expected: checks.map((c) => `${c[0]} ${c[3]}`).join('; '), detail: det,
    overlays: [...roiOv(s), { kind: 'poly', pts: contour }, { kind: 'box', x: r.x + x, y: r.y + y, w, h }],
  });
}

// ------------------------------------------------------------------ área de defeito

/**
 * Faixas HSV prontas (H 0–179, S e V 0–255, como no OpenCV). As do Inspect
 * (queimado, azul, metal) são as do programa de demonstração P-BISC55; as
 * outras são pontos de partida — ajuste com o conta-gotas na sua luz.
 */
export const FAIXAS_HSV = {
  queimado: { name: 'queimado', h: [0, 179], s: [0, 255], v: [0, 55] },
  ferrugem: { name: 'ferrugem', h: [5, 20], s: [110, 255], v: [50, 200] },
  mofo: { name: 'mofo', h: [35, 90], s: [40, 255], v: [40, 210] },
  corpo_azul: { name: 'azul', h: [95, 130], s: [80, 255], v: [60, 255] },
  metal: { name: 'metal', h: [0, 179], s: [0, 25], v: [170, 255] },
  escuro: { name: 'escuro', h: [0, 179], s: [0, 255], v: [0, 55] },
};

function defectArea(img, s) {
  const r = recorte(img, s.roi);
  const n = r.w * r.h;
  const H = hsv(img, r);
  let obj = null, denom = n;
  if (s.within_object !== false) {
    obj = mascaraObjeto(img, r, 'auto');
    denom = 0;
    for (let i = 0; i < n; i++) if (obj[i]) denom++;
    denom = Math.max(denom, 1);
  }
  const total = buf('def.total', Uint8Array, n).fill(0);
  const porFaixa = {};
  const faixas = (s.ranges || []).length ? s.ranges : [FAIXAS_HSV.queimado];
  for (const f of faixas) {
    const h = f.h || [0, 179], sa = f.s || [0, 255], v = f.v || [0, 255];
    let c = 0;
    for (let i = 0, q = 0; i < n; i++, q += 3) {
      if (obj && !obj[i]) continue;
      if (H[q] >= h[0] && H[q] <= h[1] && H[q + 1] >= sa[0] && H[q + 1] <= sa[1] && H[q + 2] >= v[0] && H[q + 2] <= v[1]) { c++; total[i] = 255; }
    }
    porFaixa[f.name || 'faixa'] = r3((100 * c) / denom);
  }
  const cc = componentes(total, r.w, r.h);
  const minSpot = num(s.min_spot_px, 12);
  const manchas = [];
  let soma = 0;
  for (let k = 1; k <= cc.n; k++) if (cc.area[k] >= minSpot) { manchas.push(k); soma += cc.area[k]; }
  const pct = (100 * soma) / denom;
  const maxPct = num(s.max_pct, 5);
  let st = julgarFaixa(pct, null, maxPct, banda(s));
  const maxSpots = s.max_spots == null || s.max_spots === '' ? null : +s.max_spots;
  if (maxSpots != null && manchas.length > maxSpots) st = FAIL;
  const ov = roiOv(s);
  manchas.sort((a, b) => cc.area[b] - cc.area[a]);
  for (const k of manchas.slice(0, 25)) ov.push({ kind: 'box', x: r.x + cc.x0[k], y: r.y + cc.y0[k], w: cc.x1[k] - cc.x0[k] + 1, h: cc.y1[k] - cc.y0[k] + 1, tone: 'bad' });
  return resultado(s, st, {
    value: r3(pct), expected: `≤ ${maxPct}%` + (maxSpots != null ? `, ≤ ${maxSpots} manchas` : ''),
    detail: { spots: manchas.length, by_range: porFaixa, object_px: denom }, overlays: ov,
  });
}

// ------------------------------------------------------------------ parte 2: leitura e modelos (assíncronas)

/**
 * crop() do Inspect: a região da ROI (presa à imagem) COPIADA — o quadro do
 * pipeline é reaproveitado, e a leitura só acontece depois de um await.
 */
export function recortarRegiao(img, roi) {
  const W = img.width, H = img.height;
  if (!roi) return { reg: { width: W, height: H, data: new Uint8ClampedArray(img.data) }, ox: 0, oy: 0 };
  const x0 = Math.max(0, Math.min(roi.x, W - 1)), y0 = Math.max(0, Math.min(roi.y, H - 1));
  const x1 = Math.min(roi.x + roi.w, W), y1 = Math.min(roi.y + roi.h, H);
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(img.data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return { reg: { width: w, height: h, data }, ox: x0, oy: y0 };
}

let MODELOS = null;
const modelos = () => (MODELOS = MODELOS || import('./modelos.js'));

async function ocrMarcacao(img, s, ctx) {
  const { reg, ox, oy } = recortarRegiao(img, s.roi);
  const linhas = await (await modelos()).lerTexto(reg);
  return julgarOcr(linhas, s, ctx, ox, oy);
}

async function codigo(img, s, ctx) {
  const { reg, ox, oy } = recortarRegiao(img, s.roi);
  const achados = await (await modelos()).lerCodigos(reg);
  return julgarCodigo(achados, s, ctx, ox, oy);
}

async function serial(img, s, ctx) {
  const { reg, ox, oy } = recortarRegiao(img, s.roi);
  const Mo = await modelos();
  const linhas = s.source === 'code'
    ? (await Mo.lerCodigos(reg)).slice(0, 1).map((c) => ({ text: c.text, score: 1, poly: c.pts && c.pts.length ? c.pts : [[0, 0]] }))
    : await Mo.lerTexto(reg);
  return julgarSerial(linhas, s, ctx, ox, oy);
}

async function deteccao(img, s) {
  const { reg, ox, oy } = recortarRegiao(img, s.roi);
  const Mo = await modelos();
  const r = await Mo.detectar(reg, s);
  // COCO: o iaVision rotula em português; classe exigida/proibida em inglês (programa do Inspect) vale também
  const pt = (k) => (r.coco && Mo.COCO_EN_PT[k]) || k;
  const sp = r.coco ? { ...s, require: Object.fromEntries(Object.entries(s.require || {}).map(([k, v]) => [pt(k), v])), forbid: (s.forbid || []).map(pt) } : s;
  const out = julgarDeteccao(r.dets, r.rotulos, sp, ox, oy, r.formato);
  out.detail.modelo = r.modelo;
  return out;
}

async function classificacao(img, s) {
  const { reg } = recortarRegiao(img, s.roi);
  const r = await (await modelos()).classificar(reg, s);
  // calibração: a da ferramenta (Calibrar no editor) > a do modelo publicado > T = 1, q̂ = 0,9 (padrão do Inspect)
  const cal = s.calibration && s.calibration.qhat != null ? s.calibration : r.cal || {};
  const out = julgarClassificacao(r.logits, r.rotulos, cal, s);
  out.detail.modelo = r.modelo;
  out.logits = r.logits;            // só em memória: amostra de calibração ("Calibrar" no editor)
  return out;
}

async function anomalia(img, s) {
  const { reg, ox, oy } = recortarRegiao(img, s.roi);
  const r = await (await modelos()).anomalia(reg, s);
  const out = julgarAnomalia(r.nota, r.mapa, r.cal, r.limiar, s, { x: ox, y: oy, w: reg.width, h: reg.height });
  Object.assign(out.detail, { modelo: r.modelo, calibracao: r.origem });
  return out;
}

const lista = (v) => (Array.isArray(v) ? v.join(', ') : '');

// ------------------------------------------------------------------ catálogo

/**
 * Catálogo das ferramentas. `roi`: 'area' (retângulo/polígono/elipse; vale a
 * caixa) ou 'linha' (linha/régua: p0→p1). `funcao`: a função da marcação
 * (Ferramentas de mouse) que serve de ROI. `mm`: precisa de px/mm.
 */
export const FERRAMENTAS = {
  presence: {
    rotulo: 'Presença (molde NCC)', curto: 'Presença', roi: 'area', funcao: 'ins_presenca', rodar: presence,
    criterio: (t) => `NCC ≥ ${t.min_score ?? 0.8}`,
    esqueleto: { type: 'presence', code: 'PRESENCA', name: 'Presença', template_key: 'PRESENCA', min_score: 0.8, folga: 0.25 },
  },
  blob_count: {
    rotulo: 'Contagem (blobs)', curto: 'Contagem', roi: 'area', funcao: 'ins_blobs', rodar: blobCount,
    criterio: (t) => `${t.count_min}–${t.count_max} manchas`,
    esqueleto: { type: 'blob_count', code: 'CONTAGEM', name: 'Contagem', polarity: 'dark', threshold: null, min_area: 30, max_area: 5000, count_min: 4, count_max: 4 },
  },
  caliper: {
    rotulo: 'Paquímetro (mm)', curto: 'Paquímetro', roi: 'linha', funcao: 'ins_paquimetro', rodar: caliper, mm: true,
    criterio: (t) => `${t.nominal_mm} ± ${t.tol_mm} mm`,
    esqueleto: { type: 'caliper', code: 'DIAM', name: 'Diâmetro', p0: [40, 300], p1: [560, 300], width: 9, edge_min_contrast: 20, nominal_mm: 38, tol_mm: 0.25 },
  },
  color: {
    rotulo: 'Cor (ΔE2000)', curto: 'Cor', roi: 'area', funcao: 'ins_cor', rodar: color,
    criterio: (t) => `ΔE00 ≤ ${t.max_delta_e ?? 3}`,
    esqueleto: { type: 'color', code: 'COR', name: 'Cor', ref_lab: [50, 0, 0], max_delta_e: 3 },
  },
  shape: {
    rotulo: 'Forma do objeto', curto: 'Forma', roi: 'area', funcao: 'ins_forma', rodar: shape,
    mmSe: (t) => Boolean(t.eq_diam_mm || t.area_mm2),
    criterio: (t) => [t.eq_diam_mm && `Ø ${t.eq_diam_mm[0]}±${t.eq_diam_mm[1]} mm`, t.area_mm2 && `área ${t.area_mm2[0]}–${t.area_mm2[1]} mm²`,
      t.circularity_min != null && `circ. ≥ ${t.circularity_min}`, t.solidity_min != null && `solidez ≥ ${t.solidity_min}`,
      t.aspect_range && `aspecto ${t.aspect_range.join('–')}`].filter(Boolean).join(' · ') || 'objeto presente',
    esqueleto: { type: 'shape', code: 'FORMA', name: 'Forma', polarity: 'auto', min_area_px: 500, eq_diam_mm: null, circularity_min: 0.85, solidity_min: 0.95 },
  },
  defect_area: {
    rotulo: 'Área de defeito (HSV)', curto: 'Defeito', roi: 'area', funcao: 'ins_defeito', rodar: defectArea,
    criterio: (t) => `≤ ${t.max_pct}%${t.max_spots != null ? ` · ≤ ${t.max_spots} manchas` : ''}`,
    esqueleto: { type: 'defect_area', code: 'MANCHA', name: 'Área de defeito', ranges: [FAIXAS_HSV.queimado], within_object: true, max_pct: 4, min_spot_px: 20, max_spots: null },
  },
  ocr: {
    rotulo: 'OCR de marcação (lote/validade)', curto: 'OCR', roi: 'area', funcao: 'ins_ocr', rodar: ocrMarcacao, assinc: true,
    criterio: (t) => [t.expected && `= ${t.expected}`, t.pattern && `/${t.pattern}/`, t.field === 'date' && t.min_days_valid != null && `validade ≥ ${t.min_days_valid} d`,
      `conf ≥ ${t.min_char_conf ?? 0.8}`].filter(Boolean).join(' · '),
    esqueleto: { type: 'ocr', code: 'LOTE', name: 'Lote impresso', field: 'lot', pattern: null, expected: '{LOT}', date_format: '%d/%m/%Y', min_char_conf: 0.8, min_days_valid: null },
  },
  code: {
    rotulo: 'Código 1D/2D (QR, DataMatrix, EAN…)', curto: 'Código', roi: 'area', funcao: 'ins_codigo', rodar: codigo, assinc: true,
    criterio: (t) => [lista(t.formats) || 'qualquer formato', t.gs1 && 'GS1', t.expect_gtin && `GTIN ${t.expect_gtin}`, t.pattern && `/${t.pattern}/`, t.expected && `= ${t.expected}`].filter(Boolean).join(' · '),
    esqueleto: { type: 'code', code: 'CODIGO', name: 'Código', formats: ['QRCode', 'DataMatrix', 'Code128', 'EAN13'], pattern: null, gs1: false, expect_gtin: null },
  },
  serial: {
    rotulo: 'Número de série (sequência)', curto: 'Serial', roi: 'area', funcao: 'ins_serial', rodar: serial, assinc: true,
    criterio: (t) => `/${t.pattern}/${t.check_sequence !== false ? ` · salto > ${t.max_gap ?? 1} = INCERTO` : ''}`,
    esqueleto: { type: 'serial', code: 'SERIE', name: 'Número de série', pattern: 'SN(?P<n>\\d{6})', min_char_conf: 0.85, check_sequence: true, max_gap: 1, source: 'ocr' },
  },
  detect: {
    rotulo: 'Detector de objetos (YOLOX/RF-DETR)', curto: 'Detector', roi: 'area', funcao: 'ins_detect', rodar: deteccao, assinc: true, modelo: true,
    criterio: (t) => [t.require && Object.keys(t.require).length && `exige ${Object.entries(t.require).map(([k, v]) => `${k} ${v[0]}–${v[1]}`).join(', ')}`,
      t.forbid && t.forbid.length && `proíbe ${t.forbid.join(', ')}`].filter(Boolean).join(' · ') + ` · conf ${t.conf ?? 0.35}` || 'sem regra',
    esqueleto: { type: 'detect', code: 'OBJETOS', name: 'Objetos', modelo: 'yolox', model_id: 0, conf: 0.35, require: {}, forbid: [] },
  },
  classify: {
    rotulo: 'Classificação conformal', curto: 'Classificação', roi: 'area', funcao: 'ins_classif', rodar: classificacao, assinc: true, modelo: true,
    criterio: (t) => `∈ ${lista(t.ok_labels)} · conjunto ≠ 1 = INCERTO`,
    esqueleto: { type: 'classify', code: 'CLASSE', name: 'Classe', modelo: 'mobilenetv2', model_id: 0, ok_labels: ['ok'], alpha: 0.1, calibration: null },
  },
  anomaly: {
    rotulo: 'Anomalia (PatchCore)', curto: 'Anomalia', roi: 'area', funcao: 'ins_anomalia', rodar: anomalia, assinc: true, modelo: true,
    criterio: (t) => `nota ≤ ${t.threshold ?? 'limiar calibrado'}`,
    esqueleto: { type: 'anomaly', code: 'ANOMALIA', name: 'Anomalia', modelo: '', model_id: 0, threshold: null },
  },
};

/** Tipos do Inspect ainda sem porte (aceitos ao importar, guardados, desativados). Com a parte 2, nenhum. */
export const PENDENTES = {};

/** Roda uma ferramenta com medição de tempo; exceção → ERROR auditável. */
export function rodarFerramenta(img, spec, ctx) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  let r;
  const def = FERRAMENTAS[spec.type];
  try {
    if (!def) throw new Error(PENDENTES[spec.type] ? `${PENDENTES[spec.type]}: ainda sem porte` : `ferramenta desconhecida: ${spec.type}`);
    if (def.assinc) throw new Error('ferramenta com leitura/modelo: use rodarFerramentaAssinc');
    r = def.rodar(img, spec, ctx || {});
  } catch (e) {
    r = resultado(spec, ERROR, { detail: { error: String(e && e.message ? e.message : e) }, overlays: roiOv(spec) });
  }
  r.ms = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
  return r;
}

/**
 * Roda qualquer ferramenta e devolve uma Promise do resultado. As assíncronas
 * esperam no máximo `prazoMs`: estourou = INCERTO ("sem resposta do modelo"),
 * exceção = ERRO — nunca OK em silêncio. A região é copiada na chamada (antes
 * do primeiro await), então o quadro pode mudar depois.
 */
export async function rodarFerramentaAssinc(img, spec, ctx, prazoMs = 20000) {
  const def = FERRAMENTAS[spec.type];
  if (!def || !def.assinc) return rodarFerramenta(img, spec, ctx);
  const relogio = typeof performance !== 'undefined' ? performance : Date;
  const t0 = relogio.now();
  let r, timer = null;
  try {
    const p = def.rodar(img, spec, ctx || {});
    r = await Promise.race([p, new Promise((_, nao) => { timer = setTimeout(() => nao(Object.assign(new Error('prazo'), { prazo: true })), prazoMs); })]);
  } catch (e) {
    r = e && e.prazo
      ? resultado(spec, UNCERTAIN, { detail: { reason: `sem resposta do modelo em ${Math.round(prazoMs / 100) / 10} s (carregando?) — humano confirma` }, overlays: roiOv(spec) })
      : resultado(spec, ERROR, { detail: { error: String(e && e.message ? e.message : e) }, overlays: roiOv(spec) });
  } finally { clearTimeout(timer); }
  r.ms = relogio.now() - t0;
  return r;
}

/** A ferramenta lê ou roda modelo (assíncrona)? */
export const ehAssinc = (tipo) => Boolean(FERRAMENTAS[tipo] && FERRAMENTAS[tipo].assinc);

export { PASS, FAIL, UNCERTAIN, ERROR, fmtN };
