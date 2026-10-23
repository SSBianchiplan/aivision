/**
 * components/esportes/AtletaBikeFit.js — bloco "Atleta" do Bike Fit.
 *
 * O MESMO componente aparece no painel Bike Fit (BikeFitPanel.js) e nos
 * Ajustes do Studio (StudioBikeFit.js): perfil do atleta (salvo por atleta
 * neste navegador, com lista para trocar), os alvos que ele gera para a
 * modalidade — com o porquê de cada um e o ajuste manual por linha — e as
 * medidas de partida (selim LeMond/Hamley, pedivela).
 *
 * Não guarda nada próprio: lê e escreve no canal (runtime/livres-e/canal.js),
 * que é a fonte única dos alvos da sessão (operador, tabela, gráficos,
 * selos e relatório leem dali). Regras e fontes em runtime/livres-e/atleta.js.
 */
import { confirmar } from '../dialogo.js';
import { html, useState, useEffect, useRef } from '../../vendor.js';
import {
  obterAtleta, listaAtletas, atualizarAtleta, trocarAtleta, novoAtleta, removerAtleta,
  definirOverride, alvosSessao, assinarAtleta, versaoDoAtleta,
} from '../../cv/runtime/livres-e/canal.js';
import {
  DORES, NIVEIS, OBJETIVOS, FLEX, SEXOS, NOMES_FAIXA, CHAVES_FAIXA, DICA_ENTREPERNAS, DICA_FLEX,
  imc, medidasSugeridas,
} from '../../cv/runtime/livres-e/atleta.js';
import { num } from '../../cv/runtime/livres-e/bikefit.js';

/** Re-renderiza quando o atleta (ou um alvo manual) muda. Devolve a versão. */
export function useAtleta() {
  const [v, setV] = useState(versaoDoAtleta);
  useEffect(() => assinarAtleta(setV), []);
  return v;
}

export const faixaTexto = (f) => (!f ? '—' : f[0] < 0 || f[1] < 0 ? `${num(f[0], 0)} a ${num(f[1], 0)}` : `${f[0]}–${f[1]}`);
const UN = (k) => (k === 'kops' ? '%' : '°');

/** Editor min–max de um alvo (linha da tabela do painel ou lista dos Ajustes do Studio). */
export function EditorFaixa({ perfil, chave, onFechar }) {
  useAtleta();
  const L = alvosSessao(perfil).linhas[chave];
  const [a, setA] = useState(String(L.faixa[0]));
  const [b, setB] = useState(String(L.faixa[1]));
  const primeiro = useRef(null);
  useEffect(() => { if (primeiro.current) { primeiro.current.focus(); primeiro.current.select(); } }, []);
  const va = Number(String(a).replace(',', '.')), vb = Number(String(b).replace(',', '.'));
  const valido = Number.isFinite(va) && Number.isFinite(vb) && a !== '' && b !== '' && va < vb;
  const salvar = () => { if (!valido) return; definirOverride(perfil, chave, [Math.round(va), Math.round(vb)]); onFechar && onFechar(); };
  const tecla = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); salvar(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFechar && onFechar(); }
  };
  return html`
    <div class="bfa-ed" onKeyDown=${tecla}>
      <div class="bfa-ed-l">
        <b>${NOMES_FAIXA[chave]}</b>
        <span>calculado ${faixaTexto(L.calculada)}${UN(chave)} · modalidade ${faixaTexto(L.base)}${UN(chave)}</span>
      </div>
      <div class="bfa-ed-l">
        <input ref=${primeiro} type="number" inputmode="numeric" aria-label="mínimo" value=${a} onInput=${(e) => setA(e.target.value)} />
        <span>a</span>
        <input type="number" inputmode="numeric" aria-label="máximo" value=${b} onInput=${(e) => setB(e.target.value)} />
        <span>${UN(chave)}</span>
      </div>
      <div class="bfa-ed-l">
        <button type="button" class="bfa-b on" disabled=${!valido} onClick=${salvar}>OK</button>
        ${L.override && html`<button type="button" class="bfa-b" onClick=${() => { definirOverride(perfil, chave, null); onFechar && onFechar(); }}>Voltar ao calculado</button>`}
        <button type="button" class="bfa-b" onClick=${() => onFechar && onFechar()}>Cancelar</button>
      </div>
      ${!valido && html`<span class="bfa-aviso">O mínimo precisa ser menor que o máximo.</span>`}
    </div>`;
}

/** Botão do alvo (tabela do painel): mostra a faixa, marcada quando difere da modalidade. */
export function BotaoAlvo({ linha, texto, onClick, aberto }) {
  const cls = 'bfa-alvo' + (linha && linha.mudou ? ' mudou' : '') + (aberto ? ' aberto' : '');
  const tit = linha ? `${linha.porque.join(' ')}\nClique para editar o mínimo e o máximo.` : '';
  return html`<button type="button" class=${cls} title=${tit} onClick=${onClick}>
    ${texto}${linha && linha.override ? html`<i class="bfa-man" aria-label="definido à mão">✎</i>` : linha && linha.mudou ? html`<i class="bfa-pt" aria-label="personalizado">•</i>` : ''}
  </button>`;
}

const campoNum = (rotulo, k, a, { min = 0, max = 300, ph = '', passo = 1 } = {}) => html`
  <label class="bfa-c"><span>${rotulo}</span>
    <input type="number" inputmode="decimal" min=${min} max=${max} step=${passo} placeholder=${ph}
      value=${a[k] || ''} onInput=${(e) => atualizarAtleta({ [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })} />
  </label>`;

const campoSel = (rotulo, k, a, opcoes, vazio = '—') => html`
  <label class="bfa-c"><span>${rotulo}</span>
    <select value=${a[k]} onChange=${(e) => atualizarAtleta({ [k]: e.target.value })}>
      ${opcoes.map((o) => html`<option key=${o} value=${o}>${o || vazio}</option>`)}
    </select>
  </label>`;

/**
 * O bloco inteiro. `perfil` = modalidade do nó (Estrada, MTB…). `editar` /
 * `onEditar`: chave do alvo aberto no editor (o Studio abre por clique na
 * tabela do canvas).
 */
export function AtletaBikeFit({ perfil, editar = null, onEditar }) {
  useAtleta();
  const [editLocal, setEditLocal] = useState(null);
  const ed = onEditar ? editar : editLocal;
  const setEd = onEditar || setEditLocal;
  const a = obterAtleta();
  const lista = listaAtletas();
  const alvos = alvosSessao(perfil);
  const im = imc(a);
  const med = medidasSugeridas(a);
  const nPers = CHAVES_FAIXA.filter((k) => alvos.linhas[k].mudou).length;
  const refEd = useRef(null);
  useEffect(() => { if (ed && refEd.current && refEd.current.scrollIntoView) refEd.current.scrollIntoView({ block: 'nearest' }); }, [ed]);

  const dor = (k, on) => atualizarAtleta({ dores: on ? [...a.dores, k] : a.dores.filter((d) => d !== k) });

  return html`
    <div class="bfa">
      <div class="bfa-topo">
        <select aria-label="Atleta" value=${a.id} onChange=${(e) => trocarAtleta(e.target.value)}>
          ${lista.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome || 'sem nome'}</option>`)}
        </select>
        <button type="button" class="bfa-b" title="Novo atleta" onClick=${() => novoAtleta('Novo atleta')}>+ Novo</button>
        <button type="button" class="bfa-b" title="Remover este atleta" disabled=${lista.length <= 1}
          onClick=${async () => { if (await confirmar(`Remover o atleta "${a.nome}" e os alvos dele?`, { titulo: 'Remover atleta', ok: 'Remover atleta', cancelar: 'Manter', perigo: true })) removerAtleta(a.id); }}>Remover</button>
      </div>
      <label class="bfa-c bfa-larga"><span>Nome</span>
        <input value=${a.nome} maxlength="60" onInput=${(e) => atualizarAtleta({ nome: e.target.value })} /></label>
      <div class="bfa-grade">
        ${campoNum('Altura (cm)', 'alturaCm', a, { max: 230, ph: 'ex.: 175' })}
        ${campoNum('Peso (kg)', 'pesoKg', a, { max: 250, ph: 'ex.: 72' })}
        <label class="bfa-c"><span>Entrepernas (cm) <i class="bfa-dica" title=${DICA_ENTREPERNAS}>?</i></span>
          <input type="number" inputmode="decimal" min="0" max="120" step="0.5" placeholder="opcional"
            value=${a.entrepernasCm || ''} onInput=${(e) => atualizarAtleta({ entrepernasCm: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} /></label>
        ${campoNum('Idade', 'idade', a, { max: 99 })}
        ${campoSel('Sexo', 'sexo', a, SEXOS, 'não informar')}
        <label class="bfa-c"><span>Flexibilidade <i class="bfa-dica" title=${DICA_FLEX}>?</i></span>
          <select value=${a.flex} onChange=${(e) => atualizarAtleta({ flex: e.target.value })}>
            ${FLEX.map((o) => html`<option key=${o} value=${o}>${o || 'não testada'}</option>`)}
          </select></label>
        ${campoSel('Nível', 'nivel', a, NIVEIS)}
        ${campoSel('Objetivo', 'objetivo', a, OBJETIVOS)}
      </div>
      <details class="bfa-dicas">
        <summary>Como medir entrepernas e flexibilidade</summary>
        <p><b>Entrepernas:</b> ${DICA_ENTREPERNAS}</p>
        <p><b>Flexibilidade:</b> ${DICA_FLEX}</p>
      </details>
      <div class="bfa-sub">Dores ou desconfortos</div>
      <div class="bfa-dores">
        ${DORES.map(([k, rot]) => html`<label key=${k}><input type="checkbox" checked=${a.dores.includes(k)} onChange=${(e) => dor(k, e.target.checked)} /> ${rot}</label>`)}
      </div>
      ${im != null && html`<p class="bfa-nota">IMC ${num(im, 1)}${im >= 30 ? ' — entra como fator de postura mais alta.' : ' — não muda os alvos.'}</p>`}

      <div class="bfa-sub">Alvos · ${perfil}${nPers ? html` <em>${nPers} personalizado${nPers > 1 ? 's' : ''}</em>` : ''}</div>
      <ul class="bfa-alvos">
        ${CHAVES_FAIXA.map((k) => {
          const L = alvos.linhas[k];
          const aberto = ed === k;
          return html`<li key=${k} ref=${aberto ? refEd : null} class=${L.mudou ? 'mudou' : ''}>
            <div class="bfa-al">
              <span>${NOMES_FAIXA[k]}</span>
              <${BotaoAlvo} linha=${L} texto=${faixaTexto(L.faixa) + UN(k)} aberto=${aberto} onClick=${() => setEd(aberto ? null : k)} />
            </div>
            ${aberto
              ? html`<${EditorFaixa} key=${k + perfil} perfil=${perfil} chave=${k} onFechar=${() => setEd(null)} />`
              : null}
            <p class="bfa-pq">${L.porque.join(' ')}</p>
          </li>`;
        })}
      </ul>
      <p class="bfa-nota">• = difere da modalidade · ✎ = definido à mão. Clique no alvo para editar. Altura e peso sozinhos quase não
        mudam os ângulos-alvo (o ângulo já normaliza o tamanho do corpo); flexibilidade, idade, nível, objetivo e dores pesam mais.
        As regras são conservadoras — dor persistente pede um profissional.</p>

      <div class="bfa-sub">Medidas sugeridas <em>ponto de partida</em></div>
      ${med.length
        ? html`<ul class="bfa-med">${med.map((m) => html`<li key=${m.nome}><span>${m.nome}</span><b>${m.valor}</b><p class="bfa-pq">${m.nota}</p></li>`)}</ul>
          <p class="bfa-nota">Fórmulas de partida (LeMond 1987; Hamley &amp; Thomas 1967): a altura final do selim é a que deixa o joelho no PMI dentro do alvo, medida em movimento.</p>`
        : html`<p class="bfa-nota">Informe a altura ou a entrepernas para ver a altura do selim (LeMond e Hamley) e o pedivela de partida.</p>`}
    </div>`;
}
