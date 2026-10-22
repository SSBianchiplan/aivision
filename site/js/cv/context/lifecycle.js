/**
 * cv/context/lifecycle.js — máquina de estados de uma observação.
 *
 *   CAPTURED → RESOLVED → BOUND → IN_PROCESS → COMPLETED → ARCHIVED
 *                                      ⇅
 *                                  EXCEPTION
 *
 * POR QUE UMA MÁQUINA DE ESTADOS, E NÃO SÓ "roda o modelo e imprime".
 *
 * Descrever uma cena não é uma chamada — são quatro modelos, com tempos
 * diferentes, qualquer um podendo falhar. Sem estado explícito, o código vira
 * um encadeamento de `if (temIsso && temAquilo)` onde é impossível responder
 * a pergunta que o operador faz: «por que a descrição não saiu?».
 *
 * Com estados nomeados, cada observação sabe DIZER onde parou. E a
 * distinção entre RESOLVED e BOUND, que parece burocrática, é justamente onde
 * mora o valor: RESOLVED é ter quatro listas soltas; BOUND é saber que o
 * texto «SAÍDA» está DENTRO da caixa da porta. Sem esse passo, o sistema
 * lista coisas; com ele, entende a cena.
 *
 * EXCEPTION é bidirecional de propósito. Um modelo que falhou pode ser
 * tentado de novo sem jogar fora o trabalho dos outros três — o que importa
 * quando um deles leva dois segundos.
 */

export const STATE = {
  CAPTURED:   'CAPTURED',
  RESOLVED:   'RESOLVED',
  BOUND:      'BOUND',
  IN_PROCESS: 'IN_PROCESS',
  EXCEPTION:  'EXCEPTION',
  COMPLETED:  'COMPLETED',
  ARCHIVED:   'ARCHIVED',
};

/** Rótulo e cor de cada estado, para a UI não repetir esse mapeamento. */
export const STATE_META = {
  CAPTURED:   { label: 'Capturado',   short: 'CAP', color: '#8b8b93',
                desc: 'Frame congelado. Nenhum modelo rodou ainda.' },
  RESOLVED:   { label: 'Resolvido',   short: 'RES', color: '#38bdf8',
                desc: 'Os modelos responderam. Resultados ainda soltos.' },
  BOUND:      { label: 'Vinculado',   short: 'BND', color: '#22d3ee',
                desc: 'Texto, contagens e pose associados aos objetos certos.' },
  IN_PROCESS: { label: 'Analisando',  short: 'PRC', color: '#fbbf24',
                desc: 'Sintetizando leitura, contagem e descrição.' },
  EXCEPTION:  { label: 'Exceção',     short: 'EXC', color: '#f87171',
                desc: 'Algo falhou ou ficou ambíguo. Dá para tentar de novo.' },
  COMPLETED:  { label: 'Concluído',   short: 'OK',  color: '#4ade80',
                desc: 'Análise pronta.' },
  ARCHIVED:   { label: 'Arquivado',   short: 'ARQ', color: '#6b6b75',
                desc: 'Guardado no histórico.' },
};

/**
 * Transições permitidas.
 *
 * Ser explícito aqui impede a classe de bugs em que uma resposta atrasada
 * de modelo empurra uma observação já concluída de volta para "analisando".
 */
const ALLOWED = {
  CAPTURED:   ['RESOLVED', 'EXCEPTION'],
  RESOLVED:   ['BOUND', 'EXCEPTION'],
  BOUND:      ['IN_PROCESS', 'EXCEPTION'],
  IN_PROCESS: ['COMPLETED', 'EXCEPTION'],
  EXCEPTION:  ['IN_PROCESS', 'RESOLVED', 'ARCHIVED'],   // retomada
  COMPLETED:  ['ARCHIVED'],
  ARCHIVED:   [],
};

export function canTransition(from, to) {
  return (ALLOWED[from] || []).includes(to);
}

let seq = 0;

export class Observation {
  constructor(meta = {}) {
    this.id = 'obs_' + (++seq).toString(36) + Date.now().toString(36).slice(-4);
    this.state = STATE.CAPTURED;
    this.createdAt = Date.now();
    this.meta = meta;

    /** Trilha completa: cada passo com quando e quanto demorou. */
    this.history = [{ state: STATE.CAPTURED, at: this.createdAt }];

    this.raw = {};       // RESOLVED: saída bruta por tarefa
    this.bound = null;   // BOUND: resultados cruzados
    this.result = null;  // COMPLETED: leitura, contagem, descrição, análise
    this.problems = [];  // o que falhou, sem derrubar o resto
  }

  get elapsedMs() {
    return Date.now() - this.createdAt;
  }

  get isTerminal() {
    return this.state === STATE.COMPLETED || this.state === STATE.ARCHIVED;
  }

  /**
   * Move de estado. Devolve false se a transição não é válida — e NÃO lança:
   * uma resposta de modelo que chega tarde é normal, não é erro de programa.
   */
  to(next, payload = null) {
    if (this.state === next) return true;
    if (!canTransition(this.state, next)) return false;

    const at = Date.now();
    const prev = this.history[this.history.length - 1];
    prev.ms = at - prev.at;

    this.state = next;
    this.history.push({ state: next, at, note: payload && payload.note });
    return true;
  }

  /** Registra um problema e vai para EXCEPTION, preservando o já feito. */
  problem(task, message) {
    this.problems.push({ task, message, at: Date.now() });
    this.to(STATE.EXCEPTION, { note: `${task}: ${message}` });
  }

  /** Quanto tempo a observação passou em cada estado. */
  timings() {
    return this.history.map((h, i) => ({
      state: h.state,
      ms: h.ms !== undefined ? h.ms
        : (i === this.history.length - 1 ? Date.now() - h.at : 0),
      note: h.note,
    }));
  }

  /** Forma serializável, para exportar ou guardar. */
  toJSON() {
    return {
      id: this.id,
      state: this.state,
      created_at: new Date(this.createdAt).toISOString(),
      elapsed_ms: this.elapsedMs,
      meta: this.meta,
      history: this.history.map((h) => ({
        state: h.state, at: new Date(h.at).toISOString(), ms: h.ms, note: h.note,
      })),
      problems: this.problems,
      result: this.result,
    };
  }
}
