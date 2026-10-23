/**
 * components/calibrar.js — «⚙ Calibrar»: um ponto de entrada visível para a calibração de cada módulo.
 *
 * Qualquer botão (painel, Studio, nó do Pipeline, o radar no vídeo) pede a calibração com
 *   window.dispatchEvent(new CustomEvent('aiv:calibrar', { detail: { op, no } }))   ou   pedirCalibracao(op)
 * e aqui cada módulo abre o editor dele:
 *   quadra.analise   assistente da quadra: esporte → arrastar os 4 cantos no vídeo (região editável,
 *                    cv/regioes.js) → homografia salva no nó e POR FONTE (vídeo, YouTube, câmera);
 *                    «Recalibrar», «Limpar», «Usar a calibração salva desta fonte»;
 *   clinica.marcha   as duas linhas «Marcha · piso» no vídeo (cria se faltarem) e a seleção nelas;
 *   takt.posto       Studio Takt em «Calibrar piso»;
 *   escala           a régua das Ferramentas de mouse (medidas em mm; Inspect, Medições, Ergonomia).
 *
 * Sem diálogo nativo: o assistente é um painel flutuante (não cobre o vídeo, que é onde se arrasta).
 */
import { html, ReactDOM, useState, useEffect } from '../vendor.js';
import { store, persist, useStore } from '../state/store.js';
import { ESPORTES, NOMES_ESPORTES, medidas, montarCalibracao } from '../cv/runtime/livres-j/quadras.js';
import { marcStore, selecionar, setFerramenta, criar, rt, COR_FUNC } from '../cv/marcacoes.js';
import { regioesMudaram } from '../cv/regioes.js';
import { defaultParams } from '../cv/registry.js';
import { newNodeId } from '../cv/executor.js';
import { acoesFonte, ouvirFonte } from '../camera/fonte-app.js';

const OPQ = 'quadra.analise';
const CHAVE_SALVAS = 'aiv.quadra.calibracoes';
const ICONE = { futebol: '⚽', futsal: '⚽', basquete: '🏀', 'vôlei': '🏐', 'tênis': '🎾', padel: '🎾', 'beach tennis': '🏖' };

export function pedirCalibracao(op, no = null) {
  window.dispatchEvent(new CustomEvent('aiv:calibrar', { detail: { op, no } }));
}

// ------------------------------------------------------------- CSS (tokens do tema: escuro, claro, Code Dark)
let cssPosto = false;
function injetarCss() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-cal]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/calibrar.css' + (v ? '?v=' + v : ''); l.dataset.aivCal = '1';
  document.head.appendChild(l);
}

// ------------------------------------------------------------- calibração por fonte

/** Identidade da fonte atual (vídeo, YouTube, câmera, stream) — a calibração fica salva por ela. */
export function chaveFonte() {
  const st = store.get();
  const a = acoesFonte();
  try {
    if (st.sourceKind === 'youtube') { const y = a.youtube && a.youtube.current; return y && y.videoId ? 'yt:' + y.videoId : null; }
    if (st.sourceKind === 'file') { const f = a.source && a.source.current; return f && f.nomeArquivo ? 'arq:' + f.nomeArquivo : null; }
    if (st.sourceKind === 'stream') { const c = a.stream && a.stream.current && a.stream.current.cfg; return c ? 'ip:' + (c.path || c.whep || '') : null; }
    if (st.sourceKind === 'screen') return null;
    if (st.cameraOn && st.deviceId) return 'cam:' + st.deviceId;
  } catch (_) { /* fonte trocando */ }
  return null;
}
function lerSalvas() { try { return JSON.parse(localStorage.getItem(CHAVE_SALVAS) || '{}') || {}; } catch (_) { return {}; } }
function gravarSalvas(o) {
  const ks = Object.keys(o);
  if (ks.length > 60) for (const k of ks.sort((a, b) => (o[a].quando || 0) - (o[b].quando || 0)).slice(0, ks.length - 60)) delete o[k];
  try { localStorage.setItem(CHAVE_SALVAS, JSON.stringify(o)); } catch (_) { /* storage cheio */ }
}
export function calibracaoSalva(chave = chaveFonte()) { return chave ? lerSalvas()[chave] || null : null; }
function salvarParaFonte(no) {
  const k = chaveFonte();
  if (!k || !no || !no.params || !no.params.calibracao) return false;
  const o = lerSalvas();
  o[k] = { esporte: no.params.esporte, calibracao: no.params.calibracao, quando: Date.now() };
  gravarSalvas(o);
  return true;
}
function esquecerFonte() { const k = chaveFonte(); if (!k) return; const o = lerSalvas(); delete o[k]; gravarSalvas(o); }

// ------------------------------------------------------------- nó da Quadra

const noQuadra = () => (store.get().nodes || []).find((n) => n.op === OPQ);
function definirQuadra(patch) {
  const ns = store.get().nodes || [];
  const i = ns.findIndex((n) => n.op === OPQ);
  if (i >= 0) store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null, params: { ...n.params, ...patch } } : n)) });
  else store.set({ nodes: [...ns, { id: newNodeId(), op: OPQ, params: { ...defaultParams(OPQ), ...patch }, enabled: true }] });
  persist();
}
export function estadoCalibracao(no = noQuadra()) {
  if (!no) return { calibrada: false };
  const p = { ...defaultParams(OPQ), ...no.params };
  let c = null;
  try { c = JSON.parse(p.calibracao || 'null'); } catch (_) { c = null; }
  if (!c || c.esporte !== p.esporte) return { calibrada: false, esporte: p.esporte };
  const { L, W } = medidas(p.esporte, p.comprimento, p.largura);
  const cal = montarCalibracao(c, p.esporte, L, W);
  return cal && !cal.erro ? { calibrada: true, esporte: p.esporte, n: cal.n, erroM: cal.erroM, mPorPx: cal.mPorPx } : { calibrada: false, esporte: p.esporte, erro: cal && cal.erro };
}
const regiaoCantos = () => marcStore.get().itens.find((i) => i.vinc && i.vinc.op === OPQ && i.vinc.chave === 'cantos');
/** Seleciona a região dos cantos assim que ela existir (o vínculo cria no próximo quadro). */
function selecionarCantos(t = 0) {
  const it = regiaoCantos();
  if (it) { setFerramenta('mover'); selecionar(it.id); rt.redesenhar(); return; }
  if (t < 40) setTimeout(() => selecionarCantos(t + 1), 100);
}

// ------------------------------------------------------------- assistente da quadra

let raiz = null, alvoRaiz = null;
function abrirAssistente(abrir = true) {
  injetarCss();
  const alvo = document.fullscreenElement || document.webkitFullscreenElement || document.body;
  if (!raiz || alvoRaiz !== alvo) {
    if (raiz) raiz.r.unmount();
    const div = document.createElement('div');
    div.className = 'cq-raiz';
    alvo.appendChild(div);
    raiz = { r: ReactDOM.createRoot(div), div };
    alvoRaiz = alvo;
  }
  raiz.r.render(abrir ? html`<${AssistenteQuadra} key=${Date.now()} onFechar=${() => abrirAssistente(false)} />` : null);
}

function AssistenteQuadra({ onFechar }) {
  const no = useStore(store, (st) => ({ n: (st.nodes || []).find((n) => n.op === OPQ) || null })).n;
  useStore(marcStore, (st) => ({ i: st.itens }));
  const est = estadoCalibracao(no);
  const [passo, setPasso] = useState(no ? 'cantos' : 'esporte');
  const [msg, setMsg] = useState('');
  const salva = calibracaoSalva();
  useEffect(() => { if (passo === 'cantos') selecionarCantos(); }, [passo]);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !marcStore.get().sel) onFechar(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);

  const escolher = (esporte) => { definirQuadra({ esporte }); setPasso('cantos'); setMsg(''); };
  const esporte = no ? no.params.esporte || defaultParams(OPQ).esporte : null;
  const esp = esporte && ESPORTES[esporte];
  const med = esp ? medidas(esporte, no.params.comprimento, no.params.largura) : null;
  const n = (v, d = 2) => (v == null ? '—' : Number(v).toFixed(d).replace('.', ','));

  return html`
    <div class="cq" role="dialog" aria-label="Calibrar quadra">
      <div class="cq-topo">
        <b>⚙ Calibrar quadra</b>
        ${esp && html`<span class="cq-st ${est.calibrada ? 'ok' : ''}">${est.calibrada ? `calibrada: ${esp.nome}` : 'sem calibração'}</span>`}
        <button class="cq-x" onClick=${onFechar} aria-label="Fechar">✕</button>
      </div>
      ${passo === 'esporte' ? html`
        <p class="cq-dica">1. Escolha o esporte: o desenho da quadra vem com as medidas oficiais.</p>
        <div class="cq-esportes">
          ${NOMES_ESPORTES.map((k) => { const e = ESPORTES[k]; return html`
            <button key=${k} class="cq-esp ${k === esporte ? 'on' : ''}" onClick=${() => escolher(k)}>
              <span>${ICONE[k] || '🏟'}</span><b>${e.nome}</b><em>${e.L} × ${e.W} m</em></button>`; })}
        </div>` : html`
        <p class="cq-dica">2. No vídeo, arraste os <b>4 cantos</b> (ciano) até os cantos da quadra de <b>${esp ? esp.nome : ''}</b>
          (${med ? `${med.L} × ${med.W} m` : ''}). As linhas do esporte acompanham; arraste uma aresta para mover dois cantos,
          setas para ajuste fino, Ctrl/⌘+Z desfaz.</p>
        ${est.calibrada && html`<p class="cq-ok">Homografia com ${est.n} pontos · ${n(est.mPorPx)} m por pixel no fundo. Posições, radar e mapa de calor em metros.</p>`}
        ${est.erro && html`<p class="cq-alerta">⚠ ${est.erro}</p>`}
        ${salva && !est.calibrada && html`<button class="cq-btn" onClick=${() => { definirQuadra({ esporte: salva.esporte, calibracao: salva.calibracao }); regioesMudaram(); setMsg('Calibração salva desta fonte aplicada.'); }}>
          Usar a calibração salva desta fonte (${ESPORTES[salva.esporte] ? ESPORTES[salva.esporte].nome : salva.esporte})</button>`}
        <div class="cq-botoes">
          <button class="cq-btn cq-pri" disabled=${!est.calibrada} onClick=${() => {
            const ok = salvarParaFonte(noQuadra()); selecionar(null); setMsg(''); onFechar();
            if (!ok) console.info('[calibrar] fonte sem identidade (tela): calibração fica só no nó');
          }}>Concluir</button>
          <button class="cq-btn" onClick=${() => { definirQuadra({ calibracao: '' }); regioesMudaram(); selecionarCantos(); setMsg('Recomece: arraste os cantos tracejados até a quadra.'); }}>Recalibrar</button>
          <button class="cq-btn" onClick=${() => { definirQuadra({ calibracao: '' }); esquecerFonte(); regioesMudaram(); setMsg('Calibração limpa (nó e fonte).'); }}>Limpar</button>
          <button class="cq-btn" onClick=${() => setPasso('esporte')}>Trocar esporte</button>
          <button class="cq-btn" onClick=${() => { store.set({ panels: { ...store.get().panels, quadra: true } }); setMsg('Painel Quadra aberto: «Calibrar» lá marca pontos extras (linhas, aro).'); }}>Pontos extras…</button>
        </div>`}
      ${msg && html`<p class="cq-msg" role="status">${msg}</p>`}
    </div>`;
}

// ------------------------------------------------------------- outros módulos

function calibrarMarcha() {
  const F = 'marcha_piso';
  let linhas = marcStore.get().itens.filter((i) => i.funcao === F);
  if (linhas.length < 2) {
    const faltam = [[[0.2, 0.55], [0.2, 0.98]], [[0.8, 0.55], [0.8, 0.98]]].slice(linhas.length);
    for (const pts of faltam) criar('linha', pts, { funcao: F, cor: COR_FUNC[F] || '#FFD84D', nomeBase: 'Piso' });
    linhas = marcStore.get().itens.filter((i) => i.funcao === F);
  }
  setFerramenta('mover');
  if (linhas[0]) selecionar(linhas[0].id);
  rt.redesenhar();
  aviso('Arraste as duas linhas «Marcha · piso» até as marcas do chão e informe a distância entre elas no nó (Pipeline).');
}

function calibrarTakt() {
  store.set({ studioTakt: true });
  let t = 0;
  const tenta = () => { if (window.aivTakt && window.aivTakt.calibrar) window.aivTakt.calibrar(true); else if (t++ < 30) setTimeout(tenta, 100); };
  tenta();
}

function calibrarEscala() {
  setFerramenta('regua');
  aviso('Régua: arraste sobre algo de tamanho conhecido; no cartão dela, informe a medida e toque em Calibrar.');
}

let avisoMod = null;
function aviso(t) {
  if (!avisoMod) import('./marcacoes-vista.js').then((m) => { avisoMod = m; m.avisar(t, 7000); });
  else avisoMod.avisar(t, 7000);
}

if (typeof window !== 'undefined') {
  window.addEventListener('aiv:calibrar', (e) => {
    const op = e.detail && e.detail.op;
    if (op === OPQ || op === 'quadra') abrirAssistente(true);
    else if (op === 'clinica.marcha') calibrarMarcha();
    else if (op === 'takt.posto') calibrarTakt();
    else if (op === 'escala' || op === 'inspect.paquimetro') calibrarEscala();
  });
  // ao trocar (ou reabrir) a fonte, a calibração salva dela volta sozinha (Quadra no Pipeline sem calibração).
  // Uma vez por abertura da fonte: «Recalibrar» na mesma sessão não é desfeito.
  let ultima = null, espera = 0;
  const sessaoFonte = () => {
    const k = chaveFonte();
    if (!k) return null;
    const a = acoesFonte(), src = a && a.source && a.source.current;
    return k + '|' + ((src && src.url) || '');
  };
  const aplicarSalva = () => {
    espera = 0;
    const no = noQuadra();
    if (!no || (no.params.calibracao && no.params.calibracao !== '')) return;
    const sess = sessaoFonte();
    if (!sess || sess === ultima) return;
    ultima = sess;
    const s = calibracaoSalva();
    if (s) definirQuadra({ esporte: s.esporte, calibracao: s.calibracao });
  };
  store.subscribe(() => { if (espera) return; const no = noQuadra(); if (no && !no.params.calibracao) espera = setTimeout(aplicarSalva, 700); });
  try { ouvirFonte(() => setTimeout(aplicarSalva, 300)); } catch (_) { /* sem fonte ainda */ }
  window.aivCalibrar = { abrirQuadra: () => abrirAssistente(true), fechar: () => abrirAssistente(false), chaveFonte, estadoCalibracao, calibracaoSalva };
}
