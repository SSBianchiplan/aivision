/**
 * Operadores livres — grupo T (onda 2-c): SAÚDE E ESPORTES, código pequeno
 * sobre o que já existe (pose BlazePose/RTMO, Malha do rosto, Mãos e gestos,
 * os motores do Salto, da Corrida, da Academia e o seguranca.queda). Nenhum
 * modelo novo — por isso não há models-livres-t.js.
 *
 *   CV-70 Sinais vitais sem contato: respiração (tórax + FFT) e FC rPPG (POS/CHROM)
 *   CV-71 Rosto clínico: assimetria facial e exercícios orofaciais
 *   CV-72 Movimento clínico: tremor, postura estática, marcha clínica
 *   CV-73 Exercício domiciliar com correção por voz
 *   CV-74 Hospital e ILPI: higiene das mãos (OMS, indicativo) e queda
 *   CV-75 Comparar com a referência: movimento (DTW por fase) e yoga
 *   CV-76 Esportes de ciclo: corda, golpes, basquete, natação
 *   CV-77 PROESP-BR
 *
 * Saúde: NÃO É DISPOSITIVO MÉDICO — aviso fixo no vídeo, no painel e em toda exportação.
 */
import { registrarFuncao } from '../marcacoes.js';
import vitais, { FUNC_TORAX, FUNC_PELE } from './livres-t/vitais.js';
import rosto from './livres-t/rosto.js';
import clinica, { FUNC_PISO } from './livres-t/clinica.js';
import casa from './livres-t/casa.js';
import hospital from './livres-t/hospital.js';
import referencia from './livres-t/referencia.js';
import esportes, { FUNC_ARO, FUNC_ZONA } from './livres-t/esportes.js';
import proesp, { FUNC_LINHA } from './livres-t/proesp.js';

const AREAS = ['retangulo', 'poligono', 'elipse', 'mascara'];
registrarFuncao({ valor: FUNC_TORAX, rotulo: 'Vitais · tórax (respiração)', tipos: AREAS, ops: ['vitais.respiracao'], cor: '#22d3ee', nome: 'Tórax' });
registrarFuncao({ valor: FUNC_PELE, rotulo: 'Vitais · pele (rPPG)', tipos: AREAS, ops: ['vitais.cardiaca'], cor: '#f472b6', nome: 'Pele' });
registrarFuncao({ valor: FUNC_PISO, rotulo: 'Marcha · piso (2 linhas, distância conhecida)', tipos: ['linha', 'regua'], ops: ['clinica.marcha'], cor: '#FFD84D', nome: 'Piso' });
registrarFuncao({ valor: FUNC_ARO, rotulo: 'Basquete · aro', tipos: AREAS, ops: ['basquete.arremesso'], cor: '#fb923c', nome: 'Aro' });
registrarFuncao({ valor: FUNC_ZONA, rotulo: 'Basquete · zona de arremesso', tipos: AREAS, ops: ['basquete.arremesso'], cor: '#a78bfa', nome: 'Zona' });
registrarFuncao({ valor: FUNC_LINHA, rotulo: 'PROESP · linha (largada/chegada)', tipos: ['linha', 'regua'], ops: ['proesp.bateria'], cor: '#FFD84D', nome: 'Linha' });

const M = (id, name, desc, extra = {}) => ({ id, name, status: 'ready', runtime: 'client', desc, ...extra });

export const MODULES_T = [
  M('CV-70', 'Sinais vitais sem contato', 'Frequência respiratória pela oscilação do tórax (ROI + FFT) e frequência cardíaca por rPPG na pele do rosto ' +
    '(Malha do rosto + POS ou CHROM), com faixa de confiança e avisos de iluminação e movimento. Studio Vitais com o sinal e o espectro. ' +
    'Não é dispositivo médico.'),
  M('CV-71', 'Rosto clínico — assimetria e orofacial', 'Assimetria de olho, sobrancelha e comissura em expressões guiadas (excursão de cada lado ' +
    'em relação ao repouso) e exercícios orofaciais de fono (repetições, amplitude, tempo sustentado) pela Malha do rosto. Sem identificação ' +
    'facial. Não é dispositivo médico.'),
  M('CV-72', 'Movimento clínico — tremor, postura e marcha', 'Tremor de mão (frequência e amplitude), postura estática (ombros, pelve, ' +
    'cabeça, escoliose aparente, linha de prumo) e marcha clínica sobre o motor da Corrida com piso calibrado (velocidade, cadência, ' +
    'passada, apoio). Não é dispositivo médico.', { weights: ['yolox', 'pose'] }),
  M('CV-73', 'Exercício domiciliar com correção por voz', 'A série prescrita em casa sobre o motor da Academia: prescrição por link, ' +
    'contagem e correção de forma por voz (pt-BR), descanso, relato de dor e relatório para o fisioterapeuta. Não é dispositivo médico.'),
  M('CV-74', 'Hospital e ILPI — higiene das mãos e queda', 'Higienização das mãos (tempo de fricção e os 6 movimentos da OMS, indicativo) ' +
    'e queda/imobilidade de paciente com o detector do CV-43 em modo "só esqueleto". Sem identificar ninguém.'),
  M('CV-75', 'Comparar com a referência (movimento e yoga)', 'Grava o movimento modelo e compara cada tentativa por DTW das séries de ' +
    'ângulos, com nota e articulação divergente por fase; yoga com pose de referência e tempo sustentado. Studio lado a lado.', { weights: ['yolox', 'pose'] }),
  M('CV-76', 'Esportes de ciclo — corda, luta, basquete, natação', 'Pular corda (motor do Salto), golpes de punho (contagem e velocidade), ' +
    'arremesso de basquete (ângulo de soltura e acerto por zona do aro) e braçadas de natação, pela pose.', { weights: ['yolox', 'pose'] }),
  M('CV-77', 'Bateria PROESP-BR', 'Salto horizontal, corrida de 20 m, quadrado e abdominal em 1 min com os motores existentes; resultado por ' +
    'código do aluno (sem rosto) e classe pela tabela do manual carregada pelo professor.', { weights: ['yolox', 'pose'] }),
];

export default [...vitais, ...rosto, ...clinica, ...casa, ...hospital, ...referencia, ...esportes, ...proesp];
