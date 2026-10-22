/**
 * cv/runtime/livres-e/relatorio.js — exportação da sessão de Bike Fit:
 * dados (JSON), planilha (CSV com ; e vírgula decimal, como o Excel em
 * português abre direto) e um relatório HTML para imprimir / salvar em PDF.
 * Só monta texto: quem baixa ou abre a janela é o painel.
 */
import { PERFIS, METRICAS, FRONTAL, status, recomendacoes, cmPorPx, num, textoJoelhoPMI } from './bikefit.js';
import { alvosSessao, obterAtleta } from './canal.js';
import { medidasSugeridas, resumoAtleta, NOMES_FAIXA, CHAVES_FAIXA } from './atleta.js';

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

/** Retrato serializável da sessão. cfg = { perfil, vista, lado, nCiclos, alturaCm, pernaCm }. */
export function dadosSessao(sessao, cfg = {}) {
  const perfil = PERFIS[cfg.perfil] ? cfg.perfil : 'Estrada';
  const n = cfg.nCiclos || 10;
  const res = sessao.resumo(n);
  const ult = sessao.registro.length ? sessao.registro[sessao.registro.length - 1] : null;
  const perna = sessao.pernaPx();
  // atleta e alvos da sessão (os mesmos do operador, do painel e do Studio)
  const atleta = cfg.atleta || obterAtleta();
  const alvos = cfg.alvos || alvosSessao(perfil);
  // escala: a altura do atleta (a mesma regra do operador); sem ela, a do nó
  const alturaCm = atleta.alturaCm || cfg.alturaCm || 0;
  const cmPx = cmPorPx(perna, { ...cfg, alturaCm });
  const geo = { coxa: ult && ult.coxa, canela: ult && ult.canela, cmPx };
  const resumo = {};
  for (const [k, s] of Object.entries(res)) {
    resumo[k] = s && typeof s === 'object' ? { n: s.n, media: r1(s.media), dp: r1(s.dp), min: r1(s.min), max: r1(s.max) } : s;
  }
  const t0 = sessao.t0 || 0;
  const est = sessao.estadoMedicao ? sessao.estadoMedicao() : {};
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Bike Fit (CV-28)',
    perfil, vista: cfg.vista || 'lateral', lado: cfg.lado || '—', nCiclos: n,
    calibracao: cmPx ? { cmPorPx: Math.round(cmPx * 10000) / 10000, alturaCm, pernaCm: cfg.pernaCm || 0 } : null,
    faixas: alvos.faixas, faixasModalidade: PERFIS[perfil], frontal: FRONTAL,
    atleta: { ...atleta, resumo: resumoAtleta(atleta) },
    alvos: Object.fromEntries(CHAVES_FAIXA.map((k) => [k, {
      nome: NOMES_FAIXA[k], faixa: alvos.linhas[k].faixa, modalidade: alvos.linhas[k].base, calculada: alvos.linhas[k].calculada,
      manual: alvos.linhas[k].override, personalizado: alvos.linhas[k].mudou, porque: alvos.linhas[k].porque,
    }])),
    regrasAtleta: alvos.regras,
    medidasSugeridas: medidasSugeridas(atleta, alvos),
    pedaladas: sessao.pedaladas, cadencia: r1(sessao.cadencia()),
    lacunas: sessao.lacunas || 0, descartes: sessao.descartes || 0,
    medicao: { poseHz: r1(est.taxa), indicativo: est.indicativo || null, avisos: est.avisos || [] },
    duracaoS: ult ? r1((ult.t - t0) / 1000) : 0,
    resumo,
    recomendacoes: recomendacoes(res, perfil, geo, cfg.vista, { ...est, faixas: alvos.faixas }),
    ciclos: sessao.ciclos.map((c) => {
      const o = {};
      for (const [k, v] of Object.entries(c)) o[k] = typeof v === 'number' ? r1(v) : v;
      return o;
    }),
    congelados: sessao.congelados.map((c) => ({
      tipo: c.tipo, t: r1((c.t - t0) / 1000), thumb: c.thumb || null,
      ang: Object.fromEntries(Object.entries((c.amostra && c.amostra.ang) || {}).map(([k, v]) => [k, r1(v)])),
    })),
    amostras: sessao.registro.map((a) => ({
      t: r1((a.t - t0) / 1000), lado: a.lado,
      ang: Object.fromEntries(Object.entries(a.ang || {}).map(([k, v]) => [k, r1(v)])),
      kops: r1(a.kops), peY: r1(a.peY),
      desvioE: a.frontal ? r1(a.frontal.e) : null, desvioD: a.frontal ? r1(a.frontal.d) : null,
    })),
  };
}

const COLS = ['tipo', 'n', 't_s', 'periodo_ms', 'cadencia_rpm', 'joelho', 'quadril', 'tronco', 'ombro', 'cotovelo',
  'tornozelo', 'kops_pct', 'desvio_joelho_esq_pct', 'desvio_joelho_dir_pct', 'joelho_PMI', 'joelho_PMS',
  'quadril_min', 'tronco_med', 'ombro_med', 'cotovelo_med', 'tornozelo_PMI', 'ankling'];

const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/[;\n"]/g, ' '));

/** Uma linha por pedalada (tipo=ciclo) e uma por amostra da pose (tipo=amostra). */
export function csvSessao(d) {
  const linhas = [COLS.join(';')];
  for (const c of d.ciclos) {
    linhas.push([
      'ciclo', c.n, r1((c.fim || 0) / 1000), c.periodo, c.cadencia, '', '', '', '', '', '', c.kops, c.desvioE, c.desvioD,
      c.joelhoMax, c.joelhoMin, c.quadrilMin, c.troncoMed, c.ombroMed, c.cotoveloMed, c.tornozeloPMI, c.ankling,
    ].map(cel).join(';'));
  }
  for (const a of d.amostras) {
    const g = a.ang || {};
    linhas.push([
      'amostra', '', a.t, '', '', g.joelho, g.quadril, g.tronco, g.ombro, g.cotovelo, g.tornozelo, a.kops,
      a.desvioE, a.desvioD, '', '', '', '', '', '', '', '',
    ].map(cel).join(';'));
  }
  // segundo bloco: atleta e alvos usados (o Excel abre as duas tabelas na mesma planilha)
  if (d.alvos) {
    linhas.push('');
    linhas.push(['atleta', d.atleta ? d.atleta.nome : '', d.atleta ? d.atleta.resumo : ''].map(cel).join(';'));
    linhas.push(['alvo', 'medida', 'min', 'max', 'modalidade_min', 'modalidade_max', 'personalizado', 'manual', 'porque'].join(';'));
    for (const a of Object.values(d.alvos)) {
      linhas.push(['alvo', a.nome, a.faixa[0], a.faixa[1], a.modalidade[0], a.modalidade[1], a.personalizado ? 'sim' : 'não',
        a.manual ? 'sim' : 'não', a.porque.join(' ')].map(cel).join(';'));
    }
    if (d.medidasSugeridas && d.medidasSugeridas.length) {
      linhas.push(['medida_sugerida', 'nome', 'valor (ponto de partida)', 'nota'].join(';'));
      for (const m of d.medidasSugeridas) linhas.push(['medida_sugerida', m.nome, m.valor, m.nota].map(cel).join(';'));
    }
  }
  return linhas.join('\n') + '\n';
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, un = '°') => (v == null ? '—' : `${num(v, Number.isInteger(v) ? 0 : 1)}${un}`);
const COR = { ok: '#15803d', perto: '#a16207', fora: '#b91c1c', sem: '#64748b' };
const ROT = { ok: 'na faixa', perto: 'perto', fora: 'fora', sem: '—' };

/** Seção "Atleta": perfil, alvos usados e por quê, medidas sugeridas. */
function secaoAtleta(d) {
  const a = d.atleta;
  const alvos = Object.values(d.alvos || {}).map((x) => `<tr><td>${esc(x.nome)}</td><td><b>${esc(faixaTxt2(x.faixa))}</b>${x.personalizado ? ' •' : ''}${x.manual ? ' (manual)' : ''}</td>
    <td>${esc(faixaTxt2(x.modalidade))}</td><td class="nota">${esc(x.porque.join(' '))}</td></tr>`).join('');
  const med = (d.medidasSugeridas || []).map((m) => `<tr><td>${esc(m.nome)}</td><td><b>${esc(m.valor)}</b></td><td class="nota" colspan="2">${esc(m.nota)}</td></tr>`).join('');
  return `<h2>Atleta: ${esc(a.nome)}</h2><p class="meta">${esc(a.resumo)}</p>
<table><tr><th>Medida</th><th>Alvo usado</th><th>Modalidade (${esc(d.perfil)})</th><th>Por quê</th></tr>${alvos}</table>
<p class="nota">• = personalizado pelo perfil do atleta (regras conservadoras: Holmes 1994; Bini, Hume &amp; Croft 2011; Fintelman 2014;
Van Hoof 2012; Burt 2014). Altura e peso não mudam faixas angulares; o peso só entra pelo IMC.</p>
${med ? `<h2>Medidas sugeridas (ponto de partida)</h2><table>${med}</table><p class="nota">Fórmulas de partida (LeMond 0,883 × entrepernas;
Hamley 1,09 × entrepernas): a altura final do selim vem do ângulo do joelho medido em movimento.</p>` : ''}`;
}
const faixaTxt2 = (f) => (!f ? '—' : f[0] < 0 || f[1] < 0 ? `${num(f[0], 0)} a ${num(f[1], 0)}` : `${f[0]}–${f[1]}`);

/** Relatório HTML autônomo (abre numa aba; o botão imprime / salva em PDF). */
export function htmlRelatorio(d) {
  const linhas = METRICAS.map((m) => {
    const s = d.resumo[m.k] || {};
    const faixa = d.faixas[m.faixa];
    const st = status(s.media, faixa, m.un === '%' ? 2 : 5);
    return `<tr><td>${esc(m.nome)}</td><td>${fmt(s.media, m.un)}</td><td>${s.dp == null ? '—' : '± ' + fmt(s.dp, m.un)}</td>
      <td>${fmt(s.min, m.un)} / ${fmt(s.max, m.un)}</td><td>${faixa ? `${num(faixa[0], 0)} a ${num(faixa[1], 0)}${m.un}` : '—'}${d.alvos && d.alvos[m.faixa] && d.alvos[m.faixa].personalizado ? ' <b title="personalizado para o atleta">•</b>' : ''}</td>
      <td style="color:${COR[st]};font-weight:600">${ROT[st]}</td></tr>`;
  }).join('');
  const fr = d.vista === 'frontal' ? ['desvioE', 'desvioD'].map((k) => {
    const s = d.resumo[k] || {};
    return `<tr><td>Joelho ${k === 'desvioE' ? 'esquerdo' : 'direito'} (desvio)</td><td>${fmt(s.media, '%')}</td>
      <td>${s.dp == null ? '—' : '± ' + fmt(s.dp, '%')}</td><td>${fmt(s.min, '%')} / ${fmt(s.max, '%')}</td><td>−5 a 5%</td>
      <td>${ROT[status(s.media, FRONTAL.desvio, 3)]}</td></tr>`;
  }).join('') : '';
  const recs = d.recomendacoes.map((r) => `<li><b style="color:${COR[r.nivel] || COR.sem}">${esc(r.area)}:</b> ${esc(r.texto)}</li>`).join('');
  const cong = d.congelados.slice(-6).map((c) => `<figure>${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}
      <figcaption><b>${c.tipo}</b> · ${fmt(c.t, ' s')}<br>joelho ${fmt(c.ang.joelho)} · quadril ${fmt(c.ang.quadril)}</figcaption></figure>`).join('');
  const ciclos = d.ciclos.slice(-30).map((c) => `<tr><td>${c.n}</td><td>${fmt(c.cadencia, '')}</td><td>${fmt(c.joelhoMax)}</td>
      <td>${fmt(c.joelhoMin)}</td><td>${fmt(c.quadrilMin)}</td><td>${fmt(c.troncoMed)}</td><td>${fmt(c.ankling)}</td><td>${fmt(c.kops, '%')}</td></tr>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório Bike Fit</title><style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px;max-width:900px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
.meta{color:#475569;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}th{background:#f1f5f9}
.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpis div{border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px}
.kpis b{display:block;font-size:20px}figure{display:inline-block;margin:0 10px 10px 0;width:150px;font-size:12px}
figure img{width:150px;height:150px;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1}
li{margin-bottom:6px}.nota{font-size:12px;color:#475569}button{font:inherit;padding:8px 16px;margin-top:10px;cursor:pointer}
@media print{button{display:none}body{padding:0}}@media (max-width:600px){body{padding:14px}td,th{padding:4px 3px;font-size:12px}}
</style></head><body>
<h1>Relatório de Bike Fit</h1>
<div class="meta">${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · perfil <b>${esc(d.perfil)}</b> · vista ${esc(d.vista)} · lado ${esc(d.lado)}
${d.calibracao ? ` · escala ${String(d.calibracao.cmPorPx).replace('.', ',')} cm/px` : ''}</div>
<button onclick="print()">Imprimir / salvar em PDF</button>
${d.atleta ? secaoAtleta(d) : ''}
<h2>Resumo</h2><div class="kpis"><div><b>${d.pedaladas}</b>pedaladas</div><div><b>${fmt(d.cadencia, '')}</b>rpm</div>
<div><b>${fmt(d.duracaoS, ' s')}</b>de sessão</div></div>
<h2>Ângulos (últimas ${d.nCiclos} pedaladas)</h2>
<table><tr><th>Medida</th><th>Média</th><th>Desvio</th><th>Mín / máx</th><th>Faixa alvo</th><th>Status</th></tr>${d.vista === 'frontal' ? fr : linhas}</table>
<h2>Recomendações</h2>${d.medicao && d.medicao.avisos.length ? `<p class="nota" style="color:#b91c1c">${d.medicao.avisos.map(esc).join('<br>')}</p>` : ''}<ul>${recs}</ul>
<p class="nota">Sugestões de partida baseadas em faixas usuais de bike fit dinâmico; mude uma coisa por vez, em passos pequenos,
e confirme com nova medição. Dor ou lesão: procure um profissional de bike fit ou de saúde.</p>
${cong ? `<h2>Poses congeladas (PMI / PMS)</h2>${cong}` : ''}
${ciclos ? `<h2>Pedaladas</h2><table><tr><th>#</th><th>rpm</th><th>Joelho PMI</th><th>Joelho PMS</th><th>Quadril mín</th><th>Tronco</th><th>Ankling</th><th>KOPS</th></tr>${ciclos}</table>` : ''}
<h2>Convenções</h2><p class="nota">Ângulos internos em 2D (180° = reto). Joelho: quadril–joelho–tornozelo; no PMI (ponto morto
inferior), ${esc(textoJoelhoPMI(d.perfil, d.faixas).replace(/^Joelho no PMI /, ''))} (perfil ${esc(d.perfil)}). Quadril: ombro–quadril–joelho (mínimo no topo). Tronco: quadril→ombro em relação à
horizontal. Ombro: quadril–ombro–cotovelo. Cotovelo: ombro–cotovelo–punho. Tornozelo: joelho–tornozelo–ponta do pé; ankling = amplitude
no ciclo. KOPS: distância horizontal joelho → eixo do pedal estimado com o pé à frente (3 h), em % da perna (positivo = joelho à frente).
Medição por pose estimada (BlazePose) a partir de vídeo, sem marcadores: espere alguns graus de erro.</p>
</body></html>`;
}
