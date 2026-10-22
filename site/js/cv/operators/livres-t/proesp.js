/**
 * operators/livres-t/proesp.js — CV-77 Bateria PROESP-BR (D2).
 *
 * Aplica os testes do PROESP-BR com os motores que já existem: salto
 * horizontal (motor do Salto), corrida de 20 m e quadrado (linhas
 * "PROESP · linha" cruzadas pela pelve, interpolado entre quadros) e
 * abdominal em 1 min (contagem da Academia antes na cadeia). Resultado por
 * aluno (CÓDIGO, idade e sexo — sem nome, sem rosto, sem biometria) e a
 * classe pela TABELA DO MANUAL, que o professor carrega no painel (CSV):
 * nenhum valor de referência é embutido sem conferência.
 */
import { clone } from '../../core.js';
import { SessaoSalto } from '../../runtime/livres-h/salto.js';
import { obterTreino } from '../../runtime/livres-g/canal.js';
import { Cronometro2Linhas } from '../../runtime/livres-t/clinica.js';
import { TESTES_PROESP, classificarProesp, FONTES_ESP } from '../../runtime/livres-t/esportes.js';
import { publicar, registrar, registrosDe, consumirPedido, geracaoAtual, tabelaProesp } from '../../runtime/livres-t/canal.js';
import { obterPose, PARAMS_POSE, esqueleto, bannerista, COR, num } from './comum.js';

const G = 'CV-77';
export const FUNC_LINHA = 'proesp_linha';
const OPC = Object.fromEntries(Object.entries(TESTES_PROESP).map(([k, t]) => [t.nome, k]));

export const proesp = {
  op: 'proesp.bateria',
  label: 'Bateria PROESP-BR (escola)',
  group: G, overlayOnly: true,
  desc: 'Testes do PROESP-BR pela câmera: salto horizontal (motor do Salto), corrida de 20 m e teste do quadrado (linhas ' +
        '"PROESP · linha" cruzadas pelo quadril, tempo interpolado entre quadros) e abdominal em 1 min (com a Academia ' +
        'antes na cadeia). Resultado por CÓDIGO do aluno, idade e sexo, sem rosto nem identificação; classe pela tabela do ' +
        'manual carregada no painel. Relatório e CSV por turma.',
  params: {
    teste: { type: 'enum', options: Object.keys(OPC), default: TESTES_PROESP.horizontal.nome, label: 'Teste' },
    aluno: { type: 'text', default: '', max: 30, label: 'Código do aluno (sem nome)' },
    turma: { type: 'text', default: '', max: 30, label: 'Turma' },
    idade: { type: 'int', min: 6, max: 17, step: 1, default: 10, label: 'Idade (anos)' },
    sexo: { type: 'enum', options: ['M', 'F'], default: 'M', label: 'Sexo' },
    alturaCm: { type: 'int', min: 0, max: 220, step: 1, default: 0, label: 'Estatura (cm; necessária no salto)' },
    distanciaM: { type: 'float', min: 5, max: 50, step: 1, default: 20, label: 'Corrida: distância entre as linhas (m)' },
    ...PARAMS_POSE,
  },
  apply(src, p, state, ctx) {
    const teste = OPC[p.teste] || 'horizontal';
    if (state.ger !== geracaoAtual() || state.teste !== teste) { state.ger = geracaoAtual(); state.teste = teste; state.ss = new SessaoSalto(); state.cr = new Cronometro2Linhas(); state.nSalto = 0; state.q = null; state.ab = null; }
    const ban = bannerista(ctx.overlay, ctx);
    const tab = tabelaProesp();
    const salvar = (valor, extra = {}) => {
      const c = classificarProesp(tab, teste, p.sexo, p.idade, valor);
      registrar('proesp.bateria', { aluno: p.aluno || '—', turma: p.turma || '—', idade: p.idade, sexo: p.sexo, teste: TESTES_PROESP[teste].nome, valor, unidade: TESTES_PROESP[teste].un, classe: c ? c.classe : (tab ? 'sem linha na tabela' : 'tabela não carregada'), ...extra });
    };
    let principal = null;
    const linhas = [], avisos = [];
    if (teste === 'abdominal') {
      const tr = obterTreino();
      const ped = consumirPedido('proesp.bateria');
      if (ped && ped.acao === 'iniciar') state.ab = { t0: performance.now(), n0: tr.reps.length, fim: false };
      const ab = state.ab;
      if (ab) {
        const dt = (performance.now() - ab.t0) / 1000, n = tr.reps.length - ab.n0;
        if (!ab.fim && dt >= 60) { ab.fim = true; salvar(n); }
        principal = { valor: n, unidade: 'repetições', rotulo: ab.fim ? 'abdominal em 1 min — concluído' : `abdominal · ${Math.ceil(60 - dt)} s restantes`, casas: 0 };
        ban(ab.fim ? `Abdominal: ${n} em 1 min ✓` : `Abdominal: ${n} · ${Math.ceil(60 - dt)} s`, ab.fim ? COR.ok : '#22d3ee');
      } else ban('Abdominal: toque em "Iniciar" no painel (Academia em "Abdominal" antes na cadeia)', COR.aviso);
      if (!tr.exAtual) avisos.push('coloque "Academia — repetições e forma" (exercício Abdominal) antes na cadeia');
      publicar('proesp.bateria', base(p, teste, principal, linhas, avisos, tab, ['iniciar']));
      return clone(src);
    }
    const R = obterPose(src, p, state, ctx);
    if (!R.P) { ban(`PROESP: ${R.espera}`, COR.aviso); publicar('proesp.bateria', base(p, teste, null, linhas, [R.espera], tab)); return clone(src); }
    const sx = ctx.w / R.w, sy = ctx.h / R.h;
    esqueleto(ctx.overlay, R.P, sx, sy, p.minVis);
    if (teste === 'horizontal') {
      if (!(p.alturaCm > 0)) avisos.push('informe a estatura do aluno: é a escala da distância');
      if (R.novo) state.ss.adicionar(R.t, R.P, p.minVis);
      const agora = R.t ?? performance.now();   // relógio da amostra (vídeo exato ao quadro)
      if (state.tA == null || agora - state.tA > 500 || agora < state.tA) {
        state.tA = agora;
        const a = state.ss.analisar({ teste: 'horizontal', alturaCm: p.alturaCm || null, vista: 'lateral' });
        const novas = a.tentativas.slice(state.nSalto).filter((t) => t.dist != null);
        if (a.tentativas.length > state.nSalto) state.nSalto = a.tentativas.length;
        for (const t of novas) { salvar(Math.round(t.dist), { voo_ms: Math.round(t.tv) }); state.q = t.dist; }
      }
      principal = { valor: state.q, unidade: 'cm', rotulo: 'último salto horizontal', casas: 0 };
      ban(`Salto horizontal: ${state.q != null ? num(state.q, 0) + ' cm' : 'salte de lado para a câmera'}`, '#22d3ee');
      avisos.push('Câmera de lado, perpendicular, com a área do salto inteira no quadro.');
    } else {
      const mq = ctx.marcacoes ? ctx.marcacoes.itens.filter((i) => i.funcao === FUNC_LINHA && i.px && i.px.length >= 2) : [];
      const xs = mq.map((i) => (i.px[0][0] + i.px[1][0]) / 2).sort((a, b) => a - b);
      const qe = R.P[23], qd = R.P[24];
      const x = qe && qd ? ((qe.x + qd.x) / 2) * sx : null;
      for (const lx of xs) ctx.overlay.push({ type: 'line', x1: lx, y1: 0, x2: lx, y2: ctx.h, color: '#FFD84D', width: 1.5 });
      if (teste === 'corrida20') {
        if (xs.length < 2) avisos.push('desenhe 2 linhas "PROESP · linha" (largada e chegada)');
        else if (R.novo && x != null) { const c = state.cr.passo(R.t, x, xs[0], xs[xs.length - 1], p.distanciaM); if (c) { salvar(+c.tempoS.toFixed(2), { velocidade_ms: +c.velocidade.toFixed(2) }); state.q = c.tempoS; } }
        principal = { valor: state.q, unidade: 's', rotulo: `corrida de ${p.distanciaM} m`, casas: 2 };
      } else {
        // quadrado: larga cruzando a linha, termina ao cruzá-la de novo depois de ≥ 3 s
        if (!xs.length) avisos.push('desenhe 1 linha "PROESP · linha" no canto de saída do quadrado');
        else if (R.novo && x != null) {
          const lx = xs[0];
          if (state.xAnt != null && (state.xAnt - lx) * (x - lx) < 0) {
            const tc = state.tAnt + ((R.t - state.tAnt) * (lx - state.xAnt)) / ((x - state.xAnt) || 1e-9);
            if (state.tIni == null) state.tIni = tc;
            else if (tc - state.tIni >= 3000) { const s = (tc - state.tIni) / 1000; salvar(+s.toFixed(2)); state.q = s; state.tIni = null; }
          }
          state.xAnt = x; state.tAnt = R.t;
        }
        principal = { valor: state.q, unidade: 's', rotulo: 'teste do quadrado', casas: 2 };
      }
      ban(`${TESTES_PROESP[teste].nome}: ${state.q != null ? num(state.q, 2) + ' s' : 'aguardando a passagem'}`, '#22d3ee');
      avisos.push('Câmera parada, de lado para o percurso; ≥ 30 quadros/s (1 quadro = 0,03 s).');
    }
    publicar('proesp.bateria', base(p, teste, principal, linhas, avisos, tab));
    return clone(src);
  },
};

function base(p, teste, principal, linhas, avisos, tab, acoes = []) {
  const reg = registrosDe('proesp.bateria');
  const ult = reg.filter((r) => r.teste === TESTES_PROESP[teste].nome).slice(-1)[0];
  if (!tab) avisos.push('tabela de referência não carregada: o painel aceita o CSV do manual PROESP-BR (o resultado bruto vale sem ela)');
  return {
    titulo: 'PROESP-BR', principal, acoes, proesp: true,
    linhas: [['Aluno', `${p.aluno || '—'} · ${p.idade} anos · ${p.sexo}${p.turma ? ' · turma ' + p.turma : ''}`], ['Último resultado', ult ? `${ult.valor} ${ult.unidade} — ${ult.classe}` : '—'], ...linhas],
    avisos, registros: reg, colunas: ['n', 'quando', 'turma', 'aluno', 'idade', 'sexo', 'teste', 'valor', 'unidade', 'classe'], fonte: FONTES_ESP.proesp,
  };
}

export default [proesp];
