/**
 * cv/operators/livres-u/libras.js — libras.soletrar (CV-82, X3).
 *
 * Soletração em Libras (alfabeto datilológico estático) sobre os 21 pontos do
 * maos.gestos: regras para 13 letras (prévia) e, sobretudo, um kNN com os
 * EXEMPLOS que o próprio usuário grava no painel (3 a 5 por letra bastam).
 * A letra estável vira texto. LIMITE: só soletração — não reconhece sinais da
 * Libras nem as letras com movimento (H, J, K, X, Z, Ç); não é tradutor.
 * Os exemplos ficam neste navegador (localStorage), só como números.
 */
import { clone } from '../../core.js';
import { publicar, tomar, tempoDe, lerLocal, gravarLocal } from '../../runtime/livres-u/canal.js';
import { normalizarMao, letraPorRegras, Knn, Soletrador, LETRAS_MOVIMENTO } from '../../runtime/livres-u/libras.js';

const G = 'CV-82';
const CHAVE = 'gplansis.libras.exemplos.v1';
export const AVISO_LIBRAS = 'Só soletração (alfabeto manual estático). Não reconhece sinais da Libras nem as letras com movimento (' +
  LETRAS_MOVIMENTO.join(', ') + ') e não substitui intérprete.';

export const soletrar = {
  op: 'libras.soletrar',
  label: 'Libras — soletração (alfabeto manual)',
  group: G,
  desc: 'Reconhece letras do alfabeto manual da Libras com a mão parada (21 pontos do «Mãos e gestos») e monta o ' +
        'texto. Regras prontas para 13 letras (prévia) e exemplos gravados por você (poucos por letra, kNN). ' + AVISO_LIBRAS,
  params: {
    modo: { type: 'enum', options: ['exemplos + regras', 'só exemplos', 'só regras'], default: 'exemplos + regras', label: 'Reconhecer por' },
    estavelS: { type: 'float', min: 0.2, max: 3, step: 0.1, default: 0.7, label: 'Letra parada por (s)' },
    espacoS: { type: 'float', min: 0.5, max: 5, step: 0.1, default: 1.5, label: 'Sem mão por (s) → espaço' },
    distancia: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.35, label: 'Exemplos: distância máxima' },
    mao: { type: 'enum', options: ['qualquer', 'direita', 'esquerda'], default: 'qualquer', label: 'Mão que soletra' },
  },
  apply(src, p, state, ctx) {
    if (!state.knn) { state.knn = new Knn(lerLocal(CHAVE, {}) || {}); state.sol = new Soletrador(); state.gravando = null; }
    const { knn, sol } = state;
    sol.configurar({ estavelS: p.estavelS, espacoS: p.espacoS });
    for (const c of tomar('u_libras')) {
      if (c.tipo === 'gravar' && c.letra) state.gravando = { letra: String(c.letra).toUpperCase().slice(0, 2), faltam: c.n || 5, ultT: -1 };
      if (c.tipo === 'apagarLetra') { knn.remover(c.letra); gravarLocal(CHAVE, knn.json()); }
      if (c.tipo === 'apagarTudo') { knn.ex = {}; gravarLocal(CHAVE, {}); }
      if (c.tipo === 'limpar') sol.limpar();
      if (c.tipo === 'apagar') sol.apagar();
      if (c.tipo === 'espaco') sol.texto += ' ';
      if (c.tipo === 'importar' && c.dados) { knn.ex = c.dados; gravarLocal(CHAVE, knn.json()); }
    }
    const { t } = tempoDe(ctx);
    const maos = (ctx.hands || []).filter((h) => p.mao === 'qualquer' || h.lado === p.mao);
    const h = maos.sort((a, b) => (b.box.x2 - b.box.x1) * (b.box.y2 - b.box.y1) - (a.box.x2 - a.box.x1) * (a.box.y2 - a.box.y1))[0];
    let letra = null, fonte = null, conf = 0;
    if (h) {
      const v = normalizarMao(h.pts, h.lado === 'esquerda', ctx.w / ctx.h);
      if (v && state.gravando) {
        const G2 = state.gravando;
        // um exemplo a cada 0,25 s, para não gravar 5 quadros idênticos
        if (t - G2.ultT > 0.25) { knn.adicionar(G2.letra, v); G2.faltam--; G2.ultT = t; }
        if (G2.faltam <= 0) { gravarLocal(CHAVE, knn.json()); state.gravando = null; }
      } else if (v) {
        if (p.modo !== 'só regras' && knn.total()) {
          const r = knn.classificar(v, 3, p.distancia);
          if (r) { letra = r.letra; fonte = 'exemplos'; conf = r.conf; }
        }
        if (!letra && p.modo !== 'só exemplos') {
          const r = letraPorRegras(v);
          if (r) { letra = r.letra; fonte = 'regras'; conf = r.conf; }
        }
      }
    }
    const s = state.gravando ? { texto: sol.texto, candidata: null, progresso: 0 } : sol.passo(t, letra, Boolean(h));
    const contagem = {};
    for (const [k, l] of Object.entries(knn.ex)) if (l.length) contagem[k] = l.length;
    publicar('u_libras', { texto: s.texto, candidata: letra, fonte, conf, progresso: s.progresso, temMao: Boolean(h), exemplos: contagem,
      gravando: state.gravando ? { ...state.gravando } : null });
    if (h) {
      const W = ctx.w, H = ctx.h, b = h.box;
      ctx.overlay.push({ type: 'rect', x: b.x1 * W, y: b.y1 * H, w: (b.x2 - b.x1) * W, h: (b.y2 - b.y1) * H, color: state.gravando ? '#f472b6' : '#22d3ee',
        label: state.gravando ? `gravando ${state.gravando.letra}…` : letra ? `${letra} ${Math.round(100 * s.progresso)}%` : '?' });
    }
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Libras (só soletração): ${s.texto.slice(-40) || '…'}`, color: '#22d3ee' });
    return clone(src);
  },
};

export default [soletrar];
