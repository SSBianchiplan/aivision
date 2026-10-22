/**
 * cv/executor.js — executa o pipeline sobre um frame.
 *
 * Contraparte no cliente do backend/app/cv/executor.py. No protótipo o
 * pipeline é uma CADEIA LINEAR (caso degenerado do DAG do SPEC §5.2);
 * a serialização já sai no formato de grafo com nodes/edges, então o
 * backend consome sem tradução.
 *
 * Regras:
 *  - operador nunca muta o `src` que recebe
 *  - buffer intermediário volta pro pool assim que deixa de ser usado
 *  - operador que estoura é DESLIGADO, não derruba o pipeline
 */

import { free, clone } from './core.js';
import { getOperator, coerceParams } from './registry.js';
import { store } from '../state/store.js';
import { aplicarMascara } from './marcacoes.js';

export class PipelineExecutor {
  constructor() {
    /** state por id de nó, preservado entre frames (ver operators/motion.js) */
    this.states = new Map();
    this.lastError = null;
  }

  /** Descarta o estado temporal de um nó (ou de todos). */
  resetState(nodeId) {
    if (nodeId) this.states.delete(nodeId);
    else this.states.clear();
  }

  /**
   * @param {ImageData} frame  entrada (não é mutada nem liberada)
   * @param {Array}     nodes  [{ id, op, params, enabled }]
   * @param {number}    frameIndex
   * @param {Object}    extra  recursos opcionais do hospedeiro (ex.: grabFull)
   * @returns {{ image: ImageData, overlay: Array, metrics: Object, timings: Array }}
   */
  run(frame, nodes, frameIndex, extra) {
    const ctx = {
      w: frame.width,
      h: frame.height,
      overlay: [],
      metrics: {},
      frameIndex,
      /*
       * grabFull(maxW) devolve o quadro em resolução plena, ou null quando o
       * hospedeiro não oferece (teste headless, por exemplo). Operador que
       * usa isto TEM que tratar o null caindo para `src` — é o que mantém o
       * executor testável fora do navegador.
       */
      grabFull: (extra && extra.grabFull) || null,
      /*
       * O quadro chega espelhado quando "Espelhar" está ligado (o Viewport
       * espelha ANTES de processar, para qualquer fonte). Quem depende de
       * esquerda/direita — lado da mão, lado do ciclista — lê daqui em vez
       * de pedir ao usuário um parâmetro que ele esquece de trocar.
       */
      mirrored: extra && typeof extra.mirrored === 'boolean' ? extra.mirrored : Boolean(store.get().mirror),
      /*
       * A fonte está parada (YouTube pausado, quadro do histórico repetido):
       * o quadro é o mesmo de antes. Ver cv/runtime/parado.js.
       */
      fonteParada: Boolean(extra && extra.fonteParada),
      /*
       * Marcações das Ferramentas de mouse no espaço DESTE quadro (ver
       * cv/marcacoes.js › paraQuadro): zonas, linhas, régua, a escala px→mm.
       * null quando não há nenhuma. Operadores leem daqui (CV-37 conta por
       * zona e linha; outros módulos podem usar as áreas e a escala).
       */
      marcacoes: (extra && extra.marcacoes) || null,
      roiAtiva: false,
    };

    let current = frame;
    let owned = false; // `current` saiu do pool e pode ser liberado?

    /*
     * ROI / EXCLUSÃO, antes da cadeia: o que está fora das ROIs (e dentro das
     * exclusões) vira preto numa CÓPIA do quadro. As coordenadas não mudam —
     * caixas e overlays continuam no lugar — e o custo é um `fill` por trecho
     * de linha (a máscara é rasterizada só quando as marcações ou o zoom mudam).
     * O grabFull (resolução plena sob demanda) recebe a mesma máscara.
     */
    const mq = ctx.marcacoes;
    if (mq && mq.roi) {
      const m = aplicarMascara(frame, mq);
      if (m) { current = m; owned = true; ctx.roiAtiva = true; }
      if (ctx.grabFull) {
        const grab = ctx.grabFull;
        ctx.grabFull = (maxW) => { const g = grab(maxW); return g ? aplicarMascara(g, mq, true) : g; };
      }
    }
    const timings = [];

    for (const node of nodes) {
      if (!node.enabled) continue;

      const def = getOperator(node.op);
      if (!def) {
        // ADR-4: nome fora da whitelist não executa
        timings.push({ id: node.id, op: node.op, ms: 0, error: 'operador não registrado' });
        continue;
      }

      let state = this.states.get(node.id);
      if (!state) this.states.set(node.id, (state = {}));

      const t0 = performance.now();
      try {
        const params = coerceParams(node.op, node.params);
        const next = def.apply(current, params, state, ctx);

        if (!next || next.width !== ctx.w || next.height !== ctx.h) {
          throw new Error('operador devolveu buffer de tamanho inválido');
        }
        if (owned && next !== current) free(current);
        current = next;
        owned = true;
        timings.push({ id: node.id, op: node.op, ms: performance.now() - t0 });
      } catch (err) {
        // falha isolada: desliga o nó e segue com o que já tem
        node.enabled = false;
        node.error = String(err && err.message ? err.message : err);
        this.lastError = { id: node.id, op: node.op, message: node.error };
        timings.push({ id: node.id, op: node.op, ms: performance.now() - t0, error: node.error });
      }
    }

    // o chamador é dono do resultado; se nada rodou, entrega uma cópia
    return {
      image: owned ? current : clone(current),
      overlay: ctx.overlay,
      metrics: ctx.metrics,
      timings,
    };
  }
}

/**
 * Serializa a cadeia no formato de grafo do SPEC §5.2 — o mesmo JSON que
 * POST /api/v1/pipelines/{id}/versions vai aceitar.
 */
export function toGraph(nodes, meta = {}) {
  const active = nodes.filter((n) => n.enabled);
  const chain = [
    { id: 'in', op: 'input.media' },
    ...active.map((n) => ({
      id: n.id,
      op: n.op,
      params: coerceParams(n.op, n.params),
    })),
    { id: 'out', op: 'output.annotate', params: { draw: ['bbox', 'label', 'point'] } },
  ];
  const edges = [];
  for (let i = 0; i < chain.length - 1; i++) {
    edges.push({ from: chain[i].id, to: chain[i + 1].id });
  }
  return {
    schema_version: '1.0',
    meta: { source: 'vlc-prototype', created_at: new Date().toISOString(), ...meta },
    nodes: chain,
    edges,
  };
}

/**
 * Lê de volta um grafo serializado. Rejeita operador fora da whitelist
 * em vez de confiar no arquivo — SPEC §5.2 invariante 3.
 */
export function fromGraph(graph) {
  if (!graph || !Array.isArray(graph.nodes)) throw new Error('grafo inválido: falta nodes[]');
  const out = [];
  const rejected = [];
  for (const n of graph.nodes) {
    if (!n.op || n.op.startsWith('input.') || n.op.startsWith('output.')) continue;
    if (!getOperator(n.op)) {
      rejected.push(n.op);
      continue;
    }
    out.push({
      id: n.id || newNodeId(),
      op: n.op,
      params: coerceParams(n.op, n.params),
      enabled: true,
    });
  }
  return { nodes: out, rejected };
}

let seq = 0;
export function newNodeId() {
  return 'n' + (++seq).toString(36) + Date.now().toString(36).slice(-3);
}
