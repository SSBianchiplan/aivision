/**
 * components/BikeFitPanel.js — "Bike Fit": a sessão de ajuste biomecânico.
 *
 * O operador bikefit.analise (CV-28) mede; este painel mostra e conduz:
 * perfil, lado e vista (gravados nos parâmetros do nó do Pipeline), tabela de
 * ângulos com a faixa alvo, cadência, recomendações, as poses congeladas no
 * PMI/PMS e a exportação (CSV, JSON e relatório para imprimir/PDF).
 *
 * O executor não expõe o ctx do quadro; o operador publica num canal
 * (runtime/livres-e/canal.js), que este painel assina — no máximo 4×/s.
 */
import { html, useState, useEffect, Fragment } from '../vendor.js';
import { Panel } from './Panel.js';
import { useStore, store, persist } from '../state/store.js';
import { defaultParams } from '../cv/registry.js';
import { newNodeId } from '../cv/executor.js';
import {
  NOMES_PERFIS, METRICAS, FRONTAL, status, COR_STATUS, indicesLado, num, faixaTxt, textoJoelhoPMI,
} from '../cv/runtime/livres-e/bikefit.js';
import {
  assinar, instantaneo, obterSessao, zerarSessao, definirGravando, estaGravando, studioAberto,
  alvosSessao, obterAtleta, listaAtletas, trocarAtleta,
} from '../cv/runtime/livres-e/canal.js';
import { dadosSessao, csvSessao, htmlRelatorio } from '../cv/runtime/livres-e/relatorio.js';
import { AtletaBikeFit, EditorFaixa, BotaoAlvo, useAtleta } from './esportes/AtletaBikeFit.js';

const OP = 'bikefit.analise';
const PREFS = 'aiv.bikefit.prefs';
const lerPrefs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) || '{}') || {};
    // versões anteriores gravavam o espelho como booleano copiado do app: hoje o padrão é 'automático'
    if (typeof v.espelhada === 'boolean') delete v.espelhada;
    return v;
  } catch (_) { return {}; }
};
const gravarPrefs = (v) => { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado */ } };

const f0 = (x) => (x == null || !Number.isFinite(x) ? '—' : String(Math.round(x)));
const f1 = (x) => num(x, 1);
const ROT = { ok: 'na faixa', perto: 'perto', fora: 'fora', sem: '—' };

/** Rodapé das recomendações (painel e Studio Bike Fit). */
export const NOTA_RECS = 'São sugestões de partida: mude uma coisa por vez, em passos pequenos, e meça de novo.';

/**
 * Liga (ou adiciona) o nó Bike Fit no Pipeline, com as preferências do painel.
 * Usado pelo painel e pelo popover de Pipeline do Studio. Devolve true se criou.
 */
export function ativarBikeFit({ abrirPipeline = false } = {}) {
  const ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === OP);
  const novos = i >= 0
    ? ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
    : [...ns, { id: newNodeId(), op: OP, params: { ...defaultParams(OP), ...lerPrefs() }, enabled: true }];
  store.set(abrirPipeline ? { nodes: novos, panels: { ...store.get().panels, pipeline: true } } : { nodes: novos });
  persist();
  return i < 0;
}

/**
 * Linhas da tabela de ângulos, já formatadas — a mesma conta para o painel e
 * para o Studio Bike Fit (components/esportes/StudioBikeFit.js), que desenha
 * a tabela no canvas. Cada linha: { k, chave, nome, agora, media, minmax, alvo,
 * st, mudou, override, porque }. `perfil` = faixas usadas (os alvos da sessão,
 * canal.alvosSessao(...).faixas); `alvos` = o objeto inteiro, para marcar as
 * linhas personalizadas e dar o porquê.
 */
export function linhasTabelaBikeFit({ res, perfil, snap, recente, frontal, alvos = null }) {
  if (frontal) {
    return [['desvioE', 'Joelho esq. %', 'e'], ['desvioD', 'Joelho dir. %', 'd']].map(([k, nome, lado]) => {
      const s = res[k] || {};
      const agora = recente && snap && snap.frontal ? snap.frontal[lado] : null;
      return {
        k, nome, agora: recente ? f1(agora) : '—', media: s.n ? `${f1(s.media)}±${f1(s.dp)}` : '—',
        minmax: s.n ? `${f1(s.min)}/${f1(s.max)}` : '—', alvo: faixaTxt(FRONTAL.desvio), st: status(s.media, FRONTAL.desvio, 3),
      };
    });
  }
  const vivo = recente && snap && snap.ang ? snap.ang : {};
  return METRICAS.map((m) => {
    const s = res[m.k] || {};
    const faixa = perfil[m.faixa];
    const agora = m.vivo ? vivo[m.vivo] : null;   // KOPS só vale com o pé às 3 h: sem "agora"
    return {
      k: m.k, chave: m.faixa, nome: m.nome, agora: recente ? f0(agora) : '—',
      media: s.n ? `${m.un === '%' ? f1(s.media) : f0(s.media)}±${f1(s.dp)}` : '—',
      minmax: s.n ? `${f0(s.min)}/${f0(s.max)}` : '—', alvo: faixaTxt(faixa), st: status(s.media, faixa, m.un === '%' ? 2 : 5),
      ...(alvos && alvos.linhas[m.faixa] ? { mudou: alvos.linhas[m.faixa].mudou, override: alvos.linhas[m.faixa].override, porque: alvos.linhas[m.faixa].porque } : {}),
    };
  });
}

/** Rodapé da vista frontal: assimetria entre os joelhos e a pelve agora. */
export function notaFrontalBikeFit(res, snap, recente) {
  const assim = res.desvioE && res.desvioD && res.desvioE.n && res.desvioD.n ? Math.abs(res.desvioE.media - res.desvioD.media) : null;
  const pelve = recente && snap && snap.frontal ? snap.frontal.pelve : null;
  return { assim, pelve, texto: `Assimetria ${assim == null ? '—' : f1(assim) + ' p.p.'} (até ${FRONTAL.assimetria}) · pelve agora ${pelve == null ? '—' : f1(Math.abs(pelve)) + '°'}` };
}

const css = {
  tab: { width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
  th: { textAlign: 'left', fontWeight: 500, color: 'var(--ink-3)', fontSize: '9.5px', padding: '3px 3px', borderBottom: '1px solid var(--line-2)' },
  td: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', whiteSpace: 'nowrap' },
  num: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' },
  dot: (c) => ({ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: c, verticalAlign: 'middle' }),
  sel: { width: '100%', padding: '6px 7px', borderRadius: '7px', border: '1px solid var(--line)', background: 'rgba(0,0,0,.25)', color: 'var(--ink)', font: 'inherit', fontSize: '12px' },
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px', marginBottom: '8px' },
  rec: { display: 'flex', gap: '7px', alignItems: 'flex-start', fontSize: '11.5px', lineHeight: 1.5, margin: '0 0 7px' },
  cong: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' },
};

function baixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

/** Ponto do quadro → coordenada na miniatura (quadrado alinhado ao quadro, ver o operador). */
function naMiniatura(caixa, f, T) {
  const k = T / caixa.s;
  return { x: (f.x - caixa.x0) * k, y: (f.y - caixa.y0) * k };
}

function Congelada({ c, rotulo }) {
  const T = 160;
  if (!c) {
    return html`<div style=${{ border: '1px dashed var(--line)', borderRadius: '8px', aspectRatio: '1', display: 'grid', placeItems: 'center', fontSize: '11px', color: 'var(--ink-3)', textAlign: 'center', padding: '6px' }}>
      ${rotulo}<br />aguardando pedalada</div>`;
  }
  const am = c.amostra || {};
  const pose = am.pose;
  let linhas = null;
  if (pose && pose.P && pose.caixa) {
    const I = am.ladoIdx ? am.ladoIdx : indicesLado('e');
    const q = (k) => naMiniatura(pose.caixa, pose.P[I[k]], T);
    const seg = [['ombro', 'quadril'], ['quadril', 'joelho'], ['joelho', 'tornozelo'], ['tornozelo', 'pe'], ['ombro', 'cotovelo'], ['cotovelo', 'punho']];
    linhas = seg.map(([a, b], i) => { const A = q(a), B = q(b); return html`<line key=${i} x1=${A.x} y1=${A.y} x2=${B.x} y2=${B.y} stroke="#FFD84D" stroke-width="2" stroke-linecap="round" />`; });
  }
  const g = am.ang || {};
  return html`
    <figure style=${{ margin: 0 }}>
      <div style=${{ position: 'relative', borderRadius: '8px', overflow: 'hidden', aspectRatio: '1', background: '#000' }}>
        ${c.thumb && html`<img src=${c.thumb} alt=${rotulo} style=${{ width: '100%', height: '100%', display: 'block' }} />`}
        ${linhas && html`<svg viewBox="0 0 ${T} ${T}" style=${{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>${linhas}</svg>`}
        <span style=${{ position: 'absolute', left: '5px', top: '5px', fontSize: '10px', fontWeight: 700, background: 'var(--bf-etq-foto, rgba(2,48,44,.8))', color: '#fff', padding: '1px 6px', borderRadius: '5px' }}>${rotulo}</span>
      </div>
      <figcaption style=${{ fontSize: '10.5px', color: 'var(--ink-2)', marginTop: '4px', lineHeight: 1.45 }}>
        joelho <b>${f0(g.joelho)}°</b> · quadril ${f0(g.quadril)}°<br />tornozelo ${f0(g.tornozelo)}°
      </figcaption>
    </figure>`;
}

export function BikeFitPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const espelhoApp = useStore(store, (st) => Boolean(st.mirror));
  const no = nodes.find((n) => n.op === OP);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(OP), ...lerPrefs() }));
  const cfg = no ? { ...defaultParams(OP), ...no.params } : prefs;

  const [snap, setSnap] = useState(() => instantaneo());
  const [, setTick] = useState(0);
  // com o Studio Bike Fit aberto (tela cheia por cima), o painel não se redesenha: poupa o
  // resumo da sessão e o React 4×/s num aparelho que já está apertado na inferência
  useEffect(() => assinar((s) => { if (studioAberto()) return; setSnap(s); setTick((t) => t + 1); }), []);
  const [detalhes, setDetalhes] = useState(false);
  const [aviso, setAviso] = useState('');
  const [editAlvo, setEditAlvo] = useState(null);     // chave do alvo aberto no editor da tabela
  const [verAtleta, setVerAtleta] = useState(false);
  useAtleta();

  const sessao = obterSessao();
  // alvos da sessão: modalidade + perfil do atleta + ajustes manuais (fonte única, no canal)
  const alvos = alvosSessao(cfg.perfil);
  const perfil = alvos.faixas;
  const atleta = obterAtleta();
  const frontal = cfg.vista === 'frontal';
  const res = sessao.resumo(cfg.nCiclos || 10);
  const recente = Boolean(snap && performance.now() - snap.t < 3000);
  const cad = sessao.cadencia(performance.now());
  // sem retrato recente, nada do ciclista anterior (lado, recomendações) fica na tela
  const recs = recente && snap.recs ? snap.recs : [];
  const ladoAgora = recente && !snap.sem ? snap.lado : null;
  // espelho efetivo: o do nó (automático = segue a Fonte)
  const espEfetivo = cfg.espelhada === 'sim' || cfg.espelhada === true ? true
    : cfg.espelhada === 'não' || cfg.espelhada === false ? false : espelhoApp;
  const gravando = estaGravando();

  function definir(k, v) {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    const np = { ...prefs, [k]: v };
    setPrefs(np); gravarPrefs(np);
    if (i >= 0) {
      store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, params: { ...n.params, [k]: v } } : n)) });
      persist();
    }
    if (k === 'vista') zerarSessao();
  }

  /*
   * O Viewport espelha o quadro ANTES do pipeline quando "espelhar" está
   * ligado (padrão da câmera frontal e também de arquivos). O próprio
   * operador lê isso (ctx.mirrored) com o parâmetro em 'automático' — vale
   * com o painel fechado e com o nó criado pelo preset — e desespelha o
   * recorte antes da pose. 'sim'/'não' ficam para vídeo gravado espelhado.
   */

  function adicionar() {
    const criou = ativarBikeFit({ abrirPipeline: true });
    setAviso(criou ? 'Bike Fit adicionado ao Pipeline.' : 'Bike Fit ligado no Pipeline.');
    setTimeout(() => setAviso(''), 3500);
  }

  const cfgRel = { perfil: cfg.perfil, vista: cfg.vista, lado: (snap && snap.lado) || cfg.lado, nCiclos: cfg.nCiclos, alturaCm: cfg.alturaCm, pernaCm: cfg.pernaCm };
  const exportar = (tipo) => {
    const d = dadosSessao(sessao, cfgRel);
    if (tipo === 'csv') baixar(`bikefit-${carimbo()}.csv`, '﻿' + csvSessao(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`bikefit-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else {
      const h = htmlRelatorio(d);
      const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
      const w = window.open(url, '_blank');
      if (!w) baixar(`bikefit-relatorio-${carimbo()}.html`, h, 'text/html;charset=utf-8');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  const nCols = detalhes && !frontal ? 6 : 5;
  const linha = (l) => html`
    <${Fragment} key=${l.k}>
      <tr class=${l.mudou ? 'bfa-tr-mudou' : ''}>
        <td style=${css.td}>${l.nome}</td>
        <td style=${css.num}>${l.agora}</td>
        <td style=${css.num}>${l.media}</td>
        ${detalhes && !frontal && html`<td style=${css.num}>${l.minmax}</td>`}
        <td style=${{ ...css.num, padding: '2px 0' }}>${l.chave
          ? html`<${BotaoAlvo} linha=${alvos.linhas[l.chave]} texto=${l.alvo} aberto=${editAlvo === l.chave}
              onClick=${() => setEditAlvo(editAlvo === l.chave ? null : l.chave)} />`
          : l.alvo}</td>
        <td style=${{ ...css.td, textAlign: 'center' }} title=${ROT[l.st]}><span style=${css.dot(COR_STATUS[l.st])}></span></td>
      </tr>
      ${l.chave && editAlvo === l.chave && html`<tr><td colSpan=${nCols} style=${{ padding: '4px 0 8px' }}>
        <${EditorFaixa} key=${l.chave + cfg.perfil} perfil=${cfg.perfil} chave=${l.chave} onFechar=${() => setEditAlvo(null)} />
        <p class="bfa-pq">${alvos.linhas[l.chave].porque.join(' ')}</p>
      </td></tr>`}
    <//>`;
  const linhas = linhasTabelaBikeFit({ res, perfil, snap, recente, frontal, alvos });

  const { assim, pelve } = notaFrontalBikeFit(res, snap, recente);

  return html`
    <${Panel} id="bikefit" title="Bike Fit" subtitle=${`${sessao.pedaladas} pedaladas · ${cad ? Math.round(cad) + ' rpm' : '— rpm'}`}
              onClose=${onClose} ...${layout}>
      ${!no && html`
        <p class="hint tight">A análise roda no operador <b>Bike Fit</b> do Pipeline, sobre a pose BlazePose — tudo no
          seu aparelho, nada é enviado. Ajuste o perfil e adicione:</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Bike Fit está desligado no Pipeline.</p>`}

      <div class="tabs">
        <button class=${!frontal ? 'on' : ''} onClick=${() => definir('vista', 'lateral')}>Lateral</button>
        <button class=${frontal ? 'on' : ''} onClick=${() => definir('vista', 'frontal')}>Frontal</button>
      </div>
      <div style=${css.grade}>
        <label><span class="ctl-label">Perfil</span>
          <select style=${css.sel} value=${cfg.perfil} onChange=${(e) => definir('perfil', e.target.value)}>
            ${NOMES_PERFIS.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        <label><span class="ctl-label">Lado</span>
          <select style=${css.sel} value=${cfg.lado} onChange=${(e) => definir('lado', e.target.value)}>
            ${['automático', 'esquerdo', 'direito'].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        <label title="Perfil do atleta: altura (escala em cm), flexibilidade, nível, objetivo e dores personalizam os alvos">
          <span class="ctl-label">Atleta</span>
          <select style=${css.sel} value=${atleta.id} onChange=${(e) => trocarAtleta(e.target.value)}>
            ${listaAtletas().map((x) => html`<option key=${x.id} value=${x.id}>${x.nome || 'sem nome'}</option>`)}
          </select></label>
        <label title="Automático segue o Espelhar da Fonte. Use 'sim' se o vídeo já foi gravado espelhado (ex.: câmera frontal de celular)">
          <span class="ctl-label">Imagem espelhada</span>
          <select style=${css.sel} value=${cfg.espelhada === true ? 'sim' : cfg.espelhada === false ? 'não' : cfg.espelhada}
                  onChange=${(e) => definir('espelhada', e.target.value)}>
            <option value="automático">automático (${espelhoApp ? 'sim' : 'não'})</option>
            <option value="sim">sim</option>
            <option value="não">não</option>
          </select></label>
      </div>

      ${espEfetivo && html`<div class="hint tight" style=${{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style=${{ flex: '1 1 200px' }}>Imagem espelhada: o Bike Fit desfaz o espelho antes de estimar a pose,
          e o lado (esquerdo/direito) sai corrigido.</span>
        ${espelhoApp && html`<button class="btn tiny" onClick=${() => { store.set({ mirror: false }); persist(); }}>Desligar espelho</button>`}
      </div>`}
      <div class="row tight" style=${{ gap: '6px' }}>
        <button class="btn accent" onClick=${adicionar}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn" title="Tela cheia no estilo estúdio: vídeo com os ângulos, curvas por pedalada, PNG e gravação"
          onClick=${() => store.set({ studioBikeFit: true })}>Abrir Studio</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}

      <details class="bfa-det" open=${verAtleta} onToggle=${(e) => setVerAtleta(e.currentTarget.open)}>
        <summary>Atleta e alvos personalizados${alvos.regras.length || Object.values(alvos.linhas).some((l) => l.override)
          ? html` <em class="bfa-tag">${atleta.nome} · personalizado</em>` : html` <em class="bfa-tag off">${atleta.nome}</em>`}</summary>
        ${verAtleta && html`<${AtletaBikeFit} perfil=${cfg.perfil} />`}
      </details>

      <div class="kpis" style=${{ marginTop: '10px' }}>
        <div class="kpi"><b class=${cad ? '' : 'warn'}>${cad ? Math.round(cad) : '—'}</b><em>rpm</em></div>
        <div class="kpi"><b>${sessao.pedaladas}</b><em>pedaladas</em></div>
        <div class="kpi"><b style=${{ fontSize: '13px' }}>${ladoAgora || '—'}</b><em>lado</em></div>
      </div>

      ${snap && snap.avisos && snap.avisos.length > 0 && recente && html`
        <div style=${{ margin: '0 0 8px' }}>
          ${snap.avisos.map((a, i) => html`<p key=${i} class="hint tight" style=${{ color: 'var(--err)', margin: '0 0 4px' }}>⚠ ${a}</p>`)}
        </div>`}
      ${!recente && no && no.enabled && html`<p class="hint tight">Aguardando o ciclista na imagem (ligue a câmera ou abra um vídeo em <b>Fonte</b>).
        Vídeo do YouTube: clique em <b>Analisar este vídeo no pipeline</b> (barra de vídeo) ou <b>Usar como fonte</b> — só assistindo, o pipeline não vê a imagem.</p>`}

      <div class="cfg-sub" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>${frontal ? 'Alinhamento (vista frontal)' : `Ângulos · últimas ${cfg.nCiclos || 10} pedaladas`}</span>
        ${!frontal && html`<button class="btn tiny" style=${{ padding: '1px 7px' }} onClick=${() => setDetalhes(!detalhes)}>${detalhes ? 'menos' : 'mín/máx'}</button>`}
      </div>
      <table style=${css.tab}>
        <thead><tr>
          <th style=${css.th}>Medida</th><th style=${{ ...css.th, textAlign: 'right' }}>Agora</th>
          <th style=${{ ...css.th, textAlign: 'right' }}>Média±dp</th>
          ${detalhes && !frontal && html`<th style=${{ ...css.th, textAlign: 'right' }}>mín/máx</th>`}
          <th style=${{ ...css.th, textAlign: 'right' }}>Alvo</th><th style=${css.th}></th>
        </tr></thead>
        <tbody>
          ${linhas.map(linha)}
        </tbody>
      </table>
      ${frontal
        ? html`<p class="hint tight">Desvio do joelho em relação à linha quadril–tornozelo, em % da perna; positivo = para <b>dentro</b>.
            Assimetria: <b>${assim == null ? '—' : f1(assim) + ' p.p.'}</b> (até ${FRONTAL.assimetria}) · pelve agora <b>${pelve == null ? '—' : f1(Math.abs(pelve)) + '°'}</b>.</p>`
        : html`<p class="hint tight">${textoJoelhoPMI(cfg.perfil, perfil)} (${cfg.perfil}${alvos.regras.length ? `, alvos de ${atleta.nome}` : ''}). "Agora" é o quadro atual (o joelho aparece
            na linha do PMI); PMI/PMS e médias saem de cada pedalada. KOPS em % da perna (+ = joelho à frente do pedal).
            Clique num alvo para ajustar; <b style=${{ color: 'var(--accent)' }}>•</b> = personalizado para o atleta.</p>`}

      <div class="cfg-sub">Recomendações (${cfg.perfil})</div>
      ${recs.length === 0 && html`<p class="hint tight">Pedale alguns ciclos com cadência constante.</p>`}
      ${recs.map((r, i) => html`
        <p key=${i} style=${css.rec}>
          <span style=${{ ...css.dot(COR_STATUS[r.nivel] || COR_STATUS.sem), marginTop: '5px', flex: 'none' }}></span>
          <span><b>${r.area}:</b> ${r.texto}</span>
        </p>`)}
      <p class="hint tight">${NOTA_RECS}</p>

      <div class="cfg-sub">Poses congeladas</div>
      <div style=${css.cong}>
        <${Congelada} c=${sessao.congelado.PMS} rotulo="PMS (topo)" />
        <${Congelada} c=${sessao.congelado.PMI} rotulo="PMI (embaixo)" />
      </div>
      ${sessao.congelados.length > 2 && html`
        <p class="hint tight" style=${{ marginTop: '6px' }}>Registro: ${sessao.congelados.slice(-8).map((c) =>
          `${c.tipo} ${f0(c.amostra && c.amostra.ang && c.amostra.ang.joelho)}°`).join(' · ')}</p>`}

      <div class="cfg-sub">Sessão</div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => { zerarSessao(); setSnap(instantaneo()); }}>Nova sessão</button>
        <button class="btn" onClick=${() => definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
      </div>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!sessao.registro.length}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!sessao.registro.length}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!sessao.registro.length}>Relatório / PDF</button>
      </div>
      <p class="hint tight">${sessao.registro.length} amostras · ${sessao.ciclos.length} pedaladas gravadas${gravando ? '' : ' · pausado'}.</p>

      <details style=${{ marginTop: '6px' }}>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Como filmar</summary>
        <ul class="hint" style=${{ paddingLeft: '18px', marginTop: '6px' }}>
          <li><b>Lateral:</b> câmera de lado, perpendicular à bicicleta, na altura do movimento central, a ~3 m.</li>
          <li><b>Frontal:</b> câmera à frente, alinhada com o eixo da bicicleta, na altura do selim.</li>
          <li>Corpo inteiro no quadro, da cabeça ao pedal; celular deitado (paisagem) e firme num tripé.</li>
          <li>Roupa justa e de cor contrastante com o fundo; boa luz, sem contraluz.</li>
          <li>Bicicleta no rolo, pedalando 1–2 min a uma cadência constante (80–95 rpm) antes de medir.</li>
          <li>Mantenha as mãos na posição de uso (manetes, drops ou extensões) durante a medição.</li>
        </ul>
      </details>
      <details>
        <summary style=${{ cursor: 'pointer', fontSize: '12px', color: 'var(--ink-2)' }}>Convenções dos ângulos</summary>
        <p class="hint" style=${{ marginTop: '6px' }}>Ângulos internos no plano da imagem (180° = reto). Joelho: quadril–joelho–tornozelo
          (PMI = máximo, PMS = mínimo de cada pedalada). Quadril: ombro–quadril–joelho, fechamento mínimo. Tronco: quadril→ombro
          sobre a horizontal. Ombro: quadril–ombro–cotovelo. Cotovelo: ombro–cotovelo–punho. Tornozelo: joelho–tornozelo–ponta do
          pé; "ankling" = amplitude no ciclo. KOPS: joelho em relação ao eixo do pedal estimado com o pé à frente (3 h).
          Pedaladas detectadas pela subida e descida do tornozelo. Medida por pose estimada, sem marcadores: espere
          alguns graus de erro.</p>
      </details>
    <//>
  `;
}
