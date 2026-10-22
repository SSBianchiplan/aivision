/**
 * cv/runtime/livres-v/armazem.js — CV-88: as tomadas do Content Browser no IndexedDB DESTE
 * navegador ('aiv-motion3d', loja 'tomadas'), separadas por conta logada (usuarioAtual da Via).
 * Só landmarks e metadados — nunca vídeo. Nada sai do aparelho (LGPD: minimização).
 */
import { usuarioAtual } from '../../../via/base.js';

const BANCO = 'aiv-motion3d', LOJA = 'tomadas', VERSAO = 2;
const LOJA_MOD = 'modelos';   // Studio v2: modelos 3D importados (arquivo inteiro) e marionetes 2D (imagem + alfa + juntas)
let banco = null;

function abrir() {
  if (banco) return banco;
  banco = new Promise((ok, falha) => {
    if (typeof indexedDB === 'undefined') { falha(new Error('IndexedDB indisponível neste navegador.')); return; }
    const r = indexedDB.open(BANCO, VERSAO);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA, { keyPath: 'id' }).createIndex('dono', 'dono');
      if (!db.objectStoreNames.contains(LOJA_MOD)) db.createObjectStore(LOJA_MOD, { keyPath: 'id' }).createIndex('dono', 'dono');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { banco = null; falha(r.error || new Error('IndexedDB recusou abrir.')); };
  });
  return banco;
}
const dono = () => usuarioAtual() || 'anon';
const tx = async (modo, fn, nomeLoja = LOJA) => {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const t = db.transaction(nomeLoja, modo);
    const loja = t.objectStore(nomeLoja);
    let res;
    Promise.resolve(fn(loja)).then((v) => { res = v; });
    t.oncomplete = () => ok(res);
    t.onerror = () => falha(t.error);
    t.onabort = () => falha(t.error || new Error('transação abortada'));
  });
};
const req = (r) => new Promise((ok, falha) => { r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); });

/** Lista as tomadas da conta (sem a trilha, para o Content Browser ser leve). */
export async function listar() {
  const todas = await tx('readonly', (l) => req(l.index('dono').getAll(dono())));
  return (todas || []).map(({ trilha, trilhaBruta, p2d, ...meta }) => ({ ...meta, quadros: trilha ? trilha.length : 0 }))
    .sort((a, b) => String(b.criado).localeCompare(String(a.criado)));
}
export async function ler(id) {
  const t = await tx('readonly', (l) => req(l.get(id)));
  return t && t.dono === dono() ? t : null;
}
export async function salvar(tomada) {
  const t = { ...tomada, dono: dono(), alterado: new Date().toISOString() };
  await tx('readwrite', (l) => req(l.put(t)));
  return t;
}
export async function apagar(id) {
  const t = await ler(id);
  if (!t) return false;
  await tx('readwrite', (l) => req(l.delete(id)));
  return true;
}
/** LGPD: apaga todas as tomadas (e os modelos/marionetes) desta conta neste navegador. */
export async function apagarTudo() {
  const ls = await listar();
  for (const t of ls) await apagar(t.id);
  let ms = [];
  try { ms = await listarModelos(); for (const m of ms) await apagarModelo(m.id); } catch (_) { /* loja nova ainda não criada */ }
  return ls.length + ms.length;
}

// ------------------------------------------------------------------ modelos e marionetes (v2)

/** Lista os modelos/marionetes da conta, sem os bytes. */
export async function listarModelos() {
  const todos = await tx('readonly', (l) => req(l.index('dono').getAll(dono())), LOJA_MOD);
  return (todos || []).map(({ bytes, imagem, alfa, ...meta }) => ({ ...meta, tamanho: bytes ? bytes.byteLength : imagem ? imagem.size : 0 }))
    .sort((a, b) => String(b.criado).localeCompare(String(a.criado)));
}
export async function lerModelo(id) {
  const m = await tx('readonly', (l) => req(l.get(id)), LOJA_MOD);
  return m && m.dono === dono() ? m : null;
}
export async function salvarModelo(m) {
  const t = { ...m, dono: dono(), alterado: new Date().toISOString() };
  await tx('readwrite', (l) => req(l.put(t)), LOJA_MOD);
  return t;
}
export async function apagarModelo(id) {
  const m = await lerModelo(id);
  if (!m) return false;
  await tx('readwrite', (l) => req(l.delete(id)), LOJA_MOD);
  return true;
}
