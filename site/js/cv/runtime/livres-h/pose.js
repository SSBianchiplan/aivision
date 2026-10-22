/**
 * cv/runtime/livres-h/pose.js — caminho de pose do Salto e da Corrida.
 *
 * O mesmo par do CV-06 (YOLOX acha a pessoa, BlazePose estima os 33 pontos
 * no recorte), com o recorte que o MediaPipe usa: QUADRADO, centrado no meio
 * do quadril, girado para o tronco ficar em pé, e SEGUIDO pelos dois pontos
 * auxiliares que o próprio modelo devolve (33 = centro, 34 = escala e
 * rotação). O YOLOX (0,3–2 s no WASM) só roda para achar a pessoa, quando a
 * pose se perde ou degrada e, como rede de segurança, a cada `detectarMs`;
 * no resto do tempo cada quadro custa uma passada do BlazePose — é o que
 * deixa a amostragem perto da taxa do vídeo, e a amostragem é a resolução
 * do tempo de voo e do tempo de contato.
 *
 * Espelho: com o quadro espelhado, o recorte é DESESPELHADO antes do modelo
 * (o BlazePose não é simétrico) e os pontos voltam para a posição espelhada
 * com os rótulos ANATÔMICOS (o esquerdo da pessoa continua 'esquerdo').
 *
 * Uso em dois tempos, como pede a regra 5 do runtime (nada do `src` depois
 * de um await): `preparar(src)` é síncrono e copia o que precisa; `estimar()`
 * é assíncrono e passa pela fila única do ONNX (run()).
 */
import { MODELS, run, makeTensor } from '../onnx.js';
import { letterbox, toTensorData, decodeYolox, unletterbox } from '../tensor.js';
import { sigmoid } from '../opkit.js';
import { coerenciaPose } from './comum.js';

const novoCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

/** Eixos da ROI girada: a = direita, b = baixo (unitários, px do quadro). */
const eixos = (roi) => ({ a: { x: -roi.uy, y: roi.ux }, b: { x: -roi.ux, y: -roi.uy } });

function recorteGirado(fonte, roi, S, cc, espelhar) {
  const g = cc.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const k = roi.s / S, { a, b } = eixos(roi);
  // u = S/2 + a·(f − C)/k ; v = S/2 + b·(f − C)/k   (e, espelhando, u → S − u)
  let m = [a.x / k, b.x / k, a.y / k, b.y / k, S / 2 - (a.x * roi.cx + a.y * roi.cy) / k, S / 2 - (b.x * roi.cx + b.y * roi.cy) / k];
  if (espelhar) m = [-m[0], m[1], -m[2], m[3], S - m[4], m[5]];
  g.setTransform(...m);
  g.imageSmoothingQuality = 'medium';
  g.drawImage(fonte, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return g.getImageData(0, 0, S, S);
}
function paraQuadro(roi, S, u, v) {
  const k = roi.s / S, { a, b } = eixos(roi);
  const up = u - S / 2, vp = v - S / 2;
  return { x: roi.cx + k * (up * a.x + vp * b.x), y: roi.cy + k * (up * a.y + vp * b.y) };
}
function roiDosAuxiliares(c, e) {
  const dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy);
  if (!(d > 2)) return null;
  return { cx: c.x, cy: c.y, s: 2 * d * 1.25, ux: dx / d, uy: dy / d };
}
export function caixaPose(P, minVis = 0.3) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < 33; i++) {
    const p = P[i];
    if (!p || !(p.v >= minVis) || !Number.isFinite(p.x)) continue;
    if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 0, y2: 0 };
}
export function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy, u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0 ? inter / u : 0;
}
const NUCLEO = [11, 12, 23, 24, 25, 26, 27, 28];

export class RastreadorPose {
  constructor() { this.zerar(); }
  zerar() {
    this.roi = null; this.tDet = 0; this.caixa = null; this.semente = false; this.sAncora = null;
    this.vBaixa = 0; this.redetectar = false; this.Pult = null; this.aquecer = 0; this.nDet = 0;
    this.pernaRef = null; this.incoerentes = 0; this.nIncoerentes = 0; this.aglomerado = false; this.fcExterno = false;
  }

  /** Usa um canvas de quadro já preenchido por outro (vários rastreadores no mesmo quadro). */
  usarQuadro(fc) { this.fc = fc; this.fcExterno = true; }

  /**
   * Escolhe a pessoa entre as caixas do detector: a que continua o alvo atual
   * (caixa da última pose boa, ou `alvo` vindo de fora — o corredor que o
   * usuário escolheu), senão a maior. Com caixas sobrepostas (pelotão) o
   * recorte fica mais justo, para não pegar o vizinho.
   */
  _escolher(caixas, alvo, H) {
    const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
    // gente pequena demais (público, fiscais ao fundo) só conta se não houver mais ninguém
    const grandes = H ? caixas.filter((c) => c.y2 - c.y1 >= 0.1 * H) : caixas;
    const cands = grandes.length ? grandes : caixas;
    const maior = Math.max(...cands.map(area));
    // o alvo escolhido no painel vale sempre; a continuidade com a última pose, só se ela ainda for
    // uma das pessoas principais (senão, depois de um corte de câmera, ficaria presa num espectador)
    const ref = alvo || (this.Pult && this.incoerentes === 0 ? caixaPose(this.Pult) : null);
    let b = null;
    if (ref) {
      let melhor = 0;
      for (const c of cands) { const v = iou(c, ref); if (v > melhor && (alvo || area(c) >= 0.35 * maior)) { melhor = v; b = c; } }
      if (melhor < 0.15) b = null;
    }
    if (!b) b = cands.slice().sort((x, y) => area(y) - area(x))[0];
    this.aglomerado = caixas.some((c) => c !== b && iou(c, b) > 0.1);
    return b;
  }

  /** Semeia o recorte numa caixa (do detector daqui ou de fora). */
  semear(b) {
    this.caixa = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
    const k = this.aglomerado ? 1.1 : 1.25;
    const semente = { cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, s: Math.max(b.x2 - b.x1, b.y2 - b.y1) * k, ux: 0, uy: -1 };
    const cobre = this.Pult ? iou(caixaPose(this.Pult), this.caixa) : 0;
    if (!this.roi || this.incoerentes > 0 || cobre < 0.45 || Math.hypot(semente.cx - this.roi.cx, semente.cy - this.roi.cy) > 0.5 * semente.s) {
      this.roi = semente; this.semente = true; this.aquecer = 2; this.incoerentes = 0;
    }
  }

  /**
   * Síncrono: copia o quadro para o canvas do rastreador e, se for hora de
   * procurar a pessoa, já monta o tensor do YOLOX. `t` em ms.
   */
  preparar(src, t, opts = {}) {
    const w = src.width, h = src.height;
    if (!this.fcExterno) {
      if (!this.fc || this.fc.width !== w || this.fc.height !== h) this.fc = novoCanvas(w, h);
      this.fc.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
    }
    const det = MODELS.yolox;
    const precisa = !this.roi || !this.tDet || t - this.tDet > (opts.detectarMs || 6000) || this.redetectar || opts.forcar;
    const out = { w, h, t, esp: Boolean(opts.esp), alvo: opts.alvo || null, coerencia: Boolean(opts.coerencia) };
    if (precisa) {
      this.redetectar = false;
      const lb = letterbox(src, det.input[3], det.input[2]);
      out.det = { data: toTensorData(lb.data, det), lb };
    }
    return out;
  }

  async _inferir(crop) {
    const ps = MODELS.pose;
    const o2 = await run('pose', await makeTensor(toTensorData(crop, ps), ps.input));
    let lms = null, presenca = null;
    for (const key of Object.keys(o2)) {
      const d = o2[key];
      if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) lms = d.data;
      else if (d.dims.length === 2 && d.dims[1] === 1) presenca = d.data[0];
    }
    return lms ? { lms, presenca } : null;
  }

  async _poseNaRoi(roi, esp) {
    const ps = MODELS.pose, S = ps.input[2];
    if (!this.cc) this.cc = novoCanvas(S, S);
    const crop = recorteGirado(this.fc, roi, S, this.cc, esp);
    const r = await this._inferir(crop);
    if (!r) return null;
    const P = [];
    for (let i = 0; i < 35; i++) {
      const o = i * ps.stride;
      const u = esp ? S - r.lms[o] : r.lms[o];
      const f = paraQuadro(roi, S, u, r.lms[o + 1]);
      P.push({ x: f.x, y: f.y, v: i < 33 ? sigmoid(r.lms[o + 3]) : 1 });
    }
    const aux = P.splice(33, 2);
    return { P, presenca: r.presenca, proxima: roiDosAuxiliares(aux[0], aux[1]) };
  }

  /**
   * Assíncrono: devolve { P (33 pontos em px do quadro, rótulos anatômicos),
   * vis, aquecendo } ou { sem: true } quando não há pessoa.
   */
  async estimar(prep) {
    const { w, h, t, esp, det: dIn } = prep;
    const det = MODELS.yolox;
    if (dIn) {
      const o1 = await run('yolox', await makeTensor(dIn.data, det.input));
      const k1 = Object.keys(o1)[0];
      const caixas = decodeYolox(o1[k1].data, o1[k1].dims, det, 0.35, 0.45, 10)
        .filter((b) => b.classId === 0).map((b) => unletterbox(b, dIn.lb));
      this.tDet = t; this.nDet++;
      if (!caixas.length) { this.roi = null; return { sem: true }; }
      this.caixasDet = caixas;
      this.semear(this._escolher(caixas, prep.alvo, h));
    }
    return this._seguir(prep);
  }

  /**
   * Como estimar(), mas a caixa vem de fora (vários corredores: um
   * rastreador por pessoa, a detecção é do operador). `caixa` só quando há
   * detecção nova associada a esta pessoa.
   */
  async estimarNaCaixa(prep, caixa) {
    if (caixa) { this.aglomerado = Boolean(caixa.aglomerado); this.semear(caixa); }
    return this._seguir(prep);
  }

  async _seguir(prep) {
    const { w, h, esp } = prep;
    let roi = this.roi;
    if (!roi) return { sem: true };
    let est;
    if (this.semente && this.caixa) {
      // semente do detector: pessoa em pé quase sempre; testa 3 rotações e fica com a que cobre a caixa
      this.semente = false;
      let melhor = null;
      for (const graus of [0, 30, -30]) {
        const r = (graus * Math.PI) / 180;
        let cand = await this._poseNaRoi({ ...roi, ux: Math.sin(r), uy: -Math.cos(r) }, esp);
        if (cand && cand.proxima) {
          const ref = await this._poseNaRoi(cand.proxima, esp);
          if (ref) { ref.roiUsada = cand.proxima; cand = ref; }
        }
        if (!cand) continue;
        cand.nota = iou(caixaPose(cand.P), this.caixa);
        if (!melhor || cand.nota > melhor.nota) melhor = cand;
        if (cand.nota > 0.7) break;
      }
      est = melhor;
      if (est && est.roiUsada) roi = est.roiUsada;
      if (est && est.proxima) this.sAncora = est.proxima.s;
    } else {
      est = await this._poseNaRoi(roi, esp);
    }
    if (!est) { this.roi = null; return { sem: true }; }
    const { P } = est;
    // uma pessoa só? (no pelotão o recorte junta pedaços de dois atletas). Opcional: a Corrida liga; o Salto
    // não precisa (pessoa sozinha) e cada re-detecção custa uma passada do YOLOX.
    let coer = prep.coerencia ? coerenciaPose(P, this.pernaRef) : { ok: true, perna: null };
    // pose semeada que mal cobre a caixa da pessoa: escorregou para outra pessoa ou para o fundo
    if (prep.coerencia && coer.ok && est.nota != null && est.nota < 0.25) coer = { ok: false, motivo: 'fora da caixa da pessoa', perna: null };
    if (!coer.ok) {
      this.nIncoerentes++;
      if (++this.incoerentes >= 2) this.redetectar = true;
    } else {
      this.incoerentes = 0;
      if (coer.perna) this.pernaRef = this.pernaRef ? 0.9 * this.pernaRef + 0.1 * coer.perna : coer.perna;
      this.Pult = P;
    }
    if (!this.Pult) this.Pult = P;
    const vMed = NUCLEO.reduce((s, i) => s + P[i].v, 0) / NUCLEO.length;
    const prox = est.proxima;
    if (vMed < 0.3 || !prox || prox.s < 0.06 * Math.min(w, h) || prox.s > 3 * Math.max(w, h)) { this.roi = null; return { sem: true }; }
    this.vBaixa = vMed < 0.45 ? this.vBaixa + 1 : 0;
    const fugiu = this.sAncora && (prox.s < 0.5 * this.sAncora || prox.s > 2 * this.sAncora);
    if (this.vBaixa >= 5 || fugiu) { this.redetectar = true; this.vBaixa = 0; }
    // ROI do próximo quadro: auxiliares, pouco suavizados (salto e corrida são rápidos)
    const m = 0.8;
    const ux = roi.ux + m * (prox.ux - roi.ux), uy = roi.uy + m * (prox.uy - roi.uy), nu = Math.hypot(ux, uy) || 1;
    this.roi = { cx: roi.cx + m * (prox.cx - roi.cx), cy: roi.cy + m * (prox.cy - roi.cy), s: roi.s + m * (prox.s - roi.s), ux: ux / nu, uy: uy / nu };
    const extra = coer.ok ? {} : { incoerente: true, motivo: coer.motivo };
    if (this.aquecer > 0) { this.aquecer--; return { P, vis: vMed, aquecendo: true, roi, ...extra }; }
    return { P, vis: vMed, roi, ...extra };
  }
}

/** Espelho efetivo: 'automático' segue a Fonte (ctx.mirrored). */
export function resolverEspelho(v, ctx) {
  if (v === 'sim' || v === true) return true;
  if (v === 'não' || v === false) return false;
  return Boolean(ctx && ctx.mirrored);
}

/**
 * Assinatura barata do quadro (soma ponderada de ~4 mil bytes espalhados):
 * quadro congelado (pausa, rebobinar parado, foto) dá a mesma assinatura e
 * não deve entrar na série — senão vira um "apoio" de vários segundos.
 */
export function assinaturaQuadro(src) {
  const d = src.data, passo = Math.max(4, Math.floor(d.length / 4096) | 1);
  let h = 0;
  for (let i = 0; i < d.length; i += passo) h = (h * 31 + d[i]) | 0;
  return h;
}
