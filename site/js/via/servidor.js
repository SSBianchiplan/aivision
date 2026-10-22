/**
 * via/servidor.js — a memória da Via no servidor da GPlanSiS (serviço
 * aivision-via, /api/via/*): registro dos turnos, base de conhecimento (RAG)
 * e histórico.
 *
 * O QUE VAI PARA LÁ: texto da pergunta e da resposta, comandos propostos e os
 * METADADOS das imagens (sha256, largura, altura). NUNCA a chave da Anthropic
 * (o servidor ainda recusa qualquer «sk-ant-…») e nunca a imagem.
 * O usuário vem da sessão do iaVision (cookie), conferida no servidor — nada
 * de id de usuário no corpo.
 */

/** Erro com status HTTP (0 = sem rede). */
export class ErroServidor extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function chamar(caminho, { method = 'GET', body, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    r = await fetch('/api/via' + caminho, {
      method, credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new ErroServidor(e && e.name === 'AbortError' ? 'O servidor da Via não respondeu a tempo.' : 'Sem conexão com o servidor da Via.', 0);
  } finally { clearTimeout(t); }
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { /* sem corpo */ }
  if (!r.ok) {
    const d = corpo && corpo.detail;
    const msg = typeof d === 'string' ? d
      : r.status === 401 ? 'Sessão do iaVision expirada.'
      : r.status === 404 ? 'Não encontrado.'
      : r.status === 422 ? 'Dados inválidos.'
      : `Erro ${r.status} no servidor da Via.`;
    throw new ErroServidor(msg, r.status);
  }
  return corpo;
}

/** Nunca deixa passar algo com cara de chave (defesa extra; o servidor também recusa). */
function semChave(obj) {
  const s = JSON.stringify(obj);
  if (/sk-ant-[A-Za-z0-9_-]{8,}/.test(s)) throw new ErroServidor('O texto contém algo parecido com uma chave de API — não foi salvo.', 400);
  return obj;
}

// ------------------------------------------------------------ conversas

/**
 * Grava um turno. dados = { conversa_id, pergunta, resposta, modelo, tokens_in,
 * tokens_out, comandos: [{op, parametro, valor}], anexos: [{sha256, largura, altura}] }
 * → { conversa_id, mensagem_usuario_id, mensagem_via_id, comandos: [ids], anexos: [ids] }
 */
export const registrar = (dados) => chamar('/registro', { method: 'POST', body: semChave(dados) });
export const marcarComando = (id, marca) => chamar(`/comandos/${encodeURIComponent(id)}`, { method: 'PATCH', body: marca });
export const anotarTreinar = (sha256, projeto) => chamar('/anexos/treinar', { method: 'POST', body: { sha256, projeto } });
export const historico = (limite = 30) => chamar(`/historico?limite=${limite}`);
export const apagarConversa = (id) => chamar(`/historico/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const apagarTodasConversas = () => chamar('/historico', { method: 'DELETE' });

// ------------------------------------------------------------ base de conhecimento

export const eu = () => chamar('/eu');
export const salvarConhecimento = (item) => chamar('/conhecimento', { method: 'POST', body: semChave(item) });
export const listarConhecimento = (escopo = 'todos') => chamar(`/conhecimento?escopo=${escopo}`);
export const compartilhar = (id, compartilhado) => chamar(`/conhecimento/${encodeURIComponent(id)}`, { method: 'PATCH', body: { compartilhado } });
export const apagarConhecimento = (id) => chamar(`/conhecimento/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** RAG: { q, modo, trechos: [{ id, titulo, trecho, tags, compartilhado, meu, criado_em, score }] } */
export const buscar = (q, n = 5) => chamar(`/busca?q=${encodeURIComponent(q)}&n=${n}`);
