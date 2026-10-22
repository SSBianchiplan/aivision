/**
 * cv/runtime/livres-m/canal.js — o MOTOR do Takt (CV-39) e a ponte com as telas.
 *
 * O executor não expõe o ctx do quadro fora da cadeia: o operador takt.posto
 * (operators/livres-m/takt.js) monta as amostras do quadro (postos marcados,
 * pessoas com pose e ID) e as entrega aqui; o motor roda o porte do worker do
 * Takt (runtime/livres-m/takt-nucleo.js — ActivityScorer, EventManager,
 * Agenda) e guarda a sessão: intervalos de estado por posto, eventos,
 * alarmes, posições no piso. O painel e a tela cheia GPlanSiS|Takt assinam o
 * retrato (no máximo 4×/s). A sessão mora aqui, e não no estado do nó:
 * apagar e recriar o nó no Pipeline não joga fora o turno medido.
 *
 * CONFIGURAÇÃO (localStorage 'aiv.takt.cfg'): tempos da máquina de estados
 * (produção do worker ou bancada), raio de presença, agenda de turnos e
 * pausas no fuso da planta, alarmes, privacidade e a CALIBRAÇÃO DO PISO
 * (pares imagem↔metros; a homografia é recalculada ao carregar).
 *
 * TEMPO: arquivo de vídeo = tempo do VÍDEO ancorado num relógio de parede
 * (o início escolhido, ou o instante em que o vídeo começou a ser medido);
 * câmera, tela, stream e YouTube = relógio. O tempo é monotônico: a volta do
 * vídeo em loop continua a linha do tempo em vez de voltar.
 * FONTE PARADA (ctx.fonteParada — YouTube pausado, histórico): NÃO conta como
 * ocioso; vira câmera sem quadro → NAO_OBSERVADO (INV-TAKT-003). Uma câmera
 * ao vivo com a pessoa parada continua sendo dado real (ocioso).
 */
import {
  EventManager, ActivityScorer, Agenda, PARAMETROS_PRODUCAO, PARAMETROS_BANCADA, homografia, paraPiso, inversa3,
  kpiJanela, ROTULO, ESTADOS, ERRO_MAX_CALIBRACAO_M, distanciaAoPoligono, centroVertices,
} from './takt-nucleo.js';
import { Rastreador } from '../livres-f/ergonomia.js';

const CHAVE = 'aiv.takt.cfg';
const MAX_INTERVALOS = 50000;
const MAX_EVENTOS = 5000;

export const TEMPOS = {
  producao: { rotulo: 'Produção (worker do Takt: 4 s / 45 s / 20 s)', params: PARAMETROS_PRODUCAO },
  bancada: { rotulo: 'Bancada de teste (2 s / 8 s / 5 s)', params: PARAMETROS_BANCADA },
};

/** Turnos de exemplo (3 turnos, segunda a sábado; o C cruza a meia-noite). */
export const TURNOS_EXEMPLO = [
  { nome: 'A', inicio: '06:00', fim: '14:00', dias: [1, 2, 3, 4, 5, 6], pausas: [['09:00', '09:10'], ['11:30', '12:30']] },
  { nome: 'B', inicio: '14:00', fim: '22:00', dias: [1, 2, 3, 4, 5, 6], pausas: [['17:00', '17:10'], ['19:00', '20:00']] },
  { nome: 'C', inicio: '22:00', fim: '06:00', dias: [1, 2, 3, 4, 5], pausas: [['02:00', '03:00']] },
];

export const PADRAO = {
  versao: 1,
  tempos: 'producao',                 // producao | bancada | personalizado
  params: { ...PARAMETROS_PRODUCAO },
  presenca: 'imagem',                 // imagem (bancada do Takt) | piso (worker: em metros, exige calibração)
  raio_m: 1.2,                        // presença: distância ao posto no piso (com calibração)
  raio_img: 0.2,                      // presença na imagem: fração da altura do quadro
  amostrasHz: 5,                      // o ActivityScorer foi feito para ~5 amostras/s (janela de 10 ≈ 2 s)
  fuso: 'America/Sao_Paulo',
  turnos: [],                         // vazio = mede sempre (turnos.py)
  alarmes: { vagoMin: 5, ociosoPct: 30, coberturaMin: 85 },
  privacidade: { borrar: true, caixas: true },
  videoInicio: '',                    // ISO local (datetime-local) do 1º quadro do arquivo; vazio = agora
  piso: { pts: [], W: 0, H: 0 },      // pts: [{ u, v (fonte 0–1), x, y (m) }]
};

const clonar = (o) => JSON.parse(JSON.stringify(o));
const virgula = (v, d) => v.toFixed(d).replace('.', ',');
const fin = Number.isFinite;

function lerCfg() {
  try {
    const o = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (o && o.versao === 1) return normalizar(o);
  } catch (_) { /* storage bloqueado ou JSON ruim */ }
  return clonar(PADRAO);
}

/** Saneia uma configuração vinda do disco ou de um JSON importado. */
export function normalizar(o) {
  const c = clonar(PADRAO);
  if (!o || typeof o !== 'object') return c;
  if (TEMPOS[o.tempos] || o.tempos === 'personalizado') c.tempos = o.tempos;
  for (const k of Object.keys(PARAMETROS_PRODUCAO)) if (o.params && fin(+o.params[k])) c.params[k] = +o.params[k];
  if (c.tempos !== 'personalizado') c.params = { ...TEMPOS[c.tempos].params };
  for (const k of ['raio_m', 'raio_img', 'amostrasHz']) if (fin(+o[k]) && +o[k] > 0) c[k] = +o[k];
  if (o.presenca === 'piso' || o.presenca === 'imagem') c.presenca = o.presenca;
  if (typeof o.fuso === 'string' && o.fuso) c.fuso = o.fuso;
  if (Array.isArray(o.turnos)) {
    c.turnos = o.turnos.filter((t) => t && /^\d\d?:\d\d/.test(t.inicio) && /^\d\d?:\d\d/.test(t.fim)).map((t) => ({
      nome: String(t.nome || 'T').slice(0, 20), inicio: t.inicio, fim: t.fim,
      dias: (t.dias || []).map(Number).filter((d) => d >= 0 && d <= 6),
      pausas: (t.pausas || []).filter((p) => Array.isArray(p) && /^\d\d?:\d\d/.test(p[0]) && /^\d\d?:\d\d/.test(p[1])),
    }));
  }
  if (o.alarmes) for (const k of Object.keys(c.alarmes)) if (fin(+o.alarmes[k])) c.alarmes[k] = +o.alarmes[k];
  if (o.privacidade) c.privacidade = { borrar: o.privacidade.borrar !== false, caixas: o.privacidade.caixas !== false };
  if (typeof o.videoInicio === 'string') c.videoInicio = o.videoInicio;
  if (o.piso && Array.isArray(o.piso.pts)) {
    c.piso.pts = o.piso.pts.filter((p) => p && fin(+p.u) && fin(+p.v)).map((p) => ({ u: +p.u, v: +p.v, x: fin(+p.x) ? +p.x : null, y: fin(+p.y) ? +p.y : null }));
    c.piso.W = +o.piso.W || 0; c.piso.H = +o.piso.H || 0;
  }
  return c;
}

/** Cor de cada estado (as do Takt, legíveis no palco escuro e no claro). */
export const COR_ESTADO = {
  PRODUTIVO: '#4FB387', OCIOSO_NO_POSTO: '#E0A13A', VAGO: '#D8735D', PAUSA_PROGRAMADA: '#93A0B5', NAO_OBSERVADO: '#6B7571',
};

// ===================================================================== motor

export class MotorTakt {
  constructor(cfg) {
    this.cfg = normalizar(cfg);
    this.alteracoes = 0;
    this.status = '';
    this.calibrar();
    this.reiniciar();
  }

  // ------------------------------------------------------------ configuração
  definir(patch) {
    const antes = JSON.stringify([this.cfg.params, this.cfg.turnos, this.cfg.fuso]);
    this.cfg = normalizar({ ...this.cfg, ...patch });
    if (patch.tempos && TEMPOS[patch.tempos]) this.cfg.params = { ...TEMPOS[patch.tempos].params };
    if (antes !== JSON.stringify([this.cfg.params, this.cfg.turnos, this.cfg.fuso])) {
      this.em.p = { ...PARAMETROS_PRODUCAO, ...this.cfg.params };
      this.agenda = new Agenda(this.cfg.turnos, this.cfg.fuso);
    }
    if (patch.piso) this.calibrar();
    this.alteracoes++;
  }

  /** Recalcula a homografia do piso a partir dos pares (≥ 4 com x e y). */
  calibrar() {
    const P = this.cfg.piso;
    const ok = P.pts.filter((p) => fin(p.x) && fin(p.y));
    this.piso = { calibrado: false, H: null, Hinv: null, erro: null, n: ok.length, msg: '' };
    if (ok.length < 4) { this.piso.msg = `${ok.length} de 4 pontos com coordenadas no piso`; return this.piso; }
    try {
      const W = P.W || 1, H = P.H || 1;
      const r = homografia(ok.map((p) => [p.u * W, p.v * H]), ok.map((p) => [p.x, p.y]));
      this.piso = { calibrado: r.erro <= ERRO_MAX_CALIBRACAO_M, H: r.H, Hinv: inversa3(r.H), erro: r.erro, n: ok.length, W, Hh: H,
        msg: r.erro <= ERRO_MAX_CALIBRACAO_M ? `erro de reprojeção ${virgula(r.erro, 3)} m` : `erro de reprojeção ${virgula(r.erro, 2)} m acima de ${virgula(ERRO_MAX_CALIBRACAO_M, 2)} m — reveja os pontos` };
    } catch (e) {
      this.piso.msg = e.message;
    }
    return this.piso;
  }

  /** Fonte normalizada (0–1) → piso (m), ou null sem calibração. */
  fonteParaPiso(u, v) {
    const P = this.piso;
    if (!P.H) return null;
    try { return paraPiso(P.H, [u * P.W, v * P.Hh]); } catch (_) { return null; }
  }

  /** Piso (m) → fonte normalizada, ou null. */
  pisoParaFonte(x, y) {
    const P = this.piso;
    if (!P.Hinv) return null;
    try { const q = paraPiso(P.Hinv, [x, y]); return [q[0] / P.W, q[1] / P.Hh]; } catch (_) { return null; }
  }

  // ------------------------------------------------------------ sessão
  reiniciar() {
    this.em = new EventManager([], { em_pausa: (ts) => this.agenda.em_pausa(ts), p: { ...PARAMETROS_PRODUCAO, ...this.cfg.params } });
    this.agenda = new Agenda(this.cfg.turnos, this.cfg.fuso);
    this.scorer = new ActivityScorer();
    this.rastreador = new Rastreador(3000);
    this.intervalos = [];          // fechados
    this.abertos = new Map();      // posto → intervalo aberto
    this.nomes = new Map();        // posto → nome da marcação
    this.eventos = [];             // { ts, posto, evento, detalhe }
    this.alarmes = new Map();      // chave → { tipo, posto, desde, ativo, reconhecido, valor }
    this.pessoas = new Map();      // id → { pos, unidade, t, desloc, vel, trilha: [[x,y]…] }
    this.calor = new Map();        // célula de 0,25 m no piso → amostras com alguém ali (mapa de calor)
    this.inicio = null;
    this.ultTs = null;
    this.desloc = 0;               // deslocamento que mantém o tempo monotônico (volta do vídeo)
    this.baseVideo = null;
    this.ultVideo = null;
    this.foraDeTurno = false;
    this._ultAlarme = null;
    this.amostras = 0;
    this.alteracoes++;
  }

  /**
   * Instante (ms) do quadro: tempo do vídeo ancorado, ou relógio. Devolve
   * null quando o quadro do vídeo é o mesmo já medido (laço mais rápido que o vídeo).
   */
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

  /** Postos da imagem: [{ id, nome, zona (unidade), raio, roi (px), centro (px) }]. */
  definirPostos(postos, ts) {
    const ids = postos.map((p) => p.id).join('|');
    for (const p of postos) this.nomes.set(p.id, p.nome);
    const geo = postos.map((p) => ({ posto_id: p.id, zona: p.zona, raio_m: p.raio }));
    if (ids !== this._ids) {
      this._ids = ids;
      this.registrar(this.em.definirPostos(geo, ts), ts);
    } else {
      this.em.postos = geo;     // geometria ajustada (alças, zoom) sem perder o estado
    }
  }

  /**
   * Uma amostra (um quadro analisado).
   *   ts, cameraOk, postos (definirPostos), pessoas: [{ id, k (px), s, pos (unidade da presença), posM (m | null), conf }]
   * Devolve { pessoas avaliadas, intervalos emitidos }.
   */
  amostra({ ts, cameraOk, postos, pessoas }) {
    this.amostras++;
    if (this.inicio == null) this.inicio = ts;
    // watchdog (main.py): sem quadro por mais que stale_s → NAO_OBSERVADO desde o último
    if (this.ultTs != null && (ts - this.ultTs) / 1000 > this.em.p.stale_s) this.registrar(this.em.tick_sem_quadro(ts), ts);
    this.definirPostos(postos, ts);
    // fora de turno não se mede: fecha o que estiver aberto (nada de VAGO madrugada adentro)
    if (!this.agenda.em_turno(ts)) {
      if (!this.foraDeTurno) this.evento(ts, '', 'fora de turno', 'medição suspensa');
      this.foraDeTurno = true;
      this.registrar(this.em.fechar_todos(ts), ts);
      this.ultTs = ts;
      return { pessoas: [], ivs: [] };
    }
    if (this.foraDeTurno) { this.foraDeTurno = false; this.evento(ts, '', 'em turno', 'medição retomada'); }

    const avaliadas = [];
    const amostrasEm = [];
    if (cameraOk && postos.length) {
      for (const pe of pessoas) {
        // posto mais próximo e atividade relativa a ele (main.py)
        let alvo = postos[0], dmin = Infinity;
        for (const c of postos) { const d = distanciaAoPoligono(pe.pos, c.zona); if (d < dmin) { dmin = d; alvo = c; } }
        const [act, qual] = this.scorer.score(pe.id, pe.k, pe.s, alvo.roi, alvo.centro);
        amostrasEm.push({ track_id: pe.id, pos_m: pe.pos, atividade: act, qualidade_pose: qual, conf_det: pe.conf });
        avaliadas.push({ ...pe, act, qual, posto: dmin <= alvo.raio ? alvo.id : null, dist: dmin, alvo: alvo.id });
        this.mover(pe.id, pe.posM || pe.pos, ts, pe.posM ? 'm' : 'img');
      }
    }
    const ivs = this.em.processar({ ts, camera_ok: cameraOk, pessoas: amostrasEm });
    this.registrar(ivs, ts);
    for (const [id, p] of this.pessoas) if (ts - p.t > 10000) { this.pessoas.delete(id); this.scorer.forget(id); }
    this.ultTs = ts;
    // alarmes: uma vez por segundo de medição (a conta de KPI percorre os intervalos)
    if (this._ultAlarme == null || ts - this._ultAlarme >= 1000 || ivs.length) { this._ultAlarme = ts; this.avaliarAlarmes(ts); }
    return { pessoas: avaliadas, ivs };
  }

  /** Posição, velocidade e deslocamento acumulado por pessoa (no piso, em m, com calibração). */
  mover(id, pos, ts, unidade) {
    let p = this.pessoas.get(id);
    if (!p) this.pessoas.set(id, (p = { pos, t: ts, desloc: 0, vel: 0, trilha: [], unidade, ancora: pos }));
    const dt = Math.max(1e-3, (ts - p.t) / 1000);
    const d = Math.hypot(pos[0] - p.pos[0], pos[1] - p.pos[1]);
    if (p.t !== ts) p.vel = Math.min(14.9, d / dt);   // mesmo teto do worker
    // deslocamento com zona morta: o tremor do pé detectado (±10 cm a cada quadro) não vira caminhada,
    // e um salto de rastreio (> 3 m/s) também não
    const zm = unidade === 'm' ? 0.25 : 0.03;
    const da = Math.hypot(pos[0] - p.ancora[0], pos[1] - p.ancora[1]);
    if (da > zm) {
      if (da < 3 * Math.max(dt, (ts - (p.tAncora || ts)) / 1000) + zm) p.desloc += da;
      p.ancora = pos; p.tAncora = ts;
    }
    p.pos = pos; p.t = ts; p.unidade = unidade;
    if (unidade === 'm') {
      const ch = `${Math.floor(pos[0] / 0.25)},${Math.floor(pos[1] / 0.25)}`;
      this.calor.set(ch, (this.calor.get(ch) || 0) + 1);
      if (this.calor.size > 40000) this.calor.clear();
    }
    p.trilha.push(pos);
    if (p.trilha.length > 120) p.trilha.shift();
  }

  /** Persiste os intervalos emitidos (fecha o aberto e abre o novo, como _persistir). */
  registrar(ivs, ts) {
    for (const iv of ivs) {
      const nome = this.nomes.get(iv.posto_id) || iv.posto_id;
      if (iv.fim != null) {
        this.intervalos.push({ ...iv, nome });
        if (this.intervalos.length > MAX_INTERVALOS) this.intervalos.splice(0, this.intervalos.length - MAX_INTERVALOS);
        const ab = this.abertos.get(iv.posto_id);
        if (ab && ab.inicio === iv.inicio) this.abertos.delete(iv.posto_id);
      } else {
        this.abertos.set(iv.posto_id, { ...iv, nome });
        this.evento(iv.inicio, nome, ROTULO[iv.estado], `confiança ${(iv.confianca * 100).toFixed(0)} %`, iv.estado);
      }
    }
    if (ivs.length) this.alteracoes++;
  }

  evento(ts, posto, evento, detalhe = '', estado = '') {
    this.eventos.push({ ts, posto, evento, detalhe, estado });
    if (this.eventos.length > MAX_EVENTOS) this.eventos.splice(0, this.eventos.length - MAX_EVENTOS);
    if (this.aoEvento) { try { this.aoEvento({ ts, posto, evento, detalhe }); } catch (_) { /* segue */ } }
  }

  /** Todos os intervalos (fechados + abertos), opcionalmente de um posto. */
  todos(posto = null) {
    const l = this.intervalos.concat([...this.abertos.values()]);
    return posto ? l.filter((i) => i.posto_id === posto) : l;
  }

  /** Janela de KPI: o turno vigente (agenda) ou a sessão inteira. */
  janela(ts = this.ultTs) {
    if (ts == null) return null;
    if (this.cfg.turnos.length) {
      const j = this.agenda.janela(ts);
      if (j) return { de: j.inicio, ate: j.fim, nome: `Turno ${j.turno.nome}`, turno: j.turno };
    }
    return { de: this.inicio != null ? this.inicio : ts, ate: ts, nome: 'Sessão', turno: null };
  }

  /** KPIs da janela: geral e por posto (ranking por produtividade). */
  kpis(j = this.janela()) {
    if (!j) return null;
    const agora = this.ultTs;
    const ids = [...new Set([...this.nomes.keys()].filter((id) => this.em.estadoDe(id)).concat([...this.abertos.keys()]))];
    const todos = this.todos();
    const geral = kpiJanela(todos, j.de, j.ate, agora);
    const postos = ids.map((id) => ({ id, nome: this.nomes.get(id) || id, ...kpiJanela(todos.filter((i) => i.posto_id === id), j.de, j.ate, agora) }))
      .sort((a, b) => (b.produtividade == null ? -1 : b.produtividade) - (a.produtividade == null ? -1 : a.produtividade));
    return { janela: j, geral, postos };
  }

  // ------------------------------------------------------------ alarmes
  avaliarAlarmes(ts) {
    const A = this.cfg.alarmes;
    const k = this.kpis();
    const vivos = new Set();
    const subir = (chave, tipo, posto, valor, texto) => {
      vivos.add(chave);
      let a = this.alarmes.get(chave);
      if (!a || !a.ativo) {
        a = { chave, tipo, posto, desde: ts, ativo: true, reconhecido: false, valor, texto };
        this.alarmes.set(chave, a);
        this.evento(ts, posto, 'ALARME ' + tipo, texto);
      } else { a.valor = valor; a.texto = texto; }
    };
    for (const [pid, iv] of this.abertos) {
      const nome = this.nomes.get(pid) || pid;
      if (iv.estado === 'VAGO' && A.vagoMin > 0 && (ts - iv.inicio) / 60000 >= A.vagoMin) {
        subir(`vago:${pid}`, 'VAGO', nome, (ts - iv.inicio) / 60000, `${nome} vago há ${((ts - iv.inicio) / 60000).toFixed(1)} min (limite ${A.vagoMin} min)`);
      }
    }
    if (k) {
      for (const p of k.postos) {
        const base = p.produtivo + p.improdutivo;
        if (A.ociosoPct > 0 && base >= 60 && p.ociosidade != null && p.ociosidade * 100 > A.ociosoPct) {
          subir(`ocioso:${p.id}`, 'OCIOSO', p.nome, p.ociosidade * 100, `${p.nome}: ocioso ${(p.ociosidade * 100).toFixed(0)} % do tempo observado (limite ${A.ociosoPct} %)`);
        }
        if (A.coberturaMin > 0 && p.total >= 60 && p.cobertura != null && p.cobertura * 100 < A.coberturaMin) {
          subir(`cob:${p.id}`, 'COBERTURA', p.nome, p.cobertura * 100, `${p.nome}: cobertura ${(p.cobertura * 100).toFixed(0)} % — KPI não publicável (mín. ${A.coberturaMin} %)`);
        }
      }
    }
    for (const a of this.alarmes.values()) {
      if (a.ativo && !vivos.has(a.chave)) { a.ativo = false; a.fim = ts; this.evento(ts, a.posto, 'normalizou ' + a.tipo, a.texto); }
    }
  }

  reconhecer() { for (const a of this.alarmes.values()) a.reconhecido = true; this.alteracoes++; }
  alarmesAtivos() { return [...this.alarmes.values()].filter((a) => a.ativo); }

  // ------------------------------------------------------------ exportação
  intervalosCSV() {
    const q = csvCampo;
    const l = ['posto;estado;rotulo;inicio;fim;duracao_s;confianca;aberto'];
    for (const iv of this.todos().sort((a, b) => a.inicio - b.inicio || String(a.nome).localeCompare(b.nome))) {
      const fim = iv.fim != null ? iv.fim : this.ultTs;
      l.push([q(iv.nome), iv.estado, q(ROTULO[iv.estado]), iso(iv.inicio), iso(fim), ((fim - iv.inicio) / 1000).toFixed(1),
        iv.confianca.toFixed(4), iv.fim == null ? 'sim' : 'nao'].join(';'));
    }
    return '﻿' + l.join('\n');
  }

  kpiCSV() {
    const k = this.kpis();
    const l = ['janela;de;ate;posto;produtivo_s;ocioso_s;vago_s;planejado_s;nao_observado_s;produtividade;ociosidade;vacancia;ocupacao;cobertura;publicavel'];
    if (!k) return '﻿' + l.join('\n');
    const n4 = (v) => (v == null ? '' : v.toFixed(4));
    const lin = (nome, x) => [k.janela.nome, iso(k.janela.de), iso(k.janela.ate), csvCampo(nome), x.produtivo.toFixed(1), x.ocioso.toFixed(1), x.vago.toFixed(1),
      x.planejado.toFixed(1), x.sem_dado.toFixed(1), n4(x.produtividade), n4(x.ociosidade), n4(x.vacancia), n4(x.ocupacao), n4(x.cobertura), x.publicavel ? 'sim' : 'nao'].join(';');
    for (const p of k.postos) l.push(lin(p.nome, p));
    l.push(lin('TODOS', k.geral));
    return '﻿' + l.join('\n');
  }

  eventosCSV() {
    const l = ['hora;posto;evento;detalhe'];
    for (const e of this.eventos) l.push([iso(e.ts), csvCampo(e.posto), csvCampo(e.evento), csvCampo(e.detalhe)].join(';'));
    return '﻿' + l.join('\n');
  }

  /** Configuração exportável (sem nada da imagem: só números). */
  exportarConfig() { return JSON.stringify({ formato: 'gplansis.takt', ...this.cfg }, null, 2); }
}

function csvCampo(v) {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** ISO local com fuso (o CSV abre certo no Excel pt-BR e mantém o instante). */
export function iso(ms) {
  if (!fin(ms)) return '';
  const d = new Date(ms);
  const p = (n, k = 2) => String(n).padStart(k, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// ===================================================================== singleton + assinantes

const motor = new MotorTakt(lerCfg());
let salvas = motor.alteracoes;
let cfgSalva = JSON.stringify(motor.cfg);

export function obterMotor() { return motor; }

/** Grava a configuração se ela mudou. */
export function salvarCfg() {
  const s = JSON.stringify(motor.cfg);
  if (s === cfgSalva) return;
  cfgSalva = s;
  try { localStorage.setItem(CHAVE, s); } catch (_) { /* sem espaço: segue */ }
}

let fonte = null;
/** O workspace registra o ref da fonte do app (câmera, arquivo, tela, YouTube, stream). */
export function definirFonte(ref) { fonte = ref; }
export function tempoDaFonte() {
  const s = fonte && fonte.current;
  if (s && s.kind === 'video' && s.video && s.video.readyState >= 2) {
    return { video: true, t: s.video.currentTime, duracao: s.video.duration || 0, pausado: s.video.paused };
  }
  return { video: false, imagem: Boolean(s && s.kind === 'image') };
}

let retrato = null;
let quadro = null;
let studio = false;
let ultimoMs = 0;
const ouvintes = new Set();
let timer = null, ultimoAviso = 0;

/** O operador chama a cada amostra (quadro analisado). `img`: o quadro já borrado (privacidade). */
export function publicar(r, img) {
  retrato = r;
  if (img) quadro = img;
  ultimoMs = performance.now();
  if (motor.alteracoes !== salvas) { salvas = motor.alteracoes; salvarCfg(); }
  avisar();
}
export function instantaneo() { return retrato; }
export function ultimoQuadro() { return quadro; }
export function recente(ms = 3000) { return Boolean(retrato) && performance.now() - ultimoMs < ms; }
export function definirStudio(v) { studio = Boolean(v); }
export function studioAberto() { return studio; }

function avisar(ja = false) {
  if (ja) { ultimoAviso = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } } return; }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => {
    timer = null; ultimoAviso = performance.now();
    for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } }
  }, espera);
}
export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function avisarAgora() { salvarCfg(); avisar(true); }

/** Nova sessão: zera intervalos, eventos, alarmes, IDs (a configuração fica). */
export function novaSessao() {
  motor.reiniciar();
  retrato = retrato ? { ...retrato, pessoas: [], postos: (retrato.postos || []).map((p) => ({ ...p, estado: null, desde: null })) } : null;
  avisar(true);
}

export { ROTULO, ESTADOS, ERRO_MAX_CALIBRACAO_M, centroVertices };
