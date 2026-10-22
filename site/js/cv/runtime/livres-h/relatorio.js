/**
 * cv/runtime/livres-h/relatorio.js — exportação do Salto (CV-31) e da
 * Corrida (CV-32): dados (JSON), planilha (CSV com ; e vírgula decimal, como
 * o Excel em português abre direto) e relatório HTML para imprimir / salvar
 * em PDF. Só monta texto: quem baixa ou abre a janela é o painel.
 */
import { TESTES, resumoSaltos, alertasSalto, REF } from './salto.js';
import { resumoCorrida, alertasCorrida, LIMITES } from './corrida.js';
import { num, r1, r2, r3, cel, esc } from './comum.js';

const ESTILO = `body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px;max-width:960px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #cbd5e1;padding-bottom:4px}
.meta{color:#475569;font-size:13px}table{border-collapse:collapse;width:100%;font-size:13px}
td,th{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}th{background:#f1f5f9}td.n{text-align:right;font-variant-numeric:tabular-nums}
.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpis div{border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px}
.kpis b{display:block;font-size:20px}.nota{font-size:12px;color:#475569}.al{color:#b91c1c}
.bar{height:10px;background:#0e7490;border-radius:3px}.desc{opacity:.45;text-decoration:line-through}
button{font:inherit;padding:8px 16px;margin-top:10px;cursor:pointer}
@media print{button{display:none}body{padding:0}}@media (max-width:600px){body{padding:14px}td,th{padding:4px 3px;font-size:12px}}`;

const fmt = (v, un = '', d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${num(v, d)}${un}`);
const cabecalho = (titulo, linhaMeta) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title><style>${ESTILO}</style></head><body>
<h1>${esc(titulo)}</h1><div class="meta">${linhaMeta}</div><button onclick="print()">Imprimir / salvar em PDF</button>`;

// ================================================================ SALTO

/** Retrato serializável da sessão de salto. cfg = { teste, alturaCm, vista, lenta }. */
export function dadosSalto(sessao, cfg = {}) {
  const r = sessao.analisar(cfg);
  const res = resumoSaltos(r.tentativas, cfg.teste);
  const t0 = sessao.t0 || 0;
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Salto e testes físicos (CV-31)',
    teste: cfg.teste, nomeTeste: (TESTES[cfg.teste] || TESTES.cmj).nome, vista: cfg.vista || 'lateral',
    alturaCm: cfg.alturaCm || 0, camaraLenta: cfg.lenta || 1,
    amostragem: { intervaloMs: r1(r.dt), hz: r.dt ? r1(1000 / r.dt) : null, amostras: sessao.amostras.length },
    escala: { cmPorPx: r3(r.cmPorPx), origem: r.escala, gravidadeAparente: r2(r.gAp) },
    resumo: {
      n: res.n, melhor: res.melhor ? res.melhor.n : null, media: r1(res.media), dp: r1(res.dp), cv: r1(res.cv),
      chave: res.chave, fadigaPct: r1(res.fadiga), rsiMedio: r2(res.rsi.media), tcMedioMs: r1(res.tc.media),
    },
    alertas: alertasSalto(r, cfg),
    tentativas: r.tentativas.map((t) => ({
      n: t.n, descartada: Boolean(t.descartada), t_s: r2((t.tDec - t0) / 1000),
      tempoVooMs: r1(t.tv), incertezaVooMs: r1(t.tvInc), alturaVooCm: r1(t.hVoo), incertezaAlturaCm: r1(t.hVooInc),
      alturaCMcm: r1(t.hCM), alturaCMdesdeEmPeCm: r1(t.hCMpe), profundidadeCm: r1(t.prof),
      tempoCargaMs: r1(t.tCarga), tempoPropulsaoMs: r1(t.tProp), contatoMs: r1(t.tc), rsi: r2(t.rsi), rsiTvTc: r2(t.rsiTv),
      joelhoDecolagem: r1(t.joelhoDec), quadrilDecolagem: r1(t.quadrilDec), joelhoAterrissagem: r1(t.joelhoAte),
      quadrilAterrissagem: r1(t.quadrilAte), joelhoFlexaoMaxAterrissagem: r1(t.joelhoMinAte), joelhoFundo: r1(t.joelhoFundo),
      fppaEsq: t.valgo ? r1(t.valgo.e) : null, fppaDir: t.valgo ? r1(t.valgo.d) : null, razaoJoelhosTornozelos: t.valgo ? r2(t.valgo.razao) : null,
      assimetriaAterrissagemMs: r1(t.assimAteMs), distanciaCm: r1(t.dist), gravidadeAparente: r2(t.gAp),
      contramovimento: t.contramov, avisos: t.avisos,
    })),
  };
}

const COLS_SALTO = ['n', 'descartada', 't_s', 'tempo_voo_ms', 'incerteza_voo_ms', 'altura_voo_cm', 'incerteza_altura_cm', 'altura_CM_cm',
  'altura_CM_desde_em_pe_cm', 'profundidade_cm', 'tempo_carga_ms', 'tempo_propulsao_ms', 'contato_ms', 'RSI_m_s', 'RSI_tv_tc',
  'joelho_decolagem', 'quadril_decolagem', 'joelho_aterrissagem', 'quadril_aterrissagem', 'joelho_flexao_max_aterrissagem',
  'FPPA_esq', 'FPPA_dir', 'razao_joelhos_tornozelos', 'assimetria_aterrissagem_ms', 'distancia_cm', 'g_aparente', 'avisos'];

export function csvSalto(d) {
  const L = [COLS_SALTO.join(';')];
  for (const t of d.tentativas) {
    L.push([t.n, t.descartada ? 'sim' : 'não', t.t_s, t.tempoVooMs, t.incertezaVooMs, t.alturaVooCm, t.incertezaAlturaCm, t.alturaCMcm,
      t.alturaCMdesdeEmPeCm, t.profundidadeCm, t.tempoCargaMs, t.tempoPropulsaoMs, t.contatoMs, t.rsi, t.rsiTvTc,
      t.joelhoDecolagem, t.quadrilDecolagem, t.joelhoAterrissagem, t.quadrilAterrissagem, t.joelhoFlexaoMaxAterrissagem,
      t.fppaEsq, t.fppaDir, t.razaoJoelhosTornozelos, t.assimetriaAterrissagemMs, t.distanciaCm, t.gravidadeAparente,
      (t.avisos || []).join(' | ')].map(cel).join(';'));
  }
  return L.join('\n') + '\n';
}

export function htmlSalto(d) {
  const horiz = d.teste === 'horizontal';
  const val = d.tentativas.filter((t) => !t.descartada);
  const chave = horiz ? 'distanciaCm' : 'alturaVooCm';
  const max = Math.max(1, ...val.map((t) => t[chave] || 0));
  const linhas = d.tentativas.map((t) => `<tr class="${t.descartada ? 'desc' : ''}"><td>${t.n}${d.resumo.melhor === t.n ? ' ★' : ''}</td>
    <td class="n">${horiz ? fmt(t.distanciaCm, ' cm') : `${fmt(t.alturaVooCm, ' cm')} <small>±${fmt(t.incertezaAlturaCm)}</small>`}</td>
    <td style="width:22%"><div class="bar" style="width:${Math.round(((t[chave] || 0) / max) * 100)}%"></div></td>
    <td class="n">${fmt(t.tempoVooMs, ' ms', 0)}</td><td class="n">${fmt(t.alturaCMcm, ' cm')}</td>
    <td class="n">${d.teste === 'dj' || d.teste === 'continuo' ? (t.contatoMs != null ? `${fmt(t.contatoMs, ' ms', 0)} · RSI ${fmt(t.rsi, '', 2)}` : '—') : `${fmt(t.profundidadeCm, ' cm')} · ${fmt(t.tempoCargaMs, ' ms', 0)}`}</td>
    <td class="n">${fmt(t.joelhoDecolagem, '°', 0)} / ${fmt(t.joelhoAterrissagem, '°', 0)} / ${fmt(t.joelhoFlexaoMaxAterrissagem, '°', 0)}</td>
    ${d.vista === 'frontal' ? `<td class="n">${fmt(t.fppaEsq, '°', 0)} / ${fmt(t.fppaDir, '°', 0)}</td>` : ''}
    <td>${esc((t.avisos || []).join(' '))}</td></tr>`).join('');
  const rs = d.resumo;
  return `${cabecalho(`Relatório de salto — ${d.nomeTeste}`, `${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · vista ${esc(d.vista)}
    · altura informada ${d.alturaCm ? d.alturaCm + ' cm' : '—'} · amostragem ${fmt(d.amostragem.hz, ' Hz', 0)}${d.camaraLenta > 1 ? ` (câmera lenta ${d.camaraLenta}×)` : ''}
    ${d.escala.cmPorPx ? ` · escala ${num(d.escala.cmPorPx, 3)} cm/px` : ''}`)}
<h2>Resumo</h2><div class="kpis">
<div><b>${rs.n}</b>tentativas válidas</div>
<div><b>${fmt(rs.melhor != null ? (d.tentativas.find((t) => t.n === rs.melhor) || {})[chave] : null, ' cm')}</b>melhor</div>
<div><b>${fmt(rs.media, ' cm')}</b>média ${rs.dp != null ? '± ' + fmt(rs.dp) : ''}</div>
${rs.cv != null ? `<div><b>${fmt(rs.cv, '%')}</b>CV entre tentativas</div>` : ''}
${rs.fadigaPct != null ? `<div><b>${fmt(rs.fadigaPct, '%')}</b>índice de fadiga</div>` : ''}
${rs.rsiMedio != null ? `<div><b>${fmt(rs.rsiMedio, '', 2)}</b>RSI médio (m/s)</div>` : ''}
</div>
${d.alertas.length ? `<p class="al">${d.alertas.map(esc).join('<br>')}</p>` : ''}
<h2>Tentativas</h2>
<table><tr><th>#</th><th>${horiz ? 'Distância' : 'Altura (voo)'}</th><th>Comparação</th><th>Voo</th><th>Altura (CM)</th>
<th>${d.teste === 'dj' || d.teste === 'continuo' ? 'Contato · RSI' : 'Contramov. · carga'}</th><th>Joelho dec./ater./flex.</th>
${d.vista === 'frontal' ? '<th>FPPA E/D</th>' : ''}<th>Observações</th></tr>${linhas}</table>
<h2>Método</h2><p class="nota">Pose estimada (BlazePose, 33 pontos) no navegador, sem marcadores. Decolagem e aterrissagem pela base dos pés
(calcanhar/ponta) em relação ao chão, interpoladas entre quadros e extrapoladas até o contato. Altura pelo tempo de voo: h = g·t²/8
(Bosco et al. 1983; Linthorne 2001). Incerteza: com quadros a cada ${fmt(d.amostragem.intervaloMs, ' ms', 0)}, cada borda do voo
pode errar até um quadro; a altura mostrada tem ± g·t·Δt/4 (pior caso). Altura pelo CM: subida do centro de massa segmentar
(Dempster/Winter) da decolagem ao pico, em cm pela estatura informada${d.escala.gravidadeAparente ? `; gravidade aparente no voo
${fmt(d.escala.gravidadeAparente, ' m/s²', 2)} (perto de 9,81 confirma a escala e a taxa de quadros)` : ''}. RSI = altura (m) ÷ contato (s)
(Flanagan & Comyns 2008). FPPA: ângulo coxa–perna no plano frontal, positivo para dentro (valgo); acima de ${REF.fppaValgo}° é marcado
para atenção. Ângulos internos 2D (180° = reto): joelho quadril–joelho–tornozelo, quadril ombro–quadril–joelho.
É triagem por vídeo: não substitui plataforma de força nem avaliação profissional.</p>
</body></html>`;
}

// ================================================================ CORRIDA

/** Retrato serializável da sessão de corrida. cfg = { vista, alturaCm, velocidadeKmh, lenta }. */
export function dadosCorrida(sessao, cfg = {}) {
  const r = sessao.analisar(cfg);
  const res = resumoCorrida(r, cfg);
  const t0 = sessao.t0 || 0;
  const lado = (x) => {
    if (!x) return null;
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = v && typeof v === 'object' && 'media' in v ? { n: v.n, media: r1(v.media), dp: r1(v.dp) } : v;
    return o;
  };
  return {
    gerado: new Date().toISOString(),
    app: 'GPlanSiS iaVision — Corrida (marcha) (CV-32)',
    vista: cfg.vista || 'lateral', alturaCm: cfg.alturaCm || 0, velocidadeKmh: cfg.velocidadeKmh || 0, camaraLenta: cfg.lenta || 1,
    amostragem: { intervaloMs: r1(r.dt), hz: r.dt ? r1(1000 / r.dt) : null, amostras: sessao.amostras.length },
    escala: { cmPorPx: r3(r.cmPorPx) }, direcao: r.dir, identificacaoLados: r.ladosOk ? 'pela pose' : 'A/B (sem confirmação)',
    pontosPose: cfg.pontos === 17 ? 17 : 33,
    camera: { movelPct: r1((r.camFracao || 0) * 100), movel: Boolean(r.camMovel) },
    descartadas: sessao.descartadas || 0,
    resumo: {
      passos: res.passos, cadenciaPpm: r1(res.cadencia), contatoMs: r1(res.tc && res.tc.media), vooMs: r1(res.tf && res.tf.media),
      apoioPct: r1(res.apoioPct), joelhosDuvidosos: res.joelhosDuvidosos, balancoPct: r1(res.balancoPct), oscilacaoCm: r1(res.osc && res.osc.media), oscilacaoPx: r1(res.oscPx),
      troncoGraus: r1(res.tronco && res.tronco.media), passadaM: r2(res.passadaM), passoM: r2(res.passoM),
      pisada: res.pisada, porLado: { E: lado(res.lados.E), D: lado(res.lados.D) }, simetria: res.simetria, diferenca: res.diferenca,
      cadenciaContatos: r1(res.cadenciaContatos), cadenciaQuadril: r1(res.cadenciaQuadril), contatosConfiaveis: res.contatosConfiaveis,
      pelve: res.pelve ? { E: r1(res.pelve.E), D: r1(res.pelve.D) } : null,
      largura: res.largura ? { E: r1(res.largura.E), D: r1(res.largura.D) } : null,
    },
    alertas: alertasCorrida(r, res, cfg).map((a) => a.texto),
    passos: r.passos.map((p) => ({
      n: p.n, lado: p.lado, t_s: r2((p.tIni - t0) / 1000), contatoMs: r1(p.tc), vooMs: r1(p.tf), passoMs: r1(p.tPasso),
      joelhoContato: r1(p.joelhoContato), joelhoDuvidoso: Boolean(p.joelhoDuvidoso), contatoLongo: Boolean(p.longo), joelhoApoioMin: r1(p.joelhoApoioMin), joelhoBalancoMin: r1(p.joelhoBalancoMin),
      tornozeloContato: r1(p.tornozeloContato), anguloPe: r1(p.anguloPe), pisada: p.pisada,
      peFrenteCm: r1(p.peFrenteCm), peFrentePct: r1(p.peFrentePct), tibia: r1(p.tibia), overstriding: p.overstriding,
      oscilacaoCm: r1(p.oscCm), oscilacaoPx: r1(p.oscPx), tronco: r1(p.tronco), quedaPelve: r1(p.quedaPelve), largura: r2(p.largura),
    })),
  };
}

const COLS_CORRIDA = ['n', 'lado', 't_s', 'contato_ms', 'voo_ms', 'passo_ms', 'joelho_contato', 'joelho_apoio_min', 'joelho_balanco_min',
  'tornozelo_contato', 'angulo_pe_contato', 'pisada', 'pe_a_frente_cm', 'pe_a_frente_pct_perna', 'tibia_graus', 'overstriding',
  'oscilacao_cm', 'oscilacao_px', 'tronco_graus', 'queda_pelve_graus', 'largura_passo'];

const linhaCsvPasso = (p) => [p.n, p.lado, p.t_s, p.contatoMs, p.vooMs, p.passoMs, p.joelhoContato, p.joelhoApoioMin, p.joelhoBalancoMin,
  p.tornozeloContato, p.anguloPe, p.pisada, p.peFrenteCm, p.peFrentePct, p.tibia, p.overstriding ? 'sim' : 'não',
  p.oscilacaoCm, p.oscilacaoPx, p.tronco, p.quedaPelve, p.largura].map(cel).join(';');

export function csvCorrida(d) {
  const L = [COLS_CORRIDA.join(';')];
  for (const p of d.passos) L.push(linhaCsvPasso(p));
  return L.join('\n') + '\n';
}

/** Resumo, alertas e tabela por lado de um corredor (o relatório de um só e o de vários usam). */
function corpoCorrida(d, nivel = 'h2') {
  const rs = d.resumo, E = rs.porLado.E || {}, D = rs.porLado.D || {}, si = rs.simetria || {};
  const m = (o, k) => (o && o[k] ? o[k].media : null);
  const dif = rs.diferenca || {};
  const linha = (nome, k, un, dec = 0) => `<tr><td>${nome}</td><td class="n">${fmt(m(E, k), un, dec)}</td><td class="n">${fmt(m(D, k), un, dec)}</td>
    <td class="n">${k in dif ? (dif[k] == null ? '—' : 'Δ ' + fmt(dif[k], un, dec)) : fmt(si[k], '%')}</td></tr>`;
  const lat = d.vista === 'lateral';
  const pis = rs.pisada ? Object.entries(rs.pisada).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${v}`).join(' · ') : '—';
  const H = (t) => `<${nivel}>${t}</${nivel}>`;
  const s17 = d.pontosPose === 17;
  const osc = d.camera && d.camera.movel ? '—' : rs.oscilacaoCm != null ? fmt(rs.oscilacaoCm, ' cm') : fmt(rs.oscilacaoPx, ' px', 0);
  return `${H('Resumo')}<div class="kpis">
<div><b>${fmt(rs.cadenciaPpm, '', 0)}</b>passos/min</div><div><b>${fmt(rs.contatoMs, ' ms', 0)}</b>contato</div>
<div><b>${fmt(rs.vooMs, ' ms', 0)}</b>voo</div><div><b>${fmt(rs.apoioPct, '%', 0)}</b>apoio / ${fmt(rs.balancoPct, '%', 0)} balanço</div>
${lat ? `<div><b>${osc}</b>oscilação vertical${d.camera && d.camera.movel ? ' (câmera móvel)' : ''}</div>
<div><b>${fmt(rs.troncoGraus, '°')}</b>inclinação do tronco</div>` : ''}
${rs.passadaM ? `<div><b>${fmt(rs.passadaM, ' m', 2)}</b>passada (${fmt(rs.passoM, ' m', 2)} por passo)</div>` : ''}
<div><b>${rs.passos}</b>passos</div></div>
${d.alertas.length ? `${H('Alertas')}<p class="al">${d.alertas.map(esc).join('<br>')}</p>` : ''}
${H('Por lado')}<table><tr><th>Medida</th><th>Esquerdo</th><th>Direito</th><th>Assimetria</th></tr>
${linha('Tempo de contato', 'tc', ' ms')}${linha('Tempo de voo seguinte', 'tf', ' ms')}
${lat ? `${linha('Joelho no contato', 'joelhoContato', '°')}${linha('Joelho: flexão máx. no apoio (ângulo mín.)', 'joelhoApoioMin', '°')}
${linha('Joelho: flexão máx. no balanço (ângulo mín.)', 'joelhoBalancoMin', '°')}${s17 ? '' : `${linha('Tornozelo no contato', 'tornozeloContato', '°')}
${linha('Ângulo do pé no contato', 'anguloPe', '°', 1)}`}${linha('Pé à frente do quadril', d.escala.cmPorPx ? 'peFrenteCm' : 'peFrentePct', d.escala.cmPorPx ? ' cm' : '% perna', 1)}
${linha('Tíbia no contato', 'tibia', '°', 1)}` : `${linha('Queda da pelve', 'quedaPelve', '°', 1)}${linha('Largura do passo (pé à linha média)', 'largura', '', 2)}`}
</table>
${lat ? `<p class="nota">${s17 ? 'Pisada e tornozelo: não medidos (pose de 17 pontos, sem calcanhar e ponta do pé).' : `Padrão de pisada: ${pis}.`}</p>` : ''}`;
}

const metaCorrida = (d) => `${esc(new Date(d.gerado).toLocaleString('pt-BR'))} · vista ${esc(d.vista)}
    · altura ${d.alturaCm ? d.alturaCm + ' cm' : '—'} · esteira ${d.velocidadeKmh ? num(d.velocidadeKmh, 1) + ' km/h' : '—'}
    · amostragem ${fmt(d.amostragem.hz, ' Hz', 0)}${d.camaraLenta > 1 ? ` (câmera lenta ${d.camaraLenta}×)` : ''}`;

const METODO_EXTRA = `Poses incoerentes (proporções de membros impossíveis para uma pessoa — típico de dois corredores colados fundidos num
esqueleto) não entram na série. Apoio: mediana, passo a passo, do contato ÷ duas vezes o tempo do passo (no máximo 50% com voo).
Câmera em movimento (panorâmica/zoom, detectada pelo deslocamento do fundo fora das pessoas): cadência, contato, voo e ângulos
continuam valendo; oscilação vertical não é medida. Pose de 17 pontos (RTMO, várias pessoas): sem calcanhar e ponta do pé, o
contato usa o tornozelo e pisada/tornozelo ficam de fora.`;

export function htmlCorrida(d) {
  const rs = d.resumo;
  return `${cabecalho('Relatório de corrida', `${metaCorrida(d)} · lados ${esc(d.identificacaoLados)}`)}
${corpoCorrida(d)}
<h2>Método</h2><p class="nota">Pose estimada (BlazePose, 33 pontos) no navegador, sem marcadores. Contato: o pé mais baixo
(calcanhar/ponta) a menos de ${num(LIMITES.contatoFracao * 100, 0)}% da perna do chão (mais, se a pose dos pés tremer); um passo novo começa quando o ponto de apoio
salta para a frente. Cadência = 60 ÷ tempo do passo (mediana), conferida pelo ritmo do quadril (autocorrelação da altura do quadril)${rs.contatosConfiaveis === false ? ' — nesta sessão os contatos ficaram incertos e a cadência mostrada é a do quadril' : ''}. Fase de apoio = contato ÷ tempo da passada. Oscilação vertical: amplitude
do meio do quadril por passo. Joelho: ângulo interno quadril–joelho–tornozelo (180° = reto). Tornozelo: entre a perna (joelho→tornozelo)
e o pé (calcanhar→ponta), 90° = neutro. Pisada pelo ângulo do pé no contato em relação ao pé apoiado (Altman & Davis 2012:
&gt; 8° retropé, −1,6° a 8° médio-pé, &lt; −1,6° antepé). Overstriding: tornozelo à frente do joelho (tíbia &gt; ${LIMITES.tibia}°) e pé
&gt; ${LIMITES.peFrentePct}% da perna à frente do quadril no contato. Tronco: quadril→ombro em relação à vertical (+ = à frente).
Simetria: |E − D| ÷ média (Robinson et al. 1987). Vista de trás/frente: queda da pelve contralateral no apoio (Bramah et al. 2018) e
posição do pé em relação à linha média (cruzamento quando passa da linha). Com ${fmt(d.amostragem.intervaloMs, ' ms', 0)} entre
quadros, contato e voo têm até ±${fmt(d.amostragem.intervaloMs, ' ms', 0)} de erro por passo; as médias de muitos passos são mais
estáveis. ${METODO_EXTRA} É triagem por vídeo: não substitui laboratório de marcha nem avaliação profissional.</p>
</body></html>`;
}

// ---------------------------------------------------------------- vários corredores

/** Retrato de todos os corredores do grupo (modo "várias pessoas"). */
export function dadosCorridaGrupo(grupo, cfg = {}, minAmostras = 8) {
  const corredores = grupo.lista(minAmostras).map((c) => {
    const d = dadosCorrida(c.sessao, { ...cfg, pontos: c.pontos });
    return { id: c.id, pontos: c.pontos, ...d };
  });
  return {
    gerado: new Date().toISOString(), app: 'GPlanSiS iaVision — Corrida (marcha), várias pessoas (CV-32)',
    vista: cfg.vista || 'lateral', alturaCm: cfg.alturaCm || 0, velocidadeKmh: cfg.velocidadeKmh || 0, camaraLenta: cfg.lenta || 1,
    amostragem: corredores[0] ? corredores[0].amostragem : { intervaloMs: null, hz: null, amostras: 0 },
    corredores,
  };
}

export function csvCorridaGrupo(d) {
  const L = ['corredor;' + COLS_CORRIDA.join(';')];
  for (const c of d.corredores) for (const p of c.passos) L.push(cel(c.id) + ';' + linhaCsvPasso(p));
  return L.join('\n') + '\n';
}

export function htmlCorridaGrupo(d) {
  const linhas = d.corredores.map((c) => {
    const rs = c.resumo;
    return `<tr><td>${esc(c.id)}</td><td class="n">${rs.passos}</td><td class="n">${fmt(rs.cadenciaPpm, '', 0)}</td><td class="n">${fmt(rs.contatoMs, '', 0)}</td>
<td class="n">${fmt(rs.vooMs, '', 0)}</td><td class="n">${fmt(rs.apoioPct, '%', 0)}</td><td class="n">${c.camera.movel ? '—' : fmt(rs.oscilacaoCm, ' cm')}</td>
<td class="n">${fmt(rs.troncoGraus, '°', 0)}</td><td class="n">${c.amostragem.amostras}</td></tr>`;
  }).join('');
  return `${cabecalho('Relatório de corrida — vários corredores', `${metaCorrida(d)} · ${d.corredores.length} corredores`)}
<h2>Todos</h2><table><tr><th>ID</th><th>Passos</th><th>Cadência</th><th>Contato ms</th><th>Voo ms</th><th>Apoio</th><th>Oscilação</th><th>Tronco</th><th>Amostras</th></tr>${linhas}</table>
<p class="nota">IDs pelo rastreio das caixas (ou pelo Re-ID/tracking da cadeia); o mesmo atleta pode ganhar um ID novo se sumir por mais de 1,5 s.</p>
${d.corredores.map((c) => `<h2>Corredor ${esc(c.id)}</h2>${corpoCorrida(c, 'h3')}`).join('\n')}
<h2>Método</h2><p class="nota">Como no relatório de um corredor, para cada um. ${METODO_EXTRA} É triagem por vídeo: não substitui
laboratório de marcha nem avaliação profissional.</p>
</body></html>`;
}
