/**
 * components/presets-motion3d.js — presets do Motion 3D Studio (CV-88), no formato de
 * presets-onda1a.js. O Panels.js funde este grupo aos dele. Abrem o hub Esportes, onde fica o
 * cartão "Motion 3D Studio" (a tela cheia com o 3D, as tomadas e as exportações).
 */
export const PRESETS_MOTION3D = [
  { grupo: 'Motion 3D', nome: 'Motion 3D — captura ao vivo', painel: 'esportes',
    desc: 'Pose 3D de uma câmera (BlazePose com os pontos do mundo), One Euro, taxa e latência; esqueleto verde-água ' +
          'sobre o vídeo. Abra o Motion 3D Studio no hub Esportes para gravar tomadas e exportar BVH/GLB.',
    specs: [['motion3d.captura', {}]] },
  { grupo: 'Motion 3D', nome: 'Motion 3D — corpo + mãos', painel: 'esportes',
    desc: 'Como a captura ao vivo, com as mãos (21 pontos cada) da detecção de mãos antes na cadeia: o Studio desenha os dedos.',
    specs: [['maos.gestos', { max: 2, gestos: false }], ['motion3d.captura', {}]] },
  { grupo: 'Motion 3D', nome: 'Motion 3D — vídeo gravado (30 Hz)', painel: 'esportes',
    desc: 'Para analisar um arquivo de vídeo: amostragem limitada a 30 Hz, re-detecção mais frequente para cortes de cena.',
    specs: [['motion3d.captura', { everyMs: 33, detectarMs: 2000 }]] },
];
