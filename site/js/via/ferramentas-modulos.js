/**
 * via/ferramentas-modulos.js — ferramentas GENÉRICAS da Via para todos os módulos do iaVision.
 *
 *   listar_modulos       quais módulos a Via enxerga (registro: via/registro.js + via/modulos-via.js)
 *   ler_estado_modulo    os números do painel/Studio (dados de PESSOAS só com permissão)
 *   configurar_modulo    PROPÕE mudanças de parâmetros/marcações → cartão; só aplica com o clique
 *   explicar_resultado   o que cada número significa + o estado, para a Via explicar
 *
 * Os nomes são fixos (ler_estado_modulo { modulo: 'beltscan' }) em vez de uma ferramenta por
 * módulo: a lista de ferramentas fica idêntica entre pedidos (cache de prompt) e um módulo novo
 * entra só declarando-se no registro, sem mexer na Via.
 *
 * As declarações (e os canais dos módulos) só carregam quando uma destas ferramentas roda.
 */
import { html, useState } from '../vendor.js';
import { registrarCartao } from './cartoes.js';
import { nomeModulo } from './registro.js';

let decl = null;
/** Carrega as declarações uma vez (sob demanda). */
export function carregarModulos() { if (!decl) decl = import('./modulos-via.js').catch((e) => { decl = null; throw e; }); return decl; }

class Invalido extends Error {}
const txt = (v) => typeof v === 'string';

async function exigirModulo(id) {
  const { acharModulo } = await carregarModulos();
  const m = acharModulo(id);
  if (!m) throw new Invalido(`módulo desconhecido: ${JSON.stringify(id)}. Use listar_modulos.`);
  return m;
}

/** Permissão para dados de pessoas (mesmo padrão do ver_quadro_atual). */
async function permitido(m, motivo, ui) {
  if (!m.pessoal) return true;
  if (!ui || !ui.pedirPermissaoDados) return false;
  return ui.pedirPermissaoDados({ id: m.id, nome: m.nome }, motivo || `ler os números do ${m.nome}`);
}
const RECUSADO = (m) => ({ conteudo: `O usuário não permitiu enviar os dados do ${m.nome} (são dados de uma pessoa). Siga sem eles: explique como ler o painel ou peça que ele diga os números que quiser compartilhar.` });

/** Confere as mudanças contra o esquema do módulo. Devolve [{chave, rotulo, antes, depois}] ou lança. */
export function conferirMudancas(esquema, mudancas) {
  const erros = [], linhas = [], limpas = {};
  for (const [k, v0] of Object.entries(mudancas || {})) {
    const s = esquema[k];
    if (!s) { erros.push(`«${k}» não é configurável (veja as chaves em explicar_resultado/ler o esquema: ${Object.keys(esquema).slice(0, 40).join(', ')}${Object.keys(esquema).length > 40 ? '…' : ''}).`); continue; }
    let v = v0;
    if (s.tipo === 'numero' || s.tipo === 'inteiro') {
      v = Number(v0);
      if (!Number.isFinite(v)) { erros.push(`${k}: precisa ser número.`); continue; }
      if (s.tipo === 'inteiro' && !Number.isInteger(v)) { erros.push(`${k}: precisa ser inteiro.`); continue; }
      if ((Number.isFinite(s.min) && v < s.min) || (Number.isFinite(s.max) && v > s.max)) { erros.push(`${k} = ${v} fora da faixa ${s.min}–${s.max}.`); continue; }
    } else if (s.tipo === 'sim_nao') {
      if (typeof v0 !== 'boolean') { erros.push(`${k}: use true/false.`); continue; }
    } else if (s.tipo === 'opcao') {
      const ok = (s.opcoes || []).find((o) => String(o) === String(v0));
      if (ok === undefined) { erros.push(`${k}: opção inválida ${JSON.stringify(v0)} (use ${(s.opcoes || []).join(' | ')}).`); continue; }
      v = ok;
    } else if (s.tipo === 'texto') {
      if (!txt(v0) || v0.length > (s.max_caracteres || 400)) { erros.push(`${k}: texto de até ${s.max_caracteres || 400} caracteres.`); continue; }
    }
    if (JSON.stringify(s.valor) === JSON.stringify(v)) continue;
    limpas[k] = v;
    linhas.push({ chave: k, rotulo: s.rotulo || k, antes: s.valor, depois: v });
  }
  if (erros.length) throw new Invalido(erros.join(' '));
  return { linhas, limpas };
}

export const FERRAMENTAS_MODULOS = [
  {
    def: {
      name: 'listar_modulos',
      description: 'Lista os módulos/painéis/Studios do iaVision que a Via enxerga: id, nome, se está ligado no Pipeline, se tem configuração e se os dados são de PESSOAS (pedem permissão). Inclui os 84 módulos do registry pelo id «cv-NN». Use para achar o id antes de ler_estado_modulo/configurar_modulo.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validar: () => null,
    executar: async () => {
      const { modulosVia } = await import('./registro.js');
      await carregarModulos();
      const { store } = await import('../state/store.js');
      const nos = store.get().nodes;
      const lig = (m) => nos.some((n) => (m.ops || []).includes(n.op) && n.enabled !== false);
      const todos = modulosVia();
      return {
        modulos: todos.filter((m) => !m.generico).map((m) => ({ id: m.id, nome: m.nome, ligado: lig(m), configuravel: Boolean(m.config), dados_de_pessoas: Boolean(m.pessoal) })),
        registry: todos.filter((m) => m.generico).map((m) => `${m.id}${lig(m) ? '*' : ''}${m.pessoal ? '(pessoal)' : ''} ${m.nome.replace(/^CV-\d+ /, '')}`).join(' · '),
        legenda: '* = ligado no Pipeline; (pessoal) = pede permissão.',
      };
    },
  },
  {
    def: {
      name: 'ler_estado_modulo',
      description: 'Lê os números atuais de um módulo/painel/Studio (ex.: beltscan, contador, takt, oee, inspecao, epi, fisio, vitais, bikefit, medicoes, aplicacoes, telemetria, motion3d ou cv-NN): indicadores, nós no Pipeline e parâmetros. Só números e rótulos — nunca imagem. Módulos com dados de PESSOAS (saúde, movimento, posto de trabalho, fala) pedem permissão ao usuário; se ele recusar, siga sem os dados.',
      input_schema: {
        type: 'object',
        properties: {
          modulo: { type: 'string', description: 'id do módulo (de listar_modulos)' },
          motivo: { type: 'string', description: 'uma frase: para que você precisa dos números (aparece no pedido de permissão)' },
        },
        required: ['modulo'],
        additionalProperties: false,
      },
    },
    validar: (i) => { if (!txt(i.modulo) || !i.modulo.trim()) throw new Invalido('modulo é obrigatório.'); if (i.motivo != null && !txt(i.motivo)) throw new Invalido('motivo precisa ser texto.'); },
    executar: async (i, ui) => {
      const m = await exigirModulo(i.modulo);
      if (!(await permitido(m, i.motivo, ui))) return RECUSADO(m);
      const estado = await m.estado();
      return { modulo: m.id, nome: m.nome, dados_de_pessoas: Boolean(m.pessoal), lido_em: new Date().toLocaleTimeString('pt-BR'), estado };
    },
  },
  {
    def: {
      name: 'configurar_modulo',
      description: 'PROPÕE mudar parâmetros de um módulo (limiares, tempos, alarmes, faixas, marcações ligadas à configuração). Mostra ao usuário um CARTÃO com «atual → proposto» e os botões Aplicar / Agora não — nada muda sem o clique dele. Chame explicar_resultado antes se não souber as chaves e faixas aceitas. Uma chamada por módulo.',
      input_schema: {
        type: 'object',
        properties: {
          modulo: { type: 'string' },
          mudancas: { type: 'object', description: 'chave → novo valor, ex.: {"extraction.thr": 30} ou {"contagem.esteira.confMin": 0.5}' },
          explicacao: { type: 'string', description: 'por que estas mudanças, em português, curto' },
        },
        required: ['modulo', 'mudancas', 'explicacao'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      if (!txt(i.modulo)) throw new Invalido('modulo é obrigatório.');
      if (!i.mudancas || typeof i.mudancas !== 'object' || Array.isArray(i.mudancas) || !Object.keys(i.mudancas).length) throw new Invalido('mudancas precisa ser um objeto com pelo menos uma chave.');
      if (Object.keys(i.mudancas).length > 20) throw new Invalido('no máximo 20 mudanças por cartão.');
      if (!txt(i.explicacao)) throw new Invalido('explicacao precisa ser texto.');
    },
    executar: async (i, ui) => {
      const m = await exigirModulo(i.modulo);
      if (!m.config || !m.aplicar) throw new Invalido(`o ${m.nome} não tem configuração que a Via possa propor.`);
      const esquema = await m.config();
      const { linhas, limpas } = conferirMudancas(esquema, i.mudancas);
      if (!linhas.length) return 'Os valores propostos já são os atuais: nada a mudar.';
      ui.mostrarCartao({ tipo: 'config-modulo', modulo: m.id, nome: m.nome, linhas, mudancas: limpas, explicacao: i.explicacao,
        comando: { op: `via.${m.id}`, parametro: 'config', valor: JSON.stringify(limpas) } });
      return `Cartão mostrado com ${linhas.length} mudança(s) no ${m.nome}. Ainda NÃO foi aplicado: o usuário decide.`;
    },
  },
  {
    def: {
      name: 'explicar_resultado',
      description: 'Devolve o que o módulo mede, como ler cada número, as chaves configuráveis (com faixas) e o estado atual (com permissão se forem dados de pessoas). Use para explicar um resultado ao usuário em linguagem simples ou antes de configurar_modulo.',
      input_schema: {
        type: 'object',
        properties: { modulo: { type: 'string' }, pergunta: { type: 'string', description: 'o que o usuário quer entender (opcional)' } },
        required: ['modulo'],
        additionalProperties: false,
      },
    },
    validar: (i) => { if (!txt(i.modulo)) throw new Invalido('modulo é obrigatório.'); },
    executar: async (i, ui) => {
      const m = await exigirModulo(i.modulo);
      let esquema = null;
      try { esquema = m.config ? await m.config() : null; } catch (e) { esquema = `indisponível (${e.message})`; }
      const ok = await permitido(m, i.pergunta ? `explicar: ${i.pergunta}` : `explicar o resultado do ${m.nome}`, ui);
      let estado = null;
      if (ok) { try { estado = await m.estado(); } catch (e) { estado = `indisponível (${e.message})`; } }
      return {
        modulo: m.id, nome: m.nome, sobre: m.sobre || '', configuravel: esquema,
        estado: ok ? estado : 'o usuário não permitiu enviar os dados (são de uma pessoa) — explique de forma geral',
        como_explicar: 'Explique em português simples, cite os números que importam, diga o que é estimativa e as limitações. Em saúde, esporte e ergonomia: é educacional, não é laudo.',
      };
    },
  },
];

/** Bloco de texto que acompanha a 1ª mensagem quando a Via abre pelo botão de um módulo. */
export async function contextoDoModulo(id) {
  try {
    const { acharModulo } = await carregarModulos();
    const m = acharModulo(id);
    if (!m) return `Contexto: o usuário abriu a Via pelo ${nomeModulo(id)}.`;
    if (m.pessoal) return `Contexto: o usuário abriu a Via pelo módulo «${m.nome}» (id ${m.id}). São dados de pessoas: para ver os números use ler_estado_modulo (o usuário precisa permitir).`;
    const est = await m.estado();
    return `Contexto: o usuário abriu a Via pelo módulo «${m.nome}» (id ${m.id}). Estado atual do painel (só números): ${JSON.stringify(est).slice(0, 6000)}`;
  } catch (e) {
    return `Contexto: o usuário abriu a Via pelo ${nomeModulo(id)} (estado indisponível: ${e.message}).`;
  }
}

// ------------------------------------------------------------------ cartão de configuração

const fmtV = (v) => (v === undefined || v === null ? '—' : typeof v === 'boolean' ? (v ? 'sim' : 'não') : typeof v === 'object' ? JSON.stringify(v) : String(v));

function CartaoConfigModulo({ item, atualizar }) {
  const c = item.cartao;
  const [ocupado, setOcupado] = useState(false);
  const marcar = (s) => { item.status = s; atualizar(); };
  return html`
    <div class="via-cartao" data-cartao="config-modulo">
      <div class="via-cartao-t"><span class="via-tag">configurar</span> <b>${c.nome}</b></div>
      ${c.explicacao && html`<p class="via-cartao-x">${c.explicacao}</p>`}
      <table class="via-diff">
        <thead><tr><th>Parâmetro</th><th>Atual</th><th>Proposto</th></tr></thead>
        <tbody>${c.linhas.map((l) => html`<tr key=${l.chave}><td title=${l.chave}>${l.rotulo}</td><td>${fmtV(l.antes)}</td><td><b>${fmtV(l.depois)}</b></td></tr>`)}</tbody>
      </table>
      ${!item.status && html`
        <div class="via-cartao-acts">
          <button class="btn tiny accent" disabled=${ocupado} onClick=${async () => {
            setOcupado(true);
            try {
              const { acharModulo } = await carregarModulos();
              const r = await acharModulo(c.modulo).aplicar(c.mudancas);
              marcar('✓ aplicado' + (r ? ` — ${r}` : ''));
              if (item.comandoId) import('./servidor.js').then((s) => s.marcarComando(item.comandoId, { aplicado: true })).catch(() => {});
            } catch (e) { marcar('⚠ não aplicou: ' + e.message); } finally { setOcupado(false); }
          }}>Aplicar</button>
          <button class="btn tiny" onClick=${() => marcar('descartado')}>Agora não</button>
        </div>`}
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>`;
}
registrarCartao('config-modulo', CartaoConfigModulo);
