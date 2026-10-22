/**
 * cv/runtime/livres-s/velocidade.js — VELOCIDADE MÉDIA POR DUAS LINHAS (T2),
 * sem DOM: cada objeto rastreado (ID estável) cruza a linha A e a linha B; o
 * instante de cada cruzamento é interpolado entre os quadros (como a
 * fotocélula do CV-44) e v = distância conhecida / Δt. Estatística por classe
 * e sentido: média, mediana, V85 (percentil 85, o da engenharia de tráfego),
 * máxima e excessos sobre o limite.
 */
import { cruzamento } from '../livres-oa/nucleo.js';

/** Percentil p (0–100) por interpolação linear (método do Excel PERCENTIL). */
export function percentil(valores, p) {
  const s = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const k = ((s.length - 1) * p) / 100, i = Math.floor(k), f = k - i;
  return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i];
}

export function estatistica(vs, limite = 0) {
  if (!vs.length) return { n: 0, media: null, mediana: null, v85: null, max: null, excessos: 0 };
  return {
    n: vs.length, media: vs.reduce((a, b) => a + b, 0) / vs.length, mediana: percentil(vs, 50), v85: percentil(vs, 85),
    max: Math.max(...vs), excessos: limite > 0 ? vs.filter((v) => v > limite).length : 0,
  };
}

/**
 * Medidor de velocidade entre duas linhas (pontos em px). Cada passo recebe
 * os objetos [{ id, p: [x, y] px, classe }] e o instante t (s).
 */
export class VelocidadeDuasLinhas {
  constructor() { this.zerar(); }
  zerar() { this.ant = new Map(); this.medidas = []; }

  passo(objs, t, A, B, distM, o = {}) {
    const novas = [];
    const maxS = o.maxS ?? 60;
    const vistos = new Set();
    for (const ob of objs) {
      if (ob.id == null) continue;
      vistos.add(ob.id);
      const a = this.ant.get(ob.id);
      if (a && t > a.t) {
        for (const [nome, L] of [['A', A], ['B', B]]) {
          const c = cruzamento(a.p, ob.p, L[0], L[1], 0.1);
          if (!c) continue;
          const tc = a.t + c.f * (t - a.t);
          const outro = nome === 'A' ? 'B' : 'A';
          const prev = a.cruz[outro];
          if (prev != null && tc - prev > 0 && tc - prev <= maxS) {
            const dt = tc - prev;
            const m = { id: ob.id, classe: ob.classe || '', sentido: `${outro}→${nome}`, t0: prev, t1: tc, dt, v: (distM / dt) * 3.6 };
            this.medidas.push(m); novas.push(m);
            if (this.medidas.length > 20000) this.medidas.shift();
            delete a.cruz[outro];
          } else a.cruz[nome] = tc;
        }
        a.p = ob.p; a.t = t; a.classe = ob.classe || a.classe; a.visto = t;
      } else if (!a) this.ant.set(ob.id, { p: ob.p, t, cruz: {}, classe: ob.classe, visto: t });
    }
    for (const [id, a] of this.ant) if (!vistos.has(id) && t - a.visto > maxS) this.ant.delete(id);
    return novas;
  }

  /** Estatística por grupo (classe, sentido ou 'todos'). */
  resumo(limite = 0) {
    const grupos = { todos: this.medidas.map((m) => m.v) };
    for (const m of this.medidas) {
      (grupos['classe: ' + (m.classe || '—')] ||= []).push(m.v);
      (grupos['sentido ' + m.sentido] ||= []).push(m.v);
    }
    return Object.fromEntries(Object.entries(grupos).map(([k, v]) => [k, estatistica(v, limite)]));
  }
}
