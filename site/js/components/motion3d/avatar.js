/**
 * components/motion3d/avatar.js — o MODELO 3D do usuário animado pela captura (Studio v2, CV-88).
 *
 * Carrega GLB/GLTF (autocontido), VRM 0.x/1.0 (@pixiv/three-vrm 3.5.5, vendorizado) e FBX
 * (FBXLoader do three 0.170.0), tudo do arquivo local — nada é enviado. Acha o esqueleto, mapeia
 * os ossos para o humanoide (VRM: o humanoide do próprio arquivo; Mixamo: tabela; outros:
 * heurística — com editor manual no Studio), mede o repouso (T, A ou outro) e aplica o retarget
 * direto de retarget.js a cada pose: rotação no mundo de cada osso mapeado = D · Wrepouso, os
 * ossos não mapeados seguem o pai com a rotação local de repouso, o quadril ganha a posição
 * (escalada pela perna do modelo). Dedos pelos 21 pontos da mão, cabeça e expressões pela malha
 * do rosto (VRM: blink/aa/ou/ee/happy/lookAt; GLB: morph targets ARKit ou do VRoid), física de
 * cabelo e roupa pelos spring bones do VRM (vrm.update).
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';
import { HUMANOIDE, Retarget, pontosDoRepouso, pontosDaCaptura, mapearOssos, tipoOsso, DEDOS } from './retarget.js';

let libsVRM = null, libGLTF = null, libFBX = null;
const carregarGLTF = async () => {
  if (!libGLTF) libGLTF = import('../../../vendor/three-0.170.0/addons/GLTFLoader.js');
  return libGLTF;
};
const carregarVRM = async () => { if (!libsVRM) libsVRM = import('../../../vendor/three-vrm-3.5.5/three-vrm.module.min.js'); return libsVRM; };
const carregarFBX = async () => { if (!libFBX) libFBX = import('../../../vendor/three-0.170.0/addons/FBXLoader.js'); return libFBX; };

/** Tipo pelo conteúdo (assinatura) e pela extensão. */
export function tipoArquivo(nome, buf) {
  const u8 = new Uint8Array(buf, 0, Math.min(32, buf.byteLength));
  const txt = new TextDecoder().decode(u8);
  if (u8[0] === 0x67 && u8[1] === 0x6c && u8[2] === 0x54 && u8[3] === 0x46) return /\.vrm$/i.test(nome) ? 'vrm' : 'glb';
  if (txt.startsWith('Kaydara FBX Binary') || /\.fbx$/i.test(nome)) return 'fbx';
  if (/^\s*\{/.test(txt) || /\.gltf$/i.test(nome)) return 'gltf';
  throw new Error('Formato não reconhecido: use GLB, GLTF (autocontido), VRM ou FBX.');
}

/**
 * Carrega o arquivo → { raiz (Object3D), vrm (ou null), tipo, ossos (Bone[]), animacoes }.
 * A raiz é normalizada: pés no chão, escala em metros (FBX em cm vira m), olhando para +z.
 */
export async function carregarModelo(nome, buf) {
  const tipo = tipoArquivo(nome, buf);
  let raiz = null, vrm = null, animacoes = [];
  if (tipo === 'fbx') {
    const { FBXLoader } = await carregarFBX();
    raiz = new FBXLoader().parse(buf, '');
    animacoes = raiz.animations || [];
  } else {
    const [{ GLTFLoader }, V] = await Promise.all([carregarGLTF(), carregarVRM()]);
    const loader = new GLTFLoader();
    loader.register((p) => new V.VRMLoaderPlugin(p, { autoUpdateHumanBones: false }));
    if (tipo === 'gltf') {
      const txt = new TextDecoder().decode(buf);
      if (/"uri"\s*:\s*"(?!data:)/.test(txt)) throw new Error('Este .gltf aponta para arquivos externos (.bin/texturas). Exporte como GLB (um arquivo só).');
    }
    const gltf = await new Promise((ok, falha) => loader.parse(tipo === 'gltf' ? new TextDecoder().decode(buf) : buf, '', ok, falha));
    vrm = gltf.userData && gltf.userData.vrm ? gltf.userData.vrm : null;
    animacoes = gltf.animations || [];
    if (vrm) {
      try { V.VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (_) { /* opcional */ }
      try { if (V.VRMUtils.combineSkeletons) V.VRMUtils.combineSkeletons(gltf.scene); } catch (_) { /* opcional */ }
      if (vrm.meta && vrm.meta.metaVersion === '0') V.VRMUtils.rotateVRM0(vrm);   // VRM 0.x olha para −z
      vrm.humanoid.autoUpdateHumanBones = false;   // o retarget mexe direto nos ossos "raw"
      raiz = vrm.scene;
    } else raiz = gltf.scene;
  }
  raiz.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  const ossos = [];
  raiz.traverse((o) => { if (o.isBone) ossos.push(o); });
  // sem Bone mas com nós (alguns GLB exportam juntas como nós vazios com skin)
  if (!ossos.length) raiz.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) for (const b of o.skeleton.bones) if (!ossos.includes(b)) ossos.push(b); });
  return { raiz, vrm, tipo, ossos, animacoes, nome };
}

/** Mapa humanoide → nome do osso (VRM: o do arquivo; senão: mapearOssos). */
export function mapaAutomatico(modelo) {
  if (modelo.vrm && modelo.vrm.humanoid) {
    const mapa = {}, origem = {};
    for (const [h] of HUMANOIDE) {
      const n = modelo.vrm.humanoid.getRawBoneNode(h);
      if (n) { mapa[h] = n.name; origem[h] = 'vrm'; }
    }
    return { mapa, origem };
  }
  const prof = (o) => { let k = 0; while (o.parent) { k++; o = o.parent; } return k; };
  return mapearOssos(modelo.ossos.map((b) => ({ nome: b.name, prof: prof(b) })));
}

const OSSOS_OBRIGATORIOS = ['hips', 'spine', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'];
export function faltando(mapa) { return OSSOS_OBRIGATORIOS.filter((h) => !mapa[h]); }

// nomes de morph targets/expressões aceitos para cada coeficiente (ARKit, VRoid, VRM 0.x)
const ALIAS = {
  eyeBlinkLeft: ['eyeBlinkLeft', 'eyeBlink_L', 'Blink_L', 'Fcl_EYE_Close_L', 'blink_l', 'EyeBlinkLeft'],
  eyeBlinkRight: ['eyeBlinkRight', 'eyeBlink_R', 'Blink_R', 'Fcl_EYE_Close_R', 'blink_r', 'EyeBlinkRight'],
  jawOpen: ['jawOpen', 'JawOpen', 'Fcl_MTH_A', 'A', 'aa', 'vrc.v_aa', 'mouthOpen'],
  mouthSmile: ['mouthSmile', 'mouthSmileLeft', 'mouthSmileRight', 'Fcl_MTH_Joy', 'Fcl_ALL_Joy', 'Joy', 'smile', 'happy'],
  mouthPucker: ['mouthPucker', 'mouthFunnel', 'Fcl_MTH_U', 'U', 'ou', 'vrc.v_ou'],
  mouthWide: ['mouthStretchLeft', 'mouthStretchRight', 'Fcl_MTH_I', 'I', 'ih', 'vrc.v_ih'],
  browInnerUp: ['browInnerUp', 'Fcl_BRW_Surprised', 'Surprised', 'browUp'],
};

/**
 * O avatar posável: guarda o repouso, o mapa e o Retarget; aplicar(D) põe a pose.
 * Tudo no referencial da `raiz` do modelo (que fica dentro do grupo do ator na cena).
 */
export class AvatarRig {
  constructor(modelo, mapa, opc = {}) {
    this.modelo = modelo;
    this.raiz = modelo.raiz;
    // base: grupo sem rotação que leva a escala e o chão; a raiz guarda a própria rotação
    // (o VRM 0.x vem girado 180° pelo rotateVRM0) e tudo é medido no referencial da base
    this.base = new THREE.Group(); this.base.name = 'Avatar';
    this.base.add(this.raiz);
    this.vrm = modelo.vrm;
    this.opc = { escalaAuto: true, ...opc };
    this.recarregarRepouso();
    this.definirMapa(mapa);
    this._morphs = this._acharMorphs();
  }

  /** Lê (uma vez) o repouso: TRS locais de todos os nós e a escala/apoio no chão. */
  recarregarRepouso() {
    const r = this.raiz, base = this.base;
    if (!this._repouso) {
      this._repouso = new Map();
      r.traverse((o) => this._repouso.set(o, { q: o.quaternion.clone(), p: o.position.clone(), s: o.scale.clone() }));
    } else for (const [o, t] of this._repouso) { o.quaternion.copy(t.q); o.position.copy(t.p); o.scale.copy(t.s); }
    base.position.set(0, 0, 0); base.quaternion.identity(); base.scale.setScalar(1);
    base.updateMatrixWorld(true);
    // caixa das malhas em repouso (skinning não aplicado: bind = repouso)
    const caixa = new THREE.Box3();
    r.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); caixa.union(b); } });
    if (caixa.isEmpty()) caixa.setFromObject(base);
    const alt = Math.max(1e-6, caixa.max.y - caixa.min.y);
    this.alturaOriginal = alt;
    // FBX em centímetros (180) ou modelos minúsculos: normaliza para 1,70 m; senão mantém
    this.escala = this.opc.escalaAuto && (alt < 0.5 || alt > 3) ? 1.7 / alt : 1;
    this.chao = caixa.min.y;
  }

  /** Mapa humanoide → nome; recalcula o repouso semântico e o Retarget. */
  definirMapa(mapa) {
    this.mapa = { ...mapa };
    const porNome = new Map();
    this.raiz.traverse((o) => { if (!porNome.has(o.name)) porNome.set(o.name, o); });
    this.no = {};
    for (const [h, n] of Object.entries(this.mapa)) { const o = porNome.get(n); if (o) this.no[h] = o; else delete this.mapa[h]; }
    // pontas dos dedos: o filho da falange distal, se houver
    for (const s of ['left', 'right']) for (const d of DEDOS) {
      const dist = this.no[`${s}${d}Distal`];
      if (dist && !this.no[`${s}${d}Tip`] && dist.children[0]) this.no[`${s}${d}Tip`] = dist.children[0];
    }
    this.recarregarRepouso();
    const inv = new THREE.Matrix4().copy(this.base.matrixWorld).invert();
    const pos = {};
    const q = new THREE.Quaternion(), qr = new THREE.Quaternion().setFromRotationMatrix(this.base.matrixWorld).invert();
    for (const [h, o] of Object.entries(this.no)) pos[h] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
    this.repousoSem = pontosDoRepouso(pos);
    this.rt = new Retarget(this.repousoSem, Object.keys(this.no).filter((h) => !h.endsWith('Tip')));
    // ordem de atualização: todos os nós sob o quadril, pais antes dos filhos
    const hips = this.no.hips;
    this.ordem = [];
    if (hips) hips.traverse((o) => this.ordem.push(o));
    this.humanoDe = new Map(Object.entries(this.no).filter(([h]) => !h.endsWith('Tip')).map(([h, o]) => [o, h]));
    this.wRep = new Map();
    for (const o of this.ordem) { o.getWorldQuaternion(q); this.wRep.set(o, qr.clone().multiply(q)); }
    // referencial do pai do quadril (fixo: nada acima dele se mexe)
    this.paiHips = hips && hips.parent ? { q: qr.clone().multiply(hips.parent.getWorldQuaternion(new THREE.Quaternion())), m: inv.clone().multiply(hips.parent.matrixWorld) } : { q: new THREE.Quaternion(), m: new THREE.Matrix4() };
    this.paiHipsInv = this.paiHips.m.clone().invert();
    // pernas do modelo: para escalar a translação do quadril
    const P = this.repousoSem;
    const perna = (s) => (P['hip' + s] && P['kn' + s] && P['an' + s] ? P['hip' + s].distanceTo(P['kn' + s]) + P['kn' + s].distanceTo(P['an' + s]) : 0);
    this.pernaModelo = Math.max(perna('L'), perna('R')) || 0.85 / this.escala;
    this.alturaQuadril = P.hipC ? P.hipC.y - this.chao : 0.95 / this.escala;
    const braco = P.shL && P.elL ? P.shL.clone().sub(P.elL) : null;
    const ang = braco ? Math.round((Math.asin(Math.min(1, Math.abs(braco.dot(P.eixos.cima) / braco.length()))) * 180) / Math.PI) : null;
    this.poseRepouso = ang == null ? 'desconhecida' : ang < 15 ? `T (braços a ${ang}°)` : `A (braços ${ang}° abaixo da horizontal)`;
    // ossos de mola do VRM (cabelo, roupa): a física é dona da rotação local deles
    this.molas = new Set();
    try { if (this.vrm && this.vrm.springBoneManager) for (const j of this.vrm.springBoneManager.joints) if (j.bone) this.molas.add(j.bone); } catch (_) { /* sem molas */ }
    this.voltarAoRepouso();
  }

  voltarAoRepouso() {
    for (const [o, t] of this._repouso) { o.quaternion.copy(t.q); o.position.copy(t.p); o.scale.copy(t.s); }
    this.base.scale.setScalar(this.escala);
    this.base.position.set(0, -this.chao * this.escala, 0);
    this.base.updateMatrixWorld(true);
  }

  /**
   * Aplica uma pose: `W` (33 pontos, convenção do robo, já com "pés no chão" se for o caso),
   * `extras` (mãos/rosto) e `perna` = comprimento da perna na captura (m) para a translação.
   */
  posar(W, extras = null, perna = 0.85) {
    const P = pontosDaCaptura(W, extras);
    if (!P) return null;
    const D = this.rt.pose(P);
    this.aplicar(D, P, perna);
    if (extras && extras.rosto) this.expressoes(extras.rosto.bs);
    return D;
  }

  aplicar(D, P, perna = 0.85) {
    const wAt = new Map();
    const tmp = new THREE.Quaternion();
    for (const o of this.ordem) {
      const pw = o === this.no.hips ? this.paiHips.q : wAt.get(o.parent) || this.paiHips.q;
      const h = this.humanoDe.get(o);
      const d = h ? D.get(h) : null;
      let w;
      if (d) w = d.clone().multiply(this.wRep.get(o));
      else if (this.molas.has(o)) w = pw.clone().multiply(o.quaternion);
      else w = pw.clone().multiply(this._repouso.get(o).q);
      wAt.set(o, w);
      if (!this.molas.has(o)) o.quaternion.copy(tmp.copy(pw).invert().multiply(w));
    }
    // translação do quadril: posição capturada, escalada pela razão das pernas
    if (P && P.hipC && this.no.hips) {
      const k = this.pernaModelo / Math.max(0.2, perna);
      const alvo = new THREE.Vector3(P.hipC.x * k, P.hipC.y * k, P.hipC.z * k);
      // k já leva metros da captura a unidades do modelo; a base aplica a escala e o chão
      alvo.y += this.chao;
      this.no.hips.position.copy(alvo.applyMatrix4(this.paiHipsInv));
    }
    this.base.updateMatrixWorld(true);
  }

  /** Coeficientes do rosto → expressões do VRM ou morph targets. */
  expressoes(bs) {
    if (!bs) return;
    this._bs = bs;
    if (this.vrm && this.vrm.expressionManager) {
      const em = this.vrm.expressionManager;
      const set = (n, v) => { try { if (em.getExpression(n)) em.setValue(n, Math.min(1, Math.max(0, v))); } catch (_) { /* ausente */ } };
      // VRM: a esquerda do avatar é a esquerda da pessoa (o espelho já foi desfeito na captura)
      set('blinkLeft', bs.eyeBlinkLeft); set('blinkRight', bs.eyeBlinkRight);
      set('aa', bs.jawOpen * (1 - bs.mouthPucker * 0.5)); set('ou', bs.mouthPucker); set('ih', bs.mouthWide * 0.6); set('ee', bs.mouthWide);
      set('happy', bs.mouthSmile * 0.8); set('surprised', bs.browInnerUp * 0.6);
      if (this.vrm.lookAt) { this.vrm.lookAt.autoUpdate = false; this.vrm.lookAt.yaw = bs.olharX * 25; this.vrm.lookAt.pitch = bs.olharY * 15; }
      return;
    }
    for (const { infl, dic } of this._morphs) {
      for (const [k, nomes] of Object.entries(ALIAS)) {
        const v = k === 'mouthSmile' ? bs.mouthSmile : bs[k];
        if (v == null) continue;
        for (const n of nomes) if (dic[n] != null) infl[dic[n]] = Math.min(1, Math.max(0, v));
      }
    }
  }
  _acharMorphs() {
    const out = [];
    this.raiz.traverse((o) => { if (o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences) out.push({ infl: o.morphTargetInfluences, dic: o.morphTargetDictionary }); });
    return out;
  }
  temExpressoes() { return Boolean((this.vrm && this.vrm.expressionManager && this.vrm.expressionManager.expressions.length) || this._morphs.some(({ dic }) => Object.values(ALIAS).flat().some((n) => dic[n] != null))); }
  temDedos() { return Boolean(this.no.leftIndexProximal || this.no.rightIndexProximal); }
  temMolas() { return Boolean(this.vrm && this.vrm.springBoneManager && this.vrm.springBoneManager.joints && this.vrm.springBoneManager.joints.size); }

  /** Por quadro: física das molas, expressões e lookAt do VRM. */
  atualizar(dt) {
    if (this.vrm) this.vrm.update(Math.min(0.05, Math.max(0, dt)));
  }
  reiniciarMolas() { if (this.vrm && this.vrm.springBoneManager) { try { this.vrm.springBoneManager.reset(); } catch (_) { /* versões antigas */ } } }

  /**
   * Conferência: ângulo (graus) entre a direção de cada osso do AVATAR posado e a da captura,
   * para os ossos com direção definida (braços, antebraços, coxas, canelas, dedos), mais os
   * ângulos de cotovelo/joelho do avatar vs da captura.
   */
  conferir(W, extras = null) {
    const P = pontosDaCaptura(W, extras);
    const wp = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const res = [];
    const pares = [['leftUpperArm', 'leftLowerArm', 'shL', 'elL'], ['leftLowerArm', 'leftHand', 'elL', 'wrL'], ['rightUpperArm', 'rightLowerArm', 'shR', 'elR'], ['rightLowerArm', 'rightHand', 'elR', 'wrR'],
      ['leftUpperLeg', 'leftLowerLeg', 'hipL', 'knL'], ['leftLowerLeg', 'leftFoot', 'knL', 'anL'], ['rightUpperLeg', 'rightLowerLeg', 'hipR', 'knR'], ['rightLowerLeg', 'rightFoot', 'knR', 'anR']];
    // direções no referencial do pai da base (o grupo do ator), o mesmo da captura
    const qPai = new THREE.Quaternion();
    if (this.base.parent) this.base.parent.getWorldQuaternion(qPai);
    const qInv = qPai.clone().invert();
    for (const [a, b, ca, cb] of pares) {
      if (!this.no[a] || !this.no[b] || !P[ca] || !P[cb]) continue;
      const av = wp(this.no[b]).sub(wp(this.no[a])).normalize().applyQuaternion(qInv);
      const cap = P[cb].clone().sub(P[ca]).normalize();
      res.push({ osso: a, erroGraus: +((av.angleTo(cap) * 180) / Math.PI).toFixed(2) });
    }
    // dedos (com a mão de 21 pontos): falange do avatar × segmento capturado
    const BASE = { Thumb: 1, Index: 5, Middle: 9, Ring: 13, Little: 17 };
    for (const s of ['L', 'R']) {
      const m = P['mao' + s]; if (!m) continue;
      const lado = s === 'L' ? 'left' : 'right';
      for (const d of DEDOS) {
        const segs = d === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal', 'Tip'] : ['Proximal', 'Intermediate', 'Distal', 'Tip'];
        for (let i = 0; i < 3; i++) {
          const a = this.no[`${lado}${d}${segs[i]}`], b = this.no[`${lado}${d}${segs[i + 1]}`];
          const ca = m[BASE[d] + i], cb = m[BASE[d] + i + 1];
          if (!a || !b || !ca || !cb) continue;
          const av = wp(b).sub(wp(a)).normalize().applyQuaternion(qInv), cap = cb.clone().sub(ca).normalize();
          res.push({ osso: `${lado}${d}${segs[i]}`, erroGraus: +((av.angleTo(cap) * 180) / Math.PI).toFixed(2) });
        }
      }
    }
    const angulo = (a, b, c) => { const u = a.clone().sub(b), v = c.clone().sub(b); return (u.angleTo(v) * 180) / Math.PI; };
    const juntas = [['cotovelo esq.', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'shL', 'elL', 'wrL'], ['cotovelo dir.', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'shR', 'elR', 'wrR'],
      ['joelho esq.', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'hipL', 'knL', 'anL'], ['joelho dir.', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'hipR', 'knR', 'anR']];
    const ang = [];
    for (const [n, a, b, c, ca, cb, cc] of juntas) {
      if (!this.no[a] || !this.no[b] || !this.no[c] || !P[ca] || !P[cb] || !P[cc]) continue;
      ang.push({ junta: n, avatar: +angulo(wp(this.no[a]), wp(this.no[b]), wp(this.no[c])).toFixed(1), captura: +angulo(P[ca], P[cb], P[cc]).toFixed(1) });
    }
    return { direcoes: res, angulos: ang, maxErro: res.length ? Math.max(...res.map((r) => r.erroGraus)) : null };
  }

  destruir() {
    this.raiz.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); });
    });
    if (this.base.parent) this.base.parent.remove(this.base);
  }
}

/** Miniatura PNG do modelo em repouso (renderizador próprio e descartável). */
export function miniaturaModelo(raiz, larg = 160, alt = 100) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(larg, alt, false);
  const cena = new THREE.Scene();
  cena.background = new THREE.Color(0x0b1416);
  cena.add(new THREE.HemisphereLight(0xffffff, 0x445055, 1.6));
  const l = new THREE.DirectionalLight(0xffffff, 1.6); l.position.set(1, 2, 3); cena.add(l);
  const pai = raiz.parent;
  cena.add(raiz);
  raiz.updateMatrixWorld(true);
  const caixa = new THREE.Box3().setFromObject(raiz);
  const c = caixa.getCenter(new THREE.Vector3()), t = caixa.getSize(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, larg / alt, 0.01, 100);
  const d = Math.max(t.y, t.x * alt / larg) / (2 * Math.tan((15 * Math.PI) / 180)) * 1.15;
  cam.position.set(c.x + d * 0.35, c.y + t.y * 0.05, c.z + d); cam.lookAt(c);
  r.render(cena, cam);
  const url = r.domElement.toDataURL('image/png');
  cena.remove(raiz); if (pai) pai.add(raiz);
  r.dispose(); r.forceContextLoss && r.forceContextLoss();
  return url;
}

/** Lista para o editor de mapeamento: os humanoides principais + dedos, com o osso escolhido. */
export function linhasMapa(mapa) {
  return HUMANOIDE.map(([h]) => h).filter((h) => !/Eye$|^jaw$/.test(h)).map((h) => ({ humano: h, osso: mapa[h] || '', tipo: tipoOsso(h) }));
}
