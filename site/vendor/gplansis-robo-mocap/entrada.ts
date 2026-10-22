// Entrada do bundle do MoCap do GPlanSiS|ROBO para o iaVision (Motion 3D Studio, CV-88).
// Só reexporta o núcleo PURO (sem React, sem MediaPipe, sem tema do robo). A cena 3D e o motor
// de câmeras foram portados à mão para o iaVision (js/cv/runtime/livres-v/), porque dependem
// do tema e do detector do robo.
export * from "ROBO/src/core/mocap/geometria";
export * from "ROBO/src/core/mocap/posproc";
export { paraCSV, paraJSON, paraBVH, lerBVH } from "ROBO/src/core/mocap/exportar";
export { gerarSessao, pessoaNoTempo, cameraOlhando } from "ROBO/src/core/mocap/sintetico";
export type { SessaoSintetica } from "ROBO/src/core/mocap/sintetico";
export { OneEuro } from "ROBO/src/core/filtros";
export { casco, margem } from "ROBO/src/core/rv03/marcha";
