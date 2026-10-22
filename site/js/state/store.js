/**
 * state/store.js — store mínimo com pub/sub.
 *
 * Não é Redux e não quer ser: o protótipo tem um estado pequeno e
 * compartilhado entre menu, painéis e o loop de render. Quando o backend
 * entrar, os dados de servidor migram para TanStack Query (SPEC §3.1) e
 * este store fica só com o estado de UI.
 */

const { useState, useEffect } = window.React;

export function createStore(initial) {
  let state = initial;
  const subs = new Set();

  const get = () => state;

  const set = (patch) => {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (next === state) return state;
    state = { ...state, ...next };
    for (const fn of subs) fn(state);
    return state;
  };

  const subscribe = (fn) => {
    subs.add(fn);
    return () => subs.delete(fn);
  };

  return { get, set, subscribe };
}

/** Hook de leitura do store, com seletor opcional. */
export function useStore(store, selector = (s) => s) {
  const [slice, setSlice] = useState(() => selector(store.get()));
  useEffect(() => {
    // sincroniza no mount: o estado pode ter mudado entre render e effect
    setSlice(selector(store.get()));
    return store.subscribe((s) => {
      const next = selector(s);
      setSlice((prev) => (shallowEq(prev, next) ? prev : next));
    });
  }, [store]);
  return slice;
}

function shallowEq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// ------------------------------------------------------------ estado do app

/**
 * Painéis abertos na primeira execução.
 *
 * No DESKTOP a área de trabalho vem montada: sete painéis, porque abri-los
 * um a um toda vez seriam sete cliques e fechar o que não interessa é um.
 *
 * No CELULAR e no app instalado, NENHUM. A tela é pequena e o valor está no
 * vídeo — abrir sete painéis cobriria justamente a imagem que a pessoa
 * levantou o telefone para ver. O menu hambúrguer abre o que for preciso.
 */
function defaultPanels() {
  const fechado = {
    camera: false, models: false, modules: false, pipeline: false,
    stats: false, config: false, context: false, auth: false,
    export: false, codes: false, captions: false,
  };
  if (typeof window === 'undefined') return fechado;

  const estreito = window.innerWidth < 820;
  // instalado como app: sem barra de endereço, a tela é ainda mais preciosa
  const instalado = window.matchMedia
    && (window.matchMedia('(display-mode: standalone)').matches
     || window.matchMedia('(display-mode: fullscreen)').matches
     || window.navigator.standalone === true);   // iOS usa esta bandeira própria

  if (estreito || instalado) return fechado;

  return {
    ...fechado,
    camera: true, models: true, modules: true,
    pipeline: true, stats: true, config: true, context: true,
  };
}

export const store = createStore({
  // fonte
  sourceKind: 'camera',        // 'camera' | 'file'
  cameraOn: false,
  devices: [],
  deviceId: null,
  resolution: { width: 640, height: 480 },
  mirror: true,
  facing: 'user',        // 'user' = frontal, 'environment' = traseira
  hasMultiCam: false,

  // processamento
  procWidth: 480,              // largura de trabalho: o gargalo real do FPS
  running: true,
  nodes: [],                   // cadeia de operadores
  // zoom digital da fonte: z = ampliação (1–8), cx/cy = centro do recorte (0–1, como o usuário VÊ a imagem)
  zoom: { z: 1, cx: 0.5, cy: 0.5 },
  loop: true,                  // repetir o vídeo (arquivo e YouTube) ao chegar ao fim
  selectedNode: null,
  compare: false,              // split original | processado
  ferramentas: true,           // widget vertical de Ferramentas de mouse sobre o vídeo (marcações: cv/marcacoes.js)
  player: true,                // widget Player (VideoControls: transporte, zoom, gravar, linha do tempo) — botão na barra, ⇧B

  panels: defaultPanels(),

  /*
   * Disposição padrão em QUATRO colunas.
   *
   * Duas não bastavam: com 8 painéis abertos a coluna virava uma pilha
   * rolável, e rolar para achar a Telemetria enquanto se ajusta o Pipeline
   * é pior que ter os dois à vista. Quatro colunas cabem numa tela larga e
   * se fundem em duas (e depois em uma) conforme a janela encolhe — o CSS
   * cuida disso, então a garantia de não sobreposição continua sendo do
   * layout, não de coordenadas.
   *
   *   left    Fonte, Modelos          (o que alimenta o sistema)
   *   left2   Módulos                 (catálogo, é alto)
   *   right2  Pipeline, Telemetria, Config   (o que se ajusta e observa)
   *   right   Contexto, Acesso, Exportar     (leitura e saída)
   */
  dock: {
    camera: 'left',
    models: 'left',
    modules: 'left2',
    pipeline: 'right2',
    stats: 'right2',
    config: 'right2',
    coisas: 'right2',
    bikefit: 'right',
    ergonomia: 'right',
    academia: 'right',
    salto: 'right',
    corrida: 'right',
    swing: 'right',
    vbt: 'right',
    quadra: 'right',
    esportes: 'right',
    context: 'right',
    codes: 'right',
    captions: 'right',
    auth: 'right',
    export: 'right',
  },
  floating: {},
  /*
   * Organizador (layout/organizador.js): ordem em que os painéis ancorados
   * foram abertos (o mais antigo recolhe primeiro quando falta altura) e os
   * que o USUÁRIO recolheu para só o cabeçalho.
   */
  ordem: [],
  recolhidos: {},

  // qualidade de captura
  autoQuality: true,   // ajusta procWidth sozinho para segurar o alvo de fps
  targetFps: 30,

  /*
   * Áudio da gravação: 'auto' (som da fonte quando ela tem; senão microfone)
   * ou 'off'. Decisão de onde vem o som mora em cv/audio.js.
   */
  recordAudio: 'auto',

  // buffer de frames dos controles de vídeo
  ringCapacity: 60,      // buffer sem compressão (fallback)
  ringWidth: 320,
  codecCapacity: 300,    // buffer comprimido: 10× mais frames…
  codecWidth: 640,       // …no dobro da resolução
  codecBitrate: 2000000,
  ringKind: 'raw',

  // telemetria
  fps: 0,
  procMs: 0,
  metrics: {},
  timings: [],

  // avisos
  notice: null,
});

export const PERSIST_KEY = 'vlc.prototype.v1';

/**
 * Versão da DISPOSIÇÃO padrão dos painéis.
 *
 * Sem isto, mudar o padrão não teria efeito para ninguém: `restore()` funde
 * o que está salvo POR CIMA do padrão, então a disposição antiga de quem já
 * abriu o sistema venceria para sempre — e a mudança só apareceria para
 * quem nunca tinha entrado.
 *
 * Ao subir este número, `dock` e `floating` guardados são descartados uma
 * vez e o padrão novo assume. O resto das preferências (pipeline, qualidade,
 * espelho) é preservado, porque não tem nada a ver com layout.
 */
export const LAYOUT_VERSION = 2;

/** Persiste só o que faz sentido reabrir: pipeline e preferências. */
export function persist() {
  const s = store.get();
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      nodes: s.nodes,
      procWidth: s.procWidth,
      mirror: s.mirror,
      resolution: s.resolution,
      panels: s.panels,
      layoutVersion: LAYOUT_VERSION,
      dock: s.dock,
      floating: s.floating,
      ordem: s.ordem,
      recolhidos: s.recolhidos,
      autoQuality: s.autoQuality,
      targetFps: s.targetFps,
      recordAudio: s.recordAudio,
      ferramentas: s.ferramentas,
      player: s.player,
      ringCapacity: s.ringCapacity,
      ringWidth: s.ringWidth,
      codecCapacity: s.codecCapacity,
      codecWidth: s.codecWidth,
    }));
  } catch (_) {
    // modo privado / storage bloqueado: seguir sem persistir
  }
}

export function restore() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}
