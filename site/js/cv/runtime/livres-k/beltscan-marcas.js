/**
 * cv/runtime/livres-k/beltscan-marcas.js — editar o BeltScan NA IMAGEM DO APP.
 *
 * A faixa de busca da linha laser, as zonas de exclusão (colunas) e a faixa
 * do fluxo óptico da bancada viram MARCAÇÕES das ferramentas de mouse
 * (cv/marcacoes.js), com funções próprias:
 *
 *   bs_busca       retângulo  → extraction.roi [x0, y0, x1, y1]
 *   bs_exclusao    retângulo/polígono → extraction.exclude [[a, b)…] (só a
 *                  extensão horizontal conta: a exclusão é por coluna)
 *   bs_velocidade  retângulo  → bench.flow_near_px / flow_far_px (as bordas de
 *                  cima e de baixo, medidas a partir da linha de referência;
 *                  a largura segue os 70 % centrais da faixa de busca)
 *
 * SINCRONIA NOS DOIS SENTIDOS, feita pelo operador a cada quadro (ele tem o
 * tamanho do quadro e o espelho; ver operators/livres-k/beltscan.js) e, com
 * o vídeo PAUSADO (o laço do app não roda o pipeline), por uma assinatura das
 * marcações aqui mesmo — que também reprocessa o último quadro, para a linha
 * e os números mudarem na hora:
 *   - a configuração mudou por fora (tela cheia, campos de Configurar, troca
 *     de perfil, importar JSON) → as marcações são reescritas a partir dela;
 *   - as marcações mudaram (e nenhuma alça está sendo arrastada) → a
 *     configuração recebe os valores delas. Arrastando, nada muda: aplica ao
 *     soltar. Uma marcação do BeltScan vale sobre o campo — os campos da aba
 *     Extração mostram "definido na imagem".
 * A configuração continua sendo o JSON "beltscan/4" de sempre (os campos
 * normais do esquema): salvar no perfil, exportar e importar não mudam.
 *
 * Coordenadas: as do motor são px do quadro analisado, nas colunas da câmera
 * (desespelhadas); as marcações guardam a fonte normalizada. A conversão
 * passa pela vista do quadro (fonteParaVista/vistaParaFonte), então zoom e
 * espelho funcionam como nas outras marcações.
 */
import {
  marcStore, rt, vista, confirmar, editarSemHistorico, vistaParaFonte, fonteParaVista, setFerramenta, setVisivel, novoId, COR_FUNC, AREAS,
} from '../../marcacoes.js';
import { obterMotor, ultimoQuadro, publicar, tempoDaFonte, salvarSeMudou, assinar } from './canal.js';

export const FUNCOES = ['bs_busca', 'bs_exclusao', 'bs_velocidade'];
const EH_BS = new Set(FUNCOES);
const NOME = { bs_busca: 'Faixa de busca', bs_exclusao: 'Exclusão BS', bs_velocidade: 'Velocidade' };

const S = { alt: -1, mq: undefined, pendente: false };
let pedido = false;
let ult = null;            // { W, H, esp } da última passada do operador

/** "Editar na imagem": cria/seleciona as marcações (já, ou na próxima passada do operador). */
export function pedirEdicao() {
  const motor = obterMotor();
  if (ult && vista.ok && escrever(motor, ult.W, ult.H, ult.esp, true)) { S.alt = motor.alteracoes; S.mq = undefined; S.pendente = false; return; }
  pedido = true; rt.redesenhar();
}
/** Concluir a edição (botão ✓): solta a seleção e volta à ferramenta Mover. */
export function concluirEdicao() { marcStore.set({ sel: null }); setFerramenta('mover'); }
/** Está editando (uma marcação do BeltScan selecionada com Selecionar/editar)? */
export function editando(st = marcStore.get()) {
  return st.ferramenta === 'selecionar' && Boolean(st.sel) && st.itens.some((i) => i.id === st.sel && EH_BS.has(i.funcao));
}
/** O que está definido por marcação (para os campos de Configurar). */
export function porImagem() {
  const it = marcStore.get().itens;
  return {
    busca: it.some((i) => i.funcao === 'bs_busca'),
    exclusao: it.some((i) => i.funcao === 'bs_exclusao'),
    velocidade: it.some((i) => i.funcao === 'bs_velocidade'),
  };
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/*
 * O que cada marcação do BeltScan era na última sincronia (id → função +
 * pontos da fonte). Só a marcação que MUDOU vai para a configuração: mexer na
 * faixa de busca não pode puxar a faixa de velocidade (que depende da linha
 * de referência dentro da faixa) para outro lugar.
 */
const vistos = new Map();
const chave = (it) => it.funcao + JSON.stringify(it.fonte || it.pts);
function lembrar(itens) {
  vistos.clear();
  for (const it of itens) if (EH_BS.has(it.funcao)) vistos.set(it.id, chave(it));
}

/** Retângulo em px do motor (colunas da câmera) → dois cantos na fonte normalizada. */
function retFonte(x0, y0, x1, y1, W, H, esp) {
  const f = (u, v) => vistaParaFonte(esp ? 1 - u / W : u / W, v / H).map((q) => +q.toFixed(5));
  return [f(x0, y0), f(x1, y1)];
}
const cantos = ([a, b]) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];

/** Reescreve as marcações a partir da configuração. `criar` = também cria as que faltam (Editar na imagem). */
function escrever(motor, W, H, esp, criar) {
  if (!vista.ok) return false;
  const C = motor.C, [x0, y0, x1, y1] = motor.roi;
  const st = marcStore.get();
  const alvo = {
    bs_busca: [retFonte(x0, y0, x1, y1, W, H, esp)],
    bs_exclusao: C.extraction.exclude.map(([a, b]) => retFonte(a, y0, b, y1, W, H, esp)),
    bs_velocidade: [],
  };
  const fv = motor.faixaVelocidade();
  if (fv) alvo.bs_velocidade.push(retFonte(fv[0], fv[1], fv[2], fv[3], W, H, esp));

  const novos = [];
  const usados = { bs_busca: 0, bs_exclusao: 0, bs_velocidade: 0 };
  let sel = null;
  for (const it of st.itens) {
    if (!EH_BS.has(it.funcao)) { novos.push(it); continue; }
    const lista = alvo[it.funcao], i = usados[it.funcao]++;
    if (i >= lista.length) continue;                 // a configuração tem menos (exclusão removida)
    const pts = it.tipo === 'poligono' ? cantos(lista[i]) : lista[i];
    novos.push(igual(pts, it.pts) ? it : { ...it, pts });
    if (it.funcao === 'bs_busca' && !sel) sel = it.id;
  }
  for (const f of FUNCOES) {
    const lista = alvo[f];
    // as exclusões sempre espelham a configuração; busca e velocidade nascem no "Editar na imagem"
    const cria = f === 'bs_exclusao' ? criar || usados.bs_busca > 0 || usados.bs_velocidade > 0 || usados.bs_exclusao > 0 : criar;
    for (let i = usados[f]; cria && i < lista.length; i++) {
      const id = novoId();
      novos.push({ id, tipo: 'retangulo', funcao: f, pts: lista[i], nome: lista.length > 1 ? `${NOME[f]} ${i + 1}` : NOME[f],
                   cor: COR_FUNC[f], visivel: true, classes: '' });
      if (f === 'bs_busca') sel = id;
    }
  }
  const mudou = novos.length !== st.itens.length || novos.some((it, i) => it !== st.itens[i]);
  lembrar(novos);
  if (criar) {
    confirmar(() => (mudou ? novos : st.itens), { sel: sel || st.sel });
    if (!st.visivel) setVisivel(true);
    setFerramenta('selecionar');
  } else if (mudou) editarSemHistorico(() => novos);
  return true;
}

/** Caixa de uma marcação no espaço do quadro (0–1), como ctx.marcacoes a entrega. */
const tq = [0, 0];
function caixaQuadro(it) {
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const [u, v] of it.pts) { fonteParaVista(u, v, tq); x1 = Math.min(x1, tq[0]); y1 = Math.min(y1, tq[1]); x2 = Math.max(x2, tq[0]); y2 = Math.max(y2, tq[1]); }
  return { x1, y1, x2, y2 };
}

/**
 * Leva as marcações para a configuração. `mq` = ctx.marcacoes (no espaço do
 * quadro, com caixa); sem ele, as da loja convertidas aqui (vídeo pausado).
 */
function ler(motor, mq, W, H, esp) {
  if (!mq) mq = { itens: marcStore.get().itens.filter((i) => EH_BS.has(i.funcao) && AREAS.has(i.tipo)).map((i) => ({ ...i, caixa: caixaQuadro(i) })) };
  if (!mq.itens) return;
  const C = motor.C;
  const col = (x) => Math.round(Math.max(0, Math.min(W, (esp ? 1 - x : x) * W)));
  const lin = (y) => Math.round(Math.max(0, Math.min(H, y * H)));
  const faixa = (c) => { const a = col(c.x1), b = col(c.x2); return [Math.min(a, b), Math.max(a, b)]; };
  const its = mq.itens.filter((i) => EH_BS.has(i.funcao) && AREAS.has(i.tipo) && i.caixa);
  const mudou = (i) => vistos.get(i.id) !== chave(i);
  const exAgora = its.filter((i) => i.funcao === 'bs_exclusao');
  const exAntes = [...vistos.entries()].filter(([, k]) => k.startsWith('bs_exclusao')).map(([id]) => id);
  const exMudou = exAgora.length !== exAntes.length || exAgora.some(mudou);
  const busca = its.find((i) => i.funcao === 'bs_busca' && mudou(i));
  const vel = its.find((i) => i.funcao === 'bs_velocidade' && mudou(i));
  lembrar(its);
  if (busca) {
    const [a, b] = faixa(busca.caixa);
    const roi = [a, lin(busca.caixa.y1), b, lin(busca.caixa.y2)];
    if (roi[2] - roi[0] >= 20 && roi[3] - roi[1] >= 10 && !igual(roi, C.extraction.roi.map((v) => Math.round(v)))) motor.definirROI(roi);
  }
  if (exMudou) {
    // apagar a última marcação de exclusão (com o modo "na imagem" em uso) também apaga a zona
    const ex = exAgora.map((i) => faixa(i.caixa)).filter(([a, b]) => b - a >= 2).sort((p, q) => p[0] - q[0]);
    if (!igual(ex, C.extraction.exclude)) motor.definirExclusoes(ex);
  }
  if (vel) motor.definirFaixaVelocidade(vel.caixa.y1 * H, vel.caixa.y2 * H);
}

/**
 * Chamado pelo operador a cada quadro, depois de processar. `W×H` = quadro
 * analisado; `esp` = o quadro chegou espelhado (ctx.mirrored).
 */
export function sincronizar(motor, ctx, W, H, esp) {
  ult = { W, H, esp };
  if (pedido && vista.ok && W) {
    pedido = false;
    escrever(motor, W, H, esp, true);
    S.alt = motor.alteracoes; S.mq = undefined; S.pendente = false;
    return;
  }
  const temBs = marcStore.get().itens.some((i) => EH_BS.has(i.funcao));
  if (!temBs) { S.alt = motor.alteracoes; S.mq = ctx.marcacoes; return; }
  if (rt.arrastando) { S.pendente = true; return; }
  if (motor.alteracoes !== S.alt) {
    // a configuração mudou por fora das marcações: elas seguem a configuração
    if (escrever(motor, W, H, esp, false)) { S.alt = motor.alteracoes; S.mq = undefined; S.pendente = false; }
    return;
  }
  const mq = ctx.marcacoes;
  if (mq !== S.mq || S.pendente) {
    S.mq = mq; S.pendente = false;
    ler(motor, mq, W, H, esp);
    S.alt = motor.alteracoes;
  }
}

// ------------------------------------------------------------------ vídeo pausado

/** Reprocessa o último quadro analisado (vídeo pausado ou imagem): a linha e os números seguem a nova faixa. */
function reprocessar(motor) {
  const img = ultimoQuadro();
  const fv = tempoDaFonte();
  if (!img || !ult || !(fv.pausado || fv.imagem)) return;
  try {
    const r = motor.processar(img, fv.imagem ? 0 : fv.t, { espelhado: ult.esp, video: fv.video });
    publicar(r, img);
    rt.redesenhar();
  } catch (_) { /* o próximo quadro do operador tenta de novo */ }
}

let agendado = 0;
function aplicarJa() {
  agendado = 0;
  if (!ult || !vista.ok) return;
  if (rt.arrastando) { agendado = setTimeout(aplicarJa, 150); return; }   // aplica ao soltar
  const motor = obterMotor();
  if (!marcStore.get().itens.some((i) => EH_BS.has(i.funcao))) return;
  const antes = motor.alteracoes;
  ler(motor, null, ult.W, ult.H, ult.esp);
  S.alt = motor.alteracoes; S.mq = undefined;
  if (motor.alteracoes !== antes) { salvarSeMudou(); reprocessar(motor); }
}
// as marcações mudaram (desenho, alça solta, seletor de função, desfazer…): aplica sem esperar o pipeline
let itensAnt = marcStore.get().itens;
marcStore.subscribe((st) => {
  if (st.itens === itensAnt) return;
  itensAnt = st.itens;
  if (!agendado) agendado = setTimeout(aplicarJa, 0);
});
// a configuração mudou pelas telas (Configurar, tela cheia, perfil) com o vídeo pausado: as marcações acompanham
assinar(() => {
  const motor = obterMotor();
  if (!ult || rt.arrastando || motor.alteracoes === S.alt) return;
  if (!marcStore.get().itens.some((i) => EH_BS.has(i.funcao))) return;
  if (escrever(motor, ult.W, ult.H, ult.esp, false)) { S.alt = motor.alteracoes; S.mq = undefined; }
});
