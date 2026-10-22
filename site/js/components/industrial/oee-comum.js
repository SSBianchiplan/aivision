/**
 * components/industrial/oee-comum.js — o que o painel OEE e a tela cheia
 * GPlanSiS|OEE compartilham: CSS sob demanda, ações (pôr no Pipeline, marcar
 * a máquina e a área de setup), desenhos em canvas (vídeo com as ROIs na cor
 * do estado, linha do tempo por máquina, Pareto dos motivos) e o relatório.
 * Formatação e download vêm do Takt (takt-comum.js), o mesmo desenho industrial.
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { criar, marcStore, setFerramenta, selecionar } from '../../cv/marcacoes.js';
import { COR, ROTULO, ESTADOS, SEM_MOTIVO } from '../../cv/runtime/livres-o/canal.js';
import { iso } from '../../cv/runtime/livres-o/oee.js';
import { fmt, pct, hm, relogio, hora, horaSeg, carimbo, baixar, prepararCanvas } from './takt-comum.js';

export const OP = 'maquina.estado';
export { COR, ROTULO, ESTADOS, SEM_MOTIVO, fmt, pct, hm, relogio, hora, horaSeg, carimbo, baixar, prepararCanvas };
const fin = Number.isFinite;

/** CSS próprio (css/industrial-oee.css), com a mesma versão (?v=) dos demais. Serve também ao painel EPI. */
export function carregarCss() {
  if (document.querySelector('link[data-oee]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/industrial-oee.css' + (v ? '?' + v : '');
  l.setAttribute('data-oee', '');
  document.head.appendChild(l);
}

/** Liga (ou adiciona) o nó maquina.estado no Pipeline. */
export function ativarOEE({ abrirPipeline = false } = {}) {
  let ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === OP);
  if (i >= 0) ns = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
  else ns = [...ns, { id: newNodeId(), op: OP, params: defaultParams(OP), enabled: true }];
  store.set(abrirPipeline ? { nodes: ns, panels: { ...store.get().panels, pipeline: true } } : { nodes: ns });
  persist();
}

export const maquinasMarcadas = (st = marcStore.get()) => st.itens.filter((i) => i.funcao === 'oee_maquina');
export const setupsMarcados = (st = marcStore.get()) => st.itens.filter((i) => i.funcao === 'oee_setup');

/** Cria a área de uma máquina (ou de setup) no centro do vídeo, já selecionada para ajustar com as alças. */
export function novaArea(tipo = 'maquina') {
  ativarOEE();
  const n = tipo === 'maquina' ? maquinasMarcadas().length : setupsMarcados().length;
  const dx = ((n % 3) - 1) * 0.26;
  const x0 = (tipo === 'maquina' ? 0.3 : 0.62) + dx * 0.5, y0 = tipo === 'maquina' ? 0.25 : 0.55;
  const nome = tipo === 'maquina' ? `Máquina ${n + 1}` : `Setup ${n + 1}`;
  const id = criar('retangulo', [[x0, y0], [x0 + (tipo === 'maquina' ? 0.3 : 0.2), y0 + (tipo === 'maquina' ? 0.36 : 0.25)]],
    { funcao: tipo === 'maquina' ? 'oee_maquina' : 'oee_setup', nome, cor: tipo === 'maquina' ? '#4FB387' : '#7FB2FF' });
  setFerramenta('selecionar');
  selecionar(id);
  return tipo === 'maquina'
    ? `${nome} marcada no centro do vídeo: arraste as alças sobre a parte que SE MOVE quando a máquina trabalha.`
    : `${nome} marcada: cubra a bancada de ferramental / o lugar do ajuste (movimento ali com a máquina quieta = setup).`;
}

// ===================================================================== tema e padrões

const palco = () => (document.documentElement.getAttribute('data-theme') === 'code' ? '#1E1E1E' : '#02302C');

export function tema(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return {
    fundo: v('--oee-campo', '#022621'), linha: v('--oee-linha', 'rgba(255,255,255,.13)'), tinta: v('--oee-tinta', '#fff'),
    tinta2: v('--oee-tinta2', '#CFEBE4'), tinta3: v('--oee-tinta3', 'rgba(207,235,228,.62)'), acento: v('--oee-acento', '#FFD84D'),
  };
}

const padroes = new Map();
/** Cor + padrão do estado (parada hachurada, setup pontilhado, não observado tracejado) — não depende só de cor. */
export function preenchimento(g, estado, dpr) {
  const chave = `${estado}|${dpr}`;
  if (padroes.has(chave)) return padroes.get(chave);
  const cor = COR[estado];
  let p = cor;
  if (estado === 'PARADA' || estado === 'SETUP' || estado === 'NAO_OBSERVADO') {
    const t = Math.round(8 * dpr);
    const c = document.createElement('canvas');
    c.width = t; c.height = t;
    const q = c.getContext('2d');
    q.fillStyle = cor; q.fillRect(0, 0, t, t);
    q.fillStyle = 'rgba(255,255,255,.4)';
    if (estado === 'PARADA') { q.strokeStyle = 'rgba(255,255,255,.42)'; q.lineWidth = 2 * dpr; q.beginPath(); q.moveTo(-1, t + 1); q.lineTo(t + 1, -1); q.stroke(); }
    else if (estado === 'SETUP') { q.beginPath(); q.arc(t / 2, t / 2, 1.4 * dpr, 0, Math.PI * 2); q.fill(); }
    else q.fillRect(0, t / 2 - 0.5 * dpr, t, 1 * dpr);
    p = g.createPattern(c, 'repeat');
  }
  padroes.set(chave, p);
  return p;
}

function etiqueta(g, txt, x, y, cor, dpr) {
  g.font = `600 ${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  const tw = g.measureText(txt).width + 10 * dpr, th = 17 * dpr;
  const ly = Math.max(0, y - th);
  g.fillStyle = cor;
  g.fillRect(x, ly, tw, th);
  g.fillStyle = '#02302C';
  g.fillText(txt, x + 5 * dpr, ly + 12.5 * dpr);
}

// ===================================================================== vídeo

/** Vídeo: o último quadro com as ROIs na cor do estado e o movimento. */
export function desenharVideo(cv, fundo, r) {
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = palco();
  g.fillRect(0, 0, W, H);
  const w = r ? r.w : 16, h = r ? r.h : 9;
  const k = Math.min(W / w, H / h), ox = (W - w * k) / 2, oy = (H - h * k) / 2;
  if (fundo) { g.imageSmoothingEnabled = true; g.drawImage(fundo, ox, oy, w * k, h * k); }
  else {
    g.fillStyle = 'rgba(207,235,228,.62)'; g.font = `${13 * dpr}px Archivo, sans-serif`; g.textAlign = 'center';
    g.fillText('Aguardando o quadro do operador OEE…', W / 2, H / 2); g.textAlign = 'left';
  }
  const X = (x) => ox + x * w * k, Y = (y) => oy + y * h * k;
  if (r && r.rois) {
    for (const ro of r.rois) {
      const m = r.maquinas.find((x) => x.id === ro.id);
      const cor = ro.tipo === 'setup' ? '#7FB2FF' : m && m.estado ? COR[m.estado] : '#94a3b8';
      g.beginPath();
      ro.poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.globalAlpha = ro.tipo === 'setup' ? 0.08 : 0.16; g.fillStyle = cor; g.fill(); g.globalAlpha = 1;
      g.lineWidth = (ro.tipo === 'setup' ? 1.6 : 2.6) * dpr; g.strokeStyle = cor;
      g.setLineDash(ro.tipo === 'setup' ? [6 * dpr, 4 * dpr] : m && m.estado === 'PARADA' ? [9 * dpr, 4 * dpr] : []);
      g.stroke(); g.setLineDash([]);
      let x0 = Infinity, y0 = Infinity;
      for (const [x, y] of ro.poly) { x0 = Math.min(x0, X(x)); y0 = Math.min(y0, Y(y)); }
      const mov = ro.tipo === 'setup' ? ro.mov : m && m.mov;
      const txt = ro.tipo === 'setup' ? `${ro.nome} · mov ${pct(mov)}`
        : `${ro.nome} · ${m && m.estado ? `${ROTULO[m.estado]} ${relogio((r.t - m.desde) / 1000)}` : 'aguardando'} · mov ${pct(mov)}`;
      etiqueta(g, txt, x0, y0, cor, dpr);
    }
  }
  return { ox, oy, k, w, h, dpr };
}

// ===================================================================== linha do tempo

/** Uma faixa por máquina na janela do KPI, com a marca de agora. Devolve as faixas (tooltip e clique). */
export function desenharGantt(cv, motor, kp, el, selId = null) {
  const T = tema(el);
  const maqs = kp ? kp.maquinas : [];
  const alturaFaixa = 28, topo = 22;
  cv.style.height = `${Math.max(90, topo + maqs.length * (alturaFaixa + 6) + 10)}px`;
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = T.fundo;
  g.fillRect(0, 0, W, H);
  if (!kp || !maqs.length) {
    g.fillStyle = T.tinta3; g.font = `${12 * dpr}px Archivo, sans-serif`;
    g.fillText('Nenhum intervalo ainda: marque a máquina e deixe o vídeo correr.', 12 * dpr, 30 * dpr);
    return [];
  }
  const de = kp.janela.de, ate = Math.max(kp.janela.turno ? kp.janela.ate : motor.ultTs || de, de + 1000);
  const span = ate - de;
  const esq = 96 * dpr, dir = W - 10 * dpr, larg = dir - esq;
  const X = (t) => esq + ((t - de) / span) * larg;
  g.font = `${10.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillStyle = T.tinta3; g.strokeStyle = T.linha; g.lineWidth = 1;
  const nMarcas = W / dpr < 520 ? 3 : 6;
  for (let i = 0; i < nMarcas; i++) {
    const t = de + (span * i) / (nMarcas - 1), x = X(t);
    g.textAlign = i === 0 ? 'left' : i === nMarcas - 1 ? 'right' : 'center';
    g.fillText(span > 2 * 3600e3 ? hora(t) : new Date(t).toLocaleTimeString('pt-BR'), x, 14 * dpr);
    g.beginPath(); g.moveTo(x, topo * dpr - 4 * dpr); g.lineTo(x, H); g.stroke();
  }
  g.textAlign = 'left';
  const faixas = [];
  const agora = motor.ultTs;
  maqs.forEach((m, i) => {
    const y = (topo + i * (alturaFaixa + 6)) * dpr, hh = alturaFaixa * dpr;
    g.fillStyle = T.tinta;
    g.font = `600 ${11.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText(m.nome.length > 11 ? m.nome.slice(0, 10) + '…' : m.nome, 6 * dpr, y + hh / 2 + 4 * dpr);
    g.fillStyle = 'rgba(127,127,127,.12)';
    g.fillRect(esq, y, larg, hh);
    for (const iv of motor.todos(m.id)) {
      const a = Math.max(iv.inicio, de), b = Math.min(iv.fim != null ? iv.fim : agora, ate);
      if (!(b > a)) continue;
      const x0 = X(a), x1 = Math.max(x0 + 1.5 * dpr, X(b));
      g.fillStyle = preenchimento(g, iv.estado, dpr);
      g.fillRect(x0, y, x1 - x0, hh);
      if (iv.id === selId) { g.strokeStyle = T.acento; g.lineWidth = 2.5 * dpr; g.strokeRect(x0 + 1, y + 1, x1 - x0 - 2, hh - 2); }
      else if ((iv.estado === 'PARADA' || iv.estado === 'SETUP') && iv.motivo) {
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0, y + hh - 4 * dpr, x1 - x0, 4 * dpr);
      }
      faixas.push({ x0: x0 / dpr, x1: x1 / dpr, y0: y / dpr, y1: (y + hh) / dpr, iv, nome: m.nome });
    }
  });
  if (agora != null && agora >= de && agora <= ate) {
    g.strokeStyle = T.acento; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(X(agora), topo * dpr - 6 * dpr); g.lineTo(X(agora), H); g.stroke();
  }
  return faixas;
}

// ===================================================================== Pareto

/** Barras do tempo por motivo (maior primeiro) + linha do acumulado. */
export function desenharPareto(cv, motivos, el) {
  const T = tema(el);
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = T.fundo; g.fillRect(0, 0, W, H);
  const l = (motivos || []).filter((m) => m.seg > 0);
  if (!l.length) {
    g.fillStyle = T.tinta3; g.font = `${12 * dpr}px Archivo, sans-serif`;
    g.fillText('Sem paradas na janela.', 12 * dpr, 26 * dpr);
    return;
  }
  const tot = l.reduce((s, m) => s + m.seg, 0);
  const esq = 44 * dpr, dir = W - 40 * dpr, topo = 16 * dpr, base = H - 58 * dpr;
  const bw = (dir - esq) / l.length;
  const max = l[0].seg;
  let acc = 0;
  const pts = [];
  g.font = `${10 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  l.forEach((m, i) => {
    const x = esq + i * bw, hh = ((base - topo) * m.seg) / max;
    g.fillStyle = m.motivo === SEM_MOTIVO ? '#F2A900' : m.planejada ? '#93A0B5' : '#D8735D';
    g.fillRect(x + bw * 0.12, base - hh, bw * 0.76, hh);
    acc += m.seg;
    pts.push([x + bw / 2, base - ((base - topo) * acc) / tot]);
    g.fillStyle = T.tinta2; g.textAlign = 'center';
    g.fillText(hm(m.seg), x + bw / 2, base - hh - 3 * dpr);
    g.save(); g.translate(x + bw / 2, base + 6 * dpr); g.rotate(-Math.PI / 9); g.textAlign = 'right'; g.fillStyle = T.tinta3;
    const nome = m.motivo.length > 18 ? m.motivo.slice(0, 17) + '…' : m.motivo;
    g.fillText(nome, 0, 8 * dpr); g.restore();
  });
  g.strokeStyle = T.acento; g.lineWidth = 2 * dpr; g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  for (const [x, y] of pts) { g.fillStyle = T.acento; g.beginPath(); g.arc(x, y, 3 * dpr, 0, Math.PI * 2); g.fill(); }
  g.textAlign = 'left'; g.fillStyle = T.tinta3; g.fillText('100 %', dir + 3 * dpr, topo + 4 * dpr); g.fillText('acum.', dir + 3 * dpr, topo + 16 * dpr);
}

// ===================================================================== relatório

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function relatorioHTML(motor, { gantt = null, pareto = null } = {}) {
  const k = motor.kpis();
  const G = k && k.geral;
  const C = motor.cfg;
  const tur = motor.porTurno();
  const par = motor.paradas().slice(0, 300);
  const fator = (v, n) => `<div class="kpi"><b>${pct(v)}</b>${n}</div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>GPlanSiS|OEE — relatório ${esc(k ? k.janela.nome : '')}</title>
<style>body{font:14px/1.5 Archivo,Arial,sans-serif;color:#04413C;margin:24px;max-width:1100px}h1{font-size:20px;border-left:5px solid #FFD84D;padding-left:8px}
h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border-bottom:1px solid #cfe3df;padding:4px 6px;text-align:left}
th{background:#EAF3F1}.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpi{border:1px solid #cfe3df;border-radius:8px;padding:8px 12px;min-width:120px}
.kpi b{display:block;font:600 22px "IBM Plex Mono",monospace}img{max-width:100%;border-radius:6px;border:1px solid #cfe3df}small{color:#4A6F6A}
@media print{body{margin:10mm}}</style></head><body>
<h1>iaVision · GPlanSiS|OEE — eficiência global do equipamento</h1>
<p>${k ? `${esc(k.janela.nome)} · ${esc(iso(k.janela.de))} a ${esc(iso(Math.min(k.janela.ate, motor.ultTs || k.janela.ate)))}` : 'sem medição'} · gerado em ${esc(iso(Date.now()))}</p>
${G ? `<div class="kpis">${fator(G.oee, `OEE${G.parcial ? ` (parcial: falta ${esc(G.faltam.join(', '))})` : ''}`)}${fator(G.disponibilidade, 'disponibilidade')}${fator(G.desempenho, 'desempenho')}${fator(G.qualidade, 'qualidade')}
<div class="kpi"><b>${G.pecas == null ? '—' : G.pecas}</b>peças${G.boas != null ? ` · ${G.boas} boas` : ''}</div></div>
<p><small>OEE = disponibilidade × desempenho × qualidade (Nakajima 1988; ISO 22400-2). Tempo planejado = observado − pausas programadas − não observado − paradas com motivo planejado.
Desempenho = ciclo ideal (${C.cicloIdeal_s ? fmt(C.cicloIdeal_s, 2) + ' s/peça' : 'não informado'}) × peças ÷ tempo operando.</small></p>
<h2>Tempos</h2><table><tr><th>Máquina</th><th>Planejado</th><th>Operando</th><th>Parada</th><th>Setup</th><th>Pausa prog.</th><th>Não observado</th><th>Disponibilidade</th><th>OEE</th></tr>
${k.maquinas.map((m) => `<tr><td><b>${esc(m.nome)}</b>${m.producao ? ' (produção)' : ''}</td><td>${hm(m.planejado)}</td><td>${hm(m.operando)}</td><td>${hm(m.seg.PARADA)}</td><td>${hm(m.seg.SETUP)}</td><td>${hm(m.seg.PAUSA_PROGRAMADA)}</td><td>${hm(m.seg.NAO_OBSERVADO)}</td><td>${pct(m.disponibilidade)}</td><td>${pct(m.oee)}</td></tr>`).join('')}</table>` : ''}
${gantt ? `<h2>Linha do tempo</h2><img alt="Estados por máquina" src="${gantt}">` : ''}
${pareto ? `<h2>Pareto dos motivos de parada</h2><img alt="Pareto dos motivos" src="${pareto}">` : ''}
${G ? `<h2>Motivos</h2><table><tr><th>Motivo</th><th>Planejada</th><th>Ocorrências</th><th>Tempo</th></tr>${G.motivos.map((m) => `<tr><td>${esc(m.motivo)}</td><td>${m.planejada ? 'sim' : 'não'}</td><td>${m.n}</td><td>${hm(m.seg)}</td></tr>`).join('')}</table>` : ''}
<h2>OEE por turno</h2><table><tr><th>Janela</th><th>De</th><th>Disponib.</th><th>Desemp.</th><th>Qualid.</th><th>OEE</th><th>Peças</th></tr>
${tur.map(({ janela: j, k: x }) => (x ? `<tr><td>${esc(j.nome)}</td><td>${esc(iso(j.de))}</td><td>${pct(x.disponibilidade)}</td><td>${pct(x.desempenho)}</td><td>${pct(x.qualidade)}</td><td>${pct(x.oee)}</td><td>${x.pecas == null ? '—' : x.pecas}</td></tr>` : '')).join('')}</table>
<h2>Paradas e setups (${par.length})</h2><table><tr><th>Máquina</th><th>Tipo</th><th>Início</th><th>Duração</th><th>Motivo</th></tr>
${par.map((p) => `<tr><td>${esc(p.nome)}</td><td>${esc(ROTULO[p.estado])}</td><td>${esc(iso(p.inicio))}</td><td>${hm(((p.fim != null ? p.fim : motor.ultTs) - p.inicio) / 1000)}</td><td>${esc(p.motivo || SEM_MOTIVO)}</td></tr>`).join('')}</table>
<h2>Parâmetros</h2><p><small>Movimento: on ${fmt(C.params.on * 100, 1)} % · off ${fmt(C.params.off * 100, 1)} % dos pixels da ROI; confirmar rodando ${C.params.confRodando_s} s, parada ${C.params.confParada_s} s, setup ${C.params.confSetup_s} s (retroagem ao início);
microparada ${C.params.microParada_s ? `< ${C.params.microParada_s} s conta como desempenho` : 'desligada'}; sem quadro → não observado após ${C.params.stale_s} s.
Turnos: ${C.turnos.length ? C.turnos.map((t) => `${esc(t.nome)} ${t.inicio}–${t.fim}`).join(', ') : 'nenhum (mede sempre)'} · fuso ${esc(C.fuso)}.
Fontes: ${['contador', 'inspect', 'takt'].filter((x) => motor.fontes[x]).map((x) => ({ contador: 'CounterVision (peças)', inspect: 'Inspect (OK/NOK)', takt: 'Takt (operador)' })[x]).join(', ') || 'só o movimento (peças e refugo por apontamento manual)'}.
Nenhuma imagem sai do aparelho.</small></p>
</body></html>`;
}

/** Imagem de um canvas em data URL (ou null se o canvas estiver contaminado). */
export const imgDe = (c) => { try { return c ? c.toDataURL('image/png') : null; } catch (_) { return null; } };
export { fin };
