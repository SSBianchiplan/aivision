/**
 * cv/runtime/livres-h/multi-pose.js — pose de VÁRIOS corredores (CV-32).
 *
 * Dois caminhos, escolhidos no operador:
 *
 *  RTMO ("todas", padrão): um passe do RTMO-s (CV-18, Apache-2.0) devolve
 *  todas as pessoas com caixa e 17 pontos COCO. Pessoas coladas não se
 *  fundem (o modelo é de um estágio, cada pessoa tem a sua âncora). Custa
 *  ~10 passadas do BlazePose: no WASM ~1 s por quadro (1 Hz ao vivo), com
 *  WebGPU 60–150 ms. Sem calcanhar e ponta do pé.
 *
 *  BlazePose por recorte ("N maiores"): o YOLOX acha as pessoas a cada
 *  ~1,5 s e cada uma das N maiores (ou só a escolhida) ganha o seu
 *  rastreador de recorte (pose.js), seguido pelos pontos auxiliares entre
 *  as detecções. Cada pessoa custa uma passada do BlazePose (~1/10 do RTMO):
 *  até 3 corredores sai mais barato que o RTMO e mantém os 33 pontos
 *  (pisada, tornozelo). Em pelotão o recorte pode pegar o vizinho — a pose
 *  incoerente é descartada e força re-detecção (comum.js · coerenciaPose).
 *
 * IDs: os de um Re-ID/tracking da cadeia (ctx.detections com `id`) quando
 * cobrem todas as pessoas; senão o RastreadorPessoas daqui.
 *
 * Uso em dois tempos, como o resto do runtime: preparar(src, t) síncrono
 * (copia o que precisa do quadro), estimar(prep) assíncrono.
 */
import { MODELS, run, makeTensor, loadModel } from '../onnx.js';
import { letterbox, toTensorData, decodeYolox, unletterbox } from '../tensor.js';
import { RastreadorPose, caixaPose, iou } from './pose.js';
import { cocoParaBlaze, RastreadorPessoas, iouCaixa } from './multi.js';

const novoCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

export const FONTES_MULTI = { 'RTMO (todas)': 'rtmo', 'BlazePose por recorte': 'recorte' };

/**
 * Caixa que serve para medir corrida: alta o bastante (≥ `alturaMin` do
 * quadro — longe demais a perna tem 20 px e o tornozelo é ruído) e com
 * forma de pessoa (largura ≤ 1,1 × altura; caixas deitadas são público,
 * sombra ou duas pessoas). Num vídeo de prova isso tira o público e os
 * fiscais do fundo e a maior parte das caixas "fantasma" de score baixo.
 */
export const caixaUtil = (b, H, alturaMin = 0.1) => (b.y2 - b.y1) >= alturaMin * H && (b.x2 - b.x1) <= 1.1 * (b.y2 - b.y1);

export class MotorMulti {
  /** o = { fonte: 'rtmo'|'recorte', maxPessoas, conf, kpConf, detectarMs, fabrica? (() => rastreador por pessoa) } */
  constructor(o = {}) { this.o = { fonte: 'rtmo', maxPessoas: 6, conf: 0.35, kpConf: 0.3, detectarMs: 1500, alturaMin: 0.1, ...o }; this.zerar(); }
  zerar() {
    this.rast = new RastreadorPessoas({ vidaMs: 1500 });
    this.rps = new Map();          // id → RastreadorPose (modo recorte)
    this.tDet = 0; this.fc = null; this.ultimas = [];
  }
  configurar(o) {
    const muda = o.fonte && o.fonte !== this.o.fonte;
    this.o = { ...this.o, ...o };
    if (muda) this.zerar();
  }
  modelos() { return this.o.fonte === 'rtmo' ? ['rtmo-s'] : ['yolox', 'pose']; }
  async carregar() { for (const m of this.modelos()) await loadModel(m); }

  /**
   * Síncrono. opts = { esp, alvoId (só esta pessoa), externas ([{ caixa px, id }]
   * de um tracking da cadeia), forcarDet }.
   */
  preparar(src, t, opts = {}) {
    const w = src.width, h = src.height;
    const out = { t, w, h, esp: Boolean(opts.esp), alvoId: opts.alvoId ?? null, externas: opts.externas || null };
    if (this.o.fonte === 'rtmo') {
      const spec = MODELS['rtmo-s'], S = spec.input[2];
      const lb = letterbox(src, S, S, 114);
      out.rtmo = { data: toTensorData(lb.data, spec), lb };
      return out;
    }
    if (!this.fc || this.fc.width !== w || this.fc.height !== h) {
      this.fc = novoCanvas(w, h);
      for (const r of this.rps.values()) r.usarQuadro(this.fc);
    }
    this.fc.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
    const vivos = [...this.rps.values()].filter((r) => r.roi).length;
    const quer = out.alvoId != null ? 1 : this.o.maxPessoas;
    if (opts.forcarDet || !this.tDet || t - this.tDet > this.o.detectarMs || vivos < Math.min(quer, 1) ||
        [...this.rps.values()].some((r) => r.redetectar)) {
      const det = MODELS.yolox;
      const lb = letterbox(src, det.input[3], det.input[2]);
      out.det = { data: toTensorData(lb.data, det), lb };
    }
    return out;
  }

  /** IDs: os da cadeia quando cobrem todas as caixas, senão o rastreio daqui. */
  _ids(caixas, t, externas) {
    if (externas && externas.length && caixas.length) {
      const ext = caixas.map((c) => {
        let mel = null, s = 0.5;
        for (const d of externas) { const v = iouCaixa(c, d.caixa); if (v > s) { s = v; mel = d; } }
        return mel ? 'R' + mel.id : null;
      });
      if (ext.every(Boolean)) return ext;
    }
    return this.rast.atualizar(caixas, t);
  }

  /** Assíncrono: [{ id, P (33 pontos px, rótulos anatômicos), pontos, caixa (px), incoerente }]. */
  async estimar(prep) {
    return this.o.fonte === 'rtmo' ? this._rtmo(prep) : this._recorte(prep);
  }

  async _rtmo(prep) {
    const { t, w, h, esp } = prep;
    const spec = MODELS['rtmo-s'];
    const o = await run('rtmo-s', await makeTensor(prep.rtmo.data, spec.input));
    const dets = o.dets, kps = o.keypoints, N = dets.dims[1], K = kps.dims[2], lb = prep.rtmo.lb;
    const fx = (v) => (v - lb.dx) / lb.scale, fy = (v) => (v - lb.dy) / lb.scale;
    let pessoas = [];
    for (let i = 0; i < N; i++) {
      const q = i * 5, score = dets.data[q + 4];
      if (!(score >= this.o.conf)) continue;
      const pts = [];
      for (let k = 0; k < K; k++) { const j = (i * K + k) * 3; pts.push({ x: fx(kps.data[j]), y: fy(kps.data[j + 1]), score: kps.data[j + 2] }); }
      const caixa = { x1: fx(dets.data[q]), y1: fy(dets.data[q + 1]), x2: fx(dets.data[q + 2]), y2: fy(dets.data[q + 3]) };
      if (!caixaUtil(caixa, h, this.o.alturaMin)) continue;
      pessoas.push({ score, caixa, pts });
    }
    // a mesma pessoa duas vezes (caixas quase iguais): fica a de maior score
    pessoas.sort((a, b) => b.score - a.score);
    pessoas = pessoas.filter((p, i) => !pessoas.slice(0, i).some((q) => iouCaixa(p.caixa, q.caixa) > 0.6));
    // as maiores primeiro (as mais perto da câmera)
    const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
    pessoas.sort((a, b) => area(b.caixa) - area(a.caixa));
    const ids = this._ids(pessoas.map((p) => p.caixa), t, prep.externas);
    let res = pessoas.map((p, i) => ({
      id: ids[i], caixa: p.caixa, score: p.score, pontos: 17,
      P: cocoParaBlaze(p.pts, w, h, { px: true, espelhar: esp }),
    }));
    if (prep.alvoId != null) res = res.filter((r) => r.id === prep.alvoId);
    res = res.slice(0, this.o.maxPessoas);
    this.ultimas = res;
    return res;
  }

  async _recorte(prep) {
    const { t, esp } = prep;
    const novas = new Map();          // id → caixa da detecção (com flag de aglomerado)
    if (prep.det) {
      const det = MODELS.yolox;
      const o1 = await run('yolox', await makeTensor(prep.det.data, det.input));
      const k1 = Object.keys(o1)[0];
      const caixas = decodeYolox(o1[k1].data, o1[k1].dims, det, 0.35, 0.45, 30)
        .filter((b) => b.classId === 0).map((b) => unletterbox(b, prep.det.lb)).filter((b) => caixaUtil(b, prep.h, this.o.alturaMin));
      this.tDet = t;
      for (const r of this.rps.values()) r.redetectar = false;
      const ids = this._ids(caixas, t, prep.externas);
      const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);
      const ordem = caixas.map((c, i) => ({ c, id: ids[i] })).sort((a, b) => area(b.c) - area(a.c));
      let escolhidas = prep.alvoId != null ? ordem.filter((x) => x.id === prep.alvoId) : ordem.slice(0, this.o.maxPessoas);
      // quem já é seguido e continua detectado fica (não troca de corredor só porque outro ficou maior)
      if (prep.alvoId == null) {
        const seguidos = ordem.filter((x) => this.rps.has(x.id));
        escolhidas = [...seguidos, ...escolhidas.filter((x) => !this.rps.has(x.id))].slice(0, this.o.maxPessoas);
      }
      for (const { c, id } of escolhidas) {
        novas.set(id, { ...c, aglomerado: caixas.some((d) => d !== c && iou(d, c) > 0.1) });
      }
      // quem saiu da escolha (ou não foi mais detectado) para de ser seguido
      for (const id of [...this.rps.keys()]) if (!novas.has(id)) this.rps.delete(id);
    }
    const res = [];
    for (const id of novas.keys()) {
      // o.fabrica: outro rastreador por pessoa (o Motion 3D usa o RastreadorMotion, que dá também os 33 pontos 3D)
      if (!this.rps.has(id)) { const r = this.o.fabrica ? this.o.fabrica() : new RastreadorPose(); r.usarQuadro(this.fc); this.rps.set(id, r); }
    }
    for (const [id, rp] of this.rps) {
      if (prep.alvoId != null && id !== prep.alvoId) continue;
      const pr = { w: prep.w, h: prep.h, t, esp, coerencia: true };
      const r = await rp.estimarNaCaixa(pr, novas.get(id) || null);
      if (r.sem) { this.rps.delete(id); continue; }
      const caixa = caixaPose(r.P);
      if (!r.incoerente) this.rast.observar(id, caixa, t);
      res.push({ id, P: r.P, W: r.W || null, pontos: 33, caixa, incoerente: Boolean(r.incoerente), aquecendo: Boolean(r.aquecendo), motivo: r.motivo });
    }
    this.ultimas = res;
    return res;
  }
}
