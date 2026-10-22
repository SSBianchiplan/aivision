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

/** Retângulo de enquadramento do quadro q no clipe c (recorte geral se o clipe não tem Ken Burns). */
export function enquadramento(v, c, q, recorte) {
  if (!c || !c.kb) return recorte;
  const dur = v.pts[c.b - 1] - v.pts[c.a];
  const f = dur > 0 ? Math.min(1, Math.max(0, (v.pts[q] - v.pts[c.a]) / dur)) : 0;
  return lerpRet(c.kb.a, c.kb.b, suave(f));
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
    c.a >= 0 && c.b <= v.n && c.a < c.b && Number.isFinite(c.em) && c.em >= 0);
}
