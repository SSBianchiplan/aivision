/**
 * cv/runtime/livres-l/esteira.js — CONTAGEM EM ESTEIRA (CV-38): o motor de
 * produção e a ponte com as telas.
 *
 * O operador `contagem.esteira` (operators/livres-l/contagem.js) recebe a
 * cada quadro os eventos que o CV-37 `cena.zonas` produziu (ctx.cena.eventos:
 * cruzamento de linha com sentido, entrada em zona) e aqui viram PRODUÇÃO:
 *
 *   - total contado (pela base escolhida: linhas, zonas ou as duas; pelo
 *     sentido: ida, volta, ambos ou líquido), por sentido, por classe e por
 *     marcação;
 *   - taxa em peças/min (janela móvel) e peças/h, gráfico por minuto;
 *   - TURNOS (texto "T1 06:00-14:00; T2 14:00-22:00; T3 22:00-06:00"),
 *     total por turno guardado neste navegador, META por turno com
 *     projeção para o fim do turno;
 *   - ALARMES: parada (nenhuma peça em N s), taxa baixa e taxa alta, com
 *     reconhecimento e histórico (estados como na ISA-18.2: ativo não
 *     reconhecido, ativo reconhecido, voltou ao normal sem reconhecer);
 *   - EVENTOS com hora, tempo da fonte, turno, marcação, ID, sentido, classe e
 *     confiança — exportáveis em CSV.
 *
 * FILA OFFLINE: o CounterVision mandava os eventos ao servidor por uma fila
 * persistida (store-and-forward). O iaVision é local: a fila grava em
 * IndexedDB ('aiv-contador' › 'eventos'; sem IndexedDB, localStorage com
 * teto) a cada 2 s, sobrevive a recarregar a página e sai em CSV — e pode ser
 * esvaziada depois de exportada.
 *
 * TEMPO: a base de tempo é o TEMPO ATIVO da fonte — num arquivo de vídeo,
 * o tempo do vídeo (a taxa é a do ensaio, não a do relógio; pausar não
 * dispara "parada"); ao vivo, o relógio, parado enquanto a fonte estiver
 * parada (YouTube pausado, histórico). As horas dos eventos são do relógio.
 */
import { MotorCor } from './cor.js';

const fin = Number.isFinite;
const CHAVE_TURNOS = 'aiv.contador.turnos';
const CHAVE_FILA = 'aiv.contador.fila';

// ------------------------------------------------------------------ turnos

/** "T1 06:00-14:00; T2 14:00-22:00" → [{ nome, ini (min), fim (min) }]. */
export function lerTurnos(txt) {
  const out = [];
  for (const parte of String(txt || '').split(/[;,\n]/)) {
    const m = /^\s*([^\d\s][^\s]*)?\s*(\d{1,2})[:h](\d{2})\s*[-–a]\s*(\d{1,2})[:h](\d{2})\s*$/i.exec(parte);
    if (!m) continue;
    const ini = (+m[2]) * 60 + (+m[3]), fim = (+m[4]) * 60 + (+m[5]);
    if (ini > 1440 || fim > 1440 || ini === fim) continue;
    out.push({ nome: m[1] || `T${out.length + 1}`, ini, fim });
  }
  return out;
}

const dois = (n) => String(n).padStart(2, '0');
const dataISO = (d) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const hhmm = (min) => `${dois(Math.floor(min / 60) % 24)}:${dois(min % 60)}`;

/** Turno do instante `ms`: { nome, chave, rotulo, inicio (ms), fim (ms) }, ou o dia inteiro. */
export function turnoDe(ms, turnos) {
  const d = new Date(ms);
  const min = d.getHours() * 60 + d.getMinutes();
  for (const t of turnos) {
    const vira = t.fim <= t.ini;     // passa da meia-noite
    const dentro = vira ? min >= t.ini || min < t.fim : min >= t.ini && min < t.fim;
    if (!dentro) continue;
    const ini = new Date(d); ini.setHours(0, 0, 0, 0);
    if (vira && min < t.fim) ini.setDate(ini.getDate() - 1);
    const inicio = ini.getTime() + t.ini * 60000;
    const fim = inicio + (((t.fim - t.ini + 1440) % 1440) || 1440) * 60000;
    return { nome: t.nome, chave: `${dataISO(ini)} ${t.nome}`, rotulo: `${t.nome} ${hhmm(t.ini)}–${hhmm(t.fim)}`, inicio, fim };
  }
  const ini = new Date(d); ini.setHours(0, 0, 0, 0);
  return { nome: 'dia', chave: `${dataISO(ini)} dia`, rotulo: 'dia inteiro', inicio: ini.getTime(), fim: ini.getTime() + 86400000 };
}

// ------------------------------------------------------------------ fila persistida (IndexedDB)

let dbP = null;
function abrirDB() {
  if (dbP) return dbP;
  dbP = new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') { res(null); return; }
      const rq = indexedDB.open('aiv-contador', 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('eventos')) db.createObjectStore('eventos', { keyPath: 'k', autoIncrement: true });
        if (!db.objectStoreNames.contains('modelos')) db.createObjectStore('modelos', { keyPath: 'id' });
      };
      rq.onsuccess = () => {
        const db = rq.result;
        // outra aba atualizando o banco, ou o navegador fechando a conexão: a próxima gravação reabre
        db.onversionchange = () => { try { db.close(); } catch (_) { /* segue */ } dbP = null; };
        db.onclose = () => { dbP = null; };
        res(db);
      };
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch (_) { res(null); }
  });
  return dbP;
}
export { abrirDB };

function tx(db, modo, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction('eventos', modo);
    const st = t.objectStore('eventos');
    const out = fn(st);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

class Fila {
  constructor() { this.pend = []; this.guardados = 0; this.erro = null; this.lendo = this._contar(); }
  async _contar() {
    const db = await abrirDB();
    if (!db) { this.guardados = this._ls().length; return; }
    try { this.guardados = await tx(db, 'readonly', (s) => s.count()); } catch (e) { this.erro = String(e); }
  }
  _ls() { try { return JSON.parse(localStorage.getItem(CHAVE_FILA) || '[]') || []; } catch (_) { return []; } }
  por(ev) { this.pend.push(ev); }
  async gravar() {
    if (!this.pend.length) return;
    const lote = this.pend.splice(0, this.pend.length);
    const db = await abrirDB();
    try {
      if (db) await tx(db, 'readwrite', (s) => { for (const e of lote) s.add(e); });
      else {
        const l = this._ls().concat(lote);
        if (l.length > 5000) l.splice(0, l.length - 5000);
        localStorage.setItem(CHAVE_FILA, JSON.stringify(l));
      }
      this.guardados += lote.length; this.erro = null;
    } catch (e) {
      dbP = null;                          // conexão fechada ("database connection is closing"): reabre na próxima
      this.pend.unshift(...lote);          // volta para a fila: tenta de novo no próximo ciclo
      if (this.pend.length > 50000) this.pend.splice(0, this.pend.length - 50000);
      this.erro = String(e && e.message ? e.message : e);
    }
  }
  async todos() {
    await this.gravar();
    const db = await abrirDB();
    if (!db) return this._ls();
    return tx(db, 'readonly', (s) => s.getAll());
  }
  async esvaziar() {
    const db = await abrirDB();
    if (db) await tx(db, 'readwrite', (s) => s.clear());
    try { localStorage.removeItem(CHAVE_FILA); } catch (_) { /* segue */ }
    this.guardados = 0;
  }
}

// ------------------------------------------------------------------ alarmes

export const ALARMES = {
  PARADA: { tag: 'PARADA', texto: 'Esteira parada: nenhuma peça contada', prio: 1, acao: 'Verifique a alimentação da esteira e a câmera.' },
  TAXA_BAIXA: { tag: 'TAXA_BAIXA', texto: 'Taxa abaixo do mínimo', prio: 2, acao: 'Confira o ritmo da linha e a meta do turno.' },
  TAXA_ALTA: { tag: 'TAXA_ALTA', texto: 'Taxa acima do máximo', prio: 2, acao: 'Confira se há dupla contagem ou acúmulo na esteira.' },
};

// ------------------------------------------------------------------ motor

export class MotorEsteira {
  constructor() {
    this.fila = new Fila();
    this.turnosSalvos = this._lerTurnos();
    this.alarme = {};
    for (const k of Object.keys(ALARMES)) this.alarme[k] = { estado: 'NORMAL', desde: 0, valor: null };
    this.jornal = [];
    this.zerar(false);
    this._timer = setInterval(() => { this.fila.gravar(); }, 2000);
  }

  _lerTurnos() { try { return JSON.parse(localStorage.getItem(CHAVE_TURNOS) || '{}') || {}; } catch (_) { return {}; } }
  _salvarTurnos() {
    const ks = Object.keys(this.turnosSalvos).sort();
    if (ks.length > 90) for (const k of ks.slice(0, ks.length - 90)) delete this.turnosSalvos[k];
    try { localStorage.setItem(CHAVE_TURNOS, JSON.stringify(this.turnosSalvos)); } catch (_) { /* sem espaço */ }
  }

  /** Zera a sessão de contagem (o histórico por turno e a fila guardada ficam). */
  zerar(registrar = true) {
    this.tb = 0;                 // tempo ativo (s)
    this.tInicio = null;         // tb do primeiro quadro contando
    this.tUltima = null;         // tb da última peça
    this.total = 0; this.ida = 0; this.volta = 0; this.entradas = 0;
    this.porClasse = {}; this.porMarcacao = {};
    this.tempos = [];            // tb das peças contadas (janela da taxa)
    this.minutos = [];           // [{ b (minuto), n, rot (hh:mm) }]
    this.eventos = [];           // recentes (memória)
    this.n = 0;
    this.ignorados = 0;
    this.taxa = null; this.taxaH = null;
    this.ultimoWall = 0;
    this.metaAvisada = '';
    if (registrar) this._jornal('ZERAR', 'contagem zerada', null);
  }

  _jornal(tag, ev, valor) {
    this.jornal.unshift({ hora: new Date().toISOString(), t: +this.tb.toFixed(2), tag, ev, valor });
    if (this.jornal.length > 500) this.jornal.length = 500;
  }

  /**
   * Um quadro. `evs` = ctx.cena.eventos; `cfg` = parâmetros do nó;
   * `dt` = tempo ativo decorrido (s; 0 com a fonte parada); `temLinha`.
   */
  quadro(evs, cfg, dt, temLinha, turnos) {
    const agora = Date.now();
    this.ultimoWall = agora;
    if (dt > 0) this.tb += dt;
    if (this.tInicio == null && dt > 0) this.tInicio = this.tb;
    const tb = this.tb;
    const turno = turnoDe(agora, turnos);
    this.turno = turno;
    const base = cfg.base === 'automático' ? (temLinha ? 'linhas' : 'zonas') : cfg.base;
    const reg = this.turnosSalvos[turno.chave] || (this.turnosSalvos[turno.chave] = { total: 0, ida: 0, volta: 0, inicio: turno.inicio, fim: turno.fim, rotulo: turno.rotulo });
    let mudouTurno = false;
    for (const e of evs || []) {
      const ehLinha = e.tipo === 'linha';
      if (ehLinha ? base === 'zonas' : base === 'linhas') continue;
      let delta = 0;
      if (ehLinha) {
        if (cfg.sentido === 'ambos (soma)') delta = 1;
        else if (cfg.sentido === 'ida') delta = e.sentido === 'ida' ? 1 : 0;
        else if (cfg.sentido === 'volta') delta = e.sentido === 'volta' ? 1 : 0;
        else delta = e.sentido === 'ida' ? 1 : -1;   // líquido
      } else delta = 1;
      if (!delta) { this.ignorados++; continue; }
      const conf = fin(e.score) ? e.score : null;
      if (cfg.confMin > 0 && conf != null && conf < cfg.confMin) { this.ignorados++; continue; }
      this.total += delta;
      if (ehLinha) { if (e.sentido === 'ida') this.ida++; else this.volta++; } else this.entradas++;
      const cl = e.classe || 'objeto';
      this.porClasse[cl] = (this.porClasse[cl] || 0) + delta;
      const pm = this.porMarcacao[e.nome] || (this.porMarcacao[e.nome] = { tipo: e.tipo, ida: 0, volta: 0, entradas: 0 });
      if (ehLinha) pm[e.sentido]++; else pm.entradas++;
      reg.total += delta; if (ehLinha) reg[e.sentido]++;
      mudouTurno = true;
      if (delta > 0) {
        this.tempos.push(tb);
        this.tUltima = tb;
        const b = Math.floor(tb / 60);
        const ult = this.minutos[this.minutos.length - 1];
        if (ult && ult.b === b) ult.n++;
        else {
          const d = new Date(agora);
          this.minutos.push({ b, n: 1, rot: `${dois(d.getHours())}:${dois(d.getMinutes())}` });
          if (this.minutos.length > 240) this.minutos.shift();
        }
      }
      const ev = {
        n: ++this.n, hora: new Date(agora).toISOString(), t: +tb.toFixed(2), turno: turno.chave, marcacao: e.nome || '',
        tipo: e.tipo, sentido: e.sentido, id: e.id == null ? '' : e.id, classe: cl, confianca: conf == null ? '' : +conf.toFixed(3), delta,
      };
      this.eventos.push(ev);
      if (this.eventos.length > 2000) this.eventos.splice(0, this.eventos.length - 2000);
      this.fila.por(ev);
    }
    if (this.tempos.length > 20000) this.tempos.splice(0, this.tempos.length - 20000);
    if (mudouTurno) this._salvarTurnos();

    // taxa: peças na janela / tempo coberto pela janela
    const jan = Math.max(5, cfg.janelaS || 60);
    const decorrido = this.tInicio == null ? 0 : tb - this.tInicio;
    if (decorrido >= Math.min(10, jan)) {
      let k = 0;
      for (let i = this.tempos.length - 1; i >= 0 && this.tempos[i] > tb - jan; i--) k++;
      this.taxa = (k / Math.min(jan, decorrido)) * 60;
      let kh = 0;
      for (let i = this.tempos.length - 1; i >= 0 && this.tempos[i] > tb - 3600; i--) kh++;
      this.taxaH = decorrido >= 3600 ? kh : this.taxa * 60;
    } else { this.taxa = null; this.taxaH = null; }

    // meta do turno
    if (cfg.meta > 0 && reg.total >= cfg.meta && this.metaAvisada !== turno.chave) {
      this.metaAvisada = turno.chave;
      this._jornal('META', `meta do turno ${turno.nome} atingida (${reg.total}/${cfg.meta})`, reg.total);
    }

    // alarmes (só com tempo andando)
    if (dt > 0) {
      const semPeca = this.tUltima == null ? decorrido : tb - this.tUltima;
      // parada só depois da primeira peça: a esteira começa vazia (e o vídeo, antes da 1ª peça chegar à linha)
      this._alarme('PARADA', cfg.paradaS > 0 && this.tUltima != null && semPeca >= cfg.paradaS, semPeca);
      const pronto = decorrido >= jan;
      this._alarme('TAXA_BAIXA', cfg.taxaMin > 0 && pronto && this.taxa != null && this.taxa < cfg.taxaMin, this.taxa);
      this._alarme('TAXA_ALTA', cfg.taxaMax > 0 && pronto && this.taxa != null && this.taxa > cfg.taxaMax, this.taxa);
    }
    return this.resumo(cfg);
  }

  _alarme(tag, cond, valor) {
    const a = this.alarme[tag];
    a.valor = fin(valor) ? valor : null;
    if (cond) {
      if (a.estado === 'NORMAL' || a.estado === 'RTN_NR') {
        a.estado = 'ATIVO_NR'; a.desde = Date.now();
        this._jornal(tag, 'ativou: ' + ALARMES[tag].texto, a.valor);
      }
    } else if (a.estado === 'ATIVO_NR') { a.estado = 'RTN_NR'; this._jornal(tag, 'voltou ao normal (não reconhecido)', a.valor); }
    else if (a.estado === 'ATIVO_R') { a.estado = 'NORMAL'; this._jornal(tag, 'voltou ao normal', a.valor); }
  }

  reconhecer() {
    for (const [tag, a] of Object.entries(this.alarme)) {
      if (a.estado === 'ATIVO_NR') { a.estado = 'ATIVO_R'; this._jornal(tag, 'reconhecido', a.valor); }
      else if (a.estado === 'RTN_NR') { a.estado = 'NORMAL'; this._jornal(tag, 'reconhecido (já normal)', a.valor); }
    }
  }

  ativos() { return Object.entries(this.alarme).filter(([, a]) => a.estado !== 'NORMAL').map(([tag, a]) => ({ ...ALARMES[tag], ...a })); }

  /** Retrato para as telas. */
  resumo(cfg = {}) {
    const t = this.turno || turnoDe(Date.now(), lerTurnos(cfg.turnos));
    const reg = this.turnosSalvos[t.chave] || { total: 0 };
    const restanteMin = Math.max(0, (t.fim - Date.now()) / 60000);
    const meta = cfg.meta || 0;
    return {
      total: this.total, ida: this.ida, volta: this.volta, entradas: this.entradas, porClasse: this.porClasse,
      porMarcacao: this.porMarcacao, taxa: this.taxa, taxaH: this.taxaH, tb: this.tb, tUltima: this.tUltima,
      turno: t, totalTurno: reg.total, meta, pctMeta: meta > 0 ? reg.total / meta : null,
      projecao: this.taxa != null ? Math.round(reg.total + this.taxa * restanteMin) : null, restanteMin,
      minutos: this.minutos, eventos: this.eventos, alarmes: this.ativos(), ignorados: this.ignorados,
      guardados: this.fila.guardados + this.fila.pend.length, erroFila: this.fila.erro,
    };
  }

  historicoTurnos() {
    return Object.entries(this.turnosSalvos).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([chave, v]) => ({ chave, ...v }));
  }
}

// ------------------------------------------------------------------ CSV

const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function csvEventos(lista) {
  const L = ['n;hora;t_fonte_s;turno;marcacao;tipo;sentido;id;classe;confianca;conta'];
  for (const e of lista) L.push([e.n, e.hora, e.t, e.turno, e.marcacao, e.tipo, e.sentido, e.id, e.classe, e.confianca, e.delta].map(q).join(';'));
  return L.join('\n');
}
export function csvJornal(lista) {
  const L = ['hora;t_fonte_s;tag;evento;valor'];
  for (const e of lista) L.push([e.hora, e.t, e.tag, e.ev, e.valor == null ? '' : (+e.valor).toFixed(2)].map(q).join(';'));
  return L.join('\n');
}
export function csvTurnos(lista, meta) {
  const L = ['turno;inicio;fim;total;ida;volta;meta;atingido_pct'];
  for (const t of lista) L.push([t.chave, new Date(t.inicio).toISOString(), new Date(t.fim).toISOString(), t.total, t.ida || 0, t.volta || 0, meta || '', meta ? ((t.total / meta) * 100).toFixed(1) : ''].map(q).join(';'));
  return L.join('\n');
}

// ------------------------------------------------------------------ canal (operador ↔ telas)

const cor = new MotorCor();
const esteira = new MotorEsteira();
export function motorCor() { return cor; }
export function motorEsteira() { return esteira; }

let retrato = null;           // { W, H, dets, itens, cena, resumo, t (performance.now) }
let studio = false;
const ouvintes = new Set();
let timer = null, ultimoAviso = 0;

export function publicar(r) { retrato = r; avisar(); }
export function instantaneo() { return retrato; }
export function recente(ms = 3000) { return Boolean(retrato) && performance.now() - retrato.t < ms; }
export function definirStudio(v) { studio = Boolean(v); }
export function studioAberto() { return studio; }

function avisar(ja = false) {
  const chamar = () => { ultimoAviso = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } } };
  if (ja) { chamar(); return; }
  if (timer) return;
  timer = setTimeout(() => { timer = null; chamar(); }, Math.max(0, 250 - (performance.now() - ultimoAviso)));
}
/** Assina o retrato (no máximo 4×/s). Devolve a função que cancela. */
export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function avisarAgora() { avisar(true); }
