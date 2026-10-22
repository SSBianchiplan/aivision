/**
 * cv/runtime/livres-s/precos.js — AUDITORIA DE PREÇO de gôndola (V3), sem DOM:
 *
 *   lerTabelaCSV     a tabela do sistema que o usuário importa (código/EAN,
 *                    descrição, preço), com ; ou , ou tab, cabeçalho em
 *                    português ou inglês e preço pt-BR ("R$ 1.234,56").
 *   precosNoTexto    preços de uma linha de OCR ("R$ 4,99", "4,99", "4.99").
 *   agruparEtiquetas cada PREÇO lido é a âncora de uma etiqueta; textos e
 *                    códigos de barras próximos (em alturas da âncora) entram
 *                    nela; o preço principal é o de fonte maior.
 *   conferir         casa a etiqueta com a tabela pelo EAN (exato) ou pela
 *                    descrição (Dice de palavras) e compara o preço.
 *
 * A tabela fica só neste navegador (localStorage); nada sai.
 */
import { numeroBR } from './comum.js';

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const normalizarCodigo = (c) => String(c || '').replace(/\D/g, '').replace(/^0+(?=\d{8})/, '');

/** Palavras significativas de uma descrição (sem acento, sem "de/da/kg" soltos). */
const PARADAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'p', 'c', 'un', 'und', 'r']);
export function palavras(s) {
  return semAcento(s).replace(/(\d)[,.](\d)/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter((x) => x && !PARADAS.has(x) && !(x.length === 1 && !/\d/.test(x)));
}

/** Coeficiente de Dice entre os conjuntos de palavras (0–1). */
export function similaridade(a, b) {
  const A = new Set(palavras(a)), B = new Set(palavras(b));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}

const COLS = {
  codigo: /^(c[oó]d(igo)?|ean|gtin|sku|barras|cod\.? ?barras|plu|code|id)$/i,
  descricao: /^(descri[cç][aã]o|produto|nome|item|description|desc)$/i,
  preco: /^(pre[cç]o|valor|pre[cç]o ?venda|pv|price|r\$)$/i,
};

/** Separa uma linha de CSV respeitando aspas. */
function campos(linha, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (q) { if (ch === '"') { if (linha[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/**
 * CSV → { itens: [{ codigo, descricao, preco }], erros: [texto], colunas }.
 * Separador: o mais frequente entre ; , e tab na 1ª linha. Sem cabeçalho
 * reconhecível, assume código;descrição;preço.
 */
export function lerTabelaCSV(texto) {
  const linhas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { itens: [], erros: ['arquivo vazio'], colunas: null };
  const conta = (s, c) => s.split(c).length - 1;
  const l0 = linhas[0];
  const sep = [';', '\t', ','].sort((a, b) => conta(l0, b) - conta(l0, a))[0];
  let cab = campos(l0, sep).map((x) => semAcento(x).replace(/\s+/g, ' ').trim());
  let ix = { codigo: cab.findIndex((c) => COLS.codigo.test(c)), descricao: cab.findIndex((c) => COLS.descricao.test(c)), preco: cab.findIndex((c) => COLS.preco.test(c)) };
  let ini = 1;
  if (ix.preco < 0) { ix = { codigo: 0, descricao: 1, preco: 2 }; ini = 0; }
  const itens = [], erros = [];
  for (let i = ini; i < linhas.length; i++) {
    const f = campos(linhas[i], sep);
    const preco = numeroBR(f[ix.preco]);
    const codigo = ix.codigo >= 0 ? normalizarCodigo(f[ix.codigo]) : '';
    const descricao = ix.descricao >= 0 ? (f[ix.descricao] || '') : '';
    if (!Number.isFinite(preco)) { erros.push(`linha ${i + 1}: preço "${f[ix.preco] ?? ''}" ilegível`); continue; }
    if (!codigo && !descricao) { erros.push(`linha ${i + 1}: sem código nem descrição`); continue; }
    itens.push({ codigo, descricao, preco });
  }
  return { itens, erros, colunas: ix };
}

/** Preços numa linha de OCR: [{ valor, rs (tinha R$) }]. Aceita "R$4,99", "4,99", "R$ 12.90", "1.299,00". */
export function precosNoTexto(s) {
  const out = [];
  const re = /(R\s?\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d{1,5}[,.]\d{2})(?!\d)/gi;
  let m;
  while ((m = re.exec(String(s || '')))) {
    const v = numeroBR(m[2]);
    if (Number.isFinite(v) && v > 0) out.push({ valor: v, rs: Boolean(m[1]) });
  }
  return out;
}

const centro = (b) => [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];

/**
 * Agrupa as leituras em etiquetas. textos: [{ text, score, x1..y2 (0–1) }],
 * codigos: [{ text, format, box: {x,y,w,h} }] (0–1). aspecto = largura/altura do quadro.
 * o = { raio (alturas da âncora), minimo (preço mínimo) }.
 * Devolve [{ preco, precoTexto, codigo, descricao, caixa, conf }].
 */
export function agruparEtiquetas(textos, codigos, aspecto = 16 / 9, o = {}) {
  const raio = o.raio ?? 6;
  const ancoras = [];
  const outros = [];
  for (const t of textos || []) {
    const ps = precosNoTexto(t.text);
    if (ps.length) ancoras.push({ ...t, ps, alt: t.y2 - t.y1 });
    else outros.push(t);
  }
  // a mesma etiqueta pode ter o preço grande e o "preço por kg" pequeno: o menor vira texto
  ancoras.sort((a, b) => b.alt - a.alt);
  const principais = [];
  for (const a of ancoras) {
    const ca = centro(a);
    const dono = principais.find((p) => {
      const cp = centro(p);
      return Math.hypot((cp[0] - ca[0]) * aspecto, cp[1] - ca[1]) < raio * 0.6 * p.alt && a.alt < p.alt * 0.8;
    });
    if (dono) outros.push(a); else principais.push(a);
  }
  const et = principais.map((a) => ({ a, textos: [], codigos: [] }));
  const maisPerto = (c) => {
    let best = null, bd = Infinity;
    for (const e of et) {
      const ca = centro(e.a);
      const d = Math.hypot((ca[0] - c[0]) * aspecto, ca[1] - c[1]) / e.a.alt;
      if (d < bd) { bd = d; best = e; }
    }
    return bd <= raio ? best : null;
  };
  for (const t of outros) { const e = maisPerto(centro(t)); if (e) e.textos.push(t); }
  for (const c of codigos || []) {
    if (!c.box) continue;
    const e = maisPerto([c.box.x + c.box.w / 2, c.box.y + c.box.h / 2]);
    if (e && /^\d{8,14}$/.test(normalizarCodigo(c.text))) e.codigos.push(c);
  }
  return et.map(({ a, textos: ts, codigos: cs }) => {
    const p = a.ps.sort((x, y) => Number(y.rs) - Number(x.rs))[0];
    const desc = ts.filter((t) => !/^\s*[\d\s.,/-]+\s*$/.test(t.text) && !precosNoTexto(t.text).length)
      .sort((x, y) => x.y1 - y.y1 || x.x1 - y.x1).map((t) => t.text).join(' ').trim();
    // EAN impresso em texto (sem código de barras legível)
    let codigo = cs.length ? normalizarCodigo(cs[0].text) : '';
    if (!codigo) { const m = ts.map((t) => t.text.replace(/\s/g, '')).join(' ').match(/\b\d{8,14}\b/); if (m) codigo = normalizarCodigo(m[0]); }
    const todos = [a, ...ts];
    const caixa = { x1: Math.min(...todos.map((t) => t.x1)), y1: Math.min(...todos.map((t) => t.y1)), x2: Math.max(...todos.map((t) => t.x2)), y2: Math.max(...todos.map((t) => t.y2)) };
    return { preco: p.valor, precoTexto: a.text, codigo, descricao: desc, caixa, conf: a.score ?? 1 };
  }).filter((e) => !(o.minimo > 0) || e.preco >= o.minimo);
}

/**
 * Confere uma etiqueta com a tabela. o = { tolerancia (R$), simMin (0–1) }.
 * Devolve { status: 'ok'|'divergente'|'nao_cadastrado', item, por: 'codigo'|'descricao', sim, diferenca }.
 */
export function conferir(et, tabela, o = {}) {
  const tol = o.tolerancia ?? 0.005, simMin = o.simMin ?? 0.5;
  let item = null, por = null, sim = 0;
  if (et.codigo) {
    item = tabela.find((x) => x.codigo && x.codigo === et.codigo) || null;
    if (item) { por = 'codigo'; sim = 1; }
  }
  if (!item && et.descricao) {
    for (const x of tabela) {
      if (!x.descricao) continue;
      const s = similaridade(et.descricao, x.descricao);
      if (s > sim) { sim = s; item = x; }
    }
    if (sim >= simMin) por = 'descricao'; else item = null;
  }
  if (!item) return { status: 'nao_cadastrado', item: null, por: null, sim, diferenca: null };
  const diferenca = Math.round((et.preco - item.preco) * 100) / 100;
  return { status: Math.abs(diferenca) <= tol ? 'ok' : 'divergente', item, por, sim, diferenca };
}

export const ROTULO_STATUS = { ok: 'confere', divergente: 'DIVERGENTE', nao_cadastrado: 'não cadastrado' };

// ------------------------------------------------------------------ tabela (localStorage)

const CHAVE = 'gplansis.auditoria-preco.tabela';
let tabela = null;
const ouvintes = new Set();

export function tabelaPrecos() {
  if (tabela) return tabela;
  try { const o = JSON.parse(localStorage.getItem(CHAVE) || 'null'); tabela = o && Array.isArray(o.itens) ? o : { itens: [], nome: '', quando: null }; }
  catch (_) { tabela = { itens: [], nome: '', quando: null }; }
  return tabela;
}

export function definirTabela(itens, nome = '') {
  tabela = { itens, nome, quando: new Date().toISOString() };
  try { localStorage.setItem(CHAVE, JSON.stringify(tabela)); } catch (_) { /* cheio: fica só na memória */ }
  for (const f of ouvintes) { try { f(tabela); } catch (_) { /* painel desmontando */ } }
  return tabela;
}

export function ouvirTabela(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
