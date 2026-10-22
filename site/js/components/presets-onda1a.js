/**
 * components/presets-onda1a.js — presets da onda 1-a (receitas prontas do
 * Pipeline) com DESCRIÇÃO e MARCAÇÕES-MODELO.
 *
 * Cada preset encadeia operadores que já existem; Panels.js funde estes
 * grupos aos dele (grupo existente ganha os itens, grupo novo entra no fim),
 * usa `desc` na dica do botão e, ao aplicar, chama criarMarcacoesModelo():
 * as formas de exemplo (zonas, linhas, ângulo do mostrador, ROIs do Inspect)
 * nascem no lugar típico — só as de uma FUNÇÃO que ainda não tem nenhuma
 * marcação, para não duplicar o que o usuário já desenhou. Pontos em 0–1 da
 * fonte; o usuário arrasta para o lugar certo.
 *
 *   marcacoes: [{ ferramenta (CRIA de cv/marcacoes.js), funcao, nome, pts }]
 *   painel:    painel que abre junto (medicoes, inspecao, takt, contador…)
 */
import { criar, marcStore, setVisivel } from '../cv/marcacoes.js';

const PESSOAS = { classes: 'pessoa', conf: 0.45, maxDet: 60 };
const VEICULOS = { classes: 'carro, moto, ônibus, caminhão, bicicleta, pessoa', conf: 0.4, maxDet: 80 };
const ret = (nome, funcao, a, b) => ({ ferramenta: 'retangulo', funcao, nome, pts: [a, b] });
const lin = (nome, funcao, a, b) => ({ ferramenta: 'linha', funcao, nome, pts: [a, b] });

export const PRESETS_ONDA1A = [
  // ------------------------------------------------------------------ Industrial
  { grupo: 'Industrial', nome: 'Rótulo: lote, validade e código', painel: 'inspecao',
    desc: 'Conferência de rótulo (I5): o Inspect lê o LOTE (= L + lote da ordem), a VALIDADE (≥ hoje + 180 dias) e o código ' +
          '(EAN-13/DataMatrix com dígito conferido) e dá OK/NOK/INCERTO por peça, com fila de revisão e CSV. Ajuste as três ' +
          'áreas sobre o rótulo; luz difusa e sem reflexo no filme.',
    specs: [['inspect.programa', { modelo: 'rotulo' }]],
    marcacoes: [ret('LOTE', 'ins_ocr', [0.08, 0.14], [0.55, 0.3]), ret('VALIDADE', 'ins_ocr', [0.08, 0.34], [0.55, 0.5]),
                ret('CODIGO', 'ins_codigo', [0.6, 0.14], [0.92, 0.62])] },
  { grupo: 'Industrial', nome: 'Extrusão: diâmetro contínuo (Cpk)', painel: 'inspecao',
    desc: 'Diâmetro de fio, cabo ou tubo na saída da extrusora (53): paquímetro a cada 1 s sobre a régua "DIAMETRO" ' +
          '(atravessando o produto), nominal 10 ± 0,2 mm, Cpk no Studio Inspect. Calibre antes uma régua sobre uma medida ' +
          'conhecida (mm por px) e use fundo contrastante.',
    specs: [['inspect.programa', { modelo: 'extrusao' }]],
    marcacoes: [{ ferramenta: 'regua', funcao: 'ins_paquimetro', nome: 'DIAMETRO', pts: [[0.5, 0.25], [0.5, 0.75]] }] },
  { grupo: 'Industrial', nome: 'Mostrador analógico (manômetro)', painel: 'medicoes',
    desc: 'Leitor de manômetro (Top 7): arraste os 3 pontos do ângulo para o ZERO, o CENTRO do ponteiro e o FUNDO de escala; ' +
          'a faixa vem do nome ("Manômetro 0-10 bar"). Valor, tendência e alarmes ISA-18.2 (preencha "HH 9; H 8; L 1").',
    specs: [['instrumento.mostrador', { limites: 'H 8; HH 9' }]],
    marcacoes: [{ ferramenta: 'angulo', funcao: 'mostrador', nome: 'Manômetro 0-10 bar', pts: [[0.4, 0.66], [0.5, 0.5], [0.6, 0.66]] }] },
  { grupo: 'Industrial', nome: 'Display de 7 segmentos', painel: 'medicoes',
    desc: 'Lê o número de balanças, controladores e painéis de 7 segmentos dentro da área "Display", com histórico e alarmes.',
    specs: [['instrumento.display7', {}]],
    marcacoes: [ret('Display 1', 'display7', [0.3, 0.4], [0.7, 0.6])] },
  { grupo: 'Industrial', nome: 'Ovos ou pintinhos em esteira (cor)', painel: 'contador',
    desc: 'Contagem de ovos/pintinhos na esteira (78) pelo motor de COR do CounterVision: clique numa peça para amostrar a ' +
          'cor no painel Contagem em esteira; cada ID conta uma vez ao cruzar a linha. Totais por turno e taxa.',
    specs: [['contagem.cor', { separar: true, minHits: 3 }], ['cena.zonas', { fonte: 'detecções', ponto: 'centro', umaVez: true }], ['contagem.esteira', {}]],
    marcacoes: [lin('Contagem', 'cruzamento', [0.5, 0.08], [0.5, 0.92])] },

  // ------------------------------------------------------------------ Trânsito
  { grupo: 'Trânsito', nome: 'CVC — contagem classificada e matriz de giro', painel: 'medicoes',
    desc: 'Contagem volumétrica classificada (Top 1): RF-DETR acha carro, moto, ônibus, caminhão, bicicleta e pedestre, o ' +
          'rastreio dá o ID e cada ZONA é um braço da interseção — origem → destino em blocos de 15 min, matriz de giro e ' +
          'CSV no painel Medições. Arraste as quatro zonas para as entradas da interseção.',
    specs: [['rfdetr.detect', VEICULOS], ['track.bytetrack', { rastro: 15, perder: 45 }],
            ['cena.zonas', { fonte: 'detecções', ponto: 'centro', sair: 20, mostrarPontos: false }], ['trafego.cvc', {}]],
    marcacoes: [ret('Norte', 'zona', [0.36, 0.0], [0.64, 0.18]), ret('Sul', 'zona', [0.36, 0.82], [0.64, 1.0]),
                ret('Leste', 'zona', [0.82, 0.36], [1.0, 0.64]), ret('Oeste', 'zona', [0.0, 0.36], [0.18, 0.64])] },
  { grupo: 'Trânsito', nome: 'CVC — seção (linha por sentido)', painel: 'medicoes',
    desc: 'Contagem classificada numa seção da via: cada veículo que cruza a linha conta por sentido e classe, em blocos ' +
          'de 15 min, com CSV.',
    specs: [['rfdetr.detect', VEICULOS], ['track.bytetrack', { rastro: 15, perder: 45 }],
            ['cena.zonas', { fonte: 'detecções', ponto: 'centro', umaVez: true, mostrarPontos: false }], ['trafego.cvc', {}]],
    marcacoes: [lin('Seção', 'cruzamento', [0.04, 0.6], [0.96, 0.6])] },

  // ------------------------------------------------------------------ Varejo
  { grupo: 'Varejo', nome: 'Fila do caixa, ocupação e mapa de calor', painel: 'medicoes',
    desc: 'Varejo (V2/Top 6): pessoas por fila agora, máxima, entradas e tempo de permanência por zona; mapa de calor da ' +
          'loja; rostos borrados (LGPD). Uma zona por fila de caixa.',
    specs: [['rfdetr.detect', PESSOAS], ['track.bytetrack', { rastro: 0, mostrarNome: false }], ['cena.zonas', { fonte: 'detecções', sair: 15 }],
            ['cena.mapa_calor', { fonte: 'detecções' }], ['privacidade.borrar_rostos', {}]],
    marcacoes: [ret('Fila caixa 1', 'zona', [0.08, 0.3], [0.45, 0.96]), ret('Fila caixa 2', 'zona', [0.55, 0.3], [0.92, 0.96])] },
  { grupo: 'Varejo', nome: 'Mapa de calor da loja', painel: 'medicoes',
    desc: 'Onde os clientes passam o tempo: segundos de presença por célula pelos pés de cada pessoa, rostos borrados. ' +
          'PNG e CSV no painel Medições.',
    specs: [['rfdetr.detect', PESSOAS], ['cena.mapa_calor', { fonte: 'detecções', grade: 48 }], ['privacidade.borrar_rostos', {}]] },
  { grupo: 'Varejo', nome: 'Entrada e saída de clientes (porta)',
    desc: 'Conta quem entra e quem sai (72) pela linha da porta: a seta da linha é o sentido "entrada". Rostos borrados.',
    specs: [['rfdetr.detect', PESSOAS], ['track.bytetrack', { rastro: 10, mostrarNome: false }], ['cena.zonas', { fonte: 'detecções' }],
            ['privacidade.borrar_rostos', {}]],
    marcacoes: [lin('Porta', 'cruzamento', [0.15, 0.7], [0.85, 0.7])] },
  { grupo: 'Varejo', nome: 'Tempo de atendimento no balcão', painel: 'takt',
    desc: 'Atendimento (73): a zona "Frente do balcão" mede quanto tempo cada cliente fica (permanência média) e o posto do ' +
          'Takt mede o atendente (atendendo / ocioso / vago). Pose sem identificação, rostos borrados.',
    specs: [['pose.rtmo', { caixa: false }], ['track.bytetrack', { rastro: 0, mostrarNome: false }], ['cena.zonas', { fonte: 'detecções' }], ['takt.posto', {}]],
    marcacoes: [ret('Frente do balcão', 'zona', [0.1, 0.55], [0.9, 0.98]), ret('Balcão (atendente)', 'takt_posto', [0.15, 0.08], [0.85, 0.5])] },

  // ------------------------------------------------------------------ Segurança do trabalho
  { grupo: 'Segurança do trabalho', nome: 'Sonolência (PERCLOS)',
    desc: 'Sonolência de operador ou motorista (S4): malha do rosto + olhos — abertura (EAR), piscadas/min, PERCLOS do ' +
          'último minuto e alerta com olho fechado por 1,5 s. Indicador de gestão; não identifica a pessoa.',
    specs: [['rosto.malha', {}], ['olhos.iris', { sonoSeg: 1.5 }]] },
  { grupo: 'Segurança do trabalho', nome: 'Cerca por parte do corpo (mãos)', painel: 'medicoes',
    desc: 'Alerta quando uma MÃO entra na zona proibida (Top 8) por 0,5 s; encerra após 1 s fora. Indicador de gestão — NÃO é ' +
          'função de segurança (NR-12): não substitui proteção física, intertravamento nem cortina de luz.',
    specs: [['pose.rtmo', { caixa: false }], ['seguranca.cerca_keypoint', { partes: 'mãos' }]],
    marcacoes: [ret('Zona proibida 1', 'cerca', [0.55, 0.3], [0.85, 0.7])] },
  { grupo: 'Segurança do trabalho', nome: 'Cerca para pés (piso proibido)', painel: 'medicoes',
    desc: 'Alerta quando um PÉ pisa na área proibida (faixa de empilhadeira, área de içamento). Indicador de gestão — NÃO é ' +
          'função de segurança (NR-12).',
    specs: [['pose.rtmo', { caixa: false }], ['seguranca.cerca_keypoint', { partes: 'pés', tempoMin: 1 }]],
    marcacoes: [ret('Piso proibido', 'cerca', [0.1, 0.65], [0.9, 0.98])] },
  { grupo: 'Segurança do trabalho', nome: 'Pessoa caída e imobilidade', painel: 'medicoes',
    desc: 'Queda (quadril descendo rápido + deitado), pessoa no chão por 10 s e imobilidade por 15 s, com alarmes ISA-18.2 ' +
          '(Top 8). Indicador de gestão — NÃO é função de segurança (NR-12).',
    specs: [['pose.rtmo', { caixa: false }], ['track.bytetrack', { rastro: 0, mostrarNome: false }], ['seguranca.queda', {}]] },
  { grupo: 'Segurança do trabalho', nome: 'Ponto de encontro (evacuação)', painel: 'medicoes',
    desc: 'Na evacuação (71), conta quem chegou à zona do ponto de encontro e mostra quantos faltam para a meta (efetivo ' +
          'do turno). Rostos borrados. Confira sempre com a lista nominal do brigadista.',
    specs: [['rfdetr.detect', PESSOAS], ['track.bytetrack', { rastro: 0, mostrarNome: false }], ['cena.zonas', { fonte: 'detecções', sair: 30 }],
            ['seguranca.ponto_encontro', { meta: 20 }], ['privacidade.borrar_rostos', {}]],
    marcacoes: [ret('Ponto de encontro', 'zona', [0.08, 0.2], [0.92, 0.97])] },

  // ------------------------------------------------------------------ Logística
  { grupo: 'Logística', nome: 'Pallet por QR (local por zona)', painel: 'medicoes',
    desc: 'Rastreio de pallet (62): cada QR/DataMatrix/SSCC lido é um pallet e a zona onde aparece é o local (doca, ' +
          'estoque, quarentena); tabela de onde está cada um e eventos de movimentação no CSV.',
    specs: [['code.scan', { everyMs: 300, beep: false, showText: false }], ['logistica.pallet', {}]],
    marcacoes: [ret('Doca 1', 'zona', [0.02, 0.1], [0.32, 0.92]), ret('Estoque A', 'zona', [0.35, 0.1], [0.65, 0.92]),
                ret('Quarentena', 'zona', [0.68, 0.1], [0.98, 0.92])] },
  { grupo: 'Logística', nome: 'Etiqueta de transporte / chave NF-e', painel: 'medicoes',
    desc: 'Leitura de etiqueta e DANFE (65): a chave de acesso de 44 dígitos vem do código de barras ou do texto; o dígito ' +
          'verificador, a UF e o CNPJ do emitente são conferidos; reconhece também o rastreio dos Correios.',
    specs: [['code.scan', { scanWidth: 1280, beep: false }], ['ocr.ptbr', { lado: 1280, maxBoxes: 40, everyMs: 1200, mostrarLista: false }],
            ['logistica.etiqueta', {}]] },

  // ------------------------------------------------------------------ Laboratório e educação
  { grupo: 'Laboratório e educação', nome: 'Colônias e células (placa de Petri)', painel: 'inspecao',
    desc: 'Conta colônias numa placa de Petri ou células num campo de microscópio (D3): limiar adaptativo (luz irregular), ' +
          'componentes conexos e faixa de área. Ajuste a área "PLACA" para dentro da borda da placa e a polaridade (colônia ' +
          'clara ou escura).',
    specs: [['inspect.blobs', { polaridade: 'claro', limiar: 'adaptativo', bloco: 41, area_min: 12, area_max: 6000, cont_min: 0, cont_max: 10000, intervalo: 500 }]],
    marcacoes: [ret('PLACA', 'ins_blobs', [0.22, 0.12], [0.78, 0.88])] },
  { grupo: 'Laboratório e educação', nome: 'Quadro branco → texto',
    desc: 'Lê o quadro branco (93) com o OCR PT-BR em alta resolução a cada 2 s e lista as linhas; peça à Via um resumo do ' +
          'texto lido. Câmera de frente para o quadro, sem reflexo.',
    specs: [['ocr.ptbr', { lado: 1280, maxBoxes: 60, everyMs: 2000, mostrarLista: true, minConf: 0.4 }]] },

  // ------------------------------------------------------------------ Mídia e criação
  { grupo: 'Mídia e criação', nome: 'Croma sem tela verde (rápido)',
    desc: 'Troca o fundo por verde sem tela verde (M4), em tempo real, com o PP-HumanSeg — para gravar e recortar no editor.',
    specs: [['dnn.segment_person', { mode: 'croma' }]] },
  { grupo: 'Mídia e criação', nome: 'Croma com borda fina (BiRefNet)',
    desc: 'Croma de alta qualidade (cabelo, dedos) com o BiRefNet; atualiza a cada ~1,5 s — para aula gravada e foto.',
    specs: [['seg.birefnet', { modo: 'croma' }]] },
  { grupo: 'Mídia e criação', nome: 'Fundo desfocado',
    desc: 'Desfoca o fundo atrás da pessoa (efeito retrato) com o BiRefNet.',
    specs: [['seg.birefnet', { modo: 'desfocar fundo', raio: 20 }]] },
  { grupo: 'Mídia e criação', nome: 'Tempo de tela de logo', painel: 'medicoes',
    desc: 'Tempo de tela de uma marca (97): o molde do LOGO é capturado da área ao ligar (com o logo visível) e cada quadro ' +
          'em que ele aparece soma tempo; exposições e a maior no painel Medições.',
    specs: [['inspect.presenca', { min_score: 0.75, intervalo: 200 }], ['midia.tempo_tela', {}]],
    marcacoes: [ret('LOGO', 'ins_presenca', [0.74, 0.04], [0.96, 0.2])] },

  // ------------------------------------------------------------------ Esportes
  { grupo: 'Esportes e biomecânica', nome: 'Fotocélula — sprint', painel: 'medicoes',
    desc: 'Cronometragem de sprint (Top 10): câmera de lado, linhas de largada e chegada (acrescente as intermediárias com a ' +
          'função "Esportes · fotocélula"); o tronco corta a linha e o tempo é interpolado entre quadros. Informe as distâncias ' +
          '(ex.: 0; 20) para a velocidade.',
    specs: [['pose.rtmo', { caixa: false }], ['esportes.sprint', { distancias: '0; 20' }]],
    marcacoes: [lin('Largada', 'sprint', [0.12, 0.2], [0.12, 0.98]), lin('Chegada', 'sprint', [0.88, 0.2], [0.88, 0.98])] },
  { grupo: 'Esportes e biomecânica', nome: 'Fotocélula — agilidade (ida e volta)', painel: 'medicoes',
    desc: 'Teste de agilidade de ida e volta: larga na linha A, cada linha cruzada é uma parcial e o tempo fecha ao voltar à A.',
    specs: [['pose.rtmo', { caixa: false }], ['esportes.sprint', { modo: 'agilidade (ida e volta)', distancias: '0; 10' }]],
    marcacoes: [lin('Linha A', 'sprint', [0.2, 0.2], [0.2, 0.98]), lin('Linha B', 'sprint', [0.8, 0.2], [0.8, 0.98])] },
];

/**
 * Cria as marcações-modelo do preset `nome`: só as das funções que ainda não
 * têm nenhuma marcação. Devolve quantas criou.
 */
export function criarMarcacoesModelo(nome) {
  const pr = PRESETS_ONDA1A.find((x) => x.nome === nome);
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
