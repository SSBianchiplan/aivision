/**
 * cv/operators/livres-oa/logistica.js — CV-45 Leituras de logística e mídia:
 * operadores pequenos que dão sentido ao que os leitores da cadeia já leem.
 *
 *   logistica.etiqueta   etiqueta de transporte / DANFE: procura a CHAVE DE
 *                        ACESSO de 44 dígitos no código de barras (code.scan)
 *                        e no texto (ocr.ptbr), confere o dígito verificador
 *                        (módulo 11), a UF, o CNPJ/CPF do emitente e abre os
 *                        campos; reconhece também o objeto dos Correios
 *                        (AA123456785BR, dígito conferido) e o CEP.
 *   logistica.pallet     rastreio de pallet por QR/código: cada código lido é
 *                        um pallet; a zona desenhada onde ele aparece é o
 *                        local (doca, rua, quarentena); troca de zona = evento.
 *   midia.tempo_tela     tempo de tela de um logo/marca (ou de qualquer
 *                        ferramenta do Inspect): soma o tempo em que a
 *                        ferramenta deu OK, conta as exposições e a maior.
 *
 * Precisam de `ctx.codigos` (code.scan), `ctx.textos` (ocr.ptbr) e
 * `ctx.inspecao` (ferramentas inspect.*) antes na cadeia.
 */
import { clone } from '../../core.js';
import { dentro, registrarEvento } from '../../marcacoes.js';
import { acharChaves, chaveNFe, rastreioCorreios } from '../../runtime/livres-oa/nucleo.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';

export const G_LOG = 'CV-45';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
const ISO = () => new Date().toISOString();

export const etiqueta = {
  op: 'logistica.etiqueta',
  label: 'Etiqueta de transporte e chave NF-e',
  group: G_LOG, overlayOnly: true,
  desc: 'Acha a chave de acesso de 44 dígitos (NF-e, NFC-e, CT-e, MDF-e) no código de barras e no texto lido, confere ' +
        'o dígito verificador, a UF e o CNPJ do emitente e mostra série, número e mês; reconhece também o código de ' +
        'rastreio dos Correios. Coloque depois de "QR e códigos" e/ou do OCR PT-BR.',
  params: {
    somenteValidas: { type: 'bool', default: true, label: 'Listar só chaves com dígito válido' },
    faixa: { type: 'bool', default: true, label: 'Mostrar a última leitura no vídeo' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('etiquetas', state) || !state.lidas) state.lidas = new Map();
    const codigos = Array.isArray(ctx.codigos) ? ctx.codigos : [];
    const textos = Array.isArray(ctx.textos) ? ctx.textos.map((x) => x.text) : [];
    if (!Array.isArray(ctx.codigos) && !Array.isArray(ctx.textos)) ctx.metrics['etiqueta'] = 'coloque "QR e códigos" e/ou o OCR PT-BR antes';
    const novas = [];
    const guardar = (k, item) => {
      const e = state.lidas.get(k);
      if (e) { e.vezes++; e.ultima = ISO(); return; }
      state.lidas.set(k, { ...item, vezes: 1, primeira: ISO(), ultima: ISO() });
      novas.push(item);
    };
    for (const c of codigos) {
      const ch = chaveNFe(c.text);
      if (ch && (ch.valida || !p.somenteValidas)) guardar(ch.chave, { tipo: 'chave', origem: `código ${c.format || ''}`.trim(), ...ch });
      const r = rastreioCorreios(c.text);
      if (r && r.valido) guardar(r.codigo, { tipo: 'correios', origem: 'código', ...r });
    }
    for (const ch of acharChaves(textos)) guardar(ch.chave, { tipo: 'chave', origem: 'OCR', ...ch });
    const tudo = textos.join(' ');
    for (const m of tudo.toUpperCase().replace(/\s+/g, '').matchAll(/[A-Z]{2}\d{9}[A-Z]{2}/g)) {
      const r = rastreioCorreios(m[0]);
      if (r && r.valido) guardar(r.codigo, { tipo: 'correios', origem: 'OCR', ...r });
    }
    const cep = /\b(\d{5})-?(\d{3})\b/.exec(tudo);
    for (const n of novas) registrarEvento({ t: ISO(), marcacao: 'etiqueta', evento: n.tipo === 'chave' ? `chave ${n.modelo} ${n.valida ? 'válida' : 'INVÁLIDA'}` : 'rastreio Correios', classe: n.tipo, id: n.chave || n.codigo });
    const lista = [...state.lidas.values()];
    const ult = lista[lista.length - 1];
    if (p.faixa && ult) {
      const txt = ult.tipo === 'chave'
        ? `${ult.modelo} ${ult.valida ? '✓' : '✗ DV'} · ${ult.uf} ${ult.aamm} · série ${ult.serie} nº ${ult.numero}${ult.emitenteOk ? '' : ' · emitente?'}`
        : `Correios ${ult.codigo} ✓`;
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: ult.valida === false ? '#FF4D4D' : '#4ade80', text: txt });
    }
    ctx.metrics['chaves lidas'] = lista.filter((x) => x.tipo === 'chave').length;
    publicar('etiquetas', { lidas: lista.slice(-200), cep: cep ? `${cep[1]}-${cep[2]}` : null });
    return clone(src);
  },
};

export const pallet = {
  op: 'logistica.pallet',
  label: 'Rastreio de pallet por QR/código',
  group: G_LOG, overlayOnly: true,
  desc: 'Cada código lido (QR, DataMatrix, Code 128/SSCC) é um pallet; a ZONA desenhada onde ele aparece é o local ' +
        '(doca, rua, quarentena). Tabela de onde está cada pallet e desde quando, eventos de movimentação no CSV. ' +
        'Publica os códigos como objetos com ID para Zonas e linhas. Coloque depois de "QR e códigos".',
  params: {
    filtro: { type: 'text', default: '', max: 120, label: 'Só códigos que casam com (regex; vazio = todos)' },
    esquecerS: { type: 'int', min: 1, max: 86400, step: 1, default: 10, label: 'Sem leitura por (s) = fora de vista' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('pallets', state) || !state.pal) { state.pal = new Map(); state.mov = 0; }
    let re = null;
    try { re = p.filtro ? new RegExp(p.filtro) : null; } catch (_) { ctx.metrics['pallet'] = 'regex inválida'; }
    const codigos = (Array.isArray(ctx.codigos) ? ctx.codigos : []).filter((c) => !re || re.test(c.text));
    if (!Array.isArray(ctx.codigos)) ctx.metrics['pallet'] = 'coloque "QR e códigos" antes';
    const mq = ctx.marcacoes;
    const zonas = mq ? mq.itens.filter((i) => i.funcao === 'zona' && AREAS.has(i.tipo)) : [];
    const { t, relogio } = tempoDe(ctx);
    const { w, h } = ctx;
    const dets = [];
    for (const c of codigos) {
      const b = c.box || (c.corners && c.corners.length ? caixaDe(c.corners) : null);
      if (!b) continue;
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const z = zonas.find((it) => dentro(it, cx, cy));
      const local = z ? z.nome : '(fora das zonas)';
      let e = state.pal.get(c.text);
      if (!e) {
        state.pal.set(c.text, (e = { codigo: c.text, formato: c.format, local, desde: t, visto: t, historico: [{ local, t }] }));
        registrarEvento({ t: ISO(), marcacao: local, evento: 'pallet visto', classe: 'pallet', id: c.text });
      } else if (e.local !== local && z) {
        // só troca de local com zona definida: passar por fora das zonas não apaga o último local conhecido
        e.historico.push({ local, t }); if (e.historico.length > 50) e.historico.shift();
        registrarEvento({ t: ISO(), marcacao: local, evento: `pallet movido de ${e.local}`, classe: 'pallet', id: c.text });
        e.local = local; e.desde = t; state.mov++;
      }
      e.visto = t;
      dets.push({ x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h, score: 1, name: 'pallet', id: c.text });
      ctx.overlay.push({ type: 'rect', x: b.x * w, y: b.y * h, w: b.w * w, h: b.h * h, color: '#38bdf8', label: `${c.text.slice(0, 24)} · ${local}` });
    }
    if (dets.length) ctx.detections = dets;
    const lista = [...state.pal.values()].map((e) => ({ ...e, emVista: t - e.visto <= p.esquecerS }));
    ctx.metrics['pallets'] = lista.length;
    ctx.metrics['movimentações'] = state.mov;
    publicar('pallets', { pallets: lista, movimentos: state.mov, relogio, t });
    return clone(src);
  },
};

function caixaDe(cs) {
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const c of cs) { x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x); y2 = Math.max(y2, c.y); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export const tempoTela = {
  op: 'midia.tempo_tela',
  label: 'Tempo de tela (logo, marca, presença)',
  group: G_LOG, overlayOnly: true,
  desc: 'Soma o tempo em que cada ferramenta de inspeção da cadeia deu OK — por exemplo o molde de um LOGO na área ' +
        '"Inspect · presença" — e conta as exposições (com duração mínima) e a mais longa. Para patrocínio em ' +
        'transmissão, placa de publicidade, vinheta. Coloque depois de "Inspeção — presença".',
  params: {
    minExposicaoS: { type: 'float', min: 0, max: 30, step: 0.1, default: 1, label: 'Exposição conta a partir de (s)' },
    toleranciaS: { type: 'float', min: 0, max: 5, step: 0.1, default: 0.5, label: 'Falha curta tolerada (s)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('tempo_tela', state) || !state.f) { state.f = new Map(); state.tAnt = null; state.total = 0; }
    const ins = Array.isArray(ctx.inspecao) ? ctx.inspecao : null;
    if (!ins) { ctx.metrics['tempo de tela'] = 'coloque uma ferramenta de inspeção (presença) antes'; return clone(src); }
    const { t } = tempoDe(ctx);
    let dt = state.tAnt == null ? 0 : t - state.tAnt;
    if (!(dt > 0) || dt > 1 || ctx.fonteParada) dt = 0;
    state.tAnt = t; state.total += dt;
    for (const r of ins) {
      let e = state.f.get(r.nome);
      if (!e) state.f.set(r.nome, (e = { nome: r.nome, tela: 0, exp: 0, maior: 0, atual: 0, falha: 0, contada: false }));
      if (r.status === 'PASS') {
        e.falha = 0; e.atual += dt; e.tela += dt;
        if (!e.contada && e.atual >= p.minExposicaoS) { e.exp++; e.contada = true; }
        e.maior = Math.max(e.maior, e.atual);
      } else {
        e.falha += dt;
        if (e.falha > p.toleranciaS) { e.atual = 0; e.contada = false; }
      }
    }
    const lista = [...state.f.values()].map((e) => ({ nome: e.nome, tela: e.tela, exp: e.exp, maior: e.maior, pct: state.total ? e.tela / state.total : 0, agora: e.atual > 0 && e.falha === 0 }));
    for (const e of lista) ctx.metrics[`${e.nome} em tela`] = `${e.tela.toFixed(1)} s (${(e.pct * 100).toFixed(0)} %) · ${e.exp} exp.`;
    publicar('tempo_tela', { itens: lista, total: state.total });
    return clone(src);
  },
};

export default [etiqueta, pallet, tempoTela];
