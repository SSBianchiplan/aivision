/**
 * cv/runtime/livres-g/relatorio.js — exportação do treino da Academia:
 * dados (JSON), planilha (CSV com ; e vírgula decimal, como o Excel em
 * português abre direto) e um relatório HTML para imprimir / salvar em PDF.
 * Só monta texto: quem baixa ou abre a janela é o painel.
 */
import { EXERCICIOS, LIMITES, num, mmss } from './academia.js';

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

/** Retrato serializável do treino. cfg = { exercicio, metaSeries, metaReps, metaSegundos, descansoS, pausaSerieS, tolerancia }. */
export function dadosTreino(treino, cfg = {}) {
  const res = treino.resumo();
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Academia (CV-30)',
    config: {
      exercicio: cfg.exercicio || 'automático', metaSeries: cfg.metaSeries, metaReps: cfg.metaReps,
      metaSegundos: cfg.metaSegundos, descansoS: cfg.descansoS, pausaSerieS: cfg.pausaSerieS, tolerancia: cfg.tolerancia || 'normal',
    },
    resumo: {
      repeticoes: res.reps, boas: res.boas, comAlerta: res.alerta, series: res.series,
      tempoSobTensaoS: r1(res.tut), duracaoS: r1(res.duracao),
      qualidadePct: res.qualidade == null ? null : Math.round(res.qualidade * 100),
      movimentosCurtos: treino.curtas, descartadasImagemParada: treino.descartes,
    },
    porExercicio: res.porExercicio.map((o) => ({
      exercicio: o.nome, repeticoes: o.reps, boas: o.boas, comAlerta: o.alerta, series: o.series,
      tempoSobTensaoS: r1(o.tut), amplitudeMedia: r1(o.amplMed), excentricoMedioS: r2(o.excMed), concentricoMedioS: r2(o.conMed),
      alertas: o.alertas,
    })),
    series: treino.series.map((s) => ({
      n: s.n, exercicio: EXERCICIOS[s.ex] ? EXERCICIOS[s.ex].nome : s.ex, repeticoes: s.reps.length, boas: s.boas || 0, comAlerta: s.alerta || 0,
      inicioS: r1(s.tIni), fimS: r1(s.tFim), tempoSobTensaoS: r1(s.tut), ritmoRepMin: r1(s.ritmo), amplitudeMedia: r1(s.amplMed),
      descansoAntesS: r1(s.descansoAntes), alinhadoPct: s.alinhado == null ? null : Math.round(s.alinhado * 100), fechada: !!s.fechada,
    })),
    repeticoes: treino.reps.map((r) => ({
      n: r.n, serie: r.serie, nSerie: r.nSerie, exercicio: EXERCICIOS[r.ex].nome, tS: r1(r.t), duracaoS: r2(r.dur),
      excentricoS: r2(r.exc), concentricoS: r2(r.con), angMin: r1(r.vMin), angMax: r1(r.vMax), amplitude: r1(r.amp),
      profundidade: r2(r.prof), troncoFundo: r1(r.troncoFundo), vista: r.vista || null,
      alinhadoPct: r.alinhado == null ? null : Math.round(r.alinhado * 100),
      boa: r.boa, alertas: r.alertas.map((a) => a.msg),
    })),
    limites: LIMITES,
  };
}

const COLS = ['tipo', 'n', 'serie', 'rep_na_serie', 'exercicio', 't_s', 'duracao_s', 'excentrico_s', 'concentrico_s',
  'ang_min', 'ang_max', 'amplitude', 'profundidade', 'tronco_fundo', 'vista', 'alinhado_pct', 'qualidade', 'alertas',
  'reps', 'boas', 'com_alerta', 'tut_s', 'ritmo_rep_min', 'descanso_antes_s'];

const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/[;\n"]/g, ' '));

/** Uma linha por repetição (tipo=rep) e uma por série (tipo=serie). */
export function csvTreino(d) {
  const linhas = [COLS.join(';')];
  for (const r of d.repeticoes) {
    linhas.push([
      'rep', r.n, r.serie, r.nSerie, r.exercicio, r.tS, r.duracaoS, r.excentricoS, r.concentricoS, r.angMin, r.angMax,
      r.amplitude, r.profundidade, r.troncoFundo, r.vista, r.alinhadoPct, r.boa ? 'boa' : 'com alerta', r.alertas.join(' | '),
      '', '', '', '', '', '',
    ].map(cel).join(';'));
  }
  for (const s of d.series) {
    linhas.push([
      'serie', s.n, s.n, '', s.exercicio, s.inicioS, r1((s.fimS || 0) - (s.inicioS || 0)), '', '', '', '', s.amplitudeMedia, '', '', '',
      s.alinhadoPct, '', '', s.repeticoes, s.boas, s.comAlerta, s.tempoSobTensaoS, s.ritmoRepMin, s.descansoAntesS,
    ].map(cel).join(';'));
  }
  return linhas.join('\n') + '\n';
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fs = (v) => (v == null ? '—' : `${num(v, 1)} s`);
const fg = (v) => (v == null ? '—' : `${num(v, 0)}°`);

/** Relatório HTML autônomo (abre numa aba; o botão imprime / salva em PDF). */
export function htmlRelatorio(d) {
  const R = d.resumo;
  const exs = d.porExercicio.map((o) => `<tr><td>${esc(o.exercicio)}</td><td>${o.series}</td><td>${o.repeticoes}</td>
    <td style="color:#15803d;font-weight:600">${o.boas}</td><td style="color:#b45309;font-weight:600">${o.comAlerta}</td>
    <td>${fg(o.amplitudeMedia)}</td><td>${fs(o.excentricoMedioS)} / ${fs(o.concentricoMedioS)}</td><td>${fs(o.tempoSobTensaoS)}</td>
    <td>${o.alertas.slice(0, 3).map((a) => `${esc(a.curta || a.cod)} (${a.n})`).join('<br>') || '—'}</td></tr>`).join('');
  const series = d.series.map((s) => `<tr><td>${s.n}</td><td>${esc(s.exercicio)}</td><td>${s.repeticoes}</td><td>${s.boas}</td><td>${s.comAlerta}</td>
    <td>${s.ritmoRepMin == null ? '—' : num(s.ritmoRepMin, 1) + '/min'}</td><td>${fs(s.tempoSobTensaoS)}</td>
    <td>${s.descansoAntesS == null ? '—' : mmss(s.descansoAntesS)}</td><td>${s.alinhadoPct == null ? '—' : s.alinhadoPct + '%'}</td></tr>`).join('');
  const reps = d.repeticoes.slice(-200).map((r) => `<tr class="${r.boa ? 'boa' : 'alerta'}"><td>${r.n}</td><td>${r.serie}.${r.nSerie}</td>
    <td>${esc(r.exercicio)}</td><td>${r.angMin == null ? fs(r.duracaoS) : `${fg(r.angMin)}–${fg(r.angMax)}`}</td>
    <td>${fs(r.excentricoS)} / ${fs(r.concentricoS)}</td><td>${r.boa ? '✓ boa' : esc(r.alertas.join(' · '))}</td></tr>`).join('');
  const metas = d.config.metaSeries ? `meta ${d.config.metaSeries} × ${d.config.metaReps} · descanso ${mmss(d.config.descansoS)}` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de treino</title><style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px;max-width:920px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
.meta{color:#475569;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left;vertical-align:top}th{background:#f1f5f9}
tr.alerta td:last-child{color:#b45309}tr.boa td:last-child{color:#15803d}
.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpis div{border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;min-width:90px}
.kpis b{display:block;font-size:20px}.nota{font-size:12px;color:#475569}button{font:inherit;padding:8px 16px;margin-top:10px;cursor:pointer}
@media print{button{display:none}body{padding:0}}@media (max-width:600px){body{padding:14px}td,th{padding:4px 3px;font-size:12px}}
</style></head><body>
<h1>Relatório de treino</h1>
<div class="meta">${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · exercício ${esc(d.config.exercicio)} · tolerância ${esc(d.config.tolerancia)}${metas ? ' · ' + esc(metas) : ''}</div>
<button onclick="print()">Imprimir / salvar em PDF</button>
<h2>Resumo</h2><div class="kpis"><div><b>${R.repeticoes}</b>repetições</div><div><b style="color:#15803d">${R.boas}</b>boas</div>
<div><b style="color:#b45309">${R.comAlerta}</b>com alerta</div><div><b>${R.series}</b>séries</div>
<div><b>${R.qualidadePct == null ? '—' : R.qualidadePct + '%'}</b>qualidade</div><div><b>${mmss(R.tempoSobTensaoS)}</b>sob tensão</div>
<div><b>${mmss(R.duracaoS)}</b>de treino</div></div>
${exs ? `<h2>Por exercício</h2><table><tr><th>Exercício</th><th>Séries</th><th>Reps</th><th>Boas</th><th>Alerta</th><th>Amplitude</th><th>Exc. / conc.</th><th>Sob tensão</th><th>Alertas mais comuns</th></tr>${exs}</table>` : ''}
${series ? `<h2>Séries</h2><table><tr><th>#</th><th>Exercício</th><th>Reps</th><th>Boas</th><th>Alerta</th><th>Ritmo</th><th>Sob tensão</th><th>Descanso antes</th><th>Alinhado</th></tr>${series}</table>` : ''}
${reps ? `<h2>Repetições</h2><table><tr><th>#</th><th>Série</th><th>Exercício</th><th>Amplitude</th><th>Exc. / conc.</th><th>Qualidade</th></tr>${reps}</table>` : ''}
<h2>Como foi medido</h2><p class="nota">Pose estimada pela câmera (BlazePose, 33 pontos, no navegador), sem marcadores. Ângulos internos
em 2D (180° = reto). Uma repetição é um ciclo repouso → trabalho → repouso da articulação principal; os tempos excêntrico e
concêntrico são medidos entre 20% e 100% do caminho (sem a pausa parada no alto). Tempo sob tensão = soma das durações das repetições.
Uma pausa maior que ${esc(d.config.pausaSerieS || 10)} s fecha a série. As checagens de forma são aproximações em 2D — filme de lado
(tronco, joelho × ponta do pé, quadril, costas) ou de frente (valgo, assimetria). São alertas de treino, não diagnóstico:
dor ou lesão, procure um profissional de educação física ou de saúde.</p>
</body></html>`;
}
