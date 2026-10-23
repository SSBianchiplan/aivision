/**
 * components/industrial/InspectEditor.js — o editor de PROGRAMA da tela
 * GPlanSiS|Inspect (porte da página Programs do Inspect, no tema do iaVision).
 *
 * Trabalha sobre um RASCUNHO (cópia do programa ativo): mexer nos campos não
 * muda a inspeção em andamento; "Salvar versão" grava uma versão nova (o
 * histórico guarda as anteriores, com restaurar). Também: novo (vazio ou de
 * modelo/exemplo do Inspect), duplicar, apagar, exportar (JSON do iaVision ou
 * ProgramSpec do Inspect), importar, capturar molde/cor/golden do quadro
 * atual, desenhar as ROIs no quadro ao vivo e "Testar no quadro atual".
 *
 * Parte 2: campos de OCR (campo, padrão, esperado com {LOT}/{TODAY}, data e
 * validade), código (formatos, GS1, GTIN), serial (padrão, sequência,
 * registro), detector/classificador/anomalia (modelo do iaVision ou do
 * Treinar, classes exigidas/proibidas, rótulos OK, α e amostras de
 * calibração conformal, limiar), e o lote da ordem e o prazo dos modelos.
 */
import { confirmar } from '../dialogo.js';
import { html, useState, useRef, useEffect } from '../../vendor.js';
import { FERRAMENTAS, PENDENTES, FAIXAS_HSV } from '../../cv/runtime/livres-n/ferramentas.js';
import { novaFerramenta, validar, MODELOS, EXEMPLOS_INSPECT } from '../../cv/runtime/livres-n/programa.js';
import { MODOS_GATILHO } from '../../cv/runtime/livres-n/gatilhos.js';
import { rgbDeLab } from '../../cv/runtime/livres-n/visao.js';
import { FORMATOS } from '../../cv/runtime/livres-n/marcacao.js';
import * as canal from '../../cv/runtime/livres-n/canal.js';
import { baixar, carimbo, fmt, nomeDaMarcacao, ROT } from './inspect-comum.js';

const CAMPOS = {
  presence: [['min_score', 'NCC mínimo', 'num', 0.01], ['folga', 'Folga da busca (fração da caixa)', 'num', 0.05]],
  blob_count: [['polarity', 'Contar o que é', 'sel', [['dark', 'escuro'], ['light', 'claro']]], ['_limiar', 'Limiar', 'limiar'],
    ['min_area', 'Área mín. (px)', 'int'], ['max_area', 'Área máx. (px)', 'int'], ['count_min', 'Contagem mín.', 'int'], ['count_max', 'Contagem máx.', 'int']],
  caliper: [['nominal_mm', 'Nominal (mm)', 'num', 0.01], ['tol_mm', 'Tolerância ± (mm)', 'num', 0.01], ['width', 'Largura do perfil (px)', 'int'],
    ['edge_min_contrast', 'Contraste mín. da borda', 'num', 1]],
  color: [['ref_lab', 'Referência L a b', 'lab'], ['max_delta_e', 'ΔE00 máximo', 'num', 0.1]],
  shape: [['polarity', 'Objeto', 'sel', [['auto', 'auto (pela borda)'], ['dark', 'escuro'], ['light', 'claro']]], ['min_area_px', 'Área mín. (px)', 'int'],
    ['eq_diam_mm', 'Ø equivalente: nominal ± tol. (mm)', 'par'], ['area_mm2', 'Área mín.–máx. (mm²)', 'par'],
    ['circularity_min', 'Circularidade mín. (vazio = não)', 'numnull', 0.01], ['solidity_min', 'Solidez mín. (vazio = não)', 'numnull', 0.01],
    ['aspect_range', 'Alongamento mín.–máx.', 'par']],
  defect_area: [['ranges', 'Faixas HSV (H 0–179, S e V 0–255)', 'faixas'], ['within_object', 'Só dentro do objeto', 'bool'],
    ['max_pct', 'Área máx. (%)', 'num', 0.1], ['min_spot_px', 'Mancha mín. (px)', 'int'], ['max_spots', 'Máx. de manchas (vazio = sem limite)', 'intnull']],
  ocr: [['field', 'Campo', 'sel', [['free', 'texto livre'], ['lot', 'lote (A–Z, 0–9, -)'], ['date', 'data (O→0, . e - → /)'], ['digits', 'só dígitos'], ['alnum', 'alfanumérico']]],
    ['expected', 'Esperado ({LOT}, {TODAY}, {TODAY:+180|%d/%m/%y})', 'texto'], ['pattern', 'Padrão (regex, texto inteiro)', 'texto'],
    ['date_format', 'Formato da data', 'texto'], ['min_days_valid', 'Validade mín. (dias a partir de hoje)', 'intnull'], ['min_char_conf', 'Confiança mín. da leitura', 'num', 0.01]],
  code: [['formats', 'Formatos aceitos (nenhum = todos)', 'formatos'], ['gs1', 'GS1 (AI 01 GTIN, 10 lote, 17 validade, 21 série)', 'bool'],
    ['expect_gtin', 'GTIN do produto', 'texto'], ['gtin_check', 'Sem GS1: o conteúdo (EAN/UPC) é o GTIN — conferir DV', 'bool'],
    ['pattern', 'Padrão (regex, conteúdo inteiro)', 'texto'], ['expected', 'Conteúdo esperado (igual; {LOT}, {TODAY})', 'texto']],
  serial: [['source', 'Ler de', 'sel', [['ocr', 'texto impresso (OCR)'], ['code', 'código (QR/DataMatrix…)']]], ['pattern', 'Padrão com (?P<n>\\d+) = parte sequencial', 'texto'],
    ['check_sequence', 'Controlar a sequência', 'bool'], ['max_gap', 'Salto máximo (maior = INCERTO)', 'int'], ['min_char_conf', 'Confiança mín. da leitura', 'num', 0.01]],
  detect: [['modelo', 'Detector', 'modelo', 'detectores'], ['conf', 'Confiança mín.', 'num', 0.05], ['require', 'Classes exigidas (contagem mín–máx)', 'exigidas'],
    ['forbid', 'Classes proibidas (vírgula)', 'lista']],
  classify: [['modelo', 'Classificador', 'modelo', 'classificadores'], ['ok_labels', 'Classes OK (vírgula)', 'lista'], ['alpha', 'α do conformal (1 − cobertura)', 'num', 0.01]],
  anomaly: [['modelo', 'Modelo PatchCore (Treinar)', 'modelo', 'anomalia'], ['threshold', 'Limiar da nota 0–1 (vazio = calibrado)', 'numnull', 0.01]],
};

/** Modelos para os seletores (detectores, classificadores, anomalia), lidos uma vez por abertura do editor. */
let opcoesCache = null;
function useOpcoesModelos() {
  const [o, setO] = useState(opcoesCache);
  useEffect(() => {
    let vivo = true;
    import('../../cv/runtime/livres-n/modelos.js').then((Mo) => Mo.opcoesModelos()).then((r) => { opcoesCache = r; if (vivo) setO(r); }).catch(() => {});
    return () => { vivo = false; };
  }, []);
  return o;
}

const num = (v) => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };

function Campo({ t, c, mudar, opcoes }) {
  const [k, rot, tipo, extra] = c;
  const v = t[k];
  if (tipo === 'sel') {
    return html`<label class="ins-campo"><span>${rot}</span><select value=${v} onChange=${(e) => mudar({ [k]: e.target.value })}>
      ${extra.map(([a, b]) => html`<option key=${a} value=${a}>${b}</option>`)}</select></label>`;
  }
  if (tipo === 'bool') return html`<label class="ins-campo ins-chk"><input type="checkbox" checked=${Boolean(v)} onChange=${(e) => mudar({ [k]: e.target.checked })} /><span>${rot}</span></label>`;
  if (tipo === 'limiar') {
    const modo = t.threshold_mode === 'adaptive' ? 'adaptive' : t.threshold == null ? 'otsu' : 'fixo';
    return html`<label class="ins-campo"><span>${rot}</span><span class="ins-par">
      <select value=${modo} onChange=${(e) => { const m = e.target.value; mudar(m === 'otsu' ? { threshold: null, threshold_mode: undefined } : m === 'fixo' ? { threshold: t.threshold ?? 128, threshold_mode: undefined } : { threshold: null, threshold_mode: 'adaptive', block: t.block || 31, c: t.c ?? 5 }); }}>
        <option value="otsu">Otsu (automático)</option><option value="fixo">fixo</option><option value="adaptive">adaptativo (luz irregular)</option></select>
      ${modo === 'fixo' && html`<input type="number" min="0" max="255" value=${t.threshold} onChange=${(e) => mudar({ threshold: Math.max(0, Math.min(255, Math.round(num(e.target.value) ?? 128))) })} aria-label="limiar fixo" />`}
      ${modo === 'adaptive' && html`<input type="number" min="3" max="151" step="2" value=${t.block || 31} onChange=${(e) => mudar({ block: (Math.round(num(e.target.value) || 31) | 1) })} aria-label="bloco (px)" title="bloco (px)" />`}
    </span></label>`;
  }
  if (tipo === 'lab') {
    const [L, a, b] = v || [50, 0, 0];
    const [r, g, bb] = rgbDeLab(L, a, b);
    return html`<label class="ins-campo"><span>${rot}</span><span class="ins-par">
      <i class="ins-amostra" style=${{ background: `rgb(${r},${g},${bb})` }}></i>
      ${[0, 1, 2].map((i) => html`<input key=${i} type="number" step="0.1" value=${(v || [50, 0, 0])[i]} aria-label=${'Lab ' + 'Lab'[i]}
        onChange=${(e) => { const n = [...(v || [50, 0, 0])]; n[i] = num(e.target.value) ?? 0; mudar({ [k]: n }); }} />`)}
    </span></label>`;
  }
  if (tipo === 'par') {
    const on = Array.isArray(v);
    const p = on ? v : [0, 0];
    return html`<label class="ins-campo"><span><input type="checkbox" checked=${on} onChange=${(e) => mudar({ [k]: e.target.checked ? (k === 'eq_diam_mm' ? [50, 1] : k === 'aspect_range' ? [1, 1.2] : [100, 200]) : null })} /> ${rot}</span>
      ${on && html`<span class="ins-par">${[0, 1].map((i) => html`<input key=${i} type="number" step="0.01" value=${p[i]} onChange=${(e) => { const n = [...p]; n[i] = num(e.target.value) ?? 0; mudar({ [k]: n }); }} />`)}</span>`}</label>`;
  }
  if (tipo === 'faixas') {
    const lista = v || [];
    return html`<div class="ins-campo ins-faixas"><span>${rot}</span>
      ${lista.map((f, i) => html`<div key=${i} class="ins-faixa">
        <input class="ins-faixa-nome" value=${f.name} onChange=${(e) => { const n = lista.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)); mudar({ ranges: n }); }} aria-label="nome da faixa" />
        ${['h', 's', 'v'].map((c2) => html`<span key=${c2} class="ins-hsv"><b>${c2.toUpperCase()}</b>
          ${[0, 1].map((j) => html`<input key=${j} type="number" min="0" max=${c2 === 'h' ? 179 : 255} value=${f[c2][j]}
            onChange=${(e) => { const n = lista.map((x, q) => (q === i ? { ...x, [c2]: x[c2].map((y, z) => (z === j ? Math.round(num(e.target.value) ?? 0) : y)) } : x)); mudar({ ranges: n }); }} />`)}</span>`)}
        <button class="ins-btn mini" title="Tirar a faixa" onClick=${() => mudar({ ranges: lista.filter((_, j) => j !== i) })}>✕</button>
      </div>`)}
      <select class="ins-btn" value="" onChange=${(e) => { const f = FAIXAS_HSV[e.target.value]; if (f) mudar({ ranges: [...lista, JSON.parse(JSON.stringify(f))] }); e.target.value = ''; }}>
        <option value="">+ faixa pronta…</option>
        ${Object.entries(FAIXAS_HSV).map(([id, f]) => html`<option key=${id} value=${id}>${f.name} (H ${f.h.join('–')} · S ${f.s.join('–')} · V ${f.v.join('–')})</option>`)}
      </select></div>`;
  }
  if (tipo === 'texto') {
    return html`<label class="ins-campo larga"><span>${rot}</span><input value=${v ?? ''} spellcheck="false" onChange=${(e) => mudar({ [k]: e.target.value === '' ? null : e.target.value })} /></label>`;
  }
  if (tipo === 'lista') {
    return html`<label class="ins-campo larga"><span>${rot}</span><input value=${(v || []).join(', ')} spellcheck="false"
      onChange=${(e) => mudar({ [k]: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>`;
  }
  if (tipo === 'formatos') {
    const lst = v || [];
    return html`<div class="ins-campo larga"><span>${rot}</span><span class="ins-fmts">${Object.keys(FORMATOS).map((f) => html`
      <label key=${f} class="ins-chk"><input type="checkbox" checked=${lst.includes(f)} onChange=${(e) => mudar({ [k]: e.target.checked ? [...lst, f] : lst.filter((x) => x !== f) })} /><span>${f}</span></label>`)}</span></div>`;
  }
  if (tipo === 'modelo') {
    const ops = (opcoes && opcoes[extra]) || [];
    return html`<label class="ins-campo larga"><span>${rot}</span><select value=${v || ''} onChange=${(e) => mudar({ [k]: e.target.value })}>
      ${extra === 'anomalia' && html`<option value="">o mais recente do Treinar</option>`}
      ${v && !ops.some((x) => x.id === v) && html`<option value=${v}>${v}</option>`}
      ${ops.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome}</option>`)}</select>
      ${!opcoes && html`<em class="ins-dica">lendo os modelos…</em>`}
      ${opcoes && extra === 'anomalia' && !ops.length && html`<em class="ins-dica">nenhum PatchCore treinado: use «Treinar anomalia com as BOAS».</em>`}</label>`;
  }
  if (tipo === 'exigidas') {
    const req = v || {};
    const ent = Object.entries(req);
    const det = opcoes && (opcoes.detectores || []).find((x) => x.id === t.modelo);
    const sug = det && det.classes ? det.classes : null;
    return html`<div class="ins-campo larga"><span>${rot}</span>
      ${ent.map(([c, [lo, hi]]) => html`<div key=${c} class="ins-faixa"><b class="ins-faixa-nome">${c}</b>
        ${[lo, hi].map((x, j) => html`<input key=${j} type="number" min="0" value=${x} aria-label=${j ? 'máximo' : 'mínimo'}
          onChange=${(e) => { const n = [lo, hi]; n[j] = Math.max(0, Math.round(num(e.target.value) ?? 0)); mudar({ [k]: { ...req, [c]: n } }); }} />`)}
        <button class="ins-btn mini" title="Tirar" onClick=${() => { const n = { ...req }; delete n[c]; mudar({ [k]: n }); }}>✕</button></div>`)}
      <input class="ins-motivo" list=${'cls-' + t.code} placeholder="+ classe exigida (Enter)" onKeyDown=${(e) => {
        if (e.key !== 'Enter') return; const c = e.target.value.trim(); if (!c) return; e.target.value = ''; mudar({ [k]: { ...req, [c]: [1, 1] } }); }} />
      ${sug && html`<datalist id=${'cls-' + t.code}>${sug.map((c) => html`<option key=${c} value=${c} />`)}</datalist>`}</div>`;
  }
  const passo = extra || 1;
  const vazio = tipo === 'numnull' || tipo === 'intnull';
  return html`<label class="ins-campo"><span>${rot}</span><input type="number" step=${tipo === 'int' || tipo === 'intnull' ? 1 : passo} value=${v ?? ''}
    onChange=${(e) => { const x = num(e.target.value); mudar({ [k]: x == null ? (vazio ? null : t[k]) : tipo.startsWith('int') ? Math.round(x) : x }); }} /></label>`;
}

/** Classificação: amostras rotuladas (o humano diz a classe certa da peça na frente) e calibração T + q̂. */
function CalibracaoClassif({ prog, t, set, msg }) {
  const [rot, setRot] = useState((t.ok_labels || [])[0] || '');
  const [ocupado, setOcupado] = useState(false);
  const am = t.calib_amostras || [];
  const porClasse = {};
  for (const a of am) porClasse[a.r] = (porClasse[a.r] || 0) + 1;
  const c = t.calibration;
  return html`<div class="ins-roi ins-calib">
    <span>Calibração: ${c && c.qhat != null ? html`<b>T ${c.temperature} · q̂ ${c.qhat}</b> (α ${c.alpha}, cobertura ${Math.round((c.coverage || 0) * 100)} %, n ${c.n_cal})` : html`<em>padrão (T 1, q̂ 0,9)</em>`}
      · ${am.length} amostra(s)${am.length ? ': ' + Object.entries(porClasse).map(([k, n]) => `${k} ${n}`).join(', ') : ''}</span>
    <input class="ins-motivo" value=${rot} onInput=${(e) => setRot(e.target.value)} placeholder="classe certa da peça na frente" aria-label="classe certa" />
    <button class="ins-btn" disabled=${ocupado || !rot.trim()} onClick=${async () => { setOcupado(true); try { msg(await canal.amostraClassificacao(prog, t, rot.trim())); set({ calib_amostras: t.calib_amostras }); } catch (e) { msg('⚠ ' + e.message); } setOcupado(false); }}>
      ${ocupado ? 'Classificando…' : '+ Amostra (quadro atual)'}</button>
    <button class="ins-btn acento" disabled=${am.length < 5} onClick=${() => { try { msg(canal.calibrarClassificacao(t)); set({ calibration: t.calibration }); } catch (e) { msg('⚠ ' + e.message); } }}>Calibrar (α ${t.alpha ?? 0.1})</button>
    ${am.length > 0 && html`<button class="ins-btn" onClick=${() => set({ calib_amostras: [] })}>Limpar amostras</button>`}
  </div>`;
}

function CartaoFerramenta({ prog, t, i, mudar, mover, tirar, msg, pedirDesenho, desenhando, foco, setFoco, opcoes }) {
  const def = FERRAMENTAS[t.type];
  const set = (patch) => mudar(i, patch);
  const marca = def ? nomeDaMarcacao(prog, t) : null;
  const asset = t.type === 'presence' && prog.assets && prog.assets[t.template_key];
  const acao = (fn) => () => { try { msg(fn()); } catch (e) { msg('⚠ ' + e.message); } };
  return html`
    <div class="ins-ferr ${foco === t.code ? 'foco' : ''} ${t.ativo ? '' : 'off'}" onMouseEnter=${() => setFoco(t.code)} onMouseLeave=${() => setFoco(null)}>
      <div class="ins-ferr-h">
        <b>${def ? def.rotulo : PENDENTES[t.type] || t.type}</b>
        <span class="ins-ferr-acoes">
          <button class="ins-btn mini" disabled=${i === 0} title="Subir" onClick=${() => mover(i, -1)}>↑</button>
          <button class="ins-btn mini" title="Descer" onClick=${() => mover(i, 1)}>↓</button>
          <button class="ins-btn mini" title="Tirar a ferramenta" onClick=${() => tirar(i)}>✕</button>
        </span>
      </div>
      ${!def && html`<p class="ins-dica">Tipo do Inspect sem porte aqui: fica guardado, desativado, e volta no export.</p>`}
      ${def && def.assinc && html`<p class="ins-dica">${def.criterio(t)} · roda com leitura/modelo, fora do laço de quadros; o veredito espera (prazo ${prog.prazo_modelos_s || 20} s, depois INCERTO).</p>`}
      <div class="ins-campos">
        <label class="ins-campo"><span>Código</span><input value=${t.code} maxlength="24" onChange=${(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), ...(t.type === 'presence' && !asset ? { template_key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') } : {}) })} /></label>
        <label class="ins-campo"><span>Nome</span><input value=${t.name} onChange=${(e) => set({ name: e.target.value })} /></label>
        <label class="ins-campo ins-chk"><input type="checkbox" checked=${t.ativo} disabled=${!def} onChange=${(e) => set({ ativo: e.target.checked })} /><span>Ativa</span></label>
        <label class="ins-campo ins-chk"><input type="checkbox" checked=${t.critical} onChange=${(e) => set({ critical: e.target.checked })} /><span>Crítica (decide o veredito)</span></label>
        <label class="ins-campo"><span>Faixa de incerteza</span><input type="number" min="0" max="0.5" step="0.01" value=${t.band} onChange=${(e) => set({ band: Math.min(0.5, Math.max(0, num(e.target.value) ?? 0.05)) })} /></label>
      </div>
      ${def && html`
        <div class="ins-roi">
          <span>ROI: ${marca ? html`<b>marcação «${marca}»</b>` : def.roi === 'linha' ? (t.p0 && (t.p0[0] || t.p1[0]) ? `linha fixa (${t.p0.join(',')} → ${t.p1.join(',')} px)` : html`<em>desenhe a linha</em>`) : t.roi ? `fixa ${t.roi.w}×${t.roi.h} px em (${t.roi.x}, ${t.roi.y})` : 'imagem inteira'}</span>
          <button class="ins-btn ${desenhando === t.code ? 'on' : ''}" onClick=${() => pedirDesenho(desenhando === t.code ? null : t.code)}
            title=${def.roi === 'linha' ? 'Arraste no quadro ao vivo de uma borda à outra' : 'Arraste um retângulo no quadro ao vivo'}>
            ${desenhando === t.code ? 'Arraste no quadro ao vivo…' : def.roi === 'linha' ? 'Desenhar linha' : 'Desenhar ROI'}</button>
          ${t.marcacao && html`<button class="ins-btn" onClick=${() => set({ marcacao: null })} title="Desfaz a ligação (a marcação continua nas Ferramentas de mouse)">Desligar marcação</button>`}
          ${!t.marcacao && t.roi && html`<button class="ins-btn" onClick=${() => set({ roi: null })}>Imagem inteira</button>`}
        </div>
        <div class="ins-campos">${(CAMPOS[t.type] || []).map((c) => html`<${Campo} key=${c[0]} t=${t} c=${c} mudar=${set} opcoes=${opcoes} />`)}</div>
        ${t.type === 'serial' && html`<div class="ins-roi"><span>Registro de seriais de ${prog.codigo}: último nº <b>${canal.ultimoSerial(prog) ?? '—'}</b> (repetido = NOK)</span>
          <button class="ins-btn" onClick=${async () => { if (await confirmar(`Zerar o registro de seriais de ${prog.codigo}? (nova série)`, { titulo: 'Zerar seriais', ok: 'Zerar registro', perigo: true })) { canal.zerarSeriais(prog); msg('Registro de seriais zerado.'); } }}>Zerar registro</button></div>`}
        ${t.type === 'classify' && html`<${CalibracaoClassif} prog=${prog} t=${t} set=${set} msg=${msg} />`}
        ${(t.type === 'ocr' || t.type === 'code') && html`<p class="ins-dica">Lote da ordem: ${prog.lote ? html`<b>${prog.lote}</b>` : html`<em>vazio</em>`} (campo «Lote» em Escala…). Hoje: ${new Date().toLocaleDateString('pt-BR')}.</p>`}
        ${t.type === 'presence' && html`<div class="ins-roi"><span>Molde: ${asset ? html`<b>${asset.w}×${asset.h} px</b> (capturado em ${asset.W} px de largura)` : html`<em>não capturado</em>`}</span>
          <button class="ins-btn acento" onClick=${acao(() => canal.capturarMolde(prog, t))} title="Peça BOA na frente: o conteúdo da caixa vira o molde">Capturar molde</button></div>`}
        ${t.type === 'color' && html`<div class="ins-roi"><span>Referência = a mediana Lab da região com a peça boa</span>
          <button class="ins-btn acento" onClick=${acao(() => canal.capturarCor(prog, t))}>Capturar cor</button></div>`}
      `}
    </div>
  `;
}

export function InspectEditor({ rascunho: prog, mudou, onFechar, onMsg, pedirDesenho, desenhando, foco, setFoco, onTestar }) {
  const [, setV] = useState(0);
  const opcoes = useOpcoesModelos();
  const [tipoNovo, setTipoNovo] = useState('blob_count');
  const [nota, setNota] = useState('');
  const arq = useRef(null);
  const bump = () => { setV((n) => n + 1); mudou && mudou(); };
  const msg = (t) => { onMsg && onMsg(t); bump(); };
  if (!prog) return null;
  const val = validar(prog);
  const mudarF = (i, patch) => { prog.tools[i] = { ...prog.tools[i], ...patch }; for (const [k, v] of Object.entries(patch)) if (v === undefined) delete prog.tools[i][k]; bump(); };
  const mover = (i, d) => { const j = i + d; if (j < 0 || j >= prog.tools.length) return; const a = prog.tools; [a[i], a[j]] = [a[j], a[i]]; bump(); };
  const tirar = (i) => { prog.tools.splice(i, 1); bump(); };
  const tr = prog.trigger;
  const setT = (patch) => { prog.trigger = { ...tr, ...patch }; bump(); };
  const al = prog.alignment;
  const setA = (patch) => { prog.alignment = { ...al, ...patch }; bump(); };
  const salvarVersao = () => {
    if (val.erros.length) { msg('⚠ Corrija antes de salvar: ' + val.erros.join('; ')); return; }
    const nova = canal.salvar(prog, nota.trim());
    setNota('');
    onMsg && onMsg(`${nova.codigo} v${nova.versao} salvo e ativo.`);
    onFechar(nova);
  };
  const importar = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { const p = canal.importar(await f.text()); onMsg && onMsg(`Importado: ${p.codigo} — ${p.nome} (${p.tools.length} ferramentas).`); onFechar(p); } catch (err) { msg('⚠ Não consegui importar: ' + err.message); }
  };
  const exportar = (formato) => {
    const txt = canal.exportar(prog.id, formato) || JSON.stringify(prog, null, 2);
    baixar(txt, `${prog.codigo}_v${prog.versao}${formato === 'inspect' ? '_inspect-spec' : ''}_${carimbo()}.json`, 'application/json');
  };
  const ppmRegua = (() => { const mq = canal.marcacoesAtuais(); const e = mq && mq.escala; return e && e.mmPorPxFonte ? 1 / e.mmPorPxFonte : null; })();

  return html`
    <aside class="ins-editor" role="dialog" aria-label="Editor do programa de inspeção">
      <header class="ins-editor-h">
        <b>Programa</b>
        <span class="ins-tag">${prog.codigo} · v${prog.versao}${prog.impressao ? ` · ${prog.impressao.slice(0, 8)}` : ''}</span>
        <button class="ins-btn" onClick=${() => onFechar(null)} aria-label="Fechar o editor">✕</button>
      </header>
      <div class="ins-editor-c">
        <section>
          <div class="ins-campos">
            <label class="ins-campo"><span>Código</span><input value=${prog.codigo} maxlength="40" onChange=${(e) => { prog.codigo = e.target.value.toUpperCase(); bump(); }} /></label>
            <label class="ins-campo larga"><span>Nome</span><input value=${prog.nome} onChange=${(e) => { prog.nome = e.target.value; bump(); }} /></label>
            <label class="ins-campo"><span>Produto</span><input value=${prog.produto || ''} onChange=${(e) => { prog.produto = e.target.value; bump(); }} /></label>
          </div>
          <div class="ins-acoes">
            <input class="ins-nota" placeholder="Nota da versão (o que mudou)" value=${nota} onInput=${(e) => setNota(e.target.value)} />
            <button class="ins-btn acento" onClick=${salvarVersao} disabled=${val.erros.length > 0}>Salvar versão ${prog.versao + 1}</button>
            <button class="ins-btn" onClick=${() => { try { onTestar(prog); } catch (e) { msg('⚠ ' + e.message); } }} title="Roda o rascunho no quadro atual, sem registrar">Testar no quadro atual</button>
          </div>
          ${val.erros.map((e) => html`<p key=${e} class="ins-erro">⚠ ${e}</p>`)}
          ${val.avisos.map((e) => html`<p key=${e} class="ins-avisob">• ${e}</p>`)}
        </section>

        <section>
          <h3>Ferramentas <small>${prog.tools.filter((t) => t.ativo).length} ativas · críticas decidem: NOK domina, depois INCERTO</small></h3>
          ${prog.tools.map((t, i) => html`<${CartaoFerramenta} key=${i + t.code} prog=${prog} t=${t} i=${i} mudar=${mudarF} mover=${mover} tirar=${tirar}
            msg=${msg} pedirDesenho=${pedirDesenho} desenhando=${desenhando} foco=${foco} setFoco=${setFoco} opcoes=${opcoes} />`)}
          <div class="ins-acoes">
            <select class="ins-btn" value=${tipoNovo} onChange=${(e) => setTipoNovo(e.target.value)} aria-label="Tipo da ferramenta nova">
              ${Object.entries(FERRAMENTAS).map(([k, d]) => html`<option key=${k} value=${k}>${d.rotulo}</option>`)}
            </select>
            <button class="ins-btn acento" onClick=${() => { prog.tools.push(novaFerramenta(prog, tipoNovo)); bump(); }}>+ Ferramenta</button>
          </div>
        </section>

        <section>
          <h3>Gatilho <small>quando a peça é inspecionada (uma vez por passagem)</small></h3>
          <div class="ins-campos">
            <label class="ins-campo larga"><span>Modo</span><select value=${tr.mode} onChange=${(e) => setT({ mode: e.target.value })}>
              ${MODOS_GATILHO.map(([v, r]) => html`<option key=${v} value=${v}>${r}</option>`)}</select></label>
            ${tr.mode === 'presence' && html`
              <label class="ins-campo"><span>Liga (ocupação)</span><input type="number" step="0.01" value=${tr.on_ratio} onChange=${(e) => setT({ on_ratio: num(e.target.value) ?? 0.08 })} /></label>
              <label class="ins-campo"><span>Desliga (histerese)</span><input type="number" step="0.01" value=${tr.off_ratio} onChange=${(e) => setT({ off_ratio: num(e.target.value) ?? 0.03 })} /></label>
              <label class="ins-campo"><span>Quadros estáveis</span><input type="number" min="1" value=${tr.stable_frames} onChange=${(e) => setT({ stable_frames: Math.max(1, Math.round(num(e.target.value) ?? 3)) })} /></label>
              <label class="ins-campo"><span>Movimento máx.</span><input type="number" step="0.005" value=${tr.motion_max} onChange=${(e) => setT({ motion_max: num(e.target.value) ?? 0.02 })} /></label>`}
            ${(tr.mode === 'presence' || tr.mode === 'line') && html`
              <label class="ins-campo"><span>Diferença do fundo</span><input type="number" min="1" max="255" value=${tr.diff_thr} onChange=${(e) => setT({ diff_thr: Math.round(num(e.target.value) ?? 25) })} /></label>`}
            ${tr.mode === 'line' && html`
              <label class="ins-campo"><span>Sentido</span><select value=${tr.direction} onChange=${(e) => setT({ direction: +e.target.value })}>
                <option value="1">esquerda → direita</option><option value="-1">direita → esquerda</option></select></label>
              <label class="ins-campo"><span>Pixels mín. do objeto</span><input type="number" min="1" value=${tr.min_pixels} onChange=${(e) => setT({ min_pixels: Math.round(num(e.target.value) ?? 150) })} /></label>`}
            ${tr.mode === 'interval' && html`<label class="ins-campo"><span>Segundos</span><input type="number" min="0.1" step="0.1" value=${tr.seconds} onChange=${(e) => setT({ seconds: num(e.target.value) ?? 2 })} /></label>`}
          </div>
          ${(tr.mode === 'presence' || tr.mode === 'line') && html`<div class="ins-roi">
            <span>ROI do gatilho: ${tr.marcacao ? html`<b>marcação «Gatilho»</b>` : Array.isArray(tr.roi) ? 'fixa' : 'centro do quadro (padrão)'}</span>
            <button class="ins-btn ${desenhando === '#gatilho' ? 'on' : ''}" onClick=${() => pedirDesenho(desenhando === '#gatilho' ? null : '#gatilho')}>${desenhando === '#gatilho' ? 'Arraste no quadro ao vivo…' : 'Desenhar ROI do gatilho'}</button>
            <button class="ins-btn" onClick=${() => { canal.rearmarGatilho(); msg('Gatilho rearmado.'); }}>Rearmar (aprender fundo)</button>
          </div>`}
        </section>

        <section>
          <h3>Escala, alinhamento e alarmes</h3>
          <div class="ins-campos">
            <label class="ins-campo larga"><span>px/mm</span><span class="ins-par">
              <select value=${prog.px_per_mm == null ? 'regua' : 'fixo'} onChange=${(e) => { prog.px_per_mm = e.target.value === 'regua' ? null : (prog.px_per_mm || ppmRegua || 10); bump(); }}>
                <option value="regua">da régua calibrada (Ferramentas de mouse)${ppmRegua ? ` — ${fmt(ppmRegua, 3)} px/mm na fonte` : ' — não calibrada'}</option>
                <option value="fixo">fixo no programa</option></select>
              ${prog.px_per_mm != null && html`<input type="number" step="0.001" value=${prog.px_per_mm} onChange=${(e) => { prog.px_per_mm = num(e.target.value) || null; bump(); }} aria-label="px por mm" />`}
            </span></label>
            <label class="ins-campo"><span>Imagem de referência</span><span>${prog.imagem ? `${prog.imagem.w}×${prog.imagem.h} px` : '— (a da inspeção)'}</span></label>
          </div>
          <div class="ins-campos">
            <label class="ins-campo"><span>Lote da ordem/turno ({LOT}, GS1 AI 10)</span><input value=${prog.lote || ''} maxlength="40"
              onChange=${(e) => { prog.lote = e.target.value.trim().toUpperCase(); bump(); }} /></label>
            <label class="ins-campo"><span>Espera pelos modelos (s; depois INCERTO)</span><input type="number" min="1" max="120" value=${prog.prazo_modelos_s ?? 20}
              onChange=${(e) => { prog.prazo_modelos_s = Math.min(120, Math.max(1, num(e.target.value) ?? 20)); bump(); }} /></label>
          </div>
          <div class="ins-campos">
            <label class="ins-campo ins-chk"><input type="checkbox" checked=${al.enabled} onChange=${(e) => setA({ enabled: e.target.checked })} /><span>Alinhar à peça de referência (golden, translação)</span></label>
            <label class="ins-campo"><span>NCC mín. do alinhamento</span><input type="number" step="0.05" value=${al.min_score} onChange=${(e) => setA({ min_score: num(e.target.value) ?? 0.5 })} /></label>
            <label class="ins-campo"><span>Deslocamento máx. (fração)</span><input type="number" step="0.01" value=${al.max_shift} onChange=${(e) => setA({ max_shift: num(e.target.value) ?? 0.15 })} /></label>
          </div>
          <div class="ins-roi"><span>Golden: ${prog.golden ? html`<b>${prog.golden.w}×${prog.golden.h}</b> (de ${prog.golden.W}×${prog.golden.H})` : html`<em>não capturada</em>`}${al.origem && al.origem !== 'ncc_translation' ? ` · no Inspect era ${al.origem}` : ''}</span>
            <button class="ins-btn" onClick=${() => { try { msg(canal.capturarGolden(prog)); } catch (e) { msg('⚠ ' + e.message); } }}>Capturar golden</button>
            ${prog.golden && html`<button class="ins-btn" onClick=${() => { prog.golden = null; setA({ enabled: false }); }}>Apagar golden</button>`}</div>
          <div class="ins-campos">
            <label class="ins-campo"><span>Alarme: NOK seguidos</span><input type="number" min="2" value=${prog.alarme.nok_seguidos} onChange=${(e) => { prog.alarme = { ...prog.alarme, nok_seguidos: Math.max(2, Math.round(num(e.target.value) ?? 3)) }; bump(); }} /></label>
            <label class="ins-campo"><span>Alarme: % de INCERTO (últimas 20)</span><input type="number" min="1" max="100" value=${prog.alarme.incerto_pct} onChange=${(e) => { prog.alarme = { ...prog.alarme, incerto_pct: num(e.target.value) ?? 25 }; bump(); }} /></label>
          </div>
        </section>

        <section>
          <h3>Arquivo <small>guardado neste navegador, por usuário</small></h3>
          <div class="ins-acoes">
            <button class="ins-btn" onClick=${() => exportar('gplansis')} title="JSON completo do iaVision (com moldes e golden)">Exportar JSON</button>
            <button class="ins-btn" onClick=${() => exportar('inspect')} title="ProgramSpec do GPlanSiS|Inspect (tools, px_per_mm, alignment)">Exportar para o Inspect</button>
            <button class="ins-btn" onClick=${() => arq.current && arq.current.click()}>Importar…</button>
            <input ref=${arq} type="file" accept=".json,application/json" hidden onChange=${importar} />
            <button class="ins-btn" onClick=${() => { const d = canal.duplicarPrograma(prog.id); if (d) { onMsg && onMsg(`Duplicado: ${d.nome}.`); onFechar(d); } }} disabled=${!prog.versao}>Duplicar</button>
            <button class="ins-btn perigo" onClick=${async () => { if (await confirmar(`Apagar o programa ${prog.codigo} — ${prog.nome}? O histórico de inspeções fica.`, { titulo: 'Apagar programa', ok: 'Apagar programa', cancelar: 'Manter', perigo: true })) { canal.apagarPrograma(prog.id); onFechar(null); } }} disabled=${!prog.versao}>Apagar</button>
          </div>
          <div class="ins-acoes">
            <select class="ins-btn" value="" onChange=${(e) => { const k = e.target.value; e.target.value = ''; if (!k) return; const p = canal.criar(k === '__vazio' ? null : k); onMsg && onMsg(`Criado: ${p.codigo} — ${p.nome}.`); onFechar(p); }}>
              <option value="">Novo programa…</option>
              <option value="__vazio">vazio</option>
              ${Object.entries(MODELOS).map(([k, m]) => html`<option key=${k} value=${k}>modelo: ${m.nome}</option>`)}
              ${Object.entries(EXEMPLOS_INSPECT).map(([k, m]) => html`<option key=${k} value=${k}>exemplo do Inspect: ${k} — ${m.nome}</option>`)}
            </select>
          </div>
          ${prog.historico.length > 0 && html`<details class="ins-versoes"><summary>Versões anteriores (${prog.historico.length})</summary>
            <ul>${prog.historico.map((h) => html`<li key=${h.versao}><b>v${h.versao}</b> ${h.em ? new Date(h.em).toLocaleString('pt-BR') : ''} ${h.autor ? '· ' + h.autor : ''} ${h.nota ? '· ' + h.nota : ''}
              <button class="ins-btn mini" onClick=${() => { const p = canal.restaurar(prog.id, h.versao); if (p) { onMsg && onMsg(`v${h.versao} restaurada como v${p.versao}.`); onFechar(p); } }}>Restaurar</button></li>`)}</ul></details>`}
        </section>
        <p class="ins-dica">Status: ${Object.entries(ROT).map(([k, v]) => `${k}=${v}`).join(' · ')} (nomes do Inspect no JSON).</p>
      </div>
    </aside>
  `;
}

export default InspectEditor;
