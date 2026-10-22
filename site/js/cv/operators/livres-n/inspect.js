/**
 * operators/livres-n/inspect.js — CV-40 Inspeção visual (porte do GPlanSiS|Inspect).
 *
 * Dois jeitos de usar:
 *
 *   inspect.programa   o PROGRAMA (receita) ativo, com gatilho: a cada quadro o
 *                      gatilho olha a sua ROI na imagem reduzida; quando dispara
 *                      (peça assentada, linha cruzada, intervalo, botão), o quadro
 *                      em resolução plena é congelado e TODAS as ferramentas do
 *                      programa rodam nele → veredito OK/NOK/INCERTO, histórico,
 *                      fila de revisão. O motor mora em runtime/livres-n/canal.js;
 *                      a tela cheia GPlanSiS|Inspect mostra tudo.
 *
 *   inspect.presenca, .blobs, .paquimetro, .cor, .forma, .defeito_area
 *                      UMA ferramenta, ao vivo, sem programa: roda em cada
 *                      marcação das Ferramentas de mouse com a função "Inspect ·
 *                      <ferramenta>" (a régua dá o px→mm), num intervalo
 *                      configurável, e desenha OK/NOK/INCERTO e a medida. Serve
 *                      para ajustar limites antes de montar o programa.
 *
 * Todos são "overlayOnly" (não mexem nos pixels): o vídeo continua nítido e os
 * resultados vão por cima. JS puro sobre ImageData, sem modelo.
 */
import { clone } from '../../core.js';
import { rodarFerramenta, FERRAMENTAS, FAIXAS_HSV, labMediana } from '../../runtime/livres-n/ferramentas.js';
import { cinza, recorte } from '../../runtime/livres-n/visao.js';
import * as canal from '../../runtime/livres-n/canal.js';
import { numBR } from '../../numfmt.js';

const G = 'CV-40';
const AREAS = new Set(['retangulo', 'poligono', 'elipse']);
const LINHAS = new Set(['linha', 'regua']);
export const COR_STATUS = { PASS: '#4ade80', FAIL: '#FF4D4D', UNCERTAIN: '#F2A900', ERROR: '#F2A900' };
const COR_GAT = { vazio: '#7FB2FF', entrando: '#F2A900', inspecionada: '#4ade80' };
const ROT = { PASS: 'OK', FAIL: 'NOK', UNCERTAIN: 'INCERTO', ERROR: 'ERRO' };
const fmt = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : numBR(v, undefined, 3)) : v == null ? '—' : String(v));

/** Desenha os overlays de resultados (px da imagem inspecionada) no overlay do app, escalados por `esc`. */
export function desenharResultados(ov, resultados, esc, focoMarcas = true) {
  for (const r of resultados) {
    const cor = COR_STATUS[r.status] || '#FFD84D';
    const val = `${r.code} ${ROT[r.status]}${r.value != null ? ' · ' + fmt(r.value) : ''}`;
    let rotulado = false;
    for (const o of r.overlays || []) {
      if (o.kind === 'roi') {
        if (!focoMarcas) continue;
        ov.push({ type: 'rect', x: o.x * esc, y: o.y * esc, w: o.w * esc, h: o.h * esc, color: cor, label: rotulado ? undefined : val });
        rotulado = true;
      } else if (o.kind === 'box') {
        ov.push({ type: 'rect', x: o.x * esc, y: o.y * esc, w: o.w * esc, h: o.h * esc, color: o.tone === 'bad' ? '#FF4D4D' : cor });
      } else if (o.kind === 'line') {
        ov.push({ type: 'line', x1: o.p0[0] * esc, y1: o.p0[1] * esc, x2: o.p1[0] * esc, y2: o.p1[1] * esc, color: cor, width: 2 });
      } else if (o.kind === 'point') {
        ov.push({ type: 'point', x: o.p[0] * esc, y: o.p[1] * esc, color: cor, r: 4 });
      } else if (o.kind === 'poly' && o.pts && o.pts.length > 1) {
        for (let i = 0; i < o.pts.length; i++) {
          const a = o.pts[i], b = o.pts[(i + 1) % o.pts.length];
          ov.push({ type: 'line', x1: a[0] * esc, y1: a[1] * esc, x2: b[0] * esc, y2: b[1] * esc, color: cor, width: 1.6 });
        }
      } else if (o.kind === 'text' && !rotulado) {
        ov.push({ type: 'rect', x: o.p[0] * esc, y: o.p[1] * esc, w: 0, h: 0, color: cor, label: val });
        rotulado = true;
      }
    }
    if (!rotulado && r.overlays && r.overlays.length) {
      const o = r.overlays.find((x) => x.kind === 'box' || x.kind === 'line');
      if (o) ov.push({ type: 'rect', x: (o.x ?? o.p0[0]) * esc, y: (o.y ?? o.p0[1]) * esc, w: 0, h: 0, color: cor, label: val });
    }
  }
}

// ------------------------------------------------------------------ programa (com gatilho)

export const programa = {
  op: 'inspect.programa',
  label: 'Inspeção visual — programa com gatilho',
  group: G,
  overlayOnly: true,
  desc: 'Roda o PROGRAMA de inspeção ativo (receita versionada: ferramentas, ROIs, limites, gatilho) quando o gatilho ' +
        'dispara — presença (fundo aprendido + histerese), linha, intervalo ou manual. Congela o quadro em resolução ' +
        'plena, alinha à peça de referência (opcional), roda presença, contagem, paquímetro, cor, forma, área de ' +
        'defeito, OCR de lote/validade, código, serial, detector, classificação e anomalia (as com modelo fora do laço ' +
        'de quadros; o veredito espera por elas) e dá o veredito OK / NOK / INCERTO, com histórico, fila de revisão humana e CSV. Abra a tela ' +
        'GPlanSiS|Inspect para montar o programa e acompanhar.',
  params: {
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 1280, label: 'Largura da inspeção (px do quadro congelado)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar gatilho e resultados no vídeo' },
    modelo: { type: 'enum', options: ['—', 'presenca', 'dimensional', 'cor_defeito', 'rotulo', 'extrusao'], default: '—', label: 'Modelo de programa (presets)' },
  },
  apply(src, p, state, ctx) {
    if (p.modelo && p.modelo !== '—' && state.modelo !== p.modelo) {
      state.modelo = p.modelo;
      try { canal.garantirModelo(p.modelo); } catch (_) { /* segue com o ativo */ }
    }
    let rec = null;
    try {
      rec = canal.quadro(src, ctx, p);
    } catch (e) {
      ctx.metrics['Inspeção'] = 'erro: ' + (e && e.message ? e.message : e);
      return clone(src);
    }
    if (rec) state.tRec = performance.now();
    const prog = canal.programaAtivo();
    const gi = canal.infoGatilho();
    const ult = canal.ultimo();
    if (p.desenhar && !canal.studioAberto()) {
      const ov = ctx.overlay;
      if (gi && gi.modo !== 'manual') {
        const r = gi.roi;
        ov.push({ type: 'rect', x: r.x, y: r.y, w: r.w, h: r.h, color: COR_GAT[gi.estado] || '#7FB2FF',
                  label: r.marcacao ? undefined : `gatilho · ${gi.estado} · ${Math.round(gi.ocupacao * 100)} %` });
      }
      // resultado da última peça enquanto ela está na ROI (ou por 2,5 s)
      const fresco = ult && ult.W && ((gi && gi.estado !== 'vazio') || performance.now() - (state.tRec || 0) < 2500);
      if (fresco && state.tRec) desenharResultados(ov, ult.resultados, src.width / ult.W);
      if (prog) {
        const e = canal.estatisticas();
        const v = ult ? `#${ult.id} ${ult.final}` : 'aguardando peça';
        ov.push({ type: 'banner', x: 8, y: 8, color: !ult ? '#7FB2FF' : ult.final === 'OK' ? '#4ade80' : ult.final === 'NOK' ? '#FF4D4D' : '#F2A900',
                  text: `Inspect · ${prog.codigo} v${prog.versao} · ${v} · OK ${e.fin.OK} · NOK ${e.fin.NOK} · INCERTO ${e.fin.INCERTO}` });
      } else {
        ov.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Inspect · nenhum programa: abra o Studio Inspect e crie um' });
      }
    }
    if (prog) {
      ctx.metrics['Inspeção'] = ult ? `${ult.final} · #${ult.id} · ${ult.ms} ms` : 'aguardando';
      if (gi) ctx.metrics['Gatilho'] = `${gi.modo} · ${gi.estado} · ${Math.round(gi.ocupacao * 100)} %`;
    }
    return clone(src);
  },
};

// ------------------------------------------------------------------ ferramentas avulsas (ao vivo)

const COMUNS = {
  intervalo: { type: 'int', min: 50, max: 5000, step: 50, default: 300, label: 'Rodar a cada (ms)' },
  largura: { type: 'int', min: 320, max: 1920, step: 160, default: 1280, label: 'Largura de análise (px)' },
  faixa: { type: 'float', min: 0, max: 0.5, step: 0.01, default: 0.05, label: 'Faixa de incerteza (fração do limite)' },
  desenhar: { type: 'bool', default: true, label: 'Desenhar no vídeo' },
};

/** Nome da marcação → código no formato do Inspect (A–Z, 0–9, _). */
const codigoDe = (nome) => String(nome).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'T';

const parseNums = (s) => String(s || '').split(/[\s;,]+/).map((x) => Number(x.replace(',', '.'))).filter(Number.isFinite);

function faixaHsv(p) {
  const mapa = { queimado: FAIXAS_HSV.queimado, ferrugem: FAIXAS_HSV.ferrugem, mofo: FAIXAS_HSV.mofo,
                 'corpo estranho azul': FAIXAS_HSV.corpo_azul, metal: FAIXAS_HSV.metal };
  if (p.defeito !== 'personalizada') return [mapa[p.defeito] || FAIXAS_HSV.queimado];
  // "h0-h1, s0-s1, v0-v1"
  const pares = String(p.hsv || '').split(',').map((x) => x.split('-').map((v) => Number(v.trim())));
  const ok = (a, d) => (a && a.length === 2 && a.every(Number.isFinite) ? a : d);
  return [{ name: 'personalizada', h: ok(pares[0], [0, 179]), s: ok(pares[1], [0, 255]), v: ok(pares[2], [0, 255]) }];
}

/**
 * Fábrica dos operadores de uma ferramenta. `spec(p, st, it)` monta a spec
 * do Inspect a partir dos parâmetros (e do estado: molde, cor aprendida).
 */
function opFerramenta({ op, tipo, label, desc, params, spec, preparar }) {
  const def = FERRAMENTAS[tipo];
  return {
    op, label, group: G, overlayOnly: true, desc,
    params: { ...params, ...COMUNS },
    apply(src, p, state, ctx) {
      const mq = ctx.marcacoes;
      const forma = def.roi === 'linha' ? LINHAS : AREAS;
      const marcas = mq ? mq.itens.filter((i) => i.funcao === def.funcao && forma.has(i.tipo)) : [];
      const agora = performance.now();
      const parado = ctx.fonteParada && state.res && state.mq === mq;
      if (!parado && (!state.t || agora - state.t >= p.intervalo || state.mq !== mq)) {
        state.t = agora; state.mq = mq;
        const full = ctx.grabFull ? ctx.grabFull(p.largura) : null;
        const img = full && full.width >= src.width ? full : src;
        const e = mq && mq.escala;
        const ppm = e && e.mmPorPxQuadro ? img.width / (e.mmPorPxQuadro * src.width) : null;
        const itens = marcas.length ? marcas : def.roi === 'area' ? [null] : [];
        state.res = itens.map((it) => {
          const s = { type: tipo, code: codigoDe(it ? it.nome : 'IMAGEM'), name: it ? it.nome : 'imagem inteira', critical: true, band: p.faixa };
          if (def.roi === 'linha') { s.p0 = [it.pts[0][0] * img.width, it.pts[0][1] * img.height]; s.p1 = [it.pts[1][0] * img.width, it.pts[1][1] * img.height]; }
          else if (it) {
            const c = it.caixa;
            s.roi = { x: Math.floor(c.x1 * img.width), y: Math.floor(c.y1 * img.height), w: Math.max(1, Math.round((c.x2 - c.x1) * img.width)), h: Math.max(1, Math.round((c.y2 - c.y1) * img.height)) };
          }
          Object.assign(s, spec(p, state, it, img));
          const ctxF = { pxPorMm: ppm, assets: {} };
          if (preparar) preparar(p, state, it, img, s, ctxF);
          const r = rodarFerramenta(img, s, ctxF);
          r.nome = s.name;
          return r;
        });
        state.esc = src.width / img.width;
      }
      const res = state.res || [];
      // para os operadores seguintes (midia.tempo_tela): o veredito de cada ferramenta avulsa
      ctx.inspecao = (ctx.inspecao || []).concat(res.map((r) => ({ op: def.op, nome: r.nome, status: r.status, value: r.value })));
      if (p.desenhar) {
        desenharResultados(ctx.overlay, res, state.esc || 1);
        if (!marcas.length && def.roi === 'linha') {
          ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: `${def.curto}: desenhe uma linha ou régua com a função "Inspect · ${def.curto.toLowerCase()}" (Ferramentas de mouse)` });
        }
      }
      res.forEach((r, i) => {
        const nome = res.length > 1 ? `${def.curto} ${r.nome}` : def.curto;
        ctx.metrics[nome] = `${ROT[r.status]}${r.value != null ? ' · ' + fmt(r.value) : ''}${r.detail && r.detail.error ? ' · ' + r.detail.error : ''}`;
        if (i > 6) return;
      });
      return clone(src);
    },
  };
}

/** Molde da presença ao vivo: capturado da caixa da marcação na primeira passada (e ao alternar "Recapturar"). */
function prepararPresenca(p, st, it, img, s, ctxF) {
  st.moldes = st.moldes || new Map();
  const id = it ? it.id : '_';
  if (st.recapt !== p.recapturar) { st.recapt = p.recapturar; st.moldes.clear(); }
  const rect = s.roi;
  let m = st.moldes.get(id);
  if (rect && (!m || m.W !== img.width)) {
    const r = recorte(img, rect);
    if (r.w * r.h <= 256 * 256) { m = { g: Uint8Array.from(cinza(img, r)), w: r.w, h: r.h, W: img.width }; st.moldes.set(id, m); }
  }
  if (m) ctxF.assets[s.template_key] = m;
  // a busca = a caixa + folga
  if (rect) {
    const mx = Math.round(rect.w * p.folga), my = Math.round(rect.h * p.folga);
    const x0 = Math.max(0, rect.x - mx), y0 = Math.max(0, rect.y - my);
    s.roi = { x: x0, y: y0, w: Math.min(img.width, rect.x + rect.w + mx) - x0, h: Math.min(img.height, rect.y + rect.h + my) - y0 };
  }
}

export const presenca = opFerramenta({
  op: 'inspect.presenca', tipo: 'presence', label: 'Inspeção — presença (molde NCC)',
  desc: 'Presença de peça/componente por correlação normalizada (NCC, como o matchTemplate do OpenCV): o molde é a ' +
        'caixa da marcação "Inspect · presença" na primeira passada (peça boa na frente); a busca vai até a folga em ' +
        'volta. OK com NCC ≥ mínimo, INCERTO perto do limite, NOK abaixo.',
  params: {
    min_score: { type: 'float', min: 0.3, max: 1, step: 0.01, default: 0.8, label: 'NCC mínimo' },
    folga: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.25, label: 'Folga da busca (fração da caixa)' },
    recapturar: { type: 'bool', default: false, label: 'Recapturar o molde (alterne)' },
  },
  spec: (p) => ({ template_key: 'MOLDE', min_score: p.min_score }),
  preparar: prepararPresenca,
});

export const blobs = opFerramenta({
  op: 'inspect.blobs', tipo: 'blob_count', label: 'Inspeção — contagem (blobs)',
  desc: 'Conta manchas/furos/componentes na área "Inspect · contagem": desfoque 5×5, limiar Otsu, fixo ou adaptativo ' +
        '(luz irregular), componentes conexos 8, faixa de área. OK com a contagem dentro da faixa.',
  params: {
    polaridade: { type: 'enum', options: ['escuro', 'claro'], default: 'escuro', label: 'Contar o que é' },
    limiar: { type: 'enum', options: ['Otsu', 'fixo', 'adaptativo'], default: 'Otsu', label: 'Limiar' },
    valor: { type: 'int', min: 0, max: 255, step: 1, default: 128, label: 'Limiar fixo (0–255)' },
    bloco: { type: 'int', min: 3, max: 151, step: 2, default: 31, label: 'Bloco do adaptativo (px)' },
    area_min: { type: 'int', min: 1, max: 1000000, step: 1, default: 30, label: 'Área mínima (px)' },
    area_max: { type: 'int', min: 1, max: 10000000, step: 1, default: 100000, label: 'Área máxima (px)' },
    cont_min: { type: 'int', min: 0, max: 10000, step: 1, default: 1, label: 'Contagem mínima' },
    cont_max: { type: 'int', min: 0, max: 10000, step: 1, default: 10, label: 'Contagem máxima' },
  },
  spec: (p) => ({
    polarity: p.polaridade === 'claro' ? 'light' : 'dark',
    threshold: p.limiar === 'fixo' ? p.valor : null, threshold_mode: p.limiar === 'adaptativo' ? 'adaptive' : undefined, block: p.bloco, c: 5,
    min_area: p.area_min, max_area: p.area_max, count_min: p.cont_min, count_max: Math.max(p.cont_min, p.cont_max),
  }),
});

export const paquimetro = opFerramenta({
  op: 'inspect.paquimetro', tipo: 'caliper', label: 'Inspeção — paquímetro (mm)',
  desc: 'Mede a distância entre a primeira e a última borda ao longo de uma linha/régua "Inspect · paquímetro": perfil ' +
        'médio numa faixa de largura, gradiente, refino sub-pixel no pico; mm pela calibração da régua. OK dentro de ' +
        'nominal ± tolerância.',
  params: {
    nominal: { type: 'float', min: 0.01, max: 10000, step: 0.01, default: 50, label: 'Nominal (mm)' },
    tol: { type: 'float', min: 0.001, max: 1000, step: 0.01, default: 0.5, label: 'Tolerância ± (mm)' },
    largura_perfil: { type: 'int', min: 1, max: 101, step: 2, default: 9, label: 'Largura do perfil (px)' },
    contraste: { type: 'float', min: 1, max: 255, step: 1, default: 20, label: 'Contraste mínimo da borda' },
  },
  spec: (p) => ({ nominal_mm: p.nominal, tol_mm: p.tol, width: p.largura_perfil, edge_min_contrast: p.contraste }),
});

export const cor = opFerramenta({
  op: 'inspect.cor', tipo: 'color', label: 'Inspeção — cor (ΔE2000)',
  desc: 'Compara a cor mediana (Lab) da área "Inspect · cor" com a referência pela fórmula CIEDE2000. Sem referência ' +
        'digitada, aprende a primeira leitura (peça boa na frente). OK com ΔE00 ≤ máximo.',
  params: {
    ref: { type: 'text', default: '', max: 40, label: 'Referência "L a b" (vazio = aprender)' },
    max_de: { type: 'float', min: 0.1, max: 50, step: 0.1, default: 3, label: 'ΔE00 máximo' },
    reaprender: { type: 'bool', default: false, label: 'Reaprender a referência (alterne)' },
  },
  spec: (p) => ({ max_delta_e: p.max_de }),
  preparar(p, st, it, img, s) {
    st.refs = st.refs || new Map();
    if (st.reap !== p.reaprender) { st.reap = p.reaprender; st.refs.clear(); }
    const dig = parseNums(p.ref);
    if (dig.length === 3) { s.ref_lab = dig; return; }
    const id = it ? it.id : '_';
    if (!st.refs.has(id)) st.refs.set(id, labMediana(img, recorte(img, s.roi)).map((v) => Math.round(v * 100) / 100));
    s.ref_lab = st.refs.get(id);
  },
});

export const forma = opFerramenta({
  op: 'inspect.forma', tipo: 'shape', label: 'Inspeção — forma do objeto',
  desc: 'Segmenta o objeto da área "Inspect · forma" (Otsu, polaridade pela borda, abertura/fechamento, furos tapados) ' +
        'e mede o maior contorno: Ø equivalente e área em mm (com a régua), circularidade 4πA/P², solidez A/A_casco ' +
        '(mordida, trinca, falta de material) e alongamento (menor retângulo girado). Zero = critério desligado.',
  params: {
    polaridade: { type: 'enum', options: ['auto', 'escuro', 'claro'], default: 'auto', label: 'Objeto' },
    area_min_px: { type: 'int', min: 1, max: 10000000, step: 1, default: 500, label: 'Área mínima (px)' },
    diam_nom: { type: 'float', min: 0, max: 10000, step: 0.1, default: 0, label: 'Ø equivalente nominal (mm; 0 = não)' },
    diam_tol: { type: 'float', min: 0, max: 1000, step: 0.1, default: 1, label: 'Ø tolerância ± (mm)' },
    circ_min: { type: 'float', min: 0, max: 1, step: 0.01, default: 0, label: 'Circularidade mínima (0 = não)' },
    solidez_min: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.95, label: 'Solidez mínima (0 = não)' },
    aspecto_min: { type: 'float', min: 0, max: 100, step: 0.01, default: 0, label: 'Alongamento mínimo (0 = não)' },
    aspecto_max: { type: 'float', min: 0, max: 100, step: 0.01, default: 0, label: 'Alongamento máximo (0 = não)' },
  },
  spec: (p) => ({
    polarity: p.polaridade === 'escuro' ? 'dark' : p.polaridade === 'claro' ? 'light' : 'auto', min_area_px: p.area_min_px,
    eq_diam_mm: p.diam_nom > 0 ? [p.diam_nom, p.diam_tol] : null,
    circularity_min: p.circ_min > 0 ? p.circ_min : null, solidity_min: p.solidez_min > 0 ? p.solidez_min : null,
    aspect_range: p.aspecto_max > 0 ? [p.aspecto_min, p.aspecto_max] : null,
  }),
});

export const defeito = opFerramenta({
  op: 'inspect.defeito_area', tipo: 'defect_area', label: 'Inspeção — área de defeito (HSV)',
  desc: 'Mede a área de defeito por cor (faixas HSV do OpenCV) DENTRO do objeto da área "Inspect · área de defeito": ' +
        'queimado, ferrugem, mofo, corpo estranho azul ou metálico, ou uma faixa sua. % da área do objeto e número de ' +
        'manchas; OK abaixo dos limites.',
  params: {
    defeito: { type: 'enum', options: ['queimado', 'ferrugem', 'mofo', 'corpo estranho azul', 'metal', 'personalizada'], default: 'queimado', label: 'Defeito' },
    hsv: { type: 'text', default: '0-179, 0-255, 0-55', max: 60, label: 'Faixa personalizada "h0-h1, s0-s1, v0-v1"' },
    dentro_objeto: { type: 'bool', default: true, label: 'Só dentro do objeto' },
    max_pct: { type: 'float', min: 0, max: 100, step: 0.1, default: 2, label: 'Área máxima (%)' },
    mancha_min: { type: 'int', min: 1, max: 100000, step: 1, default: 20, label: 'Mancha mínima (px)' },
    max_manchas: { type: 'int', min: -1, max: 1000, step: 1, default: -1, label: 'Máximo de manchas (−1 = sem limite)' },
  },
  spec: (p) => ({ ranges: faixaHsv(p), within_object: p.dentro_objeto, max_pct: p.max_pct, min_spot_px: p.mancha_min, max_spots: p.max_manchas >= 0 ? p.max_manchas : null }),
});

export default [programa, presenca, blobs, paquimetro, cor, forma, defeito];
