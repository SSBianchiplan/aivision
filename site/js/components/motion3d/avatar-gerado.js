/**
 * components/motion3d/avatar-gerado.js — avatares de EXEMPLO gerados em código (nenhum modelo de
 * terceiros, nada baixado): um humanoide low-poly com esqueleto completo (coluna, pescoço,
 * cabeça, ombros, braços, 15 falanges por mão, pernas, pés), malha com pesos suaves nas juntas,
 * cabeça com morph targets (piscar por olho, boca aberta, sorriso, bico) e, no VRM, uma mecha
 * de cabelo em spring bone. Domínio público (CC0), como o resto do que o Studio gera.
 *
 *   gerarAvatar({ tipo: 'glb' })  → GLB com nomes Mixamo (mixamorig:*), em pose A (braços 40°
 *                                   abaixo) — testa o mapa Mixamo e a correção de pose A;
 *   gerarAvatar({ tipo: 'vrm' })  → VRM 1.0 (VRMC_vrm + VRMC_springBone) com nomes do VRoid
 *                                   (J_Bip_*), em pose T, expressões e cabelo com física.
 * Usado pelo Content Browser (Characters › "SK_Exemplo_*") e pelos testes do retarget.
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';
import { GLTFExporter } from '../../../vendor/three-0.170.0/addons/GLTFExporter.js';
import { DEDOS } from './retarget.js';

const SEG3 = ['Proximal', 'Intermediate', 'Distal'];
/** [humanoide, pai, deslocamento local (m) em pose T, raio da peça, cor] */
function tabela() {
  const T = [
    ['hips', null, [0, 0.95, 0], 0.12, 'calca'], ['spine', 'hips', [0, 0.1, 0], 0.115, 'camisa'], ['chest', 'spine', [0, 0.12, 0], 0.125, 'camisa'],
    ['upperChest', 'chest', [0, 0.12, 0], 0.13, 'camisa'], ['neck', 'upperChest', [0, 0.14, 0], 0.045, 'pele'], ['head', 'neck', [0, 0.09, 0], 0, 'pele'],
    ['headTop', 'head', [0, 0.2, 0], 0, null],
  ];
  for (const [k, s] of [[1, 'left'], [-1, 'right']]) {
    T.push([`${s}Shoulder`, 'upperChest', [0.035 * k, 0.1, 0], 0.05, 'camisa'], [`${s}UpperArm`, `${s}Shoulder`, [0.13 * k, 0, 0], 0.045, 'camisa'],
      [`${s}LowerArm`, `${s}UpperArm`, [0.27 * k, 0, 0], 0.038, 'pele'], [`${s}Hand`, `${s}LowerArm`, [0.25 * k, 0, 0], 0.03, 'pele']);
    T.push([`${s}ThumbMetacarpal`, `${s}Hand`, [0.022 * k, -0.01, 0.022], 0.012, 'pele'], [`${s}ThumbProximal`, `${s}ThumbMetacarpal`, [0.03 * k, 0, 0.022], 0.011, 'pele'],
      [`${s}ThumbDistal`, `${s}ThumbProximal`, [0.027 * k, 0, 0.012], 0.01, 'pele'], [`${s}ThumbTip`, `${s}ThumbDistal`, [0.022 * k, 0, 0.008], 0, null]);
    [['Index', 0.024, 1], ['Middle', 0.004, 1.08], ['Ring', -0.015, 1], ['Little', -0.032, 0.78]].forEach(([d, z, L]) => {
      T.push([`${s}${d}Proximal`, `${s}Hand`, [0.085 * k, 0, z], 0.0105, 'pele'], [`${s}${d}Intermediate`, `${s}${d}Proximal`, [0.04 * L * k, 0, 0], 0.0095, 'pele'],
        [`${s}${d}Distal`, `${s}${d}Intermediate`, [0.026 * L * k, 0, 0], 0.0085, 'pele'], [`${s}${d}Tip`, `${s}${d}Distal`, [0.021 * L * k, 0, 0], 0, null]);
    });
    T.push([`${s}UpperLeg`, 'hips', [0.09 * k, -0.05, 0], 0.07, 'calca'], [`${s}LowerLeg`, `${s}UpperLeg`, [0, -0.41, 0], 0.055, 'calca'],
      [`${s}Foot`, `${s}LowerLeg`, [0, -0.41, 0], 0.045, 'sapato'], [`${s}Toes`, `${s}Foot`, [0, -0.06, 0.12], 0.04, 'sapato'], [`${s}ToesEnd`, `${s}Toes`, [0, 0, 0.06], 0, null]);
  }
  return T;
}

/** Nomes no estilo Mixamo (GLB) e VRoid (VRM). */
function nomeMixamo(h) {
  const fix = { hips: 'Hips', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head', headTop: 'HeadTop_End' };
  if (fix[h]) return 'mixamorig:' + fix[h];
  const m = h.match(/^(left|right)(.*)$/);
  const S = m[1] === 'left' ? 'Left' : 'Right', r = m[2];
  const corpo = { Shoulder: 'Shoulder', UpperArm: 'Arm', LowerArm: 'ForeArm', Hand: 'Hand', UpperLeg: 'UpLeg', LowerLeg: 'Leg', Foot: 'Foot', Toes: 'ToeBase', ToesEnd: 'Toe_End' };
  if (corpo[r]) return `mixamorig:${S}${corpo[r]}`;
  const d = DEDOS.find((x) => r.startsWith(x)), seg = r.slice(d.length);
  const mx = d === 'Little' ? 'Pinky' : d;
  const i = d === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal', 'Tip'].indexOf(seg) : ['Proximal', 'Intermediate', 'Distal', 'Tip'].indexOf(seg);
  return `mixamorig:${S}Hand${mx}${i + 1}`;
}
function nomeVroid(h) {
  const fix = { hips: 'J_Bip_C_Hips', spine: 'J_Bip_C_Spine', chest: 'J_Bip_C_Chest', upperChest: 'J_Bip_C_UpperChest', neck: 'J_Bip_C_Neck', head: 'J_Bip_C_Head', headTop: 'J_Bip_C_HeadTop_End' };
  if (fix[h]) return fix[h];
  const m = h.match(/^(left|right)(.*)$/);
  const S = m[1] === 'left' ? 'L' : 'R', r = m[2];
  const d = DEDOS.find((x) => r.startsWith(x));
  if (!d) return `J_Bip_${S}_${r}`;
  const seg = r.slice(d.length), i = (d === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal', 'Tip'] : ['Proximal', 'Intermediate', 'Distal', 'Tip']).indexOf(seg);
  return `J_Bip_${S}_${d}${i + 1}`;
}

const CORES = { pele: [0.86, 0.68, 0.55], camisa: [0.18, 0.62, 0.58], calca: [0.2, 0.24, 0.32], sapato: [0.12, 0.12, 0.13], cabelo: [0.22, 0.15, 0.1], olho: [0.06, 0.06, 0.07], boca: [0.55, 0.18, 0.2] };

/** Acumula uma geometria (já transformada) com pesos por vértice. */
class Junta {
  constructor() { this.pos = []; this.nor = []; this.cor = []; this.idx = []; this.si = []; this.sw = []; this.grupo = []; }
  add(geo, M, cor, pesos, grupo = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(M);
    const p = g.attributes.position, n = g.attributes.normal, base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      this.pos.push(v.x, v.y, v.z); this.nor.push(n.getX(i), n.getY(i), n.getZ(i)); this.cor.push(...cor); this.grupo.push(grupo);
      const w = pesos(v);
      this.si.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0); this.sw.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
      this.idx.push(base + i);
    }
  }
  geometria() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.cor, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/**
 * Monta a cena (Group) com o esqueleto e as malhas. opc: { tipo: 'glb'|'vrm', pose: 'A'|'T', nomes }.
 * Devolve { cena, ossos: Map humanoide → Bone, malhaCabeca }.
 */
export function montarAvatar({ tipo = 'glb', pose = tipo === 'vrm' ? 'T' : 'A' } = {}) {
  const T = tabela();
  const nome = tipo === 'vrm' ? nomeVroid : nomeMixamo;
  const ossos = new Map();
  for (const [h, pai, off] of T) {
    const b = new THREE.Bone(); b.name = nome(h); b.position.set(...off);
    ossos.set(h, b);
    if (pai) ossos.get(pai).add(b);
  }
  // cabelo (só VRM): mecha atrás da cabeça, três ossos
  if (tipo === 'vrm') {
    const c1 = new THREE.Bone(); c1.name = 'J_Sec_Hair1_01'; c1.position.set(0, 0.16, -0.09);
    const c2 = new THREE.Bone(); c2.name = 'J_Sec_Hair2_01'; c2.position.set(0, -0.09, -0.035);
    const c3 = new THREE.Bone(); c3.name = 'J_Sec_Hair3_01'; c3.position.set(0, -0.09, -0.01);
    const c4 = new THREE.Bone(); c4.name = 'J_Sec_Hair3_end'; c4.position.set(0, -0.08, 0);
    ossos.get('head').add(c1); c1.add(c2); c2.add(c3); c3.add(c4);
    ossos.set('cabelo1', c1); ossos.set('cabelo2', c2); ossos.set('cabelo3', c3); ossos.set('cabelo4', c4);
  }
  const raiz = new THREE.Group(); raiz.name = tipo === 'vrm' ? 'SK_Exemplo_VRM' : 'SK_Exemplo_Mixamo';
  const arm = new THREE.Group(); arm.name = 'Armature';
  arm.add(ossos.get('hips')); raiz.add(arm);
  raiz.updateMatrixWorld(true);
  const lista = [...ossos.values()];
  const ix = new Map(lista.map((b, i) => [b, i]));
  const wp = (b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);

  // corpo: um cilindro por osso (do osso ao filho principal), com mistura de pesos nas juntas
  const corpo = new Junta();
  const filhoPrincipal = (h) => { const f = T.filter((t) => t[1] === h); return f.find((t) => !/Thumb|Index|Ring|Little|Shoulder|UpperLeg/.test(t[0]) || /Middle/.test(t[0])) || f[0]; };
  for (const [h, pai, , raio, cor] of T) {
    if (!raio || h === 'head') continue;
    const f = filhoPrincipal(h);
    if (!f) continue;
    const b = ossos.get(h), A = wp(b), B = wp(ossos.get(f[0]));
    const d = B.clone().sub(A), L = d.length();
    if (L < 1e-4) continue;
    const ehTronco = ['hips', 'spine', 'chest', 'upperChest'].includes(h);
    const geo = ehTronco ? new THREE.CylinderGeometry(raio * 0.95, raio, L, 12, 3) : new THREE.CylinderGeometry(raio * 0.85, raio, L, 10, 3);
    if (ehTronco) geo.scale(1.25, 1, 0.75);
    const M = new THREE.Matrix4().compose(A.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, 1, 1));
    const bi = ix.get(b), pi = pai && raio ? ix.get(ossos.get(pai)) : bi;
    corpo.add(geo, M, CORES[cor], (v) => {
      const t = v.clone().sub(A).dot(d) / (L * L);
      if (t < 0.2 && pi !== bi) { const w = 0.5 + t * 2.5; return [[bi, w], [pi, 1 - w]]; }
      return [[bi, 1]];
    });
    // esfera na junta (cotovelo, joelho…) para fechar a dobra
    if (!ehTronco) corpo.add(new THREE.SphereGeometry(raio * 0.92, 10, 8), new THREE.Matrix4().makeTranslation(A.x, A.y, A.z), CORES[cor], () => [[bi, 0.5], [pi, 0.5]]);
  }
  // pés mais compridos (caixa) e palma da mão (caixa)
  for (const s of ['left', 'right']) {
    const F = wp(ossos.get(`${s}Foot`)), Tt = wp(ossos.get(`${s}ToesEnd`));
    const c = F.clone().add(Tt).multiplyScalar(0.5); c.y = 0.04;
    corpo.add(new THREE.BoxGeometry(0.09, 0.07, Tt.z - F.z + 0.08), new THREE.Matrix4().makeTranslation(c.x, c.y, c.z - 0.02), CORES.sapato, (v) => [[ix.get(ossos.get(v.z > F.z + 0.1 ? `${s}Toes` : `${s}Foot`)), 1]]);
    const H = wp(ossos.get(`${s}Hand`)), M2 = wp(ossos.get(`${s}MiddleProximal`));
    corpo.add(new THREE.BoxGeometry(Math.abs(M2.x - H.x) + 0.01, 0.025, 0.075), new THREE.Matrix4().makeTranslation((H.x + M2.x) / 2, H.y, 0), CORES.pele, () => [[ix.get(ossos.get(`${s}Hand`)), 1]]);
  }
  const esqueleto = new THREE.Skeleton(lista);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.02 });
  mat.name = 'Corpo';
  const malha = new THREE.SkinnedMesh(corpo.geometria(), mat); malha.name = 'Corpo';
  raiz.add(malha);

  // cabeça com morph targets: grupos 0 = crânio, 1 = olho esq., 2 = olho dir., 3 = boca, 4 = cabelo
  const cab = new Junta();
  const Hc = wp(ossos.get('head')), hi = ix.get(ossos.get('head'));
  const so = () => [[hi, 1]];
  cab.add(new THREE.SphereGeometry(0.1, 20, 16).scale(0.92, 1.15, 1), new THREE.Matrix4().makeTranslation(Hc.x, Hc.y + 0.1, Hc.z), CORES.pele, so, 0);
  for (const [k, g] of [[1, 1], [-1, 2]]) {
    cab.add(new THREE.SphereGeometry(0.016, 10, 8).scale(1.2, 0.8, 0.5), new THREE.Matrix4().makeTranslation(Hc.x + 0.035 * k, Hc.y + 0.125, Hc.z + 0.088), CORES.olho, so, g);
  }
  cab.add(new THREE.BoxGeometry(0.05, 0.008, 0.01, 6, 2, 1), new THREE.Matrix4().makeTranslation(Hc.x, Hc.y + 0.055, Hc.z + 0.097), CORES.boca, so, 3);
  if (tipo !== 'vrm') cab.add(new THREE.SphereGeometry(0.105, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.1, 1.05), new THREE.Matrix4().makeTranslation(Hc.x, Hc.y + 0.11, Hc.z - 0.005), CORES.cabelo, so, 4);
  const gcab = cab.geometria();
  // morph targets (deltas de posição por grupo)
  const P = gcab.attributes.position, nV = P.count;
  const alvo = (fn) => { const a = new Float32Array(nV * 3); for (let i = 0; i < nV; i++) { const d = fn(i, new THREE.Vector3().fromBufferAttribute(P, i)); if (d) a.set(d, i * 3); } return new THREE.Float32BufferAttribute(a, 3); };
  const cy = Hc.y + 0.125, my = Hc.y + 0.055;
  const MT = {
    eyeBlinkLeft: alvo((i, v) => (cab.grupo[i] === 1 ? [0, (cy - v.y) * 0.9, 0] : null)),
    eyeBlinkRight: alvo((i, v) => (cab.grupo[i] === 2 ? [0, (cy - v.y) * 0.9, 0] : null)),
    jawOpen: alvo((i, v) => (cab.grupo[i] === 3 ? [0, v.y < my ? -0.03 : 0.004, 0] : null)),
    mouthSmile: alvo((i, v) => (cab.grupo[i] === 3 ? [(v.x - Hc.x) * 0.25, ((v.x - Hc.x) / 0.025) ** 2 * 0.012, 0] : null)),
    mouthPucker: alvo((i, v) => (cab.grupo[i] === 3 ? [-(v.x - Hc.x) * 0.5, 0, 0.006] : null)),
  };
  gcab.morphAttributes.position = Object.values(MT);
  gcab.morphTargetsRelative = true;
  const matCab = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }); matCab.name = 'Cabeca';
  const malhaCab = new THREE.SkinnedMesh(gcab, matCab); malhaCab.name = 'Cabeca';
  malhaCab.morphTargetDictionary = Object.fromEntries(Object.keys(MT).map((k, i) => [k, i]));
  malhaCab.morphTargetInfluences = Object.keys(MT).map(() => 0);
  raiz.add(malhaCab);

  // cabelo com spring bone (VRM): uma "rabo de cavalo" de três segmentos
  let malhaCabelo = null;
  if (tipo === 'vrm') {
    const cb = new Junta();
    cb.add(new THREE.SphereGeometry(0.106, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.1, 1.05), new THREE.Matrix4().makeTranslation(Hc.x, Hc.y + 0.11, Hc.z - 0.005), CORES.cabelo, so);
    for (let k = 1; k <= 3; k++) {
      const a = wp(ossos.get('cabelo' + k)), b = wp(ossos.get('cabelo' + (k + 1))), d = b.clone().sub(a);
      const M = new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, 1, 1));
      const bi = ix.get(ossos.get('cabelo' + k)), pi = k === 1 ? hi : ix.get(ossos.get('cabelo' + (k - 1)));
      cb.add(new THREE.CylinderGeometry(0.022 - k * 0.004, 0.028 - k * 0.004, d.length(), 8, 2), M, CORES.cabelo, (v) => { const t = v.clone().sub(a).dot(d) / d.lengthSq(); return t < 0.3 ? [[bi, 0.5 + t * 1.6], [pi, 0.5 - t * 1.6]] : [[bi, 1]]; });
    }
    const mc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }); mc.name = 'Cabelo';
    malhaCabelo = new THREE.SkinnedMesh(cb.geometria(), mc); malhaCabelo.name = 'Cabelo';
    raiz.add(malhaCabelo);
  }
  // pose A: os braços descem 40° ANTES do bind (o repouso do arquivo fica em A, como num Mixamo real)
  if (pose === 'A') {
    ossos.get('leftUpperArm').rotation.z = -0.7; ossos.get('rightUpperArm').rotation.z = 0.7;
    raiz.updateMatrixWorld(true);
  }
  for (const m of [malha, malhaCab, malhaCabelo]) if (m) m.bind(esqueleto, m.matrixWorld);
  // o bind acima usa as matrizes atuais: a geometria foi feita em T, então reposiciona os vértices
  if (pose === 'A') {
    for (const m of [malha, malhaCab]) {
      const g = m.geometry, pa = g.attributes.position, sI = g.attributes.skinIndex, sW = g.attributes.skinWeight;
      // T → A: aplica a cada vértice a rotação dos ossos (skinning manual da geometria em T)
      const T0 = lista.map((b) => b.matrixWorld.clone());
      ossos.get('leftUpperArm').rotation.z = 0; ossos.get('rightUpperArm').rotation.z = 0; raiz.updateMatrixWorld(true);
      const inv = lista.map((b) => b.matrixWorld.clone().invert());
      ossos.get('leftUpperArm').rotation.z = -0.7; ossos.get('rightUpperArm').rotation.z = 0.7; raiz.updateMatrixWorld(true);
      const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i); acc.set(0, 0, 0);
        for (let k = 0; k < 4; k++) { const w = sW.getComponent(i, k); if (!w) continue; const b = sI.getComponent(i, k); tmp.copy(v).applyMatrix4(inv[b]).applyMatrix4(T0[b]); acc.addScaledVector(tmp, w); }
        pa.setXYZ(i, acc.x, acc.y, acc.z);
      }
      pa.needsUpdate = true; g.computeVertexNormals();
      m.bind(esqueleto, m.matrixWorld);
    }
  }
  return { cena: raiz, ossos, malhaCabeca: malhaCab, malhaCabelo };
}

/** GLB → { json, bin } e volta (para injetar as extensões do VRM). */
function lerGLB(buf) {
  const dv = new DataView(buf);
  const lj = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, lj)));
  const off = 20 + lj;
  const lb = off < buf.byteLength ? dv.getUint32(off, true) : 0;
  return { json, bin: lb ? new Uint8Array(buf, off + 8, lb) : null };
}
function escreverGLB(json, bin) {
  let jb = new TextEncoder().encode(JSON.stringify(json));
  const pj = (4 - (jb.length % 4)) % 4;
  if (pj) { const t = new Uint8Array(jb.length + pj); t.set(jb); t.fill(0x20, jb.length); jb = t; }
  const lb = bin ? bin.length + ((4 - (bin.length % 4)) % 4) : 0;
  const total = 12 + 8 + jb.length + (bin ? 8 + lb : 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
  if (bin) { const o = 20 + jb.length; dv.setUint32(o, lb, true); dv.setUint32(o + 4, 0x004e4942, true); out.set(bin, o + 8); }
  return out.buffer;
}

/** Gera o arquivo (ArrayBuffer .glb / .vrm). */
export async function gerarAvatar({ tipo = 'glb' } = {}) {
  const { cena, ossos } = montarAvatar({ tipo });
  const exp = new GLTFExporter();
  const glb = await exp.parseAsync(cena, { binary: true, onlyVisible: true });
  if (tipo !== 'vrm') return glb;
  const { json, bin } = lerGLB(glb);
  const no = (nome) => json.nodes.findIndex((n) => n.name === nome);
  const humanBones = {};
  for (const [h, b] of ossos) {
    if (/^cabelo|Tip$|End$|headTop/.test(h)) continue;
    const i = no(b.name);
    if (i >= 0) humanBones[h] = { node: i };
  }
  const iCab = json.nodes.findIndex((n) => n.name === 'Cabeca' && n.mesh != null);
  const malha = json.meshes[json.nodes[iCab].mesh];
  const nomes = (malha.extras && malha.extras.targetNames) || ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmile', 'mouthPucker'];
  const bind = (n, w = 1) => ({ node: iCab, index: nomes.indexOf(n), weight: w });
  const ex = (...bs) => ({ morphTargetBinds: bs, isBinary: false, overrideBlink: 'none', overrideLookAt: 'none', overrideMouth: 'none' });
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'VRMC_vrm', 'VRMC_springBone'])];
  json.extensions = {
    ...(json.extensions || {}),
    VRMC_vrm: {
      specVersion: '1.0',
      meta: { name: 'GPlanSiS Avatar de Exemplo', version: '1.0', authors: ['GPlanSiS|iaVision (gerado em código)'], copyrightInformation: 'CC0 1.0 — domínio público',
        licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'everyone', allowExcessivelyViolentUsage: false, allowExcessivelySexualUsage: false,
        commercialUsage: 'corporation', allowPoliticalOrReligiousUsage: true, allowAntisocialOrHateUsage: false, creditNotation: 'unnecessary',
        allowRedistribution: true, modification: 'allowModificationRedistribution', otherLicenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      humanoid: { humanBones },
      expressions: { preset: {
        blink: ex(bind('eyeBlinkLeft'), bind('eyeBlinkRight')), blinkLeft: ex(bind('eyeBlinkLeft')), blinkRight: ex(bind('eyeBlinkRight')),
        aa: ex(bind('jawOpen')), oh: ex(bind('jawOpen', 0.6), bind('mouthPucker', 0.5)), ou: ex(bind('mouthPucker')), ee: ex(bind('mouthSmile', 0.5)),
        ih: ex(bind('jawOpen', 0.3), bind('mouthSmile', 0.3)), happy: ex(bind('mouthSmile')), surprised: ex(bind('jawOpen', 0.5)),
      } },
      lookAt: { type: 'expression', offsetFromHeadBone: [0, 0.06, 0] },
    },
    VRMC_springBone: {
      specVersion: '1.0',
      colliders: [{ node: no('J_Bip_C_Head'), shape: { sphere: { offset: [0, 0.1, 0], radius: 0.1 } } }, { node: no('J_Bip_C_UpperChest'), shape: { sphere: { offset: [0, 0.05, -0.02], radius: 0.13 } } }],
      colliderGroups: [{ name: 'Cabeca e costas', colliders: [0, 1] }],
      springs: [{ name: 'Cabelo', colliderGroups: [0], joints: ['J_Sec_Hair1_01', 'J_Sec_Hair2_01', 'J_Sec_Hair3_01', 'J_Sec_Hair3_end'].map((n) => ({ node: no(n), hitRadius: 0.02, stiffness: 0.8, gravityPower: 0.4, gravityDir: [0, -1, 0], dragForce: 0.25 })) }],
    },
  };
  return escreverGLB(json, bin);
}
