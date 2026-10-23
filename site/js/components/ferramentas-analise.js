/**
 * components/ferramentas-analise.js — as peças de UI das ferramentas de mouse
 * novas, fora do widget para ele continuar enxuto:
 *
 *   OpcoesFerramenta  faixa de opções da ferramenta ativa, sob a dica
 *                     (tolerância da varinha, raio do pincel, classe do
 *                     contador, SAM: concluir/cancelar e o estado do modelo)
 *   CartaoAnalise     cartão flutuante com o HISTOGRAMA (RGB / HSV / cinza,
 *                     média, desvio, mín, máx) de uma área ou o PERFIL de
 *                     intensidade de uma linha, ao vivo, com CSV
 *   Camadas           grupos de marcações na lista: mostrar/ocultar/travar
 *   BarraAlinhar      alinhar e distribuir a seleção múltipla (como no Figma)
 *   detalheNovo(it)   texto da lista para os tipos novos
 *   AcoesItem         botões da lista por tipo (máscara PNG, cronômetro,
 *                     trajetória, perspectiva, análise)
 */

import { perguntar } from './dialogo.js';
import { html, useState, useEffect, useRef } from '../vendor.js';
import { useStore } from '../state/store.js';
import {
  marcStore, rt, vista, setOpc, atualizar, AREAS, LINHAS, areaPx, perimetroPx, fmtArea, fmtComprimento, comprimentoPx,
  mmPorPx, alinhar, selecionados, grupos, grupoAplicar, travar, definirGrupo, mascaraPNG, segundosCrono, fmtTempo,
  tempoAgora, baixar, ESQUELETO, centroide,
} from '../cv/marcacoes.js';
import { histogramaDe, perfilDe, situacaoSam, soltarModelo, iniciarTrajetoria, velocidadePx } from '../cv/marcacoes-analise.js';
import { avisoStore, fecharPoligono, cancelarRascunho } from './marcacoes-vista.js';

// ------------------------------------------------------------- opções da ferramenta

export function OpcoesFerramenta({ ferramenta, box, direita }) {
  const o = useStore(marcStore, (s) => ({ opc: s.opc, n: s.itens.length })).opc;
  const aviso = useStore(avisoStore, (s) => ({ t: s.texto })).t;
  const [, pulso] = useState(0);
  useEffect(() => {
    if (ferramenta !== 'sam') return undefined;
    const t = setInterval(() => pulso((n) => n + 1), 400);
    return () => clearInterval(t);
  }, [ferramenta]);
  const el = box.current;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const W = window.innerWidth;
  const estreito = W <= 640;
  // celular: no alto, ao lado do widget (embaixo fica o cartão de análise e a barra de vídeo)
  const sty = estreito ? { left: (direita ? 8 : r.right + 6) + 'px', right: (direita ? W - r.left + 6 : 8) + 'px', top: r.top + 'px' }
    : direita ? { right: (W - r.left + 8) + 'px', top: (r.top + 64) + 'px' } : { left: (r.right + 8) + 'px', top: (r.top + 64) + 'px' };

  let corpo = null;
  if (ferramenta === 'varinha') {
    corpo = html`
      <label>Tolerância <input type="range" min="0" max="255" value=${o.tolerancia} aria-label="Tolerância da varinha"
             onInput=${(e) => setOpc({ tolerancia: +e.target.value })} /> <b>${o.tolerancia}</b></label>
      <label><input type="checkbox" checked=${o.contiguo} onChange=${(e) => setOpc({ contiguo: e.target.checked })} /> Contígua</label>`;
  } else if (ferramenta === 'pincel' || ferramenta === 'borrachaMascara') {
    corpo = html`
      <label>Raio <input type="range" min="2" max="80" value=${o.raio} aria-label="Raio do pincel"
             onInput=${(e) => setOpc({ raio: +e.target.value })} /> <b>${o.raio} px</b></label>`;
  } else if (ferramenta === 'contador') {
    const classes = [...new Set([...marcStore.get().itens.filter((i) => i.tipo === 'contador').map((i) => i.classe), o.contClasse])];
    corpo = html`
      <label>Classe <select value=${o.contClasse} aria-label="Classe do contador" onChange=${(e) => setOpc({ contClasse: e.target.value })}>
        ${classes.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}
      </select></label>
      <button class="btn tiny" onClick=${async () => { const n = await perguntar('Nome da nova classe de contagem:', { titulo: 'Nova classe', ok: 'Criar classe' }); if (n && n.trim()) setOpc({ contClasse: n.trim().slice(0, 40) }); }}>+ classe</button>
      <span class="ferr-opc-d">1–9 trocam · ⇧+clique tira</span>`;
  } else if (ferramenta === 'sam') {
    const s = rt.sam;
    const sit = situacaoSam();
    corpo = html`
      <span class="ferr-opc-d">MobileSAM: <b>${sit === 'pronto' ? 'pronto' : sit}</b>${s ? ` · ${s.pontos.length} ${s.pontos.length === 1 ? 'ponto' : 'pontos'}` : ''}</span>
      <button class="btn tiny accent" disabled=${!s || !s.poligono} onClick=${() => fecharPoligono()}>Concluir (Enter)</button>
      <button class="btn tiny" disabled=${!s} onClick=${() => cancelarRascunho()}>Cancelar (Esc)</button>`;
  }
  if (!corpo && !aviso) return null;
  return html`
    <div class="ferr-opc ${estreito ? 'estreito' : ''}" style=${sty} role="group" aria-label="Opções da ferramenta">
      ${corpo}
      ${aviso && html`<span class="ferr-opc-aviso" role="status">${aviso}</span>`}
    </div>`;
}

// ------------------------------------------------------------- cartão de análise

const CORES = { r: '#f87171', g: '#4ade80', b: '#60a5fa', h: '#f472b6', s: '#FFD84D', v: '#a78bfa' };

function tinta() {
  const cs = getComputedStyle(document.documentElement);
  return { ink: cs.getPropertyValue('--ink').trim() || '#fff', ink3: cs.getPropertyValue('--ink-3').trim() || 'rgba(207,235,228,.62)', line: cs.getPropertyValue('--line-2').trim() || 'rgba(255,255,255,.09)' };
}

function desenharGrafico(c, series, { xmax = null, rotX = '' } = {}) {
  if (!c) return;
  const dpr = window.devicePixelRatio || 1;
  const Wc = c.clientWidth || 320, Hc = c.clientHeight || 130;
  c.width = Math.round(Wc * dpr); c.height = Math.round(Hc * dpr);
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, Wc, Hc);
  const t = tinta();
  const m = { l: 30, r: 6, t: 6, b: 16 };
  const w = Wc - m.l - m.r, h = Hc - m.t - m.b;
  let ymax = 1;
  for (const s of series) for (let i = 0; i < s.y.length; i++) if (s.y[i] > ymax) ymax = s.y[i];
  g.strokeStyle = t.line; g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 4; i++) { const y = m.t + (h * i) / 4 + 0.5; g.moveTo(m.l, y); g.lineTo(m.l + w, y); }
  g.stroke();
  g.fillStyle = t.ink3; g.font = '9.5px ui-monospace, monospace';
  g.fillText(ymax >= 1000 ? (ymax / 1000).toFixed(1) + 'k' : String(Math.round(ymax)), 2, m.t + 8);
  g.fillText('0', 2, m.t + h);
  if (xmax != null) { g.fillText(rotX, m.l, Hc - 3); const tx = String(xmax); g.fillText(tx, m.l + w - tx.length * 6, Hc - 3); }
  for (const s of series) {
    const n = s.y.length;
    g.strokeStyle = s.cor; g.lineWidth = s.grossa ? 1.8 : 1.3;
    g.globalAlpha = s.alfa || 0.95;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = m.l + (w * i) / Math.max(1, n - 1), y = m.t + h - (h * s.y[i]) / ymax;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  }
}

const fmt = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d).replace('.', ','));

export function CartaoAnalise({ box, direita, deslocar }) {
  const st = useStore(marcStore, (s) => ({ id: s.analise, it: s.itens.find((i) => i.id === s.analise) }));
  const it = st.it;
  const [modo, setModo] = useState('rgb');
  const [vivo, setVivo] = useState(true);
  const [dados, setDados] = useState(null);
  const cRef = useRef(null);

  const ehArea = it && AREAS.has(it.tipo);
  const ehLinha = it && LINHAS.has(it.tipo) && it.pts.length >= 2;

  const calcular = () => {
    const x = marcStore.get().itens.find((i) => i.id === st.id);
    if (!x) return;
    try { setDados(AREAS.has(x.tipo) ? { h: histogramaDe(x) } : { p: perfilDe(x) }); } catch (e) { setDados({ erro: e.message }); }
  };
  useEffect(() => {
    calcular();
    if (!vivo) return undefined;
    const t = setInterval(calcular, 600);
    return () => clearInterval(t);
  }, [st.id, vivo, it && it.pts]);

  useEffect(() => {
    if (!dados || !cRef.current) return;
    if (dados.h && dados.h.canais) {
      const C = dados.h.canais;
      const ch = modo === 'rgb' ? ['r', 'g', 'b'] : modo === 'hsv' ? ['h', 's', 'v'] : ['cinza'];
      desenharGrafico(cRef.current, ch.map((k) => ({ y: C[k].hist, cor: CORES[k] || tinta().ink, grossa: k === 'cinza' })), { xmax: modo === 'hsv' ? '255 (H: 360°)' : 255, rotX: '0' });
    } else if (dados.p) {
      const P = dados.p;
      const ser = modo === 'cinza' ? [{ y: P.cinza, cor: tinta().ink, grossa: true }]
        : [{ y: P.r, cor: CORES.r }, { y: P.g, cor: CORES.g }, { y: P.b, cor: CORES.b }, { y: P.cinza, cor: tinta().ink, grossa: true, alfa: 0.7 }];
      desenharGrafico(cRef.current, ser, { xmax: fmtComprimento(P.comprimento), rotX: '0' });
    }
  }, [dados, modo]);

  if (!st.id) return null;
  const fechar = () => marcStore.set({ analise: null });
  const el = box.current;
  const r = el ? el.getBoundingClientRect() : { left: 8, right: 52, top: 80 };
  const W = window.innerWidth;
  const estreito = W <= 640;
  // celular: folha acima da barra de vídeo (que fica embaixo)
  const vc = estreito && document.querySelector('.vctl');
  const vr = vc && vc.getBoundingClientRect();
  const fundo = vr && vr.height ? Math.max(8, window.innerHeight - vr.top + 8) : 8;
  const sty = estreito ? { left: '8px', right: '8px', bottom: fundo + 'px', maxHeight: `calc(100vh - ${fundo + 90}px)`, overflow: 'auto' }
    : direita ? { right: (W - r.left + 8 + (deslocar || 0)) + 'px', top: (r.top + 110) + 'px' }
      : { left: Math.min(W - 348, r.right + 8 + (deslocar || 0)) + 'px', top: (r.top + 110) + 'px' };

  const csv = () => {
    if (dados && dados.h && dados.h.canais) {
      const C = dados.h.canais;
      const l = ['nivel;r;g;b;cinza;h;s;v'];
      for (let i = 0; i < 256; i++) l.push([i, C.r.hist[i], C.g.hist[i], C.b.hist[i], C.cinza.hist[i], C.h.hist[i], C.s.hist[i], C.v.hist[i]].join(';'));
      baixar(`histograma-${it.nome}.csv`, l.join('\n'), 'text/csv');
    } else if (dados && dados.p) {
      const P = dados.p, k = mmPorPx();
      const l = [`distancia_px;${k ? 'distancia_mm;' : ''}r;g;b;cinza`];
      for (let i = 0; i < P.d.length; i++) l.push([P.d[i].toFixed(2), ...(k ? [(P.d[i] * k).toFixed(3)] : []), P.r[i].toFixed(1), P.g[i].toFixed(1), P.b[i].toFixed(1), P.cinza[i].toFixed(1)].join(';'));
      baixar(`perfil-${it.nome}.csv`, l.join('\n'), 'text/csv');
    }
  };

  let corpo;
  if (!it) corpo = html`<p class="ferr-vazio">A marcação saiu.</p>`;
  else if (!ehArea && !ehLinha) corpo = html`<p class="ferr-vazio">Escolha uma área (histograma) ou uma linha, régua, perfil ou polilinha (perfil).</p>`;
  else if (!dados) corpo = html`<p class="ferr-vazio">calculando…</p>`;
  else if (dados.erro || (dados.h === null) || (dados.p === null)) corpo = html`<p class="ferr-vazio">Não deu para ler os pixels desta fonte${dados.erro ? ': ' + dados.erro : ''}.</p>`;
  else if (dados.h) {
    const C = dados.h.canais;
    const linhas = modo === 'rgb' ? ['r', 'g', 'b', 'cinza'] : modo === 'hsv' ? ['h', 's', 'v'] : ['cinza'];
    const nome = { r: 'R', g: 'G', b: 'B', cinza: 'Cinza', h: 'H (°)', s: 'S', v: 'V' };
    corpo = html`
      <canvas ref=${cRef} class="ferr-graf" role="img" aria-label=${'Histograma ' + modo.toUpperCase() + ' de ' + it.nome}></canvas>
      ${C ? html`<table class="ferr-tab"><thead><tr><th></th><th>média</th><th>desvio</th><th>mín</th><th>máx</th></tr></thead><tbody>
        ${linhas.map((k) => html`<tr key=${k}><th style=${{ color: CORES[k] || 'inherit' }}>${nome[k]}</th><td>${fmt(C[k].media)}</td><td>${fmt(C[k].desvio)}</td><td>${fmt(C[k].min, 0)}</td><td>${fmt(C[k].max, 0)}</td></tr>`)}
      </tbody></table>` : html`<p class="ferr-vazio">A área está fora da imagem.</p>`}
      <div class="ferr-an-d">${dados.h.n} px lidos${dados.h.k < 1 ? ` (amostra 1:${Math.round(1 / (dados.h.k * dados.h.k))})` : ''} · área ${fmtArea(areaPx(it))} · per. ${fmtComprimento(perimetroPx(it))}</div>`;
  } else {
    const P = dados.p;
    let mn = 1e9, mx = -1e9, s = 0;
    for (const v of P.cinza) { if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
    corpo = html`
      <canvas ref=${cRef} class="ferr-graf" role="img" aria-label=${'Perfil de intensidade de ' + it.nome}></canvas>
      <div class="ferr-an-d">${P.d.length} amostras · ${fmtComprimento(P.comprimento)} · cinza média ${fmt(s / P.cinza.length)} · mín ${fmt(mn, 0)} · máx ${fmt(mx, 0)}</div>`;
  }

  return html`
    <div class="ferr-analise ${estreito ? 'estreito' : ''}" style=${sty} role="dialog" aria-label=${'Análise: ' + (it ? it.nome : '')}
         onKeyDown=${(e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } }}>
      <div class="ferr-lista-h">
        <b>${ehArea ? 'Histograma' : 'Perfil'} · ${it ? it.nome : ''}</b>
        <div class="ferr-seg" role="radiogroup" aria-label="Canais">
          ${(ehArea ? [['rgb', 'RGB'], ['hsv', 'HSV'], ['cinza', 'Cinza']] : [['rgb', 'RGB'], ['cinza', 'Cinza']]).map(([v, l]) => html`
            <button key=${v} role="radio" aria-checked=${modo === v ? 'true' : 'false'} class=${modo === v ? 'on' : ''} onClick=${() => setModo(v)}>${l}</button>`)}
        </div>
        <button class="ferr-x" onClick=${fechar} aria-label="Fechar a análise">✕</button>
      </div>
      ${corpo}
      <div class="ferr-lista-f">
        <label class="ferr-vivo"><input type="checkbox" checked=${vivo} onChange=${(e) => setVivo(e.target.checked)} /> ao vivo</label>
        <button class="btn tiny" onClick=${calcular}>Atualizar</button>
        <button class="btn tiny" disabled=${!dados || (!dados.h && !dados.p)} onClick=${csv}>CSV</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------- lista: camadas, alinhar, detalhes

export function Camadas() {
  const gs = useStore(marcStore, (s) => ({ v: s.itens })) && grupos();
  if (!gs.some((g) => g.nome)) return null;
  return html`
    <div class="ferr-camadas" role="group" aria-label="Camadas">
      <b>Camadas</b>
      ${gs.map((g) => {
        const vis = g.visiveis > 0, trav = g.travados === g.n;
        return html`
          <div key=${g.nome} class="ferr-camada">
            <span>${g.nome || 'sem grupo'} <i>(${g.n})</i></span>
            <button class="btn tiny ${vis ? '' : 'on'}" aria-pressed=${!vis} title=${vis ? 'Ocultar o grupo' : 'Mostrar o grupo'}
                    onClick=${() => grupoAplicar(g.nome, { visivel: !vis })}>${vis ? '👁' : '🚫'}</button>
            <button class="btn tiny ${trav ? 'on' : ''}" aria-pressed=${trav} title=${trav ? 'Destravar o grupo' : 'Travar o grupo'}
                    onClick=${() => grupoAplicar(g.nome, { travado: !trav })}>${trav ? '🔒' : '🔓'}</button>
          </div>`;
      })}
    </div>`;
}

export const ALINHAR = [
  ['alEsq', 'esq', 'Alinhar à esquerda'], ['alCx', 'cx', 'Centralizar na horizontal'], ['alDir', 'dir', 'Alinhar à direita'],
  ['alTopo', 'topo', 'Alinhar ao topo'], ['alCy', 'cy', 'Centralizar na vertical'], ['alBase', 'base', 'Alinhar à base'],
  ['distH', 'distH', 'Distribuir na horizontal'], ['distV', 'distV', 'Distribuir na vertical'],
];

export function BarraAlinhar({ icone }) {
  const n = useStore(marcStore, (s) => ({ n: s.selN.length })).n;
  if (n < 2) return null;
  const ids = selecionados();
  return html`
    <div class="ferr-alinhar" role="toolbar" aria-label="Alinhar a seleção">
      <span>${n} selecionadas</span>
      ${ALINHAR.map(([id, modo, nome]) => html`
        <button key=${id} class="ferr-mini" title=${nome} aria-label=${nome} disabled=${modo.startsWith('dist') && n < 3}
                onClick=${() => alinhar(ids, modo)}>${icone(id)}</button>`)}
      <button class="ferr-mini" title="Travar / destravar" aria-label="Travar ou destravar a seleção"
              onClick=${() => { const st = marcStore.get(); travar(ids, !ids.every((id) => (st.itens.find((i) => i.id === id) || {}).travado)); }}>${icone('travar')}</button>
      <button class="ferr-mini" title="Agrupar (camada)" aria-label="Agrupar a seleção"
              onClick=${async () => { const g = await perguntar('Nome do grupo (camada) para as selecionadas — vazio tira do grupo:', { titulo: 'Agrupar', ok: 'Agrupar' }); if (g != null) definirGrupo(ids, g); }}>${icone('agrupar')}</button>
    </div>`;
}

/** Detalhe da lista para os tipos novos (null = o widget usa o dele). */
export function detalheNovo(it) {
  const k = mmPorPx();
  if (it.tipo === 'polilinha' || it.tipo === 'perfil' || it.tipo === 'distancia') return fmtComprimento(comprimentoPx(it)) + (k ? ` · ${comprimentoPx(it).toFixed(0)} px` : '');
  if (it.tipo === 'seta') return 'seta';
  if (it.tipo === 'contador') return `${it.pts.length} ${it.pts.length === 1 ? 'clique' : 'cliques'} · classe ${it.classe}`;
  if (it.tipo === 'cronometro') return `${fmtTempo(segundosCrono(it))} ${it.t1 == null ? '(correndo)' : '(parado)'} · relógio ${it.relogio === 'video' ? 'do vídeo' : 'de parede'}`;
  if (it.tipo === 'trajetoria') {
    const v = velocidadePx(it);
    return `${it.pts.length} pontos · ${fmtComprimento(comprimentoPx(it))}${v != null ? ` · ${k ? (v * k / 1000).toFixed(2) + ' m/s' : v.toFixed(0) + ' px/s'}` : ''}${it.ativo ? ' · seguindo' : it.perdido ? ' · parou: ' + it.perdido : ''}`;
  }
  if (it.tipo === 'esqueleto') return `${it.pts.length}/17 pontos-chave (COCO)`;
  if (it.tipo === 'perspectiva') return `grade ${it.n || 8}×${it.n || 8}`;
  if (it.tipo === 'mascara' || (AREAS.has(it.tipo) && it.funcao === 'medida')) {
    const c = centroide(it);
    return `${fmtArea(areaPx(it))} · per. ${fmtComprimento(perimetroPx(it))} · centro ${Math.round(c[0] * vista.W)}, ${Math.round(c[1] * vista.H)} px`;
  }
  return null;
}

/** Botões por tipo na lista. */
export function AcoesItem({ it }) {
  const pare = (f) => (e) => { e.stopPropagation(); f(); };
  const bts = [];
  if (AREAS.has(it.tipo) || (LINHAS.has(it.tipo) && it.tipo !== 'distancia')) {
    bts.push(html`<button key="an" class="btn tiny" onClick=${pare(() => marcStore.set({ analise: it.id }))}>${AREAS.has(it.tipo) ? 'Histograma' : 'Perfil'}</button>`);
  }
  if (it.tipo === 'mascara') {
    bts.push(html`<button key="png" class="btn tiny" onClick=${pare(async () => {
      const b = await mascaraPNG(it);
      const url = URL.createObjectURL(b);
      const a = document.createElement('a'); a.href = url; a.download = `mascara-${it.nome}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    })}>Máscara PNG</button>`);
  }
  if (it.tipo === 'cronometro') {
    bts.push(html`<button key="cr" class="btn tiny" onClick=${pare(() => {
      const a = tempoAgora();
      if (it.t1 == null) atualizar(it.id, { t1: a.relogio === it.relogio ? a.t : it.t0 });
      else atualizar(it.id, { t0: a.t, t1: null, relogio: a.relogio });
    })}>${it.t1 == null ? 'Parar' : 'Recomeçar'}</button>`);
    if (it.t1 == null) {
      bts.push(html`<button key="vl" class="btn tiny" onClick=${pare(() => { const s = segundosCrono(it); atualizar(it.id, { voltas: [...(it.voltas || []), s].slice(-50) }); })}>Volta</button>`);
    }
    if (it.voltas && it.voltas.length) bts.push(html`<span key="vs" class="ferr-voltas">${it.voltas.map((v, i) => `${i + 1}: ${fmtTempo(v)}`).join(' · ')}</span>`);
  }
  if (it.tipo === 'trajetoria') {
    bts.push(html`<button key="tr" class="btn tiny" onClick=${pare(() => { soltarModelo(it.id); if (!it.ativo) iniciarTrajetoria(it.id, it.pts[it.pts.length - 1]); atualizar(it.id, { ativo: !it.ativo, perdido: null }); })}>${it.ativo ? 'Pausar' : 'Seguir'}</button>`);
    bts.push(html`<button key="tc" class="btn tiny" onClick=${pare(() => {
      const W = vista.W, H = vista.H, k = mmPorPx();
      const l = [`t_s;x_px;y_px${k ? ';x_mm;y_mm' : ''}`];
      it.pts.forEach((p, i) => l.push([(it.ts && it.ts[i] != null ? it.ts[i] - it.ts[0] : '').toString(), (p[0] * W).toFixed(2), (p[1] * H).toFixed(2), ...(k ? [(p[0] * W * k).toFixed(2), (p[1] * H * k).toFixed(2)] : [])].join(';')));
      baixar(`trajetoria-${it.nome}.csv`, l.join('\n'), 'text/csv');
    })}>CSV</button>`);
  }
  if (it.tipo === 'perspectiva') {
    bts.push(html`<label key="pn" onClick=${(e) => e.stopPropagation()}>divisões <input class="ferr-num" type="number" min="2" max="24" value=${it.n || 8}
      onChange=${(e) => atualizar(it.id, { n: Math.max(2, Math.min(24, +e.target.value || 8)) })} /></label>`);
  }
  if (it.tipo === 'esqueleto' && it.pts.length < 17) bts.push(html`<span key="ek" class="ferr-voltas">faltam: ${ESQUELETO.nomes.slice(it.pts.length).join(', ')}</span>`);
  return bts.length ? html`<div class="ferr-it-a">${bts}</div>` : null;
}

export { travar, definirGrupo };
