/**
 * components/saude/fisio-comum.js — o que o painel Fisio e o Studio Fisio
 * compartilham: CSS sob demanda, pôr/configurar o nó no Pipeline, desenhos
 * (vídeo com a pose e o arco da articulação; curvas ângulo × tempo e subida
 * do quadril × tempo com as fases), CSV e o relatório (HTML para imprimir ou
 * salvar em PDF). NÃO É DISPOSITIVO MÉDICO — o aviso vai em todas as saídas.
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { OSSOS } from '../../cv/runtime/livres-h/comum.js';
import { ARTICULACOES, TESTES, REF, FONTES, normaSTS30, num } from '../../cv/runtime/livres-p/fisio.js';
import { dprCanvas, TETO_STUDIO } from '../escala-canvas.js';

export const OP = 'fisio.avaliar';
export const AVISO_MEDICO = 'Não é dispositivo médico: apoio à avaliação por profissional habilitado. Ângulos 2D pela pose sem marcador têm erro de alguns graus; tempos dependem da câmera estável e do corpo inteiro no quadro.';
export const ROTULO_PARAM = { goniometria: 'goniometria (ADM)', tug: 'TUG', sts5: 'sentar-levantar 5×', sts30: 'sentar-levantar 30 s' };
export const LADO_PARAM = { auto: 'automático', e: 'esquerdo', d: 'direito' };
const fin = Number.isFinite;
export { num, TESTES, ARTICULACOES, REF, FONTES };

export function carregarCss() {
  if (document.querySelector('link[data-fisio]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/saude-fisio.css' + (v ? '?' + v : '');
  l.setAttribute('data-fisio', '');
  document.head.appendChild(l);
}

/** Liga (ou adiciona) o nó Fisio e aplica `patch` nos parâmetros (rótulos do nó). */
export function ativarFisio(patch = {}, { abrirPipeline = false } = {}) {
  let ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === OP);
  if (i >= 0) ns = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null, params: { ...n.params, ...patch } } : n));
  else ns = [...ns, { id: newNodeId(), op: OP, params: { ...defaultParams(OP), ...patch }, enabled: true }];
  store.set(abrirPipeline ? { nodes: ns, panels: { ...store.get().panels, pipeline: true } } : { nodes: ns });
  persist();
}

export const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export function baixar(conteudo, nome, tipo = 'text/plain') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function prepararCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = dprCanvas(r.width, r.height, TETO_STUDIO);
  const W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { g, W, H, dpr };
}
export function tema(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return { fundo: v('--fis-campo', '#022621'), linha: v('--fis-linha', 'rgba(255,255,255,.13)'), tinta: v('--fis-tinta', '#fff'),
    tinta2: v('--fis-tinta2', '#CFEBE4'), tinta3: v('--fis-tinta3', 'rgba(207,235,228,.7)'), acento: v('--fis-acento', '#FFD84D'),
    ok: v('--fis-ok', '#8CE0C8'), erro: v('--fis-erro', '#FF8A80') };
}
const palco = () => (document.documentElement.getAttribute('data-theme') === 'code' ? '#1E1E1E' : '#02302C');

// ===================================================================== vídeo

/** Quadro + esqueleto (esquerdo ciano, direito laranja) + o ângulo medido. */
export function desenharVideo(cv, fundo, r) {
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = palco(); g.fillRect(0, 0, W, H);
  const w = r && r.w ? r.w : 4, h = r && r.h ? r.h : 3;
  const k = Math.min(W / w, H / h), ox = (W - w * k) / 2, oy = (H - h * k) / 2;
  if (fundo) g.drawImage(fundo, ox, oy, w * k, h * k);
  else { g.fillStyle = 'rgba(207,235,228,.62)'; g.font = `${13 * dpr}px Archivo, sans-serif`; g.textAlign = 'center'; g.fillText('Aguardando a pose do operador Fisio…', W / 2, H / 2); g.textAlign = 'left'; }
  const P = r && r.P;
  if (!P) return;
  const minVis = (r.cfg && r.cfg.minVis) || 0.4;
  const q = (i) => (P[i] && P[i].v >= minVis ? [ox + P[i].x * k, oy + P[i].y * k] : null);
  g.lineCap = 'round';
  for (const [l, cor] of [['e', '#22d3ee'], ['d', '#fb923c'], ['meio', '#e5e7eb']]) {
    g.strokeStyle = cor; g.lineWidth = 3 * dpr;
    for (const [a, b] of OSSOS[l]) { const A = q(a), B = q(b); if (A && B) { g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); } }
  }
  const res = r.res;
  if (res && res.teste === 'goniometria' && res.lado) {
    const A = ARTICULACOES[res.art];
    const [ia, ib, ic] = A.pontos(res.lado);
    const pa = q(ia), pb = q(ib), pc = q(ic);
    if (pa && pb && pc) {
      g.strokeStyle = '#FFD84D'; g.lineWidth = 4 * dpr;
      g.beginPath(); g.moveTo(pa[0], pa[1]); g.lineTo(pb[0], pb[1]); g.lineTo(pc[0], pc[1]); g.stroke();
      const a1 = Math.atan2(pa[1] - pb[1], pa[0] - pb[0]), a2 = Math.atan2(pc[1] - pb[1], pc[0] - pb[0]);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      g.fillStyle = 'rgba(255,216,77,.28)'; g.beginPath(); g.moveTo(pb[0], pb[1]); g.arc(pb[0], pb[1], 30 * dpr, a1, a1 + d, d < 0); g.closePath(); g.fill();
      const txt = `${num(res.atual, 0)}°`;
      g.font = `700 ${16 * dpr}px "IBM Plex Mono", monospace`;
      const tw = g.measureText(txt).width + 12 * dpr;
      g.fillStyle = 'rgba(2,48,44,.85)'; g.fillRect(pb[0] + 14 * dpr, pb[1] - 30 * dpr, tw, 24 * dpr);
      g.fillStyle = '#FFD84D'; g.fillText(txt, pb[0] + 20 * dpr, pb[1] - 12 * dpr);
    }
  }
}

// ===================================================================== curvas

/**
 * Goniometria: ângulo × tempo (últimos 20 s) com a faixa de referência e as
 * marcas de máx/mín. Testes: subida do quadril (em coxas) × tempo com as
 * fases sombreadas e a velocidade horizontal tracejada.
 */
export function desenharCurva(cv, res, el) {
  const T = tema(el);
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = T.fundo; g.fillRect(0, 0, W, H);
  const esq = 44 * dpr, dir = W - 12 * dpr, topo = 14 * dpr, base = H - 26 * dpr;
  const vazio = (t) => { g.fillStyle = T.tinta3; g.font = `${12 * dpr}px Archivo, sans-serif`; g.fillText(t, esq, H / 2); };
  g.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  if (!res) { vazio('Sem dados ainda.'); return; }
  if (res.teste === 'goniometria') {
    const s = res.serie || [];
    if (s.length < 2) { vazio('Mova a articulação na frente da câmera (vista ' + ARTICULACOES[res.art].vista + ').'); return; }
    const t1 = s[s.length - 1].t, t0 = Math.max(s[0].t, t1 - 20000);
    const A = ARTICULACOES[res.art];
    const lo = Math.min(A.ref[0], ...res.suave.filter(fin)) - 10, hi = Math.max(A.ref[1], ...res.suave.filter(fin)) + 10;
    const X = (t) => esq + ((t - t0) / Math.max(1, t1 - t0)) * (dir - esq), Y = (v) => base - ((v - lo) / (hi - lo)) * (base - topo);
    // faixa de referência
    g.fillStyle = 'rgba(140,224,200,.10)'; g.fillRect(esq, Y(A.ref[1]), dir - esq, Y(A.ref[0]) - Y(A.ref[1]));
    eixo(g, T, esq, dir, topo, base, lo, hi, Y, dpr, '°');
    g.strokeStyle = T.acento; g.lineWidth = 2.2 * dpr; g.beginPath();
    let k = 0;
    s.forEach((a, i) => { const v = res.suave[i]; if (a.t < t0 || v == null) return; (k++ ? g.lineTo : g.moveTo).call(g, X(a.t), Y(v)); });
    g.stroke();
    for (const [v, nome, cor] of [[res.max, 'máx', T.ok], [res.min, 'mín', T.tinta2]]) {
      if (v == null) continue;
      g.strokeStyle = cor; g.setLineDash([5 * dpr, 4 * dpr]); g.lineWidth = 1.2 * dpr;
      g.beginPath(); g.moveTo(esq, Y(v)); g.lineTo(dir, Y(v)); g.stroke(); g.setLineDash([]);
      g.fillStyle = cor; g.fillText(`${nome} ${num(v, 0)}°`, dir - 70 * dpr, Y(v) - 4 * dpr);
    }
    g.fillStyle = T.tinta3; g.fillText(`referência ${A.ref[0]}–${A.ref[1]}° (AAOS)`, esq + 6 * dpr, topo + 10 * dpr);
    return;
  }
  // testes cronometrados: a curva da tentativa em curso (sinais) ou a arquivada (curva)
  let pts;
  if (res.curva) pts = res.curva.map(([t, s, vx]) => ({ t: t * 1000, s, vx }));
  else if (res.sinais && res.sinais.ts.length) {
    const sg = res.sinais, t0 = sg.tInicio ?? sg.ts[0];
    pts = sg.ts.map((t, i) => ({ t: t - t0, s: sg.s[i], vx: sg.vx[i] }));
  }
  if (!pts || pts.filter((p) => p.s != null).length < 2) { vazio(res.sinais && !res.sinais.base ? 'Sente-se e fique parado ~1 s (corpo inteiro, de lado para a câmera).' : 'Sem curva ainda.'); return; }
  const ta = pts[0].t, tb = pts[pts.length - 1].t;
  const lo = -0.2, hi = 1.3;
  const X = (t) => esq + ((t - ta) / Math.max(1, tb - ta)) * (dir - esq), Y = (v) => base - ((v - lo) / (hi - lo)) * (base - topo);
  // fases (TUG)
  const t0 = res.tInicio, mk = res.marcas;
  if (res.teste === 'tug' && res.fases && (mk || res.tFim)) {
    const rel = (t) => (res.curva ? t - (res.tInicio ?? 0) : t - (res.sinais.tInicio ?? res.sinais.ts[0]));
    const marcas = [['levantar', t0, mk ? mk.emPe : null], ['ida', mk && mk.emPe, mk && mk.giro0], ['giro', mk && mk.giro0, mk && mk.giro1],
      ['volta', mk && mk.giro1, mk && mk.volta1], ['sentar', mk ? mk.volta1 : null, res.tFim]];
    const cores = ['rgba(127,178,255,.16)', 'rgba(79,179,135,.14)', 'rgba(242,169,0,.18)', 'rgba(79,179,135,.14)', 'rgba(216,115,93,.16)'];
    marcas.forEach(([n, a, b], i) => {
      if (a == null || b == null) return;
      const xa = X(rel(a)), xb = X(rel(b));
      g.fillStyle = cores[i]; g.fillRect(xa, topo, xb - xa, base - topo);
      g.fillStyle = T.tinta2; g.fillText(n, xa + 3 * dpr, topo + 10 * dpr);
    });
  }
  eixo(g, T, esq, dir, topo, base, lo, hi, Y, dpr, '');
  // limiares
  for (const [v, n] of [[0.75, 'em pé'], [0.25, 'sentado']]) {
    g.strokeStyle = T.linha; g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.moveTo(esq, Y(v)); g.lineTo(dir, Y(v)); g.stroke(); g.setLineDash([]);
    g.fillStyle = T.tinta3; g.fillText(n, dir - 50 * dpr, Y(v) - 3 * dpr);
  }
  // vx (tracejada, escala ÷ 3)
  g.strokeStyle = 'rgba(127,178,255,.8)'; g.lineWidth = 1.2 * dpr; g.setLineDash([3 * dpr, 3 * dpr]); g.beginPath();
  let k = 0;
  for (const p of pts) if (p.vx != null) (k++ ? g.lineTo : g.moveTo).call(g, X(p.t), Y(Math.max(lo, Math.min(hi, Math.abs(p.vx) / 3))));
  g.stroke(); g.setLineDash([]);
  g.strokeStyle = T.acento; g.lineWidth = 2.4 * dpr; g.beginPath();
  k = 0;
  for (const p of pts) if (p.s != null) (k++ ? g.lineTo : g.moveTo).call(g, X(p.t), Y(p.s));
  g.stroke();
  // início e fim
  for (const [t, n] of [[res.tInicio != null ? 0 : null, 'início'], [res.total != null ? res.total * 1000 : null, 'fim']]) {
    if (t == null || t < ta || t > tb) continue;
    g.strokeStyle = T.ok; g.lineWidth = 1.6 * dpr; g.beginPath(); g.moveTo(X(t), topo); g.lineTo(X(t), base); g.stroke();
    g.fillStyle = T.ok; g.fillText(n, X(t) + 3 * dpr, base - 4 * dpr);
  }
  g.fillStyle = T.tinta3;
  g.fillText('— subida do quadril (coxas)   ‐‐ |velocidade| ÷ 3 (coxas/s)', esq + 6 * dpr, H - 8 * dpr);
}

function eixo(g, T, esq, dir, topo, base, lo, hi, Y, dpr, un) {
  g.strokeStyle = T.linha; g.lineWidth = 1; g.fillStyle = T.tinta3; g.textAlign = 'right';
  const passo = (hi - lo) > 60 ? 30 : (hi - lo) > 4 ? 1 : 0.25;
  for (let v = Math.ceil(lo / passo) * passo; v <= hi; v += passo) {
    g.beginPath(); g.moveTo(esq, Y(v)); g.lineTo(dir, Y(v)); g.stroke();
    g.fillText(`${num(v, passo < 1 ? 2 : 0)}${un}`, esq - 4 * dpr, Y(v) + 3 * dpr);
  }
  g.textAlign = 'left';
}

// ===================================================================== CSV e relatório

const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
const ladoTxt = (l) => (l === 'e' ? 'esquerdo' : l === 'd' ? 'direito' : '—');

export function medidasCSV(sessao, pac) {
  const l = ['paciente;quando;articulacao;lado;min_graus;max_graus;amplitude_graus;referencia_max;pct_referencia;vista'];
  for (const m of sessao.medidas) l.push([cel(pac ? pac.nome : ''), m.quando, cel(m.nome), ladoTxt(m.lado), cel(m.min), cel(m.max), cel(m.amplitude), m.ref[1], cel(m.pctRef != null ? m.pctRef * 100 : null), m.vista].join(';'));
  return '﻿' + l.join('\n');
}
export function tentativasCSV(sessao, pac) {
  const l = ['paciente;quando;teste;n;total_s;repeticoes;levantar_s;ida_s;giro_s;volta_s;sentar_s;velocidade_m_s;referencia;acima_da_referencia'];
  for (const t of sessao.tentativas) {
    const f = t.fases || {};
    const ref = t.teste === 'tug' ? REF.tug : t.teste === 'sts5' ? REF.sts5 : '';
    l.push([cel(pac ? pac.nome : ''), t.quando, cel(TESTES[t.teste].nome), t.n, cel(t.teste === 'sts30' ? null : t.total), t.nRep ?? '',
      cel(f.levantar), cel(f.ida), cel(f.giro), cel(f.volta), cel(f.sentar), cel(t.velocidade), ref, t.risco === 'alto' ? 'sim' : t.risco ? 'nao' : ''].join(';'));
  }
  return '﻿' + l.join('\n');
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Relatório HTML (abre numa janela para imprimir / salvar em PDF). imagens: { video, curva } em data URL. */
export function relatorioHTML(sessao, pac, imagens = {}) {
  const tent = sessao.tentativas, med = sessao.medidas;
  const norma = pac ? normaSTS30(pac.idade, pac.sexo) : null;
  const linhaT = (t) => {
    const f = t.fases || {};
    const val = t.teste === 'sts30' ? `${t.nRep} vezes${t.meia ? ' (com meia subida)' : ''}` : `${num(t.total, 2)} s`;
    const ref = t.teste === 'tug' ? `≥ ${num(REF.tug, 1)} s: risco aumentado de queda` : t.teste === 'sts5' ? `≥ ${REF.sts5} s: risco de queda`
      : norma ? `faixa normal ${norma[0]}–${norma[1]} (idade/sexo)` : 'informe idade e sexo para a norma';
    const fora = t.teste === 'sts30' ? (norma && t.nRep < norma[0] ? 'abaixo da faixa' : norma ? 'na faixa ou acima' : '—') : t.risco === 'alto' ? 'ACIMA' : 'abaixo';
    return `<tr><td>${t.n}</td><td>${esc(TESTES[t.teste].nome)}</td><td><b>${val}</b></td><td>${t.teste === 'tug' ? `levantar ${num(f.levantar, 2)} · ida ${num(f.ida, 2)} · giro ${num(f.giro, 2)} · volta ${num(f.volta, 2)} · sentar ${num(f.sentar, 2)} s${t.velocidade ? ` · marcha ≈ ${num(t.velocidade, 2)} m/s` : ''}` : t.reps ? t.reps.map((r) => num(r.dur ?? 0, 2)).join(' · ') : ''}</td><td>${esc(ref)}</td><td>${esc(fora)}</td></tr>`;
  };
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>GPlanSiS|Fisio — ${esc(pac ? pac.nome : 'avaliação')}</title>
<style>body{font:14px/1.5 Archivo,Arial,sans-serif;color:#04413C;margin:24px;max-width:1000px}h1{font-size:20px;border-left:5px solid #FFD84D;padding-left:8px}
.faixa{background:#C8102E;color:#fff;padding:6px 12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:4px}
h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border-bottom:1px solid #cfe3df;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#EAF3F1}img{max-width:100%;border-radius:6px;border:1px solid #cfe3df}small,.fonte{color:#4A6F6A;font-size:11.5px}
.aviso{border:1px solid #C69A00;background:#FFF6D6;padding:8px 10px;border-radius:6px;font-size:12.5px}dl{display:grid;grid-template-columns:auto 1fr;gap:2px 14px}dt{color:#4A6F6A}dd{margin:0}
@media print{body{margin:10mm}}</style></head><body>
<h1>iaVision · GPlanSiS|Fisio — avaliação funcional</h1>
<div class="faixa">Visão geral · ${esc(pac ? pac.nome : 'paciente sem cadastro')}</div>
<p class="aviso"><b>${esc(AVISO_MEDICO)}</b></p>
<h2>Paciente</h2><dl><dt>Nome / código</dt><dd>${esc(pac ? pac.nome : '—')}</dd><dt>Idade</dt><dd>${pac && pac.idade ? esc(pac.idade) + ' anos' : '—'}</dd>
<dt>Sexo</dt><dd>${pac && pac.sexo ? (pac.sexo === 'F' ? 'feminino' : 'masculino') : '—'}</dd><dt>Altura</dt><dd>${pac && pac.alturaCm ? esc(pac.alturaCm) + ' cm' : '—'}</dd>
<dt>Lado acometido</dt><dd>${esc(pac && pac.ladoAcometido ? pac.ladoAcometido : '—')}</dd><dt>Diagnóstico / queixa</dt><dd>${esc(pac && pac.diagnostico ? pac.diagnostico : '—')}</dd>
<dt>Observações</dt><dd>${esc(pac && pac.observacoes ? pac.observacoes : '—')}</dd><dt>Gerado em</dt><dd>${esc(new Date().toLocaleString('pt-BR'))}</dd></dl>
${med.length ? `<h2>Amplitude de movimento (goniometria 2D)</h2><table><tr><th>#</th><th>Articulação</th><th>Lado</th><th>Mín.</th><th>Máx.</th><th>Amplitude</th><th>Referência</th><th>% da ref.</th></tr>
${med.map((m) => `<tr><td>${m.n}</td><td>${esc(m.nome)}</td><td>${ladoTxt(m.lado)}</td><td>${num(m.min, 0)}°</td><td><b>${num(m.max, 0)}°</b></td><td>${num(m.amplitude, 0)}°</td><td>${m.ref[0]}–${m.ref[1]}°</td><td>${m.pctRef != null ? num(m.pctRef * 100, 0) + ' %' : '—'}</td></tr>`).join('')}</table>
<p class="fonte">Referência: ${esc(FONTES.adm)}. Pose sem marcador: ICC 0,74–0,93 em quadril e joelho (PMC11783685).</p>` : ''}
${tent.length ? `<h2>Testes funcionais</h2><table><tr><th>#</th><th>Teste</th><th>Resultado</th><th>Fases / repetições</th><th>Referência</th><th>Situação</th></tr>${tent.map(linhaT).join('')}</table>
<p class="fonte">${[FONTES.tugProto, FONTES.tug, FONTES.sts5, FONTES.sts30].map(esc).join('<br>')}</p>` : ''}
${imagens.curva ? `<h2>Curva</h2><img alt="Curva do teste" src="${imagens.curva}">` : ''}
${imagens.video ? `<h2>Quadro</h2><img alt="Quadro com a pose" src="${imagens.video}">` : ''}
<p class="fonte">Medido no navegador (GPlanSiS iaVision, CV-47); nenhuma imagem sai do aparelho. Tempos pelo relógio do vídeo (arquivo) ou do quadro capturado (câmera).</p>
</body></html>`;
}
