/**
 * via/base.js — o pedaço LEVE da Via (assistente de IA): chave, preferências,
 * dono dos dados e o pedido de abertura vindo de outros painéis.
 *
 * Este arquivo é importado estaticamente (Config, editor de parâmetros), então
 * não pode puxar o SDK nem o chat. O resto mora em via/ViaPainel.js e
 * via/cliente.js, que só carregam quando a Via abre.
 *
 * ===================== A CHAVE É DO USUÁRIO =====================
 *
 *   - Fica SÓ no navegador: localStorage («lembrar neste aparelho») ou
 *     sessionStorage («só nesta sessão», some ao fechar a aba).
 *   - Vai direto do navegador para api.anthropic.com. Nunca passa pelos
 *     nossos servidores, nunca entra em log/console, nunca vai em exportação
 *     (a biblioteca de comandos exporta só comandos).
 *   - Quem usar este navegador (e esta conta do iaVision) pode usá-la — a UI
 *     diz isso com todas as letras.
 *   - Separada por usuário logado, como as playlists: contas diferentes no
 *     mesmo navegador não compartilham chave nem comandos.
 * ================================================================
 */

import { store, persist } from '../state/store.js';
import { definirUsuario as comandosDoUsuario } from './comandos.js';

/** Modelos oferecidos. A escolha é do usuário; o padrão é o Opus 5.5. */
export const MODELOS = [
  { id: 'claude-opus-5-5', nome: 'Opus 5.5', dica: 'o mais capaz — padrão', preco: 'US$ 4 / 20 por milhão de tokens (entrada/saída)', fallback: true },
  { id: 'claude-sonnet-5-5', nome: 'Sonnet 5.5', dica: 'mais rápido e mais barato', preco: 'US$ 2 / 10 por milhão de tokens', fallback: true },
  { id: 'claude-haiku-5-5', nome: 'Haiku 5.5', dica: 'o mais rápido e o mais barato', preco: 'US$ 0,10 / 0,50 por milhão de tokens', fallback: false },
];
export const MODELO_PADRAO = 'claude-opus-5-5';

export const ESFORCOS = [
  { id: 'low', nome: 'baixo', dica: 'respostas rápidas e curtas' },
  { id: 'medium', nome: 'médio', dica: 'equilíbrio — padrão' },
  { id: 'high', nome: 'alto', dica: 'pensa mais antes de responder (mais lento e caro)' },
];
export const ESFORCO_PADRAO = 'medium';

const PREFIXO_CHAVE = 'aiv.via.chave:';
const PREFIXO_CFG = 'aiv.via.cfg:';

let usuario = 'anon';
const ouvintes = new Set();

function avisar() { for (const fn of ouvintes) { try { fn(); } catch (_) { /* ouvinte ruim */ } } }

/** Escuta mudanças de chave/preferências/usuário. Devolve a função que desliga. */
export function ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

/** Troca o dono (id de /api/me). Chamado pelo workspace junto com as playlists. */
export function definirUsuario(id) {
  const u = id == null || id === '' ? 'anon' : String(id).replace(/[^\w.@-]/g, '').slice(0, 64) || 'anon';
  comandosDoUsuario(id);     // a biblioteca de comandos é do mesmo dono
  if (u === usuario) return;
  usuario = u;
  avisar();
}
export function usuarioAtual() { return usuario; }

// ------------------------------------------------------------ chave

const ler = (st, k) => { try { return st.getItem(k); } catch (_) { return null; } };

/** A chave em uso (ou ''). Só o cliente da Via deve chamar isto. */
export function obterChave() {
  const k = PREFIXO_CHAVE + usuario;
  return ler(sessionStorage, k) || ler(localStorage, k) || '';
}

/** Onde a chave está: 'aparelho' | 'sessao' | null. */
export function ondeEstaChave() {
  const k = PREFIXO_CHAVE + usuario;
  if (ler(sessionStorage, k)) return 'sessao';
  if (ler(localStorage, k)) return 'aparelho';
  return null;
}

export function temChave() { return Boolean(obterChave()); }

/** Formato da chave da Anthropic. Não prova que vale — o «Testar» prova. */
export function pareceChave(txt) { return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(txt || '').trim()); }

/** Mostra só o começo e o fim: «sk-ant-…a1B2». */
export function mascarar(chave) {
  const c = String(chave || '');
  return c.length > 14 ? `${c.slice(0, 7)}…${c.slice(-4)}` : '••••';
}

/**
 * Grava a chave. `lembrar`: true → localStorage (fica no aparelho);
 * false → sessionStorage (some ao fechar a aba). Grava num lugar e apaga do outro.
 */
export function gravarChave(chave, lembrar) {
  const c = String(chave || '').trim();
  if (!c) throw new Error('Cole a chave.');
  const k = PREFIXO_CHAVE + usuario;
  try {
    if (lembrar) { localStorage.setItem(k, c); sessionStorage.removeItem(k); }
    else { sessionStorage.setItem(k, c); localStorage.removeItem(k); }
  } catch (_) {
    throw new Error('Este navegador não deixou gravar (modo privado ou armazenamento bloqueado).');
  }
  avisar();
}

export function apagarChave() {
  const k = PREFIXO_CHAVE + usuario;
  try { localStorage.removeItem(k); } catch (_) { /* ignora */ }
  try { sessionStorage.removeItem(k); } catch (_) { /* ignora */ }
  avisar();
}

// ------------------------------------------------------------ preferências

export function lerPreferencias() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREFIXO_CFG + usuario) || '{}') || {}; } catch (_) { p = {}; }
  return {
    modelo: MODELOS.some((m) => m.id === p.modelo) ? p.modelo : MODELO_PADRAO,
    esforco: ESFORCOS.some((e) => e.id === p.esforco) ? p.esforco : ESFORCO_PADRAO,
    // «Salvar conversas no servidor da GPlanSiS» (aivision-via): ligado por padrão; texto, comandos e
    // metadados das imagens — nunca a chave nem a imagem. O usuário vê e apaga tudo na aba Base.
    salvarServidor: p.salvarServidor !== false,
  };
}

export function gravarPreferencias(parcial) {
  const p = { ...lerPreferencias(), ...parcial };
  try { localStorage.setItem(PREFIXO_CFG + usuario, JSON.stringify(p)); } catch (_) { /* segue sem persistir */ }
  avisar();
}

export function modeloInfo(id) { return MODELOS.find((m) => m.id === id) || MODELOS[0]; }

// ------------------------------------------------------------ abrir a Via

let pendente = null;
const ouvintesPedido = new Set();

/**
 * Abre a Via, opcionalmente com contexto (ex.: o campo do Pipeline que pediu
 * ajuda). O painel consome o contexto ao montar ou, se já está aberto, na hora.
 *   contexto = { op, parametro, valor, rotulo, nodeId, texto }
 */
export function pedirVia(contexto = null) {
  pendente = contexto;
  const st = store.get();
  if (!st.panels.via) { store.set({ panels: { ...st.panels, via: true } }); persist(); }
  for (const fn of ouvintesPedido) { try { fn(); } catch (_) { /* ignora */ } }
}

/** Retira o contexto pendente (uma vez só). */
export function consumirPedido() { const c = pendente; pendente = null; return c; }
export function ouvirPedidos(fn) { ouvintesPedido.add(fn); return () => ouvintesPedido.delete(fn); }

export function alternarVia() {
  const st = store.get();
  store.set({ panels: { ...st.panels, via: !st.panels.via } });
  persist();
}
