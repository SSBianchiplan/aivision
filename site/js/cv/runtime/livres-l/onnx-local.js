/**
 * cv/runtime/livres-l/onnx-local.js — MODELO ONNX DO USUÁRIO para a contagem (CV-38).
 *
 * No CounterVision o operador cadastrava o próprio best.onnx (detector
 * treinado) e a inferência rodava no navegador. Aqui o arquivo escolhido fica
 * NESTE navegador (IndexedDB 'aiv-contador' › 'modelos', nada é enviado) e é
 * registrado no catálogo do runtime ONNX do iaVision com o id
 * 'contador-onnx' — mesma fila, mesmo worker, mesmo painel Modelos.
 *
 * Saídas aceitas (as de detector "estilo YOLO" mais comuns):
 *   [1, N, 6]      fim a fim: x1, y1, x2, y2, score, classe (sem NMS)
 *   [1, 4+C, N]    ou [1, N, 4+C]: cx, cy, w, h e um score por classe (com NMS aqui)
 * RF-DETR treinado no Treinar usa o operador próprio (livres.rfdetr).
 *
 * LICENÇA: o modelo é do usuário. Pesos derivados do Ultralytics (YOLOv8/11,
 * YOLO26) são AGPL-3.0 — usar em produto oferecido a terceiros obriga a abrir
 * o código ou comprar a licença. O iaVision não distribui nenhum: este
 * carregador só lê o arquivo que a pessoa escolher.
 */
import { MODELS, unload } from '../onnx.js';
import { nmsBoxes } from '../opkit.js';
import { abrirDB } from './esteira.js';

export const ID_MODELO = 'contador-onnx';
let info = null;            // { nome, imgsz, classes, bytes }
let url = null;
const ouvintes = new Set();
export function assinarModelo(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
const avisar = () => { for (const f of ouvintes) { try { f(info); } catch (_) { /* segue */ } } };

function registrar(reg) {
  if (url) { try { URL.revokeObjectURL(url); } catch (_) { /* segue */ } }
  unload(ID_MODELO);
  url = URL.createObjectURL(new Blob([reg.dados], { type: 'application/octet-stream' }));
  MODELS[ID_MODELO] = {
    file: url, bytes: reg.dados.byteLength, name: `${reg.nome} (do usuário, CounterVision)`, task: 'detection',
    license: 'do usuário', source: 'arquivo local', input: [1, 3, reg.imgsz, reg.imgsz], layout: 'nchw',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255, ep: 'wasm',
  };
  info = { nome: reg.nome, imgsz: reg.imgsz, classes: reg.classes || [], bytes: reg.dados.byteLength };
  avisar();
}

let lido = null;
/** Carrega o modelo guardado (uma vez). Devolve info ou null. */
export function modeloGuardado() {
  if (!lido) {
    lido = (async () => {
      const db = await abrirDB();
      if (!db) return null;
      const reg = await new Promise((res) => {
        try {
          const rq = db.transaction('modelos', 'readonly').objectStore('modelos').get('atual');
          rq.onsuccess = () => res(rq.result || null); rq.onerror = () => res(null);
        } catch (_) { res(null); }
      });
      if (reg && reg.dados) registrar(reg);
      return info;
    })();
  }
  return lido;
}
export function infoModelo() { return info; }

/** Guarda e registra um .onnx escolhido. `classes`: lista de nomes (vírgula). */
export async function guardarModelo(arquivo, { imgsz = 640, classes = '' } = {}) {
  if (!arquivo || !/\.onnx$/i.test(arquivo.name)) throw new Error('Escolha um arquivo .onnx');
  if (arquivo.size > 300e6) throw new Error('Arquivo maior que 300 MB');
  const dados = await arquivo.arrayBuffer();
  const reg = {
    id: 'atual', nome: arquivo.name.replace(/\.onnx$/i, '').slice(0, 60), dados,
    imgsz: Math.max(160, Math.min(1280, Math.round((+imgsz || 640) / 32) * 32)),
    classes: String(classes || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 200),
  };
  const db = await abrirDB();
  if (db) {
    await new Promise((res, rej) => {
      const t = db.transaction('modelos', 'readwrite');
      t.objectStore('modelos').put(reg);
      t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  lido = Promise.resolve(null);
  registrar(reg);
  return info;
}

export async function esquecerModelo() {
  const db = await abrirDB();
  if (db) await new Promise((res) => { const t = db.transaction('modelos', 'readwrite'); t.objectStore('modelos').delete('atual'); t.oncomplete = res; t.onerror = res; });
  unload(ID_MODELO);
  delete MODELS[ID_MODELO];
  if (url) { URL.revokeObjectURL(url); url = null; }
  info = null; lido = Promise.resolve(null);
  avisar();
}

/**
 * Decodifica a saída (porte do yolo.ts do CounterVision). `nClasses` (se conhecido)
 * desfaz a ambiguidade de orientação. `lb` = letterbox
 * ({ scale, dx, dy }); w×h = quadro. Devolve caixas normalizadas.
 */
export function decodificar(out, lb, w, h, conf, iouT, maxDet, nClasses = 0) {
  const dm = out.dims, a = out.data, raw = [];
  const push = (x1, y1, x2, y2, s, k) => raw.push({
    x1: (x1 - lb.dx) / lb.scale / w, y1: (y1 - lb.dy) / lb.scale / h,
    x2: (x2 - lb.dx) / lb.scale / w, y2: (y2 - lb.dy) / lb.scale / h, score: s, cls: k,
  });
  if (dm.length === 3 && dm[2] === 6 && dm[1] <= 1000) {
    for (let i = 0; i < dm[1]; i++) {
      const o = i * 6, s = a[o + 4];
      if (s < conf) continue;
      push(a[o], a[o + 1], a[o + 2], a[o + 3], s, a[o + 5] | 0);
    }
    raw.sort((p, q) => q.score - p.score);
    return raw.slice(0, maxDet);
  }
  if (dm.length !== 3) throw new Error('saída não reconhecida: ' + JSON.stringify(dm));
  // [1, 4+C, N] (Ultralytics) ou [1, N, 4+C]: com as classes conhecidas, a dimensão 4+C decide; senão a maior é N
  const tr = nClasses > 0 && (dm[1] === 4 + nClasses) !== (dm[2] === 4 + nClasses) ? dm[2] === 4 + nClasses : dm[1] > dm[2];
  const C = tr ? dm[2] : dm[1], M = tr ? dm[1] : dm[2];
  const g = (ch, n) => (tr ? a[n * C + ch] : a[ch * M + n]);
  for (let n = 0; n < M; n++) {
    let bs = 0, bk = -1;
    for (let k = 4; k < C; k++) { const s = g(k, n); if (s > bs) { bs = s; bk = k - 4; } }
    if (bs < conf) continue;
    const cx = g(0, n), cy = g(1, n), bw = g(2, n), bh = g(3, n);
    push(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2, bs, bk);
  }
  return nmsBoxes(raw, iouT, maxDet, true);
}
