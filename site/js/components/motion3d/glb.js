/**
 * components/motion3d/glb.js — GLB animado a partir do BVH do MoCap do GPlanSiS|ROBO.
 *
 * O retarget é o do robo (paraBVH: esqueleto padrão de 15 juntas, rotações locais ZXY, raiz com
 * posição). Aqui o BVH vira uma hierarquia de nós three.js (uma junta = um nó, com o OFFSET de
 * repouso) com cápsulas presas a cada osso, e as rotações viram um AnimationClip (quaternions
 * por junta + posição da raiz). O GLTFExporter (three 0.170.0, vendorizado) grava o .glb que o
 * Blender importa com a animação (File › Import › glTF 2.0). Unidade: metro.
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';
import { GLTFExporter } from '../../../vendor/three-0.170.0/addons/GLTFExporter.js';

/** Lê o BVH do robo (ROOT com 6 canais Xpos Ypos Zpos Zrot Xrot Yrot, JOINT com 3 Zrot Xrot Yrot, cm). */
export function bvhParaAnimacao(txt) {
  const tok = txt.split(/\s+/).filter(Boolean);
  let i = 0;
  const juntas = [], pilha = [];
  while (tok[i] !== 'MOTION') {
    const t = tok[i++];
    if (t === 'ROOT' || t === 'JOINT') {
      const pai = pilha.length ? pilha[pilha.length - 1] : null;
      const j = { nome: tok[i++], off: new THREE.Vector3(), canais: [], pai: pai && !pai.fim ? pai : null, filhos: [], fim: null };
      if (j.pai) j.pai.filhos.push(j);
      juntas.push(j); pilha.push(j);
    } else if (t === 'End') { i++; pilha.push({ fim: true, dono: pilha[pilha.length - 1] }); }
    else if (t === 'OFFSET') {
      const v = new THREE.Vector3(+tok[i] / 100, +tok[i + 1] / 100, +tok[i + 2] / 100); i += 3;
      const topo = pilha[pilha.length - 1];
      if (topo.fim) topo.dono.fim = v; else topo.off.copy(v);
    } else if (t === 'CHANNELS') { const k = +tok[i++]; pilha[pilha.length - 1].canais = tok.slice(i, i + k); i += k; }
    else if (t === '}') pilha.pop();
  }
  i++; const nq = +tok[i + 1]; i += 2; const dt = +tok[i + 2]; i += 3;
  const tempos = new Float32Array(nq);
  const quats = juntas.map(() => new Float32Array(nq * 4));
  const raiz = new Float32Array(nq * 3);
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let f = 0; f < nq; f++) {
    tempos[f] = f * dt;
    juntas.forEach((j, k) => {
      const v = j.canais.map(() => +tok[i++]);
      let rot = v;
      if (j.canais.length === 6) { raiz.set([v[0] / 100, v[1] / 100, v[2] / 100], f * 3); rot = v.slice(3); }
      e.set((rot[1] * Math.PI) / 180, (rot[2] * Math.PI) / 180, (rot[0] * Math.PI) / 180, 'ZXY');
      q.setFromEuler(e);
      quats[k].set([q.x, q.y, q.z, q.w], f * 4);
    });
  }
  return { juntas, tempos, quats, raiz, fps: dt > 0 ? 1 / dt : 30 };
}

/** Cena com o esqueleto (nós) e o avatar de cápsulas + o clipe de animação. */
export function montarPersonagem(anim, { nome = 'SK_Character', cor = 0x8fa6a8, raio = 0.035 } = {}) {
  const raizCena = new THREE.Group(); raizCena.name = nome;
  const mat = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.55, metalness: 0.05 });
  const nos = new Map();
  for (const j of anim.juntas) {
    const no = new THREE.Group();
    no.name = j.nome;
    no.position.copy(j.off);
    (j.pai ? nos.get(j.pai.nome) : raizCena).add(no);
    nos.set(j.nome, no);
  }
  // cápsulas: do nó até cada filho (ou até a ponta do End Site)
  const up = new THREE.Vector3(0, 1, 0);
  for (const j of anim.juntas) {
    const alvos = j.filhos.map((f) => f.off).concat(j.fim ? [j.fim] : []);
    for (const alvo of alvos) {
      const L = alvo.length();
      if (L < 1e-3) continue;
      const g = new THREE.CapsuleGeometry(raio, Math.max(1e-3, L - 2 * raio), 3, 8);
      g.normalizeNormals();   // o glTF exige normais unitárias (sem isto o exportador avisa no console)
      const m = new THREE.Mesh(g, mat);
      m.name = `${j.nome}_osso`;
      m.position.copy(alvo).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(up, alvo.clone().normalize());
      nos.get(j.nome).add(m);
    }
  }
  const trilhas = anim.juntas.map((j, k) => new THREE.QuaternionKeyframeTrack(`${j.nome}.quaternion`, anim.tempos, anim.quats[k]));
  trilhas.push(new THREE.VectorKeyframeTrack(`${anim.juntas[0].nome}.position`, anim.tempos, anim.raiz));
  const clipe = new THREE.AnimationClip('Take', anim.tempos.length ? anim.tempos[anim.tempos.length - 1] : 0, trilhas);
  return { cena: raizCena, clipe, nos };
}

/** BVH (texto) → ArrayBuffer .glb com a animação. */
export async function bvhParaGLB(txt, opc = {}) {
  const anim = bvhParaAnimacao(txt);
  const { cena, clipe } = montarPersonagem(anim, opc);
  clipe.name = opc.nomeClipe || 'Take';
  const exp = new GLTFExporter();
  return exp.parseAsync(cena, { binary: true, animations: [clipe], onlyVisible: true });
}

/** Confere um .glb: assinatura, versão, JSON com nós, animação e canais. */
export function inspecionarGLB(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('assinatura glTF ausente');
  const versao = dv.getUint32(4, true);
  const lenJson = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, lenJson)));
  return { versao, nos: (json.nodes || []).length, animacoes: (json.animations || []).length, canais: json.animations && json.animations[0] ? json.animations[0].channels.length : 0, nomes: (json.nodes || []).map((n) => n.name) };
}
