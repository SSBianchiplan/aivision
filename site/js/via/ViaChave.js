/**
 * via/ViaChave.js — formulário da chave da Anthropic + modelo + esforço.
 *
 * Aparece em Config › Via · IA e dentro da própria Via quando falta a chave.
 * É leve: o SDK só é importado ao clicar em «Testar» (via/cliente.js).
 */

import { html, useState, useEffect } from '../vendor.js';
import {
  MODELOS, ESFORCOS, ouvir, temChave, ondeEstaChave, obterChave, mascarar, pareceChave,
  gravarChave, apagarChave, lerPreferencias, gravarPreferencias,
} from './base.js';

function useVia() {
  const [, setN] = useState(0);
  useEffect(() => ouvir(() => setN((n) => n + 1)), []);
  return { tem: temChave(), onde: ondeEstaChave(), pref: lerPreferencias() };
}

/** `compacto`: versão de dentro da Via (sem o texto longo de custo). */
export function ViaChave({ compacto = false, onPronto = null }) {
  const { tem, onde, pref } = useVia();
  const [txt, setTxt] = useState('');
  const [lembrar, setLembrar] = useState(true);
  const [estado, setEstado] = useState(null);   // { tipo: 'ok'|'erro'|'testando', msg }
  const [trocando, setTrocando] = useState(false);

  async function testar(chave) {
    setEstado({ tipo: 'testando', msg: 'Testando com a Anthropic…' });
    try {
      const { testarChave } = await import('./cliente.js');
      const m = await testarChave(chave, pref.modelo);
      setEstado({ tipo: 'ok', msg: `Chave válida — ${m.nome} disponível.` });
      return true;
    } catch (e) {
      const { traduzirErro } = await import('./cliente.js');
      const t = await traduzirErro(e);
      setEstado({ tipo: 'erro', msg: t.mensagem });
      return false;
    }
  }

  async function salvar() {
    const c = txt.trim();
    if (!c) return;
    if (!pareceChave(c)) {
      setEstado({ tipo: 'erro', msg: 'Isto não parece uma chave da Anthropic (começa com «sk-ant-»).' });
      return;
    }
    try { gravarChave(c, lembrar); } catch (e) { setEstado({ tipo: 'erro', msg: e.message }); return; }
    setTxt('');
    setTrocando(false);
    const ok = await testar(c);
    if (ok && onPronto) onPronto();
  }

  const mostrarForm = !tem || trocando;

  return html`
    <div class="via-chave">
      ${!compacto && html`
        <p class="hint tight">
          A <b>Via</b> é a assistente de IA do iaVision: gera listas de classes e prompts para os
          operadores que aceitam comando, explica módulos e sugere encadeamentos. Ela usa a${' '}
          <b>sua</b>${' '}chave da API da Anthropic (Claude).
        </p>`}

      <div class="via-aviso" role="note">
        <b>Onde fica a chave:</b> só neste navegador. Ela vai direto daqui para <code>api.anthropic.com</code> — nunca
        passa pelos servidores do iaVision, não entra em log nem em exportação.${' '}
        <b>Quem usar este navegador com a sua conta pode usá-la</b>: em computador compartilhado, prefira
        «só nesta sessão» e apague ao terminar.
      </div>

      ${tem && !trocando && html`
        <div class="cfg-grid">
          <div><span>Chave</span><b class="ok">${mascarar(obterChave())}</b></div>
          <div><span>Guardada</span><b>${onde === 'sessao' ? 'só nesta sessão' : 'neste aparelho'}</b></div>
        </div>
        <div class="row tight">
          <button class="btn" onClick=${() => testar(obterChave())} disabled=${estado && estado.tipo === 'testando'}>Testar</button>
          <button class="btn" onClick=${() => { setTrocando(true); setEstado(null); }}>Trocar</button>
          <button class="btn via-perigo" onClick=${() => { apagarChave(); setEstado({ tipo: 'ok', msg: 'Chave apagada deste navegador.' }); }}>Apagar chave</button>
        </div>
      `}

      ${mostrarForm && html`
        <label class="ctl ctl-text">
          <span class="ctl-label">Chave da API da Anthropic</span>
          <input type="password" value=${txt} placeholder="sk-ant-…" autocomplete="off" spellcheck="false"
                 autocapitalize="off" aria-label="Chave da API da Anthropic"
                 onInput=${(e) => setTxt(e.target.value)}
                 onKeyDown=${(e) => { if (e.key === 'Enter') salvar(); }} />
        </label>
        <div class="via-radios" role="radiogroup" aria-label="Onde guardar a chave">
          <label><input type="radio" name="via-lembrar" checked=${lembrar} onChange=${() => setLembrar(true)} /> Lembrar neste aparelho</label>
          <label><input type="radio" name="via-lembrar" checked=${!lembrar} onChange=${() => setLembrar(false)} /> Só nesta sessão</label>
        </div>
        <div class="row tight">
          <button class="btn accent" onClick=${salvar} disabled=${!txt.trim() || (estado && estado.tipo === 'testando')}>Salvar e testar</button>
          ${trocando && html`<button class="btn" onClick=${() => { setTrocando(false); setTxt(''); }}>Cancelar</button>`}
        </div>
        <p class="hint tight">
          Crie a chave em <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>${' '}
          (a cobrança é na sua conta da Anthropic). O teste só consulta o modelo — não gasta tokens.
        </p>
      `}

      ${estado && html`<p class="hint tight via-estado ${estado.tipo}" role="status">${estado.tipo === 'ok' ? '✓ ' : estado.tipo === 'erro' ? '⚠ ' : ''}${estado.msg}</p>`}

      <div class="cfg-sub">Modelo</div>
      <div class="via-modelos" role="radiogroup" aria-label="Modelo">
        ${MODELOS.map((m) => html`
          <label key=${m.id} class="via-modelo ${pref.modelo === m.id ? 'on' : ''}">
            <input type="radio" name="via-modelo" checked=${pref.modelo === m.id}
                   onChange=${() => gravarPreferencias({ modelo: m.id })} />
            <span><b>${m.nome}</b> <em>${m.dica}</em>${!compacto && html`<i>${m.preco}</i>`}</span>
          </label>`)}
      </div>

      <label class="ctl">
        <span class="ctl-label">Esforço</span>
        <select value=${pref.esforco} onChange=${(e) => gravarPreferencias({ esforco: e.target.value })}>
          ${ESFORCOS.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome} — ${x.dica}</option>`)}
        </select>
      </label>

      <div class="cfg-sub">Memória no servidor</div>
      <label class="via-check">
        <input type="checkbox" checked=${pref.salvarServidor}
               onChange=${(e) => gravarPreferencias({ salvarServidor: e.target.checked })} />
        <span><b>Salvar conversas no servidor da GPlanSiS</b></span>
      </label>
      <p class="hint tight">
        Guarda, ligado à sua conta do iaVision, a pergunta, a resposta e os comandos de cada turno — para o
        histórico e a base de conhecimento (aba <b>Base</b>). <b>Não vão</b>: a sua chave da Anthropic e as imagens
        (só um código de conferência e o tamanho delas). Desligado, nada da conversa sai para o servidor da GPlanSiS.
        Você vê e apaga tudo na aba Base.
      </p>

      ${!compacto && html`
        <p class="hint tight">
          Custo aproximado: uma pergunta típica (catálogo de operadores no contexto, em cache
          depois da primeira) fica na casa de <b>centavos de dólar</b> no Opus 5.5, menos no
          Sonnet 5.5 e frações de centavo no Haiku 5.5. Mandar o quadro do vídeo acrescenta
          cerca de mil tokens por imagem. Atalho para abrir a Via:${' '}<b>Ctrl/⌘ + K</b>.
        </p>`}
    </div>
  `;
}
