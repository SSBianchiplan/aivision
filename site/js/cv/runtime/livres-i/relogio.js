/**
 * cv/runtime/livres-i/relogio.js — o tempo do QUADRO, não o do relógio.
 *
 * Velocidade de barra e tempo de swing são medidas de tempo: com o relógio da
 * página (performance.now) elas saem erradas sempre que o vídeo não toca a
 * 1× (câmera lenta, o botão 0,25× do painel Swing, travadas do decodificador)
 * e o mesmo quadro desenhado duas vezes (vídeo a 30 fps numa tela a 60 Hz)
 * vira duas amostras com a barra parada entre elas.
 *
 * O executor não conhece a fonte, e o <video> das fontes do app nem fica no
 * documento (camera/device.js cria e só desenha no canvas). Por isso este
 * módulo embrulha HTMLMediaElement.play — só ANOTA quem tocou (referência
 * fraca) e chama o original, sem mudar o comportamento — e assina
 * requestVideoFrameCallback no vídeo maior que estiver tocando: cada quadro APRESENTADO traz
 * mediaTime (posição na linha do tempo do arquivo) e presentedFrames (contador).
 *   - arquivo: t = mediaTime (independe da velocidade de reprodução);
 *   - câmera/tela (srcObject): t = relógio da página no quadro apresentado;
 *   - sem <video> (imagem, teste headless): relógio da página.
 * `novo` diz se é um quadro que ainda não foi entregue a quem pergunta (cada
 * chamador tem a sua chave).
 */

let alvo = null;          // <video> assinado
const assinantes = new Set();   // funções chamadas a cada quadro apresentado (ver aoQuadro)
let meta = null;          // último { mediaTime, presentedFrames, agora }
let ativo = false;
const vistos = new Map(); // chave do chamador → último presentedFrames entregue

function assinar(v) {
  if (alvo === v && ativo) return;
  alvo = v; meta = null; ativo = false;
  if (!v || typeof v.requestVideoFrameCallback !== 'function') return;
  ativo = true;
  const cb = (agora, m) => {
    if (alvo !== v) return;
    meta = { mediaTime: m.mediaTime, presentedFrames: m.presentedFrames, agora };
    // quem precisa do PAR exato quadro↔tempo desenha o vídeo aqui mesmo: neste
    // callback o <video> mostra exatamente o quadro de `mediaTime`. No loop de
    // desenho (rAF) o quadro às vezes já é o seguinte e o tempo ainda o
    // anterior — um quadro de erro vira um degrau na velocidade da barra.
    if (assinantes.size) {
      const q = { video: v, t: v.srcObject ? agora : m.mediaTime * 1000, quadro: m.presentedFrames, arquivo: !v.srcObject };
      for (const f of assinantes) { try { f(q); } catch (e) { console.warn('[livres-i] quadro:', e && e.message); } }
    }
    try { v.requestVideoFrameCallback(cb); } catch (_) { ativo = false; }
  };
  try { v.requestVideoFrameCallback(cb); } catch (_) { ativo = false; }
}

const tocados = new Set();      // WeakRef de <video> que já chamaram play()
if (typeof HTMLMediaElement !== 'undefined' && typeof WeakRef !== 'undefined' && !HTMLMediaElement.prototype.__aivTocou) {
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    if (this instanceof HTMLVideoElement) {
      let ja = false;
      for (const r of tocados) { const v = r.deref(); if (!v) tocados.delete(r); else if (v === this) ja = true; }
      if (!ja) tocados.add(new WeakRef(this));
    }
    return play.apply(this, args);
  };
  HTMLMediaElement.prototype.__aivTocou = true;
}

function acharVideo() {
  if (typeof document === 'undefined') return null;
  let melhor = null, area = 0;
  const cands = new Set(document.querySelectorAll('video'));
  for (const r of tocados) { const v = r.deref(); if (v) cands.add(v); else tocados.delete(r); }
  for (const v of cands) {
    if (v.readyState < 2 || !v.videoWidth) continue;
    const a = v.videoWidth * v.videoHeight * (v.paused ? 0.5 : 1);
    if (a > area) { area = a; melhor = v; }
  }
  return melhor;
}

let ultimaBusca = 0;
/**
 * Tempo do quadro atual em ms. `chave` identifica o chamador (para `novo`).
 * Devolve { t, novo, fonte: 'arquivo' | 'ao vivo' | 'relógio', taxa }.
 */
export function tempoDoQuadro(chave = 'x') {
  const agora = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (agora - ultimaBusca > 1000 || (alvo && (alvo.paused || alvo.readyState < 2))) {
    ultimaBusca = agora;
    const v = acharVideo();
    if (v !== alvo) assinar(v);
  }
  if (!alvo || !ativo) return { t: agora, novo: true, fonte: 'relógio', taxa: 1 };
  // vídeo achado mas o primeiro quadro ainda não foi apresentado: não mistura
  // o relógio da página com o do vídeo — espera
  if (!meta) return { t: agora, novo: false, fonte: 'arquivo', taxa: 1 };
  const arquivo = !alvo.srcObject;
  const pf = meta.presentedFrames;
  const novo = vistos.get(chave) !== pf;
  vistos.set(chave, pf);
  return {
    t: arquivo ? meta.mediaTime * 1000 : meta.agora,
    novo,
    fonte: arquivo ? 'arquivo' : 'ao vivo',
    taxa: arquivo ? alvo.playbackRate || 1 : 1,
  };
}

/** O <video> da fonte (para o painel mudar a velocidade de reprodução). */
export function videoDaFonte() {
  const v = acharVideo();
  return v && !v.srcObject ? v : null;
}

/**
 * Assina os quadros do vídeo da fonte: fn({ video, t (ms), quadro, arquivo })
 * é chamada a cada quadro apresentado, com o <video> mostrando aquele quadro.
 * Devolve a função que cancela. Só funciona enquanto alguém chama
 * tempoDoQuadro (é ela que acha o vídeo) — o operador chama a cada apply.
 */
export function aoQuadro(fn) {
  assinantes.add(fn);
  return () => assinantes.delete(fn);
}

/** Há um vídeo com requestVideoFrameCallback entregando quadros? */
export function quadrosAtivos() {
  return Boolean(alvo && ativo && meta);
}

/**
 * Desenha o quadro do <video> do jeito que o pipeline o recebe: com o ZOOM
 * digital do app (recorte na fonte, ver Viewport.recorte — mesma conta) e o
 * espelho. Sem isso, com zoom > 1 as posições medidas no callback de quadro
 * não bateriam com o quadro (e o overlay) do pipeline.
 */
export function desenharComoPipeline(g, v, W, H, esp, zoom) {
  const vw = v.videoWidth, vh = v.videoHeight;
  const z = Math.max(1, Math.min(8, (zoom && zoom.z) || 1));
  const sw = vw / z, sh = vh / z;
  const cxv = zoom && Number.isFinite(zoom.cx) ? zoom.cx : 0.5;
  const cy = zoom && Number.isFinite(zoom.cy) ? zoom.cy : 0.5;
  const cx = esp ? 1 - cxv : cxv;
  const sx = Math.max(0, Math.min(vw - sw, cx * vw - sw / 2));
  const sy = Math.max(0, Math.min(vh - sh, cy * vh - sh / 2));
  g.setTransform(esp ? -1 : 1, 0, 0, 1, esp ? W : 0, 0);
  g.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { z, w: sw, h: sh };
}
