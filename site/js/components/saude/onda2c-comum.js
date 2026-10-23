/**
 * components/saude/onda2c-comum.js — o que o painel "Saúde e esportes+" e o
 * Studio Vitais dividem (onda 2-c, CV-70..77): aplicar preset, CSS sob
 * demanda, CSV e relatório HTML genéricos a partir do retrato do canal, e o
 * desenho de série e espectro. Saúde: o aviso "não é dispositivo médico" vai
 * em TODA exportação.
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { PRESETS_ONDA2C, criarMarcacoesOnda2c } from '../presets-onda2c.js';
import { AVISO_SAUDE } from '../../cv/runtime/livres-t/clinica.js';
import { dprCanvas, TETO_STUDIO } from '../escala-canvas.js';

export { PRESETS_ONDA2C, AVISO_SAUDE };
export const OPS_ONDA2C = [...new Set(PRESETS_ONDA2C.map((p) => p.op))];

export function carregarCss() {
  if (document.querySelector('link[data-onda2c]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/saude-onda2c.css' + (v ? '?' + v : ''); l.setAttribute('data-onda2c', '');
  document.head.appendChild(l);
}

/** Põe a cadeia do preset no Pipeline (substitui a atual, como os presets do Pipeline) e abre o painel. */
export function aplicarPresetOnda2c(pr, { studio = false } = {}) {
  const nodes = pr.specs.map(([op, over]) => ({ id: newNodeId(), op, params: { ...defaultParams(op), ...(over || {}) }, enabled: true }));
  const st = store.get();
  store.set({ nodes, panels: { ...st.panels, onda2c: true }, ...(studio ? { studioOnda2c: true } : {}) });
  persist();
  criarMarcacoesOnda2c(pr.nome);
}

/** Operador da onda 2-c ativo na cadeia (o último ligado), ou null. */
export function opAtivo(nodes) {
  const l = nodes.filter((n) => n.enabled && OPS_ONDA2C.includes(n.op));
  return l.length ? l[l.length - 1] : null;
}

export const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export function baixar(conteudo, nome, tipo = 'text/plain') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const cel = (v) => (v == null || v === '' ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : `"${String(v).replace(/"/g, '""')}"`);
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** CSV dos registros (com o aviso na 1ª linha quando é de saúde). */
export function registrosCSV(r) {
  const regs = (r && r.registros) || [];
  const cols = (r && r.colunas) || [...new Set(regs.flatMap((x) => Object.keys(x)))];
  const l = [];
  if (r && r.saude) l.push(`# ${AVISO_SAUDE}`);
  l.push(cols.join(';'));
  for (const x of regs) l.push(cols.map((c) => cel(x[c])).join(';'));
  return '﻿' + l.join('\n');
}

const fmt = (v, casas = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(casas).replace('.', ','));
export function textoPrincipal(pr) {
  if (!pr) return '—';
  const c = pr.casas ?? (pr.unidade === 'Hz' ? 1 : 0);
  return `${fmt(pr.valor, c)} ${pr.unidade || ''}`.trim();
}

/** Relatório HTML (imprimir → PDF) a partir do retrato. imagem: data URL opcional. */
export function relatorioHTML(r, { imagem = null, sujeito = '' } = {}) {
  const regs = r.registros || [];
  const cols = r.colunas || [...new Set(regs.flatMap((x) => Object.keys(x)))];
  const pr = r.principal;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>iaVision — ${esc(r.titulo)}</title>
<style>body{font:14px/1.5 Archivo,Arial,sans-serif;color:#04413C;margin:24px;max-width:1000px}h1{font-size:20px;border-left:5px solid #FFD84D;padding-left:8px}
h2{font-size:15px;margin-top:20px}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border-bottom:1px solid #cfe3df;padding:4px 6px;text-align:left}th{background:#EAF3F1}
.aviso{border:1px solid #C69A00;background:#FFF6D6;padding:8px 10px;border-radius:6px;font-weight:700}.fonte{color:#4A6F6A;font-size:11.5px}img{max-width:100%;border:1px solid #cfe3df;border-radius:6px}
.big{font-size:28px;font-weight:800}@media print{body{margin:10mm}}</style></head><body>
<h1>iaVision · ${esc(r.titulo)}</h1>
${r.saude ? `<p class="aviso">${esc(AVISO_SAUDE)}</p>` : ''}
${sujeito ? `<p><b>Identificação:</b> ${esc(sujeito)}</p>` : ''}
<p class="big">${esc(textoPrincipal(pr))}${pr && pr.faixa ? ` <small>(faixa ${fmt(pr.faixa[0], 0)}–${fmt(pr.faixa[1], 0)})</small>` : ''}</p><p>${esc(pr ? pr.rotulo : '')}</p>
${(r.linhas || []).length ? `<table>${r.linhas.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</table>` : ''}
${(r.avisos || []).length ? `<h2>Condições e avisos</h2><ul>${r.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
${regs.length ? `<h2>Registros</h2><table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${regs.map((x) => `<tr>${cols.map((c) => `<td>${esc(typeof x[c] === 'number' ? fmt(x[c], 2) : x[c])}</td>`).join('')}</tr>`).join('')}</table>` : ''}
${imagem ? `<h2>Quadro</h2><img alt="quadro" src="${imagem}">` : ''}
${r.fonte ? `<p class="fonte">Fonte/método: ${esc(r.fonte)}</p>` : ''}
<p class="fonte">Gerado em ${esc(new Date().toLocaleString('pt-BR'))} no navegador (GPlanSiS iaVision); nenhuma imagem sai do aparelho.${r.saude ? ' ' + esc(AVISO_SAUDE) : ''}</p>
</body></html>`;
}
export function abrirRelatorio(h, nome) {
  const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (!w) { const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ------------------------------------------------------------------ desenho

export function prepararCanvas(cv) {
  const b = cv.getBoundingClientRect();
  const dpr = dprCanvas(b.width, b.height, TETO_STUDIO);
  const W = Math.max(2, Math.round(b.width * dpr)), H = Math.max(2, Math.round(b.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0);
  return { g, W, H, dpr };
}
export function cores(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return { fundo: v('--o2-campo', '#022621'), linha: v('--o2-linha', 'rgba(255,255,255,.13)'), tinta: v('--o2-tinta3', 'rgba(207,235,228,.7)'), acento: v('--o2-acento', '#FFD84D'), ok: v('--o2-ok', '#8CE0C8') };
}
/** Série (ts ms, ys) como linha. */
export function desenharSerie(cv, serie, el, rotulo = '') {
  const C = cores(el), { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = C.fundo; g.fillRect(0, 0, W, H);
  g.font = `${11 * dpr}px "IBM Plex Mono", monospace`; g.fillStyle = C.tinta;
  const ys = serie ? serie.ys.filter(Number.isFinite) : [];
  if (ys.length < 2) { g.fillText('sem sinal ainda', 10 * dpr, H / 2); return; }
  const ts = serie.ts, t0 = ts[0], t1 = ts[ts.length - 1] || t0 + 1;
  let lo = Math.min(...ys), hi = Math.max(...ys); if (hi - lo < 1e-9) { hi += 1; lo -= 1; }
  const X = (t) => 8 * dpr + ((t - t0) / (t1 - t0 || 1)) * (W - 16 * dpr), Y = (v) => H - 14 * dpr - ((v - lo) / (hi - lo)) * (H - 30 * dpr);
  g.strokeStyle = C.acento; g.lineWidth = 1.8 * dpr; g.beginPath();
  let k = 0; serie.ys.forEach((v, i) => { if (!Number.isFinite(v)) return; (k++ ? g.lineTo : g.moveTo).call(g, X(ts[i]), Y(v)); }); g.stroke();
  g.fillText(`${rotulo || serie.rotulo || ''} · ${((t1 - t0) / 1000).toFixed(0)} s`, 8 * dpr, 12 * dpr);
}
/** Espectro { f (Hz), p } com o pico marcado em /min (escala ×60). */
export function desenharEspectro(cv, esp, el, pico = null, faixa = null, un = '/min') {
  const C = cores(el), { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = C.fundo; g.fillRect(0, 0, W, H);
  g.font = `${11 * dpr}px "IBM Plex Mono", monospace`; g.fillStyle = C.tinta;
  if (!esp || !esp.f || esp.f.length < 2) { g.fillText('sem espectro ainda', 10 * dpr, H / 2); return; }
  const f = Array.from(esp.f), p = Array.from(esp.p), max = Math.max(...p) || 1;
  const k = un === 'Hz' ? 1 : 60;
  const X = (x) => 8 * dpr + ((x - f[0]) / (f[f.length - 1] - f[0])) * (W - 16 * dpr), Y = (v) => H - 16 * dpr - (v / max) * (H - 32 * dpr);
  if (faixa) { g.fillStyle = 'rgba(140,224,200,.16)'; g.fillRect(X(faixa[0] / k), 4, X(faixa[1] / k) - X(faixa[0] / k), H - 20 * dpr); }
  g.strokeStyle = C.ok; g.lineWidth = 1.6 * dpr; g.beginPath(); f.forEach((x, i) => (i ? g.lineTo : g.moveTo).call(g, X(x), Y(p[i]))); g.stroke();
  if (pico != null) { g.strokeStyle = C.acento; g.beginPath(); g.moveTo(X(pico / k), 4); g.lineTo(X(pico / k), H - 16 * dpr); g.stroke(); }
  g.fillStyle = C.tinta;
  g.fillText(`${(f[0] * k).toFixed(0)}`, 8 * dpr, H - 3 * dpr); g.textAlign = 'right'; g.fillText(`${(f[f.length - 1] * k).toFixed(0)} ${un}`, W - 8 * dpr, H - 3 * dpr); g.textAlign = 'left';
}
/** Esqueleto normalizado (33 × [x,y] | null) dentro de uma caixa do canvas. */
const OSSOS_N = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]];
export function desenharBoneco(g, pose, cx, cy, esc, cor, larg = 3) {
  if (!pose) return;
  g.strokeStyle = cor; g.lineWidth = larg; g.lineCap = 'round';
  for (const [a, b] of OSSOS_N) { const A = pose[a], B = pose[b]; if (!A || !B) continue; g.beginPath(); g.moveTo(cx + A[0] * esc, cy + A[1] * esc); g.lineTo(cx + B[0] * esc, cy + B[1] * esc); g.stroke(); }
  const n = pose[0]; if (n) { g.fillStyle = cor; g.beginPath(); g.arc(cx + n[0] * esc, cy + n[1] * esc, larg * 2, 0, 2 * Math.PI); g.fill(); }
}
