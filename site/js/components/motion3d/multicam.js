/**
 * components/motion3d/multicam.js — Multicâmera do Motion 3D Studio: o fluxo do FreeMoCap no
 * navegador, PORTADO do MoCap do GPlanSiS|ROBO (projeto/frontend/src/core/mocap/motor.ts, classe
 * MotorMocap): câmeras → calibrar (pelo próprio corpo: matriz essencial com RANSAC → ajuste de
 * feixe LM → escala pela altura) → gravar → triangular (DLT ponderada) → pós-processar.
 *
 * O que muda em relação ao robo: o detector. Lá é um Pose Landmarker do MediaPipe por câmera;
 * aqui é a pose do iaVision (YOLOX + BlazePose ONNX, runtime/livres-h/pose.js), uma câmera de
 * cada vez na fila única do ORT. Para não perder a sincronia, os quadros de TODAS as vistas
 * são copiados no MESMO instante e só depois estimados (a taxa cai com o número de câmeras,
 * a defasagem entre vistas não). Com ARQUIVOS de vídeo (uma gravação por câmera, começando
 * juntas) a amostragem é exata: todas as vistas são posicionadas no mesmo tempo e estimadas.
 * A matemática (geometria, pós, BVH) é o bundle do robo, sem alteração.
 */
import { autocalibrar, focalDoFov, triangularQuadro, gerarSessao } from '../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';
import { RastreadorMotion } from '../../cv/runtime/livres-v/pose3d.js';
import { reamostrar } from '../../cv/runtime/livres-v/tomada.js';

const IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export class MotorMulticam {
  constructor(aoMudar, aoQuadro, aoCameras) {
    this.aoMudar = aoMudar; this.aoQuadro = aoQuadro; this.aoCameras = aoCameras;
    this.vistas = [];            // { id, rotulo, video, stream, rast, detecta, canvas }
    this.etapa = 'cameras';      // cameras | calibrando | calibrado | gravando | processado
    this.grav = []; this.mono = []; this.tempos = [];
    this.cal = null; this.modo = null; this.msg = '';
    this.fovGraus = 62; this.alturaM = 1.7;
    this.ultimas = [];
    this.rodando = false; this.passoArquivoS = 1 / 15;
  }

  avisar(m) { if (m != null) this.msg = m; this.aoMudar && this.aoMudar(this.estado()); }

  estado() {
    return {
      etapa: this.etapa, modo: this.modo, mensagem: this.msg, vistas: this.vistas.map((v) => ({ id: v.id, rotulo: v.rotulo, detecta: v.detecta, arquivo: Boolean(v.arquivo) })),
      quadrosGravados: this.grav.length, calibracao: this.cal ? { erroPx: this.cal.erroPx, inliers: this.cal.inliers, correspondencias: this.cal.correspondencias, escala: this.cal.escala } : null,
    };
  }

  static async listar() {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      return d.filter((x) => x.kind === 'videoinput').map((x, i) => ({ id: x.deviceId, rotulo: x.label || `Câmera ${i + 1}` }));
    } catch (_) { return []; }
  }

  /** Abre 1–4 câmeras (deviceId) ou arquivos (File), cada uma com o seu <video> e o seu rastreador. */
  async abrir(escolhas) {
    this.fechar();
    for (const e of escolhas.slice(0, 4)) {
      const video = document.createElement('video');
      video.muted = true; video.playsInline = true;
      const v = { id: e.id || e.nome, rotulo: e.rotulo || e.nome, video, rast: new RastreadorMotion(), detecta: false, arquivo: e.arquivo || null };
      try {
        if (e.arquivo) {
          video.src = URL.createObjectURL(e.arquivo);
          await new Promise((ok, falha) => { video.onloadeddata = ok; video.onerror = () => falha(new Error('vídeo ilegível')); });
        } else {
          v.stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: e.id ? { exact: e.id } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
          video.srcObject = v.stream;
          await video.play();
        }
        this.vistas.push(v);
      } catch (err) {
        this.avisar(`Não foi possível abrir ${v.rotulo}: ${err.message || err}`);
      }
    }
    this.modo = this.vistas.length >= 2 ? 'multi' : this.vistas.length === 1 ? 'monocular' : null;
    this.etapa = 'cameras';
    this.avisar(this.vistas.length >= 2 ? `${this.vistas.length} vistas prontas. Calibre movendo-se de corpo inteiro por ~10 s à vista de todas.`
      : this.vistas.length === 1 ? 'Uma vista: modo monocular (sem calibração; profundidade aproximada pelo BlazePose 3D).' : this.msg);
    if (this.vistas.length && !this.vistas.every((v) => v.arquivo)) this.laco();
  }

  fechar() {
    this.rodando = false;
    for (const v of this.vistas) {
      if (v.stream) v.stream.getTracks().forEach((t) => t.stop());
      if (v.arquivo && v.video.src) URL.revokeObjectURL(v.video.src);
      v.video.removeAttribute('src'); v.video.srcObject = null;
    }
    this.vistas = [];
  }

  basesCam() {
    return this.vistas.map((v) => {
      const w = v.video.videoWidth || 1280, h = v.video.videoHeight || 720;
      return { id: v.rotulo, largura: w, altura: h, f: focalDoFov(w, this.fovGraus), cx: w / 2, cy: h / 2, R: IDENT, t: [0, 0, 0] };
    });
  }

  /** Copia o quadro de TODAS as vistas no mesmo instante (sincronia por software). */
  capturar() {
    return this.vistas.map((v) => {
      const w = v.video.videoWidth, h = v.video.videoHeight;
      if (!w || !h) return null;
      if (!v.canvas) v.canvas = document.createElement('canvas');
      if (v.canvas.width !== w || v.canvas.height !== h) { v.canvas.width = w; v.canvas.height = h; }
      const g = v.canvas.getContext('2d', { willReadFrequently: true });
      g.drawImage(v.video, 0, 0, w, h);
      return g.getImageData(0, 0, w, h);
    });
  }

  /** Estima a pose de cada vista (uma de cada vez: fila única do ORT). */
  async estimar(imgs, t) {
    const qs = [];
    let monoW = null;
    for (let i = 0; i < this.vistas.length; i++) {
      const v = this.vistas[i], img = imgs[i];
      if (!img) { qs.push(null); v.detecta = false; continue; }
      const prep = v.rast.preparar(img, t, { esp: false, detectarMs: 3000 });
      const r = await v.rast.estimar(prep);
      v.detecta = Boolean(r && !r.sem);
      if (!v.detecta) { qs.push(null); continue; }
      qs.push({ px: r.P.map((p) => [p.x, p.y]), vis: r.P.map((p) => p.v) });
      if (this.vistas.length === 1) monoW = r.W;
    }
    return { qs, monoW };
  }

  async passo(t) {
    const imgs = this.capturar();
    const { qs, monoW } = await this.estimar(imgs, t);
    this.ultimas = qs;
    if (this.etapa === 'calibrando' || this.etapa === 'gravando') {
      this.grav.push(qs.map((q) => q || { px: Array(33).fill(null), vis: Array(33).fill(0) }));
      this.tempos.push(t);
      if (this.vistas.length === 1) this.mono.push(monoW || Array(33).fill(null));
    }
    // pré-visualização 3D ao vivo (triangulação bruta) depois de calibrar; monocular direto
    if (this.cal && this.modo === 'multi' && this.etapa !== 'processado') this.aoQuadro && this.aoQuadro(triangularQuadro(this.cal.cameras, qs, 0.5));
    else if (this.modo === 'monocular' && monoW) this.aoQuadro && this.aoQuadro(monoW);
    this.avisar();
  }

  /** Laço das câmeras ao vivo: um passo de cada vez (sem acumular quadros atrasados). */
  async laco() {
    if (this.rodando) return;
    this.rodando = true;
    while (this.rodando && this.vistas.length) {
      try { await this.passo(performance.now()); } catch (e) { this.avisar(`Falha na estimativa: ${e.message || e}`); await new Promise((r) => setTimeout(r, 500)); }
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  }

  /** Arquivos: percorre todos no MESMO tempo, de `passoArquivoS` em `passoArquivoS`. */
  async varrerArquivos(aoProgresso, cancelado = () => false) {
    const dur = Math.min(...this.vistas.map((v) => v.video.duration || 0));
    if (!(dur > 0)) throw new Error('Arquivos sem duração legível.');
    for (let t = 0; t <= dur; t += this.passoArquivoS) {
      if (cancelado()) break;
      await Promise.all(this.vistas.map((v) => new Promise((ok) => { v.video.onseeked = () => ok(); v.video.currentTime = Math.min(t, (v.video.duration || dur) - 0.001); })));
      await this.passo(t * 1000);
      aoProgresso && aoProgresso(t / dur);
    }
  }

  iniciarCalibracao() { this.grav = []; this.tempos = []; this.etapa = 'calibrando'; this.avisar('Calibrando: ande, gire e mexa braços e pernas à vista de todas as câmeras.'); }

  concluirCalibracao() {
    try {
      this.cal = autocalibrar(this.basesCam(), this.grav.filter((_, i) => i % 2 === 0), this.alturaM);
      this.etapa = 'calibrado';
      this.aoCameras && this.aoCameras(this.cal.cameras);
      this.avisar(`Calibrado: reprojeção de ${this.cal.erroPx.toFixed(1)} px. ${this.cal.erroPx > 5 ? 'Acima de 5 px: refaça com mais movimento e o corpo inteiro à vista.' : 'Pronto para gravar.'}`);
    } catch (e) {
      this.etapa = 'cameras';
      this.avisar(e.message);
    }
  }

  iniciarGravacao() { this.grav = []; this.mono = []; this.tempos = []; this.etapa = 'gravando'; this.avisar('Gravando…'); }

  /** Para e devolve a tomada (trilha em fps fixo) — ou null se curta. */
  pararGravacao(fps = 30) {
    let bruta;
    if (this.modo === 'multi' && this.cal) bruta = this.grav.map((qs) => triangularQuadro(this.cal.cameras, qs, 0.5));
    else bruta = this.mono;
    if (bruta.length < 10) { this.etapa = this.cal ? 'calibrado' : 'cameras'; this.avisar('Gravação curta demais.'); return null; }
    const r = reamostrar(bruta.map((W, i) => ({ t: this.tempos[i], W })), fps);
    this.etapa = 'processado';
    this.avisar(`${this.modo === 'multi' ? 'Captura multicâmera' : 'Captura monocular'}: ${r.trilha.length} quadros.`);
    return { fps, trilha: r.trilha, origem: this.modo === 'multi' ? 'multicamera' : 'monocular', cameras: this.cal ? this.cal.cameras : [],
      calibracaoId: this.cal ? `cal_${Date.now().toString(36)}` : null, fonteId: this.vistas.map((v) => v.rotulo).join(' + ') };
  }

  /**
   * Demonstração sem hardware (a do robo): 3 câmeras virtuais filmam uma pessoa sintética; o
   * pipeline inteiro roda — autocalibração pelo corpo, triangulação — e devolve a tomada.
   */
  demonstracao(segundos = 14) {
    this.fechar();
    this.modo = 'demonstracao';
    const s = gerarSessao(segundos, 30, 3, 1.5);
    const base = s.camerasVerdade.map((c) => ({ ...c, R: IDENT, t: [0, 0, 0] }));
    this.cal = autocalibrar(base, s.quadros.filter((_, i) => i % 3 === 0), 1.75);
    this.aoCameras && this.aoCameras(this.cal.cameras);
    const bruta = s.quadros.map((qs) => triangularQuadro(this.cal.cameras, qs, 0.5));
    this.etapa = 'processado';
    this.avisar(`Demonstração: calibrada pelo próprio corpo (reprojeção ${this.cal.erroPx.toFixed(2)} px), triangulada; ${bruta.length} quadros.`);
    return { fps: s.fps, trilha: bruta, origem: 'demonstracao', cameras: this.cal.cameras, calibracaoId: 'demo_robo', fonteId: '3 câmeras virtuais (GPlanSiS|ROBO)', erroPx: this.cal.erroPx };
  }

  destruir() { this.fechar(); }
}
