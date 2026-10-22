/**
 * cv/runtime/livres-q/canal.js — CV-48 Monitor de EPI: votação por pessoa,
 * conformidade por zona, eventos, amostras para o +Projeto e a ponte com o
 * painel EPI.
 *
 * ESTÁGIO 1 (sem treino, este módulo): a pose RTMO recorta CABEÇA e TRONCO de
 * cada pessoa e o MobileCLIP2 compara cada recorte com duas frases (com /
 * sem capacete; com / sem colete). Cada resposta vira um VOTO da pessoa
 * rastreada (ID da sessão); a decisão sai da fração de votos na janela —
 * conforme, não conforme, incerto ou verificando.
 *
 * ESTÁGIO 2 (detector treinado): "Coletar amostra" guarda o quadro (rostos
 * borrados se o borrão estiver ligado) com as caixas de cabeça e tronco já
 * rotuladas pela votação; "Enviar ao +Projeto" cria/usa o projeto «EPI —
 * estágio 2» com as classes capacete / sem capacete / colete / sem colete e
 * manda as amostras como prints pré-rotulados. Revise as caixas no +Projeto,
 * salve no dataset e treine o RF-DETR no Treinar; depois troque o CLIP pelo
 * detector livre (livres.rfdetr) no Pipeline.
 */

export const ITENS = ['capacete', 'colete'];
export const ROTULO_ITEM = { capacete: 'Capacete', colete: 'Colete' };
export const ESTADOS = { conforme: 'conforme', nao: 'não conforme', incerto: 'incerto', verificando: 'verificando' };
export const COR_ESTADO = { conforme: '#4FB387', 'não conforme': '#FF6B5A', incerto: '#F2A900', verificando: '#94a3b8' };
export const CLASSES_PROJETO = ['capacete', 'sem capacete', 'colete', 'sem colete'];
export const NOME_PROJETO = 'EPI — estágio 2';

const MAX_EVENTOS = 2000, MAX_AMOSTRAS = 60;

/** Decisão de um item a partir dos votos (p(sim) de cada resposta do CLIP). */
export function decidir(votos, { janela = 9, limiar = 0.6, minimo = 3 } = {}) {
  const v = votos.slice(-janela);
  if (v.length < minimo) return { estado: ESTADOS.verificando, frac: null, n: v.length };
  const sim = v.filter((p) => p >= 0.5).length / v.length;
  const estado = sim >= limiar ? ESTADOS.conforme : sim <= 1 - limiar ? ESTADOS.nao : ESTADOS.incerto;
  return { estado, frac: sim, n: v.length };
}

/** Estado geral da pessoa: não conforme se algum item é; conforme se todos são; senão o pior entre incerto/verificando. */
export function geral(itens) {
  const e = Object.values(itens).map((x) => x.estado);
  if (!e.length) return ESTADOS.verificando;
  if (e.includes(ESTADOS.nao)) return ESTADOS.nao;
  if (e.every((x) => x === ESTADOS.conforme)) return ESTADOS.conforme;
  return e.includes(ESTADOS.incerto) ? ESTADOS.incerto : ESTADOS.verificando;
}

const M = {
  retrato: null, studio: false, eventos: [], zonas: new Map(), amostras: [], pedido: 0, ultimoQuadro: null,
  estadoAnt: new Map(), status: '',
};
const ouvintes = new Set();
let timer = null, ultimoAviso = 0;
function avisar(ja = false) {
  const chamar = () => { ultimoAviso = performance.now(); for (const f of ouvintes) { try { f(M.retrato); } catch (_) { /* desmontando */ } } };
  if (ja) { if (timer) { clearTimeout(timer); timer = null; } chamar(); return; }
  if (timer) return;
  timer = setTimeout(() => { timer = null; chamar(); }, Math.max(0, 250 - (performance.now() - ultimoAviso)));
}

/**
 * O operador publica a cada quadro analisado: pessoas [{ id, zona, itens, geral, caixa, cabeca, tronco }],
 * zonas (nomes), t (ms). Acumula pessoa-segundos por zona e os eventos de não conformidade.
 */
export function publicar(r) {
  const ant = M.retrato;
  const dt = ant && r.t > ant.t ? Math.min(2, (r.t - ant.t) / 1000) : 0;
  for (const z of r.zonas) if (!M.zonas.has(z)) M.zonas.set(z, { zona: z, seg: 0, conforme: 0, nao: 0, incerto: 0, pessoasMax: 0 });
  const porZona = new Map();
  for (const p of r.pessoas) {
    const z = p.zona || '—';
    porZona.set(z, (porZona.get(z) || 0) + 1);
    if (dt > 0 && M.zonas.has(z)) {
      const a = M.zonas.get(z);
      a.seg += dt;
      if (p.geral === ESTADOS.conforme) a.conforme += dt; else if (p.geral === ESTADOS.nao) a.nao += dt; else a.incerto += dt;
    }
    const antes = M.estadoAnt.get(p.id);
    if (p.geral === ESTADOS.nao && antes !== ESTADOS.nao) {
      const falta = Object.entries(p.itens).filter(([, x]) => x.estado === ESTADOS.nao).map(([k]) => ROTULO_ITEM[k]).join(' e ');
      M.eventos.unshift({ ts: Date.now(), id: p.id, zona: z, evento: 'não conforme', detalhe: `sem ${falta.toLowerCase()}` });
    } else if (antes === ESTADOS.nao && p.geral === ESTADOS.conforme) {
      M.eventos.unshift({ ts: Date.now(), id: p.id, zona: z, evento: 'regularizou', detalhe: '' });
    }
    M.estadoAnt.set(p.id, p.geral);
  }
  for (const [z, n] of porZona) { const a = M.zonas.get(z); if (a) a.pessoasMax = Math.max(a.pessoasMax, n); }
  if (M.eventos.length > MAX_EVENTOS) M.eventos.length = MAX_EVENTOS;
  M.retrato = r;
  avisar();
}

export const canalEpi = {
  publicar,
  instantaneo: () => M.retrato,
  assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
  avisarJa: () => avisar(true),
  eventos: () => M.eventos,
  /** Conformidade acumulada por zona: [{ zona, seg, conforme, nao, incerto, pct }]. */
  zonas: () => [...M.zonas.values()].map((z) => ({ ...z, pct: z.seg > 0 ? z.conforme / Math.max(1e-9, z.conforme + z.nao) : null })),
  recente: (ms = 3000) => Boolean(M.retrato) && performance.now() - M.retrato.tWall < ms,
  definirStudio(v) { M.studio = Boolean(v); },
  studioAberto: () => M.studio,
  status: () => M.status,
  /** Pede ao operador uma amostra (quadro + caixas rotuladas) no próximo quadro. */
  coletar(n = 1) { M.pedido += n; M.status = 'Coletando no próximo quadro…'; avisar(true); },
  pedidos: () => M.pedido,
  /** O operador entrega a amostra pedida. */
  guardarAmostra(a) {
    M.pedido = Math.max(0, M.pedido - 1);
    M.amostras.push(a);
    if (M.amostras.length > MAX_AMOSTRAS) M.amostras.splice(0, M.amostras.length - MAX_AMOSTRAS);
    M.status = `${M.amostras.length} amostra(s) guardada(s) neste aparelho.`;
    avisar(true);
  },
  amostras: () => M.amostras,
  descartarAmostras() { M.amostras = []; M.status = 'Amostras descartadas.'; avisar(true); },
  /** Manda as amostras ao +Projeto (projeto «EPI — estágio 2», classes pré-criadas). Devolve quantas foram. */
  async enviarAoProjeto() {
    if (!M.amostras.length) throw new Error('Nenhuma amostra coletada ainda.');
    const P = await import('../../../projeto/base.js');
    await P.prontoP();
    let proj = P.projStore.get().projetos.find((p) => p.nome === NOME_PROJETO);
    if (!proj) proj = await P.criarProjeto({ nome: NOME_PROJETO, tipo: 'detector', classes: CLASSES_PROJETO });
    else if (P.projStore.get().ativo !== proj.id) await P.abrirProjeto(proj.id);
    // classes que faltarem (o projeto pode ter sido editado)
    for (const c of CLASSES_PROJETO) if (P.classePorNome(c) < 0) await P.adicionarClasse(c).catch(() => {});
    const idx = Object.fromEntries(CLASSES_PROJETO.map((c) => [c, P.classePorNome(c)]));
    let n = 0;
    for (const a of M.amostras) {
      const caixas = a.caixas.filter((c) => idx[c.classe] >= 0).map((c) => ({ cls: idx[c.classe], tipo: 'retangulo', pts: [[c.x1, c.y1], [c.x2, c.y2]] }));
      await P.adicionarPrint(a.blob, { origem: 'epi', caixas });
      n++;
    }
    M.amostras = [];
    M.status = `${n} amostra(s) enviada(s) ao +Projeto «${NOME_PROJETO}» — revise as caixas antes de treinar.`;
    P.abrirPainel();
    avisar(true);
    return n;
  },
  /** Nova sessão: zera eventos, zonas e votos (o operador zera os votos ao ver a geração mudar). */
  zerar() { M.eventos = []; M.zonas = new Map(); M.estadoAnt = new Map(); M.geracao = (M.geracao || 0) + 1; M.retrato = M.retrato ? { ...M.retrato, pessoas: [] } : null; avisar(true); },
  geracao: () => M.geracao || 0,
  eventosCSV() {
    const q = (v) => { const s = v == null ? '' : String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const l = ['hora;id_pessoa;zona;evento;detalhe'];
    for (const e of M.eventos.slice().reverse()) l.push([new Date(e.ts).toISOString(), e.id, q(e.zona), q(e.evento), q(e.detalhe)].join(';'));
    l.push('');
    l.push('zona;pessoa_segundos;conforme_s;nao_conforme_s;incerto_s;conformidade;pessoas_max');
    for (const z of canalEpi.zonas()) l.push([q(z.zona), z.seg.toFixed(1), z.conforme.toFixed(1), z.nao.toFixed(1), z.incerto.toFixed(1), z.pct == null ? '' : z.pct.toFixed(4), z.pessoasMax].join(';'));
    return '﻿' + l.join('\n');
  },
};
