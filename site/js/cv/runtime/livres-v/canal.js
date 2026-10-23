/**
 * cv/runtime/livres-v/canal.js — CV-88 Motion 3D Studio: a ponte entre o operador
 * motion3d.captura e o Studio (o "Live Link" do Actor_Mocap).
 *
 * O executor não expõe o ctx do quadro fora da cadeia (ver livres-m/canal.js): o operador
 * publica aqui cada pose estimada — 2D em px do quadro, os 33 pontos 3D (convenção do robo),
 * as mãos da cadeia (maos.gestos, se houver), o instante da fonte e a LATÊNCIA (quadro
 * capturado → pose pronta). O canal:
 *   - suaviza o 3D com o One Euro do GPlanSiS|ROBO (core/filtros.ts), parâmetros rastreáveis,
 *     guardando também o bruto (ADR: o filtro nunca substitui a evidência);
 *   - mede taxa (Rate), latência (com histograma) e o buffer ao vivo (últimos 10 s);
 *   - grava a TOMADA quando o Studio pede (só landmarks — nunca o vídeo);
 *   - avisa os ouvintes no máximo 30×/s.
 * Pose sintética para testes: window.aivMotion3D.injetar(...) usa o mesmo publicar().
 */
import { OneEuro } from '../../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';
import { reamostrar, novoId } from './tomada.js';
import { extrasDoQuadro } from './extras.js';
import { Levantador } from './levantar.js';

const BUFFER_MS = 10000;
const HIST = 120;

const ouvintes = new Set();
let retrato = null, ultimoQuadro = null, studio = false, precisa = false, timer = null, ultimoAviso = 0;
let filtros = null, cfgFiltro = { ligado: true, minCorte: 1.2, beta: 0.4 };
const buffer = [];          // { t, tWall, W, Wf, P2, vis, ex }
const estadoRosto = {};     // calibração adaptativa das expressões (extras.js)
// Studio v2: levantamento 2D→3D com restrições (levantar.js) — um por ator; o 3D exibido, gravado e
// retargetado passa a ser o reconstruído (Wl: piso em y = 0, raiz andando), o W fica como evidência
let cfgLev = { ligado: true, focal: 1.0, inclinacao: null, altura: null };
const levs = new Map();
let refRaiz = null;
function levantador(id, multi) {
  let l = levs.get(id);
  if (!l) { l = new Levantador({ focal: cfgLev.focal, inclinacao: cfgLev.inclinacao, altura: cfgLev.altura, raiz: !multi }); levs.set(id, l); }
  return l;
}
function zerarLev() { levs.clear(); refRaiz = null; }
/** 3D reconstruído de UM ator (ou null). Com várias pessoas: posição no piso relativa ao principal. */
function levantarAtor(id, r, P, W, tS, multi) {
  if (!cfgLev.ligado || !P) return null;
  const l = levantador(id, multi);
  let q = null;
  try { q = l.quadro({ P, w: r.w, h: r.h, esp: Boolean(r.esp), W, t: tS, rtmo: r.rtmo || null }); } catch (_) { q = null; }
  if (q && multi && l.raizAbs) {
    if (!refRaiz) refRaiz = l.raizAbs.slice();
    const dx = l.raizAbs[0] - refRaiz[0], dz = l.raizAbs[2] - refRaiz[2];
    q = q.map((p) => (p ? [p[0] + dx, p[1], p[2] + dz] : null));
  }
  return q;
}
const latencias = [];       // ms
// ---- SINCRONIA (o "fora do quadro"): cada pose leva o instante do quadro em que foi estimada
// (tCap, relógio da página = ctx.tQuadro do Viewport). Quem desenha sobre um quadro de vídeo pede a
// pose DAQUELE instante (poseEm): interpolada entre as duas poses vizinhas (arquivo/YouTube, com a
// imagem atrasada pela latência — components/video/sincronia.js) ou prevista pela velocidade até o
// quadro exibido (câmera ao vivo), com a correção desfeita suavemente quando a pose nova chega.
let sinc = { latMs: null, perMs: null, tCapAnt: null };
const etapas = {};          // nome → ms (média exponencial): det, recorte, pose, levantar, retarget, desenho
let previsao = null;        // { base (tCap da última pose usada), dP (correção 2D), dW (correção 3D), t0 }
let cfgPrev = { ligado: true, ganho: 0.8, maxMs: 120, corrMs: 15 };   // previsão (câmera ao vivo)
const intervalos = [];      // ms entre poses
let tAnt = null;
let gravacao = null;        // { id, inicio, amostras: [], fonte }

function avisar(ja = false) {
  const disparar = () => { ultimoAviso = performance.now(); timer = null; for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } } };
  if (ja) { if (timer) clearTimeout(timer); disparar(); return; }
  if (timer) return;
  timer = setTimeout(disparar, Math.max(0, 33 - (performance.now() - ultimoAviso)));
}

function filtrar(W, tS) {
  if (!W) return null;
  if (!cfgFiltro.ligado) return W.map((p) => (p ? p.slice() : null));
  if (!filtros) filtros = Array.from({ length: 33 * 3 }, () => new OneEuro(cfgFiltro.minCorte, cfgFiltro.beta));
  const dt = tAnt == null ? 0 : Math.max(0, (tS - tAnt) / 1000);
  return W.map((p, k) => {
    if (!p) { for (let e = 0; e < 3; e++) filtros[3 * k + e].reset(); return null; }
    return p.map((v, e) => filtros[3 * k + e].filtrar(v, dt));
  });
}

const mediana = (xs) => { if (!xs.length) return null; const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/**
 * Uma pose nova. r = { t (ms, tempo da fonte), P (33 {x,y,v} px do quadro) | null, w, h,
 * W (33 [x,y,z] | null) | null, latMs, maos?, img? (ImageData, só com o Studio aberto), fonte? }.
 */
export function publicar(r) {
  const agora = performance.now();
  if (r.img) ultimoQuadro = r.img;
  const tS = Number.isFinite(r.t) ? r.t : agora;
  if (tAnt != null && tS < tAnt - 50) { filtros = null; tAnt = null; zerarLev(); }      // vídeo voltou: recomeça o filtro e o levantamento
  const Wf = filtrar(r.W, tS);
  if (tAnt != null && tS > tAnt) { intervalos.push(tS - tAnt); if (intervalos.length > HIST) intervalos.shift(); }
  tAnt = tS;
  if (Number.isFinite(r.latMs)) { latencias.push(r.latMs); if (latencias.length > HIST) latencias.shift(); }
  const P2 = r.P && r.w ? r.P.map((p) => (p ? { x: p.x / r.w, y: p.y / r.h, v: p.v } : null)) : null;
  // mãos e rosto da cadeia no referencial 3D (dedos, cabeça e expressões do avatar; só números)
  const ex = r.P && (r.maos || r.rosto) ? extrasDoQuadro(r, estadoRosto) : null;
  const multi = Array.isArray(r.atores) && r.atores.length > 1;
  const idPri = multi ? r.atores[0].id : 'principal';
  const tL0 = performance.now();
  const Wl = levantarAtor(idPri, r, r.P, r.W, tS, multi);
  let atores = null;
  if (Array.isArray(r.atores) && r.atores.length) {
    atores = r.atores.map((a, k) => ({ ...a, Wl: k === 0 ? Wl : levantarAtor(a.id, r, a.P, a.W, tS, multi), cor: k }));
    for (const id of [...levs.keys()]) if (id !== 'principal' && !r.atores.some((a) => a.id === id)) levs.delete(id);
  }
  if (r.P) canalMotion.etapa('levantar', performance.now() - tL0);
  const tCap = Number.isFinite(r.tCap) ? r.tCap : agora - (Number.isFinite(r.latMs) ? r.latMs : 0);
  const am = { t: tS, tWall: agora, tCap, W: r.W || null, Wf, Wl, P2, vis: r.P ? r.P.map((p) => (p ? p.v : 0)) : null, ex };
  if (buffer.length && tCap < buffer[buffer.length - 1].tCap) { buffer.length = 0; previsao = null; }   // relógio voltou (testes)
  if (r.W || r.P) { buffer.push(am); while (buffer.length && agora - buffer[0].tWall > BUFFER_MS) buffer.shift(); }
  // latência (quadro → pose pronta) e período entre poses, para a sincronia da imagem
  if (r.P) {
    const lat = Math.max(0, agora - tCap);
    sinc.latMs = sinc.latMs == null ? lat : sinc.latMs * 0.85 + lat * 0.15;
    if (sinc.tCapAnt != null && tCap > sinc.tCapAnt) { const per = Math.min(1000, tCap - sinc.tCapAnt); sinc.perMs = sinc.perMs == null ? per : sinc.perMs * 0.85 + per * 0.15; }
    sinc.tCapAnt = tCap;
  }
  if (gravacao && (r.W || r.P)) {
    gravacao.amostras.push({ t: tS, W: Wl || Wf || r.W, Wbruto: r.W, P2, vis: am.vis, ex,
      atores: atores && atores.length > 1 ? atores.map((a) => ({ id: a.id, W: a.Wl || a.W, P2: a.P ? a.P.map((p) => (p ? { x: p.x / r.w, y: p.y / r.h, v: p.v } : null)) : null })) : null });
    if (r.w && r.h) gravacao.aspecto = r.w / r.h;
  }
  // o quadro (ImageData) fica só em ultimoQuadro: o retrato vai para o buffer (10 s) e não pode segurar pixels
  retrato = { ...r, img: null, Wf, Wl, P2, ex, atores, tWall: agora, tCap, sem: !r.P };
  am.ret = retrato;
  avisar();
}

// ------------------------------------------------------------------ pose no instante de um quadro
const lerp = (a, b, u) => a + (b - a) * u;
function misturarP(A, B, u, w, h) {
  if (!A || !B) return A || B;
  return A.map((a, k) => { const b = B[k]; if (!a || !b) return a || b; return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), v: Math.min(a.v, b.v) }; });
}
function misturarQ(A, B, u) {
  if (!A || !B) return A || B;
  return A.map((a, k) => { const b = B[k]; if (!a || !b) return a || b; return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)]; });
}
/** Uma amostra do buffer, interpolada (u entre 0 e 1) ou prevista (u > 1) entre a e b, no formato do retrato. */
function amostra(a, b, u, modo, tAlvo) {
  const ra = a.ret, rb = b.ret;
  if (!ra || !rb || ra.w !== rb.w || ra.h !== rb.h) { const r = (u < 0.5 ? a : b).ret; return r ? { ...r, modo, tAlvo } : null; }
  const perto = u < 0.5 ? ra : rb;
  return {
    ...perto, modo, tAlvo, u,
    t: lerp(ra.t, rb.t, u), tCap: lerp(a.tCap, b.tCap, u),
    P: misturarP(ra.P, rb.P, u),
    Wl: misturarQ(ra.Wl, rb.Wl, u), Wf: misturarQ(ra.Wf, rb.Wf, u), W: misturarQ(ra.W, rb.W, u),
  };
}
/**
 * A pose do instante `tAlvo` (relógio da página, o mesmo do ctx.tQuadro): interpolada entre as
 * duas poses vizinhas no buffer; depois da última, com `prever`, extrapolada pela velocidade (no
 * máximo `maxPrevMs`, amortecida) e com a correção suave quando chega pose nova. Sem buffer: null.
 */
export function poseEm(tAlvo, o = {}) {
  const n = buffer.length;
  if (!n || !Number.isFinite(tAlvo)) return retrato && !retrato.sem ? retrato : null;
  let i = n - 1;
  while (i >= 0 && !(buffer[i].tCap <= tAlvo)) i--;
  if (i < 0) return buffer[0].ret ? { ...buffer[0].ret, modo: 'primeira', tAlvo } : null;
  if (i < n - 1) {
    const a = buffer[i], b = buffer[i + 1], per = b.tCap - a.tCap;
    if (!(per > 0) || per > 500) return { ...(tAlvo - a.tCap < b.tCap - tAlvo ? a : b).ret, modo: 'vizinha', tAlvo };
    return amostra(a, b, (tAlvo - a.tCap) / per, 'interpolada', tAlvo);
  }
  // depois da última pose (pessoa sumiu: nada de esqueleto velho)
  if (retrato && retrato.sem) { previsao = null; return retrato; }
  const b = buffer[n - 1], dt = tAlvo - b.tCap;
  if (!o.prever || !cfgPrev.ligado || n < 2 || dt <= 0 || dt > 300) { previsao = null; return b.ret ? { ...b.ret, modo: 'ultima', tAlvo } : null; }
  const a = buffer[n - 2], per = b.tCap - a.tCap;
  if (!(per > 0) || per > 300 || !retrato || retrato.sem) { previsao = null; return b.ret ? { ...b.ret, modo: 'ultima', tAlvo } : null; }
  const prever = (A, B, t) => { const pr = B.tCap - A.tCap; const hh = Math.min(Math.max(0, t - B.tCap), cfgPrev.maxMs); return amostra(A, B, 1 + (cfgPrev.ganho * hh) / pr, 'prevista', t); };
  let s = prever(a, b, tAlvo);
  if (!s) return null;
  // correção suave: quando chega pose nova, a diferença entre a previsão VELHA e a nova, no MESMO
  // instante, é somada e se desfaz exponencialmente — o esqueleto não salta
  if (!previsao || previsao.b !== b) {
    let dP = null, dW = null;
    if (previsao && previsao.b && previsao.a && cfgPrev.corrMs > 0) {
      const v = prever(previsao.a, previsao.b, tAlvo);
      if (v && v.P && s.P) dP = s.P.map((p, k) => (p && v.P[k] ? [v.P[k].x - p.x, v.P[k].y - p.y] : null));
      if (v && v.Wl && s.Wl) dW = s.Wl.map((p, k) => (p && v.Wl[k] ? [v.Wl[k][0] - p[0], v.Wl[k][1] - p[1], v.Wl[k][2] - p[2]] : null));
    }
    previsao = { a, b, t0: tAlvo, dP, dW };
  }
  const k = cfgPrev.corrMs > 0 ? Math.exp(-(tAlvo - previsao.t0) / cfgPrev.corrMs) : 0;
  if (k > 0.02) {
    if (previsao.dP && s.P) s = { ...s, P: s.P.map((p, j) => (p && previsao.dP[j] ? { x: p.x + previsao.dP[j][0] * k, y: p.y + previsao.dP[j][1] * k, v: p.v } : p)) };
    if (previsao.dW && s.Wl) s = { ...s, Wl: s.Wl.map((p, j) => (p && previsao.dW[j] ? [p[0] + previsao.dW[j][0] * k, p[1] + previsao.dW[j][1] * k, p[2] + previsao.dW[j][2] * k] : p)) };
  }
  return s;
}

export const canalMotion = {
  publicar,
  poseEm,
  /** Previsão até o quadro exibido (câmera ao vivo): { ligado, ganho (0..1), maxMs, corrMs }. */
  configurarPrevisao(c) { cfgPrev = { ...cfgPrev, ...c }; previsao = null; },
  /** Latência (quadro → pose) e período entre poses, médias exponenciais (ms): o atraso da imagem. */
  sincronizacao: () => ({ latMs: sinc.latMs, perMs: sinc.perMs }),
  /** Tempo por etapa (ms, média exponencial): det, recorte, pose, levantar, retarget, desenho. */
  etapa(nome, ms) { if (Number.isFinite(ms)) etapas[nome] = etapas[nome] == null ? ms : etapas[nome] * 0.9 + ms * 0.1; },
  instantaneo: () => retrato,
  quadro: () => ultimoQuadro,
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  /** opc.precisaQuadro: o Studio sem canvas de exibição pede a cópia do quadro reduzido; com ele, não (economiza um clone por quadro). */
  definirStudio(v, opc = {}) { studio = Boolean(v); precisa = studio && opc.precisaQuadro !== false; if (!studio) ultimoQuadro = null; },
  studioAberto: () => studio,
  precisaQuadro: () => precisa,
  recente: (ms = 1500) => Boolean(retrato) && performance.now() - retrato.tWall < ms,
  /** Levantamento 2D→3D: { ligado, focal (× largura), inclinacao (graus | null = automática) }. */
  configurarLevantar(c) { cfgLev = { ...cfgLev, ...c }; zerarLev(); },
  levantar: () => ({ ...cfgLev }),
  /** Diagnóstico do levantamento do ator principal (contatos, inclinação, pernas fundidas, equilíbrio). */
  infoLevantar() { const l = levs.get('principal') || [...levs.values()][0]; return l ? l.info : null; },
  /** Filtro One Euro do robo (minCorte em Hz, beta). Mudar zera o estado do filtro. */
  configurarFiltro(c) { cfgFiltro = { ...cfgFiltro, ...c }; filtros = null; },
  filtro: () => ({ ...cfgFiltro }),
  /** Rate (poses/s), latência (mediana e p95, ms), histograma, buffer (amostras nos últimos 10 s). */
  estatisticas() {
    const iv = mediana(intervalos);
    const ls = latencias.slice().sort((a, b) => a - b);
    return {
      fps: iv ? 1000 / iv : 0,
      latMed: ls.length ? ls[Math.floor(ls.length / 2)] : null,
      latP95: ls.length ? ls[Math.min(ls.length - 1, Math.floor(ls.length * 0.95))] : null,
      historico: latencias.slice(),
      buffer: buffer.length,
      gravando: Boolean(gravacao),
      etapas: Object.fromEntries(Object.entries(etapas).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      sincronia: { latMs: sinc.latMs == null ? null : Math.round(sinc.latMs), perMs: sinc.perMs == null ? null : Math.round(sinc.perMs) },
      gravadas: gravacao ? gravacao.amostras.length : 0,
      inicioGravacao: gravacao ? gravacao.inicio : null,
    };
  },
  /** Começa a gravar a tomada (só landmarks). */
  gravar(fonte = 'Actor_Mocap') {
    gravacao = { id: novoId('tk'), inicio: performance.now(), tFonte0: tAnt, amostras: [], fonte, filtro: { ...cfgFiltro } };
    avisar(true);
  },
  /**
   * Para a gravação e devolve a tomada (trilha em fps fixo) ou null se curta demais. A trilha
   * gravada é a SUAVIZADA (o que se viu ao vivo); o bruto fica em `trilhaBruta`.
   */
  parar(fps = 30) {
    const g = gravacao;
    gravacao = null;
    avisar(true);
    if (!g || g.amostras.length < 5) return null;
    const r = reamostrar(g.amostras, fps);
    const rb = reamostrar(g.amostras.map((a) => ({ ...a, W: a.Wbruto })), fps);
    // quadros vazios nas pontas (pessoa ainda fora do quadro) saem da tomada
    const cheio = (q) => q.some(Boolean);
    let ini = 0, fim = r.trilha.length - 1;
    while (ini < fim && !cheio(r.trilha[ini])) ini++;
    while (fim > ini && !cheio(r.trilha[fim])) fim--;
    for (const x of [r, rb]) { x.trilha = x.trilha.slice(ini, fim + 1); x.p2d = x.p2d.slice(ini, fim + 1); x.extras = x.extras.slice(ini, fim + 1); }
    const conf = Array.from({ length: 33 }, (_, k) => {
      const vs = g.amostras.map((a) => (a.vis ? a.vis[k] : null)).filter((v) => Number.isFinite(v));
      return vs.length ? Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 1000) / 1000 : null;
    });
    // várias pessoas: uma trilha por ator (mesmo relógio da tomada), na posição relativa do piso
    let atores = null;
    const ids = [...new Set(g.amostras.flatMap((a) => (a.atores || []).map((x) => x.id)))];
    if (ids.length > 1) {
      atores = ids.map((id, k) => {
        const am = g.amostras.map((a) => { const x = (a.atores || []).find((y) => y.id === id); return { t: a.t, W: x ? x.W : null, P2: x ? x.P2 : null }; }).filter((a) => a.W);
        const ra = reamostrar(am.length ? am : [{ t: g.amostras[0].t, W: null }], fps);
        // alinha ao relógio da tomada (o ator pode entrar depois)
        const t0 = r.tempos.length ? g.amostras[0].t : 0, off = am.length ? Math.round((am[0].t - t0) / (1000 / fps)) - ini : 0;
        const trilha = Array.from({ length: r.trilha.length }, (_, i) => ra.trilha[i - off] || null);
        return { id, nome: `Ator ${k + 1}`, trilha };
      });
    }
    return { id: g.id, fps, trilha: r.trilha, trilhaBruta: rb.trilha, p2d: r.p2d, extras: r.extras.some(Boolean) ? r.extras : null, conf, origem: 'monocular', fonteId: g.fonte, filtro: g.filtro, amostras: g.amostras.length,
      aspecto: g.aspecto || null, levantada: cfgLev.ligado, atores };
  },
  cancelarGravacao() { gravacao = null; avisar(true); },
  /** Últimas amostras ao vivo (para o mini-gráfico e o "salvar os últimos 10 s"). */
  buffer: () => buffer.slice(),
  zerar() { buffer.length = 0; latencias.length = 0; intervalos.length = 0; tAnt = null; filtros = null; retrato = null; previsao = null; sinc = { latMs: null, perMs: null, tCapAnt: null }; zerarLev(); avisar(true); },
};
