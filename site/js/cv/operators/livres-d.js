/**
 * Operadores livres — grupo D: mãos, rosto e olhos, todos MediaPipe (Google,
 * Apache-2.0) em ONNX. Cada um num arquivo em operators/livres-d/; aqui só o
 * catálogo de módulos e a lista que o registry.js junta.
 */
import maos from './livres-d/maos.js';
import rosto from './livres-d/rosto.js';
import olhos from './livres-d/olhos.js';

export const MODULES_D = [
  {
    id: 'CV-25',
    name: 'Mãos e gestos',
    status: 'ready',
    runtime: 'onnx',
    weights: ['mp-palma', 'mp-mao'],
    desc: 'MediaPipe Hands (OpenCV Zoo, 8 MB): detector de palma + 21 pontos por mão, até 4 ' +
          'mãos, lado direita/esquerda e gestos por regras — mão aberta, punho, polegar para ' +
          'cima/baixo, apontando, V, OK e contagem de dedos. Apache-2.0.',
  },
  {
    id: 'CV-26',
    name: 'Malha do rosto',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yunet', 'mp-malha'],
    desc: 'MediaPipe Face Landmarker (4,9 MB) sobre o YuNet: 468 pontos do rosto + íris, ' +
          'malha completa ou contornos, e orientação da cabeça (yaw, pitch, roll). Segue o rosto ' +
          'entre quadros pela própria malha. Apache-2.0.',
  },
  {
    id: 'CV-27',
    name: 'Olhos (íris, piscadas, sonolência)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yunet', 'mp-malha'],
    desc: 'Íris e direção aproximada do olhar, olho aberto/fechado pelo EAR, piscadas por ' +
          'minuto, PERCLOS e alerta de sonolência configurável. Reusa a malha do CV-26 quando ' +
          'ele vem antes na cadeia. Apache-2.0.',
  },
];

export default [...maos, ...rosto, ...olhos];
