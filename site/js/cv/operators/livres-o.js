/**
 * Operadores livres — grupo O: INDUSTRIAL, OEE pela câmera (CV-46). Máquina
 * sem CLP: movimento na ROI marcada decide rodando / parada / setup, e o OEE
 * soma CounterVision (peças), Takt (operador) e Inspect (OK/NOK) quando estão
 * no Pipeline. JS puro, sem modelo — por isso não há models-livres-o.js.
 */
import maquina from './livres-o/maquina.js';

export const MODULES_O = [
  {
    id: 'CV-46',
    name: 'Industrial — OEE pela câmera',
    status: 'ready',
    runtime: 'client',
    desc: 'OEE de máquina sem CLP, no navegador: área da máquina marcada com o mouse, movimento por diferença de ' +
          'quadros ou fundo adaptativo, estados rodando / parada / setup com histerese e tempos mínimos que ' +
          'retroagem, pausa programada e não observado. Peças do CounterVision, presença do Takt e OK/NOK do ' +
          'Inspect quando estão no Pipeline (ou apontamento manual). Disponibilidade × desempenho × qualidade por ' +
          'turno, linha do tempo, motivos de parada classificados por clique com Pareto, alarme de parada sem ' +
          'motivo, CSV, PNG e relatório. Tela GPlanSiS|OEE.',
  },
];

export default [...maquina];
