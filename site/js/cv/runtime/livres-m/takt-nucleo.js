/**
 * cv/runtime/livres-m/takt-nucleo.js — NÚCLEO DO TAKT (CV-39), porte fiel do
 * worker de visão do GPlanSiS|Takt (vision/worker/*.py). JS puro, sem DOM:
 * roda no navegador (operador takt.posto) e no Node (testes contra o Python).
 *
 *   geometry.py       pontoNoPoligono, distanciaAoPoligono, homografia (DLT por
 *                     SVD, erro RMS de reprojeção em metros) e paraPiso;
 *                     as recusas de backend/app/domain/calibracao.py (pontos
 *                     repetidos ou colineares) entram junto.
 *   pose_features.py  ActivityScorer: escore 0..1 = mãos na ROI do posto +
 *                     energia de movimento dos punhos (normalizada pelo torso)
 *                     + orientação do corpo para o posto.
 *   event_manager.py  EventManager: amostras → intervalos de estado por posto,
 *                     com histerese (act_on/act_off) e tempos de confirmação
 *                     que RETROAGEM ao instante em que o candidato surgiu;
 *                     contabilizar() por categoria.
 *   turnos.py         Agenda de turnos e pausas no fuso da planta (turno que
 *                     cruza a meia-noite pertence ao dia em que começa).
 *   privacy.py        regioesRosto(): onde borrar, a partir dos keypoints da
 *                     cabeça (nariz, olhos, orelhas) — sem detector facial.
 *
 * Tempo: os instantes são milissegundos (epoch, como Date.now()); durações
 * nos parâmetros continuam em SEGUNDOS, como no Python.
 * Pontos: arrays [x, y]. Keypoints: 17 pontos COCO em px + 17 confianças.
 */

// ===================================================================== estados

export const ESTADOS = ['PRODUTIVO', 'OCIOSO_NO_POSTO', 'VAGO', 'PAUSA_PROGRAMADA', 'NAO_OBSERVADO'];
export const Estado = Object.freeze(Object.fromEntries(ESTADOS.map((e) => [e, e])));

/** Rótulos pt-BR (os mesmos do front do Takt, lib/format.ts). */
export const ROTULO = {
  PRODUTIVO: 'Produtivo', OCIOSO_NO_POSTO: 'Ocioso no posto', VAGO: 'Posto vago',
  PAUSA_PROGRAMADA: 'Pausa programada', NAO_OBSERVADO: 'Não observado',
};

/** Categoria de KPI de cada estado (event_manager.contabilizar). */
export const CATEGORIA = {
  PRODUTIVO: 'PRODUTIVO', OCIOSO_NO_POSTO: 'IMPRODUTIVO', VAGO: 'IMPRODUTIVO',
  PAUSA_PROGRAMADA: 'PLANEJADO', NAO_OBSERVADO: 'SEM_DADO',
};

// ===================================================================== geometria (geometry.py)

/** Ray casting. Borda conta como dentro. */
export function pontoNoPoligono(p, poly) {
  const x = p[0], y = p[1];
  let dentro = false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
    if (noSegmento(p, a, b)) return true;
    if ((y1 > y) !== (y2 > y)) {
      const xin = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
      if (x < xin) dentro = !dentro;
    }
  }
  return dentro;
}

function noSegmento(p, a, b, eps = 1e-9) {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > eps) return false;
  return Math.min(a[0], b[0]) - eps <= p[0] && p[0] <= Math.max(a[0], b[0]) + eps
      && Math.min(a[1], b[1]) - eps <= p[1] && p[1] <= Math.max(a[1], b[1]) + eps;
}

/** Distância euclidiana até o polígono (na unidade dos pontos); 0 se dentro. */
export function distanciaAoPoligono(p, poly) {
  if (pontoNoPoligono(p, poly)) return 0;
  let best = Infinity;
  const px = p[0], py = p[1];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const ax = poly[i][0], ay = poly[i][1];
    const bx = poly[(i + 1) % n][0], by = poly[(i + 1) % n][1];
    const dx = bx - ax, dy = by - ay;
    const seg2 = dx * dx + dy * dy;
    const t = seg2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / seg2));
    const cx = ax + t * dx, cy = ay + t * dy;
    best = Math.min(best, Math.sqrt((px - cx) ** 2 + (py - cy) ** 2));
  }
  return best;
}

/** Centroide simples (média dos vértices), como o worker usa para o centro da ROI. */
export function centroVertices(poly) {
  let x = 0, y = 0;
  for (const q of poly) { x += q[0]; y += q[1]; }
  return [x / poly.length, y / poly.length];
}

/**
 * SVD de uma matriz m×n (m ≥ n) por Jacobi de um lado (Hestenes): ortogonaliza
 * as colunas aos pares e acumula as rotações em V. Devolve { s, V } com V em
 * colunas (V[i][j] = componente i do vetor singular j). Precisão de máquina,
 * sem formar AᵀA (que elevaria o número de condição ao quadrado — os pontos
 * da homografia estão em pixels, ~10³, e os produtos u·x passam de 10⁴).
 */
function svdJacobi(A) {
  const m = A.length, n = A[0].length;
  const U = A.map((r) => r.slice());
  const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let varre = 0; varre < 80; varre++) {
    let girou = false;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        let a = 0, b = 0, g = 0;
        for (let i = 0; i < m; i++) { a += U[i][p] * U[i][p]; b += U[i][q] * U[i][q]; g += U[i][p] * U[i][q]; }
        if (Math.abs(g) <= 1e-15 * Math.sqrt(a * b) || g === 0) continue;
        girou = true;
        const zeta = (b - a) / (2 * g);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < m; i++) { const up = U[i][p], uq = U[i][q]; U[i][p] = c * up - s * uq; U[i][q] = s * up + c * uq; }
        for (let i = 0; i < n; i++) { const vp = V[i][p], vq = V[i][q]; V[i][p] = c * vp - s * vq; V[i][q] = s * vp + c * vq; }
      }
    }
    if (!girou) break;
  }
  const s = [];
  for (let j = 0; j < n; j++) { let t = 0; for (let i = 0; i < m; i++) t += U[i][j] * U[i][j]; s.push(Math.sqrt(t)); }
  return { s, V };
}

/** Pontos colineares (calibracao.py::_colineares): menor valor singular ~ 0. */
function colineares(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  const { s } = svdJacobi(pts.map((p) => [p[0] - mx, p[1] - my]));
  const ord = s.slice().sort((a, b) => b - a);
  return ord[ord.length - 1] < 1e-6 * Math.max(1, ord[0]);
}

/**
 * Homografia imagem→piso por DLT (≥ 4 pares), como Homography.from_points:
 * h = vetor singular de menor valor de A, normalizado por h33. Devolve
 * { H: 3×3, erro: RMS de reprojeção (unidade do piso, m) }. Recusa pares a
 * menos, pontos repetidos, colineares ou calibração degenerada (calibracao.py).
 */
export function homografia(img, piso) {
  if (!Array.isArray(img) || !Array.isArray(piso) || img.length < 4 || img.length !== piso.length) {
    throw new Error('homografia exige ≥ 4 pares imagem/piso');
  }
  const chave = (p) => `${p[0]},${p[1]}`;
  if (new Set(img.map(chave)).size !== img.length || new Set(piso.map(chave)).size !== piso.length) {
    throw new Error('pontos repetidos na calibração');
  }
  if (colineares(img) || colineares(piso)) throw new Error('pontos colineares: espalhe os marcos pelo piso (não em linha)');
  const A = [];
  for (let i = 0; i < img.length; i++) {
    const [u, v] = img[i], [x, y] = piso[i];
    A.push([-u, -v, -1, 0, 0, 0, u * x, v * x, x]);
    A.push([0, 0, 0, -u, -v, -1, u * y, v * y, y]);
  }
  // com 4 pares A é 8×9: completa com uma linha de zeros (não muda o núcleo) para m ≥ n
  while (A.length < 9) A.push(new Array(9).fill(0));
  const { s, V } = svdJacobi(A);
  let k = 0;
  for (let j = 1; j < s.length; j++) if (s[j] < s[k]) k = j;
  const h = V.map((r) => r[k]);
  if (Math.abs(h[8]) < 1e-12) throw new Error('calibração degenerada');
  const H = [[h[0] / h[8], h[1] / h[8], h[2] / h[8]], [h[3] / h[8], h[4] / h[8], h[5] / h[8]], [h[6] / h[8], h[7] / h[8], 1]];
  let soma = 0;
  for (let i = 0; i < img.length; i++) {
    const q = paraPiso(H, img[i]);
    soma += (q[0] - piso[i][0]) ** 2 + (q[1] - piso[i][1]) ** 2;
  }
  return { H, erro: Math.sqrt(soma / img.length) };
}

/** Pixel → piso (Homography.to_floor). */
export function paraPiso(H, p) {
  const u = p[0], v = p[1];
  const x = H[0][0] * u + H[0][1] * v + H[0][2];
  const y = H[1][0] * u + H[1][1] * v + H[1][2];
  const w = H[2][0] * u + H[2][1] * v + H[2][2];
  if (Math.abs(w) < 1e-12) throw new Error('ponto no horizonte da homografia');
  return [x / w, y / w];
}

/** Inversa 3×3 (piso → imagem, para desenhar a grade do piso sobre o vídeo). */
export function inversa3(M) {
  const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) return null;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/** Limite de aceite da calibração no Takt (SPEC: erro de reprojeção ≤ 0,30 m). */
export const ERRO_MAX_CALIBRACAO_M = 0.30;

// ===================================================================== pose (pose_features.py)

export const L_SHO = 5, R_SHO = 6, L_WRI = 9, R_WRI = 10, L_HIP = 11, R_HIP = 12;
export const KP_MIN_CONF = 0.35;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Mantém janela curta de punhos por track para medir energia de movimento. */
export class ActivityScorer {
  constructor({ window = 10, w_hands_in_roi = 0.55, w_motion = 0.35, w_facing = 0.10, motion_ref = 0.18 } = {}) {
    this.window = window;                  // ~2 s a 5 fps
    this.w_hands_in_roi = w_hands_in_roi;
    this.w_motion = w_motion;
    this.w_facing = w_facing;
    this.motion_ref = motion_ref;          // deslocamento de punho/torso por frame que satura
    this._hist = new Map();
  }

  _deque(id) {
    let h = this._hist.get(id);
    if (!h) this._hist.set(id, (h = []));
    return h;
  }

  _push(h, item) {
    h.push(item);
    while (h.length > this.window) h.shift();
  }

  /**
   * Retorna [atividade 0..1, qualidade 0..1 da pose].
   * k: 17 pontos [x,y] em px; s: 17 confianças; roi: polígono em px; centro: [x,y] px.
   */
  score(trackId, k, s, roi, centro) {
    const torso = torsoLen(k, s);
    const lw = s[L_WRI] >= KP_MIN_CONF ? k[L_WRI] : null;
    const rw = s[R_WRI] >= KP_MIN_CONF ? k[R_WRI] : null;
    let nq = 0;
    for (const i of [L_SHO, R_SHO, L_WRI, R_WRI, L_HIP, R_HIP]) if (s[i] >= KP_MIN_CONF) nq++;
    const quality = nq / 6;
    if (torso == null || (lw == null && rw == null)) {
      this._push(this._deque(trackId), [null, null, 0]);
      return [0, quality];
    }
    const visiveis = [lw, rw].filter((w) => w != null);
    const handsIn = visiveis.filter((w) => pontoNoPoligono(w, roi)).length / visiveis.length;

    const h = this._deque(trackId);
    this._push(h, [lw, rw, torso]);
    const motion = motionEnergy(h);
    const motionN = Math.min(1, motion / this.motion_ref);

    const facing = facingDe(k, s, centro);
    const act = this.w_hands_in_roi * handsIn + this.w_motion * motionN * (0.4 + 0.6 * handsIn) + this.w_facing * facing;
    return [Math.max(0, Math.min(1, act)), quality];
  }

  forget(trackId) { this._hist.delete(trackId); }
}

function torsoLen(k, s) {
  const lens = [];
  for (const [a, b] of [[L_SHO, L_HIP], [R_SHO, R_HIP]]) {
    if (s[a] >= KP_MIN_CONF && s[b] >= KP_MIN_CONF) lens.push(dist(k[a], k[b]));
  }
  return lens.length ? lens.reduce((x, y) => x + y, 0) / lens.length : null;
}

/** Deslocamento médio de punho por frame, normalizado pelo torso (invariante à escala). */
function motionEnergy(h) {
  const steps = [];
  let prev = null;
  for (const [lw, rw, torso] of h) {
    if (prev !== null && torso > 0) {
      for (const [a, b] of [[prev[0], lw], [prev[1], rw]]) {
        if (a != null && b != null) steps.push(dist(a, b) / torso);
      }
    }
    prev = [lw, rw];
  }
  return steps.length ? steps.reduce((x, y) => x + y, 0) / steps.length : 0;
}

/** 1.0 quando o torso está voltado para o posto (ombros perpendiculares à direção). */
function facingDe(k, s, alvo) {
  if (s[L_SHO] < KP_MIN_CONF || s[R_SHO] < KP_MIN_CONF) return 0.5;
  const sx = k[R_SHO][0] - k[L_SHO][0], sy = k[R_SHO][1] - k[L_SHO][1];
  const mx = (k[R_SHO][0] + k[L_SHO][0]) / 2, my = (k[R_SHO][1] + k[L_SHO][1]) / 2;
  const tx = alvo[0] - mx, ty = alvo[1] - my;
  const ns = Math.hypot(sx, sy), nt = Math.hypot(tx, ty);
  if (ns === 0 || nt === 0) return 0.5;
  const cos = Math.abs((sx * tx + sy * ty) / (ns * nt));
  return 1 - cos;
}

// ===================================================================== estados (event_manager.py)

/** Parâmetros de produção do worker. */
export const PARAMETROS_PRODUCAO = Object.freeze({
  act_on: 0.55,            // histerese: entra em PRODUTIVO acima
  act_off: 0.35,           // sai de PRODUTIVO abaixo
  enter_confirm_s: 4.0,    // candidato precisa persistir antes de virar estado
  idle_confirm_s: 45.0,    // ociosidade só conta depois disso (micro-pausa é trabalho)
  vacant_confirm_s: 20.0,  // sair para pegar peça não é "vago"
  stale_s: 3.0,            // sem quadro por mais que isso → NAO_OBSERVADO
  min_conf_det: 0.40,
  min_qual_pose: 0.34,
});

/** Tempos curtos da bancada de teste do Takt (bancada.py::PARAMS_BANCADA). */
export const PARAMETROS_BANCADA = Object.freeze({
  ...PARAMETROS_PRODUCAO, enter_confirm_s: 2.0, idle_confirm_s: 8.0, vacant_confirm_s: 5.0, stale_s: 2.0,
});

const conf01 = (st) => Math.round(Math.max(0, Math.min(1, st.conf_acum / Math.max(1, st.n_amostras))) * 1e4) / 1e4;

/**
 * Máquina de estados por posto. postos: [{ posto_id, zona: [[x,y]…], raio_m }].
 * Quadro: { ts (ms), camera_ok, pessoas: [{ track_id, pos_m:[x,y], atividade,
 * qualidade_pose, conf_det }], oclusao_posto?: Set }.
 * Intervalo: { posto_id, estado, inicio (ms), fim (ms|null), confianca }.
 *
 * Diferença deliberada do Python: definirPostos() permite incluir/retirar
 * postos com a sessão andando (o desenho muda no navegador); os postos que
 * continuam guardam o estado.
 */
export class EventManager {
  constructor(postos, { em_pausa = () => false, p = PARAMETROS_PRODUCAO } = {}) {
    this.postos = [];
    this.em_pausa = em_pausa;
    this.p = { ...PARAMETROS_PRODUCAO, ...p };
    this._st = new Map();
    this.definirPostos(postos || []);
  }

  definirPostos(postos, ts = null) {
    const out = [];
    const ids = new Set(postos.map((c) => c.posto_id));
    for (const [pid, st] of this._st) {
      if (ids.has(pid)) continue;
      if (ts != null && st.estado != null && st.inicio != null && ts > st.inicio) {
        out.push({ posto_id: pid, estado: st.estado, inicio: st.inicio, fim: ts, confianca: conf01(st) });
      }
      this._st.delete(pid);
    }
    for (const c of postos) if (!this._st.has(c.posto_id)) this._st.set(c.posto_id, novoEstadoPosto());
    this.postos = postos.slice();
    return out;
  }

  /** Consome um quadro e devolve intervalos FECHADOS e ABERTOS (fim=null) emitidos. */
  processar(q) {
    const out = [];
    for (const cfg of this.postos) {
      const [cand, conf] = this._candidato(cfg, q);
      out.push(...this._transicao(cfg.posto_id, cand, conf, q.ts));
    }
    return out;
  }

  /** Chamado pelo watchdog quando o stream para. Garante NAO_OBSERVADO. */
  tick_sem_quadro(agora) {
    const out = [];
    for (const [pid, st] of this._st) {
      if (st.ult_ts == null || (agora - st.ult_ts) / 1000 > this.p.stale_s) {
        out.push(...this._forcar(pid, Estado.NAO_OBSERVADO, 1.0, st.ult_ts != null ? st.ult_ts : agora));
      }
    }
    return out;
  }

  fechar_todos(ts) {
    const out = [];
    for (const [pid, st] of this._st) {
      if (st.estado != null && st.inicio != null && ts > st.inicio) {
        out.push({ posto_id: pid, estado: st.estado, inicio: st.inicio, fim: ts, confianca: conf01(st) });
        st.estado = null; st.inicio = null;
      }
    }
    return out;
  }

  /** Estado corrente (somente leitura) de um posto. */
  estadoDe(pid) { return this._st.get(pid) || null; }

  _candidato(cfg, q) {
    if (this.em_pausa(q.ts)) return [Estado.PAUSA_PROGRAMADA, 1.0];
    if (!q.camera_ok || (q.oclusao_posto && q.oclusao_posto.has(cfg.posto_id))) return [Estado.NAO_OBSERVADO, 1.0];
    const presentes = q.pessoas.filter((a) => a.conf_det >= this.p.min_conf_det && distanciaAoPoligono(a.pos_m, cfg.zona) <= cfg.raio_m);
    if (!presentes.length) return [Estado.VAGO, 0.9];
    let melhor = presentes[0];
    for (const a of presentes) if (a.atividade > melhor.atividade) melhor = a;   // max() do Python: o primeiro maior
    if (melhor.qualidade_pose < this.p.min_qual_pose) {
      // pessoa presente mas pose ilegível: não chutar produtivo nem ocioso
      return [Estado.NAO_OBSERVADO, melhor.qualidade_pose];
    }
    const st = this._st.get(cfg.posto_id);
    const limiar = st.estado === Estado.PRODUTIVO ? this.p.act_off : this.p.act_on;
    if (melhor.atividade >= limiar) return [Estado.PRODUTIVO, melhor.atividade * melhor.conf_det];
    return [Estado.OCIOSO_NO_POSTO, (1 - melhor.atividade) * melhor.conf_det];
  }

  _confirm_s(e) {
    if (e === Estado.OCIOSO_NO_POSTO) return this.p.idle_confirm_s;
    if (e === Estado.VAGO) return this.p.vacant_confirm_s;
    if (e === Estado.PAUSA_PROGRAMADA) return 0;
    if (e === Estado.NAO_OBSERVADO) return this.p.stale_s;
    return this.p.enter_confirm_s;
  }

  _transicao(pid, cand, conf, ts) {
    const st = this._st.get(pid);
    st.ult_ts = ts;
    if (st.estado == null) {
      st.estado = cand; st.inicio = ts; st.candidato = null; st.cand_desde = null;
      st.conf_acum = conf; st.n_amostras = 1;
      return [{ posto_id: pid, estado: cand, inicio: ts, fim: null, confianca: conf }];
    }
    if (cand === st.estado) {
      st.candidato = null; st.cand_desde = null;
      st.conf_acum += conf;
      st.n_amostras += 1;
      return [];
    }
    if (st.candidato !== cand) { st.candidato = cand; st.cand_desde = ts; }
    if ((ts - st.cand_desde) / 1000 >= this._confirm_s(cand)) {
      // o novo estado começa quando o candidato surgiu, não quando foi confirmado
      return this._forcar(pid, cand, conf, st.cand_desde);
    }
    return [];
  }

  _forcar(pid, novo, conf, inicioNovo) {
    const st = this._st.get(pid);
    const out = [];
    if (st.estado === novo) return out;
    if (st.estado != null && st.inicio != null && inicioNovo > st.inicio) {
      out.push({ posto_id: pid, estado: st.estado, inicio: st.inicio, fim: inicioNovo, confianca: conf01(st) });
    }
    st.estado = novo; st.inicio = inicioNovo;
    st.candidato = null; st.cand_desde = null;
    st.conf_acum = conf; st.n_amostras = 1;
    out.push({ posto_id: pid, estado: novo, inicio: inicioNovo, fim: null, confianca: conf });
    return out;
  }
}

function novoEstadoPosto() {
  return { estado: null, inicio: null, candidato: null, cand_desde: null, conf_acum: 0, n_amostras: 0, ult_ts: null };
}

/** Soma segundos por categoria. SEM_DADO e PLANEJADO fora do denominador. */
export function contabilizar(intervalos) {
  const tot = { PRODUTIVO: 0, IMPRODUTIVO: 0, PLANEJADO: 0, SEM_DADO: 0 };
  for (const i of intervalos) if (i.fim != null) tot[CATEGORIA[i.estado]] += (i.fim - i.inicio) / 1000;
  const base = tot.PRODUTIVO + tot.IMPRODUTIVO;
  tot.produtividade = base > 0 ? tot.PRODUTIVO / base : NaN;
  const obs = base + tot.PLANEJADO + tot.SEM_DADO;
  tot.cobertura_observacao = obs > 0 ? 1 - tot.SEM_DADO / obs : NaN;
  return tot;
}

/**
 * KPI de uma janela [de, ate) a partir de intervalos (o aberto conta até `agora`),
 * como o Cockpit do Takt faz para o turno em andamento, com o detalhe por
 * estado da vw_kpi_posto_dia (ocioso × vago) e a ocupação.
 */
export function kpiJanela(intervalos, de, ate, agora) {
  const s = { PRODUTIVO: 0, OCIOSO_NO_POSTO: 0, VAGO: 0, PAUSA_PROGRAMADA: 0, NAO_OBSERVADO: 0 };
  for (const iv of intervalos) {
    const a = Math.max(iv.inicio, de);
    const b = Math.min(iv.fim != null ? iv.fim : agora, ate, agora);
    if (b > a) s[iv.estado] += (b - a) / 1000;
  }
  const p = s.PRODUTIVO, oc = s.OCIOSO_NO_POSTO, va = s.VAGO, i = oc + va;
  const pl = s.PAUSA_PROGRAMADA, sd = s.NAO_OBSERVADO, tot = p + i + pl + sd;
  const base = p + i;
  const cobertura = tot > 0 ? 1 - sd / tot : null;
  return {
    seg: s, produtivo: p, improdutivo: i, ocioso: oc, vago: va, planejado: pl, sem_dado: sd, total: tot,
    produtividade: base > 0 ? p / base : null,        // produtivo ÷ (produtivo + improdutivo)
    ociosidade: base > 0 ? oc / base : null,          // ocioso no posto ÷ base
    vacancia: base > 0 ? va / base : null,            // vago ÷ base
    ocupacao: base > 0 ? (p + oc) / base : null,      // alguém no posto ÷ base
    cobertura,
    publicavel: cobertura != null && cobertura >= 0.85, // KpiPosto.publicavel
  };
}

// ===================================================================== turnos (turnos.py)

/** "HH:MM[:SS]" → segundos do dia. */
export function hms(t) {
  const [h, m, s] = String(t || '0').split(':').map(Number);
  return ((h || 0) * 60 + (m || 0)) * 60 + (s || 0);
}

const fmtCache = new Map();
function partesNoFuso(ms, fuso) {
  let f = fmtCache.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(fuso, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, H: o.hour % 24, M: o.minute, S: o.second };
}

/** Deslocamento do fuso (ms) no instante `ms`. */
function offsetFuso(ms, fuso) {
  const p = partesNoFuso(ms, fuso);
  return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - (Math.floor(ms / 1000) * 1000);
}

/** datetime.combine(dia, hora, fuso) → epoch ms. `dia` = { y, m, d }. */
export function combinar(dia, segDoDia, fuso) {
  const guess = Date.UTC(dia.y, dia.m - 1, dia.d) + segDoDia * 1000;
  let t = guess - offsetFuso(guess, fuso);
  t = guess - offsetFuso(t, fuso);
  return t;
}

function somaDias(dia, n) {
  const d = new Date(Date.UTC(dia.y, dia.m - 1, dia.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** Dia da semana com domingo = 0 (convenção de takt.turno). */
export function diaSemana(dia) { return new Date(Date.UTC(dia.y, dia.m - 1, dia.d)).getUTCDay(); }

/**
 * Turno: { nome, inicio: 'HH:MM', fim: 'HH:MM', dias: [0..6] (0 = domingo),
 * pausas: [['HH:MM','HH:MM'], …] }. Fora de turno o posto não é medido.
 */
export class Agenda {
  constructor(turnos = [], fuso = 'America/Sao_Paulo') {
    this.turnos = turnos.map((t) => ({ ...t, dias: new Set(t.dias || []), pausas: t.pausas || [] }));
    this.fuso = fuso;
  }

  /** Turno vigente em ts e seus limites absolutos; null fora de turno. */
  janela(ts) {
    const p = partesNoFuso(ts, this.fuso);
    const hoje = { y: p.y, m: p.m, d: p.d };
    for (const base of [hoje, somaDias(hoje, -1)]) {
      for (const t of this.turnos) {
        if (!t.dias.has(diaSemana(base))) continue;
        const ini = combinar(base, hms(t.inicio), this.fuso);
        const fim = combinar(hms(t.fim) <= hms(t.inicio) ? somaDias(base, 1) : base, hms(t.fim), this.fuso);
        if (ini <= ts && ts < fim) return { turno: t, inicio: ini, fim, dia: base };
      }
    }
    return null;
  }

  em_turno(ts) { return !this.turnos.length || this.janela(ts) !== null; }

  em_pausa(ts) {
    const j = this.janela(ts);
    if (!j) return false;
    const t = j.turno;
    const iniT = hms(t.inicio), fimT = hms(t.fim);
    for (const [pi, pf] of t.pausas) {
      // pausa pertence ao turno: ancorada no dia do início, ou no seguinte se cair antes do início do turno
      const dia = somaDias(j.dia, hms(pi) < iniT && fimT <= iniT ? 1 : 0);
      if (combinar(dia, hms(pi), this.fuso) <= ts && ts < combinar(dia, hms(pf), this.fuso)) return true;
    }
    return false;
  }
}

// ===================================================================== privacidade (privacy.py)

export const CABECA = [0, 1, 2, 3, 4];   // nariz, olhos, orelhas (COCO-17)

/**
 * Regiões a borrar, em px: por pessoa, a partir dos keypoints da cabeça com
 * confiança ≥ minConf (centro = média, raio = max(rMin, 1,8·Δx, 2,2·Δy)); com
 * `caixas`, o fallback conservador do Takt: o topo (22 %) de TODA caixa de pessoa.
 * pessoas: [{ k: [[x,y]…17], s: [17], caixa?: [x1,y1,x2,y2] }]. rMin: 18 px no
 * Python (quadros de câmera ~1280 px); o chamador escala para a resolução dele.
 */
export function regioesRosto(pessoas, { minConf = 0.2, caixas = true, rMin = 18 } = {}) {
  const reg = [];
  for (const pe of pessoas) {
    const pts = CABECA.filter((i) => pe.s[i] >= minConf).map((i) => pe.k[i]);
    if (pts.length) {
      let cx = 0, cy = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { cx += x; cy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      cx /= pts.length; cy /= pts.length;
      const r = Math.max(rMin, (x1 - x0) * 1.8, (y1 - y0) * 2.2);
      reg.push([Math.trunc(cx - r), Math.trunc(cy - r * 1.2), Math.trunc(cx + r), Math.trunc(cy + r)]);
    }
  }
  if (caixas) {
    for (const pe of pessoas) {
      if (!pe.caixa) continue;
      const [x1, y1, x2, y2] = pe.caixa.map((v) => Math.trunc(v));
      reg.push([x1, y1, x2, y1 + Math.trunc((y2 - y1) * 0.22)]);
    }
  }
  return reg;
}

/**
 * Borra as regiões NO LUGAR (RGBA de ImageData): reduz a 6×6 por média de
 * área, amplia por vizinho mais próximo e passa um desfoque gaussiano com
 * k = max(15, (largura // 3) | 1) — a mesma receita de privacy.py
 * (cv2.resize INTER_AREA → INTER_NEAREST → GaussianBlur). Devolve quantas
 * regiões foram borradas.
 */
export function borrarRegioes(img, regioes) {
  const W = img.width, H = img.height, d = img.data;
  let n = 0;
  for (const r of regioes) {
    const x1 = Math.max(0, r[0]), y1 = Math.max(0, r[1]), x2 = Math.min(W, r[2]), y2 = Math.min(H, r[3]);
    const w = x2 - x1, h = y2 - y1;
    if (w <= 2 || h <= 2) continue;
    n++;
    // 1. média em 6×6 células
    const cel = new Float64Array(36 * 3), cnt = new Float64Array(36);
    for (let y = y1; y < y2; y++) {
      const cy = Math.min(5, (((y - y1) * 6) / h) | 0);
      for (let x = x1; x < x2; x++) {
        const cx = Math.min(5, (((x - x1) * 6) / w) | 0), c = cy * 6 + cx, i = (y * W + x) * 4;
        cel[c * 3] += d[i]; cel[c * 3 + 1] += d[i + 1]; cel[c * 3 + 2] += d[i + 2]; cnt[c]++;
      }
    }
    // 2. ampliação pelo vizinho mais próximo, num buffer da região
    const buf = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const cy = Math.min(5, ((y * 6) / h) | 0);
      for (let x = 0; x < w; x++) {
        const c = cy * 6 + Math.min(5, ((x * 6) / w) | 0), k = cnt[c] || 1, o = (y * w + x) * 3;
        buf[o] = cel[c * 3] / k; buf[o + 1] = cel[c * 3 + 1] / k; buf[o + 2] = cel[c * 3 + 2] / k;
      }
    }
    // 3. gaussiano separável (σ do OpenCV para sigma=0), borda replicada
    const ks = Math.max(15, ((w / 3) | 0) | 1);
    const sig = 0.3 * ((ks - 1) * 0.5 - 1) + 0.8;
    const meio = (ks - 1) >> 1;
    const ker = new Float32Array(ks);
    let soma = 0;
    for (let i = 0; i < ks; i++) { ker[i] = Math.exp(-((i - meio) ** 2) / (2 * sig * sig)); soma += ker[i]; }
    for (let i = 0; i < ks; i++) ker[i] /= soma;
    const tmp = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let a = 0, b = 0, c = 0;
        for (let t = 0; t < ks; t++) {
          const xx = Math.min(w - 1, Math.max(0, x + t - meio)), o = (y * w + xx) * 3, kk = ker[t];
          a += buf[o] * kk; b += buf[o + 1] * kk; c += buf[o + 2] * kk;
        }
        const o = (y * w + x) * 3; tmp[o] = a; tmp[o + 1] = b; tmp[o + 2] = c;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let a = 0, b = 0, c = 0;
        for (let t = 0; t < ks; t++) {
          const yy = Math.min(h - 1, Math.max(0, y + t - meio)), o = (yy * w + x) * 3, kk = ker[t];
          a += tmp[o] * kk; b += tmp[o + 1] * kk; c += tmp[o + 2] * kk;
        }
        const i = ((y + y1) * W + (x + x1)) * 4;
        d[i] = a; d[i + 1] = b; d[i + 2] = c;
      }
    }
  }
  return n;
}
