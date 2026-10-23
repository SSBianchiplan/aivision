/**
 * components/esportes/QuadraPanel.js — painel "Quadra" (CV-35).
 *
 * O operador quadra.analise mede; este painel conduz: esporte e medidas
 * (gravados nos parâmetros do nó do Pipeline), CALIBRAÇÃO por cliques
 * (escolhe um ponto conhecido no desenho da quadra e clica nele no quadro;
 * 4 ou mais pares → homografia, com as linhas projetadas por cima para
 * conferir), radar ao vivo com mapa de calor por time ou jogador,
 * estatísticas por time e jogador, eventos e a exportação (CSV, JSON,
 * relatório para imprimir/PDF).
 *
 * O executor não expõe o ctx do quadro: o operador publica num canal
 * (runtime/livres-j/canal.js) e o painel assina, no máximo 4×/s.
 * CSS próprio em css/esportes-quadra.css (carregado aqui se faltar).
 */
import { html, useState, useEffect, useMemo } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { ESPORTES, NOMES_ESPORTES, medidas, montarCalibracao, linhasNaImagem, num } from '../../cv/runtime/livres-j/quadras.js';
import { pedirCalibracao } from '../calibrar.js';
import {
  assinar, instantaneo, obterSessao, zerarSessao, definirPausado, estaPausado, pedirQuadro, ultimoQuadro,
} from '../../cv/runtime/livres-j/canal.js';
import { svgRadar, dadosSessao, csvSessao, htmlRelatorio } from '../../cv/runtime/livres-j/relatorio.js';

const OP = 'quadra.analise';
const PREFS = 'aiv.quadra.prefs';
const CSS_HREF = 'css/esportes-quadra.css?v=j1';

function garantirCss() {
  try {
    if (document.querySelector('link[data-esportes-quadra]')) return;
    if ([...document.styleSheets].some((s) => s.href && s.href.includes('esportes-quadra.css'))) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = CSS_HREF; l.dataset.esportesQuadra = '1';
    document.head.appendChild(l);
  } catch (_) { /* sem DOM */ }
}

const lerPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (_) { return {}; } };
const gravarPrefs = (v) => { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado */ } };
const lerCal = (t) => { try { const c = JSON.parse(t || ''); return c && typeof c === 'object' ? c : null; } catch (_) { return null; } };

function baixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const f0 = (x) => num(x, 0), f1 = (x) => num(x, 1);
const dot = (c) => html`<span class="qd-dot" style=${{ background: c || '#888' }}></span>`;

/** Desenho da quadra com os pontos de referência clicáveis (escolhe qual ponto o próximo clique marca). */
function MapaPontos({ esporte, L, W, pares, atual, onEscolher }) {
  const e = ESPORTES[esporte];
  const pts = e.pontos(L, W);
  const m = Math.max(L, W) * 0.06;
  const r = Math.max(L, W) * 0.018;
  const d = e.linhas(L, W).map(([a, b, c, dd]) => `M${a.toFixed(2)} ${b.toFixed(2)}L${c.toFixed(2)} ${dd.toFixed(2)}`).join('');
  const ordem = new Map(pares.map((p, i) => [p.id, i + 1]));
  return html`
    <svg class="qd-mapa" viewBox="${-m} ${-m} ${L + 2 * m} ${W + 2 * m}" role="img" aria-label="Pontos de referência da quadra">
      <rect x=${-m} y=${-m} width=${L + 2 * m} height=${W + 2 * m} rx=${m / 2} class="qd-mapa-fundo" />
      <path d=${d} stroke="rgba(255,255,255,.85)" stroke-width=${Math.max(L, W) * 0.004} fill="none" />
      ${Object.entries(pts).map(([id, [x, y, nome]]) => {
        const n = ordem.get(id), sel = id === atual;
        return html`<g key=${id} class="qd-ponto" onClick=${() => onEscolher(id)}>
          <title>${nome}</title>
          <circle cx=${x} cy=${y} r=${r * 2.2} fill="transparent" />
          <circle cx=${x} cy=${y} r=${sel ? r * 1.35 : r} fill=${n ? '#4ade80' : sel ? '#FFD84D' : 'rgba(255,255,255,.35)'}
                  stroke=${sel ? '#fff' : '#02302C'} stroke-width=${r * 0.3} />
          ${n && html`<text x=${x} y=${y + r * 0.45} font-size=${r * 1.3} text-anchor="middle" fill="#02302C" font-weight="700">${n}</text>`}
        </g>`;
      })}
    </svg>`;
}

export function QuadraPanel({ onClose, ...layout }) {
  useEffect(garantirCss, []);
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(OP), ...lerPrefs() }));
  const cfg = no ? { ...defaultParams(OP), ...no.params } : prefs;
  const esporte = ESPORTES[cfg.esporte] ? cfg.esporte : 'futebol';
  const esp = ESPORTES[esporte];
  const { L, W } = medidas(esporte, cfg.comprimento, cfg.largura);

  const [snap, setSnap] = useState(() => instantaneo());
  const [quadro, setQuadro] = useState(() => ultimoQuadro());
  useEffect(() => assinar((s) => { setSnap(s); setQuadro(ultimoQuadro()); }), []);
  const [aviso, setAviso] = useState('');
  const [calibrando, setCalibrando] = useState(false);
  const [atual, setAtual] = useState(null);
  const [modoAro, setModoAro] = useState(false);
  const [calor, setCalor] = useState('todos');
  const [sel, setSel] = useState(null);
  const [aba, setAba] = useState('jogadores');
  const [, setPausa] = useState(estaPausado());

  // enquanto calibra, o operador manda uma miniatura do quadro a cada ~1,2 s
  useEffect(() => {
    if (!calibrando) return undefined;
    pedirQuadro(4000);
    const t = setInterval(() => pedirQuadro(4000), 2000);
    return () => clearInterval(t);
  }, [calibrando]);

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

  function adicionar() {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    let novos;
    if (i >= 0) novos = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
    else novos = [...ns, { id: newNodeId(), op: OP, params: { ...defaultParams(OP), ...prefs }, enabled: true }];
    store.set({ nodes: novos, panels: { ...store.get().panels, pipeline: true } });
    persist();
    setAviso(i >= 0 ? 'Quadra ligada no Pipeline.' : 'Quadra adicionada ao Pipeline.');
    setTimeout(() => setAviso(''), 3500);
  }

  // ---- calibração
  const calTxt = lerCal(cfg.calibracao);
  const calDoEsporte = calTxt && calTxt.esporte === esporte ? calTxt : null;
  const pares = calDoEsporte && Array.isArray(calDoEsporte.pares) ? calDoEsporte.pares : [];
  const aros = calDoEsporte && Array.isArray(calDoEsporte.aros) ? calDoEsporte.aros : [];
  const pontos = esp.pontos(L, W);
  const proximo = (lista) => {
    const usados = new Set(lista.map((p) => p.id));
    return esp.sugestao.find((id) => !usados.has(id)) || Object.keys(pontos).find((id) => !usados.has(id)) || null;
  };
  const pontoAtual = atual && pontos[atual] ? atual : proximo(pares);
  const gravarCal = (novosPares, novosAros = aros) => {
    const q = quadro || {};
    const c = { esporte, pares: novosPares.map((p) => ({ id: p.id, u: Math.round(p.u * 1e4) / 1e4, v: Math.round(p.v * 1e4) / 1e4 })),
      aros: novosAros.map(([u, v]) => [Math.round(u * 1e4) / 1e4, Math.round(v * 1e4) / 1e4]), w: q.w || (calDoEsporte && calDoEsporte.w) || 640, h: q.h || (calDoEsporte && calDoEsporte.h) || 360 };
    if (calDoEsporte && calDoEsporte.aroR) c.aroR = calDoEsporte.aroR;
    definir('calibracao', JSON.stringify(c));
  };
  const previa = useMemo(() => {
    if (pares.length < 4) return null;
    const c = montarCalibracao({ pares, w: (quadro && quadro.w) || 640, h: (quadro && quadro.h) || 360 }, esporte, L, W);
    if (!c || c.erro) return c;
    return { ...c, linhas: linhasNaImagem(esporte, L, W, c.Hi) };
  }, [cfg.calibracao, esporte, L, W, quadro && quadro.w]);

  function cliqueImagem(ev) {
    const r = ev.currentTarget.getBoundingClientRect();
    const u = (ev.clientX - r.left) / r.width, v = (ev.clientY - r.top) / r.height;
    if (modoAro) { gravarCal(pares, [...aros, [u, v]]); setModoAro(false); return; }
    if (!pontoAtual) return;
    const novos = [...pares.filter((p) => p.id !== pontoAtual), { id: pontoAtual, u, v }];
    gravarCal(novos);
    setAtual(proximo(novos));
  }

  // ---- estado ao vivo
  const sessao = obterSessao();
  const recente = Boolean(snap && performance.now() - snap.t < 12000);
  const calibrada = Boolean(snap && snap.cal);
  const times = snap ? snap.times : null;
  const ativos = snap ? snap.jogadores.filter((j) => j.ativo) : [];
  const radarSvg = useMemo(() => {
    const cores = times ? { A: times.A.cor, B: times.B.cor, O: times.O.cor } : {};
    const js = snap ? snap.jogadores.map((j) => ({ ...j, P: calibrada ? j.P : j.R })) : [];
    const b = snap && snap.bola.agora ? (calibrada ? snap.bola.agora.P : [snap.bola.agora.u * L, snap.bola.agora.v * W]) : null;
    const traj = snap && calibrada ? snap.bola.traj.filter((s) => s.P).map((s) => s.P) : [];
    const qs = snap && calibrada ? snap.quiques.slice(-12) : [];
    const ch = calor === 'nenhum' ? null : sessao.calor(calor === 'jogador' ? sel : calor);
    return svgRadar(esporte, L, W, { calor: ch, jogadores: js, cores, bola: b, traj, quiques: qs, sel });
  }, [snap, calor, sel, esporte, L, W]);

  const cfgExp = () => ({ esporte, L, W, cal: snap && snap.cal, calibracao: calDoEsporte });
  const exportar = (tipo) => {
    const d = dadosSessao(sessao, cfgExp());
    if (tipo === 'csv') baixar(`quadra-${esporte}-${carimbo()}.csv`, '﻿' + csvSessao(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`quadra-${esporte}-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else {
      const h = htmlRelatorio(d, sessao, cfgExp());
      const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
      const w = window.open(url, '_blank');
      if (!w) baixar(`quadra-relatorio-${carimbo()}.html`, h, 'text/html;charset=utf-8');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  };

  const jogLista = snap ? snap.jogadores.filter((j) => j.tempo >= 0.5).sort((a, b) => (b.ativo - a.ativo) || (b.dist - a.dist) || (b.tempo - a.tempo)).slice(0, 30) : [];
  const zonaPrincipal = (z) => { const e = Object.entries(z || {}).sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : '—'; };

  return html`
    <${Panel} id="quadra" title="Quadra" subtitle=${`${esp.nome} · ${ativos.length} em quadra${calibrada ? '' : ' · sem calibração'}`}
              onClose=${onClose} ...${layout} width=${340}>
      <div class="qd">
      ${!no && html`<p class="hint tight">Análise de jogos com uma câmera: jogadores, bola, times, radar, mapa de calor, distância e
        velocidade. Roda no operador <b>Quadra</b> do Pipeline, sobre o RF-DETR (Apache-2.0) ou o detector anterior na cadeia — tudo no navegador.</p>`}
      ${no && !no.enabled && html`<p class="hint tight qd-alerta">O nó Quadra está desligado no Pipeline.</p>`}

      <div class="qd-grade">
        <label><span class="ctl-label">Esporte</span>
          <select class="qd-sel" value=${esporte} onChange=${(e) => { definir('esporte', e.target.value); setAtual(null); setModoAro(false); }}>
            ${NOMES_ESPORTES.map((n) => html`<option key=${n} value=${n}>${ESPORTES[n].nome}</option>`)}
          </select></label>
        <label><span class="ctl-label">Times por</span>
          <select class="qd-sel" value=${cfg.times} onChange=${(e) => definir('times', e.target.value)}>
            ${['automático', 'cor do uniforme', 'lado da quadra', 'não separar'].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        ${esp.ajustavel && html`
          <label><span class="ctl-label">Comprimento (m)</span>
            <input class="txt qd-num" type="number" min=${esp.ajustavel.L[0]} max=${esp.ajustavel.L[1]} step="0.5" placeholder=${String(esp.L)}
                   value=${cfg.comprimento || ''} onChange=${(e) => definir('comprimento', Number(e.target.value) || 0)} /></label>
          <label><span class="ctl-label">Largura (m)</span>
            <input class="txt qd-num" type="number" min=${esp.ajustavel.W[0]} max=${esp.ajustavel.W[1]} step="0.5" placeholder=${String(esp.W)}
                   value=${cfg.largura || ''} onChange=${(e) => definir('largura', Number(e.target.value) || 0)} /></label>`}
      </div>
      <p class="hint tight">Quadra: ${f1(L)} × ${f1(W)} m${esp.ajustavel ? ' (vazio = medida oficial)' : ' (oficial)'}.</p>

      <div class="row tight qd-botoes">
        <button class="btn accent" onClick=${adicionar}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn accent cal-btn" onClick=${() => pedirCalibracao('quadra.analise')} title="Escolher o esporte e arrastar os 4 cantos da quadra no vídeo">⚙ Calibrar quadra</button>
        <button class=${`btn${calibrando ? ' on' : ''}`} onClick=${() => setCalibrando(!calibrando)} title="Pontos extras: linhas, aro">${calibrando ? 'Fechar pontos' : `Pontos (${pares.length}/4+)`}</button>
      </div>
      ${aviso && html`<p class="hint tight qd-ok">✓ ${aviso}</p>`}

      ${calibrando && html`
        <div class="qd-cal">
          <p class="hint tight">1. Toque num ponto do desenho (amarelo = o próximo). 2. Clique no mesmo ponto no quadro.
            Use 4 ou mais pontos espalhados (cantos, meio, áreas); com mais de 4 aparece o erro de reprojeção.
            As linhas projetadas por cima do quadro mostram se a calibração bateu.</p>
          <${MapaPontos} esporte=${esporte} L=${L} W=${W} pares=${pares} atual=${pontoAtual} onEscolher=${(id) => { setAtual(id); setModoAro(false); }} />
          <p class="qd-legenda">${modoAro ? 'Clique no centro do aro no quadro.' : pontoAtual ? html`Próximo: <b>${pontos[pontoAtual][2]}</b>` : 'Todos os pontos marcados.'}</p>
          <div class="qd-quadro" onClick=${cliqueImagem}>
            ${quadro ? html`<img src=${quadro.url} alt="Quadro atual para calibração" draggable="false" />`
              : html`<div class="qd-vazio">Aguardando um quadro do vídeo… (o nó Quadra precisa estar no Pipeline, com a fonte rodando)</div>`}
            ${quadro && html`<svg viewBox="0 0 1 1" preserveAspectRatio="none" class="qd-sobre">
              ${previa && previa.linhas && previa.linhas.map(([a, b, c, d], i) => html`<line key=${'l' + i} x1=${a} y1=${b} x2=${c} y2=${d} stroke="#22d3ee" stroke-width="2" vector-effect="non-scaling-stroke" />`)}
              ${pares.map((p) => html`<circle key=${p.id} cx=${p.u} cy=${p.v} r="0.008" fill=${p.id === pontoAtual ? '#FFD84D' : '#4ade80'} stroke="#02302C" stroke-width="1.5" vector-effect="non-scaling-stroke" />`)}
              ${aros.map(([u, v], i) => html`<line key=${'a' + i} x1=${u - 0.012} y1=${v} x2=${u + 0.012} y2=${v} stroke="#fb923c" stroke-width="3" vector-effect="non-scaling-stroke" />`)}
            </svg>`}
          </div>
          <div class="row tight qd-botoes">
            <button class="btn tiny" disabled=${!pares.length} onClick=${() => { const n = pares.slice(0, -1); gravarCal(n); setAtual(proximo(n)); }}>Desfazer</button>
            <button class="btn tiny" disabled=${!pares.length && !aros.length} onClick=${() => { gravarCal([], []); setAtual(null); }}>Limpar</button>
            ${esp.arremessos && html`<button class=${`btn tiny${modoAro ? ' on' : ''}`} onClick=${() => setModoAro(!modoAro)}>${modoAro ? 'Clique no aro…' : `Marcar aro (${aros.length})`}</button>`}
            ${esp.arremessos && aros.length > 0 && html`<button class="btn tiny" onClick=${() => gravarCal(pares, [])}>Tirar aros</button>`}
          </div>
          ${previa && previa.erro && html`<p class="hint tight qd-alerta">⚠ ${previa.erro}</p>`}
          ${previa && !previa.erro && html`<p class="hint tight">
            Homografia com ${previa.n} pontos${previa.erroM != null ? html` · erro de reprojeção <b>${num(previa.erroM, 2)} m</b>` : ''} ·
            resolução no ponto mais distante <b>${num(previa.mPorPx, 2)} m por pixel</b> de processamento
            ${previa.mPorPx > 0.5 ? ' — baixa: aumente a largura de processamento.' : ''}
            ${previa.aviso ? html`<br /><span class="qd-alerta">⚠ ${previa.aviso}</span>` : ''}</p>`}
          ${pares.length > 0 && pares.length < 4 && html`<p class="hint tight">Faltam ${4 - pares.length} pontos.</p>`}
        </div>`}

      ${!recente && no && no.enabled && html`<p class="hint tight">Aguardando o jogo (ligue a câmera ou abra um vídeo em <b>Fonte</b>).
        Vídeo do YouTube: <b>Usar como fonte</b> ou <b>Analisar este vídeo no pipeline</b>.</p>`}

      <div class="kpis qd-kpis">
        <div class="kpi"><b>${ativos.length}</b><em>em quadra</em></div>
        <div class="kpi"><b>${snap ? Math.round(100 * snap.taxaBola) + '%' : '—'}</b><em>bola vista</em></div>
        ${esp.posse && html`<div class="kpi"><b>${times && times.A.possePct != null ? `${f0(times.A.possePct)}–${f0(times.B.possePct)}` : '—'}</b><em>posse A–B %</em></div>`}
        ${esp.rally && html`<div class="kpi"><b>${snap && snap.rally.ativo ? snap.rally.golpes : snap ? snap.rallies.length : '—'}</b><em>${snap && snap.rally.ativo ? (esporte === 'vôlei' ? 'travessias' : 'golpes') : 'rallies'}</em></div>`}
        ${esp.arremessos && html`<div class="kpi"><b>${snap ? `${snap.arremessos.cestas}/${snap.arremessos.tent}` : '—'}</b><em>cestas</em></div>`}
        ${calibrada && html`<div class="kpi"><b>${snap.bola.vAtual != null ? f0(snap.bola.vAtual) : '—'}</b><em>bola km/h</em></div>`}
      </div>

      <div class="qd-radar-topo">
        ${calibrada ? html`<span class="cfg-sub">Radar (calibrado: ${esp.nome})</span>`
          : html`<button class="cal-cta" onClick=${() => pedirCalibracao('quadra.analise')}>Radar sem calibração — clique para calibrar</button>`}
        <select class="qd-sel qd-sel-mini" value=${calor} onChange=${(e) => setCalor(e.target.value)} aria-label="Mapa de calor">
          <option value="nenhum">sem mapa de calor</option>
          <option value="todos">calor: todos</option>
          <option value="A">calor: Time A</option>
          <option value="B">calor: Time B</option>
          <option value="jogador" disabled=${sel == null}>calor: jogador ${sel != null ? '#' + sel : '(toque na tabela)'}</option>
        </select>
      </div>
      <div class="qd-radar" dangerouslySetInnerHTML=${{ __html: radarSvg }}></div>

      <div class="tabs qd-abas">
        <button class=${aba === 'jogadores' ? 'on' : ''} onClick=${() => setAba('jogadores')}>Jogadores</button>
        <button class=${aba === 'times' ? 'on' : ''} onClick=${() => setAba('times')}>Times</button>
        <button class=${aba === 'eventos' ? 'on' : ''} onClick=${() => setAba('eventos')}>Eventos</button>
      </div>

      ${aba === 'times' && times && html`
        <table class="qd-tab">
          <thead><tr><th>Time</th><th class="n">Agora</th><th class="n">Dist. (m)</th>${esp.posse && html`<th class="n">Posse</th><th class="n">Passes</th><th class="n">Perdas</th>`}</tr></thead>
          <tbody>${['A', 'B', 'O'].map((k) => html`<tr key=${k}>
            <td>${dot(times[k].cor)}${times[k].nome}${times[k].uniforme ? html` <span class="qd-unif" title="cor média do uniforme">${dot(times[k].uniforme)}</span>` : ''}</td><td class="n">${times[k].agora}</td>
            <td class="n">${calibrada ? f0(times[k].dist) : '—'}</td>
            ${esp.posse && html`<td class="n">${times[k].possePct != null ? f0(times[k].possePct) + '%' : '—'}</td><td class="n">${times[k].passes ?? '—'}</td><td class="n">${times[k].perdas ?? '—'}</td>`}
          </tr>`)}</tbody>
        </table>
        <p class="hint tight">Times por ${snap.modoTimes === 'lado' ? 'lado da quadra' : snap.modoTimes === 'cor' ? 'cor do uniforme (k-means em Lab do tronco; "Outros" = árbitro/goleiro de outra cor)' : 'nenhum critério'}.</p>`}

      ${aba === 'jogadores' && html`
        <table class="qd-tab">
          <thead><tr><th>ID</th><th class="n">Dist. (m)</th><th class="n">km/h</th><th class="n">Máx.</th><th class="n">Tempo</th><th>Zona</th></tr></thead>
          <tbody>${jogLista.map((j) => html`<tr key=${j.id} class=${`${j.ativo ? '' : 'qd-inativo'}${String(sel) === String(j.id) ? ' qd-sel-linha' : ''}`}
              onClick=${() => { setSel(j.id); setCalor('jogador'); }}>
            <td>${dot(times && j.time ? times[j.time].cor : null)}#${j.id}</td>
            <td class="n">${calibrada ? f0(j.dist) : '—'}</td><td class="n">${calibrada && j.vAtual != null ? f0(j.vAtual) : '—'}</td>
            <td class="n">${calibrada ? f0(j.vMax) : '—'}</td><td class="n">${f0(j.tempo)} s</td><td>${zonaPrincipal(j.zonas)}</td>
          </tr>`)}</tbody>
        </table>
        ${!jogLista.length && html`<p class="hint tight">Nenhum jogador ainda.</p>`}
        ${jogLista.length > 0 && !calibrada && html`<p class="hint tight">Distância e velocidade aparecem depois de calibrar a quadra.</p>`}`}

      ${aba === 'eventos' && snap && html`
        <ul class="qd-eventos">${snap.eventos.slice().reverse().slice(0, 14).map((e, i) => html`<li key=${i} class=${'qd-ev-' + e.tipo}><span>${f1(e.s)} s</span>${e.texto}</li>`)}</ul>
        ${!snap.eventos.length && html`<p class="hint tight">Sem eventos ainda (${esp.posse ? 'passes e perdas de posse' : esp.rally ? 'rallies e quiques' : 'eventos'} aparecem aqui).</p>`}
        ${esp.rally && snap.rallies.length > 0 && html`<p class="hint tight">${snap.rallies.length} rallies · média ${f1(snap.rallies.reduce((s, r) => s + r.golpes, 0) / snap.rallies.length)} ${esporte === 'vôlei' ? 'travessias' : 'golpes'} · maior ${Math.max(...snap.rallies.map((r) => r.golpes))}</p>`}
        ${(esp.quique || esp.rede) && snap.quiques.length > 0 && html`<p class="hint tight">Quiques: ${snap.quiques.filter((q) => q.dentro).length} dentro · ${snap.quiques.filter((q) => !q.dentro).length} fora (aproximado: precisa de câmera alta e bola nítida).</p>`}`}

      <div class="row tight qd-botoes qd-export">
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!snap}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!snap}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!snap}>Relatório / PDF</button>
      </div>
      <div class="row tight qd-botoes">
        <button class="btn tiny" onClick=${() => { zerarSessao(); setSel(null); }}>Nova sessão</button>
        <button class="btn tiny" onClick=${() => { definirPausado(!estaPausado()); setPausa(estaPausado()); }}>${estaPausado() ? 'Retomar' : 'Pausar contagem'}</button>
      </div>
      <p class="hint tight">${snap ? `${f0(snap.duracaoS)} s · ${snap.atualizacoes} atualizações · fonte: ${snap.fonte}${snap.pausado ? ' · pausado' : ''}` : 'Sem dados ainda.'}</p>

      <details class="qd-det">
        <summary>Como filmar e o que esperar</summary>
        <ul class="hint">
          <li>Câmera <b>parada e alta</b> (tripé na arquibancada, fundo da quadra ou lateral), pegando a quadra inteira ou a maior parte. Câmera que gira/zoom (transmissão de TV) invalida a calibração a cada corte.</li>
          <li>Calibre com pontos <b>distantes entre si</b>; 5–8 pontos dão o erro de reprojeção e diluem cliques imprecisos.</li>
          <li>Largura de processamento maior (Ajustes) = mais metros resolvidos no fundo e bola achada mais vezes, ao custo de fps.</li>
          <li>Bola: o detector genérico (COCO) acha a bola grande e próxima; bola de tênis/padel distante e rápida pede o modo <b>2ª passada ampliada</b> ou um modelo treinado no <b>Treinar</b>.</li>
          <li>Uniformes parecidos (ou com o gramado/piso) confundem os times; troque para "lado da quadra" nos esportes com rede.</li>
          <li>Velocidade da bola e quique são aproximados: a bola no ar é projetada no chão; o quique depende de pegar o ponto mais baixo da trajetória (a 3–8 inferências/s, muitos se perdem).</li>
        </ul>
      </details>
      </div>
    <//>
  `;
}
