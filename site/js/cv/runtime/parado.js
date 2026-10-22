/**
 * cv/runtime/parado.js — QUADRO PARADO: não re-inferir a mesma imagem.
 *
 * Com o YouTube pausado (o player continua capturado como stream), uma tela
 * compartilhada com um vídeo parado ou o histórico (buffer) parado num
 * quadro, a fonte continua entregando quadros iguais ou quase iguais (ruído
 * de compressão). Re-inferir a pose sobre a mesma imagem não traz
 * informação e faz mal duas vezes:
 *   - o rastreio por ROI (o recorte vem da pose anterior) realimenta
 *     diferenças mínimas e o esqueleto "treme" — medido no Bike Fit com a
 *     imagem parada: 2–3 px e ~2° de desvio-padrão, ~25 passadas/s;
 *   - cada passada entra como amostra nova na sessão: médias, curvas e
 *     contagens andando sem o vídeo andar.
 *
 * Dois sinais:
 *   - EXPLÍCITO, do hospedeiro (ctx.fonteParada, ver Viewport): player do
 *     YouTube pausado, terminado, carregando ou parado no início; quadro do
 *     histórico repetido. Com ele, o operador infere UMA vez o quadro parado
 *     (o esqueleto fica no lugar certo) e trava.
 *   - pela IMAGEM (opcional, `imagem: true`): miniatura em cinza de LARG px
 *     comparada com a do ÚLTIMO QUADRO INFERIDO — não com o anterior: um
 *     movimento lento acumula e acaba passando do limiar. Conta os pixels
 *     que mudaram mais que LIMIAR_PX; até MAX_FRAC deles é ruído. Cobre
 *     câmera congelada, tela compartilhada e qualquer fonte sem sinal.
 *     NÃO serve a quem mede o parado (prancha da Academia, postura estática
 *     da Ergonomia, base do Salto): uma pessoa imóvel diante da câmera também
 *     dá "imagem igual". Esses usam só o sinal explícito.
 *
 * Uso, no `prep` do schedule (opkit.js) — devolver null = não roda nada, e
 * state.results (o que está desenhado) fica exatamente como está:
 *
 *   if (quadroRepetido(state, src, ctx, { imagem: true, forcar: convergindo })) return null;
 *
 * `forcar`: o operador ainda precisa de mais passadas na MESMA imagem (a ROI
 * convergindo depois do detector); a passada roda e vira a nova referência.
 */

/** Largura da miniatura em cinza (a altura segue o quadro). */
export const LARG = 64;
/** Diferença (0..255) acima da qual um pixel da miniatura "mudou". */
export const LIMIAR_PX = 8;
/** Fração de pixels mudados que ainda é ruído de compressão/câmera. */
export const MAX_FRAC = 0.004;

/**
 * Miniatura em cinza (média por célula) de um ImageData, sem canvas: o
 * operador recebe o quadro como ImageData e isto roda no laço de quadros.
 * Amostra ~4×4 pixels por célula: ~60 mil leituras num quadro de 640×360.
 */
export function miniCinza(img, larg = LARG) {
  const W = img.width, H = img.height, d = img.data;
  const lw = Math.max(1, Math.min(larg, W)), lh = Math.max(1, Math.round((lw * H) / W));
  const soma = new Float32Array(lw * lh), n = new Uint16Array(lw * lh);
  const passo = Math.max(1, Math.floor(W / lw / 4));
  const kx = lw / W, ky = lh / H;
  for (let y = 0; y < H; y += passo) {
    const linha = Math.min(lh - 1, (y * ky) | 0) * lw;
    for (let x = 0; x < W; x += passo) {
      const i = (y * W + x) * 4, c = linha + Math.min(lw - 1, (x * kx) | 0);
      soma[c] += (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) / 256;
      n[c]++;
    }
  }
  for (let c = 0; c < soma.length; c++) soma[c] = n[c] ? soma[c] / n[c] : 0;
  return soma;
}

/**
 * O rastreio por ROI ainda precisa de passadas na MESMA imagem: aquecendo
 * depois do detector, re-detecção pedida, ou sem ROI e sem ter concluído
 * "ninguém aqui". `st` = quem guarda roi/aquecer/redetectar (o estado do nó
 * ou o RastreadorPose); `results` = o último resultado do nó.
 */
export function convergindo(st, results) {
  return Boolean(st && (st.aquecer > 0 || st.redetectar || (!st.roi && !(results && results.sem))));
}

/** Pixels da miniatura que mudaram mais que LIMIAR_PX entre `a` e `b`. */
export function pixelsMudados(a, b, limiar = LIMIAR_PX) {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > limiar) k++;
  return k;
}

/**
 * true = o quadro é o mesmo que já foi inferido (ou a fonte está parada e
 * ele já foi inferido uma vez): não inferir, não publicar amostra.
 * false = quadro novo; vira a referência (o chamador vai inferir).
 * Estado guardado em `state` com prefixo `_par`.
 */
export function quadroRepetido(state, src, ctx, { imagem = false, forcar = false } = {}) {
  const explicito = Boolean(ctx && ctx.fonteParada);
  const mini = imagem && src && src.data ? miniCinza(src) : null;
  let repetido = false;
  if (!forcar) {
    if (explicito) repetido = Boolean(state._parVez);     // a fonte parou: só a primeira passada
    if (!repetido && mini && state._parRef && state._parRef.length === mini.length) {
      const k = pixelsMudados(mini, state._parRef);
      state._parMudados = k;
      repetido = k <= Math.max(1, MAX_FRAC * mini.length);
    }
  }
  state._parado = repetido;
  if (repetido) return true;
  if (mini) state._parRef = mini;
  state._parVez = explicito;
  return false;
}
