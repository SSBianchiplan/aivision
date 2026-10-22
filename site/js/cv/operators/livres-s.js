/**
 * Operadores livres — grupo S (onda 2-b): segurança, varejo, cidade e trânsito,
 * em JS sobre o que a cadeia já produz (pose, detector + rastreio, OCR,
 * códigos, MobileCLIP2, BiRefNet). Nenhum modelo novo — sem models-livres-s.js.
 *
 *   CV-60 Ergonomia aplicada (NR-17): AEP por posto (S5) e NIOSH (69)
 *   CV-61 Segurança predial (indicativo): saída obstruída (67) e fogo (68)
 *   CV-62 Varejo — gôndola e vitrine: auditoria de preço (V3) e planograma (74)
 *   CV-63 Foto de produto para e-commerce (V4)
 *   CV-64 Ocupação por zona: mesas (75), vagas e lixeiras (99, T2)
 *   CV-65 Leitura de hidrômetro/medidor (98)
 *   CV-66 Resumo de vídeo por eventos (100)
 *   CV-67 Velocidade média por duas linhas (T2)
 *
 * As funções de marcação novas são registradas aqui e só aparecem no
 * seletor com o nó correspondente no Pipeline.
 */
import { registrarFuncao } from '../marcacoes.js';
import ergonomiaNr17 from './livres-s/ergonomia-nr17.js';
import predial from './livres-s/predial.js';
import varejo from './livres-s/varejo.js';
import produto from './livres-s/produto.js';
import ocupacao from './livres-s/ocupacao.js';
import medidor from './livres-s/medidor.js';
import resumo from './livres-s/resumo.js';
import velocidade from './livres-s/velocidade.js';

const AREAS = ['retangulo', 'poligono', 'elipse', 'mascara'];
registrarFuncao({ valor: 'saida_emergencia', rotulo: 'Segurança · saída de emergência', tipos: AREAS, ops: ['seguranca.saida_obstruida'], cor: '#22c55e', nome: 'Saída' });
registrarFuncao({ valor: 'gondola_etiquetas', rotulo: 'Varejo · faixa de etiquetas', tipos: AREAS, ops: ['varejo.preco'], cor: '#a78bfa', nome: 'Etiquetas' });
registrarFuncao({ valor: 'planograma', rotulo: 'Varejo · planograma (grade)', tipos: AREAS, ops: ['varejo.planograma'], cor: '#a78bfa', nome: 'Planograma' });
registrarFuncao({ valor: 'mesa', rotulo: 'Ocupação · mesa', tipos: AREAS, ops: ['ocupacao.mesas'], cor: '#38bdf8', nome: 'Mesa' });
registrarFuncao({ valor: 'vaga', rotulo: 'Ocupação · vaga (capacidade no nome: "(8)")', tipos: AREAS, ops: ['ocupacao.zona'], cor: '#38bdf8', nome: 'Vaga' });
registrarFuncao({ valor: 'lixeira', rotulo: 'Ocupação · lixeira (boca/topo)', tipos: AREAS, ops: ['ocupacao.zona'], cor: '#F2A900', nome: 'Lixeira' });
registrarFuncao({ valor: 'medidor', rotulo: 'Medidor · leitura (números)', tipos: AREAS, ops: ['medidor.leitura'], cor: '#38bdf8', nome: 'Medidor' });
registrarFuncao({ valor: 'resumo_area', rotulo: 'Resumo · área de interesse', tipos: AREAS, ops: ['video.resumo'], cor: '#facc15', nome: 'Interesse' });
registrarFuncao({ valor: 'velocidade', rotulo: 'Trânsito · velocidade (linha A/B)', tipos: ['linha'], ops: ['transito.velocidade'], cor: '#38bdf8', nome: 'Linha' });

export const MODULES_S = [
  {
    id: 'CV-60', name: 'Ergonomia aplicada (NR-17)', status: 'ready', runtime: 'client', weights: ['rtmo-s'], icone: 'ergonomia',
    desc: 'AEP por posto: consolida a Ergonomia RULA/REBA e o Tempo de posto (Takt) — tempo em cada nível de risco, pior ' +
          'postura com rosto borrado, alertas e prioridade — num relatório para imprimir/PDF. Levantamento de carga pela ' +
          'equação revisada do NIOSH (H e V pela pose e régua; carga, pega, duração e assimetria informadas). APOIO ao ' +
          'ergonomista: não substitui a AEP/AET.',
  },
  {
    id: 'CV-61', name: 'Segurança predial (indicativo)', status: 'ready', runtime: 'client', icone: 'seguranca',
    desc: 'Saída/corredor de emergência obstruído (objeto parado na área por N s, ignorando quem passa) e indício de ' +
          'fogo por cor e cintilação, sem treino. Alarmes ISA-18.2. INDICATIVO: não substitui detector certificado, o ' +
          'alarme de incêndio (NBR 17240) nem a inspeção das rotas de fuga.',
  },
  {
    id: 'CV-62', name: 'Varejo — preço e planograma', status: 'ready', runtime: 'onnx', weights: ['ocr5-det', 'ocr5-latin', 'mclip2-visual', 'mclip2-text'], icone: 'etiqueta',
    desc: 'Auditoria de preço: OCR e EAN das etiquetas de gôndola conferidos com a tabela CSV do sistema, divergências ' +
          'e CSV. Vitrine × planograma: grade marcada, cada célula comparada com a referência pelo MobileCLIP2 (trocado ' +
          'ou vazio).',
  },
  {
    id: 'CV-63', name: 'Foto de produto (e-commerce)', status: 'ready', runtime: 'onnx', weights: ['birefnet-lite'], icone: 'camera',
    desc: 'Recorte de fundo com o BiRefNet, enquadramento padrão (1:1, 4:5…), fundo branco/cor/transparente e sombra de ' +
          'contato; exportação em resolução plena e em lote (ZIP).',
  },
  {
    id: 'CV-64', name: 'Ocupação por zona (mesas, vagas, lixeiras)', status: 'ready', runtime: 'client', icone: 'zonas',
    desc: 'Mesa livre/ocupada/suja pelas detecções COCO; vagas de bicicleta, patinete, moto ou carro por zona com ' +
          'capacidade (detecções ou diferença da cena vazia); lixeira cheia pelo nível da boca. Giro, tempos e CSV.',
  },
  {
    id: 'CV-65', name: 'Hidrômetro e medidores', status: 'ready', runtime: 'client', icone: 'manometro',
    desc: 'Leitura de hidrômetro/medidor por OCR (rolos) ou 7 segmentos numa área marcada, com dígitos e decimais fixos, ' +
          'filtro de acumulador (só sobe), consumo e vazão média.',
  },
  {
    id: 'CV-66', name: 'Resumo de vídeo por eventos', status: 'ready', runtime: 'client', icone: 'video',
    desc: 'Subtração de fundo → linha do tempo de eventos com miniatura (movimento borrado), clique leva ao instante, CSV ' +
          'e marcadores no editor GPlanSiS|Vídeo.',
  },
  {
    id: 'CV-67', name: 'Velocidade média (duas linhas)', status: 'ready', runtime: 'client', icone: 'trafego',
    desc: 'Velocidade de cada veículo rastreado entre duas linhas a distância conhecida (instante interpolado), média, ' +
          'mediana, V85, máxima e excessos por classe e sentido.',
  },
];

export default [...ergonomiaNr17, ...predial, ...varejo, ...produto, ...ocupacao, ...medidor, ...resumo, ...velocidade];
