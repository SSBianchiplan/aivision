/**
 * cv/operators/livres-u/fisica.js — fisica.trajetoria (CV-80, D1 Laboratório de
 * física por vídeo).
 *
 * Segue UM objeto (o do sam2.seguir, a melhor detecção de uma classe ou uma
 * cor), converte px → metros pela régua calibrada das Ferramentas de mouse
 * (ctx.marcacoes.escala) e guarda (t, x, y) com y para CIMA. O tempo é o do
 * VÍDEO quando a fonte é um arquivo (preso ao quadro) — filme em câmera lenta
 * informa o fator. A análise (queda/lançamento, pêndulo, plano inclinado)
 * roda a cada publicação; tabela, gráfico e CSV no painel Aplicações.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-u/canal.js';
import { analisarQueda, analisarPendulo, analisarRampa, derivadasLocais } from '../../runtime/livres-u/fisica.js';
import { listaTexto } from '../../runtime/opkit.js';

const G = 'CV-80';
const HUES = { laranja: [10, 40], vermelho: [-15, 12], amarelo: [42, 70], verde: [80, 165], azul: [190, 250], rosa: [290, 340] };

/** Centroide (px) dos pixels da cor (HSV) — amostrado de 2 em 2 px. */
function centroCor(src, cor) {
  const [h0, h1] = HUES[cor] || HUES.laranja;
  const W = src.width, H = src.height, d = src.data;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const q = (y * W + x) * 4, r = d[q] / 255, g = d[q + 1] / 255, b = d[q + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    if (mx < 0.25 || c / mx < 0.4) continue;
    let hh = mx === r ? 60 * (((g - b) / c + 6) % 6) : mx === g ? 60 * ((b - r) / c + 2) : 60 * ((r - g) / c + 4);
    if (h0 < 0 && hh > 300) hh -= 360;
    if (hh >= h0 && hh <= h1) { sx += x; sy += y; n++; }
  }
  return n >= 6 ? { x: sx / n, y: sy / n, n } : null;
}

export const trajetoria = {
  op: 'fisica.trajetoria',
  label: 'Laboratório de física (trajetória)',
  group: G,
  overlayOnly: true,   // só desenha por cima: devolve o quadro sem alteração (vídeo nítido)
  desc: 'Segue um objeto (SAM 2, detector ou cor) e registra posição × tempo em metros pela régua calibrada: ' +
        'velocidade, aceleração, ajuste de parábola e g estimado (queda livre, lançamento), período do pêndulo ' +
        'e aceleração no plano inclinado. Tabela, gráfico e CSV no painel Aplicações.',
  params: {
    fonte: { type: 'enum', options: ['automático', 'seguir (SAM 2)', 'detecções', 'cor'], default: 'automático', label: 'Objeto de' },
    classes: { type: 'text', default: 'bola, sports ball, ball', max: 120, label: 'Classes do objeto (detecções)' },
    cor: { type: 'enum', options: Object.keys(HUES), default: 'laranja', label: 'Cor do objeto (fonte = cor)' },
    modo: { type: 'enum', options: ['queda / lançamento', 'pêndulo', 'plano inclinado'], default: 'queda / lançamento', label: 'Experimento' },
    comprimento: { type: 'float', min: 0, max: 20, step: 0.01, default: 0, label: 'Comprimento do pêndulo (m; 0 = sem g)' },
    mmPorPx: { type: 'float', min: 0, max: 100, step: 0.01, default: 0, label: 'Escala manual (mm/px; 0 = régua calibrada)' },
    lenta: { type: 'float', min: 1, max: 32, step: 1, default: 1, label: 'Câmera lenta (fator: 240 fps tocado a 30 = 8)' },
    gravar: { type: 'bool', default: true, label: 'Gravar amostras' },
    maxAmostras: { type: 'int', min: 20, max: 3000, step: 10, default: 600, label: 'Máximo de amostras' },
    rastro: { type: 'bool', default: true, label: 'Desenhar a trajetória' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    if (conferirGeracao('u_fisica', state) || !state.am) { state.am = []; state.tAnt = null; }
    const { t: tBruto, relogio } = tempoDe(ctx);
    const t = tBruto / Math.max(1, p.lenta);
    // salto para trás (voltou o vídeo): nova série
    if (state.tAnt != null && t < state.tAnt - 0.05) state.am = [];
    // posição (px)
    let pos = null;
    const auto = p.fonte === 'automático';
    if ((auto || p.fonte === 'seguir (SAM 2)') && ctx.track && Number.isFinite(ctx.track.x1)) {
      pos = { x: ((ctx.track.x1 + ctx.track.x2) / 2) * w, y: ((ctx.track.y1 + ctx.track.y2) / 2) * h };
    }
    if (!pos && (auto || p.fonte === 'detecções') && Array.isArray(ctx.detections)) {
      const cls = listaTexto(p.classes);
      const cand = ctx.detections.filter((d) => d && (!cls.length || cls.some((c) => String(d.name || '').toLowerCase().includes(c))));
      if (cand.length) {
        // a mais perto da última posição (ou a de maior score)
        const ult = state.am.length ? state.am[state.am.length - 1] : null;
        cand.sort((a, b) => (ult ? Math.hypot((a.x1 + a.x2) / 2 * w - ult.px, (a.y1 + a.y2) / 2 * h - ult.py) - Math.hypot((b.x1 + b.x2) / 2 * w - ult.px, (b.y1 + b.y2) / 2 * h - ult.py) : (b.score || 0) - (a.score || 0)));
        const d = cand[0];
        pos = { x: ((d.x1 + d.x2) / 2) * w, y: ((d.y1 + d.y2) / 2) * h };
      }
    }
    if (!pos && p.fonte === 'cor') pos = centroCor(src, p.cor);
    // escala
    const esc = ctx.marcacoes && ctx.marcacoes.escala ? ctx.marcacoes.escala.mmPorPxQuadro : null;
    const mm = p.mmPorPx > 0 ? p.mmPorPx : esc;
    const k = mm ? mm / 1000 : 1;      // m por px (ou px)
    const unidade = mm ? 'm' : 'px';
    const novo = state.tAnt == null || t > state.tAnt + 1e-4;
    if (pos && p.gravar && novo && !ctx.fonteParada) {
      state.am.push({ t, x: pos.x * k, y: (h - pos.y) * k, px: pos.x, py: pos.y });
      if (state.am.length > p.maxAmostras) state.am.shift();
    }
    if (novo) state.tAnt = t;
    // análise
    const am = state.am;
    let analise = null;
    if (am.length >= 5) {
      if (p.modo === 'pêndulo') analise = { tipo: 'pendulo', ...(analisarPendulo(am, mm ? p.comprimento : 0) || {}) };
      else if (p.modo === 'plano inclinado') analise = { tipo: 'rampa', ...(analisarRampa(am) || {}) };
      else analise = { tipo: 'queda', ...(analisarQueda(am) || {}) };
    }
    const ts = am.map((a) => a.t);
    const dx = am.length >= 7 ? derivadasLocais(ts, am.map((a) => a.x), 3) : null;
    const dy = am.length >= 7 ? derivadasLocais(ts, am.map((a) => a.y), 3) : null;
    publicar('u_fisica', {
      amostras: am.map((a, i) => ({ t: a.t, x: a.x, y: a.y, vx: dx ? dx.v[i] : NaN, vy: dy ? dy.v[i] : NaN, ax: dx ? dx.a[i] : NaN, ay: dy ? dy.a[i] : NaN })),
      unidade, analise, modo: p.modo, relogio, escalaOk: Boolean(mm), visto: Boolean(pos),
    });
    if (analise && analise.tipo === 'queda' && Number.isFinite(analise.g)) ctx.metrics['g estimado'] = `${analise.g.toFixed(2)} ${unidade}/s²`;
    if (analise && analise.tipo === 'pendulo' && Number.isFinite(analise.T)) ctx.metrics['período'] = `${analise.T.toFixed(3)} s`;
    ctx.metrics['amostras'] = am.length;
    if (!mm) ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Física: calibre uma régua (ou informe mm/px) para medir em metros', color: '#FFD84D' });
    if (p.rastro) {
      for (let i = Math.max(1, am.length - 400); i < am.length; i++) {
        ctx.overlay.push({ type: 'line', x1: am[i - 1].px, y1: am[i - 1].py, x2: am[i].px, y2: am[i].py, color: '#22d3ee', width: 2 });
      }
      for (let i = Math.max(0, am.length - 400); i < am.length; i += 3) ctx.overlay.push({ type: 'point', x: am[i].px, y: am[i].py, r: 2.5, color: '#FFD84D' });
    }
    if (pos) ctx.overlay.push({ type: 'rect', x: pos.x - 8, y: pos.y - 8, w: 16, h: 16, color: '#4ade80' });
    return clone(src);
  },
};

export default [trajetoria];
