/**
 * cv/operators/livres-u/agro.js — CV-85 Agro e pecuária.
 *
 *   agro.verde        (76) índice de verde (ExG ou ExG−ExR) e cobertura vegetal por área
 *   agro.armadilha    (77) insetos em armadilha adesiva, contagem por cartão e histórico
 *   agro.locomocao    (80) escore de locomoção (1–5) de bovinos pela trajetória (detector + IDs)
 *   agro.peso_dorsal  (A3) peso ESTIMADO pela área dorsal (câmera de cima + régua),
 *                     kg = a·A^b calibrado com pares da balança
 *
 * Todos são INDICADORES de manejo e triagem, não diagnóstico veterinário nem pesagem legal.
 */
import { clone } from '../../core.js';
import { publicar, tomar, tempoDe, conferirGeracao, lerLocal, gravarLocal } from '../../runtime/livres-u/canal.js';
import { indiceVerde, contarInsetos, escoreLocomocao, areaDorsal, pesoPorArea, ajustarPotencia } from '../../runtime/livres-u/agro.js';
import { roiDe, mediana } from '../../runtime/livres-u/imagem.js';
import { listaTexto } from '../../runtime/opkit.js';

const G = 'CV-85';
export const AVISO_AGRO = 'Indicador de manejo/triagem — não é diagnóstico veterinário nem pesagem legal.';

const areasDe = (ctx, funcao) => (ctx.marcacoes ? ctx.marcacoes.itens.filter((i) => i.funcao === funcao && i.caixa) : []);

export const verde = {
  op: 'agro.verde',
  label: 'Índice de verde (pasto/lavoura)',
  group: G,
  desc: 'Cobertura verde e índice médio pelas cores do pixel (ExG = 2g−r−b ou ExG−ExR, nas cromáticas), em cada área ' +
        '«Agro · área de verde» ou no quadro inteiro. Limiar automático (Otsu) ou fixo, máscara pintada e série no painel. ' +
        'Câmera comum (RGB): não substitui NDVI de sensor multiespectral; sol forte e sombra mudam o valor.',
  params: {
    indice: { type: 'enum', options: ['ExG', 'ExG−ExR'], default: 'ExG−ExR', label: 'Índice' },
    limiarModo: { type: 'enum', options: ['automático (Otsu)', 'fixo'], default: 'fixo', label: 'Limiar' },
    limiar: { type: 'float', min: -0.5, max: 1, step: 0.01, default: 0, label: 'Limiar fixo' },
    pintar: { type: 'bool', default: true, label: 'Pintar o que é verde' },
    intervaloMs: { type: 'int', min: 0, max: 5000, step: 50, default: 300, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_verde', state) || !state.serie) state.serie = [];
    const { w, h } = ctx;
    const agora = performance.now();
    const areas = areasDe(ctx, 'verde');
    const alvos = areas.length ? areas.map((a) => ({ nome: a.nome, roi: roiDe(a, w, h), poli: a.tipo === 'poligono' ? a.px : null })) : [{ nome: 'quadro', roi: { x: 0, y: 0, w, h }, poli: null }];
    if (!state.tAval || agora - state.tAval >= p.intervaloMs) {
      state.tAval = agora;
      const passo = Math.max(1, Math.round(Math.sqrt((w * h) / 120000)));
      state.res = alvos.filter((a) => a.roi).map((a) => ({ nome: a.nome, ...indiceVerde(src, a.roi, { indice: p.indice, limiar: p.limiarModo === 'fixo' ? p.limiar : 'otsu', passo }, a.poli), roi: a.roi }));
      const { t, relogio } = tempoDe(ctx);
      state.serie.push({ t, relogio, v: state.res.map((r) => r.cobertura) });
      if (state.serie.length > 2000) state.serie.shift();
    }
    const res = state.res || [];
    publicar('u_verde', { areas: res.map((r) => ({ nome: r.nome, cobertura: r.cobertura, media: r.media, mediaVerde: r.mediaVerde, limiar: r.limiar })), serie: state.serie.slice(-600), indice: p.indice });
    for (const r of res) ctx.overlay.push({ type: 'rect', x: r.roi.x, y: r.roi.y, w: r.roi.w, h: r.roi.h, color: '#4ade80', label: `${r.nome}: ${(r.cobertura * 100).toFixed(1)}% verde` });
    if (!p.pintar) return clone(src);
    const out = clone(src), d = out.data;
    for (const r of res) {
      const P = r.passo;
      for (let gy = 0; gy < r.gh; gy++) for (let gx = 0; gx < r.gw; gx++) {
        if (!r.mascara[gy * r.gw + gx]) continue;
        for (let yy = 0; yy < P; yy++) for (let xx = 0; xx < P; xx++) {
          const x = r.x0 + gx * P + xx, y = r.y0 + gy * P + yy;
          if (x >= w || y >= h) continue;
          const q = (y * w + x) * 4;
          d[q] = d[q] * 0.5 + 255 * 0.5; d[q + 1] = d[q + 1] * 0.5 + 0 * 0.5; d[q + 2] = d[q + 2] * 0.5 + 220 * 0.5;
        }
      }
    }
    return out;
  },
};

export const armadilha = {
  op: 'agro.armadilha',
  label: 'Insetos em armadilha adesiva',
  group: G,
  desc: 'Conta os insetos (manchas escuras) em cada área «Agro · armadilha» (cartão amarelo ou azul), sem as linhas da ' +
        'grade impressa; grudados viram vários pela área típica. Tamanho mínimo em mm² com a régua calibrada. Histórico ' +
        'por cartão e CSV no painel. Não identifica a espécie.',
  params: {
    contraste: { type: 'float', min: 0.1, max: 0.8, step: 0.05, default: 0.35, label: 'Mais escuro que o cartão (fração)' },
    minMm2: { type: 'float', min: 0, max: 50, step: 0.1, default: 0.5, label: 'Tamanho mínimo (mm²; sem régua usa px)' },
    minPx: { type: 'int', min: 2, max: 400, step: 1, default: 6, label: 'Tamanho mínimo sem régua (px)' },
    intervaloMs: { type: 'int', min: 100, max: 60000, step: 100, default: 1000, label: 'Contar a cada (ms)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_armadilha', state) || !state.hist) state.hist = {};
    const { w, h } = ctx;
    const agora = performance.now();
    const areas = areasDe(ctx, 'armadilha');
    const alvos = areas.length ? areas : [{ nome: 'cartão', caixa: { x1: 0, y1: 0, x2: 1, y2: 1 } }];
    if (!state.tAval || agora - state.tAval >= p.intervaloMs) {
      state.tAval = agora;
      const full = ctx.grabFull ? ctx.grabFull(2000) : null, img = full || src;
      const k = img.width / w;
      const esc = ctx.marcacoes && ctx.marcacoes.escala && ctx.marcacoes.escala.mmPorPxQuadro;
      const minPx = esc && p.minMm2 > 0 ? Math.max(2, Math.round(p.minMm2 / ((esc / k) ** 2))) : p.minPx;
      const { t, relogio } = tempoDe(ctx);
      state.res = alvos.map((a) => {
        const roi = roiDe(a, img.width, img.height);
        if (!roi) return null;
        const r = contarInsetos(img, roi, { contraste: p.contraste, minPx });
        const H = state.hist[a.nome] || (state.hist[a.nome] = []);
        H.push({ t, relogio, n: r.n, quando: Date.now() });
        if (H.length > 1000) H.shift();
        return { nome: a.nome, n: r.n, blobs: r.blobs.map((b) => ({ x: b.cx / k, y: b.cy / k, k: b.k })), roi: { x: roi.x / k, y: roi.y / k, w: roi.w / k, h: roi.h / k } };
      }).filter(Boolean);
    }
    const res = state.res || [];
    publicar('u_armadilha', { cartoes: res.map((r) => ({ nome: r.nome, n: r.n })), hist: state.hist });
    for (const r of res) {
      ctx.overlay.push({ type: 'rect', x: r.roi.x, y: r.roi.y, w: r.roi.w, h: r.roi.h, color: '#FFD84D', label: `${r.nome}: ${r.n} inseto(s)` });
      for (const b of r.blobs.slice(0, 600)) ctx.overlay.push({ type: 'point', x: b.x, y: b.y, r: b.k > 1 ? 4 : 2.5, color: b.k > 1 ? '#fb923c' : '#f87171' });
    }
    return clone(src);
  },
};

export const locomocao = {
  op: 'agro.locomocao',
  label: 'Escore de locomoção (bovinos)',
  group: G,
  desc: 'Para cada animal que atravessa a cena de lado (detector + Tracking com IDs), mede velocidade em corpos/s, ' +
        'regularidade do passo, paradas e o balanço vertical do dorso/cabeça e dá um escore de 1 (normal) a 5. ' +
        AVISO_AGRO + ' Use câmera fixa, de lado, no corredor de saída da ordenha.',
  params: {
    classes: { type: 'text', default: 'vaca, boi, bovino, cow, cattle', max: 160, label: 'Classes do animal' },
    lento: { type: 'float', min: 0.1, max: 2, step: 0.05, default: 0.45, label: 'Lento abaixo de (corpos/s)' },
    cvMax: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.35, label: 'Passo irregular acima de (CV)' },
    bobMax: { type: 'float', min: 0.01, max: 0.2, step: 0.005, default: 0.035, label: 'Balanço vertical acima de (fração da altura)' },
    perdidoS: { type: 'float', min: 0.3, max: 5, step: 0.1, default: 1.2, label: 'Fecha a passagem após sumir por (s)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_locomocao', state) || !state.trajs) { state.trajs = new Map(); state.animais = []; state.seq = 0; }
    const { t } = tempoDe(ctx);
    const cls = listaTexto(p.classes);
    const dets = (ctx.detections || []).filter((d) => d && d.id != null && (!cls.length || cls.some((c) => String(d.name || '').toLowerCase().includes(c))));
    for (const d of dets) {
      const k = String(d.id);
      const tr = state.trajs.get(k) || { pts: [], ult: t };
      if (!tr.pts.length || t > tr.pts[tr.pts.length - 1].t) tr.pts.push({ t, cx: (d.x1 + d.x2) / 2 * ctx.w, cy: (d.y1 + d.y2) / 2 * ctx.h, w: (d.x2 - d.x1) * ctx.w, h: (d.y2 - d.y1) * ctx.h });
      tr.ult = t;
      state.trajs.set(k, tr);
      ctx.overlay.push({ type: 'rect', x: d.x1 * ctx.w, y: d.y1 * ctx.h, w: (d.x2 - d.x1) * ctx.w, h: (d.y2 - d.y1) * ctx.h, color: '#a78bfa', label: `animal ${k}` });
    }
    for (const [k, tr] of [...state.trajs]) {
      if (t - tr.ult < p.perdidoS && !(t < tr.ult - 0.5)) continue;
      state.trajs.delete(k);
      const r = escoreLocomocao(tr.pts, { lento: p.lento, cvMax: p.cvMax, bobMax: p.bobMax });
      if (r.ok) state.animais.push({ n: ++state.seq, id: k, t: tr.pts[0].t, ...r });
    }
    const ult = state.animais[state.animais.length - 1];
    publicar('u_locomocao', { animais: state.animais.slice(-300), emCena: state.trajs.size, aviso: AVISO_AGRO });
    if (ult) ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Último animal: escore ${ult.escore} (${ult.rotulo}) · ${state.animais.length} avaliado(s)`, color: ult.escore >= 3 ? '#f87171' : '#4ade80' });
    return clone(src);
  },
};

const CHAVE_CAL = 'gplansis.peso-dorsal.cal.v1';

export const pesoDorsal = {
  op: 'agro.peso_dorsal',
  label: 'Peso estimado pela área dorsal',
  group: G,
  desc: 'Câmera de cima no corredor/balança: mede a área dorsal do animal na área «Agro · pesagem» (contraste com o ' +
        'piso ou a máscara do BiRefNet) em m² pela régua calibrada e estima kg = a·A^b. Calibre com 3 ou mais pesagens ' +
        'reais no painel (ajuste em log–log). ESTIMATIVA — ' + AVISO_AGRO,
  params: {
    fonte: { type: 'enum', options: ['contraste com o piso', 'máscara (BiRefNet)'], default: 'contraste com o piso', label: 'Animal por' },
    a: { type: 'float', min: 0, max: 5000, step: 0.1, default: 0, label: 'Fórmula: a (0 = usar a calibração)' },
    b: { type: 'float', min: 0.3, max: 3, step: 0.01, default: 1.5, label: 'Fórmula: b (expoente)' },
    estabilizar: { type: 'int', min: 1, max: 60, step: 1, default: 9, label: 'Mediana de N leituras' },
    intervaloMs: { type: 'int', min: 50, max: 5000, step: 50, default: 250, label: 'Intervalo (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!state.cal) { state.cal = lerLocal(CHAVE_CAL, { pares: [] }) || { pares: [] }; state.ultimas = []; state.registros = []; }
    const { w, h } = ctx;
    const esc = ctx.marcacoes && ctx.marcacoes.escala && ctx.marcacoes.escala.mmPorPxQuadro;
    const area = areasDe(ctx, 'pesagem')[0];
    const roi = area ? roiDe(area, w, h) : { x: 0, y: 0, w, h };
    const agora = performance.now();
    if (roi && (!state.tAval || agora - state.tAval >= p.intervaloMs)) {
      state.tAval = agora;
      let px = null, comp = null;
      if (p.fonte === 'máscara (BiRefNet)' && ctx.mask && ctx.mask.data) {
        const M = ctx.mask, sx = M.w / w, sy = M.h / h;
        let n = 0;
        for (let y = Math.floor(roi.y * sy); y < (roi.y + roi.h) * sy; y++) for (let x = Math.floor(roi.x * sx); x < (roi.x + roi.w) * sx; x++) if (M.data[y * M.w + x] > 0.5) n++;
        px = n / (sx * sy);
      } else {
        const r = areaDorsal(src, roi);
        if (r) { px = r.areaPx; comp = r.comp; }
      }
      if (px) { state.ultimas.push(px); if (state.ultimas.length > p.estabilizar) state.ultimas.shift(); }
      else state.ultimas = [];
      state.comp = comp;
    }
    const px = state.ultimas.length ? mediana(state.ultimas) : null;
    const m2 = px && esc ? (px * esc * esc) / 1e6 : null;
    const fit = ajustarPotencia(state.cal.pares);
    const usa = p.a > 0 ? { a: p.a, b: p.b, origem: 'fórmula manual' } : fit && state.cal.pares.length >= 3 ? { ...fit, origem: `calibrado (${fit.n} pesagens, R² ${fit.r2.toFixed(3)})` } : null;
    const kg = m2 && usa ? pesoPorArea(m2, usa.a, usa.b) : null;
    for (const c of tomar('u_peso')) {
      if (c.tipo === 'calibrar' && m2 && c.kg > 0) { state.cal.pares.push({ area: m2, kg: c.kg, quando: Date.now() }); gravarLocal(CHAVE_CAL, state.cal); }
      if (c.tipo === 'limparCalibracao') { state.cal = { pares: [] }; gravarLocal(CHAVE_CAL, state.cal); }
      if (c.tipo === 'apagarPar') { state.cal.pares.splice(c.i, 1); gravarLocal(CHAVE_CAL, state.cal); }
      if (c.tipo === 'registrar' && m2) { const { t, relogio } = tempoDe(ctx); state.registros.push({ n: state.registros.length + 1, animal: c.animal || '', t, relogio, quando: Date.now(), m2, kg }); }
    }
    publicar('u_peso', { px, m2, kg, escalaOk: Boolean(esc), formula: usa, pares: state.cal.pares, registros: state.registros, aviso: AVISO_AGRO });
    if (roi) ctx.overlay.push({ type: 'rect', x: roi.x, y: roi.y, w: roi.w, h: roi.h, color: '#38bdf8', label: area ? area.nome : 'pesagem' });
    if (state.comp) { const c = state.comp; ctx.overlay.push({ type: 'rect', x: c.x1, y: c.y1, w: c.x2 - c.x1, h: c.y2 - c.y1, color: '#4ade80' }); }
    const txt = !esc ? 'calibre a régua (mm/px) para medir a área' : !m2 ? 'sem animal na área' : kg ? `≈ ${kg.toFixed(0)} kg (estimativa) · ${m2.toFixed(3)} m²` : `${m2.toFixed(3)} m² · calibre com a balança`;
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Peso: ${txt}`, color: kg ? '#4ade80' : '#FFD84D' });
    return clone(src);
  },
};

export default [verde, armadilha, locomocao, pesoDorsal];
