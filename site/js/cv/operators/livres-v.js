/**
 * Operadores livres — grupo V: Motion 3D Studio (CV-88), captura de movimento 3D.
 *
 * Um operador só (motion3d.captura): a pose BlazePose do CV-06 com os pontos 3D do mundo que o
 * mesmo modelo já devolve — nenhum modelo novo, sem models-livres-v.js. O resto é o Studio em
 * tela cheia (components/motion3d/StudioMotion3D.js, sob demanda) com o MoCap do GPlanSiS|ROBO
 * vendorizado (vendor/gplansis-robo-mocap: calibração multicâmera pelo corpo, triangulação,
 * pós-processamento, BVH) e o three.js 0.170.0 (vendor/three-0.170.0). GVHMR, ExMR e FlowHMR são
 * conectores de servidor (serviço aivision-motion), com estado honesto: não vêm instalados.
 */
import motion3d from './livres-v/motion3d.js';

export const MODULES_V = [
  {
    id: 'CV-88',
    name: 'Motion 3D Studio — captura de movimento 3D',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Captura de movimento 3D no navegador, num estúdio em tela cheia: esqueleto 2D sobre o vídeo e 3D (three.js) ' +
          'com órbita, grade e piso, gravação de tomadas com timecode, corte e reprodução, suavização One Euro, ' +
          'ângulos das articulações (educacional, não é laudo), retarget para um esqueleto padrão e avatar, ' +
          'exportação BVH e GLB para o Blender, JSON (motionai.pose.v1) e CSV. Multicâmera de 1 a 4 câmeras com ' +
          'calibração pelo próprio corpo (MoCap do GPlanSiS|ROBO), importação do FreeMoCap e guia ChArUco. ' +
          'GVHMR, ExMR e FlowHMR como conectores de servidor com consentimento — não instalados por padrão.',
  },
];

export default [...motion3d];
