/**
 * operators/livres-q/epi.js — epi.monitor (CV-48 Monitor de EPI, estágio 1 sem treino).
 *
 *   1. PESSOAS: a pose multi-pessoa da cadeia (ctx.poses, Pose RTMO antes) ou o
 *      próprio RTMO (o mesmo do Takt); ID da sessão pelo rastreio por caixa.
 *   2. RECORTES pelos pontos da pose: CABEÇA (nariz, olhos, orelhas; a caixa sobe
 *      ~1,3 cabeça acima dos olhos para pegar o capacete) e TRONCO (ombros →
 *      quadris, com folga lateral para o colete).
 *   3. CLIP: cada recorte contra duas frases ("com" | "sem", configuráveis) no
 *      MobileCLIP2 (CV-15); p(com) vira um VOTO da pessoa. Poucas pessoas por
 *      vez, em rodízio (a de voto mais antigo primeiro), pela fila única do ONNX.
 *   4. VOTAÇÃO temporal por pessoa rastreada (runtime/livres-q/canal.js ›
 *      decidir): conforme, não conforme, incerto ou verificando.
 *   5. ZONAS: áreas das Ferramentas de mouse com a função "Zona de contagem";
 *      o pé da pessoa decide a zona. Sem zona, o quadro inteiro.
 *   6. PRIVACIDADE: com "Borrar rostos" (padrão) o operador devolve o quadro com
 *      o ROSTO borrado (olhos → queixo, pelos pontos da pose — sem detector
 *      facial nem reconhecimento); o topo da cabeça fica visível porque é ali
 *      que está o capacete. O CLIP vê o quadro original, nada sai do aparelho.
 *
 * Estágio 2: "Coletar amostra" no painel guarda o quadro (borrado) com as
 * caixas já rotuladas pela votação e "Enviar ao +Projeto" leva ao Treinar
 * (RF-DETR livre). Detalhes em runtime/livres-q/canal.js.
 */
import { clone } from '../../core.js';
import { MODELS, run, runFeeds, makeTensor, ensureOrt } from '../../runtime/onnx.js';
import { toTensorData } from '../../runtime/tensor.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { loadClipTokenizer } from '../../runtime/clip_tokenizer.js';
import { AREAS } from '../../marcacoes.js';
import { obterPoses } from '../livres-m/privacidade.js';
import { poligonoDe } from '../livres-m/takt.js';
import { Rastreador } from '../../runtime/livres-f/ergonomia.js';
import { borrarRegioes } from '../../runtime/livres-m/takt-nucleo.js';
import { canalEpi, decidir, geral, ITENS, ROTULO_ITEM, COR_ESTADO, ESTADOS } from '../../runtime/livres-q/canal.js';

const G = 'CV-48';
const PADRAO_CAPACETE = 'a photo of a worker wearing a hard hat | a photo of a person with a bare head, no helmet';
const PADRAO_COLETE = 'a photo of a person wearing a high-visibility reflective safety vest | a photo of a person in ordinary clothes, no safety vest';

// ---------------------------------------------------------------- texto (cache por frase)
const textCache = new Map();
function norm(v) { let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / s; return o; }
async function encodeText(frase) {
  if (textCache.has(frase)) return textCache.get(frase);
  const tok = await loadClipTokenizer();
  const ort = await ensureOrt();
  const ids = BigInt64Array.from(Array.from(tok.encodeClip(frase, 77), (v) => BigInt(v)));
  const out = await runFeeds('mclip2-text', { input_ids: new ort.Tensor('int64', ids, [1, 77]) });
  const v = norm(out[Object.keys(out)[0]].data);
  textCache.set(frase, v);
  return v;
}
/** "frase com | frase sem" → [com, sem]. */
export function lerPar(txt, padrao) {
  const p = String(txt || '').split('|').map((s) => s.trim()).filter(Boolean);
  return p.length >= 2 ? [p[0], p[1]] : String(padrao).split('|').map((s) => s.trim());
}

// ---------------------------------------------------------------- geometria (0–1 do quadro)
const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const caixa = (x1, y1, x2, y2) => ({ x1: cl(x1), y1: cl(y1), x2: cl(x2), y2: cl(y2) });

/** Caixas de cabeça e tronco a partir da pose (keypoints COCO normalizados) e da caixa da pessoa. asp = w/h do quadro. */
export function recortesDaPose(q, asp, minConf = 0.3) {
  const k = q.keypoints, b = q.box;
  const ok = (i) => k[i] && k[i].score >= minConf;
  const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
  // cabeça
  const cab = [0, 1, 2, 3, 4].filter(ok).map((i) => k[i]);
  let cabeca;
  if (cab.length >= 2) {
    const xs = cab.map((p) => p.x), ys = cab.map((p) => p.y);
    const cx = xs.reduce((a, c) => a + c, 0) / xs.length, cy = ys.reduce((a, c) => a + c, 0) / ys.length;
    const ombros = ok(5) && ok(6) ? Math.abs(k[5].x - k[6].x) : 0;
    // tamanho da cabeça (em x do quadro): orelhas/olhos, ou ~45 % da largura dos ombros, ou 18 % da altura da pessoa
    const lado = Math.max(Math.max(...xs) - Math.min(...xs), ombros * 0.45, (bh * 0.16) / asp);
    const ry = lado * asp;    // a mesma medida no eixo y
    cabeca = caixa(cx - lado * 0.95, cy - ry * 1.55, cx + lado * 0.95, cy + ry * 0.75);
  } else cabeca = caixa(b.x1 + bw * 0.15, b.y1 - bh * 0.04, b.x2 - bw * 0.15, b.y1 + bh * 0.2);
  // tronco
  let tronco = null;
  if (ok(5) && ok(6)) {
    const ys = [k[5].y, k[6].y], xs = [k[5].x, k[6].x];
    let y2 = b.y1 + bh * 0.6;
    if (ok(11) || ok(12)) { const hs = [11, 12].filter(ok).map((i) => k[i].y); y2 = Math.max(...hs); xs.push(...[11, 12].filter(ok).map((i) => k[i].x)); }
    const x1 = Math.min(...xs), x2 = Math.max(...xs), larg = Math.max(x2 - x1, bw * 0.3);
    tronco = caixa(x1 - larg * 0.18, Math.min(...ys) - (y2 - Math.min(...ys)) * 0.08, x2 + larg * 0.18, y2 + (y2 - Math.min(...ys)) * 0.06);
  } else tronco = caixa(b.x1 + bw * 0.1, b.y1 + bh * 0.2, b.x2 - bw * 0.1, b.y1 + bh * 0.6);
  return { cabeca, tronco };
}

/** Região do ROSTO (px) a borrar: dos olhos ao queixo — o topo da cabeça (capacete) fica visível. */
export function regiaoRosto(q, w, h, minConf = 0.3) {
  const k = q.keypoints;
  const pts = [0, 1, 2, 3, 4].filter((i) => k[i] && k[i].score >= minConf).map((i) => [k[i].x * w, k[i].y * h]);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = xs.reduce((a, c) => a + c, 0) / xs.length, cy = ys.reduce((a, c) => a + c, 0) / ys.length;
  const r = Math.max(6, (Math.max(...xs) - Math.min(...xs)) * 0.75, (q.box.x2 - q.box.x1) * w * 0.12);
  return [Math.trunc(cx - r), Math.trunc(cy - r * 0.55), Math.trunc(cx + r), Math.trunc(cy + r * 1.05)];
}

function dentro(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) c = !c;
  }
  return c;
}

let canvasQ = null, canvasR = null;
const novoCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

/** Recortes → tensores do CLIP (o quadro vai ao canvas uma vez só). */
function tensoresDosRecortes(src, recs, spec) {
  if (!canvasQ || canvasQ.width !== src.width || canvasQ.height !== src.height) canvasQ = novoCanvas(src.width, src.height);
  canvasQ.getContext('2d', { willReadFrequently: true }).putImageData(src, 0, 0);
  const S = spec.input[2];
  if (!canvasR) canvasR = novoCanvas(S, S);
  const g = canvasR.getContext('2d', { willReadFrequently: true });
  return recs.map((c) => {
    const x = c.x1 * src.width, y = c.y1 * src.height, w = Math.max(2, (c.x2 - c.x1) * src.width), hh = Math.max(2, (c.y2 - c.y1) * src.height);
    // quadrado centrado no recorte (o CLIP espera imagem quadrada; o fundo é preto)
    const lado = Math.max(w, hh), ox = x + w / 2 - lado / 2, oy = y + hh / 2 - lado / 2;
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.drawImage(canvasQ, ox, oy, lado, lado, 0, 0, S, S);
    return toTensorData(g.getImageData(0, 0, S, S), spec);
  });
}

async function jpegDe(img) {
  const c = novoCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  return c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }) : new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
}

export const epiMonitor = {
  op: 'epi.monitor',
  label: 'EPI — capacete e colete (sem treino)',
  group: G,
  model: 'mclip2-visual',
  overlayOnly: false,     // devolve o quadro com o rosto borrado quando "Borrar rostos" está ligado
  desc: 'Monitor de EPI sem treino: a pose RTMO recorta cabeça e tronco de cada pessoa e o MobileCLIP2 compara com ' +
        'frases (com/sem capacete, com/sem colete — configuráveis); votação no tempo por pessoa rastreada, ' +
        'conformidade por zona (áreas "Zona de contagem"), eventos e rosto borrado (LGPD). "Coletar amostra" e ' +
        '"Enviar ao +Projeto" no painel EPI preparam o estágio 2 (detector treinado no Treinar).',
  params: {
    verificar: { type: 'enum', options: ['capacete e colete', 'só capacete', 'só colete'], default: 'capacete e colete', label: 'Verificar' },
    capacete: { type: 'text', default: PADRAO_CAPACETE, max: 300, label: 'Capacete: frase COM | frase SEM' },
    colete: { type: 'text', default: PADRAO_COLETE, max: 300, label: 'Colete: frase COM | frase SEM' },
    janela: { type: 'int', min: 3, max: 40, step: 1, default: 9, label: 'Votos por decisão (janela)' },
    limiar: { type: 'float', min: 0.5, max: 0.95, step: 0.05, default: 0.65, label: 'Fração de votos para decidir' },
    borrar: { type: 'bool', default: true, label: 'Borrar rostos (LGPD)' },
    porVez: { type: 'int', min: 1, max: 8, step: 1, default: 3, label: 'Pessoas por passada do CLIP' },
    conf: { type: 'float', min: 0.05, max: 0.95, step: 0.05, default: 0.3, label: 'Score mín. da pessoa' },
    maxPessoas: { type: 'int', min: 1, max: 30, step: 1, default: 12, label: 'Máx. pessoas' },
    everyMs: { type: 'int', min: 0, max: 3000, step: 50, default: 250, label: 'Intervalo mín. do CLIP (ms)' },
    desenhar: { type: 'bool', default: true, label: 'Caixas e estado no vídeo' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const poses = obterPoses(src, state, ctx, { conf: p.conf, maxPessoas: p.maxPessoas, everyMs: 0 }).poses
      .filter((q) => q.box && (q.score == null || q.score >= p.conf)).slice(0, p.maxPessoas);
    if (!state.rast) { state.rast = new Rastreador(2500); state.votos = new Map(); state.vez = new Map(); state.ger = canalEpi.geracao(); }
    if (state.ger !== canalEpi.geracao()) { state.ger = canalEpi.geracao(); state.votos.clear(); state.vez.clear(); state.rast.zerar(); }
    const agora = performance.now();
    const ids = state.rast.atualizar(poses.map((q) => q.box), agora);
    const itens = p.verificar === 'só capacete' ? ['capacete'] : p.verificar === 'só colete' ? ['colete'] : ITENS;
    const asp = w / h;
    const pessoas = poses.map((q, i) => ({ id: ids[i], q, ...recortesDaPose(q, asp) }));

    // ---- CLIP (modelos sob demanda; o resto do operador funciona enquanto baixam)
    const prontos = ensure('mclip2-visual', state, ctx) && ensure('mclip2-text', state, ctx);
    if (prontos) {
      const pares = { capacete: lerPar(p.capacete, PADRAO_CAPACETE), colete: lerPar(p.colete, PADRAO_COLETE) };
      const chave = JSON.stringify(pares);
      if (state.chaveTxt !== chave && !state.codificando) {
        state.codificando = true;
        (async () => {
          const v = {};
          for (const it of ITENS) v[it] = [await encodeText(pares[it][0]), await encodeText(pares[it][1])];
          state.vecs = v; state.chaveTxt = chave; state.votos.clear();
        })().catch((e) => { state.error = String(e.message || e); }).finally(() => { state.codificando = false; });
      }
      if (state.vecs) {
        const spec = MODELS['mclip2-visual'];
        const escala = spec.logitScale || 64.33;
        if (!state.clip) state.clip = {};
        schedule(state.clip, p.everyMs,
          () => {
            if (!pessoas.length || ctx.fonteParada) return null;
            // rodízio: quem votou há mais tempo primeiro
            const fila = pessoas.slice().sort((a, b) => (state.vez.get(a.id) || 0) - (state.vez.get(b.id) || 0)).slice(0, p.porVez);
            const recs = [], meta = [];
            for (const pe of fila) {
              state.vez.set(pe.id, agora);
              for (const it of itens) { recs.push(it === 'capacete' ? pe.cabeca : pe.tronco); meta.push({ id: pe.id, item: it }); }
            }
            return { tensores: tensoresDosRecortes(src, recs, spec), meta, vecs: state.vecs };
          },
          async ({ tensores, meta, vecs }) => {
            const out = [];
            for (let k = 0; k < tensores.length; k++) {
              const r = await run('mclip2-visual', await makeTensor(tensores[k], spec.input));
              const e = norm(r[Object.keys(r)[0]].data);
              const [vs, vn] = vecs[meta[k].item];
              let a = 0, b = 0;
              for (let i = 0; i < e.length; i++) { a += e[i] * vs[i]; b += e[i] * vn[i]; }
              const pSim = 1 / (1 + Math.exp(-(a - b) * escala));
              out.push({ ...meta[k], p: pSim });
            }
            return out;
          });
        const R = state.clip.results;
        if (R && R !== state.ultRes) {
          state.ultRes = R;
          for (const r of R) {
            let v = state.votos.get(r.id);
            if (!v) state.votos.set(r.id, (v = { capacete: [], colete: [], ult: 0 }));
            v[r.item].push(r.p); if (v[r.item].length > 60) v[r.item].shift();
            v.ult = agora;
          }
          for (const [id, v] of state.votos) if (agora - v.ult > 20000 && !pessoas.some((x) => x.id === id)) state.votos.delete(id);
        }
        if (state.clip.inferMs) ctx.metrics['epi clip ms'] = state.clip.inferMs.toFixed(0);
        if (state.clip.error) ctx.metrics['epi erro'] = state.clip.error;
      } else ctx.metrics['epi'] = 'codificando as frases…';
    }

    // ---- decisão, zonas e publicação
    const mq = ctx.marcacoes;
    const zonas = mq ? mq.itens.filter((it) => it.funcao === 'zona' && AREAS.has(it.tipo)).map((it) => ({ nome: it.nome || 'Zona', poly: poligonoDe(it) })) : [];
    const lista = pessoas.map((pe) => {
      const v = state.votos.get(pe.id) || { capacete: [], colete: [] };
      const dec = {};
      for (const it of itens) dec[it] = decidir(v[it], { janela: p.janela, limiar: p.limiar });
      const k = pe.q.keypoints;
      const pes = [15, 16].filter((i) => k[i] && k[i].score >= 0.3).map((i) => k[i]);
      const pe0 = pes.length ? [pes.reduce((a, c) => a + c.x, 0) / pes.length, Math.max(...pes.map((c) => c.y))] : [(pe.q.box.x1 + pe.q.box.x2) / 2, pe.q.box.y2];
      const z = zonas.find((zz) => dentro(pe0[0], pe0[1], zz.poly));
      return { id: pe.id, zona: zonas.length ? (z ? z.nome : 'fora das zonas') : 'Quadro inteiro', itens: dec, geral: geral(dec),
        caixa: pe.q.box, cabeca: pe.cabeca, tronco: pe.tronco, pe: pe0 };
    });
    const nomesZonas = zonas.length ? [...zonas.map((z) => z.nome), 'fora das zonas'] : ['Quadro inteiro'];

    // ---- privacidade: rosto borrado (olhos → queixo)
    let out;
    if (p.borrar) {
      out = clone(src);
      const regs = poses.map((q) => regiaoRosto(q, w, h)).filter(Boolean);
      borrarRegioes(out, regs);
    } else out = clone(src);

    canalEpi.publicar({ t: agora, tWall: agora, w, h, pessoas: lista, zonas: nomesZonas, itens, borrado: Boolean(p.borrar), modelos: prontos });

    // amostra para o +Projeto (pedida no painel): o quadro (borrado) e as caixas rotuladas pela votação
    if (canalEpi.pedidos() > 0 && !state.salvando) {
      state.salvando = true;
      const caixas = [];
      for (const pe of lista) {
        const c = pe.itens.capacete, v = pe.itens.colete;
        if (c && (c.estado === ESTADOS.conforme || c.estado === ESTADOS.nao)) caixas.push({ classe: c.estado === ESTADOS.conforme ? 'capacete' : 'sem capacete', ...pe.cabeca });
        if (v && (v.estado === ESTADOS.conforme || v.estado === ESTADOS.nao)) caixas.push({ classe: v.estado === ESTADOS.conforme ? 'colete' : 'sem colete', ...pe.tronco });
      }
      const img = clone(out);
      jpegDe(img).then((blob) => canalEpi.guardarAmostra({ blob, caixas, w, h, quando: new Date().toISOString(), pessoas: lista.length }))
        .catch((e) => { state.error = String(e.message || e); canalEpi.guardarAmostra({ blob: null, caixas: [], erro: true }); })
        .finally(() => { state.salvando = false; });
    }

    // ---- métricas e desenho
    const nc = lista.filter((x) => x.geral === ESTADOS.nao).length, co = lista.filter((x) => x.geral === ESTADOS.conforme).length;
    ctx.metrics['EPI'] = `${lista.length} pessoa(s) · ${co} conforme(s) · ${nc} não conforme(s)`;
    if (p.desenhar) {
      for (const pe of lista) {
        const cor = COR_ESTADO[pe.geral];
        const b = pe.caixa;
        ctx.overlay.push({ type: 'rect', x: b.x1 * w, y: b.y1 * h, w: (b.x2 - b.x1) * w, h: (b.y2 - b.y1) * h, color: cor,
          label: `#${pe.id} ${pe.geral}` });
        for (const it of itens) {
          const c = it === 'capacete' ? pe.cabeca : pe.tronco, d = pe.itens[it];
          const ci = COR_ESTADO[d.estado];
          const sem = d.estado === ESTADOS.nao ? 'sem ' : d.estado === ESTADOS.conforme ? '' : '? ';
          ctx.overlay.push({ type: 'rect', x: c.x1 * w, y: c.y1 * h, w: (c.x2 - c.x1) * w, h: (c.y2 - c.y1) * h, color: ci,
            label: `${sem}${ROTULO_ITEM[it].toLowerCase()}${d.frac != null ? ` ${Math.round(d.frac * 100)}%` : ''}` });
        }
      }
      if (!prontos) ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'EPI: carregando o MobileCLIP2…' });
      else ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: nc ? '#FF6B5A' : '#4FB387', text: `EPI · ${lista.length} pessoa(s) · ${co} conforme(s) · ${nc} não conforme(s)${p.borrar ? ' · rostos borrados' : ''}` });
    }
    return out;
  },
};

export default [epiMonitor];
