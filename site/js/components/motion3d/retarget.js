/**
 * components/motion3d/retarget.js — retarget DIRETO da captura para qualquer esqueleto humanoide
 * (Motion 3D Studio v2, CV-88). Matemática pura sobre three.js: roda no navegador e no node.
 *
 * Ideia: cada osso humanoide (nomes do VRM 1.0: hips, spine, leftUpperArm, leftIndexProximal…)
 * tem um REFERENCIAL anatômico construído do mesmo jeito em dois lugares:
 *   - no repouso do modelo (posições dos ossos ao carregar: T, A ou o que vier), R_b;
 *   - na captura (33 pontos 3D do BlazePose, 21 pontos de cada mão, eixos do rosto), F_b.
 * O delta no mundo D_b = F_b · R_b⁻¹ leva o osso do repouso para a pose capturada, então a
 * rotação no mundo do osso é D_b · Wrepouso_b — sem pressupor pose T: um modelo em pose A é
 * corrigido sozinho, porque R_b é medido no próprio modelo. Três tipos de osso:
 *   'quadro'   referencial completo por (eixo principal, dica lateral): quadril, coluna, pescoço,
 *              cabeça, ombro, mão, pé;
 *   'dobra'    braço e coxa: eixo = o osso; a dica é o plano da dobra (cotovelo/joelho), com
 *              transição suave para o "swing" do tronco quando o membro está quase reto;
 *   'giro'     antebraço, canela e falanges: menor rotação que leva a direção de repouso (já
 *              girada pelo pai) à direção capturada — dobradiça coerente com o pai.
 * Saída do VMC: com o esqueleto CANÔNICO em pose T (repouso identidade), D_b vira a rotação
 * "normalizada" que o protocolo espera (ver vmc.js).
 *
 * Convenção da captura (a do MoCap do GPlanSiS|ROBO): metros, y para cima, +x = esquerda da
 * pessoa, +z = frente. glTF/VRM 1.0 usam a mesma (o avatar olha para +z, a esquerda dele é +x).
 *
 * Também aqui: retargetRobo(), o esqueleto padrão de 15 juntas do BVH do robo calculado direto
 * (rotações globais + cinemática direta), sem gerar e reler texto BVH a cada pose.
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';

const V = () => new THREE.Vector3();
const vec = (p) => (p ? new THREE.Vector3(p[0], p[1], p[2]) : null);
const meio = (a, b) => (a && b ? a.clone().add(b).multiplyScalar(0.5) : null);
const sub = (a, b) => (a && b ? a.clone().sub(b) : null);

// ------------------------------------------------------------------ o humanoide canônico (VRM 1.0)

export const DEDOS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
const SEGS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], Index: ['Proximal', 'Intermediate', 'Distal'], Middle: ['Proximal', 'Intermediate', 'Distal'], Ring: ['Proximal', 'Intermediate', 'Distal'], Little: ['Proximal', 'Intermediate', 'Distal'] };
/** Primeiro ponto (de 21) de cada dedo da mão do MediaPipe: polegar 1–4, indicador 5–8… */
const BASE_DEDO = { Thumb: 1, Index: 5, Middle: 9, Ring: 13, Little: 17 };

/** [nome, pai] na ordem pais → filhos. */
export const HUMANOIDE = (() => {
  const L = [['hips', null], ['spine', 'hips'], ['chest', 'spine'], ['upperChest', 'chest'], ['neck', 'upperChest'], ['head', 'neck'],
    ['leftEye', 'head'], ['rightEye', 'head'], ['jaw', 'head']];
  for (const s of ['left', 'right']) {
    L.push([`${s}Shoulder`, 'upperChest'], [`${s}UpperArm`, `${s}Shoulder`], [`${s}LowerArm`, `${s}UpperArm`], [`${s}Hand`, `${s}LowerArm`]);
    for (const d of DEDOS) SEGS[d].forEach((g, i) => L.push([`${s}${d}${g}`, i ? `${s}${d}${SEGS[d][i - 1]}` : `${s}Hand`]));
  }
  for (const s of ['left', 'right']) L.push([`${s}UpperLeg`, 'hips'], [`${s}LowerLeg`, `${s}UpperLeg`], [`${s}Foot`, `${s}LowerLeg`], [`${s}Toes`, `${s}Foot`]);
  return L;
})();
export const PAI = Object.fromEntries(HUMANOIDE);
export const OSSOS_PRINCIPAIS = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'];
export const OSSOS_DEDOS = HUMANOIDE.map(([n]) => n).filter((n) => DEDOS.some((d) => n.includes(d)));

/** Pai humanoide MAPEADO mais próximo (chest pode faltar: o pai do ombro vira a spine). */
export function paiMapeado(nome, mapa) {
  let p = PAI[nome];
  while (p && !mapa[p]) p = PAI[p];
  return p || null;
}

// ------------------------------------------------------------------ referenciais

const _m = new THREE.Matrix4();
/** Referencial (quaternion) com y = eixo principal e x = dica ortogonalizada. null se degenerado. */
export function referencial(prim, dica) {
  if (!prim || !dica) return null;
  const y = prim.clone(); if (y.lengthSq() < 1e-12) return null; y.normalize();
  const x = dica.clone().addScaledVector(y, -dica.dot(y)); if (x.lengthSq() < 1e-10) return null; x.normalize();
  const z = V().crossVectors(x, y);
  return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
}
const unit = (v) => (v && v.lengthSq() > 1e-12 ? v.clone().normalize() : null);
const suave = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Pontos semânticos da CAPTURA: 33 pontos do mundo (robo) + extras (mãos em 21 pontos já no
 * mundo, eixos do rosto). Tudo Vector3 ou null.
 */
export function pontosDaCaptura(W, extras = null) {
  if (!W) return null;
  const p = (i) => vec(W[i]);
  const P = {
    hipL: p(23), hipR: p(24), shL: p(11), shR: p(12), elL: p(13), elR: p(14), wrL: p(15), wrR: p(16),
    knL: p(25), knR: p(26), anL: p(27), anR: p(28), toeL: p(31), toeR: p(32), earL: p(7), earR: p(8), nose: p(0),
    idxL: p(19), idxR: p(20), pinL: p(17), pinR: p(18),
  };
  P.hipC = meio(P.hipL, P.hipR); P.shC = meio(P.shL, P.shR); P.earC = meio(P.earL, P.earR);
  P.maoL = extras && extras.maoL ? extras.maoL.map(vec) : null;
  P.maoR = extras && extras.maoR ? extras.maoR.map(vec) : null;
  P.rosto = extras && extras.rosto && extras.rosto.esq ? { esq: vec(extras.rosto.esq), cima: vec(extras.rosto.cima) } : null;
  return P;
}

/**
 * Pontos semânticos do REPOUSO de um modelo: posição de cada osso humanoide (Vector3, no
 * referencial da raiz do modelo) + eixos do modelo (esq, cima, frente) medidos no esqueleto.
 */
export function pontosDoRepouso(pos) {
  const g = (n) => (pos[n] ? pos[n].clone() : null);
  const P = { hipC: g('hips'), hipL: g('leftUpperLeg'), hipR: g('rightUpperLeg'), shL: g('leftUpperArm'), shR: g('rightUpperArm'),
    elL: g('leftLowerArm'), elR: g('rightLowerArm'), wrL: g('leftHand'), wrR: g('rightHand'), knL: g('leftLowerLeg'), knR: g('rightLowerLeg'),
    anL: g('leftFoot'), anR: g('rightFoot') };
  // eixos do modelo: esquerda pelos quadris (ou ombros), cima do quadril à cabeça; frente = esq × cima
  const esq = unit(sub(P.hipL, P.hipR)) || unit(sub(P.shL, P.shR)) || new THREE.Vector3(1, 0, 0);
  const topo = g('head') || g('neck') || meio(P.shL, P.shR);
  let cima = topo && P.hipC ? unit(sub(topo, P.hipC)) : null;
  if (!cima) cima = new THREE.Vector3(0, 1, 0);
  cima.addScaledVector(esq, -cima.dot(esq)).normalize();
  const frente = V().crossVectors(esq, cima).normalize();
  P.eixos = { esq, cima, frente };
  P.shC = meio(P.shL, P.shR) || g('upperChest') || g('chest');
  const cab = g('head') || (g('neck') ? g('neck').addScaledVector(cima, 0.1) : null);
  P.earC = cab ? cab.clone().addScaledVector(cima, 0.06) : null;
  P.earL = P.earC ? P.earC.clone().addScaledVector(esq, 0.075) : null;
  P.earR = P.earC ? P.earC.clone().addScaledVector(esq, -0.075) : null;
  // nariz: ~9 cm à frente e ~3 cm abaixo das orelhas (média do BlazePose em pé, olhar à frente)
  P.nose = P.earC ? P.earC.clone().addScaledVector(frente, 0.09).addScaledVector(cima, -0.03) : null;
  for (const s of ['L', 'R']) {
    const lado = s === 'L' ? 'left' : 'right';
    const an = P['an' + s];
    P['toe' + s] = g(`${lado}Toes`) || (an ? an.clone().addScaledVector(frente, 0.15).addScaledVector(cima, -0.07) : null);
    // mão em 21 pontos a partir das falanges (as que existirem)
    const wr = P['wr' + s];
    if (wr && g(`${lado}MiddleProximal`)) {
      const m = Array(21).fill(null);
      m[0] = wr.clone();
      for (const d of DEDOS) {
        const ossos = SEGS[d].map((gg) => g(`${lado}${d}${gg}`));
        ossos.forEach((o, i) => { m[BASE_DEDO[d] + i] = o; });
        // ponta: o filho do último osso (pos[...Tip]) ou prolonga a última falange
        const ult = ossos[2], pen = ossos[1];
        m[BASE_DEDO[d] + 3] = pos[`${lado}${d}Tip`] ? pos[`${lado}${d}Tip`].clone() : ult && pen ? ult.clone().add(sub(ult, pen).multiplyScalar(0.8)) : null;
      }
      P['mao' + s] = m;
    } else P['mao' + s] = null;
    // mão sem dedos: "indicador" e "mínimo" sintéticos no prolongamento do antebraço
    const el = P['el' + s];
    if (wr && el) {
      const dir = unit(sub(wr, el));
      const lat = frente.clone();   // pose T de palmas para baixo: o indicador fica à frente do mínimo
      P['idx' + s] = wr.clone().addScaledVector(dir, 0.08).addScaledVector(lat, 0.03);
      P['pin' + s] = wr.clone().addScaledVector(dir, 0.08).addScaledVector(lat, -0.03);
    }
  }
  P.rosto = { esq: esq.clone(), cima: cima.clone() };
  return P;
}

/** Os vetores (principal, dica) de cada osso tipo 'quadro', a partir de pontos semânticos. */
function vetoresQuadro(nome, P, usarRosto, usarMao = true) {
  const tronco = sub(P.shC, P.hipC);
  const latQ = unit(sub(P.hipL, P.hipR)), latO = unit(sub(P.shL, P.shR));
  switch (nome) {
    case 'hips': return [tronco, latQ];
    case 'spine': return [tronco, latQ && latO ? latQ.clone().add(latO) : latQ || latO];
    case 'chest': return [tronco, latQ && latO ? latQ.clone().multiplyScalar(0.3).add(latO.clone().multiplyScalar(0.7)) : latO || latQ];
    case 'upperChest': return [tronco, latO || latQ];
    case 'neck': return [sub(P.earC, P.shC), sub(P.earL, P.earR) || latO];
    case 'head':
      if (usarRosto && P.rosto) return [P.rosto.esq, P.rosto.cima];
      return [sub(P.earL, P.earR), sub(P.nose, P.earC)];
    case 'leftShoulder': return [sub(P.shL, P.shC), tronco];
    case 'rightShoulder': return [sub(P.shR, P.shC), tronco];
    default: break;
  }
  const s = nome.startsWith('left') ? 'L' : 'R';
  if (nome.endsWith('Hand')) {
    const m = P['mao' + s];
    if (usarMao && m && m[0] && m[9] && m[5] && m[17]) return [sub(m[9], m[0]), sub(m[5], m[17])];
    const idx = P['idx' + s], pin = P['pin' + s];
    return [sub(meio(idx, pin), P['wr' + s]), sub(idx, pin)];
  }
  if (nome.endsWith('Foot')) return [sub(P['toe' + s], P['an' + s]), sub(P['kn' + s], P['an' + s])];
  return [null, null];
}

/** Classificação de cada osso humanoide. */
export function tipoOsso(nome) {
  if (/UpperArm$|UpperLeg$/.test(nome)) return 'dobra';
  if (/LowerArm$|LowerLeg$/.test(nome) || DEDOS.some((d) => nome.includes(d))) return 'giro';
  if (/Toes$|Eye$|^jaw$/.test(nome)) return 'segue';
  return 'quadro';
}

/** Segmento (a → b) que dá a direção de um osso 'dobra'/'giro' e o segmento filho da dobra. */
function segmento(nome, P) {
  const s = nome.startsWith('left') ? 'L' : 'R';
  if (nome.endsWith('UpperArm')) return [P['sh' + s], P['el' + s], P['wr' + s]];
  if (nome.endsWith('LowerArm')) return [P['el' + s], P['wr' + s], null];
  if (nome.endsWith('UpperLeg')) return [P['hip' + s], P['kn' + s], P['an' + s]];
  if (nome.endsWith('LowerLeg')) return [P['kn' + s], P['an' + s], null];
  const m = P['mao' + s];
  for (const d of DEDOS) {
    if (!nome.includes(d)) continue;
    const i = SEGS[d].findIndex((g) => nome.endsWith(g));
    if (!m || i < 0) return [null, null, null];
    return [m[BASE_DEDO[d] + i], m[BASE_DEDO[d] + i + 1], null];
  }
  return [null, null, null];
}

/**
 * O retarget de UM esqueleto: guarda os referenciais de repouso e, a cada pose, devolve o delta
 * no mundo de cada osso mapeado (Map nome → Quaternion) — o modelo faz o resto (avatar.js).
 */
export class Retarget {
  /** `repouso` = pontosDoRepouso(...), `ossos` = nomes humanoides presentes no modelo. */
  constructor(repouso, ossos) {
    this.P0 = repouso;
    this.ossos = HUMANOIDE.map(([n]) => n).filter((n) => ossos.includes(n));
    this.mapa = Object.fromEntries(this.ossos.map((n) => [n, true]));
    this.R = {}; this.Rrosto = null; this.dir0 = {}; this.dica0 = {};
    const ax = repouso.eixos;
    for (const n of this.ossos) {
      const t = tipoOsso(n);
      if (t === 'quadro') {
        const [a, b] = vetoresQuadro(n, repouso, false);
        this.R[n] = referencial(a, b);
        if (n === 'head') { const [c, d] = vetoresQuadro(n, repouso, true); this.Rrosto = referencial(c, d); }
        if (/Hand$/.test(n)) {
          // dois referenciais da mão: pelos 21 pontos (dedos) e pelos pontos da pose (sem a mão)
          const [c, d] = vetoresQuadro(n, repouso, false, false); this.Rpose = this.Rpose || {}; this.Rpose[n] = referencial(c, d);
        }
      } else if (t === 'dobra' || t === 'giro') {
        const [a, b] = segmento(n, repouso);
        this.dir0[n] = a && b ? unit(sub(b, a)) : null;
        if (t === 'dobra') {
          // plano da dobra em repouso: o antebraço vai para a FRENTE ao dobrar, a canela para TRÁS
          this.dica0[n] = /Arm$/.test(n) ? ax.frente.clone() : ax.frente.clone().negate();
          this.R[n] = this.dir0[n] ? referencial(this.dir0[n], this.dica0[n]) : null;
        }
      }
    }
    this.ultimo = {};
  }

  /**
   * Delta no mundo de cada osso para a captura `P` (pontosDaCaptura). Osso sem dado neste quadro
   * mantém o último delta relativo ao pai (mão escondida não congela o corpo todo).
   */
  pose(P) {
    const D = new Map();
    const ident = new THREE.Quaternion();
    const qpai = (n) => { const p = paiMapeado(n, this.mapa); return p ? D.get(p) || ident : ident; };
    for (const n of this.ossos) {
      const t = tipoOsso(n);
      let d = null;
      if (P) {
        if (t === 'quadro') {
          const usarRosto = n === 'head' && P.rosto && this.Rrosto;
          const mao = /Hand$/.test(n), s = n.startsWith('left') ? 'L' : 'R';
          const mao21 = mao && P['mao' + s] && this.P0['mao' + s];
          const [a, b] = vetoresQuadro(n, P, usarRosto, Boolean(mao21));
          const F = referencial(a, b), R = usarRosto ? this.Rrosto : mao && !mao21 ? this.Rpose[n] : this.R[n];
          if (F && R) d = F.multiply(R.clone().invert());
        } else if (t === 'dobra') {
          const [a, b, c] = segmento(n, P);
          const dir = a && b ? unit(sub(b, a)) : null;
          if (dir && this.R[n]) {
            // swing do tronco: a dica de repouso girada pelo pai e levada ao novo eixo
            const qp = qpai(n);
            const d0 = this.dir0[n].clone().applyQuaternion(qp);
            const sw = new THREE.Quaternion().setFromUnitVectors(d0, dir);
            const fb = this.dica0[n].clone().applyQuaternion(qp).applyQuaternion(sw);
            fb.addScaledVector(dir, -fb.dot(dir)).normalize();
            let dica = fb;
            const filho = b && c ? unit(sub(c, b)) : null;
            if (filho) {
              const h = filho.clone().addScaledVector(dir, -filho.dot(dir));
              const w = suave(0.17, 0.5, h.length());   // 10° a 30° de dobra: passa do swing ao plano real
              if (w > 0) dica = fb.multiplyScalar(1 - w).add(h.normalize().multiplyScalar(w));
            }
            const F = referencial(dir, dica);
            if (F) d = F.multiply(this.R[n].clone().invert());
          }
        } else if (t === 'giro') {
          const [a, b] = segmento(n, P);
          const dir = a && b ? unit(sub(b, a)) : null;
          if (dir && this.dir0[n]) {
            const qp = qpai(n);
            const d0 = this.dir0[n].clone().applyQuaternion(qp);
            d = new THREE.Quaternion().setFromUnitVectors(d0, dir).multiply(qp);
          }
        }
      }
      if (!d) {
        // sem dado: o último delta RELATIVO ao pai, reaplicado sobre o pai de agora
        const rel = this.ultimo[n];
        d = rel ? qpai(n).clone().multiply(rel) : qpai(n).clone();
      } else this.ultimo[n] = qpai(n).clone().invert().multiply(d);
      D.set(n, d);
    }
    return D;
  }
}

/** Pose T ideal (canônica) no referencial do Studio: para o VMC e o esqueleto de referência. */
export function poseTCanonica() {
  const P = {};
  const s = (n, x, y, z) => { P[n] = new THREE.Vector3(x, y, z); };
  s('hips', 0, 0.95, 0); s('spine', 0, 1.05, 0); s('chest', 0, 1.18, 0); s('upperChest', 0, 1.3, 0); s('neck', 0, 1.45, 0); s('head', 0, 1.55, 0);
  for (const [k, lado] of [[1, 'left'], [-1, 'right']]) {
    s(`${lado}Shoulder`, 0.04 * k, 1.4, 0); s(`${lado}UpperArm`, 0.17 * k, 1.4, 0); s(`${lado}LowerArm`, 0.45 * k, 1.4, 0); s(`${lado}Hand`, 0.7 * k, 1.4, 0);
    s(`${lado}UpperLeg`, 0.09 * k, 0.9, 0); s(`${lado}LowerLeg`, 0.09 * k, 0.5, 0); s(`${lado}Foot`, 0.09 * k, 0.08, 0); s(`${lado}Toes`, 0.09 * k, 0.01, 0.13);
    const x0 = 0.7 * k;
    s(`${lado}ThumbMetacarpal`, x0 + 0.02 * k, 1.39, 0.025); s(`${lado}ThumbProximal`, x0 + 0.05 * k, 1.39, 0.045); s(`${lado}ThumbDistal`, x0 + 0.08 * k, 1.39, 0.06); s(`${lado}ThumbTip`, x0 + 0.105 * k, 1.39, 0.07);
    [['Index', 0.025], ['Middle', 0.005], ['Ring', -0.015], ['Little', -0.033]].forEach(([d, z]) => {
      const L = d === 'Little' ? 0.75 : d === 'Middle' ? 1.05 : 1;
      s(`${lado}${d}Proximal`, x0 + 0.09 * k, 1.4, z); s(`${lado}${d}Intermediate`, x0 + (0.09 + 0.04 * L) * k, 1.4, z);
      s(`${lado}${d}Distal`, x0 + (0.09 + 0.065 * L) * k, 1.4, z); s(`${lado}${d}Tip`, x0 + (0.09 + 0.085 * L) * k, 1.4, z);
    });
  }
  return P;
}

// ------------------------------------------------------------------ mapeamento de nomes de ossos

/** Mixamo (mixamorig:*) → humanoide. Também cobre exportações sem o prefixo. */
const MIXAMO = { Hips: 'hips', Spine: 'spine', Spine1: 'chest', Spine2: 'upperChest', Neck: 'neck', Head: 'head', LeftEye: 'leftEye', RightEye: 'rightEye' };
for (const [s, l] of [['Left', 'left'], ['Right', 'right']]) {
  Object.assign(MIXAMO, { [`${s}Shoulder`]: `${l}Shoulder`, [`${s}Arm`]: `${l}UpperArm`, [`${s}ForeArm`]: `${l}LowerArm`, [`${s}Hand`]: `${l}Hand`,
    [`${s}UpLeg`]: `${l}UpperLeg`, [`${s}Leg`]: `${l}LowerLeg`, [`${s}Foot`]: `${l}Foot`, [`${s}ToeBase`]: `${l}Toes` });
  const nomes = { Thumb: 'Thumb', Index: 'Index', Middle: 'Middle', Ring: 'Ring', Pinky: 'Little' };
  for (const [mx, d] of Object.entries(nomes)) SEGS[d].forEach((g, i) => { MIXAMO[`${s}Hand${mx}${i + 1}`] = `${l}${d}${g}`; });
  for (const [mx, d] of Object.entries(nomes)) MIXAMO[`${s}Hand${mx}4`] = `${l}${d}Tip`;
}

/** Tira prefixos comuns (mixamorig:, Armature|, DEF-, J_Bip_C_, CC_Base_, Bip01…) */
export function limparNome(n) {
  return String(n || '').replace(/^.*[:|]/, '').replace(/^(mixamorig\d*_?|def[-_]|orgs?[-_]|cc_base_|j_bip_[clr]_|j_bip_|bip0?1[ _]?|b_|bn_|bone_)/i, '');
}
function lado(nome) {
  const s = String(nome);
  if (/(^|[^a-z])(left|esq)/i.test(s) || /left/i.test(s) || /(^|[_.\s-])l([_.\s-]|$)/i.test(s) || /[_.\s-]l$/i.test(s) || /^l[A-Z_]/.test(s) || /J_Bip_L_/i.test(s)) return 'left';
  if (/(^|[^a-z])(right|dir)/i.test(s) || /right/i.test(s) || /(^|[_.\s-])r([_.\s-]|$)/i.test(s) || /[_.\s-]r$/i.test(s) || /^r[A-Z_]/.test(s) || /J_Bip_R_/i.test(s)) return 'right';
  return null;
}

/**
 * Mapeia nomes de ossos de um modelo para o humanoide. `ossos` = [{ nome, prof (profundidade
 * na hierarquia) }]. Ordem: humanoide do VRM (vem pronto, fora daqui), nome exato do humanoide,
 * tabela Mixamo, e heurística por palavras e lado. Devolve { mapa: {humanoide: nomeDoOsso},
 * origem: {humanoide: 'exato'|'mixamo'|'heuristica'} }.
 */
export function mapearOssos(ossos) {
  const mapa = {}, origem = {}, usados = new Set();
  const canon = new Set(HUMANOIDE.map(([n]) => n).concat(['leftThumbTip', 'leftIndexTip', 'leftMiddleTip', 'leftRingTip', 'leftLittleTip', 'rightThumbTip', 'rightIndexTip', 'rightMiddleTip', 'rightRingTip', 'rightLittleTip']));
  const por = (h, nome, o) => { if (!mapa[h] && !usados.has(nome)) { mapa[h] = nome; origem[h] = o; usados.add(nome); } };
  for (const b of ossos) {
    const c = limparNome(b.nome);
    const exato = [...canon].find((h) => h.toLowerCase() === c.toLowerCase());
    if (exato) por(exato, b.nome, 'exato');
  }
  for (const b of ossos) { const c = limparNome(b.nome); if (MIXAMO[c]) por(MIXAMO[c], b.nome, 'mixamo'); }
  // heurística: palavras-chave por parte do corpo
  const REGRAS = [
    ['hips', /^(hips?|pelvis|quadril|bacia)$/i, false], ['hips', /(hips|pelvis)/i, false],
    ['upperChest', /(upper_?chest|spine_?0?3|spine2)/i, false], ['chest', /(chest|spine_?0?2|spine1|torso)/i, false], ['spine', /(spine|coluna|abdomen)/i, false],
    ['neck', /(neck|pescoco)/i, false], ['head', /^(head|cabeca)/i, false], ['head', /head(?!.*(top|end|nub))/i, false],
    ['Shoulder', /(shoulder|clavicle|clav|ombro)/i, true], ['UpperArm', /(upper_?arm|uparm|arm_?upper|^arm$|^.?arm$|biceps|braco)/i, true],
    ['LowerArm', /(fore_?arm|lower_?arm|lowarm|elbow|antebraco)/i, true], ['Hand', /(hand|wrist|palm|mao)(?!.*(thumb|index|middle|ring|pinky|little|finger))/i, true],
    ['UpperLeg', /(thigh|up_?leg|upper_?leg|coxa|femur)/i, true], ['LowerLeg', /(calf|shin|knee|lower_?leg|low_?leg|canela|^.?leg$|^leg$)/i, true],
    ['Foot', /(foot|ankle|pe$)(?!.*(toe|ball))/i, true], ['Toes', /(toe|ball)/i, true],
  ];
  const ordenados = ossos.slice().sort((a, b) => a.prof - b.prof);
  for (const [alvo, re, temLado] of REGRAS) {
    for (const b of ordenados) {
      if (usados.has(b.nome)) continue;
      const c = limparNome(b.nome);
      if (/(thumb|index|middle|ring|pinky|little|finger|dedo|twist|roll|end|nub|ik|pole|target|helper)/i.test(c) && !/(Toes)/.test(alvo)) continue;
      if (!re.test(c)) continue;
      if (temLado) { const l = lado(b.nome); if (!l) continue; por(l + alvo, b.nome, 'heuristica'); }
      else por(alvo, b.nome, 'heuristica');
    }
  }
  // dedos por palavra + ordem na hierarquia
  const PAL = { Thumb: /(thumb|polegar)/i, Index: /(index|indicador|pointer)/i, Middle: /(middle|medio)/i, Ring: /(ring|anelar)/i, Little: /(pinky|little|minimo)/i };
  for (const s of ['left', 'right']) {
    for (const d of DEDOS) {
      const cands = ordenados.filter((b) => !usados.has(b.nome) && PAL[d].test(limparNome(b.nome)) && lado(b.nome) === s);
      cands.slice(0, 4).forEach((b, i) => { if (i < 3) por(`${s}${d}${SEGS[d][i]}`, b.nome, 'heuristica'); else por(`${s}${d}Tip`, b.nome, 'heuristica'); });
    }
  }
  return { mapa, origem };
}

// ------------------------------------------------------------------ esqueleto padrão do robo (15 juntas)

/** O esqueleto do BVH do GPlanSiS|ROBO (core/mocap/exportar.ts): [nome, ref, pai, offset, osso, fim]. */
const ROBO = [
  ['Hips', [23, 24], null, [0, 0, 0], [0, 1, 0]], ['Spine', [23, 24], 'Hips', [0, 0, 0], [0, 1, 0]], ['Neck', [11, 12], 'Spine', [0, 1, 0], [0, 1, 0], 0],
  ['LeftArm', 11, 'Neck', [1, 0, 0], [1, 0, 0]], ['LeftForeArm', 13, 'LeftArm', [1, 0, 0], [1, 0, 0]], ['LeftHand', 15, 'LeftForeArm', [1, 0, 0], [1, 0, 0], 19],
  ['RightArm', 12, 'Neck', [-1, 0, 0], [-1, 0, 0]], ['RightForeArm', 14, 'RightArm', [-1, 0, 0], [-1, 0, 0]], ['RightHand', 16, 'RightForeArm', [-1, 0, 0], [-1, 0, 0], 20],
  ['LeftUpLeg', 23, 'Hips', [1, 0, 0], [0, -1, 0]], ['LeftLeg', 25, 'LeftUpLeg', [0, -1, 0], [0, -1, 0]], ['LeftFoot', 27, 'LeftLeg', [0, -1, 0], [0, 0, 1], 31],
  ['RightUpLeg', 24, 'Hips', [-1, 0, 0], [0, -1, 0]], ['RightLeg', 26, 'RightUpLeg', [0, -1, 0], [0, -1, 0]], ['RightFoot', 28, 'RightLeg', [0, -1, 0], [0, 0, 1], 32],
].map(([nome, ref, pai, offset, osso, fim]) => ({ nome, ref, pai, offset: new THREE.Vector3(...offset), osso: new THREE.Vector3(...osso), fim, filhos: [] }));
for (const j of ROBO) if (j.pai) ROBO.find((p) => p.nome === j.pai).filhos.push(j.nome);
const ROBO_POR = new Map(ROBO.map((j) => [j.nome, j]));
const ptR = (q, r) => (typeof r === 'number' ? vec(q[r]) : q[r[0]] && q[r[1]] ? meio(vec(q[r[0]]), vec(q[r[1]])) : null);
function refRobo(q, lat, cima) {
  const a = ptR(q, lat[0]), b = ptR(q, lat[1]), c0 = ptR(q, cima[0]), c1 = ptR(q, cima[1]);
  if (!a || !b || !c0 || !c1) return null;
  const x = a.sub(b).normalize(), y0 = c1.sub(c0);
  const y = y0.sub(x.clone().multiplyScalar(y0.dot(x))).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, V().crossVectors(x, y)));
}

/** Comprimentos medianos de cada osso do esqueleto padrão numa lista de quadros (como o paraBVH). */
export function comprimentosRobo(trilha) {
  const med = (a, b) => {
    const ls = trilha.map((q) => { const x = q && ptR(q, a), y = q && ptR(q, b); return x && y ? x.distanceTo(y) : NaN; }).filter(Number.isFinite).sort((u, v) => u - v);
    return ls.length ? ls[Math.floor(ls.length / 2)] : 0.1;
  };
  const L = {};
  for (const j of ROBO) L[j.nome] = j.pai ? (j.nome === 'Spine' ? 0 : med(ROBO_POR.get(j.pai).ref, j.ref)) : 0;
  return L;
}

/**
 * Esqueleto padrão de 15 juntas para UM quadro (o mesmo cálculo do paraBVH do robo: rotações
 * globais por referencial/menor rotação + cinemática direta com os comprimentos `L`), direto:
 * Map nome → Vector3, igual ao lerBVH(paraBVH(...)).quadros[0], sem texto. `ultima` (Map) guarda
 * a rotação local de quadros anteriores para juntas sem dado.
 */
export function retargetRobo(q, L, ultima = new Map()) {
  if (!q) return null;
  const glob = new Map(), pos = new Map();
  for (const j of ROBO) {
    let g;
    if (j.nome === 'Hips') g = refRobo(q, [23, 24], [[23, 24], [11, 12]]);
    else if (j.nome === 'Spine') g = glob.get('Hips').clone();
    else if (j.nome === 'Neck') g = refRobo(q, [11, 12], [[11, 12], 0]);
    else {
      const filho = j.filhos[0] ? ROBO_POR.get(j.filhos[0]).ref : j.fim;
      const a = ptR(q, j.ref), b = filho !== undefined ? ptR(q, filho) : null;
      const gp = glob.get(j.pai);
      g = a && b ? gp.clone().multiply(new THREE.Quaternion().setFromUnitVectors(j.osso, b.sub(a).normalize().applyQuaternion(gp.clone().invert()))) : null;
    }
    const gp = j.pai ? glob.get(j.pai) : new THREE.Quaternion();
    if (g) ultima.set(j.nome, gp.clone().invert().multiply(g));
    else g = gp.clone().multiply(ultima.get(j.nome) || new THREE.Quaternion());
    glob.set(j.nome, g);
    if (!j.pai) { const r = ptR(q, j.ref); if (!r) return null; pos.set(j.nome, r); }
    else pos.set(j.nome, j.offset.clone().multiplyScalar(L[j.nome] || 0).applyQuaternion(gp).add(pos.get(j.pai)));
  }
  return pos;
}
