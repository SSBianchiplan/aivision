/**
 * cv/runtime/tempo-real/sincronizar.js — o desenho de CADA operador no instante do quadro exibido.
 *
 * Os modelos inferem fora do laço de quadros: o resultado que um operador desenha agora é de um
 * quadro capturado L ms atrás (L = fila + inferência; RF-DETR small em WASM passa de 1 s), e fica
 * na tela até o próximo chegar (período P). Sobre o vídeo «agora», a caixa fica atrás do jogador
 * e, com a câmera de TV girando, todas as caixas deslizam para o mesmo lado — o que se via no padel.
 *
 * O trânsito (v95) resolvia isso só com rastreio na cadeia: o Viewport atrasava a IMAGEM pela
 * latência e o ByteTrack desenhava a trilha prevista para o instante do quadro exibido. Isto aqui
 * generaliza para todos os operadores, sem mexer em cada um:
 *
 *  1. CARIMBO. O executor marca cada desenho com o instante do quadro de onde ele saiu:
 *     - operador assíncrono: `state.resultsT` (opkit.schedule e afins carimbam o resultado com o
 *       relógio do quadro inferido) ou `ctx.tResultado` (quem guarda o resultado fora do state);
 *     - operador síncrono depois de um assíncrono na cadeia (rastreio por centroide, zonas, Quadra
 *       com o detector da cadeia): o carimbo dos dados que ele recebeu;
 *     - operador síncrono sozinho (Inspect, cor, movimento): o próprio quadro;
 *     - quem já desenha para o instante exibido (`def.sincroniza`: ByteTrack, Motion 3D): passa direto.
 *  2. HISTÓRICO. Cada nó guarda os últimos desenhos com o carimbo (poucos objetos por quadro).
 *  3. MONTAGEM. Para o instante `tE` do quadro exibido, cada nó entra com o desenho do carimbo
 *     certo — o síncrono, o do próprio quadro; o assíncrono, INTERPOLADO entre o resultado anterior
 *     e o seguinte a tE (com a imagem atrasada L + P, os dois já chegaram). Primitivas que não casam
 *     (objeto que apareceu/sumiu) vêm do resultado mais perto no tempo.
 *  4. ATRASO PEDIDO. max(L + P) dos nós assíncronos, com teto; o Viewport atrasa a imagem por ele
 *     (components/video/sincronia.js) — só em arquivo e YouTube. Na câmera ao vivo nada é atrasado:
 *     o desenho é o mais recente, e a idade dele (`idadeMs`) vai para o carimbo na tela.
 *
 * Custo: marcar o nó de cada primitiva (um campo) e, ligada, uma busca no histórico por nó; o
 * casamento de primitivas entre dois resultados é feito UMA vez por par (cache), não por quadro.
 */

/** Teto do atraso da imagem (ms). Acima disso a memória do anel de quadros pesa demais. */
export const ATRASO_MAX_MS = 2500;
const MARGEM_MS = 40;            // um quadro de folga sobre L + P
const EMA = 0.2;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Centro e escala de uma primitiva (casamento entre resultados). */
function chave(s) {
  if (s.type === 'rect') return [s.x + s.w / 2, s.y + s.h / 2, Math.max(4, Math.hypot(s.w, s.h) / 2)];
  if (s.type === 'line') return [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, Math.max(6, Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 2)];
  if (s.type === 'point') return [s.x, s.y, 0];
  return null;
}
const idDe = (s) => (s.type === 'rect' && typeof s.label === 'string' && /^#\d+/.test(s.label) ? s.label.match(/^#\d+/)[0] : null);

/**
 * Casa as primitivas de A com as de B (mesmo tipo e cor; caixa com o mesmo «#id» casa direto),
 * pela distância dos centros dentro de um raio proporcional ao tamanho e ao quadro.
 * Devolve um vetor: para cada i de A, o índice em B ou -1.
 */
function casar(A, B, escala) {
  const par = new Int32Array(A.length).fill(-1);
  const usado = new Uint8Array(B.length);
  const porGrupo = new Map();
  B.forEach((s, j) => {
    if (s.type === 'banner') return;
    const g = s.type + '|' + (s.color || '');
    let l = porGrupo.get(g); if (!l) porGrupo.set(g, (l = []));
    l.push(j);
  });
  const cand = [];
  A.forEach((s, i) => {
    if (s.type === 'banner') return;
    const l = porGrupo.get(s.type + '|' + (s.color || ''));
    if (!l) return;
    const ka = chave(s); if (!ka) return;
    const id = idDe(s);
    for (const j of l) {
      const b = B[j];
      if (id && idDe(b) === id) { cand.push([-1, i, j]); continue; }
      const kb = chave(b); if (!kb) continue;
      const d = Math.hypot(ka[0] - kb[0], ka[1] - kb[1]);
      const raio = Math.max(escala * 0.06, 1.5 * Math.max(ka[2], kb[2]));
      if (d <= raio) cand.push([d, i, j]);
    }
  });
  cand.sort((a, b) => a[0] - b[0]);
  const feito = new Uint8Array(A.length);
  for (const [, i, j] of cand) { if (feito[i] || usado[j]) continue; feito[i] = 1; usado[j] = 1; par[i] = j; }
  return { par, usado };
}

const lerp = (a, b, k) => a + (b - a) * k;
function misturar(a, b, k) {
  const o = k < 0.5 ? { ...a } : { ...b };
  if (a.type === 'rect') { o.x = lerp(a.x, b.x, k); o.y = lerp(a.y, b.y, k); o.w = lerp(a.w, b.w, k); o.h = lerp(a.h, b.h, k); }
  else if (a.type === 'line') { o.x1 = lerp(a.x1, b.x1, k); o.y1 = lerp(a.y1, b.y1, k); o.x2 = lerp(a.x2, b.x2, k); o.y2 = lerp(a.y2, b.y2, k); }
  else if (a.type === 'point') { o.x = lerp(a.x, b.x, k); o.y = lerp(a.y, b.y, k); }
  return o;
}

export class Sincronizador {
  constructor() {
    /** id do nó → { tipo, hist: [{ t, itens }], L, P, tUlt, atual, visto } */
    this.nos = new Map();
    this.quadro = 0;
  }

  limpar() { this.nos.clear(); }

  /**
   * Registra o desenho deste quadro. `entradas` na ordem da cadeia:
   * [{ id, tipo: 'async'|'sync'|'proprio', t, itens }].
   */
  registrar(tQ, entradas, maxMs = ATRASO_MAX_MS) {
    const q = ++this.quadro;
    const janela = maxMs + 1500;
    for (const e of entradas) {
      let n = this.nos.get(e.id);
      if (!n || n.tipo !== e.tipo) { n = { tipo: e.tipo, hist: [], L: NaN, P: NaN, tUlt: NaN, atual: null }; this.nos.set(e.id, n); }
      n.visto = q;
      if (e.tipo === 'proprio') { n.atual = e.itens; continue; }
      const h = n.hist;
      if (e.tipo === 'async') {
        if (e.t !== n.tUlt) {
          // resultado novo: latência (captura → primeiro desenho) e período entre resultados
          if (num(n.tUlt) && e.t < n.tUlt - 1500) h.length = 0;          // o relógio voltou (vídeo recomeçou)
          if (num(n.tUlt) && e.t > n.tUlt) { const p = Math.min(4000, e.t - n.tUlt); n.P = num(n.P) ? n.P + EMA * (p - n.P) : p; }
          const l = Math.max(0, tQ - e.t); n.L = num(n.L) ? n.L + EMA * (l - n.L) : l;
          n.tUlt = e.t;
          if (h.length && e.t < h[h.length - 1].t) h.length = 0;
          h.push({ t: e.t, itens: e.itens });
        } else if (h.length) h[h.length - 1].itens = e.itens;           // mesmo resultado: o desenho mais novo dele
        else h.push({ t: e.t, itens: e.itens });
      } else {
        if (h.length && tQ < h[h.length - 1].t) h.length = 0;
        h.push({ t: tQ, itens: e.itens });
      }
      // poda: o que já passou do maior atraso possível (fica sempre o último)
      let corte = 0;
      while (corte < h.length - 2 && h[corte + 1].t < tQ - janela) corte++;
      if (h.length - corte > 160) corte = h.length - 160;
      if (corte) h.splice(0, corte);
    }
    for (const [id, n] of this.nos) if (n.visto !== q) this.nos.delete(id);
  }

  /** Atraso que cobre latência + período de todos os nós assíncronos (ms), com teto. */
  atrasoPedido(maxMs = ATRASO_MAX_MS) {
    let a = 0;
    for (const n of this.nos.values()) {
      if (n.tipo !== 'async' || !num(n.L)) continue;
      a = Math.max(a, n.L + (num(n.P) ? n.P : 0) + MARGEM_MS);
    }
    return Math.min(maxMs, a);
  }

  /** Idade (ms) do resultado mais velho que está sendo desenhado (carimbo na tela ao vivo). */
  idadeMs(tQ) {
    let a = 0;
    for (const n of this.nos.values()) if (n.tipo === 'async' && num(n.tUlt)) a = Math.max(a, tQ - n.tUlt);
    return a;
  }

  /**
   * Overlay para o quadro exibido no instante tE. `ligada` = falso: o desenho mais novo de cada nó
   * (câmera ao vivo, histórico, fonte parada). `escala` = largura do quadro (raio de casamento).
   */
  montar(tE, ligada, ordem, escala) {
    const out = [];
    for (const id of ordem) {
      const n = this.nos.get(id);
      if (!n) continue;
      if (n.tipo === 'proprio') { if (n.atual) for (const s of n.atual) out.push(s); continue; }
      const h = n.hist;
      if (!h.length) continue;
      if (!ligada || !num(tE)) { for (const s of h[h.length - 1].itens) out.push(s); continue; }
      if (n.tipo === 'sync') {
        // um desenho por quadro: o do quadro exibido (o mais perto)
        let b = h[h.length - 1];
        for (let i = h.length - 1; i >= 0; i--) { if (Math.abs(h[i].t - tE) < Math.abs(b.t - tE)) b = h[i]; if (h[i].t < tE) break; }
        for (const s of b.itens) out.push(s);
        continue;
      }
      // assíncrono: o resultado de antes de tE e o de depois, interpolados
      let k = -1;
      for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= tE) { k = i; break; }
      if (k < 0) { for (const s of h[0].itens) out.push(s); continue; }
      const A = h[k], B = h[k + 1];
      if (!B || B.t <= A.t) { for (const s of A.itens) out.push(s); continue; }
      const f = Math.min(1, Math.max(0, (tE - A.t) / (B.t - A.t)));
      this._interpolar(A, B, f, escala, out);
    }
    return out;
  }

  _interpolar(A, B, f, escala, out) {
    if (!A.casado || A.casado.com !== B || A.casado.iA !== A.itens || A.casado.iB !== B.itens) {
      A.casado = { com: B, iA: A.itens, iB: B.itens, ...casar(A.itens, B.itens, escala || 640) };
    }
    const { par, usado } = A.casado;
    const perto = f < 0.5;
    A.itens.forEach((s, i) => {
      const j = par[i];
      if (j >= 0) out.push(misturar(s, B.itens[j], f));
      else if (perto) out.push(s);                       // sumiu em B: até a metade do caminho
    });
    if (!perto) B.itens.forEach((s, j) => { if (!usado[j]) out.push(s); });   // apareceu em B
  }
}
