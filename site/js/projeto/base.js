/**
 * projeto/base.js — o modelo do módulo +Projeto: projetos, classes, pastas e
 * prints guardados NO APARELHO (IndexedDB) até irem para o Treinar.
 *
 * O +Projeto transforma as funções de tela e mouse em um MODELO NOVO:
 *   projeto (nome, tipo, classes) → prints (quadros capturados, colados,
 *   arrastados ou vindos do editor de vídeo) → marcações (caixas/polígonos
 *   com classe) → dataset no Treinar → treino → modelo publicado → Pipeline.
 *
 * ================= MODELO =================
 *
 *   projeto: { id, usuario, nome, tipo: 'detector'|'anomalia',
 *              classes: [{ nome, cor }], pastas: ['turno-A', 'turno-A/defeitos-novos'],
 *              pasta (pasta ativa; '' = a raiz, que é a pasta com o nome do projeto),
 *              classe (índice da classe ativa), pid (id do projeto no Treinar),
 *              treino: { tid, nome, estado, ... }, modelo (id publicado), criado }
 *   print:   { id, projeto, usuario, pasta, nome, blob (JPEG), w, h,
 *              caixas: [{ id, cls, tipo: 'retangulo'|'poligono', pts: [[u,v]…] (0–1 da imagem) }],
 *              grupo: 'boa'|'ruim' (anomalia), origem, estado, servidor, criado }
 *
 *   estado do print: 'local' (só aqui) · 'enviado' (imagem no Treinar, sem
 *   caixas) · 'rotulado' (imagem e caixas no Treinar) · 'alterado' (mudou
 *   depois de enviado: o próximo "Salvar no dataset" reenvia; PUT rótulos
 *   substitui as caixas).
 *
 * Nada de URL: as imagens são Blobs no IndexedDB; a interface cria object
 * URLs locais só para mostrar miniaturas. Chave por usuário logado (id de
 * /api/me, como youtube/playlists.js): contas diferentes não se misturam.
 *
 * Sem IndexedDB (aba privada, armazenamento bloqueado) tudo funciona só na
 * memória da página — e a interface avisa.
 *
 * Outros módulos mandam imagens para cá pelo evento `aiv:prints`
 * ({ detail: { imagens: [Blob…], origem } }) — o editor GPlanSiS|Vídeo usa.
 * ==========================================
 */

import { createStore, store, persist } from '../state/store.js';

export const CORES = ['#FFD84D', '#4ade80', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171', '#facc15', '#60a5fa'];
export const TIPOS = [
  { id: 'detector', nome: 'Detecção de objetos (RF-DETR, Apache-2.0)' },
  { id: 'anomalia', nome: 'Anomalia — peça boa × ruim (PatchCore, Apache-2.0)' },
];
const MAX_PRINTS = 3000;

// ------------------------------------------------------------- estado

export const projStore = createStore({
  pronto: false,
  memoria: false,       // sem IndexedDB: só nesta aba
  usuario: 'anon',
  projetos: [],         // do usuário, sem os prints
  ativo: null,          // id do projeto ativo
  prints: [],           // do projeto ativo
  aviso: '',
});

export const ativo = () => { const s = projStore.get(); return s.projetos.find((p) => p.id === s.ativo) || null; };

// ------------------------------------------------------------- IndexedDB

const DB = 'aiv-projeto';
let dbP = null;
const mem = { projetos: new Map(), prints: new Map() };

function abrirDb() {
  if (!dbP) {
    dbP = new Promise((res) => {
      try {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('projetos')) db.createObjectStore('projetos', { keyPath: 'id' }).createIndex('usuario', 'usuario');
          if (!db.objectStoreNames.contains('prints')) db.createObjectStore('prints', { keyPath: 'id' }).createIndex('projeto', 'projeto');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
        r.onblocked = () => res(null);
      } catch (_) { res(null); }
    });
  }
  return dbP;
}

async function tx(nome, modo, fn) {
  const db = await abrirDb();
  if (!db) return fn(null);
  return new Promise((res, rej) => {
    const t = db.transaction(nome, modo);
    const os = t.objectStore(nome);
    let out;
    Promise.resolve(fn(os)).then((v) => { out = v; }, rej);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function gravar(nome, obj) {
  mem[nome].set(obj.id, obj);
  try { await tx(nome, 'readwrite', (os) => os && req(os.put(obj))); } catch (e) { console.warn('[+Projeto] não gravou', e); }
}
async function apagarReg(nome, id) {
  mem[nome].delete(id);
  try { await tx(nome, 'readwrite', (os) => os && req(os.delete(id))); } catch (_) { /* segue */ }
}
async function lerPorIndice(nome, indice, valor) {
  try {
    const l = await tx(nome, 'readonly', (os) => os && req(os.index(indice).getAll(valor)));
    if (l) return l;
  } catch (_) { /* cai na memória */ }
  return [...mem[nome].values()].filter((o) => o[indice] === valor);
}

// ------------------------------------------------------------- usuário

let carregado = null;

/** Chamado pelo workspace com o id da sessão (/api/me). */
export function definirUsuario(id) {
  const u = id == null || id === '' ? 'anon' : String(id);
  if (u === projStore.get().usuario && carregado) return carregado;
  projStore.set({ usuario: u, pronto: false, projetos: [], prints: [], ativo: null });
  carregado = carregar(u);
  return carregado;
}

/** Garante que o estado do usuário atual foi lido. */
export function prontoP() { return carregado || definirUsuario(projStore.get().usuario); }

const chaveAtivo = (u) => 'aiv.projeto.ativo:' + u;

async function carregar(u) {
  const db = await abrirDb();
  const projetos = (await lerPorIndice('projetos', 'usuario', u)).sort((a, b) => (b.criado || 0) - (a.criado || 0));
  let at = null;
  try { at = localStorage.getItem(chaveAtivo(u)); } catch (_) { /* segue */ }
  if (!projetos.some((p) => p.id === at)) at = projetos[0] ? projetos[0].id : null;
  projStore.set({ projetos, ativo: at, memoria: !db, pronto: true });
  await lerPrints();
}

async function lerPrints() {
  const id = projStore.get().ativo;
  const l = id ? await lerPorIndice('prints', 'projeto', id) : [];
  projStore.set({ prints: l.sort((a, b) => a.criado - b.criado) });
}

// ------------------------------------------------------------- utilidades

function novoId(p) {
  try { if (crypto.randomUUID) return p + crypto.randomUUID().replace(/-/g, '').slice(0, 14); } catch (_) { /* sem crypto */ }
  return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export { novoId };

const limpa = (v, max = 60) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Nome de pasta: segmentos sem barras soltas, cada um com até 40 caracteres. */
export function normPasta(p) {
  return String(p || '').split('/').map((s) => limpa(s, 40).replace(/[\\]/g, '')).filter(Boolean).join('/');
}

/** Pasta → prefixo seguro para o nome do arquivo no Treinar ("turno-A/defeitos" → "turno-A--defeitos"). */
export function slugPasta(p) {
  return normPasta(p).split('/').map((s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean).join('--').slice(0, 30);
}

/** Nome do arquivo no Treinar → pasta (o inverso de slugPasta; perde acentos e espaços). */
export function pastaDoNome(nome) {
  const i = String(nome || '').indexOf('__');
  return i > 0 ? nome.slice(0, i).split('--').join('/') : '';
}

async function salvarProjeto(p) {
  await gravar('projetos', p);
  projStore.set((s) => ({ projetos: s.projetos.some((x) => x.id === p.id) ? s.projetos.map((x) => (x.id === p.id ? p : x)) : [p, ...s.projetos] }));
  return p;
}

/** Muda o projeto ativo (patch raso) e grava. */
export async function mudarProjeto(patch, id = projStore.get().ativo) {
  const p = projStore.get().projetos.find((x) => x.id === id);
  if (!p) return null;
  return salvarProjeto({ ...p, ...patch });
}

// ------------------------------------------------------------- projetos

export async function criarProjeto({ nome, tipo = 'detector', classes = [] } = {}) {
  await prontoP();
  const u = projStore.get().usuario;
  const p = {
    id: novoId('pj'), usuario: u, nome: limpa(nome) || 'Projeto sem nome', tipo: tipo === 'anomalia' ? 'anomalia' : 'detector',
    classes: classes.map((c, i) => (typeof c === 'string' ? { nome: limpa(c, 40), cor: CORES[i % CORES.length] } : { nome: limpa(c.nome, 40), cor: c.cor || CORES[i % CORES.length] })).filter((c) => c.nome),
    pastas: [], pasta: '', classe: 0, pid: null, treino: null, modelo: null, criado: Date.now(),
  };
  await salvarProjeto(p);
  await abrirProjeto(p.id);
  return p;
}

export async function abrirProjeto(id) {
  projStore.set({ ativo: id, prints: [] });
  try { localStorage.setItem(chaveAtivo(projStore.get().usuario), id || ''); } catch (_) { /* segue */ }
  await lerPrints();
}

/** Apaga o projeto LOCAL (prints e classes daqui); o projeto no Treinar fica. */
export async function apagarProjeto(id) {
  const prints = await lerPorIndice('prints', 'projeto', id);
  for (const pr of prints) await apagarReg('prints', pr.id);
  await apagarReg('projetos', id);
  const resto = projStore.get().projetos.filter((p) => p.id !== id);
  projStore.set({ projetos: resto });
  await abrirProjeto(resto[0] ? resto[0].id : null);
}

// ------------------------------------------------------------- classes

export async function adicionarClasse(nome, cor) {
  const p = ativo();
  if (!p) throw new Error('Crie ou abra um projeto primeiro.');
  const n = limpa(nome, 40);
  if (!n) throw new Error('Dê um nome à classe.');
  if (p.classes.some((c) => c.nome.toLowerCase() === n.toLowerCase())) throw new Error(`A classe «${n}» já existe.`);
  if (p.classes.length >= 80) throw new Error('No máximo 80 classes.');
  await mudarProjeto({ classes: [...p.classes, { nome: n, cor: cor || CORES[p.classes.length % CORES.length] }], classe: p.classes.length });
  return p.classes.length;
}

export async function editarClasse(i, patch) {
  const p = ativo();
  if (!p || !p.classes[i]) return;
  const nome = patch.nome != null ? limpa(patch.nome, 40) : p.classes[i].nome;
  if (!nome) throw new Error('O nome não pode ficar vazio.');
  if (p.classes.some((c, k) => k !== i && c.nome.toLowerCase() === nome.toLowerCase())) throw new Error(`A classe «${nome}» já existe.`);
  const antes = p.classes[i], depois = { ...antes, ...patch, nome };
  await mudarProjeto({ classes: p.classes.map((c, k) => (k === i ? depois : c)) });
  // as marcações de exemplo ao vivo (cv/marcacoes.js) acompanham o nome e a cor
  for (const fn of ouvintesClasse) { try { fn({ i, antes, depois }); } catch (_) { /* segue */ } }
}

/**
 * Apaga uma classe e as caixas dela (os índices das seguintes descem). No
 * Treinar não dá para remover classe de um projeto já criado (mudaria os
 * rótulos já feitos) — aí a pessoa renomeia ou deixa sem uso.
 */
export async function apagarClasse(i) {
  const p = ativo();
  if (!p || !p.classes[i]) return;
  if (p.pid) throw new Error('Este projeto já está no Treinar: lá não dá para remover classes. Renomeie ou deixe sem uso.');
  const prints = projStore.get().prints;
  for (const pr of prints) {
    if (!pr.caixas.some((c) => c.cls >= i)) continue;
    await salvarPrint({ ...pr, caixas: pr.caixas.filter((c) => c.cls !== i).map((c) => (c.cls > i ? { ...c, cls: c.cls - 1 } : c)) });
  }
  await mudarProjeto({ classes: p.classes.filter((_, k) => k !== i), classe: Math.max(0, Math.min(p.classe, p.classes.length - 2)) });
}

export function setClasseAtiva(i) {
  const p = ativo();
  if (p && p.classes[i] && p.classe !== i) mudarProjeto({ classe: i });
}

const ouvintesClasse = new Set();
export function ouvirClasses(fn) { ouvintesClasse.add(fn); return () => ouvintesClasse.delete(fn); }

/** Classe pelo nome (sem caixa e acentos) — para casar o que o detector diz com as classes do projeto. */
export function classePorNome(nome) {
  const p = ativo();
  if (!p) return -1;
  const n = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return p.classes.findIndex((c) => n(c.nome) === n(nome));
}

// ------------------------------------------------------------- pastas

export async function criarPasta(caminho) {
  const p = ativo();
  if (!p) throw new Error('Crie ou abra um projeto primeiro.');
  const c = normPasta(caminho);
  if (!c) throw new Error('Dê um nome à pasta.');
  const todas = new Set(p.pastas);
  // as pastas-mãe passam a existir também
  const seg = c.split('/');
  for (let i = 1; i <= seg.length; i++) todas.add(seg.slice(0, i).join('/'));
  await mudarProjeto({ pastas: [...todas].sort((a, b) => a.localeCompare(b, 'pt-BR')), pasta: c });
  return c;
}

/** Renomeia uma pasta (e as subpastas e os prints dela). Prints já enviados ficam "alterado" (vão com o nome novo). */
export async function renomearPasta(de, para) {
  const p = ativo();
  const a = normPasta(de), b = normPasta(para);
  if (!p || !a || !b || a === b) return;
  const troca = (x) => (x === a ? b : x.startsWith(a + '/') ? b + x.slice(a.length) : x);
  await mudarProjeto({ pastas: [...new Set(p.pastas.map(troca))].sort((x, y) => x.localeCompare(y, 'pt-BR')), pasta: troca(p.pasta) });
  for (const pr of projStore.get().prints) if (troca(pr.pasta) !== pr.pasta) await moverPrint(pr.id, troca(pr.pasta));
}

/** Apaga a pasta; os prints dela (e das subpastas) sobem para a pasta-mãe. */
export async function apagarPasta(caminho) {
  const p = ativo();
  const a = normPasta(caminho);
  if (!p || !a) return;
  const mae = a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '';
  await mudarProjeto({ pastas: p.pastas.filter((x) => x !== a && !x.startsWith(a + '/')), pasta: p.pasta === a || p.pasta.startsWith(a + '/') ? mae : p.pasta });
  for (const pr of projStore.get().prints) if (pr.pasta === a || pr.pasta.startsWith(a + '/')) await moverPrint(pr.id, mae);
}

export function setPastaAtiva(c) { const p = ativo(); if (p && p.pasta !== c) mudarProjeto({ pasta: normPasta(c) }); }

// ------------------------------------------------------------- prints

async function salvarPrint(pr) {
  await gravar('prints', pr);
  if (pr.projeto === projStore.get().ativo) {
    projStore.set((s) => ({ prints: s.prints.some((x) => x.id === pr.id) ? s.prints.map((x) => (x.id === pr.id ? pr : x)) : [...s.prints, pr] }));
  }
  return pr;
}

/** Tamanho de uma imagem (Blob). */
async function medir(blob) {
  if (typeof createImageBitmap === 'function') {
    try { const b = await createImageBitmap(blob); const r = { w: b.width, h: b.height }; b.close && b.close(); return r; } catch (_) { /* cai no <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try { const im = new Image(); im.src = url; await im.decode(); return { w: im.naturalWidth, h: im.naturalHeight }; }
  finally { URL.revokeObjectURL(url); }
}

/** Converte qualquer imagem (PNG colado, WebP…) para JPEG, no máximo 1920 px no maior lado. */
export async function paraJpeg(blob, maxLado = 1920) {
  let fonte = null, W = 0, H = 0;
  try { fonte = await createImageBitmap(blob); W = fonte.width; H = fonte.height; } catch (_) {
    const url = URL.createObjectURL(blob);
    const im = new Image(); im.src = url; await im.decode(); URL.revokeObjectURL(url);
    fonte = im; W = im.naturalWidth; H = im.naturalHeight;
  }
  const k = Math.min(1, maxLado / Math.max(W, H));
  if (blob.type === 'image/jpeg' && k === 1) { if (fonte.close) fonte.close(); return { blob, w: W, h: H }; }
  const c = document.createElement('canvas');
  c.width = Math.round(W * k); c.height = Math.round(H * k);
  c.getContext('2d').drawImage(fonte, 0, 0, c.width, c.height);
  if (fonte.close) fonte.close();
  const out = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
  return { blob: out, w: c.width, h: c.height };
}

let seqNome = 0;
function nomePrint(origem) {
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${origem || 'print'}-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}-${(++seqNome).toString(36)}`;
}

/**
 * Acrescenta um print ao projeto ativo (ou a `projeto`). `caixas` em 0–1 da
 * imagem. Devolve o print. Sem projeto, cria um ("Novo projeto").
 */
export async function adicionarPrint(blob, { origem = 'print', pasta = null, caixas = [], grupo = 'boa', projeto = null } = {}) {
  await prontoP();
  let p = projeto ? projStore.get().projetos.find((x) => x.id === projeto) : ativo();
  if (!p) p = await criarProjeto({ nome: 'Novo projeto' });
  if (projStore.get().prints.length >= MAX_PRINTS && p.id === projStore.get().ativo) throw new Error(`No máximo ${MAX_PRINTS} prints por projeto.`);
  const j = await paraJpeg(blob);
  const sha = await hashDe(j.blob);
  const novas = caixas.map((c) => ({ id: c.id || novoId('cx'), cls: c.cls | 0, tipo: c.tipo === 'poligono' ? 'poligono' : 'retangulo', pts: c.pts.map((q) => [cl01(q[0]), cl01(q[1])]) }));
  // imagem idêntica a um print do projeto (o Treinar recusaria como repetida): junta as caixas nele
  const igual = sha && (p.id === projStore.get().ativo ? projStore.get().prints : []).find((x) => x.sha === sha);
  if (igual) {
    avisar(`Imagem idêntica ao print «${igual.nome}»${novas.length ? ': as caixas foram juntadas a ele' : ''}.`);
    return novas.length ? mudarPrint(igual.id, { caixas: [...igual.caixas, ...novas] }) : igual;
  }
  const pr = {
    id: novoId('pr'), projeto: p.id, usuario: p.usuario, pasta: normPasta(pasta == null ? p.pasta : pasta),
    nome: nomePrint(origem), blob: j.blob, w: j.w, h: j.h,
    caixas: novas, sha,
    grupo: grupo === 'ruim' ? 'ruim' : 'boa', origem, estado: 'local', servidor: null, criado: Date.now(),
  };
  if (pr.pasta && !p.pastas.includes(pr.pasta)) await criarPasta(pr.pasta).catch(() => {});
  return salvarPrint(pr);
}

/** sha256 do JPEG (o Treinar deduplica pelo mesmo hash). '' sem crypto.subtle. */
async function hashDe(blob) {
  try {
    const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (_) { return ''; }
}

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : +v);

/** Muda um print (patch raso). Mudou caixas/grupo depois de enviado → "alterado". */
export async function mudarPrint(id, patch) {
  const pr = projStore.get().prints.find((x) => x.id === id) || mem.prints.get(id);
  if (!pr) return null;
  // só conta como mudança o que mudou de verdade (reabrir e fechar sem mexer não "altera")
  const toca = ('caixas' in patch && JSON.stringify(patch.caixas) !== JSON.stringify(pr.caixas)) || ('grupo' in patch && patch.grupo !== pr.grupo);
  const estado = patch.estado || (toca && pr.estado !== 'local' ? 'alterado' : pr.estado);
  return salvarPrint({ ...pr, ...patch, estado });
}

export async function moverPrint(id, pasta) {
  const pr = projStore.get().prints.find((x) => x.id === id);
  if (!pr) return;
  const c = normPasta(pasta);
  if (c === pr.pasta) return;
  const p = ativo();
  if (c && p && !p.pastas.includes(c)) await criarPasta(c);
  // já no Treinar: o nome do arquivo leva a pasta, então ele é reenviado com o nome novo
  await salvarPrint({ ...pr, pasta: c, ...(pr.servidor ? { estado: 'alterado', renomear: true } : {}) });
}

export async function apagarPrint(id) {
  await apagarReg('prints', id);
  projStore.set((s) => ({ prints: s.prints.filter((x) => x.id !== id) }));
}

/** Prints de uma pasta (com `sub`, inclui as subpastas). */
export function printsDaPasta(prints, pasta, sub = false) {
  const c = normPasta(pasta);
  return prints.filter((p) => p.pasta === c || (sub && (c === '' || p.pasta.startsWith(c + '/'))));
}

/** Abre o painel +Projeto. */
export function abrirPainel() {
  const st = store.get();
  if (!st.panels.projeto) { store.set({ panels: { ...st.panels, projeto: true } }); persist(); }
}

/** Aviso curto do módulo (a interface mostra). */
export function avisar(t) {
  projStore.set({ aviso: t });
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => projStore.set({ aviso: '' }), 6000);
}

// ------------------------------------------------------------- outros módulos → prints

if (typeof window !== 'undefined') {
  // GPlanSiS|Vídeo (js/components/video/*) e quem mais quiser: { imagens: [Blob…], origem, pasta? }
  window.addEventListener('aiv:prints', async (e) => {
    const d = (e && e.detail) || {};
    const imgs = Array.isArray(d.imagens) ? d.imagens.filter((b) => b && /^image\//.test(b.type || 'image/')) : [];
    if (!imgs.length) return;
    let n = 0;
    for (const b of imgs) {
      try { await adicionarPrint(b, { origem: limpa(d.origem || 'video', 30).replace(/[^A-Za-z0-9-]+/g, '-') || 'video', pasta: d.pasta == null ? null : d.pasta }); n++; } catch (err) { avisar('⚠ ' + err.message); break; }
    }
    if (n) { avisar(`${n} ${n === 1 ? 'print chegou' : 'prints chegaram'} de ${d.origem || 'outro módulo'}.`); abrirPainel(); }
  });
}
