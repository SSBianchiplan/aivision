/**
 * cv/runtime/livres-e/atleta.js — perfil do atleta e ALVOS PERSONALIZADOS do Bike Fit.
 *
 * Os alvos de partida são as faixas por modalidade (PERFIS em ./bikefit.js).
 * O perfil do atleta só mexe onde há base razoável na literatura de bike fit,
 * de forma conservadora e sempre explicando o porquê; onde não há evidência
 * de dependência, a faixa NÃO muda (e o porquê diz isso).
 *
 * REGRAS (cumulativas, com teto; ver calcularAlvos):
 *
 *  R1  Postura mais alta — fatores: IMC ≥ 30, flexibilidade baixa, idade ≥ 50,
 *      nível iniciante, objetivo conforto. 1–2 fatores: tronco +5°, quadril
 *      (fech.) +5°; 3 ou mais: tronco +10°. Abdômen volumoso e cadeia
 *      posterior curta limitam o fechamento do quadril; quem não tolera a
 *      posição compensa arredondando a lombar.
 *      Fontes: Burt, P. "Bike Fit" (Bloomsbury, 2014), caps. sobre
 *      flexibilidade e ciclistas maiores; de Vey Mestdagh 1998 (Appl Ergon
 *      29:325, postura × conforto); Fonda & Šarabon 2010 (Sport Sci Rev
 *      19:187, revisão de biomecânica do ciclismo).
 *  R2  Joelho no PMI para o lado mais flexionado da faixa (teto = mínimo + 5°,
 *      p.ex. 140–145°) com flexibilidade baixa, idade ≥ 50, iniciante ou
 *      conforto: selim um pouco mais baixo reduz a tensão posterior e o
 *      "balanço" da pelve. Fontes: Holmes, Pruitt & Whalen 1994 (Clin Sports
 *      Med 13:187, 25–35° de flexão estática); Bini, Hume & Croft 2011
 *      (Sports Med 41:463, efeitos da altura do selim).
 *  R3  Aerodinâmica — competitivo ou objetivo aerodinâmica, COM flexibilidade
 *      alta e sem dor lombar: tronco −5°. Fontes: Fintelman et al. 2014
 *      (J Biomech 47:1894, ângulo do tronco × arrasto e potência; abaixo de
 *      certo ângulo a potência cai — por isso só −5°). Não se aplica se a R1
 *      se aplicar (os fatores de postura alta prevalecem).
 *  R4  Dor no joelho anterior (patelofemoral): PMS mínimo +5° (menos flexão no
 *      topo) e PMI mínimo +3° (fugir do selim baixo). Fontes: Holmes 1994
 *      (selim baixo × dor anterior); Bini et al. 2011; Callaghan 2005
 *      (J Bodyw Mov Ther 9:226, lesões por sobrecarga no ciclismo).
 *  R5  Dor lombar: tronco +5° e quadril +5° (menos flexão lombar sustentada).
 *      Fontes: Van Hoof et al. 2012 (Man Ther 17:312, flexão lombar em
 *      ciclistas com lombalgia); Marsden & Schwellnus 2010 (Int SportMed J
 *      11:216, revisão de lombalgia no ciclismo).
 *  R6  Pescoço/ombro: ombro −5° (alcance mais curto, menos extensão
 *      cervical). Fontes: Wilber et al. 1995 (Int J Sports Med 16:201,
 *      queixas cervicais por posição); Burt 2014.
 *  —   Joelho lateral/medial, mãos/períneo: sem mudança de ângulo sagital —
 *      são alinhamento frontal/taquinhos e pressão (selim, queda do guidão).
 *  —   Altura e peso NÃO mudam faixas angulares (ângulos já normalizam o
 *      tamanho do corpo); o peso só entra pelo IMC na R1. Sexo: sem evidência
 *      de faixa angular diferente. KOPS, ankling, cotovelo e tornozelo ficam
 *      na faixa da modalidade.
 *
 * MEDIDAS SUGERIDAS (ponto de partida, não substituem a medição dinâmica):
 *   selim (centro do movimento central → topo) LeMond = 0,883 × entrepernas
 *   (LeMond & Gordis 1987); selim (pedal embaixo → topo) Hamley = 1,09 ×
 *   entrepernas (Hamley & Thomas 1967); pedivela por faixa de entrepernas
 *   (prática usual; Martin & Spirduso 2001, Eur J Appl Physiol 84:413:
 *   potência máx. pouco sensível ao comprimento, ótimo ≈ 20% da perna).
 *   Sem entrepernas, estima-se 0,46 × altura (média antropométrica), marcado
 *   como estimado.
 */
import { PERFIS } from './bikefit.js';

export const DORES = [
  ['lombar', 'Lombar'],
  ['joelhoAnt', 'Joelho anterior'],
  ['joelhoLat', 'Joelho lateral/medial'],
  ['pescoco', 'Pescoço/ombro'],
  ['maos', 'Mãos/períneo'],
];
export const NIVEIS = ['iniciante', 'amador', 'competitivo'];
export const OBJETIVOS = ['conforto', 'performance', 'aerodinâmica'];
export const FLEX = ['', 'baixa', 'média', 'alta'];
export const SEXOS = ['', 'feminino', 'masculino'];
export const DICA_ENTREPERNAS = 'Descalço, de costas para a parede, pés 15–20 cm afastados: suba um livro entre as pernas até ' +
  'encostar firme no períneo (como o selim) e meça do chão à lombada do livro. Repita 2–3 vezes e use a média.';
export const DICA_FLEX = 'Teste sentar-e-alcançar: sentado, pernas estendidas, alcance os pés. Não chega ao tornozelo = baixa; ' +
  'passa dos dedos = alta; entre os dois = média.';

/** Nomes legíveis das faixas (as mesmas chaves de PERFIS). */
export const NOMES_FAIXA = {
  joelhoPMI: 'Joelho no PMI', joelhoPMS: 'Joelho no PMS', quadrilMin: 'Quadril (fech.)', tronco: 'Tronco',
  ombro: 'Ombro', cotovelo: 'Cotovelo', tornozeloPMI: 'Tornozelo PMI', ankling: 'Ankling', kops: 'KOPS',
};
export const CHAVES_FAIXA = Object.keys(NOMES_FAIXA);

const novoId = () => 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function atletaVazio(nome = 'Atleta') {
  return {
    id: novoId(), nome, alturaCm: 0, pesoKg: 0, entrepernasCm: 0, idade: 0, sexo: '',
    flex: '', nivel: 'amador', objetivo: 'performance', dores: [], overrides: {},
  };
}

/** Normaliza o que veio do armazenamento (campos novos, tipos). */
export function normalizarAtleta(a) {
  const b = { ...atletaVazio(), ...(a || {}) };
  for (const k of ['alturaCm', 'pesoKg', 'entrepernasCm', 'idade']) b[k] = Math.max(0, Number(b[k]) || 0);
  if (!NIVEIS.includes(b.nivel)) b.nivel = 'amador';
  if (!OBJETIVOS.includes(b.objetivo)) b.objetivo = 'performance';
  if (!FLEX.includes(b.flex)) b.flex = '';
  if (!SEXOS.includes(b.sexo)) b.sexo = '';
  b.nome = String(b.nome || '').slice(0, 60);
  b.dores = Array.isArray(b.dores) ? b.dores.filter((d) => DORES.some(([k]) => k === d)) : [];
  b.overrides = b.overrides && typeof b.overrides === 'object' ? b.overrides : {};
  return b;
}

export const imc = (a) => (a.alturaCm > 0 && a.pesoKg > 0 ? a.pesoKg / ((a.alturaCm / 100) ** 2) : null);

const r0 = (x) => Math.round(x);
const txt = (f) => (f[0] < 0 || f[1] < 0 ? `${f[0]} a ${f[1]}` : `${f[0]}–${f[1]}`);

/**
 * Alvos do atleta para a modalidade. Devolve
 *   { perfilNome, faixas: {chave: [min, max]}, base: PERFIS[...],
 *     linhas: {chave: { faixa, base, calculada, override, mudou, porque: [] }},
 *     regras: [ids aplicados] }
 * `faixas` tem o mesmo formato de PERFIS[x]: dá para usar no lugar dele.
 */
export function calcularAlvos(perfilNome, atletaBruto) {
  const base = PERFIS[perfilNome] || PERFIS.Estrada;
  const a = normalizarAtleta(atletaBruto);
  const calc = {};
  const porque = {};
  for (const k of CHAVES_FAIXA) { calc[k] = base[k].slice(); porque[k] = []; }
  const regras = [];
  const dor = (k) => a.dores.includes(k);
  const im = imc(a);

  // R1 — postura mais alta
  const fatores = [];
  if (im != null && im >= 30) fatores.push(`IMC ${im.toFixed(1).replace('.', ',')}`);
  if (a.flex === 'baixa') fatores.push('flexibilidade baixa');
  if (a.idade >= 50) fatores.push(`${a.idade} anos`);
  if (a.nivel === 'iniciante') fatores.push('iniciante');
  if (a.objetivo === 'conforto') fatores.push('objetivo conforto');
  if (fatores.length) {
    const dt = fatores.length >= 3 ? 10 : 5;
    calc.tronco = [calc.tronco[0] + dt, calc.tronco[1] + dt];
    calc.quadrilMin = [calc.quadrilMin[0] + 5, calc.quadrilMin[1] + 5];
    porque.tronco.push(`+${dt}° (${fatores.join(', ')}): tronco mais alto evita compensar arredondando a lombar.`);
    porque.quadrilMin.push(`+5° (${fatores.join(', ')}): quadril menos fechado no topo da pedalada.`);
    regras.push('R1');
  }
  // R2 — joelho no PMI para o lado flexionado
  if (a.flex === 'baixa' || a.idade >= 50 || a.nivel === 'iniciante' || a.objetivo === 'conforto') {
    const teto = Math.min(calc.joelhoPMI[1], calc.joelhoPMI[0] + 5);
    if (teto < calc.joelhoPMI[1]) {
      calc.joelhoPMI = [calc.joelhoPMI[0], teto];
      porque.joelhoPMI.push(`teto ${teto}°: selim do lado baixo da faixa reduz a tensão posterior e o balanço da pelve.`);
      regras.push('R2');
    }
  }
  // R3 — aerodinâmica com flexibilidade
  if ((a.nivel === 'competitivo' || a.objetivo === 'aerodinâmica') && a.flex === 'alta' && !dor('lombar') && !fatores.length) {
    calc.tronco = [calc.tronco[0] - 5, calc.tronco[1] - 5];
    porque.tronco.push('−5°: competitivo/aerodinâmica com flexibilidade alta tolera tronco mais baixo (menos arrasto).');
    regras.push('R3');
  } else if ((a.nivel === 'competitivo' || a.objetivo === 'aerodinâmica') && a.flex === 'alta') {
    porque.tronco.push(dor('lombar') ? 'Sem o −5° aerodinâmico: a dor lombar prevalece.' : 'Sem o −5° aerodinâmico: os fatores de postura alta prevalecem.');
  }
  // R4 — joelho anterior
  if (dor('joelhoAnt')) {
    calc.joelhoPMS = [calc.joelhoPMS[0] + 5, Math.max(calc.joelhoPMS[1], calc.joelhoPMS[0] + 10)];
    calc.joelhoPMI = [Math.min(calc.joelhoPMI[1] - 2, calc.joelhoPMI[0] + 3), calc.joelhoPMI[1]];
    porque.joelhoPMS.push('mínimo +5°: dor no joelho anterior — menos flexão no topo reduz a carga patelofemoral.');
    porque.joelhoPMI.push('mínimo +3°: dor no joelho anterior — evitar selim baixo.');
    regras.push('R4');
  }
  // R5 — lombar
  if (dor('lombar')) {
    calc.tronco = [calc.tronco[0] + 5, calc.tronco[1] + 5];
    calc.quadrilMin = [calc.quadrilMin[0] + 5, calc.quadrilMin[1] + 5];
    porque.tronco.push('+5°: dor lombar — menos flexão lombar sustentada.');
    porque.quadrilMin.push('+5°: dor lombar — quadril menos fechado.');
    regras.push('R5');
  }
  // R6 — pescoço/ombro
  if (dor('pescoco')) {
    calc.ombro = [calc.ombro[0] - 5, calc.ombro[1] - 5];
    porque.ombro.push('−5°: dor no pescoço/ombro — alcance mais curto, menos extensão cervical.');
    regras.push('R6');
  }
  // tetos: nada além do que a regra mais forte daria
  calc.tronco = [Math.min(calc.tronco[0], base.tronco[0] + 15), Math.min(calc.tronco[1], base.tronco[1] + 15, 85)];
  calc.quadrilMin = [Math.min(calc.quadrilMin[0], base.quadrilMin[0] + 10), Math.min(calc.quadrilMin[1], base.quadrilMin[1] + 10)];

  if (dor('joelhoLat')) porque.joelhoPMI.push('Dor lateral/medial não muda a faixa sagital: veja o alinhamento na vista frontal e os taquinhos.');
  if (dor('maos')) porque.ombro.push('Mãos/períneo: questão de pressão (selim, queda do guidão), não muda a faixa do ombro.');
  const semEvid = 'Altura e peso não mudam esta faixa (o ângulo já normaliza o tamanho do corpo).';
  for (const k of ['kops', 'ankling', 'cotovelo', 'tornozeloPMI']) porque[k].push(`Faixa da modalidade. ${semEvid}`);
  for (const k of CHAVES_FAIXA) if (!porque[k].length) porque[k].push(`Faixa da modalidade (${perfilNome}). ${semEvid}`);

  const ov = (a.overrides && a.overrides[perfilNome]) || {};
  const faixas = {};
  const linhas = {};
  for (const k of CHAVES_FAIXA) {
    const o = Array.isArray(ov[k]) && ov[k].length === 2 && ov[k].every(Number.isFinite) && ov[k][0] < ov[k][1] ? ov[k] : null;
    faixas[k] = (o || calc[k]).map(r0);
    linhas[k] = {
      faixa: faixas[k], base: base[k], calculada: calc[k].map(r0), override: Boolean(o),
      mudou: faixas[k][0] !== base[k][0] || faixas[k][1] !== base[k][1],
      porque: o ? [`Definido à mão (${txt(o)}); calculado: ${txt(calc[k].map(r0))}.`, ...porque[k]] : porque[k],
    };
  }
  return { perfilNome, faixas, base, linhas, regras, atleta: { id: a.id, nome: a.nome } };
}

const PEDIVELA = [[74, 165], [80, 167.5], [86, 170], [90, 172.5], [Infinity, 175]];
const PEDIVELA_ALT = [[165, 165], [175, 170], [185, 172.5], [Infinity, 175]];

/** Medidas de partida a partir da altura / entrepernas. Cada item: { nome, valor, nota }. */
export function medidasSugeridas(atletaBruto, alvos = null) {
  const a = normalizarAtleta(atletaBruto);
  const out = [];
  let ep = a.entrepernasCm, estimada = false;
  if (!(ep > 0) && a.alturaCm > 0) { ep = 0.46 * a.alturaCm; estimada = true; }
  const cm = (x) => `${x.toFixed(1).replace('.', ',')} cm`;
  if (ep > 0) {
    const nota = estimada ? ' (entrepernas estimada = 0,46 × altura; meça para mais precisão)' : '';
    out.push({ nome: 'Altura do selim — LeMond', valor: cm(0.883 * ep), nota: `0,883 × entrepernas, do centro do movimento central ao topo do selim${nota}.` });
    out.push({ nome: 'Altura do selim — Hamley', valor: cm(1.09 * ep), nota: `1,09 × entrepernas, do pedal (pedivela embaixo) ao topo do selim${nota}.` });
    const pv = (a.entrepernasCm > 0 ? PEDIVELA.find(([lim]) => a.entrepernasCm < lim) : PEDIVELA_ALT.find(([lim]) => a.alturaCm < lim))[1];
    out.push({ nome: 'Pedivela', valor: `${String(pv).replace('.', ',')} mm`, nota: a.entrepernasCm > 0 ? 'Faixa usual por entrepernas; ≈ 20% da perna é o ótimo teórico e a potência muda pouco ±5 mm.' : 'Faixa usual por altura (sem entrepernas).' });
  }
  void alvos;
  return out;
}

/** Linhas curtas do perfil (relatório, rodapé). */
export function resumoAtleta(atletaBruto) {
  const a = normalizarAtleta(atletaBruto);
  const im = imc(a);
  const p = [];
  if (a.alturaCm) p.push(`${a.alturaCm} cm`);
  if (a.pesoKg) p.push(`${a.pesoKg} kg`);
  if (im != null) p.push(`IMC ${im.toFixed(1).replace('.', ',')}`);
  if (a.entrepernasCm) p.push(`entrepernas ${a.entrepernasCm} cm`);
  if (a.idade) p.push(`${a.idade} anos`);
  if (a.sexo) p.push(a.sexo);
  if (a.flex) p.push(`flexibilidade ${a.flex}`);
  p.push(a.nivel, `objetivo ${a.objetivo}`);
  if (a.dores.length) p.push('dores: ' + a.dores.map((d) => (DORES.find(([k]) => k === d) || [d, d])[1].toLowerCase()).join(', '));
  return p.join(' · ');
}

// ---------------------------------------------------------------- armazenamento

const CHAVE = 'aiv.bikefit.atletas';
const temLS = () => { try { return typeof localStorage !== 'undefined'; } catch (_) { return false; } };

/** { ativo, lista } — no primeiro uso migra o nome do Studio (aiv.studio.bikefit.atleta). */
export function lerAtletas() {
  let v = null;
  if (temLS()) { try { v = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (_) { v = null; } }
  if (!v || !Array.isArray(v.lista) || !v.lista.length) {
    let nome = 'Atleta';
    if (temLS()) { try { nome = (JSON.parse(localStorage.getItem('aiv.studio.bikefit') || '{}') || {}).atleta || nome; } catch (_) { /* sem nome */ } }
    const a = atletaVazio(nome);
    v = { ativo: a.id, lista: [a] };
  }
  v.lista = v.lista.map(normalizarAtleta);
  if (!v.lista.some((a) => a.id === v.ativo)) v.ativo = v.lista[0].id;
  return v;
}
export function gravarAtletas(v) {
  if (!temLS()) return;
  try { localStorage.setItem(CHAVE, JSON.stringify(v)); } catch (_) { /* cota cheia / privado */ }
}
