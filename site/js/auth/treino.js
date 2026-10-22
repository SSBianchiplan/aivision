/**
 * auth/treino.js — acesso ao serviço Treinar (/api/treino) a partir do app:
 * token, entrada pela conta (SSO de admin) ou pela senha, lista de projetos e
 * envio de imagens. Usado pela Via (anexos → Treinar) e pela fonte YouTube.
 *
 * O token é o mesmo HMAC de 12 h que a página /treino/ usa, guardado na MESMA
 * chave do sessionStorage («aivTreino»): entrou numa, entrou na outra (mesma
 * aba/origem). Some ao fechar a aba.
 *
 * SSO: POST /api/treino/sessao manda o cookie da sessão do iaVision; o SERVIDOR
 * confere o e-mail em /api/me contra AIV_TREINO_ADMINS e só então emite o
 * token. Nada aqui decide quem é admin — o navegador só pergunta.
 */

const CHAVE = 'aivTreino';
const CHAVE_QUEM = 'aivTreinoQuem';

export function lerToken() {
  try { return sessionStorage.getItem(CHAVE) || ''; } catch (_) { return ''; }
}

/** Quem entrou pela conta (e-mail) — só para mostrar; vazio se entrou por senha. */
export function lerQuem() {
  try { return sessionStorage.getItem(CHAVE_QUEM) || ''; } catch (_) { return ''; }
}

export function gravarToken(token, quem = '') {
  try {
    if (token) sessionStorage.setItem(CHAVE, token); else sessionStorage.removeItem(CHAVE);
    if (token && quem) sessionStorage.setItem(CHAVE_QUEM, quem); else sessionStorage.removeItem(CHAVE_QUEM);
  } catch (_) { /* armazenamento bloqueado: o token vale só nesta tela */ }
}

/**
 * Chamada ao /api/treino. `token` explícito ou o guardado. Erro com `.status`.
 * 401 apaga o token guardado (expirou).
 */
export async function apiTreino(caminho, opt = {}, token = lerToken()) {
  const headers = { ...(opt.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opt.body && !(opt.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/treino' + caminho, { ...opt, headers, credentials: 'same-origin' });
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { /* sem corpo */ }
  if (!r.ok) {
    if (r.status === 401 && token && caminho !== '/entrar') gravarToken('');
    const e = new Error((corpo && corpo.detail) || ('Erro ' + r.status));
    e.status = r.status;
    throw e;
  }
  return corpo;
}

/**
 * Tenta entrar pela sessão do iaVision (admin). Devolve { token, email } ou
 * null (403: não é admin / sem sessão; 503: login fora — segue para a senha).
 */
export async function entrarPorSessao() {
  try {
    const r = await apiTreino('/sessao', { method: 'POST' }, '');
    if (r && r.token) { gravarToken(r.token, r.email || ''); return { token: r.token, email: r.email || '' }; }
  } catch (_) { /* sem SSO: a tela mostra a senha */ }
  return null;
}

export async function entrarComSenha(senha) {
  const r = await apiTreino('/entrar', { method: 'POST', body: JSON.stringify({ senha }) }, '');
  gravarToken(r.token);
  return r.token;
}

/** Token pronto: o guardado, senão o SSO. '' se precisa da senha. */
export async function garantirToken() {
  const t = lerToken();
  if (t) return t;
  const s = await entrarPorSessao();
  return s ? s.token : '';
}

export const listarProjetos = () => apiTreino('/projetos');

/**
 * Envia imagens a um projeto, em lotes de 8 (como a página do Treinar).
 * itens: [{ blob, nome }]; grupo 'boa'|'ruim' (projetos de anomalia).
 * Devolve { enviadas: [nomes], erros: [] }.
 */
export async function enviarImagens(pid, itens, { grupo = '', aoProgredir = null } = {}) {
  const enviadas = [], erros = [];
  for (let i = 0; i < itens.length; i += 8) {
    const fd = new FormData();
    for (const it of itens.slice(i, i + 8)) fd.append('arquivos', new File([it.blob], it.nome, { type: it.blob.type || 'image/jpeg' }));
    if (aoProgredir) aoProgredir(Math.min(i + 8, itens.length), itens.length);
    const r = await apiTreino(`/projetos/${encodeURIComponent(pid)}/imagens` + (grupo ? '?grupo=' + encodeURIComponent(grupo) : ''),
      { method: 'POST', body: fd });
    if (r && r.enviadas) enviadas.push(...r.enviadas);
    if (r && r.erros) erros.push(...r.erros);
  }
  return { enviadas, erros };
}
