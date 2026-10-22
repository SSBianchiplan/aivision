/**
 * components/saude/SaudeEsportesPanel.js — painel "Saúde e esportes+" (onda
 * 2-c, CV-70..77): escolhe o teste (presets), mostra o resultado do operador
 * ativo pelo retrato do canal (número principal com a faixa de confiança,
 * linhas, avisos, fonte), as ações (registrar, iniciar/parar, capturar…),
 * as particularidades (prescrição por link, tabela PROESP, referências) e
 * exporta CSV e relatório. Saúde: o aviso "não é dispositivo médico" fica
 * fixo no painel e vai em toda exportação. Abre o Studio Vitais/Referência.
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { instantaneo, assinar, pedir, zerar, referencias, apagarReferencia, salvarTabelaProesp, tabelaProesp } from '../../cv/runtime/livres-t/canal.js';
import { lerTabelaProesp } from '../../cv/runtime/livres-t/esportes.js';
import { linkPrescricao } from '../../cv/operators/livres-t/casa.js';
import {
  PRESETS_ONDA2C, AVISO_SAUDE, carregarCss, aplicarPresetOnda2c, opAtivo, registrosCSV, relatorioHTML, abrirRelatorio, baixar, carimbo, textoPrincipal,
} from './onda2c-comum.js';

const ROT_ACAO = { iniciar: '● Iniciar', parar: '■ Parar', capturar: '📸 Capturar pose', cesta: '✓ Cesta', erro: '✗ Erro' };
const fmt = (v, c = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(c).replace('.', ','));

export function SaudeEsportesPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = opAtivo(nodes);
  const [, setV] = useState(0);
  const [grupo, setGrupo] = useState(() => (no && PRESETS_ONDA2C.find((p) => p.op === no.op)?.grupo) || 'Saúde');
  const [msg, setMsg] = useState('');
  const [dor, setDor] = useState(0);
  const [nomeYoga, setNomeYoga] = useState('');
  useEffect(() => { carregarCss(); }, []);
  useEffect(() => assinar(() => setV((n) => n + 1)), []);
  const r = no ? instantaneo(no.op) : null;
  const pr = r && r.principal;
  const lista = PRESETS_ONDA2C.filter((p) => p.grupo === grupo);
  const temStudio = r && (r.vitais || r.comparacao);
  const atualizarParams = (patch) => { store.set({ nodes: store.get().nodes.map((n) => (n === no ? { ...n, params: { ...n.params, ...patch } } : n)) }); persist(); };

  const exportarCSV = () => { if (!r) return; baixar(registrosCSV(r), `${no.op}_${carimbo()}.csv`, 'text/csv'); setMsg('CSV gerado no aparelho.'); };
  const relatorio = () => { if (!r) return; abrirRelatorio(relatorioHTML(r), `${no.op}_${carimbo()}.html`); setMsg('Relatório aberto: Imprimir → Salvar como PDF.'); };
  const carregarTabela = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    f.text().then((t) => {
      const tab = lerTabelaProesp(t);
      if (!tab.linhas.length) { setMsg('Tabela não lida: ' + tab.erros.slice(0, 2).join('; ')); return; }
      salvarTabelaProesp({ ...tab, arquivo: f.name, carregada: new Date().toISOString() });
      setMsg(`Tabela "${f.name}": ${tab.linhas.length} linhas${tab.erros.length ? `, ${tab.erros.length} ignoradas` : ''}.`);
    });
  };
  const copiarLink = () => {
    const p = no.params;
    const url = linkPrescricao({ exercicio: p.exercicio, series: p.series, reps: p.reps, descansoS: p.descansoS, obs: p.obs });
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => setMsg('Link da prescrição copiado: envie ao paciente.'), () => setMsg(url));
  };

  return html`
    <${Panel} id="onda2c" title="Saúde e esportes+" subtitle=${r ? r.titulo : 'escolha um teste'} onClose=${onClose} ...${layout}>
      <div class="o2p-abas" role="tablist">
        ${['Saúde', 'Esportes e biomecânica'].map((g) => html`<button key=${g} role="tab" aria-selected=${grupo === g} class="btn tiny ${grupo === g ? 'accent' : ''}" onClick=${() => setGrupo(g)}>${g === 'Saúde' ? '🩺 Saúde' : '🏅 Esportes'}</button>`)}
      </div>
      <div class="o2p-lista">
        ${lista.map((p) => html`<button key=${p.nome} class="btn tiny ${no && no.op === p.op ? 'accent' : ''}" title=${p.desc} onClick=${() => { aplicarPresetOnda2c(p); setMsg(p.desc); }}>${p.nome}</button>`)}
      </div>
      ${!no && html`<p class="hint tight">Escolha um teste: a cadeia certa (com Malha do rosto, Mãos ou pose, quando precisa) entra no Pipeline.</p>`}
      ${no && html`
        <div class="o2p-num" data-onda2c-op=${no.op}>
          <b>${textoPrincipal(pr)}</b>
          ${pr && pr.faixa && html`<span class="o2p-faixa">faixa ${fmt(pr.faixa[0], pr.unidade === 'Hz' ? 1 : 0)}–${fmt(pr.faixa[1], pr.unidade === 'Hz' ? 1 : 0)}</span>`}
          <span>${pr ? pr.rotulo : 'aguardando o operador…'}</span>
        </div>
        ${r && (r.linhas || []).length > 0 && html`<table class="o2p-tab"><tbody>${r.linhas.map(([a, b], i) => html`<tr key=${i}><th>${a}</th><td>${b}</td></tr>`)}</tbody></table>`}
        ${r && (r.avisos || []).slice(0, 3).map((a, i) => html`<p key=${i} class="o2p-aviso">⚠ ${a}</p>`)}
        <div class="row tight o2p-acoes">
          ${r && r.acaoRegistrar && html`<button class="btn tiny accent" onClick=${() => pedir(no.op, 'registrar')}>${r.acaoRegistrar}</button>`}
          ${r && (r.acoes || []).map((a) => html`<button key=${a} class="btn tiny" onClick=${() => pedir(no.op, a, a === 'capturar' ? { nome: nomeYoga || no.params.referencia } : null)}>${ROT_ACAO[a] || a}</button>`)}
          ${temStudio && html`<button class="btn tiny" onClick=${() => store.set({ studioOnda2c: true })}>⛶ Studio</button>`}
          <button class="btn tiny" onClick=${() => { zerar(no.op); setMsg('Zerado.'); }}>Zerar</button>
        </div>
        ${no.op === 'casa.exercicio' && html`
          <div class="o2p-bloco"><b>Prescrição</b>
            <label>Exercício <select value=${no.params.exercicio} onChange=${(e) => atualizarParams({ exercicio: e.target.value })}>
              ${['Agachamento', 'Flexão de braço', 'Rosca bíceps', 'Desenvolvimento de ombro', 'Levantamento terra', 'Afundo (lunge)', 'Polichinelo', 'Abdominal', 'Prancha'].map((x) => html`<option key=${x}>${x}</option>`)}</select></label>
            <label>Séries <input type="number" min="1" max="20" value=${no.params.series} onChange=${(e) => atualizarParams({ series: +e.target.value || 1 })} /></label>
            <label>Repetições <input type="number" min="1" max="100" value=${no.params.reps} onChange=${(e) => atualizarParams({ reps: +e.target.value || 1 })} /></label>
            <div class="row tight"><button class="btn tiny" onClick=${copiarLink}>🔗 Copiar link para o paciente</button></div>
            <div class="row tight"><label>Dor agora (0–10) <input type="range" min="0" max="10" value=${dor} onInput=${(e) => setDor(+e.target.value)} /> <b>${dor}</b></label>
              <button class="btn tiny" onClick=${() => { pedir(no.op, 'dor', dor); setMsg(`Dor ${dor}/10 registrada.`); }}>Registrar dor</button></div>
          </div>`}
        ${no.op === 'proesp.bateria' && html`
          <div class="o2p-bloco"><b>Tabela de referência</b> ${tabelaProesp() ? html`<span class="hint">${tabelaProesp().arquivo} · ${tabelaProesp().linhas.length} linhas</span>` : html`<span class="hint">não carregada</span>`}
            <p class="hint tight">CSV do manual PROESP-BR: <code>teste;sexo;idade;classe1;classe2;…</code> (limites de cada classe, da pior à melhor) ou <code>teste;sexo;idade;zona_saudavel</code>. Testes: horizontal, corrida20, quadrado, abdominal.</p>
            <input type="file" accept=".csv,.txt,text/csv" onChange=${carregarTabela} />
          </div>`}
        ${(no.op === 'referencia.comparar' || no.op === 'yoga.pose') && html`
          <div class="o2p-bloco"><b>Referências salvas (neste navegador)</b>
            ${no.op === 'yoga.pose' && html`<label>Nome da pose <input value=${nomeYoga} placeholder=${no.params.referencia} onInput=${(e) => setNomeYoga(e.target.value)} /></label>`}
            ${Object.keys(referencias(no.op === 'yoga.pose' ? 'yoga' : 'movimento')).map((nome) => html`
              <div key=${nome} class="row tight o2p-ref"><button class="btn tiny ${no.params.referencia === nome ? 'accent' : ''}" onClick=${() => atualizarParams({ referencia: nome })}>${nome}</button>
                <button class="btn tiny" title="Apagar" onClick=${() => apagarReferencia(no.op === 'yoga.pose' ? 'yoga' : 'movimento', nome)}>✕</button></div>`)}
          </div>`}
        <div class="row tight o2p-acoes">
          <button class="btn tiny" onClick=${exportarCSV} disabled=${!r || !(r.registros || []).length}>CSV (${r ? (r.registros || []).length : 0})</button>
          <button class="btn tiny" onClick=${relatorio} disabled=${!r}>Relatório</button>
        </div>
        ${r && r.fonte && html`<p class="hint tight o2p-fonte">Fonte: ${r.fonte}</p>`}
      `}
      ${msg && html`<p class="hint tight" role="status">${msg}</p>`}
      ${(grupo === 'Saúde' || (r && r.saude)) && html`<p class="o2p-medico" data-aviso-medico="">⚠ ${AVISO_SAUDE}</p>`}
    <//>
  `;
}

export default SaudeEsportesPanel;
