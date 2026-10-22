/**
 * components/esportes/AcademiaPanel.js — "Academia": repetições e forma.
 *
 * O operador academia.treino (CV-30) mede; este painel mostra e conduz:
 * exercício (automático ou escolhido) e metas (gravados nos parâmetros do nó
 * do Pipeline), placar ao vivo, o resultado da última repetição, a lista de
 * repetições com a qualidade, o resumo do treino e a exportação (CSV, JSON e
 * relatório para imprimir/PDF).
 *
 * O executor não expõe o ctx do quadro; o operador publica num canal
 * (runtime/livres-g/canal.js), que este painel assina — no máximo 4×/s.
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { EXERCICIOS, OPCOES_EXERCICIO, LIMITES, TAXA_MIN_HZ, idExercicio, num, mmss } from '../../cv/runtime/livres-g/academia.js';
import {
  assinar, instantaneo, obterTreino, zerarTreino, definirGravando, estaGravando, fecharSerieAgora, destravarSom, bipe,
} from '../../cv/runtime/livres-g/canal.js';
import { dadosTreino, csvTreino, htmlRelatorio } from '../../cv/runtime/livres-g/relatorio.js';

const OP = 'academia.treino';
const PREFS = 'aiv.academia.prefs';
const lerPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (_) { return {}; } };
const gravarPrefs = (v) => { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado */ } };

const COR = { ok: '#4ade80', alerta: '#fb923c', info: '#22d3ee', mudo: 'var(--ink-3)' };
const f1 = (x) => num(x, 1);
const f0 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)));

const css = {
  tab: { width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
  th: { textAlign: 'left', fontWeight: 500, color: 'var(--ink-3)', fontSize: '9.5px', padding: '3px 3px', borderBottom: '1px solid var(--line-2)', position: 'sticky', top: 0, background: 'var(--panel-solid, #0b2b28)' },
  td: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', verticalAlign: 'top' },
  num: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap', verticalAlign: 'top' },
  sel: { width: '100%', padding: '6px 7px', borderRadius: '7px', border: '1px solid var(--line)', background: 'rgba(0,0,0,.25)', color: 'var(--ink)', font: 'inherit', fontSize: '12px' },
  grade: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))', gap: '6px 8px', marginBottom: '8px' },
  placar: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px', margin: '10px 0 8px' },
  cel: { border: '1px solid var(--line-2)', borderRadius: '9px', padding: '6px 4px', textAlign: 'center', background: 'rgba(0,0,0,.18)', minWidth: 0 },
  grande: { display: 'block', fontFamily: 'var(--mono)', fontSize: '24px', fontWeight: 700, lineHeight: 1.1 },
  rot: { fontSize: '9.5px', color: 'var(--ink-3)' },
  fb: (cor) => ({ border: `1px solid ${cor}`, borderLeft: `4px solid ${cor}`, borderRadius: '8px', padding: '7px 9px', margin: '0 0 8px', background: 'rgba(0,0,0,.2)' }),
  barra: { height: '6px', borderRadius: '4px', background: 'rgba(255,255,255,.1)', overflow: 'hidden', margin: '4px 0 2px' },
  lista: { maxHeight: '230px', overflowY: 'auto', border: '1px solid var(--line-2)', borderRadius: '8px' },
};

function baixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

/** Texto curto de uma regra por exercício (seção "Regras"). */
const REGRAS = {
  agachamento: `Joelho (quadril–joelho–tornozelo; de frente, pela altura do quadril). Fundo ≤ ${EXERCICIOS.agachamento.alvo.trabalho}° ou quadril na linha do joelho; estender ≥ ${EXERCICIOS.agachamento.alvo.repouso}° em cima. De lado: tronco ≤ ${LIMITES.troncoAgachamento}° da vertical, joelho até ${Math.round(LIMITES.joelhoFrente * 100)}% da perna à frente da ponta do pé. De frente: joelhos não fecham abaixo de ${Math.round(LIMITES.valgo * 100)}% da distância em pé (valgo), quadril nivelado (≤ ${LIMITES.pelve}°), lados a ≤ ${LIMITES.assimetria}°.`,
  flexao: `Cotovelo. Fundo ≤ ${EXERCICIOS.flexao.alvo.trabalho}°, braços ≥ ${EXERCICIOS.flexao.alvo.repouso}° em cima. Quadril até ${Math.round(LIMITES.quadrilCaindo * 100)}% abaixo (caindo) ou ${Math.round(LIMITES.quadrilAlto * 100)}% acima (alto) da linha ombro–tornozelo.`,
  rosca: `Cotovelo. Fechar ≤ ${EXERCICIOS.rosca.alvo.trabalho}°, estender ≥ ${EXERCICIOS.rosca.alvo.repouso}°. Braço a ≤ ${LIMITES.cotoveloRosca}° do tronco (cotovelo parado), balanço do tronco ≤ ${LIMITES.balanco}°.`,
  desenvolvimento: `Cotovelo; conta ao travar em cima. Em cima ≥ ${EXERCICIOS.desenvolvimento.alvo.repouso}°, embaixo ≤ ${EXERCICIOS.desenvolvimento.alvo.trabalho}°. De lado: tronco para trás ≤ ${LIMITES.troncoTras}° (lombar). De frente: punhos nivelados.`,
  terra: `Quadril (ombro–quadril–joelho); conta ao travar (a primeira puxada do chão também). Travar ≥ ${EXERCICIOS.terra.alvo.repouso}° em cima. De lado: costas arredondadas (aproximação: tronco ${Math.round(LIMITES.encurtamentoTronco * 100)}% mais curto no fundo ou cabeça/ombros < ${LIMITES.pescocoTerra}°), barra até ${Math.round(LIMITES.barraLonge * 100)}% da perna do meio do pé.`,
  afundo: `Joelho da frente ≤ ${EXERCICIOS.afundo.alvo.trabalho}°. De lado: tronco ≤ ${LIMITES.troncoAfundo}° da vertical, joelho até ${Math.round(LIMITES.joelhoFrente * 100)}% da perna à frente da ponta do pé. De frente: joelho da frente sem cair para dentro.`,
  polichinelo: `Abdução do ombro (quadril–ombro–punho): ≥ ${EXERCICIOS.polichinelo.alvo.trabalho}° aberto, ≤ ${EXERCICIOS.polichinelo.alvo.repouso}° fechado; pés ≥ ${num(LIMITES.pesPolichinelo, 1)}× a largura do quadril; braços iguais.`,
  abdominal: `Quadril (ombro–quadril–joelho); o tronco sobe ≥ ${LIMITES.subidaAbdominal}° a partir de deitado.`,
  prancha: `Tempo em posição (corpo > 55° da vertical, linha ombro–quadril–tornozelo > 140°). Alinhado: quadril até ${Math.round(LIMITES.quadrilCaindo * 100)}% abaixo / ${Math.round(LIMITES.quadrilAlto * 100)}% acima da linha; de lado, ombro sobre o cotovelo. Boa = ≥ 80% do tempo alinhado.`,
};

export function AcademiaPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(OP), ...lerPrefs() }));
  const cfg = no ? { ...defaultParams(OP), ...no.params } : prefs;

  const [snap, setSnap] = useState(() => instantaneo());
  const [, setTick] = useState(0);
  useEffect(() => assinar((s) => { setSnap(s); setTick((t) => t + 1); }), []);
  // relógio do descanso: redesenha 1×/s mesmo sem inferência
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 1000); return () => clearInterval(id); }, []);
  const [aviso, setAviso] = useState('');
  const [verTodas, setVerTodas] = useState(false);

  const treino = obterTreino();
  const recente = Boolean(snap && performance.now() - snap.t < 3000);
  const exId = treino.exAtual;
  const ex = exId ? EXERCICIOS[exId] : null;
  const manual = idExercicio(cfg.exercicio);
  const prancha = (manual || exId) === 'prancha';
  const aberta = treino.serieAberta();
  const nSerie = aberta ? aberta.n : treino.series.length + 1;
  // sem série aberta (descansando), o placar mostra a última série
  const ultSerie = treino.series[treino.series.length - 1] || null;
  const mostrada = aberta || ultSerie;
  const repsSerie = mostrada && !mostrada.isometrica ? mostrada.reps.length : 0;
  const isom = treino.isometricoAgora();
  const descanso = !aberta && treino.series.length && recente ? treino.descanso(snap.t + (performance.now() - snap.t)) : null;
  const res = treino.resumo();
  const gravando = estaGravando();
  const ultima = treino.ultimaRep;

  function definir(k, v) {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    const np = { ...prefs, [k]: v };
    setPrefs(np); gravarPrefs(np);
    if (i >= 0) {
      store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, params: { ...n.params, [k]: v } } : n)) });
      persist();
    }
  }
  const numero = (k, min, max) => (e) => definir(k, Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))));

  function adicionar() {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    let novos;
    if (i >= 0) novos = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
    else novos = [...ns, { id: newNodeId(), op: OP, params: { ...defaultParams(OP), ...prefs }, enabled: true }];
    store.set({ nodes: novos, panels: { ...store.get().panels, pipeline: true } });
    persist();
    if (cfg.bipe) destravarSom();
    setAviso(i >= 0 ? 'Academia ligada no Pipeline.' : 'Academia adicionada ao Pipeline.');
    setTimeout(() => setAviso(''), 3500);
  }

  const exportar = (tipo) => {
    const d = dadosTreino(treino, cfg);
    if (tipo === 'csv') baixar(`academia-${carimbo()}.csv`, '﻿' + csvTreino(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`academia-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else {
      const h = htmlRelatorio(d);
      const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
      const w = window.open(url, '_blank');
      if (!w) baixar(`academia-relatorio-${carimbo()}.html`, h, 'text/html;charset=utf-8');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  // ---- feedback da última repetição (ou o alerta ao vivo da prancha)
  let fb = null;
  if (recente && snap.alertasVivos && snap.alertasVivos.length) fb = { cor: COR.alerta, titulo: 'Ajuste agora', itens: snap.alertasVivos.map((a) => a.msg) };
  else if (ultima) {
    fb = ultima.boa
      ? { cor: COR.ok, titulo: ultima.ex === 'prancha' ? `Prancha ${mmss(ultima.dur)} — alinhada` : `Repetição ${ultima.nSerie} — boa`, itens: [] }
      : { cor: COR.alerta, titulo: ultima.ex === 'prancha' ? `Prancha ${mmss(ultima.dur)} — com alerta` : `Repetição ${ultima.nSerie} — com alerta`, itens: ultima.alertas.map((a) => a.msg) };
  }

  const estado = !no ? null
    : !no.enabled ? 'O nó Academia está desligado no Pipeline.'
    : !recente ? 'Aguardando a pessoa na imagem (ligue a câmera ou abra um vídeo em Fonte).'
    : snap.sem ? 'Ninguém na imagem: enquadre o corpo inteiro.'
    : snap.aquecendo ? 'Ajustando a pose…'
    : !exId ? `Reconhecendo o exercício… comece a se mover${snap.candidato ? ` (parece ${EXERCICIOS[snap.candidato].nome.toLowerCase()})` : ''}.`
    : null;

  const fase = recente && snap.fase && ex && ex.fases.length
    ? (snap.fase === 'repouso' ? 'pronto' : snap.fase === 'ida' ? ex.fases[0] : ex.fases[1]) : null;
  const reps = verTodas ? treino.reps.slice().reverse() : treino.reps.slice(-25).reverse();
  const metaN = prancha ? cfg.metaSegundos : cfg.metaReps;
  const progresso = prancha ? (isom ? isom.dur / cfg.metaSegundos : 0) : repsSerie / Math.max(1, cfg.metaReps);
  const sub = !exId ? `${res.reps} repetições`
    : aberta || isom ? `${ex.nome} · série ${nSerie} · ${prancha ? (isom ? mmss(isom.dur) : '0:00') : repsSerie + ' reps'}`
    : `${ex.nome} · ${treino.series.length} séries · ${res.reps} reps`;

  return html`
    <${Panel} id="academia" title="Academia" subtitle=${sub} onClose=${onClose} ...${layout}>
      ${!no && html`
        <p class="hint tight">Conta repetições e séries e checa a forma pela pose (BlazePose) — tudo no seu aparelho,
          nada é enviado. Escolha o exercício (ou deixe no automático), as metas e adicione:</p>`}

      <div style=${css.grade}>
        <label style=${{ gridColumn: '1 / -1' }}><span class="ctl-label">Exercício</span>
          <select style=${css.sel} value=${cfg.exercicio} onChange=${(e) => definir('exercicio', e.target.value)}>
            ${OPCOES_EXERCICIO.map((n) => html`<option key=${n} value=${n}>${n === 'automático' ? 'Automático (reconhecer pelo movimento)' : n}</option>`)}
          </select></label>
        <label><span class="ctl-label">Séries</span>
          <input class="txt" type="number" min="1" max="20" inputmode="numeric" style=${{ width: '100%' }}
                 value=${cfg.metaSeries} onChange=${numero('metaSeries', 1, 20)} /></label>
        ${prancha
          ? html`<label><span class="ctl-label">Segundos</span>
              <input class="txt" type="number" min="5" max="600" step="5" inputmode="numeric" style=${{ width: '100%' }}
                     value=${cfg.metaSegundos} onChange=${numero('metaSegundos', 5, 600)} /></label>`
          : html`<label><span class="ctl-label">Repetições</span>
              <input class="txt" type="number" min="1" max="100" inputmode="numeric" style=${{ width: '100%' }}
                     value=${cfg.metaReps} onChange=${numero('metaReps', 1, 100)} /></label>`}
        <label><span class="ctl-label">Descanso (s)</span>
          <input class="txt" type="number" min="0" max="600" step="5" inputmode="numeric" style=${{ width: '100%' }}
                 value=${cfg.descansoS} onChange=${numero('descansoS', 0, 600)} /></label>
        <label title="Sem repetição por mais que isto, a série é fechada"><span class="ctl-label">Pausa fecha série (s)</span>
          <input class="txt" type="number" min="2" max="60" inputmode="numeric" style=${{ width: '100%' }}
                 value=${cfg.pausaSerieS} onChange=${numero('pausaSerieS', 2, 60)} /></label>
        <label><span class="ctl-label">Tolerância</span>
          <select style=${css.sel} value=${cfg.tolerancia} onChange=${(e) => definir('tolerancia', e.target.value)}>
            ${['normal', 'rigorosa', 'tolerante'].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', alignSelf: 'end', paddingBottom: '6px' }}>
          <input type="checkbox" checked=${!!cfg.bipe}
                 onChange=${(e) => { definir('bipe', e.target.checked); if (e.target.checked) { destravarSom(); setTimeout(() => bipe('boa'), 60); } }} />
          Bipe por repetição</label>
      </div>

      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn accent" onClick=${adicionar}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      ${estado && html`<p class="hint tight" style=${{ color: no && no.enabled ? 'var(--ink-2)' : 'var(--warn)' }}>${estado}</p>`}
      ${recente && snap.taxa != null && snap.taxa < TAXA_MIN_HZ && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>
        ⚠ Amostragem baixa: ${f1(snap.taxa)} poses/s (mínimo ${TAXA_MIN_HZ}). Repetições rápidas podem não contar — feche outros
        programas ou use um aparelho mais rápido.</p>`}
      ${recente && exId && !manual && html`<p class="hint tight">Reconhecido: <b>${ex.nome}</b>${snap.motivo ? ` — ${snap.motivo}` : ''}.
        Troca sozinho quando a série fecha; se errar, escolha o exercício acima.</p>`}

      <div style=${css.placar}>
        <div style=${css.cel}>
          <b style=${{ ...css.grande, color: progresso >= 1 ? COR.ok : 'var(--ink)' }}>${prancha ? (isom ? mmss(isom.dur) : '0:00') : repsSerie}</b>
          <em style=${css.rot}>${prancha ? `de ${mmss(metaN)}` : `de ${metaN} reps`}</em></div>
        <div style=${css.cel}><b style=${{ ...css.grande, color: COR.ok }}>${mostrada ? mostrada.boas || 0 : 0}</b><em style=${css.rot}>boas</em></div>
        <div style=${css.cel}><b style=${{ ...css.grande, color: COR.alerta }}>${mostrada ? mostrada.alerta || 0 : 0}</b><em style=${css.rot}>com alerta</em></div>
        <div style=${css.cel}><b style=${css.grande}>${aberta ? aberta.n : treino.series.length}<span style=${{ fontSize: '13px', color: 'var(--ink-3)' }}>/${cfg.metaSeries}</span></b><em style=${css.rot}>${aberta ? 'série' : 'séries feitas'}</em></div>
      </div>
      <div style=${css.barra}><div style=${{ width: `${Math.min(100, progresso * 100)}%`, height: '100%', background: progresso >= 1 ? COR.ok : COR.info }}></div></div>
      <p class="hint tight" style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <span>${fase ? html`Fase: <b>${fase}</b>` : ''}${recente && snap.v != null && ex ? html` · ${ex.art} <b>${f0(snap.v)}°</b>` : ''}${recente && snap.vista ? ` · vista ${snap.vista === 'obliqua' ? 'oblíqua' : snap.vista}` : ''}</span>
        ${prancha && isom ? html`<span>alinhado <b>${Math.round(isom.alinhado * 100)}%</b></span>` : ''}
      </p>
      ${descanso != null && descanso > (cfg.pausaSerieS - 0.5) && html`
        <div style=${css.fb(treino.series.length >= cfg.metaSeries ? COR.ok : descanso > cfg.descansoS ? '#FFD84D' : COR.info)}>
          ${treino.series.length >= cfg.metaSeries
            ? html`<b>Treino concluído: ${treino.series.length} séries.</b>`
            : descanso <= cfg.descansoS
              ? html`<b>Descanso ${mmss(cfg.descansoS - descanso)}</b> <span class="hint">· série ${treino.series.length} de ${cfg.metaSeries} feita</span>
                  <div style=${css.barra}><div style=${{ width: `${Math.min(100, (descanso / Math.max(1, cfg.descansoS)) * 100)}%`, height: '100%', background: COR.info }}></div></div>`
              : html`<b>Hora da série ${treino.series.length + 1}</b> <span class="hint">· descanso passou ${mmss(descanso - cfg.descansoS)}</span>`}
        </div>`}

      ${fb && html`
        <div style=${css.fb(fb.cor)}>
          <b style=${{ color: fb.cor, fontSize: '12.5px' }}>${fb.cor === COR.ok ? '✓ ' : '⚠ '}${fb.titulo}</b>
          ${fb.itens.map((t, i) => html`<div key=${i} style=${{ fontSize: '11.5px', lineHeight: 1.45, marginTop: '3px' }}>${t}</div>`)}
          ${ultima && ultima.ex !== 'prancha' && fb.titulo.startsWith('Repetição') && html`<div class="hint" style=${{ margin: '4px 0 0' }}>
            amplitude ${f0(ultima.vMin)}°–${f0(ultima.vMax)}°${ultima.exc != null ? ` · excêntrico ${f1(ultima.exc)} s · concêntrico ${f1(ultima.con)} s` : ` · ${f1(ultima.dur)} s`}${ultima.prof != null ? ` · quadril ${ultima.prof >= 0 ? 'abaixo' : 'acima'} do joelho` : ''}</div>`}
        </div>`}

      <div class="cfg-sub" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Repetições (${treino.reps.length})</span>
        ${treino.reps.length > 25 && html`<button class="btn tiny" style=${{ padding: '1px 7px' }} onClick=${() => setVerTodas(!verTodas)}>${verTodas ? 'últimas 25' : 'todas'}</button>`}
      </div>
      ${treino.reps.length === 0
        ? html`<p class="hint tight">Nenhuma repetição ainda.</p>`
        : html`<div style=${css.lista}><table style=${css.tab}>
            <thead><tr><th style=${css.th}>#</th><th style=${css.th}>Série</th><th style=${{ ...css.th, textAlign: 'right' }}>Amplitude</th>
              <th style=${{ ...css.th, textAlign: 'right' }}>Exc./conc.</th><th style=${css.th}>Qualidade</th></tr></thead>
            <tbody>${reps.map((r) => html`
              <tr key=${r.n} title=${r.alertas.map((a) => a.msg).join('\n') || 'Boa'}>
                <td style=${css.num}>${r.n}</td>
                <td style=${css.td}>${r.serie}.${r.nSerie}${r.ex !== exId ? html`<br /><span style=${{ color: 'var(--ink-3)', fontSize: '9.5px' }}>${EXERCICIOS[r.ex].nome}</span>` : ''}</td>
                <td style=${css.num}>${r.vMin != null ? `${f0(r.vMin)}–${f0(r.vMax)}°` : mmss(r.dur)}</td>
                <td style=${css.num}>${r.exc != null ? `${f1(r.exc)}/${f1(r.con)} s` : `${f1(r.dur)} s`}</td>
                <td style=${{ ...css.td, color: r.boa ? COR.ok : COR.alerta }}>${r.boa ? '✓ boa' : `⚠ ${r.alertas.map((a) => a.curta.toLowerCase()).join(', ')}`}</td>
              </tr>`)}</tbody></table></div>`}

      <div class="cfg-sub">Resumo do treino</div>
      <div class="kpis">
        <div class="kpi"><b>${res.reps}</b><em>repetições</em></div>
        <div class="kpi"><b>${res.qualidade == null ? '—' : Math.round(res.qualidade * 100) + '%'}</b><em>boas</em></div>
        <div class="kpi"><b>${res.series}</b><em>séries</em></div>
        <div class="kpi"><b>${mmss(res.tut)}</b><em>sob tensão</em></div>
      </div>
      ${res.porExercicio.map((o) => html`
        <p key=${o.ex} class="hint tight" style=${{ margin: '0 0 6px' }}>
          <b>${o.nome}</b>: ${o.series} série${o.series === 1 ? '' : 's'} · ${o.reps} ${o.ex === 'prancha' ? 'sustentações' : 'reps'}
          (<span style=${{ color: COR.ok }}>${o.boas} boas</span>, <span style=${{ color: COR.alerta }}>${o.alerta} com alerta</span>)
          ${o.amplMed != null ? ` · amplitude média ${f0(o.amplMed)}°` : ''}${o.excMed != null ? ` · exc. ${f1(o.excMed)} s / conc. ${f1(o.conMed)} s` : ''}
          ${o.alertas.length ? html`<br />Mais comum: ${o.alertas.slice(0, 2).map((a) => `${a.curta.toLowerCase()} (${a.n}×)`).join(', ')}` : ''}
        </p>`)}
      ${treino.series.length > 0 && html`<p class="hint tight">Séries: ${treino.series.map((s) =>
        `${s.n}) ${s.isometrica ? mmss(s.dur || s.tut) : s.reps.length + ' reps'}${s.ritmo ? ` · ${f1(s.ritmo)}/min` : ''}${s.descansoAntes != null ? ` · descanso antes ${mmss(s.descansoAntes)}` : ''}`).join(' — ')}</p>`}

      <div class="cfg-sub">Treino</div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => { zerarTreino(); setSnap(instantaneo()); }}>Novo treino</button>
        <button class="btn" onClick=${() => definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
        <button class="btn" disabled=${!aberta} onClick=${() => fecharSerieAgora()}>Fechar série</button>
      </div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!treino.reps.length}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!treino.reps.length}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!treino.reps.length}>Relatório / PDF</button>
      </div>
      <p class="hint tight">${treino.reps.length} repetições gravadas${treino.curtas ? ` · ${treino.curtas} movimentos curtos ignorados` : ''}${treino.descartes ? ` · ${treino.descartes} descartadas (imagem parada)` : ''}${gravando ? '' : ' · pausado'}.</p>

      <details style=${{ marginTop: '6px' }}>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Como filmar</summary>
        <ul class="hint" style=${{ paddingLeft: '18px', marginTop: '6px' }}>
          <li>Corpo inteiro no quadro, da cabeça aos pés, com folga; câmera firme, na altura do quadril, a 2–4 m.</li>
          <li><b>De lado</b> para tronco, profundidade, joelho × ponta do pé, quadril na flexão/prancha e costas no terra.</li>
          <li><b>De frente</b> para valgo (joelhos para dentro), assimetria e polichinelo.</li>
          <li>Roupa que contraste com o fundo, boa luz, sem contraluz; só uma pessoa em destaque.</li>
          <li>No automático, faça 2–3 repetições para o exercício ser reconhecido (elas entram na contagem).</li>
        </ul>
      </details>
      <details>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Regras de cada exercício</summary>
        <div class="hint" style=${{ marginTop: '6px' }}>
          ${Object.entries(REGRAS).map(([k, t]) => html`<p key=${k} style=${{ margin: '0 0 6px' }}><b>${EXERCICIOS[k].nome}:</b> ${t}</p>`)}
          <p style=${{ margin: 0 }}>Repetição = repouso → trabalho → repouso da articulação principal (≥ 20–60° conforme o exercício;
            menos que isso é "movimento curto" e não conta). Tempos medidos entre 20% e 100% do caminho. Tolerância
            rigorosa/tolerante aperta/afrouxa os limites em ~12–15%. Pose 2D estimada, sem marcadores: alertas de treino, não diagnóstico.</p>
        </div>
      </details>
    <//>
  `;
}
