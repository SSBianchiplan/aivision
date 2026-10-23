/**
 * components/industrial/counter-comum.js — o que o painel "Contagem em
 * esteira" e a tela cheia GPlanSiS|CounterVision dividem (CV-38):
 *
 *   - pôr a cadeia no Pipeline (motor COR, detector livre + rastreio, ou o
 *     .onnx do usuário) e mudar parâmetros do nó de produção;
 *   - criar a linha de contagem nas Ferramentas de mouse (a mesma marcação
 *     que o CV-37 usa: nada de segundo editor);
 *   - desenhar o vídeo com linhas, zonas, peças e IDs (canvas próprio da
 *     tela cheia, a partir do elemento da fonte do app);
 *   - o gráfico de peças por minuto;
 *   - DATASET: capturar o quadro com as caixas atuais (formato YOLO), baixar
 *     o ZIP YOLO e enviar ao Treinar (mesma API do painel Fonte › YouTube ›
 *     Quadros para treinar: /api/treino, senha do Treinar, lotes por projeto),
 *     já com os rótulos gravados em PUT …/rotulos;
 *   - a folha de estilo própria (css/industrial-counter.css), injetada na
 *     primeira montagem para não mexer no app.html.
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { marcStore, criar, vista, vistaParaFonte, baixar as baixarTexto } from '../../cv/marcacoes.js';
import { zipStore, baixarBlob } from '../../camera/youtube.js';
import { instantaneo, motorCor } from '../../cv/runtime/livres-l/esteira.js';
import { amostraDeHex } from '../../cv/runtime/livres-l/cor.js';
import { colorFor } from '../../cv/runtime/opkit.js';
import { numBR } from '../../cv/numfmt.js';
import { dprCanvas, TETO_STUDIO } from '../escala-canvas.js';

export const OP = 'contagem.esteira';
export const fin = Number.isFinite;
export const fmt = (v, d = 1) => (fin(v) ? numBR(v, d, d) : '—');
export const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
export { baixarTexto, baixarBlob };

// ------------------------------------------------------------------ estilo

let cssPosto = false;
/** Injeta css/industrial-counter.css uma vez (mesmo ?v= do app.css). */
export function injetarCSS() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-counter]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/industrial-counter.css' + (v ? '?v=' + v : ''); l.dataset.aivCounter = '1';
  document.head.appendChild(l);
}

// ------------------------------------------------------------------ cadeias

const CENA = ['cena.zonas', { fonte: 'detecções', ponto: 'centro', umaVez: true }];
export const CADEIAS = {
  cor: { rotulo: 'Motor COR (sem modelo)', specs: [['contagem.cor', {}], CENA, [OP, {}]] },
  yolox: { rotulo: 'Detector YOLOX + rastreio de esteira', specs: [['dnn.detect', { conf: 0.35 }], ['contagem.rastreio', {}], CENA, [OP, {}]] },
  yoloxbt: { rotulo: 'Detector YOLOX + ByteTrack', specs: [['dnn.detect', { conf: 0.35 }], ['track.bytetrack', {}], CENA, [OP, {}]] },
  rfdetr: { rotulo: 'Detector RF-DETR + rastreio de esteira', specs: [['rfdetr.detect', {}], ['contagem.rastreio', {}], CENA, [OP, {}]] },
  onnx: { rotulo: 'Meu .onnx + rastreio de esteira', specs: [['contagem.onnx', {}], ['contagem.rastreio', {}], CENA, [OP, {}]] },
};
const DETECTORES = new Set(['contagem.cor', 'contagem.onnx', 'contagem.rastreio', 'dnn.detect', 'rfdetr.detect', 'track.bytetrack']);

/** Qual cadeia está no Pipeline (pelo primeiro detector), ou null. */
export function cadeiaAtual(nodes = store.get().nodes) {
  if (!nodes.some((n) => n.op === OP)) return null;
  if (nodes.some((n) => n.op === 'contagem.cor' && n.enabled)) return 'cor';
  if (nodes.some((n) => n.op === 'contagem.onnx' && n.enabled)) return 'onnx';
  if (nodes.some((n) => n.op === 'rfdetr.detect' && n.enabled)) return 'rfdetr';
  if (nodes.some((n) => n.op === 'dnn.detect' && n.enabled)) return nodes.some((n) => n.op === 'track.bytetrack' && n.enabled) ? 'yoloxbt' : 'yolox';
  return 'outro';
}

/**
 * Põe a cadeia de contagem no Pipeline. Com a contagem já presente, troca só o
 * detector (mantém os parâmetros do nó de produção: metas, turnos, alarmes).
 * Devolve 'criada' | 'trocada' | 'ligada'.
 */
export function ativarContador({ motor = null, abrirPipeline = false, painel = true } = {}) {
  const st = store.get();
  const atual = cadeiaAtual(st.nodes);
  const alvo = motor || (atual && atual !== 'outro' ? atual : 'cor');
  const specs = CADEIAS[alvo].specs;
  let nodes, res;
  if (!atual) {
    nodes = [...st.nodes, ...specs.map(([op, p]) => ({ id: newNodeId(), op, params: { ...defaultParams(op), ...p }, enabled: true }))];
    res = 'criada';
  } else if (atual === alvo) {
    nodes = st.nodes.map((n) => (specs.some(([op]) => op === n.op) ? { ...n, enabled: true, error: null } : n));
    res = 'ligada';
  } else {
    // troca os detectores: tira os da cadeia antiga, põe os novos antes do cena.zonas
    const resto = st.nodes.filter((n) => !DETECTORES.has(n.op));
    const novos = specs.filter(([op]) => DETECTORES.has(op)).map(([op, p]) => ({ id: newNodeId(), op, params: { ...defaultParams(op), ...p }, enabled: true }));
    let i = resto.findIndex((n) => n.op === 'cena.zonas');
    if (i < 0) { resto.splice(resto.findIndex((n) => n.op === OP), 0, { id: newNodeId(), op: CENA[0], params: { ...defaultParams(CENA[0]), ...CENA[1] }, enabled: true }); i = resto.findIndex((n) => n.op === 'cena.zonas'); }
    nodes = [...resto.slice(0, i), ...novos, ...resto.slice(i)];
    res = 'trocada';
  }
  const panels = { ...st.panels };
  if (abrirPipeline) panels.pipeline = true;
  if (painel) panels.contador = true;
  store.set({ nodes, panels });
  persist();
  return res;
}

/** Parâmetros atuais do nó de produção (ou os padrões). */
export function paramsEsteira(nodes = store.get().nodes) {
  const n = nodes.find((x) => x.op === OP);
  return { ...defaultParams(OP), ...(n ? n.params : {}) };
}
/** Muda um parâmetro de um nó da cadeia (o primeiro com o op). */
export function definirParam(op, k, v) {
  const st = store.get();
  const i = st.nodes.findIndex((n) => n.op === op);
  if (i < 0) return false;
  store.set({ nodes: st.nodes.map((n, j) => (j === i ? { ...n, params: { ...n.params, [k]: v } } : n)) });
  persist();
  return true;
}

// ------------------------------------------------------------------ linha de contagem

/** Linhas de cruzamento nas marcações. */
export function linhasDeContagem() {
  return marcStore.get().itens.filter((i) => i.tipo === 'linha' && i.funcao === 'cruzamento');
}
/**
 * Cria a linha de contagem no meio da imagem. 'vertical' conta peças andando
 * na horizontal (esquerda → direita = ida); 'horizontal', de cima para baixo = ida.
 */
export function criarLinha(orient = 'vertical') {
  const pts = orient === 'vertical' ? [[0.5, 0.92], [0.5, 0.08]] : [[0.08, 0.5], [0.92, 0.5]];
  // pontos na vista atual (o quadro do pipeline) → fonte inteira (sem zoom/espelho)
  const fonte = vista.ok || vista.el ? pts.map(([x, y]) => vistaParaFonte(x, y)) : pts;
  return criar('linha', fonte, { nome: 'Contagem ' + (linhasDeContagem().length + 1) });
}
/** Linha por dois pontos no quadro (normalizados), como desenhada no Studio. */
export function criarLinhaPorPontos(a, b) {
  return criar('linha', [vistaParaFonte(a[0], a[1]), vistaParaFonte(b[0], b[1])], { nome: 'Contagem ' + (linhasDeContagem().length + 1) });
}

// ------------------------------------------------------------------ exemplo

export const VIDEO_EXEMPLO = 'amostras/contador/esteira-cores.mp4';
/**
 * Abre a esteira de exemplo (vídeo sintético: peças vermelhas, verdes e azuis,
 * algumas encostadas, da esquerda para a direita) como ARQUIVO na fonte do
 * app, com o motor COR, as três cores e a linha vertical no meio.
 * `abrirArquivo` = o pickFile do workspace.
 */
export async function abrirExemplo(abrirArquivo) {
  ativarContador({ motor: 'cor', painel: false });
  const m = motorCor();
  if (!m.amostras.length) for (const [hx, n] of [['#d72323', 'vermelho'], ['#23a53c', 'verde'], ['#284bd7', 'azul']]) m.adicionar(amostraDeHex(hx, n));
  const resp = await fetch(VIDEO_EXEMPLO);
  if (!resp.ok) throw new Error(`vídeo de exemplo não encontrado (${resp.status})`);
  const arq = new File([await resp.blob()], 'esteira-cores.mp4', { type: 'video/mp4' });
  if (abrirArquivo) await abrirArquivo(arq);
  if (!linhasDeContagem().length) setTimeout(() => criarLinha('vertical'), 400);   // depois da vista conhecer o tamanho
}

// ------------------------------------------------------------------ vídeo + sobreposição

/**
 * Desenha o quadro (o mesmo recorte e espelho que o pipeline recebe) e a
 * contagem por cima. Devolve a transformação { ox, oy, dw, dh } (px do canvas)
 * para converter cliques em coordenadas do quadro.
 */
/** Palco dos canvases: verde-petróleo no escuro e no claro; cinza do editor do VS Code no Code Dark (css/theme.css). */
const palco = () => (document.documentElement.getAttribute('data-theme') === 'code' ? '#1E1E1E' : '#02302C');

export function desenharVideo(cv, opc = {}) {
  const r = cv.getBoundingClientRect();
  const dpr = dprCanvas(r.width, r.height, TETO_STUDIO);
  const W = Math.max(50, Math.round(r.width * dpr)), H = Math.max(50, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.fillStyle = palco(); g.fillRect(0, 0, W, H);
  const el = vista.el;
  const sw = vista.sw || 16, sh = vista.sh || 9;
  const k = Math.min(W / sw, H / sh);
  const dw = sw * k, dh = sh * k, ox = (W - dw) / 2, oy = (H - dh) / 2;
  const T = { ox, oy, dw, dh, dpr };
  if (!el) {
    g.fillStyle = 'rgba(207,235,228,.7)'; g.font = `${13 * dpr}px Archivo, sans-serif`; g.textAlign = 'center';
    g.fillText('Sem imagem: escolha a fonte (câmera, arquivo, YouTube) na barra do app.', W / 2, H / 2);
    g.textAlign = 'start';
    return T;
  }
  g.save();
  if (vista.fd) { g.translate(ox + dw, oy); g.scale(-1, 1); g.translate(-ox, -oy); }
  try { g.drawImage(el, vista.sx, vista.sy, vista.sw, vista.sh, ox, oy, dw, dh); } catch (_) { /* fonte trocando */ }
  g.restore();
  const ret = instantaneo();
  if (opc.mascara) desenharMascara(g, T);
  const X = (u) => ox + u * dw, Y = (v) => oy + v * dh;
  const u = dw / 100;
  if (ret) {
    const cz = (ret.cena && ret.cena.zonas) || {}, cl = (ret.cena && ret.cena.linhas) || {};
    for (const it of ret.itens || []) {
      if (it.funcao !== 'zona' && it.funcao !== 'cruzamento') continue;
      const cor = it.cor || '#FFD84D';
      g.lineWidth = Math.max(2, u * 0.35); g.strokeStyle = cor;
      if (it.funcao === 'zona') {
        g.beginPath();
        if (it.tipo === 'retangulo' || it.tipo === 'elipse') {
          const c = it.caixa;
          if (it.tipo === 'retangulo') g.rect(X(c.x1), Y(c.y1), X(c.x2) - X(c.x1), Y(c.y2) - Y(c.y1));
          else g.ellipse(X((c.x1 + c.x2) / 2), Y((c.y1 + c.y2) / 2), Math.abs(X(c.x2) - X(c.x1)) / 2, Math.abs(Y(c.y2) - Y(c.y1)) / 2, 0, 0, 7);
        } else it.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
        g.closePath(); g.globalAlpha = 0.18; g.fillStyle = cor; g.fill(); g.globalAlpha = 1; g.stroke();
        const z = cz[it.id];
        const c = it.caixa || { x1: it.pts[0][0], y1: it.pts[0][1] };
        bolha(g, `${z ? z.ocupacao : 0} agora · ${z ? z.entradas : 0}`, X(c.x1) + u * 6, Y(c.y1) - u * 2.4, cor, u * 0.8);
      } else {
        const [a, b] = it.pts;
        g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke();
        // seta do sentido "ida" (como as Ferramentas de mouse: perpendicular, no meio)
        const mx = (X(a[0]) + X(b[0])) / 2, my = (Y(a[1]) + Y(b[1])) / 2;
        let nx = -(Y(b[1]) - Y(a[1])), ny = X(b[0]) - X(a[0]);
        const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
        // "ida" = do lado negativo para o positivo do produto vetorial (cena.zonas), sinal trocado com espelho
        const sg = vista.fs !== vista.fd ? -1 : 1;
        nx *= sg; ny *= sg;
        const s = u * 3;
        g.beginPath(); g.moveTo(mx - nx * s, my - ny * s); g.lineTo(mx + nx * s, my + ny * s);
        g.lineTo(mx + nx * s * 0.45 - ny * s * 0.4, my + ny * s * 0.45 + nx * s * 0.4);
        g.moveTo(mx + nx * s, my + ny * s); g.lineTo(mx + nx * s * 0.45 + ny * s * 0.4, my + ny * s * 0.45 - nx * s * 0.4);
        g.stroke();
        const q = cl[it.id];
        bolha(g, `${q ? q.ida : 0} ida · ${q ? q.volta : 0} volta`, mx, Math.min(Y(a[1]), Y(b[1])) + u * 2.4, cor, u * 0.75);
      }
    }
    // peças
    const ids = opc.ids !== false;
    for (const d of ret.dets || []) {
      const cor = d.id != null ? colorFor(d.id) : '#FFFFFF';
      const x = X(d.x1), y = Y(d.y1), w = X(d.x2) - x, h = Y(d.y2) - y;
      g.lineWidth = Math.max(1.5, u * 0.2); g.strokeStyle = cor; g.strokeRect(x, y, w, h);
      g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.max(2.5, u * 0.45), 0, 7); g.fillStyle = cor; g.fill();
      if (ids && d.id != null) {
        g.font = `600 ${Math.max(10, u * 1.25)}px "IBM Plex Mono", monospace`;
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
        g.strokeText('#' + d.id, x, y - 3); g.fillStyle = '#fff'; g.fillText('#' + d.id, x, y - 3);
      }
    }
  }
  if (opc.rascunho && opc.rascunho.length) {
    const p = opc.rascunho[0];
    g.beginPath(); g.arc(X(p[0]), Y(p[1]), Math.max(4, u * 0.7), 0, 7); g.fillStyle = '#FFD84D'; g.fill();
  }
  return T;
}

const mascaraCv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const PAL = [[255, 216, 77], [34, 211, 238], [74, 222, 128], [244, 114, 182], [167, 139, 250], [251, 146, 60]];
function desenharMascara(g, T) {
  const m = motorCor();
  if (!m.cls || !m.ww || !mascaraCv) return;
  if (mascaraCv.width !== m.ww || mascaraCv.height !== m.wh) { mascaraCv.width = m.ww; mascaraCv.height = m.wh; }
  const c = mascaraCv.getContext('2d'), im = c.createImageData(m.ww, m.wh), d = im.data;
  for (let i = 0; i < m.cls.length; i++) {
    const k = m.cls[i]; if (!k) continue;
    const p = PAL[(k - 1) % PAL.length];
    d[4 * i] = p[0]; d[4 * i + 1] = p[1]; d[4 * i + 2] = p[2]; d[4 * i + 3] = 150;
  }
  c.putImageData(im, 0, 0);
  g.imageSmoothingEnabled = false; g.drawImage(mascaraCv, T.ox, T.oy, T.dw, T.dh); g.imageSmoothingEnabled = true;
}

function bolha(g, txt, x, y, cor, u) {
  g.font = `700 ${Math.max(12, u * 2.2)}px Archivo, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = Math.max(3, u * 0.5); g.strokeStyle = 'rgba(0,0,0,.78)'; g.strokeText(txt, x, y);
  g.fillStyle = cor; g.fillText(txt, x, y); g.textAlign = 'start'; g.textBaseline = 'alphabetic';
}

/** Barras de peças por minuto (últimos `n` minutos) com a taxa da meta tracejada. */
export function desenharMinutos(cv, minutos, metaPorMin, n = 30) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = cv.getBoundingClientRect();
  const W = Math.max(50, Math.round(r.width * dpr)), H = Math.max(40, Math.round(r.height * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.fillStyle = palco(); g.fillRect(0, 0, W, H);
  const lista = (minutos || []).slice(-n);
  const pad = { l: 34 * dpr, r: 8 * dpr, t: 10 * dpr, b: 20 * dpr };
  const max = Math.max(1, metaPorMin || 0, ...lista.map((m) => m.n)) * 1.15;
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1; g.fillStyle = 'rgba(207,235,228,.6)';
  g.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = pad.t + ph - (v / max) * ph;
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke();
    g.fillText(String(Math.round(v)), 4 * dpr, y + 3 * dpr);
  }
  if (!lista.length) {
    g.fillStyle = 'rgba(207,235,228,.7)'; g.textAlign = 'center'; g.font = `${12 * dpr}px Archivo, sans-serif`;
    g.fillText('As barras aparecem com as primeiras peças contadas.', W / 2, H / 2); g.textAlign = 'start';
    return;
  }
  const bw = pw / n;
  lista.forEach((m, i) => {
    const x = pad.l + (n - lista.length + i) * bw, h = (m.n / max) * ph;
    g.fillStyle = metaPorMin && m.n < metaPorMin ? '#F2A900' : '#8CE0C8';
    if (i === lista.length - 1) g.fillStyle = '#FFD84D';
    g.fillRect(x + bw * 0.12, pad.t + ph - h, bw * 0.76, h);
    if (lista.length <= 12 || i % Math.ceil(lista.length / 8) === 0 || i === lista.length - 1) {
      g.fillStyle = 'rgba(207,235,228,.65)';
      if (i === lista.length - 1) { g.textAlign = 'end'; g.fillText(m.rot, Math.min(W - 2 * dpr, x + bw), H - 6 * dpr); g.textAlign = 'start'; }
      else g.fillText(m.rot, x, H - 6 * dpr);
    }
  });
  if (metaPorMin > 0) {
    const y = pad.t + ph - (metaPorMin / max) * ph;
    g.setLineDash([5 * dpr, 4 * dpr]); g.strokeStyle = '#FFD84D'; g.lineWidth = 1.5 * dpr;
    g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.setLineDash([]);
  }
}

// ------------------------------------------------------------------ dataset

const quadros = [];       // { id, nome, blob, url, w, h, caixas: [[nomeClasse, cx, cy, w, h]] }
const ouvDS = new Set();
const avisarDS = () => { for (const f of ouvDS) { try { f(quadros.length); } catch (_) { /* segue */ } } };
export function assinarDataset(fn) { ouvDS.add(fn); return () => ouvDS.delete(fn); }
export function listaDataset() { return quadros; }
export function limparDataset() { for (const q of quadros) URL.revokeObjectURL(q.url); quadros.length = 0; avisarDS(); }
export function removerDoDataset(id) {
  const i = quadros.findIndex((q) => q.id === id);
  if (i >= 0) { URL.revokeObjectURL(quadros[i].url); quadros.splice(i, 1); avisarDS(); }
}
/** Nome da classe para o dataset: "cor:vermelho" → "vermelho". */
export const classeDataset = (n) => String(n || 'objeto').replace(/^cor:/, '').trim().slice(0, 40) || 'objeto';

let seqQ = 0;
/**
 * Captura o quadro como o pipeline o vê (recorte do zoom, espelho), até
 * 1280 px, com as caixas atuais (normalizadas e recortadas ao quadro).
 */
export async function capturarQuadro() {
  const el = vista.el;
  if (!el) throw new Error('Sem imagem: escolha a fonte primeiro.');
  const r = instantaneo();
  const sw = vista.sw, sh = vista.sh, w = Math.min(1280, Math.round(sw)), h = Math.round((w * sh) / sw);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (vista.fd) { g.translate(w, 0); g.scale(-1, 1); }
  g.drawImage(el, vista.sx, vista.sy, sw, sh, 0, 0, w, h);
  const blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('falha ao gerar o JPEG'))), 'image/jpeg', 0.92));
  const caixas = [];
  for (const d of (r && r.dets) || []) {
    const x1 = Math.max(0, d.x1), y1 = Math.max(0, d.y1), x2 = Math.min(1, d.x2), y2 = Math.min(1, d.y2);
    if (x2 - x1 < 0.003 || y2 - y1 < 0.003) continue;
    caixas.push([classeDataset(d.name), (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1]);
  }
  const q = { id: ++seqQ, nome: `contador_${carimbo()}_${seqQ}`, blob, url: URL.createObjectURL(blob), w, h, caixas };
  quadros.push(q);
  if (quadros.length > 300) { URL.revokeObjectURL(quadros[0].url); quadros.shift(); }
  avisarDS();
  return q;
}

/** Classes do dataset na ordem de aparição. */
export function classesDoDataset(lista = quadros) {
  const c = [];
  for (const q of lista) for (const b of q.caixas) if (!c.includes(b[0])) c.push(b[0]);
  return c;
}
/** Linhas YOLO de um quadro para a lista de classes dada. */
export function linhasYolo(q, classes) {
  return q.caixas.map((b) => `${classes.indexOf(b[0])} ${b[1].toFixed(6)} ${b[2].toFixed(6)} ${b[3].toFixed(6)} ${b[4].toFixed(6)}`).join('\n');
}
/** ZIP no formato YOLO (o mesmo que o Treinar importa): images/, labels/, data.yaml, classes.txt. */
export async function zipYolo(lista = quadros) {
  const classes = classesDoDataset(lista);
  const txt = (s) => new Blob([s], { type: 'text/plain' });
  const arq = [];
  for (const q of lista) {
    arq.push({ nome: `images/train/${q.nome}.jpg`, blob: q.blob });
    arq.push({ nome: `labels/train/${q.nome}.txt`, blob: txt(linhasYolo(q, classes) + (q.caixas.length ? '\n' : '')) });
  }
  arq.push({ nome: 'classes.txt', blob: txt(classes.join('\n') + '\n') });
  arq.push({ nome: 'data.yaml', blob: txt(`path: .\ntrain: images/train\nval: images/train\nnames:\n${classes.map((c, i) => `  ${i}: ${c}`).join('\n')}\n`) });
  return zipStore(arq);
}

// ------------------------------------------------------------------ Treinar (/api/treino)

const TOKEN = 'aivTreinoYT';    // a mesma sessão do painel Fonte › YouTube › Quadros para treinar
export function lerToken() { try { return sessionStorage.getItem(TOKEN) || ''; } catch (_) { return ''; } }
export function gravarToken(t) { try { if (t) sessionStorage.setItem(TOKEN, t); else sessionStorage.removeItem(TOKEN); } catch (_) { /* bloqueado */ } }

export async function apiTreino(caminho, token, opt = {}) {
  const headers = { ...(opt.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opt.body && !(opt.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/treino' + caminho, { ...opt, headers });
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { /* sem corpo */ }
  if (!r.ok) { const e = new Error((corpo && corpo.detail) || ('Erro ' + r.status)); e.status = r.status; throw e; }
  return corpo;
}

/**
 * Envia os quadros a um projeto DETECTOR do Treinar com os rótulos: acrescenta
 * as classes que faltam (o Treinar só aceita acrescentar), envia cada imagem e
 * grava as caixas YOLO no nome que o servidor devolveu.
 */
export async function enviarAoTreinar(proj, token, lista, aoProgresso) {
  const classes = classesDoDataset(lista);
  const faltam = classes.filter((c) => !proj.classes.includes(c));
  let doProjeto = proj.classes;
  if (faltam.length) {
    const p = await apiTreino(`/projetos/${encodeURIComponent(proj.id)}`, token, { method: 'PATCH', body: JSON.stringify({ classes: [...proj.classes, ...faltam] }) });
    doProjeto = (p && p.classes) || [...proj.classes, ...faltam];
  }
  let ok = 0, caixas = 0;
  const erros = [];
  for (let i = 0; i < lista.length; i++) {
    const q = lista[i];
    aoProgresso && aoProgresso(i + 1, lista.length);
    const fd = new FormData();
    fd.append('arquivos', new File([q.blob], q.nome + '.jpg', { type: 'image/jpeg' }));
    const r = await apiTreino(`/projetos/${encodeURIComponent(proj.id)}/imagens`, token, { method: 'POST', body: fd });
    if (r && r.erros && r.erros.length) erros.push(...r.erros);
    const nome = r && r.enviadas && r.enviadas[0];
    if (!nome) continue;
    ok++;
    const cx = q.caixas.map((b) => [doProjeto.indexOf(b[0]), b[1], b[2], b[3], b[4]]).filter((b) => b[0] >= 0);
    const s = await apiTreino(`/projetos/${encodeURIComponent(proj.id)}/imagens/${encodeURIComponent(nome)}/rotulos`, token, { method: 'PUT', body: JSON.stringify({ caixas: cx }) });
    caixas += (s && s.caixas) || 0;
  }
  return { ok, caixas, erros, novasClasses: faltam };
}
