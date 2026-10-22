/**
 * cv/operators/livres-r/cubagem.js — CV-50 Cubagem.
 *
 *   cubagem.esteira  (L1) caixas na esteira com laser de linha: a MESMA
 *                    extração subpixel e a mesma triangulação do BeltScan
 *                    (runtime/livres-k/beltscan.js: Extrator, zDeV, xDeUV)
 *                    dão a altura e a largura de cada quadro; a correia
 *                    vazia dos primeiros quadros é a referência. Caixa a
 *                    caixa: comprimento = velocidade × tempo sob o laser
 *                    ou, com a área "Cubagem · vista de cima" e a régua
 *                    calibrada, pela silhueta vista de cima. m³, peso
 *                    cubado (fator kg/m³) e o código lido (QR/barras) da
 *                    caixa. CSV no painel Medições.
 *   cubagem.foto     (63) cubagem estática por foto com régua: cada área
 *                    "Cubagem · face" (retângulo, polígono ou a MÁSCARA do
 *                    clique do SAM nas Ferramentas de mouse) vira o menor
 *                    retângulo girado em mm. Duas vistas: "Topo" dá
 *                    comprimento × largura e "Lateral" a altura — grave
 *                    cada uma no painel (as fotos podem ter réguas
 *                    diferentes).
 *
 * JS puro, sem modelo novo; nada sai do navegador.
 */
import { clone } from '../../core.js';
import { Extrator, PADRAO, geometria, clonar } from '../../runtime/livres-k/beltscan.js';
import { referenciaLaser, perfilCaixa, SeparadorCaixas, silhueta, retanguloDePontos } from '../../runtime/livres-r/medidas.js';
import { cinzaRoi } from '../../runtime/livres-r/imagem.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { marcas, roiDe, mmPorPxQuadro, tomarComandos, fmtN } from './comum.js';

export const G_CUB = 'CV-50';

export const esteira = {
  op: 'cubagem.esteira',
  label: 'Cubagem de caixas na esteira (laser)',
  group: G_CUB, overlayOnly: true,
  desc: 'Altura × largura × comprimento de cada caixa que passa sob o laser de linha (triangulação do BeltScan), com m³, ' +
        'peso cubado e o código lido. Área "Cubagem · faixa do laser" onde a linha aparece; deixe a esteira VAZIA nos ' +
        'primeiros quadros (referência). Comprimento pela velocidade da esteira ou pela vista de cima (área "Cubagem · ' +
        'vista de cima" + régua calibrada).',
  params: {
    Hc_mm: { type: 'float', min: 50, max: 10000, step: 10, default: 1200, label: 'Altura da câmera sobre a esteira (mm)' },
    b_mm: { type: 'float', min: 10, max: 5000, step: 5, default: 600, label: 'Distância câmera–laser (base, mm)' },
    alpha_deg: { type: 'float', min: 1, max: 89, step: 0.1, default: 26.6, label: 'Ângulo da câmera α (graus)' },
    hfov_deg: { type: 'float', min: 10, max: 150, step: 1, default: 60, label: 'Campo de visão horizontal (graus)' },
    sentidoV: { type: 'enum', options: ['−1', '+1'], default: '−1', label: 'Sentido de v (BeltScan v_sign)' },
    laser: { type: 'enum', options: ['vermelho', 'claro (mono)'], default: 'vermelho', label: 'Linha laser' },
    thr: { type: 'int', min: 3, max: 200, step: 1, default: 25, label: 'Limiar da linha' },
    refQuadros: { type: 'int', min: 3, max: 200, step: 1, default: 20, label: 'Quadros de referência (esteira vazia)' },
    hMin: { type: 'float', min: 2, max: 500, step: 1, default: 15, label: 'Altura mínima de caixa (mm)' },
    largMin: { type: 'float', min: 5, max: 3000, step: 5, default: 40, label: 'Largura mínima de caixa (mm)' },
    velocidade: { type: 'float', min: 1, max: 5000, step: 5, default: 300, label: 'Velocidade da esteira (mm/s)' },
    fator: { type: 'float', min: 1, max: 1000, step: 1, default: 300, label: 'Fator de cubagem (kg/m³; rodoviário 300, aéreo 167)' },
    direcao: { type: 'enum', options: ['vertical', 'horizontal'], default: 'vertical', label: 'Esteira corre na imagem (vista de cima)' },
    limiarVista: { type: 'int', min: 5, max: 120, step: 1, default: 25, label: 'Contraste caixa × fundo na vista de cima' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar perfil e caixa' },
  },
  apply(src, p, state, ctx) {
    const W = src.width, H = src.height;
    const geo = { ...PADRAO.geo, Hc_mm: p.Hc_mm, b_mm: p.b_mm, alpha_deg: p.alpha_deg, hfov_deg: p.hfov_deg, v_sign: p.sentidoV === '+1' ? 1 : -1, f_mm: 0, pix_um: 0 };
    const chave = `${W}x${H}|${JSON.stringify(geo)}|${p.laser}|${p.thr}`;
    let refazer = conferirGeracao('r.cubagem', state) || state.chave !== chave;
    for (const c of tomarComandos('r.cubagem')) if (c.acao === 'referencia') refazer = true;
    if (refazer || !state.sep) {
      if (state.chave !== chave || !state.sep) state.sep = new SeparadorCaixas({ velocidade: p.velocidade, fator: p.fator });
      state.chave = chave; state.ext = state.ext || new Extrator(); state.refs = []; state.ref = null; state.fundo = null; state.nf = 0;
      state.G = geometria(geo, W, H);
    }
    state.sep.o.velocidade = p.velocidade; state.sep.o.fator = p.fator;
    const faixa = marcas(ctx, 'cub_laser')[0];
    const E = clonar(PADRAO.extraction);
    E.mode = p.laser === 'vermelho' ? 'red' : 'mono'; E.thr = p.thr;
    const esp = Boolean(ctx.mirrored);
    if (faixa) {
      const c = faixa.caixa;
      // as colunas do extrator são as da CÂMERA (ele desfaz o espelho)
      const xa = esp ? (1 - c.x2) * W : c.x1 * W, xb = esp ? (1 - c.x1) * W : c.x2 * W;
      E.roi = [Math.floor(xa), Math.floor(c.y1 * H), Math.ceil(xb), Math.ceil(c.y2 * H)];
    } else E.roi = [0, 0, W, H];
    const { t, relogio } = tempoDe(ctx);
    const vistaM = marcas(ctx, 'cub_vista')[0];
    const k = mmPorPxQuadro(ctx);
    if (ctx.fonteParada) { publicarEstado(state, p, relogio, null); return clone(src); }
    const rows = Float32Array.from(state.ext.extrair(src, E, null, esp));
    // vista de cima: cinza do recorte (fundo aprendido com a esteira vazia)
    let vista = null, g = null, rv = null;
    if (vistaM && k) {
      rv = roiDe(vistaM, src);
      g = cinzaRoi(src, rv);
      if (!state.fundo || state.fundo.length !== g.length) state.fundo = Float32Array.from(g);
    }
    if (!state.ref) {
      state.refs.push(rows);
      if (g) for (let i = 0; i < g.length; i++) state.fundo[i] += (g[i] - state.fundo[i]) / Math.max(1, state.refs.length);
      if (state.refs.length >= p.refQuadros) { state.ref = referenciaLaser(state.refs); state.refs = []; }
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: `Cubagem: aprendendo a esteira VAZIA (${state.refs.length}/${p.refQuadros})…` });
      publicarEstado(state, p, relogio, null);
      return clone(src);
    }
    const pf = perfilCaixa(rows, state.ref, state.G, { hMin: p.hMin, largMin: p.largMin, h: state.hBuf, x: state.xBuf, xt: state.xtBuf });
    state.hBuf = pf.h; state.xBuf = pf.x; state.xtBuf = pf.xt;
    if (g) {
      if (pf.caixa) {
        const s = silhueta(g, state.fundo, rv.w, rv.h, p.limiarVista, 80);
        if (s && !s.toca) {
          const angEst = p.direcao === 'vertical' ? 90 : 0;
          const dAng = Math.min(Math.abs(s.angulo - angEst), 180 - Math.abs(s.angulo - angEst));
          // lado maior ao longo da esteira? senão o comprimento é o lado menor
          const ao = dAng < 45;
          vista = { comp: (ao ? s.comp : s.larg) * k, larg: (ao ? s.larg : s.comp) * k, nota: s.areaPx, cantos: s.cantos.map(([x, y]) => [x + rv.x, y + rv.y]) };
        }
      } else for (let i = 0; i < g.length; i++) state.fundo[i] += 0.05 * (g[i] - state.fundo[i]);
    }
    let codigo = null;
    if (Array.isArray(ctx.codigos) && ctx.codigos.length) codigo = ctx.codigos[0].text;
    const fechada = state.sep.passo(t, pf.caixa, { codigo, vista });
    if (fechada) state.ultima = fechada;
    if (p.desenhar) {
      const cx = pf.caixa;
      const u2x = (u) => (esp ? W - 1 - u : u);
      for (let u = E.roi[0]; u < E.roi[2]; u += 3) {
        if (!Number.isFinite(rows[u])) continue;
        const dentro = cx && u >= cx.u0 && u <= cx.u1;
        ctx.overlay.push({ type: 'point', x: u2x(u), y: rows[u], r: 1.5, color: dentro ? '#fb923c' : '#38bdf8' });
      }
      if (cx) {
        const xa = Math.min(u2x(cx.u0), u2x(cx.u1)), xb = Math.max(u2x(cx.u0), u2x(cx.u1));
        const ys = [rows[cx.u0], rows[cx.u1]].filter(Number.isFinite);
        const y0 = Math.min(...ys, H) - 30;
        ctx.overlay.push({ type: 'rect', x: xa, y: Math.max(0, y0), w: xb - xa, h: 40, color: '#fb923c', label: `A ${fmtN(cx.alt, 0)} × L ${fmtN(cx.larg, 0)} mm` });
      }
      if (vista && vista.cantos) {
        const c = vista.cantos;
        for (let i = 0; i < 4; i++) ctx.overlay.push({ type: 'line', x1: c[i][0], y1: c[i][1], x2: c[(i + 1) % 4][0], y2: c[(i + 1) % 4][1], color: '#4ade80', width: 2 });
      }
      if (vistaM && !k) ctx.overlay.push({ type: 'banner', x: 8, y: 32, color: '#F2A900', text: 'Vista de cima precisa da régua calibrada (mm): calibre nas Ferramentas de mouse' });
      const u = state.ultima;
      if (u) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#4ade80',
        text: `Caixa ${u.n}: ${fmtN(u.comprimento, 0)} × ${fmtN(u.largura, 0)} × ${fmtN(u.altura, 0)} mm · ${fmtN(u.volume, 4)} m³ · ${fmtN(u.pesoCubado, 1)} kg cub.` });
    }
    ctx.metrics['cubagem'] = `${state.sep.caixas.length} caixas`;
    publicarEstado(state, p, relogio, pf.caixa);
    return clone(src);
  },
};

function publicarEstado(state, p, relogio, atual) {
  publicar('r.cubagem', { caixas: state.sep ? state.sep.caixas.slice(-500) : [], atual, aprendendo: !state.ref,
                          refN: state.refs ? state.refs.length : 0, refQuadros: p.refQuadros, fator: p.fator, velocidade: p.velocidade, relogio });
}

// ------------------------------------------------------------------ 63 por foto

/** Pontos (px do quadro) do contorno de uma área: polígono/retângulo pelos vértices, máscara pelas células marcadas. */
function pontosArea(it, w, h) {
  if (it.tipo === 'mascara' && it.mq) {
    const { bits, w: mw, h: mh } = it.mq, [p0, p1] = it.pts;
    const pts = [];
    const cx = (i) => (p0[0] + ((p1[0] - p0[0]) * i) / mw) * w, cy = (j) => (p0[1] + ((p1[1] - p0[1]) * j) / mh) * h;
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      if (!bits[j * mw + i]) continue;
      const borda = i === 0 || j === 0 || i === mw - 1 || j === mh - 1 || !bits[j * mw + i - 1] || !bits[j * mw + i + 1] || !bits[(j - 1) * mw + i] || !bits[(j + 1) * mw + i];
      if (borda) pts.push([cx(i), cy(j)], [cx(i + 1), cy(j)], [cx(i), cy(j + 1)], [cx(i + 1), cy(j + 1)]);
    }
    return pts;
  }
  if (it.tipo === 'elipse') {
    const c = it.caixa, out = [];
    for (let a = 0; a < 64; a++) {
      const th = (a / 64) * 2 * Math.PI;
      out.push([((c.x1 + c.x2) / 2 + Math.cos(th) * (c.x2 - c.x1) / 2) * w, ((c.y1 + c.y2) / 2 + Math.sin(th) * (c.y2 - c.y1) / 2) * h]);
    }
    return out;
  }
  if (it.tipo === 'retangulo' && it.caixa) {
    const c = it.caixa;
    return [[c.x1 * w, c.y1 * h], [c.x2 * w, c.y1 * h], [c.x2 * w, c.y2 * h], [c.x1 * w, c.y2 * h]];
  }
  return it.px;
}

export const foto = {
  op: 'cubagem.foto',
  label: 'Cubagem por foto com régua (2 vistas)',
  group: G_CUB, overlayOnly: true,
  desc: 'Dimensões de um volume parado por foto: calibre a régua (Ferramentas de mouse) sobre uma medida conhecida NO ' +
        'PLANO da face e contorne a face com uma área "Cubagem · face" (retângulo, polígono ou o clique do SAM). Grave a ' +
        'vista de TOPO (comprimento × largura) e a LATERAL (altura) no painel Medições → volume e peso cubado.',
  params: {
    fator: { type: 'float', min: 1, max: 1000, step: 1, default: 300, label: 'Fator de cubagem (kg/m³)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar o retângulo medido' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.cubfoto', state) || !state.vistas) state.vistas = {};
    const { w, h } = ctx;
    const faces = marcas(ctx, 'cub_face');
    const k = mmPorPxQuadro(ctx);
    const out = [];
    for (const it of faces) {
      const r = retanguloDePontos(pontosArea(it, w, h));
      if (!r) continue;
      const f = { id: it.id, nome: it.nome, comp: k ? r.comp * k : r.comp, larg: k ? r.larg * k : r.larg, unidade: k ? 'mm' : 'px', angulo: r.angulo };
      out.push(f);
      if (p.desenhar) {
        const c = r.cantos;
        for (let i = 0; i < 4; i++) ctx.overlay.push({ type: 'line', x1: c[i][0], y1: c[i][1], x2: c[(i + 1) % 4][0], y2: c[(i + 1) % 4][1], color: '#4ade80', width: 2 });
        const xs = c.map((q) => q[0]), ys = c.map((q) => q[1]);
        ctx.overlay.push({ type: 'rect', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
                           color: '#4ade80', label: `${it.nome}: ${fmtN(f.comp, 1)} × ${fmtN(f.larg, 1)} ${f.unidade}` });
      }
    }
    for (const c of tomarComandos('r.cubfoto')) {
      const f = out.find((x) => x.id === c.id) || out[0];
      if (c.acao === 'gravar' && f) state.vistas[c.papel] = { ...f, t: Date.now() };
      if (c.acao === 'limpar') state.vistas = {};
    }
    if (!faces.length) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Cubagem por foto: contorne a face com uma área "Cubagem · face" (ou o clique do SAM)' });
    else if (!k) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Cubagem por foto: calibre a régua (mm) no plano da face — sem ela, só px' });
    const V = state.vistas;
    let vol = null;
    if (V.topo && V.lateral && V.topo.unidade === 'mm' && V.lateral.unidade === 'mm') {
      // a lateral mostra comprimento (ou largura) × altura: a altura é o lado que NÃO casa com o topo
      const a = V.lateral.comp, b = V.lateral.larg;
      const casaA = Math.min(Math.abs(a - V.topo.comp), Math.abs(a - V.topo.larg)), casaB = Math.min(Math.abs(b - V.topo.comp), Math.abs(b - V.topo.larg));
      const altura = casaA <= casaB ? b : a;
      const m3 = (V.topo.comp * V.topo.larg * altura) / 1e9;
      vol = { comprimento: V.topo.comp, largura: V.topo.larg, altura, volume: m3, pesoCubado: m3 * p.fator, conferencia: casaA <= casaB ? a : b };
    }
    publicar('r.cubfoto', { faces: out, vistas: V, resultado: vol, fator: p.fator, calibrado: Boolean(k) });
    return clone(src);
  },
};

export default [esteira, foto];
