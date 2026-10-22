/**
 * via/ferramentas-motion3d.js — a Via GERA para o Motion 3D Studio (CV-88).
 *
 *   listar_tomadas_motion3d     o Content Browser (metadados; nunca a trilha)
 *   gerar_animacao_motion3d     texto → KEYFRAMES por junta (saída estruturada) → tomada normal (33 × 3 a 30 fps)
 *                               com validação física (components/motion3d/via-motion.js)
 *   encadear_tomadas_motion3d   coreografia: tomadas existentes com transição suave (blend)
 *   ajustar_tomada_motion3d     cortar, velocidade, espelhar, girar membro… numa CÓPIA
 *   propor_config_motion3d      perfil de retarget (Mixamo/UE5/Rigify, escala), visualização e captura
 *   analisar_tomada_motion3d    números para a Via comentar (ângulos, simetria, ritmo) + aviso educacional
 *
 * A IA PROPÕE, O HUMANO CONFIRMA: toda tomada nova chega como CARTÃO com prévia, física e os
 * botões Salvar no Content Browser / Abrir no Studio / Salvar na biblioteca / Exportar BVH.
 * Nada é gravado sem clique. Tomadas CAPTURADAS de uma pessoa só vão para a análise com permissão.
 *
 * A matemática (e o three.js do Studio) só carrega quando uma destas ferramentas roda.
 */
import { html, useState, useEffect, useRef } from '../vendor.js';
import { registrarCartao, registrarAplicador } from './cartoes.js';
import { store } from '../state/store.js';
import { salvarComando, listarCategorias, criarCategoria } from './comandos.js';
import { usuarioAtual } from './base.js';

const motor = () => import('../components/motion3d/via-motion.js');
const armazem = () => import('../cv/runtime/livres-v/armazem.js');
class Invalido extends Error {}
const txt = (v) => typeof v === 'string';
const SINTETICAS = ['via', 'demonstracao'];

/** É dado de uma pessoa? (capturada ou importada; as geradas e a demonstração não são) */
const dePessoa = (t) => !SINTETICAS.includes(t.origem);

async function lerTomada(id) {
  const { ponteMotion } = await motor();
  const p = ponteMotion();
  if (!id && p && p.play && p.play.current) return p.play.current.tomada;
  if (!id) throw new Invalido('diga qual tomada (tomada_id de listar_tomadas_motion3d) — não há tomada aberta no Studio.');
  const mem = p && p.naoSalvas && p.naoSalvas.current && p.naoSalvas.current.get(id);
  if (mem) return mem;
  if (p && p.play && p.play.current && p.play.current.tomada.id === id) return p.play.current.tomada;
  const a = await armazem();
  const t = await a.ler(id);
  if (!t) throw new Invalido(`tomada ${JSON.stringify(id)} não encontrada. Use listar_tomadas_motion3d.`);
  return t;
}

// ------------------------------------------------------------------ esquema dos keyframes
const ESQ_JUNTAS = {
  type: 'object',
  description: 'ângulos em GRAUS só das juntas que mudam neste keyframe (as outras herdam o keyframe anterior; no começo, 0 = em pé, braços ao lado do corpo)',
  properties: {
    tronco_flexao: { type: 'number', description: '−30…90; + para a frente' }, tronco_inclinacao: { type: 'number', description: '−35…35; + para a esquerda' },
    tronco_rotacao: { type: 'number', description: '−45…45; + para a esquerda' }, cabeca_flexao: { type: 'number', description: '−50…60' }, cabeca_rotacao: { type: 'number', description: '−70…70' },
    ombro_esq_flexao: { type: 'number', description: '−50…180; 90 = braço à frente, 180 = acima da cabeça' }, ombro_esq_abducao: { type: 'number', description: '−10…180; 90 = braço na horizontal para o lado' },
    ombro_esq_rotacao: { type: 'number', description: '−90…90' }, cotovelo_esq: { type: 'number', description: '0…150; 0 = esticado' }, punho_esq: { type: 'number', description: '−70…70' },
    ombro_dir_flexao: { type: 'number' }, ombro_dir_abducao: { type: 'number' }, ombro_dir_rotacao: { type: 'number' }, cotovelo_dir: { type: 'number' }, punho_dir: { type: 'number' },
    quadril_esq_flexao: { type: 'number', description: '−30…125; + coxa para a frente' }, quadril_esq_abducao: { type: 'number', description: '−20…50' }, quadril_esq_rotacao: { type: 'number', description: '−45…45' },
    joelho_esq: { type: 'number', description: '0…150; 0 = esticado' }, tornozelo_esq: { type: 'number', description: '−50…30; − = na ponta do pé' },
    quadril_dir_flexao: { type: 'number' }, quadril_dir_abducao: { type: 'number' }, quadril_dir_rotacao: { type: 'number' }, joelho_dir: { type: 'number' }, tornozelo_dir: { type: 'number' },
  },
  additionalProperties: false,
};

export const FERRAMENTAS_MOTION3D = [
  {
    def: {
      name: 'listar_tomadas_motion3d',
      description: 'Lista as tomadas do Content Browser do Motion 3D Studio (deste navegador): id, nome, quadros, duração, fps, origem e se é dado de uma pessoa. Use antes de encadear, ajustar ou analisar.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    validar: () => null,
    executar: async () => {
      const [{ ponteMotion }, a, { ORIGENS }] = await Promise.all([motor(), armazem(), import('../cv/runtime/livres-v/tomada.js')]);
      let salvas = []; try { salvas = await a.listar(); } catch (_) { salvas = []; }
      const p = ponteMotion();
      const mem = p && p.naoSalvas && p.naoSalvas.current ? [...p.naoSalvas.current.values()].map((t) => ({ ...t, quadros: t.trilha.length, naoSalva: true })) : [];
      const ids = new Set(mem.map((t) => t.id));
      const todas = [...mem, ...salvas.filter((t) => !ids.has(t.id))];
      const aberta = p && p.play && p.play.current ? p.play.current.tomada.id : null;
      return {
        studio_aberto: Boolean(p), tomada_aberta: aberta,
        tomadas: todas.slice(0, 60).map((t) => ({ id: t.id, nome: t.nome, quadros: t.quadros, fps: t.fps, duracao_s: Math.round((t.quadros / (t.fps || 30)) * 10) / 10,
          origem: (ORIGENS[t.origem] || {}).rotulo || t.origem, dado_de_pessoa: dePessoa(t), salva: !t.naoSalva, gerada_pela_via: Boolean(t.via) })),
      };
    },
  },
  {
    def: {
      name: 'gerar_animacao_motion3d',
      description: 'Gera uma ANIMAÇÃO para o Motion 3D Studio a partir de keyframes de ângulos por junta (graus) no tempo (s). O Studio interpola (30 fps), monta o esqueleto padrão (ossos rígidos), põe os pés no chão e valida a física: ângulo pouco fora do limite é corrigido e avisado; impossível (fora do limite, salto de pose instantâneo, raiz voando) volta como erro para você corrigir e chamar de novo. Vira um CARTÃO com prévia e Salvar/Abrir no Studio — nada é salvo sem o clique. Convenções: +x = esquerda da pessoa, frente = +z; pose 0 = em pé, braços ao lado do corpo. Para andar, mexa as pernas (ancoragem «pes»: o pé de apoio prende no chão e o corpo anda) ou use raiz.x/z (ancoragem «raiz»); para girar use raiz.giro; para saltar, raiz.elevacao (m) com a gravidade em mente (h ≈ 1,23·T² para T segundos no ar). Ritmo musical: 8 tempos a 120 bpm = 4 s.',
      input_schema: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'curto, sem espaços (ex.: Acenar_e_pular)' },
          descricao: { type: 'string', description: 'o pedido do usuário, em uma frase' },
          duracao_s: { type: 'number', description: 'duração total (s), até 60' },
          loop: { type: 'boolean', description: 'true se a animação deve repetir sem emenda (o fim volta ao começo)' },
          interpolacao: { type: 'string', enum: ['suave', 'linear'] },
          contato: { type: 'string', enum: ['chao', 'livre'], description: 'chao (padrão): o pé mais baixo toca o piso; livre: usa raiz.altura_quadril' },
          ancoragem: { type: 'string', enum: ['pes', 'raiz'], description: 'pes: o pé de apoio fica preso no chão; raiz: o corpo segue raiz.x/z' },
          keyframes: {
            type: 'array', description: 'em ordem de tempo; o primeiro em t = 0; 2 a 240',
            items: {
              type: 'object',
              properties: {
                t: { type: 'number', description: 'segundos' },
                juntas: ESQ_JUNTAS,
                raiz: { type: 'object', properties: { x: { type: 'number', description: 'm, + esquerda' }, z: { type: 'number', description: 'm, + frente' }, giro: { type: 'number', description: 'graus em torno da vertical, + para a esquerda' }, elevacao: { type: 'number', description: 'm acima do apoio (salto), 0–1,2' }, altura_quadril: { type: 'number', description: 'só com contato livre' } }, additionalProperties: false },
              },
              required: ['t'],
              additionalProperties: false,
            },
          },
        },
        required: ['nome', 'duracao_s', 'keyframes'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      if (!txt(i.nome)) throw new Invalido('nome precisa ser texto.');
      if (!Array.isArray(i.keyframes)) throw new Invalido('keyframes precisa ser uma lista.');
    },
    executar: async (i, ui) => {
      const V = await motor();
      const r = V.gerarTomada(i);
      if (!r.ok) {
        return { conteudo: JSON.stringify({ REJEITADA: 'A animação não passou na validação física. Corrija e chame gerar_animacao_motion3d de novo.', erros: r.erros, correcoes_que_seriam_feitas: r.correcoes,
          juntas_validas: V.NOMES_JUNTAS, limites: Object.fromEntries(Object.entries(V.JUNTAS).map(([k, l]) => [k, [l.min, l.max]])) }), erro: true };
      }
      r.tomada.thumb = V.miniatura(r.tomada.trilha);
      ui.mostrarCartao({ tipo: 'motion3d-tomada', subtipo: 'animacao', tomada: r.tomada, fisica: r.fisica, correcoes: r.correcoes, avisos: r.avisos, explicacao: i.descricao || '',
        comando: { op: 'motion3d.via', parametro: 'animacao', valor: JSON.stringify(i) } });
      return { cartao: 'mostrado (ainda NÃO salvo: o usuário decide)', nome: r.tomada.nome, fisica: r.fisica, correcoes: r.correcoes, avisos: r.avisos };
    },
  },
  {
    def: {
      name: 'encadear_tomadas_motion3d',
      description: 'Monta uma COREOGRAFIA/sequência encadeando tomadas existentes (ids de listar_tomadas_motion3d), cada uma com trecho opcional (ini_s/fim_s) e repetições, com transição suave (blend) entre elas. Vira um CARTÃO com prévia; só é salva com o clique.',
      input_schema: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          transicao_s: { type: 'number', description: '0 a 2 s (padrão 0,5)' },
          itens: { type: 'array', items: { type: 'object', properties: { tomada_id: { type: 'string' }, ini_s: { type: 'number' }, fim_s: { type: 'number' }, repetir: { type: 'integer' } }, required: ['tomada_id'], additionalProperties: false } },
          explicacao: { type: 'string' },
        },
        required: ['nome', 'itens'],
        additionalProperties: false,
      },
    },
    validar: (i) => {
      if (!Array.isArray(i.itens) || i.itens.length < 2 || i.itens.length > 20) throw new Invalido('itens: de 2 a 20 trechos.');
      for (const it of i.itens) if (!it || !txt(it.tomada_id)) throw new Invalido('cada item precisa de tomada_id.');
    },
    executar: async (i, ui) => {
      const V = await motor();
      const itens = [];
      for (const it of i.itens) itens.push({ ...it, tomada: await lerTomada(it.tomada_id) });
      const r = V.encadear(itens, i.transicao_s ?? 0.5, i.nome);
      if (!r.ok) return { conteudo: JSON.stringify({ REJEITADA: r.erros }), erro: true };
      r.tomada.thumb = V.miniatura(r.tomada.trilha);
      ui.mostrarCartao({ tipo: 'motion3d-tomada', subtipo: 'coreografia', tomada: r.tomada, fisica: r.resumo, correcoes: [], avisos: [], explicacao: i.explicacao || '',
        comando: { op: 'motion3d.via', parametro: 'coreografia', valor: JSON.stringify({ nome: i.nome, transicao_s: i.transicao_s ?? 0.5, itens: i.itens }) } });
      return { cartao: 'mostrado (ainda NÃO salvo)', ...r.resumo };
    },
  },
  {
    def: {
      name: 'ajustar_tomada_motion3d',
      description: 'Ajusta uma tomada numa CÓPIA (a original não muda): cortar {ini_s, fim_s}, velocidade {fator 0,25–4; 0,5 = 2× mais lento}, espelhar {}, girar_membro {membro: braco_esq|braco_dir|antebraco_esq|antebraco_dir|perna_esq|perna_dir|tronco|cabeca, graus −90…90, direcao: cima|frente|fora} (ex.: «braço esquerdo mais alto» = girar_membro braco_esq 20 cima), deslocar {x,y,z m}, suavizar {intensidade 1–5}, repetir {vezes 2–10}, inverter {}, apoiar_no_chao {}. Sem tomada_id usa a tomada aberta no Studio. Vira CARTÃO; só salva com o clique.',
      input_schema: {
        type: 'object',
        properties: {
          tomada_id: { type: 'string' },
          operacoes: { type: 'array', items: { type: 'object', properties: {
            tipo: { type: 'string', enum: ['cortar', 'velocidade', 'espelhar', 'girar_membro', 'deslocar', 'suavizar', 'repetir', 'inverter', 'apoiar_no_chao'] },
            ini_s: { type: 'number' }, fim_s: { type: 'number' }, fator: { type: 'number' }, membro: { type: 'string' }, graus: { type: 'number' },
            direcao: { type: 'string', enum: ['cima', 'frente', 'fora'] }, x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, intensidade: { type: 'number' }, vezes: { type: 'integer' },
          }, required: ['tipo'], additionalProperties: false } },
          explicacao: { type: 'string' },
        },
        required: ['operacoes'],
        additionalProperties: false,
      },
    },
    validar: (i) => { if (!Array.isArray(i.operacoes)) throw new Invalido('operacoes precisa ser uma lista.'); if (i.tomada_id != null && !txt(i.tomada_id)) throw new Invalido('tomada_id precisa ser texto.'); },
    executar: async (i, ui) => {
      const V = await motor();
      const erros = V.validarAjustes(i.operacoes);
      if (erros.length) throw new Invalido(erros.join(' '));
      const t = await lerTomada(i.tomada_id);
      const r = V.ajustar(t, i.operacoes);
      r.tomada.thumb = V.miniatura(r.tomada.trilha);
      ui.mostrarCartao({ tipo: 'motion3d-tomada', subtipo: 'ajuste', tomada: r.tomada, fisica: { quadros: r.tomada.trilha.length, duracao_s: Math.round(((r.tomada.trilha.length - 1) / r.tomada.fps) * 100) / 100, de: t.nome },
        correcoes: [], avisos: r.notas, explicacao: i.explicacao || '', comando: { op: 'motion3d.via', parametro: 'ajuste', valor: JSON.stringify({ tomada_id: t.id, operacoes: i.operacoes }) } });
      return { cartao: 'mostrado (cópia ajustada, ainda NÃO salva)', de: t.nome, notas: r.notas, quadros: r.tomada.trilha.length };
    },
  },
  {
    def: {
      name: 'propor_config_motion3d',
      description: 'Propõe configurações do Motion 3D Studio a partir de uma descrição: perfil_retarget (nomes dos ossos do BVH para Mixamo, UE5, Rigify ou nomes próprios; escala cm ou m), visualizacao (avatar capsulas|manequim|nenhum, esqueleto, grade, piso, nomes, retarget, com, cameras, chao, borrar, maos) e captura (parâmetros do nó motion3d.captura: espelhada, minVis, detectarMs, everyMs, suavizar, minCorte, beta). Vira CARTÃO; nada muda sem o clique.',
      input_schema: {
        type: 'object',
        properties: {
          explicacao: { type: 'string' },
          perfil_retarget: { type: 'object', properties: { nome: { type: 'string' }, base: { type: 'string', enum: ['robo15', 'mixamo', 'ue5', 'rigify'] }, escala: { type: 'string', enum: ['cm', 'm'] },
            nomes: { type: 'object', description: 'junta do BVH (Hips, Spine, Neck, LeftArm, LeftForeArm, LeftHand, RightArm, RightForeArm, RightHand, LeftUpLeg, LeftLeg, LeftFoot, RightUpLeg, RightLeg, RightFoot) → nome no rig de destino' },
            descricao: { type: 'string' } }, additionalProperties: false },
          visualizacao: { type: 'object', properties: { avatar: { type: 'string', enum: ['capsulas', 'manequim', 'nenhum'] }, esqueleto: { type: 'boolean' }, grade: { type: 'boolean' }, piso: { type: 'boolean' },
            nomes: { type: 'boolean' }, retarget: { type: 'boolean' }, com: { type: 'boolean' }, cameras: { type: 'boolean' }, chao: { type: 'boolean' }, borrar: { type: 'boolean' }, maos: { type: 'boolean' } }, additionalProperties: false },
          captura: { type: 'object', description: 'parâmetros do nó motion3d.captura' },
        },
        required: ['explicacao'],
        additionalProperties: false,
      },
    },
    validar: (i) => { if (!i.perfil_retarget && !i.visualizacao && !i.captura) throw new Invalido('mande perfil_retarget, visualizacao e/ou captura.'); },
    executar: async (i, ui) => {
      const V = await motor();
      const c = { tipo: 'motion3d-config', explicacao: i.explicacao };
      if (i.perfil_retarget) {
        const { perfil, erros } = V.normalizarPerfil(i.perfil_retarget);
        if (erros.length) throw new Invalido(erros.join(' '));
        c.perfil = perfil;
      }
      if (i.visualizacao) c.visualizacao = i.visualizacao;
      if (i.captura) {
        const { acharModulo } = await import('./modulos-via.js');
        const { conferirMudancas } = await import('./ferramentas-modulos.js');
        const m = acharModulo('motion3d');
        const esquema = await m.config();
        const mud = Object.fromEntries(Object.entries(i.captura).map(([k, v]) => [k.startsWith('motion3d.captura.') ? k : `motion3d.captura.${k}`, v]));
        try { c.captura = conferirMudancas(esquema, mud); } catch (e) { throw new Invalido(e.message); }
      }
      c.comando = { op: 'motion3d.via', parametro: c.perfil ? 'perfil' : 'config', valor: JSON.stringify({ perfil_retarget: c.perfil || undefined, visualizacao: i.visualizacao, captura: c.captura && c.captura.limpas }) };
      ui.mostrarCartao(c);
      return 'Cartão mostrado. Nada foi aplicado: o usuário decide.';
    },
  },
  {
    def: {
      name: 'analisar_tomada_motion3d',
      description: 'Analisa uma tomada (sem tomada_id: a aberta no Studio): amplitude dos ângulos (joelho, cotovelo, quadril, ombro), simetria esquerda × direita, ritmo (período por autocorrelação), trajetória do quadril e tempo no ar. Tomadas capturadas de uma pessoa pedem permissão. Comente com o aviso educacional (não é laudo).',
      input_schema: { type: 'object', properties: { tomada_id: { type: 'string' }, motivo: { type: 'string' } }, additionalProperties: false },
    },
    validar: (i) => { if (i.tomada_id != null && !txt(i.tomada_id)) throw new Invalido('tomada_id precisa ser texto.'); },
    executar: async (i, ui) => {
      const V = await motor();
      const t = await lerTomada(i.tomada_id);
      if (dePessoa(t)) {
        const ok = ui && ui.pedirPermissaoDados ? await ui.pedirPermissaoDados({ id: 'motion3d', nome: `Motion 3D · ${t.nome}` }, i.motivo || 'analisar os ângulos e o ritmo desta tomada') : false;
        if (!ok) return { conteudo: 'O usuário não permitiu enviar os números desta tomada (movimento de uma pessoa). Siga sem eles.' };
      }
      return V.analisar(t);
    },
  },
];

// ------------------------------------------------------------------ ações dos cartões

function baixar(conteudo, nome, tipo = 'text/plain') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Grava no IndexedDB (Content Browser) e avisa o Studio, se aberto. */
export async function salvarNoContentBrowser(t, { abrir = false } = {}) {
  const [a, V] = await Promise.all([armazem(), motor()]);
  await a.salvar(t);
  const carregarNoStudio = async (p) => { await p.recarregarLista(); if (abrir) await p.carregar({ id: t.id }); };
  if (abrir && !store.get().studioMotion3D) store.set({ studioMotion3D: true });
  if (V.ponteMotion() || abrir) V.quandoStudio((p) => { carregarNoStudio(p); });
  return t;
}

function categoriaMotion() {
  const c = listarCategorias().find((x) => x.id === 'motion3d' || x.nome === 'Motion 3D');
  return c ? c.id : criarCategoria('Motion 3D').id;
}
function salvarNaBiblioteca(nome, cmd, descricao) {
  return salvarComando({ nome: String(nome).slice(0, 80), op: cmd.op, parametro: cmd.parametro, valor: cmd.valor, categoria: categoriaMotion(), descricao: String(descricao || '').slice(0, 400), origem: 'via' });
}

/** Prévia animada SÓ enquanto o usuário pede (▶): sem laço com o cartão parado. */
function Previa({ trilha, fps }) {
  const cv = useRef(null);
  const [tocando, setTocando] = useState(false);
  const [q, setQ] = useState(Math.floor(trilha.length / 2));
  useEffect(() => {
    let vivo = true;
    motor().then((V) => { if (vivo && cv.current) { const est = getComputedStyle(cv.current); V.desenharQuadro(cv.current.getContext('2d'), trilha, q, cv.current.width, cv.current.height, est.getPropertyValue('--accent').trim() || '#2EF2D0', est.getPropertyValue('--via-previa-fundo').trim() || '#0b1416'); } });
    return () => { vivo = false; };
  }, [q, trilha]);
  useEffect(() => {
    if (!tocando) return undefined;
    let id = 0, t0 = performance.now(), q0 = q;
    const passo = (agora) => {
      const n = q0 + Math.floor(((agora - t0) / 1000) * fps);
      if (n >= trilha.length) { setQ(trilha.length - 1); setTocando(false); return; }
      setQ(n); id = requestAnimationFrame(passo);
    };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, [tocando]);
  return html`<div class="via-m3d-previa">
    <canvas ref=${cv} width="240" height="150" aria-label="Prévia da animação (esqueleto de frente)"></canvas>
    <div class="via-m3d-ctl">
      <button class="btn tiny" onClick=${() => { if (!tocando && q >= trilha.length - 1) setQ(0); setTocando(!tocando); }} aria-label=${tocando ? 'Pausar prévia' : 'Tocar prévia'}>${tocando ? '❚❚' : '▶'}</button>
      <input type="range" min="0" max=${trilha.length - 1} value=${q} aria-label="Quadro da prévia" onInput=${(e) => { setTocando(false); setQ(+e.target.value); }} />
      <small>${(q / fps).toFixed(2)} s</small>
    </div>
  </div>`;
}

const ROT_SUB = { animacao: 'animação', coreografia: 'coreografia', ajuste: 'ajuste' };

function CartaoTomada({ item, atualizar }) {
  const c = item.cartao, t = c.tomada;
  const [ocupado, setOcupado] = useState(false);
  const marcar = (s) => { item.status = s; atualizar(); };
  const acao = async (fn) => { setOcupado(true); try { await fn(); } catch (e) { marcar('⚠ ' + e.message); } finally { setOcupado(false); } };
  const f = c.fisica || {};
  return html`
    <div class="via-cartao via-m3d" data-cartao="motion3d-tomada">
      <div class="via-cartao-t"><span class="via-tag">Motion 3D · ${ROT_SUB[c.subtipo] || c.subtipo}</span> <b>${t.nome}</b></div>
      ${c.explicacao && html`<p class="via-cartao-x">${c.explicacao}</p>`}
      <${Previa} trilha=${t.trilha} fps=${t.fps} />
      <dl class="via-params">
        <dt>quadros</dt><dd>${t.trilha.length} a ${t.fps} fps (${((t.trilha.length - 1) / t.fps).toFixed(2)} s)</dd>
        ${f.ossos_rigidos_desvio_max_mm != null && html`<dt>ossos</dt><dd>rígidos (desvio máx. ${f.ossos_rigidos_desvio_max_mm} mm)</dd>`}
        ${f.pes_no_chao_pct != null && html`<dt>pés no chão</dt><dd>${f.pes_no_chao_pct} % dos quadros · altura máx. dos pés ${f.altura_max_pes_cm} cm</dd>`}
        ${f.transicoes != null && html`<dt>trechos</dt><dd>${f.trechos} · ${f.transicoes} transição(ões) suaves</dd>`}
        ${f.de && html`<dt>de</dt><dd>${f.de} (a original não muda)</dd>`}
      </dl>
      ${(c.correcoes || []).length > 0 && html`<ul class="via-m3d-lista corr">${c.correcoes.map((x, i) => html`<li key=${i}>corrigido: ${x}</li>`)}</ul>`}
      ${(c.avisos || []).length > 0 && html`<ul class="via-m3d-lista">${c.avisos.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul>`}
      <p class="hint tight">${t.origem === 'via' ? 'Dado sintético gerado por IA (não é captura). ' : ''}Fica só neste navegador (IndexedDB), como as outras tomadas.</p>
      <div class="via-cartao-acts">
        <button class="btn tiny accent" disabled=${ocupado || item.salva} onClick=${() => acao(async () => { await salvarNoContentBrowser(t); item.salva = true; marcar('✓ salva no Content Browser'); })}>Salvar no Content Browser</button>
        <button class="btn tiny" disabled=${ocupado} onClick=${() => acao(async () => { await salvarNoContentBrowser(t, { abrir: true }); item.salva = true; marcar('✓ salva e aberta no Motion 3D Studio'); })}>Abrir no Studio</button>
        <button class="btn tiny" disabled=${ocupado} onClick=${() => acao(async () => { salvarNaBiblioteca(t.nome, c.comando, c.explicacao || c.subtipo); marcar('✓ guardada na biblioteca da Via (Comandos › Motion 3D)'); if (item.comandoId) import('./servidor.js').then((s) => s.marcarComando(item.comandoId, { salvo: true })).catch(() => {}); })}>Salvar na biblioteca</button>
        <button class="btn tiny" disabled=${ocupado} onClick=${() => acao(async () => { const T = await import('../cv/runtime/livres-v/tomada.js'); baixar(T.exportarRobo(t, 'bvh'), `${t.nome}.bvh`); marcar('✓ BVH exportado'); })}>Exportar BVH</button>
      </div>
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>`;
}
registrarCartao('motion3d-tomada', CartaoTomada);

// ------------------------------------------------------------------ perfis de retarget (por usuário, neste navegador)
const CHAVE_PERFIS = () => `aiv.motion3d.perfis:${usuarioAtual()}`;
export function listarPerfis() { try { const v = JSON.parse(localStorage.getItem(CHAVE_PERFIS()) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
export function salvarPerfil(p) {
  const l = listarPerfis().filter((x) => x.nome !== p.nome);
  l.unshift({ ...p, salvoEm: new Date().toISOString() });
  try { localStorage.setItem(CHAVE_PERFIS(), JSON.stringify(l.slice(0, 30))); } catch (_) { throw new Error('não consegui gravar neste navegador'); }
}

function CartaoConfig({ item, atualizar }) {
  const c = item.cartao;
  const marcar = (s) => { item.status = s; atualizar(); };
  const [st, setSt] = useState({});
  const feito = (k, s) => { setSt({ ...st, [k]: s }); };
  const p = c.perfil;
  const exportarComPerfil = async () => {
    const V = await motor();
    const pt = V.ponteMotion();
    const t = pt && pt.play && pt.play.current && pt.play.current.tomada;
    if (!t) { feito('bvh', '⚠ abra uma tomada no Studio primeiro'); return; }
    const T = await import('../cv/runtime/livres-v/tomada.js');
    baixar(V.aplicarPerfilBVH(T.exportarRobo(t, 'bvh'), p), `${t.nome}_${p.base}.bvh`);
    feito('bvh', `✓ ${t.nome}.bvh com o perfil «${p.nome}»`);
  };
  return html`
    <div class="via-cartao via-m3d" data-cartao="motion3d-config">
      <div class="via-cartao-t"><span class="via-tag">Motion 3D · configuração</span></div>
      ${c.explicacao && html`<p class="via-cartao-x">${c.explicacao}</p>`}
      ${p && html`
        <div class="cfg-sub">Perfil de retarget: <b>${p.nome}</b> (${p.base}, ${p.escala})</div>
        <table class="via-diff"><tbody>${Object.entries(p.nomes).filter(([k, v]) => k !== v).slice(0, 15).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td>→ <b>${v}</b></td></tr>`)}</tbody></table>
        <div class="via-cartao-acts">
          <button class="btn tiny accent" onClick=${() => { try { salvarPerfil(p); feito('perfil', '✓ perfil salvo neste navegador'); } catch (e) { feito('perfil', '⚠ ' + e.message); } }}>Salvar perfil</button>
          <button class="btn tiny" onClick=${exportarComPerfil}>Exportar BVH da tomada aberta</button>
        </div>
        ${(st.perfil || st.bvh) && html`<p class="via-cartao-st" role="status">${st.perfil || ''} ${st.bvh || ''}</p>`}`}
      ${c.visualizacao && html`
        <div class="cfg-sub">Visualização</div>
        <dl class="via-params">${Object.entries(c.visualizacao).map(([k, v]) => html`<dt key=${'k' + k}>${k}</dt><dd key=${'v' + k}>${String(v)}</dd>`)}</dl>
        <div class="via-cartao-acts"><button class="btn tiny accent" onClick=${async () => {
          const V = await motor();
          if (!store.get().studioMotion3D) store.set({ studioMotion3D: true });
          V.quandoStudio((pt) => pt.setOpc((o) => ({ ...o, ...c.visualizacao })));
          feito('vis', '✓ aplicada no Studio');
        }}>Aplicar no Studio</button></div>
        ${st.vis && html`<p class="via-cartao-st" role="status">${st.vis}</p>`}`}
      ${c.captura && c.captura.linhas.length > 0 && html`
        <div class="cfg-sub">Captura (motion3d.captura)</div>
        <table class="via-diff"><thead><tr><th>Parâmetro</th><th>Atual</th><th>Proposto</th></tr></thead>
          <tbody>${c.captura.linhas.map((l) => html`<tr key=${l.chave}><td>${l.rotulo}</td><td>${String(l.antes)}</td><td><b>${String(l.depois)}</b></td></tr>`)}</tbody></table>
        <div class="via-cartao-acts"><button class="btn tiny accent" onClick=${async () => {
          const { acharModulo } = await import('./modulos-via.js');
          feito('cap', '✓ ' + (await acharModulo('motion3d').aplicar(c.captura.limpas)));
        }}>Aplicar na captura</button></div>
        ${st.cap && html`<p class="via-cartao-st" role="status">${st.cap}</p>`}`}
      <div class="via-cartao-acts">
        <button class="btn tiny" onClick=${() => { salvarNaBiblioteca(p ? `Perfil ${p.nome}` : 'Config Motion 3D', c.comando, c.explicacao); marcar('✓ guardado na biblioteca da Via'); }}>Salvar na biblioteca</button>
      </div>
      ${item.status && html`<p class="via-cartao-st" role="status">${item.status}</p>`}
    </div>`;
}
registrarCartao('motion3d-config', CartaoConfig);

// ------------------------------------------------------------------ biblioteca: «Gerar no Studio»
registrarAplicador({
  prefixo: 'motion3d.via',
  rotulo: (c) => (c.parametro === 'perfil' || c.parametro === 'config' ? 'Salvar perfil' : 'Gerar no Studio'),
  aplicar: async (c) => {
    const V = await motor();
    const v = JSON.parse(c.valor);
    if (c.parametro === 'animacao') {
      const r = V.gerarTomada(v);
      if (!r.ok) throw new Error(r.erros[0]);
      r.tomada.thumb = V.miniatura(r.tomada.trilha);
      await salvarNoContentBrowser(r.tomada, { abrir: true });
      return `${r.tomada.nome} gerada e aberta no Motion 3D Studio.`;
    }
    if (c.parametro === 'coreografia') {
      const itens = [];
      for (const it of v.itens) itens.push({ ...it, tomada: await lerTomada(it.tomada_id) });
      const r = V.encadear(itens, v.transicao_s, v.nome);
      if (!r.ok) throw new Error(r.erros[0]);
      r.tomada.thumb = V.miniatura(r.tomada.trilha);
      await salvarNoContentBrowser(r.tomada, { abrir: true });
      return `${r.tomada.nome} montada e aberta no Studio.`;
    }
    if (c.parametro === 'ajuste') {
      const r = V.ajustar(await lerTomada(v.tomada_id), v.operacoes);
      r.tomada.thumb = V.miniatura(r.tomada.trilha);
      await salvarNoContentBrowser(r.tomada, { abrir: true });
      return `${r.tomada.nome} criada e aberta no Studio.`;
    }
    if (v.perfil_retarget) { salvarPerfil(v.perfil_retarget); return `Perfil «${v.perfil_retarget.nome}» salvo.`; }
    return 'Nada a aplicar.';
  },
});
