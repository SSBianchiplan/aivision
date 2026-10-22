/**
 * cv/runtime/livres-i/relatorio.js — exportação das sessões de Swing e VBT:
 * dados (JSON), planilha (CSV com ; e vírgula decimal, que o Excel em
 * português abre direto) e relatório HTML autônomo para imprimir / salvar em
 * PDF. Só monta texto: quem baixa ou abre a janela é o painel.
 */
import { METRICAS_SWING, FASES, NOME_FASE, perfilDe, status } from './swing.js';
import { ZONAS, zonaDe } from './vbt.js';

const r2 = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v).replace(/[;\n"]/g, ' '));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 1, un = '') => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d).replace('.', ',')}${un}`);
const NOME_REF = { razaoTempo: 'razão de tempo (:1)', xfactor: 'X-factor (°)', bracoLider: 'braço líder (°)', cabeca: 'cabeça (% do tronco)', rotOmbros: 'rotação dos ombros (°)' };
const COR = { ok: '#15803d', perto: '#a16207', fora: '#b91c1c', sem: '#64748b' };

const ESTILO = `body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px;max-width:960px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
.meta{color:#475569;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}th{background:#f1f5f9}td.n{text-align:right;font-variant-numeric:tabular-nums}
.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpis div{border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px}
.kpis b{display:block;font-size:20px}.quadros{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}
figure{margin:0;font-size:11px;text-align:center}figure img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:1px solid #cbd5e1;background:#000}
.nota{font-size:12px;color:#475569}button{font:inherit;padding:8px 16px;margin-top:10px;cursor:pointer}.alerta{color:#b91c1c;font-weight:600}
.bar{display:inline-block;height:10px;border-radius:3px;vertical-align:middle}
@media print{button{display:none}body{padding:0}}@media (max-width:640px){body{padding:14px}.quadros{grid-template-columns:repeat(3,1fr)}td,th{padding:4px 3px;font-size:12px}}`;

// ------------------------------------------------------------------ swing

export function dadosSwing(sessao, cfg = {}) {
  const t0 = sessao.t0 || 0;
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Swing (CV-33)',
    perfil: cfg.perfil, dominante: cfg.dominante, vista: cfg.vista, alturaCm: cfg.alturaCm || 0,
    swings: sessao.swings.map((s) => ({
      n: s.n, perfil: s.perfil, t: r2((s.t - t0) / 1000), amostras: s.amostras, taxa: r2(s.taxa, 1),
      tempos: Object.fromEntries(Object.entries(s.tempos).map(([k, v]) => [k, r2((v - t0) / 1000, 3)])),
      metricas: Object.fromEntries(Object.entries(s.metricas).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])),
      quadros: Object.fromEntries(FASES.map((f) => [f, { t: r2((s.quadros[f].t - t0) / 1000, 3), thumb: s.quadros[f].thumb || null }])),
      trajetoMaos: s.trajeto.map((p) => [r2(p.x, 3), r2(p.y, 3)]),
      trajetoImplemento: s.implemento.map((p) => [r2(p.x, 3), r2(p.y, 3)]),
    })),
  };
}

export function csvSwing(d) {
  const cols = ['swing', 'perfil', 't_s', 'amostras', 'poses_por_s', ...METRICAS_SWING.map((m) => m.k), 'cabecaCm', 'velMaosMs'];
  const linhas = [cols.join(';')];
  for (const s of d.swings) {
    linhas.push([s.n, s.perfil, s.t, s.amostras, s.taxa, ...METRICAS_SWING.map((m) => s.metricas[m.k]), s.metricas.cabecaCm, s.metricas.velMaosMs].map(cel).join(';'));
  }
  return linhas.join('\n') + '\n';
}

function svgTrajeto(s, cor = '#0e7490') {
  const pts = s.trajetoMaos;
  if (!pts || pts.length < 2) return '';
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs, -0.5), x1 = Math.max(...xs, 0.5), y0 = Math.min(...ys, -1.5), y1 = Math.max(...ys, 0.5);
  const W = 220, k = W / Math.max(x1 - x0, y1 - y0), H = (y1 - y0) * k;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) * k).toFixed(1)},${((p[1] - y0) * k).toFixed(1)}`).join('');
  const im = s.trajetoImplemento && s.trajetoImplemento.length > 1
    ? `<path d="${s.trajetoImplemento.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) * k).toFixed(1)},${((p[1] - y0) * k).toFixed(1)}`).join('')}" fill="none" stroke="#be185d" stroke-width="1.5" stroke-dasharray="4 3"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" width="${W}" style="border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc">
    <circle cx="${((0 - x0) * k).toFixed(1)}" cy="${((0 - y0) * k).toFixed(1)}" r="4" fill="#94a3b8"/>${im}
    <path d="${d}" fill="none" stroke="${cor}" stroke-width="2"/></svg>`;
}

export function htmlSwing(d) {
  const perfil = perfilDe(d.perfil);
  const ref = perfil.ref || {};
  const blocos = d.swings.slice(-12).map((s) => {
    const p = perfilDe(s.perfil);
    const quadros = FASES.map((f) => `<figure>${s.quadros[f].thumb ? `<img src="${s.quadros[f].thumb}" alt="">` : '<div style="aspect-ratio:1;background:#e2e8f0;border-radius:6px"></div>'}
      <figcaption>${esc(NOME_FASE[f])}<br>${fmt(s.quadros[f].t, 2, ' s')}</figcaption></figure>`).join('');
    const linhas = METRICAS_SWING.map((m) => {
      const v = s.metricas[m.k];
      const st = m.ref ? status(v, (p.ref || {})[m.ref]) : 'sem';
      const faixa = m.ref && (p.ref || {})[m.ref] ? `${(p.ref || {})[m.ref][0]} a ${(p.ref || {})[m.ref][1]}${m.un === ':1' ? ':1' : m.un}` : '—';
      return `<tr><td>${esc(m.nome)}</td><td class="n">${fmt(v, m.d)}${m.un === ':1' || m.un === '°' || m.un === '%' ? m.un : ' ' + m.un}</td><td>${esc(faixa)}</td><td style="color:${COR[st]};font-weight:600">${{ ok: 'na faixa', perto: 'perto', fora: 'fora', sem: '' }[st]}</td></tr>`;
    }).join('');
    return `<h2>Swing ${s.n} · ${esc(s.perfil)} · ${fmt(s.t, 1, ' s')}</h2>
      <div class="quadros">${quadros}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;align-items:flex-start">
        <table style="flex:1 1 420px">${linhas}
          ${s.metricas.cabecaCm != null ? `<tr><td>Cabeça (estimado)</td><td class="n">${fmt(s.metricas.cabecaCm, 1, ' cm')}</td><td></td><td></td></tr>` : ''}
          ${s.metricas.velMaosMs != null ? `<tr><td>Mãos (estimado)</td><td class="n">${fmt(s.metricas.velMaosMs, 1, ' m/s')}</td><td></td><td></td></tr>` : ''}
        </table>
        <figure style="flex:none"><figcaption style="margin-bottom:4px">Trajetória das mãos${s.trajetoImplemento.length > 1 ? ' (tracejado: implemento)' : ''}</figcaption>${svgTrajeto(s)}</figure>
      </div>
      <p class="nota">${s.amostras} poses (${fmt(s.taxa, 0)} por segundo de vídeo).</p>`;
  }).join('');
  const resumo = d.swings.length ? (() => {
    const med = (k) => { const v = d.swings.map((s) => s.metricas[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    return `<div class="kpis"><div><b>${d.swings.length}</b>swings</div><div><b>${fmt(med('razaoTempo'), 1)}:1</b>razão de tempo média</div>
      <div><b>${fmt(med('xfactor'), 0, '°')}</b>X-factor médio</div><div><b>${fmt(med('cabeca'), 0, '%')}</b>cabeça (média)</div></div>`;
  })() : '<p>Nenhum swing gravado.</p>';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Swing</title><style>${ESTILO}</style></head><body>
<h1>Relatório de Swing</h1>
<div class="meta">${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · ${esc(d.perfil)} · ${esc(d.dominante)} · vista ${esc(d.vista)}${d.alturaCm ? ` · altura ${d.alturaCm} cm` : ''}</div>
<button onclick="print()">Imprimir / salvar em PDF</button>
<h2>Resumo</h2>${resumo}
${Object.keys(ref).length ? `<p class="nota">Faixas de referência (${esc(perfil.esporte)}): ${Object.entries(ref).map(([k, v]) => `${esc(NOME_REF[k] || k)} ${v[0]}–${v[1]}`).join(' · ')}.</p>` : ''}
${blocos}
<h2>Como ler</h2><p class="nota">Fases pela velocidade das mãos (pose BlazePose, sem marcadores). Tempo do backswing: do início do
movimento ao topo; do downswing: do topo ao impacto. Rotações são aproximações 2D: de frente, pela largura aparente dos ombros/quadril
em relação à preparação; da linha do alvo, pela profundidade relativa estimada pelo modelo. X-factor = rotação dos ombros − do quadril
no topo. Coluna: inclinação quadril→ombros em relação à vertical (positivo = para o lado do alvo). Cabeça: maior afastamento do nariz
até o impacto, em % do tronco (ombros–quadril). Velocidades em troncos por segundo; em m/s só com a altura informada (tronco ≈ 30%
da estatura). Transferência: deslocamento do quadril para o alvo em % da base (distância entre os tornozelos). Espere alguns graus
e centésimos de segundo de erro; a 15–25 poses/s o downswing fica com poucas amostras — filme a 60 fps ou reproduza a 0,25×.</p>
</body></html>`;
}

// ------------------------------------------------------------------ VBT

export function dadosVbt(sessao, cfg = {}) {
  const t0 = sessao.t0 || 0;
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — VBT (CV-34)',
    exercicio: cfg.exercicio, cargaKg: cfg.cargaKg, marcadorCm: cfg.marcadorCm, modo: cfg.modo, limitePerda: cfg.limitePerda,
    series: sessao.series.filter((s) => s.reps.length).map((s, i) => {
      const vms = s.reps.map((r) => r.vm), melhor = Math.max(...vms);
      return {
        n: i + 1, perda: r2(((melhor - vms[vms.length - 1]) / melhor) * 100, 1),
        reps: s.reps.map((r) => ({
          n: r.n, t: r2((r.t0 - t0) / 1000), duracaoS: r2(r.dur, 3), deslocamentoCm: r2(r.desl, 1),
          velMedia: r2(r.vm, 3), velPropulsiva: r2(r.vmp, 3), velPico: r2(r.pico, 3),
          potMedia: r2(r.potMedia, 0), potPico: r2(r.potPico, 0), desvioHCm: r2(r.desvioH, 1), larguraHCm: r2(r.larguraH, 1),
          zona: r.zona, perdaAcum: r2(r.perdaAcum, 1),
          trajeto: r.trajeto.map((q) => [r2(((q.x - r.trajeto[0].x) * r.cmPx), 1), r2(((r.trajeto[0].y - q.y) * r.cmPx), 1)]),
        })),
      };
    }),
  };
}

export function csvVbt(d) {
  const cols = ['serie', 'rep', 't_s', 'duracao_s', 'deslocamento_cm', 'vel_media_m_s', 'vel_propulsiva_m_s', 'vel_pico_m_s',
    'pot_media_W', 'pot_pico_W', 'desvio_horizontal_cm', 'zona', 'perda_acumulada_pct', 'carga_kg', 'exercicio'];
  const linhas = [cols.join(';')];
  for (const s of d.series) {
    for (const r of s.reps) {
      linhas.push([s.n, r.n, r.t, r.duracaoS, r.deslocamentoCm, r.velMedia, r.velPropulsiva, r.velPico, r.potMedia, r.potPico,
        r.desvioHCm, r.zona, r.perdaAcum, d.cargaKg, d.exercicio].map(cel).join(';'));
    }
  }
  return linhas.join('\n') + '\n';
}

function svgBarras(reps, limite) {
  if (!reps.length) return '';
  const W = 420, H = 140, max = Math.max(1.2, ...reps.map((r) => r.velPico || r.velMedia));
  const bw = Math.min(40, (W - 30) / reps.length - 6);
  const melhor = Math.max(...reps.map((r) => r.velMedia));
  const yLim = H - 20 - ((melhor * (1 - limite / 100)) / max) * (H - 30);
  const barras = reps.map((r, i) => {
    const h = (r.velMedia / max) * (H - 30), x = 26 + i * (bw + 6), z = zonaDe(r.velMedia);
    return `<rect x="${x}" y="${H - 20 - h}" width="${bw}" height="${h}" rx="3" fill="${z ? z.cor : '#64748b'}"/>
      <text x="${x + bw / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#475569">${r.n}</text>
      <text x="${x + bw / 2}" y="${H - 24 - h}" font-size="9.5" text-anchor="middle" fill="#0f172a">${fmt(r.velMedia, 2)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:${W}px">
    <line x1="22" x2="${W}" y1="${yLim}" y2="${yLim}" stroke="#b91c1c" stroke-dasharray="4 3"/>
    <text x="${W - 2}" y="${yLim - 3}" font-size="9.5" text-anchor="end" fill="#b91c1c">limite de perda ${limite}%</text>${barras}</svg>`;
}

export function htmlVbt(d) {
  const series = d.series.map((s) => {
    const linhas = s.reps.map((r) => `<tr><td>${r.n}</td><td class="n">${fmt(r.velMedia, 2)}</td><td class="n">${fmt(r.velPropulsiva, 2)}</td>
      <td class="n">${fmt(r.velPico, 2)}</td><td class="n">${fmt(r.deslocamentoCm, 1)}</td><td class="n">${fmt(r.duracaoS, 2)}</td>
      <td class="n">${r.potMedia == null ? '—' : r.potMedia}</td><td class="n">${r.potPico == null ? '—' : r.potPico}</td>
      <td class="n">${fmt(r.desvioHCm, 1)}</td><td><span class="bar" style="width:10px;background:${(zonaDe(r.velMedia) || {}).cor}"></span> ${esc(r.zona)}</td>
      <td class="n${r.perdaAcum > d.limitePerda ? ' alerta' : ''}">${fmt(r.perdaAcum, 0, '%')}</td></tr>`).join('');
    return `<h2>Série ${s.n} · ${s.reps.length} repetições · perda de velocidade <span class="${s.perda > d.limitePerda ? 'alerta' : ''}">${fmt(s.perda, 1, '%')}</span></h2>
      ${svgBarras(s.reps, d.limitePerda)}
      <table><tr><th>#</th><th>Média (m/s)</th><th>Propulsiva</th><th>Pico</th><th>Desloc. (cm)</th><th>Duração (s)</th><th>Pot. média (W)</th>
      <th>Pot. pico (W)</th><th>Desvio horiz. (cm)</th><th>Zona</th><th>Perda</th></tr>${linhas}</table>`;
  }).join('');
  const zonas = ZONAS.map((z) => `<span class="bar" style="width:10px;background:${z.cor}"></span> ${esc(z.nome)} (${fmt(z.de, 2)}${Number.isFinite(z.ate) ? `–${fmt(z.ate, 2)}` : '+'} m/s)`).join(' · ');
  const n = d.series.reduce((a, s) => a + s.reps.length, 0);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório VBT</title><style>${ESTILO}</style></head><body>
<h1>Relatório VBT — velocidade da barra</h1>
<div class="meta">${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · ${esc(d.exercicio)} · ${fmt(d.cargaKg, d.cargaKg % 1 ? 1 : 0, ' kg')} ·
${d.modo === 'marcador' ? `marcador ArUco de ${fmt(d.marcadorCm, 1, ' cm')}` : 'modo aproximado (punhos)'}</div>
<button onclick="print()">Imprimir / salvar em PDF</button>
<h2>Resumo</h2><div class="kpis"><div><b>${d.series.length}</b>séries</div><div><b>${n}</b>repetições</div>
<div><b>${fmt(d.series.length ? Math.max(...d.series.flatMap((s) => s.reps.map((r) => r.velMedia))) : null, 2)}</b>melhor vel. média (m/s)</div></div>
${series || '<p>Nenhuma repetição gravada.</p>'}
<h2>Como ler</h2><p class="nota">Repetição = fase concêntrica (barra subindo). Velocidade média = deslocamento ÷ duração da fase;
propulsiva = até a aceleração ficar menor que −g; pico = maior velocidade instantânea. Potência média = carga × g × velocidade média;
de pico = máx. de carga × (g + aceleração) × velocidade. Perda de velocidade = (melhor média da série − média da repetição) ÷ melhor.
Zonas: ${zonas}. Desvio horizontal: maior afastamento da barra em relação à vertical do início da subida.
${d.modo === 'marcador' ? 'Escala pelo lado do marcador impresso; filme de lado, com a câmera parada e perpendicular à barra.' : 'Modo aproximado: posição pelos punhos da pose e escala pela altura do atleta — use para tendência, não para valores absolutos.'}</p>
</body></html>`;
}
