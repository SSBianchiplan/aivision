/**
 * components/presets-onda2-d.js — presets da onda 2-d (CV-80..87) com descrição e
 * marcações-modelo, no mesmo formato de presets-onda1a.js. O Panels.js funde
 * estes grupos aos dele e, ao aplicar, chama criarMarcacoesModeloOnda2d().
 * Todos abrem o painel «Aplicações».
 */
import { criar, marcStore, setVisivel } from '../cv/marcacoes.js';

const ret = (nome, funcao, a, b) => ({ ferramenta: 'retangulo', funcao, nome, pts: [a, b] });
const P = 'aplicacoes';

export const PRESETS_ONDA2D = [
  // ------------------------------------------------------------------ Laboratório e educação
  { grupo: 'Laboratório e educação', nome: 'Física: queda livre e lançamento (D1)', painel: P,
    desc: 'Filme de lado, com a câmera parada. Calibre uma régua sobre uma medida conhecida no plano do movimento (ex.: ' +
          'trena de 1 m). O RF-DETR acha a bola; o operador registra t × posição em metros, ajusta a parábola e dá g. ' +
          'Para objeto sem classe, troque «Objeto de» para cor.',
    specs: [['rfdetr.detect', { classes: 'bola', conf: 0.3, maxDet: 5 }], ['fisica.trajetoria', { modo: 'queda / lançamento' }]] },
  { grupo: 'Laboratório e educação', nome: 'Física: pêndulo (cor)', painel: P,
    desc: 'Pêndulo com um peso colorido (laranja por padrão): período pelos cruzamentos e g = 4π²L/T² com o comprimento ' +
          'informado no operador.',
    specs: [['fisica.trajetoria', { fonte: 'cor', modo: 'pêndulo', comprimento: 0.5 }]] },
  { grupo: 'Laboratório e educação', nome: 'Física: objeto marcado (SAM 2)', painel: P,
    desc: 'Qualquer objeto: o SAM 2 segue o que estiver no ponto central (ajuste o ponto no operador) e a física mede a ' +
          'trajetória (plano inclinado, carrinho, queda).',
    specs: [['sam2.seguir', { alvo: 'ponto na imagem' }], ['fisica.trajetoria', { fonte: 'seguir (SAM 2)', modo: 'plano inclinado' }]] },
  { grupo: 'Laboratório e educação', nome: 'Correção de gabarito (OMR)', painel: P,
    desc: 'Imprima a folha-modelo pelo painel Aplicações (mesma configuração do operador), aponte a câmera de cima e ' +
          'preencha a chave no operador. Cada folha entra na lista quando a leitura se repete; nota e CSV no painel.',
    specs: [['educacao.gabarito', { questoes: 20, alternativas: 5, colunas: 2, digitos: 4 }]],
    marcacoes: [ret('Folha', 'gabarito', [0.2, 0.04], [0.8, 0.96])] },
  { grupo: 'Laboratório e educação', nome: 'Mãos levantadas na sala', painel: P,
    desc: 'Quantas mãos estão levantadas agora, o máximo e a série por segundo, pela pose (RTMO). Só contagem: rostos ' +
          'borrados e ninguém identificado.',
    specs: [['pose.rtmo', { caixa: false }], ['educacao.maos_levantadas', {}], ['privacidade.borrar_rostos', {}]] },

  // ------------------------------------------------------------------ Acessibilidade
  { grupo: 'Acessibilidade', nome: 'O que tem na minha frente? (voz)', painel: P,
    desc: 'Aponte a câmera: objetos com a posição, textos (OCR) e códigos falados em português pela voz do navegador. ' +
          'Use o botão grande do painel ou deixe falar a cada mudança de cena. Tudo local.',
    specs: [['rfdetr.detect', { conf: 0.45, maxDet: 20 }], ['ocr.ptbr', {}], ['code.scan', {}], ['acessivel.falar', {}]] },
  { grupo: 'Acessibilidade', nome: 'Mouse por cabeça e piscada', painel: P,
    desc: 'Cursor pela orientação da cabeça e clique por piscada longa, dentro do iaVision. Calibre no painel (5 posições).',
    specs: [['rosto.malha', { max: 1, desenho: 'nenhum' }], ['acessivel.mouse_cabeca', {}]] },
  { grupo: 'Acessibilidade', nome: 'Libras — soletração', painel: P,
    desc: 'Alfabeto manual estático da Libras → texto. Grave 3 a 5 exemplos por letra no painel para melhorar. Só ' +
          'soletração: não reconhece sinais nem letras com movimento.',
    specs: [['maos.gestos', { max: 1, gestos: false }], ['libras.soletrar', {}]] },

  // ------------------------------------------------------------------ Mídia e criação
  { grupo: 'Mídia e criação', nome: 'Corte de cena → marcadores no editor (95)', painel: P,
    desc: 'Com um vídeo em arquivo na Fonte: toque (ou «Varrer o arquivo inteiro» no painel) e mande os cortes como ' +
          'marcadores para o GPlanSiS|Vídeo («Dividir nos pontos» corta tudo de uma vez).',
    specs: [['midia.corte_cena', {}]] },
  { grupo: 'Mídia e criação', nome: 'Melhor quadro para miniatura (96)', painel: P,
    desc: 'Nitidez + rosto bem enquadrado e de olhos abertos + exposição: os melhores quadros viram JPEG ou abrem o editor ' +
          'no instante.',
    specs: [['rosto.malha', { max: 4, desenho: 'nenhum', pose: false }], ['midia.miniatura', {}]] },

  // ------------------------------------------------------------------ Agro e pecuária
  { grupo: 'Agro e pecuária', nome: 'Índice de verde do pasto/lavoura (76)', painel: P,
    desc: 'Cobertura verde (ExG−ExR) na área marcada, pela câmera do celular. Compare sempre no mesmo horário e luz.',
    specs: [['agro.verde', {}]],
    marcacoes: [ret('Talhão', 'verde', [0.05, 0.35], [0.95, 0.95])] },
  { grupo: 'Agro e pecuária', nome: 'Insetos em armadilha adesiva (77)', painel: P,
    desc: 'Conta os insetos no cartão (amarelo/azul) dentro da área. Calibre uma régua no cartão para o tamanho mínimo em mm².',
    specs: [['agro.armadilha', {}]],
    marcacoes: [ret('Cartão 1', 'armadilha', [0.15, 0.1], [0.85, 0.9])] },
  { grupo: 'Agro e pecuária', nome: 'Escore de locomoção de bovinos (80)', painel: P,
    desc: 'Câmera fixa de lado no corredor: cada vaca que passa recebe um escore de 1 a 5 (velocidade, regularidade, ' +
          'paradas e balanço). Indicador de triagem, não diagnóstico.',
    specs: [['rfdetr.detect', { classes: 'vaca', conf: 0.35, maxDet: 10 }], ['track.bytetrack', { rastro: 20, perder: 30 }], ['agro.locomocao', {}]] },
  { grupo: 'Agro e pecuária', nome: 'Peso estimado pela área dorsal (A3)', painel: P,
    desc: 'Câmera de cima no corredor ou na balança. Calibre uma régua no piso, marque a área de pesagem e registre 3+ ' +
          'pesagens reais no painel para ajustar kg = a·A^b. Estimativa — não é pesagem legal.',
    specs: [['agro.peso_dorsal', {}]],
    marcacoes: [ret('Pesagem', 'pesagem', [0.1, 0.1], [0.9, 0.9])] },

  // ------------------------------------------------------------------ Esportes
  { grupo: 'Esportes e biomecânica', nome: 'Câmera de jogo (segue a jogada)', painel: P,
    desc: 'Câmera fixa grande-angular atrás do campo/quadra: o RF-DETR acha bola e jogadores e o vídeo sai reenquadrado ' +
          'seguindo a jogada. Com arquivo, «Aplicar no editor» gera o 16:9/9:16 para exportar.',
    specs: [['rfdetr.detect', { classes: 'pessoa, bola', conf: 0.25, maxDet: 40 }], ['jogo.camera', {}]] },

  // ------------------------------------------------------------------ Construção
  { grupo: 'Construção', nome: 'Diário de obra automático (RDO)', painel: P,
    desc: 'Câmera de canteiro: pessoas e caminhões por hora (máximo simultâneo e entradas pelo portão), foto a cada 30 min ' +
          'com rostos borrados, RDO em HTML/PDF no painel; a Via redige o resumo só se você marcar.',
    specs: [['rfdetr.detect', { classes: 'pessoa, caminhão, carro', conf: 0.4, maxDet: 60 }], ['track.bytetrack', { rastro: 0, mostrarNome: false }],
            ['privacidade.borrar_rostos', {}], ['obra.diario', {}]],
    marcacoes: [ret('Portão', 'portao', [0.0, 0.55], [0.22, 1.0])] },
];

/** Marcações-modelo do preset (só para as funções que ainda não têm nenhuma marcação). */
export function criarMarcacoesModeloOnda2d(nome) {
  const pr = PRESETS_ONDA2D.find((x) => x.nome === nome);
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
