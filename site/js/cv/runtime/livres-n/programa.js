/**
 * cv/runtime/livres-n/programa.js — o PROGRAMA de inspeção (a receita), porte
 * de domain/program.py do GPlanSiS|Inspect. JS puro, sem DOM.
 *
 * Programa = conjunto nomeado e VERSIONADO de ferramentas (com ROI, limites e
 * tolerâncias) + gatilho + alinhamento + px/mm. Cada "Salvar" grava uma nova
 * versão (o histórico guarda as 10 anteriores, para voltar). As ferramentas
 * usam os nomes e os campos do Inspect (`type`, `code`, `roi`, `critical`,
 * `band`, `count_min`…), então o JSON exportado no formato "inspect" é um
 * ProgramSpec que o Inspect valida; e um ProgramSpec do Inspect importa aqui
 * direto. O que é só daqui:
 *
 *   tool.marcacao   id da marcação das Ferramentas de mouse que dá a ROI (função
 *                   "Inspect · <ferramenta>"); sem ela vale `roi` (px) ou a imagem inteira
 *   tool.ativo      false = guardada mas fora da inspeção (tipo sem porte)
 *   tool.folga      presença: a região de busca = a caixa do molde + folga·tamanho
 *   tool.modelo     detect/classify/anomaly: o modelo DAQUI ('yolox', 'rfdetr-nano',
 *                   'mobilenetv2', 'livre:<id>' do Treinar…); o `model_id` (inteiro do
 *                   registro do Inspect) vai e volta intacto no export/import
 *   tool.source     serial: 'ocr' (padrão, como o Inspect) ou 'code'
 *   tool.gtin_check code sem GS1: o conteúdo (EAN/UPC) é o GTIN — DV e expect_gtin
 *   tool.alpha, tool.calib_amostras  classify: α do conformal e as amostras rotuladas
 *                   (logits) com que o editor calibra T e q̂ (tool.calibration vai no export)
 *   lote            lote da ordem/turno ({LOT} do ocr; lote do GS1 AI 10) — no Inspect vem
 *                   da troca de produto da estação
 *   prazo_modelos_s quanto o veredito espera as ferramentas com modelo (estourou = INCERTO)
 *   imagem {w,h}    resolução em que as ROIs em px foram definidas (reescala se mudar)
 *   trigger         o gatilho (mesmas chaves do `trigger` de câmera do Inspect)
 *   golden          peça de referência (cinza reduzido) para o alinhamento
 *   assets          moldes da presença (cinza), por template_key
 *   alarme          NOK seguidos e % de INCERTO que disparam alarme
 *
 * Alinhamento: o Inspect usa homografia ORB (ou correlação de fase). Aqui é
 * TRANSLAÇÃO por NCC em pirâmide contra a golden (ver canal.js): ORB +
 * RANSAC em JS puro ficaria pesado e frágil; peça que gira na esteira pede o
 * Inspect no servidor — documentado.
 */
import { FERRAMENTAS, PENDENTES, FAIXAS_HSV } from './ferramentas.js';
import { regexPy } from './marcacao.js';

export const FORMATO = 'gplansis.inspect.programa';
const CODIGO_OK = /^[A-Z0-9_]{2,24}$/;

const agora = () => new Date().toISOString();
const clonar = (o) => JSON.parse(JSON.stringify(o));
let seq = 0;
export const novoId = () => 'pg' + Date.now().toString(36) + (++seq).toString(36);

export const GATILHO_PADRAO = {
  mode: 'presence', roi: null, marcacao: null,
  on_ratio: 0.08, off_ratio: 0.03, diff_thr: 25, stable_frames: 3, motion_max: 0.02, learn_rate: 0.05,
  direction: 1, min_pixels: 150, seconds: 2,
};

/** Programa vazio, já com os campos todos. */
export function programaVazio(nome = 'Novo programa') {
  return {
    formato: FORMATO, versao_formato: 1,
    id: novoId(), codigo: 'P-NOVO', nome, produto: '', versao: 0, criado_em: agora(), alterado_em: agora(), autor: '',
    historico: [], imagem: null, px_per_mm: null,
    alignment: { enabled: false, method: 'ncc_translation', min_score: 0.5, max_shift: 0.15 },
    golden: null, trigger: { ...GATILHO_PADRAO }, tools: [], assets: {},
    alarme: { nok_seguidos: 3, incerto_pct: 25 }, lote: '', prazo_modelos_s: 20,
  };
}

/** Ferramenta nova do tipo `tipo`, com código único no programa. */
export function novaFerramenta(prog, tipo) {
  const def = FERRAMENTAS[tipo];
  const t = clonar(def.esqueleto);
  let base = t.code, n = 1;
  while (prog.tools.some((x) => x.code === t.code)) t.code = `${base.slice(0, 21)}_${++n}`;
  if (tipo === 'presence') t.template_key = t.code;
  t.roi = null; t.marcacao = null; t.ativo = true; t.critical = true; t.band = 0.05;
  return t;
}

// ------------------------------------------------------------------ modelos prontos

/** Os três modelos dos presets do grupo Industrial; as ROIs vêm das marcações (funções Inspect · …). */
export const MODELOS = {
  presenca: {
    nome: 'Presença e contagem', codigo: 'P-PRESENCA',
    tools: [
      { type: 'presence', code: 'PRESENCA', name: 'Peça/componente presente', template_key: 'PRESENCA', min_score: 0.8, folga: 0.25 },
      { type: 'blob_count', code: 'FUROS', name: 'Furos', polarity: 'dark', threshold: null, min_area: 30, max_area: 20000, count_min: 4, count_max: 4 },
    ],
  },
  dimensional: {
    nome: 'Dimensional (paquímetro)', codigo: 'P-DIMENSIONAL',
    tools: [
      { type: 'caliper', code: 'LARGURA', name: 'Largura', p0: [0, 0], p1: [0, 0], width: 9, edge_min_contrast: 20, nominal_mm: 50, tol_mm: 0.5 },
      { type: 'shape', code: 'FORMA', name: 'Forma', polarity: 'auto', min_area_px: 500, eq_diam_mm: null, circularity_min: null, solidity_min: 0.95, critical: false },
    ],
  },
  cor_defeito: {
    nome: 'Cor e defeito', codigo: 'P-COR-DEFEITO',
    tools: [
      { type: 'color', code: 'COR', name: 'Cor', ref_lab: [50, 0, 0], max_delta_e: 3 },
      { type: 'defect_area', code: 'MANCHA', name: 'Manchas/queimado', ranges: [FAIXAS_HSV.queimado], within_object: true, max_pct: 2, min_spot_px: 20, max_spots: null },
    ],
  },
};

/** Exemplos do Inspect (programas de demonstração, mesma resolução das imagens de lá). */
export const EXEMPLOS_INSPECT = {
  'P-BISC55': {
    nome: 'Biscoito 55 mm — forma, tostado, corpo estranho', imagem: { w: 600, h: 600 },
    spec: { px_per_mm: 4.0, alignment: { enabled: false }, tools: [
      { type: 'shape', code: 'FORMA', name: 'Diâmetro e quebra', eq_diam_mm: [55, 3], circularity_min: 0.85, solidity_min: 0.95 },
      { type: 'color', code: 'TOSTADO', name: 'Cor de forneamento', roi: { x: 250, y: 250, w: 100, h: 100 }, ref_lab: [62, 12, 38], max_delta_e: 6 },
      { type: 'defect_area', code: 'QUEIMADO', name: 'Área queimada', ranges: [{ name: 'queimado', v: [0, 55] }], max_pct: 4, min_spot_px: 20 },
      { type: 'defect_area', code: 'CORPO', name: 'Corpo estranho azul/metálico', ranges: [{ name: 'azul', h: [95, 130], s: [80, 255], v: [60, 255] }, { name: 'metal', s: [0, 25], v: [170, 255] }], max_pct: 0.5, max_spots: 0, min_spot_px: 8 },
      { type: 'blob_count', code: 'GOTAS', name: 'Gotas de chocolate', polarity: 'dark', min_area: 40, max_area: 900, count_min: 5, count_max: 14, critical: false },
    ] },
  },
  'P-TAMPA38': {
    nome: 'Tampa 38 mm com lacre', imagem: { w: 640, h: 640 },
    spec: { px_per_mm: 12.5, alignment: { enabled: false }, tools: [
      { type: 'caliper', code: 'DIAM', name: 'Diâmetro externo', p0: [40, 300], p1: [560, 300], nominal_mm: 38.0, tol_mm: 0.25 },
      { type: 'blob_count', code: 'PONTES', name: 'Pontes do lacre', roi: { x: 40, y: 520, w: 520, h: 60 }, polarity: 'dark', min_area: 30, max_area: 900, count_min: 12, count_max: 12 },
      { type: 'color', code: 'COR', name: 'Cor Pantone 286', roi: { x: 250, y: 120, w: 100, h: 60 }, ref_lab: [30.2, 23.8, -57.6], max_delta_e: 3.0 },
      { type: 'ocr', code: 'LOTE', name: 'Lote impresso', roi: { x: 180, y: 260, w: 240, h: 40 }, field: 'lot', expected: '{LOT}', min_char_conf: 0.85 },
      { type: 'ocr', code: 'VALID', name: 'Validade', roi: { x: 180, y: 310, w: 240, h: 40 }, field: 'date', date_format: '%d/%m/%Y', min_days_valid: 180 },
      { type: 'code', code: 'DMX', name: 'DataMatrix GS1', roi: { x: 430, y: 380, w: 120, h: 120 }, formats: ['DataMatrix'], gs1: true, expect_gtin: '07891234567895' },
    ] },
  },
  'P-ROTULO-LOTE': {
    nome: 'Rótulo — lote, validade, DataMatrix GS1 e EAN-13', imagem: { w: 800, h: 500 }, lote: 'A12',
    spec: { px_per_mm: null, alignment: { enabled: false }, tools: [
      { type: 'ocr', code: 'LOTE', name: 'Lote impresso = L + lote da ordem', roi: { x: 30, y: 50, w: 380, h: 80 }, field: 'lot', expected: 'L{LOT}', min_char_conf: 0.8 },
      { type: 'ocr', code: 'VALIDADE', name: 'Validade ≥ hoje + 180 dias', roi: { x: 30, y: 150, w: 380, h: 80 }, field: 'date', date_format: '%d/%m/%Y', min_days_valid: 180, min_char_conf: 0.8 },
      { type: 'code', code: 'DMX', name: 'DataMatrix GS1 (GTIN e lote)', roi: { x: 520, y: 40, w: 240, h: 240 }, formats: ['DataMatrix', 'QRCode'], gs1: true, expect_gtin: '07891234567895' },
      { type: 'code', code: 'EAN', name: 'EAN-13 do produto', roi: { x: 30, y: 290, w: 460, h: 180 }, formats: ['EAN13'], gtin_check: true, expect_gtin: '7891234567895', critical: false },
    ] },
  },
  'P-ANOMALIA': {
    nome: 'Arruela — anomalia (PatchCore treinado com as BOAS)', imagem: { w: 360, h: 360 },
    spec: { px_per_mm: null, alignment: { enabled: false }, tools: [
      { type: 'anomaly', code: 'ANOMALIA', name: 'Anomalia (risco, mancha, furo)', modelo: '', threshold: null, band: 0.05 },
      { type: 'shape', code: 'FORMA', name: 'Arruela redonda', polarity: 'auto', min_area_px: 2000, circularity_min: 0.8, critical: false },
    ] },
  },
};

/** Programa a partir de um modelo (presets) ou de um exemplo do Inspect. */
export function deModelo(chave) {
  const m = MODELOS[chave];
  if (m) {
    const p = programaVazio(m.nome);
    p.codigo = m.codigo;
    p.tools = m.tools.map((t) => normalizarFerramenta({ ...clonar(t), marcacao: null, ativo: true }));
    p.modelo = chave;
    return p;
  }
  const e = EXEMPLOS_INSPECT[chave];
  if (!e) throw new Error('modelo desconhecido: ' + chave);
  const p = deInspect(clonar(e.spec), { nome: e.nome, codigo: chave });
  p.imagem = clonar(e.imagem);
  if (e.lote) p.lote = e.lote;
  return p;
}

// ------------------------------------------------------------------ normalização e validação

const nn = (v, d) => (v == null || v === '' || !Number.isFinite(+v) ? d : +v);
const roiOk = (r) => (r && Number.isFinite(+r.x) && Number.isFinite(+r.y) && +r.w > 0 && +r.h > 0
  ? { x: Math.max(0, Math.round(+r.x)), y: Math.max(0, Math.round(+r.y)), w: Math.round(+r.w), h: Math.round(+r.h) } : null);

/** Normaliza uma ferramenta (defaults do Inspect nos campos ausentes). */
export function normalizarFerramenta(t) {
  const o = { ...t };
  o.code = String(o.code || 'T').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 24);
  o.name = String(o.name || o.code).slice(0, 80);
  o.critical = o.critical !== false;
  o.band = Math.min(0.5, Math.max(0, nn(o.band, 0.05)));
  o.roi = roiOk(o.roi);
  o.marcacao = o.marcacao || null;
  o.ativo = FERRAMENTAS[o.type] ? o.ativo !== false : false;
  if (o.type === 'presence') { o.template_key = String(o.template_key || o.code); o.min_score = nn(o.min_score, 0.8); o.folga = nn(o.folga, 0.25); }
  if (o.type === 'blob_count') {
    o.polarity = o.polarity === 'light' ? 'light' : 'dark';
    o.threshold = o.threshold == null || o.threshold === '' ? null : Math.min(255, Math.max(0, Math.round(+o.threshold)));
    o.min_area = Math.max(1, Math.round(nn(o.min_area, 20))); o.max_area = Math.max(1, Math.round(nn(o.max_area, 100000)));
    o.count_min = Math.max(0, Math.round(nn(o.count_min, 0))); o.count_max = Math.max(0, Math.round(nn(o.count_max, 0)));
  }
  if (o.type === 'caliper') {
    o.p0 = Array.isArray(o.p0) ? o.p0.map((v) => nn(v, 0)) : [0, 0]; o.p1 = Array.isArray(o.p1) ? o.p1.map((v) => nn(v, 0)) : [0, 0];
    o.width = Math.min(101, Math.max(1, Math.round(nn(o.width, 9)))); o.edge_min_contrast = Math.max(0.1, nn(o.edge_min_contrast, 20));
    o.nominal_mm = nn(o.nominal_mm, 10); o.tol_mm = nn(o.tol_mm, 0.1);
  }
  if (o.type === 'color') { o.ref_lab = (Array.isArray(o.ref_lab) ? o.ref_lab : [50, 0, 0]).slice(0, 3).map((v) => nn(v, 0)); o.max_delta_e = nn(o.max_delta_e, 3); }
  if (o.type === 'shape') {
    o.polarity = ['dark', 'light', 'auto'].includes(o.polarity) ? o.polarity : 'auto';
    o.min_area_px = Math.max(1, Math.round(nn(o.min_area_px, 500)));
    for (const k of ['eq_diam_mm', 'area_mm2', 'aspect_range']) o[k] = Array.isArray(o[k]) && o[k].length === 2 ? o[k].map(Number) : null;
    for (const k of ['circularity_min', 'solidity_min']) o[k] = o[k] == null || o[k] === '' ? null : Math.min(1, Math.max(0, +o[k]));
  }
  if (o.type === 'defect_area') {
    o.ranges = (Array.isArray(o.ranges) && o.ranges.length ? o.ranges : [FAIXAS_HSV.queimado]).map((r) => ({
      name: String(r.name || 'faixa'), h: (r.h || [0, 179]).map(Number), s: (r.s || [0, 255]).map(Number), v: (r.v || [0, 255]).map(Number),
    }));
    o.within_object = o.within_object !== false; o.max_pct = nn(o.max_pct, 5); o.min_spot_px = Math.max(1, Math.round(nn(o.min_spot_px, 12)));
    o.max_spots = o.max_spots == null || o.max_spots === '' ? null : Math.max(0, Math.round(+o.max_spots));
  }
  const txt = (v) => (v == null || v === '' ? null : String(v));
  if (o.type === 'ocr') {
    o.field = ['free', 'digits', 'alnum', 'date', 'lot'].includes(o.field) ? o.field : 'free';
    o.pattern = txt(o.pattern); o.expected = txt(o.expected);
    o.date_format = String(o.date_format || '%d/%m/%Y');
    o.min_char_conf = Math.min(1, Math.max(0, nn(o.min_char_conf, 0.8)));
    o.min_days_valid = o.min_days_valid == null || o.min_days_valid === '' ? null : Math.round(+o.min_days_valid);
  }
  if (o.type === 'code') {
    o.formats = Array.isArray(o.formats) ? o.formats.map(String) : ['QRCode', 'DataMatrix', 'Code128', 'EAN13'];
    o.pattern = txt(o.pattern); o.gs1 = Boolean(o.gs1); o.expect_gtin = txt(o.expect_gtin);
    if (o.expected != null) o.expected = txt(o.expected);
    if (o.gtin_check != null) o.gtin_check = Boolean(o.gtin_check);
  }
  if (o.type === 'serial') {
    o.pattern = String(o.pattern || '(?P<n>\\d+)');
    o.min_char_conf = Math.min(1, Math.max(0, nn(o.min_char_conf, 0.85)));
    o.check_sequence = o.check_sequence !== false; o.max_gap = Math.max(1, Math.round(nn(o.max_gap, 1)));
    o.source = o.source === 'code' ? 'code' : 'ocr';
  }
  if (o.type === 'detect' || o.type === 'classify' || o.type === 'anomaly') {
    o.model_id = Number.isInteger(+o.model_id) && o.model_id !== '' && o.model_id != null ? +o.model_id : 0;
    if (o.modelo == null) o.modelo = o.type === 'detect' ? 'yolox' : o.type === 'classify' ? 'mobilenetv2' : '';
    o.modelo = String(o.modelo);
  }
  if (o.type === 'detect') {
    o.conf = Math.min(1, Math.max(0, nn(o.conf, 0.35)));
    const req = {};
    for (const [k, v] of Object.entries(o.require && typeof o.require === 'object' ? o.require : {})) {
      if (Array.isArray(v) && v.length === 2) req[String(k)] = [Math.max(0, Math.round(+v[0] || 0)), Math.max(0, Math.round(+v[1] || 0))];
    }
    o.require = req; o.forbid = Array.isArray(o.forbid) ? o.forbid.map(String) : [];
  }
  if (o.type === 'classify') {
    o.ok_labels = Array.isArray(o.ok_labels) && o.ok_labels.length ? o.ok_labels.map(String) : ['ok'];
    o.alpha = Math.min(0.5, Math.max(0.001, nn(o.alpha, 0.1)));
    o.calibration = o.calibration && typeof o.calibration === 'object' ? o.calibration : null;
    o.calib_amostras = Array.isArray(o.calib_amostras) ? o.calib_amostras.slice(-60) : [];
  }
  if (o.type === 'anomaly') o.threshold = o.threshold == null || o.threshold === '' ? null : Math.min(1, Math.max(0, +o.threshold));
  return o;
}

/** O padrão (regex do Python) compila aqui? */
function regexValida(p) {
  try { regexPy(p); return true; } catch (_) { return false; }
}

/** Programa vindo do disco ou de um JSON: completa e corrige. */
export function normalizarPrograma(p) {
  const b = programaVazio(p && p.nome);
  const o = { ...b, ...(p || {}) };
  o.formato = FORMATO;
  o.id = String(o.id || novoId());
  o.versao = Math.max(0, Math.round(nn(o.versao, 0)));
  o.historico = Array.isArray(o.historico) ? o.historico.slice(0, 10) : [];
  o.imagem = o.imagem && +o.imagem.w > 0 && +o.imagem.h > 0 ? { w: +o.imagem.w, h: +o.imagem.h } : null;
  o.px_per_mm = o.px_per_mm == null || o.px_per_mm === '' || !(+o.px_per_mm > 0) ? null : +o.px_per_mm;
  o.alignment = { ...b.alignment, ...(o.alignment || {}) };
  o.trigger = { ...GATILHO_PADRAO, ...(o.trigger || {}) };
  o.tools = (Array.isArray(o.tools) ? o.tools : []).filter((t) => t && t.type).map(normalizarFerramenta);
  o.assets = o.assets && typeof o.assets === 'object' ? o.assets : {};
  o.alarme = { ...b.alarme, ...(o.alarme || {}) };
  o.lote = String(o.lote || '').trim().toUpperCase().slice(0, 40);
  o.prazo_modelos_s = Math.min(120, Math.max(1, nn(o.prazo_modelos_s, 20)));
  return o;
}

/**
 * Validação (as regras do ProgramSpec do Inspect). Devolve { erros, avisos }:
 * erro impede salvar; aviso não (ex.: mm sem px/mm fixo — a régua das
 * Ferramentas de mouse pode calibrar na hora).
 */
export function validar(p) {
  const erros = [], avisos = [];
  const ativos = p.tools.filter((t) => t.ativo);
  if (!p.tools.length) erros.push('programa sem ferramentas');
  else if (!ativos.length) erros.push('nenhuma ferramenta ativa');
  const codigos = p.tools.map((t) => t.code);
  if (new Set(codigos).size !== codigos.length) erros.push('códigos de ferramenta repetidos');
  for (const t of p.tools) {
    if (!CODIGO_OK.test(t.code)) erros.push(`${t.code}: código deve ter 2–24 letras maiúsculas, dígitos ou _`);
    if (!FERRAMENTAS[t.type]) avisos.push(`${t.code}: ${PENDENTES[t.type] || t.type} — tipo sem porte aqui; fica guardada, desativada`);
    if (t.type === 'blob_count' && (t.count_min > t.count_max || t.min_area > t.max_area)) erros.push(`${t.code}: faixa inválida`);
    if (t.type === 'caliper' && !(t.tol_mm > 0 && t.nominal_mm > 0)) erros.push(`${t.code}: nominal e tolerância devem ser > 0`);
    if (t.type === 'presence' && t.ativo && !p.assets[t.template_key]) avisos.push(`${t.code}: molde ainda não capturado (Capturar molde)`);
    if (t.type === 'shape' && t.aspect_range && t.aspect_range[0] > t.aspect_range[1]) erros.push(`${t.code}: alongamento mín > máx`);
    if ((t.type === 'ocr' || t.type === 'code' || t.type === 'serial') && t.pattern && !regexValida(t.pattern)) erros.push(`${t.code}: padrão (regex) inválido`);
    if (t.type === 'serial' && !/\(\?P<n>/.test(t.pattern)) avisos.push(`${t.code}: sem o grupo (?P<n>\\d+) não há controle de sequência (NOK "parte numérica ausente")`);
    if (t.type === 'ocr' && t.expected && t.expected.includes('{LOT}') && !p.lote) avisos.push(`${t.code}: esperado usa {LOT} e o programa está sem lote da ordem`);
    if (t.type === 'detect' && Object.entries(t.require).some(([, v]) => v[0] > v[1])) erros.push(`${t.code}: contagem mín > máx`);
    if (t.type === 'detect' && !Object.keys(t.require).length && !t.forbid.length) avisos.push(`${t.code}: sem classe exigida nem proibida, sempre OK`);
    if (t.type === 'code' && t.expect_gtin && !t.gs1 && !t.gtin_check) avisos.push(`${t.code}: GTIN esperado só vale com GS1 ou "conteúdo é o GTIN"`);
    if (t.type === 'classify' && !(t.calibration && t.calibration.qhat != null)) avisos.push(`${t.code}: sem calibração — T = 1 e q̂ = 0,9 (o padrão do Inspect); calibre com amostras`);
    if (t.model_id && (t.type === 'detect' || t.type === 'classify' || t.type === 'anomaly')) avisos.push(`${t.code}: model_id ${t.model_id} é do registro do Inspect — aqui vale o modelo escolhido`);
  }
  if (p.tools.filter((t) => t.type === 'serial').length > 1) erros.push('no máximo uma ferramenta serial por programa');
  const mm = ativos.some((t) => FERRAMENTAS[t.type] && (FERRAMENTAS[t.type].mm || (FERRAMENTAS[t.type].mmSe && FERRAMENTAS[t.type].mmSe(t))));
  if (mm && p.px_per_mm == null) avisos.push('medida em mm sem px/mm no programa: vale a calibração da régua (Ferramentas de mouse)');
  if (p.alignment.enabled && !p.golden) avisos.push('alinhamento ligado sem peça de referência (Capturar golden)');
  return { erros, avisos };
}

// ------------------------------------------------------------------ versão e impressão

/** Impressão do conteúdo (FNV-1a 64 bits em hex) — o Inspect usa sha256 no servidor. */
export function impressao(p) {
  const s = JSON.stringify({ tools: p.tools, trigger: p.trigger, alignment: p.alignment, px_per_mm: p.px_per_mm, imagem: p.imagem });
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Nova versão: guarda a anterior no histórico (10) e sobe o número. */
export function novaVersao(p, { autor = '', nota = '' } = {}) {
  const o = normalizarPrograma(p);
  if (o.versao > 0) {
    const anterior = clonar({ ...p, historico: undefined, assets: undefined, golden: undefined });
    // as amostras de calibração (logits) não vão para o histórico: só a calibração resultante
    for (const t of anterior.tools || []) delete t.calib_amostras;
    o.historico = [{ versao: p.versao, em: p.alterado_em, autor: p.autor, nota: p.nota || '', impressao: p.impressao, spec: anterior }, ...o.historico].slice(0, 10);
  }
  o.versao += 1;
  o.alterado_em = agora();
  o.autor = autor;
  o.nota = nota;
  o.impressao = impressao(o);
  return o;
}

/** Volta a uma versão do histórico (vira uma versão NOVA, como no Inspect: nada é apagado). */
export function restaurarVersao(p, versao, autor = '') {
  const h = p.historico.find((x) => x.versao === versao);
  if (!h) throw new Error('versão não encontrada');
  const base = { ...normalizarPrograma(h.spec), id: p.id, versao: p.versao, historico: p.historico, assets: p.assets, golden: p.golden };
  return novaVersao(base, { autor, nota: `restaurada da v${versao}` });
}

/** Cópia com outro id e nome (versão zerada). */
export function duplicar(p) {
  const o = normalizarPrograma(clonar(p));
  o.id = novoId(); o.nome = `${p.nome} (cópia)`; o.versao = 0; o.historico = []; o.criado_em = agora();
  return novaVersao(o, { nota: `duplicado de ${p.codigo} v${p.versao}` });
}

// ------------------------------------------------------------------ Inspect ⇄ iaVision

const SO_DAQUI = ['marcacao', 'ativo', 'folga', 'modelo', 'source', 'gtin_check', 'alpha', 'calib_amostras'];

/** ProgramSpec do Inspect (o `spec` de uma ProgramVersion) → programa daqui. */
export function deInspect(spec, { nome = 'Programa importado do Inspect', codigo = 'P-INSPECT' } = {}) {
  const p = programaVazio(nome);
  p.codigo = codigo;
  p.px_per_mm = spec.px_per_mm == null ? null : +spec.px_per_mm;
  const al = spec.alignment || {};
  // como no Inspect: ligado por padrão, mas sem golden não faz nada (passa direto)
  p.alignment = { ...p.alignment, enabled: al.enabled !== false, method: 'ncc_translation', origem: al.method || null };
  p.tools = (spec.tools || []).map((t) => normalizarFerramenta({ ...t, ativo: Boolean(FERRAMENTAS[t.type]) }));
  if (spec.assets_inline) p.assets = clonar(spec.assets_inline);
  if (spec.trigger) p.trigger = { ...GATILHO_PADRAO, ...spec.trigger };
  return p;
}

/**
 * Programa daqui → ProgramSpec do Inspect. As ROIs ligadas a marcações vão
 * com a última caixa resolvida (`roi`/`p0`/`p1` em px da imagem de
 * referência); os moldes vão em `assets_inline` (o Inspect guarda os seus no
 * armazenamento de objetos e ignora este campo extra… na validação estrita do
 * pydantic, remova-o antes de publicar lá).
 */
export function paraInspect(p, { comAssets = true } = {}) {
  const tools = p.tools.map((t) => {
    const o = {};
    for (const [k, v] of Object.entries(t)) if (!SO_DAQUI.includes(k) && v !== null && v !== undefined) o[k] = v;
    if (t.type !== 'caliper' && !t.roi) delete o.roi;
    return o;
  });
  const spec = {
    px_per_mm: p.px_per_mm,
    alignment: { enabled: Boolean(p.alignment.enabled), method: 'ncc_translation', min_inliers: 25 },
    tools,
  };
  if (comAssets && Object.keys(p.assets || {}).length) spec.assets_inline = clonar(p.assets);
  return spec;
}

/** Exporta como texto JSON: 'gplansis' (completo) ou 'inspect' (ProgramSpec). */
export function exportarTexto(p, formato = 'gplansis') {
  if (formato === 'inspect') return JSON.stringify({ code: p.codigo, name: p.nome, version: p.versao, spec: paraInspect(p) }, null, 2);
  return JSON.stringify(p, null, 2);
}

/** Importa um JSON: programa daqui, ProgramSpec do Inspect, ou {code, name, spec} (ProgramVersion). */
export function importarTexto(texto) {
  const o = JSON.parse(texto);
  if (o && o.formato === FORMATO) {
    const p = normalizarPrograma(o);
    p.id = novoId();
    return p;
  }
  const spec = o && o.spec && Array.isArray(o.spec.tools) ? o.spec : o && Array.isArray(o.tools) ? o : null;
  if (!spec) throw new Error('JSON sem "tools": não é um programa do iaVision nem um ProgramSpec do Inspect');
  const p = deInspect(spec, { nome: (o.name || o.nome || 'Programa importado do Inspect'), codigo: String(o.code || o.codigo || 'P-INSPECT').slice(0, 40) });
  return novaVersao(p, { nota: 'importado do Inspect' });
}

// ------------------------------------------------------------------ cinza ⇄ base64 (moldes, golden)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Uint8Array → base64 (sem btoa, para rodar no Node também). */
export function paraB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i], b = i + 1 < u8.length ? u8[i + 1] : 0, c = i + 2 < u8.length ? u8[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < u8.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < u8.length ? B64[n & 63] : '=');
  }
  return s;
}
const INV = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) INV[B64.charCodeAt(i)] = i;
export function deB64(s) {
  const lim = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((lim.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < lim.length; i += 4) {
    const n = (INV[lim.charCodeAt(i)] << 18) | (INV[lim.charCodeAt(i + 1)] << 12) | ((INV[lim.charCodeAt(i + 2)] & 63) << 6) | (INV[lim.charCodeAt(i + 3)] & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
