/**
 * projeto/servico.js — o +Projeto conversando com o serviço Treinar
 * (/api/treino, aivision-treino/app.py). Só usa o contrato que já existe:
 *
 *   POST  /projetos                         { nome, tipo: detector|anomalia, motor: rfdetr, classes }
 *   PATCH /projetos/{pid}                   { nome, classes }  (só acrescenta/renomeia classes)
 *   GET   /projetos/{pid}/imagens           [{ nome, caixas: [[cls,cx,cy,w,h]…], rotulada, grupo }]
 *   POST  /projetos/{pid}/imagens[?grupo=]  multipart "arquivos" → { enviadas: [nome], erros }
 *   GET   /projetos/{pid}/imagens/{nome}    o JPEG (com o token)
 *   PUT   /projetos/{pid}/imagens/{nome}/rotulos  { caixas: [[cls,cx,cy,w,h]…] } (substitui)
 *   PUT   /projetos/{pid}/imagens/{nome}/grupo    { grupo: boa|ruim }
 *   DELETE /projetos/{pid}/imagens/{nome}
 *   POST  /projetos/{pid}/treinar           { nome, motor, variante, epocas, imgsz, publicar } → status
 *   GET   /projetos/{pid}/treinos[/{tid}]   status: estado, epoca, total, metricas, historico, publicado, modelo, log
 *   POST  /projetos/{pid}/treinos/{tid}/publicar   → ficha do index.json
 *
 *   (v2.2) o POST de imagens aceita `meta` — JSON, uma lista na ordem dos
 *   arquivos: { fonte: print|arquivo|youtube, origem, titulo, capturado, arquivo, … }
 *   — guardado em origens.json e devolvido em GET …/imagens (`origem`). Imagem
 *   repetida (mesmo sha256) é pulada e volta em `repetidas`.
 *
 * PASTAS. O serviço não tem pasta nem subpasta. A pasta do +Projeto vai em
 * DOIS lugares: no NOME do arquivo — "turno-A--defeitos__print-….jpg"
 * (segmentos com "--", separador "__"; o servidor só aceita [A-Za-z0-9_.-]) —
 * e no metadado de origem: `origem` = "pasta: turno-A/defeitos · quadro da
 * câmera" e `titulo` = "+Projeto «nome» · pasta …". Ao trazer um projeto do
 * Treinar, a pasta é lida do metadado (com acentos) ou, sem ele, do nome.
 */

import { apiTreino, lerToken } from '../auth/treino.js';
import { projStore, ativo, mudarProjeto, mudarPrint, slugPasta, pastaDoNome, novoId, normPasta, CORES } from './base.js';

/** O projeto existe no Treinar com as classes de agora (cria ou acrescenta). Devolve o pid. */
export async function garantirProjeto(p = ativo()) {
  if (!p) throw new Error('Crie ou abra um projeto primeiro.');
  const nomes = p.classes.map((c) => c.nome);
  if (p.tipo === 'detector' && !nomes.length) throw new Error('Defina pelo menos uma classe antes de enviar.');
  if (p.pid) {
    try {
      const r = await apiTreino(`/projetos/${encodeURIComponent(p.pid)}`, { method: 'PATCH', body: JSON.stringify({ nome: p.nome, ...(p.tipo === 'detector' ? { classes: nomes } : {}) }) });
      return r.id || p.pid;
    } catch (e) {
      if (e.status !== 404) throw e;   // apagado no Treinar: cria de novo (os prints voltam a "local")
      for (const pr of projStore.get().prints) if (pr.projeto === p.id && pr.servidor) await mudarPrint(pr.id, { servidor: null, estado: 'local', renomear: false });
    }
  }
  const r = await apiTreino('/projetos', { method: 'POST', body: JSON.stringify({ nome: p.nome, tipo: p.tipo, motor: 'rfdetr', classes: nomes }) });
  await mudarProjeto({ pid: r.id }, p.id);
  return r.id;
}

/** Caixas do print → linhas YOLO [cls, cx, cy, w, h] (polígono vira o retângulo que o envolve). */
export function paraYolo(caixas) {
  const out = [];
  for (const c of caixas) {
    if (c.sug) continue;   // sugestão da pré-rotulagem: só vai depois de aceita
    let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
    for (const [u, v] of c.pts) { x1 = Math.min(x1, u); y1 = Math.min(y1, v); x2 = Math.max(x2, u); y2 = Math.max(y2, v); }
    const w = x2 - x1, h = y2 - y1;
    if (w > 0.002 && h > 0.002) out.push([c.cls, +((x1 + x2) / 2).toFixed(6), +((y1 + y2) / 2).toFixed(6), +w.toFixed(6), +h.toFixed(6)]);
  }
  return out;
}

/** Nome do arquivo no Treinar: a pasta vai no prefixo. */
export function nomeArquivo(pr) {
  const sp = slugPasta(pr.pasta);
  const base = String(pr.nome || 'print').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, sp ? 58 - sp.length : 60);
  return (sp ? sp + '__' : '') + base + '.jpg';
}

const ORIGENS = {
  colado: 'print colado (Ctrl/⌘+V)', arquivo: 'arquivo de imagem', recorte: 'recorte de uma área', exemplos: 'quadro com exemplos marcados',
  'quadro-camera': 'quadro da câmera', 'quadro-arquivo': 'quadro de um vídeo do aparelho', 'quadro-tela': 'quadro da tela compartilhada',
  'quadro-youtube': 'quadro do player do YouTube', 'quadro-stream': 'quadro de stream', treinar: 'trazido do Treinar',
};

/** Metadado de origem (v2.2) — a pasta vai em `origem` e `titulo` (o serviço não tem pasta). */
export function metaDe(pr, p, arquivo) {
  const pasta = normPasta(pr.pasta);
  const o = String(pr.origem || 'print');
  return {
    fonte: o === 'arquivo' ? 'arquivo' : 'print',
    origem: `pasta: ${pasta || '(raiz)'} · ${ORIGENS[o] || o}`.slice(0, 200),
    titulo: `+Projeto «${p.nome}» · pasta ${pasta ? p.nome + '/' + pasta : p.nome}`.slice(0, 200),
    capturado: new Date(pr.criado || Date.now()).toISOString(),
    arquivo,
  };
}

/** Pasta de uma imagem do Treinar: do metadado de origem (v2.2) ou do nome do arquivo. */
export function pastaDaImagem(im) {
  const o = im && im.origem && typeof im.origem === 'object' ? String(im.origem.origem || '') : '';
  const m = /^pasta: (.+?) · /.exec(o);
  if (m) return m[1] === '(raiz)' ? '' : normPasta(m[1]);
  return pastaDoNome(im.nome);
}

/**
 * Envia um print: a imagem (se ainda não foi, ou se mudou de pasta) e as
 * caixas (PUT substitui) ou o grupo (anomalia). Atualiza o estado do print.
 */
export async function enviarPrint(pr, p = ativo()) {
  const pid = p.pid || await garantirProjeto(p);
  const base = `/projetos/${encodeURIComponent(pid)}/imagens`;
  let nome = pr.servidor;
  if (nome && pr.renomear) {
    try { await apiTreino(`${base}/${encodeURIComponent(nome)}`, { method: 'DELETE' }); } catch (_) { /* já não estava lá */ }
    nome = null;
  }
  if (!nome) {
    const fd = new FormData();
    const arquivo = nomeArquivo(pr);
    fd.append('arquivos', new File([pr.blob], arquivo, { type: 'image/jpeg' }));
    fd.append('meta', JSON.stringify([metaDe(pr, p, arquivo)]));
    const grupo = p.tipo === 'anomalia' ? '?grupo=' + (pr.grupo === 'ruim' ? 'ruim' : 'boa') : '';
    const r = await apiTreino(base + grupo, { method: 'POST', body: fd });
    if (r && r.repetidas && r.repetidas.length && !(r.enviadas || []).length) {
      throw new Error('o Treinar já tem esta mesma imagem (repetida, mesmo sha256) — apague um dos prints iguais');
    }
    if (!r || !r.enviadas || !r.enviadas.length) throw new Error((r && r.erros && r.erros[0]) || 'o Treinar não aceitou a imagem');
    nome = r.enviadas[0];
  }
  let estado = 'enviado';
  if (p.tipo === 'anomalia') {
    await apiTreino(`${base}/${encodeURIComponent(nome)}/grupo`, { method: 'PUT', body: JSON.stringify({ grupo: pr.grupo === 'ruim' ? 'ruim' : 'boa' }) });
    estado = 'rotulado';
  } else {
    const cx = paraYolo(pr.caixas);
    // sem caixas e nunca rotulado: fica "enviado" (não vira exemplo negativo sem querer)
    if (cx.length || pr.rotulosEnviados) {
      const s = await apiTreino(`${base}/${encodeURIComponent(nome)}/rotulos`, { method: 'PUT', body: JSON.stringify({ caixas: cx }) });
      estado = s && s.caixas ? 'rotulado' : 'enviado';
    }
  }
  return mudarPrint(pr.id, { servidor: nome, estado, renomear: false, rotulosEnviados: p.tipo === 'detector' ? paraYolo(pr.caixas).length : 0, enviadoEm: Date.now() });
}

/** Envia vários (os que não estão "rotulado"/"enviado" sem mudança). Devolve { ok, erros }. */
export async function salvarNoDataset(prints, aoProgredir = null) {
  const p = ativo();
  await garantirProjeto(p);
  const fila = prints.filter((x) => x.estado === 'local' || x.estado === 'alterado' || x.renomear);
  let ok = 0;
  const erros = [];
  for (let i = 0; i < fila.length; i++) {
    if (aoProgredir) aoProgredir(i + 1, fila.length);
    try { await enviarPrint(projStore.get().prints.find((x) => x.id === fila[i].id) || fila[i], ativo()); ok++; } catch (e) { erros.push(`${fila[i].nome}: ${e.message}`); if (e.status === 401) break; }
  }
  return { ok, erros, total: fila.length };
}

// ------------------------------------------------------------- treino

/** Começa um treino (RF-DETR para detecção, PatchCore para anomalia). */
export async function treinar({ epocas = 20, imgsz = 384, variante = 'nano', nome = '' } = {}) {
  const p = ativo();
  const pid = await garantirProjeto(p);
  const corpo = p.tipo === 'anomalia'
    ? { nome: nome || `${p.nome} · PatchCore`, imgsz: [224, 256, 320].includes(+imgsz) ? +imgsz : 256, publicar: true }
    : { nome: nome || `${p.nome} · RF-DETR ${variante} · ${epocas} épocas`, motor: 'rfdetr', variante, epocas: +epocas, imgsz: +imgsz, publicar: true };
  const st = await apiTreino(`/projetos/${encodeURIComponent(pid)}/treinar`, { method: 'POST', body: JSON.stringify(corpo) });
  await mudarProjeto({ treino: resumoTreino(st) });
  return st;
}

export const resumoTreino = (st) => ({
  tid: st.id, nome: st.nome, estado: st.estado, epoca: st.epoca || 0, total: st.total || 0, posicao: st.posicao || null,
  metricas: st.metricas || st.melhor || null, historico: (st.historico || []).slice(-60), publicado: !!st.publicado,
  modelo: st.modelo || null, tem_modelo: !!st.tem_modelo, erro: st.erro || null, log: (st.log || []).slice(-6),
});

/** Lê o estado do treino atual e guarda no projeto. */
export async function acompanhar() {
  const p = ativo();
  if (!p || !p.pid || !p.treino || !p.treino.tid) return null;
  const st = await apiTreino(`/projetos/${encodeURIComponent(p.pid)}/treinos/${encodeURIComponent(p.treino.tid)}`);
  const t = resumoTreino(st);
  await mudarProjeto({ treino: t, ...(t.publicado && t.modelo ? { modelo: t.modelo } : {}) });
  return t;
}

export async function listarTreinos() {
  const p = ativo();
  if (!p || !p.pid) return [];
  return apiTreino(`/projetos/${encodeURIComponent(p.pid)}/treinos`);
}

export async function publicar(tid = (ativo().treino || {}).tid) {
  const p = ativo();
  const f = await apiTreino(`/projetos/${encodeURIComponent(p.pid)}/treinos/${encodeURIComponent(tid)}/publicar`, { method: 'POST' });
  await mudarProjeto({ modelo: f.id, treino: { ...(p.treino || {}), publicado: true, modelo: f.id } });
  return f;
}

export async function cancelarTreino() {
  const p = ativo();
  if (!p || !p.treino) return;
  await apiTreino(`/projetos/${encodeURIComponent(p.pid)}/treinos/${encodeURIComponent(p.treino.tid)}/cancelar`, { method: 'POST' });
  await acompanhar();
}

// ------------------------------------------------------------- abrir um projeto do Treinar

/**
 * Traz um projeto do Treinar para cá: classes, e as imagens com as caixas
 * (baixadas com o token, até `max`), cada uma na pasta que o nome indica.
 */
export async function trazerDoTreinar(srv, { max = 300, aoProgredir = null } = {}) {
  const { criarProjeto, adicionarPrint } = await import('./base.js');
  const p = await criarProjeto({ nome: srv.nome, tipo: srv.tipo === 'anomalia' ? 'anomalia' : 'detector', classes: (srv.classes || []).map((n, i) => ({ nome: n, cor: CORES[i % CORES.length] })) });
  await mudarProjeto({ pid: srv.id });
  const lista = (await apiTreino(`/projetos/${encodeURIComponent(srv.id)}/imagens`)).slice(0, max);
  let n = 0;
  for (const im of lista) {
    if (aoProgredir) aoProgredir(++n, lista.length);
    const r = await fetch(`/api/treino/projetos/${encodeURIComponent(srv.id)}/imagens/${encodeURIComponent(im.nome)}`, { headers: { Authorization: 'Bearer ' + lerToken() }, credentials: 'same-origin' });
    if (!r.ok) continue;
    const caixas = (im.caixas || []).map(([cls, cx, cy, w, h]) => ({ id: novoId('cx'), cls, tipo: 'retangulo', pts: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]] }));
    const pr = await adicionarPrint(await r.blob(), { origem: 'treinar', pasta: pastaDaImagem(im), caixas, grupo: im.grupo || 'boa', projeto: p.id });
    await mudarPrint(pr.id, { servidor: im.nome, estado: im.rotulada && (caixas.length || srv.tipo === 'anomalia') ? 'rotulado' : 'enviado', rotulosEnviados: caixas.length });
  }
  return p;
}
