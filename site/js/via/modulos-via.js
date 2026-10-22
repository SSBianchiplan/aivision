/**
 * via/modulos-via.js — as declarações dos módulos do iaVision para a Via (ver via/registro.js).
 *
 * Carrega SÓ quando a Via usa uma ferramenta de módulo ou quando alguém abre a Via pelo botão de
 * um painel. Cada declaração importa o canal do módulo sob demanda, dentro de estado()/config():
 * nada aqui roda em segundo plano, nada assina canal, nada faz polling.
 *
 * O que sai para a IA: só números e rótulos (enxugar() descarta pontos do corpo, imagens, caixas,
 * séries longas e textos grandes). Módulos com dados de PESSOAS (saúde, movimento, fala, posto
 * de trabalho) vão com `pessoal: true`: a ferramenta pede permissão antes de ler.
 *
 * Todos os 84 módulos do registry (cv/registry.js) entram também por uma declaração GENÉRICA
 * (id «cv-36» etc.): os nós deles no Pipeline, os parâmetros e as métricas da telemetria.
 */
import { store, persist } from '../state/store.js';
import { MODULES, OPERATORS, getOperator, defaultParams, coerceParams } from '../cv/registry.js';
import { newNodeId } from '../cv/executor.js';
import { registrarModuloVia, moduloVia, modulosVia } from './registro.js';

// ------------------------------------------------------------------ utilidades

const DESCARTE = new Set(['P', 'W', 'Wf', 'P2', 'p2d', 'img', 'imagem', 'quadro', 'serie', 'espectro', 'dets', 'box', 'caixa', 'caixas', 'pts', 'poligono',
  'pontos', 'mascara', 'data', 'maos', 'trilha', 'buffer', 'kps', 'landmarks', 'lms', 'roi', 'canvas', 'blob', 'url', 'thumb', 'foto', 'fotos', 'base64',
  'nome', 'paciente', 'atleta', 'email', 'cpf', 'telefone', 'face', 'rosto', 'm', 'grade', 'polys', 'faixasPx']);
const fin = Number.isFinite;

/** Deixa o objeto pequeno e sem dado bruto: profundidade ≤ 4, listas ≤ 12, números com 3 casas. */
export function enxugar(v, nivel = 0) {
  if (v == null) return v;
  if (typeof v === 'number') return fin(v) ? Math.round(v * 1000) / 1000 : null;
  if (typeof v === 'string') return v.length > 200 ? v.slice(0, 200) + '…' : v;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (ArrayBuffer.isView(v)) return `[${v.length} valores]`;
  if (nivel >= 4) return Array.isArray(v) ? `[lista de ${v.length}]` : '{…}';
  if (v instanceof Map) v = Object.fromEntries(v);
  if (v instanceof Set) v = [...v];
  if (Array.isArray(v)) {
    const out = v.slice(0, 12).map((x) => enxugar(x, nivel + 1));
    if (v.length > 12) out.push(`… +${v.length - 12}`);
    return out;
  }
  const o = {};
  for (const [k, x] of Object.entries(v)) {
    if (DESCARTE.has(k)) continue;
    const y = enxugar(x, nivel + 1);
    if (y !== undefined) o[k] = y;
  }
  return o;
}

const nos = (ops) => store.get().nodes.filter((n) => ops.includes(n.op));
const opsDoGrupo = (ids) => [...OPERATORS.values()].filter((d) => ids.includes(d.group)).map((d) => d.op);

/** Os nós destes operadores no Pipeline, para o estado. */
function estadoNos(ops) {
  const st = store.get();
  const tm = new Map((st.timings || []).map((t) => [t.id, t]));
  return nos(ops).map((n) => ({ op: n.op, rotulo: (getOperator(n.op) || {}).label || n.op, ligado: n.enabled !== false, erro: n.error || null,
    ms: tm.get(n.id) ? Math.round(tm.get(n.id).ms * 10) / 10 : null, params: enxugar(n.params) }));
}

/** Métricas da telemetria (store.metrics) — texto livre por operador. */
function metricas(filtro = null) {
  const m = store.get().metrics || {};
  const out = {};
  for (const [k, v] of Object.entries(m)) if (!filtro || filtro.test(k)) out[k] = enxugar(v);
  return out;
}

/** Esquema de configuração a partir dos params dos operadores (chave «op.param»). */
function configNos(ops, { soPresentes = true, chaves = null } = {}) {
  const st = store.get();
  const out = {};
  for (const op of ops) {
    const def = getOperator(op);
    if (!def || !def.params) continue;
    const n = st.nodes.find((x) => x.op === op);
    if (soPresentes && !n) continue;
    const atual = { ...defaultParams(op), ...(n ? n.params : {}) };
    for (const [k, s] of Object.entries(def.params)) {
      if (chaves && !chaves.includes(k)) continue;
      const tipo = s.type === 'enum' ? 'opcao' : s.type === 'bool' ? 'sim_nao' : s.type === 'int' ? 'inteiro' : s.type === 'float' ? 'numero' : s.type === 'text' ? 'texto' : null;
      if (!tipo) continue;
      out[`${op}.${k}`] = { rotulo: `${def.label} › ${s.label || k}`, tipo, valor: enxugar(atual[k]),
        ...(fin(s.min) ? { min: s.min } : {}), ...(fin(s.max) ? { max: s.max } : {}), ...(s.options ? { opcoes: s.options.slice(0, 30) } : {}),
        ...(s.type === 'text' ? { max_caracteres: s.max || 400 } : {}) };
    }
  }
  return out;
}

/** Aplica mudanças «op.param» nos nós (cria o nó com os padrões se não houver). */
function aplicarNos(mudancas) {
  const porOp = {};
  for (const [k, v] of Object.entries(mudancas)) { const i = k.lastIndexOf('.'); (porOp[k.slice(0, i)] ||= {})[k.slice(i + 1)] = v; }
  let ns = store.get().nodes;
  const feito = [];
  for (const [op, patch] of Object.entries(porOp)) {
    const p = coerceParams(op, patch);
    const i = ns.findIndex((n) => n.op === op);
    if (i >= 0) ns = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null, params: { ...n.params, ...p } } : n));
    else { ns = [...ns, { id: newNodeId(), op, params: { ...defaultParams(op), ...p }, enabled: true }]; feito.push(`${op} adicionado ao Pipeline`); }
    feito.push(`${op}: ${Object.entries(p).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
  }
  store.set({ nodes: ns });
  persist();
  return feito.join(' · ');
}

const lerCaminho = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
function gravarCaminho(o, p, v) { const ks = p.split('.'), u = ks.pop(); const alvo = ks.reduce((a, k) => (a[k] == null ? (a[k] = {}) : a[k]), o); alvo[u] = v; }

/** Declaração de módulo baseado em nós do Pipeline + (opcional) um canal com estado(). */
function deNos({ id, nome, registro, ops, pessoal = false, sobre, estadoExtra = null, chaves = null }) {
  const lista = ops || opsDoGrupo(registro);
  registrarModuloVia({
    id, nome, registro, ops: lista, pessoal, sobre,
    estado: async () => {
      const base = { pipeline: estadoNos(lista) };
      if (!base.pipeline.length) base.aviso = 'Nenhum nó deste módulo no Pipeline agora (ligue o módulo para ter números ao vivo).';
      if (estadoExtra) { try { Object.assign(base, enxugar(await estadoExtra())); } catch (e) { base.canal = `indisponível (${e.message})`; } }
      return base;
    },
    config: async () => configNos(lista, { soPresentes: false, chaves }),
    aplicar: async (m) => aplicarNos(m),
  });
}

// ------------------------------------------------------------------ Industrial

registrarModuloVia({
  id: 'beltscan', nome: 'BeltScan', registro: ['CV-36'], ops: ['beltscan.volumetria'],
  sobre: 'Volumetria em correia por triangulação a laser: A = área da seção (cm²), Q = vazão (m³/h), fill = enchimento da seção, q = qualidade (BOM/INCERTO/RUIM/SEM REF), cov = cobertura da linha. Bancada: velocidade por fluxo óptico. Alarmes por nível/vazão. A configuração (motor.C, por perfil) tem extração (limiar, top-hat, ROI), geometria (H_c, α, b), bancada, mapeamento e alarmes.',
  estado: async () => {
    const c = await import('../cv/runtime/livres-k/canal.js');
    const r = c.instantaneo();
    const m = c.obterMotor();
    const alarmes = m && m.alarm ? Object.fromEntries(Object.entries(m.alarm).map(([k, a]) => [k, a && a.state])) : {};
    return { perfil: c.perfilAtivo(), ao_vivo: c.recente(), retrato: r ? enxugar({ q: r.q, cov: r.cov, A: r.A, Q: r.Q, fill: r.fill, lvlRep: r.lvlRep, lvlMax: r.lvlMax, gate: r.gate, bench: r.bench, status: r.status, pr: r.pr }) : null, alarmes };
  },
  config: async () => {
    const [{ ABAS }, c] = await Promise.all([import('../components/industrial/BeltScanConfig.js'), import('../cv/runtime/livres-k/canal.js')]);
    const C = c.obterMotor().C, out = {};
    for (const [aba, itens] of Object.entries(ABAS)) for (const it of itens) {
      if (!it.p || it.type === 'roi') continue;
      const v = lerCaminho(C, it.p);
      if (it.type === 'bool') out[it.p] = { rotulo: `${aba} › ${it.l}`, tipo: 'sim_nao', valor: Boolean(v) };
      else if (it.type === 'select') out[it.p] = { rotulo: `${aba} › ${it.l}`, tipo: 'opcao', opcoes: it.opts.map((o) => o[0]), valor: v };
      else if (fin(it.min)) out[it.p] = { rotulo: `${aba} › ${it.l}${it.u ? ` (${it.u})` : ''}`, tipo: 'numero', min: it.min, max: it.max, valor: enxugar(v) };
    }
    return out;
  },
  aplicar: async (mud) => {
    const c = await import('../cv/runtime/livres-k/canal.js');
    const m = c.obterMotor();
    for (const [k, v] of Object.entries(mud)) gravarCaminho(m.C, k, v);
    m.mudou();
    if (Object.keys(mud).some((k) => /^(extraction|geo)\./.test(k))) m.reiniciar(false);
    c.salvarSeMudou(); c.avisarAgora();
    return `BeltScan (perfil ${c.perfilAtivo()}): ${Object.entries(mud).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
  },
});

deNos({ id: 'contador', nome: 'CounterVision', registro: ['CV-38'], ops: ['contagem.esteira', 'contagem.cor', 'contagem.onnx', 'contagem.rastreio'],
  sobre: 'Contagem de peças/objetos por linha de cruzamento ou zona: total, ida/volta, por classe, taxa por minuto/hora, meta do turno (% e projeção), paradas e alarmes de taxa.',
  estadoExtra: async () => { const e = await import('../cv/runtime/livres-l/esteira.js'); const r = e.instantaneo(); return { ao_vivo: e.recente(), resumo: r && r.resumo, linhas: r && r.temLinha, zonas: r && r.temZona }; } });

registrarModuloVia({
  id: 'takt', nome: 'Takt', registro: ['CV-39'], ops: ['takt.posto'], pessoal: true,
  sobre: 'Ocupação de postos de trabalho por pose: produtividade (ativo), ociosidade, vacância (posto vago), ocupação e cobertura (tempo observado), por posto e geral, com histerese (act_on/act_off) e tempos de confirmação. Mede o POSTO, não avalia a pessoa.',
  estado: async () => {
    const c = await import('../cv/runtime/livres-m/canal.js');
    const r = c.instantaneo(), m = c.obterMotor();
    let k = null; try { k = m && m.kpis(); } catch (_) { k = null; }
    return { ao_vivo: c.recente(), postos: r && r.postos ? (Array.isArray(r.postos) ? r.postos.length : r.postos) : 0, pessoas_no_quadro: r && r.pessoas ? r.pessoas.length : 0,
      presenca: r && r.presenca, fora_de_turno: r && r.foraDeTurno, parada: r && r.parada, kpis: enxugar(k && { janela: k.janela, geral: k.geral, postos: k.postos }), pipeline: estadoNos(['takt.posto']) };
  },
  config: async () => {
    const c = await import('../cv/runtime/livres-m/canal.js');
    const cfg = c.obterMotor().cfg;
    const N = (rot, min, max) => ({ rotulo: rot, tipo: 'numero', min, max });
    const s = {
      tempos: { rotulo: 'Tempos de confirmação (predefinição)', tipo: 'opcao', opcoes: ['producao', 'bancada', 'personalizado'] },
      'params.act_on': N('Histerese: entra em produtivo acima de', 0, 1), 'params.act_off': N('Histerese: sai de produtivo abaixo de', 0, 1),
      'params.enter_confirm_s': N('Confirmar entrada (s)', 0, 120), 'params.idle_confirm_s': N('Confirmar ociosidade (s)', 0, 900),
      'params.vacant_confirm_s': N('Confirmar posto vago (s)', 0, 900), 'params.stale_s': N('Sem quadro → não observado (s)', 0.5, 60),
      'params.min_conf_det': N('Confiança mínima da detecção', 0, 1), 'params.min_qual_pose': N('Qualidade mínima da pose', 0, 1),
      presenca: { rotulo: 'Presença medida na', tipo: 'opcao', opcoes: ['imagem', 'piso'] },
      raio_img: N('Raio do posto na imagem (fração da altura)', 0.02, 1), raio_m: N('Raio do posto no piso (m)', 0.2, 5),
      'alarmes.vagoMin': N('Alarme: posto vago por (min)', 0, 240), 'alarmes.ociosoPct': N('Alarme: ociosidade acima de (%)', 0, 100),
      'alarmes.coberturaMin': N('Alarme: cobertura abaixo de (%)', 0, 100),
    };
    for (const [k, d] of Object.entries(s)) d.valor = enxugar(lerCaminho(cfg, k));
    return { ...s, ...configNos(['takt.posto'], { soPresentes: false }) };
  },
  aplicar: async (mud) => {
    const c = await import('../cv/runtime/livres-m/canal.js');
    const m = c.obterMotor();
    const nosMud = Object.fromEntries(Object.entries(mud).filter(([k]) => k.startsWith('takt.posto.')));
    const cfgMud = Object.fromEntries(Object.entries(mud).filter(([k]) => !k.startsWith('takt.posto.')));
    if (Object.keys(cfgMud).length) {
      const patch = {};
      for (const [k, v] of Object.entries(cfgMud)) {
        const [a, b] = k.split('.');
        if (b) patch[a] = { ...(patch[a] || m.cfg[a]), [b]: v }; else patch[a] = v;
      }
      if (patch.params && !cfgMud.tempos) patch.tempos = 'personalizado';
      m.definir(patch); c.avisarAgora();
    }
    const t = Object.keys(nosMud).length ? aplicarNos(nosMud) : '';
    return `Takt: ${Object.entries(cfgMud).map(([k, v]) => `${k} = ${v}`).join(', ')}${t ? ` · ${t}` : ''}`;
  },
});

registrarModuloVia({
  id: 'oee', nome: 'OEE', registro: ['CV-46'], ops: ['maquina.estado'],
  sobre: 'OEE = disponibilidade × desempenho × qualidade, a partir do estado da máquina pela imagem (rodando/parada/setup por movimento na área marcada). Desempenho exige o ciclo ideal; qualidade exige peças boas. «parcial» indica o que falta.',
  estado: async () => {
    const c = await import('../cv/runtime/livres-o/canal.js');
    const m = c.obterMotor();
    let k = null; try { k = m && m.kpis(); } catch (_) { k = null; }
    return { ao_vivo: c.recente(), kpis: enxugar(k), pipeline: estadoNos(['maquina.estado']) };
  },
  config: async () => {
    const c = await import('../cv/runtime/livres-o/canal.js');
    const cfg = c.obterMotor().cfg, out = {};
    for (const [k, v] of Object.entries(cfg.params || {})) if (fin(v)) out[`params.${k}`] = { rotulo: `Parâmetro ${k}`, tipo: 'numero', min: 0, max: /_s$/.test(k) ? 3600 : v > 1 ? Math.max(100, v * 10) : 1, valor: v };
    out.cicloIdeal_s = { rotulo: 'Ciclo ideal (s por peça; 0 = sem desempenho)', tipo: 'numero', min: 0, max: 3600, valor: cfg.cicloIdeal_s };
    out['alarmes.paradaMin'] = { rotulo: 'Alarme: parada sem motivo por (min)', tipo: 'numero', min: 0, max: 240, valor: cfg.alarmes && cfg.alarmes.paradaMin };
    out.setupPeloTakt = { rotulo: 'Setup detectado pelo Takt', tipo: 'sim_nao', valor: Boolean(cfg.setupPeloTakt) };
    return { ...out, ...configNos(['maquina.estado'], { soPresentes: false }) };
  },
  aplicar: async (mud) => {
    const c = await import('../cv/runtime/livres-o/canal.js');
    const m = c.obterMotor();
    const nosMud = Object.fromEntries(Object.entries(mud).filter(([k]) => k.startsWith('maquina.estado.')));
    const patch = {};
    for (const [k, v] of Object.entries(mud)) {
      if (k.startsWith('maquina.estado.')) continue;
      const [a, b] = k.split('.');
      if (b) patch[a] = { ...(patch[a] || m.cfg[a]), [b]: v }; else patch[a] = v;
    }
    if (Object.keys(patch).length) { m.definir(patch); c.avisarAgora(); }
    if (Object.keys(nosMud).length) aplicarNos(nosMud);
    return `OEE: ${Object.entries(mud).map(([k, v]) => `${k} = ${v}`).join(', ')}`;
  },
});

const GATILHO = { on_ratio: [0, 1, 'Gatilho: liga acima de (fração alterada)'], off_ratio: [0, 1, 'Gatilho: desliga abaixo de'], diff_thr: [1, 255, 'Gatilho: diferença mínima de cinza'],
  stable_frames: [1, 60, 'Gatilho: quadros estáveis'], motion_max: [0, 1, 'Gatilho: movimento máximo para inspecionar'] };
registrarModuloVia({
  id: 'inspecao', nome: 'Inspect', registro: ['CV-40'], ops: opsDoGrupo(['CV-40']),
  sobre: 'Inspeção visual por programa versionado (ferramentas de presença, blobs, paquímetro, cor, forma, área de defeito) com gatilho por mudança na imagem. Resultados OK/NOK/INCERTO, rendimento, refugo, ciclo médio e Cp/Cpk das medidas.',
  estado: async () => {
    const c = await import('../cv/runtime/livres-n/canal.js');
    const p = c.programaAtivo();
    return { estatisticas: enxugar(c.estatisticas()), programa: p ? { codigo: p.codigo, versao: p.versao, ferramentas: (p.tools || []).map((t) => ({ tipo: t.type, codigo: t.code, nominal_mm: t.nominal_mm, tol_mm: t.tol_mm })) } : null,
      gatilho: enxugar(c.infoGatilho()), status: c.status(), pipeline: estadoNos(opsDoGrupo(['CV-40'])) };
  },
  config: async () => {
    const [c, pg] = await Promise.all([import('../cv/runtime/livres-n/canal.js'), import('../cv/runtime/livres-n/programa.js')]);
    const p = c.programaAtivo();
    const g = { ...(pg.GATILHO_PADRAO || {}), ...((p && p.gatilho) || {}) };
    const out = {};
    if (p) for (const [k, [min, max, rot]] of Object.entries(GATILHO)) out[`gatilho.${k}`] = { rotulo: rot, tipo: 'numero', min, max, valor: g[k] };
    return { ...out, ...configNos(['inspect.programa'], { soPresentes: false }) };
  },
  aplicar: async (mud) => {
    const [c, pg] = await Promise.all([import('../cv/runtime/livres-n/canal.js'), import('../cv/runtime/livres-n/programa.js')]);
    const gat = Object.fromEntries(Object.entries(mud).filter(([k]) => k.startsWith('gatilho.')).map(([k, v]) => [k.slice(8), v]));
    const nosMud = Object.fromEntries(Object.entries(mud).filter(([k]) => !k.startsWith('gatilho.')));
    const out = [];
    if (Object.keys(gat).length) {
      const p = JSON.parse(JSON.stringify(c.programaAtivo()));
      p.gatilho = { ...(pg.GATILHO_PADRAO || {}), ...(p.gatilho || {}), ...gat };
      c.salvar(p, 'Via: gatilho ajustado');
      out.push(`programa ${p.codigo}: nova versão com o gatilho ${Object.entries(gat).map(([k, v]) => `${k} = ${v}`).join(', ')}`);
    }
    if (Object.keys(nosMud).length) out.push(aplicarNos(nosMud));
    return out.join(' · ');
  },
});

deNos({ id: 'epi', nome: 'EPI', registro: ['CV-48'], ops: ['epi.monitor'],
  sobre: 'Conformidade de EPI (capacete, colete) por zona: % conforme, não conforme e incerto, pessoas ao mesmo tempo. Só agregados por zona saem para a Via — nunca imagem nem identificação.',
  estadoExtra: async () => {
    const { canalEpi } = await import('../cv/runtime/livres-q/canal.js');
    const r = canalEpi.instantaneo();
    const cont = {};
    for (const p of (r && r.pessoas) || []) cont[p.geral] = (cont[p.geral] || 0) + 1;
    return { zonas: canalEpi.zonas(), pessoas_agora: r && r.pessoas ? r.pessoas.length : 0, por_estado_agora: cont };
  } });

registrarModuloVia({
  id: 'industrial', nome: 'Industrial (hub)', registro: [], ops: [],
  sobre: 'Hub dos módulos industriais (BeltScan, CounterVision, Takt, Inspect, OEE, EPI). O estado junta os resumos dos que estão ligados; o Takt aparece só como ligado/desligado (dados de posto de trabalho exigem permissão própria).',
  estado: async () => {
    const out = {};
    for (const id of ['beltscan', 'contador', 'oee', 'inspecao', 'epi']) {
      const m = moduloVia(id);
      const ligado = store.get().nodes.some((n) => m.ops.includes(n.op) && n.enabled !== false);
      out[id] = ligado ? await m.estado().catch((e) => `indisponível (${e.message})`) : 'desligado';
    }
    out.takt = store.get().nodes.some((n) => n.op === 'takt.posto' && n.enabled !== false) ? 'ligado (use ler_estado_modulo takt, com permissão)' : 'desligado';
    return out;
  },
});

// ------------------------------------------------------------------ Saúde e esportes (dados de pessoas)

deNos({ id: 'fisio', nome: 'Fisio', registro: ['CV-47'], ops: ['fisio.avaliar'], pessoal: true,
  sobre: 'Goniometria (ADM, graus, referência AAOS), TUG e sentar-levantar (5× e 30 s) por pose. Educacional: não é laudo. O nome do paciente nunca vai para a Via.',
  estadoExtra: async () => {
    const { canalFisio } = await import('../cv/runtime/livres-p/canal.js');
    const r = canalFisio.instantaneo();
    const s = canalFisio.sessao || {};
    return { resultado: r && r.res, teste: r && r.cfg && { teste: r.cfg.teste, articulacao: r.cfg.articulacao, lado: r.cfg.lado },
      sessao: { medidas: enxugar((s.medidas || []).slice(-8)), tentativas: (s.tentativas || []).length } };
  } });

deNos({ id: 'vitais', nome: 'Vitais e saúde+', registro: ['CV-70', 'CV-71', 'CV-72', 'CV-73', 'CV-74', 'CV-75', 'CV-76', 'CV-77'], pessoal: true,
  sobre: 'Respiração e frequência cardíaca por vídeo (rPPG), tremor, postura, marcha, exercício domiciliar, hospital, yoga/referência, esportes de ciclo e PROESP-BR. Estimativas educacionais, não são sinais vitais clínicos.',
  estadoExtra: async () => {
    const c = await import('../cv/runtime/livres-t/canal.js');
    const t = c.todos();
    const out = {};
    for (const [op, r] of (t instanceof Map ? t : new Map(Object.entries(t || {})))) out[op] = { titulo: r.titulo, principal: r.principal, linhas: r.linhas, avisos: r.avisos, saude: r.saude };
    return { medidas: out };
  } });

deNos({ id: 'bikefit', nome: 'Bike Fit', registro: ['CV-28'], ops: ['bikefit.analise'], pessoal: true,
  sobre: 'Ângulos do ciclista na bike (joelho no PMI/PMS, quadril, tronco, cotovelo, tornozelo, KOPS), cadência e recomendações por perfil. Faixas de referência por perfil (estrada, MTB, triathlon…). Educacional.',
  estadoExtra: async () => {
    const c = await import('../cv/runtime/livres-e/canal.js');
    const r = c.instantaneo();
    return r ? { vista: r.vista, perfil: r.perfil, lado: r.lado, angulos: r.ang, kops: r.kops, frontal: r.frontal, cadencia: r.cadencia, pedaladas: r.pedaladas, avisos: r.avisos, recomendacoes: r.recs, resumo: r.resumo } : { aviso: 'sem análise ao vivo' };
  } });

const canalSimples = (caminho, nomeExp = null) => async () => {
  const c = await import(caminho);
  const obj = nomeExp ? c[nomeExp] : c;
  return { ao_vivo: enxugar(obj.instantaneo()) };
};
deNos({ id: 'ergonomia', nome: 'Ergonomia RULA/REBA', registro: ['CV-29'], ops: ['ergonomia.avaliar'], pessoal: true,
  sobre: 'Pontuação RULA/REBA por pessoa (nota e faixa de risco) a partir da pose. Educacional: não substitui a AET da NR-17.', estadoExtra: canalSimples('../cv/runtime/livres-f/canal.js') });
deNos({ id: 'academia', nome: 'Academia', registro: ['CV-30'], ops: ['academia.treino'], pessoal: true,
  sobre: 'Contagem de repetições e séries, fase do movimento, reps boas, descanso e feedback de técnica.', estadoExtra: canalSimples('../cv/runtime/livres-g/canal.js') });
deNos({ id: 'salto', nome: 'Salto', registro: ['CV-31'], ops: ['salto.teste'], pessoal: true,
  sobre: 'Altura do salto (CMJ, squat jump, drop jump, contínuos, horizontal) pelo tempo de voo e pela pose.', estadoExtra: canalSimples('../cv/runtime/livres-h/canal.js', 'canalSalto') });
deNos({ id: 'corrida', nome: 'Corrida', registro: ['CV-32'], ops: ['corrida.marcha'], pessoal: true,
  sobre: 'Cadência, tempo de contato, oscilação vertical e ângulos da marcha de corrida.', estadoExtra: canalSimples('../cv/runtime/livres-h/canal.js', 'canalCorrida') });
deNos({ id: 'swing', nome: 'Swing', registro: ['CV-33'], ops: ['swing.analise'], pessoal: true,
  sobre: 'Velocidade do implemento (taco, raquete, bastão) e contagem de swings.', estadoExtra: canalSimples('../cv/runtime/livres-i/canal.js', 'canalSwing') });
deNos({ id: 'vbt', nome: 'VBT', registro: ['CV-34'], ops: ['vbt.barra'], pessoal: true,
  sobre: 'Velocidade da barra por repetição (m/s), perda de velocidade na série e limite de perda.', estadoExtra: canalSimples('../cv/runtime/livres-i/canal.js', 'canalVbt') });
deNos({ id: 'quadra', nome: 'Quadra', registro: ['CV-35'], ops: ['quadra.analise'], pessoal: true,
  sobre: 'Jogadores e bola na quadra: ralis, posse, mapa de posição por time.', estadoExtra: canalSimples('../cv/runtime/livres-j/canal.js') });
registrarModuloVia({
  id: 'esportes', nome: 'Esportes (hub)', registro: [], ops: [],
  sobre: 'Hub dos módulos de esportes e saúde. Mostra só quais estão ligados; os números de cada um são dados de pessoas e pedem permissão (ler_estado_modulo com o id do módulo).',
  estado: async () => {
    const out = {};
    for (const id of ['bikefit', 'ergonomia', 'academia', 'salto', 'corrida', 'swing', 'vbt', 'quadra', 'fisio', 'vitais', 'motion3d']) {
      const m = moduloVia(id);
      if (m) out[id] = store.get().nodes.some((n) => m.ops.includes(n.op) && n.enabled !== false) ? 'ligado' : 'desligado';
    }
    return { modulos: out };
  },
});

// ------------------------------------------------------------------ Medições e Aplicações

const REG_MEDICOES = ['CV-37', 'CV-41', 'CV-42', 'CV-43', 'CV-44', 'CV-45', 'CV-49', 'CV-50', 'CV-51', 'CV-52', 'CV-53', 'CV-54', 'CV-55', 'CV-56', 'CV-57', 'CV-58', 'CV-59',
  'CV-60', 'CV-61', 'CV-62', 'CV-63', 'CV-64', 'CV-65', 'CV-66', 'CV-67'];
deNos({ id: 'medicoes', nome: 'Medições', registro: REG_MEDICOES,
  sobre: 'Painel das medições livres: tráfego CVC, instrumentos (mostrador, display 7 segmentos), segurança por pose (cerca, queda, ponto de encontro), fotocélula, mapa de calor, logística, poka-yoke, cubagem, doca, nível/gotejamento, correia, torque, chama, solda, Ringelmann, baú, fissuras, NR-17, predial, varejo, ocupação, medidores, velocidade.',
  estadoExtra: async () => {
    const c = await import('../cv/runtime/livres-oa/canal.js');
    const out = {};
    for (const k of c.chaves()) if (!/^u_/.test(k)) out[k] = enxugar(c.ler(k));
    return { medidas: out };
  } });
deNos({ id: 'aplicacoes', nome: 'Aplicações', registro: ['CV-80', 'CV-81', 'CV-82', 'CV-83', 'CV-84', 'CV-85', 'CV-86', 'CV-87'],
  sobre: 'Painel das aplicações: física (trajetória), acessibilidade, Libras, sala de aula, mídia, agro, câmera de jogo e RDO de obra.',
  estadoExtra: async () => {
    const c = await import('../cv/runtime/livres-oa/canal.js');
    const out = {};
    for (const k of c.chaves()) if (/^u_/.test(k) && !/^u_(falar|libras)$/.test(k)) out[k] = enxugar(c.ler(k));
    return { medidas: out, nota: 'Fala e Libras não vão para a Via (texto de pessoas).' };
  } });

// ------------------------------------------------------------------ outros painéis

deNos({ id: 'coisas', nome: 'Coisas', registro: ['CV-12'], ops: ['yoloe.detect', 'yoloe.prompt'],
  sobre: 'Detecção por vocabulário aberto (YOLOE): classes por texto ou filtro do vocabulário fixo. Contagens por classe na telemetria.',
  estadoExtra: async () => ({ metricas: metricas() }) });
registrarModuloVia({
  id: 'projeto', nome: '+Projeto', registro: ['CV-24'], ops: ['livres.rfdetr', 'livres.patchcore'],
  sobre: 'Projetos de modelo próprio a partir das marcações: prints, caixas, envio ao Treinar e uso no Pipeline.',
  estado: async () => {
    const b = await import('../projeto/base.js');
    const s = b.projStore.get(), a = b.ativo();
    return { projetos: (s.projetos || []).map((p) => ({ id: p.id, tipo: p.tipo, classes: enxugar(p.classes), prints: (p.prints || []).length || undefined })), ativo: a ? a.id : null, prints_na_sessao: (s.prints || []).length, pipeline: estadoNos(['livres.rfdetr', 'livres.patchcore']) };
  },
  config: async () => configNos(['livres.rfdetr', 'livres.patchcore']),
  aplicar: async (m) => aplicarNos(m),
});
registrarModuloVia({
  id: 'telemetria', nome: 'Telemetria', registro: [], ops: [],
  sobre: 'Desempenho do app: fps, tempo de processamento por quadro e por nó, largura de trabalho (procWidth), qualidade automática e as métricas de cada operador.',
  estado: async () => {
    const s = store.get();
    return { fps: enxugar(s.fps), procMs: enxugar(s.procMs), procWidth: s.procWidth, resolucao: enxugar(s.resolution), autoQuality: s.autoQuality, targetFps: s.targetFps,
      nos: (s.timings || []).map((t) => ({ op: t.op, ms: enxugar(t.ms), erro: t.error || undefined })), metricas: metricas() };
  },
  config: async () => {
    const s = store.get();
    return { procWidth: { rotulo: 'Largura de trabalho (px)', tipo: 'inteiro', min: 160, max: 1920, valor: s.procWidth },
      targetFps: { rotulo: 'Alvo de fps', tipo: 'inteiro', min: 1, max: 60, valor: s.targetFps },
      autoQuality: { rotulo: 'Qualidade automática', tipo: 'sim_nao', valor: Boolean(s.autoQuality) } };
  },
  aplicar: async (m) => { store.set({ ...m }); persist(); return `Telemetria: ${Object.entries(m).map(([k, v]) => `${k} = ${v}`).join(', ')}`; },
});
deNos({ id: 'codigos', nome: 'Códigos (QR e barras)', registro: ['CV-10'], ops: ['code.scan'],
  sobre: 'Leitura de QR e códigos de barras: o que foi lido, formato e quantas vezes.',
  estadoExtra: async () => { const { codeLog } = await import('../cv/operators/code.js'); return { lidos: (codeLog.items || []).slice(-12).map((i) => ({ texto: String(i.text || '').slice(0, 80), formato: i.format, vezes: i.count })) }; } });
registrarModuloVia({
  id: 'legendas', nome: 'Legendas', registro: [], ops: [], pessoal: true,
  sobre: 'Legenda ao vivo (reconhecimento de fala no aparelho). A fala é dado de pessoa: só vai com permissão.',
  estado: async () => { const c = await import('../cv/speech/captions.js'); return { legenda_atual: enxugar(c.legendaAtual()) }; },
});
registrarModuloVia({
  id: 'contexto', nome: 'Contexto', registro: [], ops: [],
  sobre: 'Painel Contexto: observações da cena por modelos de visão; o estado vive dentro do painel e não é exportado. Use obter_pipeline ou ver_quadro_atual (com permissão).',
  estado: async () => ({ aviso: 'O painel Contexto não expõe estado para fora; use ver_quadro_atual (com permissão) ou obter_pipeline.', metricas: metricas() }),
});
registrarModuloVia({
  id: 'motion3d', nome: 'Motion 3D Studio', registro: ['CV-88'], ops: ['motion3d.captura'],
  sobre: 'Captura de movimento 3D (33 pontos, BVH de 15 juntas). Tomadas no Content Browser (IndexedDB do navegador). A Via gera animações por texto, coreografias, ajustes, perfis de retarget e análises — use as ferramentas *_motion3d.',
  estado: async () => {
    const a = await import('../cv/runtime/livres-v/armazem.js');
    const { ponteMotion } = await import('../components/motion3d/via-motion.js');
    let ts = []; try { ts = await a.listar(); } catch (_) { ts = []; }
    const p = ponteMotion(), pl = p && p.play && p.play.current;
    return { studio_aberto: Boolean(p), tomadas_salvas: ts.length, tocando: pl ? { nome: pl.tomada.nome, quadro: pl.quadro, quadros: pl.proc.trilha.length } : null, pipeline: estadoNos(['motion3d.captura']) };
  },
  config: async () => configNos(['motion3d.captura'], { soPresentes: false }),
  aplicar: async (m) => aplicarNos(m),
});
registrarModuloVia({
  id: 'video', nome: 'GPlanSiS|Vídeo', registro: [], ops: [],
  sobre: 'Editor de vídeo (corte, marcadores, recorte, proporção). O estado só existe com o editor aberto.',
  estado: async () => {
    const v = typeof window !== 'undefined' && window.aivVideo;
    if (!v || !v.estado) return { aviso: 'Editor de vídeo fechado.' };
    const e = v.estado() || {};
    return enxugar({ clipes: Array.isArray(e.clipes) ? e.clipes.length : e.clipes, marcadores: Array.isArray(e.marcadores) ? e.marcadores.length : e.marcadores,
      entrada: e.entrada, saida: e.saida, modo: e.modo, taxa: e.taxa, proporcao: e.proporcao, recorte: Boolean(e.recorte) });
  },
});

// ------------------------------------------------------------------ genérico: todos os módulos do registry

const cobertos = new Map();
for (const m of modulosVia()) for (const r of m.registro || []) cobertos.set(r, m.id);
for (const mod of MODULES) {
  const id = mod.id.toLowerCase();
  if (moduloVia(id)) continue;
  const ops = opsDoGrupo([mod.id]);
  registrarModuloVia({
    id, nome: `${mod.id} ${mod.name}`, registro: [mod.id], ops, generico: true, painel: cobertos.get(mod.id) || null,
    pessoal: ['CV-08', 'CV-19', 'CV-26', 'CV-27', 'CV-71', 'CV-72', 'CV-74'].includes(mod.id),
    sobre: `${mod.name}${mod.desc ? ': ' + String(mod.desc).slice(0, 240) : ''}. Operadores: ${ops.join(', ')}.`,
    estado: async () => {
      const p = estadoNos(ops);
      return { pipeline: p, ...(p.length ? {} : { aviso: 'Nenhum nó deste módulo no Pipeline.' }), metricas: metricas() };
    },
    config: async () => configNos(ops, { soPresentes: false }),
    aplicar: async (m) => aplicarNos(m),
  });
}

/** Normaliza o id pedido pela Via («CV-36», «BeltScan», «beltscan»). */
export function acharModulo(pedido) {
  const p = String(pedido || '').trim().toLowerCase();
  if (!p) return null;
  return moduloVia(p) || modulosVia().find((m) => m.nome.toLowerCase() === p) || null;
}
