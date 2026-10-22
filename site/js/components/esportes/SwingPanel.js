/**
 * components/esportes/SwingPanel.js — "Swing": golfe e esportes de raquete.
 *
 * O operador swing.analise (CV-33) mede; este painel conduz: esporte e golpe,
 * mão dominante, vista (gravados nos parâmetros do nó), velocidade de
 * reprodução do vídeo (0,25× dá 4× mais poses no downswing — o tempo medido é
 * o do vídeo, não muda), a lista de swings com métricas e os 6 quadros-chave,
 * a comparação lado a lado de dois swings e a exportação.
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import {
  NOMES_ESPORTES, ESPORTES, perfilDe, FASES, NOME_FASE, METRICAS_SWING, status, COR_STATUS, num,
} from '../../cv/runtime/livres-i/swing.js';
import { canalSwing as canal } from '../../cv/runtime/livres-i/canal.js';
import { videoDaFonte } from '../../cv/runtime/livres-i/relogio.js';
import { dadosSwing, csvSwing, htmlSwing } from '../../cv/runtime/livres-i/relatorio.js';
import { baixar, abrirRelatorio, carimbo, adicionarNo, definirParam } from './VbtPanel.js';

const OP = 'swing.analise';
const PREFS = 'aiv.swing.prefs';
const lerPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (_) { return {}; } };
const gravarPrefs = (v) => { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado */ } };
const OSSOS_MINI = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

const fmtM = (m, v) => (v == null ? '—' : `${num(v, m.d)}${m.un === ':1' ? ':1' : m.un === '°' || m.un === '%' ? m.un : ''}`);

function Quadro({ q, rotulo, pequeno }) {
  const L = 120;
  if (!q || !q.thumb) return html`<figure class="esp-quadro"><div class="esp-quadro-vazio">${rotulo}</div><figcaption>${rotulo}</figcaption></figure>`;
  const pts = q.pontos;
  return html`
    <figure class=${'esp-quadro' + (pequeno ? ' peq' : '')}>
      <div class="esp-quadro-img">
        <img src=${q.thumb} alt=${rotulo} />
        ${pts && html`<svg viewBox="0 0 ${L} ${L}">
          ${OSSOS_MINI.map(([a, b], i) => (pts[a].v > 0.4 && pts[b].v > 0.4
            ? html`<line key=${i} x1=${pts[a].x} y1=${pts[a].y} x2=${pts[b].x} y2=${pts[b].y} stroke="#FFD84D" stroke-width="1.6" stroke-linecap="round" />` : null))}
        </svg>`}
      </div>
      <figcaption>${rotulo}</figcaption>
    </figure>`;
}

/** Trajetória das mãos (coordenadas em troncos, origem no quadril da preparação). */
function Trajetorias({ lista }) {
  const todos = lista.flatMap((s) => s.sw.trajeto);
  if (todos.length < 2) return null;
  const xs = todos.map((p) => p.x), ys = todos.map((p) => p.y);
  const x0 = Math.min(...xs, -0.6), x1 = Math.max(...xs, 0.6), y0 = Math.min(...ys, -1.6), y1 = Math.max(...ys, 0.4);
  const W = 260, k = W / Math.max(x1 - x0, (y1 - y0) * 1.3), H = Math.max(80, (y1 - y0) * k);
  const P = (p) => `${((p.x - x0) * k).toFixed(1)},${((p.y - y0) * k).toFixed(1)}`;
  return html`
    <svg class="esp-trajeto-swing" viewBox="0 0 ${W} ${H.toFixed(0)}" role="img" aria-label="Trajetória das mãos">
      <circle cx=${((0 - x0) * k).toFixed(1)} cy=${((0 - y0) * k).toFixed(1)} r="4" fill="var(--ink-3)" />
      ${lista.map((s, i) => html`<g key=${i}>
        ${s.sw.implemento.length > 1 && html`<path d=${'M' + s.sw.implemento.map(P).join('L')} fill="none" stroke=${s.cor} stroke-width="1.4" stroke-dasharray="4 3" opacity=".7" />`}
        <path d=${'M' + s.sw.trajeto.map(P).join('L')} fill="none" stroke=${s.cor} stroke-width="2.2" stroke-linejoin="round" />
        ${['topo', 'impacto'].map((f) => {
          const tt = s.sw.tempos[f];
          let b = s.sw.trajeto[0];
          for (const p of s.sw.trajeto) if (Math.abs(p.t - tt) < Math.abs(b.t - tt)) b = p;
          return html`<circle key=${f} cx=${((b.x - x0) * k).toFixed(1)} cy=${((b.y - y0) * k).toFixed(1)} r="3.5" fill=${s.cor} stroke="#0008" />`;
        })}
      </g>`)}
    </svg>`;
}

export function SwingPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(OP), ...lerPrefs() }));
  const cfg = no ? { ...defaultParams(OP), ...no.params } : prefs;
  const [snap, setSnap] = useState(() => canal.instantaneo());
  const [, setTick] = useState(0);
  useEffect(() => canal.assinar((s) => { setSnap(s); setTick((t) => t + 1); }), []);
  const [aviso, setAviso] = useState('');
  const [sel, setSel] = useState(null);          // swing aberto (n)
  const [comparar, setComparar] = useState(false);
  const [cmpA, setCmpA] = useState(null), [cmpB, setCmpB] = useState(null);
  const [taxa, setTaxa] = useState(() => { const v = videoDaFonte(); return v ? v.playbackRate : 1; });

  const sessao = canal.obterSessao();
  const swings = sessao.swings;
  const perfil = perfilDe(cfg.perfil);
  const ref = perfil.ref || {};
  const gravando = canal.estaGravando();
  const aberto = swings.find((s) => s.n === sel) || swings[swings.length - 1] || null;

  function definir(k, v) {
    const np = { ...prefs, [k]: v };
    setPrefs(np); gravarPrefs(np);
    definirParam(OP, k, v);
  }
  function adicionar() {
    const ja = adicionarNo(OP, prefs);
    setAviso(ja ? 'Swing ligado no Pipeline.' : 'Swing adicionado ao Pipeline.');
    setTimeout(() => setAviso(''), 3500);
  }
  function velocidade(r) {
    const v = videoDaFonte();
    if (!v) { setAviso('A velocidade só vale para vídeo aberto em Fonte (arquivo).'); setTimeout(() => setAviso(''), 3500); return; }
    v.playbackRate = r; setTaxa(r);
  }
  const cfgRel = { perfil: cfg.perfil, dominante: cfg.dominante, vista: cfg.vista, alturaCm: cfg.alturaCm };
  const exportar = (tipo) => {
    const d = dadosSwing(sessao, cfgRel);
    if (tipo === 'csv') baixar(`swing-${carimbo()}.csv`, '﻿' + csvSwing(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`swing-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else abrirRelatorio(`swing-relatorio-${carimbo()}.html`, htmlSwing(d));
  };
  const linhaMetrica = (m, sw) => {
    const v = sw.metricas[m.k];
    const st = m.ref ? status(v, ref[m.ref], m.k === 'razaoTempo' ? 0.3 : null) : 'sem';
    const faixa = m.ref && ref[m.ref] ? `${ref[m.ref][0]}–${ref[m.ref][1]}` : '';
    return html`<tr key=${m.k}>
      <td>${m.nome}</td><td class="n">${fmtM(m, v)}</td><td class="n esp-ref">${faixa}</td>
      <td title=${{ ok: 'na faixa', perto: 'perto', fora: 'fora', sem: '' }[st]}>${m.ref && ref[m.ref] ? html`<span class="esp-dot" style=${{ background: COR_STATUS[st] }}></span>` : ''}</td>
    </tr>`;
  };
  const A = swings.find((s) => s.n === cmpA) || swings[swings.length - 2] || null;
  const B = swings.find((s) => s.n === cmpB) || swings[swings.length - 1] || null;
  const recente = snap && !snap.zerado && !snap.sem;

  return html`
    <${Panel} id="swing" title="Swing" subtitle=${`${swings.length} swings · ${perfil.esporte} · ${perfil.golpe}`} onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">A análise roda no operador <b>Swing</b> do Pipeline, sobre a pose BlazePose — no seu
        aparelho, nada é enviado. Escolha o esporte e adicione:</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó Swing está desligado no Pipeline.</p>`}
      <div class="esp-grade">
        <label><span class="ctl-label">Esporte</span>
          <select class="esp-sel" value=${perfil.esporte} onChange=${(e) => definir('perfil', `${e.target.value} · ${ESPORTES[e.target.value].golpes[0]}`)}>
            ${NOMES_ESPORTES.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        <label><span class="ctl-label">Golpe</span>
          <select class="esp-sel" value=${perfil.golpe} onChange=${(e) => definir('perfil', `${perfil.esporte} · ${e.target.value}`)}>
            ${perfil.golpes.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        <label><span class="ctl-label">Mão dominante</span>
          <select class="esp-sel" value=${cfg.dominante} onChange=${(e) => definir('dominante', e.target.value)}>
            <option value="destro">destro</option><option value="canhoto">canhoto</option>
          </select></label>
        <label><span class="ctl-label">Vista</span>
          <select class="esp-sel" value=${cfg.vista} onChange=${(e) => definir('vista', e.target.value)}>
            <option value="frente">de frente</option><option value="linha do alvo">linha do alvo (trás)</option>
          </select></label>
        <label><span class="ctl-label">Altura (cm, opcional)</span>
          <input class="txt esp-num" type="number" min="0" max="230" inputmode="numeric" placeholder="para m/s e cm" value=${cfg.alturaCm || ''}
                 onChange=${(e) => definir('alturaCm', Math.max(0, Math.min(230, Number(e.target.value) || 0)))} /></label>
        <label class="esp-check"><input type="checkbox" checked=${Boolean(cfg.implemento)} onChange=${(e) => definir('implemento', e.target.checked)} />
          <span>Seguir ${perfil.implemento[0] === 'tennis racket' ? 'a raquete' : 'o taco'} (mais lento)</span></label>
      </div>
      <div class="row tight" style=${{ gap: '6px' }}>
        <button class="btn accent" onClick=${adicionar}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      <div class="esp-vel" role="group" aria-label="Velocidade do vídeo">
        <span class="ctl-label">Vídeo</span>
        ${[1, 0.5, 0.25].map((r) => html`<button key=${r} class=${'btn tiny' + (taxa === r ? ' on' : '')} onClick=${() => velocidade(r)}>${r === 1 ? '1×' : num(r, 2).replace(/0$/, '') + '×'}</button>`)}
        <span class="hint">mais lento = mais poses no downswing</span>
      </div>

      <div class="kpis" style=${{ marginTop: '10px' }}>
        <div class="kpi"><b>${swings.length}</b><em>swings</em></div>
        <div class="kpi"><b class=${recente && snap.taxa != null && snap.taxa < 20 ? 'warn' : ''}>${recente && snap.taxa ? Math.round(snap.taxa) : '—'}</b><em>poses/s</em></div>
        <div class="kpi"><b>${aberto ? num(aberto.metricas.razaoTempo, 1) + ':1' : '—'}</b><em>razão de tempo</em></div>
      </div>
      ${recente && snap.avisos && snap.avisos.map((a, i) => html`<p key=${i} class="hint tight esp-aviso">⚠ ${a}</p>`)}
      ${(!snap || snap.zerado || snap.sem) && no && no.enabled && html`<p class="hint tight">Aguardando o atleta na imagem (câmera ou vídeo em <b>Fonte</b>).
        Faça o swing completo; ele aparece aqui quando as mãos param no final.</p>`}

      <div class="cfg-sub esp-cab"><span>Swings</span>
        ${swings.length > 1 && html`<button class="btn tiny" onClick=${() => setComparar(!comparar)}>${comparar ? 'Fechar comparação' : 'Comparar 2'}</button>`}
      </div>
      <div class="esp-tabwrap">
        <table class="esp-tab esp-lista-swings">
          <thead><tr><th>#</th><th class="n">Tempo</th><th class="n">Razão</th><th class="n">X-factor</th><th class="n">Cabeça</th><th class="n">Mãos</th></tr></thead>
          <tbody>
            ${swings.length === 0 && html`<tr><td colspan="6" class="esp-vazio">Nenhum swing ainda.</td></tr>`}
            ${swings.slice().reverse().map((s) => html`
              <tr key=${s.n} class=${aberto && aberto.n === s.n ? 'sel' : ''} onClick=${() => setSel(s.n)} tabindex="0"
                  onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(s.n); } }}>
                <td>${s.n}</td><td class="n">${num(s.metricas.tempoBack, 2)}/${num(s.metricas.tempoDown, 2)}</td>
                <td class="n">${num(s.metricas.razaoTempo, 1)}</td><td class="n">${num(s.metricas.xfactor, 0)}°</td>
                <td class="n">${num(s.metricas.cabeca, 0)}%</td><td class="n">${num(s.metricas.velMaos, 1)}</td>
              </tr>`)}
          </tbody>
        </table>
      </div>

      ${comparar && A && B ? html`
        <div class="cfg-sub esp-cab"><span>Comparação</span>
          <span class="esp-nav">
            <select class="esp-sel peq" value=${A.n} onChange=${(e) => setCmpA(Number(e.target.value))} aria-label="Swing A">
              ${swings.map((s) => html`<option key=${s.n} value=${s.n}>A: ${s.n}</option>`)}</select>
            <select class="esp-sel peq" value=${B.n} onChange=${(e) => setCmpB(Number(e.target.value))} aria-label="Swing B">
              ${swings.map((s) => html`<option key=${s.n} value=${s.n}>B: ${s.n}</option>`)}</select>
          </span>
        </div>
        <div class="esp-comparar">
          <div class="esp-comp-cab"><span></span><b style=${{ color: '#22d3ee' }}>Swing ${A.n}</b><b style=${{ color: '#f472b6' }}>Swing ${B.n}</b></div>
          ${FASES.map((f) => html`<div key=${f} class="esp-comp-linha">
            <span class="esp-comp-fase">${NOME_FASE[f]}</span>
            <${Quadro} q=${A.quadros[f]} rotulo="" pequeno=${true} /><${Quadro} q=${B.quadros[f]} rotulo="" pequeno=${true} />
          </div>`)}
        </div>
        <${Trajetorias} lista=${[{ sw: A, cor: '#22d3ee' }, { sw: B, cor: '#f472b6' }]} />
        <div class="esp-tabwrap">
          <table class="esp-tab">
            <thead><tr><th>Medida</th><th class="n">${A.n}</th><th class="n">${B.n}</th><th class="n">Δ</th></tr></thead>
            <tbody>${METRICAS_SWING.map((m) => {
              const a = A.metricas[m.k], b = B.metricas[m.k];
              return html`<tr key=${m.k}><td>${m.nome}</td><td class="n">${fmtM(m, a)}</td><td class="n">${fmtM(m, b)}</td>
                <td class="n">${a == null || b == null ? '—' : (b - a > 0 ? '+' : '') + num(b - a, m.d)}</td></tr>`;
            })}</tbody>
          </table>
        </div>` : aberto && html`
        <div class="cfg-sub esp-cab"><span>Swing ${aberto.n} · ${aberto.perfil}</span><span class="hint">${aberto.amostras} poses · ${num(aberto.taxa, 0)}/s</span></div>
        <div class="esp-quadros">
          ${FASES.map((f) => html`<${Quadro} key=${f} q=${aberto.quadros[f]} rotulo=${NOME_FASE[f]} />`)}
        </div>
        <div class="esp-tabwrap">
          <table class="esp-tab">
            <thead><tr><th>Medida</th><th class="n">Valor</th><th class="n">Ref.</th><th></th></tr></thead>
            <tbody>
              ${METRICAS_SWING.map((m) => linhaMetrica(m, aberto))}
              ${aberto.metricas.cabecaCm != null && html`<tr><td>Cabeça (estimado)</td><td class="n">${num(aberto.metricas.cabecaCm, 1)} cm</td><td></td><td></td></tr>`}
              ${aberto.metricas.velMaosMs != null && html`<tr><td>Mãos (estimado)</td><td class="n">${num(aberto.metricas.velMaosMs, 1)} m/s</td><td></td><td></td></tr>`}
            </tbody>
          </table>
        </div>
        <${Trajetorias} lista=${[{ sw: aberto, cor: '#FFD84D' }]} />
        <p class="hint tight">Trajetória das mãos (pontos: topo e impacto; cinza: quadril na preparação)${aberto.implemento.length > 1 ? '; tracejado: implemento' : ''}.
          "tr/s" = troncos por segundo (ombros–quadril).</p>`}

      <div class="cfg-sub">Sessão</div>
      <div class="row tight esp-botoes">
        <button class="btn" onClick=${() => { canal.zerarSessao(); setSel(null); setComparar(false); }}>Nova sessão</button>
        <button class="btn" onClick=${() => canal.definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
      </div>
      <div class="row tight esp-botoes">
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!swings.length}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!swings.length}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!swings.length}>Relatório / PDF</button>
      </div>

      <details>
        <summary class="esp-sum">Como filmar</summary>
        <ul class="hint esp-lista">
          <li><b>De frente</b> (face-on): câmera à frente do atleta, na altura do quadril, a 3–4 m — rotações pela largura aparente.</li>
          <li><b>Linha do alvo</b>: câmera atrás, alinhada com o alvo — rotações pela profundidade do modelo (menos precisas).</li>
          <li>Corpo inteiro e o implemento no quadro; câmera parada; boa luz; 60 fps ou câmera lenta se o celular tiver.</li>
          <li>Vídeo gravado em câmera lenta: informe o fator em <b>Pipeline › Swing › câmera lenta</b>; ou reproduza a 0,25× acima.</li>
          <li>Golfe: razão de tempo ≈ 3:1 é a referência clássica dos profissionais.</li>
        </ul>
      </details>
      <details>
        <summary class="esp-sum">Como as medidas saem</summary>
        <p class="hint">Fases pela velocidade das mãos: topo (golfe: mãos mais altas; raquete: a reversão), impacto (golfe: mãos no ponto
          mais baixo; raquete: pico de velocidade), início e fim quando as mãos param. Rotações e X-factor são aproximações 2D;
          cabeça e transferência em % do tronco e da base. Pose estimada sem marcadores: espere alguns graus e centésimos de erro.</p>
      </details>
    <//>
  `;
}
