/**
 * cv/runtime/livres-h/salto.js — CV-31 Salto e testes físicos, só matemática.
 *
 * Recebe a pose (33 pontos BlazePose em px do quadro, rótulos esquerda/direita
 * ANATÔMICOS) com o instante de cada amostra e devolve as tentativas de salto.
 * Nada aqui toca em DOM, canvas ou modelo: é o que os testes do node exercitam.
 *
 * ============================ MÉTODO ============================
 *
 * Contato com o chão. O sinal é a BASE DOS PÉS: o ponto mais baixo entre
 * calcanhar e ponta (o tornozelo só na falta dos dois). Na impulsão o
 * calcanhar sobe antes e a ponta é a última a sair; na queda a primeira a
 * tocar — por isso o "mais baixo" e não um ponto fixo. O nível do chão é o
 * percentil 90 da base do pé mais baixo numa janela de ±3 s (câmera parada).
 * NO AR = os dois pés acima do chão por mais de `limiar` (4,5% da perna,
 * no mínimo 2,5 px). Decolagem e aterrissagem saem da interpolação do
 * cruzamento do limiar e são EXTRAPOLADAS até a altura zero com a
 * velocidade do pé nas amostras vizinhas — corta o viés de cruzar um limiar
 * acima do chão.
 *
 * Altura pelo tempo de voo: h = g·t²/8 (Bosco, Luhtanen & Komi 1983;
 * Linthorne 2001, Am. J. Phys. 69:1198). Supõe a mesma postura na decolagem e
 * na aterrissagem; aterrissar de joelho dobrado aumenta o tempo e a altura.
 *
 * Incerteza. Cada borda do voo está presa entre duas amostras: com intervalo
 * Δt (33 ms a 30 fps) o tempo de voo tem até ±Δt de erro (pior caso) e a
 * altura ±g·t·Δt/4 (derivada de g·t²/8): ~4 cm num salto de 30 cm a 30 fps,
 * ~0,5 cm a 240 fps. A extrapolação ao chão reduz o erro típico, mas a
 * incerteza mostrada é a do pior caso.
 *
 * Altura pela subida do centro de massa (CM segmentar, ver comum.js): CM na
 * decolagem → pico do CM no voo (parábola ajustada às amostras do voo). Em cm
 * com a escala pela estatura (px da pessoa em pé ÷ altura informada). A
 * mesma parábola dá a "gravidade aparente" (2·c em px/s² × cm/px): perto de
 * 9,8 m/s² confirma a taxa de quadros e a escala; longe, uma das duas está
 * errada (vídeo em câmera lenta sem o fator, ou a pessoa fora do plano).
 *
 * Contramovimento (CMJ): o nível em pé é o percentil 25 do y do CM em
 * [−2,5 s, −0,25 s] antes da decolagem; o fundo é o ponto mais baixo do CM
 * em 1,5 s antes da decolagem. Profundidade = fundo − em pé. Tempo de carga
 * (fase excêntrica) = início da descida → fundo; propulsão = fundo →
 * decolagem. Squat jump: a mesma busca acusa um contramovimento quando o CM
 * desce mais de 3% da perna logo antes de subir (SJ inválido).
 *
 * Drop jump: a pessoa começa na caixa (pés "acima do chão" por segundos) — o
 * trecho longo fora do chão é a plataforma; o contato que vem depois, até a
 * decolagem, é o tempo de contato tc. RSI = altura (m) ÷ tc (s) (Flanagan &
 * Comyns 2008, Strength Cond J 30:32; Young 1995 usa tv/tc, também mostrado).
 *
 * Saltos contínuos: cada voo é um salto; contato = tempo entre aterrissagem e
 * a decolagem seguinte. Índice de fadiga = (média dos 3 primeiros − média dos
 * 3 últimos) ÷ média dos 3 primeiros (como no teste de 15–60 s de Bosco et
 * al. 1983).
 *
 * Salto horizontal (vista lateral, com escala): da ponta do pé mais à frente
 * na decolagem ao calcanhar mais atrás na aterrissagem.
 *
 * Valgo dinâmico (vista frontal): FPPA — ângulo de projeção no plano frontal
 * entre coxa e perna (Willson & Davis 2008; Munro et al. 2012), positivo
 * quando o joelho vai para DENTRO da linha quadril–tornozelo. O pico na
 * aterrissagem (0,4 s após tocar) é o que conta. Também a razão entre a
 * distância dos joelhos e a dos tornozelos (< 0,8 sugere valgo).
 * Faixas de referência são heurísticas de triagem, não diagnóstico.
 */
import {
  G, pt, basePe, pernaPx, centroMassa, angulo, estat, percentil, mediana,
  ajusteParabola, passoAmostra, cruzamento, inclinacaoVertical, bordaChao,
} from './comum.js';

export const TESTES = {
  cmj: { nome: 'Salto com contramovimento (CMJ)', curto: 'CMJ' },
  sj: { nome: 'Squat jump (SJ)', curto: 'SJ' },
  dj: { nome: 'Drop jump (queda + salto)', curto: 'DJ' },
  continuo: { nome: 'Saltos contínuos', curto: 'Contínuos' },
  horizontal: { nome: 'Salto horizontal (distância)', curto: 'Horizontal' },
};
export const NOMES_TESTES = Object.keys(TESTES);

/** Limiares de triagem (heurísticos) usados nos alertas e cores. */
export const REF = {
  fppaValgo: 10,          // ° de FPPA na aterrissagem: acima disso, valgo marcado (triagem)
  razaoValgo: 0.8,        // joelhos/tornozelos abaixo disso
  assimAterrissagemMs: 50,
  tvMin: 80, tvMax: 1100, // ms: voo plausível
  plataformaMs: 1200,     // fora do chão por mais que isso = caixa/plataforma, não voo
  contatoMaxMs: 1000,     // contato entre saltos (DJ, contínuos)
};

const lados = ['e', 'd'];

/**
 * Do quadro de pontos às grandezas que a análise usa (só números, para a
 * sessão guardar milhares de amostras sem carregar a pose inteira).
 */
export function extrair(P, minVis = 0.3) {
  const f = { pes: {}, ang: {}, perna: null, cm: null, valgo: null };
  for (const l of lados) {
    const b = basePe(P, l, minVis);
    const c = pt(P, 'calcanhar', l, minVis), p = pt(P, 'pe', l, minVis);
    f.pes[l] = b ? { y: b.y, x: b.x, cx: c ? c.x : null, px: p ? p.x : null } : null;
    const q = pt(P, 'quadril', l, minVis), j = pt(P, 'joelho', l, minVis), t = pt(P, 'tornozelo', l, minVis);
    const o = pt(P, 'ombro', l, minVis);
    f.ang['joelho' + l.toUpperCase()] = angulo(q, j, t);
    f.ang['quadril' + l.toUpperCase()] = angulo(o, q, j);
    f.ang['tornozelo' + l.toUpperCase()] = angulo(j, t, p);
  }
  const pe = pernaPx(P, 'e'), pd = pernaPx(P, 'd');
  f.perna = pe && pd ? Math.max(pe, pd) : (pe || pd || null);
  const cm = centroMassa(P, minVis * 0.7);
  f.cm = cm ? { x: cm.x, y: cm.y } : null;
  f.valgo = valgoFrontal(P, minVis);
  // olhos/nariz para a estatura (o chão entra depois)
  const ol = [pt(P, 'olho', 'e', minVis), pt(P, 'olho', 'd', minVis)].filter(Boolean);
  const n = pt(P, 'nariz', null, minVis);
  f.olhoY = ol.length ? ol.reduce((s, q) => s + q.y, 0) / ol.length : null;
  f.narizY = n ? n.y : null;
  // tronco (para o desenho e a postura na aterrissagem)
  const om = pt(P, 'ombro', 'e', minVis) || pt(P, 'ombro', 'd', minVis);
  const qm = pt(P, 'quadril', 'e', minVis) || pt(P, 'quadril', 'd', minVis);
  f.tronco = om && qm ? Math.abs(inclinacaoVertical(qm, om, 1)) : null;
  return f;
}

/**
 * FPPA de cada joelho na vista frontal (graus, + = joelho para dentro) e a
 * razão joelhos/tornozelos. "Dentro" = para o lado da linha média (meio do
 * quadril), seja qual for o lado da imagem em que a perna aparece.
 */
export function valgoFrontal(P, minVis = 0.3) {
  const qe = pt(P, 'quadril', 'e', minVis), qd = pt(P, 'quadril', 'd', minVis);
  if (!qe || !qd) return null;
  const mx = (qe.x + qd.x) / 2;
  const out = {};
  for (const l of lados) {
    const q = l === 'e' ? qe : qd, j = pt(P, 'joelho', l, minVis), t = pt(P, 'tornozelo', l, minVis);
    if (!j || !t) { out[l] = null; continue; }
    const a = angulo(q, j, t);
    if (a == null) { out[l] = null; continue; }
    // x da linha quadril–tornozelo na altura do joelho
    const f = Math.abs(t.y - q.y) > 1e-6 ? (j.y - q.y) / (t.y - q.y) : 0.5;
    const xl = q.x + f * (t.x - q.x);
    const paraDentro = Math.sign(mx - q.x) || 1;
    const desvio = (j.x - xl) * paraDentro;                 // > 0: joelho para dentro
    out[l] = { fppa: (180 - a) * (desvio >= 0 ? 1 : -1), desvio };
  }
  const je = pt(P, 'joelho', 'e', minVis), jd = pt(P, 'joelho', 'd', minVis);
  const te = pt(P, 'tornozelo', 'e', minVis), td = pt(P, 'tornozelo', 'd', minVis);
  out.razao = je && jd && te && td && Math.abs(te.x - td.x) > 2 ? Math.abs(je.x - jd.x) / Math.abs(te.x - td.x) : null;
  return out;
}

// ------------------------------------------------------------- análise

/** Base do pé mais baixo (o que ainda está no chão) e de cada pé. */
function bases(a) {
  const e = a.pes.e ? a.pes.e.y : null, d = a.pes.d ? a.pes.d.y : null;
  if (e == null && d == null) return null;
  return e == null ? d : d == null ? e : Math.max(e, d);
}

/** Nível do chão por amostra: percentil 90 da base numa janela de ±meiaJanela ms (em blocos de 250 ms). */
export function nivelChao(ts, bs, meiaJanela = 3000) {
  const n = ts.length, out = new Array(n).fill(null);
  if (!n) return out;
  let i = 0, ini = 0;
  while (i < n) {
    const t0 = ts[i];
    let k = i;
    while (k < n && ts[k] - t0 < 250) k++;
    const tc = (t0 + ts[k - 1]) / 2;
    while (ini < n && ts[ini] < tc - meiaJanela) ini++;
    const viz = [];
    for (let j = ini; j < n && ts[j] <= tc + meiaJanela; j++) if (bs[j] != null) viz.push(bs[j]);
    const v = percentil(viz, 0.9);
    for (let j = i; j < k; j++) out[j] = v;
    i = k;
  }
  return out;
}

/**
 * Segmentos "no chão"/"fora do chão" com o instante de cada borda.
 * Devolve { segs: [{ar, i0, i1, tIni, tFim}], chao[], limiar, perna, dt }.
 */
export function segmentar(amostras, opts = {}) {
  const ts = amostras.map((a) => a.t);
  const bs = amostras.map(bases);
  const perna = mediana(amostras.map((a) => a.perna)) || null;
  const chao = nivelChao(ts, bs, opts.meiaJanela || 3000);
  const limiar = Math.max(2.5, (opts.limiarFracao ?? 0.045) * (perna || 100));
  const dt = passoAmostra(ts) || 33;
  const ar = bs.map((b, i) => (b == null || chao[i] == null ? null : b < chao[i] - limiar));
  // amostra sem pé visível herda o estado anterior (oclusão breve)
  for (let i = 0; i < ar.length; i++) if (ar[i] == null) ar[i] = i > 0 ? ar[i - 1] : false;
  const h = bs.map((b, i) => (b == null || chao[i] == null ? null : chao[i] - b));   // altura dos pés (px)
  const segs = [];
  let i0 = 0;
  for (let i = 1; i <= ar.length; i++) {
    if (i === ar.length || ar[i] !== ar[i0]) { segs.push({ ar: ar[i0], i0, i1: i - 1 }); i0 = i; }
  }
  // bordas: interpolação no limiar + extrapolação até o chão com a velocidade do pé
  const borda = (iChao, iAr, subindo) => bordaChao(ts, h, iChao, iAr, limiar, subindo);
  for (let s = 0; s < segs.length; s++) {
    const g = segs[s];
    g.tIni = s === 0 ? ts[g.i0] : g.ar ? borda(g.i0 - 1, g.i0, true) : borda(g.i0, g.i0 - 1, false);
    g.tFim = s === segs.length - 1 ? ts[g.i1] : g.ar ? borda(g.i1 + 1, g.i1, false) : borda(g.i1, g.i1 + 1, true);
    g.aberto = s === segs.length - 1;
  }
  // a borda compartilhada tem de ser a mesma dos dois lados
  for (let s = 1; s < segs.length; s++) segs[s].tIni = segs[s - 1].tFim;
  return { segs, chao, limiar, perna, dt, h, ts, bs };
}

/** Escala (cm/px) pela estatura informada: px da pessoa em pé, joelhos estendidos. */
export function escalaEstatura(amostras, chao, alturaCm) {
  if (!(alturaCm > 50)) return { cmPorPx: null, estPx: null };
  const v = [];
  for (let i = 0; i < amostras.length; i++) {
    const a = amostras[i];
    const jE = a.ang.joelhoE, jD = a.ang.joelhoD;
    const estendido = (jE == null || jE > 165) && (jD == null || jD > 165) && (jE != null || jD != null);
    if (!estendido || chao[i] == null) continue;
    const y = a.olhoY != null ? a.olhoY : null;
    const e = y != null ? (chao[i] - y) / 0.936 : a.narizY != null ? (chao[i] - a.narizY) / 0.91 : null;
    if (e > 20) v.push(e);
  }
  if (v.length < 3) return { cmPorPx: null, estPx: null };
  const estPx = percentil(v, 0.75);   // posturas levemente fletidas puxam para baixo
  return { cmPorPx: alturaCm / estPx, estPx };
}

const valor = (a, k) => (a ? a.ang[k] : null);
const mediaLados = (a, k) => {
  const e = valor(a, k + 'E'), d = valor(a, k + 'D');
  return e != null && d != null ? (e + d) / 2 : (e ?? d ?? null);
};
/** Índice da amostra com t mais próximo. */
function perto(ts, t) {
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m; else hi = m; }
  return Math.abs(ts[lo] - t) <= Math.abs(ts[hi] - t) ? lo : hi;
}
/** y do CM interpolado no instante t. */
function cmEm(amostras, ts, t) {
  const i = perto(ts, t);
  const j = ts[i] <= t ? i + 1 : i - 1;
  const a = amostras[i] && amostras[i].cm, b = amostras[j] && amostras[j].cm;
  if (!a) return b ? b.y : null;
  if (!b || ts[j] === ts[i]) return a.y;
  const f = (t - ts[i]) / (ts[j] - ts[i]);
  return a.y + f * (b.y - a.y);
}

/**
 * Tentativas de salto na série. cfg = { teste, alturaCm, vista }.
 * Devolve { tentativas, chao, limiar, dt, cmPorPx, escala, estado }.
 */
export function analisarSaltos(amostras, cfg = {}) {
  const teste = TESTES[cfg.teste] ? cfg.teste : 'cmj';
  const out = { tentativas: [], rejeitados: [], dt: null, cmPorPx: null, escala: null, estado: 'sem dados', limiar: null };
  if (amostras.length < 5) return out;
  const S = segmentar(amostras, cfg);
  const { segs, chao, limiar, perna, dt, ts } = S;
  out.dt = dt; out.limiar = limiar; out.perna = perna; out.chaoAtual = chao[chao.length - 1];
  const esc = escalaEstatura(amostras, chao, cfg.alturaCm);
  out.cmPorPx = esc.cmPorPx; out.estPx = esc.estPx;
  out.escala = esc.cmPorPx ? 'estatura' : null;
  const ult = segs[segs.length - 1];
  out.estado = ult.ar ? (ts[ult.i1] - ult.tIni > REF.plataformaMs ? 'fora do chão (plataforma?)' : 'no ar') : 'no chão';
  const gAps = [];

  for (let s = 0; s < segs.length; s++) {
    const g = segs[s];
    if (!g.ar || g.aberto || s === 0) continue;               // voo inteiro e com chão antes
    const tv = g.tFim - g.tIni;
    if (tv > REF.plataformaMs) continue;                       // caixa/plataforma (drop jump), não voo
    if (tv < REF.tvMin || tv > REF.tvMax) continue;
    const antes = segs[s - 1], depois = segs[s + 1];
    if (!depois) continue;
    // a aterrissagem tem de estar confirmada: 2 amostras no chão
    if (depois.aberto && depois.i1 - depois.i0 < 1) continue;
    const iDec = antes.i1, iAte = depois.i0;
    // CM no voo: tem de subir acima do da decolagem (rejeita tropeço de pose)
    const tsV = [], ysV = [];
    for (let i = g.i0; i <= g.i1; i++) if (amostras[i].cm) { tsV.push(ts[i]); ysV.push(amostras[i].cm.y); }
    const cmDec = cmEm(amostras, ts, g.tIni);
    let picoY = ysV.length ? Math.min(...ysV) : null;
    const par = tsV.length >= 4 ? ajusteParabola(tsV, ysV) : null;
    let gAp = null;
    if (par && par.c > 0) {
      const tp = -par.b / (2 * par.c);
      if (tp >= -dt && tp <= tsV[tsV.length - 1] - tsV[0] + dt) picoY = par.a + par.b * tp + par.c * tp * tp;
      gAp = 2 * par.c * 1e6;                                    // px/s²
    }
    if (cmDec != null && picoY != null && !(picoY < cmDec - 0.15 * limiar)) continue;
    // voo de verdade: corpo em pé (não é o "pulo" dos pés numa prancha) e o CM sobe o que o tempo de voo promete
    const troncos = [];
    for (let i = g.i0; i <= g.i1; i++) if (amostras[i].tronco != null) troncos.push(amostras[i].tronco);
    if (troncos.length && mediana(troncos) > (teste === 'horizontal' ? 70 : 50)) { out.rejeitados.push({ tDec: g.tIni, tv, motivo: 'postura' }); continue; }
    const kEsc = out.cmPorPx || (perna ? (0.491 * 170) / perna : null);   // sem altura: escala aproximada pela perna
    const hVooCm = (G * (tv / 1000) ** 2 / 8) * 100;
    if (kEsc && cmDec != null && picoY != null && (cmDec - picoY) * kEsc < 0.45 * hVooCm - 2) {
      out.rejeitados.push({ tDec: g.tIni, tv, motivo: 'cm', hVoo: hVooCm, hCM: (cmDec - picoY) * kEsc });
      continue;
    }

    const t = {
      n: 0, teste, tDec: g.tIni, tAte: g.tFim, tv, tvInc: dt,
      hVoo: (G * (tv / 1000) ** 2 / 8) * 100,                   // cm
      hVooInc: ((G * (tv / 1000) * (dt / 1000)) / 4) * 100,     // cm, pior caso
      hCM: null, hCMpe: null, prof: null, tCarga: null, tProp: null, tc: null, rsi: null, rsiTv: null,
      joelhoDec: mediaLados(amostras[iDec], 'joelho'), quadrilDec: mediaLados(amostras[iDec], 'quadril'),
      joelhoAte: mediaLados(amostras[iAte], 'joelho'), quadrilAte: mediaLados(amostras[iAte], 'quadril'),
      joelhoMinAte: null, valgo: null, assimAteMs: null, dist: null, gAp: null, contramov: null,
      amostrasVoo: g.i1 - g.i0 + 1, avisos: [],
    };
    // ---- pós-aterrissagem: flexão máxima do joelho (absorção) e valgo
    let jMin = null, fE = null, fD = null, razMin = null;
    for (let i = iAte; i < amostras.length && ts[i] - g.tFim <= 600; i++) {
      const jm = mediaLados(amostras[i], 'joelho');
      if (jm != null && (jMin == null || jm < jMin)) jMin = jm;
      if (ts[i] - g.tFim <= 400 && amostras[i].valgo) {
        const v = amostras[i].valgo;
        if (v.e && (fE == null || v.e.fppa > fE)) fE = v.e.fppa;
        if (v.d && (fD == null || v.d.fppa > fD)) fD = v.d.fppa;
        if (v.razao != null && (razMin == null || v.razao < razMin)) razMin = v.razao;
      }
    }
    t.joelhoMinAte = jMin;
    if (cfg.vista === 'frontal' && (fE != null || fD != null)) {
      t.valgo = { e: fE, d: fD, razao: razMin, assim: fE != null && fD != null ? Math.abs(fE - fD) : null };
      if (Math.max(fE ?? -99, fD ?? -99) > REF.fppaValgo) t.avisos.push('Joelho para dentro (valgo) na aterrissagem.');
    }
    // ---- assimetria na aterrissagem: cada pé tocando o chão
    const toque = (l) => {
      for (let i = g.i0; i < Math.min(amostras.length, iAte + 6); i++) {
        const p = amostras[i].pes[l];
        if (p && chao[i] != null && p.y >= chao[i] - limiar) {
          const pa = amostras[i - 1] && amostras[i - 1].pes[l];
          return pa ? cruzamento(ts[i - 1], chao[i] - pa.y, ts[i], chao[i] - p.y, limiar) : ts[i];
        }
      }
      return null;
    };
    const tE = toque('e'), tD = toque('d');
    if (tE != null && tD != null) {
      t.assimAteMs = tE - tD;                                    // + = o direito tocou antes
      if (Math.abs(t.assimAteMs) > Math.max(REF.assimAterrissagemMs, 1.5 * dt)) {
        t.avisos.push(`Aterrissagem assimétrica: o pé ${t.assimAteMs > 0 ? 'direito' : 'esquerdo'} tocou ${Math.round(Math.abs(t.assimAteMs))} ms antes.`);
      }
    }
    // ---- escala e alturas pelo CM
    const k = out.cmPorPx;
    if (gAp && k) { t.gAp = (gAp * k) / 100; gAps.push(t.gAp); }
    else if (gAp) t.gApPx = gAp;
    if (k && cmDec != null && picoY != null) t.hCM = (cmDec - picoY) * k;

    // ---- preparação (CMJ, SJ): nível em pé, fundo do contramovimento
    if (teste === 'cmj' || teste === 'sj' || teste === 'horizontal') {
      const yP = [], iJan = [];
      for (let i = iDec; i >= 0 && g.tIni - ts[i] <= 2500; i--) {
        if (amostras[i].cm && g.tIni - ts[i] >= 250) yP.push(amostras[i].cm.y);
        if (amostras[i].cm && g.tIni - ts[i] <= 1500) iJan.push(i);
      }
      const emPe = percentil(yP, 0.25);
      let iMin = null;
      for (const i of iJan) if (iMin == null || amostras[i].cm.y > amostras[iMin].cm.y) iMin = i;
      if (emPe != null && iMin != null) {
        const profPx = amostras[iMin].cm.y - emPe;
        if (k && picoY != null) t.hCMpe = (emPe - picoY) * k;
        if (teste === 'cmj' && profPx > 0.5 * limiar) {
          t.prof = k ? profPx * k : null;
          t.profPx = profPx;
          // início da descida: voltando do fundo, primeira amostra a menos de 10% da profundidade do nível em pé
          let iIni = iMin;
          for (let i = iMin; i >= 0 && ts[iMin] - ts[i] <= 2000; i--) {
            if (!amostras[i].cm) continue;
            iIni = i;
            if (amostras[i].cm.y <= emPe + 0.1 * profPx) break;
          }
          t.tCarga = ts[iMin] - ts[iIni];
          t.tProp = g.tIni - ts[iMin];
          t.joelhoFundo = mediaLados(amostras[iMin], 'joelho');
        }
        if (teste === 'sj') {
          // nível da posição agachada sustentada antes do fundo
          const hold = [];
          for (let i = iMin; i >= 0 && ts[iMin] - ts[i] <= 1000; i--) if (ts[iMin] - ts[i] >= 300 && amostras[i].cm) hold.push(amostras[i].cm.y);
          const yHold = mediana(hold);
          const queda = yHold != null ? amostras[iMin].cm.y - yHold : null;
          t.contramov = queda != null && perna ? queda > 0.03 * perna : null;
          t.joelhoFundo = mediaLados(amostras[iMin], 'joelho');
          t.tProp = g.tIni - ts[iMin];
          if (t.contramov) t.avisos.push('Contramovimento antes da subida: o squat jump deve partir parado do agachamento.');
        }
      }
    }
    // ---- contato antes do voo (drop jump, contínuos)
    if ((teste === 'dj' || teste === 'continuo') && s >= 2) {
      const tc = antes.tFim - antes.tIni;
      const anterior = segs[s - 2];
      const vemDoAr = anterior.ar && !anterior.aberto;
      if (vemDoAr && tc > 0 && tc <= REF.contatoMaxMs) {
        t.tc = tc; t.tcInc = dt;
        t.rsi = (t.hVoo / 100) / (tc / 1000);
        t.rsiTv = tv / tc;
        t.queda = anterior.tFim - anterior.tIni > REF.plataformaMs || (anterior.tFim - anterior.tIni) > REF.tvMax;
      }
    }
    // ---- salto horizontal: ponta à frente na decolagem → calcanhar mais atrás na aterrissagem
    if (teste === 'horizontal') {
      const aD = amostras[iDec], aA = amostras[Math.min(amostras.length - 1, iAte + 1)];
      const xs = (a, k2) => lados.map((l) => a.pes[l] && a.pes[l][k2]).filter((x) => x != null);
      const xDec = xs(aD, 'px'), xAte = xs(aA, 'cx');
      if (xDec.length && xAte.length) {
        const dir = Math.sign(mediana(xAte) - mediana(xDec)) || 1;
        const frente = dir > 0 ? Math.max(...xDec) : Math.min(...xDec);
        const atras = dir > 0 ? Math.min(...xAte) : Math.max(...xAte);
        t.distPx = Math.abs(atras - frente);
        t.dist = k ? t.distPx * k : null;
      }
    }
    out.tentativas.push(t);
  }
  out.tentativas.forEach((t, i) => { t.n = i + 1; });
  if (gAps.length) out.gAp = mediana(gAps);
  return out;
}

/** Melhor, média, fadiga e comparação das tentativas válidas. */
export function resumoSaltos(tentativas, teste = 'cmj') {
  const v = tentativas.filter((t) => !t.descartada);
  const chave = teste === 'horizontal' ? 'dist' : 'hVoo';
  const vals = v.map((t) => t[chave]);
  const s = estat(vals);
  const melhor = v.length ? v.reduce((m, t) => (t[chave] != null && (m == null || t[chave] > m[chave]) ? t : m), null) : null;
  const r = {
    n: v.length, chave, melhor, media: s.media, dp: s.dp, cv: s.media ? (s.dp / s.media) * 100 : null,
    hCM: estat(v.map((t) => t.hCM)), prof: estat(v.map((t) => t.prof)), tc: estat(v.map((t) => t.tc)),
    rsi: estat(v.map((t) => t.rsi)), tv: estat(v.map((t) => t.tv)),
    fadiga: null,
  };
  if (v.length >= 6) {
    const a = estat(v.slice(0, 3).map((t) => t[chave])).media, b = estat(v.slice(-3).map((t) => t[chave])).media;
    r.fadiga = a ? ((a - b) / a) * 100 : null;
  }
  return r;
}

/** Alertas para o painel (texto curto) a partir do resultado da análise. */
export function alertasSalto(res, cfg = {}) {
  const al = [];
  if (!res || !res.tentativas) return al;
  if (res.dt && res.dt > 45) al.push(`Amostragem de ${Math.round(1000 / res.dt)} Hz: a altura pelo tempo de voo tem ±${Math.round((G * 0.5 * res.dt) / 40)} cm. Use "Analisar vídeo quadro a quadro" ou câmera lenta.`);
  if (res.gAp && (res.gAp < 7.5 || res.gAp > 12.5)) al.push(`Gravidade aparente ${res.gAp.toFixed(1).replace('.', ',')} m/s² (esperado 9,8): confira a altura informada e o fator de câmera lenta.`);
  // voos em que o CM subiu bem menos que o tempo de voo promete: câmera lenta sem o fator, ou não é salto
  const rc = (res.rejeitados || []).filter((r) => r.motivo === 'cm' && r.hCM > 1);
  if (rc.length >= 2) {
    const fator = mediana(rc.map((r) => Math.sqrt(r.hVoo / r.hCM)));
    const sug = [2, 4, 8, 16].find((f) => Math.abs(Math.log(fator / f)) < 0.25);
    al.push(`${rc.length} voos descartados: o centro de massa subiu bem menos do que o tempo de voo indica.` +
      (sug ? ((cfg.lenta || 1) > 1 ? ` O fator de câmera lenta parece ${sug}× maior que o informado (tente ${(cfg.lenta || 1) * sug}×).` : ` Parece vídeo em câmera lenta ${sug}× — informe o fator.`)
        : ' Confira a altura informada, o fator de câmera lenta e se é mesmo um salto.'));
  }
  const rp = (res.rejeitados || []).filter((r) => r.motivo === 'postura').length;
  if (rp) al.push(`${rp} ${rp === 1 ? 'voo descartado' : 'voos descartados'}: corpo deitado/inclinado (não é salto vertical).`);
  if (cfg.teste === 'horizontal' && !res.cmPorPx) al.push('Informe a altura da pessoa para medir a distância em cm.');
  if (!res.cmPorPx && cfg.alturaCm > 50) al.push('Escala pela estatura ainda não fechou: fique em pé, parado e de corpo inteiro por 1–2 s.');
  return al;
}

/** Sessão: guarda as amostras e cacheia a análise. */
export class SessaoSalto {
  constructor() { this.zerar(); }
  zerar() {
    this.amostras = [];
    this.descartadas = new Set();
    this.cache = null;
    this.sujo = true;
    this.t0 = null;
    this.ultimaPose = null;
  }
  adicionar(t, P, minVis = 0.3) {
    if (this.amostras.length && t <= this.amostras[this.amostras.length - 1].t) return null;   // fora de ordem
    const a = extrair(P, minVis);
    a.t = t;
    if (this.t0 == null) this.t0 = t;
    this.amostras.push(a);
    // limite: 6 min a 30 Hz
    if (this.amostras.length > 11000) this.amostras.splice(0, 1000);
    this.sujo = true;
    return a;
  }
  analisar(cfg) {
    const chave = JSON.stringify([cfg.teste, cfg.alturaCm, cfg.vista]);
    if (!this.sujo && this.cache && this.cacheChave === chave) return this.cache;
    const r = analisarSaltos(this.amostras, cfg);
    for (const t of r.tentativas) t.descartada = this.descartadas.has(Math.round(t.tDec));
    this.cache = r; this.cacheChave = chave; this.sujo = false;
    return r;
  }
  alternarDescarte(tDec) {
    const k = Math.round(tDec);
    if (this.descartadas.has(k)) this.descartadas.delete(k); else this.descartadas.add(k);
    this.sujo = true;
  }
}

