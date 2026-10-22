/**
 * cv/operators/livres-s/medidor.js — CV-65 Leitura de hidrômetro e medidores (98).
 *
 *   medidor.leitura  área "Medidor · leitura" sobre os números do medidor:
 *                    OCR PT-BR (rolos do hidrômetro, medidor de gás, contador
 *                    mecânico) ou 7 segmentos (medidor eletrônico), pelo MESMO
 *                    leitor do instrumento.display7 (CV-42, importado sem
 *                    alterar o operador). Medidor acumulador só sobe: leitura
 *                    fora da sequência é rejeitada; consumo e vazão média,
 *                    histórico e CSV no painel Medições.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao } from '../../runtime/livres-oa/canal.js';
import { lerDisplay7 } from '../../runtime/livres-oa/nucleo.js';
import { numeroDosTextos, FiltroAcumulador } from '../../runtime/livres-s/medidor.js';
import { passoTempo, fmtBR } from '../../runtime/livres-s/comum.js';
import { recorte } from './varejo.js';

export const G_MEDIDOR = 'CV-65';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
export const FUNCAO_MEDIDOR = 'medidor';

let modelosN = null;
const carregarModelosN = () => (modelosN || (modelosN = import('../../runtime/livres-n/modelos.js')));

export const medidor = {
  op: 'medidor.leitura',
  label: 'Leitura de hidrômetro / medidor',
  group: G_MEDIDOR, overlayOnly: true,
  desc: 'Lê o número do medidor dentro da área "Medidor · leitura" — OCR (rolos do hidrômetro, gás, contador ' +
        'mecânico) ou 7 segmentos (eletrônico, o leitor do CV-42) — com dígitos e casas decimais fixos ' +
        '(hidrômetro: 8 dígitos, 3 decimais em m³). Só aceita leitura que sobe e se repete; consumo, vazão média, ' +
        'histórico e CSV no Medições.',
  params: {
    modo: { type: 'enum', options: ['OCR (rolos/números)', '7 segmentos'], default: 'OCR (rolos/números)', label: 'Leitor' },
    digitos: { type: 'int', min: 0, max: 12, step: 1, default: 8, label: 'Dígitos no mostrador (0 = qualquer)' },
    decimais: { type: 'int', min: 0, max: 6, step: 1, default: 3, label: 'Casas decimais (rolos vermelhos)' },
    unidade: { type: 'text', default: 'm³', max: 12, label: 'Unidade' },
    maxPorHora: { type: 'float', min: 0, max: 1000000, step: 0.1, default: 10, label: 'Consumo máximo plausível (unid./h; 0 = sem)' },
    confirmar: { type: 'int', min: 1, max: 10, step: 1, default: 2, label: 'Leituras iguais para aceitar' },
    polaridade: { type: 'enum', options: ['auto', 'claro', 'escuro'], default: 'auto', label: '7 seg.: segmento aceso é' },
    inclinacao: { type: 'float', min: -20, max: 20, step: 0.5, default: 0, label: '7 seg.: inclinação (°)' },
    intervalo: { type: 'int', min: 200, max: 600000, step: 100, default: 3000, label: 'Ler a cada (ms)' },
    largura: { type: 'int', min: 640, max: 3840, step: 160, default: 1920, label: 'Largura de leitura (px)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar a leitura' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('medidor', state) || !state.m) { state.m = new Map(); state.tLer = 0; state.busy = false; }
    const { t, relogio } = passoTempo(state, ctx, Infinity);
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const itens = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_MEDIDOR && AREAS.has(i.tipo)) : [];
    if (!itens.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Medidor: desenhe uma área com a função "Medidor · leitura" justa sobre os números' });
      publicar('medidor', { itens: [] });
      return clone(src);
    }
    const filtroDe = (it) => {
      let e = state.m.get(it.id);
      const cfg = `${p.confirmar}|${p.maxPorHora}`;
      if (!e || e.cfg !== cfg) {
        const f = new FiltroAcumulador({ confirmar: p.confirmar, maxPorHora: p.maxPorHora > 0 ? p.maxPorHora : Infinity });
        if (e && e.f) { f.ult = e.f.ult; f.inicio = e.f.inicio; f.hist = e.f.hist; }
        state.m.set(it.id, (e = { f, cfg, bruto: '', motivo: '' }));
      }
      return e;
    };
    const agora = performance.now();
    if (!ctx.fonteParada && !state.busy && agora - state.tLer >= p.intervalo) {
      state.tLer = agora;
      const full = ctx.grabFull ? ctx.grabFull(p.largura) : null;
      const img = full && full.width >= src.width ? full : src;
      if (p.modo === '7 segmentos') {
        for (const it of itens) {
          const c = it.caixa, e = filtroDe(it);
          const r = lerDisplay7(img, { x: c.x1 * img.width, y: c.y1 * img.height, w: (c.x2 - c.x1) * img.width, h: (c.y2 - c.y1) * img.height },
            { polaridade: p.polaridade, inclinacao: p.inclinacao });
          const n = numeroDosTextos(r.ok ? [{ text: r.texto.replace(/[.-]/g, ''), x1: 0 }] : [], { digitos: p.digitos, decimais: p.decimais });
          e.bruto = r.texto; const a = e.f.passo(n.valor, t); e.motivo = a.motivo;
        }
      } else {
        state.busy = true;
        const regs = itens.map((it) => { const c = it.caixa; return { it, im: recorte(img, c.x1 * img.width, c.y1 * img.height, (c.x2 - c.x1) * img.width, (c.y2 - c.y1) * img.height) }; });
        (async () => {
          const M = await carregarModelosN();
          for (const r of regs) {
            const ls = await M.lerTexto(r.im);
            const e = filtroDe(r.it);
            const n = numeroDosTextos(ls.map((l) => ({ text: l.text, x1: Math.min(...l.poly.map((q) => q[0])) })), { digitos: p.digitos, decimais: p.decimais });
            e.bruto = ls.map((l) => l.text).join(' '); const a = e.f.passo(n.valor, t); e.motivo = a.motivo;
          }
        })().catch((err) => { state.erro = String(err.message || err); }).finally(() => { state.busy = false; });
      }
    }
    const out = [];
    for (const it of itens) {
      const e = filtroDe(it);
      const f = e.f, c = f.consumo();
      const v = f.ult ? f.ult.v : NaN;
      const casas = p.decimais;
      out.push({ id: it.id, nome: it.nome, valor: v, unidade: p.unidade, casas, bruto: e.bruto, motivo: e.motivo, rejeitadas: f.rejeitadas,
        consumo: c.consumo, porHora: c.porHora, horas: c.horas, hist: f.hist.slice(-600), relogio });
      ctx.metrics[it.nome] = Number.isFinite(v) ? `${fmtBR(v, casas)} ${p.unidade}` : `— (${e.bruto || 'sem leitura'})`;
      if (p.desenhar) {
        const cx = it.caixa;
        ctx.overlay.push({ type: 'rect', x: cx.x1 * w, y: cx.y1 * h, w: (cx.x2 - cx.x1) * w, h: (cx.y2 - cx.y1) * h, color: Number.isFinite(v) ? '#4ade80' : '#F2A900',
          label: `${it.nome}: ${Number.isFinite(v) ? fmtBR(v, casas) + ' ' + p.unidade : '?'}${c.porHora != null ? ` · ${fmtBR(c.porHora, 3)} ${p.unidade}/h` : ''}` });
      }
    }
    if (state.erro) ctx.metrics['medidor erro'] = state.erro;
    publicar('medidor', { itens: out, lendo: state.busy });
    return clone(src);
  },
};

export default [medidor];
