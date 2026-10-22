/**
 * workspace.js — o app depois do login: fonte, executor, viewport, barra
 * flutuante e painéis.
 *
 * Só amarra as peças. Nenhuma regra de CV vive aqui.
 *
 * NÃO é importado estaticamente por app.js: a tela de login não precisa de
 * registry, operadores nem painéis (eram ~150 módulos e 0,85 MB comprimidos
 * antes do primeiro formulário). app.js mostra o AccessGate e importa este
 * arquivo com import() — em segundo plano assim que o login pinta, e de
 * novo (já resolvido) quando a sessão chega. Daqui em diante este componente
 * fica montado: o logout e a revogação da sessão voltam a mostrar o
 * AccessGate POR AQUI, como antes, sem desmontar câmera, buffer e executor.
 *
 * Layout: painéis moram em COLUNAS laterais (flex, então não se sobrepõem
 * por construção). Quantas colunas, de que lado e com que largura é decisão
 * de layout/organizador.js, a partir do tamanho real da janela — nunca
 * invadindo a área central do vídeo. Arrastar o cabeçalho solta o painel da
 * coluna; "Organizar" replaneja tudo (colunas e widgets).
 *
 * As Ferramentas de mouse e a barra de vídeo (Player) são ÁREAS RESERVADAS
 * para o planejador: medidas aqui (e de novo quando um widget é solto,
 * evento 'aiv:widget-movido'), as colunas se afastam delas. Clique direito no
 * fundo da tela abre o menu da tela (layout/menu-tela.js).
 */

import { html, useRef, useState, useEffect, useCallback } from './vendor.js';
import { store, useStore, persist, restore, LAYOUT_VERSION } from './state/store.js';
import { useNarrow, railTop } from './state/breakpoint.js';
import { planejar, aplicarPlano, estiloColuna, medirNaturais, organizar } from './layout/organizador.js';
import { ligarTela } from './layout/menu-tela.js';
import { CameraSource, FileSource, preflight } from './camera/device.js';
import { StreamSource, PADRAO as STREAM_PADRAO } from './camera/stream.js';
import { ScreenSource } from './camera/screen.js';
import { YouTubeSource } from './camera/youtube.js';
import { ligarTeclasMidia } from './camera/youtube-midia.js';
import { fila as filaYt } from './youtube/fila.js';
import { definirUsuario as playlistsDoUsuario } from './youtube/playlists.js';
import { PipelineExecutor } from './cv/executor.js';
import { MenuBar } from './components/MenuBar.js';
import { Viewport } from './components/Viewport.js';
import {
  ModulesPanel, PipelinePanel, SourcePanel, StatsPanel, ExportPanel, ModelsPanel,
} from './components/Panels.js';
import { AuthPanel } from './components/AuthPanel.js';
import { AccessGate } from './components/AccessGate.js';
import * as api from './auth/api.js';
import { ConfigPanel, preloadSalvos } from './components/ConfigPanel.js';
import { CoisasPanel } from './components/CoisasPanel.js';
import { VideoControls } from './components/VideoControls.js';
import { FerramentasMouse } from './components/FerramentasMouse.js';
import { CodePanel } from './components/CodePanel.js';
import { codeLog } from './cv/operators/code.js';
import { FrameRing } from './cv/ringbuffer.js';
import { createRing } from './cv/codecring.js';
import { painelSobDemanda, telaSobDemanda, sobDemanda } from './components/SobDemanda.js';
import { definirFonte as fonteBeltScan } from './cv/runtime/livres-k/canal.js';
import { definirFonte as fonteTakt } from './cv/runtime/livres-m/canal.js';
import { definirUsuario as viaDoUsuario, alternarVia } from './via/base.js';
import { definirUsuario as projetoDoUsuario } from './projeto/base.js';
import { registrarFonteApp } from './camera/fonte-app.js';

/*
 * Carregados SÓ AO ABRIR (components/SobDemanda.js): esportes, Bike Fit,
 * Studio, Bike Fit 3D, Contexto e Legendas. Só abrem por clique (barra, hub
 * Esportes, preset do Pipeline, atalho) ou porque estavam abertos ao
 * recarregar — em todos os casos o painel monta e o import() parte dali.
 */
const BikeFitPanel = painelSobDemanda(() => import('./components/BikeFitPanel.js'), 'BikeFitPanel', 'bikefit', 'Bike Fit');
const ErgonomiaPanel = painelSobDemanda(() => import('./components/esportes/ErgonomiaPanel.js'), 'ErgonomiaPanel', 'ergonomia', 'Ergonomia');
const AcademiaPanel = painelSobDemanda(() => import('./components/esportes/AcademiaPanel.js'), 'AcademiaPanel', 'academia', 'Academia');
const SaltoPanel = painelSobDemanda(() => import('./components/esportes/SaltoPanel.js'), 'SaltoPanel', 'salto', 'Salto');
const CorridaPanel = painelSobDemanda(() => import('./components/esportes/CorridaPanel.js'), 'CorridaPanel', 'corrida', 'Corrida');
const SwingPanel = painelSobDemanda(() => import('./components/esportes/SwingPanel.js'), 'SwingPanel', 'swing', 'Swing');
const VbtPanel = painelSobDemanda(() => import('./components/esportes/VbtPanel.js'), 'VbtPanel', 'vbt', 'VBT');
const QuadraPanel = painelSobDemanda(() => import('./components/esportes/QuadraPanel.js'), 'QuadraPanel', 'quadra', 'Quadra');
const EsportesPanel = painelSobDemanda(() => import('./components/esportes/EsportesPanel.js'), 'EsportesPanel', 'esportes', 'Esportes');
const ContextPanel = painelSobDemanda(() => import('./components/ContextPanel.js'), 'ContextPanel', 'context', 'Contexto');
const CaptionsPanel = painelSobDemanda(() => import('./components/CaptionsPanel.js'), 'CaptionsPanel', 'captions', 'Legendas');
const StudioBikeFit = telaSobDemanda(() => import('./components/esportes/StudioBikeFit.js'), 'StudioBikeFit', 'sbf', 'GPlanSiS|StudioBikeFit');
const BikeFit3D = telaSobDemanda(() => import('./components/esportes/BikeFit3D.js'), 'BikeFit3D', 'bf3d', 'GPlanSiS|BikeFit3D');
// Industrial (CV-36): hub, painel BeltScan e a tela cheia GPlanSiS|BeltScan — também sob demanda
const IndustrialPanel = painelSobDemanda(() => import('./components/industrial/IndustrialPanel.js'), 'IndustrialPanel', 'industrial', 'Industrial');
const BeltScanPanel = painelSobDemanda(() => import('./components/industrial/BeltScanPanel.js'), 'BeltScanPanel', 'beltscan', 'BeltScan');
const StudioBeltScan = telaSobDemanda(() => import('./components/industrial/StudioBeltScan.js'), 'StudioBeltScan', 'bsc', 'GPlanSiS|BeltScan');
// CV-38 Contagem em esteira (CounterVision): painel e a tela cheia GPlanSiS|CounterVision, sob demanda
const CounterPanel = painelSobDemanda(() => import('./components/industrial/CounterPanel.js'), 'CounterPanel', 'contador', 'Contagem em esteira');
const StudioCounter = telaSobDemanda(() => import('./components/industrial/StudioCounter.js'), 'StudioCounter', 'cvs', 'GPlanSiS|CounterVision');
// Industrial (CV-39): painel Tempo de posto e a tela cheia GPlanSiS|Takt — sob demanda
const TaktPanel = painelSobDemanda(() => import('./components/industrial/TaktPanel.js'), 'TaktPanel', 'takt', 'Tempo de posto');
const StudioTakt = telaSobDemanda(() => import('./components/industrial/StudioTakt.js'), 'StudioTakt', 'tkt', 'GPlanSiS|Takt');
// onda 1-b: CV-46 OEE (painel + GPlanSiS|OEE), CV-48 Monitor de EPI (painel), CV-47 Fisio (painel + GPlanSiS|Fisio) — sob demanda
const OEEPanel = painelSobDemanda(() => import('./components/industrial/OEEPanel.js'), 'OEEPanel', 'oee', 'OEE');
const StudioOEE = telaSobDemanda(() => import('./components/industrial/StudioOEE.js'), 'StudioOEE', 'bsc', 'GPlanSiS|OEE');
const EPIPanel = painelSobDemanda(() => import('./components/industrial/EPIPanel.js'), 'EPIPanel', 'epi', 'EPI');
const FisioPanel = painelSobDemanda(() => import('./components/saude/FisioPanel.js'), 'FisioPanel', 'fisio', 'Fisio');
const StudioFisio = telaSobDemanda(() => import('./components/saude/StudioFisio.js'), 'StudioFisio', 'bsc', 'GPlanSiS|Fisio');
// onda 2-c (CV-70..77): painel Saúde e esportes+ e a tela cheia GPlanSiS|Vitais — sob demanda
const SaudeEsportesPanel = painelSobDemanda(() => import('./components/saude/SaudeEsportesPanel.js'), 'SaudeEsportesPanel', 'onda2c', 'Saúde e esportes+');
const StudioOnda2c = telaSobDemanda(() => import('./components/saude/StudioOnda2c.js'), 'StudioOnda2c', 'bsc', 'GPlanSiS|Vitais');
// CV-40 Inspeção visual (Inspect): painel e a tela cheia GPlanSiS|Inspect, sob demanda (a reserva usa o fundo da .bsc)
// +Projeto: modelo novo a partir das marcações (prints, caixas, Treinar, Pipeline) — sob demanda
const ProjetoPanel = painelSobDemanda(() => import('./components/ProjetoPanel.js'), 'ProjetoPanel', 'projeto', '+Projeto');
// Onda 1-a: painel Medições (CVC, instrumentos, segurança por pose, fotocélula, mapa de calor, logística) — sob demanda
const MedicoesPanel = painelSobDemanda(() => import('./components/MedicoesPanel.js'), 'MedicoesPanel', 'medicoes', 'Medições');
// Onda 2-d: painel Aplicações (física, acessibilidade, Libras, sala, mídia, agro, jogo, obra — CV-80..87) — sob demanda
const AplicacoesPanel = painelSobDemanda(() => import('./components/livres-u/AplicacoesPanel.js'), 'AplicacoesPanel', 'aplicacoes', 'Aplicações');
const InspectPanel = painelSobDemanda(() => import('./components/industrial/InspectPanel.js'), 'InspectPanel', 'inspecao', 'Inspeção visual');
const StudioInspect = telaSobDemanda(() => import('./components/industrial/StudioInspect.js'), 'StudioInspect', 'bsc', 'GPlanSiS|Inspect');
// Editor de vídeo GPlanSiS|Vídeo (✂ na barra de vídeo): sob demanda; a reserva usa o fundo da .bsc (o CSS do editor vem com ele)
const StudioVideo = telaSobDemanda(() => import('./components/video/StudioVideo.js'), 'StudioVideo', 'bsc', 'GPlanSiS|Vídeo');
// widget flutuante "Seção da correia": só é baixado quando há nó BeltScan ligado (reserva vazia)
const WidgetSecaoCorreia = sobDemanda(() => import('./components/industrial/WidgetSecaoCorreia.js'), 'WidgetSecaoCorreia', () => null);
/*
 * Via (assistente de IA, js/via/): gaveta à direita, fora das colunas. O chat
 * e o SDK da Anthropic só baixam quando ela abre. A reserva já é a gaveta,
 * no mesmo lugar, com «carregando…» e o ✕.
 */
const ViaPainel = sobDemanda(() => import('./via/ViaPainel.js'), 'ViaPainel', (props, erro, tentar) => html`
  <section class="panel via-gaveta" role="dialog" aria-label="Via">
    <header class="panel-head via-head">
      <div class="panel-title"><b>Via</b><em>carregando…</em></div>
      <button class="panel-x" onClick=${props.onClose} title="Fechar" aria-label="Fechar a Via">✕</button>
    </header>
    <div class="panel-body">
      ${erro
        ? html`<p class="hint tight" role="alert" data-sob-demanda="erro">Não consegui carregar a Via${erro.message ? ` (${erro.message})` : ''}.</p>
               <button class="btn" onClick=${tentar}>Tentar de novo</button>`
        : html`<p class="hint tight" role="status" data-sob-demanda="">carregando…</p>`}
    </div>
  </section>
`);

/** Ordem de empilhamento dentro de cada coluna. */
const RAIL_ORDER = ['modules', 'models', 'coisas', 'esportes', 'bikefit', 'ergonomia', 'academia', 'salto', 'corrida', 'swing', 'vbt', 'quadra',
                    'industrial', 'beltscan', 'contador', 'takt', 'oee', 'epi', 'fisio', 'onda2c', 'inspecao', 'medicoes', 'aplicacoes', 'projeto', 'config', 'camera', 'auth',
                    'context', 'codes', 'captions', 'pipeline', 'stats', 'export'];
/*
 * Coluna padrão dos painéis que ainda não estão no `dock` do store (os do
 * Industrial): sem isto um painel novo só apareceria no celular.
 */
const DOCK_EXTRA = { industrial: 'right', beltscan: 'right', contador: 'right', takt: 'right', oee: 'right', epi: 'right', fisio: 'right', onda2c: 'right', inspecao: 'right', medicoes: 'right', aplicacoes: 'right', projeto: 'right' };

/*
 * Disposição padrão dos widgets (versão 2): Ferramentas de mouse colada na
 * borda esquerda, logo abaixo da barra do topo, e Player em FAIXA FINA
 * centrado embaixo, acima da linha de atalhos. Quem tinha posições guardadas
 * da disposição antiga recebe a nova UMA vez (a chave marca a versão); daí em
 * diante vale o que a pessoa mover. Antes dos componentes montarem.
 */
const WIDGETS_VERSAO = '2';
try {
  if (typeof window !== 'undefined' && localStorage.getItem('aiv.layout.widgets') !== WIDGETS_VERSAO) {
    localStorage.setItem('aiv.layout.widgets', WIDGETS_VERSAO);
    localStorage.removeItem('gplansis.ferramentas.pos');
    localStorage.removeItem('gplansis.videoctl.pos');
    localStorage.setItem('gplansis.videoctl.mini', '1');
    if (window.innerWidth > 600) localStorage.removeItem('gplansis.ferramentas.mini');
  }
} catch (_) { /* storage bloqueado: segue com o padrão dos widgets */ }

/*
 * Celular: barra de vídeo e Ferramentas de mouse começam RECOLHIDAS (uma vez
 * por aparelho; depois vale o que a pessoa escolher). Antes dos componentes
 * montarem, porque eles leem a chave no primeiro render.
 */
try {
  if (typeof window !== 'undefined' && window.innerWidth <= 600 && !localStorage.getItem('aiv.layout.miniPadrao')) {
    localStorage.setItem('aiv.layout.miniPadrao', '1');
    if (localStorage.getItem('gplansis.videoctl.mini') == null) localStorage.setItem('gplansis.videoctl.mini', '1');
    if (localStorage.getItem('gplansis.ferramentas.mini') == null) localStorage.setItem('gplansis.ferramentas.mini', '1');
  }
} catch (_) { /* storage bloqueado: segue com o padrão dos widgets */ }

export function App({ sessao = null }) {
  /*
   * A tela de acesso cobre o app enquanto não há sessão. O Viewport continua
   * montado ATRÁS dela: a câmera precisa estar rodando para o login facial
   * funcionar, e o fundo vivo é o próprio design da tela.
   *
   * Este componente só monta DEPOIS do primeiro login (app.js), já com a
   * sessão em mãos; daí em diante ela é daqui, como sempre foi.
   */
  const [session, setSession] = useState(sessao);
  // playlists do YouTube são por conta: cada usuário logado vê as suas (youtube/playlists.js)
  useEffect(() => {
    const u = session && session.user;
    playlistsDoUsuario(u && (u.id != null ? u.id : u.email));
    viaDoUsuario(u && (u.id != null ? u.id : u.email));   // chave e comandos da Via também são por conta
    projetoDoUsuario(u && (u.id != null ? u.id : u.email));   // projetos e prints do +Projeto (IndexedDB) também
  }, [session]);
  // modelos marcados em Config › Modelos livres › "ao iniciar"
  useEffect(() => { if (session) preloadSalvos(); }, [session]);

  /*
   * Revalidação periódica. A sessão é do SERVIDOR: se um administrador
   * revogar a permissão do módulo em gplansis.com, o /api/me devolve
   * "não autenticado" na próxima checagem e o gate volta. Sem isto, a
   * revogação só teria efeito quando a aba fosse recarregada.
   */
  useEffect(() => {
    if (!session) return;
    const t = setInterval(async () => {
      const r = await api.me();
      if (!r.authenticated && !r.offline) setSession(null);
    }, 120000);
    return () => clearInterval(t);
  }, [session]);

  const s = useStore(store, (st) => ({
    panels: st.panels,
    notice: st.notice,
    dock: st.dock,
    floating: st.floating,
    ordem: st.ordem,
    recolhidos: st.recolhidos,
    studioBikeFit: st.studioBikeFit,
    bikeFit3D: st.bikeFit3D,
    studioBeltScan: st.studioBeltScan,
    studioInspect: st.studioInspect,
    studioCounter: st.studioCounter,
    studioTakt: st.studioTakt,
    studioOEE: st.studioOEE,
    studioFisio: st.studioFisio,
    studioOnda2c: st.studioOnda2c,
    studioVideo: st.studioVideo,
    beltScanAtivo: st.nodes.some((n) => n.op === 'beltscan.volumetria' && n.enabled),
    player: st.player !== false,
  }));

  const narrow = useNarrow();

  /*
   * Geometria que o planejador usa: janela, base da barra do topo e, fora do
   * computador, o topo da barra de vídeo (a coluna termina acima dela).
   * Remedida em resize, quando a barra republica --rail-top e a cada 800 ms
   * (conteúdo de painel cresce sem evento nenhum).
   */
  const [geo, setGeo] = useState(() => ({ W: window.innerWidth, H: window.innerHeight, topo: railTop(), fundo: null, reservas: [] }));
  const [, setVersaoNat] = useState(0);
  const [avisoLayout, setAvisoLayout] = useState(null);
  const avisoT = useRef(null);
  useEffect(() => {
    const atualiza = () => {
      const W = window.innerWidth, H = window.innerHeight, topo = railTop();
      let fundo = null;
      if (W < 1000) {
        const vc = document.querySelector('.vctl');
        const r = vc && vc.getBoundingClientRect();
        fundo = r && r.height && r.top > topo ? Math.max(10, Math.round(H - r.top + 8)) : 10;
      }
      setGeo((g) => {
        // áreas reservadas: Ferramentas e Player como estão pintados (durante um arrasto, vale a de antes)
        const reservas = [];
        for (const [sel, tipo] of [['.ferr', 'ferr'], ['.vctl', 'player']]) {
          const el = document.querySelector(sel);
          if (el && el.classList.contains('dragging')) { const v = (g.reservas || []).find((x) => x.tipo === tipo); if (v) reservas.push(v); continue; }
          const r = el && el.getBoundingClientRect();
          if (r && r.width > 2 && r.height > 2) reservas.push({ tipo, x0: Math.round(r.left), y0: Math.round(r.top), x1: Math.round(r.right), y1: Math.round(r.bottom) });
        }
        const igual = g.W === W && g.H === H && g.topo === topo && g.fundo === fundo && JSON.stringify(g.reservas) === JSON.stringify(reservas);
        return igual ? g : { W, H, topo, fundo, reservas };
      });
      if (medirNaturais()) setVersaoNat((n) => n + 1);
    };
    atualiza();
    const t = setInterval(atualiza, 800);
    // um widget foi solto, recolhido ou devolvido ao lugar: remede no quadro seguinte (já pintado)
    const movido = () => requestAnimationFrame(() => requestAnimationFrame(atualiza));
    window.addEventListener('resize', atualiza);
    window.addEventListener('railtop', atualiza);
    window.addEventListener('aiv:widget-movido', movido);
    window.addEventListener('aiv:organizar', movido);
    return () => {
      clearInterval(t);
      window.removeEventListener('resize', atualiza); window.removeEventListener('railtop', atualiza);
      window.removeEventListener('aiv:widget-movido', movido); window.removeEventListener('aiv:organizar', movido);
    };
  }, []);

  const camera = useRef(null);
  const file = useRef(null);
  const source = useRef(null);
  const executor = useRef(null);
  const snapshot = useRef(() => {});
  const authCanvas = useRef(null);
  const displayCanvas = useRef(null);
  const stream = useRef(null);
  const screen = useRef(null);
  const youtube = useRef(null);
  const ring = useRef(null);

  if (!camera.current) {
    camera.current = new CameraSource();
    file.current = new FileSource();
    stream.current = new StreamSource();
    screen.current = new ScreenSource();
    youtube.current = new YouTubeSource();
    // botão de loop da barra de vídeo também vale para o arquivo
    file.current.video.loop = store.get().loop !== false;
    store.subscribe((st) => { file.current.video.loop = st.loop !== false; });
    // teclas de mídia do teclado (Windows/macOS/Linux) e controle de mídia do sistema → player do YouTube
    ligarTeclasMidia(youtube.current);
    // playlist tocando em sequência: o fim de um vídeo carrega o próximo (youtube/fila.js)
    filaYt.ligar(youtube.current);
    source.current = camera.current;
    // o BeltScan integra vazão no tempo do VÍDEO quando a fonte é arquivo (runtime/livres-k/canal.js)
    fonteBeltScan(source);
    fonteTakt(source);   // o Takt também mede no tempo do vídeo (runtime/livres-m/canal.js)
    executor.current = new PipelineExecutor();
    /*
     * Começa com o buffer não comprimido, que é síncrono e nunca falha.
     * A troca para o buffer com WebCodecs é feita logo abaixo, de forma
     * assíncrona: sondar suporte de codec exige await, e a app não pode
     * esperar por isso para desenhar o primeiro frame.
     */
    ring.current = new FrameRing({
      capacity: store.get().ringCapacity,
      width: store.get().ringWidth,
    });
  }

  // ---------------------------------------------------------- câmera

  const startCamera = useCallback(async (deviceId, res) => {
    const pf = preflight();
    if (!pf.ok) {
      store.set({ notice: pf.message, panels: { ...store.get().panels, camera: true } });
      return;
    }
    const st = store.get();
    try {
      store.set({ notice: null });
      await camera.current.start({
        deviceId: deviceId !== undefined ? deviceId : st.deviceId,
        ...(res || st.resolution),
      });
      // vindo de outra fonte: solta a anterior (a tela seguia compartilhada e o arquivo decodificando)
      const antes = source.current;
      if (antes === screen.current) screen.current.stop();
      if (antes === stream.current) stream.current.disconnect();
      if (antes === file.current) soltarArquivo();
      source.current = camera.current;
      store.set({
        cameraOn: true,
        sourceKind: 'camera',
        devices: camera.current.devices,
        deviceId: camera.current.activeDeviceId,
      });
    } catch (err) {
      store.set({
        // troca a quente que falhou: a câmera anterior continua ligada (camera/device.js)
        cameraOn: source.current === camera.current && camera.current.isRunning,
        notice: err.message,
        panels: { ...store.get().panels, camera: true },
      });
    }
  }, []);

  const stopCamera = useCallback(() => {
    camera.current.stop();
    store.set({ cameraOn: false });
  }, []);

  /*
   * Outra fonte assumiu: para o vídeo do arquivo (senão segue em loop, mudo, decodificando).
   * Com atraso: o laço do Viewport pode estar esperando o próximo requestVideoFrameCallback
   * DESTE vídeo — pausado na hora, esse callback nunca vem e o laço trava.
   */
  const soltarArquivo = () => {
    setTimeout(() => {
      if (source.current !== file.current) { file.current.video.pause(); file.current.release(); }
    }, 400);
  };

  const pickFile = useCallback(async (f) => {
    try {
      await file.current.load(f);
      camera.current.stop();
      // a tela e o stream também: senão seguiam capturando por baixo do arquivo
      if (source.current === screen.current) screen.current.stop();
      if (source.current === stream.current) stream.current.disconnect();
      source.current = file.current;
      executor.current.resetState();
      store.set({ sourceKind: 'file', cameraOn: false, notice: null });
    } catch (err) {
      store.set({ notice: 'Falha ao abrir arquivo: ' + err.message });
    }
  }, []);

  /*
   * Frame atual como ImageData, para o módulo de autenticação.
   * Captura numa resolução própria (640 de largura), independente da
   * `procWidth` do pipeline: reconhecimento facial precisa de detalhe, e
   * seria péssimo o login degradar porque alguém baixou a qualidade para
   * ganhar fps.
   */
  const getFrame = useCallback(() => {
    const src = source.current;
    const el = src && src.element;
    if (!el) return null;
    const size = src.size;
    if (!size.width || !size.height) return null;

    const W = Math.min(640, size.width);
    const H = Math.round((W * size.height) / size.width);
    if (!authCanvas.current) authCanvas.current = document.createElement('canvas');
    const c = authCanvas.current;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const st = store.get();
    ctx.save();
    if (st.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    try { ctx.drawImage(el, 0, 0, W, H); } catch (_) { ctx.restore(); return null; }
    ctx.restore();
    return ctx.getImageData(0, 0, W, H);
  }, []);

  /*
   * Leitura nova abre o painel de Códigos.
   *
   * Só ABRE — nunca fecha nem rouba foco de painel já aberto. Quem fechou
   * de propósito e continua escaneando veria a janela reaparecer a cada
   * bipe, o que é pior que não abrir nunca.
   */
  useEffect(() => {
    codeLog.onNew = () => {
      if (!store.get().panels.codes) {
        store.set((st) => ({ panels: { ...st.panels, codes: true } }));
        persist();
      }
    };
    return () => { codeLog.onNew = null; };
  }, []);

  /* Atalho do manifest: /?m=codes abre direto no leitor. */
  useEffect(() => {
    const m = new URLSearchParams(location.search).get('m');
    if (m && ['codes', 'context', 'config', 'camera', 'captions'].includes(m)) {
      store.set((st) => ({ panels: { ...st.panels, [m]: true } }));
      // limpa a query: recarregar não deve reabrir o que o usuário fechou
      history.replaceState(null, '', location.pathname);
    }
  }, []);

  useEffect(() => {
    window.__vlcStartCamera = () => startCamera();
    return () => { delete window.__vlcStartCamera; };
  }, [startCamera]);

  /*
   * Ações de fonte para os Studios (camera/fonte-app.js → components/studio/
   * FonteStudio.js): trocar câmera, arquivo, tela e YouTube sem sair da tela
   * cheia. Também liga o aviso de câmera desconectada e a reconexão.
   */
  useEffect(() => {
    registrarFonteApp({
      source, camera, youtube, stream, screen,
      ligarCamera: (id, res) => startCamera(id, res),
      pararCamera: () => { camera.current.stop(); store.set({ cameraOn: false }); },
      abrirArquivo: (f) => pickFile(f),
      ligarTela: () => startScreenRef.current(),
      pararTela: () => stopScreenRef.current(),
      ligarYouTube: () => startYouTubeRef.current(),
      pararYouTube: () => stopYouTubeRef.current(),
      conectarStream: (cfg) => connectStreamRef.current(cfg),
      desconectarStream: () => disconnectStreamRef.current(),
    });
    return () => registrarFonteApp(null);
  }, [startCamera, pickFile]);
  // as ações abaixo são declaradas depois; o registro lê sempre a versão atual
  const startScreenRef = useRef(null), stopScreenRef = useRef(null);
  const startYouTubeRef = useRef(null), stopYouTubeRef = useRef(null);
  const connectStreamRef = useRef(null), disconnectStreamRef = useRef(null);

  // ---------------------------------------------------------- sessão

  useEffect(() => {
    const saved = restore();
    if (saved) {
      const base = store.get();
      /*
       * Disposição antiga é descartada quando o padrão muda. Preferências
       * que não são layout (pipeline, qualidade, espelho) sobrevivem — só o
       * arranjo das colunas é redefinido.
       */
      const layoutAtual = saved.layoutVersion === LAYOUT_VERSION;
      if (!layoutAtual) {
        store.set({ notice: 'A disposição padrão dos painéis foi atualizada.' });
      }
      store.set({
        nodes: Array.isArray(saved.nodes) ? saved.nodes : [],
        procWidth: saved.procWidth || 480,
        mirror: saved.mirror !== undefined ? saved.mirror : true,
        resolution: saved.resolution || { width: 640, height: 480 },
        panels: { ...base.panels, ...(saved.panels || {}) },
        dock: layoutAtual ? { ...base.dock, ...(saved.dock || {}) } : base.dock,
        floating: layoutAtual ? (saved.floating || {}) : {},
        ordem: Array.isArray(saved.ordem) ? saved.ordem : [],
        recolhidos: layoutAtual && saved.recolhidos ? saved.recolhidos : {},
        autoQuality: saved.autoQuality !== undefined ? saved.autoQuality : true,
        targetFps: saved.targetFps || 30,
        ferramentas: saved.ferramentas !== false,
        player: saved.player !== false,
      });
    }
    camera.current.listDevices().then((d) => store.set({ devices: d }));
    CameraSource.hasMultipleCameras().then((m) => store.set({ hasMultiCam: m }));
  }, []);

  // sobe para o buffer comprimido quando o navegador tem WebCodecs
  useEffect(() => {
    let alive = true;
    const st = store.get();
    createRing(FrameRing, {
      capacity: st.ringCapacity,
      width: st.ringWidth,
      codecCapacity: st.codecCapacity,
      codecWidth: st.codecWidth,
      bitrate: st.codecBitrate,
    }).then((r) => {
      if (!alive || !r) return;
      if (r !== ring.current) {
        ring.current.clear();
        ring.current = r;
        store.set({ ringKind: r.info ? 'codec' : 'raw' });
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // o buffer é recriado quando a configuração muda; conteúdo antigo não serve
  const ringCfg = useStore(store, (st) => ({ cap: st.ringCapacity, w: st.ringWidth }));
  useEffect(() => {
    if (ring.current) ring.current.resize(ringCfg.cap, ringCfg.w);
  }, [ringCfg.cap, ringCfg.w]);

  // ---------------------------------------------------------- ações

  const toggleRun = useCallback(() => store.set((st) => ({ running: !st.running })), []);
  const toggleCompare = useCallback(() => store.set((st) => ({ compare: !st.compare })), []);
  const resetState = useCallback((nodeId) => executor.current.resetState(nodeId), []);

  const flipCamera = useCallback(async () => {
    const st = store.get();
    if (!st.cameraOn) return startCamera();
    try {
      await camera.current.flip(st.resolution.width, st.resolution.height);
      if (ring.current) ring.current.clear();
      store.set({
        facing: camera.current.facing,
        devices: camera.current.devices,
        deviceId: camera.current.activeDeviceId,
        // a traseira não é selfie: espelhar inverteria texto e placas
        mirror: camera.current.facing !== 'environment',
      });
    } catch (err) {
      store.set({ notice: err.message });
    }
  }, [startCamera]);

  const connectStream = useCallback(async (cfg) => {
    try {
      store.set({ notice: null });
      await stream.current.connect(cfg);
      camera.current.stop();
      soltarArquivo();   // o arquivo não fica decodificando em loop
      source.current = stream.current;
      executor.current.resetState();
      if (ring.current) ring.current.clear();
      store.set({
        sourceKind: 'stream', cameraOn: false, running: true,
        // stream de câmera externa não é selfie: espelhar inverteria texto
        mirror: false,
        notice: null,
      });
    } catch (err) {
      store.set({ notice: err.message });
      throw err;
    }
  }, []);

  /*
   * Captura de tela como fonte. Mesmo caminho do stream: troca a fonte, zera
   * o estado dos operadores e o buffer. Espelho DESLIGADO — espelhar uma
   * tela inverte o texto que o OCR devia ler.
   */
  const startScreen = useCallback(async () => {
    try {
      store.set({ notice: null });
      await screen.current.start();
      camera.current.stop();
      stream.current.disconnect();
      soltarArquivo();
      source.current = screen.current;
      executor.current.resetState();
      if (ring.current) ring.current.clear();
      store.set({ sourceKind: 'screen', cameraOn: false, running: true, mirror: false, notice: null });
    } catch (err) {
      store.set({ notice: err.message });
    }
  }, []);

  const stopScreen = useCallback(() => {
    screen.current.stop();
    source.current = camera.current;
    if (ring.current) ring.current.clear();
    store.set({ sourceKind: 'camera', running: false });
  }, []);

  // a pessoa parou pela barra do navegador: a interface precisa acompanhar
  useEffect(() => {
    screen.current.onEnded = () => {
      if (store.get().sourceKind === 'screen') {
        stopScreen();
        store.set({ notice: 'Compartilhamento de tela encerrado.' });
      }
    };
    return () => { screen.current.onEnded = null; };
  }, [stopScreen]);

  /*
   * Vídeo do YouTube como fonte (camera/youtube.js): o player oficial toca na
   * área da câmera e a captura da própria aba, recortada no player, entra no
   * pipeline como a captura de tela. Nada é baixado. Espelho desligado.
   */
  const startYouTube = useCallback(async () => {
    store.set({ notice: null });
    await youtube.current.start();
    camera.current.stop();
    stream.current.disconnect();
    screen.current.stop();
    soltarArquivo();
    source.current = youtube.current;
    executor.current.resetState();
    if (ring.current) ring.current.clear();
    store.set({ sourceKind: 'youtube', cameraOn: false, running: true, mirror: false, notice: null });
  }, []);

  const stopYouTube = useCallback(() => {
    youtube.current.stop();
    source.current = camera.current;
    if (ring.current) ring.current.clear();
    store.set({ sourceKind: 'camera', running: false });
  }, []);

  useEffect(() => {
    youtube.current.onEnded = () => {
      if (store.get().sourceKind === 'youtube') {
        stopYouTube();
        store.set({ notice: 'Captura do YouTube encerrada.' });
      }
    };
    // outra fonte assumiu (câmera, arquivo, tela, RTMP): solta a captura e o player.
    // Só na TROCA de youtube para outra — durante o start() o tipo ainda é o antigo.
    let antes = store.get().sourceKind;
    const off = store.subscribe((st) => {
      if (antes === 'youtube' && st.sourceKind !== 'youtube') youtube.current.stop();
      antes = st.sourceKind;
    });
    return () => { youtube.current.onEnded = null; off(); };
  }, [stopYouTube]);

  const disconnectStream = useCallback(() => {
    stream.current.disconnect();
    source.current = camera.current;
    if (ring.current) ring.current.clear();
    store.set({ sourceKind: 'camera', running: false });
  }, []);

  const stopSource = useCallback(() => {
    camera.current.stop();
    stream.current.disconnect();
    screen.current.stop();
    youtube.current.stop();
    if (ring.current) ring.current.clear();
    // YouTube parado pela barra: volta o tipo para câmera (senão o painel segue «YouTube ativo»)
    if (store.get().sourceKind === 'youtube') {
      source.current = camera.current;
      store.set({ cameraOn: false, running: false, sourceKind: 'camera' });
    } else {
      store.set({ cameraOn: false, running: false });
    }
  }, []);

  startScreenRef.current = startScreen; stopScreenRef.current = stopScreen;
  startYouTubeRef.current = startYouTube; stopYouTubeRef.current = stopYouTube;
  connectStreamRef.current = connectStream; disconnectStreamRef.current = disconnectStream;

  const reloadSource = useCallback(() => {
    executor.current.resetState();
    if (ring.current) ring.current.clear();
    store.set({ running: true });
    const st = store.get();
    if (st.sourceKind === 'camera' && st.cameraOn) startCamera();
  }, [startCamera]);

  const doLogout = useCallback(async () => {
    camera.current.stop();
    screen.current.stop();
    youtube.current.stop();
    if (ring.current) ring.current.clear();
    store.set({ cameraOn: false });
    try { await api.logout(); } catch (_) { /* segue e limpa mesmo assim */ }
    setSession(null);
  }, []);

  /*
   * Organizar (menu do avatar, tecla o): devolve os soltos às colunas,
   * esquece recolhimentos, replaneja as colunas do zero e manda os widgets
   * (barra de vídeo, Ferramentas, Seção da correia) voltarem ao lugar
   * automático — eles escutam 'aiv:organizar'.
   */
  const tidy = useCallback(() => {
    organizar();
    store.set({ floating: {}, recolhidos: {} });
    window.dispatchEvent(new CustomEvent('aiv:organizar'));
    persist();
  }, []);

  // menu da tela (clique direito no fundo): as ações que dependem do workspace
  useEffect(() => {
    ligarTela({
      ligarCamera: () => startCamera(),
      abrirArquivo: (f) => pickFile(f),
      capturarTela: () => startScreen(),
      comparar: () => toggleCompare(),
      capturarPng: () => snapshot.current(),
      organizar: () => tidy(),
    });
    return () => ligarTela(null);
  }, [startCamera, pickFile, startScreen, toggleCompare, tidy]);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      // ⇧B mostra/esconde o Player (os Shift+letra livres ficam para as ferramentas de mouse)
      if (e.shiftKey && k === 'b') { store.set((st) => ({ player: st.player === false })); persist(); return; }
      if (k === ' ') { e.preventDefault(); toggleRun(); }
      else if (k === 'c') toggleCompare();
      else if (k === 's') snapshot.current();
      else if (k === 'o') tidy();
      else if (k === 'm') togglePanel('modules');
      else if (k === 'd') togglePanel('models');
      else if (k === 'p') togglePanel('pipeline');
      else if (k === 'f') togglePanel('camera');
      else if (k === 't') togglePanel('stats');
      else if (k === 'e') togglePanel('export');
      else if (k === 'a') togglePanel('auth');
      else if (k === 'g') togglePanel('config');
      else if (k === 'x') togglePanel('context');
      else if (k === 'q') togglePanel('codes');
      else if (k === 'l') togglePanel('captions');
      else if (k === 'arrowleft') { if (ring.current) { ring.current.step(-1); store.set({ running: false }); } }
      else if (k === 'arrowright') { if (ring.current) { ring.current.step(1); if (ring.current.live) store.set({ running: true }); } }
      else if (k === 'escape') store.set({ notice: null, selectedNode: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRun, toggleCompare, tidy]);

  /*
   * Ctrl+K (⌘+K no Mac) abre/fecha a Via — de qualquer lugar, inclusive com o
   * foco num campo (é o atalho de "comando" dos apps web). As letras soltas e
   * Shift+letra ficam para os painéis e as ferramentas do mouse.
   */
  useEffect(() => {
    const onVia = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      alternarVia();
    };
    window.addEventListener('keydown', onVia);
    return () => window.removeEventListener('keydown', onVia);
  }, []);

  const closePanel = (id) => () => {
    store.set((st) => ({ panels: { ...st.panels, [id]: false } }));
    persist();
  };

  const undock = (id) => (pos) => {
    store.set((st) => ({ floating: { ...st.floating, [id]: pos } }));
    persist();
  };

  const movePanel = (id) => (pos) => {
    store.set((st) => ({ floating: { ...st.floating, [id]: pos } }));
    persist();
  };

  /** Monta as props de layout + as específicas de cada painel. */
  const build = (id) => {
    if (!s.panels[id]) return null;
    // No celular NENHUM painel flutua: uma posicao guardada no computador (ou
    // arrastada antes da barra crescer com a safe-area do iPhone) abria o
    // painel por cima da barra, sem jeito de recupera-lo. Ancorado, ele entra
    // na coluna unica, que comeca em --rail-top — abaixo da barra, por layout.
    const isFloating = !narrow && Boolean(s.floating[id]);
    const common = {
      key: id,
      onClose: closePanel(id),
      docked: !isFloating,
      onUndock: undock(id),
      onMove: movePanel(id),
      pos: s.floating[id],
    };
    switch (id) {
      case 'modules':  return html`<${ModulesPanel} ...${common} />`;
      case 'models':   return html`<${ModelsPanel} ...${common} />`;
      case 'pipeline': return html`<${PipelinePanel} ...${common} onResetState=${resetState} />`;
      case 'camera':   return html`
        <${SourcePanel} ...${common}
          onStartCamera=${startCamera}
          onStopCamera=${stopCamera}
          onPickFile=${pickFile}
          onStartScreen=${startScreen}
          onStopScreen=${stopScreen}
          onStartYouTube=${startYouTube}
          onStopYouTube=${stopYouTube}
          youtube=${youtube}
          onConnectStream=${connectStream}
          onDisconnectStream=${disconnectStream}
          stream=${stream} />`;
      case 'stats':    return html`<${StatsPanel} ...${common} />`;
      case 'config':   return html`<${ConfigPanel} ...${common} ring=${ring} />`;
      case 'coisas':   return html`<${CoisasPanel} ...${common} />`;
      case 'bikefit':  return html`<${BikeFitPanel} ...${common} />`;
      case 'ergonomia': return html`<${ErgonomiaPanel} ...${common} />`;
      case 'academia': return html`<${AcademiaPanel} ...${common} />`;
      case 'salto':    return html`<${SaltoPanel} ...${common} />`;
      case 'corrida':  return html`<${CorridaPanel} ...${common} />`;
      case 'swing':    return html`<${SwingPanel} ...${common} />`;
      case 'vbt':      return html`<${VbtPanel} ...${common} />`;
      case 'quadra':   return html`<${QuadraPanel} ...${common} />`;
      case 'esportes': return html`<${EsportesPanel} ...${common} />`;
      case 'industrial': return html`<${IndustrialPanel} ...${common} />`;
      case 'beltscan': return html`<${BeltScanPanel} ...${common} onPickFile=${pickFile} />`;
      case 'inspecao': return html`<${InspectPanel} ...${common} />`;
      case 'contador': return html`<${CounterPanel} ...${common} onPickFile=${pickFile} />`;
      case 'takt':     return html`<${TaktPanel} ...${common} />`;
      case 'oee':      return html`<${OEEPanel} ...${common} />`;
      case 'epi':      return html`<${EPIPanel} ...${common} />`;
      case 'fisio':    return html`<${FisioPanel} ...${common} />`;
      case 'onda2c':   return html`<${SaudeEsportesPanel} ...${common} />`;
      case 'medicoes': return html`<${MedicoesPanel} ...${common} />`;
      case 'aplicacoes': return html`<${AplicacoesPanel} ...${common} source=${source} />`;
      case 'projeto':  return html`<${ProjetoPanel} ...${common} />`;
      case 'context':  return html`<${ContextPanel} ...${common} getFrame=${getFrame} />`;
      case 'codes':    return html`<${CodePanel} ...${common} />`;
      case 'captions': return html`<${CaptionsPanel} ...${common} source=${source} />`;
      case 'export':   return html`<${ExportPanel} ...${common} onSnapshot=${() => snapshot.current()} />`;
      case 'auth':     return html`<${AuthPanel} ...${common} getFrame=${getFrame} session=${session} />`;
      default:         return null;
    }
  };

  /*
   * Colunas: o planejador (layout/organizador.js) recebe os painéis ancorados
   * abertos, do mais antigo ao mais novo, e devolve as colunas com posição e
   * largura. No celular é uma coluna só (acordeão); no tablet, uma estreita.
   */
  const ancorados = RAIL_ORDER.filter((id) => s.panels[id] && (narrow || !s.floating[id]));
  const ordem = Array.isArray(s.ordem) ? s.ordem : [];
  const idsPlano = [...ordem.filter((id) => ancorados.includes(id)), ...ancorados.filter((id) => !ordem.includes(id))];
  const recUsu = new Set(Object.keys(s.recolhidos || {}).filter((k) => s.recolhidos[k]));
  const plano = planejar({
    ...geo, ids: idsPlano, recUsu, via: Boolean(s.panels.via),
    lado: (id) => (/^left/.test(s.dock[id] || DOCK_EXTRA[id] || 'right') ? 'L' : 'R'),
  });
  const rails = plano.cols.map((c) => [c, RAIL_ORDER.filter((id) => c.ids.includes(id)).map(build).filter(Boolean)]);

  // depois de pintar: publica o plano (painéis e widgets leem), guarda a ordem e avisa o que recolheu
  useEffect(() => {
    const novos = aplicarPlano(plano);
    if (idsPlano.join() !== ordem.join()) { store.set({ ordem: idsPlano }); persist(); }
    if (novos.length && plano.modo !== 'celular') {
      const nomes = novos.map((id) => { const el = document.querySelector(`[data-painel="${id}"]`); return '«' + ((el && el.getAttribute('aria-label')) || id) + '»'; });
      // aviso próprio (não o store.notice: esse também aparece dentro do painel Fonte)
      setAvisoLayout(`Pouco espaço na tela: recolhi ${nomes.join(', ')} — ▸ no cabeçalho abre de novo.`);
      clearTimeout(avisoT.current);
      avisoT.current = setTimeout(() => setAvisoLayout(null), 4000);
    }
    // conteúdo que acabou de pintar muda a altura natural: mede no próximo quadro
    const id = requestAnimationFrame(() => { if (medirNaturais()) setVersaoNat((n) => n + 1); });
    return () => cancelAnimationFrame(id);
  });

  const floaters = narrow ? [] : RAIL_ORDER.filter((id) => s.panels[id] && s.floating[id]).map(build).filter(Boolean);

  if (!session) {
    return html`
      <${Viewport} source=${source} executor=${executor} snapshotRef=${snapshot} hideIdle=${true} ring=${ring} canvasRef=${displayCanvas} />
      <${AccessGate} onAuthenticated=${setSession} />
    `;
  }

  return html`
    <${Viewport} source=${source} executor=${executor} snapshotRef=${snapshot} ring=${ring} canvasRef=${displayCanvas} />

    ${s.notice && html`
      <div class="toast" role="status">
        <span>${s.notice}</span>
        <button onClick=${() => store.set({ notice: null })} aria-label="Fechar aviso">✕</button>
      </div>
    `}

    ${avisoLayout && !s.notice && html`
      <div class="toast toast-layout" role="status">
        <span>${avisoLayout}</span>
        <button onClick=${() => setAvisoLayout(null)} aria-label="Fechar aviso">✕</button>
      </div>
    `}

    ${rails.map(([c, items]) => items.length > 0
      && html`<div key=${c.chave} class="rail rail-${c.chave} ${plano.modo}" style=${estiloColuna(c, plano)}>${items}</div>`)}
    ${floaters}

    ${/* Player (⇧B ou botão na barra): esconder NÃO desmonta — uma gravação em
        curso e o estado do YouTube continuam vivos; só a barra some da tela */ ''}
    <div class="player-wrap" style=${{ display: s.player ? 'contents' : 'none' }}>
    <${VideoControls}
      ring=${ring}
      source=${source}
      youtube=${youtube}
      onUseYouTube=${startYouTube}
      onStop=${stopSource}
      onReload=${reloadSource}
      onFlip=${flipCamera}
      displayCanvas=${displayCanvas} />
    </div>

    <${FerramentasMouse} onSnapshot=${() => snapshot.current()} />
    ${s.beltScanAtivo && html`<${WidgetSecaoCorreia} />`}

    <${MenuBar}
      onSnapshot=${() => snapshot.current()}
      onToggleRun=${toggleRun}
      onToggleCompare=${toggleCompare}
      onTidy=${tidy}
      onLogout=${doLogout}
      session=${session} />

    <div class="hotkeys">
      <b>espaço</b> pausar · <b>c</b> comparar · <b>s</b> capturar · <b>o</b> organizar ·
      <b>m</b> módulos · <b>d</b> modelos · <b>p</b> pipeline · <b>f</b> fonte · <b>t</b> telemetria · <b>a</b> acesso · <b>g</b> config · <b>x</b> contexto · <b>q</b> códigos · <b>l</b> legendas · <b>⇧B</b> player · <b>⌘/Ctrl+K</b> Via · <b>←→</b> frame · <b>v r ⇧P ⇧L ⇧M…</b> ferramentas de mouse
    </div>

    ${s.studioBikeFit && html`<${StudioBikeFit} displayCanvas=${displayCanvas} onResetState=${resetState} onClose=${() => store.set({ studioBikeFit: false })} />`}
    ${s.bikeFit3D && html`<${BikeFit3D} onClose=${() => store.set({ bikeFit3D: false })} />`}
    ${s.studioBeltScan && html`<${StudioBeltScan} onPickFile=${pickFile} onResetState=${resetState} onClose=${() => store.set({ studioBeltScan: false })} />`}
    ${s.studioInspect && html`<${StudioInspect} onClose=${() => store.set({ studioInspect: false })} />`}
    ${s.studioCounter && html`<${StudioCounter} onPickFile=${pickFile} onResetState=${resetState} onClose=${() => store.set({ studioCounter: false })} />`}
    ${s.studioTakt && html`<${StudioTakt} onClose=${() => store.set({ studioTakt: false })} />`}
    ${s.studioOEE && html`<${StudioOEE} onClose=${() => store.set({ studioOEE: false })} />`}
    ${s.studioFisio && html`<${StudioFisio} onClose=${() => store.set({ studioFisio: false })} />`}
    ${s.studioOnda2c && html`<${StudioOnda2c} onClose=${() => store.set({ studioOnda2c: false })} />`}
    ${s.studioVideo && html`<${StudioVideo} source=${source} onPickFile=${pickFile} onClose=${() => store.set({ studioVideo: false })} />`}
    ${s.panels.via && html`<${ViaPainel} onClose=${closePanel('via')} source=${source} displayCanvas=${displayCanvas} />`}
  `;
}

function togglePanel(id) {
  store.set((st) => ({ panels: { ...st.panels, [id]: !st.panels[id] } }));
  persist();
}

