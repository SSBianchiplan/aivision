/**
 * via/registro.js — o REGISTRO de módulos da Via. Leve: pode ser importado por qualquer painel
 * (não puxa SDK, chat, canais nem declarações).
 *
 * Cada módulo do iaVision declara o que a Via pode fazer com ele:
 *
 *   registrarModuloVia({
 *     id: 'beltscan',                 // id curto, estável (é o que a Via usa nas ferramentas)
 *     nome: 'BeltScan',               // como aparece para o usuário
 *     registro: ['CV-36'],            // módulos do registry (cv/registry.js) que ele cobre
 *     ops: ['beltscan.volumetria'],   // operadores do Pipeline
 *     pessoal: false,                 // true = dados de PESSOAS (saúde, movimento, fala): só com permissão
 *     sobre: 'o que mede e como ler', // texto curto para explicar_resultado
 *     estado: async () => ({...}),    // números do painel (só números/rótulos; nada de imagem)
 *     config: async () => ({ chave: { tipo, min, max, opcoes, rotulo, valor } }),   // o que dá para mudar
 *     aplicar: async (mudancas) => 'texto do que mudou',                           // só depois do clique
 *   })
 *
 * As declarações dos módulos que já existem moram em via/modulos-via.js e só carregam quando a
 * Via usa uma ferramenta de módulo (custo zero com a Via fechada). Um módulo novo pode chamar
 * registrarModuloVia() do próprio código — a Via o enxerga sem mudar nada nela.
 *
 * PAINEL_MODULO liga o id do painel (Panel id=…) ao módulo, para o botão «✦ Via» do cabeçalho.
 */

const modulos = new Map();
const ouvintes = new Set();

export function registrarModuloVia(decl) {
  if (!decl || typeof decl.id !== 'string' || !/^[a-z0-9][\w-]{1,40}$/.test(decl.id)) throw new Error('registrarModuloVia: id inválido');
  modulos.set(decl.id, { pessoal: false, registro: [], ops: [], ...decl });
  for (const fn of ouvintes) { try { fn(decl.id); } catch (_) { /* ouvinte ruim */ } }
}
export function moduloVia(id) { return modulos.get(id) || null; }
export function modulosVia() { return [...modulos.values()]; }
export function ouvirRegistro(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }

/** Painel (id do <Panel>) ou Studio → id do módulo na Via. Só nomes: nada é carregado aqui. */
export const PAINEL_MODULO = {
  beltscan: 'beltscan', contador: 'contador', takt: 'takt', oee: 'oee', inspecao: 'inspecao', epi: 'epi',
  industrial: 'industrial', fisio: 'fisio', onda2c: 'vitais', bikefit: 'bikefit', ergonomia: 'ergonomia',
  academia: 'academia', salto: 'salto', corrida: 'corrida', swing: 'swing', vbt: 'vbt', quadra: 'quadra',
  esportes: 'esportes', medicoes: 'medicoes', aplicacoes: 'aplicacoes', projeto: 'projeto', stats: 'telemetria',
  codes: 'codigos', captions: 'legendas', context: 'contexto', coisas: 'coisas',
};
/** Nome amigável sem carregar as declarações (para o botão e o chip da gaveta). */
export const NOME_MODULO = {
  beltscan: 'BeltScan', contador: 'CounterVision', takt: 'Takt', oee: 'OEE', inspecao: 'Inspect', epi: 'EPI',
  industrial: 'Industrial', fisio: 'Fisio', vitais: 'Vitais e saúde+', bikefit: 'Bike Fit', ergonomia: 'Ergonomia',
  academia: 'Academia', salto: 'Salto', corrida: 'Corrida', swing: 'Swing', vbt: 'VBT', quadra: 'Quadra',
  esportes: 'Esportes', medicoes: 'Medições', aplicacoes: 'Aplicações', projeto: '+Projeto', telemetria: 'Telemetria',
  codigos: 'Códigos', legendas: 'Legendas', contexto: 'Contexto', coisas: 'Coisas', motion3d: 'Motion 3D Studio', video: 'GPlanSiS|Vídeo',
};
export function nomeModulo(id) { const m = modulos.get(id); return (m && m.nome) || NOME_MODULO[id] || id; }
