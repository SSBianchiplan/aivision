/**
 * cv/runtime/livres-h/camera.js — a câmera está se mexendo? (Corrida, CV-32)
 *
 * Transmissão de prova: a câmera acompanha os atletas (panorâmica) e às
 * vezes inclina ou dá zoom. Cadência, contato, voo e ângulos continuam
 * valendo (são tempos e ângulos no próprio corpo); oscilação vertical do
 * quadril e distâncias não (o "chão" da imagem anda). Aqui só se DETECTA o
 * movimento, para avisar e esconder o que deixa de valer; estabilizar a
 * imagem está fora do escopo.
 *
 * Método: perfis de gradiente do FUNDO. Numa grade esparsa do quadro
 * (1 pixel a cada `passo`; ~400 colunas por padrão), soma-se |gradiente horizontal| por coluna e
 * |gradiente vertical| por linha, deixando de fora as caixas das pessoas
 * (que se movem por conta própria). O deslocamento entre dois quadros é o
 * que melhor alinha os perfis (menor diferença média, com interpolação
 * parabólica do mínimo). Arquibancada, placas e as linhas das raias são o
 * fundo — não é preciso achar as raias à parte. Custo: ~100 mil pixels por
 * quadro (854×480 com passo 2), ~1 ms — desprezível perto da pose.
 */

/** Perfis de gradiente do fundo. src = { data (RGBA), width, height }; caixas em px. */
export function perfisFundo(src, caixas = [], passo = null) {
  const { data, width: W, height: H } = src;
  if (!passo) passo = Math.max(2, Math.round(W / 400));   // ~400 colunas, qualquer resolução
  const nx = Math.floor(W / passo), ny = Math.floor(H / passo);
  const g = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = j * passo;
    for (let i = 0; i < nx; i++) {
      const o = (y * W + i * passo) * 4;
      g[j * nx + i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
  }
  const fora = new Uint8Array(nx * ny).fill(1);
  for (const b of caixas) {
    const m = 0.15 * Math.max(b.x2 - b.x1, b.y2 - b.y1);
    const i0 = Math.max(0, Math.floor((b.x1 - m) / passo)), i1 = Math.min(nx - 1, Math.ceil((b.x2 + m) / passo));
    const j0 = Math.max(0, Math.floor((b.y1 - m) / passo)), j1 = Math.min(ny - 1, Math.ceil((b.y2 + m) / passo));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fora[j * nx + i] = 0;
  }
  const col = new Float32Array(nx), lin = new Float32Array(ny), nCol = new Float32Array(nx), nLin = new Float32Array(ny);
  for (let j = 1; j < ny; j++) {
    for (let i = 1; i < nx; i++) {
      const k = j * nx + i;
      if (!fora[k] || !fora[k - 1] || !fora[k - nx]) continue;
      col[i] += Math.abs(g[k] - g[k - 1]); nCol[i]++;
      lin[j] += Math.abs(g[k] - g[k - nx]); nLin[j]++;
    }
  }
  for (let i = 0; i < nx; i++) col[i] = nCol[i] > 2 ? col[i] / nCol[i] : NaN;
  for (let j = 0; j < ny; j++) lin[j] = nLin[j] > 2 ? lin[j] / nLin[j] : NaN;
  return { col, lin, passo, W, H, fundo: fora.reduce((s, x) => s + x, 0) / fora.length };
}

/** Deslocamento (em amostras do perfil) que leva `a` a `b`: b[i] ≈ a[i − d]. */
export function deslocamento1D(a, b, max) {
  const custo = (d) => {
    let s = 0, n = 0;
    for (let i = 0; i < b.length; i++) {
      const k = i - d;
      if (k < 0 || k >= a.length) continue;
      const x = a[k], y = b[i];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      s += Math.abs(x - y); n++;
    }
    return n > b.length * 0.3 ? s / n : Infinity;
  };
  let melhor = 0, cMin = Infinity;
  const cs = {};
  for (let d = -max; d <= max; d++) { cs[d] = custo(d); if (cs[d] < cMin) { cMin = cs[d]; melhor = d; } }
  if (!Number.isFinite(cMin)) return null;
  // sub-amostra: parábola pelos vizinhos
  const c0 = cs[melhor - 1], c2 = cs[melhor + 1];
  let fino = melhor;
  if (Number.isFinite(c0) && Number.isFinite(c2)) { const den = c0 - 2 * cMin + c2; if (den > 1e-9) fino = melhor + (0.5 * (c0 - c2)) / den; }
  // contraste: o mínimo tem de se destacar (fundo liso não diz nada)
  const vals = Object.values(cs).filter(Number.isFinite).sort((x, y) => x - y);
  const med = vals[Math.floor(vals.length / 2)];
  return { d: fino, confianca: med > 0 ? 1 - cMin / med : 0 };
}

/** Deslocamento do fundo entre dois perfis, em px do quadro. */
export function deslocamentoFundo(pa, pb, maxPx = 64) {
  if (!pa || !pb || pa.col.length !== pb.col.length || pa.lin.length !== pb.lin.length) return null;
  const m = Math.max(2, Math.round(maxPx / pa.passo));
  const x = deslocamento1D(pa.col, pb.col, m), y = deslocamento1D(pa.lin, pb.lin, m);
  if (!x || !y) return null;
  return { dx: x.d * pa.passo, dy: y.d * pa.passo, confianca: Math.min(x.confianca, y.confianca) };
}

/**
 * Acompanha o movimento ao longo do tempo. adicionar(t, perfis) → estado
 * { movendo, vx, vy (px/s, mediana de ~1 s), fracao (do tempo com câmera
 * móvel desde o início) }. Movendo = fundo andando mais que 3% da largura
 * do quadro por segundo (uma panorâmica que segue corredores anda 10–40%).
 */
export class MonitorCamera {
  constructor({ limiarFracaoLargura = 0.03 } = {}) { this.lim = limiarFracaoLargura; this.zerar(); }
  zerar() { this.ant = null; this.hist = []; this.tMov = 0; this.tTotal = 0; this.ultimo = null; this.tAnt = null; }
  adicionar(t, perfis) {
    if (this.ant && this.tAnt != null && t > this.tAnt) {
      const dt = (t - this.tAnt) / 1000;
      const d = dt < 1.5 ? deslocamentoFundo(this.ant, perfis) : null;
      if (d && d.confianca > 0.15) this.hist.push({ t, vx: d.dx / dt, vy: d.dy / dt });
      while (this.hist.length && t - this.hist[0].t > 1000) this.hist.shift();
      const med = (k) => { const v = this.hist.map((h) => h[k]).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
      const vx = med('vx'), vy = med('vy');
      const movendo = this.hist.length >= 2 && Math.hypot(vx, vy) > this.lim * perfis.W;
      this.tTotal += dt; if (movendo) this.tMov += dt;
      this.ultimo = { movendo, vx, vy, fracao: this.tTotal > 0 ? this.tMov / this.tTotal : 0 };
    }
    this.ant = perfis; this.tAnt = t;
    return this.ultimo || { movendo: false, vx: 0, vy: 0, fracao: 0 };
  }
}
