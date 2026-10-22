/**
 * cv/operators/livres-b/florence.js — CV-21 Florence-2 base (Microsoft, MIT).
 *
 * Um modelo de visão-linguagem de 230M que faz, com o MESMO peso, o que aqui
 * exigiria quatro modelos: legenda curta ou detalhada da cena, detecção de
 * objetos de vocabulário livre (<OD>), OCR e "achar o que eu escrever"
 * (<CAPTION_TO_PHRASE_GROUNDING>). A tarefa é escolhida por um token de prompt.
 *
 * É PESADO: um codificador visual 768² e uma geração de dezenas de tokens —
 * 4 a 12 s por resposta no WASM de um notebook. Por isso:
 *   - roda num Web Worker próprio (runtime/livres-b/florence.js), não no ORT
 *     da página — o render nunca espera;
 *   - por intervalo (padrão 4 s), e o quadro desenha a última resposta.
 *
 * O modelo foi treinado em inglês: as legendas saem em inglês, e o texto de
 * busca rende melhor em inglês. Os nomes de objeto mais comuns são traduzidos
 * por dicionário (COCO e alguns extras) — o resto fica como veio.
 */
import { clone } from '../../core.js';
import { COCO_CLASSES } from '../../runtime/labels.js';
import { schedule, colorFor } from '../../runtime/opkit.js';
import { loadFlorence, runFlorence, florenceState } from '../../runtime/livres-b/florence.js';

const G = 'CV-21';

const TAREFAS = {
  'descrever (curto)': { task: '<CAPTION>', tokens: 40 },
  'descrever (detalhado)': { task: '<DETAILED_CAPTION>', tokens: 120 },
  'detectar objetos': { task: '<OD>', tokens: 256 },
  'ler texto (OCR)': { task: '<OCR>', tokens: 128 },
  'achar o que eu escrever': { task: '<CAPTION_TO_PHRASE_GROUNDING>', tokens: 96 },
};

// nomes em inglês do COCO, na ordem do COCO_CLASSES -> tradução direta
const COCO_EN = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse',
  'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie',
  'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon',
  'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut',
  'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
  'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book',
  'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'];
const PT = new Map(COCO_EN.map((e, i) => [e, COCO_CLASSES[i]]));
for (const [e, p] of [['man', 'homem'], ['woman', 'mulher'], ['boy', 'menino'], ['girl', 'menina'],
  ['child', 'criança'], ['people', 'pessoas'], ['table', 'mesa'], ['television', 'tv'], ['monitor', 'monitor'],
  ['window', 'janela'], ['door', 'porta'], ['wheel', 'roda'], ['tire', 'pneu'], ['building', 'prédio'],
  ['house', 'casa'], ['tree', 'árvore'], ['plant', 'planta'], ['flower', 'flor'], ['lamp', 'luminária'],
  ['light', 'luz'], ['box', 'caixa'], ['bag', 'bolsa'], ['shoe', 'sapato'], ['hat', 'chapéu'], ['helmet', 'capacete'],
  ['glasses', 'óculos'], ['shirt', 'camisa'], ['jacket', 'jaqueta'], ['glove', 'luva'], ['phone', 'celular'],
  ['mobile phone', 'celular'], ['computer', 'computador'], ['computer monitor', 'monitor'], ['desk', 'mesa'],
  ['shelf', 'prateleira'], ['cabinet', 'armário'], ['pillow', 'travesseiro'], ['blanket', 'cobertor'],
  ['sofa', 'sofá'], ['van', 'van'], ['motorbike', 'moto'], ['bike', 'bicicleta'], ['sign', 'placa'],
  ['pole', 'poste'], ['street light', 'poste de luz'], ['traffic sign', 'placa de trânsito'], ['kitten', 'gatinho'],
  ['puppy', 'filhote'], ['bottle cap', 'tampa'], ['pallet', 'palete'], ['forklift', 'empilhadeira'],
  ['ladder', 'escada'], ['stairs', 'escada'], ['wall', 'parede'], ['floor', 'chão'], ['ceiling', 'teto'],
  ['picture frame', 'quadro'], ['curtain', 'cortina'], ['mirror', 'espelho'], ['towel', 'toalha']]) PT.set(e, p);

function traduzir(nome) {
  const k = String(nome || '').trim().toLowerCase();
  return PT.get(k) || PT.get(k.replace(/s$/, '')) || nome;
}

/** Quebra o texto em linhas de até `n` caracteres, por palavra. */
function linhas(texto, n) {
  const out = [];
  let cur = '';
  for (const p of String(texto).split(/\s+/)) {
    if ((cur + ' ' + p).trim().length > n && cur) { out.push(cur); cur = p; } else cur = (cur + ' ' + p).trim();
  }
  if (cur) out.push(cur);
  return out;
}

export const florenceDescrever = {
  op: 'florence2.tarefa',
  label: 'Florence-2 — descrever, detectar e ler',
  group: G, model: 'florence2', overlayOnly: true,
  desc: 'Florence-2 base (Microsoft, MIT), 230 MB, no navegador: descreve a cena (curto ou ' +
        'detalhado), detecta objetos de vocabulário livre, lê texto (OCR) ou acha na imagem o ' +
        'que você escrever. Pesado: roda num worker a cada poucos segundos e o vídeo segue ' +
        'fluido. Responde em inglês; os nomes de objeto comuns são traduzidos.',
  params: {
    tarefa: { type: 'enum', options: Object.keys(TAREFAS), default: 'descrever (curto)', label: 'Tarefa' },
    texto: { type: 'text', default: 'a person', max: 120, label: 'O que achar (de preferência em inglês)' },
    everyMs: { type: 'int', min: 1000, max: 60000, step: 500, default: 4000, label: 'Intervalo mín. (ms)' },
    traduzir: { type: 'bool', default: true, label: 'Traduzir nomes de objeto' },
    caixas: { type: 'bool', default: true, label: 'Desenhar caixas' },
    largura: { type: 'int', min: 30, max: 140, step: 5, default: 70, label: 'Caracteres por linha do texto' },
  },
  apply(src, p, state, ctx) {
    const st = florenceState();
    if (st.status !== 'ready') {
      if (!state.pediu || st.status === 'idle') {
        state.pediu = true;
        loadFlorence().catch((err) => { state.errCarga = String(err && err.message ? err.message : err); });
      }
      const pct = Math.round(st.progress * 100);
      ctx.metrics.florence2 = st.status === 'error' || state.errCarga ? 'erro: ' + (st.error || state.errCarga)
        : pct > 0 && pct < 100 ? `baixando ${pct}%` : 'carregando…';
      return clone(src);
    }

    const t = TAREFAS[p.tarefa] || TAREFAS['descrever (curto)'];
    const comTexto = t.task === '<CAPTION_TO_PHRASE_GROUNDING>';
    // trocou de tarefa ou de texto: a resposta antiga não vale mais
    const chave = t.task + '|' + (comTexto ? p.texto : '');
    if (state.chave !== chave) { state.chave = chave; state.results = null; state.lastStart = 0; }

    schedule(state, p.everyMs,
      // cópia SÍNCRONA: o ImageData do quadro volta ao pool logo depois
      () => ({ data: new Uint8ClampedArray(src.data), width: src.width, height: src.height }),
      async (img) => {
        const r = await runFlorence(img, t.task, comTexto ? p.texto.trim() : '', t.tokens);
        const res = r.result;
        const out = { chave, task: r.task, ms: r.ms, texto: null, caixas: [] };
        if (typeof res === 'string') out.texto = res.trim();
        else if (res && res.bboxes) {
          out.caixas = res.bboxes.map((b, i) => ({
            x1: b[0] / img.width, y1: b[1] / img.height, x2: b[2] / img.width, y2: b[3] / img.height,
            en: (res.labels[i] || '').trim() || (comTexto ? p.texto.trim() : 'objeto'),
          }));
        }
        return out;
      });

    // resposta de uma tarefa anterior que terminou depois da troca: descarta
    const R = state.results && state.results.chave === chave ? state.results : null;
    if (state.inferMs) ctx.metrics['florence ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['florence erro'] = state.error;
    ctx.metrics['florence ep'] = st.ep;
    if (!R) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: state.busy ? 'Florence-2 pensando…' : 'Florence-2 pronto', color: '#8b8b93' });
      return clone(src);
    }

    const { w, h } = ctx;
    if (R.texto !== null) {
      const ls = linhas(R.texto || '(sem texto)', p.largura);
      ls.slice(0, 8).forEach((l, i) => ctx.overlay.push({ type: 'banner', x: 8, y: 8 + i * 22, text: l, color: i ? '#8b8b93' : '#FFD84D' }));
      ctx.caption = { task: R.task, text: R.texto };
      return clone(src);
    }

    const dets = R.caixas.map((b) => ({ ...b, name: p.traduzir ? traduzir(b.en) : b.en }));
    if (p.caixas) {
      // cor por nome: o mesmo objeto mantém a cor entre respostas
      const cores = new Map();
      dets.forEach((b) => {
        if (!cores.has(b.name)) cores.set(b.name, colorFor(cores.size));
        ctx.overlay.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: (b.x2 - b.x1) * w, h: (b.y2 - b.y1) * h,
                           color: cores.get(b.name), label: b.name });
      });
    }
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#FFD84D',
                       text: comTexto ? `"${p.texto}": ${dets.length ? dets.length + ' achado(s)' : 'não achei'}`
                                      : `${dets.length} objeto(s): ${[...new Set(dets.map((d) => d.name))].slice(0, 6).join(', ')}` });
    // Florence não dá score: 1 para quem ordena por confiança
    ctx.detections = dets.map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, score: 1, name: b.name }));
    ctx.metrics['objetos'] = dets.length;
    return clone(src);
  },
};

export default [florenceDescrever];
