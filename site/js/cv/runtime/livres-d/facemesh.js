/**
 * cv/runtime/livres-d/facemesh.js — malha do rosto (MediaPipe Face Landmarker,
 * Apache-2.0): 478 pontos 3D = 468 da malha + 10 da íris (5 por olho).
 *
 * É o modelo de pontos do face_landmarker.task convertido de TFLite para ONNX
 * sem mexer nos pesos (senty-au/face_landmarks_detector-ONNX). Como a mão, é
 * SEGUNDO ESTÁGIO: precisa de um quadrado em volta do rosto com os olhos na
 * horizontal. De onde vem esse quadrado:
 *
 * 1. DETECÇÃO: o YuNet que já existe (CV-08). Centro pelos 5 pontos, lado
 *    1,3× o maior lado da caixa, ângulo pela linha dos olhos do YuNet.
 * 2. SEGUIMENTO: com a malha do quadro anterior, o recorte sai dos próprios
 *    pontos (caixa dos 468 no referencial dos olhos 33→263, lado 1,5×). É o
 *    que o MediaPipe faz: o detector só roda de tempos em tempos, e o recorte
 *    vindo da malha é mais justo que o da caixa do detector.
 *
 * Conferido em Python (mesma geometria) em 11 rostos de 9 fotos: presença
 * ≥ 0,98, a segunda passada move os pontos só ~1 px (em 256), malha e íris em
 * cima do rosto. Escala 1,6 na detecção derrubava a presença de rostos de
 * perfil para 0,34 — daí 1,3.
 *
 * Índices: 33/133 = cantos do olho DIREITO da pessoa (à esquerda numa foto não
 * espelhada), 362/263 = olho esquerdo; 468 = centro da íris direita (469-472 a
 * borda), 473 = centro da íris esquerda (474-477). Conferido pela distância de
 * cada centro aos cantos de cada olho.
 */
import { MODELS, run, makeTensor } from '../onnx.js';
import { toTensorData } from '../tensor.js';
import { detectFaces } from '../face.js';
import { frameCanvas, rotCrop, cropToImage, roiFromPoints, sigmoid, dist } from './geom.js';

export const MESH_ID = 'mp-malha';

/** Malha num ROI: { pts:[478 {x,y,z}] em pixels, presenca 0..1, roi }. */
export async function meshFromRoi(canvas, roi) {
  const spec = MODELS[MESH_ID];
  const S = spec.input[1];
  const img = rotCrop(canvas, roi, S);
  const out = await run(MESH_ID, await makeTensor(toTensorData(img, spec), spec.input));
  const lm = out.Identity.data;
  const k = roi.size / S;
  const pts = new Array(478);
  for (let i = 0; i < 478; i++) {
    const p = cropToImage(roi, S, lm[3 * i], lm[3 * i + 1]);
    pts[i] = { x: p.x, y: p.y, z: lm[3 * i + 2] * k };
  }
  return { pts, presenca: sigmoid(out.Identity_1.data[0]), roi };
}

/** ROI do quadro seguinte a partir da malha (olhos na horizontal, lado 1,5×). */
export function roiFromMesh(pts) {
  const ang = Math.atan2(pts[263].y - pts[33].y, pts[263].x - pts[33].x);
  return roiFromPoints(pts.slice(0, 468), ang, 1.5);
}

/**
 * ROI a partir de um rosto do YuNet.
 *
 * O CENTRO SAI DOS 5 PONTOS, NÃO DA CAIXA. O detectFaces de runtime/face.js
 * devolve x1,y1 que na verdade são o CENTRO da caixa (a caixa sai deslocada
 * meia largura para a direita e para baixo — conferido contra o
 * cv2.FaceDetectorYN no mesmo modelo); largura e altura estão certas. O
 * centróide dos 5 pontos fica ~6,5% da altura abaixo do centro verdadeiro
 * (medido em 11 rostos), e o refinamento pela malha corrige o resto. Assim
 * vale com ou sem a correção daquele arquivo.
 */
export function roiFromYunet(f) {
  const L = f.landmarks;
  const [olhoD, olhoE] = L;                      // olho direito da pessoa primeiro
  const w = f.x2 - f.x1, h = f.y2 - f.y1;
  const cx = L.reduce((s, q) => s + q.x, 0) / L.length;
  const cy = L.reduce((s, q) => s + q.y, 0) / L.length - 0.065 * h;
  return { cx, cy, size: Math.max(w, h) * 1.3, ang: Math.atan2(olhoE.y - olhoD.y, olhoE.x - olhoD.x) };
}

/**
 * Detecta/segue até `max` rostos. `memo` guarda os ROIs entre chamadas (um
 * por operador). O YuNet roda quando não há rosto seguido ou a cada
 * `redetectMs` (para achar rostos novos e corrigir um seguimento que derivou).
 */
export async function trackFaces(img, memo, { conf = 0.7, max = 1, presenca = 0.5, redetectMs = 1000, seguir = true, refinar = true } = {}) {
  const canvas = frameCanvas(img, 'rosto');
  const agora = performance.now();
  let rois = seguir ? (memo.rois || []) : [];
  const precisaDetectar = !rois.length || !memo.tDet || agora - memo.tDet > redetectMs;
  if (precisaDetectar) {
    memo.tDet = agora;
    const faces = await detectFaces(img, { conf, max: max + 2 });
    for (const f of faces) {
      const r = roiFromYunet(f);
      // rosto que já está sendo seguido: fica o ROI da malha, que é melhor
      if (rois.some((q) => Math.hypot(q.cx - r.cx, q.cy - r.cy) < 0.35 * q.size)) continue;
      rois = rois.concat([r]);
    }
  }
  const res = [];
  for (const roi of rois) {
    if (res.length >= max) break;
    let m = await meshFromRoi(canvas, roi);
    // segunda passada com o recorte vindo da própria malha (só faz sentido
    // quando o ROI veio do detector — o do seguimento já é esse)
    if (refinar && !roi.daMalha && m.presenca >= presenca) {
      const m2 = await meshFromRoi(canvas, roiFromMesh(m.pts));
      if (m2.presenca >= m.presenca * 0.9) m = m2;
    }
    if (m.presenca < presenca) continue;
    // dois ROIs que convergiram para o mesmo rosto
    const c = m.pts[1];
    if (res.some((o) => dist(o.pts[1], c) < 0.2 * o.roi.size)) continue;
    res.push(m);
  }
  memo.rois = res.map((m) => ({ ...roiFromMesh(m.pts), daMalha: true }));
  return res;
}

// ------------------------------------------------------------ medidas

/**
 * Orientação da cabeça pelos pontos 3D (z da malha na mesma escala de x,y):
 * eixo x = canto externo do olho direito → do esquerdo (33→263), eixo y =
 * testa → queixo (10→152), normal = x × y. Graus:
 *   yaw   > 0: rosto virado para a DIREITA da imagem
 *   pitch > 0: olhando para CIMA
 *   roll  > 0: cabeça inclinada no sentido horário (na imagem)
 * Aproximado: sem calibração de câmera, erro típico de 5-10°.
 * Sinais conferidos em fotos: rosto virado para a esquerda da imagem deu
 * yaw ≈ −33 e −20.
 */
export function headPose(P) {
  const a = P[33], b = P[263], t = P[10], q = P[152];
  const ex = [b.x - a.x, b.y - a.y, b.z - a.z], ey = [q.x - t.x, q.y - t.y, q.z - t.z];
  const n = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  const deg = 180 / Math.PI;
  return {
    yaw: -Math.atan2(n[0], n[2]) * deg,
    pitch: Math.atan2(n[1], Math.hypot(n[0], n[2])) * deg,
    roll: Math.atan2(ex[1], ex[0]) * deg,
  };
}

/** Os 6 pontos do EAR por olho: canto, pálpebra sup. ×2, canto, pálpebra inf. ×2. */
export const EAR_DIR = [33, 160, 158, 133, 153, 144];
export const EAR_ESQ = [362, 385, 387, 263, 373, 380];

/** Eye aspect ratio (Soukupová & Čech 2016): (|p2−p6| + |p3−p5|) / (2·|p1−p4|). */
export function ear(P, idx) {
  const p = idx.map((i) => P[i]);
  const w = dist(p[0], p[3]);
  return w > 0 ? (dist(p[1], p[5]) + dist(p[2], p[4])) / (2 * w) : 0;
}

/**
 * Posição da íris dentro do olho, em frações da largura do olho:
 *   h: 0 = canto da esquerda da imagem, 1 = canto da direita (0,5 ≈ centro)
 *   v: deslocamento perpendicular à linha dos cantos, + = para baixo
 * Medido em 9 rostos olhando para a câmera: h ≈ 0,44 (olho dir.) e 0,55
 * (olho esq.) — a média dos dois ≈ 0,5 —, v ≈ −0,05 (a íris fica um pouco
 * acima da linha dos cantos). Por isso o centro vertical é −0,05.
 */
function irisPos(P, c, a, b) {
  const ux = P[b].x - P[a].x, uy = P[b].y - P[a].y, L = Math.hypot(ux, uy) || 1;
  const mx = (P[a].x + P[b].x) / 2, my = (P[a].y + P[b].y) / 2;
  const dx = P[c].x - P[a].x, dy = P[c].y - P[a].y;
  return { h: (dx * ux + dy * uy) / (L * L), v: ((P[c].x - mx) * -uy + (P[c].y - my) * ux) / (L * L) };
}
export const V_CENTRO = -0.05;

/** Íris (centro e raio, px), EAR e posição do olhar, por olho e média. */
export function eyeMetrics(P) {
  const raio = (c) => [1, 2, 3, 4].reduce((s, k) => s + dist(P[c], P[c + k]), 0) / 4;
  const dir = { iris: { x: P[468].x, y: P[468].y, r: raio(468) }, ear: ear(P, EAR_DIR), ...irisPos(P, 468, 33, 133) };
  const esq = { iris: { x: P[473].x, y: P[473].y, r: raio(473) }, ear: ear(P, EAR_ESQ), ...irisPos(P, 473, 362, 263) };
  return { dir, esq, ear: (dir.ear + esq.ear) / 2, h: (dir.h + esq.h) / 2, v: (dir.v + esq.v) / 2 };
}
