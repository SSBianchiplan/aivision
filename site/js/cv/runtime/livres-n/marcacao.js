/**
 * cv/runtime/livres-n/marcacao.js — a parte DETERMINÍSTICA das ferramentas de
 * marcação do CV-40 (porte de ocr/postprocess.py e vision/tools/marking.py do
 * GPlanSiS|Inspect). JS puro, sem DOM e sem modelo: recebe as linhas lidas pelo
 * OCR ou os códigos lidos pelo ZXing e decide OK/NOK/INCERTO exatamente como o
 * Inspect decide. A leitura em si (PP-OCRv5, ZXing/BarcodeDetector) mora em
 * modelos.js; aqui fica o que dá para testar contra o Python sem modelo.
 *
 *   normalizar(texto, campo)     normalize(): confusões O→0, I→1, S→5… por campo
 *   expandirEsperado(exp, lote)  expand_expected(): {LOT}, {TODAY}, {TODAY:+N|%d/%m/%y}
 *   lerData(texto, formato)      parse_date(): strptime no formato e nos reservas
 *   gs1(texto)                   gs1_parse(): AIs fixos e variáveis (GS/FNC1) ou HRI "(01)…"
 *   gtinOk(gtin)                 gtin_check_ok(): dígito verificador GTIN-8/12/13/14
 *   statusSequencia(n, ult, gap) sequence_status(): serial igual = NOK, fora de ordem ou
 *                                salto = INCERTO
 *   julgarOcr / julgarCodigo / julgarSerial   as decisões das ferramentas ocr, code, serial
 *
 * Diferenças de propósito (documentadas em docs/industrial.md §12):
 *   - regex do Python → JS: (?P<n>…) vira (?<n>…) e (?P=n) vira \k<n>;
 *   - "hoje" é a data local do navegador (o Inspect usa o fuso da planta);
 *   - code: dois ou mais códigos DIFERENTES dos formatos aceitos na ROI = INCERTO
 *     ("ambíguo"; o Inspect pega o primeiro) e o texto cru do ZXing/BarcodeDetector
 *     com FNC1 (\x1d, "]d2", "]C1", "]Q3") é limpo antes do gs1;
 *   - serial: também pode vir de um código (source: 'code', confiança 1).
 */
import { PASS, FAIL, UNCERTAIN, resultado } from './veredito.js';

// ------------------------------------------------------------------ normalize

/** Confusões típicas de impressão matricial / jato de tinta (TO_DIGIT do Inspect). */
const PARA_DIGITO = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', Z: '2', S: '5', s: '5', B: '8', G: '6', T: '7' };
const traduzir = (t, mapa) => Array.from(t, (c) => (Object.prototype.hasOwnProperty.call(mapa, c) ? mapa[c] : c)).join('');

/** normalize(text, field) do Inspect. */
export function normalizar(texto, campo) {
  const t = String(texto ?? '').trim().replace(/\s+/gu, ' ');
  if (campo === 'digits') return traduzir(t, PARA_DIGITO).replace(/\D/g, '');
  if (campo === 'date') return traduzir(t, PARA_DIGITO).replace(/[^\d/.\-]/g, '').replace(/\./g, '/').replace(/-/g, '/');
  if (campo === 'alnum' || campo === 'lot') return t.toUpperCase().replace(/[^A-Z0-9\-]/g, '');
  return t;
}

// ------------------------------------------------------------------ datas (strftime / strptime do Python, locale C)

const MESES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DIAS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const p2 = (n) => String(n).padStart(2, '0');

/** Data "civil" (sem hora, sem fuso): { y, m (1–12), d }. */
export const dataCivil = (y, m, d) => ({ y, m, d });
export function hojeLocal(agora = new Date()) { return dataCivil(agora.getFullYear(), agora.getMonth() + 1, agora.getDate()); }
const paraUTC = (c) => Date.UTC(c.y, c.m - 1, c.d);
const deUTC = (ms) => { const t = new Date(ms); return dataCivil(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
export const somarDias = (c, n) => deUTC(paraUTC(c) + n * 86400000);
/** (a − b) em dias, como (date − date).days. */
export const diasEntre = (a, b) => Math.round((paraUTC(a) - paraUTC(b)) / 86400000);
const diaDoAno = (c) => diasEntre(c, dataCivil(c.y, 1, 1)) + 1;
const diaSemana = (c) => (new Date(paraUTC(c)).getUTCDay() + 6) % 7;   // 0 = segunda, como o Python

/** date.strftime(fmt) para as diretivas de data (locale C). Diretiva desconhecida passa como está. */
export function strftime(c, fmt) {
  return String(fmt).replace(/%([a-zA-Z%])/g, (m, k) => {
    switch (k) {
      case 'd': return p2(c.d);
      case 'm': return p2(c.m);
      case 'Y': return String(c.y).padStart(4, '0');
      case 'y': return p2(c.y % 100);
      case 'j': return String(diaDoAno(c)).padStart(3, '0');
      case 'b': return MESES[c.m - 1].slice(0, 3);
      case 'B': return MESES[c.m - 1];
      case 'a': return DIAS[diaSemana(c)].slice(0, 3);
      case 'A': return DIAS[diaSemana(c)];
      case 'u': return String(diaSemana(c) + 1);
      case 'w': return String((diaSemana(c) + 1) % 7);
      case 'H': case 'M': case 'S': return '00';
      case '%': return '%';
      default: return m;
    }
  });
}

/** Regex de cada diretiva, as mesmas do _strptime.TimeRE do CPython. */
const RE_DIRETIVA = {
  d: '(?<d>3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])',
  m: '(?<m>1[0-2]|0[1-9]|[1-9])',
  Y: '(?<Y>\\d\\d\\d\\d)',
  y: '(?<y>\\d\\d)',
  j: '(?<j>36[0-6]|3[0-5]\\d|[12]\\d\\d|0[1-9]\\d|00[1-9]|[1-9]\\d|0[1-9]|[1-9])',
  H: '(?<H>2[0-3]|[0-1]\\d|\\d)',
  M: '(?<M>[0-5]\\d|\\d)',
  S: '(?<S>6[0-1]|[0-5]\\d|\\d)',
  b: `(?<b>${MESES.map((x) => x.slice(0, 3).toLowerCase()).join('|')})`,
  B: `(?<B>${MESES.map((x) => x.toLowerCase()).join('|')})`,
  '%': '%',
};

/**
 * datetime.strptime(texto, fmt).date() → data civil, ou null (ValueError).
 * Como o CPython: casa no INÍCIO (match), recusa se sobrar texto ("unconverted
 * data remains"), maiúsculas/minúsculas tanto faz, espaço do formato = \s+,
 * diretiva repetida ou desconhecida = erro, e a data tem de existir (31/02 não).
 */
export function strptime(texto, fmt) {
  let re = '', usadas = new Set();
  const f = String(fmt).replace(/\s+/g, ' ');
  for (let i = 0; i < f.length; i++) {
    const c = f[i];
    if (c === '%' && i + 1 < f.length) {
      const k = f[++i];
      if (!RE_DIRETIVA[k]) return null;
      if (k !== '%') { if (usadas.has(k)) return null; usadas.add(k); }
      re += RE_DIRETIVA[k];
    } else if (c === ' ') re += '\\s+';
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  let m;
  try { m = new RegExp('^' + re, 'i').exec(String(texto)); } catch (_) { return null; }
  if (!m || m[0].length !== String(texto).length) return null;
  const g = m.groups || {};
  let y = 1900, mes = 1, d = 1;
  if (g.Y != null) y = +g.Y;
  else if (g.y != null) { y = +g.y; y += y <= 68 ? 2000 : 1900; }
  if (g.m != null) mes = +g.m;
  else if (g.B != null) mes = MESES.findIndex((x) => x.toLowerCase() === g.B.toLowerCase()) + 1;
  else if (g.b != null) mes = MESES.findIndex((x) => x.slice(0, 3).toLowerCase() === g.b.toLowerCase()) + 1;
  if (g.d != null) d = +g.d.trim();
  if (g.j != null && g.m == null && g.d == null && g.b == null && g.B == null) {
    const j = +g.j;
    const c = somarDias(dataCivil(y, 1, 1), j - 1);
    if (c.y !== y) return null;
    return c;
  }
  if (y < 1 || y > 9999) return null;
  const c = deUTC(Date.UTC(y, mes - 1, d));
  if (c.y !== y || c.m !== mes || c.d !== d) return null;   // 31/02 etc.
  return c;
}

/** parse_date(text, fmt): o formato do programa, depois %d/%m/%y, %m/%Y, %m/%y. */
export function lerData(texto, fmt) {
  for (const f of [fmt, '%d/%m/%y', '%m/%Y', '%m/%y']) {
    const c = strptime(texto, f);
    if (c) return c;
  }
  return null;
}

/** expand_expected(expected, lot, today): {LOT} e {TODAY}, {TODAY:+N}, {TODAY:-N|%m/%y}. */
export function expandirEsperado(esperado, lote, hoje = hojeLocal()) {
  const out = String(esperado).split('{LOT}').join(lote || '');
  return out.replace(/\{TODAY(?::([+-]?\d+))?(?:\|([^}]+))?\}/g, (_, n, f) => strftime(somarDias(hoje, parseInt(n || '0', 10)), f || '%d/%m/%Y'));
}

// ------------------------------------------------------------------ GS1 e GTIN

const AI_FIXO = { '00': 18, '01': 14, '02': 14, '11': 6, '13': 6, '15': 6, '17': 6 };
const AI_VAR = new Set(['10', '21', '22', '30', '37', '240', '241', '400']);

/** gs1_parse(data): HRI "(01)…(10)…" ou cru com GS (\x1d) separando os AIs variáveis. */
export function gs1(dados) {
  const data = String(dados);
  if (data.startsWith('(')) {
    const out = {};
    for (const m of data.matchAll(/\((\d{2,4})\)([^(]*)/g)) out[m[1]] = m[2];
    return out;
  }
  const s = data.split(']d2').join('').split(']C1').join('');
  const out = {};
  let i = 0;
  while (i < s.length) {
    const ai2 = s.slice(i, i + 2), ai3 = s.slice(i, i + 3);
    if (Object.prototype.hasOwnProperty.call(AI_FIXO, ai2)) {
      out[ai2] = s.slice(i + 2, i + 2 + AI_FIXO[ai2]);
      i += 2 + AI_FIXO[ai2];
    } else if (AI_VAR.has(ai3) || AI_VAR.has(ai2)) {
      const ai = AI_VAR.has(ai3) ? ai3 : ai2;
      let fim = s.indexOf('\x1d', i);
      fim = fim < 0 ? s.length : fim;
      out[ai] = s.slice(i + ai.length, fim);
      i = fim + 1;
    } else break;
  }
  return out;
}

/** gtin_check_ok(gtin): só dígitos, 8/12/13/14, dígito verificador módulo 10 (pesos 3,1 da direita). */
export function gtinOk(gtin) {
  const g = String(gtin);
  if (!/^\d+$/.test(g) || ![8, 12, 13, 14].includes(g.length)) return false;
  const d = Array.from(g, Number);
  const dv = d.pop();
  let total = 0;
  d.reverse().forEach((v, i) => { total += v * (i % 2 === 0 ? 3 : 1); });
  return (10 - (total % 10)) % 10 === dv;
}

/** Texto cru do leitor → o que o gs1_parse do Inspect espera (o zxing-cpp já dá HRI ou cru sem prefixo). */
export function limparFnc1(t) {
  let s = String(t || '');
  for (const pre of [']d2', ']C1', ']Q3', ']e0']) if (s.startsWith(pre)) s = s.slice(pre.length);
  while (s.startsWith('\x1d')) s = s.slice(1);
  return s;
}

// ------------------------------------------------------------------ regex do Python

/** Padrão do Python (re) → RegExp do JS: grupos nomeados (?P<n>…) e (?P=n). */
export function regexPy(padrao, flags = '') {
  const s = String(padrao).replace(/\(\?P<([A-Za-z_]\w*)>/g, '(?<$1>').replace(/\(\?P=([A-Za-z_]\w*)\)/g, '\\k<$1>');
  return new RegExp(s, flags);
}
/** re.fullmatch(padrao, texto) is not None. */
export const casaInteiro = (padrao, texto) => regexPy('^(?:' + String(padrao) + ')$').test(String(texto));

// ------------------------------------------------------------------ sequência do serial

/**
 * sequence_status(num, last, max_gap) — regra pura. Duplicidade NÃO é decidida
 * aqui: é o registro de seriais do canal (no Inspect, o PK de insp.serial_registry).
 */
export function statusSequencia(num, ultimo, maxGap) {
  if (num == null) return [FAIL, 'parte numérica ausente'];
  if (ultimo == null) return [PASS, 'primeiro serial da série'];
  if (num === ultimo) return [FAIL, 'igual ao anterior'];
  if (num < ultimo) return [UNCERTAIN, `fora de ordem (anterior ${ultimo})`];
  if (num - ultimo > maxGap) return [UNCERTAIN, `salto de ${num - ultimo - 1} — possível peça faltante`];
  return [PASS, ''];
}

// ------------------------------------------------------------------ decisões das ferramentas

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const roiOv = (s) => (s.roi ? [{ kind: 'roi', x: s.roi.x, y: s.roi.y, w: s.roi.w, h: s.roi.h }] : []);

/** Ordem de leitura do engine do Inspect: faixa de 12 px em y, depois x. */
export function ordenarLinhas(linhas) {
  const chave = (ln) => (ln.poly && ln.poly.length
    ? [Math.floor(Math.min(...ln.poly.map((p) => p[1])) / 12), Math.min(...ln.poly.map((p) => p[0]))] : [0, 0]);
  return linhas.slice().sort((a, b) => { const ka = chave(a), kb = chave(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
}

const polyOv = (linhas, ox, oy) => linhas.filter((ln) => ln.poly && ln.poly.length)
  .map((ln) => ({ kind: 'poly', pts: ln.poly.map((p) => [p[0] + ox, p[1] + oy]), label: ln.text }));

/**
 * ocr(): linhas [{text, score, poly}] em px da região (origem ox, oy);
 * ctx { lote, hoje }. Sem texto, fora do padrão, diferente do esperado, data
 * inválida ou validade curta = NOK; tudo certo mas leitura fraca = INCERTO.
 */
export function julgarOcr(linhas, s, ctx = {}, ox = 0, oy = 0) {
  const ls = ordenarLinhas(linhas || []);
  const campo = s.field || 'free';
  const bruto = ls.map((ln) => ln.text).join(' ');
  const texto = normalizar(bruto, campo);
  const conf = ls.length ? Math.min(...ls.map((ln) => ln.score)) : 0;
  const motivos = [];
  if (!texto) motivos.push('sem texto');
  if (s.pattern && !casaInteiro(s.pattern, texto)) motivos.push(`não casa com /${s.pattern}/`);
  let esperado = null;
  if (s.expected != null && s.expected !== '') {
    esperado = normalizar(expandirEsperado(s.expected, ctx.lote, ctx.hoje || hojeLocal()), campo);
    if (texto !== esperado) motivos.push(`esperado '${esperado}'`);
  }
  let validade = null;
  if (campo === 'date' && texto) {
    const d = lerData(texto, s.date_format || '%d/%m/%Y');
    if (d == null) motivos.push('data inválida');
    else {
      validade = diasEntre(d, ctx.hoje || hojeLocal());
      if (s.min_days_valid != null && validade < s.min_days_valid) motivos.push(`validade < ${s.min_days_valid} dias`);
    }
  }
  const minConf = s.min_char_conf == null ? 0.8 : +s.min_char_conf;
  const st = motivos.length ? FAIL : conf < minConf ? UNCERTAIN : PASS;
  return resultado(s, st, {
    value: texto, expected: s.pattern || s.expected || '', confidence: r4(conf),
    detail: { raw: bruto, reasons: motivos, lines: ls.map((ln) => ln.text), ...(esperado != null ? { expanded: esperado } : {}),
      ...(validade != null ? { days_valid: validade } : {}), ...(st === UNCERTAIN ? { reason: `leitura fraca (${r4(conf)} < ${minConf}) — humano confirma` } : {}) },
    overlays: [...roiOv(s), ...polyOv(ls, ox, oy)],
  });
}

/** Formatos: nomes do zxing-cpp (os do Inspect) ⇄ nomes do BarcodeDetector/ZXing daqui. */
export const FORMATOS = {
  QRCode: 'qr_code', DataMatrix: 'data_matrix', Code128: 'code_128', Code39: 'code_39', EAN13: 'ean_13', EAN8: 'ean_8',
  UPCA: 'upc_a', UPCE: 'upc_e', ITF: 'itf', Codabar: 'codabar', PDF417: 'pdf417', Aztec: 'aztec',
};
export const FORMATO_INSPECT = Object.fromEntries(Object.entries(FORMATOS).map(([a, b]) => [b, a]));

/**
 * code(): achados [{text, format (zxing-cpp: QRCode, EAN13…), pts}] em px da
 * região; ctx { lote }. Nenhum legível = NOK; padrão, GTIN (DV), GTIN do
 * produto e lote do código ≠ lote da ordem = NOK; dois diferentes = INCERTO.
 */
export function julgarCodigo(achados, s, ctx = {}, ox = 0, oy = 0) {
  const fmts = s.formats || [];
  const ok = (achados || []).filter((r) => !fmts.length || fmts.includes(r.format));
  if (!ok.length) {
    const outros = (achados || []).length ? ` (lido ${achados.map((a) => a.format).join(', ')}, fora dos aceitos)` : '';
    return resultado(s, FAIL, { value: null, expected: fmts.join(','), confidence: null, detail: { reason: 'nenhum código legível' + outros }, overlays: roiOv(s) });
  }
  const r = ok[0];
  const motivos = [];
  const detail = { format: r.format };
  if (s.pattern && !casaInteiro(s.pattern, r.text)) motivos.push('conteúdo fora do padrão');
  if (s.gs1) {
    const ais = gs1(limparFnc1(r.text));
    detail.gs1 = ais;
    const gtin = ais['01'];
    if (!gtin || !gtinOk(gtin)) motivos.push('GTIN ausente ou DV inválido');
    if (s.expect_gtin && gtin !== s.expect_gtin) motivos.push('GTIN diferente do produto');
    if (ctx.lote && ais['10'] && ais['10'] !== ctx.lote) motivos.push('lote do código ≠ lote da ordem');
  } else if (s.gtin_check) {
    // só daqui (o Inspect ignora expect_gtin sem gs1): EAN/UPC na embalagem — o conteúdo É o GTIN
    if (!gtinOk(r.text)) motivos.push('GTIN com DV inválido');
    if (s.expect_gtin && r.text.padStart(14, '0') !== String(s.expect_gtin).padStart(14, '0')) motivos.push('GTIN diferente do produto');
  }
  if (s.expected != null && s.expected !== '' && r.text !== expandirEsperado(s.expected, ctx.lote, ctx.hoje || hojeLocal())) motivos.push('conteúdo diferente do esperado');
  detail.reasons = motivos;
  const distintos = [...new Set(ok.map((a) => a.text))];
  let st = motivos.length ? FAIL : PASS;
  if (st === PASS && distintos.length > 1) { st = UNCERTAIN; detail.reason = `ambíguo: ${distintos.length} códigos diferentes na ROI`; }
  const ov = [...roiOv(s)];
  for (const a of ok.slice(0, 4)) {
    if (a.pts && a.pts.length >= 2) ov.push({ kind: 'poly', pts: a.pts.map((p) => [p[0] + ox, p[1] + oy]), label: a.format });
  }
  return resultado(s, st, {
    value: r.text, expected: s.pattern || (s.gs1 ? 'GS1' : ''), confidence: 1.0, detail, overlays: ov,
  });
}

/**
 * serial(): texto lido (linhas do OCR, ou o código) + padrão com o grupo
 * (?P<n>\d+) + sequência contra ctx.ultimoSerial. Duplicidade fica para o
 * registro do canal (como o PK do Inspect).
 */
export function julgarSerial(linhas, s, ctx = {}, ox = 0, oy = 0) {
  const ls = ordenarLinhas(linhas || []);
  const texto = normalizar(ls.map((ln) => ln.text).join(' '), 'free').toUpperCase();
  const conf = ls.length ? Math.min(...ls.map((ln) => ln.score)) : 0;
  const ov = [...roiOv(s), ...polyOv(ls, ox, oy)];
  let m = null;
  try { m = regexPy(s.pattern || '(?P<n>\\d+)').exec(texto); } catch (e) { throw new Error('padrão inválido: ' + e.message); }
  if (!m) {
    return resultado(s, FAIL, { value: texto || null, expected: s.pattern, confidence: r4(conf), detail: { reason: 'não casa com o padrão', serial: null }, overlays: ov });
  }
  const ser = m[0];
  const n = m.groups && m.groups.n ? parseInt(m.groups.n, 10) : null;
  const ultimo = typeof ctx.ultimoSerial === 'function' ? ctx.ultimoSerial(s) : ctx.ultimoSerial ?? null;
  let [st, why] = s.check_sequence !== false ? statusSequencia(n, ultimo, s.max_gap == null ? 1 : +s.max_gap) : [PASS, ''];
  const minConf = s.min_char_conf == null ? 0.85 : +s.min_char_conf;
  if (st === PASS && conf < minConf) { st = UNCERTAIN; why = 'leitura fraca — humano confirma'; }
  return resultado(s, st, {
    value: ser, expected: s.pattern, confidence: r4(conf),
    detail: { serial: ser, num: n, reason: why, last: ultimo }, overlays: ov,
  });
}
