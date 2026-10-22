/**
 * components/esportes/VbtPanel.js — "VBT": treino baseado em velocidade.
 *
 * O operador vbt.barra (CV-34) mede; este painel conduz: exercício, carga,
 * tamanho do marcador (gravados nos parâmetros do nó do Pipeline), link para
 * imprimir o marcador, tabela de repetições, perda de velocidade da série com
 * alerta, zonas, séries e a exportação (CSV, JSON, relatório/PDF).
 *
 * O executor não expõe o ctx do quadro: o operador publica no canal
 * (runtime/livres-i/canal.js), que este painel assina — no máximo 4×/s, e na
 * hora quando fecha uma repetição.
 */
import { html, useState, useEffect, ReactDOM } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { NOMES_EXERCICIOS, exercicioDe, ZONAS, zonaDe, num, alertaPerda } from '../../cv/runtime/livres-i/vbt.js';
import { PONTOS, ESCALAS, resolverPonto, lerPontos, escreverPontos, eixoCima, FRACAO_SEGMENTO } from '../../cv/runtime/livres-i/semmarcador.js';
import { canalVbt as canal } from '../../cv/runtime/livres-i/canal.js';
import { dadosVbt, csvVbt, htmlVbt } from '../../cv/runtime/livres-i/relatorio.js';

const OP = 'vbt.barra';
const PREFS = 'aiv.vbt.prefs';
const lerPrefs = () => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (_) { return {}; } };
const gravarPrefs = (v) => { try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado */ } };

export function baixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function abrirRelatorio(nome, h) {
  const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (!w) baixar(nome, h, 'text/html;charset=utf-8');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

/** Liga (ou cria) o nó do operador no Pipeline. */
export function adicionarNo(op, params) {
  const ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === op);
  let novos;
  if (i >= 0) novos = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
  else novos = [...ns, { id: newNodeId(), op, params: { ...defaultParams(op), ...params }, enabled: true }];
  store.set({ nodes: novos, panels: { ...store.get().panels, pipeline: true } });
  persist();
  return i >= 0;
}
export function definirParam(op, k, v) {
  const ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === op);
  if (i < 0) return;
  store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, params: { ...n.params, [k]: v } } : n)) });
  persist();
}

/** Barras da velocidade média por repetição, com a linha do limite de perda. */
function Barras({ reps, limite }) {
  if (!reps.length) return null;
  const W = 280, H = 96, max = Math.max(1.0, ...reps.map((r) => r.vm)) * 1.12;
  const n = Math.max(reps.length, 6), bw = Math.min(30, (W - 8) / n - 4);
  const melhor = Math.max(...reps.map((r) => r.vm));
  const yLim = H - 14 - ((melhor * (1 - limite / 100)) / max) * (H - 26);
  return html`
    <svg class="esp-barras" viewBox="0 0 ${W} ${H}" role="img" aria-label="Velocidade média por repetição">
      <line x1="0" x2=${W} y1=${yLim} y2=${yLim} stroke="var(--err)" stroke-dasharray="4 3" stroke-width="1" />
      ${reps.map((r, i) => {
        const h = (r.vm / max) * (H - 26), x = 4 + i * (bw + 4), z = zonaDe(r.vm);
        return html`<g key=${i}>
          <rect x=${x} y=${H - 14 - h} width=${bw} height=${h} rx="3" fill=${z ? z.cor : '#94a3b8'} />
          <text x=${x + bw / 2} y=${H - 3} text-anchor="middle" class="esp-svg-txt">${r.n}</text>
          <text x=${x + bw / 2} y=${H - 17 - h} text-anchor="middle" class="esp-svg-txt">${num(r.vm, 2)}</text>
        </g>`;
      })}
    </svg>`;
}

/** Trajetória da barra na última repetição (cm, relativa ao início da subida). */
function Trajeto({ rep }) {
  if (!rep || rep.trajeto.length < 2) return null;
  const T = rep.trajeto.map((q) => ({ x: (q.x - rep.trajeto[0].x) * rep.cmPx, y: (rep.trajeto[0].y - q.y) * rep.cmPx }));
  const ys = T.map((q) => q.y), xs = T.map((q) => q.x);
  const alto = Math.max(10, ...ys), larg = Math.max(8, ...xs.map(Math.abs)) * 2;
  const H = 120, k = (H - 12) / alto, W = Math.max(60, larg * k + 20);
  const cx = W / 2, z = zonaDe(rep.vm);
  const d = T.map((q, i) => `${i ? 'L' : 'M'}${(cx + q.x * k).toFixed(1)},${(H - 6 - q.y * k).toFixed(1)}`).join('');
  return html`
    <svg class="esp-trajeto" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trajetória da barra">
      <line x1=${cx} x2=${cx} y1="4" y2=${H - 4} stroke="var(--line)" stroke-dasharray="3 3" />
      <path d=${d} fill="none" stroke=${z ? z.cor : '#FFD84D'} stroke-width="2.5" stroke-linecap="round" />
    </svg>`;
}

/**
 * Marcação de 2 pontos sobre o vídeo (escala por 2 cliques e referência de
 * inclinação). Uma camada fixa por cima do canvas do Viewport, num portal no
 * <body>: o Viewport desenha o quadro "contido" e centrado, então o clique
 * volta para o quadro do pipeline pela mesma conta. Pontos em U (milésimos
 * da largura do quadro) — o espaço das posições do operador.
 */
function Marcar2Pontos({ quadro, titulo, cor, aoFim, aoCancelar }) {
  const [pts, setPts] = useState([]);
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const medir = () => {
      const c = document.querySelector('.viewport canvas.stage') || document.querySelector('.viewport canvas');
      setRect(c ? c.getBoundingClientRect() : null);
    };
    medir();
    window.addEventListener('resize', medir);
    const esc = (e) => { if (e.key === 'Escape') aoCancelar(); };
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('resize', medir); window.removeEventListener('keydown', esc); };
  }, []);
  if (!rect || !quadro) return null;
  const fit = Math.min(rect.width / quadro.w, rect.height / quadro.h);
  const dw = quadro.w * fit, dh = quadro.h * fit, dx = (rect.width - dw) / 2, dy = (rect.height - dh) / 2;
  const paraU = (e) => ({ x: ((e.clientX - rect.left - dx) / fit) * 1000 / quadro.w, y: ((e.clientY - rect.top - dy) / fit) * 1000 / quadro.w });
  const naTela = (q) => ({ x: dx + (q.x * quadro.w / 1000) * fit, y: dy + (q.y * quadro.w / 1000) * fit });
  const clique = (e) => {
    e.preventDefault(); e.stopPropagation();
    const q = paraU(e);
    if (q.x < 0 || q.x > 1000 || q.y < 0 || q.y > (1000 * quadro.h) / quadro.w) return;
    const n = [...pts, q];
    if (n.length === 2) aoFim(n); else setPts(n);
  };
  const T = pts.map(naTela);
  return ReactDOM.createPortal(html`
    <div class="esp-marcar" style=${{ left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' }}
         onPointerDown=${clique} role="application" aria-label=${titulo}>
      <svg width=${rect.width} height=${rect.height}>
        <rect x=${dx} y=${dy} width=${dw} height=${dh} fill="none" stroke="rgba(255,255,255,.35)" stroke-dasharray="6 4" />
        ${T.map((q, i) => html`<circle key=${i} cx=${q.x} cy=${q.y} r="6" fill=${cor} stroke="#000" />`)}
      </svg>
      <div class="esp-marcar-cab" onPointerDown=${(e) => e.stopPropagation()}>
        <span>${titulo} — clique no ${pts.length ? '2º' : '1º'} ponto</span>
        <button class="btn tiny" onClick=${aoCancelar}>Cancelar (Esc)</button>
      </div>
    </div>`, document.body);
}

export function VbtPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(OP), ...lerPrefs() }));
  const cfg = no ? { ...defaultParams(OP), ...no.params } : prefs;
  const [snap, setSnap] = useState(() => canal.instantaneo());
  const [, setTick] = useState(0);
  useEffect(() => canal.assinar((s) => { setSnap(s); setTick((t) => t + 1); }), []);
  const [aviso, setAviso] = useState('');
  const [verSerie, setVerSerie] = useState(null);
  const [marcando, setMarcando] = useState(null);     // null | 'calib' | 'vertical'

  const sessao = canal.obterSessao();
  const nSeries = sessao.series.length;
  // série nova ainda vazia (acabou de abrir, ou o vídeo voltou ao início): mostra a última com repetições
  let padrao = nSeries - 1;
  while (padrao > 0 && !sessao.series[padrao].reps.length) padrao--;
  const idxSerie = verSerie != null && verSerie < nSeries ? verSerie : padrao;
  const serie = sessao.series[idxSerie];
  const reps = serie.reps;
  const vms = reps.map((r) => r.vm);
  const melhor = vms.length ? Math.max(...vms) : null;
  const perda = vms.length > 1 ? ((melhor - vms[vms.length - 1]) / melhor) * 100 : null;
  // alerta só com ≥3 repetições válidas e velocidade acima do piso (ver alertaPerda)
  const alerta = alertaPerda(reps, cfg.limitePerda);
  const ex = exercicioDe(cfg.exercicio);
  const pontoEf = resolverPonto(cfg.ponto, ex);
  const escSnap = snap && !snap.zerado ? snap.escala : null;
  const quadro = snap && snap.quadro;
  const ref = lerPontos(cfg.vertical);
  const inclin = ref ? eixoCima(ref, cfg.verticalTipo).graus : 0;
  const gravando = canal.estaGravando();
  const marcador = cfg.modo === 'marcador';
  const temDados = sessao.todasReps.length > 0;

  function definir(k, v) {
    const np = { ...prefs, [k]: v };
    setPrefs(np); gravarPrefs(np);
    definirParam(OP, k, v);
  }
  function adicionar() {
    const ja = adicionarNo(OP, prefs);
    setAviso(ja ? 'VBT ligado no Pipeline.' : 'VBT adicionado ao Pipeline.');
    setTimeout(() => setAviso(''), 3500);
  }
  const cfgRel = { exercicio: cfg.exercicio, cargaKg: cfg.cargaKg, marcadorCm: cfg.marcadorCm, modo: cfg.modo, limitePerda: cfg.limitePerda };
  const exportar = (tipo) => {
    const d = dadosVbt(sessao, cfgRel);
    if (tipo === 'csv') baixar(`vbt-${carimbo()}.csv`, '﻿' + csvVbt(d), 'text/csv;charset=utf-8');
    else if (tipo === 'json') baixar(`vbt-${carimbo()}.json`, JSON.stringify(d, null, 2), 'application/json');
    else abrirRelatorio(`vbt-relatorio-${carimbo()}.html`, htmlVbt(d));
  };
  const ult = reps[reps.length - 1];

  return html`
    <${Panel} id="vbt" title="VBT" subtitle=${`${sessao.todasReps.length} reps · série ${idxSerie + 1}/${nSeries}`} onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">A medição roda no operador <b>VBT</b> do Pipeline, no seu aparelho — nada é enviado.
        Prenda o marcador impresso na ponta da barra, filme de lado e adicione:</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó VBT está desligado no Pipeline.</p>`}

      <div class="tabs">
        <button class=${marcador ? 'on' : ''} onClick=${() => definir('modo', 'marcador')}>Marcador ArUco</button>
        <button class=${!marcador ? 'on' : ''} onClick=${() => definir('modo', 'punho (aproximado)')}>Sem marcador</button>
      </div>
      <div class="esp-grade">
        <label><span class="ctl-label">Exercício</span>
          <select class="esp-sel" value=${cfg.exercicio} onChange=${(e) => definir('exercicio', e.target.value)}>
            ${NOMES_EXERCICIOS.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select></label>
        <label><span class="ctl-label">Carga (kg)</span>
          <input class="txt esp-num" type="number" min="0" max="500" step="0.5" inputmode="decimal" value=${cfg.cargaKg}
                 onChange=${(e) => definir('cargaKg', Math.max(0, Math.min(500, Number(e.target.value) || 0)))} /></label>
        ${marcador
          ? html`<label><span class="ctl-label">Lado do marcador (cm)</span>
              <input class="txt esp-num" type="number" min="1" max="30" step="0.1" inputmode="decimal" value=${cfg.marcadorCm}
                     onChange=${(e) => definir('marcadorCm', Math.max(1, Math.min(30, Number(e.target.value) || 5)))} /></label>`
          : html`<label><span class="ctl-label">Ponto seguido</span>
              <select class="esp-sel" value=${cfg.ponto} onChange=${(e) => definir('ponto', e.target.value)}>
                ${PONTOS.map((n) => html`<option key=${n} value=${n}>${n === 'automático' ? `automático (${pontoEf})` : n}</option>`)}
              </select></label>`}
        <label><span class="ctl-label">Alerta de perda (%)</span>
          <input class="txt esp-num" type="number" min="5" max="60" inputmode="numeric" value=${cfg.limitePerda}
                 onChange=${(e) => definir('limitePerda', Math.max(5, Math.min(60, Number(e.target.value) || 20)))} /></label>
      </div>
      ${marcador
        ? html`<p class="hint tight">Meça o lado do quadrado <b>preto</b> impresso com uma régua e informe acima — é ele que dá a escala.
            <a class="esp-link" href="marcadores/aruco-4x4.html" target="_blank" rel="noopener">Imprimir o marcador ↗</a></p>`
        : html`
          <div class="esp-grade">
            <label><span class="ctl-label">Escala</span>
              <select class="esp-sel" value=${cfg.escala} onChange=${(e) => definir('escala', e.target.value)}>
                ${ESCALAS.map((n) => html`<option key=${n} value=${n}>${n === 'altura' ? 'altura (corpo inteiro)' : n === 'segmento' ? 'segmento (coxa/canela)' : '2 cliques no vídeo'}</option>`)}
              </select></label>
            ${cfg.escala === '2 cliques'
              ? html`<label><span class="ctl-label">Distância real (cm)</span>
                  <input class="txt esp-num" type="number" min="1" max="500" step="0.5" inputmode="decimal" value=${cfg.calibCm}
                         onChange=${(e) => definir('calibCm', Math.max(1, Math.min(500, Number(e.target.value) || 45)))} /></label>`
              : html`<label><span class="ctl-label">Altura do atleta (cm)</span>
                  <input class="txt esp-num" type="number" min="100" max="230" inputmode="numeric" value=${cfg.alturaCm}
                         onChange=${(e) => definir('alturaCm', Math.max(100, Math.min(230, Number(e.target.value) || 175)))} /></label>`}
            ${cfg.escala === 'segmento' && html`
              <label><span class="ctl-label">Segmento</span>
                <select class="esp-sel" value=${cfg.segmento} onChange=${(e) => definir('segmento', e.target.value)}>
                  <option value="coxa">coxa (quadril→joelho)</option><option value="canela">canela (joelho→tornozelo)</option>
                </select></label>
              <label><span class="ctl-label">Medida (cm)</span>
                <input class="txt esp-num" type="number" min="0" max="80" step="0.5" inputmode="decimal"
                       placeholder=${`≈ ${num(FRACAO_SEGMENTO[cfg.segmento === 'canela' ? 'canela' : 'coxa'] * (cfg.alturaCm || 175), 0)} (estimada)`}
                       value=${cfg.segmentoCm || ''} onChange=${(e) => definir('segmentoCm', Math.max(0, Math.min(80, Number(e.target.value) || 0)))} /></label>`}
          </div>
          ${cfg.escala === '2 cliques' && html`<div class="row tight esp-botoes">
            <button class="btn" onClick=${() => setMarcando('calib')} disabled=${!quadro}>${lerPontos(cfg.calib2p) ? 'Remarcar os 2 pontos' : 'Marcar 2 pontos no vídeo'}</button>
            <span class="hint" style=${{ margin: 0 }}>${lerPontos(cfg.calib2p) ? 'marcados ✓' : 'ex.: diâmetro da anilha (45 cm), largura do banco'}</span>
          </div>`}
          <p class="hint tight">Ponto seguido: <b>${pontoEf}</b> (${cfg.ponto === 'automático' ? `pelo exercício ${cfg.exercicio}` : 'escolhido'}).
            ${cfg.escala === 'altura' ? ' A escala pela altura exige o corpo inteiro no quadro, da cabeça aos pés.' : ''}
            ${' '}Sem marcador é uma estimativa: use para tendência e contagem.</p>`}
      <div class="esp-incl">
        <span class="ctl-label">Inclinação da câmera</span>
        <select class="esp-sel peq" value=${cfg.verticalTipo} onChange=${(e) => definir('verticalTipo', e.target.value)} aria-label="Tipo de referência">
          <option value="vertical">linha vertical (rack, batente)</option><option value="horizontal">linha horizontal (chão, banco)</option>
        </select>
        <button class="btn tiny" onClick=${() => setMarcando('vertical')} disabled=${!quadro}>${ref ? 'Remarcar' : 'Marcar no vídeo'}</button>
        ${ref && html`<button class="btn tiny" onClick=${() => definir('vertical', '')}>Limpar</button>`}
        <span class="hint" style=${{ margin: 0 }}>${ref ? `correção de ${num(inclin, 1)}°` : 'sem correção (vertical da imagem)'}</span>
      </div>
      ${escSnap && html`<p class=${'hint tight' + (escSnap.confiavel ? '' : ' esp-alerta')}>
        Escala: <b>${escSnap.fonte}</b>${escSnap.cmU && quadro ? ` · ${num((escSnap.cmU * 10000) / quadro.w, 2)} mm/px` : ''}${escSnap.confiavel ? '' : ' · velocidades NÃO confiáveis'}</p>`}
      ${escSnap && escSnap.avisos && escSnap.avisos.map((a, i) => html`<p key=${i} class=${'hint tight ' + (escSnap.confiavel ? 'esp-aviso' : 'esp-alerta')}>⚠ ${a}</p>`)}
      ${marcando && html`<${Marcar2Pontos} quadro=${quadro}
          titulo=${marcando === 'calib' ? `Escala: marque as pontas de algo com ${num(cfg.calibCm, 1)} cm` : `Inclinação: marque 2 pontos de uma linha ${cfg.verticalTipo}`}
          cor=${marcando === 'calib' ? '#34d399' : '#a78bfa'}
          aoCancelar=${() => setMarcando(null)}
          aoFim=${(q) => { definir(marcando === 'calib' ? 'calib2p' : 'vertical', escreverPontos(q[0], q[1])); setMarcando(null); }} />`}
      <div class="row tight" style=${{ gap: '6px' }}>
        <button class="btn accent" onClick=${adicionar}>${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}

      <div class="kpis" style=${{ marginTop: '10px' }}>
        <div class="kpi"><b>${reps.length}</b><em>reps na série</em></div>
        <div class="kpi"><b>${ult ? num(ult.vm, 2) : '—'}</b><em>últ. média m/s</em></div>
        <div class="kpi"><b class=${alerta ? 'esp-alerta' : ''}>${perda == null ? '—' : num(perda, 0) + '%'}</b><em>perda de vel.</em></div>
      </div>
      ${alerta && html`<p class="esp-banner-alerta" role="alert">⚠ Perda de velocidade de ${num(perda, 0)}% passou do limite de ${cfg.limitePerda}%:
        considere encerrar a série.</p>`}
      ${snap && !snap.zerado && no && no.enabled && html`<p class="hint tight">
        ${snap.fonte === 'marcador' ? 'Marcador visto' : snap.motivo ? `⚠ ${snap.motivo}` : `Seguindo: ${snap.ponto || pontoEf}`} ·
        agora ${snap.vAgora == null ? '—' : num(snap.vAgora, 2)} m/s${snap.descartes ? ` · ${snap.descartes} subidas descartadas (amplitude/duração implausível)` : ''}${gravando ? '' : ' · pausado'}</p>`}
      ${perda != null && reps.length < 3 && html`<p class="hint tight">O alerta de perda só dispara a partir de 3 repetições válidas.</p>`}
      ${(!snap || snap.zerado) && no && no.enabled && html`<p class="hint tight">Aguardando ${marcador ? 'o marcador' : 'o atleta'} na imagem
        (câmera ou vídeo em <b>Fonte</b>).</p>`}

      <div class="cfg-sub esp-cab">
        <span>Série ${idxSerie + 1}${idxSerie !== nSeries - 1 ? ' (anterior)' : ''} · ${cfg.exercicio} · ${num(cfg.cargaKg, cfg.cargaKg % 1 ? 1 : 0)} kg</span>
        ${nSeries > 1 && html`<span class="esp-nav">
          <button class="btn tiny" disabled=${idxSerie === 0} onClick=${() => setVerSerie(idxSerie - 1)} aria-label="Série anterior">‹</button>
          <button class="btn tiny" disabled=${idxSerie === nSeries - 1} onClick=${() => setVerSerie(idxSerie + 1 >= nSeries - 1 ? null : idxSerie + 1)} aria-label="Próxima série">›</button>
        </span>`}
      </div>
      <${Barras} reps=${reps} limite=${cfg.limitePerda} />
      <div class="esp-tabwrap">
        <table class="esp-tab">
          <thead><tr><th>#</th><th class="n">Média</th><th class="n">Pico</th><th class="n">Desl.</th><th class="n">Pot.</th><th class="n">Perda</th><th></th></tr></thead>
          <tbody>
            ${reps.length === 0 && html`<tr><td colspan="7" class="esp-vazio">Nenhuma repetição ainda.</td></tr>`}
            ${reps.map((r) => {
              const z = zonaDe(r.vm);
              return html`<tr key=${r.n}>
                <td>${r.n}</td><td class="n" title=${r.aprox ? 'escala não confiável' : ''}>${r.aprox ? '≈' : ''}${num(r.vm, 2)}</td><td class="n">${num(r.pico, 2)}</td><td class="n">${num(r.desl, 0)}</td>
                <td class="n">${r.potMedia == null ? '—' : Math.round(r.potMedia)}</td>
                <td class=${'n' + (r.perdaAcum != null && r.perdaAcum > cfg.limitePerda ? ' esp-alerta' : '')}>${r.perdaAcum == null ? '—' : num(r.perdaAcum, 0) + '%'}</td>
                <td title=${z ? z.nome : ''}><span class="esp-dot" style=${{ background: z ? z.cor : '#94a3b8' }}></span></td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
      <p class="hint tight">Média e pico em m/s (fase concêntrica), deslocamento em cm, potência média em W (carga × g × velocidade).
        ${ult ? html`Última: propulsiva ${num(ult.vmp, 2)} m/s · pico de potência ${ult.potPico == null ? '—' : Math.round(ult.potPico) + ' W'} ·
        desvio horizontal ${num(ult.desvioH, 1)} cm · ${ult.zona}.` : ''}</p>
      ${ult && html`<div class="esp-traj-linha"><${Trajeto} rep=${ult} /><div class="hint">Trajetória da barra na última subida
        (linha tracejada = vertical do início). Desvio horizontal: <b>${num(ult.desvioH, 1)} cm</b>.</div></div>`}

      <div class="cfg-sub">Zonas de velocidade (média)</div>
      <ul class="esp-zonas">
        ${ZONAS.map((z) => html`<li key=${z.nome}><span class="esp-dot" style=${{ background: z.cor }}></span>${z.nome}
          <em>${num(z.de, 2)}${Number.isFinite(z.ate) ? `–${num(z.ate, 2)}` : '+'} m/s</em></li>`)}
      </ul>

      <div class="cfg-sub">Sessão</div>
      <div class="row tight esp-botoes">
        <button class="btn" onClick=${() => { sessao.novaSerie(); setVerSerie(null); canal.tocar(); }} disabled=${!sessao.serie.reps.length}>Nova série</button>
        <button class="btn" onClick=${() => { canal.zerarSessao(); setVerSerie(null); }}>Nova sessão</button>
        <button class="btn" onClick=${() => canal.definirGravando(!gravando)}>${gravando ? 'Pausar' : 'Retomar'}</button>
      </div>
      <div class="row tight esp-botoes">
        <button class="btn" onClick=${() => exportar('csv')} disabled=${!temDados}>CSV</button>
        <button class="btn" onClick=${() => exportar('json')} disabled=${!temDados}>JSON</button>
        <button class="btn" onClick=${() => exportar('html')} disabled=${!temDados}>Relatório / PDF</button>
      </div>
      <p class="hint tight">${sessao.nAmostras} amostras · ${sessao.todasReps.length} repetições em ${sessao.series.filter((s) => s.reps.length).length || 0} série(s).
        Nova série abre sozinha depois de ${cfg.pausaSerieS || '—'} s parado.</p>

      <details>
        <summary class="esp-sum">Como filmar</summary>
        <ul class="hint esp-lista">
          <li>Imprima o marcador em 100% (sem "ajustar à página"), meça o quadrado preto e cole na <b>ponta da barra</b> (tampa da manga), plano e virado para a câmera, com a margem branca.</li>
          <li>Câmera <b>de lado</b>, parada (tripé), na altura da barra e perpendicular a ela, a 1,5–3 m; a barra inteira do movimento no quadro.</li>
          <li>Boa luz e celular a 60 fps se possível; evite contraluz (o marcador precisa de contraste).</li>
          <li>${`${cfg.exercicio}: conta como repetição a ${ex.eixo === 'horizontal' ? 'puxada' : 'subida'} com pelo menos ${cfg.deslMinCm || ex.deslMin} cm e duração entre ${num(ex.dur[0], 2)} e ${num(ex.dur[1], 0)} s.`}
            Vídeo gravado em câmera lenta: informe o fator em <b>Pipeline › VBT › câmera lenta</b>.</li>
          <li><b>Sem marcador</b>: de lado, com o ponto seguido (quadril ou punhos) sempre visível. Escala: corpo inteiro no quadro (altura),
            a coxa/canela medida (segmento) ou 2 cliques sobre um objeto de tamanho conhecido no plano do movimento.
            Câmera torta: marque uma linha vertical (ou o chão) em "Inclinação".</li>
        </ul>
      </details>
    <//>
  `;
}
