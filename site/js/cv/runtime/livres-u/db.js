/**
 * cv/runtime/livres-u/db.js — IndexedDB do grupo U (onda 2-d): um banco
 * "gplansis-livres-u" com dois depósitos chave→valor:
 *   indices  índice da busca em vídeo (K4) e transcrições (M2), por mídia
 *   obra     estado do Diário de obra por dia e as fotos (Blob JPEG)
 * Tudo fica neste navegador; nada é enviado.
 */
const NOME = 'gplansis-livres-u', VERSAO = 1, DEPOSITOS = ['indices', 'obra'];
let dbP = null;

function abrir() {
  if (dbP) return dbP;
  dbP = new Promise((res, rej) => {
    const r = indexedDB.open(NOME, VERSAO);
    r.onupgradeneeded = () => { for (const d of DEPOSITOS) if (!r.result.objectStoreNames.contains(d)) r.result.createObjectStore(d); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbP = null; rej(r.error); };
  });
  return dbP;
}

function tx(dep, modo, fn) {
  return abrir().then((db) => new Promise((res, rej) => {
    const t = db.transaction(dep, modo), st = t.objectStore(dep);
    const req = fn(st);
    t.oncomplete = () => res(req && 'result' in req ? req.result : undefined);
    t.onerror = () => rej(t.error);
  }));
}

export const ler = (dep, k) => tx(dep, 'readonly', (s) => s.get(k));
export const gravar = (dep, k, v) => tx(dep, 'readwrite', (s) => s.put(v, k));
export const apagar = (dep, k) => tx(dep, 'readwrite', (s) => s.delete(k));
export const chaves = (dep) => tx(dep, 'readonly', (s) => s.getAllKeys());
