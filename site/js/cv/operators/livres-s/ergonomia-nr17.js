/**
 * cv/operators/livres-s/ergonomia-nr17.js — CV-60 Ergonomia aplicada (NR-17).
 *
 *   aep.posto         AEP automática (S5): junta, POR POSTO (áreas "Takt ·
 *                     posto"), a nota RULA/REBA do ergonomia.avaliar (CV-29),
 *                     o tempo em cada faixa, a pior postura (miniatura com
 *                     rosto borrado), os alertas, os KPIs do Takt (CV-39) e o
 *                     IL do NIOSH (abaixo). Relatório HTML/PDF e CSV no painel
 *                     Medições — RASCUNHO DE APOIO ao ergonomista.
 *   ergonomia.niosh   Levantamento de carga (69): equação revisada do NIOSH com
 *                     H e V medidos pela pose (régua calibrada ou estatura) e
 *                     D pelo par origem → destino de cada levantamento; carga,
 *                     pega, duração, assimetria (e a frequência, se quiser)
 *                     são entradas manuais.
 *
 * Os dois só LEEM o que a cadeia já produz: nenhum modelo novo.
 */
import { clone } from '../../core.js';
import { publicar, ler, conferirGeracao } from '../../runtime/livres-oa/canal.js';
import { instantaneo as retratoErgonomia } from '../../runtime/livres-f/canal.js';
import { obterMotor } from '../../runtime/livres-m/canal.js';
import { pontoNoPoligono } from '../../runtime/livres-m/takt-nucleo.js';
import { poligonoDe, FUNCAO_POSTO } from '../livres-m/takt.js';
import { AcumuladorAEP, AVISO_AEP } from '../../runtime/livres-s/aep.js';
import { equacao, classeIL, medirHV, alturaNarizTornozelo, FRACAO_NARIZ_TORNOZELO, Levantamentos, avaliarMovimento, DURACOES, PEGAS } from '../../runtime/livres-s/niosh.js';
import { passoTempo, miniatura, fmtBR } from '../../runtime/livres-s/comum.js';

export const G_NR17 = 'CV-60';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);

// ======================================================================= AEP

const acumulador = new AcumuladorAEP();
export function acumuladorAEP() { return acumulador; }

export const aepPosto = {
  op: 'aep.posto',
  label: 'AEP por posto (NR-17) — apoio ao ergonomista',
  group: G_NR17, overlayOnly: true,
  desc: 'Consolida por posto (áreas "Takt · posto") a Ergonomia RULA/REBA, o tempo em cada nível de risco, a pior ' +
        'postura (rosto borrado), os alertas, os KPIs do Tempo de posto e o IL do NIOSH, com prioridade sugerida. ' +
        'Relatório para imprimir/PDF no painel Medições. Coloque DEPOIS de Ergonomia (RULA/REBA). Rascunho de APOIO ' +
        'ao ergonomista — não é a AEP/AET.',
  params: {
    metodo: { type: 'enum', options: ['RULA', 'REBA'], default: 'RULA', label: 'Método principal do relatório' },
    alertaS: { type: 'int', min: 1, max: 600, step: 1, default: 10, label: 'Alerta: tempo contínuo em faixa alta (s)' },
    semPosto: { type: 'enum', options: ['posto "Geral"', 'ignorar'], default: 'posto "Geral"', label: 'Pessoa fora dos postos' },
    empresa: { type: 'text', default: '', max: 80, label: 'Empresa/unidade (relatório)' },
    setor: { type: 'text', default: '', max: 80, label: 'Setor (relatório)' },
    atividade: { type: 'text', default: '', max: 120, label: 'Atividade (relatório)' },
    jornada: { type: 'text', default: '', max: 60, label: 'Jornada e pausas (relatório)' },
    avaliador: { type: 'text', default: '', max: 80, label: 'Ergonomista responsável (relatório)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar os postos' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('aep', state)) { acumulador.zerar(); state.ultRetrato = null; state.tMini = 0; state.tTakt = 0; state.takt = null; }
    const { t, dt } = passoTempo(state, ctx, 1);
    const r = retratoErgonomia();
    const vivo = r && performance.now() - r.t < 1500;
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const postos = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_POSTO && AREAS.has(i.tipo)).map((it) => ({ nome: it.nome, poly: poligonoDe(it) })) : [];
    if (!vivo) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'AEP: coloque "Ergonomia (RULA/REBA)" antes deste nó (e áreas "Takt · posto")' });
      ctx.metrics['AEP'] = 'sem Ergonomia na cadeia';
    } else {
      // retrato novo do ergonomia (ele roda antes, no mesmo quadro)
      const novo = r !== state.ultRetrato;
      state.ultRetrato = r;
      const obs = [];
      for (const pe of r.pessoas || []) {
        if (!pe.av || !pe.av.ok) continue;
        const c = [(pe.box.x1 + pe.box.x2) / 2, (pe.box.y1 + pe.box.y2) / 2];
        let nome = null;
        for (const q of postos) if (pontoNoPoligono(c, q.poly)) { nome = q.nome; break; }
        if (!nome && p.semPosto === 'ignorar') continue;
        obs.push({ posto: nome || 'Geral', id: pe.id, av: pe.av, box: pe.box });
      }
      if (novo && dt > 0) {
        const porPosto = acumulador.registrar(obs, t, dt, { alertaS: p.alertaS, metodo: p.metodo });
        // miniatura da pior postura nova (no máximo 1 a cada 0,7 s), rosto borrado
        const agora = performance.now();
        if (agora - (state.tMini || 0) > 700) {
          for (const [nome, o] of porPosto) {
            const P = acumulador.postos.get(nome);
            const pend = ['RULA', 'REBA'].filter((M) => P.pico[M] && P.pico[M].novo);
            if (!pend.length) continue;
            const th = miniatura(src, o.box, ctx.poses);
            for (const M of pend) { P.pico[M].novo = false; if (th) P.pico[M].thumb = th; }
            state.tMini = agora;
            break;
          }
        }
      }
    }
    // KPIs do Takt a cada 2 s (o motor guarda os intervalos dos postos)
    if (performance.now() - (state.tTakt || 0) > 2000) {
      state.tTakt = performance.now();
      try {
        const k = obterMotor().kpis();
        state.takt = k ? Object.fromEntries(k.postos.map((x) => [x.nome, x])) : null;
      } catch (_) { state.takt = null; }
    }
    const n = ler('niosh');
    const resumo = acumulador.resumo(p.metodo, state.takt, n && n.tarefa ? { ...n.tarefa, posto: n.posto } : null);
    publicar('aep', {
      metodo: p.metodo, postos: resumo, vivo: Boolean(vivo),
      cab: { empresa: p.empresa, setor: p.setor, atividade: p.atividade, jornada: p.jornada, avaliador: p.avaliador },
      inicio: acumulador.t0, fim: acumulador.tUlt, duracaoS: acumulador.t0 != null ? acumulador.tUlt - acumulador.t0 : 0,
      semPostos: !postos.length, aviso: AVISO_AEP,
    });
    if (p.desenhar) {
      for (const q of postos) {
        const R = resumo.find((x) => x.nome === q.nome);
        const cor = R ? R.prioridade.cor : '#2dd4bf';
        for (let i = 0; i < q.poly.length; i++) {
          const a = q.poly[i], b = q.poly[(i + 1) % q.poly.length];
          ctx.overlay.push({ type: 'line', x1: a[0] * w, y1: a[1] * h, x2: b[0] * w, y2: b[1] * h, color: cor, width: 2 });
        }
        const M = p.metodo;
        ctx.overlay.push({ type: 'banner', x: q.poly[0][0] * w + 4, y: q.poly[0][1] * h + 14, color: cor,
          text: R ? `${q.nome} · ${M} méd. ${fmtBR(R[M].media, 1)} · prioridade ${R.prioridade.nome}` : `${q.nome} · aguardando` });
      }
    }
    ctx.metrics['AEP postos'] = resumo.length;
    if (resumo[0]) ctx.metrics['AEP prioridade'] = `${resumo[0].nome}: ${resumo[0].prioridade.nome}`;
    return clone(src);
  },
};

// ======================================================================= NIOSH

const KP_PUNHOS = [9, 10];

export const niosh = {
  op: 'ergonomia.niosh',
  label: 'Levantamento de carga (NIOSH)',
  group: G_NR17, overlayOnly: true,
  desc: 'Equação revisada do NIOSH: H (distância horizontal das mãos aos tornozelos) e V (altura das mãos) medidos ' +
        'pela pose com a escala da RÉGUA calibrada ou da estatura; cada subida das mãos ≥ "amplitude" é um ' +
        'levantamento (origem → destino, D). Carga, pega, duração, assimetria e (opcional) frequência são entradas ' +
        'manuais. LPR, IL na origem e no destino e classificação. Câmera de LADO. Coloque depois da Pose (RTMO).',
  params: {
    carga: { type: 'float', min: 0, max: 100, step: 0.5, default: 10, label: 'Carga levantada (kg)' },
    pega: { type: 'enum', options: PEGAS, default: 'razoável', label: 'Qualidade da pega' },
    duracao: { type: 'enum', options: DURACOES, default: '2 a 8 h', label: 'Duração da tarefa' },
    assimetria: { type: 'int', min: 0, max: 180, step: 5, default: 0, label: 'Assimetria (torção, °)' },
    freqManual: { type: 'float', min: 0, max: 20, step: 0.1, default: 0, label: 'Frequência (lev./min; 0 = medir)' },
    tarefa: { type: 'enum', options: ['levantar', 'abaixar', 'ambos'], default: 'levantar', label: 'Movimento avaliado' },
    escala: { type: 'enum', options: ['régua calibrada', 'estatura'], default: 'régua calibrada', label: 'Escala (cm por px)' },
    estatura: { type: 'int', min: 120, max: 220, step: 1, default: 170, label: 'Estatura do trabalhador (cm)' },
    tornozelo: { type: 'int', min: 0, max: 20, step: 1, default: 8, label: 'Altura do tornozelo ao piso (cm)' },
    amplitude: { type: 'int', min: 10, max: 120, step: 5, default: 30, label: 'Amplitude mínima de um levantamento (cm)' },
    kpConf: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.3, label: 'Score mín. do ponto' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar H, V e o IL' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('niosh', state) || !state.lev) { state.lev = new Levantamentos(); state.alturaMax = 0; state.avals = []; state.serie = []; }
    const { t, dt } = passoTempo(state, ctx, 1);
    const { w, h } = ctx;
    const poses = Array.isArray(ctx.poses) ? ctx.poses : null;
    const ent = { carga: p.carga, pega: PEGAS.indexOf(p.pega), duracao: DURACOES.indexOf(p.duracao), A: p.assimetria };
    if (!poses) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'NIOSH: coloque a Pose multi-pessoa (RTMO) antes deste nó' });
      publicar('niosh', resumoNiosh(state, p, ent, null, 'sem pose'));
      return clone(src);
    }
    // a pessoa avaliada: a maior caixa
    const pe = poses.slice().sort((a, b) => (b.box.y2 - b.box.y1) * (b.box.x2 - b.box.x1) - (a.box.y2 - a.box.y1) * (a.box.x2 - a.box.x1))[0];
    let medida = null, motivo = '';
    if (pe) {
      const kp = pe.keypoints.map((k) => ({ x: k.x * w, y: k.y * h, score: k.score }));
      // escala: régua (mm por px do quadro) ou estatura pela maior distância nariz→tornozelo vista (em pé)
      let cmPorPx = null;
      const esc = ctx.marcacoes && ctx.marcacoes.escala;
      if (p.escala === 'régua calibrada' && esc && esc.mmPorPxQuadro) cmPorPx = esc.mmPorPxQuadro / 10;
      else {
        const a = alturaNarizTornozelo(kp, p.kpConf);
        if (a && a > state.alturaMax) state.alturaMax = a;
        if (state.alturaMax > 20) cmPorPx = (p.estatura * FRACAO_NARIZ_TORNOZELO) / state.alturaMax;
        if (p.escala === 'régua calibrada') motivo = 'sem régua calibrada: usando a estatura';
      }
      medida = cmPorPx ? medirHV(kp, cmPorPx, { kpConf: p.kpConf, tornozeloCm: p.tornozelo }) : null;
      if (medida && dt > 0) {
        state.serie.push([t, medida.V]); if (state.serie.length > 1200) state.serie.shift();
        const mov = state.lev.passo({ t, H: medida.H, V: medida.V }, p.amplitude);
        if (mov && (p.tarefa === 'ambos' || (p.tarefa === 'levantar') === (mov.tipo === 'levantamento'))) {
          const F = p.freqManual > 0 ? p.freqManual : (state.lev.frequencia(p.tarefa === 'ambos' ? 'ambos' : mov.tipo) ?? 1);
          const av = avaliarMovimento(mov, { ...ent, F });
          state.avals.push({ ...mov, F, av });
          if (state.avals.length > 500) state.avals.shift();
        }
      }
      if (p.desenhar && medida) {
        const [mx, my] = medida.maos, [px, py] = medida.pes;
        ctx.overlay.push({ type: 'line', x1: px, y1: medida.piso, x2: mx, y2: medida.piso, color: '#38bdf8', width: 2 });
        ctx.overlay.push({ type: 'line', x1: mx, y1: medida.piso, x2: mx, y2: my, color: '#facc15', width: 2 });
        ctx.overlay.push({ type: 'point', x: mx, y: my, r: 6, color: '#facc15' });
        ctx.overlay.push({ type: 'point', x: px, y: py, r: 5, color: '#38bdf8' });
        ctx.overlay.push({ type: 'banner', x: mx + 8, y: my - 6, color: '#facc15', text: `H ${Math.round(medida.H)} cm · V ${Math.round(medida.V)} cm` });
      }
    } else motivo = 'ninguém à vista';
    const res = resumoNiosh(state, p, ent, medida, motivo);
    publicar('niosh', res);
    if (p.desenhar && res.tarefa && res.tarefa.n) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: res.tarefa.cor, text: `NIOSH · ${res.tarefa.n} lev. · IL ${fmtBR(res.tarefa.LI, 2)} (${res.tarefa.classe}) · LPR ${fmtBR(res.tarefa.RWL, 1)} kg` });
    }
    ctx.metrics['NIOSH'] = medida ? `H ${Math.round(medida.H)} · V ${Math.round(medida.V)} cm` : (motivo || 'sem medida');
    if (res.tarefa && res.tarefa.n) ctx.metrics['IL'] = fmtBR(res.tarefa.LI, 2);
    return clone(src);
  },
};

/** Instantâneo do NIOSH para o painel e a AEP: últimos levantamentos e a tarefa (IL máximo). */
function resumoNiosh(state, p, ent, medida, motivo) {
  const av = state.avals;
  let tarefa = null;
  if (av.length) {
    const pior = av.reduce((a, b) => (b.av.LI > a.av.LI ? b : a));
    const med = (f) => av.reduce((s, x) => s + f(x), 0) / av.length;
    const F = p.freqManual > 0 ? p.freqManual : (state.lev.frequencia(p.tarefa === 'ambos' ? 'ambos' : p.tarefa === 'levantar' ? 'levantamento' : 'abaixamento') ?? pior.F);
    tarefa = { n: av.length, LI: pior.av.LI, RWL: pior.av.RWL, classe: pior.av.classe.nome, cor: pior.av.classe.cor, F, carga: p.carga,
      pega: p.pega, duracao: p.duracao, A: p.assimetria,
      Ho: med((x) => x.origem.H), Hd: med((x) => x.destino.H), Vo: med((x) => x.origem.V), Vd: med((x) => x.destino.V) };
  }
  return {
    medida: medida ? { H: medida.H, V: medida.V } : null, motivo,
    levantamentos: av.slice(-50).map((x) => ({ t: x.t, tipo: x.tipo, F: x.F, D: x.D, Ho: x.origem.H, Vo: x.origem.V, Hd: x.destino.H, Vd: x.destino.V,
      LIo: x.av.origem.LI, LId: x.av.destino.LI, RWL: x.av.RWL, LI: x.av.LI, classe: x.av.classe.nome, mult: { o: pick(x.av.origem), d: pick(x.av.destino) } })),
    tarefa, serie: state.serie.slice(-600), posto: null,
  };
}
const pick = (e) => ({ HM: e.HM, VM: e.VM, DM: e.DM, AM: e.AM, FM: e.FM, CM: e.CM, RWL: e.RWL, LI: e.LI });

export { equacao, classeIL, KP_PUNHOS };
export default [aepPosto, niosh];
