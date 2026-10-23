/**
 * components/Viewport.js — canvas de exibição e loop de captura.
 *
 * TRÊS CAMINHOS, escolhidos por frame conforme o pipeline:
 *
 *   passthrough  nenhum operador ativo. O vídeo vai direto para o canvas de
 *                exibição, em resolução plena. Zero getImageData, zero cópia.
 *
 *   overlay      só operadores que desenham por cima (detecção, pose, OCR,
 *                cantos, blobs). O pipeline roda em procWidth para CALCULAR,
 *                mas o que aparece é o vídeo em resolução PLENA com o overlay
 *                por cima. Caixa nítida sobre imagem nítida.
 *
 *   pixels       algum operador altera os pixels (blur, canny, segmentação).
 *                Aí não tem escapatória: exibe o resultado processado,
 *                reescalado pela GPU a partir de procWidth.
 *
 * A captura usa requestVideoFrameCallback quando existe: ele dispara uma vez
 * por frame REAL da câmera, em vez das 60 vezes por segundo do
 * requestAnimationFrame. Numa webcam de 30 fps isso corta metade do trabalho
 * sem tirar nada da fluidez — rAF reprocessaria o mesmo frame duas vezes.
 */

import { html, useRef, useEffect, useCallback } from '../vendor.js';
import { useStore, store } from '../state/store.js';
import { free } from '../cv/core.js';
import { getOperator } from '../cv/registry.js';
import { legendaAtual } from '../cv/speech/captions.js';
import { marcStore, vista, rt, paraQuadro } from '../cv/marcacoes.js';
import {
  desenharMarcacoes, ponteiroDown, ponteiroMove, ponteiroUp, duploClique, saiu as ponteiroSaiu,
} from './marcacoes-vista.js';
import { AtrasoQuadros, sincroniaLigada } from './video/sincronia.js';

/** YT.PlayerState em que o quadro capturado não anda: terminado, pausado, carregando, carregado sem tocar. */
const YT_PARADO = new Set([0, 2, 3, 5]);

export function Viewport({ source, executor, snapshotRef, hideIdle, ring, canvasRef }) {
  const s = useStore(store, (st) => ({
    zoomZ: st.zoom ? st.zoom.z : 1,
    running: st.running,
    compare: st.compare,
    cameraOn: st.cameraOn,
    sourceKind: st.sourceKind,
  }));
  // ferramenta de mouse ativa (widget Ferramentas): troca o cursor e desvia os gestos de zoom
  const ferr = useStore(marcStore, (m) => m.ferramenta);

  const displayRef = useRef(null);
  /*
   * Publica o canvas para fora. A gravação captura ESTE canvas, não o stream
   * da câmera — assim o arquivo sai com as caixas de detecção, o esqueleto e
   * as máscaras já desenhados. Gravar a câmera crua daria um vídeo bonito e
   * sem o que este sistema produz.
   */
  useEffect(() => {
    if (canvasRef) canvasRef.current = displayRef.current;
  });
  const workRef = useRef(null);
  const outRef = useRef(null);
  const splitRef = useRef(0.5);
  const draggingSplit = useRef(false);
  const fpsRef = useRef({ frames: 0, t0: performance.now(), acc: 0, n: 0 });
  const frameIdx = useRef(0);
  const blackRef = useRef({ count: 0, warned: false });
  const qualityRef = useRef({ t0: performance.now(), samples: [] });
  const lastOverlay = useRef([]);
  // zoom: geometria do último quadro desenhado (para converter gestos em coordenadas da imagem)
  const geom = useRef({ dx: 0, dy: 0, dw: 1, dh: 1, dpr: 1, z: 1 });
  const zoomMudou = useRef(false);
  /*
   * QUADRO CONGELADO EM RESOLUÇÃO PLENA. Pausar no vivo mostrava o último
   * quadro do HISTÓRICO, que é gravado reduzido (640 px, comprimido): uma
   * câmera 1920×1080 pausada virava uma imagem de 640 px borrada. Agora, ao
   * pausar, copia-se UMA vez a fonte em resolução plena e ela substitui o
   * quadro mais recente do histórico enquanto o cursor estiver nele. Voltar
   * quadro a quadro continua usando o histórico (essa é a resolução que existe).
   * YouTube fica de fora: o player desenha o ícone de pausa logo depois.
   */
  const congelado = useRef({ ok: false, cursor: null, quadro: { canvas: null } });
  const congelarPleno = (held, r, src, mirror) => {
    const cg = congelado.current;
    if (!held || !r) { cg.ok = false; cg.cursor = null; return held; }
    // a posição em que pausou (o buffer comprimido ainda recebe quadros já
    // enviados ao codificador, então «o último» não serve de referência)
    if (cg.cursor === null) cg.cursor = r.cursor;
    if (r.cursor !== cg.cursor || !src || src.kind === 'youtube') return held;
    if (!cg.ok) {
      const el = src.element, sz = src.size;
      if (!el || !sz || !sz.width || !sz.height) return held;
      const c = cg.quadro.canvas || (cg.quadro.canvas = document.createElement('canvas'));
      if (c.width !== sz.width || c.height !== sz.height) { c.width = sz.width; c.height = sz.height; }
      const x = c.getContext('2d');
      x.save();
      // o histórico guarda o quadro já espelhado; a cópia segue a mesma regra
      if (mirror) { x.translate(sz.width, 0); x.scale(-1, 1); }
      try { x.drawImage(el, 0, 0, sz.width, sz.height); } catch (_) { x.restore(); return held; }
      x.restore();
      cg.ok = true;
    }
    return cg.quadro;
  };
  /*
   * Tamanho do canvas de exibição em px CSS, mantido por um ResizeObserver.
   * Antes era getBoundingClientRect() a CADA quadro: com o React mexendo no
   * DOM entre um quadro e outro (telemetria, barra de vídeo, painéis), a
   * leitura forçava um layout síncrono dentro do callback do vídeo. null =
   * ainda não medido (cai na leitura direta).
   */
  const tamCss = useRef(null);
  useEffect(() => {
    const el = displayRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((ents) => {
      const e = ents[ents.length - 1];
      const b = e.borderBoxSize && e.borderBoxSize[0];
      tamCss.current = b ? { width: b.inlineSize, height: b.blockSize } : { width: e.contentRect.width, height: e.contentRect.height };
    });
    ro.observe(el);
    return () => { ro.disconnect(); tamCss.current = null; };
  }, []);
  const esperando = useRef(null);         // fonte sem imagem já avisada (não repinta a cada quadro)
  const ultimoZoom = useRef(null);
  const repintarRef = useRef(() => {});

  /*
   * Cor do palco (letterbox e tela de espera) segue o tema: lida do CSS
   * (--stage-bg) uma vez e de novo só quando <html data-theme> muda — nada
   * por quadro. Trocar o tema com o vídeo pausado repinta o último quadro.
   */
  useEffect(() => {
    lerPalco();
    const mo = new MutationObserver(() => {
      lerPalco();
      esperando.current = null;      // a tela «aguardando», se for ela, é repintada
      repintarRef.current();         // e o quadro parado também (como o zoom)
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  const toques = useRef(new Map());      // pointerId -> {x, y} (pinça com dois dedos)
  const arrasto = useRef(null);          // {x, y, cx, cy} durante o arrasto do enquadramento
  const grabRef = useRef(null);
  const reduzRef = useRef(null);         // quadro de trabalho reduzido na GPU (antes da leitura para a CPU)
  const grabW = useRef(0);               // último maxW pedido ao grabFull (quadro pleno primeiro)
  const heldAnt = useRef(null);          // quadro do histórico do último processamento (repetido = parado)
  /*
   * SINCRONIA (components/video/sincronia.js): com rastreio na cadeia e a
   * fonte num arquivo ou no YouTube, a imagem é exibida com o atraso da
   * detecção (cópias curtas do quadro na resolução de exibição) e as caixas
   * são as do instante daquele quadro. `atrasoMs` vem do rastreio
   * (ctx.sincronia) do quadro anterior.
   */
  const sincRef = useRef(null);
  if (!sincRef.current) sincRef.current = { buf: new AtrasoQuadros(), bufOut: new AtrasoQuadros({ maxBytes: 48e6 }), atrasoMs: 0 };

  if (!workRef.current) {
    workRef.current = document.createElement('canvas');
    outRef.current = document.createElement('canvas');
    grabRef.current = document.createElement('canvas');
  }

  // ---------------------------------------------------------- render loop

  useEffect(() => {
    let alive = true;
    let rafId = 0;
    let vfcHandle = 0;
    let vfcTarget = null;

    let vfcPendente = false;
    const tick = () => {
      if (!alive) return;
      vfcPendente = false;
      try {
        renderFrame();
      } catch (err) {
        // um frame ruim não pode matar o loop
        console.error('[viewport]', err);
      }
      schedule();
    };

    /*
     * requestVideoFrameCallback dispara por frame real do vídeo; rAF dispara
     * na taxa do monitor. Preferimos o primeiro e só caímos no segundo quando
     * a fonte não é vídeo (imagem estática) ou o browser não suporta.
     */
    const schedule = () => {
      if (!alive) return;
      const src = source.current;
      const r = ring && ring.current;
      const held = r ? r.current() : null;
      const el = held ? null : (src && src.element);
      if (el && typeof el.requestVideoFrameCallback === 'function') {
        vfcTarget = el;
        vfcPendente = true;
        vfcHandle = el.requestVideoFrameCallback(tick);
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    function renderFrame() {
      const src = source.current;
      const display = displayRef.current;
      if (!display) return;
      // instante do quadro (relógio da página): carimbo das detecções e alvo da previsão
      const tQ = performance.now();

      const st = store.get();
      const r = ring && ring.current;

      /*
       * Se o usuário rebobinou, a "fonte" passa a ser o frame guardado no
       * buffer. O resto do pipeline não muda — o operador continua rodando,
       * a detecção continua sendo calculada. Rebobinar não vira uma foto
       * parada: vira reprocessamento do histórico.
       */
      const held = congelarPleno(r ? r.current() : null, r, src, st.mirror);
      const el = held ? held.canvas : (src && src.element);
      if (!el) {
        /*
         * A fonte atual ainda não tem imagem (YouTube esperando a captura da
         * aba, RTMP conectando…). Antes a tela ficava com o ÚLTIMO quadro da
         * fonte anterior — uma webcam congelada com os desenhos de operadores
         * já desligados, que parecia "abriu a câmera e travou". Agora limpa e
         * diz o que está esperando.
         */
        if (src && src.kind !== 'camera' && esperando.current !== src) {
          esperando.current = src;
          lastOverlay.current = [];
          const rect = display.getBoundingClientRect();
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
          if (cw && ch) {
            if (display.width !== cw || display.height !== ch) { display.width = cw; display.height = ch; }
            const d = display.getContext('2d', { alpha: false });
            d.fillStyle = palco.fundo; d.fillRect(0, 0, cw, ch);
            const msg = src.kind === 'youtube'
              ? 'Aguardando a imagem do YouTube — aceite compartilhar ESTA aba no aviso do navegador'
              : 'Aguardando a imagem da fonte…';
            d.font = `600 ${13 * dpr}px ui-sans-serif, system-ui, sans-serif`;
            d.textAlign = 'center'; d.fillStyle = palco.texto;
            d.fillText(msg, cw / 2, ch / 2);
          }
        }
        return;
      }
      esperando.current = null;

      const size = held
        ? { width: held.canvas.width, height: held.canvas.height }
        : (src ? src.size : null);
      if (!size || !size.width || !size.height) return;

      // pausado no vivo: o canvas mantém o último quadro, não há o que redesenhar
      // (a não ser que o zoom tenha mudado — aí redesenha o último quadro com o recorte novo)
      if (st.zoom !== ultimoZoom.current) { ultimoZoom.current = st.zoom; zoomMudou.current = true; }
      if (!st.running && !held && !zoomMudou.current) return;
      zoomMudou.current = false;

      // o frame guardado já foi espelhado na gravação; espelhar de novo inverteria
      const mirror = held ? false : st.mirror;

      /*
       * ZOOM DIGITAL. O recorte é aplicado na FONTE, antes de tudo: o que se
       * vê ampliado é exatamente o que os modelos recebem — um ciclista que
       * ocupava 1/4 do quadro passa a ocupar o quadro, e a pose melhora. A
       * gravação no buffer continua com o quadro inteiro (rebobinar e mudar
       * o zoom depois funciona).
       */
      const c = recorte(size, st.zoom, mirror);
      const vs = { width: c.sw, height: c.sh };

      if (r && !held && st.running) r.push(el, size.width, size.height, st.mirror);

      const active = st.nodes.filter((n) => n.enabled);
      const mode = !active.length
        ? 'passthrough'
        : active.every((n) => {
            const def = getOperator(n.op);
            return def && def.overlayOnly;
          })
          ? 'overlay'
          : 'pixels';

      // ---- geometria de exibição
      const rect = tamCss.current || display.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = Math.round(rect.width * dpr), ch = Math.round(rect.height * dpr);
      if (!cw || !ch) return;
      if (display.width !== cw || display.height !== ch) {
        display.width = cw;
        display.height = ch;
      }
      const dctx = display.getContext('2d', { alpha: false, desynchronized: true });

      const fit = Math.min(cw / vs.width, ch / vs.height);
      const dw = vs.width * fit, dh = vs.height * fit;
      const dx = (cw - dw) / 2, dy = (ch - dh) / 2;
      geom.current = { dx, dy, dw, dh, dpr, z: (st.zoom && st.zoom.z) || 1 };
      /*
       * Geometria para as MARCAÇÕES (cv/marcacoes.js): elas vivem em
       * coordenadas da fonte inteira e são convertidas daqui para a tela e
       * para o quadro do pipeline. O quadro do histórico já foi gravado
       * espelhado (fs); ao vivo quem espelha é o desenho (fd).
       */
      vista.ok = true;
      vista.W = size.width; vista.H = size.height;
      vista.sx = c.sx; vista.sy = c.sy; vista.sw = c.sw; vista.sh = c.sh;
      vista.fs = held ? Boolean(st.mirror) : false; vista.fd = mirror;
      vista.dx = dx; vista.dy = dy; vista.dw = dw; vista.dh = dh; vista.dpr = dpr;
      vista.canvas = display; vista.el = el;

      dctx.fillStyle = palco.fundo;
      dctx.fillRect(0, 0, cw, ch);
      // contador de quadros pintados: o Studio Bike Fit copia este canvas e só repinta o vídeo quando ele muda
      display.quadros = (display.quadros | 0) + 1;
      dctx.imageSmoothingEnabled = true;
      dctx.imageSmoothingQuality = 'high';

      const t0 = performance.now();
      let overlay = null, metrics = null, timings = null;

      // ---- caminho 1: nada a processar, vídeo direto em resolução plena
      if (mode === 'passthrough') {
        drawSource(dctx, el, mirror, dx, dy, dw, dh, c);
        lastOverlay.current = [];
        commit(0, {}, [], st);
        return;
      }

      // ---- pipeline roda em procWidth
      const procW = Math.max(64, Math.min(st.procWidth, Math.round(vs.width)));
      const procH = Math.max(1, Math.round((procW * vs.height) / vs.width));
      const work = workRef.current;
      if (work.width !== procW || work.height !== procH) {
        work.width = procW;
        work.height = procH;
      }
      const wctx = work.getContext('2d', { willReadFrequently: true });

      /*
       * QUADRO PLENO PRIMEIRO. Ler um vídeo decodificado na GPU (H.264,
       * câmera) para um canvas de CPU custa uma cópia GPU→CPU do quadro
       * INTEIRO, qualquer que seja o tamanho de destino (medido: 4–13 ms por
       * leitura de 1280×720). Quem pede o quadro pleno toda vez (BeltScan)
       * pagava DUAS: o quadro de trabalho e o grabFull. Quando todos os nós
       * ativos declaram `quadroPleno` — usam o grabFull como entrada e o
       * quadro em procWidth só como referência de tamanho —, a fonte é lida
       * uma vez em resolução plena (os mesmos pixels de antes para o
       * operador) e o quadro de trabalho sai dela por redução canvas→canvas.
       */
      const desenharGrab = (maxW) => {
        const alvo = Math.min(maxW || 1280, vs.width);
        const gw = Math.max(64, Math.round(alvo));
        const gh = Math.max(1, Math.round((gw * vs.height) / vs.width));
        const g = grabRef.current;
        if (g.width !== gw || g.height !== gh) { g.width = gw; g.height = gh; }
        const gctx = g.getContext('2d', { willReadFrequently: true });
        gctx.save();
        if (mirror) { gctx.translate(gw, 0); gctx.scale(-1, 1); }
        try {
          gctx.drawImage(el, c.sx, c.sy, c.sw, c.sh, 0, 0, gw, gh);
        } catch (_) {
          gctx.restore();
          return null;
        }
        gctx.restore();
        return { gw, gh, gctx };
      };
      let plenoPronto = null;
      if (active.every((n) => { const d = getOperator(n.op); return d && d.quadroPleno; })) {
        plenoPronto = desenharGrab(grabW.current || 1280);
        if (plenoPronto) wctx.drawImage(grabRef.current, 0, 0, plenoPronto.gw, plenoPronto.gh, 0, 0, procW, procH);
      }
      if (!plenoPronto) {
        /*
         * Redução NA GPU antes da leitura: o vídeo é reduzido para procW num canvas acelerado e só
         * então copiado para o canvas de CPU (willReadFrequently). A cópia GPU→CPU passa a ser do
         * quadro de trabalho (480×270), não do quadro decodificado inteiro (1280×720 ou mais) —
         * medido: 9,7 → 6,8 ms por quadro de 720p, pixels idênticos.
         */
        if (!reduzRef.current) reduzRef.current = document.createElement('canvas');
        const rz = reduzRef.current;
        if (rz.width !== procW || rz.height !== procH) { rz.width = procW; rz.height = procH; }
        const rctx = rz.getContext('2d', { alpha: false });
        rctx.save();
        if (mirror) {
          rctx.translate(procW, 0);
          rctx.scale(-1, 1);
        }
        try {
          rctx.drawImage(el, c.sx, c.sy, c.sw, c.sh, 0, 0, procW, procH);
        } catch (_) {
          rctx.restore();
          return;
        }
        rctx.restore();
        wctx.drawImage(rz, 0, 0);
      }

      let frame;
      try {
        frame = wctx.getImageData(0, 0, procW, procH);
      } catch (_) {
        return;
      }

      detectBlack(frame, st);

      /*
       * Grão fino em resolução plena, sob demanda.
       *
       * O pipeline roda em procWidth (480 por padrão, e o modo automático
       * baixa mais quando o aparelho aperta). Para caixa de detecção e
       * segmentação isso é irrelevante. Para CÓDIGO DE BARRAS é fatal: um
       * EAN-13 tem 95 barras, e a 480 px ocupando meio quadro sobram ~2,5
       * pixels por barra — com o desfoque real de câmera de celular, a
       * leitura simplesmente não fecha. QR passa porque tem alvo de
       * enquadramento grande e correção de erro; código de barras não tem
       * nem um nem outro.
       *
       * Quem precisar de detalhe chama isto e recebe o quadro original.
       * É caro (um getImageData grande), então fica sob demanda e o
       * operador só chama no seu próprio intervalo, não a cada frame.
       */
      const grabFull = (maxW) => {
        grabW.current = maxW || 1280;
        const alvo = Math.min(maxW || 1280, vs.width);
        const gw = Math.max(64, Math.round(alvo));
        const gh = Math.max(1, Math.round((gw * vs.height) / vs.width));
        // já lido neste quadro, no mesmo tamanho (quadro pleno primeiro): só a cópia para ImageData
        const pronto = plenoPronto && plenoPronto.gw === gw && plenoPronto.gh === gh ? plenoPronto : desenharGrab(maxW);
        if (!pronto) return null;
        try {
          return pronto.gctx.getImageData(0, 0, pronto.gw, pronto.gh);
        } catch (_) {
          return null;
        }
      };

      /*
       * FONTE PARADA: o quadro não anda, embora o laço continue rodando —
       * player do YouTube pausado/terminado/carregando (a captura segue
       * entregando o mesmo quadro, com ruído de compressão) ou o mesmo quadro
       * do histórico de novo. Operadores que acumulam sessão leem isto (ver
       * cv/runtime/parado.js) para não re-inferir nem registrar amostras.
       */
      const fonteParada = held
        ? held === heldAnt.current
        : Boolean(src && src.kind === 'youtube' && YT_PARADO.has(src.estado));
      heldAnt.current = held;

      /*
       * SINCRONIA (components/video/sincronia.js + cv/runtime/tempo-real/sincronizar.js): em arquivo
       * e YouTube, a imagem exibida é a do instante dos resultados desenhados. O executor carimba o
       * desenho de cada nó com o quadro de onde ele saiu e pede um atraso (latência + período dos
       * nós assíncronos, com teto); o Viewport mostra o quadro de L ms atrás e o executor monta o
       * overlay para o instante dele. Vale para TODOS os operadores (antes só com rastreio na
       * cadeia), nos dois caminhos (overlay e pixels). Câmera e streams ao vivo: imagem no ritmo
       * real, desenho mais recente, com a idade dele carimbada na tela. `sincronizar` de um nó
       * (ByteTrack, Motion 3D) ainda manda: 'nunca' desliga, 'sempre' liga até ao vivo.
       */
      const sc = sincRef.current;
      const noModo = !held ? active.find((n) => n.params && typeof n.params.sincronizar === 'string') : null;
      const sincOn = mode !== 'passthrough' && !held && !fonteParada
        && sincroniaLigada((noModo && noModo.params.sincronizar) || 'auto', st.sourceKind);
      const perto = active.some((n) => n.op === 'motion3d.captura');
      let quadroExib = null, quadroOut = null;
      if (sincOn) {
        // pixels: o quadro processado é guardado depois da cadeia; o de exibir sai dos já guardados
        if (mode === 'overlay' || st.compare) sc.buf.guardar(el, c, mirror, tQ, dw, dh, sc.atrasoMs);
        if (sc.atrasoMs > 0) {
          // em sequência (proximo): o quadro seguinte ao exibido, não o «mais novo até o alvo» — ver sincronia.js
          if (mode === 'overlay') quadroExib = perto ? sc.buf.escolherPerto(tQ - sc.atrasoMs) : sc.buf.proximo(tQ - sc.atrasoMs);
          else {
            quadroOut = sc.bufOut.proximo(tQ - sc.atrasoMs);
            if (quadroOut && st.compare) quadroExib = sc.buf.escolherPerto(quadroOut.t);
          }
        }
      } else if (sc.buf.tamanho || sc.bufOut.tamanho || sc.atrasoMs) {
        sc.buf.limpar(); sc.bufOut.limpar(); sc.atrasoMs = 0;
      }
      if (mode === 'overlay' || !sincOn) sc.bufOut.limpar();
      const tExib = quadroOut ? quadroOut.t : quadroExib ? quadroExib.t : tQ;

      const result = executor.current.run(frame, st.nodes, frameIdx.current++, {
        grabFull, fonteParada,
        /*
         * O mesmo quadro pleno como CANVAS, sem ler os pixels para a CPU: o
         * detector em alta resolução (cv/runtime/tempo-real/entrada.js) recorta
         * os ladrilhos direto dele — uma leitura grande a menos por inferência.
         */
        grabCanvas: (maxW) => {
          const pronto = plenoPronto && plenoPronto.gw === Math.max(64, Math.round(Math.min(maxW || 1280, vs.width))) ? plenoPronto : desenharGrab(maxW);
          return pronto ? { canvas: grabRef.current, w: pronto.gw, h: pronto.gh } : null;
        },
        // marcações no espaço deste quadro (ROI/exclusão, zonas, linhas, escala) — null sem marcações
        marcacoes: paraQuadro(procW, procH),
        tQuadro: tQ,
        // instante do quadro que vai para a tela (sincronia); sem ela, o próprio quadro
        tExibir: tExib,
        // overlay montado para tExibir (sincronia ligada) ou o mais recente de cada nó
        sincronizar: sincOn,
      });
      {
        /*
         * Atraso da imagem. Antes subia NA HORA a cada resultado novo (a imagem voltava no tempo ou
         * congelava) e descia 3 ms por quadro (vídeo a 1,09×): com RF-DETR o pedido (L + P) oscila
         * ±200 ms a cada inferência e o vídeo vivia congelando e acelerando — «lento e engasgando».
         * Agora: 100 ms de folga sobre o pedido (a oscilação comum cabe nela); salta só no começo
         * ou num degrau grande (uma pausa); fora isso sobe a 10% (a imagem anda a 0,9×) e só desce,
         * a 4%, quando sobra mais de 150 ms além da folga — sem congelar nem voltar no tempo.
         */
        const pedido = sincOn && result.sincronia ? Math.max(0, result.sincronia.atrasoMs || 0) : 0;
        const alvo = pedido ? pedido + 100 : 0;
        const passo = sc.tAnt ? Math.min(100, Math.max(0, tQ - sc.tAnt)) : 0;
        sc.tAnt = tQ;
        if (!alvo) sc.atrasoMs = Math.max(0, sc.atrasoMs - passo * 0.04);
        else if (!sc.atrasoMs || alvo > sc.atrasoMs + 300) sc.atrasoMs = alvo;
        else if (alvo > sc.atrasoMs) sc.atrasoMs = Math.min(alvo, sc.atrasoMs + passo * 0.1);
        else if (alvo < sc.atrasoMs - 150) sc.atrasoMs = Math.max(alvo, sc.atrasoMs - passo * 0.04);
      }
      // quem copia este canvas (Motion 3D Studio, Studios) desenha no instante do quadro exibido
      display.tQuadro = tQ;
      display.tExibir = tExib;
      overlay = result.overlay;
      metrics = result.metrics;
      timings = result.timings;
      const procMs = performance.now() - t0;

      // escala do espaço do pipeline (procW) para o espaço de exibição
      const ovScale = dw / procW;

      if (mode === 'overlay') {
        // ---- caminho 2: vídeo nítido + overlay (com sincronia: o quadro de L ms atrás)
        if (quadroExib) dctx.drawImage(quadroExib.canvas, dx, dy, dw, dh);
        else drawSource(dctx, el, mirror, dx, dy, dw, dh, c);
        free(result.image);
      } else {
        // ---- caminho 3: pixels processados
        const out = outRef.current;
        if (out.width !== procW || out.height !== procH) {
          out.width = procW;
          out.height = procH;
        }
        out.getContext('2d').putImageData(result.image, 0, 0);
        free(result.image);
        // sincronia nos pixels: guarda o processado (no tamanho do pipeline: barato) e exibe o de tExib
        let outExib = out;
        if (sincOn) {
          sc.bufOut.guardar(out, { sx: 0, sy: 0, sw: procW, sh: procH }, false, tQ, procW, procH, sc.atrasoMs);
          if (quadroOut) outExib = quadroOut.canvas;
        }

        // LGPD: com borrão de rostos ativo, a metade "ORIGINAL" mostraria rostos sem borrão —
        // o Comparar fica desligado nesse caso e a tela inteira mostra o processado
        const privado = st.nodes.some((n) => n.enabled && (n.op === 'privacidade.borrar_rostos'
          || (n.op === 'takt.posto' && (!n.params || n.params.borrarRostos !== false))
          || (n.op === 'epi.monitor' && (!n.params || n.params.borrar !== false))));
        if (st.compare && !privado) {
          const cut = Math.round(dw * splitRef.current);
          if (quadroExib) dctx.drawImage(quadroExib.canvas, dx, dy, dw, dh);
          else drawSource(dctx, el, mirror, dx, dy, dw, dh, c);
          dctx.save();
          dctx.beginPath();
          dctx.rect(dx + cut, dy, dw - cut, dh);
          dctx.clip();
          dctx.drawImage(outExib, 0, 0, outExib.width, outExib.height, dx, dy, dw, dh);
          dctx.restore();
          drawSplitter(dctx, dx + cut, dy, dh, dpr);
          label(dctx, 'ORIGINAL', dx + 10 * dpr, dy + 22 * dpr, dpr);
          label(dctx, 'PROCESSADO', dx + dw - 10 * dpr, dy + 22 * dpr, dpr, 'right');
        } else {
          dctx.drawImage(outExib, 0, 0, outExib.width, outExib.height, dx, dy, dw, dh);
          if (st.compare && privado) label(dctx, 'COMPARAR DESLIGADO · ROSTOS BORRADOS (LGPD)', dx + 10 * dpr, dy + 22 * dpr, dpr);
        }
      }
      free(frame);

      drawOverlay(dctx, overlay, dx, dy, ovScale, dpr);
      if (held) label(dctx, `HISTÓRICO −${r.behindSeconds.toFixed(1)}s`, dx + 10 * dpr, dy + dh - 12 * dpr, dpr);
      else if (tExib < tQ - 1) label(dctx, `SINCRONIA −${Math.round(tQ - tExib)} ms`, dx + 10 * dpr, dy + dh - 12 * dpr, dpr);
      // ao vivo (sem atrasar a imagem): o carimbo do resultado mais velho que está na tela
      else if (!sincOn && result.idadeMs > 150) label(dctx, `RESULTADO −${Math.round(result.idadeMs)} ms`, dx + 10 * dpr, dy + dh - 12 * dpr, dpr);
      lastOverlay.current = overlay;
      commit(procMs, metrics, timings, st);
      autoQuality(procMs, st);
    }

    function commit(procMs, metrics, timings, st) {
      /*
       * A legenda ao vivo é pintada AQUI, no fim de todos os caminhos de
       * render (passthrough, overlay, pixels), por cima de tudo. Por estar
       * no canvas de exibição — e não num <div> por cima —, ela entra na
       * gravação junto com as detecções. É o que faz «legenda ao vivo» valer
       * também para o arquivo salvo.
       */
      // marcações das Ferramentas de mouse: no canvas, para entrarem na captura e na gravação
      const disp = displayRef.current;
      if (disp) desenharMarcacoes(disp.getContext('2d', { alpha: false, desynchronized: true }));
      drawCaption(disp);

      const f = fpsRef.current;
      f.frames++;
      f.acc += procMs;
      f.n++;
      const now = performance.now();
      if (now - f.t0 >= 250) {
        store.set({
          fps: Math.round((f.frames * 1000) / (now - f.t0)),
          procMs: f.acc / Math.max(1, f.n),
          metrics: metrics || {},
          timings: timings || [],
        });
        f.frames = 0;
        f.acc = 0;
        f.n = 0;
        f.t0 = now;
      }
    }

    /*
     * Qualidade adaptativa: mantém o custo de processamento dentro do orçamento
     * do fps alvo mexendo na largura de trabalho. Sobe devagar e desce rápido —
     * o usuário perdoa perder nitidez, não perdoa engasgo.
     */
    function autoQuality(procMs, st) {
      if (!st.autoQuality) return;
      const q = qualityRef.current;
      q.samples.push(procMs);
      if (q.samples.length < 20) return;

      const now = performance.now();
      if (now - q.t0 < 1200) { q.samples.length = 0; return; }
      q.t0 = now;

      const sorted = q.samples.slice().sort((a, b) => a - b);
      const p80 = sorted[Math.floor(sorted.length * 0.8)];
      q.samples.length = 0;

      const budget = 1000 / (st.targetFps || 30);
      const cur = st.procWidth;
      let next = cur;
      if (p80 > budget * 1.15) next = Math.max(160, Math.round(cur * 0.82 / 40) * 40);
      else if (p80 < budget * 0.5) next = Math.min(960, Math.round(cur * 1.12 / 40) * 40);
      if (next !== cur) store.set({ procWidth: next });
    }

    function detectBlack(frame, st) {
      if (st.sourceKind !== 'camera') return;
      const b = blackRef.current;
      if (isNearlyBlack(frame)) {
        if (++b.count === 60 && !b.warned) {
          b.warned = true;
          store.set({
            notice: 'A câmera está entregando imagem preta. Verifique o obturador ' +
                    'físico (a tampinha deslizante acima da tela) e, no painel Fonte, ' +
                    'confira se o dispositivo selecionado não é a câmera IR — ' +
                    'a infravermelha só enxerga durante o Windows Hello.',
          });
        }
      } else if (b.count) {
        b.count = 0;
        b.warned = false;
      }
    }

    // marcação mudou com o vídeo pausado: repinta o quadro (como o zoom)
    rt.redesenhar = () => { zoomMudou.current = true; };
    /*
     * Repintar JÁ (troca de tema): com o vídeo pausado o laço espera um
     * requestVideoFrameCallback que só vem quando o vídeo andar. Troca essa
     * espera por um rAF — uma vez; o schedule() seguinte decide como sempre.
     */
    repintarRef.current = () => {
      zoomMudou.current = true;
      if (!alive || !vfcPendente || !vfcTarget || !vfcTarget.paused) return;
      try { vfcTarget.cancelVideoFrameCallback(vfcHandle); } catch (_) { return; }
      vfcPendente = false;
      rafId = requestAnimationFrame(tick);
    };

    /*
     * Fonte trocada por baixo de uma espera de rVFC: câmera → arquivo (o
     * pickFile para a câmera na hora), câmera desplugada, tela encerrada. O
     * requestVideoFrameCallback pendente no <video> ANTIGO nunca vem e o laço
     * parava — o pipeline e os Studios congelavam. Vigia leve: se o elemento
     * da fonte não é mais o da espera, ou ele ficou sem mídia, troca a espera
     * por um rAF (o schedule() seguinte escolhe o elemento certo).
     */
    const vigia = setInterval(() => {
      if (!alive || !vfcPendente || !vfcTarget) return;
      const src = source.current;
      const r = ring && ring.current;
      const atual = r && r.current() ? null : (src && src.element);
      const semMidia = !vfcTarget.srcObject && !vfcTarget.currentSrc;
      if (atual === vfcTarget && !semMidia) return;
      try { vfcTarget.cancelVideoFrameCallback(vfcHandle); } catch (_) { /* já cancelado */ }
      vfcPendente = false;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    }, 400);

    schedule();
    return () => {
      alive = false;
      clearInterval(vigia);
      rt.redesenhar = () => {};
      repintarRef.current = () => {};
      cancelAnimationFrame(rafId);
      if (vfcTarget && vfcHandle && vfcTarget.cancelVideoFrameCallback) {
        try { vfcTarget.cancelVideoFrameCallback(vfcHandle); } catch (_) { /* já cancelado */ }
      }
    };
  }, [source, executor, ring]);

  // ---------------------------------------------------------- snapshot

  useEffect(() => {
    snapshotRef.current = () => {
      const display = displayRef.current;
      if (!display || !display.width) return;
      const st = store.get();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      display.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `iavision-${stamp}-${st.nodes.filter((n) => n.enabled).length}ops.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    };
  }, [snapshotRef]);

  // ---------------------------------------------------------- split drag

  /*
   * GESTOS DE ZOOM. Arrastar move o enquadramento (só com zoom > 1); dois
   * dedos fazem pinça; Ctrl/⌘ + roda (ou a pinça do trackpad, que chega como
   * roda com ctrlKey) amplia no ponto do cursor; duplo clique alterna 1× ↔ 2×.
   * O ponto sob o dedo/cursor fica parado durante o zoom.
   */
  const pontoNaImagem = (clientX, clientY) => {
    const disp = displayRef.current;
    if (!disp) return { px: 0.5, py: 0.5 };
    const r = disp.getBoundingClientRect(), g = geom.current;
    return {
      px: Math.min(1, Math.max(0, ((clientX - r.left) * g.dpr - g.dx) / g.dw)),
      py: Math.min(1, Math.max(0, ((clientY - r.top) * g.dpr - g.dy) / g.dh)),
    };
  };
  const ampliar = (fator, clientX, clientY) => {
    const zm = store.get().zoom || { z: 1, cx: 0.5, cy: 0.5 };
    const z1 = zm.z || 1, z2 = Math.max(1, Math.min(8, z1 * fator));
    if (z2 === z1) return;
    const { px, py } = clientX == null ? { px: 0.5, py: 0.5 } : pontoNaImagem(clientX, clientY);
    // ponto absoluto (0–1 da imagem inteira) sob o cursor, que deve ficar parado
    const ax = zm.cx - 0.5 / z1 + px / z1, ay = zm.cy - 0.5 / z1 + py / z1;
    setZoom({ z: z2, cx: ax + 0.5 / z2 - px / z2, cy: ay + 0.5 / z2 - py / z2 });
  };

  useEffect(() => {
    const disp = displayRef.current;
    if (!disp) return undefined;
    let gesto = null;                            // escala do último gesturechange (Safari)
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;     // rolar sem Ctrl continua rolando a página
      e.preventDefault();
      if (gesto) return;                         // pinça do Safari já tratada abaixo
      ampliar(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    disp.addEventListener('wheel', onWheel, { passive: false });
    /*
     * Pinça no trackpad do Mac. Chrome e Firefox a entregam como roda + Ctrl
     * (acima); o Safari manda gesturestart/gesturechange/gestureend, e sem
     * tratar ampliaria a PÁGINA inteira. Detecção pelo recurso (GestureEvent).
     */
    const temGesto = typeof window.GestureEvent === 'function';
    const onGestoIni = (e) => { e.preventDefault(); gesto = 1; };
    const onGesto = (e) => {
      e.preventDefault();
      const f = e.scale / (gesto || 1);
      gesto = e.scale;
      if (Number.isFinite(f) && f > 0) ampliar(f, e.clientX, e.clientY);
    };
    const onGestoFim = (e) => { e.preventDefault(); gesto = null; };
    if (temGesto) {
      disp.addEventListener('gesturestart', onGestoIni);
      disp.addEventListener('gesturechange', onGesto);
      disp.addEventListener('gestureend', onGestoFim);
    }
    // teclado: + amplia, − reduz, 0 volta ao quadro inteiro (fora de campos de texto)
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === '+' || e.key === '=') { ampliar(1.25); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { ampliar(1 / 1.25); e.preventDefault(); }
      else if (e.key === '0') { setZoom({ z: 1 }); e.preventDefault(); }
    };
    addEventListener('keydown', onKey);
    return () => {
      disp.removeEventListener('wheel', onWheel);
      removeEventListener('keydown', onKey);
      if (temGesto) {
        disp.removeEventListener('gesturestart', onGestoIni);
        disp.removeEventListener('gesturechange', onGesto);
        disp.removeEventListener('gestureend', onGestoFim);
      }
    };
  }, []);

  const onDown = useCallback((e) => {
    // ferramenta de desenho ativa: o gesto é dela (com "Mover", segue o zoom de sempre)
    if (!store.get().compare && ponteiroDown(e)) return;
    if (store.get().compare) {
      draggingSplit.current = true;
      updateSplit(e);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue sem captura */ }
      return;
    }
    toques.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const zm = store.get().zoom || { z: 1 };
    if (toques.current.size === 1 && zm.z > 1) arrasto.current = { x: e.clientX, y: e.clientY, cx: zm.cx, cy: zm.cy };
    if (toques.current.size === 2) arrasto.current = null;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* segue sem captura */ }
  }, []);

  const onMove = useCallback((e) => {
    if (draggingSplit.current) { updateSplit(e); return; }
    if (!store.get().compare && ponteiroMove(e)) return;
    if (!toques.current.has(e.pointerId)) return;
    const antes = [...toques.current.values()];
    const distAntes = antes.length === 2 ? Math.hypot(antes[0].x - antes[1].x, antes[0].y - antes[1].y) : 0;
    toques.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const agora = [...toques.current.values()];
    if (agora.length === 2 && distAntes > 0) {
      const d = Math.hypot(agora[0].x - agora[1].x, agora[0].y - agora[1].y);
      ampliar(d / distAntes, (agora[0].x + agora[1].x) / 2, (agora[0].y + agora[1].y) / 2);
      return;
    }
    const a = arrasto.current;
    if (a) {
      const g = geom.current, zm = store.get().zoom;
      const nx = a.cx - ((e.clientX - a.x) * g.dpr) / (g.dw * zm.z);
      const ny = a.cy - ((e.clientY - a.y) * g.dpr) / (g.dh * zm.z);
      setZoom({ ...zm, cx: nx, cy: ny });
    }
  }, []);

  const onUp = useCallback((e) => {
    draggingSplit.current = false;
    toques.current.delete(e.pointerId);
    if (toques.current.size < 2) arrasto.current = null;
    if (ponteiroUp(e)) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) { /* já solto */ }
  }, []);

  const onDbl = useCallback((e) => {
    if (store.get().compare) return;
    if (duploClique(e)) return;
    const zm = store.get().zoom || { z: 1 };
    if (zm.z > 1.05) setZoom({ z: 1, cx: 0.5, cy: 0.5 });
    else ampliar(2, e.clientX, e.clientY);
  }, []);

  function updateSplit(e) {
    const display = displayRef.current;
    const src = source.current;
    if (!display || !src) return;
    const size = src.size;
    if (!size.width) return;
    const rect = display.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = rect.width * dpr, ch = rect.height * dpr;
    const fit = Math.min(cw / size.width, ch / size.height);
    const dw = size.width * fit;
    const dx = (cw - dw) / 2;
    const px = (e.clientX - rect.left) * dpr;
    splitRef.current = Math.max(0, Math.min(1, (px - dx) / dw));
  }

  // com a tela de acesso por cima, o card ocioso seria um segundo card empilhado
  const idle = !hideIdle && !s.cameraOn && s.sourceKind === 'camera';

  return html`
    <div class="viewport">
      <canvas
        ref=${displayRef}
        class="stage ${s.compare ? 'splitting' : ''}"
        onPointerDown=${onDown}
        onPointerMove=${onMove}
        onPointerUp=${onUp}
        onPointerCancel=${onUp}
        onPointerLeave=${ponteiroSaiu}
        onDoubleClick=${onDbl}
        style=${{ touchAction: 'none', cursor: ferr !== 'mover' && !s.compare ? 'crosshair' : s.zoomZ > 1 && !s.compare ? 'grab' : undefined }}
      ></canvas>

      ${idle && html`
        <div class="idle">
          <div class="idle-card">
            <h1>GPlanSiS<span>|</span>iaVision</h1>
            <p class="idle-sub">Visão computacional em tempo real, na tela e na palma da sua mão.</p>
            <p>
              Ligue a câmera — ou use um arquivo, a tela, uma câmera RTMP ou um vídeo do YouTube — e
              encadeie operadores clássicos e modelos de deep learning na barra flutuante.
            </p>
            <ul class="idle-feats" aria-label="Funcionalidades">
              <li><b>Detectar</b>YOLOX · RF-DETR · YOLO26 · YOLOE · Florence-2</li>
              <li><b>Segmentar</b>SAM 2 · recorte de fundo · instâncias</li>
              <li><b>Ler</b>OCR em português · QR e 12 tipos de código</li>
              <li><b>Rastrear</b>IDs estáveis · re-ID · contagem por linha</li>
              <li><b>Corpo</b>pose · mãos e gestos · rosto · olhos</li>
              <li><b>Medir</b>profundidade · Bike Fit · caixas orientadas</li>
              <li><b>Entender</b>Contexto · CLIP · Relações · Florence-2</li>
              <li><b>Ouvir</b>legendas e transcrição local</li>
              <li><b>Fontes</b>câmera · arquivo · tela · RTMP · YouTube</li>
              <li><b>Treinar</b>detector livre · anomalia · YOLO26</li>
            </ul>
            <button class="btn accent big" onClick=${() => window.__vlcStartCamera()}>
              Ligar câmera
            </button>
            <p class="idle-note">
              O browser vai pedir permissão. Nada sai desta máquina: captura,
              processamento e inferência rodam localmente, não existe upload.
            </p>
          </div>
        </div>
      `}
    </div>
  `;
}

/** Cores do palco conforme o tema (css/app.css e css/theme.css: --stage-bg, --accent). */
const palco = { fundo: '#02302C', texto: '#FFD84D' };
function lerPalco() {
  try {
    const cs = getComputedStyle(document.documentElement);
    palco.fundo = cs.getPropertyValue('--stage-bg').trim() || '#02302C';
    palco.texto = cs.getPropertyValue('--accent').trim() || '#FFD84D';
  } catch (_) { /* mantém o escuro */ }
}

/**
 * Recorte do zoom em coordenadas da fonte. cx/cy são o centro como o usuário
 * VÊ a imagem; com espelho, o x da fonte é o oposto do que aparece na tela.
 */
export function recorte(size, zoom, mirror) {
  const z = Math.max(1, Math.min(8, (zoom && zoom.z) || 1));
  const sw = size.width / z, sh = size.height / z;
  const cxv = zoom && Number.isFinite(zoom.cx) ? zoom.cx : 0.5;
  const cy = zoom && Number.isFinite(zoom.cy) ? zoom.cy : 0.5;
  const cx = mirror ? 1 - cxv : cxv;
  const sx = Math.max(0, Math.min(size.width - sw, cx * size.width - sw / 2));
  const sy = Math.max(0, Math.min(size.height - sh, cy * size.height - sh / 2));
  return { sx, sy, sw, sh };
}

/** Desenha o recorte `c` da fonte em resolução plena, aplicando o espelho se ligado. */
function drawSource(ctx, el, mirror, dx, dy, dw, dh, c) {
  const r = c || { sx: 0, sy: 0, sw: el.videoWidth || el.width, sh: el.videoHeight || el.height };
  ctx.save();
  if (mirror) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, 0, 0, dw, dh);
  } else {
    ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, dx, dy, dw, dh);
  }
  ctx.restore();
}

function drawSplitter(ctx, x, y, h, dpr) {
  ctx.strokeStyle = '#FFD84D';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  ctx.fillStyle = '#FFD84D';
  ctx.beginPath();
  ctx.arc(x, y + h / 2, 7 * dpr, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Amostra esparsa (1 a cada 97 pixels — primo, para não sincronizar com o
 * padrão da imagem) e testa se o frame é essencialmente preto.
 *
 * Critério: média baixa E fração desprezível de pixels claros. O pico NÃO
 * serve — frame preto de câmera real vem com ruído de sensor e às vezes uma
 * linha corrompida no topo, com pixels chegando a 250. Calibrado contra um
 * frame preto capturado de verdade desta webcam:
 *
 *   frame preto real   média  0.17   pixels>30   0.28%
 *   preto absoluto     média  0.00   pixels>30   0.00%
 *   sala escura        média  8.45   pixels>30   2.15%   <- não pode alarmar
 *   cena iluminada     média 116.26  pixels>30 100.00%
 */
export function isNearlyBlack(img) {
  const d = img.data;
  let sum = 0, n = 0, bright = 0;
  for (let p = 0; p < d.length; p += 4 * 97) {
    const v = (d[p] + d[p + 1] + d[p + 2]) / 3;
    sum += v;
    if (v > 30) bright++;
    n++;
  }
  if (!n) return false;
  return sum / n < 6 && bright / n < 0.01;
}

// ---------------------------------------------------------------- legenda

/**
 * Legenda no rodapé do canvas, estilo broadcast: faixa escura translúcida,
 * texto grande com contorno. O trecho fechado em branco; o provisório (o
 * motor ainda decidindo) em cinza, para a pessoa ver que está mudando.
 * Quebra em até duas linhas pela largura; mais que isso, corta o começo —
 * legenda mostra o que está sendo dito agora, não o parágrafo inteiro.
 */
function drawCaption(canvas) {
  if (!canvas) return;
  const leg = legendaAtual();
  if (!leg) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fs = Math.max(14, Math.min(30, Math.round(W / 42)));   // escala com a largura
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const maxW = W * 0.86;
  const partes = [];
  if (leg.final) partes.push({ t: leg.final, cor: '#f5f5f4' });
  if (leg.interim) partes.push({ t: leg.interim, cor: 'rgba(235,235,235,.72)' });

  // quebra por palavras, cada parte com a própria cor
  const linhas = [];
  for (const p of partes) {
    let atual = '';
    for (const w of p.t.split(' ')) {
      const tent = atual ? atual + ' ' + w : w;
      if (ctx.measureText(tent).width > maxW && atual) { linhas.push({ t: atual, cor: p.cor }); atual = w; }
      else atual = tent;
    }
    if (atual) linhas.push({ t: atual, cor: p.cor });
  }
  const mostrar = linhas.slice(-2);
  const lh = fs * 1.3;
  const padY = fs * 0.45, padX = fs * 0.8;
  const altura = mostrar.length * lh + padY * 2;
  const larg = Math.min(W - 16 * dpr, Math.max(...mostrar.map((l) => ctx.measureText(l.t).width)) + padX * 2);
  const y0 = H - altura - Math.max(10 * dpr, H * 0.06);
  const x0 = (W - larg) / 2;

  ctx.fillStyle = 'rgba(2,48,44,.62)';
  ctx.beginPath();
  const r = 8 * dpr;
  ctx.roundRect ? ctx.roundRect(x0, y0, larg, altura, r) : ctx.rect(x0, y0, larg, altura);
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, fs / 9);
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  mostrar.forEach((l, i) => {
    const y = y0 + padY + lh * (i + 1) - fs * 0.32;
    ctx.strokeText(l.t, W / 2, y);
    ctx.fillStyle = l.cor;
    ctx.fillText(l.t, W / 2, y);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- overlay

function drawOverlay(ctx, shapes, dx, dy, scale, dpr) {
  if (!shapes || !shapes.length) return;
  ctx.save();
  // alinhamento explícito: sem isto o texto herdava o 'center' de outro desenho e os banners saíam cortados à esquerda
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = Math.max(1, 1.6 * dpr);
  ctx.font = `${11 * dpr}px ui-monospace, monospace`;
  ctx.textBaseline = 'alphabetic';

  for (const sh of shapes) {
    if (sh.type === 'point') {
      const esm = sh.alpha > 0 && sh.alpha < 1;
      if (esm) ctx.globalAlpha = sh.alpha;
      ctx.fillStyle = sh.color || '#FFD84D';
      ctx.beginPath();
      ctx.arc(dx + sh.x * scale, dy + sh.y * scale, (sh.r || 3) * dpr * 0.9, 0, Math.PI * 2);
      ctx.fill();
      if (esm) ctx.globalAlpha = 1;
    } else if (sh.type === 'rect') {
      const x = dx + sh.x * scale, y = dy + sh.y * scale;
      const w = sh.w * scale, h = sh.h * scale;
      // esmaecida/tracejada: trilha perdida mostrada só pela previsão (tracking.js)
      const esm = sh.alpha > 0 && sh.alpha < 1;
      if (esm) ctx.globalAlpha = sh.alpha;
      if (sh.dash) ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.strokeStyle = sh.color || '#FFD84D';
      ctx.lineWidth = Math.max(1, 1.8 * dpr);
      ctx.strokeRect(x, y, w, h);
      if (sh.dash) ctx.setLineDash([]);
      if (sh.label) {
        const tw = ctx.measureText(sh.label).width + 9 * dpr;
        const th = 16 * dpr;
        const ly = y - th < dy ? y + h : y - th;   // não sair pela borda de cima
        ctx.fillStyle = sh.color || '#FFD84D';
        ctx.fillRect(x, ly, tw, th);
        ctx.fillStyle = '#02302C';
        ctx.fillText(sh.label, x + 4.5 * dpr, ly + 11.5 * dpr);
      }
      if (esm) ctx.globalAlpha = 1;
    } else if (sh.type === 'line') {
      // esmaecida/tracejada: ponto de visibilidade baixa (perna sob a saia, Motion 3D)
      const esm = sh.alpha > 0 && sh.alpha < 1;
      if (esm) ctx.globalAlpha = sh.alpha;
      if (sh.dash) ctx.setLineDash([5 * dpr, 4 * dpr]);
      ctx.strokeStyle = sh.color || '#FFD84D';
      ctx.lineWidth = Math.max(1, (sh.width || 1.6) * dpr);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(dx + sh.x1 * scale, dy + sh.y1 * scale);
      ctx.lineTo(dx + sh.x2 * scale, dy + sh.y2 * scale);
      ctx.stroke();
      if (sh.dash) ctx.setLineDash([]);
      if (esm) ctx.globalAlpha = 1;
    } else if (sh.type === 'banner') {
      // texto fixo no canto, em coordenadas de tela e não da imagem
      const x = dx + sh.x * scale, y = dy + sh.y * scale;
      ctx.font = `600 ${12 * dpr}px ui-monospace, monospace`;
      const tw = ctx.measureText(sh.text).width + 14 * dpr;
      ctx.fillStyle = 'rgba(2,48,44,.78)';
      ctx.fillRect(x, y, tw, 20 * dpr);
      ctx.fillStyle = sh.color || '#FFD84D';
      ctx.fillRect(x, y, 3 * dpr, 20 * dpr);
      ctx.fillStyle = '#f5f5f4';
      ctx.fillText(sh.text, x + 10 * dpr, y + 14 * dpr);
      ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    }
  }
  ctx.restore();
}

function label(ctx, text, x, y, dpr, align = 'left') {
  ctx.save();
  ctx.font = `600 ${10 * dpr}px ui-monospace, monospace`;
  ctx.textAlign = align;
  const w = ctx.measureText(text).width + 12 * dpr;
  ctx.fillStyle = 'rgba(2,48,44,.72)';
  ctx.fillRect(align === 'right' ? x - w : x, y - 13 * dpr, w, 18 * dpr);
  ctx.fillStyle = '#f5f5f4';
  ctx.fillText(text, align === 'right' ? x - 6 * dpr : x + 6 * dpr, y);
  ctx.restore();
}

/** Grava o zoom (limitado e com o centro dentro da imagem) e persiste. */
export function setZoom(z) {
  const zz = Math.max(1, Math.min(8, Number(z.z) || 1));
  const meia = 0.5 / zz;
  const cl = (v) => Math.max(meia, Math.min(1 - meia, Number.isFinite(v) ? v : 0.5));
  store.set({ zoom: { z: zz, cx: zz === 1 ? 0.5 : cl(z.cx), cy: zz === 1 ? 0.5 : cl(z.cy) } });
}
