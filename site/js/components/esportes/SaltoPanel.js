/**
 * components/esportes/SaltoPanel.js — "Salto": testes de salto (CV-31).
 *
 * O operador salto.teste mede ao vivo; este painel conduz o teste (tipo,
 * vista, altura da pessoa, câmera lenta — gravados nos parâmetros do nó),
 * mostra as tentativas com a incerteza, compara, descarta, analisa um vídeo
 * quadro a quadro e exporta CSV, JSON e o relatório para imprimir/PDF.
 * Lê a sessão do canal (runtime/livres-h/canal.js), avisado no máximo 4×/s.
 */
import { html, useState } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { TESTES, resumoSaltos, alertasSalto, REF } from '../../cv/runtime/livres-h/salto.js';
import { canalSalto } from '../../cv/runtime/livres-h/canal.js';
import { dadosSalto, csvSalto, htmlSalto } from '../../cv/runtime/livres-h/relatorio.js';
import { num } from '../../cv/runtime/livres-h/comum.js';
import { OPCOES_TESTE, cfgSalto } from '../../cv/operators/livres-h/salto.js';
import { css, COR, baixar, carimbo, abrirRelatorio, useNo, useCanal, AnaliseArquivo } from './salto-corrida-comum.js';

const OP = 'salto.teste';
const f0 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)));
const f1 = (x) => num(x, 1);

const DICAS = {
  cmj: 'Em pé, parado 1–2 s, mãos na cintura; desça e suba num movimento só, saia e volte ao chão com as pernas estendidas.',
  sj: 'Agache (joelho ~90°), fique parado 2–3 s e suba SEM descer antes; mãos na cintura.',
  dj: 'De pé na caixa (20–40 cm), dê um passo à frente, caia com os dois pés e salte o mais rápido e alto possível.',
  continuo: 'Saltos seguidos no lugar, mínimo contato com o chão, joelhos pouco dobrados (10–30 s).',
  horizontal: 'Câmera de lado, pessoa e trajeto inteiros no quadro; salte para a frente e "cole" a aterrissagem.',
};

export function SaltoPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const espelhoApp = useStore(store, (st) => Boolean(st.mirror));
  const { no, cfg: p, definir, adicionar } = useNo(OP, 'aiv.salto.prefs', nodes);
  const snap = useCanal(canalSalto);
  const [aviso, setAviso] = useState('');
  const [detalhes, setDetalhes] = useState(false);
  const canal = canalSalto, sessao = canal.sessao;
  const cfg = cfgSalto(p);
  const res = sessao.analisar(cfg);
  const tent = res.tentativas;
  const rs = resumoSaltos(tent, cfg.teste);
  const alertas = alertasSalto(res, cfg);
  const recente = Boolean(snap && performance.now() - snap.t < 3000);
  const horiz = cfg.teste === 'horizontal', dj = cfg.teste === 'dj' || cfg.teste === 'continuo';
  const chave = horiz ? 'dist' : 'hVoo';
  const maxV = Math.max(1, ...tent.filter((t) => !t.descartada).map((t) => t[chave] || 0));
  const gravando = canal.gravando();
  const daArquivo = canal.origem.tipo === 'arquivo';

  const trocar = (k, v) => { definir(k, v); if (k === 'vista' || k === 'teste') { canal.zerar(); } };
  const add = () => { const r = adicionar(); setAviso(r === 'ligado' ? 'Salto ligado no Pipeline.' : 'Salto adicionado ao Pipeline.'); setTimeout(() => setAviso(''), 3500); };
  const exportar = (tipo) => {
    const d = dadosSalto(sessao, cfg);
    if (tipo === 'csv') baixar(`salto-${carimbo()}.csv`, '﻿' + csvSalto(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`salto-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else abrirRelatorio(htmlSalto(d), `salto-relatorio-${carimbo()}.html`);
  };
  const valor = (t) => (horiz ? (t.dist != null ? `${f1(t.dist)} cm` : `${f0(t.distPx)} px`) : `${f1(t.hVoo)}`);
  const melhorV = rs.melhor ? rs.melhor[chave] : null;

  return html`
    <${Panel} id="salto" title="Salto" subtitle=${`${rs.n} ${rs.n === 1 ? 'salto' : 'saltos'}${melhorV != null ? ` · melhor ${f1(melhorV)} cm` : ''}`}
              onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">A medição ao vivo roda no operador <b>Salto</b> do Pipeline (pose BlazePose, tudo no seu
        aparelho). Para a medida mais precisa, analise um vídeo quadro a quadro.</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Salto está desligado no Pipeline.</p>`}

      <div style=${css.grade}>
        <label style=${{ gridColumn: '1 / -1' }}><span class="ctl-label">Teste</span>
          <select style=${css.sel} value=${p.teste} onChange=${(e) => trocar('teste', e.target.value)}>
            ${Object.entries(OPCOES_TESTE).map(([rot, k]) => html`<option key=${k} value=${rot}>${TESTES[k].nome}</option>`)}
          </select></label>
        <label><span class="ctl-label">Vista</span>
          <select style=${css.sel} value=${p.vista} onChange=${(e) => trocar('vista', e.target.value)}>
            <option value="lateral">lateral</option><option value="frontal">frontal</option>
          </select></label>
        <label><span class="ctl-label">Altura (cm)</span>
          <input class="txt" type="number" min="0" max="230" inputmode="numeric" placeholder="para cm" style=${{ width: '100%' }}
                 value=${p.alturaCm || ''} onChange=${(e) => definir('alturaCm', Math.max(0, Math.min(230, Number(e.target.value) || 0)))} /></label>
        <label title="Vídeo em câmera lenta: 240 fps exibido a 30 fps = 8"><span class="ctl-label">Câmera lenta</span>
          <select style=${css.sel} value=${String(p.lenta || 1)} onChange=${(e) => definir('lenta', Number(e.target.value))}>
            ${[1, 2, 4, 8, 16].map((n) => html`<option key=${n} value=${String(n)}>${n === 1 ? 'não (1×)' : n + '×'}</option>`)}
          </select></label>
        <label title="Automático segue o Espelhar da Fonte. 'sim' se o vídeo foi gravado espelhado"><span class="ctl-label">Espelhada</span>
          <select style=${css.sel} value=${p.espelhada} onChange=${(e) => definir('espelhada', e.target.value)}>
            <option value="automático">automático (${espelhoApp ? 'sim' : 'não'})</option><option value="sim">sim</option><option value="não">não</option>
          </select></label>
      </div>
      <p class="hint tight" style=${{ marginTop: 0 }}>${DICAS[cfg.teste]}</p>

      <div class="row tight" style=${{ gap: '6px' }}>
        <button class="btn accent" onClick=${add}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      <${AnaliseArquivo} canal=${canal} lenta=${p.lenta || 1} inverter=${p.espelhada === 'sim'} minVis=${p.minVis} />

      <div class="kpis" style=${{ marginTop: '10px' }}>
        <div class="kpi"><b class=${melhorV != null ? '' : 'warn'}>${melhorV != null ? f1(melhorV) : '—'}</b><em>melhor (cm)</em></div>
        <div class="kpi"><b>${rs.media != null ? f1(rs.media) : '—'}</b><em>média${rs.dp != null && rs.n > 1 ? ` ±${f1(rs.dp)}` : ''}</em></div>
        ${dj ? html`<div class="kpi"><b>${rs.rsi.n ? num(rs.rsi.media, 2) : '—'}</b><em>RSI (m/s)</em></div>`
             : html`<div class="kpi"><b style=${{ fontSize: '13px' }}>${!daArquivo && recente && res.estado ? res.estado : '—'}</b><em>${res.dt ? `${Math.round(1000 / res.dt)} Hz · ±${f0(res.dt)} ms` : 'estado'}</em></div>`}
      </div>
      ${cfg.teste === 'continuo' && rs.fadiga != null && html`<p class="hint tight">Índice de fadiga (3 primeiros × 3 últimos): <b>${f1(rs.fadiga)}%</b> · contato médio <b>${f0(rs.tc.media)} ms</b>.</p>`}
      ${alertas.map((a, i) => html`<p key=${'a' + i} style=${css.alerta}><span style=${{ ...css.dot(COR.info), marginTop: '5px' }}></span><span class="hint" style=${{ margin: 0 }}>${a}</span></p>`)}
      ${snap && snap.sem && recente && !daArquivo && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>Ninguém no quadro: corpo inteiro, dos pés à cabeça.</p>`}

      <div class="cfg-sub" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Tentativas${tent.length ? ` (${tent.length})` : ''}</span>
        <button class="btn tiny" style=${{ padding: '1px 7px' }} onClick=${() => setDetalhes(!detalhes)}>${detalhes ? 'menos' : 'ângulos'}</button>
      </div>
      ${!tent.length && html`<p class="hint tight">Nenhum salto ainda. ${sessao.amostras.length ? `${sessao.amostras.length} amostras de pose.` : ''}</p>`}
      ${tent.length > 0 && html`
        <table style=${css.tab}>
          <thead><tr>
            <th style=${css.th}>#</th><th style=${css.thn}>${horiz ? 'Dist.' : 'Altura cm'}</th><th style=${{ ...css.th, width: '28%' }}></th>
            ${detalhes
              ? html`<th style=${css.thn} title="Joelho na decolagem / aterrissagem / flexão máxima">Joelho</th><th style=${css.thn}>${cfg.vista === 'frontal' ? 'FPPA E/D' : 'Quadril'}</th>`
              : html`<th style=${css.thn}>${horiz ? 'Voo' : 'CM'}</th><th style=${css.thn}>${dj ? 'Contato·RSI' : cfg.teste === 'sj' ? 'Joelho' : 'Contram.'}</th>`}
            <th style=${css.th}></th>
          </tr></thead>
          <tbody>
            ${tent.map((t) => html`
              <tr key=${t.n} style=${{ opacity: t.descartada ? 0.4 : 1 }} title=${[`voo ${f0(t.tv)} ± ${f0(t.tvInc)} ms`, ...t.avisos].join(' · ')}>
                <td style=${css.td}>${t.n}${rs.melhor === t ? ' ★' : ''}${t.avisos.length ? html` <span style=${{ color: COR.atencao }}>⚠</span>` : ''}</td>
                <td style=${css.num}>${valor(t)}${!horiz && html`<span style=${{ color: 'var(--ink-3)', fontSize: '9.5px' }}> ±${f1(t.hVooInc)}</span>`}</td>
                <td style=${css.td}><div style=${css.trilho}><div style=${{ ...css.barra, width: `${Math.round(((t[chave] || 0) / maxV) * 100)}%`, background: rs.melhor === t ? 'var(--ok)' : 'var(--accent)' }}></div></div></td>
                ${detalhes
                  ? html`<td style=${css.num}>${f0(t.joelhoDec)}/${f0(t.joelhoAte)}/${f0(t.joelhoMinAte)}</td>
                         <td style=${css.num}>${cfg.vista === 'frontal' ? `${f0(t.valgo && t.valgo.e)}/${f0(t.valgo && t.valgo.d)}` : `${f0(t.quadrilDec)}/${f0(t.quadrilAte)}`}</td>`
                  : html`<td style=${css.num}>${horiz ? `${f0(t.tv)} ms` : f1(t.hCM)}</td>
                         <td style=${css.num}>${dj ? (t.tc != null ? `${f0(t.tc)}·${num(t.rsi, 2)}` : '—') : cfg.teste === 'sj' ? `${f0(t.joelhoFundo)}°` : (t.prof != null ? `${f1(t.prof)} cm` : '—')}</td>`}
                <td style=${{ ...css.td, textAlign: 'right' }}>
                  <button class="btn tiny" style=${{ padding: '0 6px' }} title=${t.descartada ? 'Voltar a contar' : 'Descartar esta tentativa'}
                          onClick=${() => { sessao.alternarDescarte(t.tDec); canal.avisarJa(); }}>${t.descartada ? '↺' : '✕'}</button></td>
              </tr>`)}
          </tbody>
        </table>
        <p class="hint tight">Altura pelo <b>tempo de voo</b> (g·t²/8) ± pior caso de ${res.dt ? f0(res.dt) : '—'} ms por borda.
          <b>CM</b> = subida do centro de massa ${res.cmPorPx ? `(escala ${num(res.cmPorPx * 10, 2)} mm/px)` : '(informe a altura)'}${res.gAp ? ` · gravidade aparente ${num(res.gAp, 1)} m/s²` : ''}.
          ${detalhes ? `Joelho: decolagem / aterrissagem / flexão máx. (180° = reto).${cfg.vista === 'frontal' ? ` FPPA > ${REF.fppaValgo}° = joelho para dentro.` : ''}` : ''}</p>`}

      <div class="cfg-sub">Sessão</div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => canal.zerar()}>Nova sessão</button>
        <button class="btn" disabled=${daArquivo} onClick=${() => canal.definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
      </div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!tent.length}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!tent.length}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!tent.length}>Relatório / PDF</button>
      </div>
      <p class="hint tight">${sessao.amostras.length} amostras · ${daArquivo ? 'dados do arquivo' : gravando ? 'gravando ao vivo' : 'pausado'}.</p>

      <details style=${{ marginTop: '6px' }}>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Como filmar</summary>
        <ul class="hint" style=${{ paddingLeft: '18px', marginTop: '6px' }}>
          <li>Celular parado num tripé, deitado (paisagem), a 3–4 m; corpo inteiro e o chão no quadro o tempo todo.</li>
          <li><b>Lateral</b> para altura, contramovimento e salto horizontal; <b>frontal</b> para valgo e assimetria na aterrissagem.</li>
          <li>Use a maior taxa de quadros do aparelho: 60 fps já corta a incerteza pela metade; câmera lenta (120/240 fps) é o ideal — informe o fator.</li>
          <li>Boa luz, roupa que contraste com o fundo, tênis visível. Comece parado em pé 1–2 s (calibra o chão e a escala).</li>
          <li>Para medir em cm (CM, profundidade, distância) informe a altura da pessoa e filme com ela no mesmo plano do salto.</li>
        </ul>
      </details>
      <details>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Método e fórmulas</summary>
        <p class="hint" style=${{ marginTop: '6px' }}>Decolagem e aterrissagem pela base dos pés (calcanhar/ponta) em relação ao chão,
          interpoladas e extrapoladas até o contato. Altura = g·t²/8 (Bosco et al. 1983; Linthorne 2001), supondo a mesma postura
          ao sair e ao voltar. Incerteza = ±1 quadro em cada borda → ±g·t·Δt/4 na altura. CM pelo modelo segmentar de Dempster/Winter;
          escala pela estatura (olhos ≈ 0,936 da altura). Contramovimento: descida do CM desde o nível em pé; carga = início da descida →
          fundo; propulsão = fundo → decolagem. RSI = altura (m) ÷ contato (s) (Flanagan & Comyns 2008). Fadiga = queda da média dos
          3 últimos saltos em relação aos 3 primeiros. FPPA = ângulo coxa–perna no plano frontal (+ = para dentro). Triagem por vídeo:
          não substitui plataforma de força.</p>
      </details>
    <//>
  `;
}
