/**
 * via/ferramentas.js — as ferramentas da Via, executadas AQUI no navegador.
 *
 * Cada uma tem: a definição enviada à API (nome, descrição, input_schema —
 * sempre na mesma ordem, para o cache de prompt), `validar(input)` e
 * `executar(input, ui)`.
 *
 * VALIDAÇÃO: as ferramentas vão com `eager_input_streaming: true` — o input
 * chega em pedaços e a API não confere mais o esquema. O SDK junta os pedaços
 * com um parser tolerante, que pode devolver um objeto silenciosamente
 * truncado. Por isso cada ferramenta valida o input ANTES de executar; input
 * inválido volta para a Via como tool_result com is_error, sem executar nada.
 *
 * A IA PROPÕE, O HUMANO DECIDE: propor_comando, salvar_comando e
 * adicionar_operador NÃO mexem no Pipeline nem na biblioteca — só desenham um
 * cartão no chat com os botões. Quem aplica é o clique do usuário. O mesmo vale
 * para enviar_ao_treinar: o cartão mostra projeto e imagens; só envia com clique.
 *
 * buscar_conhecimento consulta a base da GPlanSiS (/api/via/busca: os itens do
 * usuário + os compartilhados) — só leitura, devolve trechos para citar.
 */

import { store } from '../state/store.js';
import { OPERATORS, getOperator, coerceParams, MODULES } from '../cv/registry.js';
import { infoCampo, listarComandos, listarCategorias } from './comandos.js';
import { buscar } from './servidor.js';
import { garantirToken, listarProjetos } from '../auth/treino.js';

const ANEXO_RE = /^A\d{1,4}$/;
const PROJETO_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

const texto = (v) => typeof v === 'string';
const opcional = (v) => v === undefined || v === null || typeof v === 'string';

/** Erro de validação: vira tool_result com is_error. */
class InputInvalido extends Error {}

function exigirOp(op) {
  if (!texto(op) || !getOperator(op)) throw new InputInvalido(`operador desconhecido: ${JSON.stringify(op)}. Consulte o catálogo.`);
  return getOperator(op);
}

function exigirCampo(op, parametro) {
  const def = exigirOp(op);
  const sch = def.params && def.params[parametro];
  if (!texto(parametro) || !sch) throw new InputInvalido(`o operador ${op} não tem o parâmetro ${JSON.stringify(parametro)}.`);
  const info = infoCampo(op, parametro, sch);
  if (!info) throw new InputInvalido(`${op}.${parametro} não aceita comando (não é lista de classes/frase). Use listar_operadores_com_comando.`);
  return { def, sch, info };
}

function exigirValor(valor, sch, info) {
  if (!texto(valor)) throw new InputInvalido('valor precisa ser texto.');
  const max = sch.max || info.max || 400;
  if (valor.length > max) throw new InputInvalido(`valor com ${valor.length} caracteres; o campo aceita até ${max}.`);
}

/** Listas de classes do painel Coisas (localStorage dele, só leitura). */
function listasCoisas() {
  try { const v = JSON.parse(localStorage.getItem('aiv.coisas.listas') || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
}

const resumo = (v) => (typeof v === 'string' && v.length > 160 ? v.slice(0, 160) + '…' : v);

// ------------------------------------------------------------ definições

export const FERRAMENTAS = [
  {
    def: {
      name: 'listar_operadores_com_comando',
      description: 'Lista os operadores do iaVision cujos parâmetros de texto aceitam comando (listas de classes, frases, prompts), com formato, idioma, valor padrão e tamanho máximo de cada campo, e as listas salvas no painel Coisas. Use antes de propor um comando se tiver dúvida sobre o campo.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validar: () => null,
    executar: () => {
      const nomeMod = new Map(MODULES.map((m) => [m.id, m.name]));
      const operadores = [];
      for (const def of OPERATORS.values()) {
        const campos = Object.entries(def.params || {})
          .map(([k, s]) => [k, s, infoCampo(def.op, k, s)])
          .filter(([, , i]) => i)
          .map(([k, s, i]) => ({ parametro: k, rotulo: s.label || k, formato: i.formato, idioma: i.idioma, dica: i.dica,
            padrao: s.default ?? '', max: s.max || i.max || 400 }));
        if (campos.length) operadores.push({ op: def.op, rotulo: def.label, modulo: nomeMod.get(def.group) || def.group, campos });
      }
      return { operadores, listas_do_painel_coisas: listasCoisas() };
    },
  },
  {
    def: {
      name: 'obter_pipeline',
      description: 'Devolve o Pipeline atual: os nós em ordem, com op, rótulo, se está ligado, erro (se houver) e os parâmetros. Textos longos vêm resumidos.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validar: () => null,
    executar: () => {
      const st = store.get();
      return {
        nos: st.nodes.map((n, i) => ({
          posicao: i + 1, id: n.id, op: n.op, rotulo: (getOperator(n.op) || {}).label || n.op,
          ligado: n.enabled !== false, erro: n.error || null, selecionado: st.selectedNode === n.id,
          params: Object.fromEntries(Object.entries(n.params || {}).map(([k, v]) => [k, resumo(v)])),
        })),
        fonte: st.sourceKind || 'camera', rodando: Boolean(st.running),
      };
    },
  },
  {
    def: {
      name: 'propor_comando',
      description: 'Propõe um valor pronto para um parâmetro de texto que aceita comando. Mostra ao usuário um CARTÃO com o valor e os botões Aplicar no Pipeline, Salvar e Copiar — nada é aplicado sem o clique dele. Use uma chamada por campo.',
      input_schema: {
        type: 'object',
        properties: {
          op: { type: 'string', description: 'id do operador, ex.: yoloe.prompt' },
          parametro: { type: 'string', description: 'nome do parâmetro, ex.: classes' },
          valor: { type: 'string', description: 'o comando pronto, no formato do campo' },
          explicacao: { type: 'string', description: 'uma ou duas frases em português: por que este valor' },
          nome: { type: 'string', description: 'nome curto sugerido para salvar na biblioteca (opcional)' },
        },
        required: ['op', 'parametro', 'valor', 'explicacao'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      const { sch, info } = exigirCampo(i.op, i.parametro);
      exigirValor(i.valor, sch, info);
      if (!texto(i.explicacao)) throw new InputInvalido('explicacao precisa ser texto.');
      if (!opcional(i.nome)) throw new InputInvalido('nome precisa ser texto.');
    },
    executar: (i, ui) => {
      const { def, sch, info } = exigirCampo(i.op, i.parametro);
      ui.mostrarCartao({ tipo: 'comando', op: i.op, parametro: i.parametro, valor: i.valor, explicacao: i.explicacao,
        nome: i.nome || '', rotuloOp: def.label, rotuloCampo: sch.label || i.parametro, categoria: info.categoria || 'outros' });
      return 'Cartão mostrado. O usuário decide se aplica, salva ou copia — ainda não foi aplicado.';
    },
  },
  {
    def: {
      name: 'salvar_comando',
      description: 'Sugere guardar um comando na biblioteca de comandos do usuário. Mostra um cartão com os dados e o botão Salvar na biblioteca — só grava se o usuário confirmar.',
      input_schema: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'nome curto, ex.: EPI da linha 3' },
          op: { type: 'string' },
          parametro: { type: 'string' },
          valor: { type: 'string' },
          categoria: { type: 'string', description: 'nome ou id da categoria (Detecção, Vocabulário aberto, Bike Fit, Corrida, Industrial, Quadra, Esportes, Outros ou uma nova)' },
          descricao: { type: 'string', description: 'para que serve (opcional)' },
        },
        required: ['nome', 'op', 'parametro', 'valor'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      if (!texto(i.nome) || !i.nome.trim()) throw new InputInvalido('nome é obrigatório.');
      const { sch, info } = exigirCampo(i.op, i.parametro);
      exigirValor(i.valor, sch, info);
      if (!opcional(i.categoria) || !opcional(i.descricao)) throw new InputInvalido('categoria e descricao precisam ser texto.');
    },
    executar: (i, ui) => {
      const { def, sch, info } = exigirCampo(i.op, i.parametro);
      const cats = listarCategorias();
      const alvo = String(i.categoria || '').trim().toLowerCase();
      const cat = cats.find((c) => c.id === alvo || c.nome.toLowerCase() === alvo);
      ui.mostrarCartao({ tipo: 'salvar', nome: i.nome.trim(), op: i.op, parametro: i.parametro, valor: i.valor,
        descricao: i.descricao || '', rotuloOp: def.label, rotuloCampo: sch.label || i.parametro,
        categoria: cat ? cat.id : (alvo ? null : info.categoria || 'outros'), categoriaNova: cat || !alvo ? '' : i.categoria.trim() });
      return 'Cartão de salvar mostrado. Só será gravado se o usuário confirmar.';
    },
  },
  {
    def: {
      name: 'adicionar_operador',
      description: 'Propõe adicionar um operador (nó) ao fim do Pipeline, com parâmetros. Mostra um cartão com o botão Adicionar ao Pipeline — nada muda sem o clique do usuário. Parâmetros omitidos ficam no padrão.',
      input_schema: {
        type: 'object',
        properties: {
          op: { type: 'string', description: 'id do operador do catálogo' },
          params: { type: 'object', description: 'parâmetros a mudar em relação ao padrão (opcional)' },
          explicacao: { type: 'string', description: 'por que este operador, em português' },
        },
        required: ['op', 'explicacao'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      const def = exigirOp(i.op);
      if (i.params !== undefined && (i.params === null || typeof i.params !== 'object' || Array.isArray(i.params))) throw new InputInvalido('params precisa ser um objeto.');
      for (const k of Object.keys(i.params || {})) if (!def.params || !def.params[k]) throw new InputInvalido(`${i.op} não tem o parâmetro ${k}.`);
      if (!texto(i.explicacao)) throw new InputInvalido('explicacao precisa ser texto.');
    },
    executar: (i, ui) => {
      const def = exigirOp(i.op);
      const params = coerceParams(i.op, i.params || {});
      const mudados = Object.keys(i.params || {});
      ui.mostrarCartao({ tipo: 'operador', op: i.op, rotuloOp: def.label, params, mudados, explicacao: i.explicacao, agpl: Boolean(def.agpl) });
      return 'Cartão mostrado. O operador só entra no Pipeline se o usuário clicar.';
    },
  },
  {
    def: {
      name: 'ver_quadro_atual',
      description: 'Pede para ver o quadro atual do vídeo (JPEG reduzido a ~768 px). O usuário precisa permitir; se recusar, siga sem a imagem. Use para sugerir classes e prompts a partir do que aparece.',
      input_schema: {
        type: 'object',
        properties: { motivo: { type: 'string', description: 'por que você quer ver, em uma frase (aparece no pedido de permissão)' } },
        required: ['motivo'],
        additionalProperties: false,
      },
    },
    validar: (i) => { if (!texto(i.motivo)) throw new InputInvalido('motivo precisa ser texto.'); },
    executar: async (i, ui) => {
      const ok = await ui.pedirPermissaoImagem(i.motivo);
      if (!ok) return { conteudo: 'O usuário não permitiu ver o quadro agora. Siga sem a imagem ou pergunte o que aparece no vídeo.' };
      const q = ui.capturarQuadro();
      if (!q) return { conteudo: 'Não há quadro disponível (fonte parada ou sem vídeo). Peça ao usuário para ligar a câmera ou abrir um vídeo.', erro: true };
      return {
        conteudo: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: q.base64 } },
          { type: 'text', text: `Quadro atual da fonte (${q.w}×${q.h}, reduzido).` },
        ],
      };
    },
  },
  {
    def: {
      name: 'listar_comandos_salvos',
      description: 'Lista os comandos já salvos na biblioteca do usuário, opcionalmente só de um operador/parâmetro.',
      input_schema: {
        type: 'object',
        properties: { op: { type: 'string' }, parametro: { type: 'string' } },
        additionalProperties: false,
      },
    },
    validar: (i) => { if (!opcional(i.op) || !opcional(i.parametro)) throw new InputInvalido('op e parametro precisam ser texto.'); },
    executar: (i) => ({
      comandos: listarComandos({ op: i.op || null, parametro: i.parametro || null }).slice(0, 80)
        .map((c) => ({ nome: c.nome, op: c.op, parametro: c.parametro, valor: c.valor, categoria: c.categoria, descricao: c.descricao })),
    }),
  },
  // ---- novas ferramentas: SEMPRE no fim da lista (o prefixo das anteriores fica igual para o cache)
  {
    def: {
      name: 'buscar_conhecimento',
      description: 'Busca na base de conhecimento da GPlanSiS (trechos salvos pelo usuário e os compartilhados pela equipe) — iluminação, câmeras, modelos, parâmetros, treino, casos já resolvidos. Devolve trechos curtos com id, título e origem. Use ANTES de responder perguntas técnicas de visão computacional; cite o que usar como (base: «título»). Termos curtos em português funcionam melhor.',
      input_schema: {
        type: 'object',
        properties: {
          q: { type: 'string', description: 'o que procurar, 2–12 palavras (ex.: iluminação esteira reflexo)' },
          n: { type: 'integer', description: 'quantos trechos (1–8; padrão 5)' },
        },
        required: ['q'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      if (!texto(i.q) || i.q.trim().length < 2) throw new InputInvalido('q precisa ter pelo menos 2 caracteres.');
      if (i.q.length > 300) throw new InputInvalido('q longo demais (até 300).');
      if (i.n !== undefined && (!Number.isInteger(i.n) || i.n < 1 || i.n > 8)) throw new InputInvalido('n precisa ser inteiro de 1 a 8.');
    },
    executar: async (i, ui) => {
      try {
        const r = await buscar(i.q.trim(), i.n || 5);
        const trechos = (r.trechos || []).map((t) => ({ id: t.id, titulo: t.titulo, trecho: t.trecho,
          origem: t.meu ? 'salvo pelo usuário' : 'compartilhado pela equipe', tags: t.tags, score: t.score }));
        if (ui && ui.onBusca) ui.onBusca(i.q.trim(), trechos.length);
        return trechos.length
          ? { trechos, como_citar: 'Cite o que usar como (base: «título»). Se os trechos não respondem, diga e responda pelo seu conhecimento.' }
          : { trechos: [], nota: 'Nada na base para estes termos. Responda pelo seu conhecimento (sem citar a base).' };
      } catch (e) {
        return `A base de conhecimento não respondeu agora (${e && e.message ? e.message : 'erro'}). Responda sem ela.`;
      }
    },
  },
  {
    def: {
      name: 'listar_projetos_treinar',
      description: 'Lista os projetos do Treinar (treino de modelos no servidor): id, nome, tipo (detector com classes ou anomalia) e quantas imagens têm. Use para escolher o projeto antes de enviar_ao_treinar.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validar: () => null,
    executar: async () => {
      const tok = await garantirToken();
      if (!tok) return 'Sem acesso ao Treinar agora: o usuário precisa entrar (senha do treino, ou conta de administrador). Use enviar_ao_treinar mesmo assim — o cartão pede o login e deixa escolher o projeto.';
      try {
        const ps = await listarProjetos();
        return { projetos: (ps || []).map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo, motor: p.motor,
          classes: p.tipo === 'anomalia' ? undefined : p.classes, imagens: p.imagens })) };
      } catch (e) {
        return { conteudo: `O Treinar não respondeu (${e && e.message ? e.message : 'erro'}).`, erro: true };
      }
    },
  },
  {
    def: {
      name: 'enviar_ao_treinar',
      description: 'Propõe mandar imagens ANEXADAS pelo usuário (ids A1, A2…) para um projeto do Treinar. Mostra um CARTÃO com as miniaturas, o projeto e o botão Enviar — nada é enviado sem o clique do usuário. Projeto opcional (o usuário escolhe no cartão); grupo só para projetos de anomalia (boa = peça boa, ruim = com defeito).',
      input_schema: {
        type: 'object',
        properties: {
          imagens: { type: 'array', items: { type: 'string' }, description: 'ids dos anexos, ex.: ["A1","A2"]' },
          projeto: { type: 'string', description: 'id do projeto (de listar_projetos_treinar), opcional' },
          grupo: { type: 'string', enum: ['boa', 'ruim'], description: 'só para projetos de anomalia' },
          explicacao: { type: 'string', description: 'uma frase: por que estas imagens neste projeto' },
        },
        required: ['imagens', 'explicacao'],
        additionalProperties: false,
      },
    },
    validar: (i, ui) => {
      if (!Array.isArray(i.imagens) || !i.imagens.length || i.imagens.length > 40) throw new InputInvalido('imagens precisa ser uma lista de 1 a 40 ids (A1, A2…).');
      for (const a of i.imagens) {
        if (!texto(a) || !ANEXO_RE.test(a)) throw new InputInvalido(`id de anexo inválido: ${JSON.stringify(a)} (use A1, A2…).`);
        if (ui && ui.anexo && !ui.anexo(a)) throw new InputInvalido(`não há anexo ${a} nesta conversa.`);
      }
      if (i.projeto !== undefined && i.projeto !== null && (!texto(i.projeto) || !PROJETO_RE.test(i.projeto))) throw new InputInvalido('projeto inválido (use o id de listar_projetos_treinar).');
      if (i.grupo !== undefined && i.grupo !== null && i.grupo !== 'boa' && i.grupo !== 'ruim') throw new InputInvalido('grupo precisa ser boa ou ruim.');
      if (!texto(i.explicacao)) throw new InputInvalido('explicacao precisa ser texto.');
    },
    executar: (i, ui) => {
      ui.mostrarCartao({ tipo: 'treinar', imagens: [...new Set(i.imagens)], projeto: i.projeto || '', grupo: i.grupo || 'boa', explicacao: i.explicacao });
      return 'Cartão mostrado. As imagens só vão para o Treinar se o usuário escolher o projeto e clicar em Enviar.';
    },
  },
];

const POR_NOME = new Map(FERRAMENTAS.map((f) => [f.def.name, f]));

/**
 * Definições para a API: mesma ordem sempre, com eager_input_streaming
 * (o input chega enquanto é gerado; a validação fica do nosso lado).
 */
export function definicoes() {
  return FERRAMENTAS.map((f) => ({ ...f.def, eager_input_streaming: true }));
}

/**
 * Executa um bloco tool_use e devolve o tool_result correspondente.
 * Input inválido ou ferramenta desconhecida → is_error, sem executar.
 */
export async function executarFerramenta(bloco, ui) {
  const f = POR_NOME.get(bloco.name);
  const base = { type: 'tool_result', tool_use_id: bloco.id };
  if (!f) return { ...base, is_error: true, content: `Ferramenta desconhecida: ${bloco.name}` };
  const input = bloco.input && typeof bloco.input === 'object' && !Array.isArray(bloco.input) ? bloco.input : null;
  try {
    if (!input) throw new InputInvalido('input não é um objeto JSON.');
    f.validar(input, ui);
  } catch (e) {
    if (!(e instanceof InputInvalido)) throw e;
    // o input pode ter chegado truncado (eager streaming): devolve o que veio, escapado pelo JSON
    return { ...base, is_error: true, content: JSON.stringify({ INVALID_INPUT: e.message, recebido: bloco.input ?? null }) };
  }
  try {
    const r = await f.executar(input, ui);
    if (r && typeof r === 'object' && 'conteudo' in r) {
      return { ...base, ...(r.erro ? { is_error: true } : {}), content: r.conteudo };
    }
    return { ...base, content: typeof r === 'string' ? r : JSON.stringify(r) };
  } catch (e) {
    if (e instanceof InputInvalido) return { ...base, is_error: true, content: e.message };
    return { ...base, is_error: true, content: `Falha ao executar ${bloco.name}: ${e && e.message ? e.message : 'erro'}` };
  }
}
