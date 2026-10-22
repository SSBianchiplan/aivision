/**
 * components/industrial/InspectPanel.js — painel "Inspeção visual" (CV-40).
 *
 * O operador inspect.programa inspeciona; este painel conduz e resume:
 * programa ativo, pôr no Pipeline, gatilho (estado e "Inspecionar agora"),
 * o último veredito com as medidas, contadores e taxa de refugo, a fila de
 * revisão e os alarmes. O editor de programa, o histórico com miniaturas, a
 * revisão e a estatística completa estão na tela cheia GPlanSiS|Inspect
 * (StudioInspect.js).
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import * as canal from '../../cv/runtime/livres-n/canal.js';
import { OP, fmt, pct, hora, ROT, injetarCSS, ativarInspect, abrirStudioInspect, baixar, carimbo } from './inspect-comum.js';

const CLS = { OK: 'ok', NOK: 'nok', INCERTO: 'inc' };
const ST = { PASS: 'ok', FAIL: 'nok', UNCERTAIN: 'inc', ERROR: 'inc' };

export function InspectPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [, setV] = useState(0);
  const [aviso, setAviso] = useState('');
  injetarCSS();
  // com a tela cheia aberta por cima, o painel não se redesenha
  useEffect(() => canal.assinar(() => { if (!canal.studioAberto()) setV((n) => n + 1); }), []);
  const msg = (t) => { setAviso(t); setTimeout(() => setAviso(''), 5000); };

  const prog = canal.programaAtivo();
  const progs = canal.programas();
  const ult = canal.ultimo();
  const e = canal.estatisticas();
  const gi = canal.infoGatilho();
  const alarmes = canal.alarmes().filter((a) => !a.reconhecido);
  const vivo = canal.recente(2500);

  return html`
    <${Panel} id="inspecao" title="Inspeção visual" subtitle=${ult ? `${ult.final} · #${ult.id} · refugo ${pct(e.refugo)}` : prog ? prog.codigo : 'GPlanSiS|Inspect'}
              onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">A inspeção roda no operador <b>Inspeção visual — programa</b> do Pipeline, em JS puro no seu
        aparelho (presença, contagem, paquímetro, cor, forma, área de defeito; nenhum modelo, nada é enviado).</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Inspeção está desligado no Pipeline.</p>`}
      <button class="btn accent ins-pn-studio" onClick=${() => abrirStudioInspect()}
        title="Tela cheia GPlanSiS|Inspect: ao vivo, última peça, veredito, medidas, histórico, revisão, estatística e o editor de programa">⛶ Abrir Studio Inspect</button>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn ${no && no.enabled ? '' : 'accent'}" onClick=${() => { const c = ativarInspect({ abrirPipeline: true }); msg(c ? 'Inspeção adicionada ao Pipeline.' : 'Inspeção ligada no Pipeline.'); }}>
          ${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn" disabled=${!prog} onClick=${() => { const r = canal.inspecionarAgora(); msg(r ? `#${r.id} ${r.veredito}` : canal.status() || 'Inspecionando no próximo quadro…'); }}
          title="Gatilho manual: congela o quadro atual e roda o programa">Inspecionar agora</button>
      </div>

      <label style=${{ display: 'block', margin: '10px 0 6px' }}><span class="ctl-label">Programa (receita guardada neste navegador)</span>
        <select class="ins-pn-sel" value=${prog ? prog.id : ''} onChange=${(ev) => { canal.ativar(ev.target.value); setV((n) => n + 1); }}>
          ${!prog && html`<option value="">— nenhum: crie no Studio —</option>`}
          ${progs.map((p) => html`<option key=${p.id} value=${p.id}>${p.codigo} · v${p.versao} — ${p.nome}</option>`)}
        </select></label>
      ${!prog && html`<div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap', marginBottom: '6px' }}>
        <button class="btn tiny" onClick=${() => { canal.criar('presenca'); msg('Programa «Presença e contagem» criado.'); }}>+ Presença e contagem</button>
        <button class="btn tiny" onClick=${() => { canal.criar('dimensional'); msg('Programa «Dimensional» criado.'); }}>+ Dimensional</button>
        <button class="btn tiny" onClick=${() => { canal.criar('cor_defeito'); msg('Programa «Cor e defeito» criado.'); }}>+ Cor e defeito</button>
      </div>`}
      ${prog && html`<p class="hint tight">${prog.tools.filter((t) => t.ativo).length} ferramentas · gatilho ${gi ? `${gi.modo} (${gi.estado}${gi.modo !== 'manual' ? `, ${Math.round(gi.ocupacao * 100)} %` : ''})` : prog.trigger.mode}
        · ROIs pelas marcações «Inspect · …» das Ferramentas de mouse</p>`}

      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      ${!vivo && no && no.enabled && html`<p class="hint tight">Aguardando imagem: escolha a câmera, um arquivo ou o YouTube em <b>Fonte</b>.</p>`}
      ${alarmes.map((a) => html`<p key=${a.id} class="hint tight ins-pn-alarme" role="alert">⚠ ${a.texto} · ${hora(a.em)}
        <button class="btn tiny" onClick=${() => canal.reconhecerAlarmes()}>Reconhecer</button></p>`)}

      <div class=${'ins-pn-ver ' + (ult ? CLS[ult.final] : '')}>
        <b>${ult ? ult.final : '—'}</b>
        <span>${ult ? `#${ult.id} · ${hora(ult.t)} · ${ult.ms} ms${!ult.revisao && ult.veredito !== 'OK' ? ' · a revisar' : ''}` : 'nenhuma peça ainda'}</span>
      </div>
      ${ult && html`<ul class="ins-pn-med">${ult.resultados.map((r) => html`<li key=${r.code}><b>${r.code}</b> <span>${fmt(r.value)}</span>
        <em>${r.expected}</em> <i class=${'ins-st ' + ST[r.status]}>${ROT[r.status]}</i></li>`)}</ul>`}

      <div class="kpis">
        <div class="kpi"><b>${e.fin.OK}</b><em>OK</em></div>
        <div class="kpi"><b style=${{ color: e.fin.NOK ? 'var(--bad, #ef4444)' : '' }}>${e.fin.NOK}</b><em>NOK</em></div>
        <div class="kpi"><b style=${{ color: e.fin.INCERTO ? 'var(--warn)' : '' }}>${e.fin.INCERTO}</b><em>INCERTO</em></div>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${pct(e.refugo)}</b><em>refugo</em></div>
        <div class="kpi"><b>${e.pendentes}</b><em>a revisar</em></div>
        <div class="kpi"><b>${fmt(e.cicloMedio, 0)}</b><em>ms ciclo</em></div>
      </div>
      <div class="ins-seq pequeno" aria-label="Últimas peças">${[...e.seq].slice(0, 40).reverse().map((s, i) => html`<i key=${i} class=${CLS[s]} title=${s}></i>`)}</div>
      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap' }}>
        <button class="btn tiny" disabled=${!e.n} onClick=${() => baixar(canal.historicoCSV(), `inspect_${carimbo()}.csv`, 'text/csv')}>Baixar CSV</button>
        <button class="btn tiny" disabled=${!e.pendentes} onClick=${() => abrirStudioInspect()}>Revisar ${e.pendentes || ''}</button>
        <button class="btn tiny" onClick=${() => canal.rearmarGatilho()}>Rearmar gatilho</button>
      </div>
    <//>
  `;
}

export default InspectPanel;
