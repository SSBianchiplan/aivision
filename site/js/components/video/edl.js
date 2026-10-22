/**
 * components/video/edl.js — o modelo NÃO DESTRUTIVO do editor (GPlanSiS|Vídeo).
 *
 * A mídia original nunca é alterada. A edição é uma lista de clipes (EDL):
 *
 *   { id, a, b, em, kb? }
 *     a, b  quadros da MÍDIA (ordem de apresentação), intervalo [a, b)
 *     em    onde o clipe começa na TIMELINE, em microssegundos
 *     kb    zoom/pan (Ken Burns) opcional: { a: ret, b: ret } — o enquadramento
 *           no primeiro e no último quadro do clipe, interpolado no meio
 *     seg   reenquadramento por sujeito opcional ("Seguir sujeito"):
 *           { k: [[q, cx, cy], ...] } — keyframes do centro do recorte
 *           em quadros da mídia; tem prioridade sobre o kb
 *
 * A duração de um clipe é a soma das durações REAIS dos quadros dele
 * (pts[b] − pts[a]): um vídeo de taxa variável (gravação do navegador) não
 * acelera nem atrasa ao ser editado, e o áudio continua sincronizado.
 *
 * Retângulos (recorte e Ken Burns) são normalizados 0..1 sobre o quadro.
 * Todas as funções são puras: recebem a lista e devolvem uma lista nova
 * (o desfazer guarda as listas anteriores).
 */

let seq = 0;
export const novoId = () => 'c' + Date.now().toString(36) + (seq++).toString(36);

export const durClipe = (v, c) => v.pts[c.b] - v.pts[c.a];
export const fimClipe = (v, c) => c.em + durClipe(v, c);

/** Clipes em ordem de posição na timeline. */
export const ordenar = (clipes) => [...clipes].sort((x, y) => x.em - y.em);

export function fimTimeline(v, clipes) {
  let f = 0;
  for (const c of clipes) f = Math.max(f, fimClipe(v, c));
  return f;
}

/** O clipe sob o instante t da timeline (ou null numa lacuna). */
export function clipeEm(v, clipes, t) {
  for (const c of clipes) if (t >= c.em && t < fimClipe(v, c)) return c;
  return null;
}

/** Quadro da mídia mostrado no instante t (dentro do clipe c). */
export function quadroNoClipe(v, c, t) {
  const alvo = v.pts[c.a] + (t - c.em);
  let lo = c.a, hi = c.b - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (v.pts[m] <= alvo + 1) lo = m; else hi = m - 1;
  }
  return lo;
}

/** Instante da timeline onde o quadro q (da mídia) do clipe c começa. */
export const tempoDoQuadro = (v, c, q) => c.em + (v.pts[q] - v.pts[c.a]);

/** Ajusta t ao início do quadro que ele cobre (o playhead parado fica sempre numa fronteira). */
export function ajustarAoQuadro(v, clipes, t, fpsNominal) {
  const c = clipeEm(v, clipes, t);
  if (c) return tempoDoQuadro(v, c, quadroNoClipe(v, c, t));
  // lacuna (ou depois do fim): grade do fps nominal a partir do fim do clipe anterior
  const dq = 1e6 / fpsNominal;
  let base = 0;
  for (const x of clipes) { const f = fimClipe(v, x); if (f <= t && f > base) base = f; }
  return base + Math.floor((t - base) / dq + 1e-6) * dq;
}

/** Próxima/anterior fronteira de quadro a partir de t (passo de ±k quadros). */
export function passoQuadro(v, clipes, t, k, fpsNominal) {
  let p = ajustarAoQuadro(v, clipes, t, fpsNominal);
  const fim = fimTimeline(v, clipes);
  const dir = k > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(k); i++) {
    // para trás, olha um pouco antes da fronteira (quadroNoClipe tolera 1 µs de arredondamento)
    const tp = dir > 0 ? p : p - 2;
    const c = clipeEm(v, clipes, tp);
    if (c) {
      const q = quadroNoClipe(v, c, tp);
      p = dir > 0 ? tempoDoQuadro(v, c, q) + (v.pts[q + 1] - v.pts[q]) : tempoDoQuadro(v, c, q);
    } else {
      p += dir * 1e6 / fpsNominal;
      // não pula a fronteira de um clipe vizinho
      for (const x of clipes) {
        if (dir > 0 && x.em > p - 1e6 / fpsNominal && x.em < p) p = x.em;
        const f = fimClipe(v, x);
        if (dir < 0 && f < p + 1e6 / fpsNominal && f > p) p = f;
      }
    }
    if (p <= 0) { p = 0; break; }
    if (p >= fim) { p = fim; break; }
  }
  return Math.round(p);
}

/* ------------------------------------------------------------ Ken Burns */

export const lerp = (x, y, f) => x + (y - x) * f;
export const lerpRet = (r1, r2, f) => ({ x: lerp(r1.x, r2.x, f), y: lerp(r1.y, r2.y, f), w: lerp(r1.w, r2.w, f), h: lerp(r1.h, r2.h, f) });
// suave nas pontas (o movimento começa e termina devagar)
const suave = (f) => f * f * (3 - 2 * f);

/**
 * Retângulo de enquadramento do quadro q no clipe c. Prioridade: o
 * reenquadramento por sujeito (c.seg, "Seguir sujeito"), o Ken Burns (c.kb)
 * e, sem nenhum dos dois, o recorte geral.
 */
export function enquadramento(v, c, q, recorte) {
  if (!c) return recorte;
  if (c.seg && c.seg.k && c.seg.k.length) return retSeguir(v, c.seg.k, q, recorte);
  if (!c.kb) return recorte;
  const dur = v.pts[c.b - 1] - v.pts[c.a];
  const f = dur > 0 ? Math.min(1, Math.max(0, (v.pts[q] - v.pts[c.a]) / dur)) : 0;
  return lerpRet(c.kb.a, c.kb.b, suave(f));
}

/* ------------------------------------------------------------ seguir sujeito (reenquadramento) */

/*
 * c.seg = { k: [[q, cx, cy], ...], prop?, motor? } — keyframes do CENTRO do
 * recorte (normalizado 0..1) em quadros q da MÍDIA, em ordem. O tamanho do
 * retângulo é sempre o do recorte geral (a saída tem um tamanho só); só o
 * centro anda. Os keyframes ficam na mídia, não na timeline: cortar, aparar
 * e mover o clipe não os desloca (o sujeito continua onde estava no quadro).
 * Entre keyframes: cúbica de Hermite monótona (Fritsch–Carlson) sobre o pts
 * real — sem "quinas" de velocidade nos keyframes e sem passar do valor dos
 * vizinhos (logo, sem sair da imagem se os keyframes estão dentro).
 */

/** Derivadas de Fritsch–Carlson para os pontos (xs, ys). */
function derivadasMonotonas(xs, ys) {
  const n = xs.length;
  const d = new Float64Array(n), m = new Float64Array(Math.max(1, n - 1));
  for (let i = 0; i < n - 1; i++) m[i] = (ys[i + 1] - ys[i]) / Math.max(1e-9, xs[i + 1] - xs[i]);
  if (n === 1) return d;
  d[0] = m[0]; d[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) d[i] = 0;
    else {
      const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i];
      const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
      d[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);   // média harmônica ponderada
    }
  }
  // nas pontas: não deixa a tangente inverter nem passar de 3× a inclinação
  for (const [i, j] of [[0, 0], [n - 1, n - 2]]) {
    if (d[i] * m[j] <= 0) d[i] = 0;
    else if (Math.abs(d[i]) > 3 * Math.abs(m[j])) d[i] = 3 * m[j];
  }
  return d;
}

/** Valor em x da cúbica monótona pelos pontos (xs, ys); `ds` = derivadas já calculadas. */
export function hermiteMonotona(xs, ys, x, ds) {
  const n = xs.length;
  if (!n) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const d = ds || derivadasMonotonas(xs, ys);
  const h = xs[hi] - xs[lo], s = (x - xs[lo]) / h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * ys[lo] + (s3 - 2 * s2 + s) * h * d[lo] + (-2 * s3 + 3 * s2) * ys[hi] + (s3 - s2) * h * d[hi];
}

// cache por lista de keyframes (a lista é imutável: cada edição cria outra)
const cacheSeg = new WeakMap();
function prepSeg(v, k) {
  let p = cacheSeg.get(k);
  if (p && p.v === v) return p;
  const xs = k.map((x) => v.pts[Math.max(0, Math.min(v.n, x[0]))] / 1e6);
  const cx = k.map((x) => x[1]), cy = k.map((x) => x[2]);
  p = { v, xs, cx, cy, dx: derivadasMonotonas(xs, cx), dy: derivadasMonotonas(xs, cy) };
  cacheSeg.set(k, p);
  return p;
}

/** Centro {cx, cy} do recorte no quadro q, pelos keyframes k. */
export function centroSeguir(v, k, q) {
  const p = prepSeg(v, k);
  const t = v.pts[Math.max(0, Math.min(v.n, q))] / 1e6;
  return { cx: hermiteMonotona(p.xs, p.cx, t, p.dx), cy: hermiteMonotona(p.xs, p.cy, t, p.dy) };
}

/** Retângulo do recorte (tamanho do recorte geral) centrado no sujeito, sempre dentro da imagem. */
export function retSeguir(v, k, q, recorte) {
  const { cx, cy } = centroSeguir(v, k, q);
  const w = recorte.w, h = recorte.h;
  return { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h };
}

/** Clipes com o keyframe i do clipe `id` levado ao quadro q (sem cruzar os vizinhos). */
export function moverKeyframe(clipes, id, i, q) {
  return clipes.map((c) => {
    if (c.id !== id || !c.seg) return c;
    const k = c.seg.k;
    const min = i > 0 ? k[i - 1][0] + 1 : -Infinity, max = i < k.length - 1 ? k[i + 1][0] - 1 : Infinity;
    const nq = Math.max(min, Math.min(max, Math.round(q)));
    if (nq === k[i][0]) return c;
    return { ...c, seg: { ...c.seg, k: k.map((x, j) => (j === i ? [nq, x[1], x[2]] : x)) } };
  });
}

/** Clipes sem o keyframe i do clipe `id` (sem keyframes, o clipe volta ao recorte geral). */
export function apagarKeyframe(clipes, id, i) {
  return clipes.map((c) => {
    if (c.id !== id || !c.seg) return c;
    const k = c.seg.k.filter((_, j) => j !== i);
    if (!k.length) { const n = { ...c }; delete n.seg; return n; }
    return { ...c, seg: { ...c.seg, k } };
  });
}

/** Clipes com um keyframe (q, cx, cy) no clipe `id` — substitui o do mesmo quadro. */
export function porKeyframe(clipes, id, q, cx, cy) {
  return clipes.map((c) => {
    if (c.id !== id) return c;
    const k = (c.seg ? c.seg.k : []).filter((x) => x[0] !== q);
    k.push([q, cx, cy]);
    k.sort((a, b) => a[0] - b[0]);
    const n = { ...c, seg: { ...(c.seg || {}), k } };
    delete n.kb;
    return n;
  });
}

/** Índices dos keyframes do clipe que caem dentro do trecho [a, b) usado. */
export function keyframesVisiveis(c) {
  if (!c.seg || !c.seg.k) return [];
  const out = [];
  c.seg.k.forEach((x, i) => { if (x[0] >= c.a && x[0] < c.b) out.push(i); });
  return out;
}

/* ------------------------------------------------------------ operações */

/** Navalha: corta o clipe sob t na fronteira de quadro. Devolve null se não houver o que cortar. */
export function cortar(v, clipes, t) {
  const c = clipeEm(v, clipes, t);
  if (!c) return null;
  const q = quadroNoClipe(v, c, t);
  if (q <= c.a || q >= c.b) return null;
  const e = { ...c, b: q };
  const d = { ...c, id: novoId(), a: q, em: tempoDoQuadro(v, c, q) };
  if (c.kb) {
    const meio = enquadramento(v, c, q, null);
    e.kb = { a: c.kb.a, b: meio };
    d.kb = { a: meio, b: c.kb.b };
  }
  return clipes.flatMap((x) => (x === c ? [e, d] : [x]));
}

/** Corta em vários instantes (marcadores, entrada/saída). */
export function cortarEmTodos(v, clipes, tempos) {
  let out = clipes;
  for (const t of tempos) { const r = cortar(v, out, t); if (r) out = r; }
  return out;
}

/**
 * Apaga os clipes `ids`. Sem ripple deixa a lacuna; com ripple, o que vem
 * depois anda para a esquerda o tanto que foi tirado antes dele.
 */
export function apagar(v, clipes, ids, ripple) {
  const tirar = clipes.filter((c) => ids.has(c.id));
  const ficam = clipes.filter((c) => !ids.has(c.id));
  if (!ripple) return ficam;
  return ficam.map((c) => {
    let des = 0;
    for (const x of tirar) if (x.em < c.em) des += durClipe(v, x);
    return des ? { ...c, em: c.em - des } : c;
  });
}

/** Tira o intervalo [t0, t1) da timeline (entrada/saída), cortando nas pontas. */
export function apagarFaixa(v, clipes, t0, t1, ripple) {
  let out = cortarEmTodos(v, clipes, [t0, t1]);
  const dentro = new Set(out.filter((c) => c.em >= t0 - 1 && fimClipe(v, c) <= t1 + 1).map((c) => c.id));
  out = out.filter((c) => !dentro.has(c.id));
  if (ripple) out = out.map((c) => (c.em >= t1 - 1 ? { ...c, em: c.em - (t1 - t0) } : c));
  return out;
}

/** Vizinhos de um clipe na timeline (para limitar aparos e movimentos). */
function vizinhos(v, clipes, c) {
  let ant = 0, prox = Infinity;
  for (const x of clipes) {
    if (x.id === c.id) continue;
    const f = fimClipe(v, x);
    if (f <= c.em + 1 && f > ant) ant = f;
    if (x.em >= fimClipe(v, c) - 1 && x.em < prox) prox = x.em;
  }
  return { ant, prox };
}

/**
 * Apara uma borda do clipe: `lado` 'a' (entrada) ou 'b' (saída), `q` o novo
 * quadro de borda na mídia. A borda que não mexe fica parada na timeline.
 * Com ripple (Shift), aparar a saída empurra/puxa os clipes seguintes.
 */
export function aparar(v, clipes, id, lado, q, ripple = false) {
  const c = clipes.find((x) => x.id === id);
  if (!c) return clipes;
  const { ant, prox } = vizinhos(v, clipes, c);
  let n;
  if (lado === 'a') {
    q = Math.max(0, Math.min(c.b - 1, q));
    let em = c.em + (v.pts[q] - v.pts[c.a]);
    if (em < ant) {   // não invade o clipe anterior: procura o primeiro quadro que cabe
      while (q < c.b - 1 && c.em + (v.pts[q] - v.pts[c.a]) < ant) q++;
      em = c.em + (v.pts[q] - v.pts[c.a]);
    }
    if (em < 0) { while (q < c.b - 1 && c.em + (v.pts[q] - v.pts[c.a]) < 0) q++; em = c.em + (v.pts[q] - v.pts[c.a]); }
    n = { ...c, a: q, em };
  } else {
    q = Math.max(c.a + 1, Math.min(v.n, q));
    if (!ripple) while (q > c.a + 1 && c.em + (v.pts[q] - v.pts[c.a]) > prox) q--;
    n = { ...c, b: q };
  }
  if (c.kb) n.kb = { ...c.kb };
  let out = clipes.map((x) => (x.id === id ? n : x));
  if (ripple && lado === 'b') {
    const delta = fimClipe(v, n) - fimClipe(v, c);
    out = out.map((x) => (x.id !== id && x.em >= fimClipe(v, c) - 1 ? { ...x, em: Math.max(0, x.em + delta) } : x));
  }
  return out;
}

/**
 * Move um clipe para começar em `em`. Se o lugar está livre (cabe numa
 * lacuna), só muda a posição. Se cair sobre outros clipes, vira REORDENAÇÃO:
 * o clipe entra antes/depois do vizinho mais próximo do ponto de soltar e a
 * sequência é refeita sem lacunas a partir do primeiro clipe afetado.
 */
export function mover(v, clipes, id, em) {
  const c = clipes.find((x) => x.id === id);
  if (!c) return clipes;
  em = Math.max(0, Math.round(em));
  const dur = durClipe(v, c);
  const outros = clipes.filter((x) => x.id !== id);
  const colide = outros.some((x) => em < fimClipe(v, x) - 1 && em + dur > x.em + 1);
  if (!colide) return clipes.map((x) => (x.id === id ? { ...x, em } : x));
  const ord = ordenar(outros);
  const centro = em + dur / 2;
  let i = ord.findIndex((x) => centro < x.em + durClipe(v, x) / 2);
  if (i < 0) i = ord.length;
  ord.splice(i, 0, c);
  // o que vem antes do ponto de inserção fica como estava; dali em diante, encostado
  let t = i > 0 ? fimClipe(v, ord[i - 1]) : Math.min(...clipes.map((x) => x.em));
  const out = ord.slice(0, i);
  for (let k = i; k < ord.length; k++) { out.push({ ...ord[k], em: t }); t += durClipe(v, ord[k]); }
  return out;
}

/** Fecha todas as lacunas (encosta tudo a partir do zero). */
export function fecharLacunas(v, clipes) {
  let t = 0;
  return ordenar(clipes).map((c) => { const n = { ...c, em: t }; t += durClipe(v, c); return n; });
}

/** Clipe único com a mídia inteira (projeto novo). */
export const clipeInicial = (v) => [{ id: novoId(), a: 0, b: v.n, em: 0 }];

/* ------------------------------------------------------------ desfazer */

export class Historico {
  constructor(lim = 200) { this.pilha = []; this.refazer = []; this.lim = lim; }
  guardar(estado) {
    this.pilha.push(estado);
    if (this.pilha.length > this.lim) this.pilha.shift();
    this.refazer = [];
  }
  desfazer(atual) { if (!this.pilha.length) return null; this.refazer.push(atual); return this.pilha.pop(); }
  refazerUm(atual) { if (!this.refazer.length) return null; this.pilha.push(atual); return this.refazer.pop(); }
  get podeDesfazer() { return this.pilha.length > 0; }
  get podeRefazer() { return this.refazer.length > 0; }
}

/* ------------------------------------------------------------ timecode */

/** HH:MM:SS:FF no fps nominal (FF = quadro dentro do segundo). */
export function timecode(us, fps) {
  if (!Number.isFinite(us) || us < 0) us = 0;
  const f = Math.round(fps) || 30;
  // timecode sem drop-frame: conta quadros no fps nominal e agrupa de f em f
  const totalQ = Math.floor(us * fps / 1e6 + 1e-3);
  const s = Math.floor(totalQ / f);
  const ff = totalQ % f;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ persistência */

const PREFIXO = 'gplansis.video.edl.';
const RECENTES = 'gplansis.video.recentes';

export const chaveMidia = (nome, tam, durUs, n) => `${tam}-${Math.round(durUs / 1000)}-${n}` + (nome ? '-' + nome.replace(/[^\w.-]+/g, '_').slice(0, 60) : '');

export function salvarProjeto(chave, dados) {
  try {
    localStorage.setItem(PREFIXO + chave, JSON.stringify({ ...dados, v: 1, atualizado: Date.now() }));
    const lista = listarRecentes().filter((r) => r.chave !== chave);
    lista.unshift({ chave, nome: dados.nome || 'vídeo', quando: Date.now(), clipes: dados.clipes.length });
    localStorage.setItem(RECENTES, JSON.stringify(lista.slice(0, 12)));
    // limpa projetos que saíram da lista
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIXO) && !lista.slice(0, 12).some((r) => PREFIXO + r.chave === k)) localStorage.removeItem(k);
    }
  } catch (_) { /* storage cheio ou bloqueado: a edição segue só na memória */ }
}

export function carregarProjeto(chave) {
  try {
    const raw = localStorage.getItem(PREFIXO + chave);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function listarRecentes() {
  try { return JSON.parse(localStorage.getItem(RECENTES) || '[]'); } catch (_) { return []; }
}

/** Valida uma lista de clipes lida do storage contra a mídia aberta. */
export function clipesValidos(v, clipes) {
  return Array.isArray(clipes) && clipes.length > 0 && clipes.every((c) =>
    c && typeof c.id === 'string' && Number.isInteger(c.a) && Number.isInteger(c.b) &&
    c.a >= 0 && c.b <= v.n && c.a < c.b && Number.isFinite(c.em) && c.em >= 0 &&
    (!c.seg || (c.seg && Array.isArray(c.seg.k) && c.seg.k.every((x) => Array.isArray(x) && Number.isInteger(x[0]) &&
      x[0] >= 0 && x[0] <= v.n && Number.isFinite(x[1]) && Number.isFinite(x[2])))));
}
