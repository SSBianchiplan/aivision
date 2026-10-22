/**
 * components/industrial/IndustrialPanel.js — o hub "Industrial".
 *
 * Porta de entrada dos módulos industriais do iaVision, no mesmo formato do
 * hub Esportes (components/esportes/EsportesPanel.js): um cartão por módulo,
 * com "Abrir" (o painel do módulo), "No Pipeline" (põe o operador na cadeia,
 * como os presets) e, quando há, a tela cheia. Módulos: a volumetria de
 * correia transportadora (GPlanSiS|BeltScan, CV-36) e o tempo de posto
 * (GPlanSiS|Takt, CV-39).
 */
import { html } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store, persist } from '../../state/store.js';
import { getOperator, defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { ativarContador } from './counter-comum.js';   // CV-38 CounterVision

const MODULOS = [
  {
    id: 'beltscan', op: 'beltscan.volumetria', icone: '⛰', nome: 'Volumetria de correia (BeltScan)',
    desc: 'Linha laser + câmera: seção, vazão m³/h, massa t/h seca, nível com altura limite e alarmes ISA-18.2. ' +
          'Ensaios de bancada com feijão; configuração compatível com o GPlanSiS|BELTSCAN (HTML e Python).',
    tela: 'studioBeltScan', telaRotulo: 'Abrir Studio BeltScan',
    telaDica: 'Tela cheia GPlanSiS|BeltScan: câmera, seção da correia, perfil, tendência, indicadores, alarmes e Configurar',
  },
  {
    // CV-39 (porte do GPlanSiS|Takt): o operador roda a própria pose se não houver Pose RTMO antes
    id: 'takt', op: 'takt.posto', icone: '⏱', nome: 'Tempo de posto (Takt)',
    desc: 'Postos marcados na imagem + pose multi-pessoa: produtivo, ocioso no posto, vago, pausa e não observado com ' +
          'histerese; turnos, KPIs, Gantt, ranking, planta do piso em metros, alarmes e CSV. Rostos borrados (LGPD).',
    tela: 'studioTakt', telaRotulo: 'Abrir Studio Takt',
    telaDica: 'Tela cheia GPlanSiS|Takt: vídeo com postos e pessoas, linha do tempo de estados, KPIs do turno, ranking, planta do piso, alarmes e exportar',
  },
  {
    // CV-38: a cadeia (motor COR → Zonas e linhas → produção) vem de counter-comum.js › ativarContador
    id: 'contador', op: 'contagem.esteira', icone: '🔢', nome: 'Contagem em esteira (CounterVision)',
    desc: 'Peças na esteira por linha (com sentido) e zona: motor COR sem modelo (clique numa peça) ou detector + rastreio. ' +
          'Peças/min e /h, turnos e metas, alarmes de parada e de taxa, eventos e CSV, quadros com caixas para o Treinar.',
    tela: 'studioCounter', telaRotulo: 'Abrir Studio CounterVision', ativar: () => ativarContador({ abrirPipeline: true }),
    telaDica: 'Tela cheia GPlanSiS|CounterVision: vídeo com a contagem, totais, taxa, gráfico por minuto, metas, eventos, alarmes e dataset',
  },
  {
    // CV-40: porte do GPlanSiS|Inspect (painel InspectPanel.js, tela StudioInspect.js)
    id: 'inspecao', op: 'inspect.programa', icone: '🔍', nome: 'Inspeção visual (Inspect)',
    desc: 'Presença, contagem, paquímetro em mm, cor ΔE2000, forma e área de defeito, com ROIs nas marcações. Programa ' +
          'versionado com gatilho (presença, linha, intervalo), veredito OK / NOK / INCERTO, revisão humana, CSV e Cpk.',
    tela: 'studioInspect', telaRotulo: 'Abrir Studio Inspect',
    telaDica: 'Tela cheia GPlanSiS|Inspect: ao vivo, última peça, veredito, medidas, histórico, revisão humana, estatística e editor de programa',
  },
  {
    // CV-46 (onda 1-b): máquina sem CLP — movimento na ROI + CounterVision/Takt/Inspect quando presentes
    id: 'oee', op: 'maquina.estado', icone: '⚙', nome: 'OEE pela câmera',
    desc: 'Máquina sem CLP: movimento na área marcada decide rodando, parada ou setup com histerese. Peças do CounterVision, ' +
          'operador do Takt e OK/NOK do Inspect quando estão no Pipeline. D × P × Q por turno, motivos de parada por clique, Pareto e relatório.',
    tela: 'studioOEE', telaRotulo: 'Abrir Studio OEE',
    telaDica: 'Tela cheia GPlanSiS|OEE: vídeo com a máquina, OEE, linha do tempo, paradas com motivo, Pareto, turnos e exportar',
  },
  {
    // CV-48 (onda 1-b): estágio 1 sem treino (pose + CLIP); estágio 2 pelo +Projeto
    id: 'epi', op: 'epi.monitor', icone: '⛑', nome: 'Monitor de EPI (capacete e colete)',
    desc: 'Sem treino: a pose recorta cabeça e tronco e o MobileCLIP2 decide por frases, com votação por pessoa e conformidade por zona. ' +
          'Rosto borrado. Coleta amostras rotuladas para treinar um detector no +Projeto (estágio 2).',
    ativar: () => import('./EPIPanel.js').then((m) => { m.ativarEPI({ abrirPipeline: true }); store.set({ panels: { ...store.get().panels, epi: true } }); persist(); }),
  },
];

/** Põe o operador do módulo no Pipeline (ou liga o que já existe) e abre o painel. */
function noPipeline(m) {
  if (m.ativar) { m.ativar(); return; }
  const st = store.get();
  const i = st.nodes.findIndex((n) => n.op === m.op);
  const nodes = i >= 0
    ? st.nodes.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
    : [...st.nodes, { id: newNodeId(), op: m.op, params: defaultParams(m.op), enabled: true }];
  store.set({ nodes, panels: { ...st.panels, pipeline: true, [m.id]: true } });
  persist();
}

export function IndustrialPanel({ onClose, ...layout }) {
  const s = useStore(store, (st) => ({ panels: st.panels, nodes: st.nodes }));
  const disponiveis = MODULOS.filter((m) => getOperator(m.op));

  return html`
    <${Panel} id="industrial" title="Industrial" subtitle=${`${disponiveis.length} ${disponiveis.length === 1 ? 'módulo' : 'módulos'}`} onClose=${onClose} ...${layout}>
      <p class="hint tight">
        Medição industrial pela câmera, no navegador — câmera USB/IP, vídeo gravado, tela ou YouTube como fonte.
        Nada da imagem sai do aparelho.
      </p>
      <div class="esp-hub">
        ${disponiveis.map((m) => {
          const aberto = Boolean(s.panels[m.id]);
          const ativo = s.nodes.some((n) => n.op === m.op && n.enabled);
          return html`
            <div key=${m.id} class="esp-card ${ativo ? 'on' : ''}">
              <div class="esp-card-h"><span class="esp-ico" aria-hidden="true">${m.icone}</span><b>${m.nome}</b>
                ${ativo && html`<i class="esp-tag">no pipeline</i>`}</div>
              <p>${m.desc}</p>
              <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
                ${m.tela && html`<button class="btn tiny accent" title=${m.telaDica || ''}
                        onClick=${() => { noPipeline(m); store.set({ [m.tela]: true }); }}>${m.telaRotulo || 'Tela cheia'}</button>`}
                <button class="btn tiny"
                        onClick=${() => { store.set({ panels: { ...store.get().panels, [m.id]: !aberto } }); persist(); }}>
                  ${aberto ? 'Fechar painel' : 'Abrir painel'}</button>
                <button class="btn tiny" onClick=${() => noPipeline(m)} disabled=${ativo}>${ativo ? 'No Pipeline ✓' : 'No Pipeline'}</button>
              </div>
            </div>
          `;
        })}
      </div>
    <//>
  `;
}
