/**
 * Operadores livres — grupo P: SAÚDE, fisioterapia (CV-47). Goniometria e
 * testes funcionais sobre a pose BlazePose do CV-06 (YOLOX + pose), o mesmo
 * caminho do Salto e da Corrida: nenhum modelo novo — sem models-livres-p.js.
 */
import fisio from './livres-p/fisio.js';

export const MODULES_P = [
  {
    id: 'CV-47',
    name: 'Fisio — goniometria e testes funcionais',
    status: 'ready',
    runtime: 'onnx',
    weights: ['yolox', 'pose'],
    desc: 'Fisioterapia pela câmera, no navegador: amplitude de movimento por articulação e lado (joelho, quadril, ' +
          'ombro, cotovelo, tornozelo; máximo, mínimo e % da referência AAOS), Timed Up and Go com as fases ' +
          '(levantar, ida, giro, volta, sentar) e velocidade de marcha, sentar-levantar 5× e 30 s com as normas ' +
          'por idade e sexo — referências sempre com a fonte. Tempo do vídeo exato ao quadro. Studio Fisio com ' +
          'perfil do paciente (só neste aparelho), curvas, tabela, CSV, PNG e relatório para PDF. Não é ' +
          'dispositivo médico.',
  },
];

export default [...fisio];
