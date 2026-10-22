/**
 * components/presets-onda2a.js — presets da onda 2-a (Indústria e Logística,
 * CV-49..59) com DESCRIÇÃO e MARCAÇÕES-MODELO, no mesmo formato de
 * presets-onda1a.js. Panels.js funde estes grupos aos dele e, ao aplicar,
 * chama criarMarcacoesModeloOnda2a(): as formas de exemplo nascem no lugar
 * típico só para as funções que ainda não têm nenhuma marcação.
 */
import { criar, marcStore, setVisivel } from '../cv/marcacoes.js';

const ret = (nome, funcao, a, b) => ({ ferramenta: 'retangulo', funcao, nome, pts: [a, b] });
const eli = (nome, funcao, a, b) => ({ ferramenta: 'elipse', funcao, nome, pts: [a, b] });
const pto = (nome, funcao, a) => ({ ferramenta: 'ponto', funcao, nome, pts: [a] });
const lin = (nome, funcao, a, b) => ({ ferramenta: 'linha', funcao, nome, pts: [a, b] });
const regua = (nome, a, b) => ({ ferramenta: 'regua', funcao: 'medida', nome, pts: [a, b] });
const CODIGOS = { everyMs: 300, beep: false, showText: false };

export const PRESETS_ONDA2A = [
  // ------------------------------------------------------------------ Industrial
  { grupo: 'Industrial', nome: 'Poka-yoke de montagem (sequência)', painel: 'medicoes',
    desc: 'Poka-yoke de sequência (I2): câmera de cima da bancada, uma área por caixa de peça e a área de conclusão no ' +
          'gabarito. Ordem esperada: Base → Placa → Parafuso ×4 → Tampa → conclusão. Fora de ordem, peça a mais e ' +
          'montagem sem um passo avisam na hora e ficam no registro de ciclos (painel Medições).',
    specs: [['maos.gestos', {}], ['pokayoke.sequencia', { sequencia: 'Base; Placa; Parafuso x4; Tampa' }]],
    marcacoes: [ret('Base', 'pk_caixa', [0.04, 0.05], [0.24, 0.3]), ret('Placa', 'pk_caixa', [0.28, 0.05], [0.48, 0.3]),
                ret('Parafuso', 'pk_caixa', [0.52, 0.05], [0.72, 0.3]), ret('Tampa', 'pk_caixa', [0.76, 0.05], [0.96, 0.3]),
                ret('Gabarito', 'pk_fim', [0.3, 0.5], [0.7, 0.95])] },
  { grupo: 'Industrial', nome: 'Nível pelo visor (silo/tanque)', painel: 'medicoes',
    desc: 'Nível pelo visor de vidro (54): ajuste a área do FUNDO ao TOPO da escala do visor; a faixa vem do nome ' +
          '("Tanque 0-100 %" → troque por "Tanque 0-5000 L"). Alarmes de exemplo: H 85, L 15.',
    specs: [['processo.nivel', { limites: 'HH 95; H 85; L 15; LL 5' }]],
    marcacoes: [ret('Tanque 0-100 %', 'nivel_visor', [0.45, 0.1], [0.55, 0.9])] },
  { grupo: 'Industrial', nome: 'Gotejamento e vazamento', painel: 'medicoes',
    desc: 'Gotejamento (55): a área cobre onde as gotas caem e o piso logo abaixo (poça). Gotas/min e % de poça com ' +
          'tendência e alarmes. Câmera fixa e luz constante; o fundo é aprendido nos primeiros quadros.',
    specs: [['processo.gotejamento', {}]],
    marcacoes: [ret('Flange 1', 'gotejamento', [0.35, 0.15], [0.65, 0.95])] },
  { grupo: 'Industrial', nome: 'Desalinhamento de correia', painel: 'medicoes',
    desc: 'Correia transportadora (56): a faixa atravessa a correia com as DUAS bordas dentro; informe a largura nominal ' +
          '(mm). Os primeiros quadros são a referência (zere no painel com a correia centrada). Alarmes em % da largura e ' +
          'tendência em mm/min.',
    specs: [['correia.alinhamento', { larguraMm: 1000 }]],
    marcacoes: [ret('Correia TC-01', 'correia_faixa', [0.05, 0.42], [0.95, 0.58])] },
  { grupo: 'Industrial', nome: 'Marca de torque', painel: 'medicoes',
    desc: 'Marca de torque (57): um círculo por parafuso, centrado no eixo, com a borda pegando a tinta na base. Cor da ' +
          'tinta em hex (amarelo por padrão). Giro acima de 8° = NOK. Grave a referência no painel com tudo apertado.',
    specs: [['inspecao.torque', {}]],
    marcacoes: [eli('Parafuso 1', 'torque', [0.2, 0.3], [0.4, 0.66]), eli('Parafuso 2', 'torque', [0.6, 0.3], [0.8, 0.66])] },
  { grupo: 'Industrial', nome: 'Cor de chama / forno (ΔE)', painel: 'medicoes',
    desc: 'Cor de chama ou da boca do forno (58): ΔE2000 contra a referência gravada (ou hex), CCT aproximada e alarmes ' +
          'de faixa. Trave exposição e balanço de branco da câmera.',
    specs: [['processo.cor_chama', {}]],
    marcacoes: [eli('Chama', 'chama', [0.35, 0.3], [0.65, 0.7])] },
  { grupo: 'Industrial', nome: 'Pontos de solda por posição', painel: 'medicoes',
    desc: 'Solda a ponto (59): um PONTO por posição nominal (arraste para cada ponto da peça no gabarito) e a área da ' +
          'peça para achar pontos sobrando. Calibre a régua para diâmetro e tolerância em mm.',
    specs: [['inspecao.solda', {}]],
    marcacoes: [pto('S1', 'solda_pos', [0.25, 0.4]), pto('S2', 'solda_pos', [0.375, 0.4]), pto('S3', 'solda_pos', [0.5, 0.4]),
                pto('S4', 'solda_pos', [0.625, 0.4]), pto('S5', 'solda_pos', [0.75, 0.4]), pto('S6', 'solda_pos', [0.5, 0.65]),
                ret('Peça', 'solda_peca', [0.15, 0.25], [0.85, 0.8])] },
  { grupo: 'Industrial', nome: 'Opacidade de fumaça (Ringelmann)', painel: 'medicoes',
    desc: 'Fumaça de chaminé (61): pluma logo acima da saída e céu ao lado na mesma altura; opacidade e Ringelmann ' +
          'equivalente, % do tempo acima de 2 e alarme. INDICATIVO — não é laudo ambiental.',
    specs: [['ambiente.ringelmann', { limite: 2 }]],
    marcacoes: [ret('Pluma', 'fumaca_pluma', [0.42, 0.12], [0.56, 0.35]), ret('Céu', 'fumaca_ceu', [0.66, 0.12], [0.8, 0.35])] },

  // ------------------------------------------------------------------ Logística
  { grupo: 'Logística', nome: 'Cubagem de caixas na esteira (laser)', painel: 'medicoes',
    desc: 'Cubagem caixa a caixa (L1): laser de linha cruzando a esteira e a câmera inclinada, como no BeltScan. Informe ' +
          'altura da câmera, base câmera–laser, ângulo e a velocidade da esteira; a faixa cobre a linha do laser. Esteira ' +
          'VAZIA nos primeiros quadros. Lê o QR/código da caixa se aparecer.',
    specs: [['code.scan', CODIGOS], ['cubagem.esteira', {}]],
    marcacoes: [ret('Laser', 'cub_laser', [0.03, 0.3], [0.97, 0.75])] },
  { grupo: 'Logística', nome: 'Cubagem na esteira + vista de cima', painel: 'medicoes',
    desc: 'Como a cubagem com laser, mas o comprimento e a largura vêm da silhueta na área "vista de cima" (precisa da ' +
          'régua calibrada no plano da esteira). Útil quando a velocidade varia.',
    specs: [['code.scan', CODIGOS], ['cubagem.esteira', {}]],
    marcacoes: [ret('Laser', 'cub_laser', [0.03, 0.55], [0.97, 0.8]), ret('Vista de cima', 'cub_vista', [0.05, 0.05], [0.95, 0.5]),
                regua('Régua (calibrar)', [0.1, 0.9], [0.4, 0.9])] },
  { grupo: 'Logística', nome: 'Cubagem por foto com régua', painel: 'medicoes',
    desc: 'Cubagem estática (63): calibre a régua sobre uma medida conhecida no plano da face, contorne a face (polígono ' +
          'ou clique do SAM com a função "Cubagem · face") e grave TOPO e LATERAL no painel Medições.',
    specs: [['cubagem.foto', {}]],
    marcacoes: [{ ferramenta: 'poligono', funcao: 'cub_face', nome: 'Face', pts: [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]] },
                regua('Régua (calibrar)', [0.3, 0.8], [0.7, 0.8])] },
  { grupo: 'Logística', nome: 'Conferência de doca (caixa e palete)', painel: 'medicoes',
    desc: 'Conferência de doca (L4): YOLOE por texto acha "box" e "pallet" (AGPL; troque por um modelo próprio no ' +
          '+Projeto para produção), o rastreio dá o ID e cada linha "Doca · porta" conta entrada/saída (seta para dentro). ' +
          'Digite placa/ordem, volumes, pallets e códigos esperados nos parâmetros (ou no painel).',
    specs: [['yoloe.prompt', { classes: 'box, pallet', conf: 0.2 }], ['track.bytetrack', { rastro: 10 }], ['code.scan', CODIGOS], ['doca.conferencia', {}]],
    marcacoes: [lin('Doca 1', 'doca_porta', [0.1, 0.6], [0.9, 0.6])] },
  { grupo: 'Logística', nome: 'Conferência de doca por etiqueta (QR)', painel: 'medicoes',
    desc: 'Conferência só pelos códigos: cada QR/barras/SSCC distinto lido é um volume, conferido contra a lista esperada ' +
          'da ordem — falta e sobra.',
    specs: [['code.scan', { everyMs: 200, beep: true, showText: false }], ['doca.conferencia', {}]] },
  { grupo: 'Logística', nome: 'Ocupação do baú (estimativa)', painel: 'medicoes',
    desc: 'Ocupação do baú (64) pela profundidade relativa: câmera no eixo do baú aberto; ajuste "Baú · porta" na moldura ' +
          'e "Baú · fundo" na parede do fundo (grave o baú vazio uma vez). ESTIMATIVA, não cubagem.',
    specs: [['depth.map', { modo: 'misturar' }], ['logistica.ocupacao_bau', {}]],
    marcacoes: [ret('Porta', 'bau_porta', [0.1, 0.08], [0.9, 0.95]), ret('Fundo', 'bau_fundo', [0.38, 0.36], [0.62, 0.64])] },

  // ------------------------------------------------------------------ Construção civil
  { grupo: 'Construção civil', nome: 'Medição de fissuras', painel: 'medicoes',
    desc: 'Fissuras (C2): foto de frente para a parede, régua calibrada no plano dela (ou trena encostada), área sobre a ' +
          'fissura. Comprimento, abertura máxima/média/P95, classe (capilar → fenda), mapa, CSV e relatório no painel.',
    specs: [['civil.fissuras', {}]],
    marcacoes: [ret('Fissura 1', 'fissura_area', [0.1, 0.1], [0.9, 0.85]), regua('Régua (calibrar)', [0.1, 0.92], [0.4, 0.92])] },
];

/** Cria as marcações-modelo do preset `nome` (só das funções que ainda não têm marcação). */
export function criarMarcacoesModeloOnda2a(nome) {
  const pr = PRESETS_ONDA2A.find((x) => x.nome === nome);
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
