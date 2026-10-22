/**
 * components/video/seguir.js — "Seguir sujeito / Reenquadrar" do GPlanSiS|Vídeo.
 *
 * Transforma um clipe horizontal num vertical (9:16), quadrado (1:1), 4:5 ou
 * 16:9 que acompanha uma pessoa ou objeto. Três etapas:
 *
 *   1. ANÁLISE (analisarClipe). Os quadros do clipe são decodificados na
 *      ordem (WebCodecs, os mesmos quadros exatos da exportação; sem WebCodecs,
 *      busca quadro a quadro num <video> oculto) e reduzidos a 640 px. Cada
 *      quadro analisado passa por UM dos motores, sempre pela fila única de
 *      inferência do ORT (cv/runtime/onnx.js) — a interface não trava, e a
 *      decodificação espera a inferência (sem acumular quadros na memória):
 *        pessoa     YOLOX (COCO, classe "person") + track.bytetrack (o mesmo
 *                   operador do pipeline) para dar ID estável às pessoas; o
 *                   alvo é a trilha sob o clique (ou a "pessoa principal":
 *                   a maior e mais central ao longo do clipe). Trilhas
 *                   interrompidas (oclusão) são emendadas por posição/tamanho.
 *        aparência  sem pessoa sob o clique (um objeto, um animal, uma
 *                   máquina): correlação normalizada (ZNCC) de um modelo
 *                   em tons de cinza, para a frente e para trás a partir do
 *                   quadro clicado, com refinamento subpixel.
 *        sam2       o operador sam2.seguir (SAM 2.1 tiny), quando o modelo
 *                   está disponível: máscara re-promptada quadro a quadro, a
 *                   partir do ponto clicado (só para a frente; antes do
 *                   quadro clicado o recorte fica parado no ponto).
 *
 *   2. SUAVIZAÇÃO (suavizarTrajetoria). Mediana de 5 contra picos do
 *      detector → One Euro para a frente e para trás (sem atraso) → câmera
 *      virtual criticamente amortecida com ZONA MORTA e LIMITE DE VELOCIDADE,
 *      também ida e volta (a defasagem da zona morta na ida é desfeita na
 *      volta: parado, o recorte não treme; andando, não fica para trás). O
 *      alvo é limitado antes de filtrar à região onde o recorte cabe na
 *      imagem — os filtros são médias de pesos positivos, então o resultado
 *      também não sai da imagem.
 *
 *   3. KEYFRAMES (reduzirKeyframes). A trajetória densa vira poucos
 *      keyframes (inserção gulosa do ponto de maior erro até o erro máximo
 *      ficar abaixo da tolerância), reconstruídos pela mesma cúbica monótona
 *      que o visor e a exportação usam (edl.js: retSeguir). Ficam no clipe
 *      (c.seg) — editáveis na timeline (arrastar, apagar) e no visor.
 *
 * LGPD: só caixas de pessoa (sem rosto, sem identificação); nada sai do
 * navegador.
 *
 * ROTAÇÃO: vídeo de celular em pé (matriz de rotação no MP4) é analisado já
 * girado, no mesmo referencial do visor (StudioVideo troca largura/altura).
 */
import { centroSeguir, hermiteMonotona } from './edl.js';
import { Cancelado, percorrer, podeDecodificar } from './exportar.js';

export { Cancelado };

/* ====================================================================== suavização (pura) */

/** Filtro One Euro (Casiez et al. 2012): corte adaptativo à velocidade. */
function umEuro(xs, ts, { minCorte = 1.0, beta = 0.6, dCorte = 1.0 } = {}) {
  const out = new Float64Array(xs.length);
  if (!xs.length) return out;
  const alfa = (corte, dt) => { const tau = 1 / (2 * Math.PI * corte); return 1 / (1 + tau / dt); };
  let xAnt = xs[0], dAnt = 0;
  out[0] = xs[0];
  for (let i = 1; i < xs.length; i++) {
    const dt = Math.max(1e-3, Math.abs(ts[i] - ts[i - 1]));
    const d = (xs[i] - xAnt) / dt;
    const ad = alfa(dCorte, dt);
    const dh = ad * d + (1 - ad) * dAnt;
    const a = alfa(minCorte + beta * Math.abs(dh), dt);
    const x = a * xs[i] + (1 - a) * xAnt;
    out[i] = x; xAnt = x; dAnt = dh;
  }
  return out;
}

/** Câmera virtual: mola criticamente amortecida, zona morta e limite de velocidade. */
function camera(xs, ts, { omega, zonaMorta, vMax }) {
  const out = new Float64Array(xs.length);
  if (!xs.length) return out;
  let p = xs[0], vel = 0;
  out[0] = p;
  for (let i = 1; i < xs.length; i++) {
    const dt = Math.max(1e-3, Math.abs(ts[i] - ts[i - 1]));
    // integração semi-implícita em subpassos (estável com ω·dt grande)
    const sub = Math.max(1, Math.ceil(omega * dt / 0.1));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      let erro = xs[i] - p;
      erro = Math.abs(erro) <= zonaMorta ? 0 : erro - Math.sign(erro) * zonaMorta;
      vel += (omega * omega * erro - 2 * omega * vel) * h;
      if (vel > vMax) vel = vMax; else if (vel < -vMax) vel = -vMax;
      p += vel * h;
    }
    out[i] = p;
  }
  return out;
}

function inverter(a) { const o = new Float64Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[a.length - 1 - i]; return o; }

/** Ida e volta (fase zero) de um filtro causal f(xs, ts). */
function idaEVolta(xs, ts, f) {
  const ida = f(xs, ts);
  const tsR = inverter(ts).map((t) => -t);
  return inverter(f(inverter(ida), tsR));
}

function mediana5(xs) {
  const n = xs.length, out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) w.push(xs[j]);
    w.sort((a, b) => a - b);
    out[i] = w[w.length >> 1];
  }
  return out;
}

/** Preenche lacunas (NaN): interpolação linear entre válidos, constante nas pontas. */
function preencher(xs) {
  const n = xs.length, out = Float64Array.from(xs);
  let ant = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(out[i])) continue;
    if (ant < 0) for (let j = 0; j < i; j++) out[j] = out[i];
    else for (let j = ant + 1; j < i; j++) out[j] = out[ant] + (out[i] - out[ant]) * (j - ant) / (i - ant);
    ant = i;
  }
  if (ant < 0) return null;
  for (let j = ant + 1; j < n; j++) out[j] = out[ant];
  return out;
}

export const SUAVIZACAO_PADRAO = { suavidade: 0.5, zonaMorta: 0.015, vMax: 0.9 };

/**
 * Zona morta sem defasagem: "segura" para a frente (o valor só anda quando
 * o sinal se afasta mais que dz) e para trás, e tira a média. Andando, as
 * defasagens (−dz na ida, +dz na volta) se anulam; parado com tremor menor
 * que dz, as duas seguram → o recorte fica imóvel.
 */
function zonaMortaSimetrica(xs, dz) {
  if (!(dz > 0)) return xs;
  const segura = (a) => {
    const o = new Float64Array(a.length);
    let h = a[0];
    for (let i = 0; i < a.length; i++) { const d = a[i] - h; if (Math.abs(d) > dz) h = a[i] - Math.sign(d) * dz; o[i] = h; }
    return o;
  };
  const ida = segura(xs), volta = inverter(segura(inverter(xs)));
  return ida.map((x, i) => (x + volta[i]) / 2);
}

/** Estende o sinal nas pontas por reflexão ímpar (como o filtfilt): sem transitório de borda. */
function estender(xs, ts, P) {
  const n = xs.length;
  P = Math.min(P, n - 1);
  if (P <= 0) return { xs: Float64Array.from(xs), ts: Float64Array.from(ts), P: 0 };
  const X = new Float64Array(n + 2 * P), T = new Float64Array(n + 2 * P);
  for (let i = 0; i < P; i++) {
    X[i] = 2 * xs[0] - xs[P - i]; T[i] = 2 * ts[0] - ts[P - i];
    X[n + P + i] = 2 * xs[n - 1] - xs[n - 2 - i]; T[n + P + i] = 2 * ts[n - 1] - ts[n - 2 - i];
  }
  X.set(xs, P); T.set(ts, P);
  return { xs: X, ts: T, P };
}

/**
 * Trajetória do CENTRO do recorte, suavizada e dentro da imagem.
 * @param {{t:number, cx:number, cy:number}[]} amostras  centros brutos do sujeito (NaN = perdido), em ordem de t (s)
 * @param {{w:number, h:number}} tam  tamanho do recorte (normalizado)
 * @param {object} o  { suavidade 0..1, zonaMorta (fração da largura), vMax (larguras/s) }
 * @returns {{t, cx, cy}[]|null}
 */
export function suavizarTrajetoria(amostras, tam, o = {}) {
  const op = { ...SUAVIZACAO_PADRAO, ...o };
  const n = amostras.length;
  const ts0 = Float64Array.from(amostras.map((a) => a.t));
  const limX = [tam.w / 2, 1 - tam.w / 2], limY = [tam.h / 2, 1 - tam.h / 2];
  const lim = (x, [a, b]) => (a >= b ? 0.5 : Math.min(b, Math.max(a, x)));
  // ~1 s de extensão em cada ponta
  const dtMed = n > 1 ? (ts0[n - 1] - ts0[0]) / (n - 1) : 1 / 30;
  const P = Math.round(1 / Math.max(1e-3, dtMed));
  // suavidade 0 → mola rápida (ω 14 rad/s), 1 → lenta (ω 3)
  const omega = 14 - 11 * Math.min(1, Math.max(0, op.suavidade));
  const eixos = [];
  for (const [k, l] of [['cx', limX], ['cy', limY]]) {
    let xs = preencher(amostras.map((a) => a[k]));
    if (!xs) return null;
    xs = mediana5(xs.map((x) => lim(x, l)));
    const ex = estender(xs, ts0, P);
    let s1 = idaEVolta(ex.xs, ex.ts, (a, t) => umEuro(a, t, { minCorte: omega / (2 * Math.PI), beta: 0.8 }));
    s1 = zonaMortaSimetrica(s1, op.zonaMorta);
    const s2 = idaEVolta(s1, ex.ts, (a, t) => camera(a, t, { omega, zonaMorta: 0, vMax: op.vMax }));
    eixos.push(Array.from(s2.subarray(ex.P, ex.P + n), (x) => lim(x, l)));
  }
  return amostras.map((a, i) => ({ t: a.t, cx: eixos[0][i], cy: eixos[1][i] }));
}

/**
 * Keyframes [[q, cx, cy]] que reproduzem a trajetória densa (pela cúbica
 * monótona) com erro máximo ≤ tol. `qs` = quadro da mídia de cada ponto.
 */
export function reduzirKeyframes(traj, qs, tol = 0.004, maxK = 400) {
  const n = traj.length;
  if (!n) return [];
  if (n === 1) return [[qs[0], traj[0].cx, traj[0].cy]];
  const ts = traj.map((p) => p.t);
  const sel = new Set([0, n - 1]);
  for (;;) {
    const idx = [...sel].sort((a, b) => a - b);
    const xs = idx.map((i) => ts[i]);
    const cx = idx.map((i) => traj[i].cx), cy = idx.map((i) => traj[i].cy);
    let pior = -1, erroMax = tol;
    for (let i = 0; i < n; i++) {
      if (sel.has(i)) continue;
      const e = Math.max(Math.abs(hermiteMonotona(xs, cx, ts[i]) - traj[i].cx), Math.abs(hermiteMonotona(xs, cy, ts[i]) - traj[i].cy));
      if (e > erroMax) { erroMax = e; pior = i; }
    }
    if (pior < 0 || sel.size >= maxK) break;
    sel.add(pior);
  }
  return [...sel].sort((a, b) => a - b).map((i) => [qs[i], round5(traj[i].cx), round5(traj[i].cy)]);
}
const round5 = (x) => Math.round(x * 1e5) / 1e5;

/* ====================================================================== associação (pura) */

const area = (b) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const centro = (b) => ({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 });

/** Centro de enquadramento de uma pessoa: um pouco acima do meio da caixa (cabeça no quadro). */
const centroPessoa = (b) => ({ x: (b.x1 + b.x2) / 2, y: b.y1 + 0.45 * (b.y2 - b.y1) });

/**
 * Escolhe e emenda a trilha do alvo nas detecções com ID (por quadro analisado).
 * @param {Array<{q, t, dets: {x1,y1,x2,y2,score,id}[]}>} quadros
 * @param {{q:number, x:number, y:number}|null} clique  null = pessoa principal
 * @returns {{caixas: (object|null)[], alvo: number|null}}
 */
export function escolherTrilha(quadros, clique) {
  const porId = new Map();
  quadros.forEach((f, i) => { for (const d of f.dets) { if (d.id == null) continue; if (!porId.has(d.id)) porId.set(d.id, []); porId.get(d.id).push({ i, b: d }); } });
  if (!porId.size) return { caixas: quadros.map(() => null), alvo: null };
  let alvo = null;
  if (clique) {
    const i0 = quadros.findIndex((f) => f.q >= clique.q);
    const f = quadros[i0 < 0 ? quadros.length - 1 : i0];
    let melhor = null, dMelhor = Infinity;
    for (const d of f.dets) {
      if (d.id == null) continue;
      const dentro = clique.x >= d.x1 && clique.x <= d.x2 && clique.y >= d.y1 && clique.y <= d.y2;
      const c = centro(d);
      const dist = (dentro ? 0 : 1) + Math.hypot(c.x - clique.x, c.y - clique.y) + (dentro ? area(d) : 0);
      if (dist < dMelhor) { dMelhor = dist; melhor = d; }
    }
    if (melhor && dMelhor < 1.2) alvo = melhor.id;   // fora de qualquer caixa e longe: não há pessoa ali
    if (alvo === null) return { caixas: quadros.map(() => null), alvo: null };
  } else {
    // pessoa principal: área × centralidade × presença, somadas no clipe
    let melhor = -1;
    for (const [id, l] of porId) {
      let s = 0;
      for (const { b } of l) { const c = centro(b); s += Math.sqrt(area(b)) * (1.2 - Math.hypot(c.x - 0.5, c.y - 0.5)) * (b.score || 0.5); }
      if (s > melhor) { melhor = s; alvo = id; }
    }
  }
  const caixas = quadros.map(() => null);
  const usados = new Set([alvo]);
  for (const { i, b } of porId.get(alvo)) caixas[i] = b;
  // emenda: trilhas novas que começam perto de onde a do alvo terminou (e vice-versa)
  const fimDe = () => { let u = -1; caixas.forEach((b, i) => { if (b) u = i; }); return u; };
  const iniDe = () => caixas.findIndex(Boolean);
  const casa = (ref, b, gap) => {
    const c1 = centro(ref), c2 = centro(b);
    const raz = area(b) / Math.max(1e-6, area(ref));
    const lim = 0.12 + 0.02 * gap;   // larguras: quanto maior o buraco, mais longe pode estar
    return Math.hypot(c1.x - c2.x, c1.y - c2.y) < Math.min(0.35, lim) && raz > 0.4 && raz < 2.5;
  };
  for (let volta = 0; volta < 20; volta++) {
    let mudou = false;
    const u = fimDe(), p = iniDe();
    let cand = null, candGap = Infinity;
    for (const [id, l] of porId) {
      if (usados.has(id)) continue;
      const ini = l[0], fim = l[l.length - 1];
      if (ini.i > u && ini.i - u < candGap && casa(caixas[u], ini.b, ini.i - u)) { cand = { id, l, lado: 'fim' }; candGap = ini.i - u; }
      if (fim.i < p && p - fim.i < candGap && casa(caixas[p], fim.b, p - fim.i)) { cand = { id, l, lado: 'ini' }; candGap = p - fim.i; }
    }
    if (cand) {
      usados.add(cand.id);
      for (const { i, b } of cand.l) if (!caixas[i] && (cand.lado === 'fim' ? i > u : i < p)) caixas[i] = b;
      mudou = true;
    }
    if (!mudou) break;
  }
  return { caixas, alvo };
}

/* ====================================================================== aparência (ZNCC) */

/**
 * Rastreia um modelo em tons de cinza. `quadros[i]` = Uint8Array w×h.
 * Começa em i0 (posição px, py em pixels do quadro reduzido) e vai para a
 * frente e para trás. Devolve [{x, y, ok}] por quadro (pixels).
 */
export function rastrearAparencia(quadros, w, h, i0, px, py, { meio = 18, busca = 24 } = {}) {
  const n = quadros.length;
  const out = new Array(n).fill(null);
  const tam = 2 * meio + 1;
  const pegar = (img, cx, cy) => {
    const t = new Float32Array(tam * tam);
    let s = 0, s2 = 0;
    for (let j = 0; j < tam; j++) {
      const y = Math.min(h - 1, Math.max(0, Math.round(cy) - meio + j));
      for (let i = 0; i < tam; i++) {
        const x = Math.min(w - 1, Math.max(0, Math.round(cx) - meio + i));
        const v = img[y * w + x];
        t[j * tam + i] = v; s += v; s2 += v * v;
      }
    }
    const m = s / t.length, dp = Math.sqrt(Math.max(1e-6, s2 / t.length - m * m));
    for (let k = 0; k < t.length; k++) t[k] = (t[k] - m) / dp;
    return t;
  };
  const zncc = (img, mod, cx, cy) => {
    let s = 0, s2 = 0, sp = 0;
    const N = tam * tam;
    for (let j = 0; j < tam; j++) {
      const y = cy - meio + j;
      if (y < 0 || y >= h) return -2;
      const base = y * w;
      for (let i = 0; i < tam; i++) {
        const x = cx - meio + i;
        if (x < 0 || x >= w) return -2;
        const v = img[base + x];
        s += v; s2 += v * v; sp += v * mod[j * tam + i];
      }
    }
    const m = s / N, dp = Math.sqrt(Math.max(1e-6, s2 / N - m * m));
    return (sp - m * 0) / (N * dp);   // Σ(v−m)·t̂ = Σv·t̂ (t̂ tem média zero)
  };
  const passo = (img, mod, x0, y0) => {
    let melhor = -3, bx = Math.round(x0), by = Math.round(y0);
    const grade = new Map();
    for (let dy = -busca; dy <= busca; dy += 2) for (let dx = -busca; dx <= busca; dx += 2) {
      const x = Math.round(x0) + dx, y = Math.round(y0) + dy;
      const v = zncc(img, mod, x, y);
      if (v > melhor) { melhor = v; bx = x; by = y; }
    }
    // refino fino ao redor do melhor da grade grossa
    const cx0 = bx, cy0 = by;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = cx0 + dx, y = cy0 + dy;
      const v = zncc(img, mod, x, y);
      grade.set(dx + ',' + dy, v);
      if (v > melhor) { melhor = v; bx = x; by = y; }
    }
    // subpixel: parábola nos vizinhos
    const f = (dx, dy) => { const k = (bx - cx0 + dx) + ',' + (by - cy0 + dy); return grade.has(k) ? grade.get(k) : zncc(img, mod, bx + dx, by + dy); };
    const c = melhor, l = f(-1, 0), r = f(1, 0), u = f(0, -1), d = f(0, 1);
    const sx = (l > -2 && r > -2 && l + r - 2 * c < 0) ? Math.max(-0.5, Math.min(0.5, 0.5 * (l - r) / (l + r - 2 * c))) : 0;
    const sy = (u > -2 && d > -2 && u + d - 2 * c < 0) ? Math.max(-0.5, Math.min(0.5, 0.5 * (u - d) / (u + d - 2 * c))) : 0;
    return { x: bx + sx, y: by + sy, score: melhor };
  };
  const mod0 = pegar(quadros[i0], px, py);
  out[i0] = { x: px, y: py, ok: true, score: 1 };
  for (const dir of [1, -1]) {
    let mod = mod0, x = px, y = py, vx = 0, vy = 0, perdidos = 0;
    for (let i = i0 + dir; i >= 0 && i < n; i += dir) {
      const r = passo(quadros[i], mod, x + vx, y + vy);
      if (r.score < 0.35) {   // perdeu: segura a posição prevista, tenta de novo no próximo
        perdidos++;
        out[i] = { x: x + vx, y: y + vy, ok: false, score: r.score };
        x += vx; y += vy; vx *= 0.8; vy *= 0.8;
        if (perdidos > 45) { x = out[i].x; y = out[i].y; }
        continue;
      }
      perdidos = 0;
      vx = 0.7 * vx + 0.3 * (r.x - x); vy = 0.7 * vy + 0.3 * (r.y - y);
      x = r.x; y = r.y;
      out[i] = { x, y, ok: true, score: r.score };
      // o modelo acompanha devagar (luz, escala), ancorado no do clique (não deriva)
      if (r.score > 0.6) {
        const novo = pegar(quadros[i], x, y);
        const m = new Float32Array(mod0.length);
        for (let k = 0; k < m.length; k++) m[k] = 0.6 * mod0[k] + 0.25 * mod[k] + 0.15 * novo[k];
        mod = m;
      }
    }
  }
  return out;
}

/* ====================================================================== análise (navegador) */

/** Desenha o quadro inteiro girado (rot 0/90/180/270, horário) em W×H. */
export function desenharGirado(ctx, src, sw, sh, rot, W, H) {
  ctx.save();
  if (rot === 90) { ctx.translate(W, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(src, 0, 0, sw, sh, 0, 0, H, W); }
  else if (rot === 180) { ctx.translate(W, H); ctx.rotate(Math.PI); ctx.drawImage(src, 0, 0, sw, sh, 0, 0, W, H); }
  else if (rot === 270) { ctx.translate(0, H); ctx.rotate(-Math.PI / 2); ctx.drawImage(src, 0, 0, sw, sh, 0, 0, H, W); }
  else ctx.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
  ctx.restore();
}

const LARG_ANALISE = 640;
const LARG_CINZA = 320;

/** Pessoas (COCO classe 0) num ImageData, com o YOLOX pela fila do ORT. Normalizadas 0..1. */
async function detectarPessoas(img, conf) {
  const [{ MODELS, run, makeTensor }, { letterbox, toTensorData, decodeYolox, unletterbox }] = await Promise.all([
    import('../../cv/runtime/onnx.js'), import('../../cv/runtime/tensor.js'),
  ]);
  const spec = MODELS.yolox;
  const lb = letterbox(img, spec.input[3], spec.input[2]);
  const t = await makeTensor(toTensorData(lb.data, spec), spec.input);
  const out = await run('yolox', t);
  const k = Object.keys(out)[0];
  const caixas = decodeYolox(out[k].data, out[k].dims, spec, Math.min(conf, 0.25), 0.45, 40);
  return caixas.filter((b) => b.classId === 0).map((b) => {
    const u = unletterbox(b, lb);
    return {
      x1: Math.max(0, u.x1 / img.width), y1: Math.max(0, u.y1 / img.height),
      x2: Math.min(1, u.x2 / img.width), y2: Math.min(1, u.y2 / img.height), score: b.score, name: 'person',
    };
  });
}

/**
 * Pessoas no quadro que o visor mostra (o <video> já vem girado), para a dica
 * visual do modo "clique no sujeito". Só roda se o detector carregar.
 */
export async function detectarPessoasNoQuadro(video) {
  if (!video || !video.videoWidth) return null;
  await carregarModelo('yolox');
  const W = Math.min(LARG_ANALISE, video.videoWidth), H = Math.max(2, Math.round(W * video.videoHeight / video.videoWidth));
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, W, H);
  return (await detectarPessoas(ctx.getImageData(0, 0, W, H), 0.4)).filter((b) => b.score >= 0.4);
}

/** Carrega um modelo do catálogo, com progresso. */
async function carregarModelo(id, aoProgresso) {
  const ox = await import('../../cv/runtime/onnx.js');
  if (ox.isReady(id)) return;
  const des = ox.onModelState ? ox.onModelState(() => {
    const st = ox.modelStates()[id];
    if (st && aoProgresso) aoProgresso(st.progress || 0);
  }) : null;
  try { await ox.loadModel(id); } finally { if (typeof des === 'function') des(); }
}

/**
 * O SAM 2 (sam2.seguir) está no catálogo? (Sem sondar a rede: se os pesos
 * não carregarem na hora, a análise cai para o rastreio por aparência e avisa.)
 */
export async function sam2Disponivel() {
  try {
    const { getSpec } = await import('../../cv/runtime/onnx.js');
    const enc = getSpec('sam2-enc'), dec = getSpec('sam2-dec');
    return Boolean(enc && enc.file && dec && !enc.agpl);
  } catch (_) { return false; }
}

/**
 * Motor SAM 2: dirige o operador sam2.seguir quadro a quadro (aguarda cada
 * inferência). Devolve uma função (img) → caixa normalizada | null.
 */
async function motorSam2(ponto, aoProgresso) {
  await carregarModelo('sam2-enc', (f) => aoProgresso(0.5 * f));
  await carregarModelo('sam2-dec', (f) => aoProgresso(0.5 + 0.5 * f));
  const { sam2Seguir } = await import('../../cv/operators/livres-b/sam2.js');
  const p = {};
  for (const [k, d] of Object.entries(sam2Seguir.params)) p[k] = d.default;
  Object.assign(p, { modo: 'seguir objeto', alvo: 'ponto na imagem', pontoX: ponto.x, pontoY: ponto.y, everyMs: 0, contorno: false });
  const state = {};
  return async (img) => {
    const ctx = () => ({ w: img.width, h: img.height, metrics: {}, overlay: [] });
    state.lastStart = 0;
    sam2Seguir.apply(img, p, state, ctx());
    while (state.busy) await new Promise((r) => setTimeout(r, 5));
    const c2 = ctx();
    sam2Seguir.apply(img, { ...p, everyMs: 1e12 }, state, c2);   // absorve o resultado sem agendar outro
    if (state.error) throw new Error('SAM 2: ' + state.error);
    return c2.track ? { x1: c2.track.x1, y1: c2.track.y1, x2: c2.track.x2, y2: c2.track.y2 } : null;
  };
}

/**
 * Analisa o clipe c e devolve os centros brutos do sujeito.
 * @param {object} o
 * @param {Blob} o.blob, {string} o.url, {object} o.ix  mídia (StudioVideo)
 * @param {object} o.c        clipe
 * @param {number} o.qRef     quadro (mídia) do clique / de referência
 * @param {{x,y}|null} o.ponto  clique normalizado (no referencial do visor) ou null (pessoa principal)
 * @param {'auto'|'pessoa'|'aparencia'|'sam2'} o.motor
 * @param {number} o.passo    analisa 1 a cada `passo` quadros (o resto é interpolado)
 * @returns {Promise<{amostras: {q,t,cx,cy}[], motor: string, perdidos: number, analisados: number}>}
 */
export async function analisarClipe({ blob, url, ix, c, qRef, ponto, motor = 'auto', passo = 1, conf = 0.3, deslocEl = 0, aoProgresso = () => {}, cancelado = () => false }) {
  const v = ix.video;
  const rot = v.rotacao || 0;
  const W = Math.min(LARG_ANALISE, v.largura), H = Math.max(2, Math.round(W * v.altura / v.largura));
  const Wc = Math.min(LARG_CINZA, W), Hc = Math.max(2, Math.round(Wc * v.altura / v.largura));
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const cvc = new OffscreenCanvas(Wc, Hc);
  const ctxc = cvc.getContext('2d', { willReadFrequently: true });
  qRef = Math.max(c.a, Math.min(c.b - 1, qRef));

  // ---- quais quadros: 1 a cada `passo`, sempre o de referência e o último
  const escolhidos = new Set();
  for (let q = c.a; q < c.b; q += Math.max(1, passo)) escolhidos.add(q);
  escolhidos.add(qRef); escolhidos.add(c.b - 1);
  const total = escolhidos.size;

  // ---- motor
  // SAM 2 precisa de um ponto; "pessoa principal" é sempre pelo detector
  let usar = motor === 'auto' || (motor === 'sam2' && !ponto) ? 'pessoa' : motor;
  if (usar === 'pessoa') {
    aoProgresso(0, 'Carregando o detector de pessoas…');
    try { await carregarModelo('yolox', (f) => aoProgresso(0, `Baixando o detector de pessoas… ${Math.round(f * 100)}%`)); }
    catch (err) {
      if (motor === 'pessoa' || !ponto) throw new Error('detector de pessoas indisponível (' + err.message + ')');
      usar = 'aparencia';
    }
  }
  const avisos = [];
  let rastreador = null;
  if (usar === 'sam2') {
    try { rastreador = await motorSam2(ponto, (f) => aoProgresso(0, `Carregando o SAM 2… ${Math.round(f * 100)}%`)); }
    catch (err) { avisos.push('SAM 2 indisponível (' + (err && err.message) + '): rastreio por aparência.'); usar = 'aparencia'; }
  }
  if (cancelado()) throw new Cancelado();

  const quadros = [];        // { q, t, dets?, cinza? }
  const { byteTrack } = await import('../../cv/operators/tracking.js');
  const pTrack = {};
  for (const [k, d] of Object.entries(byteTrack.params)) pTrack[k] = d.default;
  Object.assign(pTrack, { altaConf: 0.45, nascer: 1, perder: Math.max(10, Math.round(30 / passo)), rastro: 0 });
  const sTrack = {};
  const fake = { width: 1, height: 1, data: new Uint8ClampedArray(4) };

  let feitos = 0;
  const processar = async (src, sw, sh, q, girar = rot) => {
    if (cancelado()) throw new Cancelado();
    desenharGirado(ctx, src, sw, sh, girar, W, H);
    const reg = { q, t: v.pts[q] / 1e6 };
    if (usar === 'pessoa') {
      const img = ctx.getImageData(0, 0, W, H);
      const dets = await detectarPessoas(img, conf);
      const tctx = { w: W, h: H, detections: dets, overlay: [], metrics: {} };
      byteTrack.apply(fake, pTrack, sTrack, tctx);
      reg.dets = tctx.detections;   // confirmadas, com id
    }
    if (usar === 'aparencia' || (usar === 'pessoa' && ponto)) {
      // guarda o quadro reduzido em cinza: reserva se não houver pessoa sob o clique
      ctxc.drawImage(cv, 0, 0, Wc, Hc);
      const d = ctxc.getImageData(0, 0, Wc, Hc).data;
      const g = new Uint8Array(Wc * Hc);
      for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
      reg.cinza = g;
    }
    if (usar === 'sam2') {
      if (q >= qRef) {
        reg.caixa = await rastreador(ctx.getImageData(0, 0, W, H));
      } else reg.caixa = undefined;   // antes do clique: segura no ponto
    }
    quadros.push(reg);
    feitos++;
    aoProgresso(feitos / total, `Analisando quadro ${feitos} de ${total}`);
  };

  const cfgDec = await podeDecodificar(ix);
  if (cfgDec) {
    await percorrer({
      blob, v, partes: [{ c, qa: c.a, qb: c.b, tOut: 0 }], cfgDec, cancelado,
      aoQuadro: async (f, q) => { if (escolhidos.has(q)) await processar(f, f.displayWidth, f.displayHeight, q); },
    });
  } else {
    // reserva: <video> oculto, busca quadro a quadro (o elemento já aplica a rotação)
    const video = document.createElement('video');
    video.src = url; video.muted = true; video.playsInline = true; video.preload = 'auto';
    await new Promise((r, j) => { video.onloadeddata = r; video.onerror = () => j(new Error('vídeo ilegível')); });
    try {
      for (const q of [...escolhidos].sort((a, b) => a - b)) {
        if (cancelado()) throw new Cancelado();
        await new Promise((r) => { video.onseeked = () => r(); video.currentTime = (v.pts[q] + (v.pts[q + 1] - v.pts[q]) / 2) / 1e6 + deslocEl; });
        await processar(video, video.videoWidth, video.videoHeight, q, 0);
      }
    } finally { video.removeAttribute('src'); video.load(); }
  }
  quadros.sort((a, b) => a.q - b.q);
  const iRef = Math.max(0, quadros.findIndex((f) => f.q >= qRef));

  // ---- trajetória bruta
  let caixas = null, fonte = usar;
  if (usar === 'pessoa') {
    const r = escolherTrilha(quadros.map((f) => ({ q: f.q, t: f.t, dets: f.dets || [] })), ponto ? { q: qRef, ...ponto } : null);
    if (r.alvo === null) {
      if (!ponto) throw new Error('nenhuma pessoa encontrada no clipe');
      fonte = 'aparencia';
    } else caixas = r.caixas;
  }
  let amostras;
  if (fonte === 'pessoa') {
    amostras = quadros.map((f, i) => {
      const b = caixas[i];
      if (!b) return { q: f.q, t: f.t, cx: NaN, cy: NaN };
      const cc = centroPessoa(b);
      return { q: f.q, t: f.t, cx: cc.x, cy: cc.y, caixa: b };
    });
  } else if (fonte === 'sam2') {
    amostras = quadros.map((f) => {
      if (f.caixa === undefined) return { q: f.q, t: f.t, cx: ponto.x, cy: ponto.y };
      if (!f.caixa) return { q: f.q, t: f.t, cx: NaN, cy: NaN };
      const cc = centro(f.caixa);
      return { q: f.q, t: f.t, cx: cc.x, cy: cc.y, caixa: f.caixa };
    });
  } else {
    const pts = rastrearAparencia(quadros.map((f) => f.cinza), Wc, Hc, iRef, ponto.x * Wc, ponto.y * Hc);
    amostras = quadros.map((f, i) => ({ q: f.q, t: f.t, cx: pts[i] && pts[i].ok ? pts[i].x / Wc : NaN, cy: pts[i] && pts[i].ok ? pts[i].y / Hc : NaN }));
  }
  const perdidos = amostras.filter((a) => !Number.isFinite(a.cx)).length;
  if (perdidos === amostras.length) throw new Error('o sujeito não foi encontrado');
  return { amostras, motor: fonte, perdidos, analisados: quadros.length, avisos };
}

/**
 * Da análise ao clipe: suaviza, completa os quadros não analisados e reduz a
 * keyframes. `tam` = tamanho do recorte (normalizado).
 * @returns {{k: Array, traj: Array}}  keyframes [[q, cx, cy]] e a trajetória densa por quadro
 */
export function keyframesDaAnalise(v, c, amostras, tam, opcoes = {}) {
  const traj = suavizarTrajetoria(amostras, tam, opcoes);
  if (!traj) return null;
  // trajetória densa em TODOS os quadros do clipe (interpolando os analisados)
  const xs = traj.map((p) => p.t), cx = traj.map((p) => p.cx), cy = traj.map((p) => p.cy);
  const qs = [], densa = [];
  for (let q = c.a; q < c.b; q++) {
    const t = v.pts[q] / 1e6;
    qs.push(q);
    densa.push({ t, cx: hermiteMonotona(xs, cx, t), cy: hermiteMonotona(xs, cy, t) });
  }
  const k = reduzirKeyframes(densa, qs, opcoes.tolerancia || 0.004);
  return { k, traj: densa };
}

/** Para testes/diagnóstico: centro do recorte em cada quadro do clipe. */
export function centrosDoClipe(v, c) {
  const out = [];
  for (let q = c.a; q < c.b; q++) out.push(c.seg ? centroSeguir(v, c.seg.k, q) : null);
  return out;
}
