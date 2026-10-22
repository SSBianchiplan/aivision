/**
 * youtube/playlists.js — playlists de vídeos do YouTube e categorias.
 *
 * A interface (components/YouTubePlaylists.js) só fala com esta API: lê o
 * retrato atual com `estado()` e escuta mudanças com `ouvir()`; toda escrita
 * é uma função assíncrona. Hoje o armazenamento é o localStorage do
 * navegador; para levar ao servidor basta trocar `ler()`/`gravar()` (e tornar
 * as escritas chamadas de API) — a interface não muda.
 *
 * ================= MODELO =================
 *
 *   { versao: 1,
 *     playlists: [{ id, nome, criadaEm,
 *                   itens: [{ id (do vídeo), titulo, canal, duracao, aspecto,
 *                             categoria, salvoEm }] }],
 *     categorias: [{ id, nome }] }        ← só as criadas pelo usuário
 *
 *   - Um vídeo aparece no máximo uma vez em cada playlist; salvar de novo
 *     atualiza a categoria e os dados.
 *   - CATEGORIA = o tipo de modelo/análise a que o vídeo se destina. As padrão
 *     (CATEGORIAS_PADRAO) vêm dos módulos de esporte e visão e levam o preset
 *     do Pipeline correspondente; as do usuário podem ser apagadas — os vídeos
 *     delas passam para «Outros».
 *   - Chave por usuário logado (id de /api/me): contas diferentes no mesmo
 *     navegador não misturam playlists.
 * ==========================================
 */

import { YT_ID } from '../camera/youtube.js';

export const VERSAO = 1;
const PREFIXO = 'aivYtPlaylists:';
const MAX_PLAYLISTS = 200;
const MAX_ITENS = 1000;
const MAX_CATEGORIAS = 100;
const MAX_NOME = 80;
const MAX_TEXTO = 200;

/**
 * Categorias padrão. `preset` é o nome de um preset do Pipeline
 * (components/Panels.js, PRESET_GROUPS) e `painel` o painel do módulo.
 */
export const CATEGORIAS_PADRAO = [
  { id: 'bikefit', nome: 'Bike Fit', preset: 'Bike Fit lateral', painel: 'bikefit' },
  { id: 'corrida', nome: 'Corrida', preset: 'Corrida lateral', painel: 'corrida' },
  { id: 'academia', nome: 'Academia', preset: 'Academia (automático)', painel: 'academia' },
  { id: 'salto', nome: 'Salto', preset: 'Salto CMJ', painel: 'salto' },
  { id: 'swing', nome: 'Swing', preset: 'Swing de golfe', painel: 'swing' },
  { id: 'vbt', nome: 'VBT', preset: 'VBT com marcador', painel: 'vbt' },
  { id: 'quadra', nome: 'Quadra', preset: 'Quadra — futsal', painel: 'quadra' },
  { id: 'ergonomia', nome: 'Ergonomia', preset: 'Ergonomia RULA', painel: 'ergonomia' },
  { id: 'pose', nome: 'Pose', preset: 'Pose' },
  { id: 'deteccao', nome: 'Detecção', preset: 'Detecção' },
  { id: 'outros', nome: 'Outros' },
];
export const CATEGORIA_PADRAO = 'outros';

// ------------------------------------------------------------ armazenamento

let usuario = 'anon';
let dados = null;          // cache do que está gravado
const ouvintes = new Set();

const vazio = () => ({ versao: VERSAO, playlists: [], categorias: [] });
const chave = () => PREFIXO + usuario;

function novoId(p) {
  try { if (crypto.randomUUID) return p + crypto.randomUUID().slice(0, 13); } catch (_) { /* sem crypto */ }
  return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const texto = (v, max = MAX_TEXTO) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

function ler() {
  try {
    const bruto = localStorage.getItem(chave());
    return bruto ? normalizar(JSON.parse(bruto)) : vazio();
  } catch (_) {
    return vazio();                            // JSON corrompido ou storage bloqueado: começa vazio
  }
}

function gravar(novo) {
  dados = novo;
  try {
    localStorage.setItem(chave(), JSON.stringify(novo));
  } catch (_) {
    avisar();
    throw new Error('Não foi possível gravar as playlists neste navegador (armazenamento cheio ou bloqueado).');
  }
  avisar();
}

function avisar() { for (const fn of ouvintes) { try { fn(dados); } catch (_) { /* ouvinte ruim */ } } }

function atual() {
  if (!dados) dados = ler();
  return dados;
}

/**
 * Aceita qualquer coisa (o que estava gravado, um JSON importado) e devolve um
 * objeto válido: descarta ids de vídeo inválidos, repetidos, campos estranhos
 * e corta textos longos. Versões futuras (versao > 1) são lidas no que tiverem
 * de compatível.
 */
function normalizar(obj) {
  const o = obj && typeof obj === 'object' ? obj : {};
  const categorias = [];
  const idsCat = new Set(CATEGORIAS_PADRAO.map((c) => c.id));
  for (const c of Array.isArray(o.categorias) ? o.categorias : []) {
    if (!c || typeof c !== 'object') continue;
    const nome = texto(c.nome, MAX_NOME);
    const id = texto(c.id, 40);
    if (!nome || !id || idsCat.has(id) || categorias.length >= MAX_CATEGORIAS) continue;
    idsCat.add(id);
    categorias.push({ id, nome });
  }
  const playlists = [];
  const idsPl = new Set();
  for (const p of Array.isArray(o.playlists) ? o.playlists : []) {
    if (!p || typeof p !== 'object' || playlists.length >= MAX_PLAYLISTS) continue;
    const nome = texto(p.nome, MAX_NOME);
    if (!nome) continue;
    let id = texto(p.id, 40);
    if (!id || idsPl.has(id)) id = novoId('p-');
    idsPl.add(id);
    const vistos = new Set();
    const itens = [];
    for (const it of Array.isArray(p.itens) ? p.itens : []) {
      const item = normalizarItem(it, idsCat);
      if (!item || vistos.has(item.id) || itens.length >= MAX_ITENS) continue;
      vistos.add(item.id);
      itens.push(item);
    }
    playlists.push({ id, nome, criadaEm: Number(p.criadaEm) || Date.now(), itens });
  }
  return { versao: VERSAO, playlists, categorias };
}

function normalizarItem(it, idsCat) {
  if (!it || typeof it !== 'object' || !YT_ID.test(String(it.id || ''))) return null;
  const dur = Number(it.duracao);
  return {
    id: it.id,
    titulo: texto(it.titulo) || it.id,
    canal: texto(it.canal),
    duracao: isFinite(dur) && dur > 0 ? Math.round(dur) : null,
    aspecto: ['16:9', '4:3', '9:16', '1:1'].includes(it.aspecto) ? it.aspecto : null,
    categoria: idsCat.has(it.categoria) ? it.categoria : CATEGORIA_PADRAO,
    salvoEm: Number(it.salvoEm) || Date.now(),
  };
}

/** Cópia rasa para alterar sem mexer no retrato que a interface está mostrando. */
function editar(fn) {
  const d = atual();
  const novo = { ...d, playlists: d.playlists.map((p) => ({ ...p, itens: [...p.itens] })), categorias: [...d.categorias] };
  const r = fn(novo);
  gravar(novo);
  return r;
}

function achar(d, plId) {
  const p = d.playlists.find((x) => x.id === plId);
  if (!p) throw new Error('Playlist não encontrada.');
  return p;
}

// ------------------------------------------------------------ leitura

/** Troca o dono das playlists (id do usuário de /api/me; vazio = anônimo). */
export function definirUsuario(id) {
  const u = id == null || id === '' ? 'anon' : String(id).replace(/[^\w.@-]/g, '').slice(0, 64) || 'anon';
  if (u === usuario && dados) return;
  usuario = u;
  dados = ler();
  avisar();
}

/** Retrato atual: { versao, playlists, categorias } (não alterar). */
export function estado() { return atual(); }

/** Escuta mudanças. Devolve a função que desliga. */
export function ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

export function listarPlaylists() { return atual().playlists; }
export function obterPlaylist(id) { return atual().playlists.find((p) => p.id === id) || null; }

/** Padrão + do usuário, cada uma com `propria: true|false`. */
export function listarCategorias() {
  return [
    ...CATEGORIAS_PADRAO.map((c) => ({ ...c, propria: false })),
    ...atual().categorias.map((c) => ({ ...c, propria: true })),
  ];
}
export function obterCategoria(id) {
  return listarCategorias().find((c) => c.id === id) || CATEGORIAS_PADRAO.find((c) => c.id === CATEGORIA_PADRAO);
}

/** Playlists em que o vídeo está: [{ playlist, item }]. */
export function ondeEsta(videoId) {
  const r = [];
  for (const p of atual().playlists) {
    const item = p.itens.find((i) => i.id === videoId);
    if (item) r.push({ playlist: p, item });
  }
  return r;
}

// ------------------------------------------------------------ playlists

export async function criarPlaylist(nome) {
  const n = texto(nome, MAX_NOME);
  if (!n) throw new Error('Dê um nome à playlist.');
  return editar((d) => {
    if (d.playlists.length >= MAX_PLAYLISTS) throw new Error(`Limite de ${MAX_PLAYLISTS} playlists.`);
    if (d.playlists.some((p) => p.nome.toLowerCase() === n.toLowerCase())) throw new Error(`Já existe a playlist «${n}».`);
    const p = { id: novoId('p-'), nome: n, criadaEm: Date.now(), itens: [] };
    d.playlists.push(p);
    return p;
  });
}

export async function renomearPlaylist(id, nome) {
  const n = texto(nome, MAX_NOME);
  if (!n) throw new Error('Dê um nome à playlist.');
  return editar((d) => {
    const p = achar(d, id);
    if (d.playlists.some((x) => x.id !== id && x.nome.toLowerCase() === n.toLowerCase())) throw new Error(`Já existe a playlist «${n}».`);
    p.nome = n;
    return p;
  });
}

export async function apagarPlaylist(id) {
  return editar((d) => { achar(d, id); d.playlists = d.playlists.filter((p) => p.id !== id); });
}

// ------------------------------------------------------------ vídeos

/**
 * Salva (ou atualiza) um vídeo numa playlist.
 * video: { id, titulo, canal, duracao?, aspecto? }
 */
export async function salvarVideo(plId, video, categoria = CATEGORIA_PADRAO) {
  return editar((d) => {
    const p = achar(d, plId);
    const idsCat = new Set(listarCategorias().map((c) => c.id));
    const novo = normalizarItem({ ...video, categoria, salvoEm: Date.now() }, idsCat);
    if (!novo) throw new Error('Vídeo inválido.');
    const i = p.itens.findIndex((x) => x.id === novo.id);
    if (i >= 0) {
      const velho = p.itens[i];
      // mantém o que já se sabia (ex.: duração) quando o novo vem sem
      p.itens[i] = { ...velho, ...Object.fromEntries(Object.entries(novo).filter(([, v]) => v != null && v !== '')), salvoEm: velho.salvoEm };
      return { item: p.itens[i], novo: false };
    }
    if (p.itens.length >= MAX_ITENS) throw new Error(`Limite de ${MAX_ITENS} vídeos por playlist.`);
    p.itens.push(novo);
    return { item: novo, novo: true };
  });
}

export async function removerVideo(plId, videoId) {
  return editar((d) => { const p = achar(d, plId); p.itens = p.itens.filter((x) => x.id !== videoId); });
}

/** Move (ou copia, com `copiar: true`) um vídeo para outra playlist. Já existindo lá, só atualiza. */
export async function moverVideo(deId, paraId, videoId, { copiar = false } = {}) {
  if (deId === paraId) return;
  return editar((d) => {
    const de = achar(d, deId);
    const para = achar(d, paraId);
    const item = de.itens.find((x) => x.id === videoId);
    if (!item) throw new Error('Vídeo não está nesta playlist.');
    const j = para.itens.findIndex((x) => x.id === videoId);
    if (j >= 0) para.itens[j] = { ...para.itens[j], categoria: item.categoria };
    else {
      if (para.itens.length >= MAX_ITENS) throw new Error(`Limite de ${MAX_ITENS} vídeos por playlist.`);
      para.itens.push({ ...item });
    }
    if (!copiar) de.itens = de.itens.filter((x) => x.id !== videoId);
  });
}

/** Sobe (passo −1) ou desce (+1) um vídeo dentro da playlist. */
export async function reordenar(plId, videoId, passo) {
  return editar((d) => {
    const p = achar(d, plId);
    const i = p.itens.findIndex((x) => x.id === videoId);
    const j = i + passo;
    if (i < 0 || j < 0 || j >= p.itens.length) return false;
    [p.itens[i], p.itens[j]] = [p.itens[j], p.itens[i]];
    return true;
  });
}

export async function definirCategoria(plId, videoId, categoria) {
  if (!listarCategorias().some((c) => c.id === categoria)) throw new Error('Categoria não encontrada.');
  return editar((d) => {
    const p = achar(d, plId);
    p.itens = p.itens.map((x) => (x.id === videoId ? { ...x, categoria } : x));
  });
}

// ------------------------------------------------------------ categorias

export async function criarCategoria(nome) {
  const n = texto(nome, MAX_NOME);
  if (!n) throw new Error('Dê um nome à categoria.');
  return editar((d) => {
    if (listarCategorias().some((c) => c.nome.toLowerCase() === n.toLowerCase())) throw new Error(`Já existe a categoria «${n}».`);
    if (d.categorias.length >= MAX_CATEGORIAS) throw new Error(`Limite de ${MAX_CATEGORIAS} categorias.`);
    const c = { id: novoId('c-'), nome: n };
    d.categorias.push(c);
    return { ...c, propria: true };
  });
}

/** Só as criadas pelo usuário. Os vídeos dela passam para «Outros». */
export async function apagarCategoria(id) {
  if (CATEGORIAS_PADRAO.some((c) => c.id === id)) throw new Error('As categorias padrão não podem ser apagadas.');
  return editar((d) => {
    d.categorias = d.categorias.filter((c) => c.id !== id);
    for (const p of d.playlists) {
      p.itens = p.itens.map((x) => (x.categoria === id ? { ...x, categoria: CATEGORIA_PADRAO } : x));
    }
  });
}

// ------------------------------------------------------------ backup

/** JSON para baixar (backup / levar para outro aparelho). */
export function exportarJson() {
  const d = atual();
  return JSON.stringify({ app: 'iaVision', tipo: 'playlists-youtube', exportadoEm: new Date().toISOString(), ...d }, null, 2);
}

/**
 * Importa um JSON exportado, MESCLANDO: playlist com o mesmo nome recebe os
 * vídeos que faltam; as outras entram novas. Categorias do usuário entram
 * pelo nome (a mesma categoria em dois aparelhos tem ids diferentes).
 * Devolve { playlists, videos, categorias } com o que entrou.
 */
export async function importarJson(textoJson) {
  let bruto;
  try { bruto = JSON.parse(textoJson); } catch (_) { throw new Error('Arquivo inválido: não é JSON.'); }
  if (!bruto || typeof bruto !== 'object' || !Array.isArray(bruto.playlists)) {
    throw new Error('Este JSON não é um backup de playlists do iaVision.');
  }
  // categorias do arquivo → id local (pelo nome); as que não existem são criadas
  const cats = Array.isArray(bruto.categorias) ? bruto.categorias : [];
  return editar((d) => {
    const cont = { playlists: 0, videos: 0, categorias: 0 };
    const mapa = new Map();
    const porNome = new Map([...CATEGORIAS_PADRAO, ...d.categorias].map((c) => [c.nome.toLowerCase(), c.id]));
    for (const c of cats) {
      const nome = c && texto(c.nome, MAX_NOME);
      if (!nome || !c.id) continue;
      let id = porNome.get(nome.toLowerCase());
      if (!id && d.categorias.length < MAX_CATEGORIAS) {
        id = novoId('c-');
        d.categorias.push({ id, nome });
        porNome.set(nome.toLowerCase(), id);
        cont.categorias++;
      }
      if (id) mapa.set(String(c.id), id);
    }
    const idsCat = new Set([...CATEGORIAS_PADRAO.map((c) => c.id), ...d.categorias.map((c) => c.id)]);
    const entrada = normalizar({
      playlists: bruto.playlists.map((p) => ({
        ...p,
        itens: (Array.isArray(p && p.itens) ? p.itens : []).map((it) => ({ ...it, categoria: mapa.get(String(it && it.categoria)) || (it && it.categoria) })),
      })),
      categorias: d.categorias,
    });
    for (const p of entrada.playlists) {
      const itens = p.itens.map((it) => ({ ...it, categoria: idsCat.has(it.categoria) ? it.categoria : CATEGORIA_PADRAO }));
      const igual = d.playlists.find((x) => x.nome.toLowerCase() === p.nome.toLowerCase());
      if (igual) {
        for (const it of itens) {
          if (igual.itens.length >= MAX_ITENS || igual.itens.some((x) => x.id === it.id)) continue;
          igual.itens.push(it);
          cont.videos++;
        }
      } else if (d.playlists.length < MAX_PLAYLISTS) {
        d.playlists.push({ id: novoId('p-'), nome: p.nome, criadaEm: p.criadaEm, itens });
        cont.playlists++;
        cont.videos += itens.length;
      }
    }
    return cont;
  });
}

// outra aba gravou: recarrega
if (typeof window !== 'undefined') {
  addEventListener('storage', (e) => {
    if (e.key === chave()) { dados = ler(); avisar(); }
  });
}
