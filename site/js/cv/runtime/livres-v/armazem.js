/**
 * cv/runtime/livres-v/armazem.js — CV-88: as tomadas do Content Browser no IndexedDB DESTE
 * navegador ('aiv-motion3d', loja 'tomadas'), separadas por conta logada (usuarioAtual da Via).
 * Só landmarks e metadados — nunca vídeo. Nada sai do aparelho (LGPD: minimização).
 */
import { usuarioAtual } from '../../../via/base.js';

const BANCO = 'aiv-motion3d', LOJA = 'tomadas', VERSAO = 1;
let banco = null;

function abrir() {
  if (banco) return banco;
  banco = new Promise((ok, falha) => {
    if (typeof indexedDB === 'undefined') { falha(new Error('IndexedDB indisponível neste navegador.')); return; }
    const r = indexedDB.open(BANCO, VERSAO);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA, { keyPath: 'id' }).createIndex('dono', 'dono'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { banco = null; falha(r.error || new Error('IndexedDB recusou abrir.')); };
  });
  return banco;
}
const dono = () => usuarioAtual() || 'anon';
const tx = async (modo, fn) => {
  const db = await abrir();
  return new Promise((ok, falha) => {
    const t = db.transaction(LOJA, modo);
    const loja = t.objectStore(LOJA);
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
/** LGPD: apaga todas as tomadas desta conta neste navegador. */
export async function apagarTudo() {
  const ls = await listar();
  for (const t of ls) await apagar(t.id);
  return ls.length;
}
