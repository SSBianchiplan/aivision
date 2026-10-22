/**
 * components/industrial/inspect-comum.js — o que o painel "Inspeção visual" e
 * a tela cheia GPlanSiS|Inspect compartilham: pôr o operador no Pipeline,
 * abrir a tela, a folha de estilo própria (injetada na primeira montagem, como
 * a do CounterVision), formatação, os desenhos em canvas (quadro ao vivo com o
 * gatilho e as ROIs; quadro inspecionado com o overlay de cada ferramenta) e
 * as marcações das ferramentas criadas a partir da tela (arrastar no quadro ao
 * vivo vira uma marcação "Inspect · …" das Ferramentas de mouse).
 *
 * O "palco" dos canvases é escuro nos dois temas, como o vídeo do app.
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { marcStore, confirmar, novoId, vistaParaFonte, COR_FUNC, setVisivel } from '../../cv/marcacoes.js';
import { FERRAMENTAS } from '../../cv/runtime/livres-n/ferramentas.js';
import { geometria, marcacoesAtuais } from '../../cv/runtime/livres-n/canal.js';
import { numBR } from '../../cv/numfmt.js';

export const OP = 'inspect.programa';
const fin = Number.isFinite;

/** Número em pt-BR (até d casas), ou —. */
export const fmt = (v, d = 3) => (fin(v) ? numBR(v, undefined, d) : v == null || v === '' ? '—' : String(v));
export const pct = (v, d = 1) => (fin(v) ? numBR(v * 100, d, d) + ' %' : '—');
export const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR'); } catch (_) { return ''; } };
export const dataHora = (iso) => { try { return new Date(iso).toLocaleString('pt-BR'); } catch (_) { return ''; } };

export const ROT = { PASS: 'OK', FAIL: 'NOK', UNCERTAIN: 'INCERTO', ERROR: 'ERRO' };
/** Cores no palco escuro (canvas). */
export const COR = { PASS: '#4ade80', FAIL: '#FF4D4D', UNCERTAIN: '#F2A900', ERROR: '#F2A900', OK: '#4ade80', NOK: '#FF4D4D', INCERTO: '#F2A900', palco: '#02302C' };
const COR_GAT = { vazio: '#7FB2FF', entrando: '#F2A900', inspecionada: '#4ade80' };

// ------------------------------------------------------------------ estilo

let cssPosto = false;
/** Injeta css/industrial-inspect.css uma vez (mesmo ?v= do app.css). */
export function injetarCSS() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-inspect]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/industrial-inspect.css' + (v ? '?v=' + v : ''); l.dataset.aivInspect = '1';
  document.head.appendChild(l);
}

// ------------------------------------------------------------------ Pipeline e telas

/** Liga (ou adiciona) o nó inspect.programa. Devolve true se criou. */
export function ativarInspect({ abrirPipeline = false } = {}) {
  const ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === OP);
  const novos = i >= 0
    ? ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
    : [...ns, { id: newNodeId(), op: OP, params: defaultParams(OP), enabled: true }];
  store.set(abrirPipeline ? { nodes: novos, panels: { ...store.get().panels, pipeline: true } } : { nodes: novos });
  persist();
  return i < 0;
}
export function abrirStudioInspect() { ativarInspect(); store.set({ studioInspect: true }); }

export function baixar(conteudo, nome, tipo) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
export function carimbo() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ------------------------------------------------------------------ canvas

/** Ajusta o canvas ao tamanho exibido (× dpr) e devolve { g, w, h, dpr }. */
export function prepararCanvas(cv) {
  postos = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  // palco: verde-petróleo no escuro e no claro, cinza do editor do VS Code no Code Dark (css/theme.css)
  COR.palco = document.documentElement.getAttribute('data-theme') === 'code' ? '#1E1E1E' : '#02302C';
  g.fillStyle = COR.palco; g.fillRect(0, 0, w, h);
  g.font = `${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'alphabetic';
  return { g, w, h, dpr };
}

/** Caixas de rótulo já postas neste desenho (para empilhar em vez de sobrepor). */
let postos = [];
function rotulo(g, txt, x, y, cor, dpr) {
  g.font = `600 ${10.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  const tw = g.measureText(txt).width + 8 * dpr, th = 15 * dpr;
  let yy = Math.max(th, y);
  for (let k = 0; k < 8 && postos.some((b) => x < b[0] + b[2] && x + tw > b[0] && yy - th < b[1] && yy > b[1] - th); k++) yy += th + 1;
  postos.push([x, yy, tw]);
  g.fillStyle = cor; g.fillRect(x, yy - th, tw, th);
  g.fillStyle = '#02302C'; g.fillText(txt, x + 4 * dpr, yy - 4 * dpr);
}

function aviso(g, w, h, txt) {
  g.fillStyle = 'rgba(207,235,228,.7)'; g.textAlign = 'center';
  g.fillText(txt, w / 2, h / 2);
  g.textAlign = 'left';
}

/** Ajuste "contain" de W×H no canvas: { k, ox, oy }. */
const caber = (w, h, W, H) => { const k = Math.min(w / W, h / H); return { k, ox: (w - W * k) / 2, oy: (h - H * k) / 2 }; };

/**
 * Quadro AO VIVO (o do pipeline, reduzido) com a ROI do gatilho (cor do
 * estado + ocupação) e as regiões das ferramentas do programa. Devolve a
 * transformação imagem→canvas (para o arraste que desenha uma ROI).
 */
export function desenharVivo(cv, fundo, vivo, gi, prog, arrasto, focoCode) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  if (!vivo || !fundo) { aviso(g, w, h, 'Aguardando a imagem: ligue o operador e escolha a fonte (câmera, arquivo, YouTube).'); return null; }
  const W = vivo.width, H = vivo.height, { k, ox, oy } = caber(w, h, W, H);
  g.drawImage(fundo, ox, oy, W * k, H * k);
  const X = (u) => ox + u * k, Y = (v) => oy + v * k;
  if (gi && gi.modo !== 'manual' && gi.roi) {
    const r = gi.roi, c = COR_GAT[gi.estado] || '#7FB2FF';
    g.strokeStyle = c; g.lineWidth = 2 * dpr; g.setLineDash([7 * dpr, 4 * dpr]);
    g.strokeRect(X(r.x), Y(r.y), r.w * k, r.h * k); g.setLineDash([]);
    // barra de ocupação com os limiares liga/desliga
    if (gi.modo === 'presenca' || gi.modo === 'linha') {
      const bw = Math.min(r.w * k, 160 * dpr), bx = X(r.x), by = Y(r.y + r.h) + 4 * dpr;
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(bx, by, bw, 6 * dpr);
      g.fillStyle = c; g.fillRect(bx, by, Math.min(1, gi.ocupacao * 4) * bw, 6 * dpr);
      if (prog) {
        g.fillStyle = '#fff';
        g.fillRect(bx + Math.min(1, prog.trigger.on_ratio * 4) * bw, by - 2 * dpr, 1.5 * dpr, 10 * dpr);
        g.fillStyle = 'rgba(255,255,255,.55)';
        g.fillRect(bx + Math.min(1, prog.trigger.off_ratio * 4) * bw, by - 2 * dpr, 1.5 * dpr, 10 * dpr);
      }
    }
    if (gi.modo === 'linha') { g.strokeStyle = c; g.beginPath(); g.moveTo(X(r.x + r.w / 2), Y(r.y)); g.lineTo(X(r.x + r.w / 2), Y(r.y + r.h)); g.stroke(); }
    rotulo(g, `gatilho · ${gi.estado} · ${Math.round(gi.ocupacao * 100)} %`, X(r.x), Y(r.y) - 2 * dpr, c, dpr);
  }
  if (prog) {
    const img = { width: W, height: H };
    for (const t of prog.tools) {
      if (!t.ativo || !FERRAMENTAS[t.type]) continue;
      let geo;
      try { geo = geometria(prog, t, img); } catch (_) { continue; }
      const foco = focoCode === t.code;
      g.strokeStyle = foco ? '#FFD84D' : '#2dd4bf'; g.lineWidth = (foco ? 2.4 : 1.4) * dpr;
      if (geo.p0) {
        g.beginPath(); g.moveTo(X(geo.p0[0]), Y(geo.p0[1])); g.lineTo(X(geo.p1[0]), Y(geo.p1[1])); g.stroke();
        rotulo(g, t.code, X(geo.p0[0]), Y(geo.p0[1]) - 3 * dpr, foco ? '#FFD84D' : '#2dd4bf', dpr);
      } else if (geo.rect) {
        g.strokeRect(X(geo.rect.x), Y(geo.rect.y), geo.rect.w * k, geo.rect.h * k);
        if (geo.roi && geo.roi !== geo.rect) { g.setLineDash([3 * dpr, 3 * dpr]); g.strokeRect(X(geo.roi.x), Y(geo.roi.y), geo.roi.w * k, geo.roi.h * k); g.setLineDash([]); }
        rotulo(g, t.code, X(geo.rect.x), Y(geo.rect.y) - 3 * dpr, foco ? '#FFD84D' : '#2dd4bf', dpr);
      }
    }
  }
  if (arrasto && arrasto.a && arrasto.b) {
    g.strokeStyle = '#FFD84D'; g.lineWidth = 2 * dpr;
    if (arrasto.linha) { g.beginPath(); g.moveTo(X(arrasto.a[0]), Y(arrasto.a[1])); g.lineTo(X(arrasto.b[0]), Y(arrasto.b[1])); g.stroke(); }
    else g.strokeRect(X(Math.min(arrasto.a[0], arrasto.b[0])), Y(Math.min(arrasto.a[1], arrasto.b[1])), Math.abs(arrasto.b[0] - arrasto.a[0]) * k, Math.abs(arrasto.b[1] - arrasto.a[1]) * k);
  }
  return { k, ox, oy, W, H, dpr };
}

// rampa do mapa de calor (a mesma do PatchCore do CV-24): ciano → verde → amarelo → laranja → vermelho
const RAMPA = [[34, 211, 238], [74, 222, 128], [255, 216, 77], [251, 146, 60], [239, 68, 68]];
/**
 * Canvas do mapa de calor de uma anomalia (uint8 0–255 na resolução do
 * modelo): transparente bem abaixo do limiar, opaco e vermelho acima. Fica
 * guardado no próprio overlay (não repinta a cada quadro).
 */
export function canvasCalor(o) {
  if (o._cv) return o._cv;
  const c = document.createElement('canvas');
  c.width = o.W; c.height = o.H;
  const g = c.getContext('2d');
  const im = g.createImageData(o.W, o.H);
  const lim = Math.max(1, (o.thr ?? 0.5) * 255);
  for (let i = 0; i < o.a.length; i++) {
    const t = o.a[i] / lim;                    // 1 = no limiar
    if (t < 0.35) continue;
    const u = Math.min(0.9999, (t - 0.35) / 0.75) * (RAMPA.length - 1), k = u | 0, f = u - k;
    const A = RAMPA[k], B = RAMPA[Math.min(RAMPA.length - 1, k + 1)];
    const q = i * 4;
    im.data[q] = A[0] + (B[0] - A[0]) * f; im.data[q + 1] = A[1] + (B[1] - A[1]) * f; im.data[q + 2] = A[2] + (B[2] - A[2]) * f;
    im.data[q + 3] = Math.round(255 * Math.min(0.62, 0.62 * (t - 0.35) / 0.4));
  }
  g.putImageData(im, 0, 0);
  Object.defineProperty(o, '_cv', { value: c, enumerable: false });
  return c;
}

/**
 * Quadro INSPECIONADO com o overlay de cada ferramenta na cor do status;
 * `foco` (código) destaca uma e esmaece as outras (como o InspectionView do Inspect).
 */
export function desenharInspecao(cv, fundo, rec, foco) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  if (!rec || !fundo) { aviso(g, w, h, rec ? 'Imagem desta peça não está mais em memória.' : 'Nenhuma peça inspecionada ainda.'); return; }
  const { k, ox, oy } = caber(w, h, rec.W, rec.H);
  g.drawImage(fundo, ox, oy, rec.W * k, rec.H * k);
  const X = (u) => ox + u * k, Y = (v) => oy + v * k;
  for (const r of rec.resultados) {
    const c = COR[r.status] || '#FFD84D';
    g.globalAlpha = foco && foco !== r.code ? 0.25 : 1;
    g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 1.8 * dpr;
    let rot = false;
    for (const o of r.overlays || []) {
      if (o.kind === 'heat' && o.a) {
        g.imageSmoothingEnabled = true;
        g.drawImage(canvasCalor(o), X(o.x), Y(o.y), o.w * k, o.h * k);
        continue;
      }
      if (o.kind === 'roi' || o.kind === 'box') {
        g.setLineDash(o.kind === 'roi' ? [6 * dpr, 4 * dpr] : []);
        g.strokeStyle = o.tone === 'bad' ? COR.FAIL : o.tone === 'info' ? '#7FB2FF' : c;
        g.strokeRect(X(o.x), Y(o.y), o.w * k, o.h * k);
        g.setLineDash([]);
        if (o.kind === 'roi' && !rot) { rotulo(g, `${r.code} ${ROT[r.status]}`, X(o.x), Y(o.y) - 2 * dpr, c, dpr); rot = true; }
        if (o.label && o.kind === 'box' && rec.resultados.length < 8) { g.font = `${9.5 * dpr}px "IBM Plex Mono", monospace`; g.fillStyle = c; g.fillText(o.label, X(o.x), Y(o.y) - 2 * dpr); }
      } else if (o.kind === 'line') {
        g.beginPath(); g.moveTo(X(o.p0[0]), Y(o.p0[1])); g.lineTo(X(o.p1[0]), Y(o.p1[1])); g.stroke();
        if (!rot) { rotulo(g, `${r.code} ${ROT[r.status]}`, X(o.p0[0]), Y(o.p0[1]) - 4 * dpr, c, dpr); rot = true; }
      } else if (o.kind === 'point') {
        g.beginPath(); g.arc(X(o.p[0]), Y(o.p[1]), 3.5 * dpr, 0, Math.PI * 2); g.fill();
      } else if (o.kind === 'poly' && o.pts && o.pts.length > 2) {
        g.beginPath(); o.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.closePath(); g.stroke();
        // texto lido (OCR) / formato do código, em cima da caixa
        if (o.label) {
          const x0 = Math.min(...o.pts.map((p) => p[0])), y1 = Math.max(...o.pts.map((p) => p[1]));
          g.font = `600 ${10.5 * dpr}px "IBM Plex Mono", monospace`;
          g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(String(o.label).slice(0, 40), X(x0), Y(y1) + 12 * dpr);
          g.fillStyle = c; g.fillText(String(o.label).slice(0, 40), X(x0), Y(y1) + 12 * dpr); g.lineWidth = 1.8 * dpr; g.strokeStyle = c;
        }
      } else if (o.kind === 'text') {
        g.font = `600 ${11 * dpr}px "IBM Plex Mono", monospace`;
        g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(o.text, X(o.p[0]), Y(o.p[1]) - 8 * dpr);
        g.fillStyle = c; g.fillText(o.text, X(o.p[0]), Y(o.p[1]) - 8 * dpr); g.lineWidth = 1.8 * dpr;
      }
    }
    if (!rot && (r.overlays || []).length === 0 && r.detail && (r.detail.error || r.detail.reason)) {
      rotulo(g, `${r.code} ${ROT[r.status]}: ${(r.detail.error || r.detail.reason).slice(0, 48)}`, 8 * dpr, h - 8 * dpr - 18 * dpr * rec.resultados.indexOf(r), c, dpr);
    }
  }
  g.globalAlpha = 1;
}

/** Pinta um ImageData-like num canvas de fundo reaproveitado. */
export function pintarFundo(ref, img) {
  if (!img) return null;
  if (!ref.current) ref.current = document.createElement('canvas');
  const f = ref.current;
  if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
  const d = img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height);
  f.getContext('2d').putImageData(d, 0, 0);
  return f;
}

// ------------------------------------------------------------------ marcações a partir da tela

/**
 * Cria (ou move) a marcação da ferramenta `t` a partir de um arraste no quadro
 * ao vivo: `a`, `b` em px do quadro W×H (o do pipeline, já com zoom/espelho).
 * A marcação nasce com a função "Inspect · …", o nome = código da ferramenta,
 * e fica ligada a ela (t.marcacao). Devolve o id.
 */
export function marcarFerramenta(t, a, b, W, H) {
  const def = FERRAMENTAS[t.type];
  const linha = def.roi === 'linha';
  const pa = vistaParaFonte(a[0] / W, a[1] / H), pb = vistaParaFonte(b[0] / W, b[1] / H);
  const st = marcStore.get();
  const existe = t.marcacao && st.itens.find((i) => i.id === t.marcacao);
  const id = existe ? existe.id : novoId();
  const item = {
    id, tipo: linha ? 'regua' : 'retangulo', funcao: def.funcao, nome: t.code, cor: COR_FUNC[def.funcao] || '#2dd4bf',
    pts: [pa, pb].map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]), visivel: true, classes: '',
  };
  confirmar((itens) => (existe ? itens.map((i) => (i.id === id ? { ...i, ...item } : i)) : [...itens, item]));
  if (!st.visivel) setVisivel(true);
  t.marcacao = id;
  return id;
}

/** ROI do gatilho desenhada: marcação "Inspect · gatilho" (uma só). */
export function marcarGatilho(prog, a, b, W, H) {
  const pa = vistaParaFonte(a[0] / W, a[1] / H), pb = vistaParaFonte(b[0] / W, b[1] / H);
  const st = marcStore.get();
  const existe = st.itens.find((i) => i.funcao === 'ins_gatilho' && (!prog.trigger.marcacao || i.id === prog.trigger.marcacao));
  const id = existe ? existe.id : novoId();
  const item = { id, tipo: 'retangulo', funcao: 'ins_gatilho', nome: 'Gatilho', cor: COR_FUNC.ins_gatilho || '#a78bfa', pts: [pa, pb].map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]), visivel: true, classes: '' };
  confirmar((itens) => (existe ? itens.map((i) => (i.id === id ? { ...i, ...item } : i)) : [...itens, item]));
  prog.trigger = { ...prog.trigger, marcacao: id };
  return id;
}

/** Nome da marcação que serve a ferramenta (para o editor), ou null. */
export function nomeDaMarcacao(prog, t) {
  const mq = marcacoesAtuais();
  if (!mq) return null;
  try {
    const g = geometria(prog, t, { width: 1000, height: 1000 });
    if (!g.marcacao) return null;
    const it = mq.itens.find((i) => i.id === g.marcacao);
    return it ? it.nome : null;
  } catch (_) { return null; }
}
