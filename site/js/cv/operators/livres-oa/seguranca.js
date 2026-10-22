/**
 * cv/operators/livres-oa/seguranca.js — CV-43 Segurança por pose: INDICADORES
 * DE GESTÃO. Nada aqui é função de segurança (NR-12, ISO 13849, IEC 62061):
 * não para máquina, não substitui proteção física, cortina de luz nem
 * sensor de presença homologado. Serve para medir, alertar e investigar.
 *
 *   seguranca.cerca_keypoint  zona proibida para MÃOS (punho prolongado até a
 *                             mão), PÉS (tornozelos) ou CABEÇA, desenhada como
 *                             área "Segurança · zona proibida"; entra depois de
 *                             N s dentro, sai depois de M s fora (histerese).
 *   seguranca.queda           pessoa caída: queda rápida do quadril (em
 *                             comprimentos de tronco por segundo) seguida de
 *                             postura deitada; pessoa no chão por N s; e
 *                             imobilidade (pontos parados por N s).
 *   seguranca.ponto_encontro  contagem no ponto de encontro (evacuação): quem
 *                             está nas zonas contra a meta de pessoas.
 *
 * Pose: RTMO (CV-18) ou YOLO26-pose antes na cadeia; com Tracking com IDs
 * depois da pose os IDs vêm dele, senão há um rastreio próprio simples.
 * Alarmes ISA-18.2 (runtime/livres-oa/alarmes.js) e eventos no CSV das
 * Ferramentas de cena. Painel: Medições › Segurança.
 */
import { clone } from '../../core.js';
import { dentro, registrarEvento } from '../../marcacoes.js';
import { pessoasComId, medio } from '../../runtime/livres-oa/nucleo.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { Alarmes, COR_PRIO } from '../../runtime/livres-oa/alarmes.js';

export const G_SEG = 'CV-43';
export const AVISO_NR12 = 'Indicador de gestão — NÃO é função de segurança (NR-12): não substitui proteção, intertravamento nem cortina de luz.';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
const ISO = () => new Date().toISOString();

/** Um motor de alarmes para os operadores de segurança (lista única no painel). */
const alarmesSeg = new Alarmes();
export function alarmesSeguranca() { return alarmesSeg; }

// ------------------------------------------------------------------ partes do corpo

const PARTES = {
  'mãos': ['mão esq.', 'mão dir.'],
  'pés': ['pé esq.', 'pé dir.'],
  'cabeça': ['cabeça'],
};
PARTES['mãos e pés'] = [...PARTES['mãos'], ...PARTES['pés']];
PARTES['mãos, pés e cabeça'] = [...PARTES['mãos e pés'], ...PARTES['cabeça']];

/**
 * Pontos das partes: a MÃO é o punho prolongado 35 % do antebraço (o RTMO
 * não tem ponto da mão; a ponta dos dedos fica além do punho); o PÉ é o
 * tornozelo; a CABEÇA é o nariz, ou a média dos olhos/orelhas visíveis.
 */
export function pontosDasPartes(kp, conf, prolongar = 0.35) {
  const out = {};
  const v = (i) => kp[i] && kp[i].score >= conf;
  for (const [nome, punho, cotovelo] of [['mão esq.', 9, 7], ['mão dir.', 10, 8]]) {
    if (!v(punho)) continue;
    const P = kp[punho];
    out[nome] = v(cotovelo) ? { x: P.x + (P.x - kp[cotovelo].x) * prolongar, y: P.y + (P.y - kp[cotovelo].y) * prolongar } : { x: P.x, y: P.y };
  }
  if (v(15)) out['pé esq.'] = { x: kp[15].x, y: kp[15].y };
  if (v(16)) out['pé dir.'] = { x: kp[16].x, y: kp[16].y };
  const cab = [0, 1, 2, 3, 4].filter(v);
  if (cab.length) out['cabeça'] = v(0) ? { x: kp[0].x, y: kp[0].y } : { x: cab.reduce((s, i) => s + kp[i].x, 0) / cab.length, y: cab.reduce((s, i) => s + kp[i].y, 0) / cab.length };
  return out;
}

export const cercaKeypoint = {
  op: 'seguranca.cerca_keypoint',
  label: 'Cerca virtual por parte do corpo (indicador de gestão)',
  group: G_SEG, overlayOnly: true,
  desc: 'Alerta quando MÃOS, PÉS ou CABEÇA entram numa área "Segurança · zona proibida", com tempo mínimo dentro e ' +
        'histerese para sair. Usa a pose (RTMO) da cadeia. ' + AVISO_NR12,
  params: {
    partes: { type: 'enum', options: Object.keys(PARTES), default: 'mãos', label: 'Partes vigiadas' },
    kpConf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mínimo do ponto' },
    tempoMin: { type: 'float', min: 0, max: 30, step: 0.1, default: 0.5, label: 'Tempo mínimo dentro (s)' },
    tempoSair: { type: 'float', min: 0, max: 30, step: 0.1, default: 1, label: 'Tempo fora para encerrar (s, histerese)' },
    prolongar: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.35, label: 'Mão além do punho (× antebraço)' },
    prio: { type: 'int', min: 1, max: 3, step: 1, default: 1, label: 'Prioridade do alarme (1 = alta)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar pontos vigiados' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('cerca', state) || !state.ativos) { state.n = 0; state.ativos = new Map(); }
    const mq = ctx.marcacoes;
    const zonas = mq ? mq.itens.filter((i) => i.funcao === 'cerca' && AREAS.has(i.tipo)) : [];
    const { w, h } = ctx;
    ctx.overlay.push({ type: 'banner', x: 8, y: h - 30, color: '#F2A900', text: 'Cerca por pose: indicador de gestão — NÃO é função de segurança (NR-12)' });
    if (!zonas.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Cerca: desenhe uma área com a função "Segurança · zona proibida"' });
      publicar('cerca', { zonas: 0, alarmes: alarmesSeg.resumo(), aviso: AVISO_NR12 });
      return clone(src);
    }
    if (!Array.isArray(ctx.poses)) ctx.metrics['cerca'] = 'coloque a pose (RTMO) antes na cadeia';
    const { t } = tempoDe(ctx);
    const pessoas = pessoasComId(ctx, state);
    const vigiadas = PARTES[p.partes] || PARTES['mãos'];
    const dentroAgora = new Set();
    for (const pe of pessoas) {
      const pts = pontosDasPartes(pe.kp, p.kpConf, p.prolongar);
      for (const parte of vigiadas) {
        const q = pts[parte];
        if (!q) continue;
        let alguma = false;
        for (const z of zonas) {
          if (!dentro(z, q.x, q.y)) continue;
          alguma = true;
          dentroAgora.add(`${z.nome}|${pe.id}|${parte}`);
        }
        if (p.desenhar) ctx.overlay.push({ type: 'point', x: q.x * w, y: q.y * h, r: 6, color: alguma ? '#FF4D4D' : '#4ade80' });
      }
    }
    // uma tag por zona × pessoa × parte; as que estavam e sumiram seguem o passo com bruto=false
    const tags = new Set([...dentroAgora, ...state.ativos.keys()]);
    let invasoes = 0;
    for (const k of tags) {
      const [zona, id, parte] = k.split('|');
      const bruto = dentroAgora.has(k);
      const antes = alarmesSeg.tags.get('CERCA ' + k);
      const estAntes = antes ? antes.estado : 'NORMAL';
      const est = alarmesSeg.passo('CERCA ' + k, { prio: p.prio, texto: `${parte} na zona proibida «${zona}» (pessoa ${id})`, atrasoOn: p.tempoMin, atrasoOff: p.tempoSair },
        bruto, !bruto, bruto ? 1 : 0, t);
      if (estAntes !== est && est === 'ATIVO_NR') { state.n++; registrarEvento({ t: ISO(), marcacao: zona, evento: `invasão: ${parte}`, classe: 'pessoa', id }); }
      if (/ATIVO/.test(est)) invasoes++;
      if (bruto || /ATIVO/.test(est)) state.ativos.set(k, t); else state.ativos.delete(k);
    }
    alarmesSeg.limpar(t, 120);
    if (p.desenhar) {
      for (const z of zonas) {
        const c = z.caixa;
        const viol = [...dentroAgora].some((k) => k.startsWith(z.nome + '|'));
        ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: viol ? '#FF4D4D' : '#F2A900',
                           label: viol ? `${z.nome}: INVASÃO` : z.nome });
      }
    }
    ctx.metrics['cerca invasões'] = state.n;
    ctx.metrics['cerca ativas'] = invasoes;
    publicar('cerca', { zonas: zonas.length, invasoes: state.n, ativas: invasoes, alarmes: alarmesSeg.resumo(), aviso: AVISO_NR12 });
    return clone(src);
  },
};

// ------------------------------------------------------------------ queda e imobilidade

/** Postura de um quadro: { ok, quadril, tronco (comprimento), anguloTronco (° da vertical), razao (w/h dos pontos) }. */
export function postura(kp, conf) {
  const ombro = medio(kp, 5, 6, conf), quadril = medio(kp, 11, 12, conf);
  const vis = kp.filter((q) => q && q.score >= conf);
  if (!ombro || !quadril || vis.length < 5) return { ok: false };
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const q of vis) { x1 = Math.min(x1, q.x); x2 = Math.max(x2, q.x); y1 = Math.min(y1, q.y); y2 = Math.max(y2, q.y); }
  const dx = ombro.x - quadril.x, dy = ombro.y - quadril.y;
  return { ok: true, quadril, ombro, tronco: Math.hypot(dx, dy), anguloTronco: (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI,
           razao: (x2 - x1) / Math.max(1e-6, y2 - y1), vis };
}

/**
 * Máquina de estados de UMA pessoa (exportada para teste).
 * e: estado persistente; a: amostra { t, kp } (kp em px ou normalizado — a
 * escala vem do tronco); p: parâmetros. Devolve os eventos novos.
 */
export function passoQueda(e, a, p) {
  const ev = [];
  const s = postura(a.kp, p.kpConf);
  if (!s.ok) return ev;
  e.hist = e.hist || [];
  e.hist.push({ t: a.t, y: s.quadril.y, tronco: s.tronco, pts: a.kp.map((q) => (q && q.score >= p.kpConf ? [q.x, q.y] : null)) });
  while (e.hist.length && a.t - e.hist[0].t > Math.max(p.imovelS, 3) + 1) e.hist.shift();
  // escala: maior tronco visto em 3 s (deitado de frente para a câmera o tronco encurta na imagem)
  const L = Math.max(...e.hist.filter((x) => a.t - x.t <= 3).map((x) => x.tronco), 1e-6);
  const deitadoAgora = s.anguloTronco > p.anguloDeitado || s.razao > p.razaoDeitado;
  const empeAgora = s.anguloTronco < p.anguloDeitado - 20 && s.razao < 0.9;
  // velocidade vertical do quadril (para baixo > 0), em troncos por segundo, numa janela de ~0,3 s
  const ant = e.hist.find((x) => a.t - x.t <= 0.35) || e.hist[0];
  const vy = ant && a.t > ant.t ? (s.quadril.y - ant.y) / L / (a.t - ant.t) : 0;
  if (vy > p.vQueda) e.tRapida = a.t;
  e.vy = vy;
  if (deitadoAgora) { e.desdeDeitado = e.desdeDeitado ?? a.t; e.desdeEmPe = null; } else e.desdeDeitado = null;
  if (empeAgora) e.desdeEmPe = e.desdeEmPe ?? a.t; else e.desdeEmPe = null;
  const estadoAnt = e.estado || 'em pé';
  if (estadoAnt === 'em pé' && e.desdeDeitado != null && a.t - e.desdeDeitado >= 0.3) {
    const queda = e.tRapida != null && a.t - e.tRapida <= p.janelaQueda;
    e.estado = queda ? 'caído (queda)' : 'deitado';
    e.tEstado = a.t;
    ev.push({ tipo: queda ? 'queda' : 'deitou', t: a.t });
  } else if (estadoAnt !== 'em pé' && e.desdeEmPe != null && a.t - e.desdeEmPe >= 1) {
    e.estado = 'em pé'; e.tEstado = a.t; ev.push({ tipo: 'levantou', t: a.t });
  }
  // imobilidade: deslocamento médio dos pontos em `imovelS` segundos, em troncos
  const ini = e.hist.find((x) => a.t - x.t <= p.imovelS);
  let mov = Infinity;
  if (ini && a.t - e.hist[0].t >= p.imovelS * 0.95) {
    const atual = e.hist[e.hist.length - 1];
    let m = 0, n = 0;
    for (const x of e.hist) {
      if (x.t < ini.t) continue;
      // maior afastamento de cada ponto (visível nos dois quadros) em relação ao quadro atual
      for (let i = 0; i < x.pts.length; i++) {
        const A = x.pts[i], B = atual.pts[i];
        if (!A || !B) continue;
        m = Math.max(m, Math.hypot(A[0] - B[0], A[1] - B[1])); n++;
      }
    }
    if (n) mov = m / L;
  }
  e.mov = mov;
  const imovel = mov < p.limiarImovel && (p.imovelQualquer || e.estado !== 'em pé');
  if (imovel && !e.imovel) { e.imovel = true; ev.push({ tipo: 'imóvel', t: a.t }); }
  else if (!imovel && e.imovel && mov > p.limiarImovel * 2) { e.imovel = false; ev.push({ tipo: 'voltou a se mexer', t: a.t }); }
  return ev;
}

export const queda = {
  op: 'seguranca.queda',
  label: 'Pessoa caída e imobilidade (indicador de gestão)',
  group: G_SEG, overlayOnly: true,
  desc: 'Detecta QUEDA (quadril descendo rápido + postura deitada), PESSOA NO CHÃO por N s e IMOBILIDADE (pontos ' +
        'parados por N s) pela pose (RTMO). Alarmes ISA-18.2 e eventos no CSV. ' + AVISO_NR12,
  params: {
    vQueda: { type: 'float', min: 0.5, max: 6, step: 0.1, default: 1.8, label: 'Queda: quadril desce mais que (troncos/s)' },
    janelaQueda: { type: 'float', min: 0.3, max: 4, step: 0.1, default: 1.5, label: 'Queda: deitar até (s) depois da descida' },
    anguloDeitado: { type: 'int', min: 30, max: 85, step: 1, default: 60, label: 'Deitado: tronco a mais de (° da vertical)' },
    razaoDeitado: { type: 'float', min: 0.8, max: 3, step: 0.05, default: 1.3, label: 'Deitado: largura/altura do corpo acima de' },
    noChaoS: { type: 'float', min: 1, max: 600, step: 1, default: 10, label: 'Alarme de pessoa no chão após (s)' },
    imovelS: { type: 'float', min: 2, max: 600, step: 1, default: 15, label: 'Imobilidade: parado por (s)' },
    limiarImovel: { type: 'float', min: 0.01, max: 0.5, step: 0.01, default: 0.08, label: 'Imobilidade: movimento máx. (troncos)' },
    imovelQualquer: { type: 'bool', default: false, label: 'Imobilidade também em pé/sentado' },
    kpConf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mínimo do ponto' },
    desenhar: { type: 'bool', default: true, label: 'Rótulo de estado em cada pessoa' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('queda', state) || !state.pes) { state.pes = new Map(); state.n = { queda: 0, chao: 0, imovel: 0 }; }
    const { w, h } = ctx;
    ctx.overlay.push({ type: 'banner', x: 8, y: h - 30, color: '#F2A900', text: 'Queda/imobilidade: indicador de gestão — NÃO é função de segurança (NR-12)' });
    if (!Array.isArray(ctx.poses)) ctx.metrics['queda'] = 'coloque a pose (RTMO) antes na cadeia';
    const { t } = tempoDe(ctx);
    const pessoas = pessoasComId(ctx, state);
    const vistos = new Set();
    for (const pe of pessoas) {
      vistos.add(pe.id);
      let e = state.pes.get(pe.id);
      if (!e) state.pes.set(pe.id, (e = { estado: 'em pé' }));
      e.visto = t;
      // em px: o ângulo do tronco e a razão largura/altura não podem sair distorcidos pelo formato do quadro
      const kpPx = pe.kp.map((q) => ({ x: q.x * w, y: q.y * h, score: q.score }));
      for (const ev of passoQueda(e, { t, kp: kpPx }, p)) {
        if (ev.tipo === 'queda') state.n.queda++;
        registrarEvento({ t: ISO(), marcacao: 'pose', evento: ev.tipo, classe: 'pessoa', id: pe.id });
      }
      const caiu = e.estado === 'caído (queda)';
      alarmesSeg.passo(`QUEDA ${pe.id}`, { prio: 1, texto: `Queda detectada (pessoa ${pe.id})`, atrasoOn: 0, atrasoOff: 1 }, caiu, !caiu, 1, t);
      const noChao = e.estado !== 'em pé' && t - (e.tEstado ?? t) >= p.noChaoS;
      alarmesSeg.passo(`CHÃO ${pe.id}`, { prio: 1, texto: `Pessoa no chão há mais de ${p.noChaoS} s (pessoa ${pe.id})`, atrasoOn: 0, atrasoOff: 1 }, noChao, !noChao, 1, t);
      alarmesSeg.passo(`IMÓVEL ${pe.id}`, { prio: e.estado === 'em pé' ? 3 : 1, texto: `Imóvel por ${p.imovelS} s (pessoa ${pe.id}, ${e.estado})`, atrasoOn: 0, atrasoOff: 1 },
        Boolean(e.imovel), !e.imovel, e.mov, t);
      if (p.desenhar) {
        const b = pe.box;
        const cor = e.imovel || e.estado !== 'em pé' ? '#FF4D4D' : '#4ade80';
        ctx.overlay.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: (b.x2 - b.x1) * w, h: (b.y2 - b.y1) * h, color: cor,
                           label: `${pe.id} ${e.estado}${e.imovel ? ' · imóvel' : ''}` });
      }
    }
    // pessoa que sumiu da cena: a observação acaba (alarmes vão normalizando pelo atraso)
    for (const [id, e] of state.pes) {
      if (vistos.has(id)) continue;
      if (t - e.visto > 5) {
        for (const pre of ['QUEDA', 'CHÃO', 'IMÓVEL']) alarmesSeg.passo(`${pre} ${id}`, { prio: 1, atrasoOn: 0, atrasoOff: 0 }, false, true, NaN, t);
        state.pes.delete(id);
      }
    }
    alarmesSeg.limpar(t, 120);
    const lista = [...state.pes.entries()].map(([id, e]) => ({ id, estado: e.estado, imovel: Boolean(e.imovel), mov: e.mov, vy: e.vy }));
    ctx.metrics['pessoas (queda)'] = lista.length;
    ctx.metrics['quedas'] = state.n.queda;
    publicar('queda', { pessoas: lista, quedas: state.n.queda, alarmes: alarmesSeg.resumo(), aviso: AVISO_NR12 });
    return clone(src);
  },
};

// ------------------------------------------------------------------ ponto de encontro

export const pontoEncontro = {
  op: 'seguranca.ponto_encontro',
  label: 'Contagem no ponto de encontro (evacuação)',
  group: G_SEG, overlayOnly: true,
  desc: 'Na evacuação, conta quem está nas ZONAS desenhadas (ponto de encontro) e compara com a meta (efetivo do turno): ' +
        '"faltam N". Coloque depois de detector de pessoas → Tracking com IDs → Zonas e linhas. ' + AVISO_NR12,
  params: {
    meta: { type: 'int', min: 0, max: 100000, step: 1, default: 20, label: 'Meta (pessoas esperadas)' },
    modo: { type: 'enum', options: ['presentes agora', 'chegadas (IDs distintos)'], default: 'presentes agora', label: 'Contar' },
    zonas: { type: 'text', default: '', max: 200, label: 'Só estas zonas (nomes, vírgula; vazio = todas)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('encontro', state) || !state.ids) { state.ids = new Set(); state.tMeta = null; }
    const cena = ctx.cena;
    const { h } = ctx;
    if (!cena) {
      ctx.metrics['ponto de encontro'] = 'coloque Zonas e linhas (cena.zonas) antes';
      return clone(src);
    }
    const filtro = String(p.zonas || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const mq = ctx.marcacoes;
    const nomes = new Map((mq ? mq.itens : []).map((i) => [i.id, i.nome]));
    let presentes = 0;
    for (const [id, z] of Object.entries(cena.zonas || {})) {
      const nome = String(nomes.get(id) || '').toLowerCase();
      if (filtro.length && !filtro.some((f) => nome.includes(f))) continue;
      presentes += z.ocupacao;
    }
    for (const ev of cena.eventos || []) {
      if (ev.tipo !== 'zona' || ev.id == null) continue;
      if (filtro.length && !filtro.some((f) => String(ev.nome).toLowerCase().includes(f))) continue;
      state.ids.add(ev.id);
    }
    const n = p.modo === 'presentes agora' ? presentes : state.ids.size;
    const falta = Math.max(0, p.meta - n);
    const { t } = tempoDe(ctx);
    if (!falta && state.tMeta == null) { state.tMeta = t; registrarEvento({ t: ISO(), marcacao: 'ponto de encontro', evento: `meta atingida (${n})`, classe: 'pessoa', id: '' }); }
    if (falta && state.tMeta != null && p.modo === 'presentes agora') state.tMeta = null;
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: falta ? '#FF4D4D' : '#4ade80',
                       text: falta ? `Ponto de encontro: ${n} de ${p.meta} — FALTAM ${falta}` : `Ponto de encontro: ${n} de ${p.meta} — todos presentes` });
    ctx.overlay.push({ type: 'banner', x: 8, y: h - 30, color: '#F2A900', text: 'Indicador de gestão — confira a lista nominal do brigadista' });
    ctx.metrics['presentes'] = `${n} / ${p.meta}`;
    publicar('encontro', { presentes: n, meta: p.meta, faltam: falta, modo: p.modo, tMeta: state.tMeta });
    return clone(src);
  },
};

export default [cercaKeypoint, queda, pontoEncontro];
export { COR_PRIO };
