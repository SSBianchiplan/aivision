/**
 * via/CampoComando.js — os botões ao lado de um parâmetro de texto que aceita
 * comando, no editor do Pipeline:
 *
 *   ★     abre os comandos salvos DAQUELE operador/parâmetro (aplica com um
 *         clique) e salva o valor atual na biblioteca
 *   ✨ Via abre a Via com o contexto do campo, pronta para gerar um comando
 *
 * Leve: não carrega o SDK nem o chat (só via/base.js e via/comandos.js).
 */

import { html, useState, useEffect, useRef } from '../vendor.js';
import { pedirVia } from './base.js';
import { listarComandos, ouvir, salvarComando, infoCampo } from './comandos.js';

export function CampoComando({ op, nome, schema, value, onChange, nodeId = null }) {
  const [, setN] = useState(0);
  useEffect(() => ouvir(() => setN((n) => n + 1)), []);
  const [aberto, setAberto] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  const [aviso, setAviso] = useState('');
  const ref = useRef(null);

  // fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', esc); };
  }, [aberto]);

  const salvos = listarComandos({ op, parametro: nome });
  const info = infoCampo(op, nome, schema) || {};
  const rotulo = schema.label || nome;

  function salvarAtual() {
    const n = nomeNovo.trim();
    if (!n || !String(value || '').trim()) return;
    try {
      salvarComando({ nome: n, op, parametro: nome, valor: String(value), categoria: info.categoria || 'outros', origem: 'manual' });
      setNomeNovo(''); setAviso('Salvo na biblioteca.');
      setTimeout(() => setAviso(''), 2500);
    } catch (e) { setAviso(e.message); }
  }

  return html`
    <div class="via-campo" ref=${ref}>
      <span class="via-campo-bts">
      <button type="button" class="via-mini ${salvos.length ? 'tem' : ''}" aria-expanded=${aberto}
              title=${salvos.length ? `${salvos.length} comando(s) salvo(s) para este campo` : 'Comandos salvos para este campo'}
              onClick=${() => setAberto((a) => !a)}>★${salvos.length ? html`<i>${salvos.length}</i>` : ''}</button>
      <button type="button" class="via-mini via-mini-ia" title="Pedir à Via um comando para este campo"
              onClick=${() => pedirVia({ op, parametro: nome, valor: String(value ?? ''), rotulo, nodeId })}>✨ Via</button>
      </span>

      ${aberto && html`
        <div class="via-pop" role="dialog" aria-label=${'Comandos salvos — ' + rotulo}>
          <div class="via-pop-t">Comandos salvos · ${rotulo}</div>
          ${salvos.length === 0 && html`<p class="hint tight">Nenhum ainda. Peça à <b>Via</b> ou salve o valor atual.</p>`}
          <div class="via-pop-lista">
            ${salvos.map((c) => html`
              <button key=${c.id} type="button" class="via-pop-item" title=${c.valor}
                      onClick=${() => { onChange(c.valor); setAberto(false); }}>
                <b>${c.nome}</b><span>${c.valor}</span>
              </button>`)}
          </div>
          <div class="via-pop-novo">
            <input class="txt" value=${nomeNovo} placeholder="Nome para o valor atual"
                   onInput=${(e) => setNomeNovo(e.target.value)}
                   onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); salvarAtual(); } }} />
            <button type="button" class="btn tiny" onClick=${salvarAtual}
                    disabled=${!nomeNovo.trim() || !String(value || '').trim()}>☆ Salvar atual</button>
          </div>
          ${aviso && html`<p class="hint tight" role="status">${aviso}</p>`}
        </div>`}
    </div>
  `;
}
