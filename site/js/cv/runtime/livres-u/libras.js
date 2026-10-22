/**
 * cv/runtime/livres-u/libras.js — soletração em Libras (alfabeto datilológico
 * ESTÁTICO) sobre os 21 pontos da mão do maos.gestos (CV-82, X3), sem DOM.
 *
 * LIMITE (declarado em toda a interface): só SOLETRAÇÃO letra a letra, com a
 * mão parada. Não reconhece sinais da Libras (que têm movimento, expressão
 * facial e gramática próprias), nem as letras com movimento (H, J, K, X, Z, Ç).
 * Não traduz Libras.
 *
 *   normalizarMao   pulso na origem, escala pulso→base do dedo médio, eixo para cima,
 *                   mão esquerda espelhada → vetor de 40 números (20 pontos × x,y)
 *   estadoDedos     estendido/dobrado de cada dedo, polegar lateral/cruzado, distâncias
 *   letraPorRegras  13 letras estáticas por regras geométricas (A B C D E I L O S U V W Y)
 *   Knn             exemplos gravados pelo próprio usuário (poucos por letra), k = 3
 *   Soletrador      letra estável por N s → texto; repetir exige trocar/abaixar a mão;
 *                   sem mão por M s → espaço
 */

export const LETRAS_REGRAS = ['A', 'B', 'C', 'D', 'E', 'I', 'L', 'O', 'S', 'U', 'V', 'W', 'Y'];
export const LETRAS_MOVIMENTO = ['H', 'J', 'K', 'X', 'Z', 'Ç'];

/** Pontos (0–1 do quadro, x,y) → frame canônico da mão. `esquerda` espelha. `aspecto` = w/h do quadro. */
export function normalizarMao(pts, esquerda = false, aspecto = 1) {
  if (!pts || pts.length < 21) return null;
  const P = pts.map((p) => [p.x * aspecto, p.y]);
  const o = P[0], m = P[9];
  const vx = m[0] - o[0], vy = m[1] - o[1], L = Math.hypot(vx, vy);
  if (L < 1e-6) return null;
  // rotação que leva (vx, vy) para (0, −1) (para cima na tela)
  const ang = Math.atan2(vx, -vy);
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const out = new Float32Array(40);
  for (let i = 1; i < 21; i++) {
    let x = (P[i][0] - o[0]) / L, y = (P[i][1] - o[1]) / L;
    const xr = x * c - y * s, yr = x * s + y * c;
    out[(i - 1) * 2] = esquerda ? -xr : xr;
    out[(i - 1) * 2 + 1] = yr;
  }
  return out;
}

/** Ponto i (1..20) do vetor canônico. */
const pt = (v, i) => [v[(i - 1) * 2], v[(i - 1) * 2 + 1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DEDOS = { indicador: [5, 6, 7, 8], medio: [9, 10, 11, 12], anelar: [13, 14, 15, 16], minimo: [17, 18, 19, 20] };

/** Estado dos dedos no frame canônico (pulso = origem, base do médio = (0,−1)). */
export function estadoDedos(v) {
  const O = [0, 0];
  const est = {};
  for (const [nome, [m, p, , t]] of Object.entries(DEDOS)) {
    const M = pt(v, m), Pp = pt(v, p), T = pt(v, t);
    const a = [Pp[0] - M[0], Pp[1] - M[1]], b = [T[0] - Pp[0], T[1] - Pp[1]];
    const cos = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
    const ext = dist(T, O) > 1.25 * dist(Pp, O) && cos > 0.55;
    const dobrado = dist(T, O) < 1.05 * dist(M, O) + 0.15;
    est[nome] = ext ? 'estendido' : dobrado ? 'dobrado' : 'curvo';
  }
  const T4 = pt(v, 4), T3 = pt(v, 3), I5 = pt(v, 5), P17 = pt(v, 17), I8 = pt(v, 8), M12 = pt(v, 12);
  // lateral do polegar: quanto a ponta sai para fora do lado do indicador (eixo x da palma: 5 → 17)
  const ux = P17[0] - I5[0], uy = P17[1] - I5[1], Lp = Math.hypot(ux, uy) || 1;
  const fora = -((T4[0] - I5[0]) * ux + (T4[1] - I5[1]) * uy) / Lp;   // > 0: para fora do indicador
  const polegarExt = fora > 0.35;
  const dir = (m, t) => { const a = pt(v, m), b = pt(v, t); return [b[0] - a[0], b[1] - a[1]]; };
  const pontas = [8, 12, 16, 20].map((i) => pt(v, i));
  return {
    dedos: est, polegarExt, polegarFora: fora, tipPolegar: T4,
    dPolInd: dist(T4, I8), dPolMed: dist(T4, M12),
    angIM: anguloEntre(dir(5, 8), dir(9, 12)),      // abertura entre indicador e médio (graus)
    angPolInd: anguloEntre([T4[0] - pt(v, 2)[0], T4[1] - pt(v, 2)[1]], [I8[0] - I5[0], I8[1] - I5[1]]),
    pontasPol: pontas.reduce((s, p) => s + dist(p, T4), 0) / 4,   // distância média ponta → ponta do polegar
    pontasPulso: pontas.reduce((s, p) => s + dist(p, O), 0) / 4,
    pontasY: pontas.reduce((s, p) => s + p[1], 0) / 4,
  };
}

function anguloEntre(a, b) {
  const c = (a[0] * b[0] + a[1] * b[1]) / ((Math.hypot(...a) * Math.hypot(...b)) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

/**
 * Letra pelas regras ou null. Devolve { letra, conf }. As regras são uma
 * PRÉVIA (mão de frente para a câmera, parada); para uso real grave exemplos.
 */
export function letraPorRegras(v) {
  const e = estadoDedos(v), d = e.dedos;
  const ext = (n) => d[n] === 'estendido';
  const nExt = ['indicador', 'medio', 'anelar', 'minimo'].filter(ext).length;
  if (nExt === 4) return e.polegarFora < 0.2 && e.angIM < 9 ? { letra: 'B', conf: 0.8 } : null;
  if (nExt === 3) return ext('indicador') && ext('medio') && ext('anelar') ? { letra: 'W', conf: 0.8 } : null;
  if (nExt === 2) return ext('indicador') && ext('medio') ? { letra: e.angIM > 9 ? 'V' : 'U', conf: 0.75 } : null;
  if (nExt === 1 && ext('minimo')) return { letra: e.polegarExt ? 'Y' : 'I', conf: 0.75 };
  if (nExt === 1 && ext('indicador')) {
    if (e.polegarExt && e.angPolInd > 50) return { letra: 'L', conf: 0.8 };
    if (e.dPolMed < 0.45) return { letra: 'D', conf: 0.7 };
    return null;
  }
  if (nExt > 0) return null;
  // nenhum dedo estendido: O (pontas tocam o polegar, no alto), C (arco aberto), A, E, S
  if (e.pontasPol < 0.4 && e.pontasY < -0.85) return { letra: 'O', conf: 0.7 };
  if (e.pontasPulso > 1.1 && e.dPolInd > 0.45 && e.dPolInd < 1.3) return { letra: 'C', conf: 0.55 };
  if (e.polegarFora > 0.12 && e.tipPolegar[1] < -0.8) return { letra: 'A', conf: 0.65 };
  // E: pontas dobradas apoiadas no polegar, que fica ABAIXO delas (y maior);
  // S: punho fechado com o polegar cruzando POR CIMA dos dedos
  if (e.tipPolegar[1] > e.pontasY - 0.02) return { letra: 'E', conf: 0.5 };
  return { letra: 'S', conf: 0.55 };
}

// ------------------------------------------------------------------ exemplos do usuário

export class Knn {
  constructor(exemplos = {}) { this.ex = exemplos; }
  adicionar(letra, v) { (this.ex[letra] ||= []).push(Array.from(v)); }
  remover(letra) { delete this.ex[letra]; }
  letras() { return Object.keys(this.ex).filter((k) => this.ex[k].length).sort(); }
  total() { return Object.values(this.ex).reduce((s, l) => s + l.length, 0); }
  /** { letra, conf, d } ou null. `limiar` = distância máxima aceita (unidades do frame canônico, por ponto). */
  classificar(v, k = 3, limiar = 0.35) {
    const viz = [];
    for (const [letra, lista] of Object.entries(this.ex)) {
      for (const e of lista) {
        let s = 0;
        for (let i = 0; i < 40; i++) { const d = v[i] - e[i]; s += d * d; }
        viz.push({ letra, d: Math.sqrt(s / 20) });
      }
    }
    if (!viz.length) return null;
    viz.sort((a, b) => a.d - b.d);
    if (viz[0].d > limiar) return null;
    const votos = {};
    for (const x of viz.slice(0, k)) votos[x.letra] = (votos[x.letra] || 0) + 1 / (x.d + 0.02);
    const [letra, peso] = Object.entries(votos).sort((a, b) => b[1] - a[1])[0];
    const totalPeso = Object.values(votos).reduce((s, x) => s + x, 0);
    return { letra, conf: peso / totalPeso, d: viz[0].d };
  }
  json() { return this.ex; }
}

// ------------------------------------------------------------------ texto

/**
 * Soletrador: recebe (t, letra|null, temMao) por quadro.
 * Uma letra entra no texto quando fica estável por `estavelS`. A mesma letra
 * só entra de novo depois de a mão sumir/mudar por `trocaS`. Sem mão por
 * `espacoS` → espaço (uma vez).
 */
export class Soletrador {
  constructor(o = {}) { this.o = { estavelS: 0.6, trocaS: 0.3, espacoS: 1.5, ...o }; this.texto = ''; this.cand = null; this.desde = 0; this.ultima = null; this.semDesde = null; this.liberada = true; this.emitiu = false; }
  configurar(o) { Object.assign(this.o, o); }
  limpar() { this.texto = ''; this.ultima = null; this.cand = null; this.liberada = true; }
  apagar() { this.texto = this.texto.slice(0, -1); }
  passo(t, letra, temMao) {
    let nova = null;
    if (!temMao || !letra) {
      if (this.semDesde == null) this.semDesde = t;
      if (t - this.semDesde >= this.o.trocaS) this.liberada = true;
      if (!temMao && t - this.semDesde >= this.o.espacoS && this.texto && !this.texto.endsWith(' ')) { this.texto += ' '; nova = ' '; }
      this.cand = null;
      return { texto: this.texto, nova, candidata: null, progresso: 0 };
    }
    this.semDesde = null;
    if (letra !== this.cand) { this.cand = letra; this.desde = t; if (letra !== this.ultima) this.liberada = true; }
    const prog = Math.min(1, (t - this.desde) / this.o.estavelS);
    if (prog >= 1 && this.liberada) { this.texto += letra; this.ultima = letra; this.liberada = false; nova = letra; }
    return { texto: this.texto, nova, candidata: letra, progresso: this.liberada ? prog : 1 };
  }
}
