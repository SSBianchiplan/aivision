/**
 * components/industrial/EPIPanel.js — painel "Monitor de EPI" (CV-48, estágio 1 sem treino).
 *
 * O operador epi.monitor (pose RTMO → recortes de cabeça e tronco → MobileCLIP2,
 * votação por pessoa) mede; este painel mostra: pessoas agora com o estado de
 * capacete e colete, conformidade acumulada por zona (áreas "Zona de
 * contagem"), eventos de não conformidade e o caminho para o ESTÁGIO 2:
 * "Coletar amostra" (quadro com rosto borrado + caixas já rotuladas pela
 * votação) e "Enviar ao +Projeto" (projeto «EPI — estágio 2» com as classes
 * capacete / sem capacete / colete / sem colete), para revisar e treinar o
 * RF-DETR no Treinar.
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { canalEpi, COR_ESTADO, ROTULO_ITEM, NOME_PROJETO } from '../../cv/runtime/livres-q/canal.js';
import { carregarCss, pct, hm, carimbo, baixar } from './oee-comum.js';

const OP = 'epi.monitor';

/** Pose RTMO + epi.monitor no Pipeline (a pose antes). */
export function ativarEPI({ abrirPipeline = false } = {}) {
  let ns = store.get().nodes;
  if (!ns.some((n) => n.op === 'pose.rtmo')) {
    const i = ns.findIndex((n) => n.op === OP);
    const no = { id: newNodeId(), op: 'pose.rtmo', params: { ...defaultParams('pose.rtmo'), caixa: false }, enabled: true };
    ns = i >= 0 ? [...ns.slice(0, i), no, ...ns.slice(i)] : [...ns, no];
  } else ns = ns.map((n) => (n.op === 'pose.rtmo' ? { ...n, enabled: true } : n));
  const i = ns.findIndex((n) => n.op === OP);
  if (i >= 0) ns = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
  else ns = [...ns, { id: newNodeId(), op: OP, params: defaultParams(OP), enabled: true }];
  store.set(abrirPipeline ? { nodes: ns, panels: { ...store.get().panels, pipeline: true } } : { nodes: ns });
  persist();
}

const tag = (estado) => html`<span class="oep-tag" style=${{ background: COR_ESTADO[estado] }}>${estado}</span>`;

export function EPIPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const [r, setR] = useState(() => canalEpi.instantaneo());
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { carregarCss(); }, []);
  useEffect(() => canalEpi.assinar((x) => setR(x)), []);
  const msg = (t) => { setAviso(t); setTimeout(() => setAviso(''), 7000); };
  const vivo = canalEpi.recente(3000);
  const pessoas = r ? r.pessoas : [];
  const zonas = canalEpi.zonas();
  const evs = canalEpi.eventos().slice(0, 12);
  const nAm = canalEpi.amostras().length;
  const enviar = async () => {
    setEnviando(true);
    try { const n = await canalEpi.enviarAoProjeto(); msg(`${n} amostra(s) no +Projeto «${NOME_PROJETO}»: revise as caixas e treine.`); }
    catch (e) { msg('⚠ ' + e.message); }
    finally { setEnviando(false); }
  };

  return html`
    <${Panel} id="epi" title="EPI" subtitle=${vivo ? `${pessoas.length} pessoa(s) · ${pessoas.filter((p) => p.geral === 'não conforme').length} não conforme(s)` : 'capacete e colete'} onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">Capacete e colete por pessoa, sem treino: a pose recorta cabeça e tronco e o MobileCLIP2 decide por frases,
        com votação no tempo. Rostos borrados; nada sai do aparelho. Triagem — não substitui a fiscalização de NR-6.</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó EPI está desligado no Pipeline.</p>`}
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn ${no && no.enabled ? '' : 'accent'}" onClick=${() => { ativarEPI({ abrirPipeline: true }); msg('Pose RTMO + EPI no Pipeline.'); }}>
          ${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn" onClick=${() => { if (confirm('Zerar votos, zonas e eventos do EPI?')) { canalEpi.zerar(); msg('Sessão nova.'); } }}>Nova sessão</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: /^⚠/.test(aviso) ? 'var(--err)' : 'var(--ok)' }}>${aviso}</p>`}
      ${r && !r.modelos && html`<p class="hint tight">Carregando o MobileCLIP2 (≈ 110 MB na primeira vez, depois fica no aparelho)…</p>`}

      <div class="cfg-sub">Pessoas agora</div>
      <ul class="oep-lista">
        ${pessoas.length ? pessoas.map((p) => html`<li key=${p.id}><b>#${p.id}</b>
          <span>${p.zona} · ${Object.entries(p.itens).map(([k, d]) => `${ROTULO_ITEM[k]} ${d.estado}${d.frac != null ? ` (${Math.round(d.frac * 100)}%)` : ''}`).join(' · ')}</span>${tag(p.geral)}</li>`)
          : html`<li class="vazio">${vivo ? 'Ninguém no quadro.' : 'Sem medição.'}</li>`}
      </ul>

      <div class="cfg-sub">Conformidade por zona <small>(pessoa-tempo conforme ÷ decidido)</small></div>
      <table class="oep-zonas"><thead><tr><th>Zona</th><th>Conformidade</th><th>Pessoa-tempo</th><th>Máx.</th></tr></thead>
        <tbody>${zonas.length ? zonas.map((z) => html`<tr key=${z.zona}><td>${z.zona}</td><td class="num">${pct(z.pct, 0)}</td><td class="num">${hm(z.seg)}</td><td class="num">${z.pessoasMax}</td></tr>`)
          : html`<tr><td colspan="4">Sem dados. Zonas = áreas com a função «Zona de contagem».</td></tr>`}</tbody></table>

      <div class="cfg-sub">Eventos</div>
      <ul class="oep-lista">
        ${evs.length ? evs.map((e, i) => html`<li key=${i}><b>${new Date(e.ts).toLocaleTimeString('pt-BR')}</b><span>#${e.id} · ${e.zona} · ${e.evento} ${e.detalhe}</span><em></em></li>`)
          : html`<li class="vazio">Nenhuma não conformidade.</li>`}
      </ul>
      <button class="btn tiny" onClick=${() => baixar(canalEpi.eventosCSV(), `epi_${carimbo()}.csv`, 'text/csv')}>Eventos e zonas CSV</button>

      <div class="cfg-sub">Estágio 2 — detector treinado</div>
      <p class="hint tight">Junte quadros reais com as caixas já rotuladas pela votação e mande ao +Projeto; lá você revisa, salva no dataset e
        treina o RF-DETR no Treinar. Depois troque o CLIP pelo «Detector treinado livre» no Pipeline.</p>
      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap' }}>
        <button class="btn tiny" disabled=${!vivo} onClick=${() => canalEpi.coletar(1)}>Coletar amostra</button>
        <button class="btn tiny accent" disabled=${!nAm || enviando} onClick=${enviar}>${enviando ? 'Enviando…' : `Enviar ${nAm || ''} ao +Projeto`}</button>
        ${nAm > 0 && html`<button class="btn tiny" onClick=${() => canalEpi.descartarAmostras()}>Descartar</button>`}
      </div>
      <p class="hint tight">${canalEpi.status() || `${nAm} amostra(s) guardada(s) (no máximo 60, só nesta aba).`}</p>
    <//>
  `;
}

export default EPIPanel;
