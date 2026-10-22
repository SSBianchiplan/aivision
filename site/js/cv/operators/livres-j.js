/**
 * Operadores livres — grupo J: esportes coletivos e de quadra (CV-35).
 * Nenhum modelo novo: jogadores e bola vêm do detector da cadeia (YOLOX,
 * RF-DETR, RF-DETR treinado no Treinar) ou do RF-DETR (Apache-2.0) rodado
 * pelo próprio operador. Por isso models-livres-j.js fica vazio.
 */
import quadra from './livres-j/quadra.js';

export const MODULES_J = [
  {
    id: 'CV-35',
    name: 'Esportes coletivos e de quadra',
    status: 'ready',
    runtime: 'onnx',
    weights: ['rfdetr-small', 'rfdetr-nano'],
    desc: 'Futebol, futsal, basquete, vôlei, tênis e padel com uma câmera: jogadores e bola, IDs, times ' +
          'pela cor do uniforme, calibração da quadra por 4+ pontos (homografia) com as medidas oficiais, ' +
          'radar 2D, mapa de calor, distância e velocidade por jogador, tempo por zona; posse e passes, ' +
          'quique dentro/fora, rally e arremessos. Painel Quadra com exportação CSV/JSON e relatório. ' +
          'Usa o RF-DETR (Apache-2.0) ou o detector da cadeia.',
  },
];

export default [...quadra];
