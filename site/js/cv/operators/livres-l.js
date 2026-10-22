/**
 * Operadores livres — grupo L: INDUSTRIAL, contagem em esteira (CV-38).
 * Porte do GPlanSiS|CounterVision: motor COR (JS puro, sem modelo), detector
 * ONNX do usuário (o arquivo fica no navegador) e a produção (totais, taxa,
 * turnos, metas, alarmes, eventos, CSV). Sem peso próprio: models-livres-l.js
 * fica vazio; os detectores livres do iaVision (YOLOX, RF-DETR) também servem.
 */
import contagem from './livres-l/contagem.js';

export const MODULES_L = [
  {
    id: 'CV-38',
    name: 'Contagem em esteira (CounterVision)',
    status: 'ready',
    runtime: 'client',
    desc: 'Contagem de peças em esteira, no navegador (porte do GPlanSiS|CounterVision): motor COR sem modelo ' +
          '(amostra por clique, tolerância, máscara, separação de peças encostadas, rastreio com ID) ou detector ' +
          '(YOLOX, RF-DETR, o seu .onnx) + rastreio; conta pelas linhas (com sentido) e zonas das Ferramentas ' +
          'de mouse; peças/min e /h, turnos e metas, alarmes de parada e de taxa, eventos e CSV, fila guardada ' +
          'neste navegador e captura de quadros com caixas YOLO para o Treinar. Tela GPlanSiS|CounterVision.',
  },
];

export default [...contagem];
