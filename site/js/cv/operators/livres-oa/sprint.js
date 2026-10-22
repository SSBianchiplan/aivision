/**
 * cv/operators/livres-oa/sprint.js — CV-44 Fotocélula virtual (sprint e agilidade).
 *
 * Duas ou mais LINHAS desenhadas com a função "Esportes · fotocélula" são as
 * barreiras. O ponto que corta a barreira é o QUADRIL (média dos quadris do
 * RTMO) ou o TRONCO (média de ombros e quadris) — como a fotocélula de
 * verdade, que corta na altura do tronco. O instante do corte é INTERPOLADO
 * entre os dois quadros vizinhos pela distância de cada um à linha
 * (sub-quadro): a precisão é de milissegundos quando a pose sai a cada quadro.
 *
 *   sprint      largada na 1ª linha, parciais em cada linha na ordem, chegada
 *               na última; velocidade de cada trecho pelas distâncias
 *               informadas ("0; 10; 20; 30" m) ou pela régua calibrada
 *   agilidade   ida e volta (5-10-5, 2×10 m…): largada na 1ª linha, cada
 *               linha cruzada vira uma parcial, termina ao cruzar a 1ª de novo
 *               (ou após N travessias)
 *
 * Tempo do VÍDEO quando a fonte é arquivo (preso ao quadro). Painel:
 * Medições › Sprint, com CSV.
 */
import { clone } from '../../core.js';
import { pessoasComId, medio, cruzamento } from '../../runtime/livres-oa/nucleo.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { registrarEvento } from '../../marcacoes.js';

export const G_SPRINT = 'CV-44';

function pontoCorpo(kp, modo, conf) {
  const q = medio(kp, 11, 12, conf);
  if (modo === 'quadril') return q;
  const o = medio(kp, 5, 6, conf);
  if (!q || !o) return q || o;
  return { x: (q.x + o.x) / 2, y: (q.y + o.y) / 2 };
}

/** Distâncias (m) de cada barreira desde a 1ª: do texto, ou pela escala calibrada (mm/px do quadro). */
export function distanciasBarreiras(linhas, texto, mmPorPx) {
  const v = String(texto || '').split(/[;\s]+/).map((s) => Number(s.replace(',', '.'))).filter(Number.isFinite);
  if (v.length >= linhas.length) return v.slice(0, linhas.length).map((x) => x - v[0]);
  if (!mmPorPx || linhas.length < 2) return null;
  const mid = (l) => [(l.px[0][0] + l.px[1][0]) / 2, (l.px[0][1] + l.px[1][1]) / 2];
  const m0 = mid(linhas[0]), mN = mid(linhas[linhas.length - 1]);
  const dx = mN[0] - m0[0], dy = mN[1] - m0[1], L = Math.hypot(dx, dy) || 1;
  return linhas.map((l) => { const m = mid(l); return (((m[0] - m0[0]) * dx + (m[1] - m0[1]) * dy) / L) * mmPorPx / 1000; });
}

export const sprint = {
  op: 'esportes.sprint',
  label: 'Fotocélula virtual (sprint e agilidade)',
  group: G_SPRINT, overlayOnly: true,
  desc: 'Cronometragem por linhas desenhadas ("Esportes · fotocélula", 2 ou mais): o quadril/tronco da pose (RTMO) ' +
        'corta cada linha e o instante é interpolado entre quadros (sub-quadro). Parciais, tempo total e velocidade ' +
        'por trecho (distâncias informadas ou régua calibrada). Modo agilidade (ida e volta).',
  params: {
    modo: { type: 'enum', options: ['sprint', 'agilidade (ida e volta)'], default: 'sprint', label: 'Modo' },
    ponto: { type: 'enum', options: ['tronco', 'quadril'], default: 'tronco', label: 'Ponto que corta a linha' },
    distancias: { type: 'text', default: '', max: 120, label: 'Distância de cada linha (m; ex.: 0; 10; 20; 30)' },
    travessias: { type: 'int', min: 0, max: 20, step: 1, default: 0, label: 'Agilidade: termina após N travessias (0 = ao voltar à 1ª)' },
    limiteS: { type: 'float', min: 1, max: 600, step: 1, default: 60, label: 'Desistir da tentativa após (s)' },
    kpConf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mínimo do ponto' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar o ponto e o último resultado' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('sprint', state) || !state.pes) { state.pes = new Map(); state.res = []; }
    const mq = ctx.marcacoes;
    const linhas = mq ? mq.itens.filter((i) => i.funcao === 'sprint' && i.tipo === 'linha' && i.px && i.px.length >= 2) : [];
    const { w, h } = ctx;
    if (linhas.length < 2) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Fotocélula: desenhe 2 ou mais linhas com a função "Esportes · fotocélula" (largada → chegada)' });
      publicar('sprint', { linhas: linhas.length, tentativas: state.res, emCurso: [] });
      return clone(src);
    }
    const esc = mq.escala && mq.escala.mmPorPxQuadro;
    const dist = distanciasBarreiras(linhas, p.distancias, esc);
    const { t } = tempoDe(ctx);
    const pessoas = pessoasComId(ctx, state);
    const agil = p.modo !== 'sprint';
    for (const pe of pessoas) {
      const q = pontoCorpo(pe.kp, p.ponto, p.kpConf);
      if (!q) continue;
      const cur = [q.x * w, q.y * h];
      let e = state.pes.get(pe.id);
      if (!e) state.pes.set(pe.id, (e = { ant: null, tAnt: null, tent: null }));
      // a pose pode repetir entre inferências: só conta amostra NOVA (posição mudou)
      if (e.ant && e.ant[0] === cur[0] && e.ant[1] === cur[1]) continue;
      if (e.ant && t > e.tAnt) {
        for (let k = 0; k < linhas.length; k++) {
          const L = linhas[k];
          const c = cruzamento(e.ant, cur, L.px[0], L.px[1]);
          if (!c) continue;
          const tc = e.tAnt + c.f * (t - e.tAnt);
          registrarCruzamento(state, e, pe.id, k, tc, c.sentido, linhas, dist, agil, p);
        }
      }
      e.ant = cur; e.tAnt = t; e.visto = t;
      if (e.tent && t - e.tent.inicio > p.limiteS) e.tent = null;
      if (p.desenhar) ctx.overlay.push({ type: 'point', x: cur[0], y: cur[1], r: 6, color: e.tent ? '#FFD84D' : '#38bdf8' });
    }
    for (const [id, e] of state.pes) if (t - (e.visto ?? t) > p.limiteS) state.pes.delete(id);
    const emCurso = [...state.pes.entries()].filter(([, e]) => e.tent).map(([id, e]) => ({ id, decorrido: t - e.tent.inicio, parciais: e.tent.parciais.length }));
    const ult = state.res[state.res.length - 1];
    if (p.desenhar) {
      const txt = emCurso.length ? `Fotocélula · correndo: ${emCurso.map((x) => `${x.id} ${x.decorrido.toFixed(2).replace('.', ',')} s`).join(' · ')}`
        : ult ? `Fotocélula · último: ${ult.total.toFixed(3).replace('.', ',')} s${ult.vMax ? ` · vmáx ${(ult.vMax * 3.6).toFixed(1).replace('.', ',')} km/h` : ''}` : 'Fotocélula · aguardando largada';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#FFD84D', text: txt });
    }
    ctx.metrics['tentativas'] = state.res.length;
    if (ult) ctx.metrics['último tempo (s)'] = ult.total.toFixed(3);
    publicar('sprint', { linhas: linhas.map((l) => l.nome), distancias: dist, tentativas: state.res, emCurso, modo: p.modo });
    return clone(src);
  },
};

function registrarCruzamento(state, e, id, k, tc, sentido, linhas, dist, agil, p) {
  if (!e.tent) {
    if (k !== 0) return;
    e.tent = { id, inicio: tc, sentido, parciais: [], prox: 1, ultK: 0 };
    registrarEvento({ t: new Date().toISOString(), marcacao: linhas[0].nome, evento: 'largada', classe: 'pessoa', id });
    return;
  }
  const T = e.tent;
  if (!agil && k === 0) {
    // cruzou a largada de novo (voltou andando e largou outra vez): recomeça
    e.tent = { id, inicio: tc, sentido, parciais: [], prox: 1, ultK: 0 };
    return;
  }
  if (!agil) {
    if (k !== T.prox) return;          // fora de ordem (ou a própria largada de novo): ignora
    T.prox++;
  } else {
    if (k === T.ultK && T.parciais.length && tc - T.parciais[T.parciais.length - 1].tAbs < 0.3) return;   // tremida na linha
    T.ultK = k;
  }
  const antT = T.parciais.length ? T.parciais[T.parciais.length - 1].t : 0;
  const antK = T.parciais.length ? T.parciais[T.parciais.length - 1].k : 0;
  const tr = tc - T.inicio;
  const d = dist ? Math.abs(dist[k] - dist[antK]) : null;
  T.parciais.push({ k, nome: linhas[k].nome, t: tr, dt: tr - antT, tAbs: tc, dist: d, v: d != null && tr > antT ? d / (tr - antT) : null, sentido });
  const fimSprint = !agil && k === linhas.length - 1;
  const fimAgil = agil && ((p.travessias > 0 && T.parciais.length >= p.travessias) || (p.travessias === 0 && k === 0));
  if (fimSprint || fimAgil) {
    const vs = T.parciais.map((x) => x.v).filter(Number.isFinite);
    const r = { id, modo: agil ? 'agilidade' : 'sprint', inicio: T.inicio, total: tr, parciais: T.parciais, vMax: vs.length ? Math.max(...vs) : null,
                distTotal: dist ? T.parciais.reduce((s, x) => s + (x.dist || 0), 0) : null, quando: new Date().toISOString() };
    state.res.push(r);
    if (state.res.length > 500) state.res.shift();
    registrarEvento({ t: r.quando, marcacao: linhas[k].nome, evento: `chegada ${tr.toFixed(3)} s`, classe: 'pessoa', id });
    e.tent = null;
  }
}

export default [sprint];
