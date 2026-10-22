/**
 * Operadores livres — grupo A (out/2026). Pesos Apache-2.0 / MIT, sem AGPL.
 *
 *   CV-17 OCR PT-BR ........ PP-OCRv5 mobile, reconhecedor latino (livres-a/ocr.js)
 *   CV-18 Pose RTMO ........ RTMO-s, multi-pessoa em um estágio (livres-a/pose.js)
 *   CV-19 Re-ID ............ Youtu ReID (OpenCV Zoo), IDs por aparência (livres-a/reid.js)
 *   CV-20 Recorte de fundo . BiRefNet lite 512 (livres-a/recorte.js)
 */
import ocr from './livres-a/ocr.js';
import pose from './livres-a/pose.js';
import reid from './livres-a/reid.js';
import recorte from './livres-a/recorte.js';

export const MODULES_A = [
  {
    id: 'CV-17',
    name: 'OCR PT-BR',
    status: 'ready',
    runtime: 'onnx',
    weights: ['ocr5-det', 'ocr5-latin'],
    desc: 'PP-OCRv5 mobile: detector DB + reconhecedor latino de 836 caracteres — lê português ' +
          'com acentos, cedilha e pontuação ("AÇÚCAR", "R$ 4,99", "até 31/12"). Apache-2.0.',
  },
  {
    id: 'CV-18',
    name: 'Pose multi-pessoa (RTMO)',
    status: 'ready',
    runtime: 'onnx',
    weights: ['rtmo-s'],
    desc: 'RTMO-s (MMPose): todas as pessoas da cena num único passe, 17 pontos COCO cada, sem ' +
          'detector separado. Publica as caixas para Re-ID e tracking. Apache-2.0.',
  },
  {
    id: 'CV-19',
    name: 'Re-identificação de pessoas',
    status: 'ready',
    runtime: 'onnx',
    weights: ['reid-youtu'],
    desc: 'Youtu ReID (OpenCV Zoo): IDs persistentes por aparência — a pessoa mantém o número ' +
          'depois de oclusão ou de sair e voltar. Galeria com média móvel e cosseno sobre as ' +
          'caixas do detector anterior. Apache-2.0; substitui o re-ID do YOLO26.',
  },
  {
    id: 'CV-20',
    name: 'Recorte de fundo',
    status: 'ready',
    runtime: 'onnx',
    weights: ['birefnet-lite'],
    desc: 'BiRefNet lite: separa o objeto principal do fundo com borda fina, para qualquer objeto. ' +
          'Remover fundo (xadrez/alfa), fundo escuro, desfoque, croma ou só máscara. MIT.',
  },
];

export default [...ocr, ...pose, ...reid, ...recorte];
