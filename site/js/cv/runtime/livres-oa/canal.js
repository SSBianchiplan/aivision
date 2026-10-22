/**
 * cv/runtime/livres-oa/canal.js — canal entre os operadores da onda 1-a e o
 * painel «Medições» (components/MedicoesPanel.js).
 *
 * Os operadores (trafego.cvc, instrumento.*, seguranca.*, esportes.sprint,
 * cena.mapa_calor, logistica.*, midia.tempo_tela) rodam no laço de quadros a
 * até 60 Hz; o painel não pode reconciliar a cada quadro. Aqui cada operador
 * PUBLICA um instantâneo por chave e o painel é avisado no máximo a cada
 * 250 ms. Nada sai do navegador.
 *
 * «Zerar» de uma chave sobe a geração dela; o operador compara com a sua e
 * descarta o próprio estado no próximo quadro.
 */
import { tempoAgora } from '../../marcacoes.js';

const dados = new Map();      // chave → { ...instantâneo, t (performance.now) }
const geracoes = new Map();   // chave → número
const ouvintes = new Set();
let pendente = false;

function avisar() {
  if (pendente) return;
  pendente = true;
  setTimeout(() => {
    pendente = false;
    for (const fn of ouvintes) { try { fn(dados); } catch (e) { console.error('[medições]', e); } }
  }, 250);
}

/** Publica o instantâneo de uma medição (substitui o anterior da mesma chave). */
export function publicar(chave, obj) {
  dados.set(chave, { ...obj, t: performance.now() });
  avisar();
}

/** Último instantâneo (ou null). */
export function ler(chave) { return dados.get(chave) || null; }

/** Todas as chaves com dado. */
export function chaves() { return [...dados.keys()]; }

/** O operador ainda está publicando (escreveu nos últimos `ms`)? */
export function vivo(chave, ms = 3000) {
  const d = dados.get(chave);
  return Boolean(d && performance.now() - d.t < ms);
}

export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

/** Geração de «zerar» da chave. */
export function geracao(chave) { return geracoes.get(chave) || 0; }

/** Zera uma medição: o operador recomeça no próximo quadro. */
export function zerar(chave) {
  geracoes.set(chave, geracao(chave) + 1);
  dados.delete(chave);
  avisar();
}

/** O operador zera o estado quando a geração mudou. true = acabou de zerar. */
export function conferirGeracao(chave, state) {
  const g = geracao(chave);
  if (state.__ger === g) return false;
  state.__ger = g;
  return true;
}

/**
 * Instante do quadro em segundos: `ctx.tempoS` quando o hospedeiro (ou um
 * teste) informa; senão o tempo do VÍDEO (arquivo, preso ao quadro pelo
 * requestVideoFrameCallback) ou o relógio de parede — o mesmo do cronômetro
 * das Ferramentas de mouse.
 */
export function tempoDe(ctx) {
  if (ctx && Number.isFinite(ctx.tempoS)) return { t: ctx.tempoS, relogio: ctx.relogioS || 'video' };
  return tempoAgora();
}

// ------------------------------------------------------------------ utilitários de exportação

/** Campo de CSV (separador ;). */
export function campo(v) {
  const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csv(cab, linhas) {
  return [cab.join(';'), ...linhas.map((l) => l.map(campo).join(';'))].join('\n');
}

/** "hh:mm:ss" de um instante: relógio de parede → hora local; vídeo → tempo desde o início. */
export function hora(t, relogio) {
  if (!Number.isFinite(t)) return '—';
  if (relogio === 'real') return new Date(t * 1000).toLocaleTimeString('pt-BR', { hour12: false });
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s - h * 3600 - m * 60;
  return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`.replace('.', ',');
}
