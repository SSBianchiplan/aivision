/**
 * app.js — entrada do GPlanSiS|iaVision: login primeiro, app depois.
 *
 * ===================== POR QUE ESTE ARQUIVO É PEQUENO =====================
 *
 * Antes, app.js importava estaticamente 151 dos 152 módulos (registry, todos
 * os operadores, runtimes de esporte, painéis). O navegador só descobre um
 * nível de import depois de baixar o anterior: eram 7 ondas e 0,85 MB
 * comprimidos ANTES de a tela de login aparecer — 2 a 3 s a frio, 10 s num
 * celular em 4G.
 *
 * Agora a tela de login depende só disto: vendor, store, auth/api e o
 * AccessGate (cinco arquivos, todos com <link rel="modulepreload"> no
 * app.html, então chegam numa onda só). O app de verdade mora em
 * workspace.js e entra com import():
 *
 *   1. em SEGUNDO PLANO, assim que o login pintou (ocioso). Quando a pessoa
 *      termina de digitar a senha, ele já está pronto — o login continua
 *      instantâneo, e o service worker já guardou os módulos para o offline;
 *   2. ao chegar a sessão (login feito, ou sessão que já existia), espera o
 *      mesmo import — se o ocioso ainda não terminou, mostra «abrindo…».
 *
 * Depois que o workspace monta, ele fica montado para sempre: logout e
 * sessão revogada voltam ao AccessGate por lá (workspace.js), como antes.
 *
 * O fundo da tela de login era o Viewport parado (câmera desligada, canvas
 * vazio sobre o fundo do .viewport). Aqui ele é o mesmo markup, sem o laço
 * de render nem o executor — visual idêntico, zero dependência de CV.
 * ==========================================================================
 */

import { html, ReactDOM, useState, useEffect } from './vendor.js';
import { AccessGate } from './components/AccessGate.js';

/** Um import só, compartilhado entre o pré-carregamento e o login. */
let workspace = null;
function carregarWorkspace() {
  if (!workspace) {
    workspace = import('./workspace.js').catch((e) => {
      workspace = null;   // falhou (rede): a próxima tentativa refaz
      throw e;
    });
  }
  return workspace;
}

/** Roda `fn` quando o navegador estiver ocioso, depois da primeira pintura. */
function quandoOcioso(fn) {
  const depois = () => (window.requestIdleCallback
    ? window.requestIdleCallback(fn, { timeout: 2000 })
    : setTimeout(fn, 200));
  // dois rAF: o primeiro roda antes da pintura, o segundo já depois dela
  requestAnimationFrame(() => requestAnimationFrame(depois));
}

/** Fundo da tela de acesso: o mesmo DOM do Viewport ocioso, sem o laço. */
const fundo = html`<div class="viewport"><canvas class="stage"></canvas></div>`;

function Entrada() {
  const [sessao, setSessao] = useState(null);
  const [App, setApp] = useState(null);
  const [falha, setFalha] = useState(null);
  const [tentativa, setTentativa] = useState(0);

  // pré-carregamento ocioso: o login fica instantâneo depois
  useEffect(() => {
    quandoOcioso(() => { carregarWorkspace().catch(() => { /* tenta de novo no login */ }); });
  }, []);

  useEffect(() => {
    if (!sessao || App) return undefined;
    let vivo = true;
    setFalha(null);
    carregarWorkspace().then(
      (m) => { if (vivo) setApp(() => m.App); },
      (e) => {
        console.error('[app] o sistema não carregou:', e);
        if (vivo) setFalha(e.message || 'falha de rede');
      });
    return () => { vivo = false; };
  }, [sessao, App, tentativa]);

  if (sessao && App) return html`<${App} sessao=${sessao} />`;

  if (!sessao) {
    return html`${fundo}<${AccessGate} onAuthenticated=${setSessao} />`;
  }

  // sessão em mãos, módulos ainda chegando (ou falharam)
  return html`
    ${fundo}
    <div class="gate">
      <div class="gate-vignette"></div>
      <div class="gate-ui">
        <div class="gate-card" aria-busy=${!falha}>
          <div class="gate-brand">GPlanSiS<span>|</span>iaVision</div>
          <p class="gate-kicker">Visão computacional em tempo real, na tela e na palma da sua mão.</p>
          ${falha
            ? html`
              <p class="gate-err">Não consegui abrir o sistema (${falha}).</p>
              <button class="gate-btn" type="button" onClick=${() => setTentativa((n) => n + 1)}>Tentar de novo</button>`
            : html`
              <p class="gate-lead">Abrindo o sistema…</p>
              <div class="gate-spin" aria-hidden="true"></div>`}
        </div>
      </div>
    </div>
  `;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(html`<${Entrada} />`);
