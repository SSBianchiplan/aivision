/**
 * cv/operators/livres-r/inspecao.js — inspeções por posição e medição:
 *
 *   CV-54 inspecao.torque   (57) marca de torque (tinta) desalinhada
 *   CV-56 inspecao.solda    (59) pontos de solda por posição (presente,
 *                           faltando, deslocado, sobrando)
 *   CV-59 civil.fissuras    (C2) largura e comprimento de fissuras com régua
 *                           calibrada, mapa e relatório
 *
 * JS puro (runtime/livres-r/imagem.js); nada sai do navegador.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { marcaTorque, pontosSolda, cinzaRoi, medirFissuras, classeAbertura, COR_ABERTURA } from '../../runtime/livres-r/imagem.js';
import { marcas, roiDe, mascaraDe, imagemAnalise, mmPorPxQuadro, tomarComandos, fmtN } from './comum.js';

export const G_TORQUE = 'CV-54', G_SOLDA = 'CV-56', G_FISSURA = 'CV-59';

// ------------------------------------------------------------------ 57 marca de torque

export const torque = {
  op: 'inspecao.torque',
  label: 'Marca de torque desalinhada',
  group: G_TORQUE, overlayOnly: true,
  desc: 'Uma área redonda "Inspeção · marca de torque" por parafuso (centro no eixo, borda pegando a tinta na base). A ' +
        'tinta é achada pela cor (ΔE2000); o eixo da tinta na cabeça/porca é comparado com a direção da tinta na base: ' +
        'acima da tolerância = NOK (afrouxou). Risque a marca no sentido radial, ou grave a referência com tudo alinhado.',
  params: {
    cor: { type: 'text', default: '#e8d020', max: 9, label: 'Cor da tinta (#rrggbb)' },
    tolCor: { type: 'float', min: 2, max: 60, step: 1, default: 18, label: 'Tolerância de cor (ΔE2000)' },
    rCab: { type: 'float', min: 0.2, max: 0.9, step: 0.05, default: 0.55, label: 'Raio da cabeça/porca (fração da área)' },
    tolAng: { type: 'float', min: 1, max: 45, step: 0.5, default: 8, label: 'Tolerância de giro (graus)' },
    intervalo: { type: 'int', min: 0, max: 10000, step: 50, default: 300, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 960, label: 'Largura de análise (px)' },
    mostrarTinta: { type: 'bool', default: false, label: 'Mostrar os pixels de tinta' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.torque', state) || !state.m) { state.m = new Map(); state.tLer = 0; state.registro = []; }
    const cmds = tomarComandos('r.torque');
    const itens = marcas(ctx, 'torque');
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Torque: desenhe um círculo "Inspeção · marca de torque" centrado em cada parafuso' });
      publicar('r.torque', { itens: [], registro: state.registro });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const agora = performance.now();
    const ler = !ctx.fonteParada && agora - state.tLer >= p.intervalo;
    let img = src, k = 1;
    if (ler) { state.tLer = agora; ({ img, k } = imagemAnalise(ctx, src, p.largura)); }
    const out = [];
    for (const it of itens) {
      let e = state.m.get(it.id);
      if (!e) state.m.set(it.id, (e = { r: null, ref: null, estado: '—' }));
      const c = it.caixa;
      const C = [((c.x1 + c.x2) / 2) * img.width, ((c.y1 + c.y2) / 2) * img.height];
      const R = Math.min((c.x2 - c.x1) * img.width, (c.y2 - c.y1) * img.height) / 2;
      if (ler) {
        e.r = marcaTorque(img, C, R, { cor: p.cor, tol: p.tolCor, rCab: p.rCab, ref: e.ref, mascara: p.mostrarTinta });
        e.k = k;
      }
      for (const cm of cmds) {
        if (cm.acao === 'referencia' && e.r && e.r.ok) e.ref = { cab: e.r.angCab, base: e.r.angBase };
        if (cm.acao === 'sem_referencia') e.ref = null;
      }
      const r = e.r;
      const estado = !r ? '—' : !r.ok ? 'sem marca' : r.desvio > p.tolAng ? 'NOK' : 'OK';
      if (estado !== e.estado && estado !== '—') {
        state.registro.push({ t, nome: it.nome, estado, desvio: r && r.ok ? r.desvio : NaN });
        if (state.registro.length > 2000) state.registro.shift();
      }
      e.estado = estado;
      out.push({ id: it.id, nome: it.nome, estado, desvio: r && r.ok ? r.desvio : NaN, motivo: r && !r.ok ? r.motivo : '', comRef: Boolean(e.ref) });
      const corE = estado === 'OK' ? '#4ade80' : estado === 'NOK' ? '#FF4D4D' : '#F2A900';
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: corE,
                         label: `${it.nome}: ${estado}${r && r.ok ? ` ${fmtN(r.desvio, 1)}°` : ''}` });
      if (r && r.ok) {
        const cq = [C[0] / (e.k || 1), C[1] / (e.k || 1)], Rq = R / (e.k || 1);
        const L = Rq * p.rCab;
        ctx.overlay.push({ type: 'line', x1: cq[0] - Math.cos(r.angCab) * L, y1: cq[1] - Math.sin(r.angCab) * L, x2: cq[0] + Math.cos(r.angCab) * L, y2: cq[1] + Math.sin(r.angCab) * L, color: corE, width: 2 });
        ctx.overlay.push({ type: 'line', x1: cq[0] + Math.cos(r.angBase) * L, y1: cq[1] + Math.sin(r.angBase) * L, x2: cq[0] + Math.cos(r.angBase) * Rq, y2: cq[1] + Math.sin(r.angBase) * Rq, color: '#38bdf8', width: 3 });
        if (p.mostrarTinta && r.mascara) for (let i = 0; i < r.mascara.length; i += 3) ctx.overlay.push({ type: 'point', x: (r.mascara[i][0] + 0.5) / (e.k || 1), y: (r.mascara[i][1] + 0.5) / (e.k || 1), r: 1, color: '#FFD84D' });
      }
    }
    const nok = out.filter((x) => x.estado === 'NOK').length;
    if (nok) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#FF4D4D', text: `Torque: ${nok} marca(s) desalinhada(s)` });
    ctx.metrics['torque'] = `${out.filter((x) => x.estado === 'OK').length} OK · ${nok} NOK`;
    publicar('r.torque', { itens: out, registro: state.registro.slice(-500), tolAng: p.tolAng, relogio });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 59 pontos de solda

export const solda = {
  op: 'inspecao.solda',
  label: 'Pontos de solda por posição',
  group: G_SOLDA, overlayOnly: true,
  desc: 'Cada PONTO "Inspeção · posição de solda" é onde um ponto deve estar: procura uma mancha circular do diâmetro ' +
        'nominal em volta (disco × anel), marca presente, faltando ou deslocado (mm com a régua calibrada); manchas na ' +
        'área "Inspeção · peça (solda)" longe das posições contam como SOBRANDO. Peça OK/NOK e registro.',
  params: {
    diametroMm: { type: 'float', min: 0.5, max: 50, step: 0.5, default: 6, label: 'Diâmetro do ponto (mm, com régua)' },
    diametroPx: { type: 'float', min: 3, max: 200, step: 1, default: 12, label: 'Diâmetro do ponto (px, sem régua)' },
    busca: { type: 'float', min: 0.5, max: 5, step: 0.1, default: 1.5, label: 'Raio de busca (× raio do ponto)' },
    contraste: { type: 'float', min: 3, max: 200, step: 1, default: 18, label: 'Contraste mínimo' },
    polaridade: { type: 'enum', options: ['auto', 'escuro', 'claro'], default: 'auto', label: 'O ponto aparece' },
    tolPosMm: { type: 'float', min: 0.1, max: 50, step: 0.1, default: 2, label: 'Tolerância de posição (mm; sem régua = raio)' },
    intervalo: { type: 'int', min: 0, max: 10000, step: 50, default: 400, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 1280, label: 'Largura de análise (px)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.solda', state) || !state.registro) { state.registro = []; state.tLer = 0; state.r = null; state.assin = ''; state.pecas = { ok: 0, nok: 0 }; }
    const pos = marcas(ctx, 'solda_pos', ['ponto']);
    const peca = marcas(ctx, 'solda_peca')[0] || null;
    const { w, h } = ctx;
    if (!pos.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Solda: marque cada posição com um PONTO "Inspeção · posição de solda"' });
      publicar('r.solda', { pos: [], extras: [], registro: state.registro });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const kq = mmPorPxQuadro(ctx);
    const agora = performance.now();
    if (!ctx.fonteParada && agora - state.tLer >= p.intervalo) {
      state.tLer = agora;
      const { img, k } = imagemAnalise(ctx, src, p.largura);
      const mmImg = kq ? kq / k : null;
      const raio = mmImg ? p.diametroMm / 2 / mmImg : (p.diametroPx / 2) * k;
      const P = pos.map((q) => ({ id: q.id, nome: q.nome, x: q.pts[0][0] * img.width, y: q.pts[0][1] * img.height }));
      // recorte: a peça ou a caixa das posições com margem
      let r;
      if (peca) r = roiDe(peca, img);
      else {
        const xs = P.map((q) => q.x), ys = P.map((q) => q.y), m = raio * (3 + p.busca);
        const x0 = Math.max(0, Math.floor(Math.min(...xs) - m)), y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
        r = { x: x0, y: y0, w: Math.min(img.width, Math.ceil(Math.max(...xs) + m)) - x0, h: Math.min(img.height, Math.ceil(Math.max(...ys) + m)) - y0 };
      }
      const g = cinzaRoi(img, r);
      const res = pontosSolda(g, r.w, r.h, r.x, r.y, P, { r: raio, busca: p.busca * raio, contraste: p.contraste, polaridade: p.polaridade, extras: Boolean(peca) });
      const tolPx = mmImg ? p.tolPosMm / mmImg : raio;
      state.r = {
        k, mmImg,
        pos: res.pos.map((q) => ({ ...q, x: q.x / k, y: q.y / k, estado: !q.ok ? 'faltando' : q.erro > tolPx ? 'deslocado' : 'OK', erroMm: mmImg ? q.erro * mmImg : NaN, erroPx: q.erro / k })),
        extras: res.extras.map((q) => ({ x: q.x / k, y: q.y / k })), raio: raio / k,
      };
      const ok = state.r.pos.every((q) => q.estado === 'OK') && !state.r.extras.length;
      const assin = state.r.pos.map((q) => q.estado[0]).join('') + state.r.extras.length;
      if (assin !== state.assin) {
        state.assin = assin;
        state.registro.push({ t, ok, faltando: state.r.pos.filter((q) => q.estado === 'faltando').map((q) => q.nome).join(', '),
                              deslocados: state.r.pos.filter((q) => q.estado === 'deslocado').map((q) => q.nome).join(', '), sobrando: state.r.extras.length });
        if (state.registro.length > 2000) state.registro.shift();
      }
      state.ok = ok;
    }
    const R = state.r;
    if (R) {
      for (const q of R.pos) {
        const cr = q.estado === 'OK' ? '#4ade80' : q.estado === 'deslocado' ? '#F2A900' : '#FF4D4D';
        const pn = pos.find((x) => x.id === q.id);
        const nx = pn ? pn.px[0][0] : q.x, ny = pn ? pn.px[0][1] : q.y;
        ctx.overlay.push({ type: 'rect', x: nx - R.raio * 1.6, y: ny - R.raio * 1.6, w: R.raio * 3.2, h: R.raio * 3.2, color: cr, label: `${q.nome} ${q.estado}` });
        if (q.ok) ctx.overlay.push({ type: 'point', x: q.x, y: q.y, r: 3, color: cr });
      }
      for (const q of R.extras) ctx.overlay.push({ type: 'rect', x: q.x - R.raio * 1.4, y: q.y - R.raio * 1.4, w: R.raio * 2.8, h: R.raio * 2.8, color: '#e879f9', label: 'sobrando' });
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: state.ok ? '#4ade80' : '#FF4D4D',
        text: `Solda: ${R.pos.filter((q) => q.estado === 'OK').length}/${R.pos.length} OK${R.extras.length ? ` · ${R.extras.length} sobrando` : ''} — peça ${state.ok ? 'OK' : 'NOK'}` });
      ctx.metrics['solda'] = `${R.pos.filter((q) => q.estado === 'OK').length}/${R.pos.length} OK`;
    }
    publicar('r.solda', { pos: R ? R.pos : [], extras: R ? R.extras : [], ok: state.ok, registro: state.registro.slice(-500), calibrado: Boolean(kq), relogio });
    return clone(src);
  },
};

// ------------------------------------------------------------------ C2 fissuras

export const fissuras = {
  op: 'civil.fissuras',
  label: 'Medição de fissuras (largura e comprimento)',
  group: G_FISSURA, overlayOnly: true,
  desc: 'Fissuras escuras na área "Civil · fissuras" (ou no quadro todo): fundo por média larga, histerese, esqueleto; ' +
        'comprimento pela direção local e LARGURA pelo perfil normal ao eixo (subpixel). Em mm com a régua calibrada no ' +
        'plano da parede (ou um alvo de medida conhecida). Classe (capilar/fissura/trinca/rachadura/fenda), mapa, CSV e ' +
        'relatório no painel Medições. Foto de frente, luz rasante evitada, foco na parede.',
  params: {
    raioFundo: { type: 'int', min: 4, max: 80, step: 1, default: 14, label: 'Raio do fundo (px; > 3× a fissura mais larga)' },
    kAlto: { type: 'float', min: 2, max: 20, step: 0.5, default: 5, label: 'Limiar forte (× ruído)' },
    kBaixo: { type: 'float', min: 1, max: 10, step: 0.5, default: 2.5, label: 'Limiar fraco (× ruído)' },
    areaMin: { type: 'int', min: 5, max: 5000, step: 5, default: 40, label: 'Área mínima (px)' },
    alongMin: { type: 'float', min: 1, max: 20, step: 0.5, default: 3, label: 'Alongamento mínimo' },
    escuroCheio: { type: 'float', min: 0, max: 255, step: 1, default: 0, label: 'Contraste de fissura cheia (0 = automático)' },
    intervalo: { type: 'int', min: 200, max: 60000, step: 100, default: 1500, label: 'Medir a cada (ms)' },
    largura: { type: 'int', min: 320, max: 2560, step: 160, default: 1280, label: 'Largura de análise (px)' },
    congelar: { type: 'bool', default: false, label: 'Congelar a última medição (foto)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.fissuras', state)) { state.r = null; state.tLer = 0; }
    const area = marcas(ctx, 'fissura_area')[0] || null;
    const { w, h } = ctx;
    const kq = mmPorPxQuadro(ctx);
    const { t, relogio } = tempoDe(ctx);
    const agora = performance.now();
    const pedir = tomarComandos('r.fissuras').some((c) => c.acao === 'medir');
    if (pedir || (!(p.congelar && state.r) && !ctx.fonteParada && agora - (state.tLer || 0) >= p.intervalo) || (!state.r && !ctx.fonteParada)) {
      state.tLer = agora;
      const { img, k } = imagemAnalise(ctx, src, p.largura);
      const r = area ? roiDe(area, img) : { x: 0, y: 0, w: img.width, h: img.height };
      const g = cinzaRoi(img, r);
      // fora do polígono/elipse: fundo médio (não cria borda falsa)
      const msk = area ? mascaraDe(area, img) : null;
      if (msk) {
        let s = 0, n = 0;
        for (let y = 0; y < r.h; y += 2) for (let x = 0; x < r.w; x += 2) if (msk(r.x + x + 0.5, r.y + y + 0.5)) { s += g[y * r.w + x]; n++; }
        const m = n ? s / n : 128;
        for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) if (!msk(r.x + x + 0.5, r.y + y + 0.5)) g[y * r.w + x] = m;
      }
      const res = medirFissuras(g, r.w, r.h, { raioFundo: Math.round(p.raioFundo * k), kAlto: p.kAlto, kBaixo: p.kBaixo, areaMin: Math.round(p.areaMin * k * k),
                                               alongMin: p.alongMin, escuroCheio: p.escuroCheio });
      const mm = kq ? kq / k : null;   // mm por px da imagem de análise
      const conv = (v) => (mm ? v * mm : v);
      const fiss = res.fissuras.map((f) => {
        const lMax = conv(f.larguraMax);
        return { id: f.id, comprimento: conv(f.comprimento), larguraMax: lMax, larguraMedia: conv(f.larguraMedia), larguraP95: conv(f.larguraP95),
                 classe: mm ? classeAbertura(lMax) : '—',
                 pontos: f.pontos.map((q) => ({ x: (q.x + r.x + 0.5) / k, y: (q.y + r.y + 0.5) / k, l: conv(q.l), c: mm ? classeAbertura(conv(q.l)) : '—' })) };
      });
      state.r = { fissuras: fiss, unidade: mm ? 'mm' : 'px', comprimento: conv(res.comprimento), larguraMax: conv(res.larguraMax), ruido: res.ruido,
                  escuroCheio: res.escuroCheio, area: area ? { x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k } : { x: 0, y: 0, w, h }, quadro: { w, h }, t, quando: Date.now() };
    }
    const R = state.r;
    if (R) {
      for (const f of R.fissuras) {
        const passo = Math.max(1, Math.ceil(f.pontos.length / 300));
        for (let i = 0; i < f.pontos.length; i += passo) { const q = f.pontos[i]; ctx.overlay.push({ type: 'point', x: q.x, y: q.y, r: 2, color: COR_ABERTURA[q.c] || '#FFD84D' }); }
      }
      const f0 = R.fissuras[0];
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: R.unidade === 'mm' ? '#4ade80' : '#F2A900',
        text: R.fissuras.length ? `${R.fissuras.length} fissura(s) · ${fmtN(R.comprimento, R.unidade === 'mm' ? 0 : 0)} ${R.unidade} · abertura máx ${fmtN(R.larguraMax, 2)} ${R.unidade}${f0 && f0.classe !== '—' ? ` (${classeAbertura(R.larguraMax)})` : ''}`
                                : 'Nenhuma fissura achada' });
      if (R.unidade !== 'mm') ctx.overlay.push({ type: 'banner', x: 8, y: 32, color: '#F2A900', text: 'Calibre a régua (mm) no plano da parede para medir em mm' });
      ctx.metrics['fissuras'] = `${R.fissuras.length} · máx ${fmtN(R.larguraMax, 2)} ${R.unidade}`;
    }
    if (area) { const c = area.caixa; ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: '#38bdf8', label: area.nome }); }
    publicar('r.fissuras', { r: R, congelado: Boolean(p.congelar && R), relogio });
    return clone(src);
  },
};

export default [torque, solda, fissuras];
