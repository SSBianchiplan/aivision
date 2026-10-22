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
  // CV-47 (onda 1-b): fisioterapia — goniometria e testes funcionais, com o Studio Fisio
  { id: 'fisio', op: 'fisio.avaliar', icone: '🩺', nome: 'Fisio (ADM, TUG, sentar-levantar)', desc: 'Amplitude articular por articulação e lado, Timed Up and Go com fases e sentar-levantar 5× e 30 s, com referências e fontes. Não é dispositivo médico.' },
  { id: 'studioFisio', icone: '🎬', nome: 'Studio Fisio', desc: 'Tela de avaliação: perfil do paciente, vídeo com a pose, curvas, tabela das medidas e relatório para PDF.', studio: true,
    abrir: () => { const st = store.get(); if (!st.nodes.some((n) => n.op === 'fisio.avaliar')) noPipeline(MODULOS.find((x) => x.id === 'fisio')); store.set({ studioFisio: true }); } },
  // CV-88 Motion 3D Studio: captura de movimento 3D (Live Link + tela cheia com 3D, tomadas, BVH/GLB, multicâmera do GPlanSiS|ROBO)
  { id: 'motion3d', op: 'motion3d.captura', icone: '🕺', nome: 'Motion 3D (captura no Pipeline)', desc: 'Pose 3D ao vivo de uma câmera ou vídeo (BlazePose com os pontos do mundo), suavização One Euro, taxa e latência; esqueleto verde-água sobre o vídeo. O Studio grava e exporta.', studio: true,
    abrir: () => { noPipeline(MODULOS.find((x) => x.id === 'motion3d'), false); store.set({ panels: { ...store.get().panels, pipeline: true } }); persist(); } },
  { id: 'studioMotion3D', icone: '🎬', nome: 'Motion 3D Studio', desc: 'Estúdio de mocap: vídeo com esqueleto e viewport 3D, tomadas com timecode, retarget, BVH/GLB para o Blender, multicâmera e FreeMoCap.', studio: true,
    abrir: () => { const st = store.get(); if (!st.nodes.some((n) => n.op === 'motion3d.captura')) noPipeline(MODULOS.find((x) => x.id === 'motion3d'), false); store.set({ studioMotion3D: true }); } },
  // onda 2-c (CV-70..77): um cartão por módulo; "Abrir" põe o preset e abre o painel Saúde e esportes+
  ...[
    ['vitais', '🫁', 'Sinais vitais sem contato', 'Respiração pelo tórax e frequência cardíaca rPPG pelo rosto, com faixa de confiança. Não é dispositivo médico.', 'Respiração sem contato'],
    ['rostoClinico', '🙂', 'Rosto clínico (assimetria, fono)', 'Assimetria facial em expressões guiadas e exercícios orofaciais. Não é dispositivo médico.', 'Assimetria facial'],
    ['movClinico', '🧍', 'Tremor, postura e marcha', 'Tremor de mão, postura estática e marcha clínica com piso calibrado. Não é dispositivo médico.', 'Postura estática'],
    ['domiciliar', '🏠', 'Exercício domiciliar (voz)', 'Prescrição por link, contagem e correção por voz sobre a Academia, relatório ao fisioterapeuta.', 'Exercício domiciliar (voz)'],
    ['hospital', '🏥', 'Hospital e ILPI', 'Higiene das mãos (OMS, indicativo) e queda de paciente só com o esqueleto.', 'Higiene das mãos (OMS)'],
    ['referencia', '🎯', 'Comparar com a referência / yoga', 'Movimento modelo × tentativa por DTW, nota por fase; yoga com tempo sustentado.', 'Comparar com a referência'],
    ['ciclo', '🥊', 'Corda, luta, basquete, natação', 'Saltos de corda, golpes e velocidade do punho, arremesso por zona e braçadas.', 'Pular corda'],
    ['proesp', '🏫', 'PROESP-BR', 'Salto horizontal, 20 m, quadrado e abdominal por código do aluno, com a tabela do manual.', 'PROESP-BR — salto e corrida'],
  ].map(([id, icone, nome, desc, preset]) => ({ id: 'o2c-' + id, icone, nome, desc, studio: true,
    abrir: () => import('../saude/onda2c-comum.js').then((m) => m.aplicarPresetOnda2c(m.PRESETS_ONDA2C.find((p) => p.nome === preset))) })),
];

/** Põe o operador do módulo no Pipeline (ou liga o que já existe) e abre os dois painéis. */
function noPipeline(m, abrirPaineis = true) {
  const st = store.get();
  const i = st.nodes.findIndex((n) => n.op === m.op);
  const nodes = i >= 0
    ? st.nodes.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
    : [...st.nodes, { id: newNodeId(), op: m.op, params: defaultParams(m.op), enabled: true }];
  store.set(abrirPaineis ? { nodes, panels: { ...st.panels, pipeline: true, [m.id]: true } } : { nodes });
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
