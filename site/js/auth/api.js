/**
 * auth/api.js — cliente da API de autenticação.
 *
 * ================== O QUE MUDOU, E POR QUE IMPORTA ==================
 *
 * Antes, este arquivo não existia: o navegador comparava o hash da senha e
 * decidia sozinho se deixava entrar. Com o devtools aberto bastava mudar um
 * `if`. Era camada de UX vendida como segurança.
 *
 * Agora o navegador não decide nada. Ele só pergunta ao servidor quem é o
 * usuário e o que ele pode. A sessão vive num cookie `httpOnly` — que o
 * JavaScript NÃO consegue ler, e por isso um XSS não a rouba —, e a
 * autorização é conferida em PHP a cada requisição.
 *
 * Se este arquivo mentir sobre os escopos, o pior que acontece é a interface
 * mostrar um botão que o servidor vai recusar. A decisão real não está aqui.
 * ====================================================================
 */

const BASE = 'api';

/**
 * Token CSRF, mantido só em MEMÓRIA.
 *
 * Em localStorage ele sobreviveria à aba e ficaria legível por qualquer
 * script — o que anularia o propósito. Vem novo a cada /me.
 */
let csrf = null;

export function getCsrf() {
  return csrf;
}

async function call(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);

  const headers = { 'Accept': 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // o header CSRF é o que um site terceiro não consegue forjar
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;

  let res;
  try {
    res = await fetch(`${BASE}/${path}`, {
      method,
      headers,
      credentials: 'same-origin',   // manda o cookie de sessão
      cache: 'no-store',
      signal: ctrl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new ApiError('TIMEOUT', 'O servidor não respondeu a tempo.', 0);
    }
    throw new ApiError('NETWORK', 'Sem conexão com o servidor de autenticação.', 0);
  }
  clearTimeout(timer);

  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    // resposta não-JSON: normalmente é uma página de erro do servidor
  }

  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    throw new ApiError(e.code || 'HTTP_' + res.status,
                       e.message || `Falha ${res.status}.`,
                       res.status, e);
  }
  return data;
}

export class ApiError extends Error {
  constructor(code, message, status, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

// ------------------------------------------------------------ sessão

/**
 * Estado da sessão segundo o SERVIDOR.
 * Devolve sempre um objeto — nunca lança por falta de sessão, porque "não
 * logado" é uma resposta normal, não um erro.
 */
export async function me() {
  try {
    const d = await call('me');
    csrf = d.csrf || null;
    return d;
  } catch (err) {
    if (err.code === 'NETWORK' || err.code === 'TIMEOUT') {
      return { authenticated: false, offline: true, message: err.message };
    }
    return { authenticated: false, message: err.message };
  }
}

export async function logout() {
  try {
    await call('logout', { method: 'POST' });
  } finally {
    csrf = null;
  }
}

// ------------------------------------------------------------ desafio

/**
 * Pede um desafio de presenca humana.
 *
 * Devolve { id, imagem, expira_em }. A RESPOSTA nao vem junto — ela fica no
 * servidor, em hash. Nao ha nada no HTML, no JS nem no cabecalho de onde
 * extrai-la, que e o unico motivo de um desafio proprio valer alguma coisa.
 */
export function challenge() {
  return call('challenge');
}

/**
 * Resolve o desafio para uma sessao QUE JA EXISTE.
 *
 * E o caminho de quem ja estava logado: o cookie vale, o papel vale, e mesmo
 * assim o servidor recusa os dados ate isto passar.
 */
export function verifyChallenge(challengeId, resposta) {
  return call('challenge/verify', {
    method: 'POST',
    body: { challenge_id: challengeId, resposta },
  });
}

// ------------------------------------------------------------ login

/**
 * Login com e-mail e senha DESTE sistema.
 *
 * Substituiu o «entrar com GPlanSiS». A base de pessoas continua a mesma —
 * o cadastro veio importado do ONDA —, mas a senha e daqui: trocar a de la
 * nao mexe nesta, e um vazamento de um lado nao abre o outro.
 *
 * A senha vai no corpo de um POST sobre HTTPS, nunca na URL: query string
 * aparece em log de servidor, em histórico e no cabecalho Referer.
 */
export async function login(email, senha, challengeId, resposta) {
  const d = await call('login', {
    method: 'POST',
    body: { email, senha, challenge_id: challengeId, resposta },
    timeout: 30000,     // Argon2id custa ~120 ms; a equalizacao soma mais
  });
  csrf = d.csrf || null;
  return d;
}

export function trocarSenha(atual, nova) {
  return call('senha', { method: 'POST', body: { atual, nova } });
}

// ------------------------------------------------------------ esqueci a senha

/**
 * Pede o link de redefinicao.
 *
 * A resposta e a MESMA existindo ou nao a conta — de proposito. Diferenciar
 * transformaria esta tela num verificador de cadastro.
 *
 * O tempo limite e generoso porque o envio e sincrono: SMTP autenticado sobre
 * TLS, mais o espacamento anti-rajada da Hostinger, passa de 5 s com folga.
 */
export function esqueciSenha(email, challengeId, resposta) {
  return call('senha/esqueci', {
    method: 'POST',
    body: { email, challenge_id: challengeId, resposta },
    timeout: 45000,
  });
}

/** O link ainda vale? */
export function checarToken(token) {
  return call('senha/reset?t=' + encodeURIComponent(token));
}

export function redefinirSenha(token, senha) {
  return call('senha/reset', { method: 'POST', body: { token, senha }, timeout: 30000 });
}

/**
 * Sugestao de senha forte, sorteada no SERVIDOR.
 *
 * Nao e' feita aqui porque `Math.random()` nao e' criptografico — e uma senha
 * previsivel entregue por um gerador e' pior que uma fraca escolhida a mao,
 * porque parece segura.
 */
export function sugerirSenha() {
  return call('senha/sugerir');
}



// ------------------------------------------------------------ biometria

/**
 * Cadastra amostras faciais NO SERVIDOR.
 *
 * Os vetores saem do navegador (o modelo roda aqui) mas são guardados e
 * comparados lá. O cliente nunca recebe de volta o template de ninguém —
 * do contrário, bastaria ler a resposta para clonar a biometria alheia.
 */
export function enrollFace(vectors, { consent, retentionDays = 180 }) {
  return call('face/enroll', {
    method: 'POST',
    body: {
      vectors: vectors.map((v) => Array.from(v)),
      consent: Boolean(consent),
      retention_days: retentionDays,
    },
    timeout: 30000,
  });
}

/** Confere um rosto contra o template do usuário JÁ logado. */
export function identifyFace(vector) {
  return call('face/identify', { method: 'POST', body: { vector: Array.from(vector) } });
}

export function purgeFace() {
  return call('face', { method: 'DELETE' });
}

// ------------------------------------------------------------ admin

export function listUsers() {
  return call('users');
}

export function saveUser(u) {
  return call('users', { method: 'POST', body: u, timeout: 30000 });
}

/**
 * Gera uma senha nova e a devolve UMA vez, em claro.
 * O que fica no banco e o hash Argon2id — nao ha como recuperar depois.
 */
export function resetSenha(id, avisar = true) {
  return call('users/senha', {
    method: 'POST', body: { id, avisar },
    timeout: 45000,      // pode incluir um envio SMTP síncrono
  });
}

export function auditLog() {
  return call('audit');
}

export function health() {
  return call('health');
}
