/**
 * components/medicoes-onda2a.js — seções do painel «Medições» para os
 * operadores da onda 2-a (CV-49..59, grupo livres-r). O MedicoesPanel chama
 * secoesOnda2a(tem) e põe as seções junto das dele; cada uma aparece quando
 * o operador está no Pipeline ou já publicou algo.
 *
 * Só números e textos: nada da imagem é guardado (o mapa de fissuras é
 * redesenhado a partir dos pontos medidos).
 */
import { html, useState } from '../vendor.js';
import { store, persist } from '../state/store.js';
import { ler, zerar, csv, hora } from '../cv/runtime/livres-oa/canal.js';
import { ROTULO_ESTADO } from '../cv/runtime/livres-oa/alarmes.js';
import { baixar } from '../cv/marcacoes.js';
import { comandar } from '../cv/operators/livres-r/comum.js';
import { alarmesPoka } from '../cv/operators/livres-r/pokayoke.js';
import { alarmesDe, AVISO_RINGELMANN } from '../cv/operators/livres-r/processo.js';
import { AVISO_BAU } from '../cv/operators/livres-r/bau.js';
import { COR_ABERTURA } from '../cv/runtime/livres-r/imagem.js';

const carimbo = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const fmt = (v, c = 1) => (Number.isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');
const n3 = (v, c = 3) => (Number.isFinite(v) ? +v.toFixed(c) : '');

function Cab({ titulo, children }) {
  return html`<div class="cfg-sub med-cab"><span>${titulo}</span><span class="med-acoes">${children}</span></div>`;
}
function Kpis({ itens }) {
  return html`<div class="kpis med-kpis">${itens.map(([v, r]) => html`<div class="kpi" key=${r}><b>${v}</b><em>${r}</em></div>`)}</div>`;
}
function Spark({ hist, min, max }) {
  if (!hist || hist.length < 2) return null;
  const t0 = hist[0][0], t1 = hist[hist.length - 1][0] || t0 + 1;
  const vs = hist.map((x) => x[1]).filter(Number.isFinite);
  if (!vs.length) return null;
  let lo = Number.isFinite(min) ? min : Math.min(...vs), hi = Number.isFinite(max) ? max : Math.max(...vs);
  if (hi === lo) { hi += 1; lo -= 1; }
  const W = 240, H = 40;
  const pts = hist.filter((x) => Number.isFinite(x[1])).map(([t, v]) => `${(((t - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - ((v - lo) / (hi - lo)) * H).toFixed(1)}`).join(' ');
  return html`<svg class="med-spark" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><polyline points=${pts} /></svg>`;
}
function Alarmes({ resumo, motor, chave, vazio = 'Nenhum alarme.' }) {
  if (!resumo) return null;
  const rec = () => { if (motor) motor.reconhecer(); if (chave) comandar(chave, { acao: 'reconhecer' }); };
  return html`
    <${Cab} titulo="Alarmes (ISA-18.2)"><button class="btn tiny" onClick=${rec}>Reconhecer</button><//>
    ${resumo.pendentes.length ? html`<ul class="med-al">${resumo.pendentes.map((a) => html`
      <li key=${a.tag} class=${`p${a.prio} ${a.estado === 'ATIVO_NR' || a.estado === 'RTN_NR' ? 'nr' : ''}`}>
        <b>${a.tag}</b> ${a.texto}<em>${ROTULO_ESTADO[a.estado]}</em></li>`)}</ul>` : html`<p class="hint tight">${vazio}</p>`}
  `;
}
const csvAlarmes = (nome, motor) => baixar(`${nome}_${carimbo()}_alarmes.csv`, csv(['instante_s', 'tag', 'evento', 'valor', 'prioridade', 'texto'],
  motor.log.map((l) => [Number.isFinite(l.t) ? l.t.toFixed(2) : '', l.tag, l.evento, Number.isFinite(l.valor) ? l.valor : '', l.prio, l.texto])), 'text/csv');

/** Muda parâmetros do nó `op` no Pipeline (o painel da doca escreve a ordem e o esperado). */
function mudarParams(op, patch) {
  const nodes = store.get().nodes.map((n) => (n.op === op ? { ...n, params: { ...n.params, ...patch } } : n));
  store.set({ nodes });
  persist();
}
const paramsDe = (op) => { const n = (store.get().nodes || []).find((x) => x.op === op); return (n && n.params) || {}; };

// ------------------------------------------------------------------ CV-49 poka-yoke

function SecaoPoka() {
  const d = ler('r.pokayoke');
  const motor = alarmesPoka();
  if (!d) return html`<${Cab} titulo="Poka-yoke de montagem" /><p class="hint tight">Aguardando: uma área "Poka-yoke · caixa" por caixa de peça e Mãos e gestos antes.</p>`;
  const r = d.resumo || {};
  const csvCiclos = () => baixar(`pokayoke_${carimbo()}_ciclos.csv`, csv(['ciclo', 'inicio', 'fim', 'tempo_s', 'completo', 'ok', 'desvios', 'tempos_dos_passos_s'],
    d.ciclos.map((c) => [c.n, hora(c.inicio, d.relogio), hora(c.fim, d.relogio), n3(c.tempo, 2), c.completo ? 'sim' : 'não', c.ok ? 'OK' : 'NOK', c.desvios,
      c.passos.map((x) => (Number.isFinite(x) ? x.toFixed(2) : 'pulado')).join(' | ')])), 'text/csv');
  const csvDesvios = () => baixar(`pokayoke_${carimbo()}_desvios.csv`, csv(['instante', 'ciclo', 'tipo', 'esperado', 'pegou', 'texto'],
    d.desvios.map((x) => [hora(x.t, d.relogio), x.ciclo, x.tipo, x.esperado, x.pegou, x.texto])), 'text/csv');
  return html`
    <${Cab} titulo="Poka-yoke de montagem">
      <button class="btn tiny" onClick=${csvCiclos}>CSV ciclos</button>
      <button class="btn tiny" onClick=${csvDesvios}>CSV desvios</button>
      <button class="btn tiny" onClick=${() => comandar('r.pokayoke', { acao: 'reiniciar_ciclo' })} title="Volta o ciclo atual ao 1º passo">Reiniciar ciclo</button>
      <button class="btn tiny" onClick=${() => confirm('Zerar ciclos e desvios?') && zerar('r.pokayoke')}>Zerar</button>
    <//>
    ${d.desvioAtivo && html`<p class="med-aviso" role="alert">DESVIO: ${d.desvioAtivo.texto}</p>`}
    <${Kpis} itens=${[[r.ciclos || 0, 'ciclos'], [r.ok || 0, 'OK'], [r.nok || 0, 'NOK'], [Number.isFinite(r.fpy) ? fmt(100 * r.fpy, 0) + '%' : '—', 'FPY'],
                     [fmt(r.tMediano, 1) + ' s', 'ciclo mediano'], [r.desvios || 0, 'desvios']]} />
    ${d.passos && d.passos.length > 0 && html`<ol class="med-lista">${d.passos.map((p, i) => html`
      <li key=${i} class=${i < d.i ? 'ok' : ''}>${i === d.i ? '▶ ' : ''}${p.zona}${p.vezes > 1 ? ` ×${p.vezes}` : ''}${p.existe === false ? ' (sem área com esse nome!)' : ''}
        ${i === d.i && p.vezes > 1 ? ` — ${d.c}/${p.vezes}` : ''}</li>`)}
      ${d.fim && html`<li class=${d.i >= d.passos.length ? '' : ''}>${d.i >= d.passos.length ? '▶ ' : ''}concluir em ${d.fim}</li>`}</ol>`}
    ${d.fonte === null && html`<p class="hint tight">Sem mãos na cadeia: ponha "Mãos e gestos" (ou a pose RTMO) antes.</p>`}
    ${d.desvios.length > 0 && html`<div class="med-tab"><table><thead><tr><th>hora</th><th>ciclo</th><th>desvio</th></tr></thead>
      <tbody>${d.desvios.slice(-8).reverse().map((x, i) => html`<tr key=${i}><td>${hora(x.t, d.relogio)}</td><td class="v">${x.ciclo}</td><td>${x.texto}</td></tr>`)}</tbody></table></div>`}
    <${Alarmes} resumo=${d.alarmes} motor=${motor} />
  `;
}

// ------------------------------------------------------------------ CV-50 cubagem

function SecaoCubagem() {
  const d = ler('r.cubagem');
  if (!d) return html`<${Cab} titulo="Cubagem na esteira" /><p class="hint tight">Aguardando o laser.</p>`;
  const cx = d.caixas || [];
  const vol = cx.reduce((a, c) => a + c.volume, 0), kg = cx.reduce((a, c) => a + c.pesoCubado, 0);
  const baixarCsv = () => baixar(`cubagem_${carimbo()}.csv`, csv(['caixa', 'inicio', 'comprimento_mm', 'largura_mm', 'altura_mm', 'volume_m3', 'peso_cubado_kg', 'fonte_comprimento',
    'altura_max_mm', 'largura_laser_mm', 'comprimento_velocidade_mm', 'quadros', 'codigo'],
    cx.map((c) => [c.n, hora(c.t0, d.relogio), n3(c.comprimento, 1), n3(c.largura, 1), n3(c.altura, 1), n3(c.volume, 5), n3(c.pesoCubado, 2), c.fonteComp,
      n3(c.altMax, 1), n3(c.largLaser, 1), n3(c.compVel, 1), c.quadros, c.codigo || ''])), 'text/csv');
  return html`
    <${Cab} titulo="Cubagem na esteira (laser)">
      <button class="btn tiny" onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => comandar('r.cubagem', { acao: 'referencia' })} title="Com a esteira vazia">Refazer referência</button>
      <button class="btn tiny" onClick=${() => confirm('Zerar as caixas?') && zerar('r.cubagem')}>Zerar</button>
    <//>
    ${d.aprendendo ? html`<p class="hint tight">Aprendendo a esteira vazia: ${d.refN}/${d.refQuadros} quadros.</p>`
      : d.atual ? html`<p class="hint tight">Sob o laser: altura ${fmt(d.atual.alt, 0)} mm × largura ${fmt(d.atual.larg, 0)} mm</p>` : html`<p class="hint tight">Esteira livre.</p>`}
    <${Kpis} itens=${[[cx.length, 'caixas'], [fmt(vol, 3), 'm³'], [fmt(kg, 1), `kg cubados (${d.fator} kg/m³)`]]} />
    ${cx.length > 0 && html`<div class="med-tab"><table><thead><tr><th>#</th><th>C × L × A (mm)</th><th>m³</th><th>kg cub.</th><th>código</th></tr></thead>
      <tbody>${cx.slice(-12).reverse().map((c) => html`<tr key=${c.n}><td class="v">${c.n}</td>
        <td>${fmt(c.comprimento, 0)} × ${fmt(c.largura, 0)} × ${fmt(c.altura, 0)}${c.fonteComp === 'vista' ? ' ◰' : ''}</td><td class="v">${fmt(c.volume, 4)}</td>
        <td class="v">${fmt(c.pesoCubado, 1)}</td><td><code>${c.codigo || ''}</code></td></tr>`)}</tbody></table></div>`}
  `;
}

function SecaoCubFoto() {
  const d = ler('r.cubfoto');
  if (!d) return html`<${Cab} titulo="Cubagem por foto" /><p class="hint tight">Aguardando.</p>`;
  const V = d.vistas || {};
  const R = d.resultado;
  return html`
    <${Cab} titulo="Cubagem por foto (2 vistas)">
      <button class="btn tiny" onClick=${() => comandar('r.cubfoto', { acao: 'limpar' })}>Limpar vistas</button>
    <//>
    ${!d.calibrado && html`<p class="hint tight">Calibre a régua (Ferramentas de mouse → régua → medida conhecida) no plano da face.</p>`}
    ${!d.faces.length ? html`<p class="hint tight">Contorne a face com uma área (ou o clique do SAM) com a função "Cubagem · face".</p>`
      : html`<div class="med-tab"><table><thead><tr><th>face</th><th>lados</th><th></th></tr></thead><tbody>${d.faces.map((f) => html`
        <tr key=${f.id}><td>${f.nome}</td><td>${fmt(f.comp, 1)} × ${fmt(f.larg, 1)} ${f.unidade}</td><td>
          <button class="btn tiny" onClick=${() => comandar('r.cubfoto', { acao: 'gravar', papel: 'topo', id: f.id })}>Topo</button>
          <button class="btn tiny" onClick=${() => comandar('r.cubfoto', { acao: 'gravar', papel: 'lateral', id: f.id })}>Lateral</button></td></tr>`)}</tbody></table></div>`}
    <p class="hint tight">Topo: ${V.topo ? `${fmt(V.topo.comp, 1)} × ${fmt(V.topo.larg, 1)} ${V.topo.unidade}` : '—'} · Lateral: ${V.lateral ? `${fmt(V.lateral.comp, 1)} × ${fmt(V.lateral.larg, 1)} ${V.lateral.unidade}` : '—'}</p>
    ${R && html`<${Kpis} itens=${[[`${fmt(R.comprimento, 0)} × ${fmt(R.largura, 0)} × ${fmt(R.altura, 0)}`, 'C × L × A (mm)'], [fmt(R.volume, 4), 'm³'], [fmt(R.pesoCubado, 1), 'kg cubados']]} />
      <p class="hint tight">Conferência: o lado comum da lateral mede ${fmt(R.conferencia, 0)} mm (topo: ${fmt(R.comprimento, 0)} / ${fmt(R.largura, 0)}).</p>`}
  `;
}

// ------------------------------------------------------------------ CV-51 doca

function SecaoDoca() {
  const d = ler('r.doca');
  const P = paramsDe('doca.conferencia');
  const [form, setForm] = useState(null);
  const f = form || { ordem: P.ordem || '', tipo: P.tipo || 'recebimento', volumes: P.volumes ?? -1, pallets: P.pallets ?? -1, codigos: P.codigos || '' };
  const aplicar = () => { mudarParams('doca.conferencia', { ...f, volumes: Number(f.volumes), pallets: Number(f.pallets) }); setForm(null); };
  const c = d && d.conferencia;
  const baixarEv = () => baixar(`doca_${carimbo()}_eventos.csv`, csv(['instante', 'ordem', 'linha', 'sentido', 'tipo', 'classe', 'id'],
    (d.eventos || []).map((e) => [hora(e.t, d.relogio), d.sessao.ordem, e.linha, e.sentido, e.tipo, e.classe, e.id])), 'text/csv');
  const baixarHist = () => baixar(`doca_${carimbo()}_conferencias.csv`, csv(['ordem', 'tipo', 'inicio', 'fim', 'volumes_liquidos', 'pallets_liquidos', 'dif_volumes', 'dif_pallets',
    'codigos_lidos', 'codigos_faltando', 'codigos_sobrando', 'resultado', 'motivo'],
    (d.historico || []).map((h) => [h.ordem, h.tipo, hora(h.inicio, d.relogio), hora(h.fim, d.relogio), h.conferencia.liquido.volume, h.conferencia.liquido.pallet,
      h.conferencia.difVolumes ?? '', h.conferencia.difPallets ?? '', h.codigos.length, h.conferencia.faltam.join(' '), h.conferencia.sobram.join(' '),
      !h.conferencia.conferido ? 'sem esperado' : h.conferencia.ok ? 'confere' : 'divergente', h.motivo])), 'text/csv');
  const dif = (v) => (v == null ? '—' : v === 0 ? 'ok' : v > 0 ? `sobra ${v}` : `falta ${-v}`);
  return html`
    <${Cab} titulo="Conferência de doca">
      ${d && html`<button class="btn tiny" onClick=${baixarEv}>CSV eventos</button>`}
      ${d && html`<button class="btn tiny" onClick=${baixarHist}>CSV conferências</button>`}
      <button class="btn tiny" onClick=${() => comandar('r.doca', { acao: 'encerrar' })} title="Fecha esta conferência e começa outra">Encerrar</button>
      <button class="btn tiny" onClick=${() => confirm('Zerar contagens e histórico?') && zerar('r.doca')}>Zerar</button>
    <//>
    <div class="med-doca-form">
      <label>Placa/ordem <input value=${f.ordem} onInput=${(e) => setForm({ ...f, ordem: e.target.value })} /></label>
      <label>Tipo <select value=${f.tipo} onChange=${(e) => setForm({ ...f, tipo: e.target.value })}><option>recebimento</option><option>expedição</option></select></label>
      <label>Volumes <input type="number" min="-1" value=${f.volumes} onInput=${(e) => setForm({ ...f, volumes: e.target.value })} /></label>
      <label>Pallets <input type="number" min="-1" value=${f.pallets} onInput=${(e) => setForm({ ...f, pallets: e.target.value })} /></label>
      <label class="larga">Códigos esperados <textarea rows="2" value=${f.codigos} onInput=${(e) => setForm({ ...f, codigos: e.target.value })}></textarea></label>
      ${form && html`<button class="btn tiny" onClick=${aplicar}>Aplicar (nova ordem = nova conferência)</button>`}
    </div>
    ${!d ? html`<p class="hint tight">Aguardando: linha "Doca · porta" e detector + Tracking com IDs (ou Leitor de códigos).</p>` : html`
      <p class=${`med-encontro ${!c.conferido ? '' : c.ok ? 'ok' : 'falta'}`}><b>${d.sessao.tipo} · ${d.sessao.ordem}</b> —
        ${c.liquido.volume} volume(s), ${c.liquido.pallet} pallet(s)${d.codigos.length ? `, ${d.codigos.length} código(s)` : ''} —
        ${!c.conferido ? 'sem esperado' : c.ok ? 'CONFERE' : 'DIVERGENTE'}</p>
      ${c.conferido && html`<p class="hint tight">Volumes: ${dif(c.difVolumes)} · Pallets: ${dif(c.difPallets)}
        ${c.faltam.length ? html` · <b>faltam</b> ${c.faltam.slice(0, 12).join(', ')}${c.faltam.length > 12 ? '…' : ''}` : ''}
        ${c.sobram.length ? html` · <b>sobram</b> ${c.sobram.slice(0, 12).join(', ')}${c.sobram.length > 12 ? '…' : ''}` : ''}</p>`}
      ${d.semDetector && html`<p class="hint tight">Sem detector: cada código distinto conta como um volume.</p>`}
      ${Object.keys(d.totais).length > 0 && html`<div class="med-tab"><table><thead><tr><th>linha</th><th>entra vol</th><th>entra pal</th><th>sai vol</th><th>sai pal</th></tr></thead>
        <tbody>${Object.entries(d.totais).map(([L, T]) => html`<tr key=${L}><th>${L}</th><td class="v">${T.entrada.volume}</td><td class="v">${T.entrada.pallet}</td>
          <td class="v">${T['saída'].volume}</td><td class="v">${T['saída'].pallet}</td></tr>`)}</tbody></table></div>`}
      ${d.historico.length > 0 && html`<div class="med-tab"><table><thead><tr><th>ordem</th><th>vol</th><th>pal</th><th>resultado</th></tr></thead>
        <tbody>${d.historico.slice(-8).reverse().map((h, i) => html`<tr key=${i}><td>${h.tipo[0].toUpperCase()} ${h.ordem}</td><td class="v">${h.conferencia.liquido.volume}</td>
          <td class="v">${h.conferencia.liquido.pallet}</td><td>${!h.conferencia.conferido ? '—' : h.conferencia.ok ? 'confere' : 'divergente'}</td></tr>`)}</tbody></table></div>`}
    `}
  `;
}

// ------------------------------------------------------------------ CV-52 nível e gotejamento

function SecaoNivel() {
  const d = ler('r.nivel');
  const motor = alarmesDe('nivel');
  const itens = d ? d.itens : [];
  const baixarCsv = () => baixar(`nivel_${carimbo()}.csv`, csv(['visor', 'instante_s', 'valor', 'unidade'], itens.flatMap((it) => it.hist.map(([t, v]) => [it.nome, t.toFixed(2), n3(v, 3), it.unidade]))), 'text/csv');
  return html`
    <${Cab} titulo="Nível pelo visor">
      <button class="btn tiny" onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => csvAlarmes('nivel', motor)}>CSV alarmes</button>
      <button class="btn tiny" onClick=${() => zerar('r.nivel')}>Zerar</button>
    <//>
    ${!itens.length && html`<p class="hint tight">Desenhe a área "Processo · visor de nível" do fundo ao topo da escala.</p>`}
    ${itens.map((it) => html`<div class="med-instr" key=${it.id}>
      <div class="med-instr-v"><b class=${it.incerto ? 'warn' : ''}>${fmt(it.valor, it.casas)}</b><em>${it.unidade}</em></div>
      <div class="med-instr-n">${it.nome}${it.incerto ? ' · interface incerta' : ''}</div>
      <${Spark} hist=${it.hist} min=${Math.min(it.min, it.max)} max=${Math.max(it.min, it.max)} /></div>`)}
    <${Alarmes} resumo=${d && d.alarmes} motor=${motor} vazio="Nenhum alarme. Limites no nó (ex.: HH 95; H 85; L 15)." />
  `;
}

function SecaoGotas() {
  const d = ler('r.gotas');
  const motor = alarmesDe('gotas');
  const itens = d ? d.itens : [];
  const baixarCsv = () => baixar(`gotejamento_${carimbo()}.csv`, csv(['area', 'instante_s', 'gotas_min', 'poca_pct'],
    itens.flatMap((it) => it.pocaHist.map(([t, v]) => { const g = it.hist.find((x) => Math.abs(x[0] - t) < 0.05); return [it.nome, t.toFixed(2), g ? n3(g[1], 2) : '', n3(v, 3)]; }))), 'text/csv');
  return html`
    <${Cab} titulo="Gotejamento e vazamento">
      <button class="btn tiny" onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => csvAlarmes('gotejamento', motor)}>CSV alarmes</button>
      <button class="btn tiny" onClick=${() => comandar('r.gotas', { acao: 'fundo' })} title="Área seca e parada agora">Novo fundo</button>
      <button class="btn tiny" onClick=${() => zerar('r.gotas')}>Zerar</button>
    <//>
    ${itens.map((it) => html`<div key=${it.id}>
      <${Kpis} itens=${[[it.gotas, 'gotas'], [fmt(it.taxa, 1), 'gotas/min'], [fmt(it.poca, 1) + '%', 'poça'],
                       [fmt(it.tendencia, 2), '%/min'], ...(Number.isFinite(it.areaMm2) ? [[fmt(it.areaMm2 / 100, 1), 'cm² de poça']] : [])]} />
      <p class="hint tight">${it.nome}${it.aprendendo ? ' · aprendendo o fundo…' : ''}</p>
      <${Spark} hist=${it.hist} /></div>`)}
    <${Alarmes} resumo=${d && d.alarmes} motor=${motor} />
  `;
}

// ------------------------------------------------------------------ CV-53 correia

function SecaoCorreia() {
  const d = ler('r.correia');
  const motor = alarmesDe('correia');
  const itens = d ? d.itens : [];
  const baixarCsv = () => baixar(`correia_${carimbo()}.csv`, csv(['correia', 'instante_s', 'desvio'], itens.flatMap((it) => it.hist.map(([t, v]) => [it.nome, t.toFixed(2), n3(v, 2)]))), 'text/csv');
  return html`
    <${Cab} titulo="Desalinhamento de correia">
      <button class="btn tiny" onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => csvAlarmes('correia', motor)}>CSV alarmes</button>
      <button class="btn tiny" onClick=${() => comandar('r.correia', { acao: 'referencia' })} title="Com a correia centrada">Zerar referência</button>
    <//>
    ${itens.map((it) => html`<div class="med-instr" key=${it.id}>
      <div class="med-instr-v"><b class=${it.incerto ? 'warn' : ''}>${it.aprendendo ? '…' : fmt(it.unidade === 'mm' ? it.desvioMm : it.desvioPct, 1)}</b>
        <em>${it.unidade} ${it.lado}</em></div>
      <div class="med-instr-n">${it.nome} · ${it.aprendendo ? `referência ${it.n}/${it.refQuadros}` : `${fmt(it.desvioPct, 1)}% da largura · tendência ${fmt(it.tendencia, 1)} ${it.unidade}/min`}</div>
      <${Spark} hist=${it.hist} /></div>`)}
    <${Alarmes} resumo=${d && d.alarmes} motor=${motor} />
  `;
}

// ------------------------------------------------------------------ CV-54 torque

function SecaoTorque() {
  const d = ler('r.torque');
  const itens = d ? d.itens : [];
  const baixarCsv = () => baixar(`torque_${carimbo()}.csv`, csv(['instante', 'parafuso', 'estado', 'giro_graus'], (d.registro || []).map((r) => [hora(r.t, d.relogio), r.nome, r.estado, n3(r.desvio, 1)])), 'text/csv');
  return html`
    <${Cab} titulo="Marca de torque">
      ${d && html`<button class="btn tiny" onClick=${baixarCsv}>CSV registro</button>`}
      <button class="btn tiny" onClick=${() => comandar('r.torque', { acao: 'referencia' })} title="Com todos os parafusos apertados e marcados">Gravar referência</button>
      <button class="btn tiny" onClick=${() => comandar('r.torque', { acao: 'sem_referencia' })}>Sem referência</button>
    <//>
    ${!itens.length ? html`<p class="hint tight">Um círculo "Inspeção · marca de torque" por parafuso.</p>` : html`<ul class="med-lista">${itens.map((it) => html`
      <li key=${it.id} class=${it.estado === 'OK' ? 'ok' : it.estado === 'NOK' ? 'nok' : ''}><b>${it.nome}</b> ${it.estado}
        ${Number.isFinite(it.desvio) ? ` · giro ${fmt(it.desvio, 1)}° (tol. ${fmt(d.tolAng, 1)}°)` : it.motivo ? ` · ${it.motivo}` : ''}${it.comRef ? ' · com referência' : ''}</li>`)}</ul>`}
  `;
}

// ------------------------------------------------------------------ CV-55 chama

function SecaoChama() {
  const d = ler('r.chama');
  const motor = alarmesDe('chama');
  const itens = d ? d.itens : [];
  const cor = (rgb) => (rgb ? `rgb(${rgb.join(',')})` : 'transparent');
  const baixarCsv = () => baixar(`chama_${carimbo()}.csv`, csv(['area', 'instante_s', 'deltaE2000'], itens.flatMap((it) => it.hist.map(([t, v]) => [it.nome, t.toFixed(2), n3(v, 2)]))), 'text/csv');
  return html`
    <${Cab} titulo="Cor de chama / forno">
      <button class="btn tiny" onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => comandar('r.chama', { acao: 'gravar' })} title="A cor atual vira a referência (se o nó não tiver hex)">Gravar referência</button>
    <//>
    ${itens.map((it) => html`<div class="med-instr" key=${it.id}>
      <div class="med-instr-v"><b>${fmt(it.de, 1)}</b><em>ΔE2000</em></div>
      <div class="med-instr-n"><span class="med-amostra" style=${{ background: cor(it.rgb) }} title="atual"></span>
        <span class="med-amostra" style=${{ background: cor(it.ref && it.ref.rgb) }} title="referência"></span>
        ${it.nome} · L ${fmt(it.lab && it.lab[0], 0)} a ${fmt(it.lab && it.lab[1], 0)} b ${fmt(it.lab && it.lab[2], 0)} · ~${Number.isFinite(it.cct) ? Math.round(it.cct / 10) * 10 : '—'} K</div>
      <${Spark} hist=${it.hist} min=${0} /></div>`)}
    <${Alarmes} resumo=${d && d.alarmes} motor=${motor} />
  `;
}

// ------------------------------------------------------------------ CV-56 solda

function SecaoSolda() {
  const d = ler('r.solda');
  if (!d) return html`<${Cab} titulo="Pontos de solda" /><p class="hint tight">Aguardando.</p>`;
  const baixarCsv = () => baixar(`solda_${carimbo()}.csv`, csv(['instante', 'peca', 'faltando', 'deslocados', 'sobrando'],
    d.registro.map((r) => [hora(r.t, d.relogio), r.ok ? 'OK' : 'NOK', r.faltando, r.deslocados, r.sobrando])), 'text/csv');
  return html`
    <${Cab} titulo="Pontos de solda"><button class="btn tiny" onClick=${baixarCsv}>CSV registro</button><button class="btn tiny" onClick=${() => zerar('r.solda')}>Zerar</button><//>
    <p class=${`med-encontro ${d.ok ? 'ok' : 'falta'}`}><b>Peça ${d.ok ? 'OK' : 'NOK'}</b> — ${d.pos.filter((q) => q.estado === 'OK').length}/${d.pos.length} pontos${d.extras.length ? ` · ${d.extras.length} sobrando` : ''}</p>
    <ul class="med-lista">${d.pos.map((q) => html`<li key=${q.id} class=${q.estado === 'OK' ? 'ok' : 'nok'}><b>${q.nome}</b> ${q.estado}
      ${q.ok ? ` · desvio ${d.calibrado ? fmt(q.erroMm, 2) + ' mm' : fmt(q.erroPx, 1) + ' px'}` : ''}</li>`)}</ul>
  `;
}

// ------------------------------------------------------------------ CV-57 fumaça

function SecaoFumaca() {
  const d = ler('r.fumaca');
  const motor = alarmesDe('fumaca');
  const baixarCsv = () => baixar(`ringelmann_${carimbo()}.csv`, csv(['instante_s', 'ringelmann', 'opacidade_pct'], (d.hist || []).map(([t, v]) => [t.toFixed(2), n3(v, 2), n3(v * 20, 1)])), 'text/csv');
  return html`
    <${Cab} titulo="Opacidade de fumaça (Ringelmann)">${d && html`<button class="btn tiny" onClick=${baixarCsv}>CSV</button>`}
      <button class="btn tiny" onClick=${() => zerar('r.fumaca')}>Zerar</button><//>
    <p class="med-aviso" role="note">⚠ ${AVISO_RINGELMANN}</p>
    ${d && d.ult && html`
      <${Kpis} itens=${[[fmt(d.ringelmann, 1), 'Ringelmann'], [d.ult.valido ? fmt(d.ult.opacidade * 100, 0) + '%' : '—', 'opacidade'],
                       [fmt(d.pctAcima, 1) + '%', `do tempo > ${fmt(d.limite, 1)} (${Math.round(d.janela / 60)} min)`]]} />
      ${!d.ult.valido && html`<p class="hint tight">${d.ult.motivo}</p>`}
      <${Spark} hist=${d.hist} min=${0} max=${5} />`}
    <${Alarmes} resumo=${d && d.alarmes} motor=${motor} />
  `;
}

// ------------------------------------------------------------------ CV-58 baú

function SecaoBau() {
  const d = ler('r.bau');
  return html`
    <${Cab} titulo="Ocupação do baú (estimativa)">
      <button class="btn tiny" onClick=${() => comandar('r.bau', { acao: 'vazio' })} title="Com o baú VAZIO na frente da câmera">Gravar baú vazio</button>
      <button class="btn tiny" onClick=${() => comandar('r.bau', { acao: 'sem_vazio' })}>Esquecer vazio</button>
    <//>
    <p class="med-aviso" role="note">⚠ ${AVISO_BAU}</p>
    ${d && d.sem ? html`<p class="hint tight">Falta ${d.sem === 'profundidade' ? 'o operador de profundidade antes na cadeia' : 'marcar a porta e o fundo'}.</p>`
      : d && html`<${Kpis} itens=${[[`≈ ${fmt(d.ocupacao, 0)}%`, 'ocupação estimada'], [d.comVazio ? 'sim' : 'não', 'referência do vazio']]} />
        ${d.erro && html`<p class="hint tight">${d.erro}</p>`}
        ${!d.comVazio && html`<p class="hint tight">Sem a referência do baú vazio a estimativa supõe que alguma fresta mostra a parede do fundo.</p>`}
        <${Spark} hist=${d.hist} min=${0} max=${100} />`}
  `;
}

// ------------------------------------------------------------------ CV-59 fissuras

function svgFissuras(R, larg = 320) {
  const A = R.area, esc = larg / A.w, alt = Math.round(A.h * esc);
  const pts = R.fissuras.flatMap((f) => f.pontos.map((q) => `<circle cx="${((q.x - A.x) * esc).toFixed(1)}" cy="${((q.y - A.y) * esc).toFixed(1)}" r="${Math.max(1.2, Math.min(3, larg / 260)).toFixed(1)}" fill="${COR_ABERTURA[q.c] || '#FFD84D'}"/>`));
  const rot = R.fissuras.map((f) => { const q = f.pontos[0]; return q ? `<text x="${((q.x - A.x) * esc + 4).toFixed(1)}" y="${((q.y - A.y) * esc - 4).toFixed(1)}" fill="#e5e7eb" font-size="11" font-family="monospace">F${f.id}</text>` : ''; });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${larg}" height="${alt}" viewBox="0 0 ${larg} ${alt}"><rect width="100%" height="100%" fill="#111827"/>${pts.join('')}${rot.join('')}</svg>`;
}

function relatorioFissuras(R) {
  const lin = R.fissuras.map((f) => `<tr><td>F${f.id}</td><td>${fmt(f.comprimento, 1)}</td><td>${fmt(f.larguraMax, 2)}</td><td>${fmt(f.larguraMedia, 2)}</td><td>${fmt(f.larguraP95, 2)}</td><td>${f.classe}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório de fissuras</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#111}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}small{color:#555}</style>
<h1>Relatório de fissuras</h1><p>Gerado em ${new Date().toLocaleString('pt-BR')} pelo GPlanSiS|iaVision (CV-59). Unidade: ${R.unidade}.</p>
<p>${R.fissuras.length} fissura(s) · comprimento total ${fmt(R.comprimento, 1)} ${R.unidade} · abertura máxima ${fmt(R.larguraMax, 2)} ${R.unidade}</p>
<table><tr><th>ID</th><th>Comprimento</th><th>Abertura máx.</th><th>Média</th><th>P95</th><th>Classe</th></tr>${lin}</table>
<h2>Mapa</h2>${svgFissuras(R, 640)}
<p><small>Classes de abertura (nomenclatura usual de patologia): capilar &lt; 0,2 mm; fissura até 0,5 mm; trinca até 1,5 mm; rachadura até 5 mm; fenda &gt; 5 mm.
Medição por imagem com régua calibrada no plano da parede: confirme as aberturas críticas com fissurômetro. Não substitui laudo técnico.</small></p></html>`;
}

function SecaoFissuras() {
  const d = ler('r.fissuras');
  const R = d && d.r;
  const csvF = () => baixar(`fissuras_${carimbo()}.csv`, csv(['fissura', 'x_px', 'y_px', `abertura_${R.unidade}`, 'classe'],
    R.fissuras.flatMap((f) => f.pontos.map((q) => [`F${f.id}`, n3(q.x, 1), n3(q.y, 1), n3(q.l, 3), q.c]))), 'text/csv');
  const png = () => {
    const svg = svgFissuras(R, 1200), img = new Image();
    img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `fissuras_${carimbo()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  };
  return html`
    <${Cab} titulo="Fissuras">
      <button class="btn tiny" onClick=${() => comandar('r.fissuras', { acao: 'medir' })}>Medir agora</button>
      ${R && R.fissuras.length > 0 && html`<button class="btn tiny" onClick=${csvF}>CSV</button><button class="btn tiny" onClick=${png}>PNG do mapa</button>
        <button class="btn tiny" onClick=${() => baixar(`fissuras_${carimbo()}.html`, relatorioFissuras(R), 'text/html')}>Relatório</button>`}
    <//>
    ${!R ? html`<p class="hint tight">Aguardando a primeira medição.</p>` : html`
      ${R.unidade !== 'mm' && html`<p class="hint tight">Sem régua calibrada: medidas em px. Calibre no plano da parede.</p>`}
      <${Kpis} itens=${[[R.fissuras.length, 'fissuras'], [fmt(R.comprimento, R.unidade === 'mm' ? 0 : 0), `${R.unidade} no total`], [fmt(R.larguraMax, 2), `${R.unidade} abertura máx.`]]} />
      ${R.fissuras.length > 0 && html`<div class="med-calor" dangerouslySetInnerHTML=${{ __html: svgFissuras(R, 320) }}></div>
        <div class="med-tab"><table><thead><tr><th>ID</th><th>compr.</th><th>máx.</th><th>média</th><th>classe</th></tr></thead>
        <tbody>${R.fissuras.slice(0, 15).map((f) => html`<tr key=${f.id}><td>F${f.id}</td><td class="v">${fmt(f.comprimento, 1)}</td><td class="v">${fmt(f.larguraMax, 2)}</td>
          <td class="v">${fmt(f.larguraMedia, 2)}</td><td style=${{ color: COR_ABERTURA[f.classe] }}>${f.classe}</td></tr>`)}</tbody></table></div>`}
      ${d.congelado && html`<p class="hint tight">Congelado: "Medir agora" refaz.</p>`}`}
  `;
}

/**
 * Seções da onda 2-a. `tem(chave, prefixos)` é a função do MedicoesPanel:
 * verdadeiro quando o operador publicou ou está no Pipeline.
 */
export function secoesOnda2a(tem) {
  return [
    tem('r.pokayoke', ['pokayoke.']) && html`<${SecaoPoka} key="r-poka" />`,
    tem('r.cubagem', ['cubagem.esteira']) && html`<${SecaoCubagem} key="r-cub" />`,
    tem('r.cubfoto', ['cubagem.foto']) && html`<${SecaoCubFoto} key="r-cubf" />`,
    tem('r.doca', ['doca.']) && html`<${SecaoDoca} key="r-doca" />`,
    tem('r.nivel', ['processo.nivel']) && html`<${SecaoNivel} key="r-nivel" />`,
    tem('r.gotas', ['processo.gotejamento']) && html`<${SecaoGotas} key="r-gotas" />`,
    tem('r.correia', ['correia.']) && html`<${SecaoCorreia} key="r-correia" />`,
    tem('r.torque', ['inspecao.torque']) && html`<${SecaoTorque} key="r-torque" />`,
    tem('r.chama', ['processo.cor_chama']) && html`<${SecaoChama} key="r-chama" />`,
    tem('r.solda', ['inspecao.solda']) && html`<${SecaoSolda} key="r-solda" />`,
    tem('r.fumaca', ['ambiente.ringelmann']) && html`<${SecaoFumaca} key="r-fumaca" />`,
    tem('r.bau', ['logistica.ocupacao_bau']) && html`<${SecaoBau} key="r-bau" />`,
    tem('r.fissuras', ['civil.fissuras']) && html`<${SecaoFissuras} key="r-fis" />`,
  ];
}
