/**
 * via/cliente.js — a conversa com a API da Anthropic, pelo SDK oficial.
 *
 * O SDK (@anthropic-ai/sdk, versão fixa, bundle ESM de arquivo único em
 * vendor/anthropic/) só é importado aqui, e este módulo só carrega quando a
 * Via abre ou quando alguém clica em «Testar» na Config.
 *
 * A chamada vai DIRETO do navegador para api.anthropic.com com a chave do
 * próprio usuário (`dangerouslyAllowBrowser: true` é o aceite explícito disso
 * no SDK). Nenhum servidor nosso no meio. A chave nunca é registrada: os erros
 * são traduzidos por CLASSE do SDK, e a mensagem mostrada é nossa.
 *
 * ===================== O CICLO DE FERRAMENTAS =====================
 *
 *   enquanto stop_reason === 'tool_use':
 *     executa TODAS as ferramentas do turno e devolve TODOS os tool_result
 *     numa única mensagem user
 *   end_turn            → fim
 *   refusal             → descarta o parcial, mostra a recusa (stop_details)
 *   max_tokens + tool   → NÃO executa a ferramenta truncada; descarta o turno
 *   max_tokens (texto)  → fica o texto cortado, com aviso
 *
 * O histórico é só-acréscimo (append-only): nunca se edita um turno anterior
 * (os blocos de thinking ficam presos ao prefixo exato). Turno que falhou ou
 * foi recusado é cortado INTEIRO do fim — o prefixo que sobra é o de antes.
 * ===================================================================
 */

import { obterChave, lerPreferencias, modeloInfo } from './base.js';
import { promptSistema } from './prompt.js';
import { definicoes, executarFerramenta } from './ferramentas.js';

export const SDK_VERSAO = '0.137.0';
const SDK_URL = new URL(`../../vendor/anthropic/sdk-${SDK_VERSAO}.mjs`, import.meta.url).href;

const MAX_TOKENS = 16000;
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

let sdkP = null;
/** Importa o SDK uma vez (import dinâmico). */
export function carregarSDK() {
  if (!sdkP) sdkP = import(SDK_URL).catch((e) => { sdkP = null; throw e; });
  return sdkP;
}

/*
 * MODO DE TESTE: um cliente falso injetado no lugar do SDK real, para testar a
 * interface, os cartões e o ciclo de ferramentas sem chave e sem gastar nada.
 * A fábrica recebe o módulo do SDK (para criar os mesmos erros tipados).
 */
let fabricaTeste = null;
export function definirClienteTeste(fabrica) { fabricaTeste = typeof fabrica === 'function' ? fabrica : null; }
export function emTeste() { return Boolean(fabricaTeste); }

/*
 * Fallback de recusa no servidor (`fallbacks: "default"`): se a API recusar o
 * parâmetro (conta/plataforma sem o beta), a Via desliga e anota o motivo —
 * para esta página — e segue sem ele.
 */
let semFallback = null;
export function motivoSemFallback() { return semFallback; }

async function novoCliente(apiKey) {
  const sdk = await carregarSDK();
  if (fabricaTeste) return { sdk, cliente: fabricaTeste(sdk) };
  const Anthropic = sdk.default;
  return { sdk, cliente: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 }) };
}

/** Erro sem chave: a interface mostra o formulário da chave. */
export class SemChave extends Error {}

/**
 * Testa a chave com uma chamada BARATA: GET /v1/models/{modelo} (sem
 * geração, não consome tokens). Prova que a chave vale e enxerga o modelo.
 */
export async function testarChave(chave, modelo) {
  const sdk = await carregarSDK();
  const c = fabricaTeste ? fabricaTeste(sdk)
    : new sdk.default({ apiKey: String(chave || '').trim(), dangerouslyAllowBrowser: true, maxRetries: 0 });
  const m = await c.models.retrieve(modelo);
  return { id: m.id, nome: m.display_name || m.id };
}

/**
 * Traduz um erro para a interface, pela CLASSE do SDK (nunca pelo texto).
 * Devolve { tipo, mensagem, espera? }. Nunca inclui a chave.
 */
export async function traduzirErro(e) {
  if (e instanceof SemChave) return { tipo: 'chave', mensagem: 'Falta a chave da Anthropic. Cole a sua para conversar com a Via.' };
  let A = null;
  try { A = (await carregarSDK()).default; } catch (_) { /* SDK não carregou */ }
  if (!A) return { tipo: 'sdk', mensagem: 'Não consegui carregar o SDK da Anthropic (rede?). Tente de novo.' };
  if (e instanceof A.APIUserAbortError) return { tipo: 'parado', mensagem: 'Resposta interrompida.' };
  if (e instanceof A.AuthenticationError) return { tipo: 'chave', mensagem: 'Chave inválida: a Anthropic recusou esta chave (401). Confira se colou a chave inteira ou gere outra no Console.' };
  if (e instanceof A.PermissionDeniedError) return { tipo: 'permissao', mensagem: 'Esta chave não tem permissão para este modelo ou recurso (403). Troque o modelo ou verifique a conta.' };
  if (e instanceof A.NotFoundError) return { tipo: 'modelo', mensagem: 'Modelo não encontrado para esta chave (404). Escolha outro modelo na Config.' };
  if (e instanceof A.RateLimitError) {
    const ra = Number(e.headers && (typeof e.headers.get === 'function' ? e.headers.get('retry-after') : e.headers['retry-after']));
    return { tipo: 'limite', espera: Number.isFinite(ra) ? ra : null,
      mensagem: `Limite de uso atingido (429). Aguarde${Number.isFinite(ra) ? ` ${Math.ceil(ra)} s` : ' um pouco'} e tente de novo.` };
  }
  if (e instanceof A.APIConnectionTimeoutError) return { tipo: 'rede', mensagem: 'A API demorou demais para responder. Tente de novo.' };
  if (e instanceof A.APIConnectionError) return { tipo: 'rede', mensagem: 'Sem conexão com api.anthropic.com. Verifique a internet (ou um bloqueador/proxy).' };
  if (e instanceof A.BadRequestError) return { tipo: 'pedido', mensagem: `A API recusou o pedido (400)${e.error && e.error.error && e.error.error.message ? `: ${e.error.error.message}` : ''}.` };
  if (e instanceof A.InternalServerError) return { tipo: 'servidor', mensagem: `A API está com problema ou sobrecarregada (${e.status || 500}). Tente de novo em instantes.` };
  if (e instanceof A.APIError) return { tipo: 'api', mensagem: `Erro da API (${e.status || '?'}).` };
  return { tipo: 'local', mensagem: `Erro: ${e && e.message ? e.message : String(e)}` };
}

/**
 * Conteúdo do assistente para devolver no histórico. Depois de um fallback no
 * meio da resposta, os blocos de thinking/tool_use (e tipos internos) ANTES do
 * último bloco `fallback` não voltam; texto volta. O marcador sai também.
 */
export function ecoar(content) {
  const blocos = Array.isArray(content) ? content : [];
  let ult = -1;
  blocos.forEach((b, i) => { if (b && b.type === 'fallback') ult = i; });
  if (ult < 0) return blocos;
  return blocos.filter((b, i) => {
    if (i === ult) return false;
    if (i > ult) return true;
    return b.type === 'text';
  });
}

/**
 * Um turno completo da conversa (pode ter várias idas e vindas de ferramentas).
 *
 * @param {object[]} historico  mensagens da API (alterado no lugar: só acréscimo; em falha, o turno é cortado)
 * @param {object} conteudoUsuario  content da nova mensagem do usuário
 * @param {object} ui  { onTexto(delta), onPasso(info), mostrarCartao, pedirPermissaoImagem, capturarQuadro }
 * @param {AbortSignal} sinal
 * @returns {{ fim: 'end_turn'|'refusal'|'max_tokens'|'erro', detalhes?, uso }}
 */
export async function turno(historico, conteudoUsuario, ui, sinal) {
  const apiKey = fabricaTeste ? 'teste' : obterChave();
  if (!apiKey) throw new SemChave();
  const { sdk, cliente } = await novoCliente(apiKey);
  const A = sdk.default;
  const { modelo, esforco } = lerPreferencias();
  const info = modeloInfo(modelo);

  const inicio = historico.length;
  historico.push({ role: 'user', content: conteudoUsuario });
  const uso = { entrada: 0, saida: 0, cacheLido: 0, cacheEscrito: 0 };
  let jsonRetries = 0;

  const corta = () => { historico.length = inicio; };

  try {
    for (let volta = 0; volta < 12; volta++) {
      const usarFallback = info.fallback && !semFallback;
      const params = {
        model: modelo,
        max_tokens: MAX_TOKENS,
        // Opus 5.5 não desliga o thinking (disabled/budget_tokens = 400): adaptive + esforço explícito
        thinking: { type: 'adaptive' },
        output_config: { effort: esforco },
        // ferramentas estáveis (mesma ordem) → sistema estável com o breakpoint de cache no último bloco
        tools: definicoes(),
        tool_choice: { type: 'auto' },   // any/tool forçado dá 400 no Opus 5.5 e no Sonnet 5.5
        system: [{ type: 'text', text: promptSistema(), cache_control: { type: 'ephemeral' } }],
        messages: historico,
        ...(usarFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' } : {}),
      };

      ui.onPasso && ui.onPasso({ fase: 'pensando', volta });
      const stream = cliente.beta.messages.stream(params, { signal: sinal });
      stream.on('text', (delta) => ui.onTexto && ui.onTexto(delta));

      let msg;
      try {
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        // parâmetro de fallback recusado (beta indisponível para a conta): desliga e repete sem ele
        if (usarFallback && e instanceof A.BadRequestError && /fallback/i.test(JSON.stringify(e.error || ''))) {
          semFallback = `a API recusou «fallbacks: default» (${e.status}): ${(e.error && e.error.error && e.error.error.message) || 'sem detalhe'}`;
          console.info('[Via] fallback de recusa desligado nesta página:', semFallback);
          ui.onDescartar && ui.onDescartar();
          continue;
        }
        // Erro da API (chave, limite, rede…) ou cancelamento: sobe para a interface
        if (e instanceof A.APIError || e instanceof A.APIUserAbortError || jsonRetries++ >= 2) throw e;
        // input de ferramenta que nem o parser tolerante entendeu: refaz a volta
        ui.onDescartar && ui.onDescartar();
        continue;
      }

      const u = msg.usage || {};
      uso.entrada += u.input_tokens || 0; uso.saida += u.output_tokens || 0;
      uso.cacheLido += u.cache_read_input_tokens || 0; uso.cacheEscrito += u.cache_creation_input_tokens || 0;

      // stop_reason ANTES de ler o conteúdo
      if (msg.stop_reason === 'refusal') {
        corta();
        return { fim: 'refusal', detalhes: msg.stop_details || null, uso };
      }

      const conteudo = ecoar(msg.content);
      const ferramentas = conteudo.filter((b) => b.type === 'tool_use');

      if (msg.stop_reason === 'max_tokens' && ferramentas.length) {
        // input truncado pode até parecer válido: não executa
        corta();
        return { fim: 'max_tokens', detalhes: { ferramenta: true }, uso };
      }

      historico.push({ role: 'assistant', content: conteudo });

      if (msg.stop_reason === 'pause_turn') continue;
      if (msg.stop_reason !== 'tool_use' || !ferramentas.length) {
        return { fim: msg.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn', modelo: msg.model, uso };
      }

      // TODAS as ferramentas do turno → TODOS os tool_result numa única mensagem user
      ui.onPasso && ui.onPasso({ fase: 'ferramentas', nomes: ferramentas.map((b) => b.name) });
      const resultados = [];
      for (const b of ferramentas) resultados.push(await executarFerramenta(b, ui));
      if (sinal && sinal.aborted) throw new A.APIUserAbortError();
      historico.push({ role: 'user', content: resultados });
    }
    corta();
    return { fim: 'erro', detalhes: { mensagem: 'A Via usou ferramentas demais neste turno e parou.' }, uso };
  } catch (e) {
    corta();
    throw e;
  }
}
