/**
 * components/industrial/takt-comum.js — o que o painel Tempo de posto e a tela
 * cheia GPlanSiS|Takt compartilham: CSS sob demanda, formatação, ações (pôr no
 * Pipeline, criar posto, baixar arquivos), o relatório e os desenhos em canvas
 * (vídeo com postos e pessoas, Gantt de estados por posto, planta do piso).
 *
 * Os desenhos seguem as telas do Takt (Cockpit, Timeline, FloorMap): estados
 * com cor E padrão (ocioso hachurado, vago pontilhado — não depende só de cor),
 * régua do turno com a marca de "agora", planta baixa em metros com a fita do
 * posto, o raio de presença e as pessoas. O vídeo fica no palco escuro (como o
 * do app); Gantt e planta seguem o tema (variáveis --tkt-* da tela).
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { criar, marcStore, fonteParaVista, setFerramenta, selecionar } from '../../cv/marcacoes.js';
import { KP_LIGACOES } from '../../cv/operators/livres-a/pose.js';
import { COR_ESTADO, ROTULO, ESTADOS, iso, ERRO_MAX_CALIBRACAO_M } from '../../cv/runtime/livres-m/canal.js';
import { numBR } from '../../cv/numfmt.js';
import { dprCanvas, TETO_STUDIO } from '../escala-canvas.js';

export const OP = 'takt.posto';
export { COR_ESTADO, ROTULO, ESTADOS };
const fin = Number.isFinite;

/** CSS próprio (css/industrial-takt.css), carregado uma vez com a mesma versão (?v=) dos demais. */
export function carregarCss() {
  if (document.querySelector('link[data-takt]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/industrial-takt.css' + (v ? '?' + v : '');
  l.setAttribute('data-takt', '');
  document.head.appendChild(l);
}

/** Número em pt-BR com d casas, ou —. */
export const fmt = (v, d = 1) => (fin(v) ? numBR(v, d, d) : '—');
/** Fração → "72,4 %". */
export const pct = (v, d = 1) => (v == null || !fin(v) ? '—' : `${(v * 100).toFixed(d).replace('.', ',')} %`);
/** Segundos → "1h05", "12 min", "45 s". */
export function hm(seg) {
  if (!fin(seg)) return '—';
  if (seg < 60) return `${Math.round(seg)} s`;
  const h = Math.floor(seg / 3600), m = Math.round((seg % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
}
/** Duração corrida "m:ss" / "h:mm:ss". */
export function relogio(seg) {
  if (!fin(seg) || seg < 0) return '—';
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = Math.floor(seg % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export const hora = (ms) => (fin(ms) ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');
export const horaSeg = (ms) => (fin(ms) ? new Date(ms).toLocaleTimeString('pt-BR') : '—');
export const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

/** Baixa um texto/Blob como arquivo. */
export function baixar(conteudo, nome, tipo = 'text/plain') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Liga (ou adiciona) a cadeia do Takt: Pose RTMO + takt.posto. Devolve true se criou algo. */
export function ativarTakt({ abrirPipeline = false } = {}) {
  let ns = store.get().nodes;
  let criou = false;
  if (!ns.some((n) => n.op === 'pose.rtmo')) {
    // a pose vai ANTES do Takt (ou do primeiro operador): o Takt lê ctx.poses
    const i = ns.findIndex((n) => n.op === OP);
    const no = { id: newNodeId(), op: 'pose.rtmo', params: { ...defaultParams('pose.rtmo'), caixa: false }, enabled: true };
    ns = i >= 0 ? [...ns.slice(0, i), no, ...ns.slice(i)] : [...ns, no];
    criou = true;
  } else ns = ns.map((n) => (n.op === 'pose.rtmo' ? { ...n, enabled: true } : n));
  const i = ns.findIndex((n) => n.op === OP);
  if (i >= 0) ns = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n));
  else { ns = [...ns, { id: newNodeId(), op: OP, params: defaultParams(OP), enabled: true }]; criou = true; }
  store.set(abrirPipeline ? { nodes: ns, panels: { ...store.get().panels, pipeline: true } } : { nodes: ns });
  persist();
  return criou;
}

export function abrirStudioTakt() {
  ativarTakt();
  store.set({ studioTakt: true });
}

/** Postos marcados (marcações de área com a função "Takt · posto"). */
export function postosMarcados(st = marcStore.get()) {
  return st.itens.filter((i) => i.funcao === 'takt_posto');
}

/**
 * Cria um posto novo: um retângulo no centro da imagem (deslocado a cada posto)
 * com a função "Takt · posto", já selecionado para ajustar com as alças.
 */
export function novoPosto() {
  ativarTakt();
  const n = postosMarcados().length;
  const dx = ((n % 3) - 1) * 0.28, dy = (Math.floor(n / 3) % 2) * 0.22;
  const x0 = 0.38 + dx, y0 = 0.42 + dy;
  const id = criar('retangulo', [[x0, y0], [x0 + 0.24, y0 + 0.3]], { funcao: 'takt_posto', nome: `Posto ${n + 1}`, cor: '#2dd4bf' });
  setFerramenta('selecionar');
  selecionar(id);
  return `Posto ${n + 1} criado no centro do vídeo: arraste as alças para cobrir a bancada e o lugar do operador.`;
}

// ===================================================================== desenho: vídeo

/** Palco do vídeo: verde-petróleo no escuro e no claro; cinza do editor do VS Code no Code Dark (css/theme.css). */
const palco = () => (document.documentElement.getAttribute('data-theme') === 'code' ? '#1E1E1E' : '#02302C');

/** Ajusta o canvas ao tamanho exibido × dpr; devolve { g, W, H, dpr }. */
export function prepararCanvas(cv, alturaMin = 0) {
  const r = cv.getBoundingClientRect();
  const dpr = dprCanvas(r.width, Math.max(r.height, alturaMin), TETO_STUDIO);
  const W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(Math.max(r.height, alturaMin) * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { g, W, H, dpr };
}

/**
 * Vídeo: o último quadro publicado (já com os rostos borrados), os postos na
 * cor do estado, as pessoas (esqueleto, pé, ID e atividade) e, calibrando, os
 * pontos do piso e a grade de 1 m projetada pela homografia.
 * Devolve a transformação { ox, oy, k, w, h, dpr } para o clique.
 */
export function desenharVideo(cv, fundo, r, motor, { calibrando = false, selPonto = -1 } = {}) {
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = palco();
  g.fillRect(0, 0, W, H);
  const w = r ? r.w : 16, h = r ? r.h : 9;
  const k = Math.min(W / w, H / h), ox = (W - w * k) / 2, oy = (H - h * k) / 2;
  if (fundo) { g.imageSmoothingEnabled = true; g.drawImage(fundo, ox, oy, w * k, h * k); }
  else {
    g.fillStyle = 'rgba(207,235,228,.62)';
    g.font = `${13 * dpr}px Archivo, sans-serif`;
    g.textAlign = 'center';
    g.fillText('Aguardando o quadro do operador Takt…', W / 2, H / 2);
    g.textAlign = 'left';
  }
  const X = (x) => ox + x * w * k, Y = (y) => oy + y * h * k;
  if (r) {
    // grade do piso (1 m) projetada, quando calibrado
    if (motor.piso.Hinv && calibrando) desenharGradePiso(g, motor, X, Y, dpr);
    for (const c of r.postos) {
      const cor = c.estado ? COR_ESTADO[c.estado] : '#94a3b8';
      g.beginPath();
      c.poly.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.globalAlpha = 0.16; g.fillStyle = cor; g.fill(); g.globalAlpha = 1;
      g.lineWidth = 2.4 * dpr; g.strokeStyle = cor; g.setLineDash(c.estado === 'VAGO' ? [7 * dpr, 4 * dpr] : []); g.stroke(); g.setLineDash([]);
      let x0 = Infinity, y0 = Infinity;
      for (const [x, y] of c.poly) { x0 = Math.min(x0, X(x)); y0 = Math.min(y0, Y(y)); }
      const txt = c.estado ? `${c.nome} · ${ROTULO[c.estado]} ${relogio((r.t - c.desde) / 1000)}` : `${c.nome} · aguardando`;
      etiqueta(g, txt, x0, y0, cor, dpr);
    }
    for (const p of r.pessoas || []) {
      const cor = p.posto ? (p.act >= 0.55 ? COR_ESTADO.PRODUTIVO : COR_ESTADO.OCIOSO_NO_POSTO) : '#94a3b8';
      if (p.kp) {
        g.strokeStyle = 'rgba(34,211,238,.8)'; g.lineWidth = 1.6 * dpr;
        for (const [a, b] of KP_LIGACOES) {
          const p1 = p.kp[a], p2 = p.kp[b];
          if (p1[2] < 0.3 || p2[2] < 0.3) continue;
          g.beginPath(); g.moveTo(X(p1[0]), Y(p1[1])); g.lineTo(X(p2[0]), Y(p2[1])); g.stroke();
        }
      }
      g.fillStyle = cor;
      g.beginPath(); g.arc(X(p.pe[0]), Y(p.pe[1]), 5 * dpr, 0, Math.PI * 2); g.fill();
      if (p.caixa) etiqueta(g, `${p.id} · ${Math.round(p.act * 100)} %`, X(p.caixa[0]), Y(p.caixa[3]) + 18 * dpr, cor, dpr);
    }
  }
  // pontos de calibração do piso
  if (calibrando || motor.cfg.piso.pts.length) {
    const tmp = [0, 0];
    motor.cfg.piso.pts.forEach((pt, i) => {
      fonteParaVista(pt.u, pt.v, tmp);
      const x = X(tmp[0]), y = Y(tmp[1]);
      const ok = fin(pt.x) && fin(pt.y);
      g.strokeStyle = i === selPonto ? '#FFD84D' : ok ? '#7FB2FF' : '#F2A900';
      g.lineWidth = 2 * dpr;
      g.beginPath(); g.moveTo(x - 8 * dpr, y); g.lineTo(x + 8 * dpr, y); g.moveTo(x, y - 8 * dpr); g.lineTo(x, y + 8 * dpr); g.stroke();
      if (calibrando || i === selPonto) etiqueta(g, `P${i + 1}${ok ? ` (${fmt(pt.x, 2)}; ${fmt(pt.y, 2)}) m` : ' — informe x, y'}`, x + 6 * dpr, y - 4 * dpr, g.strokeStyle, dpr);
    });
  }
  if (r && r.borrado) {
    g.font = `600 ${10.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillStyle = 'rgba(2,48,44,.78)';
    const t = 'rostos borrados (LGPD)';
    const tw = g.measureText(t).width + 12 * dpr;
    g.fillRect(W - tw - 8 * dpr, H - 24 * dpr, tw, 18 * dpr);
    g.fillStyle = '#CFEBE4';
    g.fillText(t, W - tw - 2 * dpr, H - 11 * dpr);
  }
  return { ox, oy, k, w, h, dpr };
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

/** Grade de 1 m do piso, projetada na imagem pela inversa da homografia. */
function desenharGradePiso(g, motor, X, Y, dpr) {
  const pts = motor.cfg.piso.pts.filter((p) => fin(p.x) && fin(p.y));
  if (!pts.length) return;
  let x0 = Math.floor(Math.min(...pts.map((p) => p.x))) - 2, x1 = Math.ceil(Math.max(...pts.map((p) => p.x))) + 2;
  let y0 = Math.floor(Math.min(...pts.map((p) => p.y))) - 2, y1 = Math.ceil(Math.max(...pts.map((p) => p.y))) + 2;
  if (x1 - x0 > 60) x1 = x0 + 60;
  if (y1 - y0 > 60) y1 = y0 + 60;
  const tmp = [0, 0];
  const aTela = (x, y) => { const f = motor.pisoParaFonte(x, y); if (!f || !fin(f[0])) return null; fonteParaVista(f[0], f[1], tmp); return [X(tmp[0]), Y(tmp[1])]; };
  g.strokeStyle = 'rgba(127,178,255,.45)';
  g.lineWidth = 1 * dpr;
  const linha = (a, b) => {
    g.beginPath();
    let ok = false;
    for (let t = 0; t <= 20; t++) {
      const q = aTela(a[0] + ((b[0] - a[0]) * t) / 20, a[1] + ((b[1] - a[1]) * t) / 20);
      if (!q || Math.abs(q[0]) > 1e5 || Math.abs(q[1]) > 1e5) { ok = false; continue; }
      if (ok) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
      ok = true;
    }
    g.stroke();
  };
  for (let x = x0; x <= x1; x++) linha([x, y0], [x, y1]);
  for (let y = y0; y <= y1; y++) linha([x0, y], [x1, y]);
}

// ===================================================================== desenho: Gantt

/** Cores do tema lidas da própria tela (variáveis --tkt-*). */
export function tema(el) {
  const cs = getComputedStyle(el || document.documentElement);
  const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
  return {
    fundo: v('--tkt-campo', '#022621'), linha: v('--tkt-linha', 'rgba(255,255,255,.13)'), tinta: v('--tkt-tinta', '#fff'),
    tinta2: v('--tkt-tinta2', '#CFEBE4'), tinta3: v('--tkt-tinta3', 'rgba(207,235,228,.62)'), acento: v('--tkt-acento', '#FFD84D'),
  };
}

const padroes = new Map();
/** Preenchimento do estado: cor + padrão (ocioso hachurado, vago pontilhado, não observado tracejado). */
function preenchimento(g, estado, dpr) {
  const chave = `${estado}|${dpr}`;
  if (padroes.has(chave)) return padroes.get(chave);
  const cor = COR_ESTADO[estado];
  let p = cor;
  if (estado === 'OCIOSO_NO_POSTO' || estado === 'VAGO' || estado === 'NAO_OBSERVADO') {
    const t = Math.round(8 * dpr);
    const c = document.createElement('canvas');
    c.width = t; c.height = t;
    const q = c.getContext('2d');
    q.fillStyle = cor; q.fillRect(0, 0, t, t);
    q.fillStyle = 'rgba(255,255,255,.38)';
    if (estado === 'OCIOSO_NO_POSTO') {
      q.strokeStyle = 'rgba(255,255,255,.42)'; q.lineWidth = 2 * dpr;
      q.beginPath(); q.moveTo(-1, t + 1); q.lineTo(t + 1, -1); q.stroke();
    } else if (estado === 'VAGO') {
      q.beginPath(); q.arc(t / 2, t / 2, 1.4 * dpr, 0, Math.PI * 2); q.fill();
    } else {
      q.fillRect(0, t / 2 - 0.5 * dpr, t, 1 * dpr);
    }
    p = g.createPattern(c, 'repeat');
  }
  padroes.set(chave, p);
  return p;
}

/**
 * Régua do turno: uma faixa por posto, intervalos no tempo real, marca de
 * "agora" (o último quadro medido). Devolve o mapa de faixas para o tooltip.
 */
export function desenharGantt(cv, motor, kp, el) {
  const T = tema(el);
  const postos = kp ? kp.postos : [];
  const alturaFaixa = 26, topo = 22;
  cv.style.height = `${Math.max(90, topo + postos.length * (alturaFaixa + 6) + 10)}px`;
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = T.fundo;
  g.fillRect(0, 0, W, H);
  if (!kp || !postos.length) {
    g.fillStyle = T.tinta3; g.font = `${12 * dpr}px Archivo, sans-serif`;
    g.fillText('Nenhum intervalo ainda: marque um posto e deixe o vídeo correr.', 12 * dpr, 30 * dpr);
    return [];
  }
  const de = kp.janela.de, ate = Math.max(kp.janela.ate, de + 1000);
  const span = ate - de;
  const esq = 92 * dpr, dir = W - 10 * dpr, larg = dir - esq;
  const X = (t) => esq + ((t - de) / span) * larg;
  g.font = `${10.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillStyle = T.tinta3;
  g.strokeStyle = T.linha;
  g.lineWidth = 1;
  const nMarcas = W / dpr < 520 ? 3 : 5;
  for (let i = 0; i < nMarcas; i++) {
    const t = de + (span * i) / (nMarcas - 1);
    const x = X(t);
    g.textAlign = i === 0 ? 'left' : i === nMarcas - 1 ? 'right' : 'center';
    g.fillText(span > 2 * 3600e3 ? hora(t) : new Date(t).toLocaleTimeString('pt-BR'), x, 14 * dpr);
    g.beginPath(); g.moveTo(x, topo * dpr - 4 * dpr); g.lineTo(x, H); g.stroke();
  }
  g.textAlign = 'left';
  const faixas = [];
  const agora = motor.ultTs;
  postos.forEach((p, i) => {
    const y = (topo + i * (alturaFaixa + 6)) * dpr, hh = alturaFaixa * dpr;
    g.fillStyle = T.tinta;
    g.font = `600 ${11.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText(p.nome.length > 11 ? p.nome.slice(0, 10) + '…' : p.nome, 6 * dpr, y + hh / 2 + 4 * dpr);
    g.fillStyle = 'rgba(127,127,127,.12)';
    g.fillRect(esq, y, larg, hh);
    for (const iv of motor.todos(p.id)) {
      const a = Math.max(iv.inicio, de), b = Math.min(iv.fim != null ? iv.fim : agora, ate);
      if (!(b > a)) continue;
      const x0 = X(a), x1 = Math.max(x0 + 1.5 * dpr, X(b));
      g.fillStyle = preenchimento(g, iv.estado, dpr);
      g.fillRect(x0, y, x1 - x0, hh);
      faixas.push({ x0: x0 / dpr, x1: x1 / dpr, y0: y / dpr, y1: (y + hh) / dpr, iv, nome: p.nome });
    }
  });
  if (agora > de && agora < ate) {
    g.strokeStyle = T.tinta; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(X(agora), topo * dpr - 6 * dpr); g.lineTo(X(agora), H); g.stroke();
  }
  return faixas;
}

// ===================================================================== desenho: planta do piso

/**
 * Planta baixa em metros (vista de cima, pela homografia): grade, postos com a
 * fita e o raio de presença na cor do estado, pessoas com o rastro, os pontos
 * de calibração e, opcional, o calor de ocupação.
 */
export function desenharPlanta(cv, motor, r, el, { calor = false } = {}) {
  const T = tema(el);
  const { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = T.fundo;
  g.fillRect(0, 0, W, H);
  const P = motor.piso;
  if (!P.H) {
    g.fillStyle = T.tinta3;
    g.font = `${12.5 * dpr}px Archivo, sans-serif`;
    const linhas = ['Planta do piso: calibre a câmera (Calibrar piso).', 'Clique ≥ 4 pontos no chão do vídeo e informe x, y em metros;',
      `o erro de reprojeção precisa ficar ≤ ${fmt(ERRO_MAX_CALIBRACAO_M, 2)} m.`];
    linhas.forEach((t, i) => g.fillText(t, 14 * dpr, (28 + i * 19) * dpr));
    return null;
  }
  const pts = [];
  for (const p of motor.cfg.piso.pts) if (fin(p.x) && fin(p.y)) pts.push([p.x, p.y]);
  const postos = r ? r.postos.filter((c) => c.zonaM && c.zonaM.length > 2) : [];
  for (const c of postos) pts.push(...c.zonaM);
  // só quem foi visto agora há pouco (o motor guarda o ID por 10 s para o rastro e o deslocamento)
  const vistas = [...motor.pessoas.entries()].filter(([, p]) => p.unidade === 'm' && motor.ultTs - p.t <= 2000);
  for (const [, p] of vistas) pts.push(p.pos);
  if (!pts.length) return null;
  let x0 = Math.min(...pts.map((q) => q[0])), x1 = Math.max(...pts.map((q) => q[0]));
  let y0 = Math.min(...pts.map((q) => q[1])), y1 = Math.max(...pts.map((q) => q[1]));
  const m = Math.max(0.8, motor.cfg.raio_m + 0.3);
  x0 -= m; x1 += m; y0 -= m; y1 += m;
  if (x1 - x0 > 80) x1 = x0 + 80;
  if (y1 - y0 > 80) y1 = y0 + 80;
  const k = Math.min((W - 20 * dpr) / (x1 - x0), (H - 20 * dpr) / (y1 - y0));
  const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const X = (x) => ox + (x - x0) * k, Y = (y) => oy + (y - y0) * k;
  // grade de 1 m (0,5 m quando a área é pequena)
  const passo = x1 - x0 < 6 && y1 - y0 < 6 ? 0.5 : 1;
  g.strokeStyle = T.linha; g.lineWidth = 1;
  for (let x = Math.ceil(x0 / passo) * passo; x <= x1; x += passo) { g.beginPath(); g.moveTo(X(x), Y(y0)); g.lineTo(X(x), Y(y1)); g.stroke(); }
  for (let y = Math.ceil(y0 / passo) * passo; y <= y1; y += passo) { g.beginPath(); g.moveTo(X(x0), Y(y)); g.lineTo(X(x1), Y(y)); g.stroke(); }
  g.fillStyle = T.tinta3; g.font = `${10 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  g.fillText(`grade ${fmt(passo, 1)} m · erro ${fmt(P.erro, 3)} m`, 8 * dpr, H - 8 * dpr);
  // calor de ocupação (células de 0,25 m)
  if (calor && motor.calor && motor.calor.size) {
    let mx = 0;
    for (const v of motor.calor.values()) mx = Math.max(mx, v);
    for (const [ch, v] of motor.calor) {
      const [cx, cy] = ch.split(',').map(Number);
      g.globalAlpha = 0.75 * (v / mx);
      g.fillStyle = COR_ESTADO.VAGO;
      g.fillRect(X(cx * 0.25), Y(cy * 0.25), 0.25 * k + 1, 0.25 * k + 1);
    }
    g.globalAlpha = 1;
  }
  // postos: halo do raio de presença, zona na cor do estado, fita tracejada
  for (const c of postos) {
    const cor = c.estado ? COR_ESTADO[c.estado] : T.tinta3;
    const caminho = () => { g.beginPath(); c.zonaM.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.closePath(); };
    caminho();
    if (r.presenca === 'piso') { g.globalAlpha = 0.12; g.strokeStyle = cor; g.lineWidth = motor.cfg.raio_m * 2 * k; g.lineJoin = 'round'; g.stroke(); g.globalAlpha = 1; }
    caminho();
    g.globalAlpha = 0.28; g.fillStyle = cor; g.fill(); g.globalAlpha = 1;
    g.setLineDash([6 * dpr, 3 * dpr]); g.strokeStyle = cor; g.lineWidth = 2 * dpr; g.stroke(); g.setLineDash([]);
    const lx = Math.min(...c.zonaM.map((q) => X(q[0]))), ly = Math.min(...c.zonaM.map((q) => Y(q[1])));
    g.fillStyle = T.tinta; g.font = `600 ${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
    g.fillText(c.nome, lx + 3 * dpr, ly - 4 * dpr);
  }
  // pontos de calibração
  motor.cfg.piso.pts.forEach((p, i) => {
    if (!fin(p.x) || !fin(p.y)) return;
    g.strokeStyle = '#7FB2FF'; g.lineWidth = 1.5 * dpr;
    const x = X(p.x), y = Y(p.y);
    g.beginPath(); g.moveTo(x - 5 * dpr, y); g.lineTo(x + 5 * dpr, y); g.moveTo(x, y - 5 * dpr); g.lineTo(x, y + 5 * dpr); g.stroke();
    g.fillStyle = '#7FB2FF'; g.font = `${9.5 * dpr}px "IBM Plex Mono", monospace`; g.fillText(`P${i + 1}`, x + 5 * dpr, y - 4 * dpr);
  });
  // pessoas: rastro e posição
  const atual = new Map((r && r.pessoas ? r.pessoas : []).map((p) => [p.id, p]));
  for (const [id, p] of vistas) {
    const a = atual.get(id);
    const cor = a && a.posto ? (a.act >= 0.55 ? COR_ESTADO.PRODUTIVO : COR_ESTADO.OCIOSO_NO_POSTO) : T.tinta2;
    if (p.trilha.length > 1) {
      g.strokeStyle = cor; g.globalAlpha = 0.45; g.lineWidth = 1.5 * dpr;
      g.beginPath(); p.trilha.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); g.globalAlpha = 1;
    }
    g.fillStyle = cor;
    g.beginPath(); g.arc(X(p.pos[0]), Y(p.pos[1]), 0.22 * k, 0, Math.PI * 2); g.fill();
    g.strokeStyle = cor; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.arc(X(p.pos[0]), Y(p.pos[1]), 0.5 * k, 0, Math.PI * 2); g.stroke();
    g.fillStyle = T.tinta; g.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
    g.fillText(`${id} · ${fmt(p.desloc, 1)} m`, X(p.pos[0]) + 0.55 * k, Y(p.pos[1]) + 4 * dpr);
  }
  return { X, Y, k };
}

// ===================================================================== relatório

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Relatório do turno em HTML autocontido (KPIs, ranking, Gantt e planta como imagem, alarmes, eventos). */
export function relatorioHTML(motor, { gantt = null, planta = null } = {}) {
  const k = motor.kpis();
  const C = motor.cfg;
  const linhaPosto = (p, i) => `<tr><td>${i + 1}</td><td><b>${esc(p.nome)}</b></td><td>${pct(p.produtividade)}</td><td>${pct(p.ociosidade)}</td>
    <td>${pct(p.vacancia)}</td><td>${pct(p.ocupacao)}</td><td>${pct(p.cobertura)}</td><td>${hm(p.produtivo)}</td><td>${hm(p.ocioso)}</td>
    <td>${hm(p.vago)}</td><td>${hm(p.planejado)}</td><td>${hm(p.sem_dado)}</td><td>${p.publicavel ? 'sim' : 'não'}</td></tr>`;
  const al = [...motor.alarmes.values()].sort((a, b) => b.desde - a.desde);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>GPlanSiS|Takt — relatório ${esc(k ? k.janela.nome : '')}</title>
<style>body{font:14px/1.5 Archivo,Arial,sans-serif;color:#04413C;margin:24px;max-width:1100px}h1{font-size:20px;border-left:5px solid #FFD84D;padding-left:8px}
h2{font-size:15px;margin-top:22px}table{border-collapse:collapse;width:100%;font-size:12.5px}td,th{border-bottom:1px solid #cfe3df;padding:4px 6px;text-align:left}
th{background:#EAF3F1}.kpis{display:flex;gap:10px;flex-wrap:wrap}.kpi{border:1px solid #cfe3df;border-radius:8px;padding:8px 12px;min-width:120px}
.kpi b{display:block;font:600 22px "IBM Plex Mono",monospace}img{max-width:100%;border-radius:6px;border:1px solid #cfe3df}small{color:#4A6F6A}</style></head><body>
<h1>iaVision · GPlanSiS|Takt — tempo de posto</h1>
<p>${k ? `${esc(k.janela.nome)} · ${esc(iso(k.janela.de))} a ${esc(iso(Math.min(k.janela.ate, motor.ultTs || k.janela.ate)))}` : 'sem medição'} · gerado em ${esc(iso(Date.now()))}</p>
${k ? `<div class="kpis">
<div class="kpi"><b>${pct(k.geral.produtividade)}</b>produtivo</div><div class="kpi"><b>${pct(k.geral.ociosidade)}</b>ocioso no posto</div>
<div class="kpi"><b>${pct(k.geral.vacancia)}</b>vago</div><div class="kpi"><b>${pct(k.geral.ocupacao)}</b>ocupação</div>
<div class="kpi"><b>${pct(k.geral.cobertura)}</b>cobertura ${k.geral.publicavel ? '' : '(abaixo de 85 %: não publicável)'}</div></div>
<p><small>Produtividade = produtivo ÷ (produtivo + improdutivo). Não observado e pausas programadas ficam fora da conta (regra do Takt).</small></p>
<h2>Ranking de postos</h2><table><tr><th>#</th><th>Posto</th><th>Produtivo</th><th>Ocioso</th><th>Vago</th><th>Ocupação</th><th>Cobertura</th>
<th>t produtivo</th><th>t ocioso</th><th>t vago</th><th>t pausa</th><th>t não obs.</th><th>Publicável</th></tr>${k.postos.map(linhaPosto).join('')}</table>` : ''}
${gantt ? `<h2>Linha do tempo por posto</h2><img alt="Gantt de estados por posto" src="${gantt}">` : ''}
${planta ? `<h2>Planta do piso</h2><img alt="Planta do piso" src="${planta}">` : ''}
<h2>Alarmes</h2>${al.length ? `<table><tr><th>Desde</th><th>Tipo</th><th>Posto</th><th>Descrição</th><th>Situação</th></tr>${al.map((a) => `<tr><td>${esc(iso(a.desde))}</td><td>${esc(a.tipo)}</td><td>${esc(a.posto)}</td><td>${esc(a.texto)}</td><td>${a.ativo ? 'ativo' : 'normalizado ' + esc(iso(a.fim))}</td></tr>`).join('')}</table>` : '<p>Nenhum alarme.</p>'}
<h2>Eventos (últimos 300)</h2><table><tr><th>Hora</th><th>Posto</th><th>Evento</th><th>Detalhe</th></tr>${motor.eventos.slice(-300).reverse().map((e) => `<tr><td>${esc(iso(e.ts))}</td><td>${esc(e.posto)}</td><td>${esc(e.evento)}</td><td>${esc(e.detalhe)}</td></tr>`).join('')}</table>
<h2>Parâmetros</h2><p><small>Tempos: ${esc(C.tempos)} (entrar ${C.params.enter_confirm_s} s, ocioso ${C.params.idle_confirm_s} s, vago ${C.params.vacant_confirm_s} s, sem quadro ${C.params.stale_s} s; histerese ${C.params.act_on}/${C.params.act_off}).
Presença ${C.presenca === 'piso' && motor.piso.calibrado ? `no piso, raio ${fmt(C.raio_m, 1)} m` : `no plano da imagem, raio ${fmt(C.raio_img, 2)} da altura do quadro`}; piso ${motor.piso.calibrado ? `calibrado (erro ${fmt(motor.piso.erro, 3)} m)` : 'sem calibração'}.
Turnos: ${C.turnos.length ? C.turnos.map((t) => `${esc(t.nome)} ${t.inicio}–${t.fim}`).join(', ') : 'nenhum (mede sempre)'} · fuso ${esc(C.fuso)}.
Privacidade: ${C.privacidade.borrar ? 'rostos borrados a partir da pose; nenhuma imagem sai do aparelho' : 'BORRÃO DESLIGADO'}.</small></p>
</body></html>`;
}
