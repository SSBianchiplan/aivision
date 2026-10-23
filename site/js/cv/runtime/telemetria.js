/**
 * cv/runtime/telemetria.js — coletor de telemetria para testes de desempenho.
 *
 * Quem mostra: o rodapé de monitoramento (components/RodapeTelemetria.js) e o
 * painel Telemetria (Panels.js). Quem alimenta: o Viewport, com UMA chamada no
 * fim de cada quadro (`quadro()`), e só quando alguém está olhando.
 *
 * CUSTO ZERO quando ninguém olha: sem assinantes, `tel.ativo` é false, o
 * Viewport nem chama `quadro()`, e não há intervalo, rVFC extra nem
 * PerformanceObserver ligados. Com assinantes, a amostragem é a 4 Hz (250 ms);
 * por quadro só se guarda o tempo do quadro num anel de Float32.
 *
 * O que se mede (cada métrica tem um id; o rodapé mostra as ligadas):
 *   laço        fps do laço de render (quadros que passaram pelo Viewport)
 *   captura     fps REAL da fonte (rVFC: quadros apresentados pelo <video>),
 *               quadros pulados pelo compositor, perdidos pelo decodificador
 *               e o frameRate que a trilha declara (getSettings)
 *   fonte       resolução do quadro (videoWidth×videoHeight)
 *   youtube     qualidade que o player do YouTube informa (qualidadeReal)
 *   exibicao    modo (passthrough/overlay/pixels) e quem força «pixels»
 *   canvas      tamanho real do canvas de exibição e densidade efetiva (teto de área: escala-canvas.js)
 *   trabalho    largura de trabalho (procWidth) e se a qualidade automática baixou
 *   quadro / p95  tempo do quadro (média da janela e p95 dos últimos ~250)
 *   modelos     inferência por modelo (média móvel do worker) e EP (wasm/webgpu)
 *   fila        filas do worker ONNX (rápida + lenta) e se está ocupado
 *   atraso      atraso da sincronia (sc.atrasoMs)
 *   repetidos   quadros repetidos/saltados da fila de reprodução da sincronia, por segundo
 *   eco         economia de CPU do WASM (definirEconomia) e se está descansando
 *   mem         heap JS (performance.memory, só Chromium)
 *   longas      tarefas longas (PerformanceObserver 'longtask') por segundo
 *   threads     crossOriginIsolated (WASM multi-thread) e núcleos
 */

import { soDesenha } from '../registry.js';
import { store } from '../../state/store.js';
import { modelStates, getSpec, estadoFila, isIsolated } from './onnx.js';

const PERIODO_MS = 250;           // 4 Hz: teto de amostragem
const ANEL = 256;                 // tempos de quadro guardados para o p95
const PREFS_KEY = 'iav.telemetria.v1';
const RODAPE_PADRAO = true;       // o rodapé vem ligado no computador (no celular, só se pedir)

// ------------------------------------------------------------ catálogo

/*
 * Métricas: `rodape` = ligada no rodapé por padrão. `fmt(a)` devolve
 * { t: texto curto, n: '' | 'warn' | 'err' } ou null (sem dado agora).
 * Os limites de alerta são do uso real (vídeo de 25–30 fps, orçamento de
 * quadro = 1000 / fps alvo); não são lei, são o «olha aqui».
 */
const nivel = (v, aviso, erro, menorPior = false) => {
  if (v == null || !Number.isFinite(v)) return '';
  if (menorPior) return v <= erro ? 'err' : v <= aviso ? 'warn' : '';
  return v >= erro ? 'err' : v >= aviso ? 'warn' : '';
};
const r0 = (v) => Math.round(v);

export const METRICAS = [
  { id: 'laco', rotulo: 'fps do laço', desc: 'quadros por segundo que passam pelo pipeline', rodape: true,
    // a referência é o alvo, mas nunca acima do que a fonte entrega (câmera de 20 fps não é «lenta»)
    fmt: (a) => {
      const ref = Math.min(a.alvoFps, a.fpsFonte || a.fpsTrilha || a.alvoFps);
      return { t: `fps ${r0(a.fpsLaco)}`, n: a.ativoVideo ? nivel(a.fpsLaco, ref * 0.8, ref * 0.5, true) : '' };
    } },
  { id: 'captura', rotulo: 'captura', desc: 'fps real da fonte (rVFC) e resolução do quadro', rodape: true,
    fmt: (a) => (a.fonteW ? {
      t: `captura ${a.fpsFonte != null ? r0(a.fpsFonte) + ' fps ' : ''}${a.fonteW}×${a.fonteH}`,
      n: a.fpsFonte != null && a.ativoVideo ? nivel(a.fpsFonte, 17.5, 10, true) : '',   // < 18 fps já aparece no vídeo
    } : null) },
  { id: 'quadros', rotulo: 'quadros pulados/perdidos', desc: 'pulados pelo compositor (rVFC) e perdidos pelo decodificador, por segundo; frameRate declarado pela trilha', rodape: false,
    fmt: (a) => (a.puladosS != null || a.perdidosS != null ? {
      t: `pulados ${fx(a.puladosS)}/s${a.perdidosS != null ? ` · perdidos ${fx(a.perdidosS)}/s` : ''}${a.fpsTrilha ? ` · trilha ${r0(a.fpsTrilha)} fps` : ''}`,
      n: nivel(Math.max(a.puladosS || 0, a.perdidosS || 0), 1, 5),
    } : null) },
  { id: 'youtube', rotulo: 'qualidade do YouTube', desc: 'nível que o player informa (qualidadeReal)', rodape: true,
    fmt: (a) => (a.ytNivel ? { t: `YouTube ${a.ytNivel}`, n: '' } : null) },
  { id: 'exibicao', rotulo: 'modo de exibição', desc: 'passthrough / overlay / pixels e quem força pixels', rodape: true,
    fmt: (a) => ({ t: `exibição ${a.modo}${a.forca ? ' (' + a.forca + ')' : ''}`, n: '' }) },
  { id: 'canvas', rotulo: 'canvas de exibição', desc: 'tamanho real (backing) do canvas e a densidade efetiva; (teto) = limitada pelo teto de área (escala-canvas.js)', rodape: true,
    fmt: (a) => (a.canvasW ? {
      t: `canvas ${a.canvasW}×${a.canvasH} @${dec(a.dprEf)}x${a.dprTeto ? ' (teto)' : ''}`,
      n: nivel(a.canvasW * a.canvasH, 4.5e6, 9e6),
    } : null) },
  { id: 'trabalho', rotulo: 'largura de trabalho', desc: 'procWidth efetivo; ↓auto = a qualidade automática baixou', rodape: true,
    fmt: (a) => (a.modo === 'passthrough' ? null : {
      t: `trabalho ${a.trabalho} px${a.autoBaixou ? ` ↓auto de ${a.trabalhoMax}` : ''}`,
      n: a.autoBaixou ? 'warn' : '',
    }) },
  { id: 'quadro', rotulo: 'tempo do quadro', desc: 'média da janela e p95 (ms) do processamento do quadro', rodape: true,
    fmt: (a) => (a.modo === 'passthrough' ? null : { t: `quadro ${fx(a.quadroMs)} ms · p95 ${fx(a.p95Ms)}`, n: nivel(a.p95Ms, a.orcamento, a.orcamento * 2) }) },
  { id: 'modelos', rotulo: 'inferência por modelo', desc: 'tempo de execução no worker (média móvel) e EP de cada modelo em uso', rodape: true,
    fmt: (a) => (a.modelos.length ? {
      t: a.modelos.slice(0, 3).map(textoModelo).join(' · ') + (a.modelos.length > 3 ? ` +${a.modelos.length - 3}` : ''),
      n: a.modelos.some((m) => m.status === 'error') ? 'err'
        : a.modelos.some((m) => m.erroGpu) ? 'warn' : nivel(a.modelos[0].ms, 300, 1000),
    } : null) },
  { id: 'fila', rotulo: 'fila do worker', desc: 'tarefas esperando no worker ONNX (rápida + lenta)', rodape: true,
    fmt: (a) => (a.fila ? { t: `fila ${a.fila.total}${a.fila.lenta ? ` (${a.fila.lenta} lenta)` : ''}`, n: nivel(a.fila.total, 3, 6) } : null) },
  { id: 'atraso', rotulo: 'atraso da sincronia', desc: 'quanto a imagem exibida está atrás da captura (arquivo/YouTube)', rodape: true,
    fmt: (a) => (a.sincronia ? { t: `atraso ${r0(a.atrasoMs)} ms`, n: nivel(a.atrasoMs, 900, 1600) } : null) },
  { id: 'repetidos', rotulo: 'repetidos/saltados', desc: 'quadros repetidos e saltados pela fila de reprodução da sincronia, por segundo', rodape: true,
    fmt: (a) => (a.sincronia ? {
      t: `repetidos ${fx(a.repetidosS)}/s${a.saltosS ? ` · saltos ${fx(a.saltosS)}/s` : ''}`,
      n: nivel((a.repetidosS || 0) + (a.saltosS || 0), 2, 6),
    } : null) },
  { id: 'eco', rotulo: 'economia de CPU', desc: 'descanso do worker WASM com a sincronia (definirEconomia)', rodape: true,
    fmt: (a) => (a.fila ? { t: `CPU eco ${a.fila.economia ? 'on' : 'off'}${a.fila.descansando ? ' (pausa)' : ''}`, n: '' } : null) },
  { id: 'mem', rotulo: 'memória JS', desc: 'heap JS usado (performance.memory, só Chrome/Edge)', rodape: true,
    fmt: (a) => (a.memMB != null ? { t: `mem ${r0(a.memMB)} MB`, n: nivel(a.memMB, 1500, 3000) } : null) },
  { id: 'longas', rotulo: 'tarefas longas', desc: 'tarefas > 50 ms na thread principal, por segundo', rodape: false,
    fmt: (a) => (a.longasS != null ? { t: `longas ${fx(a.longasS)}/s`, n: nivel(a.longasS, 1, 3) } : null) },
  { id: 'threads', rotulo: 'modo de threads', desc: 'crossOriginIsolated (WASM multi-thread) e núcleos lógicos', rodape: false,
    fmt: (a) => ({ t: `threads ${a.isolado ? 'multi' : 'única'}${a.nucleos ? ' · ' + a.nucleos + ' núcleos' : ''}`, n: a.isolado ? '' : 'warn' }) },
];

function fx(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}
function rotEp(ep) {
  return ep === 'webgpu' ? 'GPU' : ep === 'wasm' ? 'WASM' : (ep || '');
}
/** 1,0 — vírgula decimal, uma casa. */
function dec(v) { return Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '—'; }
/** «YOLOX-S GPU 169,8 ms» · «YOLOX-S GPU→WASM 210 ms» (WebGPU falhou) · «RF-DETR baixando 45%». */
function textoModelo(m) {
  if (m.status === 'loading') return `${m.nome} baixando ${Math.round((m.progress || 0) * 100)}%`;
  if (m.status === 'error') return `${m.nome} ERRO`;
  const ep = m.erroGpu ? 'GPU→WASM' : rotEp(m.ep);
  return `${m.nome} ${ep} ${m.ms ? (m.ms >= 100 ? r0(m.ms) : dec(m.ms)) + ' ms' : '—'}`;
}

// ------------------------------------------------------------ preferências

const prefsOuvintes = new Set();
let prefs = lerPrefs();

function lerPrefs() {
  const p = { rodape: RODAPE_PADRAO, celular: false, mostrar: {} };
  for (const m of METRICAS) p.mostrar[m.id] = m.rodape;
  try {
    const salvo = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (salvo && typeof salvo === 'object') {
      if (typeof salvo.rodape === 'boolean') p.rodape = salvo.rodape;
      if (typeof salvo.celular === 'boolean') p.celular = salvo.celular;
      if (salvo.mostrar && typeof salvo.mostrar === 'object') {
        for (const m of METRICAS) if (typeof salvo.mostrar[m.id] === 'boolean') p.mostrar[m.id] = salvo.mostrar[m.id];
      }
    }
  } catch (_) { /* storage bloqueado ou JSON velho: segue o padrão */ }
  return p;
}

export function lerPrefsTelemetria() { return prefs; }

/** Muda preferências (`{ rodape }`, `{ celular }` ou `{ mostrar: { id: bool } }`) e persiste. */
export function definirPrefsTelemetria(patch) {
  prefs = {
    ...prefs, ...patch,
    mostrar: patch && patch.mostrar ? { ...prefs.mostrar, ...patch.mostrar } : prefs.mostrar,
  };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* modo privado */ }
  for (const fn of prefsOuvintes) fn(prefs);
}

export function onPrefsTelemetria(fn) {
  prefsOuvintes.add(fn);
  return () => prefsOuvintes.delete(fn);
}

// ------------------------------------------------------------ estado do coletor

/**
 * O que o Viewport consulta a cada quadro. `ativo` só é true com alguém
 * assinando; o Viewport testa isto antes de chamar `quadro()`.
 */
export const tel = { ativo: false };

const assinantes = new Set();
let ultima = null;                 // última amostra (para quem assina depois)

// por quadro (barato): tempos num anel, contagem de quadros
const tempos = new Float32Array(ANEL);
let iTempo = 0, nTempo = 0;
let quadrosJanela = 0, somaMsJanela = 0, nMsJanela = 0;
// referências do último quadro (lidas só a 4 Hz)
let refDisplay = null, refSrc = null, refSc = null;

/** Chamado pelo Viewport no fim de cada quadro, só com `tel.ativo`. */
export function quadro(procMs, display, src, sc, _st) {
  quadrosJanela++;
  if (procMs > 0) {
    somaMsJanela += procMs; nMsJanela++;
    tempos[iTempo] = procMs; iTempo = (iTempo + 1) % ANEL; if (nTempo < ANEL) nTempo++;
  }
  refDisplay = display; refSrc = src; refSc = sc;
}

/** Assina as amostras (4 Hz). Liga o coletor no 1º assinante e desliga no último. */
export function assinarTelemetria(fn) {
  assinantes.add(fn);
  if (assinantes.size === 1) ligar();
  else if (ultima) fn(ultima);
  return () => {
    assinantes.delete(fn);
    if (!assinantes.size) desligar();
  };
}

export function ultimaAmostra() { return ultima; }

// ------------------------------------------------------------ ligar / desligar

let relogio = null;
let tAnt = 0;
let obsLongas = null, longasJanela = 0;
// rVFC próprio na fonte: quadros apresentados (metadata.presentedFrames) e callbacks vistos
const vfc = { el: null, h: 0, apresentados: null, vistos: 0, apresentados0: null, vistos0: 0, perdidos0: null };
const sincAnt = { buf: null, rep: 0, sal: 0 };

function ligar() {
  tel.ativo = true;
  tAnt = performance.now();
  quadrosJanela = 0; somaMsJanela = 0; nMsJanela = 0; nTempo = 0; iTempo = 0;
  relogio = setInterval(amostrar, PERIODO_MS);
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      obsLongas = new PerformanceObserver((lista) => { longasJanela += lista.getEntries().length; });
      obsLongas.observe({ type: 'longtask', buffered: false });
    } catch (_) { obsLongas = null; }   // navegador sem 'longtask' (Safari, Firefox)
  }
}

function desligar() {
  tel.ativo = false;
  clearInterval(relogio); relogio = null;
  if (obsLongas) { try { obsLongas.disconnect(); } catch (_) { /* já desligado */ } obsLongas = null; }
  pararVfc();
  refDisplay = refSrc = refSc = null;
  ultima = null;
}

function pararVfc() {
  if (vfc.el && vfc.h) { try { vfc.el.cancelVideoFrameCallback(vfc.h); } catch (_) { /* elemento já trocado */ } }
  vfc.el = null; vfc.h = 0; vfc.apresentados = null; vfc.vistos = 0;
  vfc.apresentados0 = null; vfc.vistos0 = 0; vfc.perdidos0 = null;
}

function seguirVfc(el) {
  if (vfc.el === el) return;
  pararVfc();
  if (!el || typeof el.requestVideoFrameCallback !== 'function') return;
  vfc.el = el;
  const cb = (_agora, meta) => {
    if (vfc.el !== el) return;
    vfc.vistos++;
    if (meta && Number.isFinite(meta.presentedFrames)) vfc.apresentados = meta.presentedFrames;
    vfc.h = el.requestVideoFrameCallback(cb);
  };
  vfc.h = el.requestVideoFrameCallback(cb);
}

// ------------------------------------------------------------ amostragem (4 Hz)

function modoDe(st) {
  const ativos = (st.nodes || []).filter((n) => n.enabled);
  if (!ativos.length) return { modo: 'passthrough', forca: '' };
  // a mesma regra do Viewport: overlayOnly booleano ou função dos parâmetros (registry.soDesenha)
  const forcam = ativos.filter((n) => !soDesenha(n));
  if (!forcam.length) return { modo: 'overlay', forca: '' };
  const nomes = forcam.map((n) => n.op.split('.').pop());
  return { modo: 'pixels', forca: nomes.slice(0, 2).join(', ') + (nomes.length > 2 ? ` +${nomes.length - 2}` : '') };
}

function p95() {
  if (!nTempo) return null;
  const a = Array.from(nTempo < ANEL ? tempos.subarray(0, nTempo) : tempos).sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
}

function amostrar() {
  const agora = performance.now();
  const dt = Math.max(1, agora - tAnt) / 1000;
  tAnt = agora;
  // o store é o estado de agora (com o vídeo pausado o Viewport não chama quadro())
  const st = store.get(), src = refSrc, sc = refSc, display = refDisplay;
  const el = src && src.element;
  seguirVfc(el && el.tagName === 'VIDEO' ? el : null);

  const a = {
    t: Date.now(),
    alvoFps: (st && st.targetFps) || 30,
    orcamento: 1000 / ((st && st.targetFps) || 30),
    fonteKind: (st && st.sourceKind) || (src && src.kind) || '',
    fpsLaco: quadrosJanela / dt,
    quadroMs: nMsJanela ? somaMsJanela / nMsJanela : 0,
    p95Ms: p95(),
    ativoVideo: Boolean(st && st.running) && !(el && el.paused),   // vídeo pausado: 0 fps não é problema
  };
  quadrosJanela = 0; somaMsJanela = 0; nMsJanela = 0;

  // ---- fonte: resolução, fps real (rVFC), pulados/perdidos, trilha
  a.fonteW = el ? (el.videoWidth || el.naturalWidth || el.width || 0) : 0;
  a.fonteH = el ? (el.videoHeight || el.naturalHeight || el.height || 0) : 0;
  if (vfc.el) {
    if (vfc.apresentados != null && vfc.apresentados0 != null) {
      const ap = vfc.apresentados - vfc.apresentados0, vi = vfc.vistos - vfc.vistos0;
      a.fpsFonte = ap / dt;
      a.puladosS = Math.max(0, ap - vi) / dt;
    } else if (vfc.vistos0 || vfc.vistos) {
      a.fpsFonte = (vfc.vistos - vfc.vistos0) / dt;
    }
    vfc.apresentados0 = vfc.apresentados; vfc.vistos0 = vfc.vistos;
    try {
      // <video> fora do DOM (câmera, captura da aba) não é pintado: o Chrome conta todo quadro como
      // «dropped». Só vale para o elemento que está na página (arquivo/YouTube assistindo).
      const q = vfc.el.isConnected && vfc.el.getVideoPlaybackQuality && vfc.el.getVideoPlaybackQuality();
      if (q) {
        if (vfc.perdidos0 != null) a.perdidosS = Math.max(0, q.droppedVideoFrames - vfc.perdidos0) / dt;
        vfc.perdidos0 = q.droppedVideoFrames;
      }
    } catch (_) { /* sem qualidade de reprodução */ }
    try {
      const so = vfc.el.srcObject;
      const tr = so && so.getVideoTracks ? so.getVideoTracks()[0] : null;
      const s = tr && tr.getSettings ? tr.getSettings() : null;
      if (s && s.frameRate) a.fpsTrilha = s.frameRate;
    } catch (_) { /* trilha encerrada */ }
  }
  if (src && src.kind === 'youtube') {
    try { a.ytNivel = (src.qualidadeReal && src.qualidadeReal.nivel) || ''; } catch (_) { a.ytNivel = ''; }
  }

  // ---- exibição e trabalho
  const m = st ? modoDe(st) : { modo: '—', forca: '' };
  a.modo = m.modo; a.forca = m.forca;
  a.canvasW = display ? display.width : 0; a.canvasH = display ? display.height : 0;
  // densidade efetiva = backing / tamanho CSS; abaixo da do aparelho (teto 2) = teto de área aplicado
  a.cssW = display ? display.clientWidth : 0; a.cssH = display ? display.clientHeight : 0;
  a.dprAparelho = Math.min(2, window.devicePixelRatio || 1);
  a.dprEf = a.cssW ? a.canvasW / a.cssW : null;
  a.dprTeto = a.dprEf != null && a.dprEf < a.dprAparelho - 0.02;
  if (st) {
    const z = (st.zoom && st.zoom.z) || 1;
    const larguraFonte = a.fonteW ? a.fonteW / z : Infinity;
    a.trabalho = Math.max(64, Math.min(st.procWidth, Math.round(larguraFonte)));
    // qualidade automática: «baixou» = a largura atual foi posta por ela (procWidthAuto) e está
    // abaixo da escolhida pelo usuário (procWidthUsuario, 480 por padrão) — ver Viewport › autoQuality
    const usuario = st.procWidthUsuario || 480;
    a.autoBaixou = Boolean(st.autoQuality) && st.procWidth === st.procWidthAuto && st.procWidth < usuario;
    a.trabalhoMax = usuario;
  }

  // ---- sincronia: atraso e repetidos/saltados da fila de reprodução
  a.sincronia = Boolean(sc && (sc.atrasoMs > 0 || sc.buf.tamanho || sc.bufOut.tamanho));
  a.atrasoMs = sc ? sc.atrasoMs || 0 : 0;
  if (sc) {
    // overlay usa `buf`; pixels usa `bufOut` — vale o que tiver entregado quadros
    const b = sc.bufOut.tamanho ? sc.bufOut : sc.buf;
    const rep = b.repetidos || 0, sal = b.saltos || 0;
    if (sincAnt.buf === b) {
      a.repetidosS = Math.max(0, rep - sincAnt.rep) / dt;
      a.saltosS = Math.max(0, sal - sincAnt.sal) / dt;
    }
    sincAnt.buf = b; sincAnt.rep = rep; sincAnt.sal = sal;
  }

  // ---- modelos e fila do worker
  try {
    const ms = modelStates();
    a.modelos = Object.entries(ms)
      .filter(([, s]) => s.status === 'ready' || s.status === 'loading' || s.status === 'error')
      .map(([id, s]) => {
        const spec = getSpec(id);
        return {
          id, nome: nomeCurto((spec && spec.name) || id), ms: s.runMs || 0, ep: s.ep || '',
          status: s.status, progress: s.progress, erroGpu: s.erroGpu || null, error: s.error || null, cargaMs: s.ms || 0,
        };
      })
      .sort((x, y) => y.ms - x.ms);
  } catch (_) { a.modelos = []; }
  try { a.fila = estadoFila(); } catch (_) { a.fila = null; }

  // ---- memória, tarefas longas, threads
  const mem = performance.memory;
  a.memMB = mem && mem.usedJSHeapSize ? mem.usedJSHeapSize / 1048576 : null;
  if (obsLongas) { a.longasS = longasJanela / dt; longasJanela = 0; }
  a.isolado = typeof crossOriginIsolated !== 'undefined' ? Boolean(crossOriginIsolated) : isIsolated();
  a.nucleos = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 0;

  ultima = a;
  for (const fn of assinantes) {
    try { fn(a); } catch (err) { console.error('[telemetria]', err); }
  }
}

/** «RF-DETR (detecção livre)» → «RF-DETR», «RTMO-s — pose multi» → «RTMO-s»; nomes longos cortados. */
function nomeCurto(n) {
  const s = String(n).split(/\s+[—–-]\s+/)[0].replace(/\s*\(.*\)\s*$/, '').trim();
  return s.length > 18 ? s.slice(0, 17) + '…' : s;
}

// ------------------------------------------------------------ texto, relatório e gravação

/** Linhas «rótulo: valor» de uma amostra, na ordem do catálogo. */
export function linhasAmostra(a) {
  if (!a) return [];
  const out = [];
  for (const m of METRICAS) {
    let f = null;
    try { f = m.fmt(a); } catch (_) { f = null; }
    out.push(`${m.rotulo}: ${f ? f.t + (f.n ? ` [${f.n === 'err' ? 'ERRO' : 'ATENÇÃO'}]` : '') : '—'}`);
  }
  return out;
}

async function infoGpu() {
  const out = [];
  try {
    if (navigator.gpu) {
      const ad = await navigator.gpu.requestAdapter();
      if (ad) {
        const i = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null) || {};
        out.push(`WebGPU: ${[i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ') || 'adaptador sem info'}` +
          `${ad.isFallbackAdapter ? ' (fallback)' : ''} · maxBufferSize ${Math.round((ad.limits && ad.limits.maxBufferSize || 0) / 1048576)} MB`);
      } else out.push('WebGPU: requestAdapter() devolveu null');
    } else out.push('WebGPU: indisponível (navigator.gpu ausente)');
  } catch (err) { out.push('WebGPU: erro ' + (err && err.message ? err.message : err)); }
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (gl) out.push(`WebGL: ${ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`);
    const lose = gl && gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (_) { /* sem WebGL */ }
  return out;
}

/** Configurações da captura (getSettings da trilha) e tamanhos do canvas, lidos na hora. */
function linhasFonteCanvas(a) {
  const out = [];
  const src = refSrc, el = src && src.element, d = refDisplay;
  out.push(`fonte: ${(src && src.kind) || store.get().sourceKind || '—'}${el ? ` · quadro ${el.videoWidth || el.width || 0}×${el.videoHeight || el.height || 0}` : ''}` +
    `${a && a.fpsFonte != null ? ` · ${dec(a.fpsFonte)} fps reais` : ''}${a && a.ytNivel ? ` · YouTube ${a.ytNivel}` : ''}`);
  try {
    const so = el && el.srcObject;
    const tr = so && so.getVideoTracks ? so.getVideoTracks()[0] : null;
    if (tr) {
      const cfg = { ...(tr.getSettings ? tr.getSettings() : {}) };
      delete cfg.deviceId; delete cfg.groupId;   // identificadores do aparelho não vão para o suporte
      out.push(`captura (getSettings): ${JSON.stringify(cfg)}`);
      out.push(`trilha: ${tr.readyState}${tr.muted ? ' · muda' : ''}${tr.contentHint ? ' · hint ' + tr.contentHint : ''}`);
    }
  } catch (_) { /* trilha encerrada */ }
  if (d) {
    const cw = d.clientWidth, ch = d.clientHeight;
    out.push(`canvas de exibição: backing ${d.width}×${d.height} · CSS ${cw}×${ch} · densidade ${cw ? (d.width / cw).toFixed(2) : '?'}` +
      ` (aparelho ${window.devicePixelRatio || 1}, teto 2)${a && a.dprTeto ? ' · TETO DE ÁREA aplicado' : ''}`);
  }
  out.push(`tela: ${screen.width}×${screen.height} CSS · devicePixelRatio ${window.devicePixelRatio || 1} → ${Math.round(screen.width * (window.devicePixelRatio || 1))}×${Math.round(screen.height * (window.devicePixelRatio || 1))} px`);
  return out;
}

/** Relatório em texto para colar no suporte: ambiente, GPU, métricas, pipeline e modelos. */
export async function relatorioTelemetria() {
  const a = ultima;
  const st = store.get();
  const versao = (() => {
    const l = document.querySelector('link[rel="stylesheet"][href*="?v="]');
    const m = l && /[?&]v=([^&]+)/.exec(l.getAttribute('href'));
    return m ? m[1] : '?';
  })();
  const nav = navigator;
  const linhas = [
    `iaVision · relatório de telemetria · ${new Date().toISOString()}`,
    `versão: ${versao}`,
    `navegador: ${nav.userAgent}`,
    nav.userAgentData ? `plataforma: ${nav.userAgentData.platform || '?'}${nav.userAgentData.mobile ? ' (móvel)' : ''}` : null,
    `núcleos: ${nav.hardwareConcurrency || '?'} · memória do aparelho: ${nav.deviceMemory ? nav.deviceMemory + ' GB' : '?'} · crossOriginIsolated: ${typeof crossOriginIsolated !== 'undefined' ? crossOriginIsolated : '?'}`,
    `janela: ${window.innerWidth}×${window.innerHeight} CSS`,
    ...(await infoGpu()),
    '',
    '— métricas (janela de 250 ms) —',
    ...(a ? linhasAmostra(a) : ['(coletor parado: abra a Telemetria ou o rodapé)']),
  ].filter((x) => x !== null);
  if (st) {
    linhas.push('', '— pipeline —',
      `fonte: ${st.sourceKind} · rodando: ${st.running} · procWidth: ${st.procWidth} · qualidade automática: ${st.autoQuality} · fps alvo: ${st.targetFps}`,
      ...((st.nodes || []).map((n) => `${n.enabled ? '●' : '○'} ${n.op}${n.error ? ' — ERRO: ' + n.error : ''}`)));
    if (st.timings && st.timings.length) {
      linhas.push('', '— custo por operador (ms) —', ...st.timings.map((t) => `${t.op}: ${t.ms.toFixed(1)}${t.error ? ' (erro)' : ''}`));
    }
  }
  // fonte e canvas: o que se pergunta primeiro num chamado de desempenho
  linhas.push('', '— fonte e exibição —', ...linhasFonteCanvas(a));
  if (st) {
    linhas.push('', '— agora —',
      `fps: ${st.fps} · procMs: ${(st.procMs || 0).toFixed(1)} · procWidth: ${st.procWidth}`);
  }
  // todos os modelos com sessão (ou baixando/erro), mesmo antes da 1ª execução
  let estados = {};
  try { estados = modelStates(); } catch (_) { estados = {}; }
  const usados = Object.entries(estados).filter(([, s]) => s.status !== 'idle');
  linhas.push('', '— modelos —', ...(usados.length ? usados.map(([id, s]) => {
    const spec = getSpec(id);
    return `${id} (${(spec && spec.name) || id}): ${s.status} · ep ${s.ep || '—'} · runMs ${s.runMs || 0}` +
      ` · carga ${Math.round(s.ms || 0)} ms · fila ${s.fila || '—'}` +
      `${s.erroGpu ? ' · erroGpu: ' + s.erroGpu : ''}${s.error ? ' · erro: ' + s.error : ''}`;
  }) : ['(nenhum carregado)']));
  return linhas.join('\n');
}

/* Colunas do CSV: números crus (o rodapé formata; a planilha não). */
const COLUNAS = [
  ['t_ms', (a, t0) => a.t - t0], ['fps_laco', (a) => a.fpsLaco], ['fps_fonte', (a) => a.fpsFonte],
  ['pulados_s', (a) => a.puladosS], ['perdidos_s', (a) => a.perdidosS], ['fps_trilha', (a) => a.fpsTrilha],
  ['fonte_w', (a) => a.fonteW], ['fonte_h', (a) => a.fonteH], ['youtube', (a) => a.ytNivel],
  ['modo', (a) => a.modo], ['forca_pixels', (a) => a.forca], ['canvas_w', (a) => a.canvasW], ['canvas_h', (a) => a.canvasH], ['dpr_ef', (a) => a.dprEf], ['dpr_teto', (a) => (a.dprTeto ? 1 : 0)],
  ['trabalho_px', (a) => a.trabalho], ['auto_baixou', (a) => (a.autoBaixou ? 1 : 0)],
  ['quadro_ms', (a) => a.quadroMs], ['p95_ms', (a) => a.p95Ms],
  ['modelos', (a) => a.modelos.map((m) => `${m.id}=${m.ms}/${m.erroGpu ? 'webgpu>wasm' : m.ep}/${m.status}`).join(' ')],
  ['fila', (a) => (a.fila ? a.fila.total : '')], ['atraso_ms', (a) => a.atrasoMs],
  ['repetidos_s', (a) => a.repetidosS], ['saltos_s', (a) => a.saltosS],
  ['eco', (a) => (a.fila ? (a.fila.economia ? 1 : 0) : '')], ['mem_mb', (a) => a.memMB],
  ['longas_s', (a) => a.longasS], ['isolado', (a) => (a.isolado ? 1 : 0)],
];

function celula(v) {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Grava `segundos` de amostras e devolve o CSV. A gravação é um assinante:
 * mantém o coletor ligado mesmo se o painel fechar no meio.
 * `onProgresso(frac)` recebe 0–1 a cada amostra.
 */
export function gravarTelemetria(segundos = 30, onProgresso = null) {
  return new Promise((resolve) => {
    const linhas = [];
    let t0 = null;
    const sair = assinarTelemetria((a) => {
      if (t0 == null) t0 = a.t;
      linhas.push(COLUNAS.map(([, f]) => { try { return celula(f(a, t0)); } catch (_) { return ''; } }).join(','));
      const frac = Math.min(1, (a.t - t0) / (segundos * 1000));
      if (onProgresso) onProgresso(frac);
      if (frac >= 1) {
        sair();
        resolve([COLUNAS.map(([k]) => k).join(','), ...linhas].join('\n') + '\n');
      }
    });
  });
}
