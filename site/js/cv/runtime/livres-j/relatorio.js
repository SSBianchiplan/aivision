/**
 * cv/runtime/livres-j/relatorio.js — radar em SVG (painel e relatório) e a
 * exportação da súmula: JSON, CSV (; e vírgula decimal, abre direto no
 * Excel em português) e um relatório HTML para imprimir / salvar em PDF.
 * Só monta texto; quem baixa ou abre janela é o painel.
 */
import { ESPORTES, num } from './quadras.js';
import { ROTULO_TIME } from './sessao.js';

const FUNDO = { futebol: '#1d6b40', futsal: '#2f6f8f', basquete: '#b07a47', 'vôlei': '#c98a2e', 'tênis': '#3a6ea5', padel: '#2b5c9e' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10);

/** Cor do mapa de calor (0..1): transparente → amarelo → vermelho. */
function corCalor(v) {
  const a = Math.min(0.85, 0.15 + 0.75 * v);
  const g = Math.round(220 - 180 * v);
  return `rgba(255,${g},40,${a.toFixed(2)})`;
}

/**
 * Radar da quadra em SVG. o = { calor: {gx, gy, m}, jogadores: [{ id, P, time, ativo }],
 * cores: {A,B,O}, bola: [x, y] | null, traj: [[x, y]], quiques: [{x, y, dentro}], sel, largura }
 */
export function svgRadar(esporte, L, W, o = {}) {
  const e = ESPORTES[esporte] || ESPORTES.futebol;
  const m = Math.max(L, W) * 0.05, VW = L + 2 * m, VH = W + 2 * m;

  const partes = [`<rect x="${-m}" y="${-m}" width="${VW}" height="${VH}" fill="${FUNDO[esporte] || '#245'}" rx="${m / 2}"/>`];
  if (o.calor && o.calor.m) {
    const { gx, gy, m: g } = o.calor;
    let mx = 0;
    for (let i = 0; i < g.length; i++) if (g[i] > mx) mx = g[i];
    if (mx > 0) {
      const cw = L / gx, ch = W / gy;
      for (let y = 0; y < gy; y++) for (let x = 0; x < gx; x++) {
        const v = g[y * gx + x] / mx;
        if (v < 0.02) continue;
        partes.push(`<rect x="${(x * cw).toFixed(2)}" y="${(y * ch).toFixed(2)}" width="${(cw + 0.02).toFixed(2)}" height="${(ch + 0.02).toFixed(2)}" fill="${corCalor(Math.sqrt(v))}"/>`);
      }
    }
  }
  const sw = (0.12 * Math.max(L, W)) / 100 * 2.2;
  const d = e.linhas(L, W).map(([a, b, c, dd]) => `M${a.toFixed(2)} ${b.toFixed(2)}L${c.toFixed(2)} ${dd.toFixed(2)}`).join('');
  partes.push(`<path d="${d}" stroke="rgba(255,255,255,.9)" stroke-width="${sw.toFixed(3)}" fill="none" stroke-linecap="round"/>`);
  const r = Math.max(L, W) * 0.014;
  for (const q of o.quiques || []) {
    partes.push(`<circle cx="${q.x.toFixed(2)}" cy="${q.y.toFixed(2)}" r="${(r * 0.7).toFixed(2)}" fill="none" stroke="${q.dentro ? '#86efac' : '#f87171'}" stroke-width="${(sw * 1.2).toFixed(3)}"/>`);
  }
  if (o.traj && o.traj.length > 1) {
    partes.push(`<polyline points="${o.traj.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" fill="none" stroke="#fde047" stroke-width="${sw.toFixed(3)}" stroke-dasharray="${(sw * 2).toFixed(2)} ${(sw * 1.5).toFixed(2)}"/>`);
  }
  const cores = o.cores || {};
  for (const j of o.jogadores || []) {
    if (!j.P || !j.ativo) continue;
    const [x, y] = j.P;
    if (x < -m || x > L + m || y < -m || y > W + m) continue;
    const c = cores[j.time] || '#FFD84D';
    const sel = o.sel != null && String(o.sel) === String(j.id);
    partes.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(sel ? r * 1.5 : r).toFixed(2)}" fill="${c}" stroke="${sel ? '#fff' : '#02302C'}" stroke-width="${(sw * (sel ? 1.6 : 0.8)).toFixed(3)}"/>`);
    partes.push(`<text x="${x.toFixed(2)}" y="${(y - r * 1.4).toFixed(2)}" font-size="${(r * 1.7).toFixed(2)}" fill="#fff" text-anchor="middle" font-family="ui-monospace,monospace" paint-order="stroke" stroke="#02302C" stroke-width="${(sw * 0.9).toFixed(3)}">${esc(j.id)}</text>`);
  }
  if (o.bola) partes.push(`<circle cx="${o.bola[0].toFixed(2)}" cy="${o.bola[1].toFixed(2)}" r="${(r * 0.75).toFixed(2)}" fill="#fde047" stroke="#000" stroke-width="${(sw * 0.6).toFixed(3)}"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${VW} ${VH}" width="${o.largura || '100%'}" role="img" aria-label="Radar da quadra (${esc(e.nome)})">${partes.join('')}</svg>`;
}

/** Retrato serializável da súmula. extra = { esporte, L, W, cal, calibracao } */
export function dadosSessao(sessao, extra = {}) {
  const r = sessao.retrato(extra);
  const esp = ESPORTES[extra.esporte] || ESPORTES.futebol;
  const jogadores = r.jogadores.filter((j) => j.tempo >= 1).sort((a, b) => b.dist - a.dist).map((j) => ({
    id: j.id, time: j.time ? ROTULO_TIME[j.time] : '—', corUniforme: j.cor,
    tempoS: r1(j.tempo), distanciaM: extra.cal ? r1(j.dist) : null,
    velMediaKmh: extra.cal && j.tempo > 0 ? r1((j.dist / j.tempo) * 3.6) : null, velMaxKmh: extra.cal ? r1(j.vMax) : null,
    posseS: esp.posse ? r1(j.posseS) : undefined, passes: esp.posse ? j.passes : undefined,
    arremessos: esp.arremessos ? j.arremessos : undefined, cestas: esp.arremessos ? j.cestas : undefined,
    zonasS: Object.fromEntries(Object.entries(j.zonas || {}).map(([k, v]) => [k, r1(v)])),
    descontinuidades: j.saltos,
  }));
  const times = {};
  for (const [k, t] of Object.entries(r.times)) {
    times[k] = { nome: t.nome, cor: t.cor, corUniforme: t.uniforme, jogadores: t.jogadores, distanciaM: extra.cal ? r1(t.dist) : null,
      possePct: t.possePct != null ? r1(t.possePct) : null, passes: t.passes, perdas: t.perdas };
  }
  const rl = r.rallies;
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Esportes coletivos e de quadra (CV-35)',
    esporte: esp.nome, quadra: { comprimentoM: extra.L, larguraM: extra.W },
    calibracao: extra.cal ? { pontos: extra.cal.n, erroReprojecaoM: r1(extra.cal.erroM), metrosPorPixelNoFundo: extra.cal.mPorPx != null ? Math.round(extra.cal.mPorPx * 1000) / 1000 : null, pares: extra.calibracao ? extra.calibracao.pares : undefined }
      : null,
    duracaoS: r1(r.duracaoS), atualizacoes: r.atualizacoes, bolaVistaPct: r1(100 * r.taxaBola), modoTimes: r.modoTimes,
    times, jogadores,
    bola: { velMaxKmh: extra.cal ? r1(r.bola.vMax) : null },
    rallies: esp.rally ? { total: rl.length, mediaGolpes: rl.length ? r1(rl.reduce((s, x) => s + x.golpes, 0) / rl.length) : null, maior: rl.reduce((m, x) => Math.max(m, x.golpes), 0), lista: rl } : undefined,
    quiques: esp.quique || esp.rede ? sessao.quiques.map((q) => ({ s: r1(q.s), x: r1(q.x), y: r1(q.y), dentro: q.dentro, margemCm: Math.round(q.margemM * 100), lado: q.lado })) : undefined,
    arremessos: esp.arremessos ? { tentativas: r.arremessos.tent, cestas: r.arremessos.cestas } : undefined,
    eventos: sessao.eventos.map((e) => ({ s: r1(e.s), tipo: e.tipo, texto: e.texto })),
    avisos: avisosPrecisao(extra, r),
  };
}

export function avisosPrecisao(extra, r) {
  const a = [];
  if (!extra.cal) a.push('Sem calibração da quadra: distâncias, velocidades, zonas e dentro/fora não foram medidos (o radar usa a imagem esticada).');
  else if (extra.cal.mPorPx > 0.5) a.push(`Resolução baixa no fundo da quadra (${num(extra.cal.mPorPx, 2)} m por pixel): distância e velocidade dos jogadores distantes têm erro alto. Aumente a largura de processamento ou aproxime a câmera.`);
  if (r && r.taxaBola < 0.3) a.push(`A bola foi vista em ${Math.round(100 * r.taxaBola)}% das atualizações: posse, rally e quiques ficam incompletos. Um detector treinado para a bola deste esporte (Treinar) melhora muito.`);
  a.push('Medidas por câmera única: o pé de cada jogador é o meio da base da caixa; a bola no ar é projetada no chão (velocidade da bola só é confiável rente ao chão). Trocas de ID quebram as estatísticas por jogador.');
  return a;
}

export function csvSessao(d) {
  const n = (x) => (x == null ? '' : typeof x === 'number' ? String(x).replace('.', ',') : `"${String(x).replace(/"/g, '""')}"`);
  const zonas = [...new Set(d.jogadores.flatMap((j) => Object.keys(j.zonasS || {})))];
  const cab = ['id', 'time', 'cor', 'tempo_s', 'distancia_m', 'vel_media_kmh', 'vel_max_kmh', 'posse_s', 'passes', 'arremessos', 'cestas', ...zonas.map((z) => `zona_${z}_s`)];
  const linhas = [cab.join(';')];
  for (const j of d.jogadores) {
    linhas.push([j.id, j.time, j.corUniforme, j.tempoS, j.distanciaM, j.velMediaKmh, j.velMaxKmh, j.posseS, j.passes, j.arremessos, j.cestas,
      ...zonas.map((z) => (j.zonasS || {})[z])].map(n).join(';'));
  }
  linhas.push('');
  linhas.push(['time', 'jogadores', 'distancia_m', 'posse_pct', 'passes', 'perdas'].join(';'));
  for (const t of Object.values(d.times)) linhas.push([t.nome, t.jogadores, t.distanciaM, t.possePct, t.passes, t.perdas].map(n).join(';'));
  if (d.quiques && d.quiques.length) {
    linhas.push(''); linhas.push(['quique_s', 'x_m', 'y_m', 'dentro', 'margem_cm', 'lado'].join(';'));
    for (const q of d.quiques) linhas.push([q.s, q.x, q.y, q.dentro ? 'sim' : 'não', q.margemCm, q.lado].map(n).join(';'));
  }
  if (d.rallies && d.rallies.lista.length) {
    linhas.push(''); linhas.push(['rally_inicio_s', 'duracao_s', 'golpes', 'quiques', 'motivo'].join(';'));
    for (const r of d.rallies.lista) linhas.push([r1(r.s), r.duracaoS, r.golpes, r.quiques, r.motivo].map(n).join(';'));
  }
  return linhas.join('\r\n');
}

export function htmlRelatorio(d, sessao, extra) {
  const radares = ['A', 'B'].map((t) => {
    const c = sessao.calor(t);
    return c ? `<figure><figcaption>Mapa de calor — ${esc(d.times[t].nome)}</figcaption>${svgRadar(extra.esporte, extra.L, extra.W, { calor: c, largura: '100%' })}</figure>` : '';
  }).join('');
  const geral = sessao.calor('todos');
  const linhaJ = (j) => `<tr><td>#${esc(j.id)}</td><td><span class="dot" style="background:${esc(j.corUniforme || '#999')}"></span>${esc(j.time)}</td>
    <td>${num(j.tempoS, 0)}</td><td>${j.distanciaM == null ? '—' : num(j.distanciaM, 0)}</td><td>${j.velMediaKmh == null ? '—' : num(j.velMediaKmh, 1)}</td>
    <td>${j.velMaxKmh == null ? '—' : num(j.velMaxKmh, 1)}</td><td>${esc(Object.entries(j.zonasS || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${num(v, 0)} s`).join(' · ') || '—')}</td></tr>`;
  const times = Object.values(d.times).filter((t) => t.jogadores).map((t) => `<tr><td><span class="dot" style="background:${esc(t.cor)}"></span>${esc(t.nome)}${t.corUniforme ? ` <span class="dot" title="uniforme" style="background:${esc(t.corUniforme)}"></span>` : ''}</td>
    <td>${t.jogadores}</td><td>${t.distanciaM == null ? '—' : num(t.distanciaM, 0)}</td><td>${t.possePct == null ? '—' : num(t.possePct, 0) + '%'}</td>
    <td>${t.passes ?? '—'}</td><td>${t.perdas ?? '—'}</td></tr>`).join('');
  const extraEsp = [
    d.rallies ? `<p><b>Rallies:</b> ${d.rallies.total} · média ${d.rallies.mediaGolpes == null ? '—' : num(d.rallies.mediaGolpes, 1)} golpes · maior ${d.rallies.maior}</p>` : '',
    d.quiques ? `<p><b>Quiques:</b> ${d.quiques.length} (${d.quiques.filter((q) => q.dentro).length} dentro, ${d.quiques.filter((q) => !q.dentro).length} fora)</p>` : '',
    d.arremessos ? `<p><b>Arremessos:</b> ${d.arremessos.cestas} cestas em ${d.arremessos.tentativas} tentativas</p>` : '',
    d.bola.velMaxKmh ? `<p><b>Bola:</b> velocidade máxima aparente ${num(d.bola.velMaxKmh, 0)} km/h (projeção no chão)</p>` : '',
  ].join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>iaVision — ${esc(d.esporte)} — relatório</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0b2b28;max-width:960px;margin:24px auto;padding:0 16px;background:#fff}
  h1{font-size:22px;margin:0 0 4px} h2{font-size:16px;margin:22px 0 8px;border-bottom:1px solid #d6e4e1;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px} th,td{text-align:left;padding:5px 6px;border-bottom:1px solid #e4eeec}
  th{font-weight:600;color:#3c5b57;font-size:12px} .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle;border:1px solid #0003}
  .grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px} figure{margin:0} figcaption{font-size:12px;color:#3c5b57;margin-bottom:4px}
  .aviso{background:#fff7e0;border:1px solid #f0d58a;border-radius:8px;padding:8px 12px;font-size:12.5px} .muted{color:#5b7773;font-size:12px}
  @media print{body{margin:0}.noprint{display:none}}
</style></head><body>
<h1>${esc(d.esporte)} — análise da partida</h1>
<p class="muted">${esc(d.app)} · ${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · duração ${num(d.duracaoS, 0)} s · ${d.atualizacoes} atualizações · bola vista em ${num(d.bolaVistaPct, 0)}%
${d.calibracao ? ` · calibração com ${d.calibracao.pontos} pontos, ${num(d.calibracao.metrosPorPixelNoFundo, 2)} m/px no fundo` : ' · sem calibração'}</p>
<div class="aviso">${d.avisos.map(esc).join('<br>')}</div>
<p class="noprint"><button onclick="print()">Imprimir / salvar PDF</button></p>
<h2>Times</h2>
<table><thead><tr><th>Time</th><th>Jogadores</th><th>Distância (m)</th><th>Posse</th><th>Passes</th><th>Perdas</th></tr></thead><tbody>${times}</tbody></table>
${extraEsp}
<h2>Mapas de calor</h2>
<div class="grade">${geral ? `<figure><figcaption>Todos</figcaption>${svgRadar(extra.esporte, extra.L, extra.W, { calor: geral })}</figure>` : ''}${radares}</div>
<h2>Jogadores (${d.jogadores.length})</h2>
<table><thead><tr><th>ID</th><th>Time</th><th>Tempo (s)</th><th>Distância (m)</th><th>Vel. média (km/h)</th><th>Vel. máx. (km/h)</th><th>Zonas</th></tr></thead>
<tbody>${d.jogadores.map(linhaJ).join('')}</tbody></table>
<h2>Eventos</h2>
<table><thead><tr><th>s</th><th>Tipo</th><th>Evento</th></tr></thead><tbody>${d.eventos.slice(-80).map((e) => `<tr><td>${num(e.s, 1)}</td><td>${esc(e.tipo)}</td><td>${esc(e.texto)}</td></tr>`).join('')}</tbody></table>
<p class="muted">Gerado no navegador; nenhuma imagem saiu do aparelho.</p>
</body></html>`;
}
