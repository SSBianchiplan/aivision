/**
 * operators/livres-f/ergonomia.js — CV-29 Ergonomia (RULA/REBA).
 *
 * Avaliação postural padronizada a partir da câmera, por pessoa:
 *
 *   1. POSE. Usa o ctx.poses publicado pela Pose multi-pessoa (RTMO, CV-18,
 *      Apache-2.0) se ela vier antes na cadeia; sem ela, roda o próprio
 *      operador do RTMO aqui dentro (mesmo modelo, mesmo pedido de carga,
 *      mesma fila única de inferência), com o desenho dele descartado.
 *   2. MÃOS (opcional). Com o MediaPipe Hands (CV-25) antes na cadeia
 *      (ctx.hands), ou rodando-o aqui ("rodar aqui"), o punho é medido —
 *      flexão/extensão e desvio — em vez de assumido.
 *   3. ID. Se um Re-ID ou tracking veio depois da pose e marcou ctx.detections
 *      com `id`, a pessoa herda esse ID; senão, um rastreio simples por caixa
 *      (runtime/livres-f/ergonomia.js · Rastreador) dá IDs estáveis.
 *   4. ÂNGULOS → RULA e REBA (tabelas oficiais), suavizados no tempo (τ
 *      ajustável), lado escolhido ou pior lado, e a SESSÃO no canal: tempo em
 *      cada nível, pico com a postura congelada (miniatura + pose), alertas
 *      quando a nota fica na faixa ≥ limite por N segundos.
 *
 * Overlay: esqueleto com cada segmento colorido pelo próprio escore, caixa e
 * nota sobre cada pessoa, faixa de alerta no canto. Nada sai do aparelho.
 * A matemática está em runtime/livres-f/ergonomia.js; a sessão e o painel,
 * em runtime/livres-f/canal.js e components/esportes/ErgonomiaPanel.js.
 */
import { clone, free } from '../../core.js';
import { poseRtmo } from '../livres-a/pose.js';
import { maos as maosOp } from '../livres-d/maos.js';
import {
  medirPostura, avaliar, notaDe, faixaDe, corDe, corSegmento, nivel, iouCaixas, FAIXAS,
} from '../../runtime/livres-f/ergonomia.js';
import { obterSessao, obterRastreador, publicar, estaGravando } from '../../runtime/livres-f/canal.js';

const G = 'CV-29';
const CINZA = '#94a3b8';

/** Caminhos numéricos das medidas que a suavização acompanha. */
const SUAVES = [
  ['tronco'], ['pescoco'], ['troncoLat'], ['pescocoLat'], ['joelho', 'e'], ['joelho', 'd'],
  ['lados', 'e', 'braco'], ['lados', 'e', 'antebraco'], ['lados', 'e', 'abducao'],
  ['lados', 'd', 'braco'], ['lados', 'd', 'antebraco'], ['lados', 'd', 'abducao'],
];
const ler = (o, c) => c.reduce((a, k) => (a == null ? a : a[k]), o);
function escrever(o, c, v) {
  let a = o;
  for (let i = 0; i < c.length - 1; i++) { if (a[c[i]] == null) return; a = a[c[i]]; }
  a[c[c.length - 1]] = v;
}
/** Média exponencial com constante de tempo τ (s), independente da taxa de quadros. */
function suavizar(anterior, m, dt, tau) {
  if (!anterior || !(tau > 0) || dt > 1500) return m;
  const al = 1 - Math.exp(-dt / 1000 / tau);
  for (const c of SUAVES) {
    const a = ler(anterior, c), b = ler(m, c);
    if (Number.isFinite(a) && Number.isFinite(b)) escrever(m, c, a + al * (b - a));
  }
  for (const l of ['e', 'd']) {
    const a = anterior.lados && anterior.lados[l] && anterior.lados[l].punho, b = m.lados[l] && m.lados[l].punho;
    if (a && b) { b.flex = a.flex + al * (b.flex - a.flex); b.desvio = a.desvio + al * (b.desvio - a.desvio); }
  }
  return m;
}

// ------------------------------------------------------------ miniatura

const LADO_MINI = 180;
function novoCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
/**
 * Recorte quadrado em volta da pessoa (caixa + 12%), em JPEG, e os pontos
 * da pose nas coordenadas da miniatura (0..LADO_MINI) para o painel
 * redesenhar o esqueleto colorido por cima.
 */
function miniatura(src, caixa, pts, st) {
  try {
    if (typeof document === 'undefined') return null;
    const W = src.width, H = src.height;
    if (!st.fc || st.fc.width !== W || st.fc.height !== H) st.fc = novoCanvas(W, H);
    st.fc.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
    const cx = ((caixa.x1 + caixa.x2) / 2) * W, cy = ((caixa.y1 + caixa.y2) / 2) * H;
    const s = Math.max((caixa.x2 - caixa.x1) * W, (caixa.y2 - caixa.y1) * H) * 1.12;
    const x0 = cx - s / 2, y0 = cy - s / 2, k = LADO_MINI / s;
    const c = document.createElement('canvas'); c.width = LADO_MINI; c.height = LADO_MINI;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, LADO_MINI, LADO_MINI);
    g.drawImage(st.fc, x0, y0, s, s, 0, 0, LADO_MINI, LADO_MINI);
    return {
      thumb: c.toDataURL('image/jpeg', 0.8),
      pose: { T: LADO_MINI, pts: pts.map((p) => ({ x: (p.x - x0) * k, y: (p.y - y0) * k, v: p.v })) },
    };
  } catch (_) { return null; }
}

// ------------------------------------------------------------- desenho

/** Pontos do esqueleto por segmento (índices COCO do MODELO, já com o espelho resolvido). */
function segmentosDe(m, idx) {
  const P = m.pts, out = [];
  const ok = (i) => P[i] && P[i].v >= m._kpConf;
  const lin = (a, b, seg, lado) => { if (a && b) out.push({ a, b, seg, lado }); };
  lin(m.mQuadril, m.mOmbro, 'tronco');
  // pescoço: ombro médio → orelha mais visível
  const or = [idx.e.orelha, idx.d.orelha].filter(ok).sort((a, b) => P[b].v - P[a].v)[0];
  if (or != null && m.mOmbro) lin(m.mOmbro, P[or], 'pescoco');
  for (const l of ['e', 'd']) {
    const I = idx[l];
    if (ok(I.ombro) && ok(I.cotovelo)) lin(P[I.ombro], P[I.cotovelo], 'braco', l);
    if (ok(I.cotovelo) && ok(I.punho)) lin(P[I.cotovelo], P[I.punho], 'antebraco', l);
    if (ok(I.quadril) && ok(I.joelho)) lin(P[I.quadril], P[I.joelho], 'pernas', l);
    if (ok(I.joelho) && ok(I.tornozelo)) lin(P[I.joelho], P[I.tornozelo], 'pernas', l);
  }
  return out;
}
const IDX = {
  e: { orelha: 3, ombro: 5, cotovelo: 7, punho: 9, quadril: 11, joelho: 13, tornozelo: 15 },
  d: { orelha: 4, ombro: 6, cotovelo: 8, punho: 10, quadril: 12, joelho: 14, tornozelo: 16 },
};

// ------------------------------------------------------------ operador

export const ergonomia = {
  op: 'ergonomia.avaliar',
  label: 'Ergonomia (RULA/REBA)',
  group: G,
  model: 'rtmo-s',
  overlayOnly: true,
  desc: 'Avaliação postural RULA (membros superiores) e REBA (corpo inteiro) pela pose, uma nota por ' +
        'pessoa: ângulos de braço, antebraço, punho, pescoço, tronco e pernas (vista lateral), tabelas ' +
        'oficiais, nível de ação, % do tempo em cada nível, pior postura e alertas. Usa a pose RTMO da ' +
        'cadeia ou roda a sua; mãos (MediaPipe) opcionais para o punho. Painel Ergonomia com relatório.',
  params: {
    metodo: { type: 'enum', options: ['RULA', 'REBA'], default: 'RULA', label: 'Método' },
    lado: { type: 'enum', options: ['pior lado', 'esquerdo', 'direito'], default: 'pior lado', label: 'Lado avaliado' },
    vista: { type: 'enum', options: ['automática', 'lateral', 'frontal'], default: 'automática', label: 'Vista da câmera' },
    sentado: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Trabalho sentado' },
    cargaRula: { type: 'int', min: 0, max: 3, step: 1, default: 0, label: 'RULA: carga/força (0 <2 kg … 3 >10 kg)' },
    musculoRula: { type: 'bool', default: false, label: 'RULA: uso muscular (estática ou >4×/min)' },
    punhoTorcao: { type: 'int', min: 1, max: 2, step: 1, default: 1, label: 'Torção do punho (1 meio, 2 fim do curso)' },
    punhoSemMaos: { type: 'int', min: 1, max: 3, step: 1, default: 2, label: 'Punho sem mãos (1 neutro, 2 ≤15°, 3 >15°)' },
    cargaReba: { type: 'int', min: 0, max: 2, step: 1, default: 0, label: 'REBA: carga (0 <5 kg, 1 5–10, 2 >10)' },
    choque: { type: 'bool', default: false, label: 'REBA: choque ou força brusca' },
    pega: { type: 'int', min: 0, max: 3, step: 1, default: 0, label: 'REBA: pega (0 boa … 3 inaceitável)' },
    estatica: { type: 'bool', default: false, label: 'REBA: parte do corpo parada >1 min' },
    repetitiva: { type: 'bool', default: false, label: 'Ações repetidas >4×/min' },
    instavel: { type: 'bool', default: false, label: 'REBA: mudanças bruscas / base instável' },
    estaticaAuto: { type: 'bool', default: true, label: 'Detectar postura estática (>1 min)' },
    ombroElevado: { type: 'bool', default: false, label: 'Ombro elevado' },
    bracoApoiado: { type: 'bool', default: false, label: 'Braço apoiado' },
    troncoTorcido: { type: 'bool', default: false, label: 'Tronco torcido' },
    pescocoTorcido: { type: 'bool', default: false, label: 'Pescoço torcido' },
    maos: { type: 'enum', options: ['da cadeia', 'rodar aqui', 'não usar'], default: 'da cadeia', label: 'Mãos (punho)' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada' },
    alertaFaixa: { type: 'int', min: 2, max: 4, step: 1, default: 3, label: 'Alertar a partir da faixa (2 médio, 3 alto, 4 muito alto)' },
    alertaSeg: { type: 'int', min: 1, max: 300, step: 1, default: 10, label: 'Alertar após (s)' },
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mín. da pessoa' },
    kpConf: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.3, label: 'Score mín. do ponto' },
    maxPessoas: { type: 'int', min: 1, max: 20, step: 1, default: 10, label: 'Máx. pessoas' },
    suavizar: { type: 'float', min: 0, max: 2, step: 0.1, default: 0.3, label: 'Suavização (s)' },
    esqueleto: { type: 'bool', default: true, label: 'Desenhar esqueleto' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. da pose (ms)' },
  },
  apply(src, p, state, ctx) {
    const t = performance.now();
    const W = ctx.w, H = ctx.h;
    const esp = p.espelhada === 'automático' ? Boolean(ctx.mirrored) : p.espelhada === 'sim';

    // ---- 1. pose: da cadeia ou o RTMO aqui dentro
    let poses = Array.isArray(ctx.poses) ? ctx.poses : null;
    let fonte = 'cadeia';
    if (!poses) {
      fonte = 'própria';
      if (!state.rtmo) state.rtmo = {};
      const sub = { w: W, h: H, overlay: [], metrics: {}, mirrored: ctx.mirrored, frameIndex: ctx.frameIndex };
      const r = poseRtmo.apply(src, { conf: p.conf, kpConf: p.kpConf, maxPessoas: p.maxPessoas, caixa: false,
        corPorPessoa: false, everyMs: p.everyMs }, state.rtmo, sub);
      free(r);
      for (const [k, v] of Object.entries(sub.metrics)) if (k !== 'pessoas' && k !== 'pontos visíveis') ctx.metrics[k] = v;
      poses = sub.poses || [];
    }

    // a mesma pessoa às vezes sai duas vezes (caixas quase iguais): fica a de maior score
    poses = poses.slice().sort((a, b) => (b.score || 0) - (a.score || 0))
      .filter((q, i, arr) => !arr.slice(0, i).some((r) => iouCaixas(q.box, r.box) > 0.6));

    // ---- 2. mãos
    let maos = [];
    if (p.maos === 'da cadeia') maos = Array.isArray(ctx.hands) ? ctx.hands : [];
    else if (p.maos === 'rodar aqui') {
      if (!state.maos) state.maos = {};
      const sub = { w: W, h: H, overlay: [], metrics: {}, mirrored: ctx.mirrored, frameIndex: ctx.frameIndex };
      const r = maosOp.apply(src, { conf: 0.5, minHand: 0.6, max: 4, espelhado: 'automático', desenho: 'só caixa',
        gestos: false, deteccoes: false, everyMs: p.everyMs }, state.maos, sub);
      free(r);
      for (const [k, v] of Object.entries(sub.metrics)) if (/ms|erro|mp-|hand|palm/i.test(k)) ctx.metrics[k] = v;
      maos = sub.hands || [];
    }

    if (p.maos !== 'não usar') ctx.metrics['mãos'] = maos.length;

    // ---- 3. IDs: os do Re-ID/tracking da cadeia, ou o rastreio simples
    const caixas = poses.map((q) => q.box);
    let ids = null;
    const dets = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => d && d.id != null) : [];
    if (dets.length && poses.length) {
      const ext = caixas.map((c) => {
        let mel = null, s = 0.5;
        for (const d of dets) { const v = iouCaixas(c, d); if (v > s) { s = v; mel = d; } }
        return mel ? 'R' + mel.id : null;
      });
      if (ext.every(Boolean)) ids = ext;
    }
    if (!ids) ids = obterRastreador().atualizar(caixas, t).map((n) => 'P' + n);

    // ---- 4. medir, suavizar, avaliar, registrar
    const sessao = obterSessao();
    // fonte parada (YouTube pausado, histórico): o tempo de exposição não corre
    // e o quadro repetido não vira amostra (ver cv/runtime/parado.js)
    const gravar = estaGravando() && !ctx.fonteParada;
    if (!state.ant) state.ant = new Map();
    if (!state.mini) state.mini = new Map();
    const pessoas = [];
    const presentes = new Set();
    const M = p.metodo === 'REBA' ? 'REBA' : 'RULA';
    poses.forEach((q, i) => {
      const id = ids[i];
      presentes.add(id);
      let m = medirPostura(q.keypoints, { w: W, h: H, kpConf: p.kpConf, espelhada: esp, vista: p.vista, maos });
      m._kpConf = p.kpConf;
      const ant = state.ant.get(id);
      m = suavizar(ant && ant.m, m, ant ? t - ant.t : Infinity, p.suavizar);
      state.ant.set(id, { m, t });
      const av = avaliar(m, p, { estatica: sessao.estatica(id, t) });
      if (gravar && av.ok) {
        const r = sessao.registrar(id, t, av, { metodo: M, alertaFaixa: p.alertaFaixa, alertaSeg: p.alertaSeg });
        const pp = sessao.pessoas.get(id);
        const fresco = ['RULA', 'REBA'].filter((k) => pp.pico[k] && pp.pico[k].fresco);
        if (fresco.length && t - (state.mini.get(id) || 0) > 700) {
          const mi = miniatura(src, q.box, m.pts, state);
          state.mini.set(id, t);
          for (const k of fresco) {
            pp.pico[k].fresco = false;
            if (mi) { pp.pico[k].thumb = mi.thumb; pp.pico[k].pose = mi.pose; }
          }
        }
        if (r.alerta) state.ultimoAlerta = r.alerta;
      }
      pessoas.push({ id, box: q.box, m, av, nota: notaDe(av, M) });
    });
    for (const id of state.ant.keys()) if (!presentes.has(id) && t - state.ant.get(id).t > 3000) state.ant.delete(id);
    if (gravar) sessao.ausentes(presentes, t);

    // ---- 5. overlay
    const met = M === 'REBA' ? 'reba' : 'rula';
    const idx = esp ? { e: IDX.d, d: IDX.e } : IDX;
    let linhaAlerta = 0;
    for (const pe of pessoas) {
      const { box, m, av } = pe;
      const corNota = av.ok ? corDe(M, pe.nota) : CINZA;
      const nv = av.ok ? nivel(M, pe.nota) : null;
      ctx.overlay.push({
        type: 'rect', x: box.x1 * W, y: box.y1 * H, w: (box.x2 - box.x1) * W, h: (box.y2 - box.y1) * H, color: corNota,
        label: av.ok ? `${pe.id} · ${M} ${pe.nota} · ${nv.nome.toLowerCase()}${av.lado ? ' (' + (av.lado === 'e' ? 'esq.' : 'dir.') + ')' : ''}`
          : `${pe.id} · sem braços visíveis`,
      });
      if (p.esqueleto) {
        for (const s of segmentosDe(m, idx)) {
          let cor = CINZA;
          if (av.ok) {
            const seg = s.lado && av.porLado[s.lado] ? av.porLado[s.lado][met].seg : av[met].seg;
            const esc = s.seg === 'antebraco' || s.seg === 'braco'
              ? (s.lado && av.porLado[s.lado] ? av.porLado[s.lado][met].seg[s.seg] : null)
              : av[met].seg[s.seg];
            cor = esc == null ? CINZA : corSegmento(M, s.seg, esc);
            if (s.lado && s.lado !== av.lado && seg) cor = cor + 'b0';   // lado não avaliado, um pouco apagado
          }
          ctx.overlay.push({ type: 'line', x1: s.a.x, y1: s.a.y, x2: s.b.x, y2: s.b.y, color: cor, width: s.lado && s.lado !== av.lado ? 2.5 : 4 });
        }
        // punho: ponto colorido pelo escore do punho (vazio = assumido)
        if (av.ok) {
          for (const l of ['e', 'd']) {
            const L = av.porLado[l], P = m.pts[idx[l].punho];
            if (!L || !P || P.v < p.kpConf) continue;
            ctx.overlay.push({ type: 'point', x: P.x, y: P.y, r: L.semPunho ? 3 : 5,
              color: L.semPunho ? CINZA : corSegmento(M, 'punho', L[met].seg.punho) });
          }
        }
      }
      const pp = sessao.pessoas.get(pe.id);
      if (pp && pp.alerta.ativo && pp.alerta.metodo === M) {
        const s = Math.round((t - pp.alerta.desde) / 1000);
        ctx.overlay.push({ type: 'banner', x: 8, y: 8 + linhaAlerta * 26, color: FAIXAS[4].cor,
          text: `⚠ ${pe.id}: ${M} ${pe.nota} há ${s} s` });
        linhaAlerta++;
      }
    }

    // ---- 6. métricas e retrato para o painel
    const validas = pessoas.filter((x) => x.av.ok);
    ctx.metrics['pessoas'] = pessoas.length;
    if (validas.length) {
      const pior = validas.reduce((a, b) => (b.nota > a.nota ? b : a));
      ctx.metrics[`${M} máx.`] = `${pior.nota} (${pior.id})`;
      ctx.metrics['nível'] = nivel(M, pior.nota).nome;
    }
    if (fonte === 'própria' && !poses.length && !state.rtmo.results) ctx.metrics['ergonomia'] = 'aguardando a pose (RTMO)';
    publicar({
      t, metodo: M, fonte, espelhada: esp, maos: maos.length,
      pessoas: pessoas.map((x) => ({ id: x.id, box: x.box, av: x.av, nota: x.nota, faixa: x.av.ok ? faixaDe(M, x.nota) : null,
        vista: x.m.vista, avisos: x.m.avisos })),
    });
    return clone(src);
  },
};

export default [ergonomia];
