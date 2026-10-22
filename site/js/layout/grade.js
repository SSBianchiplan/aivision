/**
 * layout/grade.js — GRADE INVISÍVEL e ÍMÃ para arrastar e redimensionar.
 *
 * Um módulo só, usado por todo mundo que se move na tela: painéis soltos
 * (Panel.js), barra de vídeo (VideoControls.js), Ferramentas de mouse
 * (FerramentasMouse.js) e Seção da correia (WidgetSecaoCorreia.js).
 *
 *   grade   sem nada por perto, a posição anda em passos de PASSO px (e o
 *           tamanho, ao redimensionar, também)
 *   ímã     a até IMA px de um alvo, a borda gruda nele. Alvos: as bordas da
 *           tela (com FOLGA de margem), o centro da área livre do vídeo, a
 *           base da barra do topo e as bordas dos outros widgets e colunas —
 *           alinhar (borda com borda) ou encostar (lado a lado, a FOLGA px)
 *   guias   linhas finas que aparecem SÓ durante o arrasto, mostrando em que
 *           o widget grudou (como no Figma e no VS Code)
 *
 * Alt/⌥ durante o arrasto desliga tudo: posição e tamanho livres, pixel a pixel.
 *
 * Os obstáculos vêm de `ocupados()` (layout/organizador.js), lidos do DOM na
 * hora — nenhum widget precisa avisar os outros quando se mexe.
 */

import { ocupados, areaLivre } from './organizador.js';

export const PASSO = 8;      // grade invisível
export const IMA = 10;       // distância de atração
export const FOLGA = 8;      // margem da tela e distância ao encostar num vizinho

// ------------------------------------------------------------------ CSS

/** CSS próprio (guias, botão de recolher padrão), com a mesma versão (?v=) dos demais. */
function carregarCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-grade]')) return;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'css/grade.css' + (v ? '?' + v : '');
  l.setAttribute('data-grade', '');
  document.head.appendChild(l);
}
carregarCss();

// ------------------------------------------------------------------ guias

let camada = null;

function pintarGuias(lista) {
  if (!camada || !camada.isConnected) {
    camada = document.createElement('div');
    camada.className = 'grade-guias';
    camada.setAttribute('aria-hidden', 'true');
    document.body.appendChild(camada);
  }
  camada.textContent = '';
  for (const g of lista) {
    const d = document.createElement('i');
    d.className = 'grade-guia ' + g.eixo;
    if (g.eixo === 'x') { d.style.left = Math.round(g.v) + 'px'; d.style.top = Math.round(g.a) + 'px'; d.style.height = Math.max(1, Math.round(g.b - g.a)) + 'px'; }
    else { d.style.top = Math.round(g.v) + 'px'; d.style.left = Math.round(g.a) + 'px'; d.style.width = Math.max(1, Math.round(g.b - g.a)) + 'px'; }
    camada.appendChild(d);
  }
}

/** Some com as guias (fim do arrasto, Alt apertado). */
export function limparGuias() {
  if (camada) camada.textContent = '';
}

// ------------------------------------------------------------------ alvos

const cruza = (a0, a1, b0, b1, folga = 0) => a0 < b1 + folga && a1 + folga > b0;

/** Base da barra do topo (0 sem barra). */
function baseBarra() {
  const bar = document.querySelector('.menubar');
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  return r.height ? r.bottom : 0;
}

/**
 * Candidatos de um eixo para uma caixa de tamanho `t` (largura no x, altura
 * no y): cada um diz onde a caixa começa e onde a guia é desenhada.
 */
function candidatos(eixo, r, occ) {
  const W = window.innerWidth, H = window.innerHeight;
  const x = eixo === 'x';
  const t = x ? r.w : r.h;
  const L = x ? W : H;
  const out = [];
  const tela = (v, linha) => out.push({ v, linha, a: 0, b: x ? H : W });
  tela(FOLGA, FOLGA);
  tela(L - FOLGA - t, L - FOLGA);
  if (x) {
    // centro da área livre do vídeo (entre as colunas): onde a barra de vídeo mora
    const a = areaLivre();
    const x0 = a.x0 || 0, x1 = a.x1 && a.x1 < W ? a.x1 : W;
    const cx = (x0 + x1) / 2;
    out.push({ v: cx - t / 2, linha: cx, a: 0, b: H });
  } else {
    const base = baseBarra();
    if (base) out.push({ v: base + FOLGA, linha: base, a: 0, b: W });
    // acima da linha de atalhos (onde a barra de vídeo padrão fica: 28 px do rodapé, css/grade.css)
    const atalhos = document.querySelector('.hotkeys');
    if (atalhos && getComputedStyle(atalhos).display !== 'none') out.push({ v: H - 28 - t, linha: H - 28, a: 0, b: W });
  }
  for (const o of occ) {
    const o0 = x ? o.x0 : o.y0, o1 = x ? o.x1 : o.y1;
    // extensão da guia no outro eixo: do começo ao fim dos dois
    const p0 = x ? Math.min(r.y, o.y0) : Math.min(r.x, o.x0);
    const p1 = x ? Math.max(r.y + r.h, o.y1) : Math.max(r.x + r.w, o.x1);
    // alinhar: borda com borda (começo com começo, fim com fim, e as cruzadas)
    out.push({ v: o0, linha: o0, a: p0, b: p1 });
    out.push({ v: o1 - t, linha: o1, a: p0, b: p1 });
    out.push({ v: o1, linha: o1, a: p0, b: p1 });
    out.push({ v: o0 - t, linha: o0, a: p0, b: p1 });
    // encostar a FOLGA px — só faz sentido se os dois estão na mesma faixa do outro eixo
    const lado = x ? cruza(r.y, r.y + r.h, o.y0, o.y1, IMA) : cruza(r.x, r.x + r.w, o.x0, o.x1, IMA);
    if (lado) {
      out.push({ v: o1 + FOLGA, linha: o1 + FOLGA / 2, a: p0, b: p1 });
      out.push({ v: o0 - FOLGA - t, linha: o0 - FOLGA / 2, a: p0, b: p1 });
    }
  }
  return out;
}

/** O candidato mais perto dentro do ímã (ou null). */
function melhor(cands, v) {
  let m = null, d = IMA + 0.5;
  for (const c of cands) { const dd = Math.abs(c.v - v); if (dd < d) { d = dd; m = c; } }
  return m;
}

const naGrade = (v) => Math.round(v / PASSO) * PASSO;

// ------------------------------------------------------------------ API

/**
 * Encaixa uma caixa que está sendo ARRASTADA.
 * @param r     { x, y, w, h } proposto, em px da janela
 * @param opts  { excluir: elemento(s)/seletor que não são alvo (o próprio widget),
 *                livre: true com Alt/⌥ apertado }
 * @returns     { x, y } encaixado (quem chama ainda limita à janela)
 */
export function encaixarMover(r, { excluir = null, livre = false } = {}) {
  if (livre) { limparGuias(); return { x: Math.round(r.x), y: Math.round(r.y) }; }
  const occ = ocupados(excluir);
  const cx = melhor(candidatos('x', r, occ), r.x);
  const x = cx ? Math.round(cx.v) : naGrade(r.x);
  const r2 = { ...r, x };
  const cy = melhor(candidatos('y', r2, occ), r.y);
  const y = cy ? Math.round(cy.v) : naGrade(r.y);
  const guias = [];
  if (cx) guias.push({ eixo: 'x', v: cx.linha, a: Math.min(cx.a, y), b: Math.max(cx.b, y + r.h) });
  if (cy) guias.push({ eixo: 'y', v: cy.linha, a: Math.min(cy.a, x), b: Math.max(cy.b, x + r.w) });
  pintarGuias(guias);
  return { x, y };
}

/**
 * Encaixa o TAMANHO de uma caixa sendo redimensionada pelo canto inferior
 * direito: a borda direita e a de baixo grudam nos alvos; sem alvo, a
 * largura e a altura andam em passos da grade.
 * @param r  { x, y, w, h } com w/h propostos
 * @returns  { w, h }
 */
export function encaixarTamanho(r, { excluir = null, livre = false } = {}) {
  if (livre) { limparGuias(); return { w: Math.round(r.w), h: Math.round(r.h) }; }
  const W = window.innerWidth, H = window.innerHeight;
  const occ = ocupados(excluir);
  const guias = [];
  const borda = (eixo) => {
    const x = eixo === 'x';
    const fim = x ? r.x + r.w : r.y + r.h;
    const cands = [{ v: (x ? W : H) - FOLGA, a: 0, b: x ? H : W }];
    for (const o of occ) {
      const p0 = x ? Math.min(r.y, o.y0) : Math.min(r.x, o.x0);
      const p1 = x ? Math.max(r.y + r.h, o.y1) : Math.max(r.x + r.w, o.x1);
      const o0 = x ? o.x0 : o.y0, o1 = x ? o.x1 : o.y1;
      cands.push({ v: o0, a: p0, b: p1 }, { v: o1, a: p0, b: p1 });
      const lado = x ? cruza(r.y, r.y + r.h, o.y0, o.y1, IMA) : cruza(r.x, r.x + r.w, o.x0, o.x1, IMA);
      if (lado) cands.push({ v: o0 - FOLGA, a: p0, b: p1, linha: o0 - FOLGA / 2 });
    }
    let m = null, d = IMA + 0.5;
    for (const c of cands) { const dd = Math.abs(c.v - fim); if (dd < d) { d = dd; m = c; } }
    if (!m) return naGrade(x ? r.w : r.h);
    guias.push({ eixo, v: m.linha != null ? m.linha : m.v, a: m.a, b: m.b });
    return Math.round(m.v - (x ? r.x : r.y));
  };
  const w = borda('x');
  const h = borda('y');
  pintarGuias(guias);
  return { w, h };
}
