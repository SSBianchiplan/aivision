/**
 * cv/operators/livres-b/sam2.js — CV-22 SAM 2.1 tiny (Meta, Apache-2.0): seguir objeto.
 *
 * O SAM 2 de verdade rastreia com um banco de memória entre quadros; aqui
 * fica a versão que cabe no navegador e usa só os dois grafos de imagem:
 * RASTREIO POR RE-PROMPT. O usuário marca o objeto uma vez (a caixa de um
 * detector da cadeia, filtrada por classe e índice, ou um ponto); a cada
 * inferência o prompt passa a ser a caixa da MÁSCARA anterior, com uma folga
 * para o objeto caber se andou. Quando o decodificador diz que não há objeto
 * (object_score_logits ≤ limiar) ou a máscara encolhe a quase nada, o alvo é
 * dado por perdido e a próxima inferência volta a procurá-lo.
 *
 * Formatos (lidos do grafo com onnxruntime, não da documentação):
 *   codificador  pixel_values [1,3,1024,1024]  — esticado, sem letterbox
 *                -> image_embeddings.0/.1/.2 (256², 128², 64²)
 *   decodificador input_points [1,1,n,2] (coords do quadrado 1024²),
 *                input_labels [1,1,n] INT64, input_boxes [1,nb,4]
 *                -> iou_scores [1,k,3], pred_masks [1,k,3,256,256],
 *                   object_score_logits [1,k,1]
 *   Caixa sem ponto: um ponto falso com rótulo -10 (o "vazio" do processador).
 *   Ponto sem caixa: input_boxes com nb = 0.
 *
 * Como a imagem é esticada (não letterbox), a máscara 256² cobre o quadro
 * inteiro e vai direto para o paintMask.
 */
import { clone, alloc } from '../../core.js';
import { MODELS, runFeeds, ensureOrt } from '../../runtime/onnx.js';
import { stretch, toTensorData } from '../../runtime/tensor.js';
import { ensure, schedule, colorFor, hexToRgb, detectionsFromCtx, paintMask, bilinear, normalizar } from '../../runtime/opkit.js';
import { prepRfdetr, inferRfdetr } from './rfdetr.js';
import { registrarRegiao } from '../../regioes.js';

const G = 'CV-22';
const S = 1024, M = 256;

/** Caixa (normalizada) da região com logit > 0, área relativa e se tocou alguma coisa. */
function caixaDaMascara(logit) {
  let x0 = M, y0 = M, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < M; y++) {
    const o = y * M;
    for (let x = 0; x < M; x++) {
      if (logit[o + x] > 0) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  if (!n) return { box: null, area: 0 };
  return { box: { x1: x0 / M, y1: y0 / M, x2: (x1 + 1) / M, y2: (y1 + 1) / M }, area: n / (M * M) };
}

/**
 * Histograma de cor (4×4×4 = 64 caixas, normalizado) dos pixels de dentro da
 * máscara, lidos da imagem 1024² que foi para o codificador (1 a cada 4 px,
 * alinhado à grade 256² da máscara).
 */
function histograma(logit, rgba) {
  const hst = new Float32Array(64);
  let n = 0;
  for (let y = 0; y < M; y++) {
    for (let x = 0; x < M; x++) {
      if (logit[y * M + x] <= 0) continue;
      const q = ((y * 4 + 2) * S + (x * 4 + 2)) * 4;
      hst[((rgba[q] >> 6) << 4) | ((rgba[q + 1] >> 6) << 2) | (rgba[q + 2] >> 6)]++;
      n++;
    }
  }
  if (n) for (let i = 0; i < 64; i++) hst[i] /= n;
  return hst;
}
/** Interseção de histogramas: 1 = mesma distribuição de cor, 0 = nada em comum. */
function semelhanca(a, b) {
  let s = 0;
  for (let i = 0; i < 64; i++) s += Math.min(a[i], b[i]);
  return s;
}

/** Aumenta a caixa em `f` de cada lado (fração do próprio tamanho), presa ao quadro. */
function folga(b, f) {
  const dx = (b.x2 - b.x1) * f, dy = (b.y2 - b.y1) * f;
  return { x1: Math.max(0, b.x1 - dx), y1: Math.max(0, b.y1 - dy), x2: Math.min(1, b.x2 + dx), y2: Math.min(1, b.y2 + dy) };
}

/** Escolhe o alvo entre as detecções: filtro por classe, depois o n-ésimo por score. */
function escolher(dets, classe, indice) {
  const f = normalizar(classe);
  const cand = (dets || []).filter((d) => !f || normalizar(d.name).includes(f)).sort((a, b) => (b.score || 0) - (a.score || 0));
  return cand.length ? cand[Math.min(indice, cand.length - 1)] : null;
}

/**
 * Contorno: pinta os pixels de dentro (logit > 0) que têm vizinho de fora,
 * na resolução do quadro — com 2 px de espessura para aparecer no vídeo.
 */
function contorno(od, w, h, logit, rgb, region) {
  const x0 = Math.max(1, region.x0), y0 = Math.max(1, region.y0);
  const x1 = Math.min(w - 1, region.x1), y1 = Math.min(h - 1, region.y1);
  const rw = x1 - x0 + 2, rh = y1 - y0 + 2;
  if (rw <= 2 || rh <= 2) return;
  const kx = M / w, ky = M / h;
  const dentro = new Uint8Array(rw * rh);
  for (let y = y0 - 1; y <= y1; y++) {
    const fy = (y + 0.5) * ky - 0.5;
    for (let x = x0 - 1; x <= x1; x++) {
      dentro[(y - y0 + 1) * rw + (x - x0 + 1)] = bilinear(logit, M, M, (x + 0.5) * kx - 0.5, fy) > 0 ? 1 : 0;
    }
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y - y0 + 1) * rw + (x - x0 + 1);
      if (!dentro[i]) continue;
      if (dentro[i - 1] && dentro[i + 1] && dentro[i - rw] && dentro[i + rw]) continue;
      for (const q of [(y * w + x) * 4, (y * w + x - 1) * 4, ((y - 1) * w + x) * 4]) {
        od[q] = rgb[0]; od[q + 1] = rgb[1]; od[q + 2] = rgb[2];
      }
    }
  }
}

export const sam2Seguir = {
  op: 'sam2.seguir',
  label: 'SAM 2 — seguir objeto',
  group: G, model: 'sam2-enc', overlayOnly: false,
  desc: 'SAM 2.1 tiny (Apache-2.0): marque um objeto — pela classe de uma detecção ' +
        'anterior na cadeia (ou do RF-DETR embutido) ou por um ponto — e ele é ' +
        'seguido com máscara e contorno: a cada quadro o prompt é a caixa da máscara ' +
        'anterior. Se a máscara some, procura de novo. No modo "todas as detecções" ' +
        'faz uma máscara por caixa.',
  params: {
    modo: { type: 'enum', options: ['seguir objeto', 'todas as detecções'], default: 'seguir objeto', label: 'Modo' },
    alvo: { type: 'enum', options: ['detecção por classe', 'ponto na imagem'], default: 'detecção por classe', label: 'Como marcar o objeto' },
    classe: { type: 'text', default: '', max: 60, label: 'Classe (vazio = qualquer)' },
    indice: { type: 'int', min: 0, max: 20, step: 1, default: 0, label: 'Qual delas (0 = maior score)' },
    pontoX: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Ponto X (0–1)' },
    pontoY: { type: 'float', min: 0, max: 1, step: 0.01, default: 0.5, label: 'Ponto Y (0–1)' },
    margem: { type: 'float', min: 0, max: 0.5, step: 0.02, default: 0.1, label: 'Folga da caixa no re-prompt' },
    minObj: { type: 'float', min: -5, max: 10, step: 0.5, default: 0, label: 'Limiar de presença (logit)' },
    minArea: { type: 'float', min: 0, max: 0.05, step: 0.0005, default: 0.0005, label: 'Área mínima (fração do quadro)' },
    maxObj: { type: 'int', min: 1, max: 12, step: 1, default: 6, label: 'Máx. objetos (todas)' },
    confDet: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.45, label: 'Confiança do RF-DETR (sem detector)' },
    alpha: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.5, label: 'Opacidade' },
    minCor: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.45, label: 'Semelhança de cor mínima (perda)' },
    contorno: { type: 'bool', default: true, label: 'Desenhar contorno' },
    reiniciar: { type: 'bool', default: false, label: 'Reiniciar alvo (alternar)' },
    everyMs: { type: 'int', min: 0, max: 5000, step: 50, default: 200, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('sam2-enc', state, ctx) || !ensure('sam2-dec', state, ctx)) return clone(src);
    const seguir = p.modo === 'seguir objeto';
    const porPonto = seguir && p.alvo === 'ponto na imagem';

    // mudou o que se quer seguir: começa de novo
    const chave = [p.modo, p.alvo, p.classe, p.indice, p.pontoX, p.pontoY, p.reiniciar].join('|');
    if (state.chave !== chave) { state.chave = chave; state.track = null; state.results = null; state.visto = null; }

    // resultado novo: atualiza (ou perde) o alvo — uma vez por inferência, e
    // ANTES do schedule: senão o próximo prompt sai da caixa que acabou de ser
    // reprovada e volta como "aquisição" (visto no teste de troca de cena)
    const novo = state.results;
    if (novo && novo !== state.visto) {
      state.visto = novo;
      if (seguir) {
        const m = novo.masks[0];
        /*
         * Com prompt de CAIXA o SAM quase sempre acha "alguma coisa" ali dentro
         * (presença alta mesmo quando o objeto saiu e ficou o fundo). O que
         * denuncia a troca é a aparência: a cor da máscara nova contra a do
         * alvo. A referência acompanha devagar (luz muda), nunca de uma vez.
         */
        const sim = m && m.hist && state.track && state.track.hist ? semelhanca(m.hist, state.track.hist) : 1;
        state.sim = sim;
        if (m && m.box && m.obj > p.minObj && m.area >= p.minArea && sim >= p.minCor) {
          let hist = m.hist;
          if (state.track && state.track.hist && hist) {
            hist = state.track.hist.map((v, i) => v * 0.85 + m.hist[i] * 0.15);
          }
          state.track = { box: m.box, name: m.name, origem: m.origem, hist };
        } else {
          if (state.track) state.perdas = (state.perdas || 0) + 1;
          state.track = null;
        }
      }
    }

    const externas = detectionsFromCtx(ctx, 50);
    // alvo pego pelo RF-DETR embutido enquanto o detector da cadeia ainda
    // carregava (o Florence leva segundos): quando as caixas da cadeia chegam,
    // elas mandam — senão o SAM seguiria o objeto errado para sempre
    if (externas && state.track && state.track.origem === 'rfdetr') state.track = null;
    // sem detector antes na cadeia e precisando de caixas: o RF-DETR nano embutido
    const precisaDet = !externas && !porPonto && !(seguir && state.track);
    if (precisaDet && !ensure('rfdetr-nano', state, ctx)) return clone(src);

    schedule(state, p.everyMs,
      () => {
        const encSpec = MODELS['sam2-enc'];
        const img1024 = stretch(src, S, S);
        const x = toTensorData(img1024, encSpec);
        const rgba = img1024.data;                       // para o histograma de cor da máscara
        // o prompt é decidido AGORA, com o alvo conhecido neste quadro
        let prompts = null, rf = null;
        if (seguir && state.track) {
          prompts = [{ box: folga(state.track.box, p.margem), name: state.track.name, origem: state.track.origem }];
        } else if (porPonto) {
          prompts = [{ point: [p.pontoX, p.pontoY], name: 'objeto', origem: 'ponto' }];
        } else if (externas) {
          prompts = seguir
            ? [escolher(externas, p.classe, p.indice)].filter(Boolean).map((d) => ({ box: d, name: d.name, origem: 'cadeia' }))
            : externas.slice(0, p.maxObj).map((d) => ({ box: d, name: d.name, origem: 'cadeia' }));
        } else {
          rf = prepRfdetr(src, 'rfdetr-nano');
        }
        return { x, rgba, prompts, rf, adquirindo: !(seguir && state.track) };
      },
      async ({ x, rgba, prompts, rf, adquirindo }) => {
        const ort = await ensureOrt();
        const t0 = performance.now();
        if (rf) {
          const dets = await inferRfdetr(rf, 'rfdetr-nano', p.confDet, 50);
          prompts = seguir
            ? [escolher(dets, p.classe, p.indice)].filter(Boolean).map((d) => ({ box: d, name: d.name, origem: 'rfdetr' }))
            : dets.slice(0, p.maxObj).map((d) => ({ box: d, name: d.name, origem: 'rfdetr' }));
        }
        if (!prompts.length) return { masks: [], tEnc: 0, procurando: true };
        const enc = await runFeeds('sam2-enc', { pixel_values: new ort.Tensor('float32', x, [1, 3, S, S]) });
        const tEnc = performance.now() - t0;
        /*
         * Com ort.env.wasm.proxy = true, um tensor passado ao run() tem o
         * ArrayBuffer TRANSFERIDO ao worker: reusar enc['image_embeddings.0']
         * no segundo objeto dá "An ArrayBuffer is detached". E o decodificador
         * não aceita várias caixas numa chamada (Reshape fixo em 1 grupo).
         * Então cada chamada leva uma cópia; a última leva o original.
         */
        const EMB = ['image_embeddings.0', 'image_embeddings.1', 'image_embeddings.2']
          .map((k) => ({ k, data: enc[k].data, dims: enc[k].dims }));
        const masks = [];
        for (let pi = 0; pi < prompts.length; pi++) {
          const pr = prompts[pi], ultimo = pi === prompts.length - 1;
          const feeds = {};
          for (const e of EMB) feeds[e.k] = new ort.Tensor('float32', ultimo ? e.data : e.data.slice(), e.dims);
          if (pr.box) {
            const b = pr.box;
            feeds.input_boxes = new ort.Tensor('float32', Float32Array.from([b.x1 * S, b.y1 * S, b.x2 * S, b.y2 * S]), [1, 1, 4]);
            feeds.input_points = new ort.Tensor('float32', new Float32Array(2), [1, 1, 1, 2]);
            feeds.input_labels = new ort.Tensor('int64', BigInt64Array.from([-10n]), [1, 1, 1]);
          } else {
            feeds.input_boxes = new ort.Tensor('float32', new Float32Array(0), [1, 0, 4]);
            feeds.input_points = new ort.Tensor('float32', Float32Array.from([pr.point[0] * S, pr.point[1] * S]), [1, 1, 1, 2]);
            feeds.input_labels = new ort.Tensor('int64', BigInt64Array.from([1n]), [1, 1, 1]);
          }
          const out = await runFeeds('sam2-dec', feeds);
          // das 3 máscaras candidatas, a de maior IoU previsto
          const ious = out.iou_scores.data;
          let k = 0;
          for (let j = 1; j < 3; j++) if (ious[j] > ious[k]) k = j;
          const logit = Float32Array.from(out.pred_masks.data.subarray(k * M * M, (k + 1) * M * M));
          const { box, area } = caixaDaMascara(logit);
          masks.push({ logit, box, area, hist: seguir && box ? histograma(logit, rgba) : null, iou: Number(ious[k]), obj: Number(out.object_score_logits.data[0]), name: pr.name, origem: pr.origem, prompt: pr.box || null });
        }
        return { masks, tEnc, tTotal: performance.now() - t0, adquirindo };
      });

    const R = state.results;
    if (state.inferMs) ctx.metrics['sam2 ms'] = state.inferMs.toFixed(0);
    if (R && R.tEnc) ctx.metrics['sam2 enc ms'] = R.tEnc.toFixed(0);
    if (state.error) ctx.metrics['sam2 erro'] = state.error;
    if (seguir) ctx.metrics['sam2 perdas'] = state.perdas || 0;
    if (seguir && state.sim !== undefined) ctx.metrics['sam2 cor'] = state.sim.toFixed(2);

    const { w, h } = ctx;
    const visiveis = (R ? R.masks : []).filter((m) => m.box && (!seguir || state.track));
    if (seguir) {
      const alvo = p.alvo === 'ponto na imagem' ? `ponto (${p.pontoX.toFixed(2)}, ${p.pontoY.toFixed(2)})` : `"${p.classe || 'qualquer'}" #${p.indice}`;
      const m = visiveis[0];
      // embaixo: o topo costuma ser dos banners de quem vem antes (Florence, classificação)
      ctx.overlay.push({ type: 'banner', x: 8, y: h - 28, color: m ? '#4ade80' : '#fbbf24',
                         text: m ? `SAM 2 seguindo: ${m.name} · iou ${(m.iou * 100) | 0}% · presença ${m.obj.toFixed(1)}`
                                 : `SAM 2 procurando ${alvo}…` });
      if (porPonto && !state.track) ctx.overlay.push({ type: 'point', x: p.pontoX * w, y: p.pontoY * h, r: 6, color: '#fbbf24' });
    }
    ctx.metrics['máscaras'] = visiveis.length;
    if (!visiveis.length) return clone(src);

    const out = alloc(w, h);
    const od = out.data;
    od.set(src.data);
    visiveis.forEach((m, idx) => {
      const rgb = hexToRgb(colorFor(idx));
      const region = { x0: (m.box.x1 * w - 3) | 0, y0: (m.box.y1 * h - 3) | 0, x1: (m.box.x2 * w + 4) | 0, y1: (m.box.y2 * h + 4) | 0 };
      paintMask(od, w, h, m.logit, M, M, rgb, p.alpha, region);
      if (p.contorno) contorno(od, w, h, m.logit, rgb, region);
      ctx.overlay.push({ type: 'rect', x: m.box.x1 * w, y: m.box.y1 * h, w: (m.box.x2 - m.box.x1) * w, h: (m.box.y2 - m.box.y1) * h,
                         color: colorFor(idx), label: `${m.name} · ${(m.iou * 100) | 0}%` });
    });
    ctx.masks = visiveis.map((m) => ({ name: m.name, iou: m.iou, box: m.box, area: m.area, presence: m.obj }));
    if (seguir) ctx.track = { ...visiveis[0].box, name: visiveis[0].name, iou: visiveis[0].iou };
    return out;
  },
};

// o ponto do objeto, arrastável no vídeo (cv/regioes.js)
registrarRegiao('sam2.seguir', {
  chave: 'ponto', nome: 'SAM 2 · ponto do objeto', tipo: 'ponto', cor: '#fbbf24', ferramentas: ['ponto'], campos: ['pontoX', 'pontoY'],
  ler: (p) => (p.alvo === 'ponto na imagem' ? [[p.pontoX, p.pontoY]] : null),
  gravar: (p, pts) => ({ pontoX: Math.round(pts[0][0] * 1000) / 1000, pontoY: Math.round(pts[0][1] * 1000) / 1000 }),
});

export default [sam2Seguir];
