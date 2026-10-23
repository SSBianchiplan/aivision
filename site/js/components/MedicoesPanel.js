/**
 * components/MedicoesPanel.js — painel «Medições»: o resumo dos operadores da
 * onda 1-a (CV-41..45 e o mapa de calor do CV-37), carregado sob demanda.
 *
 * Os operadores publicam em cv/runtime/livres-oa/canal.js; aqui só se lê
 * (no máximo 4×/s) e se exporta. Cada seção aparece quando o operador dela
 * está no Pipeline ou já publicou algo:
 *
 *   Tráfego          matriz de giro (origem × destino) por classe, blocos de 15 min, CSV
 *   Instrumentos     valor, tendência, alarmes ISA-18.2 (reconhecer), CSV
 *   Segurança        AVISO NR-12, cerca, queda/imobilidade, ponto de encontro, alarmes, CSV
 *   Fotocélula       tentativas com parciais e velocidade, CSV
 *   Mapa de calor    a grade, PNG e CSV
 *   Logística/mídia  chaves NF-e, pallets, tempo de tela
 *
 * Nada da imagem é guardado: só números.
 */
import { confirmar } from './dialogo.js';
import { html, useState, useEffect, useRef } from '../vendor.js';
import { Panel } from './Panel.js';
import { useStore, store } from '../state/store.js';
import { assinar, ler, zerar, csv, hora } from '../cv/runtime/livres-oa/canal.js';
import { matrizGiro, tabelaBlocos, CLASSES_CVC } from '../cv/operators/livres-oa/trafego.js';
import { alarmesInstrumentos } from '../cv/operators/livres-oa/mostrador.js';
import { alarmesSeguranca, AVISO_NR12 } from '../cv/operators/livres-oa/seguranca.js';
import { corCalor } from '../cv/operators/livres-oa/mapa-calor.js';
import { ROTULO_ESTADO } from '../cv/runtime/livres-oa/alarmes.js';
import { baixar } from '../cv/marcacoes.js';
import { secoesLivresS } from './medicoes-livres-s.js';   // onda 2-b (CV-60..67)
import { secoesOnda2a } from './medicoes-onda2a.js';   // CV-49..59 (onda 2-a)

function carregarCss() {
  if (document.querySelector('link[data-medicoes]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/medicoes.css' + (v ? '?' + v : '');
  l.setAttribute('data-medicoes', '');
  document.head.appendChild(l);
}

const carimbo = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const fmt = (v, c = 1) => (Number.isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');
const temNo = (nodes, pref) => nodes.some((n) => n.enabled !== false && pref.some((p) => String(n.op).startsWith(p)));

export function MedicoesPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const [, setV] = useState(0);
  useEffect(() => { carregarCss(); return assinar(() => setV((n) => n + 1)); }, []);
  const tem = (key, pref) => Boolean(ler(key)) || temNo(nodes, pref);
  const secoes = [
    tem('trafego', ['trafego.']) && html`<${SecaoTrafego} key="t" />`,
    (tem('mostrador', ['instrumento.']) || ler('display7')) && html`<${SecaoInstrumentos} key="i" />`,
    (tem('cerca', ['seguranca.cerca', 'seguranca.queda', 'seguranca.ponto_encontro']) || ler('queda') || ler('encontro')) && html`<${SecaoSeguranca} key="s" />`,
    tem('sprint', ['esportes.sprint']) && html`<${SecaoSprint} key="sp" />`,
    tem('mapa_calor', ['cena.mapa_calor']) && html`<${SecaoCalor} key="c" />`,
    (tem('etiquetas', ['logistica.etiqueta'])) && html`<${SecaoEtiquetas} key="e" />`,
    (tem('pallets', ['logistica.pallet'])) && html`<${SecaoPallets} key="p" />`,
    (tem('tempo_tela', ['midia.tempo_tela'])) && html`<${SecaoTempoTela} key="tt" />`,
    ...secoesLivresS(tem),
    ...secoesOnda2a(tem),
  ].filter(Boolean);
  return html`
    <${Panel} id="medicoes" title="Medições" subtitle=${secoes.length ? `${secoes.length} em uso` : 'tráfego, instrumentos, segurança, sprint…'} onClose=${onClose} ...${layout}>
      ${!secoes.length && html`<p class="hint tight">Resumo e CSV dos operadores de contagem classificada (CVC), mostrador e display,
        cerca e queda por pose, fotocélula, mapa de calor, etiqueta NF-e, pallets e tempo de tela. Carregue um preset em
        <b>Pipeline</b> (grupos Trânsito, Varejo, Segurança do trabalho, Logística, Industrial, Esportes).</p>`}
      ${secoes}
    <//>
  `;
}

function Cab({ titulo, children }) {
  return html`<div class="cfg-sub med-cab"><span>${titulo}</span><span class="med-acoes">${children}</span></div>`;
}

// ------------------------------------------------------------------ Tráfego

function SecaoTrafego() {
  const d = ler('trafego');
  const [classe, setClasse] = useState('');
  if (!d) return html`<${Cab} titulo="Tráfego (CVC)" /><p class="hint tight">Aguardando: desenhe uma zona por braço da interseção (ou uma linha) e dê play.</p>`;
  const M = matrizGiro(d.movimentos, classe || null);
  const blocos = tabelaBlocos(d);
  const classes = [...CLASSES_CVC, ...(d.porClasse.outros != null ? ['outros'] : [])];
  const baixarBlocos = () => baixar(`cvc_${carimbo()}_blocos.csv`, csv(['bloco_inicio', 'bloco_fim', 'origem_ou_linha', 'destino_ou_sentido', ...classes, 'total'],
    blocos.map((r) => [r.ini, r.fim, r.origem, r.destino, ...classes.map((c) => r.c[c] || 0), Object.values(r.c).reduce((a, b) => a + b, 0)])), 'text/csv');
  const baixarMov = () => baixar(`cvc_${carimbo()}_movimentos.csv`, csv(['instante', 'bloco', 'origem', 'destino', 'classe', 'id'],
    d.movimentos.map((m) => [hora(m.t, d.relogio), m.bloco, m.origem, m.destino, m.classe, m.id])), 'text/csv');
  return html`
    <${Cab} titulo="Tráfego (CVC)">
      <button class="btn tiny" onClick=${baixarBlocos} title="Contagem por bloco × movimento × classe">CSV blocos</button>
      <button class="btn tiny" onClick=${baixarMov} title="Um registro por veículo/pedestre">CSV eventos</button>
      <button class="btn tiny" onClick=${async () => (await confirmar('Zerar a contagem?', { titulo: 'Zerar contagem', ok: 'Zerar', perigo: true })) && zerar('trafego')}>Zerar</button>
    <//>
    <div class="kpis med-kpis">${classes.map((c) => html`<div class="kpi" key=${c}><b>${d.porClasse[c] || 0}</b><em>${c}</em></div>`)}</div>
    <p class="hint tight">${d.movimentos.length} movimentos · ${d.emCurso} em curso · ${d.incompletos} sem destino · blocos de ${d.blocoMin} min</p>
    <label class="med-sel">Matriz de giro:
      <select value=${classe} onChange=${(e) => setClasse(e.target.value)}>
        <option value="">todas as classes</option>${classes.map((c) => html`<option value=${c}>${c}</option>`)}
      </select></label>
    ${M.origens.length ? html`
      <div class="med-tab"><table>
        <thead><tr><th>origem ↓ / destino →</th>${M.destinos.map((x) => html`<th>${x}</th>`)}<th>Σ</th></tr></thead>
        <tbody>${M.origens.map((o) => {
          const tot = M.destinos.reduce((s, x) => s + (M.m[o + '→' + x] || 0), 0);
          return html`<tr><th>${o}</th>${M.destinos.map((x) => html`<td class=${M.m[o + '→' + x] ? 'v' : 'v z'}>${M.m[o + '→' + x] || 0}</td>`)}<td class="v s">${tot}</td></tr>`;
        })}</tbody>
      </table></div>` : html`<p class="hint tight">Nenhum movimento completo ainda (origem e destino).</p>`}
    ${blocos.length > 0 && html`
      <div class="med-tab"><table>
        <thead><tr><th>bloco</th><th>movimento</th>${CLASSES_CVC.map((c) => html`<th title=${c}>${c.slice(0, 4)}</th>`)}</tr></thead>
        <tbody>${blocos.slice(-12).map((r) => html`<tr><td>${r.ini}</td><td>${r.linha ? `${r.origem} (${r.destino})` : `${r.origem}→${r.destino}`}</td>
          ${CLASSES_CVC.map((c) => html`<td class="v">${r.c[c] || 0}</td>`)}</tr>`)}</tbody>
      </table></div>`}
  `;
}

// ------------------------------------------------------------------ alarmes (instrumentos e segurança)

function ListaAlarmes({ motor, vazio }) {
  const r = motor.resumo();
  return html`
    ${r.pendentes.length ? html`<ul class="med-al">${r.pendentes.map((a) => html`
      <li key=${a.tag} class=${`p${a.prio} ${a.estado === 'ATIVO_NR' || a.estado === 'RTN_NR' ? 'nr' : ''}`}>
        <b>${a.tag}</b> ${a.texto}<em>${ROTULO_ESTADO[a.estado]}</em></li>`)}</ul>` : html`<p class="hint tight">${vazio}</p>`}
  `;
}

function Sparkline({ hist, min, max }) {
  if (!hist || hist.length < 2) return null;
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0] || t0 + 1;
  let lo = Number.isFinite(min) ? min : Math.min(...hist.map((x) => x[1])), hi = Number.isFinite(max) ? max : Math.max(...hist.map((x) => x[1]));
  if (hi === lo) { hi += 1; lo -= 1; }
  const W = 240, H = 40;
  const pts = hist.map(([t, v]) => `${(((t - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ');
  return html`<svg class="med-spark" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><polyline points=${pts} /></svg>`;
}

function SecaoInstrumentos() {
  const m = ler('mostrador'), d7 = ler('display7');
  const itens = [...(m ? m.itens : []), ...(d7 ? d7.itens : [])];
  const motor = alarmesInstrumentos();
  const baixarHist = () => baixar(`instrumentos_${carimbo()}.csv`, csv(['instrumento', 'tipo', 'instante_s', 'valor', 'unidade'],
    itens.flatMap((it) => it.hist.map(([t, v]) => [it.nome, it.tipo, t.toFixed(3), v, it.unidade]))), 'text/csv');
  const baixarLog = () => baixar(`instrumentos_${carimbo()}_alarmes.csv`, csv(['instante_s', 'tag', 'evento', 'valor', 'prioridade', 'texto'],
    motor.log.map((l) => [Number.isFinite(l.t) ? l.t.toFixed(2) : '', l.tag, l.evento, Number.isFinite(l.valor) ? l.valor : '', l.prio, l.texto])), 'text/csv');
  return html`
    <${Cab} titulo="Instrumentos">
      <button class="btn tiny" onClick=${baixarHist}>CSV leituras</button>
      <button class="btn tiny" onClick=${baixarLog}>CSV alarmes</button>
      <button class="btn tiny" onClick=${() => { zerar('mostrador'); zerar('display7'); }}>Zerar</button>
    <//>
    ${!itens.length && html`<p class="hint tight">Marque o mostrador com a ferramenta <b>Ângulo</b> (zero → centro → fundo) e a função
      <b>Instrumento · mostrador</b>; o display com uma área <b>Instrumento · display 7 seg.</b></p>`}
    ${itens.map((it) => html`
      <div class="med-instr" key=${it.id}>
        <div class="med-instr-v"><b class=${it.incerto ? 'warn' : ''}>${it.tipo === 'mostrador' ? fmt(it.valor, it.casas) : Number.isFinite(it.valor) ? String(it.valor).replace('.', ',') : '—'}</b>
          <em>${it.unidade}</em></div>
        <div class="med-instr-n">${it.nome}${it.incerto ? ' · leitura incerta' : ''}${it.fora > 0 ? ' · acima do fundo' : it.fora < 0 ? ' · abaixo do zero' : ''}</div>
        <${Sparkline} hist=${it.hist} min=${it.min} max=${it.max} />
      </div>`)}
    <${Cab} titulo="Alarmes (ISA-18.2)">
      <button class="btn tiny" onClick=${() => { motor.reconhecer(); }}>Reconhecer</button>
    <//>
    <${ListaAlarmes} motor=${motor} vazio="Nenhum alarme. Configure os limites no nó (ex.: HH 9; H 8; L 1)." />
  `;
}

// ------------------------------------------------------------------ Segurança

function SecaoSeguranca() {
  const c = ler('cerca'), q = ler('queda'), e = ler('encontro');
  const motor = alarmesSeguranca();
  const baixarLog = () => baixar(`seguranca_${carimbo()}_eventos.csv`, csv(['instante_s', 'tag', 'evento', 'prioridade', 'texto'],
    motor.log.map((l) => [Number.isFinite(l.t) ? l.t.toFixed(2) : '', l.tag, l.evento, l.prio, l.texto])), 'text/csv');
  return html`
    <${Cab} titulo="Segurança (indicador de gestão)">
      <button class="btn tiny" onClick=${baixarLog}>CSV eventos</button>
      <button class="btn tiny" onClick=${() => { zerar('cerca'); zerar('queda'); zerar('encontro'); }}>Zerar</button>
    <//>
    <p class="med-aviso" role="note">⚠ ${AVISO_NR12}</p>
    ${e && html`<div class=${`med-encontro ${e.faltam ? 'falta' : 'ok'}`}><b>${e.presentes}</b> de ${e.meta} no ponto de encontro
      ${e.faltam ? html` — <strong>faltam ${e.faltam}</strong>` : ' — todos presentes'}</div>`}
    ${c && html`<p class="hint tight">Cerca: ${c.zonas} zona(s) proibida(s) · ${c.invasoes || 0} invasão(ões) · ${c.ativas || 0} ativa(s) agora</p>`}
    ${q && html`<p class="hint tight">Queda: ${q.pessoas.length} pessoa(s) observada(s) · ${q.quedas} queda(s)
      ${q.pessoas.length ? ' · ' + q.pessoas.map((p) => `${p.id}: ${p.estado}${p.imovel ? ' (imóvel)' : ''}`).join(' · ') : ''}</p>`}
    <${Cab} titulo="Alarmes (ISA-18.2)">
      <button class="btn tiny" onClick=${() => motor.reconhecer()}>Reconhecer</button>
    <//>
    <${ListaAlarmes} motor=${motor} vazio="Nenhum alarme." />
    ${motor.log.length > 0 && html`<ul class="med-log">${motor.log.slice(-8).reverse().map((l, i) => html`<li key=${i}><b>${l.tag}</b> ${l.evento}</li>`)}</ul>`}
  `;
}

// ------------------------------------------------------------------ Fotocélula

function SecaoSprint() {
  const d = ler('sprint');
  const tent = d ? d.tentativas : [];
  const baixarCsv = () => baixar(`fotocelula_${carimbo()}.csv`, csv(['tentativa', 'pessoa', 'modo', 'linha', 'tempo_s', 'parcial_s', 'distancia_m', 'velocidade_m_s', 'velocidade_km_h'],
    tent.flatMap((r, i) => r.parciais.map((p) => [i + 1, r.id, r.modo, p.nome, p.t.toFixed(3), p.dt.toFixed(3), p.dist != null ? p.dist.toFixed(2) : '',
      p.v != null ? p.v.toFixed(2) : '', p.v != null ? (p.v * 3.6).toFixed(1) : '']))), 'text/csv');
  return html`
    <${Cab} titulo="Fotocélula">
      <button class="btn tiny" onClick=${baixarCsv} disabled=${!tent.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('sprint')}>Zerar</button>
    <//>
    ${d && Array.isArray(d.linhas) && html`<p class="hint tight">Linhas: ${d.linhas.join(' → ')}${d.distancias ? ` · ${d.distancias.map((x) => fmt(x, 1)).join(' / ')} m` : ' · sem distâncias (velocidade desligada)'}
      ${d.emCurso && d.emCurso.length ? html` · <b>correndo: ${d.emCurso.map((x) => `${x.id} ${fmt(x.decorrido, 2)} s`).join(', ')}</b>` : ''}</p>`}
    ${d && !Array.isArray(d.linhas) && html`<p class="hint tight">Desenhe 2 ou mais linhas com a função <b>Esportes · fotocélula</b>.</p>`}
    ${tent.length ? html`<div class="med-tab"><table>
      <thead><tr><th>#</th><th>total (s)</th><th>parciais</th><th>v máx</th></tr></thead>
      <tbody>${tent.slice(-10).reverse().map((r, i) => html`<tr key=${i}><td>${tent.length - i}</td><td class="v s">${fmt(r.total, 3)}</td>
        <td>${r.parciais.map((p) => `${p.nome} ${fmt(p.t, 3)}${p.v != null ? ` (${fmt(p.v * 3.6, 1)} km/h)` : ''}`).join(' · ')}</td>
        <td class="v">${r.vMax != null ? fmt(r.vMax * 3.6, 1) + ' km/h' : '—'}</td></tr>`)}</tbody>
    </table></div>` : html`<p class="hint tight">Nenhuma tentativa completa ainda.</p>`}
  `;
}

// ------------------------------------------------------------------ Mapa de calor

function SecaoCalor() {
  const d = ler('mapa_calor');
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !d) return;
    cv.width = d.gx; cv.height = d.gy;
    const g = cv.getContext('2d'), im = g.createImageData(d.gx, d.gy);
    for (let i = 0; i < d.m.length; i++) {
      const c = corCalor(d.max ? Math.sqrt(d.m[i] / d.max) : 0);
      im.data[i * 4] = c[0]; im.data[i * 4 + 1] = c[1]; im.data[i * 4 + 2] = c[2]; im.data[i * 4 + 3] = Math.round(40 + c[3] * 215);
    }
    g.putImageData(im, 0, 0);
  });
  const baixarPng = () => {
    const cv = ref.current; if (!cv) return;
    const big = document.createElement('canvas');
    big.width = d.w; big.height = d.h;
    const g = big.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(cv, 0, 0, d.w, d.h);
    big.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `mapa_calor_${carimbo()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
  };
  const baixarCsv = () => {
    const linhas = [];
    for (let y = 0; y < d.gy; y++) linhas.push(Array.from(d.m.slice(y * d.gx, (y + 1) * d.gx), (v) => v.toFixed(2)));
    baixar(`mapa_calor_${carimbo()}.csv`, csv(Array.from({ length: d.gx }, (_, i) => `c${i}`), linhas), 'text/csv');
  };
  return html`
    <${Cab} titulo="Mapa de calor">
      <button class="btn tiny" onClick=${baixarPng} disabled=${!d}>PNG</button>
      <button class="btn tiny" onClick=${baixarCsv} disabled=${!d}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('mapa_calor')}>Zerar</button>
    <//>
    ${d ? html`<canvas ref=${ref} class="med-calor" aria-label="Mapa de calor"></canvas>
      <p class="hint tight">Máximo ${fmt(d.max, 1)} s numa célula · ${fmt(d.total / 60, 1)} min·pessoa acumulados.</p>`
      : html`<p class="hint tight">Aguardando objetos.</p>`}
  `;
}

// ------------------------------------------------------------------ Logística e mídia

const grupos4 = (k) => k.replace(/(\d{4})(?=\d)/g, '$1 ');

function SecaoEtiquetas() {
  const d = ler('etiquetas');
  const l = d ? d.lidas : [];
  const baixarCsv = () => baixar(`etiquetas_${carimbo()}.csv`, csv(['tipo', 'codigo', 'valida', 'modelo', 'uf', 'mes', 'emitente', 'serie', 'numero', 'origem', 'vezes', 'primeira'],
    l.map((x) => [x.tipo, x.chave || x.codigo, x.valida ?? x.valido, x.modelo || '', x.uf || '', x.aamm || '', x.emitente || '', x.serie ?? '', x.numero ?? '', x.origem, x.vezes, x.primeira])), 'text/csv');
  return html`
    <${Cab} titulo="Etiquetas e chaves NF-e">
      <button class="btn tiny" onClick=${baixarCsv} disabled=${!l.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('etiquetas')}>Zerar</button>
    <//>
    ${l.length ? html`<ul class="med-lista">${l.slice(-12).reverse().map((x) => html`<li key=${x.chave || x.codigo} class=${(x.valida ?? x.valido) ? 'ok' : 'nok'}>
      ${x.tipo === 'chave' ? html`<b>${x.modelo} ${x.valida ? '✓' : '✗'}</b> ${x.uf} · ${x.aamm} · série ${x.serie} · nº ${x.numero}${x.emitenteOk ? '' : ' · emitente não confere'}
        <code>${grupos4(x.chave)}</code>` : html`<b>Correios ✓</b> <code>${x.codigo}</code>`}</li>`)}</ul>`
      : html`<p class="hint tight">Aponte para o código de barras do DANFE ou para a chave impressa.${d && d.cep ? ` CEP lido: ${d.cep}.` : ''}</p>`}
  `;
}

function SecaoPallets() {
  const d = ler('pallets');
  const l = d ? d.pallets : [];
  const baixarCsv = () => baixar(`pallets_${carimbo()}.csv`, csv(['codigo', 'local', 'desde', 'em_vista', 'historico'],
    l.map((x) => [x.codigo, x.local, hora(x.desde, d.relogio), x.emVista ? 'sim' : 'não', x.historico.map((h) => `${h.local}@${hora(h.t, d.relogio)}`).join(' > ')])), 'text/csv');
  return html`
    <${Cab} titulo="Pallets">
      <button class="btn tiny" onClick=${baixarCsv} disabled=${!l.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('pallets')}>Zerar</button>
    <//>
    ${l.length ? html`<div class="med-tab"><table><thead><tr><th>código</th><th>local</th><th>desde</th></tr></thead>
      <tbody>${l.slice(-30).map((x) => html`<tr key=${x.codigo} class=${x.emVista ? '' : 'fora'}><td><code>${x.codigo.slice(0, 28)}</code></td><td>${x.local}</td><td>${hora(x.desde, d.relogio)}</td></tr>`)}</tbody>
    </table></div><p class="hint tight">${d.movimentos} movimentação(ões).</p>` : html`<p class="hint tight">Nenhum código lido ainda.</p>`}
  `;
}

function SecaoTempoTela() {
  const d = ler('tempo_tela');
  const l = d ? d.itens : [];
  return html`
    <${Cab} titulo="Tempo de tela">
      <button class="btn tiny" onClick=${() => zerar('tempo_tela')}>Zerar</button>
    <//>
    ${l.length ? html`<div class="med-tab"><table><thead><tr><th>marca</th><th>em tela</th><th>%</th><th>exp.</th><th>maior</th></tr></thead>
      <tbody>${l.map((x) => html`<tr key=${x.nome}><td>${x.agora ? '● ' : ''}${x.nome}</td><td class="v">${fmt(x.tela, 1)} s</td><td class="v">${fmt(x.pct * 100, 0)}</td>
        <td class="v">${x.exp}</td><td class="v">${fmt(x.maior, 1)} s</td></tr>`)}</tbody></table></div>
      <p class="hint tight">De ${fmt(d.total, 1)} s observados.</p>` : html`<p class="hint tight">Desenhe a área do logo (função <b>Inspect · presença</b>) com o logo visível.</p>`}
  `;
}

export default MedicoesPanel;
