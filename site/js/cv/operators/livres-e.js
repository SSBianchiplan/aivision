/**
 * Operadores livres — grupo E: bike fit. A pose é a do CV-06 (YOLOX +
 * BlazePose, Apache-2.0): nenhum modelo novo, por isso models-livres-e.js
 * fica vazio.
 */
import bikefit from './livres-e/bikefit.js';

export const MODULES_E = [
  {
    id: 'CV-28',
    name: 'Bike Fit (biomecânica)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Ajuste biomecânico do ciclista pela câmera, no navegador: ângulos de joelho (PMI/PMS), ' +
          'quadril, tronco, ombro, cotovelo e tornozelo na vista lateral; cadência e pedaladas pela ' +
          'trajetória do pé; KOPS aproximado; alinhamento e simetria dos joelhos na vista frontal; ' +
          'faixas por perfil (estrada, MTB, contrarrelógio, urbano) e recomendações de selim e ' +
          'guidão. Painel Bike Fit com relatório CSV/JSON/PDF. Usa a pose do CV-06 (Apache-2.0).',
  },
];

export default [...bikefit];
