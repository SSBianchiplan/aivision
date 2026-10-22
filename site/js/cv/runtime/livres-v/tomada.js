/**
 * cv/runtime/livres-v/tomada.js — CV-88 Motion 3D Studio: a TOMADA (take) e as exportações.
 * Só matemática e texto: roda no node (testes em motion3d-tools/testes/t-motion3d.mjs).
 *
 * Uma tomada é uma trilha de 33 marcadores MediaPipe por quadro, em fps fixo, na convenção do
 * MoCap do GPlanSiS|ROBO (metros, y para cima, +x esquerda da pessoa, +z frente), com a
 * PROVENIÊNCIA declarada (ADR-002 da especificação MotionAI): monocular estimada, multicâmera
 * reconstruída, importada (FreeMoCap/BVH/JSON) ou demonstração sintética. O pós-processamento
 * (lacunas, Butterworth fase zero, ossos rígidos, CoM de Winter, ângulos, base de suporte) e as
 * exportações CSV/JSON/BVH são as do robo (vendor/gplansis-robo-mocap/mocap-robo.mjs), sem
 * reescrever. Daqui saem também o JSON no contrato `motionai.pose.v1` e o corte (trim).
 */
import { processar, paraCSV, paraJSON, paraBVH, NOMES_MP } from '../../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';

export { NOMES_MP };

/** Nomes do conjunto mediapipe33 do contrato (examples/iaVisionMotionBridge.ts da especificação). */
export const MEDIAPIPE_33_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye',
  'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
];

/**
 * Proveniência por origem: source_type, reference_frame, units e quality_flags do contrato.
 * Nada de "3D métrico" sem calibração: o monocular é relativo (escala e profundidade aproximadas).
 */
export const ORIGENS = {
  monocular: { rotulo: 'Câmera única (BlazePose 3D, no aparelho)', source_type: 'estimated_3d_relative', reference_frame: 'body_local', units: 'relative',
    flags: ['relative_depth_not_metric', 'monocular_scale_approx'] },
  multicamera: { rotulo: 'Multicâmera calibrada pelo corpo (MoCap GPlanSiS|ROBO)', source_type: 'reconstructed_3d', reference_frame: 'world', units: 'm',
    flags: ['self_calibrated_by_body', 'software_sync_lt_1_frame', 'no_lens_distortion_model'] },
  freemocap: { rotulo: 'Importada do FreeMoCap', source_type: 'reconstructed_3d', reference_frame: 'world', units: 'm', flags: ['imported_freemocap'] },
  bvh: { rotulo: 'Importada de BVH', source_type: 'reconstructed_3d', reference_frame: 'world', units: 'm', flags: ['imported_bvh_markers_from_joints'] },
  json: { rotulo: 'Importada de JSON', source_type: 'reconstructed_3d', reference_frame: 'world', units: 'm', flags: ['imported_json'] },
  servidor: { rotulo: 'Motor de servidor (GVHMR / ExMR / FlowHMR)', source_type: 'reconstructed_3d', reference_frame: 'world', units: 'm', flags: ['server_engine'] },
  demonstracao: { rotulo: 'Demonstração sintética (3 câmeras virtuais)', source_type: 'synthetic_demo', reference_frame: 'world', units: 'm',
    flags: ['synthetic_demo_not_a_capture'] },
};

export const VERSAO_ALGORITMO = 'iavision-motion3d/1.0 + gplansis-robo-mocap';

const fin = Number.isFinite;
const copia = (q) => q.map((p) => (p ? [p[0], p[1], p[2]] : null));

/**
 * Amostras irregulares (tempo em ms, 33 pontos | null) → trilha em fps fixo. Interpola entre
 * vizinhas a até `lacunaMs`; além disso o quadro fica vazio (a lacuna fica para o pós decidir).
 */
export function reamostrar(amostras, fps = 30, lacunaMs = 250) {
  const am = amostras.filter((a) => a && fin(a.t)).sort((x, y) => x.t - y.t);
  if (!am.length) return { trilha: [], tempos: [], p2d: [], extras: [] };
  const t0 = am[0].t, tN = am[am.length - 1].t, passo = 1000 / fps;
  const nq = Math.max(1, Math.floor((tN - t0) / passo) + 1);
  const trilha = [], tempos = [], p2d = [], extras = [];
  let j = 0;
  for (let f = 0; f < nq; f++) {
    const t = t0 + f * passo;
    while (j + 1 < am.length && am[j + 1].t <= t) j++;
    const a = am[j], b = am[Math.min(j + 1, am.length - 1)];
    const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    const q = [];
    for (let k = 0; k < 33; k++) {
      const pa = a.W && a.W[k], pb = b.W && b.W[k];
      if (pa && pb && b.t - a.t <= lacunaMs) q.push([pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u, pa[2] + (pb[2] - pa[2]) * u]);
      else if (pa && Math.abs(t - a.t) <= lacunaMs / 2) q.push([pa[0], pa[1], pa[2]]);
      else if (pb && Math.abs(b.t - t) <= lacunaMs / 2) q.push([pb[0], pb[1], pb[2]]);
      else q.push(null);
    }
    trilha.push(q);
    tempos.push(t - t0);
    const perto = u < 0.5 ? a : b;
    p2d.push(perto.P2 || null);
    extras.push(perto.ex || null);   // mãos/rosto (Studio v2): o mais próximo, sem interpolar
  }
  return { trilha, tempos, p2d, extras };
}

/** Corte [ini, fim] (quadros, inclusive) aplicado à trilha (e aos 2D, se houver). */
export function cortar(tomada) {
  const n = tomada.trilha.length;
  const ini = Math.max(0, Math.min(n - 1, tomada.corte ? tomada.corte.ini : 0));
  const fim = Math.max(ini, Math.min(n - 1, tomada.corte ? tomada.corte.fim : n - 1));
  return { ...tomada, trilha: tomada.trilha.slice(ini, fim + 1), p2d: tomada.p2d ? tomada.p2d.slice(ini, fim + 1) : null, extras: tomada.extras ? tomada.extras.slice(ini, fim + 1) : null, corte: { ini: 0, fim: fim - ini } };
}

/** Pós-processamento do robo; sem Butterworth quando `filtro` = false (só lacunas e ossos). */
export function processarTomada(tomada, opc = {}) {
  const t = cortar(tomada);
  if (t.trilha.length < 2) return null;
  const fc = opc.fc || 7;
  return processar(t.trilha.map(copia), t.fps, { fc: opc.filtro === false ? t.fps * 0.45 : fc, lacunaMaxS: opc.lacunaMaxS ?? 0.5 });
}

/** Timecode SMPTE sem drop-frame: HH:MM:SS:FF (FF na base inteira do fps). */
export function timecode(ms, fps = 30) {
  const base = Math.max(1, Math.round(fps));
  const tot = Math.max(0, Math.floor((ms / 1000) * base + 1e-6));
  const ff = tot % base, s = Math.floor(tot / base);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}

/** Identificador opaco (sessão, tomada). */
export function novoId(prefixo = 'tk') {
  const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('') : Math.random().toString(16).slice(2, 14);
  return `${prefixo}_${Date.now().toString(36)}${r}`;
}

/**
 * Tomada → quadros PoseFrame `motionai.pose.v1` (contracts/motionai.schemas.json). Cada quadro
 * passa no schema (additionalProperties: false): nada fora dos campos do contrato. Coordenadas
 * da trilha PROCESSADA quando `processado` vem; senão a bruta. Ponto ausente NUNCA vira zero:
 * o contrato exige x e y numéricos, então ele é OMITIDO da lista e o quadro leva a flag
 * `joints_missing` (o consumidor vê que faltou).
 */
export function paraPoseFrames(tomada, processado = null) {
  const t = cortar(tomada);
  const o = ORIGENS[t.origem] || ORIGENS.json;
  const tr = processado ? processado.trilha : t.trilha;
  const conf = (q, k) => (t.conf && t.conf[k] != null ? t.conf[k] : null);
  return tr.map((q, f) => {
    const joints = [];
    q.forEach((p, k) => { if (p && fin(p[0]) && fin(p[1]) && fin(p[2])) joints.push({ name: MEDIAPIPE_33_NAMES[k], x: r5(p[0]), y: r5(p[1]), z: r5(p[2]), confidence: conf(q, k) }); });
    const flags = [...o.flags];
    if (joints.length < 33) flags.push('joints_missing');
    if (processado) flags.push('post_processed_butterworth_rigid_bones');
    return {
      schema_version: 'motionai.pose.v1',
      session_id: t.sessao || t.id,
      frame_index: f,
      timestamp_ms: r3((f * 1000) / t.fps),
      source_id: t.fonteId || o.rotulo,
      person_id: 'person_1',
      source_type: o.source_type,
      coordinate_system: 'RH_Y_UP',
      reference_frame: o.reference_frame,
      units: o.units,
      joint_set: 'mediapipe33',
      joints,
      quality_flags: flags,
      calibration_id: t.calibracaoId || null,
    };
  });
}
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const r3 = (v) => Math.round(v * 1e3) / 1e3;

/** Arquivo JSON do Studio: cabeçalho com proveniência + quadros no contrato + (opcional) o JSON do robo. */
export function paraJSONStudio(tomada, processado = null) {
  const t = cortar(tomada);
  const o = ORIGENS[t.origem] || ORIGENS.json;
  return JSON.stringify({
    format: 'gplansis.iavision.motion3d.take/1',
    contract: 'motionai.pose.v1',
    name: t.nome,
    created_at: t.criado,
    fps: t.fps,
    frames_count: t.trilha.length,
    provenance: { origin: t.origem, label: o.rotulo, source_type: o.source_type, algorithm_version: VERSAO_ALGORITMO,
      calibration_id: t.calibracaoId || null, post_processed: Boolean(processado),
      notice: 'Educacional/experimental: não é laudo médico, ergonômico nem medição biomecânica calibrada.' },
    cameras: t.cameras || [],
    frames: paraPoseFrames(t, processado),
  });
}

/** CSV, JSON (formato gplansis-mocap/1 do robo) e BVH do robo, sobre a tomada processada. */
export function exportarRobo(tomada, tipo, opc = {}) {
  const p = processarTomada(tomada, opc);
  if (!p) throw new Error('Tomada curta demais para exportar (mínimo 2 quadros).');
  if (tipo === 'csv') return paraCSV(p, tomada.fps);
  if (tipo === 'json-robo') return paraJSON(p, tomada.fps, tomada.cameras || []);
  if (tipo === 'bvh') return paraBVH(p, tomada.fps);
  throw new Error('tipo desconhecido: ' + tipo);
}

/** Resumo para o cartão do Content Browser. */
export function resumo(tomada) {
  const n = tomada.trilha.length;
  let validos = 0;
  for (const q of tomada.trilha) for (const p of q) if (p) validos++;
  return { quadros: n, duracaoS: n / tomada.fps, cobertura: n ? validos / (n * 33) : 0 };
}

/**
 * Validador mínimo do PoseFrame (o schema do contrato, campo a campo). Devolve a lista de
 * erros (vazia = válido). O teste do node usa este e também confere contra o JSON Schema.
 */
export function validarPoseFrame(f) {
  const e = [];
  const req = ['schema_version', 'session_id', 'frame_index', 'timestamp_ms', 'source_id', 'person_id', 'source_type', 'coordinate_system', 'reference_frame', 'units', 'joint_set', 'joints', 'quality_flags'];
  const perm = new Set([...req, 'calibration_id']);
  for (const k of req) if (!(k in f)) e.push('falta ' + k);
  for (const k of Object.keys(f)) if (!perm.has(k)) e.push('campo a mais ' + k);
  if (f.schema_version !== 'motionai.pose.v1') e.push('schema_version');
  if (!Number.isInteger(f.frame_index) || f.frame_index < 0) e.push('frame_index');
  if (!fin(f.timestamp_ms) || f.timestamp_ms < 0) e.push('timestamp_ms');
  if (!['measured_2d', 'estimated_3d_relative', 'reconstructed_3d', 'synthetic_demo'].includes(f.source_type)) e.push('source_type');
  if (!['camera', 'world', 'body_local', 'image_normalized'].includes(f.reference_frame)) e.push('reference_frame');
  if (!['relative', 'm', 'normalized'].includes(f.units)) e.push('units');
  if (!Array.isArray(f.joints)) e.push('joints');
  else for (const j of f.joints) {
    const ks = Object.keys(j);
    if (ks.some((k) => !['name', 'x', 'y', 'z', 'confidence'].includes(k))) e.push('joint com campo a mais');
    if (typeof j.name !== 'string' || !j.name) e.push('joint.name');
    if (!fin(j.x) || !fin(j.y)) e.push('joint.x/y');
    if (!(j.z === null || fin(j.z))) e.push('joint.z');
    if (!(j.confidence === null || (fin(j.confidence) && j.confidence >= 0 && j.confidence <= 1))) e.push('joint.confidence');
  }
  if (!Array.isArray(f.quality_flags) || f.quality_flags.some((x) => typeof x !== 'string')) e.push('quality_flags');
  if ('calibration_id' in f && !(f.calibration_id === null || typeof f.calibration_id === 'string')) e.push('calibration_id');
  return e;
}
