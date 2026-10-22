/**
 * Operadores livres — grupo M: INDUSTRIAL, tempo de posto (CV-39). Porte do
 * GPlanSiS|Takt: escore de atividade pela pose, máquina de estados por posto,
 * turnos e pausas, homografia do piso e rostos borrados. JS puro sobre a pose
 * que já existe no app (RTMO, CV-18): nenhum modelo novo — por isso não há
 * models-livres-m.js.
 */
import takt from './livres-m/takt.js';
import privacidade from './livres-m/privacidade.js';

export const MODULES_M = [
  {
    id: 'CV-39',
    name: 'Industrial — tempo de posto (Takt)',
    status: 'ready',
    runtime: 'client',
    weights: ['rtmo-s'],
    desc: 'Tempo de posto pela câmera, no navegador (porte do GPlanSiS|Takt): postos marcados na imagem, pessoas pela ' +
          'pose multi-pessoa com IDs, escore de atividade (mãos no posto, movimento dos punhos, orientação), estados ' +
          'produtivo / ocioso no posto / vago / pausa programada / não observado com histerese e tempos mínimos, ' +
          'agenda de turnos e pausas, KPI por turno, alarmes, homografia do piso em metros (erro de reprojeção) e ' +
          'rostos borrados por padrão (LGPD) também na gravação e no PNG. Tela cheia GPlanSiS|Takt com Gantt, ' +
          'ranking, planta do piso e CSV.',
  },
];

export default [...takt, ...privacidade];
