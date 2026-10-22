/**
 * cv/runtime/livres-oa/alarmes.js — alarmes no padrão ISA-18.2, como o do
 * BeltScan (runtime/livres-k/beltscan.js › _alarmes), mas genérico: cada
 * alarme é uma TAG criada sob demanda pelo operador (limite de um mostrador,
 * invasão de uma cerca, queda de uma pessoa…).
 *
 *   NORMAL ──(condição por ≥ atrasoOn)──▶ ATIVO_NR (ativo, não reconhecido)
 *   ATIVO_NR ──reconhecer──▶ ATIVO_R
 *   ATIVO_* ──(normal por ≥ atrasoOff, com banda morta)──▶ RTN_NR (se não reconhecido) ou NORMAL
 *   RTN_NR ──reconhecer──▶ NORMAL
 *
 * A banda morta fica com quem chama: `bruto` é a condição de ATIVAR e
 * `normalOk` a de NORMALIZAR (ex.: v > H ativa; v < H − banda normaliza).
 * Prioridade 1 = mais alta. Tudo em segundos do relógio do quadro.
 */
export const ROTULO_ESTADO = {
  NORMAL: 'normal', ATIVO_NR: 'ativo, não reconhecido', ATIVO_R: 'ativo, reconhecido', RTN_NR: 'voltou ao normal, não reconhecido',
};

export class Alarmes {
  constructor(max = 500) {
    this.tags = new Map();   // tag → { estado, desdeOn, desdeOff, valor, prio, texto, inicio }
    this.log = [];           // { t, tag, evento, valor, prio, texto }
    this.max = max;
  }

  _log(t, tag, evento, s) {
    this.log.push({ t, tag, evento, valor: s.valor, prio: s.prio, texto: s.texto });
    if (this.log.length > this.max) this.log.splice(0, this.log.length - this.max);
  }

  /**
   * Um passo da máquina de estados da tag.
   * @param cfg { prio, texto, atrasoOn (s), atrasoOff (s) }
   * @returns o estado da tag
   */
  passo(tag, cfg, bruto, normalOk, valor, t) {
    let s = this.tags.get(tag);
    if (!s) this.tags.set(tag, (s = { estado: 'NORMAL', desdeOn: null, desdeOff: null, valor: NaN, inicio: null }));
    s.prio = cfg.prio || 3; s.texto = cfg.texto || tag; s.valor = valor; s.visto = t;
    const ativo = s.estado === 'ATIVO_NR' || s.estado === 'ATIVO_R';
    if (!ativo) {
      if (bruto) {
        if (s.desdeOn == null || t < s.desdeOn) s.desdeOn = t;
        if (t - s.desdeOn >= (cfg.atrasoOn || 0)) {
          s.estado = 'ATIVO_NR'; s.desdeOff = null; s.inicio = s.desdeOn;
          this._log(t, tag, 'ativou', s);
        }
      } else s.desdeOn = null;
    } else if (normalOk && !bruto) {
      if (s.desdeOff == null || t < s.desdeOff) s.desdeOff = t;
      if (t - s.desdeOff >= (cfg.atrasoOff || 0)) {
        s.estado = s.estado === 'ATIVO_NR' ? 'RTN_NR' : 'NORMAL'; s.desdeOn = null;
        s.duracao = s.desdeOff - (s.inicio ?? s.desdeOff);
        this._log(t, tag, `normalizou (${s.duracao.toFixed(1)} s)`, s);
      }
    } else s.desdeOff = null;
    return s.estado;
  }

  /** Reconhece uma tag (ou todas). */
  reconhecer(tag = null, t = NaN) {
    for (const [k, s] of this.tags) {
      if (tag && k !== tag) continue;
      if (s.estado === 'ATIVO_NR') { s.estado = 'ATIVO_R'; this._log(t, k, 'reconhecido', s); }
      else if (s.estado === 'RTN_NR') { s.estado = 'NORMAL'; this._log(t, k, 'reconhecido (já normal)', s); }
    }
  }

  /** Tags fora do NORMAL (ativas ou à espera de reconhecimento), da maior prioridade para a menor. */
  pendentes() {
    const out = [];
    for (const [tag, s] of this.tags) if (s.estado !== 'NORMAL') out.push({ tag, ...s });
    return out.sort((a, b) => a.prio - b.prio || (a.inicio ?? 0) - (b.inicio ?? 0));
  }

  /** Maior prioridade ATIVA (0 = nenhuma). */
  prioridadeAtiva() {
    let p = 0;
    for (const s of this.tags.values()) if ((s.estado === 'ATIVO_NR' || s.estado === 'ATIVO_R') && (!p || s.prio < p)) p = s.prio;
    return p;
  }

  /** Esquece tags normais sem passo há mais de `s` segundos (pessoas que saíram da cena). */
  limpar(t, s = 60) {
    for (const [k, v] of this.tags) if (v.estado === 'NORMAL' && t - (v.visto ?? t) > s) this.tags.delete(k);
  }

  /** Instantâneo serializável para o painel. */
  resumo() {
    return { pendentes: this.pendentes().map(({ tag, estado, prio, texto, valor, inicio }) => ({ tag, estado, prio, texto, valor, inicio })),
             log: this.log.slice(-200), prio: this.prioridadeAtiva() };
  }
}

/** Cor da prioridade (1 vermelho, 2 âmbar, 3 amarelo) para o overlay. */
export const COR_PRIO = { 1: '#FF4D4D', 2: '#F2A900', 3: '#FFD84D' };
