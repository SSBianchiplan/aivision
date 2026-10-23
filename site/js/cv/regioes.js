/**
 * cv/regioes.js — REGIÕES DOS OPERADORES editáveis com o mouse (sem DOM).
 *
 * Vários operadores desenham geometria que vinha só de parâmetros (os cantos e as linhas da Quadra,
 * o radar, a linha de contagem do ByteTrack, o ponto do SAM 2, o piso do Takt, as ROIs fixas de um
 * programa do Inspect). Na tela ela era fixa: não dava para clicar, nem ajustar.
 *
 * Aqui cada operador DECLARA a sua geometria (`registrarRegiao`) e ela vira uma MARCAÇÃO LIGADA
 * (`item.vinc = { no, op, chave }`) em cv/marcacoes.js. Daí em diante vale tudo o que as marcações já
 * têm: selecionar, arrastar vértices e a forma, travar, apagar, desfazer/refazer e o menu de contexto
 * (components/marcacoes-vista.js) — sem duplicar código de edição. O que muda aqui:
 *
 *   parâmetro  ──ler()──►  marcação ligada  ──(o usuário arrasta)──►  gravar()  ──►  parâmetro
 *
 *  - a marcação ligada NÃO é salva com as marcações do usuário (salvar/exportar a pulam) e NÃO chega
 *    aos operadores em ctx.marcacoes: a verdade é o parâmetro do nó; ela é recriada dele;
 *  - a mudança grava no parâmetro a cada quadro de arrasto (ao vivo) — ou ao soltar (`aoSoltar`);
 *  - apagar a marcação chama `apagar()` (ex.: Quadra sem calibração); desfazer a devolve;
 *  - «Redefinir» volta à geometria padrão (`padrao()`), «Redesenhar com a ferramenta X» troca a
 *    geometria pela que o usuário desenhar em seguida com aquela ferramenta.
 *
 * Coordenadas: `ler`/`gravar`/`padrao` falam em 0–1 do QUADRO do pipeline (o recorte do zoom, com o
 * espelho) — o mesmo espaço dos parâmetros —, e a marcação guarda 0–1 da FONTE (como todas). A
 * conversão é a da vista (cv/marcacoes.js). `espaco: 'fonte'` pula a conversão (piso do Takt).
 *
 * Definição: registrarRegiao(op, {
 *   chave, nome, tipo: 'perspectiva'|'retangulo'|'linha'|'ponto'|'poligono', cor,
 *   ler(params, no) → pts | null,           padrao?(params, no) → pts (sempre oferecida, tracejada),
 *   gravar(params, pts, no) → patch dos params | null (efeito próprio),
 *   apagar?(params, no) → patch | null,     desenho?(pts, params) → [[x1,y1,x2,y2]] (linhas extras, 0–1 do quadro),
 *   ferramentas: ['perspectiva', …],        aoSoltar?: bool,   espaco?: 'quadro'|'fonte',
 *   campos?: ['linhaPts'] (params que a edição escreve; voltar à geometria padrão devolve os padrões deles),
 *   rotulos?: ['canto 1', …] (nome de cada vértice) })
 * `chave` pode ser função (params, no) → lista de chaves, para regiões repetidas (ferramentas do Inspect):
 * aí `ler/gravar/...` recebem a sub-chave como 3º argumento (`no.sub`).
 *
 * Custo: só reage a mudança de nós/zoom/espelho e de marcações (assinaturas dos stores), com
 * vínculos agrupados num quadro de animação; nada roda por quadro de vídeo.
 */
import { store, persist } from '../state/store.js';
import {
  marcStore, editarSemHistorico, vista, fonteParaVista, vistaParaFonte, novoId, rt, atualizar, selecionar, setFerramenta,
} from './marcacoes.js';
import { getOperator } from './registry.js';

const DEFS = new Map();          // op → [def]
const apagadas = new Set();      // chave da região que o usuário apagou (não volta sozinha)
/*
 * O que o vínculo pôs em cada marcação da última vez (id → pts). Fica FORA da marcação: desfazer e
 * refazer devolvem a marcação antiga, que difere daqui — e isso conta como edição (grava no parâmetro).
 */
const ultPts = new Map();
const tmp = [0, 0];

export function registrarRegiao(op, def) {
  if (!op || !def || !def.chave) return;
  const l = DEFS.get(op) || [];
  if (!l.some((d) => d.chave === def.chave)) l.push(def);
  DEFS.set(op, l);
  agendar();
}
export function regioesDe(op) { return DEFS.get(op) || []; }
export function temRegioes() { return DEFS.size > 0; }

const chaveDe = (v) => `${v.no}|${v.chave}${v.sub != null ? '|' + v.sub : ''}`;

/** A definição e o nó de uma marcação ligada (ou null). */
export function regiaoDoItem(it) {
  if (!it || !it.vinc) return null;
  const no = (store.get().nodes || []).find((n) => n.id === it.vinc.no);
  const def = regioesDe(it.vinc.op).find((d) => d.chave === it.vinc.chave);
  return no && def ? { no, def, sub: it.vinc.sub } : null;
}

// ------------------------------------------------------------- conversões

function quadroParaFonte(pts, def) {
  if (def.espaco === 'fonte') return pts.map((p) => [cl(p[0]), cl(p[1])]);
  return pts.map(([x, y]) => vistaParaFonte(x, y));
}
function fonteParaQuadro(pts, def) {
  if (def.espaco === 'fonte') return pts.map((p) => [p[0], p[1]]);
  return pts.map(([u, v]) => { fonteParaVista(u, v, tmp); return [tmp[0], tmp[1]]; });
}
const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function iguais(a, b, tol = 2e-4) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i][0] - b[i][0]) > tol || Math.abs(a[i][1] - b[i][1]) > tol) return false;
  return true;
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;
export const arred = (pts) => pts.map(([x, y]) => [r4(x), r4(y)]);

// ------------------------------------------------------------- vínculo parâmetro ⇄ marcação

let agendado = 0, persistT = 0;
function agendar() {
  if (agendado || typeof requestAnimationFrame !== 'function') return;
  agendado = requestAnimationFrame(() => { agendado = 0; try { sincronizar(); } catch (e) { console.warn('[regiões]', e); } });
}

function instancias(def, no) {
  if (typeof def.chave !== 'function') return [{ sub: undefined }];
  return (def.chave(no.params || {}, no) || []).map((sub) => ({ sub }));
}

/** O coração: params → marcações ligadas; marcação editada → params. */
let chaveVista = '';
const vistaChave = () => `${vista.W}|${vista.H}|${vista.sx}|${vista.sy}|${vista.sw}|${vista.sh}|${vista.fs}|${vista.fd}`;

/** Chamado a cada quadro pintado (marcacoes-vista): só compara a vista; muda o recorte → revincula. */
export function tique() {
  if (!DEFS.size || !vista.ok) return;
  const k = vistaChave();
  if (k !== chaveVista) agendar();
}

export function sincronizar() {
  if (!vista.ok || !DEFS.size) return;
  chaveVista = vistaChave();
  const st = marcStore.get();
  const nodes = store.get().nodes || [];
  const porChave = new Map();
  for (const it of st.itens) if (it.vinc) porChave.set(chaveDe(it.vinc), it);
  if (!porChave.size && !nodes.some((n) => n.enabled && DEFS.has(n.op))) return;

  const patches = new Map();       // id do nó → patch
  const criar = [], trocar = new Map(), vivos = new Set();
  for (const no of nodes) {
    if (!no.enabled) continue;
    const defs = DEFS.get(no.op);
    if (!defs) continue;
    const p = { ...defaultsDe(no.op), ...(no.params || {}) };
    for (const def of defs) {
      for (const { sub } of instancias(def, no)) {
        const noS = sub === undefined ? no : { ...no, sub };
        const vinc = { no: no.id, op: no.op, chave: def.chave, ...(sub !== undefined ? { sub } : {}) };
        const k = chaveDe(vinc);
        const it = porChave.get(k);
        if (apagadas.has(k)) {
          if (!it) continue;
          apagadas.delete(k);                 // desfazer do apagar: a marcação voltou
        }
        let alvoQ = null, padrao = false;
        try { alvoQ = def.ler(p, noS); } catch (_) { alvoQ = null; }
        if (!alvoQ && def.padrao) { try { alvoQ = def.padrao(p, noS); padrao = Boolean(alvoQ); } catch (_) { alvoQ = null; } }
        if (it) {
          vivos.add(it.id);
          // editada pelo usuário (pts ≠ o que o vínculo pôs da última vez)?
          const ult = ultPts.get(it.id);
          if (ult && !iguais(it.pts, ult, 1e-6)) {
            if (def.aoSoltar && rt.arrastando) continue;
            let patch = null, virouPadrao = false;
            try {
              // desfez até a geometria padrão (antes de qualquer ajuste): o parâmetro volta a «sem região»
              if (it.vinc.padrao && def.apagar && def.padrao) {
                const q = def.padrao(p, noS);
                virouPadrao = Boolean(q) && iguais(quadroParaFonte(q, def), it.pts);
              }
              if (!virouPadrao && def.campos) {
                // voltou à geometria dos parâmetros padrão (desfazer até o começo): devolve os padrões
                const pad = defaultsDe(no.op), p0 = { ...p };
                for (const c of def.campos) p0[c] = pad[c];
                let q0 = null;
                try { q0 = def.ler(p0, noS); } catch (_) { q0 = null; }
                if (q0 && iguais(quadroParaFonte(q0, def), it.pts, 5e-4)) { patch = {}; for (const c of def.campos) patch[c] = pad[c]; }
              }
              if (!patch) patch = virouPadrao ? def.apagar(p, noS) : def.gravar(p, fonteParaQuadro(it.pts, def), noS);
            } catch (e) { console.warn('[regiões] gravar', def.chave, e); }
            if (patch && typeof patch === 'object') patches.set(no.id, { ...(patches.get(no.id) || {}), ...patch });
            ultPts.set(it.id, it.pts);
            if (!virouPadrao && it.vinc.padrao) trocar.set(it.id, { ...it, vinc: { ...it.vinc, padrao: false } });
            continue;
          }
          if (!ult) ultPts.set(it.id, it.pts);
          if (!alvoQ) { trocar.set(it.id, null); continue; }
          const alvo = quadroParaFonte(alvoQ, def);
          if (!iguais(alvo, it.pts) || it.vinc.padrao !== padrao) { trocar.set(it.id, { ...it, pts: alvo, vinc: { ...it.vinc, padrao } }); ultPts.set(it.id, alvo); }
        } else if (alvoQ) {
          const pts = quadroParaFonte(alvoQ, def);
          const op = getOperator(no.op);
          const id = novoId();
          ultPts.set(id, pts);
          criar.push({
            id, tipo: def.tipo, funcao: 'regiao', pts,
            nome: `${def.nome}${sub !== undefined && def.nomeSub ? ' · ' + def.nomeSub(p, noS) : ''}`,
            cor: def.cor || '#FFD84D', visivel: true, classes: '',
            vinc: { ...vinc, padrao, rotulo: op ? op.label : no.op },
            ...(def.tipo === 'perspectiva' ? { n: 8 } : {}),
          });
        }
      }
    }
  }
  // marcações ligadas cujo nó saiu (ou foi desligado)
  for (const it of st.itens) if (it.vinc && !vivos.has(it.id) && !trocar.has(it.id)) trocar.set(it.id, null);
  for (const [id, n] of trocar) if (!n) ultPts.delete(id);
  if (criar.length || trocar.size) {
    editarSemHistorico((itens) => {
      const out = [];
      for (const it of itens) {
        if (!trocar.has(it.id)) { out.push(it); continue; }
        const n = trocar.get(it.id);
        if (n) out.push(n);
      }
      return out.concat(criar);
    });
    const s = marcStore.get();
    if (s.sel && !s.itens.some((i) => i.id === s.sel)) marcStore.set({ sel: null, selN: s.selN.filter((id) => s.itens.some((i) => i.id === id)) });
  }
  if (patches.size) {
    store.set({ nodes: (store.get().nodes || []).map((n) => (patches.has(n.id) ? { ...n, params: { ...n.params, ...patches.get(n.id) } } : n)) });
    clearTimeout(persistT);
    persistT = setTimeout(() => { try { persist(); } catch (_) { /* segue */ } }, 600);
  }
}

/** Params do nó com os padrões do operador (o que `ler/gravar` recebem). */
export function paramsDe(no) { return { ...defaultsDe(no.op), ...(no.params || {}) }; }

function defaultsDe(op) {
  const d = getOperator(op);
  const out = {};
  if (d && d.params) for (const [k, v] of Object.entries(d.params)) out[k] = v.default;
  return out;
}

// ------------------------------------------------------------- ações (menu, teclado)

/** O usuário apagou a marcação ligada: a região sai do operador (ou volta ao padrão). */
export function aoApagar(it) {
  const r = regiaoDoItem(it);
  if (!r) return true;
  const { no, def } = r;
  if (!def.apagar) return false;
  const k = chaveDe(it.vinc);
  if (def.apagar) {
    const p = { ...defaultsDe(no.op), ...(no.params || {}) };
    let patch = null;
    try { patch = def.apagar(p, r.sub === undefined ? no : { ...no, sub: r.sub }); } catch (_) { patch = null; }
    if (patch) store.set({ nodes: store.get().nodes.map((n) => (n.id === no.id ? { ...n, params: { ...n.params, ...patch } } : n)) });
  }
  apagadas.add(k);
  agendar();
  return true;
}

/** Volta a região ao padrão do operador (ou ao que o parâmetro tinha, sem padrão). */
export function redefinir(it) {
  const r = regiaoDoItem(it);
  if (!r) return false;
  const { no, def } = r;
  const p = { ...defaultsDe(no.op), ...(no.params || {}) };
  const noS = r.sub === undefined ? no : { ...no, sub: r.sub };
  const q = def.padrao ? def.padrao(p, noS) : def.ler(p, noS);
  if (!q) return false;
  // passa pelo caminho da edição: entra no desfazer e o vínculo grava no parâmetro
  atualizar(it.id, { pts: quadroParaFonte(q, def) });
  return true;
}

/** Pode apagar? (sem `apagar`, a região é obrigatória: só redefinir/ajustar) */
export function podeApagar(it) { const r = regiaoDoItem(it); return Boolean(r && r.def.apagar); }

/**
 * «Redesenhar com a ferramenta X»: a próxima forma desenhada com X vira a geometria desta região
 * (cv/marcacoes.js › criar consulta `rt.capturarCriacao`).
 */
export function redesenharCom(it, ferramenta) {
  const r = regiaoDoItem(it);
  if (!r) return false;
  const id = it.id;
  rt.capturarCriacao = (ferr, pts) => {
    if (ferr !== ferramenta) return null;
    rt.capturarCriacao = null;
    const alvo = ajustarPontos(r.def.tipo, pts);
    atualizar(id, { pts: alvo }); selecionar(id); setFerramenta('selecionar');
    return id;
  };
  return true;
}

/** Forma desenhada → pontos do tipo da região (retângulo → 4 cantos de perspectiva etc.). */
function ajustarPontos(tipo, pts) {
  if (tipo === 'perspectiva' && pts.length === 2) {
    const [a, b] = pts;
    return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  }
  if (tipo === 'retangulo' && pts.length > 2) {
    let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
    for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    return [[x1, y1], [x2, y2]];
  }
  if (tipo === 'linha' && pts.length > 2) return [pts[0], pts[pts.length - 1]];
  if (tipo === 'ponto' && pts.length > 1) return [pts[0]];
  return pts.map((p) => p.slice());
}

// ------------------------------------------------------------- ligação aos stores

rt.aoApagarRegiao = aoApagar;

if (typeof window !== 'undefined') {
  let nodesAnt = null, zoomAnt = null, mirrorAnt = null, itensAnt = null;
  store.subscribe((s) => {
    if (s.nodes === nodesAnt && s.zoom === zoomAnt && s.mirror === mirrorAnt) return;
    nodesAnt = s.nodes; zoomAnt = s.zoom; mirrorAnt = s.mirror;
    if (DEFS.size) agendar();
  });
  marcStore.subscribe((s) => {
    if (s.itens === itensAnt) return;
    itensAnt = s.itens;
    if (DEFS.size) agendar();
  });
}

/** Para fontes de geometria fora dos params (piso do Takt, programa do Inspect): pedir nova leitura. */
export function regioesMudaram() { agendar(); }
