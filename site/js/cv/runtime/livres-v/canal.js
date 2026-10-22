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
let cfgLev = { ligado: true, focal: 1.0, inclinacao: null };
const levs = new Map();
let refRaiz = null;
function levantador(id, multi) {
  let l = levs.get(id);
  if (!l) { l = new Levantador({ focal: cfgLev.focal, inclinacao: cfgLev.inclinacao, raiz: !multi }); levs.set(id, l); }
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
  const Wl = levantarAtor(idPri, r, r.P, r.W, tS, multi);
  let atores = null;
  if (Array.isArray(r.atores) && r.atores.length) {
    atores = r.atores.map((a, k) => ({ ...a, Wl: k === 0 ? Wl : levantarAtor(a.id, r, a.P, a.W, tS, multi), cor: k }));
    for (const id of [...levs.keys()]) if (id !== 'principal' && !r.atores.some((a) => a.id === id)) levs.delete(id);
  }
  const am = { t: tS, tWall: agora, W: r.W || null, Wf, Wl, P2, vis: r.P ? r.P.map((p) => (p ? p.v : 0)) : null, ex };
  if (r.W || r.P) { buffer.push(am); while (buffer.length && agora - buffer[0].tWall > BUFFER_MS) buffer.shift(); }
  if (gravacao && (r.W || r.P)) {
    gravacao.amostras.push({ t: tS, W: Wl || Wf || r.W, Wbruto: r.W, P2, vis: am.vis, ex,
      atores: atores && atores.length > 1 ? atores.map((a) => ({ id: a.id, W: a.Wl || a.W, P2: a.P ? a.P.map((p) => (p ? { x: p.x / r.w, y: p.y / r.h, v: p.v } : null)) : null })) : null });
    if (r.w && r.h) gravacao.aspecto = r.w / r.h;
  }
  retrato = { ...r, Wf, Wl, P2, ex, atores, tWall: agora, sem: !r.P };
  avisar();
}

export const canalMotion = {
  publicar,
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
  zerar() { buffer.length = 0; latencias.length = 0; intervalos.length = 0; tAnt = null; filtros = null; retrato = null; zerarLev(); avisar(true); },
};
