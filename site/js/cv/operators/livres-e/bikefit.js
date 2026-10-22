/**
 * operators/livres-e/bikefit.js — CV-28 Bike Fit (biomecânica do ciclista).
 *
 * Mesmo caminho do dnn.pose (CV-06): YOLOX acha a pessoa e o BlazePose
 * (MediaPipe, Apache-2.0) estima os 33 pontos no recorte. Duas diferenças,
 * as duas por causa da pedalada:
 *
 *   1. O YOLOX (300 ms – 2 s no WASM) NÃO roda a cada inferência. Ele só
 *      acha o ciclista; depois o recorte segue os próprios pontos da pose do
 *      quadro anterior (como o MediaPipe faz). O detector volta quando a pose
 *      se perde ou degrada (visibilidade baixa, escala do recorte fugindo da
 *      semente) e, como rede de segurança, a cada `detectarMs` (8 s). Ele
 *      roda na mesma fila do ONNX que o BlazePose, então cada rodada abre um
 *      buraco de 0,3–2 s na amostragem: a 2 s fixos isso engolia um PMI a
 *      cada duas pedaladas. A Sessao descarta o ciclo que contém o buraco.
 *   2. O recorte segue o protocolo do MediaPipe: QUADRADO, centrado no
 *      meio do quadril e GIRADO para o tronco ficar em pé. O modelo foi
 *      treinado assim; um ciclista inclinado 40–50° num recorte reto faz o
 *      BlazePose "endireitar" o corpo e jogar o quadril para o guidão (foi o
 *      que se viu nos testes). O centro, a escala e a rotação vêm dos dois
 *      pontos auxiliares que o próprio modelo devolve (33 = centro, 34 =
 *      escala/rotação): lado = 2·|33→34|·1,25, 33→34 apontando para cima.
 *      Depois do YOLOX, a semente testa 5 rotações e fica com a pose que
 *      melhor cobre a caixa da pessoa (ver o comentário no código).
 *   3. Espelho: o BlazePose não é simétrico (no vídeo de teste, o joelho no
 *      PMI deu 146,9° no original e 123,8° espelhado). Com a imagem
 *      espelhada (o padrão do app, inclusive para arquivos), o recorte é
 *      DESESPELHADO antes do modelo e os pontos voltam espelhados, com
 *      esquerda/direita trocadas — o modelo sempre vê a orientação real.
 *      `espelhada: automático` segue o Espelhar da Fonte (ctx.mirrored).
 *
 * Tudo roda no navegador; nada da imagem sai do aparelho.
 * A matemática (ângulos, ciclo, faixas, recomendações) está em
 * runtime/livres-e/bikefit.js; a sessão e o painel, em runtime/livres-e/canal.js.
 */
import { clone } from '../../core.js';
import { MODELS, run, makeTensor } from '../../runtime/onnx.js';
import { letterbox, toTensorData, decodeYolox, unletterbox } from '../../runtime/tensor.js';
import { ensure, schedule, sigmoid } from '../../runtime/opkit.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import {
  LM, indicesLado, indicesPerto, ladoPelaDirecao, ladoModelo, nomeLado, medirLateral, medirFrontal, kopsPct, qualidade,
  NOMES_PERFIS, FRONTAL, status, COR_STATUS, cmPorPx, recomendacoes, num, faixaTxt,
} from '../../runtime/livres-e/bikefit.js';
import {
  obterSessao, publicar, estaGravando, geracaoSessao, zerarSessao, studioAberto, alvosSessao, obterAtleta, manterRetrato,
} from '../../runtime/livres-e/canal.js';

const novoCanvas = (w, h) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
};

/**
 * ROI girada: centro (cx, cy), lado s (px do quadro) e direção "para cima"
 * (ux, uy) unitária, em px do quadro. Sem rotação: (0, −1).
 * Mapeamento recorte→quadro: f = C + k·(u'·a + v'·b), com u' = u − S/2,
 * v' = v − S/2, k = s/S, a = (−uy, ux) (direita) e b = (−ux, −uy) (baixo).
 */
function eixos(roi) {
  return { a: { x: -roi.uy, y: roi.ux }, b: { x: -roi.ux, y: -roi.uy } };
}
function recorteGirado(fonte, roi, S, st) {
  if (!st.cc) st.cc = novoCanvas(S, S);
  const g = st.cc.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  const k = roi.s / S, { a, b } = eixos(roi);
  // inversa (ortonormal): u = S/2 + a·(f − C)/k, v = S/2 + b·(f − C)/k
  g.setTransform(a.x / k, b.x / k, a.y / k, b.y / k,
    S / 2 - (a.x * roi.cx + a.y * roi.cy) / k, S / 2 - (b.x * roi.cx + b.y * roi.cy) / k);
  g.imageSmoothingQuality = 'medium';
  g.drawImage(fonte, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return g.getImageData(0, 0, S, S);
}
function paraQuadro(roi, S, u, v) {
  const k = roi.s / S, { a, b } = eixos(roi);
  const up = u - S / 2, vp = v - S / 2;
  return { x: roi.cx + k * (up * a.x + vp * b.x), y: roi.cy + k * (up * a.y + vp * b.y) };
}
/** Próxima ROI a partir dos pontos auxiliares 33 (centro) e 34 (escala/rotação). */
function roiDosAuxiliares(c, e) {
  const dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy);
  if (!(d > 2)) return null;
  return { cx: c.x, cy: c.y, s: 2 * d * 1.25, ux: dx / d, uy: dy / d };
}

/** Caixa dos 33 pontos (px do quadro). */
function caixaPose(P) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < 33; i++) {
    const p = P[i];
    if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
    if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
  }
  return { x1, y1, x2, y2 };
}
function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy, u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return u > 0 ? inter / u : 0;
}

/** Ombros, quadris, joelhos e tornozelos: a nota de uma estimativa. */
const NUCLEO = [11, 12, 23, 24, 25, 26, 27, 28];

/** Pares esquerda↔direita dos 33 pontos MediaPipe (para a passada espelhada). */
const ESPELHO = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21,
  24, 23, 26, 25, 28, 27, 30, 29, 32, 31];

async function inferir(crop, ps) {
  const o2 = await run('pose', await makeTensor(toTensorData(crop, ps), ps.input));
  let lms = null, presenca = null;
  for (const key of Object.keys(o2)) {
    const d = o2[key];
    if (d.dims.length === 2 && d.dims[1] === ps.landmarks * ps.stride) lms = d.data;
    else if (d.dims.length === 2 && d.dims[1] === 1) presenca = d.data[0];   // "pose flag" (0..1)
  }
  return lms ? { lms, presenca } : null;
}

function espelharRecorte(crop) {
  const W = crop.width, H = crop.height, a = crop.data, out = new ImageData(W, H), b = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, j = (y * W + (W - 1 - x)) * 4;
      b[i] = a[j]; b[i + 1] = a[j + 1]; b[i + 2] = a[j + 2]; b[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Uma estimativa do BlazePose numa ROI: 33 pontos + 2 auxiliares, em px do
 * quadro. Com `esp` (quadro espelhado), a passada principal roda no recorte
 * DESESPELHADO — a orientação real da cena — e os pontos voltam espelhados,
 * com esquerda/direita trocadas: para o resto do código é como se o modelo
 * tivesse visto o quadro espelhado, mas sem o viés de orientação.
 * Com `duplo`, roda também a outra orientação e funde as duas
 * (média ponderada pela visibilidade, com esquerda/direita destrocadas).
 * Medido quadro a quadro num vídeo real de rolo (8 s, 30 fps), joelho no PMI:
 *   passada simples, original 146,9° · espelhado 123,8°  (o modelo NÃO é simétrico)
 *   fusão,           original 133,6° · espelhado 133,8°  (estável, mas puxa para baixo)
 *   referência YOLO26-pose (outro modelo): 147,8° · 156,8°
 * A passada simples na orientação real bateu com a referência; a fusão só
 * ganha consistência. Por isso o padrão é a passada SIMPLES na orientação
 * real (desespelhando quando preciso). A fusão fica como opção (2× custo).
 */
async function estimarPose(fonte, roi, ps, st, duplo = false, esp = false) {
  const S = ps.input[2];
  const crop = recorteGirado(fonte, roi, S, st);
  const espelhado = esp ? espelharRecorte(crop) : null;
  const r1 = await inferir(esp ? espelhado : crop, ps);
  if (!r1) return null;
  // ponto i da saída de uma passada; `inv` = a passada viu o recorte invertido:
  // u volta espelhado e o índice troca de lado (ESPELHO)
  const pt = (lms, i, inv) => {
    const o = (inv && i < 33 ? ESPELHO[i] : i) * ps.stride;
    return { u: inv ? S - lms[o] : lms[o], v: lms[o + 1], vis: i < 33 ? sigmoid(lms[o + 3]) : 1 };
  };
  const A = [];
  for (let i = 0; i < 35; i++) A.push(pt(r1.lms, i, esp));
  let presenca = r1.presenca;
  if (duplo) {
    const r2 = await inferir(esp ? crop : espelharRecorte(crop), ps);
    if (r2) {
      for (let i = 0; i < 35; i++) {
        const b = pt(r2.lms, i, !esp), a = A[i];
        const wa = a.vis + 0.05, wb = b.vis + 0.05;
        A[i] = { u: (a.u * wa + b.u * wb) / (wa + wb), v: (a.v * wa + b.v * wb) / (wa + wb), vis: (a.vis + b.vis) / 2 };
      }
      if (presenca != null && r2.presenca != null) presenca = (presenca + r2.presenca) / 2;
    }
  }
  const P = A.map((a) => { const f = paraQuadro(roi, S, a.u, a.v); return { x: f.x, y: f.y, v: a.vis }; });
  const aux = P.splice(33, 2);
  return { P, aux, crop, presenca, proxima: roiDosAuxiliares(aux[0], aux[1]) };
}

/** Miniatura alinhada ao quadro (não à ROI girada): quadrado de lado roi.s em volta do centro. */
const LADO_MINI = 160;
function recortarMini(fonte, roi, st) {
  if (!st.mc) st.mc = novoCanvas(LADO_MINI, LADO_MINI);
  const g = st.mc.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, LADO_MINI, LADO_MINI);
  const caixa = { x0: roi.cx - roi.s / 2, y0: roi.cy - roi.s / 2, s: roi.s };
  const k = LADO_MINI / caixa.s;
  g.drawImage(fonte, -caixa.x0 * k, -caixa.y0 * k, fonte.width * k, fonte.height * k);
  return { img: g.getImageData(0, 0, LADO_MINI, LADO_MINI), caixa };
}
function miniatura(img) {
  try {
    if (typeof document === 'undefined') return null;
    const a = document.createElement('canvas'); a.width = img.width; a.height = img.height;
    a.getContext('2d').putImageData(img, 0, 0);
    return a.toDataURL('image/jpeg', 0.8);
  } catch (_) { return null; }
}

/** Arco do ângulo em B (de BA até BC, pelo lado interno), como segmentos de linha. */
function arco(ov, A, B, C, r, cor) {
  const a1 = Math.atan2(A.y - B.y, A.x - B.x);
  let d = Math.atan2(C.y - B.y, C.x - B.x) - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = 12;
  let px = B.x + r * Math.cos(a1), py = B.y + r * Math.sin(a1);
  for (let i = 1; i <= n; i++) {
    const a = a1 + (d * i) / n;
    const x = B.x + r * Math.cos(a), y = B.y + r * Math.sin(a);
    ov.push({ type: 'line', x1: px, y1: py, x2: x, y2: y, color: cor, width: 2.2 });
    px = x; py = y;
  }
  const meio = a1 + d / 2;
  return { x: B.x + (r + 6) * Math.cos(meio), y: B.y + (r + 6) * Math.sin(meio), meio };
}

/** Rótulo colorido (retângulo vazio com legenda — o desenhista pinta o fundo na cor). */
function rotulo(ov, x, y, texto, cor) {
  ov.push({ type: 'rect', x, y, w: 0, h: 0, color: cor, label: texto });
}

const segmento = (ov, a, b, cor, w = 3) => {
  if (a && b) ov.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: cor, width: w });
};
const r0 = (x) => (x == null ? '—' : num(x, 0));

/** Espelho efetivo: 'automático' segue a Fonte (ctx.mirrored); booleanos antigos continuam valendo. */
/**
 * Inclinação do pé (calcanhar → ponta) sobre a horizontal, em graus;
 * positivo = ponta mais baixa que o calcanhar. Para o Studio Bike Fit.
 */
export function anguloPe(P, I, minVis = 0.5) {
  const c = P[I.calcanhar], t = P[I.pe];
  if (!c || !t || c.v < minVis || t.v < minVis) return null;
  const dx = Math.abs(t.x - c.x), dy = t.y - c.y;
  if (!(Math.hypot(dx, dy) > 1e-6)) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Os 33 pontos em coordenadas normalizadas do quadro (0..1) e a visibilidade, para o Studio. */
const normalizar = (P, w, h) => P.map((q) => [Math.round((q.x / w) * 1e4) / 1e4, Math.round((q.y / h) * 1e4) / 1e4, Math.round(q.v * 100) / 100]);

/**
 * Aviso de amostragem baixa com o que dá para fazer AQUI (o texto da sessão só
 * diz "feche outros programas"): o custo por pose é o recorte + BlazePose, e o
 * que mais rouba tempo dele é o resto da cadeia e a largura do quadro.
 */
export const DICA_AMOSTRAGEM = 'Para subir: baixe a "Largura de processamento" (Configurações), desligue outros nós pesados do Pipeline, ' +
  'aproxime o ciclista com o zoom da imagem (ele grande no quadro) e prefira o Chrome com WebGPU.';
function dicaAmostragem(a) {
  if (!/^Amostragem baixa/.test(a)) return a;
  return a.replace(/ — feche outros programas ou use um aparelho mais rápido\.?$/, '.') + ' ' + DICA_AMOSTRAGEM;
}

export function resolverEspelho(v, ctx) {
  if (v === 'sim' || v === true) return true;
  if (v === 'não' || v === false) return false;
  return Boolean(ctx && ctx.mirrored);
}

/**
 * Numa miniatura em cinza de 64 px de largura: o MOVIMENTO entre duas
 * amostras (percentil 95 da diferença absoluta, 0..255 — foto ou vídeo
 * parado dá 0, e aí o "pé subindo e descendo" é só a pose oscilando) e a
 * LUZ do quadro (média e percentil 95 do brilho). Pouca luz não derruba a
 * visibilidade do BlazePose nem a consistência da pose, mas desloca os
 * ângulos (vídeo de teste a 20% do brilho: joelho no PMI 127° contra 144°).
 */
const LARG_MOV = 64;
function medirImagem(fonte, w, h, st) {
  const mh = Math.max(8, Math.round((LARG_MOV * h) / w));
  if (!st.movc || st.movc.height !== mh) { st.movc = novoCanvas(LARG_MOV, mh); st.movAnt = null; }
  const g = st.movc.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(fonte, 0, 0, LARG_MOV, mh);
  const d = g.getImageData(0, 0, LARG_MOV, mh).data;
  const cinza = new Uint8Array(LARG_MOV * mh);
  const hl = new Uint32Array(256);
  let soma = 0;
  for (let i = 0, j = 0; j < cinza.length; i += 4, j++) {
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    cinza[j] = y; hl[y]++; soma += y;
  }
  const p95 = (hist) => {
    let acc = 0;
    const alvo = 0.95 * cinza.length;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= alvo) return v; }
    return 255;
  };
  const luz = { media: soma / cinza.length, p95: p95(hl) };
  const ant = st.movAnt;
  st.movAnt = cinza;
  if (!ant || ant.length !== cinza.length) return { mov: null, luz };
  const hist = new Uint32Array(256);
  for (let j = 0; j < cinza.length; j++) hist[Math.abs(cinza[j] - ant[j])]++;
  return { mov: p95(hist), luz };
}

export const analise = {
  op: 'bikefit.analise',
  label: 'Bike Fit — análise do ciclista',
  group: 'CV-28',
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Biomecânica do ciclista com a pose BlazePose: ângulos de joelho, quadril, tronco, ombro, ' +
        'cotovelo e tornozelo na articulação, PMI/PMS e cadência pela trajetória do pé, KOPS ' +
        'aproximado, alinhamento dos joelhos na vista frontal e recomendações por perfil. ' +
        'Tudo no navegador. Abra o painel Bike Fit para a tabela, o relatório e o guia de filmagem.',
  params: {
    vista: { type: 'enum', options: ['lateral', 'frontal'], default: 'lateral', label: 'Vista da câmera' },
    perfil: { type: 'enum', options: NOMES_PERFIS, default: 'Estrada', label: 'Perfil' },
    lado: { type: 'enum', options: ['automático', 'esquerdo', 'direito'], default: 'automático', label: 'Lado analisado' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.5, label: 'Visibilidade mín.' },
    nCiclos: { type: 'int', min: 3, max: 50, step: 1, default: 10, label: 'Pedaladas na estatística' },
    rastro: { type: 'bool', default: true, label: 'Rastro do joelho e tornozelo' },
    alturaCm: { type: 'int', min: 0, max: 230, step: 1, default: 0, label: 'Altura do ciclista (cm; vale a do perfil do atleta, se houver; 0 = sem escala)' },
    pernaCm: { type: 'int', min: 0, max: 130, step: 1, default: 0, label: 'Perna trocânter–tornozelo (cm, opcional)' },
    passadaDupla: { type: 'bool', default: false, label: 'Fundir as duas orientações (estável, 2× custo)' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 8000, label: 'Re-detectar ciclista (ms, rede de segurança)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const det = MODELS.yolox, ps = MODELS.pose;
    const sessao = obterSessao();
    const esp = resolverEspelho(p.espelhada, ctx);
    // mudar vista, espelho ou lado no meio da sessão mistura dois regimes de
    // medida: começa uma sessão nova
    const assinatura = `${p.vista}|${esp}|${p.lado}`;
    if (state.assinatura && state.assinatura !== assinatura) {
      zerarSessao();
      state.ladoAnt = null; state.membros = null; state.roi = null;
    }
    state.assinatura = assinatura;
    if (state.geracao !== geracaoSessao()) { state.geracao = geracaoSessao(); state.rastroPts = []; }

    schedule(state, p.everyMs,
      () => {
        // QUADRO PARADO (YouTube pausado, tela ou câmera congelada, histórico):
        // re-inferir a mesma imagem fazia o esqueleto tremer (a ROI vem da pose
        // anterior e realimenta diferenças mínimas: 2–3 px, ~2° de desvio) e
        // empurrava amostras repetidas na sessão. Mantém a última pose e não
        // mede. Pela imagem também: ciclista parado não tem o que medir. Só
        // repassa a mesma imagem enquanto a ROI converge depois do detector.
        if (quadroRepetido(state, src, ctx, { imagem: true, forcar: convergindo(state, state.results) })) return null;
        const w = src.width, h = src.height, t = performance.now();
        if (!state.fc || state.fc.width !== w || state.fc.height !== h) state.fc = novoCanvas(w, h);
        state.fc.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
        const precisaDetectar = !state.roi || !state.tDet || t - state.tDet > p.detectarMs || state.redetectar;
        const img = medirImagem(state.fc, w, h, state);
        const out = { w, h, t, p: { ...p, esp }, mov: img.mov, luz: img.luz };
        if (precisaDetectar) {
          state.redetectar = false;
          const lb = letterbox(src, det.input[3], det.input[2]);
          out.det = { data: toTensorData(lb.data, det), lb };
        }
        return out;
      },
      async ({ w, h, t, p: q, det: dIn, mov, luz }) => {
        const semCiclista = () => {
          // retrato "sem ciclista": o painel não pode continuar mostrando o anterior
          const est = sessao.estadoMedicao();
          const res = sessao.resumo(q.nCiclos);
          publicar({
            t, sem: true, vista: q.vista, perfil: q.perfil, lado: null, ang: {}, kops: null, frontal: null,
            avisos: ['Nenhum ciclista encontrado no quadro.'], cadencia: sessao.cadencia(t), pedaladas: sessao.pedaladas,
            resumo: res, recs: sessao.ciclos.length ? recomendacoes(res, q.perfil, {}, q.vista, { ...est, faixas: alvosSessao(q.perfil).faixas }) : [],
            recsCtx: { geo: {}, est, nCiclos: q.nCiclos },
            congelado: sessao.congelado, gravando: estaGravando(), espelhada: q.esp, w, h,
          });
          return { sem: true, w, h, t };
        };
        // ---- 1. onde está o ciclista (só quando precisa)
        if (dIn) {
          const o1 = await run('yolox', await makeTensor(dIn.data, det.input));
          const k1 = Object.keys(o1)[0];
          const caixas = decodeYolox(o1[k1].data, o1[k1].dims, det, 0.35, 0.45, 10)
            .filter((b) => b.classId === 0).map((b) => unletterbox(b, dIn.lb));
          state.tDet = t;
          if (!caixas.length) { state.roi = null; return semCiclista(); }
          caixas.sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1));
          const b = caixas[0];
          state.caixa = { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 };
          const semente = { cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, s: Math.max(b.x2 - b.x1, b.y2 - b.y1) * 1.25, ux: 0, uy: -1 };
          // re-semeia se não há ROI, se a pessoa mudou de lugar, ou se a pose
          // que está sendo seguida não cobre mais a caixa do detector (colapsou)
          const cobre = state.Pult ? iou(caixaPose(state.Pult), state.caixa) : 0;
          if (!state.roi || cobre < 0.45 || Math.hypot(semente.cx - state.roi.cx, semente.cy - state.roi.cy) > 0.5 * semente.s) {
            state.roi = semente; state.semente = true; state.aquecer = 6;
          }
        }
        let roi = state.roi;
        if (!roi) return semCiclista();

        // ---- 2. pose na ROI girada
        let est;
        if (state.semente && state.caixa) {
          // Semente do detector: não se sabe a inclinação do tronco. Um ciclista
          // em posição aero tem o tronco quase horizontal, e no recorte reto o
          // modelo põe o quadril embaixo dos ombros (no guidão). Visibilidade e
          // "pose flag" não denunciam o erro (o modelo é confiante até nele);
          // o que denuncia é a GEOMETRIA: a pose certa ocupa a caixa da pessoa,
          // a errada encolhe. Tenta 5 rotações, refina cada uma pelos
          // auxiliares e fica com a de maior IoU entre os pontos e a caixa.
          state.semente = false;
          let melhor = null;
          for (const graus of [0, 40, -40, 70, -70]) {
            const r = (graus * Math.PI) / 180;
            let cand = await estimarPose(state.fc, { ...roi, ux: Math.sin(r), uy: -Math.cos(r) }, ps, state, q.passadaDupla, q.esp);
            if (cand && cand.proxima) {
              const ref = await estimarPose(state.fc, cand.proxima, ps, state, q.passadaDupla, q.esp);
              if (ref) { ref.roiUsada = cand.proxima; cand = ref; }
            }
            if (!cand) continue;
            cand.nota = iou(caixaPose(cand.P), state.caixa);
            if (!melhor || cand.nota > melhor.nota) melhor = cand;
            if (cand.nota > 0.8) break;      // bom o bastante: poupa as outras passadas
          }
          est = melhor;
          if (est && est.roiUsada) roi = est.roiUsada;
          if (est && est.proxima) state.sAncora = est.proxima.s;
        } else {
          est = await estimarPose(state.fc, roi, ps, state, q.passadaDupla, q.esp);
        }
        if (!est) return semCiclista();
        const { P } = est;
        state.Pult = P;
        // pose perdida? volta ao detector no próximo ciclo
        const vMed = NUCLEO.reduce((sm, i) => sm + P[i].v, 0) / NUCLEO.length;
        const prox = est.proxima;
        if (vMed < 0.3 || !prox || prox.s < 0.08 * Math.min(w, h) || prox.s > 3 * Math.max(w, h)) {
          state.roi = null; return semCiclista();
        }
        // pose degradando (visibilidade baixa por vários quadros, ou o recorte
        // encolhendo/inchando muito em relação à semente): pede o detector já,
        // em vez de esperar o intervalo fixo
        state.vBaixa = vMed < 0.45 ? (state.vBaixa || 0) + 1 : 0;
        const fugiu = state.sAncora && (prox.s < 0.55 * state.sAncora || prox.s > 1.8 * state.sAncora);
        if (state.vBaixa >= 5 || fugiu) { state.redetectar = true; state.vBaixa = 0; }
        // a ROI do próximo quadro vem dos auxiliares (levemente suavizada contra tremor)
        const m = 0.7;
        const ux = roi.ux + m * (prox.ux - roi.ux), uy = roi.uy + m * (prox.uy - roi.uy), nu = Math.hypot(ux, uy) || 1;
        state.roi = { cx: roi.cx + m * (prox.cx - roi.cx), cy: roi.cy + m * (prox.cy - roi.cy), s: roi.s + m * (prox.s - roi.s), ux: ux / nu, uy: uy / nu };

        // a ROI ainda está convergindo depois do detector: mostra, mas não mede
        if (state.aquecer > 0) { state.aquecer--; return { P, w, h, t, aquecendo: true, avisos: [] }; }

        // ---- 3. biomecânica
        const lado = ladoModelo(q.lado, q.esp, P, state.ladoAnt, q.minVis);
        state.ladoAnt = lado;
        const auto = q.lado === 'automático' && q.vista === 'lateral';
        const I = auto ? indicesPerto(P, state.membros) : indicesLado(lado);
        if (auto) state.membros = I;
        const med = medirLateral(P, I, q.minVis);
        const nome = auto ? ladoPelaDirecao(med.dir, q.esp) : nomeLado(lado, q.esp);
        const frontal = q.vista === 'frontal' ? medirFrontal(P, q.minVis, sessao.pernaPx() || 0) : null;
        const kops = q.vista === 'lateral' ? kopsPct(med.joelhoPt, med.pedal, med.dir, med.perna) : null;
        // na vista frontal o ciclo vem do tornozelo mais visível
        let peY = med.peY;
        if (frontal) peY = frontal.peY[lado] != null ? frontal.peY[lado] : (frontal.peY.e ?? frontal.peY.d);
        if (frontal && q.esp) { const e = frontal.e; frontal.e = frontal.d; frontal.d = e; }   // anatômico
        const avisos = qualidade(P, q.vista, auto ? I : lado, w, h, q.minVis);
        // lado forçado na perna de trás: o modelo inventa a perna escondida
        if (!auto && q.vista === 'lateral') {
          const soma = (l) => ['quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'].reduce((s, k) => s + (P[LM[k][l]] ? P[LM[k][l]].v : 0), 0);
          const outro = lado === 'e' ? 'd' : 'e';
          if (soma(lado) + 0.8 < soma(outro)) avisos.push(`A perna escolhida (${nome}) está do lado oposto à câmera: use "automático" ou filme o outro lado.`);
        }
        const amostra = {
          t, lado: nome, ladoIdx: I, vista: q.vista,
          ang: q.vista === 'lateral' ? med.ang : { joelho: med.ang.joelho },
          peY, perna: med.perna, coxa: med.coxa, canela: med.canela,
          pedalFrente: med.pedal ? med.pedal.x * med.dir : null, kops, frontal,
          mov, luz, nAvisos: avisos.length,
          pose: { P, roi: { ...roi } },
        };
        // guarda as miniaturas recentes: o PMI/PMS é confirmado alguns quadros depois
        const mini = recortarMini(state.fc, roi, state);
        amostra.pose.caixa = mini.caixa;
        state.recortes = state.recortes || [];
        state.recortes.push({ t, img: mini.img });
        if (state.recortes.length > 48) state.recortes.shift();

        const r = sessao.adicionar(amostra, { gravar: estaGravando() });
        for (const e of r.eventos) {
          const c = state.recortes.find((x) => x.t === e.t);
          const alvo = sessao.congelado[e.tipo];
          if (c && alvo) alvo.thumb = miniatura(c.img);
        }
        const estado = sessao.estadoMedicao();
        const todos = [...avisos, ...estado.avisos.map(dicaAmostragem)];

        // retrato para o painel
        const res = sessao.resumo(q.nCiclos);
        // escala: a altura do atleta ativo (perfil do painel/Studio); sem ela, a do nó
        const cmPx = cmPorPx(sessao.pernaPx(), { ...q, alturaCm: obterAtleta().alturaCm || q.alturaCm || 0 });
        const geo = { coxa: med.coxa, canela: med.canela, cmPx };
        publicar({
          t, vista: q.vista, perfil: q.perfil, lado: amostra.lado, ladoModelo: lado, ang: amostra.ang, kops, frontal,
          avisos: todos, cadencia: sessao.cadencia(t), pedaladas: sessao.pedaladas, resumo: res, cmPx,
          recs: recomendacoes(res, q.perfil, geo, q.vista, { ...estado, faixas: alvosSessao(q.perfil).faixas }),
          recsCtx: { geo, est: estado, nCiclos: q.nCiclos },     // canal refaz as recs se o atleta mudar
          congelado: sessao.congelado, gravando: estaGravando(), inferMs: performance.now() - t, espelhada: q.esp,
          taxa: estado.taxa, indicativo: estado.indicativo,
          // para o Studio Bike Fit: pontos normalizados, lado, direção, pé e marcas de PMI/PMS
          w, h, pts: normalizar(P, w, h), I, dir: med.dir, minVis: q.minVis,
          angPe: q.vista === 'lateral' ? anguloPe(P, I, q.minVis) : null,
          eventos: r.eventos.map((e) => ({ tipo: e.tipo, t: e.t })),
          cfg: { perfil: q.perfil, vista: q.vista, lado: amostra.lado, nCiclos: q.nCiclos, alturaCm: q.alturaCm, pernaCm: q.pernaCm },
        });
        return { P, w, h, t, lado, I, nome, med, frontal, avisos: todos, kops, dir: med.dir, esp: q.esp };
      });

    const r = state.results;
    // parado: o painel e o Studio continuam vendo a última pose (sem amostra nova)
    if (state._parado) {
      manterRetrato(performance.now());
      ctx.metrics['bike fit amostragem'] = 'pausada (quadro parado)';
    }
    // Studio aberto: nada de overlay — o canvas de exibição fica só com o vídeo,
    // que o Studio copia e redesenha no estilo dele (as métricas continuam)
    const studio = studioAberto();
    if (studio) ctx = { ...ctx, overlay: [] };
    // com o Studio aberto, nada de desenho nem de resumo da sessão por QUADRO (desenhar() chama
    // sessao.resumo a cada quadro): o Studio lê o canal e o thread fica livre para a inferência
    if (studio && r && !r.sem && !r.aquecendo) {
      if (state.inferMs) ctx.metrics['bikefit ms'] = state.inferMs.toFixed(0);
      ctx.metrics['bike fit'] = 'no Studio';
      return clone(src);
    }
    if (state.inferMs) ctx.metrics['bikefit ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['bikefit erro'] = state.error;
    if (!r || r.sem) {
      ctx.metrics['bike fit'] = 'sem ciclista';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Bike Fit: procurando o ciclista…', color: '#FFD84D' });
      return clone(src);
    }
    if (r.aquecendo) {
      ctx.metrics['bike fit'] = 'ajustando o recorte…';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Bike Fit: ajustando a pose…', color: '#FFD84D' });
      return clone(src);
    }
    desenhar(r, p, state, ctx, sessao);
    return clone(src);
  },
};

function desenhar(r, p, state, ctx, sessao) {
  const ov = ctx.overlay;
  const sx = ctx.w / r.w, sy = ctx.h / r.h;
  const P = r.P.map((pt) => ({ x: pt.x * sx, y: pt.y * sy, v: pt.v }));
  const vis = (i) => P[i].v >= p.minVis;
  const perfil = alvosSessao(p.perfil).faixas;     // alvos do atleta (modalidade + perfil)
  const res = sessao.resumo(p.nCiclos);
  const cad = sessao.cadencia(r.t);
  const escala = Math.max(0.6, Math.min(2.2, ctx.w / 480));
  let hud = 8;
  // o banner tem 20 px de TELA; em px do quadro isso depende do zoom da exibição.
  // 22·w/400 cobre até um celular de 390 px mostrando o quadro inteiro.
  const passo = Math.max(24, (22 * ctx.w) / 400);
  const banner = (text, color) => { ov.push({ type: 'banner', x: 8, y: hud, text, color }); hud += passo; };

  if (p.vista === 'frontal') {
    const f = r.frontal || {};
    for (const l of ['e', 'd']) {
      const [q, j, t] = [LM.quadril[l], LM.joelho[l], LM.tornozelo[l]];
      if (!(vis(q) && vis(j) && vis(t))) continue;
      const anat = r.esp ? (l === 'e' ? 'd' : 'e') : l;
      const d = f[anat];
      const st = status(d, FRONTAL.desvio, 3);
      segmento(ov, P[q], P[t], 'rgba(255,255,255,.45)', 1.2);                 // linha de referência
      segmento(ov, P[q], P[j], COR_STATUS[st], 3); segmento(ov, P[j], P[t], COR_STATUS[st], 3);
      ov.push({ type: 'point', x: P[j].x, y: P[j].y, r: 5, color: COR_STATUS[st] });
      if (d != null) rotulo(ov, P[j].x + 8 * escala, P[j].y, `${anat === 'e' ? 'E' : 'D'} ${d > 0 ? 'dentro' : 'fora'} ${num(Math.abs(d))}%`, COR_STATUS[st]);
    }
    segmento(ov, P[LM.quadril.e], P[LM.quadril.d], '#22d3ee', 2);
    segmento(ov, P[LM.ombro.e], P[LM.ombro.d], '#22d3ee', 2);
    if (f.pelve != null) {
      const m = { x: (P[23].x + P[24].x) / 2, y: (P[23].y + P[24].y) / 2 };
      rotulo(ov, m.x, m.y - 6 * escala, `pelve ${num(Math.abs(f.pelve))}°`, Math.abs(f.pelve) > FRONTAL.pelve ? COR_STATUS.perto : COR_STATUS.ok);
    }
    banner(`Bike Fit · frontal · ${p.perfil}`, '#22d3ee');
    const e = res.desvioE, d = res.desvioD;
    if (e && e.n) banner(`Joelho E: desvio máx ${num(e.media)}% · D: ${d && d.n ? num(d.media) : '—'}% da perna`, '#FFD84D');
  } else {
    const I = r.I || indicesLado(r.lado);
    const pt = (k) => (vis(I[k]) ? P[I[k]] : null);
    const [ombro, cotovelo, punho, quadril, joelho, tornozelo, calc, pe] =
      ['ombro', 'cotovelo', 'punho', 'quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'].map(pt);

    // rastros (coordenadas normalizadas, para sobreviver à troca de resolução)
    if (p.rastro) {
      const rs = state.rastroPts = state.rastroPts || [];
      if (!rs.length || rs[rs.length - 1].t !== r.t) {
        rs.push({ t: r.t, j: joelho && { x: joelho.x / ctx.w, y: joelho.y / ctx.h }, a: tornozelo && { x: tornozelo.x / ctx.w, y: tornozelo.y / ctx.h } });
        while (rs.length && rs[0].t < r.t - 1600) rs.shift();
      }
      for (let i = 1; i < rs.length; i++) {
        for (const [k, cor] of [['j', 'rgba(167,139,250,.85)'], ['a', 'rgba(34,211,238,.85)']]) {
          const a = rs[i - 1][k], b = rs[i][k];
          // salto grande = pose perdida/re-semeada: não liga os pontos
          if (a && b && Math.hypot(a.x - b.x, a.y - b.y) < 0.12) ov.push({ type: 'line', x1: a.x * ctx.w, y1: a.y * ctx.h, x2: b.x * ctx.w, y2: b.y * ctx.h, color: cor, width: 1.6 });
        }
      }
    }

    // esqueleto do lado medido
    const osso = '#e5e7eb';
    segmento(ov, ombro, quadril, osso); segmento(ov, quadril, joelho, osso); segmento(ov, joelho, tornozelo, osso);
    segmento(ov, ombro, cotovelo, osso); segmento(ov, cotovelo, punho, osso);
    segmento(ov, tornozelo, calc, osso, 2); segmento(ov, calc, pe, osso, 2); segmento(ov, tornozelo, pe, osso, 2);
    for (const q of [ombro, cotovelo, punho, quadril, joelho, tornozelo, pe]) if (q) ov.push({ type: 'point', x: q.x, y: q.y, r: 4, color: '#FFD84D' });

    const coxa = r.med.coxa ? r.med.coxa * sx : 40;
    const R = Math.max(12, coxa * 0.28);
    const ang = r.med.ang;
    // faixa a usar para colorir o valor AO VIVO: joelho perto da extensão compara com o PMI, perto da flexão com o PMS
    const faixaJoelho = ang.joelho != null && ang.joelho > (perfil.joelhoPMI[0] + perfil.joelhoPMS[1]) / 2 ? perfil.joelhoPMI : perfil.joelhoPMS;
    const marca = (A, B, C, v, nome, faixa) => {
      if (!A || !B || !C || v == null) return;
      const st = faixa ? status(v, faixa) : 'sem';
      const cor = faixa ? COR_STATUS[st] : '#22d3ee';
      const m = arco(ov, A, B, C, R, cor);
      const lx = B.x - Math.cos(m.meio) * (R + 10 * escala);
      const ly = B.y - Math.sin(m.meio) * (R + 4 * escala);
      rotulo(ov, lx - 18 * escala, ly + 8 * escala, `${nome} ${Math.round(v)}°`, cor);
    };
    marca(quadril, joelho, tornozelo, ang.joelho, 'joelho', faixaJoelho);
    marca(ombro, quadril, joelho, ang.quadril, 'quadril', null);
    marca(quadril, ombro, cotovelo, ang.ombro, 'ombro', perfil.ombro);
    marca(ombro, cotovelo, punho, ang.cotovelo, 'cotov.', perfil.cotovelo);
    marca(joelho, tornozelo, pe, ang.tornozelo, 'tornoz.', null);
    // tronco: arco entre a horizontal (para a frente) e o tronco
    if (quadril && ombro && ang.tronco != null) {
      const H = { x: quadril.x + r.dir * coxa, y: quadril.y };
      segmento(ov, quadril, H, 'rgba(255,255,255,.35)', 1);
      const cor = COR_STATUS[status(ang.tronco, perfil.tronco)];
      arco(ov, H, quadril, ombro, R * 1.5, cor);
      rotulo(ov, quadril.x + r.dir * R * 1.6 - (r.dir < 0 ? 70 * escala : 0), quadril.y - R * 0.4, `tronco ${Math.round(ang.tronco)}°`, cor);
    }
    // KOPS: prumo do joelho e o eixo do pedal estimado
    if (joelho && r.med.pedal) {
      const pd = { x: r.med.pedal.x * sx, y: r.med.pedal.y * sy };
      const k = res.kops && res.kops.n ? res.kops.media : null;
      const cor = k == null ? 'rgba(255,255,255,.5)' : COR_STATUS[status(k, perfil.kops, 2)];
      segmento(ov, joelho, { x: joelho.x, y: pd.y }, cor, 1.2);
      ov.push({ type: 'point', x: pd.x, y: pd.y, r: 4, color: '#fb923c' });
    }

    banner(`Bike Fit · ${p.perfil} · lado ${r.nome}`, '#22d3ee');
    banner(`Cadência ${cad ? Math.round(cad) + ' rpm' : '—'} · ${sessao.pedaladas} pedaladas`, cad ? '#4ade80' : '#94a3b8');
    const jM = res.joelhoMax, jm = res.joelhoMin;
    if (jM && jM.n) banner(`Joelho PMI ${r0(jM.media)}° (${faixaTxt(perfil.joelhoPMI)}) · PMS ${r0(jm.media)}°`, COR_STATUS[status(jM.media, perfil.joelhoPMI, 3)]);
    if (res.kops && res.kops.n) banner(`KOPS ${res.kops.media > 0 ? '+' : ''}${num(res.kops.media)}% da perna (${res.kops.media >= 0 ? 'à frente' : 'atrás'})`, COR_STATUS[status(res.kops.media, perfil.kops, 2)]);
    ctx.metrics['joelho'] = r0(ang.joelho) + '°';
    ctx.metrics['quadril'] = r0(ang.quadril) + '°';
    ctx.metrics['tronco'] = r0(ang.tronco) + '°';
    ctx.metrics['ombro'] = r0(ang.ombro) + '°';
    ctx.metrics['cotovelo'] = r0(ang.cotovelo) + '°';
    ctx.metrics['tornozelo'] = r0(ang.tornozelo) + '°';
    if (jM && jM.n) { ctx.metrics['joelho PMI'] = r0(jM.media) + '°'; ctx.metrics['joelho PMS'] = r0(jm.media) + '°'; }
    if (res.kops && res.kops.n) ctx.metrics['KOPS'] = num(res.kops.media) + '%';
  }
  for (const a of r.avisos.slice(0, 2)) banner('⚠ ' + a, '#f87171');
  ctx.metrics['bike fit'] = `${p.vista} · ${r.nome || nomeLado(r.lado, r.esp)}${r.esp ? ' · espelhada' : ''}`;
  ctx.metrics['cadência'] = cad ? Math.round(cad) + ' rpm' : '—';
  ctx.metrics['pedaladas'] = sessao.pedaladas;
  if (r.avisos.length) ctx.metrics['bike fit aviso'] = r.avisos[0];
}

export default [analise];
