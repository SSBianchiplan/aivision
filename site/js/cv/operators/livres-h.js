/**
 * Operadores livres — grupo H: salto e corrida. A pose é a do CV-06 (YOLOX +
 * BlazePose, Apache-2.0), seguida pelos próprios pontos: nenhum modelo novo,
 * por isso models-livres-h.js fica vazio.
 */
import salto from './livres-h/salto.js';
import corrida from './livres-h/corrida.js';

export const MODULES_H = [
  {
    id: 'CV-31',
    name: 'Salto e testes físicos',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Testes de salto pela câmera, no navegador: salto com contramovimento (CMJ), squat jump, drop jump ' +
          '(tempo de contato e RSI), saltos contínuos (média e fadiga) e salto horizontal. Altura pelo tempo de ' +
          'voo (h = g·t²/8) e pela subida do centro de massa com escala pela altura da pessoa, profundidade do ' +
          'contramovimento, tempo de carga, ângulos de joelho e quadril na decolagem e na aterrissagem, ' +
          'aterrissagem assimétrica e valgo (vista frontal), sempre com a incerteza da taxa de quadros. Análise ' +
          'quadro a quadro de vídeo (inclusive câmera lenta). Painel Salto com tentativas, comparação e relatório ' +
          'CSV/JSON/PDF. Usa a pose do CV-06 (Apache-2.0).',
  },
  {
    id: 'CV-32',
    name: 'Corrida (marcha)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Análise da corrida em esteira ou pista, câmera de lado: cadência, tempo de contato e de voo, fases de ' +
          'apoio e balanço, oscilação vertical do quadril, joelho no contato e flexão máxima, tornozelo, padrão de ' +
          'pisada (retropé, médio-pé, antepé), overstriding, inclinação do tronco e simetria esquerda/direita; de ' +
          'trás ou de frente, queda da pelve e cruzamento. Comprimento da passada com a velocidade da esteira. ' +
          'Painel Corrida com resumo por lado, alertas e relatório. Usa a pose do CV-06 (Apache-2.0).',
  },
];

export default [...salto, ...corrida];
