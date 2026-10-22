/**
 * cv/operators/livres-s/varejo.js — CV-62 Varejo: gôndola e vitrine.
 *
 *   varejo.preco        Auditoria de preço (V3): OCR da etiqueta de gôndola
 *                       (PP-OCRv5 do CV-17) + EAN (leitor do CV-10) → etiquetas
 *                       → conferência com a TABELA CSV importada no painel
 *                       Medições (código/descrição/preço) → divergências.
 *                       Lê nas áreas "Varejo · faixa de etiquetas" em resolução
 *                       plena; sem área, usa os textos/códigos da cadeia
 *                       (ocr.ptbr e code.scan antes dele).
 *   varejo.planograma   Vitrine × planograma (74): a área "Varejo · planograma"
 *                       vira uma grade linhas × colunas; cada célula é comparada
 *                       (cosseno do MobileCLIP2) com a da REFERÊNCIA capturada
 *                       (a vitrine certa); célula diferente vira "trocado" ou,
 *                       pelo texto, "vazio (ruptura)".
 *
 * Nada sai do navegador: a tabela e os vetores da referência ficam no
 * localStorage (só números, nenhuma imagem).
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, geracao } from '../../runtime/livres-oa/canal.js';
import { ensure } from '../../runtime/opkit.js';
import { agruparEtiquetas, conferir, tabelaPrecos, palavras, ROTULO_STATUS } from '../../runtime/livres-s/precos.js';
import { VIS, TXT, dadosRecorte, vetorImagem, vetorTexto, cosseno, probabilidades } from '../../runtime/livres-s/clip.js';
import { passoTempo, fmtBR } from '../../runtime/livres-s/comum.js';

export const G_VAREJO = 'CV-62';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
export const FUNCAO_GONDOLA = 'gondola_etiquetas';
export const FUNCAO_PLANOGRAMA = 'planograma';

/** Cópia de uma região {x,y,w,h} (px) de um ImageData. */
export function recorte(img, x, y, w, h) {
  x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
  w = Math.max(1, Math.min(img.width - x, Math.round(w))); h = Math.max(1, Math.min(img.height - y, Math.round(h)));
  const out = new ImageData(w, h);
  for (let j = 0; j < h; j++) out.data.set(img.data.subarray(((y + j) * img.width + x) * 4, ((y + j) * img.width + x + w) * 4), j * w * 4);
  return out;
}

let modelosN = null;
const carregarModelosN = () => (modelosN || (modelosN = import('../../runtime/livres-n/modelos.js')));

const COR_STATUS = { ok: '#4ade80', divergente: '#FF4D4D', nao_cadastrado: '#F2A900' };

// ======================================================================= preço

export const preco = {
  op: 'varejo.preco',
  label: 'Auditoria de preço (etiqueta × tabela)',
  group: G_VAREJO, overlayOnly: true,
  desc: 'Lê o preço, a descrição e o EAN de cada etiqueta de gôndola (OCR PT-BR + leitor de códigos) e confere com a ' +
        'tabela CSV do sistema importada no painel Medições (código; descrição; preço). Lista as divergências com ' +
        'CSV. Desenhe áreas "Varejo · faixa de etiquetas" sobre a borda das prateleiras (lê em resolução plena) — ou ' +
        'ponha OCR PT-BR e Códigos antes.',
  params: {
    tolerancia: { type: 'float', min: 0, max: 5, step: 0.01, default: 0, label: 'Tolerância (R$)' },
    simMin: { type: 'float', min: 0.2, max: 1, step: 0.05, default: 0.5, label: 'Semelhança mínima da descrição' },
    raio: { type: 'float', min: 2, max: 20, step: 0.5, default: 6, label: 'Raio da etiqueta (alturas do preço)' },
    intervalo: { type: 'int', min: 300, max: 20000, step: 100, default: 2500, label: 'Ler as áreas a cada (ms)' },
    largura: { type: 'int', min: 640, max: 3840, step: 160, default: 1920, label: 'Largura de leitura das áreas (px)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar as etiquetas' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('precos', state) || !state.lidas) { state.lidas = new Map(); state.atuais = []; state.busy = false; state.tLer = 0; }
    const { t } = passoTempo(state, ctx);
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const areas = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_GONDOLA && AREAS.has(i.tipo)) : [];
    const tab = tabelaPrecos();
    const aspecto = w / h;
    const processar = (textos, codigos) => {
      const ets = agruparEtiquetas(textos, codigos, aspecto, { raio: p.raio });
      state.atuais = ets.map((e) => {
        const c = conferir(e, tab.itens, { tolerancia: p.tolerancia + 0.005, simMin: p.simMin });
        const chave = e.codigo || `${palavras(e.descricao).join(' ')}|${e.preco.toFixed(2)}`;
        let r = state.lidas.get(chave);
        if (!r) state.lidas.set(chave, (r = { chave, vezes: 0, primeira: t }));
        Object.assign(r, { preco: e.preco, codigo: e.codigo || (c.item && c.item.codigo) || '', descricao: e.descricao, status: c.status, por: c.por, sim: c.sim,
          precoTabela: c.item ? c.item.preco : null, descTabela: c.item ? c.item.descricao : '', diferenca: c.diferenca, ultima: t });
        r.vezes++;
        return { ...e, ...c, chave };
      });
      if (state.lidas.size > 3000) state.lidas.delete(state.lidas.keys().next().value);
    };
    if (areas.length) {
      const agora = performance.now();
      if (!state.busy && !ctx.fonteParada && agora - state.tLer >= p.intervalo) {
        state.tLer = agora; state.busy = true;
        const full = ctx.grabFull ? ctx.grabFull(p.largura) : null;
        const img = full && full.width >= src.width ? full : src;
        // regiões COPIADAS antes do primeiro await (o quadro do pipeline é reaproveitado)
        const regs = areas.map((a) => {
          const c = a.caixa;
          const x = c.x1 * img.width, y = c.y1 * img.height;
          return { x: x / img.width, y: y / img.height, sw: img.width, sh: img.height, im: recorte(img, x, y, (c.x2 - c.x1) * img.width, (c.y2 - c.y1) * img.height) };
        });
        (async () => {
          const M = await carregarModelosN();
          const textos = [], codigos = [];
          for (const r of regs) {
            const ls = await M.lerTexto(r.im);
            for (const l of ls) {
              const xs = l.poly.map((q) => q[0]), ys = l.poly.map((q) => q[1]);
              textos.push({ text: l.text, score: l.score, x1: r.x + Math.min(...xs) / r.sw, y1: r.y + Math.min(...ys) / r.sh, x2: r.x + Math.max(...xs) / r.sw, y2: r.y + Math.max(...ys) / r.sh });
            }
            try {
              for (const c of await M.lerCodigos(r.im)) {
                if (!c.pts || !c.pts.length) continue;
                const xs = c.pts.map((q) => q[0]), ys = c.pts.map((q) => q[1]);
                codigos.push({ text: c.text, format: c.format, box: { x: r.x + Math.min(...xs) / r.sw, y: r.y + Math.min(...ys) / r.sh, w: (Math.max(...xs) - Math.min(...xs)) / r.sw, h: (Math.max(...ys) - Math.min(...ys)) / r.sh } });
              }
            } catch (_) { /* leitor de códigos indisponível: segue só com o OCR */ }
          }
          state.ultTextos = textos.length;
          processar(textos, codigos);
        })().catch((e) => { state.erro = String(e.message || e); }).finally(() => { state.busy = false; });
      }
    } else if (Array.isArray(ctx.textos)) {
      const assin = ctx.textos.map((x) => x.text).join('|') + '#' + (Array.isArray(ctx.codigos) ? ctx.codigos.map((c) => c.text).join('|') : '');
      if (assin !== state.assin && !ctx.fonteParada) { state.assin = assin; processar(ctx.textos, ctx.codigos || []); }
    } else {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Preço: desenhe áreas "Varejo · faixa de etiquetas" (ou ponha OCR PT-BR antes)' });
    }
    if (!tab.itens.length) ctx.overlay.push({ type: 'banner', x: 8, y: 32, color: '#38bdf8', text: 'Preço: importe a tabela CSV (código; descrição; preço) no painel Medições' });
    if (p.desenhar) {
      for (const a of areas) { const c = a.caixa; ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: '#a78bfa' }); }
      for (const e of state.atuais) {
        const c = e.caixa;
        const txt = e.status === 'divergente' ? `R$ ${fmtBR(e.preco)} ≠ ${fmtBR(e.item.preco)}` : e.status === 'ok' ? `R$ ${fmtBR(e.preco)} ✓` : `R$ ${fmtBR(e.preco)} ?`;
        ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: COR_STATUS[e.status], label: txt });
      }
    }
    const lidas = [...state.lidas.values()];
    const cont = { ok: 0, divergente: 0, nao_cadastrado: 0 };
    for (const r of lidas) cont[r.status]++;
    ctx.metrics['etiquetas'] = `${lidas.length} · ${cont.divergente} divergente(s)`;
    if (state.erro) ctx.metrics['preço erro'] = state.erro;
    publicar('precos', { lidas, cont, tabela: { n: tab.itens.length, nome: tab.nome, quando: tab.quando }, lendo: state.busy, areas: areas.length });
    return clone(src);
  },
};

// ======================================================================= planograma

const CHAVE_REF = 'gplansis.planograma.ref';
function lerRefs() { try { return JSON.parse(localStorage.getItem(CHAVE_REF) || '{}') || {}; } catch (_) { return {}; } }
function gravarRefs(o) { try { localStorage.setItem(CHAVE_REF, JSON.stringify(o)); } catch (_) { /* cheio */ } }

/** Retângulos das células (0–1) de uma caixa em linhas × colunas, com margem interna `m` (fração da célula). */
export function celulas(caixa, linhas, colunas, m = 0.06) {
  const out = [];
  const cw = (caixa.x2 - caixa.x1) / colunas, ch = (caixa.y2 - caixa.y1) / linhas;
  for (let r = 0; r < linhas; r++) {
    for (let c = 0; c < colunas; c++) {
      out.push({ r, c, x1: caixa.x1 + (c + m) * cw, y1: caixa.y1 + (r + m) * ch, x2: caixa.x1 + (c + 1 - m) * cw, y2: caixa.y1 + (r + 1 - m) * ch });
    }
  }
  return out;
}

/**
 * Estado de uma célula a partir da similaridade com a referência e da
 * probabilidade de "vazio" (texto): 'ok' | 'trocado' | 'vazio'.
 */
export function estadoCelula(sim, pVazio, limiar = 0.8, pVazioMin = 0.6) {
  if (sim >= limiar) return 'ok';
  return pVazio != null && pVazio >= pVazioMin ? 'vazio' : 'trocado';
}

/** Maioria dos últimos votos (empate: o mais recente). */
export function maioria(votos) {
  const n = {};
  for (const v of votos) n[v] = (n[v] || 0) + 1;
  let best = votos[votos.length - 1], bn = 0;
  for (const [k, c] of Object.entries(n)) if (c > bn || (c === bn && k === votos[votos.length - 1])) { best = k; bn = c; }
  return best;
}

const COR_CEL = { ok: '#4ade80', trocado: '#F2A900', vazio: '#FF4D4D' };
export const ROTULO_CELULA = { ok: 'conforme', trocado: 'diferente da referência', vazio: 'vazio (ruptura)' };

export const planograma = {
  op: 'varejo.planograma',
  label: 'Vitrine × planograma (CLIP por célula)',
  group: G_VAREJO, model: VIS, needs: [TXT], overlayOnly: true,
  desc: 'Compara cada célula da grade marcada (área "Varejo · planograma", linhas × colunas) com a REFERÊNCIA (a ' +
        'vitrine/gôndola arrumada, capturada sozinha na 1ª leitura ou no painel Medições) pelo cosseno do MobileCLIP2: ' +
        'célula diferente vira "trocado" ou, pelo texto, "vazio (ruptura)". Conformidade por grade e CSV.',
  params: {
    linhas: { type: 'int', min: 1, max: 12, step: 1, default: 3, label: 'Linhas da grade' },
    colunas: { type: 'int', min: 1, max: 16, step: 1, default: 4, label: 'Colunas da grade' },
    limiar: { type: 'float', min: 0.5, max: 0.99, step: 0.01, default: 0.82, label: 'Similaridade mínima (cosseno)' },
    votos: { type: 'int', min: 1, max: 9, step: 1, default: 3, label: 'Leituras para confirmar' },
    vazioMin: { type: 'float', min: 0.5, max: 0.99, step: 0.01, default: 0.9, label: 'Prob. mínima para "vazio" (senão "trocado")' },
    textoVazio: { type: 'text', default: 'an empty store shelf', max: 120, label: 'Frase do vazio' },
    textoCheio: { type: 'text', default: 'products on a store shelf', max: 120, label: 'Frase do abastecido' },
    intervalo: { type: 'int', min: 200, max: 20000, step: 100, default: 1500, label: 'Ler a cada (ms)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar a grade' },
  },
  apply(src, p, state, ctx) {
    if (!ensure(VIS, state, ctx) || !ensure(TXT, state, ctx)) return clone(src);
    if (conferirGeracao('planograma', state) || !state.cel) { state.cel = new Map(); state.busy = false; state.tLer = 0; }
    const { t } = passoTempo(state, ctx);
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const grades = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_PLANOGRAMA && AREAS.has(i.tipo)) : [];
    if (!grades.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Planograma: desenhe a área da vitrine/gôndola com a função "Varejo · planograma"' });
      publicar('planograma', { grades: [] });
      return clone(src);
    }
    // frases do vazio/abastecido (uma vez)
    const chaveTxt = p.textoVazio + '|' + p.textoCheio;
    if (state.chaveTxt !== chaveTxt && !state.codTxt) {
      state.codTxt = true;
      (async () => [await vetorTexto(p.textoVazio), await vetorTexto(p.textoCheio)])().then((v) => { state.vecs = v; state.chaveTxt = chaveTxt; })
        .catch((e) => { state.erro = String(e.message || e); }).finally(() => { state.codTxt = false; });
    }
    // pedido de nova referência (painel)
    const g = geracao('planograma_ref');
    const capturar = state.gRef != null && state.gRef !== g;
    state.gRef = g;
    if (capturar) state.capturar = true;
    const refs = state.refs || (state.refs = lerRefs());
    const agora = performance.now();
    if (!state.busy && !ctx.fonteParada && state.vecs && agora - state.tLer >= p.intervalo) {
      state.tLer = agora; state.busy = true;
      const full = ctx.grabFull ? ctx.grabFull(1280) : null;
      const img = full && full.width >= src.width ? full : src;
      const lotes = grades.map((gd) => {
        const cs = celulas(gd.caixa, p.linhas, p.colunas);
        return { id: gd.id, nome: gd.nome, cs, dados: cs.map((c) => dadosRecorte(img, { x: c.x1 * img.width, y: c.y1 * img.height, w: (c.x2 - c.x1) * img.width, h: (c.y2 - c.y1) * img.height })) };
      });
      const forcar = state.capturar; state.capturar = false;
      const vecs = state.vecs;
      (async () => {
        for (const L of lotes) {
          const emb = [];
          for (const d of L.dados) emb.push(await vetorImagem(d));
          const chaveRef = `${L.id}:${p.linhas}x${p.colunas}`;
          if (forcar || !refs[chaveRef]) {
            refs[chaveRef] = { emb: emb.map((e) => Array.from(e, (x) => Math.round(x * 1e4) / 1e4)), em: new Date().toISOString(), nome: L.nome };
            gravarRefs(refs);
            for (const c of L.cs) state.cel.delete(`${L.id}:${c.r}:${c.c}`);
            continue;
          }
          const R = refs[chaveRef];
          L.cs.forEach((c, i) => {
            const sim = cosseno(emb[i], Float32Array.from(R.emb[i]));
            const pv = sim < p.limiar ? probabilidades(emb[i], vecs)[0] : null;
            const k = `${L.id}:${c.r}:${c.c}`;
            const e = state.cel.get(k) || { votos: [] };
            e.votos.push(estadoCelula(sim, pv, p.limiar, p.vazioMin)); if (e.votos.length > p.votos) e.votos.shift();
            e.sim = sim; e.pVazio = pv; e.estado = maioria(e.votos); e.t = t;
            state.cel.set(k, e);
          });
        }
      })().catch((e) => { state.erro = String(e.message || e); }).finally(() => { state.busy = false; });
    }
    const out = [];
    for (const gd of grades) {
      const cs = celulas(gd.caixa, p.linhas, p.colunas, 0);
      const R = refs[`${gd.id}:${p.linhas}x${p.colunas}`];
      const cels = cs.map((c) => { const e = state.cel.get(`${gd.id}:${c.r}:${c.c}`); return { r: c.r, c: c.c, sim: e ? e.sim : null, pVazio: e ? e.pVazio : null, estado: e ? e.estado : null }; });
      const lidas = cels.filter((c) => c.estado);
      const ok = lidas.filter((c) => c.estado === 'ok').length;
      out.push({ id: gd.id, nome: gd.nome, linhas: p.linhas, colunas: p.colunas, referenciaEm: R ? R.em : null, celulas: cels,
        conformidade: lidas.length ? ok / lidas.length : null, trocados: lidas.filter((c) => c.estado === 'trocado').length, vazios: lidas.filter((c) => c.estado === 'vazio').length });
      if (p.desenhar) {
        cs.forEach((c, i) => {
          const e = cels[i];
          ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: e.estado ? COR_CEL[e.estado] : '#94a3b8',
            label: e.estado && e.estado !== 'ok' ? `${e.estado} ${Math.round((e.sim || 0) * 100)}` : undefined });
        });
        ctx.overlay.push({ type: 'banner', x: gd.caixa.x1 * w + 4, y: Math.max(0, gd.caixa.y1 * h - 24), color: '#a78bfa',
          text: R ? `${gd.nome}: ${out[out.length - 1].conformidade != null ? Math.round(out[out.length - 1].conformidade * 100) + ' % conforme' : 'lendo…'}` : `${gd.nome}: capturando a referência…` });
      }
    }
    ctx.metrics['planograma'] = out.map((x) => `${x.nome} ${x.conformidade != null ? Math.round(x.conformidade * 100) + '%' : '—'}`).join(' · ');
    if (state.erro) ctx.metrics['planograma erro'] = state.erro;
    publicar('planograma', { grades: out, lendo: state.busy });
    return clone(src);
  },
};

export { ROTULO_STATUS };
export default [preco, planograma];
