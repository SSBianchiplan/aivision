/**
 * cv/operators/livres-r/processo.js — variáveis de processo pela câmera:
 *
 *   CV-52 processo.nivel        (54) nível de silo/tanque pelo visor
 *         processo.gotejamento  (55) gotas por minuto e poça crescendo
 *   CV-53 correia.alinhamento   (56) desalinhamento lateral de correia, tendência
 *   CV-55 processo.cor_chama    (58) cor de chama/forno: ΔE2000 contra a referência
 *   CV-57 ambiente.ringelmann   (61) opacidade de fumaça, escala de Ringelmann
 *                               — INDICATIVO, não é laudo ambiental
 *
 * Todos com histórico e alarmes ISA-18.2 (motor da onda 1-a), publicados no
 * canal do painel Medições. JS puro; nada sai do navegador.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { Alarmes, COR_PRIO } from '../../runtime/livres-oa/alarmes.js';
import { nivelVisor, DetectorGotas, bordasCorreia, inclinacao, corRegiao, deltaE2000, labDeRgb, hexRgb,
         opacidadeFumaca, yMediana } from '../../runtime/livres-r/imagem.js';
import { marcas, roiDe, mascaraDe, imagemAnalise, mmPorPxQuadro, passoLimites, limitesDoTexto, faixaDoNome,
         ALARMES_PARAMS, tomarComandos, empurrar, fmtN } from './comum.js';

export const G_NIVEL = 'CV-52', G_CORREIA = 'CV-53', G_CHAMA = 'CV-55', G_FUMACA = 'CV-57';

export const AVISO_RINGELMANN = 'INDICATIVO — estimativa por câmera da opacidade aparente; não substitui a avaliação por ' +
  'observador qualificado nem laudo ambiental (ex.: Ringelmann pela norma/legislação aplicável).';

const motores = { nivel: new Alarmes(), gotas: new Alarmes(), correia: new Alarmes(), chama: new Alarmes(), fumaca: new Alarmes() };
export function alarmesDe(nome) { return motores[nome]; }
function cor(alarmes, prefixo) {
  const p = alarmes.pendentes().filter((a) => a.tag.startsWith(prefixo) && /ATIVO/.test(a.estado)).reduce((m, a) => Math.min(m, a.prio), 9);
  return COR_PRIO[p] || '#4ade80';
}
const mediana = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

// ------------------------------------------------------------------ 54 nível

export const nivel = {
  op: 'processo.nivel',
  label: 'Nível pelo visor (silo/tanque)',
  group: G_NIVEL, overlayOnly: true,
  desc: 'Nível de líquido ou grão pelo visor de vidro: área "Processo · visor de nível" do fundo ao topo da escala. A ' +
        'interface é o degrau mais forte do perfil vertical (luz ou cor), com subpixel e mediana de 5 leituras. A faixa ' +
        'pode vir no nome ("Tanque 0-5000 L"). Histórico e alarmes ISA-18.2.',
  params: {
    min: { type: 'float', min: -1e6, max: 1e6, step: 1, default: 0, label: 'Valor no FUNDO do visor' },
    max: { type: 'float', min: -1e6, max: 1e6, step: 1, default: 100, label: 'Valor no TOPO do visor' },
    unidade: { type: 'text', default: '%', max: 12, label: 'Unidade' },
    canal: { type: 'enum', options: ['luz', 'cor'], default: 'luz', label: 'Contraste por luz ou por cor (saturação)' },
    polaridade: { type: 'enum', options: ['auto', 'escuro', 'claro'], default: 'auto', label: 'Produto aparece (embaixo)' },
    faixaCentral: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.5, label: 'Faixa central usada (fração da largura)' },
    forcaMin: { type: 'float', min: 1, max: 50, step: 0.5, default: 4, label: 'Nitidez mínima do degrau' },
    limites: { type: 'text', default: '', max: 120, label: 'Alarmes (ex.: HH 95; H 85; L 15; LL 5)' },
    ...ALARMES_PARAMS,
    intervalo: { type: 'int', min: 0, max: 10000, step: 50, default: 300, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 960, label: 'Largura de análise (px)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.nivel', state) || !state.m) { state.m = new Map(); state.tLer = 0; }
    const al = motores.nivel;
    for (const c of tomarComandos('r.nivel')) if (c.acao === 'reconhecer') al.reconhecer(null, tempoDe(ctx).t);
    const itens = marcas(ctx, 'nivel_visor');
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Nível: desenhe a área "Processo · visor de nível" do fundo ao topo do visor' });
      publicar('r.nivel', { itens: [], alarmes: al.resumo() });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const agora = performance.now();
    const ler = !ctx.fonteParada && agora - state.tLer >= p.intervalo;
    let img = src;
    if (ler) { state.tLer = agora; img = imagemAnalise(ctx, src, p.largura).img; }
    const lim = limitesDoTexto(p.limites);
    const out = [];
    for (const it of itens) {
      const fx = faixaDoNome(it.nome) || { min: p.min, max: p.max, unidade: p.unidade };
      let e = state.m.get(it.id);
      if (!e) state.m.set(it.id, (e = { ult: [], valor: NaN, hist: [], yFrac: NaN, forca: 0 }));
      if (ler) {
        const r = nivelVisor(img, roiDe(it, img), { frac: p.faixaCentral, canal: p.canal, polaridade: p.polaridade });
        if (r && r.forca >= p.forcaMin) {
          const v = fx.min + r.frac * (fx.max - fx.min);
          e.ult.push(v); if (e.ult.length > 5) e.ult.shift();
          e.valor = mediana(e.ult); e.yFrac = 1 - r.frac; e.forca = r.forca; e.incerto = false;
          empurrar(e.hist, t, e.valor);
        } else { e.incerto = true; e.forca = r ? r.forca : 0; }
      }
      const banda = Math.abs(fx.max - fx.min) * p.bandaPct / 100;
      passoLimites(al, it.nome, e.incerto ? NaN : e.valor, lim, banda, p, t, fx.unidade);
      const casas = Math.abs(fx.max - fx.min) <= 20 ? 2 : Math.abs(fx.max - fx.min) <= 200 ? 1 : 0;
      out.push({ id: it.id, nome: it.nome, valor: e.valor, unidade: fx.unidade, min: fx.min, max: fx.max, incerto: Boolean(e.incerto), forca: e.forca, casas, hist: e.hist.slice(-600) });
      const txt = `${fmtN(e.valor, casas)} ${fx.unidade}${e.incerto ? ' (incerto)' : ''}`;
      ctx.metrics[it.nome] = txt;
      const c = it.caixa;
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor(al, it.nome + ' '), label: `${it.nome}: ${txt}` });
      if (Number.isFinite(e.yFrac)) {
        const y = (c.y1 + e.yFrac * (c.y2 - c.y1)) * h;
        ctx.overlay.push({ type: 'line', x1: c.x1 * w - 10, y1: y, x2: c.x2 * w + 10, y2: y, color: e.incerto ? '#F2A900' : '#4ade80', width: 2.5 });
      }
    }
    al.limpar(t, 3600);
    publicar('r.nivel', { itens: out, alarmes: al.resumo(), relogio });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 55 gotejamento

export const gotejamento = {
  op: 'processo.gotejamento',
  label: 'Gotejamento e vazamento',
  group: G_NIVEL, overlayOnly: true,
  desc: 'Conta gotas que caem na área "Processo · gotejamento" (mancha pequena que desce, contra um fundo que aprende) e ' +
        'mede a poça: a fração da área que mudou desde o início, com tendência por minuto. Alarmes ISA-18.2 por gotas/min ' +
        'e por poça. Câmera fixa, fundo sem movimento.',
  params: {
    limiar: { type: 'int', min: 4, max: 120, step: 1, default: 20, label: 'Contraste da gota' },
    aMin: { type: 'int', min: 1, max: 200, step: 1, default: 3, label: 'Área mínima da gota (px de análise)' },
    aMax: { type: 'int', min: 4, max: 5000, step: 10, default: 400, label: 'Área máxima da gota (px de análise)' },
    limiarPoca: { type: 'int', min: 4, max: 120, step: 1, default: 18, label: 'Contraste da poça contra o início' },
    janela: { type: 'int', min: 10, max: 3600, step: 10, default: 60, label: 'Janela da taxa (s)' },
    limitesGotas: { type: 'text', default: 'H 10; HH 30', max: 80, label: 'Alarmes de gotas/min' },
    limitesPoca: { type: 'text', default: 'H 10; HH 25', max: 80, label: 'Alarmes de poça (% da área)' },
    ...ALARMES_PARAMS,
    analise: { type: 'int', min: 60, max: 640, step: 20, default: 200, label: 'Lado máximo da análise (px)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.gotas', state) || !state.m) state.m = new Map();
    const al = motores.gotas;
    for (const c of tomarComandos('r.gotas')) {
      if (c.acao === 'reconhecer') al.reconhecer(null, tempoDe(ctx).t);
      if (c.acao === 'fundo') for (const e of state.m.values()) e.det.zerar();
    }
    const itens = marcas(ctx, 'gotejamento');
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Gotejamento: desenhe a área "Processo · gotejamento" onde as gotas caem' });
      publicar('r.gotas', { itens: [], alarmes: al.resumo() });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const k = mmPorPxQuadro(ctx);
    const out = [];
    for (const it of itens) {
      const r = roiDe(it, src);
      const f = Math.max(1, Math.ceil(Math.max(r.w, r.h) / p.analise));
      const gw = Math.max(1, Math.floor(r.w / f)), gh = Math.max(1, Math.floor(r.h / f));
      let e = state.m.get(it.id);
      if (!e || e.gw !== gw || e.gh !== gh) state.m.set(it.id, (e = { gw, gh, det: new DetectorGotas(), hist: [] }));
      Object.assign(e.det.o, { limiar: p.limiar, aMin: p.aMin, aMax: p.aMax, limiarPoca: p.limiarPoca });
      let res = { novas: [], poca: NaN };
      if (!ctx.fonteParada) {
        const g = new Float32Array(gw * gh), d = src.data, W = src.width;
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
          let s = 0;
          for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const q = ((r.y + y * f + j) * W + r.x + x * f + i) * 4; s += 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2]; }
          g[y * gw + x] = s / (f * f);
        }
        res = e.det.passo(g, gw, gh, t);
      }
      const taxa = e.det.taxa(t, p.janela);
      const poca = e.det.serie.length ? e.det.serie[e.det.serie.length - 1][1] * 100 : NaN;
      const tend = e.det.tendenciaPoca(t, 120) * 100;
      const areaMm2 = k && Number.isFinite(poca) ? (poca / 100) * r.w * r.h * k * k : NaN;
      if (Number.isFinite(taxa)) empurrar(e.hist, t, taxa);
      passoLimites(al, `${it.nome} gotas/min`, taxa, limitesDoTexto(p.limitesGotas), 0.5, p, t, 'gotas/min');
      passoLimites(al, `${it.nome} poça`, poca, limitesDoTexto(p.limitesPoca), 0.5, p, t, '%');
      out.push({ id: it.id, nome: it.nome, gotas: e.det.gotas.length, taxa, poca, tendencia: tend, areaMm2, hist: e.hist.slice(-600),
                 pocaHist: e.det.serie.slice(-600).map(([tt, v]) => [tt, v * 100]), aprendendo: !e.det.fundo });
      ctx.metrics[it.nome] = `${e.det.gotas.length} gotas · ${fmtN(taxa, 1)}/min · poça ${fmtN(poca, 1)}%`;
      const c = it.caixa;
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor(al, it.nome + ' '),
                         label: `${it.nome}: ${fmtN(taxa, 1)} gotas/min · poça ${fmtN(poca, 1)}%` });
      for (const tr of e.det.trilhas) ctx.overlay.push({ type: 'point', x: r.x + (tr.x + 0.5) * f, y: r.y + (tr.y + 0.5) * f, r: 4, color: tr.contada ? '#38bdf8' : '#94a3b8' });
      for (const gt of res.novas) ctx.overlay.push({ type: 'point', x: r.x + (gt.x + 0.5) * f, y: r.y + (gt.y + 0.5) * f, r: 8, color: '#FFD84D' });
    }
    al.limpar(t, 3600);
    publicar('r.gotas', { itens: out, alarmes: al.resumo(), relogio });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 56 correia

export const correia = {
  op: 'correia.alinhamento',
  label: 'Desalinhamento lateral de correia',
  group: G_CORREIA, overlayOnly: true,
  desc: 'Acha as duas bordas da correia na área "Correia · faixa" (atravessando a correia inteira) e mede o desvio do ' +
        'centro contra a referência (os primeiros quadros, ou "Zerar referência" no painel) em mm — a escala vem da ' +
        'largura nominal da correia — e em % da largura. Tendência em mm/min e alarmes ISA-18.2.',
  params: {
    eixo: { type: 'enum', options: ['vertical', 'horizontal'], default: 'vertical', label: 'A correia corre na imagem' },
    larguraMm: { type: 'float', min: 0, max: 5000, step: 10, default: 1000, label: 'Largura nominal da correia (mm; 0 = régua)' },
    refQuadros: { type: 'int', min: 3, max: 300, step: 1, default: 30, label: 'Leituras para a referência' },
    forcaMin: { type: 'float', min: 1, max: 50, step: 0.5, default: 4, label: 'Nitidez mínima das bordas' },
    limites: { type: 'text', default: 'H 5; HH 10', max: 80, label: 'Alarmes do |desvio| (% da largura)' },
    tendMax: { type: 'float', min: 0, max: 1000, step: 1, default: 20, label: 'Alarme de tendência (|mm/min|; 0 = sem)' },
    janelaTend: { type: 'int', min: 10, max: 3600, step: 10, default: 300, label: 'Janela da tendência (s)' },
    ...ALARMES_PARAMS,
    intervalo: { type: 'int', min: 0, max: 5000, step: 50, default: 100, label: 'Ler a cada (ms)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.correia', state) || !state.m) { state.m = new Map(); state.tLer = 0; }
    const al = motores.correia;
    for (const c of tomarComandos('r.correia')) {
      if (c.acao === 'reconhecer') al.reconhecer(null, tempoDe(ctx).t);
      if (c.acao === 'referencia') for (const e of state.m.values()) { e.ref = NaN; e.amostras = []; }
    }
    const itens = marcas(ctx, 'correia_faixa');
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Correia: desenhe a área "Correia · faixa" atravessando a correia (as duas bordas dentro)' });
      publicar('r.correia', { itens: [], alarmes: al.resumo() });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const agora = performance.now();
    const ler = !ctx.fonteParada && agora - state.tLer >= p.intervalo;
    if (ler) state.tLer = agora;
    const kCal = mmPorPxQuadro(ctx);
    const vert = p.eixo !== 'horizontal';
    const out = [];
    for (const it of itens) {
      let e = state.m.get(it.id);
      if (!e) state.m.set(it.id, (e = { ref: NaN, amostras: [], hist: [], b: null, desvioPx: NaN, largPx: NaN }));
      if (ler) {
        const b = bordasCorreia(src, roiDe(it, src), p.eixo);
        if (b && b.forca >= p.forcaMin) {
          e.b = b; e.incerto = false;
          if (!Number.isFinite(e.ref)) {
            e.amostras.push([b.centro, b.largura]);
            if (e.amostras.length >= p.refQuadros) { e.ref = mediana(e.amostras.map((a) => a[0])); e.largRef = mediana(e.amostras.map((a) => a[1])); }
          } else {
            e.desvioPx = b.centro - e.ref; e.largPx = b.largura;
          }
        } else e.incerto = true;
      }
      // escala: largura nominal ÷ largura em px (independe de régua); senão a régua
      const mmPx = p.larguraMm > 0 && e.largRef > 0 ? p.larguraMm / e.largRef : kCal;
      const desvMm = mmPx && Number.isFinite(e.desvioPx) ? e.desvioPx * mmPx * (ctx.marcacoes && ctx.marcacoes.espelhado ? -1 : 1) : NaN;
      const desvPct = Number.isFinite(e.desvioPx) && e.largRef > 0 ? (100 * e.desvioPx) / e.largRef * (ctx.marcacoes && ctx.marcacoes.espelhado ? -1 : 1) : NaN;
      if (ler && Number.isFinite(desvPct) && !e.incerto) empurrar(e.hist, t, Number.isFinite(desvMm) ? desvMm : desvPct, 7200);
      const tend = inclinacao(e.hist.filter(([tt]) => tt >= t - p.janelaTend)) * 60;
      passoLimites(al, `${it.nome} desvio`, e.incerto ? NaN : Math.abs(desvPct), limitesDoTexto(p.limites), 0.5, p, t, '% da largura');
      if (p.tendMax > 0) al.passo(`${it.nome} tendência`, { prio: 3, texto: `${it.nome}: correia migrando mais que ${p.tendMax} mm/min`, atrasoOn: p.atrasoOn, atrasoOff: p.atrasoOff },
        Number.isFinite(tend) && Math.abs(tend) > p.tendMax, !Number.isFinite(tend) || Math.abs(tend) < p.tendMax * 0.8, tend, t);
      const lado = !Number.isFinite(desvMm) ? '' : desvMm > 0 ? (vert ? '→ direita' : '↓') : desvMm < 0 ? (vert ? '← esquerda' : '↑') : '';
      out.push({ id: it.id, nome: it.nome, desvioMm: desvMm, desvioPct: desvPct, larguraPx: e.largPx, mmPorPx: mmPx, tendencia: tend, lado,
                 aprendendo: !Number.isFinite(e.ref), n: e.amostras.length, refQuadros: p.refQuadros, incerto: Boolean(e.incerto), hist: e.hist.slice(-900),
                 unidade: Number.isFinite(desvMm) ? 'mm' : '%' });
      ctx.metrics[it.nome] = Number.isFinite(e.ref) ? `${fmtN(desvMm, 1)} mm (${fmtN(desvPct, 1)}%) ${lado}` : 'referência…';
      const c = it.caixa;
      const r = roiDe(it, src);
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor(al, it.nome + ' '),
                         label: Number.isFinite(e.ref) ? `${it.nome}: ${fmtN(desvMm, 1)} mm ${lado} · ${fmtN(tend, 1)} mm/min` : `${it.nome}: referência ${e.amostras.length}/${p.refQuadros}` });
      const lin = (pos, corL, larg) => ctx.overlay.push(vert ? { type: 'line', x1: pos, y1: r.y, x2: pos, y2: r.y + r.h, color: corL, width: larg }
                                                              : { type: 'line', x1: r.x, y1: pos, x2: r.x + r.w, y2: pos, color: corL, width: larg });
      if (e.b) { lin(e.b.e, '#38bdf8', 2); lin(e.b.d, '#38bdf8', 2); lin(e.b.centro, '#FFD84D', 2); }
      if (Number.isFinite(e.ref)) lin(e.ref, '#a78bfa', 1.5);
    }
    al.limpar(t, 3600);
    publicar('r.correia', { itens: out, alarmes: al.resumo(), relogio });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 58 cor de chama / forno

export const chama = {
  op: 'processo.cor_chama',
  label: 'Cor de chama / forno (ΔE2000)',
  group: G_CHAMA, overlayOnly: true,
  desc: 'Cor média da parte clara da área "Processo · chama/forno" em Lab: ΔE2000 contra a cor de referência (hex ou ' +
        '"Gravar referência" no painel), temperatura de cor correlata aproximada (McCamy) e a faixa por alarmes ' +
        'ISA-18.2 do ΔE. Exposição e balanço de branco da câmera FIXOS — automáticos mudam a cor medida.',
  params: {
    referencia: { type: 'text', default: '', max: 9, label: 'Cor de referência (#rrggbb; vazio = 1ª leitura ou "Gravar")' },
    pClaro: { type: 'float', min: 0, max: 0.98, step: 0.05, default: 0.5, label: 'Usar só os pixels acima do percentil de luz' },
    limites: { type: 'text', default: 'H 6; HH 12', max: 80, label: 'Alarmes de ΔE2000 (faixa)' },
    ...ALARMES_PARAMS,
    intervalo: { type: 'int', min: 0, max: 10000, step: 50, default: 250, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 640, label: 'Largura de análise (px)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.chama', state) || !state.m) { state.m = new Map(); state.tLer = 0; }
    const al = motores.chama;
    const cmds = tomarComandos('r.chama');
    for (const c of cmds) if (c.acao === 'reconhecer') al.reconhecer(null, tempoDe(ctx).t);
    const itens = marcas(ctx, 'chama');
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Cor de chama: desenhe a área "Processo · chama/forno"' });
      publicar('r.chama', { itens: [], alarmes: al.resumo() });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const agora = performance.now();
    const ler = !ctx.fonteParada && agora - state.tLer >= p.intervalo;
    let img = src;
    if (ler) { state.tLer = agora; img = imagemAnalise(ctx, src, p.largura).img; }
    const refHex = hexRgb(p.referencia);
    const out = [];
    for (const it of itens) {
      let e = state.m.get(it.id);
      if (!e) state.m.set(it.id, (e = { hist: [], c: null, ref: null }));
      if (ler) {
        const c = corRegiao(img, roiDe(it, img), { pClaro: p.pClaro, mascara: mascaraDe(it, img) });
        if (c) e.c = c;
      }
      for (const c of cmds) if (c.acao === 'gravar' && e.c && (!c.id || c.id === it.id)) e.ref = { lab: e.c.lab, rgb: e.c.rgb };
      if (refHex) e.ref = { lab: labDeRgb(...refHex), rgb: refHex };
      else if (!e.ref && e.c) e.ref = { lab: e.c.lab, rgb: e.c.rgb };
      const de = e.c && e.ref ? deltaE2000(e.c.lab, e.ref.lab) : NaN;
      if (ler && Number.isFinite(de)) empurrar(e.hist, t, de);
      passoLimites(al, `${it.nome} ΔE`, de, limitesDoTexto(p.limites), 0.3, p, t, '');
      out.push({ id: it.id, nome: it.nome, lab: e.c && e.c.lab, rgb: e.c && e.c.rgb, cct: e.c ? e.c.cct : NaN, de, ref: e.ref, hist: e.hist.slice(-600) });
      ctx.metrics[it.nome] = `ΔE ${fmtN(de, 1)} · ${e.c ? Math.round(e.c.cct) : '—'} K`;
      const c = it.caixa;
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor(al, it.nome + ' '),
                         label: `${it.nome}: ΔE ${fmtN(de, 1)}${e.c && Number.isFinite(e.c.cct) ? ` · ~${Math.round(e.c.cct / 10) * 10} K` : ''}` });
    }
    al.limpar(t, 3600);
    publicar('r.chama', { itens: out, alarmes: al.resumo(), relogio });
    return clone(src);
  },
};

// ------------------------------------------------------------------ 61 Ringelmann

export const ringelmann = {
  op: 'ambiente.ringelmann',
  label: 'Opacidade de fumaça (Ringelmann, indicativo)',
  group: G_FUMACA, overlayOnly: true,
  desc: 'Opacidade aparente da pluma escura contra o céu: área "Fumaça · pluma" logo acima da saída da chaminé e área ' +
        '"Fumaça · céu" ao lado, na mesma altura. Luminância linear, opacidade = 1 − pluma/céu e Ringelmann = 5 × ' +
        'opacidade; % do tempo acima do limite e alarme ISA-18.2. ' + AVISO_RINGELMANN,
  params: {
    yFumaca: { type: 'float', min: 0, max: 0.5, step: 0.01, default: 0, label: 'Luminância da fumaça opaca (0 = preta)' },
    limite: { type: 'float', min: 0.5, max: 5, step: 0.5, default: 2, label: 'Limite (nº de Ringelmann)' },
    janela: { type: 'int', min: 60, max: 86400, step: 60, default: 3600, label: 'Janela da % do tempo (s)' },
    ...ALARMES_PARAMS,
    intervalo: { type: 'int', min: 0, max: 10000, step: 100, default: 500, label: 'Ler a cada (ms)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('r.fumaca', state) || !state.hist) { state.hist = []; state.tLer = 0; state.ult = null; }
    const al = motores.fumaca;
    for (const c of tomarComandos('r.fumaca')) if (c.acao === 'reconhecer') al.reconhecer(null, tempoDe(ctx).t);
    const pl = marcas(ctx, 'fumaca_pluma')[0], ceu = marcas(ctx, 'fumaca_ceu')[0];
    const { w, h } = ctx;
    ctx.overlay.push({ type: 'banner', x: 8, y: h - 28, color: '#F2A900', text: 'Ringelmann por câmera: INDICATIVO, não é laudo ambiental' });
    if (!pl || !ceu) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Fumaça: desenhe as áreas "Fumaça · pluma" (acima da chaminé) e "Fumaça · céu" (ao lado)' });
      publicar('r.fumaca', { sem: true, alarmes: al.resumo(), aviso: AVISO_RINGELMANN });
      return clone(src);
    }
    const { t, relogio } = tempoDe(ctx);
    const agora = performance.now();
    if (!ctx.fonteParada && agora - state.tLer >= p.intervalo) {
      state.tLer = agora;
      const yp = yMediana(src, roiDe(pl, src), mascaraDe(pl, src)), yc = yMediana(src, roiDe(ceu, src), mascaraDe(ceu, src));
      state.ult = { ...opacidadeFumaca(yp, yc, p.yFumaca), yp, yc };
      if (state.ult.valido) empurrar(state.hist, t, state.ult.ringelmann, 20000);
    }
    const u = state.ult;
    const N = u && u.valido ? u.ringelmann : NaN;
    al.passo('FUMAÇA Ringelmann', { prio: 2, texto: `Opacidade acima de Ringelmann ${String(p.limite).replace('.', ',')} (${p.limite * 20}%)`, atrasoOn: p.atrasoOn, atrasoOff: p.atrasoOff },
      Number.isFinite(N) && N > p.limite, !Number.isFinite(N) || N < p.limite - 0.25, N, t);
    // % do tempo acima do limite na janela (cada leitura vale o intervalo até a próxima)
    const H = state.hist.filter(([tt]) => tt >= t - p.janela);
    let acima = 0, total = 0;
    for (let i = 0; i < H.length; i++) { const dt = i + 1 < H.length ? H[i + 1][0] - H[i][0] : 0; total += dt; if (H[i][1] > p.limite) acima += dt; }
    const c = pl.caixa, cc = ceu.caixa;
    ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor(al, 'FUMAÇA'),
                       label: u && u.valido ? `Ringelmann ${fmtN(N, 1)} (${fmtN(u.opacidade * 100, 0)}%)` : u ? u.motivo : '…' });
    ctx.overlay.push({ type: 'rect', x: cc.x1 * w, y: cc.y1 * h, w: (cc.x2 - cc.x1) * w, h: (cc.y2 - cc.y1) * h, color: '#38bdf8', label: 'céu (referência)' });
    ctx.metrics['Ringelmann'] = Number.isFinite(N) ? `${fmtN(N, 1)} (${fmtN(u.opacidade * 100, 0)}%)` : (u && u.motivo) || '—';
    al.limpar(t, 3600);
    publicar('r.fumaca', { ult: u, ringelmann: N, hist: state.hist.slice(-1200), pctAcima: total > 0 ? (100 * acima) / total : NaN, limite: p.limite,
                           janela: p.janela, alarmes: al.resumo(), aviso: AVISO_RINGELMANN, relogio });
    return clone(src);
  },
};

export default [nivel, gotejamento, correia, chama, ringelmann];
