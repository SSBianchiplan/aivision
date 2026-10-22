/**
 * cv/runtime/livres-u/acess.js — acessibilidade (CV-81), sem DOM:
 *
 *   descreverCena     detecções + textos (OCR) + códigos + legenda → frase pt-BR
 *   plural            plural simples em português (casos comuns de classes)
 *   ear / earMedio    abertura do olho (Eye Aspect Ratio) pela malha do rosto (478 pts)
 *   UmEuro            filtro One Euro (Casiez 2012) para o cursor
 *   MouseCabeca       yaw/pitch → cursor (calibração 5 pontos) e piscada longa → clique
 */

// ------------------------------------------------------------------ descrição falada

const IRREG = {
  'ônibus': 'ônibus', 'lápis': 'lápis', 'tênis': 'tênis', 'caminhão': 'caminhões', 'pão': 'pães', 'mão': 'mãos',
  'cão': 'cães', 'avião': 'aviões', 'televisão': 'televisões', 'mouse': 'mouses', 'laptop': 'laptops',
  'sofá': 'sofás', 'pessoa': 'pessoas', 'controle remoto': 'controles remotos', 'celular': 'celulares',
  'animal': 'animais', 'garrafa': 'garrafas', 'semáforo': 'semáforos',
};

/** Plural de um nome de classe (palavra composta: só o 1º termo). */
export function plural(nome) {
  const s = String(nome || '').trim();
  if (IRREG[s]) return IRREG[s];
  const partes = s.split(' ');
  const p = partes[0];
  let q;
  if (/[aeiouéêó]$/i.test(p)) q = p + 's';
  else if (/ão$/i.test(p)) q = p.replace(/ão$/i, 'ões');
  else if (/[rz]$/i.test(p)) q = p + 'es';
  else if (/l$/i.test(p)) q = p.replace(/l$/i, 'is');
  else if (/m$/i.test(p)) q = p.replace(/m$/i, 'ns');
  else if (/s$/i.test(p)) q = p;
  else q = p + 's';
  partes[0] = q;
  return partes.join(' ');
}

const NUM = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez'];
const FEM = new Set(['pessoa', 'cadeira', 'mesa', 'garrafa', 'xícara', 'bicicleta', 'moto', 'motocicleta', 'cama', 'planta',
  'televisão', 'porta', 'janela', 'bolsa', 'mochila', 'faca', 'colher', 'tesoura', 'escova de dentes', 'bola', 'vaca', 'ovelha',
  'girafa', 'zebra', 'banana', 'maçã', 'laranja', 'pizza', 'rosquinha', 'pia', 'geladeira', 'placa de pare', 'gravata', 'caneca']);
const numero = (n, nome) => (n === 1 ? (FEM.has(nome) ? 'uma' : 'um') : n === 2 && FEM.has(nome) ? 'duas' : (NUM[n] || String(n)));

/** Lado pela posição horizontal do centro (0–1). */
export function lado(cx) { return cx < 0.36 ? 'à esquerda' : cx > 0.64 ? 'à direita' : 'à frente'; }

/**
 * Frase da cena. `c` = { dets: [{x1..y2, name, score}], textos: [{text, score}], codigos: [{text, format}], legenda }.
 * o = { maxObjetos, minScore, perto (altura da caixa, 0–1), textos (bool), codigos (bool) }.
 * Agrupa por classe e lado ("duas pessoas à esquerda"), avisa o que está muito
 * perto, e lê textos (até 3, maiores primeiro) e códigos.
 */
export function descreverCena(c, o = {}) {
  const min = o.minScore ?? 0.4, maxObj = o.maxObjetos ?? 6, perto = o.perto ?? 0.65;
  const partes = [];
  const dets = (c.dets || []).filter((d) => d && d.name && (d.score == null || d.score >= min) && !/^mão /.test(d.name));
  if (dets.length) {
    const grupos = new Map();
    for (const d of dets) {
      const nome = String(d.name).toLowerCase(), ld = lado((d.x1 + d.x2) / 2);
      const k = nome + '|' + ld;
      const g = grupos.get(k) || { nome, lado: ld, n: 0, area: 0, perto: false };
      g.n++; g.area += (d.x2 - d.x1) * (d.y2 - d.y1);
      if (d.y2 - d.y1 >= perto) g.perto = true;
      grupos.set(k, g);
    }
    const lista = [...grupos.values()].sort((a, b) => b.area - a.area).slice(0, maxObj);
    const frases = lista.map((g) => `${numero(g.n, g.nome)} ${g.n === 1 ? g.nome : plural(g.nome)} ${g.lado}${g.perto ? ', bem perto' : ''}`);
    partes.push(juntar(frases));
  } else if (!c.legenda) partes.push('nenhum objeto reconhecido');
  if (c.legenda) partes.push(String(c.legenda).trim().replace(/\.$/, ''));
  if (o.textos !== false && c.textos && c.textos.length) {
    const ts = [...c.textos].filter((t) => t && t.text && t.text.trim().length >= 2 && (t.score == null || t.score >= 0.5))
      .sort((a, b) => ((b.y2 - b.y1) || 0) - ((a.y2 - a.y1) || 0)).slice(0, 3).map((t) => t.text.trim());
    if (ts.length) partes.push(`texto: ${ts.join('; ')}`);
  }
  if (o.codigos !== false && c.codigos && c.codigos.length) {
    const cs = [...new Set(c.codigos.map((x) => String(x.text || '').trim()).filter(Boolean))].slice(0, 2);
    if (cs.length) partes.push(`código: ${cs.join('; ')}`);
  }
  const f = partes.filter(Boolean).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('. ');
  return f ? f + '.' : '';
}

function juntar(l) {
  if (l.length <= 1) return l[0] || '';
  return l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
}

/** Assinatura curta da cena (para falar só quando muda): classes e contagens, textos. */
export function assinaturaCena(c, o = {}) {
  const min = o.minScore ?? 0.4;
  const cont = {};
  for (const d of c.dets || []) if (d && d.name && (d.score == null || d.score >= min)) cont[d.name] = (cont[d.name] || 0) + 1;
  const ts = (c.textos || []).map((t) => String(t.text || '').trim().toLowerCase()).filter((t) => t.length >= 2).sort();
  const cs = (c.codigos || []).map((x) => String(x.text || '')).sort();
  return JSON.stringify([Object.entries(cont).sort(), ts.slice(0, 3), cs.slice(0, 2)]);
}

// ------------------------------------------------------------------ olhos

/* índices do Face Mesh (478): olho direito (da pessoa) 33-133, esquerdo 362-263 */
const OLHO_D = [33, 160, 158, 133, 153, 144];
const OLHO_E = [362, 385, 387, 263, 373, 380];

/** EAR = (|p2−p6| + |p3−p5|) / (2·|p1−p4|). `pts` em qualquer escala (x,y). */
export function ear(pts, idx) {
  const P = idx.map((i) => pts[i]);
  if (P.some((p) => !p)) return NaN;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const h = d(P[0], P[3]);
  return h > 0 ? (d(P[1], P[5]) + d(P[2], P[4])) / (2 * h) : NaN;
}

/** EAR médio dos dois olhos; `aspecto` = w/h do quadro (pontos normalizados distorcem). */
export function earMedio(pts, aspecto = 1) {
  const P = aspecto === 1 ? pts : pts.map((p) => (p ? { x: p.x * aspecto, y: p.y } : p));
  return (ear(P, OLHO_D) + ear(P, OLHO_E)) / 2;
}

// ------------------------------------------------------------------ One Euro

export class UmEuro {
  constructor(minCorte = 1.2, beta = 0.02, dCorte = 1) { this.minCorte = minCorte; this.beta = beta; this.dCorte = dCorte; this.x = null; this.dx = 0; this.t = null; }
  static alfa(dt, corte) { const tau = 1 / (2 * Math.PI * corte); return 1 / (1 + tau / dt); }
  filtrar(x, t) {
    if (this.x == null || this.t == null || !(t > this.t)) { this.x = x; this.t = t; this.dx = 0; return x; }
    const dt = t - this.t;
    const dx = (x - this.x) / dt;
    const ad = UmEuro.alfa(dt, this.dCorte);
    this.dx = ad * dx + (1 - ad) * this.dx;
    const corte = this.minCorte + this.beta * Math.abs(this.dx);
    const a = UmEuro.alfa(dt, corte);
    this.x = a * x + (1 - a) * this.x;
    this.t = t;
    return this.x;
  }
}

// ------------------------------------------------------------------ mouse por cabeça

/**
 * Estado do mouse por cabeça: recebe (t, yaw, pitch, ear) por quadro e devolve
 * { x, y (0–1 da tela), clique (bool neste quadro), olhosFechados, pausado }.
 *
 * Calibração (5 posições: centro, esquerda, direita, cima, baixo): cada uma é a
 * mediana de ~1 s de yaw/pitch; os eixos viram a faixa [esq, dir] e [cima, baixo].
 * Sem calibração usa o centro atual e ±`ganhoGraus`.
 *
 * Piscada longa (os dois olhos fechados entre `piscaMin` e `piscaMax` s) =
 * clique. Fechado mais que `pausaS` alterna a pausa (o cursor para). Piscadas
 * normais (< piscaMin) não fazem nada. Olho fechado = EAR < limiar, com o
 * limiar = `fracaoEar` × EAR aberto (mediana dos últimos quadros abertos).
 */
export class MouseCabeca {
  constructor(o = {}) {
    this.o = { ganhoGraus: 18, piscaMin: 0.35, piscaMax: 1.2, pausaS: 2.0, fracaoEar: 0.6, suavidade: 0.5, ...o };
    this.cal = null;               // { yaw: [esq, centro, dir], pitch: [cima, centro, baixo] }
    this.fx = new UmEuro(); this.fy = new UmEuro();
    this.aberto = [];              // EAR recentes com olho aberto
    this.fechadoDesde = null;
    this.pausado = false;
    this.alternouPausa = false;
    this.x = 0.5; this.y = 0.5;
    this.centroLivre = null;
  }

  configurar(o) {
    Object.assign(this.o, o);
    const s = Math.max(0, Math.min(1, this.o.suavidade));
    this.fx.minCorte = this.fy.minCorte = 3.5 - 3 * s;   // mais suave → corte mais baixo
    this.fx.beta = this.fy.beta = 0.6 - 0.5 * s;
  }

  calibrar(c) { this.cal = c; this.fx = new UmEuro(this.fx.minCorte, this.fx.beta); this.fy = new UmEuro(this.fy.minCorte, this.fy.beta); }

  /** Mapeia yaw/pitch (graus) → [0,1]² pela calibração (linear por partes em torno do centro). */
  mapear(yaw, pitch) {
    let fx, fy;
    if (this.cal) {
      const [e, c, d] = this.cal.yaw, [ci, cc, b] = this.cal.pitch;
      fx = yaw <= c ? 0.5 * (yaw - e) / ((c - e) || 1e-6) : 0.5 + 0.5 * (yaw - c) / ((d - c) || 1e-6);
      fy = pitch <= cc ? 0.5 * (pitch - ci) / ((cc - ci) || 1e-6) : 0.5 + 0.5 * (pitch - cc) / ((b - cc) || 1e-6);
    } else {
      if (!this.centroLivre) this.centroLivre = { yaw, pitch };
      const g = this.o.ganhoGraus;
      fx = 0.5 + (yaw - this.centroLivre.yaw) / (2 * g);
      fy = 0.5 + (pitch - this.centroLivre.pitch) / (2 * g);
    }
    return [Math.max(0, Math.min(1, fx)), Math.max(0, Math.min(1, fy))];
  }

  passo(t, yaw, pitch, earV) {
    let clique = false;
    // olhos
    let fechado = false;
    if (Number.isFinite(earV)) {
      const ref = this.aberto.length >= 5 ? [...this.aberto].sort((a, b) => a - b)[this.aberto.length >> 1] : 0.28;
      fechado = earV < this.o.fracaoEar * ref;
      if (!fechado) { this.aberto.push(earV); if (this.aberto.length > 60) this.aberto.shift(); }
    }
    if (fechado) {
      if (this.fechadoDesde == null) { this.fechadoDesde = t; this.alternouPausa = false; }
      const dur = t - this.fechadoDesde;
      if (dur >= this.o.pausaS && !this.alternouPausa) { this.pausado = !this.pausado; this.alternouPausa = true; }
    } else if (this.fechadoDesde != null) {
      const dur = t - this.fechadoDesde;
      this.fechadoDesde = null;
      if (!this.alternouPausa && !this.pausado && dur >= this.o.piscaMin && dur <= this.o.piscaMax) clique = true;
    }
    // cursor: congela enquanto o olho está fechado (a cabeça mexe ao piscar) e na pausa
    if (!fechado && !this.pausado && Number.isFinite(yaw) && Number.isFinite(pitch)) {
      const [mx, my] = this.mapear(yaw, pitch);
      this.x = this.fx.filtrar(mx, t); this.y = this.fy.filtrar(my, t);
    }
    return { x: this.x, y: this.y, clique, olhosFechados: fechado, pausado: this.pausado };
  }
}

/** Calibração a partir das amostras por posição: { centro: [[yaw,pitch]...], esquerda, direita, cima, baixo }. */
export function montarCalibracao(am) {
  const med = (l, k) => { const v = l.map((p) => p[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  for (const k of ['centro', 'esquerda', 'direita', 'cima', 'baixo']) if (!am[k] || am[k].length < 3) return null;
  const c = { yaw: [med(am.esquerda, 0), med(am.centro, 0), med(am.direita, 0)], pitch: [med(am.cima, 1), med(am.centro, 1), med(am.baixo, 1)] };
  // a faixa tem que abrir para os dois lados (≥ 2°): senão a pessoa não virou a cabeça
  if (Math.abs(c.yaw[1] - c.yaw[0]) < 2 || Math.abs(c.yaw[2] - c.yaw[1]) < 2 || Math.abs(c.pitch[1] - c.pitch[0]) < 2 || Math.abs(c.pitch[2] - c.pitch[1]) < 2) return null;
  return c;
}
