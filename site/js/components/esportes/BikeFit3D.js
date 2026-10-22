/**
 * components/esportes/BikeFit3D.js — "Bike Fit 3D (protótipo)": duas ou três
 * vistas ao mesmo tempo (lateral, frontal e, opcional, a lateral oposta),
 * calibradas pelos 5 pontos da Velogic clicados na imagem, fundidas num
 * esqueleto 3D no sistema da bicicleta. Inspirado no Velogic Studio 4 —
 * mas com câmeras comuns (webcam/celular), sem profundidade (ToF): é 3D
 * por FUSÃO de duas vistas 2D, não um sensor 3D. Ver docs/bike-fit-3d.md.
 *
 * DE ONDE VEM CADA COISA
 *
 *   Fontes   cada vista tem o próprio <video>: câmera (getUserMedia por
 *            deviceId) ou arquivo. Arquivo é analisado QUADRO A QUADRO
 *            (pausa, busca o tempo, estima, avança 1/N s): amostragem
 *            regular e reprodutível, sem depender da velocidade da máquina.
 *   Pose     YOLOX acha a pessoa, BlazePose (33 pontos) no recorte girado
 *            que segue os auxiliares do próprio modelo — o mesmo protocolo do
 *            operador bikefit.analise (operators/livres-e/bikefit.js), em
 *            versão compacta, sem o espelho nem a sessão do Bike Fit 2D.
 *            UMA vista por vez, em rodízio, e cada inferência espera a
 *            anterior: a fila única do onnx.js (regra 2 de docs/arquitetura.md)
 *            nunca recebe duas chamadas deste componente ao mesmo tempo.
 *   Matemática  cv/runtime/livres-e/fit3d.js (calibração, fusão, ângulos 3D,
 *            knee travel) — pura, testada no node.
 *   3D       renderizador próprio em canvas 2D com projeção perspectiva
 *            (fit3d.projetor): ~40 segmentos e 4 trajetórias não justificam
 *            600 kB de three.js; PNG é toBlob do mesmo canvas, e nada
 *            externo entra na página (COEP intacto).
 *
 * Gancho de teste: window.aivBikeFit3D (abrirVideo, calibrar, estado…).
 */
import { html, useRef, useState, useEffect, useCallback } from '../../vendor.js';
import { MODELS, loadModel, isReady, onModelState, modelStates, run, makeTensor } from '../../cv/runtime/onnx.js';
import { letterbox, toTensorData, decodeYolox, unletterbox } from '../../cv/runtime/tensor.js';
import { sigmoid } from '../../cv/runtime/opkit.js';
import {
  PONTOS_REF, PARTES, calibrarLateral, calibrarFrontal, amostraLateral, amostraFrontal, fundir,
  esqueletoAgora, trajetorias, csvCiclo, projetor, bikeParaLateral, bikeParaFrontal,
} from '../../cv/runtime/livres-e/fit3d.js';
import { BotaoVia } from '../../via/BotaoVia.js';   // [VIA] botão «✦ Via» da barra (js/via/)

const VISTAS = [
  { k: 'lateral', nome: 'Lateral', dica: 'câmera de lado, perpendicular à bike, lente a ~95 cm do chão, 180–220 cm da bike' },
  { k: 'frontal', nome: 'Frontal', dica: 'câmera à frente (ou atrás), alinhada com a bike, na altura do selim' },
  { k: 'lateral2', nome: 'Lateral oposta (opcional)', dica: 'segunda lateral, do outro lado: simetria real E × D' },
];
const LARG_PROC = 960;            // largura máxima do quadro entregue à pose
const MAX_AMOSTRAS = 2400;        // por vista (~2–4 min de análise)
/**
 * Cores no tema do iaVision (mesmas do Studio Bike Fit): palco verde-petróleo,
 * lado direito no amarelo de destaque, esquerdo em ciano, linhas em branco
 * translúcido. O palco 3D e os vídeos ficam escuros também no tema claro
 * (como o .viewport do app), então estas cores valem nos dois temas e no PNG.
 */
const COR = {
  d: '#FFD84D', e: '#22d3ee', osso: 'rgba(255,255,255,.85)', bike: 'rgba(255,255,255,.5)', ref: '#ffffff',
  fundo: '#02302C', fundo2: '#04413C', grade: 'rgba(255,255,255,.09)', plano: 'rgba(255,255,255,.05)',
  texto: '#ffffff', mudo: '#CFEBE4', faixa: 'rgba(2,38,33,.78)',
  eixoX: 'rgba(255,138,128,.75)', eixoY: 'rgba(140,224,200,.75)', eixoZ: 'rgba(34,211,238,.75)',
  vazio: '#022621', aviso: 'rgba(2,38,33,.85)', contorno: '#04413C',
};
/*
 * Code Dark: o palco e os vídeos passam aos cinzas do VS Code (como o .bf3d em
 * css/theme.css); traços da pose, eixos e bike continuam iguais. O claro fica
 * com o palco escuro (ver acima). Conferido 1×/quadro (getAttribute, barato).
 */
const COR_ESCURO = { ...COR };
const COR_CODE = {
  fundo: '#1E1E1E', fundo2: '#252526', grade: 'rgba(255,255,255,.08)', mudo: '#CCCCCC', faixa: 'rgba(30,30,30,.82)',
  vazio: '#181818', aviso: 'rgba(30,30,30,.88)', contorno: '#1E1E1E',
};
let temaCor = '';
function corDoTema() {
  const t = document.documentElement.getAttribute('data-theme') === 'code' ? 'code' : 'escuro';
  if (t === temaCor) return;
  temaCor = t;
  Object.assign(COR, COR_ESCURO, t === 'code' ? COR_CODE : null);
}
const FONTE = 'Archivo, "Helvetica Neue", Arial, sans-serif';
const OSSOS = [['ombro', 'cotovelo'], ['cotovelo', 'punho'], ['ombro', 'quadril'], ['quadril', 'joelho'],
  ['joelho', 'tornozelo'], ['tornozelo', 'calcanhar'], ['calcanhar', 'pe'], ['tornozelo', 'pe']];
const LM = { ombro: [11, 12], cotovelo: [13, 14], punho: [15, 16], quadril: [23, 24], joelho: [25, 26], tornozelo: [27, 28], calcanhar: [29, 30], pe: [31, 32] };

const novoCanvas = (w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};
const num = (x, c = 1) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(c).replace('.', ','));
const sinal = (x, c = 1) => (x == null || !Number.isFinite(x) ? '—' : (x > 0 ? '+' : '') + num(x, c));

// ===================================================================== pose
/**
 * Rastreador de uma vista: YOLOX semeia a ROI; depois o BlazePose segue os
 * próprios pontos auxiliares (33 = centro, 34 = escala/rotação). Sem pessoa
 * no YOLOX (manequim, quadro fechado no ciclista), semeia com o quadro todo.
 */
class Rastreador {
  constructor() { this.roi = null; this.tDet = 0; this.cc = null; this.aquecer = 0; this.sAncora = null; }

  recorte(fonte, roi, S) {
    if (!this.cc) this.cc = novoCanvas(S, S);
    const g = this.cc.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const k = roi.s / S, a = { x: -roi.uy, y: roi.ux }, b = { x: -roi.ux, y: -roi.uy };
    g.setTransform(a.x / k, b.x / k, a.y / k, b.y / k,
      S / 2 - (a.x * roi.cx + a.y * roi.cy) / k, S / 2 - (b.x * roi.cx + b.y * roi.cy) / k);
    g.imageSmoothingQuality = 'medium';
    g.drawImage(fonte, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    return g.getImageData(0, 0, S, S);
  }

  async pose(fonte, roi) {
    const ps = MODELS.pose, S = ps.input[2];
    const crop = this.recorte(fonte, roi, S);
    const o = await run('pose', await makeTensor(toTensorData(crop, ps), ps.input));
    let lms = null;
    for (const key of Object.keys(o)) { const d = o[key]; if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) lms = d.data; }
    if (!lms) return null;
    const k = roi.s / S, a = { x: -roi.uy, y: roi.ux }, b = { x: -roi.ux, y: -roi.uy };
    const P = [];
    for (let i = 0; i < 35; i++) {
      const o5 = i * ps.stride, up = lms[o5] - S / 2, vp = lms[o5 + 1] - S / 2;
      P.push({ x: roi.cx + k * (up * a.x + vp * b.x), y: roi.cy + k * (up * a.y + vp * b.y), v: i < 33 ? sigmoid(lms[o5 + 3]) : 1 });
    }
    const aux = P.splice(33, 2);
    const dx = aux[1].x - aux[0].x, dy = aux[1].y - aux[0].y, d = Math.hypot(dx, dy);
    const prox = d > 2 ? { cx: aux[0].x, cy: aux[0].y, s: 2 * d * 1.25, ux: dx / d, uy: dy / d } : null;
    return { P, prox };
  }

  async detectar(img) {
    const det = MODELS.yolox;
    const lb = letterbox(img, det.input[3], det.input[2]);
    const o = await run('yolox', await makeTensor(toTensorData(lb.data, det), det.input));
    const k = Object.keys(o)[0];
    return decodeYolox(o[k].data, o[k].dims, det, 0.3, 0.45, 10).filter((b) => b.classId === 0).map((b) => unletterbox(b, lb));
  }

  /** Uma estimativa: 33 pontos {x, y, v} em px de `fonte`, ou null. */
  async estimar(fonte, img, t) {
    const w = fonte.width, h = fonte.height;
    if (!this.roi || t - this.tDet > 10000 || this.redetectar) {
      this.redetectar = false; this.tDet = t;
      const caixas = await this.detectar(img);
      caixas.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1));
      const b = caixas[0] || { x1: w * 0.05, y1: h * 0.02, x2: w * 0.95, y2: h * 0.98, semDetector: true };
      const sem = { cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, s: Math.max(b.x2 - b.x1, b.y2 - b.y1) * 1.25, ux: 0, uy: -1 };
      if (!this.roi || Math.hypot(sem.cx - this.roi.cx, sem.cy - this.roi.cy) > 0.5 * sem.s || this.vMed < 0.45) {
        // semente: tronco de inclinação desconhecida — testa rotações, fica com a pose de maior visibilidade
        let melhor = null;
        for (const g of [0, 40, -40, 70, -70]) {
          const r = (g * Math.PI) / 180;
          let est = await this.pose(fonte, { ...sem, ux: Math.sin(r), uy: -Math.cos(r) });
          if (est && est.prox) { const e2 = await this.pose(fonte, est.prox); if (e2) { e2.roi = est.prox; est = e2; } }
          if (!est) continue;
          est.nota = [11, 12, 23, 24, 25, 26, 27, 28].reduce((s, i) => s + est.P[i].v, 0) / 8;
          if (!melhor || est.nota > melhor.nota) melhor = est;
          if (est.nota > 0.85) break;
        }
        if (!melhor || !melhor.prox) { this.roi = null; return null; }
        this.roi = melhor.prox; this.sAncora = melhor.prox.s; this.aquecer = 3;
        this.semDetector = Boolean(b.semDetector);
        return null;
      }
    }
    const est = await this.pose(fonte, this.roi);
    if (!est || !est.prox) { this.roi = null; return null; }
    const vMed = [11, 12, 23, 24, 25, 26, 27, 28].reduce((s, i) => s + est.P[i].v, 0) / 8;
    this.vMed = vMed;
    const p = est.prox;
    if (vMed < 0.3 || p.s < 0.08 * Math.min(w, h) || p.s > 3 * Math.max(w, h)) { this.roi = null; return null; }
    if (this.sAncora && (p.s < 0.55 * this.sAncora || p.s > 1.8 * this.sAncora)) this.redetectar = true;
    const m = 0.7, r = this.roi;
    const ux = r.ux + m * (p.ux - r.ux), uy = r.uy + m * (p.uy - r.uy), nu = Math.hypot(ux, uy) || 1;
    this.roi = { cx: r.cx + m * (p.cx - r.cx), cy: r.cy + m * (p.cy - r.cy), s: r.s + m * (p.s - r.s), ux: ux / nu, uy: uy / nu };
    if (this.aquecer > 0) { this.aquecer--; return null; }
    return est.P;
  }
}

// ===================================================================== estado
function novaVista(k) {
  return {
    k, fonte: null, deviceId: '', video: null, stream: null, url: null, nomeArq: '',
    rast: new Rastreador(), P: null, Pt: 0, amostras: [], membros: null,
    cliques: {}, calibrando: false, cal: null, erroCal: '', espelhada: false,
    tBase: 0, tUlt: -1, passoS: 1 / 15, falhasBusca: 0, aoVivo: false, ctAnt: 0, proximoS: 0, nInfer: 0, erro: '', inferMs: 0,
  };
}

function baixar(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/** Quadro todo preto (amostra 64 pixels espalhados). */
function quadroPreto(img) {
  const d = img.data, n = img.width * img.height;
  for (let i = 0; i < 64; i++) {
    const j = (Math.floor((i * 0.618034 % 1) * n)) * 4;
    if (d[j] + d[j + 1] + d[j + 2] > 12) return false;
  }
  return true;
}
const carimbo = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

// ===================================================================== componente
export function BikeFit3D({ onClose }) {
  const R = useRef(null);
  if (!R.current) {
    R.current = {
      vistas: Object.fromEntries(VISTAS.map((v) => [v.k, novaVista(v.k)])),
      opc: { entreEixosCm: 100, distLatCm: 200, distFroCm: 0, posicao: 'frente', sync: 'fase', offsetMs: 0, fpsArquivo: 15, minVis: 0.5, res: '720' },
      res: null, vivo: null, rodando: true, vivoAnim: 'ciclo', cam: { az: 38, el: 14, dist: 330 }, animFase: 0,
      canvases: {}, c3d: null,
    };
  }
  const S = R.current;
  const [, setTick] = useState(0);
  const atualizar = useCallback(() => setTick((x) => (x + 1) % 1e9), []);
  const [dispositivos, setDispositivos] = useState([]);
  const [modelos, setModelos] = useState('');
  const [abaMob, setAbaMob] = useState('vistas');

  // ---------------------------------------------------------- modelos
  useEffect(() => {
    const ver = () => {
      const st = modelStates();
      const p = (id) => (st[id] ? (st[id].status === 'ready' ? 'pronto' : st[id].status === 'error' ? 'erro' : `${Math.round((st[id].progress || 0) * 100)}%`) : '…');
      setModelos(isReady('yolox') && isReady('pose') ? '' : `Carregando modelos: detector ${p('yolox')} · pose ${p('pose')}`);
    };
    const off = onModelState(ver);
    loadModel('yolox').catch(() => {}); loadModel('pose').catch(() => {});
    ver();
    return () => { if (typeof off === 'function') off(); };
  }, []);

  // ---------------------------------------------------------- dispositivos
  const listarCameras = useCallback(async (pedir = false) => {
    try {
      if (pedir) { const s = await navigator.mediaDevices.getUserMedia({ video: true }); s.getTracks().forEach((t) => t.stop()); }
      const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setDispositivos(ds.map((d, i) => ({ id: d.deviceId, nome: d.label || `Câmera ${i + 1}` })));
      return ds;
    } catch (e) { return []; }
  }, []);
  useEffect(() => { listarCameras(false); }, [listarCameras]);

  // ---------------------------------------------------------- fontes
  const pararFonte = useCallback((v) => {
    if (v.stream) v.stream.getTracks().forEach((t) => t.stop());
    if (v.url) URL.revokeObjectURL(v.url);
    if (v.video) { v.video.pause(); v.video.removeAttribute('src'); v.video.srcObject = null; v.video.load(); }
    v.stream = null; v.url = null; v.video = null; v.fonte = null; v.P = null; v.rast = new Rastreador();
  }, []);

  const abrirCamera = useCallback(async (k, deviceId) => {
    const v = S.vistas[k];
    pararFonte(v);
    try {
      const alt = S.opc.res === '1080' ? 1080 : 720;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, height: { ideal: alt }, width: { ideal: Math.round((alt * 16) / 9) }, frameRate: { ideal: 60 } },
        audio: false,
      });
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      Object.assign(v, { fonte: 'camera', stream, video, deviceId: deviceId || '', erro: '', amostras: [], tBase: 0 });
      const tr = stream.getVideoTracks()[0];
      v.info = tr && tr.getSettings ? tr.getSettings() : {};
      if (!dispositivos.length || !dispositivos[0].nome || /^Câmera/.test(dispositivos[0].nome)) listarCameras(false);
    } catch (e) { v.erro = 'Câmera: ' + (e && e.message ? e.message : e); }
    atualizar();
  }, [S, pararFonte, atualizar, listarCameras, dispositivos]);

  const abrirArquivo = useCallback(async (k, fileOrUrl, nome) => {
    const v = S.vistas[k];
    pararFonte(v);
    const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.src = url;
    await new Promise((ok, falha) => { video.onloadeddata = ok; video.onerror = () => falha(new Error('não abriu o vídeo')); });
    Object.assign(v, {
      fonte: 'arquivo', video, url: typeof fileOrUrl === 'string' ? null : url, nomeArq: nome || (fileOrUrl.name || 'vídeo'),
      erro: '', amostras: [], tBase: 0, proximoS: 0, tUlt: -1, passoS: 1 / S.opc.fpsArquivo, falhasBusca: 0,
    });
    v.info = { width: video.videoWidth, height: video.videoHeight, frameRate: null };
    // WebM sem índice (gravado por MediaRecorder, cortado sem remux) tem duração
    // infinita e não aceita busca: cai para tocar em laço, devagar (0,25×), e
    // amostrar o quadro que estiver na tela — a fase não depende de amostra regular.
    v.aoVivo = !Number.isFinite(video.duration) || !(video.duration > 0) || !(video.seekable && video.seekable.length);
    if (v.aoVivo) {
      video.loop = true; video.playbackRate = 0.25; v.ctAnt = 0;
      try { await video.play(); } catch (_) { /* sem autoplay: o laço tenta de novo */ }
    }
    atualizar();
  }, [S, pararFonte, atualizar]);

  // ---------------------------------------------------------- calibração
  const recalibrar = useCallback(() => {
    const L = S.vistas.lateral, F = S.vistas.frontal, L2 = S.vistas.lateral2, o = S.opc;
    const dims = (v) => ({ larg: v.video ? v.video.videoWidth : 1280, alt: v.video ? v.video.videoHeight : 720 });
    const completo = (v) => PONTOS_REF.every((p) => v.cliques[p.k]);
    for (const v of [L, F, L2]) { v.erroCal = ''; }
    L.cal = null; F.cal = null; L2.cal = null;
    try { if (completo(L)) L.cal = calibrarLateral(L.cliques, { entreEixosCm: o.entreEixosCm, distCm: o.distLatCm, espelhada: L.espelhada, ...dims(L) }); } catch (e) { L.erroCal = e.message; }
    try { if (completo(L2)) L2.cal = calibrarLateral(L2.cliques, { entreEixosCm: o.entreEixosCm, distCm: o.distLatCm, espelhada: L2.espelhada, ...dims(L2) }); } catch (e) { L2.erroCal = e.message; }
    try {
      if (completo(F)) {
        if (!L.cal) F.erroCal = 'calibre a lateral primeiro (as alturas dos pontos vêm dela)';
        else F.cal = calibrarFrontal(F.cliques, L.cal.ref, { distCm: o.distFroCm, posicao: o.posicao, espelhada: F.espelhada, ...dims(F) });
      }
    } catch (e) { F.erroCal = e.message; }
    // amostras da lateral dependem da calibração (fase, plano): refaz a partir dos pontos guardados
    for (const v of [L, L2]) {
      if (!v.cal) continue;
      let ant = null;
      v.amostras = v.amostras.map((a) => { const n = amostraLateral(v.cal, a.P, a.t, o.minVis, ant); ant = n.membros; n.P = a.P; return n; });
    }
    S.res = null;
    atualizar();
  }, [S, atualizar]);

  const clicar = useCallback((k, ev) => {
    const v = S.vistas[k];
    if (!v.calibrando || !v.video) return;
    const c = ev.currentTarget, r = c.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * c.width, y = ((ev.clientY - r.top) / r.height) * c.height;
    const sx = v.video.videoWidth / c.width, sy = v.video.videoHeight / c.height;
    const prox = PONTOS_REF.find((p) => !v.cliques[p.k]);
    if (!prox) return;
    v.cliques = { ...v.cliques, [prox.k]: { x: x * sx, y: y * sy } };
    if (PONTOS_REF.every((p) => v.cliques[p.k])) { v.calibrando = false; recalibrar(); }
    atualizar();
  }, [S, recalibrar, atualizar]);

  // ---------------------------------------------------------- laço de inferência (uma vista por vez)
  useEffect(() => {
    let vivo = true, idx = 0;
    const proc = { c: null };
    const quadro = (video) => {
      const W = video.videoWidth, H = video.videoHeight;
      if (!W || !H) return null;
      const k = Math.min(1, LARG_PROC / W), w = Math.round(W * k), h = Math.round(H * k);
      if (!proc.c || proc.c.width !== w || proc.c.height !== h) proc.c = novoCanvas(w, h);
      const g = proc.c.getContext('2d', { willReadFrequently: true });
      g.drawImage(video, 0, 0, w, h);
      return { canvas: proc.c, img: g.getImageData(0, 0, w, h), k };
    };
    const buscar = (video, s) => new Promise((ok) => {
      let feito = false;
      const fim = (e) => { if (!feito) { feito = true; video.removeEventListener('seeked', fim); ok(Boolean(e)); } };
      video.addEventListener('seeked', fim);
      video.currentTime = s;
      setTimeout(() => fim(null), 2500);
    });
    (async () => {
      while (vivo) {
        const ativas = VISTAS.map((x) => S.vistas[x.k]).filter((v) => v.video);
        if (!S.rodando || !ativas.length || !isReady('yolox') || !isReady('pose')) { await new Promise((r) => setTimeout(r, 150)); continue; }
        const v = ativas[idx++ % ativas.length];
        try {
          let t;
          if (v.fonte === 'arquivo' && v.aoVivo) {
            if (v.video.paused) v.video.play().catch(() => {});
            const ct = v.video.currentTime * 1000;
            // voltou ao início do laço: abre um buraco no tempo para a fase não ligar o fim ao começo
            if (ct < v.ctAnt - 50) { v.tBase += v.ctAnt + 1000; v.rast.roi = null; }
            v.ctAnt = ct;
            t = v.tBase + ct;
          } else if (v.fonte === 'arquivo') {
            const dur = v.video.duration || 0;
            if (v.proximoS >= dur - 0.02) { v.tBase += dur * 1000 + 1000; v.proximoS = 0; v.rast.roi = null; }
            // busca que "volta" para outro tempo (servidor sem Range, WebM sem índice) também é falha
            const ok = (await buscar(v.video, v.proximoS)) && Math.abs(v.video.currentTime - v.proximoS) < 0.25;
            if (!ok && ++v.falhasBusca >= 2) {
              // a busca não responde (WebM sem índice): passa a tocar em laço a 0,25×
              v.aoVivo = true; v.video.loop = true; v.video.playbackRate = 0.25; v.ctAnt = 0;
              v.video.play().catch(() => {});
              continue;
            }
            t = v.tBase + v.video.currentTime * 1000;
            v.proximoS += v.passoS;
          } else {
            t = performance.now();
          }
          const q = quadro(v.video);
          if (!q) { await new Promise((r) => setTimeout(r, 50)); continue; }
          if (v.fonte === 'arquivo' && !v.aoVivo) {
            // alguns WebM devolvem quadro preto depois de uma busca (o Chrome só
            // decodifica tocando): três pretos seguidos e o arquivo passa a tocar a 0,25×
            if (quadroPreto(q.img)) {
              if (++v.falhasBusca >= 3) { v.aoVivo = true; v.video.loop = true; v.video.playbackRate = 0.25; v.ctAnt = 0; v.video.play().catch(() => {}); }
              continue;
            }
            v.falhasBusca = 0;
          }
          const t0 = performance.now();
          const P = await v.rast.estimar(q.canvas, q.img, t);
          v.inferMs = performance.now() - t0; v.nInfer++;
          if (P) {
            const Pv = P.map((p) => ({ x: p.x / q.k, y: p.y / q.k, v: p.v }));
            v.P = Pv; v.Pt = performance.now();
            guardar(v, Pv, t);
          } else v.P = null;
        } catch (e) { v.erro = String(e && e.message ? e.message : e); await new Promise((r) => setTimeout(r, 300)); }
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    const guardar = (v, P, t) => {
      let a;
      if (v.k === 'frontal') a = amostraFrontal(P, t);
      else if (v.cal) { a = amostraLateral(v.cal, P, t, S.opc.minVis, v.membros); v.membros = a.membros; }
      else a = { t, fase: null };
      a.P = P;
      v.amostras.push(a);
      if (v.amostras.length > MAX_AMOSTRAS) v.amostras.splice(0, v.amostras.length - MAX_AMOSTRAS);
    };
    return () => { vivo = false; };
  }, [S]);

  // ---------------------------------------------------------- fusão periódica + interface
  useEffect(() => {
    const id = setInterval(() => {
      const L = S.vistas.lateral, F = S.vistas.frontal, L2 = S.vistas.lateral2;
      if (L.cal && L.amostras.length > 10) {
        try {
          S.res = fundir({
            calL: L.cal, calF: F.cal, calL2: L2.cal,
            lat: L.amostras.filter((a) => a.perto), fro: F.cal ? F.amostras.filter((a) => a.pts) : [],
            lat2: L2.cal ? L2.amostras.filter((a) => a.perto) : [],
            opc: { sync: S.opc.sync, offsetMs: S.opc.offsetMs, minVis: S.opc.minVis },
          });
          S.erroFusao = '';
        } catch (e) { S.erroFusao = String(e.message || e); }
      }
      atualizar();
    }, 700);
    return () => clearInterval(id);
  }, [S, atualizar]);

  // ---------------------------------------------------------- desenho (vídeos + 3D)
  useEffect(() => {
    let raf = 0, ult = 0;
    const desenharVista = (v) => {
      const c = S.canvases[v.k];
      if (!c) return;
      const g = c.getContext('2d');
      if (!v.video || !v.video.videoWidth) {
        if (c.width !== 640) { c.width = 640; c.height = 360; }
        g.fillStyle = COR.vazio; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = COR.mudo; g.font = `16px ${FONTE}`; g.textAlign = 'center';
        g.fillText('sem fonte — escolha câmera ou arquivo', c.width / 2, c.height / 2);
        g.textAlign = 'left';
        return;
      }
      const W = v.video.videoWidth, H = v.video.videoHeight, k = Math.min(1, 960 / W);
      const w = Math.round(W * k), h = Math.round(H * k);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      g.drawImage(v.video, 0, 0, w, h);
      const lw = Math.max(1.5, w / 400);
      // pose
      if (v.P && performance.now() - v.Pt < 1500) {
        const P = v.P.map((p) => ({ x: p.x * k, y: p.y * k, v: p.v }));
        for (const l of [0, 1]) {
          const cor = l === 1 ? COR.d : COR.e;
          for (const [a, b] of OSSOS) {
            const A = P[LM[a][l]], B = P[LM[b][l]];
            if (A.v < 0.3 || B.v < 0.3) continue;
            g.strokeStyle = cor; g.globalAlpha = 0.35 + 0.6 * Math.min(A.v, B.v); g.lineWidth = lw * 1.6;
            g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
          }
        }
        g.globalAlpha = 1;
      }
      // pontos de calibração e o quadro reprojetado
      g.font = `600 ${Math.round(11 * lw / 1.5)}px ${FONTE}`;
      for (const p of PONTOS_REF) {
        const q = v.cliques[p.k];
        if (!q) continue;
        g.fillStyle = COR.ref; g.strokeStyle = COR.contorno; g.lineWidth = 1.5;
        g.beginPath(); g.arc(q.x * k, q.y * k, 4 * lw / 1.5, 0, 7); g.fill(); g.stroke();
        g.fillStyle = COR.vazio; g.fillText(p.nome, q.x * k + 7, q.y * k - 5);
        g.fillStyle = COR.ref; g.fillText(p.nome, q.x * k + 6, q.y * k - 6);
      }
      if (v.cal && v.cal.tipo === 'lateral') {
        const o = bikeParaLateral(v.cal, { X: 0, Y: 0, Z: 0 }), xx = bikeParaLateral(v.cal, { X: 20, Y: 0, Z: 0 }), yy = bikeParaLateral(v.cal, { X: 0, Y: 20, Z: 0 });
        seta(g, o, xx, k, '#FF8A80', 'X'); seta(g, o, yy, k, '#8CE0C8', 'Y');
      }
      if (v.cal && v.cal.tipo === 'frontal' && S.vistas.lateral.cal) {
        const ref = S.vistas.lateral.cal.ref;
        const o = bikeParaFrontal(v.cal, { ...ref.baixo, Z: 0 }), zz = bikeParaFrontal(v.cal, { ...ref.baixo, Z: 20 }), yy = bikeParaFrontal(v.cal, { ...ref.baixo, Y: 20, Z: 0 });
        seta(g, o, zz, k, COR.e, 'Z (direita)'); seta(g, o, yy, k, '#8CE0C8', 'Y');
      }
      if (v.calibrando) {
        const prox = PONTOS_REF.find((p) => !v.cliques[p.k]);
        if (prox) {
          g.fillStyle = COR.aviso; g.fillRect(0, 0, w, 26 * lw / 1.5);
          g.fillStyle = COR.d; g.font = `600 ${Math.round(13 * lw / 1.5)}px ${FONTE}`;
          g.fillText(`Clique: ${prox.nome} — ${prox.dica}`, 8, 18 * lw / 1.5);
        }
      }
    };
    const seta = (g, a, b, k, cor, rot) => {
      g.strokeStyle = cor; g.fillStyle = cor; g.lineWidth = 2;
      g.beginPath(); g.moveTo(a.x * k, a.y * k); g.lineTo(b.x * k, b.y * k); g.stroke();
      g.fillText(rot, b.x * k + 4, b.y * k - 4);
    };
    const quadro = (ts) => {
      raf = requestAnimationFrame(quadro);
      if (ts - ult < 33) return;
      const dt = ult ? ts - ult : 0;
      ult = ts;
      corDoTema();
      for (const x of VISTAS) desenharVista(S.vistas[x.k]);
      S.animFase = (S.animFase + (dt / 1500) * 360) % 360;
      desenhar3D(S);
    };
    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
  }, [S]);

  // ---------------------------------------------------------- fechar / limpar
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
      for (const x of VISTAS) pararFonte(S.vistas[x.k]);
      if (window.aivBikeFit3D && window.aivBikeFit3D._S === S) delete window.aivBikeFit3D;
    };
  }, [S, onClose, pararFonte]);

  // ---------------------------------------------------------- exportar
  const exportarJSON = useCallback(() => {
    const L = S.vistas.lateral, F = S.vistas.frontal, L2 = S.vistas.lateral2;
    const r = S.res;
    const limpo = (cal) => (cal ? JSON.parse(JSON.stringify(cal)) : null);
    const dados = {
      formato: 'iavision-bikefit3d', versao: 1, prototipo: true, data: new Date().toISOString(),
      aviso: 'Protótipo: 3D por fusão de duas vistas 2D sem marcadores; ver docs/bike-fit-3d.md para a precisão.',
      opcoes: S.opc,
      calibracao: { lateral: { cliques: L.cliques, cal: limpo(L.cal) }, frontal: { cliques: F.cliques, cal: limpo(F.cal) }, lateral2: { cliques: L2.cliques, cal: limpo(L2.cal) } },
      amostras: { lateral: L.amostras.length, frontal: F.amostras.length, lateral2: L2.amostras.length },
      metricas: r ? r.metricas : null, cadencia: r ? r.cadencia : null, avisos: r ? r.avisos : [],
      cicloMedio: r ? r.faixas.map((f) => ({ fase: f.fase, esqueleto: f.esq, angulos3D: f.ang, angulos2D: f.ang2d })) : [],
    };
    baixar(new Blob([JSON.stringify(dados, null, 1)], { type: 'application/json' }), `bikefit3d-${carimbo()}.json`);
  }, [S]);
  const exportarCSV = useCallback(() => {
    if (!S.res) return;
    baixar(new Blob([csvCiclo(S.res)], { type: 'text/csv' }), `bikefit3d-ciclo-${carimbo()}.csv`);
  }, [S]);
  const exportarPNG = useCallback(() => {
    if (!S.c3d) return;
    S.c3d.toBlob((b) => b && baixar(b, `bikefit3d-${carimbo()}.png`), 'image/png');
  }, [S]);

  // ---------------------------------------------------------- órbita
  const arrasto = useRef(null);
  const onDown = (e) => { arrasto.current = { x: e.clientX, y: e.clientY, az: S.cam.az, el: S.cam.el }; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove = (e) => {
    const a = arrasto.current; if (!a) return;
    S.cam.az = a.az - (e.clientX - a.x) * 0.4;
    S.cam.el = Math.max(-80, Math.min(85, a.el + (e.clientY - a.y) * 0.3));
  };
  const onUp = () => { arrasto.current = null; };
  const onWheel = (e) => { e.preventDefault(); S.cam.dist = Math.max(120, Math.min(900, S.cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); };
  const ref3d = useCallback((c) => {
    if (S.c3d && S.c3d !== c && S.c3d._wheel) S.c3d.removeEventListener('wheel', S.c3d._wheel);
    S.c3d = c;
    if (c && !c._wheel) { c._wheel = onWheel; c.addEventListener('wheel', onWheel, { passive: false }); }
  }, [S]);
  const vistaPronta = (az, el) => { S.cam.az = az; S.cam.el = el; };

  // ---------------------------------------------------------- gancho de teste
  useEffect(() => {
    window.aivBikeFit3D = {
      _S: S,
      // como o <input type=file>: o vídeo vira Blob (busca garantida, sem depender de Range no servidor)
      abrirVideo: async (k, url) => { const b = await (await fetch(url)).blob(); return abrirArquivo(k, new File([b], url.split('/').pop(), { type: b.type || 'video/webm' })); },
      calibrar: (k, pontos) => { S.vistas[k].cliques = { ...pontos }; recalibrar(); return S.vistas[k].cal ? 'ok' : S.vistas[k].erroCal; },
      opcoes: (o) => { Object.assign(S.opc, o); recalibrar(); return S.opc; },
      camera: (k, deviceId) => abrirCamera(k, deviceId),
      dispositivos: () => listarCameras(true).then((ds) => ds.map((d) => ({ id: d.deviceId, nome: d.label }))),
      estado: () => ({
        modelos: isReady('yolox') && isReady('pose'),
        vistas: Object.fromEntries(VISTAS.map((x) => { const v = S.vistas[x.k]; return [x.k, { fonte: v.fonte, nInfer: v.nInfer, amostras: v.amostras.length, comFase: v.amostras.filter((a) => a.fase != null).length, cal: Boolean(v.cal), erro: v.erro || v.erroCal, inferMs: Math.round(v.inferMs), semDetector: Boolean(v.rast.semDetector), info: v.info }]; })),
        cadencia: S.res ? S.res.cadencia : null, avisos: S.res ? S.res.avisos : [],
        metricas: S.res ? S.res.metricas : null, cal: { lateral: S.vistas.lateral.cal, frontal: S.vistas.frontal.cal },
      }),
      pausar: (p = true) => { S.rodando = !p; },
      camera3d: (az, el, dist) => { S.cam = { az, el, dist: dist || S.cam.dist }; },
    };
  }, [S, abrirArquivo, recalibrar, abrirCamera, listarCameras]);

  // ================================================================= interface
  const r = S.res, M = r && r.metricas;
  const L = S.vistas.lateral;
  const ladoC = L.cal ? L.cal.ladoCamera : 'd';
  const nomeL = (l) => (l === 'd' ? 'direito' : 'esquerdo');
  const opc = S.opc;
  const setOpc = (k, val, recal = true) => { opc[k] = val; if (k === 'fpsArquivo') for (const x of VISTAS) S.vistas[x.k].passoS = 1 / val; if (recal) recalibrar(); else atualizar(); };

  const cartaoVista = (def) => {
    const v = S.vistas[def.k];
    const nCliques = PONTOS_REF.filter((p) => v.cliques[p.k]).length;
    const comFase = def.k === 'frontal' ? v.amostras.length : v.amostras.filter((a) => a.fase != null).length;
    return html`<section class="bf3d-vista" key=${def.k}>
      <header>
        <b>${def.nome}</b>
        <span class="bf3d-st ${v.cal ? 'ok' : nCliques ? 'meio' : ''}">${v.cal ? 'calibrada' : nCliques ? `${nCliques}/5 pontos` : 'sem calibração'}</span>
        ${v.video && html`<span class="bf3d-mini">${v.nInfer} poses · ${comFase} úteis${v.inferMs ? ` · ${Math.round(v.inferMs)} ms` : ''}</span>`}
      </header>
      <div class="bf3d-fonte">
        <select aria-label=${'Fonte ' + def.nome} value=${v.fonte === 'camera' ? 'cam:' + v.deviceId : v.fonte === 'arquivo' ? 'arquivo' : ''}
          onChange=${(e) => {
            const val = e.target.value;
            if (val === '') { pararFonte(v); atualizar(); } else if (val === 'arquivo') { const i = document.getElementById('bf3d-arq-' + def.k); if (i) i.click(); } else if (val === 'pedir') listarCameras(true).then(() => atualizar()); else abrirCamera(def.k, val.slice(4));
          }}>
          <option value="">— sem fonte —</option>
          ${dispositivos.map((d) => html`<option key=${d.id} value=${'cam:' + d.id}>📷 ${d.nome}</option>`)}
          ${!dispositivos.length || !dispositivos[0].id ? html`<option value="pedir">📷 permitir câmeras…</option>` : null}
          <option value="arquivo">🎞 ${v.fonte === 'arquivo' ? v.nomeArq : 'arquivo de vídeo…'}</option>
        </select>
        <input id=${'bf3d-arq-' + def.k} type="file" accept="video/*" hidden onChange=${(e) => { const f = e.target.files && e.target.files[0]; if (f) abrirArquivo(def.k, f, f.name); e.target.value = ''; }} />
        <button class="bf3d-btn ${v.calibrando ? 'on' : ''}" disabled=${!v.video}
          onClick=${() => { if (v.calibrando) v.calibrando = false; else { v.cliques = {}; v.calibrando = true; v.cal = null; } atualizar(); }}>
          ${v.calibrando ? 'Cancelar' : nCliques === 5 ? 'Recalibrar' : 'Calibrar (5 cliques)'}</button>
        ${v.calibrando && nCliques > 0 && html`<button class="bf3d-btn" onClick=${() => { const ks = PONTOS_REF.map((p) => p.k).filter((k) => v.cliques[k]); const c = { ...v.cliques }; delete c[ks[ks.length - 1]]; v.cliques = c; atualizar(); }}>Desfazer</button>`}
        <label class="bf3d-chk" title="Marque se a imagem desta fonte já vem espelhada (selfie)">
          <input type="checkbox" checked=${v.espelhada} onChange=${(e) => { v.espelhada = e.target.checked; recalibrar(); }} /> espelhada</label>
      </div>
      <canvas class="bf3d-video ${v.calibrando ? 'mira' : ''}" ref=${(c) => { S.canvases[def.k] = c; }} onClick=${(e) => clicar(def.k, e)}></canvas>
      <p class="bf3d-dica">${v.erro ? html`<span class="err">⚠ ${v.erro}</span>` : v.erroCal ? html`<span class="err">⚠ ${v.erroCal}</span>` : def.dica}
        ${v.cal && v.cal.tipo === 'lateral' && html` · lado da câmera: <b>${nomeL(v.cal.ladoCamera)}</b> · linha dos eixos ${num(v.cal.inclinacao)}° · selim–MC ${num(v.cal.selimMC)} cm (confira com a trena)`}
        ${v.cal && v.cal.tipo === 'frontal' && html` · distância ${num(v.cal.D, 0)} cm${opc.distFroCm ? '' : ' (estimada)'} · guinada ${num(v.cal.guinada)}° · rolar ${num(v.cal.rolar * 57.2958)}° · erro dos cliques ${num(v.cal.residuoCm)} cm`}
        ${v.aoVivo && v.fonte === 'arquivo' && html` · <span class="warn">vídeo sem índice de busca: analisado tocando a 0,25×</span>`}
        ${v.rast.semDetector && v.video && html` · <span class="warn">detector não achou pessoa: recorte = quadro inteiro</span>`}</p>
      ${v.cal && v.cal.avisos && v.cal.avisos.map((a, i) => html`<p class="bf3d-dica warn" key=${i}>⚠ ${a}</p>`)}
    </section>`;
  };

  const linha = (rot, d3, d2, un = '°', c = 1) => html`<tr><th>${rot}</th><td>${num(d3, c)}${un}</td><td>${d2 === undefined ? '' : num(d2, c) + (d2 == null ? '' : un)}</td></tr>`;
  const ladoTab = (k, rot, un = ' mm', c = 0, fn = num) => html`<tr><th>${rot}</th><td>${fn(M.lados.e[k], c)}${un}</td><td>${fn(M.lados.d[k], c)}${un}</td></tr>`;

  const metricasHTML = html`<section class="bf3d-met">
    <h3>Métricas 3D <small>(ciclo médio${r && r.cadencia ? ` · ${Math.round(r.cadencia)} rpm` : ''})</small></h3>
    ${!M && html`<p class="bf3d-dica">Calibre a lateral (5 cliques + entre-eixos) e deixe o ciclista pedalar: as métricas aparecem depois de algumas pedaladas. Com a frontal calibrada entra o Z (lateral).</p>`}
    ${M && html`
      <table class="bf3d-tab">
        <thead><tr><th>Lado ${nomeL(ladoC)} (câmera)</th><th>3D</th><th>2D</th></tr></thead>
        <tbody>
          ${linha('Joelho PMI (extensão)', M.comparacao2D.joelhoPMI.d3, M.comparacao2D.joelhoPMI.d2)}
          ${linha('Joelho PMS (flexão)', M.comparacao2D.joelhoPMS.d3, M.comparacao2D.joelhoPMS.d2)}
          ${linha('Quadril mín.', M.comparacao2D.quadrilMin.d3, M.comparacao2D.quadrilMin.d2)}
          ${linha('Tornozelo no PMI', M.comparacao2D.tornozeloPMI.d3, M.comparacao2D.tornozeloPMI.d2)}
          ${linha('Tronco (médio)', M.comparacao2D.tronco.d3, M.comparacao2D.tronco.d2)}
          ${linha('Ombro (médio)', M.comparacao2D.ombro.d3, M.comparacao2D.ombro.d2)}
          ${linha('Cotovelo (médio)', M.comparacao2D.cotovelo.d3, M.comparacao2D.cotovelo.d2)}
        </tbody>
      </table>
      <table class="bf3d-tab">
        <thead><tr><th>Lateral (frontal)</th><th>Esq.</th><th>Dir.</th></tr></thead>
        <tbody>
          ${ladoTab('joelhoTravelMm', 'Knee travel (desloc. lateral do joelho)')}
          ${ladoTab('tornozeloTravelMm', 'Desloc. lateral do tornozelo')}
          ${ladoTab('desvioMedioMm', 'Joelho × linha quadril–tornozelo (+ fora)', ' mm', 1, sinal)}
          ${ladoTab('desvioPMSmm', '… no PMS', ' mm', 1, sinal)}
          ${ladoTab('quadrilZmm', 'Quadril até a linha média')}
          ${ladoTab('joelhoZmm', 'Joelho até a linha média')}
          ${ladoTab('peZmm', 'Pé até a linha média')}
          ${ladoTab('joelhoPMI', 'Joelho PMI 3D', '°', 1)}
          ${ladoTab('joelhoPMS', 'Joelho PMS 3D', '°', 1)}
        </tbody>
      </table>
      <p class="bf3d-dica">Simetria (dir. − esq.): knee travel ${sinal(M.simetria.joelhoTravelMm, 0)} mm · alinhamento ${sinal(M.simetria.desvioMedioMm)} mm · joelho até a linha média ${sinal(M.simetria.joelhoZmm, 0)} mm${M.simetria.real ? html` · joelho PMI ${sinal(M.simetria.joelhoPMI)}° · PMS ${sinal(M.simetria.joelhoPMS)}°` : html`<br /><span class="warn">Sem a lateral oposta, X e Y do lado ${nomeL(ladoC === 'd' ? 'e' : 'd')} são a perna da câmera defasada 180° (só o Z é medido): os ângulos do outro lado não comparam simetria.</span>`}</p>
      ${r.porTempo && html`<p class="bf3d-dica">Sincronia pelo tempo: ${r.porTempo.n} pares; knee travel bruto (sem média) ${num(r.porTempo.kneeTravelMm, 0)} mm.</p>`}
    `}
    ${r && r.avisos.map((a, i) => html`<p class="bf3d-dica warn" key=${'a' + i}>⚠ ${a}</p>`)}
    ${S.erroFusao && html`<p class="bf3d-dica err">⚠ ${S.erroFusao}</p>`}
  </section>`;

  const ajustesHTML = html`<details class="bf3d-ajustes" open>
    <summary>Medidas, sincronização e câmeras</summary>
    <div class="bf3d-campos">
      <label>Entre-eixos (cm)<input type="number" min="60" max="140" step="0.1" value=${opc.entreEixosCm} onChange=${(e) => setOpc('entreEixosCm', +e.target.value || 100)} /></label>
      <label>Câmera lateral → plano da bike (cm)<input type="number" min="80" max="600" value=${opc.distLatCm} onChange=${(e) => setOpc('distLatCm', +e.target.value || 200)} /></label>
      <label>Câmera frontal → movimento central (cm, 0 = estimar)<input type="number" min="0" max="800" value=${opc.distFroCm} onChange=${(e) => setOpc('distFroCm', +e.target.value || 0)} /></label>
      <label>Frontal<select value=${opc.posicao} onChange=${(e) => setOpc('posicao', e.target.value)}><option value="frente">à frente do ciclista</option><option value="tras">atrás do ciclista</option></select></label>
      <label>Sincronizar por<select value=${opc.sync} onChange=${(e) => setOpc('sync', e.target.value, false)}><option value="fase">fase da pedalada (padrão)</option><option value="tempo">relógio (câmeras ao vivo)</option></select></label>
      ${opc.sync === 'tempo' && html`<label>Atraso da frontal (ms)<input type="number" step="10" value=${opc.offsetMs} onChange=${(e) => setOpc('offsetMs', +e.target.value || 0, false)} /></label>`}
      <label>Arquivo: quadros por segundo analisados<input type="number" min="5" max="60" value=${opc.fpsArquivo} onChange=${(e) => setOpc('fpsArquivo', Math.max(5, Math.min(60, +e.target.value || 15)), false)} /></label>
      <label>Câmera: resolução<select value=${opc.res} onChange=${(e) => setOpc('res', e.target.value, false)}><option value="720">1280×720</option><option value="1080">1920×1080</option></select></label>
    </div>
    <div class="bf3d-linha">
      <button class="bf3d-btn" onClick=${() => { for (const x of VISTAS) { const v = S.vistas[x.k]; v.amostras = []; v.membros = null; } S.res = null; atualizar(); }}>Zerar amostras</button>
      <button class="bf3d-btn" onClick=${() => { S.rodando = !S.rodando; atualizar(); }}>${S.rodando ? 'Pausar análise' : 'Continuar análise'}</button>
    </div>
  </details>`;

  const tresD = html`<section class="bf3d-3d">
    <div class="bf3d-3d-barra">
      <button class="bf3d-btn" onClick=${() => vistaPronta(90, 0)}>Lateral</button>
      <button class="bf3d-btn" onClick=${() => vistaPronta(0, 0)}>Frontal</button>
      <button class="bf3d-btn" onClick=${() => vistaPronta(0, 89)}>Topo</button>
      <button class="bf3d-btn" onClick=${() => vistaPronta(38, 14)}>3/4</button>
      <span class="bf3d-sep"></span>
      <button class="bf3d-btn ${S.vivoAnim === 'ciclo' ? 'on' : ''}" onClick=${() => { S.vivoAnim = 'ciclo'; atualizar(); }} title="Anima o ciclo médio fundido">Ciclo médio</button>
      <button class="bf3d-btn ${S.vivoAnim === 'vivo' ? 'on' : ''}" onClick=${() => { S.vivoAnim = 'vivo'; atualizar(); }} title="Última pose da lateral + Z da frontal">Ao vivo</button>
    </div>
    <canvas class="bf3d-canvas3d" ref=${ref3d} onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}></canvas>
    <p class="bf3d-dica">Arraste para girar · roda do mouse para aproximar. <span class="bf3d-leg"><i style=${{ color: COR.d }}>■</i> direito</span> <span class="bf3d-leg"><i style=${{ color: COR.e }}>■</i> esquerdo</span> · linhas finas = trajetória do joelho e do tornozelo no ciclo médio.</p>
  </section>`;

  return html`<div class="bf3d" role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|BikeFit3D (protótipo)">
    <div class="bf3d-barra">
      <b class="bf3d-titulo"><span class="bf3d-marca">iaVision</span> <span class="bf3d-gp">GPlanSiS<i>|</i></span>BikeFit3D <em>protótipo</em></b>
      <span class="bf3d-sep"></span>
      <button class="bf3d-btn" onClick=${exportarJSON}>JSON</button>
      <button class="bf3d-btn" disabled=${!r} onClick=${exportarCSV}>CSV</button>
      <button class="bf3d-btn" onClick=${exportarPNG} title="Imagem da vista 3D">PNG<span class="bf3d-larga"> 3D</span></button>
      <${BotaoVia} modulo="bikefit" classe="bf3d-btn" />
      <button class="bf3d-btn fechar" onClick=${() => onClose && onClose()} aria-label="Fechar">✕</button>
    </div>
    <div class="bf3d-aviso">
      <b>Protótipo.</b> 3D por fusão de duas câmeras comuns, sem marcadores e sem sensor de profundidade: ângulos com erro típico de ±5–8° entre pedaladas,
      deslocamento lateral do joelho com resolução de poucos milímetros só com boa calibração e luz. Use para explorar, não para laudo.
      ${modelos && html`<br /><b>${modelos}</b>`}
    </div>
    <nav class="bf3d-abas">
      ${[['vistas', 'Câmeras'], ['3d', '3D'], ['met', 'Métricas']].map(([k, n]) => html`<button key=${k} class=${abaMob === k ? 'on' : ''} onClick=${() => setAbaMob(k)}>${n}</button>`)}
    </nav>
    <div class="bf3d-corpo aba-${abaMob}">
      <div class="bf3d-col bf3d-col-vistas">${ajustesHTML}${VISTAS.map(cartaoVista)}</div>
      <div class="bf3d-col bf3d-col-3d">${tresD}</div>
      <div class="bf3d-col bf3d-col-met">${metricasHTML}</div>
    </div>
  </div>`;
}

// ===================================================================== 3D
function desenhar3D(S) {
  const c = S.c3d;
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(200, Math.round(c.clientWidth * dpr)), H = Math.max(160, Math.round(c.clientHeight * dpr));
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext('2d');
  // palco: o mesmo degradê do .viewport do app (centro #04413C → borda #02302C)
  const deg = g.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
  deg.addColorStop(0, COR.fundo2); deg.addColorStop(1, COR.fundo);
  g.fillStyle = deg; g.fillRect(0, 0, W, H);
  const L = S.vistas.lateral;
  const ref = L.cal ? L.cal.ref : { mesa: { X: 47, Y: 64 }, selim: { X: -20, Y: 72 }, baixo: { X: 0, Y: 0 }, eixoD: { X: 60, Y: 7 }, eixoT: { X: -41, Y: 7 } };
  const alvo = { X: (ref.eixoD.X + ref.eixoT.X) / 2, Y: 55, Z: 0 };
  const pr = projetor({ ...S.cam, alvo, larg: W, alt: H });
  const lw = Math.max(1, W / 700);
  const linha = (A, B, cor, w = 2, alfa = 1) => {
    if (!A || !B) return;
    const a = pr(A), b = pr(B);
    if (!a || !b) return;
    g.globalAlpha = alfa; g.strokeStyle = cor; g.lineWidth = w * lw;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.globalAlpha = 1;
  };
  const P3 = (p, Z = 0) => ({ X: p.X, Y: p.Y, Z });
  // chão (grade) na altura do contato do pneu (eixo − raio da roda)
  const R = 34, yChao = (ref.eixoD.Y + ref.eixoT.Y) / 2 - R;
  for (let x = -100; x <= 140; x += 20) linha({ X: x, Y: yChao, Z: -60 }, { X: x, Y: yChao, Z: 60 }, COR.grade, 1);
  for (let z = -60; z <= 60; z += 20) linha({ X: -100, Y: yChao, Z: z }, { X: 140, Y: yChao, Z: z }, COR.grade, 1);
  // plano da bike (Z = 0), translúcido
  const cantos = [{ X: ref.eixoT.X - R, Y: yChao, Z: 0 }, { X: ref.eixoD.X + R, Y: yChao, Z: 0 }, { X: ref.eixoD.X + R, Y: 120, Z: 0 }, { X: ref.eixoT.X - R, Y: 120, Z: 0 }].map(pr);
  if (cantos.every(Boolean)) {
    g.fillStyle = COR.plano; g.beginPath(); g.moveTo(cantos[0].x, cantos[0].y);
    for (const p of cantos.slice(1)) g.lineTo(p.x, p.y);
    g.closePath(); g.fill();
  }
  // bike: rodas, quadro, eixos
  for (const e of [ref.eixoD, ref.eixoT]) {
    let ant = null;
    for (let i = 0; i <= 48; i++) { const a = (i / 48) * Math.PI * 2, p = { X: e.X + R * Math.cos(a), Y: e.Y + R * Math.sin(a), Z: 0 }; if (ant) linha(ant, p, COR.bike, 1.6, 0.8); ant = p; }
  }
  const q = (k) => P3(ref[k]);
  linha(q('eixoT'), q('baixo'), COR.bike, 2.4); linha(q('baixo'), q('selim'), COR.bike, 2.4); linha(q('selim'), q('eixoT'), COR.bike, 2);
  linha(q('baixo'), q('mesa'), COR.bike, 2.4); linha(q('selim'), q('mesa'), COR.bike, 2); linha(q('mesa'), q('eixoD'), COR.bike, 2.4);
  // eixos X Y Z no movimento central
  linha({ X: 0, Y: 0, Z: 0 }, { X: 25, Y: 0, Z: 0 }, COR.eixoX, 1.5); linha({ X: 0, Y: 0, Z: 0 }, { X: 0, Y: 25, Z: 0 }, COR.eixoY, 1.5); linha({ X: 0, Y: 0, Z: 0 }, { X: 0, Y: 0, Z: 25 }, '#60a5fa', 2);
  g.font = `${Math.round(11 * lw)}px ${FONTE}`;
  for (const [p, t, cor] of [[{ X: 28, Y: 0, Z: 0 }, 'X frente', COR.eixoX], [{ X: 0, Y: 28, Z: 0 }, 'Y', COR.eixoY], [{ X: 0, Y: 0, Z: 28 }, 'Z dir.', COR.eixoZ]]) {
    const a = pr(p); if (a) { g.fillStyle = cor; g.fillText(t, a.x + 3, a.y); }
  }
  const r = S.res;
  if (!r || !r.faixas.length) {
    g.fillStyle = COR.mudo; g.font = `${Math.round(13 * lw)}px ${FONTE}`;
    g.fillText(L.cal ? 'Aguardando pedaladas na lateral…' : 'Calibre a lateral para montar o 3D', 12 * lw, 22 * lw);
    return;
  }
  // trajetórias do ciclo médio
  const tr = trajetorias(r);
  for (const [k, pts] of Object.entries(tr)) {
    const l = k.slice(-1), cor = l === 'd' ? COR.d : COR.e;
    for (let i = 0; i < pts.length; i++) linha(pts[i], pts[(i + 1) % pts.length], cor, 1.2, 0.75);
  }
  // esqueleto: ciclo médio animado ou ao vivo
  let esq = null;
  if (S.vivoAnim === 'vivo') {
    const am = [...L.amostras].reverse().find((a) => a.perto && a.fase != null);
    const viv = am ? esqueletoAgora(r, L.cal, S.vistas.frontal.cal, am, { sync: S.opc.sync, offsetMs: S.opc.offsetMs, minVis: S.opc.minVis, calL2: S.vistas.lateral2.cal }) : null;
    esq = viv && viv.esq;
  }
  if (!esq) {
    const N = r.faixas.length, f = (S.animFase / 360) * N, i = Math.floor(f) % N, j = (i + 1) % N, w = f - Math.floor(f);
    esq = { e: {}, d: {} };
    for (const l of ['e', 'd']) for (const k of PARTES) {
      const a = r.faixas[i].esq[l][k], b = r.faixas[j].esq[l][k];
      esq[l][k] = a && b ? { X: a.X + (b.X - a.X) * w, Y: a.Y + (b.Y - a.Y) * w, Z: a.Z + (b.Z - a.Z) * w } : a || b;
    }
  }
  // pedivela até o pé (estimado) — ajuda a ler a fase
  for (const l of ['e', 'd']) {
    const s = esq[l], cor = l === 'd' ? COR.d : COR.e;
    for (const [a, b] of OSSOS) linha(s[a], s[b], cor, 3.2);
    for (const k of PARTES) {
      const p = s[k] && pr(s[k]);
      if (p) { g.fillStyle = cor; g.strokeStyle = COR.fundo; g.lineWidth = 1.2 * lw; g.beginPath(); g.arc(p.x, p.y, 3.2 * lw, 0, 7); g.fill(); g.stroke(); }
    }
  }
  linha(esq.e.ombro, esq.d.ombro, COR.osso, 2.4); linha(esq.e.quadril, esq.d.quadril, COR.osso, 2.4);
  // cabeça aproximada sobre os ombros
  if (esq.e.ombro && esq.d.ombro) {
    const m = { X: (esq.e.ombro.X + esq.d.ombro.X) / 2 + 8, Y: (esq.e.ombro.Y + esq.d.ombro.Y) / 2 + 14, Z: (esq.e.ombro.Z + esq.d.ombro.Z) / 2 };
    const p = pr(m), p2 = pr({ ...m, Y: m.Y + 10 });
    if (p && p2) { g.strokeStyle = COR.osso; g.lineWidth = 2 * lw; g.beginPath(); g.arc(p.x, p.y, Math.abs(p2.y - p.y), 0, 7); g.stroke(); }
  }
  // legenda no canvas (entra no PNG)
  const M = r.metricas;
  if (M) {
    g.font = `600 ${Math.round(12 * lw)}px ${FONTE}`;
    const tx = [
      'iaVision GPlanSiS|BikeFit3D · protótipo',
      `Knee travel E ${num(M.lados.e.joelhoTravelMm, 0)} mm · D ${num(M.lados.d.joelhoTravelMm, 0)} mm`,
      `Joelho PMI ${num(M.comparacao2D.joelhoPMI.d3)}° (2D ${num(M.comparacao2D.joelhoPMI.d2)}°) · PMS ${num(M.comparacao2D.joelhoPMS.d3)}°`,
    ];
    tx.forEach((t, i) => { g.fillStyle = COR.faixa; g.fillRect(8 * lw, (8 + i * 18) * lw, g.measureText(t).width + 10 * lw, 17 * lw); g.fillStyle = i ? COR.texto : COR.d; g.fillText(t, 13 * lw, (21 + i * 18) * lw); });
  }
}

export default BikeFit3D;
