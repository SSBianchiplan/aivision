/**
 * cv/operators/livres-s/produto.js — CV-63 Foto de produto (e-commerce, V4).
 *
 *   produto.foto   o BiRefNet (CV-20) separa o produto do fundo; a foto sai
 *                  enquadrada no padrão (proporção, margem, centralizada ou
 *                  apoiada na base), com fundo branco/cor/transparente e sombra
 *                  de contato. A tela mostra a prévia; o painel Medições
 *                  exporta a foto em resolução plena e processa um LOTE de
 *                  fotos (do celular) num ZIP. Tudo no navegador.
 */
import { clone, alloc, snapshot } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { publicar } from '../../runtime/livres-oa/canal.js';
import { MODELO, mascaraBiRefNet, comporProduto, PROPORCOES } from '../../runtime/livres-s/produto.js';

export const G_PRODUTO = 'CV-63';

let ultima = null;   // { foto: ImageData (resolução plena), mask, cfg }
/** Última foto analisada com a máscara (para «Exportar foto» no painel). */
export function ultimaFotoProduto() { return ultima; }

export function cfgProduto(p) {
  return { proporcao: p.proporcao, margem: p.margem, fundo: p.fundo, cor: p.cor, sombra: p.sombra, dureza: p.dureza, limiar: p.limiar, base: p.base, saida: p.saida };
}

export const produtoFoto = {
  op: 'produto.foto',
  label: 'Foto de produto (fundo branco, enquadrada)',
  group: G_PRODUTO, model: MODELO, overlayOnly: false,
  desc: 'Tira o fundo com o BiRefNet (borda fina), centraliza o produto no enquadramento padrão (1:1, 4:5…) com margem ' +
        'fixa, fundo branco, cor ou transparente e sombra suave de contato. Prévia ao vivo; no painel Medições: ' +
        'exportar a foto em resolução plena e processar um LOTE de fotos num ZIP.',
  params: {
    proporcao: { type: 'enum', options: Object.keys(PROPORCOES), default: '1:1', label: 'Proporção' },
    margem: { type: 'float', min: 0, max: 0.3, step: 0.01, default: 0.08, label: 'Margem (fração)' },
    base: { type: 'enum', options: ['centro', 'apoiado'], default: 'centro', label: 'Posição vertical' },
    fundo: { type: 'enum', options: ['branco', 'cor', 'transparente'], default: 'branco', label: 'Fundo' },
    cor: { type: 'text', default: '#f4f4f4', max: 9, label: 'Cor do fundo (#rrggbb)' },
    sombra: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.35, label: 'Sombra de contato' },
    dureza: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.3, label: 'Dureza da borda' },
    limiar: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.5, label: 'Limiar do recorte' },
    saida: { type: 'int', min: 400, max: 4000, step: 100, default: 1600, label: 'Lado maior da foto exportada (px)' },
    everyMs: { type: 'int', min: 0, max: 10000, step: 100, default: 1500, label: 'Recortar a cada (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure(MODELO, state, ctx)) return clone(src);
    schedule(state, p.everyMs,
      () => {
        const full = ctx.grabFull ? ctx.grabFull(2048) : null;
        return full && full.width >= src.width ? snapshot(full) : snapshot(src);
      },
      async (foto) => ({ foto, mask: await mascaraBiRefNet(foto) }));
    if (state.inferMs) ctx.metrics['birefnet ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['produto erro'] = state.error;
    const R = state.results;
    if (!R) { ctx.metrics['produto'] = 'recortando…'; return clone(src); }
    if (R !== state.publicado) {
      state.publicado = R;
      ultima = { foto: R.foto, mask: R.mask, cfg: cfgProduto(p) };
    } else if (ultima) ultima.cfg = cfgProduto(p);
    // prévia: compõe no tamanho do quadro (lado menor) e centraliza sobre cinza
    const { w, h } = ctx;
    const comp = comporProduto(src, R.mask, { ...cfgProduto(p), saida: Math.min(w, h) });
    const out = alloc(w, h);
    const od = out.data;
    for (let i = 0; i < od.length; i += 4) { od[i] = 58; od[i + 1] = 62; od[i + 2] = 61; od[i + 3] = 255; }
    if (!comp) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Foto de produto: nenhum objeto separado do fundo' });
      publicar('produto', { ok: false });
      return out;
    }
    const ci = comp.img, x0 = Math.round((w - ci.width) / 2), y0 = Math.round((h - ci.height) / 2);
    for (let y = 0; y < ci.height; y++) {
      const yy = y + y0; if (yy < 0 || yy >= h) continue;
      for (let x = 0; x < ci.width; x++) {
        const xx = x + x0; if (xx < 0 || xx >= w) continue;
        const s = (y * ci.width + x) * 4, d = (yy * w + xx) * 4;
        const a = ci.data[s + 3] / 255;
        // transparente: xadrez por baixo, como os editores mostram
        const bg = ((xx >> 4) ^ (yy >> 4)) & 1 ? 204 : 255;
        od[d] = ci.data[s] * a + bg * (1 - a); od[d + 1] = ci.data[s + 1] * a + bg * (1 - a); od[d + 2] = ci.data[s + 2] * a + bg * (1 - a);
      }
    }
    const ocup = ((comp.origem.x2 - comp.origem.x1) * (comp.origem.y2 - comp.origem.y1)) / (src.width * src.height);
    ctx.metrics['produto'] = `${p.proporcao} · ${Math.round(ocup * 100)} % da foto`;
    publicar('produto', { ok: true, proporcao: p.proporcao, fundo: p.fundo, ocupacao: ocup, largura: R.foto.width, altura: R.foto.height });
    return out;
  },
};

export default [produtoFoto];
