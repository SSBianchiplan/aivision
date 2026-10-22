/**
 * cv/operators/cena.js — CV-37 Ferramentas de cena: ZONAS E LINHAS.
 *
 * Lê as marcações desenhadas com as Ferramentas de mouse (ctx.marcacoes, ver
 * cv/marcacoes.js) e o que os nós ANTERIORES da cadeia publicaram — caixas do
 * detector (ctx.detections, com `id` quando há rastreio), poses (ctx.poses),
 * mãos (ctx.hands), rostos (ctx.faceMesh) ou, em último caso, as caixas
 * desenhadas no overlay — e mede:
 *
 *   zona (área com função "Zona de contagem")
 *     ocupação atual e máxima, entradas e saídas, tempo de permanência por ID
 *     (com rastreio) — sem ID, as entradas saem da subida da ocupação.
 *   linha (função "Cruzamento")
 *     quem cruza em cada sentido: "ida" é o sentido da seta desenhada no meio
 *     da linha. Precisa de ID estável (Tracking com IDs, Re-ID…): sem ele
 *     não há como saber que a caixa deste quadro é a mesma do anterior.
 *
 * O ponto de referência de cada objeto é a BASE da caixa (os pés — é o que
 * pisa na zona numa câmera de cima/ângulo) ou o centro.
 *
 * Os resultados vão para `resultados` (o desenho das marcações mostra na
 * própria forma; a lista do widget resume), para ctx.metrics (Telemetria) e
 * para ctx.cena (operadores seguintes). Cada entrada/saída/cruzamento vira um
 * evento exportável em CSV. Nada é inferido aqui: custo desprezível.
 */
import { clone } from '../core.js';
import { AREAS, dentro, lado, cruza, resultados, registrarEvento, contagem } from '../marcacoes.js';

const G = 'CV-37';

export const MODULES_CENA = [
  {
    id: G,
    name: 'Ferramentas de cena',
    status: 'ready',
    runtime: 'client',
    desc: 'Marcações desenhadas com o mouse sobre o vídeo controlando o processamento: ROI ("processar só aqui") ' +
          'e exclusão aplicadas antes da cadeia, zonas que contam ocupação, entradas e permanência, linhas que ' +
          'contam cruzamentos por sentido, régua calibrada em mm e ângulo. Usa as caixas do detector, poses, mãos ' +
          'ou rostos da cadeia; com rastreio, conta por ID. Exportação CSV dos eventos.',
  },
];

/** Objetos da cadeia como pontos de referência normalizados { x, y, id, name, score }. */
function coletar(ctx, p) {
  const out = [];
  const add = (b, name, id, score) => {
    if (!b || !Number.isFinite(b.x1)) return;
    if (score != null && score < p.confMin) return;
    const x = (b.x1 + b.x2) / 2;
    const y = p.ponto === 'centro' ? (b.y1 + b.y2) / 2 : b.y2;
    out.push({ x, y, id: id == null ? null : id, name: String(name || 'objeto').toLowerCase(), score });
  };
  const f = p.fonte;
  const auto = f === 'automático';
  if ((auto || f === 'detecções') && Array.isArray(ctx.detections) && ctx.detections.length) {
    for (const d of ctx.detections) add(d, d.name, d.id, d.score);
    if (auto) return out;
  }
  if ((auto || f === 'poses') && Array.isArray(ctx.poses) && ctx.poses.length) {
    for (const q of ctx.poses) add(q.box, 'pessoa', q.id, q.score);
    if (auto) return out;
  }
  if ((auto || f === 'mãos') && Array.isArray(ctx.hands) && ctx.hands.length) {
    for (const h of ctx.hands) add(h.box, 'mão ' + (h.lado || ''), null, h.score);
    if (auto) return out;
  }
  if ((auto || f === 'rostos') && Array.isArray(ctx.faceMesh) && ctx.faceMesh.length) {
    for (const r of ctx.faceMesh) add(r.box, 'rosto', r.id, null);
    if (auto) return out;
  }
  if (auto || f === 'caixas desenhadas') {
    // o que os operadores desenharam (face_detect, BlazePose…): rótulo "#12 pessoa" vira id 12
    const { w, h } = ctx;
    for (const s of ctx.overlay) {
      if (s.type !== 'rect' || !(s.w > 0) || !(s.h > 0)) continue;
      const m = /^#(\d+)\s*(.*)$/.exec(s.label || '');
      add({ x1: s.x / w, y1: s.y / h, x2: (s.x + s.w) / w, y2: (s.y + s.h) / h }, m ? m[2] : s.label, m ? +m[1] : null, null);
    }
  }
  return out;
}

const hora = () => new Date().toISOString();

export const zonasLinhas = {
  op: 'cena.zonas',
  label: 'Zonas e linhas (contagem)',
  group: G, overlayOnly: true,
  desc: 'Conta por ZONA (ocupação, máxima, entradas, permanência) e por LINHA (cruzamentos nos dois sentidos) ' +
        'desenhadas com as Ferramentas de mouse. Coloque depois do detector (e do Tracking com IDs, para ' +
        'contar por ID e cruzamentos).',
  params: {
    fonte: { type: 'enum', options: ['automático', 'detecções', 'poses', 'mãos', 'rostos', 'caixas desenhadas'], default: 'automático', label: 'Objetos de' },
    ponto: { type: 'enum', options: ['base (pés)', 'centro'], default: 'base (pés)', label: 'Ponto de referência' },
    classes: { type: 'text', default: '', max: 200, label: 'Só estas classes (vírgula; vazio = todas)' },
    confMin: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0, label: 'Confiança mínima' },
    sair: { type: 'int', min: 1, max: 90, step: 1, default: 8, label: 'Quadros fora até contar saída' },
    mostrarPontos: { type: 'bool', default: true, label: 'Mostrar pontos de referência' },
    // CV-38 (contagem em esteira): cada ID conta uma vez por linha, como no CounterVision
    umaVez: { type: 'bool', default: false, label: 'Linha: cada ID conta uma vez' },
  },
  apply(src, p, state, ctx) {
    const mq = ctx.marcacoes;
    if (state.geracao !== contagem.geracao || !state.z) {
      state.geracao = contagem.geracao;
      state.z = new Map();
      state.l = new Map();
    }
    const zonas = [], linhas = [];
    if (mq) {
      for (const it of mq.itens) {
        if (it.funcao === 'zona' && AREAS.has(it.tipo)) zonas.push(it);
        else if (it.funcao === 'cruzamento' && it.tipo === 'linha' && it.pts.length >= 2) linhas.push(it);
      }
    }
    if (!zonas.length && !linhas.length) {
      ctx.metrics['zonas'] = 'desenhe uma zona ou linha (Ferramentas de mouse)';
      return clone(src);
    }

    const filtro = String(p.classes || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    let objs = coletar(ctx, p);
    if (filtro.length) objs = objs.filter((o) => filtro.some((c) => o.name.includes(c)));
    const passa = (it, o) => !it.classes || it.classes.some((c) => o.name.includes(c));
    const parado = ctx.fonteParada;
    const agora = performance.now();
    const f = ctx.frameIndex;
    const { w, h } = ctx;
    const dentroDeAlguma = p.mostrarPontos ? new Uint8Array(objs.length) : null;
    // eventos DESTE quadro, para quem vem depois (CV-38 contagem.esteira)
    const evs = [];
    const cena = { zonas: {}, linhas: {}, eventos: evs };

    // ---------------------------------------------------------- zonas
    for (const zona of zonas) {
      let z = state.z.get(zona.id);
      if (!z) state.z.set(zona.id, (z = { dentro: new Map(), max: 0, entradas: 0, saidas: 0, semIdAnt: 0, perm: [] }));
      let ocup = 0, semId = 0;
      const vistos = new Set();
      objs.forEach((o, k) => {
        if (!passa(zona, o) || !dentro(zona, o.x, o.y)) return;
        ocup++;
        if (dentroDeAlguma) dentroDeAlguma[k] = 1;
        if (o.id == null) { semId++; return; }
        vistos.add(o.id);
        const d = z.dentro.get(o.id);
        if (d) { d.fora = 0; return; }
        z.dentro.set(o.id, { t0: agora, fora: 0, name: o.name });
        if (!parado) {
          z.entradas++; registrarEvento({ t: hora(), marcacao: zona.nome, evento: 'entrou', classe: o.name, id: o.id });
          evs.push({ tipo: 'zona', marcacao: zona.id, nome: zona.nome, sentido: 'entrada', id: o.id, classe: o.name, score: o.score });
        }
      });
      for (const [id, d] of z.dentro) {
        if (vistos.has(id) || ++d.fora < p.sair) continue;
        z.dentro.delete(id);
        if (parado) continue;
        const s = (agora - d.t0) / 1000;
        z.saidas++;
        z.perm.push(s);
        if (z.perm.length > 500) z.perm.shift();
        registrarEvento({ t: hora(), marcacao: zona.nome, evento: `saiu (${s.toFixed(1)} s)`, classe: d.name, id });
      }
      // sem ID: a entrada é a subida da ocupação (não dá para saber QUEM entrou)
      if (!parado && semId > z.semIdAnt) {
        z.entradas += semId - z.semIdAnt;
        for (let k = z.semIdAnt; k < semId; k++) evs.push({ tipo: 'zona', marcacao: zona.id, nome: zona.nome, sentido: 'entrada', id: null, classe: '', score: null });
        registrarEvento({ t: hora(), marcacao: zona.nome, evento: `entrou (+${semId - z.semIdAnt}, sem ID)`, classe: '', id: '' });
      }
      z.semIdAnt = semId;
      if (ocup > z.max) z.max = ocup;
      const permanencia = [];
      for (const [id, d] of z.dentro) permanencia.push({ id, s: (agora - d.t0) / 1000 });
      const mediaS = z.perm.length ? z.perm.reduce((a, b) => a + b, 0) / z.perm.length : null;
      const r = { tipo: 'zona', ocupacao: ocup, max: z.max, entradas: z.entradas, saidas: z.saidas, permanencia, mediaS, t: agora };
      resultados.set(zona.id, r);
      cena.zonas[zona.id] = r;
      ctx.metrics[zona.nome] = `${ocup} agora · máx ${z.max} · ${z.entradas} entr.`;
    }

    // ---------------------------------------------------------- linhas
    const algumId = objs.some((o) => o.id != null);
    const sg = mq.espelhado ? -1 : 1;
    for (const linha of linhas) {
      let L = state.l.get(linha.id);
      if (!L) state.l.set(linha.id, (L = { ida: 0, volta: 0, porClasse: {}, ult: new Map(), contados: new Set() }));
      const a = linha.pts[0], b = linha.pts[1];
      for (const o of objs) {
        if (o.id == null || !passa(linha, o)) continue;
        const ant = L.ult.get(o.id);
        const cur = [o.x, o.y];
        if (ant && !parado && !(p.umaVez && L.contados.has(o.id)) && cruza(ant.p, cur, a, b)) {
          const s0 = lado(a, b, ant.p[0], ant.p[1], w, h) * sg;
          const sentido = s0 < 0 ? 'ida' : 'volta';
          L[sentido]++;
          const pc = L.porClasse[o.name] || (L.porClasse[o.name] = { ida: 0, volta: 0 });
          pc[sentido]++;
          registrarEvento({ t: hora(), marcacao: linha.nome, evento: `cruzou (${sentido})`, classe: o.name, id: o.id });
          evs.push({ tipo: 'linha', marcacao: linha.id, nome: linha.nome, sentido, id: o.id, classe: o.name, score: o.score });
          if (p.umaVez) { L.contados.add(o.id); if (L.contados.size > 50000) L.contados.clear(); }
        }
        if (ant) { ant.p = cur; ant.f = f; } else L.ult.set(o.id, { p: cur, f });
      }
      for (const [id, u] of L.ult) if (f - u.f > 90) L.ult.delete(id);
      const semId = objs.length > 0 && !algumId;
      const r = { tipo: 'cruzamento', ida: L.ida, volta: L.volta, porClasse: L.porClasse, semId, t: agora };
      resultados.set(linha.id, r);
      cena.linhas[linha.id] = r;
      ctx.metrics[linha.nome] = semId ? 'sem IDs — adicione Tracking com IDs' : `${L.ida} ida · ${L.volta} volta`;
    }

    if (dentroDeAlguma) {
      objs.forEach((o, k) => ctx.overlay.push({ type: 'point', x: o.x * w, y: o.y * h, r: 4, color: dentroDeAlguma[k] ? '#4ade80' : '#94a3b8' }));
    }
    ctx.cena = cena;
    return clone(src);
  },
};

export default [zonasLinhas];
