/**
 * components/esportes/CorridaPanel.js — "Corrida": análise da marcha (CV-32).
 *
 * O operador corrida.marcha mede ao vivo; este painel conduz (vista, pessoas,
 * altura, velocidade da esteira, câmera lenta — nos parâmetros do nó), mostra
 * o resumo por lado com a simetria, os alertas, a distribuição da pisada,
 * analisa um vídeo quadro a quadro e exporta CSV, JSON e relatório.
 *
 * Várias pessoas: tabela com uma linha por corredor (clique escolhe), o
 * detalhe do escolhido logo abaixo, "acompanhar só o selecionado" (o
 * operador passa a seguir só ele) e exportação com todos.
 */
import { html, useState, useRef } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { resumoCorrida, alertasCorrida, LIMITES } from '../../cv/runtime/livres-h/corrida.js';
import { canalCorrida } from '../../cv/runtime/livres-h/canal.js';
import {
  dadosCorrida, csvCorrida, htmlCorrida, dadosCorridaGrupo, csvCorridaGrupo, htmlCorridaGrupo,
} from '../../cv/runtime/livres-h/relatorio.js';
import { num } from '../../cv/runtime/livres-h/comum.js';
import { MotorMulti, FONTES_MULTI } from '../../cv/runtime/livres-h/multi-pose.js';
import { perfisFundo, MonitorCamera } from '../../cv/runtime/livres-h/camera.js';
import { caixaPose } from '../../cv/runtime/livres-h/pose.js';
import { cfgCorrida, OPCOES_PESSOAS } from '../../cv/operators/livres-h/corrida.js';
import { css, COR, baixar, carimbo, abrirRelatorio, useNo, useCanal, AnaliseArquivo } from './salto-corrida-comum.js';

const OP = 'corrida.marcha';
const f0 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)));
const f1 = (x) => num(x, 1);
const sub = { color: 'var(--ink-3)', fontSize: '9.5px' };

export function CorridaPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const espelhoApp = useStore(store, (st) => Boolean(st.mirror));
  const { no, cfg: p, definir, adicionar } = useNo(OP, 'aiv.corrida.prefs', nodes);
  const snap = useCanal(canalCorrida);
  const [aviso, setAviso] = useState('');
  const canal = canalCorrida, grupo = canal.grupo;
  const cfg = cfgCorrida(p);
  const lateral = cfg.vista === 'lateral';
  const multi = cfg.multi;
  const recente = Boolean(snap && performance.now() - snap.t < 3000);
  const daArquivo = canal.origem.tipo === 'arquivo';
  const gravando = canal.gravando();

  // ---- várias: uma linha por corredor; o detalhe é o do selecionado (ou o maior)
  const linhasMulti = multi ? grupo.resumos(cfg) : [];
  const idSel = multi ? (canal.selecionado != null && linhasMulti.some((l) => l.id === canal.selecionado) ? canal.selecionado : linhasMulti[0] ? linhasMulti[0].id : null) : null;
  const atual = multi ? linhasMulti.find((l) => l.id === idSel) || null : null;
  const cfgDet = multi && atual ? { ...cfg, pontos: atual.pontos } : cfg;
  const sessaoDet = multi ? (atual ? grupo.get(atual.id).sessao : null) : canal.sessao;
  const an = multi ? (atual ? atual.r : null) : canal.sessao.analisar(cfg);
  const res = multi ? (atual ? atual.res : null) : resumoCorrida(an, cfg);
  const alertas = multi ? (atual ? atual.alertas : []) : alertasCorrida(an, res, cfg);

  const trocar = (k, v) => { definir(k, v); if (k === 'vista' || k === 'pessoas' || k === 'fonteMulti') canal.zerar(); };
  const add = () => { const r = adicionar(); setAviso(r === 'ligado' ? 'Corrida ligada no Pipeline.' : 'Corrida adicionada ao Pipeline.'); setTimeout(() => setAviso(''), 3500); };
  const exportar = (tipo) => {
    if (multi) {
      const d = dadosCorridaGrupo(grupo, cfg);
      if (tipo === 'csv') baixar(`corrida-varios-${carimbo()}.csv`, '﻿' + csvCorridaGrupo(d), 'text/csv;charset=utf-8');
      else if (tipo === 'json') baixar(`corrida-varios-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
      else abrirRelatorio(htmlCorridaGrupo(d), `corrida-varios-relatorio-${carimbo()}.html`);
      return;
    }
    const d = dadosCorrida(canal.sessao, cfg);
    if (tipo === 'csv') baixar(`corrida-${carimbo()}.csv`, '﻿' + csvCorrida(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`corrida-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else abrirRelatorio(htmlCorrida(d), `corrida-relatorio-${carimbo()}.html`);
  };
  const temDados = multi ? linhasMulti.some((l) => l.res.passos > 0) : Boolean(res && res.passos);

  // ---- análise de arquivo: câmera nos dois modos; várias pessoas pelo motor do modo
  const mon = useRef(null), motor = useRef(null), ultCaixas = useRef([]);
  const iniciarArquivo = () => { mon.current = new MonitorCamera(); motor.current = null; ultCaixas.current = []; };
  const aoAmostra = (t, P, info) => {
    const cam = info && info.img && mon.current ? mon.current.adicionar(t, perfisFundo(info.img, [caixaPose(P)])) : null;
    canal.sessao.adicionar(t, P, p.minVis, { cam });
  };
  const prepararMulti = async () => {
    motor.current = new MotorMulti({ fonte: cfg.fonteMulti, maxPessoas: p.maxPessoas, detectarMs: 1200 });
    await motor.current.carregar();
  };
  const processadorMulti = async (img, t, info) => {
    const cam = mon.current ? mon.current.adicionar(t, perfisFundo(img, ultCaixas.current)) : null;
    const m = motor.current;
    const prep = m.preparar(img, t, { esp: false, alvoId: canal.soSelecionado ? canal.selecionado : null });
    const pessoas = await m.estimar(prep);
    ultCaixas.current = pessoas.map((x) => x.caixa).filter(Boolean);
    let n = 0;
    for (const pe of pessoas) {
      if (pe.incoerente || pe.aquecendo) continue;
      if (grupo.adicionar(pe.id, t, pe.P, p.minVis, { pontos: pe.pontos, caixa: pe.caixa, cam, quadro: { w: info.w, h: info.h } })) n++;
    }
    return n;
  };

  return html`
    <${Panel} id="corrida" title="Corrida"
              subtitle=${multi ? `${linhasMulti.length} corredores${atual && atual.res.cadencia ? ` · #${atual.id} ${Math.round(atual.res.cadencia)} ppm` : ''}`
                : `${res.passos} passos · ${res.cadencia ? Math.round(res.cadencia) + ' ppm' : '— ppm'}`}
              onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">A medição ao vivo roda no operador <b>Corrida</b> do Pipeline (pose no seu
        aparelho). Para tempos de contato mais finos, analise um vídeo quadro a quadro.</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Corrida está desligado no Pipeline.</p>`}

      <div class="tabs">
        <button class=${lateral ? 'on' : ''} onClick=${() => trocar('vista', 'lateral')}>Lateral</button>
        <button class=${!lateral ? 'on' : ''} onClick=${() => trocar('vista', 'trás/frente')}>Trás / frente</button>
      </div>
      <div style=${css.grade}>
        <label title="Uma: BlazePose completo (33 pontos), segue um corredor. Várias: um ID e uma sessão por corredor."><span class="ctl-label">Pessoas</span>
          <select style=${css.sel} value=${p.pessoas || OPCOES_PESSOAS[0]} onChange=${(e) => trocar('pessoas', e.target.value)}>
            ${OPCOES_PESSOAS.map((o) => html`<option key=${o} value=${o}>${o === 'várias' ? `várias (até ${p.maxPessoas || 6})` : o}</option>`)}
          </select></label>
        ${multi ? html`
          <label title="RTMO: todas as pessoas num passe, 17 pontos (sem pisada/tornozelo), não funde vizinhos. BlazePose por recorte: as N maiores, 33 pontos, mais barato até ~3 pessoas."><span class="ctl-label">Pose</span>
            <select style=${css.sel} value=${p.fonteMulti} onChange=${(e) => trocar('fonteMulti', e.target.value)}>
              ${Object.keys(FONTES_MULTI).map((o) => html`<option key=${o} value=${o}>${o}</option>`)}
            </select></label>
          <label><span class="ctl-label">Até N corredores</span>
            <input class="txt" type="number" min="1" max="20" inputmode="numeric" style=${{ width: '100%' }}
                   value=${p.maxPessoas || 6} onChange=${(e) => definir('maxPessoas', Math.max(1, Math.min(20, Number(e.target.value) || 6)))} /></label>`
          : html`<span></span>`}
        <label><span class="ctl-label">Altura (cm)</span>
          <input class="txt" type="number" min="0" max="230" inputmode="numeric" placeholder="para cm" style=${{ width: '100%' }}
                 value=${p.alturaCm || ''} onChange=${(e) => definir('alturaCm', Math.max(0, Math.min(230, Number(e.target.value) || 0)))} /></label>
        <label title="Opcional: com a velocidade da esteira sai o comprimento da passada"><span class="ctl-label">Esteira (km/h)</span>
          <input class="txt" type="number" min="0" max="30" step="0.1" inputmode="decimal" placeholder="opcional" style=${{ width: '100%' }}
                 value=${p.velocidadeKmh || ''} onChange=${(e) => definir('velocidadeKmh', Math.max(0, Math.min(30, Number(String(e.target.value).replace(',', '.')) || 0)))} /></label>
        <label title="Vídeo em câmera lenta: 240 fps exibido a 30 fps = 8"><span class="ctl-label">Câmera lenta</span>
          <select style=${css.sel} value=${String(p.lenta || 1)} onChange=${(e) => definir('lenta', Number(e.target.value))}>
            ${[1, 2, 4, 8, 16].map((n) => html`<option key=${n} value=${String(n)}>${n === 1 ? 'não (1×)' : n + '×'}</option>`)}
          </select></label>
        <label title="Automático segue o Espelhar da Fonte. 'sim' se o vídeo foi gravado espelhado"><span class="ctl-label">Espelhada</span>
          <select style=${css.sel} value=${p.espelhada} onChange=${(e) => definir('espelhada', e.target.value)}>
            <option value="automático">automático (${espelhoApp ? 'sim' : 'não'})</option><option value="sim">sim</option><option value="não">não</option>
          </select></label>
      </div>

      <div class="row tight" style=${{ gap: '6px' }}>
        <button class="btn accent" onClick=${add}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      <${AnaliseArquivo} canal=${canal} lenta=${p.lenta || 1} inverter=${p.espelhada === 'sim'} minVis=${p.minVis}
        coerencia=${true} aoIniciar=${iniciarArquivo}
        aoAmostra=${multi ? undefined : aoAmostra}
        processador=${multi ? processadorMulti : undefined} preparar=${multi ? prepararMulti : undefined} />
      ${snap && snap.cam && snap.cam.movendo && recente && !daArquivo && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>
        Câmera em movimento agora: cadência, contato e ângulos valem; oscilação vertical suspensa.</p>`}

      ${multi && html`<${TabelaCorredores} linhas=${linhasMulti} idSel=${idSel} canal=${canal} recente=${recente} daArquivo=${daArquivo} />`}

      ${res ? html`<${Detalhe} an=${an} res=${res} alertas=${alertas} cfg=${cfgDet} lateral=${lateral} sessao=${sessaoDet}
                     titulo=${multi && atual ? `Corredor #${atual.id}` : null} />`
        : multi && html`<p class="hint tight">Nenhum corredor com dados ainda. ${grupo.mapa.size} IDs vistos.</p>`}
      ${!multi && snap && snap.sem && recente && !daArquivo && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>Ninguém no quadro: corpo inteiro, com os pés.</p>`}
      ${!multi && snap && snap.incoerente && recente && !daArquivo && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>
        Pose duvidosa (${snap.motivo}): parece juntar dois corredores. Não entra na sessão; o corredor é re-detectado.
        Com gente colada, use "várias" (RTMO).</p>`}

      <div class="cfg-sub">Sessão</div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => canal.zerar()}>Nova sessão</button>
        <button class="btn" disabled=${daArquivo} onClick=${() => canal.definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
      </div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!temDados}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!temDados}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!temDados}>Relatório / PDF</button>
      </div>
      <p class="hint tight">${multi
        ? `${linhasMulti.length} corredores · ${linhasMulti.reduce((s, l) => s + l.amostras, 0)} amostras (exporta todos)`
        : `${canal.sessao.amostras.length} amostras${canal.sessao.descartadas ? ` · ${canal.sessao.descartadas} descartadas (pose incoerente)` : ''}`}${
        ` · ${daArquivo ? 'dados do arquivo' : gravando ? 'gravando ao vivo' : 'pausado'}.`}</p>

      <details style=${{ marginTop: '6px' }}>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Como filmar</summary>
        <ul class="hint" style=${{ paddingLeft: '18px', marginTop: '6px' }}>
          <li><b>Lateral:</b> câmera parada, perpendicular à esteira (ou à pista), na altura do quadril, a 3–4 m; corpo inteiro e os pés no quadro.</li>
          <li><b>Trás/frente:</b> câmera atrás (ou à frente) da esteira, na altura do quadril, alinhada com o corredor.</li>
          <li>Use 60 fps ou câmera lenta (informe o fator): a 30 fps cada contato tem ±33 ms de erro.</li>
          <li>Aqueça 1–2 min na velocidade do teste; meça 20–30 passos. Roupa justa, tênis visível, boa luz.</li>
          <li>Na pista, a câmera parada vê poucos passos por passagem: repita algumas passagens.</li>
          <li><b>Prova / transmissão</b> (vários atletas, câmera acompanhando): use "várias". Cadência, contato e ângulos valem;
            oscilação e distâncias não, com a câmera andando. Para contato e cadência, analise o vídeo quadro a quadro — ao vivo
            o RTMO roda a poucos quadros por segundo.</li>
        </ul>
      </details>
      <details>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Método e referências</summary>
        <p class="hint" style=${{ marginTop: '6px' }}>Contato pelo pé mais baixo (calcanhar/ponta) perto do chão; passo novo quando o
          apoio salta para a frente. Cadência = 60 ÷ tempo do passo, conferida pelo ritmo do quadril. Apoio = contato ÷ passada,
          passo a passo (≤ 50% com voo). Pisada pelo ângulo do pé no contato (Altman & Davis 2012).
          Overstriding: tíbia ${'>'} ${LIMITES.tibia}° e pé ${'>'} ${LIMITES.peFrentePct}% da perna à frente do quadril (heurística; Souza 2016;
          Heiderscheit et al. 2011). Queda da pelve (Bramah et al. 2018). Simetria |E − D| ÷ média (Robinson et al. 1987). Escala
          pela soma coxa + perna ≈ 0,491 da estatura (Drillis & Contini). Pose incoerente (proporções impossíveis — dois
          corredores fundidos) fica de fora. Joelho no contato fora de ${LIMITES.joelhoMin}–${LIMITES.joelhoMax}° é tratado como pose
          duvidosa. Câmera em movimento pelo deslocamento do fundo fora das pessoas. Várias pessoas: RTMO-s (17 pontos, contato
          pelo tornozelo) ou BlazePose por recorte; IDs pelo rastreio das caixas ou pelo Re-ID/tracking da cadeia. Triagem por
          vídeo, sem marcadores.</p>
      </details>
    <//>
  `;
}

/** Uma linha por corredor; clique escolhe; "só o selecionado" faz o operador seguir só ele. */
function TabelaCorredores({ linhas: todas, idSel, canal, recente, daArquivo }) {
  let linhas = todas;
  if (!linhas.length) {
    return html`<p class="hint tight">${recente || daArquivo ? 'Corredores aparecem aqui depois de ~8 amostras de pose cada.' : 'Ligue a Corrida no Pipeline (Pessoas: várias) ou analise um vídeo.'}</p>`;
  }
  const so = canal.soSelecionado;
  // quem tem ritmo de corrida primeiro (do maior ao menor); parados/sem ritmo no fim, apagados
  linhas = [...linhas.filter((l) => l.res.cadencia != null), ...linhas.filter((l) => l.res.cadencia == null)];
  const dim = { color: 'var(--ink-3)' };
  return html`
    <div class="cfg-sub">Corredores (${linhas.length})</div>
    <div style=${{ overflowX: 'auto' }}>
    <table style=${css.tab}>
      <thead><tr>
        <th style=${css.th}>#</th><th style=${css.thn}>Passos</th><th style=${css.thn}>ppm</th><th style=${css.thn}>Contato</th>
        <th style=${css.thn}>Voo</th><th style=${css.thn}>Apoio</th><th style=${css.thn}>Tronco</th><th style=${css.thn}>Joelho</th>
      </tr></thead>
      <tbody>
        ${linhas.map((l) => {
          const r = l.res, sel = l.id === idSel, semRitmo = r.cadencia == null, incerto = r.contatosConfiaveis === false;
          const cel = (v, d) => html`<td style=${{ ...css.num, ...(semRitmo || d ? dim : {}) }}>${v}</td>`;
          const joelho = [r.lados.E.joelhoContato.media, r.lados.D.joelhoContato.media].filter((x) => x != null);
          return html`<tr key=${String(l.id)} onClick=${() => canal.selecionar(l.id)} style=${{ cursor: 'pointer', background: sel ? 'rgba(255,216,77,.10)' : '' }}
                         title="Clique para ver o detalhe deste corredor">
            <td style=${{ ...css.td, color: sel ? 'var(--accent)' : '' }}>${sel ? '▸ ' : ''}${l.id}${l.pontos === 17 ? '' : html`<span style=${sub}> 33</span>`}</td>
            ${cel(r.passos)}
            ${cel(`${f0(r.cadencia)}${incerto && r.cadenciaQuadril && r.cadencia != null ? '*' : ''}`)}
            ${cel(f0(r.tc.media), incerto)}
            ${cel(f0(r.tf.media), incerto)}
            ${cel(r.apoioPct != null ? f0(r.apoioPct) + '%' : '—', incerto)}
            ${cel(r.tronco.n ? f0(r.tronco.media) + '°' : '—')}
            ${cel(joelho.length ? f0(joelho.reduce((s, x) => s + x, 0) / joelho.length) + '°' : '—')}
          </tr>`;
        })}
      </tbody>
    </table></div>
    <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap', marginTop: '6px', alignItems: 'center' }}>
      <label style=${{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px' }}
             title="O operador passa a medir só este corredor (mais rápido, e não troca de atleta no pelotão)">
        <input type="checkbox" checked=${so} disabled=${idSel == null} onChange=${(e) => canal.selecionar(idSel, e.target.checked)} />
        Acompanhar só o selecionado (#${idSel ?? '—'})</label>
      <button class="btn tiny" onClick=${() => canal.selecionar(linhas[0].id, true)} title="O maior na imagem (o mais perto da câmera)">Só o maior</button>
      ${so && html`<button class="btn tiny" onClick=${() => canal.selecionar(idSel, false)}>Todos</button>`}
    </div>
    <p class="hint tight" style=${{ marginTop: '2px' }}>* cadência pelo ritmo do quadril ou da abertura das pernas; contato, voo e apoio em cinza são
      indicativos (contatos incertos). Ordem: com ritmo de corrida primeiro, do maior (mais perto) ao menor; sem ritmo (parado,
      andando, poucos dados) no fim.</p>`;
}

/** Resumo, alertas, tabela por lado e pisada de um corredor (o único, ou o selecionado). */
function Detalhe({ an, res, alertas, cfg, lateral, sessao, titulo }) {
  const s17 = cfg.pontos === 17;
  const nomeLado = (L) => (an.ladosOk ? (L === 'E' ? 'Esq.' : 'Dir.') : (L === 'E' ? 'A' : 'B'));
  const E = res.lados.E, D = res.lados.D, si = res.simetria;
  const cmOk = Boolean(an.cmPorPx);
  const linhas = lateral ? [
    ['Contato', 'tc', 'ms', f0],
    ['Voo seguinte', 'tf', 'ms', f0],
    ['Joelho no contato', 'joelhoContato', '°', f0],
    ['Flexão máx. no apoio', 'joelhoApoioMin', '°', f0],
    ['Flexão máx. no balanço', 'joelhoBalancoMin', '°', f0],
    ['Tornozelo no contato', 'tornozeloContato', '°', f0, s17],
    ['Ângulo do pé (pisada)', 'anguloPe', '°', f1, s17],
    ['Pé à frente do quadril', cmOk ? 'peFrenteCm' : 'peFrentePct', cmOk ? 'cm' : '% perna', f0],
    ['Tíbia no contato', 'tibia', '°', f0],
  ] : [
    ['Contato', 'tc', 'ms', f0],
    ['Voo seguinte', 'tf', 'ms', f0],
    ['Queda da pelve', 'quedaPelve', '°', f1],
    ['Largura do passo', 'largura', '× quadril', (x) => num(x, 2)],
  ];
  const corSi = (s) => (s == null ? COR.info : s > LIMITES.assimetria ? COR.atencao : COR.ok);
  const pis = res.pisada, nPis = Object.values(pis).reduce((s, x) => s + x, 0);
  const osc = an.camMovel ? html`— <span style=${sub}>(câmera móvel)</span>` : res.osc.n ? f1(res.osc.media) + ' cm' : res.oscPx != null ? f0(res.oscPx) + ' px' : '—';
  return html`
    ${titulo && html`<div class="cfg-sub">${titulo}${s17 ? ' · 17 pontos' : ''}</div>`}
    <div class="kpis" style=${{ marginTop: titulo ? '2px' : '10px' }}>
      <div class="kpi"><b class=${res.cadencia ? '' : 'warn'}>${f0(res.cadencia)}</b><em>passos/min${res.contatosConfiaveis === false && res.cadenciaQuadril ? (res.fonteRitmo === 'pernas' ? ' (ritmo das pernas)' : ' (ritmo do quadril)') : ''}</em></div>
      <div class="kpi"><b>${f0(res.tc.media)}</b><em>contato ms</em></div>
      <div class="kpi"><b>${f0(res.tf.media)}</b><em>voo ms</em></div>
    </div>
    <p class="hint tight" style=${{ marginTop: '-4px' }}>
      Apoio <b>${res.apoioPct != null ? f0(res.apoioPct) + '%' : '—'}</b> / balanço <b>${res.apoioPct != null ? f0(100 - res.apoioPct) + '%' : '—'}</b> do ciclo
      ${lateral ? html` · oscilação <b>${osc}</b> · tronco <b>${res.tronco.n ? f0(res.tronco.media) + '°' : '—'}</b>` : ''}
      ${res.passadaM ? html` · passada <b>${num(res.passadaM, 2)} m</b>` : ''}
      ${an.dt ? ` · ${Math.round(1000 / an.dt)} Hz (±${f0(an.dt)} ms por borda)` : ''}</p>

    ${alertas.map((a, i) => html`<p key=${'a' + i} style=${css.alerta}><span style=${{ ...css.dot(a.nivel === 'atencao' ? COR.atencao : COR.info), marginTop: '5px' }}></span><span>${a.texto}</span></p>`)}
    ${!res.passos && html`<p class="hint tight">Corra alguns segundos com o corpo inteiro no quadro. ${sessao ? sessao.amostras.length : 0} amostras de pose.</p>`}

    <div class="cfg-sub">Por lado</div>
    <table style=${css.tab}>
      <thead><tr>
        <th style=${css.th}>Medida</th>
        <th style=${{ ...css.thn, color: COR.e }}>${nomeLado('E')} (${E.n || 0})</th>
        <th style=${{ ...css.thn, color: COR.d }}>${nomeLado('D')} (${D.n || 0})</th>
        <th style=${css.thn} title="|E − D| ÷ média (Δ = diferença, nas grandezas com sinal)">Assim.</th>
      </tr></thead>
      <tbody>
        ${linhas.map(([nome, k, un, fm, ausente]) => html`
          <tr key=${k}>
            <td style=${css.td}>${nome} <span style=${sub}>${un}</span></td>
            ${ausente ? html`<td style=${css.num} colspan="3"><span style=${{ color: COR.info }} title="RTMO dá 17 pontos: sem calcanhar e ponta do pé">— sem pontos do pé</span></td>` : html`
            <td style=${css.num}>${E[k] && E[k].n ? fm(E[k].media) : '—'}</td>
            <td style=${css.num}>${D[k] && D[k].n ? fm(D[k].media) : '—'}</td>
            <td style=${css.num}>${k in res.diferenca
              ? html`<span style=${{ color: COR.info }} title="diferença E − D">${res.diferenca[k] == null ? '—' : 'Δ ' + fm(res.diferenca[k])}</span>`
              : html`<span style=${{ color: corSi(si[k]) }}>${si[k] == null ? '—' : f0(si[k]) + '%'}</span>`}</td>`}
          </tr>`)}
        ${lateral && html`<tr><td style=${css.td}>Overstriding <span style=${sub}>passos</span></td>
          <td style=${css.num}>${E.overstriding || 0}</td><td style=${css.num}>${D.overstriding || 0}</td><td style=${css.num}></td></tr>`}
      </tbody>
    </table>
    ${lateral && !s17 && nPis > 0 && html`
      <div class="cfg-sub">Padrão de pisada</div>
      <div style=${{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', margin: '2px 0 4px' }}>
        ${[['retropé', '#fb923c'], ['médio-pé', '#FFD84D'], ['antepé', '#4ade80']].map(([k, c]) => pis[k] ? html`<div key=${k} title=${`${k}: ${pis[k]}`} style=${{ width: `${(pis[k] / nPis) * 100}%`, background: c }}></div>` : null)}
      </div>
      <p class="hint tight" style=${{ marginTop: 0 }}>Retropé ${pis['retropé']} · médio-pé ${pis['médio-pé']} · antepé ${pis['antepé']} (ângulo do pé no contato: ${'>'} ${LIMITES.retropé}° retropé, ${'<'} ${num(LIMITES.antepé, 1)}° antepé).</p>`}
    <p class="hint tight">${lateral
      ? 'Joelho: ângulo interno (180° = reto). Balanço: menor ângulo da outra perna enquanto este pé apoia. Tornozelo: perna × pé, 90° = neutro, menos = dorsiflexão. Tíbia + = tornozelo à frente do joelho.'
      : 'Queda da pelve: lado oposto ao apoio descendo (+), descontada a inclinação média da câmera. Largura: pé no apoio em relação à linha média, em larguras de quadril; negativa = cruzou a linha.'}
      ${s17 ? ' Pose de 17 pontos (RTMO): sem calcanhar e ponta, o contato é pelo tornozelo; pisada e tornozelo não são medidos — para eles use "BlazePose por recorte" ou uma pessoa.' : ''}
      ${!an.ladosOk && res.passos >= 4 ? ' Lados A/B: a pose não confirmou qual é o esquerdo.' : ''}</p>`;
}
