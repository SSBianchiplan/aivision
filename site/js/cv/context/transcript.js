/**
 * cv/context/transcript.js — TRANSCREVER: o texto lido, acumulado no tempo.
 *
 * LER responde «o que está escrito neste quadro». TRANSCREVER responde «o que
 * passou pela tela desde que comecei» — é o que se quer numa captura de tela
 * de apresentação, aula ou reunião: as frases vão aparecendo e sumindo, e o
 * que interessa é o texto corrido no fim.
 *
 * ================= O PROBLEMA É REPETIÇÃO, NÃO LEITURA =================
 *
 * A cada volta do modo contínuo o OCR lê a tela inteira de novo. Um slide
 * parado por dois minutos, a 3 s por leitura, produziria as mesmas oito
 * linhas quarenta vezes. A transcrição só cresce com o que é NOVO — e «novo»
 * é decidido por uma chave normalizada (caixa, espaços, pontuação nas
 * pontas), porque o OCR não devolve os mesmos bytes duas vezes: "Reunião de
 * hoje" e "REUNIAO DE HOJE." são a mesma linha.
 *
 * Tudo aqui é puro: recebe estado e devolve estado novo. Sem DOM, sem
 * relógio — o carimbo de tempo entra por parâmetro. É o que deixa testar em
 * Node o comportamento que importa: dedup, ordem e limite.
 * =======================================================================
 */

/** Chave de igualdade entre duas leituras da mesma linha. */
export function chaveDe(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // acentos fora: OCR troca
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')                    // pontuação e símbolos viram espaço
    .trim();
}

/** Estado vazio. */
export function novaTranscricao() {
  return { linhas: [], vistos: new Map(), inicio: null, total: 0 };
}

/** Limite de linhas guardadas: acima disso, as mais antigas saem. */
export const LIMITE = 2000;

/**
 * Acrescenta as linhas de uma leitura. Devolve um estado NOVO.
 *
 * @param estado  o acumulado
 * @param itens   [{ text, score? }] — a saída de LER
 * @param ts      instante da leitura (ms), fornecido por quem chama
 * @param minChars linhas menores que isto são ruído de OCR (bordas, ícones)
 */
export function acumular(estado, itens, ts, { minChars = 2, minScore = 0 } = {}) {
  const linhas = estado.linhas.slice();
  const vistos = new Map(estado.vistos);
  let novas = 0;

  for (const it of itens || []) {
    const texto = String(it && it.text || '').replace(/\s+/g, ' ').trim();
    if (texto.length < minChars) continue;
    if (typeof it.score === 'number' && it.score < minScore) continue;

    const chave = chaveDe(texto);
    if (!chave) continue;

    if (vistos.has(chave)) {
      /*
       * Já vista: não repete, mas registra que continua na tela. É o que
       * permite dizer «esta linha ficou visível de 10:02 a 10:04».
       */
      const i = vistos.get(chave);
      if (linhas[i]) linhas[i] = { ...linhas[i], ultima: ts, vezes: linhas[i].vezes + 1 };
      continue;
    }

    vistos.set(chave, linhas.length);
    linhas.push({ texto, chave, primeira: ts, ultima: ts, vezes: 1 });
    novas++;
  }

  // limite: descarta do começo e reindexa o mapa
  while (linhas.length > LIMITE) {
    const fora = linhas.shift();
    vistos.delete(fora.chave);
  }
  if (linhas.length !== estado.linhas.length + novas) {
    vistos.clear();
    linhas.forEach((l, i) => vistos.set(l.chave, i));
  }

  return {
    linhas, vistos,
    inicio: estado.inicio ?? ts,
    total: estado.total + novas,
    ultimaLeitura: ts,
    novasNaUltima: novas,
  };
}

/** Texto corrido, uma linha por entrada, com o horário em que apareceu. */
export function exportarTexto(estado, { comHora = true } = {}) {
  const hora = (ms) => {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
  };
  const cab = estado.inicio
    ? `# Transcrição iaVision — início ${new Date(estado.inicio).toLocaleString('pt-BR')}\n\n`
    : '';
  return cab + estado.linhas
    .map((l) => (comHora ? `[${hora(l.primeira)}] ` : '') + l.texto)
    .join('\n');
}

/** Só o texto, em parágrafo: para colar num documento. */
export function exportarCorrido(estado) {
  return estado.linhas.map((l) => l.texto).join(' ');
}
