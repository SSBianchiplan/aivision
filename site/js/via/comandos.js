/**
 * via/comandos.js — biblioteca de COMANDOS salvos: listas de classes, frases e
 * prompts prontos para os parâmetros de texto dos operadores que aceitam
 * comando (YOLOE, Florence-2, MobileCLIP, RF-DETR, SAM 2, Quadra…).
 *
 * Mesmo padrão de youtube/playlists.js: a interface lê `estado()` e escuta
 * `ouvir()`; hoje o armazenamento é o localStorage, por usuário logado (id de
 * /api/me) — para levar ao servidor basta trocar `ler()`/`gravar()`.
 *
 * ================= MODELO =================
 *
 *   { versao: 1,
 *     comandos: [{ id, nome, op, parametro, valor, categoria, descricao,
 *                  origem ('via' | 'manual' | 'coisas'), criadoEm }],
 *     categorias: [{ id, nome }] }          ← só as criadas pelo usuário
 *
 * A tabela CAMPOS_COMANDO diz QUAIS campos aceitam comando. É explícita de
 * propósito: há parâmetros de texto que NÃO são comando (calibração da Quadra,
 * identificador de modelo treinado, pontos do VBT) e um botão de IA neles só
 * estragaria a configuração.
 * ==========================================
 */

export const VERSAO = 1;
const PREFIXO = 'aivViaComandos:';
const MAX_COMANDOS = 500;
const MAX_CATEGORIAS = 60;
const MAX_NOME = 80;
const MAX_VALOR = 2000;
const MAX_DESCRICAO = 400;

/** Categorias padrão: os módulos do iaVision. */
export const CATEGORIAS_PADRAO = [
  { id: 'deteccao', nome: 'Detecção' },
  { id: 'vocabulario', nome: 'Vocabulário aberto' },
  { id: 'bikefit', nome: 'Bike Fit' },
  { id: 'corrida', nome: 'Corrida' },
  { id: 'industrial', nome: 'Industrial' },
  { id: 'quadra', nome: 'Quadra' },
  { id: 'esportes', nome: 'Esportes' },
  { id: 'outros', nome: 'Outros' },
];
export const CATEGORIA_PADRAO = 'outros';

/*
 * Campos que aceitam comando, por operador. `formato` e `idioma` vão para o
 * prompt da Via e para a dica ao lado do campo.
 *   lista   classes separadas por vírgula
 *   frases  frases curtas separadas por vírgula
 *   frase   uma frase / expressão só
 *   molde   molde com {} no lugar da classe
 */
export const CAMPOS_COMANDO = {
  'yoloe.prompt': {
    classes: { formato: 'lista', idioma: 'inglês', categoria: 'vocabulario',
      dica: 'Cada termo vira uma classe na hora, sem treino. Inglês, nomes concretos e visuais ("red helmet", "open door"); 1–3 palavras por termo; até ~20 termos.' },
  },
  'yoloe.detect': {
    filtro: { formato: 'lista', idioma: 'inglês', categoria: 'vocabulario',
      dica: 'FILTRO sobre o vocabulário fixo de 4.585 classes (LVIS + Objects365). Só nomes que existem no vocabulário aparecem; vazio = tudo.' },
  },
  'florence2.tarefa': {
    texto: { formato: 'frase', idioma: 'inglês', categoria: 'vocabulario', max: 120,
      dica: 'Usado na tarefa «achar o que eu escrever» (grounding): uma expressão curta em inglês ("a person wearing a helmet").' },
  },
  'clip.classify': {
    classes: { formato: 'frases', idioma: 'inglês', categoria: 'vocabulario',
      dica: 'Rótulos do zero-shot (MobileCLIP2), separados por vírgula, em inglês. Cada um entra no molde (ex.: "a photo of {}"). Inclua uma classe de contraste ("an empty room").' },
    modelo: { formato: 'molde', idioma: 'inglês', categoria: 'vocabulario',
      dica: 'Molde da frase com {} no lugar da classe, em inglês: "a photo of {}", "a close-up photo of {} on a conveyor".' },
  },
  'rfdetr.detect': {
    classes: { formato: 'lista', idioma: 'português (nomes do COCO)', categoria: 'deteccao', max: 300,
      dica: 'Filtro por nome entre as 80 classes do COCO, nos nomes em português do iaVision (pessoa, carro, caminhão…); vazio = todas.' },
  },
  'sam2.seguir': {
    classe: { formato: 'classe', idioma: 'o da detecção da cadeia', categoria: 'deteccao', max: 60,
      dica: 'UMA classe (trecho do nome) da detecção que vem antes na cadeia; vazio = qualquer. Detectores do COCO usam nomes em português.' },
  },
  'quadra.analise': {
    classesJogador: { formato: 'lista', idioma: 'misto (pt + en)', categoria: 'quadra', max: 200,
      dica: 'Nomes de classe que contam como JOGADOR (trecho do nome, pt e en juntos funcionam: "pessoa, person, player").' },
    classesBola: { formato: 'lista', idioma: 'misto (pt + en)', categoria: 'quadra', max: 120,
      dica: 'Nomes de classe que contam como BOLA ("bola, sports ball, ball").' },
  },
};

/** Nunca é comando, mesmo se o nome parecer (dados técnicos preenchidos pelo app). */
const NUNCA = /calib|^modelo$|vertical|ponto|pontos|^id$|url|caminho|json|token|chave/i;
/** Heurística para operadores novos (ex.: Industrial) que ainda não estão na tabela. */
const PARECE = /classe|classes|filtro|texto|prompt|frase|rotulo|rótulo|consulta|pergunta|alvo/i;

/** Info do campo (da tabela ou da heurística) ou null se não aceita comando. */
export function infoCampo(op, parametro, schema = null) {
  const t = CAMPOS_COMANDO[op] && CAMPOS_COMANDO[op][parametro];
  if (t) return t;
  if (!schema || schema.type !== 'text') return null;
  if (NUNCA.test(parametro) || !PARECE.test(parametro)) return null;
  return { formato: 'lista', idioma: 'inglês', categoria: 'outros', dica: schema.label || parametro };
}

export function aceitaComando(op, parametro, schema = null) {
  return Boolean(infoCampo(op, parametro, schema));
}

// ------------------------------------------------------------ armazenamento

let usuario = 'anon';
let dados = null;
const ouvintes = new Set();

const vazio = () => ({ versao: VERSAO, comandos: [], categorias: [] });
const chave = () => PREFIXO + usuario;
const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const linha = (v, max) => texto(v, max).replace(/\s+/g, ' ');

function novoId(p) {
  try { if (crypto.randomUUID) return p + crypto.randomUUID().slice(0, 13); } catch (_) { /* sem crypto */ }
  return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ler() {
  try {
    const bruto = localStorage.getItem(chave());
    return bruto ? normalizar(JSON.parse(bruto)) : vazio();
  } catch (_) {
    return vazio();
  }
}

function gravar(novo) {
  dados = novo;
  try {
    localStorage.setItem(chave(), JSON.stringify(novo));
  } catch (_) {
    avisar();
    throw new Error('Não foi possível gravar os comandos neste navegador (armazenamento cheio ou bloqueado).');
  }
  avisar();
}

function avisar() { for (const fn of ouvintes) { try { fn(dados); } catch (_) { /* ouvinte ruim */ } } }
function atual() { if (!dados) dados = ler(); return dados; }

/** Aceita qualquer coisa (o gravado, um JSON importado) e devolve um objeto válido. */
function normalizar(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const categorias = [];
  const idsCat = new Set(CATEGORIAS_PADRAO.map((c) => c.id));
  for (const c of Array.isArray(o.categorias) ? o.categorias : []) {
    if (!c || typeof c !== 'object' || categorias.length >= MAX_CATEGORIAS) continue;
    const nome = linha(c.nome, MAX_NOME);
    const id = linha(c.id, 40);
    if (!nome || !id || idsCat.has(id)) continue;
    idsCat.add(id);
    categorias.push({ id, nome });
  }
  const comandos = [];
  const ids = new Set();
  for (const c of Array.isArray(o.comandos) ? o.comandos : []) {
    const n = normalizarComando(c, idsCat);
    if (!n || comandos.length >= MAX_COMANDOS) continue;
    if (ids.has(n.id)) n.id = novoId('c-');
    ids.add(n.id);
    comandos.push(n);
  }
  return { versao: VERSAO, comandos, categorias };
}

function normalizarComando(c, idsCat) {
  if (!c || typeof c !== 'object') return null;
  const nome = linha(c.nome, MAX_NOME);
  const op = linha(c.op, 60);
  const parametro = linha(c.parametro, 40);
  const valor = texto(c.valor, MAX_VALOR);
  if (!nome || !/^[\w.-]+$/.test(op) || !/^\w+$/.test(parametro)) return null;
  return {
    id: linha(c.id, 40) || novoId('c-'),
    nome, op, parametro, valor,
    categoria: idsCat.has(c.categoria) ? c.categoria : CATEGORIA_PADRAO,
    descricao: texto(c.descricao, MAX_DESCRICAO),
    origem: ['via', 'manual', 'coisas'].includes(c.origem) ? c.origem : 'manual',
    criadoEm: Number(c.criadoEm) || Date.now(),
  };
}

// ------------------------------------------------------------ leitura

export function definirUsuario(id) {
  const u = id == null || id === '' ? 'anon' : String(id).replace(/[^\w.@-]/g, '').slice(0, 64) || 'anon';
  if (u === usuario && dados) return;
  usuario = u;
  dados = ler();
  avisar();
}

export function estado() { return atual(); }
export function ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

/** Comandos, opcionalmente filtrados por operador e parâmetro; mais novos primeiro. */
export function listarComandos({ op = null, parametro = null, categoria = null } = {}) {
  return atual().comandos
    .filter((c) => (!op || c.op === op) && (!parametro || c.parametro === parametro) && (!categoria || c.categoria === categoria))
    .sort((a, b) => b.criadoEm - a.criadoEm);
}

export function listarCategorias() {
  return [
    ...CATEGORIAS_PADRAO.map((c) => ({ ...c, propria: false })),
    ...atual().categorias.map((c) => ({ ...c, propria: true })),
  ];
}

export function nomeCategoria(id) {
  const c = listarCategorias().find((x) => x.id === id);
  return c ? c.nome : 'Outros';
}

// ------------------------------------------------------------ escrita

/**
 * Salva (ou atualiza, se `id` existir). Mesmo nome + operador + parâmetro
 * substitui o anterior em vez de duplicar. Devolve o comando gravado.
 */
export function salvarComando(c) {
  const d = atual();
  const idsCat = new Set(listarCategorias().map((x) => x.id));
  const n = normalizarComando({ ...c, criadoEm: c.criadoEm || Date.now() }, idsCat);
  if (!n) throw new Error('Comando inválido: falta nome, operador ou parâmetro.');
  const lista = [...d.comandos];
  const i = lista.findIndex((x) => x.id === c.id
    || (x.nome.toLowerCase() === n.nome.toLowerCase() && x.op === n.op && x.parametro === n.parametro));
  if (i >= 0) { n.id = lista[i].id; lista[i] = n; } else {
    if (lista.length >= MAX_COMANDOS) throw new Error(`Limite de ${MAX_COMANDOS} comandos atingido.`);
    lista.push(n);
  }
  gravar({ ...d, comandos: lista });
  return n;
}

export function apagarComando(id) {
  const d = atual();
  gravar({ ...d, comandos: d.comandos.filter((c) => c.id !== id) });
}

export function criarCategoria(nome) {
  const d = atual();
  const n = linha(nome, MAX_NOME);
  if (!n) throw new Error('Dê um nome à categoria.');
  const existente = listarCategorias().find((c) => c.nome.toLowerCase() === n.toLowerCase());
  if (existente) return existente;
  if (d.categorias.length >= MAX_CATEGORIAS) throw new Error('Limite de categorias atingido.');
  const c = { id: novoId('k-'), nome: n };
  gravar({ ...d, categorias: [...d.categorias, c] });
  return c;
}

export function apagarCategoria(id) {
  const d = atual();
  gravar({
    ...d,
    categorias: d.categorias.filter((c) => c.id !== id),
    comandos: d.comandos.map((c) => (c.categoria === id ? { ...c, categoria: CATEGORIA_PADRAO } : c)),
  });
}

// ------------------------------------------------------------ exportar / importar

/** JSON da biblioteca. Só comandos e categorias — nunca a chave nem a conversa. */
export function exportarJSON() {
  const d = atual();
  return JSON.stringify({ tipo: 'iavision-comandos', versao: VERSAO, exportadoEm: new Date().toISOString(),
    comandos: d.comandos, categorias: d.categorias }, null, 2);
}

/** Junta um JSON exportado à biblioteca atual. Devolve { novos, atualizados, ignorados }. */
export function importarJSON(txt) {
  let obj;
  try { obj = JSON.parse(String(txt || '')); } catch (_) { throw new Error('Arquivo não é JSON válido.'); }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.comandos)) throw new Error('Este JSON não é uma biblioteca de comandos do iaVision.');
  const entrada = normalizar(obj);
  const d = atual();
  const categorias = [...d.categorias];
  for (const c of entrada.categorias) if (!categorias.some((x) => x.id === c.id) && categorias.length < MAX_CATEGORIAS) categorias.push(c);
  const lista = [...d.comandos];
  let novos = 0, atualizados = 0;
  for (const c of entrada.comandos) {
    const i = lista.findIndex((x) => x.nome.toLowerCase() === c.nome.toLowerCase() && x.op === c.op && x.parametro === c.parametro);
    if (i >= 0) { lista[i] = { ...c, id: lista[i].id }; atualizados++; } else if (lista.length < MAX_COMANDOS) { lista.push(c); novos++; }
  }
  gravar({ ...d, comandos: lista, categorias });
  return { novos, atualizados, ignorados: obj.comandos.length - novos - atualizados };
}
