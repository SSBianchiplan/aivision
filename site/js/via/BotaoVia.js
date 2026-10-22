/**
 * via/BotaoVia.js — o botão «✦ Via» dos painéis e Studios: abre a Via já com o contexto do
 * módulo (a gaveta anexa o resumo do painel na primeira mensagem; dados de pessoas só com
 * permissão). Leve: só importa a base da Via. Nada roda até o clique.
 */
import { html } from '../vendor.js';
import { pedirVia } from './base.js';
import { nomeModulo } from './registro.js';

export function abrirViaModulo(modulo, texto = '') {
  pedirVia({ modulo, texto: texto || `Sobre o ${nomeModulo(modulo)}: ` });
}

/** classe: a classe do botão do Studio (ex.: 'bsc-btn'); rotulo: texto visível. */
export function BotaoVia({ modulo, classe = 'btn tiny', rotulo = '✦ Via', texto = '', titulo = '' }) {
  const t = titulo || `Perguntar à Via sobre o ${nomeModulo(modulo)} (Ctrl/⌘+K)`;
  return html`<button type="button" class=${`${classe} via-botao-modulo`} data-via-modulo=${modulo} title=${t} aria-label=${t}
    onClick=${(e) => { e.stopPropagation(); abrirViaModulo(modulo, texto); }}>${rotulo}</button>`;
}
