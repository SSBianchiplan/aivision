/**
 * components/video/onda-worker.js — forma de onda calculada FORA da thread
 * principal (GPlanSiS|Vídeo).
 *
 * Decodifica o áudio inteiro com AudioDecoder (WebCodecs) direto dos pacotes
 * do índice (midia.js), lendo o Blob em blocos, e guarda só o PICO de cada
 * fatia de 1/400 s (1 byte). A cada ~200 ms manda o trecho novo para a
 * timeline desenhar aos poucos; no fim, o vetor inteiro (transferido).
 *
 *   → { tipo: 'calcular', blob, audio: { codec, descricao, taxa, canais, n, dec }, duracaoUs, fatiasPorS }
 *   ← { tipo: 'semSuporte', motivo }   (o principal cai para a reserva)
 *   ← { tipo: 'parcial', f0, dados, pct }
 *   ← { tipo: 'fim', picos }
 *   ← { tipo: 'erro', msg }
 */
import { lerAmostras } from './midia.js';
import { registrarPicos, DESLOC_AUDIO } from './onda.js';

self.onmessage = async (ev) => {
  const m = ev.data;
  if (m.tipo !== 'calcular') return;
  const a = m.audio;
  const FPS = m.fatiasPorS;
  const picos = new Uint8Array(Math.max(1, Math.ceil(m.duracaoUs / 1e6 * FPS) + 4));
  if (typeof AudioDecoder === 'undefined') { self.postMessage({ tipo: 'semSuporte', motivo: 'sem AudioDecoder no worker' }); return; }
  const cfg = { codec: a.codec, sampleRate: a.taxa, numberOfChannels: a.canais };
  if (a.descricao) cfg.description = a.descricao;
  try {
    if (!(await AudioDecoder.isConfigSupported(cfg)).supported) { self.postMessage({ tipo: 'semSuporte', motivo: 'codec de áudio ' + a.codec }); return; }
  } catch (e) { self.postMessage({ tipo: 'semSuporte', motivo: String(e) }); return; }
  let erro = null;
  let sujoIni = Infinity, sujoFim = -1;
  const estado = { feito: 0 };
  const dec = new AudioDecoder({
    output: (d) => {
      try {
        const r = registrarPicos(picos, d, d.timestamp - DESLOC_AUDIO, FPS, estado);
        if (r) { if (r[0] < sujoIni) sujoIni = r[0]; if (r[1] > sujoFim) sujoFim = r[1]; }
      } finally { d.close(); }
    },
    error: (e) => { erro = e; },
  });
  dec.configure(cfg);
  let ultimoEnvio = performance.now();
  const enviarParcial = (pct) => {
    if (sujoFim < sujoIni) return;
    const f0 = Math.max(0, sujoIni), f1 = Math.min(picos.length, sujoFim + 1);
    self.postMessage({ tipo: 'parcial', f0, dados: picos.slice(f0, f1), pct });
    sujoIni = Infinity; sujoFim = -1;
    ultimoEnvio = performance.now();
  };
  try {
    await lerAmostras(m.blob, a.dec, 0, a.n, async (i, bytes) => {
      if (erro) throw erro;
      dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: a.dec.pts[i] + DESLOC_AUDIO, data: bytes }));
      if (dec.decodeQueueSize > 48) await new Promise((r) => setTimeout(r, 0));
      if (performance.now() - ultimoEnvio > 200) enviarParcial(i / a.n);
    }, { maxBloco: 16 << 20 });
    await dec.flush();
    if (erro) throw erro;
    self.postMessage({ tipo: 'fim', picos }, [picos.buffer]);
  } catch (e) {
    self.postMessage({ tipo: 'erro', msg: String((e && e.message) || e) });
  } finally {
    if (dec.state !== 'closed') dec.close();
  }
};
