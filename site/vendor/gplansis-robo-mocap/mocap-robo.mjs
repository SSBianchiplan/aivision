/*
 * mocap-robo.mjs — núcleo de MoCap do GPlanSiS|ROBO (robo.gplansis.com), código de Stéfano Bianchi / GPlanSiS,
 * empacotado sem alteração de lógica para o GPlanSiS|iaVision (Motion 3D Studio, CV-88).
 * Fontes: src/core/mocap/geometria.ts, src/core/mocap/posproc.ts, src/core/mocap/exportar.ts, src/core/mocap/sintetico.ts, src/core/filtros.ts, src/core/rv03/marcha.ts, src/core/esqueleto.ts, src/core/simulador.ts, src/core/spec.ts, ../shared/robot_spec.json
 * sha256 dos fontes: 31a255b90e74eebfe010f28fd5f28e6073afa5f38bc25f86d65bf95dcdc377ab
 * Gerado em 2026-10-22T18:03:25.219Z por gerar-bundle.mjs (esbuild do próprio robo). NÃO EDITE: regere.
 */
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// ../../../gplansis-robo/projeto/frontend/src/core/mocap/geometria.ts
var sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
var add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
var mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var norma = (a) => Math.hypot(a[0], a[1], a[2]);
var unit = (a) => mul(a, 1 / (norma(a) || 1));
var mv = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
var transp = (m) => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
var mm = (a, b) => {
  const bt = transp(b);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => dot(a[i], bt[j])));
};
var det3 = (m) => dot(m[0], cross(m[1], m[2]));
function eigSim(A) {
  const n = A.length;
  const a = A.map((r) => [...r]);
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_2, j) => i === j ? 1 : 0));
  for (let varredura = 0; varredura < 60; varredura++) {
    let fora = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) fora += a[p][q] ** 2;
    if (fora < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      const apq = a[p][q];
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq;
        v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  return { valores: a.map((r, i) => r[i]), vetores: v };
}
function nucleo(A) {
  const n = A[0].length;
  const ata = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_2, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
  const { valores, vetores } = eigSim(ata);
  let k = 0;
  for (let i = 1; i < n; i++) if (valores[i] < valores[k]) k = i;
  return vetores.map((r) => r[k]);
}
function svd3(M) {
  const mtm = mm(transp(M), M);
  const { valores, vetores } = eigSim(mtm);
  const ordem = [0, 1, 2].sort((i, j) => valores[j] - valores[i]);
  const Vc = ordem.map((k) => [vetores[0][k], vetores[1][k], vetores[2][k]]);
  const s = ordem.map((k) => Math.sqrt(Math.max(0, valores[k])));
  const u0 = unit(mv(M, Vc[0])), u1raw = mv(M, Vc[1]);
  const u1 = unit(sub(u1raw, mul(u0, dot(u1raw, u0))));
  const u2 = cross(u0, u1);
  const U = transp([u0, u1, u2]);
  const V = transp([Vc[0], Vc[1], Vc[2]]);
  return { U, s, V };
}
var focalDoFov = (largura, fovGraus) => largura / 2 / Math.tan(fovGraus * Math.PI / 360);
function projetar(c, X) {
  const p = add(mv(c.R, X), c.t);
  if (p[2] <= 1e-6) return null;
  return [c.cx + c.f * p[0] / p[2], c.cy + c.f * p[1] / p[2]];
}
var normalizar = (c, px) => [(px[0] - c.cx) / c.f, (px[1] - c.cy) / c.f];
var centroCamera = (c) => mul(mv(transp(c.R), c.t), -1);
function triangular(vistas, limiarPx = 12) {
  let vs = vistas.filter((v) => v.peso > 0.05);
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    if (vs.length < 2) return null;
    const A = [];
    for (const { cam, px, peso } of vs) {
      const [x, y] = normalizar(cam, px);
      const P = [...cam.R.map((r, i) => [...r, cam.t[i]])];
      A.push(P[0].map((_, j) => peso * (x * P[2][j] - P[0][j])));
      A.push(P[0].map((_, j) => peso * (y * P[2][j] - P[1][j])));
    }
    const h = nucleo(A);
    if (Math.abs(h[3]) < 1e-12) return null;
    const X = [h[0] / h[3], h[1] / h[3], h[2] / h[3]];
    const erros = vs.map(({ cam, px }) => {
      const q = projetar(cam, X);
      return q ? Math.hypot(q[0] - px[0], q[1] - px[1]) : 1e9;
    });
    const pior = erros.indexOf(Math.max(...erros));
    const media = erros.reduce((a, b) => a + b, 0) / erros.length;
    if (erros[pior] > limiarPx && vs.length >= 3) {
      vs = vs.filter((_, i) => i !== pior);
      continue;
    }
    if (media > limiarPx * 2) return null;
    return { X, erroPx: media, vistas: vs.length };
  }
  return null;
}
function rodrigues(w) {
  const th = norma(w);
  if (th < 1e-12) return [[1, -w[2], w[1]], [w[2], 1, -w[0]], [-w[1], w[0], 1]];
  const k = mul(w, 1 / th), c = Math.cos(th), s = Math.sin(th), v = 1 - c;
  return [
    [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s],
    [k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s],
    [k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v]
  ];
}
function resolver(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-18;
    for (let r = 0; r < n; r++) if (r !== c) {
      const k = M[r][c] / d;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-18));
}
function ajusteDeFeixe(cams, quadros, visMin, iteracoes = 10) {
  let cs = cams.map((c) => ({ ...c }));
  const distRef = (pts) => pts.reduce((a, p) => a + norma(add(mv(cs[0].R, p.X), cs[0].t)), 0) / Math.max(1, pts.length);
  let escalaRef = 0;
  for (let it = 0; it < iteracoes; it++) {
    const obs = [];
    for (const qs of quadros) {
      for (let k2 = 0; k2 < 33; k2++) {
        const vistas = [];
        const px = [], peso = [];
        qs.forEach((o, i) => {
          const p = o?.px[k2], v = o?.vis[k2] ?? 0;
          px.push(p && v >= visMin ? p : null);
          peso.push(v);
          if (p && v >= visMin) vistas.push({ cam: cs[i], px: p, peso: v });
        });
        const T = triangular(vistas, 1e9);
        if (T && T.vistas >= 2) obs.push({ X: T.X, px, peso });
      }
    }
    const d = distRef(obs);
    if (!escalaRef) escalaRef = d;
    const k = escalaRef / (d || 1);
    for (const o of obs) o.X = add(mul(sub(o.X, centroCamera(cs[0])), k), centroCamera(cs[0]));
    for (let i = 1; i < cs.length; i++) cs[i] = { ...cs[i], t: add(mul(cs[i].t, k), mul(mv(cs[i].R, centroCamera(cs[0])), k - 1)) };
    for (let i = 1; i < cs.length; i++) {
      const meus = obs.filter((o) => o.px[i]);
      if (meus.length < 12) continue;
      let lambda = 1e-3;
      const residuos = (c) => {
        const r = [];
        for (const o of meus) {
          const q = projetar(c, o.X), p = o.px[i];
          if (!q) {
            r.push(50, 50);
            continue;
          }
          const ex = q[0] - p[0], ey = q[1] - p[1];
          const w = Math.sqrt(o.peso[i] / (1 + (ex * ex + ey * ey) / 9));
          r.push(ex * w, ey * w);
        }
        return r;
      };
      const custo = (r) => r.reduce((a, v) => a + v * v, 0);
      const aplicar = (c, dp) => ({ ...c, R: mm(rodrigues([dp[0], dp[1], dp[2]]), c.R), t: add(c.t, [dp[3], dp[4], dp[5]]) });
      for (let passo = 0; passo < 8; passo++) {
        const c = cs[i];
        const r0 = residuos(c);
        const J = r0.map(() => []);
        for (let p = 0; p < 6; p++) {
          const h = p < 3 ? 1e-6 : 1e-6 * (norma(c.t) + 1);
          const dp = [0, 0, 0, 0, 0, 0];
          dp[p] = h;
          const r1 = residuos(aplicar(c, dp));
          r1.forEach((v, j) => J[j].push((v - r0[j]) / h));
        }
        const JtJ = Array.from({ length: 6 }, (_, a) => Array.from({ length: 6 }, (_2, b) => J.reduce((s2, row) => s2 + row[a] * row[b], 0)));
        const Jtr = Array.from({ length: 6 }, (_, a) => J.reduce((s2, row, j) => s2 + row[a] * r0[j], 0));
        let aceitou = false;
        for (let tent = 0; tent < 6 && !aceitou; tent++) {
          const A = JtJ.map((row, a) => row.map((v, b) => a === b ? v * (1 + lambda) + 1e-9 : v));
          const dp = resolver(A, Jtr.map((v) => -v));
          const nova = aplicar(c, dp);
          if (custo(residuos(nova)) < custo(r0)) {
            cs[i] = nova;
            lambda = Math.max(1e-7, lambda / 3);
            aceitou = true;
          } else lambda *= 10;
        }
        if (!aceitou) break;
      }
    }
  }
  return cs;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function essencial8(pares) {
  return essencialDeLinhas(pares.map(([[x1, y1], [x2, y2]]) => [x2 * x1, x2 * y1, x2, y2 * x1, y2 * y1, y2, x1, y1, 1]));
}
function essencialDeLinhas(A) {
  const e = nucleo(A);
  const E = [[e[0], e[1], e[2]], [e[3], e[4], e[5]], [e[6], e[7], e[8]]];
  const { U, s, V } = svd3(E);
  const m = (s[0] + s[1]) / 2;
  const S = [[m, 0, 0], [0, m, 0], [0, 0, 0]];
  return mm(mm(U, S), transp(V));
}
function sampson(E, [p1, p2]) {
  const x1 = [p1[0], p1[1], 1], x2 = [p2[0], p2[1], 1];
  const Ex1 = mv(E, x1), Etx2 = mv(transp(E), x2);
  const num = dot(x2, Ex1) ** 2;
  return num / (Ex1[0] ** 2 + Ex1[1] ** 2 + Etx2[0] ** 2 + Etx2[1] ** 2 || 1e-12);
}
function decompor(E, amostra, c1, c2) {
  const { U: U0, V: V0 } = svd3(E);
  const U = det3(U0) < 0 ? U0.map((r) => [r[0], r[1], -r[2]]) : U0;
  const V = det3(V0) < 0 ? V0.map((r) => [r[0], r[1], -r[2]]) : V0;
  const W = [[0, -1, 0], [1, 0, 0], [0, 0, 1]];
  const Ra = mm(mm(U, W), transp(V)), Rb = mm(mm(U, transp(W)), transp(V));
  const u3 = [U[0][2], U[1][2], U[2][2]];
  let melhor = { R: Ra, t: u3 }, votos = -1;
  for (const R of [Ra, Rb]) for (const t of [u3, mul(u3, -1)]) {
    const cA = { ...c1, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] };
    const cB = { ...c2, R, t };
    let n = 0;
    for (const [a, b] of amostra) {
      const p = triangular([{ cam: cA, px: [c1.cx + a[0] * c1.f, c1.cy + a[1] * c1.f], peso: 1 }, { cam: cB, px: [c2.cx + b[0] * c2.f, c2.cy + b[1] * c2.f], peso: 1 }], 1e9);
      if (!p) continue;
      if (p.X[2] > 0 && add(mv(R, p.X), t)[2] > 0) n++;
    }
    if (n > votos) {
      votos = n;
      melhor = { R, t };
    }
  }
  return melhor;
}
function autocalibrar(base, quadros, alturaPessoaM, visMin = 0.65, refinar = true) {
  const n = base.length;
  if (n < 2) throw new Error("A calibra\xE7\xE3o precisa de pelo menos duas c\xE2meras.");
  const rnd = mulberry(1234);
  const cams = base.map((c) => ({ ...c, R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], t: [0, 0, 0] }));
  const inliers = [1];
  const paresDe = (i) => {
    const out = [];
    quadros.forEach((qs, q) => {
      const a = qs[0], b = qs[i];
      if (!a || !b) return;
      for (let k = 0; k < 33; k++) {
        const pa = a.px[k], pb = b.px[k];
        if (!pa || !pb || (a.vis[k] ?? 0) < visMin || (b.vis[k] ?? 0) < visMin) continue;
        out.push({ par: [normalizar(base[0], pa), normalizar(base[i], pb)], q, k });
      }
    });
    return out;
  };
  let totalPares = 0;
  for (let i = 1; i < n; i++) {
    const pares = paresDe(i);
    totalPares += pares.length;
    if (pares.length < 16) throw new Error(`C\xE2mera ${i + 1}: poucos pontos em comum com a c\xE2mera 1 (${pares.length}). Movimente-se \xE0 vista das duas.`);
    const lim = (4 / base[0].f) ** 2;
    let melhorIn = [];
    for (let it = 0; it < 200; it++) {
      const s = [];
      const usados = /* @__PURE__ */ new Set();
      while (s.length < Math.min(24, pares.length)) {
        const j = Math.floor(rnd() * pares.length);
        if (!usados.has(j)) {
          usados.add(j);
          s.push(pares[j].par);
        }
      }
      const E0 = essencial8(s);
      const ins = [];
      pares.forEach((p, j) => {
        if (sampson(E0, p.par) < lim) ins.push(j);
      });
      if (ins.length > melhorIn.length) melhorIn = ins;
    }
    let E = essencial8(melhorIn.map((j) => pares[j].par));
    for (let it = 0; it < 8; it++) {
      const escalaR = lim / 4;
      const pond = melhorIn.map((j) => {
        const w = 1 / Math.sqrt(1 + sampson(E, pares[j].par) / escalaR);
        const [[x1, y1], [x2, y2]] = pares[j].par;
        return [x2 * x1, x2 * y1, x2, y2 * x1, y2 * y1, y2, x1, y1, 1].map((v) => v * w);
      });
      E = essencialDeLinhas(pond);
    }
    inliers.push(melhorIn.length / pares.length);
    const amostra = melhorIn.filter((_, j) => j % Math.max(1, Math.floor(melhorIn.length / 60)) === 0).map((j) => pares[j].par);
    const { R, t } = decompor(E, amostra, base[0], base[i]);
    cams[i] = { ...cams[i], R, t };
  }
  const triPar = (i) => {
    const m = /* @__PURE__ */ new Map();
    quadros.forEach((qs, q) => {
      for (let k = 0; k < 33; k++) {
        const a = qs[0], b = qs[i];
        const pa = a?.px[k], pb = b?.px[k];
        if (!pa || !pb || (a.vis[k] ?? 0) < visMin || (b.vis[k] ?? 0) < visMin) continue;
        const p = triangular([{ cam: cams[0], px: pa, peso: 1 }, { cam: cams[i], px: pb, peso: 1 }], 1e9);
        if (p) m.set(`${q}:${k}`, p.X);
      }
    });
    return m;
  };
  const ref = triPar(1);
  for (let i = 2; i < n; i++) {
    const outra = triPar(i);
    const comuns = [...ref.keys()].filter((k) => outra.has(k));
    const razoes = [];
    for (let j = 0; j + 1 < comuns.length; j += 2) {
      const d1 = norma(sub(ref.get(comuns[j]), ref.get(comuns[j + 1])));
      const d2 = norma(sub(outra.get(comuns[j]), outra.get(comuns[j + 1])));
      if (d2 > 1e-6) razoes.push(d1 / d2);
    }
    razoes.sort((a, b) => a - b);
    const s = razoes[Math.floor(razoes.length / 2)] ?? 1;
    cams[i] = { ...cams[i], t: mul(cams[i].t, s) };
  }
  if (refinar) {
    const refinadas = ajusteDeFeixe(cams, quadros, visMin, 10);
    for (let i = 0; i < n; i++) cams[i] = refinadas[i];
  }
  const rec = quadros.map((qs) => triangularQuadro(cams, qs, visMin, 1e9));
  const meio = (a, b) => a && b ? mul(add(a, b), 0.5) : null;
  const alturas = [], cimas = [], esquerdas = [];
  let origem = null;
  for (const r of rec) {
    const nar = r[0];
    for (const [t, q, o] of [[27, 23, 11], [28, 24, 12]]) {
      const pt2 = r[t], pq = r[q], po = r[o];
      if (!pt2 || !pq || !po || !nar) continue;
      alturas.push(norma(sub(pq, pt2)) + norma(sub(po, pq)) + norma(sub(nar, po)));
      cimas.push(unit(sub(po, pt2)));
    }
    if (r[23] && r[24]) esquerdas.push(unit(sub(r[23], r[24])));
    origem ?? (origem = meio(r[27], r[28]) ?? r[27] ?? r[28] ?? null);
  }
  if (!alturas.length || !origem) throw new Error("A pessoa precisa aparecer de corpo inteiro em pelo menos duas c\xE2meras para dar escala.");
  alturas.sort((a, b) => a - b);
  const escala = alturaPessoaM * 0.89 / alturas[Math.floor(alturas.length / 2)];
  const cima = unit(cimas.reduce((a, b) => add(a, b), [0, 0, 0]));
  const esq0 = esquerdas[0] ?? [1, 0, 0];
  const x = unit(sub(esq0, mul(cima, dot(esq0, cima))));
  const z = cross(x, cima);
  const Rw = [x, cima, z];
  const final = cams.map((c) => {
    const R = mm(c.R, transp(Rw));
    const t = add(mul(add(mv(c.R, origem), c.t), escala), [0, 0, 0]);
    return { ...c, R, t };
  });
  let soma = 0, cont = 0;
  quadros.forEach((qs) => {
    const r = triangularQuadro(final, qs, visMin, 1e9);
    r.forEach((X, k) => {
      if (!X) return;
      qs.forEach((o, ci) => {
        const px = o?.px[k];
        if (!px || (o.vis[k] ?? 0) < visMin) return;
        const q = projetar(final[ci], X);
        if (q) {
          soma += Math.hypot(q[0] - px[0], q[1] - px[1]);
          cont++;
        }
      });
    });
  });
  return { cameras: final, erroPx: cont ? soma / cont : Infinity, inliers, correspondencias: totalPares, escala };
}
function triangularQuadro(cams, qs, visMin = 0.5, limiarPx = 12) {
  const out = [];
  for (let k = 0; k < 33; k++) {
    const vistas = [];
    qs.forEach((o, i) => {
      const px = o?.px[k];
      const v = o?.vis[k] ?? 0;
      if (px && v >= visMin) vistas.push({ cam: cams[i], px, peso: v });
    });
    out.push(triangular(vistas, limiarPx)?.X ?? null);
  }
  return out;
}

// ../../../gplansis-robo/projeto/frontend/src/core/rv03/marcha.ts
import * as THREE from "../three-0.170.0/three.module.min.js";
function casco(pts) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.z - b.z);
  const cr = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo = [], hi = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (const q of [...p].reverse()) {
    while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop();
    hi.push(q);
  }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function margem(poly, q) {
  let dentro = true, dMin = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    if (ex * (q.z - a.z) - ez * (q.x - a.x) < 0) dentro = false;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * ex + (q.z - a.z) * ez) / (ex * ex + ez * ez)));
    dMin = Math.min(dMin, Math.hypot(q.x - (a.x + t * ex), q.z - (a.z + t * ez)));
  }
  return dentro ? dMin : -dMin;
}

// ../../../gplansis-robo/projeto/frontend/src/core/mocap/posproc.ts
var NOMES_MP = [
  "nariz",
  "olho_esq_int",
  "olho_esq",
  "olho_esq_ext",
  "olho_dir_int",
  "olho_dir",
  "olho_dir_ext",
  "orelha_esq",
  "orelha_dir",
  "boca_esq",
  "boca_dir",
  "ombro_esq",
  "ombro_dir",
  "cotovelo_esq",
  "cotovelo_dir",
  "pulso_esq",
  "pulso_dir",
  "minimo_esq",
  "minimo_dir",
  "indicador_esq",
  "indicador_dir",
  "polegar_esq",
  "polegar_dir",
  "quadril_esq",
  "quadril_dir",
  "joelho_esq",
  "joelho_dir",
  "tornozelo_esq",
  "tornozelo_dir",
  "calcanhar_esq",
  "calcanhar_dir",
  "ponta_pe_esq",
  "ponta_pe_dir"
];
function preencherLacunas(m, maxQuadros) {
  const out = m.map((q) => [...q]);
  let preenchidos = 0;
  const nm = m[0]?.length ?? 0;
  for (let k = 0; k < nm; k++) {
    let i = 0;
    while (i < out.length) {
      if (out[i][k]) {
        i++;
        continue;
      }
      let j = i;
      while (j < out.length && !out[j][k]) j++;
      const antes = out[i - 1]?.[k], depois = out[j]?.[k];
      if (antes && depois && j - i <= maxQuadros) {
        for (let q = i; q < j; q++) {
          const u = (q - i + 1) / (j - i + 1);
          out[q][k] = add(mul(antes, 1 - u), mul(depois, u));
          preenchidos++;
        }
      }
      i = j;
    }
  }
  return { trilha: out, preenchidos };
}
function biquads(fc, fs) {
  const w0 = 2 * Math.PI * Math.min(fc, fs * 0.45) / fs, c = Math.cos(w0), s = Math.sin(w0);
  return [0.5411961, 1.306563].map((Q) => {
    const al = s / (2 * Q), a0 = 1 + al;
    return { b: [(1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0], a: [-2 * c / a0, (1 - al) / a0] };
  });
}
function aplicarBiquad(x, q) {
  const y = new Array(x.length);
  let x1 = x[0], x2 = x[0], y1 = x[0], y2 = x[0];
  for (let i = 0; i < x.length; i++) {
    const v = q.b[0] * x[i] + q.b[1] * x1 + q.b[2] * x2 - q.a[0] * y1 - q.a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}
function butterworthFaseZero(x, fc, fs) {
  if (x.length < 8) return [...x];
  const pad = Math.min(x.length - 1, 24);
  const ext = [...x.slice(1, pad + 1).reverse().map((v) => 2 * x[0] - v), ...x, ...x.slice(-pad - 1, -1).reverse().map((v) => 2 * x[x.length - 1] - v)];
  let y = ext;
  for (const q of biquads(fc, fs)) y = aplicarBiquad(y, q);
  y.reverse();
  for (const q of biquads(fc, fs)) y = aplicarBiquad(y, q);
  y.reverse();
  return y.slice(pad, pad + x.length);
}
function filtrarTrilha(m, fc, fs) {
  const out = m.map((q) => [...q]);
  const nm = m[0]?.length ?? 0;
  for (let k = 0; k < nm; k++) {
    let i = 0;
    while (i < m.length) {
      if (!m[i][k]) {
        i++;
        continue;
      }
      let j = i;
      while (j < m.length && m[j][k]) j++;
      const eixos = [0, 1, 2].map((e) => butterworthFaseZero(m.slice(i, j).map((q) => q[k][e]), fc, fs));
      for (let q = i; q < j; q++) out[q][k] = [eixos[0][q - i], eixos[1][q - i], eixos[2][q - i]];
      i = j;
    }
  }
  return out;
}
var OSSOS = [
  [11, 13, "bra\xE7o esq."],
  [13, 15, "antebra\xE7o esq."],
  [12, 14, "bra\xE7o dir."],
  [14, 16, "antebra\xE7o dir."],
  [23, 25, "coxa esq."],
  [25, 27, "perna esq."],
  [24, 26, "coxa dir."],
  [26, 28, "perna dir."],
  [27, 29, "calcanhar esq."],
  [27, 31, "p\xE9 esq."],
  [28, 30, "calcanhar dir."],
  [28, 32, "p\xE9 dir."]
];
function ossosRigidos(m) {
  const comp = {};
  let somaCv = 0, nCv = 0;
  for (const [a, b, nome] of OSSOS) {
    const ls = m.map((q) => q[a] && q[b] ? norma(sub(q[b], q[a])) : NaN).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
    if (!ls.length) continue;
    const med = ls[Math.floor(ls.length / 2)];
    comp[nome] = med;
    const media = ls.reduce((s, v) => s + v, 0) / ls.length;
    somaCv += Math.sqrt(ls.reduce((s, v) => s + (v - media) ** 2, 0) / ls.length) / media;
    nCv++;
  }
  const out = m.map((q) => [...q]);
  for (const q of out) {
    for (const [a, b, nome] of OSSOS) {
      const pa = q[a], pb = q[b], L = comp[nome];
      if (!pa || !pb || !L) continue;
      const nb = add(pa, mul(unit(sub(pb, pa)), L));
      const delta = sub(nb, pb);
      q[b] = nb;
      const filhos = { 15: [17, 19, 21], 16: [18, 20, 22], 27: [], 28: [] };
      for (const f of filhos[b] ?? []) if (q[f]) q[f] = add(q[f], delta);
    }
  }
  return { trilha: out, comprimentos: comp, variacaoAntes: nCv ? somaCv / nCv : 0 };
}
var SEGMENTOS = [
  { nome: "cabe\xE7a e pesco\xE7o", prox: [11, 12], dist: [7, 8], massa: 0.081, com: 1 },
  { nome: "tronco", prox: [11, 12], dist: [23, 24], massa: 0.497, com: 0.5 },
  { nome: "bra\xE7o esq.", prox: 11, dist: 13, massa: 0.028, com: 0.436 },
  { nome: "bra\xE7o dir.", prox: 12, dist: 14, massa: 0.028, com: 0.436 },
  { nome: "antebra\xE7o esq.", prox: 13, dist: 15, massa: 0.016, com: 0.43 },
  { nome: "antebra\xE7o dir.", prox: 14, dist: 16, massa: 0.016, com: 0.43 },
  { nome: "m\xE3o esq.", prox: 15, dist: 19, massa: 6e-3, com: 0.506 },
  { nome: "m\xE3o dir.", prox: 16, dist: 20, massa: 6e-3, com: 0.506 },
  { nome: "coxa esq.", prox: 23, dist: 25, massa: 0.1, com: 0.433 },
  { nome: "coxa dir.", prox: 24, dist: 26, massa: 0.1, com: 0.433 },
  { nome: "perna esq.", prox: 25, dist: 27, massa: 0.0465, com: 0.433 },
  { nome: "perna dir.", prox: 26, dist: 28, massa: 0.0465, com: 0.433 },
  { nome: "p\xE9 esq.", prox: 27, dist: 31, massa: 0.0145, com: 0.5 },
  { nome: "p\xE9 dir.", prox: 28, dist: 32, massa: 0.0145, com: 0.5 }
];
var ponto = (q, r) => {
  if (typeof r === "number") return q[r] ?? null;
  const a = q[r[0]], b = q[r[1]];
  return a && b ? mul(add(a, b), 0.5) : null;
};
var TOLERA_SEM_DISTAL = /* @__PURE__ */ new Set(["cabe\xE7a e pesco\xE7o", "m\xE3o esq.", "m\xE3o dir.", "p\xE9 esq.", "p\xE9 dir."]);
function centroDeMassa(q) {
  let soma = [0, 0, 0], m = 0;
  for (const s of SEGMENTOS) {
    const p = ponto(q, s.prox);
    let d = ponto(q, s.dist);
    if (p && !d && TOLERA_SEM_DISTAL.has(s.nome)) d = s.nome.startsWith("cabe\xE7a") ? q[0] ?? null : p;
    if (!p || !d) return null;
    soma = add(soma, mul(add(p, mul(sub(d, p), s.com)), s.massa));
    m += s.massa;
  }
  return mul(soma, 1 / m);
}
var ang = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180 / Math.PI;
function angulos(q) {
  const f = (a, b, c) => q[a] && q[b] && q[c] ? 180 - ang(sub(q[a], q[b]), sub(q[c], q[b])) : null;
  const tronco = ponto(q, [11, 12]) && ponto(q, [23, 24]) ? sub(ponto(q, [23, 24]), ponto(q, [11, 12])) : null;
  const elev = (o, c) => tronco && q[o] && q[c] ? ang(tronco, sub(q[c], q[o])) : null;
  const flexQ = (h, k) => tronco && q[h] && q[k] ? ang(tronco, sub(q[k], q[h])) : null;
  return {
    "joelho esq.": f(23, 25, 27),
    "joelho dir.": f(24, 26, 28),
    "cotovelo esq.": f(11, 13, 15),
    "cotovelo dir.": f(12, 14, 16),
    "quadril esq.": flexQ(23, 25),
    "quadril dir.": flexQ(24, 26),
    "ombro esq.": elev(11, 13),
    "ombro dir.": elev(12, 14)
  };
}
function baseDeSuporte(q, com, alturaContato = 0.06) {
  const pes = [27, 28, 29, 30, 31, 32].map((k) => q[k]).filter((p) => !!p);
  if (pes.length < 3 || !com) return { poligono: [], margem: null };
  const chao = Math.min(...pes.map((p) => p[1]));
  const contato = pes.filter((p) => p[1] < chao + alturaContato).map((p) => ({ x: p[0], z: p[2] }));
  const poly = contato.length >= 3 ? casco(contato) : [];
  return { poligono: poly, margem: poly.length >= 3 ? margem(poly, { x: com[0], z: com[2] }) : null };
}
function processar(bruta, fps, opc = { fc: 7, lacunaMaxS: 0.5 }) {
  const { trilha: t1, preenchidos } = preencherLacunas(bruta, Math.round(opc.lacunaMaxS * fps));
  const t2 = filtrarTrilha(t1, opc.fc, fps);
  const { trilha: t3, comprimentos, variacaoAntes } = ossosRigidos(t2);
  const com = t3.map(centroDeMassa);
  return {
    trilha: t3,
    com,
    angulos: t3.map(angulos),
    margemBase: t3.map((q, i) => baseDeSuporte(q, com[i] ?? null).margem),
    comprimentos,
    relatorio: { preenchidos, lacunasRestantes: t3.reduce((s, q) => s + q.filter((p) => !p).length, 0), variacaoOssosAntes: variacaoAntes, fc: opc.fc }
  };
}

// ../../../gplansis-robo/projeto/frontend/src/core/mocap/exportar.ts
import * as THREE2 from "../three-0.170.0/three.module.min.js";
function paraCSV(p, fps) {
  const cab = ["quadro", "tempo_s", ...NOMES_MP.flatMap((n) => [`${n}_x`, `${n}_y`, `${n}_z`]), "com_x", "com_y", "com_z"];
  const f = (v) => v === void 0 ? "" : v.toFixed(5);
  const linhas = p.trilha.map((q, i) => [String(i), (i / fps).toFixed(4), ...q.flatMap((X) => X ? X.map(f) : ["", "", ""]), ...p.com[i] ? p.com[i].map(f) : ["", "", ""]].join(","));
  return [cab.join(","), ...linhas].join("\n");
}
function paraJSON(p, fps, cameras) {
  return JSON.stringify({
    formato: "gplansis-mocap/1",
    unidade: "m",
    eixos: "y para cima, +x esquerda da pessoa, +z frente",
    fps,
    marcadores: NOMES_MP,
    cameras: cameras.map((c) => ({ id: c.id, largura: c.largura, altura: c.altura, f: c.f, cx: c.cx, cy: c.cy, R: c.R, t: c.t })),
    comprimentos_ossos_m: p.comprimentos,
    relatorio: p.relatorio,
    quadros: p.trilha.map((q) => q.map((X) => X ? X.map((v) => +v.toFixed(5)) : null)),
    centro_de_massa: p.com.map((X) => X ? X.map((v) => +v.toFixed(5)) : null)
  });
}
var pt = (q, r) => {
  if (typeof r === "number") return q[r] ? new THREE2.Vector3(...q[r]) : null;
  const a = q[r[0]], b = q[r[1]];
  return a && b ? new THREE2.Vector3(...a).add(new THREE2.Vector3(...b)).multiplyScalar(0.5) : null;
};
function esqueleto() {
  const J = (nome, ref, pai, offset, osso, fim) => ({ nome, ref, pai, filhos: [], offset, osso, fim });
  const js = [
    J("Hips", [23, 24], null, [0, 0, 0], [0, 1, 0]),
    J("Spine", [23, 24], "Hips", [0, 0, 0], [0, 1, 0]),
    J("Neck", [11, 12], "Spine", [0, 1, 0], [0, 1, 0], 0),
    J("LeftArm", 11, "Neck", [1, 0, 0], [1, 0, 0]),
    J("LeftForeArm", 13, "LeftArm", [1, 0, 0], [1, 0, 0]),
    J("LeftHand", 15, "LeftForeArm", [1, 0, 0], [1, 0, 0], 19),
    J("RightArm", 12, "Neck", [-1, 0, 0], [-1, 0, 0]),
    J("RightForeArm", 14, "RightArm", [-1, 0, 0], [-1, 0, 0]),
    J("RightHand", 16, "RightForeArm", [-1, 0, 0], [-1, 0, 0], 20),
    J("LeftUpLeg", 23, "Hips", [1, 0, 0], [0, -1, 0]),
    J("LeftLeg", 25, "LeftUpLeg", [0, -1, 0], [0, -1, 0]),
    J("LeftFoot", 27, "LeftLeg", [0, -1, 0], [0, 0, 1], 31),
    J("RightUpLeg", 24, "Hips", [-1, 0, 0], [0, -1, 0]),
    J("RightLeg", 26, "RightUpLeg", [0, -1, 0], [0, -1, 0]),
    J("RightFoot", 28, "RightLeg", [0, -1, 0], [0, 0, 1], 32)
  ];
  for (const j of js) if (j.pai) js.find((p) => p.nome === j.pai).filhos.push(j.nome);
  return js;
}
function referencial(q, lat, cima) {
  const a = pt(q, lat[0]), b = pt(q, lat[1]), c0 = pt(q, cima[0]), c1 = pt(q, cima[1]);
  if (!a || !b || !c0 || !c1) return null;
  const x = a.sub(b).normalize();
  const y0 = c1.sub(c0);
  const y = y0.sub(x.clone().multiplyScalar(y0.dot(x))).normalize();
  const z = new THREE2.Vector3().crossVectors(x, y);
  return new THREE2.Quaternion().setFromRotationMatrix(new THREE2.Matrix4().makeBasis(x, y, z));
}
function paraBVH(p, fps) {
  const js = esqueleto();
  const por = new Map(js.map((j) => [j.nome, j]));
  const cm = (v) => (v * 100).toFixed(4);
  const med = (a, b) => {
    const ls = p.trilha.map((q) => {
      const x = pt(q, a), y = pt(q, b);
      return x && y ? x.distanceTo(y) : NaN;
    }).filter(Number.isFinite).sort((u, v) => u - v);
    return ls[Math.floor(ls.length / 2)] ?? 0.1;
  };
  const offset = (j) => {
    if (!j.pai) return [0, 0, 0];
    const L = j.nome === "Spine" ? 0 : med(por.get(j.pai).ref, j.ref);
    return [j.offset[0] * L, j.offset[1] * L, j.offset[2] * L];
  };
  const linhas = ["HIERARCHY"];
  const escrever = (j, nivel) => {
    const ind = "  ".repeat(nivel);
    const o = offset(j);
    linhas.push(
      `${ind}${j.pai ? "JOINT" : "ROOT"} ${j.nome}`,
      `${ind}{`,
      `${ind}  OFFSET ${o.map(cm).join(" ")}`,
      `${ind}  CHANNELS ${j.pai ? "3 Zrotation Xrotation Yrotation" : "6 Xposition Yposition Zposition Zrotation Xrotation Yrotation"}`
    );
    for (const f of j.filhos) escrever(por.get(f), nivel + 1);
    if (j.fim !== void 0) {
      const L = med(j.ref, j.fim);
      linhas.push(`${ind}  End Site`, `${ind}  {`, `${ind}    OFFSET ${j.osso.map((d) => cm(d * L)).join(" ")}`, `${ind}  }`);
    }
    linhas.push(`${ind}}`);
  };
  escrever(js[0], 0);
  linhas.push("MOTION", `Frames: ${p.trilha.length}`, `Frame Time: ${(1 / fps).toFixed(6)}`);
  const ultimaLocal = /* @__PURE__ */ new Map();
  let ultimaRaiz = new THREE2.Vector3();
  for (const q of p.trilha) {
    const glob = /* @__PURE__ */ new Map();
    const valores = [];
    for (const j of ordemDFS(js)) {
      let g2;
      if (j.nome === "Hips") g2 = referencial(q, [23, 24], [[23, 24], [11, 12]]);
      else if (j.nome === "Spine") g2 = glob.get("Hips").clone();
      else if (j.nome === "Neck") g2 = referencial(q, [11, 12], [[11, 12], 0]);
      else {
        const filho = j.filhos[0] ? por.get(j.filhos[0]).ref : j.fim;
        const a = pt(q, j.ref), b = filho !== void 0 ? pt(q, filho) : null;
        const gp2 = glob.get(j.pai);
        g2 = a && b ? gp2.clone().multiply(new THREE2.Quaternion().setFromUnitVectors(new THREE2.Vector3(...j.osso), b.sub(a).normalize().applyQuaternion(gp2.clone().invert()))) : null;
      }
      const gp = j.pai ? glob.get(j.pai) : new THREE2.Quaternion();
      let local;
      if (g2) {
        local = gp.clone().invert().multiply(g2);
        ultimaLocal.set(j.nome, local.clone());
      } else {
        local = ultimaLocal.get(j.nome)?.clone() ?? new THREE2.Quaternion();
        g2 = gp.clone().multiply(local);
      }
      glob.set(j.nome, g2);
      if (!j.pai) {
        const raiz = pt(q, j.ref);
        if (raiz) ultimaRaiz = raiz;
        valores.push(cm(ultimaRaiz.x), cm(ultimaRaiz.y), cm(ultimaRaiz.z));
      }
      const e = new THREE2.Euler().setFromQuaternion(local, "ZXY");
      valores.push(...[e.z, e.x, e.y].map((r) => (r * 180 / Math.PI).toFixed(4)));
    }
    linhas.push(valores.join(" "));
  }
  return linhas.join("\n");
}
function ordemDFS(js) {
  const por = new Map(js.map((j) => [j.nome, j]));
  const out = [];
  const visita = (j) => {
    out.push(j);
    for (const f of j.filhos) visita(por.get(f));
  };
  visita(js[0]);
  return out;
}
function lerBVH(txt) {
  const tok = txt.split(/\s+/).filter(Boolean);
  let i = 0;
  const pilha = [];
  const ordem = [];
  let raiz = null;
  while (tok[i] !== "MOTION") {
    const t = tok[i++];
    if (t === "ROOT" || t === "JOINT") {
      const n = { nome: tok[i++], off: new THREE2.Vector3(), canais: [], filhos: [], pai: pilha[pilha.length - 1] ?? null };
      if (n.pai) n.pai.filhos.push(n);
      else raiz = n;
      pilha.push(n);
      ordem.push(n);
    } else if (t === "End") {
      i++;
      pilha.push({ nome: "_fim", off: new THREE2.Vector3(), canais: [], filhos: [], pai: null });
    } else if (t === "OFFSET") {
      pilha[pilha.length - 1].off.set(+tok[i] / 100, +tok[i + 1] / 100, +tok[i + 2] / 100);
      i += 3;
    } else if (t === "CHANNELS") {
      const k = +tok[i++];
      pilha[pilha.length - 1].canais = tok.slice(i, i + k);
      i += k;
    } else if (t === "}") pilha.pop();
  }
  i++;
  const nq = +tok[i + 1];
  i += 2;
  i += 3;
  const quadros = [];
  for (let f = 0; f < nq; f++) {
    const pos = /* @__PURE__ */ new Map();
    const glob = /* @__PURE__ */ new Map();
    for (const n of ordem) {
      const v = n.canais.map(() => +tok[i++]);
      const T = new THREE2.Vector3().copy(n.off);
      let rot = v;
      if (n.canais.length === 6) {
        T.set(v[0] / 100, v[1] / 100, v[2] / 100);
        rot = v.slice(3);
      }
      const e = new THREE2.Euler(rot[1] * Math.PI / 180, rot[2] * Math.PI / 180, rot[0] * Math.PI / 180, "ZXY");
      const local = new THREE2.Matrix4().compose(T, new THREE2.Quaternion().setFromEuler(e), new THREE2.Vector3(1, 1, 1));
      const g2 = n.pai ? glob.get(n.pai).clone().multiply(local) : local;
      glob.set(n, g2);
      pos.set(n.nome, new THREE2.Vector3().setFromMatrixPosition(g2));
    }
    quadros.push(pos);
  }
  void raiz;
  return { nomes: ordem.map((n) => n.nome), quadros };
}

// ../../../gplansis-robo/projeto/frontend/src/core/esqueleto.ts
import * as THREE3 from "../three-0.170.0/three.module.min.js";

// ../../../gplansis-robo/projeto/shared/robot_spec.json
var robot_spec_default = {
  versao: "2.1.0",
  robo: "RV-02",
  descricao: "Humanoide de corpo inteiro: cabe\xE7a expressiva, tronco, dois bra\xE7os com m\xE3os de cinco dedos e duas pernas. Pelve fixa em mastro de suporte.",
  limites_provisorios: true,
  observacao: "Fonte \xFAnica da especifica\xE7\xE3o de juntas. Backend sincroniza no banco; front embute a mesma vers\xE3o. Alterou limite? Suba a vers\xE3o. Lados L/R s\xE3o do pr\xF3prio rob\xF4. 2.1.0: l\xEDngua (FACE.TONGUE) em canal livre, sem remapear servos existentes.",
  juntas: [
    {
      id: "FACE.NECK_PAN",
      tag: "RV02-FAC-NCK-PAN",
      grupo: "FACE",
      nome: "Pesco\xE7o \xB7 giro",
      min: -60,
      max: 60,
      home: 0,
      vmax: 160,
      filtro: "suave",
      placa: 64,
      canal: 0
    },
    {
      id: "FACE.NECK_TILT",
      tag: "RV02-FAC-NCK-TLT",
      grupo: "FACE",
      nome: "Pesco\xE7o \xB7 inclina\xE7\xE3o",
      min: -30,
      max: 30,
      home: 0,
      vmax: 120,
      filtro: "suave",
      placa: 64,
      canal: 1
    },
    {
      id: "FACE.NECK_ROLL",
      tag: "RV02-FAC-NCK-ROL",
      grupo: "FACE",
      nome: "Pesco\xE7o \xB7 rolagem",
      min: -20,
      max: 20,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 64,
      canal: 2
    },
    {
      id: "FACE.EYE_PAN",
      tag: "RV02-FAC-EYE-PAN",
      grupo: "FACE",
      nome: "Olhos \xB7 horizontal",
      min: -30,
      max: 30,
      home: 0,
      vmax: 600,
      filtro: "agil",
      placa: 64,
      canal: 3
    },
    {
      id: "FACE.EYE_TILT",
      tag: "RV02-FAC-EYE-TLT",
      grupo: "FACE",
      nome: "Olhos \xB7 vertical",
      min: -20,
      max: 20,
      home: 0,
      vmax: 600,
      filtro: "agil",
      placa: 64,
      canal: 4
    },
    {
      id: "FACE.LID_L",
      tag: "RV02-FAC-LID-L",
      grupo: "FACE",
      nome: "P\xE1lpebra esquerda",
      min: 0,
      max: 70,
      home: 8,
      vmax: 900,
      filtro: "agil",
      placa: 64,
      canal: 5
    },
    {
      id: "FACE.LID_R",
      tag: "RV02-FAC-LID-R",
      grupo: "FACE",
      nome: "P\xE1lpebra direita",
      min: 0,
      max: 70,
      home: 8,
      vmax: 900,
      filtro: "agil",
      placa: 64,
      canal: 6
    },
    {
      id: "FACE.JAW",
      tag: "RV02-FAC-JAW",
      grupo: "FACE",
      nome: "Mand\xEDbula",
      min: 0,
      max: 30,
      home: 0,
      vmax: 240,
      filtro: "agil",
      placa: 64,
      canal: 7
    },
    {
      id: "FACE.BROW_L",
      tag: "RV02-FAC-BRW-L",
      grupo: "FACE",
      nome: "Sobrancelha esquerda",
      min: -20,
      max: 20,
      home: 0,
      vmax: 300,
      filtro: "agil",
      placa: 64,
      canal: 8
    },
    {
      id: "FACE.BROW_R",
      tag: "RV02-FAC-BRW-R",
      grupo: "FACE",
      nome: "Sobrancelha direita",
      min: -20,
      max: 20,
      home: 0,
      vmax: 300,
      filtro: "agil",
      placa: 64,
      canal: 9
    },
    {
      id: "FACE.TONGUE",
      tag: "RV02-FAC-TNG-EXT",
      grupo: "FACE",
      nome: "L\xEDngua \xB7 extens\xE3o",
      min: 0,
      max: 60,
      home: 0,
      vmax: 240,
      filtro: "agil",
      placa: 68,
      canal: 3
    },
    {
      id: "CORPO.TORSO_YAW",
      tag: "RV02-CRP-TRC-YAW",
      grupo: "CORPO",
      nome: "Tronco \xB7 giro",
      min: -45,
      max: 45,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 64,
      canal: 10
    },
    {
      id: "CORPO.TORSO_PITCH",
      tag: "RV02-CRP-TRC-PIT",
      grupo: "CORPO",
      nome: "Tronco \xB7 flex\xE3o",
      min: -15,
      max: 35,
      home: 0,
      vmax: 60,
      filtro: "suave",
      placa: 64,
      canal: 11
    },
    {
      id: "CORPO.TORSO_ROLL",
      tag: "RV02-CRP-TRC-ROL",
      grupo: "CORPO",
      nome: "Tronco \xB7 inclina\xE7\xE3o lateral",
      min: -20,
      max: 20,
      home: 0,
      vmax: 60,
      filtro: "suave",
      placa: 64,
      canal: 12
    },
    {
      id: "CORPO.L_SH_PITCH",
      tag: "RV02-CRP-BE-SHP",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 ombro flex\xE3o",
      min: -45,
      max: 170,
      home: 0,
      vmax: 180,
      filtro: "agil",
      placa: 64,
      canal: 13
    },
    {
      id: "CORPO.L_SH_ROLL",
      tag: "RV02-CRP-BE-SHR",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 ombro abdu\xE7\xE3o",
      min: -10,
      max: 160,
      home: 6,
      vmax: 180,
      filtro: "agil",
      placa: 64,
      canal: 14
    },
    {
      id: "CORPO.L_SH_YAW",
      tag: "RV02-CRP-BE-SHY",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 ombro rota\xE7\xE3o",
      min: -80,
      max: 80,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 64,
      canal: 15
    },
    {
      id: "CORPO.L_ELBOW",
      tag: "RV02-CRP-BE-ELB",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 cotovelo",
      min: 0,
      max: 145,
      home: 10,
      vmax: 220,
      filtro: "agil",
      placa: 65,
      canal: 0
    },
    {
      id: "CORPO.L_W_ROLL",
      tag: "RV02-CRP-BE-WRR",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 punho rota\xE7\xE3o",
      min: -90,
      max: 90,
      home: 0,
      vmax: 240,
      filtro: "agil",
      placa: 65,
      canal: 1
    },
    {
      id: "CORPO.L_W_PITCH",
      tag: "RV02-CRP-BE-WRP",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 punho flex\xE3o",
      min: -70,
      max: 70,
      home: 0,
      vmax: 240,
      filtro: "agil",
      placa: 65,
      canal: 2
    },
    {
      id: "CORPO.L_W_YAW",
      tag: "RV02-CRP-BE-WRY",
      grupo: "CORPO",
      nome: "Bra\xE7o esq. \xB7 punho desvio",
      min: -30,
      max: 30,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 65,
      canal: 3
    },
    {
      id: "CORPO.R_SH_PITCH",
      tag: "RV02-CRP-BD-SHP",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 ombro flex\xE3o",
      min: -45,
      max: 170,
      home: 0,
      vmax: 180,
      filtro: "agil",
      placa: 65,
      canal: 4
    },
    {
      id: "CORPO.R_SH_ROLL",
      tag: "RV02-CRP-BD-SHR",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 ombro abdu\xE7\xE3o",
      min: -10,
      max: 160,
      home: 6,
      vmax: 180,
      filtro: "agil",
      placa: 65,
      canal: 5
    },
    {
      id: "CORPO.R_SH_YAW",
      tag: "RV02-CRP-BD-SHY",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 ombro rota\xE7\xE3o",
      min: -80,
      max: 80,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 65,
      canal: 6
    },
    {
      id: "CORPO.R_ELBOW",
      tag: "RV02-CRP-BD-ELB",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 cotovelo",
      min: 0,
      max: 145,
      home: 10,
      vmax: 220,
      filtro: "agil",
      placa: 65,
      canal: 7
    },
    {
      id: "CORPO.R_W_ROLL",
      tag: "RV02-CRP-BD-WRR",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 punho rota\xE7\xE3o",
      min: -90,
      max: 90,
      home: 0,
      vmax: 240,
      filtro: "agil",
      placa: 65,
      canal: 8
    },
    {
      id: "CORPO.R_W_PITCH",
      tag: "RV02-CRP-BD-WRP",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 punho flex\xE3o",
      min: -70,
      max: 70,
      home: 0,
      vmax: 240,
      filtro: "agil",
      placa: 65,
      canal: 9
    },
    {
      id: "CORPO.R_W_YAW",
      tag: "RV02-CRP-BD-WRY",
      grupo: "CORPO",
      nome: "Bra\xE7o dir. \xB7 punho desvio",
      min: -30,
      max: 30,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 65,
      canal: 10
    },
    {
      id: "CORPO.L_HIP_PITCH",
      tag: "RV02-CRP-PE-HPP",
      grupo: "CORPO",
      nome: "Perna esq. \xB7 quadril flex\xE3o",
      min: -30,
      max: 110,
      home: 0,
      vmax: 120,
      filtro: "suave",
      placa: 65,
      canal: 11
    },
    {
      id: "CORPO.L_HIP_ROLL",
      tag: "RV02-CRP-PE-HPR",
      grupo: "CORPO",
      nome: "Perna esq. \xB7 quadril abdu\xE7\xE3o",
      min: -15,
      max: 45,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 65,
      canal: 12
    },
    {
      id: "CORPO.L_HIP_YAW",
      tag: "RV02-CRP-PE-HPY",
      grupo: "CORPO",
      nome: "Perna esq. \xB7 quadril rota\xE7\xE3o",
      min: -40,
      max: 40,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 65,
      canal: 13
    },
    {
      id: "CORPO.L_KNEE",
      tag: "RV02-CRP-PE-KNE",
      grupo: "CORPO",
      nome: "Perna esq. \xB7 joelho",
      min: 0,
      max: 130,
      home: 0,
      vmax: 150,
      filtro: "suave",
      placa: 65,
      canal: 14
    },
    {
      id: "CORPO.L_ANK_PITCH",
      tag: "RV02-CRP-PE-ANP",
      grupo: "CORPO",
      nome: "Perna esq. \xB7 tornozelo flex\xE3o",
      min: -40,
      max: 30,
      home: 0,
      vmax: 120,
      filtro: "suave",
      placa: 65,
      canal: 15
    },
    {
      id: "CORPO.L_ANK_ROLL",
      tag: "RV02-CRP-PE-ANR",
      grupo: "CORPO",
      nome: "Perna esq. \xB7 tornozelo invers\xE3o",
      min: -45,
      max: 20,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 66,
      canal: 0
    },
    {
      id: "CORPO.R_HIP_PITCH",
      tag: "RV02-CRP-PD-HPP",
      grupo: "CORPO",
      nome: "Perna dir. \xB7 quadril flex\xE3o",
      min: -30,
      max: 110,
      home: 0,
      vmax: 120,
      filtro: "suave",
      placa: 66,
      canal: 1
    },
    {
      id: "CORPO.R_HIP_ROLL",
      tag: "RV02-CRP-PD-HPR",
      grupo: "CORPO",
      nome: "Perna dir. \xB7 quadril abdu\xE7\xE3o",
      min: -15,
      max: 45,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 66,
      canal: 2
    },
    {
      id: "CORPO.R_HIP_YAW",
      tag: "RV02-CRP-PD-HPY",
      grupo: "CORPO",
      nome: "Perna dir. \xB7 quadril rota\xE7\xE3o",
      min: -40,
      max: 40,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 66,
      canal: 3
    },
    {
      id: "CORPO.R_KNEE",
      tag: "RV02-CRP-PD-KNE",
      grupo: "CORPO",
      nome: "Perna dir. \xB7 joelho",
      min: 0,
      max: 130,
      home: 0,
      vmax: 150,
      filtro: "suave",
      placa: 66,
      canal: 4
    },
    {
      id: "CORPO.R_ANK_PITCH",
      tag: "RV02-CRP-PD-ANP",
      grupo: "CORPO",
      nome: "Perna dir. \xB7 tornozelo flex\xE3o",
      min: -40,
      max: 30,
      home: 0,
      vmax: 120,
      filtro: "suave",
      placa: 66,
      canal: 5
    },
    {
      id: "CORPO.R_ANK_ROLL",
      tag: "RV02-CRP-PD-ANR",
      grupo: "CORPO",
      nome: "Perna dir. \xB7 tornozelo invers\xE3o",
      min: -45,
      max: 20,
      home: 0,
      vmax: 90,
      filtro: "suave",
      placa: 66,
      canal: 6
    },
    {
      id: "MAO_L.T_OPP",
      tag: "RV02-MAE-THB-OPP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Polegar oposi\xE7\xE3o",
      min: 0,
      max: 90,
      home: 20,
      vmax: 300,
      filtro: "agil",
      placa: 66,
      canal: 7
    },
    {
      id: "MAO_L.T_MCP",
      tag: "RV02-MAE-THB-MCP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Polegar MCP",
      min: 0,
      max: 60,
      home: 10,
      vmax: 400,
      filtro: "agil",
      placa: 66,
      canal: 8
    },
    {
      id: "MAO_L.T_IP",
      tag: "RV02-MAE-THB-IP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Polegar IP",
      min: 0,
      max: 80,
      home: 10,
      vmax: 400,
      filtro: "agil",
      placa: 66,
      canal: 9
    },
    {
      id: "MAO_L.I_ABD",
      tag: "RV02-MAE-IDX-ABD",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Indicador abdu\xE7\xE3o",
      min: -15,
      max: 15,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 66,
      canal: 10
    },
    {
      id: "MAO_L.I_MCP",
      tag: "RV02-MAE-IDX-MCP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Indicador MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 66,
      canal: 11
    },
    {
      id: "MAO_L.I_PIP",
      tag: "RV02-MAE-IDX-PIP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Indicador PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 66,
      canal: 12
    },
    {
      id: "MAO_L.M_MCP",
      tag: "RV02-MAE-MID-MCP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 M\xE9dio MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 66,
      canal: 13
    },
    {
      id: "MAO_L.M_PIP",
      tag: "RV02-MAE-MID-PIP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 M\xE9dio PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 66,
      canal: 14
    },
    {
      id: "MAO_L.R_ABD",
      tag: "RV02-MAE-RNG-ABD",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Anelar abdu\xE7\xE3o",
      min: -15,
      max: 15,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 66,
      canal: 15
    },
    {
      id: "MAO_L.R_MCP",
      tag: "RV02-MAE-RNG-MCP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Anelar MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 0
    },
    {
      id: "MAO_L.R_PIP",
      tag: "RV02-MAE-RNG-PIP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 Anelar PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 1
    },
    {
      id: "MAO_L.P_ABD",
      tag: "RV02-MAE-PNK-ABD",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 M\xEDnimo abdu\xE7\xE3o",
      min: -20,
      max: 20,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 67,
      canal: 2
    },
    {
      id: "MAO_L.P_MCP",
      tag: "RV02-MAE-PNK-MCP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 M\xEDnimo MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 3
    },
    {
      id: "MAO_L.P_PIP",
      tag: "RV02-MAE-PNK-PIP",
      grupo: "MAO_L",
      nome: "M\xE3o esq. \xB7 M\xEDnimo PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 4
    },
    {
      id: "MAO_R.T_OPP",
      tag: "RV02-MAD-THB-OPP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Polegar oposi\xE7\xE3o",
      min: 0,
      max: 90,
      home: 20,
      vmax: 300,
      filtro: "agil",
      placa: 67,
      canal: 5
    },
    {
      id: "MAO_R.T_MCP",
      tag: "RV02-MAD-THB-MCP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Polegar MCP",
      min: 0,
      max: 60,
      home: 10,
      vmax: 400,
      filtro: "agil",
      placa: 67,
      canal: 6
    },
    {
      id: "MAO_R.T_IP",
      tag: "RV02-MAD-THB-IP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Polegar IP",
      min: 0,
      max: 80,
      home: 10,
      vmax: 400,
      filtro: "agil",
      placa: 67,
      canal: 7
    },
    {
      id: "MAO_R.I_ABD",
      tag: "RV02-MAD-IDX-ABD",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Indicador abdu\xE7\xE3o",
      min: -15,
      max: 15,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 67,
      canal: 8
    },
    {
      id: "MAO_R.I_MCP",
      tag: "RV02-MAD-IDX-MCP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Indicador MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 9
    },
    {
      id: "MAO_R.I_PIP",
      tag: "RV02-MAD-IDX-PIP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Indicador PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 10
    },
    {
      id: "MAO_R.M_MCP",
      tag: "RV02-MAD-MID-MCP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 M\xE9dio MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 11
    },
    {
      id: "MAO_R.M_PIP",
      tag: "RV02-MAD-MID-PIP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 M\xE9dio PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 12
    },
    {
      id: "MAO_R.R_ABD",
      tag: "RV02-MAD-RNG-ABD",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Anelar abdu\xE7\xE3o",
      min: -15,
      max: 15,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 67,
      canal: 13
    },
    {
      id: "MAO_R.R_MCP",
      tag: "RV02-MAD-RNG-MCP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Anelar MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 14
    },
    {
      id: "MAO_R.R_PIP",
      tag: "RV02-MAD-RNG-PIP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 Anelar PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 67,
      canal: 15
    },
    {
      id: "MAO_R.P_ABD",
      tag: "RV02-MAD-PNK-ABD",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 M\xEDnimo abdu\xE7\xE3o",
      min: -20,
      max: 20,
      home: 0,
      vmax: 200,
      filtro: "agil",
      placa: 68,
      canal: 0
    },
    {
      id: "MAO_R.P_MCP",
      tag: "RV02-MAD-PNK-MCP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 M\xEDnimo MCP",
      min: 0,
      max: 90,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 68,
      canal: 1
    },
    {
      id: "MAO_R.P_PIP",
      tag: "RV02-MAD-PNK-PIP",
      grupo: "MAO_R",
      nome: "M\xE3o dir. \xB7 M\xEDnimo PIP",
      min: 0,
      max: 100,
      home: 10,
      vmax: 450,
      filtro: "agil",
      placa: 68,
      canal: 2
    }
  ]
};

// ../../../gplansis-robo/projeto/frontend/src/core/spec.ts
var SPEC = robot_spec_default;
var JUNTAS = SPEC.juntas;
var JUNTA = new Map(JUNTAS.map((j) => [j.id, j]));
var D2R = Math.PI / 180;
var R2D = 180 / Math.PI;

// ../../../gplansis-robo/projeto/frontend/src/core/esqueleto.ts
var LADOS = ["L", "R"];
var SINAL = { L: 1, R: -1 };
var MEDIDAS = {
  pelveY: 1.86,
  quadrilX: 0.18,
  ombroX: 0.36,
  ombroY: 0.98,
  pescocoY: 1.06,
  braco: 0.6,
  antebraco: 0.54,
  coxa: 0.86,
  canela: 0.84,
  // marcadores rígidos no referencial do punho e do pé (usados como landmarks sintéticos)
  indicador: [0, -0.3, 0.06],
  minimo: [0, -0.28, -0.06],
  polegar: [-0.05, -0.14, 0.09],
  // x multiplicado pelo sinal do lado (polegar para dentro)
  calcanhar: [0, -0.1, -0.08],
  pontaPe: [0, -0.1, 0.4],
  nariz: [0, 0.34, 0.22]
};
var MARCADOR_MP = {
  NARIZ: 0,
  L_OMBRO: 11,
  R_OMBRO: 12,
  L_COTOVELO: 13,
  R_COTOVELO: 14,
  L_PULSO: 15,
  R_PULSO: 16,
  L_MINIMO: 17,
  R_MINIMO: 18,
  L_INDICADOR: 19,
  R_INDICADOR: 20,
  L_POLEGAR: 21,
  R_POLEGAR: 22,
  L_QUADRIL: 23,
  R_QUADRIL: 24,
  L_JOELHO: 25,
  R_JOELHO: 26,
  L_TORNOZELO: 27,
  R_TORNOZELO: 28,
  L_CALCANHAR: 29,
  R_CALCANHAR: 30,
  L_PONTA_PE: 31,
  R_PONTA_PE: 32
};
var g = (pai, x = 0, y = 0, z = 0) => {
  const n = new THREE3.Group();
  n.position.set(x, y, z);
  pai.add(n);
  return n;
};
var marca = (pai, p, sx = 1) => {
  const m = new THREE3.Object3D();
  m.position.set((p[0] ?? 0) * sx, p[1] ?? 0, p[2] ?? 0);
  pai.add(m);
  return m;
};
function criarEsqueleto() {
  const M = MEDIDAS;
  const juntas = /* @__PURE__ */ new Map();
  const marcadores = {};
  const raiz = new THREE3.Group();
  const pelve = g(raiz, 0, M.pelveY, 0);
  const tronco = g(pelve);
  tronco.rotation.order = "YXZ";
  juntas.set("CORPO.TORSO_YAW", (v) => tronco.rotation.y = v * D2R);
  juntas.set("CORPO.TORSO_PITCH", (v) => tronco.rotation.x = v * D2R);
  juntas.set("CORPO.TORSO_ROLL", (v) => tronco.rotation.z = v * D2R);
  const pescoco = g(tronco, 0, M.pescocoY, 0);
  marcadores.NARIZ = marca(pescoco, M.nariz);
  const braco = {};
  const perna = {};
  for (const lado of LADOS) {
    const s = SINAL[lado];
    const shP = g(tronco, s * M.ombroX, M.ombroY, 0);
    const shR = g(shP);
    const shY = g(shR);
    juntas.set(`CORPO.${lado}_SH_PITCH`, (v) => shP.rotation.x = -v * D2R);
    juntas.set(`CORPO.${lado}_SH_ROLL`, (v) => shR.rotation.z = s * v * D2R);
    juntas.set(`CORPO.${lado}_SH_YAW`, (v) => shY.rotation.y = s * v * D2R);
    const cot = g(shY, 0, -M.braco, 0);
    juntas.set(`CORPO.${lado}_ELBOW`, (v) => cot.rotation.x = -v * D2R);
    const pun = g(cot, 0, -M.antebraco, 0);
    pun.rotation.order = "YXZ";
    juntas.set(`CORPO.${lado}_W_PITCH`, (v) => pun.rotation.x = v * D2R);
    juntas.set(`CORPO.${lado}_W_ROLL`, (v) => pun.rotation.y = s * v * D2R);
    juntas.set(`CORPO.${lado}_W_YAW`, (v) => pun.rotation.z = s * v * D2R);
    marcadores[`${lado}_OMBRO`] = shP;
    marcadores[`${lado}_COTOVELO`] = cot;
    marcadores[`${lado}_PULSO`] = pun;
    marcadores[`${lado}_INDICADOR`] = marca(pun, M.indicador);
    marcadores[`${lado}_MINIMO`] = marca(pun, M.minimo);
    marcadores[`${lado}_POLEGAR`] = marca(pun, M.polegar, s);
    braco[lado] = { ombro: shY, antebraco: cot, mao: pun };
    const hpP = g(pelve, s * M.quadrilX, 0, 0);
    const hpR = g(hpP);
    const hpY = g(hpR);
    juntas.set(`CORPO.${lado}_HIP_PITCH`, (v) => hpP.rotation.x = -v * D2R);
    juntas.set(`CORPO.${lado}_HIP_ROLL`, (v) => hpR.rotation.z = s * v * D2R);
    juntas.set(`CORPO.${lado}_HIP_YAW`, (v) => hpY.rotation.y = s * v * D2R);
    const joe = g(hpY, 0, -M.coxa, 0);
    juntas.set(`CORPO.${lado}_KNEE`, (v) => joe.rotation.x = v * D2R);
    const tnP = g(joe, 0, -M.canela, 0);
    const tnR = g(tnP);
    juntas.set(`CORPO.${lado}_ANK_PITCH`, (v) => tnP.rotation.x = -v * D2R);
    juntas.set(`CORPO.${lado}_ANK_ROLL`, (v) => tnR.rotation.z = s * v * D2R);
    marcadores[`${lado}_QUADRIL`] = hpP;
    marcadores[`${lado}_JOELHO`] = joe;
    marcadores[`${lado}_TORNOZELO`] = tnP;
    marcadores[`${lado}_CALCANHAR`] = marca(tnR, M.calcanhar);
    marcadores[`${lado}_PONTA_PE`] = marca(tnR, M.pontaPe);
    perna[lado] = { coxa: hpY, canela: joe, pe: tnR };
  }
  return { raiz, pelve, tronco, pescoco, braco, perna, juntas, marcadores };
}
function fkMarcadores(e, pose) {
  for (const [id, set] of e.juntas) set(pose[id] ?? 0);
  e.raiz.updateMatrixWorld(true);
  const out = {};
  for (const [nome, m] of Object.entries(e.marcadores)) out[nome] = m.getWorldPosition(new THREE3.Vector3());
  return out;
}

// ../../../gplansis-robo/projeto/frontend/src/core/simulador.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = a;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var HOME_CORPO = Object.fromEntries(JUNTAS.filter((j) => j.grupo === "CORPO").map((j) => [j.id, j.home]));
function sintetizarPose(e, pose, modo, visPernas = 0.99) {
  const marc = fkMarcadores(e, { ...HOME_CORPO, ...pose });
  const mundo = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const vis = Array.from({ length: 33 }, () => 0);
  const quadril = marc.L_QUADRIL.clone().add(marc.R_QUADRIL).multiplyScalar(0.5);
  for (const [nome, v] of Object.entries(marc)) {
    const nomePessoa = modo === "direto" || nome === "NARIZ" ? nome : nome.startsWith("L_") ? `R_${nome.slice(2)}` : `L_${nome.slice(2)}`;
    const i = MARCADOR_MP[nomePessoa];
    if (i === void 0) continue;
    const r = v.clone().sub(quadril).multiplyScalar(0.5);
    mundo[i] = { x: modo === "direto" ? r.x : -r.x, y: -r.y, z: -r.z };
    vis[i] = /JOELHO|TORNOZELO|CALCANHAR|PONTA_PE/.test(nome) ? visPernas : 0.99;
  }
  const n = mundo[0];
  for (let i = 1; i <= 10; i++) {
    mundo[i] = { x: n.x + (i % 2 ? 1 : -1) * 0.03 * Math.ceil(i / 2), y: n.y - 0.02, z: n.z };
    vis[i] = 0.99;
  }
  const img = mundo.map((p) => ({ x: 0.5 + p.x * 0.42, y: 0.56 + p.y * 0.42 }));
  return { img, mundo, vis, conf: 0.97 };
}
var GESTOS = {
  aberta: { T_OPP: 15, T_MCP: 5, T_IP: 5, I_MCP: 5, I_PIP: 5, M_MCP: 5, M_PIP: 5, R_MCP: 5, R_PIP: 5, P_MCP: 5, P_PIP: 5, I_ABD: 10, R_ABD: 8, P_ABD: 14 },
  punho: { T_OPP: 70, T_MCP: 45, T_IP: 55, I_MCP: 85, I_PIP: 95, M_MCP: 85, M_PIP: 95, R_MCP: 85, R_PIP: 95, P_MCP: 85, P_PIP: 95, I_ABD: 0, R_ABD: 0, P_ABD: 0 },
  aponta: { T_OPP: 70, T_MCP: 40, T_IP: 50, I_MCP: 5, I_PIP: 5, M_MCP: 85, M_PIP: 95, R_MCP: 85, R_PIP: 95, P_MCP: 85, P_PIP: 95, I_ABD: 0, R_ABD: 0, P_ABD: 0 },
  paz: { T_OPP: 70, T_MCP: 40, T_IP: 50, I_MCP: 5, I_PIP: 5, M_MCP: 5, M_PIP: 5, R_MCP: 85, R_PIP: 95, P_MCP: 85, P_PIP: 95, I_ABD: 12, R_ABD: 0, P_ABD: 0 },
  ok: { T_OPP: 80, T_MCP: 30, T_IP: 35, I_MCP: 45, I_PIP: 70, M_MCP: 8, M_PIP: 8, R_MCP: 10, R_PIP: 10, P_MCP: 12, P_PIP: 12, I_ABD: 0, R_ABD: 6, P_ABD: 12 },
  relaxada: { T_OPP: 25, T_MCP: 15, T_IP: 15, I_MCP: 18, I_PIP: 22, M_MCP: 22, M_PIP: 26, R_MCP: 26, R_PIP: 30, P_MCP: 30, P_PIP: 34, I_ABD: 4, R_ABD: 4, P_ABD: 6 }
};
var mistura = (a, b, k) => Object.fromEntries(Object.keys({ ...a, ...b }).map((j) => [j, (a[j] ?? 0) * (1 - k) + (b[j] ?? 0) * k]));
var CENAS = [
  { nome: "acenar", mao: ["relaxada", "aberta"], pose: (t) => ({
    "CORPO.R_SH_ROLL": 70,
    "CORPO.R_SH_PITCH": 25,
    "CORPO.R_ELBOW": 75,
    "CORPO.R_SH_YAW": 20 + 28 * Math.sin(7 * t),
    "CORPO.R_W_PITCH": -10,
    "CORPO.TORSO_ROLL": 4,
    "CORPO.L_ELBOW": 14,
    "CORPO.L_SH_ROLL": 8
  }) },
  { nome: "abrir os bra\xE7os", mao: ["aberta", "aberta"], pose: (t) => ({
    "CORPO.L_SH_ROLL": 85,
    "CORPO.R_SH_ROLL": 85,
    "CORPO.L_ELBOW": 12,
    "CORPO.R_ELBOW": 12,
    "CORPO.L_W_ROLL": 60,
    "CORPO.R_W_ROLL": 60,
    "CORPO.TORSO_YAW": 12 * Math.sin(1.4 * t),
    "CORPO.TORSO_PITCH": -6
  }) },
  { nome: "agachar", mao: ["punho", "punho"], pose: (t) => {
    const k = 0.5 - 0.5 * Math.cos(1.6 * t);
    return {
      "CORPO.L_HIP_PITCH": 55 * k,
      "CORPO.R_HIP_PITCH": 55 * k,
      "CORPO.L_KNEE": 95 * k,
      "CORPO.R_KNEE": 95 * k,
      "CORPO.L_ANK_PITCH": 28 * k,
      "CORPO.R_ANK_PITCH": 28 * k,
      "CORPO.TORSO_PITCH": 22 * k,
      "CORPO.L_SH_PITCH": 80 * k,
      "CORPO.R_SH_PITCH": 80 * k,
      "CORPO.L_ELBOW": 20,
      "CORPO.R_ELBOW": 20
    };
  } },
  { nome: "torcer o tronco", mao: ["relaxada", "relaxada"], pose: (t) => ({
    "CORPO.TORSO_YAW": 32 * Math.sin(1.3 * t),
    "CORPO.L_ELBOW": 95,
    "CORPO.R_ELBOW": 95,
    "CORPO.L_SH_PITCH": 35,
    "CORPO.R_SH_PITCH": 35,
    "CORPO.L_SH_ROLL": 20,
    "CORPO.R_SH_ROLL": 20,
    "CORPO.L_W_PITCH": 15,
    "CORPO.R_W_PITCH": 15
  }) },
  { nome: "joelho alto", mao: ["punho", "punho"], pose: (t) => {
    const k = 0.5 - 0.5 * Math.cos(2 * t);
    return {
      "CORPO.L_HIP_PITCH": 78 * k,
      "CORPO.L_KNEE": 92 * k,
      "CORPO.L_ANK_PITCH": -12 * k,
      "CORPO.L_HIP_YAW": 10 * k,
      "CORPO.R_SH_PITCH": 45 * k,
      "CORPO.R_ELBOW": 80,
      "CORPO.L_SH_PITCH": -20 * k,
      "CORPO.L_ELBOW": 70,
      "CORPO.R_HIP_ROLL": 4,
      "CORPO.R_ANK_ROLL": -4
    };
  } },
  { nome: "apontar", mao: ["relaxada", "aponta"], pose: (t) => ({
    "CORPO.R_SH_PITCH": 88,
    "CORPO.R_SH_ROLL": 18 + 12 * Math.sin(0.9 * t),
    "CORPO.R_ELBOW": 6,
    "CORPO.R_W_YAW": 10,
    "CORPO.TORSO_YAW": -14,
    "CORPO.TORSO_ROLL": -5,
    "CORPO.L_SH_ROLL": 12,
    "CORPO.L_ELBOW": 30,
    "CORPO.L_HIP_ROLL": 10,
    "CORPO.L_ANK_ROLL": -10
  }) },
  { nome: "sinal de paz", mao: ["paz", "ok"], pose: (t) => ({
    "CORPO.L_SH_PITCH": 30,
    "CORPO.L_ELBOW": 120,
    "CORPO.L_SH_ROLL": 25,
    "CORPO.L_W_ROLL": 70 + 10 * Math.sin(2 * t),
    "CORPO.R_SH_PITCH": 30,
    "CORPO.R_ELBOW": 120,
    "CORPO.R_SH_ROLL": 25,
    "CORPO.R_W_ROLL": 70,
    "CORPO.TORSO_PITCH": -4
  }) }
];
var CENA_S = 5.5;
var TRANS_S = 1.2;
var Simulador = class {
  constructor(semente = 20260925) {
    this.semente = semente;
    __publicField(this, "f");
    __publicField(this, "esq", criarEsqueleto());
    __publicField(this, "cenaAtual", "");
    const r = mulberry32(semente);
    this.f = Array.from({ length: 12 }, () => r() * Math.PI * 2);
  }
  /** Ângulos de corpo da coreografia no instante t (s), lados do robô. */
  poseCorpo(t) {
    const idx = Math.floor(t / CENA_S) % CENAS.length;
    const prox = (idx + 1) % CENAS.length;
    const tc = t % CENA_S;
    const k = Math.min(1, Math.max(0, (tc - (CENA_S - TRANS_S)) / TRANS_S));
    const kk = k * k * (3 - 2 * k);
    const a = { ...HOME_CORPO, ...CENAS[idx].pose(t) };
    const b = { ...HOME_CORPO, ...CENAS[prox].pose(t) };
    const respira = 1.5 * Math.sin(1.1 * t + (this.f[0] ?? 0));
    const pose = mistura(a, b, kk);
    pose["CORPO.TORSO_PITCH"] = (pose["CORPO.TORSO_PITCH"] ?? 0) + respira;
    return { pose, cena: idx, k: kk };
  }
  observar(tMs, modo) {
    const t = tMs / 1e3;
    const f = this.f;
    const ciclo = t % (CENA_S * CENAS.length);
    const corpoPresente = !(ciclo > 30.2 && ciclo < 32.6);
    const facePresente = corpoPresente && !(ciclo > 20 && ciclo < 21.8);
    const pernasNoQuadro = !(ciclo > 17.6 && ciclo < 20.8);
    let face = null;
    if (facePresente) {
      const nx = 0.5 + 0.12 * Math.sin(0.35 * t + f[0]) + 0.03 * Math.sin(1.3 * t + f[1]);
      const ny = 0.24 + 0.05 * Math.sin(0.27 * t + f[2]);
      const piscada = (t + f[3]) % 3.7 < 0.14 ? 1 : 0;
      const fala = Math.max(0, Math.sin(2.1 * t + f[4])) * (Math.sin(0.2 * t) > 0.3 ? 0.6 : 0);
      face = {
        pts: [],
        nariz: { x: nx, y: ny },
        bbox: { x0: nx - 0.06, y0: ny - 0.08, x1: nx + 0.06, y1: ny + 0.08 },
        yawProxy: 0.3 * Math.sin(0.4 * t + f[5]),
        pitchProxy: 0.55 + 0.08 * Math.sin(0.3 * t + f[6]),
        rollGraus: 6 * Math.sin(0.25 * t + f[7]),
        blend: {
          eyeBlinkLeft: piscada,
          eyeBlinkRight: piscada,
          jawOpen: fala,
          browInnerUp: Math.max(0, Math.sin(0.5 * t + f[8])) * 0.6
        }
      };
    }
    let corpo = null;
    const maos = [];
    const dedos = [];
    if (corpoPresente) {
      const { pose, cena, k } = this.poseCorpo(t);
      this.cenaAtual = CENAS[cena].nome;
      corpo = sintetizarPose(this.esq, pose, modo, pernasNoQuadro ? 0.99 : 0.08);
      const [gL, gR] = CENAS[cena].mao;
      const [nL, nR] = CENAS[(cena + 1) % CENAS.length].mao;
      const gestoRobo = { L: mistura(GESTOS[gL], GESTOS[nL], k), R: mistura(GESTOS[gR], GESTOS[nR], k) };
      for (const [iPulso, ladoPessoa] of [[15, "L"], [16, "R"]]) {
        const ladoRobo = modo === "direto" ? ladoPessoa : ladoPessoa === "L" ? "R" : "L";
        const semMao = ladoRobo === "L" && ciclo > 24 && ciclo < 26.5;
        const w = corpo.img[iPulso];
        if (!w || semMao) continue;
        maos.push({ img: [w, ...Array.from({ length: 20 }, () => w)], mundo: [], conf: 0.96, lado: "simulada" });
        dedos.push(gestoRobo[ladoRobo]);
      }
    } else {
      this.cenaAtual = "";
    }
    return { t: tMs, fonte: "simulacao", face, corpo, maos, latenciaMs: 0, sintetico: { dedos } };
  }
};

// ../../../gplansis-robo/projeto/frontend/src/core/mocap/sintetico.ts
var HOME = Object.fromEntries(JUNTAS.filter((j) => j.grupo === "CORPO").map((j) => [j.id, j.home]));
function pessoaNoTempo(t, e = criarEsqueleto(), sim = new Simulador()) {
  const marc = fkMarcadores(e, { ...HOME, ...sim.poseCorpo(t).pose });
  const out = Array.from({ length: 33 }, () => [0, 0, 0]);
  const yaw = 0.5 * Math.sin(0.23 * t), dx = 0.35 * Math.sin(0.17 * t), dz = 0.3 * Math.sin(0.11 * t + 1);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const noMundo = (v) => {
    const x = v.x * 0.5, y = v.y * 0.5 - 0.02, z = v.z * 0.5;
    return [c * x + s * z + dx, y, -s * x + c * z + dz];
  };
  for (const [nome, v] of Object.entries(marc)) {
    const i = MARCADOR_MP[nome];
    if (i !== void 0) out[i] = noMundo(v);
  }
  const piso = Math.min(...[27, 28, 29, 30, 31, 32].map((k) => out[k][1]));
  for (const p of out) p[1] -= piso - 0.01;
  const n = out[0];
  const esq = unit(sub(out[11], out[12]));
  for (let i = 1; i <= 10; i++) {
    const lado = i <= 3 || i === 7 || i === 9 ? 1 : -1;
    const afast = i === 7 || i === 8 ? 0.075 : i >= 9 ? 0.025 : 0.035;
    const alt = i >= 9 ? -0.05 : i === 7 || i === 8 ? 0 : 0.035;
    out[i] = add(add(n, mul(esq, lado * afast)), [0, alt, i === 7 || i === 8 ? -0.07 : -0.01]);
  }
  return out;
}
function cameraOlhando(id, pos, alvo, fov = 62, largura = 1280, altura = 720) {
  const frente = unit(sub(alvo, pos));
  const direita = unit(cross(frente, [0, 1, 0]));
  const baixo = cross(frente, direita);
  const R = [direita, baixo, frente];
  const t = mul([dot(direita, pos), dot(baixo, pos), dot(frente, pos)], -1);
  return { id, largura, altura, f: focalDoFov(largura, fov), cx: largura / 2, cy: altura / 2, R, t };
}
function gerarSessao(segundos = 12, fps = 30, nCam = 3, ruidoPx = 1.5, semente = 7) {
  const R = mulberry32(semente);
  const gauss = () => Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(2 * Math.PI * R());
  const angs = nCam === 2 ? [-35, 35] : nCam === 3 ? [-45, 5, 50] : [-60, -20, 25, 65].slice(0, nCam);
  const cams = angs.map((a, i) => {
    const r = a * Math.PI / 180;
    return cameraOlhando(`cam${i + 1}`, [3.2 * Math.sin(r), 1.25 + 0.15 * (i % 2), 3.2 * Math.cos(r)], [0, 0.95, 0]);
  });
  const e = criarEsqueleto(), sim = new Simulador();
  const verdade = [], quadros = [];
  for (let f = 0; f < segundos * fps; f++) {
    const P = pessoaNoTempo(f / fps, e, sim);
    verdade.push(P);
    const quadril = add(P[23], P[24]), centro = mul(quadril, 0.5);
    const esq = unit(sub(P[23], P[24]));
    quadros.push(cams.map((c) => {
      const pos = mul([c.R[0][0] * c.t[0] + c.R[1][0] * c.t[1] + c.R[2][0] * c.t[2], c.R[0][1] * c.t[0] + c.R[1][1] * c.t[1] + c.R[2][1] * c.t[2], c.R[0][2] * c.t[0] + c.R[1][2] * c.t[1] + c.R[2][2] * c.t[2]], -1);
      const d = unit(sub(pos, centro));
      const px = [], vis = [];
      P.forEach((X, k) => {
        const q = projetar(c, X);
        const lado = k >= 11 ? k % 2 === 1 ? 1 : -1 : 0;
        let v = 0.97;
        if (lado && lado * dot(esq, d) < -0.75) v = 0.3;
        if (R() < 0.04) v = 0.2;
        if (!q || q[0] < 0 || q[1] < 0 || q[0] > c.largura || q[1] > c.altura) {
          px.push(null);
          vis.push(0);
          return;
        }
        px.push([q[0] + gauss() * ruidoPx, q[1] + gauss() * ruidoPx]);
        vis.push(v);
      });
      return { px, vis };
    }));
  }
  return { fps, verdade, camerasVerdade: cams, quadros };
}

// ../../../gplansis-robo/projeto/frontend/src/core/filtros.ts
var alpha = (fc, dt) => {
  const tau = 1 / (2 * Math.PI * fc);
  return 1 / (1 + tau / dt);
};
var OneEuro = class {
  constructor(minCutoff, beta, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    __publicField(this, "x", null);
    __publicField(this, "dx", 0);
  }
  filtrar(v, dt) {
    if (this.x === null || dt <= 0) {
      this.x = v;
      return v;
    }
    const d = (v - this.x) / dt;
    this.dx = this.dx + alpha(this.dCutoff, dt) * (d - this.dx);
    const fc = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x = this.x + alpha(fc, dt) * (v - this.x);
    return this.x;
  }
  reset(v) {
    this.x = v ?? null;
    this.dx = 0;
  }
};
export {
  NOMES_MP,
  OSSOS,
  OneEuro,
  SEGMENTOS,
  add,
  ajusteDeFeixe,
  angulos,
  autocalibrar,
  baseDeSuporte,
  butterworthFaseZero,
  cameraOlhando,
  casco,
  centroCamera,
  centroDeMassa,
  cross,
  det3,
  dot,
  eigSim,
  essencial8,
  filtrarTrilha,
  focalDoFov,
  gerarSessao,
  lerBVH,
  margem,
  mm,
  mul,
  mv,
  norma,
  normalizar,
  nucleo,
  ossosRigidos,
  paraBVH,
  paraCSV,
  paraJSON,
  pessoaNoTempo,
  preencherLacunas,
  processar,
  projetar,
  rodrigues,
  sampson,
  sub,
  svd3,
  transp,
  triangular,
  triangularQuadro,
  unit
};
