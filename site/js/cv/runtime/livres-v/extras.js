/**
 * cv/runtime/livres-v/extras.js — CV-88 Motion 3D Studio v2: mãos e rosto da cadeia levados ao
 * referencial 3D da captura (o do MoCap do GPlanSiS|ROBO: y para cima, +x = esquerda da pessoa,
 * +z = frente), para o retarget dos dedos e da cabeça e para as expressões do avatar.
 *
 * Mãos (maos.gestos, ctx.hands): 21 pontos em 0..1 do quadro + z relativo (escala de x). Viram
 * DIREÇÕES no mundo (a escala absoluta não importa ao retarget): x da imagem NÃO espelhada,
 * −y, −z. A mão vai para o lado do punho da pose mais próximo (o rótulo do modelo de mão erra
 * mais que a distância ao punho).
 *
 * Rosto (rosto.malha, ctx.faceMesh): 478 pontos. Daqui sai (1) o referencial da cabeça — eixo
 * esquerdo (canto externo de um olho ao outro) e eixo para cima (queixo → testa) — e (2) os
 * coeficientes no estilo ARKit por GEOMETRIA (sem modelo de blendshapes): piscar por olho
 * (razão de abertura), boca aberta, sorriso, bico, boca larga, sobrancelhas e olhar (íris).
 * Com a imagem espelhada os rótulos do rosto trocam de lado (o modelo de malha vê o rosto
 * espelhado), então o olho "33" passa a ser o esquerdo. Puras e testáveis no node.
 */

const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cl = (v) => Math.min(1, Math.max(0, v));

/** 21 pontos de uma mão (0..1) → 21 × [x, y, z] (direções no mundo da captura, metros de imagem). */
export function maoParaMundo(pts, esp, iw, ih) {
  if (!pts || pts.length < 21) return null;
  const o = pts[0], sx = esp ? -iw : iw;
  return pts.map((q) => [+((q.x - o.x) * sx).toFixed(5), +(-(q.y - o.y) * ih).toFixed(5), +(-((q.z || 0) - (o.z || 0)) * iw).toFixed(5)]);
}

/** Atribui as mãos aos lados pelo punho da pose (P2 em 0..1): { L, R } (pts 0..1) ou null. */
export function associarMaos(maos, P2) {
  const out = { L: null, R: null };
  if (!Array.isArray(maos) || !maos.length) return out;
  const pulsos = { L: P2 && P2[15], R: P2 && P2[16] };
  const livres = maos.filter((m) => m && Array.isArray(m.pts) && m.pts.length >= 21);
  for (const s of ['L', 'R']) {
    const p = pulsos[s];
    let melhor = null, dm = Infinity;
    for (const m of livres) {
      if (m === out.L || m === out.R) continue;
      const d = p ? d2(m.pts[0], p) : (m.lado === (s === 'L' ? 'esquerda' : 'direita') ? 0 : Infinity);
      if (d < dm) { dm = d; melhor = m; }
    }
    // mais longe que ~15 % do quadro do punho: não é desta pessoa
    if (melhor && (!p || dm < 0.15)) out[s] = melhor;
  }
  return out;
}

// índices da malha de 478 pontos (MediaPipe Face Mesh)
const OLHO_A = { cima: 159, baixo: 145, ext: 33, int: 133 };       // olho da DIREITA da pessoa (imagem não espelhada)
const OLHO_B = { cima: 386, baixo: 374, ext: 263, int: 362 };      // olho da ESQUERDA da pessoa
const BOCA = { cima: 13, baixo: 14, cantoA: 61, cantoB: 291, labioSup: 0, labioInf: 17 };
const TESTA = 10, QUEIXO = 152, SOBR_A = 105, SOBR_B = 334, IRIS_A = 468, IRIS_B = 473;

/**
 * Malha do rosto → { esq, cima (eixos da cabeça no mundo), bs (coeficientes 0..1) }.
 * `estado` (objeto do chamador) guarda a calibração adaptativa (neutro de cada pessoa).
 */
export function rostoParaCoef(f, esp, iw, ih, estado = {}) {
  const p = f && f.pts;
  if (!p || p.length < 468) return null;
  const P = (i) => ({ x: p[i].x * iw * (esp ? -1 : 1), y: p[i].y * ih, z: (p[i].z || 0) * iw });
  const mundo = (a, b) => { const A = P(a), B = P(b); return [B.x - A.x, -(B.y - A.y), -(B.z - A.z)]; };
  // eixo esquerdo: do olho da direita ao da esquerda (com espelho, os rótulos trocam)
  let esq = mundo(OLHO_A.ext, OLHO_B.ext);
  if (esp) esq = esq.map((v) => -v);
  const cima = mundo(QUEIXO, TESTA);
  const alt = Math.max(1e-6, d2(P(TESTA), P(QUEIXO)));
  const ear = (o) => d2(P(o.cima), P(o.baixo)) / Math.max(1e-6, d2(P(o.ext), P(o.int)));
  let earDir = ear(OLHO_A), earEsq = ear(OLHO_B);
  if (esp) [earDir, earEsq] = [earEsq, earDir];
  // calibração: abertura típica do olho aberto = máximo lento
  estado.olhoAberto = Math.max(0.2, (estado.olhoAberto || 0.28) * 0.995, Math.max(earDir, earEsq) * 0.98);
  const fech = 0.09, ab = estado.olhoAberto;
  const piscar = (e) => cl((ab - e) / Math.max(0.05, ab - fech));
  const abertura = d2(P(BOCA.cima), P(BOCA.baixo)) / alt;
  const largura = d2(P(BOCA.cantoA), P(BOCA.cantoB)) / Math.max(1e-6, d2(P(OLHO_A.ext), P(OLHO_B.ext)));
  estado.larguraNeutra = estado.larguraNeutra == null ? largura : estado.larguraNeutra * 0.998 + largura * 0.002;
  const lw = estado.larguraNeutra;
  // sorriso: cantos acima do centro dos lábios
  const centroY = (P(BOCA.labioSup).y + P(BOCA.labioInf).y) / 2;
  const subida = (centroY - (P(BOCA.cantoA).y + P(BOCA.cantoB).y) / 2) / alt;
  const sobr = ((d2(P(SOBR_A), P(OLHO_A.cima)) + d2(P(SOBR_B), P(OLHO_B.cima))) / 2) / alt;
  estado.sobrNeutra = estado.sobrNeutra == null ? sobr : estado.sobrNeutra * 0.998 + sobr * 0.002;
  // olhar: posição da íris entre os cantos (−1..1)
  let olharX = 0, olharY = 0;
  if (p.length >= 478) {
    const g = (o, ir) => { const A = P(o.ext), B = P(o.int), I = P(ir); const L = Math.max(1e-6, B.x - A.x); return { x: ((I.x - A.x) / L - 0.5) * 2, y: (I.y - (P(o.cima).y + P(o.baixo).y) / 2) / Math.max(1e-6, Math.abs(L)) }; };
    const a = g(OLHO_A, IRIS_A), b = g(OLHO_B, IRIS_B);
    olharX = Math.max(-1, Math.min(1, (a.x - b.x) / 2 * (esp ? -1 : 1)));
    olharY = Math.max(-1, Math.min(1, -(a.y + b.y) * 2.5));
  }
  const r2 = (v) => Math.round(v * 1000) / 1000;
  const bs = {
    eyeBlinkLeft: r2(piscar(earEsq)), eyeBlinkRight: r2(piscar(earDir)),
    jawOpen: r2(cl((abertura - 0.01) / 0.12)),
    mouthSmile: r2(cl((largura - lw) / 0.12 + subida * 6)),
    mouthPucker: r2(cl((lw - largura) / 0.1)),
    mouthWide: r2(cl((largura - lw) / 0.15) * (1 - cl(abertura / 0.08))),
    browInnerUp: r2(cl((sobr - estado.sobrNeutra) / 0.03)),
    olharX: r2(olharX), olharY: r2(olharY),
  };
  const r5 = (v) => v.map((x) => +x.toFixed(5));
  return { esq: r5(esq), cima: r5(cima), bs };
}

/** Extras de UM quadro para o canal: { maoL, maoR, rosto } ou null. */
export function extrasDoQuadro(r, estadoRosto) {
  if (!r || !r.w) return null;
  const esp = Boolean(r.esp);
  let ex = null;
  if (Array.isArray(r.maos) && r.maos.length && r.P) {
    const P2 = r.P.map((q) => (q ? { x: q.x / r.w, y: q.y / r.h } : null));
    const { L, R } = associarMaos(r.maos, P2);
    if (L || R) ex = { maoL: L ? maoParaMundo(L.pts, esp, r.w, r.h) : null, maoR: R ? maoParaMundo(R.pts, esp, r.w, r.h) : null };
  }
  if (Array.isArray(r.rosto) && r.rosto[0]) {
    const c = rostoParaCoef(r.rosto[0], esp, r.w, r.h, estadoRosto);
    if (c) ex = { ...(ex || {}), rosto: c };
  }
  return ex;
}
