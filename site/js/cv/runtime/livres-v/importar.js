/**
 * cv/runtime/livres-v/importar.js — CV-88 Motion 3D Studio: importação de capturas 3D.
 * Só matemática e texto (roda no node). Tudo vira uma trilha de 33 marcadores MediaPipe na
 * convenção do MoCap do GPlanSiS|ROBO (metros, y para cima, +x esquerda da pessoa, +z frente).
 *
 *   FreeMoCap  output_data/mediapipe_body_3d_xyz.npy  (quadros × 33 × 3, milímetros) — também
 *              aceita (quadros × N × 3) com N ≥ 33 (corpo + mãos + rosto: os 33 primeiros são o
 *              corpo) e (quadros × 99); CSV com colunas <marcador>_x/_y/_z (nomes do MediaPipe,
 *              com ou sem prefixo body_/mediapipe_); JSON com { frames|data: [[[x,y,z]…]…] }.
 *              O FreeMoCap alinha o mundo com z para cima: o eixo vertical é DETECTADO pelo
 *              corpo (ombros acima dos tornozelos) e a unidade pela altura (mm/cm/m).
 *   BVH        qualquer hierarquia com nomes usuais (Hips, Spine, LeftUpLeg, LeftLeg, LeftFoot,
 *              LeftArm, LeftForeArm, LeftHand, Neck, Head…, com ou sem prefixo mixamorig:) —
 *              as juntas viram marcadores (quadril, joelho, tornozelo, ombro, cotovelo, punho,
 *              nariz aproximado). Canais em qualquer ordem.
 *   JSON       do próprio Studio (gplansis.iavision.motion3d.take/1, quadros motionai.pose.v1),
 *              do MoCap do robo (gplansis-mocap/1) ou uma lista de PoseFrames.
 */
import { MEDIAPIPE_33_NAMES } from './tomada.js';

const fin = Number.isFinite;

// ------------------------------------------------------------------ NPY

/** Lê um .npy (v1/v2/v3, float32/float64/int, C-order). Devolve { shape, dados: Float64Array }. */
export function lerNPY(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const magia = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59];
  for (let i = 0; i < 6; i++) if (u8[i] !== magia[i]) throw new Error('Não é um arquivo .npy (assinatura NUMPY ausente).');
  const maior = u8[6];
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tamCab = maior === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
  const ini = maior === 1 ? 10 : 12;
  const cab = new TextDecoder('latin1').decode(u8.subarray(ini, ini + tamCab));
  const descr = (/'descr'\s*:\s*'([^']+)'/.exec(cab) || [])[1];
  const fortran = /'fortran_order'\s*:\s*True/.test(cab);
  const shape = ((/'shape'\s*:\s*\(([^)]*)\)/.exec(cab) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  if (!descr || !shape.length) throw new Error('Cabeçalho .npy ilegível.');
  if (fortran) throw new Error('.npy em ordem Fortran não é suportado (salve com np.ascontiguousarray).');
  const le = descr[0] !== '>';
  const tipo = descr.replace(/^[<>|=]/, '');
  const n = shape.reduce((a, b) => a * b, 1);
  const off = ini + tamCab;
  const dados = new Float64Array(n);
  const tam = { f4: 4, f8: 8, i4: 4, i8: 8, f2: 2 }[tipo];
  if (!tam) throw new Error(`Tipo .npy não suportado: ${descr}`);
  if (off + n * tam > u8.byteLength) throw new Error('.npy truncado.');
  for (let i = 0; i < n; i++) {
    const p = off + i * tam;
    dados[i] = tipo === 'f4' ? dv.getFloat32(p, le) : tipo === 'f8' ? dv.getFloat64(p, le) : tipo === 'i4' ? dv.getInt32(p, le)
      : tipo === 'i8' ? Number(dv.getBigInt64(p, le)) : f16(dv.getUint16(p, le));
  }
  return { shape, dados };
}
function f16(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (m / 1024);
  if (e === 31) return m ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + m / 1024);
}

/** Escreve um .npy float32 (usado nos testes e para devolver ao FreeMoCap/Python). */
export function escreverNPY(shape, valores) {
  let cab = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(', ')}${shape.length === 1 ? ',' : ''}), }`;
  const total = 10 + cab.length + 1;
  cab += ' '.repeat((64 - (total % 64)) % 64) + '\n';
  const u8 = new Uint8Array(10 + cab.length + valores.length * 4);
  u8.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]);
  new DataView(u8.buffer).setUint16(8, cab.length, true);
  for (let i = 0; i < cab.length; i++) u8[10 + i] = cab.charCodeAt(i);
  const dv = new DataView(u8.buffer, 10 + cab.length);
  valores.forEach((v, i) => dv.setFloat32(i * 4, v, true));
  return u8;
}

/** NPY do FreeMoCap → trilha bruta (eixos e unidade ainda do arquivo). */
export function trilhaDeNPY(buf) {
  const { shape, dados } = lerNPY(buf);
  let nq, nm;
  if (shape.length === 3 && shape[2] === 3 && shape[1] >= 33) { nq = shape[0]; nm = shape[1]; }
  else if (shape.length === 2 && shape[1] >= 99 && shape[1] % 3 === 0) { nq = shape[0]; nm = shape[1] / 3; }
  else throw new Error(`Formato ${JSON.stringify(shape)} não é (quadros × 33+ × 3). Use output_data/mediapipe_body_3d_xyz.npy.`);
  const tr = [];
  for (let f = 0; f < nq; f++) {
    const q = [];
    for (let k = 0; k < 33; k++) {
      const o = (f * nm + k) * 3;
      const x = dados[o], y = dados[o + 1], z = dados[o + 2];
      q.push(fin(x) && fin(y) && fin(z) ? [x, y, z] : null);
    }
    tr.push(q);
  }
  return tr;
}

// ------------------------------------------------------------------ CSV

const NOMES_PT = ['nariz', 'olho_esq_int', 'olho_esq', 'olho_esq_ext', 'olho_dir_int', 'olho_dir', 'olho_dir_ext', 'orelha_esq', 'orelha_dir',
  'boca_esq', 'boca_dir', 'ombro_esq', 'ombro_dir', 'cotovelo_esq', 'cotovelo_dir', 'pulso_esq', 'pulso_dir',
  'minimo_esq', 'minimo_dir', 'indicador_esq', 'indicador_dir', 'polegar_esq', 'polegar_dir', 'quadril_esq', 'quadril_dir',
  'joelho_esq', 'joelho_dir', 'tornozelo_esq', 'tornozelo_dir', 'calcanhar_esq', 'calcanhar_dir', 'ponta_pe_esq', 'ponta_pe_dir'];

function separar(linha, sep) {
  const out = []; let cur = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { cur += '"'; i++; } else aspas = !aspas; }
    else if (c === sep && !aspas) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** CSV do FreeMoCap (ou do robo/Studio): colunas <nome>_x, _y, _z. Detecta , ou ; e vírgula decimal. */
export function trilhaDeCSV(txt) {
  const linhas = String(txt).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (linhas.length < 2) throw new Error('CSV vazio.');
  const sep = (linhas[0].match(/;/g) || []).length > (linhas[0].match(/,/g) || []).length ? ';' : ',';
  const cab = separar(linhas[0], sep).map((s) => s.toLowerCase().replace(/^(body_|mediapipe_|pose_)/, ''));
  const col = [];
  for (let k = 0; k < 33; k++) {
    const nomes = [MEDIAPIPE_33_NAMES[k], NOMES_PT[k]];
    const achar = (eixo) => { for (const n of nomes) { const i = cab.indexOf(`${n}_${eixo}`); if (i >= 0) return i; } return -1; };
    col.push([achar('x'), achar('y'), achar('z')]);
  }
  if (col.filter((c) => c.every((i) => i >= 0)).length < 12) throw new Error('CSV sem colunas de marcadores MediaPipe (<nome>_x/_y/_z).');
  const num = (s) => { if (s == null || s === '') return NaN; return Number(sep === ';' ? s.replace(',', '.') : s); };
  return linhas.slice(1).map((l) => {
    const v = separar(l, sep);
    return col.map(([ix, iy, iz]) => {
      if (ix < 0) return null;
      const p = [num(v[ix]), num(v[iy]), num(v[iz])];
      return p.every(fin) ? p : null;
    });
  });
}

// ------------------------------------------------------------------ alinhamento

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norma = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (norma(a) || 1));
const meio = (a, b) => (a && b ? mul(add(a, b), 0.5) : null);

/**
 * Leva uma trilha de eixos/unidade desconhecidos para a convenção do robo, como a autocalibração
 * dele faz: "para cima" = tornozelos → ombros (mediana), +x = quadril direito → esquerdo, +z =
 * x × y (frente da pessoa), origem entre os tornozelos do primeiro quadro bom, unidade pela
 * estatura (≈ 0,89 × altura de tornozelo→nariz em mm, cm ou m). Devolve também o que detectou.
 */
export function alinharAoCorpo(trilha) {
  const cimas = [], esqs = [], alts = [];
  let origem = null;
  for (const q of trilha) {
    for (const [t, qd, o] of [[27, 23, 11], [28, 24, 12]]) {
      const pt = q[t], pq = q[qd], po = q[o];
      if (!pt || !pq || !po) continue;
      cimas.push(unit(sub(po, pt)));
      // tornozelo→quadril→ombro(→nariz) ≈ 0,89 da altura com o nariz (robo) ou ≈ 0,77 sem ele
      alts.push(q[0] ? norma(sub(pq, pt)) + norma(sub(po, pq)) + norma(sub(q[0], po)) : (norma(sub(pq, pt)) + norma(sub(po, pq))) * (0.89 / 0.77));
    }
    if (q[23] && q[24]) esqs.push(unit(sub(q[23], q[24])));
    origem = origem || meio(q[27], q[28]);
  }
  if (!cimas.length || !esqs.length || !origem) throw new Error('A captura precisa mostrar tornozelos, quadris e ombros para alinhar o mundo.');
  const cima = unit(cimas.reduce(add, [0, 0, 0]));
  const e0 = esqs.reduce(add, [0, 0, 0]);
  const x = unit(sub(e0, mul(cima, dot(e0, cima))));
  const z = cross(x, cima);
  alts.sort((a, b) => a - b);
  const h = alts[Math.floor(alts.length / 2)];
  // altura corporal ~1,4–2,1 m → h ≈ 1,25–1,9 m; em mm passa de 1000, em cm de 100
  const unidade = h > 400 ? 'mm' : h > 40 ? 'cm' : 'm';
  const k = unidade === 'mm' ? 0.001 : unidade === 'cm' ? 0.01 : 1;
  const out = trilha.map((q) => q.map((p) => {
    if (!p) return null;
    const d = sub(p, origem);
    return [dot(d, x) * k, dot(d, cima) * k, dot(d, z) * k];
  }));
  // pés no chão: o ponto de pé mais baixo do arquivo (mediana dos mínimos) em y = 0
  const mins = out.map((q) => Math.min(...[27, 28, 29, 30, 31, 32].map((i) => (q[i] ? q[i][1] : Infinity)))).filter(fin).sort((a, b) => a - b);
  const piso = mins.length ? mins[Math.floor(mins.length * 0.1)] : 0;
  for (const q of out) for (const p of q) if (p) p[1] -= piso;
  const eixoCima = ['x', 'y', 'z'][[0, 1, 2].reduce((m, i) => (Math.abs(cima[i]) > Math.abs(cima[m]) ? i : m), 0)];
  return { trilha: out, unidade, eixoCima: (cima[['x', 'y', 'z'].indexOf(eixoCima)] < 0 ? '−' : '+') + eixoCima, estaturaM: (h * k) / 0.89 };
}

// ------------------------------------------------------------------ BVH genérico

/** Nome da junta → marcador(es) MediaPipe. */
const MAPA_BVH = [
  [/^(hips|pelvis|root)$/, null], // a raiz não é marcador (fica entre os quadris)
  [/^(leftupleg|leftthigh|lthigh|lefthip|l_?hip|leftupperleg)$/, 23], [/^(rightupleg|rightthigh|rthigh|righthip|r_?hip|rightupperleg)$/, 24],
  [/^(leftleg|leftshin|lshin|leftknee|l_?knee|leftlowerleg)$/, 25], [/^(rightleg|rightshin|rshin|rightknee|r_?knee|rightlowerleg)$/, 26],
  [/^(leftfoot|lfoot|leftankle|l_?ankle)$/, 27], [/^(rightfoot|rfoot|rightankle|r_?ankle)$/, 28],
  [/^(lefttoebase|lefttoe|ltoe|lefttoes)$/, 31], [/^(righttoebase|righttoe|rtoe|righttoes)$/, 32],
  [/^(leftarm|leftupperarm|lshoulder|l_?shoulder|lefthumerus)$/, 11], [/^(rightarm|rightupperarm|rshoulder|r_?shoulder|righthumerus)$/, 12],
  [/^(leftforearm|leftlowerarm|lelbow|l_?elbow)$/, 13], [/^(rightforearm|rightlowerarm|relbow|r_?elbow)$/, 14],
  [/^(lefthand|lhand|leftwrist|l_?wrist)$/, 15], [/^(righthand|rhand|rightwrist|r_?wrist)$/, 16],
  [/^(head)$/, 0],
];
const limpo = (n) => n.replace(/^.*[:|]/, '').replace(/[\s_.-]/g, '').toLowerCase().replace(/^(mixamorig|bip01|bip001|cc_base_)/, '');

/** Parser BVH genérico: hierarquia, canais em qualquer ordem, quadros. */
export function lerBVHGenerico(txt) {
  const tok = String(txt).split(/\s+/).filter(Boolean);
  let i = 0;
  const juntas = [];
  const pilha = [];
  while (i < tok.length && tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      const pai = pilha.length ? pilha[pilha.length - 1] : null;
      const j = { nome: tok[i++], off: [0, 0, 0], canais: [], pai: pai && pai.fim ? null : pai, fim: false, fimOff: null };
      juntas.push(j); pilha.push(j);
    } else if (t === 'End') {
      i++;
      const dono = pilha[pilha.length - 1];
      pilha.push({ fim: true, dono, off: [0, 0, 0] });
    } else if (t === 'OFFSET') {
      const o = [+tok[i], +tok[i + 1], +tok[i + 2]]; i += 3;
      const topo = pilha[pilha.length - 1];
      topo.off = o;
      if (topo.fim && topo.dono) topo.dono.fimOff = o;
    } else if (t === 'CHANNELS') {
      const k = +tok[i++]; pilha[pilha.length - 1].canais = tok.slice(i, i + k); i += k;
    } else if (t === '}') pilha.pop();
  }
  if (tok[i] !== 'MOTION' || !juntas.length) throw new Error('BVH sem HIERARCHY/MOTION.');
  i++;
  while (i < tok.length && !/^Frames:?$/.test(tok[i])) i++;
  const nq = +tok[i + 1]; i += 2;
  while (i < tok.length && tok[i] !== 'Time:') i++;
  const dt = +tok[i + 1]; i += 2;
  const quadros = [];
  for (let f = 0; f < nq; f++) {
    const glob = new Map();
    for (const j of juntas) {
      let T = j.off.slice();
      let R = ident();
      for (const c of j.canais) {
        const v = +tok[i++];
        const l = c.toLowerCase();
        if (l === 'xposition') T[0] = v; else if (l === 'yposition') T[1] = v; else if (l === 'zposition') T[2] = v;
        else if (l === 'xrotation') R = mm(R, rot('x', v)); else if (l === 'yrotation') R = mm(R, rot('y', v)); else if (l === 'zrotation') R = mm(R, rot('z', v));
      }
      if (!j.canais.some((c) => /position/i.test(c))) T = j.off.slice();
      else T = [j.canais.some((c) => /^xposition$/i.test(c)) ? T[0] : j.off[0], j.canais.some((c) => /^yposition$/i.test(c)) ? T[1] : j.off[1], j.canais.some((c) => /^zposition$/i.test(c)) ? T[2] : j.off[2]];
      const p = j.pai ? glob.get(j.pai) : null;
      const Rg = p ? mm(p.R, R) : R;
      const pos = p ? add(p.pos, mv(p.R, T)) : T;
      glob.set(j, { R: Rg, pos });
    }
    quadros.push(glob);
  }
  return { juntas, quadros, fps: dt > 0 ? 1 / dt : 30 };
}
const ident = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
function rot(eixo, graus) {
  const r = (graus * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  if (eixo === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (eixo === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
const mm = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
const mv = (m, v) => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** BVH → trilha de marcadores (juntas reconhecidas pelo nome; o resto do corpo fica vazio). */
export function trilhaDeBVH(txt) {
  const { juntas, quadros, fps } = lerBVHGenerico(txt);
  const mapa = new Map();
  for (const j of juntas) {
    const n = limpo(j.nome);
    for (const [re, k] of MAPA_BVH) if (re.test(n)) { if (k != null && !mapa.has(k)) mapa.set(k, j); break; }
  }
  if ([23, 24, 11, 12].some((k) => !mapa.has(k))) throw new Error('BVH sem juntas reconhecíveis (quadris e ombros: LeftUpLeg/RightUpLeg, LeftArm/RightArm…).');
  const head = mapa.get(0);
  const trilha = quadros.map((g) => {
    const q = Array(33).fill(null);
    for (const [k, j] of mapa) q[k] = g.get(j).pos.slice();
    // cabeça → nariz aproximado (meio da junta Head e da ponta dela); sem Head, a ponta do pescoço
    // (o BVH do robo termina o Neck num End Site sobre o nariz)
    const neck = juntas.find((j) => /^(neck|neck1|pescoco)$/.test(limpo(j.nome)));
    if (!head && neck && neck.fimOff) { const h = g.get(neck); q[0] = add(h.pos, mv(h.R, neck.fimOff)); }
    if (head) {
      const h = g.get(head);
      const topo = head.fimOff ? add(h.pos, mv(h.R, head.fimOff)) : h.pos;
      q[0] = meio(h.pos, topo);
    }
    // mão: indicador/mínimo ≈ ponta da mão se a junta tiver End Site
    for (const [pu, ind, mi] of [[15, 19, 17], [16, 20, 18]]) {
      const j = mapa.get(pu);
      if (j && j.fimOff) { const h = g.get(j); q[ind] = add(h.pos, mv(h.R, j.fimOff)); q[mi] = q[ind].slice(); }
    }
    // calcanhar ≈ tornozelo baixado até a altura da ponta do pé
    for (const [t, c, p] of [[27, 29, 31], [28, 30, 32]]) if (q[t] && q[p]) q[c] = [q[t][0], q[p][1], q[t][2]];
    return q;
  });
  return { trilha, fps, juntasReconhecidas: [...mapa.keys()].length };
}

// ------------------------------------------------------------------ JSON

/** JSON do Studio, do robo ou lista de PoseFrames → { trilha, fps, nome?, cameras? }. */
export function trilhaDeJSON(txt) {
  const o = typeof txt === 'string' ? JSON.parse(txt) : txt;
  const deFrames = (frames) => frames.map((f) => {
    const q = Array(33).fill(null);
    for (const j of f.joints || []) { const k = MEDIAPIPE_33_NAMES.indexOf(j.name); if (k >= 0 && fin(j.x) && fin(j.y) && fin(j.z)) q[k] = [j.x, j.y, j.z]; }
    return q;
  });
  if (Array.isArray(o) && o.length && o[0].schema_version === 'motionai.pose.v1') {
    const fps = o.length > 1 && o[1].timestamp_ms > o[0].timestamp_ms ? 1000 / (o[1].timestamp_ms - o[0].timestamp_ms) : 30;
    return { trilha: deFrames(o), fps, contrato: true };
  }
  if (o && Array.isArray(o.frames) && o.frames.length && o.frames[0].schema_version === 'motionai.pose.v1') return { trilha: deFrames(o.frames), fps: o.fps || 30, nome: o.name, cameras: o.cameras, contrato: true };
  if (o && o.formato === 'gplansis-mocap/1' && Array.isArray(o.quadros)) return { trilha: o.quadros.map((q) => q.map((p) => (p ? [p[0], p[1], p[2]] : null))), fps: o.fps || 30, cameras: o.cameras, robo: true };
  const bruto = o && (o.frames || o.data || o.quadros);
  if (Array.isArray(bruto) && Array.isArray(bruto[0]) && bruto[0].length >= 33) return { trilha: bruto.map((q) => q.slice(0, 33).map((p) => (Array.isArray(p) && p.slice(0, 3).every(fin) ? [p[0], p[1], p[2]] : null))), fps: o.fps || 30, bruto: true };
  throw new Error('JSON não reconhecido (esperado: tomada do Studio, PoseFrames motionai.pose.v1, gplansis-mocap/1 ou { frames: [[[x,y,z]…]] }).');
}

/**
 * Importa um arquivo (nome + conteúdo) e devolve { trilha, fps, origem, nota }. As trilhas de
 * eixo/unidade desconhecidos (FreeMoCap NPY/CSV, BVH, JSON cru) passam por alinharAoCorpo().
 */
export function importarArquivo(nome, conteudo, fpsPadrao = 30) {
  const ext = String(nome).toLowerCase().split('.').pop();
  if (ext === 'npy') {
    const al = alinharAoCorpo(trilhaDeNPY(conteudo));
    return { trilha: al.trilha, fps: fpsPadrao, origem: 'freemocap', nota: `FreeMoCap NPY: ${al.trilha.length} quadros, unidade ${al.unidade}, vertical ${al.eixoCima}, estatura ≈ ${al.estaturaM.toFixed(2)} m.` };
  }
  const txt = typeof conteudo === 'string' ? conteudo : new TextDecoder().decode(conteudo);
  if (ext === 'csv') {
    const al = alinharAoCorpo(trilhaDeCSV(txt));
    return { trilha: al.trilha, fps: fpsPadrao, origem: 'freemocap', nota: `CSV: ${al.trilha.length} quadros, unidade ${al.unidade}, vertical ${al.eixoCima}.` };
  }
  if (ext === 'bvh') {
    const b = trilhaDeBVH(txt);
    const al = alinharAoCorpo(b.trilha);
    return { trilha: al.trilha, fps: b.fps, origem: 'bvh', nota: `BVH: ${b.juntasReconhecidas} juntas reconhecidas, ${al.trilha.length} quadros, unidade ${al.unidade}.` };
  }
  if (ext === 'json') {
    const j = trilhaDeJSON(txt);
    if (j.contrato || j.robo) return { trilha: j.trilha, fps: j.fps, origem: 'json', nome: j.nome, cameras: j.cameras, nota: `JSON ${j.contrato ? 'motionai.pose.v1' : 'gplansis-mocap/1'}: ${j.trilha.length} quadros.` };
    const al = alinharAoCorpo(j.trilha);
    return { trilha: al.trilha, fps: j.fps, origem: 'freemocap', nota: `JSON: ${al.trilha.length} quadros, unidade ${al.unidade}, vertical ${al.eixoCima}.` };
  }
  throw new Error('Formato não suportado: use .npy/.csv (FreeMoCap), .bvh ou .json.');
}
