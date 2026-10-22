/**
 * cv/runtime/livres-f/relatorio.js — exportação da sessão de Ergonomia:
 * dados (JSON), planilha (CSV com ; e vírgula decimal, como o Excel em
 * português abre direto) e um relatório HTML para imprimir / salvar em PDF.
 * Só monta texto: quem baixa ou abre a janela é o painel.
 */
import {
  FAIXAS, NIVEIS, nivel, corDe, corSegmento, recomendacoes, num, NOMES_SEG,
  TEXTO_CARGA_RULA, TEXTO_CARGA_REBA, TEXTO_PEGA,
} from './ergonomia.js';

const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);
const angs = (a) => Object.fromEntries(Object.entries(a || {}).map(([k, v]) => [k, r1(v)]));

export const AVISO = 'Estimativa a partir de pose 2D de vídeo, sem marcadores: os ângulos têm erro de alguns graus ' +
  'e dependem da posição da câmera. Esta avaliação NÃO substitui a análise ergonômica do trabalho (AET, NR-17) ' +
  'nem a avaliação de um ergonomista.';

/** Resumo de uma avaliação (para JSON/relatório). */
function resumoAval(av) {
  if (!av || !av.ok) return null;
  return {
    lado: av.lado === 'e' ? 'esquerdo' : 'direito', vista: av.vista, sentado: av.sentado,
    rula: { nota: av.rula.final, posturaA: av.rula.postA, A: av.rula.A, posturaB: av.rula.postB, B: av.rula.B, segmentos: av.rula.seg, musculo: av.rula.musculo, carga: av.rula.carga },
    reba: { nota: av.reba.final, tabelaA: av.reba.tabA, A: av.reba.A, tabelaB: av.reba.tabB, B: av.reba.B, C: av.reba.C, atividade: av.reba.atividade, segmentos: av.reba.seg },
    angulos: angs(av.ang), assumidos: av.assumidos,
  };
}

/** Retrato serializável da sessão. cfg = parâmetros do nó (método, cargas, ajustes). */
export function dadosSessao(sessao, cfg = {}) {
  const M = cfg.metodo === 'REBA' ? 'REBA' : 'RULA';
  const t0 = sessao.t0 || 0;
  const pessoas = [...sessao.pessoas.values()].filter((p) => p.tempo > 0 || p.pico.RULA).map((p) => {
    const met = {};
    for (const K of ['RULA', 'REBA']) {
      const tot = p.faixas[K].reduce((a, b) => a + b, 0);
      const pk = p.pico[K];
      met[K] = {
        media: tot > 0 ? r1(p.soma[K] / tot) : null,
        pctFaixas: Object.fromEntries(FAIXAS.map((f, i) => [f.nome, tot > 0 ? r1((100 * p.faixas[K][i]) / tot) : 0])),
        pico: pk ? { nota: pk.nota, nivel: nivel(K, pk.nota).nome, t: r1((pk.t - t0) / 1000), thumb: pk.thumb || null, pose: pk.pose || null, avaliacao: resumoAval(pk.aval) } : null,
      };
    }
    const pk = p.pico[M];
    return {
      id: p.id, tempoS: r1(p.tempo), primeiroS: r1((p.primeiro - t0) / 1000), ultimoS: r1((p.ultimo - t0) / 1000),
      RULA: met.RULA, REBA: met.REBA,
      recomendacoes: pk ? recomendacoes(pk.aval, cfg) : [],
      serie: p.serie.map((s) => ({ t: r1((s.t - t0) / 1000), rula: s.rula, reba: s.reba, lado: s.lado, vista: s.vista,
        tronco: r1(s.tronco), pescoco: r1(s.pescoco), braco: r1(s.braco), antebraco: r1(s.antebraco), punho: r1(s.punho), joelho: r1(s.joelho) })),
    };
  });
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Ergonomia RULA/REBA (CV-29)',
    metodo: M,
    referencias: [
      'McAtamney L, Corlett EN. RULA: a survey method for the investigation of work-related upper limb disorders. Applied Ergonomics 24(2):91–99, 1993.',
      'Hignett S, McAtamney L. Rapid Entire Body Assessment (REBA). Applied Ergonomics 31(2):201–205, 2000.',
    ],
    parametros: {
      cargaRula: cfg.cargaRula ?? 0, musculoRula: Boolean(cfg.musculoRula), punhoTorcao: cfg.punhoTorcao ?? 1, punhoSemMaos: cfg.punhoSemMaos ?? 2,
      cargaReba: cfg.cargaReba ?? 0, choque: Boolean(cfg.choque), pega: cfg.pega ?? 0,
      estatica: Boolean(cfg.estatica), repetitiva: Boolean(cfg.repetitiva), instavel: Boolean(cfg.instavel), estaticaAuto: cfg.estaticaAuto !== false,
      ombroElevado: Boolean(cfg.ombroElevado), bracoApoiado: Boolean(cfg.bracoApoiado), troncoTorcido: Boolean(cfg.troncoTorcido), pescocoTorcido: Boolean(cfg.pescocoTorcido),
      lado: cfg.lado || 'pior lado', vista: cfg.vista || 'automática', alertaFaixa: cfg.alertaFaixa ?? 3, alertaSeg: cfg.alertaSeg ?? 10,
    },
    duracaoS: sessao.tUlt != null ? r1((sessao.tUlt - t0) / 1000) : 0,
    pessoas,
    alertas: sessao.alertas.map((a) => ({ pessoa: a.id, metodo: a.metodo, inicioS: r1((a.inicio - t0) / 1000),
      disparoS: r1((a.t - t0) / 1000), fimS: a.fim != null ? r1((a.fim - t0) / 1000) : null, pico: a.pico })),
    aviso: AVISO,
  };
}

const COLS = ['pessoa', 't_s', 'rula', 'nivel_rula', 'reba', 'nivel_reba', 'lado', 'vista',
  'tronco', 'pescoco', 'braco', 'antebraco', 'punho', 'joelho'];
const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/[;\n"]/g, ' '));

/** Uma linha por pessoa por segundo (série 1 Hz), depois o resumo e os alertas. */
export function csvSessao(d) {
  const L = [COLS.join(';')];
  for (const p of d.pessoas) {
    for (const s of p.serie) {
      L.push([p.id, s.t, s.rula, nivel('RULA', s.rula)?.nome, s.reba, nivel('REBA', s.reba)?.nome,
        s.lado === 'e' ? 'esquerdo' : s.lado === 'd' ? 'direito' : '', s.vista,
        s.tronco, s.pescoco, s.braco, s.antebraco, s.punho, s.joelho].map(cel).join(';'));
    }
  }
  // resumo por método, com os nomes dos níveis de ação de cada um
  for (const K of ['RULA', 'REBA']) {
    L.push('');
    L.push(['resumo', 'pessoa', 'metodo', 'media', 'pico', 'tempo_s', ...NIVEIS[K].map((n) => `%${n.nome} (${n.de === n.ate ? n.de : n.de + '-' + n.ate})`)].map(cel).join(';'));
    for (const p of d.pessoas) {
      const m = p[K];
      L.push(['resumo', p.id, K, m.media, m.pico ? m.pico.nota : '', p.tempoS, ...NIVEIS[K].map((n) => m.pctFaixas[FAIXAS[n.faixa].nome])].map(cel).join(';'));
    }
  }
  if (d.alertas.length) {
    L.push('');
    L.push(['alerta', 'pessoa', 'metodo', 'inicio_s', 'disparo_s', 'fim_s', 'pico'].join(';'));
    for (const a of d.alertas) L.push(['alerta', a.pessoa, a.metodo, a.inicioS, a.disparoS, a.fimS, a.pico].map(cel).join(';'));
  }
  return L.join('\n') + '\n';
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Cor legível sobre papel branco (amarelo e verde-claro escurecidos). */
const tinta = (c) => ({ '#facc15': '#a16207', '#4ade80': '#15803d', '#22c55e': '#15803d' }[c] || c);
const fg = (v) => (v == null ? '—' : `${num(v, 0)}°`);

/** Linhas do esqueleto (COCO) na miniatura, coloridas pelo escore de cada segmento. */
function svgPose(pico, M) {
  if (!pico || !pico.pose || !pico.avaliacao) return '';
  const { T, pts } = pico.pose;
  const seg = pico.avaliacao[M === 'REBA' ? 'reba' : 'rula'].segmentos;
  const L = [[5, 7, 'braco'], [7, 9, 'antebraco'], [6, 8, 'braco'], [8, 10, 'antebraco'], [11, 13, 'pernas'], [13, 15, 'pernas'],
    [12, 14, 'pernas'], [14, 16, 'pernas'], [5, 6, null], [11, 12, null]];
  const linhas = L.filter(([a, b]) => pts[a] && pts[b] && pts[a].v >= 0.3 && pts[b].v >= 0.3).map(([a, b, s]) =>
    `<line x1="${pts[a].x.toFixed(1)}" y1="${pts[a].y.toFixed(1)}" x2="${pts[b].x.toFixed(1)}" y2="${pts[b].y.toFixed(1)}" stroke="${s ? corSegmento(M, s, seg[s]) : '#cbd5e1'}" stroke-width="3" stroke-linecap="round"/>`);
  const mid = (a, b) => (pts[a].v >= 0.3 && pts[b].v >= 0.3 ? { x: (pts[a].x + pts[b].x) / 2, y: (pts[a].y + pts[b].y) / 2 } : null);
  const o = mid(5, 6), q = mid(11, 12);
  if (o && q) linhas.push(`<line x1="${q.x.toFixed(1)}" y1="${q.y.toFixed(1)}" x2="${o.x.toFixed(1)}" y2="${o.y.toFixed(1)}" stroke="${corSegmento(M, 'tronco', seg.tronco)}" stroke-width="4" stroke-linecap="round"/>`);
  return `<svg viewBox="0 0 ${T} ${T}" style="position:absolute;inset:0;width:100%;height:100%">${linhas.join('')}</svg>`;
}

/** Linha do tempo (SVG) da nota no método, com a faixa de alerta. */
function svgSerie(serie, M, limFaixa) {
  if (!serie || serie.length < 2) return '';
  const k = M === 'REBA' ? 'reba' : 'rula', max = M === 'REBA' ? 15 : 7;
  const t0 = serie[0].t, t1 = serie[serie.length - 1].t || t0 + 1;
  const W = 640, H = 120;
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W, y = (v) => H - (v / max) * (H - 8) - 4;
  const lim = NIVEIS[M].find((n) => n.faixa >= limFaixa);
  const pts = serie.map((s) => `${x(s.t).toFixed(1)},${y(s[k]).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;border:1px solid #e2e8f0;border-radius:6px">
    ${lim ? `<line x1="0" x2="${W}" y1="${y(lim.de - 0.5)}" y2="${y(lim.de - 0.5)}" stroke="#ef4444" stroke-dasharray="4 4"/>` : ''}
    <polyline points="${pts}" fill="none" stroke="#0f766e" stroke-width="2"/></svg>
    <div class="nota">${num(t0, 0)} s → ${num(t1, 0)} s · linha tracejada = limite de alerta (${lim ? lim.nome.toLowerCase() : '—'})</div>`;
}

/** Relatório HTML autônomo (abre numa aba; o botão imprime / salva em PDF). */
export function htmlRelatorio(d) {
  const M = d.metodo;
  const pr = d.parametros;
  const params = M === 'RULA'
    ? `Carga/força: ${esc(TEXTO_CARGA_RULA[pr.cargaRula])} · uso muscular: ${pr.musculoRula ? 'sim' : 'não'}${pr.estaticaAuto ? ' (estática detectada automaticamente)' : ''} · torção do punho: ${pr.punhoTorcao === 2 ? 'fim do curso' : 'meio do curso'}`
    : `Carga: ${esc(TEXTO_CARGA_REBA[pr.cargaReba])}${pr.choque ? ' + choque' : ''} · pega: ${esc(TEXTO_PEGA[pr.pega])} · atividade: ${[pr.estatica && 'estática', pr.repetitiva && 'repetitiva', pr.instavel && 'instável'].filter(Boolean).join(', ') || 'nenhum acréscimo'}`;
  const ajustes = [pr.ombroElevado && 'ombro elevado', pr.bracoApoiado && 'braço apoiado', pr.troncoTorcido && 'tronco torcido', pr.pescocoTorcido && 'pescoço torcido'].filter(Boolean).join(', ') || 'nenhum';
  const blocos = d.pessoas.map((p) => {
    const m = p[M], pk = m.pico, av = pk && pk.avaliacao;
    const barra = FAIXAS.map((f) => (m.pctFaixas[f.nome] > 0 ? `<span style="width:${m.pctFaixas[f.nome]}%;background:${f.cor}" title="${f.nome} ${num(m.pctFaixas[f.nome], 1)}%"></span>` : '')).join('');
    const leg = NIVEIS[M].map((n) => `<li><i style="background:${FAIXAS[n.faixa].cor}"></i>${esc(n.nome)} (${n.de === n.ate ? n.de : n.de + '–' + n.ate}): <b>${num(m.pctFaixas[FAIXAS[n.faixa].nome], 1)}%</b></li>`).join('');
    const seg = av ? av[M === 'REBA' ? 'reba' : 'rula'].segmentos : {};
    const angSeg = { braco: av && av.angulos.braco, antebraco: av && av.angulos.antebraco, punho: av && av.angulos.punho, pescoco: av && av.angulos.pescoco, tronco: av && av.angulos.tronco, pernas: av && av.angulos.joelho };
    const tab = av ? Object.keys(seg).map((k) => `<tr><td>${esc(NOMES_SEG[k] || k)}</td><td>${k === 'torcao' ? '—' : k === 'pernas' ? (angSeg.pernas == null ? '—' : 'joelho ' + fg(angSeg.pernas)) : fg(angSeg[k])}${av.assumidos.includes(k) ? ' <em>(assumido)</em>' : ''}</td>
      <td style="color:${tinta(corSegmento(M, k, seg[k]))};font-weight:700">${seg[k]}</td></tr>`).join('') : '';
    const cadeia = av ? (M === 'RULA'
      ? `Postura A ${av.rula.posturaA} + músculo ${av.rula.musculo} + carga ${av.rula.carga} = ${av.rula.A} · Postura B ${av.rula.posturaB} + músculo + carga = ${av.rula.B} → Tabela C = <b>${av.rula.nota}</b>`
      : `Tabela A ${av.reba.tabelaA} → escore A ${av.reba.A} · Tabela B ${av.reba.tabelaB} → escore B ${av.reba.B} · Tabela C ${av.reba.C} + atividade ${av.reba.atividade} = <b>${av.reba.nota}</b>`) : '';
    const recs = p.recomendacoes.map((r) => `<li><b style="color:${tinta(FAIXAS[r.nivel].cor)}">${esc(r.seg)}:</b> ${esc(r.texto)}</li>`).join('');
    return `<section><h2>Pessoa ${esc(p.id)} — ${M} médio ${num(m.media, 1)} · pico <span style="color:${pk ? tinta(corDe(M, pk.nota)) : '#64748b'}">${pk ? pk.nota + ' (' + esc(pk.nivel) + ')' : '—'}</span></h2>
      <p class="meta">${num(p.tempoS, 0)} s avaliados · de ${num(p.primeiroS, 0)} s a ${num(p.ultimoS, 0)} s da sessão${av ? ` · pior momento em ${num(pk.t, 0)} s · lado ${esc(av.lado)} · vista ${esc(av.vista)}` : ''}</p>
      <h3>Tempo em cada nível</h3><div class="barra">${barra}</div><ul class="leg">${leg}</ul>
      ${svgSerie(p.serie, M, pr.alertaFaixa)}
      <div class="lado">
        ${pk && pk.thumb ? `<figure><div style="position:relative"><img src="${pk.thumb}" alt="">${svgPose(pk, M)}</div><figcaption>Postura mais crítica (${num(pk.t, 0)} s)</figcaption></figure>` : ''}
        <div style="flex:1;min-width:240px"><h3>Segmentos no pior momento</h3>
        <table><tr><th>Segmento</th><th>Ângulo</th><th>Escore</th></tr>${tab}</table><p class="nota">${cadeia}</p></div>
      </div>
      <h3>Recomendações</h3><ul>${recs || '<li>Nenhuma: postura dentro do aceitável no período.</li>'}</ul></section>`;
  }).join('');
  const alertas = d.alertas.length ? `<h2>Alertas</h2><table><tr><th>Pessoa</th><th>Método</th><th>Início</th><th>Disparo</th><th>Fim</th><th>Pico</th></tr>${d.alertas.map((a) =>
    `<tr><td>${esc(a.pessoa)}</td><td>${a.metodo}</td><td>${num(a.inicioS, 0)} s</td><td>${num(a.disparoS, 0)} s</td><td>${a.fimS == null ? 'em curso' : num(a.fimS, 0) + ' s'}</td><td>${a.pico}</td></tr>`).join('')}</table>` : '';
  const niveis = NIVEIS[M].map((n) => `<li><i style="background:${FAIXAS[n.faixa].cor}"></i><b>${n.de === n.ate ? n.de : n.de + '–' + n.ate}</b> ${esc(n.nome)}: ${esc(n.acao)}</li>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Ergonomia ${M}</title><style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px;max-width:920px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}h3{font-size:13px;margin:14px 0 6px;color:#334155}
.meta{color:#475569;font-size:13px;margin:0 0 6px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}th{background:#f1f5f9}
.barra{display:flex;height:16px;border-radius:5px;overflow:hidden;background:#e2e8f0}.barra span{display:block;height:100%}
ul.leg{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;margin:6px 0 10px}ul.leg i,ul.niv i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
ul.niv{list-style:none;padding:0}figure{margin:0 14px 10px 0;width:200px;font-size:12px}figure img{width:200px;height:200px;display:block;border-radius:6px;border:1px solid #cbd5e1}
.lado{display:flex;flex-wrap:wrap;align-items:flex-start;margin-top:10px}li{margin-bottom:5px}.nota{font-size:12px;color:#475569}
.aviso{border:1px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:10px 12px;font-size:13px;margin:12px 0}
button{font:inherit;padding:8px 16px;margin-top:10px;cursor:pointer}section{break-inside:avoid-page}
@media print{button{display:none}body{padding:0}}@media (max-width:600px){body{padding:14px}td,th{padding:4px 3px;font-size:12px}}
</style></head><body>
<h1>Relatório de ergonomia — ${M}</h1>
<div class="meta">${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · ${d.pessoas.length} pessoa(s) · ${num(d.duracaoS, 0)} s de sessão</div>
<div class="aviso"><b>Atenção:</b> ${esc(d.aviso)}</div>
<button onclick="print()">Imprimir / salvar em PDF</button>
<h2>Parâmetros da tarefa</h2><p class="meta">${params}<br>Ajustes informados: ${esc(ajustes)} · lado: ${esc(pr.lado)} · vista: ${esc(pr.vista)} ·
alerta a partir de ${esc(FAIXAS[pr.alertaFaixa].nome)} por ${pr.alertaSeg} s</p>
<h2>Níveis de ação (${M})</h2><ul class="niv">${niveis}</ul>
${blocos || '<p>Nenhuma pessoa avaliada.</p>'}
${alertas}
<h2>Método</h2><p class="nota">Ângulos no plano da imagem a partir de 17 pontos do corpo (RTMO) e, quando disponíveis, 21 pontos de cada mão
(MediaPipe Hands). Tronco: quadril→ombro em relação à vertical. Pescoço: ombro→orelha em relação ao tronco. Braço: ombro→cotovelo em relação ao
tronco. Antebraço: flexão do cotovelo. Punho: antebraço decomposto na base da mão (flexão e desvio). Joelho: flexão. Tolerância de ±5° para
"neutro". Tabelas oficiais RULA (A, B, C) e REBA (A, B, C). Segmentos sem medida entram com o valor assumido indicado.
Torções, ombro elevado, apoio, carga, pega e atividade vêm dos parâmetros informados.<br>${d.referencias.map(esc).join('<br>')}</p>
</body></html>`;
}
