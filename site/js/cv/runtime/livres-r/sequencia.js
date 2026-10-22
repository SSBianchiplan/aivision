/**
 * cv/runtime/livres-r/sequencia.js — lógica de eventos da onda 2-a, sem DOM e
 * sem imagem (testável no Node com eventos sintéticos):
 *
 *   lerSequencia        "A; B; Parafuso x4" → passos (zona, vezes)
 *   SequenciaPokaYoke   máquina de estados do poka-yoke de montagem (I2):
 *                       pegada na caixa certa avança; caixa fora de ordem,
 *                       passo pulado, peça a mais, ciclo abandonado = DESVIO
 *   Permanencia         "a mão está na zona há ≥ tMin" com histerese de saída
 *   ContadorDoca        travessias de linha por ID (entrada/saída), uma vez por
 *                       sentido, com a classe mais votada (L4)
 *   conferir            esperado × contado × códigos → falta/sobra (L4)
 */

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
export { norm };

/**
 * Texto da sequência → [{ zona, vezes }]. Separadores ; , → ou quebra de
 * linha. "Parafuso x4", "Parafuso ×4" e "4x Parafuso" repetem o passo.
 * Sem texto, a ordem é a dos nomes das zonas (ordem alfabética/numérica,
 * "1 Base", "2 Tampa"…).
 */
export function lerSequencia(texto, nomesZonas = []) {
  const partes = String(texto || '').split(/[;,\n]|→|->/).map((s) => s.trim()).filter(Boolean);
  if (!partes.length) {
    return [...nomesZonas].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })).map((z) => ({ zona: z, vezes: 1 }));
  }
  const out = [];
  for (const p of partes) {
    let m = /^(.*?)\s*[x×*]\s*(\d+)$/i.exec(p);
    let nome = p, vezes = 1;
    if (m) { nome = m[1]; vezes = +m[2]; }
    else if ((m = /^(\d+)\s*[x×*]\s*(.+)$/i.exec(p))) { nome = m[2]; vezes = +m[1]; }
    // casa com a zona pelo nome (sem acento/caixa); aceita prefixo único
    const n = norm(nome);
    let z = nomesZonas.find((x) => norm(x) === n);
    if (!z) { const c = nomesZonas.filter((x) => norm(x).startsWith(n)); if (c.length === 1) z = c[0]; }
    out.push({ zona: z || nome.trim(), vezes: Math.max(1, Math.min(99, vezes)), existe: Boolean(z) });
  }
  return out;
}

/**
 * Permanência numa zona com histerese: `entrou` dispara UMA vez quando a
 * condição fica verdadeira por ≥ tMin; a zona só "solta" depois de tSaida
 * sem a condição (mão que pisca na detecção não gera duas pegadas).
 */
export class Permanencia {
  constructor() { this.m = new Map(); }
  passo(chave, dentro, t, tMin, tSaida) {
    let s = this.m.get(chave);
    if (!s) this.m.set(chave, (s = { desde: null, fora: null, ativo: false }));
    if (dentro) {
      s.fora = null;
      if (s.desde == null || t < s.desde) s.desde = t;
      if (!s.ativo && t - s.desde >= tMin) { s.ativo = true; return 'entrou'; }
    } else {
      if (s.fora == null || t < s.fora) s.fora = t;
      if (t - s.fora >= tSaida) { if (s.ativo) { s.ativo = false; s.desde = null; return 'saiu'; } s.desde = null; }
    }
    return s.ativo ? 'dentro' : null;
  }
  ativo(chave) { const s = this.m.get(chave); return Boolean(s && s.ativo); }
  limpar() { this.m.clear(); }
}

/**
 * Poka-yoke de sequência de montagem.
 *
 *   passos  [{ zona, vezes }]
 *   o.modo  'bloquear'  fora de ordem = desvio e o passo esperado continua o mesmo
 *           'seguir'    fora de ordem para um passo adiante = desvio "pulou" e a
 *                       sequência continua de lá
 *   o.fim   nome da zona de conclusão (gabarito/montagem) ou null: entrar nela
 *           antes do último passo = "incompleto" (faltou passo)
 *   o.tCicloMax  ciclo parado no meio por mais que isto = "abandonado"
 *
 * evento(zona, t) e tick(t) devolvem a lista de ocorrências do passo:
 *   { ev: 'ok'|'desvio'|'ciclo', … } (no desvio, `tipo` = fora de ordem,
 *   pulou, a mais, caixa errada, incompleto, abandonado)
 */
export class SequenciaPokaYoke {
  constructor(passos, o = {}) {
    this.passos = passos;
    this.o = { modo: 'bloquear', fim: null, tCicloMax: 120, ...o };
    this.reiniciar();
    this.ciclos = [];        // { n, inicio, fim, tempo, ok, desvios, passos: [s] }
    this.desvios = [];       // { t, ciclo, tipo, esperado, pegou, texto }
    this.nCiclo = 1;
  }

  reiniciar() {
    this.i = 0; this.c = 0; this.inicio = null; this.ult = null; this.tPasso = [];
    this.desviosCiclo = 0; this.tUltPasso = null;
  }

  get esperado() { return this.i < this.passos.length ? this.passos[this.i] : null; }

  _desvio(t, tipo, pegou, texto) {
    const d = { t, ciclo: this.nCiclo, tipo, esperado: this.esperado ? this.esperado.zona : (this.o.fim || '—'), pegou, texto };
    this.desvios.push(d);
    if (this.desvios.length > 2000) this.desvios.shift();
    this.desviosCiclo++;
    return { ev: 'desvio', ...d };
  }

  _fechar(t, completo) {
    const c = { n: this.nCiclo, inicio: this.inicio, fim: t, tempo: this.inicio != null ? t - this.inicio : 0,
                ok: completo && this.desviosCiclo === 0, completo, desvios: this.desviosCiclo, passos: this.tPasso.slice() };
    this.ciclos.push(c);
    if (this.ciclos.length > 2000) this.ciclos.shift();
    this.nCiclo++;
    this.reiniciar();
    return { ev: 'ciclo', ...c };
  }

  _avancar(t, zona) {
    const out = [];
    if (this.inicio == null) { this.inicio = t; this.tUltPasso = t; }
    this.c++;
    out.push({ ev: 'ok', t, zona, passo: this.i, vez: this.c });
    if (this.c >= this.passos[this.i].vezes) {
      this.tPasso.push(t - (this.tUltPasso ?? t));
      this.tUltPasso = t;
      this.i++; this.c = 0;
      if (this.i >= this.passos.length && !this.o.fim) out.push(this._fechar(t, true));
    }
    return out;
  }

  /** A mão "pegou" (entrou e ficou) na zona `zona` no instante t. */
  evento(zona, t) {
    this.ult = t;
    const n = norm(zona);
    const P = this.passos;
    // zona de conclusão
    if (this.o.fim && n === norm(this.o.fim)) {
      if (this.inicio == null) return [];      // mão no gabarito antes de começar: nada
      if (this.i >= P.length) return [this._fechar(t, true)];
      const falta = P.slice(this.i).map((p) => p.zona).join(', ');
      const d = this._desvio(t, 'incompleto', zona, `Montagem concluída sem: ${falta}`);
      return [d, this._fechar(t, false)];
    }
    const esp = this.esperado;
    if (esp && n === norm(esp.zona)) return this._avancar(t, zona);
    // já completou todos os passos e espera a conclusão: outra pegada = a mais
    if (!esp) return [this._desvio(t, 'a mais', zona, `Peça a mais de "${zona}" (esperado: concluir em ${this.o.fim})`)];
    // peça a mais do passo que acabou (ex.: um parafuso extra)
    if (this.i > 0 && this.c === 0 && n === norm(P[this.i - 1].zona)) {
      return [this._desvio(t, 'a mais', zona, `Peça a mais de "${zona}" (esperado: ${esp.zona})`)];
    }
    const j = P.findIndex((p, k) => k > this.i && norm(p.zona) === n);
    if (j < 0 && !P.some((p) => norm(p.zona) === n)) {
      return [this._desvio(t, 'caixa errada', zona, `Caixa fora da sequência: "${zona}" (esperado: ${esp.zona})`)];
    }
    if (this.o.modo === 'seguir' && j > this.i) {
      const pulados = P.slice(this.i, j).map((p) => p.zona).join(', ');
      const d = this._desvio(t, 'pulou', zona, `Pulou ${pulados}: pegou "${zona}" (esperado: ${esp.zona})`);
      if (this.inicio == null) { this.inicio = t; this.tUltPasso = t; }
      for (let k = this.i; k < j; k++) this.tPasso.push(NaN);
      this.i = j; this.c = 0;
      return [d, ...this._avancar(t, zona)];
    }
    return [this._desvio(t, 'fora de ordem', zona, `Fora de ordem: pegou "${zona}", esperado "${esp.zona}"`)];
  }

  /** Ciclo parado no meio por mais de tCicloMax → abandonado (registra e recomeça). */
  tick(t) {
    if (this.inicio != null && this.ult != null && t - this.ult > this.o.tCicloMax) {
      const falta = this.passos.slice(this.i).map((p) => p.zona).join(', ');
      const d = this._desvio(t, 'abandonado', '—', `Ciclo parado por ${Math.round(t - this.ult)} s sem: ${falta}`);
      return [d, this._fechar(t, false)];
    }
    return [];
  }

  resumo() {
    const n = this.ciclos.length, ok = this.ciclos.filter((c) => c.ok).length;
    const tempos = this.ciclos.filter((c) => c.completo).map((c) => c.tempo).sort((a, b) => a - b);
    return { ciclos: n, ok, nok: n - ok, fpy: n ? ok / n : NaN,
             tMediano: tempos.length ? tempos[tempos.length >> 1] : NaN, desvios: this.desvios.length };
  }
}

// ------------------------------------------------------------------ conferência de doca (L4)

/** "caixa, box; pacote" → Set normalizado. */
export const listaClasses = (s) => new Set(String(s || '').split(/[,;\n]/).map(norm).filter(Boolean));

/** Lado de P em relação à reta A→B (produto vetorial, em px). */
const ladoPx = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
/** Lado com o zero contado como negativo: um ponto EM CIMA da linha não some do cruzamento. */
const sinal = (v) => (v > 0 ? 1 : -1);
function cruzaSeg(p, q, a, b) {
  if (sinal(ladoPx(a, b, p)) === sinal(ladoPx(a, b, q))) return false;
  const d3 = ladoPx(p, q, a), d4 = ladoPx(p, q, b);
  return d3 * d4 <= 0;
}

/**
 * Travessias de linha por ID. Sentido "entrada" = do lado esquerdo da seta
 * A→B para o direito (em coordenadas de tela, y para baixo: o lado em que
 * o produto vetorial é negativo → positivo); `inverter` troca por linha.
 * Um ID conta uma vez por sentido em cada linha até voltar a cruzar no
 * sentido oposto (vai-e-volta na porta não infla a contagem).
 */
export class ContadorDoca {
  constructor() { this.ids = new Map(); this.eventos = []; }

  /**
   * objs [{ id, x, y (px), classe }], linhas [{ id, nome, a:[x,y], b:[x,y], inverter }]
   * mapa(classe) → 'volume' | 'pallet' | null
   */
  passo(objs, linhas, t, mapa) {
    const novos = [];
    const vistos = new Set();
    for (const o of objs) {
      if (o.id == null) continue;
      vistos.add(o.id);
      let s = this.ids.get(o.id);
      if (!s) this.ids.set(o.id, (s = { x: o.x, y: o.y, votos: new Map(), ult: new Map(), perdido: 0 }));
      s.perdido = 0;
      if (o.classe) s.votos.set(o.classe, (s.votos.get(o.classe) || 0) + 1);
      const p = [s.x, s.y], q = [o.x, o.y];
      for (const L of linhas) {
        if (!cruzaSeg(p, q, L.a, L.b)) continue;
        let entra = sinal(ladoPx(L.a, L.b, p)) < 0;
        if (L.inverter) entra = !entra;
        const sentido = entra ? 'entrada' : 'saída';
        if (s.ult.get(L.id) === sentido) continue;      // mesmo sentido de novo sem voltar
        s.ult.set(L.id, sentido);
        let classe = o.classe, best = 0;
        for (const [c, n] of s.votos) if (n > best) { best = n; classe = c; }
        const tipo = mapa ? mapa(classe) : 'volume';
        if (!tipo) continue;
        const ev = { t, id: o.id, linha: L.nome, sentido, classe, tipo };
        this.eventos.push(ev); novos.push(ev);
        if (this.eventos.length > 20000) this.eventos.shift();
      }
      s.x = o.x; s.y = o.y;
    }
    for (const [id, s] of this.ids) if (!vistos.has(id) && ++s.perdido > 300) this.ids.delete(id);
    return novos;
  }

  /** Totais { linha: { entrada: {volume, pallet}, saída: {…} } } desde t0. */
  totais(t0 = -Infinity) {
    const T = {};
    for (const e of this.eventos) {
      if (e.t < t0) continue;
      const L = (T[e.linha] = T[e.linha] || { entrada: { volume: 0, pallet: 0 }, 'saída': { volume: 0, pallet: 0 } });
      L[e.sentido][e.tipo] = (L[e.sentido][e.tipo] || 0) + 1;
    }
    return T;
  }
}

/** "123; 456\n789" → lista de códigos esperados (sem espaços, sem vazios, sem repetição). */
export function lerCodigos(s) {
  return [...new Set(String(s || '').split(/[\s;,]+/).map((x) => x.trim()).filter(Boolean))];
}

/**
 * Confere uma doca: líquido contado (entradas − saídas no recebimento,
 * saídas − entradas na expedição) contra o esperado; códigos lidos × lista.
 *   esperado { volumes, pallets, codigos: [] }   (volumes/pallets < 0 = não conferir)
 *   totais   de ContadorDoca.totais (somadas todas as linhas, ou só `linha`)
 */
export function conferir(tipo, esperado, totais, lidos = []) {
  let ent = { volume: 0, pallet: 0 }, sai = { volume: 0, pallet: 0 };
  for (const L of Object.values(totais)) {
    ent.volume += L.entrada.volume || 0; ent.pallet += L.entrada.pallet || 0;
    sai.volume += L['saída'].volume || 0; sai.pallet += L['saída'].pallet || 0;
  }
  const rec = tipo !== 'expedição';
  const liq = { volume: rec ? ent.volume - sai.volume : sai.volume - ent.volume, pallet: rec ? ent.pallet - sai.pallet : sai.pallet - ent.pallet };
  const dif = (esp, v) => (esp >= 0 ? v - esp : null);
  const setL = new Set(lidos);
  const esp = esperado.codigos || [];
  const setE = new Set(esp);
  const faltam = esp.filter((c) => !setL.has(c)), sobram = [...setL].filter((c) => esp.length && !setE.has(c));
  const dv = dif(esperado.volumes, liq.volume), dp = dif(esperado.pallets, liq.pallet);
  const ok = (dv == null || dv === 0) && (dp == null || dp === 0) && !faltam.length && !sobram.length;
  return { entradas: ent, saidas: sai, liquido: liq, difVolumes: dv, difPallets: dp, faltam, sobram, ok,
           conferido: dv != null || dp != null || esp.length > 0 };
}
