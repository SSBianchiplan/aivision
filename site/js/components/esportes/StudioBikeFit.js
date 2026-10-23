/**
 * components/esportes/StudioBikeFit.js — "Studio Bike Fit": a análise do
 * Bike Fit (CV-28) em tela cheia, no estilo de estúdio de bike fit:
 * faixa vermelha "VISÃO GERAL", o vídeo com o esqueleto verde e as
 * etiquetas dos ângulos à esquerda, cinco curvas de ângulo × tempo à
 * direita (uma onda por pedalada) e o rodapé com atleta, sessão e estúdio.
 *
 * DE ONDE VEM CADA COISA
 *
 *   Vídeo   o canvas de exibição do app (`displayCanvas`). Com o Studio
 *           aberto, o operador bikefit.analise deixa de desenhar o próprio
 *           overlay (canal.definirStudio), e como ele é "overlayOnly" o
 *           Viewport pinta ali o vídeo em RESOLUÇÃO PLENA, já espelhado como
 *           o pipeline vê. O Studio copia o retângulo do vídeo (drawImage de
 *           canvas para canvas, na GPU): nenhum getImageData, nenhuma cópia
 *           extra do quadro no operador. Se outro nó do Pipeline alterar os
 *           pixels (desfoque, segmentação…), aparece o quadro processado.
 *   Pontos  o retrato que o operador publica no canal a cada inferência:
 *           33 pontos normalizados (0..1 do quadro), lado medido (I), direção,
 *           tamanho do quadro, ângulos atuais e o ângulo do pé.
 *   Curvas  canal.obterHistorico(): ~20 s de amostras {t, ângulos} e as
 *           marcas de PMI/PMS. Fica no canal para já existir quando o Studio abre.
 *
 *   Indicadores  os mesmos do painel Bike Fit (cartões rpm/pedaladas/lado,
 *           tabela "Ângulos · últimas N pedaladas", avisos e recomendações),
 *           com as funções do próprio painel (linhasTabelaBikeFit…), a partir do
 *           canal e do resumo da sessão — recalculados ~3×/s, não a cada quadro.
 *
 * Tudo é desenhado num canvas só (o "palco"): exportar PNG é toBlob dele e
 * gravar vídeo é o MediaRecorder do mesmo canvas (cv/recorder.js) — cartões,
 * tabela, avisos e recomendações entram no PNG e no vídeo. No celular o palco
 * é mais alto que a tela e rola; o PNG sai com a altura inteira.
 * Barra de botões e ajustes são HTML por cima e não entram no PNG/vídeo.
 *
 * Custo: o Studio NÃO roda inferência nenhuma. Ele redesenha no máximo a ~30
 * quadros/s (cópia do canvas de exibição + vetores), e SÓ o que mudou: o
 * vídeo quando o Viewport pintou um quadro novo, os gráficos quando chega
 * amostra (ou a escala/relógio das curvas anda), o relógio do rodapé a cada
 * segundo, tudo quando muda layout, ajustes, indicadores ou vista. Fundo,
 * faixas-alvo, eixos, rótulos e logo ficam numa camada estática copiada por
 * baixo. No celular só a faixa visível do palco é repintada. Vídeo pausado e
 * nenhuma interação: quase nada de CPU. Gravando, desenha sempre (30 q/s).
 * Com ele aberto o operador não desenha overlay nem resume a sessão por
 * quadro, e o painel Bike Fit por baixo para de se redesenhar — sobra thread
 * para as poses.
 */
import { html, useRef, useState, useEffect, useCallback } from '../../vendor.js';
import { store, useStore, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { num, LM, FRONTAL, status, COR_STATUS, TAXA_MIN_HZ as TAXA_MIN } from '../../cv/runtime/livres-e/bikefit.js';
import { linhasTabelaBikeFit, notaFrontalBikeFit, NOTA_RECS, ativarBikeFit } from '../BikeFitPanel.js';
import {
  instantaneo, obterHistorico, obterSessao, definirStudio, zerarSessao, alvosSessao, obterAtleta,
} from '../../cv/runtime/livres-e/canal.js';
import { AtletaBikeFit, useAtleta } from './AtletaBikeFit.js';
import { PipelineConteudo } from '../Panels.js';
import { dadosSessao, htmlRelatorio } from '../../cv/runtime/livres-e/relatorio.js';
import { Recorder, salvar, formatarTempo, suportado as gravacaoSuportada } from '../../cv/recorder.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import { FerramentasStudio } from '../studio/FerramentasStudio.js';
import { BotaoVia } from '../../via/BotaoVia.js';   // [VIA] botão «✦ Via» da barra (js/via/)

const OP = 'bikefit.analise';
const PREFS = 'aiv.studio.bikefit';
const PREFS_PAINEL = 'aiv.bikefit.prefs';

const FONTE = 'Archivo, "Helvetica Neue", Arial, sans-serif';
const JANELA_MS = 8000;          // tempo visível em cada gráfico
const AGORA = 0.94;              // posição da linha "agora" no gráfico (fração da largura)

/*
 * PALETA DO CANVAS POR TEMA
 *
 * O palco é um canvas só, então as cores do tema não chegam até ele pelo CSS:
 * todo desenho lê a paleta ativa `C`. Há uma paleta por tema do app
 * (<html data-theme>: ausente/'dark' = iaVision escuro, 'light' = claro,
 * 'code' = Code Dark):
 *
 *   escuro  o desenho original do Studio, com as cores LITERAIS (não lidas do
 *           CSS): é também a "paleta de apresentação" que a exportação pode
 *           usar a partir de qualquer tema (Ajustes → Cores da exportação), e
 *           nesse caso os tokens do <html> são os do OUTRO tema.
 *   claro   fundo claro do app, tinta verde-escura, faixa lateral amarela com
 *           texto escuro, faixas-alvo em verde, curvas escuras, selos escuros
 *           com glifo branco, esqueleto em âmbar.
 *   code    cinzas do VS Code (#1E1E1E/#252526/#3C3C3C), texto #CCCCCC,
 *           realce amarelo do iaVision, alvo em turquesa discreto (#4EC9B0).
 *
 * Claro e Code partem de valores padrão e são completados com os tokens do
 * tema (css/theme.css) lidos por getComputedStyle — uma vez por troca de
 * tema, nunca por quadro. Sobre o vídeo (esqueleto, arcos, etiquetas) as
 * cores valem pelo vídeo, não pelo fundo: as etiquetas são pílulas sólidas.
 */
const ESCURO = Object.freeze({
  id: 'escuro',
  // fundo, faixa lateral, rodapé e logo
  fundo: '#02302C', fundoVideo: '#02302C',
  faixa: '#FFD84D', faixaTinta: '#04413C', linhaRodape: '#FFD84D', logoFaixa: '#fff', logoRodape: '#fff',
  // texto
  tinta: '#fff', tinta2: '#CFEBE4', eixo: 'rgba(207,235,228,.55)', sub: 'rgba(207,235,228,.7)', espera: 'rgba(207,235,228,.75)',
  destaque: '#FFD84D', aviso: '#ffc2b8',
  // gráficos: faixas-alvo, grade, curva, PMI/PMS, marcas de mín/máx
  alvoFundo: 'rgba(255,216,77,.11)', alvoBorda: 'rgba(255,216,77,.5)', alvoTexto: 'rgba(255,216,77,.85)',
  gradeSeg: 'rgba(255,255,255,.07)', gradeFase: 'rgba(255,255,255,.08)', gradePMI: 'rgba(255,255,255,.17)', gradeBorda: 'rgba(255,255,255,.2)',
  divisoria: 'rgba(255,255,255,.10)', ponte: 'rgba(255,255,255,.35)', faseAgora: 'rgba(255,255,255,.55)', bandaCiclo: 'rgba(255,255,255,.13)',
  curva: '#fff', minmax: 'rgba(207,235,228,.6)', pontoBorda: '#04413C',
  // cartões, tabela, avisos/recomendações
  cartao: 'rgba(255,255,255,.06)', cartaoBorda: 'rgba(207,235,228,.18)', linhaTabela: 'rgba(207,235,228,.18)', zebra: 'rgba(255,255,255,.04)',
  notasFundo: 'rgba(0,0,0,.16)', notasBorda: 'rgba(207,235,228,.14)',
  // selos de status: preenchimento (st), texto colorido (stTxt) e o glifo
  st: COR_STATUS, stTxt: COR_STATUS, seloBorda: 'rgba(0,0,0,.35)', seloGlifo: '#04413C',
  // sobre o vídeo
  esqueleto: '#FFD84D', arcoFundo: 'rgba(255,216,77,.14)', tracejado: 'rgba(255,216,77,.75)', guia: 'rgba(255,216,77,.8)',
  pontoFundo: 'rgba(0,0,0,.45)', prumo: 'rgba(255,255,255,.55)', sombra: 'rgba(0,0,0,.55)',
  etqFundo: '#FFD84D', etqBorda: null, etqTinta: '#04413C',
  avisoFundo: 'rgba(0,0,0,.7)', avisoTinta: '#ffd84d', cadFundo: 'rgba(0,0,0,.6)', cadTinta: '#fff',
});

const PADRAO_CLARO = {
  ...ESCURO, id: 'claro',
  fundo: '#F1F8F6', fundoVideo: '#EEF4F2',
  faixa: '#FFD84D', faixaTinta: '#04413C', linhaRodape: '#D9AE00', logoFaixa: '#04413C', logoRodape: '#04413C',
  tinta: '#04413C', tinta2: '#285C56', eixo: '#4A6F6A', sub: '#4A6F6A', espera: '#4A6F6A',
  destaque: '#7A5600', aviso: '#8C1D18',
  alvoFundo: 'rgba(23,107,83,.085)', alvoBorda: 'rgba(23,107,83,.45)', alvoTexto: '#176B53',
  gradeSeg: 'rgba(4,65,60,.07)', gradeFase: 'rgba(4,65,60,.09)', gradePMI: 'rgba(4,65,60,.2)', gradeBorda: 'rgba(4,65,60,.26)',
  divisoria: 'rgba(4,65,60,.13)', ponte: 'rgba(4,65,60,.38)', faseAgora: 'rgba(4,65,60,.5)', bandaCiclo: 'rgba(4,65,60,.12)',
  curva: '#04413C', minmax: 'rgba(4,65,60,.55)', pontoBorda: '#FFFFFF',
  cartao: '#FFFFFF', cartaoBorda: 'rgba(4,65,60,.2)', linhaTabela: 'rgba(4,65,60,.18)', zebra: 'rgba(4,65,60,.04)',
  notasFundo: '#FFFFFF', notasBorda: 'rgba(4,65,60,.16)',
  st: { ok: '#176B53', perto: '#7A5600', fora: '#B3261E', sem: '#4A6F6A' },
  stTxt: { ok: '#176B53', perto: '#7A5600', fora: '#B3261E', sem: '#4A6F6A' },
  seloBorda: 'rgba(255,255,255,.9)', seloGlifo: '#FFFFFF',
  esqueleto: '#D99A00', arcoFundo: 'rgba(217,154,0,.16)', tracejado: 'rgba(217,154,0,.8)', guia: 'rgba(217,154,0,.85)',
  pontoFundo: 'rgba(0,0,0,.4)', etqBorda: '#D9AE00',
  avisoFundo: 'rgba(255,255,255,.92)', avisoTinta: '#7A5600', cadFundo: 'rgba(255,255,255,.88)', cadTinta: '#04413C',
};

const PADRAO_CODE = {
  ...ESCURO, id: 'code',
  fundo: '#1E1E1E', fundoVideo: '#1E1E1E',
  faixa: '#FFD84D', faixaTinta: '#1E1E1E', linhaRodape: '#FFD84D', logoFaixa: '#1E1E1E', logoRodape: '#CCCCCC',
  tinta: '#CCCCCC', tinta2: '#BBBBBB', eixo: '#ABABAB', sub: '#ABABAB', espera: '#ABABAB',
  destaque: '#FFD84D', aviso: '#F48771',
  alvoFundo: 'rgba(78,201,176,.08)', alvoBorda: 'rgba(78,201,176,.45)', alvoTexto: '#4EC9B0',
  curva: '#D4D4D4', minmax: 'rgba(204,204,204,.6)', pontoBorda: '#1E1E1E',
  cartao: '#252526', cartaoBorda: '#3C3C3C', linhaTabela: '#3C3C3C', zebra: 'rgba(255,255,255,.03)',
  notasFundo: '#252526', notasBorda: '#3C3C3C',
  st: { ok: '#89D185', perto: '#FFD84D', fora: '#F48771', sem: '#8B8B8B' },
  stTxt: { ok: '#89D185', perto: '#FFD84D', fora: '#F48771', sem: '#ABABAB' },
  seloGlifo: '#1E1E1E', etqTinta: '#1E1E1E',
  avisoFundo: 'rgba(30,30,30,.88)', avisoTinta: '#FFD84D', cadFundo: 'rgba(30,30,30,.78)', cadTinta: '#CCCCCC',
};

/** Entrada da paleta ← token do tema (css/theme.css). Só os que existem nos dois temas e têm o mesmo papel. */
const TOKENS = {
  claro: {
    fundo: '--bg-2', fundoVideo: '--stage-bg', tinta: '--ink', tinta2: '--ink-2', eixo: '--ink-3', sub: '--ink-3', espera: '--ink-3',
    destaque: '--signal-text', aviso: '--err-ink', faixa: '--signal', faixaTinta: '--signal-ink', linhaRodape: '--signal-line',
    logoFaixa: '--signal-ink', logoRodape: '--ink', curva: '--ink', alvoTexto: '--ok', etqTinta: '--signal-ink', etqBorda: '--signal-line',
    cadTinta: '--ink', avisoTinta: '--signal-text',
  },
  code: {
    fundo: '--stage-bg', fundoVideo: '--stage-bg', tinta: '--ink', tinta2: '--ink-2', eixo: '--ink-3', sub: '--ink-3', espera: '--ink-3',
    destaque: '--signal-text', aviso: '--err-ink', faixa: '--signal', faixaTinta: '--signal-ink', logoFaixa: '--signal-ink', logoRodape: '--ink',
    alvoTexto: '--cyan', cartao: '--panel-solid', notasFundo: '--panel-solid', cartaoBorda: '--line', linhaTabela: '--line', notasBorda: '--line',
    etqTinta: '--signal-ink', cadTinta: '--ink',
  },
};
/** Texto de status ← tokens --ok / --warn / --err / --ink-3 (o preenchimento dos selos no claro usa os mesmos). */
const TOKENS_STATUS = { ok: '--ok', perto: '--warn', fora: '--err', sem: '--ink-3' };

/** Tema do app: 'escuro' | 'claro' | 'code'. */
function temaDoApp() {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'light' ? 'claro' : t === 'code' ? 'code' : 'escuro';
}

const _paletas = new Map();
/** Paleta do tema (com os tokens lidos do CSS); em cache até a próxima troca de tema. */
function paletaDoTema(tema = temaDoApp()) {
  if (tema === 'escuro') return ESCURO;
  if (_paletas.has(tema)) return _paletas.get(tema);
  const p = { ...(tema === 'claro' ? PADRAO_CLARO : PADRAO_CODE) };
  try {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => (cs.getPropertyValue(n) || '').trim();
    for (const [k, n] of Object.entries(TOKENS[tema])) { const x = v(n); if (x) p[k] = x; }
    const stTxt = { ...p.stTxt };
    for (const [k, n] of Object.entries(TOKENS_STATUS)) { const x = v(n); if (x) stTxt[k] = x; }
    p.stTxt = stTxt;
    if (tema === 'claro') p.st = { ...stTxt };
  } catch (_) { /* sem CSS (teste fora do app): fica o padrão */ }
  _paletas.set(tema, p);
  return p;
}

/** Paleta ativa do desenho: trocada no começo de cada pintura (tema, ou "iaVision escuro" ao exportar). */
let C = ESCURO;

/** Ângulos que o Studio sabe mostrar, por vista. `rot` = etiqueta no vídeo. */
const ANGULOS = {
  lateral: [
    { k: 'tronco', titulo: 'Ângulo do tronco', rot: 'Tronco', un: '°' },
    { k: 'ombro', titulo: 'Ângulo do ombro', rot: 'Ângulo do ombro', un: '°' },
    { k: 'quadril', titulo: 'Ângulo do quadril', rot: 'Ângulo do quadril', un: '°' },
    { k: 'joelho', titulo: 'Ângulo do joelho', rot: 'Joelho', un: '°' },
    { k: 'pe', titulo: 'Ângulo do pé', rot: 'Ângulo do pé', un: '°' },
    { k: 'tornozelo', titulo: 'Ângulo do tornozelo', rot: 'Tornozelo', un: '°' },
    { k: 'cotovelo', titulo: 'Ângulo do cotovelo', rot: 'Cotovelo', un: '°' },
  ],
  frontal: [
    { k: 'desvioE', titulo: 'Joelho esquerdo · desvio', rot: 'Joelho E', un: '%' },
    { k: 'desvioD', titulo: 'Joelho direito · desvio', rot: 'Joelho D', un: '%' },
    { k: 'pelve', titulo: 'Inclinação da pelve', rot: 'Pelve', un: '°' },
    { k: 'ombros', titulo: 'Inclinação dos ombros', rot: 'Ombros', un: '°' },
    { k: 'joelho', titulo: 'Ângulo do joelho', rot: 'Joelho', un: '°' },
  ],
};
const PADRAO_SEL = {
  lateral: ['tronco', 'ombro', 'quadril', 'joelho', 'pe'],
  frontal: ['desvioE', 'desvioD', 'pelve', 'ombros', 'joelho'],
};
const defAng = (vista, k) => ANGULOS[vista].find((a) => a.k === k) || ANGULOS[vista][0];

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dataBR = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '');
};
const agoraBR = () => {
  const d = new Date(), p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const arquivoSeguro = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40);

function lerPrefs() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (_) { v = {}; }
  const sel = v.sel || {};
  const valida = (vista) => {
    const ks = Array.isArray(sel[vista]) ? sel[vista].filter((k) => ANGULOS[vista].some((a) => a.k === k)) : [];
    return ks.length === 5 ? ks : PADRAO_SEL[vista].slice();
  };
  return {
    atleta: v.atleta ?? 'Atleta',
    data: v.data || hoje(),
    estudio: v.estudio ?? 'GPlanSiS|StudioBikeFit',
    site: v.site ?? '',
    telefone: v.telefone ?? '',
    logo: typeof v.logo === 'string' ? v.logo : '',
    sel: { lateral: valida('lateral'), frontal: valida('frontal') },
    blocos: { kpis: true, tabela: true, avisos: true, recs: true, ...(v.blocos || {}) },
    minmax: Boolean(v.minmax),
    modo: v.modo === 'ciclo' ? 'ciclo' : 'tempo',
    // cores do PNG, do vídeo gravado e do relatório: as do tema atual ou sempre as do iaVision escuro
    corExport: v.corExport === 'escuro' ? 'escuro' : 'tema',
  };
}
function gravarPrefs(v) {
  try { localStorage.setItem(PREFS, JSON.stringify(v)); } catch (_) { /* modo privado ou cota cheia */ }
}

/** Logo enviado → PNG de no máximo 256 px (cabe no localStorage). */
function reduzirLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 256 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
    img.src = url;
  });
}

// ------------------------------------------------------------------ desenho

function pilula(g, x, y, w, h) {
  const r = Math.min(h / 2, w / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function texto(g, s, x, y, { tam = 12, peso = 400, cor = C.tinta, alinha = 'left', base = 'alphabetic', max } = {}) {
  g.font = `${peso} ${tam}px ${FONTE}`;
  g.fillStyle = cor;
  g.textAlign = alinha;
  g.textBaseline = base;
  let t = String(s == null ? '' : s);
  if (max && g.measureText(t).width > max) {
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
    t += '…';
  }
  g.fillText(t, x, y);
}

/** Arco do ângulo em B entre BA e BD (lado interno), tracejado, com leve preenchimento. Devolve a bissetriz. */
function arcoAngulo(g, A, B, D, R) {
  const a1 = Math.atan2(A.y - B.y, A.x - B.x);
  let d = Math.atan2(D.y - B.y, D.x - B.x) - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  g.beginPath();
  g.moveTo(B.x, B.y);
  g.arc(B.x, B.y, R, a1, a1 + d, d < 0);
  g.closePath();
  g.fillStyle = C.arcoFundo;
  g.fill();
  g.beginPath();
  g.arc(B.x, B.y, R, a1, a1 + d, d < 0);
  g.setLineDash([4, 4]);
  g.strokeStyle = C.esqueleto;
  g.lineWidth = 1.6;
  g.stroke();
  g.setLineDash([]);
  return a1 + d / 2;
}

function linhaTracejada(g, a, b, cor = C.tracejado) {
  g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
  g.setLineDash([5, 5]); g.strokeStyle = cor; g.lineWidth = 1.3; g.stroke(); g.setLineDash([]);
}

function ponto(g, p, r) {
  g.beginPath(); g.arc(p.x, p.y, r, 0, 2 * Math.PI);
  g.fillStyle = C.pontoFundo; g.fill();
  g.strokeStyle = C.esqueleto; g.lineWidth = 1.6; g.stroke();
  g.beginPath();
  g.moveTo(p.x - r * 0.62, p.y); g.lineTo(p.x + r * 0.62, p.y);
  g.moveTo(p.x, p.y - r * 0.62); g.lineTo(p.x, p.y + r * 0.62);
  g.lineWidth = 1.2; g.stroke();
}

/** Etiquetas verdes sem sobreposição, presas dentro da área do vídeo, com linha guia até a articulação. */
function desenharEtiquetas(g, etqs, area, u, obst = []) {
  const h = Math.round(22 * u), pad = 9 * u, tam = 12 * u;
  g.font = `700 ${tam}px ${FONTE}`;
  const caixas = etqs.map((e) => {
    const w = g.measureText(e.txt).width + pad * 2;
    let x = e.ax - w / 2, y = e.ay - h / 2;
    x = Math.max(area.x + 4, Math.min(area.x + area.w - w - 4, x));
    y = Math.max(area.y + 4, Math.min(area.y + area.h - h - 4, y));
    return { ...e, x, y, w, h };
  }).sort((a, b) => a.y - b.y);
  const bate = (a, b) => b.x < a.x + a.w + 3 && b.x + b.w + 3 > a.x && b.y < a.y + a.h + 3 && b.y + b.h + 3 > a.y;
  for (let i = 0; i < caixas.length; i++) {
    const b = caixas[i];
    for (const o of obst) if (bate(o, b)) b.y = o.y + o.h + 4;
    for (let j = 0; j < i; j++) {
      const a = caixas[j];
      if (bate(a, b)) {
        b.y = a.y + a.h + 4;
        if (b.y + b.h > area.y + area.h - 4) b.y = Math.max(area.y + 4, a.y - b.h - 4);
      }
    }
  }
  for (const c of caixas) {
    const cx = Math.max(c.x, Math.min(c.x + c.w, c.jx)), cy = Math.max(c.y, Math.min(c.y + c.h, c.jy));
    g.beginPath(); g.moveTo(c.jx, c.jy); g.lineTo(cx, cy);
    g.strokeStyle = C.guia; g.lineWidth = 1; g.stroke();
    g.save();
    g.shadowColor = C.sombra; g.shadowBlur = 6 * u;
    pilula(g, c.x, c.y, c.w, c.h);
    g.fillStyle = C.etqFundo; g.fill();
    g.restore();
    if (C.etqBorda) { g.strokeStyle = C.etqBorda; g.lineWidth = 1; g.stroke(); }
    texto(g, c.txt, c.x + c.w / 2, c.y + c.h / 2 + 0.5, { tam, peso: 700, cor: C.etqTinta, alinha: 'center', base: 'middle' });
  }
}

const fmt = (v, un) => (v == null || !Number.isFinite(v) ? '—' : `${num(v, 1)}${un}`);

/**
 * Enquadramento do vídeo na área: o maior zoom que ainda mostra o ciclista
 * inteiro (caixa dos pontos + margem), entre "contém" e "cobre". Suavizado.
 */
function enquadrar(cam, area, w, h, pts) {
  const s0 = Math.min(area.w / w, area.h / h), s1 = Math.max(area.w / w, area.h / h);
  let alvo = { s: s0, cx: w / 2, cy: h / 2 };
  if (pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
    for (const [x, y, v] of pts) {
      if (v < 0.3) continue;
      n++;
      x1 = Math.min(x1, x * w); x2 = Math.max(x2, x * w); y1 = Math.min(y1, y * h); y2 = Math.max(y2, y * h);
    }
    if (n >= 8) {
      const bw = Math.max(20, (x2 - x1) * 1.35), bh = Math.max(20, (y2 - y1) * 1.3);
      const s = Math.max(s0, Math.min(s1, area.w / bw, area.h / bh));
      alvo = { s, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
    }
  }
  // o centro não deixa a área mostrar fora do quadro (quando o quadro é maior que a área)
  const vw = area.w / alvo.s, vh = area.h / alvo.s;
  alvo.cx = vw >= w ? w / 2 : Math.max(vw / 2, Math.min(w - vw / 2, alvo.cx));
  alvo.cy = vh >= h ? h / 2 : Math.max(vh / 2, Math.min(h - vh / 2, alvo.cy));
  if (!cam.s || cam.w !== w || cam.h !== h || cam.aw !== area.w || cam.ah !== area.h) {
    Object.assign(cam, alvo, { w, h, aw: area.w, ah: area.h });
    cam.mexendo = false;
  } else {
    const k = 0.06;
    const ds = (alvo.s - cam.s) * k, dx = (alvo.cx - cam.cx) * k, dy = (alvo.cy - cam.cy) * k;
    cam.s += ds; cam.cx += dx; cam.cy += dy;
    // ainda andando (mais de 1/50 px na tela)? o Studio redesenha o vídeo no próximo quadro
    cam.mexendo = Math.abs(ds) * Math.max(w, h) > 0.02 || Math.abs(dx) * cam.s > 0.02 || Math.abs(dy) * cam.s > 0.02;
  }
  return cam;
}

function desenharVideo(g, area, est, u) {
  const { dc, r, vista, sel, cam } = est;
  g.save();
  g.beginPath(); g.rect(area.x, area.y, area.w, area.h); g.clip();
  g.fillStyle = C.fundoVideo; g.fillRect(area.x, area.y, area.w, area.h);
  const fresco = r && performance.now() - r.t < 4000;
  const temDc = dc && dc.width > 2 && dc.height > 2;
  let paraArea = null;
  if (temDc && r && r.w && r.h) {
    // retângulo do vídeo dentro do canvas de exibição: mesma conta do Viewport (contém, centrado)
    const fit = Math.min(dc.width / r.w, dc.height / r.h);
    const dw = r.w * fit, dh = r.h * fit, dx = (dc.width - dw) / 2, dy = (dc.height - dh) / 2;
    const c = enquadrar(cam, area, r.w, r.h, fresco && !r.sem ? r.pts : null);
    est.animVideo = c.mexendo;
    const ox = area.x + area.w / 2 - c.cx * c.s, oy = area.y + area.h / 2 - c.cy * c.s;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    try { g.drawImage(dc, dx, dy, dw, dh, ox, oy, r.w * c.s, r.h * c.s); } catch (_) { /* canvas sumiu */ }
    paraArea = ([x, y]) => ({ x: ox + x * r.w * c.s, y: oy + y * r.h * c.s });
    // onde o quadro está no canvas, em px do canvas (Ferramentas do Studio: components/studio/FerramentasStudio.js)
    const m = g.getTransform();
    c.tfFerr = { ox: ox * m.a + m.e, oy: oy * m.d + m.f, dw: r.w * c.s * m.a, dh: r.h * c.s * m.d,
      clip: { x: area.x * m.a + m.e, y: area.y * m.d + m.f, w: area.w * m.a, h: area.h * m.d } };
  } else if (temDc) {
    const fit = Math.min(area.w / dc.width, area.h / dc.height);
    const w = dc.width * fit, h = dc.height * fit;
    try { g.drawImage(dc, area.x + (area.w - w) / 2, area.y + (area.h - h) / 2, w, h); } catch (_) { /* idem */ }
  }

  // estado / cadência no canto do vídeo (as etiquetas desviam desta pílula)
  const sessao = obterSessao();
  const tCad = r ? `${r.cadencia ? Math.round(r.cadencia) + ' rpm' : '— rpm'} · ${sessao.pedaladas} pedaladas`
    + `${r.taxa != null ? ` · ${num(r.taxa, 1)} poses/s` : ''}` : '';
  g.font = `600 ${12 * u}px ${FONTE}`;
  const wCad = g.measureText(tCad).width + 22 * u;
  const pCad = { x: area.x + area.w - wCad - 12, y: area.y + 12, w: wCad, h: 24 * u };

  if (paraArea && fresco && !r.sem && r.pts) {
    if (vista === 'frontal') desenharFrontal(g, area, r, sel, paraArea, u, [pCad]);
    else desenharLateral(g, area, r, sel, paraArea, u, [pCad]);
  }

  let aviso = null;
  if (!temDc) aviso = 'Sem vídeo: escolha a fonte (câmera, arquivo, tela ou YouTube) em «Fonte», na barra acima.';
  else if (!est.temNo) aviso = 'Bike Fit fora do Pipeline: abra o painel Bike Fit e clique em "Adicionar ao Pipeline".';
  else if (!r || !fresco) aviso = 'Aguardando a análise do Bike Fit…';
  else if (r.sem) aviso = 'Procurando o ciclista…';
  if (aviso) {
    g.font = `600 ${12 * u}px ${FONTE}`;
    const w = Math.min(area.w - 24, g.measureText(aviso).width + 24 * u);
    pilula(g, area.x + 12, area.y + 12, w, 26 * u);
    g.fillStyle = C.avisoFundo; g.fill();
    texto(g, aviso, area.x + 12 + 12 * u, area.y + 12 + 13 * u, { tam: 12 * u, peso: 600, cor: C.avisoTinta, base: 'middle', max: w - 24 * u });
  } else {
    pilula(g, pCad.x, pCad.y, pCad.w, pCad.h);
    g.fillStyle = C.cadFundo; g.fill();
    texto(g, tCad, pCad.x + pCad.w / 2, pCad.y + pCad.h / 2, { tam: 12 * u, peso: 600, cor: C.cadTinta, alinha: 'center', base: 'middle' });
  }
  g.restore();
}

function desenharLateral(g, area, r, sel, paraArea, u, obst = []) {
  const minVis = r.minVis || 0.5;
  const I = r.I || {};
  const pt = (k) => {
    const q = r.pts[I[k]];
    return q && q[2] >= minVis ? paraArea(q) : null;
  };
  const [ombro, cotovelo, punho, quadril, joelho, tornozelo, calc, pe] =
    ['ombro', 'cotovelo', 'punho', 'quadril', 'joelho', 'tornozelo', 'calcanhar', 'pe'].map(pt);
  const orelhaIdx = I.ombro === LM.ombro.e ? 7 : 8;
  const orelha = r.pts[orelhaIdx] && r.pts[orelhaIdx][2] >= minVis ? paraArea(r.pts[orelhaIdx]) : null;
  const dir = r.dir || 1;

  g.lineCap = 'round';
  const seg = (a, b, w = 2.2) => {
    if (!a || !b) return;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    g.strokeStyle = C.esqueleto; g.lineWidth = w * u; g.stroke();
  };
  seg(orelha, ombro, 1.6); seg(ombro, cotovelo); seg(cotovelo, punho); seg(ombro, quadril);
  seg(quadril, joelho); seg(joelho, tornozelo); seg(tornozelo, calc, 1.6); seg(calc, pe, 1.6); seg(tornozelo, pe, 1.6);

  const coxa = quadril && joelho ? Math.hypot(quadril.x - joelho.x, quadril.y - joelho.y) : 80 * u;
  const R = Math.max(14 * u, Math.min(64 * u, coxa * 0.32));
  const vals = { ...(r.ang || {}), pe: r.angPe };
  const etqs = [];
  const quer = new Set(sel);
  const etq = (k, J, meio, dist) => {
    if (!quer.has(k) || vals[k] == null || !J) return;
    const d = defAng('lateral', k);
    etqs.push({ txt: `${d.rot} ${fmt(vals[k], d.un)}`, jx: J.x, jy: J.y, ax: J.x + Math.cos(meio) * dist, ay: J.y + Math.sin(meio) * dist });
  };
  const fora = (m) => m + Math.PI;   // etiqueta do lado de fora do ângulo
  if (quer.has('joelho') && quadril && joelho && tornozelo) etq('joelho', joelho, fora(arcoAngulo(g, quadril, joelho, tornozelo, R)), R + 34 * u);
  if (quer.has('quadril') && ombro && quadril && joelho) etq('quadril', quadril, fora(arcoAngulo(g, ombro, quadril, joelho, R)), R + 40 * u);
  if (quer.has('ombro') && quadril && ombro && cotovelo) etq('ombro', ombro, fora(arcoAngulo(g, quadril, ombro, cotovelo, R)), R + 40 * u);
  if (quer.has('cotovelo') && ombro && cotovelo && punho) etq('cotovelo', cotovelo, fora(arcoAngulo(g, ombro, cotovelo, punho, R * 0.8)), R + 30 * u);
  if (quer.has('tornozelo') && joelho && tornozelo && pe) etq('tornozelo', tornozelo, fora(arcoAngulo(g, joelho, tornozelo, pe, R * 0.7)), R + 30 * u);
  if (quer.has('tronco') && quadril && ombro) {
    const H = { x: quadril.x + dir * R * 2.2, y: quadril.y };
    linhaTracejada(g, quadril, H);
    const m = arcoAngulo(g, H, quadril, ombro, R * 1.6);
    etq('tronco', quadril, m, R * 1.6 + 30 * u);
  }
  if (quer.has('pe') && calc && pe) {
    const lado = Math.sign(pe.x - calc.x) || dir;
    const comp = Math.hypot(pe.x - calc.x, pe.y - calc.y);
    const H = { x: calc.x + lado * Math.max(comp * 1.3, R), y: calc.y };
    linhaTracejada(g, calc, H);
    const m = arcoAngulo(g, H, calc, pe, Math.max(12 * u, comp * 0.7));
    etq('pe', calc, m, comp * 0.7 + 34 * u);
  }
  for (const q of [ombro, cotovelo, punho, quadril, joelho, tornozelo, pe, calc]) if (q) ponto(g, q, 5.5 * u);
  desenharEtiquetas(g, etqs, area, u, obst);
}

function desenharFrontal(g, area, r, sel, paraArea, u, obst = []) {
  const minVis = r.minVis || 0.5;
  const P = (i) => (r.pts[i] && r.pts[i][2] >= minVis ? paraArea(r.pts[i]) : null);
  const f = r.frontal || {};
  const quer = new Set(sel);
  const etqs = [];
  g.lineCap = 'round';
  const seg = (a, b, w = 2.2) => {
    if (!a || !b) return;
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y);
    g.strokeStyle = C.esqueleto; g.lineWidth = w * u; g.stroke();
  };
  for (const l of ['e', 'd']) {
    const q = P(LM.quadril[l]), j = P(LM.joelho[l]), t = P(LM.tornozelo[l]);
    if (q && t) linhaTracejada(g, q, t, C.prumo);
    seg(q, j); seg(j, t);
    // o retrato traz o desvio no lado ANATÔMICO; com espelho, o lado do modelo é o outro
    const anat = r.espelhada ? (l === 'e' ? 'd' : 'e') : l;
    const k = anat === 'e' ? 'desvioE' : 'desvioD';
    const d = f[anat];
    if (j && quer.has(k) && d != null) {
      const lado = q && P(LM.quadril[l === 'e' ? 'd' : 'e']) ? Math.sign(q.x - P(LM.quadril[l === 'e' ? 'd' : 'e']).x) || 1 : 1;
      etqs.push({ txt: `${defAng('frontal', k).rot} ${num(Math.abs(d), 1)}% ${d > 0 ? 'dentro' : 'fora'}`, jx: j.x, jy: j.y, ax: j.x + lado * 70 * u, ay: j.y });
    }
  }
  const qE = P(LM.quadril.e), qD = P(LM.quadril.d), oE = P(LM.ombro.e), oD = P(LM.ombro.d);
  seg(qE, qD); seg(oE, oD); seg(oE, qE, 1.4); seg(oD, qD, 1.4);
  if (qE && qD && quer.has('pelve') && f.pelve != null) {
    etqs.push({ txt: `Pelve ${num(Math.abs(f.pelve), 1)}°`, jx: (qE.x + qD.x) / 2, jy: (qE.y + qD.y) / 2, ax: (qE.x + qD.x) / 2, ay: (qE.y + qD.y) / 2 - 30 * u });
  }
  if (oE && oD && quer.has('ombros') && f.ombros != null) {
    etqs.push({ txt: `Ombros ${num(Math.abs(f.ombros), 1)}°`, jx: (oE.x + oD.x) / 2, jy: (oE.y + oD.y) / 2, ax: (oE.x + oD.x) / 2, ay: (oE.y + oD.y) / 2 - 34 * u });
  }
  const I = r.I || {};
  const jm = I.joelho != null ? P(I.joelho) : null;
  if (jm && quer.has('joelho') && r.ang && r.ang.joelho != null) {
    etqs.push({ txt: `Joelho ${fmt(r.ang.joelho, '°')}`, jx: jm.x, jy: jm.y, ax: jm.x, ay: jm.y + 44 * u });
  }
  for (const i of [11, 12, 23, 24, 25, 26, 27, 28]) { const p = P(i); if (p) ponto(g, p, 5.5 * u); }
  desenharEtiquetas(g, etqs, area, u, obst);
}

// ------------------------------------------------------------------ curvas

/*
 * LIMPEZA DA SÉRIE (antes de desenhar)
 *   1. Faixa física: ângulo interno fora de 1..179° (ou desvio/inclinação
 *      absurdos) é pose errada — o "ombro 0°" que achatava a escala.
 *   2. Hampel: mediana ± 3·MAD numa janela de 7 amostras (com um piso, para
 *      não rejeitar a própria onda da pedalada quando a MAD é pequena).
 *   3. Pico isolado: subida E descida mais rápidas que VEL_MAX °/s para os
 *      dois vizinhos.
 * Com ~5 poses/s isso ainda deixa 3 amostras por pedalada; o desenho liga os
 * pontos com cúbica monotônica (sem "ondas" inventadas além dos extremos
 * medidos) e o modo "ciclo médio" dobra todas as pedaladas em 0–360°.
 */
const LIMITES = { pe: [-89, 89], desvioE: [-60, 60], desvioD: [-60, 60], pelve: [-45, 45], ombros: [-45, 45] };
const PISO_HAMPEL = { desvioE: 4, desvioD: 4, pelve: 4, ombros: 4, tronco: 8 };
const VEL_MAX = 1200;
const NB = 24;                         // bins do ciclo médio (15° cada)

const _w = [], _d = [];               // janelas reaproveitadas (sem alocar por ponto)
const porNumero = (x, y) => x - y;

/**
 * Decide se o ponto i fica (Hampel em ±3 vizinhos + pico isolado em ±1).
 * Só olha p[i-3..i+3]: é isso que permite a limpeza incremental abaixo.
 */
function pontoOk(p, i, piso) {
  const n = p.length;
  _w.length = 0;
  for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) _w.push(p[j].v);
  _w.sort(porNumero);
  const med = _w[_w.length >> 1];
  _d.length = 0;
  for (const x of _w) _d.push(Math.abs(x - med));
  _d.sort(porNumero);
  if (Math.abs(p[i].v - med) > Math.max(3 * 1.4826 * _d[_d.length >> 1], piso)) return false;
  if (i < 1 || i >= n - 1) return true;
  const v1 = ((p[i].v - p[i - 1].v) / Math.max(1, p[i].t - p[i - 1].t)) * 1000;
  const v2 = ((p[i + 1].v - p[i].v) / Math.max(1, p[i + 1].t - p[i].t)) * 1000;
  return !(Math.abs(v1) > VEL_MAX && Math.abs(v2) > VEL_MAX && Math.sign(v1) !== Math.sign(v2));
}

/** Ponto da amostra s para a curva k, ou null se fora da faixa física. */
function pontoDe(s, k, lim) {
  const v = s.a[k];
  return v != null && Number.isFinite(v) && v >= lim[0] && v <= lim[1] ? { t: s.t, v } : null;
}

function limparSerie(amostras, k) {
  const lim = LIMITES[k] || [1, 179];
  const p = [];
  for (const s of amostras) { const q = pontoDe(s, k, lim); if (q) p.push(q); }
  const piso = PISO_HAMPEL[k] || 12;
  return p.filter((_, i) => pontoOk(p, i, piso));
}

/**
 * Série limpa com cache INCREMENTAL. O histórico do canal é uma janela que
 * anda (amostra nova entra no fim, a velha sai do começo, o array é o mesmo).
 * Como cada ponto só depende dos vizinhos até 3 posições, basta reavaliar as
 * bordas: o resultado é idêntico a limparSerie() na série inteira, sem
 * refazer as ~500 medianas a cada amostra (era 3–4% da thread a 4×).
 */
function serieLimpa(cache, amostras, k) {
  const n = amostras.length;
  const pri = n ? amostras[0] : null, ult = n ? amostras[n - 1] : null;
  let c = cache.get(k);
  if (c && c.n === n && c.pri === pri && c.ult === ult) return c.s;   // nada mudou
  const lim = LIMITES[k] || [1, 179], piso = PISO_HAMPEL[k] || 12;
  // onde a janela antiga começa a coincidir com a nova
  let d = -1, m = 0;
  if (c && n) {
    const B = c.brutos;
    for (let i = 0; i < B.length; i++) if (B[i] === pri) { d = i; break; }
    m = d >= 0 ? B.length - d : 0;
    if (m <= 0 || m > n || amostras[m - 1] !== B[B.length - 1]) d = -1;
  }
  if (d < 0) {
    // primeira vez, sessão zerada, fonte nova…: refaz tudo
    const p = [], idx = [];
    amostras.forEach((s, i) => { const q = pontoDe(s, k, lim); if (q) { p.push(q); idx.push(i); } });
    const ok = p.map((_, i) => pontoOk(p, i, piso));
    c = { n, pri, ult, brutos: amostras.slice(), p, idx, ok, s: p.filter((_, i) => ok[i]) };
    cache.set(k, c);
    return c.s;
  }
  // saem do começo os pontos das amostras que caíram da janela
  let q = 0;
  while (q < c.idx.length && c.idx[q] < d) q++;
  const p = q ? c.p.slice(q) : c.p.slice(), ok = q ? c.ok.slice(q) : c.ok.slice();
  const idx = c.idx.slice(q).map((i) => i - d);
  const L = p.length;
  // entram no fim as amostras novas
  for (let i = m; i < n; i++) { const pt = pontoDe(amostras[i], k, lim); if (pt) { p.push(pt); idx.push(i); ok.push(true); } }
  // reavalia as bordas cuja vizinhança mudou
  if (q) for (let i = 0; i < Math.min(4, p.length); i++) ok[i] = pontoOk(p, i, piso);
  if (p.length > L) for (let i = Math.max(0, L - 4); i < p.length; i++) ok[i] = pontoOk(p, i, piso);
  c = { n, pri, ult, brutos: amostras.slice(), p, idx, ok, s: p.filter((_, i) => ok[i]) };
  cache.set(k, c);
  return c.s;
}

/** Período mediano da pedalada (ms) pelas marcas de PMI, ou null. */
function periodoMedio(marcas) {
  const ts = marcas.filter((m) => m.tipo === 'PMI').map((m) => m.t);
  const d = [];
  for (let i = 1; i < ts.length; i++) { const x = ts[i] - ts[i - 1]; if (x > 250 && x < 2500) d.push(x); }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}
/** periodoMedio com memória: as marcas só mudam quando chega um PMI/PMS. */
const memoPer = { arr: null, n: -1, pri: null, ult: null, v: null };
function periodoMedioMemo(marcas) {
  const n = marcas.length, pri = n ? marcas[0] : null, ult = n ? marcas[n - 1] : null;
  const M = memoPer;
  if (M.arr !== marcas || M.n !== n || M.pri !== pri || M.ult !== ult) Object.assign(M, { arr: marcas, n, pri, ult, v: periodoMedio(marcas) });
  return M.v;
}

/** Primeiro índice da série (ordenada por t) com t >= x. */
function desde(serie, x) {
  let a = 0, b = serie.length;
  while (a < b) { const m = (a + b) >> 1; if (serie[m].t < x) a = m + 1; else b = m; }
  return a;
}
/** Primeiro índice da série com t > x. */
function depois(serie, x) {
  let a = 0, b = serie.length;
  while (a < b) { const m = (a + b) >> 1; if (serie[m].t <= x) a = m + 1; else b = m; }
  return a;
}

/** Cúbica monotônica (Fritsch–Butland) por pontos com x crescente: sem passar dos extremos medidos. */
function caminhoSuave(g, P) {
  const n = P.length;
  if (!n) return;
  g.moveTo(P[0].x, P[0].y);
  if (n === 1) { g.lineTo(P[0].x + 0.5, P[0].y); return; }
  const h = [], s = [];
  for (let i = 0; i < n - 1; i++) { h.push(Math.max(1e-6, P[i + 1].x - P[i].x)); s.push((P[i + 1].y - P[i].y) / h[i]); }
  const m = new Array(n);
  m[0] = s[0]; m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = s[i - 1] * s[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / s[i - 1] + (h[i] + 2 * h[i - 1]) / s[i]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = P[i], b = P[i + 1], d = h[i] / 3;
    g.bezierCurveTo(a.x + d, a.y + m[i] * d, b.x - d, b.y - m[i + 1] * d, b.x, b.y);
  }
}

/** Valor da série em t (interpolação linear entre as amostras vizinhas), ou null. */
function valorEm(serie, t) {
  if (!serie.length || t < serie[0].t) return null;
  for (let i = serie.length - 1; i >= 0; i--) {
    if (serie[i].t <= t) {
      const a = serie[i], b = serie[i + 1];
      if (!b || b.t - a.t > 1500) return a.v;
      return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
    }
  }
  return null;
}

/** Faixas alvo do perfil para cada curva (o joelho tem duas: PMI e PMS). */
function faixasDe(k, perfil) {
  switch (k) {
    case 'tronco': return [perfil.tronco];
    case 'ombro': return [perfil.ombro];
    case 'quadril': return [perfil.quadrilMin];
    case 'joelho': return [perfil.joelhoPMI, perfil.joelhoPMS];
    case 'cotovelo': return [perfil.cotovelo];
    case 'tornozelo': return [perfil.tornozeloPMI];
    case 'desvioE': case 'desvioD': return [FRONTAL.desvio];
    case 'pelve': case 'ombros': return [[-FRONTAL.pelve, FRONTAL.pelve]];
    default: return [];
  }
}
/** Chaves de alvo (canal.alvosSessao) por curva: marca a curva com alvo personalizado. */
const CHAVES_DA_CURVA = { tronco: ['tronco'], ombro: ['ombro'], quadril: ['quadrilMin'], joelho: ['joelhoPMI', 'joelhoPMS'], cotovelo: ['cotovelo'], tornozelo: ['tornozeloPMI'] };
/** Linha da tabela que dá a cor (status) de cada curva — a mesma cor da tabela. */
const LINHA_DA_CURVA = { tronco: 'troncoMed', ombro: 'ombroMed', quadril: 'quadrilMin', cotovelo: 'cotoveloMed', tornozelo: 'tornozeloPMI', desvioE: 'desvioE', desvioD: 'desvioD' };
function statusCurva(k, v, ind) {
  const perfil = ind.perfil;
  if (k === 'joelho') {
    if (v == null) return 'sem';
    // joelho perto da extensão compara com o PMI, perto da flexão com o PMS (como o overlay do operador)
    return status(v, v > (perfil.joelhoPMI[0] + perfil.joelhoPMS[1]) / 2 ? perfil.joelhoPMI : perfil.joelhoPMS);
  }
  if (k === 'pelve' || k === 'ombros') return v == null ? 'sem' : status(Math.abs(v), [0, FRONTAL.pelve], 3);
  const l = ind.linhas.find((x) => x.k === LINHA_DA_CURVA[k]);
  return l ? l.st : 'sem';
}

const GLIFO = { ok: '✓', perto: '~', fora: '!', sem: '–' };
/** Selo de status: cor + símbolo (verde/amarelo/vermelho se distinguem também sem cor). */
function selo(g, x, y, r, st) {
  g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI);
  g.fillStyle = C.st[st] || C.st.sem; g.fill();
  g.strokeStyle = C.seloBorda; g.lineWidth = 1; g.stroke();
  texto(g, GLIFO[st] || '–', x, y + 0.5, { tam: r * 1.35, peso: 800, cor: C.seloGlifo, alinha: 'center', base: 'middle' });
}

/**
 * Escala vertical estável: faixa robusta dos dados (p5–p95) ∪ faixas alvo,
 * arredondada a 5°. Cresce logo (suave); só encolhe depois de 2 s pedindo
 * menos — não pula a cada quadro e nunca abre para um ponto fora da curva.
 */
function ajustarEscala(esc, lo, hi, minSpan, agora) {
  let span = Math.max(minSpan, hi - lo);
  const c = (lo + hi) / 2;
  const a = Math.floor((c - span * 0.58) / 5) * 5, b = Math.ceil((c + span * 0.58) / 5) * 5;
  if (esc.lo == null) { esc.lo = a; esc.hi = b; esc.desde = null; return esc; }
  span = esc.hi - esc.lo;
  if (a < esc.lo - 0.5 || b > esc.hi + 0.5) {
    esc.desde = null;
    esc.lo += (Math.min(a, esc.lo) - esc.lo) * 0.25;
    esc.hi += (Math.max(b, esc.hi) - esc.hi) * 0.25;
  } else if (span > 1.35 * (b - a) || a > esc.lo + 0.25 * span || b < esc.hi - 0.25 * span) {
    esc.desde = esc.desde || agora;
    if (agora - esc.desde > 2000) { esc.lo += (a - esc.lo) * 0.06; esc.hi += (b - esc.hi) * 0.06; }
  } else esc.desde = null;
  return esc;
}

/** Faixas alvo: banda translúcida no destaque, bordas tracejadas e os limites escritos à direita. */
function desenharFaixas(g, faixas, Y, px, pw, py, ph, u) {
  for (const f of faixas) {
    if (!f) continue;
    const y1 = Math.max(py, Math.min(py + ph, Y(f[1]))), y2 = Math.max(py, Math.min(py + ph, Y(f[0])));
    if (y2 - y1 < 0.5) continue;
    g.fillStyle = C.alvoFundo;
    g.fillRect(px, y1, pw, y2 - y1);
    g.setLineDash([3, 4]);
    g.strokeStyle = C.alvoBorda; g.lineWidth = 1;
    g.beginPath(); g.moveTo(px, Math.round(y1) + 0.5); g.lineTo(px + pw, Math.round(y1) + 0.5);
    g.moveTo(px, Math.round(y2) + 0.5); g.lineTo(px + pw, Math.round(y2) + 0.5); g.stroke();
    g.setLineDash([]);
    const fs = 9 * u;
    if (y2 - y1 > fs * 3) {
      texto(g, num(f[1], 0), px + pw - 3 * u, y1 + fs + 1, { tam: fs, peso: 600, cor: C.alvoTexto, alinha: 'right' });
      texto(g, num(f[0], 0), px + pw - 3 * u, y2 - 3, { tam: fs, peso: 600, cor: C.alvoTexto, alinha: 'right' });
    } else {
      texto(g, `${num(f[0], 0)}–${num(f[1], 0)}`, px + pw - 3 * u, y1 - 2, { tam: fs, peso: 600, cor: C.alvoTexto, alinha: 'right' });
    }
  }
}

/**
 * Faixa robusta (p5–p95) da janela [i0, i1) da série, com memória por curva:
 * só é refeita quando a janela ganha ou perde ponto.
 */
function faixaRobustaMemo(cache, k, serie, i0, i1) {
  const ch = 'rob|' + k;
  const c = cache.get(ch);
  if (c && c.serie === serie && c.i0 === i0 && c.i1 === i1) return c.v;
  // ordenação numérica nativa (Float64Array): bem mais rápida que sort com comparador
  let v = null;
  if (i1 > i0) {
    const a = new Float64Array(i1 - i0);
    for (let i = i0; i < i1; i++) a[i - i0] = serie[i].v;
    a.sort();
    v = [a[Math.floor((a.length - 1) * 0.05)], a[Math.ceil((a.length - 1) * 0.95)]];
  }
  cache.set(ch, { serie, i0, i1, v });
  return v;
}

/*
 * CADA GRÁFICO EM TRÊS PASSOS
 *   prepararGrafico   série, valor atual, status, faixas e a ESCALA (ajustada
 *                     uma vez por quadro desenhado) + a descrição do fundo;
 *   desenharFundoGrafico  título, alvo, faixas-alvo, eixo (e a grade de fase do
 *                     ciclo médio): vai para a camada estática, refeita só
 *                     quando a descrição muda (escala, alvos, layout);
 *   desenharGrafico   o que anda: valor, selo, grade do tempo, curva, agora.
 */
function prepararGrafico(box, def, est, u) {
  const { dados, escalas, ind, modo, cache } = est;
  const { amostras, marcas, tAgora } = dados;
  const serie = serieLimpa(cache, amostras, def.k);
  const ultimo = serie.length ? serie[serie.length - 1] : null;
  const atual = ultimo && tAgora - ultimo.t < 1500 ? valorEm(serie, Math.min(tAgora, ultimo.t)) : null;
  const st = statusCurva(def.k, atual, ind);
  const faixas = faixasDe(def.k, ind.perfil).filter(Boolean);
  const pers = (CHAVES_DA_CURVA[def.k] || []).some((c) => ind.alvos && ind.alvos.linhas[c] && ind.alvos.linhas[c].mudou);

  // título, valor, alvo
  const lw = Math.min(170 * u, box.w * 0.33);
  const tamV = Math.max(15, Math.min(32 * u, box.h * 0.36));
  const tamT = Math.max(9, Math.min(12.5 * u, box.h * 0.16));
  const yT = box.y + Math.max(tamT + 4, box.h * 0.3);
  const alvo = faixas.length && box.h > tamT + tamV * 1.05 + 22 * u
    ? `alvo ${faixas.map((f) => `${num(f[0], 0)}–${num(f[1], 0)}`).join(' · ')}${def.un}${pers ? ' • atleta' : ''}` : null;
  const P = { box, def, serie, atual, st, lw, tamV, yT, R: null, anim: false };
  // fundo: tudo o que não muda de um quadro para outro (vira chave da camada estática)
  P.fundo = { box, titulo: def.titulo, u, lw, tamT, yT, tamV, alvo, R: null, modo, faixas, lo: null, hi: null };

  const px = box.x + lw, pw = box.w - lw - 8 * u, py = box.y + 7 * u, ph = box.h - 14 * u;
  if (pw < 30 || ph < 12) return P;
  P.R = P.fundo.R = { px, pw, py, ph };
  let esc, lo = Infinity, hi = -Infinity, ajusta = false;
  if (modo === 'ciclo') {
    const ib = depois(serie, tAgora + 600);
    const ch = 'ciclo|' + def.k, mc = marcas.length;
    let c = cache.get(ch);
    if (!c || c.serie !== serie || c.ib !== ib || c.marcas !== marcas || c.mc !== mc || c.pri !== marcas[0] || c.ult !== marcas[mc - 1]) {
      c = { serie, ib, marcas, mc, pri: marcas[0], ult: marcas[mc - 1], v: cicloMedio(ib === serie.length ? serie : serie.slice(0, ib), marcas) };
      cache.set(ch, c);
    }
    P.c = c.v;
    esc = escalas[def.k + '|c'] || (escalas[def.k + '|c'] = {});
    if (P.c.voltas >= 3) {
      ajusta = true;
      for (let i = 0; i < NB; i++) { lo = Math.min(lo, P.c.m[i] - P.c.dp[i]); hi = Math.max(hi, P.c.m[i] + P.c.dp[i]); }
    }
  } else {
    const t0 = tAgora - JANELA_MS * AGORA;
    const ia = desde(serie, t0 - 1500), ib = Math.max(ia, depois(serie, tAgora + 600));
    P.vis = serie.slice(ia, ib);
    const ir = Math.min(ib, Math.max(ia, desde(serie, t0)));
    const rob = faixaRobustaMemo(cache, def.k, serie, ir, ib);
    esc = escalas[def.k] || (escalas[def.k] = {});
    if (rob || faixas.length) { ajusta = true; if (rob) { lo = rob[0]; hi = rob[1]; } }
  }
  if (ajusta) {
    for (const f of faixas) { lo = Math.min(lo, f[0]); hi = Math.max(hi, f[1]); }
    const a = esc.lo, b = esc.hi;
    ajustarEscala(esc, lo, hi, def.un === '%' ? 8 : 16, performance.now());
    P.anim = esc.lo !== a || esc.hi !== b;            // escala andando: redesenhar no próximo quadro
  }
  P.esc = esc;
  if (esc.lo != null && (modo !== 'ciclo' || P.c.voltas >= 3)) { P.fundo.lo = esc.lo; P.fundo.hi = esc.hi; }
  return P;
}

/** Parte estática de um gráfico (camada de fundo), a partir da descrição de prepararGrafico. */
function desenharFundoGrafico(g, d) {
  const { box, u } = d;
  g.save();
  g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  texto(g, d.titulo, box.x + 10 * u, d.yT, { tam: d.tamT, peso: 500, cor: C.tinta2, max: d.lw - 14 * u });
  if (d.alvo) texto(g, d.alvo, box.x + 10 * u, d.yT + d.tamV * 1.05 + 14 * u, { tam: 10 * u, cor: C.alvoTexto, max: d.lw - 14 * u });
  if (d.R) {
    const { px, pw, py } = d.R;
    let { ph } = d.R;
    if (d.modo === 'ciclo') {
      // grade de fase: PMI (0/360), 90, 180, 270 — a escala de fase fica numa faixa própria embaixo da curva
      const fs = 9 * u;
      ph = d.R.ph - fs - 3 * u;
      const X = (f) => px + f * pw;
      g.lineWidth = 1;
      g.strokeStyle = C.gradeFase;
      g.beginPath();
      for (const f of [0.25, 0.5, 0.75]) { const x = Math.round(X(f)) + 0.5; g.moveTo(x, py); g.lineTo(x, py + ph); }
      g.stroke();
      g.strokeStyle = C.gradeBorda;
      g.beginPath(); g.moveTo(Math.round(X(0)) + 0.5, py); g.lineTo(Math.round(X(0)) + 0.5, py + ph);
      g.moveTo(Math.round(X(1)) - 0.5, py); g.lineTo(Math.round(X(1)) - 0.5, py + ph); g.stroke();
      for (const [f, rot] of [[0, 'PMI'], [0.25, '90°'], [0.5, '180°'], [0.75, '270°'], [1, 'PMI']]) {
        texto(g, rot, Math.max(px + 2, Math.min(px + pw - 2, X(f))), py + ph + fs + 2 * u, { tam: fs, cor: C.eixo, alinha: f === 0 ? 'left' : f === 1 ? 'right' : 'center' });
      }
    }
    if (d.lo != null) {
      const Y = (v) => py + ph - ((v - d.lo) / (d.hi - d.lo)) * ph;
      desenharFaixas(g, d.faixas, Y, px, pw, py, ph, u);
      eixoY(g, d, px, py, ph, u);
    }
  }
  g.restore();
}

/** Um gráfico (parte que anda): valor com o selo de status à esquerda; curva à direita. */
function desenharGrafico(g, P, est, u) {
  const { box } = P;
  const { marcas, tAgora } = est.dados;
  g.save();
  g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  const valTxt = fmt(P.atual, P.def.un);
  texto(g, valTxt, box.x + 10 * u, P.yT + P.tamV * 1.05, { tam: P.tamV, peso: 700, cor: C.tinta, max: P.lw - 34 * u });
  g.font = `700 ${P.tamV}px ${FONTE}`;
  const vw = Math.min(P.lw - 34 * u, g.measureText(valTxt).width);
  if (P.atual != null && P.st !== 'sem') selo(g, box.x + 10 * u + vw + 11 * u, P.yT + P.tamV * 0.68, 7 * u, P.st);
  if (P.R) {
    if (est.modo === 'ciclo') desenharCiclo(g, P, tAgora, u);
    else desenharTempo(g, P, marcas, tAgora, u);
  }
  g.restore();
}

function eixoY(g, esc, px, py, ph, u) {
  texto(g, num(esc.hi, 0), px + 3 * u, py + 9 * u, { tam: 9 * u, cor: C.eixo });
  texto(g, num(esc.lo, 0), px + 3 * u, py + ph - 3 * u, { tam: 9 * u, cor: C.eixo });
}

function desenharTempo(g, P, marcas, tAgora, u) {
  const { px, pw, py, ph } = P.R;
  const { atual, st, vis, esc } = P;
  const t0 = tAgora - JANELA_MS * AGORA, t1 = t0 + JANELA_MS;
  const X = (t) => px + ((t - t0) / JANELA_MS) * pw;
  const xA = X(tAgora);
  // grade: um traço fino por segundo, um mais claro em cada PMI
  g.lineWidth = 1;
  g.strokeStyle = C.gradeSeg;
  g.beginPath();
  for (let s = Math.ceil(t0 / 1000) * 1000; s <= t1; s += 1000) { const x = Math.round(X(s)) + 0.5; g.moveTo(x, py); g.lineTo(x, py + ph); }
  g.stroke();
  const pmis = marcas.filter((m) => m.tipo === 'PMI' && m.t >= t0 - 3000 && m.t <= tAgora).map((m) => m.t);
  g.strokeStyle = C.gradePMI;
  g.beginPath();
  for (const t of pmis) if (t >= t0) { const x = Math.round(X(t)) + 0.5; g.moveTo(x, py); g.lineTo(x, py + ph); }
  g.stroke();

  if (esc.lo == null) return;
  const Y = (v) => py + ph - ((v - esc.lo) / (esc.hi - esc.lo)) * ph;
  // (faixas-alvo e eixo estão na camada de fundo)

  // trechos: buraco curto (< meia pedalada, mín. 0,6 s) é ponte da curva; longo vira tracejado fraco
  const per = periodoMedioMemo(marcas);
  const ponte = Math.max(600, per ? per * 0.5 : 0);
  const trechos = [];
  let cur = [];
  for (const s of vis) {
    if (cur.length && s.t - cur[cur.length - 1].t > ponte) { trechos.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) trechos.push(cur);
  g.save();
  g.beginPath(); g.rect(px, py - 2, Math.max(0, xA - px), ph + 4); g.clip();
  g.setLineDash([3, 5]); g.strokeStyle = C.ponte; g.lineWidth = 1.2 * u;
  g.beginPath();
  for (let i = 1; i < trechos.length; i++) {
    const a = trechos[i - 1][trechos[i - 1].length - 1], b = trechos[i][0];
    g.moveTo(X(a.t), Y(a.v)); g.lineTo(X(b.t), Y(b.v));
  }
  g.stroke(); g.setLineDash([]);
  g.beginPath();
  for (const tr of trechos) caminhoSuave(g, tr.map((s) => ({ x: X(s.t), y: Y(s.v) })));
  g.strokeStyle = C.curva; g.lineWidth = 1.7 * u; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
  // mínimo e máximo de cada pedalada (discretos)
  g.fillStyle = C.minmax;
  for (let i = 1; i < pmis.length; i++) {
    // amostras com pmis[i-1] < t <= pmis[i] (vis está em ordem de t: busca binária, sem filtrar a janela toda)
    let n = 0, mn = null, mx = null;
    for (let j = depois(vis, pmis[i - 1]); j < vis.length && vis[j].t <= pmis[i]; j++) {
      const s = vis[j];
      if (!n) { mn = s; mx = s; } else { if (s.v < mn.v) mn = s; if (s.v > mx.v) mx = s; }
      n++;
    }
    if (n < 2) continue;
    const r = 3 * u;
    let x = X(mx.t), y = Y(mx.v) - 5 * u;
    g.beginPath(); g.moveTo(x, y + r); g.lineTo(x - r, y - r * 0.6); g.lineTo(x + r, y - r * 0.6); g.closePath(); g.fill();
    x = X(mn.t); y = Y(mn.v) + 5 * u;
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x - r, y + r * 0.6); g.lineTo(x + r, y + r * 0.6); g.closePath(); g.fill();
  }
  g.restore();

  // linha "agora" e o ponto atual na cor do status
  g.beginPath(); g.moveTo(Math.round(xA) + 0.5, py - 2); g.lineTo(Math.round(xA) + 0.5, py + ph + 2);
  g.strokeStyle = C.curva; g.lineWidth = 1.4; g.stroke();
  if (atual != null) {
    g.beginPath(); g.arc(xA, Y(atual), 4.2 * u, 0, 2 * Math.PI);
    g.fillStyle = C.st[st] || C.curva; g.fill();
    g.strokeStyle = C.pontoBorda; g.lineWidth = 1.5; g.stroke();
  }
}

/** Dobra as pedaladas (PMI a PMI) em NB fases: média e desvio por fase. */
function cicloMedio(serie, marcas) {
  const pmi = marcas.filter((m) => m.tipo === 'PMI').map((m) => m.t).sort((a, b) => a - b);
  const per = periodoMedio(marcas);
  const soma = new Float64Array(NB), q = new Float64Array(NB), n = new Uint32Array(NB);
  let voltas = 0, j = 0;
  for (let i = 1; i < pmi.length; i++) {
    const a = pmi[i - 1], b = pmi[i], d = b - a;
    if (d < 250 || d > 2500 || (per && (d < 0.6 * per || d > 1.6 * per))) continue;
    while (j < serie.length && serie[j].t < a) j++;
    let k = j, usou = 0;
    for (; k < serie.length && serie[k].t <= b; k++) {
      const bin = Math.min(NB - 1, Math.floor(((serie[k].t - a) / d) * NB));
      soma[bin] += serie[k].v; q[bin] += serie[k].v * serie[k].v; n[bin]++; usou++;
    }
    if (usou) voltas++;
  }
  const m = new Array(NB).fill(null), dp = new Array(NB).fill(null);
  for (let i = 0; i < NB; i++) {
    if (!n[i]) continue;
    m[i] = soma[i] / n[i];
    dp[i] = n[i] > 1 ? Math.sqrt(Math.max(0, q[i] / n[i] - m[i] * m[i])) : null;
  }
  const preencher = (arr) => {
    const ok = arr.map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0);
    if (!ok.length) return false;
    for (let i = 0; i < NB; i++) {
      if (arr[i] != null) continue;
      let a = i, b = i, da = 0, db = 0;
      do { a = (a - 1 + NB) % NB; da++; } while (arr[a] == null && da < NB);
      do { b = (b + 1) % NB; db++; } while (arr[b] == null && db < NB);
      arr[i] = arr[a] + ((arr[b] - arr[a]) * da) / (da + db);
    }
    return true;
  };
  if (!preencher(m)) return { voltas: 0 };
  if (!preencher(dp)) dp.fill(0);
  // suaviza em volta (1-2-1, circular): com poucas poses por pedalada os bins são ruidosos
  const suave = (arr) => arr.map((v, i) => (arr[(i - 1 + NB) % NB] + 2 * v + arr[(i + 1) % NB]) / 4);
  return { voltas, m: suave(m), dp: suave(dp), per, ultPMI: pmi.length ? pmi[pmi.length - 1] : null };
}

function desenharCiclo(g, P, tAgora, u) {
  const fs = 9 * u;
  // a escala de fase (PMI · 90° · 180° · 270° · PMI) fica numa faixa própria embaixo da curva (grade e rótulos: camada de fundo)
  const { px, pw, py } = P.R, ph = P.R.ph - fs - 3 * u;
  const { c, esc, atual, st } = P;
  const X = (f) => px + f * pw;
  if (c.voltas < 3 || esc.lo == null) {
    texto(g, `Ciclo médio: aguardando pedaladas (${c.voltas || 0}/3)`, px + pw / 2, py + ph / 2, { tam: 11 * u, cor: C.espera, alinha: 'center', base: 'middle' });
    return;
  }
  const Y = (v) => py + ph - ((v - esc.lo) / (esc.hi - esc.lo)) * ph;
  // pontos nos centros dos bins, com um vizinho de cada lado (fecha a volta em 0 e 360)
  const Pm = [], sup = [], inf = [];
  for (let i = -1; i <= NB; i++) {
    const k = (i + NB) % NB, x = X((i + 0.5) / NB);
    Pm.push({ x, y: Y(c.m[k]) }); sup.push({ x, y: Y(c.m[k] + c.dp[k]) }); inf.push({ x, y: Y(c.m[k] - c.dp[k]) });
  }
  g.save();
  g.beginPath(); g.rect(px, py - 2, pw, ph + 4); g.clip();
  g.beginPath();
  caminhoSuave(g, sup);
  const infR = inf.slice().reverse();
  g.lineTo(infR[0].x, infR[0].y);
  for (const p of infR) g.lineTo(p.x, p.y);
  g.closePath();
  g.fillStyle = C.bandaCiclo; g.fill();
  g.beginPath(); caminhoSuave(g, Pm);
  g.strokeStyle = C.curva; g.lineWidth = 1.9 * u; g.lineJoin = 'round'; g.stroke();
  g.restore();
  texto(g, `${c.voltas} pedaladas · média ± dp`, px + pw / 2, py + 9 * u, { tam: fs, cor: C.sub, alinha: 'center' });
  // fase de agora
  if (c.per && c.ultPMI != null && atual != null) {
    const f = (((tAgora - c.ultPMI) % c.per) + c.per) % c.per / c.per;
    const x = X(f);
    g.beginPath(); g.moveTo(Math.round(x) + 0.5, py); g.lineTo(Math.round(x) + 0.5, py + ph);
    g.strokeStyle = C.faseAgora; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.arc(x, Y(atual), 4.2 * u, 0, 2 * Math.PI);
    g.fillStyle = C.st[st] || C.curva; g.fill();
    g.strokeStyle = C.pontoBorda; g.lineWidth = 1.5; g.stroke();
  }
}

// ------------------------------------------------------------------ indicadores

function caixa(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Quebra o texto em linhas de até `max` px (a primeira pode ser mais curta). */
function quebrar(g, txt, max, fonte, primeira = max) {
  g.font = fonte;
  const out = [];
  let cur = '';
  for (const w of String(txt).split(/\s+/).filter(Boolean)) {
    const lim = out.length ? max : primeira;
    const t = cur ? `${cur} ${w}` : w;
    if (cur && g.measureText(t).width > lim) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

/** Os 5 cartões: rpm, pedaladas, lado, poses/s (com a cor da amostragem) e perfil. */
function desenharKPIs(g, R, ind, u) {
  const taxa = ind.taxa;
  const corTaxa = taxa == null ? C.tinta : taxa >= TAXA_MIN ? C.stTxt.ok : taxa >= 7 ? C.stTxt.perto : C.stTxt.fora;
  const tiles = [
    { v: ind.cad ? String(Math.round(ind.cad)) : '—', l: 'rpm', cor: ind.cad ? C.tinta : C.destaque },
    { v: String(ind.pedaladas), l: 'pedaladas' },
    { v: ind.lado || '—', l: 'lado', menor: true },
    { v: taxa == null ? '—' : num(taxa, 1), l: R.w < 520 ? 'poses/s' : `poses/s · mín. ${TAXA_MIN}`, cor: corTaxa },
    { v: ind.perfilNome, l: 'perfil', menor: true },
  ];
  const gap = 6 * u, tw = (R.w - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = R.x + i * (tw + gap);
    caixa(g, x, R.y, tw, R.h, 8 * u);
    g.fillStyle = C.cartao; g.fill();
    g.strokeStyle = i === 3 && taxa != null ? corTaxa : C.cartaoBorda; g.lineWidth = 1; g.stroke();
    // o texto encolhe até caber no cartão ("esquerdo" num celular) antes de cortar
    let tam = Math.min(R.h * 0.42, 24 * u) * (t.menor ? 0.7 : 1);
    g.font = `700 ${tam}px ${FONTE}`;
    const larg = g.measureText(t.v).width;
    if (larg > tw - 10 * u) tam = Math.max(tam * 0.55, (tam * (tw - 10 * u)) / larg);
    texto(g, t.v, x + tw / 2, R.y + R.h * 0.5, { tam, peso: 700, cor: t.cor || C.tinta, alinha: 'center', base: 'middle', max: tw - 6 * u });
    texto(g, t.l, x + tw / 2, R.y + R.h - 7 * u, { tam: Math.min(10 * u, R.h * 0.2), cor: C.tinta2, alinha: 'center', max: tw - 8 * u });
  });
}

const TITULO_TAB = 20;
function linhasDaTabela(ind) { return ind.linhas.length + 1 + (ind.nota ? 1 : 0); }
function alturaTabela(ind, u, rh) { return TITULO_TAB * u + linhasDaTabela(ind) * rh; }

/** Geometria da tabela para o clique (abrir o editor do alvo nos Ajustes); sem tabela, sem clique. */
function geometriaTabela(hit, R, ind, u) {
  if (!R) { hit.chaves = null; return; }
  const rh = (R.h - TITULO_TAB * u) / linhasDaTabela(ind);
  hit.x = R.x; hit.w = R.w; hit.y0 = R.y + TITULO_TAB * u + rh; hit.rh = rh; hit.chaves = ind.linhas.map((l) => l.chave || null);
}

/** Tabela de ângulos (as mesmas linhas do painel: linhasTabelaBikeFit). */
function desenharTabela(g, R, ind, minmax, u) {
  const mm = minmax && !ind.frontal;
  const rh = (R.h - TITULO_TAB * u) / linhasDaTabela(ind);
  const fs = Math.max(9, Math.min(12.5 * u, rh * 0.58));
  texto(g, ind.frontal ? 'ALINHAMENTO · VISTA FRONTAL' : `ÂNGULOS · ÚLTIMAS ${ind.nCiclos} PEDALADAS`, R.x + 6 * u, R.y + 13 * u,
    { tam: 10.5 * u, peso: 800, cor: C.destaque, max: R.w * 0.6 });
  texto(g, `alvo: ${ind.perfilNome}${ind.personalizado ? ` · ${ind.atletaNome} •` : ''}`, R.x + R.w - 6 * u, R.y + 13 * u,
    { tam: 10.5 * u, cor: ind.personalizado ? C.destaque : C.tinta2, alinha: 'right', max: R.w * 0.38 });
  const fr = mm ? [0.29, 0.12, 0.19, 0.15, 0.17, 0.08] : [0.35, 0.13, 0.21, 0.21, 0.1];
  const xs = []; let acc = R.x + 6 * u;
  const largura = R.w - 12 * u;
  for (const f of fr) { acc += f * largura; xs.push(acc); }
  const cab = mm ? ['Medida', 'Agora', 'Média±dp', 'mín/máx', 'Alvo', ''] : ['Medida', 'Agora', 'Média±dp', 'Alvo', ''];
  let y = R.y + TITULO_TAB * u;
  const iAlvo = cab.length - 2;
  const celula = (vals, cor, peso, tam, corAlvo = cor) => {
    vals.forEach((v, i) => {
      if (i === vals.length - 1) return;
      const esq = i === 0;
      texto(g, v, esq ? R.x + 6 * u : xs[i] - 4 * u, y + rh * 0.66, { tam, peso: i === iAlvo && corAlvo !== cor ? 700 : peso, cor: i === iAlvo ? corAlvo : cor, alinha: esq ? 'left' : 'right', max: (esq ? xs[0] - R.x : fr[i] * largura) - 8 * u });
    });
  };
  celula(cab, C.sub, 600, fs * 0.85);
  g.fillStyle = C.linhaTabela; g.fillRect(R.x, y + rh - 1, R.w, 1);
  y += rh;
  ind.linhas.forEach((l, i) => {
    if (i % 2 === 0) { g.fillStyle = C.zebra; g.fillRect(R.x, y, R.w, rh); }
    // alvo personalizado: no destaque, com • (✎ se definido à mão)
    const alvo = l.mudou ? `${l.alvo}${l.override ? ' ✎' : ' •'}` : l.alvo;
    celula(mm ? [l.nome, l.agora, l.media, l.minmax, alvo, ''] : [l.nome, l.agora, l.media, alvo, ''], C.tinta, 500, fs, l.mudou ? C.destaque : C.tinta);
    selo(g, (xs[xs.length - 2] + xs[xs.length - 1]) / 2 + 2 * u, y + rh / 2, Math.min(7 * u, rh * 0.32), l.st);
    y += rh;
  });
  if (ind.nota) texto(g, ind.nota, R.x + 6 * u, y + rh * 0.66, { tam: fs * 0.9, cor: C.tinta2, max: R.w - 12 * u });
}

/**
 * Avisos e recomendações já quebrados em linhas para a largura `w`. As linhas
 * guardam o NOME da cor na paleta (não a cor): o plano fica em cache e a
 * paleta pode mudar depois (troca de tema, exportação no iaVision escuro).
 */
function montarNotas(g, w, est, u) {
  const { ind, prefs } = est;
  const B = prefs.blocos;
  const L = [];
  const lh = 15.5 * u, pad = 10 * u, rec = 16 * u;
  const fN = `400 ${12 * u}px ${FONTE}`, fB = `700 ${12 * u}px ${FONTE}`, fT = `800 ${10.5 * u}px ${FONTE}`, fS = `400 ${10.5 * u}px ${FONTE}`;
  const larg = w - 2 * pad;
  if (B.avisos && ind.avisos.length) {
    L.push({ txt: 'AVISOS DA MEDIÇÃO', font: fT, cor: 'destaque', x: 0 });
    for (const a of ind.avisos) {
      quebrar(g, a, larg - rec, fN).forEach((t, i) => L.push({ txt: t, font: fN, cor: 'aviso', x: rec, icone: i === 0 ? '⚠' : null }));
    }
  }
  if (B.recs) {
    L.push({ txt: `RECOMENDAÇÕES · ${ind.perfilNome}`, font: fT, cor: 'destaque', x: 0, gap: L.length ? 6 * u : 0 });
    if (!ind.recs.length) L.push({ txt: 'Pedale alguns ciclos com cadência constante.', font: fN, cor: 'tinta2', x: 0 });
    for (const r of ind.recs) {
      const pre = `${r.area}: `;
      g.font = fB;
      const pw = g.measureText(pre).width;
      quebrar(g, r.texto, larg - rec, fN, larg - rec - pw).forEach((t, i) => L.push({
        txt: t, font: fN, cor: 'tinta', x: rec + (i === 0 ? pw : 0),
        ...(i === 0 ? { pre, preFont: fB, dot: r.nivel in COR_STATUS ? r.nivel : 'sem' } : {}),
      }));
    }
    quebrar(g, NOTA_RECS, larg, fS).forEach((t, i) => L.push({ txt: t, font: fS, cor: 'sub', x: 0, gap: i === 0 ? 4 * u : 0 }));
  }
  const h = L.length ? L.reduce((s, l) => s + lh + (l.gap || 0), 0) + 2 * pad : 0;
  return { L, h, lh, pad };
}

function desenharNotas(g, R, notas, u) {
  if (!notas.L.length) return;
  caixa(g, R.x, R.y, R.w, R.h, 8 * u);
  g.fillStyle = C.notasFundo; g.fill();
  g.strokeStyle = C.notasBorda; g.lineWidth = 1; g.stroke();
  const { L, lh, pad } = notas;
  let y = R.y + pad;
  const fim = R.y + R.h - pad;
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    y += l.gap || 0;
    if (y + lh > fim && i < L.length - 1) {
      texto(g, `… mais ${L.length - i} linhas: veja o Relatório`, R.x + pad, y + lh * 0.75, { tam: 11 * u, cor: C.tinta2 });
      break;
    }
    const base = y + lh * 0.75;
    if (l.icone) texto(g, l.icone, R.x + pad, base, { tam: 12 * u, cor: C.aviso });
    if (l.dot) { g.beginPath(); g.arc(R.x + pad + 5 * u, base - 4 * u, 4.5 * u, 0, 2 * Math.PI); g.fillStyle = C.st[l.dot] || C.st.sem; g.fill(); }
    if (l.pre) { g.font = l.preFont; g.fillStyle = C.tinta; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillText(l.pre, R.x + pad + 16 * u, base); }
    g.font = l.font; g.fillStyle = C[l.cor]; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(l.txt, R.x + pad + l.x, base);
    y += lh;
  }
}

function desenharLogo(g, img, x, y, w, h, cor = C.logoRodape) {
  if (img && img.complete && img.naturalWidth) {
    const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * k, ih = img.naturalHeight * k;
    g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    return;
  }
  // marca padrão: uma bicicleta em traço
  const s = Math.min(w, h), cx = x + w / 2, cy = y + h / 2, rr = s * 0.2;
  g.save();
  g.strokeStyle = cor; g.lineWidth = Math.max(1.2, s * 0.06); g.lineJoin = 'round'; g.lineCap = 'round';
  const a = { x: cx - s * 0.27, y: cy + s * 0.12 }, b = { x: cx + s * 0.27, y: cy + s * 0.12 };
  g.beginPath(); g.arc(a.x, a.y, rr, 0, 2 * Math.PI); g.stroke();
  g.beginPath(); g.arc(b.x, b.y, rr, 0, 2 * Math.PI); g.stroke();
  g.beginPath();
  g.moveTo(a.x, a.y); g.lineTo(cx - s * 0.02, cy + s * 0.12); g.lineTo(cx + s * 0.16, cy - s * 0.14); g.lineTo(cx - s * 0.12, cy - s * 0.14); g.closePath();
  g.moveTo(cx + s * 0.16, cy - s * 0.14); g.lineTo(b.x, b.y);
  g.moveTo(cx - s * 0.12, cy - s * 0.14); g.lineTo(cx - s * 0.16, cy - s * 0.24);
  g.stroke();
  g.restore();
}

/** Tela "estreita" (celular, retrato): tudo empilhado, o palco rola. */
const ehEstreito = (W, H) => W < 760 || H > W * 1.05;
const escalaU = (W, estreito) => (estreito ? Math.max(0.78, Math.min(1, W / 430)) : Math.max(0.85, Math.min(1.35, W / 1440)));

/**
 * Plano do celular: vídeo, cartões, gráficos, tabela, avisos/recomendações,
 * rodapé. Devolve a altura total (o canvas cresce e o palco rola) e os retângulos.
 */
function planoEstreito(g, W, est) {
  const u = escalaU(W, true), B = est.prefs.blocos;
  const sw = Math.round(24 * u), cx = sw, cw = W - sw, gap = Math.round(8 * u), m = 8 * u;
  let y = 0;
  const video = { x: cx, y, w: cw, h: Math.round(Math.min(cw * 0.66, 300 * u)) };
  y += video.h + gap;
  let kpis = null, tabela = null, notasR = null;
  if (B.kpis) { kpis = { x: cx + m, y, w: cw - 2 * m, h: Math.round(56 * u) }; y += kpis.h + gap; }
  const graf = { x: cx, y, w: cw, h: Math.round(est.sel.length * 96 * u) };
  y += graf.h + gap;
  if (B.tabela) { tabela = { x: cx + m, y, w: cw - 2 * m, h: alturaTabela(est.ind, u, 23 * u) }; y += tabela.h + gap; }
  const notas = (B.avisos || B.recs) ? montarNotas(g, cw - 2 * m, est, u) : { L: [], h: 0 };
  if (notas.h) { notasR = { x: cx + m, y, w: cw - 2 * m, h: notas.h }; y += notas.h + gap; }
  const fh = Math.round(74 * u);
  return { u, sw, fh, topoH: y, H: y + fh, video, kpis, graf, tabela, notasR, notas, estreito: true };
}

/** Plano do computador: vídeo + cartões + tabela à esquerda; gráficos + avisos/recomendações à direita. Sem rolagem. */
function planoLargo(g, W, H, est) {
  const u = escalaU(W, false), B = est.prefs.blocos;
  const fh = Math.round(66 * u), sw = Math.round(34 * u), topoH = H - fh, gap = Math.round(8 * u);
  const cx = sw, cw = W - sw;
  const colE = Math.round(cw * 0.5);
  const esq = { x: cx, w: colE }, dir = { x: cx + colE + gap, w: cw - colE - gap - Math.round(6 * u) };
  const kpiH = B.kpis ? Math.round(Math.max(48 * u, Math.min(64 * u, topoH * 0.075))) : 0;
  let tabela = null, kpis = null;
  let resto = topoH;
  if (B.kpis) resto -= kpiH + gap;
  if (B.tabela) {
    // a tabela fica com o que sobra acima de metade da altura para o vídeo, entre 15 e 23 px por linha
    const linhas = linhasDaTabela(est.ind);
    const disp = resto - topoH * 0.5 - gap - TITULO_TAB * u;
    const rh = Math.max(15 * u, Math.min(23 * u, disp / linhas));
    const th = alturaTabela(est.ind, u, rh);
    resto -= th + gap;
    tabela = { x: esq.x + 4 * u, w: esq.w - 8 * u, h: th };
  }
  const video = { x: esq.x, y: 0, w: esq.w, h: Math.round(resto) };
  let y = video.h + gap;
  if (B.kpis) { kpis = { x: esq.x + 4 * u, y, w: esq.w - 8 * u, h: kpiH }; y += kpiH + gap; }
  if (tabela) tabela.y = y;
  let notas = { L: [], h: 0 }, notasR = null;
  if (B.avisos || B.recs) {
    notas = montarNotas(g, dir.w, est, u);
    const h = Math.min(notas.h, topoH * 0.42);
    if (h) notasR = { x: dir.x, y: topoH - h - Math.round(6 * u), w: dir.w, h };
  }
  const graf = { x: dir.x, y: 0, w: dir.w, h: notasR ? notasR.y - gap : topoH };
  return { u, sw, fh, topoH, H, video, kpis, graf, tabela, notasR, notas, estreito: false };
}

/**
 * CAMADA DE FUNDO (canvas fora da tela): fundo, faixa lateral com "VISÃO
 * GERAL" e o logo, rodapé sem o relógio, divisórias e a parte estática de
 * cada gráfico (título, alvo, faixas-alvo, eixo). Refeita só quando o layout,
 * os alvos, a escala ou os textos do rodapé mudam; a cada quadro ela é só
 * copiada (drawImage) por baixo do que anda.
 */
function desenharFundo(g, W, H, est, plano, fundos) {
  const { u, sw, fh, topoH, graf, estreito } = plano;
  g.fillStyle = C.fundo; g.fillRect(0, 0, W, H);

  // faixa lateral com "VISÃO GERAL" e o logo
  g.fillStyle = C.faixa; g.fillRect(0, 0, sw, topoH);
  g.save();
  g.translate(sw / 2, estreito ? Math.min(topoH * 0.3, 220 * u) : topoH * 0.42);
  g.rotate(-Math.PI / 2);
  g.font = `800 ${13 * u}px ${FONTE}`;
  if ('letterSpacing' in g) g.letterSpacing = `${2.5 * u}px`;
  texto(g, 'VISÃO GERAL', 0, 0, { tam: 13 * u, peso: 800, alinha: 'center', base: 'middle', cor: C.faixaTinta });
  if ('letterSpacing' in g) g.letterSpacing = '0px';
  g.restore();
  desenharLogo(g, est.logoImg, 3 * u, topoH - sw - 6 * u, sw - 6 * u, sw - 6 * u, C.logoFaixa);

  // gráficos: parte estática e as divisórias
  const rh = graf.h / est.sel.length;
  fundos.forEach((d, i) => {
    if (d) desenharFundoGrafico(g, d);
    if (i) { g.fillStyle = C.divisoria; g.fillRect(graf.x + 8, Math.round(graf.y + i * rh), graf.w - 16, 1); }
  });

  // rodapé (o relógio é desenhado por cima, a cada segundo)
  const fy = topoH;
  g.fillStyle = C.linhaRodape; g.fillRect(0, fy, W, Math.max(2, Math.round(2 * u)));
  const p = est.prefs;
  if (estreito) {
    const m = 10 * u, l1 = fy + 20 * u, l2 = l1 + 17 * u, l3 = l2 + 16 * u;
    texto(g, est.ind.atletaNome || '—', m, l1, { tam: 14 * u, peso: 700, max: W * 0.5 });
    texto(g, `Sessão : ${dataBR(p.data)}`, m, l2, { tam: 11 * u, cor: C.tinta2, max: W * 0.5 });
    const lg = est.logoImg && est.logoImg.naturalWidth ? 34 * u : 0;
    const rx = W - m - (lg ? lg + 8 * u : 0);
    texto(g, p.estudio || '', rx, l1, { tam: 13 * u, peso: 700, alinha: 'right', max: W * 0.42 });
    texto(g, p.site || '', rx, l2, { tam: 10.5 * u, cor: C.tinta2, alinha: 'right', max: W * 0.42 });
    texto(g, p.telefone || '', rx, l3, { tam: 10.5 * u, cor: C.tinta2, alinha: 'right', max: W * 0.42 });
    if (lg) desenharLogo(g, est.logoImg, W - m - lg, fy + 12 * u, lg, fh - 22 * u);
  } else {
    const m = 18 * u, l1 = fy + fh * 0.44, l2 = fy + fh * 0.76;
    texto(g, est.ind.atletaNome || '—', sw + m, l1, { tam: 17 * u, peso: 700, max: W * 0.3 });
    texto(g, `Sessão : ${dataBR(p.data)}`, sw + m, l2, { tam: 12.5 * u, cor: C.tinta2, max: W * 0.3 });
    texto(g, est.vista === 'frontal' ? 'Vídeo frontal' : 'Vídeo lateral', W / 2, l1, { tam: 15 * u, peso: 700, alinha: 'center' });
    const lg = fh - 18 * u;
    desenharLogo(g, est.logoImg, W - m - lg, fy + 10 * u, lg, lg);
    const rx = W - m - lg - 14 * u;
    const info = [p.site, p.telefone].filter(Boolean).join('  ·  ');
    texto(g, p.estudio || '', rx, l1, { tam: 15 * u, peso: 700, alinha: 'right', max: W * 0.32 });
    texto(g, info, rx, l2, { tam: 12.5 * u, cor: C.tinta2, alinha: 'right', max: W * 0.32 });
  }
}

/** O relógio do rodapé (a única parte dele que muda sozinha). */
function desenharRelogio(g, W, est, plano) {
  const { u, fh, topoH: fy, estreito } = plano;
  const vistaTxt = est.vista === 'frontal' ? 'Vídeo frontal' : 'Vídeo lateral';
  if (estreito) {
    const l3 = fy + 20 * u + 17 * u + 16 * u;
    texto(g, `${vistaTxt} · ${agoraBR()}`, 10 * u, l3, { tam: 10.5 * u, cor: C.tinta2, max: W * 0.55 });
  } else {
    texto(g, agoraBR(), W / 2, fy + fh * 0.76, { tam: 12.5 * u, cor: C.tinta2, alinha: 'center' });
  }
}

/** Retângulos se tocam? */
const tocam = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * O que anda, por cima da camada de fundo, só nos blocos que tocam as
 * regiões a repintar (`regs`; null = o palco inteiro). Os gráficos já vêm
 * preparados (escala ajustada) em `preps`.
 */
function desenharFrente(g, W, est, plano, regs, preps) {
  const { u, video, kpis, tabela, notasR, notas, topoH, H } = plano;
  const toca = (r) => Boolean(r) && (!regs || regs.some((q) => tocam(q, r)));
  let videoDesenhado = false;
  if (toca(video)) { desenharVideo(g, video, est, u); videoDesenhado = true; }
  if (toca(kpis)) desenharKPIs(g, kpis, est.ind, u);
  if (toca(tabela)) desenharTabela(g, tabela, est.ind, est.prefs.minmax, u);
  for (const P of preps) if (P) desenharGrafico(g, P, est, u);
  if (toca(notasR)) desenharNotas(g, notasR, notas, u);
  if (toca({ x: 0, y: topoH, w: W, h: H - topoH })) desenharRelogio(g, W, est, plano);
  return videoDesenhado;
}

/** Indicadores do painel (mesmas funções do BikeFitPanel), recalculados ~3×/s fora do quadro. */
function montarIndicadores() {
  const no = store.get().nodes.find((n) => n.op === OP);
  const cfg = { ...defaultParams(OP), ...(no ? no.params : {}) };
  const sessao = obterSessao();
  const snap = instantaneo();
  const agora = performance.now();
  // alvos da sessão (modalidade + perfil do atleta + ajustes manuais): a mesma fonte do operador e do painel
  const alvos = alvosSessao(cfg.perfil);
  const perfil = alvos.faixas;
  const frontal = cfg.vista === 'frontal';
  const res = sessao.resumo(cfg.nCiclos || 10);
  const recente = Boolean(snap && agora - snap.t < 3000);
  return {
    alvos, atletaNome: obterAtleta().nome, personalizado: Object.values(alvos.linhas).some((l) => l.mudou),
    cad: sessao.cadencia(agora), pedaladas: sessao.pedaladas, lado: recente && !snap.sem ? snap.lado : null,
    taxa: recente && snap.taxa != null ? snap.taxa : null, perfilNome: cfg.perfil, perfil, nCiclos: cfg.nCiclos || 10, frontal,
    linhas: linhasTabelaBikeFit({ res, perfil, snap, recente, frontal, alvos }),
    nota: frontal ? notaFrontalBikeFit(res, snap, recente).texto : null,
    avisos: recente && snap.avisos ? snap.avisos : [], recs: recente && snap.recs ? snap.recs : [],
  };
}

// ------------------------------------------------------------------ redesenho sob demanda

/*
 * "O vídeo avançou?" O Viewport conta os quadros que pinta no canvas de
 * exibição (`display.quadros`); com o vídeo pausado ele não repinta e o número
 * não muda. O Studio não tem acesso ao <video> (a fonte pode ser câmera,
 * arquivo, YouTube, buffer…), por isso olha esse contador.
 */

/** Alguma escala esperando para encolher já passou dos 2 s (ver ajustarEscala)? */
function escalaVencida(escalas) {
  const agora = performance.now();
  for (const k in escalas) { const e = escalas[k]; if (e && e.desde != null && agora - e.desde > 2000) return true; }
  return false;
}

/*
 * RELATÓRIO NO TEMA. O relatório (cv/runtime/livres-e/relatorio.js) é uma
 * página branca feita para imprimir; aqui só se acrescenta, para a TELA
 * (@media screen), o fundo e as tintas do tema escolhido. Impresso / PDF
 * continua claro. As cores de status vêm inline no HTML do relatório e são
 * trocadas por seletor de atributo.
 */
const CSS_RELATORIO = {
  escuro: { fundo: '#02302C', tinta: '#FFFFFF', tinta2: '#CFEBE4', linha: 'rgba(255,255,255,.14)', linha2: 'rgba(255,255,255,.22)', cab: '#04413C',
    botao: '#FFD84D', botaoTinta: '#04413C', ok: '#8CE0C8', perto: '#FFD84D', fora: '#FF8A80', sem: '#CFEBE4' },
  code: { fundo: '#1E1E1E', tinta: '#CCCCCC', tinta2: '#ABABAB', linha: '#3C3C3C', linha2: '#3C3C3C', cab: '#252526',
    botao: '#FFD84D', botaoTinta: '#1E1E1E', ok: '#89D185', perto: '#FFD84D', fora: '#F48771', sem: '#ABABAB' },
};
function temaRelatorio(h, tema) {
  const c = CSS_RELATORIO[tema];
  if (!c) return h;                       // claro: o relatório já é claro
  const css = `<style>@media screen{:root{color-scheme:dark}body{background:${c.fundo};color:${c.tinta}}
h2{border-color:${c.linha2}}.meta,.nota{color:${c.tinta2}}td,th{border-color:${c.linha}}th{background:${c.cab}}
.kpis div,figure img{border-color:${c.linha2}}button{background:${c.botao};color:${c.botaoTinta};border:0;border-radius:7px;font-weight:600}
[style*="#15803d"]{color:${c.ok}!important}[style*="#a16207"]{color:${c.perto}!important}
[style*="#b91c1c"]{color:${c.fora}!important}[style*="#64748b"]{color:${c.sem}!important}}</style>`;
  return h.replace('</head>', `${css}</head>`);
}

// ------------------------------------------------------------------ componente

export function StudioBikeFit({ displayCanvas, onClose, onResetState }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const vista = no && no.params && no.params.vista === 'frontal' ? 'frontal' : 'lateral';
  const perfilNome = (no && no.params && no.params.perfil) || defaultParams(OP).perfil;
  const versaoAtleta = useAtleta();

  const [prefs, setPrefs] = useState(lerPrefs);
  const [ajustes, setAjustesBruto] = useState(false);
  const [pipeline, setPipelineBruto] = useState(false);
  const [editarAlvo, setEditarAlvo] = useState(null);       // chave do alvo aberto no editor dos Ajustes
  // Pipeline e Ajustes ocupam o mesmo canto: abrir um fecha o outro
  const setAjustes = useCallback((v) => { setAjustesBruto(v); if (v) setPipelineBruto(false); else setEditarAlvo(null); }, []);
  const setPipeline = useCallback((v) => { setPipelineBruto(v); if (v) setAjustesBruto(false); }, []);
  const pipeBtnRef = useRef(null);
  const pipePopRef = useRef(null);
  const hitTabRef = useRef({});
  const [congelado, setCongelado] = useState(null);
  const [gravando, setGravando] = useState(false);
  const [tempoGrav, setTempoGrav] = useState(0);
  const [msg, setMsg] = useState('');

  const palcoRef = useRef(null);
  const canvasRef = useRef(null);
  const recRef = useRef(null);
  const camRef = useRef({});
  const escalasRef = useRef({});
  const logoRef = useRef(null);
  const indRef = useRef(null);
  const cacheRef = useRef(new Map());
  const tDispRef = useRef({ t: null, quadro: 0 });
  const vivo = useRef({});
  vivo.current = { prefs, vista, congelado, gravando, temNo: Boolean(no && no.enabled) };
  const sigIndRef = useRef('');
  const pintorRef = useRef({ tudo: true });       // estado do redesenho sob demanda (ver o laço abaixo)

  // indicadores do painel: ~3×/s (sessao.resumo não precisa rodar a cada quadro).
  // O objeto só é trocado quando o conteúdo muda — é o sinal de "indicadores mudaram, redesenhar".
  const atualizarInd = useCallback(() => {
    try {
      const n = montarIndicadores();
      const sig = JSON.stringify(n);
      if (sig !== sigIndRef.current) { sigIndRef.current = sig; indRef.current = n; }
    } catch (_) { /* sessão zerando */ }
  }, []);
  useEffect(() => {
    atualizarInd();
    const id = setInterval(atualizarInd, 330);
    return () => clearInterval(id);
  }, [atualizarInd]);
  // perfil do atleta, alvo manual ou nó mudou: tabela, faixas e selos já no próximo quadro
  useEffect(() => { atualizarInd(); }, [versaoAtleta, nodes, atualizarInd]);

  // o operador para de desenhar o overlay dele enquanto o Studio está aberto
  // a barra de vídeo do app (tocar/pausar, linha do tempo, loop, velocidade, zoom, gravar)
  // fica por cima do Studio enquanto ele está aberto — ver body.studio-aberto no CSS
  useEffect(() => {
    document.body.classList.add('studio-aberto');
    // como num player: sem mexer o mouse/dedo por 3 s, a barra de vídeo some (não cobre o ciclista)
    let t = 0;
    const acordar = () => {
      document.body.classList.remove('studio-ocioso');
      clearTimeout(t);
      t = setTimeout(() => document.body.classList.add('studio-ocioso'), 3000);
    };
    acordar();
    const evs = ['mousemove', 'pointerdown', 'touchstart', 'keydown', 'wheel'];
    for (const e of evs) window.addEventListener(e, acordar, { passive: true });
    return () => {
      clearTimeout(t);
      for (const e of evs) window.removeEventListener(e, acordar);
      document.body.classList.remove('studio-aberto', 'studio-ocioso');
    };
  }, []);

  useEffect(() => {
    definirStudio(true);
    return () => definirStudio(false);
  }, []);

  // logo enviado → imagem pronta para o canvas
  useEffect(() => {
    if (!prefs.logo) { logoRef.current = null; return; }
    const img = new Image();
    img.onload = () => { pintorRef.current.tudo = true; };
    img.src = prefs.logo;
    logoRef.current = img;
  }, [prefs.logo]);

  const avisar = useCallback((t) => { setMsg(t); setTimeout(() => setMsg((m) => (m === t ? '' : m)), 3500); }, []);

  // render SOB DEMANDA: o laço de requestAnimationFrame (até ~30 quadros/s) só
  // olha o que mudou e repinta as regiões afetadas — parado, quase não custa nada
  useEffect(() => {
    const palco = palcoRef.current;
    if (!palco) return undefined;
    let raf = 0, ultimo = 0, barra = '';
    const S = pintorRef.current;
    Object.assign(S, {
      tudo: true, W: 0, Hv: 0, rect: null, rolagem: palco.scrollTop, rolou: false, dpr: 0,
      v: {}, ind: null, r: undefined, fresco: null, pint: -1, dcW: 0, dcH: 0,
      nAm: -1, ultAm: null, nMc: -1, ultMc: null, relT: undefined, semDados: 0, seg: -1,
      animVideo: false, animGraf: false, plano: null, chavePlano: '', fundo: null, fundos: [], cvFundo: null,
      paleta: paletaDoTema(), forcarPaleta: null,
    });
    // trocou o tema do app (<html data-theme>): relê os tokens e repinta tudo, inclusive a camada
    // estática — mesmo com o vídeo pausado (o Viewport também repinta o quadro parado)
    const mo = new MutationObserver(() => { _paletas.clear(); S.paleta = paletaDoTema(); S.tudo = true; });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // tamanho e posição do palco: ResizeObserver (nada de getBoundingClientRect a cada quadro)
    const medir = () => { S.W = palco.clientWidth; S.Hv = palco.clientHeight; S.rect = palco.getBoundingClientRect(); S.tudo = true; };
    medir();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    if (ro) ro.observe(palco);
    window.addEventListener('resize', medir);
    // no celular o palco rola: a faixa que entra na tela é repintada
    const rolar = () => { S.rolagem = palco.scrollTop; S.rolou = true; };
    palco.addEventListener('scroll', rolar, { passive: true });

    const pintar = (f) => {
      const cv = canvasRef.current;
      if (!cv || !indRef.current || !S.W || !S.Hv) return;
      const W = S.W, Hv = S.Hv, dpr = S.dpr;
      const g = cv.getContext('2d', { alpha: false });
      const v = vivo.current;
      // paleta desta pintura: a do tema; a do iaVision escuro ao exportar/gravar com essa opção
      C = S.forcarPaleta || (v.gravando && v.prefs.corExport === 'escuro' ? ESCURO : S.paleta);
      const hist = obterHistorico();
      const rel = tDispRef.current;
      const dados = v.congelado || { amostras: hist.amostras, marcas: hist.marcas, tAgora: rel.t == null ? performance.now() : rel.t };
      const est = {
        dc: displayCanvas && displayCanvas.current, r: instantaneo(), vista: v.vista, sel: v.prefs.sel[v.vista],
        prefs: v.prefs, dados, escalas: escalasRef.current, cam: camRef.current, logoImg: logoRef.current, temNo: v.temNo,
        ind: indRef.current, modo: v.prefs.modo, cache: cacheRef.current, animVideo: false,
      };
      const estreito = ehEstreito(W, Hv);
      // plano em cache: só muda com tamanho, indicadores (linhas da tabela/notas), ajustes e vista
      const chavePlano = `${W}|${Hv}`;
      let plano = S.plano, novoPlano = false;
      if (!plano || S.chavePlano !== chavePlano || S.planoInd !== est.ind || S.planoPrefs !== v.prefs || S.planoVista !== v.vista) {
        plano = estreito ? planoEstreito(g, W, est) : planoLargo(g, W, Hv, est);
        Object.assign(S, { plano, chavePlano, planoInd: est.ind, planoPrefs: v.prefs, planoVista: v.vista });
        novoPlano = true;
      }
      const H = estreito ? Math.round(plano.H) : Hv;
      const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
      let limpo = false;
      if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; limpo = true; }
      // no celular o canvas tem a altura do conteúdo e o palco rola
      const alt = estreito ? `${H}px` : '';
      if (cv.style.height !== alt) { cv.style.height = alt; cv.style.position = estreito ? 'relative' : ''; }
      geometriaTabela(hitTabRef.current, plano.tabela, est.ind, plano.u);

      // regiões a repintar (em px do palco); null = tudo
      let regs = null;
      if (!f.forcar && !limpo && !novoPlano && (estreito || !f.tudo)) {
        const L = [];
        if (f.tudo || f.rolou) L.push({ x: 0, y: 0, w: W, h: H });
        else {
          if (f.video) L.push(plano.video);
          if (f.graf) L.push(plano.graf);
          if (f.rodape) L.push({ x: 0, y: plano.topoH, w: W, h: H - plano.topoH });
        }
        // arredonda para pixels inteiros do canvas (sem borda meio pintada)
        regs = L.map((q) => {
          let y0 = q.y, y1 = q.y + q.h;
          if (estreito) { y0 = Math.max(y0, S.rolagem - 40); y1 = Math.min(y1, S.rolagem + Hv + 40); }   // só a faixa visível
          const x0 = Math.floor(q.x * dpr) / dpr, x1 = Math.ceil((q.x + q.w) * dpr) / dpr;
          y0 = Math.floor(y0 * dpr) / dpr; y1 = Math.ceil(y1 * dpr) / dpr;
          return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }).filter((q) => q.w > 0 && q.h > 0);
        if (!regs.length) return;                  // o que mudou está fora da tela
      }

      // gráficos que tocam as regiões: prepara (série, escala) antes de compor o fundo
      const defs = est.sel.map((k) => defAng(est.vista, k));
      const rh = plano.graf.h / defs.length;
      let animGraf = false;
      const preps = defs.map((def, i) => {
        const box = { x: plano.graf.x, y: plano.graf.y + i * rh, w: plano.graf.w, h: rh };
        if (regs && !regs.some((q) => tocam(q, box))) return null;
        const P = prepararGrafico(box, def, est, plano.u);
        if (P.anim) animGraf = true;
        S.fundos[i] = P.fundo;
        return P;
      });
      S.fundos.length = defs.length;
      S.animGraf = animGraf;

      // camada de fundo: refeita só quando a descrição dela muda
      const logoOk = Boolean(est.logoImg && est.logoImg.complete && est.logoImg.naturalWidth);
      const chaveFundo = JSON.stringify([C.id, pw, ph, W, H, logoOk, est.ind.atletaNome, est.vista, S.fundos]);
      if (!S.cvFundo) S.cvFundo = document.createElement('canvas');
      const cf = S.cvFundo;
      if (S.fundo !== chaveFundo || S.fundoPlano !== plano || S.fundoPrefs !== v.prefs || cf.width !== pw || cf.height !== ph) {
        if (cf.width !== pw || cf.height !== ph) { cf.width = pw; cf.height = ph; }
        const gf = cf.getContext('2d', { alpha: false });
        gf.setTransform(dpr, 0, 0, dpr, 0, 0);
        desenharFundo(gf, W, H, est, plano, S.fundos);
        Object.assign(S, { fundo: chaveFundo, fundoPlano: plano, fundoPrefs: v.prefs });
      }

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.save();
      if (regs) {
        g.beginPath();
        for (const q of regs) g.rect(q.x * dpr, q.y * dpr, q.w * dpr, q.h * dpr);
        g.clip();
      }
      g.drawImage(cf, 0, 0);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const comVideo = desenharFrente(g, W, est, plano, regs, preps);
      g.restore();
      S.animVideo = comVideo && est.animVideo;

      // a barra de vídeo do app fica centrada no pé do vídeo (computador)
      if (!estreito && S.rect) {
        const rp = S.rect;
        const x = Math.round(rp.left + plano.video.x + plano.video.w / 2);
        const b = Math.round(window.innerHeight - (rp.top + plano.video.y + plano.video.h) + 10);
        const chave = `${x}|${b}`;
        if (chave !== barra) {
          barra = chave;
          document.body.style.setProperty('--sbf-vctl-x', `${x}px`);
          document.body.style.setProperty('--sbf-vctl-b', `${b}px`);
        }
      }
    };
    // Exportar PNG: o palco inteiro, atualizado (no celular inclui o que está fora da tela)
    S.pintarTudo = () => pintar({ forcar: true });

    const loop = (agoraRaf) => {
      raf = requestAnimationFrame(loop);
      if (agoraRaf - ultimo < 31) return;          // ~30 fps bastam (e o vídeo gravado é 30 fps)
      const dt = ultimo ? Math.min(200, agoraRaf - ultimo) : 0;
      ultimo = agoraRaf;
      const v = vivo.current;
      const hist = obterHistorico();
      const am = hist.amostras, mc = hist.marcas;
      // relógio das curvas: anda em tempo real, mas nunca passa da última amostra
      // (a curva sempre chega na linha "agora") e não fica mais de 250 ms atrás dela
      const ult = am.length ? am[am.length - 1].t : null;
      const rel = tDispRef.current;
      if (ult == null) rel.t = null;
      else if (rel.t == null || rel.t > ult || ult - rel.t > 1500) rel.t = ult;
      else rel.t = Math.max(ult - 250, Math.min(ult, rel.t + dt));

      // ---- o que mudou desde o último quadro?
      let tudo = S.tudo, video = false, graf = false, rodape = false;
      S.tudo = false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (dpr !== S.dpr) { S.dpr = dpr; tudo = true; }
      const sv = S.v;
      if (v.prefs !== sv.prefs || v.vista !== sv.vista || v.congelado !== sv.congelado || v.temNo !== sv.temNo || v.gravando !== sv.gravando) { S.v = { ...v }; tudo = true; }
      if (indRef.current !== S.ind) { S.ind = indRef.current; tudo = true; }
      // vídeo: o Viewport pintou um quadro novo, chegou pose nova, a pose envelheceu, o enquadramento anda
      const dc = displayCanvas && displayCanvas.current;
      const pinturasExibicao = dc ? (dc.quadros | 0) : 0;
      if (pinturasExibicao !== S.pint || (dc && (dc.width !== S.dcW || dc.height !== S.dcH))) {
        S.pint = pinturasExibicao; S.dcW = dc ? dc.width : 0; S.dcH = dc ? dc.height : 0; video = true;
      }
      const r = instantaneo();
      if (r !== S.r) { S.r = r; video = true; }
      const fresco = Boolean(r && performance.now() - r.t < 4000);
      if (fresco !== S.fresco) { S.fresco = fresco; video = true; }
      if (S.animVideo) video = true;
      // gráficos: amostra/marca nova, relógio das curvas andou, escala andando (ou esperando para encolher)
      const ua = am[am.length - 1], um = mc[mc.length - 1];
      if (am.length !== S.nAm || ua !== S.ultAm || mc.length !== S.nMc || um !== S.ultMc) {
        S.nAm = am.length; S.ultAm = ua; S.nMc = mc.length; S.ultMc = um; graf = true; video = true;
      }
      if (!v.congelado) {
        if (rel.t !== S.relT) { S.relT = rel.t; graf = true; }
        // sem amostra nenhuma o relógio é o performance.now(): a grade anda, a 10 q/s basta
        if (rel.t == null && agoraRaf - S.semDados >= 100) { S.semDados = agoraRaf; graf = true; }
      }
      if (S.animGraf || escalaVencida(escalasRef.current)) graf = true;
      const seg = Math.floor(Date.now() / 1000);
      if (seg !== S.seg) { S.seg = seg; rodape = true; }
      const rolou = S.rolou;
      S.rolou = false;
      // gravando: o MediaRecorder precisa de quadros constantes — desenha sempre, inteiro
      const forcar = Boolean(v.gravando);
      if (!tudo && !video && !graf && !rodape && !rolou && !forcar) return;
      pintar({ tudo, video, graf, rodape, rolou, forcar });
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', medir);
      palco.removeEventListener('scroll', rolar);
      S.pintarTudo = null;
      document.body.style.removeProperty('--sbf-vctl-x');
      document.body.style.removeProperty('--sbf-vctl-b');
    };
  }, [displayCanvas]);

  const fechar = useCallback(async () => {
    const rec = recRef.current;
    if (rec && rec.gravando) {
      try { const r = await rec.stop(); await salvar({ blob: r.blob, nome: r.nome.replace(/^iavision-/, 'studio-bikefit-') }); } catch (_) { /* segue fechando */ }
    }
    onClose && onClose();
  }, [onClose]);

  // Esc fecha primeiro o popover do Pipeline, depois os ajustes, por fim o Studio;
  // as teclas do app não disparam por baixo do Studio
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && fonteStudioAberta()) return;   // o popover da Fonte fecha primeiro
      if (e.key === 'Escape') {
        // o editor de um alvo trata o próprio Esc (cancela a edição)
        if (e.target && e.target.closest && e.target.closest('.bfa-ed')) return;
        e.preventDefault(); e.stopPropagation();
        if (pipeline) { setPipeline(false); if (pipeBtnRef.current) pipeBtnRef.current.focus(); } else if (ajustes) setAjustes(false); else fechar();
        return;
      }
      const t = e.target;
      const campo = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      // espaço (pausar o vídeo) e setas (quadro a quadro) continuam valendo
      if (!campo && (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
      if (!campo) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ajustes, pipeline, fechar, setAjustes, setPipeline]);

  // popover do Pipeline: fecha com clique fora (no botão, o próprio botão alterna)
  useEffect(() => {
    if (!pipeline) return undefined;
    const fora = (e) => {
      const t = e.target;
      if (pipePopRef.current && pipePopRef.current.contains(t)) return;
      if (pipeBtnRef.current && pipeBtnRef.current.contains(t)) return;
      // a barra de vídeo do app fica por cima do Studio: mexer nela não fecha
      if (t && t.closest && t.closest('.vctl')) return;
      setPipeline(false);
    };
    document.addEventListener('pointerdown', fora, true);
    return () => document.removeEventListener('pointerdown', fora, true);
  }, [pipeline, setPipeline]);

  // posição do popover: ancorado embaixo do botão (no celular vira gaveta, pelo CSS)
  const [pipePos, setPipePos] = useState(null);
  useEffect(() => {
    if (!pipeline) return undefined;
    const medir = () => {
      const b = pipeBtnRef.current;
      if (!b) return;
      const r = b.getBoundingClientRect();
      const larg = Math.min(380, window.innerWidth - 20);
      setPipePos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(10, Math.min(r.left, window.innerWidth - larg - 10))) });
    };
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [pipeline]);

  // clique na tabela do palco: abre o alvo daquela linha nos Ajustes (bloco Atleta)
  function cliquePalco(e) {
    const h = hitTabRef.current, cv = canvasRef.current;
    if (!h || !h.chaves || !cv) return;
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < h.x || x > h.x + h.w || y < h.y0) return;
    const i = Math.floor((y - h.y0) / h.rh);
    const k = h.chaves[i];
    if (i < 0 || i >= h.chaves.length || !k) return;
    setAjustes(true);
    setEditarAlvo(k);
  }
  function cursorPalco(e) {
    const h = hitTabRef.current, cv = canvasRef.current;
    if (!cv) return;
    let sobre = false;
    if (h && h.chaves) {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const i = Math.floor((y - h.y0) / h.rh);
      sobre = x >= h.x && x <= h.x + h.w && y >= h.y0 && i < h.chaves.length && Boolean(h.chaves[i]);
    }
    const c = sobre ? 'pointer' : '';
    if (cv.style.cursor !== c) { cv.style.cursor = c; cv.title = sobre ? 'Clique para ajustar o alvo desta medida' : ''; }
  }

  // desmontado por fora (sem passar pelo Fechar) no meio de uma gravação: descarta
  useEffect(() => () => { const r = recRef.current; if (r && r.gravando) r.cancel(); }, []);

  const mudar = (k, v) => setPrefs((p) => { const n = { ...p, [k]: v }; gravarPrefs(n); return n; });
  const mudarBloco = (k, v) => setPrefs((p) => { const n = { ...p, blocos: { ...p.blocos, [k]: v } }; gravarPrefs(n); return n; });
  const mudarSel = (i, k) => setPrefs((p) => {
    const lista = p.sel[vista].slice(); lista[i] = k;
    const n = { ...p, sel: { ...p.sel, [vista]: lista } }; gravarPrefs(n); return n;
  });

  function definirVista(v) {
    if (v === vista) return;
    try {
      const pp = JSON.parse(localStorage.getItem(PREFS_PAINEL) || '{}') || {};
      localStorage.setItem(PREFS_PAINEL, JSON.stringify({ ...pp, vista: v }));
    } catch (_) { /* modo privado */ }
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === OP);
    if (i >= 0) {
      store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, params: { ...n.params, vista: v } } : n)) });
      persist();
    }
    zerarSessao();
    escalasRef.current = {};
    cacheRef.current.clear();
  }

  function alternarCongelar() {
    if (congelado) { setCongelado(null); return; }
    const h = obterHistorico();
    const ult = h.amostras.length ? h.amostras[h.amostras.length - 1].t : performance.now();
    setCongelado({ amostras: h.amostras.slice(), marcas: h.marcas.slice(), tAgora: Math.min(performance.now(), ult + 150) });
  }

  function exportarPNG() {
    const cv = canvasRef.current;
    if (!cv) return;
    // o palco pode estar só parcialmente atualizado (celular: só a faixa visível) — pinta inteiro antes
    const S = pintorRef.current;
    let fonte = cv;
    if (prefs.corExport === 'escuro' && temaDoApp() !== 'escuro' && S.pintarTudo) {
      // "iaVision escuro": pinta com a paleta de apresentação, copia e volta ao tema na mesma tarefa
      // (a tela nunca chega a mostrar o quadro escuro)
      S.forcarPaleta = ESCURO;
      try {
        S.pintarTudo();
        fonte = document.createElement('canvas');
        fonte.width = cv.width; fonte.height = cv.height;
        fonte.getContext('2d').drawImage(cv, 0, 0);
      } finally {
        S.forcarPaleta = null;
        S.pintarTudo();
      }
    } else if (S.pintarTudo) S.pintarTudo();
    const nome = `studio-bikefit-${arquivoSeguro(obterAtleta().nome) || 'atleta'}-${carimbo()}.png`;
    fonte.toBlob((blob) => {
      if (!blob) { avisar('Não foi possível gerar o PNG.'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      avisar(`PNG salvo: ${nome}`);
    }, 'image/png');
  }

  async function alternarGravacao() {
    const rec = recRef.current || (recRef.current = new Recorder());
    if (rec.gravando) {
      try {
        const r = await rec.stop();
        setGravando(false);
        const nome = r.nome.replace(/^iavision-/, `studio-bikefit-${arquivoSeguro(obterAtleta().nome) || 'atleta'}-`);
        const como = await salvar({ blob: r.blob, nome });
        if (como !== 'cancelado') avisar(`Vídeo salvo (${r.formato.nome}).`);
      } catch (err) { setGravando(false); avisar(err.message || String(err)); }
      return;
    }
    try {
      rec.start(canvasRef.current, { fps: 30, bitrate: 8_000_000 });
      setTempoGrav(0);
      setGravando(true);
    } catch (err) { avisar(err.message || String(err)); }
  }
  // relógio da gravação na barra
  useEffect(() => {
    if (!gravando) return undefined;
    const id = setInterval(() => recRef.current && setTempoGrav(recRef.current.segundos), 500);
    return () => clearInterval(id);
  }, [gravando]);

  function relatorio() {
    const sessao = obterSessao();
    if (!sessao.registro.length) { avisar('Ainda não há amostras gravadas para o relatório.'); return; }
    const cfg = no ? { ...defaultParams(OP), ...no.params } : {};
    const snap = instantaneo();
    const d = dadosSessao(sessao, {
      perfil: cfg.perfil, vista: cfg.vista, lado: (snap && snap.lado) || cfg.lado, nCiclos: cfg.nCiclos,
      alturaCm: cfg.alturaCm, pernaCm: cfg.pernaCm,
    });
    const h = temaRelatorio(htmlRelatorio(d), prefs.corExport === 'escuro' ? 'escuro' : temaDoApp());
    const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
    const w = window.open(url, '_blank');
    if (!w) {
      const a = document.createElement('a');
      a.href = url; a.download = `bikefit-relatorio-${carimbo()}.html`; a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function enviarLogo(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try { mudar('logo', await reduzirLogo(f)); } catch (err) { avisar(err.message); }
  }

  const opcoes = ANGULOS[vista];
  const bikeFitOk = Boolean(no && no.enabled);
  return html`
    <div class="sbf" role="dialog" aria-modal="true" aria-label="GPlanSiS|StudioBikeFit">
      <div class="sbf-barra">
        <b class="sbf-titulo"><span class="sbf-marca">iaVision</span> GPlanSiS<i>|</i>StudioBikeFit</b>
        <${FonteStudio} classeBotao="sbf-btn" />
        <${FerramentasStudio} classeBotao="sbf-btn" alvo=${canvasRef} copiaDisplay=${true} transformacao=${() => camRef.current && camRef.current.tfFerr} />
        <div class="sbf-seg" role="group" aria-label="Vista">
          <button class=${vista === 'lateral' ? 'on' : ''} onClick=${() => definirVista('lateral')}>Lateral</button>
          <button class=${vista === 'frontal' ? 'on' : ''} onClick=${() => definirVista('frontal')}>Frontal</button>
        </div>
        <div class="sbf-seg" role="group" aria-label="Curvas">
          <button class=${prefs.modo === 'tempo' ? 'on' : ''} title="Ângulo ao longo do tempo (últimos 8 s)"
            onClick=${() => mudar('modo', 'tempo')}>Tempo</button>
          <button class=${prefs.modo === 'ciclo' ? 'on' : ''} title="Todas as pedaladas dobradas de PMI a PMI: média ± desvio"
            onClick=${() => mudar('modo', 'ciclo')}>Ciclo médio</button>
        </div>
        <button class=${'sbf-btn' + (congelado ? ' on' : '')} onClick=${alternarCongelar}
          title="Congela as curvas (o vídeo continua)">${congelado ? 'Retomar curvas' : 'Congelar curvas'}</button>
        <button class="sbf-btn" onClick=${exportarPNG} title="Salva a tela do Studio como imagem">Exportar PNG</button>
        <button class=${'sbf-btn' + (gravando ? ' rec' : '')} onClick=${alternarGravacao} disabled=${!gravacaoSuportada()}
          title="Grava em vídeo a tela do Studio">${gravando ? `■ Parar ${formatarTempo(tempoGrav)}` : '● Gravar vídeo'}</button>
        <button class="sbf-btn" onClick=${relatorio} title="Abre o relatório da sessão para imprimir ou salvar em PDF">Relatório</button>
        <button ref=${pipeBtnRef} class=${'sbf-btn' + (pipeline ? ' on' : '') + (bikeFitOk ? '' : ' alerta')}
          aria-haspopup="dialog" aria-expanded=${pipeline ? 'true' : 'false'}
          title=${bikeFitOk ? 'Nós do Pipeline, parâmetros e presets — valem ao vivo' : 'O nó Bike Fit está fora do Pipeline ou desligado'}
          onClick=${() => setPipeline(!pipeline)}>Pipeline${bikeFitOk ? '' : ' !'}</button>
        <button class=${'sbf-btn' + (ajustes ? ' on' : '')} onClick=${() => setAjustes(!ajustes)}>Ajustes</button>
        <span class="sbf-msg" role="status">${msg}</span>
        <${BotaoVia} modulo="bikefit" classe="sbf-btn" />
        <button class="sbf-btn sbf-fechar" onClick=${fechar} aria-label="Fechar o Studio (Esc)" title="Fechar (Esc)">✕</button>
      </div>
      <div class="sbf-palco" ref=${palcoRef}>
        <canvas ref=${canvasRef} onClick=${cliquePalco} onPointerMove=${cursorPalco}></canvas>
      </div>
      ${pipeline && html`
        <div class="sbf-pipe-fundo" aria-hidden="true"></div>
        <section class="sbf-pipe" ref=${pipePopRef} role="dialog" aria-label="Pipeline"
          style=${pipePos ? { top: `${pipePos.top}px`, left: `${pipePos.left}px` } : null}>
          <header class="sbf-pipe-cab">
            <b>Pipeline</b>
            <span>${nodes.filter((n) => n.enabled).length}/${nodes.length} ativos · mudanças valem ao vivo</span>
            <button class="sbf-btn" aria-label="Fechar o Pipeline (Esc)" title="Fechar (Esc)" onClick=${() => setPipeline(false)}>✕</button>
          </header>
          ${!bikeFitOk && html`
            <div class="sbf-pipe-aviso" role="alert">
              <span>${no ? 'O nó Bike Fit está desligado: o Studio não recebe medidas.' : 'Não há nó Bike Fit no Pipeline: o Studio não recebe medidas.'}</span>
              <button class="sbf-btn on" onClick=${() => { ativarBikeFit(); avisar(no ? 'Bike Fit ligado.' : 'Bike Fit adicionado ao Pipeline.'); }}>Ativar Bike Fit</button>
            </div>`}
          <div class="sbf-pipe-corpo">
            <${PipelineConteudo} onResetState=${onResetState || (() => {})}
              presetsPrimeiro=${['Esportes e biomecânica', 'Mãos, rosto e olhos', 'Bike Fit']} />
          </div>
        </section>`}
      ${ajustes && html`
        <aside class="sbf-ajustes" aria-label="Ajustes do Studio">
          <h3>Ajustes</h3>
          <h4 class="sbf-h4-1">Atleta</h4>
          <${AtletaBikeFit} perfil=${perfilNome} editar=${editarAlvo} onEditar=${setEditarAlvo} />
          <h4>Estúdio e sessão</h4>
          <label>Data da sessão<input type="date" value=${prefs.data} onInput=${(e) => mudar('data', e.target.value)} /></label>
          <label>Nome do estúdio<input value=${prefs.estudio} onInput=${(e) => mudar('estudio', e.target.value)} /></label>
          <label>Site<input value=${prefs.site} placeholder="www.seuestudio.com.br" onInput=${(e) => mudar('site', e.target.value)} /></label>
          <label>Telefone<input value=${prefs.telefone} placeholder="(11) 99999-0000" onInput=${(e) => mudar('telefone', e.target.value)} /></label>
          <div class="sbf-logo">
            <span>Logo</span>
            ${prefs.logo && html`<img src=${prefs.logo} alt="Logo atual" />`}
            <label class="sbf-btn">Enviar…<input type="file" accept="image/*" onChange=${enviarLogo} hidden /></label>
            ${prefs.logo && html`<button class="sbf-btn" onClick=${() => mudar('logo', '')}>Remover</button>`}
          </div>
          <h4>Exportação</h4>
          <label>Cores da exportação
            <select value=${prefs.corExport} onChange=${(e) => mudar('corExport', e.target.value)}>
              <option value="tema">Tema atual</option>
              <option value="escuro">iaVision escuro (padrão de apresentação)</option>
            </select>
          </label>
          <p class="sbf-nota sbf-nota-exp">Vale para Exportar PNG, Gravar vídeo e Relatório (na tela; impresso, o relatório sai sempre claro).
            ${prefs.corExport === 'escuro' && ' Gravando, o palco fica no iaVision escuro enquanto a gravação durar.'}</p>
          <h4>Blocos na tela</h4>
          <div class="sbf-checks">
            ${[['kpis', 'Cartões (rpm, pedaladas, lado, poses/s)'], ['tabela', 'Tabela de ângulos'], ['avisos', 'Avisos da medição'], ['recs', 'Recomendações']]
              .map(([k, rot]) => html`<label key=${k}><input type="checkbox" checked=${prefs.blocos[k]} onChange=${(e) => mudarBloco(k, e.target.checked)} /> ${rot}</label>`)}
            <label><input type="checkbox" checked=${prefs.minmax} onChange=${(e) => mudar('minmax', e.target.checked)} /> Mín/máx na tabela</label>
          </div>
          <label>Curvas
            <select value=${prefs.modo} onChange=${(e) => mudar('modo', e.target.value)}>
              <option value="tempo">Tempo (últimos 8 s)</option>
              <option value="ciclo">Ciclo médio (PMI a PMI, média ± dp)</option>
            </select>
          </label>
          <h4>Gráficos (${vista === 'frontal' ? 'vista frontal' : 'vista lateral'})</h4>
          ${prefs.sel[vista].map((k, i) => html`
            <label key=${i} class="sbf-linha">${i + 1}.
              <select value=${k} onChange=${(e) => mudarSel(i, e.target.value)}>
                ${opcoes.map((o) => html`<option key=${o.k} value=${o.k}>${o.titulo}</option>`)}
              </select>
            </label>`)}
          <p class="sbf-nota">Os dados ficam só neste navegador. Ângulos em 2D, medidos sem marcadores pela pose estimada.
            ${vista === 'lateral' ? ' Ângulo do pé = calcanhar→ponta sobre a horizontal (+ = ponta mais baixa).' : ' Desvio do joelho em % da perna (+ = para dentro).'}</p>
          <button class="sbf-btn" onClick=${() => setAjustes(false)}>Fechar ajustes</button>
        </aside>`}
    </div>
  `;
}
