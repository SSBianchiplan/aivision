/**
 * cv/runtime/livres-s/aep.js — AEP (Avaliação Ergonômica Preliminar, NR-17,
 * item 17.3) consolidada POR POSTO a partir do que o iaVision já mede:
 *
 *   Ergonomia RULA/REBA (CV-29, ergonomia.avaliar)  nota por pessoa a cada quadro
 *   Tempo de posto (CV-39, takt.posto)               postos marcados + produtivo/ocioso/vago
 *   Levantamento de carga (CV-60, ergonomia.niosh)   IL do NIOSH, quando houver
 *
 * Aqui só a CONTA: tempo observado em cada faixa de risco por posto, média
 * ponderada no tempo, pior postura (miniatura com rosto borrado), alertas e
 * uma priorização sugerida. O relatório HTML (imprimir / salvar em PDF) é um
 * RASCUNHO DE APOIO ao ergonomista: a AEP e a AET são dele (NR-17, 17.3.2).
 */
import { FAIXAS, nivel, faixaDe, recomendacoes, NIVEIS } from '../livres-f/ergonomia.js';

export const AVISO_AEP = 'Rascunho de APOIO ao ergonomista, gerado por visão computacional (pose 2D, sem marcadores). ' +
  'Não é a AEP nem a AET da NR-17: os ângulos têm erro de alguns graus, dependem da posição da câmera e do tempo ' +
  'observado, e fatores organizacionais, cognitivos e ambientais não são medidos. A avaliação, a conclusão e a ' +
  'assinatura são do profissional responsável.';

/** Faixas comuns 0..4 (desprezível, baixo, médio, alto, muito alto). */
export const NOMES_FAIXA = FAIXAS.map((f) => f.nome);

/** Prioridade sugerida de um posto: fração do tempo em faixa alta/muito alta e pico. */
export function prioridade(pctAlto, pctMuitoAlto, picoFaixa, li = null) {
  if (pctMuitoAlto >= 5 || picoFaixa >= 4 && pctAlto + pctMuitoAlto >= 10 || (li != null && li > 3)) return { nivel: 3, nome: 'alta', cor: '#ef4444' };
  if (pctAlto + pctMuitoAlto >= 10 || picoFaixa >= 4 || (li != null && li > 1)) return { nivel: 2, nome: 'média', cor: '#fb923c' };
  if (pctAlto + pctMuitoAlto > 0 || picoFaixa >= 3) return { nivel: 1, nome: 'baixa', cor: '#facc15' };
  return { nivel: 0, nome: 'sem indicação', cor: '#4ade80' };
}

export class AcumuladorAEP {
  constructor() { this.zerar(); }
  zerar() { this.postos = new Map(); this.t0 = null; this.tUlt = null; }

  posto(nome) {
    let p = this.postos.get(nome);
    if (!p) {
      p = { nome, tempo: 0, faixas: { RULA: [0, 0, 0, 0, 0], REBA: [0, 0, 0, 0, 0] }, soma: { RULA: 0, REBA: 0 },
            pico: { RULA: null, REBA: null }, pessoas: new Set(), alertas: 0, emAlerta: false, desdeAlto: null };
      this.postos.set(nome, p);
    }
    return p;
  }

  /**
   * Um quadro avaliado: `obs` = [{ posto, id, av }] (uma pessoa por posto conta
   * uma vez — a de nota mais alta), dt em s. `alertaS`: tempo contínuo em
   * faixa ≥ 3 que conta um alerta.
   */
  registrar(obs, t, dt, { alertaS = 10, metodo = 'RULA' } = {}) {
    if (this.t0 == null) this.t0 = t;
    this.tUlt = t;
    const porPosto = new Map();
    for (const o of obs) {
      if (!o.av || !o.av.ok) continue;
      const a = porPosto.get(o.posto);
      if (!a || o.av.rula.final + o.av.reba.final > a.av.rula.final + a.av.reba.final) porPosto.set(o.posto, o);
    }
    for (const [nome, o] of porPosto) {
      const p = this.posto(nome);
      p.pessoas.add(o.id);
      p.tempo += dt;
      for (const M of ['RULA', 'REBA']) {
        const nota = M === 'RULA' ? o.av.rula.final : o.av.reba.final;
        const f = faixaDe(M, nota);
        if (f == null) continue;
        p.faixas[M][f] += dt;
        p.soma[M] += nota * dt;
        const pk = p.pico[M];
        if (!pk || nota > pk.nota) p.pico[M] = { nota, t, id: o.id, av: o.av, thumb: null, novo: true };
      }
      const f = faixaDe(metodo, metodo === 'REBA' ? o.av.reba.final : o.av.rula.final);
      if (f >= 3) {
        if (p.desdeAlto == null) p.desdeAlto = t;
        if (!p.emAlerta && t - p.desdeAlto >= alertaS) { p.emAlerta = true; p.alertas++; }
      } else { p.desdeAlto = null; p.emAlerta = false; }
    }
    return porPosto;
  }

  /** Resumo serializável por posto. takt: { nome → kpi do posto }; niosh: { LI, RWL, ... } da tarefa. */
  resumo(metodo = 'RULA', takt = null, niosh = null) {
    const out = [];
    for (const p of this.postos.values()) {
      const r = {};
      for (const M of ['RULA', 'REBA']) {
        const tot = p.faixas[M].reduce((a, b) => a + b, 0);
        const pk = p.pico[M];
        r[M] = {
          pct: p.faixas[M].map((x) => (tot > 0 ? (100 * x) / tot : 0)),
          media: tot > 0 ? p.soma[M] / tot : null,
          pico: pk ? { nota: pk.nota, faixa: faixaDe(M, pk.nota), nivel: nivel(M, pk.nota).nome, acao: nivel(M, pk.nota).acao, t: pk.t, id: pk.id, thumb: pk.thumb } : null,
        };
      }
      const R = r[metodo];
      const pr = prioridade(R.pct[3], R.pct[4], R.pico ? R.pico.faixa : 0, niosh && niosh.posto === p.nome ? niosh.LI : null);
      const pk = p.pico[metodo];
      out.push({
        nome: p.nome, tempoS: p.tempo, pessoas: p.pessoas.size, alertas: p.alertas, RULA: r.RULA, REBA: r.REBA,
        prioridade: pr, recomendacoes: pk ? recomendacoes(pk.av).slice(0, 6) : [],
        takt: takt ? takt[p.nome] || null : null,
      });
    }
    return out.sort((a, b) => b.prioridade.nivel - a.prioridade.nivel || b.tempoS - a.tempoS);
  }
}

// ------------------------------------------------------------------ relatório

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const n1 = (x, c = 1) => (Number.isFinite(x) ? x.toFixed(c).replace('.', ',') : '—');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x)} %` : '—');
const dur = (s) => {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m} min ${String(r).padStart(2, '0')} s` : `${r} s`;
};

/** Barra empilhada das faixas (HTML estático, imprime em PDF). */
function barra(pcts, metodo) {
  const ini = metodo === 'RULA' ? 1 : 0;
  return `<div class="bar">${pcts.slice(ini).map((v, i) => v > 0
    ? `<span style="width:${v.toFixed(2)}%;background:${FAIXAS[i + ini].cor}" title="${esc(FAIXAS[i + ini].nome)} ${pct(v)}"></span>` : '').join('')}</div>`;
}

/**
 * Relatório HTML completo (abre numa janela; o navegador imprime / salva PDF).
 * d = { cab: { empresa, setor, atividade, jornada, avaliador }, metodo, postos (resumo()), niosh, inicio, fim, duracaoS }
 */
export function htmlAEP(d) {
  const M = d.metodo === 'REBA' ? 'REBA' : 'RULA';
  const cab = d.cab || {};
  const legenda = NIVEIS[M].map((n) => `<li><span class="dot" style="background:${FAIXAS[n.faixa].cor}"></span><b>${n.de}${n.ate !== n.de ? '–' + n.ate : ''}</b> ${esc(n.nome)} — ${esc(n.acao)}</li>`).join('');
  const postos = d.postos.map((p) => {
    const R = p[M], O = p[M === 'RULA' ? 'REBA' : 'RULA'];
    const k = p.takt;
    return `
    <section class="posto">
      <h2>${esc(p.nome)} <span class="prio" style="background:${p.prioridade.cor}">prioridade ${esc(p.prioridade.nome)}</span></h2>
      <table class="kv">
        <tr><th>Tempo observado</th><td>${dur(p.tempoS)}</td><th>Pessoas distintas</th><td>${p.pessoas}</td></tr>
        <tr><th>${M} médio (tempo)</th><td>${n1(R.media)}</td><th>${M} pior</th><td>${R.pico ? `${R.pico.nota} — ${esc(R.pico.nivel)}` : '—'}</td></tr>
        <tr><th>${M === 'RULA' ? 'REBA' : 'RULA'} médio</th><td>${n1(O.media)}</td><th>${M === 'RULA' ? 'REBA' : 'RULA'} pior</th><td>${O.pico ? `${O.pico.nota} — ${esc(O.pico.nivel)}` : '—'}</td></tr>
        <tr><th>Alertas (faixa alta ≥ tempo)</th><td>${p.alertas}</td><th>Tempo em faixa alta/muito alta</th><td>${pct(R.pct[3] + R.pct[4])}</td></tr>
        ${k ? `<tr><th>Takt: produtivo</th><td>${pct(k.produtividade != null ? k.produtividade * 100 : NaN)}</td><th>ocioso · vago</th><td>${pct(k.ociosidade != null ? k.ociosidade * 100 : NaN)} · ${pct(k.vacancia != null ? k.vacancia * 100 : NaN)}</td></tr>` : ''}
      </table>
      <p class="sub">Tempo em cada nível (${M}):</p>${barra(R.pct, M)}
      <p class="leg">${R.pct.map((v, i) => (M === 'RULA' && i === 0 ? '' : `${esc(FAIXAS[i].nome)} ${pct(v)}`)).filter(Boolean).join(' · ')}</p>
      <div class="pior">
        ${R.pico && R.pico.thumb ? `<img src="${R.pico.thumb}" alt="Pior postura observada (rosto borrado)">` : '<div class="sem">sem miniatura</div>'}
        <div>
          <p><b>Pior postura:</b> ${R.pico ? `${M} ${R.pico.nota} (${esc(R.pico.nivel)}) — ${esc(R.pico.acao)}` : '—'}</p>
          ${p.recomendacoes.length ? `<p><b>Pontos de atenção sugeridos</b> (a confirmar no posto):</p><ul>${p.recomendacoes.map((r) => `<li><b>${esc(r.seg)}:</b> ${esc(r.texto)}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
    </section>`;
  }).join('');
  const N = d.niosh;
  const niosh = N && N.n ? `
    <section class="posto">
      <h2>Levantamento de carga — equação revisada do NIOSH</h2>
      <table class="kv">
        <tr><th>Levantamentos observados</th><td>${N.n}</td><th>Frequência</th><td>${n1(N.F, 2)} /min</td></tr>
        <tr><th>Carga (informada)</th><td>${n1(N.carga)} kg</td><th>Pega · duração · assimetria</th><td>${esc(N.pega)} · ${esc(N.duracao)} · ${n1(N.A, 0)}°</td></tr>
        <tr><th>LPR (RWL) crítico</th><td>${n1(N.RWL, 2)} kg</td><th>IL (LI) máximo</th><td><b>${n1(N.LI, 2)}</b> — ${esc(N.classe)}</td></tr>
        <tr><th>H origem/destino (média)</th><td>${n1(N.Ho, 0)} / ${n1(N.Hd, 0)} cm</td><th>V origem/destino (média)</th><td>${n1(N.Vo, 0)} / ${n1(N.Vd, 0)} cm</td></tr>
      </table>
      <p class="leg">H e V medidos pela pose com a escala da régua ou da estatura; carga, pega, duração e assimetria são entradas manuais.</p>
    </section>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>AEP — rascunho de apoio</title>
<style>
  :root { color-scheme: light; }
  body { font: 13px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1b1f1e; margin: 24px; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 15px; margin: 0 0 8px; display: flex; gap: 10px; align-items: center; }
  .aviso { border: 2px solid #b45309; background: #fff7ed; padding: 8px 10px; border-radius: 6px; margin: 10px 0 14px; }
  .kv { border-collapse: collapse; width: 100%; margin: 4px 0 8px; } .kv th, .kv td { border: 1px solid #d6dbd9; padding: 4px 6px; text-align: left; }
  .kv th { background: #f2f5f4; font-weight: 600; width: 22%; }
  .posto { border: 1px solid #d6dbd9; border-radius: 8px; padding: 12px; margin: 12px 0; page-break-inside: avoid; }
  .prio { font-size: 11px; color: #111; padding: 2px 8px; border-radius: 10px; }
  .bar { display: flex; height: 14px; border-radius: 4px; overflow: hidden; background: #e5e7eb; }
  .bar span { display: block; height: 100%; } .sub { margin: 6px 0 3px; } .leg { color: #4b5563; font-size: 11.5px; margin: 3px 0 0; }
  .pior { display: flex; gap: 12px; margin-top: 10px; align-items: flex-start; } .pior img { width: 180px; border-radius: 6px; border: 1px solid #d6dbd9; }
  .sem { width: 180px; height: 120px; display: grid; place-items: center; background: #f2f5f4; color: #6b7280; border-radius: 6px; }
  .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  ul { margin: 4px 0; padding-left: 18px; } .meta td { padding: 2px 10px 2px 0; } footer { color: #6b7280; font-size: 11px; margin-top: 18px; }
  @media print { body { margin: 10mm; } .naoimprime { display: none; } }
</style></head><body>
<p class="naoimprime"><button onclick="print()">Imprimir / salvar PDF</button></p>
<h1>Avaliação Ergonômica Preliminar (AEP) — rascunho de apoio</h1>
<table class="meta"><tr><td><b>Empresa/unidade:</b> ${esc(cab.empresa || '—')}</td><td><b>Setor:</b> ${esc(cab.setor || '—')}</td></tr>
<tr><td><b>Atividade:</b> ${esc(cab.atividade || '—')}</td><td><b>Jornada:</b> ${esc(cab.jornada || '—')}</td></tr>
<tr><td><b>Observação:</b> ${esc(d.inicio || '')} — ${dur(d.duracaoS)}</td><td><b>Método:</b> ${M} (+ ${M === 'RULA' ? 'REBA' : 'RULA'} como apoio)</td></tr>
<tr><td colspan="2"><b>Responsável pela avaliação:</b> ${esc(cab.avaliador || '______________________________ (ergonomista)')}</td></tr></table>
<p class="aviso" role="note"><b>⚠ Apoio ao ergonomista.</b> ${esc(AVISO_AEP)}</p>
<h2>Níveis de ação (${M})</h2><ul>${legenda}</ul>
${postos || '<p>Nenhum posto com observação válida.</p>'}
${niosh}
<section class="posto"><h2>Para a AEP / AET (preencher pelo ergonomista)</h2>
<p>Fatores não medidos pela câmera: organização do trabalho (ritmo, metas, pausas), conteúdo das tarefas, fatores cognitivos e
psicossociais, mobiliário e equipamentos, condições ambientais (ruído, iluminação, temperatura), relatos dos trabalhadores.</p>
<p>Conclusão: ____________________________________________________________________________</p>
<p>Encaminhamento (AET, medidas de prevenção, prazos): _______________________________________</p></section>
<footer>GPlanSiS iaVision — CV-60 Ergonomia aplicada (NR-17). Referências: NR-17 (Portaria MTP 423/2021); McAtamney & Corlett 1993 (RULA);
Hignett & McAtamney 2000 (REBA); Waters et al. 1993 (NIOSH). Gerado em ${esc(new Date().toLocaleString('pt-BR'))}. Nada da imagem saiu do navegador.</footer>
</body></html>`;
}

/** CSV por posto (; e vírgula decimal). */
export function csvAEP(postos, metodo = 'RULA') {
  const c = (v) => (v == null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '') : `"${String(v).replace(/"/g, '""')}"`);
  const cab = ['posto', 'tempo_s', 'pessoas', 'prioridade', `${metodo}_medio`, `${metodo}_pior`, ...NOMES_FAIXA.map((f) => `pct_${f.replace(/ /g, '_')}`), 'alertas', 'takt_produtividade', 'takt_ociosidade'];
  const linhas = postos.map((p) => {
    const R = p[metodo];
    return [p.nome, p.tempoS, p.pessoas, p.prioridade.nome, R.media, R.pico ? R.pico.nota : null, ...R.pct, p.alertas,
      p.takt && p.takt.produtividade != null ? p.takt.produtividade : null, p.takt && p.takt.ociosidade != null ? p.takt.ociosidade : null].map(c).join(';');
  });
  return '﻿' + [cab.join(';'), ...linhas].join('\n');
}
