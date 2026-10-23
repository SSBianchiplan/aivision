/**
 * components/industrial/TaktPanel.js — painel "Tempo de posto" (CV-39, porte do GPlanSiS|Takt).
 *
 * O operador takt.posto mede; este painel conduz e resume: pôr a cadeia no
 * Pipeline (Pose RTMO + Takt), criar postos (marcações "Takt · posto"), o
 * estado de cada posto agora, os KPIs do turno, os alarmes ativos e os CSVs.
 * Gráficos, calibração do piso e configuração estão na tela cheia
 * GPlanSiS|Takt (StudioTakt.js).
 */
import { confirmar } from '../dialogo.js';
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { marcStore } from '../../cv/marcacoes.js';
import { obterMotor, assinar, recente, studioAberto, instantaneo, novaSessao } from '../../cv/runtime/livres-m/canal.js';
import {
  OP, carregarCss, pct, hm, relogio, carimbo, baixar, ativarTakt, abrirStudioTakt, novoPosto, postosMarcados, ROTULO, ESTADOS,
} from './takt-comum.js';

export function TaktPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const nPostos = useStore(marcStore, (st) => postosMarcados(st).length);
  const motor = obterMotor();
  const [r, setR] = useState(() => instantaneo());
  const [aviso, setAviso] = useState('');
  useEffect(() => { carregarCss(); }, []);
  // com a tela cheia aberta por cima, o painel não se redesenha
  useEffect(() => assinar((x) => { if (!studioAberto()) setR(x); }), []);

  const msg = (t) => { setAviso(t); setTimeout(() => setAviso(''), 6000); };
  const kp = motor.kpis();
  const G = kp ? kp.geral : null;
  const vivo = recente(3000);
  const ativos = motor.alarmesAtivos();
  const atual = new Map((r && r.postos ? r.postos : []).map((p) => [p.id, p]));

  return html`
    <${Panel} id="takt" title="Tempo de posto" subtitle=${vivo && G ? `${kp.janela.nome} · ${pct(G.produtividade, 0)} produtivo` : 'GPlanSiS|Takt'} onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">Mede o tempo produtivo, ocioso e vago de cada posto pela pose das pessoas, em JS no seu
        aparelho (porte do GPlanSiS|Takt). Rostos borrados por padrão; nada da imagem é enviado.</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Takt está desligado no Pipeline.</p>`}
      <button class="btn accent tkp-studio" onClick=${() => abrirStudioTakt()}
        title="Tela cheia GPlanSiS|Takt: vídeo com postos, Gantt de estados, KPIs do turno, ranking, planta do piso, alarmes e CSV">⛶ Abrir Studio Takt</button>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn ${no && no.enabled ? '' : 'accent'}" onClick=${() => { const c = ativarTakt({ abrirPipeline: true }); msg(c ? 'Pose RTMO + Takt adicionados ao Pipeline.' : 'Takt ligado no Pipeline.'); }}>
          ${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn" onClick=${() => msg(novoPosto())} title="Cria uma área com a função &quot;Takt · posto&quot; no centro do vídeo">+ Novo posto</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      ${!nPostos && html`<p class="hint tight">Marque cada posto com as Ferramentas de mouse (retângulo ou polígono sobre a bancada e o
        lugar do operador) e escolha a função <b>Takt · posto</b> — ou use <b>+ Novo posto</b>.</p>`}
      ${nPostos > 0 && !vivo && no && no.enabled && html`<p class="hint tight">Aguardando imagem: escolha a câmera, um arquivo ou o YouTube em <b>Fonte</b>.</p>`}

      <div class="kpis">
        <div class="kpi"><b>${pct(G && G.produtividade, 0)}</b><em>produtivo</em></div>
        <div class="kpi"><b>${pct(G && G.ociosidade, 0)}</b><em>ocioso</em></div>
        <div class="kpi"><b>${pct(G && G.vacancia, 0)}</b><em>vago</em></div>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${pct(G && G.ocupacao, 0)}</b><em>ocupação</em></div>
        <div class="kpi"><b>${pct(G && G.cobertura, 0)}</b><em>cobertura</em></div>
        <div class="kpi"><b>${G ? hm(G.produtivo) : '—'}</b><em>t produtivo</em></div>
      </div>

      <div class="cfg-sub">Postos agora</div>
      <ul class="tkp-postos">
        ${kp && kp.postos.length ? kp.postos.map((p) => {
          const a = atual.get(p.id);
          const e = a && a.estado;
          return html`<li key=${p.id}><i class=${`tkt-sw st-${e || 'NAO_OBSERVADO'}`}></i><b>${p.nome}</b>
            <span>${e ? `${ROTULO[e]} · ${relogio((motor.ultTs - a.desde) / 1000)}` : '—'}</span><em>${pct(p.produtividade, 0)}</em></li>`;
        }) : html`<li class="vazio">${nPostos ? `${nPostos} posto(s) marcado(s), sem medição ainda.` : 'Nenhum posto.'}</li>`}
      </ul>
      <div class="tkp-leg">${ESTADOS.map((e) => html`<span key=${e}><i class=${`tkt-sw st-${e}`}></i>${ROTULO[e]}</span>`)}</div>

      <div class="cfg-sub" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Alarmes ${ativos.length ? `(${ativos.length})` : ''}</span>
        ${ativos.length > 0 && html`<button class="btn tiny" onClick=${() => { motor.reconhecer(); msg('Alarmes reconhecidos.'); }}>Reconhecer</button>`}
      </div>
      ${ativos.length ? html`<ul class="tkp-al">${ativos.map((a) => html`<li key=${a.chave} class=${a.reconhecido ? '' : 'nr'}><b>${a.tipo}</b> ${a.texto}</li>`)}</ul>`
        : html`<p class="hint tight">Nenhum alarme ativo.</p>`}

      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap' }}>
        <button class="btn tiny" onClick=${() => baixar(motor.intervalosCSV(), `takt_${carimbo()}_intervalos.csv`, 'text/csv')}>Intervalos CSV</button>
        <button class="btn tiny" onClick=${() => baixar(motor.kpiCSV(), `takt_${carimbo()}_kpi.csv`, 'text/csv')}>KPI CSV</button>
        <button class="btn tiny" onClick=${() => baixar(motor.eventosCSV(), `takt_${carimbo()}_eventos.csv`, 'text/csv')}>Eventos CSV</button>
        <button class="btn tiny" onClick=${async () => { if (await confirmar('Começar uma sessão nova? Os intervalos desta sessão serão apagados.', { titulo: 'Nova sessão', ok: 'Apagar e começar', perigo: true })) { novaSessao(); msg('Sessão nova.'); } }}>Nova sessão</button>
      </div>
      <p class="hint tight">${motor.piso.calibrado ? `Piso calibrado (erro ${motor.piso.erro.toFixed(3).replace('.', ',')} m): presença e planta em metros.` : 'Piso sem calibração: a presença usa o plano da imagem (calibre no Studio para metros e planta).'}
        ${motor.cfg.privacidade.borrar ? ' Rostos borrados.' : html` <b style=${{ color: 'var(--err)' }}>Borrão de rostos desligado.</b>`}
        <button class="btn tiny cal-btn" onClick=${() => window.dispatchEvent(new CustomEvent('aiv:calibrar', { detail: { op: 'takt.posto' } }))}>⚙ ${motor.piso.calibrado ? 'Recalibrar piso' : 'Calibrar piso'}</button></p>
    <//>
  `;
}

export default TaktPanel;
