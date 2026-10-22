/**
 * components/presets-onda2b.js — presets da onda 2-b (CV-60..67) com
 * DESCRIÇÃO e MARCAÇÕES-MODELO, no mesmo formato de presets-onda1a.js:
 * Panels.js funde os grupos aos dele e, ao aplicar, chama
 * criarMarcacoesModeloOnda2b() — só cria as formas de uma FUNÇÃO que ainda
 * não tem nenhuma marcação. Pontos em 0–1 da fonte; o usuário arrasta.
 *
 * LGPD: toda cadeia com pessoas termina em privacidade.borrar_rostos (ou o
 * takt.posto, que já borra).
 */
import { criar, marcStore, setVisivel } from '../cv/marcacoes.js';

const PESSOAS = { classes: 'pessoa', conf: 0.45, maxDet: 60 };
const ret = (nome, funcao, a, b) => ({ ferramenta: 'retangulo', funcao, nome, pts: [a, b] });
const lin = (nome, funcao, a, b) => ({ ferramenta: 'linha', funcao, nome, pts: [a, b] });
const BORRAR = ['privacidade.borrar_rostos', {}];

export const PRESETS_ONDA2B = [
  // ------------------------------------------------------------------ Segurança do trabalho
  { grupo: 'Segurança do trabalho', nome: 'AEP por posto (RULA/REBA + Takt)', painel: 'medicoes',
    desc: 'AEP automática (S5, NR-17): a pose mede RULA/REBA de quem está em cada posto ("Takt · posto"), o Takt mede ' +
          'produtivo/ocioso/vago e o nó AEP consolida tempo por nível de risco, pior postura (rosto borrado) e prioridade. ' +
          'Relatório para imprimir/PDF no painel Medições — RASCUNHO DE APOIO ao ergonomista, não é a AEP/AET. Câmera de lado.',
    specs: [['pose.rtmo', { caixa: false }], ['takt.posto', {}], ['ergonomia.avaliar', { esqueleto: true }], ['aep.posto', {}]],
    marcacoes: [ret('Posto 1', 'takt_posto', [0.08, 0.15], [0.48, 0.95]), ret('Posto 2', 'takt_posto', [0.52, 0.15], [0.92, 0.95])] },
  { grupo: 'Segurança do trabalho', nome: 'Levantamento de carga (NIOSH)', painel: 'medicoes',
    desc: 'Equação revisada do NIOSH (69): câmera DE LADO, pessoa inteira no quadro; H e V pela pose com a régua calibrada ' +
          '(ou a estatura no nó); cada subida das mãos é um levantamento. Informe no nó a carga, a pega, a duração e a ' +
          'assimetria. LPR e IL no painel Medições. Rosto borrado.',
    specs: [['pose.rtmo', { caixa: false }], ['ergonomia.niosh', {}], BORRAR] },
  { grupo: 'Segurança do trabalho', nome: 'Saída de emergência obstruída', painel: 'medicoes',
    desc: 'Objeto parado na área da saída/corredor de emergência por mais de 30 s gera alarme (67); quem só passa não ' +
          'conta. Deixe a área LIVRE ao ligar (a cena vazia é capturada sozinha) ou capture no Medições. Indicador de ' +
          'gestão (NR-23).',
    specs: [['rfdetr.detect', PESSOAS], ['seguranca.saida_obstruida', {}], BORRAR],
    marcacoes: [ret('Saída de emergência', 'saida_emergencia', [0.35, 0.3], [0.65, 0.98])] },
  { grupo: 'Segurança do trabalho', nome: 'Fogo por cor e cintilação (indicativo)', painel: 'medicoes',
    desc: 'Indício de chama sem treino (68): cor de fogo que tremula por 2 s. INDICATIVO — não substitui detector de ' +
          'fumaça/chama certificado nem o alarme de incêndio (NBR 17240). Use exclusão sobre telas e LEDs.',
    specs: [['seguranca.fogo', {}]] },

  // ------------------------------------------------------------------ Varejo
  { grupo: 'Varejo', nome: 'Auditoria de preço (etiqueta × tabela)', painel: 'medicoes',
    desc: 'Auditoria de preço (V3): importe no painel Medições o CSV do sistema (código; descrição; preço); ajuste a área ' +
          '"Varejo · faixa de etiquetas" sobre a borda da prateleira. Preço, descrição e EAN de cada etiqueta lidos em ' +
          'resolução plena e conferidos; divergências e CSV.',
    specs: [['varejo.preco', {}]],
    marcacoes: [ret('Etiquetas prateleira 1', 'gondola_etiquetas', [0.03, 0.42], [0.97, 0.6])] },
  { grupo: 'Varejo', nome: 'Vitrine × planograma', painel: 'medicoes',
    desc: 'Planograma (74): ajuste a área "Varejo · planograma" à vitrine/gôndola ARRUMADA e escolha linhas × colunas no ' +
          'nó; a 1ª leitura vira a referência. Depois, cada célula diferente aparece como "trocado" ou "vazio (ruptura)".',
    specs: [['varejo.planograma', { linhas: 3, colunas: 4 }]],
    marcacoes: [ret('Vitrine', 'planograma', [0.08, 0.1], [0.92, 0.9])] },
  { grupo: 'Varejo', nome: 'Foto de produto para e-commerce', painel: 'medicoes',
    desc: 'Foto de produto (V4): o BiRefNet tira o fundo, o produto fica centralizado em 1:1 com margem fixa, fundo ' +
          'branco e sombra suave. No painel Medições: exportar a foto e processar um LOTE de fotos do celular num ZIP.',
    specs: [['produto.foto', {}]] },
  { grupo: 'Varejo', nome: 'Mesas: livre, ocupada ou suja', painel: 'medicoes',
    desc: 'Restaurante (75): uma área "Ocupação · mesa" por mesa; pessoa junto = ocupada, só copo/prato/talher = suja ' +
          '(aguardando limpeza). Giro, tempo médio e espera pela limpeza. Rostos borrados.',
    specs: [['rfdetr.detect', { classes: 'pessoa, copo, taça, garrafa, tigela, garfo, faca, colher, sanduíche, pizza, bolo', conf: 0.35, maxDet: 100 }],
            ['ocupacao.mesas', {}], BORRAR],
    marcacoes: [ret('Mesa 1', 'mesa', [0.1, 0.45], [0.42, 0.75]), ret('Mesa 2', 'mesa', [0.58, 0.45], [0.9, 0.75])] },

  // ------------------------------------------------------------------ Cidade e casa
  { grupo: 'Cidade e casa', nome: 'Hidrômetro / medidor', painel: 'medicoes',
    desc: 'Leitura de hidrômetro (98): ajuste a área "Medidor · leitura" justa sobre os rolos (8 dígitos, 3 decimais em ' +
          'm³ por padrão). Só aceita leitura que sobe e se repete; consumo e vazão média. Para medidor eletrônico, mude o ' +
          'leitor para 7 segmentos.',
    specs: [['medidor.leitura', {}]],
    marcacoes: [ret('Hidrômetro', 'medidor', [0.3, 0.4], [0.7, 0.55])] },
  { grupo: 'Cidade e casa', nome: 'Vagas de bicicleta e patinete', painel: 'medicoes',
    desc: 'Vagas (99): a capacidade vem do nome ("Bicicletário (8)"). Bicicletas e motos pelo detector; patinete e o que o ' +
          'COCO não tem, pela diferença da cena vazia (troque "Vagas por" no nó). Ocupação, média e giro.',
    specs: [['rfdetr.detect', { classes: 'bicicleta, moto, pessoa', conf: 0.35, maxDet: 80 }], ['ocupacao.zona', { classes: 'bicicleta, moto' }], BORRAR],
    marcacoes: [ret('Bicicletário (8)', 'vaga', [0.1, 0.5], [0.9, 0.95])] },
  { grupo: 'Cidade e casa', nome: 'Lixeira cheia', painel: 'medicoes',
    desc: 'Lixeira cheia (99): a área "Ocupação · lixeira" cobre a BOCA e um pouco acima; com a lixeira vazia ao ligar (ou ' +
          '"Capturar cena vazia"), o nível sai da diferença e o alerta vem após 60 s acima de 80 %.',
    specs: [['ocupacao.zona', { modo: 'diferença da cena' }]],
    marcacoes: [ret('Lixeira 1', 'lixeira', [0.38, 0.3], [0.62, 0.5])] },
  { grupo: 'Cidade e casa', nome: 'Resumo de vídeo por eventos', painel: 'medicoes',
    desc: 'Resumo (100): a subtração de fundo marca cada trecho com movimento; linha do tempo clicável no Medições, ' +
          'miniaturas com o movimento borrado e "Abrir no editor" com um marcador por evento (vídeo de arquivo).',
    specs: [['video.resumo', {}]] },

  // ------------------------------------------------------------------ Trânsito
  { grupo: 'Trânsito', nome: 'Velocidade média (duas linhas)', painel: 'medicoes',
    desc: 'Velocidade (T2): arraste as linhas A e B para marcas no piso a uma distância CONHECIDA (informe no nó, em m). ' +
          'Cada veículo rastreado tem a velocidade pelo tempo entre as linhas; média, mediana, V85 e excessos no Medições.',
    specs: [['rfdetr.detect', { classes: 'carro, moto, ônibus, caminhão, bicicleta', conf: 0.4, maxDet: 80 }], ['track.bytetrack', { rastro: 15, perder: 45 }],
            ['transito.velocidade', { distancia: 20 }]],
    marcacoes: [lin('Linha A', 'velocidade', [0.05, 0.45], [0.95, 0.45]), lin('Linha B', 'velocidade', [0.05, 0.8], [0.95, 0.8])] },
  { grupo: 'Trânsito', nome: 'Ocupação de vagas (estacionamento)', painel: 'medicoes',
    desc: 'Vagas por zona (T2): uma área "Ocupação · vaga" por vaga (ou por fileira, com a capacidade no nome: "Fileira A ' +
          '(10)"); carros e motos pelo detector, ponto na base. Ocupação agora, média, giro e CSV.',
    specs: [['rfdetr.detect', { classes: 'carro, moto, caminhão, ônibus', conf: 0.4, maxDet: 100 }], ['ocupacao.zona', { classes: 'carro, moto, caminhão, ônibus', ponto: 'base' }]],
    marcacoes: [ret('Fileira A (6)', 'vaga', [0.04, 0.55], [0.96, 0.95])] },
];

/** Cria as marcações-modelo do preset `nome` (só funções ainda sem marcação). Devolve quantas criou. */
export function criarMarcacoesModeloOnda2b(nome) {
  const pr = PRESETS_ONDA2B.find((x) => x.nome === nome);
  if (!pr || !pr.marcacoes) return 0;
  const existentes = new Set(marcStore.get().itens.map((i) => i.funcao));
  let n = 0;
  for (const m of pr.marcacoes) {
    if (existentes.has(m.funcao)) continue;
    criar(m.ferramenta, m.pts, { funcao: m.funcao, nome: m.nome });
    n++;
  }
  if (n && !marcStore.get().visivel) setVisivel(true);
  return n;
}
