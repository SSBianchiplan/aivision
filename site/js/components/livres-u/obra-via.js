/**
 * components/livres-u/obra-via.js — C1: a Via redige o resumo do RDO.
 *
 * OPT-IN: só roda quando o usuário marca a caixa no painel e clica. Vai para
 * api.anthropic.com DIRETO do navegador, com a chave do PRÓPRIO usuário (a da
 * Via, js/via/base.js) — o mesmo caminho da Via. O que vai: o resumo NUMÉRICO
 * do dia (contagens por hora, campos digitados) e, só se marcado também, até 3
 * fotos reduzidas. Nada de nome de pessoa; rostos já borrados no preset.
 */
let fabricaTeste = null;
/** Testes: cliente falso no lugar do SDK ({ messages: { create } }). */
export function definirClienteObraTeste(f) { fabricaTeste = typeof f === 'function' ? f : null; }

const SISTEMA = 'Você redige, em português do Brasil, o texto de um RDO (Relatório Diário de Obra) a partir de contagens ' +
  'automáticas por câmera e de anotações do responsável. Seja objetivo, use frases curtas, não invente atividades, quantidades ' +
  'ou ocorrências que não estejam nos dados; quando algo não foi informado, não mencione. Termine com uma linha ' +
  '"Pontos de atenção:" só se houver algo nos dados que mereça atenção. Máximo de 180 palavras.';

/** fotos: [{ base64 (sem prefixo), tipo }]. Devolve o texto. */
export async function redigirRdo(resumo, fotos = []) {
  const base = await import('../../via/base.js');
  const chave = base.obterChave();
  let cliente;
  if (fabricaTeste) cliente = fabricaTeste();
  else {
    if (!chave) throw new Error('Sem chave da Anthropic: cadastre a sua na Via (Ajustes) para usar este recurso.');
    const { carregarSDK } = await import('../../via/cliente.js');
    const sdk = await carregarSDK();
    cliente = new sdk.default({ apiKey: chave, dangerouslyAllowBrowser: true, maxRetries: 1 });
  }
  const pref = base.lerPreferencias ? base.lerPreferencias() : {};
  const modelo = (pref && pref.modelo) || base.MODELO_PADRAO;
  const content = [
    ...fotos.slice(0, 3).map((f) => ({ type: 'image', source: { type: 'base64', media_type: f.tipo || 'image/jpeg', data: f.base64 } })),
    { type: 'text', text: `Dados do dia:\n${resumo}\n\nRedija o texto do RDO.` },
  ];
  const r = await cliente.messages.create({ model: modelo, max_tokens: 1200, system: SISTEMA, messages: [{ role: 'user', content }] });
  return (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
