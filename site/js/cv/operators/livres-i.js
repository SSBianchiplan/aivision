/**
 * Operadores livres — grupo I: swing (golfe/raquete) e VBT (velocidade da barra).
 *
 * Nenhum modelo novo (models-livres-i.js fica vazio): o Swing usa a pose do
 * CV-06 (YOLOX + BlazePose, Apache-2.0); o VBT acha um marcador ArUco 4×4
 * impresso com um detector próprio em JavaScript (sem modelo) e, sem
 * marcador, cai para os punhos do BlazePose.
 */
import swing from './livres-i/swing.js';
import vbt from './livres-i/vbt.js';

export const MODULES_I = [
  {
    id: 'CV-33',
    name: 'Swing (golfe e raquete)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Análise do swing pela câmera ou por vídeo, no navegador: fases detectadas pela velocidade das mãos ' +
          '(preparação, backswing, topo, downswing, impacto, follow-through) com quadros-chave congelados; ' +
          'tempo de backswing/downswing e razão (≈3:1 no golfe), rotação de ombros e quadril, X-factor, ' +
          'inclinação da coluna, braço líder, estabilidade da cabeça, velocidade das mãos e angular do punho, ' +
          'trajetória das mãos (e da raquete/taco, se o detector achar) e transferência de peso. Golfe, tênis, ' +
          'padel, beach tennis e beisebol. Painel Swing: lista, comparação lado a lado, CSV/JSON/relatório. ' +
          'Usa a pose do CV-06 (Apache-2.0).',
  },
  {
    id: 'CV-34',
    name: 'VBT (velocidade da barra)',
    status: 'ready',
    runtime: 'client',
    weights: ['yolox', 'pose'],     // só no modo aproximado (punhos); o marcador não usa modelo
    desc: 'Treino baseado em velocidade com um marcador ArUco impresso na ponta da barra (vista lateral): ' +
          'trajetória, deslocamento, velocidade média, propulsiva e de pico da fase concêntrica, potência com a ' +
          'carga, repetições, perda de velocidade da série com alerta e zonas de velocidade. Calibra pelo tamanho ' +
          'real do marcador. Sem marcador, modo aproximado pelos punhos (BlazePose). Painel VBT com tabela, ' +
          'CSV/JSON/relatório e a página para imprimir o marcador.',
  },
];

export default [...swing, ...vbt];
