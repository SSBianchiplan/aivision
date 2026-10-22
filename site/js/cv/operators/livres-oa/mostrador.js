/**
 * cv/operators/livres-oa/mostrador.js — CV-42 Leitura de instrumentos.
 *
 *   instrumento.mostrador  manômetro, termômetro de mostrador, vacuômetro:
 *                          o usuário marca com o mouse um ÂNGULO de 3 pontos
 *                          (zero → centro → fundo de escala) com a função
 *                          "Instrumento · mostrador"; a agulha sai por
 *                          gradiente + votação de Hough restrita às retas que
 *                          passam pelo centro (runtime/livres-oa/nucleo.js).
 *                          Valor linear, mediana de 5 leituras, histórico e
 *                          alarmes ISA-18.2 (LL/L/H/HH com banda morta e atrasos,
 *                          como o BeltScan).
 *   instrumento.display7   display de 7 segmentos (balança, controlador, painel
 *                          de máquina) numa área "Instrumento · display 7 seg.".
 *
 * A faixa do mostrador pode vir no NOME da marcação ("Pressão 0-10 bar",
 * "Temp. -20 a 120 °C"); sem isso valem Mínimo/Máximo/Unidade do operador.
 * JS puro, sem modelo; nada sai do navegador.
 */
import { clone } from '../../core.js';
import { lerAgulha, geometriaMostrador, valorDoAngulo, lerDisplay7, mod2pi } from '../../runtime/livres-oa/nucleo.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { Alarmes, COR_PRIO } from '../../runtime/livres-oa/alarmes.js';

export const G_INSTR = 'CV-42';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);

const num = (s) => Number(String(s).replace(',', '.'));

/** "Pressão 0-10 bar" → { min: 0, max: 10, unidade: 'bar' } (ou null). */
export function faixaDoNome(nome) {
  const m = /(-?\d+(?:[.,]\d+)?)\s*(?:-|–|a|até|\.\.)\s*(-?\d+(?:[.,]\d+)?)\s*([^\d\s][^\d]*)?$/i.exec(String(nome || ''));
  if (!m) return null;
  const min = num(m[1]), max = num(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  return { min, max, unidade: (m[3] || '').trim() };
}

/** "HH 9; H 8; L 1; LL 0,5" → [{ nivel, limiar }]. */
export function limitesDoTexto(s) {
  const out = [];
  for (const parte of String(s || '').split(/[;\n]/)) {
    const m = /^\s*(HH|H|LL|L)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)\s*$/i.exec(parte);
    if (m) out.push({ nivel: m[1].toUpperCase(), limiar: num(m[2]) });
  }
  return out;
}

const PRIO_NIVEL = { HH: 1, LL: 1, H: 2, L: 2 };

/** Passo dos alarmes de limite de uma variável (alto: v > lim; baixo: v < lim; banda morta para normalizar). */
function passoLimites(alarmes, nome, v, limites, banda, p, t, unidade) {
  for (const L of limites) {
    const alto = L.nivel[0] === 'H';
    const ok = Number.isFinite(v);
    const bruto = ok && (alto ? v > L.limiar : v < L.limiar);
    const normalOk = !ok || (alto ? v < L.limiar - banda : v > L.limiar + banda);
    alarmes.passo(`${nome} ${L.nivel}`, { prio: PRIO_NIVEL[L.nivel], texto: `${nome}: ${alto ? 'acima' : 'abaixo'} de ${L.limiar} ${unidade}`.trim(),
      atrasoOn: p.atrasoOn, atrasoOff: p.atrasoOff }, bruto, normalOk, v, t);
  }
}

function mediana(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

const ALARMES_PARAMS = {
  limites: { type: 'text', default: '', max: 120, label: 'Alarmes (ex.: HH 9; H 8; L 1; LL 0,5)' },
  bandaPct: { type: 'float', min: 0, max: 20, step: 0.5, default: 1, label: 'Banda morta (% da escala)' },
  atrasoOn: { type: 'float', min: 0, max: 600, step: 0.5, default: 2, label: 'Atraso para ativar (s)' },
  atrasoOff: { type: 'float', min: 0, max: 600, step: 0.5, default: 2, label: 'Atraso para normalizar (s)' },
};

/** Reusa o motor de alarmes entre os dois operadores (uma lista só no painel). */
const alarmesInstr = new Alarmes();
export function alarmesInstrumentos() { return alarmesInstr; }

export const mostrador = {
  op: 'instrumento.mostrador',
  label: 'Leitor de mostrador analógico (agulha)',
  group: G_INSTR, overlayOnly: true,
  desc: 'Lê a agulha de manômetros e outros mostradores: marque com a ferramenta Ângulo (3 pontos) o ZERO, o CENTRO ' +
        'e o FUNDO DE ESCALA, com a função "Instrumento · mostrador". Valor, histórico e alarmes ISA-18.2 de faixa. ' +
        'A faixa pode vir no nome da marcação ("Pressão 0-10 bar").',
  params: {
    min: { type: 'float', min: -100000, max: 100000, step: 0.1, default: 0, label: 'Mínimo da escala (zero)' },
    max: { type: 'float', min: -100000, max: 100000, step: 0.1, default: 10, label: 'Máximo da escala (fundo)' },
    unidade: { type: 'text', default: 'bar', max: 12, label: 'Unidade' },
    sentido: { type: 'enum', options: ['horário', 'anti-horário'], default: 'horário', label: 'Sentido do zero ao fundo' },
    r0: { type: 'float', min: 0.05, max: 0.6, step: 0.05, default: 0.15, label: 'Busca a partir de (fração do raio)' },
    r1: { type: 'float', min: 0.3, max: 0.95, step: 0.05, default: 0.75, label: 'Busca até (fração do raio; antes dos traços)' },
    confMin: { type: 'float', min: 1, max: 10, step: 0.25, default: 2.5, label: 'Nitidez mínima do pico' },
    intervalo: { type: 'int', min: 0, max: 5000, step: 50, default: 200, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 960, label: 'Largura de análise (px)' },
    ...ALARMES_PARAMS,
    desenhar: { type: 'bool', default: true, label: 'Desenhar a agulha lida' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('mostrador', state) || !state.m) { state.m = new Map(); state.tLer = 0; }
    const mq = ctx.marcacoes;
    const itens = mq ? mq.itens.filter((i) => i.funcao === 'mostrador' && i.tipo === 'angulo' && i.px && i.px.length >= 3) : [];
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Mostrador: marque ZERO → CENTRO → FUNDO com a ferramenta Ângulo e a função "Instrumento · mostrador"' });
      ctx.metrics['mostrador'] = 'sem marcação';
      publicar('mostrador', { itens: [], alarmes: alarmesInstr.resumo() });
      return clone(src);
    }
    const { t } = tempoDe(ctx);
    const agora = performance.now();
    const ler = !ctx.fonteParada && agora - state.tLer >= p.intervalo;
    let img = src, k = 1;
    if (ler) {
      state.tLer = agora;
      const full = ctx.grabFull ? ctx.grabFull(p.largura) : null;
      if (full && full.width >= src.width) { img = full; k = full.width / src.width; }
    }
    const lim = limitesDoTexto(p.limites);
    const out = [];
    for (const it of itens) {
      const fx = faixaDoNome(it.nome) || { min: p.min, max: p.max, unidade: p.unidade };
      let e = state.m.get(it.id);
      if (!e) state.m.set(it.id, (e = { ult: [], valor: NaN, conf: 0, fora: 0, ang: null, hist: [] }));
      const [z, c, f] = it.px;
      const geo = geometriaMostrador(z, c, f, p.sentido);
      if (ler) {
        const geoK = { ...geo, c: [c[0] * k, c[1] * k] };
        const faixa = { de: geo.a0, varre: geo.varre, sinal: geo.sinal, margem: geo.margem };
        const r = lerAgulha(img, geoK.c, geo.R * k, faixa, { r0: p.r0, r1: p.r1 });
        if (r && r.conf >= p.confMin) {
          const v = valorDoAngulo(r.ang, geo, fx.min, fx.max);
          e.ult.push(v.valor); if (e.ult.length > 5) e.ult.shift();
          e.valor = mediana(e.ult); e.conf = r.conf; e.fora = v.fora; e.ang = r.ang; e.incerto = false;
          e.hist.push([t, e.valor]); if (e.hist.length > 3600) e.hist.shift();
        } else { e.incerto = true; e.conf = r ? r.conf : 0; }
      }
      const banda = (Math.abs(fx.max - fx.min) * p.bandaPct) / 100;
      passoLimites(alarmesInstr, it.nome, e.incerto ? NaN : e.valor, lim, banda, p, t, fx.unidade);
      const casas = Math.abs(fx.max - fx.min) <= 20 ? 2 : Math.abs(fx.max - fx.min) <= 200 ? 1 : 0;
      const txt = Number.isFinite(e.valor) ? `${e.valor.toFixed(casas).replace('.', ',')} ${fx.unidade}` : '—';
      out.push({ id: it.id, nome: it.nome, valor: e.valor, unidade: fx.unidade, min: fx.min, max: fx.max, conf: e.conf,
                 fora: e.fora, incerto: Boolean(e.incerto), casas, hist: e.hist.slice(-600), tipo: 'mostrador' });
      ctx.metrics[it.nome] = e.incerto ? `${txt} (incerto)` : txt;
      if (p.desenhar) {
        const L = geo.R * 0.9;
        if (e.ang != null) {
          ctx.overlay.push({ type: 'line', x1: c[0], y1: c[1], x2: c[0] + Math.cos(e.ang) * L, y2: c[1] + Math.sin(e.ang) * L,
                             color: e.incerto ? '#F2A900' : '#4ade80', width: 3 });
        }
        // arco da escala (pontilhado em segmentos)
        for (let s = 0; s < 24; s++) {
          const a1 = geo.a0 + geo.sinal * (geo.varre * s) / 24, a2 = geo.a0 + geo.sinal * (geo.varre * (s + 0.5)) / 24;
          ctx.overlay.push({ type: 'line', x1: c[0] + Math.cos(a1) * geo.R, y1: c[1] + Math.sin(a1) * geo.R,
                             x2: c[0] + Math.cos(a2) * geo.R, y2: c[1] + Math.sin(a2) * geo.R, color: '#38bdf8', width: 1.5 });
        }
        const prio = alarmesInstr.pendentes().filter((a) => a.tag.startsWith(it.nome + ' ') && /ATIVO/.test(a.estado)).reduce((m, a) => Math.min(m, a.prio), 9);
        ctx.overlay.push({ type: 'rect', x: c[0] - geo.R, y: c[1] - geo.R, w: 2 * geo.R, h: 2 * geo.R,
                           color: COR_PRIO[prio] || '#4ade80', label: `${it.nome}: ${txt}${e.fora > 0 ? ' (acima do fundo)' : e.fora < 0 ? ' (abaixo do zero)' : ''}` });
      }
    }
    alarmesInstr.limpar(t, 3600);
    publicar('mostrador', { itens: out, alarmes: alarmesInstr.resumo() });
    return clone(src);
  },
};

export const display7 = {
  op: 'instrumento.display7',
  label: 'Leitor de display de 7 segmentos',
  group: G_INSTR, overlayOnly: true,
  desc: 'Lê o número de um display de 7 segmentos (balança, controlador, painel) dentro de uma área com a função ' +
        '"Instrumento · display 7 seg.". Otsu, separação por colunas e as 7 janelas de cada dígito; ponto decimal e sinal. ' +
        'Histórico e alarmes ISA-18.2 como o mostrador.',
  params: {
    polaridade: { type: 'enum', options: ['auto', 'claro', 'escuro'], default: 'auto', label: 'Segmento aceso é' },
    inclinacao: { type: 'float', min: -20, max: 20, step: 0.5, default: 0, label: 'Inclinação dos dígitos (°, itálico)' },
    casasFixas: { type: 'int', min: -1, max: 4, step: 1, default: -1, label: 'Casas decimais fixas (−1 = pelo ponto)' },
    unidade: { type: 'text', default: '', max: 12, label: 'Unidade' },
    intervalo: { type: 'int', min: 0, max: 5000, step: 50, default: 300, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 960, label: 'Largura de análise (px)' },
    ...ALARMES_PARAMS,
    desenhar: { type: 'bool', default: true, label: 'Desenhar a leitura' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('display7', state) || !state.m) { state.m = new Map(); state.tLer = 0; }
    const mq = ctx.marcacoes;
    const itens = mq ? mq.itens.filter((i) => i.funcao === 'display7' && AREAS.has(i.tipo) && i.caixa) : [];
    const { w, h } = ctx;
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Display: desenhe uma área com a função "Instrumento · display 7 seg." sobre os dígitos' });
      publicar('display7', { itens: [] });
      return clone(src);
    }
    const { t } = tempoDe(ctx);
    const agora = performance.now();
    const ler = !ctx.fonteParada && agora - state.tLer >= p.intervalo;
    let img = src;
    if (ler) {
      state.tLer = agora;
      const full = ctx.grabFull ? ctx.grabFull(p.largura) : null;
      if (full && full.width >= src.width) img = full;
    }
    const lim = limitesDoTexto(p.limites);
    const out = [];
    for (const it of itens) {
      let e = state.m.get(it.id);
      if (!e) state.m.set(it.id, (e = { texto: '', valor: NaN, hist: [], ult: [] }));
      if (ler) {
        const c = it.caixa;
        const roi = { x: c.x1 * img.width, y: c.y1 * img.height, w: (c.x2 - c.x1) * img.width, h: (c.y2 - c.y1) * img.height };
        const r = lerDisplay7(img, roi, { polaridade: p.polaridade, inclinacao: p.inclinacao });
        e.bruto = r.texto;
        let v = NaN;
        if (r.ok) {
          let s = r.texto.replace(/(?!^)-/g, '');
          if (p.casasFixas >= 0) { const dig = s.replace(/[^\d-]/g, ''); v = Number(dig) / 10 ** p.casasFixas; } else v = Number(s);
        }
        // duas leituras iguais seguidas para aceitar (um dígito trocando no meio do quadro)
        if (Number.isFinite(v)) {
          e.ult.push(v); if (e.ult.length > 2) e.ult.shift();
          if (e.ult.length === 2 && e.ult[0] === e.ult[1]) { e.valor = v; e.texto = r.texto; e.hist.push([t, v]); if (e.hist.length > 3600) e.hist.shift(); }
          e.incerto = false;
        } else e.incerto = true;
      }
      passoLimites(alarmesInstr, it.nome, e.incerto ? NaN : e.valor, lim, Math.abs(e.valor || 1) * p.bandaPct / 100, p, t, p.unidade);
      out.push({ id: it.id, nome: it.nome, valor: e.valor, texto: e.texto, bruto: e.bruto, unidade: p.unidade, incerto: Boolean(e.incerto),
                 hist: e.hist.slice(-600), tipo: 'display7' });
      ctx.metrics[it.nome] = Number.isFinite(e.valor) ? `${String(e.valor).replace('.', ',')} ${p.unidade}` : `— (${e.bruto || 'sem leitura'})`;
      if (p.desenhar) {
        const c = it.caixa;
        ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: e.incerto ? '#F2A900' : '#4ade80',
                           label: `${it.nome}: ${Number.isFinite(e.valor) ? String(e.valor).replace('.', ',') : '?'} ${p.unidade}` });
      }
    }
    publicar('display7', { itens: out, alarmes: alarmesInstr.resumo() });
    return clone(src);
  },
};

export { mod2pi };
export default [mostrador, display7];
