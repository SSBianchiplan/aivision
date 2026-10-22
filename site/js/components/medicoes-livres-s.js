/**
 * components/medicoes-livres-s.js — as seções do painel «Medições» para os
 * operadores do grupo S (onda 2-b, CV-60..67). O MedicoesPanel chama
 * secoesLivresS(tem) e acrescenta as seções em uso.
 *
 *   AEP (NR-17)         postos, prioridade, relatório para imprimir/PDF, CSV
 *   NIOSH               H/V atuais, IL da tarefa, levantamentos, CSV
 *   Segurança predial   saída obstruída (capturar cena vazia), fogo, alarmes
 *   Auditoria de preço  importar a tabela CSV, divergências, CSV
 *   Planograma          grade por célula, capturar referência, CSV
 *   Foto de produto     exportar a foto, LOTE de fotos → ZIP
 *   Ocupação            mesas, vagas e lixeiras, capturar cena vazia, CSV
 *   Medidor             leitura, consumo, vazão, CSV
 *   Resumo de vídeo     linha do tempo clicável, eventos, CSV, abrir no editor
 *   Velocidade          média, mediana, V85, excessos, CSV
 */
import { html, useState, useEffect, useRef } from '../vendor.js';
import { ler, zerar, csv, hora } from '../cv/runtime/livres-oa/canal.js';
import { ROTULO_ESTADO } from '../cv/runtime/livres-oa/alarmes.js';
import { baixar } from '../cv/marcacoes.js';
import { htmlAEP, csvAEP, AVISO_AEP, NOMES_FAIXA } from '../cv/runtime/livres-s/aep.js';
import { FAIXAS } from '../cv/runtime/livres-f/ergonomia.js';
import { AVISO_PREDIAL, alarmesPrediais } from '../cv/operators/livres-s/predial.js';
import { AVISO_FOGO } from '../cv/runtime/livres-s/fogo.js';
import { lerTabelaCSV, definirTabela, ROTULO_STATUS } from '../cv/runtime/livres-s/precos.js';
import { ROTULO_CELULA } from '../cv/operators/livres-s/varejo.js';
import { ultimaFotoProduto } from '../cv/operators/livres-s/produto.js';
import { comporProduto, mascaraBiRefNet, paraBlob, imagemDeArquivo } from '../cv/runtime/livres-s/produto.js';
import { alarmesOcupacao } from '../cv/operators/livres-s/ocupacao.js';
import { videoDaFonte } from '../cv/runtime/livres-k/canal.js';
import { abrirEditorVideo } from './video/ponte.js';

const carimbo = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const f = (v, c = 1) => (Number.isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');
const pc = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '—');
const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '—');
const baixarCsv = (nome, cab, linhas) => baixar(`${nome}_${carimbo()}.csv`, '﻿' + csv(cab, linhas), 'text/csv');

function Cab({ titulo, children }) {
  return html`<div class="cfg-sub med-cab"><span>${titulo}</span><span class="med-acoes">${children}</span></div>`;
}

function Alarmes({ motor, vazio }) {
  const r = motor.resumo();
  return r.pendentes.length ? html`<ul class="med-al">${r.pendentes.map((a) => html`
    <li key=${a.tag} class=${`p${a.prio} ${a.estado === 'ATIVO_NR' || a.estado === 'RTN_NR' ? 'nr' : ''}`}><b>${a.tag}</b> ${a.texto}<em>${ROTULO_ESTADO[a.estado]}</em></li>`)}</ul>`
    : html`<p class="hint tight">${vazio}</p>`;
}

/** Seções em uso. `tem(chave, prefixos)` = o operador publicou ou está no Pipeline. */
export function secoesLivresS(tem) {
  return [
    tem('aep', ['aep.']) && html`<${SecaoAEP} key="s-aep" />`,
    tem('niosh', ['ergonomia.niosh']) && html`<${SecaoNiosh} key="s-niosh" />`,
    (tem('saida', ['seguranca.saida_obstruida']) || tem('fogo', ['seguranca.fogo'])) && html`<${SecaoPredial} key="s-pred" />`,
    tem('precos', ['varejo.preco']) && html`<${SecaoPrecos} key="s-preco" />`,
    tem('planograma', ['varejo.planograma']) && html`<${SecaoPlanograma} key="s-plano" />`,
    tem('produto', ['produto.foto']) && html`<${SecaoProduto} key="s-prod" />`,
    (tem('mesas', ['ocupacao.mesas']) || tem('vagas', ['ocupacao.zona'])) && html`<${SecaoOcupacao} key="s-ocup" />`,
    tem('medidor', ['medidor.']) && html`<${SecaoMedidor} key="s-med" />`,
    tem('resumo', ['video.resumo']) && html`<${SecaoResumo} key="s-res" />`,
    tem('velocidade', ['transito.velocidade']) && html`<${SecaoVelocidade} key="s-vel" />`,
  ].filter(Boolean);
}

// ------------------------------------------------------------------ AEP

function SecaoAEP() {
  const d = ler('aep');
  const postos = d ? d.postos : [];
  const M = d ? d.metodo : 'RULA';
  const relatorio = () => {
    const n = ler('niosh');
    const t = n && n.tarefa;
    const doc = htmlAEP({ cab: d.cab, metodo: M, postos, duracaoS: d.duracaoS, inicio: new Date().toLocaleString('pt-BR'),
      niosh: t ? { ...t, n: t.n } : null });
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(doc); w.document.close(); }
    else baixar(`aep_${carimbo()}.html`, doc, 'text/html');
  };
  return html`
    <${Cab} titulo="AEP por posto (NR-17)">
      <button class="btn tiny" onClick=${relatorio} disabled=${!postos.length} title="Rascunho para o ergonomista: imprimir ou salvar em PDF">Relatório</button>
      <button class="btn tiny" onClick=${() => baixar(`aep_${carimbo()}.csv`, csvAEP(postos, M), 'text/csv')} disabled=${!postos.length}>CSV</button>
      <button class="btn tiny" onClick=${() => confirm('Zerar a consolidação da AEP?') && zerar('aep')}>Zerar</button>
    <//>
    <p class="med-aviso" role="note">⚠ ${AVISO_AEP}</p>
    ${d && !d.vivo && html`<p class="hint tight">Coloque <b>Ergonomia (RULA/REBA)</b> antes do nó AEP (preset Segurança do trabalho › AEP).</p>`}
    ${d && d.semPostos && html`<p class="hint tight">Sem áreas <b>Takt · posto</b>: tudo conta no posto "Geral".</p>`}
    ${postos.length ? html`<div class="med-tab"><table>
      <thead><tr><th>posto</th><th>prioridade</th><th>tempo</th><th>${M} méd.</th><th>pior</th><th>alto+</th><th>níveis</th></tr></thead>
      <tbody>${postos.map((p) => html`<tr key=${p.nome}>
        <td>${p.nome}</td><td><b style=${{ color: p.prioridade.cor }}>●</b> ${p.prioridade.nome}</td><td class="v">${mmss(p.tempoS)}</td>
        <td class="v">${f(p[M].media, 1)}</td><td class="v">${p[M].pico ? p[M].pico.nota : '—'}</td><td class="v">${Math.round(p[M].pct[3] + p[M].pct[4])} %</td>
        <td><span style=${{ display: 'flex', width: '90px', height: '9px', borderRadius: '3px', overflow: 'hidden', background: 'var(--line-2)' }}>
          ${p[M].pct.map((v, i) => (v > 0 ? html`<i key=${i} title=${`${NOMES_FAIXA[i]} ${Math.round(v)} %`} style=${{ width: v + '%', background: FAIXAS[i].cor }}></i>` : null))}</span></td>
      </tr>`)}</tbody></table></div>` : html`<p class="hint tight">Aguardando avaliações válidas (pessoa de lado, braços visíveis).</p>`}
  `;
}

// ------------------------------------------------------------------ NIOSH

function SecaoNiosh() {
  const d = ler('niosh');
  const l = d ? d.levantamentos : [];
  const T = d && d.tarefa;
  const exp = () => baixarCsv('niosh', ['t_s', 'tipo', 'freq_min', 'H_origem_cm', 'V_origem_cm', 'H_destino_cm', 'V_destino_cm', 'D_cm', 'HM_o', 'VM_o', 'DM', 'AM', 'FM_o', 'CM_o', 'LPR_kg', 'IL_origem', 'IL_destino', 'IL', 'classe'],
    l.map((x) => [x.t.toFixed(2), x.tipo, x.F.toFixed(2), x.Ho.toFixed(1), x.Vo.toFixed(1), x.Hd.toFixed(1), x.Vd.toFixed(1), x.D.toFixed(1), x.mult.o.HM.toFixed(3), x.mult.o.VM.toFixed(3),
      x.mult.o.DM.toFixed(3), x.mult.o.AM.toFixed(3), x.mult.o.FM.toFixed(3), x.mult.o.CM.toFixed(3), x.RWL.toFixed(2), x.LIo.toFixed(2), x.LId.toFixed(2), x.LI.toFixed(2), x.classe]));
  return html`
    <${Cab} titulo="Levantamento de carga (NIOSH)">
      <button class="btn tiny" onClick=${exp} disabled=${!l.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('niosh')}>Zerar</button>
    <//>
    <p class="hint tight">Equação revisada do NIOSH (1993): H e V pela pose (câmera de lado, régua calibrada ou estatura); carga, pega,
      duração e assimetria são informadas no nó. Apoio à avaliação — confira as medidas no posto.</p>
    <div class="kpis med-kpis">
      <div class="kpi"><b>${d && d.medida ? Math.round(d.medida.H) : '—'}</b><em>H agora (cm)</em></div>
      <div class="kpi"><b>${d && d.medida ? Math.round(d.medida.V) : '—'}</b><em>V agora (cm)</em></div>
      <div class="kpi"><b>${T ? T.n : 0}</b><em>levantamentos</em></div>
      <div class="kpi"><b style=${T ? { color: T.cor } : null}>${T ? f(T.LI, 2) : '—'}</b><em>IL máximo</em></div>
    </div>
    ${T && html`<p class="hint tight">LPR crítico ${f(T.RWL, 2)} kg para ${f(T.carga, 1)} kg · ${f(T.F, 2)} lev./min · <b>${T.classe}</b></p>`}
    ${d && d.motivo && html`<p class="hint tight">${d.motivo}</p>`}
    ${l.length > 0 && html`<div class="med-tab"><table><thead><tr><th>t (s)</th><th>origem H/V</th><th>destino H/V</th><th>D</th><th>LPR</th><th>IL</th></tr></thead>
      <tbody>${l.slice(-10).reverse().map((x, i) => html`<tr key=${i}><td class="v">${f(x.t, 1)}</td><td class="v">${Math.round(x.Ho)}/${Math.round(x.Vo)}</td>
        <td class="v">${Math.round(x.Hd)}/${Math.round(x.Vd)}</td><td class="v">${Math.round(x.D)}</td><td class="v">${f(x.RWL, 1)}</td><td class="v s">${f(x.LI, 2)}</td></tr>`)}</tbody></table></div>`}
  `;
}

// ------------------------------------------------------------------ predial

function SecaoPredial() {
  const s = ler('saida'), fg = ler('fogo');
  const motor = alarmesPrediais();
  const exp = () => baixarCsv('seguranca_predial', ['instante_s', 'tag', 'evento', 'prioridade', 'texto'],
    motor.log.map((l) => [Number.isFinite(l.t) ? l.t.toFixed(2) : '', l.tag, l.evento, l.prio, l.texto]));
  return html`
    <${Cab} titulo="Segurança predial (indicativo)">
      ${s && html`<button class="btn tiny" onClick=${() => zerar('saida_ref')} title="Use com as saídas LIVRES">Capturar cena vazia</button>`}
      <button class="btn tiny" onClick=${exp}>CSV eventos</button>
      <button class="btn tiny" onClick=${() => motor.reconhecer()}>Reconhecer</button>
    <//>
    <p class="med-aviso" role="note">⚠ ${AVISO_PREDIAL}${fg ? ' ' + AVISO_FOGO : ''}</p>
    ${s && !s.pronta && html`<p class="hint tight">Aguardando a cena vazia das saídas (deixe livres e paradas por 3 s, ou capture).</p>`}
    ${s && s.zonas.length > 0 && html`<ul class="med-lista">${s.zonas.map((z) => html`<li key=${z.id} class=${z.ativo ? 'nok' : 'ok'}>
      <b>${z.nome}</b> ${z.ativo ? 'OBSTRUÍDA' : z.pendente ? `objeto parado há ${Math.round(z.desde)} s` : 'livre'} · ${Math.round(z.parado * 100)} % da área</li>`)}</ul>`}
    ${fg && html`<p class="hint tight">Fogo: ${fg.ativo ? html`<b style=${{ color: 'var(--err)' }}>INDÍCIO</b>` : fg.bruto ? 'suspeito' : 'nada'} · cor ${f(fg.cor * 100, 2)} % · tremula ${Math.round(fg.fracCint * 100)} %</p>`}
    <${Alarmes} motor=${motor} vazio="Nenhum alarme." />
  `;
}

// ------------------------------------------------------------------ preço

function SecaoPrecos() {
  const d = ler('precos');
  const [msg, setMsg] = useState('');
  const [todas, setTodas] = useState(false);
  const inp = useRef(null);
  const l = d ? d.lidas : [];
  const importar = async (e) => {
    const arq = e.target.files && e.target.files[0];
    if (!arq) return;
    const r = lerTabelaCSV(await arq.text());
    definirTabela(r.itens, arq.name);
    setMsg(`${r.itens.length} itens de "${arq.name}"${r.erros.length ? ` · ${r.erros.length} linha(s) ignorada(s): ${r.erros.slice(0, 2).join('; ')}` : ''}`);
    zerar('precos');
    e.target.value = '';
  };
  const ord = l.slice().sort((a, b) => (a.status === 'divergente' ? -1 : 0) - (b.status === 'divergente' ? -1 : 0));
  const vis = todas ? ord : ord.filter((x) => x.status !== 'ok');
  const exp = () => baixarCsv('auditoria_preco', ['status', 'codigo', 'descricao_etiqueta', 'preco_etiqueta', 'preco_sistema', 'diferenca', 'descricao_sistema', 'casado_por', 'vezes'],
    l.map((x) => [ROTULO_STATUS[x.status], x.codigo, x.descricao, x.preco, x.precoTabela ?? '', x.diferenca ?? '', x.descTabela, x.por || '', x.vezes]));
  return html`
    <${Cab} titulo="Auditoria de preço">
      <button class="btn tiny" onClick=${() => inp.current && inp.current.click()} title="CSV com código; descrição; preço">Importar tabela</button>
      <button class="btn tiny" onClick=${exp} disabled=${!l.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('precos')}>Zerar</button>
    <//>
    <input ref=${inp} type="file" accept=".csv,.txt,text/csv" style=${{ display: 'none' }} onChange=${importar} />
    <p class="hint tight">Tabela: ${d && d.tabela.n ? `${d.tabela.n} itens (${d.tabela.nome || 'importada'})` : 'nenhuma — importe o CSV do sistema (código; descrição; preço)'}. Fica só neste navegador.${msg ? ' ' + msg : ''}</p>
    ${d && html`<div class="kpis med-kpis"><div class="kpi"><b>${l.length}</b><em>etiquetas</em></div><div class="kpi"><b style=${{ color: 'var(--err)' }}>${d.cont.divergente}</b><em>divergentes</em></div>
      <div class="kpi"><b>${d.cont.ok}</b><em>conferem</em></div><div class="kpi"><b>${d.cont.nao_cadastrado}</b><em>não cadastr.</em></div></div>`}
    <label class="med-sel"><input type="checkbox" checked=${todas} onChange=${(e) => setTodas(e.target.checked)} /> mostrar também as que conferem</label>
    ${vis.length ? html`<div class="med-tab"><table><thead><tr><th>status</th><th>produto</th><th>etiqueta</th><th>sistema</th><th>dif.</th></tr></thead>
      <tbody>${vis.slice(0, 40).map((x) => html`<tr key=${x.chave}><td style=${{ color: x.status === 'divergente' ? 'var(--err)' : x.status === 'ok' ? 'var(--ok)' : 'var(--warn)' }}>${ROTULO_STATUS[x.status]}</td>
        <td title=${x.codigo}>${(x.descTabela || x.descricao || x.codigo || '—').slice(0, 34)}</td><td class="v">${f(x.preco, 2)}</td><td class="v">${x.precoTabela != null ? f(x.precoTabela, 2) : '—'}</td>
        <td class="v s">${x.diferenca != null ? f(x.diferenca, 2) : ''}</td></tr>`)}</tbody></table></div>` : html`<p class="hint tight">${l.length ? 'Nenhuma divergência.' : 'Nenhuma etiqueta lida ainda.'}</p>`}
  `;
}

// ------------------------------------------------------------------ planograma

const COR_CEL = { ok: 'var(--ok)', trocado: '#F2A900', vazio: 'var(--err)' };

function SecaoPlanograma() {
  const d = ler('planograma');
  const gs = d ? d.grades : [];
  const exp = () => baixarCsv('planograma', ['grade', 'linha', 'coluna', 'estado', 'similaridade', 'p_vazio'],
    gs.flatMap((g) => g.celulas.map((c) => [g.nome, c.r + 1, c.c + 1, c.estado ? ROTULO_CELULA[c.estado] : '', c.sim != null ? c.sim.toFixed(3) : '', c.pVazio != null ? c.pVazio.toFixed(3) : ''])));
  return html`
    <${Cab} titulo="Vitrine × planograma">
      <button class="btn tiny" onClick=${() => confirm('Capturar a vitrine ATUAL como referência (arrumada)?') && zerar('planograma_ref')}>Capturar referência</button>
      <button class="btn tiny" onClick=${exp} disabled=${!gs.length}>CSV</button>
    <//>
    ${gs.map((g) => html`<div key=${g.id} style=${{ margin: '6px 0' }}>
      <p class="hint tight"><b>${g.nome}</b> · ${g.referenciaEm ? `referência de ${new Date(g.referenciaEm).toLocaleString('pt-BR')}` : 'capturando a referência…'}
        · ${g.conformidade != null ? `${Math.round(g.conformidade * 100)} % conforme · ${g.trocados} trocado(s) · ${g.vazios} vazio(s)` : 'lendo…'}</p>
      <div style=${{ display: 'grid', gridTemplateColumns: `repeat(${g.colunas}, 1fr)`, gap: '2px', maxWidth: '280px' }}>
        ${g.celulas.map((c) => html`<span key=${c.r + ':' + c.c} title=${`L${c.r + 1} C${c.c + 1}: ${c.estado ? ROTULO_CELULA[c.estado] : '—'}${c.sim != null ? ' · ' + c.sim.toFixed(2) : ''}`}
          style=${{ height: '16px', borderRadius: '3px', background: c.estado ? COR_CEL[c.estado] : 'var(--line-2)' }}></span>`)}
      </div></div>`)}
    ${!gs.length && html`<p class="hint tight">Desenhe a área da vitrine com a função <b>Varejo · planograma</b>.</p>`}
  `;
}

// ------------------------------------------------------------------ foto de produto

function SecaoProduto() {
  const d = ler('produto');
  const [lote, setLote] = useState('');
  const inp = useRef(null);
  const exportar = async () => {
    const u = ultimaFotoProduto();
    if (!u) return;
    const c = comporProduto(u.foto, u.mask, u.cfg);
    if (!c) { setLote('Nenhum objeto separado do fundo.'); return; }
    const b = await paraBlob(c.img, u.cfg.fundo === 'transparente');
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = `produto_${carimbo()}.${u.cfg.fundo === 'transparente' ? 'png' : 'jpg'}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };
  const processarLote = async (e) => {
    const arqs = [...(e.target.files || [])];
    e.target.value = '';
    if (!arqs.length) return;
    const u = ultimaFotoProduto();
    const cfg = u ? u.cfg : { proporcao: '1:1', margem: 0.08, fundo: 'branco', sombra: 0.35, dureza: 0.3, limiar: 0.5, base: 'centro', saida: 1600 };
    const { montarZip } = await import('./video/zip.js');
    const saida = [], falhas = [];
    for (let i = 0; i < arqs.length; i++) {
      setLote(`Processando ${i + 1} de ${arqs.length}: ${arqs[i].name}…`);
      try {
        const im = await imagemDeArquivo(arqs[i]);
        const c = comporProduto(im, await mascaraBiRefNet(im), cfg);
        if (!c) { falhas.push(arqs[i].name); continue; }
        const ext = cfg.fundo === 'transparente' ? 'png' : 'jpg';
        saida.push({ nome: arqs[i].name.replace(/\.[^.]+$/, '') + '_produto.' + ext, blob: await paraBlob(c.img, cfg.fundo === 'transparente') });
      } catch (err) { falhas.push(`${arqs[i].name} (${err.message || err})`); }
    }
    if (saida.length) {
      const z = await montarZip(saida);
      const a = document.createElement('a'); a.href = URL.createObjectURL(z); a.download = `produtos_${carimbo()}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
    setLote(`${saida.length} foto(s) no ZIP${falhas.length ? ` · sem objeto/erro: ${falhas.join(', ')}` : ''}.`);
  };
  return html`
    <${Cab} titulo="Foto de produto">
      <button class="btn tiny" onClick=${exportar} disabled=${!d || !d.ok}>Exportar foto</button>
      <button class="btn tiny" onClick=${() => inp.current && inp.current.click()} title="Várias fotos → ZIP, com a mesma configuração do nó">Lote → ZIP</button>
    <//>
    <input ref=${inp} type="file" accept="image/*" multiple style=${{ display: 'none' }} onChange=${processarLote} />
    <p class="hint tight">${d && d.ok ? `Foto ${d.largura}×${d.altura} · produto em ${Math.round(d.ocupacao * 100)} % da foto · ${d.proporcao}, fundo ${d.fundo}.` : 'Aguardando o recorte (BiRefNet).'}
      O lote usa a configuração do nó; tudo roda neste navegador.</p>
    ${lote && html`<p class="hint tight">${lote}</p>`}
  `;
}

// ------------------------------------------------------------------ ocupação

function SecaoOcupacao() {
  const m = ler('mesas'), v = ler('vagas');
  const motor = alarmesOcupacao();
  const mesas = m ? m.mesas : [], zonas = v ? v.zonas : [];
  const exp = () => baixarCsv('ocupacao', ['tipo', 'nome', 'estado_ou_ocupadas', 'capacidade', 'pct', 'media_pct', 'giro_ou_ocupacoes', 'ocupacao_media_s', 'espera_limpeza_media_s'], [
    ...mesas.map((x) => ['mesa', x.nome, x.estado, 1, '', '', x.ocupacoes, x.ocupMediaS != null ? x.ocupMediaS.toFixed(0) : '', x.esperaMediaS != null ? x.esperaMediaS.toFixed(0) : '']),
    ...zonas.map((x) => [x.tipo, x.nome, x.tipo === 'vaga' ? x.ocupadas : (x.cheia ? 'cheia' : ''), x.capacidade ?? '', x.pct != null ? x.pct.toFixed(2) : '', x.mediaPct != null ? x.mediaPct.toFixed(2) : '', x.giro ?? '', '', '']),
  ]);
  return html`
    <${Cab} titulo="Ocupação (mesas, vagas, lixeiras)">
      ${v && v.precisaRef && html`<button class="btn tiny" onClick=${() => zerar('vagas_ref')} title="Com vagas e lixeiras VAZIAS">Capturar cena vazia</button>`}
      <button class="btn tiny" onClick=${exp} disabled=${!mesas.length && !zonas.length}>CSV</button>
      <button class="btn tiny" onClick=${() => { zerar('mesas'); zerar('vagas'); }}>Zerar</button>
    <//>
    ${mesas.length > 0 && html`<div class="med-tab"><table><thead><tr><th>mesa</th><th>estado</th><th>há</th><th>giro</th><th>ocup. méd.</th><th>espera limp.</th></tr></thead>
      <tbody>${mesas.map((x) => html`<tr key=${x.id}><td>${x.nome}</td><td style=${{ color: x.estado === 'suja' ? 'var(--warn)' : x.estado === 'ocupada' ? 'var(--cyan)' : 'var(--ok)' }}>${x.estado}</td>
        <td class="v">${mmss(x.ha)}</td><td class="v">${x.ocupacoes}</td><td class="v">${mmss(x.ocupMediaS)}</td><td class="v">${mmss(x.esperaMediaS)}</td></tr>`)}</tbody></table></div>`}
    ${v && v.precisaRef && !v.pronta && html`<p class="hint tight">Aguardando a cena vazia (deixe as áreas vazias e paradas por 3 s, ou capture).</p>`}
    ${zonas.length > 0 && html`<div class="med-tab"><table><thead><tr><th>área</th><th>agora</th><th>média</th><th>giro</th></tr></thead>
      <tbody>${zonas.map((x) => html`<tr key=${x.id}><td>${x.nome}</td>
        <td class="v">${x.tipo === 'vaga' ? (x.pct == null ? '—' : `${x.ocupadas}/${x.capacidade}`) : (x.pct == null ? '—' : `${Math.round(x.pct * 100)} %${x.cheia ? ' CHEIA' : ''}`)}</td>
        <td class="v">${pc(x.mediaPct)}</td><td class="v">${x.giro ?? ''}</td></tr>`)}</tbody></table></div>`}
    ${zonas.some((x) => x.tipo === 'lixeira') && html`<${Alarmes} motor=${motor} vazio="Nenhuma lixeira cheia." />`}
    ${!mesas.length && !zonas.length && html`<p class="hint tight">Desenhe áreas <b>Ocupação · mesa</b>, <b>· vaga</b> ou <b>· lixeira</b>.</p>`}
  `;
}

// ------------------------------------------------------------------ medidor

function SecaoMedidor() {
  const d = ler('medidor');
  const it = d ? d.itens : [];
  const exp = () => baixarCsv('medidor', ['medidor', 'instante', 'leitura', 'unidade'], it.flatMap((x) => x.hist.map(([t, v]) => [x.nome, hora(t, x.relogio), v, x.unidade])));
  return html`
    <${Cab} titulo="Hidrômetro / medidor">
      <button class="btn tiny" onClick=${exp} disabled=${!it.some((x) => x.hist.length)}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('medidor')}>Zerar</button>
    <//>
    ${it.map((x) => html`<div class="med-instr" key=${x.id}>
      <div class="med-instr-v"><b>${Number.isFinite(x.valor) ? f(x.valor, x.casas) : '—'}</b><em>${x.unidade}</em></div>
      <div class="med-instr-n">${x.nome} · consumo ${x.consumo != null ? f(x.consumo, x.casas) : '—'} ${x.unidade}${x.porHora != null ? ` · ${f(x.porHora, 3)} ${x.unidade}/h` : ''}
        ${x.rejeitadas ? ` · ${x.rejeitadas} leitura(s) rejeitada(s)` : ''}${x.bruto ? ` · lido: "${x.bruto}"` : ''}</div></div>`)}
    ${!it.length && html`<p class="hint tight">Desenhe a área <b>Medidor · leitura</b> justa sobre os números.</p>`}
  `;
}

// ------------------------------------------------------------------ resumo de vídeo

function irPara(t) {
  const v = videoDaFonte();
  if (v && Number.isFinite(t)) { v.currentTime = Math.max(0, t); return true; }
  return false;
}

function SecaoResumo() {
  const d = ler('resumo');
  const [msg, setMsg] = useState('');
  const ev = d ? d.eventos : [];
  if (!d) return html`<${Cab} titulo="Resumo de vídeo" /><p class="hint tight">Aguardando quadros.</p>`;
  const video = d.relogio === 'video';
  const t0 = video ? 0 : d.t0, t1 = Math.max(d.t, t0 + 1);
  const v = videoDaFonte();
  const T1 = video && v && Number.isFinite(v.duration) ? Math.max(t1, v.duration) : t1;
  const W = 300, H = 46;
  const X = (t) => ((t - t0) / (T1 - t0)) * W;
  const mx = Math.max(d.limiar * 3, ...d.serie.map((s) => s[1]));
  const pts = d.serie.map(([t, a]) => `${X(t).toFixed(1)},${(H - (a / mx) * (H - 4)).toFixed(1)}`).join(' ');
  const clicar = (e) => {
    if (!video) { setMsg('Ir ao instante funciona com vídeo de arquivo.'); return; }
    const r = e.currentTarget.getBoundingClientRect();
    irPara(t0 + ((e.clientX - r.left) / r.width) * (T1 - t0));
  };
  const exp = () => baixarCsv('resumo_eventos', ['evento', 'inicio', 'fim', 'duracao_s', 'pico_atividade'], ev.map((e) => [e.id, hora(e.t0, d.relogio), hora(e.t1, d.relogio), (e.t1 - e.t0).toFixed(1), e.pico.toFixed(3)]));
  const editor = () => {
    if (!video || !v || !v.src) { setMsg('O editor recebe marcadores quando a fonte é um vídeo de arquivo.'); return; }
    abrirEditorVideo({ url: v.src, nome: 'resumo-eventos', marcadores: ev.map((e) => Math.round(e.t0 * 1e6)) });
  };
  return html`
    <${Cab} titulo="Resumo de vídeo">
      <button class="btn tiny" onClick=${editor} disabled=${!ev.length} title="Abre no GPlanSiS|Vídeo com um marcador no início de cada evento">Abrir no editor</button>
      <button class="btn tiny" onClick=${exp} disabled=${!ev.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('resumo')}>Zerar</button>
    <//>
    <p class="hint tight">${ev.length} evento(s) · ${f(d.cobertura.s, 0)} s com movimento (${Math.round(d.cobertura.frac * 100)} % do observado). ${video ? 'Clique na linha do tempo ou num evento para ir ao instante.' : ''}</p>
    <svg viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Linha do tempo de atividade e eventos" onClick=${clicar}
      style=${{ width: '100%', height: '52px', cursor: video ? 'pointer' : 'default', background: 'var(--bg-2)', borderRadius: '4px', display: 'block' }}>
      ${ev.map((e) => html`<rect key=${e.id} x=${X(e.t0)} y="0" width=${Math.max(1.5, X(e.t1) - X(e.t0))} height=${H} fill="var(--signal)" opacity="0.45" />`)}
      <polyline points=${pts} fill="none" stroke="var(--cyan)" stroke-width="1.2" vector-effect="non-scaling-stroke" />
      <line x1="0" x2=${W} y1=${H - (d.limiar / mx) * (H - 4)} y2=${H - (d.limiar / mx) * (H - 4)} stroke="var(--err)" stroke-dasharray="3 3" stroke-width="0.8" vector-effect="non-scaling-stroke" />
    </svg>
    ${msg && html`<p class="hint tight">${msg}</p>`}
    ${ev.length > 0 && html`<ul class="med-lista" style=${{ maxHeight: '260px', overflow: 'auto' }}>${ev.slice(-30).reverse().map((e) => html`
      <li key=${e.id} style=${{ display: 'flex', gap: '8px', alignItems: 'center', cursor: video ? 'pointer' : 'default' }} onClick=${() => irPara(e.t0)}>
        ${e.thumb ? html`<img src=${e.thumb} alt="" style=${{ width: '64px', borderRadius: '3px' }} />` : null}
        <span><b>#${e.id}</b> ${hora(e.t0, d.relogio)} → ${hora(e.t1, d.relogio)} (${f(e.t1 - e.t0, 1)} s)${e.aberto ? ' · em curso' : ''}</span></li>`)}</ul>`}
  `;
}

// ------------------------------------------------------------------ velocidade

function SecaoVelocidade() {
  const d = ler('velocidade');
  const R = d ? d.resumo : {};
  const ms = d ? d.medidas : [];
  const exp = () => baixarCsv('velocidade', ['id', 'classe', 'sentido', 'instante_A_ou_B', 'tempo_s', 'velocidade_km_h', 'acima_do_limite'],
    ms.map((m) => [m.id, m.classe, m.sentido, hora(m.t0, d.relogio), m.dt.toFixed(3), m.v.toFixed(1), d.limite > 0 && m.v > d.limite ? 'sim' : 'não']));
  const grupos = Object.entries(R).filter(([, s]) => s.n);
  return html`
    <${Cab} titulo="Velocidade (duas linhas)">
      <button class="btn tiny" onClick=${exp} disabled=${!ms.length}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('velocidade')}>Zerar</button>
    <//>
    ${d && html`<p class="hint tight">${d.linhas && d.linhas.length === 2 ? `${d.linhas[0]} ↔ ${d.linhas[1]} · ` : ''}distância ${f(d.distancia, 1)} m (${d.origemDist || '—'})${d.limite ? ` · limite ${d.limite} km/h` : ''}${d.semId ? ' · sem IDs: ponha Tracking com IDs' : ''}</p>`}
    ${grupos.length ? html`<div class="med-tab"><table><thead><tr><th>grupo</th><th>n</th><th>média</th><th>mediana</th><th>V85</th><th>máx</th><th>acima</th></tr></thead>
      <tbody>${grupos.map(([k, s]) => html`<tr key=${k}><td>${k}</td><td class="v">${s.n}</td><td class="v">${f(s.media, 1)}</td><td class="v">${f(s.mediana, 1)}</td>
        <td class="v s">${f(s.v85, 1)}</td><td class="v">${f(s.max, 1)}</td><td class="v">${s.excessos}</td></tr>`)}</tbody></table></div>`
      : html`<p class="hint tight">Nenhum veículo cruzou as duas linhas ainda.</p>`}
  `;
}
