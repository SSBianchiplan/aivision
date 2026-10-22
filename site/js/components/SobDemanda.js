/**
 * components/SobDemanda.js — componente carregado com import() na hora de abrir.
 *
 * Os painéis de esporte, o Studio Bike Fit e o Bike Fit 3D somam centenas de
 * KB que quase ninguém usa ao abrir o app. Importá-los estaticamente fazia
 * toda abertura baixar e analisar esse código. Aqui o módulo só é pedido
 * quando o componente MONTA (painel aberto pela barra, pelo hub, por preset
 * ou restaurado do localStorage), e enquanto isso aparece a `reserva` — um
 * «carregando…» discreto no mesmo lugar.
 *
 * Sem React.lazy/Suspense de propósito: o fallback do Suspense fica no
 * limite mais próximo, e um painel carregando não pode esconder a coluna
 * inteira. Um useState/useEffect por componente resolve sem surpresa.
 *
 * O import() é feito uma vez só; montagens seguintes usam o componente já
 * resolvido, sem passar pela reserva. Falhou (rede caiu)? A reserva mostra
 * o erro com «tentar de novo», e a próxima tentativa refaz o import.
 */

import { html, useState, useEffect } from '../vendor.js';
import { Panel } from './Panel.js';

/**
 * @param {() => Promise<object>} carregar  ex.: () => import('./esportes/VbtPanel.js')
 * @param {string} nome                     export do módulo com o componente
 * @param {(props, erro, tentar) => any} reserva  o que desenhar até chegar
 */
export function sobDemanda(carregar, nome, reserva) {
  let Comp = null;
  let promessa = null;
  let erro = null;

  const obter = () => {
    if (!promessa) {
      erro = null;
      promessa = carregar().then((m) => {
        Comp = m[nome];
        if (!Comp) throw new Error(`o módulo não exporta ${nome}`);
        return Comp;
      }, (e) => {
        // sem cache do fracasso: a próxima montagem (ou o botão) tenta de novo
        promessa = null;
        throw e;
      });
    }
    return promessa;
  };

  function SobDemanda(props) {
    const [, setVersao] = useState(0);
    const [tentativa, setTentativa] = useState(0);

    useEffect(() => {
      if (Comp) return undefined;
      let vivo = true;
      obter().then(
        () => { if (vivo) setVersao((n) => n + 1); },
        (e) => {
          erro = e;
          console.error(`[sob demanda] ${nome} não carregou:`, e);
          if (vivo) setVersao((n) => n + 1);
        });
      return () => { vivo = false; };
    }, [tentativa]);

    if (Comp) return html`<${Comp} ...${props} />`;
    return reserva(props, erro, () => { erro = null; setTentativa((n) => n + 1); });
  }
  SobDemanda.displayName = `SobDemanda(${nome})`;
  /** Pede o módulo sem montar nada (pré-carregamento). */
  SobDemanda.precarregar = () => obter().catch(() => {});
  return SobDemanda;
}

/** Conteúdo da reserva: «carregando…» ou o erro com o botão de repetir. */
function aviso(erro, tentar) {
  if (!erro) return html`<p class="hint tight" role="status" data-sob-demanda="">carregando…</p>`;
  return html`
    <p class="hint tight" role="alert" data-sob-demanda="erro">Não consegui carregar este módulo${erro.message ? ` (${erro.message})` : ''}.</p>
    <button class="btn" onClick=${tentar}>Tentar de novo</button>
  `;
}

/**
 * Painel lateral carregado sob demanda. A reserva já é um <Panel> com o
 * mesmo id e título: ocupa o lugar certo na coluna (o tamanho guardado é por
 * id) e pode ser fechado ou arrastado antes de o conteúdo chegar.
 */
export function painelSobDemanda(carregar, nome, id, titulo) {
  return sobDemanda(carregar, nome, (props, erro, tentar) => html`
    <${Panel} id=${id} title=${titulo} subtitle="carregando…"
              onClose=${props.onClose} docked=${props.docked}
              onUndock=${props.onUndock} onMove=${props.onMove} pos=${props.pos}>
      ${aviso(erro, tentar)}
    <//>
  `);
}

/**
 * Tela cheia carregada sob demanda (Studio, Bike Fit 3D). A reserva usa a
 * classe da própria tela (`.sbf`, `.bf3d`: fixa, fundo cheio) para não
 * piscar o app por baixo, e deixa fechar enquanto carrega.
 */
export function telaSobDemanda(carregar, nome, classe, rotulo) {
  return sobDemanda(carregar, nome, (props, erro, tentar) => html`
    <div class=${classe} role="dialog" aria-modal="true" aria-label=${rotulo} aria-busy=${!erro}>
      <div style=${{ margin: 'auto', textAlign: 'center', padding: '24px', maxWidth: '420px' }}>
        <p style=${{ margin: '0 0 12px', opacity: 0.8 }}>${rotulo}</p>
        ${aviso(erro, tentar)}
        <button class="btn" style=${{ marginTop: '8px' }} onClick=${props.onClose}>Fechar</button>
      </div>
    </div>
  `);
}
