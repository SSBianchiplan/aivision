/**
 * components/livres-u/AplicacoesPanel.js — painel «Aplicações» (onda 2-d, CV-80..87),
 * carregado sob demanda. Uma seção por operador do grupo U no Pipeline (ou que já
 * publicou), mais as «Ferramentas de vídeo» (K4 busca e M2 cortes por fala), que
 * trabalham sobre um arquivo e estão sempre disponíveis:
 *
 *   Física          g, parábola, tabela t·x·y·v·a, gráfico, CSV
 *   Cena falada     o botão grande «O que tem na minha frente?»
 *   Mouse cabeça    calibração de 5 posições, estado
 *   Libras          texto soletrado, gravar exemplos por letra, exportar/importar
 *   Gabarito        folha-modelo imprimível, folhas lidas, CSV
 *   Mãos            agora, máximo, série, CSV
 *   Cortes/miniatura → marcadores / instante no editor GPlanSiS|Vídeo; varrer arquivo
 *   Agro            verde, armadilha, locomoção, peso (calibração com a balança)
 *   Câmera de jogo  reenquadramento → editor
 *   Diário de obra  RDO em HTML/PDF, fotos, Via opcional (opt-in)
 *
 * Os operadores publicam em cv/runtime/livres-u/canal.js (chaves u_*); aqui só se lê,
 * exporta e manda comandos (pedir).
 */
import { html, useState, useEffect, useRef } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { assinar, ler, zerar, csv, hora, pedir } from '../../cv/runtime/livres-u/canal.js';
import { baixar } from '../../cv/marcacoes.js';
import { folhaHTML, layoutGabarito } from '../../cv/runtime/livres-u/sala.js';
import { ROTULO_LOCOMOCAO } from '../../cv/runtime/livres-u/agro.js';
import { DetectorCortes, capitulos, melhoresTrechos, srt, vtt, textoCapitulos, relogio, lerLegenda } from '../../cv/runtime/livres-u/midia.js';
import { relatorioHTML, resumoTexto } from '../../cv/runtime/livres-u/obra.js';
import { ler as lerDb } from '../../cv/runtime/livres-u/db.js';
import { AVISO_LIBRAS } from '../../cv/operators/livres-u/libras.js';
import { AVISO_AGRO } from '../../cv/operators/livres-u/agro.js';
import { falar } from '../../cv/operators/livres-u/acessivel.js';
import { arquivoDaFonte, marcadoresNoEditor, irNoEditor, trechosNoEditor, seguirNoEditor, varrerVideo, quadroEm } from './editor.js';

function carregarCss() {
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  for (const [arq, marca] of [['css/medicoes.css', 'data-medicoes'], ['css/livres-u.css', 'data-livres-u']]) {
    if (document.querySelector(`link[${marca}]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = arq + (v ? '?' + v : ''); l.setAttribute(marca, '');
    document.head.appendChild(l);
  }
}

const carimbo = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const fmt = (v, c = 2) => (Number.isFinite(v) ? v.toFixed(c).replace('.', ',') : '—');
const temNo = (nodes, ops) => nodes.some((n) => n.enabled !== false && ops.includes(n.op));
const noDe = (nodes, op) => nodes.find((n) => n.op === op);
const abrirHtml = (txt) => { const u = URL.createObjectURL(new Blob([txt], { type: 'text/html' })); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000); };

export function AplicacoesPanel({ onClose, source, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const [, setV] = useState(0);
  useEffect(() => { carregarCss(); return assinar(() => setV((n) => n + 1)); }, []);
  const tem = (k, ops) => Boolean(ler(k)) || temNo(nodes, ops);
  const secoes = [
    tem('u_fisica', ['fisica.trajetoria']) && html`<${SecaoFisica} key="f" />`,
    tem('u_falar', ['acessivel.falar']) && html`<${SecaoFalar} key="x1" />`,
    tem('u_mouse', ['acessivel.mouse_cabeca']) && html`<${SecaoMouse} key="x2" />`,
    tem('u_libras', ['libras.soletrar']) && html`<${SecaoLibras} key="x3" />`,
    tem('u_gabarito', ['educacao.gabarito']) && html`<${SecaoGabarito} key="g" nodes=${nodes} />`,
    tem('u_maos', ['educacao.maos_levantadas']) && html`<${SecaoMaos} key="m" />`,
    tem('u_cortes', ['midia.corte_cena']) && html`<${SecaoCortes} key="c" source=${source} />`,
    tem('u_miniatura', ['midia.miniatura']) && html`<${SecaoMiniatura} key="mi" source=${source} />`,
    tem('u_verde', ['agro.verde']) && html`<${SecaoVerde} key="v" />`,
    tem('u_armadilha', ['agro.armadilha']) && html`<${SecaoArmadilha} key="a" />`,
    tem('u_locomocao', ['agro.locomocao']) && html`<${SecaoLocomocao} key="l" />`,
    tem('u_peso', ['agro.peso_dorsal']) && html`<${SecaoPeso} key="p" />`,
    tem('u_jogo', ['jogo.camera']) && html`<${SecaoJogo} key="j" source=${source} nodes=${nodes} />`,
    tem('u_obra', ['obra.diario']) && html`<${SecaoObra} key="o" />`,
  ].filter(Boolean);
  return html`
    <${Panel} id="aplicacoes" title="Aplicações" subtitle=${secoes.length ? `${secoes.length} em uso` : 'educação, acessibilidade, mídia, agro, obra'} onClose=${onClose} ...${layout}>
      ${!secoes.length && html`<p class="hint tight">Física por vídeo, cena falada, mouse por cabeça, Libras (soletração), gabarito,
        mãos levantadas, cortes de cena, miniatura, agro, câmera de jogo e diário de obra. Carregue um preset em <b>Pipeline</b>
        (grupos Laboratório e educação, Acessibilidade, Mídia e criação, Agro e pecuária, Esportes, Construção).</p>`}
      ${secoes}
      <${FerramentasVideo} source=${source} />
    <//>
  `;
}

function Cab({ titulo, children }) {
  return html`<div class="cfg-sub med-cab"><span>${titulo}</span><span class="med-acoes">${children}</span></div>`;
}

/** Gráfico de linhas simples (SVG). series = [{ pts: [[x,y]], classe, nome, so: 'pontos'|'linha' }]. */
function Grafico({ series, rotX = '', rotY = '', altura = 120 }) {
  const todos = series.flatMap((s) => s.pts).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (todos.length < 2) return null;
  let x0 = Math.min(...todos.map((p) => p[0])), x1 = Math.max(...todos.map((p) => p[0]));
  let y0 = Math.min(...todos.map((p) => p[1])), y1 = Math.max(...todos.map((p) => p[1]));
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) { y1 += 1; y0 -= 1; }
  const W = 280, H = altura, m = 4;
  const X = (x) => m + ((x - x0) / (x1 - x0)) * (W - 2 * m), Y = (y) => H - m - ((y - y0) / (y1 - y0)) * (H - 2 * m);
  return html`
    <div class="lu-graf">
      <svg viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label=${`${rotY} × ${rotX}`}>
        ${series.map((s, i) => s.so === 'pontos'
          ? html`<g key=${i} class=${'lu-s ' + (s.classe || '')}>${s.pts.filter(([x, y]) => Number.isFinite(y)).map(([x, y], k) => html`<circle key=${k} cx=${X(x)} cy=${Y(y)} r="1.8" />`)}</g>`
          : html`<polyline key=${i} class=${'lu-s ' + (s.classe || '')} points=${s.pts.filter(([, y]) => Number.isFinite(y)).map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ')} />`)}
      </svg>
      <div class="lu-graf-eixos"><span>${rotY}: ${fmt(y0)} … ${fmt(y1)}</span><span>${rotX}: ${fmt(x0)} … ${fmt(x1)}</span></div>
      <div class="lu-leg">${series.filter((s) => s.nome).map((s) => html`<span class=${'lu-s ' + (s.classe || '')}>${s.nome}</span>`)}</div>
    </div>`;
}

// ------------------------------------------------------------------ D1 física

function SecaoFisica() {
  const d = ler('u_fisica');
  if (!d) return html`<${Cab} titulo="Laboratório de física" /><p class="hint tight">Aguardando o objeto. Calibre uma régua sobre uma medida conhecida e dê play.</p>`;
  const a = d.analise || {}, u = d.unidade, am = d.amostras;
  const t0 = am.length ? am[0].t : 0;
  const ajuste = a.tipo === 'queda' && a.ajuste ? am.map((p) => [p.t - t0, a.ajuste[0] + a.ajuste[1] * p.t + a.ajuste[2] * p.t * p.t]) : null;
  const baixarCsv = () => baixar(`fisica_${carimbo()}.csv`, csv(['t_s', `x_${u}`, `y_${u}`, `vx_${u}_s`, `vy_${u}_s`, `ax_${u}_s2`, `ay_${u}_s2`],
    am.map((p) => [+(p.t - t0).toFixed(4), +p.x.toFixed(5), +p.y.toFixed(5), +p.vx.toFixed(4), +p.vy.toFixed(4), +p.ax.toFixed(3), +p.ay.toFixed(3)])), 'text/csv');
  return html`
    <${Cab} titulo="Laboratório de física">
      <button class="btn tiny" disabled=${!am.length} onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('u_fisica')}>Nova medida</button>
    <//>
    ${!d.escalaOk && html`<p class="hint tight lu-aviso">Sem escala: valores em px. Calibre uma régua (Ferramentas de mouse) ou informe mm/px no operador.</p>`}
    <div class="kpis med-kpis">
      ${a.tipo === 'queda' && html`<div class="kpi"><b>${fmt(a.g)}</b><em>g (${u}/s²)</em></div><div class="kpi"><b>${fmt(a.v0y)}</b><em>v₀y (${u}/s)</em></div>
        <div class="kpi"><b>${fmt(a.vx)}</b><em>vx (${u}/s)</em></div><div class="kpi"><b>${fmt(a.r2, 4)}</b><em>R²</em></div>`}
      ${a.tipo === 'pendulo' && html`<div class="kpi"><b>${fmt(a.T, 3)}</b><em>período (s)</em></div><div class="kpi"><b>${fmt(a.g)}</b><em>g (${u}/s²)</em></div>
        <div class="kpi"><b>${a.n ?? '—'}</b><em>oscilações</em></div><div class="kpi"><b>${fmt(a.amp, 3)}</b><em>amplitude (${u})</em></div>`}
      ${a.tipo === 'rampa' && html`<div class="kpi"><b>${fmt(a.a)}</b><em>a (${u}/s²)</em></div><div class="kpi"><b>${fmt(a.angulo, 1)}°</b><em>inclinação</em></div>
        <div class="kpi"><b>${fmt(a.a && a.angulo ? a.a / Math.sin((a.angulo * Math.PI) / 180) : NaN)}</b><em>g sem atrito</em></div><div class="kpi"><b>${fmt(a.r2, 4)}</b><em>R²</em></div>`}
      <div class="kpi"><b>${am.length}</b><em>amostras</em></div>
    </div>
    ${a.tipo === 'queda' && html`<p class="hint tight">Parábola: y(t) = ${fmt(a.ajuste && a.ajuste[0], 3)} + ${fmt(a.ajuste && a.ajuste[1], 3)}·t ${a.ajuste && a.ajuste[2] < 0 ? '−' : '+'} ${fmt(a.ajuste && Math.abs(a.ajuste[2]), 3)}·t² (t do vídeo, y para cima)</p>`}
    <${Grafico} rotX="t (s)" rotY=${`y (${u})`} series=${[{ pts: am.map((p) => [p.t - t0, p.y]), classe: 'a', nome: 'y medido', so: 'pontos' }, ...(ajuste ? [{ pts: ajuste, classe: 'b', nome: 'ajuste' }] : []), { pts: am.map((p) => [p.t - t0, p.x]), classe: 'c', nome: 'x', so: 'pontos' }]} />
    <${Grafico} rotX="t (s)" rotY=${`v (${u}/s)`} altura=${80} series=${[{ pts: am.map((p) => [p.t - t0, p.vy]), classe: 'a', nome: 'vy' }, { pts: am.map((p) => [p.t - t0, p.vx]), classe: 'c', nome: 'vx' }]} />
    ${am.length > 0 && html`<div class="med-tab lu-rolar"><table><thead><tr><th>t (s)</th><th>x</th><th>y</th><th>vy</th><th>ay</th></tr></thead>
      <tbody>${am.slice(-40).map((p, i) => html`<tr key=${i}><td>${fmt(p.t - t0, 3)}</td><td class="v">${fmt(p.x, 3)}</td><td class="v">${fmt(p.y, 3)}</td><td class="v">${fmt(p.vy)}</td><td class="v">${fmt(p.ay, 1)}</td></tr>`)}</tbody></table></div>`}
  `;
}

// ------------------------------------------------------------------ X1 cena falada

function SecaoFalar() {
  const d = ler('u_falar') || {};
  return html`
    <${Cab} titulo="O que tem na minha frente?" />
    <button class="btn lu-grande" onClick=${() => pedir('u_falar', { tipo: 'falar' })} aria-describedby="lu-frase">🔊 O que tem na minha frente?</button>
    <p id="lu-frase" class="lu-frase" aria-live="polite">${d.ultimaFrase || d.frase || '…'}</p>
    <p class="hint tight">${d.semVoz ? 'Este navegador não tem síntese de voz.' : d.voz ? `Voz: ${d.voz}` : 'Voz do navegador (pt-BR).'} Tudo é processado aqui; nenhuma imagem sai do aparelho.</p>
  `;
}

// ------------------------------------------------------------------ X2 mouse por cabeça

function SecaoMouse() {
  const d = ler('u_mouse') || {};
  return html`
    <${Cab} titulo="Mouse por cabeça">
      <button class="btn tiny" onClick=${() => pedir('u_mouse', { tipo: 'calibrar' })}>Calibrar (5 posições)</button>
      <button class="btn tiny" onClick=${() => pedir('u_mouse', { tipo: 'esquecer' })}>Esquecer calibração</button>
    <//>
    <div class="kpis med-kpis">
      <div class="kpi"><b>${d.rosto ? 'sim' : 'não'}</b><em>rosto</em></div>
      <div class="kpi"><b>${d.calibrando ? `${d.calibrando}/5` : d.calibrado ? 'sim' : 'não'}</b><em>calibrado</em></div>
      <div class="kpi"><b>${d.pausado ? 'pausa' : 'ativo'}</b><em>estado</em></div>
      <div class="kpi"><b>${d.cliques || 0}</b><em>cliques</em></div>
    </div>
    <p class="hint tight">Piscada longa (os dois olhos, ~0,4–1,2 s) clica; olhos fechados por 2 s pausam ou retomam. Último clique: ${d.ultimoAlvo || '—'}.
      yaw ${fmt(d.yaw, 1)}° · pitch ${fmt(d.pitch, 1)}° · EAR ${fmt(d.ear)}. ${d.msg || ''}</p>
  `;
}

// ------------------------------------------------------------------ X3 Libras

const ALFABETO = 'ABCDEFGILMNOPQRSTUVWY'.split('');
function SecaoLibras() {
  const d = ler('u_libras') || { texto: '', exemplos: {} };
  const [letra, setLetra] = useState('A');
  const arqRef = useRef(null);
  const exportar = () => { try { baixar(`libras_exemplos_${carimbo()}.json`, localStorage.getItem('gplansis.libras.exemplos.v1') || '{}'); } catch (_) { /* sem storage */ } };
  const importar = async (f) => { if (!f) return; try { pedir('u_libras', { tipo: 'importar', dados: JSON.parse(await f.text()) }); } catch (e) { alert('Arquivo inválido: ' + e.message); } };
  return html`
    <${Cab} titulo="Libras — soletração" />
    <p class="hint tight lu-aviso">${AVISO_LIBRAS}</p>
    <p class="lu-texto" aria-live="polite">${d.texto || ' '}<span class="lu-cand">${d.candidata ? ` ${d.candidata}` : ''}</span></p>
    <div class="med-acoes lu-linha">
      <button class="btn tiny" onClick=${() => pedir('u_libras', { tipo: 'espaco' })}>Espaço</button>
      <button class="btn tiny" onClick=${() => pedir('u_libras', { tipo: 'apagar' })}>⌫ Apagar</button>
      <button class="btn tiny" onClick=${() => pedir('u_libras', { tipo: 'limpar' })}>Limpar</button>
      <button class="btn tiny" disabled=${!d.texto} onClick=${() => falar(d.texto)}>🔊 Falar</button>
    </div>
    <p class="hint tight">${d.temMao ? `Mão: ${d.candidata || '?'} (${d.fonte || '—'}${d.conf ? ' ' + Math.round(d.conf * 100) + '%' : ''})` : 'Sem mão no quadro.'}</p>
    <div class="cfg-sub">Gravar exemplos (recomendado)</div>
    <div class="med-acoes lu-linha">
      <select value=${letra} onChange=${(e) => setLetra(e.target.value)} aria-label="Letra">${ALFABETO.map((l) => html`<option key=${l} value=${l}>${l}</option>`)}</select>
      <button class="btn tiny" disabled=${Boolean(d.gravando)} onClick=${() => pedir('u_libras', { tipo: 'gravar', letra, n: 5 })}>${d.gravando ? `gravando ${d.gravando.letra}… faltam ${d.gravando.faltam}` : 'Gravar 5 exemplos'}</button>
      <button class="btn tiny" disabled=${!d.exemplos[letra]} onClick=${() => pedir('u_libras', { tipo: 'apagarLetra', letra })}>Apagar ${letra}</button>
    </div>
    <p class="hint tight">Faça a letra parada diante da câmera e clique em gravar; mexa levemente a mão entre as amostras. Gravados:
      ${Object.keys(d.exemplos).length ? Object.entries(d.exemplos).map(([k, n]) => `${k}×${n}`).join(' ') : 'nenhum (usando só as regras)'}.</p>
    <div class="med-acoes lu-linha">
      <button class="btn tiny" onClick=${exportar}>Exportar exemplos</button>
      <button class="btn tiny" onClick=${() => arqRef.current.click()}>Importar…</button>
      <input ref=${arqRef} type="file" accept="application/json" hidden onChange=${(e) => importar(e.target.files[0])} />
    </div>
  `;
}

// ------------------------------------------------------------------ 92 gabarito

function SecaoGabarito({ nodes }) {
  const d = ler('u_gabarito') || { folhas: [] };
  const no = noDe(nodes, 'educacao.gabarito');
  const P = no ? no.params : { questoes: 20, alternativas: 5, colunas: 2, digitos: 4 };
  const cfg = { questoes: P.questoes, alternativas: P.alternativas, colunas: P.colunas, digitos: P.digitos };
  const [titulo, setTitulo] = useState('Avaliação');
  const L = layoutGabarito(cfg);
  const imprimir = () => abrirHtml(folhaHTML(cfg, titulo, 1));
  const baixarFolha = () => baixar(`folha_${cfg.questoes}q_${cfg.alternativas}alt.html`, folhaHTML(cfg, titulo, 1), 'text/html');
  const baixarCsv = () => baixar(`gabarito_${carimbo()}.csv`, csv(['folha', 'matricula', 'acertos', 'total', 'nota', ...Array.from({ length: cfg.questoes }, (_, i) => `q${i + 1}`)],
    d.folhas.map((f) => [f.n, f.matricula, f.acertos, f.total, f.nota != null ? +f.nota.toFixed(2) : '', ...f.respostas.map((r, i) => r || (f.estados[i] === 'branco' ? '' : f.estados[i]))])), 'text/csv');
  const media = d.folhas.length ? d.folhas.reduce((s, f) => s + (f.nota || 0), 0) / d.folhas.length : NaN;
  return html`
    <${Cab} titulo="Gabarito (OMR)">
      <button class="btn tiny" disabled=${!d.folhas.length} onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => pedir('u_gabarito', { tipo: 'registrar' })} title="Registrar a leitura atual mesmo sem repetição">Registrar agora</button>
      <button class="btn tiny" onClick=${() => confirm('Apagar as folhas lidas?') && zerar('u_gabarito')}>Zerar</button>
    <//>
    <div class="med-acoes lu-linha">
      <input class="lu-in" value=${titulo} onInput=${(e) => setTitulo(e.target.value)} aria-label="Título da folha" />
      <button class="btn tiny" disabled=${!L.ok} onClick=${imprimir}>Folha-modelo (imprimir)</button>
      <button class="btn tiny" disabled=${!L.ok} onClick=${baixarFolha}>Baixar HTML</button>
    </div>
    <p class="hint tight">${L.ok ? `${cfg.questoes} questões × ${cfg.alternativas} alternativas, ${cfg.colunas} coluna(s), matrícula de ${cfg.digitos} dígitos — a mesma configuração do operador.` : L.erro}
      ${d.chave ? '' : ' Sem chave no operador: só as respostas são lidas.'} Imprima em A4 a 100%.</p>
    ${d.motivo && html`<p class="hint tight lu-aviso">Agora: ${d.motivo}</p>`}
    <div class="kpis med-kpis"><div class="kpi"><b>${d.folhas.length}</b><em>folhas</em></div><div class="kpi"><b>${fmt(media, 1)}</b><em>média</em></div>
      ${d.atual && html`<div class="kpi"><b>${d.atual.acertos}/${d.atual.total || '—'}</b><em>na câmera</em></div>`}</div>
    ${d.folhas.length > 0 && html`<div class="med-tab lu-rolar"><table><thead><tr><th>#</th><th>matrícula</th><th>acertos</th><th>nota</th><th>avisos</th><th></th></tr></thead>
      <tbody>${d.folhas.slice().reverse().map((f) => {
        const av = f.estados.map((e, i) => (e === 'ok' || e === 'branco' ? '' : `${i + 1}:${e}`)).filter(Boolean);
        const br = f.estados.filter((e) => e === 'branco').length;
        return html`<tr key=${f.n}><td>${f.n}</td><td>${f.matricula || '—'}</td><td class="v">${f.acertos}/${f.total}</td><td class="v">${f.nota != null ? fmt(f.nota, 1) : '—'}</td>
          <td>${[br ? `${br} em branco` : '', ...av].filter(Boolean).join(' · ') || '—'}</td><td><button class="btn tiny" onClick=${() => pedir('u_gabarito', { tipo: 'apagar', i: f.n - 1 })} aria-label="Apagar folha">✕</button></td></tr>`;
      })}</tbody></table></div>`}
  `;
}

// ------------------------------------------------------------------ 94 mãos levantadas

function SecaoMaos() {
  const d = ler('u_maos') || { serie: [] };
  const baixarCsv = () => baixar(`maos_levantadas_${carimbo()}.csv`, csv(['segundo', 'maos_levantadas'], d.serie.map((x) => [x.s, x.n])), 'text/csv');
  return html`
    <${Cab} titulo="Mãos levantadas">
      <button class="btn tiny" disabled=${!d.serie.length} onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('u_maos')}>Zerar</button>
    <//>
    <div class="kpis med-kpis"><div class="kpi"><b>${d.agora ?? 0}</b><em>agora</em></div><div class="kpi"><b>${d.max ?? 0}</b><em>máximo</em></div>
      <div class="kpi"><b>${d.eventos ?? 0}</b><em>levantadas</em></div><div class="kpi"><b>${d.pessoas ?? 0}</b><em>pessoas</em></div></div>
    <${Grafico} rotX="s" rotY="mãos" altura=${60} series=${[{ pts: d.serie.map((x) => [x.s, x.n]), classe: 'a' }]} />
    <p class="hint tight">Só contagem: ninguém é identificado e nenhuma imagem é guardada.</p>
  `;
}

// ------------------------------------------------------------------ 95 cortes de cena

function useArquivo(source) {
  const [estado, setEstado] = useState('');
  const obter = async () => {
    const a = await arquivoDaFonte(source);
    if (!a) { setEstado('A Fonte não é um arquivo de vídeo. Abra um vídeo em Fonte › Arquivo.'); return null; }
    setEstado('');
    return a;
  };
  return [obter, estado, setEstado];
}

function SecaoCortes({ source }) {
  const d = ler('u_cortes') || { cortes: [] };
  const [obter, estado, setEstado] = useArquivo(source);
  const [prog, setProg] = useState(null);
  const sinal = useRef({ cancelar: false });
  const editor = async () => { const a = await obter(); if (a) marcadoresNoEditor(a, d.cortes.map((c) => c.t), 'marcadores de corte'); };
  const varrer = async () => {
    const a = await obter(); if (!a) return;
    sinal.current = { cancelar: false };
    const det = new DetectorCortes();
    const cortes = [];
    setProg(0);
    try {
      await varrerVideo(a.blob, 1 / 8, (img, t) => { if (det.passo(t, img).corte) cortes.push({ t, d: 0 }); }, { maxW: 320, sinal: sinal.current, progresso: setProg });
      pedir('u_cortes', { tipo: 'importar', cortes });
      setEstado(`${cortes.length} corte(s) no arquivo (passo de 1/8 s).`);
    } catch (e) { setEstado('Falhou: ' + e.message); }
    setProg(null);
  };
  const baixarCsv = () => baixar(`cortes_${carimbo()}.csv`, csv(['instante_s', 'hhmmss'], d.cortes.map((c) => [+c.t.toFixed(3), hora(c.t, 'video')])), 'text/csv');
  return html`
    <${Cab} titulo="Corte de cena">
      <button class="btn tiny" disabled=${!d.cortes.length} onClick=${editor}>Marcadores no editor</button>
      <button class="btn tiny" disabled=${!d.cortes.length} onClick=${baixarCsv}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('u_cortes')}>Zerar</button>
    <//>
    <div class="med-acoes lu-linha">
      ${prog == null ? html`<button class="btn tiny" onClick=${varrer}>Varrer o arquivo inteiro</button>`
        : html`<progress max="1" value=${prog} /><button class="btn tiny" onClick=${() => { sinal.current.cancelar = true; }}>Cancelar</button>`}
    </div>
    <p class="hint tight">${d.cortes.length} corte(s): ${d.cortes.slice(0, 12).map((c) => relogio(c.t) + (c.t % 1 ? ',' + String(Math.round((c.t % 1) * 10)) : '')).join(' · ') || '—'}${d.cortes.length > 12 ? ' …' : ''}</p>
    ${estado && html`<p class="hint tight lu-aviso">${estado}</p>`}
  `;
}

// ------------------------------------------------------------------ 96 miniatura

function Miniatura({ img }) {
  const ref = useRef(null);
  useEffect(() => { const c = ref.current; if (!c || !img) return; c.width = img.width; c.height = img.height; c.getContext('2d').putImageData(img, 0, 0); }, [img]);
  return html`<canvas ref=${ref} class="lu-mini" />`;
}

function SecaoMiniatura({ source }) {
  const d = ler('u_miniatura') || { melhores: [] };
  const [obter, estado] = useArquivo(source);
  const jpegDe = async (m) => {
    let blob = null;
    if (m.relogio === 'video') { const a = await arquivoDaFonte(source); if (a) blob = await quadroEm(a.blob, m.t); }
    if (!blob) { const c = document.createElement('canvas'); c.width = m.img.width; c.height = m.img.height; c.getContext('2d').putImageData(m.img, 0, 0); blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92)); }
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = `miniatura_${relogio(m.t).replace(/:/g, '-')}.jpg`; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
  };
  const editor = async (m) => { const a = await obter(); if (a) irNoEditor(a, m.t); };
  return html`
    <${Cab} titulo="Melhor quadro para miniatura"><button class="btn tiny" onClick=${() => zerar('u_miniatura')}>Zerar</button><//>
    ${!d.melhores.length && html`<p class="hint tight">Toque o vídeo: os melhores quadros aparecem aqui.</p>`}
    <div class="lu-minis">${d.melhores.map((m, i) => html`
      <figure key=${i} class="lu-fig"><${Miniatura} img=${m.img} />
        <figcaption>${m.relogio === 'video' ? relogio(m.t) : hora(m.t, m.relogio)} · nota ${fmt(m.nota)}${m.rostos ? ' · rosto' : ''}</figcaption>
        <span class="med-acoes"><button class="btn tiny" onClick=${() => jpegDe(m)}>JPEG</button>
          ${m.relogio === 'video' && html`<button class="btn tiny" onClick=${() => editor(m)}>No editor</button>`}</span>
      </figure>`)}</div>
    ${estado && html`<p class="hint tight lu-aviso">${estado}</p>`}
  `;
}

// ------------------------------------------------------------------ agro

function SecaoVerde() {
  const d = ler('u_verde') || { areas: [], serie: [] };
  const baixarCsv = () => baixar(`indice_verde_${carimbo()}.csv`, csv(['instante', ...d.areas.map((a) => `cobertura_${a.nome}`)], d.serie.map((s) => [hora(s.t, s.relogio), ...s.v.map((x) => +(x * 100).toFixed(2))])), 'text/csv');
  return html`
    <${Cab} titulo=${`Índice de verde (${d.indice || 'ExG'})`}>
      <button class="btn tiny" disabled=${!d.serie.length} onClick=${baixarCsv}>CSV</button><button class="btn tiny" onClick=${() => zerar('u_verde')}>Zerar</button>
    <//>
    <div class="kpis med-kpis">${d.areas.map((a) => html`<div class="kpi" key=${a.nome}><b>${fmt(a.cobertura * 100, 1)}%</b><em>${a.nome}</em></div>`)}</div>
    <p class="hint tight">${d.areas.map((a) => `${a.nome}: índice médio ${fmt(a.media, 3)}, no verde ${fmt(a.mediaVerde, 3)}, limiar ${fmt(a.limiar, 3)}`).join(' · ')}.
      Câmera RGB: compare sempre no mesmo horário e luz; não é NDVI.</p>
  `;
}

function SecaoArmadilha() {
  const d = ler('u_armadilha') || { cartoes: [], hist: {} };
  const linhas = Object.entries(d.hist).flatMap(([nome, h]) => h.map((x) => [nome, new Date(x.quando).toLocaleString('pt-BR'), x.n]));
  return html`
    <${Cab} titulo="Insetos na armadilha">
      <button class="btn tiny" disabled=${!linhas.length} onClick=${() => baixar(`armadilha_${carimbo()}.csv`, csv(['cartao', 'quando', 'insetos'], linhas), 'text/csv')}>CSV</button>
      <button class="btn tiny" onClick=${() => zerar('u_armadilha')}>Zerar</button>
    <//>
    <div class="kpis med-kpis">${d.cartoes.map((c) => html`<div class="kpi" key=${c.nome}><b>${c.n}</b><em>${c.nome}</em></div>`)}</div>
    ${Object.entries(d.hist).map(([nome, h]) => html`<${Grafico} key=${nome} rotX="leitura" rotY=${nome} altura=${50} series=${[{ pts: h.slice(-300).map((x, i) => [i, x.n]), classe: 'a' }]} />`)}
    <p class="hint tight">Conta manchas escuras; não identifica espécie. Troque o cartão e zere para uma nova série.</p>
  `;
}

function SecaoLocomocao() {
  const d = ler('u_locomocao') || { animais: [] };
  const cont = [1, 2, 3, 4, 5].map((k) => d.animais.filter((a) => a.escore === k).length);
  const baixarCsv = () => baixar(`locomocao_${carimbo()}.csv`, csv(['n', 'id_rastreio', 'instante_s', 'escore', 'rotulo', 'vel_corpos_s', 'cv_passo', 'paradas', 'balanco_pct', 'motivos'],
    d.animais.map((a) => [a.n, a.id, +a.t.toFixed(2), a.escore, a.rotulo, +a.vMed.toFixed(3), +a.cv.toFixed(3), a.paradas, +(a.bob * 100).toFixed(2), a.motivos.join('; ')])), 'text/csv');
  return html`
    <${Cab} titulo="Escore de locomoção"><button class="btn tiny" disabled=${!d.animais.length} onClick=${baixarCsv}>CSV</button><button class="btn tiny" onClick=${() => zerar('u_locomocao')}>Zerar</button><//>
    <p class="hint tight lu-aviso">${AVISO_AGRO}</p>
    <div class="kpis med-kpis">${cont.map((n, i) => html`<div class="kpi" key=${i}><b>${n}</b><em>escore ${i + 1}</em></div>`)}</div>
    ${d.animais.length > 0 && html`<div class="med-tab lu-rolar"><table><thead><tr><th>#</th><th>escore</th><th>motivos</th></tr></thead>
      <tbody>${d.animais.slice(-30).reverse().map((a) => html`<tr key=${a.n}><td>${a.n}</td><td class="v">${a.escore} · ${ROTULO_LOCOMOCAO[a.escore]}</td><td>${a.motivos.join('; ') || '—'}</td></tr>`)}</tbody></table></div>`}
    <p class="hint tight">${d.emCena || 0} animal(is) em cena. Cada passagem completa (≥ 1 corpo, ≥ 1,5 s) recebe um escore.</p>
  `;
}

function SecaoPeso() {
  const d = ler('u_peso') || { pares: [], registros: [] };
  const [kg, setKg] = useState('');
  const [animal, setAnimal] = useState('');
  const baixarCsv = () => baixar(`peso_dorsal_${carimbo()}.csv`, csv(['n', 'animal', 'quando', 'area_m2', 'kg_estimado'],
    d.registros.map((r) => [r.n, r.animal, new Date(r.quando).toLocaleString('pt-BR'), +r.m2.toFixed(4), r.kg ? +r.kg.toFixed(1) : ''])), 'text/csv');
  return html`
    <${Cab} titulo="Peso pela área dorsal"><button class="btn tiny" disabled=${!d.registros.length} onClick=${baixarCsv}>CSV</button><//>
    <p class="hint tight lu-aviso">ESTIMATIVA. ${AVISO_AGRO}</p>
    <div class="kpis med-kpis"><div class="kpi"><b>${d.kg ? fmt(d.kg, 0) : '—'}</b><em>kg (estim.)</em></div><div class="kpi"><b>${fmt(d.m2, 3)}</b><em>área m²</em></div>
      <div class="kpi"><b>${d.pares.length}</b><em>pesagens</em></div></div>
    <p class="hint tight">${!d.escalaOk ? 'Calibre uma régua no piso (mm/px). ' : ''}${d.formula ? `kg = ${fmt(d.formula.a, 1)} · A^${fmt(d.formula.b, 3)} — ${d.formula.origem}` : 'Sem fórmula: registre 3 ou mais pesagens reais com o animal na área.'}</p>
    <div class="med-acoes lu-linha">
      <input class="lu-in lu-num" type="number" min="1" step="0.5" placeholder="kg da balança" value=${kg} onInput=${(e) => setKg(e.target.value)} aria-label="Peso real (kg)" />
      <button class="btn tiny" disabled=${!d.m2 || !(+kg > 0)} onClick=${() => { pedir('u_peso', { tipo: 'calibrar', kg: +kg }); setKg(''); }}>Usar para calibrar</button>
      <button class="btn tiny" disabled=${!d.pares.length} onClick=${() => confirm('Apagar a calibração?') && pedir('u_peso', { tipo: 'limparCalibracao' })}>Limpar calibração</button>
    </div>
    <div class="med-acoes lu-linha">
      <input class="lu-in" placeholder="brinco / lote" value=${animal} onInput=${(e) => setAnimal(e.target.value)} aria-label="Identificação do animal" />
      <button class="btn tiny" disabled=${!d.m2} onClick=${() => pedir('u_peso', { tipo: 'registrar', animal })}>Registrar animal</button>
    </div>
    ${d.pares.length > 0 && html`<p class="hint tight">Pares: ${d.pares.map((p) => `${fmt(p.area, 3)} m² → ${fmt(p.kg, 0)} kg`).join(' · ')}</p>`}
  `;
}

// ------------------------------------------------------------------ E1 câmera de jogo

function SecaoJogo({ source, nodes }) {
  const d = ler('u_jogo') || { n: 0 };
  const [prop, setProp] = useState('16:9');
  const [obter, estado, setEstado] = useArquivo(source);
  const no = noDe(nodes, 'jogo.camera');
  const aplicar = async () => {
    const a = await obter(); if (!a) return;
    const [w, h] = prop.split(':').map(Number);
    try { await seguirNoEditor(a, d.amostras || [], w / h, no ? no.params.zoom : 1.8, no ? { suavidade: no.params.suavidade, zonaMorta: no.params.zonaMorta, vMax: no.params.vMax } : {}); }
    catch (e) { setEstado('Falhou: ' + e.message); }
  };
  return html`
    <${Cab} titulo="Câmera de jogo"><button class="btn tiny" onClick=${() => zerar('u_jogo')}>Zerar</button><//>
    <div class="kpis med-kpis"><div class="kpi"><b>${d.n || 0}</b><em>amostras</em></div><div class="kpi"><b>${d.bola ? 'sim' : 'não'}</b><em>bola agora</em></div></div>
    <p class="hint tight">Suavização: ${d.suavizacao || '—'}. Com vídeo em arquivo, toque o trecho e aplique no editor para exportar.</p>
    <div class="med-acoes lu-linha">
      <select value=${prop} onChange=${(e) => setProp(e.target.value)} aria-label="Proporção">${['16:9', '9:16', '1:1', '4:5'].map((p) => html`<option key=${p} value=${p}>${p}</option>`)}</select>
      <button class="btn tiny" disabled=${!d.n || d.relogio !== 'video'} onClick=${aplicar}>Aplicar no editor</button>
    </div>
    ${estado && html`<p class="hint tight lu-aviso">${estado}</p>`}
  `;
}

// ------------------------------------------------------------------ C1 diário de obra

const CAMPOS_OBRA = 'gplansis.obra.campos.v1';
function lerCampos() { try { return JSON.parse(localStorage.getItem(CAMPOS_OBRA) || '{}') || {}; } catch (_) { return {}; } }

function SecaoObra() {
  const d = ler('u_obra') || { tabela: [], fotos: 0, classes: [] };
  const [c, setC] = useState(lerCampos);
  const [via, setVia] = useState(false);
  const [viaFotos, setViaFotos] = useState(false);
  const [msg, setMsg] = useState('');
  const [texto, setTexto] = useState('');
  const mudar = (k) => (e) => { const n = { ...c, [k]: e.target.value }; setC(n); try { localStorage.setItem(CAMPOS_OBRA, JSON.stringify(n)); } catch (_) { /* segue */ } };
  const fotosDoDia = async (max = 12) => {
    const l = (await lerDb('obra', 'fotos:' + d.dia)) || [];
    const sel = l.length <= max ? l : Array.from({ length: max }, (_, i) => l[Math.round((i * (l.length - 1)) / (max - 1))]);
    const out = [];
    for (const f of sel) {
      const b = await lerDb('obra', f.id);
      if (!b) continue;
      const url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
      out.push({ url, hora: new Date(f.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
    }
    return out;
  };
  const redigir = async () => {
    setMsg('Pedindo à Via…');
    try {
      const { redigirRdo } = await import('./obra-via.js');
      const fotos = viaFotos ? (await fotosDoDia(3)).map((f) => ({ base64: f.url.split(',')[1], tipo: 'image/jpeg' })) : [];
      const t = await redigirRdo(resumoTexto(d.dia, d.tabela, { ...c, fotos: d.fotos }), fotos);
      setTexto(t); setMsg('Texto da Via pronto (revise antes de assinar).');
    } catch (e) { setMsg('Via: ' + (e && e.message ? e.message : e)); }
  };
  const montar = async () => relatorioHTML({ ...c, dia: d.dia, tab: d.tabela, classes: d.classes, fotos: await fotosDoDia(12), textoVia: texto });
  return html`
    <${Cab} titulo="Diário de obra (RDO)">
      <button class="btn tiny" onClick=${() => pedir('u_obra', { tipo: 'foto' })}>📷 Foto agora</button>
      <button class="btn tiny" disabled=${!d.tabela.length} onClick=${async () => abrirHtml(await montar())}>Abrir RDO</button>
      <button class="btn tiny" disabled=${!d.tabela.length} onClick=${async () => baixar(`RDO_${d.dia}.html`, await montar(), 'text/html')}>Baixar HTML</button>
    <//>
    ${d.tabela.length > 0 ? html`<div class="med-tab lu-rolar"><table><thead><tr><th>hora</th>${d.classes.map((k) => html`<th key=${k}>${k}</th>`)}</tr></thead>
      <tbody>${d.tabela.map((l) => html`<tr key=${l.hora}><td>${String(l.hora).padStart(2, '0')}h</td>${d.classes.map((k) => html`<td class="v" key=${k}>${l.classes[k] ? `${l.classes[k].max}${l.classes[k].entradas ? ` (+${l.classes[k].entradas})` : ''}` : '—'}</td>`)}</tr>`)}</tbody></table></div>`
      : html`<p class="hint tight">Contando… a tabela aparece na primeira leitura.</p>`}
    <p class="hint tight">Máximo simultâneo por hora (entradas pelo portão entre parênteses) · ${d.fotos} foto(s) hoje${d.portao ? '' : ' · sem área «Obra · portão»'}. ${d.erro || ''}</p>
    <div class="lu-campos">
      <input class="lu-in" placeholder="Obra" value=${c.obra || ''} onInput=${mudar('obra')} aria-label="Obra" />
      <input class="lu-in" placeholder="Responsável" value=${c.responsavel || ''} onInput=${mudar('responsavel')} aria-label="Responsável" />
      <input class="lu-in" placeholder="Clima (manhã/tarde)" value=${c.clima || ''} onInput=${mudar('clima')} aria-label="Clima" />
      <textarea class="lu-in" rows="2" placeholder="Atividades do dia" value=${c.atividades || ''} onInput=${mudar('atividades')} aria-label="Atividades"></textarea>
      <textarea class="lu-in" rows="2" placeholder="Ocorrências" value=${c.ocorrencias || ''} onInput=${mudar('ocorrencias')} aria-label="Ocorrências"></textarea>
    </div>
    <label class="lu-opt"><input type="checkbox" checked=${via} onChange=${(e) => setVia(e.target.checked)} />
      Quero que a Via redija o resumo: envia à Anthropic, com a MINHA chave, o resumo numérico e os campos acima.</label>
    ${via && html`<label class="lu-opt"><input type="checkbox" checked=${viaFotos} onChange=${(e) => setViaFotos(e.target.checked)} /> Incluir até 3 fotos do dia (reduzidas).</label>
      <button class="btn tiny" onClick=${redigir}>Redigir com a Via</button>`}
    ${msg && html`<p class="hint tight">${msg}</p>`}
    ${texto && html`<textarea class="lu-in" rows="6" value=${texto} onInput=${(e) => setTexto(e.target.value)} aria-label="Texto da Via"></textarea>`}
  `;
}

// ------------------------------------------------------------------ K4 + M2: ferramentas de vídeo

function FerramentasVideo({ source }) {
  const [arq, setArq] = useState(null);
  const [msg, setMsg] = useState('');
  const [prog, setProg] = useState(null);
  const [ix, setIx] = useState(null);
  const [fala, setFala] = useState(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [modelo, setModelo] = useState('base');
  const [chaves, setChaves] = useState('');
  const [durMax, setDurMax] = useState(60);
  const [minCap, setMinCap] = useState(60);
  const sinal = useRef({ cancelar: false });
  const arqRef = useRef(null), legRef = useRef(null);
  const usar = async (a) => {
    setArq(a); setRes([]); setMsg('');
    if (!a) return;
    const b = await import('./busca.js');
    setIx(await b.indiceDe(a)); setFala(await b.falaDe(a));
  };
  const daFonte = async () => { const a = await arquivoDaFonte(source); if (!a) setMsg('A Fonte não é um arquivo de vídeo.'); else usar(a); };
  const indexar = async () => {
    sinal.current = { cancelar: false }; setProg(0); setMsg('Indexando (1 quadro/s, MobileCLIP2)…');
    try { const b = await import('./busca.js'); const r = await b.indexarVideo(arq, { passo: 1, sinal: sinal.current, progresso: setProg }); if (!sinal.current.cancelar) { setIx(r); setMsg(`Índice pronto: ${r.ts.length} s.`); } else setMsg('Cancelado.'); }
    catch (e) { setMsg('Falhou: ' + e.message); }
    setProg(null);
  };
  const transcrever = async () => {
    setProg(0); setMsg('Transcrevendo com o Whisper local…');
    try {
      const t = await import('./transcricao.js');
      const r = await t.transcreverArquivo(arq, { modelo, progresso: (p) => { setMsg(`Whisper: ${p.fase}${p.pct ? ' ' + p.pct + '%' : ''}`); if (p.pct) setProg(p.pct / 100); } });
      setFala(r); setMsg(`Transcrição pronta: ${r.segs.length} legendas.`);
    } catch (e) { setMsg('Falhou: ' + e.message); }
    setProg(null);
  };
  const importarLegenda = async (f) => {
    if (!f) return;
    const segs = lerLegenda(await f.text());
    if (!segs.length) { setMsg('Nenhuma legenda reconhecida no arquivo.'); return; }
    const r = { segs, chunks: [], texto: segs.map((s) => s.texto).join(' '), modelo: 'importada', criado: Date.now() };
    const { gravar } = await import('../../cv/runtime/livres-u/db.js'); const b = await import('./busca.js');
    await gravar('indices', 'fala:' + b.chaveDe(arq), r);
    setFala(r); setMsg(`${segs.length} legendas importadas.`);
  };
  const buscar = async () => {
    if (!q.trim()) return;
    setMsg('Buscando…');
    try { const b = await import('./busca.js'); const r = await b.buscarNoVideo(arq, q, { imagem: Boolean(ix) }); setRes(r); setMsg(r.length ? '' : 'Nada encontrado.'); }
    catch (e) { setMsg('Falhou: ' + e.message); }
  };
  const caps = fala ? capitulos(fala.segs, { minS: +minCap || 60 }) : [];
  const trechos = fala ? melhoresTrechos(fala.segs, { durMin: Math.min(15, +durMax || 60), durMax: +durMax || 60, n: 3, palavrasChave: chaves }) : [];
  const base = arq ? arq.nome.replace(/\.[^.]+$/, '') : 'video';
  return html`
    <details class="lu-ferr">
      <summary class="cfg-sub">Ferramentas de vídeo — busca (K4) e cortes por fala (M2)</summary>
      <div class="med-acoes lu-linha">
        <button class="btn tiny" onClick=${daFonte}>Vídeo da Fonte</button>
        <button class="btn tiny" onClick=${() => arqRef.current.click()}>Escolher arquivo…</button>
        <input ref=${arqRef} type="file" accept="video/*,audio/*" hidden onChange=${(e) => { const f = e.target.files[0]; if (f) usar({ blob: f, nome: f.name }); }} />
      </div>
      <p class="hint tight">${arq ? `${arq.nome} · ${(arq.blob.size / 1e6).toFixed(1)} MB · índice ${ix ? `${ix.ts.length} s` : 'não'} · fala ${fala ? `${fala.segs.length} legendas` : 'não'}` : 'Escolha um vídeo. Tudo roda e fica neste navegador.'}</p>
      ${prog != null && html`<div class="med-acoes lu-linha"><progress max="1" value=${prog} /><button class="btn tiny" onClick=${() => { sinal.current.cancelar = true; }}>Cancelar</button></div>`}
      ${msg && html`<p class="hint tight" role="status">${msg}</p>`}
      ${arq && html`
        <div class="cfg-sub">Busca semântica (K4)</div>
        <div class="med-acoes lu-linha">
          <button class="btn tiny" disabled=${prog != null} onClick=${indexar}>${ix ? 'Reindexar imagens' : 'Indexar imagens'}</button>
          <input class="lu-in" placeholder="ex.: red truck at the gate · vazamento" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && buscar()} aria-label="Buscar no vídeo" />
          <button class="btn tiny" disabled=${!ix && !fala} onClick=${buscar}>Buscar</button>
        </div>
        <p class="hint tight">Imagem: frases em inglês funcionam melhor (o CLIP é inglês). Fala: palavras em português, sem precisar de acento.</p>
        ${res.length > 0 && html`<ul class="med-lista lu-res">${res.map((r, i) => html`<li key=${i}><button class="btn tiny" onClick=${() => irNoEditor(arq, r.t)}>${relogio(r.t)}</button>
          <span>${r.tipo === 'fala' ? '🗣' : r.tipo === 'ambos' ? '🗣🖼' : '🖼'} ${r.texto ? r.texto.slice(0, 80) : `semelhança ${fmt(r.nota, 1)}`}</span></li>`)}</ul>`}
        <div class="cfg-sub">Cortes por fala (M2)</div>
        <div class="med-acoes lu-linha">
          <select value=${modelo} onChange=${(e) => setModelo(e.target.value)} aria-label="Modelo do Whisper"><option value="tiny">Whisper tiny (~40 MB)</option><option value="base">Whisper base (~75 MB)</option><option value="small">Whisper small (~250 MB)</option></select>
          <button class="btn tiny" disabled=${prog != null} onClick=${transcrever}>${fala ? 'Transcrever de novo' : 'Transcrever'}</button>
          <button class="btn tiny" onClick=${() => legRef.current.click()}>Importar .srt/.vtt</button>
          <input ref=${legRef} type="file" accept=".srt,.vtt,text/vtt" hidden onChange=${(e) => importarLegenda(e.target.files[0])} />
        </div>
        ${fala && html`
          <div class="med-acoes lu-linha">
            <button class="btn tiny" onClick=${() => baixar(`${base}.srt`, srt(fala.segs), 'text/plain')}>SRT</button>
            <button class="btn tiny" onClick=${() => baixar(`${base}.vtt`, vtt(fala.segs), 'text/vtt')}>VTT</button>
            <button class="btn tiny" disabled=${!caps.length} onClick=${() => baixar(`${base}_capitulos.txt`, textoCapitulos(caps), 'text/plain')}>Capítulos .txt</button>
          </div>
          <label class="med-sel">Capítulo mínimo (s) <input class="lu-in lu-num" type="number" min="10" max="900" value=${minCap} onInput=${(e) => setMinCap(e.target.value)} /></label>
          <ul class="med-lista">${caps.map((c, i) => html`<li key=${i}><code>${relogio(c.t0)}</code> ${c.titulo}</li>`)}</ul>
          <button class="btn tiny" disabled=${caps.length < 2} onClick=${() => marcadoresNoEditor(arq, caps.map((c) => c.t0).filter((t) => t > 0), 'capítulos')}>Capítulos → marcadores no editor</button>
          <label class="med-sel">Palavras-chave <input class="lu-in" value=${chaves} onInput=${(e) => setChaves(e.target.value)} placeholder="opcional" /></label>
          <label class="med-sel">Trecho até (s) <input class="lu-in lu-num" type="number" min="15" max="180" value=${durMax} onInput=${(e) => setDurMax(e.target.value)} /></label>
          <ul class="med-lista">${trechos.map((t, i) => html`<li key=${i}><button class="btn tiny" onClick=${() => irNoEditor(arq, t.t0)}>${relogio(t.t0)}–${relogio(t.t1)}</button> ${t.texto.slice(0, 90)}…</li>`)}</ul>
          <button class="btn tiny" disabled=${!trechos.length} onClick=${() => trechosNoEditor(arq, trechos)}>Melhores trechos → timeline</button>
          <p class="hint tight">A legenda sai em SRT/VTT para o player ou a plataforma (o editor ainda não queima legenda no vídeo).</p>`}
      `}
    </details>
  `;
}
