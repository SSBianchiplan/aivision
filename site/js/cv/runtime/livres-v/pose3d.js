/**
 * cv/runtime/livres-v/pose3d.js — CV-88 Motion 3D Studio: a pose 3D de UMA câmera.
 *
 * É o RastreadorPose do Salto/Corrida/Fisio (runtime/livres-h/pose.js: YOLOX acha a pessoa,
 * BlazePose segue o recorte girado pelos auxiliares) com uma coisa a mais: os 33 pontos
 * "do mundo" que o MESMO modelo já devolve (saída de 39 × 3, metros, origem no meio do
 * quadril) — os `worldLandmarks` do MediaPipe Pose Landmarker. Por isso o Studio NÃO
 * vendoriza o @mediapipe/tasks-vision: seriam ~10 MB de WASM e outro modelo para a mesma
 * rede que o iaVision já roda no ORT-web (fila única, WebGPU/WASM). Nenhuma inferência a
 * mais: o _inferir abaixo é o do pai, guardando também a saída do mundo.
 *
 * Eixos: o modelo devolve os pontos do mundo no referencial do RECORTE (x direita, y baixo,
 * z para longe da câmera). Aqui eles voltam para o referencial da câmera NÃO espelhada (o
 * espelho é só de exibição: a anatomia nunca troca de lado) e passam para a convenção do
 * MoCap do GPlanSiS|ROBO: metros, y para cima, +x = esquerda da pessoa, +z = frente
 * (core/mocap/motor.ts do robo, modo monocular: [x, −y + 0,95, −z]).
 */
import { RastreadorPose } from '../livres-h/pose.js';
import { MODELS, run, makeTensor } from '../onnx.js';
import { toTensorData } from '../tensor.js';

/** Altura do quadril do modo monocular do robo (o mundo do MediaPipe tem origem no quadril). */
export const ALTURA_QUADRIL_MONO = 0.95;

/**
 * Pontos do mundo no recorte (Float32Array 99+) → 33 × [x, y, z] na convenção do robo.
 * `roi` = { ux, uy } (eixo "para cima" do recorte no quadro exibido), `esp` = quadro exibido
 * espelhado. Pura (testada no node: t-motion3d.mjs).
 */
export function mundoParaRobo(w, roi, esp) {
  const a = { x: -roi.uy, y: roi.ux }, b = { x: -roi.ux, y: -roi.uy };
  const out = [];
  for (let i = 0; i < 33; i++) {
    const wx = w[3 * i], wy = w[3 * i + 1], wz = w[3 * i + 2];
    if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) { out.push(null); continue; }
    // eixos do recorte no quadro NÃO espelhado: com espelho, direita = (a.x, −a.y), baixo = (−b.x, b.y)
    const ix = esp ? wx * a.x - wy * b.x : wx * a.x + wy * b.x;
    const iy = esp ? -wx * a.y + wy * b.y : wx * a.y + wy * b.y;
    out.push([ix, -iy + ALTURA_QUADRIL_MONO, -wz]);
  }
  return out;
}

export class RastreadorMotion extends RastreadorPose {
  zerar() { super.zerar(); this._mundoDe = new WeakMap(); }

  /** O _inferir do pai, guardando também a saída do mundo (cópia: o ORT reusa buffers). */
  async _inferir(crop) {
    const ps = MODELS.pose;
    const o2 = await run('pose', await makeTensor(toTensorData(crop, ps), ps.input));
    let lms = null, presenca = null, mundo = null;
    for (const key of Object.keys(o2)) {
      const d = o2[key];
      if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) lms = d.data;
      else if (d.dims.length === 2 && d.dims[1] === ps.landmarks * 3) mundo = d.data.slice(0, 99);
      else if (d.dims.length === 2 && d.dims[1] === 1) presenca = d.data[0];
    }
    this._mundo = mundo;
    return lms ? { lms, presenca } : null;
  }

  /** O pai escolhe entre várias estimativas (rotações da semente): o W vai junto do P de cada uma. */
  async _poseNaRoi(roi, esp) {
    this._mundo = null;
    const r = await super._poseNaRoi(roi, esp);
    if (r && this._mundo) this._mundoDe.set(r.P, mundoParaRobo(this._mundo, roi, esp));
    return r;
  }

  /** Como estimar() do pai; o resultado ganha W (33 pontos 3D, convenção do robo) ou W = null. */
  async _seguir(prep) {
    const r = await super._seguir(prep);
    if (r && !r.sem) r.W = (r.P && this._mundoDe.get(r.P)) || null;
    return r;
  }
}
