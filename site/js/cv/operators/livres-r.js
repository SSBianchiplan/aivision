/**
 * Operadores livres — grupo R (onda 2-a): Indústria e Logística, código
 * pequeno em JS puro sobre o que a cadeia já produz (mãos, detector +
 * rastreio, códigos, profundidade, laser do BeltScan) e sobre a própria
 * imagem. Nenhum modelo novo — por isso não há models-livres-r.js.
 *
 *   CV-49 Poka-yoke de sequência de montagem (I2)
 *   CV-50 Cubagem: caixas na esteira com laser (L1) e por foto com régua (63)
 *   CV-51 Conferência de doca (L4)
 *   CV-52 Nível pelo visor (54) e gotejamento/vazamento (55)
 *   CV-53 Desalinhamento lateral de correia (56)
 *   CV-54 Marca de torque desalinhada (57)
 *   CV-55 Cor de chama/forno, ΔE2000 (58)
 *   CV-56 Pontos de solda por posição (59)
 *   CV-57 Opacidade de fumaça, Ringelmann — indicativo (61)
 *   CV-58 Ocupação do baú — estimativa (64)
 *   CV-59 Medição de fissuras (C2)
 *
 * As funções das Ferramentas de mouse são registradas aqui e só aparecem no
 * seletor com o nó correspondente no Pipeline.
 */
import { registrarFuncao } from '../marcacoes.js';
import pokayoke from './livres-r/pokayoke.js';
import cubagem from './livres-r/cubagem.js';
import doca from './livres-r/doca.js';
import processo from './livres-r/processo.js';
import inspecao from './livres-r/inspecao.js';
import bau from './livres-r/bau.js';

const AREAS = ['retangulo', 'poligono', 'elipse', 'mascara'];
const F = (valor, rotulo, tipos, ops, cor, nome) => registrarFuncao({ valor, rotulo, tipos, ops, cor, nome });
F('pk_caixa', 'Poka-yoke · caixa de peça', AREAS, ['pokayoke.'], '#38bdf8', 'Caixa');
F('pk_fim', 'Poka-yoke · conclusão (gabarito)', AREAS, ['pokayoke.'], '#a78bfa', 'Conclusão');
F('cub_laser', 'Cubagem · faixa do laser', ['retangulo'], ['cubagem.esteira'], '#fb923c', 'Faixa do laser');
F('cub_vista', 'Cubagem · vista de cima', ['retangulo'], ['cubagem.esteira'], '#4ade80', 'Vista de cima');
F('cub_face', 'Cubagem · face (foto)', AREAS, ['cubagem.foto'], '#4ade80', 'Face');
F('doca_porta', 'Doca · porta (seta para dentro)', ['linha'], ['doca.'], '#38bdf8', 'Porta da doca');
F('nivel_visor', 'Processo · visor de nível', ['retangulo', 'poligono'], ['processo.nivel'], '#38bdf8', 'Visor');
F('gotejamento', 'Processo · gotejamento', AREAS, ['processo.gotejamento'], '#38bdf8', 'Gotejamento');
F('correia_faixa', 'Correia · faixa (atravessa a correia)', ['retangulo'], ['correia.'], '#38bdf8', 'Correia');
F('torque', 'Inspeção · marca de torque', ['elipse', 'retangulo'], ['inspecao.torque'], '#FFD84D', 'Parafuso');
F('chama', 'Processo · chama/forno', AREAS, ['processo.cor_chama'], '#fb923c', 'Chama');
F('solda_pos', 'Inspeção · posição de solda', ['ponto'], ['inspecao.solda'], '#4ade80', 'Ponto de solda');
F('solda_peca', 'Inspeção · peça (solda)', AREAS, ['inspecao.solda'], '#2dd4bf', 'Peça');
F('fumaca_pluma', 'Fumaça · pluma', AREAS, ['ambiente.ringelmann'], '#94a3b8', 'Pluma');
F('fumaca_ceu', 'Fumaça · céu (referência)', AREAS, ['ambiente.ringelmann'], '#38bdf8', 'Céu');
F('bau_porta', 'Baú · porta (moldura)', ['retangulo'], ['logistica.ocupacao_bau'], '#38bdf8', 'Porta do baú');
F('bau_fundo', 'Baú · fundo (parede do fundo)', ['retangulo'], ['logistica.ocupacao_bau'], '#a78bfa', 'Fundo do baú');
F('fissura_area', 'Civil · fissuras', AREAS, ['civil.fissuras'], '#38bdf8', 'Área de fissuras');

export const MODULES_R = [
  { id: 'CV-49', name: 'Poka-yoke de sequência de montagem', status: 'ready', runtime: 'client', icone: 'montagem',
    desc: 'Confere a ordem em que a mão pega as peças (uma área por caixa) e a conclusão no gabarito: fora de ordem, peça ' +
          'a mais, passo pulado e montagem incompleta avisam na hora (alarme ISA-18.2) e ficam registrados por ciclo, com ' +
          'tempo de ciclo e FPY. Sobre Mãos e gestos (ou a pose RTMO). Indicador de qualidade, não intertravamento.' },
  { id: 'CV-50', name: 'Cubagem — esteira com laser e foto com régua', status: 'ready', runtime: 'client', icone: 'caixa',
    desc: 'Caixa a caixa na esteira: altura e largura pela triangulação laser do BeltScan, comprimento pela velocidade ou ' +
          'pela vista de cima; m³, peso cubado, código lido e CSV. Por foto parada: régua calibrada + contorno (ou SAM) em ' +
          'duas vistas (topo e lateral).' },
  { id: 'CV-51', name: 'Conferência de doca', status: 'ready', runtime: 'client', icone: 'doca',
    desc: 'Volumes e pallets que entram e saem por linha de porta, por placa ou ordem digitada, contra o esperado e a lista ' +
          'de códigos (QR/barras/SSCC): falta e sobra, registro por conferência e CSV. Sobre detector + Tracking com IDs.' },
  { id: 'CV-52', name: 'Nível pelo visor e gotejamento', status: 'ready', runtime: 'client', icone: 'tanque',
    desc: 'Nível de silo/tanque pelo visor (degrau do perfil vertical, subpixel, faixa pelo nome) e gotejamento/vazamento ' +
          '(gotas por minuto e poça crescendo), com histórico e alarmes ISA-18.2.' },
  { id: 'CV-53', name: 'Desalinhamento lateral de correia', status: 'ready', runtime: 'client', icone: 'correia',
    desc: 'As duas bordas da correia por perfil transversal subpixel: desvio do centro em mm e % da largura, tendência em ' +
          'mm/min e alarmes ISA-18.2.' },
  { id: 'CV-54', name: 'Marca de torque desalinhada', status: 'ready', runtime: 'client', icone: 'parafuso',
    desc: 'A tinta da marca de torque pela cor (ΔE2000): eixo na cabeça/porca × direção na base; giro acima da tolerância ' +
          '= NOK. Vários parafusos por quadro, registro.' },
  { id: 'CV-55', name: 'Cor de chama e forno', status: 'ready', runtime: 'client', icone: 'chama',
    desc: 'Cor média da parte clara da chama/abertura do forno em Lab: ΔE2000 contra a referência, temperatura de cor ' +
          'correlata aproximada e faixa por alarmes ISA-18.2.' },
  { id: 'CV-56', name: 'Pontos de solda por posição', status: 'ready', runtime: 'client', icone: 'solda',
    desc: 'Presença e posição de cada ponto de solda nas posições marcadas (disco × anel do diâmetro nominal), pontos ' +
          'sobrando na peça, peça OK/NOK e registro.' },
  { id: 'CV-57', name: 'Opacidade de fumaça (Ringelmann, indicativo)', status: 'ready', runtime: 'client', icone: 'chamine',
    desc: 'Opacidade aparente da pluma escura contra o céu (luminância linear) e o número de Ringelmann equivalente, % do ' +
          'tempo acima do limite e alarme. INDICATIVO — não é laudo ambiental.' },
  { id: 'CV-58', name: 'Ocupação do baú (estimativa)', status: 'ready', runtime: 'client', weights: ['depth-anything'], icone: 'caminhao',
    desc: 'Ocupação do baú do caminhão em %, estimada pela profundidade relativa (Depth Anything V2) entre a moldura da ' +
          'porta e a parede do fundo. ESTIMATIVA: carga encostada no fundo, câmera no eixo.' },
  { id: 'CV-59', name: 'Medição de fissuras', status: 'ready', runtime: 'client', icone: 'fissura',
    desc: 'Largura (subpixel, pelo perfil normal ao eixo) e comprimento de fissuras com a régua calibrada, classe da ' +
          'abertura, mapa, CSV e relatório para vistoria.' },
];

/** Guia do catálogo (Configurações): o que é, quando usar, limites, custo. */
export const GUIA_R = {
  'CV-49': { what: 'Poka-yoke de montagem manual: a mão entra nas caixas de peça na ordem certa? Desvio na hora e registro por ciclo.',
             when: 'Montagem de kits, chicotes, eletroeletrônicos; treino de operador novo.',
             not: 'Mão escondida (câmera de lado) não conta: use câmera de cima. Indicador de qualidade, não intertravamento.',
             cost: 'Sobre Mãos e gestos (CV-25) ou RTMO; a lógica custa < 1 ms.', sensitive: true },
  'CV-50': { what: 'Cubagem caixa a caixa (laser de linha + triangulação do BeltScan) e cubagem estática por foto com régua em 2 vistas.',
             when: 'Frete por volume, conferência de dimensões, e-commerce.',
             not: 'Laser precisa de geometria medida (altura, base, ângulo) e esteira vazia no início; caixa amassada ou aberta mede o envelope.',
             cost: 'JS puro: ~2–5 ms por quadro (extração do laser).' },
  'CV-51': { what: 'Contagem de volumes e pallets na porta da doca por ordem/placa, contra o esperado e a lista de códigos.',
             when: 'Recebimento e expedição, divergência de carga.',
             not: 'Depende do detector reconhecer caixa e palete (treine um modelo próprio para o seu armazém) e de IDs estáveis.',
             cost: 'JS puro sobre detector + rastreio; < 1 ms.' },
  'CV-52': { what: 'Nível pelo visor de vidro e gotejamento/vazamento (gotas/min, poça), com alarmes.',
             when: 'Rondas de utilidades, tanques sem transmissor, vazamento em bomba/flange.',
             not: 'Visor sujo ou espuma enganam o nível; gotas precisam de contraste e câmera fixa.',
             cost: 'JS puro: < 2 ms por leitura.' },
  'CV-53': { what: 'Desvio lateral da correia pelas bordas, com tendência e alarmes.',
             when: 'Transportadores de correia: prevenir rasgo de borda e derramamento.',
             not: 'As duas bordas precisam aparecer com contraste; carga que transborda a borda confunde.',
             cost: 'JS puro: < 1 ms.' },
  'CV-54': { what: 'Marca de tinta de torque: a porca girou em relação à base?',
             when: 'Inspeção de juntas aparafusadas críticas, rondas de manutenção.',
             not: 'Tinta desbotada ou suja e reflexo metálico atrapalham; não mede torque, só giro aparente.',
             cost: 'JS puro: ~3 ms por parafuso.' },
  'CV-55': { what: 'Cor da chama/forno em Lab, ΔE2000 contra a referência e CCT aproximada.',
             when: 'Combustão (mistura), forno de reaquecimento, vidro, cerâmica.',
             not: 'Exposição e balanço de branco precisam ficar fixos; não é pirômetro.',
             cost: 'JS puro: < 2 ms.' },
  'CV-56': { what: 'Pontos de solda por posição: presente, faltando, deslocado, sobrando.',
             when: 'Solda a ponto em chapa, carroceria, gabarito fixo.',
             not: 'A peça precisa estar sempre no mesmo lugar (gabarito); não avalia qualidade interna da solda.',
             cost: 'JS puro: ~5–20 ms por inspeção.' },
  'CV-57': { what: 'Opacidade aparente de fumaça escura contra o céu e Ringelmann equivalente.',
             when: 'Monitoramento interno de caldeira, gerador, frota a diesel.',
             not: 'INDICATIVO: não substitui observador qualificado nem laudo ambiental; céu nublado/escuro e sol atrás atrapalham.',
             cost: 'JS puro: < 1 ms.' },
  'CV-58': { what: 'Ocupação do baú em % pela profundidade relativa entre a porta e o fundo.',
             when: 'Pátio e docas: quanto falta para lotar, ocupação na saída.',
             not: 'ESTIMATIVA: profundidade monocular não é métrica; supõe carga encostada no fundo.',
             cost: 'Depth Anything V2 (CV-14) + < 1 ms.' },
  'CV-59': { what: 'Fissuras: comprimento e abertura em mm, classe, mapa e relatório.',
             when: 'Vistoria predial, laudo de vizinhança, acompanhamento de trinca.',
             not: 'Precisa de régua no plano da parede e foto de frente; mancha escura e junta de bloco podem parecer fissura.',
             cost: 'JS puro: ~50–300 ms por medição (resolução plena).' },
};

export default [...pokayoke, ...cubagem, ...doca, ...processo, ...inspecao, ...bau];
