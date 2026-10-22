/**
 * components/ferramentas-exibicao.js — AUXÍLIOS DE EXIBIÇÃO das ferramentas
 * de mouse: grade (terços ou N×N), lupa sob o cursor (Kinovea: magnifier),
 * mira com coordenadas em px e mm, réguas nas bordas e o círculo do pincel.
 *
 * Moram numa CAMADA PRÓPRIA (um canvas fixo sobre o vídeo, sem eventos de
 * ponteiro): não entram na captura PNG nem na gravação, que leem o canvas do
 * Viewport. Redesenhada a cada quadro pintado (marcacoes-vista.js) e a cada
 * movimento do ponteiro. Tudo vem de `vista` (geometria do último quadro).
 */

import { marcStore, rt, vista, clienteParaFonte, mmPorPx } from '../cv/marcacoes.js';

let cv = null;
let visivel = false;

function camada() {
  if (cv && cv.isConnected) return cv;
  cv = document.createElement('canvas');
  cv.className = 'ferr-aux';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  return cv;
}

function esconder() {
  if (cv && visivel) { cv.style.display = 'none'; visivel = false; }
}

/** Passo "redondo" (1, 2, 5 × 10ⁿ) para as marcas da régua. */
function passoBom(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/*
 * Movimento do ponteiro (30–120 eventos/s) e mudanças das marcações pedem o
 * redesenho, mas ele só acontece UMA vez por quadro de tela (rAF): antes cada
 * evento limpava e redesenhava a camada inteira (lupa, réguas, grade) e media
 * o canvas (getBoundingClientRect). O quadro novo do vídeo desenha na hora
 * (desenharAuxiliosJa, chamado pelo Viewport) e cancela o pedido pendente.
 */
let pedido = 0;
export function desenharAuxilios() {
  if (pedido) return;
  pedido = requestAnimationFrame(() => { pedido = 0; desenharAuxiliosJa(); });
}

export function desenharAuxiliosJa() {
  if (pedido) { cancelAnimationFrame(pedido); pedido = 0; }
  const st = marcStore.get();
  const ex = st.exib || {};
  const f = st.ferramenta;
  const pincel = (f === 'pincel' || f === 'borrachaMascara') && rt.cursor;
  const precisa = ex.grade || ex.reguas || ((ex.lupa || ex.mira) && rt.cursor) || pincel;
  if (!precisa || !vista.ok || !vista.canvas || !vista.canvas.isConnected) { esconder(); return; }
  const c = camada();
  const r = vista.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  // retângulo do vídeo em px CSS da janela
  const vx = r.left + vista.dx / vista.dpr, vy = r.top + vista.dy / vista.dpr;
  const vw = vista.dw / vista.dpr, vh = vista.dh / vista.dpr;
  const W = Math.round(r.width), H = Math.round(r.height);
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px', width: W + 'px', height: H + 'px', display: 'block' });
  visivel = true;
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, -r.left * dpr, -r.top * dpr);   // desenha em px CSS da janela
  g.clearRect(r.left, r.top, W, H);
  g.save();
  g.beginPath(); g.rect(vx, vy, vw, vh); g.clip();

  // ---- grade: terços ou N×N, sobre a parte visível do vídeo
  if (ex.grade) {
    const n = ex.grade === 1 ? 3 : Math.max(2, Math.min(24, ex.gradeN || 6));
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 2;
    g.beginPath();
    for (let i = 1; i < n; i++) {
      const x = Math.round(vx + (vw * i) / n) + 0.5, y = Math.round(vy + (vh * i) / n) + 0.5;
      g.moveTo(x, vy); g.lineTo(x, vy + vh); g.moveTo(vx, y); g.lineTo(vx + vw, y);
    }
    g.stroke();
    g.shadowBlur = 0;
    if (ex.grade === 1) {
      // pontos de força dos terços
      g.fillStyle = 'rgba(255,216,77,.9)';
      for (const i of [1, 2]) for (const j of [1, 2]) { g.beginPath(); g.arc(vx + (vw * i) / 3, vy + (vh * j) / 3, 3, 0, Math.PI * 2); g.fill(); }
    }
  }

  const cur = rt.cursor;
  const dentro = cur && cur.cx >= vx && cur.cx <= vx + vw && cur.cy >= vy && cur.cy <= vy + vh;
  const fonte = dentro ? clienteParaFonte(cur.cx, cur.cy) : null;
  const k = mmPorPx();

  // ---- réguas nas bordas (px ou mm da FONTE, acompanham o zoom)
  if (ex.reguas) {
    const T = 18;
    // a barra do topo flutua sobre o vídeo: a régua de cima fica logo abaixo dela (--rail-top)
    const rt0 = parseFloat(document.documentElement.style.getPropertyValue('--rail-top')) || 0;
    const ry = Math.max(vy, rt0 ? rt0 + 2 : vy);
    // e a da esquerda logo depois do widget de Ferramentas, quando ele está colado na borda
    const fe = document.querySelector('.ferr');
    const fr = fe && fe.getBoundingClientRect();
    const rx = fr && fr.width && fr.left < vx + 60 && fr.right > vx - 4 ? Math.max(vx, fr.right + 4) : vx;
    const pxFonteCss = vista.sw / vw;               // px da fonte por px CSS na horizontal
    const pyFonteCss = vista.sh / vh;
    const unid = k ? 'mm' : 'px';
    const porCss = k ? pxFonteCss * k : pxFonteCss;
    const passo = passoBom(porCss * 60);
    g.fillStyle = 'rgba(2,48,44,.78)';
    g.fillRect(rx, ry, vw - (rx - vx), T); g.fillRect(rx, ry, T, vh - (ry - vy));
    g.strokeStyle = 'rgba(207,235,228,.85)'; g.fillStyle = '#CFEBE4';
    g.font = '600 9.5px ui-monospace, monospace';
    g.lineWidth = 1;
    // horizontal: valor na fonte = (sx + x·pxFonteCss) [· k]; com espelho ao vivo a escala corre ao contrário
    const valX = (x) => { const lx = vista.fd ? vw - (x - vx) : x - vx; const ue = vista.sx + lx * pxFonteCss; const u = vista.fs ? vista.W - ue : ue; return k ? u * k : u; };
    const valY = (y) => { const v = vista.sy + (y - vy) * pyFonteCss; return k ? v * k : v; };
    g.beginPath();
    const sub = passo / 5;
    for (let x = rx + T; x < vx + vw; x += 1) {
      const a = valX(x), b = valX(x + 1);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const m = Math.ceil(lo / sub) * sub;
      if (m < hi) {
        const grande = Math.abs(m / passo - Math.round(m / passo)) < 1e-6;
        g.moveTo(x + 0.5, ry + T); g.lineTo(x + 0.5, ry + T - (grande ? 9 : 4));
        if (grande) g.fillText(String(Math.round(m)), x + 2.5, ry + 9);
      }
    }
    for (let y = ry + T; y < vy + vh; y += 1) {
      const a = valY(y), b = valY(y + 1);
      const m = Math.ceil(a / sub) * sub;
      if (m < b) {
        const grande = Math.abs(m / passo - Math.round(m / passo)) < 1e-6;
        g.moveTo(rx + T, y + 0.5); g.lineTo(rx + T - (grande ? 9 : 4), y + 0.5);
        if (grande) { g.save(); g.translate(rx + 9, y + 2.5); g.rotate(-Math.PI / 2); g.fillText(String(Math.round(m)), -String(Math.round(m)).length * 6, 0); g.restore(); }
      }
    }
    g.stroke();
    g.fillStyle = '#FFD84D';
    g.fillText(unid, rx + 2, ry + 13);
    if (dentro) {
      g.fillStyle = '#FFD84D';
      g.fillRect(cur.cx - 0.5, ry, 1, T); g.fillRect(rx, cur.cy - 0.5, T, 1);
    }
  }

  // ---- mira com coordenadas
  if (ex.mira && dentro) {
    g.strokeStyle = 'rgba(255,216,77,.85)';
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(vx, cur.cy + 0.5); g.lineTo(vx + vw, cur.cy + 0.5);
    g.moveTo(cur.cx + 0.5, vy); g.lineTo(cur.cx + 0.5, vy + vh);
    g.stroke(); g.setLineDash([]);
    const X = fonte[0] * vista.W, Y = fonte[1] * vista.H;
    const txt = `x ${X.toFixed(0)} · y ${Y.toFixed(0)} px` + (k ? `  (${(X * k).toFixed(1)} · ${(Y * k).toFixed(1)} mm)` : '');
    g.font = '600 11px ui-monospace, monospace';
    const tw = g.measureText(txt).width + 12;
    let lx = cur.cx + 12, ly = cur.cy + 14;
    if (lx + tw > vx + vw) lx = cur.cx - tw - 12;
    if (ly + 20 > vy + vh) ly = cur.cy - 32;
    g.fillStyle = 'rgba(2,48,44,.9)'; g.fillRect(lx, ly, tw, 18);
    g.fillStyle = '#FFD84D'; g.fillRect(lx, ly, 3, 18);
    g.fillStyle = '#f5f5f4'; g.fillText(txt, lx + 7, ly + 13);
  }
  g.restore();

  // ---- círculo do pincel
  if (pincel && dentro) {
    const raio = st.opc.raio || 14;
    g.lineWidth = 1.5;
    g.strokeStyle = f === 'pincel' ? 'rgba(255,216,77,.95)' : 'rgba(248,113,113,.95)';
    g.beginPath(); g.arc(cur.cx, cur.cy, raio, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.5)';
    g.beginPath(); g.arc(cur.cx, cur.cy, raio + 1.5, 0, Math.PI * 2); g.stroke();
  }

  // ---- lupa: pixels da FONTE ampliados, como aparecem no vídeo (espelho incluído)
  if (ex.lupa && dentro && vista.el) {
    const R = 74;
    const z = Math.max(1.5, Math.min(12, ex.lupaZoom || 3));
    const escala = vw / vista.sw;                    // px CSS por px da fonte, no vídeo
    const ladoFonte = (2 * R) / (escala * z);
    const ue = vista.fs ? 1 - fonte[0] : fonte[0];   // coordenada no ELEMENTO
    const sx = ue * vista.W - ladoFonte / 2, sy = fonte[1] * vista.H - ladoFonte / 2;
    let cx = cur.cx + R + 26, cy = cur.cy - R - 26;
    if (cx + R > window.innerWidth - 4) cx = cur.cx - R - 26;
    if (cy - R < 4) cy = cur.cy + R + 26;
    g.save();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.closePath();
    g.fillStyle = '#000'; g.fill();
    g.clip();
    g.imageSmoothingEnabled = z < 4;
    try {
      if (vista.fd) { g.translate(cx, 0); g.scale(-1, 1); g.translate(-cx, 0); }
      g.drawImage(vista.el, sx, sy, ladoFonte, ladoFonte, cx - R, cy - R, 2 * R, 2 * R);
    } catch (_) { /* fonte que não deixa ler */ }
    g.restore();
    g.lineWidth = 2; g.strokeStyle = '#FFD84D';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1; g.strokeStyle = 'rgba(255,216,77,.9)';
    g.beginPath(); g.moveTo(cx - 8, cy); g.lineTo(cx + 8, cy); g.moveTo(cx, cy - 8); g.lineTo(cx, cy + 8); g.stroke();
    g.font = '700 10px ui-monospace, monospace';
    g.fillStyle = 'rgba(2,48,44,.9)'; g.fillRect(cx - 16, cy + R - 18, 32, 14);
    g.fillStyle = '#FFD84D'; g.fillText(`${z}×`, cx - 9, cy + R - 7.5);
  }
}

// mudar uma opção de exibição redesenha na hora (com o vídeo pausado não chega quadro novo)
marcStore.subscribe && marcStore.subscribe(() => desenharAuxilios());
