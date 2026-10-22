/**
 * components/presets-onda2c.js — presets da onda 2-c (CV-70..77, saúde e
 * esportes), no formato de presets-onda1a.js: grupo, nome, painel, desc,
 * specs (cadeia de operadores) e marcações-modelo. Panels.js funde estes
 * grupos aos dele; o painel "Saúde e esportes+" (components/saude/SaudeEsportesPanel.js)
 * usa a mesma lista para o seu seletor.
 */
import { criar, marcStore, setVisivel } from '../cv/marcacoes.js';

const ret = (nome, funcao, a, b) => ({ ferramenta: 'retangulo', funcao, nome, pts: [a, b] });
const lin = (nome, funcao, a, b) => ({ ferramenta: 'linha', funcao, nome, pts: [a, b] });
const P = 'onda2c';
const MALHA = { desenho: 'contornos', pose: false };

export const PRESETS_ONDA2C = [
  // ------------------------------------------------------------------ saúde
  { grupo: 'Saúde', nome: 'Respiração sem contato', painel: P, op: 'vitais.respiracao', mod: 'CV-70',
    desc: 'Frequência respiratória pelo tórax (81): pessoa parada, tórax de frente; ROI pela pose (ou desenhe "Vitais · tórax"). Não é dispositivo médico.',
    specs: [['vitais.respiracao', {}]] },
  { grupo: 'Saúde', nome: 'Frequência cardíaca rPPG', painel: P, op: 'vitais.cardiaca', mod: 'CV-70',
    desc: 'FC pela cor da pele do rosto (82): Malha do rosto + POS. Rosto parado, luz contínua de frente. Não é dispositivo médico.',
    specs: [['rosto.malha', { ...MALHA, desenho: 'nenhum' }], ['vitais.cardiaca', {}]] },
  { grupo: 'Saúde', nome: 'Assimetria facial', painel: P, op: 'rosto.assimetria', mod: 'CV-71',
    desc: 'Olho, sobrancelha e comissura em repouso e nas expressões guiadas (H4). Registre o repouso primeiro.',
    specs: [['rosto.malha', MALHA], ['rosto.assimetria', {}]] },
  { grupo: 'Saúde', nome: 'Exercícios orofaciais (fono)', painel: P, op: 'rosto.orofacial', mod: 'CV-71',
    desc: 'Abrir a boca, sorriso, bico, lateralização, bochechas (85): repetições, amplitude e tempo sustentado.',
    specs: [['rosto.malha', MALHA], ['rosto.orofacial', {}]] },
  { grupo: 'Saúde', nome: 'Tremor de mão', painel: P, op: 'clinica.tremor', mod: 'CV-72',
    desc: 'Frequência e amplitude do tremor (83) pelos pontos da mão; câmera de 30–60 fps.',
    specs: [['maos.gestos', { max: 1, gestos: false }], ['clinica.tremor', {}]] },
  { grupo: 'Saúde', nome: 'Postura estática', painel: P, op: 'clinica.postura', mod: 'CV-72',
    desc: 'Ombros, pelve, cabeça, desvio do tronco e prumo (84), de frente/costas ou de lado.',
    specs: [['clinica.postura', {}]] },
  { grupo: 'Saúde', nome: 'Marcha clínica (piso calibrado)', painel: P, op: 'clinica.marcha', mod: 'CV-72',
    desc: 'Velocidade, cadência, passada e apoio (86). Arraste as duas linhas "Piso" para marcas no chão a uma distância conhecida (padrão 4 m).',
    specs: [['clinica.marcha', {}]],
    marcacoes: [lin('Piso A', 'marcha_piso', [0.2, 0.55], [0.2, 0.98]), lin('Piso B', 'marcha_piso', [0.8, 0.55], [0.8, 0.98])] },
  { grupo: 'Saúde', nome: 'Exercício domiciliar (voz)', painel: P, op: 'casa.exercicio', mod: 'CV-73',
    desc: 'A série prescrita com contagem e correção por voz (H3), sobre a Academia. O fisioterapeuta gera o link no painel.',
    specs: [['academia.treino', { exercicio: 'Agachamento', bipe: false }], ['casa.exercicio', {}]] },
  { grupo: 'Saúde', nome: 'Higiene das mãos (OMS)', painel: P, op: 'hospital.maos', mod: 'CV-74',
    desc: 'Tempo de fricção e os 6 movimentos da OMS (H5), indicativo. Câmera sobre a pia/dispensador.',
    specs: [['maos.gestos', { max: 2, gestos: false }], ['hospital.maos', {}]] },
  { grupo: 'Saúde', nome: 'Queda no quarto (só esqueleto)', painel: P, op: 'hospital.queda', mod: 'CV-74',
    desc: 'Queda e imobilidade de paciente (H5) com o detector do CV-43; o vídeo vira fundo escuro com a pose.',
    specs: [['pose.rtmo', { caixa: false }], ['hospital.queda', {}]] },
  // ------------------------------------------------------------------ esportes
  { grupo: 'Esportes e biomecânica', nome: 'Comparar com a referência', painel: P, op: 'referencia.comparar', mod: 'CV-75',
    desc: 'Grave o movimento modelo e compare cada tentativa por DTW, com nota por fase (E3).',
    specs: [['referencia.comparar', {}]] },
  { grupo: 'Esportes e biomecânica', nome: 'Yoga — pose e tempo', painel: P, op: 'yoga.pose', mod: 'CV-75',
    desc: 'Capture a pose de referência e meça a semelhança e o tempo sustentado (91).',
    specs: [['yoga.pose', {}]] },
  { grupo: 'Esportes e biomecânica', nome: 'Pular corda', painel: P, op: 'corda.saltos', mod: 'CV-76',
    desc: 'Saltos, ritmo, paradas, voo e contato (87), com o motor do Salto.', specs: [['corda.saltos', {}]] },
  { grupo: 'Esportes e biomecânica', nome: 'Golpes de luta', painel: P, op: 'luta.golpes', mod: 'CV-76',
    desc: 'Contagem por mão e velocidade do punho (88). Informe a estatura para m/s.', specs: [['luta.golpes', {}]] },
  { grupo: 'Esportes e biomecânica', nome: 'Arremesso de basquete', painel: P, op: 'basquete.arremesso', mod: 'CV-76',
    desc: 'Ângulo de soltura (bola pelo detector, ou punho) e acerto por zona do aro (89). Ajuste o "Aro" e as zonas.',
    specs: [['dnn.detect', { conf: 0.3 }], ['basquete.arremesso', {}]],
    marcacoes: [ret('Aro', 'basquete_aro', [0.78, 0.18], [0.9, 0.26]), ret('Garrafão', 'basquete_zona', [0.55, 0.6], [0.8, 0.98]), ret('Perímetro', 'basquete_zona', [0.05, 0.6], [0.55, 0.98])] },
  { grupo: 'Esportes e biomecânica', nome: 'Natação — braçadas', painel: P, op: 'natacao.bracadas', mod: 'CV-76',
    desc: 'Braçadas e ritmo (90), vídeo de lado.', specs: [['natacao.bracadas', {}]] },
  { grupo: 'Esportes e biomecânica', nome: 'PROESP-BR — salto e corrida', painel: P, op: 'proesp.bateria', mod: 'CV-77',
    desc: 'Bateria PROESP-BR (D2): salto horizontal, 20 m e quadrado pelas linhas "PROESP · linha". Carregue a tabela do manual no painel.',
    specs: [['proesp.bateria', {}]],
    marcacoes: [lin('Largada', 'proesp_linha', [0.12, 0.3], [0.12, 0.98]), lin('Chegada', 'proesp_linha', [0.88, 0.3], [0.88, 0.98])] },
  { grupo: 'Esportes e biomecânica', nome: 'PROESP-BR — abdominal 1 min', painel: P, op: 'proesp.bateria', mod: 'CV-77',
    desc: 'Abdominal em 1 min com a contagem da Academia; "Iniciar" no painel dispara o cronômetro.',
    specs: [['academia.treino', { exercicio: 'Abdominal', bipe: false }], ['proesp.bateria', { teste: 'Abdominal em 1 min' }]] },
];

/** Cria as marcações-modelo do preset `nome` (só as de funções que ainda não têm marcação). */
export function criarMarcacoesOnda2c(nome) {
  const pr = PRESETS_ONDA2C.find((x) => x.nome === nome);
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
