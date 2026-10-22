/**
 * Operadores livres — grupo K: INDUSTRIAL (CV-36). O primeiro módulo é a
 * volumetria de correia transportadora (porte do GPlanSiS|BELTSCAN): JS puro
 * sobre ImageData, sem modelo — por isso models-livres-k.js fica vazio.
 */
import beltscan from './livres-k/beltscan.js';

export const MODULES_K = [
  {
    id: 'CV-36',
    name: 'Industrial — volumetria de correia (BeltScan)',
    status: 'ready',
    runtime: 'client',
    desc: 'Volumetria de correia transportadora pela câmera e uma linha laser, no navegador: linha ' +
          'subpixel, altura por triangulação com o ângulo da câmera, seção na calha (DIN 22101), vazão ' +
          'm³/h, massa seca t/h, nível representativo com altura limite e alarmes ISA-18.2 (banda morta, ' +
          'retardos, prioridade, supressão, reconhecimento, histórico CSV). Na bancada, seção em mm² × ' +
          'velocidade por correlação de fase = cm³/s e volume. Configuração "beltscan/4" compatível com ' +
          'o GPlanSiS|BELTSCAN (HTML e Python). Tela cheia GPlanSiS|BeltScan com ensaios de feijão.',
  },
];

export default [...beltscan];
