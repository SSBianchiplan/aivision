/**
 * components/motion3d/cena3d.js — o viewport 3D do Motion 3D Studio (CV-88), em three.js 0.170.0
 * (vendor/three-0.170.0, a mesma versão do GPlanSiS|ROBO), carregado só quando o Studio abre.
 *
 * PORTE da cena do MoCap do GPlanSiS|ROBO (projeto/frontend/src/core/mocap/cena.ts, classe
 * CenaMocap): esqueleto (ossos + juntas instanciadas), centro de massa com rastro e projeção no
 * chão, base de suporte (âmbar quando o CoM sai dela), pirâmides das câmeras calibradas, grade,
 * órbita, e o cuidado de trocar a geometria das linhas a cada quadro (trocarPontos). O tema do
 * robo (seguirTema) virou o do iaVision (data-theme: escuro, claro, code). Acrescentado para o
 * Studio: piso, avatar (cápsulas ou manequim low-poly gerado em código — nenhum modelo baixado),
 * nomes dos ossos, o esqueleto RETARGETADO (BVH do robo) por cima dos marcadores, presets de
 * câmera (perspectiva, frente, lado, topo, "atrás" = como espelho), iluminação (lit/unlit/
 * wireframe), transformação do SK_Character (mover/girar/escala por arrasto) e render sob demanda.
 * Studio v2: o MODELO do usuário (avatar.js) no lugar das cápsulas, atores extras (várias
 * pessoas), câmera virtual que segue o ator (predefinições), fundo (cor, gradiente, imagem,
 * HDRI .hdr, chroma) e um gancho por quadro (molas do VRM, saída VMC, gravação contínua).
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';
import { OrbitControls } from '../../../vendor/three-0.170.0/addons/OrbitControls.js';
import { centroCamera, mv, transp } from '../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';
import { dprCanvas, TETO_STUDIO } from '../escala-canvas.js';

/** Do robo: setFromPoints numa geometria existente reaproveita o buffer — geometria nova sempre. */
export function trocarPontos(l, pts) {
  l.geometry.dispose();
  l.geometry = new THREE.BufferGeometry().setFromPoints(pts);
}

/** Ligações do esqueleto (as do robo). */
export const LIGACOES = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [15, 19], [12, 14], [14, 16], [16, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 11], [0, 12], [7, 8],
];

/** Juntas do esqueleto padrão (o BVH do robo, 15 juntas) sobre os marcadores. */
export const JUNTAS_PADRAO = [
  ['Hips', [23, 24]], ['Spine', [23, 24]], ['Neck', [11, 12]],
  ['LeftArm', 11], ['LeftForeArm', 13], ['LeftHand', 15], ['RightArm', 12], ['RightForeArm', 14], ['RightHand', 16],
  ['LeftUpLeg', 23], ['LeftLeg', 25], ['LeftFoot', 27], ['RightUpLeg', 24], ['RightLeg', 26], ['RightFoot', 28],
];

/** Segmentos do avatar: [a, b, raio do manequim (m)] — a/b são marcadores ou pares (ponto médio). */
const SEGMENTOS = [
  [[11, 12], [7, 8], 0.045], [11, 13, 0.05], [13, 15, 0.042], [15, [17, 19], 0.035], [12, 14, 0.05], [14, 16, 0.042], [16, [18, 20], 0.035],
  [23, 25, 0.075], [25, 27, 0.058], [27, 31, 0.04], [29, 31, 0.035], [24, 26, 0.075], [26, 28, 0.058], [28, 32, 0.04], [30, 32, 0.035],
  [[11, 12], 11, 0.045], [[11, 12], 12, 0.045], [23, 24, 0.07],
];

const ponto = (q, r) => {
  if (!q) return null;
  if (typeof r === 'number') return q[r] || null;
  const a = q[r[0]], b = q[r[1]];
  return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] : null;
};

/** Cores por tema: acento verde-água no escuro (como a referência), sem quebrar o iaVision. */
export const CORES = {
  dark: { fundo: 0x0b1416, grade: 0x1f4a4a, grade2: 0x163235, piso: 0x0f2224, marca: 0x2ef2d0, junta: 0xe8fffb, avatar: 0x8fa6a8, retarget: 0xffd84d, cam: 0x5fb3a8, alerta: 0xe0a100 },
  light: { fundo: 0xdfe8e6, grade: 0x9fb8b4, grade2: 0xc3d3d0, piso: 0xeaf1ef, marca: 0x0b7a6e, junta: 0x04413c, avatar: 0x8a9694, retarget: 0xb07d00, cam: 0x285c56, alerta: 0xb36b00 },
  code: { fundo: 0x1e1e1e, grade: 0x3c3c3c, grade2: 0x2b2b2b, piso: 0x252526, marca: 0x4ec9b0, junta: 0xe0e0e0, avatar: 0x8a8a8a, retarget: 0xffd84d, cam: 0x9cdcfe, alerta: 0xcca700 },
};
const temaAtual = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'light' || t === 'code' ? t : 'dark'; };

function rotulo(texto, k = 1) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '600 28px Archivo, Arial, sans-serif';
  const w = Math.ceil(g.measureText(texto).width) + 16;
  c.width = w; c.height = 40;
  g.font = '600 28px Archivo, Arial, sans-serif';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, w, 40);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(texto, 8, 21);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, transparent: true }));
  s.scale.set((w / 40) * 0.05 * k, 0.05 * k, 1);
  s.renderOrder = 10;
  return s;
}

export class CenaMotion3D {
  constructor(host) {
    this.host = host;
    this.opc = { esqueleto: true, avatar: 'capsulas', grade: true, piso: true, nomes: false, retarget: false, com: true, cameras: true, luz: 'lit' };
    this.ferramenta = 'orbitar';
    this.sujo = true;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    this.renderer.domElement.setAttribute('aria-label', 'Viewport 3D: esqueleto e avatar');
    host.appendChild(this.renderer.domElement);
    this.cena = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.02, 200);
    this.camera.position.set(2.6, 1.8, 3.4);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.target.set(0, 0.9, 0);
    this.controles.enableDamping = true;
    this.controles.addEventListener('change', () => { this.sujo = true; });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445055, 1.1);
    this.luz = new THREE.DirectionalLight(0xffffff, 1.4); this.luz.position.set(2, 5, 3);
    this.cena.add(this.hemi, this.luz);
    // piso grande (o ator anda pelo piso como no vídeo) com névoa da cor do fundo: a borda some numa
    // linha de horizonte coerente; a grade (30 m, células de 25 cm) acompanha o ator
    this.gradeObj = new THREE.GridHelper(30, 120, 0x1f4a4a, 0x163235);
    this.pisoObj = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0f2224, roughness: 0.95, metalness: 0 }));
    this.pisoObj.position.y = -0.002;
    this.cena.add(this.pisoObj, this.gradeObj);

    // SK_Character: tudo que é do ator fica num grupo com a transformação do Details
    this.ator = new THREE.Group(); this.ator.name = 'SK_Character';
    this.cena.add(this.ator);
    this.ossos = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2ef2d0 }));
    this.juntas = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshStandardMaterial({ color: 0xe8fffb, emissive: 0x0a8f9f, emissiveIntensity: 0.35, roughness: 0.5 }), 33);
    this.retarget = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffd84d, depthTest: false, transparent: true, opacity: 0.95 }));
    this.retarget.renderOrder = 5;
    this.ossos.frustumCulled = false; this.juntas.frustumCulled = false; this.retarget.frustumCulled = false;
    this.ator.add(this.ossos, this.juntas, this.retarget);
    this.avatar = new THREE.Group(); this.avatar.name = 'Avatar';
    this.ator.add(this.avatar);
    this._criarAvatar();
    this.nomes = new THREE.Group();
    this.ator.add(this.nomes);
    this._sprites = JUNTAS_PADRAO.map(([n]) => { const s = rotulo(n); this.nomes.add(s); return s; });
    // do robo: CoM, projeção no chão, rastro e base de suporte
    this.com = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    this.comChao = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.rastro = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x6b7278 }));
    this.base = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2b3035 }));
    this.ator.add(this.com, this.comChao, this.rastro, this.base);
    // sombra de contato (mancha suave sob o ator) e anel no ponto de apoio: o boneco "pousa" no piso
    const cs = document.createElement('canvas'); cs.width = cs.height = 64;
    const gs = cs.getContext('2d'), gr = gs.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.45, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    gs.fillStyle = gr; gs.fillRect(0, 0, 64, 64);
    this.sombra = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cs), transparent: true, depthWrite: false, opacity: 0.5 }));
    this.sombra.renderOrder = 1; this.sombra.visible = false;
    this.apoio = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2ef2d0, transparent: true, opacity: 0.85, depthWrite: false }));
    this.apoio.renderOrder = 2; this.apoio.visible = false;
    this.ator.add(this.sombra, this.apoio);
    this.geoCam = null; this.camVideoAplicada = false; this.presetAtual = 'video';
    this.cams = new THREE.Group(); this.cams.name = 'Cameras';
    this.cena.add(this.cams);

    this.extras = new THREE.Group(); this.extras.name = 'Atores';
    this.cena.add(this.extras);
    this.modelo = null;
    this.seguirModo = 'livre'; this.alvoAtor = null; this._tAnt = performance.now(); this.continuo = false; this.aoQuadro = null;
    this.fundoCfg = { tipo: 'tema' };
    this._aplicarTema();
    this._mo = new MutationObserver(() => this._aplicarTema());
    this._mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.ro = new ResizeObserver(() => this.redimensionar());
    this.ro.observe(host);
    this.redimensionar();
    this._ligarArrasto();
    const laco = () => {
      this.raf = requestAnimationFrame(laco);
      const agora = performance.now(), dt = Math.min(0.1, (agora - this._tAnt) / 1000);
      this._tAnt = agora;
      if (this.aoQuadro) { try { if (this.aoQuadro(dt)) this.sujo = true; } catch (_) { /* o gancho não derruba o laço */ } }
      if (this._seguir(dt)) this.sujo = true;
      const mexeu = this.controles.update();
      if (mexeu || this.sujo || this.continuo) { this.sujo = false; this.renderer.render(this.cena, this.camera); this.quadrosDesenhados = (this.quadrosDesenhados || 0) + 1; }
    };
    laco();
  }

  _criarAvatar() {
    this.avatar.clear();
    this.segs = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x8fa6a8, roughness: 0.55, metalness: 0.08, flatShading: this.opc.avatar === 'manequim' });
    this.matAvatar = mat;
    const lados = this.opc.avatar === 'manequim' ? 7 : 14;
    const cil = new THREE.CylinderGeometry(1, 1, 1, lados, 1);
    const esf = new THREE.SphereGeometry(1, lados, Math.max(5, lados / 2));
    for (const [a, b, r] of SEGMENTOS) {
      const m = new THREE.Mesh(cil, mat);
      const raio = this.opc.avatar === 'manequim' ? r : r * 0.55;
      const j = new THREE.Mesh(esf, mat);
      j.scale.setScalar(raio);
      this.avatar.add(m, j);
      this.segs.push({ a, b, raio, m, j });
    }
    // tronco e cabeça do manequim
    this.tronco = new THREE.Mesh(this.opc.avatar === 'manequim' ? new THREE.BoxGeometry(1, 1, 1) : new THREE.CapsuleGeometry(0.5, 1, 4, 12), mat);
    this.cabeca = new THREE.Mesh(new THREE.SphereGeometry(1, lados, Math.max(6, lados / 2)), mat);
    this.avatar.add(this.tronco, this.cabeca);
    this.avatar.visible = this.opc.avatar !== 'nenhum';
    this._posarAvatar(this._q || null);   // sem quadro ainda: tudo escondido (nada na origem com escala 1)
  }

  _aplicarTema() {
    const c = CORES[temaAtual()];
    this.cores = c;
    if (!this.fundoCfg || this.fundoCfg.tipo === 'tema') this.cena.background = new THREE.Color(c.fundo);
    this._nevoa();
    this.ossos.material.color.setHex(c.marca);
    this.juntas.material.color.setHex(c.junta);
    this.retarget.material.color.setHex(c.retarget);
    this.pisoObj.material.color.setHex(c.piso);
    const mats = Array.isArray(this.gradeObj.material) ? this.gradeObj.material : [this.gradeObj.material];
    this.cena.remove(this.gradeObj);
    this.gradeObj.geometry.dispose(); mats.forEach((m) => m.dispose());
    const gp = this.gradeObj.position.clone();
    this.gradeObj = new THREE.GridHelper(30, 120, c.grade, c.grade2);
    this.gradeObj.position.copy(gp);
    this.gradeObj.visible = this.opc.grade;
    this.cena.add(this.gradeObj);
    if (this.apoio) this.apoio.material.color.setHex(c.marca);
    this.matAvatar && this.matAvatar.color.setHex(c.avatar);
    this.com.material.color.setHex(c.junta);
    this.comChao.material.color.setHex(c.marca);
    this.base.material.color.setHex(c.marca);
    this.cams.traverse((o) => { if (o.isLineSegments) o.material.color.setHex(c.cam); });
    this.sujo = true;
  }

  /** Opções de exibição (Show / Preview Settings / Lit). */
  definir(opc) {
    const antes = this.opc.avatar;
    Object.assign(this.opc, opc);
    if (opc.avatar && opc.avatar !== antes) this._criarAvatar();
    this.gradeObj.visible = this.opc.grade;
    this.pisoObj.visible = this.opc.piso;
    this.ossos.visible = this.juntas.visible = this.opc.esqueleto;
    this.avatar.visible = this.opc.avatar !== 'nenhum' && !this.modelo;
    if (this.modelo) this.modelo.base.visible = this.opc.avatar !== 'nenhum';
    this.nomes.visible = this.opc.nomes;
    this.retarget.visible = this.opc.retarget;
    this.com.visible = this.comChao.visible = this.rastro.visible = this.base.visible = this.opc.com && this._temCom;
    this.cams.visible = this.opc.cameras;
    const wire = this.opc.luz === 'wireframe', semLuz = this.opc.luz === 'unlit';
    this.hemi.intensity = semLuz ? 3 : 1.1; this.luz.intensity = semLuz ? 0 : 1.4;
    if (this.matAvatar) { this.matAvatar.wireframe = wire; this.matAvatar.needsUpdate = true; }
    this.sujo = true;
  }

  /** Névoa da cor do fundo (só com fundo de tema ou cor lisa): o fim do piso vira horizonte. */
  _nevoa() {
    const t = this.fundoCfg ? this.fundoCfg.tipo : 'tema';
    const bg = this.cena.background;
    this.cena.fog = (t === 'tema' || t === 'cor') && bg && bg.isColor ? new THREE.Fog(bg.getHex(), 18, 70) : null;
  }

  /**
   * Presets de câmera: 'video' (do lado da câmera do vídeo, na altura e inclinação estimadas pelo
   * levantamento), frente, 3/4, lado, topo, perspectiva, atrás (o avatar se move como um espelho).
   * A distância enquadra uma pessoa de ~1,7 m com folga (FOV 45°).
   */
  vista(nome) {
    this.presetAtual = nome;
    const alvo = this.controles.target.clone();
    const d = 3.8;
    const g = this.geoCam || { altura: 1.3, inclinacaoGraus: 6 };
    const hv = Math.min(3, Math.max(0.4, g.altura));
    const P = {
      video: [0, hv, d], perspectiva: [2.6, 1.8, 3.4], frente: [0, 1.1, d], tresquartos: [d * 0.71, 1.4, d * 0.71],
      lado: [d, 1.1, 0], topo: [0, d + 1.2, 0.001], atras: [0, 1.3, -d],
    }[nome] || [0, hv, d];
    if (nome === 'video') alvo.y = Math.max(0.6, Math.min(1.2, hv - Math.tan(((g.inclinacaoGraus || 0) * Math.PI) / 180) * d));
    this.controles.target.copy(alvo);
    this.camera.position.set(alvo.x + P[0], P[1], alvo.z + P[2]);
    this.controles.update();
    this.sujo = true;
  }
  /** Geometria estimada da câmera do vídeo ({ altura (m), inclinacaoGraus }): aplicada uma vez no preset 'video'. */
  definirCameraVideo(geo) {
    if (!geo || !Number.isFinite(geo.altura)) return;
    this.geoCam = geo;
    if (!this.camVideoAplicada && this.presetAtual === 'video') { this.camVideoAplicada = true; this.vista('video'); }
  }

  /** Transformação do SK_Character (Details › Transform). rot em graus. */
  transformar({ pos, rot, escala }) {
    if (pos) this.ator.position.set(pos[0], pos[1], pos[2]);
    if (rot) this.ator.rotation.set((rot[0] * Math.PI) / 180, (rot[1] * Math.PI) / 180, (rot[2] * Math.PI) / 180);
    if (escala != null) this.ator.scale.setScalar(Math.max(0.05, escala));
    this.sujo = true;
  }
  transformacao() {
    const r = this.ator.rotation;
    return { pos: this.ator.position.toArray().map((v) => +v.toFixed(3)), rot: [r.x, r.y, r.z].map((v) => +((v * 180) / Math.PI).toFixed(1)), escala: +this.ator.scale.x.toFixed(3) };
  }

  /**
   * Ferramenta da barra: 'orbitar' (órbita normal), 'mover' (arrasto move no piso), 'girar'
   * (arrasto gira em torno de y), 'escala' (arrasto vertical escala). `aoMudar` recebe a nova
   * transformação ao soltar.
   */
  usarFerramenta(f, aoMudar) {
    this.ferramenta = f;
    this.aoMudarTransformacao = aoMudar;
    this.controles.enabled = f === 'orbitar';
    this.renderer.domElement.style.cursor = f === 'orbitar' ? '' : f === 'mover' ? 'move' : f === 'girar' ? 'ew-resize' : 'ns-resize';
  }
  _ligarArrasto() {
    const el = this.renderer.domElement;
    let ini = null;
    el.addEventListener('pointerdown', (e) => {
      if (this.ferramenta === 'orbitar') return;
      ini = { x: e.clientX, y: e.clientY, pos: this.ator.position.clone(), rotY: this.ator.rotation.y, esc: this.ator.scale.x };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!ini) return;
      const dx = e.clientX - ini.x, dy = e.clientY - ini.y;
      if (this.ferramenta === 'mover') {
        // move no plano do chão, alinhado à câmera
        const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
        const dir2 = new THREE.Vector3(-dir.z, 0, dir.x);
        const k = 0.005 * this.camera.position.distanceTo(this.controles.target);
        this.ator.position.copy(ini.pos).addScaledVector(dir2, dx * k).addScaledVector(dir, -dy * k);
      } else if (this.ferramenta === 'girar') this.ator.rotation.y = ini.rotY + dx * 0.01;
      else if (this.ferramenta === 'escala') this.ator.scale.setScalar(Math.max(0.05, ini.esc * Math.exp(-dy * 0.005)));
      this.sujo = true;
    });
    const soltar = () => { if (ini && this.aoMudarTransformacao) this.aoMudarTransformacao(this.transformacao()); ini = null; };
    el.addEventListener('pointerup', soltar);
    el.addEventListener('pointercancel', soltar);
  }

  /** Pirâmides das câmeras calibradas (do robo). */
  mostrarCameras(cs) {
    this.cams.clear();
    for (const c of cs || []) {
      const o = centroCamera(c);
      const Rt = transp(c.R);
      const canto = (u, v) => { const d = mv(Rt, [(u - c.cx) / c.f, (v - c.cy) / c.f, 1]); return new THREE.Vector3(o[0] + d[0] * 0.3, o[1] + d[1] * 0.3, o[2] + d[2] * 0.3); };
      const O = new THREE.Vector3(...o);
      const k = [canto(0, 0), canto(c.largura, 0), canto(c.largura, c.altura), canto(0, c.altura)];
      const pts = [O, k[0], O, k[1], O, k[2], O, k[3], k[0], k[1], k[1], k[2], k[2], k[3], k[3], k[0]];
      this.cams.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: this.cores.cam })));
    }
    this.sujo = true;
  }

  /**
   * Um quadro: q (33 × [x,y,z] | null, convenção do robo), CoM, rastro, base de suporte (do robo)
   * e, opcional, as juntas retargetadas (Map nome → THREE.Vector3 do BVH lido).
   */
  mostrarQuadro(q, com = null, rastroPts = [], base = [], margem = null, retarget = null) {
    this._q = q;
    const seg = [];
    if (q) for (const [a, b] of LIGACOES) if (q[a] && q[b]) seg.push(...q[a], ...q[b]);
    this.ossos.geometry.dispose();
    this.ossos.geometry = new THREE.BufferGeometry();
    this.ossos.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    const m = new THREE.Matrix4();
    for (let i = 0; i < 33; i++) { const p = q && q[i]; m.makeTranslation(p ? p[0] : 0, p ? p[1] : -10, p ? p[2] : 0); this.juntas.setMatrixAt(i, m); }
    this.juntas.instanceMatrix.needsUpdate = true;
    this._posarAvatar(q);
    this._sombra(q);
    // nomes dos ossos (juntas do esqueleto padrão)
    JUNTAS_PADRAO.forEach(([, ref], i) => { const p = ponto(q, ref); const s = this._sprites[i]; s.visible = Boolean(p); if (p) s.position.set(p[0] + 0.02, p[1] + (i === 1 ? 0.12 : 0.03), p[2]); });
    // CoM do robo
    this._temCom = Boolean(com);
    this.com.visible = this.comChao.visible = this.opc.com && Boolean(com);
    const fora = margem !== null && margem < 0;
    this.com.material.color.setHex(fora ? this.cores.alerta : this.cores.junta);
    if (com) { this.com.position.set(com[0], com[1], com[2]); this.comChao.position.set(com[0], 0.002, com[2]); }
    trocarPontos(this.rastro, (rastroPts || []).filter(Boolean).map((r) => new THREE.Vector3(r[0], 0.003, r[2])));
    trocarPontos(this.base, (base || []).map((p) => new THREE.Vector3(p.x, 0.002, p.z)));
    this.base.material.color.setHex(fora ? this.cores.alerta : this.cores.marca);
    this.rastro.visible = this.base.visible = this.opc.com && Boolean(com);
    // retarget: o esqueleto padrão lido do BVH (pais → filhos)
    const rs = [];
    if (retarget) {
      const pares = [['Hips', 'Spine'], ['Spine', 'Neck'], ['Neck', 'LeftArm'], ['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['Neck', 'RightArm'], ['RightArm', 'RightForeArm'],
        ['RightForeArm', 'RightHand'], ['Hips', 'LeftUpLeg'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot'], ['Hips', 'RightUpLeg'], ['RightUpLeg', 'RightLeg'], ['RightLeg', 'RightFoot']];
      for (const [a, b] of pares) { const A = retarget.get(a), B = retarget.get(b); if (A && B) rs.push(A.x, A.y, A.z, B.x, B.y, B.z); }
    }
    this.retarget.geometry.dispose();
    this.retarget.geometry = new THREE.BufferGeometry();
    this.retarget.geometry.setAttribute('position', new THREE.Float32BufferAttribute(rs, 3));
    this.sujo = true;
  }

  /** Sombra de contato sob o quadril/CoM (some com a altura do pulo) e anel no pé de apoio; a grade acompanha o ator. */
  _sombra(q) {
    const pes = q ? [27, 28, 29, 30, 31, 32].filter((k) => q[k]) : [];
    const Q = q && q[23] && q[24] ? [(q[23][0] + q[24][0]) / 2, (q[23][2] + q[24][2]) / 2] : null;
    this.sombra.visible = this.apoio.visible = false;
    if (!Q || !pes.length) return;
    const ys = pes.map((k) => q[k][1]), h = Math.max(0, Math.min(...ys));
    const xs = pes.map((k) => q[k][0]), zs = pes.map((k) => q[k][2]);
    const larg = Math.max(0.45, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 0.35);
    this.sombra.visible = true;
    this.sombra.position.set(Q[0], 0.003, Q[1]);
    this.sombra.scale.set(larg * (1 + h), 1, larg * 0.8 * (1 + h));
    this.sombra.material.opacity = 0.55 * Math.max(0.15, 1 - h / 0.6);
    const kb = pes.reduce((a, k) => (q[k][1] < q[a][1] ? k : a), pes[0]);
    if (q[kb][1] < 0.03) { this.apoio.visible = true; this.apoio.position.set(q[kb][0], 0.004, q[kb][2]); }
    // grade: recentra em passos de 1 m (múltiplo da célula), as linhas não "andam"
    const w = new THREE.Vector3(Q[0], 0, Q[1]).applyMatrix4(this.ator.matrixWorld);
    this.gradeObj.position.set(Math.round(w.x), 0, Math.round(w.z));
  }

  _posarAvatar(q) {
    if (!this.segs) return;
    const up = new THREE.Vector3(0, 1, 0), A = new THREE.Vector3(), B = new THREE.Vector3(), d = new THREE.Vector3();
    for (const s of this.segs) {
      const pa = ponto(q, s.a), pb = ponto(q, s.b);
      s.m.visible = s.j.visible = Boolean(pa && pb);
      if (!pa || !pb) continue;
      A.set(...pa); B.set(...pb); d.subVectors(B, A);
      const L = d.length();
      s.m.position.addVectors(A, B).multiplyScalar(0.5);
      s.m.quaternion.setFromUnitVectors(up, d.normalize());
      s.m.scale.set(s.raio, Math.max(1e-3, L), s.raio);
      s.j.position.copy(B);
    }
    const ombro = ponto(q, [11, 12]), quadril = ponto(q, [23, 24]), cab = ponto(q, [7, 8]) || (q && q[0]) || null;
    this.tronco.visible = Boolean(ombro && quadril && q[11] && q[12]);
    if (this.tronco.visible) {
      A.set(...quadril); B.set(...ombro); d.subVectors(B, A);
      const L = d.length(), larg = Math.hypot(q[11][0] - q[12][0], q[11][1] - q[12][1], q[11][2] - q[12][2]);
      // base ortonormal: y = quadril→ombro, x = linha dos ombros, z = frente
      const y = d.clone().normalize();
      const x = new THREE.Vector3(q[11][0] - q[12][0], q[11][1] - q[12][1], q[11][2] - q[12][2]);
      x.addScaledVector(y, -x.dot(y)).normalize();
      const z = new THREE.Vector3().crossVectors(x, y);
      this.tronco.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      this.tronco.position.addVectors(A, B).multiplyScalar(0.5);
      if (this.opc.avatar === 'manequim') this.tronco.scale.set(larg * 0.85, L, 0.2);
      else this.tronco.scale.set(larg * 0.42, L * 0.5, 0.16);
    }
    this.cabeca.visible = Boolean(cab);
    if (cab) { this.cabeca.position.set(cab[0], cab[1] + 0.02, cab[2]); this.cabeca.scale.set(0.095, 0.115, 0.105); }
  }

  // ------------------------------------------------------------------ Studio v2

  /** Põe (ou tira, com null) o modelo do usuário (AvatarRig) no lugar das cápsulas. */
  definirModelo(rig) {
    if (this.modelo && this.modelo !== rig) this.ator.remove(this.modelo.base);
    this.modelo = rig || null;
    if (rig) { this.ator.add(rig.base); rig.base.visible = this.opc.avatar !== 'nenhum'; }
    this.avatar.visible = this.opc.avatar !== 'nenhum' && !rig;
    this.sujo = true;
  }

  /**
   * Atores extras (várias pessoas): [{ id, q (33 pontos), desl [x,y,z], rig? }]. Sem modelo, um
   * esqueleto de linhas com a cor de cada ator.
   */
  mostrarExtras(lista) {
    const vistos = new Set();
    this._extras = this._extras || new Map();
    // a mesma cor do vídeo: Ator 1 no acento, 2 amarelo, 3 rosa, 4 azul
    const CORES_EX = [this.cores.marca, 0xffd84d, 0xf472b6, 0x60a5fa];
    (lista || []).forEach((a, k) => {
      vistos.add(a.id);
      let e = this._extras.get(a.id);
      const cor = CORES_EX[(a.cor ?? k + 1) % 4];
      if (!e) {
        const g = new THREE.Group(); g.name = 'Ator_' + a.id;
        const l = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: cor }));
        const j = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshStandardMaterial({ color: cor }), 33);
        l.frustumCulled = false; j.frustumCulled = false; g.add(l, j);
        const sp = rotulo(a.rotulo || `Ator ${k + 2}`, 2.2); g.add(sp);
        this.extras.add(g);
        e = { g, l, j, sp, rig: null, rot: a.rotulo };
        this._extras.set(a.id, e);
      }
      e.l.material.color.setHex(cor); e.j.material.color.setHex(cor);
      if (a.rotulo && a.rotulo !== e.rot) { e.g.remove(e.sp); e.sp.material.map.dispose(); e.sp.material.dispose(); e.sp = rotulo(a.rotulo, 2.2); e.g.add(e.sp); e.rot = a.rotulo; }
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < 33; i++) { const p = a.q && a.q[i]; m4.makeTranslation(p ? p[0] : 0, p ? p[1] : -10, p ? p[2] : 0); e.j.setMatrixAt(i, m4); }
      e.j.instanceMatrix.needsUpdate = true;
      e.j.visible = !a.rig;
      const cab = a.q && (a.q[0] || a.q[11]);
      e.sp.visible = Boolean(cab);
      if (cab) e.sp.position.set(cab[0], cab[1] + 0.32, cab[2]);
      if (a.rig && e.rig !== a.rig) { if (e.rig) e.g.remove(e.rig.base); e.rig = a.rig; e.g.add(a.rig.base); }
      e.g.position.set(...(a.desl || [0, 0, 0]));
      const seg = [];
      if (a.q && (!e.rig || this.opc.esqueleto)) for (const [x, y] of LIGACOES) if (a.q[x] && a.q[y]) seg.push(...a.q[x], ...a.q[y]);
      e.l.geometry.dispose(); e.l.geometry = new THREE.BufferGeometry(); e.l.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    });
    for (const [id, e] of this._extras) if (!vistos.has(id)) { if (e.rig) e.g.remove(e.rig.base); this.extras.remove(e.g); e.l.geometry.dispose(); e.j.geometry.dispose(); e.sp.material.map.dispose(); this._extras.delete(id); }
    if (!this._extras.size && this._rotPri) this._rotPri.visible = false;
    this.sujo = true;
  }
  /** Rótulo do ator principal (várias pessoas), acima da cabeça dele. */
  rotuloPrincipal(texto) {
    if (!this._rotPri || this._rotPriTxt !== texto) {
      if (this._rotPri) { this.ator.remove(this._rotPri); this._rotPri.material.map.dispose(); this._rotPri.material.dispose(); }
      this._rotPri = rotulo(texto, 2.2); this._rotPriTxt = texto; this.ator.add(this._rotPri);
    }
    const q = this._q, cab = q && (q[0] || q[11]);
    this._rotPri.visible = Boolean(cab);
    if (cab) this._rotPri.position.set(cab[0], cab[1] + 0.32, cab[2]);
  }

  /**
   * Câmera virtual: 'livre' | 'seguir' (o alvo acompanha o quadril, a órbita do usuário vale) |
   * 'rosto' (close) | 'americano' (plano americano) | 'geral' (plano geral) | 'lateral'
   * (travelling de lado) | 'orbita' (gira em volta do ator).
   */
  definirSeguir(modo) {
    this.seguirModo = modo || 'livre';
    this._offset = null;
    this.sujo = true;
  }
  /** Posição (no mundo) do ator a seguir, chamada a cada pose. */
  alvo(p) { if (p && p.every(Number.isFinite)) { this.alvoAtor = this.alvoAtor || new THREE.Vector3(); this.alvoAtor.set(p[0], p[1], p[2]).applyMatrix4(this.ator.matrixWorld); } }
  _seguir(dt) {
    const m = this.seguirModo;
    if (m === 'livre' || !this.alvoAtor) return false;
    const PRE = { rosto: [0.25, 0.25, 0.95, 0.55], americano: [0.5, 0.15, 2.4, 0.2], geral: [1.2, 0.6, 5.2, 0.05], lateral: [3.0, 0.2, 0.01, 0.1] };
    const k = 1 - Math.exp(-dt * 4);   // suavização exponencial (sem tranco)
    const alvo = this.alvoAtor.clone();
    if (m === 'rosto') alvo.y += 0.62; else if (m === 'americano') alvo.y += 0.15; else if (m === 'lateral') alvo.y += 0.1;
    const t = this.controles.target;
    if (m === 'seguir') {
      // mantém o deslocamento da câmera escolhido pelo usuário (órbita livre continua valendo)
      const off = this.camera.position.clone().sub(t);
      t.lerp(alvo, k);
      this.camera.position.copy(t).add(off);
      return true;
    }
    if (m === 'orbita') {
      this._ang = (this._ang || 0) + dt * 0.35;
      const d = 3.4;
      t.lerp(alvo, k);
      this.camera.position.set(t.x + Math.sin(this._ang) * d, t.y + 0.5, t.z + Math.cos(this._ang) * d);
      return true;
    }
    const [lx, ly, dz, py] = PRE[m];
    const desejada = new THREE.Vector3(alvo.x + lx * 0.3, alvo.y + ly, alvo.z + dz);
    if (m === 'lateral') desejada.set(alvo.x + lx, alvo.y + ly, alvo.z + dz);
    t.lerp(alvo, k);
    this.camera.position.lerp(desejada, k);
    void py;
    return true;
  }

  /**
   * Fundo: { tipo: 'tema' | 'cor' | 'gradiente' | 'imagem' | 'hdri' | 'chroma', cor, imagem
   * (HTMLImageElement/ImageBitmap/canvas), hdr (ArrayBuffer .hdr) }. HDRI e imagem 2:1 viram
   * panorama (equiretangular) e também iluminam o modelo (ambiente PMREM).
   */
  async definirFundo(cfg) {
    this.fundoCfg = { ...cfg };
    const velho = this._fundoTex;
    this._fundoTex = null;
    this.cena.environment = null;
    if (this._env) { this._env.dispose(); this._env = null; }
    let bg = null;
    if (cfg.tipo === 'cor' || cfg.tipo === 'chroma') bg = new THREE.Color(cfg.tipo === 'chroma' ? (cfg.cor || '#00b140') : cfg.cor || '#202830');
    else if (cfg.tipo === 'gradiente') {
      const c = document.createElement('canvas'); c.width = 16; c.height = 256;
      const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, cfg.cor || '#4b79a8'); gr.addColorStop(0.55, cfg.cor2 || '#c9d8e4'); gr.addColorStop(1, cfg.cor3 || '#e8e2d4');
      g.fillStyle = gr; g.fillRect(0, 0, 16, 256);
      bg = new THREE.CanvasTexture(c); bg.colorSpace = THREE.SRGBColorSpace;
    } else if (cfg.tipo === 'imagem' && cfg.imagem) {
      bg = new THREE.Texture(cfg.imagem); bg.colorSpace = THREE.SRGBColorSpace; bg.needsUpdate = true;
      const w = cfg.imagem.width, h = cfg.imagem.height;
      if (w && h && Math.abs(w / h - 2) < 0.05) { bg.mapping = THREE.EquirectangularReflectionMapping; this._ambiente(bg); }
    } else if (cfg.tipo === 'hdri' && cfg.hdr) {
      const { RGBELoader } = await import('../../../vendor/three-0.170.0/addons/RGBELoader.js');
      const d = new RGBELoader().parse(cfg.hdr);
      const t = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
      t.colorSpace = THREE.LinearSRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.flipY = true; t.needsUpdate = true;
      t.mapping = THREE.EquirectangularReflectionMapping;
      bg = t; this._ambiente(t);
    }
    if (!bg) bg = new THREE.Color(this.cores.fundo);
    this.cena.background = bg;
    this._nevoa();
    if (bg.isTexture) this._fundoTex = bg;
    if (velho && velho !== bg) velho.dispose();
    this.sujo = true;
  }
  _ambiente(tex) {
    try {
      const pm = new THREE.PMREMGenerator(this.renderer);
      this._env = pm.fromEquirectangular(tex).texture;
      this.cena.environment = this._env;
      pm.dispose();
    } catch (_) { /* sem ambiente: só o fundo */ }
  }

  /** Canvas do viewport (gravação, OBS). */
  get canvas() { return this.renderer.domElement; }

  /** PNG do viewport (miniatura do cartão, "salvar quadro"). */
  png(larg = 0) {
    this.renderer.render(this.cena, this.camera);
    if (!larg) return this.renderer.domElement.toDataURL('image/png');
    const c = document.createElement('canvas');
    const src = this.renderer.domElement;
    c.width = larg; c.height = Math.round((larg * src.height) / Math.max(1, src.width));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  }

  redimensionar() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setPixelRatio(dprCanvas(w, h, TETO_STUDIO));   // teto de área (escala-canvas.js)
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.sujo = true;
  }

  destruir() {
    cancelAnimationFrame(this.raf);
    if (this._env) this._env.dispose();
    if (this.modelo) { this.ator.remove(this.modelo.base); this.modelo = null; } this._mo.disconnect(); this.ro.disconnect(); this.controles.dispose();
    this.cena.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); });
    this.renderer.dispose(); this.renderer.forceContextLoss && this.renderer.forceContextLoss(); this.renderer.domElement.remove();
  }
}
