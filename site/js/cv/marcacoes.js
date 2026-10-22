/**
 * cv/marcacoes.js — MARCAÇÕES SOBRE O VÍDEO: o modelo das ferramentas de mouse.
 *
 * Uma marcação é uma forma desenhada pelo usuário (área, polígono, elipse,
 * linha, régua, ângulo, ponto, texto) com uma FUNÇÃO que controla o
 * processamento — não é só desenho:
 *
 *   roi         o pipeline processa só dentro dela (o executor pinta o resto de preto)
 *   exclusao    o pipeline ignora o que está dentro (idem, ao contrário)
 *   zona        o operador "Zonas e linhas" (CV-37) conta quem está dentro
 *   cruzamento  o mesmo operador conta quem cruza a linha, em cada sentido
 *   medida      régua e ângulo medidos ao vivo (com calibração, em mm/cm)
 *   anotacao    ponto e texto
 *   nenhuma     só desenho
 *   bs_busca, bs_exclusao, bs_velocidade
 *               BeltScan (CV-36): faixa de busca da linha laser, colunas
 *               excluídas e faixa do fluxo óptico da bancada. NÃO mascaram a
 *               imagem: o operador lê e as leva para a configuração do
 *               BeltScan (runtime/livres-k/beltscan-marcas.js). Só aparecem
 *               no seletor com um nó BeltScan no Pipeline.
 *   ins_presenca, ins_blobs, ins_cor, ins_forma, ins_defeito, ins_ocr, ins_codigo,
 *   ins_serial, ins_detect, ins_classif, ins_anomalia, ins_gatilho (áreas),
 *   ins_paquimetro (linha/régua)
 *               Inspeção visual (CV-40): a ROI de cada ferramenta do programa e a
 *               do gatilho. Não mascaram: o motor do Inspect lê
 *               (runtime/livres-n/canal.js). Só aparecem com um nó inspect.* no
 *               Pipeline (ou se a marcação já tem uma).
 *   takt_posto  Takt (CV-39): o posto de trabalho medido pelo operador
 *               takt.posto (ROI das mãos e zona de presença). Não mascara a
 *               imagem. Só aparece no seletor com um nó takt.posto no Pipeline.
 *   projeto_exemplo
 *               +Projeto (projeto/base.js): a caixa/polígono é um EXEMPLO de uma
 *               classe do projeto ativo (campo `classe`, o nome; cor da classe).
 *               Não mascara. "Salvar estes exemplos" (projeto/exemplos.js) leva o
 *               quadro e as caixas como print rotulado. Só aparece com um projeto
 *               ativo (ou se a marcação já é um exemplo).
 *
 * COORDENADAS. Os pontos ficam em coordenadas NORMALIZADAS (0–1) da FONTE
 * INTEIRA, sem espelho e sem zoom. Assim a marcação fica presa ao mesmo ponto
 * da imagem ao dar zoom, arrastar o enquadramento ou ligar o "Espelhar": a
 * conversão para a tela (e para o quadro que o pipeline recebe, que já é o
 * recorte do zoom, espelhado) é feita a cada quadro a partir de `vista`, que o
 * Viewport preenche no laço de render.
 *
 * Os operadores recebem `ctx.marcacoes` (ver `paraQuadro`): as mesmas formas
 * já no espaço do quadro do pipeline (0–1 e px), mais a escala px→mm.
 */

import { createStore, store } from '../state/store.js';
import { clone } from './core.js';
import { ativo as projetoAtivo, ouvirClasses } from '../projeto/base.js';

// ------------------------------------------------------------- catálogo

/**
 * Ferramentas do widget (modos do mouse). `grupo` separa visualmente na barra;
 * `cat` é a categoria do popover "⋯ Mais ferramentas" (components/ferramentas-mais.js)
 * e `desc` a descrição curta dele. Quais aparecem na barra vertical é escolha do
 * usuário (fixar na barra); as outras ficam só no popover.
 */
export const FERRAMENTAS = [
  { id: 'mover',      nome: 'Mover / navegar (zoom e arrastar)', tecla: 'V',  grupo: 0, cat: 'organizar', desc: 'Zoom, arrastar o enquadramento; o vídeo responde como sempre' },
  { id: 'selecionar', nome: 'Selecionar e editar',               tecla: '⇧V', grupo: 0, cat: 'organizar', desc: 'Clique seleciona, ⇧+clique soma à seleção, arraste move, alças editam' },
  { id: 'retangulo',  nome: 'Área retangular (zona)',            tecla: 'R',  grupo: 1, cat: 'desenhar', desc: 'Caixa: zona de contagem, ROI, exemplo…' },
  { id: 'poligono',   nome: 'Polígono (clique por ponto; duplo clique ou Enter fecha)', tecla: '⇧P', grupo: 1, cat: 'desenhar', desc: 'Área de forma livre, ponto a ponto' },
  { id: 'elipse',     nome: 'Círculo / elipse',                  tecla: '⇧O', grupo: 1, cat: 'desenhar', desc: 'Arraste a caixa da elipse' },
  { id: 'exemplo',    nome: '+Projeto · exemplo (caixa com a classe ativa)', tecla: 'J', grupo: 1, cat: 'desenhar', desc: 'Caixa rotulada com a classe ativa do +Projeto' },
  { id: 'roi',        nome: 'ROI — processar só aqui',           tecla: '⇧R', grupo: 1, cat: 'desenhar', desc: 'O pipeline processa só dentro desta área' },
  { id: 'exclusao',   nome: 'Área de exclusão (ignorar)',        tecla: '⇧E', grupo: 1, cat: 'desenhar', desc: 'O pipeline ignora o que está dentro' },
  { id: 'linha',      nome: 'Linha de contagem (A→B)',           tecla: '⇧L', grupo: 2, cat: 'desenhar', desc: 'Conta quem cruza, nos dois sentidos' },
  { id: 'regua',      nome: 'Régua',                             tecla: '⇧M', grupo: 2, cat: 'medir', desc: 'Comprimento em px; calibrada, em mm/cm' },
  { id: 'angulo',     nome: 'Ângulo (3 pontos)',                 tecla: '⇧A', grupo: 2, cat: 'medir', desc: 'Três cliques; o do meio é o vértice' },
  { id: 'ponto',      nome: 'Ponto / marcador',                  tecla: 'N',  grupo: 3, cat: 'desenhar', desc: 'Um marcador com nome' },
  { id: 'texto',      nome: 'Texto / anotação',                  tecla: '⇧T', grupo: 3, cat: 'desenhar', desc: 'Anotação escrita sobre a imagem' },
  { id: 'contagotas', nome: 'Conta-gotas (cor do pixel)',        tecla: 'I',  grupo: 3, cat: 'medir', desc: 'RGB, HSV e cinza do pixel e da média 11×11' },
  { id: 'borracha',   nome: 'Borracha (clique ou arraste)',      tecla: '⇧X', grupo: 4, cat: 'desenhar', desc: 'Apaga marcações inteiras (as travadas ficam)' },
  // ---- novas (out/2026): pesquisa em CVAT, Label Studio, Roboflow, Fiji/ImageJ, Kinovea, Photoshop e Figma
  { id: 'polilinha',  nome: 'Polilinha (aberta)',                tecla: '⇧U', grupo: 5, cat: 'desenhar', desc: 'Linha de vários segmentos; mede o comprimento total' },
  { id: 'seta',       nome: 'Seta (anotação)',                   tecla: '⇧W', grupo: 5, cat: 'desenhar', desc: 'Aponta algo na imagem' },
  { id: 'circulo3',   nome: 'Círculo por 3 pontos',              tecla: '⇧C', grupo: 5, cat: 'desenhar', desc: 'Três pontos da borda definem o círculo (diâmetro, área)' },
  { id: 'pincel',     nome: 'Pincel de máscara',                 tecla: '⇧D', grupo: 5, cat: 'desenhar', desc: 'Pinta pixels: máscara binária, vira ROI/exclusão, exporta PNG' },
  { id: 'borrachaMascara', nome: 'Borracha de máscara',          tecla: '⇧Y', grupo: 5, cat: 'desenhar', desc: 'Apaga pixels da máscara selecionada (ou da que está sob o cursor)' },
  { id: 'pontosChave', nome: 'Pontos-chave (esqueleto COCO-17)', tecla: '⇧Q', grupo: 5, cat: 'desenhar', desc: 'Rotular pose: clique nariz, olhos… na ordem; Enter conclui' },
  { id: 'varinha',    nome: 'Varinha mágica (região por cor)',   tecla: 'W',  grupo: 6, cat: 'inteligentes', desc: 'Clique: a região de cor parecida vira polígono (tolerância, contíguo)' },
  { id: 'sam',        nome: 'Segmentar com um clique (SAM)',     tecla: '⇧S', grupo: 6, cat: 'inteligentes', desc: 'MobileSAM: clique no objeto (⇧+clique tira); Enter vira polígono' },
  { id: 'medirArea',  nome: 'Área e perímetro (polígono)',       tecla: '⇧G', grupo: 7, cat: 'medir', desc: 'Polígono que mostra área e perímetro (px² ou mm² calibrado)' },
  { id: 'perfil',     nome: 'Perfil de intensidade',             tecla: '⇧F', grupo: 7, cat: 'medir', desc: 'Gráfico RGB/cinza ao longo de uma linha (Fiji: Plot Profile)' },
  { id: 'histograma', nome: 'Histograma da região',              tecla: '⇧I', grupo: 7, cat: 'medir', desc: 'Arraste uma área: histograma RGB/HSV, média e desvio' },
  { id: 'distancia',  nome: 'Distância entre objetos',           tecla: '⇧J', grupo: 7, cat: 'medir', desc: 'Clique em dois objetos: distância entre os centroides, ao vivo' },
  { id: 'contador',   nome: 'Contador por clique',               tecla: 'K',  grupo: 7, cat: 'medir', desc: 'Cada clique conta 1 na classe ativa (1–9 troca); ⇧+clique tira' },
  { id: 'cronometro', nome: 'Cronômetro',                        tecla: 'H',  grupo: 7, cat: 'medir', desc: 'Clique inicia no instante atual do vídeo; clique nele para parar' },
  { id: 'trajetoria', nome: 'Trajetória de um ponto',            tecla: 'Y',  grupo: 7, cat: 'medir', desc: 'Clique num ponto: segue por correlação e desenha o rastro com velocidade' },
  { id: 'perspectiva', nome: 'Grade de perspectiva (4 pontos)',  tecla: '',   grupo: 8, cat: 'exibicao', desc: 'Quatro cantos de um plano: grade em perspectiva' },
];

/**
 * Atalhos: letra minúscula = sem Shift. Só letras que o workspace NÃO usa
 * (v, r, n, i, j, w, k, h, y); as demais vão com Shift — p, o, l, m, a, t, e, x já são
 * painéis/ações. u e z (grade e lupa) e ⇧Z, ⇧N (mira, encaixe) são alternâncias
 * do widget (FerramentasMouse.js).
 */
export const TECLAS = {
  v: 'mover', V: 'selecionar', r: 'retangulo', R: 'roi', P: 'poligono', O: 'elipse',
  E: 'exclusao', L: 'linha', M: 'regua', A: 'angulo', n: 'ponto', T: 'texto',
  i: 'contagotas', X: 'borracha', j: 'exemplo',
  U: 'polilinha', W: 'seta', C: 'circulo3', D: 'pincel', Y: 'borrachaMascara', Q: 'pontosChave',
  w: 'varinha', S: 'sam', G: 'medirArea', F: 'perfil', I: 'histograma', J: 'distancia',
  k: 'contador', h: 'cronometro', y: 'trajetoria',
};

/** Ferramenta → tipo da forma e função com que ela nasce. */
export const CRIA = {
  retangulo: ['retangulo', 'zona'],
  exemplo:   ['retangulo', 'projeto_exemplo'],
  roi:       ['retangulo', 'roi'],
  exclusao:  ['retangulo', 'exclusao'],
  poligono:  ['poligono', 'zona'],
  elipse:    ['elipse', 'zona'],
  linha:     ['linha', 'cruzamento'],
  regua:     ['regua', 'medida'],
  angulo:    ['angulo', 'medida'],
  ponto:     ['ponto', 'anotacao'],
  texto:     ['texto', 'anotacao'],
  polilinha: ['polilinha', 'medida'],
  seta:      ['seta', 'anotacao'],
  circulo3:  ['elipse', 'medida'],
  pincel:    ['mascara', 'nenhuma'],
  pontosChave: ['esqueleto', 'anotacao'],
  varinha:   ['poligono', 'nenhuma'],
  sam:       ['poligono', 'nenhuma'],
  medirArea: ['poligono', 'medida'],
  perfil:    ['perfil', 'medida'],
  histograma: ['retangulo', 'nenhuma'],
  distancia: ['distancia', 'medida'],
  contador:  ['contador', 'anotacao'],
  cronometro: ['cronometro', 'anotacao'],
  trajetoria: ['trajetoria', 'medida'],
  perspectiva: ['perspectiva', 'anotacao'],
};

/** Esqueleto COCO-17 (pontos-chave): nomes na ordem de clique e as ligações. */
export const ESQUELETO = {
  nomes: ['nariz', 'olho esq.', 'olho dir.', 'orelha esq.', 'orelha dir.', 'ombro esq.', 'ombro dir.',
    'cotovelo esq.', 'cotovelo dir.', 'punho esq.', 'punho dir.', 'quadril esq.', 'quadril dir.',
    'joelho esq.', 'joelho dir.', 'tornozelo esq.', 'tornozelo dir.'],
  ligacoes: [[0, 1], [0, 2], [1, 3], [2, 4], [5, 6], [5, 7], [7, 9], [6, 8], [8, 10], [5, 11], [6, 12],
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]],
};

export const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
/** Formas de linha aberta (comprimento). */
export const LINHAS = new Set(['linha', 'regua', 'polilinha', 'perfil', 'seta', 'distancia', 'trajetoria']);

/** Funções do BeltScan por tipo de forma (valor, rótulo). */
const FUNCOES_BS = {
  retangulo: [['bs_busca', 'BeltScan · faixa de busca'], ['bs_exclusao', 'BeltScan · exclusão'], ['bs_velocidade', 'BeltScan · faixa de velocidade']],
  poligono: [['bs_exclusao', 'BeltScan · exclusão']],
};
/** Cor própria de cada função do BeltScan (azul da faixa, vermelho da exclusão, verde da velocidade). */
export const COR_FUNC = { bs_busca: '#7FB2FF', bs_exclusao: '#f87171', bs_velocidade: '#4ade80', takt_posto: '#2dd4bf' };
// Inspect (CV-40): ferramentas em ciano, gatilho em violeta
Object.assign(COR_FUNC, { ins_presenca: '#2dd4bf', ins_blobs: '#2dd4bf', ins_cor: '#2dd4bf', ins_forma: '#2dd4bf',
  ins_defeito: '#2dd4bf', ins_paquimetro: '#2dd4bf', ins_gatilho: '#a78bfa',
  ins_ocr: '#2dd4bf', ins_codigo: '#2dd4bf', ins_serial: '#2dd4bf', ins_detect: '#2dd4bf', ins_classif: '#2dd4bf', ins_anomalia: '#2dd4bf' });
/** Função do Takt (CV-39) para áreas: o posto de trabalho. */
const FUNCOES_TAKT = [['takt_posto', 'Takt · posto']];

/**
 * Funções possíveis por tipo de forma (valor, rótulo). As do BeltScan entram
 * com um nó beltscan.volumetria no Pipeline, ou quando a marcação já tem uma
 * (`atual`) — uma marcação salva não perde a função se o nó sair.
 */
/** Funções do Inspect (CV-40) por forma: ROI das ferramentas e do gatilho. */
const FUNCOES_INS = {
  area: [['ins_presenca', 'Inspect · presença'], ['ins_blobs', 'Inspect · contagem'], ['ins_cor', 'Inspect · cor'],
         ['ins_forma', 'Inspect · forma'], ['ins_defeito', 'Inspect · área de defeito'], ['ins_ocr', 'Inspect · OCR (lote/validade)'],
         ['ins_codigo', 'Inspect · código'], ['ins_serial', 'Inspect · número de série'], ['ins_detect', 'Inspect · detector'],
         ['ins_classif', 'Inspect · classificação'], ['ins_anomalia', 'Inspect · anomalia'], ['ins_gatilho', 'Inspect · gatilho']],
  linha: [['ins_paquimetro', 'Inspect · paquímetro']],
};

/**
 * Funções registradas por módulos (operators/livres-oa.js e outros): cada uma
 * vale para os `tipos` de forma e só aparece no seletor com um nó cujo op
 * começa por um dos `ops` no Pipeline — ou quando a marcação já tem essa
 * função (uma marcação salva não perde a função se o nó sair).
 *   { valor, rotulo, tipos: ['retangulo', …], ops: ['seguranca.cerca'], cor, nome }
 */
export const FUNCOES_EXTRA = [];
export function registrarFuncao(f) {
  if (!f || !f.valor || FUNCOES_EXTRA.some((x) => x.valor === f.valor)) return;
  FUNCOES_EXTRA.push(f);
  if (f.cor) COR_FUNC[f.valor] = f.cor;
  if (f.nome) NOME_FUNC[f.valor] = f.nome;
}

function funcoesExtra(tipo, atual) {
  if (!FUNCOES_EXTRA.length) return [];
  const nos = store.get().nodes || [];
  return FUNCOES_EXTRA.filter((f) => f.tipos.includes(tipo)
    && (atual === f.valor || nos.some((n) => f.ops.some((o) => String(n.op).startsWith(o)))))
    .map((f) => [f.valor, f.rotulo]);
}

export function funcoesDe(tipo, atual = null) {
  const base = [...funcoesBase(tipo, atual), ...funcoesExtra(tipo, atual)];
  const ins = AREAS.has(tipo) ? FUNCOES_INS.area : tipo === 'linha' || tipo === 'regua' ? FUNCOES_INS.linha : null;
  if (!ins) return base;
  const comNo = (store.get().nodes || []).some((n) => String(n.op).startsWith('inspect.'));
  return comNo || String(atual || '').startsWith('ins_') ? [...base, ...ins] : base;
}

function funcoesBase(tipo, atual) {
  if (AREAS.has(tipo)) {
    const base = [['zona', 'Zona de contagem'], ['roi', 'Processar só aqui (ROI)'],
                  ['exclusao', 'Exclusão (ignorar)'], ['medida', 'Medir área e perímetro'], ['nenhuma', 'Só desenho']];
    const nos = store.get().nodes || [];
    const bs = FUNCOES_BS[tipo];
    const comBs = bs && (nos.some((n) => n.op === 'beltscan.volumetria') || String(atual || '').startsWith('bs_'));
    const comTakt = nos.some((n) => n.op === 'takt.posto') || atual === 'takt_posto';
    // +Projeto: exemplo de uma classe do projeto ativo (caixa ou polígono)
    const comProj = tipo !== 'elipse' && tipo !== 'mascara' && (projetoAtivo() || atual === 'projeto_exemplo');
    return [...base, ...(comBs ? bs : []), ...(comTakt ? FUNCOES_TAKT : []), ...(comProj ? [['projeto_exemplo', '+Projeto · exemplo']] : [])];
  }
  if (tipo === 'linha') return [['cruzamento', 'Cruzamento (contar)'], ['nenhuma', 'Só desenho']];
  if (tipo === 'polilinha') return [['medida', 'Medida (comprimento)'], ['nenhuma', 'Só desenho']];
  if (tipo === 'regua' || tipo === 'angulo' || tipo === 'perfil' || tipo === 'distancia' || tipo === 'trajetoria') return [['medida', 'Medida']];
  return [['anotacao', 'Anotação']];
}

const NOMES = {
  retangulo: 'Área', poligono: 'Polígono', elipse: 'Elipse', linha: 'Linha',
  regua: 'Régua', angulo: 'Ângulo', ponto: 'Ponto', texto: 'Texto',
  polilinha: 'Polilinha', seta: 'Seta', mascara: 'Máscara', esqueleto: 'Esqueleto', perfil: 'Perfil',
  distancia: 'Distância', contador: 'Contagem', cronometro: 'Cronômetro', trajetoria: 'Trajetória',
  perspectiva: 'Perspectiva',
};
const NOME_FUNC = { projeto_exemplo: 'Exemplo', roi: 'ROI', exclusao: 'Exclusão', bs_busca: 'Faixa de busca', bs_exclusao: 'Exclusão BS', bs_velocidade: 'Velocidade', takt_posto: 'Posto' };
const CORES = ['#FFD84D', '#4ade80', '#38bdf8', '#f472b6', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171'];

// ------------------------------------------------------------- estado

const CHAVE = 'gplansis.marcacoes.v1';
const PADRAO = 'Padrão';

/**
 * Estado de UI das marcações. Fica FORA do store principal: muda a cada
 * clique de desenho e não tem nada a ver com o pipeline salvo.
 */
export const marcStore = createStore({
  itens: [],
  escala: null,        // { mmPorPx (por px da FONTE), ref: nome da régua, W, H }
  visivel: true,       // mostrar/ocultar todas (só exibição; as funções continuam valendo)
  roiLigada: true,     // aplicar ROI/exclusão ao processamento
  ferramenta: 'mover',
  sel: null,           // id selecionado
  selN: [],            // seleção múltipla (⇧+clique com Selecionar): alinhar, distribuir, agrupar, travar
  editando: null,      // id do texto sendo editado
  conjunto: PADRAO,
  conjuntos: [PADRAO],
  podeDesfazer: false,
  podeRefazer: false,
  // auxílios de exibição (não entram na captura: camada própria, marcacoes-vista.js)
  exib: { grade: 0, gradeN: 6, lupa: false, lupaZoom: 3, mira: false, reguas: false, encaixe: false },
  // opções das ferramentas: varinha (tolerância 0–255, contíguo), pincel (raio em px de tela), contador (classe ativa)
  opc: { tolerancia: 32, contiguo: true, raio: 14, contClasse: 'Classe 1' },
  analise: null,       // id da marcação no cartão "Análise" (histograma / perfil / área)
});

/**
 * O que muda na velocidade do ponteiro mora aqui, mutável e fora do React:
 * rascunho da forma em construção e a leitura do conta-gotas.
 */
export const rt = {
  rascunho: null,      // { tipo, funcao, pts: [[u,v]…], cursor: [u,v] | null }
  hover: null,         // id sob o cursor (borracha/seleção)
  redesenhar: () => {},// o Viewport troca por "repinte o próximo quadro" (vale com o vídeo pausado)
  arrastando: false,   // alça ou forma sendo arrastada (o BeltScan aplica ao soltar)
  selecao: null,       // área do clique direito { pts: [a, b] } (menu de contexto, marcacoes-vista.js)
  cursor: null,        // último ponto do ponteiro sobre o vídeo { cx, cy } (lupa, mira)
  sam: null,           // sessão do "Segmentar com um clique": { pontos, poligono, ocupado, erro }
  progresso: '',       // texto de carregamento de modelo (SAM) para a dica
};

/**
 * Geometria da vista, preenchida pelo Viewport a cada quadro pintado.
 *   W,H     tamanho da fonte (px)          sx,sy,sw,sh  recorte do zoom, em px da fonte
 *   fs      a fonte já chega espelhada (quadro do histórico gravado com espelho)
 *   fd      o desenho espelha (Espelhar ligado, ao vivo)
 *   dx..dh  retângulo do vídeo no canvas (px do canvas)   dpr  escala do canvas
 *   canvas  o canvas de exibição          el  o elemento da fonte (vídeo/canvas)
 */
export const vista = {
  ok: false, W: 1, H: 1, sx: 0, sy: 0, sw: 1, sh: 1, fs: false, fd: false,
  dx: 0, dy: 0, dw: 1, dh: 1, dpr: 1, canvas: null, el: null,
};

// ------------------------------------------------------------- conversões

/** Fonte normalizada → vista normalizada (0–1 do recorte que aparece; o quadro do pipeline). */
export function fonteParaVista(u, v, out) {
  const T = vista;
  const ue = T.fs ? 1 - u : u;
  const lx = (ue * T.W - T.sx) / T.sw;
  out[0] = T.fd ? 1 - lx : lx;
  out[1] = (v * T.H - T.sy) / T.sh;
  return out;
}

/** Vista normalizada → fonte normalizada. */
export function vistaParaFonte(vx, vy) {
  const T = vista;
  const lx = T.fd ? 1 - vx : vx;
  const ue = (T.sx + lx * T.sw) / T.W;
  return [cl01(T.fs ? 1 - ue : ue), cl01((T.sy + vy * T.sh) / T.H)];
}

/** Fonte normalizada → px do canvas de exibição. */
export function fonteParaTela(u, v, out) {
  fonteParaVista(u, v, out);
  out[0] = vista.dx + out[0] * vista.dw;
  out[1] = vista.dy + out[1] * vista.dh;
  return out;
}

/** Ponto do ponteiro (clientX/Y) → px do canvas. */
export function clienteParaTela(cx, cy) {
  const c = vista.canvas;
  if (!c) return [0, 0];
  const r = c.getBoundingClientRect();
  return [(cx - r.left) * vista.dpr, (cy - r.top) * vista.dpr];
}

/** Ponto do ponteiro → fonte normalizada. */
export function clienteParaFonte(cx, cy) {
  const [x, y] = clienteParaTela(cx, cy);
  return vistaParaFonte((x - vista.dx) / vista.dw, (y - vista.dy) / vista.dh);
}

/** A imagem que o pipeline recebe está espelhada em relação à fonte? */
export function espelhado() { return vista.fs !== vista.fd; }

function cl01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ------------------------------------------------------------- persistência

function lerTudo() {
  try {
    const raw = localStorage.getItem(CHAVE);
    const o = raw ? JSON.parse(raw) : null;
    if (o && o.conjuntos && typeof o.conjuntos === 'object') return o;
  } catch (_) { /* storage bloqueado ou JSON corrompido */ }
  return { versao: 1, ativo: PADRAO, conjuntos: { [PADRAO]: { itens: [], escala: null } } };
}

let salvarT = 0;
function salvar() {
  clearTimeout(salvarT);
  salvarT = setTimeout(() => {
    const st = marcStore.get();
    const tudo = lerTudo();
    tudo.versao = 1;
    tudo.ativo = st.conjunto;
    tudo.conjuntos[st.conjunto] = { itens: st.itens, escala: st.escala };
    tudo.visivel = st.visivel;
    tudo.roiLigada = st.roiLigada;
    tudo.exib = st.exib;
    tudo.opc = st.opc;
    try { localStorage.setItem(CHAVE, JSON.stringify(tudo)); } catch (_) { /* sem espaço: segue sem salvar */ }
  }, 250);
}

/** Carrega do localStorage (uma vez, quando o widget monta). */
export function carregarMarcacoes() {
  const tudo = lerTudo();
  const ativo = tudo.conjuntos[tudo.ativo] ? tudo.ativo : Object.keys(tudo.conjuntos)[0] || PADRAO;
  const c = tudo.conjuntos[ativo] || { itens: [], escala: null };
  marcStore.set({
    itens: sane(c.itens), escala: c.escala || null, conjunto: ativo,
    conjuntos: Object.keys(tudo.conjuntos).length ? Object.keys(tudo.conjuntos) : [PADRAO],
    visivel: tudo.visivel !== false, roiLigada: tudo.roiLigada !== false,
    ...(tudo.exib && typeof tudo.exib === 'object' ? { exib: { ...marcStore.get().exib, ...tudo.exib } } : {}),
    ...(tudo.opc && typeof tudo.opc === 'object' ? { opc: { ...marcStore.get().opc, ...tudo.opc } } : {}),
  });
  mudou();
}

/** Troca de conjunto nomeado (cria se não existe). O atual é salvo antes. */
export function usarConjunto(nome) {
  nome = String(nome || '').trim().slice(0, 40);
  if (!nome) return;
  const st = marcStore.get();
  const tudo = lerTudo();
  tudo.conjuntos[st.conjunto] = { itens: st.itens, escala: st.escala };
  const c = tudo.conjuntos[nome] || { itens: [], escala: st.escala };
  tudo.conjuntos[nome] = c;
  tudo.ativo = nome;
  try { localStorage.setItem(CHAVE, JSON.stringify(tudo)); } catch (_) { /* segue */ }
  hist.antes.length = 0; hist.depois.length = 0;
  marcStore.set({ itens: sane(c.itens), escala: c.escala || null, conjunto: nome, conjuntos: Object.keys(tudo.conjuntos),
                  sel: null, podeDesfazer: false, podeRefazer: false });
  mudou();
}

/** Apaga o conjunto atual (o último que sobrar vira "Padrão" vazio). */
export function apagarConjunto() {
  const st = marcStore.get();
  const tudo = lerTudo();
  delete tudo.conjuntos[st.conjunto];
  if (!Object.keys(tudo.conjuntos).length) tudo.conjuntos[PADRAO] = { itens: [], escala: null };
  tudo.ativo = Object.keys(tudo.conjuntos)[0];
  try { localStorage.setItem(CHAVE, JSON.stringify(tudo)); } catch (_) { /* segue */ }
  const c = tudo.conjuntos[tudo.ativo];
  marcStore.set({ itens: sane(c.itens), escala: c.escala || null, conjunto: tudo.ativo, conjuntos: Object.keys(tudo.conjuntos), sel: null });
  mudou();
}

/** Valida o que veio do disco ou de um JSON importado. */
function sane(itens) {
  if (!Array.isArray(itens)) return [];
  const out = [];
  for (const it of itens) {
    if (!it || !NOMES[it.tipo] || !Array.isArray(it.pts) || !it.pts.length) continue;
    const pts = it.pts.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [cl01(+p[0]), cl01(+p[1])]);
    if (!pts.length) continue;
    const funcs = funcoesDe(it.tipo, it.funcao).map((f) => f[0]);
    out.push({
      id: typeof it.id === 'string' ? it.id : novoId(), tipo: it.tipo, pts,
      nome: String(it.nome || NOMES[it.tipo]).slice(0, 60),
      cor: /^#[0-9a-f]{6}$/i.test(it.cor) ? it.cor : CORES[0],
      funcao: funcs.includes(it.funcao) ? it.funcao : funcs[0],
      visivel: it.visivel !== false,
      classes: String(it.classes || '').slice(0, 200),
      texto: it.tipo === 'texto' ? String(it.texto || '').slice(0, 200) : undefined,
      ...(it.funcao === 'projeto_exemplo' || it.tipo === 'contador' ? { classe: String(it.classe || '').slice(0, 40) } : {}),
      ...(it.grupo ? { grupo: String(it.grupo).slice(0, 40) } : {}),
      ...(it.travado ? { travado: true } : {}),
      ...extrasDe(it),
    });
  }
  return out;
}

/** Campos próprios dos tipos novos, validados (máscara, ligações, tempos). */
function extrasDe(it) {
  const o = {};
  if (it.tipo === 'mascara') {
    const m = it.mask;
    if (!m || !(m.w > 0) || !(m.h > 0) || typeof m.rle !== 'string') return { mask: { w: 1, h: 1, rle: '1' } };
    o.mask = { w: m.w | 0, h: m.h | 0, rle: m.rle };
  }
  if (it.tipo === 'distancia' && Array.isArray(it.refs)) o.refs = it.refs.slice(0, 2).map((r) => (typeof r === 'string' ? r : null));
  if (it.tipo === 'cronometro') {
    o.t0 = Number.isFinite(it.t0) ? it.t0 : 0;
    o.t1 = Number.isFinite(it.t1) ? it.t1 : null;
    o.relogio = it.relogio === 'video' ? 'video' : 'real';
    if (Array.isArray(it.voltas)) o.voltas = it.voltas.filter(Number.isFinite).slice(0, 50);
  }
  if (it.tipo === 'trajetoria') {
    o.ts = Array.isArray(it.ts) ? it.ts.map(Number).slice(0, MAX_RASTRO) : [];
    o.ativo = false;   // o rastreio não sobrevive a recarregar (o quadro de referência se perdeu)
  }
  if (it.tipo === 'perspectiva') o.n = Math.max(2, Math.min(24, Number(it.n) || 8));
  return o;
}

/** Pontos guardados por trajetória (o rastro mais antigo sai). */
export const MAX_RASTRO = 2000;

// ------------------------------------------------------------- mutações (com desfazer)

const hist = { antes: [], depois: [] };
let versao = 0;

/** Avisa quem desenha: muda a versão (invalida o cache do quadro) e pede um repinte. */
function mudou() {
  versao++;
  rt.redesenhar();
}

function foto() {
  const st = marcStore.get();
  return { itens: st.itens, escala: st.escala };
}

/**
 * Aplica uma mudança que entra no histórico. `fn(itens) → itens novos`.
 * Os itens são tratados como imutáveis: cada mudança cria arrays novos, então
 * a foto do histórico é só a referência anterior.
 */
export function confirmar(fn, extra) {
  const antes = foto();
  const itens = ligar(fn(antes.itens));
  if (itens === antes.itens && !extra) return;
  hist.antes.push(antes);
  if (hist.antes.length > 100) hist.antes.shift();
  hist.depois.length = 0;
  marcStore.set({ itens, ...(extra || {}), podeDesfazer: true, podeRefazer: false });
  salvar();
  mudou();
}

/** Guarda o estado atual no histórico ANTES de uma edição contínua (arrastar vértice). */
export function marcoDesfazer() {
  hist.antes.push(foto());
  if (hist.antes.length > 100) hist.antes.shift();
  hist.depois.length = 0;
  marcStore.set({ podeDesfazer: true, podeRefazer: false });
}

/** Edição contínua (arrastar): muda sem empilhar histórico. */
export function editarSemHistorico(fn) {
  const st = marcStore.get();
  marcStore.set({ itens: ligar(fn(st.itens)) });
  salvar();
  mudou();
}

/** A seleção sobrevive ao desfazer/refazer se a forma ainda existe. */
function manterSel(itens) {
  const sel = marcStore.get().sel;
  return sel && itens.some((i) => i.id === sel) ? sel : null;
}

function manterSelN(itens) { return marcStore.get().selN.filter((id) => itens.some((i) => i.id === id)); }

export function desfazer() {
  const a = hist.antes.pop();
  if (!a) return;
  hist.depois.push(foto());
  marcStore.set({ ...a, sel: manterSel(a.itens), selN: manterSelN(a.itens), podeDesfazer: hist.antes.length > 0, podeRefazer: true });
  salvar();
  mudou();
}

export function refazer() {
  const d = hist.depois.pop();
  if (!d) return;
  hist.antes.push(foto());
  marcStore.set({ ...d, sel: manterSel(d.itens), selN: manterSelN(d.itens), podeDesfazer: true, podeRefazer: hist.depois.length > 0 });
  salvar();
  mudou();
}

let seq = 0;
export function novoId() { return 'mk' + (++seq).toString(36) + Date.now().toString(36).slice(-4); }

/** Cria uma marcação a partir da ferramenta e devolve o id. */
export function criar(ferramenta, pts, extra = {}) {
  const [tipo, funcao0] = CRIA[ferramenta] || CRIA.retangulo;
  const funcao = extra.funcao || funcao0;
  const st = marcStore.get();
  if (funcao === 'projeto_exemplo' && !extra.classe) extra = { ...dadosExemplo(), ...extra };
  const base = extra.nomeBase || NOME_FUNC[funcao] || NOMES[tipo];
  if (extra.nomeBase) { extra = { ...extra }; delete extra.nomeBase; }
  const n = st.itens.filter((i) => i.nome.startsWith(base + ' ')).length + 1;
  const item = {
    id: novoId(), tipo, funcao, pts: pts.map((p) => [cl01(p[0]), cl01(p[1])]),
    nome: `${base} ${n}`,
    cor: COR_FUNC[funcao] || (funcao === 'exclusao' ? '#f87171' : funcao === 'roi' ? '#38bdf8' : CORES[st.itens.length % CORES.length]),
    visivel: true, classes: '',
    ...(tipo === 'texto' ? { texto: '' } : {}),
    ...extra,
  };
  confirmar((itens) => [...itens, item], { sel: item.id, selN: [item.id] });
  return item.id;
}

/** Classe ativa do projeto → { classe, cor } de uma marcação de exemplo. */
export function dadosExemplo(i = null) {
  const p = projetoAtivo();
  const c = p && p.classes[i == null ? p.classe : i];
  return c ? { classe: c.nome, cor: c.cor, nome: `Exemplo · ${c.nome}` } : { classe: '', cor: '#FFD84D' };
}

// renomear/recolorir a classe no +Projeto: os exemplos ao vivo daquela classe acompanham
ouvirClasses(({ antes, depois }) => {
  const st = marcStore.get();
  if (!antes || !st.itens.some((i) => i.funcao === 'projeto_exemplo' && i.classe === antes.nome)) return;
  marcStore.set({ itens: st.itens.map((it) => (it.funcao !== 'projeto_exemplo' || it.classe !== antes.nome ? it : {
    ...it, classe: depois.nome, cor: depois.cor, nome: it.nome === `Exemplo · ${antes.nome}` ? `Exemplo · ${depois.nome}` : it.nome,
  })) });
  salvar();
  mudou();
});

export function atualizar(id, patch) {
  confirmar((itens) => itens.map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export function apagar(id) {
  const st = marcStore.get();
  confirmar((itens) => itens.filter((i) => i.id !== id), { sel: st.sel === id ? null : st.sel, selN: st.selN.filter((x) => x !== id) });
  resultados.delete(id);
}

export function limparTudo() {
  confirmar(() => [], { sel: null, selN: [], analise: null });
  resultados.clear();
}

/** Inverte o sentido de uma linha (troca A e B). */
export function inverter(id) {
  confirmar((itens) => itens.map((i) => (i.id === id ? { ...i, pts: [i.pts[1], i.pts[0]] } : i)));
}

export function definirEscala(escala) {
  confirmar((itens) => itens, { escala });
}

export function setFerramenta(f) {
  rt.rascunho = null;
  rt.sam = null;
  marcStore.set({ ferramenta: f, editando: null });
  rt.redesenhar();
}

export function setVisivel(v) { marcStore.set({ visivel: v }); salvar(); mudou(); }
export function setRoiLigada(v) { marcStore.set({ roiLigada: v }); salvar(); mudou(); }
export function selecionar(id, somar = false) {
  const st = marcStore.get();
  if (somar && id) {
    const base = st.selN.length ? st.selN : st.sel ? [st.sel] : [];
    const selN = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    marcStore.set({ sel: selN.length ? selN[selN.length - 1] : null, selN });
  } else marcStore.set({ sel: id, selN: id ? [id] : [] });
  rt.redesenhar();
}

/** Ids selecionados (a múltipla ou só a atual). */
export function selecionados() {
  const st = marcStore.get();
  const l = st.selN.length ? st.selN : st.sel ? [st.sel] : [];
  return l.filter((id) => st.itens.some((i) => i.id === id));
}

export function setExib(patch) { marcStore.set({ exib: { ...marcStore.get().exib, ...patch } }); salvar(); rt.redesenhar(); }
export function setOpc(patch) { marcStore.set({ opc: { ...marcStore.get().opc, ...patch } }); salvar(); }

// ------------------------------------------------------------- import / export

export function exportarJSON() {
  const st = marcStore.get();
  return JSON.stringify({
    formato: 'gplansis.marcacoes', versao: 1, conjunto: st.conjunto,
    criado_em: new Date().toISOString(), escala: st.escala, itens: st.itens,
  }, null, 2);
}

/** Importa um JSON exportado (substitui as marcações do conjunto atual, com desfazer). */
export function importarJSON(texto) {
  const o = JSON.parse(texto);
  const itens = sane(o && (o.itens || (Array.isArray(o) ? o : null)));
  if (!itens.length) throw new Error('nenhuma marcação válida no arquivo');
  confirmar(() => itens, { escala: o.escala && Number.isFinite(o.escala.mmPorPx) ? o.escala : marcStore.get().escala, sel: null });
  return itens.length;
}

// ------------------------------------------------------------- medidas

/** Distância entre dois pontos da fonte, em px da FONTE (não depende do zoom). */
export function distPx(a, b) {
  const W = vista.W, H = vista.H;
  return Math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H);
}

export function comprimentoPx(it) {
  let s = 0;
  for (let i = 1; i < it.pts.length; i++) s += distPx(it.pts[i - 1], it.pts[i]);
  return s;
}

/** Ângulo no vértice do meio (graus, 0–180). */
export function anguloGraus(it) {
  if (it.pts.length < 3) return null;
  const W = vista.W, H = vista.H;
  const [a, b, c] = it.pts;
  const v1x = (a[0] - b[0]) * W, v1y = (a[1] - b[1]) * H;
  const v2x = (c[0] - b[0]) * W, v2y = (c[1] - b[1]) * H;
  const n = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!n) return null;
  return (Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / n))) * 180) / Math.PI;
}

/** Área em px² da fonte. */
export function areaPx(it) {
  const W = vista.W, H = vista.H;
  if (it.tipo === 'mascara') {
    const m = it.mask, bits = mascaraBits(m);
    let n = 0;
    for (let i = 0; i < bits.length; i++) n += bits[i];
    const bw = Math.abs(it.pts[1][0] - it.pts[0][0]) * W, bh = Math.abs(it.pts[1][1] - it.pts[0][1]) * H;
    return n * (bw / m.w) * (bh / m.h);
  }
  if (it.tipo === 'retangulo' || it.tipo === 'elipse') {
    const w = Math.abs(it.pts[1][0] - it.pts[0][0]) * W, h = Math.abs(it.pts[1][1] - it.pts[0][1]) * H;
    return it.tipo === 'elipse' ? (Math.PI * w * h) / 4 : w * h;
  }
  let s = 0;
  const p = it.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] * W) * (p[i][1] * H) - (p[i][0] * W) * (p[j][1] * H);
  return Math.abs(s) / 2;
}

/** mm por px da fonte, ou null sem calibração. */
export function mmPorPx() {
  const e = marcStore.get().escala;
  return e && Number.isFinite(e.mmPorPx) && e.mmPorPx > 0 ? e.mmPorPx : null;
}

/** Texto de um comprimento: em mm/cm/m com calibração, senão px. */
export function fmtComprimento(px) {
  const k = mmPorPx();
  if (!k) return `${px.toFixed(0)} px`;
  const mm = px * k;
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  if (mm >= 100) return `${(mm / 10).toFixed(1)} cm`;
  return `${mm.toFixed(1)} mm`;
}

export function fmtArea(px2) {
  const k = mmPorPx();
  if (!k) return `${Math.round(px2)} px²`;
  const mm2 = px2 * k * k;
  if (mm2 >= 1e6) return `${(mm2 / 1e6).toFixed(2)} m²`;
  if (mm2 >= 100) return `${(mm2 / 100).toFixed(1)} cm²`;
  return `${mm2.toFixed(0)} mm²`;
}

/** Calibra: a régua `id` mede `valor` na `unidade` → escala px→mm global. */
export function calibrar(id, valor, unidade) {
  const it = marcStore.get().itens.find((i) => i.id === id);
  const v = Number(String(valor).replace(',', '.'));
  if (!it || !(v > 0)) return false;
  const mm = v * (unidade === 'm' ? 1000 : unidade === 'cm' ? 10 : 1);
  const px = comprimentoPx(it);
  if (!(px > 0)) return false;
  definirEscala({ mmPorPx: mm / px, ref: it.nome, W: vista.W, H: vista.H, medida: `${v} ${unidade}` });
  return true;
}

// ------------------------------------------------------------- medidas das formas novas

/** Perímetro em px da fonte (áreas) — elipse pela aproximação de Ramanujan; máscara pelas bordas dos pixels. */
export function perimetroPx(it) {
  const W = vista.W, H = vista.H;
  if (it.tipo === 'retangulo') {
    const w = Math.abs(it.pts[1][0] - it.pts[0][0]) * W, h = Math.abs(it.pts[1][1] - it.pts[0][1]) * H;
    return 2 * (w + h);
  }
  if (it.tipo === 'elipse') {
    const a = (Math.abs(it.pts[1][0] - it.pts[0][0]) * W) / 2, b = (Math.abs(it.pts[1][1] - it.pts[0][1]) * H) / 2;
    const h = ((a - b) * (a - b)) / ((a + b) * (a + b) || 1);
    return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  }
  if (it.tipo === 'mascara') {
    const m = it.mask, bits = mascaraBits(m);
    const kx = (Math.abs(it.pts[1][0] - it.pts[0][0]) * W) / m.w, ky = (Math.abs(it.pts[1][1] - it.pts[0][1]) * H) / m.h;
    let ex = 0, ey = 0;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        const v = bits[y * m.w + x];
        if ((x ? bits[y * m.w + x - 1] : 0) !== v) ey++;
        if ((y ? bits[(y - 1) * m.w + x] : 0) !== v) ex++;
      }
      if (bits[y * m.w + m.w - 1]) ey++;
    }
    for (let x = 0; x < m.w; x++) if (bits[(m.h - 1) * m.w + x]) ex++;
    // borda em escada superestima ~4/π numa forma lisa: corrige como o Fiji faz para contornos traçados
    return (ex * kx + ey * ky) * (Math.PI / 4);
  }
  if (it.tipo === 'poligono') {
    let s = 0;
    for (let i = 0; i < it.pts.length; i++) s += distPx(it.pts[i], it.pts[(i + 1) % it.pts.length]);
    return s;
  }
  return comprimentoPx(it);
}

/** Centroide (0–1 da fonte) de qualquer marcação. */
export function centroide(it) {
  const W = vista.W, H = vista.H, p = it.pts;
  if (it.tipo === 'retangulo' || it.tipo === 'elipse') return [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
  if (it.tipo === 'mascara') {
    const m = it.mask, bits = mascaraBits(m);
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (bits[y * m.w + x]) { sx += x + 0.5; sy += y + 0.5; n++; }
    if (!n) return [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
    return [p[0][0] + ((p[1][0] - p[0][0]) * sx) / n / m.w, p[0][1] + ((p[1][1] - p[0][1]) * sy) / n / m.h];
  }
  if (it.tipo === 'poligono' && p.length >= 3) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i][0] * W, yi = p[i][1] * H, xj = p[j][0] * W, yj = p[j][1] * H;
      const f = xj * yi - xi * yj;
      a += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
    }
    if (Math.abs(a) > 1e-9) return [cx / (3 * a) / W, cy / (3 * a) / H];
  }
  if (it.tipo === 'trajetoria' || it.tipo === 'cronometro' || it.tipo === 'texto') return p[p.length - 1].slice();
  let sx = 0, sy = 0;
  for (const q of p) { sx += q[0]; sy += q[1]; }
  return [sx / p.length, sy / p.length];
}

/** Círculo pelos 3 pontos (0–1 da fonte) → caixa [[x1,y1],[x2,y2]] em 0–1, ou null se colineares. */
export function circuloPor3(a, b, c) {
  const W = vista.W, H = vista.H;
  const ax = a[0] * W, ay = a[1] * H, bx = b[0] * W, by = b[1] * H, cx = c[0] * W, cy = c[1] * H;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  return { caixa: [[(ux - r) / W, (uy - r) / H], [(ux + r) / W, (uy + r) / H]], r, cx: ux, cy: uy };
}

// ------------------------------------------------------------- máscara binária (pincel)

/*
 * A máscara do pincel cobre a caixa pts[0]→pts[1] (0–1 da fonte) com uma
 * grade w×h de bits, guardada em RLE (comprimentos alternados começando por
 * zeros, em base 36): exportável no JSON e pequena no localStorage. A grade
 * acompanha a caixa ao mover/redimensionar (é esticada), como uma camada.
 */
const bitsCache = new WeakMap();
const telaCache = new WeakMap();

export function codificarMascara(bits, w, h) {
  const runs = [];
  let v = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (bits[i] === v) n++;
    else { runs.push(n); v = bits[i]; n = 1; }
  }
  runs.push(n);
  return { w, h, rle: runs.map((x) => x.toString(36)).join(',') };
}

export function mascaraBits(m) {
  let b = bitsCache.get(m);
  if (b) return b;
  b = new Uint8Array(m.w * m.h);
  let i = 0, v = 0;
  for (const t of String(m.rle).split(',')) {
    const n = parseInt(t, 36) || 0;
    if (v) b.fill(1, i, Math.min(b.length, i + n));
    i += n; v ^= 1;
  }
  bitsCache.set(m, b);
  return b;
}

/** Canvas da máscara pintada na cor `cor` (opaco onde é 1, transparente fora). Cacheado. */
export function mascaraCanvas(m, cor) {
  let por = telaCache.get(m);
  if (!por) { por = new Map(); telaCache.set(m, por); }
  if (por.has(cor)) return por.get(cor);
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(m.w, m.h) : Object.assign(document.createElement('canvas'), { width: m.w, height: m.h });
  const g = c.getContext('2d');
  const im = g.createImageData(m.w, m.h);
  const n = parseInt(cor.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
  const bits = mascaraBits(m);
  const d32 = new Uint32Array(im.data.buffer);
  const px = (255 << 24) | (bb << 16) | (gg << 8) | r;   // little-endian RGBA
  for (let i = 0; i < bits.length; i++) if (bits[i]) d32[i] = px;
  g.putImageData(im, 0, 0);
  por.set(cor, c);
  return c;
}

/** Recorta a grade ao menor retângulo com bits ligados. null se vazia. */
export function recortarMascara(bits, w, h, caixa) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bits[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const nb = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) nb.set(bits.subarray((y + y0) * w + x0, (y + y0) * w + x0 + nw), y * nw);
  const [[u0, v0], [u1, v1]] = caixa;
  const ku = (u1 - u0) / w, kv = (v1 - v0) / h;
  return { mask: codificarMascara(nb, nw, nh), pts: [[u0 + x0 * ku, v0 + y0 * kv], [u0 + (x1 + 1) * ku, v0 + (y1 + 1) * kv]] };
}

/** PNG binário (branco = máscara) na resolução da FONTE, para exportar. */
export async function mascaraPNG(it) {
  const W = Math.max(1, Math.round(vista.W)), H = Math.max(1, Math.round(vista.H));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.imageSmoothingEnabled = false;
  const [[u0, v0], [u1, v1]] = it.pts;
  g.drawImage(mascaraCanvas(it.mask, '#ffffff'), u0 * W, v0 * H, (u1 - u0) * W, (v1 - v0) * H);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

// ------------------------------------------------------------- ligações, organização

/** Distâncias ligadas a objetos seguem os centroides deles (chamado a cada mudança). */
function ligar(itens) {
  if (!itens.some((i) => i.tipo === 'distancia' && i.refs)) return itens;
  let mudou = false;
  const out = itens.map((it) => {
    if (it.tipo !== 'distancia' || !it.refs) return it;
    const pts = it.pts.map((p, k) => {
      const r = it.refs[k] && itens.find((x) => x.id === it.refs[k]);
      return r ? centroide(r) : p;
    });
    if (pts.every((p, k) => Math.abs(p[0] - it.pts[k][0]) < 1e-7 && Math.abs(p[1] - it.pts[k][1]) < 1e-7)) return it;
    mudou = true;
    return { ...it, pts };
  });
  return mudou ? out : itens;
}

/** Caixa de uma marcação em 0–1 da fonte. */
export function caixaItem(it) {
  let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
  for (const [u, v] of it.pts) { x1 = Math.min(x1, u); y1 = Math.min(y1, v); x2 = Math.max(x2, u); y2 = Math.max(y2, v); }
  return { x1, y1, x2, y2 };
}

function transladar(it, du, dv) {
  return { ...it, pts: it.pts.map(([u, v]) => [cl01(u + du), cl01(v + dv)]) };
}

/**
 * Alinhar / distribuir (como no Figma) as marcações `ids`:
 * esq, cx, dir, topo, cy, base; distH e distV (espaços iguais, precisa de 3+).
 * As travadas não se mexem (mas contam como referência).
 */
export function alinhar(ids, modo) {
  const st = marcStore.get();
  const sel = st.itens.filter((i) => ids.includes(i.id));
  if (sel.length < 2 || (modo.startsWith('dist') && sel.length < 3)) return false;
  const cx = sel.map(caixaItem);
  const desl = new Map();
  if (modo.startsWith('dist')) {
    const h = modo === 'distH';
    const ord = sel.map((it, k) => ({ it, c: cx[k] })).sort((a, b) => (h ? a.c.x1 - b.c.x1 : a.c.y1 - b.c.y1));
    const ini = h ? ord[0].c.x1 : ord[0].c.y1;
    const fim = h ? ord[ord.length - 1].c.x2 : ord[ord.length - 1].c.y2;
    const soma = ord.reduce((s, o) => s + (h ? o.c.x2 - o.c.x1 : o.c.y2 - o.c.y1), 0);
    const gap = (fim - ini - soma) / (ord.length - 1);
    let pos = ini;
    for (const o of ord) {
      const d = pos - (h ? o.c.x1 : o.c.y1);
      desl.set(o.it.id, h ? [d, 0] : [0, d]);
      pos += (h ? o.c.x2 - o.c.x1 : o.c.y2 - o.c.y1) + gap;
    }
  } else {
    const X1 = Math.min(...cx.map((c) => c.x1)), X2 = Math.max(...cx.map((c) => c.x2));
    const Y1 = Math.min(...cx.map((c) => c.y1)), Y2 = Math.max(...cx.map((c) => c.y2));
    sel.forEach((it, k) => {
      const c = cx[k];
      const d = modo === 'esq' ? [X1 - c.x1, 0] : modo === 'dir' ? [X2 - c.x2, 0] : modo === 'cx' ? [(X1 + X2) / 2 - (c.x1 + c.x2) / 2, 0]
        : modo === 'topo' ? [0, Y1 - c.y1] : modo === 'base' ? [0, Y2 - c.y2] : [0, (Y1 + Y2) / 2 - (c.y1 + c.y2) / 2];
      desl.set(it.id, d);
    });
  }
  confirmar((itens) => itens.map((it) => {
    const d = desl.get(it.id);
    return !d || it.travado || (Math.abs(d[0]) < 1e-9 && Math.abs(d[1]) < 1e-9) ? it : transladar(it, d[0], d[1]);
  }));
  return true;
}

/** Grupo (camada) das marcações `ids` ('' tira do grupo). */
export function definirGrupo(ids, nome) {
  const g = String(nome || '').trim().slice(0, 40);
  confirmar((itens) => itens.map((it) => (ids.includes(it.id) ? (g ? { ...it, grupo: g } : (({ grupo, ...r }) => r)(it)) : it)));
}

/** Trava/destrava (cadeado): travada não se move, não se edita e a borracha não apaga. */
export function travar(ids, v) {
  confirmar((itens) => itens.map((it) => (ids.includes(it.id) ? (v ? { ...it, travado: true } : (({ travado, ...r }) => r)(it)) : it)));
}

/** Mostrar/ocultar ou travar um grupo inteiro ('' = sem grupo). */
export function grupoAplicar(nome, patch) {
  confirmar((itens) => itens.map((it) => ((it.grupo || '') !== nome ? it
    : patch.travado === false ? (({ travado, ...r }) => ({ ...r, ...(patch.visivel != null ? { visivel: patch.visivel } : {}) }))(it)
      : { ...it, ...patch })));
}

export function grupos() {
  const m = new Map();
  for (const it of marcStore.get().itens) {
    const g = it.grupo || '';
    const o = m.get(g) || { nome: g, n: 0, visiveis: 0, travados: 0 };
    o.n++; if (it.visivel) o.visiveis++; if (it.travado) o.travados++;
    m.set(g, o);
  }
  return [...m.values()];
}

// ------------------------------------------------------------- contador por clique

/** Acrescenta um clique (0–1 da fonte) à contagem da classe ativa. */
export function contarClique(p) {
  const st = marcStore.get();
  const classe = st.opc.contClasse || 'Classe 1';
  const it = st.itens.find((i) => i.tipo === 'contador' && i.classe === classe);
  if (it) { confirmar((itens) => itens.map((i) => (i.id === it.id ? { ...i, pts: [...i.pts, [cl01(p[0]), cl01(p[1])]] } : i)), { sel: it.id }); return it.id; }
  const k = new Set(st.itens.filter((i) => i.tipo === 'contador').map((i) => i.classe)).size;
  return criar('contador', [p], { classe, nome: `Contagem · ${classe}`, cor: CORES[(k + 1) % CORES.length] });
}

/** Tira o clique mais perto de `p` (até `tol` px da fonte); apaga a contagem que ficar vazia. */
export function descontarClique(p, tol = 24) {
  const W = vista.W, H = vista.H;
  let best = null;
  for (const it of marcStore.get().itens) {
    if (it.tipo !== 'contador' || it.travado) continue;
    it.pts.forEach((q, k) => { const d = Math.hypot((q[0] - p[0]) * W, (q[1] - p[1]) * H); if (d < tol && (!best || d < best.d)) best = { it, k, d }; });
  }
  if (!best) return false;
  if (best.it.pts.length === 1) apagar(best.it.id);
  else confirmar((itens) => itens.map((i) => (i.id === best.it.id ? { ...i, pts: i.pts.filter((_, k) => k !== best.k) } : i)));
  return true;
}

export function contadoresCSV() {
  const linhas = ['classe;n;indice;x_px;y_px'];
  const W = vista.W, H = vista.H;
  for (const it of marcStore.get().itens) {
    if (it.tipo !== 'contador') continue;
    it.pts.forEach((q, k) => linhas.push([it.classe, it.pts.length, k + 1, (q[0] * W).toFixed(1), (q[1] * H).toFixed(1)].join(';')));
  }
  return linhas.join('\n');
}

// ------------------------------------------------------------- cronômetro

/*
 * Tempo do QUADRO apresentado (requestVideoFrameCallback → mediaTime), não o
 * currentTime, que corre contínuo entre um quadro e outro: o cronômetro e a
 * trajetória ficam presos aos quadros, como no Kinovea.
 */
const quadroVideo = new WeakMap();
function seguirQuadros(el) {
  if (quadroVideo.has(el) || !el.requestVideoFrameCallback) return;
  quadroVideo.set(el, null);
  const f = (_, md) => { quadroVideo.set(el, md.mediaTime); el.requestVideoFrameCallback(f); };
  el.requestVideoFrameCallback(f);
}

/** Instante atual: o tempo do VÍDEO (arquivo) quando há; senão o relógio de parede, em s. */
export function tempoAgora() {
  const el = vista.el;
  if (el && typeof HTMLVideoElement !== 'undefined' && el instanceof HTMLVideoElement && Number.isFinite(el.duration) && el.duration > 0) {
    seguirQuadros(el);
    const mt = quadroVideo.get(el);
    return { t: mt != null && Math.abs(mt - el.currentTime) < 0.25 ? mt : el.currentTime, relogio: 'video' };
  }
  return { t: Date.now() / 1000, relogio: 'real' };
}

/** Segundos do cronômetro (parado: fim − início; correndo: agora − início). */
export function segundosCrono(it) {
  if (it.t1 != null) return it.t1 - it.t0;
  const a = tempoAgora();
  return a.relogio === it.relogio ? a.t - it.t0 : 0;
}

export function fmtTempo(s) {
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return (neg ? '−' : '') + (m ? `${m}:${r.toFixed(3).padStart(6, '0')}` : `${r.toFixed(3)} s`).replace('.', ',');
}

// ------------------------------------------------------------- geometria no quadro

/** Ponto (x,y) dentro de uma marcação de área já no espaço do quadro (normalizado). */
export function dentro(it, x, y) {
  const p = it.pts;
  if (it.tipo === 'retangulo') {
    const c = it.caixa;
    return x >= c.x1 && x <= c.x2 && y >= c.y1 && y <= c.y2;
  }
  if (it.tipo === 'elipse') {
    const c = it.caixa;
    const rx = (c.x2 - c.x1) / 2, ry = (c.y2 - c.y1) / 2;
    if (rx <= 0 || ry <= 0) return false;
    const dx = (x - (c.x1 + rx)) / rx, dy = (y - (c.y1 + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  if (it.tipo === 'mascara') {
    const q = it.mq;
    if (!q) return false;
    const fx = (x - p[0][0]) / (p[1][0] - p[0][0] || 1e-9), fy = (y - p[0][1]) / (p[1][1] - p[0][1] || 1e-9);
    if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) return false;
    return q.bits[Math.floor(fy * q.h) * q.w + Math.floor(fx * q.w)] === 1;
  }
  if (it.tipo === 'poligono') {
    let d = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) d = !d;
    }
    return d;
  }
  return false;
}

/** Lado do ponto em relação à reta A→B (sinal do produto vetorial), em px do quadro. */
export function lado(a, b, x, y, w, h) {
  return ((b[0] - a[0]) * w) * ((y - a[1]) * h) - ((b[1] - a[1]) * h) * ((x - a[0]) * w);
}

/** Os segmentos p→q e a→b se cruzam? */
export function cruza(p, q, a, b) {
  const d = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d1 = d(a[0], a[1], b[0], b[1], p[0], p[1]), d2 = d(a[0], a[1], b[0], b[1], q[0], q[1]);
  const d3 = d(p[0], p[1], q[0], q[1], a[0], a[1]), d4 = d(p[0], p[1], q[0], q[1], b[0], b[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * As marcações no ESPAÇO DO QUADRO do pipeline (w×h), para `ctx.marcacoes`.
 * Cacheado: só reconstrói quando as marcações, o zoom/espelho ou o tamanho
 * mudam — num quadro comum custa uma comparação de números.
 *
 *   {
 *     itens: [{ id, nome, tipo, funcao, cor, classes: [..]|null, texto,
 *               pts: [[x,y]…] 0–1 do quadro, px: [[x,y]…] px do quadro,
 *               fonte: [[u,v]…] 0–1 da fonte inteira, caixa: {x1,y1,x2,y2} (áreas) }],
 *     roi: true se há ROI/exclusão valendo,
 *     espelhado: o quadro está espelhado em relação à fonte,
 *     escala: { mmPorPxFonte, pxFontePorPxQuadro, mmPorPxQuadro }   (mm = null sem calibração)
 *   }
 */
const cache = { v: -1, w: 0, h: 0, sx: 0, sy: 0, sw: 0, sh: 0, fs: false, fd: false, W: 0, H: 0, obj: null };
const tmp = [0, 0];

export function paraQuadro(w, h) {
  const st = marcStore.get();
  if (!st.itens.length) return null;
  const T = vista;
  const c = cache;
  if (c.v === versao && c.w === w && c.h === h && c.sx === T.sx && c.sy === T.sy && c.sw === T.sw && c.sh === T.sh
      && c.fs === T.fs && c.fd === T.fd && c.W === T.W && c.H === T.H) return c.obj;
  const itens = st.itens.map((it) => {
    const pts = it.pts.map(([u, v]) => { fonteParaVista(u, v, tmp); return [tmp[0], tmp[1]]; });
    const o = {
      id: it.id, nome: it.nome, tipo: it.tipo, funcao: it.funcao, cor: it.cor, texto: it.texto,
      classes: parseClasses(it.classes), pts, px: pts.map((p) => [p[0] * w, p[1] * h]), fonte: it.pts,
    };
    if (AREAS.has(it.tipo)) {
      let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
      for (const p of pts) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
      o.caixa = { x1, y1, x2, y2 };
      if (it.tipo === 'mascara') o.mq = { bits: mascaraBits(it.mask), w: it.mask.w, h: it.mask.h, mask: it.mask };
    }
    return o;
  });
  const k = mmPorPx();
  const pxF = T.sw / w;
  c.obj = {
    itens,
    roi: st.roiLigada && itens.some((i) => AREAS.has(i.tipo) && (i.funcao === 'roi' || i.funcao === 'exclusao')),
    espelhado: T.fs !== T.fd,
    escala: { mmPorPxFonte: k, pxFontePorPxQuadro: pxF, mmPorPxQuadro: k ? k * pxF : null },
  };
  Object.assign(c, { v: versao, w, h, sx: T.sx, sy: T.sy, sw: T.sw, sh: T.sh, fs: T.fs, fd: T.fd, W: T.W, H: T.H });
  return c.obj;
}

function parseClasses(s) {
  const l = String(s || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return l.length ? l : null;
}

// ------------------------------------------------------------- máscara ROI / exclusão

let rasterCanvas = null;
const vistas32 = new WeakMap();   // ImageData → Uint32Array (os buffers vêm do pool e se repetem)

/**
 * Pinta a máscara na caixa (x0,y0)→(x1,y1) de `g` — os cantos podem vir
 * trocados (espelho): a grade é invertida junto, como a imagem.
 */
export function pintarMascara(g, mask, x0, y0, x1, y1, cor, alfa = 1) {
  const dw = x1 - x0, dh = y1 - y0;
  if (!dw || !dh) return;
  g.save();
  g.imageSmoothingEnabled = false;
  g.globalAlpha = alfa;
  g.translate(x0, y0);
  g.scale(dw < 0 ? -1 : 1, dh < 0 ? -1 : 1);
  g.drawImage(mascaraCanvas(mask, cor), 0, 0, Math.abs(dw), Math.abs(dh));
  g.restore();
}

function tracar(g, it, w, h) {
  const p = it.pts;
  g.beginPath();
  if (it.tipo === 'retangulo') {
    const c = it.caixa;
    g.rect(c.x1 * w, c.y1 * h, (c.x2 - c.x1) * w, (c.y2 - c.y1) * h);
  } else if (it.tipo === 'elipse') {
    const c = it.caixa;
    g.ellipse(((c.x1 + c.x2) / 2) * w, ((c.y1 + c.y2) / 2) * h, Math.max(0.5, ((c.x2 - c.x1) / 2) * w), Math.max(0.5, ((c.y2 - c.y1) / 2) * h), 0, 0, Math.PI * 2);
  } else {
    p.forEach((q, i) => (i ? g.lineTo(q[0] * w, q[1] * h) : g.moveTo(q[0] * w, q[1] * h)));
    g.closePath();
  }
}

/**
 * Trechos [início, fim) de pixels a apagar, por linha, para o tamanho w×h.
 * Rasterizado UMA vez por mudança (num canvas), depois guardado no próprio
 * objeto do quadro: no laço, aplicar a máscara é só um `fill` por trecho.
 */
function trechos(mq, w, h) {
  // um cache por tamanho: o quadro (procWidth) e o grabFull (resolução plena) se alternam
  const cache = mq._mascara || (mq._mascara = new Map());
  const chave = w * 100000 + h;
  const c = cache.get(chave);
  if (c) return c;
  if (!rasterCanvas) rasterCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  rasterCanvas.width = w; rasterCanvas.height = h;
  const g = rasterCanvas.getContext('2d', { willReadFrequently: true });
  const areas = mq.itens.filter((i) => AREAS.has(i.tipo));
  const rois = areas.filter((i) => i.funcao === 'roi');
  const excl = areas.filter((i) => i.funcao === 'exclusao');
  g.fillStyle = rois.length ? '#000' : '#fff';
  g.fillRect(0, 0, w, h);
  const pintar = (it, cor) => {
    if (it.tipo === 'mascara') pintarMascara(g, it.mq ? it.mq.mask : it.mask, it.pts[0][0] * w, it.pts[0][1] * h, it.pts[1][0] * w, it.pts[1][1] * h, cor);
    else { g.fillStyle = cor; tracar(g, it, w, h); g.fill(); }
  };
  for (const it of rois) pintar(it, '#ffffff');
  for (const it of excl) pintar(it, '#000000');
  const d = g.getImageData(0, 0, w, h).data;
  const out = [];
  for (let y = 0; y < h; y++) {
    let ini = -1;
    const base = y * w;
    for (let x = 0; x < w; x++) {
      const apagar = d[(base + x) * 4] < 128;
      if (apagar && ini < 0) ini = base + x;
      else if (!apagar && ini >= 0) { out.push(ini, base + x); ini = -1; }
    }
    if (ini >= 0) out.push(ini, base + w);
  }
  const s = Int32Array.from(out);
  if (cache.size > 4) cache.clear();
  cache.set(chave, s);
  return s;
}

/**
 * Pinta de preto o que está fora das ROIs e dentro das exclusões. Mantém as
 * coordenadas (nada é recortado), então caixas e overlays continuam no lugar.
 * `noLugar` altera `img` (usado no grabFull, que já devolve uma cópia nova);
 * senão devolve uma cópia do pool, ou null se não há nada a apagar.
 */
export function aplicarMascara(img, mq, noLugar = false) {
  const s = trechos(mq, img.width, img.height);
  if (!s.length) return noLugar ? img : null;
  const out = noLugar ? img : clone(img);
  let u32 = vistas32.get(out);
  if (!u32 || u32.buffer !== out.data.buffer) {
    u32 = new Uint32Array(out.data.buffer, out.data.byteOffset, out.data.length >> 2);
    vistas32.set(out, u32);
  }
  for (let i = 0; i < s.length; i += 2) u32.fill(0xFF000000, s[i], s[i + 1]);
  return out;
}

// ------------------------------------------------------------- resultados e eventos

/**
 * Resultados das funções de visão, escritos pelo operador CV-37 a cada
 * quadro e lidos pelo desenho e pela lista. Mutável e fora do React (muda a
 * 30 Hz); `t` diz se está fresco (o operador pode ter saído do pipeline).
 *   zona:       { ocupacao, max, entradas, saidas, permanencia: [{id, s}], mediaS, classes, t }
 *   cruzamento: { ida, volta, porClasse: {classe: {ida, volta}}, semId, t }
 */
export const resultados = new Map();

/** Contador de "zerar": o operador compara com o seu e zera o próprio estado. */
export const contagem = { geracao: 0 };

/** Eventos para o CSV: { t (ISO), marcacao, evento, classe, id }. */
export const eventos = [];

export function registrarEvento(ev) {
  eventos.push(ev);
  if (eventos.length > 5000) eventos.splice(0, eventos.length - 5000);
}

export function zerarContagens() {
  contagem.geracao++;
  resultados.clear();
  eventos.length = 0;
  rt.redesenhar();
}

export function eventosCSV() {
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = ['hora;marcacao;evento;classe;id'];
  for (const e of eventos) linhas.push([e.t, e.marcacao, e.evento, e.classe, e.id].map(q).join(';'));
  return linhas.join('\n');
}

/** Resultado ainda vale (o operador escreveu há pouco)? */
export function fresco(r) { return r && performance.now() - r.t < 1500; }

/** Baixa um texto como arquivo. */
export function baixar(nome, texto, tipo = 'application/json') {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
