/**
 * components/motion3d/vmc.js — saída ao vivo do avatar no protocolo VMC (VirtualMotionCapture
 * Protocol, OSC; https://protocol.vmc.info/) para Unity (EVMC4U), Unreal (VMC4UE), Blender
 * (VMC Link), VSeeFace, VNyan… O navegador não manda UDP: o Studio monta os pacotes OSC aqui e
 * os envia por WebSocket a uma PONTE que só repassa cada mensagem como um datagrama UDP:
 *   - ponte local:  python3 ponte_vmc.py  (ws://127.0.0.1:39541 → udp 127.0.0.1:39539);
 *   - ponte remota: o aivision-motion repassa (wss://…/api/v1/motion/vmc/ws, sessão do iaVision)
 *                   para a mesma ponte rodando em modo --remoto no computador do 3D.
 * O que vai em cada quadro (bundles OSC de até ~1400 bytes, cabem num datagrama):
 *   /VMC/Ext/OK 1 · /VMC/Ext/T <s> · /VMC/Ext/Root/Pos "root" px py pz qx qy qz qw
 *   /VMC/Ext/Bone/Pos <HumanBodyBones> px py pz qx qy qz qw  (pose LOCAL normalizada: repouso em
 *       pose T com rotações identidade, como o UniVRM normaliza os modelos VRM)
 *   /VMC/Ext/Blend/Val <nome VRM 0.x> v … · /VMC/Ext/Blend/Apply
 * Coordenadas: three.js (mão direita, avatar olhando +z, +x = esquerda dele) → Unity (mão
 * esquerda, +z à frente): posição (−x, y, z), quaternion (x, −y, −z, w).
 * A pose sai da captura pelo retarget canônico (retarget.js · poseTCanonica), independe do
 * modelo carregado no Studio.
 */
import * as THREE from '../../../vendor/three-0.170.0/three.module.min.js';
import { Retarget, pontosDoRepouso, poseTCanonica, pontosDaCaptura, HUMANOIDE, paiMapeado } from './retarget.js';

/** Porta padrão da ponte local (WebSocket) e do receptor VMC (UDP). */
export const PORTA_PONTE = 39541;
export const PORTA_VMC = 39539;

// ------------------------------------------------------------------ OSC

const enc = new TextEncoder();
function strOSC(s) { const b = enc.encode(s); const n = b.length + 1; const p = n + ((4 - (n % 4)) % 4); const o = new Uint8Array(p); o.set(b); return o; }
/** Uma mensagem OSC: args = [['s', 'x'] | ['f', 1.0] | ['i', 1]]. */
export function mensagemOSC(endereco, args = []) {
  const partes = [strOSC(endereco), strOSC(',' + args.map((a) => a[0]).join(''))];
  for (const [t, v] of args) {
    if (t === 's') partes.push(strOSC(String(v)));
    else { const b = new DataView(new ArrayBuffer(4)); if (t === 'i') b.setInt32(0, v | 0, false); else b.setFloat32(0, +v || 0, false); partes.push(new Uint8Array(b.buffer)); }
  }
  return junta(partes);
}
function junta(partes) { const n = partes.reduce((s, p) => s + p.length, 0); const o = new Uint8Array(n); let k = 0; for (const p of partes) { o.set(p, k); k += p.length; } return o; }
/** Bundles OSC ("#bundle", timetag imediato) de no máximo `max` bytes cada. */
export function bundlesOSC(msgs, max = 1400) {
  const cab = junta([strOSC('#bundle'), new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1])]);
  const out = [];
  let atual = [cab], tam = cab.length;
  for (const m of msgs) {
    if (tam + 4 + m.length > max && atual.length > 1) { out.push(junta(atual)); atual = [cab]; tam = cab.length; }
    const n = new DataView(new ArrayBuffer(4)); n.setInt32(0, m.length, false);
    atual.push(new Uint8Array(n.buffer), m); tam += 4 + m.length;
  }
  if (atual.length > 1) out.push(junta(atual));
  return out;
}
/** Leitor OSC mínimo (testes): mensagem → { endereco, args }. */
export function lerOSC(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let k = 0;
  const str = () => { let e = k; while (u8[e]) e++; const s = new TextDecoder().decode(u8.subarray(k, e)); k = e + 1; k += (4 - (k % 4)) % 4; return s; };
  const endereco = str(), tags = str().slice(1), args = [];
  for (const t of tags) { if (t === 's') args.push(str()); else if (t === 'i') { args.push(dv.getInt32(k, false)); k += 4; } else { args.push(dv.getFloat32(k, false)); k += 4; } }
  return { endereco, args };
}

// ------------------------------------------------------------------ pose → VMC

/** humanoide (VRM 1.0) → HumanBodyBones do Unity. */
export function nomeUnity(h) {
  const m = { leftThumbMetacarpal: 'LeftThumbProximal', leftThumbProximal: 'LeftThumbIntermediate', leftThumbDistal: 'LeftThumbDistal',
    rightThumbMetacarpal: 'RightThumbProximal', rightThumbProximal: 'RightThumbIntermediate', rightThumbDistal: 'RightThumbDistal' };
  return m[h] || h[0].toUpperCase() + h.slice(1);
}
const paraUnityQ = (q) => [q.x, -q.y, -q.z, q.w];
const paraUnityP = (p) => [-p.x, p.y, p.z];

/** Expressões (coeficientes do rosto) → BlendShapes VRM 0.x usados pelo VMC. */
function blends(bs) {
  if (!bs) return [];
  const c = (v) => Math.min(1, Math.max(0, v || 0));
  return [['Blink_L', c(bs.eyeBlinkLeft)], ['Blink_R', c(bs.eyeBlinkRight)], ['A', c(bs.jawOpen)], ['U', c(bs.mouthPucker)], ['I', c(bs.mouthWide * 0.6)],
    ['E', c(bs.mouthWide)], ['O', c(bs.jawOpen * bs.mouthPucker)], ['Joy', c(bs.mouthSmile)], ['Surprised', c(bs.browInnerUp * 0.6)]];
}

export class SaidaVMC {
  constructor() {
    this.T = poseTCanonica();
    this.rt = new Retarget(pontosDoRepouso(this.T), HUMANOIDE.map(([n]) => n).filter((n) => this.T[n]));
    this.ws = null; this.estado = 'desligado'; this.enviados = 0; this.bytes = 0; this.erro = '';
    this.t0 = performance.now(); this.ultimo = 0; this.hz = 30;
    this.aoMudar = () => {};
  }
  /** Conecta à ponte (ws:// local ou wss:// do aivision-motion). */
  conectar(url) {
    this.desconectar();
    this.estado = 'conectando'; this.erro = ''; this.aoMudar();
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.estado = 'erro'; this.erro = e.message; this.aoMudar(); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.estado = 'ligado'; this.aoMudar(); };
    ws.onclose = (e) => { if (this.ws === ws) { this.estado = this.estado === 'erro' ? 'erro' : 'desligado'; if (e.code !== 1000 && !this.erro) this.erro = `ponte fechou (${e.code}${e.reason ? ': ' + e.reason : ''})`; this.ws = null; this.aoMudar(); } };
    ws.onerror = () => { this.estado = 'erro'; this.erro = 'não conectou: a ponte está rodando? (o Chrome pode pedir permissão de rede local)'; this.aoMudar(); };
    this.ws = ws;
  }
  desconectar() { if (this.ws) { const w = this.ws; this.ws = null; try { w.close(1000); } catch (_) { /* já fechado */ } } this.estado = 'desligado'; this.aoMudar(); }

  /** Pacotes OSC de UM quadro (Uint8Array[]): exposto para os testes. */
  pacotes(W, extras = null, perna = 0.85) {
    const P = pontosDaCaptura(W, extras);
    if (!P) return [];
    const D = this.rt.pose(P);
    const msgs = [mensagemOSC('/VMC/Ext/OK', [['i', 1]]), mensagemOSC('/VMC/Ext/T', [['f', (performance.now() - this.t0) / 1000]])];
    msgs.push(mensagemOSC('/VMC/Ext/Root/Pos', [['s', 'root'], ...[0, 0, 0, 0, 0, 0, 1].map((v) => ['f', v])]));
    const ident = new THREE.Quaternion();
    for (const [h] of HUMANOIDE) {
      if (!this.rt.mapa[h]) continue;
      const pai = paiMapeado(h, this.rt.mapa);
      const local = (pai ? D.get(pai) || ident : ident).clone().invert().multiply(D.get(h));
      // posição local de repouso (pose T canônica) e, no quadril, a posição capturada
      let pos;
      if (h === 'hips') { const k = 0.85 / Math.max(0.2, perna); pos = P.hipC ? P.hipC.clone().multiplyScalar(k) : this.T.hips.clone(); }
      else pos = this.T[h].clone().sub(this.T[pai || 'hips']);
      msgs.push(mensagemOSC('/VMC/Ext/Bone/Pos', [['s', nomeUnity(h)], ...paraUnityP(pos).map((v) => ['f', v]), ...paraUnityQ(local).map((v) => ['f', v])]));
    }
    const bl = blends(extras && extras.rosto ? extras.rosto.bs : null);
    for (const [n, v] of bl) msgs.push(mensagemOSC('/VMC/Ext/Blend/Val', [['s', n], ['f', v]]));
    if (bl.length) msgs.push(mensagemOSC('/VMC/Ext/Blend/Apply'));
    return bundlesOSC(msgs);
  }

  /** Envia um quadro (no máximo `hz` por segundo). */
  enviar(W, extras, perna) {
    if (!this.ws || this.estado !== 'ligado' || !W) return false;
    const agora = performance.now();
    if (agora - this.ultimo < 1000 / this.hz - 2) return false;
    if (this.ws.bufferedAmount > 64 * 1024) return false;   // rede lenta: descarta em vez de acumular atraso
    this.ultimo = agora;
    for (const b of this.pacotes(W, extras, perna)) { this.ws.send(b); this.bytes += b.length; }
    this.enviados++;
    return true;
  }
}

/** Pede ao aivision-motion um canal de repasse (sessão do iaVision). → { canal, token, expira, url } */
export async function criarCanalRemoto() {
  const r = await fetch('/api/v1/motion/vmc/canais', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' } });
  let c = null; try { c = await r.json(); } catch (_) { c = null; }
  if (!r.ok) throw new Error((c && c.detail) || `HTTP ${r.status}`);
  const base = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/motion/vmc/ws`;
  return { ...c, urlEmissor: `${base}?canal=${encodeURIComponent(c.canal)}&papel=emissor`, urlPonte: base };
}
