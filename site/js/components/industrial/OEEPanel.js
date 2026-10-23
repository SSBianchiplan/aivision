/**
 * components/industrial/OEEPanel.js — painel "OEE" (CV-46, OEE pela câmera).
 *
 * O operador maquina.estado mede; este painel conduz e resume: pôr o nó no
 * Pipeline, marcar a máquina e a área de setup, o OEE da janela (D × P × Q),
 * o estado de cada máquina, as paradas sem motivo, o apontamento manual e os
 * CSVs. Linha do tempo, classificação de paradas, Pareto, turnos e
 * configuração estão na tela cheia GPlanSiS|OEE (StudioOEE.js).
 */
import { confirmar } from '../dialogo.js';
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { marcStore } from '../../cv/marcacoes.js';
import { obterMotor, assinar, recente, studioAberto, instantaneo, novaSessao, avisarAgora } from '../../cv/runtime/livres-o/canal.js';
import { OP, carregarCss, pct, hm, relogio, carimbo, baixar, ativarOEE, novaArea, maquinasMarcadas, ROTULO } from './oee-comum.js';

export function abrirStudioOEE() { ativarOEE(); store.set({ studioOEE: true }); }

export function OEEPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const nMaq = useStore(marcStore, (st) => maquinasMarcadas(st).length);
  const motor = obterMotor();
  const [r, setR] = useState(() => instantaneo());
  const [aviso, setAviso] = useState('');
  const [pecas, setPecas] = useState('');
  const [refugo, setRefugo] = useState('');
  useEffect(() => { carregarCss(); }, []);
  useEffect(() => assinar((x) => { if (!studioAberto()) setR(x); }), []);
  const msg = (t) => { setAviso(t); setTimeout(() => setAviso(''), 6000); };
  const kp = motor.kpis();
  const G = kp ? kp.geral : null;
  const vivo = recente(3000);
  const semMotivo = motor.paradas().filter((p) => !p.motivo).length;

  return html`
    <${Panel} id="oee" title="OEE" subtitle=${vivo && G ? `${kp.janela.nome} · OEE ${pct(G.oee, 0)}` : 'máquina sem CLP'} onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">OEE de máquina sem CLP pelo movimento na área marcada: rodando, parada e setup com histerese;
        soma peças do CounterVision, operador do Takt e OK/NOK do Inspect quando estão no Pipeline. Tudo no aparelho.</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó OEE está desligado no Pipeline.</p>`}
      <button class="btn accent oep-studio" onClick=${abrirStudioOEE}
        title="Tela cheia GPlanSiS|OEE: vídeo, OEE, linha do tempo, paradas com motivo, Pareto, turnos e relatório">⛶ Abrir Studio OEE</button>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn ${no && no.enabled ? '' : 'accent'}" onClick=${() => { ativarOEE({ abrirPipeline: true }); msg('OEE ligado no Pipeline.'); }}>
          ${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn" onClick=${() => msg(novaArea('maquina'))}>+ Máquina</button>
        <button class="btn" onClick=${() => msg(novaArea('setup'))}>+ Área de setup</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      ${!nMaq && html`<p class="hint tight">Marque a parte da máquina que SE MOVE quando ela trabalha (área com a função <b>OEE · máquina</b>) —
        ou use <b>+ Máquina</b>. Opcional: a bancada do ajuste com <b>OEE · setup</b>.</p>`}
      ${nMaq > 0 && !vivo && no && no.enabled && html`<p class="hint tight">Aguardando imagem: escolha a câmera, um arquivo ou o YouTube em <b>Fonte</b>.</p>`}
      <div class="oep-oee"><b>${pct(G && G.oee)}</b><span>OEE${G && G.parcial ? ` (parcial: falta ${G.faltam.join(' e ')})` : ''}</span></div>
      <div class="kpis">
        <div class="kpi"><b>${pct(G && G.disponibilidade, 0)}</b><em>disponib.</em></div>
        <div class="kpi"><b>${pct(G && G.desempenho, 0)}</b><em>desempenho</em></div>
        <div class="kpi"><b>${pct(G && G.qualidade, 0)}</b><em>qualidade</em></div>
      </div>
      <div class="cfg-sub">Máquinas agora</div>
      <ul class="oep-lista">
        ${r && r.maquinas && r.maquinas.length ? r.maquinas.map((m) => html`<li key=${m.id}><i class=${`oee-sw est-${m.estado || 'NAO_OBSERVADO'}`}></i>
          <span><b>${m.nome}</b> · ${m.estado ? `${ROTULO[m.estado]} ${relogio((r.t - m.desde) / 1000)}` : 'aguardando'}</span><em>${pct(m.mov, 1)}</em></li>`)
          : html`<li class="vazio">${nMaq ? `${nMaq} máquina(s) marcada(s), sem medição ainda.` : 'Nenhuma máquina.'}</li>`}
      </ul>
      ${semMotivo > 0 && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>${semMotivo} parada(s) sem motivo — classifique no Studio OEE.</p>`}
      <div class="cfg-sub">Apontamento manual</div>
      <div class="row tight" style=${{ gap: '5px' }}>
        <input class="in" type="number" min="0" placeholder="peças" aria-label="Peças" value=${pecas} onInput=${(e) => setPecas(e.target.value)} style=${{ width: '80px' }} />
        <input class="in" type="number" min="0" placeholder="refugo" aria-label="Refugo" value=${refugo} onInput=${(e) => setRefugo(e.target.value)} style=${{ width: '80px' }} />
        <button class="btn tiny" onClick=${() => { motor.apontar({ pecas: +pecas || 0, refugo: +refugo || 0 }); avisarAgora(); setPecas(''); setRefugo(''); msg('Apontado.'); }}>Apontar</button>
      </div>
      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
        <button class="btn tiny" onClick=${() => baixar(motor.intervalosCSV(), `oee_${carimbo()}_estados.csv`, 'text/csv')}>Estados CSV</button>
        <button class="btn tiny" onClick=${() => baixar(motor.paradasCSV(), `oee_${carimbo()}_paradas.csv`, 'text/csv')}>Paradas CSV</button>
        <button class="btn tiny" onClick=${() => baixar(motor.turnosCSV(), `oee_${carimbo()}_turnos.csv`, 'text/csv')}>OEE por turno CSV</button>
        <button class="btn tiny" onClick=${async () => { if (await confirmar('Começar uma sessão nova do OEE?', { titulo: 'Nova sessão', ok: 'Começar sessão nova', perigo: true })) { novaSessao(); msg('Sessão nova.'); } }}>Nova sessão</button>
      </div>
      <p class="hint tight">${G ? `Planejado ${hm(G.planejado)} · operando ${hm(G.operando)} · parada ${hm(G.seg.PARADA)} · setup ${hm(G.seg.SETUP)}.` : ''}</p>
    <//>
  `;
}

export default OEEPanel;
