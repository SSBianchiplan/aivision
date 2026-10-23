/**
 * cv/operators/livres-u/midia.js — CV-84 Mídia: cortes, miniatura, busca e fala.
 *
 *   midia.corte_cena   (95) corte seco de cena enquanto o vídeo toca: histograma HSV +
 *                      miniatura cinza com limiar adaptativo → lista de instantes →
 *                      «Marcadores no editor» (GPlanSiS|Vídeo) pelo painel.
 *   midia.miniatura    (96) melhor quadro para miniatura: nitidez (variância do
 *                      Laplaciano) + rosto (rosto.malha: tamanho, terço, olhos abertos)
 *                      + exposição; guarda os N melhores (≥ 1 s de distância) → JPEG
 *                      ou «abrir no editor neste instante».
 *
 * A busca semântica (K4) e os cortes por fala (M2) são ferramentas do painel sobre um
 * arquivo gravado (não rodam no laço de quadros).
 */
import { clone } from '../../core.js';
import { publicar, tomar, tempoDe, conferirGeracao } from '../../runtime/livres-u/canal.js';
import { DetectorCortes, notaMiniatura, lumaQuadro } from '../../runtime/livres-u/midia.js';
import { cinza, laplacianoVar, reduzir } from '../../runtime/livres-u/imagem.js';
import { earMedio } from '../../runtime/livres-u/acess.js';

const G = 'CV-84';

export const corteCena = {
  op: 'midia.corte_cena',
  label: 'Corte de cena automático',
  group: G,
  overlayOnly: true,   // só desenha por cima: devolve o quadro sem alteração (vídeo nítido)
  desc: 'Acha os cortes secos de cena enquanto o vídeo toca (histograma de cor + diferença de quadro, limiar ' +
        'adaptativo, cena mínima) e manda os instantes como marcadores para o editor GPlanSiS|Vídeo. Para varrer ' +
        'um arquivo inteiro mais rápido, use «Varrer arquivo» no painel. Fusões lentas não contam como corte.',
  params: {
    k: { type: 'float', min: 1.5, max: 12, step: 0.5, default: 4, label: 'Sensibilidade (× ruído recente; menor = mais cortes)' },
    minimo: { type: 'float', min: 0.05, max: 0.9, step: 0.01, default: 0.28, label: 'Diferença mínima' },
    cenaMinS: { type: 'float', min: 0.1, max: 10, step: 0.1, default: 0.6, label: 'Cena mínima (s)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_cortes', state) || !state.det) { state.det = new DetectorCortes(); state.cortes = []; state.tAnt = null; }
    state.det.configurar({ k: p.k, minimo: p.minimo, cenaMinS: p.cenaMinS });
    const { t, relogio } = tempoDe(ctx);
    if (state.tAnt != null && t < state.tAnt - 0.05) { state.det.ant = null; state.det.hist = []; state.det.ultimoCorte = -Infinity; }   // voltou o vídeo
    let r = null;
    if (!ctx.fonteParada && (state.tAnt == null || t > state.tAnt + 1e-4)) {
      r = state.det.passo(t, src);
      if (r.corte && !state.cortes.some((c) => Math.abs(c.t - t) < p.cenaMinS)) { state.cortes.push({ t, d: r.d }); state.cortes.sort((a, b) => a.t - b.t); state.flash = 12; }
      state.tAnt = t;
    }
    for (const c of tomar('u_cortes')) if (c.tipo === 'importar' && Array.isArray(c.cortes)) state.cortes = c.cortes;
    publicar('u_cortes', { cortes: state.cortes, relogio, d: r ? r.d : null, limiar: r ? r.limiar : null });
    if (state.flash > 0) { state.flash--; ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `✂ corte de cena (${state.cortes.length})`, color: '#f472b6' }); }
    ctx.metrics['cortes'] = state.cortes.length;
    return clone(src);
  },
};

export const miniatura = {
  op: 'midia.miniatura',
  label: 'Melhor quadro para miniatura',
  group: G,
  overlayOnly: true,   // só desenha por cima: devolve o quadro sem alteração (vídeo nítido)
  desc: 'Dá nota a cada quadro (nitidez, rosto bem enquadrado e de olhos abertos pelo «Malha do rosto», exposição) e ' +
        'guarda os melhores, a pelo menos 1 s um do outro. No painel: baixar JPEG em resolução plena ou abrir o editor ' +
        'GPlanSiS|Vídeo naquele instante.',
  params: {
    intervaloMs: { type: 'int', min: 50, max: 2000, step: 50, default: 200, label: 'Avaliar a cada (ms)' },
    pesoRosto: { type: 'float', min: 0, max: 0.9, step: 0.05, default: 0.4, label: 'Peso do rosto' },
    exigirRosto: { type: 'bool', default: false, label: 'Só quadros com rosto' },
    guardar: { type: 'int', min: 1, max: 12, step: 1, default: 6, label: 'Quantos guardar' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_miniatura', state) || !state.melhores) { state.melhores = []; state.nitRef = 0; }
    const agora = performance.now();
    const { t, relogio } = tempoDe(ctx);
    if (!ctx.fonteParada && (!state.tAval || agora - state.tAval >= p.intervaloMs)) {
      state.tAval = agora;
      const peq = reduzir(src, 480);
      const g = cinza(peq);
      const nit = laplacianoVar(g.g, g.w, g.h);
      state.nitRef = Math.max(state.nitRef * 0.999, nit);
      const rostos = (ctx.faceMesh || []).map((f) => ({ ...f.box, olhosAbertos: earMedio(f.pts, ctx.w / ctx.h) > 0.18 }));
      if (!(p.exigirRosto && !rostos.length)) {
        const luma = lumaQuadro(peq), o = { pesoRosto: p.pesoRosto, exigirRosto: p.exigirRosto };
        const notaDe = (m) => notaMiniatura({ nit: m.nit, nitRef: state.nitRef, rostos: m.rs, luma: m.luma }, o);
        const M = state.melhores;
        // a referência de nitidez muda com o vídeo: as notas guardadas são refeitas contra a atual
        for (const m of M) m.nota = notaDe(m);
        const novo = { t, nit, rs: rostos, luma, rostos: rostos.length, relogio };
        const nota = notaDe(novo);
        const viz = M.findIndex((m) => Math.abs(m.t - t) < 1);
        const pior = M.length ? Math.min(...M.map((m) => m.nota)) : 0;
        if (viz >= 0) { if (nota > M[viz].nota) M[viz] = { ...novo, nota, img: reduzir(src, 640) }; }
        else if (M.length < p.guardar || nota > pior) M.push({ ...novo, nota, img: reduzir(src, 640) });
        M.sort((x, y) => y.nota - x.nota);
        M.length = Math.min(M.length, p.guardar);
        state.ultNota = nota;
      }
    }
    publicar('u_miniatura', { melhores: state.melhores, nota: state.ultNota, relogio });
    if (state.melhores.length) ctx.metrics['melhor nota'] = state.melhores[0].nota.toFixed(2);
    return clone(src);
  },
};

export default [corteCena, miniatura];
