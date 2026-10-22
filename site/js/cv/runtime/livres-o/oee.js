/**
 * cv/runtime/livres-o/oee.js — OEE pela câmera (CV-46), só matemática.
 *
 * Máquina sem CLP: o estado sai do MOVIMENTO numa ROI marcada com o mouse
 * (operador maquina.estado, operators/livres-o/maquina.js, mede a fração de
 * pixels que mudaram) e as peças, a presença e a qualidade vêm dos módulos
 * que já existem quando estão no Pipeline: CounterVision (peças), Takt
 * (operador no posto) e Inspect (OK/NOK). Nada aqui toca em DOM, canvas ou
 * modelo: é o que o teste do node exercita (tempos exatos).
 *
 * ============================ ESTADOS ============================
 *
 *   RODANDO            movimento na ROI da máquina ≥ `on`
 *   PARADA             movimento ≤ `off` (sem setup)
 *   SETUP              máquina quieta (≤ `off`) e movimento na ROI de setup
 *                      (≥ `setupOn`) — ou, opcional, operador ATIVO no posto
 *                      do Takt com a máquina parada
 *   PAUSA_PROGRAMADA   pausa da agenda de turnos (não entra no tempo planejado)
 *   NAO_OBSERVADO      fonte pausada, sem quadro há mais de `stale_s`
 *
 * HISTERESE: entre `off` e `on` (banda morta) o estado não muda. TEMPOS
 * MÍNIMOS: o candidato precisa persistir `confRodando_s` / `confParada_s` /
 * `confSetup_s`; confirmado, o estado novo RETROAGE ao instante em que o
 * candidato surgiu (como o EventManager do Takt) — por isso as durações saem
 * exatas (± 1 quadro) mesmo com confirmação longa. A pausa entre golpes de
 * uma prensa (movimento periódico) não vira parada se for menor que
 * `confParada_s`.
 *
 * ============================ OEE ============================
 *
 * Na janela (turno vigente da agenda ou a sessão):
 *   tempo planejado  = observado − pausa programada − não observado
 *                      − paradas classificadas com motivo PLANEJADO
 *   tempo operando   = RODANDO (+ microparadas < `microParada_s`, que contam
 *                      como perda de DESEMPENHO, não de disponibilidade)
 *   Disponibilidade  = operando ÷ planejado
 *   Desempenho       = (ciclo ideal × peças) ÷ operando
 *   Qualidade        = boas ÷ inspecionadas (Inspect: INCERTO conta como não
 *                      boa até a revisão humana) ou (peças − refugo) ÷ peças
 *                      com o apontamento manual
 *   OEE              = D × P × Q (Nakajima, TPM 1988; a mesma decomposição
 *                      da ISO 22400-2:2014, indicador OEE).
 * Fator sem dado (sem ciclo ideal, sem peças, sem qualidade) fica null e o
 * OEE sai "parcial" com o que existe — a tela diz qual faltou.
 *
 * Tempo: milissegundos (epoch, como Date.now()); parâmetros em SEGUNDOS.
 */
import { Agenda } from '../livres-m/takt-nucleo.js';

export const ESTADOS = ['RODANDO', 'PARADA', 'SETUP', 'PAUSA_PROGRAMADA', 'NAO_OBSERVADO'];
export const ROTULO = {
  RODANDO: 'Rodando', PARADA: 'Parada', SETUP: 'Setup', PAUSA_PROGRAMADA: 'Pausa programada', NAO_OBSERVADO: 'Não observado',
};
/** Cor de cada estado (legível no palco escuro e no claro; o padrão de preenchimento vem no CSS e nos desenhos). */
export const COR = {
  RODANDO: '#4FB387', PARADA: '#D8735D', SETUP: '#7FB2FF', PAUSA_PROGRAMADA: '#93A0B5', NAO_OBSERVADO: '#6B7571',
};
const PERDA = new Set(['PARADA', 'SETUP']);

export const PARAMS_PADRAO = Object.freeze({
  on: 0.02,              // fração de pixels que mudaram para contar como movimento
  off: 0.008,            // abaixo disto, quieta (entre off e on, mantém o estado)
  setupOn: 0.02,         // movimento na ROI de setup que caracteriza setup
  confRodando_s: 2,      // tempo mínimo para confirmar RODANDO
  confParada_s: 10,      // ... PARADA (cobre a pausa entre ciclos de uma máquina intermitente)
  confSetup_s: 5,        // ... SETUP
  tolerancia_s: 1,       // amostra contrária isolada (até isto) não derruba o candidato
  stale_s: 3,            // sem quadro por mais que isto → NÃO OBSERVADO
  microParada_s: 0,      // paradas mais curtas contam como perda de desempenho (0 = desligado)
});

export const MOTIVOS_PADRAO = [
  { nome: 'Falta de material', planejada: false },
  { nome: 'Quebra / manutenção corretiva', planejada: false },
  { nome: 'Setup / troca de produto', planejada: false },
  { nome: 'Ajuste / regulagem', planejada: false },
  { nome: 'Falta de operador', planejada: false },
  { nome: 'Problema de qualidade', planejada: false },
  { nome: 'Manutenção preventiva planejada', planejada: true },
  { nome: 'Refeição / reunião', planejada: true },
  { nome: 'Sem programação', planejada: true },
  { nome: 'Outro', planejada: false },
];
export const SEM_MOTIVO = 'Não classificada';

const fin = Number.isFinite;

// ===================================================================== detector por máquina

/**
 * Estado de UMA máquina a partir do movimento. passo() devolve as transições
 * confirmadas: [{ estado, inicio }] (inicio retroativo).
 */
export class DetectorMaquina {
  constructor(p = PARAMS_PADRAO) { this.p = { ...PARAMS_PADRAO, ...p }; this.zerar(); }
  zerar() { this.estado = null; this.cand = null; this.candDesde = null; this.candConf = null; this.ultTs = null; this.contra = null; this.nCand = 0; this.nContra = 0; }

  /** Estado bruto da amostra (com a banda morta da histerese). */
  bruto(mov, movSetup, opAtivo) {
    const p = this.p;
    // histerese também no setup: entra com setupOn, fica enquanto o movimento de setup passar de off
    const emSetup = this.cand === 'SETUP' || this.estado === 'SETUP';
    const setup = (fin(movSetup) && movSetup >= (emSetup ? Math.min(p.off, p.setupOn) : p.setupOn)) || opAtivo === true;
    if (mov >= p.on) return 'RODANDO';
    if (mov <= p.off) return setup ? 'SETUP' : 'PARADA';
    // banda morta: rodando continua rodando; quieta continua quieta (setup ou parada conforme a ROI de setup)
    return this.estado;
  }

  passo(ts, mov, movSetup = null, opAtivo = null) {
    const p = this.p;
    this.ultTs = ts;
    const alvo = this.bruto(mov, movSetup, opAtivo);
    if (alvo == null) return [];
    if (alvo === this.estado) {
      // um candidato só cai se a evidência contrária durar mais que a tolerância (amostra isolada não conta)
      if (this.cand) {
        if (this.contra == null) this.contra = ts;
        if (alvo === 'RODANDO') this.contraRodou = true;
        this.nContra++;
        // cai se a evidência contrária durar mais que a tolerância, ou se for a maioria das amostras
        if (ts - this.contra >= p.tolerancia_s * 1000 || (this.nContra >= 2 && this.nContra > this.nCand)) { this.cand = null; this.candDesde = null; this.candConf = null; this.contra = null; }
      }
      return [];
    }
    // voltou ao candidato depois de amostras contrárias toleradas: o relógio da confirmação segue. Se a
    // contrária foi MOVIMENTO da máquina (ela rodou ali), o início da quietude passa para depois dela; uma
    // amostra sem movimento de setup no meio de um setup não muda nada.
    if (this.contra != null && this.cand === alvo && this.contraRodou) this.candDesde = ts;
    this.contra = null; this.contraRodou = false;
    this.nCand = (this.nCand || 0) + 1;
    if (this.cand !== alvo) {
      // de rodando para "quieta" (parada ↔ setup): o início da quietude não muda — a máquina parou ali
      const quieto = (x) => x === 'PARADA' || x === 'SETUP';
      if (!(this.cand && quieto(this.cand) && quieto(alvo) && this.estado === 'RODANDO')) { this.candDesde = ts; this.candConf = ts; this.nCand = 0; this.nContra = 0; }
      this.cand = alvo;
    }
    const conf = (alvo === 'RODANDO' ? p.confRodando_s : alvo === 'SETUP' ? p.confSetup_s : p.confParada_s) * 1000;
    if (ts - this.candConf >= conf) {
      const inicio = this.candDesde;
      this.estado = alvo; this.cand = null; this.candDesde = null; this.candConf = null;
      return [{ estado: alvo, inicio }];
    }
    return [];
  }
}

// ===================================================================== KPI

/**
 * Tempos e OEE de um conjunto de intervalos numa janela [de, ate] (agora =
 * instante da última amostra, para os abertos). `motivos`: lista
 * { nome, planejada }. `prod`: { pecas, inspOK, inspNOK, inspINC, refugoManual,
 * fontePecas } já somados na janela. `cicloIdeal_s`: segundos por peça.
 */
export function kpiJanela(intervalos, de, ate, agora, { motivos = MOTIVOS_PADRAO, prod = null, cicloIdeal_s = 0, microParada_s = 0 } = {}) {
  const seg = { RODANDO: 0, PARADA: 0, SETUP: 0, PAUSA_PROGRAMADA: 0, NAO_OBSERVADO: 0 };
  const planejadas = new Set(motivos.filter((m) => m.planejada).map((m) => m.nome));
  let paradaPlanejada = 0, micro = 0, nParadas = 0;
  const porMotivo = {};
  for (const iv of intervalos) {
    const a = Math.max(iv.inicio, de);
    const b = Math.min(iv.fim != null ? iv.fim : agora, ate, agora);
    if (!(b > a)) continue;
    const d = (b - a) / 1000;
    seg[iv.estado] += d;
    if (PERDA.has(iv.estado)) {
      const durTotal = ((iv.fim != null ? iv.fim : agora) - iv.inicio) / 1000;
      if (iv.motivo && planejadas.has(iv.motivo)) paradaPlanejada += d;
      else if (microParada_s > 0 && iv.estado === 'PARADA' && iv.fim != null && durTotal < microParada_s) micro += d;
      const k = iv.motivo || SEM_MOTIVO;
      const r = porMotivo[k] || (porMotivo[k] = { motivo: k, seg: 0, n: 0, planejada: planejadas.has(k) });
      r.seg += d; r.n++;
      nParadas++;
    }
  }
  const total = ESTADOS.reduce((s, e) => s + seg[e], 0);
  const planejado = Math.max(0, total - seg.PAUSA_PROGRAMADA - seg.NAO_OBSERVADO - paradaPlanejada);
  const operando = seg.RODANDO + micro;
  const disp = planejado > 0 ? Math.min(1, operando / planejado) : null;
  let desempenho = null, qualidade = null, pecas = null, boas = null;
  if (prod) {
    pecas = fin(prod.pecas) ? prod.pecas : null;
    if (pecas != null && cicloIdeal_s > 0 && operando > 0) desempenho = (cicloIdeal_s * pecas) / operando;
    const insp = (prod.inspOK || 0) + (prod.inspNOK || 0) + (prod.inspINC || 0);
    if (insp > 0) { qualidade = (prod.inspOK || 0) / insp; boas = pecas != null ? Math.round(pecas * qualidade) : prod.inspOK; }
    else if (pecas != null && pecas > 0 && prod.refugoManual != null) { boas = Math.max(0, pecas - prod.refugoManual); qualidade = boas / pecas; }
  }
  const fatores = [disp, desempenho, qualidade];
  const oee = disp == null ? null : fatores.reduce((p, f) => p * (f == null ? 1 : f), 1);
  const faltam = [];
  if (desempenho == null) faltam.push(pecas == null ? 'peças' : 'ciclo ideal');
  if (qualidade == null) faltam.push('qualidade');
  const cobertura = total > 0 ? 1 - seg.NAO_OBSERVADO / total : null;
  return {
    seg, total, planejado, operando, micro, paradaPlanejada, nParadas,
    perdas: seg.PARADA + seg.SETUP - paradaPlanejada - micro,
    disponibilidade: disp, desempenho, qualidade, oee, parcial: faltam.length > 0, faltam,
    pecas, boas, cobertura,
    motivos: Object.values(porMotivo).sort((x, y) => y.seg - x.seg),
  };
}

// ===================================================================== configuração

export const PADRAO = {
  versao: 1,
  params: { ...PARAMS_PADRAO },
  cicloIdeal_s: 0,                // segundos por peça (0 = sem desempenho)
  motivos: MOTIVOS_PADRAO.map((m) => ({ ...m })),
  fuso: 'America/Sao_Paulo',
  turnos: [],                     // vazio = mede sempre (mesmo formato do Takt)
  setupPeloTakt: true,            // operador ATIVO no posto do Takt com a máquina quieta = setup
  maquinaProducao: '',            // id da marcação que recebe peças e qualidade ('' = a primeira)
  alarmes: { paradaMin: 5 },      // parada sem motivo por mais de N min
  videoInicio: '',
};

const clonar = (o) => JSON.parse(JSON.stringify(o));

export function normalizar(o) {
  const c = clonar(PADRAO);
  if (!o || typeof o !== 'object') return c;
  if (o.params) for (const k of Object.keys(PARAMS_PADRAO)) if (fin(+o.params[k]) && +o.params[k] >= 0) c.params[k] = +o.params[k];
  if (c.params.off > c.params.on) c.params.off = c.params.on;
  if (fin(+o.cicloIdeal_s) && +o.cicloIdeal_s >= 0) c.cicloIdeal_s = +o.cicloIdeal_s;
  if (Array.isArray(o.motivos) && o.motivos.length) {
    c.motivos = o.motivos.filter((m) => m && String(m.nome || '').trim()).slice(0, 40)
      .map((m) => ({ nome: String(m.nome).trim().slice(0, 50), planejada: Boolean(m.planejada) }));
  }
  if (typeof o.fuso === 'string' && o.fuso) c.fuso = o.fuso;
  if (Array.isArray(o.turnos)) {
    c.turnos = o.turnos.filter((t) => t && /^\d\d?:\d\d/.test(t.inicio) && /^\d\d?:\d\d/.test(t.fim)).map((t) => ({
      nome: String(t.nome || 'T').slice(0, 20), inicio: t.inicio, fim: t.fim,
      dias: (t.dias || []).map(Number).filter((d) => d >= 0 && d <= 6),
      pausas: (t.pausas || []).filter((p) => Array.isArray(p) && /^\d\d?:\d\d/.test(p[0]) && /^\d\d?:\d\d/.test(p[1])),
    }));
  }
  if (typeof o.setupPeloTakt === 'boolean') c.setupPeloTakt = o.setupPeloTakt;
  if (typeof o.maquinaProducao === 'string') c.maquinaProducao = o.maquinaProducao;
  if (o.alarmes && fin(+o.alarmes.paradaMin)) c.alarmes.paradaMin = Math.max(0, +o.alarmes.paradaMin);
  if (typeof o.videoInicio === 'string') c.videoInicio = o.videoInicio;
  return c;
}

// ===================================================================== motor (sessão)

const MAX_INTERVALOS = 50000;
const MAX_EVENTOS = 5000;

export class MotorOEE {
  constructor(cfg) {
    this.cfg = normalizar(cfg);
    this.alteracoes = 0;
    this.reiniciar();
  }

  definir(patch) {
    this.cfg = normalizar({ ...this.cfg, ...patch });
    for (const m of this.maq.values()) m.det.p = { ...PARAMS_PADRAO, ...this.cfg.params };
    this.agenda = new Agenda(this.cfg.turnos, this.cfg.fuso);
    this.alteracoes++;
  }

  reiniciar() {
    this.agenda = new Agenda(this.cfg.turnos, this.cfg.fuso);
    this.maq = new Map();            // id → { id, nome, det, aberto, mov, movSetup }
    this.intervalos = [];            // fechados
    this.producao = [];              // { ts, maquina, pecas, inspOK, inspNOK, inspINC, refugo, fonte }
    this.eventos = [];               // { ts, maquina, evento, detalhe }
    this.alarmes = new Map();
    this.janelasVistas = new Map();  // chave do turno → { de, ate, nome }
    this.inicio = null;
    this.ultTs = null;
    this.desloc = 0; this.baseVideo = null; this.ultVideo = null;
    this.foraDeTurno = false;
    this.seq = 0;
    this.amostras = 0;
    this.fontes = { contador: false, inspect: false, takt: false };
    this.alteracoes++;
  }

  /** Instante (ms): tempo do vídeo ancorado num relógio, ou o relógio; null se o quadro do vídeo é o mesmo. */
  instante(fonte, agora = Date.now()) {
    let ts;
    if (fonte && fonte.video) {
      if (this.ultVideo != null && fonte.t === this.ultVideo) return null;
      if (this.baseVideo == null) {
        const ini = this.cfg.videoInicio ? Date.parse(this.cfg.videoInicio) : NaN;
        this.baseVideo = fin(ini) ? ini : agora - fonte.t * 1000;
      }
      this.ultVideo = fonte.t;
      ts = this.baseVideo + fonte.t * 1000;
    } else {
      this.baseVideo = null; this.ultVideo = null;
      ts = agora;
    }
    ts += this.desloc;
    if (this.ultTs != null && ts < this.ultTs) {
      // voltou (loop do vídeo, troca de fonte): a linha do tempo continua de onde estava
      this.desloc += this.ultTs - ts + 200;
      ts = this.ultTs + 200;
    }
    return Math.round(ts);
  }

  _mudar(m, estado, inicio) {
    const ab = m.aberto;
    if (ab && ab.estado === estado) return;
    if (ab) {
      ab.fim = Math.max(ab.inicio, inicio);
      if (ab.fim > ab.inicio) {
        this.intervalos.push(ab);
        if (this.intervalos.length > MAX_INTERVALOS) this.intervalos.splice(0, this.intervalos.length - MAX_INTERVALOS);
      }
    }
    m.aberto = { id: ++this.seq, maquina: m.id, nome: m.nome, estado, inicio, fim: null, motivo: null, sugestao: null };
    if (estado === 'SETUP') m.aberto.sugestao = 'Setup / troca de produto';
    this.evento(inicio, m.nome, ROTULO[estado]);
    this.alteracoes++;
  }

  evento(ts, maquina, evento, detalhe = '') {
    this.eventos.push({ ts, maquina, evento, detalhe });
    if (this.eventos.length > MAX_EVENTOS) this.eventos.splice(0, this.eventos.length - MAX_EVENTOS);
    if (this.aoEvento) { try { this.aoEvento({ ts, maquina, evento, detalhe }); } catch (_) { /* segue */ } }
  }

  _forcar(estado, ts) {
    for (const m of this.maq.values()) { m.det.zerar(); this._mudar(m, estado, ts); }
  }

  /**
   * Uma amostra (um quadro analisado).
   *   ts, cameraOk, maquinas: [{ id, nome, mov, movSetup (ou null), opAtivo (true/false/null), opPresente }]
   *   prod: { pecas, inspOK, inspNOK, inspINC } — INCREMENTOS desde a amostra anterior (vão para a máquina de produção)
   */
  amostra({ ts, cameraOk = true, maquinas = [], prod = null }) {
    this.amostras++;
    if (this.inicio == null) this.inicio = ts;
    const P = this.cfg.params;
    // máquinas novas / sumidas
    const ids = new Set(maquinas.map((q) => q.id));
    for (const q of maquinas) {
      let m = this.maq.get(q.id);
      if (!m) {
        m = { id: q.id, nome: q.nome, det: new DetectorMaquina(P), aberto: null };
        this.maq.set(q.id, m);
      }
      m.nome = q.nome;
    }
    for (const [id, m] of this.maq) {
      if (!ids.has(id)) {
        // ROI apagada: fecha o que estava aberto e esquece a máquina
        if (m.aberto) { m.aberto.fim = Math.max(m.aberto.inicio, this.ultTs || ts); if (m.aberto.fim > m.aberto.inicio) this.intervalos.push(m.aberto); }
        this.maq.delete(id);
        this.alteracoes++;
      }
    }
    // watchdog: sem quadro há mais de stale_s → NÃO OBSERVADO desde a última amostra
    if (this.ultTs != null && (ts - this.ultTs) / 1000 > P.stale_s) this._forcar('NAO_OBSERVADO', this.ultTs);
    // fora de turno: não mede (fecha o que estiver aberto)
    if (!this.agenda.em_turno(ts)) {
      if (!this.foraDeTurno) {
        this.evento(ts, '', 'fora de turno', 'medição suspensa');
        for (const m of this.maq.values()) {
          if (m.aberto) { m.aberto.fim = ts; if (m.aberto.fim > m.aberto.inicio) this.intervalos.push(m.aberto); m.aberto = null; }
          m.det.zerar();
        }
      }
      this.foraDeTurno = true;
      this.ultTs = ts;
      return this.retrato(ts);
    }
    if (this.foraDeTurno) { this.foraDeTurno = false; this.evento(ts, '', 'em turno', 'medição retomada'); }
    const j = this.agenda.janela(ts);
    if (j) {
      const k = `${j.dia.y}-${j.dia.m}-${j.dia.d}-${j.turno.nome}`;
      if (!this.janelasVistas.has(k)) this.janelasVistas.set(k, { chave: k, de: j.inicio, ate: j.fim, nome: `Turno ${j.turno.nome}` });
    }

    if (!cameraOk) this._forcar('NAO_OBSERVADO', ts);
    else if (this.agenda.em_pausa(ts)) this._forcar('PAUSA_PROGRAMADA', ts);
    else {
      for (const q of maquinas) {
        const m = this.maq.get(q.id);
        m.mov = q.mov; m.movSetup = q.movSetup;
        const opAtivo = this.cfg.setupPeloTakt ? q.opAtivo : null;
        // estado forçado antes (pausa / não observado): o detector recomeça do zero
        if (m.aberto && (m.aberto.estado === 'NAO_OBSERVADO' || m.aberto.estado === 'PAUSA_PROGRAMADA') && m.det.estado != null) m.det.zerar();
        for (const tr of m.det.passo(ts, q.mov, q.movSetup, opAtivo)) {
          this._mudar(m, tr.estado, tr.inicio);
          if (tr.estado === 'PARADA' && q.opPresente === false) m.aberto.sugestao = 'Falta de operador';
        }
      }
    }
    // produção (vai para a máquina escolhida, ou a primeira)
    if (prod && (prod.pecas || prod.inspOK || prod.inspNOK || prod.inspINC)) {
      const alvo = this.maquinaProducao();
      this.producao.push({ ts, maquina: alvo, pecas: prod.pecas || 0, inspOK: prod.inspOK || 0, inspNOK: prod.inspNOK || 0, inspINC: prod.inspINC || 0, refugo: 0, fonte: prod.fonte || 'auto' });
      if (this.producao.length > 200000) this.producao.splice(0, this.producao.length - 200000);
      this.alteracoes++;
    }
    this.ultTs = ts;
    if (this._ultAlarme == null || ts - this._ultAlarme >= 1000) { this._ultAlarme = ts; this.avaliarAlarmes(ts); }
    return this.retrato(ts);
  }

  /** Id da máquina que recebe peças e qualidade. */
  maquinaProducao() {
    const c = this.cfg.maquinaProducao;
    if (c && this.maq.has(c)) return c;
    const p = this.maq.keys().next();
    return p.done ? '' : p.value;
  }

  /** Apontamento manual (peças e/ou refugo) no instante atual. */
  apontar({ pecas = 0, refugo = 0 } = {}) {
    const ts = this.ultTs != null ? this.ultTs : Date.now();
    if (!(pecas || refugo)) return;
    this.producao.push({ ts, maquina: this.maquinaProducao(), pecas: Math.round(pecas) || 0, inspOK: 0, inspNOK: 0, inspINC: 0, refugo: Math.round(refugo) || 0, fonte: 'manual' });
    this.evento(ts, '', 'apontamento manual', `${pecas ? `${pecas} peças` : ''}${pecas && refugo ? ' · ' : ''}${refugo ? `${refugo} refugo` : ''}`);
    this.alteracoes++;
  }

  /** Classifica uma parada (ou setup) pelo id do intervalo. motivo '' tira a classificação. */
  classificar(id, motivo) {
    const iv = this.todos().find((i) => i.id === id);
    if (!iv) return false;
    iv.motivo = motivo || null;
    this.evento(this.ultTs || iv.inicio, iv.nome, 'motivo', `${ROTULO[iv.estado]} de ${new Date(iv.inicio).toLocaleTimeString('pt-BR')}: ${motivo || '(sem)'}`);
    this.alteracoes++;
    return true;
  }

  todos(maquina = null) {
    const l = this.intervalos.concat([...this.maq.values()].map((m) => m.aberto).filter(Boolean));
    return maquina ? l.filter((i) => i.maquina === maquina) : l;
  }

  /** Paradas e setups (para classificar), mais recentes primeiro. */
  paradas(maquina = null) {
    return this.todos(maquina).filter((i) => PERDA.has(i.estado)).sort((a, b) => b.inicio - a.inicio);
  }

  janela(ts = this.ultTs) {
    if (ts == null) return null;
    if (this.cfg.turnos.length) {
      const j = this.agenda.janela(ts);
      if (j) return { de: j.inicio, ate: j.fim, nome: `Turno ${j.turno.nome}`, turno: j.turno };
    }
    return { de: this.inicio != null ? this.inicio : ts, ate: ts, nome: 'Sessão', turno: null };
  }

  /** Produção somada na janela (de uma máquina). */
  producaoNa(de, ate, maquina) {
    const r = { pecas: 0, inspOK: 0, inspNOK: 0, inspINC: 0, refugoManual: null, temPecas: false, fontePecas: null };
    let manualP = 0, manualR = 0, temManual = false, contP = 0, inspT = 0;
    for (const e of this.producao) {
      if (e.ts < de || e.ts > ate || (maquina && e.maquina !== maquina)) continue;
      if (e.fonte === 'manual') { manualP += e.pecas; manualR += e.refugo; temManual = true; continue; }
      contP += e.pecas; r.inspOK += e.inspOK; r.inspNOK += e.inspNOK; r.inspINC += e.inspINC;
      inspT += e.inspOK + e.inspNOK + e.inspINC;
    }
    if (this.fontes.contador || contP > 0) { r.pecas = contP + manualP; r.temPecas = true; r.fontePecas = 'CounterVision'; }
    else if (this.fontes.inspect || inspT > 0) { r.pecas = inspT + manualP; r.temPecas = true; r.fontePecas = 'Inspect'; }
    else if (temManual) { r.pecas = manualP; r.temPecas = true; r.fontePecas = 'manual'; }
    if (temManual) r.refugoManual = manualR;
    if (!r.temPecas) r.pecas = null;
    return r;
  }

  /** KPIs da janela: por máquina (a de produção leva peças e qualidade) e o geral (= a máquina de produção). */
  kpis(j = this.janela()) {
    if (!j) return null;
    const agora = this.ultTs;
    const alvo = this.maquinaProducao();
    const opts = { motivos: this.cfg.motivos, cicloIdeal_s: this.cfg.cicloIdeal_s, microParada_s: this.cfg.params.microParada_s };
    const maquinas = [...new Set([...this.maq.keys(), ...this.intervalos.map((i) => i.maquina)])].map((id) => {
      const ivs = this.todos(id);
      const prod = id === alvo ? this.producaoNa(j.de, j.ate, id) : null;
      const nome = (this.maq.get(id) || {}).nome || (ivs[0] && ivs[0].nome) || id;
      return { id, nome, producao: id === alvo, prod, ...kpiJanela(ivs, j.de, j.ate, agora, { ...opts, prod }) };
    });
    const geral = maquinas.find((m) => m.producao) || maquinas[0] || null;
    return { janela: j, maquinas, geral };
  }

  /** KPIs de cada turno visto na sessão (mais recente primeiro); sem agenda, só a sessão. */
  porTurno() {
    const l = [...this.janelasVistas.values()].sort((a, b) => b.de - a.de);
    if (!l.length) { const k = this.kpis(); return k ? [{ janela: k.janela, k: k.geral }] : []; }
    return l.map((j) => { const k = this.kpis({ ...j, ate: Math.min(j.ate, this.ultTs || j.ate) }); return { janela: j, k: k && k.geral }; });
  }

  avaliarAlarmes(ts) {
    const lim = this.cfg.alarmes.paradaMin;
    const vivos = new Set();
    for (const m of this.maq.values()) {
      const ab = m.aberto;
      if (lim > 0 && ab && PERDA.has(ab.estado) && !ab.motivo && (ts - ab.inicio) / 60000 >= lim) {
        const chave = `parada:${m.id}`;
        vivos.add(chave);
        const txt = `${m.nome}: ${ROTULO[ab.estado].toLowerCase()} há ${((ts - ab.inicio) / 60000).toFixed(1)} min sem motivo (limite ${lim} min)`;
        const a = this.alarmes.get(chave);
        if (!a || !a.ativo) {
          this.alarmes.set(chave, { chave, tipo: 'PARADA', maquina: m.nome, desde: ts, ativo: true, reconhecido: false, texto: txt });
          this.evento(ts, m.nome, 'ALARME PARADA', txt);
        } else a.texto = txt;
      }
    }
    for (const a of this.alarmes.values()) if (a.ativo && !vivos.has(a.chave)) { a.ativo = false; a.fim = ts; this.evento(ts, a.maquina, 'normalizou PARADA', a.texto); }
  }
  reconhecer() { for (const a of this.alarmes.values()) a.reconhecido = true; this.alteracoes++; }
  alarmesAtivos() { return [...this.alarmes.values()].filter((a) => a.ativo); }

  retrato(ts) {
    return {
      t: ts,
      maquinas: [...this.maq.values()].map((m) => ({
        id: m.id, nome: m.nome, mov: m.mov, movSetup: m.movSetup,
        estado: m.aberto ? m.aberto.estado : null, desde: m.aberto ? m.aberto.inicio : null, cand: m.det.cand,
      })),
      foraDeTurno: this.foraDeTurno,
    };
  }

  // ------------------------------------------------------------ exportação
  intervalosCSV() {
    const l = ['maquina;estado;rotulo;inicio;fim;duracao_s;motivo;planejada;aberto'];
    const plan = new Set(this.cfg.motivos.filter((m) => m.planejada).map((m) => m.nome));
    for (const iv of this.todos().sort((a, b) => a.inicio - b.inicio)) {
      const fim = iv.fim != null ? iv.fim : this.ultTs;
      l.push([csv(iv.nome), iv.estado, csv(ROTULO[iv.estado]), iso(iv.inicio), iso(fim), ((fim - iv.inicio) / 1000).toFixed(1),
        csv(iv.motivo || ''), iv.motivo && plan.has(iv.motivo) ? 'sim' : 'nao', iv.fim == null ? 'sim' : 'nao'].join(';'));
    }
    return '﻿' + l.join('\n');
  }

  paradasCSV() {
    const l = ['maquina;tipo;inicio;fim;duracao_s;motivo;sugestao'];
    for (const iv of this.paradas().slice().reverse()) {
      const fim = iv.fim != null ? iv.fim : this.ultTs;
      l.push([csv(iv.nome), csv(ROTULO[iv.estado]), iso(iv.inicio), iso(fim), ((fim - iv.inicio) / 1000).toFixed(1), csv(iv.motivo || SEM_MOTIVO), csv(iv.sugestao || '')].join(';'));
    }
    return '﻿' + l.join('\n');
  }

  turnosCSV() {
    const n4 = (v) => (v == null ? '' : v.toFixed(4));
    const l = ['janela;de;ate;planejado_s;operando_s;parada_s;setup_s;pausa_s;nao_observado_s;pecas;boas;disponibilidade;desempenho;qualidade;oee;parcial'];
    for (const { janela: j, k } of this.porTurno()) {
      if (!k) continue;
      l.push([csv(j.nome), iso(j.de), iso(Math.min(j.ate, this.ultTs || j.ate)), k.planejado.toFixed(1), k.operando.toFixed(1), k.seg.PARADA.toFixed(1),
        k.seg.SETUP.toFixed(1), k.seg.PAUSA_PROGRAMADA.toFixed(1), k.seg.NAO_OBSERVADO.toFixed(1), k.pecas == null ? '' : k.pecas, k.boas == null ? '' : k.boas,
        n4(k.disponibilidade), n4(k.desempenho), n4(k.qualidade), n4(k.oee), k.parcial ? 'sim' : 'nao'].join(';'));
    }
    return '﻿' + l.join('\n');
  }

  eventosCSV() {
    const l = ['hora;maquina;evento;detalhe'];
    for (const e of this.eventos) l.push([iso(e.ts), csv(e.maquina), csv(e.evento), csv(e.detalhe)].join(';'));
    return '﻿' + l.join('\n');
  }

  exportarConfig() { return JSON.stringify({ formato: 'gplansis.oee', ...this.cfg }, null, 2); }
}

export function csv(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ISO local com fuso. */
export function iso(ms) {
  if (!fin(ms)) return '';
  const d = new Date(ms);
  const p = (n, k = 2) => String(n).padStart(k, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// ===================================================================== movimento (puro)

/**
 * Amostra a ROI (polígono 0–1 do quadro) em tons de cinza numa grade de no
 * máximo `lado` px no maior eixo; devolve { g: Uint8Array, m: Uint8Array
 * (máscara do polígono), w, h }. Cacheável pela geometria.
 */
export function amostrarRoi(img, poly, lado = 96, cache = null) {
  const W = img.width, H = img.height, d = img.data;
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
  const bw = Math.max(1, (x1 - x0) * W), bh = Math.max(1, (y1 - y0) * H);
  const k = Math.min(1, lado / Math.max(bw, bh));
  const w = Math.max(2, Math.round(bw * k)), h = Math.max(2, Math.round(bh * k));
  const chave = `${W}x${H}|${w}x${h}|${poly.map((p) => p.join(',')).join(';')}`;
  let m;
  if (cache && cache.chave === chave) m = cache.m;
  else {
    m = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = x0 + ((i + 0.5) / w) * (x1 - x0), v = y0 + ((j + 0.5) / h) * (y1 - y0);
      m[j * w + i] = dentro(u, v, poly) ? 1 : 0;
    }
    if (cache) { cache.chave = chave; cache.m = m; }
  }
  const g = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const py = Math.min(H - 1, Math.floor((y0 + ((j + 0.5) / h) * (y1 - y0)) * H));
    for (let i = 0; i < w; i++) {
      const px = Math.min(W - 1, Math.floor((x0 + ((i + 0.5) / w) * (x1 - x0)) * W));
      const o = (py * W + px) * 4;
      g[j * w + i] = (d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8;
    }
  }
  return { g, m, w, h, chave };
}

function dentro(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
}

/**
 * Movimento na ROI: fração (0–1) dos pixels do polígono que mudaram mais que
 * `limiar` níveis de cinza. Método 'diferenca' (quadro anterior) ou 'fundo'
 * (fundo adaptativo, média móvel com taxa `alfa`). `st` guarda o anterior/fundo.
 */
export function movimento(a, st, { metodo = 'diferenca', limiar = 25, alfa = 0.02 } = {}) {
  const n = a.g.length;
  if (!st.ref || st.ref.length !== n || st.chave !== a.chave) {
    st.ref = metodo === 'fundo' ? Float32Array.from(a.g) : a.g.slice();
    st.chave = a.chave;
    return 0;
  }
  let mud = 0, tot = 0;
  const ref = st.ref, g = a.g, m = a.m;
  for (let i = 0; i < n; i++) {
    if (!m[i]) continue;
    tot++;
    if (Math.abs(g[i] - ref[i]) > limiar) mud++;
  }
  if (metodo === 'fundo') { for (let i = 0; i < n; i++) ref[i] += alfa * (g[i] - ref[i]); }
  else st.ref = g.slice();
  return tot ? mud / tot : 0;
}
