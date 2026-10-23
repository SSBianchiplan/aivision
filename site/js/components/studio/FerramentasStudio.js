/**
 * components/studio/FerramentasStudio.js — o widget FERRAMENTAS (mouse) dentro dos Studios.
 *
 * ============================ COMO USAR (API) ============================
 *
 *   import { FerramentasStudio } from '../studio/FerramentasStudio.js';
 *
 *   // na barra do Studio, ao lado do <FonteStudio>:
 *   <${FerramentasStudio} classeBotao="oee-btn" alvo=${cvVid} />
 *
 *   Props:
 *     alvo           ref do <canvas> onde o Studio pinta o vídeo (obrigatório)
 *     transformacao  () => { ox, oy, dw, dh, dpr?, clip?, vista? } onde o QUADRO do pipeline está no
 *                    canvas (px do canvas). Sem ela: «contém, centrado» com a proporção do quadro
 *                    (a conta de quase todos os Studios). `vista` troca a geometria da fonte (editor
 *                    de vídeo: a mídia e o enquadramento dela); `clip` recorta (Bike Fit com zoom).
 *     copiaDisplay   o Studio copia o canvas de exibição do app (Bike Fit, Motion 3D): as marcações
 *                    deixam de ser pintadas lá enquanto as Ferramentas do Studio estão abertas (senão
 *                    apareceriam duas vezes, uma delas atrasada).
 *     classeBotao, semTexto   como no FonteStudio.
 *
 *   Esc: o FerramentasMouse consome o Esc que cancela/desseleciona — o Studio só fecha no Esc seguinte.
 * ========================================================================
 *
 * Como funciona: as marcações e as regiões dos operadores (cv/marcacoes.js, cv/regioes.js) vivem em
 * 0–1 da FONTE; o Viewport as converte pela `vista` (recorte do zoom, espelho, retângulo do vídeo
 * no canvas). Aqui a MESMA lógica (components/marcacoes-vista.js) roda com a vista do canvas do
 * Studio: os eventos do ponteiro do canvas e o desenho numa camada transparente por cima dele
 * passam por `comVista(T, …)`, que troca só o retângulo do vídeo (e o canvas) durante a chamada.
 * Desenhar, selecionar, arrastar alças, menu de contexto, teclado e desfazer: tudo igual ao vídeo
 * principal, sem duplicar código.
 *
 * Custo: nada com o botão desligado (nenhum ouvinte, nenhuma camada). Ligado: a camada é repintada
 * só quando as marcações, o quadro do app ou a geometria mudam; tamanho por ResizeObserver.
 */
import { html, useState, useEffect, useRef } from '../../vendor.js';
import { createStore, useStore, store } from '../../state/store.js';
import { vista, rt, marcStore, setFerramenta } from '../../cv/marcacoes.js';
import { pintarItens, ponteiroDown, ponteiroMove, ponteiroUp, duploClique, saiu } from '../marcacoes-vista.js';

/** Ferramentas abertas num Studio: o widget vertical sobe acima da tela cheia (css/ferramentas-studio.css). */
export const ferrStudio = createStore({ ativo: false });
/** Última geometria usada pela camada (testes de coordenada). */
export const ultimaGeometria = { T: null };

let cssPosto = false;
function injetarCss() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-fes]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/ferramentas-studio.css' + (v ? '?v=' + v : ''); l.dataset.aivFes = '1';
  document.head.appendChild(l);
}

const CAMPOS = ['ok', 'dx', 'dy', 'dw', 'dh', 'dpr', 'canvas', 'W', 'H', 'sx', 'sy', 'sw', 'sh', 'fs', 'fd'];
/** Roda `fn` com a vista do canvas do Studio (e devolve a do Viewport depois, mesmo com erro). */
export function comVista(T, fn) {
  const salvo = {};
  for (const k of CAMPOS) salvo[k] = vista[k];
  vista.dx = T.ox; vista.dy = T.oy; vista.dw = T.dw; vista.dh = T.dh; vista.dpr = T.dpr; vista.canvas = T.canvas;
  if (T.vista) Object.assign(vista, T.vista);
  vista.ok = true;
  try { return fn(); } finally { Object.assign(vista, salvo); }
}

/** Normaliza o que o Studio devolve ({ox,oy,dw,dh} | {ox,oy,k,w,h} | {ox,oy,k,W,H}) para px do canvas. */
function normalizar(t, cv, dprCss) {
  if (!t) return null;
  let dw = t.dw, dh = t.dh;
  if (!(dw > 0) && t.k > 0) { dw = (t.w || t.W) * t.k; dh = (t.h || t.H) * t.k; }
  if (!(dw > 0) || !(dh > 0)) return null;
  return { ox: t.ox || 0, oy: t.oy || 0, dw, dh, dpr: t.dpr || dprCss, clip: t.clip || null, vista: t.vista || null, canvas: cv };
}

/** «Contém, centrado» com a proporção do quadro do pipeline (recorte do zoom). */
function contem(cv, dprCss) {
  const W = cv.width, H = cv.height;
  const sw = vista.sw || 16, sh = vista.sh || 9;
  if (!W || !H) return null;
  const k = Math.min(W / sw, H / sh);
  return { ox: (W - sw * k) / 2, oy: (H - sh * k) / 2, dw: sw * k, dh: sh * k, dpr: dprCss, clip: null, vista: null, canvas: cv };
}

export function FerramentasStudio({ alvo, transformacao = null, copiaDisplay = false, classeBotao = '', semTexto = false }) {
  const [ativo, setAtivo] = useState(false);
  const ferr = useStore(marcStore, (st) => ({ f: st.ferramenta })).f;
  const camada = useRef(null);
  const transfRef = useRef(transformacao);
  transfRef.current = transformacao;

  useEffect(() => { injetarCss(); }, []);

  useEffect(() => {
    const cv = alvo && alvo.current;
    if (!ativo || !cv) return undefined;
    // o widget aparece (e sobe acima da tela cheia); as marcações carregam se o widget ainda não montou
    if (store.get().ferramentas === false) store.set({ ferramentas: true });
    ferrStudio.set({ ativo: true });
    document.body.classList.add('aiv-ferr-studio');
    if (copiaDisplay) rt.ocultarNoDisplay = true;

    // ---- camada transparente sobre o canvas do Studio (mesmo tamanho em px; sem eventos)
    const pai = cv.parentElement;
    if (pai && getComputedStyle(pai).position === 'static') pai.style.position = 'relative';
    const ov = document.createElement('canvas');
    ov.className = 'fes-camada';
    ov.setAttribute('aria-hidden', 'true');
    cv.insertAdjacentElement('afterend', ov);
    camada.current = ov;
    let cssW = cv.clientWidth || 1;
    let pedido = 0, chave = '';
    const posicionar = () => {
      cssW = cv.clientWidth || cssW;
      ov.style.left = cv.offsetLeft + 'px'; ov.style.top = cv.offsetTop + 'px';
      ov.style.width = cv.offsetWidth + 'px'; ov.style.height = cv.offsetHeight + 'px';
      agendar();
    };
    const ro = new ResizeObserver(posicionar);
    ro.observe(cv);
    if (pai) ro.observe(pai);
    posicionar();

    const transf = () => {
      const dprCss = cv.width / Math.max(1, cssW);
      const f = transfRef.current;
      let t = null;
      try { t = f ? normalizar(f(cv), cv, dprCss) : null; } catch (_) { t = null; }
      return t || contem(cv, dprCss);
    };

    // ---- desenho: só quando algo muda (marcações, quadro novo do app, tamanho, geometria)
    function pintar() {
      pedido = 0;
      const T = transf();
      if (ov.width !== cv.width || ov.height !== cv.height) { ov.width = cv.width; ov.height = cv.height; }
      const g = ov.getContext('2d');
      g.clearRect(0, 0, ov.width, ov.height);
      if (!T || !vista.ok) return;
      g.save();
      if (T.clip) { g.beginPath(); g.rect(T.clip.x, T.clip.y, T.clip.w, T.clip.h); g.clip(); }
      comVista(T, () => pintarItens(g));
      ultimaGeometria.T = T;   // gancho de teste (tools/testes/p2-studios.js): onde o quadro ficou
      g.restore();
    }
    function agendar() { if (!pedido) pedido = requestAnimationFrame(pintar); }
    const desMarc = marcStore.subscribe(agendar);
    const redesenharAntes = rt.redesenhar;
    rt.redesenhar = () => { redesenharAntes(); agendar(); };
    // quadro novo do app / geometria do Studio mudou (zoom do Bike Fit, layout do Motion 3D)
    let laco = 0;
    const vigiar = () => {
      laco = requestAnimationFrame(vigiar);
      const T = transf();
      const k = `${vista.canvas ? vista.canvas.quadros | 0 : 0}|${cv.width}x${cv.height}|${T ? `${T.ox | 0},${T.oy | 0},${T.dw | 0},${T.dh | 0}` : '-'}`;
      if (k !== chave) { chave = k; agendar(); }
    };
    laco = requestAnimationFrame(vigiar);

    // ---- ponteiro: a mesma interação do vídeo principal, na vista do Studio
    let consumido = false;
    const roda = (fn, e) => { const T = transf(); return T && vista.ok ? comVista(T, () => fn(e)) : false; };
    const pega = (e) => { e.stopImmediatePropagation(); e.preventDefault(); };
    const down = (e) => { consumido = Boolean(roda(ponteiroDown, e)); if (consumido) pega(e); agendar(); };
    const move = (e) => { if (roda(ponteiroMove, e)) { pega(e); agendar(); } };
    const up = (e) => { if (roda(ponteiroUp, e) || consumido) pega(e); agendar(); };
    const clique = (e) => { if (consumido) { pega(e); consumido = false; } };
    const duplo = (e) => { if (roda(duploClique, e)) pega(e); };
    const menu = (e) => { e.preventDefault(); };
    const fora = () => { roda(() => saiu(), null); agendar(); };
    const opc = { capture: true };
    cv.addEventListener('pointerdown', down, opc);
    cv.addEventListener('pointermove', move, opc);
    cv.addEventListener('pointerup', up, opc);
    cv.addEventListener('pointercancel', up, opc);
    cv.addEventListener('pointerleave', fora, opc);
    cv.addEventListener('click', clique, opc);
    cv.addEventListener('dblclick', duplo, opc);
    cv.addEventListener('contextmenu', menu, opc);
    const toqueAntes = cv.style.touchAction;
    cv.style.touchAction = 'none';

    return () => {
      cancelAnimationFrame(laco); if (pedido) cancelAnimationFrame(pedido);
      ro.disconnect(); desMarc();
      rt.redesenhar = redesenharAntes;
      cv.removeEventListener('pointerdown', down, opc);
      cv.removeEventListener('pointermove', move, opc);
      cv.removeEventListener('pointerup', up, opc);
      cv.removeEventListener('pointercancel', up, opc);
      cv.removeEventListener('pointerleave', fora, opc);
      cv.removeEventListener('click', clique, opc);
      cv.removeEventListener('dblclick', duplo, opc);
      cv.removeEventListener('contextmenu', menu, opc);
      cv.style.touchAction = toqueAntes; cv.style.cursor = '';
      ov.remove(); camada.current = null;
      if (copiaDisplay) rt.ocultarNoDisplay = false;
      document.body.classList.remove('aiv-ferr-studio');
      ferrStudio.set({ ativo: false });
      setFerramenta('mover');
      rt.redesenhar();
    };
  }, [ativo, alvo, copiaDisplay]);

  const rotulo = ferr && ferr !== 'mover' && ativo ? 'Ferramentas · ativa' : 'Ferramentas';
  return html`
    <button class=${`${classeBotao || 'fst-neutro'} fes-btn ${ativo ? 'on' : ''}`} aria-pressed=${ativo}
            title=${ativo ? 'Fechar as ferramentas de mouse no vídeo do Studio' : 'Ferramentas de mouse no vídeo do Studio: desenhar, medir, selecionar e ajustar regiões (inclusive as dos operadores)'}
            onClick=${() => setAtivo(!ativo)}>🛠${semTexto ? '' : html` <span class="fes-rot">${rotulo}</span>`}</button>`;
}
