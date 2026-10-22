/**
 * components/esportes/ErgonomiaPanel.js — "Ergonomia": avaliação RULA/REBA.
 *
 * O operador ergonomia.avaliar (CV-29) mede; este painel mostra e conduz:
 * método, parâmetros da tarefa (carga, pega, atividade, ajustes — gravados
 * nos parâmetros do nó do Pipeline), a pessoa selecionada com a tabela por
 * segmento, o tempo em cada nível, a linha do tempo, a postura mais crítica
 * congelada, as recomendações, os alertas e a exportação (CSV, JSON e
 * relatório para imprimir/PDF).
 *
 * O executor não expõe o ctx do quadro; o operador publica num canal
 * (runtime/livres-f/canal.js), que este painel assina — no máximo 4×/s.
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import {
  FAIXAS, NIVEIS, nivel, corDe, corSegmento, recomendacoes, num, NOMES_SEG,
  TEXTO_CARGA_RULA, TEXTO_CARGA_REBA, TEXTO_PEGA, TEXTO_PUNHO_SEM_MAOS,
} from '../../cv/runtime/livres-f/ergonomia.js';
import {
  assinar, instantaneo, obterSessao, zerarSessao, definirGravando, estaGravando,
} from '../../cv/runtime/livres-f/canal.js';
import { dadosSessao, csvSessao, htmlRelatorio, AVISO } from '../../cv/runtime/livres-f/relatorio.js';

const OP = 'ergonomia.avaliar';
const PREFS = 'aiv.ergonomia.prefs';
const lerPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (_) { return {}; } };
const gravarPrefs = (v) => { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado */ } };

const fg = (x) => (x == null || !Number.isFinite(x) ? '—' : `${num(x, 0)}°`);
const css = {
  tab: { width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
  th: { textAlign: 'left', fontWeight: 500, color: 'var(--ink-3)', fontSize: '9.5px', padding: '3px 3px', borderBottom: '1px solid var(--line-2)' },
  td: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)' },
  num: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' },
  dot: (c) => ({ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: c, verticalAlign: 'middle', flex: 'none' }),
  sel: { width: '100%', padding: '6px 7px', borderRadius: '7px', border: '1px solid var(--line)', background: 'rgba(0,0,0,.25)', color: 'var(--ink)', font: 'inherit', fontSize: '12px' },
  grade: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '6px 8px', marginBottom: '8px' },
  chk: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11.5px', color: 'var(--ink-2)', cursor: 'pointer' },
  rec: { display: 'flex', gap: '7px', alignItems: 'flex-start', fontSize: '11.5px', lineHeight: 1.5, margin: '0 0 7px' },
  chip: (on, cor) => ({ display: 'inline-flex', gap: '5px', alignItems: 'center', padding: '3px 8px', borderRadius: '999px', fontSize: '11px', cursor: 'pointer',
    border: `1px solid ${on ? cor : 'var(--line)'}`, background: on ? 'rgba(255,255,255,.08)' : 'transparent', color: 'var(--ink)', font: 'inherit' }),
  barra: { display: 'flex', height: '12px', borderRadius: '4px', overflow: 'hidden', background: 'rgba(127,127,127,.2)', margin: '4px 0 4px' },
};

function baixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

/** Esqueleto da postura congelada sobre a miniatura (cores do pior momento). */
function Congelada({ pico, M }) {
  if (!pico) {
    return html`<div style=${{ border: '1px dashed var(--line)', borderRadius: '8px', aspectRatio: '1', display: 'grid', placeItems: 'center',
      fontSize: '11px', color: 'var(--ink-3)', textAlign: 'center', padding: '6px' }}>aguardando avaliação</div>`;
  }
  const av = pico.aval, k = M === 'REBA' ? 'reba' : 'rula';
  let linhas = null;
  if (pico.pose && av && av.ok) {
    const { T, pts } = pico.pose;
    const lado = av.porLado;
    // índices do MODELO; o lado anatômico (com espelho) já está resolvido na avaliação, então colore pelo pior dos dois
    const segL = (s, l) => (lado[l] ? lado[l][k].seg[s] : null);
    const pior = (s) => Math.max(segL(s, 'e') || 1, segL(s, 'd') || 1);
    const L = [[5, 7, 'braco'], [7, 9, 'antebraco'], [6, 8, 'braco'], [8, 10, 'antebraco'],
      [11, 13, 'pernas'], [13, 15, 'pernas'], [12, 14, 'pernas'], [14, 16, 'pernas'], [5, 6, null], [11, 12, null]];
    const ok = (i) => pts[i] && pts[i].v >= 0.3;
    linhas = L.filter(([a, b]) => ok(a) && ok(b)).map(([a, b, s], i) => html`<line key=${i} x1=${pts[a].x} y1=${pts[a].y} x2=${pts[b].x} y2=${pts[b].y}
      stroke=${s ? corSegmento(M, s, s === 'pernas' ? av[k].seg.pernas : pior(s)) : '#cbd5e1'} stroke-width="3" stroke-linecap="round" />`);
    if (ok(5) && ok(6) && ok(11) && ok(12)) {
      const o = { x: (pts[5].x + pts[6].x) / 2, y: (pts[5].y + pts[6].y) / 2 }, q = { x: (pts[11].x + pts[12].x) / 2, y: (pts[11].y + pts[12].y) / 2 };
      linhas.push(html`<line key="t" x1=${q.x} y1=${q.y} x2=${o.x} y2=${o.y} stroke=${corSegmento(M, 'tronco', av[k].seg.tronco)} stroke-width="4" stroke-linecap="round" />`);
      const or = [3, 4].filter(ok).sort((a, b) => pts[b].v - pts[a].v)[0];
      if (or != null) linhas.push(html`<line key="p" x1=${o.x} y1=${o.y} x2=${pts[or].x} y2=${pts[or].y} stroke=${corSegmento(M, 'pescoco', av[k].seg.pescoco)} stroke-width="3" stroke-linecap="round" />`);
    }
    linhas = html`<svg viewBox="0 0 ${T} ${T}" style=${{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>${linhas}</svg>`;
  }
  return html`
    <div style=${{ position: 'relative', borderRadius: '8px', overflow: 'hidden', aspectRatio: '1', background: '#000' }}>
      ${pico.thumb && html`<img src=${pico.thumb} alt="postura mais crítica" style=${{ width: '100%', height: '100%', display: 'block' }} />`}
      ${linhas}
      <span style=${{ position: 'absolute', left: '5px', top: '5px', fontSize: '11px', fontWeight: 700, background: corDe(M, pico.nota), color: '#111', padding: '1px 7px', borderRadius: '5px' }}>
        ${M} ${pico.nota}</span>
    </div>`;
}

/** Linha do tempo (últimos ~5 min) da nota no método, com o limite de alerta. */
function Linha({ serie, M, limFaixa }) {
  const s = (serie || []).slice(-300);
  if (s.length < 2) return html`<p class="hint tight">A linha do tempo aparece depois de alguns segundos de avaliação.</p>`;
  const k = M === 'REBA' ? 'reba' : 'rula', max = M === 'REBA' ? 15 : 7;
  const W = 300, H = 64, t0 = s[0].t, t1 = s[s.length - 1].t;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W, y = (v) => H - (v / max) * (H - 6) - 3;
  const lim = NIVEIS[M].find((n) => n.faixa >= limFaixa);
  const pts = s.map((p) => `${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join(' ');
  return html`
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style=${{ width: '100%', height: '64px', display: 'block', background: 'rgba(0,0,0,.18)', borderRadius: '6px' }}>
      ${lim && html`<line x1="0" x2=${W} y1=${y(lim.de - 0.5)} y2=${y(lim.de - 0.5)} stroke=${FAIXAS[4].cor} stroke-dasharray="4 4" stroke-width="1" />`}
      <polyline points=${pts} fill="none" stroke="var(--accent, #22d3ee)" stroke-width="1.8" vector-effect="non-scaling-stroke" />
    </svg>
    <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '9.5px', color: 'var(--ink-3)', marginTop: '2px' }}>
      <span>−${num((t1 - t0) / 1000, 0)} s</span><span>tracejado: alerta (${lim ? lim.nome.toLowerCase() : '—'})</span><span>agora</span>
    </div>`;
}

export function ErgonomiaPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(OP), ...lerPrefs() }));
  const cfg = no ? { ...defaultParams(OP), ...no.params } : prefs;
  const M = cfg.metodo === 'REBA' ? 'REBA' : 'RULA';
  const k = M === 'REBA' ? 'reba' : 'rula';

  const [snap, setSnap] = useState(() => instantaneo());
  const [, setTick] = useState(0);
  useEffect(() => assinar((s) => { setSnap(s); setTick((t) => t + 1); }), []);
  const [aviso, setAviso] = useState('');
  const [escolhido, setEscolhido] = useState(null);

  const sessao = obterSessao();
  const recente = Boolean(snap && performance.now() - snap.t < 3000);
  const vivos = recente ? snap.pessoas : [];
  const ids = sessao.ids();
  // pessoa mostrada: a escolhida; senão a de pior nota agora; senão a última vista
  const piorAgora = vivos.filter((p) => p.av.ok).sort((a, b) => b.nota - a.nota)[0];
  const id = (escolhido && ids.includes(escolhido)) ? escolhido : piorAgora ? piorAgora.id : ids[ids.length - 1] || null;
  const vivo = vivos.find((p) => p.id === id);
  const pessoa = id ? sessao.pessoas.get(id) : null;
  const res = id ? sessao.resumo(id, M) : null;
  const avAgora = vivo && vivo.av.ok ? vivo.av : null;
  const av = avAgora || (pessoa && pessoa.ultimaAval) || null;
  const pico = res && res.pico;
  const recs = pico ? recomendacoes(pico.aval, cfg) : av ? recomendacoes(av, cfg) : [];
  const gravando = estaGravando();

  function definir(chave, v) {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    const np = { ...prefs, [chave]: v };
    setPrefs(np); gravarPrefs(np);
    if (i >= 0) {
      store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, params: { ...n.params, [chave]: v } } : n)) });
      persist();
    }
  }

  function adicionar() {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    let novos;
    if (i >= 0) novos = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
    else novos = [...ns, { id: newNodeId(), op: OP, params: { ...defaultParams(OP), ...prefs }, enabled: true }];
    store.set({ nodes: novos, panels: { ...store.get().panels, pipeline: true } });
    persist();
    setAviso(i >= 0 ? 'Ergonomia ligada no Pipeline.' : 'Ergonomia adicionada ao Pipeline.');
    setTimeout(() => setAviso(''), 3500);
  }

  const exportar = (tipo) => {
    const d = dadosSessao(sessao, cfg);
    if (tipo === 'csv') baixar(`ergonomia-${carimbo()}.csv`, '﻿' + csvSessao(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`ergonomia-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else {
      const h = htmlRelatorio(d);
      const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
      const w = window.open(url, '_blank');
      if (!w) baixar(`ergonomia-relatorio-${carimbo()}.html`, h, 'text/html;charset=utf-8');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  const sel = (chave, opcoes, rotulo, titulo) => html`
    <label title=${titulo || ''}><span class="ctl-label">${rotulo}</span>
      <select style=${css.sel} value=${String(cfg[chave])}
              onChange=${(e) => definir(chave, typeof defaultParams(OP)[chave] === 'number' ? Number(e.target.value) : e.target.value)}>
        ${opcoes.map(([v, t]) => html`<option key=${v} value=${String(v)}>${t}</option>`)}
      </select></label>`;
  const chk = (chave, rotulo, titulo) => html`
    <label style=${css.chk} title=${titulo || ''}>
      <input type="checkbox" checked=${Boolean(cfg[chave])} onChange=${(e) => definir(chave, e.target.checked)} />${rotulo}</label>`;

  // ---- tabela por segmento
  const angSeg = (s) => {
    if (!av) return '—';
    const g = av.ang || {};
    if (s === 'pernas') return g.joelho == null ? (av.sentado ? 'sentado' : '—') : `joelho ${fg(g.joelho)}${av.sentado ? ' · sentado' : ''}`;
    if (s === 'punho') return g.punho == null ? `sem mãos: ${TEXTO_PUNHO_SEM_MAOS[cfg.punhoSemMaos]}` : `${fg(g.punho)}${g.punhoDesvio != null ? ` · desvio ${fg(Math.abs(g.punhoDesvio))}` : ''}`;
    if (s === 'torcao') return cfg.punhoTorcao >= 2 ? 'fim do curso' : 'meio do curso';
    if (s === 'braco') return `${fg(g.braco)}${g.abducao != null ? ` · abd. ${fg(g.abducao)}` : ''}`;
    if (s === 'tronco') return `${fg(g.tronco)}${g.troncoLat != null ? ` · lat. ${fg(g.troncoLat)}` : ''}`;
    if (s === 'pescoco') return `${fg(g.pescoco)}${g.pescocoLat != null ? ` · lat. ${fg(g.pescocoLat)}` : ''}`;
    return fg(g[s]);
  };
  const ordem = M === 'RULA' ? ['braco', 'antebraco', 'punho', 'torcao', 'pescoco', 'tronco', 'pernas'] : ['tronco', 'pescoco', 'pernas', 'braco', 'antebraco', 'punho'];
  const linhas = av && av.ok ? ordem.map((s) => {
    const e = av[k].seg[s];
    return html`<tr key=${s}>
      <td style=${css.td}>${NOMES_SEG[s]}${av.assumidos.includes(s) ? html` <em style=${{ color: 'var(--ink-3)' }}>(assumido)</em>` : ''}</td>
      <td style=${{ ...css.td, color: 'var(--ink-2)', fontSize: '10.5px' }}>${angSeg(s)}</td>
      <td style=${css.num}><b>${e}</b></td>
      <td style=${{ ...css.td, textAlign: 'center' }}><span style=${css.dot(s === 'torcao' ? (e > 1 ? FAIXAS[3].cor : FAIXAS[1].cor) : corSegmento(M, s, e))}></span></td>
    </tr>`;
  }) : null;
  const cadeia = av && av.ok ? (M === 'RULA'
    ? `Postura A ${av.rula.postA} + músculo ${av.rula.musculo} + carga ${av.rula.carga} = ${av.rula.A} · Postura B ${av.rula.postB} + ${av.rula.musculo} + ${av.rula.carga} = ${av.rula.B} → Tabela C`
    : `Tabela A ${av.reba.tabA} + carga ${av.reba.carga + av.reba.choque} = ${av.reba.A} · Tabela B ${av.reba.tabB} + pega ${av.reba.pega} = ${av.reba.B} · Tabela C ${av.reba.C} + atividade ${av.reba.atividade}`) : '';
  const notaAgora = avAgora ? avAgora[k].final : null;
  const nvAgora = notaAgora ? nivel(M, notaAgora) : null;
  const alertasPessoa = sessao.alertas.filter((a) => a.id === id && a.metodo === M).slice(-5).reverse();
  const t0 = sessao.t0 || 0;

  return html`
    <${Panel} id="ergonomia" title="Ergonomia" subtitle=${`${M} · ${vivos.length} pessoa${vivos.length === 1 ? '' : 's'} agora`}
              onClose=${onClose} ...${layout}>
      ${!no && html`
        <p class="hint tight">A avaliação roda no operador <b>Ergonomia (RULA/REBA)</b> do Pipeline, sobre a pose RTMO —
          tudo no seu aparelho, nada é enviado. Ajuste a tarefa e adicione:</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Ergonomia está desligado no Pipeline.</p>`}

      <div class="tabs">
        <button class=${M === 'RULA' ? 'on' : ''} onClick=${() => definir('metodo', 'RULA')} title="Membros superiores (McAtamney & Corlett, 1993)">RULA</button>
        <button class=${M === 'REBA' ? 'on' : ''} onClick=${() => definir('metodo', 'REBA')} title="Corpo inteiro (Hignett & McAtamney, 2000)">REBA</button>
      </div>
      <details open=${!no} style=${{ margin: '6px 0 4px' }}>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)', margin: '4px 0 8px' }}>Parâmetros da tarefa · carga, pega, ajustes, alerta</summary>
        <div style=${css.grade}>
          ${M === 'RULA'
            ? [sel('cargaRula', TEXTO_CARGA_RULA.map((t, i) => [i, `${i} · ${t}`]), 'Carga / força'),
               sel('punhoTorcao', [[1, '1 · meio do curso'], [2, '2 · fim do curso']], 'Torção do punho')]
            : [sel('cargaReba', TEXTO_CARGA_REBA.map((t, i) => [i, `${i} · ${t}`]), 'Carga'),
               sel('pega', TEXTO_PEGA.map((t, i) => [i, `${i} · ${t}`]), 'Pega')]}
          ${sel('lado', [['pior lado', 'pior lado'], ['esquerdo', 'esquerdo'], ['direito', 'direito']], 'Lado')}
          ${sel('punhoSemMaos', [[1, 'neutro'], [2, 'até 15°'], [3, 'mais de 15°']], 'Punho sem mãos', 'Valor do punho quando as mãos não são detectadas (adicione "Mãos e gestos" antes, ou Mãos: rodar aqui)')}
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '4px 8px', marginBottom: '8px' }}>
          ${M === 'RULA'
            ? chk('musculoRula', 'Uso muscular', 'Postura estática por mais de 1 min ou ação repetida mais de 4×/min')
            : [chk('choque', 'Choque / força brusca'), chk('estatica', 'Parte parada >1 min'), chk('repetitiva', 'Repetição >4×/min'), chk('instavel', 'Base instável')]}
          ${chk('estaticaAuto', 'Detectar estática', 'Conta postura estática quando braço, tronco e pescoço ficam parados (±15°) por 1 min')}
          ${chk('ombroElevado', 'Ombro elevado')}
          ${chk('bracoApoiado', 'Braço apoiado')}
          ${chk('troncoTorcido', 'Tronco torcido')}
          ${chk('pescocoTorcido', 'Pescoço torcido')}
        </div>
        <div style=${css.grade}>
          ${sel('vista', [['automática', 'automática'], ['lateral', 'lateral'], ['frontal', 'frontal']], 'Vista')}
          ${sel('sentado', [['automático', 'automático'], ['sim', 'sim'], ['não', 'não']], 'Sentado')}
          ${sel('maos', [['da cadeia', 'da cadeia'], ['rodar aqui', 'rodar aqui'], ['não usar', 'não usar']], 'Mãos (punho)')}
          ${sel('alertaFaixa', [[2, 'médio ou mais'], [3, 'alto ou mais'], [4, 'muito alto']], 'Alertar a partir de')}
          <label><span class="ctl-label">Por (segundos)</span>
            <input class="txt" type="number" min="1" max="300" inputmode="numeric" style=${{ width: '100%' }}
                   value=${cfg.alertaSeg} onChange=${(e) => definir('alertaSeg', Math.max(1, Math.min(300, Number(e.target.value) || 10)))} /></label>
        </div>
      </details>

      <div class="row tight" style=${{ gap: '6px' }}>
        <button class="btn accent" onClick=${adicionar}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}

      ${ids.length > 0 && html`
        <div style=${{ display: 'flex', gap: '5px', flexWrap: 'wrap', margin: '10px 0 8px' }}>
          ${ids.slice(-12).map((pid) => {
            const v = vivos.find((p) => p.id === pid);
            const n = v && v.av.ok ? v.nota : null;
            const cor = n ? corDe(M, n) : 'var(--ink-3)';
            return html`<button key=${pid} style=${css.chip(pid === id, cor)} onClick=${() => setEscolhido(pid)} title=${v ? 'na imagem agora' : 'fora da imagem'}>
              <span style=${css.dot(cor)}></span>${pid}${n ? ` · ${n}` : ''}</button>`;
          })}
        </div>`}

      <div class="kpis" style=${{ marginTop: ids.length ? 0 : '10px' }}>
        <div class="kpi"><b style=${{ color: notaAgora ? corDe(M, notaAgora) : undefined }}>${notaAgora || '—'}</b><em>${M} agora</em></div>
        <div class="kpi"><b style=${{ color: pico ? corDe(M, pico.nota) : undefined }}>${pico ? pico.nota : '—'}</b><em>pico</em></div>
        <div class="kpi"><b>${res && res.media != null ? num(res.media, 1) : '—'}</b><em>média</em></div>
        <div class="kpi"><b class=${res && res.alertas ? 'warn' : ''}>${res ? res.alertas : 0}</b><em>alertas</em></div>
      </div>
      ${nvAgora && html`<p class="hint tight" style=${{ margin: '-4px 0 8px' }}>
        <span style=${css.dot(corDe(M, notaAgora))}></span> <b>${nvAgora.nome}</b> — ${nvAgora.acao}
        ${avAgora.lado && html` Lado ${avAgora.lado === 'e' ? 'esquerdo' : 'direito'}.`}</p>`}
      ${res && res.alertaAtivo && html`<p class="hint tight" style=${{ color: 'var(--err)' }}>⚠ ${id} está acima do limite há mais de ${cfg.alertaSeg} s.</p>`}

      ${vivo && vivo.avisos && vivo.avisos.length > 0 && html`
        <div style=${{ margin: '0 0 8px' }}>
          ${vivo.avisos.map((a, i) => html`<p key=${i} class="hint tight" style=${{ color: 'var(--warn)', margin: '0 0 4px' }}>⚠ ${a}</p>`)}
        </div>`}
      ${!recente && no && no.enabled && html`<p class="hint tight">Aguardando pessoas na imagem (ligue a câmera ou abra um vídeo em <b>Fonte</b>).
        Filme de lado (90°), com o corpo inteiro no quadro.</p>`}

      <div class="cfg-sub">Segmentos ${avAgora ? '(agora)' : av ? '(última avaliação)' : ''}</div>
      ${linhas ? html`
        <table style=${css.tab}>
          <thead><tr><th style=${css.th}>Segmento</th><th style=${css.th}>Ângulo</th><th style=${{ ...css.th, textAlign: 'right' }}>Escore</th><th style=${css.th}></th></tr></thead>
          <tbody>${linhas}</tbody>
        </table>
        <p class="hint tight" style=${{ fontFamily: 'var(--mono)', fontSize: '10px' }}>${cadeia} = <b>${av[k].final}</b></p>`
        : html`<p class="hint tight">Nenhuma pessoa avaliada ainda.</p>`}

      <div class="cfg-sub">Tempo em cada nível${res ? ` · ${num(res.tempo, 0)} s` : ''}</div>
      ${res && res.tempo > 0 ? html`
        <div style=${css.barra}>
          ${res.pct.map((p, i) => (p > 0 ? html`<span key=${i} title=${`${FAIXAS[i].nome}: ${num(p, 1)}%`} style=${{ width: p + '%', background: FAIXAS[i].cor }}></span>` : null))}
        </div>
        <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: '10.5px', color: 'var(--ink-2)', marginBottom: '8px' }}>
          ${NIVEIS[M].map((n) => html`<span key=${n.faixa}><span style=${css.dot(FAIXAS[n.faixa].cor)}></span> ${n.nome} ${num(res.pct[n.faixa], 0)}%</span>`)}
        </div>
        <${Linha} serie=${pessoa && pessoa.serie} M=${M} limFaixa=${cfg.alertaFaixa} />`
        : html`<p class="hint tight">—</p>`}

      <div class="cfg-sub">Postura mais crítica</div>
      <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 150px) 1fr', gap: '10px', alignItems: 'start' }}>
        <${Congelada} pico=${pico} M=${M} />
        <div style=${{ fontSize: '11px', color: 'var(--ink-2)', lineHeight: 1.6 }}>
          ${pico ? html`
            <div><b>${M} ${pico.nota}</b> · ${nivel(M, pico.nota).nome.toLowerCase()}</div>
            <div>em ${num((pico.t - t0) / 1000, 0)} s da sessão</div>
            ${pico.aval && pico.aval.ok && html`<div>tronco ${fg(pico.aval.ang.tronco)} · pescoço ${fg(pico.aval.ang.pescoco)}</div>
              <div>braço ${fg(pico.aval.ang.braco)} · cotovelo ${fg(pico.aval.ang.antebraco)}</div>
              ${pico.aval.ang.punho != null && html`<div>punho ${fg(pico.aval.ang.punho)}</div>`}`}`
            : '—'}
        </div>
      </div>

      <div class="cfg-sub">Recomendações ${pico ? "(pior momento)" : ""}</div>
      ${recs.length === 0 && html`<p class="hint tight">${av ? 'Postura dentro do aceitável até agora.' : 'Aparecem depois da primeira avaliação.'}</p>`}
      ${recs.map((r, i) => html`
        <p key=${i} style=${css.rec}>
          <span style=${{ ...css.dot(FAIXAS[r.nivel].cor), marginTop: '5px' }}></span>
          <span><b>${r.seg}:</b> ${r.texto}</span>
        </p>`)}

      ${alertasPessoa.length > 0 && html`
        <div class="cfg-sub">Alertas de ${id}</div>
        ${alertasPessoa.map((a, i) => html`<p key=${i} class="hint tight" style=${{ margin: '0 0 3px' }}>
          ${num((a.inicio - t0) / 1000, 0)} s → ${a.fim ? num((a.fim - t0) / 1000, 0) + ' s' : 'em curso'} · pico ${a.metodo} ${a.pico}</p>`)}`}

      <div class="cfg-sub">Sessão</div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => { zerarSessao(); setEscolhido(null); setSnap(instantaneo()); }}>Nova sessão</button>
        <button class="btn" onClick=${() => definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
      </div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!ids.length}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!ids.length}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!ids.length}>Relatório / PDF</button>
      </div>
      <p class="hint tight">${ids.length} pessoa(s) na sessão · ${sessao.alertas.length} alerta(s)${gravando ? '' : ' · pausado'}.</p>
      <p class="hint tight" style=${{ color: 'var(--ink-3)', fontSize: '10.5px' }}>${AVISO}</p>

      <details style=${{ marginTop: '6px' }}>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Como filmar</summary>
        <ul class="hint" style=${{ paddingLeft: '18px', marginTop: '6px' }}>
          <li>Câmera de <b>lado</b> (90° do trabalhador), na altura do quadril, a 3–5 m, sem zoom digital.</li>
          <li>Corpo inteiro no quadro, da cabeça aos pés; câmera parada (tripé) e nivelada.</li>
          <li>Filme o ciclo completo da tarefa, incluindo as posturas mais exigentes.</li>
          <li>Avalie o lado que trabalha mais (ou "pior lado"); para inclinação lateral e braço afastado, faça também uma tomada frontal.</li>
          <li>Torções, ombro elevado, carga, pega e atividade não aparecem bem no vídeo: informe nos campos acima.</li>
        </ul>
      </details>
      <details>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Como a nota é calculada</summary>
        <p class="hint" style=${{ marginTop: '6px' }}>Ângulos no plano da imagem: tronco (quadril→ombro × vertical), pescoço (ombro→orelha ×
          tronco), braço (ombro→cotovelo × tronco), antebraço (flexão do cotovelo), punho (pelas mãos, se houver), joelho. Cada ângulo
          vira um escore pelas faixas do método (±5° de tolerância no neutro), somam-se os ajustes informados e as tabelas oficiais
          A, B e C dão a nota: RULA de 1 a 7 (McAtamney & Corlett, 1993), REBA de 1 a 15 (Hignett & McAtamney, 2000).
          A cor de cada segmento no vídeo é o próprio escore (verde = neutro, vermelho = topo da escala).</p>
      </details>
    <//>
  `;
}
