/**
 * cv/runtime/labels.js — vocabulários dos modelos.
 *
 * O ImageNet (1000 classes) mora num .txt carregado sob demanda; não vale
 * embutir 10 KB de string num módulo que a maioria das sessões nem usa.
 */

/** COCO, na ordem em que o YOLOX emite os índices de classe. */
export const COCO_CLASSES = [
  'pessoa', 'bicicleta', 'carro', 'moto', 'avião', 'ônibus', 'trem', 'caminhão',
  'barco', 'semáforo', 'hidrante', 'placa pare', 'parquímetro', 'banco',
  'pássaro', 'gato', 'cachorro', 'cavalo', 'ovelha', 'vaca', 'elefante', 'urso',
  'zebra', 'girafa', 'mochila', 'guarda-chuva', 'bolsa', 'gravata', 'mala',
  'frisbee', 'esqui', 'snowboard', 'bola', 'pipa', 'taco de beisebol',
  'luva de beisebol', 'skate', 'prancha de surf', 'raquete', 'garrafa',
  'taça', 'copo', 'garfo', 'faca', 'colher', 'tigela', 'banana', 'maçã',
  'sanduíche', 'laranja', 'brócolis', 'cenoura', 'cachorro-quente', 'pizza',
  'rosquinha', 'bolo', 'cadeira', 'sofá', 'planta', 'cama', 'mesa', 'privada',
  'tv', 'notebook', 'mouse', 'controle', 'teclado', 'celular', 'micro-ondas',
  'forno', 'torradeira', 'pia', 'geladeira', 'livro', 'relógio', 'vaso',
  'tesoura', 'urso de pelúcia', 'secador', 'escova de dentes',
];

/** Charset do CRNN: 36 símbolos + blank (o blank é o índice 0 na saída). */
export const CHARSET_EN = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');

/**
 * Conexões do esqueleto BlazePose. O modelo emite 39 landmarks; os 33
 * primeiros são os padrão do MediaPipe Pose e os 6 finais são auxiliares
 * de alinhamento, que não desenhamos.
 */
export const POSE_CONNECTIONS = [
  // rosto
  [0, 2], [2, 7], [0, 5], [5, 8], [9, 10],
  // tronco
  [11, 12], [11, 23], [12, 24], [23, 24],
  // braço esquerdo
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // braço direito
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // perna esquerda
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // perna direita
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

export const POSE_VISIBLE_LANDMARKS = 33;

let imagenetPromise = null;

/** Carrega os 1000 rótulos do ImageNet uma única vez. */
export function loadImagenetLabels() {
  if (imagenetPromise) return imagenetPromise;
  imagenetPromise = fetch('models/imagenet_labels.txt')
    .then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    })
    .then((t) => t.split('\n').map((s) => s.trim()).filter(Boolean))
    .catch(() => []);   // sem rótulo o operador ainda funciona, mostra o índice
  return imagenetPromise;
}
