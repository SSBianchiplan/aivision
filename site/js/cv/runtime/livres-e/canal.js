/**
 * cv/runtime/livres-e/canal.js — ponte entre o operador Bike Fit e o painel.
 *
 * O executor não expõe o ctx do quadro a ninguém fora da cadeia, então o
 * operador publica aqui um retrato do que mediu (a cada inferência) e o
 * painel assina. A SESSÃO (ciclos, registro, poses congeladas) também mora
 * aqui, e não no estado do nó: "Nova sessão" no painel precisa zerá-la, e
 * apagar/recriar o nó no Pipeline não deve jogar fora uma sessão gravada.
 */
import { Sessao, recomendacoes } from './bikefit.js';
import { calcularAlvos, lerAtletas, gravarAtletas, normalizarAtleta, atletaVazio } from './atleta.js';

const sessao = new Sessao();
const ouvintes = new Set();
let retrato = null;
let gravando = true;
let geracao = 0;
let timer = null;
let ultimoAviso = 0;

export function obterSessao() { return sessao; }
export function estaGravando() { return gravando; }
export function geracaoSessao() { return geracao; }
export function instantaneo() { return retrato; }

/** O operador chama a cada inferência; o painel é avisado no máximo a cada 250 ms. */
export function publicar(r) {
  retrato = r;
  guardarHistorico(r);
  avisar();
}

/**
 * Fonte parada (cv/runtime/parado.js): o operador não infere nem publica,
 * mas o painel e o Studio tratam retrato com mais de 3–4 s como "sem sinal"
 * e apagariam o esqueleto do quadro pausado. Renova só o relógio do retrato
 * (no máximo 1×/s) — sem amostra no histórico, sem evento de PMI/PMS.
 */
export function manterRetrato(t) {
  if (!retrato || retrato.sem || retrato.t == null || t - retrato.t < 1000) return;
  retrato = { ...retrato, t, eventos: [], parado: true };
}

/*
 * HISTÓRICO para o Studio Bike Fit (components/esportes/StudioBikeFit.js):
 * as curvas dos ângulos nos últimos HIST_MS e as marcas de PMI/PMS. Fica
 * aqui (e não no Studio) para a curva já existir quando o Studio abre.
 * Custo: um objeto pequeno por inferência, ~30 s de janela.
 * O retrato "sem ciclista" entra como amostra vazia: a curva se interrompe.
 */
const HIST_MS = 30000;          // 30 s: o "ciclo médio" do Studio dobra ~40 pedaladas
const historico = { amostras: [], marcas: [] };
let studio = false;

function guardarHistorico(r) {
  if (!r || r.t == null) return;
  const a = {};
  if (!r.sem) {
    const ang = r.ang || {};
    for (const k of ['joelho', 'quadril', 'tronco', 'ombro', 'cotovelo', 'tornozelo']) if (ang[k] != null) a[k] = ang[k];
    if (r.angPe != null) a.pe = r.angPe;
    const f = r.frontal;
    if (f) {
      if (f.e != null) a.desvioE = f.e;
      if (f.d != null) a.desvioD = f.d;
      if (f.pelve != null) a.pelve = f.pelve;
      if (f.ombros != null) a.ombros = f.ombros;
    }
  }
  const am = historico.amostras;
  if (am.length && r.t < am[am.length - 1].t) am.length = 0;   // relógio voltou (nova fonte)
  am.push({ t: r.t, a });
  for (const e of r.eventos || []) historico.marcas.push({ t: e.t, tipo: e.tipo });
  const corte = r.t - HIST_MS;
  while (am.length && am[0].t < corte) am.shift();
  while (historico.marcas.length && historico.marcas[0].t < corte) historico.marcas.shift();
}

/** { amostras: [{t, a: {joelho, quadril, ..., pe, desvioE, ...}}], marcas: [{t, tipo}] } — não alterar. */
export function obterHistorico() { return historico; }

/**
 * Studio aberto: o operador deixa de desenhar o próprio overlay, e o canvas
 * de exibição do app passa a ter só o vídeo nítido — é dele que o Studio
 * copia o quadro (ver StudioBikeFit.js).
 */
export function definirStudio(v) { studio = Boolean(v); }
export function studioAberto() { return studio; }

function avisar(ja = false) {
  if (ja) { ultimoAviso = performance.now(); for (const f of ouvintes) f(retrato); return; }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => {
    timer = null; ultimoAviso = performance.now();
    for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } }
  }, espera);
}

export function assinar(fn) {
  ouvintes.add(fn);
  return () => ouvintes.delete(fn);
}

export function zerarSessao() {
  sessao.zerar();
  historico.amostras.length = 0;
  historico.marcas.length = 0;
  geracao++;
  gravando = true;
  // o retrato não pode carregar o ciclista anterior (lado, ângulos, avisos, recomendações)
  if (retrato) {
    retrato = { ...retrato, cadencia: null, pedaladas: 0, resumo: null, recs: [], lado: null, ang: {}, avisos: [],
      frontal: null, kops: null, congelado: sessao.congelado };
  }
  avisar(true);
}

export function definirGravando(v) {
  gravando = Boolean(v);
  avisar(true);
}

/*
 * ATLETA E ALVOS DA SESSÃO — um conjunto só, lido pelo operador (recomendações,
 * overlay), pelo painel Bike Fit, pelo Studio (tabela, faixas dos gráficos,
 * selos) e pelo relatório/CSV/JSON. Regras e fontes em ./atleta.js.
 */
let atletas = lerAtletas();
let versaoAtleta = 0;
const cacheAlvos = new Map();

export function obterAtleta() { return atletas.lista.find((a) => a.id === atletas.ativo) || atletas.lista[0]; }
export function listaAtletas() { return atletas.lista.map((a) => ({ id: a.id, nome: a.nome })); }
export function versaoDoAtleta() { return versaoAtleta; }

const ouvintesAtleta = new Set();
/** Para a interface (painel, Studio): avisa a cada mudança do atleta ou dos alvos. */
export function assinarAtleta(fn) {
  ouvintesAtleta.add(fn);
  return () => ouvintesAtleta.delete(fn);
}

function mudouAtleta() {
  versaoAtleta++;
  cacheAlvos.clear();
  gravarAtletas(atletas);
  // as recomendações do último retrato foram calculadas com os alvos antigos:
  // refaz com os novos (o operador manda o contexto em recsCtx), sem esperar a
  // próxima inferência — com o vídeo pausado elas também mudam
  const c = retrato && retrato.recsCtx;
  if (c && sessao.ciclos.length) {
    try {
      const res = sessao.resumo(c.nCiclos || 10);
      retrato = { ...retrato, recs: recomendacoes(res, retrato.perfil, c.geo || {}, retrato.vista, { ...(c.est || {}), faixas: alvosSessao(retrato.perfil).faixas }) };
    } catch (_) { /* sessão zerando */ }
  }
  for (const f of ouvintesAtleta) { try { f(versaoAtleta); } catch (_) { /* desmontando */ } }
  avisar(true);
}
/** Altera campos do atleta ativo (parcial). */
export function atualizarAtleta(campos) {
  atletas = { ...atletas, lista: atletas.lista.map((a) => (a.id === atletas.ativo ? normalizarAtleta({ ...a, ...campos }) : a)) };
  mudouAtleta();
}
export function trocarAtleta(id) {
  if (!atletas.lista.some((a) => a.id === id)) return;
  atletas = { ...atletas, ativo: id };
  mudouAtleta();
}
export function novoAtleta(nome = 'Novo atleta') {
  const a = atletaVazio(nome);
  atletas = { ativo: a.id, lista: [...atletas.lista, a] };
  mudouAtleta();
  return a.id;
}
export function removerAtleta(id) {
  if (atletas.lista.length <= 1) return;
  const lista = atletas.lista.filter((a) => a.id !== id);
  atletas = { ativo: atletas.ativo === id ? lista[0].id : atletas.ativo, lista };
  mudouAtleta();
}
/** Faixa definida à mão para uma chave na modalidade (null = voltar ao calculado). */
export function definirOverride(perfilNome, chave, faixa) {
  const a = obterAtleta();
  const ov = { ...(a.overrides || {}) };
  const m = { ...(ov[perfilNome] || {}) };
  if (faixa) m[chave] = [Number(faixa[0]), Number(faixa[1])]; else delete m[chave];
  ov[perfilNome] = m;
  atualizarAtleta({ overrides: ov });
}
/** Alvos do atleta ativo para a modalidade: { faixas (formato de PERFIS), linhas, regras, ... }. */
export function alvosSessao(perfilNome) {
  const k = perfilNome || 'Estrada';
  let r = cacheAlvos.get(k);
  if (!r) { r = calcularAlvos(k, obterAtleta()); cacheAlvos.set(k, r); }
  return r;
}
