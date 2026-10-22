/**
 * components/video/miniaturas-worker.js — decodificação das miniaturas FORA
 * da thread principal (GPlanSiS|Vídeo).
 *
 * Recebe o índice de quadros (midia.js) e o Blob da mídia. Para cada lista
 * de quadros pedidos pela timeline:
 *   1. agrupa os pedidos por GOP (o quadro-chave de onde a decodificação
 *      começa): vários quadros do mesmo GOP saem de UMA passada;
 *   2. lê só os bytes daquelas amostras (Blob.slice) e decodifica com
 *      VideoDecoder (WebCodecs);
 *   3. reduz cada quadro pedido ao tamanho da miniatura (createImageBitmap
 *      com resize; OffscreenCanvas se o navegador não aceitar VideoFrame ali)
 *      e devolve o ImageBitmap TRANSFERIDO (sem cópia).
 *
 * Uma lista nova SUBSTITUI a anterior: o que saiu da tela não é decodificado,
 * e o GOP em andamento para no meio se nenhum quadro dele continuar pedido.
 *
 * Mensagens:
 *   → { tipo: 'iniciar', blob, video: { codec, descricao, largura, altura, n, pts, decDe, dec }, larg, alt }
 *   ← { tipo: 'pronto', ok, motivo }
 *   → { tipo: 'pedir', lista: [q, ...] }        (ordem = prioridade)
 *   ← { tipo: 'quadro', q, bmp }
 *   → { tipo: 'fim' }
 */
import { lerAmostras, chaveAntes, quadroEm } from './midia.js';

let v = null;
let blob = null;
let cfg = null;
let dec = null;
let larg = 160, alt = 90;
let fila = [];                   // pedidos ainda não começados (ordem = prioridade)
let ocupado = false;
let grupo = null;                // Set dos quadros do GOP em decodificação
let pararGop = false;
const recentes = [];             // enviados há pouco (a timeline pode pedir de novo antes de recebê-los)
let saidaAtual = (f) => f.close();
let canvas = null, ctx2 = null;  // reserva quando createImageBitmap(VideoFrame) não existe
let usarCanvas = false;

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.tipo === 'iniciar') {
    blob = m.blob; v = m.video; larg = m.larg; alt = m.alt;
    cfg = { codec: v.codec, codedWidth: v.largura, codedHeight: v.altura };
    if (v.descricao) cfg.description = v.descricao;
    let ok = false, motivo = '';
    try {
      if (typeof VideoDecoder === 'undefined') motivo = 'sem VideoDecoder no worker';
      else {
        if ((await VideoDecoder.isConfigSupported(cfg)).supported) ok = true;
        else motivo = 'codec não suportado: ' + v.codec;
      }
    } catch (e) { motivo = String((e && e.message) || e); }
    self.postMessage({ tipo: 'pronto', ok, motivo });
    return;
  }
  if (m.tipo === 'pedir') {
    const novos = new Set(m.lista);
    if (grupo && grupo.size && ![...grupo].some((q) => novos.has(q))) pararGop = true;
    const ja = new Set(recentes);
    fila = m.lista.filter((q) => !ja.has(q) && !(grupo && grupo.has(q)) && q >= 0 && q < v.n);
    rodar();
    return;
  }
  if (m.tipo === 'fim') {
    fila = []; pararGop = true;
    try { if (dec && dec.state !== 'closed') dec.close(); } catch (_) { /* ok */ }
    self.close();
  }
};

async function reduzir(frame) {
  if (!usarCanvas) {
    try { return await createImageBitmap(frame, { resizeWidth: larg, resizeHeight: alt, resizeQuality: 'low' }); } catch (_) { usarCanvas = true; }
  }
  if (!canvas) { canvas = new OffscreenCanvas(larg, alt); ctx2 = canvas.getContext('2d'); }
  ctx2.drawImage(frame, 0, 0, larg, alt);
  return canvas.transferToImageBitmap();
}

function decoderPronto() {
  if (!dec || dec.state === 'closed') {
    dec = new VideoDecoder({ output: (f) => saidaAtual(f), error: () => { /* a passada vê o estado 'closed' */ } });
    dec.configure(cfg);
  } else if (dec.state !== 'configured') dec.configure(cfg);
}

let ocioso = 0;
async function rodar() {
  if (ocupado) return;
  ocupado = true;
  clearTimeout(ocioso);
  try {
    while (fila.length) {
      // GOP do primeiro da fila, com todos os pedidos que caem nele
      const k = chaveAntes(v, fila[0]);
      const g = new Set(), resto = [];
      for (const q of fila) { if (chaveAntes(v, q) === k) g.add(q); else resto.push(q); }
      fila = resto;
      grupo = g; pararGop = false;
      await decodificarGop(k, g);
      grupo = null;
    }
  } finally {
    ocupado = false;
    // parado por 1,5 s: solta o decodificador (memória e sessão do codec)
    ocioso = setTimeout(() => { if (!ocupado && dec && dec.state !== 'closed') { try { dec.close(); } catch (_) { /* ok */ } dec = null; } }, 1500);
  }
}

async function decodificarGop(k, g) {
  let ult = 0;
  for (const q of g) if (v.decDe[q] > ult) ult = v.decDe[q];
  const pend = [];
  saidaAtual = (f) => {
    const q = quadroEm(v.pts, v.n, f.timestamp);
    if (v.pts[q] !== f.timestamp || !g.has(q)) { f.close(); return; }
    g.delete(q);
    pend.push(reduzir(f).then((bmp) => {
      recentes.push(q); if (recentes.length > 128) recentes.shift();
      self.postMessage({ tipo: 'quadro', q, bmp }, [bmp]);
    }).catch(() => { /* quadro ilegível: fica sem miniatura */ }).finally(() => f.close()));
  };
  try {
    decoderPronto();
    let primeiro = true;
    await lerAmostras(blob, v.dec, k, ult + 1, async (i, bytes) => {
      if (dec.state !== 'configured') { pararGop = true; return; }
      dec.decode(new EncodedVideoChunk({ type: primeiro || v.dec.chave[i] ? 'key' : 'delta', timestamp: v.dec.pts[i], data: bytes }));
      primeiro = false;
      while (dec.state === 'configured' && dec.decodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
    }, { cancelado: () => pararGop || g.size === 0, maxBloco: 4 << 20 });
    if (dec.state === 'configured') {
      // cancelado no meio: descarta o que está no decodificador; senão esvazia
      if (pararGop) dec.reset(); else await dec.flush();
    }
  } catch (_) {
    try { if (dec && dec.state !== 'closed') dec.reset(); } catch (__) { /* ok */ }
  }
  await Promise.all(pend);
  saidaAtual = (f) => f.close();
}
