/**
 * operators/livres-o/maquina.js — maquina.estado (CV-46 OEE pela câmera).
 *
 * Máquina sem CLP: para cada área marcada com as Ferramentas de mouse e a
 * função "OEE · máquina", o operador mede o MOVIMENTO (fração dos pixels da
 * ROI que mudaram — diferença de quadros ou fundo adaptativo, numa grade de
 * até 96 px, a ~5 amostras/s pelo tempo da fonte) e o motor
 * (runtime/livres-o/oee.js) decide RODANDO / PARADA / SETUP com histerese e
 * tempos mínimos que retroagem. Uma área "OEE · setup" (bancada de ferramental,
 * lugar do ajuste) com movimento e a máquina quieta = SETUP.
 *
 * INTEGRAÇÃO (quando os nós estão no Pipeline, em qualquer ordem):
 *   CounterVision (contagem.esteira)  peças = incremento do total contado
 *   Inspect (inspect.programa)        OK / NOK / INCERTO de cada peça nova
 *   Takt (takt.posto)                 operador no posto: ATIVO com a máquina
 *                                     quieta = setup (opção); VAGO na parada =
 *                                     sugestão "Falta de operador"
 * Sem nenhum deles, peças e refugo podem ser apontados à mão no Studio OEE.
 *
 * Fonte pausada (YouTube pausado, histórico) = NÃO OBSERVADO, não parada.
 * Publica ctx.oee para os operadores seguintes; a sessão fica no canal.
 */
import { clone } from '../../core.js';
import { AREAS, registrarFuncao } from '../../marcacoes.js';
import { store } from '../../../state/store.js';
import { poligonoDe } from '../livres-m/takt.js';
import { tempoDaFonte, obterMotor as motorTakt } from '../../runtime/livres-m/canal.js';
import { motorEsteira } from '../../runtime/livres-l/esteira.js';
import { historico as historicoInspect } from '../../runtime/livres-n/canal.js';
import { obterMotor, publicar, studioAberto, ROTULO, COR } from '../../runtime/livres-o/canal.js';
import { amostrarRoi, movimento } from '../../runtime/livres-o/oee.js';

const G = 'CV-46';
export const FUNCAO_MAQUINA = 'oee_maquina';
export const FUNCAO_SETUP = 'oee_setup';
// funções das Ferramentas de mouse (aparecem no seletor com este nó no Pipeline; não mascaram a imagem)
registrarFuncao({ valor: FUNCAO_MAQUINA, rotulo: 'OEE · máquina', tipos: ['retangulo', 'poligono', 'elipse'], ops: ['maquina.estado'], cor: '#4FB387', nome: 'Máquina' });
registrarFuncao({ valor: FUNCAO_SETUP, rotulo: 'OEE · setup', tipos: ['retangulo', 'poligono', 'elipse'], ops: ['maquina.estado'], cor: '#7FB2FF', nome: 'Setup' });

const relogio = (s) => {
  if (!Number.isFinite(s) || s < 0) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const pct = (v) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1).replace('.', ',')} %`);
const centro = (poly) => poly.reduce((a, [x, y]) => [a[0] + x / poly.length, a[1] + y / poly.length], [0, 0]);

/** Nós ligados no Pipeline (as integrações só valem com o módulo ativo). */
function ativos() {
  const ns = store.get().nodes || [];
  const tem = (op) => ns.some((n) => n.enabled && n.op === op);
  return { contador: tem('contagem.esteira'), inspect: ns.some((n) => n.enabled && String(n.op).startsWith('inspect.')), takt: tem('takt.posto') };
}

/** Peças novas do CounterVision e do Inspect desde a última chamada (incrementos). */
function producaoNova(state, fontes) {
  const out = { pecas: 0, inspOK: 0, inspNOK: 0, inspINC: 0 };
  if (fontes.contador) {
    const tot = motorEsteira().total;
    if (state.contTotal != null && tot > state.contTotal) out.pecas = tot - state.contTotal;
    state.contTotal = tot;            // zerou no CounterVision (tot < anterior): só rebaseia
  } else state.contTotal = null;
  if (fontes.inspect) {
    const h = historicoInspect();
    const maior = h.reduce((m, r) => Math.max(m, r.id || 0), 0);
    if (state.inspSeq == null) state.inspSeq = maior;          // o histórico antigo não conta
    else {
      let novoSeq = state.inspSeq;
      for (const r of h) {
        if (!(r.id > state.inspSeq) || !r.final) continue;
        if (r.final === 'OK') out.inspOK++; else if (r.final === 'NOK') out.inspNOK++; else out.inspINC++;
        novoSeq = Math.max(novoSeq, r.id);
      }
      state.inspSeq = novoSeq;
    }
  } else state.inspSeq = null;
  return out;
}

/** Operador no posto do Takt mais próximo da máquina: { ativo, presente } ou nulls. */
function operadorTakt(fontes) {
  if (!fontes.takt) return { opAtivo: null, opPresente: null };
  const ab = [...motorTakt().abertos.values()];
  if (!ab.length) return { opAtivo: null, opPresente: null };
  const est = ab.map((i) => i.estado);
  return { opAtivo: est.includes('PRODUTIVO'), opPresente: !est.every((e) => e === 'VAGO') };
}

export const maquinaEstado = {
  op: 'maquina.estado',
  label: 'OEE — estado da máquina',
  group: G,
  overlayOnly: true,
  desc: 'OEE pela câmera para máquina sem CLP: movimento na área marcada "OEE · máquina" decide rodando, parada ' +
        'ou setup (área "OEE · setup", ou operador ativo no Takt) com histerese e tempos mínimos. Soma peças do ' +
        'CounterVision, presença do Takt e OK/NOK do Inspect quando estão no Pipeline. Disponibilidade × ' +
        'desempenho × qualidade, motivos de parada, turnos e relatório no Studio OEE.',
  params: {
    metodo: { type: 'enum', options: ['diferença de quadros', 'fundo adaptativo'], default: 'diferença de quadros', label: 'Movimento por' },
    limiar: { type: 'int', min: 4, max: 120, step: 1, default: 25, label: 'Mudança mín. do pixel (níveis de cinza)' },
    amostrasHz: { type: 'float', min: 1, max: 15, step: 0.5, default: 5, label: 'Amostras por segundo' },
    desenhar: { type: 'bool', default: true, label: 'Estado e movimento no vídeo' },
  },
  apply(src, p, state, ctx) {
    const motor = obterMotor();
    const P = motor.cfg.params;
    const mq = ctx.marcacoes;
    const areas = mq ? mq.itens.filter((it) => AREAS.has(it.tipo)) : [];
    const maqs = areas.filter((it) => it.funcao === FUNCAO_MAQUINA);
    const setups = areas.filter((it) => it.funcao === FUNCAO_SETUP);
    if (!state.rois) state.rois = new Map();

    // relógio: tempo do vídeo no arquivo, relógio ao vivo; amostra a ~amostrasHz pelo tempo da FONTE
    const fv = tempoDaFonte();
    const tFonte = fv.video ? fv.t * 1000 : performance.now();
    const intervalo = 1000 / Math.max(0.5, p.amostrasHz);
    const parada = Boolean(ctx.fonteParada);
    const pausadoArquivo = fv.video && fv.pausado && !parada;
    const voltou = state.tFonte != null && tFonte < state.tFonte;      // loop do vídeo / troca de fonte
    const hora = state.tFonte == null || voltou || tFonte - state.tFonte >= intervalo * 0.95;
    let r = state.ultimo || null;

    if (maqs.length && !pausadoArquivo && (hora || parada)) {
      state.tFonte = tFonte;
      const fontes = ativos();
      motor.fontes = fontes;
      const medir = (it) => {
        let st = state.rois.get(it.id);
        if (!st) state.rois.set(it.id, (st = { cache: {} }));
        if (voltou) st.ref = null;
        const a = amostrarRoi(src, poligonoDe(it), 96, st.cache);
        return movimento(a, st, { metodo: p.metodo === 'fundo adaptativo' ? 'fundo' : 'diferenca', limiar: p.limiar });
      };
      const movSetup = new Map(setups.map((it) => [it.id, parada ? 0 : medir(it)]));
      // cada área de setup pertence à máquina mais próxima
      const setupDe = new Map();
      for (const s of setups) {
        const cs = centro(poligonoDe(s));
        let melhor = null, dmin = Infinity;
        for (const m of maqs) { const c = centro(poligonoDe(m)); const d = Math.hypot(c[0] - cs[0], c[1] - cs[1]); if (d < dmin) { dmin = d; melhor = m.id; } }
        if (melhor) setupDe.set(melhor, Math.max(setupDe.get(melhor) || 0, movSetup.get(s.id)));
      }
      const op = operadorTakt(fontes);
      const amostras = maqs.map((it) => ({
        id: it.id, nome: it.nome || 'Máquina', mov: parada ? 0 : medir(it),
        movSetup: setupDe.has(it.id) ? setupDe.get(it.id) : null, opAtivo: op.opAtivo, opPresente: op.opPresente,
      }));
      const ts = motor.instante(fv.video ? fv : null, Date.now());
      if (ts != null) {
        const prod = producaoNova(state, fontes);
        r = motor.amostra({ ts, cameraOk: !parada, maquinas: amostras, prod });
        r = { ...r, w: ctx.w, h: ctx.h, fonteParada: parada, fontes,
          rois: [...maqs.map((it) => ({ id: it.id, nome: it.nome, tipo: 'maquina', poly: poligonoDe(it) })),
                 ...setups.map((it) => ({ id: it.id, nome: it.nome, tipo: 'setup', poly: poligonoDe(it), mov: movSetup.get(it.id) }))] };
        state.ultimo = r;
        publicar(r, studioAberto() ? clone(src) : null);
      }
    }

    // ---- saída para a cadeia e desenho
    const k = maqs.length ? motor.kpis() : null;
    ctx.oee = r ? { maquinas: Object.fromEntries(r.maquinas.map((m) => [m.nome, { estado: m.estado, desde: m.desde, mov: m.mov }])),
      oee: k && k.geral ? k.geral.oee : null } : null;
    if (!maqs.length) {
      ctx.metrics['OEE'] = 'marque a máquina: área com a função «OEE · máquina»';
      if (p.desenhar && !studioAberto()) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'OEE: marque a máquina (área → função «OEE · máquina»)' });
      return clone(src);
    }
    if (r) {
      const G0 = k && k.geral;
      ctx.metrics['OEE'] = G0 ? `${pct(G0.oee)}${G0.parcial ? ' (parcial)' : ''} · D ${pct(G0.disponibilidade)}` : 'medindo…';
      for (const m of r.maquinas) ctx.metrics[`máquina ${m.nome}`] = `${m.estado ? ROTULO[m.estado] : 'aguardando'} · mov ${pct(m.mov)}`;
    }
    if (p.desenhar && !studioAberto() && r) {
      const { w, h } = ctx;
      for (const ro of r.rois) {
        const m = r.maquinas.find((x) => x.id === ro.id);
        const cor = ro.tipo === 'setup' ? '#7FB2FF' : m && m.estado ? COR[m.estado] : '#94a3b8';
        const pts = ro.poly;
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          ctx.overlay.push({ type: 'line', x1: a[0] * w, y1: a[1] * h, x2: b[0] * w, y2: b[1] * h, color: cor, width: ro.tipo === 'setup' ? 1.4 : 3 });
        }
        const x0 = Math.min(...pts.map((q) => q[0])) * w, y0 = Math.min(...pts.map((q) => q[1])) * h;
        const txt = ro.tipo === 'setup' ? `${ro.nome} · setup · mov ${pct(ro.mov)}`
          : m ? `${m.nome} · ${m.estado ? `${ROTULO[m.estado]} ${relogio((r.t - m.desde) / 1000)}` : 'aguardando'} · mov ${pct(m.mov)}` : ro.nome;
        ctx.overlay.push({ type: 'rect', x: x0, y: y0, w: 0, h: 0, color: cor, label: txt });
      }
      const G0 = k && k.geral;
      if (G0) {
        ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: G0.oee != null && G0.oee >= 0.65 ? '#4FB387' : '#F2A900',
          text: `OEE ${pct(G0.oee)}${G0.parcial ? '*' : ''} · D ${pct(G0.disponibilidade)} · P ${pct(G0.desempenho)} · Q ${pct(G0.qualidade)}${G0.pecas != null ? ` · ${G0.pecas} peças` : ''}` });
      }
    }
    return clone(src);
  },
};

export default [maquinaEstado];
