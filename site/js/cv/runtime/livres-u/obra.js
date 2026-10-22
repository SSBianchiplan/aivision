/**
 * cv/runtime/livres-u/obra.js — Diário de obra (CV-87, C1), sem DOM:
 *
 *   DiarioObra       por hora do dia: quantos IDs distintos e o máximo simultâneo de
 *                    cada classe (pessoa, caminhão, betoneira…), entradas pela zona do portão
 *   resumoTexto      o resumo numérico em texto (vai para o relatório e, se o usuário
 *                    optar, para a Via redigir)
 *   relatorioHTML    o RDO (Relatório Diário de Obra) em HTML imprimível (→ PDF pelo navegador)
 *
 * Só números e as fotos que o próprio usuário guardou; pessoas não são identificadas
 * (o preset borra rostos antes das fotos).
 */

const h2 = (n) => String(n).padStart(2, '0');
export const chaveDia = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${h2(d.getMonth() + 1)}-${h2(d.getDate())}`; };

export class DiarioObra {
  constructor(o = {}) { this.o = { classes: ['pessoa', 'caminhão'], ...o }; this.dias = new Map(); }
  configurar(o) { Object.assign(this.o, o); }

  /** dets: [{name, id?, x1..y2}] da cadeia; `noPortao(det)` → bool (zona do portão); ms = relógio de parede. */
  passo(ms, dets, noPortao = null) {
    const dia = chaveDia(ms), hora = new Date(ms).getHours();
    let D = this.dias.get(dia);
    if (!D) { D = { dia, horas: {}, entradasVistas: new Set(), primeiro: ms, ultimo: ms }; this.dias.set(dia, D); }
    D.ultimo = ms;
    const H = D.horas[hora] || (D.horas[hora] = {});
    const agora = {};
    for (const d of dets || []) {
      const c = this.classe(d.name);
      if (!c) continue;
      agora[c] = (agora[c] || 0) + 1;
      const e = H[c] || (H[c] = { ids: new Set(), max: 0, entradas: 0, semId: 0 });
      if (d.id != null) e.ids.add(String(d.id)); else e.semId = Math.max(e.semId, agora[c]);
      if (noPortao && d.id != null && noPortao(d)) {
        const k = c + '#' + d.id;
        if (!D.entradasVistas.has(k)) { D.entradasVistas.add(k); e.entradas++; }
      }
    }
    for (const [c, n] of Object.entries(agora)) H[c].max = Math.max(H[c].max, n);
    return agora;
  }

  /** Nome detectado → classe do diário (a primeira da lista que o nome contém), ou null. */
  classe(nome) {
    const n = String(nome || '').toLowerCase();
    for (const c of this.o.classes) if (n === c || n.includes(c)) return c;
    return null;
  }

  /** Tabela do dia: [{ hora, classes: { c: { distintos, max, entradas } } }] em ordem. */
  tabela(dia) {
    const D = this.dias.get(dia);
    if (!D) return [];
    return Object.keys(D.horas).map(Number).sort((a, b) => a - b).map((hh) => {
      const cl = {};
      for (const [c, e] of Object.entries(D.horas[hh])) cl[c] = { distintos: Math.max(e.ids.size, e.semId), max: e.max, entradas: e.entradas };
      return { hora: hh, classes: cl };
    });
  }

  /** Estado serializável (para guardar no IndexedDB). */
  json(dia) {
    const D = this.dias.get(dia);
    if (!D) return null;
    const horas = {};
    for (const [hh, cls] of Object.entries(D.horas)) {
      horas[hh] = {};
      for (const [c, e] of Object.entries(cls)) horas[hh][c] = { ids: [...e.ids], max: e.max, entradas: e.entradas, semId: e.semId };
    }
    return { dia, horas, entradasVistas: [...D.entradasVistas], primeiro: D.primeiro, ultimo: D.ultimo };
  }

  carregar(j) {
    if (!j || !j.dia) return;
    const horas = {};
    for (const [hh, cls] of Object.entries(j.horas || {})) {
      horas[hh] = {};
      for (const [c, e] of Object.entries(cls)) horas[hh][c] = { ids: new Set(e.ids || []), max: e.max || 0, entradas: e.entradas || 0, semId: e.semId || 0 };
    }
    this.dias.set(j.dia, { dia: j.dia, horas, entradasVistas: new Set(j.entradasVistas || []), primeiro: j.primeiro, ultimo: j.ultimo });
  }
}

/** Totais do dia por classe: { c: { distintos (soma por hora), picoSimult, entradas, horaPico } }. */
export function totaisDia(tab) {
  const t = {};
  for (const l of tab) {
    for (const [c, e] of Object.entries(l.classes)) {
      const x = t[c] || (t[c] = { distintos: 0, picoSimult: 0, entradas: 0, horaPico: null });
      x.distintos += e.distintos; x.entradas += e.entradas;
      if (e.max > x.picoSimult) { x.picoSimult = e.max; x.horaPico = l.hora; }
    }
  }
  return t;
}

/** Resumo numérico em português (curto, sem dado pessoal). */
export function resumoTexto(dia, tab, extra = {}) {
  const t = totaisDia(tab);
  const linhas = [`Data: ${dia.split('-').reverse().join('/')}.`];
  if (tab.length) linhas.push(`Registro das ${h2(tab[0].hora)}h às ${h2(tab[tab.length - 1].hora + 1)}h.`);
  for (const [c, x] of Object.entries(t)) {
    linhas.push(`${c}: pico de ${x.picoSimult} ao mesmo tempo${x.horaPico != null ? ` (às ${h2(x.horaPico)}h)` : ''}` +
      `${x.entradas ? `, ${x.entradas} entrada(s) pelo portão` : ''}.`);
  }
  if (extra.clima) linhas.push(`Clima informado: ${extra.clima}.`);
  if (extra.atividades) linhas.push(`Atividades informadas: ${extra.atividades}.`);
  if (extra.ocorrencias) linhas.push(`Ocorrências informadas: ${extra.ocorrencias}.`);
  if (extra.fotos) linhas.push(`${extra.fotos} foto(s) registradas.`);
  return linhas.join('\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * RDO em HTML. d = { obra, responsavel, dia, tab, classes, fotos: [{ url (data:), hora, legenda }],
 * clima, atividades, ocorrencias, textoVia }.
 */
export function relatorioHTML(d) {
  const classes = d.classes && d.classes.length ? d.classes : [...new Set(d.tab.flatMap((l) => Object.keys(l.classes)))];
  const t = totaisDia(d.tab);
  const data = d.dia.split('-').reverse().join('/');
  const linhas = d.tab.map((l) => `<tr><td>${h2(l.hora)}:00–${h2(l.hora + 1)}:00</td>${classes.map((c) => {
    const e = l.classes[c];
    return `<td>${e ? `${e.max}` : '—'}</td><td>${e && e.entradas ? e.entradas : '—'}</td>`;
  }).join('')}</tr>`).join('');
  const fotos = (d.fotos || []).map((f) => `<figure><img src="${esc(f.url)}" alt="foto ${esc(f.hora)}"><figcaption>${esc(f.hora)}${f.legenda ? ' · ' + esc(f.legenda) : ''}</figcaption></figure>`).join('');
  const bloco = (titulo, txt) => (txt ? `<h2>${titulo}</h2><p class="pre">${esc(txt)}</p>` : '');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>RDO ${esc(d.obra || '')} ${data}</title>
<style>
@page{size:A4;margin:14mm}body{font:12px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0;padding:16px;background:#fff}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999}
.cab{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin:8px 0}.cab div b{display:inline-block;min-width:90px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:3px 6px;text-align:center}th{background:#eee}
td:first-child{text-align:left;white-space:nowrap}.pre{white-space:pre-wrap}
.fotos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}figure{margin:0;break-inside:avoid}img{width:100%;border:1px solid #ccc}
figcaption{font-size:10px;color:#444}.nota{font-size:10px;color:#555;margin-top:18px}
.ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.ass div{border-top:1px solid #333;padding-top:4px;text-align:center}
@media print{.nao-imprimir{display:none}}
</style></head><body>
<p class="nao-imprimir"><button onclick="print()">Imprimir / salvar em PDF</button></p>
<h1>RDO — Relatório Diário de Obra</h1>
<div class="cab"><div><b>Obra:</b> ${esc(d.obra || '—')}</div><div><b>Data:</b> ${data}</div>
<div><b>Responsável:</b> ${esc(d.responsavel || '—')}</div><div><b>Clima:</b> ${esc(d.clima || '—')}</div></div>
<h2>Efetivo e equipamentos (contagem pela câmera)</h2>
<table><thead><tr><th rowspan="2">Hora</th>${classes.map((c) => `<th colspan="2">${esc(c)}</th>`).join('')}</tr>
<tr>${classes.map(() => '<th>máx. simult.</th><th>entradas</th>').join('')}</tr></thead>
<tbody>${linhas || `<tr><td colspan="${1 + 2 * classes.length}">sem registros</td></tr>`}</tbody>
<tfoot><tr><th>Dia</th>${classes.map((c) => `<th>${t[c] ? t[c].picoSimult : '—'}</th><th>${t[c] && t[c].entradas ? t[c].entradas : '—'}</th>`).join('')}</tr></tfoot></table>
${bloco('Atividades', d.atividades)}${bloco('Ocorrências', d.ocorrencias)}${bloco('Resumo redigido pela Via (revisar)', d.textoVia)}
${fotos ? `<h2>Fotos</h2><div class="fotos">${fotos}</div>` : ''}
<div class="ass"><div>Responsável técnico</div><div>Fiscalização</div></div>
<p class="nota">Contagens automáticas por visão computacional (GPlanSiS|iaVision): máximo de detecções simultâneas por hora e entradas pela zona do portão. São indicadores — confira antes de assinar. Pessoas não são identificadas.</p>
</body></html>`;
}
