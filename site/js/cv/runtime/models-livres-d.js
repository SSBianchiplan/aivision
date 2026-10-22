/**
 * Modelos livres — grupo D: mãos, malha do rosto e olhos (ver o comentário em onnx.js).
 *
 * Os três são do MediaPipe (Google, Apache-2.0) já em ONNX. Formas e nomes de
 * entrada/saída lidos do grafo com onnxruntime 1.31; todos NHWC, RGB em 0..1.
 * A detecção de rosto reusa o YuNet do catálogo principal (CV-08).
 */
export default {
  'mp-palma': {
    file: 'models/livres/d/palm_detection_mediapipe_2023feb.onnx',
    bytes: 3905734,
    name: 'MediaPipe Palm Detection (palma)',
    task: 'palm_detection',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo · opencv/palm_detection_mediapipe',
    // saídas: Identity [1,2016,18] (caixa cx,cy,w,h + 7 pontos, em px de 192
    // relativos à âncora) e Identity_1 [1,2016,1] (logit)
    input: [1, 192, 192, 3],
    layout: 'nhwc',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
  },
  'mp-mao': {
    file: 'models/livres/d/handpose_estimation_mediapipe_2023feb.onnx',
    bytes: 4099621,
    name: 'MediaPipe Hand Landmarks (21 pontos)',
    task: 'hand_landmarks',
    license: 'Apache-2.0',
    source: 'OpenCV Zoo · opencv/handpose_estimation_mediapipe',
    // saídas: Identity [1,63] pontos x,y,z em px de 224; Identity_1 [1,1]
    // presença; Identity_2 [1,1] lateralidade (>0,5 = mão direita numa imagem
    // não espelhada); Identity_3 [1,63] pontos 3D em metros
    input: [1, 224, 224, 3],
    layout: 'nhwc',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
  },
  'mp-malha': {
    file: 'models/livres/d/face_landmarks_478.onnx',
    bytes: 4920995,
    name: 'MediaPipe Face Landmarker (478 pontos com íris)',
    task: 'face_landmarks',
    license: 'Apache-2.0',
    // conversão TFLite -> ONNX (tf2onnx, opset 17) do face_landmarks_detector
    // do face_landmarker.task v1 float16, pesos inalterados;
    // sha256 7d6e82dee82a1dca5fbddb282b3cc74571833a530de317fc22ae325c3358beeb
    source: 'Google MediaPipe · senty-au/face_landmarks_detector-ONNX',
    // saídas: Identity [N,1,1,1434] = 478 × x,y,z em px de 256;
    // Identity_1 [N,1,1,1] logit de presença; Identity_2 [N,1] auxiliar
    input: [1, 256, 256, 3],
    layout: 'nhwc',
    mean: [0, 0, 0], std: [1, 1, 1], scale: 1 / 255,
  },
};
