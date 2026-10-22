/**
 * cv/runtime/livres-h/corrida.js — CV-32 Corrida (marcha), só matemática.
 *
 * Recebe a pose (33 pontos BlazePose em px, rótulos ANATÔMICOS) com o
 * instante de cada amostra e devolve os passos e o resumo por lado. Nada de
 * DOM, canvas ou modelo: é o que os testes do node exercitam.
 *
 * ============================ MÉTODO ============================
 *
 * Contato (vista lateral, esteira ou pista com câmera parada). O sinal é a
 * base do pé mais baixo (calcanhar ou ponta). O chão é o percentil 90 dessa
 * base numa janela de ±3 s; o pé está em CONTATO quando a base fica a menos
 * de 5% da perna do chão. Bordas interpoladas entre quadros e extrapoladas
 * até o chão com a velocidade do pé (como no salto). Não depende de qual
 * perna o modelo chamou de esquerda: na vista lateral o BlazePose troca os
 * rótulos da perna escondida com frequência. Um passo NOVO começa quando o
 * ponto de apoio (relativo ao quadril) salta para a frente — assim dois
 * apoios sem voo entre eles (trote lento) ainda viram dois passos.
 *
 * Lado de cada passo: o rótulo do pé mais baixo no meio do apoio; depois, os
 * passos pares e ímpares de cada sequência contínua votam (corrida alterna
 * os pés). Se os dois grupos votam no mesmo lado, os rótulos não são
 * confiáveis e os lados viram "A/B".
 *
 * Grandezas (cada passo, no instante do contato inicial):
 *   cadência          60 000 ÷ mediana do tempo de passo (passos/min)
 *   contato / voo     duração do apoio e do voo que o segue
 *   apoio / balanço   contato ÷ tempo da passada (2 passos), em % do ciclo
 *   joelho            ângulo interno quadril–joelho–tornozelo (180° = reto):
 *                     no contato, mínimo no apoio (flexão máx.) e mínimo da
 *                     outra perna no balanço
 *   tornozelo         entre a perna (joelho→tornozelo) e o pé (calcanhar→
 *                     ponta); 90° = neutro, < 90° = dorsiflexão
 *   pisada            ângulo do pé no contato menos o do pé apoiado (meio do
 *                     apoio), como o "foot strike angle" de Altman & Davis
 *                     2012 (Gait Posture 35:298): > 8° retropé, −1,6° a 8°
 *                     médio-pé, < −1,6° antepé. A 30 fps o contato real pode
 *                     cair entre quadros: o ângulo tende a sair menor.
 *   overstriding      tíbia inclinada para a frente no contato (tornozelo à
 *                     frente do joelho, > 10°) E pé à frente do quadril mais
 *                     que 30% da perna (~26 cm num adulto de 1,75 m) — heurística de triagem (Souza 2016,
 *                     Phys Med Rehabil Clin N Am 27:217; Heiderscheit et al.
 *                     2011, MSSE 43:296 — subir a cadência 5–10% reduz)
 *   oscilação         amplitude vertical do meio do quadril em cada passo
 *   tronco            quadril→ombro em relação à vertical (+ = à frente)
 *   simetria          |E − D| ÷ média × 100 (Robinson et al. 1987)
 * Vista de trás/frente:
 *   queda da pelve    inclinação da linha dos quadris no apoio, lado oposto
 *                     descendo (positivo), descontada a inclinação média da
 *                     câmera (Bramah et al. 2018, AJSM 46:3002)
 *   largura           pé no meio do apoio em relação à linha média, em
 *                     larguras de quadril; negativo = cruzou a linha
 * Escala sem ficar em pé: a soma coxa + perna (px) não muda com a flexão;
 * vale ~0,491 da estatura (Drillis & Contini) — cm/px = altura ÷ (perna/0,491).
 */
import {
  pt, basePe, pernaPx, angulo, estat, mediana, passoAmostra, cruzamento,
  inclinacaoVertical, indiceSimetria, pelve as pelveDe, bordaChao, coerenciaPose, num,
} from './comum.js';
import { nivelChao } from './salto.js';

export const LIMITES = {
  contatoFracao: 0.05,
  contatoTornozelo: 0.07,  // × perna, quando só há tornozelo (sem calcanhar/ponta), cruzamento sem extrapolar
  contatoRelativo: 0.07,   // × perna, pé medido em relação ao quadril (câmera andando)
  saltoApoio: 0.15,        // salto do ponto de apoio (× perna) que marca passo novo
  tibia: 10,               // ° (tornozelo à frente do joelho)
  peFrentePct: 30,         // % da perna à frente do quadril
  retropé: 8, antepé: -1.6,
  cadenciaBaixa: 155,      // passos/min (heurística de triagem)
  cadenciaMin: 120, cadenciaMax: 340,   // fora disso não é ritmo de corrida (andando, parado, ruído)
  troncoMax: 15, troncoMin: 0,
  oscilacaoCm: 10,
  assimetria: 10,          // %
  quedaPelve: 7,           // °
  joelhoMin: 90, joelhoMax: 178,   // ° faixa plausível do joelho no contato correndo (fora dela: pose duvidosa)
  camMovel: 0.25,          // fração do tempo com a câmera andando a partir da qual a oscilação não vale
  dtMax: 125,              // ms entre amostras: acima (abaixo de 8 Hz) os passos (~3/s) não são captados
};

const lados = ['e', 'd'];

export function extrairCorrida(P, minVis = 0.3) {
  const f = { pes: {}, pernas: {}, perna: null, pel: null, ombro: null, quadris: null };
  for (const l of lados) {
    const b = basePe(P, l, minVis);
    const c = pt(P, 'calcanhar', l, minVis), p = pt(P, 'pe', l, minVis), t = pt(P, 'tornozelo', l, minVis);
    const j = pt(P, 'joelho', l, minVis), q = pt(P, 'quadril', l, minVis);
    f.pes[l] = b ? { y: b.y, x: b.x, ax: t ? t.x : c && p ? (c.x + p.x) / 2 : b.x, ponto: b.ponto } : null;
    f.pernas[l] = {
      joelho: angulo(q, j, t),
      // tornozelo: perna (tornozelo→joelho) × pé (calcanhar→ponta)
      tornozelo: null,
      peAng: c && p ? (Math.atan2(c.y - p.y, Math.abs(p.x - c.x)) * 180) / Math.PI : null,
      peDx: c && p ? p.x - c.x : null,
      calcX: c ? c.x : null, tornX: t ? t.x : null, tornY: t ? t.y : null, joelhoX: j ? j.x : null, joelhoY: j ? j.y : null,
    };
    if (j && t && c && p) {
      const ux = j.x - t.x, uy = j.y - t.y, vx = p.x - c.x, vy = p.y - c.y;
      const nu = Math.hypot(ux, uy), nv = Math.hypot(vx, vy);
      f.pernas[l].tornozelo = nu > 1e-6 && nv > 1e-6 ? (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)))) * 180) / Math.PI : null;
    }
  }
  const pe = pernaPx(P, 'e'), pd = pernaPx(P, 'd');
  f.perna = pe && pd ? Math.max(pe, pd) : (pe || pd || null);
  const pl = pelveDe(P, minVis);
  f.pel = pl ? { x: pl.x, y: pl.y } : null;
  const oe = pt(P, 'ombro', 'e', minVis), od = pt(P, 'ombro', 'd', minVis);
  f.ombro = oe && od ? { x: (oe.x + od.x) / 2, y: (oe.y + od.y) / 2 } : (oe || od ? { x: (oe || od).x, y: (oe || od).y } : null);
  // para onde a pessoa olha: nariz em relação ao meio das orelhas (mais firme que a ponta do pé)
  const n = pt(P, 'nariz', null, minVis), oe2 = pt(P, 'orelha', 'e', minVis), od2 = pt(P, 'orelha', 'd', minVis);
  const orelha = oe2 && od2 ? (oe2.x + od2.x) / 2 : oe2 ? oe2.x : od2 ? od2.x : null;
  f.olhar = n && orelha != null ? n.x - orelha : null;
  const qe = pt(P, 'quadril', 'e', minVis), qd = pt(P, 'quadril', 'd', minVis);
  f.quadris = qe && qd ? { e: { x: qe.x, y: qe.y }, d: { x: qd.x, y: qd.y } } : null;
  return f;
}

const baseMin = (a) => {
  const e = a.pes.e ? a.pes.e.y : null, d = a.pes.d ? a.pes.d.y : null;
  if (e == null && d == null) return null;
  return e == null ? { y: d, l: 'd' } : d == null ? { y: e, l: 'e' } : e >= d ? { y: e, l: 'e' } : { y: d, l: 'd' };
};

/**
 * Cadência pela autocorrelação da altura do quadril: o quadril desce e sobe
 * uma vez por PASSO. Independe de achar os contatos (pés ruidosos, pés
 * cortados no quadro). Procura o primeiro pico entre 170 e 600 ms
 * (100–350 passos/min — velocista em prova passa de 260), com interpolação parabólica. null se não houver
 * periodicidade clara (pico < 0,3).
 */
export function cadenciaAutocorr(ts, ys) {
  const pares = ts.map((t, i) => [t, ys[i]]).filter(([, y]) => y != null);
  if (pares.length < 20) return null;
  const T = pares[pares.length - 1][0] - pares[0][0];
  if (T < 1500) return null;
  // reamostra a 100 Hz (as amostras ao vivo não são uniformes)
  const n = Math.floor(T / 10), xs = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = pares[0][0] + i * 10;
    while (k < pares.length - 2 && pares[k + 1][0] < t) k++;
    const [t0, y0] = pares[k], [t1, y1] = pares[k + 1];
    xs[i] = t1 > t0 ? y0 + ((t - t0) / (t1 - t0)) * (y1 - y0) : y0;
  }
  // tira a deriva lenta (pessoa andando na esteira, câmera): média móvel de 0,5 s
  const z = xs.map((x, i) => { let s0 = 0, c = 0; for (let j = Math.max(0, i - 25); j <= Math.min(n - 1, i + 25); j++) { s0 += xs[j]; c++; } return x - s0 / c; });
  const ac = (lag) => { let s0 = 0, c = 0; for (let i = 0; i + lag < n; i++) { s0 += z[i] * z[i + lag]; c++; } return c ? s0 / c : 0; };
  const v0 = ac(0);
  if (!(v0 > 0)) return null;
  const r = [];
  for (let lag = 16; lag <= 65; lag++) r[lag] = ac(lag) / v0;
  for (let lag = 17; lag <= 60; lag++) {
    if (r[lag] > 0.3 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      const a = r[lag - 1], b = r[lag], c = r[lag + 1], den = a - 2 * b + c;
      const d = den !== 0 ? (0.5 * (a - c)) / den : 0;
      return { cadencia: 60000 / ((lag + d) * 10), forca: b };
    }
  }
  return null;
}

/** Escala pela soma coxa + perna (não muda com a flexão): ~0,491 da estatura. */
export function escalaPerna(pernaMedPx, alturaCm) {
  return alturaCm > 50 && pernaMedPx > 10 ? alturaCm / (pernaMedPx / 0.491) : null;
}

export function classificarPisada(fsa) {
  if (fsa == null || !Number.isFinite(fsa)) return null;
  return fsa > LIMITES.retropé ? 'retropé' : fsa < LIMITES.antepé ? 'antepé' : 'médio-pé';
}

/**
 * Passos na série. cfg = { vista: 'lateral'|'posterior', alturaCm, velocidadeKmh }.
 * Devolve { passos, dt, dir, cmPorPx, perna, ladosOk, chaoAtual, contatoAgora }.
 */
export function analisarCorrida(amostras, cfg = {}) {
  const out = { passos: [], dt: null, dir: 1, cmPorPx: null, perna: null, ladosOk: false, nAmostras: amostras.length };
  if (amostras.length < 8) return out;
  const ts = amostras.map((a) => a.t);
  const bm = amostras.map(baseMin);
  const perna = mediana(amostras.map((a) => a.perna));
  out.perna = perna;
  const P100 = perna || 100;
  // câmera andando (panorâmica, inclinação, zoom) ou só tornozelo (17 pontos): o "chão" da imagem não fica parado.
  // Mede o pé em relação ao QUADRIL, normalizado pela perna da própria amostra — isso não muda quando a câmera
  // se move ou dá zoom — e o chão vira o pé mais esticado numa janela curta (±0,6 s, mais de uma passada).
  const comCam0 = amostras.filter((a) => a.cam);
  const camFracao0 = comCam0.length ? comCam0.filter((a) => a.cam.movendo).length / comCam0.length : 0;
  const soTornozelo = bm.filter(Boolean).length > 0 &&
    amostras.filter((a) => ['e', 'd'].every((l) => !a.pes[l] || a.pes[l].ponto === 'tornozelo')).length > 0.8 * amostras.length;
  const relativo = cfg.chaoRelativo != null ? Boolean(cfg.chaoRelativo) : (camFracao0 > LIMITES.camMovel || soTornozelo);
  out.chaoRelativo = relativo;
  let bs;
  if (relativo) {
    const pl = amostras.map((a) => a.perna);
    const pernaLocal = pl.map((_, i) => mediana(pl.slice(Math.max(0, i - 4), i + 5).filter((x) => x != null)) || P100);
    bs = bm.map((b, i) => (b && amostras[i].pel ? ((b.y - amostras[i].pel.y) / pernaLocal[i]) * P100 : null));
  } else bs = bm.map((b) => (b ? b.y : null));
  const chao = nivelChao(ts, bs, relativo ? 600 : 3000);
  // limiar adaptativo: 5% da perna, ou 2,5 σ do tremor da base perto do chão (pose ruidosa), até 12% da perna
  const difs = [];
  for (let i = 1; i < bs.length; i++) {
    if (bs[i] == null || bs[i - 1] == null || chao[i] == null) continue;
    if (chao[i] - bs[i] < 0.12 * P100 && chao[i - 1] - bs[i - 1] < 0.12 * P100) difs.push(Math.abs(bs[i] - bs[i - 1]));
  }
  const sigma = difs.length > 10 ? (mediana(difs) * 1.4826) / Math.SQRT2 : 0;
  let lim = Math.max(2.5, Math.min(0.12 * P100, Math.max(LIMITES.contatoFracao * P100, 2.5 * sigma)));
  // só tornozelo (pose de 17 pontos, ou pés escondidos): o tornozelo sobe já no descolar do calcanhar,
  // bem antes de a ponta sair — com o limiar do calcanhar o contato sairia curto demais
  if (soTornozelo) lim = Math.max(lim, LIMITES.contatoTornozelo * P100);
  // em relação ao quadril, o joelho que dobra no meio do apoio "levanta" o pé uns 5% da perna: limiar maior
  if (relativo) lim = Math.max(lim, LIMITES.contatoRelativo * P100);
  out.soTornozelo = soTornozelo;
  out.ruidoPe = sigma;
  out.cadenciaQuadril = relativo ? null : cadenciaAutocorr(ts, amostras.map((a) => (a.pel ? a.pel.y : null)));
  // abertura das pernas (distância entre os tornozelos ÷ perna): abre e fecha uma vez por PASSO, e é medida
  // dentro do corpo — vale com a câmera andando e não depende de achar o chão. Distância 2D: de lado as pernas
  // abrem na horizontal; de frente (ou na diagonal) abrem em profundidade, e o que aparece é um pé no alto e o
  // outro no chão — só a horizontal ali oscila uma vez por PASSADA e daria metade da cadência
  out.cadenciaPernas = cadenciaAutocorr(ts, amostras.map((a) => {
    const e = a.pes.e, d = a.pes.d;
    return e && d && a.perna ? Math.hypot(e.ax - d.ax, e.y - d.y) / a.perna : null;
  }));
  const dt = passoAmostra(ts) || 33;
  out.dt = dt;
  out.cmPorPx = escalaPerna(perna, cfg.alturaCm);
  // sentido da corrida: para onde o rosto aponta (nariz × orelhas); sem rosto, para onde as pontas dos pés apontam
  const olhar = amostras.map((a) => a.olhar).filter((x) => x != null && Math.abs(x) > 1);
  const dxs = [];
  for (const a of amostras) for (const l of lados) { const p = a.pernas[l]; if (p && p.peDx != null) dxs.push(p.peDx); }
  const dir = olhar.length >= 5 ? (Math.sign(mediana(olhar)) || 1) : (Math.sign(mediana(dxs) || 1) || 1);
  out.dir = dir;
  const lateral = cfg.vista !== 'posterior';

  // contato e ponto de apoio relativo ao quadril
  const cont = bs.map((b, i) => (b == null || chao[i] == null ? null : b >= chao[i] - lim));
  for (let i = 0; i < cont.length; i++) if (cont[i] == null) cont[i] = i > 0 ? cont[i - 1] : false;
  const xApoio = amostras.map((a, i) => {
    const b = bm[i];
    if (!b || !a.pel) return null;
    return lateral ? (a.pes[b.l].ax - a.pel.x) * dir : null;
  });
  const h = bs.map((b, i) => (b == null || chao[i] == null ? null : chao[i] - b));
  // corridas de contato, quebradas quando o apoio salta para a frente
  const runs = [];
  let ini = null;
  for (let i = 0; i <= cont.length; i++) {
    const fim = i === cont.length || !cont[i];
    const quebra = !fim && ini != null && lateral && xApoio[i] != null && xApoio[i - 1] != null && perna &&
      xApoio[i] - xApoio[i - 1] > LIMITES.saltoApoio * perna;
    if (ini != null && (fim || quebra)) { runs.push({ i0: ini, i1: i - 1, quebraFim: quebra }); ini = null; }
    if (!fim && ini == null) ini = i;
  }
  // vista de trás/frente: o pé de apoio troca sem voo no trote — quebra pela troca do pé mais baixo
  if (!lateral) {
    const novos = [];
    for (const r of runs) {
      let a = r.i0;
      for (let i = r.i0 + 1; i <= r.i1; i++) {
        if (bm[i] && bm[i - 1] && bm[i].l !== bm[i - 1].l && Math.abs(amostras[i].pes.e.y - amostras[i].pes.d.y) > lim) {
          novos.push({ i0: a, i1: i - 1, quebraFim: true }); a = i;
        }
      }
      novos.push({ i0: a, i1: r.i1, quebraFim: r.quebraFim });
    }
    runs.length = 0; runs.push(...novos);
  }
  // início do apoio = aterrissagem do pé (descendo); fim = decolagem (subindo)
  // só tornozelo: o cruzamento do limiar já é a borda (extrapolar até a altura zero com a velocidade lenta do
  // tornozelo empurraria a borda para dentro do apoio)
  const borda = (iChao, iAr, inicio) => (soTornozelo
    ? cruzamento(ts[iChao], h[iChao] ?? 0, ts[iAr], h[iAr] ?? lim, lim)
    : bordaChao(ts, h, iChao, iAr, lim, !inicio));
  // descarta o primeiro e o último apoio se tocam a borda da série (incompletos)
  const passos = [];
  for (let k = 0; k < runs.length; k++) {
    const r = runs[k];
    if (r.i0 === 0 || r.i1 === amostras.length - 1) continue;
    const anteriorQuebra = k > 0 && runs[k - 1].quebraFim && runs[k - 1].i1 === r.i0 - 1;
    const tIni = anteriorQuebra ? (ts[r.i0 - 1] + ts[r.i0]) / 2 : borda(r.i0, r.i0 - 1, true);
    const tFim = r.quebraFim ? (ts[r.i1] + ts[r.i1 + 1]) / 2 : borda(r.i1, r.i1 + 1, false);
    if (tFim - tIni < 40) continue;                    // tremida, não apoio
    passos.push({ i0: r.i0, i1: r.i1, tIni, tFim, tc: tFim - tIni });
  }
  // ritmo nítido (quadril ou abertura das pernas): um "passo" que começa antes de 60% do passo de referência
  // é o mesmo apoio partido pelo ruído da pose — junta com o anterior
  const ritmo = [out.cadenciaQuadril, out.cadenciaPernas].filter((x) => x && x.forca >= 0.3).sort((a, b) => b.forca - a.forca)[0];
  if (ritmo) {
    const tRef = 60000 / ritmo.cadencia;
    for (let k = passos.length - 1; k > 0; k--) {
      const a = passos[k - 1], b = passos[k];
      if (b.tIni - a.tIni < 0.6 * tRef) { a.i1 = b.i1; a.tFim = b.tFim; a.tc = a.tFim - a.tIni; passos.splice(k, 1); out.juntados = (out.juntados || 0) + 1; }
    }
  }
  // voo, tempo de passo, sequências
  for (let k = 0; k < passos.length; k++) {
    const p = passos[k], q = passos[k + 1];
    p.tPasso = q ? q.tIni - p.tIni : null;
    p.tf = q ? Math.max(0, q.tIni - p.tFim) : null;
  }
  const medPasso = mediana(passos.map((p) => p.tPasso).filter((x) => x != null));
  for (const p of passos) if (p.tPasso != null && medPasso && p.tPasso > 1.6 * medPasso) { p.tPasso = null; p.tf = null; p.quebra = true; }
  // contato maior que um passo inteiro não é contato de corrida (pé perdido, dois apoios colados): fica fora das médias
  for (const p of passos) p.longo = Boolean(medPasso && p.tc > 1.2 * medPasso);

  // lado de cada passo: voto do rótulo + paridade por sequência
  for (const p of passos) {
    const im = Math.round((p.i0 + p.i1) / 2);
    p.voto = bm[im] ? bm[im].l : null;
  }
  let seq = [], ladosOk = true, nSeq = 0;
  const fecharSeq = () => {
    if (!seq.length) return;
    nSeq++;
    const cont2 = [{ e: 0, d: 0 }, { e: 0, d: 0 }];
    seq.forEach((p, i) => { if (p.voto) cont2[i % 2][p.voto]++; });
    const par = cont2[0].e >= cont2[0].d ? 'e' : 'd', impar = cont2[1].e >= cont2[1].d ? 'e' : 'd';
    let lp = par, li = impar;
    if (par === impar) {
      // os dois grupos votam no mesmo lado: decide pelo grupo com voto mais claro
      const m0 = Math.abs(cont2[0].e - cont2[0].d), m1 = Math.abs(cont2[1].e - cont2[1].d);
      if (m0 >= m1) li = par === 'e' ? 'd' : 'e'; else lp = impar === 'e' ? 'd' : 'e';
      if (seq.length >= 4) ladosOk = false;
    }
    seq.forEach((p, i) => { p.l = i % 2 === 0 ? lp : li; });
    seq = [];
  };
  for (const p of passos) { seq.push(p); if (p.quebra || p.tPasso == null) fecharSeq(); }
  fecharSeq();
  out.ladosOk = ladosOk && passos.length >= 4;

  // grandezas por passo
  const qRoll = [];
  if (!lateral) for (const a of amostras) if (a.quadris) { const { e, d } = a.quadris; const dd = Math.hypot(d.x - e.x, d.y - e.y); if (dd > 2) qRoll.push((d.y - e.y) / dd); }
  const rollMed = mediana(qRoll) || 0;
  passos.forEach((p, k) => {
    p.n = k + 1;
    p.lado = p.l === 'e' ? 'E' : 'D';
    const iC = (() => { let best = p.i0; for (const i of [p.i0 - 1, p.i0, p.i0 + 1]) if (i >= 0 && i < ts.length && Math.abs(ts[i] - p.tIni) < Math.abs(ts[best] - p.tIni)) best = i; return best; })();
    const a = amostras[iC];
    // perna em contato NESTA amostra: o pé mais baixo (rótulo local)
    const lc = bm[iC] ? bm[iC].l : p.l;
    const lo = lc === 'e' ? 'd' : 'e';
    const pc = a.pernas[lc];
    // joelho no contato: fora da faixa plausível (perna esticada a 180°, dobrada demais) é pose ruim — fica de fora
    p.joelhoContatoBruto = pc.joelho;
    const plausivel = pc.joelho != null && pc.joelho >= LIMITES.joelhoMin && pc.joelho <= LIMITES.joelhoMax;
    p.joelhoContato = !lateral || plausivel ? pc.joelho : null;     // de trás o joelho sai ~180° por natureza
    p.joelhoDuvidoso = lateral && pc.joelho != null && !plausivel;
    p.tornozeloContato = pc.tornozelo;
    // pé apoiado: mediana do ângulo do pé no meio do apoio
    const meioApoio = [];
    let jMin = null, jBal = null;
    for (let i = p.i0; i <= p.i1; i++) {
      const b = bm[i]; if (!b) continue;
      const pp = amostras[i].pernas[b.l], ps = amostras[i].pernas[b.l === 'e' ? 'd' : 'e'];
      const u = (ts[i] - p.tIni) / Math.max(1, p.tc);
      if (u > 0.3 && u < 0.7 && pp.peAng != null) meioApoio.push(pp.peAng);
      if (pp.joelho != null && pp.joelho >= 60 && (jMin == null || pp.joelho < jMin)) jMin = pp.joelho;
      if (ps.joelho != null && ps.joelho >= 20 && (jBal == null || ps.joelho < jBal)) jBal = ps.joelho;
    }
    // o balanço da outra perna continua no voo seguinte
    const fimBal = passos[k + 1] ? passos[k + 1].i0 : Math.min(amostras.length - 1, p.i1 + 6);
    for (let i = p.i1 + 1; i < fimBal; i++) {
      const pr = amostras[i].pernas; const v = [pr.e.joelho, pr.d.joelho].filter((x) => x != null);
      if (v.length) { const m = Math.min(...v); if (jBal == null || m < jBal) jBal = m; }
    }
    p.joelhoApoioMin = jMin;
    p.joelhoBalancoMin = jBal;     // da perna oposta a p.lado
    const plano = meioApoio.length ? mediana(meioApoio) : 0;
    p.anguloPe = pc.peAng != null ? pc.peAng - plano : null;
    p.pisada = lateral ? classificarPisada(p.anguloPe) : null;
    if (lateral && a.pel) {
      const xPe = pc.calcX != null ? pc.calcX : pc.tornX;
      p.peFrentePx = xPe != null ? (xPe - a.pel.x) * dir : null;
      p.peFrentePct = p.peFrentePx != null && perna ? (p.peFrentePx / perna) * 100 : null;
      p.peFrenteCm = p.peFrentePx != null && out.cmPorPx ? p.peFrentePx * out.cmPorPx : null;
      p.tibia = pc.joelhoX != null && pc.tornX != null ? (Math.atan2((pc.tornX - pc.joelhoX) * dir, pc.tornY - pc.joelhoY) * 180) / Math.PI : null;
      p.overstriding = p.tibia != null && p.peFrentePct != null && p.tibia > LIMITES.tibia && p.peFrentePct > LIMITES.peFrentePct;
    }
    // oscilação vertical do quadril e tronco ao longo do passo (até o próximo contato)
    const iFim = passos[k + 1] && !p.quebra ? passos[k + 1].i0 : null;
    if (iFim != null) {
      const ys = [], tr = [];
      let camAndou = false;
      for (let i = p.i0; i <= iFim; i++) {
        const b = amostras[i];
        if (b.cam && b.cam.movendo) camAndou = true;
        if (b.pel) ys.push(b.pel.y);
        if (lateral && b.pel && b.ombro) tr.push(inclinacaoVertical(b.pel, b.ombro, dir));
      }
      // com a câmera andando o quadril "oscila" junto com a imagem: não mede
      if (ys.length >= 3 && !camAndou) { p.oscPx = Math.max(...ys) - Math.min(...ys); p.oscCm = out.cmPorPx ? p.oscPx * out.cmPorPx : null; }
      if (tr.length) p.tronco = mediana(tr);
    }
    // vista de trás/frente: queda da pelve no apoio e largura do passo
    if (!lateral) {
      let pico = null, largs = [];
      for (let i = p.i0; i <= p.i1; i++) {
        const b = amostras[i];
        if (!b.quadris) continue;
        const { e, d } = b.quadris, dd = Math.hypot(d.x - e.x, d.y - e.y);
        if (dd < 2) continue;
        const q = (d.y - e.y) / dd - rollMed;
        const queda = (Math.asin(Math.max(-1, Math.min(1, p.l === 'e' ? q : -q))) * 180) / Math.PI;   // lado oposto descendo = +
        if (pico == null || queda > pico) pico = queda;
        const u = (ts[i] - p.tIni) / Math.max(1, p.tc);
        const pe = b.pes[p.l];
        if (u > 0.3 && u < 0.7 && pe) {
          const mx = (e.x + d.x) / 2, proprio = p.l === 'e' ? e : d;
          const s = Math.sign(proprio.x - mx) || 1;
          largs.push(((pe.x - mx) * s) / dd);
        }
      }
      p.quedaPelve = pico;
      p.largura = largs.length ? mediana(largs) : null;
    }
  });
  out.passos = passos.map((p) => ({ ...p }));
  const comCam = amostras.filter((a) => a.cam);
  out.camFracao = comCam.length ? comCam.filter((a) => a.cam.movendo).length / comCam.length : 0;
  out.camMovel = comCam.length >= 10 && out.camFracao > LIMITES.camMovel;
  out.camAgora = comCam.length ? Boolean(amostras[amostras.length - 1].cam && amostras[amostras.length - 1].cam.movendo) : false;
  out.chaoAtual = chao[chao.length - 1];
  out.duracao = ts[ts.length - 1] - ts[0];
  out.nAmostras = amostras.length;
  out.limiar = lim;
  out.contatoAgora = cont[cont.length - 1];
  return out;
}

const CHAVES_LADO = ['tc', 'tf', 'joelhoContato', 'joelhoApoioMin', 'joelhoBalancoMin', 'tornozeloContato', 'anguloPe',
  'peFrenteCm', 'peFrentePct', 'tibia', 'quedaPelve', 'largura', 'oscCm'];

const COM_SINAL = new Set(['anguloPe', 'peFrenteCm', 'peFrentePct', 'tibia', 'quedaPelve', 'largura']);

/** Resumo por lado, cadência, fases, simetria. */
export function resumoCorrida(r, cfg = {}) {
  const ps = r.passos || [];
  const tPassos = ps.map((p) => p.tPasso).filter((x) => x != null);
  const tp = mediana(tPassos);
  const plaus = (c) => (c != null && c >= LIMITES.cadenciaMin && c <= LIMITES.cadenciaMax ? c : null);
  const cadContatos = tp ? 60000 / tp : null;
  // cadência de referência: o ritmo mais nítido entre quadril e abertura das pernas
  const refs = [r.cadenciaQuadril && { ...r.cadenciaQuadril, fonte: 'quadril' }, r.cadenciaPernas && { ...r.cadenciaPernas, fonte: 'pernas' }]
    .filter(Boolean).sort((a, b) => b.forca - a.forca);
  const cq = refs[0] ? plaus(refs[0].cadencia) : null;
  // contatos confiáveis: passos suficientes e cadência batendo com a do quadril
  // e a maioria dos passos esperados na duração foi achada
  const dur = r.duracao || 0;
  const esperados = cq && dur ? (dur / 60000) * cq : null;
  const confiaveis = ps.length >= 6 && plaus(cadContatos) != null && (cq == null || Math.abs(cadContatos - cq) / cq < 0.08) &&
    (esperados == null || ps.length >= 0.7 * esperados);
  // amostragem lenta demais (RTMO ao vivo sem GPU, 1–3 Hz): passos a ~3/s não aparecem — nem contato nem ritmo
  const lenta = r.dt != null && r.dt > LIMITES.dtMax;
  const res = {
    // sem contatos confiáveis e sem ritmo de referência, a cadência dos contatos é chute — fica "—"
    passos: ps.length, cadencia: lenta ? null : confiaveis ? cadContatos : cq != null ? cq : (ps.length >= 8 ? plaus(cadContatos) : null), tPasso: tp,
    cadenciaContatos: lenta ? null : cadContatos, cadenciaQuadril: lenta ? null : cq, fonteRitmo: refs[0] ? refs[0].fonte : null,
    contatosConfiaveis: lenta ? false : confiaveis, amostragemLenta: lenta,
    tc: estat(lenta ? [] : ps.filter((p) => !p.longo).map((p) => p.tc)), tf: estat(lenta ? [] : ps.filter((p) => !p.longo).map((p) => p.tf)),
    osc: estat(ps.map((p) => p.oscCm)), oscPx: mediana(ps.map((p) => p.oscPx).filter((x) => x != null)),
    tronco: estat(ps.map((p) => p.tronco)),
    lados: { E: {}, D: {} }, simetria: {}, pisada: { 'retropé': 0, 'médio-pé': 0, 'antepé': 0 },
  };
  // apoio = contato ÷ passada (2 passos), passo a passo: só passos com contato E o passo seguinte medidos.
  // Por construção o contato de um passo cabe no tempo do passo — fica entre 0 e 50% (corrida tem voo).
  const razoes = ps.filter((p) => !p.longo && !p.quebra && p.tPasso > 0 && p.tc != null).map((p) => Math.min(1, p.tc / p.tPasso));
  res.apoioPct = !lenta && razoes.length >= 3 ? Math.max(0, Math.min(100, 50 * mediana(razoes))) : null;
  res.joelhosDuvidosos = ps.filter((p) => p.joelhoDuvidoso).length;
  res.camMovel = Boolean(r.camMovel); res.camFracao = r.camFracao || 0;
  res.balancoPct = res.apoioPct != null ? 100 - res.apoioPct : null;
  const v = cfg.velocidadeKmh > 0 ? cfg.velocidadeKmh / 3.6 : null;
  res.passoM = v && tp ? (v * tp) / 1000 : null;
  res.passadaM = res.passoM ? 2 * res.passoM : null;
  for (const L of ['E', 'D']) {
    const daqui = ps.filter((p) => p.lado === L);
    // o balanço medido no apoio de um lado é da perna do OUTRO lado
    const balanco = ps.filter((p) => p.lado !== L);
    for (const k of CHAVES_LADO) res.lados[L][k] = estat((k === 'joelhoBalancoMin' ? balanco : daqui).filter((p) => !((k === 'tc' || k === 'tf') && p.longo)).map((p) => p[k]));
    res.lados[L].n = daqui.length;
    res.lados[L].overstriding = daqui.filter((p) => p.overstriding).length;
  }
  // grandezas com sinal (passam por zero): a assimetria em % não faz sentido — vai a diferença absoluta
  res.diferenca = {};
  for (const k of CHAVES_LADO) {
    const e = res.lados.E[k].media, d = res.lados.D[k].media;
    if (COM_SINAL.has(k)) res.diferenca[k] = e != null && d != null ? Math.abs(e - d) : null;
    else res.simetria[k] = indiceSimetria(e, d);
  }
  for (const p of ps) if (p.pisada) res.pisada[p.pisada]++;
  if (cfg.vista === 'posterior') {
    res.pelve = { E: res.lados.E.quedaPelve.media, D: res.lados.D.quedaPelve.media };
    res.largura = { E: res.lados.E.largura.media, D: res.lados.D.largura.media };
  }
  return res;
}

/** Alertas (nível + texto) para o painel e o relatório. */
export function alertasCorrida(r, res, cfg = {}) {
  const al = [];
  const add = (nivel, texto, curto) => al.push({ nivel, texto, curto: curto || texto });
  if (res && res.amostragemLenta) {
    add('atencao', `Amostragem de ${num(1000 / r.dt, 1000 / r.dt < 10 ? 1 : 0)} Hz: abaixo de ${Math.round(1000 / LIMITES.dtMax)} Hz os passos (~3 por segundo) não são captados — cadência, contato e voo ficam sem medida. Use "Analisar vídeo quadro a quadro" (tempo exato de cada quadro) ou "BlazePose por recorte" com poucos corredores.`, 'amostragem lenta: sem cadência');
  }
  if (!res || (res.passos < 4 && !res.cadenciaQuadril)) return al;
  if (r.dt > 45 && !res.amostragemLenta) add('info', `Amostragem de ${Math.round(1000 / r.dt)} Hz: contato e voo têm até ±${Math.round(r.dt)} ms por passo. Use "Analisar vídeo quadro a quadro" ou câmera lenta.`);
  if (!r.ladosOk) add('info', 'Esquerda/direita não confirmadas pela pose: os lados aparecem como A/B prováveis.');
  if (res.camMovel) add('atencao', `Câmera em movimento em ${Math.round(res.camFracao * 100)}% do tempo (panorâmica/zoom): cadência, contato, voo e ângulos continuam valendo; oscilação vertical e distâncias não são medidas.`, 'câmera em movimento');
  if (cfg.pontos === 17) add('info', 'Pose de 17 pontos (RTMO, várias pessoas): sem calcanhar e ponta do pé — pisada e tornozelo não são medidos; o contato usa o tornozelo.');
  const total = (r.descartadas || 0) + (r.nAmostras || 0);
  if (r.descartadas && total && r.descartadas / total > 0.1) {
    const mot = Object.entries(r.motivos || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k).join(', ');
    add('info', `${r.descartadas} de ${total} amostras descartadas por pose incoerente (${mot}) — corredores colados podem fundir dois esqueletos.`, 'poses descartadas');
  }
  if (res.joelhosDuvidosos >= 2) add('info', `${res.joelhosDuvidosos} ${res.joelhosDuvidosos === 1 ? 'passo' : 'passos'} com joelho no contato fora do plausível (${LIMITES.joelhoMin}–${LIMITES.joelhoMax}°): pose duvidosa, fora das médias.`);
  if (!res.contatosConfiaveis && res.cadenciaQuadril) add('atencao', `Contatos incertos (pés ruidosos ou cortados na imagem): cadência pelo ritmo ${res.fonteRitmo === 'pernas' ? 'da abertura das pernas' : 'do quadril'}, ${Math.round(res.cadenciaQuadril)} passos/min; contato, voo e ângulos por passo são indicativos.`, `contatos incertos: cadência pelo ritmo ${res.fonteRitmo === 'pernas' ? 'das pernas' : 'do quadril'}`);
  const porPasso = res.contatosConfiaveis !== false;   // alertas que dependem de cada contato só com contatos confiáveis
  if (cfg.vista !== 'posterior') {
    const n = res.lados.E.overstriding + res.lados.D.overstriding;
    if (porPasso && n >= Math.max(2, 0.5 * res.passos)) add('atencao', `Overstriding em ${n} de ${res.passos} passos: pé muito à frente do quadril e tíbia inclinada no contato. Experimente subir a cadência 5–10%.`, `overstriding em ${n}/${res.passos} passos`);
    if (res.cadencia && res.cadencia < LIMITES.cadenciaBaixa) add('atencao', `Cadência baixa (${Math.round(res.cadencia)} passos/min).`, 'cadência baixa');
    if (res.tronco.media != null && res.tronco.media > LIMITES.troncoMax) add('atencao', `Tronco muito inclinado à frente (${res.tronco.media.toFixed(0)}°).`, 'tronco muito à frente');
    if (res.tronco.media != null && res.tronco.media < LIMITES.troncoMin) add('atencao', `Tronco inclinado para trás (${res.tronco.media.toFixed(0)}°).`, 'tronco para trás');
    if (res.osc.media != null && res.osc.media > LIMITES.oscilacaoCm) add('atencao', `Oscilação vertical alta (${res.osc.media.toFixed(1).replace('.', ',')} cm).`, 'oscilação alta');
    const pis = Object.entries(res.pisada).sort((a, b) => b[1] - a[1])[0];
    if (porPasso && pis && pis[1] >= 3) add('info', `Pisada predominante: ${pis[0]} (${pis[1]} de ${res.passos} passos).`);
  } else {
    for (const L of ['E', 'D']) {
      const q = res.lados[L].quedaPelve.media;
      if (q != null && q > LIMITES.quedaPelve) add('atencao', `Queda da pelve no apoio ${L === 'E' ? 'esquerdo' : 'direito'}: ${q.toFixed(1).replace('.', ',')}°.`, `queda da pelve ${L}`);
      const w = res.lados[L].largura.media;
      if (w != null && w < 0) add('atencao', `Pé ${L === 'E' ? 'esquerdo' : 'direito'} cruza a linha média (cruzamento).`, `cruzamento ${L}`);
    }
  }
  for (const [k, nome] of [['tc', 'tempo de contato'], ['joelhoContato', 'joelho no contato'], ['joelhoApoioMin', 'flexão do joelho no apoio']]) {
    const s = res.simetria[k];
    if (porPasso && s != null && s > LIMITES.assimetria && res.lados.E.n >= 3 && res.lados.D.n >= 3) add('atencao', `Assimetria de ${s.toFixed(0)}% no ${nome}.`, `assimetria ${s.toFixed(0)}% (${nome})`);
  }
  return al;
}

export class SessaoCorrida {
  constructor() { this.zerar(); }
  zerar() {
    this.amostras = []; this.cache = null; this.sujo = true; this.t0 = null;
    this.descartadas = 0; this.motivos = {}; this.pernasOk = []; this.seguidasTamanho = 0;
  }
  /**
   * Amostra nova. meta = { cam: { movendo, vx, vy } } (câmera, opcional).
   * Pose incoerente (duas pessoas fundidas, membros impossíveis) não entra:
   * conta em `descartadas` e devolve null.
   */
  adicionar(t, P, minVis = 0.3, meta = {}) {
    if (this.amostras.length && t <= this.amostras[this.amostras.length - 1].t) return null;
    const ancora = this.pernasOk.length >= 8 ? mediana(this.pernasOk) : null;
    const coer = coerenciaPose(P, ancora, minVis);
    if (!coer.ok) {
      // zoom de verdade: só "tamanho mudou" por muitas amostras seguidas — recomeça a referência
      if (coer.motivo === 'tamanho mudou' && ++this.seguidasTamanho >= 8) { this.pernasOk = []; this.seguidasTamanho = 0; }
      this.descartadas++; this.motivos[coer.motivo] = (this.motivos[coer.motivo] || 0) + 1;
      return null;
    }
    this.seguidasTamanho = 0;
    if (coer.perna) { this.pernasOk.push(coer.perna); if (this.pernasOk.length > 30) this.pernasOk.shift(); }
    const a = extrairCorrida(P, minVis);
    a.t = t;
    a.cam = meta.cam ? { movendo: Boolean(meta.cam.movendo), vx: meta.cam.vx || 0, vy: meta.cam.vy || 0 } : null;
    if (this.t0 == null) this.t0 = t;
    this.amostras.push(a);
    if (this.amostras.length > 11000) this.amostras.splice(0, 1000);
    this.sujo = true;
    return a;
  }
  analisar(cfg) {
    const chave = JSON.stringify([cfg.vista, cfg.alturaCm, cfg.velocidadeKmh]);
    if (!this.sujo && this.cache && this.cacheChave === chave) return this.cache;
    this.cache = analisarCorrida(this.amostras, cfg); this.cacheChave = chave; this.sujo = false;
    this.cache.descartadas = this.descartadas; this.cache.motivos = { ...this.motivos };
    return this.cache;
  }
}

