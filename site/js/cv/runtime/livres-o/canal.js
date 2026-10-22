/**
 * cv/runtime/livres-o/canal.js — o motor do OEE (CV-46) e a ponte com as telas.
 *
 * O operador maquina.estado (operators/livres-o/maquina.js) mede o movimento
 * nas ROIs e entrega as amostras aqui; o motor (runtime/livres-o/oee.js) guarda
 * a sessão: intervalos de estado por máquina, motivos de parada, produção,
 * eventos e alarmes. O painel e a tela cheia GPlanSiS|OEE assinam o retrato
 * (no máximo 4×/s). A sessão mora aqui, e não no estado do nó: apagar e
 * recriar o nó no Pipeline não joga fora o turno medido.
 *
 * Configuração em localStorage 'aiv.oee.cfg' (parâmetros da histerese, ciclo
 * ideal, motivos, turnos e pausas, alarmes). Nada da imagem é guardado.
 */
import { MotorOEE, normalizar, ROTULO, ESTADOS, COR, MOTIVOS_PADRAO, SEM_MOTIVO, PARAMS_PADRAO } from './oee.js';

const CHAVE = 'aiv.oee.cfg';

function lerCfg() {
  try {
    const o = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (o && o.versao === 1) return normalizar(o);
  } catch (_) { /* storage bloqueado ou JSON ruim */ }
  return normalizar({});
}

const motor = new MotorOEE(lerCfg());
let cfgSalva = JSON.stringify(motor.cfg);

export function obterMotor() { return motor; }

export function salvarCfg() {
  const s = JSON.stringify(motor.cfg);
  if (s === cfgSalva) return;
  cfgSalva = s;
  try { localStorage.setItem(CHAVE, s); } catch (_) { /* sem espaço */ }
}

let retrato = null;
let quadro = null;
let studio = false;
let ultimoMs = 0;
const ouvintes = new Set();
let timer = null, ultimoAviso = 0;

/** O operador chama a cada amostra. `img`: cópia do quadro (só com a tela cheia aberta). */
export function publicar(r, img) {
  retrato = r;
  if (img) quadro = img;
  ultimoMs = performance.now();
  avisar();
}
export function instantaneo() { return retrato; }
export function ultimoQuadro() { return quadro; }
export function recente(ms = 3000) { return Boolean(retrato) && performance.now() - ultimoMs < ms; }
export function definirStudio(v) { studio = Boolean(v); }
export function studioAberto() { return studio; }

function avisar(ja = false) {
  const chamar = () => { ultimoAviso = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } } };
  if (ja) { if (timer) { clearTimeout(timer); timer = null; } chamar(); return; }
  if (timer) return;
  timer = setTimeout(() => { timer = null; chamar(); }, Math.max(0, 250 - (performance.now() - ultimoAviso)));
}
export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function avisarAgora() { salvarCfg(); avisar(true); }

/** Nova sessão: zera intervalos, produção, eventos e alarmes (a configuração fica). */
export function novaSessao() {
  motor.reiniciar();
  retrato = retrato ? { ...retrato, maquinas: (retrato.maquinas || []).map((m) => ({ ...m, estado: null, desde: null })) } : null;
  avisar(true);
}

export { ROTULO, ESTADOS, COR, MOTIVOS_PADRAO, SEM_MOTIVO, PARAMS_PADRAO, normalizar };
