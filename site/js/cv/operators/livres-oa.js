/**
 * Operadores livres — grupo OA (onda 1-a): operadores pequenos em JS puro sobre
 * o que a cadeia já produz (detector + rastreio + zonas, pose RTMO, leitores
 * de código e OCR, ferramentas do Inspect). Nenhum modelo novo — por isso não
 * há models-livres-oa.js.
 *
 *   CV-41 Tráfego: contagem classificada (CVC) e matriz de giro
 *   CV-42 Instrumentos: mostrador analógico e display de 7 segmentos
 *   CV-43 Segurança por pose (indicador de gestão): cerca por parte do corpo,
 *         queda/imobilidade, ponto de encontro
 *   CV-44 Fotocélula virtual: sprint e agilidade
 *   CV-45 Leituras de logística e mídia: chave NF-e, pallet por QR, tempo de tela
 *   (+ cena.mapa_calor no CV-37 Ferramentas de cena)
 *
 * As marcações novas (funções das Ferramentas de mouse) são registradas aqui
 * e só aparecem no seletor com o nó correspondente no Pipeline.
 */
import { registrarFuncao } from '../marcacoes.js';
import trafego from './livres-oa/trafego.js';
import mostrador from './livres-oa/mostrador.js';
import seguranca from './livres-oa/seguranca.js';
import sprint from './livres-oa/sprint.js';
import logistica from './livres-oa/logistica.js';
import mapaCalor from './livres-oa/mapa-calor.js';

const AREAS = ['retangulo', 'poligono', 'elipse', 'mascara'];
registrarFuncao({ valor: 'mostrador', rotulo: 'Instrumento · mostrador (zero → centro → fundo)', tipos: ['angulo'], ops: ['instrumento.mostrador'], cor: '#38bdf8', nome: 'Mostrador' });
registrarFuncao({ valor: 'display7', rotulo: 'Instrumento · display 7 seg.', tipos: AREAS, ops: ['instrumento.display7'], cor: '#38bdf8', nome: 'Display' });
registrarFuncao({ valor: 'cerca', rotulo: 'Segurança · zona proibida', tipos: AREAS, ops: ['seguranca.cerca'], cor: '#FF4D4D', nome: 'Zona proibida' });
registrarFuncao({ valor: 'sprint', rotulo: 'Esportes · fotocélula', tipos: ['linha'], ops: ['esportes.sprint'], cor: '#FFD84D', nome: 'Fotocélula' });

export const MODULES_OA = [
  {
    id: 'CV-41',
    name: 'Tráfego — contagem classificada (CVC)',
    status: 'ready',
    runtime: 'client',
    icone: 'trafego',
    desc: 'Contagem volumétrica classificada de veículos e pedestres (carro, moto, ônibus, caminhão, bicicleta, ' +
          'pedestre) por movimento — zona de origem → zona de destino — e por linha, em blocos de 15 min, com ' +
          'matriz de giro e CSV. Sobre detector (RF-DETR/YOLOX) + Tracking com IDs + Zonas e linhas; a classe de ' +
          'cada ID é a mais votada na trajetória.',
  },
  {
    id: 'CV-42',
    name: 'Instrumentos — mostrador e display',
    status: 'ready',
    runtime: 'client',
    icone: 'manometro',
    desc: 'Leitura de manômetros e mostradores de agulha (marque zero, centro e fundo de escala com o mouse; agulha por ' +
          'gradiente + Hough pelo centro) e de displays de 7 segmentos. Valor, histórico e alarmes ISA-18.2 ' +
          '(LL/L/H/HH, banda morta e atrasos), CSV. JS puro.',
  },
  {
    id: 'CV-43',
    name: 'Segurança por pose (indicador de gestão)',
    status: 'ready',
    runtime: 'client',
    weights: ['rtmo-s'],
    icone: 'seguranca',
    desc: 'Cerca virtual por parte do corpo (mãos, pés, cabeça numa zona proibida, com tempo mínimo e histerese), ' +
          'pessoa caída / no chão / imóvel pela pose e contagem no ponto de encontro. Alarmes ISA-18.2 e eventos ' +
          'no CSV. INDICADOR DE GESTÃO — não é função de segurança (NR-12): não substitui proteção nem intertravamento.',
  },
  {
    id: 'CV-44',
    name: 'Fotocélula virtual (sprint)',
    status: 'ready',
    runtime: 'client',
    weights: ['rtmo-s'],
    icone: 'cronometro',
    desc: 'Cronometragem de sprint por 2 ou mais linhas desenhadas: o tronco/quadril da pose corta cada linha e o ' +
          'instante é interpolado entre quadros. Parciais, tempo total, velocidade por trecho (distâncias ou régua ' +
          'calibrada) e modo agilidade (ida e volta). CSV.',
  },
  {
    id: 'CV-45',
    name: 'Leituras de logística e mídia',
    status: 'ready',
    runtime: 'client',
    icone: 'etiqueta',
    desc: 'Chave de acesso NF-e/CT-e de 44 dígitos (dígito verificador, UF, CNPJ) e rastreio dos Correios a partir ' +
          'dos códigos e do OCR; rastreio de pallets por QR com local por zona; tempo de tela de logo/marca pelas ' +
          'ferramentas do Inspect.',
  },
];

export default [...trafego, ...mostrador, ...seguranca, ...sprint, ...logistica, ...mapaCalor];
