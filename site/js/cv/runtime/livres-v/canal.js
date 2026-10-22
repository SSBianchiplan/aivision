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

const BUFFER_MS = 10000;
const HIST = 120;

const ouvintes = new Set();
let retrato = null, ultimoQuadro = null, studio = false, timer = null, ultimoAviso = 0;
let filtros = null, cfgFiltro = { ligado: true, minCorte: 1.2, beta: 0.4 };
const buffer = [];          // { t, tWall, W, Wf, P2, vis }
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
  if (tAnt != null && tS < tAnt - 50) { filtros = null; tAnt = null; }      // vídeo voltou: recomeça o filtro
  const Wf = filtrar(r.W, tS);
  if (tAnt != null && tS > tAnt) { intervalos.push(tS - tAnt); if (intervalos.length > HIST) intervalos.shift(); }
  tAnt = tS;
  if (Number.isFinite(r.latMs)) { latencias.push(r.latMs); if (latencias.length > HIST) latencias.shift(); }
  const P2 = r.P && r.w ? r.P.map((p) => (p ? { x: p.x / r.w, y: p.y / r.h, v: p.v } : null)) : null;
  const am = { t: tS, tWall: agora, W: r.W || null, Wf, P2, vis: r.P ? r.P.map((p) => (p ? p.v : 0)) : null };
  if (r.W || r.P) { buffer.push(am); while (buffer.length && agora - buffer[0].tWall > BUFFER_MS) buffer.shift(); }
  if (gravacao && (r.W || r.P)) gravacao.amostras.push({ t: tS, W: Wf || r.W, Wbruto: r.W, P2, vis: am.vis });
  retrato = { ...r, Wf, P2, tWall: agora, sem: !r.P };
  avisar();
}

export const canalMotion = {
  publicar,
  instantaneo: () => retrato,
  quadro: () => ultimoQuadro,
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  definirStudio(v) { studio = Boolean(v); if (!studio) ultimoQuadro = null; },
  studioAberto: () => studio,
  recente: (ms = 1500) => Boolean(retrato) && performance.now() - retrato.tWall < ms,
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
    for (const x of [r, rb]) { x.trilha = x.trilha.slice(ini, fim + 1); x.p2d = x.p2d.slice(ini, fim + 1); }
    const conf = Array.from({ length: 33 }, (_, k) => {
      const vs = g.amostras.map((a) => (a.vis ? a.vis[k] : null)).filter((v) => Number.isFinite(v));
      return vs.length ? Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 1000) / 1000 : null;
    });
    return { id: g.id, fps, trilha: r.trilha, trilhaBruta: rb.trilha, p2d: r.p2d, conf, origem: 'monocular', fonteId: g.fonte, filtro: g.filtro, amostras: g.amostras.length };
  },
  cancelarGravacao() { gravacao = null; avisar(true); },
  /** Últimas amostras ao vivo (para o mini-gráfico e o "salvar os últimos 10 s"). */
  buffer: () => buffer.slice(),
  zerar() { buffer.length = 0; latencias.length = 0; intervalos.length = 0; tAnt = null; filtros = null; retrato = null; avisar(true); },
};
