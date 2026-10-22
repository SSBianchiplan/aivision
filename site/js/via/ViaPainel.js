/**
 * via/ViaPainel.js — a gaveta da Via: chat com streaming, cartões de comando
 * e a biblioteca de comandos. Carregada SOB DEMANDA (workspace.js) — nada
 * disto, nem o SDK, baixa antes de alguém abrir a Via.
 *
 * A conversa vive neste módulo (sobrevive a fechar e abrir a gaveta) e some
 * ao recarregar a página: é o «histórico da sessão». Nada da conversa vai
 * para o localStorage.
 *
 * Com «Salvar conversas no servidor da GPlanSiS» ligado (padrão), cada turno
 * concluído vai também para o serviço aivision-via (texto, comandos e
 * metadados das imagens — nunca a chave, nunca a imagem). Falha lá não
 * atrapalha a conversa: vira um aviso discreto. A aba Base mostra a base de
 * conhecimento e o histórico no servidor, e deixa apagar.
 *
 * Imagens: 📎, arrastar e soltar ou Ctrl+V. Reduzidas aqui (≤ 1568 px, JPEG
 * 0,85), entram na mensagem como blocos `image` com ids A1, A2… e podem ir
 * para um projeto do Treinar (cartão; só com clique).
 */

import { html, useState, useEffect, useRef, Fragment, React } from '../vendor.js';
import { store, persist } from '../state/store.js';
import { getOperator, defaultParams } from '../cv/registry.js';
import { newNodeId } from '../cv/executor.js';
import { temChave, ouvir as ouvirBase, lerPreferencias, modeloInfo, consumirPedido, ouvirPedidos } from './base.js';
import {
  listarComandos, listarCategorias, salvarComando, apagarComando, criarCategoria, nomeCategoria,
  exportarJSON, importarJSON, ouvir as ouvirComandos,
} from './comandos.js';
import { turno, traduzirErro, emTeste, SemChave } from './cliente.js';
import { ViaChave } from './ViaChave.js';
import * as srv from './servidor.js';
import { prepararImagem, imagensDe, MAX_POR_MENSAGEM, TIPOS } from './anexos.js';
import { lerToken, lerQuem, gravarToken, entrarPorSessao, entrarComSenha, listarProjetos, enviarImagens } from '../auth/treino.js';

// ============================================================ conversa (memória da sessão)

const conversa = { itens: [], historico: [], ocupado: false, contexto: null, imagemLivre: false, uso: null,
  anexos: new Map(),      // 'A1' → { id, nome, blob, url, base64, largura, altura, sha256 }
  nAnexo: 0,
  rascunho: [],           // anexos ainda não enviados (miniaturas no compor)
  avisoAnexo: '',
  servidorId: null,       // id da conversa no aivision-via
  avisoServidor: '' };
const ouvintes = new Set();
const mudou = () => { for (const fn of ouvintes) { try { fn(); } catch (_) { /* ignora */ } } };
let seq = 0;
const novoItem = (it) => ({ id: ++seq, ...it });

function useConversa() {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN((n) => n + 1); ouvintes.add(f); return () => ouvintes.delete(f); }, []);
  return conversa;
}

let controlador = null;

export function novaConversa() {
  if (controlador) controlador.abort();
  for (const a of conversa.anexos.values()) URL.revokeObjectURL(a.url);
  for (const a of conversa.rascunho) if (a.url) URL.revokeObjectURL(a.url);
  conversa.itens = []; conversa.historico = []; conversa.contexto = null; conversa.imagemLivre = false; conversa.uso = null;
  conversa.anexos = new Map(); conversa.nAnexo = 0; conversa.rascunho = []; conversa.avisoAnexo = '';
  conversa.servidorId = null; conversa.avisoServidor = '';
  mudou();
}

// ============================================================ anexos (rascunho do compor)

let seqRascunho = 0;
function avisoAnexo(t) { conversa.avisoAnexo = t; mudou(); clearTimeout(avisoAnexo.t); avisoAnexo.t = setTimeout(() => { conversa.avisoAnexo = ''; mudou(); }, 5000); }

/** Acrescenta arquivos ao rascunho (até 8 por mensagem), reduzindo cada um. */
async function anexar(arquivos) {
  const lista = [...(arquivos || [])];
  if (!lista.length) return;
  const vagas = MAX_POR_MENSAGEM - conversa.rascunho.length;
  const aceitos = lista.filter((f) => TIPOS.includes(f.type));
  if (aceitos.length < lista.length) avisoAnexo('Só imagens JPG, PNG ou WebP.');
  if (aceitos.length > vagas) avisoAnexo(`Até ${MAX_POR_MENSAGEM} imagens por mensagem.`);
  const usar = aceitos.slice(0, Math.max(0, vagas));
  const marcas = usar.map((f) => ({ chave: ++seqRascunho, nome: f.name || 'imagem', preparando: true }));
  conversa.rascunho.push(...marcas);
  mudou();
  await Promise.all(usar.map(async (f, i) => {
    const m = marcas[i];
    try {
      const a = await prepararImagem(f);
      if (!conversa.rascunho.includes(m)) { URL.revokeObjectURL(a.url); return; }   // removido enquanto preparava
      Object.assign(m, a, { preparando: false });
    } catch (e) {
      conversa.rascunho = conversa.rascunho.filter((x) => x !== m);
      avisoAnexo('⚠ ' + (e && e.message ? e.message : 'não consegui abrir a imagem'));
    }
    mudou();
  }));
}

function tirarDoRascunho(m) {
  conversa.rascunho = conversa.rascunho.filter((x) => x !== m);
  if (m.url) URL.revokeObjectURL(m.url);
  mudou();
}

// ============================================================ servidor (memória da Via)

let perfilP = null;
/** {email, admin} do /api/via/eu (uma vez por página; null se o serviço não responde). */
function perfil() {
  if (!perfilP) perfilP = srv.eu().catch(() => { perfilP = null; return null; });
  return perfilP;
}

function comandoDoCartao(c) {
  if (c.tipo === 'comando' || c.tipo === 'salvar') return { op: c.op, parametro: c.parametro, valor: c.valor };
  if (c.tipo === 'operador') return { op: c.op, parametro: null, valor: JSON.stringify(Object.fromEntries(c.mudados.map((k) => [k, c.params[k]]))) };
  if (c.tipo === 'treinar') return { op: 'treinar', parametro: c.projeto || null, valor: c.imagens.join(', ') };
  return null;
}

/** Depois de um turno concluído: grava no aivision-via (se o usuário deixou). Nunca lança. */
async function registrarTurno(itemUsuario, itensTurno, r) {
  if (!lerPreferencias().salvarServidor) return;
  const vias = itensTurno.filter((it) => it.tipo === 'via');
  const cartoes = itensTurno.filter((it) => it.tipo === 'cartao' && comandoDoCartao(it.cartao));
  const uso = r.uso || {};
  try {
    const res = await srv.registrar({
      conversa_id: conversa.servidorId,
      pergunta: itemUsuario.texto,
      resposta: vias.map((v) => v.texto).join('\n\n').slice(0, 100000),
      modelo: r.modelo || lerPreferencias().modelo,
      tokens_in: (uso.entrada || 0) + (uso.cacheLido || 0) + (uso.cacheEscrito || 0),
      tokens_out: uso.saida || 0,
      comandos: cartoes.map((it) => comandoDoCartao(it.cartao)).slice(0, 50),
      anexos: (itemUsuario.anexos || []).map((id) => conversa.anexos.get(id)).filter(Boolean)
        .map((a) => ({ sha256: a.sha256, largura: a.largura, altura: a.altura })),
    });
    conversa.servidorId = res.conversa_id;
    itemUsuario.msgId = res.mensagem_usuario_id;
    for (const v of vias) v.msgId = res.mensagem_via_id;
    cartoes.forEach((it, i) => { it.msgId = res.mensagem_via_id; it.comandoId = res.comandos[i]; });
    if (conversa.avisoServidor) conversa.avisoServidor = '';
  } catch (e) {
    if (e && e.status === 404 && conversa.servidorId) { conversa.servidorId = null; }   // conversa apagada na aba Base
    conversa.avisoServidor = `Esta conversa não foi salva no servidor (${e && e.message ? e.message : 'erro'}).`;
  }
  mudou();
}

/** Marca no servidor que o comando do cartão foi aplicado/salvo (silencioso). */
function marcarNoServidor(item, marca) {
  if (item && item.comandoId) srv.marcarComando(item.comandoId, marca).catch(() => {});
}

// ============================================================ quadro do vídeo

/**
 * Quadro atual como JPEG base64, no máximo 768 px de largura. Usa o elemento
 * da FONTE (sem as caixas desenhadas por cima); se não der, o canvas exibido.
 */
function capturarQuadro(source, displayCanvas) {
  const MAX = 768;
  const tentar = (el, w0, h0) => {
    if (!el || !w0 || !h0) return null;
    const w = Math.min(MAX, w0), h = Math.round((w * h0) / w0);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(el, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', 0.82);
    const base64 = url.slice(url.indexOf(',') + 1);
    return base64.length > 200 ? { base64, w, h } : null;
  };
  try {
    const src = source && source.current;
    const sz = src && src.size;
    const r = src && src.element && sz ? tentar(src.element, sz.width, sz.height) : null;
    if (r) return r;
  } catch (_) { /* fonte sem quadro ou protegida: tenta o canvas */ }
  try {
    const d = displayCanvas && displayCanvas.current;
    return d ? tentar(d, d.width, d.height) : null;
  } catch (_) { return null; }
}

// ============================================================ ações dos cartões

/** Aplica o valor num nó do Pipeline (o do contexto, senão o primeiro com o op; cria se não houver). */
function aplicarNoPipeline(op, parametro, valor, nodeId = null) {
  const ns = store.get().nodes;
  let i = nodeId ? ns.findIndex((n) => n.id === nodeId && n.op === op) : -1;
  if (i < 0) i = ns.findIndex((n) => n.op === op);
  let novos, id;
  if (i >= 0) {
    id = ns[i].id;
    novos = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null, params: { ...n.params, [parametro]: valor } } : n));
  } else {
    id = newNodeId();
    novos = [...ns, { id, op, params: { ...defaultParams(op), [parametro]: valor }, enabled: true }];
  }
  store.set({ nodes: novos, selectedNode: id, panels: { ...store.get().panels, pipeline: true } });
  persist();
  return i >= 0 ? 'Aplicado no nó do Pipeline.' : 'Nó adicionado ao Pipeline com este valor.';
}

function adicionarNo(op, params) {
  const id = newNodeId();
  store.set({ nodes: [...store.get().nodes, { id, op, params: { ...defaultParams(op), ...params }, enabled: true }],
    selectedNode: id, panels: { ...store.get().panels, pipeline: true } });
  persist();
}

async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch (_) {
    try {
      const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    } catch (__) { return false; }
  }
}

// ============================================================ enviar

async function enviar(textoUsuario, { comImagem, source, displayCanvas, comAnexos = false }) {
  if (conversa.ocupado) return;
  const prontos = comAnexos ? conversa.rascunho.filter((a) => !a.preparando) : [];
  let txt = String(textoUsuario || '').trim();
  if (!txt && !prontos.length) return;
  if (!txt) txt = prontos.length > 1 ? 'Veja as imagens anexadas.' : 'Veja a imagem anexada.';

  const conteudo = [];
  let img = null;
  if (comImagem) {
    img = capturarQuadro(source, displayCanvas);
    if (img) conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img.base64 } });
  }
  // anexos: cada um vira um bloco image, com um id curto (A1, A2…) que a Via usa nas ferramentas
  const ids = [];
  for (const a of prontos) {
    const id = 'A' + (++conversa.nAnexo);
    conversa.anexos.set(id, { ...a, id });
    ids.push(id);
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a.base64 } });
  }
  if (prontos.length) {
    conversa.rascunho = conversa.rascunho.filter((a) => a.preparando);
    conteudo.push({ type: 'text', text: 'Imagens anexadas pelo usuário, na ordem: ' +
      ids.map((id) => { const a = conversa.anexos.get(id); return `${id} (${a.nome}, ${a.largura}×${a.altura})`; }).join('; ') + '.' });
  }
  conteudo.push({ type: 'text', text: txt });

  const itemUsuario = novoItem({ tipo: 'usuario', texto: txt, imagem: img ? `data:image/jpeg;base64,${img.base64}` : null,
    semImagem: comImagem && !img, anexos: ids });
  conversa.itens.push(itemUsuario);
  const inicioTurno = conversa.itens.length;
  let marca = inicioTurno;          // início da volta atual (para descartar um parcial)
  let viva = null;                  // bolha de texto recebendo o streaming
  conversa.ocupado = true;
  conversa.passo = 'pensando';
  mudou();

  controlador = new AbortController();
  const sinal = controlador.signal;
  const nodeId = conversa.contexto && conversa.contexto.nodeId;

  const ui = {
    onPasso: (p) => {
      conversa.passo = p.fase === 'ferramentas' ? `usando ${p.nomes.join(', ')}` : 'pensando';
      if (p.fase === 'pensando') { marca = conversa.itens.length; viva = null; }
      mudou();
    },
    onTexto: (d) => {
      if (!viva) { viva = novoItem({ tipo: 'via', texto: '', pergunta: txt }); conversa.itens.push(viva); }
      viva.texto += d;
      conversa.passo = 'escrevendo';
      mudou();
    },
    onDescartar: () => { conversa.itens.length = Math.max(marca, inicioTurno); viva = null; mudou(); },
    mostrarCartao: (c) => { viva = null; conversa.itens.push(novoItem({ tipo: 'cartao', cartao: { ...c, nodeId }, status: '', pergunta: txt })); mudou(); },
    anexo: (id) => conversa.anexos.get(id) || null,
    onBusca: (q, n) => { conversa.itens.push(novoItem({ tipo: 'busca', texto: `consultou a base: «${q}» · ${n} trecho(s)` })); mudou(); },
    pedirPermissaoImagem: (motivo) => {
      if (conversa.imagemLivre) return Promise.resolve(true);
      viva = null;
      return new Promise((resolve) => {
        const it = novoItem({ tipo: 'permissao', motivo, resolver: null, status: '' });
        it.resolver = (v, sempre) => {
          if (it.status) return;
          it.status = v ? (sempre ? 'permitido nesta conversa' : 'permitido') : 'recusado';
          if (v && sempre) conversa.imagemLivre = true;
          mudou(); resolve(v);
        };
        sinal.addEventListener('abort', () => it.resolver(false), { once: true });
        conversa.itens.push(it); mudou();
      });
    },
    capturarQuadro: () => capturarQuadro(source, displayCanvas),
  };

  try {
    const r = await turno(conversa.historico, conteudo, ui, sinal);
    conversa.uso = somarUso(conversa.uso, r.uso);
    if (r.fim === 'end_turn' || (r.fim === 'max_tokens' && !(r.detalhes && r.detalhes.ferramenta))) {
      registrarTurno(itemUsuario, conversa.itens.slice(inicioTurno), r);   // em segundo plano; falha vira aviso
    }
    if (r.fim === 'refusal') {
      conversa.itens.length = inicioTurno;     // o parcial recusado não vale
      const cat = r.detalhes && r.detalhes.category;
      conversa.itens.push(novoItem({ tipo: 'aviso', texto: `A Via não pode responder a este pedido${cat ? ` (categoria: ${cat})` : ''}. Reformule a pergunta — o histórico continua como antes dela.` }));
      itemUsuario.descartado = true;
    } else if (r.fim === 'max_tokens') {
      if (r.detalhes && r.detalhes.ferramenta) {
        conversa.itens.length = inicioTurno;
        itemUsuario.descartado = true;
        conversa.itens.push(novoItem({ tipo: 'aviso', texto: 'A resposta foi cortada no meio de uma ferramenta e não foi executada. Peça algo menor ou divida o pedido.' }));
      } else {
        conversa.itens.push(novoItem({ tipo: 'aviso', texto: 'A resposta atingiu o tamanho máximo e foi cortada.' }));
      }
    } else if (r.fim === 'erro') {
      conversa.itens.length = inicioTurno;
      itemUsuario.descartado = true;
      conversa.itens.push(novoItem({ tipo: 'erro', texto: r.detalhes.mensagem, reenviar: txt }));
    }
  } catch (e) {
    const t = await traduzirErro(e);
    conversa.itens.length = inicioTurno;     // o turno foi cortado do histórico: tira da tela também
    itemUsuario.descartado = t.tipo !== 'parado';
    conversa.itens.push(novoItem({ tipo: t.tipo === 'parado' ? 'aviso' : 'erro', texto: t.mensagem, erroTipo: t.tipo,
      reenviar: t.tipo === 'parado' || t.tipo === 'chave' ? null : txt }));
    if (e instanceof SemChave) conversa.precisaChave = true;
  } finally {
    conversa.ocupado = false;
    conversa.passo = '';
    controlador = null;
    mudou();
  }
}

function somarUso(a, b) {
  if (!b) return a;
  const x = a || { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0 };
  return { entrada: x.entrada + b.entrada, saida: x.saida + b.saida, cacheLido: x.cacheLido + b.cacheLido, cacheEscrito: x.cacheEscrito + b.cacheEscrito };
}

// ============================================================ texto da Via (markdown mínimo, sem innerHTML)

function inline(s, k) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let ult = 0, m, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > ult) out.push(s.slice(ult, m.index));
    const t = m[0];
    out.push(t.startsWith('**') ? html`<b key=${k + '-' + i++}>${t.slice(2, -2)}</b>` : html`<code key=${k + '-' + i++}>${t.slice(1, -1)}</code>`);
    ult = m.index + t.length;
  }
  if (ult < s.length) out.push(s.slice(ult));
  return out;
}

/*
 * Memorizado pelo texto: cada tecla no campo de mensagem e cada pedaço do
 * streaming re-renderizam a gaveta inteira, e sem isto TODAS as respostas da
 * conversa eram reanalisadas e recriadas a cada vez (conversa longa = digitação
 * travando). Só a resposta que está chegando muda de texto.
 */
const Markdown = React.memo(MarkdownBruto);
function MarkdownBruto({ texto }) {
  const blocos = [];
  const linhas = String(texto || '').split('\n');
  let lista = null, codigo = null, k = 0;
  const fechaLista = () => { if (lista) { blocos.push(html`<ul key=${'l' + k++}>${lista}</ul>`); lista = null; } };
  for (const ln of linhas) {
    if (ln.trim().startsWith('```')) {
      if (codigo) { blocos.push(html`<pre key=${'c' + k++}>${codigo.join('\n')}</pre>`); codigo = null; } else { fechaLista(); codigo = []; }
      continue;
    }
    if (codigo) { codigo.push(ln); continue; }
    const li = ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { (lista = lista || []).push(html`<li key=${'i' + k++}>${inline(li[1], 'i' + k)}</li>`); continue; }
    fechaLista();
    if (!ln.trim()) continue;
    const h = ln.match(/^#{1,4}\s+(.*)$/);
    blocos.push(h ? html`<p key=${'p' + k++} class="via-h">${inline(h[1], 'h' + k)}</p>` : html`<p key=${'p' + k++}>${inline(ln, 'p' + k)}</p>`);
  }
  fechaLista();
  if (codigo) blocos.push(html`<pre key=${'c' + k++}>${codigo.join('\n')}</pre>`);
  return html`<${Fragment}>${blocos}<//>`;
}

// ============================================================ cartões

function CartaoComando({ item }) {
  const c = item.cartao;
  const [valor, setValor] = useState(c.valor);
  const [nome, setNome] = useState(c.nome || '');
  const [salvando, setSalvando] = useState(false);
  const def = getOperator(c.op);
  const marcar = (s) => { item.status = s; mudou(); };
  return html`
    <div class="via-cartao">
      <div class="via-cartao-t"><span class="via-tag">comando</span> ${c.rotuloOp} › <b>${c.rotuloCampo}</b></div>
      ${c.explicacao && html`<p class="via-cartao-x">${c.explicacao}</p>`}
      <textarea class="via-valor" rows=${Math.min(6, Math.max(2, Math.ceil(valor.length / 46)))} value=${valor}
                aria-label="Valor proposto (editável)" spellcheck="false"
                onInput=${(e) => setValor(e.target.value)}></textarea>
      <code class="via-cartao-op">${c.op}.${c.parametro}</code>
      ${salvando && html`
        <div class="via-cartao-salvar">
          <input class="txt" value=${nome} placeholder="Nome do comando" onInput=${(e) => setNome(e.target.value)} />
          <button class="btn tiny accent" disabled=${!nome.trim()} onClick=${() => {
            try {
              salvarComando({ nome: nome.trim(), op: c.op, parametro: c.parametro, valor, categoria: c.categoria, descricao: c.explicacao, origem: 'via' });
              setSalvando(false); marcar('✓ salvo na biblioteca'); marcarNoServidor(item, { salvo: true });
            } catch (e) { marcar('⚠ ' + e.message); }
          }}>Confirmar</button>
        </div>`}
      <div class="via-cartao-acts">
        <button class="btn tiny accent" disabled=${!def} onClick=${() => { marcar('✓ ' + aplicarNoPipeline(c.op, c.parametro, valor, c.nodeId)); marcarNoServidor(item, { aplicado: true }); }}>Aplicar no Pipeline</button>
        <button class="btn tiny" onClick=${() => setSalvando((v) => !v)}>Salvar</button>
        <button class="btn tiny" onClick=${async () => marcar((await copiar(valor)) ? '✓ copiado' : '⚠ não consegui copiar')}>Copiar</button>
        <${BotaoBase} item=${item} titulo=${`${c.rotuloOp} › ${c.rotuloCampo}`}
          texto=${`${c.op}.${c.parametro}: ${valor}${c.explicacao ? `\n\n${c.explicacao}` : ''}`} tags=${['comando', c.op]} />
      </div>
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>
  `;
}

function CartaoSalvar({ item }) {
  const c = item.cartao;
  const [cat, setCat] = useState(c.categoria || '');
  const cats = listarCategorias();
  const marcar = (s) => { item.status = s; mudou(); };
  return html`
    <div class="via-cartao">
      <div class="via-cartao-t"><span class="via-tag">salvar</span> <b>${c.nome}</b></div>
      <div class="via-cartao-x">${c.rotuloOp} › ${c.rotuloCampo}${c.descricao ? ` — ${c.descricao}` : ''}</div>
      <pre class="via-valor ro">${c.valor}</pre>
      <label class="ctl">
        <span class="ctl-label">Categoria</span>
        <select value=${cat} onChange=${(e) => setCat(e.target.value)}>
          ${c.categoriaNova && html`<option value="">nova: ${c.categoriaNova}</option>`}
          ${cats.map((k) => html`<option key=${k.id} value=${k.id}>${k.nome}</option>`)}
        </select>
      </label>
      ${!item.status && html`
        <div class="via-cartao-acts">
          <button class="btn tiny accent" onClick=${() => {
            try {
              const categoria = cat || criarCategoria(c.categoriaNova).id;
              salvarComando({ nome: c.nome, op: c.op, parametro: c.parametro, valor: c.valor, categoria, descricao: c.descricao, origem: 'via' });
              marcar('✓ salvo na biblioteca'); marcarNoServidor(item, { salvo: true });
            } catch (e) { marcar('⚠ ' + e.message); }
          }}>Salvar na biblioteca</button>
          <button class="btn tiny" onClick=${() => marcar('descartado')}>Descartar</button>
        </div>`}
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>
  `;
}

function CartaoOperador({ item }) {
  const c = item.cartao;
  const marcar = (s) => { item.status = s; mudou(); };
  return html`
    <div class="via-cartao">
      <div class="via-cartao-t"><span class="via-tag">operador</span> <b>${c.rotuloOp}</b>${c.agpl ? html` <i class="presets-agpl">AGPL</i>` : ''}</div>
      ${c.explicacao && html`<p class="via-cartao-x">${c.explicacao}</p>`}
      ${c.mudados.length > 0 && html`
        <dl class="via-params">
          ${c.mudados.map((k) => html`<${Fragment} key=${k}><dt>${k}</dt><dd>${String(c.params[k])}</dd><//>`)}
        </dl>`}
      <code class="via-cartao-op">${c.op}</code>
      ${!item.status && html`
        <div class="via-cartao-acts">
          <button class="btn tiny accent" onClick=${() => { adicionarNo(c.op, c.params); marcar('✓ adicionado ao Pipeline'); marcarNoServidor(item, { aplicado: true }); }}>Adicionar ao Pipeline</button>
          <button class="btn tiny" onClick=${() => marcar('descartado')}>Agora não</button>
        </div>`}
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>
  `;
}

// ------------------------------------------------------------ «Salvar na base»

/** Formulário curto para guardar um trecho na base de conhecimento (aivision-via). */
function SalvarNaBase({ tituloInicial = '', textoInicial = '', tagsIniciais = [], origemId = null, onFim }) {
  const [titulo, setTitulo] = useState(String(tituloInicial).replace(/\s+/g, ' ').slice(0, 120));
  const [texto, setTexto] = useState(textoInicial);
  const [tags, setTags] = useState(tagsIniciais.join(', '));
  const [comp, setComp] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [st, setSt] = useState(null);
  useEffect(() => { let vivo = true; perfil().then((p) => { if (vivo) setAdmin(Boolean(p && p.admin)); }); return () => { vivo = false; }; }, []);
  const salvar = async () => {
    setSt({ tipo: 'testando', msg: 'Salvando…' });
    try {
      await srv.salvarConhecimento({ titulo: titulo.trim(), texto: texto.trim(), compartilhado: comp,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12), origem_mensagem_id: origemId });
      setSt({ tipo: 'ok', msg: comp ? 'Salvo na base e compartilhado com a equipe.' : 'Salvo na sua base.' });
      setTimeout(() => onFim && onFim(true), 1200);
    } catch (e) { setSt({ tipo: 'erro', msg: e.message }); }
  };
  return html`
    <div class="via-base-form">
      <input class="txt" value=${titulo} maxlength="200" placeholder="Título (ex.: Iluminação para esteira)" aria-label="Título"
             onInput=${(e) => setTitulo(e.target.value)} />
      <textarea class="via-valor" rows="4" value=${texto} aria-label="Texto a salvar" onInput=${(e) => setTexto(e.target.value)}></textarea>
      <input class="txt" value=${tags} placeholder="Etiquetas, separadas por vírgula" aria-label="Etiquetas" onInput=${(e) => setTags(e.target.value)} />
      ${admin && html`<label class="via-check"><input type="checkbox" checked=${comp} onChange=${(e) => setComp(e.target.checked)} /> Compartilhar com toda a equipe (admin)</label>`}
      <div class="via-cartao-acts">
        <button class="btn tiny accent" disabled=${!titulo.trim() || !texto.trim() || (st && st.tipo === 'testando')} onClick=${salvar}>Salvar na base</button>
        <button class="btn tiny" onClick=${() => onFim && onFim(false)}>Cancelar</button>
      </div>
      ${st && html`<p class="hint tight via-estado ${st.tipo}" role="status">${st.tipo === 'erro' ? '⚠ ' : st.tipo === 'ok' ? '✓ ' : ''}${st.msg}</p>`}
    </div>`;
}

/** Botão «Salvar na base» + formulário (em respostas e cartões). */
function BotaoBase({ item, titulo, texto, tags = [] }) {
  const [aberto, setAberto] = useState(false);
  if (item.salvoNaBase) return html`<span class="via-salvo">✓ na base</span>`;
  if (!aberto) return html`<button class="btn tiny via-base-bt" title="Guardar este trecho na base de conhecimento (servidor da GPlanSiS)" onClick=${() => setAberto(true)}>Salvar na base</button>`;
  return html`<div class="via-base-pop"><${SalvarNaBase} tituloInicial=${titulo || item.pergunta || ''} textoInicial=${texto} tagsIniciais=${tags}
    origemId=${item.msgId || null} onFim=${(ok) => { setAberto(false); if (ok) { item.salvoNaBase = true; mudou(); } }} /></div>`;
}

// ------------------------------------------------------------ Treinar (anexos → projeto)

/** Cartão para mandar anexos a um projeto do Treinar. Usado pela ferramenta e pelo botão da mensagem. */
function CartaoTreinar({ item, onFechar = null }) {
  const c = item.cartao;
  const anexos = c.imagens.map((id) => conversa.anexos.get(id)).filter(Boolean);
  const [token, setToken] = useState(lerToken);
  const [quem, setQuem] = useState(lerQuem);
  const [sso, setSso] = useState(!lerToken());
  const [senha, setSenha] = useState('');
  const [projetos, setProjetos] = useState(null);
  const [pid, setPid] = useState(c.projeto || '');
  const [grupo, setGrupo] = useState(c.grupo || 'boa');
  const [marcadas, setMarcadas] = useState(() => new Set(anexos.map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const marcar = (t) => { item.status = t; mudou(); };

  useEffect(() => {   // sem token: tenta a conta (SSO de admin; quem decide é o servidor)
    if (token) { setSso(false); return; }
    let vivo = true;
    entrarPorSessao().then((r) => { if (!vivo) return; setSso(false); if (r) { setToken(r.token); setQuem(r.email); } });
    return () => { vivo = false; };
  }, []);
  useEffect(() => {
    if (!token) return;
    let vivo = true;
    listarProjetos().then((ps) => {
      if (!vivo) return;
      setProjetos(ps || []);
      if (ps && ps.length && !ps.some((p) => p.id === pid)) setPid(ps[0].id);
    }).catch((e) => { if (!vivo) return; if (e.status === 401) { setToken(''); setMsg('A sessão do Treinar expirou. Entre de novo.'); } else setMsg(e.message); });
    return () => { vivo = false; };
  }, [token]);

  const entrar = async (e) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try { const t = await entrarComSenha(senha); setSenha(''); setQuem(''); setToken(t); }
    catch (err) { setMsg(err.status === 401 ? 'Senha incorreta.' : err.message); }
    finally { setBusy(false); }
  };
  const proj = projetos && projetos.find((p) => p.id === pid);
  const anomalia = proj && proj.tipo === 'anomalia';
  const escolhidas = anexos.filter((a) => marcadas.has(a.id));
  const enviar = async () => {
    if (!proj || !escolhidas.length) return;
    setBusy(true); setMsg('');
    try {
      const r = await enviarImagens(proj.id, escolhidas.map((a) => ({ blob: a.blob, nome: a.nome })),
        { grupo: anomalia ? grupo : '', aoProgredir: (n, t) => setMsg(`Enviando ${n} de ${t}…`) });
      for (const a of escolhidas) a.treinar = proj.nome;
      srv.anotarTreinar(escolhidas.map((a) => a.sha256), proj.id).catch(() => {});
      marcar(`✓ ${r.enviadas.length} imagem(ns) enviadas para «${proj.nome}»` + (anomalia ? ` como ${grupo === 'boa' ? 'BOAS' : 'RUINS'}` : '') +
        (r.erros.length ? `. Erros: ${r.erros.slice(0, 3).join('; ')}` : '.') + (!anomalia ? ' Rotule as caixas no Treinar.' : ''));
      setMsg('');
    } catch (err) {
      if (err.status === 401) { setToken(''); setMsg('A sessão do Treinar expirou. Entre de novo.'); } else setMsg('⚠ ' + err.message);
    } finally { setBusy(false); }
  };

  return html`
    <div class="via-cartao via-cartao-treinar">
      <div class="via-cartao-t"><span class="via-tag">treinar</span> Mandar ${anexos.length} imagem(ns) para o Treinar
        ${onFechar && html`<button class="via-x" aria-label="Fechar" onClick=${onFechar}>✕</button>`}</div>
      ${c.explicacao && html`<p class="via-cartao-x">${c.explicacao}</p>`}
      <div class="via-anexos">
        ${anexos.map((a) => html`
          <label key=${a.id} class="via-anexo ${marcadas.has(a.id) ? '' : 'fora'}" title=${`${a.id} · ${a.nome} · ${a.largura}×${a.altura}`}>
            <img src=${a.url} alt=${a.nome} />
            <input type="checkbox" checked=${marcadas.has(a.id)} disabled=${Boolean(item.status)} aria-label=${'Enviar ' + a.id}
                   onChange=${() => setMarcadas((m) => { const n = new Set(m); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })} />
            <i>${a.id}</i>
          </label>`)}
      </div>
      ${item.status ? html`<p class="via-cartao-st" role="status">${item.status}</p>`
        : !token && sso ? html`<p class="hint tight">Conferindo a sua conta…</p>`
        : !token ? html`
          <p class="hint tight">Para enviar, entre no Treinar (administradores entram pela conta automaticamente).</p>
          <form class="via-cartao-salvar" onSubmit=${entrar}>
            <input class="txt" type="password" placeholder="Senha do Treinar" value=${senha} autocomplete="current-password"
                   aria-label="Senha do Treinar" onInput=${(e) => setSenha(e.target.value)} />
            <button class="btn tiny accent" type="submit" disabled=${busy || !senha}>Entrar</button>
          </form>`
        : !projetos ? html`<p class="hint tight">Carregando projetos…</p>`
        : projetos.length === 0 ? html`<p class="hint tight">Nenhum projeto no Treinar. Crie um em <a href="/treino/" target="_blank" rel="noopener">Treinar modelos ↗</a>.</p>`
        : html`
          ${quem && html`<p class="hint tight via-quem">Entrou como ${quem} · admin</p>`}
          <label class="ctl">
            <span class="ctl-label">Projeto</span>
            <select value=${pid} onChange=${(e) => setPid(e.target.value)}>
              ${projetos.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome} — ${p.tipo === 'anomalia' ? 'anomalia' : 'detector'}</option>`)}
            </select>
          </label>
          ${anomalia && html`
            <div class="via-radios" role="radiogroup" aria-label="Grupo">
              <label><input type="radio" name=${'via-grupo-' + item.id} checked=${grupo === 'boa'} onChange=${() => setGrupo('boa')} /> peças boas</label>
              <label><input type="radio" name=${'via-grupo-' + item.id} checked=${grupo === 'ruim'} onChange=${() => setGrupo('ruim')} /> peças ruins</label>
            </div>`}
          <div class="via-cartao-acts">
            <button class="btn tiny accent" disabled=${busy || !proj || !escolhidas.length} onClick=${enviar}>${busy ? 'Enviando…' : `Enviar ${escolhidas.length} ao Treinar`}</button>
            <button class="btn tiny" disabled=${busy} onClick=${() => { marcar('não enviado'); if (onFechar) onFechar(); }}>Agora não</button>
            <button class="btn tiny" disabled=${busy} onClick=${() => { gravarToken(''); setToken(''); setQuem(''); setProjetos(null); }}>Sair do Treinar</button>
          </div>`}
      ${msg && html`<p class="hint tight" role="status">${msg}</p>`}
    </div>`;
}

function CartaoPermissao({ item }) {
  return html`
    <div class="via-cartao via-cartao-perm">
      <div class="via-cartao-t"><span class="via-tag">imagem</span> A Via quer ver o quadro atual do vídeo</div>
      <p class="via-cartao-x">${item.motivo}</p>
      <p class="hint tight">Vai uma imagem reduzida (~768 px) para a Anthropic, com a sua chave. Nada mais do vídeo sai do aparelho.</p>
      ${!item.status && html`
        <div class="via-cartao-acts">
          <button class="btn tiny accent" onClick=${() => item.resolver(true, false)}>Permitir uma vez</button>
          <button class="btn tiny" onClick=${() => item.resolver(true, true)}>Nesta conversa</button>
          <button class="btn tiny" onClick=${() => item.resolver(false)}>Agora não</button>
        </div>`}
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>
  `;
}

function MsgUsuario({ item }) {
  const [treinar, setTreinar] = useState(null);
  const anexos = (item.anexos || []).map((id) => conversa.anexos.get(id)).filter(Boolean);
  return html`<${Fragment}>
    <div class="via-msg eu ${item.descartado ? 'descartado' : ''}">
      ${item.imagem && html`<img class="via-img" src=${item.imagem} alt="Quadro do vídeo enviado" />`}
      ${item.semImagem && html`<em class="via-sub">(sem quadro disponível — foi só o texto)</em>`}
      ${anexos.length > 0 && html`
        <div class="via-anexos">
          ${anexos.map((a) => html`<span key=${a.id} class="via-anexo" title=${`${a.id} · ${a.nome} · ${a.largura}×${a.altura}${a.treinar ? ` · enviada ao Treinar (${a.treinar})` : ''}`}>
            <img src=${a.url} alt=${a.nome} /><i>${a.id}${a.treinar ? ' ✓' : ''}</i></span>`)}
        </div>`}
      <div>${item.texto}</div>
      ${anexos.length > 0 && !item.descartado && !treinar && html`
        <button class="via-link" onClick=${() => setTreinar(novoItem({ tipo: 'cartao', cartao: { tipo: 'treinar', imagens: anexos.map((a) => a.id), projeto: '', grupo: 'boa', explicacao: '' }, status: '' }))}>
          Mandar ${anexos.length > 1 ? 'estas imagens' : 'esta imagem'} para o Treinar</button>`}
    </div>
    ${treinar && html`<${CartaoTreinar} item=${treinar} onFechar=${() => setTreinar(null)} />`}<//>`;
}

function Item({ item, onReenviar, onChave }) {
  if (item.tipo === 'usuario') return html`<${MsgUsuario} item=${item} />`;
  if (item.tipo === 'via') {
    return html`
      <div class="via-msg ela"><${Markdown} texto=${item.texto} />
        ${item.texto.trim().length > 20 && html`<div class="via-msg-acts"><${BotaoBase} item=${item} texto=${item.texto} /></div>`}
      </div>`;
  }
  if (item.tipo === 'busca') return html`<p class="via-busca-nota">📚 ${item.texto}</p>`;
  if (item.tipo === 'cartao') {
    const t = item.cartao.tipo;
    if (t === 'comando') return html`<${CartaoComando} item=${item} />`;
    if (t === 'salvar') return html`<${CartaoSalvar} item=${item} />`;
    if (t === 'operador') return html`<${CartaoOperador} item=${item} />`;
    if (t === 'treinar') return html`<${CartaoTreinar} item=${item} />`;
  }
  if (item.tipo === 'permissao') return html`<${CartaoPermissao} item=${item} />`;
  if (item.tipo === 'aviso') return html`<p class="via-nota" role="status">${item.texto}</p>`;
  if (item.tipo === 'erro') {
    return html`
      <div class="via-nota erro" role="alert">
        <span>⚠ ${item.texto}</span>
        ${item.reenviar && html`<button class="btn tiny" onClick=${() => onReenviar(item.reenviar)}>Tentar de novo</button>`}
        ${item.erroTipo === 'chave' && html`<button class="btn tiny" onClick=${onChave}>Chave e modelo</button>`}
      </div>`;
  }
  return null;
}

// ============================================================ biblioteca

function Biblioteca({ contexto }) {
  const [, setN] = useState(0);
  useEffect(() => ouvirComandos(() => setN((n) => n + 1)), []);
  const [cat, setCat] = useState('');
  const [busca, setBusca] = useState('');
  const [novaCat, setNovaCat] = useState('');
  const [aviso, setAviso] = useState('');
  const arquivo = useRef(null);
  const cats = listarCategorias();
  const q = busca.trim().toLowerCase();
  const lista = listarComandos({ categoria: cat || null })
    .filter((c) => !q || `${c.nome} ${c.valor} ${c.op} ${c.parametro}`.toLowerCase().includes(q));
  const avisar = (s) => { setAviso(s); setTimeout(() => setAviso(''), 3500); };

  function exportar() {
    const blob = new Blob([exportarJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `iavision-comandos-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importar(f) {
    if (!f) return;
    try {
      const r = importarJSON(await f.text());
      avisar(`Importado: ${r.novos} novo(s), ${r.atualizados} atualizado(s)${r.ignorados ? `, ${r.ignorados} ignorado(s)` : ''}.`);
    } catch (e) { avisar('⚠ ' + e.message); }
  }

  return html`
    <div class="via-bib">
      <p class="hint tight">Comandos salvos por você e pela Via, por usuário, neste navegador. Também aparecem no <b>★</b> ao lado de cada campo do Pipeline.</p>
      <div class="via-bib-filtro">
        <select value=${cat} onChange=${(e) => setCat(e.target.value)} aria-label="Categoria">
          <option value="">Todas as categorias</option>
          ${cats.map((k) => html`<option key=${k.id} value=${k.id}>${k.nome}</option>`)}
        </select>
        <input class="txt" value=${busca} placeholder="Procurar…" onInput=${(e) => setBusca(e.target.value)} aria-label="Procurar comandos" />
      </div>

      ${lista.length === 0 && html`<p class="empty">Nenhum comando${cat || q ? ' neste filtro' : ' ainda'}. Peça um à Via e clique em <b>Salvar</b> no cartão.</p>`}
      <div class="via-bib-lista">
        ${lista.map((c) => {
          const def = getOperator(c.op);
          const sch = def && def.params && def.params[c.parametro];
          return html`
            <div key=${c.id} class="via-bib-item">
              <div class="via-bib-h">
                <b>${c.nome}</b>
                <span class="via-tag">${nomeCategoria(c.categoria)}</span>
              </div>
              <div class="via-bib-o">${def ? def.label : c.op} › ${sch ? sch.label || c.parametro : c.parametro}${c.origem === 'via' ? ' · pela Via' : ''} · ${new Date(c.criadoEm).toLocaleDateString('pt-BR')}</div>
              <pre class="via-valor ro">${c.valor}</pre>
              <div class="via-cartao-acts">
                <button class="btn tiny accent" disabled=${!def} onClick=${() => avisar('✓ ' + aplicarNoPipeline(c.op, c.parametro, c.valor, contexto && contexto.op === c.op ? contexto.nodeId : null))}>Aplicar</button>
                <button class="btn tiny" onClick=${async () => avisar((await copiar(c.valor)) ? '✓ copiado' : '⚠ não consegui copiar')}>Copiar</button>
                <button class="btn tiny via-perigo" onClick=${() => { if (confirm(`Apagar «${c.nome}»?`)) apagarComando(c.id); }}>Apagar</button>
              </div>
            </div>`;
        })}
      </div>
      ${aviso && html`<p class="hint tight" role="status">${aviso}</p>`}

      <div class="sep"></div>
      <div class="cfg-sub">Categorias</div>
      <div class="via-bib-filtro">
        <input class="txt" value=${novaCat} placeholder="Nova categoria (ex.: Linha 3)" onInput=${(e) => setNovaCat(e.target.value)}
               onKeyDown=${(e) => { if (e.key === 'Enter' && novaCat.trim()) { try { criarCategoria(novaCat); setNovaCat(''); } catch (er) { avisar('⚠ ' + er.message); } } }} />
        <button class="btn tiny" disabled=${!novaCat.trim()} onClick=${() => { try { criarCategoria(novaCat); setNovaCat(''); avisar('✓ categoria criada'); } catch (er) { avisar('⚠ ' + er.message); } }}>Criar</button>
      </div>
      <div class="row tight">
        <button class="btn" onClick=${exportar}>Exportar JSON</button>
        <button class="btn" onClick=${() => arquivo.current && arquivo.current.click()}>Importar JSON</button>
        <input ref=${arquivo} type="file" accept="application/json,.json" hidden
               onChange=${(e) => { importar(e.target.files && e.target.files[0]); e.target.value = ''; }} />
      </div>
      <p class="hint tight">A exportação leva só os comandos e as categorias — nunca a chave nem a conversa.</p>
    </div>
  `;
}

// ============================================================ Base (conhecimento + histórico no servidor)

const dataBR = (t) => { try { return new Date(t).toLocaleDateString('pt-BR'); } catch (_) { return ''; } };

function Base() {
  const [eu, setEu] = useState(undefined);        // undefined = carregando; null = serviço fora
  const [itens, setItens] = useState(null);
  const [q, setQ] = useState('');
  const [buscado, setBuscado] = useState('');
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState(false);
  const [hist, setHist] = useState(null);
  const [aviso, setAviso] = useState('');
  const avisar = (t) => { setAviso(t); setTimeout(() => setAviso(''), 4000); };

  const carregar = async (busca = buscado) => {
    setErro('');
    try {
      if (busca) { const r = await srv.buscar(busca, 20); setItens(r.trechos.map((t) => ({ ...t, texto: t.trecho }))); }
      else setItens(await srv.listarConhecimento('todos'));
    } catch (e) { setErro(e.message); setItens([]); }
  };
  const carregarHist = async () => { try { setHist(await srv.historico(30)); } catch (e) { setHist({ erro: e.message }); } };
  useEffect(() => {
    let vivo = true;
    srv.eu().then((p) => { if (vivo) setEu(p); }).catch((e) => { if (vivo) { setEu(null); setErro(e.message); } });
    carregar(''); carregarHist();
    return () => { vivo = false; };
  }, []);

  const procurar = (e) => { e.preventDefault(); const t = q.trim(); setBuscado(t.length >= 2 ? t : ''); carregar(t.length >= 2 ? t : ''); };
  const admin = Boolean(eu && eu.admin);

  return html`
    <div class="via-base">
      <p class="hint tight">A <b>base de conhecimento</b> fica no servidor da GPlanSiS: trechos que você salvou (botão <b>Salvar na base</b> nas respostas e cartões) e os que a equipe compartilhou. A Via consulta a base antes de responder perguntas técnicas e cita a origem.</p>
      ${eu && html`<p class="hint tight via-quem">Conta: ${eu.email}${admin ? ' · admin (pode compartilhar com todos)' : ''}</p>`}
      <form class="via-bib-filtro" onSubmit=${procurar}>
        <input class="txt" value=${q} placeholder="Procurar na base (ex.: iluminação esteira)" aria-label="Procurar na base" onInput=${(e) => setQ(e.target.value)} />
        <button class="btn tiny accent" type="submit">Buscar</button>
        ${buscado && html`<button class="btn tiny" type="button" onClick=${() => { setQ(''); setBuscado(''); carregar(''); }}>Tudo</button>`}
      </form>
      ${!novo ? html`<div class="row tight"><button class="btn tiny" onClick=${() => setNovo(true)}>＋ Novo item</button></div>`
        : html`<${SalvarNaBase} onFim=${(ok) => { setNovo(false); if (ok) carregar(); }} />`}
      ${erro && html`<p class="via-nota erro" role="alert">⚠ ${erro}</p>`}
      ${itens === null && !erro && html`<p class="hint tight">Carregando…</p>`}
      ${itens && itens.length === 0 && !erro && html`<p class="empty">${buscado ? 'Nada encontrado para esta busca.' : 'A base ainda está vazia. Salve uma resposta útil com «Salvar na base».'}</p>`}
      <div class="via-bib-lista">
        ${(itens || []).map((k) => html`
          <div key=${k.id} class="via-bib-item">
            <div class="via-bib-h">
              <b>${k.titulo}</b>
              <span class=${'via-tag' + (k.meu ? '' : ' via-tag-equipe')}>${k.meu ? (k.compartilhado ? 'minha · compartilhada' : 'minha') : 'equipe'}</span>
            </div>
            <div class="via-bib-o">#${k.id}${k.criado_em ? ' · ' + dataBR(k.criado_em) : ''}${k.tags && k.tags.length ? ' · ' + k.tags.join(', ') : ''}${k.score != null ? ' · relevância ' + k.score.toFixed(2) : ''}</div>
            <pre class="via-valor ro via-base-texto">${k.texto}</pre>
            <div class="via-cartao-acts">
              ${admin && (k.meu || k.compartilhado) && html`<button class="btn tiny" onClick=${async () => {
                try { await srv.compartilhar(k.id, !k.compartilhado); avisar(k.compartilhado ? 'Deixou de ser compartilhado.' : 'Compartilhado com a equipe.'); carregar(); } catch (e) { avisar('⚠ ' + e.message); }
              }}>${k.compartilhado ? 'Deixar de compartilhar' : 'Compartilhar com a equipe'}</button>`}
              ${(k.meu || (admin && k.compartilhado)) && html`<button class="btn tiny via-perigo" onClick=${async () => {
                if (!confirm(`Apagar «${k.titulo}» da base?`)) return;
                try { await srv.apagarConhecimento(k.id); avisar('Apagado.'); carregar(); } catch (e) { avisar('⚠ ' + e.message); }
              }}>Apagar</button>`}
            </div>
          </div>`)}
      </div>
      ${aviso && html`<p class="hint tight" role="status">${aviso}</p>`}

      <div class="sep"></div>
      <div class="cfg-sub">Minhas conversas no servidor</div>
      ${!hist ? html`<p class="hint tight">Carregando…</p>`
        : hist.erro ? html`<p class="hint tight">⚠ ${hist.erro}</p>`
        : html`
          <p class="hint tight">${hist.total} conversa(s) guardada(s)${lerPreferencias().salvarServidor ? '' : ' — o salvamento está desligado em Chave e modelo'}. Só você vê as suas conversas; apagar é definitivo.</p>
          <div class="via-hist">
            ${hist.conversas.map((v) => html`
              <div key=${v.id} class="via-hist-item">
                <span><b>${v.titulo || '(sem título)'}</b><i>${dataBR(v.ultima || v.criada_em)} · ${v.mensagens} mensagem(ns)</i></span>
                <button class="btn tiny via-perigo" onClick=${async () => {
                  if (!confirm('Apagar esta conversa do servidor?')) return;
                  try { await srv.apagarConversa(v.id); if (conversa.servidorId === v.id) conversa.servidorId = null; carregarHist(); } catch (e) { avisar('⚠ ' + e.message); }
                }}>Apagar</button>
              </div>`)}
          </div>
          ${hist.total > 0 && html`<div class="row tight"><button class="btn via-perigo" onClick=${async () => {
            if (!confirm('Apagar TODAS as suas conversas guardadas no servidor? Os itens da base continuam (apague-os acima).')) return;
            try { const r = await srv.apagarTodasConversas(); conversa.servidorId = null; avisar(`${r.apagadas} conversa(s) apagada(s).`); carregarHist(); } catch (e) { avisar('⚠ ' + e.message); }
          }}>Apagar todas as minhas conversas</button></div>`}`}
    </div>
  `;
}

// ============================================================ painel

const SUGESTOES = [
  'Sugira classes de EPI para o YOLOE por texto',
  'Monte um pipeline para contar caminhões que passam',
  'Quais operadores aceitam comando e como escrever cada um?',
];

const VIA_REC_KEY = 'aiv.via.recolhida';

export function ViaPainel({ onClose, source, displayCanvas }) {
  const c = useConversa();
  const [, setN] = useState(0);
  useEffect(() => ouvirBase(() => setN((n) => n + 1)), []);
  const [aba, setAba] = useState('conversa');
  const [texto, setTexto] = useState('');
  const [comImagem, setComImagem] = useState(false);
  const fim = useRef(null);
  const caixa = useRef(null);
  // ▾/▸ ao lado do ✕: recolhida fica só o cabeçalho, no canto de sempre (guardado no aparelho)
  const [recolhida, setRecolhidaBruto] = useState(() => { try { return localStorage.getItem(VIA_REC_KEY) === '1'; } catch (_) { return false; } });
  const setRecolhida = (v) => { setRecolhidaBruto(v); try { v ? localStorage.setItem(VIA_REC_KEY, '1') : localStorage.removeItem(VIA_REC_KEY); } catch (_) { /* storage bloqueado */ } };
  // «Recolher/Abrir todos os painéis» do menu da tela (layout/menu-tela.js)
  useEffect(() => {
    const f = (e) => setRecolhida(Boolean(e.detail));
    addEventListener('aiv:via-recolher', f);
    return () => removeEventListener('aiv:via-recolher', f);
  }, []);

  // contexto pedido por um campo (✨ Via) — ao montar e a cada novo pedido
  useEffect(() => {
    const pegar = () => {
      const ctx = consumirPedido();
      if (!ctx) return;
      // menu de contexto ("Perguntar à Via sobre esta área"): o recorte vem anexado, com uma pergunta inicial
      if (ctx.anexos) {
        setAba('conversa');
        anexar(ctx.anexos);
        setTexto(ctx.texto || '');
        setTimeout(() => { const t = caixa.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30);
        return;
      }
      conversa.contexto = ctx;
      setAba('conversa');
      const def = getOperator(ctx.op);
      setTexto(`Gere um comando para o campo «${ctx.rotulo}» do ${def ? def.label : ctx.op} (${ctx.op}.${ctx.parametro}).`
        + `${ctx.valor ? ` Valor atual: "${ctx.valor}".` : ''} Objetivo: `);
      mudou();
      setTimeout(() => { const t = caixa.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30);
    };
    pegar();
    return ouvirPedidos(pegar);
  }, []);

  useEffect(() => { if (fim.current) fim.current.scrollIntoView({ block: 'end' }); }, [c.itens.length, c.itens.length && c.itens[c.itens.length - 1].texto, c.passo]);

  // Esc fecha (quando o foco não está digitando)
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape' && !conversa.ocupado && !(e.target && e.target.tagName === 'TEXTAREA')) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // sem chave (ou acabou de colar uma e o teste ainda não passou): mostra o formulário
  const [configurando, setConfigurando] = useState(() => !temChave());
  const pronta = emTeste() || (temChave() && !configurando);
  const pref = lerPreferencias();
  const m = modeloInfo(pref.modelo);

  const arquivo = useRef(null);
  const [arrastando, setArrastando] = useState(false);
  const preparando = c.rascunho.some((a) => a.preparando);
  const temAnexo = c.rascunho.length > 0;

  const mandar = (t = texto, comAnexos = true) => {
    if ((!t.trim() && !(comAnexos && temAnexo)) || c.ocupado || (comAnexos && preparando)) return;
    enviar(t, { comImagem, source, displayCanvas, comAnexos });
    setTexto('');
    setComImagem(false);
  };
  const temArquivos = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  const soltar = {
    onDragOver: (e) => { if (aba === 'conversa' && pronta && temArquivos(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!arrastando) setArrastando(true); } },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setArrastando(false); },
    onDrop: (e) => { if (aba !== 'conversa' || !pronta || !temArquivos(e)) return; e.preventDefault(); setArrastando(false); anexar(imagensDe(e.dataTransfer)); },
  };

  return html`
    <section class="panel via-gaveta ${arrastando ? 'via-soltando' : ''} ${recolhida ? 'recolhido' : ''}" role="dialog" aria-label="Via"
             onDragOver=${soltar.onDragOver} onDragLeave=${soltar.onDragLeave} onDrop=${soltar.onDrop}>
      ${arrastando && html`<div class="via-solte" aria-hidden="true">Solte as imagens para anexar (até ${MAX_POR_MENSAGEM})</div>`}
      <header class="panel-head via-head">
        <div class="panel-title">
          <b><span class="via-logo" aria-hidden="true">✦</span> Via</b>
          <em>${m.nome} · esforço ${pref.esforco === 'low' ? 'baixo' : pref.esforco === 'high' ? 'alto' : 'médio'}${emTeste() ? ' · TESTE' : ''}</em>
        </div>
        <div class="via-head-acts">
          <button class="via-hbtn" onClick=${novaConversa} disabled=${c.itens.length === 0 && !c.ocupado} title="Nova conversa">＋ Nova</button>
          <button class="via-rec" onClick=${() => setRecolhida(!recolhida)} aria-expanded=${!recolhida}
                  title=${recolhida ? 'Abrir' : 'Recolher'} aria-label=${recolhida ? 'Abrir a Via' : 'Recolher a Via para só o cabeçalho'}>${recolhida ? '▸' : '▾'}</button>
          <button class="panel-x" onClick=${onClose} title="Fechar (Esc)" aria-label="Fechar a Via">✕</button>
        </div>
      </header>

      <div class="tabs via-tabs">
        <button class=${aba === 'conversa' ? 'on' : ''} onClick=${() => setAba('conversa')}>Conversa</button>
        <button class=${aba === 'biblioteca' ? 'on' : ''} onClick=${() => setAba('biblioteca')}>Comandos</button>
        <button class=${aba === 'base' ? 'on' : ''} onClick=${() => setAba('base')}>Base</button>
        <button class=${aba === 'chave' ? 'on' : ''} onClick=${() => setAba('chave')}>Chave e modelo</button>
      </div>

      <div class="panel-body via-corpo">
        ${aba === 'chave' && html`<${ViaChave} compacto=${false} onPronto=${() => setAba('conversa')} />`}
        ${aba === 'biblioteca' && html`<${Biblioteca} contexto=${c.contexto} />`}
        ${aba === 'base' && html`<${Base} />`}

        ${aba === 'conversa' && !pronta && html`
          <p class="hint">Para conversar, a Via precisa de uma chave da API da Anthropic — a <b>sua</b>.</p>
          <${ViaChave} compacto=${true} onPronto=${() => setConfigurando(false)} />
        `}

        ${aba === 'conversa' && pronta && html`
          ${c.itens.length === 0 && html`
            <div class="via-vazio">
              <p><b>Olá! Sou a Via.</b> Gero comandos prontos — classes, frases e prompts — para o YOLOE, o Florence-2, o MobileCLIP, o RF-DETR, o SAM 2 e a Quadra, e ajudo a montar o Pipeline.</p>
              <p class="hint tight">Eu proponho; você decide: nada é aplicado sem o seu clique.</p>
              <div class="via-sugestoes">
                ${SUGESTOES.map((s) => html`<button key=${s} class="btn tiny" onClick=${() => mandar(s, false)}>${s}</button>`)}
              </div>
            </div>`}
          <div class="via-msgs" aria-live="polite">
            ${c.itens.map((it) => html`<${Item} key=${it.id} item=${it} onReenviar=${(t) => mandar(t, false)} onChave=${() => setAba('chave')} />`)}
            ${c.ocupado && html`<p class="via-passo" role="status"><span class="via-pontos" aria-hidden="true"><i></i><i></i><i></i></span> ${c.passo || 'pensando'}…</p>`}
            <div ref=${fim}></div>
          </div>
        `}
      </div>

      ${aba === 'conversa' && pronta && html`
        <div class="via-compor">
          ${c.contexto && html`
            <div class="via-ctx">
              <span>Campo: <b>${c.contexto.rotulo}</b> · <code>${c.contexto.op}.${c.contexto.parametro}</code></span>
              <button onClick=${() => { conversa.contexto = null; mudou(); }} aria-label="Tirar o contexto do campo">✕</button>
            </div>`}
          ${temAnexo && html`
            <div class="via-anexos via-rascunho" aria-label="Imagens anexadas">
              ${c.rascunho.map((a) => html`
                <span key=${a.chave} class="via-anexo ${a.preparando ? 'preparando' : ''}" title=${a.preparando ? 'Reduzindo…' : `${a.nome} · ${a.largura}×${a.altura} · ${Math.round(a.bytes / 1024)} KB`}>
                  ${a.preparando ? html`<b>…</b>` : html`<img src=${a.url} alt=${a.nome} />`}
                  <button class="via-anexo-x" aria-label=${'Tirar ' + a.nome} onClick=${() => tirarDoRascunho(a)}>✕</button>
                </span>`)}
            </div>`}
          ${c.avisoAnexo && html`<p class="via-aviso-anexo" role="status">${c.avisoAnexo}</p>`}
          <textarea ref=${caixa} rows="2" value=${texto} placeholder="Pergunte, peça um comando ou cole uma imagem… (Enter envia, Shift+Enter quebra linha)"
                    aria-label="Mensagem para a Via"
                    onInput=${(e) => setTexto(e.target.value)}
                    onPaste=${(e) => { const fs = imagensDe(e.clipboardData); if (fs.length) { e.preventDefault(); anexar(fs); } }}
                    onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); mandar(); } }}></textarea>
          <div class="via-compor-acts">
            <div class="via-compor-esq">
              <button class="via-clipe" title="Anexar imagens (JPG, PNG, WebP; até 8) — também dá para arrastar ou colar" aria-label="Anexar imagens"
                      disabled=${c.rascunho.length >= MAX_POR_MENSAGEM} onClick=${() => arquivo.current && arquivo.current.click()}>📎</button>
              <input ref=${arquivo} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
                     onChange=${(e) => { anexar(e.target.files); e.target.value = ''; }} />
              <label class="via-img-opt" title="Manda o quadro atual (reduzido) junto com a mensagem">
                <input type="checkbox" checked=${comImagem} onChange=${(e) => setComImagem(e.target.checked)} /> Incluir imagem do vídeo
              </label>
            </div>
            ${c.ocupado
              ? html`<button class="btn" onClick=${() => controlador && controlador.abort()}>Parar</button>`
              : html`<button class="btn accent" onClick=${() => mandar()} disabled=${(!texto.trim() && !temAnexo) || preparando}>Enviar</button>`}
          </div>
          ${c.uso && html`<div class="via-uso" title="Tokens desta conversa (aproximado)">tokens · entrada ${c.uso.entrada.toLocaleString('pt-BR')} (cache lido ${c.uso.cacheLido.toLocaleString('pt-BR')}) · saída ${c.uso.saida.toLocaleString('pt-BR')}</div>`}
          ${c.avisoServidor && html`<div class="via-uso via-aviso-srv" role="status" title="A conversa continua normalmente; só o registro no servidor falhou">⚠ ${c.avisoServidor}</div>`}
        </div>
      `}
    </section>
  `;
}
