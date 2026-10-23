/**
 * operators/livres-m/takt.js — takt.posto (CV-39 Tempo de posto, porte do GPlanSiS|Takt).
 *
 * Para cada POSTO — área desenhada com as Ferramentas de mouse e com a função
 * "Takt · posto" (a função só aparece com este nó no Pipeline) — o operador:
 *
 *   1. PESSOAS. Pega as poses multi-pessoa da cadeia (ctx.poses, da Pose
 *      RTMO) ou roda o próprio RTMO; o ID vem do rastreio da cadeia (caixas
 *      de ctx.detections com `id`, por IoU) ou do rastreio simples por caixa
 *      (o mesmo da Ergonomia).
 *   2. POSIÇÃO. O pé (média dos tornozelos visíveis, senão a base da caixa,
 *      como o worker). A PRESENÇA no posto é medida no plano da imagem (padrão,
 *      como a bancada do Takt: raio em fração da altura do quadro) ou, com o
 *      piso calibrado e "Presença no piso", em metros pela homografia (como o
 *      worker: o polígono do posto é projetado no chão e o raio é em m — o
 *      posto deve então ser desenhado sobre o CHÃO da área de trabalho). Com
 *      calibração, posição, deslocamento e a planta são sempre em metros.
 *   3. ATIVIDADE. O posto mais próximo dá a ROI das mãos (o próprio polígono,
 *      em px) e o ActivityScorer (porte fiel) mede mãos na ROI, energia de
 *      movimento dos punhos e orientação do corpo.
 *   4. ESTADO. O EventManager (porte fiel: histerese, tempos de confirmação
 *      que retroagem) decide PRODUTIVO, OCIOSO_NO_POSTO, VAGO,
 *      PAUSA_PROGRAMADA (agenda de turnos) ou NAO_OBSERVADO. Fonte pausada
 *      (ctx.fonteParada) = câmera sem quadro → NAO_OBSERVADO; câmera ao vivo
 *      com a pessoa parada é dado real (ocioso), por isso NÃO se compara a
 *      imagem para decidir "parado".
 *   5. PRIVACIDADE. Com "Borrar rostos" (ligado por padrão) o operador
 *      devolve o quadro com os rostos borrados — por isso ele NÃO é só
 *      overlay: o vídeo exibido, a gravação e o PNG saem borrados.
 *
 * Publica ctx.takt (estado por posto) e ctx.piso (homografia e conversão
 * quadro→metros) para os operadores seguintes; a sessão, os KPIs por turno, os
 * alarmes e os CSVs ficam no motor (runtime/livres-m/canal.js).
 */
import { clone, free } from '../../core.js';
import { AREAS, vistaParaFonte, registrarEvento } from '../../marcacoes.js';
import { iou } from '../../runtime/opkit.js';
import { KP_LIGACOES } from '../livres-a/pose.js';
import { obterMotor, publicar, tempoDaFonte, studioAberto, COR_ESTADO, ROTULO, centroVertices } from '../../runtime/livres-m/canal.js';
import { obterPoses, regioesDasPoses } from './privacidade.js';
import { borrarRegioes } from '../../runtime/livres-m/takt-nucleo.js';
import { registrarRegiao, regioesMudaram } from '../../regioes.js';
import { assinar as assinarTakt, avisarAgora as avisarTakt } from '../../runtime/livres-m/canal.js';

const G = 'CV-39';
export const FUNCAO_POSTO = 'takt_posto';

/** Polígono (0–1 do quadro) de uma marcação de área: retângulo, elipse (24 lados) ou polígono. */
export function poligonoDe(it) {
  if (it.tipo === 'poligono') return it.pts.map((q) => [q[0], q[1]]);
  const c = it.caixa;
  if (it.tipo === 'retangulo') return [[c.x1, c.y1], [c.x2, c.y1], [c.x2, c.y2], [c.x1, c.y2]];
  const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2, rx = (c.x2 - c.x1) / 2, ry = (c.y2 - c.y1) / 2;
  return Array.from({ length: 24 }, (_, i) => [cx + rx * Math.cos((i * Math.PI) / 12), cy + ry * Math.sin((i * Math.PI) / 12)]);
}

const mmss = (s) => {
  if (!Number.isFinite(s) || s < 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};

export const taktPosto = {
  op: 'takt.posto',
  label: 'Takt — tempo de posto',
  group: G,
  calibravel: { rotulo: 'Calibrar piso (Studio Takt)' },
  // muda os pixels quando "Borrar rostos" está ligado (o padrão): o vídeo exibido é o quadro processado
  // só mexe nos pixels com o borrão LGPD ligado; sem ele, o vídeo segue nítido (caminho overlay)
  overlayOnly: (p) => !p.borrarRostos,
  desc: 'Tempo de posto (porte do GPlanSiS|Takt): para cada área marcada com a função "Takt · posto", associa as ' +
        'pessoas (pose multi-pessoa + IDs), mede a atividade (mãos na área, movimento dos punhos, orientação) e ' +
        'decide produtivo, ocioso no posto, vago, pausa programada ou não observado, com histerese e tempos ' +
        'mínimos. Turnos e pausas, piso calibrado em metros, rostos borrados (LGPD), KPIs, alarmes e CSV no ' +
        'Studio Takt.',
  params: {
    borrarRostos: { type: 'bool', default: true, label: 'Borrar rostos (LGPD)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar postos e pessoas no vídeo' },
    esqueleto: { type: 'bool', default: true, label: 'Esqueleto (quando a pose é própria)' },
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mín. da pessoa (pose própria)' },
    maxPessoas: { type: 'int', min: 1, max: 30, step: 1, default: 12, label: 'Máx. pessoas (pose própria)' },
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 0, label: 'Intervalo mín. da pose própria (ms)' },
  },
  apply(src, p, state, ctx) {
    const motor = obterMotor();
    const C = motor.cfg;
    const { w, h } = ctx;
    const bruto = obterPoses(src, state, ctx, { conf: p.conf, maxPessoas: p.maxPessoas, everyMs: p.everyMs });
    const { fonte: fontePose, nova } = bruto;
    // a mesma pessoa às vezes sai duas vezes (caixas quase iguais): fica a de maior score (como na Ergonomia)
    const poses = bruto.poses.slice().sort((a, b) => (b.score || 0) - (a.score || 0))
      .filter((q, i, arr) => q.box && !arr.slice(0, i).some((o) => iou(q.box, o.box) > 0.6));
    if (!state.ligado) { state.ligado = true; motor.aoEvento = (e) => registrarEvento({ t: new Date(e.ts).toISOString(), marcacao: e.posto || 'Takt', evento: e.evento, classe: 'takt', id: e.detalhe }); }

    // ---- postos marcados na imagem
    const mq = ctx.marcacoes;
    const itens = mq ? mq.itens.filter((it) => it.funcao === FUNCAO_POSTO && AREAS.has(it.tipo)) : [];
    const piso = motor.piso;
    const calibrado = Boolean(piso.calibrado);
    // presença: no plano da imagem (padrão, como a bancada do Takt) ou no piso em metros (como o worker)
    const usaPiso = calibrado && C.presenca === 'piso';
    const asp = w / h;
    const paraMetros = (x, y) => { const f = vistaParaFonte(x, y); return motor.fonteParaPiso(f[0], f[1]); };
    // quadro (0–1) → unidade da conta de presença: metros, ou "alturas de imagem"
    const paraUnidade = (x, y) => (usaPiso && paraMetros(x, y)) || [x * asp, y];
    const postos = itens.map((it) => {
      const poly = poligonoDe(it);
      const roi = poly.map(([x, y]) => [x * w, y * h]);
      return { id: it.id, nome: it.nome, poly, roi, centro: centroVertices(roi), zona: poly.map(([x, y]) => paraUnidade(x, y)),
               zonaM: calibrado ? poly.map(([x, y]) => paraMetros(x, y)).filter(Boolean) : null,
               raio: usaPiso ? C.raio_m : C.raio_img };
    });

    // ---- relógio e cadência (≈ amostrasHz; só com pose nova — o mesmo esqueleto duas vezes zera o movimento)
    const fv = tempoDaFonte();
    const parada = Boolean(ctx.fonteParada) || Boolean(fv.video && fv.pausado);
    const agoraWall = Date.now();
    const intervalo = 1000 / Math.max(0.5, C.amostrasHz);
    let processou = false;
    const prazo = state.ultWall == null || agoraWall - state.ultWall >= intervalo * 0.9;
    const preso = state.ultWall != null && agoraWall - state.ultWall > 1500;  // pose não muda (inferência lenta): o relógio dos estados não pode parar
    const semPessoas = !poses.length;
    if (postos.length && prazo && (nova || semPessoas || preso || ctx.fonteParada) && !(fv.video && fv.pausado && !ctx.fonteParada)) {
      const ts = motor.instante(fv.video ? fv : null, agoraWall);
      if (ts != null) {
        processou = true;
        state.ultWall = agoraWall;
        const pessoas = montarPessoas(poses, ctx, motor, paraUnidade, calibrado ? paraMetros : null, w, h);
        const r = motor.amostra({ ts, cameraOk: !ctx.fonteParada, postos, pessoas });
        state.avaliadas = r.pessoas;
      }
    }
    const avaliadas = state.avaliadas || [];

    // ---- privacidade: o quadro que segue (e que aparece, grava e vira PNG) leva os rostos borrados
    let out;
    let nBorrados = 0;
    if (p.borrarRostos && C.privacidade.borrar !== false) {
      out = clone(src);
      if (poses.length) nBorrados = borrarRegioes(out, regioesDasPoses(poses, w, h, { caixas: C.privacidade.caixas }));
    } else out = clone(src);

    // ---- estado por posto (para o overlay, o retrato e ctx.takt)
    const ts = motor.ultTs;
    const estPostos = postos.map((c) => {
      const st = motor.em.estadoDe(c.id);
      const naZona = avaliadas.filter((a) => a.posto === c.id);
      return {
        id: c.id, nome: c.nome, poly: c.poly, estado: st ? st.estado : null, desde: st ? st.inicio : null,
        candidato: st ? st.candidato : null, pessoas: naZona.length,
        atividade: naZona.length ? Math.max(...naZona.map((a) => a.act)) : null,
        zonaM: c.zonaM,
      };
    });
    ctx.takt = { postos: Object.fromEntries(estPostos.map((e) => [e.nome, { estado: e.estado, desde: e.desde, pessoas: e.pessoas, atividade: e.atividade }])) };
    ctx.piso = calibrado ? {
      calibrado: true, erro: piso.erro, H: piso.H, unidade: 'm',
      paraPiso: paraMetros,
    } : { calibrado: false, erro: piso.erro, unidade: null, paraPiso: () => null };

    if (!postos.length) {
      ctx.metrics['Takt'] = 'marque um posto: área com a função "Takt · posto" (Ferramentas de mouse)';
    } else {
      ctx.metrics['Takt'] = `${postos.length} posto(s) · ${estPostos.filter((e) => e.estado === 'PRODUTIVO').length} produzindo${calibrado ? ' · piso em m' : ''}${usaPiso ? ' (presença no piso)' : ''}${parada ? ' · fonte parada' : ''}`;
      for (const e of estPostos) ctx.metrics[e.nome] = e.estado ? `${ROTULO[e.estado]} ${mmss((ts - e.desde) / 1000)}` : '—';
    }
    if (p.borrarRostos) ctx.metrics['rostos borrados'] = nBorrados;
    ctx.metrics['pose'] = fontePose;

    // ---- overlay no vídeo do app (com a tela cheia aberta, ela desenha o seu)
    const aberta = studioAberto();
    if (p.desenhar && !aberta) desenhar(ctx, estPostos, avaliadas, poses, fontePose === 'própria' && p.esqueleto, ts, w, h);

    if (processou || !state.pubT || performance.now() - state.pubT > 500) {
      state.pubT = performance.now();
      const img = aberta ? new ImageData(new Uint8ClampedArray(out.data), out.width, out.height) : null;
      publicar({
        t: ts, w, h, postos: estPostos, unidade: calibrado ? 'm' : 'img', presenca: usaPiso ? 'piso' : 'imagem', fonteParada: Boolean(ctx.fonteParada), parada,
        foraDeTurno: motor.foraDeTurno, fontePose, borrado: Boolean(p.borrarRostos && C.privacidade.borrar !== false),
        pessoas: avaliadas.map((a) => ({ id: a.id, pe: a.pe, pos: a.posM || a.pos, act: a.act, qual: a.qual, conf: a.conf, posto: a.posto, caixa: a.caixaN, kp: a.kpN })),
        espelhado: Boolean(ctx.mirrored),
      }, img);
    }
    return out;
  },
};

/** Poses → pessoas para o motor: ID (rastreio da cadeia ou próprio), keypoints em px, pé no piso. */
function montarPessoas(poses, ctx, motor, paraUnidade, paraMetros, w, h) {
  const caixas = poses.map((q) => q.box);
  let ids = null;
  const dets = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => d && d.id != null) : [];
  if (dets.length && poses.length) {
    const ext = caixas.map((c) => {
      let mel = null, s = 0.5;
      for (const d of dets) { const v = iou(c, d); if (v > s) { s = v; mel = d; } }
      return mel ? 'R' + mel.id : null;
    });
    if (ext.every(Boolean)) ids = ext;
  }
  if (!ids) ids = motor.rastreador.atualizar(caixas, performance.now()).map((n) => 'P' + n);
  return poses.map((q, i) => {
    const kp = q.keypoints;
    const k = kp.map((t) => [t.x * w, t.y * h]);
    const s = kp.map((t) => t.score);
    // âncora no piso: base da caixa; tornozelos quando visíveis (main.py)
    let pe = [(q.box.x1 + q.box.x2) / 2, q.box.y2];
    if (Math.min(s[15], s[16]) > 0.4) pe = [(kp[15].x + kp[16].x) / 2, (kp[15].y + kp[16].y) / 2];
    return {
      id: ids[i], k, s, pe, pos: paraUnidade(pe[0], pe[1]), posM: paraMetros ? paraMetros(pe[0], pe[1]) : null, conf: q.score,
      caixaN: [q.box.x1, q.box.y1, q.box.x2, q.box.y2], kpN: kp.map((t) => [t.x, t.y, t.score]),
    };
  });
}

function desenhar(ctx, postos, pessoas, poses, esqueleto, ts, w, h) {
  const ov = ctx.overlay;
  for (const c of postos) {
    const cor = c.estado ? COR_ESTADO[c.estado] : '#94a3b8';
    const pts = c.poly.map(([x, y]) => [x * w, y * h]);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      ov.push({ type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], color: cor, width: 2.6 });
    }
    let x0 = Infinity, y0 = Infinity;
    for (const q of pts) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); }
    const rot = c.estado ? `${c.nome} · ${ROTULO[c.estado]} ${mmss((ts - c.desde) / 1000)}` : `${c.nome} · aguardando`;
    ov.push({ type: 'rect', x: x0, y: y0, w: 0, h: 0, color: cor, label: rot });
  }
  if (esqueleto) {
    for (const q of poses) {
      for (const [a, b] of KP_LIGACOES) {
        const p1 = q.keypoints[a], p2 = q.keypoints[b];
        if (p1.score < 0.3 || p2.score < 0.3) continue;
        ov.push({ type: 'line', x1: p1.x * w, y1: p1.y * h, x2: p2.x * w, y2: p2.y * h, color: 'rgba(34,211,238,.75)', width: 1.6 });
      }
    }
  }
  for (const a of pessoas) {
    const cor = a.posto ? (a.act >= 0.55 ? COR_ESTADO.PRODUTIVO : COR_ESTADO.OCIOSO_NO_POSTO) : '#94a3b8';
    ov.push({ type: 'point', x: a.pe[0] * w, y: a.pe[1] * h, r: 5, color: cor });
    const [x1, y1, x2, y2] = a.caixaN;
    ov.push({ type: 'rect', x: x1 * w, y: y1 * h, w: (x2 - x1) * w, h: (y2 - y1) * h, color: cor,
              label: `${a.id} · ${Math.round(a.act * 100)}%` });
  }
}

// marcos do piso (calibração em metros), arrastáveis no vídeo (cv/regioes.js); fonte 0–1
registrarRegiao('takt.posto', {
  chave: 'piso', nome: 'Takt · marcos do piso', tipo: 'poligono', cor: '#a78bfa', espaco: 'fonte', ferramentas: ['poligono'],
  ler() {
    const pts = obterMotor().cfg.piso.pts;
    return pts.length >= 3 ? pts.map((q) => [q.u, q.v]) : null;
  },
  gravar(p, pts) {
    const m = obterMotor(), ant = m.cfg.piso.pts;
    const novos = pts.map(([u, v], i) => ({ u: Math.round(u * 1e4) / 1e4, v: Math.round(v * 1e4) / 1e4, x: ant[i] ? ant[i].x : null, y: ant[i] ? ant[i].y : null }));
    m.definir({ piso: { ...m.cfg.piso, pts: novos } });
    avisarTakt();
    return null;
  },
});
if (typeof window !== 'undefined') assinarTakt(() => regioesMudaram());

export default [taktPosto];
