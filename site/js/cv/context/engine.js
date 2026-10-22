/**
 * cv/context/engine.js — o motor do módulo Contexto.
 *
 * Quatro perguntas sobre a mesma cena, respondidas pelos modelos que já estão
 * instalados. Nada de API externa: tudo roda no dispositivo.
 *
 *   LER       PP-OCRv3 + CRNN         que texto aparece na imagem
 *   CONTAR    YOLOX (ou YOLO26)       quantos objetos, de cada tipo
 *   DESCREVER MobileNetV2 + detecção  o que é a cena, em uma frase
 *   ANALISAR  cruzamento dos três     o que isso significa
 *
 * ================== ONDE ESTÁ A INTELIGÊNCIA AQUI ==================
 *
 * Não é num modelo de linguagem — é no CRUZAMENTO. Detecção sozinha devolve
 * «3 pessoas, 1 laptop». OCR sozinho devolve «SAÍDA». Juntos, e sabendo QUAL
 * texto cai dentro de QUAL caixa, dá para dizer «placa de SAÍDA sobre a
 * porta, 3 pessoas na sala». É o passo BOUND do ciclo de vida, e é o que
 * separa listar de entender.
 *
 * A narrativa é gerada por regras, não por LLM. Isso tem uma vantagem que
 * importa num sistema de visão: ela NUNCA inventa. Se o detector não viu,
 * a frase não menciona. Um modelo de linguagem preencheria a lacuna com algo
 * plausível — que é exatamente o que não se quer em inspeção.
 * ===================================================================
 */

import { STATE, Observation } from './lifecycle.js';
import { MODELS, AGPL_MODELS, loadModel, isReady, run, makeTensor, agplAccepted } from '../runtime/onnx.js';
import { letterbox, stretch, toTensorData, softmax, topK, decodeYolox, unletterbox, ctcGreedy } from '../runtime/tensor.js';
import { COCO_CLASSES, CHARSET_EN, loadImagenetLabels } from '../runtime/labels.js';
import { detectFaces } from '../runtime/face.js';

export const TASKS = {
  read:     { label: 'LER',       models: ['ppocr_det', 'crnn'], icon: 'text' },
  count:    { label: 'CONTAR',    models: ['yolox'],             icon: 'count' },
  describe: { label: 'DESCREVER', models: ['mobilenetv2', 'yolox'], icon: 'eye' },
  analyze:  { label: 'ANALISAR',  models: [],                    icon: 'brain' },
};

/** Modelos exigidos pelas tarefas escolhidas, sem repetir. */
export function modelsFor(tasks) {
  const set = new Set();
  for (const t of tasks) for (const m of (TASKS[t] ? TASKS[t].models : [])) set.add(m);
  // ANALISAR não tem modelo próprio: cruza o resultado dos outros
  return Array.from(set);
}

export class ContextEngine {
  constructor() {
    this.observations = [];
    this.max = 30;
    this.listeners = new Set();
    this.busy = false;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.observations);
  }

  /**
   * Executa uma observação completa sobre um frame.
   * O ciclo de vida é percorrido de verdade, não simbolicamente: cada
   * transição só acontece quando o passo correspondente terminou.
   */
  async observe(image, { tasks = ['read', 'count', 'describe', 'analyze'], detector = 'yolox' } = {}) {
    if (this.busy) throw new Error('Já existe uma observação em andamento.');
    this.busy = true;

    const obs = new Observation({
      width: image.width, height: image.height, tasks, detector,
    });
    this.observations.unshift(obs);
    if (this.observations.length > this.max) {
      this.observations.length = this.max;
    }
    this.emit();

    try {
      // ---------------------------------------------------- CAPTURED → RESOLVED
      await this.#resolve(obs, image, tasks, detector);
      if (obs.state !== STATE.EXCEPTION) obs.to(STATE.RESOLVED);
      this.emit();

      // ---------------------------------------------------- → BOUND
      obs.bound = this.#bind(obs.raw, image);
      if (obs.state === STATE.EXCEPTION) obs.to(STATE.RESOLVED);   // retomada
      obs.to(STATE.BOUND);
      this.emit();

      // ---------------------------------------------------- → IN_PROCESS
      obs.to(STATE.IN_PROCESS);
      this.emit();
      obs.result = this.#synthesize(obs, tasks);

      // ---------------------------------------------------- → COMPLETED
      obs.to(STATE.COMPLETED);
      this.emit();
      return obs;
    } catch (err) {
      obs.problem('motor', err && err.message ? err.message : String(err));
      this.emit();
      return obs;
    } finally {
      this.busy = false;
    }
  }

  /** RESOLVED: roda os modelos. Falha de um não impede os outros. */
  async #resolve(obs, image, tasks, detector) {
    const need = modelsFor(tasks);
    for (const id of need) {
      if (!isReady(id)) {
        try {
          await loadModel(id);
        } catch (err) {
          obs.problem(id, 'não carregou: ' + err.message);
        }
      }
    }

    if (tasks.includes('count') || tasks.includes('describe')) {
      try {
        obs.raw.objects = await this.#detect(image, detector);
      } catch (err) {
        obs.problem('detecção', err.message);
        obs.raw.objects = [];
      }
    }
    if (tasks.includes('describe')) {
      try {
        obs.raw.scene = await this.#classify(image);
      } catch (err) {
        obs.problem('classificação', err.message);
      }
      try {
        obs.raw.faces = (await detectFaces(image, { conf: 0.75 })).length;
      } catch (_) {
        obs.raw.faces = null;   // face é opcional; não vira exceção
      }
    }
    if (tasks.includes('read')) {
      try {
        obs.raw.texts = await this.#read(image);
      } catch (err) {
        obs.problem('OCR', err.message);
        obs.raw.texts = [];
      }
    }
  }

  // ------------------------------------------------------------ modelos

  async #detect(image, which) {
    const useY26 = which === 'yolo26' && agplAccepted();
    const spec = useY26 ? AGPL_MODELS['yolo26n'] : MODELS.yolox;
    const id = useY26 ? 'yolo26n' : 'yolox';
    if (!isReady(id)) await loadModel(id);

    const S = spec.input[2];
    const lb = letterbox(image, S, S);
    const t = await makeTensor(toTensorData(lb.data, spec), spec.input);
    const out = await run(id, t);
    const o = out[Object.keys(out)[0]];

    if (useY26) {
      // saída end-to-end, já ordenada por score
      const d = o.data;
      const res = [];
      for (let i = 0; i < 300; i++) {
        const off = i * spec.stride;
        if (d[off + 4] < 0.35) break;
        res.push({
          x1: (d[off] - lb.dx) / lb.scale, y1: (d[off + 1] - lb.dy) / lb.scale,
          x2: (d[off + 2] - lb.dx) / lb.scale, y2: (d[off + 3] - lb.dy) / lb.scale,
          score: d[off + 4], cls: Math.round(d[off + 5]),
        });
      }
      return res;
    }
    return decodeYolox(o.data, o.dims, spec, 0.35, 0.45, 60)
      .map((b) => ({ ...unletterbox(b, lb), cls: b.classId }));
  }

  async #classify(image) {
    const spec = MODELS.mobilenetv2;
    if (!isReady('mobilenetv2')) await loadModel('mobilenetv2');
    const labels = await loadImagenetLabels();
    const t = await makeTensor(
      toTensorData(stretch(image, spec.input[3], spec.input[2]), spec), spec.input);
    const out = await run('mobilenetv2', t);
    const probs = softmax(out[Object.keys(out)[0]].data);
    return topK(probs, 3).map((r) => ({
      label: labels[r.index] || `classe ${r.index}`, score: r.score,
    }));
  }

  async #read(image) {
    const det = MODELS.ppocr_det, rec = MODELS.crnn;
    if (!isReady('ppocr_det')) await loadModel('ppocr_det');
    if (!isReady('crnn')) await loadModel('crnn');

    const S = det.input[2];
    const lb = letterbox(image, S, S, 0);
    const t = await makeTensor(toTensorData(lb.data, det), det.input);
    const out = await run('ppocr_det', t);
    const map = out[Object.keys(out)[0]].data;

    const boxes = boxesFromMap(map, S, S, 0.3, 120).slice(0, 10).map((b) => ({
      x1: (b.x1 - lb.dx) / lb.scale, y1: (b.y1 - lb.dy) / lb.scale,
      x2: (b.x2 - lb.dx) / lb.scale, y2: (b.y2 - lb.dy) / lb.scale,
    }));

    const { cropResize } = await import('../runtime/tensor.js');
    const found = [];
    for (const b of boxes) {
      const x = Math.max(0, b.x1), y = Math.max(0, b.y1);
      const w = Math.min(image.width - x, b.x2 - b.x1);
      const h = Math.min(image.height - y, b.y2 - b.y1);
      if (w < 6 || h < 6) continue;
      const crop = cropResize(image, x, y, w, h, rec.input[3], rec.input[2]);
      const rt = await makeTensor(toTensorData(crop, rec), rec.input);
      const ro = await run('crnn', rt);
      const rd = ro[Object.keys(ro)[0]];
      const dec = ctcGreedy(rd.data, rd.dims, CHARSET_EN);
      if (dec.text && dec.text.length >= 2) {
        found.push({ text: dec.text, score: dec.score, x1: x, y1: y, x2: x + w, y2: y + h });
      }
    }
    return found;
  }

  // ------------------------------------------------------------ BOUND

  /**
   * O passo que dá sentido: cruza os resultados soltos.
   *
   * - cada texto é associado ao objeto que mais o contém
   * - as detecções são agregadas por classe
   * - calcula-se ocupação e distribuição espacial
   */
  #bind(raw, image) {
    const objects = raw.objects || [];
    const texts = raw.texts || [];
    const area = image.width * image.height;

    // contagem por classe
    const counts = {};
    for (const o of objects) {
      const name = COCO_CLASSES[o.cls] || `classe ${o.cls}`;
      counts[name] = (counts[name] || 0) + 1;
    }

    // texto → objeto que o contém (maior sobreposição relativa ao texto)
    const anchored = texts.map((t) => {
      let best = null, bestFrac = 0;
      for (const o of objects) {
        const ix = Math.max(0, Math.min(t.x2, o.x2) - Math.max(t.x1, o.x1));
        const iy = Math.max(0, Math.min(t.y2, o.y2) - Math.max(t.y1, o.y1));
        const inter = ix * iy;
        const tArea = Math.max(1, (t.x2 - t.x1) * (t.y2 - t.y1));
        const frac = inter / tArea;
        if (frac > bestFrac) { bestFrac = frac; best = o; }
      }
      return {
        ...t,
        // 0,6 e não 1,0: caixa de texto raramente cai inteira dentro da do
        // objeto — a do OCR é apertada e a do detector, folgada
        on: bestFrac > 0.6 ? (COCO_CLASSES[best.cls] || null) : null,
        overlap: bestFrac,
      };
    });

    // ocupação e posição
    let occupied = 0;
    const zones = { esquerda: 0, centro: 0, direita: 0 };
    for (const o of objects) {
      occupied += Math.max(0, o.x2 - o.x1) * Math.max(0, o.y2 - o.y1);
      const cx = (o.x1 + o.x2) / 2 / image.width;
      zones[cx < 0.34 ? 'esquerda' : cx > 0.66 ? 'direita' : 'centro']++;
    }

    return {
      counts,
      total: objects.length,
      distinct: Object.keys(counts).length,
      texts: anchored,
      faces: raw.faces,
      scene: raw.scene || [],
      occupancy: Math.min(1, occupied / area),
      zones,
      largest: objects.length
        ? objects.reduce((a, b) =>
            (b.x2 - b.x1) * (b.y2 - b.y1) > (a.x2 - a.x1) * (a.y2 - a.y1) ? b : a)
        : null,
    };
  }

  // ------------------------------------------------------------ síntese

  #synthesize(obs, tasks) {
    const b = obs.bound;
    const out = { read: null, count: null, describe: null, analyze: null };

    if (tasks.includes('read')) {
      out.read = {
        found: b.texts.length,
        items: b.texts.map((t) => ({
          text: t.text.toUpperCase(),
          confianca: Math.round(t.score * 100),
          sobre: t.on,
        })),
        narrative: b.texts.length === 0
          ? 'Nenhum texto legível na imagem.'
          : b.texts.length === 1
            ? `Um texto legível: "${b.texts[0].text.toUpperCase()}"` +
              (b.texts[0].on ? ` — sobre ${artigo(b.texts[0].on)} ${b.texts[0].on}.` : '.')
            : `${b.texts.length} textos legíveis: ` +
              b.texts.map((t) => `"${t.text.toUpperCase()}"`).join(', ') + '.',
      };
    }

    if (tasks.includes('count')) {
      const pares = Object.entries(b.counts).sort((a, c) => c[1] - a[1]);
      out.count = {
        total: b.total,
        distinct: b.distinct,
        byClass: Object.fromEntries(pares),
        narrative: b.total === 0
          ? 'Nenhum objeto reconhecido.'
          : `${b.total} objeto${b.total > 1 ? 's' : ''} de ${b.distinct} tipo` +
            `${b.distinct > 1 ? 's' : ''}: ` +
            pares.map(([k, v]) => `${v} ${plural(k, v)}`).join(', ') + '.',
      };
    }

    if (tasks.includes('describe')) {
      out.describe = {
        scene: b.scene,
        faces: b.faces,
        occupancy: Math.round(b.occupancy * 100),
        narrative: descrever(b),
      };
    }

    if (tasks.includes('analyze')) {
      out.analyze = analisar(b, obs);
    }

    return out;
  }

  archive(id) {
    const o = this.observations.find((x) => x.id === id);
    if (o) { o.to(STATE.ARCHIVED); this.emit(); }
  }

  /** Retoma uma observação em EXCEPTION, sem refazer o que deu certo. */
  retry(id) {
    const o = this.observations.find((x) => x.id === id);
    if (!o || o.state !== STATE.EXCEPTION) return null;
    o.to(STATE.IN_PROCESS);
    o.result = this.#synthesize(o, o.meta.tasks);
    o.to(STATE.COMPLETED);
    this.emit();
    return o;
  }

  clear() {
    this.observations = [];
    this.emit();
  }
}

// ------------------------------------------------------------ narrativa

/**
 * Descrição em uma frase. Regras, não modelo de linguagem — o que garante
 * que nada seja afirmado sem que um detector tenha visto.
 */
function descrever(b) {
  const partes = [];

  if (b.scene.length && b.scene[0].score > 0.15) {
    partes.push(`A cena parece ${artigo(b.scene[0].label)} ${b.scene[0].label}`);
  }

  const pares = Object.entries(b.counts).sort((a, c) => c[1] - a[1]).slice(0, 3);
  if (pares.length) {
    const lista = pares.map(([k, v]) => v > 1 ? `${v} ${plural(k, v)}` : `${artigo(k)} ${k}`);
    partes.push((partes.length ? 'com ' : 'Há ') + juntar(lista));
  }

  if (b.faces) {
    partes.push(`${b.faces} rosto${b.faces > 1 ? 's' : ''} visível${b.faces > 1 ? 'eis' : ''}`);
  }

  if (b.total) {
    const z = Object.entries(b.zones).filter(([, v]) => v > 0).sort((a, c) => c[1] - a[1]);
    if (z.length === 1) partes.push(`tudo concentrado à ${z[0][0]}`);
    else if (z.length && z[0][1] > b.total * 0.6) partes.push(`a maior parte à ${z[0][0]}`);
  }

  if (b.occupancy > 0.55) partes.push('a cena está cheia');
  else if (b.total && b.occupancy < 0.08) partes.push('os objetos ocupam pouco do quadro');

  if (!partes.length) return 'Não há elementos reconhecíveis suficientes para descrever a cena.';
  return partes.join(', ').replace(/^(.)/, (c) => c.toUpperCase()) + '.';
}

/**
 * A análise. Cruza o que as outras três tarefas produziram e diz o que isso
 * SIGNIFICA — sempre marcando o nível de confiança, e sempre dizendo quando
 * não dá para concluir.
 */
function analisar(b, obs) {
  const achados = [];

  // pessoas
  const pessoas = b.counts['pessoa'] || 0;
  if (pessoas === 0 && b.total > 0) {
    achados.push({ tipo: 'ocupação', texto: 'Ambiente sem pessoas no enquadramento.', nivel: 'info' });
  } else if (pessoas === 1) {
    achados.push({ tipo: 'ocupação', texto: 'Uma pessoa presente.', nivel: 'info' });
  } else if (pessoas > 1) {
    achados.push({ tipo: 'ocupação', texto: `${pessoas} pessoas presentes.`, nivel: 'info' });
  }

  // rostos vs pessoas: divergência é informação, não erro
  if (b.faces !== null && b.faces !== undefined && pessoas > 0) {
    if (b.faces < pessoas) {
      achados.push({
        tipo: 'orientação',
        texto: `${pessoas} pessoa(s) detectada(s) mas ${b.faces} rosto(s) visível(eis) — ` +
               'alguém está de costas ou parcialmente ocluso.',
        nivel: 'atencao',
      });
    }
  }

  // texto ancorado é o achado mais forte
  const ancorados = b.texts.filter((t) => t.on);
  for (const t of ancorados) {
    achados.push({
      tipo: 'sinalização',
      texto: `Texto "${t.text.toUpperCase()}" está sobre ${artigo(t.on)} ${t.on}.`,
      nivel: 'destaque',
    });
  }
  const soltos = b.texts.filter((t) => !t.on);
  if (soltos.length) {
    achados.push({
      tipo: 'sinalização',
      texto: `${soltos.length} texto(s) sem objeto associado: ` +
             soltos.map((t) => `"${t.text.toUpperCase()}"`).join(', ') + '.',
      nivel: 'info',
    });
  }

  // densidade
  if (b.occupancy > 0.6) {
    achados.push({
      tipo: 'densidade',
      texto: `Objetos cobrem ${Math.round(b.occupancy * 100)}% do quadro. ` +
             'Cena congestionada: detecções podem se sobrepor.',
      nivel: 'atencao',
    });
  }

  // o que NÃO deu para saber importa tanto quanto o que deu
  if (obs.problems.length) {
    for (const p of obs.problems) {
      achados.push({
        tipo: 'limitação',
        texto: `${p.task} não respondeu (${p.message}). A análise está incompleta.`,
        nivel: 'erro',
      });
    }
  }
  if (!b.total && !b.texts.length) {
    achados.push({
      tipo: 'limitação',
      texto: 'Nem objetos nem texto foram reconhecidos. Verifique iluminação, ' +
             'foco e distância — ou a cena não contém nada do vocabulário dos modelos.',
      nivel: 'atencao',
    });
  }

  const conf = confianca(b, obs);
  return {
    achados,
    confianca: conf,
    narrative: achados.length
      ? achados.map((a) => a.texto).join(' ')
      : 'Nada digno de nota.',
  };
}

/** Confiança da análise, e o porquê dela — nunca só um número. */
function confianca(b, obs) {
  let score = 0.5;
  const razoes = [];

  if (obs.problems.length) {
    score -= 0.25 * obs.problems.length;
    razoes.push(`${obs.problems.length} modelo(s) falharam`);
  }
  if (b.total >= 3) { score += 0.15; razoes.push('vários objetos concordantes'); }
  if (b.total === 0) { score -= 0.2; razoes.push('nenhuma detecção'); }
  if (b.scene.length && b.scene[0].score > 0.4) {
    score += 0.15;
    razoes.push('classificação de cena firme');
  }
  if (b.texts.length && b.texts.every((t) => t.score > 0.7)) {
    score += 0.1;
    razoes.push('OCR com boa confiança');
  }
  if (b.occupancy > 0.6) { score -= 0.1; razoes.push('cena congestionada'); }

  score = Math.max(0.05, Math.min(0.95, score));
  return {
    valor: Math.round(score * 100),
    rotulo: score > 0.7 ? 'alta' : score > 0.45 ? 'média' : 'baixa',
    razoes,
  };
}

// ------------------------------------------------------------ português

const FEMININAS = new Set([
  'pessoa', 'bicicleta', 'moto', 'placa pare', 'mala', 'bola', 'pipa', 'garrafa',
  'taça', 'faca', 'colher', 'tigela', 'banana', 'maçã', 'laranja', 'cenoura',
  'pizza', 'rosquinha', 'cadeira', 'planta', 'cama', 'mesa', 'privada', 'tv',
  'geladeira', 'tesoura', 'zebra', 'girafa', 'ovelha', 'vaca', 'mochila', 'bolsa',
  'gravata', 'raquete', 'prancha de surf', 'luva de beisebol', 'quadra de tênis',
  'ponte', 'barragem', 'chaminé', 'rotatória', 'piscina', 'estrada', 'calçada',
]);

function artigo(nome) {
  return FEMININAS.has(nome) ? 'uma' : 'um';
}

/** Plural que funciona para o vocabulário COCO em português. */
function plural(nome, n) {
  if (n <= 1) return nome;
  return nome.split(' ').map((w, i) => (i === 0 ? pluralizar(w) : w)).join(' ');
}

function pluralizar(w) {
  if (/[aeiouáéíóúâêô]$/i.test(w)) return w + 's';
  if (/[rzn]$/i.test(w)) return w + 'es';
  if (/m$/i.test(w)) return w.slice(0, -1) + 'ns';
  if (/l$/i.test(w)) return w.slice(0, -1) + 'is';
  if (/s$/i.test(w)) return w;
  return w + 's';
}

function juntar(lista) {
  if (lista.length === 1) return lista[0];
  return lista.slice(0, -1).join(', ') + ' e ' + lista[lista.length - 1];
}

/** Componentes conexos sobre o mapa de probabilidade do detector de texto. */
function boxesFromMap(map, w, h, thresh, minArea) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const boxes = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || map[i] < thresh) continue;
    let head = 0, tail = 0;
    queue[tail++] = i; seen[i] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    while (head < tail) {
      const j = queue[head++];
      const y = (j / w) | 0, x = j - y * w;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && !seen[j - 1] && map[j - 1] >= thresh) { seen[j - 1] = 1; queue[tail++] = j - 1; }
      if (x < w - 1 && !seen[j + 1] && map[j + 1] >= thresh) { seen[j + 1] = 1; queue[tail++] = j + 1; }
      if (y > 0 && !seen[j - w] && map[j - w] >= thresh) { seen[j - w] = 1; queue[tail++] = j - w; }
      if (y < h - 1 && !seen[j + w] && map[j + w] >= thresh) { seen[j + w] = 1; queue[tail++] = j + w; }
    }
    if (area < minArea) continue;
    const px = Math.round((maxX - minX) * 0.08) + 2;
    const py = Math.round((maxY - minY) * 0.25) + 2;
    boxes.push({ x1: minX - px, y1: minY - py, x2: maxX + px, y2: maxY + py, area });
  }
  return boxes.sort((a, b) => b.area - a.area);
}
