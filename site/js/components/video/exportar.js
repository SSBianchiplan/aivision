/**
 * components/video/exportar.js — render da edição (GPlanSiS|Vídeo).
 *
 * CAMINHO EXATO (WebCodecs + MP4). Para cada trecho da EDL:
 *   1. lê as amostras comprimidas direto do arquivo (midia.js), a partir do
 *      quadro-chave anterior ao primeiro quadro do trecho;
 *   2. decodifica com VideoDecoder; cada VideoFrame traz o pts da amostra,
 *      então sabemos EXATAMENTE qual quadro da mídia ele é — os de fora do
 *      trecho (o "pré-rolo" desde o quadro-chave) são descartados;
 *   3. desenha o quadro recortado (recorte geral ou Ken Burns do clipe) num
 *      OffscreenCanvas do tamanho de saída e codifica com VideoEncoder
 *      (H.264; VP9/AV1 se não houver H.264), mantendo a duração real de
 *      cada quadro (vídeo de taxa variável continua com o tempo certo);
 *   4. o áudio é decodificado (AudioDecoder) só nos trechos usados, cortado
 *      na amostra exata do início/fim de cada trecho, e recodificado
 *      (AudioEncoder: AAC; Opus como reserva) — lacunas viram silêncio;
 *   5. tudo vai para o mp4-muxer (vendor/mp4-muxer-5.2.2.mjs, MIT).
 *
 * RESERVA (sem WebCodecs, codec não suportado ou contêiner ilegível): toca
 * cada trecho num <video> oculto, desenha num canvas e grava com
 * MediaRecorder (WebM ou MP4, o que o navegador oferecer). Em tempo real e
 * sem garantia de quadro exato — a interface avisa.
 */

import { Muxer, StreamTarget } from '../../../vendor/mp4-muxer-5.2.2.mjs';
import { lerAmostras, chaveAntes, quadroEm } from './midia.js';
import { ordenar, fimClipe, enquadramento, timecode } from './edl.js';
import { melhorFormato } from '../../cv/recorder.js';
import { seguirQuadros } from './reprodutor.js';

/** Erro de cancelamento (o usuário clicou em Cancelar). */
export class Cancelado extends Error { constructor() { super('cancelado'); this.name = 'Cancelado'; } }

/**
 * Partes da timeline dentro de [t0, t1): { c, qa, qb, tOut } — quadros [qa, qb)
 * do clipe c, começando em tOut (µs) na saída.
 */
export function trechos(v, clipes, t0, t1) {
  const out = [];
  for (const c of ordenar(clipes)) {
    if (fimClipe(v, c) <= t0 || c.em >= t1) continue;
    let qa = c.a, qb = c.b;
    while (qa < qb && c.em + (v.pts[qa + 1] - v.pts[c.a]) <= t0) qa++;
    while (qb > qa && c.em + (v.pts[qb - 1] - v.pts[c.a]) >= t1) qb--;
    if (qb > qa) out.push({ c, qa, qb, tOut: c.em + (v.pts[qa] - v.pts[c.a]) - t0 });
  }
  return out;
}

/**
 * Tamanho de saída: o recorte em pixels da mídia, vezes a escala, em números
 * pares. `escala` também pode ser um tamanho fixo { w, h } (predefinições
 * como 1080×1920 do "Seguir sujeito"): a saída é exatamente esse tamanho.
 */
export function tamanhoSaida(v, recorte, escala = 1) {
  const par = (x) => Math.max(2, Math.round(x / 2) * 2);
  if (escala && typeof escala === 'object') return { w: par(escala.w), h: par(escala.h) };
  return { w: par(recorte.w * v.largura * escala), h: par(recorte.h * v.altura * escala) };
}

/**
 * Tamanhos predefinidos de saída (redes sociais). Cada um vale quando a
 * proporção do recorte bate (±1,5%) — o quadro nunca é distorcido.
 */
export const PREDEFINIDOS = [
  { id: '1080x1920', w: 1080, h: 1920, rot: '1080×1920 (9:16 vertical)' },
  { id: '1080x1350', w: 1080, h: 1350, rot: '1080×1350 (4:5)' },
  { id: '1080x1080', w: 1080, h: 1080, rot: '1080×1080 (1:1)' },
  { id: '1920x1080', w: 1920, h: 1080, rot: '1920×1080 (16:9)' },
];
export function predefinidosValidos(v, recorte) {
  const p = (recorte.w * v.largura) / (recorte.h * v.altura);
  return PREDEFINIDOS.filter((x) => Math.abs(x.w / x.h / p - 1) < 0.015);
}

/**
 * Fonte de desenho no referencial da TELA: vídeo girado (matriz de rotação
 * do MP4) chega do VideoDecoder deitado; aqui ele é girado uma vez num
 * canvas do tamanho exibido, e o recorte é tirado dele — o mesmo que o
 * <video> do visor mostra.
 */
let giroCv = null;
export function fonteExibida(f, rot) {
  const sw = f.displayWidth || f.videoWidth || f.width, sh = f.displayHeight || f.videoHeight || f.height;
  if (!rot) return { src: f, sw, sh };
  const W = rot % 180 ? sh : sw, H = rot % 180 ? sw : sh;
  if (!giroCv || giroCv.width !== W || giroCv.height !== H) giroCv = new OffscreenCanvas(W, H);
  const g = giroCv.getContext('2d', { alpha: false });
  g.save();
  if (rot === 90) { g.translate(W, 0); g.rotate(Math.PI / 2); }
  else if (rot === 180) { g.translate(W, H); g.rotate(Math.PI); }
  else if (rot === 270) { g.translate(0, H); g.rotate(-Math.PI / 2); }
  g.drawImage(f, 0, 0, sw, sh);
  g.restore();
  return { src: giroCv, sw: W, sh: H };
}

/** Bitrate de exportação (~0,12 bit/pixel/quadro, 2–40 Mbit/s), multiplicado pela qualidade. */
export function bitrateExport(w, h, fps, fator = 1) {
  return Math.round(Math.max(2e6, Math.min(40e6, w * h * fps * 0.12 * fator)));
}

const CODECS_VIDEO = [
  ['avc', 'avc1.640034'], ['avc', 'avc1.640033'], ['avc', 'avc1.640028'], ['avc', 'avc1.4d0034'],
  ['avc', 'avc1.4d0028'], ['avc', 'avc1.42003e'], ['avc', 'avc1.42001f'],
  ['vp9', 'vp09.00.51.08'], ['vp9', 'vp09.00.41.08'], ['av1', 'av01.0.12M.08'], ['av1', 'av01.0.08M.08'],
];

/** O que este navegador consegue: { exato: bool, motivo, video: {mux, codec}, decodifica } */
export async function sondar(ix, w, h, fps, bitrate) {
  if (!ix || !ix.video || !ix.video.dec) return { exato: false, motivo: 'o contêiner deste arquivo não pôde ser lido quadro a quadro' };
  if (typeof VideoDecoder === 'undefined' || typeof VideoEncoder === 'undefined') return { exato: false, motivo: 'este navegador não tem WebCodecs' };
  const v = ix.video;
  if (!v.codec) return { exato: false, motivo: 'codec de vídeo da mídia desconhecido' };
  const cfgDec = configDecoder(v);
  let ok = false;
  try { ok = (await VideoDecoder.isConfigSupported(cfgDec)).supported; } catch (_) { ok = false; }
  if (!ok) return { exato: false, motivo: `o navegador não decodifica ${v.codec} via WebCodecs` };
  for (const [mux, codec] of CODECS_VIDEO) {
    const cfg = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: 'quality' };
    if (mux === 'avc') cfg.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { exato: true, cfgDec, video: { mux, codec, cfg } };
    } catch (_) { /* próximo */ }
  }
  return { exato: false, motivo: 'o navegador não codifica H.264/VP9/AV1 neste tamanho' };
}

/**
 * Para o diálogo de exportação: o caminho exato serve, e com som?
 * { exato, motivo, audio: bool (o som entra no caminho exato), motivoAudio }
 */
export async function sondarExportacao(ix, recorte) {
  const v = ix.video;
  const { w, h } = tamanhoSaida(v, recorte, 1);
  const sv = await sondar(ix, w, h, v.fps || 30, bitrateExport(w, h, v.fps || 30));
  if (!sv.exato) return { exato: false, motivo: sv.motivo, audio: false };
  if (!ix.audio) return { exato: true, audio: false, motivoAudio: 'a mídia não tem áudio' };
  const sa = await sondarAudio(ix);
  return { exato: true, audio: !sa.motivo, motivoAudio: sa.motivo || '' };
}

/** Configuração do VideoDecoder se o navegador decodifica a mídia; senão null. */
export async function podeDecodificar(ix) {
  if (!ix || !ix.video || !ix.video.dec || !ix.video.codec || typeof VideoDecoder === 'undefined') return null;
  const c = configDecoder(ix.video);
  try { return (await VideoDecoder.isConfigSupported(c)).supported ? c : null; } catch (_) { return null; }
}

function configDecoder(v) {
  // vídeo girado (celular em pé): largura/altura são as da TELA; o decodificador quer as codificadas
  const c = { codec: v.codec, codedWidth: v.larguraCod || v.largura, codedHeight: v.alturaCod || v.altura };
  if (v.descricao) c.description = v.descricao;
  return c;
}

/** Áudio: decodificar a mídia e codificar a saída. */
async function sondarAudio(ix) {
  const a = ix.audio;
  if (!a) return { motivo: 'a mídia não tem áudio' };
  if (typeof AudioDecoder === 'undefined' || typeof AudioEncoder === 'undefined') return { motivo: 'este navegador não tem AudioDecoder/AudioEncoder' };
  if (!a.codec) return { motivo: 'codec de áudio da mídia desconhecido' };
  const cfgDec = { codec: a.codec, sampleRate: a.taxa, numberOfChannels: a.canais };
  if (a.descricao) cfgDec.description = a.descricao;
  let ok = false;
  try { ok = (await AudioDecoder.isConfigSupported(cfgDec)).supported; } catch (_) { ok = false; }
  if (!ok) return { motivo: `o navegador não decodifica o áudio ${a.codec}` };
  const canais = Math.min(2, a.canais || 2);
  const tentativas = [
    ['aac', { codec: 'mp4a.40.2', sampleRate: a.taxa, numberOfChannels: canais, bitrate: 160000 }],
    ['opus', { codec: 'opus', sampleRate: a.taxa, numberOfChannels: canais, bitrate: 160000 }],
  ];
  for (const [mux, cfg] of tentativas) {
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfgDec, cfgEnc: cfg, mux, canais }; } catch (_) { /* próximo */ }
  }
  return { motivo: `o navegador não codifica áudio AAC/Opus a ${a.taxa} Hz` };
}

/* ======================================================= coletor do MP4 */

/** Recebe as escritas do mp4-muxer (sequenciais + o remendo final do cabeçalho do mdat). */
class Coletor {
  constructor() { this.partes = []; this.fim = 0; }
  escrever(data, pos) {
    if (pos === this.fim) { this.partes.push({ pos, b: data.slice() }); this.fim += data.byteLength; return; }
    // remendo sobre o que já foi escrito (tamanho do mdat ao finalizar)
    let resto = data, p = pos;
    for (const pt of this.partes) {
      if (!resto.length) break;
      const fimPt = pt.pos + pt.b.length;
      if (p >= pt.pos && p < fimPt) {
        const n = Math.min(resto.length, fimPt - p);
        pt.b.set(resto.subarray(0, n), p - pt.pos);
        resto = resto.subarray(n); p += n;
      }
    }
    if (resto.length) { this.partes.push({ pos: p, b: resto.slice() }); this.fim = Math.max(this.fim, p + resto.length); }
  }
  blob(tipo) { return new Blob(this.partes.map((x) => x.b), { type: tipo }); }
}

const tique = () => new Promise((r) => setTimeout(r, 0));
async function esperarFila(obj, lim) {
  let guarda = 0;
  while (obj.state === 'configured' && (obj.decodeQueueSize ?? obj.encodeQueueSize) > lim && guarda++ < 2000) {
    await new Promise((r) => { const t = setTimeout(r, 4); obj.addEventListener('dequeue', () => { clearTimeout(t); r(); }, { once: true }); });
  }
}

/* ======================================================= percorrer quadros */

/**
 * Decodifica os quadros das partes, em ordem, chamando `aoQuadro(frame, q, parte)`
 * só para os quadros [qa, qb) de cada parte. O frame é fechado depois.
 */
export async function percorrer({ blob, v, partes, cfgDec, aoQuadro, cancelado }) {
  const pend = [];
  let erro = null;
  const dec = new VideoDecoder({ output: (f) => pend.push(f), error: (e) => { erro = e; } });
  dec.configure(cfgDec);
  let parteAtual = null;
  const drenar = async () => {
    while (pend.length) {
      const f = pend.shift();
      try {
        const q = quadroEm(v.pts, v.n, f.timestamp);
        if (parteAtual && q >= parteAtual.qa && q < parteAtual.qb && v.pts[q] === f.timestamp) await aoQuadro(f, q, parteAtual);
      } finally { f.close(); }
    }
  };
  try {
    for (const parte of partes) {
      parteAtual = parte;
      const k = chaveAntes(v, parte.qa);
      let ult = 0;
      for (let q = parte.qa; q < parte.qb; q++) if (v.decDe[q] > ult) ult = v.decDe[q];
      let primeiro = true;
      await lerAmostras(blob, v.dec, k, ult + 1, async (i, bytes) => {
        if (erro) throw erro;
        if (cancelado()) throw new Cancelado();
        dec.decode(new EncodedVideoChunk({ type: primeiro || v.dec.chave[i] ? 'key' : 'delta', timestamp: v.dec.pts[i], data: bytes }));
        primeiro = false;
        await drenar();
        await esperarFila(dec, 3);
        await drenar();
      }, { cancelado });
      if (cancelado()) throw new Cancelado();
      await dec.flush();
      await drenar();
      if (erro) throw erro;
    }
  } finally {
    for (const f of pend) f.close();
    if (dec.state !== 'closed') dec.close();
  }
}

/** Desenha o quadro `src` (largura sw×sh) recortado por `ret` no canvas de saída. */
function desenhar(ctx, src, sw, sh, ret, W, H) {
  ctx.drawImage(src, ret.x * sw, ret.y * sh, ret.w * sw, ret.h * sh, 0, 0, W, H);
}

/* ======================================================= áudio */

/*
 * O AudioDecoder do Chrome numera a saída a partir do timestamp do primeiro
 * pacote e PRENDE NO ZERO um timestamp negativo — e o primeiro pacote de um
 * AAC com edit list tem pts negativo (priming). Tudo o que entra no
 * decodificador vai deslocado em +10 s e volta ao sair.
 */
export const DESLOC_AUDIO = 10_000_000;

async function codificarAudio({ blob, ix, partes, durSaida, sa, cancelado, aoProgresso }) {
  const a = ix.audio;
  const v = ix.video;
  const sr = a.taxa;
  const ch = sa.canais;
  const saida = [];
  let erro = null;
  const enc = new AudioEncoder({ output: (c, m) => saida.push([c, m]), error: (e) => { erro = e; } });
  enc.configure(sa.cfgEnc);
  let outS = 0;
  const BLOCO = 4096;
  const zeros = new Float32Array(BLOCO * ch);
  const emitir = (planos, ini, n) => {
    const buf = new Float32Array(n * ch);
    for (let c = 0; c < ch; c++) buf.set(planos[Math.min(c, planos.length - 1)].subarray(ini, ini + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round(outS * 1e6 / sr), data: buf });
    enc.encode(ad); ad.close();
    outS += n;
  };
  const silencio = (n) => {
    while (n > 0) {
      const m = Math.min(n, BLOCO);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: m, numberOfChannels: ch, timestamp: Math.round(outS * 1e6 / sr), data: zeros.subarray(0, m * ch) });
      enc.encode(ad); ad.close();
      outS += m; n -= m;
    }
  };
  const pend = [];
  const dec = new AudioDecoder({ output: (d) => pend.push(d), error: (e) => { erro = e; } });
  dec.configure(sa.cfgDec);
  try {
    let feitas = 0;
    for (const parte of partes) {
      if (cancelado()) throw new Cancelado();
      const ta = v.pts[parte.qa], tb = v.pts[parte.qb];
      const ini = Math.round(parte.tOut * sr / 1e6);
      if (outS < ini) silencio(ini - outS);
      let pular = outS - ini;   // arredondamento: o que já saiu a mais
      const need = Math.round((tb - ta) * sr / 1e6);
      const Sa = Math.round(ta * sr / 1e6);
      let escrito = Math.max(0, pular);
      // pacotes que cobrem [ta, tb), com 3 de pré-rolo (o AAC precisa do anterior)
      let i0 = 0;
      while (i0 < a.n && a.dec.pts[i0] + a.dec.dur[i0] <= ta) i0++;
      i0 = Math.max(0, i0 - 3);
      let i1 = i0;
      while (i1 < a.n && a.dec.pts[i1] < tb) i1++;
      i1 = Math.min(a.n, i1 + 1);
      const processa = () => {
        while (pend.length) {
          const d = pend.shift();
          try {
            const sS = Math.round((d.timestamp - DESLOC_AUDIO) * sr / 1e6);
            const relIni = sS - Sa, relFim = relIni + d.numberOfFrames;
            const p0 = Math.max(relIni, escrito), p1 = Math.min(relFim, need);
            if (p1 > p0) {
              if (p0 > escrito) { silencio(p0 - escrito); escrito = p0; }
              const n = p1 - p0;
              const planos = [];
              const nc = d.numberOfChannels;
              for (let c = 0; c < Math.min(ch, nc); c++) {
                const pl = new Float32Array(n);
                d.copyTo(pl, { planeIndex: c, frameOffset: p0 - relIni, frameCount: n, format: 'f32-planar' });
                planos.push(pl);
              }
              emitir(planos, 0, n);
              escrito = p1;
            }
          } finally { d.close(); }
        }
      };
      let primeiro = true;
      await lerAmostras(blob, a.dec, i0, i1, async (i, bytes) => {
        if (erro) throw erro;
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: a.dec.pts[i] + DESLOC_AUDIO, duration: a.dec.dur[i] || undefined, data: bytes }));
        primeiro = false;
        await esperarFila(dec, 16);
        processa();
        await esperarFila(enc, 32);
      }, { cancelado });
      await dec.flush();
      processa();
      if (escrito < need) silencio(need - escrito);
      if (erro) throw erro;
      aoProgresso(++feitas / partes.length);
      void primeiro;
    }
    const total = Math.round(durSaida * sr / 1e6);
    if (outS < total) silencio(total - outS);
    await enc.flush();
    if (erro) throw erro;
  } finally {
    for (const d of pend) d.close();
    if (dec.state !== 'closed') dec.close();
    if (enc.state !== 'closed') enc.close();
  }
  return saida;
}

/**
 * Atraso do codificador AAC (priming: ~2112 amostras na maioria das
 * plataformas). O MP4 gerado não leva edit list, então esse atraso
 * apareceria como áudio ~44 ms atrasado. Mede-se de verdade — codifica um
 * impulso, decodifica e procura o pico — porque o valor depende do
 * codificador do sistema.
 */
const atrasos = new Map();
async function medirAtraso(cfgEnc) {
  const chave = JSON.stringify(cfgEnc);
  if (atrasos.has(chave)) return atrasos.get(chave);
  const sr = cfgEnc.sampleRate, ch = cfgEnc.numberOfChannels;
  const N = Math.round(sr * 0.5), POS = Math.round(sr * 0.1);
  const pcm = new Float32Array(N * ch);
  for (let c = 0; c < ch; c++) { pcm[c * N + POS] = 0.9; pcm[c * N + POS + 1] = -0.9; }
  const pacotes = [];
  let cfgDec = null;
  const enc = new AudioEncoder({ output: (k, m) => { pacotes.push(k); if (m && m.decoderConfig) cfgDec = m.decoderConfig; }, error: () => {} });
  enc.configure(cfgEnc);
  enc.encode(new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: N, numberOfChannels: ch, timestamp: 0, data: pcm }));
  await enc.flush(); enc.close();
  const saida = [];
  const dec = new AudioDecoder({ output: (d) => { const b = new Float32Array(d.numberOfFrames); d.copyTo(b, { planeIndex: 0, format: 'f32-planar' }); saida.push(b); d.close(); }, error: () => {} });
  dec.configure(cfgDec);
  for (const k of pacotes) dec.decode(k);
  await dec.flush(); dec.close();
  let i = 0, max = 0, idx = POS;
  for (const b of saida) for (let j = 0; j < b.length; j++, i++) { const a = Math.abs(b[j]); if (a > max) { max = a; idx = i; } }
  const atraso = Math.max(0, idx - POS);
  atrasos.set(chave, atraso);
  return atraso;
}

/* ======================================================= exportar vídeo */

/**
 * Exporta a timeline [t0, t1).
 * @returns {Promise<{blob, nome, tipo, quadros, w, h, comAudio, avisos: string[], exato: boolean, codec}>}
 */
export async function exportarVideo({ blob, url, ix, clipes, recorte, t0, t1, escala = 1, qualidade = 1, comAudio = true, nomeBase = 'video', aoProgresso = () => {}, cancelado = () => false, deslocEl = 0, modo = 'auto' }) {
  const v = ix.video;
  const fps = v.fps || 30;
  const { w: W, h: H } = tamanhoSaida(v, recorte, escala);
  const bitrate = bitrateExport(W, H, fps, qualidade);
  const partes = trechos(v, clipes, t0, t1);
  if (!partes.length) throw new Error('não há quadros no trecho escolhido');
  const avisos = [];
  const sv = modo === 'tempo-real' ? { exato: false, motivo: 'escolhido para manter o som' } : await sondar(ix, W, H, fps, bitrate);
  const tempoReal = () => exportarTempoReal({ url, v, partes, recorte, W, H, fps, bitrate, comAudio, nomeBase, avisos, aoProgresso, cancelado, durSaida: t1 - t0, desloc: deslocEl });
  if (!sv.exato) {
    avisos.push('Exportação em tempo real (' + sv.motivo + '): sem garantia de quadro exato.');
    return tempoReal();
  }
  let sa = null;
  if (comAudio) {
    sa = await sondarAudio(ix);
    if (sa.motivo) {
      // Vídeo exato possível, áudio não (Safari 16.4–18: sem AudioEncoder). Com
      // áudio na mídia, o padrão é o tempo real (MediaRecorder grava o som);
      // modo 'exato' (escolha do usuário) mantém o quadro exato sem som.
      if (ix.audio && modo !== 'exato' && typeof MediaRecorder !== 'undefined') {
        avisos.push(`Exportação em tempo real para manter o som (${sa.motivo}): sem garantia de quadro exato.`);
        return tempoReal();
      }
      if (ix.audio) avisos.push('Sem áudio: ' + sa.motivo + '.');
      sa = null;
    }
  }
  const durSaida = partes.reduce((m, p) => Math.max(m, p.tOut + v.pts[p.qb] - v.pts[p.qa]), 0);
  // 1) áudio primeiro (pequeno): os pacotes ficam na memória e entram intercalados com o vídeo
  let audio = [];
  if (sa) {
    try {
      audio = await codificarAudio({ blob, ix, partes, durSaida, sa, cancelado, aoProgresso: (f) => aoProgresso(0.1 * f, 'áudio') });
    } catch (e) {
      if (e instanceof Cancelado) throw e;
      avisos.push('Sem áudio: falha ao processar (' + (e && e.message) + ').');
      sa = null; audio = [];
    }
  }
  // compensa o priming do AAC: descarta os pacotes inteiros que são só atraso
  let desloc = 0;
  if (sa && sa.mux === 'aac' && audio.length) {
    try {
      const atraso = await medirAtraso(sa.cfgEnc);
      const porPacote = audio[0][0].duration ? Math.round(audio[0][0].duration * ix.audio.taxa / 1e6) : 1024;
      const D = Math.min(audio.length - 1, Math.floor(atraso / porPacote));
      if (D > 0) {
        const meta0 = audio[0][1];
        desloc = audio[D][0].timestamp;
        audio = audio.slice(D);
        audio[0] = [audio[0][0], { ...(audio[0][1] || {}), ...meta0 }];
      }
    } catch (_) { /* sem compensação */ }
  }
  // 2) muxer
  const col = new Coletor();
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (d, p) => col.escrever(d, p) }),
    video: { codec: sv.video.mux, width: W, height: H },
    audio: sa ? { codec: sa.mux, sampleRate: ix.audio.taxa, numberOfChannels: sa.canais } : undefined,
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  let ia = 0;
  const audioAte = (t) => { while (ia < audio.length && audio[ia][0].timestamp - desloc <= t) { muxer.addAudioChunk(audio[ia][0], audio[ia][1], audio[ia][0].timestamp - desloc); ia++; } };
  // 3) vídeo
  let erroEnc = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => { audioAte(chunk.timestamp); muxer.addVideoChunk(chunk, meta); },
    error: (e) => { erroEnc = e; },
  });
  enc.configure(sv.video.cfg);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  let total = 0;
  for (const p of partes) total += p.qb - p.qa;
  let feitos = 0;
  let ultimaChave = -Infinity;
  let tCursor = 0;   // fim do último quadro emitido (µs na saída)
  const dq = Math.round(1e6 / fps);
  const codificar = async (ts, dur) => {
    if (erroEnc) throw erroEnc;
    const vf = new VideoFrame(cv, { timestamp: ts, duration: dur });
    const chave = ts - ultimaChave >= 2e6;
    if (chave) ultimaChave = ts;
    enc.encode(vf, { keyFrame: chave });
    vf.close();
    await esperarFila(enc, 4);
  };
  const preto = async (ate) => {
    // lacuna na timeline: quadros pretos no fps nominal
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    while (tCursor + dq / 2 < ate) {
      const d = Math.min(dq, ate - tCursor);
      await codificar(tCursor, d);
      tCursor += d;
    }
    tCursor = Math.max(tCursor, ate);
  };
  try {
    await percorrer({
      blob, v, partes, cfgDec: sv.cfgDec, cancelado,
      aoQuadro: async (f, q, parte) => {
        const ts = Math.round(parte.tOut + v.pts[q] - v.pts[parte.qa]);
        if (ts > tCursor + dq / 2) await preto(ts);
        const ret = enquadramento(v, parte.c, q, recorte);
        const fe = fonteExibida(f, v.rotacao || 0);
        desenhar(ctx, fe.src, fe.sw, fe.sh, ret, W, H);
        const dur = v.pts[q + 1] - v.pts[q];
        await codificar(ts, dur);
        tCursor = ts + dur;
        feitos++;
        if (feitos % 5 === 0) aoProgresso((sa ? 0.1 : 0) + (sa ? 0.9 : 1) * feitos / total, 'vídeo', feitos, total);
      },
    });
    if (tCursor + dq / 2 < durSaida) await preto(durSaida);
    await enc.flush();
    if (erroEnc) throw erroEnc;
    audioAte(Infinity);
    muxer.finalize();
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
  aoProgresso(1, 'pronto', feitos, total);
  const out = col.blob('video/mp4');
  return {
    blob: out, nome: `${nomeBase}-editado-${carimbo()}.mp4`, tipo: 'video/mp4', quadros: feitos, w: W, h: H,
    comAudio: Boolean(sa), avisos, exato: true, codec: sv.video.codec + (sa ? ' + ' + sa.cfgEnc.codec : ''),
  };
}

export function carimbo() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/* ======================================================= reserva: tempo real */

async function exportarTempoReal({ url, v, partes, recorte, W, H, fps, bitrate, comAudio, nomeBase, avisos, aoProgresso, cancelado, durSaida, desloc = 0 }) {
  if (typeof MediaRecorder === 'undefined') throw new Error('este navegador não exporta vídeo (sem WebCodecs e sem MediaRecorder)');
  const video = document.createElement('video');
  video.src = url; video.playsInline = true; video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px';
  document.body.appendChild(video);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { alpha: false });
  const stream = cv.captureStream(fps);
  let ac = null;
  if (comAudio) {
    try {
      ac = new AudioContext();
      const src = ac.createMediaElementSource(video);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
    } catch (_) { avisos.push('Sem áudio na exportação em tempo real.'); }
  }
  // WebM primeiro (é o formato de reserva pedido e o mais estável no MediaRecorder do Chrome/Firefox);
  // Safari não grava WebM: cai no melhor formato do app (MP4)
  const comA = stream.getAudioTracks().length > 0;
  const WEBM = comA ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus'] : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'];
  const mWebm = WEBM.find((m) => MediaRecorder.isTypeSupported(m));
  const fmt = mWebm ? { mime: mWebm, ext: 'webm', nome: 'WebM · ' + mWebm.split('=')[1].toUpperCase().replace(',', ' + ') } : melhorFormato(comA);
  if (!fmt) throw new Error('nenhum formato de gravação disponível');
  const pedacos = [];
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 160000 });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) pedacos.push(e.data); };
  let erroRec = null;
  rec.onerror = (e) => { erroRec = (e && e.error) || new Error('falha do MediaRecorder'); };
  const conferir = () => { if (erroRec) throw new Error('gravação em tempo real falhou: ' + (erroRec.message || erroRec)); };
  const fimRec = new Promise((r) => { rec.onstop = r; });
  await new Promise((r) => { if (video.readyState >= 1) r(); else video.onloadedmetadata = r; });
  const buscar = (t) => new Promise((r) => { video.onseeked = () => r(); video.currentTime = t; });
  let feitos = 0;
  const total = partes.reduce((s, p) => s + p.qb - p.qa, 0);
  try {
    let iniciado = false;
    for (const p of partes) {
      if (cancelado()) throw new Cancelado();
      await buscar((v.pts[p.qa] + (v.pts[p.qa + 1] - v.pts[p.qa]) / 2) / 1e6 + desloc);
      ctx.drawImage(video, ...retPx(enquadramento(v, p.c, p.qa, recorte), video), 0, 0, W, H);
      conferir();
      if (!iniciado) { rec.start(1000); iniciado = true; } else if (rec.state === 'paused') rec.resume();
      const fimT = v.pts[p.qb] / 1e6;
      await new Promise((resolve, reject) => {
        let qAnt = -1;
        seguirQuadros(video, (meta) => {
          if (cancelado()) { video.pause(); reject(new Cancelado()); return false; }
          const mt = meta.mediaTime - desloc;
          const q = quadroEm(v.pts, v.n, Math.round(mt * 1e6) + (meta.aproximado ? 500 : 0));
          if (q >= p.qb || mt >= fimT - 0.001) { video.pause(); resolve(); return false; }
          if (q !== qAnt) {
            qAnt = q;
            ctx.drawImage(video, ...retPx(enquadramento(v, p.c, Math.max(p.qa, q), recorte), video), 0, 0, W, H);
            feitos++;
            aoProgresso(Math.min(1, feitos / total), 'tempo real', feitos, total);
          }
          return true;
        });
        video.onended = () => resolve();
        video.play().catch(reject);
      });
      conferir();
      if (rec.state === 'recording') rec.pause();
    }
    rec.stop();
    await fimRec;
  } finally {
    video.pause(); video.remove();
    if (ac) ac.close().catch(() => {});
    if (rec.state !== 'inactive') try { rec.stop(); } catch (_) { /* parado */ }
  }
  void durSaida;
  const blob = new Blob(pedacos, { type: fmt.mime.split(';')[0] });
  return { blob, nome: `${nomeBase}-editado-${carimbo()}.${fmt.ext}`, tipo: blob.type, quadros: feitos, w: W, h: H, comAudio: stream.getAudioTracks().length > 0, avisos, exato: false, codec: fmt.nome };
}

function retPx(ret, video) {
  const sw = video.videoWidth, sh = video.videoHeight;
  return [ret.x * sw, ret.y * sh, ret.w * sw, ret.h * sh];
}

/* ======================================================= exportar quadros */

/**
 * Quadros do trecho como JPEG: um a cada `passo.valor` quadros (tipo 'quadros')
 * ou segundos (tipo 'segundos'), recortados como na exportação.
 * @returns {Promise<{blob: Blob, nome: string, t: number, q: number}[]>}
 */
export async function exportarQuadros({ blob, url, ix, clipes, recorte, t0, t1, passo, qualidade = 0.92, larguraMax = 0, aoProgresso = () => {}, cancelado = () => false, nomeBase = 'quadro', deslocEl = 0 }) {
  const v = ix.video;
  const partes = trechos(v, clipes, t0, t1);
  if (!partes.length) throw new Error('não há quadros no trecho escolhido');
  // escolhe os quadros: índice global na saída
  const escolhidos = new Map();   // chave `${parte}-${q}` → tempo de saída
  {
    let g = 0, prox = 0;
    partes.forEach((p, ip) => {
      for (let q = p.qa; q < p.qb; q++, g++) {
        const t = p.tOut + v.pts[q] - v.pts[p.qa];
        let pega = false;
        if (passo.tipo === 'segundos') { if (t + 1 >= prox) { pega = true; prox = t + passo.valor * 1e6; while (prox <= t) prox += passo.valor * 1e6; } }
        else pega = g % Math.max(1, passo.valor) === 0;
        if (pega) escolhidos.set(ip + '-' + q, t);
      }
    });
  }
  const total = escolhidos.size;
  if (total > 5000) throw new Error(`seriam ${total} imagens — aumente o intervalo (máx. 5000)`);
  const { w: W0, h: H0 } = tamanhoSaida(v, recorte, 1);
  const k = larguraMax && W0 > larguraMax ? larguraMax / W0 : 1;
  const W = Math.round(W0 * k), H = Math.round(H0 * k);
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d', { alpha: false });
  const out = [];
  const emitir = async (src, sw, sh, ret, t, q) => {
    desenhar(ctx, src, sw, sh, ret, W, H);
    const b = await cv.convertToBlob({ type: 'image/jpeg', quality: qualidade });
    out.push({ blob: b, nome: `${nomeBase}-${timecode(t, v.fps).replace(/:/g, '-')}-q${q}.jpg`, t, q });
    aoProgresso(out.length / total, 'quadros', out.length, total);
  };
  const cfgDec = await podeDecodificar(ix);
  if (cfgDec) {
    await percorrer({
      blob, v, partes: partes.map((p, ip) => ({ ...p, ip })), cfgDec, cancelado,
      aoQuadro: async (f, q, parte) => {
        const t = escolhidos.get(parte.ip + '-' + q);
        if (t === undefined) return;
        const fe = fonteExibida(f, v.rotacao || 0);
        await emitir(fe.src, fe.sw, fe.sh, enquadramento(v, parte.c, q, recorte), t, q);
      },
    });
    return out;
  }
  // reserva: busca cada quadro num <video> oculto
  const video = document.createElement('video');
  video.src = url; video.muted = true; video.playsInline = true; video.preload = 'auto';
  await new Promise((r, j) => { video.onloadeddata = r; video.onerror = () => j(new Error('vídeo ilegível')); });
  try {
    for (const [chave, t] of escolhidos) {
      if (cancelado()) throw new Cancelado();
      const [ip, qs] = chave.split('-');
      const q = +qs;
      const p = partes[+ip];
      await new Promise((r) => { video.onseeked = () => r(); video.currentTime = (v.pts[q] + (v.pts[q + 1] - v.pts[q]) / 2) / 1e6 + deslocEl; });
      await emitir(video, video.videoWidth, video.videoHeight, enquadramento(v, p.c, q, recorte), t, q);
    }
  } finally { video.removeAttribute('src'); video.load(); }
  return out;
}
