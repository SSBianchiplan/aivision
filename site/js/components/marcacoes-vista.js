/**
 * components/marcacoes-vista.js — desenho e interação das marcações sobre o vídeo.
 *
 * O Viewport chama `desenharMarcacoes` no fim de cada quadro (depois do
 * overlay dos operadores, antes da legenda): as marcações entram no canvas de
 * exibição e, por isso, na captura PNG e na gravação — como as caixas de
 * detecção. Os eventos de ponteiro do canvas passam primeiro por aqui
 * (`ponteiro*`): com a ferramenta "Mover" nada é consumido e o zoom/arrasto
 * de sempre continua igual.
 *
 * Custo por quadro: algumas dezenas de comandos de caminho no canvas. Os
 * pontos em px de tela vão para um buffer fixo, sem alocar a cada quadro.
 *
 * MENU DE CONTEXTO (components/menu-contexto.js). Clique direito sobre o
 * vídeo — arrastando com o botão direito seleciona uma ÁREA; sem arrastar,
 * vale a marcação sob o cursor (ou o quadro inteiro) — abre o menu com as
 * funções do sistema para aquela área: +Projeto (rotular, salvar recorte,
 * pastas, Treinar, pré-rotular), detectar, OCR, código, Via, copiar, ROI,
 * exclusão, zona, medir, Inspect. No toque, toque longo; no teclado,
 * Shift+F10 ou a tecla Menu com uma marcação selecionada. Só o canvas do
 * vídeo intercepta o menu do navegador. SEM FONTE (cartão inicial) o canvas
 * não intercepta nada: o clique direito abre o menu da TELA
 * (layout/menu-tela.js), e o do vídeo ganha no fim o submenu «Tela ▸».
 */

import { createStore, store } from '../state/store.js';
import {
  marcStore, rt, vista, fonteParaTela, clienteParaFonte, clienteParaTela, criar,
  editarSemHistorico, marcoDesfazer, apagar, inverter, selecionar, AREAS, resultados, fresco,
  comprimentoPx, anguloGraus, fmtComprimento, espelhado, CRIA,
  confirmar, novoId, atualizar, COR_FUNC, funcoesDe, dadosExemplo,
  vistaParaFonte, LINHAS, ESQUELETO, areaPx, perimetroPx, fmtArea, centroide, circuloPor3, pintarMascara,
  recortarMascara, mascaraCanvas, contarClique, descontarClique, tempoAgora, segundosCrono, fmtTempo, mmPorPx,
  caixaItem, fonteParaVista, travar, setFerramenta, desfazer as desfazerM, refazer as refazerM,
} from '../cv/marcacoes.js';
import {
  varinha, segmentarSam, situacaoSam, esquecerSam, encaixarBorda, passoTrajetorias, soltarModelo, iniciarTrajetoria, velocidadePx, dentroFonte,
} from '../cv/marcacoes-analise.js';
import { desenharAuxilios, desenharAuxiliosJa } from './ferramentas-exibicao.js';
import { abrirMenu, registrarAcao, fecharMenu, mostrarBalao } from './menu-contexto.js';
import '../projeto/acoes.js';
import { salvarQuadroComoPrint } from '../projeto/exemplos.js';
import { quadroCanvas } from '../projeto/captura.js';
import { ativo as projetoAtivo, adicionarClasse, classePorNome } from '../projeto/base.js';
import { regiaoDoItem, tique as tiqueRegioes, podeApagar, paramsDe } from '../cv/regioes.js';
import './regioes-acoes.js';
import './calibrar.js';

/** Leitura do conta-gotas (o widget mostra). Store próprio: muda na velocidade do mouse. */
export const leituraStore = createStore({ leitura: null });

const P = new Float64Array(8192);         // pontos de tela do item atual (x0,y0,x1,y1…), até 4096 pontos
const t2 = [0, 0];
const caixasTexto = new Map();             // id → [x, y, w, h] do último desenho (para clicar no texto)
let hachura = null;                        // padrão listrado da exclusão (criado uma vez)

function telaDe(it) {
  const n = Math.min(it.pts.length, 4096);
  for (let i = 0; i < n; i++) {
    fonteParaTela(it.pts[i][0], it.pts[i][1], t2);
    P[i * 2] = t2[0]; P[i * 2 + 1] = t2[1];
  }
  return n;
}

function caixa(n) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = P[i * 2], y = P[i * 2 + 1];
    if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y;
  }
  return [x1, y1, x2, y2];
}

/** Caminho da forma de área (já com os pontos de tela em P). */
function caminhoArea(ctx, tipo, n) {
  if (tipo === 'retangulo' || tipo === 'mascara') {
    const [x1, y1, x2, y2] = caixa(n);
    ctx.rect(x1, y1, x2 - x1, y2 - y1);
  } else if (tipo === 'elipse') {
    const [x1, y1, x2, y2] = caixa(n);
    ctx.moveTo(x2, (y1 + y2) / 2);
    ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.max(0.5, (x2 - x1) / 2), Math.max(0.5, (y2 - y1) / 2), 0, 0, Math.PI * 2);
  } else {
    for (let i = 0; i < n; i++) (i ? ctx.lineTo(P[i * 2], P[i * 2 + 1]) : ctx.moveTo(P[0], P[1]));
    ctx.closePath();
  }
}

function padraoHachura(ctx, dpr) {
  if (hachura && hachura.dpr === dpr) return hachura.p;
  const s = Math.round(10 * dpr);
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(248,113,113,.55)';
  g.lineWidth = Math.max(1, 1.5 * dpr);
  g.beginPath(); g.moveTo(0, s); g.lineTo(s, 0); g.moveTo(-s / 2, s / 2); g.lineTo(s / 2, -s / 2); g.moveTo(s / 2, s * 1.5); g.lineTo(s * 1.5, s / 2); g.stroke();
  hachura = { dpr, p: ctx.createPattern(c, 'repeat') };
  return hachura.p;
}

/** Topo do canvas na janela, sem medir a cada quadro (no máximo uma vez por segundo). */
let topoC = { t: -1e9, v: 0, c: null };
function topoCanvas() {
  const agora = performance.now();
  if (topoC.c !== vista.canvas || agora - topoC.t > 1000) topoC = { t: agora, v: vista.canvas ? vista.canvas.getBoundingClientRect().top : 0, c: vista.canvas };
  return topoC.v;
}

/** Pílula de texto (nome + resultado) presa a um ponto. */
function pilula(ctx, txt, x, y, cor, dpr, escura = true) {
  ctx.font = `600 ${11 * dpr}px ui-monospace, monospace`;
  const w = ctx.measureText(txt).width + 10 * dpr, h = 17 * dpr;
  const xx = Math.max(vista.dx, Math.min(x, vista.dx + vista.dw - w));
  const yy = Math.max(vista.dy, Math.min(y, vista.dy + vista.dh - h));
  ctx.fillStyle = escura ? 'rgba(2,48,44,.84)' : cor;
  ctx.fillRect(xx, yy, w, h);
  ctx.fillStyle = cor;
  ctx.fillRect(xx, yy, 3 * dpr, h);
  ctx.fillStyle = escura ? '#f5f5f4' : '#02302C';
  ctx.fillText(txt, xx + 6 * dpr, yy + 12.5 * dpr);
  return [xx, yy, w, h];
}

/** Texto do rótulo: nome + o que a função calculou. */
export function rotulo(it) {
  const r = resultados.get(it.id);
  if (it.tipo === 'regua') return `${it.nome} · ${fmtComprimento(comprimentoPx(it))}`;
  if (it.tipo === 'angulo') { const a = anguloGraus(it); return `${it.nome} · ${a == null ? '—' : a.toFixed(1) + '°'}`; }
  if (it.funcao === 'zona' && fresco(r)) return `${it.nome} · ${r.ocupacao} agora · máx ${r.max} · ${r.entradas} entr.`;
  if (it.funcao === 'cruzamento' && fresco(r)) return r.semId ? `${it.nome} · precisa de rastreio (IDs)` : `${it.nome} · ${r.ida} ida · ${r.volta} volta`;
  if (it.tipo === 'polilinha' && it.funcao === 'medida') return `${it.nome} · ${fmtComprimento(comprimentoPx(it))}`;
  if (it.tipo === 'perfil' || it.tipo === 'distancia') return `${it.nome} · ${fmtComprimento(comprimentoPx(it))}`;
  if (it.tipo === 'contador') return `${it.nome}: ${it.pts.length}`;
  if (it.tipo === 'cronometro') return `⏱ ${fmtTempo(segundosCrono(it))}${it.t1 == null ? ' ●' : ''}`;
  if (it.tipo === 'trajetoria') {
    const v = velocidadePx(it), k = mmPorPx();
    const vel = v == null ? '' : k ? ` · ${(v * k / 1000).toFixed(2).replace('.', ',')} m/s` : ` · ${v.toFixed(0)} px/s`;
    return `${it.nome}${vel}${it.ativo ? ' ●' : ''}`;
  }
  if (AREAS.has(it.tipo) && it.funcao === 'medida') {
    const circ = it.tipo === 'elipse' && /^Círculo/.test(it.nome) ? ` · ⌀ ${fmtComprimento(Math.abs(it.pts[1][0] - it.pts[0][0]) * vista.W)}` : '';
    return `${it.nome} · ${fmtArea(areaPx(it))} · per. ${fmtComprimento(perimetroPx(it))}${circ}`;
  }
  if (it.funcao === 'roi') return `${it.nome} · processar só aqui`;
  if (it.funcao === 'exclusao') return `${it.nome} · ignorada`;
  if (it.funcao === 'bs_busca') return 'Faixa de busca';
  if (it.funcao === 'bs_exclusao') return 'Exclusão';
  if (it.funcao === 'bs_velocidade') return 'Velocidade';
  return it.nome;
}

/**
 * Desenha todas as marcações, o rascunho e as alças de seleção.
 * Chamado pelo Viewport com o contexto do canvas de exibição.
 */
export function desenharMarcacoes(ctx) {
  const st = marcStore.get();
  instalarMenu();
  // trajetórias seguem o ponto a cada quadro novo; os auxílios (grade, lupa, mira, réguas) têm camada própria
  if (vista.ok) { try { passoTrajetorias(); } catch (e) { console.warn('[trajetória]', e); } }
  tiqueRegioes();
  desenharAuxiliosJa();
  // um Studio que COPIA este canvas está com as Ferramentas abertas e pinta as marcações por cima dele
  if (!rt.ocultarNoDisplay) pintarItens(ctx, st);
}

/**
 * Só as formas (sem o passo das trajetórias e os auxílios): o Viewport pinta pelo desenharMarcacoes;
 * os Studios (components/studio/FerramentasStudio.js) pintam por aqui, com a vista do canvas deles.
 */
export function pintarItens(ctx, st = marcStore.get()) {
  const rasc = rt.rascunho;
  if (!vista.ok || (!st.itens.length && !rasc && !rt.selecao && !rt.sam)) return;
  const dpr = vista.dpr;
  ctx.save();
  ctx.beginPath();
  ctx.rect(vista.dx, vista.dy, vista.dw, vista.dh);
  ctx.clip();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // ROI: escurece o que fica de fora — é o que o pipeline NÃO vê
  let temRoi = false;
  if (st.roiLigada) {
    ctx.beginPath();
    for (const it of st.itens) {
      if (it.funcao !== 'roi' || !AREAS.has(it.tipo)) continue;
      if (!temRoi) ctx.rect(vista.dx, vista.dy, vista.dw, vista.dh);
      temRoi = true;
      caminhoArea(ctx, it.tipo, telaDe(it));
    }
    if (temRoi) { ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill('evenodd'); }
  }

  if (st.visivel) {
    caixasTexto.clear();
    for (const it of st.itens) {
      if (!it.visivel) continue;
      if (rasc && rasc.alvo === it.id) continue;          // máscara sendo pintada: o rascunho mostra
      const sel = it.id === st.sel || st.selN.includes(it.id);
      if (it.vinc) { desenharRegiao(ctx, it, sel, it.id === rt.hover, dpr, st.ferramenta === 'selecionar'); continue; }
      desenharItem(ctx, it, sel, it.id === rt.hover, dpr, st.roiLigada);
    }
  }

  if (rasc) desenharRascunho(ctx, rasc, dpr);
  if (rt.sam) desenharSam(ctx, rt.sam, dpr);
  if (rt.selecao) desenharSelecao(ctx, rt.selecao, dpr);

  // selo "ROI ATIVA": a pessoa precisa saber que o pipeline está vendo só um pedaço
  if (st.roiLigada && (temRoi || st.itens.some((i) => i.funcao === 'exclusao' && AREAS.has(i.tipo)))) {
    // no alto, logo abaixo da barra do topo (que flutua sobre o vídeo): --rail-top é a base dela
    const rt0 = parseFloat(document.documentElement.style.getPropertyValue('--rail-top')) || 76;
    const topo = Math.max(vista.dy, (rt0 - topoCanvas()) * dpr) + 6 * dpr;
    pilula(ctx, temRoi ? 'ROI ATIVA — o pipeline só vê a área clara' : 'EXCLUSÃO ATIVA — o pipeline ignora a área hachurada',
           vista.dx + vista.dw / 2 - 150 * dpr, topo, '#38bdf8', dpr);
  }
  // BeltScan: editando a faixa de busca/exclusão/velocidade na imagem — como aplicar
  const selBs = st.sel && st.ferramenta === 'selecionar' && st.itens.find((i) => i.id === st.sel && String(i.funcao).startsWith('bs_'));
  if (selBs) {
    const txt = vista.dw / dpr < 640 ? 'BeltScan: arraste as alças · Enter/✓ conclui' : 'BeltScan: arraste as alças · solta = aplica · Enter ou ✓ conclui';
    ctx.font = `600 ${11 * dpr}px ui-monospace, monospace`;
    const w = ctx.measureText(txt).width + 10 * dpr;
    // no alto, abaixo da barra do topo e da faixa do operador (embaixo fica a barra de vídeo)
    const rt0 = parseFloat(document.documentElement.style.getPropertyValue('--rail-top')) || 76;
    const topo = Math.max(vista.dy, (rt0 - vista.canvas.getBoundingClientRect().top) * dpr) + 34 * dpr;
    pilula(ctx, txt, vista.dx + Math.max(4 * dpr, (vista.dw - w) / 2), topo, selBs.cor, dpr);
  }
  ctx.restore();
}

/**
 * Região de um operador (cv/regioes.js). O operador já desenha a geometria dele: aqui só aparece o
 * contorno quando ela está selecionada, sob o cursor, com «Selecionar» ativo — ou tracejada enquanto
 * é a geometria padrão (ainda não ajustada: a Quadra sem calibração). Alças só com seleção.
 */
function desenharRegiao(ctx, it, sel, hover, dpr, modoSel) {
  const padrao = it.vinc && it.vinc.padrao;
  if (!sel && !hover && !modoSel && !padrao) return;
  const n = telaDe(it);
  const cor = it.cor;
  const forte = sel || hover;
  ctx.save();
  ctx.globalAlpha = forte ? 1 : 0.7;
  ctx.lineWidth = (forte ? 2.4 : 1.4) * dpr;
  ctx.strokeStyle = cor;
  ctx.setLineDash(padrao && !sel ? [7 * dpr, 5 * dpr] : []);
  ctx.beginPath();
  if (it.tipo === 'ponto') ctx.arc(P[0], P[1], 7 * dpr, 0, Math.PI * 2);
  else if (it.tipo === 'retangulo') caminhoArea(ctx, 'retangulo', n);
  else { for (let i = 0; i < n; i++) (i ? ctx.lineTo(P[i * 2], P[i * 2 + 1]) : ctx.moveTo(P[0], P[1])); if (it.tipo !== 'linha') ctx.closePath(); }
  ctx.stroke();
  ctx.setLineDash([]);
  // linhas extras (Quadra: as linhas do esporte pela geometria que está sendo arrastada)
  const r = (sel || padrao) && regiaoDoItem(it);
  if (r && r.def.desenho) {
    let seg = [];
    try {
      const q = it.pts.map(([u, v]) => { fonteParaVista(u, v, t2); return [t2[0], t2[1]]; });
      seg = r.def.desenho(q, paramsDe(r.no)) || [];
    } catch (_) { seg = []; }
    ctx.globalAlpha = 0.85; ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    for (const [a, b, c, d] of seg) { ctx.moveTo(vista.dx + a * vista.dw, vista.dy + b * vista.dh); ctx.lineTo(vista.dx + c * vista.dw, vista.dy + d * vista.dh); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (forte || padrao) {
    const [x1, y1] = caixa(n);
    const txt = padrao && !sel ? `${it.nome} · clique e arraste os cantos` : `${it.vinc.rotulo || ''} · ${it.nome}${it.travado ? ' 🔒' : ''}`;
    pilula(ctx, txt, x1, y1 - 19 * dpr < vista.dy + 4 * dpr ? y1 + 4 * dpr : y1 - 19 * dpr, cor, dpr);
  }
  if (sel && !it.travado) {
    alcas(ctx, it, n, dpr);
    if (r && r.def.rotulos) {
      ctx.font = `600 ${10 * dpr}px ui-monospace, monospace`; ctx.fillStyle = cor;
      for (let i = 0; i < Math.min(n, r.def.rotulos.length); i++) ctx.fillText(r.def.rotulos[i], P[i * 2] + 7 * dpr, P[i * 2 + 1] - 7 * dpr);
    }
  }
  ctx.restore();
}

function desenharItem(ctx, it, sel, hover, dpr, roiLigada) {
  const n = telaDe(it);
  const cor = it.cor;
  ctx.lineWidth = (sel || hover ? 2.6 : 1.8) * dpr;
  ctx.strokeStyle = cor;
  ctx.setLineDash([]);

  if (it.tipo === 'mascara') {
    const x0 = P[0], y0 = P[1], x1 = P[2], y1 = P[3];
    const corM = it.funcao === 'exclusao' ? '#f87171' : it.funcao === 'roi' ? '#38bdf8' : cor;
    pintarMascara(ctx, it.mask, x0, y0, x1, y1, /^#[0-9a-f]{6}$/i.test(corM) ? corM : '#FFD84D', it.funcao === 'exclusao' || it.funcao === 'roi' ? 0.38 : 0.45);
    if (sel || hover) { ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.setLineDash([]); }
    const [bx, by] = caixa(n);
    pilula(ctx, rotulo(it), bx, by - 19 * dpr < vista.dy + 4 * dpr ? by + 4 * dpr : by - 19 * dpr, cor, dpr);
  } else if (AREAS.has(it.tipo)) {
    ctx.beginPath();
    caminhoArea(ctx, it.tipo, n);
    if (it.funcao === 'exclusao' || it.funcao === 'bs_exclusao') {
      ctx.fillStyle = padraoHachura(ctx, dpr);
      ctx.fill();
      ctx.fillStyle = 'rgba(248,113,113,.10)';
      ctx.fill();
    } else if (it.funcao === 'zona' || it.funcao === 'bs_velocidade') {
      ctx.globalAlpha = it.funcao === 'zona' ? 0.13 : 0.09; ctx.fillStyle = cor; ctx.fill(); ctx.globalAlpha = 1;
    }
    if (it.funcao === 'roi' || it.funcao === 'bs_busca' || it.funcao === 'bs_velocidade' || (!roiLigada && it.funcao === 'exclusao')) ctx.setLineDash([7 * dpr, 5 * dpr]);
    ctx.stroke();
    ctx.setLineDash([]);
    const [x1, y1] = caixa(n);
    // acima da forma; se ela encosta no topo, por dentro
    pilula(ctx, rotulo(it), x1, y1 - 19 * dpr < vista.dy + 4 * dpr ? y1 + 4 * dpr : y1 - 19 * dpr, cor, dpr);
  } else if (it.tipo === 'linha' || it.tipo === 'regua') {
    if (n < 2) return;
    const ax = P[0], ay = P[1], bx = P[2], by = P[3];
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const nx = -(by - ay) / L, ny = (bx - ax) / L;
    if (it.tipo === 'regua') {
      const k = 6 * dpr;
      ctx.beginPath();
      ctx.moveTo(ax - nx * k, ay - ny * k); ctx.lineTo(ax + nx * k, ay + ny * k);
      ctx.moveTo(bx - nx * k, by - ny * k); ctx.lineTo(bx + nx * k, by + ny * k);
      ctx.stroke();
      pilula(ctx, rotulo(it), (ax + bx) / 2 + 8 * dpr, (ay + by) / 2 + 6 * dpr, cor, dpr);
    } else {
      // seta do sentido "ida", perpendicular, no meio da linha
      const sg = espelhado() ? -1 : 1;
      const mx = (ax + bx) / 2, my = (ay + by) / 2, s = 16 * dpr;
      const ex = mx + nx * s * sg, ey = my + ny * s * sg;
      ctx.beginPath();
      ctx.moveTo(mx - nx * s * 0.4 * sg, my - ny * s * 0.4 * sg); ctx.lineTo(ex, ey);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - (nx * sg) * 6 * dpr + (ny * sg) * 5 * dpr, ey - (ny * sg) * 6 * dpr - (nx * sg) * 5 * dpr);
      ctx.moveTo(ex, ey); ctx.lineTo(ex - (nx * sg) * 6 * dpr - (ny * sg) * 5 * dpr, ey - (ny * sg) * 6 * dpr + (nx * sg) * 5 * dpr);
      ctx.lineWidth = 2.4 * dpr;
      ctx.stroke();
      ctx.font = `700 ${10 * dpr}px ui-monospace, monospace`;
      ctx.fillStyle = cor;
      ctx.beginPath(); ctx.arc(ax, ay, 3.5 * dpr, 0, Math.PI * 2); ctx.arc(bx, by, 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.fillText('A', ax + 5 * dpr, ay - 5 * dpr);
      ctx.fillText('B', bx + 5 * dpr, by - 5 * dpr);
      pilula(ctx, rotulo(it), Math.min(ax, bx), Math.min(ay, by) - 22 * dpr, cor, dpr);
    }
  } else if (it.tipo === 'angulo') {
    if (n < 3) return;
    ctx.beginPath(); ctx.moveTo(P[0], P[1]); ctx.lineTo(P[2], P[3]); ctx.lineTo(P[4], P[5]); ctx.stroke();
    const a1 = Math.atan2(P[1] - P[3], P[0] - P[2]), a2 = Math.atan2(P[5] - P[3], P[4] - P[2]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    ctx.beginPath(); ctx.arc(P[2], P[3], 18 * dpr, a1, a1 + d, d < 0); ctx.stroke();
    pilula(ctx, rotulo(it), P[2] + 12 * dpr, P[3] + 8 * dpr, cor, dpr);
  } else if (it.tipo === 'ponto') {
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(P[0], P[1], 5 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#02302C'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    pilula(ctx, it.nome, P[0] + 8 * dpr, P[1] - 8 * dpr, cor, dpr);
  } else if (desenharNovo(ctx, it, n, sel, dpr)) {
    // tipos novos (polilinha, seta, perfil, distância, contador, cronômetro, trajetória, esqueleto, perspectiva)
  } else if (it.tipo === 'texto') {
    const txt = it.texto || it.nome;
    ctx.font = `600 ${14 * dpr}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const w = ctx.measureText(txt).width + 12 * dpr, h = 22 * dpr;
    ctx.fillStyle = 'rgba(2,48,44,.78)';
    ctx.fillRect(P[0], P[1] - h, w, h);
    ctx.fillStyle = cor;
    ctx.fillRect(P[0], P[1] - h, 3 * dpr, h);
    ctx.fillText(txt, P[0] + 7 * dpr, P[1] - 6 * dpr);
    caixasTexto.set(it.id, [P[0], P[1] - h, w, h]);
  }

  if (it.travado && sel) {
    const [x1, y1] = caixa(n);
    pilula(ctx, '🔒', x1 - 22 * dpr, y1 - 19 * dpr, '#a8a29e', dpr);
  }
  if (sel && !it.travado) alcas(ctx, it, n, dpr);
}

/** Seta na ponta (bx,by) vinda de (ax,ay). */
function ponta(ctx, ax, ay, bx, by, s) {
  const a = Math.atan2(by - ay, bx - ax);
  ctx.beginPath();
  ctx.moveTo(bx, by); ctx.lineTo(bx - s * Math.cos(a - 0.45), by - s * Math.sin(a - 0.45));
  ctx.lineTo(bx - s * Math.cos(a + 0.45), by - s * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

/** Homografia do quadrado unitário para o quadrilátero q (4 pontos em px de tela), Heckbert. */
function quadHomografia(q) {
  const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
  const sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
    g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
    return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + c) / w, (d * u + e * v + f) / w]; };
  }
  // afim (paralelogramo): u ao longo de 0→1, v ao longo de 1→2
  return (u, v) => [c + a * u + b * v, f + d * u + e * v];
}

/** Desenho dos tipos novos. true = desenhou (o chamador não cai no texto). */
function desenharNovo(ctx, it, n, sel, dpr) {
  const cor = it.cor;
  const t = it.tipo;
  if (t === 'polilinha' || t === 'perfil' || t === 'seta' || t === 'distancia') {
    if (n < 2) return true;
    if (t === 'distancia') ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i ? ctx.lineTo(P[i * 2], P[i * 2 + 1]) : ctx.moveTo(P[0], P[1]));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cor;
    const ax = P[(n - 2) * 2], ay = P[(n - 2) * 2 + 1], bx = P[(n - 1) * 2], by = P[(n - 1) * 2 + 1];
    if (t === 'seta') {
      ponta(ctx, ax, ay, bx, by, 13 * dpr);
      if (sel) pilula(ctx, it.nome, P[0] + 8 * dpr, P[1] + 6 * dpr, cor, dpr);
      return true;
    }
    if (t === 'perfil') {
      // marcas de régua nas pontas + "⟿" de que é um perfil
      const L = Math.hypot(bx - P[0], by - P[1]) || 1, nx = -(by - P[1]) / L, ny = (bx - P[0]) / L, k = 5 * dpr;
      ctx.beginPath();
      ctx.moveTo(P[0] - nx * k, P[1] - ny * k); ctx.lineTo(P[0] + nx * k, P[1] + ny * k);
      ctx.moveTo(bx - nx * k, by - ny * k); ctx.lineTo(bx + nx * k, by + ny * k); ctx.stroke();
      ponta(ctx, P[0], P[1], bx, by, 8 * dpr);
    } else if (t === 'distancia') {
      ctx.beginPath(); ctx.arc(P[0], P[1], 4 * dpr, 0, Math.PI * 2); ctx.arc(bx, by, 4 * dpr, 0, Math.PI * 2); ctx.fill();
    } else {
      for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(P[i * 2], P[i * 2 + 1], 2.5 * dpr, 0, Math.PI * 2); ctx.fill(); }
    }
    const mi = Math.floor((n - 1) / 2);
    const mx = (P[mi * 2] + P[(mi + 1) * 2]) / 2, my = (P[mi * 2 + 1] + P[(mi + 1) * 2 + 1]) / 2;
    pilula(ctx, rotulo(it), mx + 8 * dpr, my + 6 * dpr, cor, dpr);
    return true;
  }
  if (t === 'contador') {
    ctx.font = `700 ${10 * dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const x = P[i * 2], y = P[i * 2 + 1];
      ctx.fillStyle = cor;
      ctx.beginPath(); ctx.arc(x, y, 7.5 * dpr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#02302C'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
      ctx.fillStyle = '#02302C';
      ctx.fillText(String(i + 1), x, y + 3.5 * dpr);
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = cor;
    pilula(ctx, rotulo(it), P[0] + 11 * dpr, P[1] - 22 * dpr, cor, dpr);
    return true;
  }
  if (t === 'cronometro') {
    const txt = rotulo(it);
    ctx.font = `700 ${15 * dpr}px ui-monospace, monospace`;
    const w = ctx.measureText(txt).width + 16 * dpr, h = 26 * dpr;
    const x = P[0], y = P[1] - h;
    ctx.fillStyle = 'rgba(2,48,44,.86)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = cor; ctx.fillRect(x, y, 3 * dpr, h);
    if (sel) { ctx.strokeStyle = cor; ctx.lineWidth = 1.5 * dpr; ctx.strokeRect(x, y, w, h); }
    ctx.fillStyle = it.t1 == null ? cor : '#f5f5f4';
    ctx.fillText(txt, x + 9 * dpr, y + 18 * dpr);
    caixasTexto.set(it.id, [x, y, w, h]);
    return true;
  }
  if (t === 'trajetoria') {
    // rastro: mais forte perto da cabeça
    const ini = Math.max(1, n - 600);
    for (let i = ini; i < n; i++) {
      ctx.globalAlpha = 0.25 + 0.75 * ((i - ini) / Math.max(1, n - ini));
      ctx.beginPath(); ctx.moveTo(P[(i - 1) * 2], P[(i - 1) * 2 + 1]); ctx.lineTo(P[i * 2], P[i * 2 + 1]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const hx = P[(n - 1) * 2], hy = P[(n - 1) * 2 + 1];
    ctx.fillStyle = cor;
    ctx.beginPath(); ctx.arc(hx, hy, 4.5 * dpr, 0, Math.PI * 2); ctx.fill();
    if (it.ativo) { ctx.beginPath(); ctx.arc(hx, hy, 10 * dpr, 0, Math.PI * 2); ctx.stroke(); }
    pilula(ctx, rotulo(it), hx + 12 * dpr, hy - 22 * dpr, cor, dpr);
    caixasTexto.set(it.id, [hx - 12 * dpr, hy - 12 * dpr, 24 * dpr, 24 * dpr]);
    return true;
  }
  if (t === 'esqueleto') {
    ctx.beginPath();
    for (const [a, b] of ESQUELETO.ligacoes) if (a < n && b < n) { ctx.moveTo(P[a * 2], P[a * 2 + 1]); ctx.lineTo(P[b * 2], P[b * 2 + 1]); }
    ctx.stroke();
    ctx.fillStyle = cor;
    ctx.font = `600 ${10 * dpr}px ui-monospace, monospace`;
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(P[i * 2], P[i * 2 + 1], 3.5 * dpr, 0, Math.PI * 2); ctx.fill();
      if (sel) ctx.fillText(ESQUELETO.nomes[i] || String(i), P[i * 2] + 5 * dpr, P[i * 2 + 1] - 4 * dpr);
    }
    pilula(ctx, `${it.nome} · ${n}/17`, P[0] + 8 * dpr, P[1] - 26 * dpr, cor, dpr);
    return true;
  }
  if (t === 'perspectiva') {
    if (n < 4) return true;
    const H = quadHomografia([[P[0], P[1]], [P[2], P[3]], [P[4], P[5]], [P[6], P[7]]]);
    const N = it.n || 8;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      let a = H(s, 0), b = H(s, 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      a = H(0, s); b = H(1, s); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    }
    ctx.globalAlpha = 0.75; ctx.lineWidth = 1.2 * dpr; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.lineWidth = (sel ? 2.6 : 1.8) * dpr;
    ctx.beginPath(); for (let i = 0; i < 4; i++) (i ? ctx.lineTo(P[i * 2], P[i * 2 + 1]) : ctx.moveTo(P[0], P[1])); ctx.closePath(); ctx.stroke();
    pilula(ctx, it.nome, P[0] + 6 * dpr, P[1] - 22 * dpr, cor, dpr);
    return true;
  }
  return false;
}

/** Alças nos vértices da selecionada (retângulo/elipse: os quatro cantos). */
function alcas(ctx, it, n, dpr) {
  const s = 4 * dpr;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#02302C';
  ctx.lineWidth = 1.2 * dpr;
  const pts = verticesTela(it, n);
  for (const [x, y] of pts) { ctx.fillRect(x - s, y - s, 2 * s, 2 * s); ctx.strokeRect(x - s, y - s, 2 * s, 2 * s); }
}

function verticesTela(it, n) {
  if (it.tipo === 'trajetoria') return [];
  if (it.tipo === 'retangulo' || it.tipo === 'elipse' || it.tipo === 'mascara') {
    // na ordem: p0, (p1.x,p0.y), p1, (p0.x,p1.y) — o espelho pode trocar esquerda/direita, então usa os pontos e não a caixa
    const a = [P[0], P[1]], b = [P[2], P[3]];
    return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  }
  const out = [];
  for (let i = 0; i < n; i++) out.push([P[i * 2], P[i * 2 + 1]]);
  return out;
}

function desenharRascunho(ctx, r, dpr) {
  if (r.canvas) { desenharGrade(ctx, r.canvas, 0.55); return; }
  let pts = r.cursor ? [...r.pts, r.cursor] : r.pts;
  if (!pts.length) return;
  const corR = r.ferr === 'exclusao' ? '#f87171' : r.ferr === 'roi' ? '#38bdf8' : r.ferr === 'exemplo' ? dadosExemplo().cor : '#FFD84D';
  // círculo por 3 pontos: com 2 cliques + cursor já mostra o círculo
  if (r.ferr === 'circulo3' && pts.length === 3) {
    const c = circuloPor3(pts[0], pts[1], pts[2]);
    if (c) {
      const n = telaDe({ pts: c.caixa });
      ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = corR;
      ctx.beginPath(); caminhoArea(ctx, 'elipse', n); ctx.stroke(); ctx.setLineDash([]);
      pilula(ctx, `⌀ ${fmtComprimento(2 * c.r)}`, P[2] + 8 * dpr, P[1] + 6 * dpr, corR, dpr);
    }
  }
  if (r.ferr === 'pontosChave' && r.cursor) pts = r.pts.concat([r.cursor]);
  const n = telaDe({ pts });
  ctx.setLineDash([6 * dpr, 4 * dpr]);
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = corR;
  ctx.beginPath();
  const [tipo] = CRIA[r.ferr] || ['retangulo'];
  if (AREAS.has(tipo) && tipo !== 'poligono' && r.ferr !== 'circulo3') caminhoArea(ctx, tipo === 'mascara' ? 'retangulo' : tipo, n);
  else if (r.ferr === 'pontosChave') {
    for (const [a, b] of ESQUELETO.ligacoes) if (a < n && b < n) { ctx.moveTo(P[a * 2], P[a * 2 + 1]); ctx.lineTo(P[b * 2], P[b * 2 + 1]); }
  } else if (r.ferr !== 'circulo3') {
    for (let i = 0; i < n; i++) (i ? ctx.lineTo(P[i * 2], P[i * 2 + 1]) : ctx.moveTo(P[0], P[1]));
    if (r.ferr === 'perspectiva' && n === 4) ctx.closePath();
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#FFD84D';
  for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(P[i * 2], P[i * 2 + 1], 3.5 * dpr, 0, Math.PI * 2); ctx.fill(); }
  // medida ao vivo enquanto desenha
  if ((tipo === 'regua' || tipo === 'perfil' || tipo === 'distancia' || tipo === 'polilinha') && pts.length >= 2) pilula(ctx, fmtComprimento(comprimentoPx({ pts })), P[n * 2 - 2] + 8 * dpr, P[n * 2 - 1] + 6 * dpr, '#FFD84D', dpr);
  if (tipo === 'angulo' && pts.length === 3) { const a = anguloGraus({ pts }); if (a != null) pilula(ctx, a.toFixed(1) + '°', P[2] + 12 * dpr, P[3] + 8 * dpr, '#FFD84D', dpr); }
  if (r.ferr === 'medirArea' && pts.length >= 3) pilula(ctx, `${fmtArea(areaPx({ tipo: 'poligono', pts }))} · per. ${fmtComprimento(perimetroPx({ tipo: 'poligono', pts }))}`, P[0] + 8 * dpr, P[1] - 22 * dpr, '#FFD84D', dpr);
  if (r.ferr === 'pontosChave') {
    const prox = ESQUELETO.nomes[r.pts.length];
    if (prox && r.cursor) pilula(ctx, `próximo: ${prox}`, P[n * 2 - 2] + 10 * dpr, P[n * 2 - 1] + 8 * dpr, '#FFD84D', dpr);
  }
}

/** Grade do pincel (canvas do tamanho da fonte reduzida) sobre a imagem, com espelho e zoom. */
function desenharGrade(ctx, c, alfa) {
  const a = fonteParaTela(0, 0, [0, 0]).slice(), b = fonteParaTela(1, 1, [0, 0]).slice();
  const dw = b[0] - a[0], dh = b[1] - a[1];
  ctx.save();
  ctx.globalAlpha = alfa;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(a[0], a[1]);
  ctx.scale(dw < 0 ? -1 : 1, dh < 0 ? -1 : 1);
  ctx.drawImage(c, 0, 0, Math.abs(dw), Math.abs(dh));
  ctx.restore();
}

/** Prévia do "Segmentar com um clique": polígono da máscara e os pontos (verde +, vermelho −). */
function desenharSam(ctx, s, dpr) {
  if (s.poligono && s.poligono.length >= 3) {
    const n = telaDe({ pts: s.poligono });
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i ? ctx.lineTo(P[i * 2], P[i * 2 + 1]) : ctx.moveTo(P[0], P[1]));
    ctx.closePath();
    ctx.fillStyle = 'rgba(56,189,248,.28)'; ctx.fill();
    ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#38bdf8'; ctx.stroke();
  }
  for (const p of s.pontos) {
    fonteParaTela(p.u, p.v, t2);
    ctx.fillStyle = p.pos ? '#4ade80' : '#f87171';
    ctx.beginPath(); ctx.arc(t2[0], t2[1], 5.5 * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#02302C'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
    ctx.fillStyle = '#02302C';
    ctx.fillRect(t2[0] - 3 * dpr, t2[1] - 0.75 * dpr, 6 * dpr, 1.5 * dpr);
    if (p.pos) ctx.fillRect(t2[0] - 0.75 * dpr, t2[1] - 3 * dpr, 1.5 * dpr, 6 * dpr);
  }
  if (s.pontos.length) {
    fonteParaTela(s.pontos[0].u, s.pontos[0].v, t2);
    const txt = s.ocupado ? 'SAM: segmentando…' : s.poligono ? `SAM · IoU ${Math.round((s.iou || 0) * 100)}% · Enter conclui` : 'SAM: nada aqui — clique de novo';
    pilula(ctx, txt, t2[0] + 10 * dpr, t2[1] + 10 * dpr, '#38bdf8', dpr);
  }
}

// ------------------------------------------------------------- acerto (hit test)

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Marcação sob o ponto (px do canvas), a de cima primeiro. */
function acharItem(x, y) {
  const st = marcStore.get();
  const tol = 9 * vista.dpr;
  for (let k = st.itens.length - 1; k >= 0; k--) {
    const it = st.itens[k];
    if (!it.visivel || !st.visivel) continue;
    const n = telaDe(it);
    if (it.tipo === 'texto' || it.tipo === 'cronometro' || it.tipo === 'trajetoria') {
      const b = caixasTexto.get(it.id);
      if (b && x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]) return it;
      if (it.tipo !== 'trajetoria') continue;
    }
    if (it.tipo === 'ponto') { if (Math.hypot(x - P[0], y - P[1]) < tol * 1.4) return it; continue; }
    if (it.tipo === 'contador' || it.tipo === 'esqueleto') {
      let ok = false;
      for (let i = 0; i < n && !ok; i++) if (Math.hypot(x - P[i * 2], y - P[i * 2 + 1]) < tol * 1.2) ok = true;
      if (ok) return it;
      continue;
    }
    if (it.tipo === 'mascara') {
      const [u, v] = vistaParaFonte((x - vista.dx) / vista.dw, (y - vista.dy) / vista.dh);
      if (dentroFonte(it, u, v)) return it;
      continue;
    }
    if (it.tipo === 'perspectiva' && n >= 4) {
      for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; if (distSeg(x, y, P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1]) < tol) return it; }
      continue;
    }
    if (AREAS.has(it.tipo)) {
      const [x1, y1, x2, y2] = caixa(n);
      if (it.tipo === 'retangulo' && x >= x1 - tol && x <= x2 + tol && y >= y1 - tol && y <= y2 + tol) return it;
      if (it.tipo === 'elipse') {
        const rx = (x2 - x1) / 2 + tol, ry = (y2 - y1) / 2 + tol;
        const dx = (x - (x1 + x2) / 2) / rx, dy = (y - (y1 + y2) / 2) / ry;
        if (dx * dx + dy * dy <= 1) return it;
      }
      if (it.tipo === 'poligono') {
        let d = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const yi = P[i * 2 + 1], yj = P[j * 2 + 1], xi = P[i * 2], xj = P[j * 2];
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) d = !d;
          if (distSeg(x, y, xi, yi, xj, yj) < tol) return it;
        }
        if (d) return it;
      }
      continue;
    }
    for (let i = 1; i < n; i++) if (distSeg(x, y, P[i * 2 - 2], P[i * 2 - 1], P[i * 2], P[i * 2 + 1]) < tol) return it;
  }
  return null;
}

function acharVertice(it, x, y) {
  const n = telaDe(it);
  const v = verticesTela(it, n);
  const tol = 11 * vista.dpr;
  for (let i = 0; i < v.length; i++) if (Math.hypot(x - v[i][0], y - v[i][1]) < tol) return i;
  return -1;
}

// ------------------------------------------------------------- ponteiro

let arr = null;   // gesto em andamento: { modo, id, idx, ini, orig, x0, y0, marcado }

/** Avisos curtos das ferramentas (o widget mostra junto da dica). */
export const avisoStore = createStore({ texto: '' });
let avisoT = 0;
export function avisar(texto, ms = 3500) {
  clearTimeout(avisoT);
  avisoStore.set({ texto });
  if (texto && ms) avisoT = setTimeout(() => avisoStore.set({ texto: '' }), ms);
}

const DOIS_PONTOS = new Set(['retangulo', 'exemplo', 'roi', 'exclusao', 'elipse', 'linha', 'regua', 'seta', 'perfil', 'histograma']);
/** Ferramentas de vários cliques e quantos pontos fecham sozinhas (0 = Enter/duplo clique). */
const VARIOS = { poligono: 0, medirArea: 0, polilinha: 0, angulo: 3, circulo3: 3, perspectiva: 4, pontosChave: 17, distancia: 2 };
const FECHADOS = new Set(['poligono', 'medirArea']);
const MIN_PONTOS = { poligono: 3, medirArea: 3, polilinha: 2, pontosChave: 1 };
/** Pontos que encaixam na borda quando "Encaixar na borda" está ligado. */
const ENCAIXAM = new Set(['poligono', 'medirArea', 'polilinha', 'angulo', 'circulo3', 'perspectiva', 'pontosChave', 'distancia', 'linha', 'regua', 'perfil', 'seta', 'ponto']);

function ferramenta() {
  const f = marcStore.get().ferramenta;
  return f && f !== 'mover' ? f : null;
}

const encaixe = (p, f) => (marcStore.get().exib.encaixe && (!f || ENCAIXAM.has(f)) ? encaixarBorda(p) : p);

/** Tira do fim os pontos quase iguais que o duplo clique deixa. */
function semDuplos(pts, min) {
  while (pts.length > min && Math.hypot(pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]) < 0.004) pts.pop();
  return pts;
}

const comoExemplo = () => (projetoAtivo() ? { funcao: 'projeto_exemplo' } : {});

/** Fecha o rascunho como marcação nova. */
function concluir() {
  const r = rt.rascunho;
  if (!r) return;
  rt.rascunho = null;
  const pts = r.pts.slice();
  if (MIN_PONTOS[r.ferr]) {
    semDuplos(pts, MIN_PONTOS[r.ferr]);
    if (pts.length < MIN_PONTOS[r.ferr]) { rt.redesenhar(); return; }
  }
  if (r.ferr === 'circulo3') {
    const c = pts.length === 3 && circuloPor3(pts[0], pts[1], pts[2]);
    if (!c) { avisar('Os três pontos estão alinhados: não há círculo por eles'); rt.redesenhar(); return; }
    criar('circulo3', c.caixa, { nomeBase: 'Círculo' });
    return;
  }
  if (r.ferr === 'distancia') { criar('distancia', pts, { refs: r.refs || [null, null] }); return; }
  if (r.ferr === 'histograma') { const id = criar('histograma', pts, { nomeBase: 'Histograma' }); marcStore.set({ analise: id }); return; }
  if (r.ferr === 'perfil') { const id = criar('perfil', pts); marcStore.set({ analise: id }); return; }
  criar(r.ferr, pts);
}

export function cancelarRascunho() {
  if (!rt.rascunho && !rt.sam) return false;
  rt.rascunho = null;
  rt.sam = null;
  rt.redesenhar();
  return true;
}

/** Enter: fecha o polígono / polilinha / esqueleto em construção, ou confirma o SAM. */
export function fecharPoligono() {
  if (rt.sam) return concluirSam();
  const r = rt.rascunho;
  const min = r && MIN_PONTOS[r.ferr];
  if (min && r.pts.length >= min) { concluir(); return true; }
  return false;
}

/** Backspace durante um desenho de vários pontos (ou no SAM): tira o último ponto. */
export function desfazerPonto() {
  if (rt.sam && rt.sam.pontos.length) {
    rt.sam.pontos.pop();
    if (!rt.sam.pontos.length) rt.sam = null; else rodarSam();
    rt.redesenhar();
    return true;
  }
  const r = rt.rascunho;
  if (!r || !(r.ferr in VARIOS) || r.pts.length < 2) return false;
  r.pts.pop();
  if (r.refs) r.refs.pop();
  rt.redesenhar();
  return true;
}

// ---- SAM: cada clique roda o decodificador; o codificador uma vez por quadro
let samSessao = 0;
let samRelogio = 0;
async function rodarSam() {
  const s = rt.sam;
  if (!s) return;
  if (s.ocupado) { s.pendente = true; return; }
  s.ocupado = true; s.pendente = false;
  const pontos = s.pontos.slice();
  clearInterval(samRelogio);
  samRelogio = setInterval(() => { const t = situacaoSam(); if (t !== 'pronto') avisar('SAM (MobileSAM): ' + t, 0); }, 400);
  try {
    const r = await segmentarSam(pontos, s.sessao);
    if (rt.sam === s) { s.poligono = r && r.pts; s.iou = r ? r.iou : 0; }
    avisar('');
  } catch (e) {
    avisar('SAM: ' + (e && e.message ? e.message : 'falhou'), 6000);
    if (rt.sam === s) s.poligono = null;
  } finally {
    clearInterval(samRelogio);
    s.ocupado = false;
    rt.redesenhar();
    if (rt.sam === s && s.pendente) rodarSam();
  }
}

function concluirSam() {
  const s = rt.sam;
  if (!s) return false;
  if (!s.poligono || s.ocupado) { if (!s.ocupado) { rt.sam = null; rt.redesenhar(); } return Boolean(s.ocupado); }
  rt.sam = null;
  criar('sam', s.poligono, { nomeBase: 'SAM', ...comoExemplo() });
  return true;
}

// ---- pincel de máscara: pinta numa grade do tamanho da fonte reduzida (≤ 1024 px)
function iniciarPincel(f, x, y, p) {
  const st = marcStore.get();
  let alvo = st.sel && st.itens.find((i) => i.id === st.sel && i.tipo === 'mascara' && !i.travado);
  if (!alvo && f === 'borrachaMascara') { const h = acharItem(x, y); if (h && h.tipo === 'mascara' && !h.travado) alvo = h; }
  if (!alvo && f === 'borrachaMascara') { avisar('Selecione (ou passe por cima de) uma máscara para apagar pixels'); return false; }
  const k = Math.min(1, 1024 / Math.max(vista.W, vista.H));
  const gw = Math.max(1, Math.round(vista.W * k)), gh = Math.max(1, Math.round(vista.H * k));
  const c = document.createElement('canvas');
  c.width = gw; c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true });
  const cor = alvo ? (/^#[0-9a-f]{6}$/i.test(alvo.cor) ? alvo.cor : '#FFD84D') : '#FFD84D';
  if (alvo) pintarMascara(g, alvo.mask, alvo.pts[0][0] * gw, alvo.pts[0][1] * gh, alvo.pts[1][0] * gw, alvo.pts[1][1] * gh, cor);
  rt.rascunho = { ferr: f, canvas: c, g, gw, gh, k, alvo: alvo ? alvo.id : null, cor, ult: p };
  pincelar(p, p);
  return true;
}

function pincelar(a, b) {
  const r = rt.rascunho;
  if (!r || !r.canvas) return;
  const raio = Math.max(0.5, (marcStore.get().opc.raio || 14) * vista.dpr * (vista.sw / Math.max(1, vista.dw)) * r.k);
  const g = r.g;
  g.save();
  g.globalCompositeOperation = r.ferr === 'pincel' ? 'source-over' : 'destination-out';
  g.strokeStyle = r.cor; g.fillStyle = r.cor;
  g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 2 * raio;
  g.beginPath(); g.moveTo(a[0] * r.gw, a[1] * r.gh); g.lineTo(b[0] * r.gw, b[1] * r.gh); g.stroke();
  g.beginPath(); g.arc(b[0] * r.gw, b[1] * r.gh, raio, 0, Math.PI * 2); g.fill();
  g.restore();
  r.ult = b;
}

function terminarPincel() {
  const r = rt.rascunho;
  rt.rascunho = null;
  if (!r || !r.canvas) return;
  const d = r.g.getImageData(0, 0, r.gw, r.gh).data;
  const bits = new Uint8Array(r.gw * r.gh);
  for (let i = 0; i < bits.length; i++) bits[i] = d[i * 4 + 3] > 127 ? 1 : 0;
  const res = recortarMascara(bits, r.gw, r.gh, [[0, 0], [1, 1]]);
  if (r.alvo) {
    if (res) atualizar(r.alvo, { pts: res.pts, mask: res.mask });
    else apagar(r.alvo);
  } else if (res) criar('pincel', res.pts, { mask: res.mask });
  rt.redesenhar();
}

/** pointerdown no canvas. true = consumido (o zoom/arrasto não roda). */
/** Sem fonte ligada (o cartão inicial está na tela): o vídeo não tem menu próprio. */
export function semFonte() {
  const st = store.get();
  return !st.cameraOn && st.sourceKind === 'camera';
}

export function ponteiroDown(e) {
  // botão direito: arrastar seleciona uma área; soltar abre o menu de contexto
  if (e.button === 2 && vista.ok && !semFonte()) {
    const [x, y] = clienteParaTela(e.clientX, e.clientY);
    dir = { x0: x, y0: y, cx: e.clientX, cy: e.clientY, p0: clienteParaFonte(e.clientX, e.clientY), t: performance.now() };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue */ }
    return true;
  }
  // toque longo (celular): menu de contexto no ponto
  if (e.pointerType === 'touch' && vista.ok && !semFonte()) {
    clearTimeout(longo.t);
    longo.x = e.clientX; longo.y = e.clientY;
    longo.t = setTimeout(() => {
      longo.t = 0;
      cancelarRascunho();
      arr = null;
      menuNoPonto(longo.x, longo.y);
    }, 550);
  }
  const f = ferramenta();
  if (!f) return vista.ok && (e.button === undefined || e.button === 0) ? downNavegando(e) : false;
  if (!vista.ok) return false;
  if (e.button !== undefined && e.button !== 0) return true;
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue sem captura */ }
  const p0 = clienteParaFonte(e.clientX, e.clientY);
  const [x, y] = clienteParaTela(e.clientX, e.clientY);
  const st = marcStore.get();

  if (DOIS_PONTOS.has(f)) {
    const p = encaixe(p0, f);
    if (rt.rascunho && rt.rascunho.ferr === f) {       // segundo clique do modo clique-clique
      rt.rascunho.pts[1] = p;
      concluir();
      return true;
    }
    rt.rascunho = { ferr: f, pts: [p, p] };
    arr = { modo: 'criar', x0: x, y0: y };
  } else if (f in VARIOS) {
    let p = encaixe(p0, f), ref = null;
    if (f === 'distancia') {
      // clicar num objeto liga a ponta ao centroide dele (segue se o objeto mudar)
      const hit = acharItem(x, y);
      if (hit && hit.tipo !== 'distancia' && hit.tipo !== 'contador') { p = centroide(hit); ref = hit.id; }
    }
    const r = rt.rascunho;
    if (!r || r.ferr !== f) rt.rascunho = { ferr: f, pts: [p], cursor: p, refs: [ref] };
    else if (FECHADOS.has(f) && r.pts.length >= 3 && (() => { fonteParaTela(r.pts[0][0], r.pts[0][1], t2); return Math.hypot(x - t2[0], y - t2[1]) < 10 * vista.dpr; })()) {
      concluir(); return true;
    } else {
      r.pts.push(p); r.refs.push(ref);
      if (VARIOS[f] && r.pts.length >= VARIOS[f]) { r.cursor = null; concluir(); return true; }
    }
  } else if (f === 'ponto') {
    criar('ponto', [encaixe(p0, f)]);
  } else if (f === 'texto') {
    const hit = acharItem(x, y);
    if (hit && hit.tipo === 'texto') marcStore.set({ editando: hit.id, sel: hit.id });
    else { const id = criar('texto', [p0], { texto: '' }); marcStore.set({ editando: id }); }
  } else if (f === 'contagotas') {
    lerCor(e, true);
  } else if (f === 'borracha') {
    const hit = acharItem(x, y);
    if (hit && !hit.travado) apagar(hit.id);
    arr = { modo: 'apagar' };
  } else if (f === 'pincel' || f === 'borrachaMascara') {
    if (iniciarPincel(f, x, y, p0)) arr = { modo: 'pincel' };
  } else if (f === 'varinha') {
    const o = st.opc;
    const r = varinha(p0, { tolerancia: o.tolerancia, contiguo: o.contiguo });
    if (!r) avisar('Varinha: não deu para ler os pixels desta fonte');
    else if (r.tipo === 'poligono') { criar('varinha', r.pts, { nomeBase: 'Varinha', ...comoExemplo() }); avisar(`Varinha: ${Math.round(r.pixels)} px da fonte · ${r.pts.length} vértices`); }
    else { criar('pincel', r.pts, { mask: r.mask, nomeBase: 'Varinha' }); avisar(`Varinha (não contígua): máscara com ${Math.round(r.pixels)} px`); }
  } else if (f === 'sam') {
    if (!rt.sam) rt.sam = { pontos: [], poligono: null, ocupado: false, sessao: ++samSessao };
    rt.sam.pontos.push({ u: p0[0], v: p0[1], pos: !(e.shiftKey || e.altKey) });
    rodarSam();
  } else if (f === 'contador') {
    if (e.shiftKey || e.altKey) { if (!descontarClique(p0, 14 * (vista.sw / Math.max(1, vista.dw)) * vista.dpr)) avisar('Nenhum clique contado perto daqui'); }
    else contarClique(p0);
  } else if (f === 'cronometro') {
    const hit = acharItem(x, y);
    const a = tempoAgora();
    if (hit && hit.tipo === 'cronometro' && !hit.travado) {
      if (hit.t1 == null) atualizar(hit.id, { t1: a.relogio === hit.relogio ? a.t : hit.t0, voltas: [] });
      else atualizar(hit.id, { t0: a.t, t1: null, relogio: a.relogio, voltas: [] });
    } else criar('cronometro', [p0], { t0: a.t, t1: null, relogio: a.relogio });
  } else if (f === 'trajetoria') {
    const hit = acharItem(x, y);
    if (hit && hit.tipo === 'trajetoria' && !hit.travado) {
      soltarModelo(hit.id);
      if (!hit.ativo) iniciarTrajetoria(hit.id, hit.pts[hit.pts.length - 1]);
      atualizar(hit.id, { ativo: !hit.ativo, perdido: null });
    } else {
      // o modelo é pego no quadro do clique (antes de criar: o id vem depois, então cria e pega)
      const a = tempoAgora();
      const id = criar('trajetoria', [p0], { ts: [a.t], ativo: true });
      const t = iniciarTrajetoria(id, p0);
      if (t !== a.t) editarSemHistorico((itens) => itens.map((i) => (i.id === id ? { ...i, ts: [t] } : i)));
    }
  } else if (f === 'selecionar') {
    const sel = st.sel && st.itens.find((i) => i.id === st.sel);
    const iv = sel && !sel.travado && !e.shiftKey ? acharVertice(sel, x, y) : -1;
    const ia = iv < 0 && sel && !sel.travado && !e.shiftKey ? acharAresta(sel, x, y) : null;
    if (iv >= 0) {
      arr = { modo: 'vertice', id: sel.id, idx: iv, marcado: false };
    } else if (ia) {
      arr = { modo: 'aresta', id: sel.id, ini: p0, orig: sel.pts.map((q) => q.slice()), aresta: ia, marcado: false };
    } else {
      const hit = acharItem(x, y);
      if (hit && hit.tipo === 'linha' && hit.id === st.sel && !hit.travado) {
        // clique na seta do meio inverte o sentido
        const n = telaDe(hit);
        if (n >= 2 && Math.hypot(x - (P[0] + P[2]) / 2, y - (P[1] + P[3]) / 2) < 22 * vista.dpr) { inverter(hit.id); return true; }
      }
      if (e.shiftKey && hit) { selecionar(hit.id, true); rt.redesenhar(); return true; }
      // arrastar uma das várias selecionadas move todas (as travadas ficam)
      const varias = hit && st.selN.length > 1 && st.selN.includes(hit.id);
      if (!varias) selecionar(hit ? hit.id : null);
      if (hit && !hit.travado) {
        const ids = varias ? st.selN : [hit.id];
        const orig = new Map(st.itens.filter((i) => ids.includes(i.id) && !i.travado).map((i) => [i.id, i.pts.map((q) => q.slice())]));
        arr = { modo: 'mover', ini: p0, orig, marcado: false };
      }
    }
  }
  rt.redesenhar();
  return true;
}

export function ponteiroMove(e) {
  rt.cursor = { cx: e.clientX, cy: e.clientY };
  desenharAuxilios();
  if (longo.t && Math.hypot(e.clientX - longo.x, e.clientY - longo.y) > 10) { clearTimeout(longo.t); longo.t = 0; }
  if (dir) {
    const p = clienteParaFonte(e.clientX, e.clientY);
    const [x, y] = clienteParaTela(e.clientX, e.clientY);
    if (rt.selecao || Math.hypot(x - dir.x0, y - dir.y0) > 6 * vista.dpr) { rt.selecao = { pts: [dir.p0, p] }; rt.redesenhar(); }
    return true;
  }
  const f = ferramenta();
  if (!f && vista.ok) return moveNavegando(e);
  if (!f || !vista.ok) return false;
  const p = clienteParaFonte(e.clientX, e.clientY);
  const r = rt.rascunho;
  if (f === 'contagotas') { lerCor(e, false); return true; }
  if (r && r.canvas) {
    if (arr && arr.modo === 'pincel' && e.buttons) { pincelar(r.ult, p); rt.redesenhar(); }
    return true;
  }
  if (r) {
    if (DOIS_PONTOS.has(r.ferr)) r.pts[1] = p;
    else r.cursor = p;
    rt.redesenhar();
    return true;
  }
  const [x, y] = clienteParaTela(e.clientX, e.clientY);
  if (arr && arr.modo === 'apagar' && e.buttons) {
    const hit = acharItem(x, y);
    if (hit && !hit.travado) apagar(hit.id);
    return true;
  }
  if (arr && (arr.modo === 'vertice' || arr.modo === 'mover' || arr.modo === 'aresta')) {
    arrastar(p);
    return true;
  }
  // realce do que está sob o cursor (borracha e seleção)
  if (f === 'borracha' || f === 'selecionar' || f === 'cronometro' || f === 'trajetoria' || f === 'distancia' || f === 'borrachaMascara') {
    const hit = acharItem(x, y);
    const id = hit ? hit.id : null;
    if (id !== rt.hover) { rt.hover = id; rt.redesenhar(); }
  }
  return true;
}

/** Arrasto de vértice, aresta ou forma inteira (com «Selecionar» ou direto com «Mover»). */
function arrastar(p) {
  {
    if (!arr.marcado) { marcoDesfazer(); arr.marcado = true; }
    rt.arrastando = true;
    if (arr.modo === 'aresta') {
      const du = p[0] - arr.ini[0], dv = p[1] - arr.ini[1];
      const { id, orig, aresta } = arr;
      editarSemHistorico((itens) => itens.map((it) => (it.id !== id ? it : { ...it, pts: moverAresta(orig, aresta, du, dv) })));
      return;
    }
    if (arr.modo === 'vertice') {
      const { id, idx } = arr;
      const q = encaixe(p, null);
      editarSemHistorico((itens) => itens.map((it) => { if (it.id !== id) return it; const mv = moverVertice(it, idx, q); return Array.isArray(mv) ? { ...it, pts: mv } : { ...it, ...mv }; }));
    } else {
      const du = p[0] - arr.ini[0], dv = p[1] - arr.ini[1];
      const { orig } = arr;
      editarSemHistorico((itens) => itens.map((it) => (!orig.has(it.id) ? it : {
        ...it, pts: orig.get(it.id).map((q) => [Math.max(0, Math.min(1, q[0] + du)), Math.max(0, Math.min(1, q[1] + dv))]),
      })));
    }
  }
}

function moverVertice(it, idx, p) {
  const pts = it.pts.map((q) => q.slice());
  if (it.tipo === 'retangulo' || it.tipo === 'elipse' || it.tipo === 'mascara') {
    // cantos: 0=p0, 1=(p1.x,p0.y), 2=p1, 3=(p0.x,p1.y)
    if (idx === 0) pts[0] = p;
    else if (idx === 1) { pts[1][0] = p[0]; pts[0][1] = p[1]; }
    else if (idx === 2) pts[1] = p;
    else { pts[0][0] = p[0]; pts[1][1] = p[1]; }
  } else pts[idx] = p;
  // distância: arrastar a ponta solta a ligação com o objeto
  if (it.tipo === 'distancia' && it.refs) return { pts, refs: it.refs.map((r, k) => (k === idx ? null : r)) };
  return pts;
}

/**
 * Aresta da forma selecionada sob o ponto: { i, j } (polígono, perspectiva, polilinha) ou
 * { lado: 'x1'|'x2'|'y1'|'y2' } (retângulo). Arrastar a aresta move as duas pontas juntas.
 */
function acharAresta(it, x, y) {
  if (!it || it.tipo === 'ponto' || it.tipo === 'texto' || it.tipo === 'contador' || it.tipo === 'trajetoria' || it.tipo === 'mascara') return null;
  const n = telaDe(it);
  const tol = 8 * vista.dpr;
  if (it.tipo === 'retangulo' || it.tipo === 'elipse') {
    const [x1, y1, x2, y2] = caixa(n);
    const dentroY = y >= y1 - tol && y <= y2 + tol, dentroX = x >= x1 - tol && x <= x2 + tol;
    // qual ponto (0 ou 1) tem o x/y de cada lado (o espelho pode trocar)
    const ix1 = P[0] <= P[2] ? 0 : 1, iy1 = P[1] <= P[3] ? 0 : 1;
    if (dentroY && Math.abs(x - x1) < tol) return { eixo: 0, idx: ix1 };
    if (dentroY && Math.abs(x - x2) < tol) return { eixo: 0, idx: 1 - ix1 };
    if (dentroX && Math.abs(y - y1) < tol) return { eixo: 1, idx: iy1 };
    if (dentroX && Math.abs(y - y2) < tol) return { eixo: 1, idx: 1 - iy1 };
    return null;
  }
  if (n < 2 || it.tipo === 'linha' || it.tipo === 'regua' || it.tipo === 'seta' || it.tipo === 'perfil') return null;   // linha: arrastar = mover
  const fechada = AREAS.has(it.tipo) || it.tipo === 'perspectiva';
  const m = fechada ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % n;
    if (distSeg(x, y, P[i * 2], P[i * 2 + 1], P[j * 2], P[j * 2 + 1]) < tol) return { i, j };
  }
  return null;
}

function moverAresta(orig, a, du, dv) {
  const pts = orig.map((q) => q.slice());
  const c = (v) => Math.max(0, Math.min(1, v));
  if (a.eixo !== undefined) {
    // o deslocamento da tela vira deslocamento na fonte: com espelho, x anda ao contrário — já vem da fonte
    pts[a.idx][a.eixo] = c(orig[a.idx][a.eixo] + (a.eixo === 0 ? du : dv));
    return pts;
  }
  for (const k of [a.i, a.j]) pts[k] = [c(orig[k][0] + du), c(orig[k][1] + dv)];
  return pts;
}

/*
 * «Mover» (navegar): o vídeo continua respondendo a zoom e arrasto, mas as REGIÕES (marcações e as
 * regiões dos operadores, cv/regioes.js) são clicáveis — clicar seleciona; com a forma já
 * selecionada, arrastar o vértice, a aresta ou a forma ajusta. Arrastar sobre uma forma não
 * selecionada continua sendo o arrasto do enquadramento (não move zona sem querer).
 */
let pendSel = null;
function downNavegando(e) {
  const st = marcStore.get();
  if (!st.itens.length || !st.visivel || semFonte()) return false;
  const [x, y] = clienteParaTela(e.clientX, e.clientY);
  const p0 = clienteParaFonte(e.clientX, e.clientY);
  const sel = st.sel && st.itens.find((i) => i.id === st.sel);
  if (sel && !sel.travado) {
    const iv = acharVertice(sel, x, y);
    const ia = iv < 0 ? acharAresta(sel, x, y) : null;
    const dentro = iv < 0 && !ia && acharItem(x, y) === sel;
    if (iv >= 0 || ia || dentro) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue */ }
      if (iv >= 0) arr = { modo: 'vertice', id: sel.id, idx: iv, marcado: false };
      else if (ia) arr = { modo: 'aresta', id: sel.id, ini: p0, orig: sel.pts.map((q) => q.slice()), aresta: ia, marcado: false };
      else arr = { modo: 'mover', ini: p0, orig: new Map([[sel.id, sel.pts.map((q) => q.slice())]]), marcado: false };
      arr.nav = true;
      rt.redesenhar();
      return true;
    }
  }
  const hit = acharItem(x, y);
  pendSel = { id: hit ? hit.id : null, cx: e.clientX, cy: e.clientY };
  return false;     // o Viewport segue com o zoom/arrasto; o clique (sem arrastar) seleciona no soltar
}

function moveNavegando(e) {
  if (arr && arr.nav) {
    arrastar(clienteParaFonte(e.clientX, e.clientY));
    return true;
  }
  if (pendSel && Math.hypot(e.clientX - pendSel.cx, e.clientY - pendSel.cy) > 5) pendSel = null;
  // realce sob o cursor (só com formas na tela; nada a fazer sem elas)
  const st = marcStore.get();
  if (!st.itens.length || !st.visivel || e.buttons) return false;
  const [x, y] = clienteParaTela(e.clientX, e.clientY);
  const hit = acharItem(x, y);
  const id = hit ? hit.id : null;
  if (id !== rt.hover) {
    rt.hover = id; rt.redesenhar();
    if (vista.canvas) vista.canvas.style.cursor = id ? 'pointer' : '';
  }
  return false;
}

function upNavegando(e) {
  if (arr && arr.nav) {
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    arr = null;
    rt.arrastando = false;
    rt.redesenhar();
    return true;
  }
  const ps = pendSel;
  pendSel = null;
  if (ps && Math.hypot(e.clientX - ps.cx, e.clientY - ps.cy) <= 5) {
    const st = marcStore.get();
    if (ps.id || st.sel) { selecionar(ps.id); rt.redesenhar(); }
    // região de operador com ação de clique (radar sem calibração → assistente)
    const it = ps.id && st.itens.find((i) => i.id === ps.id);
    const r = it && it.vinc && regiaoDoItem(it);
    if (r && r.def.aoClicar) { try { r.def.aoClicar(paramsDe(r.no), r.no); } catch (err) { console.warn('[regiões] clique', err); } }
  }
  return false;
}

// ---- teclado das seleções: setas (ajuste fino) sempre; Esc, Delete e desfazer com o widget fechado
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const st = marcStore.get();
    if (!st.sel || !vista.ok) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector('.pje, .vde')) return;
    const pega = () => { e.preventDefault(); e.stopImmediatePropagation(); };
    const seta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (seta && !e.altKey && !e.ctrlKey && !e.metaKey) {
      // 1 px da tela (⇧: 10), convertido para a fonte; com espelho, a seta segue o que se vê
      const k = (e.shiftKey ? 10 : 1) * vista.dpr;
      const sgx = vista.fd !== vista.fs ? -1 : 1;
      const du = (seta[0] * k * sgx * vista.sw) / (vista.dw * vista.W), dv = (seta[1] * k * vista.sh) / (vista.dh * vista.H);
      const ids = st.selN.length ? st.selN : [st.sel];
      const c = (v) => Math.max(0, Math.min(1, v));
      pega();
      confirmar((itens) => itens.map((it) => (!ids.includes(it.id) || it.travado ? it : { ...it, pts: it.pts.map(([u, v]) => [c(u + du), c(v + dv)]) })));
      return;
    }
    if (rt.widgetAtivo) return;      // com o widget aberto, Esc/Delete/desfazer são dele (FerramentasMouse)
    if (e.key === 'Escape') { pega(); selecionar(null); rt.redesenhar(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { pega(); apagar(st.sel); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey && st.podeDesfazer) { pega(); desfazerM(); }
      else if (((k === 'z' && e.shiftKey) || k === 'y') && st.podeRefazer) { pega(); refazerM(); }
    }
  }, true);
}

export function ponteiroUp(e) {
  if (longo.t) { clearTimeout(longo.t); longo.t = 0; }
  if (dir) {
    const d = dir;
    dir = null;
    dirFim = performance.now();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
    const sel = rt.selecao;
    if (sel) {
      // a seleção fica desenhada enquanto o menu está aberto (some ao fechar ou ao executar)
      const [a, b] = sel.pts;
      const area = { x1: Math.min(a[0], b[0]), y1: Math.min(a[1], b[1]), x2: Math.max(a[0], b[0]), y2: Math.max(a[1], b[1]) };
      if (!abrirMenu(contextoVideo({ area }), e.clientX, e.clientY)) limparSelecao();
    } else menuNoPonto(d.cx, d.cy);
    return true;
  }
  const f = ferramenta();
  if (!f) return upNavegando(e);
  try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
  if (arr && arr.modo === 'pincel') { arr = null; terminarPincel(); return true; }
  if (arr && arr.modo === 'criar' && rt.rascunho) {
    const [x, y] = clienteParaTela(e.clientX, e.clientY);
    // arrastou: fecha agora. Só clicou: espera o segundo clique (modo clique-clique, bom no toque)
    if (Math.hypot(x - arr.x0, y - arr.y0) > 6 * vista.dpr) {
      if (ENCAIXAM.has(rt.rascunho.ferr)) rt.rascunho.pts[1] = encaixe(rt.rascunho.pts[1], rt.rascunho.ferr);
      concluir();
    }
  }
  arr = null;
  rt.arrastando = false;
  return true;
}

export function duploClique(e) {
  const f = ferramenta();
  if (!f) return false;
  if (f === 'poligono' || f === 'medirArea' || f === 'polilinha' || f === 'pontosChave' || f === 'sam') fecharPoligono();
  else if (f === 'selecionar') {
    const [x, y] = clienteParaTela(e.clientX, e.clientY);
    const hit = acharItem(x, y);
    if (hit && hit.tipo === 'texto') marcStore.set({ editando: hit.id });
  }
  return true;
}

export function saiu() {
  if (rt.hover) { rt.hover = null; rt.redesenhar(); }
  rt.cursor = null;
  desenharAuxilios();
  if (marcStore.get().ferramenta === 'contagotas') leituraStore.set({ leitura: (leituraStore.get().leitura || {}).fixa ? leituraStore.get().leitura : null });
}

// ------------------------------------------------------------- conta-gotas

let amostra = null;

/** Lê a cor da FONTE (não do canvas, que tem os desenhos por cima): pixel e média 11×11. */
function lerCor(e, fixar) {
  const el = vista.el;
  if (!el) return;
  const [u, v] = clienteParaFonte(e.clientX, e.clientY);
  const ue = vista.fs ? 1 - u : u;
  const X = Math.round(ue * vista.W), Y = Math.round(v * vista.H);
  if (!amostra) amostra = document.createElement('canvas');
  amostra.width = 11; amostra.height = 11;
  const g = amostra.getContext('2d', { willReadFrequently: true });
  let d;
  try {
    g.clearRect(0, 0, 11, 11);
    g.drawImage(el, X - 5, Y - 5, 11, 11, 0, 0, 11, 11);
    d = g.getImageData(0, 0, 11, 11).data;
  } catch (_) { return; }
  const c = (5 * 11 + 5) * 4;
  const rgb = [d[c], d[c + 1], d[c + 2]];
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  const media = n ? [Math.round(r / n), Math.round(gg / n), Math.round(b / n)] : rgb;
  const leitura = { cx: e.clientX, cy: e.clientY, x: X, y: Y, rgb, media, hsv: hsv(rgb), cinza: Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]), fixa: fixar };
  const atual = leituraStore.get().leitura;
  if (!fixar && atual && atual.fixa) return;   // leitura fixada fica até o próximo clique
  leituraStore.set({ leitura });
  if (fixar && navigator.clipboard) {
    navigator.clipboard.writeText(`rgb(${rgb.join(', ')}) hsv(${leitura.hsv.join(', ')}) cinza ${leitura.cinza}`).catch(() => {});
  }
}

export function soltarLeitura() { leituraStore.set({ leitura: null }); }

function hsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60); if (h < 0) h += 360;
  return [h, Math.round((mx ? d / mx : 0) * 100), Math.round(mx * 100)];
}

/** Posição em tela (px CSS, relativa à janela) de um ponto da fonte — para o editor de texto do widget. */
export function pontoNaJanela(u, v) {
  const c = vista.canvas;
  if (!c || !vista.ok) return null;
  fonteParaTela(u, v, t2);
  const r = c.getBoundingClientRect();
  return { x: r.left + t2[0] / vista.dpr, y: r.top + t2[1] / vista.dpr };
}

// ------------------------------------------------------------- menu de contexto

let dir = null;          // arrasto com o botão direito: { x0, y0, cx, cy, p0, t }
let dirFim = 0;          // quando o último gesto direito terminou (o evento contextmenu vem depois no Windows)
const longo = { t: 0, x: 0, y: 0 };
let canvasComMenu = null;

function limparSelecao() { if (rt.selecao) { rt.selecao = null; rt.redesenhar(); } }

function desenharSelecao(ctx, sel, dpr) {
  const n = telaDe({ pts: sel.pts });
  if (n < 2) return;
  const [x1, y1, x2, y2] = caixa(n);
  ctx.save();
  ctx.fillStyle = 'rgba(56,189,248,.12)';
  ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  ctx.setLineDash([5 * dpr, 4 * dpr]);
  ctx.lineWidth = 1.6 * dpr;
  ctx.strokeStyle = '#38bdf8';
  ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  ctx.restore();
}

/**
 * O menu do navegador só é trocado pelo nosso SOBRE o canvas do vídeo.
 * Instalado no primeiro quadro (o canvas é do Viewport; nada muda lá).
 */
function instalarMenu() {
  const c = vista.canvas;
  if (!c || c === canvasComMenu) return;
  canvasComMenu = c;
  c.addEventListener('contextmenu', (e) => {
    if (semFonte()) return;   // sem vídeo: quem responde é o menu da tela (layout/menu-tela.js)
    e.preventDefault();
    // o gesto direito (pointerdown/up) já tratou; aqui só o que vem sem ele (Ctrl+clique no Mac, tecla Menu)
    if (dir || performance.now() - dirFim < 600 || e.pointerType === 'touch' || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) return;
    menuNoPonto(e.clientX, e.clientY);
  });
}

/** Menu para o que está sob o ponto (px da janela): a marcação, ou o quadro inteiro. */
function menuNoPonto(cx, cy) {
  if (!vista.ok) return;
  const [x, y] = clienteParaTela(cx, cy);
  const hit = acharItem(x, y);
  if (hit) selecionar(hit.id);
  abrirMenu(contextoVideo({ item: hit, ponto: clienteParaFonte(cx, cy) }), cx, cy);
}

/** Shift+F10 / tecla Menu: menu da marcação selecionada (ou do quadro), na posição dela. */
export function abrirMenuTeclado() {
  if (!vista.ok || !vista.canvas || semFonte()) return false;
  const st = marcStore.get();
  const it = st.sel && st.itens.find((i) => i.id === st.sel);
  const r = vista.canvas.getBoundingClientRect();
  let x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (it) { const p = pontoNaJanela(it.pts[0][0], it.pts[0][1]); if (p) { x = p.x; y = p.y; } }
  return abrirMenu(contextoVideo({ item: it || null }), x, y);
}

const caixaDe = (pts) => {
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const [u, v] of pts) { x1 = Math.min(x1, u); y1 = Math.min(y1, v); x2 = Math.max(x2, u); y2 = Math.max(y2, v); }
  return { x1, y1, x2, y2 };
};

/** Cria várias marcações de uma vez (um passo só no desfazer). */
function criarVarias(novas) {
  if (!novas.length) return;
  confirmar((itens) => [...itens, ...novas.map((n) => ({ visivel: true, classes: '', ...n, id: novoId() }))]);
}

/** Contexto do menu no vídeo: área em 0–1 da FONTE e os adaptadores sobre as marcações. */
function contextoVideo({ area = null, item = null, ponto = null }) {
  const temArea = item && AREAS.has(item.tipo);
  const a = area || (item && item.pts.length > 1 ? caixaDe(item.pts) : null);
  const exemplo = (pts, tipo, cls) => {
    const d = dadosExemplo(cls);
    return { tipo, funcao: 'projeto_exemplo', pts, ...d };
  };
  const ctx = {
    origem: 'video', area: a, ponto,
    item: item ? { id: item.id, tipo: item.tipo, funcao: item.funcao, nome: item.nome, cls: item.funcao === 'projeto_exemplo' ? classePorNome(item.classe) : null } : null,
    recorte: async () => quadroCanvas(a),
    retanguloTela: () => {
      const r = vista.canvas.getBoundingClientRect();
      const aa = a || { x1: 0, y1: 0, x2: 1, y2: 1 };
      const p1 = fonteParaTela(aa.x1, aa.y1, [0, 0]).slice(), p2 = fonteParaTela(aa.x2, aa.y2, [0, 0]).slice();
      const X1 = Math.min(p1[0], p2[0]) / vista.dpr, X2 = Math.max(p1[0], p2[0]) / vista.dpr;
      const Y1 = Math.min(p1[1], p2[1]) / vista.dpr, Y2 = Math.max(p1[1], p2[1]) / vista.dpr;
      return { x: r.left + X1, y: r.top + Y1, w: X2 - X1, h: Y2 - Y1 };
    },
    rotular: a ? (cls) => { criarVarias([exemplo([[a.x1, a.y1], [a.x2, a.y2]], 'retangulo', cls)]); limparSelecao(); } : null,
    adicionarCaixas: (objs) => {
      criarVarias(objs.map((o) => ({ ...exemplo([[o.x1, o.y1], [o.x2, o.y2]], 'retangulo', o.cls), ...(o.sugerida ? { nome: `Sugestão · ${o.nome}` } : {}) })));
      limparSelecao();
    },
    salvarComoPrint: async ({ recorte = false, pasta = null } = {}) => {
      const pr = await salvarQuadroComoPrint({ area: recorte ? a : null, pasta });
      limparSelecao();
      return pr;
    },
    criar: (ferr, pts, extra) => { criar(ferr, pts, extra); limparSelecao(); },
    definirFuncao: (f) => {
      const extra = COR_FUNC[f] ? { cor: COR_FUNC[f] } : f === 'exclusao' ? { cor: '#f87171' } : f === 'roi' ? { cor: '#38bdf8' } : {};
      if (temArea) atualizar(item.id, { funcao: f, ...extra });
      else if (a) criar(f === 'roi' || f === 'exclusao' ? f : 'retangulo', [[a.x1, a.y1], [a.x2, a.y2]], { funcao: f, ...extra });
      limparSelecao();
    },
    usarComoRotulo: async (txt) => {
      const p = projetoAtivo();
      if (p && p.tipo === 'detector' && a) {
        let k = classePorNome(txt);
        if (k < 0) k = await adicionarClasse(txt);
        if (temArea) atualizar(item.id, { funcao: 'projeto_exemplo', ...dadosExemplo(k) });
        else criarVarias([exemplo([[a.x1, a.y1], [a.x2, a.y2]], 'retangulo', k)]);
      } else if (item) atualizar(item.id, { nome: txt.slice(0, 60) });
      else if (a) criar('texto', [[a.x1, a.y1]], { texto: txt.slice(0, 200) });
      limparSelecao();
    },
  };
  if (item) {
    ctx.apagar = () => apagar(item.id);
    ctx.duplicar = () => criarVarias([{ ...item, id: undefined, nome: item.nome + ' (cópia)', pts: item.pts.map(([u, v]) => [Math.min(1, u + 0.02), Math.min(1, v + 0.02)]) }]);
    if (temArea && item.tipo !== 'elipse') ctx.trocarClasse = (cls) => atualizar(item.id, { funcao: 'projeto_exemplo', ...dadosExemplo(cls) });
  }
  // região de um operador (cv/regioes.js): as ações dela (components/regioes-acoes.js), não as de marcação
  if (item && item.vinc) {
    ctx.regiao = item.id;
    ctx.definirFuncao = null; ctx.trocarClasse = null; ctx.duplicar = null; ctx.rotular = null; ctx.usarComoRotulo = null;
    ctx.apagar = podeApagar(item) ? () => apagar(item.id) : null;
  }
  return ctx;
}

// seleção desenhada some quando o menu fecha sem executar nada
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') limparSelecao(); });
  document.addEventListener('pointerdown', (e) => { if (rt.selecao && !dir && !(e.target.closest && e.target.closest('.mctx'))) limparSelecao(); }, true);
}

// ---- funções das marcações, só no vídeo ao vivo
const areaOuItemArea = (ctx) => ctx.origem === 'video' && ctx.definirFuncao && (ctx.item ? AREAS.has(ctx.item.tipo) : Boolean(ctx.area));
registrarAcao({ id: 'mk.roi', grupo: 'processamento', ordem: 10, rotulo: 'Usar como ROI de processamento', quando: areaOuItemArea, executar: (ctx) => ctx.definirFuncao('roi') });
registrarAcao({ id: 'mk.exclusao', grupo: 'processamento', ordem: 20, rotulo: 'Excluir área do processamento', quando: areaOuItemArea, executar: (ctx) => ctx.definirFuncao('exclusao') });
registrarAcao({ id: 'mk.zona', grupo: 'processamento', ordem: 30, rotulo: 'Zona de contagem', quando: areaOuItemArea, executar: (ctx) => ctx.definirFuncao('zona') });
registrarAcao({
  id: 'mk.medir', grupo: 'processamento', ordem: 40, rotulo: 'Medir (régua)',
  quando: (ctx) => ctx.origem === 'video' && ctx.area && ctx.criar,
  executar: (ctx) => { const a = ctx.area, y = (a.y1 + a.y2) / 2; ctx.criar('regua', [[a.x1, y], [a.x2, y]]); },
});
registrarAcao({
  id: 'mk.inspect', grupo: 'processamento', ordem: 50, rotulo: 'Adicionar ao programa Inspect',
  quando: (ctx) => areaOuItemArea(ctx),
  itens: () => funcoesDe('retangulo').filter(([v]) => v.startsWith('ins_')).map(([v, l]) => ({ id: v, rotulo: l.replace(/^Inspect · /, '') })),
  executar: (ctx, f) => ctx.definirFuncao(f),
});
registrarAcao({ id: 'mk.fechar', grupo: 'marcacao', ordem: 99, rotulo: 'Cancelar', quando: (ctx) => ctx.origem === 'video', executar: () => { fecharMenu(); limparSelecao(); } });

// ---- análise e ferramentas inteligentes no clique direito (ferramentas de mouse novas)
const itemDe = (ctx) => ctx.item && marcStore.get().itens.find((i) => i.id === ctx.item.id);
const ehVideo = (ctx) => ctx.origem === 'video';

/** Marcação de área do contexto, ou uma nova (retângulo "Só desenho") na área arrastada. */
function areaDoContexto(ctx, nomeBase) {
  const it = itemDe(ctx);
  if (it && AREAS.has(it.tipo)) return it.id;
  const a = ctx.area;
  if (!a) return null;
  const id = criar('histograma', [[a.x1, a.y1], [a.x2, a.y2]], { nomeBase });
  limparSelecao();
  return id;
}

registrarAcao({
  id: 'an.histograma', grupo: 'processamento', ordem: 60, rotulo: 'Histograma desta área',
  quando: (ctx) => ehVideo(ctx) && (ctx.area || (ctx.item && AREAS.has(ctx.item.tipo))),
  executar: (ctx) => { const id = areaDoContexto(ctx, 'Histograma'); if (id) marcStore.set({ analise: id }); },
});
registrarAcao({
  id: 'an.perfil', grupo: 'processamento', ordem: 62, rotulo: 'Perfil de intensidade',
  quando: (ctx) => ehVideo(ctx) && ((ctx.item && LINHAS.has(ctx.item.tipo)) || (!ctx.item && ctx.area)),
  executar: (ctx) => {
    const it = itemDe(ctx);
    if (it) { marcStore.set({ analise: it.id }); return; }
    const a = ctx.area, y = (a.y1 + a.y2) / 2;
    const id = criar('perfil', [[a.x1, y], [a.x2, y]]);
    limparSelecao();
    marcStore.set({ analise: id });
  },
});
registrarAcao({
  id: 'an.area', grupo: 'processamento', ordem: 64, rotulo: 'Área e perímetro',
  quando: (ctx) => ehVideo(ctx) && ctx.item && AREAS.has(ctx.item.tipo),
  executar: (ctx) => {
    const it = itemDe(ctx);
    if (!it) return;
    const c = centroide(it), cx = caixaItem(it);
    const linhas = [
      `Área: ${fmtArea(areaPx(it))}${mmPorPx() ? ` (${Math.round(areaPx(it))} px²)` : ''}`,
      `Perímetro: ${fmtComprimento(perimetroPx(it))}`,
      `Centroide: ${Math.round(c[0] * vista.W)}, ${Math.round(c[1] * vista.H)} px`,
      `Caixa: ${fmtComprimento((cx.x2 - cx.x1) * vista.W)} × ${fmtComprimento((cx.y2 - cx.y1) * vista.H)}`,
    ];
    const a = areaPx(it), per = perimetroPx(it);
    if (per > 0) linhas.push(`Circularidade 4πA/P²: ${((4 * Math.PI * a) / (per * per)).toFixed(3)}`);
    mostrarBalao(ctx, { titulo: it.nome, linhas, acoes: [
      { rotulo: 'Copiar', fazer: () => navigator.clipboard && navigator.clipboard.writeText(linhas.join('\n')) },
      ...(it.funcao !== 'medida' ? [{ rotulo: 'Mostrar na imagem', destaque: true, fazer: () => atualizar(it.id, { funcao: 'medida' }) }] : []),
    ] });
  },
});
registrarAcao({
  id: 'an.varinha', grupo: 'processamento', ordem: 66, rotulo: 'Varinha mágica aqui',
  quando: (ctx) => ehVideo(ctx) && ctx.ponto && !ctx.item,
  executar: (ctx) => {
    const o = marcStore.get().opc;
    const r = varinha(ctx.ponto, { tolerancia: o.tolerancia, contiguo: true });
    if (!r) throw new Error('não deu para ler os pixels desta fonte');
    criar('varinha', r.pts, { nomeBase: 'Varinha', ...comoExemplo() });
  },
});
registrarAcao({
  id: 'an.sam', grupo: 'processamento', ordem: 68, rotulo: (ctx) => (ctx.area && !ctx.item ? 'Segmentar o objeto da área (SAM)' : 'Segmentar o objeto aqui (SAM)'),
  quando: (ctx) => ehVideo(ctx) && ((ctx.ponto && !ctx.item) || (ctx.area && !ctx.item)),
  async executar(ctx) {
    const h = mostrarBalao(ctx, { titulo: 'Segmentar (MobileSAM)', carregando: 'carregando o modelo e segmentando…' });
    const pontos = ctx.ponto && !ctx.area ? [{ u: ctx.ponto[0], v: ctx.ponto[1], pos: true }] : [];
    const r = await segmentarSam(pontos, ++samSessao, ctx.area && !ctx.ponto ? ctx.area : (ctx.area || null));
    limparSelecao();
    if (!r || !r.pts) { h.atualizar({ titulo: 'Segmentar (MobileSAM)', linhas: ['nenhum objeto encontrado aqui'] }); return; }
    criar('sam', r.pts, { nomeBase: 'SAM', ...comoExemplo() });
    h.atualizar({ titulo: 'Segmentar (MobileSAM)', linhas: [`polígono com ${r.pts.length} vértices · IoU previsto ${Math.round(r.iou * 100)}%`] });
  },
});
