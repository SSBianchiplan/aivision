/**
 * cv/runtime/livres-v/levantar.js — CV-88 Motion 3D Studio: LEVANTAMENTO 2D→3D COM RESTRIÇÕES.
 *
 * Por que: os pontos "do mundo" do BlazePose (W) erram a profundidade quando a perna dobra, some
 * atrás do corpo ou a pessoa está de costas — o boneco fica em pé, de pernas retas, flutuando,
 * enquanto o 2D está certo (ajoelhada sentada nos calcanhares, de costas: só os braços batiam).
 * Aqui o 3D é RECONSTRUÍDO a partir do 2D, osso a osso (Taylor 2000, câmera fraca-perspectiva):
 *   - comprimentos de osso fixos (percentil alto do W ao longo do tempo, com faixas antropométricas);
 *   - escala px/m pela envoltória: o osso mais "aberto" no quadro está quase de frente;
 *   - cada osso: Δx, Δy do 2D; |Δz| = √(L² − Δx² − Δy²); o SINAL de cada Δz é escolhido por custo:
 *       · concordância com a profundidade do W (peso maior no tronco e braços, menor nas pernas);
 *       · continuidade temporal (a solução anterior);
 *       · limites articulares: joelho só dobra para trás, tornozelo de −30° (dorsiflexão) até a
 *         ponta (~90° de flexão plantar, dança), quadril com extensão limitada (arabesque custa);
 *       · nariz à frente das orelhas; ombros e quadris sem torção absurda;
 *       · equilíbrio: com um pé só no chão, o centro de massa (Winter, do robo) sobre ele;
 *   - junta pouco visível (oclusão, tutu, costas) NÃO estica: herda o vetor do quadro anterior;
 *   - pernas fundidas no 2D (joelhos/tornozelos esquerdo e direito quase no mesmo ponto por vários
 *     quadros) ou trocadas (rótulos invertidos): a identidade de cada perna segue a continuidade; a
 *     perna "livre" fica com a solução temporal (ou com a segunda opinião do RTMO, se estiver na
 *     cadeia) em vez de colar nas duas;
 *   - chão: contatos (pés, pontas, calcanhares, joelhos, canelas, quadril sentado, mãos) pela
 *     altura relativa e velocidade; a raiz desce até o contato mais baixo (ajoelhada: joelhos e
 *     canelas no piso); pulo detectado pela linha do chão NA IMAGEM (câmera parada);
 *   - pé em contato fica TRAVADO (sem deslizar);
 *   - "para cima": inclinação da câmera estimada pelo plano dos contatos (ou manual);
 *   - de costas: a lateralidade vem dos rótulos 2D (esquerdo à esquerda da imagem = de costas), a
 *     normal do tronco sai do 3D reconstruído — nada é espelhado;
 *   - temporal: One Euro + limite de velocidade por junta.
 * Modo QUALIDADE (refinarTrilha): a mesma geração de candidatos, mas o sinal de cada grupo é
 * escolhido por Viterbi sobre a tomada inteira (menor custo total, sem trocas de sinal quadro a
 * quadro) e a raiz é suavizada nos dois sentidos; depois o Studio aplica o pós-processamento do
 * robo (lacunas, Butterworth de fase zero, ossos rígidos).
 *
 * Convenção de saída: a do MoCap do GPlanSiS|ROBO — metros, y para cima com o PISO em y = 0, +x =
 * esquerda da pessoa de frente para a câmera (= direita da imagem não espelhada), +z = para a
 * câmera. Puro (sem DOM, sem three): roda no canal, num Worker e no node (testes).
 */
import { OneEuro, centroDeMassa } from '../../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';

// ------------------------------------------------------------------ vetores
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norma(a); return n > 1e-9 ? mul(a, 1 / n) : [0, 0, 0]; };
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const meio = (a, b) => (a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null);
const ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));

/** Pesos da opinião do W (já condicionada pela coerência com o 2D). Exportado para os testes. */
export const PESOS = { tronco: 2.5, perna: 0.35, equilibrio: 12, reto: 0, extensao: 6 };

/** Comprimentos padrão (m) para 1,70 m e faixas relativas ao tronco (quadril→ombros). */
export const PADRAO = { tronco: 0.5, pelve: 0.2, ombros: 0.36, pescoco: 0.2, nariz: 0.1, orelhas: 0.15, braco: 0.29, antebraco: 0.26, coxa: 0.43, canela: 0.42, calcanhar: 0.08, pe: 0.16, mao: 0.08 };
const FAIXA = { pelve: [0.3, 0.55], ombros: [0.55, 0.9], pescoco: [0.25, 0.55], nariz: [0.12, 0.3], orelhas: [0.2, 0.4], braco: [0.45, 0.75], antebraco: [0.4, 0.65], coxa: [0.65, 1.05], canela: [0.6, 1.05], calcanhar: [0.08, 0.25], pe: [0.2, 0.45], mao: [0.1, 0.25] };
/** [osso, junta pai, junta filho] para medir no W (Q/O/E = centros de quadril, ombros e orelhas). */
const MEDIDAS = [['tronco', 'Q', 'O'], ['pelve', 23, 24], ['ombros', 11, 12], ['pescoco', 'O', 'E'], ['nariz', 'E', 0], ['orelhas', 7, 8],
  ['braco', 11, 13], ['braco', 12, 14], ['antebraco', 13, 15], ['antebraco', 14, 16], ['coxa', 23, 25], ['coxa', 24, 26], ['canela', 25, 27], ['canela', 26, 28],
  ['calcanhar', 27, 29], ['calcanhar', 28, 30], ['pe', 29, 31], ['pe', 30, 32], ['mao', 15, 19], ['mao', 16, 20]];
const DERIVADO = (q, k) => (k === 'Q' ? meio(q[23], q[24]) : k === 'O' ? meio(q[11], q[12]) : k === 'E' ? meio(q[7], q[8]) : q[k]);
/** Juntas candidatas a contato com o chão. */
const CONTATO = [29, 30, 31, 32, 27, 28, 25, 26, 23, 24, 15, 16, 19, 20];
const PERNAS = { L: [23, 25, 27, 29, 31], R: [24, 26, 28, 30, 32] };

/** Comprimentos a partir de amostras do W (percentil 85 de cada osso, faixas pelo tronco). */
export function comprimentos(amostrasW) {
  const L = { ...PADRAO };
  const tr = [];
  const por = {};
  for (const q of amostrasW) {
    if (!q) continue;
    for (const [n, a, b] of MEDIDAS) {
      const A = DERIVADO(q, a), B = DERIVADO(q, b);
      if (A && B) (por[n] = por[n] || []).push(norma(sub(A, B)));
    }
  }
  const pct = (xs, p) => { const s = xs.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
  if (por.tronco && por.tronco.length) tr.push(pct(por.tronco, 0.85));
  const tronco = tr.length ? Math.min(0.65, Math.max(0.38, tr[0])) : PADRAO.tronco;
  L.tronco = tronco;
  for (const n of Object.keys(PADRAO)) {
    if (n === 'tronco') continue;
    const v = por[n] && por[n].length >= 3 ? pct(por[n], 0.85) : PADRAO[n] * (tronco / PADRAO.tronco);
    const [lo, hi] = FAIXA[n];
    L[n] = Math.min(hi * tronco, Math.max(lo * tronco, v));
  }
  return L;
}

// ------------------------------------------------------------------ geometria de um quadro

/**
 * Entrada normalizada de um quadro: uv (px, imagem NÃO espelhada), vis, W relativo ao quadril.
 * `rtmo` (opcional): pontos COCO (px) da outra rede, para desempatar pernas fundidas.
 */
function prepararEntrada(P, w, h, esp, W) {
  const uv = P.map((p) => (p ? [esp ? w - p.x : p.x, p.y] : null));
  const vis = P.map((p) => (p ? (p.v == null ? 1 : p.v) : 0));
  const meio2 = (a, b) => (uv[a] && uv[b] ? [(uv[a][0] + uv[b][0]) / 2, (uv[a][1] + uv[b][1]) / 2] : null);
  uv.Q = meio2(23, 24); uv.O = meio2(11, 12); uv.E = meio2(7, 8);
  vis.Q = Math.min(vis[23], vis[24]); vis.O = Math.min(vis[11], vis[12]); vis.E = Math.max(vis[7], vis[8]);
  let Wr = null;
  if (W && W[23] && W[24]) {
    const q = meio(W[23], W[24]);
    Wr = W.map((p) => (p ? sub(p, q) : null));
    Wr.Q = [0, 0, 0]; Wr.O = meio(Wr[11], Wr[12]); Wr.E = meio(Wr[7], Wr[8]);
  }
  return { uv, vis, Wr, w, h };
}

/** Escala px/m: envoltória — o 2º maior "comprimento projetado / comprimento" entre os ossos visíveis. */
/** Câmera e raiz: f (px), centro, profundidade da raiz d = f/s, Q3 = raio do centro do quadril × d. */
function cameraRaiz(e, s, focal) {
  const f = focal * e.w, cx = e.w / 2, cy = e.h / 2, d = f / s;
  const K = { f, cx, cy, s, d };
  coerenciaW(e, s);
  e.Q3 = e.uv.Q ? [((e.uv.Q[0] - cx) / f) * d, (-(e.uv.Q[1] - cy) / f) * d, -d] : [0, 0, -d];
  return K;
}

function escalaObservada(e, L) {
  // Cada osso visível dá r = comprimento na imagem / comprimento real ≤ s (a projeção encurta).
  // Com o W, corrige pelo ângulo fora do plano (cos θ) e fica com a MEDIANA dos ossos quase no
  // plano (θ < 30°): o máximo puro é puxado pelo ruído — 3 % a mais de escala viram 14° de
  // profundidade inventada numa perna em pé. Sem W: a média dos 3 maiores.
  const r = [], rc = [];
  const bone = (a, b, Lb) => {
    const A = e.uv[a], B = e.uv[b];
    if (!A || !B || e.vis[a] <= 0.6 || e.vis[b] <= 0.6) return;
    const rb = Math.hypot(A[0] - B[0], A[1] - B[1]) / Lb;
    r.push(rb);
    const wa = e.Wr && e.Wr[a], wb = e.Wr && e.Wr[b];
    if (wa && wb) { const d = sub(wb, wa), n = norma(d); if (n > 1e-3) { const sn = Math.abs(d[2]) / n; if (sn < 0.5) rc.push(rb / Math.sqrt(1 - sn * sn)); } }
  };
  // só tronco, cintura escapular, pelve e braços: as pernas dobradas (ajoelhada, sentada) encurtam
  // na imagem e o W muitas vezes as dá retas — puxariam a escala para baixo
  bone('Q', 'O', L.tronco); bone(23, 24, L.pelve); bone(11, 12, L.ombros);
  bone(11, 13, L.braco); bone(12, 14, L.braco); bone(13, 15, L.antebraco); bone(14, 16, L.antebraco);
  if (rc.length >= 2) { rc.sort((a, b) => a - b); return rc[Math.floor(rc.length * 0.6)]; }
  if (!r.length) return null;
  r.sort((a, b) => b - a);
  return r.length >= 3 ? (r[0] + r[1] + r[2]) / 3 : r[0];
}
/** Escala no tempo: mediana móvel das observações (15 quadros), sem o viés de "segurar o máximo". */
function escalaTemporal(hist, so, ant) {
  if (so) { hist.push(so); if (hist.length > 30) hist.shift(); }
  if (!hist.length) return null;
  const o = hist.slice().sort((a, b) => a - b);
  const m = o[Math.floor(o.length * 0.6)];
  // a escala só muda com a distância à câmera, que muda devagar: no máximo 4 % por quadro
  return ant ? Math.max(ant * 0.96, Math.min(ant * 1.04, m)) : m;
}

/**
 * Os candidatos de um osso em PERSPECTIVA: o filho está no raio do seu pixel e a L do pai
 * (interseção raio × esfera: até 2 soluções). Osso quase no plano da imagem (as duas soluções
 * coladas, o sinal mal condicionado): uma só, com a profundidade puxada para a do W. Sem 2D
 * confiável: herda o vetor anterior (não estica) ou a direção do W.
 */
function osso(e, K, pai3, a, b, Lb, herdado, wDir) {
  const A = e.uv[a], B = e.uv[b];
  const confiavel = A && B && e.vis[b] >= 0.35 && e.vis[a] >= 0.2;
  if (!confiavel) {
    const v = herdado ? mul(unit(herdado), Lb) : wDir ? mul(unit(wDir), Lb) : [0, -Lb, 0];
    return { cands: [add(pai3, v)], fixo: true };
  }
  const r = unit([(B[0] - K.cx) / K.f, -(B[1] - K.cy) / K.f, -1]);
  // HÍBRIDO: o W coerente com a imagem neste osso (comprimento projetado bate) é a melhor estimativa
  // de profundidade — usa a direção do W (x, y e z) no comprimento L; só onde o W contradiz a imagem
  // (perna de costas, oclusão, "perna reta pendurada") o 2D decide sozinho, com as restrições.
  const consB = e.consW && e.consW[b] != null ? e.consW[b] : 0;
  const candW = wDir && consB > (K.limiarW ?? 0.6) ? add(pai3, mul(unit(wDir), Lb)) : null;
  const rp = dot(r, pai3), disc = rp * rp - dot(pai3, pai3) + Lb * Lb;
  if (disc <= 0) { const c = mul(r, rp); return { cands: candW ? [candW] : [add(pai3, mul(unit(sub(c, pai3)), Lb))], fixo: false }; }
  // fusão com o W (inverso da variância): a profundidade do 2D é ±h ao longo do raio, com incerteza
  // que cresce quando o osso está quase no plano da imagem (h pequeno: o sinal e o tamanho ficam
  // mal condicionados por erros de escala, de focal e de comprimento); o W entra com σW.
  const h = Math.sqrt(disc);
  const p2 = Math.max(0, Lb * Lb - h * h);
  const sH = Math.max(0.02 * Lb, (p2 * 0.09) / Math.max(h, 0.08 * Lb));
  const kW = wDir ? dot(mul(unit(wDir), Lb), r) : 0;
  // o W incoerente com a imagem neste osso (coerenciaW) praticamente não entra na fusão
  const cons = e.consW && e.consW[b] != null ? e.consW[b] : 1;
  const sW = ((K.sigmaW || 0.25) * Lb) / Math.max(0.05, cons);
  const fundir = (k0) => (wDir ? (k0 / (sH * sH) + kW / (sW * sW)) / (1 / (sH * sH) + 1 / (sW * sW)) : k0);
  const pt = (k) => { const c = mul(r, rp + k); return add(pai3, mul(unit(sub(c, pai3)), Lb)); };
  // com o W coerente, ele é o 1º candidato; as soluções do 2D ficam como alternativas que os limites
  // articulares, o equilíbrio e o contato podem preferir quando o W tem o SINAL errado
  if (h < 0.12 * Lb) return { cands: candW ? [candW] : [pt(fundir(0))], fixo: false };
  return { cands: candW ? [candW, pt(fundir(h)), pt(fundir(-h))] : [pt(fundir(h)), pt(fundir(-h))], fixo: false };
}


/** Custo de concordância com a profundidade do W (só z: x e y vêm do 2D). */
function custoW(e, idx, c, peso) {
  if (!e.Wr || !e.Wr[idx] || !peso) return 0;
  const dz = c[2] - e.Q3[2] - e.Wr[idx][2];
  const k = e.consW && e.consW[idx] != null ? e.consW[idx] : 1;
  // perda robusta (Geman-McClure, escala 20 cm): o W puxa, mas não vence sozinho os limites
  // articulares, o equilíbrio e o contato quando erra muito (o sinal da perna de costas)
  const x2 = (dz * dz) / 0.04;
  return peso * k * 3 * (x2 / (x2 + 1));
}

/** Ossos (pai → filho) para medir a coerência do W com a imagem. */
const OSSOS_CONS = [['Q', 'O'], ['Q', 23], ['O', 11], ['O', 'E'], ['E', 0], [11, 13], [13, 15], [12, 14], [14, 16], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [27, 31], [28, 30], [28, 32]];
/**
 * Coerência do W com o 2D, osso a osso: o comprimento do osso do W projetado (Δx, Δy do W × escala)
 * deve bater com o comprimento na imagem. Bate → o W é ouvido (peso 1); não bate (o W diz "perna
 * no plano, reta" e a imagem mostra a perna encurtada, como ajoelhada de costas) → o W é ignorado
 * naquele osso. É o que separa os casos em que o W ajuda dos casos em que ele estraga.
 */
function coerenciaW(e, s) {
  e.consW = {};
  if (!e.Wr) return;
  for (const [a, b] of OSSOS_CONS) {
    const A = e.uv[a], B = e.uv[b], wa = e.Wr[a], wb = e.Wr[b];
    if (!A || !B || !wa || !wb) continue;
    const l2 = Math.hypot(A[0] - B[0], A[1] - B[1]), lw = Math.hypot(wb[0] - wa[0], wb[1] - wa[1]) * s, L = norma(sub(wb, wa)) * s;
    const d = (lw - l2) / Math.max(1, 0.2 * L);
    e.consW[b] = Math.exp(-d * d);
    if (b === 23) e.consW[24] = e.consW[23];
    if (b === 11) e.consW[12] = e.consW[11];
  }
}
function custoT(ant, idx, c, peso) {
  if (!ant || !ant[idx] || !ant.Q3) return 0;
  return peso * d2(sub(c, ant.Q3), ant[idx]) * 25;
}

/** Referenciais do tronco: esquerda, cima, frente. */
function eixos(S) {
  const cima = unit(sub(S.O, S.Q));
  let esq = sub(S[23], S[24]); esq = unit(sub(esq, mul(cima, dot(esq, cima))));
  const frente = cross(esq, cima);
  return { esq, cima, frente };
}

// ------------------------------------------------------------------ grupos de candidatos

/** Tronco: sinais de (inclinação do tronco, giro da pelve, giro dos ombros) → até 8 candidatos. */
function candidatosTronco(e, s, L, ant, Wpeso) {
  const Q = e.Q3;
  const out = [];
  const tr = osso(e, s, Q, 'Q', 'O', L.tronco, ant && ant.O, e.Wr && e.Wr.O);
  const pel = osso(e, s, Q, 'Q', 23, L.pelve / 2, ant && ant[23], e.Wr && e.Wr[23]);
  for (const O of tr.cands) for (const hl of pel.cands) {
    const sh = osso(e, s, O, 'O', 11, L.ombros / 2, ant && ant[11] && ant.O ? sub(ant[11], ant.O) : null, e.Wr && e.Wr[11] && e.Wr.O ? sub(e.Wr[11], e.Wr.O) : null);
    for (const sl of sh.cands) {
      const S = { Q, O, 23: hl, 24: sub(mul(Q, 2), hl), 11: sl, 12: sub(mul(O, 2), sl) };
      let c = custoW(e, 'O', O, Wpeso) + custoW(e, 23, S[23], Wpeso) + custoW(e, 11, S[11], Wpeso);
      c += custoT(ant, 'O', O, 1) + custoT(ant, 23, S[23], 1) + custoT(ant, 11, S[11], 1);
      // torção pelve × ombros acima de ~60° é rara
      const tw = ang([S[23][0] - S[24][0], 0, S[23][2] - S[24][2]], [S[11][0] - S[12][0], 0, S[11][2] - S[12][2]]);
      if (tw > 1.05) c += (tw - 1.05) * 8;
      out.push({ S, c });
    }
  }
  return out;
}

/** Cabeça: centro das orelhas, nariz (à frente) e orelhas. */
function cabeca(e, s, L, S, ant, ax) {
  const E = osso(e, s, S.O, 'O', 'E', L.pescoco, ant && ant.E && ant.O ? sub(ant.E, ant.O) : ax.cima, e.Wr && e.Wr.E && e.Wr.O ? sub(e.Wr.E, e.Wr.O) : null);
  let melhor = null;
  for (const Ec of E.cands) {
    const n = osso(e, s, Ec, 'E', 0, L.nariz, ant && ant[0] && ant.E ? sub(ant[0], ant.E) : ax.frente, e.Wr && e.Wr[0] && e.Wr.E ? sub(e.Wr[0], e.Wr.E) : ax.frente);
    for (const nc of n.cands) {
      let c = custoW(e, 'E', Ec, 0.5) + custoT(ant, 'E', Ec, 2) + custoT(ant, 0, nc, 2);
      if (dot(sub(nc, Ec), ax.frente) < 0) c += 3;
      c += custoW(e, 0, nc, 0.5);        // o nariz fica à frente das orelhas
      const ore = osso(e, s, Ec, 'E', 7, L.orelhas / 2, ant && ant[7] && ant.E ? sub(ant[7], ant.E) : ax.esq, ax.esq);
      let o7 = ore.cands[0];
      if (ore.cands.length > 1) o7 = dot(sub(ore.cands[0], Ec), ax.esq) > dot(sub(ore.cands[1], Ec), ax.esq) ? ore.cands[0] : ore.cands[1];
      if (!melhor || c < melhor.c) melhor = { c, E: Ec, 0: nc, 7: o7, 8: sub(mul(Ec, 2), o7) };
    }
  }
  return melhor;
}

/**
 * Uma perna: candidatos (coxa ± × canela ± × calcanhar ± × ponta ±), com joelho-dobradiça,
 * tornozelo (até a ponta de dança), extensão de quadril, W e temporal. Devolve os 3 melhores.
 */
function candidatosPerna(e, s, L, S, ant, ax, lado, wPeso, herdar) {
  const [iq, ij, it, ic, ip] = PERNAS[lado];
  const herd = (a, b) => (ant && ant[a] && ant[b] ? sub(ant[b], ant[a]) : null);
  const wd = (a, b) => (e.Wr && e.Wr[a] && e.Wr[b] ? sub(e.Wr[b], e.Wr[a]) : null);
  const hip = S[iq];
  const forca = (r) => (herdar ? { cands: [r.cands[0]], fixo: true } : r);
  const out = [];
  // pares (joelho, tornozelo): osso a osso, e mais dois atalhos —
  //  · perna RETA no 2D (quadril, joelho e tornozelo alinhados na imagem): o tornozelo no raio a
  //    Lcoxa+Lcanela do quadril, joelho na reta (uma perna reta em 3D quase sempre aparece reta);
  //  · joelho OCULTO (tutu, saia, oclusão) com o tornozelo visível: IK de duas barras do quadril ao
  //    tornozelo (distância do W), joelho dobrando para a frente do corpo — em vez de herdar e esticar.
  const pares = [];
  const uvOk = (k) => e.uv[k] && e.vis[k] >= 0.35;
  if (herdar) {
    const kn = add(hip, herd(iq, ij) ? mul(unit(herd(iq, ij)), L.coxa) : [0, -L.coxa, 0]);
    pares.push([kn, add(kn, herd(ij, it) ? mul(unit(herd(ij, it)), L.canela) : [0, -L.canela, 0])]);
  } else {
    if (uvOk(ij)) {
      const J = osso(e, s, hip, iq, ij, L.coxa, herd(iq, ij), wd(iq, ij));
      for (const kn of J.cands) for (const an of osso(e, s, kn, ij, it, L.canela, herd(ij, it), wd(ij, it)).cands) pares.push([kn, an]);
    }
    const Lp = L.coxa + L.canela;
    const reta2D = uvOk(iq) && uvOk(ij) && uvOk(it) && (() => { const a = e.uv[iq], b = e.uv[ij], c = e.uv[it]; const u = [a[0] - b[0], a[1] - b[1]], v = [c[0] - b[0], c[1] - b[1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1)))) > 2.88; })();
    if ((reta2D || !uvOk(ij)) && uvOk(it)) {
      const wD = e.Wr && e.Wr[iq] && e.Wr[it] ? norma(sub(e.Wr[it], e.Wr[iq])) : Lp;
      const D = reta2D ? Lp * 0.995 : Math.min(Lp * 0.995, Math.max(0.6 * Lp, wD));
      const tmp = { ...e, uv: { ...e.uv, X: e.uv[iq] }, vis: { ...e.vis, X: e.vis[iq] } };
      const r = osso(tmp, s, hip, 'X', it, D, herd(iq, it), wd(iq, it));
      for (const an of r.cands) {
        const u = unit(sub(an, hip)), Dd = norma(sub(an, hip));
        const a1 = (L.coxa * L.coxa - L.canela * L.canela + Dd * Dd) / (2 * Dd), b1 = Math.sqrt(Math.max(0, L.coxa * L.coxa - a1 * a1));
        let n = sub(ax.frente, mul(u, dot(ax.frente, u)));
        n = norma(n) > 1e-3 ? unit(n) : ax.frente;
        pares.push([add(add(hip, mul(u, a1)), mul(n, b1)), an]);
      }
    }
    if (!pares.length) {
      const J = osso(e, s, hip, iq, ij, L.coxa, herd(iq, ij), wd(iq, ij));
      for (const kn of J.cands) for (const an of osso(e, s, kn, ij, it, L.canela, herd(ij, it), wd(ij, it)).cands) pares.push([kn, an]);
    }
  }
  for (const [kn, an] of pares) {
    {
      const Cc = forca(osso(e, s, an, it, ic, L.calcanhar, herd(it, ic), wd(it, ic)));
      const Pp = forca(osso(e, s, an, it, ip, L.pe, herd(it, ip), wd(it, ip)));
      for (const he of Cc.cands) for (const to of Pp.cands) {
        let c = 0;
        c += custoW(e, ij, kn, wPeso) + custoW(e, it, an, wPeso) + custoW(e, ip, to, wPeso * 0.5);
        c += custoT(ant, ij, kn, 1) + custoT(ant, it, an, 1) + custoT(ant, ic, he, 0.5) + custoT(ant, ip, to, 0.5);
        const Tv = sub(kn, hip), Sv = sub(an, kn), Fv = sub(to, he);
        // joelho: dobra só para trás (cross(coxa, canela) · esquerda ≥ 0)
        const dobra = ang(Tv, Sv);
        if (dobra > 0.26) { const hj = dot(unit(cross(Tv, Sv)), ax.esq); if (hj < 0) c += 6 * (0.2 - hj); }
        c += PESOS.reto * dobra;                              // prior fraco: perna dobrada só se o 2D pedir
        // quadril: extensão além de ~35° custa (o arabesque paga, mas só se o 2D pedir)
        const tf = dot(unit(Tv), ax.frente);
        if (tf < -0.55) c += PESOS.extensao * (-0.55 - tf);
        // tornozelo: o pé aponta para a frente da canela; a ponta (pé alinhado à canela) é permitida
        const ha = dot(unit(cross(Sv, Fv)), ax.esq);
        if (ha > 0.25) c += 4 * (ha - 0.25);
        out.push({ c, [ij]: kn, [it]: an, [ic]: he, [ip]: to });
      }
    }
  }
  out.sort((a, b) => a.c - b.c);
  return out.slice(0, 3);
}

/** Um braço: cotovelo ± × punho ±; mão (19, 17, 21) pelo sinal do W. */
function candidatosBraco(e, s, L, S, ant, ax, lado) {
  const [io, ic, ip, ii, im, it] = lado === 'L' ? [11, 13, 15, 19, 17, 21] : [12, 14, 16, 20, 18, 22];
  const herd = (a, b) => (ant && ant[a] && ant[b] ? sub(ant[b], ant[a]) : null);
  const wd = (a, b) => (e.Wr && e.Wr[a] && e.Wr[b] ? sub(e.Wr[b], e.Wr[a]) : null);
  const out = [];
  const C = osso(e, s, S[io], io, ic, L.braco, herd(io, ic), wd(io, ic));
  for (const el of C.cands) {
    const Pn = osso(e, s, el, ic, ip, L.antebraco, herd(ic, ip), wd(ic, ip));
    for (const wr of Pn.cands) {
      let c = custoW(e, ic, el, 2) + custoW(e, ip, wr, 2) + custoT(ant, ic, el, 1) + custoT(ant, ip, wr, 1);
      out.push({ c, [ic]: el, [ip]: wr });
    }
  }
  out.sort((a, b) => a.c - b.c);
  const m = out[0];
  // mão: pontos curtos, sinal do W (ou do anterior)
  for (const j of [ii, im, it]) {
    const r = osso(e, s, m[ip], ip, j, L.mao, herd(ip, j), wd(ip, j));
    m[j] = r.cands.length > 1 ? (custoW(e, j, r.cands[0], 1) + custoT(ant, j, r.cands[0], 1) <= custoW(e, j, r.cands[1], 1) + custoT(ant, j, r.cands[1], 1) ? r.cands[0] : r.cands[1]) : r.cands[0];
  }
  return out.map((o) => ({ ...o, [ii]: m[ii], [im]: m[im], [it]: m[it] })).slice(0, 4);
}

/** Pernas fundidas/trocadas no 2D: { trocar, fundidas, livre ('L'|'R'|null) }. */
function examinarPernas(e, s, mem) {
  const uv = e.uv, px = (a, b) => (uv[a] && uv[b] ? Math.hypot(uv[a][0] - uv[b][0], uv[a][1] - uv[b][1]) : Infinity);
  const tau = 0.07 * s;
  const fundidas = px(25, 26) < tau && px(27, 28) < tau;
  mem.nFund = fundidas ? (mem.nFund || 0) + 1 : 0;
  let trocar = false;
  const ant = mem.uvPernas;
  if (ant && !fundidas) {
    const dist = (p, q) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : 0);
    const mesmo = dist(uv[25], ant[25]) + dist(uv[26], ant[26]) + dist(uv[27], ant[27]) + dist(uv[28], ant[28]);
    const cruz = dist(uv[25], ant[26]) + dist(uv[26], ant[25]) + dist(uv[27], ant[28]) + dist(uv[28], ant[27]);
    if (cruz < 0.5 * mesmo && mesmo > 0.15 * s) trocar = true;
  }
  return { fundidas: mem.nFund >= 2, trocar };
}
function trocarPernas(e) {
  for (const [a, b] of [[25, 26], [27, 28], [29, 30], [31, 32]]) {
    [e.uv[a], e.uv[b]] = [e.uv[b], e.uv[a]]; [e.vis[a], e.vis[b]] = [e.vis[b], e.vis[a]];
    if (e.Wr) [e.Wr[a], e.Wr[b]] = [e.Wr[b], e.Wr[a]];
  }
}
/** RTMO (COCO 17) como 2ª opinião: separa joelhos/tornozelos fundidos (sem confiar no rótulo). */
function fundirRTMO(e, rtmo) {
  if (!Array.isArray(rtmo) || !rtmo.length || !e.uv.Q) return false;
  let melhor = null, dm = Infinity;
  for (const p of rtmo) {
    const k = p.keypoints || p.kp; if (!k || k.length < 17) continue;
    const q = [(k[11].x + k[12].x) / 2 * e.w, (k[11].y + k[12].y) / 2 * e.h];
    const d = Math.hypot(q[0] - e.uv.Q[0], q[1] - e.uv.Q[1]);
    if (d < dm) { dm = d; melhor = k; }
  }
  if (!melhor || dm > 0.1 * e.h) return false;
  const pt = (i) => [melhor[i].x * e.w, melhor[i].y * e.h, melhor[i].score ?? melhor[i].v ?? 0];
  const pares = [[13, 14, 25, 26], [15, 16, 27, 28]];
  let usou = false;
  for (const [ra, rb, ba, bb] of pares) {
    const A = pt(ra), B = pt(rb);
    if (A[2] < 0.4 || B[2] < 0.4 || Math.hypot(A[0] - B[0], A[1] - B[1]) < 0.04 * e.h) continue;
    // a perna esquerda do BlazePose fica com o ponto do RTMO mais perto dela; a outra, com o outro
    const u = e.uv[ba] || e.uv[bb];
    const daA = u ? Math.hypot(u[0] - A[0], u[1] - A[1]) : 0, daB = u ? Math.hypot(u[0] - B[0], u[1] - B[1]) : 1;
    const [pa, pb] = daA <= daB ? [A, B] : [B, A];
    e.uv[ba] = [pa[0], pa[1]]; e.uv[bb] = [pb[0], pb[1]]; e.vis[ba] = Math.max(e.vis[ba], pa[2]); e.vis[bb] = Math.max(e.vis[bb], pb[2]);
    usou = true;
  }
  return usou;
}

/** Esqueleto completo (33) a partir das escolhas; pontos do rosto e dedos da mão pelo W. */
function montar(S, cab, pernas, bracos, e) {
  const q = Array(33).fill(null);
  for (const k of [11, 12, 23, 24]) q[k] = S[k];
  if (cab) { q[0] = cab[0]; q[7] = cab[7]; q[8] = cab[8]; }
  for (const p of [...pernas, ...bracos]) for (const k of Object.keys(p)) if (/^\d+$/.test(k)) q[+k] = p[k];
  // olhos, boca: deslocamento do W em relação ao nariz (ou um padrão pequeno)
  for (const k of [1, 2, 3, 4, 5, 6, 9, 10]) q[k] = q[0] ? (e.Wr && e.Wr[k] && e.Wr[0] ? add(q[0], sub(e.Wr[k], e.Wr[0])) : q[0].slice()) : null;
  return q;
}

/** Centro de massa (robo/Winter) no plano do chão e o pé de apoio. */
function equilibrio(q, alturas) {
  const com = centroDeMassa(q);
  if (!com) return null;
  const minimo = Math.min(...alturas);
  // apoio: as juntas de contato a até 5 cm do ponto mais baixo (pés, joelhos, quadril sentado, mãos)
  const pts = CONTATO.filter((k) => q[k] && q[k][1] - minimo < 0.05).map((k) => [q[k][0], q[k][2]]);
  const pes = { L: [27, 29, 31], R: [28, 30, 32] };
  const baixo = (l) => Math.min(...pes[l].map((k) => (q[k] ? q[k][1] : Infinity)));
  const bl = baixo('L') - minimo, br = baixo('R') - minimo;
  const apoio = bl < 0.04 && br > 0.08 ? 'L' : br < 0.04 && bl > 0.08 ? 'R' : null;
  return { com, apoio, dist: distanciaAoCasco([com[0], com[2]], pts) };
}
/** Distância (m) de um ponto ao casco convexo de pontos no plano do chão (0 se dentro). */
function distanciaAoCasco(c, pts) {
  if (!pts.length) return 0;
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (P.length === 1) return Math.hypot(c[0] - P[0][0], c[1] - P[0][1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of P.slice().reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  const H = lo.slice(0, -1).concat(hi.slice(0, -1));
  const dSeg = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(c[0] - a[0] - t * dx, c[1] - a[1] - t * dy); };
  if (H.length < 3) return H.length <= 1 ? Math.hypot(c[0] - P[0][0], c[1] - P[0][1]) : H.length === 1 ? Math.hypot(c[0] - H[0][0], c[1] - H[0][1]) : dSeg(H[0], H[1]);
  let dentro = true;
  for (let k = 0; k < H.length; k++) if (cr(H[k], H[(k + 1) % H.length], c) < 0) { dentro = false; break; }
  if (dentro) return 0;
  return Math.min(...H.map((a, k) => dSeg(a, H[(k + 1) % H.length])));
}

/**
 * Estatura (m) de um conjunto de comprimentos: canela + coxa + tronco + pescoço, mais cabeça e
 * tornozelo-chão na proporção do padrão (1,70 m). Exportada para os testes.
 */
export const estatura = (L) => (L.canela + L.coxa + L.tronco + L.pescoco) * (1.7 / (PADRAO.canela + PADRAO.coxa + PADRAO.tronco + PADRAO.pescoco));
/**
 * Escala humana real: com `altura` (m) configurada, os ossos medidos são reescalados para ela;
 * sem ela, a estatura medida só é aceita entre 1,45 e 2,00 m (fora disso o W errou a escala e
 * vale 1,70 m). A escala px/m, a profundidade e a posição no piso seguem os ossos.
 */
export function escalarAltura(L, altura = null) {
  const e = estatura(L);
  const alvo = Number.isFinite(altura) && altura > 0.5 ? altura : e < 1.45 || e > 2.0 ? 1.7 : null;
  if (!alvo || !(e > 0)) return L;
  const k = alvo / e, out = {};
  for (const n of Object.keys(L)) out[n] = L[n] * k;
  return out;
}

/** Rotação em torno de x (inclinação da câmera). */
const girarX = (p, th) => (p ? [p[0], p[1] * Math.cos(th) - p[2] * Math.sin(th), p[1] * Math.sin(th) + p[2] * Math.cos(th)] : null);

// ------------------------------------------------------------------ o levantador ao vivo

export class Levantador {
  /** opc: { inclinacao: null (automática) | graus, raiz: true (translação pela imagem), focal: 1.1 (× largura) } */
  constructor(opc = {}) { this.opc = { inclinacao: null, raiz: true, focal: 1.0, suavizar: true, ...opc }; this.zerar(); }
  zerar() {
    this.histW = []; this.L = null; this.s = null; this.ant = null; this.mem = {}; this.filtros = null; this.tAnt = null;
    this.baseChao = []; this.raiz0 = null; this.trava = null; this.contatosHist = []; this.incl = 0; this.saida = null; this.info = {};
    this.raizF = null; this.histZ = []; this.histS = []; this.histZp = []; this.amPiso = []; this.piso = null; this.histD = []; this.noArAnt = false; this.baseTrava = null; this.histAlt = []; this.zPe = null; this.tPe = 0;
  }
  configurar(o) { Object.assign(this.opc, o); }

  /**
   * Um quadro. P: 33 {x, y, v} em px do quadro processado (espelhado se `esp`); W: 33 [x,y,z]
   * (robo) ou null. Devolve 33 [x, y, z] com o piso em y = 0, ou null sem pessoa.
   */
  quadro({ P, w, h, esp = false, W = null, t = performance.now(), rtmo = null }) {
    if (!P || !P[23] || !P[24] || !P[11] || !P[12]) return null;
    const e = prepararEntrada(P, w, h, esp, W);
    // comprimentos: do W visto até agora (re-medidos a cada 30 quadros, até 600 amostras)
    if (W) { this.histW.push(W); if (this.histW.length > 600) this.histW.splice(0, this.histW.length - 600); }
    if (!this.L || (this.histW.length % 30 === 1 && this.histW.length < 1200)) this.L = escalarAltura(comprimentos(this.histW.slice(-600)), this.opc.altura);
    const L = this.L;
    // escala px/m: envoltória com subida rápida e descida lenta
    this.histS = this.histS || [];
    this.s = escalaTemporal(this.histS, escalaObservada(e, L), this.s);
    if (!this.s) return null;
    const s = this.s;
    // pernas: troca de rótulos, fusão, RTMO
    const exame = examinarPernas(e, s, this.mem);
    if (exame.fundidas && this.ant) e.fundidasAnt = true;
    if (exame.trocar) trocarPernas(e);
    let usouRTMO = false;
    if (exame.fundidas) usouRTMO = fundirRTMO(e, rtmo);
    const ant = this.ant;
    const K = cameraRaiz(e, s, this.opc.focal);
    // deitada/rolando (tronco do W a mais de ~60° da vertical): os limites articulares e o chão do
    // levantamento supõem o tronco mais ou menos em pé — aí fica o W (com o chão e a raiz daqui)
    // (pelo 2D: tronco na imagem a mais de 55° da vertical — o W erra justamente quando a pose é difícil)
    const t2 = e.uv.Q && e.uv.O ? [e.uv.O[0] - e.uv.Q[0], e.uv.O[1] - e.uv.Q[1]] : null;
    const n2 = t2 ? Math.hypot(t2[0], t2[1]) : 0, trW = e.Wr && e.Wr.O ? unit(e.Wr.O) : null;
    // ou deitada ao longo da profundidade: tronco curto na imagem E horizontal no W
    const deitada = Boolean(trW && t2 && n2 > 1e-3 && (Math.abs(t2[1]) / n2 < 0.57 || (n2 < 0.35 * L.tronco * s && Math.abs(trW[1]) < 0.45)));
    const res = deitada ? { q: e.Wr.map((p) => (p ? p.slice() : null)), rel: Object.assign(e.Wr.map((p) => (p ? p.slice() : null)), { O: e.Wr.O, Q: [0, 0, 0], E: e.Wr.E, Q3: e.Q3 }), Q3: e.Q3, custo: 0 }
      : resolverQuadro(e, K, L, ant, { fundidas: exame.fundidas && !usouRTMO, mem: this.mem, incl: this.opc.inclinacao != null ? (this.opc.inclinacao * Math.PI) / 180 : this.incl });
    this.mem.uvPernas = { 25: e.uv[25], 26: e.uv[26], 27: e.uv[27], 28: e.uv[28] };
    this.ant = res.rel;
    this.ultimoCusto = res.custo;
    // inclinação da câmera
    const th = this.opc.inclinacao != null ? (this.opc.inclinacao * Math.PI) / 180 : this.incl;
    let q = res.q.map((p) => girarX(p, -th));
    // chão: contato mais baixo; pulo pela linha do chão na imagem
    const alturas = CONTATO.filter((k) => q[k] && (e.vis[k] > 0.2 || k >= 25)).map((k) => q[k][1]);
    const minimo = alturas.length ? Math.min(...alturas) : -0.95;
    // pulo: o ponto de contato mais baixo NA IMAGEM sobe acima da linha do chão (câmera parada).
    // Limitado a 1,2 m e a ~1,5 s no ar: fora disso é a câmera/pessoa que mudou, não um salto.
    let vBaixo = null;
    for (const k of CONTATO) if (e.uv[k] && e.vis[k] > 0.3 && (vBaixo == null || e.uv[k][1] > vBaixo)) vBaixo = e.uv[k][1];
    let ar = 0;
    // PISO NA IMAGEM: com o plano do piso estimado (altura e inclinação da câmera, _ajustarPiso), o pé
    // de apoio dá a profundidade daquele quadro e o pulo é o pé ACIMA do piso na profundidade do corpo
    // — funciona com o ator andando em profundidade (a "linha do chão" fixa na imagem não).
    const pe = this._ajustarPiso(e, q, K, minimo);
    if (pe) {
      ar = pe.altura > 0.1 ? Math.min(1.2, pe.altura - 0.03) : 0;
      this.nAr = ar ? (this.nAr || 0) + 1 : 0;
      if (this.nAr > 45) { ar = 0; this.nAr = 0; }
    } else if (vBaixo != null) {
      // sem o plano ainda: a linha do chão na imagem, mas só a DECOLAGEM rápida conta (subir > 15 cm
      // em ≤ 1/3 s; andar para longe da câmera também sobe o pé na imagem, devagar) e a base fica
      // travada durante o voo
      this.baseChao.push(vBaixo); if (this.baseChao.length > 10) this.baseChao.shift();
      const base = this.baseTrava != null ? this.baseTrava : Math.max(...this.baseChao);
      const a = (base - vBaixo) / s - 0.04;
      if (this.baseTrava == null && a > 0.15) this.baseTrava = base;
      ar = this.baseTrava != null && a > 0.04 ? a : 0;
      if (!ar) this.baseTrava = null;
      this.nAr = ar ? (this.nAr || 0) + 1 : 0;
      if (ar > 1.2 || this.nAr > 45) { ar = 0; this.baseChao = [vBaixo]; this.nAr = 0; this.baseTrava = null; }
    }
    // pulo só com histerese: 3 quadros seguidos acima do piso (ruído de um quadro não decola)
    const noAr = ar > 0 && (this.nAr || 0) >= 3;
    this.noArAnt = noAr;
    const dy = -minimo + (noAr ? ar : 0);
    // translação da raiz pela imagem (x) e pela escala (profundidade), suavizada
    let rx = 0, rz = 0;
    // raiz no referencial da câmera (várias pessoas: posição relativa real). A profundidade vem da
    // escala (f/s), ruidosa quadro a quadro: mediana dos últimos 45 quadros (x vem direto da imagem)
    const RA = girarX(res.Q3, -th);
    this.histZ = this.histZ || []; this.histZ.push(RA[2]); if (this.histZ.length > 45) this.histZ.shift();
    const zs = this.histZ.slice().sort((a, b) => a - b);
    this.raizAbs = [RA[0], RA[1], zs[Math.floor(zs.length / 2)]];
    // POSIÇÃO NO PISO PELO PÉ (perspectiva): o raio do pixel do pé de apoio cruza o plano do piso e
    // dá onde o ator está — bem mais firme que f/s (a escala treme com a pose e some com as pernas
    // ocultas). Sem pé apoiado visível, no ar ou sem plano ainda, fica a profundidade pela escala.
    if (pe && pe.raiz && !noAr) {
      this.histZp = this.histZp || []; this.histZp.push(pe.raiz[1]); if (this.histZp.length > 5) this.histZp.shift();
      const zp = this.histZp.slice().sort((a, b) => a - b);
      this.raizAbs = [pe.raiz[0], RA[1], zp[Math.floor(zp.length / 2)]];
      this.zPe = this.raizAbs[2]; this.tPe = t;
    } else {
      this.histZp = [];
      // pé de apoio oculto por instantes (giro, saia) ou no ar: segura a profundidade do pé (até 2 s),
      // em vez de pular para a da escala (outro viés: o ator "teleportava" em profundidade)
      if (this.zPe != null && t - this.tPe < 2000 && t >= this.tPe && e.uv.Q) {
        const Dz = -this.zPe;
        this.raizAbs = [((e.uv.Q[0] - K.cx) / K.f) * Dz, RA[1], this.zPe];
      }
    }
    this.info.camera = this.piso ? { altura: this.piso.hc, inclinacaoGraus: (this.piso.th * 180) / Math.PI } : null;
    if (this.opc.raiz) {
      const R = this.raizAbs;
      if (!this.raiz0) this.raiz0 = R;
      rx = R[0] - this.raiz0[0];
      rz = R[2] - this.raiz0[2];
    }
    q = q.map((p) => (p ? [p[0] + rx, p[1] + dy, p[2] + rz] : null));
    // pé travado: o pé em contato não desliza (corrige a raiz em x/z)
    const dt = this.tAnt == null ? 1 / 30 : Math.max(1e-3, (t - this.tAnt) / 1000);
    q = this._travarPe(q, dt);
    // temporal: One Euro + limite de velocidade por junta
    if (this.opc.suavizar) q = this._suavizar(q, dt);
    this.tAnt = t;
    // PISO EXATO: depois da suavização (que atrasa o y), o contato mais baixo volta para y = 0 em
    // todo quadro apoiado; no pulo (histerese acima) a altura medida na imagem fica
    {
      const alt = CONTATO.filter((k) => q[k]).map((k) => q[k][1]);
      if (alt.length) {
        const m = Math.min(...alt), alvo = noAr ? ar : 0;
        if (Math.abs(m - alvo) > 1e-4) q = q.map((p) => (p ? [p[0], p[1] - m + alvo, p[2]] : null));
      }
    }
    // inclinação automática: plano dos contatos (precisa de profundidade variada)
    this._inclinacao(q);
    const eq = equilibrio(q, CONTATO.filter((k) => q[k]).map((k) => q[k][1]));
    const cam = this.info.camera || null;
    this.info = { camera: cam, raiz: this.raizAbs, escala: s, deitada: Boolean(deitada), fundidas: exame.fundidas, trocou: exame.trocar, rtmo: usouRTMO, ar, inclinacaoGraus: (th * 180) / Math.PI, equilibrio: eq ? { apoio: eq.apoio, distCm: Math.round(eq.dist * 100) } : null, L };
    this.saida = q;
    return q;
  }

  /**
   * Plano do piso a partir dos pés apoiados, quadro a quadro. Para cada amostra, o pé de apoio tem
   * tanβ = (v − cy)/f (exato, do pixel) e a profundidade D pela escala (f/s, ruidosa). No piso,
   * 1/D = (tanβ·cos θ + sin θ)/h — linear em tanβ, com o ruído só em 1/D: a regressão dá a inclinação θ
   * e a altura h da câmera sem viés (precisa de variação de profundidade; sem ela fica o automático).
   * Devolve { altura do pé acima do piso, raiz [x, z] da câmera nivelada } ou null.
   */
  _ajustarPiso(e, q, K, minimo) {
    let k = -1;
    for (const j of [27, 28, 29, 30, 31, 32]) if (e.uv[j] && e.vis[j] > 0.5 && q[j] && (k < 0 || e.uv[j][1] > e.uv[k][1])) k = j;
    if (k < 0) return null;
    const tb = (e.uv[k][1] - K.cy) / K.f, tu = (e.uv[k][0] - K.cx) / K.f;
    // profundidade do pé pela escala OBSERVADA neste quadro (a temporal é mediana de 1 s e atrasa a
    // profundidade — achataria a regressão); q é relativo ao quadril, +z = para a câmera
    const so = this.histS && this.histS.length ? this.histS[this.histS.length - 1] : K.s;
    const D = K.f / so - q[k][2];
    this.histD = this.histD || []; this.histD.push(D); if (this.histD.length > 15) this.histD.shift();
    const apoiado = q[k][1] - minimo < 0.06;      // o pé visível é o contato mais baixo (não o do retiré)
    if (apoiado && !this.noArAnt && D > 0.3) {
      this.amPiso = this.amPiso || []; this.amPiso.push([tb, 1 / D]); if (this.amPiso.length > 400) this.amPiso.shift();
      if (this.amPiso.length >= 40 && this.amPiso.length % 5 === 0) {
        const n = this.amPiso.length;
        let sx = 0, sy = 0; for (const [x, y] of this.amPiso) { sx += x; sy += y; }
        const mx = sx / n, my = sy / n;
        let sxx = 0, sxy = 0; for (const [x, y] of this.amPiso) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
        const dp = Math.sqrt(sxx / n);
        if (dp > 0.012) {
          const A = sxy / sxx, B = my - A * mx;
          const th = Math.atan2(B, A), hc = Math.cos(th) / A;
          if (A > 0 && hc > 0.2 && hc < 6 && Math.abs(th) < 0.6) {
            this.piso = this.piso ? { th: 0.7 * this.piso.th + 0.3 * th, hc: 0.7 * this.piso.hc + 0.3 * hc } : { th, hc };
            if (this.opc.inclinacao == null) this.incl = this.piso.th;
          }
        }
      }
    }
    if (!this.piso) return null;
    const { th, hc } = this.piso;
    const den = tb * Math.cos(th) + Math.sin(th);
    if (!(den > 0.02) || !e.uv.Q) return null;
    // supondo o pé no piso: onde ele está (raio do pixel × plano)
    const Df = hc / den;
    const G = girarX([tu * Df, -tb * Df, -Df], -th);
    const hx = G[0] - q[k][0], hz = G[2] - q[k][2];
    // PULO sem escala: o quadril, no raio do SEU pixel e nessa profundidade, fica a H do piso; o
    // esqueleto diz que o quadril está a −minimo do contato mais baixo. No chão, H ≈ −minimo; com o pé a
    // a metros do piso, o raio do pé "acerta" o piso mais longe e H − (−minimo) ≈ a. Só pixels e o plano.
    const Dh = -hz, tbQ = (e.uv.Q[1] - K.cy) / K.f, tuQ = (e.uv.Q[0] - K.cx) / K.f;
    const Hq = girarX([tuQ * Dh, -tbQ * Dh, -Dh], -th)[1] + hc;
    // o viés (escala dos ossos × plano) sai pela mediana dos últimos ~3 s: o que vale é a SUBIDA
    const bruto = Hq + minimo;
    if (!this.noArAnt) { this.histAlt = this.histAlt || []; this.histAlt.push(bruto); if (this.histAlt.length > 90) this.histAlt.shift(); }
    const base = this.histAlt && this.histAlt.length >= 10 ? this.histAlt.slice().sort((a, b) => a - b)[Math.floor(this.histAlt.length / 2)] : bruto;
    return { altura: bruto - base, raiz: apoiado ? [hx, hz] : null };
  }

  _travarPe(q, dt) {
    const pes = { L: [29, 31], R: [30, 32] };
    let melhor = null;
    for (const l of ['L', 'R']) {
      const ps = pes[l].map((k) => q[k]).filter(Boolean);
      if (!ps.length) continue;
      const y = Math.min(...ps.map((p) => p[1]));
      const c = ps.reduce((a, p) => add(a, p), [0, 0, 0]).map((v) => v / ps.length);
      if (y < 0.035 && (!melhor || y < melhor.y)) melhor = { l, y, c };
    }
    if (!melhor) { this.trava = null; return q; }
    if (!this.trava || this.trava.l !== melhor.l) { this.trava = { l: melhor.l, x: melhor.c[0], z: melhor.c[2], vel: 0 }; return q; }
    const dx = this.trava.x - melhor.c[0], dz = this.trava.z - melhor.c[2];
    const desliz = Math.hypot(dx, dz) / dt;
    if (desliz > 1.2) { this.trava = { l: melhor.l, x: melhor.c[0], z: melhor.c[2] }; return q; }   // passo de verdade: solta
    return q.map((p) => (p ? [p[0] + dx * 0.85, p[1], p[2] + dz * 0.85] : null));
  }

  _suavizar(q, dt) {
    if (!this.filtros) this.filtros = Array.from({ length: 33 * 3 }, () => new OneEuro(1.6, 0.6));
    const out = q.map((p, k) => {
      if (!p) { for (let c = 0; c < 3; c++) this.filtros[3 * k + c].reset(); return null; }
      return p.map((v, c) => this.filtros[3 * k + c].filtrar(v, dt));
    });
    if (this.saida) {
      const vmax = 7 * dt;   // m por quadro (7 m/s)
      for (let k = 0; k < 33; k++) {
        const a = this.saida[k], b = out[k];
        if (!a || !b) continue;
        const d = norma(sub(b, a));
        if (d > vmax) out[k] = add(a, mul(sub(b, a), vmax / d));
      }
    }
    return out;
  }

  _inclinacao(q) {
    if (this.opc.inclinacao != null || this.piso) return;   // com o plano do piso (pés em profundidade), vale ele
    // 1) pernas retas e os dois pés embaixo: a perna é vertical no mundo; no referencial da câmera,
    //    o vetor tornozelos→quadris dá a inclinação (atan2(z, y)) — o "para cima" do esqueleto
    const r = this.ant;
    if (r && r[23] && r[24] && r[27] && r[28] && r[25] && r[26]) {
      const reta = (a, b, c) => ang(sub(r[a], r[b]), sub(r[c], r[b])) > 2.9;
      if (reta(23, 25, 27) && reta(24, 26, 28) && Math.abs(r[27][1] - r[28][1]) < 0.05) {
        const u = sub(meio(r[23], r[24]), meio(r[27], r[28]));
        const th = Math.atan2(u[2], u[1]);
        if (Math.abs(th) < 0.6) { this.inclAm = this.inclAm || []; this.inclAm.push(th); if (this.inclAm.length > 150) this.inclAm.shift(); }
        if (this.inclAm && this.inclAm.length >= 10) { const so = this.inclAm.slice().sort((a, b) => a - b); this.incl = so[Math.floor(so.length / 2)]; }
        return;
      }
    }
    if (this.inclAm && this.inclAm.length >= 10) return;
    for (const k of [29, 30, 31, 32]) if (q[k] && q[k][1] < 0.03) this.contatosHist.push([q[k][1], q[k][2]]);
    if (this.contatosHist.length > 900) this.contatosHist.splice(0, this.contatosHist.length - 900);
    if (this.contatosHist.length < 120) return;
    const zs = this.contatosHist.map((p) => p[1]);
    const zMin = Math.min(...zs), zMax = Math.max(...zs);
    if (zMax - zMin < 0.6) return;   // pouca variação de profundidade: plano indeterminado
    // regressão y = a·z (as alturas já estão em relação ao contato mais baixo)
    const mz = zs.reduce((a, v) => a + v, 0) / zs.length, my = this.contatosHist.reduce((a, p) => a + p[0], 0) / zs.length;
    let num = 0, den = 0;
    for (const [y, z] of this.contatosHist) { num += (z - mz) * (y - my); den += (z - mz) ** 2; }
    const a = den > 0 ? num / den : 0;
    const th = Math.max(-0.5, Math.min(0.5, this.incl + Math.atan(a) * 0.2));
    this.incl = th;
  }
}

/**
 * Resolve UM quadro (greedy: menor custo com o temporal). Devolve { q (33, raiz no centro do
 * quadril), rel (para o próximo quadro), custo }.
 */
export function resolverQuadro(e, s, L, ant, opc = {}) {   // s = K (câmera e raiz)
  // o temporal compara posições RELATIVAS à raiz deste quadro (a raiz anda; a forma não)
  if (ant) ant.Q3 = e.Q3;
  const wTronco = PESOS.tronco, wPerna = PESOS.perna;
  const troncos = candidatosTronco(e, s, L, ant, wTronco).sort((a, b) => a.c - b.c);
  const S = troncos[0].S;
  return completar(e, s, L, ant, S, opc, wPerna, troncos[0].c);
}

function completar(e, s, L, ant, S, opc, wPerna, custoTronco = 0, escolha = null) {
  const ax = eixos(S);
  const cab = cabeca(e, s, L, S, ant, ax);
  // perna livre (fundidas): a que mais se afastou da própria solução anterior herda o vetor anterior
  let livre = null;
  if (opc.fundidas && ant) {
    const desv = (l) => { const [, ij, it] = PERNAS[l]; const uvp = opc.mem && opc.mem.uvPernas; return uvp && uvp[ij] && e.uv[ij] ? Math.hypot(e.uv[ij][0] - uvp[ij][0], e.uv[ij][1] - uvp[ij][1]) + (uvp[it] && e.uv[it] ? Math.hypot(e.uv[it][0] - uvp[it][0], e.uv[it][1] - uvp[it][1]) : 0) : 0; };
    livre = desv('L') > desv('R') ? 'L' : 'R';
  }
  const pl = candidatosPerna(e, s, L, S, ant, ax, 'L', wPerna, livre === 'L');
  const pr = candidatosPerna(e, s, L, S, ant, ax, 'R', wPerna, livre === 'R');
  const bl = candidatosBraco(e, s, L, S, ant, ax, 'L'), br = candidatosBraco(e, s, L, S, ant, ax, 'R');
  // pernas em conjunto: equilíbrio (CoM sobre o pé de apoio) entre os 3 melhores de cada lado
  let melhor = null;
  const ij = escolha ? [[escolha.pl, escolha.pr]] : pl.flatMap((_, a) => pr.map((__, b) => [a, b]));
  for (const [a, b] of ij) {
    const A = pl[Math.min(a, pl.length - 1)], B = pr[Math.min(b, pr.length - 1)];
    const q = montar(S, cab, [A, B], [bl[0], br[0]], e);
    let c = A.c + B.c;
    // equilíbrio: o centro de massa cai dentro da base de apoio (com folga de 6 cm), no "para cima" atual
    const qi = opc.incl ? q.map((p) => girarX(p, -opc.incl)) : q;
    const alt = CONTATO.filter((k) => qi[k]).map((k) => qi[k][1]);
    const eq = equilibrio(qi, alt);
    if (eq) c += Math.max(0, eq.dist - 0.06) * PESOS.equilibrio;
    if (!melhor || c < melhor.c) melhor = { c, q };
  }
  // relativo ao centro do quadril (a raiz absoluta, Q3, vai à parte)
  const Q3 = e.Q3;
  const q = melhor.q.map((p) => (p ? sub(p, Q3) : null));
  const rel = q.map((p) => (p ? p.slice() : null));
  rel.O = sub(S.O, Q3); rel.Q = [0, 0, 0]; rel.E = cab ? sub(cab.E, Q3) : null; rel.Q3 = Q3;
  return { q, rel, Q3, custo: custoTronco + melhor.c };
}

// ------------------------------------------------------------------ modo qualidade (tomada inteira)

/**
 * Modo QUALIDADE sobre uma tomada: p2d (quadros de 33 {x, y, v} normalizados 0..1), trilhaBruta
 * (W) e aspecto (largura/altura). Roda o levantador nos DOIS sentidos (do começo ao fim e do fim
 * ao começo — cada um com a continuidade do seu lado) e, quadro a quadro, fica com a média onde
 * os dois concordam e com a solução de menor custo onde discordam (troca de sinal resolvida pelo
 * contexto do outro lado). O Studio aplica depois o pós-processamento do robo (lacunas,
 * Butterworth de fase zero, ossos rígidos). Devolve { trilha, L, inclinacaoGraus }.
 */
export function refinarTrilha({ p2d, trilhaBruta, aspecto = 16 / 9, fps = 30, focal = 1.0, incl = null, aoProgresso = () => {} }) {
  const n = p2d.length, H = 1000, Wpx = Math.round(H * aspecto);
  const P = p2d.map((Q) => (Q ? Q.map((p) => (p ? { x: p.x * Wpx, y: p.y * H, v: p.v } : null)) : null));
  const rodar = (ordem) => {
    const lev = new Levantador({ focal, inclinacao: incl, suavizar: false });
    // comprimentos da tomada inteira desde o primeiro quadro
    lev.histW = trilhaBruta.filter(Boolean).slice(0, 600);
    const out = Array(n).fill(null), custo = Array(n).fill(Infinity);
    ordem.forEach((i, k) => {
      if (P[i]) { out[i] = lev.quadro({ P: P[i], w: Wpx, h: H, W: trilhaBruta[i], t: i * (1000 / fps) }); custo[i] = lev.ultimoCusto ?? Infinity; }
      if (k % 60 === 0) aoProgresso(0.45 * (k / n) + (ordem[0] === 0 ? 0 : 0.45));
    });
    return { out, custo, incl: lev.incl };
  };
  const ida = rodar([...Array(n).keys()]);
  const volta = rodar([...Array(n).keys()].reverse());
  const trilha = ida.out.map((a, i) => {
    const b = volta.out[i];
    if (!a || !b) return a || b;
    let pior = 0;
    for (let k = 0; k < 33; k++) if (a[k] && b[k]) pior = Math.max(pior, norma(sub(a[k], b[k])));
    if (pior < 0.15) return a.map((p, k) => (p && b[k] ? meio(p, b[k]) : p || b[k]));
    return ida.custo[i] <= volta.custo[i] ? a : b;
  });
  aoProgresso(1);
  return { trilha, L: comprimentos(trilhaBruta.filter(Boolean)), inclinacaoGraus: ((ida.incl + volta.incl) / 2) * 180 / Math.PI };
}

/** Métricas de um quadro contra a verdade (testes): erro por junta (mm), joelho/quadril (°), contatos. */
export function avaliar(est, verd, contatosVerd = []) {
  const J = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const qe = DERIVADO(est, 'Q'), qv = DERIVADO(verd, 'Q');
  let soma = 0, m = 0;
  for (const k of J) if (est[k] && verd[k]) { soma += norma(sub(sub(est[k], qe), sub(verd[k], qv))); m++; }
  const ang3 = (q, a, b, c) => (q[a] && q[b] && q[c] ? (180 - (ang(sub(q[a], q[b]), sub(q[c], q[b])) * 180) / Math.PI) : null);
  const tronco = (q) => sub(DERIVADO(q, 'O'), DERIVADO(q, 'Q'));
  const quad = (q, a, b) => (ang(tronco(q), sub(q[b], q[a])) * 180) / Math.PI;
  const dJ = Math.abs(ang3(est, 23, 25, 27) - ang3(verd, 23, 25, 27)) / 2 + Math.abs(ang3(est, 24, 26, 28) - ang3(verd, 24, 26, 28)) / 2;
  const dQ = Math.abs(quad(est, 23, 25) - quad(verd, 23, 25)) / 2 + Math.abs(quad(est, 24, 26) - quad(verd, 24, 26)) / 2;
  const cont = contatosVerd.filter((k) => est[k]).map((k) => Math.abs(est[k][1]) * 1000);
  const minY = Math.min(...[25, 26, 27, 28, 29, 30, 31, 32, 23, 24].filter((k) => est[k]).map((k) => est[k][1]));
  // lateralidade: esquerda estimada × verdadeira (no plano do chão)
  const le = sub(est[23], est[24]), lv = sub(verd[23], verd[24]);
  const lado = le[0] * lv[0] + le[2] * lv[2] > 0;
  return { mpjpe: (soma / Math.max(1, m)) * 1000, joelho: dJ, quadril: dQ, contatoMm: cont.length ? cont.reduce((a, v) => a + v, 0) / cont.length : null, minAlturaMm: minY * 1000, ladoOk: lado };
}
