/**
 * Operadores livres — grupo Q: INDUSTRIAL, monitor de EPI (CV-48), estágio 1
 * sem treino: pose RTMO (CV-18) recorta cabeça e tronco e o MobileCLIP2 (CV-15)
 * decide com frases. Nenhum modelo novo — sem models-livres-q.js.
 */
import epi from './livres-q/epi.js';

export const MODULES_Q = [
  {
    id: 'CV-48',
    name: 'Industrial — monitor de EPI (sem treino)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['rtmo-s', 'mclip2-visual', 'mclip2-text'],
    desc: 'Capacete e colete por pessoa, sem treinar: a pose RTMO recorta cabeça e tronco e o MobileCLIP2 compara com ' +
          'frases configuráveis; votação no tempo por pessoa rastreada, conformidade por zona (áreas "Zona de ' +
          'contagem"), eventos de não conformidade e CSV, rosto borrado sem reconhecimento facial (LGPD). Estágio 2 ' +
          'pronto: amostras com caixas pré-rotuladas para o +Projeto e o Treinar (RF-DETR).',
  },
];

export default [...epi];
