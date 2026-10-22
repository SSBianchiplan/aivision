/**
 * via/cartoes.js — registro de CARTÕES extras e de «aplicadores» da biblioteca da Via.
 *
 * As ferramentas novas (módulos, Motion 3D) desenham os próprios cartões sem mexer no
 * ViaPainel: registram aqui um componente por tipo de cartão. O ViaPainel procura aqui quando
 * não conhece o tipo. Mesma ideia para a biblioteca: um comando salvo com op «motion3d.via»
 * ganha o botão do aplicador registrado (ex.: «Gerar no Studio») em vez de «Aplicar no Pipeline».
 * Leve: nenhum import.
 */
const cartoes = new Map();
const aplicadores = [];

/** Componente({ item, atualizar }) para item.cartao.tipo === tipo. */
export function registrarCartao(tipo, componente) { cartoes.set(tipo, componente); }
export function cartaoDe(tipo) { return cartoes.get(tipo) || null; }

/** { prefixo: 'motion3d.', rotulo: 'Gerar no Studio', aplicar: async (comando) => 'mensagem' } */
export function registrarAplicador(a) { if (!aplicadores.some((x) => x.prefixo === a.prefixo)) aplicadores.push(a); }
export function aplicadorDe(op) { return aplicadores.find((a) => String(op || '').startsWith(a.prefixo)) || null; }
