/**
 * cv/operators/livres-s/predial.js — CV-61 Segurança predial (INDICATIVO).
 *
 *   seguranca.saida_obstruida  saída/corredor de emergência obstruído (67): na
 *                              área "Segurança · saída de emergência", objeto
 *                              PARADO (diferente da cena vazia e igual ao de
 *                              ~1 s atrás) ocupando ≥ X % da área por N s.
 *                              Gente passando não conta (move-se; e as caixas de
 *                              pessoa do detector, se houver, são excluídas).
 *   seguranca.fogo             indício de chama por cor + cintilação, sem treino
 *                              (68). NÃO substitui detector certificado.
 *
 * Indicadores de gestão: não são sistema de segurança contra incêndio nem
 * substituem a inspeção das rotas de fuga (NR-23, normas do Corpo de Bombeiros).
 */
import { clone } from '../../core.js';
import { publicar, geracao, conferirGeracao } from '../../runtime/livres-oa/canal.js';
import { Alarmes, COR_PRIO } from '../../runtime/livres-oa/alarmes.js';
import { ReferenciaCena, miniCinza, mascaraPessoas } from '../../runtime/livres-s/cena-ref.js';
import { DetectorFogo, AVISO_FOGO } from '../../runtime/livres-s/fogo.js';
import { passoTempo } from '../../runtime/livres-s/comum.js';

export const G_PREDIAL = 'CV-61';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
export const FUNCAO_SAIDA = 'saida_emergencia';
export const AVISO_PREDIAL = 'Indicador de gestão: não substitui a inspeção das rotas de fuga (NR-23 e normas do Corpo de ' +
  'Bombeiros), o sistema de alarme de incêndio nem a brigada.';

const alarmesPredial = new Alarmes();
export function alarmesPrediais() { return alarmesPredial; }

/** Contorno de uma área no overlay. */
function contorno(ctx, it, cor, w, h) {
  if (it.tipo === 'retangulo' || it.tipo === 'mascara' || it.tipo === 'elipse') {
    const c = it.caixa;
    ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: cor });
  } else {
    const P = it.pts;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      ctx.overlay.push({ type: 'line', x1: a[0] * w, y1: a[1] * h, x2: b[0] * w, y2: b[1] * h, color: cor, width: 2 });
    }
  }
}
export { contorno };

/**
 * Pedido de captura da cena vazia: o painel sobe a geração da chave
 * `chave` (canal.zerar não serve: apagaria o dado publicado). true = capturar agora.
 */
export function pedidoCaptura(chave, state) {
  const g = geracao(chave);
  const pedir = state.gCap != null && state.gCap !== g;
  state.gCap = g;
  return pedir;
}

// ======================================================================= saída obstruída

export const saidaObstruida = {
  op: 'seguranca.saida_obstruida',
  label: 'Saída de emergência obstruída',
  group: G_PREDIAL, overlayOnly: true,
  desc: 'Alerta quando um OBJETO PARADO ocupa a área "Segurança · saída de emergência" (porta, corredor, extintor) por ' +
        'mais de N s: compara com a cena vazia (capturada sozinha com a cena parada, ou no painel Medições) e ignora ' +
        'quem só passa. Com detector antes, as caixas de pessoa são excluídas. Indicador de gestão (NR-23).',
  params: {
    tempoS: { type: 'int', min: 1, max: 3600, step: 1, default: 30, label: 'Obstruída após (s parado)' },
    fracMin: { type: 'float', min: 0.01, max: 0.9, step: 0.01, default: 0.08, label: 'Área mínima ocupada (fração)' },
    limiar: { type: 'int', min: 5, max: 80, step: 1, default: 24, label: 'Diferença de brilho (níveis)' },
    auto: { type: 'bool', default: true, label: 'Capturar a cena vazia sozinha (cena parada 3 s)' },
    aprender: { type: 'float', min: 0, max: 0.01, step: 0.0005, default: 0, label: 'Adaptação lenta da referência (0 = fixa)' },
    excluirPessoas: { type: 'bool', default: true, label: 'Ignorar caixas de pessoa do detector' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar as áreas' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('saida', state) || !state.ref) { state.ref = new ReferenciaCena(); }
    const { t } = passoTempo(state, ctx);
    const mq = ctx.marcacoes;
    const zonas = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_SAIDA && AREAS.has(i.tipo)) : [];
    const { w, h } = ctx;
    if (!zonas.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Saída de emergência: desenhe uma área com a função "Segurança · saída de emergência"' });
      publicar('saida', { zonas: [], pronta: false, alarmes: alarmesPredial.resumo() });
      return clone(src);
    }
    const mc = miniCinza(src);
    const ref = state.ref;
    if (pedidoCaptura('saida_ref', state)) ref.capturar(mc, t);
    if (!ctx.fonteParada) ref.quadro(mc, t, { estavelS: 3, auto: p.auto, lagS: 1 });
    const out = [];
    if (!ref.ref) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#38bdf8', text: 'Saída de emergência: aguardando a cena vazia (deixe a área livre e parada, ou capture no painel Medições)' });
    } else {
      const pes = p.excluirPessoas ? mascaraPessoas(ctx.detections, ref.w, ref.h) : null;
      // ganho global medido fora das saídas
      let fora = null;
      fora = new Uint8Array(ref.w * ref.h);
      for (const z of zonas) { const m = ref.mascara(z).m; for (let i = 0; i < m.length; i++) if (m[i]) fora[i] = 1; }
      const ganho = ref.ganho(mc.g, fora);
      for (const z of zonas) {
        const m = ref.medir(z, mc, { limiar: p.limiar, ganho, excluir: pes ? (i) => pes[i] === 1 : null });
        const bruto = m.parado >= p.fracMin;
        const est = alarmesPredial.passo(`${z.nome} obstruída`, { prio: 1, texto: `${z.nome}: objeto parado na saída/corredor de emergência`, atrasoOn: p.tempoS, atrasoOff: 3 },
          bruto, m.parado < p.fracMin * 0.6, m.parado, t);
        const ativo = est === 'ATIVO_NR' || est === 'ATIVO_R';
        const s = alarmesPredial.tags.get(`${z.nome} obstruída`);
        const desde = bruto && s && s.desdeOn != null ? t - s.desdeOn : 0;
        out.push({ id: z.id, nome: z.nome, parado: m.parado, dif: m.dif, ativo, estado: est, desde, pendente: bruto && !ativo });
        if (p.desenhar) {
          const cor = ativo ? COR_PRIO[1] : bruto ? '#F2A900' : '#4ade80';
          contorno(ctx, z, cor, w, h);
          ctx.overlay.push({ type: 'banner', x: z.caixa.x1 * w + 4, y: z.caixa.y1 * h + 4, color: cor,
            text: ativo ? `${z.nome}: OBSTRUÍDA (${Math.round(m.parado * 100)} %)` : bruto ? `${z.nome}: objeto parado há ${Math.round(desde)} s` : `${z.nome}: livre` });
        }
        ctx.metrics[z.nome] = ativo ? 'obstruída' : bruto ? `parado ${Math.round(desde)} s` : 'livre';
      }
      if (p.aprender > 0 && !out.some((z) => z.parado >= p.fracMin)) ref.adaptar(mc, p.aprender);
    }
    alarmesPredial.limpar(t, 3600);
    publicar('saida', { zonas: out, pronta: Boolean(ref.ref), capturadaEm: ref.capturadaEm, alarmes: alarmesPredial.resumo(), tempoS: p.tempoS });
    return clone(src);
  },
};

// ======================================================================= fogo

export const fogo = {
  op: 'seguranca.fogo',
  label: 'Fogo por cor e cintilação (indicativo)',
  group: G_PREDIAL, overlayOnly: true,
  desc: 'Indício de chama SEM treino: pixels vermelho/laranja/amarelo vivos (regra de Chen) que TREMULAM ao longo do ' +
        'tempo; objeto laranja parado ou que só se move não conta. Alerta após N s. INDICATIVO — não substitui ' +
        'detector certificado nem o alarme de incêndio (NBR 17240). Use ROI/exclusão para tirar telas e LEDs.',
  params: {
    Rt: { type: 'int', min: 80, max: 250, step: 5, default: 135, label: 'Vermelho mínimo (Rt)' },
    St: { type: 'int', min: 10, max: 120, step: 5, default: 55, label: 'Saturação (St)' },
    cint: { type: 'float', min: 2, max: 60, step: 1, default: 10, label: 'Cintilação mínima (|ΔR| médio)' },
    fracCint: { type: 'float', min: 0.05, max: 1, step: 0.05, default: 0.3, label: 'Fração da cor que tremula' },
    areaMin: { type: 'float', min: 0.0002, max: 0.2, step: 0.0002, default: 0.002, label: 'Área mínima (fração do quadro)' },
    tempoS: { type: 'float', min: 0, max: 60, step: 0.5, default: 2, label: 'Alertar após (s)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar a região' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('fogo', state) || !state.det) state.det = new DetectorFogo();
    const { t } = passoTempo(state, ctx);
    const { w, h } = ctx;
    let r = state.ult;
    if (!ctx.fonteParada || !r) { r = state.det.quadro(src, { Rt: p.Rt, St: p.St, cint: p.cint }); state.ult = r; }
    const bruto = r.area >= p.areaMin && r.fracCint >= p.fracCint;
    const est = alarmesPredial.passo('Fogo (indicativo)', { prio: 1, texto: 'Indício de chama (cor + cintilação) — confirme no local', atrasoOn: p.tempoS, atrasoOff: 3 },
      bruto, !bruto, r.area, t);
    const ativo = est === 'ATIVO_NR' || est === 'ATIVO_R';
    state.hist = state.hist || [];
    if (!ctx.fonteParada) { state.hist.push([t, r.area]); if (state.hist.length > 900) state.hist.shift(); }
    if (p.desenhar && r.caixa && (bruto || ativo)) {
      const c = r.caixa;
      ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: ativo ? COR_PRIO[1] : '#F2A900',
        label: `${ativo ? 'FOGO?' : 'cor+cintilação'} ${(r.area * 100).toFixed(2)} %` });
    }
    if (ativo) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: COR_PRIO[1], text: '⚠ Indício de chama — confirme no local (indicativo, não substitui detector certificado)' });
    ctx.metrics['fogo'] = ativo ? 'INDÍCIO' : bruto ? 'suspeito' : 'nada';
    ctx.metrics['cor/cintila'] = `${(r.cor * 100).toFixed(2)} % / ${(r.fracCint * 100).toFixed(0)} %`;
    publicar('fogo', { area: r.area, cor: r.cor, fracCint: r.fracCint, bruto, ativo, hist: state.hist.slice(-300), alarmes: alarmesPredial.resumo(), aviso: AVISO_FOGO });
    return clone(src);
  },
};

export default [saidaObstruida, fogo];
