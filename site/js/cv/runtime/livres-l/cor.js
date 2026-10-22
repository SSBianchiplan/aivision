/**
 * cv/runtime/livres-l/cor.js — MOTOR COR do CounterVision (CV-38), sem modelo.
 *
 * Porte do detector "Cor e forma" do GPlanSiS|CounterVision (frontend
 * src/vision/colorCore.ts, colorDetector.ts e tracker.ts) para o pipeline do
 * iaVision, em JS puro sobre o ImageData do quadro:
 *
 *   1. AMOSTRA DE COR: clicar numa peça cresce uma região a partir do ponto
 *      (o papel do SAM na rotulagem do original) e devolve a faixa HSV
 *      (matiz médio circular ± desvio, saturação e brilho mínimos) e a ÁREA
 *      TÍPICA da peça. Também dá para entrar uma cor pelo seletor (#rrggbb).
 *   2. MÁSCARA: cada pixel da imagem de análise (largura `work`, reduzida do
 *      quadro por vizinho mais próximo) recebe o índice da CLASSE de cor que
 *      casa (matiz dentro de ± (hs + tolerância), saturação e brilho na faixa).
 *      Amostras com o mesmo nome são a mesma classe (luz diferente, mesma peça).
 *   3. MORFOLOGIA: abertura (erosão + dilatação 4-vizinhos) remove ruído.
 *   4. COMPONENTES CONECTADOS (4-vizinhos, mesma classe), com pilha própria.
 *   5. PEÇAS ENCOSTADAS: componente com área ≈ k × área típica vira k peças
 *      pelo k-means nos pixels (k-means++ determinístico), como no original.
 *   6. RASTREIO por centroide (associação gulosa com previsão de velocidade
 *      constante, confirmação por N quadros, tolerância a falhas, suavização
 *      exponencial) — o mesmo do CounterVision. Dá o ID estável que a contagem
 *      por linha (CV-37 cena.zonas) precisa, sem pôr ByteTrack na cadeia.
 *
 * SEM ALOCAÇÃO POR QUADRO nos buffers grandes: máscara, rótulos, pilha,
 * lista de pixels e a imagem de análise são realocados só quando o tamanho
 * muda. Por quadro nascem só os poucos objetos de detecção (dezenas).
 *
 * As amostras ficam neste navegador (localStorage 'aiv.contador.cores'), não
 * nos parâmetros do nó: são listas que a tela edita com cliques.
 */

const CHAVE = 'aiv.contador.cores';
const fin = Number.isFinite;

// ------------------------------------------------------------------ cor

/** HSV de um pixel RGB 0–255: [h 0–360, s 0–1, v 0–1] em `out`. */
export function hsv(r8, g8, b8, out) {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
  const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  out[0] = h; out[1] = mx ? d / mx : 0; out[2] = mx;
  return out;
}

/** Nome em português do matiz (classe "cor:<nome>"). */
export function nomeDoMatiz(h, s = 1, v = 1) {
  if (v < 0.2) return 'preto';
  if (s < 0.15) return v > 0.8 ? 'branco' : 'cinza';
  if (h < 15 || h >= 345) return 'vermelho';
  if (h < 40) return 'laranja';
  if (h < 70) return 'amarelo';
  if (h < 160) return 'verde';
  if (h < 200) return 'ciano';
  if (h < 255) return 'azul';
  if (h < 290) return 'roxo';
  return 'rosa';
}

/** Cor de exibição (#rrggbb) de uma amostra. */
export function hexDaAmostra(a) {
  const h = a.h / 60, s = Math.min(1, (a.smin || 0.4) + 0.35), v = 0.9;
  const c = v * s, x = c * (1 - Math.abs((h % 2) - 1)), m = v - c;
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const hx = (u) => Math.round((u + m) * 255).toString(16).padStart(2, '0');
  return '#' + hx(r) + hx(g) + hx(b);
}

/** Amostra a partir de uma cor dada (#rrggbb), sem área típica. */
export function amostraDeHex(hex, nome) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!m) return 'Cor inválida: use #rrggbb.';
  const o = hsv(parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16), [0, 0, 0]);
  if (o[1] < 0.18) return 'Cor com pouca saturação: o fundo vai confundir. Use o detector (modelo) para esta peça.';
  return {
    nome: nome || nomeDoMatiz(o[0], o[1], o[2]), h: +o[0].toFixed(1), hs: 12,
    smin: Math.max(0, o[1] - 0.3), smax: 1, vmin: Math.max(0, o[2] - 0.4), vmax: 1, area: 0,
  };
}

// ------------------------------------------------------------------ amostras (persistidas)

function lerAmostras() {
  try {
    const l = JSON.parse(localStorage.getItem(CHAVE) || '[]');
    return Array.isArray(l) ? l.filter((a) => a && fin(a.h) && fin(a.hs)) : [];
  } catch (_) { return []; }
}

// ------------------------------------------------------------------ motor

export class MotorCor {
  constructor() {
    this.amostras = lerAmostras();
    this.versao = 0;              // muda a cada edição das amostras (a tela redesenha)
    // buffers (realocados só quando o tamanho muda)
    this.ww = 0; this.wh = 0;
    this.rgb = null;              // imagem de análise RGB (para a amostragem por clique)
    this.cls = null;              // classe por pixel (0 = nada)
    this.tmp = null;              // erosão
    this.lab = null; this.pilha = null; this.pix = null;
    this.km = new Float32Array(1800); this.kmAs = new Int32Array(900); this.kmMd = new Float32Array(900);
    this.areas = new Float32Array(900); this.nAreas = 0; this.iArea = 0; this.nQuadro = 0;   // anel de áreas (área típica automática)
    this.hsv = [0, 0, 0];
    this.classes = [];            // nomes das classes, na ordem do índice (1..)
    this.prep = [];               // amostras pré-processadas
    this.mascaraPronta = false;
    this._prep();
  }

  _salvar() { try { localStorage.setItem(CHAVE, JSON.stringify(this.amostras)); } catch (_) { /* sem espaço */ } }

  _prep() {
    const nomes = [];
    this.prep = this.amostras.map((a) => {
      let ci = nomes.indexOf(a.nome);
      if (ci < 0) { nomes.push(a.nome); ci = nomes.length - 1; }
      return { h: a.h, hs: a.hs, smin: a.smin, smax: a.smax, vmin: a.vmin, vmax: a.vmax, c: ci + 1 };
    });
    this.classes = nomes;
    this.versao++;
  }

  adicionar(a) { this.amostras = [...this.amostras, a]; this._salvar(); this._prep(); }
  remover(i) { this.amostras = this.amostras.filter((_, j) => j !== i); this._salvar(); this._prep(); }
  renomear(i, nome) {
    const n = String(nome || '').trim().toLowerCase().slice(0, 30);
    if (!n) return;
    this.amostras = this.amostras.map((a, j) => (j === i ? { ...a, nome: n } : a)); this._salvar(); this._prep();
  }
  limpar() { this.amostras = []; this._salvar(); this._prep(); this.nAreas = 0; }
  definirAmostras(l) { this.amostras = (Array.isArray(l) ? l : []).filter((a) => a && fin(a.h)); this._salvar(); this._prep(); }

  /**
   * Área típica (px² na resolução de análise): das amostras (clique); senão o
   * 30º percentil das peças vistas (anel longo, um quadro em três). Não é a
   * mediana: com muitas peças encostadas na tela os pares passam da metade
   * das observações e a "peça típica" dobraria — medido no vídeo sintético,
   * dois pares perdidos por isso.
   */
  areaTipica(ww) {
    const fr = this.amostras.map((a) => a.area).filter((v) => v > 0).sort((a, b) => a - b);
    if (fr.length) return fr[Math.floor(fr.length / 2)] * ww * ww;
    if (this.nAreas < 12) return 0;
    if (this._typV === this.iArea + this.nAreas * 7919) return this._typ;
    const n = this.nAreas, c = Array.from(this.areas.subarray(0, n)).sort((a, b) => a - b);
    this._typV = this.iArea + this.nAreas * 7919;
    return (this._typ = c[Math.floor(n * 0.3)]);
  }

  _garantir(ww, wh) {
    if (ww === this.ww && wh === this.wh && this.cls) return;
    const n = ww * wh;
    this.ww = ww; this.wh = wh;
    this.rgb = new Uint8Array(n * 3);
    this.cls = new Uint8Array(n); this.tmp = new Uint8Array(n);
    this.lab = new Int32Array(n); this.pilha = new Int32Array(n); this.pix = new Int32Array(n);
    this.nAreas = 0;
  }

  /**
   * Detecta as peças no quadro. `p`: { work, tol, tamMul, minFrac, abertura, separar, minPx }.
   * Devolve [{ x, y, w, h (normalizados, centro), score, c (classe 1..), nome }].
   */
  detectar(img, p) {
    const W = img.width, H = img.height, d = img.data;
    const ww = Math.max(32, Math.min(W, p.work | 0)), wh = Math.max(8, Math.round((ww * H) / W));
    this._garantir(ww, wh);
    const S = this.prep, ns = S.length, tol = p.tol, rgb = this.rgb, cls = this.cls, o = this.hsv;
    const kx = W / ww, ky = H / wh;
    // 1-2. redução por vizinho mais próximo + classe de cor por pixel
    for (let y = 0, i = 0; y < wh; y++) {
      const base = Math.min(H - 1, (y * ky + ky / 2) | 0) * W;
      for (let x = 0; x < ww; x++, i++) {
        const q = (base + Math.min(W - 1, (x * kx + kx / 2) | 0)) * 4;
        const r = d[q], g = d[q + 1], b = d[q + 2];
        rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
        let c = 0;
        if (ns) {
          hsv(r, g, b, o);
          for (let k = 0; k < ns; k++) {
            const a = S[k];
            if (o[1] < a.smin || o[1] > a.smax || o[2] < a.vmin || o[2] > a.vmax) continue;
            let dh = o[0] - a.h; if (dh < 0) dh = -dh; if (dh > 180) dh = 360 - dh;
            if (dh <= a.hs + tol) { c = a.c; break; }
          }
        }
        cls[i] = c;
      }
    }
    this.mascaraPronta = true;
    if (!ns) return [];
    // 3. abertura: erosão em tmp, dilatação de volta restrita ao original (abertura ⊆ original)
    if (p.abertura) {
      const t = this.tmp;
      t.fill(0);
      for (let y = 1; y < wh - 1; y++) {
        let i = y * ww + 1;
        for (let x = 1; x < ww - 1; x++, i++) {
          const c = cls[i];
          t[i] = c && cls[i - 1] === c && cls[i + 1] === c && cls[i - ww] === c && cls[i + ww] === c ? c : 0;
        }
      }
      for (let y = 0, i = 0; y < wh; y++) {
        for (let x = 0; x < ww; x++, i++) {
          if (!cls[i]) continue;
          const c = cls[i];
          if (t[i] === c || (x > 0 && t[i - 1] === c) || (x < ww - 1 && t[i + 1] === c) || (y > 0 && t[i - ww] === c) || (y < wh - 1 && t[i + ww] === c)) continue;
          cls[i] = 0;
        }
      }
    }
    // 4. componentes conectados
    const lab = this.lab, pilha = this.pilha, pix = this.pix, n = ww * wh;
    lab.fill(0);
    const typ0 = this.areaTipica(ww);
    const typ = typ0 > 0 ? typ0 * p.tamMul : 0;
    const minA = typ > 0 ? Math.max(4, typ * p.minFrac) : Math.max(4, p.minPx | 0);
    const rpx = typ > 0 ? Math.sqrt(typ / Math.PI) : 0;
    const out = [];
    const anota = (this.nQuadro++ % 3) === 0;
    let cur = 0;
    for (let i0 = 0; i0 < n; i0++) {
      const c = cls[i0];
      if (!c || lab[i0]) continue;
      cur++;
      let sp = 0, np = 0, sx = 0, sy = 0, x0 = ww, y0 = wh, x1 = 0, y1 = 0;
      pilha[sp++] = i0; lab[i0] = cur;
      while (sp) {
        const j = pilha[--sp]; pix[np++] = j;
        const x = j % ww, y = (j / ww) | 0;
        sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0) { const k = j - 1; if (cls[k] === c && !lab[k]) { lab[k] = cur; pilha[sp++] = k; } }
        if (x < ww - 1) { const k = j + 1; if (cls[k] === c && !lab[k]) { lab[k] = cur; pilha[sp++] = k; } }
        if (y > 0) { const k = j - ww; if (cls[k] === c && !lab[k]) { lab[k] = cur; pilha[sp++] = k; } }
        if (y < wh - 1) { const k = j + ww; if (cls[k] === c && !lab[k]) { lab[k] = cur; pilha[sp++] = k; } }
      }
      if (np < minA) continue;
      // anel de áreas para a área típica automática (só componentes sem toque na borda)
      if (anota && x0 > 0 && y0 > 0 && x1 < ww - 1 && y1 < wh - 1) {
        this.areas[this.iArea] = np; this.iArea = (this.iArea + 1) % this.areas.length;
        if (this.nAreas < this.areas.length) this.nAreas++;
      }
      const nome = this.classes[c - 1];
      const kk = p.separar && typ > 0 ? Math.min(40, Math.max(1, Math.round(np / typ))) : 1;
      const ratio = typ > 0 ? np / (kk * typ) : 1;
      const score = Math.max(0.05, Math.min(1, 1 - Math.abs(1 - ratio)));
      if (kk === 1) {
        out.push({ x: (sx / np + 0.5) / ww, y: (sy / np + 0.5) / wh, w: (x1 - x0 + 1) / ww, h: (y1 - y0 + 1) / wh, score, c, nome });
      } else {
        const C = this._kmeans(pix, np, ww, kk);
        for (let k = 0; k < kk; k++) {
          out.push({ x: (C[2 * k] + 0.5) / ww, y: (C[2 * k + 1] + 0.5) / wh, w: (2 * rpx) / ww, h: (2 * rpx) / wh, score, c, nome });
        }
      }
    }
    return out;
  }

  /** k-means nos pixels do componente (até 900 amostras), k-means++ determinístico, 8 iterações. */
  _kmeans(pix, np, w, k) {
    const step = Math.max(1, Math.floor(np / 900));
    const P = this.km;
    let n = 0;
    for (let i = 0; i < np && n < 900; i += step, n++) { const j = pix[i]; P[2 * n] = j % w; P[2 * n + 1] = (j / w) | 0; }
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += P[2 * i]; cy += P[2 * i + 1]; }
    cx /= n; cy /= n;
    const C = new Float64Array(2 * k);
    let bi = 0, bd = -1;
    for (let i = 0; i < n; i++) { const dd = (P[2 * i] - cx) ** 2 + (P[2 * i + 1] - cy) ** 2; if (dd > bd) { bd = dd; bi = i; } }
    C[0] = P[2 * bi]; C[1] = P[2 * bi + 1];
    const md = this.kmMd; md.fill(1e18, 0, n);
    for (let c = 1; c < k; c++) {
      bi = 0; bd = -1;
      for (let i = 0; i < n; i++) {
        const dd = (P[2 * i] - C[2 * c - 2]) ** 2 + (P[2 * i + 1] - C[2 * c - 1]) ** 2;
        if (dd < md[i]) md[i] = dd;
        if (md[i] > bd) { bd = md[i]; bi = i; }
      }
      C[2 * c] = P[2 * bi]; C[2 * c + 1] = P[2 * bi + 1];
    }
    const as = this.kmAs, Sm = new Float64Array(k * 3);
    for (let it = 0; it < 8; it++) {
      for (let i = 0; i < n; i++) {
        let b = 0, bdd = 1e18;
        for (let c = 0; c < k; c++) { const dd = (P[2 * i] - C[2 * c]) ** 2 + (P[2 * i + 1] - C[2 * c + 1]) ** 2; if (dd < bdd) { bdd = dd; b = c; } }
        as[i] = b;
      }
      Sm.fill(0);
      for (let i = 0; i < n; i++) { const c = as[i]; Sm[3 * c] += P[2 * i]; Sm[3 * c + 1] += P[2 * i + 1]; Sm[3 * c + 2]++; }
      for (let c = 0; c < k; c++) if (Sm[3 * c + 2] > 0) { C[2 * c] = Sm[3 * c] / Sm[3 * c + 2]; C[2 * c + 1] = Sm[3 * c + 1] / Sm[3 * c + 2]; }
    }
    return C;
  }

  /**
   * Amostra pelo clique (nx, ny normalizados no quadro): crescimento de região
   * na imagem de análise do último quadro. Devolve a amostra ou uma mensagem.
   */
  amostrar(nx, ny, nome) {
    const ww = this.ww, wh = this.wh, d = this.rgb;
    if (!d || !this.mascaraPronta) return 'Ainda não há quadro analisado: ligue a fonte com o motor COR no Pipeline.';
    const x0 = Math.round(nx * (ww - 1)), y0 = Math.round(ny * (wh - 1));
    if (x0 < 0 || y0 < 0 || x0 >= ww || y0 >= wh) return 'Clique dentro da imagem.';
    const o = [0, 0, 0];
    const hv = (i) => hsv(d[3 * i], d[3 * i + 1], d[3 * i + 2], [0, 0, 0]);
    const sem = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(ww - 1, Math.max(0, x0 + dx)), yy = Math.min(wh - 1, Math.max(0, y0 + dy));
      sem.push(hv(yy * ww + xx));
    }
    sem.sort((a, b) => a[2] - b[2]);
    const sd = sem[4];
    if (sd[1] < 0.18) return 'Cor com pouca saturação: o fundo vai confundir. Use o detector (modelo) para esta peça.';
    const hd = (a, b) => { const x = Math.abs(a - b); return x > 180 ? 360 - x : x; };
    const visto = new Uint8Array(ww * wh), st = [y0 * ww + x0], reg = [];
    visto[st[0]] = 1;
    const cap = Math.floor(ww * wh * 0.06);
    while (st.length && reg.length < cap) {
      const j = st.pop();
      hsv(d[3 * j], d[3 * j + 1], d[3 * j + 2], o);
      if (hd(o[0], sd[0]) > 16 || Math.abs(o[1] - sd[1]) > 0.28 || Math.abs(o[2] - sd[2]) > 0.32) continue;
      reg.push([o[0], o[1], o[2]]);
      const x = j % ww, y = (j / ww) | 0;
      if (x > 0 && !visto[j - 1]) { visto[j - 1] = 1; st.push(j - 1); }
      if (x < ww - 1 && !visto[j + 1]) { visto[j + 1] = 1; st.push(j + 1); }
      if (y > 0 && !visto[j - ww]) { visto[j - ww] = 1; st.push(j - ww); }
      if (y < wh - 1 && !visto[j + ww]) { visto[j + ww] = 1; st.push(j + ww); }
    }
    if (reg.length < 6) return 'Região pequena demais. Aproxime a câmera ou aumente a resolução de análise.';
    let sx = 0, sy = 0;
    for (const v of reg) { sx += Math.cos((v[0] * Math.PI) / 180); sy += Math.sin((v[0] * Math.PI) / 180); }
    let mh = (Math.atan2(sy, sx) * 180) / Math.PI; if (mh < 0) mh += 360;
    const dev = Math.sqrt(reg.reduce((a, v) => a + hd(v[0], mh) ** 2, 0) / reg.length);
    const ss = reg.map((v) => v[1]).sort((a, b) => a - b), vv = reg.map((v) => v[2]).sort((a, b) => a - b);
    const q = (arr, pp) => arr[Math.floor((arr.length - 1) * pp)];
    return {
      nome: String(nome || '').trim().toLowerCase() || nomeDoMatiz(mh, q(ss, 0.5), q(vv, 0.5)),
      h: +mh.toFixed(1), hs: +Math.max(8, Math.min(30, dev * 2.2 + 4)).toFixed(1),
      // margem de brilho maior que a do original (0,12 → 0,25): sob luz desigual na esteira uma amostra só
      // perdia a mesma peça no lado escuro (medido: 3 de 123 no vídeo "rápida" com gradiente de luz)
      smin: Math.max(0, q(ss, 0.05) - 0.08), smax: 1, vmin: Math.max(0, q(vv, 0.05) - 0.25), vmax: 1,
      area: reg.length / (ww * ww),
    };
  }
}

// ------------------------------------------------------------------ rastreio por centroide

/**
 * Rastreador do CounterVision (tracker.ts): associação gulosa por distância
 * com previsão de velocidade constante; mesma classe; confirmação por
 * `minHits` quadros; `maxMiss` quadros sem ver; posição suavizada (EMA).
 * Trilha nova (≤ 2 acertos) tem raio de associação 2× maior: a peça pode
 * andar mais que o próprio tamanho entre dois quadros antes de a velocidade
 * ser conhecida.
 */
export class RastreioCentroide {
  constructor() { this.trilhas = []; this.prox = 1; }
  reiniciar() { this.trilhas = []; }

  atualizar(dets, ar, c) {
    const T = this.trilhas;
    const tam = (d) => Math.max(d.w * ar, d.h) || 0.02;
    const pares = [];
    for (let i = 0; i < T.length; i++) {
      const t = T[i], px = t.x + t.vx, py = t.y + t.vy;
      for (let j = 0; j < dets.length; j++) {
        const d = dets[j];
        if (d.c !== t.c) continue;
        const dist = Math.hypot((d.x - px) * ar, d.y - py);
        const gate = c.gate * Math.max(tam(d), t.s) * (t.hits <= 2 ? 2 : 1) + Math.hypot(t.vx * ar, t.vy) * 0.5;
        if (dist < gate) pares.push([dist, i, j]);
      }
    }
    pares.sort((a, b) => a[0] - b[0]);
    const ut = new Uint8Array(T.length), ud = new Uint8Array(dets.length);
    for (const [, i, j] of pares) {
      if (ut[i] || ud[j]) continue;
      ut[i] = 1; ud[j] = 1;
      const t = T[i], d = dets[j];
      t.vx = 0.6 * (d.x - t.x) + 0.4 * t.vx; t.vy = 0.6 * (d.y - t.y) + 0.4 * t.vy;
      t.x = d.x; t.y = d.y; t.w = d.w; t.h = d.h; t.s = tam(d);
      t.sx += c.ema * (d.x - t.sx); t.sy += c.ema * (d.y - t.sy);
      t.hits++; t.miss = 0; t.score = d.score;
      if (t.hits >= c.minHits) t.ok = true;
    }
    for (let i = 0; i < T.length; i++) {
      if (ut[i]) continue;
      const t = T[i];
      t.miss += t.ok ? 1 : 2;
      t.x += t.vx; t.y += t.vy; t.sx += t.vx; t.sy += t.vy;
    }
    for (let j = 0; j < dets.length; j++) {
      if (ud[j]) continue;
      const d = dets[j];
      let colada = false;
      for (let i = 0; i < T.length; i++) {
        if (!ut[i]) continue;
        const t = T[i];
        if (Math.hypot((d.x - t.x) * ar, d.y - t.y) < 0.45 * Math.max(tam(d), t.s)) { colada = true; break; }
      }
      if (colada) continue;
      T.push({ id: this.prox++, c: d.c, nome: d.nome, x: d.x, y: d.y, vx: 0, vy: 0, sx: d.x, sy: d.y, w: d.w, h: d.h,
               s: tam(d), hits: 1, miss: 0, ok: c.minHits <= 1, score: d.score });
    }
    this.trilhas = T.filter((t) => t.miss <= c.maxMiss && t.sx > -0.1 && t.sx < 1.1 && t.sy > -0.1 && t.sy < 1.1);
    return this.trilhas;
  }
}
