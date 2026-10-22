/**
 * components/saude/FisioPanel.js — painel "Fisio" (CV-47): escolhe o teste,
 * mostra o resultado atual e as últimas medidas/tentativas, e abre o Studio
 * Fisio (perfil do paciente, curvas, tabela e relatório). Não é dispositivo médico.
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { canalFisio, cfgFisio, pacienteAtivo } from '../../cv/runtime/livres-p/canal.js';
import { OP, AVISO_MEDICO, ROTULO_PARAM, carregarCss, ativarFisio, baixar, carimbo, medidasCSV, tentativasCSV, num, TESTES, REF } from './fisio-comum.js';

export function FisioPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const cfg = cfgFisio({ ...defaultParams(OP), ...(no ? no.params : {}) });
  const [r, setR] = useState(() => canalFisio.instantaneo());
  useEffect(() => { carregarCss(); }, []);
  useEffect(() => canalFisio.assinar((x) => { if (!canalFisio.studioAberto()) setR(x); }), []);
  const res = r && r.res;
  const ses = canalFisio.sessao;
  const pac = pacienteAtivo();
  const ult = ses.tentativas[ses.tentativas.length - 1];
  return html`
    <${Panel} id="fisio" title="Fisio" subtitle=${pac ? pac.nome : TESTES[cfg.teste].nome} onClose=${onClose} ...${layout}>
      <button class="btn accent fsp-studio" onClick=${() => { ativarFisio(); store.set({ studioFisio: true }); }}>⛶ Abrir Studio Fisio</button>
      <div class="row tight" style=${{ gap: '4px', flexWrap: 'wrap' }}>
        ${Object.keys(ROTULO_PARAM).map((k) => html`<button key=${k} class="btn tiny ${no && cfg.teste === k ? 'accent' : ''}" onClick=${() => ativarFisio({ teste: ROTULO_PARAM[k] })}>${TESTES[k].curto}</button>`)}
      </div>
      ${!no && html`<p class="hint tight">Goniometria, TUG e sentar-levantar pela pose BlazePose, no aparelho. Escolha um teste para pôr no Pipeline.</p>`}
      ${no && html`<div class="fsp-num"><b>${cfg.teste === 'goniometria' ? (res && res.max != null ? `${num(res.max, 0)}°` : '—')
        : res && res.total != null ? (cfg.teste === 'sts30' ? `${res.n}×` : `${num(res.total, 2)} s`) : '—'}</b>
        <span>${res ? res.estado || '' : 'sem pose'}</span></div>`}
      ${no && cfg.teste === 'goniometria' && html`<button class="btn tiny" onClick=${() => canalFisio.registrar()}>Registrar medida</button>`}
      ${ult && html`<p class="hint tight">Última: ${TESTES[ult.teste].nome} — ${ult.teste === 'sts30' ? `${ult.nRep} vezes` : `${num(ult.total, 2)} s`}${ult.teste === 'tug' ? ` (ref. ≥ ${num(REF.tug, 1)} s)` : ''}.</p>`}
      ${ses.medidas.length > 0 && html`<table class="fsp-tab"><thead><tr><th>Articulação</th><th>Lado</th><th>Máx.</th></tr></thead>
        <tbody>${ses.medidas.slice(-5).map((m) => html`<tr key=${m.n}><td>${m.nome}</td><td>${m.lado === 'e' ? 'esq.' : 'dir.'}</td><td>${num(m.max, 0)}°</td></tr>`)}</tbody></table>`}
      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap' }}>
        <button class="btn tiny" onClick=${() => baixar(medidasCSV(ses, pac), `fisio_${carimbo()}_adm.csv`, 'text/csv')}>ADM CSV</button>
        <button class="btn tiny" onClick=${() => baixar(tentativasCSV(ses, pac), `fisio_${carimbo()}_testes.csv`, 'text/csv')}>Testes CSV</button>
      </div>
      <p class="hint tight">⚠ ${AVISO_MEDICO}</p>
    <//>
  `;
}

export default FisioPanel;
