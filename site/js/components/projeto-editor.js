/**
 * components/projeto-editor.js — o EDITOR DE ROTULAGEM do +Projeto: abre um
 * print em tela cheia para marcar caixas e polígonos com classe.
 *
 * Os gestos são os mesmos das Ferramentas de mouse (marcacoes-vista.js):
 * arrastar (ou clique-clique) faz a caixa; polígono ponto a ponto, fecha com
 * duplo clique, Enter ou clique no 1º ponto; Selecionar move a forma e as
 * alças dos cantos/vértices redimensionam; Delete apaga; Ctrl/⌘+Z desfaz.
 * Coordenadas em 0–1 da IMAGEM do print (presas a ela com zoom e pan).
 *
 *   1–9           classe ativa (e a da caixa selecionada)
 *   V / R / P / H selecionar · caixa · polígono · mover (pan)
 *   Ctrl/⌘+D      duplicar           Enter  aceita a sugestão selecionada
 *   [ ]           print anterior/próximo   0 / + / -  zoom
 *   Shift+F10, tecla Menu, clique direito, toque longo: menu de contexto
 *   (components/menu-contexto.js) para a caixa ou a área arrastada.
 *
 * "A máquina propõe, o humano confirma": a pré-rotulagem (YOLOX/RF-DETR
 * COCO, ou o modelo do próprio projeto depois do 1º treino) cria caixas
 * SUGERIDAS (tracejadas, com o nome e a confiança) que não vão para o
 * Treinar até alguém aceitar (✓/Enter), editar ou rejeitar (✕/Delete).
 *
 * Anomalia: o print é BOA ou RUIM; a área do defeito é opcional (só
 * documenta: o PatchCore treina com a imagem inteira).
 *
 * Cada mudança grava o print no aparelho (IndexedDB) em seguida; um print já
 * enviado vira "alterado" e o próximo "Salvar no dataset" reenvia.
 */

import { html, useState, useEffect, useRef, useCallback, ReactDOM } from '../vendor.js';
import { useStore } from '../state/store.js';
import {
  projStore, ativo, mudarPrint, setClasseAtiva, adicionarClasse, classePorNome, moverPrint, adicionarPrint, novoId,
} from '../projeto/base.js';
import { abrirMenu, menuAberto, mostrarBalao, dadosDe, injetarCssProjeto } from './menu-contexto.js';
import '../projeto/acoes.js';

const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const caixaDe = (pts) => {
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const [u, v] of pts) { x1 = Math.min(x1, u); y1 = Math.min(y1, v); x2 = Math.max(x2, u); y2 = Math.max(y2, v); }
  return { x1, y1, x2, y2 };
};

export function EditorPrint({ printId, lista, onClose }) {
  injetarCssProjeto();
  const st = useStore(projStore, (s) => ({ prints: s.prints, projetos: s.projetos, ativo: s.ativo }));
  const p = st.projetos.find((x) => x.id === st.ativo) || null;
  const ids = lista && lista.length ? lista : st.prints.map((x) => x.id);
  const [cur, setCur] = useState(printId);
  const pr = st.prints.find((x) => x.id === cur) || null;
  const idx = ids.indexOf(cur);

  const [caixas, setCaixasBruto] = useState(() => (pr ? pr.caixas : []));
  const [sel, setSel] = useState(null);
  const [ferr, setFerrBruto] = useState('retangulo');
  // a ferramenta vale JÁ para o próximo gesto (o handler do render anterior lê R.current)
  const setFerr = (f) => { R.current.ferr = f; setFerrBruto(f); };
  const [zoom, setZoom] = useState({ z: 1, cx: 0.5, cy: 0.5 });
  const [modelo, setModelo] = useState(() => (p && p.modelo ? 'proj' : 'yolox'));
  const [ocupado, setOcupado] = useState('');
  const [hist, setHist] = useState({ a: 0, d: 0 });
  const [aba, setAba] = useState('caixas');

  const cvRef = useRef(null);
  const wrapRef = useRef(null);
  const img = useRef(null);            // ImageBitmap/Image do print
  const R = useRef({ caixas, sel, ferr, zoom, rasc: null, gesto: null, hover: null, selArea: null, H: { antes: [], depois: [] } });
  R.current.caixas = caixas; R.current.sel = sel; R.current.ferr = ferr; R.current.zoom = zoom;

  // ---------------------------------------------------------- carregar o print
  useEffect(() => {
    if (!pr) return undefined;
    let vivo = true;
    setCaixasBruto(pr.caixas);
    setSel(null);
    R.current.H = { antes: [], depois: [] };
    setHist({ a: 0, d: 0 });
    R.current.rasc = null;
    setZoom({ z: 1, cx: 0.5, cy: 0.5 });
    img.current = null;
    (async () => {
      let b = null;
      try { b = await createImageBitmap(pr.blob); } catch (_) {
        const u = URL.createObjectURL(pr.blob); const im = new Image(); im.src = u; await im.decode(); URL.revokeObjectURL(u); b = im;
      }
      if (!vivo) return;
      img.current = b;
      pintar();
    })();
    return () => { vivo = false; };
  }, [cur]);

  // ---------------------------------------------------------- gravar (aparelho)
  const salvarT = useRef(0);
  const gravar = useCallback((cx) => {
    clearTimeout(salvarT.current);
    const id = cur;
    salvarT.current = setTimeout(() => mudarPrint(id, { caixas: cx }), 250);
  }, [cur]);
  useEffect(() => () => {
    clearTimeout(salvarT.current);
    const atual = projStore.get().prints.find((x) => x.id === cur);
    if (atual && atual.caixas !== R.current.caixas) mudarPrint(cur, { caixas: R.current.caixas });
  }, [cur]);

  /** Mudança com desfazer. */
  const mudar = useCallback((fn, novoSel) => {
    const antes = R.current.caixas;
    const depois = fn(antes);
    if (depois === antes) return;
    const H = R.current.H;
    H.antes.push(antes); if (H.antes.length > 100) H.antes.shift();
    H.depois.length = 0;
    setHist({ a: H.antes.length, d: 0 });
    R.current.caixas = depois;
    setCaixasBruto(depois);
    if (novoSel !== undefined) { R.current.sel = novoSel; setSel(novoSel); }
    gravar(depois);
  }, [gravar]);
  /** Edição contínua (arrastar alça): sem empilhar; o marco vem antes. */
  const marco = () => { const H = R.current.H; H.antes.push(R.current.caixas); H.depois.length = 0; setHist({ a: H.antes.length, d: 0 }); };
  const semHist = (fn) => { const d = fn(R.current.caixas); R.current.caixas = d; setCaixasBruto(d); gravar(d); };
  const desfazer = () => {
    const H = R.current.H; const a = H.antes.pop(); if (!a) return;
    H.depois.push(R.current.caixas); R.current.caixas = a; setCaixasBruto(a); setHist({ a: H.antes.length, d: H.depois.length }); gravar(a);
  };
  const refazer = () => {
    const H = R.current.H; const d = H.depois.pop(); if (!d) return;
    H.antes.push(R.current.caixas); R.current.caixas = d; setCaixasBruto(d); setHist({ a: H.antes.length, d: H.depois.length }); gravar(d);
  };

  const classeAtiva = p ? p.classe : 0;
  const cor = (c) => (c && c.sug ? '#e5e7eb' : (p && p.classes[c.cls] ? p.classes[c.cls].cor : '#FFD84D'));

  // ---------------------------------------------------------- geometria
  const geo = () => {
    const c = cvRef.current, im = img.current;
    if (!c || !im) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = c.width, ch = c.height;
    const W = im.width, H = im.height;
    const z = R.current.zoom;
    const s = Math.min(cw / W, ch / H) * 0.96 * z.z;
    return { dpr, cw, ch, W, H, s, ox: cw / 2 - z.cx * W * s, oy: ch / 2 - z.cy * H * s };
  };
  const paraTela = (g, u, v) => [g.ox + u * g.W * g.s, g.oy + v * g.H * g.s];
  const paraImg = (g, cx, cy) => {
    const r = cvRef.current.getBoundingClientRect();
    const x = (cx - r.left) * g.dpr, y = (cy - r.top) * g.dpr;
    return [(x - g.ox) / (g.W * g.s), (y - g.oy) / (g.H * g.s)];
  };

  // ---------------------------------------------------------- desenho
  const pintar = useCallback(() => {
    const c = cvRef.current;
    if (!c) return;
    const wr = wrapRef.current.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(10, Math.round(wr.width * dpr)), ch = Math.max(10, Math.round(wr.height * dpr));
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g2 = c.getContext('2d');
    g2.clearRect(0, 0, cw, ch);
    const g = geo();
    if (!g) return;
    g2.imageSmoothingQuality = 'high';
    g2.drawImage(img.current, g.ox, g.oy, g.W * g.s, g.H * g.s);
    const r = R.current;
    g2.lineJoin = 'round';
    for (const cx of r.caixas) {
      const pts = cx.pts.map(([u, v]) => paraTela(g, u, v));
      const k = cor(cx);
      const ativa = cx.id === r.sel, hov = cx.id === r.hover;
      g2.lineWidth = (ativa || hov ? 2.8 : 2) * dpr;
      g2.strokeStyle = k;
      g2.setLineDash(cx.sug ? [7 * dpr, 5 * dpr] : []);
      g2.beginPath();
      if (cx.tipo === 'poligono') { pts.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y))); g2.closePath(); }
      else { const [a, b] = pts; g2.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); }
      g2.globalAlpha = ativa ? 0.16 : 0.08; g2.fillStyle = k; g2.fill(); g2.globalAlpha = 1;
      g2.stroke();
      g2.setLineDash([]);
      const bb = caixaDe(cx.pts);
      const [lx, ly] = paraTela(g, bb.x1, bb.y1);
      const nome = p && p.tipo === 'anomalia' ? 'defeito' : (p && p.classes[cx.cls] ? p.classes[cx.cls].nome : `#${cx.cls}`);
      const txt = cx.sug ? `sugestão: ${cx.sug.nome} ${Math.round(cx.sug.score * 100)}% → ${nome}` : nome;
      g2.font = `600 ${11 * dpr}px ui-monospace, monospace`;
      const w = g2.measureText(txt).width + 10 * dpr, h = 17 * dpr;
      const ty = ly - h - 2 * dpr < 0 ? ly + 2 * dpr : ly - h - 2 * dpr;
      g2.fillStyle = 'rgba(2,48,44,.86)'; g2.fillRect(lx, ty, w, h);
      g2.fillStyle = k; g2.fillRect(lx, ty, 3 * dpr, h);
      g2.fillStyle = '#f5f5f4'; g2.fillText(txt, lx + 6 * dpr, ty + 12.5 * dpr);
      if (ativa) {
        const s = 4.5 * dpr;
        g2.fillStyle = '#fff'; g2.strokeStyle = '#02302C'; g2.lineWidth = 1.2 * dpr;
        for (const [x, y] of vertices(cx, pts)) { g2.fillRect(x - s, y - s, 2 * s, 2 * s); g2.strokeRect(x - s, y - s, 2 * s, 2 * s); }
      }
    }
    // rascunho
    if (r.rasc) {
      const pts = (r.rasc.cursor ? [...r.rasc.pts, r.rasc.cursor] : r.rasc.pts).map(([u, v]) => paraTela(g, u, v));
      g2.setLineDash([6 * dpr, 4 * dpr]); g2.lineWidth = 2 * dpr;
      g2.strokeStyle = p && p.classes[classeAtiva] ? p.classes[classeAtiva].cor : '#FFD84D';
      g2.beginPath();
      if (r.rasc.tipo === 'retangulo' && pts.length >= 2) { const [a, b] = pts; g2.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      else pts.forEach(([x, y], i) => (i ? g2.lineTo(x, y) : g2.moveTo(x, y)));
      g2.stroke(); g2.setLineDash([]);
      g2.fillStyle = g2.strokeStyle;
      for (const [x, y] of pts) { g2.beginPath(); g2.arc(x, y, 3.5 * dpr, 0, Math.PI * 2); g2.fill(); }
    }
    // seleção do clique direito
    if (r.selArea) {
      const [a, b] = r.selArea.map(([u, v]) => paraTela(g, u, v));
      g2.fillStyle = 'rgba(56,189,248,.12)'; g2.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      g2.setLineDash([5 * dpr, 4 * dpr]); g2.strokeStyle = '#38bdf8'; g2.lineWidth = 1.6 * dpr;
      g2.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); g2.setLineDash([]);
    }
  }, [p, classeAtiva]);

  useEffect(() => { pintar(); });
  useEffect(() => {
    const ro = new ResizeObserver(() => pintar());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [pintar]);

  function vertices(cx, pts) {
    if (cx.tipo === 'retangulo') { const [a, b] = pts; return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; }
    return pts;
  }

  // ---------------------------------------------------------- acerto
  const acharCaixa = (g, cX, cY) => {
    const r = cvRef.current.getBoundingClientRect();
    const x = (cX - r.left) * g.dpr, y = (cY - r.top) * g.dpr, tol = 8 * g.dpr;
    const l = R.current.caixas;
    for (let k = l.length - 1; k >= 0; k--) {
      const cx = l[k];
      const pts = cx.pts.map(([u, v]) => paraTela(g, u, v));
      if (cx.tipo === 'retangulo') {
        const [a, b] = pts;
        if (x >= Math.min(a[0], b[0]) - tol && x <= Math.max(a[0], b[0]) + tol && y >= Math.min(a[1], b[1]) - tol && y <= Math.max(a[1], b[1]) + tol) return cx;
      } else {
        let d = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i], [xj, yj] = pts[j];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
        }
        if (d) return cx;
      }
    }
    return null;
  };
  const acharVertice = (g, cx, cX, cY) => {
    const r = cvRef.current.getBoundingClientRect();
    const x = (cX - r.left) * g.dpr, y = (cY - r.top) * g.dpr;
    const v = vertices(cx, cx.pts.map(([u, w]) => paraTela(g, u, w)));
    for (let i = 0; i < v.length; i++) if (Math.hypot(x - v[i][0], y - v[i][1]) < 12 * g.dpr) return i;
    return -1;
  };
  const moverVertice = (cx, i, q) => {
    const pts = cx.pts.map((x) => x.slice());
    if (cx.tipo === 'retangulo') {
      if (i === 0) pts[0] = q; else if (i === 1) { pts[1][0] = q[0]; pts[0][1] = q[1]; } else if (i === 2) pts[1] = q; else { pts[0][0] = q[0]; pts[1][1] = q[1]; }
    } else pts[i] = q;
    return pts;
  };

  // ---------------------------------------------------------- criar
  const novaCaixa = (tipo, pts, cls = classeAtiva, extra = {}) => ({ id: novoId('cx'), cls, tipo, pts: pts.map(([u, v]) => [cl01(u), cl01(v)]), ...extra });
  const concluir = () => {
    const r = R.current.rasc;
    R.current.rasc = null;
    if (!r) return pintar();
    let pts = r.pts.slice();
    if (r.tipo === 'poligono') {
      while (pts.length > 3 && Math.hypot(pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]) < 0.004) pts.pop();
      if (pts.length < 3) return pintar();
    } else {
      const b = caixaDe(pts);
      if (b.x2 - b.x1 < 0.004 || b.y2 - b.y1 < 0.004) return pintar();
      pts = [[b.x1, b.y1], [b.x2, b.y2]];
    }
    const n = novaCaixa(r.tipo, pts);
    mudar((l) => [...l, n], n.id);
  };

  // ---------------------------------------------------------- menu de contexto
  const recorte = async (area) => {
    const im = img.current;
    if (!im) return null;
    const a = area || { x1: 0, y1: 0, x2: 1, y2: 1 };
    const sx = Math.round(a.x1 * im.width), sy = Math.round(a.y1 * im.height);
    const sw = Math.max(1, Math.round((a.x2 - a.x1) * im.width)), sh = Math.max(1, Math.round((a.y2 - a.y1) * im.height));
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, sw, sh);
    return c;
  };
  const limparSel = () => { R.current.selArea = null; pintar(); };

  const contexto = (area, item) => {
    const a = area || (item ? caixaDe(item.pts) : null);
    const ctx = {
      origem: 'editor', area: a,
      item: item ? { id: item.id, tipo: item.tipo, cls: item.cls, nome: p && p.classes[item.cls] ? p.classes[item.cls].nome : 'Caixa' } : null,
      recorte: () => recorte(a),
      retanguloTela: () => {
        const g = geo(); const r = cvRef.current.getBoundingClientRect();
        const aa = a || { x1: 0, y1: 0, x2: 1, y2: 1 };
        const [x1, y1] = paraTela(g, aa.x1, aa.y1), [x2, y2] = paraTela(g, aa.x2, aa.y2);
        return { x: r.left + x1 / g.dpr, y: r.top + y1 / g.dpr, w: (x2 - x1) / g.dpr, h: (y2 - y1) / g.dpr };
      },
      adicionarCaixas: (objs) => {
        const novas = objs.map((o) => novaCaixa('retangulo', [[o.x1, o.y1], [o.x2, o.y2]],
          o.cls != null ? o.cls : (classePorNome(o.nome) >= 0 ? classePorNome(o.nome) : classeAtiva),
          o.sugerida ? { sug: { nome: o.nome, score: o.score } } : {}));
        mudar((l) => [...l, ...novas]);
        limparSel();
      },
      salvarComoPrint: async ({ recorte: rec = true, pasta = null } = {}) => {
        const aa = rec && a ? a : { x1: 0, y1: 0, x2: 1, y2: 1 };
        const c = await recorte(aa);
        const b = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
        const aw = aa.x2 - aa.x1, ah = aa.y2 - aa.y1;
        const dentro = R.current.caixas.filter((x) => !x.sug).filter((x) => { const bb = caixaDe(x.pts); const mx = (bb.x1 + bb.x2) / 2, my = (bb.y1 + bb.y2) / 2; return mx >= aa.x1 && mx <= aa.x2 && my >= aa.y1 && my <= aa.y2; })
          .map((x) => ({ cls: x.cls, tipo: x.tipo, pts: x.pts.map(([u, v]) => [(u - aa.x1) / aw, (v - aa.y1) / ah]) }));
        limparSel();
        return adicionarPrint(b, { origem: 'recorte', pasta: pasta == null ? pr.pasta : pasta, caixas: dentro, grupo: pr.grupo });
      },
      moverParaPasta: (pasta) => moverPrint(pr.id, pasta),
      enviarAtual: async () => { clearTimeout(salvarT.current); return mudarPrint(pr.id, { caixas: R.current.caixas }); },
      usarComoRotulo: async (txt) => {
        let k = classePorNome(txt);
        if (k < 0) k = await adicionarClasse(txt);
        if (item) mudar((l) => l.map((x) => (x.id === item.id ? { ...x, cls: k, sug: undefined } : x)));
        else if (a) { const n = novaCaixa('retangulo', [[a.x1, a.y1], [a.x2, a.y2]], k); mudar((l) => [...l, n], n.id); }
        limparSel();
      },
    };
    if (p && p.tipo === 'detector') {
      if (a && !item) ctx.rotular = (cls) => { const n = novaCaixa('retangulo', [[a.x1, a.y1], [a.x2, a.y2]], cls); mudar((l) => [...l, n], n.id); setClasseAtiva(cls); limparSel(); };
      if (item) ctx.trocarClasse = (cls) => { mudar((l) => l.map((x) => (x.id === item.id ? { ...x, cls, sug: undefined } : x))); setClasseAtiva(cls); };
    }
    if (item) {
      ctx.apagar = () => mudar((l) => l.filter((x) => x.id !== item.id), null);
      ctx.duplicar = () => duplicar(item.id);
    }
    return ctx;
  };

  const duplicar = (id) => {
    const o = R.current.caixas.find((x) => x.id === id);
    if (!o) return;
    const n = { ...o, id: novoId('cx'), sug: undefined, pts: o.pts.map(([u, v]) => [cl01(u + 0.02), cl01(v + 0.02)]) };
    mudar((l) => [...l, n], n.id);
  };

  const menuEm = (cX, cY, area = null) => {
    const g = geo();
    if (!g) return;
    const item = area ? null : acharCaixa(g, cX, cY);
    if (item) { R.current.sel = item.id; setSel(item.id); }
    if (!abrirMenu(contexto(area, item), cX, cY)) limparSel();
  };

  // ---------------------------------------------------------- ponteiro
  const espaco = useRef(false);
  const longo = useRef({ t: 0, x: 0, y: 0 });
  const onDown = (e) => {
    const g = geo();
    if (!g) return;
    const q = paraImg(g, e.clientX, e.clientY);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue */ }
    const r = R.current;
    if (e.pointerType === 'touch') {
      clearTimeout(longo.current.t);
      longo.current = { x: e.clientX, y: e.clientY, t: setTimeout(() => { longo.current.t = 0; r.rasc = null; r.gesto = null; menuEm(longo.current.x, longo.current.y); }, 550) };
    }
    if (e.button === 2) { r.gesto = { modo: 'direito', q0: q, x0: e.clientX, y0: e.clientY }; return; }
    const ferr = r.ferr;
    if (e.button === 1 || ferr === 'mover' || espaco.current) { r.gesto = { modo: 'pan', x0: e.clientX, y0: e.clientY, z0: { ...r.zoom } }; return; }
    if (ferr === 'retangulo') {
      if (r.rasc && r.rasc.tipo === 'retangulo') { r.rasc.pts[1] = q; concluir(); return; }
      r.rasc = { tipo: 'retangulo', pts: [q, q] };
      r.gesto = { modo: 'criar', x0: e.clientX, y0: e.clientY };
    } else if (ferr === 'poligono') {
      if (!r.rasc) r.rasc = { tipo: 'poligono', pts: [q], cursor: q };
      else {
        const [fx, fy] = paraTela(g, r.rasc.pts[0][0], r.rasc.pts[0][1]);
        const rc = cvRef.current.getBoundingClientRect();
        if (r.rasc.pts.length >= 3 && Math.hypot((e.clientX - rc.left) * g.dpr - fx, (e.clientY - rc.top) * g.dpr - fy) < 10 * g.dpr) { concluir(); return; }
        r.rasc.pts.push(q);
      }
    } else {
      const s = r.sel && r.caixas.find((x) => x.id === r.sel);
      const iv = s ? acharVertice(g, s, e.clientX, e.clientY) : -1;
      if (iv >= 0) r.gesto = { modo: 'vertice', id: s.id, i: iv, marcado: false };
      else {
        const hit = acharCaixa(g, e.clientX, e.clientY);
        r.sel = hit ? hit.id : null; setSel(r.sel);
        r.gesto = hit ? { modo: 'mover', id: hit.id, q0: q, orig: hit.pts.map((x) => x.slice()), marcado: false }
          : { modo: 'pan', x0: e.clientX, y0: e.clientY, z0: { ...r.zoom } };
      }
    }
    pintar();
  };
  const onMove = (e) => {
    const g = geo();
    if (!g) return;
    if (longo.current.t && Math.hypot(e.clientX - longo.current.x, e.clientY - longo.current.y) > 10) { clearTimeout(longo.current.t); longo.current.t = 0; }
    const r = R.current, gs = r.gesto;
    const q = paraImg(g, e.clientX, e.clientY);
    if (gs && gs.modo === 'direito') {
      if (r.selArea || Math.hypot(e.clientX - gs.x0, e.clientY - gs.y0) > 6) { r.selArea = [gs.q0.map(cl01), q.map(cl01)]; pintar(); }
      return;
    }
    if (gs && gs.modo === 'pan') {
      const z = gs.z0;
      setZoom({ ...z, cx: z.cx - ((e.clientX - gs.x0) * g.dpr) / (g.W * g.s), cy: z.cy - ((e.clientY - gs.y0) * g.dpr) / (g.H * g.s) });
      return;
    }
    if (r.rasc) {
      if (r.rasc.tipo === 'retangulo') r.rasc.pts[1] = q.map(cl01); else r.rasc.cursor = q.map(cl01);
      pintar(); return;
    }
    if (gs && (gs.modo === 'vertice' || gs.modo === 'mover')) {
      if (!gs.marcado) { marco(); gs.marcado = true; }
      if (gs.modo === 'vertice') semHist((l) => l.map((x) => (x.id === gs.id ? { ...x, pts: moverVertice(x, gs.i, q.map(cl01)) } : x)));
      else {
        const du = q[0] - gs.q0[0], dv = q[1] - gs.q0[1];
        semHist((l) => l.map((x) => (x.id === gs.id ? { ...x, pts: gs.orig.map(([u, v]) => [cl01(u + du), cl01(v + dv)]) } : x)));
      }
      return;
    }
    if (r.ferr === 'selecionar') {
      const hit = acharCaixa(g, e.clientX, e.clientY);
      const id = hit ? hit.id : null;
      if (id !== r.hover) { r.hover = id; pintar(); }
    }
  };
  const onUp = (e) => {
    if (longo.current.t) { clearTimeout(longo.current.t); longo.current.t = 0; }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    const r = R.current, gs = r.gesto;
    r.gesto = null;
    if (gs && gs.modo === 'direito') {
      if (r.selArea) {
        const [a, b] = r.selArea;
        menuEm(e.clientX, e.clientY, { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) });
      } else menuEm(e.clientX, e.clientY);
      return;
    }
    if (gs && gs.modo === 'criar' && r.rasc && Math.hypot(e.clientX - gs.x0, e.clientY - gs.y0) > 6) concluir();
  };
  const onDbl = () => { if (R.current.rasc && R.current.rasc.tipo === 'poligono') concluir(); };
  const onWheel = (e) => {
    e.preventDefault();
    if (R.current.gestoSafari) return;          // pinça do Safari tratada em onGesto
    zoomPor(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  };
  /* Safari: a pinça do trackpad chega como gesturechange (escala acumulada), não como roda + Ctrl */
  const onGesto = (e) => {
    e.preventDefault();
    if (e.type === 'gesturestart') { R.current.gestoSafari = 1; return; }
    if (e.type === 'gestureend') { R.current.gestoSafari = null; return; }
    const f = e.scale / (R.current.gestoSafari || 1);
    R.current.gestoSafari = e.scale;
    if (Number.isFinite(f) && f > 0) zoomPor(f, e.clientX, e.clientY);
  };
  const zoomPor = (k, clientX, clientY) => {
    const g = geo();
    if (!g) return;
    const z = R.current.zoom;
    const nz = Math.max(1, Math.min(12, z.z * k));
    const [u, v] = paraImg(g, clientX, clientY);
    // o ponto sob o cursor fica parado
    const f = z.z / nz;
    setZoom({ z: nz, cx: u - (u - z.cx) * f, cy: v - (v - z.cy) * f });
  };
  useEffect(() => {
    const c = cvRef.current;
    if (!c) return undefined;
    const cm = (e) => e.preventDefault();
    c.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('contextmenu', cm);
    const gestos = typeof window.GestureEvent === 'function' ? ['gesturestart', 'gesturechange', 'gestureend'] : [];
    for (const g of gestos) c.addEventListener(g, onGesto);
    return () => {
      c.removeEventListener('wheel', onWheel); c.removeEventListener('contextmenu', cm);
      for (const g of gestos) c.removeEventListener(g, onGesto);
    };
  });

  // ---------------------------------------------------------- teclado
  const ir = (d) => { const j = idx + d; if (j >= 0 && j < ids.length) setCur(ids[j]); };
  const aceitar = (id) => mudar((l) => l.map((x) => (x.id === id ? { ...x, sug: undefined } : x)));
  const aceitarTodas = () => mudar((l) => (l.some((x) => x.sug) ? l.map((x) => (x.sug ? { ...x, sug: undefined } : x)) : l));
  const rejeitarTodas = () => mudar((l) => (l.some((x) => x.sug) ? l.filter((x) => !x.sug) : l), null);
  const trocarClasseSel = (k) => {
    setClasseAtiva(k);
    const s = R.current.sel;
    if (s) mudar((l) => l.map((x) => (x.id === s ? { ...x, cls: k, sug: undefined } : x)));
  };

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (menuAberto() && !(e.key === 'F10' && e.shiftKey)) return;
      const pega = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      const r = R.current;
      const k = e.key;
      if ((k === 'F10' && e.shiftKey) || k === 'ContextMenu') {
        pega();
        const s = r.sel && r.caixas.find((x) => x.id === r.sel);
        const g = geo();
        const rc = cvRef.current.getBoundingClientRect();
        let x = rc.left + rc.width / 2, y = rc.top + rc.height / 2;
        if (s && g) { const bb = caixaDe(s.pts); const [X, Y] = paraTela(g, bb.x1, bb.y1); x = rc.left + X / g.dpr; y = rc.top + Y / g.dpr; }
        abrirMenu(contexto(null, s || null), x, y);
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const kk = k.toLowerCase();
        if (kk === 'z' && !e.shiftKey) { pega(); desfazer(); }
        else if ((kk === 'z' && e.shiftKey) || kk === 'y') { pega(); refazer(); }
        else if (kk === 'd') { pega(); if (r.sel) duplicar(r.sel); }
        return;
      }
      if (e.altKey) return;
      if (/^[1-9]$/.test(k)) {
        pega();
        const i = +k - 1;
        if (p && p.tipo === 'anomalia') { if (i < 2) mudarPrint(pr.id, { grupo: i ? 'ruim' : 'boa' }); return; }
        if (p && p.classes[i]) trocarClasseSel(i);
        return;
      }
      const kl = k.toLowerCase();
      if (k === 'Escape') { pega(); if (r.rasc) { r.rasc = null; pintar(); } else if (r.selArea) limparSel(); else if (r.sel) { r.sel = null; setSel(null); } else onClose(); return; }
      if (k === 'Enter') {
        pega();
        if (r.rasc && r.rasc.tipo === 'poligono' && r.rasc.pts.length >= 3) { concluir(); return; }
        const s = r.sel && r.caixas.find((x) => x.id === r.sel);
        if (s && s.sug) aceitar(s.id);
        return;
      }
      if (k === 'Delete' || k === 'Backspace') {
        pega();
        if (r.rasc && r.rasc.tipo === 'poligono' && r.rasc.pts.length > 1) { r.rasc.pts.pop(); pintar(); return; }
        if (r.sel) mudar((l) => l.filter((x) => x.id !== r.sel), null);
        return;
      }
      if (k === ' ') { pega(); espaco.current = true; return; }
      if (kl === 'v') { pega(); setFerr('selecionar'); }
      else if (kl === 'r') { pega(); setFerr('retangulo'); }
      else if (kl === 'p') { pega(); setFerr('poligono'); }
      else if (kl === 'h') { pega(); setFerr('mover'); }
      else if (k === ']' || k === 'PageDown') { pega(); ir(1); }
      else if (k === '[' || k === 'PageUp') { pega(); ir(-1); }
      else if (k === '0') { pega(); setZoom({ z: 1, cx: 0.5, cy: 0.5 }); }
      else if (k === '+' || k === '=') { pega(); setZoom((z) => ({ ...z, z: Math.min(12, z.z * 1.25) })); }
      else if (k === '-') { pega(); setZoom((z) => ({ ...z, z: Math.max(1, z.z / 1.25) })); }
      else if (k.length === 1) pega();   // as letras não vazam para os atalhos do app por baixo
    };
    const solta = (e) => { if (e.key === ' ') espaco.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', solta, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', solta, true); };
  });

  useEffect(() => { R.current.rasc = null; pintar(); }, [ferr]);

  // ---------------------------------------------------------- pré-rotular
  const prerotular = async () => {
    if (!pr || !p) return;
    setOcupado('a máquina propõe…');
    try {
      const m = await import('../cv/runtime/livres-n/modelos.js');
      const c = await recorte(null);
      const mod = modelo === 'proj' && p.modelo ? 'livre:' + p.modelo : modelo;
      const r = await m.detectar(dadosDe(c), { modelo: mod, conf: 0.35 });
      const doProjeto = mod.startsWith('livre:');
      const novas = r.dets.slice(0, 60).map((d) => {
        const nome = r.rotulos[d[5]] || `#${d[5]}`;
        let k = doProjeto ? d[5] : classePorNome(nome);
        if (!(k >= 0 && k < p.classes.length)) k = classeAtiva;
        return novaCaixa('retangulo', [[d[0] / c.width, d[1] / c.height], [d[2] / c.width, d[3] / c.height]], k, { sug: { nome, score: d[4] } });
      });
      // não repete sugestão já existente no mesmo lugar
      const iou = (a, b) => { const A = caixaDe(a.pts), B = caixaDe(b.pts); const ix = Math.max(0, Math.min(A.x2, B.x2) - Math.max(A.x1, B.x1)), iy = Math.max(0, Math.min(A.y2, B.y2) - Math.max(A.y1, B.y1)); const i = ix * iy; return i / ((A.x2 - A.x1) * (A.y2 - A.y1) + (B.x2 - B.x1) * (B.y2 - B.y1) - i || 1); };
      const fil = novas.filter((n) => !R.current.caixas.some((x) => iou(x, n) > 0.6));
      mudar((l) => [...l, ...fil]);
      setOcupado(fil.length ? `${fil.length} ${fil.length === 1 ? 'sugestão' : 'sugestões'} — aceite (✓/Enter), edite ou rejeite (✕)` : 'nada novo encontrado (confiança ≥ 35%)');
    } catch (e) {
      setOcupado('⚠ ' + (e.message || 'falhou'));
    }
  };

  if (!pr || !p) return null;
  const nSug = caixas.filter((x) => x.sug).length;
  const anomalia = p.tipo === 'anomalia';
  const ESTADO = { local: 'só no aparelho', enviado: 'no Treinar · sem caixas', rotulado: 'no Treinar · rotulado', alterado: 'alterado · reenviar' };

  const ferrBtn = (id, rot, tecla) => html`
    <button class=${'btn tiny' + (ferr === id ? ' accent' : '')} aria-pressed=${ferr === id} title=${`${rot} (${tecla})`} onClick=${() => setFerr(id)}>${rot}</button>`;

  const conteudo = html`
    <div class="pje" role="dialog" aria-modal="true" aria-label="GPlanSiS|+Projeto — marcar print">
      <div class="pje-barra">
        <button class="btn tiny" onClick=${onClose} title="Voltar aos prints (Esc)">‹ Prints</button>
        <b class="pje-titulo"><span>GPlanSiS<i>|</i></span>+Projeto</b>
        <span class="pje-nome" title=${pr.nome}>${pr.pasta ? pr.pasta + ' / ' : ''}${pr.nome} · ${idx + 1}/${ids.length}</span>
        <button class="btn tiny" disabled=${idx <= 0} onClick=${() => ir(-1)} title="Print anterior ([)" aria-label="Print anterior">◀</button>
        <button class="btn tiny" disabled=${idx >= ids.length - 1} onClick=${() => ir(1)} title="Próximo print (])" aria-label="Próximo print">▶</button>
        <span class="pje-sep"></span>
        <div class="pje-grupo" role="group" aria-label="Ferramenta">
          ${ferrBtn('selecionar', 'Selecionar', 'V')}
          ${ferrBtn('retangulo', 'Caixa', 'R')}
          ${ferrBtn('poligono', 'Polígono', 'P')}
          ${ferrBtn('mover', 'Mover', 'H / espaço')}
        </div>
        <button class="btn tiny" disabled=${!hist.a} onClick=${desfazer} title="Desfazer (Ctrl/⌘+Z)" aria-label="Desfazer">${SETA_DESFAZER}</button>
        <button class="btn tiny" disabled=${!hist.d} onClick=${refazer} title="Refazer (Ctrl/⌘+Y)" aria-label="Refazer">${SETA_REFAZER}</button>
        <button class="btn tiny" onClick=${() => setZoom((z) => ({ ...z, z: Math.max(1, z.z / 1.25) }))} title="Afastar (-)" aria-label="Afastar">−</button>
        <span class="pje-zoom">${Math.round(zoom.z * 100)}%</span>
        <button class="btn tiny" onClick=${() => setZoom((z) => ({ ...z, z: Math.min(12, z.z * 1.25) }))} title="Aproximar (+)" aria-label="Aproximar">+</button>
        <button class="btn tiny" onClick=${() => setZoom({ z: 1, cx: 0.5, cy: 0.5 })} title="Ajustar (0)">Ajustar</button>
        <span class="pje-estado pj-e-${pr.estado}">${ESTADO[pr.estado] || pr.estado}</span>
        <button class="btn tiny pje-x" onClick=${onClose} aria-label="Fechar o editor">✕</button>
      </div>
      <div class="pje-corpo">
        <div class="pje-palco" ref=${wrapRef}>
          <canvas ref=${cvRef} class=${'pje-cv f-' + ferr}
                  onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}
                  onPointerLeave=${() => { if (R.current.hover) { R.current.hover = null; pintar(); } }}
                  onDoubleClick=${onDbl} aria-label="Imagem do print — desenhe as caixas aqui" tabindex="0"></canvas>
          ${ocupado && html`<div class="pje-ocupado" role="status">${ocupado}</div>`}
        </div>
        <aside class="pje-lado" aria-label="Classes e caixas">
          <div class="pje-abas" role="tablist">
            <button role="tab" aria-selected=${aba === 'caixas'} class=${aba === 'caixas' ? 'on' : ''} onClick=${() => setAba('caixas')}>${anomalia ? 'Peça' : `Caixas (${caixas.length})`}</button>
            ${!anomalia && html`<button role="tab" aria-selected=${aba === 'classes'} class=${aba === 'classes' ? 'on' : ''} onClick=${() => setAba('classes')}>Classes (${p.classes.length})</button>`}
          </div>
          ${anomalia && html`
            <div class="pje-sec">
              <p class="hint tight">Esta peça é…</p>
              <div class="row tight">
                <button class=${'btn' + (pr.grupo !== 'ruim' ? ' accent' : '')} aria-pressed=${pr.grupo !== 'ruim'} onClick=${() => mudarPrint(pr.id, { grupo: 'boa' })}>BOA (1)</button>
                <button class=${'btn' + (pr.grupo === 'ruim' ? ' danger accent' : '')} aria-pressed=${pr.grupo === 'ruim'} onClick=${() => mudarPrint(pr.id, { grupo: 'ruim' })}>RUIM (2)</button>
              </div>
              <p class="hint tight">A área do defeito é opcional (só documenta: o PatchCore aprende com fotos de peças boas).</p>
            </div>`}
          ${!anomalia && aba === 'classes' && html`
            <ul class="pje-classes">
              ${p.classes.map((c, i) => html`
                <li key=${i}><button class=${'pje-cls' + (i === classeAtiva ? ' on' : '')} aria-pressed=${i === classeAtiva} onClick=${() => trocarClasseSel(i)}>
                  <i style=${{ background: c.cor }}></i><span>${c.nome}</span>${i < 9 && html`<kbd>${i + 1}</kbd>`}</button></li>`)}
            </ul>
            <p class="hint tight">1–9 escolhe a classe (e troca a da caixa selecionada). Para criar, renomear ou mudar a cor: painel +Projeto › Projeto.</p>`}
          ${!anomalia && aba === 'caixas' && html`
            <div class="pje-sec">
              <label class="pje-lin">Classe ativa
                <select value=${classeAtiva} onChange=${(e) => trocarClasseSel(+e.target.value)}>
                  ${p.classes.map((c, i) => html`<option key=${i} value=${i}>${i < 9 ? i + 1 + ' · ' : ''}${c.nome}</option>`)}
                </select></label>
              <div class="pje-lin">
                <select value=${modelo} aria-label="Modelo da pré-rotulagem" onChange=${(e) => setModelo(e.target.value)}>
                  ${p.modelo && html`<option value="proj">Modelo do projeto</option>`}
                  <option value="yolox">YOLOX · COCO</option>
                  <option value="rfdetr-nano">RF-DETR nano · COCO</option>
                </select>
                <button class="btn tiny accent" onClick=${prerotular} title="A máquina propõe caixas; você confirma">Pré-rotular</button>
              </div>
              ${nSug > 0 && html`<div class="pje-lin"><span>${nSug} ${nSug === 1 ? 'sugestão' : 'sugestões'}</span>
                <button class="btn tiny accent" onClick=${aceitarTodas}>Aceitar todas</button>
                <button class="btn tiny" onClick=${rejeitarTodas}>Rejeitar todas</button></div>`}
            </div>`}
          ${(aba === 'caixas' || anomalia) && html`
            <ul class="pje-caixas">
              ${!caixas.length && html`<li class="pje-vazio">Nenhuma caixa. ${anomalia ? 'Desenhe a área do defeito, se quiser.' : 'Arraste sobre o objeto (R) ou pré-rotule.'}</li>`}
              ${caixas.map((x, i) => html`
                <li key=${x.id} class=${(x.id === sel ? 'on ' : '') + (x.sug ? 'sug' : '')} onClick=${() => { R.current.sel = x.id; setSel(x.id); }}>
                  <i style=${{ background: cor(x), borderColor: p.classes[x.cls] ? p.classes[x.cls].cor : '#999' }}></i>
                  ${anomalia ? html`<span>defeito ${i + 1}</span>` : html`
                  <select value=${x.cls} aria-label="Classe da caixa ${i + 1}" onClick=${(e) => e.stopPropagation()}
                          onChange=${(e) => { const k = +e.target.value; mudar((l) => l.map((y) => (y.id === x.id ? { ...y, cls: k, sug: undefined } : y))); }}>
                    ${p.classes.map((c, k) => html`<option key=${k} value=${k}>${c.nome}</option>`)}
                  </select>`}
                  <em>${x.tipo === 'poligono' ? 'polígono' : 'caixa'}${x.sug ? ` · ${x.sug.nome} ${Math.round(x.sug.score * 100)}%` : ''}</em>
                  ${x.sug && html`<button class="btn tiny accent" title="Aceitar (Enter)" aria-label="Aceitar a sugestão" onClick=${(e) => { e.stopPropagation(); aceitar(x.id); }}>✓</button>`}
                  <button class="btn tiny" title="Duplicar (Ctrl/⌘+D)" aria-label="Duplicar" onClick=${(e) => { e.stopPropagation(); duplicar(x.id); }}>⧉</button>
                  <button class="btn tiny" title=${x.sug ? 'Rejeitar' : 'Apagar (Delete)'} aria-label=${x.sug ? 'Rejeitar a sugestão' : 'Apagar a caixa'}
                          onClick=${(e) => { e.stopPropagation(); mudar((l) => l.filter((y) => y.id !== x.id), null); }}>✕</button>
                </li>`)}
            </ul>`}
          <p class="hint tight pje-dica">Clique direito (ou toque longo) sobre uma caixa ou arrastando uma área: rotular, ler texto, detectar, salvar recorte, mover de pasta, perguntar à Via…</p>
        </aside>
      </div>
      <${Tira} ids=${ids} cur=${cur} onIr=${setCur} />
    </div>`;
  return ReactDOM.createPortal(conteudo, document.body);
}

const seta = (d) => html`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${d} /></svg>`;
const SETA_DESFAZER = seta('M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3');
const SETA_REFAZER = seta('M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3');

/** Miniaturas da pasta, para navegar entre os prints. */
function Tira({ ids, cur, onIr }) {
  const prints = useStore(projStore, (s) => ({ prints: s.prints })).prints;
  const urls = useMiniaturas(prints);
  const ref = useRef(null);
  useEffect(() => { const el = ref.current && ref.current.querySelector('.on'); if (el) el.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [cur]);
  return html`
    <div class="pje-tira" ref=${ref} role="listbox" aria-label="Prints da pasta">
      ${ids.map((id, i) => { const x = prints.find((y) => y.id === id); if (!x) return null; return html`
        <button key=${id} role="option" aria-selected=${id === cur} class=${'pje-mini' + (id === cur ? ' on' : '')} onClick=${() => onIr(id)} title=${x.nome}>
          <img src=${urls.get(id)} alt=${`print ${i + 1}`} />
          <i class=${'pj-dot pj-e-' + x.estado}></i>${x.caixas.length ? html`<b>${x.caixas.filter((c) => !c.sug).length}</b>` : null}
        </button>`; })}
    </div>`;
}

// ------------------------------------------------------------- miniaturas (object URLs locais)

const cacheUrls = new Map();   // id → { blob, url }
/** Object URL de cada print (criado uma vez por Blob; revogado quando o print some). */
export function useMiniaturas(prints) {
  const vivos = new Set(prints.map((p) => p.id));
  for (const [id, o] of cacheUrls) if (!vivos.has(id)) { URL.revokeObjectURL(o.url); cacheUrls.delete(id); }
  const out = new Map();
  for (const p of prints) {
    let o = cacheUrls.get(p.id);
    if (!o || o.blob !== p.blob) { if (o) URL.revokeObjectURL(o.url); o = { blob: p.blob, url: URL.createObjectURL(p.blob) }; cacheUrls.set(p.id, o); }
    out.set(p.id, o.url);
  }
  return out;
}

export { mostrarBalao };
