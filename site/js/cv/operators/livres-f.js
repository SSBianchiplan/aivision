/**
 * Operadores livres — grupo F: ergonomia RULA/REBA. A pose é a do CV-18
 * (RTMO, Apache-2.0) e as mãos, opcionais, as do CV-25 (MediaPipe Hands,
 * Apache-2.0): nenhum modelo novo, por isso models-livres-f.js fica vazio.
 */
import ergonomia from './livres-f/ergonomia.js';

export const MODULES_F = [
  {
    id: 'CV-29',
    name: 'Ergonomia (RULA/REBA)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['rtmo-s'],
    desc: 'Avaliação postural do trabalho pela câmera, no navegador: RULA (membros superiores) e REBA ' +
          '(corpo inteiro) com as tabelas oficiais, uma nota por pessoa (várias pessoas, ID estável), ' +
          'ângulos de braço, antebraço, punho (com as mãos do CV-25), pescoço, tronco e pernas, nível de ' +
          'ação, % do tempo em cada nível, pior postura congelada e alertas. Painel Ergonomia com ' +
          'recomendações e relatório CSV/JSON/PDF. Estimativa sem marcadores. Usa a pose do CV-18 (Apache-2.0).',
  },
];

export default [...ergonomia];
