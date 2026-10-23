/**
 * components/industrial/beltscan-comum.js — o que o painel BeltScan e a tela
 * cheia GPlanSiS|BeltScan compartilham: formatação, ações (pôr no Pipeline,
 * abrir ensaio, baixar arquivos) e os desenhos em canvas (câmera, perfil,
 * seção da correia, tendência, triangulação).
 *
 * Os desenhos seguem os do GPlanSiS|BELTSCAN (HTML): a imagem da câmera com a
 * linha laser detectada e a altura limite projetada; o perfil de altura na
 * bancada com o limite equivalente tracejado; a seção da calha (rolos,
 * acamamento DIN 22101, contorno teórico, excesso em vermelho, barra LI-101);
 * a tendência com os alarmes marcados no topo. O "palco" dos canvases é
 * escuro nos dois temas (como o vídeo do app — ver css/theme.css).
 */
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import {
  geometria, vDeZ, zDeV, desgirar, sombra, resumoGeometria, resumoCampo, din22101, calhaZ, pontaAsa, meiaPlana, miraDeg,
} from '../../cv/runtime/livres-k/beltscan.js';
import { abrirEnsaio, obterMotor, recente } from '../../cv/runtime/livres-k/canal.js';
import { pedirEdicao } from '../../cv/runtime/livres-k/beltscan-marcas.js';
import { numBR } from '../../cv/numfmt.js';
import { dprCanvas, TETO_STUDIO } from '../escala-canvas.js';

export const OP = 'beltscan.volumetria';
const fin = Number.isFinite;

/** Número em pt-BR com d casas, ou —. */
export const fmt = (v, d = 1) => (fin(v) ? numBR(v, d, d) : '—');

export const COR = {
  palco: '#02302C', grade: 'rgba(207,235,228,.10)', tinta: '#CFEBE4', tinta2: 'rgba(207,235,228,.62)',
  laser: '#FFE14D', acima: '#FF3B3B', ref: '#4F8BFF', limite: '#F2A900', prod: '#8A7556', prodLinha: '#FF8A3D',
  p1: '#FF4D4D', p2: '#F2A900', p3: '#D9C400', ok: '#8CE0C8', acento: '#FFD84D', correia: '#E9ECEF', aco: '#8C9196',
};
/*
 * Palco dos canvases: verde-petróleo no escuro e no claro (o vídeo do app);
 * no Code Dark, o cinza do editor do VS Code (css/theme.css). Trocado a cada
 * desenho em prepararCanvas — a chave de redesenho das telas já leva o tema.
 */
const PALCO_IAV = { palco: '#02302C', grade: 'rgba(207,235,228,.10)', tinta: '#CFEBE4', tinta2: 'rgba(207,235,228,.62)' };
const PALCO_CODE = { palco: '#1E1E1E', grade: 'rgba(204,204,204,.10)', tinta: '#CCCCCC', tinta2: 'rgba(204,204,204,.66)' };
const temaPalco = () => Object.assign(COR, document.documentElement.getAttribute('data-theme') === 'code' ? PALCO_CODE : PALCO_IAV);
export const COR_Q = { BOM: '#8CE0C8', INCERTO: '#F2A900', RUIM: '#FF4D4D', 'SEM REF': 'rgba(207,235,228,.62)' };
export const corPrio = (p) => (p === 1 ? COR.p1 : p === 2 ? COR.p2 : COR.p3);

/** Liga (ou adiciona) o nó BeltScan no Pipeline. Devolve true se criou. */
export function ativarBeltScan({ abrirPipeline = false } = {}) {
  const ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === OP);
  const novos = i >= 0
    ? ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
    : [...ns, { id: newNodeId(), op: OP, params: defaultParams(OP), enabled: true }];
  store.set(abrirPipeline ? { nodes: novos, panels: { ...store.get().panels, pipeline: true } } : { nodes: novos });
  persist();
  return i < 0;
}

/**
 * Abre um ensaio gravado (amostras/beltscan/) como arquivo na fonte do app,
 * com a configuração dele; liga o nó e tira o espelho (ROI e referência estão
 * nas colunas da câmera — espelhado também funciona, mas a imagem confunde).
 */
export async function abrirEnsaioNoApp(id, onPickFile) {
  ativarBeltScan();
  store.set({ mirror: false, running: true, zoom: { z: 1, cx: 0.5, cy: 0.5 } });
  persist();
  await abrirEnsaio(id, onPickFile);
}

/*
 * Tela cheia GPlanSiS|BeltScan (StudioBeltScan.js). `configurar` = nome da aba
 * de Configurar que a tela já abre (o pedido fica guardado aqui até a tela
 * montar — ela é carregada sob demanda).
 */
let pedidoConfigurar = null;
export function abrirStudioBeltScan({ configurar = null } = {}) {
  pedidoConfigurar = configurar || null;
  ativarBeltScan();
  store.set({ studioBeltScan: true });
}
/**
 * "Editar na imagem": a faixa de busca, as exclusões e a faixa de velocidade
 * viram marcações sobre o vídeo do app (ferramentas de mouse, Selecionar/
 * editar). Devolve a mensagem para a tela.
 */
export function editarNaImagem() {
  ativarBeltScan();
  if (store.get().studioBeltScan) store.set({ studioBeltScan: false });
  store.set({ ferramentas: true });
  if (!recente(5000)) return 'Abra um ensaio ou escolha a fonte primeiro: a faixa é desenhada sobre a imagem analisada.';
  pedirEdicao();
  return 'Arraste as alças; ao soltar, aplica. Enter ou ✓ conclui.';
}

/** A tela cheia, ao montar, pega (e consome) o pedido de abrir em Configurar. */
export function tomarPedidoConfigurar() { const a = pedidoConfigurar; pedidoConfigurar = null; return a; }

/*
 * Widget flutuante "Seção da correia" (WidgetSecaoCorreia.js): fechado, ele
 * fica fechado até o nó ser removido/readicionado; o painel BeltScan o reabre
 * por aqui (chave no aparelho + evento para o widget já montado).
 */
export const CHAVE_SECAO_FECHADO = 'aiv.beltscan.secao.fechado';
export const EVENTO_SECAO = 'aiv:beltscan-secao';
export function mostrarSecaoCorreia() {
  try { localStorage.removeItem(CHAVE_SECAO_FECHADO); } catch (_) { /* storage bloqueado */ }
  window.dispatchEvent(new CustomEvent(EVENTO_SECAO, { detail: { abrir: true } }));
}

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

/** Indicadores do retrato, já formatados (painel e tela cheia). */
export function indicadores(r, motor = obterMotor()) {
  const C = motor.C, b = (r && r.bench) || {};
  if (!r) return null;
  return {
    bancada: [
      ['AI-201', 'Seção medida', fmt(b.A_b, 0), 'mm²'],
      ['SI-201', `Velocidade ${C.bench.speed_src === 'flow' ? (b.ok ? '(fluxo óptico)' : '(fluxo sem textura)') : '(informada)'}`, fmt(b.v_b, 1), 'mm/s'],
      ['FI-201', 'Vazão volumétrica', fmt(b.Q_b, 1), 'cm³/s'],
      ['FQ-201', 'Volume no ciclo', fmt(b.vol_b, 0), 'cm³'],
      ['FQ-202', 'Volume do ciclo anterior', fmt(b.last_b, 0), 'cm³'],
      ['WI-201', 'Massa estimada no ciclo', fmt(b.mass_b, 0), 'g'],
    ],
    correia: [
      ['AI-101', 'Seção calculada', fmt(r.A, 4), 'm²'],
      ['LI-101', 'Enchimento da seção', fmt(r.fill, 1), '%'],
      ['FI-101', 'Vazão volumétrica', fmt(r.Q, 1), 'm³/h'],
      ['FI-104', 'Massa seca', fmt(r.mdry, 2), 't/h'],
      ['SI-101', 'Velocidade da correia', fmt(C.belt.speed_ms, 2), 'm/s'],
      ['HI-101', 'Nível representativo', fmt(r.lvlRep, 0), 'mm'],
      ['HI-101', 'Excesso sobre a altura limite', fmt(r.exRep, 0), 'mm'],
      ['HI-101', 'Largura acima do limite', fmt(r.exWidth, 1), '% calha'],
      ['HI-101', 'Altura máxima (camada)', fmt(r.hmax, 0), 'mm'],
      ['AI-102', 'Pico local', fmt(r.peak, 0), 'mm'],
      ['ZI-103', 'Centralização', fmt(r.center, 1), '% de B'],
      ['FQ-101', 'Volume acumulado', fmt(r.vol, 3), 'm³'],
      ['FQ-101', 'Massa seca acumulada', fmt(r.dry, 4), 't'],
      ['QI-105', 'Cobertura de colunas', fmt(r.cov * 100, 1), '%'],
    ],
  };
}

// ------------------------------------------------------------------ canvas

/** Ajusta o canvas ao tamanho exibido (× dpr) e devolve { g, w, h, dpr }. */
export function prepararCanvas(cv, alturaFixa = null) {
  const rect = cv.getBoundingClientRect();
  const dpr = dprCanvas(rect.width, alturaFixa || rect.height, TETO_STUDIO);
  const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round((alturaFixa || rect.height) * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  temaPalco();
  g.fillStyle = COR.palco; g.fillRect(0, 0, w, h);
  g.font = `${11 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = 'alphabetic';
  return { g, w, h, dpr };
}

function traco(g, pts, cor, larg, tracejado) {
  g.strokeStyle = cor; g.lineWidth = larg; g.setLineDash(tracejado || []);
  g.beginPath();
  let ini = true;
  for (const p of pts) { if (!p) { ini = true; continue; } if (ini) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]); ini = false; }
  g.stroke(); g.setLineDash([]);
}

/**
 * Imagem da câmera (o quadro analisado, desespelhado) com a faixa de busca,
 * exclusões, eixo óptico, referência vazia, altura limite projetada e a linha
 * laser (vermelha acima do limite). Devolve a transformação imagem→canvas
 * para o arraste. `fundo` = canvas com o quadro já pintado.
 */
export function desenharCamera(cv, fundo, r, motor, arrasto) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  if (!r || !fundo) {
    g.fillStyle = COR.tinta2; g.textAlign = 'center';
    g.fillText('Aguardando a imagem: abra um ensaio ou ligue a câmera na Fonte.', w / 2, h / 2);
    g.textAlign = 'left';
    return null;
  }
  const W = r.W, H = r.H, k = Math.min(w / W, h / H), ox = (w - W * k) / 2, oy = (h - H * k) / 2;
  g.save();
  if (r.espelhado) { g.translate(ox + W * k, oy); g.scale(-1, 1); g.drawImage(fundo, 0, 0, W * k, H * k); } else g.drawImage(fundo, ox, oy, W * k, H * k);
  g.restore();
  const X = (u) => ox + u * k, Y = (v) => oy + v * k;
  const C = motor.C, [x0, y0, x1, y1] = motor.roi;
  // exclusões
  g.fillStyle = 'rgba(2,48,44,.55)';
  for (const [a, b] of C.extraction.exclude) {
    g.fillRect(X(a), Y(0), (b - a) * k, H * k);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
    g.beginPath(); for (let yy = -H; yy < H; yy += 14) { g.moveTo(X(a), Y(yy + (b - a))); g.lineTo(X(b), Y(yy)); } g.stroke();
  }
  g.strokeStyle = '#7FB2FF'; g.lineWidth = 1.2 * dpr; g.setLineDash([6 * dpr, 4 * dpr]);
  g.strokeRect(X(x0), Y(y0), (x1 - x0) * k, (y1 - y0) * k); g.setLineDash([]);
  g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 1; g.beginPath(); g.moveTo(ox, Y(r.G.cv)); g.lineTo(ox + W * k, Y(r.G.cv)); g.stroke();
  const passo = Math.max(1, Math.round(1.5 / k));
  const serie = (arr, cond) => { const p = []; for (let u = x0; u < x1; u += passo) p.push(fin(arr[u]) && (!cond || cond(u)) ? [X(u), Y(arr[u])] : null); return p; };
  if (r.ref) traco(g, serie(r.ref), COR.ref, 1.4 * dpr);
  if (r.limV) traco(g, serie(r.limV), COR.limite, 2 * dpr, [7 * dpr, 4 * dpr]);
  const L = C.limit, acima = (u) => r.lvl && fin(r.lvl[u]) && r.lvl[u] > L.h_mm;
  traco(g, serie(r.rows, (u) => !acima(u)), COR.laser, 2 * dpr);
  traco(g, serie(r.rows, acima), COR.acima, 3 * dpr);
  if (arrasto && arrasto.a && arrasto.b) {
    g.strokeStyle = arrasto.modo === 'excl' ? '#FF8A3D' : COR.laser; g.lineWidth = 1.5 * dpr;
    g.strokeRect(X(arrasto.a[0]), Y(arrasto.a[1]), (arrasto.b[0] - arrasto.a[0]) * k, (arrasto.b[1] - arrasto.a[1]) * k);
  }
  // legenda
  g.font = `${10.5 * dpr}px "IBM Plex Mono", ui-monospace, monospace`;
  const leg = [['linha laser', COR.laser], ['acima do limite', COR.acima], ['referência vazia', COR.ref], ['altura limite', COR.limite]];
  let lx = 8 * dpr;
  for (const [t, c] of leg) {
    const tw = g.measureText(t).width;
    g.fillStyle = 'rgba(2,48,44,.72)'; g.fillRect(lx - 4 * dpr, 6 * dpr, tw + 22 * dpr, 17 * dpr);
    g.fillStyle = c; g.fillRect(lx, 13 * dpr, 10 * dpr, 3 * dpr);
    g.fillStyle = '#F5F5F4'; g.fillText(t, lx + 14 * dpr, 18 * dpr);
    lx += tw + 28 * dpr;
  }
  return { ox, oy, k, W, H, dpr };
}

/** Perfil de altura na bancada (mm), com a altura limite equivalente tracejada. */
export function desenharPerfil(cv, r, motor) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  if (!r || !r.h) {
    g.fillStyle = COR.tinta2; g.fillText(r && r.modo === 'ref' ? 'Capturando a referência vazia…' : 'Sem referência: deixe a área vazia e capture a referência.', 12 * dpr, h / 2);
    return;
  }
  const W = r.W, [x0, , x1] = motor.roi;
  let hm = 5;
  for (let u = x0; u < x1; u++) { if (fin(r.h[u])) hm = Math.max(hm, Math.abs(r.h[u]) * 1.2); if (fin(r.limH[u])) hm = Math.max(hm, r.limH[u] * 1.15); }
  const base = h - 22 * dpr, topo = 14 * dpr, sc = (base - topo) / hm, sx = w / W;
  g.strokeStyle = COR.grade; g.fillStyle = COR.tinta2; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const y = base - (k * (base - topo)) / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillText(fmt((hm * k) / 4, 1), 4 * dpr, y - 3 * dpr); }
  const lim = []; for (let u = 0; u < W; u += 2) lim.push(fin(r.limH[u]) ? [u * sx, base - r.limH[u] * sc] : null);
  traco(g, lim, COR.limite, 1.4 * dpr, [5 * dpr, 4 * dpr]);
  for (let u = x0; u < x1; u++) {
    if (!fin(r.h[u])) continue;
    g.fillStyle = fin(r.limH[u]) && r.h[u] > r.limH[u] ? COR.acima : COR.prodLinha;
    g.fillRect(u * sx, base - r.h[u] * sc - dpr, Math.max(dpr, sx), 2 * dpr);
  }
  g.fillStyle = COR.p1;
  for (let u = x0; u < x1; u++) if (!fin(r.h[u]) && !motor._excluido(u)) g.fillRect(u * sx, h - 6 * dpr, Math.max(1, sx), 4 * dpr);
  g.fillStyle = COR.tinta2; g.textAlign = 'right';
  g.fillText('mm na bancada · vermelho: acima do limite · faixa inferior: colunas sem linha', w - 6 * dpr, h - 9 * dpr);
  g.textAlign = 'left';
}

/** Seção da calha (DIN 22101) com o produto, a altura limite, H/HH, o excesso e a barra LI-101. */
export function desenharCorreia(cv, r, motor) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  const C = motor.C, B = C.belt, L = C.limit, din = din22101(B);
  const tip = pontaAsa(B), ez = calhaZ(B, tip);
  const topo = Math.max(ez + 260, (L.ref === 'z' ? L.h_mm : L.h_mm + ez) + 60);
  const s = Math.min((w - 90 * dpr) / (2 * tip + 80), (h - 44 * dpr) / topo);
  const ox = 14 * dpr + (tip + 40) * s, oz = h - 26 * dpr;
  const P = (x, z) => [ox + x * s, oz - z * s];
  const hs = (1.5 * din.A1 * din.k * 1e6) / (2 * tip);
  const teo = []; for (let i = 0; i <= 120; i++) { const x = -tip + (2 * tip * i) / 120; teo.push(P(x, ez + hs * (1 - (x / tip) ** 2))); }
  traco(g, teo, '#6B7178', 1 * dpr, [4 * dpr, 4 * dpr]);
  const limZ = (x) => (L.ref === 'z' ? L.h_mm : calhaZ(B, x) + L.h_mm);
  if (r && r.perfil && r.xb) {
    const pts = [];
    for (let u = 0; u < r.W; u++) { const x = r.xb[u]; if (fin(x) && Math.abs(x) <= tip) pts.push([x, Math.max(0, r.hb[u])]); }
    pts.sort((a, b) => a[0] - b[0]);
    if (pts.length > 3) {
      g.fillStyle = COR.prod; g.beginPath();
      pts.forEach(([x, hh], i) => { const p = P(x, calhaZ(B, x) + hh); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
      for (let i = pts.length - 1; i >= 0; i--) { const p = P(pts[i][0], calhaZ(B, pts[i][0])); g.lineTo(p[0], p[1]); }
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,59,59,.9)'; g.lineWidth = Math.max(1, s * Math.abs(pts[1][0] - pts[0][0]) + 0.5);
      for (const [x, hh] of pts) {
        if (hh <= L.min_thick_mm) continue;
        const zs = calhaZ(B, x) + hh, zl = limZ(x);
        if (zs > zl) { const a = P(x, zl), b = P(x, zs); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
      }
      traco(g, pts.map(([x, hh]) => P(x, calhaZ(B, x) + hh)), COR.prodLinha, 1.3 * dpr);
    }
  }
  const calha = []; for (let i = 0; i <= 200; i++) { const x = -tip + (2 * tip * i) / 200; calha.push(P(x, calhaZ(B, x))); }
  traco(g, calha, COR.correia, 2.5 * dpr);
  g.strokeStyle = COR.aco; g.lineWidth = 1 * dpr;
  // três rolos (central e laterais) desenhados como círculos sob a correia
  for (const sx of [-1, 0, 1]) { const p = P(sx * meiaPlana(B) * (sx ? 1 : 0), 0); g.beginPath(); g.arc(p[0], p[1] + 7 * dpr, 6 * dpr, 0, 7); g.stroke(); }
  const hiH = C.alarms.find((a) => a.tag === 'HI-101 H'), hiHH = C.alarms.find((a) => a.tag === 'HI-101 HH');
  const curva = (off, cor, dash, lw) => { const p = []; for (let i = 0; i <= 160; i++) { const x = -tip + (2 * tip * i) / 160; p.push(P(x, limZ(x) + off)); } traco(g, p, cor, lw, dash); };
  curva(0, COR.limite, [8 * dpr, 4 * dpr], 2 * dpr);
  if (hiH) curva(+hiH.thr, 'rgba(242,169,0,.55)', [2 * dpr, 4 * dpr], 1 * dpr);
  if (hiHH) curva(+hiHH.thr, 'rgba(255,77,77,.85)', [2 * dpr, 4 * dpr], 1 * dpr);
  const pl = P(-tip, limZ(-tip));
  g.fillStyle = COR.limite; g.fillText(`altura limite ${fmt(L.h_mm, 0)} mm ${L.ref === 'z' ? '(cota)' : '(camada)'}`, Math.max(4 * dpr, pl[0]), pl[1] - 6 * dpr);
  // barra LI-101
  const bx = w - 52 * dpr, by0 = 24 * dpr, by1 = h - 30 * dpr, f = r && fin(r.fill) ? r.fill : 0;
  const lv = (v) => by1 - (Math.min(v, 110) / 110) * (by1 - by0);
  const lhh = (C.alarms.find((a) => a.tag === 'LI-101 HH') || { thr: 95 }).thr, lh = (C.alarms.find((a) => a.tag === 'LI-101 H') || { thr: 85 }).thr;
  g.strokeStyle = COR.aco; g.strokeRect(bx, by0, 20 * dpr, by1 - by0);
  g.fillStyle = f > lhh ? COR.p1 : f > lh ? COR.p2 : '#B9BEC3'; g.fillRect(bx + 2 * dpr, lv(f), 16 * dpr, by1 - lv(f) - dpr);
  g.fillStyle = COR.acento;
  for (const [v, l] of [[lhh, 'HH'], [lh, 'H']]) { g.fillRect(bx - 4 * dpr, lv(v), 28 * dpr, dpr); g.fillText(l, bx + 26 * dpr, lv(v) + 4 * dpr); }
  g.fillStyle = '#F5F5F4'; g.fillText('LI-101', bx - 6 * dpr, 15 * dpr);
  g.fillText(fmt(f, 1) + ' %', bx - 10 * dpr, h - 12 * dpr);
  g.fillStyle = COR.tinta2;
  // canvas estreito (painel, widget flutuante): rodapé curto, para não passar por baixo da barra LI-101
  g.fillText(w / dpr < 480
    ? `A_th ${fmt(din.Ath, 3)} m² · Q_th ${fmt(din.Qth, 0)} m³/h`
    : `A_th DIN 22101 ${fmt(din.Ath, 3)} m² (k ${fmt(din.k, 3)}) · Q_th ${fmt(din.Qth, 0)} m³/h · escala 1:${fmt(r ? r.lam : NaN, 2)}`, 8 * dpr, h - 8 * dpr);
}

/** Tendência: nível representativo e máximo, limite/H/HH e a faixa de alarmes no topo. */
export function desenharTendencia(cv, motor, span, tCursor, ab = null) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  const C = motor.C, L = C.limit, pts = motor.tend;
  if (!pts.length) { g.fillStyle = COR.tinta2; g.fillText('Sem dados ainda.', 12 * dpr, h / 2); return; }
  const [t0, t1] = span;
  const hiH = C.alarms.find((a) => a.tag === 'HI-101 H'), hiHH = C.alarms.find((a) => a.tag === 'HI-101 HH');
  let ymax = L.h_mm + (hiHH ? +hiHH.thr : 0) * 1.4;
  for (const p of pts) if (fin(p.lrep)) ymax = Math.max(ymax, p.lrep * 1.15);
  const X = (t) => ((t - t0) / Math.max(1e-6, t1 - t0)) * w, Y = (v) => Math.max(14 * dpr, h - 18 * dpr - (v / ymax) * (h - 32 * dpr));
  const bw = Math.max(1.5 * dpr, w / Math.max(1, (t1 - t0) * 30));
  for (const p of pts) { if (!p.pr || p.t < t0) continue; g.fillStyle = corPrio(p.pr); g.fillRect(X(p.t), 2 * dpr, bw, 8 * dpr); }
  g.strokeStyle = COR.grade; g.fillStyle = COR.tinta2; g.lineWidth = 1;
  for (let k = 0; k <= 4; k++) { const v = (ymax * k) / 4, y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillText(fmt(v, 0), 4 * dpr, y - 2 * dpr); }
  const hl = (v, cor, d) => traco(g, [[0, Y(v)], [w, Y(v)]], cor, 1 * dpr, d);
  hl(L.h_mm, COR.limite, [8 * dpr, 4 * dpr]);
  if (hiH) hl(L.h_mm + +hiH.thr, 'rgba(242,169,0,.6)', [2 * dpr, 4 * dpr]);
  if (hiHH) hl(L.h_mm + +hiHH.thr, 'rgba(255,77,77,.9)', [2 * dpr, 4 * dpr]);
  const serie = (k) => pts.map((p) => (p.t >= t0 && fin(p[k]) ? [X(p.t), Y(p[k])] : null));
  traco(g, serie('lmax'), '#8E959C', 1 * dpr);
  traco(g, serie('lrep'), '#FFFFFF', 1.8 * dpr);
  // vazão da bancada (eixo à direita, ciano)
  let qmax = 1; for (const p of pts) if (fin(p.Qb)) qmax = Math.max(qmax, Math.abs(p.Qb) * 1.15);
  traco(g, pts.map((p) => (p.t >= t0 && fin(p.Qb) ? [X(p.t), h - 18 * dpr - (Math.max(0, p.Qb) / qmax) * (h - 32 * dpr)] : null)), 'rgba(34,211,238,.85)', 1.2 * dpr);
  if (ab && ab.A != null) { g.fillStyle = 'rgba(127,178,255,.14)'; g.fillRect(X(ab.A), 10 * dpr, X(ab.B ?? t1) - X(ab.A), h - 26 * dpr); }
  if (fin(tCursor)) { g.strokeStyle = '#7FB2FF'; g.lineWidth = 1 * dpr; g.beginPath(); g.moveTo(X(tCursor), 10 * dpr); g.lineTo(X(tCursor), h - 16 * dpr); g.stroke(); }
  g.fillStyle = '#FFFFFF'; g.fillText('nível rep.', 8 * dpr, h - 4 * dpr);
  g.fillStyle = '#8E959C'; g.fillText('máx.', 86 * dpr, h - 4 * dpr);
  g.fillStyle = COR.limite; g.fillText('limite · H · HH', 124 * dpr, h - 4 * dpr);
  g.fillStyle = 'rgba(34,211,238,.95)'; g.fillText(`vazão bancada (até ${fmt(qmax, 0)} cm³/s)`, 240 * dpr, h - 4 * dpr);
  g.fillStyle = COR.tinta2; g.textAlign = 'right'; g.fillText(`${fmt(t0, 1)} – ${fmt(t1, 1)} s`, w - 6 * dpr, h - 4 * dpr); g.textAlign = 'left';
}

/** Vista lateral da bancada: câmera, eixo óptico (α), campo de visão, plano do laser, raio e sombra. */
export function desenharTriangulacao(cv, r, motor) {
  const { g, w, h, dpr } = prepararCanvas(cv);
  const gg = motor.C.geo, G = r ? r.G : geometria(gg, 1280, 720);
  const b = +gg.b_mm, Hc = +gg.Hc_mm;
  const s = Math.min((w * 0.5) / (b * 1.9), (h - 46 * dpr) / (Hc * 1.2)), oy = 40 * dpr + b * 1.15 * s, oz = h - 26 * dpr;
  const P = (y, z) => [oy + y * s, oz - z * s];
  const L = (a, c, cor, lw, d) => traco(g, [a, c], cor, lw, d);
  L(P(-b * 1.3, 0), P(b * 0.5, 0), COR.aco, 3 * dpr);
  L(P(0, 0), P(0, Hc * 1.08), '#FF5A3C', 1.5 * dpr);
  const cam = P(-b, Hc), vf = Math.atan((G.H / 2) / G.fpx), a = (gg.alpha_deg * Math.PI) / 180;
  for (const k of [-1, 1]) { const th = a + k * vf, l = Hc * 1.35; L(cam, P(-b + l * Math.sin(th), Hc - l * Math.cos(th)), '#5D636A', 1 * dpr, [3 * dpr, 3 * dpr]); }
  const L0 = Hc / Math.max(Math.cos(a), 0.2);
  L(cam, P(-b + L0 * Math.sin(a), Hc - L0 * Math.cos(a)), '#E8C547', 1.2 * dpr);
  L(cam, P(0, 0), '#7D838A', 1 * dpr, [2 * dpr, 3 * dpr]);
  let hmax = 0; if (r && r.h) for (let u = 0; u < r.W; u++) if (fin(r.h[u]) && r.h[u] > hmax) hmax = r.h[u];
  if (hmax > 0) {
    L(cam, P(0, hmax), COR.laser, 1.4 * dpr);
    g.fillStyle = 'rgba(255,77,77,.35)'; const p1 = P(-sombra(G, hmax), hmax), p2 = P(0, 0); g.fillRect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1]);
  }
  g.fillStyle = '#E9ECEF'; g.fillRect(cam[0] - 8 * dpr, cam[1] - 6 * dpr, 16 * dpr, 12 * dpr);
  g.fillStyle = '#E8C547'; g.fillText(`α ${fmt(gg.alpha_deg, 1)}°  mira ${fmt(miraDeg(gg), 1)}°`, Math.max(4 * dpr, cam[0] - 30 * dpr), Math.max(14 * dpr, cam[1] - 12 * dpr));
  g.fillStyle = COR.tinta; g.fillText(`b ${fmt(b, 0)} mm`, (cam[0] + oy) / 2 - 24 * dpr, oz + 16 * dpr); g.fillText(`H_c ${fmt(Hc, 0)}`, Math.max(2 * dpr, cam[0] - 60 * dpr), (cam[1] + oz) / 2);
  const sm = resumoGeometria(G), fc = resumoCampo(), xr = w - 200 * dpr;
  const linhas = [['f_px', fmt(sm.fpx, 0)], ['θ na correia', fmt(sm.th, 1) + '°'], ['dz/dv', fmt(sm.dz, 2) + ' mm/px'], ['subpixel 1/10', fmt(sm.dzSub, 3) + ' mm'],
    ['faixa z', `${fmt(Math.max(sm.zmin, -9999), 0)} a ${fmt(sm.zmax, 0)}`], ['campo x', fmt(sm.campo, 0) + ' mm'],
    ['sombra', `${fmt(hmax, 0)} → ${fmt(sombra(G, hmax || 0), 0)} mm`], ['giro', `${fmt(gg.roll_deg, 2)}°  v ${gg.v_sign > 0 ? '+' : '−'}`]];
  linhas.forEach(([k, v], i) => { g.fillStyle = COR.tinta2; g.fillText(k, xr, (20 + i * 15) * dpr); g.fillStyle = '#E9ECEF'; g.fillText(v, xr + 98 * dpr, (20 + i * 15) * dpr); });
  g.fillStyle = '#A9C4A0'; g.fillText('campo (SPEC, α 25°)', xr, (20 + 9 * 15) * dpr);
  g.fillText(`dz/dv ${fmt(fc.dz, 2)} mm/px · mira ${fmt(fc.mira, 1)}°`, xr, (20 + 10 * 15) * dpr);
  if (!sm.noQuadro) { g.fillStyle = COR.p1; g.fillText('A linha da correia vazia fica fora do quadro: ajuste α.', 8 * dpr, h - 8 * dpr); }
  return { vDeZ, zDeV, desgirar };
}
