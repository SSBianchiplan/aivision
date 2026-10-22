/**
 * Operadores livres — grupo B: Florence-2 (MIT), SAM 2.1 (Apache-2.0) e
 * RF-DETR (Apache-2.0). Cada um num arquivo em operators/livres-b/; aqui só
 * o catálogo de módulos e a lista que o registry.js junta.
 */
import florence from './livres-b/florence.js';
import sam2 from './livres-b/sam2.js';
import rfdetr from './livres-b/rfdetr.js';

export const MODULES_B = [
  {
    id: 'CV-21',
    name: 'Florence-2 (descrever, detectar, ler)',
    status: 'ready',
    runtime: 'transformers.js',
    weights: ['florence2'],
    desc: 'Florence-2 base (Microsoft, 230M): um só modelo de visão-linguagem que descreve a ' +
          'cena, detecta objetos de vocabulário livre, lê texto e acha o que você escrever. ' +
          'Roda num worker a cada poucos segundos; responde em inglês. MIT.',
  },
  {
    id: 'CV-22',
    name: 'SAM 2 (seguir objeto)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['sam2-enc', 'sam2-dec', 'rfdetr-nano'],
    desc: 'SAM 2.1 tiny (Meta): marque um objeto — por classe de uma detecção ou por um ponto — ' +
          'e ele é seguido com máscara e contorno, re-promptando com a caixa da máscara anterior. ' +
          'Ou uma máscara por detecção. Apache-2.0.',
  },
  {
    id: 'CV-23',
    name: 'RF-DETR (detecção livre)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['rfdetr-nano', 'rfdetr-small'],
    desc: 'RF-DETR nano/small (Roboflow) no COCO, 80 classes: transformer de detecção sem NMS, ' +
          'a alternativa Apache-2.0 ao YOLO26 (AGPL). Publica as caixas para o resto da cadeia.',
  },
];

export default [...florence, ...sam2, ...rfdetr];
