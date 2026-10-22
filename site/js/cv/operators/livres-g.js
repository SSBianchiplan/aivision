/**
 * Operadores livres — grupo G: academia (repetições e forma). A pose é a do
 * CV-06 (YOLOX + BlazePose, Apache-2.0): nenhum modelo novo, por isso
 * models-livres-g.js fica vazio.
 */
import academia from './livres-g/academia.js';

export const MODULES_G = [
  {
    id: 'CV-30',
    name: 'Academia (repetições e forma)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Contador de repetições e treinador de forma pela câmera, no navegador: agachamento, flexão de braço, ' +
          'rosca bíceps, desenvolvimento de ombro, levantamento terra, afundo, polichinelo, abdominal e prancha ' +
          '(tempo e alinhamento), com o exercício escolhido ou reconhecido automaticamente. Séries pela pausa, ' +
          'amplitude, profundidade, tempos excêntrico/concêntrico e sob tensão, ritmo e checagens de forma ' +
          '(tronco, joelho × ponta do pé, valgo, quadril caindo, cotovelo abrindo, costas, assimetria) com ' +
          'repetição boa × com alerta, placar grande no vídeo e bipe. Painel Academia com metas, lista de ' +
          'repetições e relatório CSV/JSON/HTML. Usa a pose do CV-06 (Apache-2.0).',
  },
];

export default [...academia];
