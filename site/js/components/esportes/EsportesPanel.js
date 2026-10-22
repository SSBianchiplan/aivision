/**
 * components/esportes/EsportesPanel.js — o hub "Esportes".
 *
 * Os módulos de esporte e biomecânica têm cada um o seu painel (Bike Fit,
 * Ergonomia, Academia, Salto, Corrida, Swing, VBT, Quadra) e o Studio Bike Fit
 * em tela cheia. Um botão por módulo lotaria a barra do topo; este painel é a
 * porta de entrada: um cartão por módulo, com "Abrir" (o painel do módulo) e
 * "No Pipeline" (põe o operador na cadeia, como os presets fazem).
 */

import { html } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { getOperator, defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';

const MODULOS = [
  { id: 'bikefit', op: 'bikefit.analise', icone: '🚴', nome: 'Bike Fit', desc: 'Ângulos do ciclista por pedalada, cadência, KOPS e vista frontal, com faixas por modalidade.' },
  { id: 'studio', icone: '🎬', nome: 'Studio Bike Fit', desc: 'Tela de estúdio: vídeo com ângulos e as curvas de cada articulação, para apresentar e gravar.', studio: true },
  { id: 'bikefit3d', icone: '🧊', nome: 'Bike Fit 3D (protótipo)', desc: 'Duas câmeras (lateral + frontal) calibradas por 5 cliques: esqueleto 3D, deslocamento lateral do joelho e alinhamento quadril–joelho–pé.', studio: true, abrir: () => store.set({ bikeFit3D: true }) },
  { id: 'ergonomia', op: 'ergonomia.avaliar', icone: '🦺', nome: 'Ergonomia (RULA/REBA)', desc: 'Nota de risco postural por pessoa, tempo em cada nível, postura crítica e recomendações.' },
  { id: 'academia', op: 'academia.treino', icone: '🏋', nome: 'Academia', desc: 'Repetições, séries, amplitude e alertas de forma em 9 exercícios (automático ou manual).' },
  { id: 'salto', op: 'salto.teste', icone: '⤴', nome: 'Salto e testes', desc: 'CMJ, squat jump, drop jump (RSI), saltos contínuos e horizontal, com a margem de erro.' },
  { id: 'corrida', op: 'corrida.marcha', icone: '🏃', nome: 'Corrida', desc: 'Cadência, contato, pisada, overstriding, oscilação, tronco e simetria (lateral ou de trás).' },
  { id: 'swing', op: 'swing.analise', icone: '⛳', nome: 'Swing (golfe e raquete)', desc: 'Fases, tempo, rotação de quadril e ombros, X-factor e quadros-chave de cada swing.' },
  { id: 'vbt', op: 'vbt.barra', icone: '🏋', nome: 'VBT (velocidade da barra)', desc: 'Velocidade, potência e perda de velocidade por repetição com um marcador impresso na anilha.' },
  { id: 'quadra', op: 'quadra.analise', icone: '⚽', nome: 'Quadra (esportes coletivos)', desc: 'Jogadores, times, radar, mapa de calor, distância e velocidade; futsal, basquete, vôlei, tênis, padel, futebol.' },
];

/** Põe o operador do módulo no Pipeline (ou liga o que já existe) e abre os dois painéis. */
function noPipeline(m) {
  const st = store.get();
  const i = st.nodes.findIndex((n) => n.op === m.op);
  const nodes = i >= 0
    ? st.nodes.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
    : [...st.nodes, { id: newNodeId(), op: m.op, params: defaultParams(m.op), enabled: true }];
  store.set({ nodes, panels: { ...st.panels, pipeline: true, [m.id]: true } });
  persist();
}

export function EsportesPanel({ onClose, ...layout }) {
  const s = useStore(store, (st) => ({ panels: st.panels, nodes: st.nodes }));
  const disponiveis = MODULOS.filter((m) => m.studio || getOperator(m.op));

  return html`
    <${Panel} id="esportes" title="Esportes" subtitle=${`${disponiveis.length} módulos`} onClose=${onClose} ...${layout}>
      <p class="hint tight">
        Biomecânica e esportes pela câmera, num vídeo gravado ou no YouTube como fonte.
        Dica: use o <b>zoom</b> da barra de vídeo para enquadrar a pessoa — o que fica maior
        na tela é o que a pose analisa.
      </p>
      <div class="esp-hub">
        ${disponiveis.map((m) => {
          const aberto = m.studio ? false : Boolean(s.panels[m.id]);
          const ativo = !m.studio && s.nodes.some((n) => n.op === m.op && n.enabled);
          return html`
            <div key=${m.id} class="esp-card ${ativo ? 'on' : ''}">
              <div class="esp-card-h"><span class="esp-ico" aria-hidden="true">${m.icone}</span><b>${m.nome}</b>
                ${ativo && html`<i class="esp-tag">no pipeline</i>`}</div>
              <p>${m.desc}</p>
              <div class="row tight" style=${{ gap: '6px' }}>
                ${m.studio
                  ? html`<button class="btn tiny accent" onClick=${() => {
                      if (m.abrir) { m.abrir(); return; }
                      noPipeline(MODULOS[0]);
                      store.set({ studioBikeFit: true });
                    }}>${m.abrir ? 'Abrir' : 'Abrir Studio'}</button>`
                  : html`
                    <button class="btn tiny ${aberto ? '' : 'accent'}"
                            onClick=${() => { store.set({ panels: { ...store.get().panels, [m.id]: !aberto } }); persist(); }}>
                      ${aberto ? 'Fechar painel' : 'Abrir'}</button>
                    <button class="btn tiny" onClick=${() => noPipeline(m)} disabled=${ativo}>${ativo ? 'No Pipeline ✓' : 'No Pipeline'}</button>`}
              </div>
            </div>
          `;
        })}
      </div>
    <//>
  `;
}
