/**
 * cv/runtime/livres-h/arquivo.js — análise de um vídeo QUADRO A QUADRO.
 *
 * Ao vivo, a pose roda na velocidade que o aparelho aguenta (10–25 Hz no
 * WASM) e o tempo de cada amostra é o relógio da página: o tempo de voo e o
 * de contato ficam presos a essa amostragem. Aqui o vídeo é aberto num
 * elemento próprio (fora do Viewport) e cada quadro entra com o instante
 * EXATO da mídia (metadata.mediaTime do requestVideoFrameCallback). Um vídeo
 * de 30 fps dá ±33 ms por borda; um de câmera lenta a 240 fps (informando o
 * fator), ±4 ms.
 *
 * Como os quadros chegam: o vídeo TOCA (em velocidade reduzida) e cada
 * quadro apresentado é copiado para uma fila; a pose consome a fila no seu
 * ritmo. Fila cheia pausa o vídeo, fila vazia retoma — decodificação em
 * sequência, sem busca. (Buscar quadro a quadro custava 250–550 ms por
 * quadro: o decodificador volta ao último quadro-chave a cada busca.) Se o
 * navegador pular quadros mesmo assim, a velocidade cai pela metade. Sem
 * requestVideoFrameCallback, cai na busca quadro a quadro.
 *
 * A inferência passa pela mesma fila única do ONNX (run()); se o operador
 * do Pipeline estiver rodando ao mesmo tempo, os dois dividem a fila (fica
 * mais lento, mas correto). Nada do vídeo sai do aparelho.
 */
import { loadModel } from '../onnx.js';
import { RastreadorPose } from './pose.js';

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const espera = (alvo, ev, ms = 4000) => new Promise((res, rej) => {
  const t = setTimeout(() => { alvo.removeEventListener(ev, ok); rej(new Error('tempo esgotado esperando ' + ev)); }, ms);
  const ok = () => { clearTimeout(t); alvo.removeEventListener(ev, ok); res(); };
  alvo.addEventListener(ev, ok);
});

const TAXAS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240];
/** Taxa de quadros pelo menor passo entre quadros (arredondada para a taxa comum mais próxima). */
export function taxaDosPassos(passos) {
  const d = passos.filter((x) => x > 0.001 && x < 0.2).sort((a, b) => a - b);
  if (d.length < 3) return null;
  const fps = 1 / (d[0] * 0.5 + d[Math.floor(d.length / 2)] * 0.5);
  let melhor = null;
  for (const c of TAXAS) if (Math.abs(fps - c) / c < 0.04 && (melhor == null || Math.abs(fps - c) < Math.abs(fps - melhor))) melhor = c;
  return melhor || Math.round(fps);
}

/**
 * Analisa `arquivo` (File/Blob) e chama `onAmostra(tMs, P, info)` para cada
 * quadro com pose. opts = { lenta (fator de câmera lenta), inverter (vídeo
 * gravado espelhado: desvira antes da pose, para esquerda/direita saírem
 * certas), larg (largura de processamento), onProgresso(f, info), sinal
 * ({ cancelado }), coerencia (descarta pose de duas pessoas fundidas e
 * re-detecta), processador (async (img, tMs, info) → nº de pessoas: troca o
 * caminho de pose de uma pessoa por outro, p. ex. várias pessoas com o RTMO),
 * preparar (async, carrega os modelos do processador) }.
 * Devolve { quadros, comPose, pulados, incoerentes, fps, duracao, ... }.
 */
export async function analisarArquivo(arquivo, onAmostra, opts = {}) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const url = URL.createObjectURL(arquivo);
  const prog = opts.onProgresso || (() => {});
  try {
    prog(0, { fase: 'abrindo o vídeo' });
    v.src = url;
    await espera(v, 'loadeddata', 15000);
    prog(0, { fase: 'carregando modelos' });
    if (!opts.processador) { await loadModel('yolox'); await loadModel('pose'); }
    else if (opts.preparar) await opts.preparar();
    const dur = v.duration;
    if (!(dur > 0) || !Number.isFinite(dur)) throw new Error('duração do vídeo desconhecida');
    const W = Math.min(opts.larg || 640, v.videoWidth), Hh = Math.round((W * v.videoHeight) / v.videoWidth);
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    const g = c.getContext('2d', { willReadFrequently: true });
    const capturar = () => {
      g.save();
      if (opts.inverter) { g.translate(W, 0); g.scale(-1, 1); }
      g.drawImage(v, 0, 0, W, Hh);
      g.restore();
      return g.getImageData(0, 0, W, Hh);
    };
    const rast = new RastreadorPose();
    const lenta = opts.lenta > 1 ? opts.lenta : 1;
    const est = { comPose: 0, quadros: 0, msPose: 0, pulados: 0 };
    const t0 = performance.now();
    const processar = async (img, mediaTime, i) => {
      const tp = performance.now();
      const tMs = (mediaTime * 1000) / lenta;
      if (opts.processador) {
        // várias pessoas (ou outro caminho de pose): quem processa é o chamador, com o tempo exato da mídia
        const n = await opts.processador(img, tMs, { w: W, h: Hh, i });
        est.msPose += performance.now() - tp;
        if (n) est.comPose++;
        return;
      }
      const prep = rast.preparar(img, mediaTime * 1000, { esp: false, detectarMs: 10000, coerencia: Boolean(opts.coerencia) });
      const r = await rast.estimar(prep);
      est.msPose += performance.now() - tp;
      if (r && r.incoerente) est.incoerentes = (est.incoerentes || 0) + 1;
      if (r && r.P && !r.aquecendo && !r.incoerente) { est.comPose++; onAmostra(tMs, r.P, { w: W, h: Hh, i, img }); }
    };
    let fps;
    if (typeof v.requestVideoFrameCallback === 'function') {
      // ---- decodificação em sequência: toca devagar, copia cada quadro, a pose consome a fila
      const fila = [], passos = [];
      let fim = false, ultimoT = null, taxa = 0.25;
      v.playbackRate = taxa;
      v.addEventListener('ended', () => { fim = true; });
      const cb = (_, meta) => {
        if (fim) return;
        if (ultimoT != null) {
          const d = meta.mediaTime - ultimoT;
          if (d > 0) passos.push(d);
          // quadro pulado: o passo da mídia é maior que 1,5 do menor passo visto
          const menor = passos.length > 3 ? Math.min(...passos.slice(-60)) : null;
          if (menor && d > 1.5 * menor) est.pulados += Math.round(d / menor) - 1;
        }
        ultimoT = meta.mediaTime;
        fila.push({ img: capturar(), t: meta.mediaTime, i: est.quadros++ });
        if (fila.length >= 24 && !v.paused) v.pause();
        // pulou quadro: mais devagar (o tempo de cada amostra continua exato)
        if (est.pulados > 0 && est.quadros % 15 === 0 && taxa > 0.07 && est.pulados / est.quadros > 0.02) { taxa /= 2; v.playbackRate = taxa; }
        v.requestVideoFrameCallback(cb);
      };
      v.requestVideoFrameCallback(cb);
      await v.play();
      let parado = 0;
      while (!(opts.sinal && opts.sinal.cancelado)) {
        if (!fila.length) {
          if (fim || v.ended) break;
          if (v.paused) v.play().catch(() => {});
          await dormir(8);
          if (++parado > 1500) throw new Error('o vídeo parou de entregar quadros');
          continue;
        }
        parado = 0;
        const f = fila.shift();
        if (v.paused && !fim && fila.length < 8) v.play().catch(() => {});
        await processar(f.img, f.t, f.i);
        if (f.i % 5 === 0) {
          const dec = (performance.now() - t0) / 1000;
          prog(Math.min(1, f.t / dur), { fase: 'analisando', quadro: f.i + 1, fps: taxaDosPassos(passos), restante: f.t > 0 ? ((dur - f.t) * dec) / f.t : null });
        }
      }
      v.pause();
      fps = taxaDosPassos(passos) || 30;
    } else {
      // ---- sem requestVideoFrameCallback: busca quadro a quadro (lento, mas exato)
      fps = opts.fps || 30;
      const n = Math.max(1, Math.floor(dur * fps + 1e-6));
      for (let i = 0; i < n; i++) {
        if (opts.sinal && opts.sinal.cancelado) break;
        const alvo = Math.min(dur - 0.001, (i + 0.5) / fps);
        let ok = false;
        for (let k = 0; k < 3 && !ok; k++) {
          v.currentTime = alvo + k * 1e-3;
          try { await espera(v, 'seeked', 3000); ok = true; } catch (_) { /* tenta de novo */ }
        }
        if (!ok) { est.pulados++; continue; }
        est.quadros++;
        await processar(capturar(), i / fps, i);
        if (i % 5 === 0) prog((i + 1) / n, { fase: 'analisando', quadro: i + 1, total: n, fps });
      }
    }
    prog(1, { fase: 'concluído' });
    return {
      quadros: est.quadros, comPose: est.comPose, pulados: est.pulados, incoerentes: est.incoerentes || 0, deteccoes: rast.nDet, fps, duracao: dur,
      msPose: Math.round(est.msPose), ms: Math.round(performance.now() - t0), cancelado: Boolean(opts.sinal && opts.sinal.cancelado),
    };
  } finally {
    v.pause();
    v.removeAttribute('src'); v.load();
    URL.revokeObjectURL(url);
  }
}
