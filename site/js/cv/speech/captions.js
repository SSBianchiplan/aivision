/**
 * cv/speech/captions.js — legendas: o que foi dito, quando, e o que está
 * sendo dito agora.
 *
 * Dois motores diferentes (o reconhecimento nativo do navegador e o Whisper
 * local) produzem o mesmo tipo de coisa: trechos de fala com início, fim e
 * texto, alguns ainda provisórios. Este módulo é o ponto comum — acumula os
 * trechos, mantém a legenda "ao vivo" e exporta nos formatos que um editor de
 * vídeo ou o YouTube aceitam.
 *
 * Tudo puro, exceto o estado "ao vivo", que é global de propósito: o Viewport
 * o lê a cada quadro para desenhar a legenda dentro do vídeo — e é por estar
 * DENTRO do vídeo que ela também sai na gravação.
 */

// ------------------------------------------------------------ ao vivo

/*
 * O que aparece agora na tela. `interim` é texto provisório do motor (muda a
 * cada meio segundo enquanto a pessoa fala); `final` é o último trecho
 * fechado. Os dois se mostram juntos: o fechado firme, o provisório em cinza.
 */
const vivo = { final: '', interim: '', ate: 0, ligado: false };

/** Por quanto tempo a última frase fica na tela depois de fechada. */
const PERMANENCIA_MS = 4000;

export function ligarLegenda(on) {
  vivo.ligado = Boolean(on);
  if (!on) { vivo.final = ''; vivo.interim = ''; }
}

export function atualizarVivo({ final, interim }, agora = Date.now()) {
  if (typeof final === 'string' && final.trim()) {
    vivo.final = final.trim();
    vivo.ate = agora + PERMANENCIA_MS;
  }
  vivo.interim = typeof interim === 'string' ? interim.trim() : '';
}

/** O que o Viewport desenha neste quadro, ou null. */
export function legendaAtual(agora = Date.now()) {
  if (!vivo.ligado) return null;
  const final = agora <= vivo.ate ? vivo.final : '';
  if (!final && !vivo.interim) return null;
  return { final, interim: vivo.interim };
}

// ------------------------------------------------------------ acumulado

export function novaSessao() {
  return { segmentos: [], inicio: null, motor: null, idioma: null };
}

/**
 * Acrescenta um trecho FECHADO. Devolve estado novo.
 *
 * Dois trechos iguais em sequência (o nativo às vezes reemite o último ao
 * reiniciar) colapsam num só. Trechos vazios ou só de pontuação não entram.
 */
export function acrescentar(sessao, { texto, inicio, fim, confianca = null }) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return sessao;

  const segs = sessao.segmentos.slice();
  const ultimo = segs[segs.length - 1];
  if (ultimo && normal(ultimo.texto) === normal(t)) {
    // repetição do motor: estende o anterior em vez de duplicar
    segs[segs.length - 1] = { ...ultimo, fim: Math.max(ultimo.fim, fim) };
    return { ...sessao, segmentos: segs };
  }

  segs.push({ texto: t, inicio, fim: Math.max(fim, inicio), confianca });
  return { ...sessao, segmentos: segs, inicio: sessao.inicio ?? inicio };
}

function normal(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Duração total falada, em ms. */
export function duracao(sessao) {
  return sessao.segmentos.reduce((a, s) => a + Math.max(0, s.fim - s.inicio), 0);
}

// ------------------------------------------------------------ exportação

/** Tempo relativo ao início da sessão, no formato pedido. */
function relativo(ms, inicio, sep) {
  const t = Math.max(0, ms - inicio);
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const f = Math.floor(t % 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(f, 3)}`;
}

/**
 * SubRip. É o formato que Premiere, DaVinci, VLC e o YouTube aceitam sem
 * conversão — por isso é o padrão do botão Exportar.
 */
export function exportarSrt(sessao) {
  const ini = sessao.inicio ?? 0;
  return sessao.segmentos.map((s, i) =>
    `${i + 1}\n${relativo(s.inicio, ini, ',')} --> ${relativo(s.fim, ini, ',')}\n${s.texto}\n`
  ).join('\n');
}

/** WebVTT: o formato do <track> HTML, para legendar o vídeo na web. */
export function exportarVtt(sessao) {
  const ini = sessao.inicio ?? 0;
  return 'WEBVTT\n\n' + sessao.segmentos.map((s) =>
    `${relativo(s.inicio, ini, '.')} --> ${relativo(s.fim, ini, '.')}\n${s.texto}\n`
  ).join('\n');
}

/** Texto corrido com hora de relógio, para ler ou colar num documento. */
export function exportarTexto(sessao, { comHora = true } = {}) {
  const hora = (ms) => new Date(ms).toLocaleTimeString('pt-BR');
  const cab = sessao.inicio
    ? `# Transcrição de áudio — iaVision — ${new Date(sessao.inicio).toLocaleString('pt-BR')}`
      + (sessao.motor ? ` — motor: ${sessao.motor}` : '') + '\n\n'
    : '';
  return cab + sessao.segmentos
    .map((s) => (comHora ? `[${hora(s.inicio)}] ` : '') + s.texto)
    .join('\n');
}
