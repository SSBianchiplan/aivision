/**
 * Operadores livres — grupo U (onda 2-d): educação, acessibilidade, mídia, agro e
 * construção. JS puro sobre o que a cadeia já produz (detector + rastreio, pose
 * RTMO, mãos, malha do rosto, OCR, códigos, SAM 2) — nenhum modelo novo.
 *
 *   CV-80 Laboratório de física por vídeo (D1)
 *   CV-81 Acessibilidade: cena falada (X1) e mouse por cabeça (X2)
 *   CV-82 Libras — soletração (X3)
 *   CV-83 Sala de aula: gabarito OMR (92) e mãos levantadas (94)
 *   CV-84 Mídia: corte de cena (95), miniatura (96); busca em vídeo (K4) e cortes por
 *         fala (M2) são ferramentas do painel sobre o arquivo
 *   CV-85 Agro e pecuária: verde (76), armadilha (77), locomoção (80), peso dorsal (A3)
 *   CV-86 Câmera de jogo amador (E1)
 *   CV-87 Diário de obra (C1)
 *
 * O painel é «Aplicações» (components/livres-u/AplicacoesPanel.js), sob demanda.
 */
import { registrarFuncao } from '../marcacoes.js';
import fisica from './livres-u/fisica.js';
import acessivel from './livres-u/acessivel.js';
import libras from './livres-u/libras.js';
import sala from './livres-u/sala.js';
import midia from './livres-u/midia.js';
import agro from './livres-u/agro.js';
import jogo from './livres-u/jogo.js';
import obra from './livres-u/obra.js';

const AREAS = ['retangulo', 'poligono', 'elipse', 'mascara'];
registrarFuncao({ valor: 'gabarito', rotulo: 'Gabarito · folha', tipos: AREAS, ops: ['educacao.gabarito'], cor: '#4ade80', nome: 'Folha' });
registrarFuncao({ valor: 'verde', rotulo: 'Agro · área de verde', tipos: AREAS, ops: ['agro.verde'], cor: '#4ade80', nome: 'Verde' });
registrarFuncao({ valor: 'armadilha', rotulo: 'Agro · armadilha', tipos: AREAS, ops: ['agro.armadilha'], cor: '#FFD84D', nome: 'Armadilha' });
registrarFuncao({ valor: 'pesagem', rotulo: 'Agro · pesagem', tipos: AREAS, ops: ['agro.peso_dorsal'], cor: '#38bdf8', nome: 'Pesagem' });
registrarFuncao({ valor: 'portao', rotulo: 'Obra · portão', tipos: AREAS, ops: ['obra.diario'], cor: '#fb923c', nome: 'Portão' });

export const MODULES_U = [
  {
    id: 'CV-80', name: 'Laboratório de física por vídeo', status: 'ready', runtime: 'client', icone: 'fisica',
    desc: 'Filme a queda livre, o lançamento, o pêndulo ou o plano inclinado: o objeto é seguido (SAM 2, detector ou ' +
          'cor), a régua calibrada dá os metros e saem a tabela posição × tempo, velocidade, aceleração, a parábola ' +
          'ajustada e o g estimado, com gráfico e CSV.',
  },
  {
    id: 'CV-81', name: 'Acessibilidade: cena falada e mouse por cabeça', status: 'ready', runtime: 'client', icone: 'acessibilidade',
    desc: '«O que tem na minha frente?»: objetos, posição, textos e códigos falados em português pela voz do ' +
          'navegador, tudo local. Mouse por cabeça: cursor pela orientação do rosto e clique por piscada longa, com ' +
          'calibração (dentro do iaVision).',
  },
  {
    id: 'CV-82', name: 'Libras — soletração', status: 'ready', runtime: 'client', weights: ['mp-palma', 'mp-mao'], icone: 'libras',
    desc: 'Alfabeto manual ESTÁTICO da Libras sobre os 21 pontos da mão: regras para 13 letras e exemplos gravados ' +
          'pelo usuário (kNN). Só soletração — não reconhece sinais nem letras com movimento e não substitui intérprete.',
  },
  {
    id: 'CV-83', name: 'Sala de aula: gabarito e mãos levantadas', status: 'ready', runtime: 'client', icone: 'educacao',
    desc: 'Correção de gabarito (OMR) com folha-modelo imprimível (cantos pretos, matrícula, até 200 questões), nota e ' +
          'CSV; contagem de mãos levantadas pela pose, sem identificar ninguém.',
  },
  {
    id: 'CV-84', name: 'Mídia: cortes, miniatura, busca e fala', status: 'ready', runtime: 'client', icone: 'midia',
    desc: 'Corte de cena automático e melhor quadro para miniatura → editor GPlanSiS|Vídeo; busca semântica em vídeo ' +
          'gravado (MobileCLIP por segundo + transcrição Whisper local, índice no navegador); capítulos, legendas SRT/VTT ' +
          'e melhores trechos pela fala.',
  },
  {
    id: 'CV-85', name: 'Agro e pecuária', status: 'ready', runtime: 'client', icone: 'agro',
    desc: 'Índice de verde (ExG) de pasto e lavoura, insetos em armadilha adesiva, escore de locomoção de bovinos pela ' +
          'trajetória e peso estimado pela área dorsal (régua + calibração com a balança). Indicadores de manejo.',
  },
  {
    id: 'CV-86', name: 'Câmera de jogo amador', status: 'ready', runtime: 'client', icone: 'jogo',
    desc: 'Câmera fixa grande-angular → vídeo que segue a jogada (bola e jogadores), reenquadrado ao vivo com a ' +
          'suavização do «Seguir sujeito»; com arquivo, a trajetória vai para o editor para exportar 16:9 ou 9:16.',
  },
  {
    id: 'CV-87', name: 'Diário de obra (RDO)', status: 'ready', runtime: 'client', icone: 'obra',
    desc: 'Efetivo e equipamentos por hora (máximo simultâneo, entradas pelo portão), fotos periódicas e o RDO do dia ' +
          'em HTML/PDF; resumo redigido pela Via só com aceite e a chave do usuário.',
  },
];

export default [...fisica, ...acessivel, ...libras, ...sala, ...midia, ...agro, ...jogo, ...obra];
