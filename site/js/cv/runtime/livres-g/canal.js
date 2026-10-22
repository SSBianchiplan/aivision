/**
 * cv/runtime/livres-g/canal.js — ponte entre o operador Academia e o painel.
 *
 * O executor não expõe o ctx do quadro a ninguém fora da cadeia, então o
 * operador publica aqui um retrato do que mediu (a cada inferência) e o
 * painel assina. O TREINO (repetições, séries, registro) também mora aqui, e
 * não no estado do nó: "Novo treino" no painel precisa zerá-lo, e apagar ou
 * recriar o nó no Pipeline não deve jogar fora um treino gravado.
 *
 * O bipe por repetição também mora aqui: um AudioContext só, criado no
 * primeiro uso (o navegador só deixa tocar depois de um gesto na página —
 * o painel chama destravarSom() no clique).
 */
import { Treino } from './academia.js';

const treino = new Treino();
const ouvintes = new Set();
let retrato = null;
let gravando = true;
let geracao = 0;
let timer = null;
let ultimoAviso = 0;

export function obterTreino() { return treino; }
export function estaGravando() { return gravando; }
export function geracaoTreino() { return geracao; }
export function instantaneo() { return retrato; }

/** O operador chama a cada inferência; o painel é avisado no máximo a cada 250 ms. */
export function publicar(r) {
  retrato = r;
  avisar();
}

function avisar(ja = false) {
  const chamar = () => { for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } } };
  if (ja) { ultimoAviso = performance.now(); chamar(); return; }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => { timer = null; ultimoAviso = performance.now(); chamar(); }, espera);
}

export function assinar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function zerarTreino() {
  treino.zerar();
  geracao++;
  gravando = true;
  if (retrato) retrato = { ...retrato, feedback: null, alertasVivos: [], fase: null, ex: null };
  avisar(true);
}

/** Fecha a série aberta agora (botão do painel), sem esperar a pausa. */
export function fecharSerieAgora() {
  const s = treino.fecharSerie(treino.tUlt);
  avisar(true);
  return s;
}

export function definirGravando(v) {
  gravando = Boolean(v);
  avisar(true);
}

// -------------------------------------------------------------- som

let actx = null;
export function destravarSom() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    if (!actx) actx = new AC();
    if (actx.state === 'suspended') actx.resume();
    return true;
  } catch (_) { return false; }
}

/** Bipe curto: agudo para repetição boa, dois graves para repetição com alerta, três para série fechada. */
export function bipe(tipo = 'boa') {
  if (!destravarSom() || !actx || actx.state !== 'running') return;
  const notas = tipo === 'boa' ? [[880, 0]] : tipo === 'serie' ? [[660, 0], [880, 0.16], [1100, 0.32]] : [[330, 0], [330, 0.17]];
  const t0 = actx.currentTime + 0.01;
  for (const [f, dt] of notas) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + dt);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.13);
    o.connect(g); g.connect(actx.destination);
    o.start(t0 + dt); o.stop(t0 + dt + 0.15);
  }
}
