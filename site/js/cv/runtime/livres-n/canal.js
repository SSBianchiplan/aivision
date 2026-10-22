/**
 * cv/runtime/livres-n/canal.js — o MOTOR do CV-40 Inspeção visual e a ponte
 * entre o operador e as telas (painel do hub e a tela cheia GPlanSiS|Inspect).
 *
 * Mora aqui, e não no estado do nó, tudo o que precisa sobreviver a apagar e
 * recriar o nó no Pipeline e que os botões das telas precisam alcançar:
 *
 *   programas   os programas (receitas) do usuário, versionados, guardados neste
 *               navegador POR USUÁRIO (localStorage 'aiv.inspect.programas:<usuário>')
 *   gatilho     o gatilho do programa ativo (presença, linha, intervalo, manual)
 *   inspeção    congela o quadro em resolução plena, alinha à golden (opcional),
 *               resolve as ROIs (marcações "Inspect · …" ou px do programa), roda as
 *               ferramentas e agrega o veredito (OK / NOK / INCERTO)
 *   histórico   as últimas 500 inspeções (resumo guardado por usuário; miniatura e
 *               JPEG da peça só em memória, nas 60 mais recentes)
 *   revisão     a fila de NOK/INCERTO sem decisão humana: "a máquina propõe, o
 *               humano confirma" (OK/NOK, classe do defeito, motivo, quem, quando)
 *   alarmes     sequência de NOK e taxa de INCERTO, com reconhecimento
 *   estatística contadores, taxa de refugo, rendimento, Cpk das medidas em mm
 *
 *   modelos     parte 2: as ferramentas com leitura/modelo (ocr, code, serial, detect,
 *               classify, anomaly) rodam ASSÍNCRONAS (fila do ORT, fora do laço de
 *               quadros); o veredito ESPERA por elas (prazo do programa; estourou =
 *               INCERTO). As peças fecham NA ORDEM em que foram disparadas.
 *   seriais     o registro de números de série por programa (o PK de
 *               insp.serial_registry do Inspect): repetido = NOK; o último número
 *               lido é o "anterior" da regra de sequência
 *
 * O operador (operators/livres-n/inspect.js) chama `quadro()` a cada quadro do
 * pipeline; as telas assinam com `assinar()` (no máximo 4×/s).
 *
 * Gancho de teste: as telas expõem window.aivInspect.
 */
import { rodarFerramenta, rodarFerramentaAssinc, ehAssinc, FERRAMENTAS, labMediana } from './ferramentas.js';
import { hojeLocal } from './marcacao.js';
import { calibrarClassificador } from './aprendidas.js';
import { agregar, resultado, OK, NOK, INCERTO, UNCERTAIN, FAIL } from './veredito.js';
import { criarGatilho, lumaEmGrade } from './gatilhos.js';
import {
  normalizarPrograma, novaVersao, deModelo, duplicar, importarTexto, exportarTexto, restaurarVersao, programaVazio,
  paraB64, deB64, MODELOS,
} from './programa.js';
import { buf, recorte, cinza, ncc } from './visao.js';
import { usuarioAtual, ouvir } from '../../../via/base.js';

const AREAS = new Set(['retangulo', 'poligono', 'elipse']);
const LINHAS = new Set(['linha', 'regua']);
const MAX_HIST = 500, MAX_IMAGENS = 60;

const ler = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } };
const agoraMs = () => performance.now();

const M = {
  usuario: null, programas: [], ativo: null,
  gatilho: null, gatChave: '', gatInfo: null,
  hist: [], seq: 0, ultimo: null, ultimoImg: null, selecionado: null,
  pedido: null, grab: null, largura: 1280, tQuadro: 0, marcacoes: null, procW: 0, procH: 0, espelhado: false,
  vivo: null, studio: false, status: '',
  alarmes: [], seguidosNok: 0, alarmeIncerto: false,
  cacheAssets: new Map(), cacheGolden: null, geo: {},
  seriais: {}, cadeia: Promise.resolve(), andamento: null,
};

// ------------------------------------------------------------------ usuário e persistência

const chave = (k) => `aiv.inspect.${k}:${M.usuario || 'anon'}`;

function carregarUsuario() {
  const u = usuarioAtual() || 'anon';
  if (u === M.usuario) return;
  M.usuario = u;
  let lista = [];
  try { lista = JSON.parse(ler(chave('programas')) || '[]') || []; } catch (_) { lista = []; }
  M.programas = lista.map(normalizarPrograma);
  const id = ler(chave('ativo'));
  M.ativo = M.programas.find((p) => p.id === id) || M.programas[0] || null;
  let h = [];
  try { h = JSON.parse(ler(chave('hist')) || '[]') || []; } catch (_) { h = []; }
  M.hist = Array.isArray(h) ? h.slice(0, MAX_HIST) : [];
  M.seq = M.hist.reduce((m, r) => Math.max(m, r.id || 0), 0);
  M.ultimo = M.hist[0] || null; M.ultimoImg = null; M.selecionado = null;
  M.gatilho = null; M.gatChave = '';
  M.alarmes = []; M.seguidosNok = 0;
  try { M.seriais = JSON.parse(ler(chave('seriais')) || '{}') || {}; } catch (_) { M.seriais = {}; }
  avisar(true);
  aquecer(M.ativo);
}
ouvir(() => carregarUsuario());

/** Começa a carregar os modelos das ferramentas do programa (a 1ª peça não espera o download). */
function aquecer(prog) {
  if (!prog || typeof document === 'undefined') return;
  const com = prog.tools.filter((t) => t.ativo && ehAssinc(t.type));
  if (!com.length) return;
  import('./modelos.js').then((Mo) => { for (const t of com) Mo.aquecer(t); }).catch(() => {});
}

function persistirProgramas() {
  if (!gravar(chave('programas'), JSON.stringify(M.programas))) M.status = 'Sem espaço no navegador para guardar os programas (moldes/golden grandes?).';
  if (M.ativo) gravar(chave('ativo'), M.ativo.id);
}

let tHist = 0;
function persistirHistorico() {
  clearTimeout(tHist);
  tHist = setTimeout(() => {
    const resumo = M.hist.map((r) => ({
      id: r.id, t: r.t, ms: r.ms, programa: r.programa, veredito: r.veredito, final: r.final, revisao: r.revisao,
      nFalhas: r.nFalhas, nIncertas: r.nIncertas, origem: r.origem, alinhamento: r.alinhamento, pxPorMm: r.pxPorMm, W: r.W, H: r.H,
      resultados: r.resultados.map((x) => ({ code: x.code, type: x.type, status: x.status, critical: x.critical, value: x.value, expected: x.expected, ms: x.ms,
        ...(x.detail && x.detail.eq_diam_mm != null ? { detail: { eq_diam_mm: x.detail.eq_diam_mm } } : {}) })),
    }));
    gravar(chave('hist'), JSON.stringify(resumo));
  }, 800);
}

// ------------------------------------------------------------------ assinantes

const ouvintes = new Set();
let timer = null, ultimoAviso = 0;
function avisar(ja = false) {
  const disparar = () => { ultimoAviso = agoraMs(); for (const f of ouvintes) { try { f(); } catch (_) { /* desmontando */ } } };
  if (ja) { clearTimeout(timer); timer = null; disparar(); return; }
  if (timer) return;
  timer = setTimeout(() => { timer = null; disparar(); }, Math.max(0, 250 - (agoraMs() - ultimoAviso)));
}
/** Assina as mudanças (no máximo 4×/s). Devolve a função que cancela. */
export function assinar(fn) { carregarUsuario(); ouvintes.add(fn); return () => ouvintes.delete(fn); }
export function avisarAgora() { avisar(true); }

// ------------------------------------------------------------------ programas

export function programas() { carregarUsuario(); return M.programas; }
export function programaAtivo() { carregarUsuario(); return M.ativo; }
export function status() { return M.status; }
export function definirStatus(t) { M.status = t; avisar(); }

export function ativar(id) {
  const p = M.programas.find((x) => x.id === id);
  if (!p) return;
  M.ativo = p; M.gatilho = null; M.gatChave = ''; M.seguidosNok = 0;
  persistirProgramas();
  M.status = `Programa ativo: ${p.codigo} — ${p.nome} (v${p.versao}).`;
  avisar(true);
  aquecer(p);
}

/** Grava `prog` como NOVA versão (substitui o de mesmo id) e o ativa. Devolve a versão gravada. */
export function salvar(prog, nota = '') {
  carregarUsuario();
  // ROIs ligadas a marcação: guarda a última caixa resolvida (em px da referência) para exportar ao Inspect
  for (const t of prog.tools) {
    const g = M.geo[t.code];
    if (!g || !t.marcacao) continue;
    if (!prog.imagem) prog.imagem = { w: g.W, h: g.H };
    const kx = prog.imagem.w / g.W, ky = prog.imagem.h / g.H;
    if (g.roi) t.roi = { x: Math.round(g.roi.x * kx), y: Math.round(g.roi.y * ky), w: Math.round(g.roi.w * kx), h: Math.round(g.roi.h * ky) };
    if (g.p0) { t.p0 = [Math.round(g.p0[0] * kx), Math.round(g.p0[1] * ky)]; t.p1 = [Math.round(g.p1[0] * kx), Math.round(g.p1[1] * ky)]; }
  }
  const nova = novaVersao(prog, { autor: M.usuario, nota });
  const i = M.programas.findIndex((p) => p.id === nova.id);
  if (i >= 0) M.programas[i] = nova; else M.programas.push(nova);
  M.ativo = nova; M.gatilho = null; M.gatChave = ''; M.cacheGolden = null;
  persistirProgramas();
  M.status = `${nova.codigo} salvo: v${nova.versao}.`;
  avisar(true);
  aquecer(nova);
  return nova;
}

export function criar(modelo = null) {
  carregarUsuario();
  const p = modelo ? deModelo(modelo) : programaVazio();
  return salvar(p, modelo ? `criado do modelo ${modelo}` : 'criado');
}

/** Preset do grupo Industrial: ativa (ou cria) o programa do modelo. */
export function garantirModelo(chaveModelo) {
  carregarUsuario();
  if (!MODELOS[chaveModelo]) return null;
  const p = M.programas.find((x) => x.modelo === chaveModelo);
  if (p) { if (M.ativo !== p) ativar(p.id); return p; }
  return criar(chaveModelo);
}

export function duplicarPrograma(id) {
  const p = M.programas.find((x) => x.id === id);
  if (!p) return null;
  const d = duplicar(p);
  M.programas.push(d);
  M.ativo = d; M.gatilho = null;
  persistirProgramas(); avisar(true);
  return d;
}

export function apagarPrograma(id) {
  M.programas = M.programas.filter((p) => p.id !== id);
  if (M.ativo && M.ativo.id === id) { M.ativo = M.programas[0] || null; M.gatilho = null; }
  persistirProgramas(); avisar(true);
}

export function importar(texto) {
  carregarUsuario();
  const p = importarTexto(texto);
  M.programas.push(p);
  M.ativo = p; M.gatilho = null;
  persistirProgramas();
  M.status = `Importado: ${p.codigo} — ${p.nome}.`;
  avisar(true);
  return p;
}
export function exportar(id, formato) {
  const p = M.programas.find((x) => x.id === id);
  return p ? exportarTexto(p, formato) : '';
}
export function restaurar(id, versao) {
  const p = M.programas.find((x) => x.id === id);
  if (!p) return null;
  return salvar(restaurarVersao(p, versao, M.usuario), `restaurada da v${versao}`);
}

// ------------------------------------------------------------------ quadro do pipeline

/** Último quadro pleno disponível (o grabFull do último quadro, na largura do operador). */
export function quadroPleno() {
  if (!M.grab) return null;
  try { return M.grab(M.largura); } catch (_) { return null; }
}
export function marcacoesAtuais() { return M.marcacoes; }
export function infoGatilho() { return M.gatInfo; }
export function quadroVivo() { return M.vivo; }
export function definirStudio(v) { M.studio = Boolean(v); }
export function studioAberto() { return M.studio; }
/** Há quadro do pipeline nos últimos `ms`? */
export function recente(ms = 2500) { return agoraMs() - M.tQuadro < ms; }

/** Caixa (0–1) da marcação de área → px do quadro w×h. */
function caixaPx(it, w, h) {
  const c = it.caixa;
  const x = Math.max(0, Math.floor(c.x1 * w)), y = Math.max(0, Math.floor(c.y1 * h));
  return { x, y, w: Math.max(1, Math.min(w, Math.ceil(c.x2 * w)) - x), h: Math.max(1, Math.min(h, Math.ceil(c.y2 * h)) - y) };
}

/** ROI do gatilho em px do quadro reduzido: marcação "Inspect · gatilho", a do programa (0–1) ou o centro. */
function roiGatilho(prog, w, h) {
  const mq = M.marcacoes;
  const it = mq && mq.itens.find((i) => i.funcao === 'ins_gatilho' && AREAS.has(i.tipo) && (!prog.trigger.marcacao || i.id === prog.trigger.marcacao))
    || (mq && mq.itens.find((i) => i.funcao === 'ins_gatilho' && AREAS.has(i.tipo)));
  if (it) return { ...caixaPx(it, w, h), marcacao: it.id };
  const r = Array.isArray(prog.trigger.roi) ? prog.trigger.roi : [0.25, 0.25, 0.5, 0.5];
  const x = Math.round(r[0] * w), y = Math.round(r[1] * h);
  return { x, y, w: Math.max(2, Math.min(w - x, Math.round(r[2] * w))), h: Math.max(2, Math.min(h - y, Math.round(r[3] * h))), marcacao: null };
}

/**
 * Chamado pelo operador a cada quadro. Atualiza o gatilho e, se ele disparar
 * (ou houver pedido manual), inspeciona. Devolve o registro novo ou null.
 */
export function quadro(src, ctx, p) {
  carregarUsuario();
  M.grab = ctx.grabFull || null;
  M.largura = p.largura || 1280;
  M.marcacoes = ctx.marcacoes || null;
  M.procW = src.width; M.procH = src.height; M.espelhado = Boolean(ctx.mirrored);
  M.tQuadro = agoraMs();
  if (M.studio) {
    if (!M.vivo || M.vivo.width !== src.width || M.vivo.height !== src.height) M.vivo = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data.length) };
    M.vivo.data.set(src.data);
    M.vivoT = M.tQuadro;
  }
  const prog = M.ativo;
  if (!prog) { M.gatInfo = null; return null; }
  const gk = prog.id + '|' + prog.versao + '|' + JSON.stringify(prog.trigger);
  if (!M.gatilho || M.gatChave !== gk) { M.gatilho = criarGatilho(prog.trigger); M.gatChave = gk; }
  const g = M.gatilho;
  const r = roiGatilho(prog, src.width, src.height);
  let dispara = false, origem = g.modo;
  if (g.modo !== 'manual' && r.w > 1 && r.h > 1) {
    // grade fixa (até 64 células por lado): o fundo não depende da resolução do pipeline
    const gw = Math.max(2, Math.min(64, Math.round((r.w / Math.max(r.w, r.h)) * 64))), gh = Math.max(2, Math.min(64, Math.round((r.h / Math.max(r.w, r.h)) * 64)));
    const luma = lumaEmGrade(src, r.x, r.y, r.w, r.h, Math.min(gw, r.w), Math.min(gh, r.h), buf('gat.luma', Float32Array, Math.min(gw, r.w) * Math.min(gh, r.h)));
    /*
     * O laço do app roda mais rápido que um vídeo de 10–30 fps: o MESMO quadro
     * chega várias vezes. Para o gatilho isso seria "movimento zero" e a peça
     * ainda deslizando contaria como assentada. Quadro idêntico (assinatura da
     * ROI igual) não atualiza o gatilho — ele anda em quadros da FONTE, como no
     * Inspect (um update por quadro da câmera).
     */
    let ass = 0;
    for (let i = 0; i < luma.length; i += 3) ass = (ass * 31 + Math.round(luma[i])) % 2147483647;
    const repetido = ass === M.gatAss;
    M.gatAss = ass;
    // intervalo com a fonte parada (YouTube pausado, histórico) não reinspeciona o mesmo quadro
    if (!repetido && !(g.modo === 'intervalo' && ctx.fonteParada)) dispara = g.atualizar(luma, Math.min(gw, r.w));
  }
  if (M.pedido) { dispara = true; origem = 'manual'; M.pedido = null; }
  M.gatInfo = { modo: g.modo, estado: g.estado, ocupacao: g.ocupacao || 0, roi: r, W: src.width, H: src.height, disparos: g.disparos };
  if (!dispara) { avisar(); return null; }
  const full = ctx.grabFull ? ctx.grabFull(M.largura) : null;
  let img = full && full.width >= src.width ? full : null;
  if (!img) { img = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) }; }
  return inspecionar(img, origem);
}

/** Testa um rascunho no quadro atual, sem registrar. { rec, img } ou erro (rec.pronto: Promise do fim). */
export function testar(prog) {
  const img = quadroPleno();
  if (!img) throw new Error('sem imagem: escolha a fonte e ligue o operador Inspeção no Pipeline');
  const rec = inspecionar(img, 'teste', { prog, registrar: false });
  if (!rec) throw new Error(M.status || 'nada a inspecionar');
  return { rec, img };
}
export function ultimoTeste() { return M.teste || null; }
export function limparTeste() { M.teste = null; avisar(true); }

/** Pede uma inspeção já (botão). Com o pipeline parado, inspeciona o quadro pleno direto. */
export function inspecionarAgora() {
  carregarUsuario();
  if (!M.ativo) { M.status = 'Nenhum programa ativo.'; avisar(true); return null; }
  if (recente(400)) { M.pedido = 'manual'; return null; }
  const img = quadroPleno();
  if (!img) { M.status = 'Sem imagem: ligue o operador Inspeção no Pipeline e escolha a fonte.'; avisar(true); return null; }
  return inspecionar(img, 'manual');
}

/** Rearma o gatilho (aprende o fundo de novo). */
export function rearmarGatilho() { if (M.gatilho) M.gatilho.reiniciar(); M.status = 'Gatilho rearmado: o fundo será aprendido de novo.'; avisar(true); }

// ------------------------------------------------------------------ resolução de ROI, px/mm, moldes

/** Marcação que serve a ferramenta `t` (ligada por id, por nome/código, ou a próxima livre da mesma função). */
export function marcacaoDe(prog, t, mq = M.marcacoes) {
  if (!mq || !mq.itens) return null;
  const def = FERRAMENTAS[t.type];
  if (!def) return null;
  const forma = def.roi === 'linha' ? LINHAS : AREAS;
  const serve = (i) => forma.has(i.tipo) && (def.roi !== 'area' || i.caixa);
  if (t.marcacao) { const i = mq.itens.find((x) => x.id === t.marcacao && serve(x)); if (i) return i; }
  const ligadas = new Set(prog.tools.filter((x) => x !== t && x.marcacao).map((x) => x.marcacao));
  const livres = mq.itens.filter((i) => i.funcao === def.funcao && serve(i) && !ligadas.has(i.id));
  const porNome = livres.find((i) => i.nome === t.code || i.nome === t.name);
  if (porNome) return porNome;
  const irmas = prog.tools.filter((x) => x.type === t.type && x.ativo && !(x.marcacao && mq.itens.some((i) => i.id === x.marcacao)));
  const k = irmas.indexOf(t);
  const semNome = livres.filter((i) => !prog.tools.some((x) => x.code === i.nome || x.name === i.nome));
  return k >= 0 ? semNome[k] || null : null;
}

/** Geometria da ferramenta no quadro `img` (sem alinhamento): { roi, rect (molde), p0, p1, marcacao }. */
export function geometria(prog, t, img) {
  const W = img.width, H = img.height;
  const it = marcacaoDe(prog, t);
  const kx = prog.imagem ? W / prog.imagem.w : 1, ky = prog.imagem ? H / prog.imagem.h : 1;
  const g = { marcacao: it ? it.id : null, roi: null, rect: null, p0: null, p1: null };
  if (FERRAMENTAS[t.type].roi === 'linha') {
    if (it) { g.p0 = [it.pts[0][0] * W, it.pts[0][1] * H]; g.p1 = [it.pts[1][0] * W, it.pts[1][1] * H]; }
    else { g.p0 = [t.p0[0] * kx, t.p0[1] * ky]; g.p1 = [t.p1[0] * kx, t.p1[1] * ky]; }
    return g;
  }
  if (it) g.rect = caixaPx(it, W, H);
  else if (t.roi) g.rect = { x: Math.round(t.roi.x * kx), y: Math.round(t.roi.y * ky), w: Math.round(t.roi.w * kx), h: Math.round(t.roi.h * ky) };
  g.roi = g.rect;
  // presença com a caixa do MOLDE desenhada: a busca é a caixa + folga (posição da peça varia)
  if (t.type === 'presence' && it && g.rect) {
    const f = Math.max(0, +t.folga || 0), r = g.rect;
    const mx = Math.round(r.w * f), my = Math.round(r.h * f);
    const x0 = Math.max(0, r.x - mx), y0 = Math.max(0, r.y - my);
    g.roi = { x: x0, y: y0, w: Math.min(W, r.x + r.w + mx) - x0, h: Math.min(H, r.y + r.h + my) - y0 };
  }
  return g;
}

/** px por mm no quadro `img`: o do programa (reescalado) ou o da régua calibrada. */
export function pxPorMm(prog, img) {
  if (prog.px_per_mm) return prog.px_per_mm * (prog.imagem ? img.width / prog.imagem.w : 1);
  const e = M.marcacoes && M.marcacoes.escala;
  if (e && e.mmPorPxQuadro && M.procW) return 1 / ((e.mmPorPxQuadro * M.procW) / img.width);
  return null;
}

/** Moldes decodificados (cinza) na escala do quadro `img`. */
function assetsPara(prog, img) {
  const out = {};
  for (const [k, a] of Object.entries(prog.assets || {})) {
    if (!a || !a.b64) continue;
    const ck = `${prog.id}|${k}|${a.b64.length}|${a.b64.slice(0, 32)}|${img.width}`;
    let v = M.cacheAssets.get(ck);
    if (!v) {
      const g = deB64(a.b64);
      const esc = a.W ? img.width / a.W : 1;
      if (Math.abs(esc - 1) < 1e-3) v = { g, w: a.w, h: a.h };
      else {
        // molde capturado noutra largura: reamostra (vizinho mais próximo) para a escala da inspeção
        const w = Math.max(1, Math.round(a.w * esc)), h = Math.max(1, Math.round(a.h * esc));
        const o = new Uint8Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = g[Math.min(a.h - 1, Math.floor(y / esc)) * a.w + Math.min(a.w - 1, Math.floor(x / esc))];
        v = { g: o, w, h };
      }
      if (M.cacheAssets.size > 32) M.cacheAssets.clear();
      M.cacheAssets.set(ck, v);
    }
    out[k] = v;
  }
  return out;
}

// ------------------------------------------------------------------ alinhamento (golden)

const LARG_GOLDEN = 320;

/** Cinza reduzido (média por célula) de img para w×h, num buffer do pool. */
function cinzaReduzido(img, w, h, nome) {
  const o = buf(nome, Uint8Array, w * h);
  const W = img.width, H = img.height, d = img.data;
  const kx = W / w, ky = H / h;
  for (let y = 0; y < h; y++) {
    const ya = Math.floor(y * ky), yb = Math.max(ya + 1, Math.floor((y + 1) * ky));
    for (let x = 0; x < w; x++) {
      const xa = Math.floor(x * kx), xb = Math.max(xa + 1, Math.floor((x + 1) * kx));
      let s = 0, n = 0;
      for (let yy = ya; yy < yb; yy += 2) for (let xx = xa; xx < xb; xx += 2) { const p = (yy * W + xx) * 4; s += (d[p] * 4899 + d[p + 1] * 9617 + d[p + 2] * 1868) >> 14; n++; }
      o[y * w + x] = n ? s / n : 0;
    }
  }
  return o;
}

/**
 * Translação da peça em relação à golden: NCC em pirâmide do miolo da golden
 * (a margem = deslocamento máximo) no quadro reduzido à mesma largura.
 * { ok, dx, dy (px do quadro), score, metodo }.
 */
export function alinhar(prog, img) {
  const G = prog.golden;
  if (!prog.alignment.enabled || !G) return { ok: true, dx: 0, dy: 0, score: null, metodo: 'nenhum' };
  if (!M.cacheGolden || M.cacheGolden.b64 !== G.b64) M.cacheGolden = { b64: G.b64, g: deB64(G.b64) };
  const gold = M.cacheGolden.g;
  const cur = cinzaReduzido(img, G.w, G.h, 'al.cur');
  const m = Math.min(0.4, Math.max(0.02, +prog.alignment.max_shift || 0.15));
  const tx = Math.round(G.w * m), ty = Math.round(G.h * m), tw = G.w - 2 * tx, th = G.h - 2 * ty;
  const tpl = buf('al.tpl', Uint8Array, tw * th);
  for (let y = 0; y < th; y++) tpl.set(gold.subarray((y + ty) * G.w + tx, (y + ty) * G.w + tx + tw), y * tw);
  const r = ncc(cur, G.w, G.h, tpl, tw, th);
  const minS = +prog.alignment.min_score || 0.5;
  return {
    ok: r.score >= minS, dx: ((r.x - tx) * img.width) / G.w, dy: ((r.y - ty) * img.height) / G.h,
    score: Math.round(r.score * 1000) / 1000, metodo: 'ncc_translation',
  };
}

// ------------------------------------------------------------------ inspeção

/** Spec pronta para rodar no quadro: geometria resolvida + deslocamento do alinhamento. */
function specResolvida(prog, t, img, al) {
  const g = geometria(prog, t, img);
  M.geo[t.code] = { ...g, W: img.width, H: img.height };
  const s = { ...t };
  if (g.p0) { s.p0 = [g.p0[0] + al.dx, g.p0[1] + al.dy]; s.p1 = [g.p1[0] + al.dx, g.p1[1] + al.dy]; }
  s.roi = g.roi ? { x: Math.round(g.roi.x + al.dx), y: Math.round(g.roi.y + al.dy), w: g.roi.w, h: g.roi.h } : null;
  return s;
}

// ------------------------------------------------------------------ registro de seriais

const MAX_SERIAIS = 5000;
const regSerial = (prog) => (M.seriais[prog.codigo] = M.seriais[prog.codigo] || { ultimo: null, itens: {} });
/** Último número da série do programa (o "anterior" da regra de sequência). */
export function ultimoSerial(prog) { return (M.seriais[prog.codigo] || {}).ultimo ?? null; }
function persistirSeriais() { gravar(chave('seriais'), JSON.stringify(M.seriais)); }
/** Zera o registro de seriais do programa (troca de série). */
export function zerarSeriais(prog) { delete M.seriais[prog.codigo]; persistirSeriais(); M.status = `Registro de seriais de ${prog.codigo} zerado.`; avisar(true); }

/**
 * _serial_registry do Inspect: cada serial lido entra no registro; se já
 * estava, a ferramenta vira NOK ("duplicado — já registrado em …"). O último
 * número inserido passa a ser o anterior da sequência.
 */
function registrarSeriais(prog, rec) {
  let mudou = false;
  for (const r of rec.resultados) {
    if (r.type !== 'serial' || !r.detail || !r.detail.serial) continue;
    const R = regSerial(prog);
    const ja = R.itens[r.detail.serial];
    if (ja) {
      r.status = FAIL;
      r.detail.reason = `serial duplicado — já registrado em ${ja}`;
    } else {
      R.itens[r.detail.serial] = rec.t;
      R.ultimo = r.detail.num ?? R.ultimo;
      const ks = Object.keys(R.itens);
      if (ks.length > MAX_SERIAIS) for (const k of ks.slice(0, ks.length - MAX_SERIAIS)) delete R.itens[k];
    }
    mudou = true;
  }
  if (mudou) persistirSeriais();
}

/**
 * Inspeciona `img` com o programa ativo (ou `prog`, no teste do editor):
 * registro com veredito, medidas e overlays. `registrar: false` = não entra
 * no histórico, nos contadores, nos alarmes nem no registro de seriais (teste
 * do rascunho).
 *
 * Só ferramentas clássicas: tudo síncrono, o registro volta pronto. Com
 * ferramenta de leitura/modelo: o registro volta PENDENTE (`pendente: true`,
 * `pronto`: Promise) com as clássicas já medidas; ao fim (todas respondidas
 * ou o prazo do programa estourado) ele recebe o veredito e entra no
 * histórico — na ordem dos disparos.
 */
export function inspecionar(img, origem = 'manual', { prog = M.ativo, registrar = true } = {}) {
  if (!prog) return null;
  const t0 = agoraMs();
  const al = alinhar(prog, img);
  const ativos = prog.tools.filter((t) => t.ativo && FERRAMENTAS[t.type]);
  if (!ativos.length) { M.status = 'O programa não tem ferramenta ativa.'; avisar(true); return null; }
  const ctxF = {
    pxPorMm: pxPorMm(prog, img), assets: assetsPara(prog, img),
    lote: prog.lote || null, hoje: hojeLocal(), ultimoSerial: () => ultimoSerial(prog),
  };
  const specs = ativos.map((t) => specResolvida(prog, t, img, al));
  const pend = [];
  const resultados = specs.map((s, i) => {
    if (!al.ok) return resultado(s, UNCERTAIN, { detail: { reason: `alinhamento falhou (NCC ${al.score})` }, overlays: s.roi ? [{ kind: 'roi', ...s.roi }] : [] });
    if (!ehAssinc(s.type)) return rodarFerramenta(img, s, ctxF);
    pend.push(i);
    return resultado(s, UNCERTAIN, { detail: { reason: 'lendo / rodando o modelo…' }, overlays: s.roi ? [{ kind: 'roi', ...s.roi }] : [], pendente: true });
  });
  const rec = {
    id: registrar ? ++M.seq : 0, t: new Date().toISOString(), ms: 0,
    programa: { id: prog.id, codigo: prog.codigo, nome: prog.nome, versao: prog.versao },
    veredito: null, final: null, revisao: null, nFalhas: 0, nIncertas: 0,
    resultados, origem, alinhamento: al, pxPorMm: ctxF.pxPorMm ? Math.round(ctxF.pxPorMm * 1e4) / 1e4 : null,
    W: img.width, H: img.height, mini: null, blob: null, pendente: pend.length > 0, v: 0,
  };
  const fechar = () => {
    if (registrar) registrarSeriais(prog, rec);
    const agg = agregar(rec.resultados);
    Object.assign(rec, { veredito: agg.veredito, final: agg.veredito, nFalhas: agg.nFalhas, nIncertas: agg.nIncertas, ms: Math.round(agoraMs() - t0), pendente: false });
    rec.v++;
    if (M.andamento === rec) M.andamento = null;
    if (!registrar) { M.teste = { rec, img }; avisar(true); return rec; }
    M.hist.unshift(rec);
    if (M.hist.length > MAX_HIST) M.hist.length = MAX_HIST;
    M.ultimo = rec; M.ultimoImg = img; M.selecionado = null;
    verificarAlarmes(prog, rec);
    M.status = `#${rec.id} ${rec.veredito} · ${rec.ms} ms · ${origem}`;
    imagens(rec, img);
    persistirHistorico();
    avisar(true);
    return rec;
  };
  if (!pend.length) return fechar();
  // com modelo: as leituras começam JÁ (a região é copiada na chamada); o fechamento segue a ordem dos disparos
  const prazo = Math.max(1, +prog.prazo_modelos_s || 20) * 1000;
  const leituras = pend.map((i) => rodarFerramentaAssinc(img, specs[i], ctxF, prazo).then((r) => { resultados[i] = r; rec.v++; avisar(); }));
  if (registrar) M.andamento = rec; else M.teste = { rec, img };
  const anterior = M.cadeia;
  rec.pronto = Promise.all(leituras).then(() => anterior).then(fechar);
  M.cadeia = rec.pronto.catch(() => {});
  M.status = `#${rec.id || 'teste'}: lendo ${pend.length} ferramenta(s) com modelo…`;
  avisar(true);
  return rec;
}

/** Inspeção esperando os modelos (null sem nada em andamento). */
export function emAndamento() { return M.andamento; }

/** Miniatura (200 px) e JPEG da peça, assíncronos; só as MAX_IMAGENS mais recentes guardam o JPEG. */
function imagens(rec, img) {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return;
  try {
    const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = cv.getContext('2d');
    g.putImageData(img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height), 0, 0);
    const mw = 200, mh = Math.max(1, Math.round((200 * img.height) / img.width));
    const mc = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(mw, mh) : Object.assign(document.createElement('canvas'), { width: mw, height: mh });
    mc.getContext('2d').drawImage(cv, 0, 0, mw, mh);
    const blob = (c, q) => (c.convertToBlob ? c.convertToBlob({ type: 'image/jpeg', quality: q }) : new Promise((ok) => c.toBlob(ok, 'image/jpeg', q)));
    blob(mc, 0.72).then((b) => { if (b) { rec.mini = URL.createObjectURL(b); avisar(); } }).catch(() => {});
    blob(cv, 0.9).then((b) => {
      rec.blob = b || null;
      let n = 0;
      for (const r of M.hist) if (r.blob && ++n > MAX_IMAGENS && (r.revisao || r.veredito === OK)) r.blob = null;
      // mapa de calor e logits (parte 2) só nas mais recentes
      let k = 0;
      for (const r of M.hist) {
        if (++k <= MAX_IMAGENS) continue;
        for (const x of r.resultados) { if (x.logits) delete x.logits; if (x.overlays) x.overlays = x.overlays.filter((o) => o.kind !== 'heat'); }
      }
    }).catch(() => {});
  } catch (_) { /* sem canvas: segue sem imagem */ }
}

export function historico() { carregarUsuario(); return M.hist; }
export function ultimo() { return M.ultimo; }
export function ultimaImagem() { return M.ultimoImg; }
/** Registro mostrado na tela (o selecionado no histórico, senão o último). */
export function selecionar(id) { M.selecionado = id == null ? null : M.hist.find((r) => r.id === id) || null; avisar(true); }
export function selecionado() { return M.selecionado || M.ultimo; }

// ------------------------------------------------------------------ revisão humana

/** Fila: NOK e INCERTO ainda sem decisão humana, incertos primeiro, mais antigos antes. */
export function filaRevisao() {
  return M.hist.filter((r) => r.veredito !== OK && !r.revisao)
    .sort((a, b) => (a.veredito === INCERTO ? 0 : 1) - (b.veredito === INCERTO ? 0 : 1) || a.id - b.id);
}

export const CLASSES_DEFEITO = ['risco', 'amassado', 'rebarba', 'falta de componente', 'furo a mais/a menos', 'dimensional',
  'cor fora', 'queimado', 'ferrugem', 'mofo', 'corpo estranho', 'contaminação', 'outro'];

/** Decisão humana: { decisao: 'OK'|'NOK', classe, motivo } — o motivo (≥ 5 letras) vai para o dataset. */
export function revisar(id, { decisao, classe = '', motivo = '' }) {
  const r = M.hist.find((x) => x.id === id);
  if (!r) throw new Error('inspeção não encontrada');
  if (decisao !== OK && decisao !== NOK) throw new Error('decisão deve ser OK ou NOK');
  if (String(motivo).trim().length < 5) throw new Error('escreva o motivo (pelo menos 5 letras)');
  if (decisao === NOK && !classe) throw new Error('escolha a classe do defeito');
  r.revisao = { decisao, classe: decisao === NOK ? classe : '', motivo: String(motivo).trim().slice(0, 300), por: M.usuario, em: new Date().toISOString() };
  r.final = decisao;
  persistirHistorico();
  M.status = `#${id} revisada: ${decisao}${r.veredito !== decisao ? ` (a máquina disse ${r.veredito})` : ''}.`;
  avisar(true);
  return r;
}

// ------------------------------------------------------------------ alarmes

function verificarAlarmes(prog, rec) {
  const a = prog.alarme || {};
  M.seguidosNok = rec.veredito === NOK ? M.seguidosNok + 1 : 0;
  const n = Math.max(2, +a.nok_seguidos || 3);
  if (M.seguidosNok === n) {
    M.alarmes.unshift({ id: `a${rec.id}`, tipo: 'nok', texto: `${n} peças NOK seguidas (${prog.codigo}) — pare e verifique o processo`, em: rec.t, reconhecido: false });
  }
  const ult = M.hist.slice(0, 20);
  const pct = ult.length >= 10 ? (100 * ult.filter((r) => r.veredito === INCERTO).length) / ult.length : 0;
  const lim = +a.incerto_pct || 25;
  if (pct >= lim && !M.alarmeIncerto) {
    M.alarmeIncerto = true;
    M.alarmes.unshift({ id: `i${rec.id}`, tipo: 'incerto', texto: `${Math.round(pct)} % de INCERTO nas últimas ${ult.length} — luz, foco ou limites?`, em: rec.t, reconhecido: false });
  } else if (pct < lim * 0.6) M.alarmeIncerto = false;
  if (M.alarmes.length > 50) M.alarmes.length = 50;
}
export function alarmes() { return M.alarmes; }
export function reconhecerAlarmes() { for (const a of M.alarmes) a.reconhecido = true; avisar(true); }

// ------------------------------------------------------------------ estatística

/** Contadores, taxas e Cpk das medidas em mm (paquímetro e Ø da forma). */
export function estatisticas() {
  const h = M.hist;
  const maq = { OK: 0, NOK: 0, INCERTO: 0 }, fin = { OK: 0, NOK: 0, INCERTO: 0 };
  let somaMs = 0;
  for (const r of h) { maq[r.veredito]++; fin[r.final]++; somaMs += r.ms || 0; }
  const n = h.length;
  const prog = M.ativo;
  const cpk = [];
  if (prog) {
    for (const t of prog.tools) {
      let lsl = null, usl = null, lerV = null;
      if (t.type === 'caliper') { lsl = t.nominal_mm - t.tol_mm; usl = t.nominal_mm + t.tol_mm; lerV = (x) => x.value; }
      else if (t.type === 'shape' && t.eq_diam_mm) { lsl = t.eq_diam_mm[0] - t.eq_diam_mm[1]; usl = t.eq_diam_mm[0] + t.eq_diam_mm[1]; lerV = (x) => (x.detail && x.detail.eq_diam_mm) ?? null; }
      if (lerV == null) continue;
      const vals = [];
      for (const r of h) {
        if (r.programa.id !== prog.id) continue;
        const x = r.resultados.find((q) => q.code === t.code);
        const v = x && x.status !== 'ERROR' ? lerV(x) : null;
        if (Number.isFinite(v)) vals.push(v);
      }
      if (vals.length < 2) { cpk.push({ code: t.code, n: vals.length }); continue; }
      const mu = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (vals.length - 1));
      cpk.push({
        code: t.code, n: vals.length, media: mu, sd, lsl, usl,
        cp: sd > 0 ? (usl - lsl) / (6 * sd) : null, cpk: sd > 0 ? Math.min(usl - mu, mu - lsl) / (3 * sd) : null,
        min: Math.min(...vals), max: Math.max(...vals),
      });
    }
  }
  return {
    n, maq, fin, pendentes: filaRevisao().length,
    refugo: n ? fin.NOK / n : 0, rendimento: n ? fin.OK / n : 0, cicloMedio: n ? somaMs / n : 0,
    seq: h.slice(0, 80).map((r) => r.final), cpk,
  };
}

/** Zera histórico, fila, contadores e alarmes (os programas ficam). */
export function zerar() {
  for (const r of M.hist) if (r.mini) URL.revokeObjectURL(r.mini);
  M.hist = []; M.ultimo = null; M.ultimoImg = null; M.selecionado = null; M.alarmes = []; M.seguidosNok = 0; M.alarmeIncerto = false;
  persistirHistorico();
  M.status = 'Histórico zerado.';
  avisar(true);
}

/** CSV (;) do histórico: uma linha por peça, valor e status de cada ferramenta. */
export function historicoCSV() {
  const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const codigos = [];
  for (const r of M.hist) for (const x of r.resultados) if (!codigos.includes(x.code)) codigos.push(x.code);
  const cab = ['id', 'data_hora', 'programa', 'versao', 'veredito_maquina', 'veredito_final', 'revisado_por', 'classe_defeito', 'motivo',
    'ciclo_ms', 'origem', 'alinhamento', 'px_por_mm', ...codigos.flatMap((c) => [`${c}_valor`, `${c}_status`])];
  const linhas = [cab.join(';')];
  for (const r of [...M.hist].reverse()) {
    const porCod = Object.fromEntries(r.resultados.map((x) => [x.code, x]));
    linhas.push([r.id, r.t, r.programa.codigo, r.programa.versao, r.veredito, r.final, r.revisao ? r.revisao.por : '',
      r.revisao ? r.revisao.classe : '', r.revisao ? r.revisao.motivo : '', r.ms, r.origem,
      r.alinhamento && r.alinhamento.metodo !== 'nenhum' ? `${r.alinhamento.ok ? 'ok' : 'falhou'} dx=${Math.round(r.alinhamento.dx)} dy=${Math.round(r.alinhamento.dy)}` : '',
      r.pxPorMm ?? '', ...codigos.flatMap((c) => [porCod[c] ? (typeof porCod[c].value === 'number' ? String(porCod[c].value).replace('.', ',') : String(porCod[c].value ?? '')) : '', porCod[c] ? porCod[c].status : ''])].map(q).join(';'));
  }
  return '﻿' + linhas.join('\n');
}

// ------------------------------------------------------------------ capturas (molde, cor, golden)

/** Captura o molde da presença `t` na caixa dele no quadro atual. Muda `prog` (rascunho). */
export function capturarMolde(prog, t, img = quadroPleno()) {
  if (!img) throw new Error('sem imagem: escolha a fonte e ligue o operador no Pipeline');
  const g = geometria(prog, t, img);
  const r = g.rect ? recorte(img, g.rect) : null;
  if (!r) throw new Error('desenhe a caixa do molde (marcação com a função "Inspect · presença")');
  if (r.w * r.h > 256 * 256) throw new Error(`molde grande demais (${r.w}×${r.h}); use até 256×256 px`);
  const cz = cinza(img, r);
  prog.assets = { ...(prog.assets || {}), [t.template_key]: { w: r.w, h: r.h, W: img.width, H: img.height, b64: paraB64(cz) } };
  if (!prog.imagem) prog.imagem = { w: img.width, h: img.height };
  return `${t.code}: molde ${r.w}×${r.h} px capturado.`;
}

/** Cor de referência da ferramenta de cor = a mediana Lab da região no quadro atual. */
export function capturarCor(prog, t, img = quadroPleno()) {
  if (!img) throw new Error('sem imagem');
  const g = geometria(prog, t, img);
  const r = recorte(img, g.roi);
  const lab = labMediana(img, r);
  t.ref_lab = lab.map((v) => Math.round(v * 100) / 100);
  return `${t.code}: referência L ${t.ref_lab[0]} a ${t.ref_lab[1]} b ${t.ref_lab[2]}.`;
}

/** Golden = a peça boa do quadro atual (cinza reduzido a 320 px), referência do alinhamento. */
export function capturarGolden(prog, img = quadroPleno()) {
  if (!img) throw new Error('sem imagem');
  const w = Math.min(LARG_GOLDEN, img.width), h = Math.max(1, Math.round((w * img.height) / img.width));
  const g = Uint8Array.from(cinzaReduzido(img, w, h, 'al.gold'));
  prog.golden = { w, h, W: img.width, H: img.height, b64: paraB64(g) };
  if (!prog.imagem) prog.imagem = { w: img.width, h: img.height };
  prog.alignment = { ...prog.alignment, enabled: true };
  return `Golden capturada (${w}×${h}); alinhamento ligado.`;
}

// ------------------------------------------------------------------ classificação: amostras e calibração conformal

/** Logits → base64 de Int16 (centésimos): 2 bytes por classe, para caber no navegador. */
const logitsParaB64 = (z) => { const q = new Int16Array(z.length); for (let i = 0; i < z.length; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(z[i] * 100))); return paraB64(new Uint8Array(q.buffer)); };
const logitsDeB64 = (b) => { const u = deB64(b); return Array.from(new Int16Array(u.buffer, 0, u.length >> 1), (v) => v / 100); };

/**
 * Amostra de calibração da classificação `t`: roda o classificador na ROI do
 * quadro atual e guarda os logits com o rótulo CERTO (`rotulo`, dito pelo
 * humano). Muda `t` (rascunho). Até 40 amostras.
 */
export async function amostraClassificacao(prog, t, rotulo, img = quadroPleno()) {
  if (!img) throw new Error('sem imagem: escolha a fonte e ligue o operador no Pipeline');
  const s = specResolvida(prog, t, img, { dx: 0, dy: 0 });
  const r = await rodarFerramentaAssinc(img, s, { lote: prog.lote, hoje: hojeLocal() }, 60000);
  if (!r.logits) throw new Error((r.detail && (r.detail.error || r.detail.reason)) || 'o classificador não respondeu');
  const Mo = await import('./modelos.js');
  const rotulos = await Mo.rotulosClassificador(t.modelo);
  const y = rotulos.indexOf(rotulo);
  if (y < 0) throw new Error(`«${rotulo}» não é uma classe do modelo`);
  t.calib_amostras = [...(t.calib_amostras || []), { y, r: rotulo, z: logitsParaB64(r.logits) }].slice(-40);
  return `${t.code}: amostra «${rotulo}» guardada (${t.calib_amostras.length}); o modelo disse «${r.value}» (${Math.round((r.confidence || 0) * 100)} %).`;
}

/** calibrate.classify nas amostras de `t`: T (NLL) e q̂ (split conformal, cobertura 1 − α). */
export function calibrarClassificacao(t) {
  const am = t.calib_amostras || [];
  if (am.length < 5) throw new Error('junte pelo menos 5 amostras rotuladas (o ideal é 30+)');
  const r = calibrarClassificador(am.map((a) => logitsDeB64(a.z)), am.map((a) => a.y), +t.alpha || 0.1);
  t.calibration = r.calibration;
  const c = r.calibration;
  return `${t.code}: T = ${c.temperature} · q̂ = ${c.qhat} · cobertura ${Math.round(c.coverage * 100)} % em ${c.n_cal} amostras · conjunto de 1 classe em ${Math.round(r.metrics.singleton_rate * 100)} %.`;
}

// ------------------------------------------------------------------ Treinar

/**
 * Imagens das peças para o Treinar (auth/treino.js). `filtro`: 'nok' (NOK
 * confirmadas ou não revisadas), 'ok' (OK finais), 'fila' (pendentes).
 * Só as que ainda têm o JPEG em memória.
 */
export function pecasParaTreino(filtro = 'nok') {
  const sel = M.hist.filter((r) => r.blob && (filtro === 'ok' ? r.final === OK : filtro === 'fila' ? !r.revisao && r.veredito !== OK : r.final === NOK || (r.veredito === NOK && !r.revisao)));
  return sel.map((r) => ({
    blob: r.blob, rec: r,
    nome: `inspect_${r.programa.codigo}_${String(r.id).padStart(5, '0')}_${r.final}${r.revisao && r.revisao.classe ? '_' + r.revisao.classe.replace(/\W+/g, '-') : ''}.jpg`,
  }));
}

export { OK, NOK, INCERTO, FAIL };
