/**
 * components/video/StudioVideo.js — a tela cheia "GPlanSiS|Vídeo": editor de
 * vídeo interno com controle de quadro e timeline no estilo DaVinci Resolve,
 * no tema do iaVision (claro e escuro; visor e timeline no palco escuro).
 *
 *   Abrir       vídeo da Fonte (arquivo), outro arquivo (botão ou arrastar),
 *               a última gravação da barra de vídeo, ou "Gravar trecho" da
 *               câmera/tela/YouTube/stream (grava o que o navegador já
 *               captura e abre o resultado).
 *   Visor       quadro exato (reprodutor.js), timecode HH:MM:SS:FF, saída
 *               com recorte/Ken Burns; modo recorte com alças e proporções.
 *   Seguir      "Seguir sujeito / Reenquadrar" (seguir.js): clique no sujeito
 *               (ou "pessoa principal"), análise quadro a quadro pela fila
 *               de inferência (YOLOX + ByteTrack, aparência ou SAM 2),
 *               trajetória suavizada → keyframes do recorte no clipe (c.seg),
 *               editáveis na timeline; saída 9:16 · 1:1 · 4:5 · 16:9 e
 *               predefinição 1080×1920 na exportação.
 *   Timeline    régua, V1 com miniaturas, A1 com forma de onda, zoom até o
 *               quadro, seleção, navalha, aparo, mover/reordenar, marcadores,
 *               entrada/saída (timeline.js).
 *   Edição      EDL não destrutiva (edl.js) com desfazer/refazer, salva no
 *               navegador por mídia (nome + tamanho + duração).
 *   Exportar    MP4 quadro a quadro com WebCodecs + mp4-muxer, ou tempo real
 *               (MediaRecorder) quando não dá (exportar.js); quadros JPEG para
 *               o +Projeto/Treinar (evento aiv:prints) e ZIP.
 *
 * Atalhos (com o editor aberto, o teclado é dele — exceto Ctrl/⌘+K da Via):
 * espaço tocar/pausar · J/K/L shuttle · ←/→ quadro · ⇧←/→ 10 quadros ·
 * ↑/↓ ponto de edição · Home/End · I/O entrada/saída (⌥X limpa) · M marcador
 * · B corta no playhead · ⇧B ferramenta navalha · A seleção · Delete apaga
 * (lacuna) · ⇧Delete apaga e fecha · Ctrl/⌘+Z/Y · Ctrl/⌘+A · C recorte ·
 * N encaixe · = / − zoom · ⇧Z ajustar · Z zoom de quadro · ⌘/Ctrl+E exportar
 * · ? atalhos · Esc.
 *
 * Gancho de teste: window.aivVideo (estado, abrir(blob), exportar…).
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { store } from '../../state/store.js';
import { melhorFormato, salvar, formatarBytes } from '../../cv/recorder.js';
import { indexar, indiceSintetico } from './midia.js';
import {
  Historico, clipeInicial, cortar, cortarEmTodos, apagar, apagarFaixa, fecharLacunas, fimTimeline, fimClipe,
  clipeEm, quadroNoClipe, passoQuadro, ajustarAoQuadro, timecode, chaveMidia, salvarProjeto, carregarProjeto,
  listarRecentes, clipesValidos, ordenar, durClipe, tempoDoQuadro, porKeyframe, apagarKeyframe, keyframesVisiveis, novoId,
} from './edl.js';
import { Timeline, ALTURA_TIMELINE } from './timeline.js';
import { Reprodutor, ajustarProporcao } from './reprodutor.js';
import { Miniaturas } from './miniaturas.js';
import { Onda } from './onda.js';
import { exportarVideo, exportarQuadros, tamanhoSaida, sondarExportacao, Cancelado, predefinidosValidos } from './exportar.js';
import { analisarClipe, keyframesDaAnalise, detectarPessoasNoQuadro, sam2Disponivel, SUAVIZACAO_PADRAO } from './seguir.js';
import { montarZip } from './zip.js';
import { tomarPedido, ultimaGravacao, emitirPrints } from './ponte.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import { FerramentasStudio } from '../studio/FerramentasStudio.js';
import { BotaoVia } from '../../via/BotaoVia.js';   // [VIA] botão «✦ Via» da barra (js/via/)

/* O CSS desta tela só baixa com ela (o app não paga por quem não edita vídeo). */
await new Promise((r) => {
  if (document.querySelector('link[data-vde-css]')) { r(); return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../../css/video-editor.css', import.meta.url).href;
  l.dataset.vdeCss = '';
  l.onload = r; l.onerror = r;
  document.head.appendChild(l);
});

const RET_TODO = { x: 0, y: 0, w: 1, h: 1 };
const PROPORCOES = [
  ['livre', 'Livre', null], ['orig', 'Original', 'orig'], ['16:9', '16:9', 16 / 9], ['9:16', '9:16', 9 / 16],
  ['1:1', '1:1', 1], ['4:5', '4:5', 4 / 5], ['4:3', '4:3', 4 / 3],
];
/* proporções do "Seguir sujeito" (saída para redes) */
const PROP_SEGUIR = [['9:16', 9 / 16], ['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9]];

export function StudioVideo({ onClose, source, onPickFile }) {
  // ------------------------------------------------------------ estado
  const [midia, setMidia] = useState(null);           // { blob, url, nome, ix, chave, origem }
  const [carregando, setCarregando] = useState('');
  const [clipes, setClipesBruto] = useState([]);
  const [sel, setSel] = useState(() => new Set());
  const [marcadores, setMarcadores] = useState([]);
  const [entrada, setEntrada] = useState(null);
  const [saida, setSaida] = useState(null);
  const [recorte, setRecorte] = useState(RET_TODO);
  const [proporcao, setProporcao] = useState('livre');
  const [modo, setModo] = useState('saida');          // 'saida' | 'recorte'
  const [kbEdit, setKbEdit] = useState(null);         // null | 'a' | 'b' (Ken Burns do clipe selecionado)
  const [retEdicao, setRetEdicao] = useState(RET_TODO);
  const [ferramenta, setFerramenta] = useState('selecao');
  const [encaixe, setEncaixe] = useState(true);
  const [loop, setLoop] = useState(false);
  const [mudo, setMudo] = useState(false);
  const [tocando, setTocando] = useState(false);
  const [taxa, setTaxa] = useState(1);
  const [dialogo, setDialogo] = useState(null);       // 'exportar' | 'quadros' | 'atalhos'
  const [msg, setMsgBruto] = useState('');
  const [, setVersao] = useState(0);
  const [inspetor, setInspetor] = useState(() => window.innerWidth >= 1000);
  const [gravando, setGravando] = useState(null);     // { inicio, rec }
  const [arrastandoArq, setArrastandoArq] = useState(false);
  const [ondaPct, setOndaPct] = useState(0);
  const [kfSel, setKfSel] = useState(null);           // keyframe selecionado { id, i } (Seguir sujeito)
  const [alvo, setAlvo] = useState(null);             // modo 'alvo': { tipo: 'seguir', op } | { tipo: 'kf' }
  const [alvoCaixas, setAlvoCaixas] = useState(null); // pessoas detectadas no quadro do clique (dica visual)
  const [segEstado, setSegEstado] = useState(null);   // { fase, pct, txt, res, erro }
  const [predefExp, setPredefExp] = useState(null);   // predefinição pré-escolhida no diálogo de exportação

  const videoRef = useRef(null);
  const visorRef = useRef(null);
  const tlRef = useRef(null);
  const zoomRef = useRef(null);       // slider do zoom: atualizado direto (sem re-render a cada roda/pinça)
  const tl = useRef(null);
  const rep = useRef(null);
  const mini = useRef(null);
  const onda = useRef(null);
  const hist = useRef(new Historico());
  const tRef = useRef(0);
  const ouvintesT = useRef(new Set());
  const msgT = useRef(null);
  const arquivoRef = useRef(null);
  const exp = useRef({ cancelar: false });
  const resultados = useRef({});

  const setMsg = useCallback((t) => {
    setMsgBruto(t);
    clearTimeout(msgT.current);
    if (t) msgT.current = setTimeout(() => setMsgBruto(''), 6000);
  }, []);

  // estado corrente para os objetos fora do React (timeline, reprodutor, teclado)
  const E = useRef({});
  const v = midia && midia.ix.video;
  const clipeSel = sel.size === 1 ? clipes.find((c) => sel.has(c.id)) : null;
  const pnAtual = (p = proporcao) => {
    const item = PROPORCOES.find((x) => x[0] === p);
    if (!item || !item[2] || !v) return null;
    return item[2] === 'orig' ? v.largura / v.altura : item[2];
  };
  // no Ken Burns a proporção é a do recorte geral (a saída tem um tamanho só)
  const proporcaoEdicao = kbEdit && v ? (recorte.w * v.largura) / (recorte.h * v.altura) : pnAtual();
  Object.assign(E.current, {
    midia, v, clipes, sel, marcadores, entrada, saida, recorte, modo, kbEdit, retEdicao, ferramenta, encaixe,
    loop, tocando, taxa, dialogo, proporcao: proporcaoEdicao, clipeSel, kfSel, alvo, alvoCaixas,
    rotuloEdicao: kbEdit ? (kbEdit === 'a' ? 'Ken Burns: início do clipe' : 'Ken Burns: fim do clipe') : 'recorte',
    rotuloAlvo: alvo && alvo.tipo === 'kf' ? 'Clique onde o recorte deve centrar neste quadro (Esc cancela)'
      : 'Clique no sujeito a seguir — ←/→ trocam de quadro · Esc cancela',
  });

  // ------------------------------------------------------------ montagem

  useEffect(() => {
    document.body.classList.add('vde-aberto');
    // as ferramentas de mouse (marcações sobre o vídeo do app) ficam de fora enquanto o editor está aberto
    const ferrAntes = store.get().ferramentas;
    if (ferrAntes !== false) store.set({ ferramentas: false });
    // a Fonte em arquivo pausa enquanto se edita (não faz sentido o pipeline decodificar por baixo); volta ao fechar
    const fonte = source && source.current;
    const vidFonte = fonte && fonte.kind === 'video' && fonte.video && !fonte.video.paused ? fonte.video : null;
    if (vidFonte) vidFonte.pause();
    return () => {
      if (vidFonte && source.current === fonte && fonte.kind === 'video') vidFonte.play().catch(() => {});
      document.body.classList.remove('vde-aberto');
      if (ferrAntes !== false && store.get().ferramentas === false) store.set({ ferramentas: ferrAntes });
    };
  }, []);

  const avisarT = useCallback((t) => { tRef.current = t; for (const f of ouvintesT.current) f(t); }, []);

  useEffect(() => {
    const t = new Timeline(tlRef.current, {
      aoPlayhead: (x, arrastando) => {
        if (x === null) return;
        const r = rep.current;
        if (r.tocando) { r.pausar(); setTocando(false); }
        const e = E.current;
        if (!e.v) return;
        const fim = fimTimeline(e.v, e.clipes);
        const tt = ajustarAoQuadro(e.v, e.clipes, Math.max(0, Math.min(fim - 1, x)), e.v.fps);
        r.irPara(tt, { ajustar: false });
        avisarT(tt);
        tl.current.setEstado({ playhead: tt });
        void arrastando;
      },
      aoSelecionar: (s) => { setSel(s); setKfSel(null); },
      aoKeyframe: (k) => { setKfSel(k); setSel(new Set([k.id])); },
      aoAlterar: (novos, rotulo) => aplicarRef.current(novos, rotulo),
      aoCortar: (x) => cortarEmRef.current(x),
      aoVista: () => { if (zoomRef.current && tl.current) zoomRef.current.value = String(tl.current.zoomNorm); },
      miniaturas: () => mini.current,
      onda: () => onda.current,
    });
    tl.current = t;
    const r = new Reprodutor(videoRef.current, visorRef.current, {
      obter: () => E.current,
      aoTempo: (x, toc) => { avisarT(x); if (tl.current) { tl.current.setEstado({ playhead: x }); if (toc) tl.current.seguir(x); } },
      aoRet: (ret, final) => aoRetRef.current(ret, final),
      aoAlvo: (nx, ny) => aoAlvoRef.current(nx, ny),
      aoEstado: () => { setTocando(rep.current.tocando); setTaxa(rep.current.taxa); },
      aoAviso: (t) => { setMudo(true); setMsg(t); },
    });
    rep.current = r;
    return () => { t.destruir(); r.destruir(); };
  }, []);

  // timeline acompanha o estado da edição
  useEffect(() => {
    if (!tl.current) return;
    tl.current.setEstado({ v, clipes, sel, marcadores, entrada, saida, ferramenta, encaixe, kfSel });
  }, [v, clipes, sel, marcadores, entrada, saida, ferramenta, encaixe, kfSel]);

  // visor redesenha quando muda o que ele mostra
  useEffect(() => { if (rep.current) rep.current.desenhar(); }, [recorte, modo, retEdicao, kbEdit, clipes, alvoCaixas]);
  // keyframe selecionado que deixou de existir (desfazer, apagar clipe)
  useEffect(() => {
    if (!kfSel) return;
    const c = clipes.find((x) => x.id === kfSel.id);
    if (!c || !c.seg || !c.seg.k[kfSel.i]) setKfSel(null);
  }, [clipes, kfSel]);
  useEffect(() => { if (videoRef.current) videoRef.current.muted = mudo; }, [mudo]);

  // limpeza da mídia
  useEffect(() => () => {
    if (mini.current) mini.current.liberar();
    if (onda.current) onda.current.liberar();
  }, []);
  useEffect(() => () => { if (midia && midia.url) URL.revokeObjectURL(midia.url); }, [midia]);

  // ------------------------------------------------------------ edição

  const snapshot = () => {
    const e = E.current;
    return { clipes: e.clipes, marcadores: e.marcadores, entrada: e.entrada, saida: e.saida, recorte: e.recorte };
  };
  const restaurar = (s) => {
    setClipesBruto(s.clipes); setMarcadores(s.marcadores); setEntrada(s.entrada); setSaida(s.saida); setRecorte(s.recorte);
    setSel((old) => new Set([...old].filter((id) => s.clipes.some((c) => c.id === id))));
    setKfSel(null);   // o índice do keyframe pode apontar para outro depois do desfazer
  };
  const aplicar = (novos, rotulo, extra) => {
    hist.current.guardar(snapshot());
    if (novos) setClipesBruto(novos);
    if (extra) {
      if ('marcadores' in extra) setMarcadores(extra.marcadores);
      if ('entrada' in extra) setEntrada(extra.entrada);
      if ('saida' in extra) setSaida(extra.saida);
      if ('recorte' in extra) setRecorte(extra.recorte);
    }
    if (rotulo) setMsg(rotulo);
    setVersao((n) => n + 1);
  };
  const aplicarRef = useRef(aplicar);
  aplicarRef.current = aplicar;

  const desfazer = () => { const s = hist.current.desfazer(snapshot()); if (s) { restaurar(s); setMsg('Desfeito'); } };
  const refazer = () => { const s = hist.current.refazerUm(snapshot()); if (s) { restaurar(s); setMsg('Refeito'); } };

  const cortarEm = (t) => {
    const e = E.current;
    if (!e.v) return;
    const r = cortar(e.v, e.clipes, t);
    if (!r) { setMsg('Nada a cortar aqui (borda de clipe ou lacuna).'); return; }
    aplicar(r, `Cortado em ${timecode(t, e.v.fps)}`);
  };
  const cortarEmRef = useRef(cortarEm);
  cortarEmRef.current = cortarEm;

  const apagarSel = (ripple) => {
    const e = E.current;
    if (!e.v) return;
    if (e.sel.size) {
      aplicar(apagar(e.v, e.clipes, e.sel, ripple), ripple ? 'Apagado e fechado (ripple)' : 'Apagado (ficou a lacuna)');
      setSel(new Set());
      return;
    }
    if (e.entrada !== null && e.saida !== null && e.saida > e.entrada) {
      aplicar(apagarFaixa(e.v, e.clipes, e.entrada, e.saida, ripple), ripple ? 'Trecho de entrada a saída removido e fechado' : 'Trecho de entrada a saída removido');
      return;
    }
    setMsg('Selecione um clipe (ou marque entrada e saída) para apagar.');
  };

  const irPara = (t) => {
    const e = E.current;
    if (!e.v) return;
    const r = rep.current;
    if (r.tocando) { r.pausar(); setTocando(false); }
    const fim = fimTimeline(e.v, e.clipes);
    const tt = Math.max(0, Math.min(t, Math.max(0, fim - 1)));
    const aj = ajustarAoQuadro(e.v, e.clipes, tt, e.v.fps);
    r.irPara(aj, { ajustar: false });
    avisarT(aj);
    tl.current.setEstado({ playhead: aj });
    tl.current.seguir(aj);
  };
  const passo = (k) => {
    const e = E.current;
    if (!e.v) return;
    const r = rep.current;
    if (r.tocando) { r.pausar(); setTocando(false); }
    irPara(passoQuadro(e.v, e.clipes, tRef.current, k, e.v.fps));
  };
  const pontoEdicao = (dir) => {
    const e = E.current;
    if (!e.v) return;
    const pts = new Set([0]);
    for (const c of e.clipes) { pts.add(c.em); pts.add(fimClipe(e.v, c)); }
    const lista = [...pts].sort((a, b) => a - b);
    const t = tRef.current;
    const alvo = dir > 0 ? lista.find((x) => x > t + 1) : [...lista].reverse().find((x) => x < t - 1);
    if (alvo !== undefined) irPara(alvo);
  };

  const tocarPausar = () => {
    const r = rep.current;
    if (!E.current.v) return;
    if (r.tocando) r.pausar(); else r.tocar(1);
    setTocando(r.tocando); setTaxa(r.taxa);
  };
  const shuttle = (dir) => {
    const r = rep.current;
    if (!E.current.v) return;
    let nova = dir;
    if (r.tocando && Math.sign(r.taxa) === dir) nova = Math.sign(r.taxa) * Math.min(4, Math.abs(r.taxa) * 2);
    if (r.tocando) r.pausar();
    r.tocar(nova);
    setTocando(true); setTaxa(nova);
    setMsg(`${nova < 0 ? '◀◀ ré' : '▶▶'} ${Math.abs(nova)}×`);
  };
  const pausar = () => { const r = rep.current; if (r.tocando) r.pausar(); setTocando(false); };

  const marcar = (qual) => {
    const e = E.current;
    if (!e.v) return;
    const t = tRef.current;
    if (qual === 'i') { const s = e.saida !== null && e.saida <= t ? null : e.saida; aplicar(null, `Entrada em ${timecode(t, e.v.fps)}`, { entrada: t, saida: s }); }
    else {
      // a saída inclui o quadro do playhead
      const c = clipeEm(e.v, e.clipes, t);
      const fimQ = c ? t + (e.v.pts[quadroNoClipe(e.v, c, t) + 1] - e.v.pts[quadroNoClipe(e.v, c, t)]) : t + 1e6 / e.v.fps;
      const en = e.entrada !== null && e.entrada >= fimQ ? null : e.entrada;
      aplicar(null, `Saída em ${timecode(fimQ, e.v.fps)}`, { saida: fimQ, entrada: en });
    }
  };
  const alternarMarcador = () => {
    const e = E.current;
    if (!e.v) return;
    const t = tRef.current;
    const tol = 1e6 / e.v.fps / 2;
    const existe = e.marcadores.find((m) => Math.abs(m - t) < tol);
    aplicar(null, existe !== undefined ? 'Marcador removido' : `Marcador em ${timecode(t, e.v.fps)}`,
      { marcadores: existe !== undefined ? e.marcadores.filter((m) => m !== existe) : [...e.marcadores, t].sort((a, b) => a - b) });
  };
  const dividirNosMarcadores = () => {
    const e = E.current;
    const tempos = [...e.marcadores];
    if (e.entrada !== null) tempos.push(e.entrada);
    if (e.saida !== null) tempos.push(e.saida);
    if (!tempos.length) { setMsg('Sem marcadores, entrada ou saída para dividir.'); return; }
    const n0 = e.clipes.length;
    const r = cortarEmTodos(e.v, e.clipes, tempos);
    aplicar(r, `Dividido em ${r.length - n0} ponto(s)`);
  };

  // ------------------------------------------------------------ recorte e Ken Burns

  const entrarRecorte = (qual = null) => {
    const e = E.current;
    if (!e.v) return;
    if (qual && !e.clipeSel) { setMsg('Selecione um clipe para o zoom/pan (Ken Burns).'); return; }
    if (qual) {
      const c = e.clipeSel;
      const base = c.kb ? c.kb[qual] : e.recorte;
      setRetEdicao(base);
      // mostra o quadro de início/fim do clipe
      irPara(qual === 'a' ? c.em : fimClipe(e.v, c) - (e.v.pts[c.b] - e.v.pts[c.b - 1]));
    } else setRetEdicao(e.recorte);
    setKbEdit(qual);
    setModo('recorte');
  };
  const sairRecorte = () => { setModo('saida'); setKbEdit(null); setAlvo(null); setAlvoCaixas(null); };

  const aoRet = (ret, final) => {
    const e = E.current;
    setRetEdicao(ret);
    if (!final) return;
    if (e.kbEdit && e.clipeSel) {
      const c = e.clipeSel;
      const kb = { ...(c.kb || { a: e.recorte, b: e.recorte }), [e.kbEdit]: ret };
      aplicar(e.clipes.map((x) => (x.id === c.id ? { ...x, kb } : x)), `Ken Burns: ${e.kbEdit === 'a' ? 'início' : 'fim'} do clipe ajustado`);
    } else {
      aplicar(null, null, { recorte: ret });
    }
  };
  const aoRetRef = useRef(aoRet);
  aoRetRef.current = aoRet;

  const escolherProporcao = (p) => {
    setProporcao(p);
    const e = E.current;
    if (!e.v) return;
    const item = PROPORCOES.find((x) => x[0] === p);
    const pn = item && item[2] ? (item[2] === 'orig' ? 1 : item[2] * e.v.altura / e.v.largura) : null;
    if (!pn) return;
    const novo = ajustarProporcao(e.recorte, pn);
    // clipes com Ken Burns seguem a nova proporção (mesmo centro)
    const ajustados = e.clipes.map((c) => (c.kb ? { ...c, kb: { a: ajustarProporcao(c.kb.a, pn), b: ajustarProporcao(c.kb.b, pn) } } : c));
    aplicar(ajustados, `Proporção ${item[1]}`, { recorte: novo });
    setRetEdicao(novo);
    if (E.current.modo !== 'recorte') setModo('recorte');
    setKbEdit(null);
  };
  const restaurarRecorte = () => {
    aplicar(E.current.clipes.map((c) => (c.kb ? { ...c, kb: undefined } : c)), 'Recorte e Ken Burns desfeitos', { recorte: RET_TODO });
    setRetEdicao(RET_TODO); setProporcao('livre'); setKbEdit(null);
  };
  const kbLimpar = () => {
    const e = E.current;
    if (!e.clipeSel) return;
    aplicar(e.clipes.map((x) => (x.id === e.clipeSel.id ? { ...x, kb: undefined } : x)), 'Ken Burns removido do clipe');
    if (e.kbEdit) sairRecorte();
  };

  // ------------------------------------------------------------ seguir sujeito / reenquadrar

  /** O clipe a reenquadrar: o selecionado, ou o que está sob o playhead. */
  const clipeAlvo = () => {
    const e = E.current;
    if (!e.v) return null;
    return e.clipeSel || clipeEm(e.v, e.clipes, tRef.current);
  };
  /** Quadro da mídia sob o playhead (no clipe c). */
  const quadroAtual = (c) => {
    const e = E.current;
    const t = tRef.current;
    if (t >= c.em && t < fimClipe(e.v, c)) return quadroNoClipe(e.v, c, t);
    return c.a;
  };

  /** Começa: "clique no sujeito" entra no modo alvo; "pessoa principal" analisa direto. */
  const iniciarSeguir = (op) => {
    const e = E.current;
    const c = clipeAlvo();
    if (!c) { setMsg('Ponha o playhead sobre um clipe (ou selecione um) para seguir o sujeito.'); return; }
    seguirOp.current = { ...op, clipeId: c.id };
    if (op.alvo === 'clique') {
      setDialogo(null); setSegEstado(null);
      if (!(tRef.current >= c.em && tRef.current < fimClipe(e.v, c))) irPara(c.em);
      setKbEdit(null);
      setAlvo({ tipo: 'seguir', op });
      setModo('alvo');
      setAlvoCaixas(null);
      // dica visual: as pessoas que o detector vê neste quadro (se o modelo já estiver em memória ou baixar rápido)
      if (op.motor !== 'aparencia') {
        rep.current.ocioso().then(() => detectarPessoasNoQuadro(videoRef.current)).then((cx) => {
          if (E.current.modo === 'alvo') setAlvoCaixas(cx);
        }).catch(() => {});
      }
      return;
    }
    analisarSeguir(c, quadroAtual(c), null, op);
  };
  const seguirOp = useRef(null);

  const aoAlvo = (nx, ny) => {
    const e = E.current;
    const a = e.alvo;
    if (!a) return;
    if (a.tipo === 'kf') {
      // reposiciona/cria o keyframe deste quadro: o recorte centra no ponto clicado
      const c = clipeEm(e.v, e.clipes, tRef.current);
      sairRecorte();
      if (!c || !c.seg) { setMsg('O playhead não está num clipe com reenquadramento.'); return; }
      const q = quadroNoClipe(e.v, c, tRef.current);
      const novos = porKeyframe(e.clipes, c.id, q, nx, ny);
      aplicar(novos, `Keyframe em q${q} ajustado`);
      const i = novos.find((x) => x.id === c.id).seg.k.findIndex((x) => x[0] === q);
      setKfSel({ id: c.id, i });
      return;
    }
    const c = clipeEm(e.v, e.clipes, tRef.current) || e.clipes.find((x) => x.id === (seguirOp.current && seguirOp.current.clipeId));
    sairRecorte();
    if (!c) { setMsg('O playhead saiu do clipe: posicione-o num clipe e tente de novo.'); return; }
    analisarSeguir(c, quadroAtual(c), { x: nx, y: ny }, a.op);
  };
  const aoAlvoRef = useRef(aoAlvo);
  aoAlvoRef.current = aoAlvo;

  /** Roda a análise e aplica os keyframes ao clipe (uma entrada no desfazer). */
  const analisarSeguir = async (c, qRef, ponto, op) => {
    const e = E.current;
    const midia = e.midia;
    if (!midia || !e.v) return;
    const vv = e.v;
    exp.current = { cancelar: false };
    setDialogo('seguir');
    setSegEstado({ fase: 'rodando', pct: 0, txt: 'Preparando…' });
    if (mini.current) mini.current.pausar(true);
    const t0ms = performance.now();
    try {
      const an = await analisarClipe({
        blob: midia.blob, url: midia.url, ix: midia.ix, c, qRef, ponto, motor: op.motor, passo: op.passo,
        deslocEl: rep.current ? rep.current.desloc : 0,
        cancelado: () => exp.current.cancelar,
        aoProgresso: (f, txt) => setSegEstado({ fase: 'rodando', pct: f, txt }),
      });
      // tamanho do recorte: o maior da proporção pedida, dividido pelo zoom
      const prop = PROP_SEGUIR.find((x) => x[0] === op.prop) || PROP_SEGUIR[0];
      const pn = prop[1] * vv.altura / vv.largura;
      const max = ajustarProporcao({ x: 0, y: 0, w: 1, h: 1 }, pn);
      const z = Math.max(1, op.zoom || 1);
      const tam = { w: max.w / z, h: max.h / z };
      const r = keyframesDaAnalise(vv, c, an.amostras, tam, { suavidade: op.suavidade, zonaMorta: op.zonaMorta });
      if (!r || !r.k.length) throw new Error('não foi possível montar a trajetória');
      const atual = E.current;
      const novoRet = { x: (1 - tam.w) / 2, y: (1 - tam.h) / 2, w: tam.w, h: tam.h };
      const seg = { k: r.k, motor: an.motor, prop: prop[0] };
      const novos = atual.clipes.map((x) => { if (x.id !== c.id) return x; const n = { ...x, seg }; delete n.kb; return n; });
      const NOMES = { pessoa: 'pessoa (YOLOX + ByteTrack)', aparencia: 'aparência', sam2: 'SAM 2' };
      aplicar(novos, `Seguir sujeito: ${r.k.length} keyframes · ${NOMES[an.motor] || an.motor}`, { recorte: novoRet });
      const idProp = PROPORCOES.find((x) => x[0] === prop[0]) ? prop[0] : 'livre';
      setProporcao(idProp); setRetEdicao(novoRet);
      setSel(new Set([c.id])); setKfSel(null);
      const res = {
        k: r.k.length, motor: an.motor, nomeMotor: NOMES[an.motor] || an.motor, analisados: an.analisados, perdidos: an.perdidos,
        segundos: (performance.now() - t0ms) / 1000, prop: prop[0], saida: tamanhoSaida(vv, novoRet, 1), avisos: an.avisos || [],
      };
      resultados.current.seguir = { ...res, amostras: an.amostras, k: r.k, traj: r.traj, clipeId: c.id, tam };
      setSegEstado({ fase: 'pronto', pct: 1, res });
      // volta ao quadro do clique para mostrar o resultado
      irPara(tempoDoQuadro(vv, c, qRef));
    } catch (err) {
      if (err instanceof Cancelado) { setSegEstado(null); setDialogo(null); setMsg('Análise cancelada.'); }
      else { console.error('[vídeo] seguir:', err); setSegEstado({ fase: 'erro', erro: err.message || String(err) }); }
    } finally {
      if (mini.current) mini.current.pausar(false);
    }
  };

  const removerSeguir = () => {
    const e = E.current;
    const c = e.clipeSel;
    if (!c || !c.seg) return;
    aplicar(e.clipes.map((x) => { if (x.id !== c.id) return x; const n = { ...x }; delete n.seg; return n; }), 'Reenquadramento removido do clipe');
    setKfSel(null);
  };
  const apagarKfSel = () => {
    const e = E.current;
    if (!e.kfSel) return false;
    aplicar(apagarKeyframe(e.clipes, e.kfSel.id, e.kfSel.i), 'Keyframe apagado');
    setKfSel(null);
    return true;
  };
  const reposicionarKf = () => {
    const e = E.current;
    const c = e.v && clipeEm(e.v, e.clipes, tRef.current);
    if (!c || !c.seg) { setMsg('Leve o playhead a um clipe com reenquadramento.'); return; }
    setKbEdit(null); setAlvo({ tipo: 'kf' }); setModo('alvo');
  };

  // ------------------------------------------------------------ abrir mídia

  const abrir = useCallback(async (blob, nome, origem, marcExtra = null) => {
    if (!blob || !blob.size) { setMsg('Arquivo vazio.'); return; }
    if (blob.type && !/^video\/|application\/octet-stream|^$/.test(blob.type) && !/\.(mp4|m4v|mov|webm|mkv)$/i.test(nome || '')) {
      setMsg('Isto não parece um vídeo (' + blob.type + ').'); return;
    }
    const r = rep.current;
    r.pausar(); setTocando(false);
    setCarregando('Lendo o índice de quadros…');
    // o <video> começa a carregar JÁ, em paralelo com a leitura do índice
    const url = URL.createObjectURL(blob);
    const el = videoRef.current;
    const carregou = new Promise((res, rej) => {
      el.onloadeddata = () => res();
      el.onerror = () => rej(new Error('o navegador não abre este vídeo'));
    });
    carregou.catch(() => {});
    el.src = url;
    let ix = null;
    let pctIx = -1;
    try {
      ix = await indexar(blob, { aoProgresso: (f) => { const p = Math.round(f * 100); if (p !== pctIx) { pctIx = p; setCarregando(`Lendo o índice de quadros… ${p}%`); } } });
    } catch (err) {
      console.warn('[vídeo] índice:', err);
      ix = null;
    }
    try {
      await carregou;
    } catch (err) {
      setCarregando('');
      URL.revokeObjectURL(url);
      setMsg('Falha ao abrir: ' + err.message);
      return;
    }
    if (!ix || !ix.video || !ix.video.n) {
      // sem índice: quadros sintéticos a partir da duração e do fps medido
      const fps = await medirFps(el);
      const dur = el.duration;
      const vv = indiceSintetico(Number.isFinite(dur) ? dur : 0, fps);
      vv.largura = el.videoWidth; vv.altura = el.videoHeight; vv.codec = null;
      ix = { formato: '?', video: vv, audio: null, sintetico: true, duracaoUs: vv.pts[vv.n] };
      setMsg('Contêiner sem índice legível: quadros estimados pelo fps — a exportação será em tempo real.');
    } else {
      if (!ix.video.largura) { ix.video.largura = el.videoWidth; ix.video.altura = el.videoHeight; }
      // vídeo de celular em pé (matriz de rotação 90/270): o editor trabalha no referencial da TELA
      // (o do <video>); as dimensões codificadas ficam para o decodificador (exportar.js)
      const vr = ix.video;
      if ((vr.rotacao === 90 || vr.rotacao === 270) && !vr.larguraCod) {
        vr.larguraCod = vr.largura; vr.alturaCod = vr.altura;
        vr.largura = vr.alturaCod; vr.altura = vr.larguraCod;
      }
    }
    const vv = ix.video;
    const chave = chaveMidia(nome, blob.size, ix.duracaoUs, vv.n);
    const salvo = carregarProjeto(chave);
    hist.current = new Historico();
    let cl = clipeInicial(vv);
    let mk = [], en = null, sa = null, rc = RET_TODO, pr = 'livre';
    if (salvo && clipesValidos(vv, salvo.clipes)) {
      cl = salvo.clipes; mk = salvo.marcadores || []; en = salvo.entrada ?? null; sa = salvo.saida ?? null;
      rc = salvo.recorte || RET_TODO; pr = salvo.proporcao || 'livre';
      if (salvo.fps && salvo.fps !== vv.fps) vv.fps = salvo.fps;
    }
    // marcadores pedidos por quem abriu (ex.: Resumo de vídeo por eventos, CV-66), em µs da mídia
    if (Array.isArray(marcExtra) && marcExtra.length) mk = [...new Set([...mk, ...marcExtra.filter(Number.isFinite).map(Math.round)])].sort((a, b) => a - b);
    if (mini.current) mini.current.liberar();
    if (onda.current) onda.current.liberar();
    E.current.v = vv;
    E.current.clipes = cl;
    E.current.recorte = rc;
    setMidia({ blob, url, nome: nome || 'vídeo', ix, chave, origem });
    setClipesBruto(cl); setMarcadores(mk); setEntrada(en); setSaida(sa); setRecorte(rc); setProporcao(pr);
    setRetEdicao(rc); setSel(new Set()); setModo('saida'); setKbEdit(null); setKfSel(null); setAlvo(null); setAlvoCaixas(null);
    await r.calibrar();
    mini.current = new Miniaturas({ blob, url, v: vv, desloc: r.desloc, aoChegar: () => tl.current && tl.current.pedir() });
    let pctAnt = -1;
    const o = new Onda(blob, ix, (f) => {
      const pct = Math.round(f * 100);
      if (pct !== pctAnt) { pctAnt = pct; setOndaPct(f); }
      if (tl.current) tl.current.pedir();
    });
    onda.current = o;
    o.calcular().then(() => { if (tl.current) tl.current.pedir(); setVersao((n) => n + 1); });
    tl.current.vInit = false;
    tl.current.setEstado({ v: vv, clipes: cl, marcadores: mk, entrada: en, saida: sa, sel: new Set(), playhead: 0 });
    tl.current.ajustar();
    r.irPara(0);
    avisarT(0);
    setCarregando('');
    setDialogo(null);
    if (salvo && clipesValidos(vv, salvo.clipes)) setMsg(`Edição anterior desta mídia restaurada (${cl.length} clipe(s)).`);
    else if (!ix.sintetico) setMsg(`${vv.n} quadros · ${vv.fps} fps${vv.cfr ? '' : ' (taxa variável)'} · ${vv.largura}×${vv.altura}`);
  }, []);

  // pedido de abertura vindo da barra de vídeo / evento
  // (onda 2-d: o pedido pode trazer `depois` — marcadores, trechos, reenquadramento
  // ou ir a um instante, vindos do painel Aplicações — e chegar com o editor já
  // aberto, pelo evento aiv:video-pedido; ver ponte.js)
  useEffect(() => {
    const atender = () => {
      const p = tomarPedido();
      if (!p) return;
      (async () => {
        try {
          const atual = E.current.midia;
          const mesma = atual && p.blob && (atual.blob === p.blob || (atual.blob.size === p.blob.size && atual.nome === (p.nome || atual.nome)));
          if (!mesma) {
            const blob = p.blob || await (await fetch(p.url)).blob();
            await abrir(blob, p.nome || 'video-da-fonte', p.origem || 'fonte', p.marcadores || null);
            await new Promise((r) => setTimeout(r, 80));   // deixa o React aplicar o estado da mídia nova
          } else if (Array.isArray(p.marcadores) && p.marcadores.length) {
            const mk = [...new Set([...(E.current.marcadores || []), ...p.marcadores.filter(Number.isFinite).map(Math.round)])].sort((a, b) => a - b);
            aplicarRef.current(null, 'Marcadores adicionados', { marcadores: mk });
          }
          if (typeof p.depois === 'function' && E.current.v) {
            const e = E.current;
            const r = p.depois({ v: e.v, clipes: e.clipes, marcadores: e.marcadores || [], recorte: e.recorte, novoId });
            if (r) {
              const extra = {};
              if (r.marcadores) extra.marcadores = r.marcadores;
              if (r.recorte) extra.recorte = r.recorte;
              if (r.clipes || r.marcadores || r.recorte) aplicarRef.current(r.clipes || null, r.rotulo || null, extra);
              else if (r.rotulo) setMsg(r.rotulo);
              if (r.recorte) setRetEdicao(r.recorte);
              if (Number.isFinite(r.irPara)) setTimeout(() => irPara(r.irPara), 60);
            }
          }
        } catch (err) { setMsg('Não consegui abrir o vídeo pedido: ' + err.message); }
      })();
    };
    atender();
    window.addEventListener('aiv:video-pedido', atender);
    return () => window.removeEventListener('aiv:video-pedido', atender);
  }, []);

  // salva a edição (debounce)
  useEffect(() => {
    if (!midia || !v) return undefined;
    const id = setTimeout(() => salvarProjeto(midia.chave, {
      nome: midia.nome, clipes, marcadores, entrada, saida, recorte, proporcao, fps: v.fps,
    }), 400);
    return () => clearTimeout(id);
  }, [midia, clipes, marcadores, entrada, saida, recorte, proporcao]);

  const abrirArquivo = (f) => { if (f) abrir(f, f.name, 'arquivo'); };

  const fonteArquivo = () => {
    const s = source && source.current;
    return s && s.kind === 'video' && s.url ? s : null;
  };
  const fonteAoVivo = () => {
    const s = source && source.current;
    if (!s || s.kind === 'video' || s.kind === 'image') return null;
    const el = s.element;
    return el && el.tagName === 'VIDEO' ? el : null;
  };
  const abrirDaFonte = async () => {
    const s = fonteArquivo();
    if (!s) { setMsg('A fonte atual não é um arquivo de vídeo.'); return; }
    try { await abrir(await (await fetch(s.url)).blob(), 'video-da-fonte', 'fonte'); }
    catch (err) { setMsg('Falha ao ler o vídeo da fonte: ' + err.message); }
  };
  const abrirGravacao = () => {
    const g = ultimaGravacao();
    if (g) abrir(g.blob, g.nome, 'gravação');
  };

  // ------------------------------------------------------------ gravar trecho (câmera, tela, YouTube, stream)

  const gravarTrecho = () => {
    const el = fonteAoVivo();
    if (!el) { setMsg('Ligue uma fonte ao vivo (câmera, tela, YouTube ou stream) para gravar um trecho.'); return; }
    let stream = null;
    let reles = null;
    /*
     * Câmera: grava por um canvas-relé, não pela trilha. Trocar de câmera no
     * meio (Fonte do Studio, painel Fonte) PARA a trilha antiga — o
     * MediaRecorder ficaria com uma trilha morta e o trecho congelava. O relé
     * desenha o <video> da fonte (o mesmo elemento, com o srcObject novo) e
     * segue gravando a câmera nova.
     */
    if (store.get().sourceKind === 'camera') {
      const cv = document.createElement('canvas');
      cv.width = el.videoWidth || 1280; cv.height = el.videoHeight || 720;
      const g = cv.getContext('2d');
      let vivo = true;
      const passo = () => {
        if (!vivo) return;
        const v = fonteAoVivo() || el;
        if (v.videoWidth && (v.videoWidth !== cv.width || v.videoHeight !== cv.height)) { cv.width = v.videoWidth; cv.height = v.videoHeight; }
        try { if (v.readyState >= 2) g.drawImage(v, 0, 0, cv.width, cv.height); } catch (_) { /* quadro ainda não pronto */ }
        if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(passo); else requestAnimationFrame(passo);
      };
      passo();
      // rVFC para de chamar se o <video> trocar de fonte sem quadro novo: um pulso de segurança
      const pulso = setInterval(() => { const v = fonteAoVivo() || el; try { if (v.readyState >= 2) g.drawImage(v, 0, 0, cv.width, cv.height); } catch (_) { /* idem */ } }, 250);
      try { stream = cv.captureStream(30); } catch (_) { stream = null; }
      reles = () => { vivo = false; clearInterval(pulso); if (stream) for (const t of stream.getTracks()) t.stop(); };
    }
    try {
      if (stream) { /* relé da câmera */ }
      else if (el.srcObject && typeof el.srcObject.getTracks === 'function') stream = new MediaStream(el.srcObject.getTracks().filter((t) => t.readyState === 'live'));
      else if (el.captureStream) stream = el.captureStream();
      else if (el.mozCaptureStream) stream = el.mozCaptureStream();
    } catch (_) { stream = null; }
    if (!stream || !stream.getVideoTracks().length) { if (reles) reles(); setMsg('Não consegui capturar a imagem desta fonte.'); return; }
    const comAudio = stream.getAudioTracks().length > 0;
    const fmt = melhorFormato(comAudio);
    if (!fmt) { setMsg('Este navegador não grava vídeo.'); return; }
    const w = el.videoWidth || 1280, h = el.videoHeight || 720;
    const pedacos = [];
    let rec;
    try {
      rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: Math.round(Math.max(6e6, Math.min(25e6, w * h * 30 * 0.1))), audioBitsPerSecond: 160000 });
    } catch (err) { if (reles) reles(); setMsg('Falha ao gravar: ' + err.message); return; }
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) pedacos.push(ev.data); };
    rec.addEventListener('stop', () => { if (reles) reles(); });
    rec.onstop = () => {
      const blob = new Blob(pedacos, { type: fmt.mime.split(';')[0] });
      const nome = `trecho-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${fmt.ext}`;
      setGravando(null);
      abrir(blob, nome, 'gravação');
    };
    rec.start(1000);
    setGravando({ inicio: Date.now(), rec, fmt, comAudio });
    setMsg(`Gravando a fonte em ${fmt.nome}${comAudio ? ' com áudio' : ' (a fonte não tem áudio)'}…`);
  };
  const pararGravacao = () => { if (gravando && gravando.rec.state !== 'inactive') gravando.rec.stop(); };
  useEffect(() => () => { if (gravando && gravando.rec.state !== 'inactive') { gravando.rec.onstop = null; gravando.rec.stop(); } }, [gravando]);

  // ------------------------------------------------------------ exportar

  const [expEstado, setExpEstado] = useState(null);   // { fase, pct, txt, res, erro }
  const faixa = (qual) => {
    const e = E.current;
    const fim = fimTimeline(e.v, e.clipes);
    if (qual === 'io' && (e.entrada !== null || e.saida !== null)) return [e.entrada ?? 0, Math.min(fim, e.saida ?? fim)];
    return [0, fim];
  };
  const nomeBase = () => ((E.current.midia && E.current.midia.nome) || 'video').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'video';

  const iniciarExport = async (op) => {
    const e = E.current;
    const midia = e.midia;
    if (!midia) return;
    exp.current = { cancelar: false };
    const [t0, t1] = faixa(op.faixa);
    setExpEstado({ fase: 'rodando', pct: 0, txt: 'Preparando…' });
    const t0ms = performance.now();
    if (mini.current) mini.current.pausar(true);   // as miniaturas cedem o decodificador/CPU à exportação
    try {
      const res = await exportarVideo({
        blob: midia.blob, url: midia.url, ix: midia.ix, clipes: e.clipes, recorte: e.recorte, t0, t1,
        escala: op.escala, qualidade: op.qualidade, comAudio: op.audio, nomeBase: nomeBase(),
        modo: op.modo || 'auto', deslocEl: rep.current ? rep.current.desloc : 0,
        cancelado: () => exp.current.cancelar,
        aoProgresso: (f, fase, n, tot) => setExpEstado({ fase: 'rodando', pct: f, txt: fase === 'áudio' ? 'Áudio…' : n !== undefined ? `Quadro ${n} de ${tot}` : fase }),
      });
      res.segundos = (performance.now() - t0ms) / 1000;
      setExpEstado({ fase: 'pronto', pct: 1, res });
      resultados.current.exportacao = res;
    } catch (err) {
      if (err instanceof Cancelado) { setExpEstado(null); setMsg('Exportação cancelada.'); } else { console.error('[vídeo] exportar:', err); setExpEstado({ fase: 'erro', erro: err.message || String(err) }); }
    } finally {
      if (mini.current) mini.current.pausar(false);
    }
  };

  const iniciarQuadros = async (op) => {
    const e = E.current;
    const midia = e.midia;
    if (!midia) return;
    exp.current = { cancelar: false };
    let cl = e.clipes, t0, t1;
    if (op.faixa === 'sel' && e.sel.size) { cl = e.clipes.filter((c) => e.sel.has(c.id)); t0 = 0; t1 = Infinity; }
    else [t0, t1] = faixa(op.faixa);
    setExpEstado({ fase: 'rodando', pct: 0, txt: 'Preparando…' });
    if (mini.current) mini.current.pausar(true);
    try {
      const imgs = await exportarQuadros({
        blob: midia.blob, url: midia.url, ix: midia.ix, clipes: cl, recorte: e.recorte, t0, t1,
        passo: { tipo: op.tipo, valor: op.valor }, larguraMax: op.larguraMax, nomeBase: nomeBase(),
        deslocEl: rep.current ? rep.current.desloc : 0,
        cancelado: () => exp.current.cancelar,
        aoProgresso: (f, _, n, tot) => setExpEstado({ fase: 'rodando', pct: f, txt: `Imagem ${n} de ${tot}` }),
      });
      if (op.projeto) {
        emitirPrints(imgs.map((x) => x.blob), imgs.map((x) => x.nome), {
          midia: midia.nome, trecho: { t0, t1: Number.isFinite(t1) ? t1 : null },
          quadros: imgs.map((x) => x.q), tempos: imgs.map((x) => x.t),
        });
      }
      let zip = null;
      if (op.zip) zip = { blob: await montarZip(imgs), nome: `${nomeBase()}-quadros.zip` };
      setExpEstado({ fase: 'pronto', pct: 1, quadros: { n: imgs.length, zip, projeto: op.projeto } });
      resultados.current.quadros = imgs;
      if (zip) baixar(zip);
    } catch (err) {
      if (err instanceof Cancelado) { setExpEstado(null); setMsg('Exportação cancelada.'); }
      else { console.error('[vídeo] quadros:', err); setExpEstado({ fase: 'erro', erro: err.message || String(err) }); }
    } finally {
      if (mini.current) mini.current.pausar(false);
    }
  };

  const usarComoFonte = (res) => {
    if (!onPickFile) return;
    const f = new File([res.blob], res.nome, { type: res.tipo });
    onPickFile(f);
    setMsg('Vídeo exportado aberto como fonte do iaVision.');
    onClose();
  };

  // ------------------------------------------------------------ teclado

  useEffect(() => {
    const onKey = (ev) => {
      const t = ev.target;
      const k = ev.key;
      const ctrl = ev.ctrlKey || ev.metaKey;
      if (ctrl && !ev.altKey && !ev.shiftKey && k.toLowerCase() === 'k') return;   // Via
      const emCampo = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (emCampo && k !== 'Escape') return;
      const pega = () => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      const e = E.current;
      if (k === 'Escape' && fonteStudioAberta()) return;   // o popover da Fonte fecha primeiro
      if (k === 'Escape') {
        pega();
        if (e.dialogo) setDialogo(null);
        else if (e.modo === 'recorte' || e.modo === 'alvo') sairRecorte();
        else if (e.sel.size) setSel(new Set());
        else if (e.ferramenta === 'navalha') setFerramenta('selecao');
        return;
      }
      if (e.dialogo) return;
      const low = k.toLowerCase();
      if (ctrl) {
        if (low === 'z' && !ev.shiftKey) { pega(); desfazer(); }
        else if ((low === 'z' && ev.shiftKey) || low === 'y') { pega(); refazer(); }
        else if (low === 'a') { pega(); setSel(new Set(e.clipes.map((c) => c.id))); }
        else if (low === 'b') { pega(); cortarEm(tRef.current); }
        else if (low === 'e') { pega(); if (e.v) setDialogo('exportar'); }
        return;
      }
      pega();
      if (!e.v) return;
      if (ev.altKey) {
        if (low === 'i' || ev.code === 'KeyI') aplicar(null, 'Entrada limpa', { entrada: null });
        else if (low === 'o' || ev.code === 'KeyO') aplicar(null, 'Saída limpa', { saida: null });
        else if (low === 'x' || ev.code === 'KeyX') aplicar(null, 'Entrada e saída limpas', { entrada: null, saida: null });
        return;
      }
      switch (k) {
        case ' ': tocarPausar(); return;
        case 'ArrowLeft': passo(ev.shiftKey ? -10 : -1); return;
        case 'ArrowRight': passo(ev.shiftKey ? 10 : 1); return;
        case 'ArrowUp': pontoEdicao(-1); return;
        case 'ArrowDown': pontoEdicao(1); return;
        case 'Home': irPara(0); return;
        case 'End': irPara(fimTimeline(e.v, e.clipes) - 1); return;
        case 'Delete': case 'Backspace': if (!ev.shiftKey && apagarKfSel()) return; apagarSel(ev.shiftKey); return;
        case '=': case '+': tl.current.zoomPara(tl.current.pxPorS * 1.6); return;
        case '-': case '_': tl.current.zoomPara(tl.current.pxPorS / 1.6); return;
        case '?': setDialogo('atalhos'); return;
        default: break;
      }
      if (ev.shiftKey) {
        if (low === 'z') tl.current.ajustar();
        else if (low === 'b') setFerramenta((f) => (f === 'navalha' ? 'selecao' : 'navalha'));
        return;
      }
      switch (low) {
        case 'j': shuttle(-1); break;
        case 'k': pausar(); break;
        case 'l': shuttle(1); break;
        case 'i': marcar('i'); break;
        case 'o': marcar('o'); break;
        case 'm': alternarMarcador(); break;
        case 'b': cortarEm(tRef.current); break;
        case 'a': setFerramenta('selecao'); break;
        case 'c': if (e.modo === 'recorte') sairRecorte(); else entrarRecorte(); break;
        case 'n': setEncaixe((x) => !x); setMsg(`Encaixe ${e.encaixe ? 'desligado' : 'ligado'}`); break;
        case 'z': tl.current.zoomQuadro(); break;
        default: break;
      }
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  }, []);

  // ------------------------------------------------------------ arrastar arquivo

  const onDragOver = (ev) => { if ([...(ev.dataTransfer.types || [])].includes('Files')) { ev.preventDefault(); setArrastandoArq(true); } };
  const onDrop = (ev) => {
    ev.preventDefault(); setArrastandoArq(false);
    const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) abrirArquivo(f);
  };

  // ------------------------------------------------------------ gancho de teste
  useEffect(() => {
    window.aivVideo = {
      estado: () => ({ ...E.current, t: tRef.current, tocando: rep.current.tocando, taxa: rep.current.taxa, qMostrado: rep.current.qMostrado, desloc: rep.current.desloc, zoom: tl.current.pxPorS }),
      abrir: (blob, nome) => abrir(blob, nome, 'teste'),
      irPara, passo, cortarEm: (t) => cortarEm(t ?? tRef.current), aplicar: (c, r) => aplicar(c, r), desfazer, refazer,
      selecionar: (ids) => setSel(new Set(ids)), apagar: apagarSel, marcar, alternarMarcador, entrarRecorte, sairRecorte,
      setRecorte: (r) => aplicar(null, null, { recorte: r }), escolherProporcao, setDialogo, tocar: () => tocarPausar(), shuttle, pausar,
      timeline: () => tl.current, reprodutor: () => rep.current, exportar: iniciarExport, quadros: iniciarQuadros,
      resultados: () => resultados.current, gravarTrecho, pararGravacao,
      seguir: iniciarSeguir, alvo: (nx, ny) => aoAlvo(nx, ny), selecionarKf: (k) => setKfSel(k), apagarKf: apagarKfSel,
      reposicionarKf, removerSeguir, segEstado: () => segEstado, cancelarSeguir: () => { exp.current.cancelar = true; },
    };
    return () => { delete window.aivVideo; };
  });

  // ------------------------------------------------------------ render

  const fimT = v ? fimTimeline(v, clipes) : 0;
  const saidaPx = v ? tamanhoSaida(v, recorte, 1) : null;
  const temIO = entrada !== null || saida !== null;
  const mostraInicio = !midia || dialogo === 'abrir';
  const g = mostraInicio ? ultimaGravacao() : null;
  const recentes = mostraInicio ? listarRecentes() : [];

  return html`
    <div class="vde ${arrastandoArq ? 'vde-soltar' : ''}" role="dialog" aria-modal="true" aria-label="GPlanSiS|Vídeo — editor de vídeo"
         onDragOver=${onDragOver} onDragLeave=${(ev) => { if (ev.target === ev.currentTarget) setArrastandoArq(false); }} onDrop=${onDrop}>
      <header class="vde-barra">
        <div class="vde-titulo"><span class="vde-marca">GPlanSiS<i>|</i></span>Vídeo</div>
        ${midia && html`<span class="vde-nome" title=${midia.nome}>${midia.nome}</span>`}
        <button class="vde-btn" onClick=${() => setDialogo('abrir')} title="Abrir outro vídeo, a fonte, uma gravação ou gravar um trecho">📂<span class="vde-rot"> Abrir</span></button>
        <${FonteStudio} classeBotao="vde-btn" semTexto=${true} />
        <${FerramentasStudio} classeBotao="vde-btn" semTexto=${true} alvo=${visorRef} transformacao=${() => (rep.current && rep.current.geometria ? rep.current.geometria() : null)} />
        <input ref=${arquivoRef} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" hidden
               onChange=${(ev) => { abrirArquivo(ev.target.files[0]); ev.target.value = ''; }} />
        <span class="vde-sep"></span>
        <button class="vde-btn" onClick=${desfazer} disabled=${!hist.current.podeDesfazer} title="Desfazer (Ctrl/⌘+Z)" aria-label="Desfazer">↶</button>
        <button class="vde-btn" onClick=${refazer} disabled=${!hist.current.podeRefazer} title="Refazer (Ctrl/⌘+Y)" aria-label="Refazer">↷</button>
        <span class="vde-sep"></span>
        <button class="vde-btn ${modo === 'recorte' && !kbEdit ? 'on' : ''}" disabled=${!v} onClick=${() => (modo === 'recorte' ? sairRecorte() : entrarRecorte())}
                title="Recorte do quadro (C): arraste as alças sobre o visor">⛶<span class="vde-rot"> Recorte</span></button>
        <button class="vde-btn ${modo === 'alvo' ? 'on' : ''}" disabled=${!v} onClick=${() => (modo === 'alvo' ? sairRecorte() : (setSegEstado(null), setDialogo('seguir')))}
                title="Seguir sujeito / Reenquadrar: o recorte acompanha uma pessoa ou objeto (9:16, 1:1, 4:5, 16:9)">◎<span class="vde-rot"> Seguir sujeito</span></button>
        <button class="vde-btn acento" disabled=${!v} onClick=${() => { setPredefExp(null); setDialogo('exportar'); }} title="Exportar o vídeo editado (Ctrl/⌘+E)">⇪<span class="vde-rot"> Exportar</span></button>
        <button class="vde-btn" disabled=${!v} onClick=${() => setDialogo('quadros')} title="Exportar quadros do trecho como imagens (para o +Projeto/Treinar ou ZIP)">🖼<span class="vde-rot"> Quadros</span></button>
        <${BotaoVia} modulo="video" classe="vde-btn" />
        <span class="vde-msg" role="status" aria-live="polite">${carregando || msg}</span>
        <button class="vde-btn ${inspetor ? 'on' : ''}" onClick=${() => setInspetor(!inspetor)} title="Mostrar/ocultar o inspetor (mídia, clipe, recorte)">☰</button>
        <button class="vde-btn" onClick=${() => setDialogo('atalhos')} title="Atalhos de teclado (?)" aria-label="Atalhos de teclado">?</button>
        <button class="vde-btn vde-x" onClick=${onClose} title="Fechar o editor" aria-label="Fechar o editor">✕</button>
      </header>

      <div class="vde-meio">
        <div class="vde-visor">
          <video ref=${videoRef} class="vde-video" playsInline preload="auto" aria-hidden="true"></video>
          <canvas ref=${visorRef} class="vde-tela" aria-label="Visor do vídeo"></canvas>
          ${!midia && !carregando && html`<${TelaInicial}
              aoArquivo=${() => arquivoRef.current.click()} fonteArquivo=${Boolean(fonteArquivo())} aoFonte=${abrirDaFonte}
              gravacao=${g} aoGravacao=${abrirGravacao} aoVivo=${Boolean(fonteAoVivo())} gravando=${gravando}
              aoGravar=${gravarTrecho} aoParar=${pararGravacao} recentes=${recentes} />`}
          ${carregando && html`<div class="vde-carregando" role="status"><span class="vde-giro"></span>${carregando}</div>`}
          ${midia && gravando && html`<div class="vde-rec-flutua"><b>● REC</b> <${Cronometro} desde=${gravando.inicio} /> <button class="vde-btn" onClick=${pararGravacao}>Parar e editar</button></div>`}
          ${modo === 'alvo' && v && html`
            <div class="vde-recorte-barra" role="toolbar" aria-label="Seguir sujeito">
              <b>${alvo && alvo.tipo === 'kf' ? 'Reposicionar keyframe' : 'Seguir sujeito'}</b>
              <span class="vde-dica-barra">${alvo && alvo.tipo === 'kf' ? 'clique onde o recorte deve centrar' : 'clique no sujeito (← → mudam o quadro)'}</span>
              <button class="vde-chip" onClick=${sairRecorte}>Cancelar</button>
            </div>`}
          ${modo === 'recorte' && v && html`
            <div class="vde-recorte-barra" role="toolbar" aria-label="Recorte">
              <b>${kbEdit ? (kbEdit === 'a' ? 'Ken Burns · início' : 'Ken Burns · fim') : 'Recorte'}</b>
              ${!kbEdit && PROPORCOES.map(([id, rot]) => html`<button key=${id} class="vde-chip ${proporcao === id ? 'on' : ''}" onClick=${() => escolherProporcao(id)}>${rot}</button>`)}
              <button class="vde-chip" onClick=${() => aoRet(ajustarProporcao(RET_TODO, proporcaoEdicao ? proporcaoEdicao * v.altura / v.largura : null), true)}
                      title="O maior retângulo da proporção escolhida">Inteiro</button>
              <button class="vde-chip acento" onClick=${sairRecorte}>Concluir</button>
            </div>`}
        </div>
        ${inspetor && html`<${Inspetor} v=${v} midia=${midia} clipeSel=${clipeSel} sel=${sel} recorte=${recorte} saidaPx=${saidaPx}
            proporcao=${proporcao} kbEdit=${kbEdit} modo=${modo} ondaPct=${ondaPct} onda=${onda.current}
            aoProporcao=${escolherProporcao} aoRecorte=${() => (modo === 'recorte' && !kbEdit ? sairRecorte() : entrarRecorte())}
            aoRestaurar=${restaurarRecorte} aoKb=${entrarRecorte} aoKbLimpar=${kbLimpar}
            kfSel=${kfSel} aoSeguir=${() => { setSegEstado(null); setDialogo('seguir'); }} aoReposKf=${reposicionarKf}
            aoApagarKf=${apagarKfSel} aoRemoverSeguir=${removerSeguir}
            aoFps=${(f) => { if (v && f > 0) { v.fps = f; setVersao((n) => n + 1); tl.current.pedir(); } }}
            aoFechar=${() => setInspetor(false)} />`}
      </div>

      <div class="vde-transporte" role="toolbar" aria-label="Transporte">
        <${Timecode} assinar=${ouvintesT} fps=${v ? v.fps : 30} v=${v} clipes=${clipes} />
        <div class="vde-tbtns">
          <button class="vde-tb" disabled=${!v} onClick=${() => irPara(0)} title="Início (Home)" aria-label="Início">⏮</button>
          <button class="vde-tb" disabled=${!v} onClick=${() => passo(-1)} title="Quadro anterior (←) · ⇧← 10 quadros" aria-label="Quadro anterior">◀︎|</button>
          <button class="vde-tb ${tocando && taxa < 0 ? 'on' : ''}" disabled=${!v} onClick=${() => shuttle(-1)} title="Ré (J) — de novo acelera" aria-label="Ré">◀◀</button>
          <button class="vde-tb vde-play ${tocando ? 'on' : ''}" disabled=${!v} onClick=${tocarPausar} title="Tocar/pausar (espaço)" aria-label=${tocando ? 'Pausar' : 'Tocar'}>${tocando ? '❚❚' : '▶'}</button>
          <button class="vde-tb ${tocando && taxa > 1 ? 'on' : ''}" disabled=${!v} onClick=${() => shuttle(1)} title="Avançar rápido (L): 1×, 2×, 4×" aria-label="Avançar rápido">▶▶</button>
          <button class="vde-tb" disabled=${!v} onClick=${() => passo(1)} title="Próximo quadro (→) · ⇧→ 10 quadros" aria-label="Próximo quadro">|▶︎</button>
          <button class="vde-tb" disabled=${!v} onClick=${() => irPara(fimT - 1)} title="Fim (End)" aria-label="Fim">⏭</button>
          ${tocando && Math.abs(taxa) !== 1 && html`<span class="vde-taxa">${taxa < 0 ? '−' : ''}${Math.abs(taxa)}×</span>`}
        </div>
        <div class="vde-tbtns">
          <button class="vde-tb vde-io ${entrada !== null ? 'on' : ''}" disabled=${!v} onClick=${() => marcar('i')} title="Marcar entrada (I) · ⌥I limpa">I</button>
          <button class="vde-tb vde-io ${saida !== null ? 'on' : ''}" disabled=${!v} onClick=${() => marcar('o')} title="Marcar saída (O) · ⌥O limpa">O</button>
          <button class="vde-tb ${loop ? 'on' : ''}" disabled=${!v} onClick=${() => setLoop(!loop)} aria-pressed=${loop}
                  title="Repetir o trecho de entrada a saída">⟲</button>
          <button class="vde-tb" disabled=${!v} onClick=${() => setMudo(!mudo)} title=${mudo ? 'Ligar o som' : 'Tirar o som'} aria-pressed=${!mudo}>${mudo ? '🔇' : '🔊'}</button>
          ${temIO && v && html`<span class="vde-iotxt" title="Entrada → saída">${entrada !== null ? timecode(entrada, v.fps) : '—'} → ${saida !== null ? timecode(saida, v.fps) : '—'}</span>`}
        </div>
        <span class="vde-dur">${v ? 'duração ' + timecode(fimT, v.fps) : ''}</span>
      </div>

      <div class="vde-ferr" role="toolbar" aria-label="Ferramentas da timeline">
        <div class="vde-seg">
          <button class=${ferramenta === 'selecao' ? 'on' : ''} onClick=${() => setFerramenta('selecao')} title="Seleção (A): clique seleciona, Shift/Ctrl soma, arraste move, bordas aparam">⬚<span class="vde-rot"> Seleção</span></button>
          <button class=${ferramenta === 'navalha' ? 'on' : ''} onClick=${() => setFerramenta(ferramenta === 'navalha' ? 'selecao' : 'navalha')} title="Navalha (⇧B): clique num clipe corta ali">✂<span class="vde-rot"> Navalha</span></button>
        </div>
        <button class="vde-btn" disabled=${!v} onClick=${() => cortarEm(tRef.current)} title="Cortar no playhead (B)">✂<span class="vde-rot"> Cortar no playhead</span></button>
        <button class="vde-btn" disabled=${!v || (!sel.size && !(entrada !== null && saida !== null))} onClick=${() => apagarSel(false)} title="Apagar a seleção, deixando a lacuna (Delete) — sem seleção: o trecho de entrada a saída">🗑<span class="vde-rot"> Apagar</span></button>
        <button class="vde-btn" disabled=${!v || (!sel.size && !(entrada !== null && saida !== null))} onClick=${() => apagarSel(true)} title="Apagar e fechar a lacuna — ripple delete (⇧Delete)">⇤<span class="vde-rot"> Apagar e fechar</span></button>
        <button class="vde-btn" disabled=${!v} onClick=${alternarMarcador} title="Marcador no playhead (M)">◆<span class="vde-rot"> Marcador</span></button>
        <button class="vde-btn" disabled=${!v} onClick=${dividirNosMarcadores} title="Cortar em todos os marcadores e na entrada/saída">⫼<span class="vde-rot"> Dividir nos pontos</span></button>
        <button class="vde-btn" disabled=${!v} onClick=${() => aplicar(fecharLacunas(v, clipes), 'Lacunas fechadas')} title="Encostar todos os clipes, sem lacunas">⇥<span class="vde-rot"> Fechar lacunas</span></button>
        <button class="vde-btn ${encaixe ? 'on' : ''}" onClick=${() => setEncaixe(!encaixe)} aria-pressed=${encaixe} title="Encaixe nas bordas, playhead e marcadores (N)">🧲</button>
        <span class="vde-flex"></span>
        <div class="vde-zoom">
          <button class="vde-btn" disabled=${!v} onClick=${() => tl.current.ajustar()} title="Ajustar o vídeo inteiro à timeline (⇧Z)">⇔<span class="vde-rot"> Ajustar</span></button>
          <button class="vde-btn" disabled=${!v} onClick=${() => tl.current.zoomPara(tl.current.pxPorS / 1.6)} title="Afastar (−)" aria-label="Afastar">−</button>
          <input ref=${zoomRef} type="range" min="0" max="1" step="0.001" defaultValue="0" disabled=${!v} aria-label="Zoom da timeline"
                 title="Zoom da timeline — Ctrl/⌘ + roda ou pinça; até o nível de quadro"
                 onInput=${(ev) => tl.current.setZoomNorm(parseFloat(ev.target.value))} />
          <button class="vde-btn" disabled=${!v} onClick=${() => tl.current.zoomPara(tl.current.pxPorS * 1.6)} title="Aproximar (=)" aria-label="Aproximar">+</button>
          <button class="vde-btn" disabled=${!v} onClick=${() => tl.current.zoomQuadro()} title="Zoom de quadro (Z)">▦<span class="vde-rot"> Quadro</span></button>
        </div>
      </div>

      <div class="vde-tl">
        <canvas ref=${tlRef} class="vde-tl-cv" style=${{ height: ALTURA_TIMELINE + 'px' }} aria-label="Timeline: régua, trilha de vídeo V1 e de áudio A1"></canvas>
      </div>

      ${dialogo === 'abrir' && html`<${Modal} titulo="Abrir vídeo" aoFechar=${() => setDialogo(null)}>
          <${TelaInicial} embutida=${true}
              aoArquivo=${() => { setDialogo(null); arquivoRef.current.click(); }} fonteArquivo=${Boolean(fonteArquivo())} aoFonte=${abrirDaFonte}
              gravacao=${g} aoGravacao=${abrirGravacao} aoVivo=${Boolean(fonteAoVivo())} gravando=${gravando}
              aoGravar=${() => { setDialogo(null); gravarTrecho(); }} aoParar=${pararGravacao} recentes=${recentes} />
        <//>`}
      ${dialogo === 'seguir' && v && html`<${DialogoSeguir} v=${v} clipe=${clipeSel || clipeEm(v, clipes, tRef.current)} estado=${segEstado}
          aoIniciar=${iniciarSeguir} aoCancelar=${() => { exp.current.cancelar = true; }}
          aoExportar=${(pd) => { setSegEstado(null); setPredefExp(pd); setDialogo('exportar'); }}
          aoFechar=${() => { if (!segEstado || segEstado.fase !== 'rodando') { setDialogo(null); setSegEstado(null); } }} />`}
      ${dialogo === 'exportar' && v && html`<${DialogoExportar} v=${v} midia=${midia} recorte=${recorte} temIO=${temIO} estado=${expEstado} predef=${predefExp}
          faixa=${faixa} aoIniciar=${iniciarExport} aoCancelar=${() => { exp.current.cancelar = true; }}
          aoBaixar=${async (res) => { const onde = await salvar(res); if (onde !== 'cancelado') setMsg(`Salvo: ${res.nome} · ${formatarBytes(res.blob.size)}`); }}
          aoUsar=${usarComoFonte} aoEditar=${(res) => { setExpEstado(null); abrir(res.blob, res.nome, 'exportação'); }}
          aoFechar=${() => { if (!expEstado || expEstado.fase !== 'rodando') { setDialogo(null); setExpEstado(null); } }} />`}
      ${dialogo === 'quadros' && v && html`<${DialogoQuadros} v=${v} temIO=${temIO} temSel=${sel.size > 0} estado=${expEstado}
          faixa=${faixa} clipes=${clipes} sel=${sel} aoIniciar=${iniciarQuadros} aoCancelar=${() => { exp.current.cancelar = true; }}
          aoFechar=${() => { if (!expEstado || expEstado.fase !== 'rodando') { setDialogo(null); setExpEstado(null); } }} />`}
      ${dialogo === 'atalhos' && html`<${Modal} titulo="Atalhos do editor" aoFechar=${() => setDialogo(null)}><${Atalhos} /><//>`}
      ${arrastandoArq && html`<div class="vde-soltar-aviso">Solte o vídeo para abrir no editor</div>`}
    </div>
  `;
}

/* ====================================================================== partes */

/**
 * Timecode do playhead. Atualizado DIRETO no DOM (um rAF por lote de
 * avisos): tocando ou arrastando, nada do React re-renderiza a cada quadro.
 */
function Timecode({ assinar, fps, v, clipes }) {
  const bRef = useRef(null);
  const emRef = useRef(null);
  const dados = useRef({ t: 0 });
  Object.assign(dados.current, { fps, v, clipes });
  const pintar = () => {
    const d = dados.current;
    let info = '';
    if (d.v) {
      const c = clipeEm(d.v, d.clipes, d.t);
      if (c) {
        const q = quadroNoClipe(d.v, c, d.t);
        const i = ordenar(d.clipes).indexOf(c) + 1;
        info = `clipe ${i} · quadro ${q} da mídia (${timecode(d.v.pts[q], d.fps)})`;
      } else info = d.clipes.length ? 'lacuna' : '';
    }
    if (bRef.current) bRef.current.textContent = timecode(d.t, d.fps);
    if (emRef.current) emRef.current.textContent = info;
  };
  useEffect(() => {
    let raf = 0;
    const f = (x) => { dados.current.t = x; if (!raf) raf = requestAnimationFrame(() => { raf = 0; pintar(); }); };
    assinar.current.add(f);
    return () => { assinar.current.delete(f); cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => { pintar(); });
  return html`
    <div class="vde-tc">
      <b ref=${bRef} aria-label="Timecode do playhead"></b>
      <em ref=${emRef}></em>
    </div>`;
}

function Cronometro({ desde }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);
  const s = (Date.now() - desde) / 1000;
  return html`<span class="vde-mono">${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}</span>`;
}

function TelaInicial({ embutida, aoArquivo, fonteArquivo, aoFonte, gravacao, aoGravacao, aoVivo, gravando, aoGravar, aoParar, recentes }) {
  return html`
    <div class=${embutida ? 'vde-inicio embutida' : 'vde-inicio'}>
      ${!embutida && html`<h2>Editor de vídeo</h2><p class="vde-dica">Corte, apare, reordene e recorte com controle de quadro exato. A mídia original nunca é alterada.</p>`}
      <div class="vde-opcoes">
        <button class="vde-op principal" onClick=${aoArquivo}>
          <b>📂 Abrir arquivo de vídeo…</b><span>MP4, MOV, WebM, MKV — ou arraste o arquivo para esta tela</span>
        </button>
        ${fonteArquivo && html`<button class="vde-op" onClick=${aoFonte}><b>🎞 Vídeo da Fonte</b><span>o arquivo que está aberto no iaVision agora</span></button>`}
        ${gravacao && html`<button class="vde-op" onClick=${aoGravacao}><b>⏺ Última gravação</b><span>${gravacao.nome} · ${formatarBytes(gravacao.blob.size)}</span></button>`}
        ${aoVivo && !gravando && html`<button class="vde-op" onClick=${aoGravar}><b>● Gravar trecho para editar</b><span>grava a câmera/tela/YouTube/stream como o navegador recebe e abre aqui ao parar</span></button>`}
        ${gravando && html`<div class="vde-op gravando"><b>● Gravando… <${Cronometro} desde=${gravando.inicio} /></b><button class="vde-btn acento" onClick=${aoParar}>Parar e editar</button></div>`}
        ${!aoVivo && !gravando && html`<p class="vde-dica">Para gravar um trecho da câmera, da tela ou do YouTube, ligue a fonte no iaVision e volte aqui.</p>`}
      </div>
      ${recentes.length > 0 && html`
        <div class="vde-recentes">
          <b>Edições guardadas neste navegador</b>
          <ul>${recentes.slice(0, 6).map((r) => html`<li key=${r.chave}>${r.nome} <em>· ${r.clipes} clipe(s) · ${new Date(r.quando).toLocaleString('pt-BR')}</em></li>`)}</ul>
          <p class="vde-dica">Abra o mesmo arquivo para continuar de onde parou.</p>
        </div>`}
    </div>`;
}

function Inspetor({ v, midia, clipeSel, sel, recorte, saidaPx, proporcao, kbEdit, modo, ondaPct, onda, aoProporcao, aoRecorte, aoRestaurar, aoKb, aoKbLimpar, aoFps, aoFechar,
  kfSel, aoSeguir, aoReposKf, aoApagarKf, aoRemoverSeguir }) {
  const kfs = clipeSel && clipeSel.seg ? keyframesVisiveis(clipeSel) : [];
  const kfAqui = kfSel && clipeSel && kfSel.id === clipeSel.id && clipeSel.seg ? clipeSel.seg.k[kfSel.i] : null;
  return html`
    <aside class="vde-insp" aria-label="Inspetor">
      <button class="vde-insp-x" onClick=${aoFechar} aria-label="Fechar o inspetor">✕</button>
      <section>
        <h3>Mídia</h3>
        ${!v ? html`<p class="vde-dica">Nenhum vídeo aberto.</p>` : html`
          <dl>
            <dt>Resolução</dt><dd>${v.largura}×${v.altura}</dd>
            <dt>Quadros</dt><dd>${v.n}${v.sintetico ? ' (estimado)' : ''}</dd>
            <dt>fps</dt><dd><input class="vde-num" type="number" min="1" max="240" step="0.001" value=${v.fps}
                 title="fps nominal (timecode e lacunas). Detectado do arquivo; corrija se precisar."
                 onChange=${(e) => aoFps(parseFloat(e.target.value))} />${v.cfr ? '' : html` <em>variável</em>`}</dd>
            <dt>Duração</dt><dd title=${midia.ix.avisos && midia.ix.avisos.length ? midia.ix.avisos.join(' · ') : ''}>${timecode(v.pts[v.n] - v.pts[0], v.fps)}</dd>
            <dt>Codec</dt><dd>${v.codec || '—'}${midia.ix.audio ? ' · ' + (midia.ix.audio.codec || '?') + ' ' + midia.ix.audio.taxa + ' Hz' : ' · sem áudio'}</dd>
            ${onda && onda.temAudio && !onda.pronto && html`<dt>Onda</dt><dd>${Math.round(ondaPct * 100)}%</dd>`}
          </dl>`}
      </section>
      <section>
        <h3>Clipe</h3>
        ${!clipeSel ? html`<p class="vde-dica">${sel.size > 1 ? sel.size + ' clipes selecionados.' : 'Clique num clipe da timeline.'}</p>` : html`
          <dl>
            <dt>Mídia</dt><dd>q${clipeSel.a} → q${clipeSel.b - 1}</dd>
            <dt>Entrada</dt><dd>${timecode(v.pts[clipeSel.a], v.fps)}</dd>
            <dt>Saída</dt><dd>${timecode(v.pts[clipeSel.b], v.fps)}</dd>
            <dt>Duração</dt><dd>${timecode(durClipe(v, clipeSel), v.fps)} · ${clipeSel.b - clipeSel.a} q</dd>
            <dt>Na timeline</dt><dd>${timecode(clipeSel.em, v.fps)}</dd>
          </dl>
          <p class="vde-sub">Zoom/pan (Ken Burns)</p>
          <div class="vde-linha">
            <button class="vde-chip ${kbEdit === 'a' ? 'on' : ''}" onClick=${() => aoKb('a')} title="Enquadramento no primeiro quadro do clipe">Início</button>
            <button class="vde-chip ${kbEdit === 'b' ? 'on' : ''}" onClick=${() => aoKb('b')} title="Enquadramento no último quadro do clipe">Fim</button>
            <button class="vde-chip" disabled=${!clipeSel.kb} onClick=${aoKbLimpar}>Remover</button>
          </div>
          <p class="vde-dica">${clipeSel.seg ? 'Este clipe segue um sujeito (o reenquadramento tem prioridade sobre o Ken Burns).' : clipeSel.kb ? 'O enquadramento vai do início ao fim do clipe, suave nas pontas.' : 'Defina o enquadramento do início e do fim; a proporção é a do recorte.'}</p>
          <p class="vde-sub">Seguir sujeito</p>
          ${clipeSel.seg ? html`
            <dl>
              <dt>Keyframes</dt><dd>${kfs.length}${clipeSel.seg.prop ? ' · ' + clipeSel.seg.prop : ''}</dd>
              ${kfAqui && html`<dt>Selecionado</dt><dd>q${kfAqui[0]} · x ${(kfAqui[1] * 100).toFixed(1)}% · y ${(kfAqui[2] * 100).toFixed(1)}%</dd>`}
            </dl>
            <div class="vde-linha">
              <button class="vde-chip" onClick=${aoReposKf} title="Clique no visor para centrar o recorte neste quadro (cria ou ajusta o keyframe do quadro)">Ajustar aqui</button>
              <button class="vde-chip" disabled=${!kfAqui} onClick=${aoApagarKf} title="Apagar o keyframe selecionado (Delete) — ⌥/Alt+clique no losango também apaga">Apagar keyframe</button>
              <button class="vde-chip" onClick=${aoRemoverSeguir}>Remover</button>
            </div>
            <p class="vde-dica">Losangos na faixa do clipe: clique seleciona, arraste move no tempo.</p>` : html`
            <div class="vde-linha"><button class="vde-chip" onClick=${aoSeguir}>Seguir sujeito…</button></div>`}`}
      </section>
      <section>
        <h3>Recorte</h3>
        <div class="vde-linha">
          ${PROPORCOES.map(([id, rot]) => html`<button key=${id} class="vde-chip ${proporcao === id ? 'on' : ''}" disabled=${!v} onClick=${() => aoProporcao(id)}>${rot}</button>`)}
        </div>
        ${v && html`<dl>
          <dt>Saída</dt><dd>${saidaPx.w}×${saidaPx.h}</dd>
          <dt>Origem</dt><dd>x ${Math.round(recorte.x * v.largura)} · y ${Math.round(recorte.y * v.altura)}</dd>
        </dl>`}
        <div class="vde-linha">
          <button class="vde-chip ${modo === 'recorte' && !kbEdit ? 'on' : ''}" disabled=${!v} onClick=${aoRecorte}>${modo === 'recorte' && !kbEdit ? 'Concluir' : 'Editar recorte (C)'}</button>
          <button class="vde-chip" disabled=${!v} onClick=${aoRestaurar}>Restaurar</button>
        </div>
      </section>
    </aside>`;
}

function Modal({ titulo, aoFechar, children, largo }) {
  return html`
    <div class="vde-modal-fundo" onPointerDown=${(e) => { if (e.target === e.currentTarget) aoFechar(); }}>
      <div class="vde-modal ${largo ? 'largo' : ''}" role="dialog" aria-modal="true" aria-label=${titulo}>
        <header><b>${titulo}</b><button class="vde-btn" onClick=${aoFechar} aria-label="Fechar">✕</button></header>
        <div class="vde-modal-corpo">${children}</div>
      </div>
    </div>`;
}

function Progresso({ estado, aoCancelar }) {
  return html`
    <div class="vde-prog">
      <div class="vde-prog-barra"><span style=${{ width: Math.round((estado.pct || 0) * 100) + '%' }}></span></div>
      <div class="vde-linha"><span class="vde-mono">${Math.round((estado.pct || 0) * 100)}% · ${estado.txt || ''}</span>
        <span class="vde-flex"></span><button class="vde-btn" onClick=${aoCancelar}>Cancelar</button></div>
    </div>`;
}

function DialogoExportar({ v, midia, recorte, temIO, estado, faixa, aoIniciar, aoCancelar, aoBaixar, aoUsar, aoEditar, aoFechar, predef }) {
  const predefs = predefinidosValidos(v, recorte);
  const inicial = predef && predefs.find((x) => x.id === predef) ? 'p:' + predef : '1';
  const [op, setOp] = useState({ faixa: temIO ? 'io' : 'tudo', escala: inicial, qualidade: 1, audio: true, modo: 'auto' });
  // escala: número (100%, 75%…) ou predefinição 'p:LxA' → tamanho fixo
  const escalaDe = (x) => { const pd = String(x).startsWith('p:') && predefs.find((p) => 'p:' + p.id === x); return pd ? { w: pd.w, h: pd.h } : parseFloat(x) || 1; };
  // o navegador faz quadro exato COM som? (Safari 16.4–18 decodifica/codifica vídeo mas não codifica áudio)
  const [sonda, setSonda] = useState(null);
  useEffect(() => { let vivo = true; sondarExportacao(midia.ix, recorte).then((r) => { if (vivo) setSonda(r); }).catch(() => {}); return () => { vivo = false; }; }, []);
  const escolher = sonda && sonda.exato && !sonda.audio && midia.ix.audio && op.audio && typeof MediaRecorder !== 'undefined';
  const px = tamanhoSaida(v, recorte, escalaDe(op.escala));
  const [t0, t1] = faixa(op.faixa);
  const rodando = estado && estado.fase === 'rodando';
  return html`
    <${Modal} titulo="Exportar vídeo" aoFechar=${aoFechar}>
      ${(!estado || estado.fase === 'erro') && html`
        <div class="vde-form">
          <label>Trecho
            <select value=${op.faixa} onChange=${(e) => setOp({ ...op, faixa: e.target.value })}>
              <option value="tudo">Timeline inteira</option>
              <option value="io" disabled=${!temIO}>Entrada → saída (I/O)</option>
            </select></label>
          <label>Tamanho
            <select value=${op.escala} onChange=${(e) => setOp({ ...op, escala: e.target.value })}>
              <option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option><option value="0.25">25%</option>
              ${predefs.map((p) => html`<option key=${p.id} value=${'p:' + p.id}>${p.rot}</option>`)}
            </select></label>
          <label>Qualidade
            <select value=${op.qualidade} onChange=${(e) => setOp({ ...op, qualidade: parseFloat(e.target.value) })}>
              <option value="1.6">Alta</option><option value="1">Normal</option><option value="0.55">Leve</option>
            </select></label>
          <label class="vde-check"><input type="checkbox" checked=${op.audio} disabled=${!midia.ix.audio}
                 onChange=${(e) => setOp({ ...op, audio: e.target.checked })} /> Com áudio${midia.ix.audio ? '' : ' (a mídia não tem)'}</label>
          ${escolher && html`<label>Modo
            <select value=${op.modo} onChange=${(e) => setOp({ ...op, modo: e.target.value })}>
              <option value="auto">Tempo real, com som</option>
              <option value="exato">Quadro exato, sem som</option>
            </select></label>`}
        </div>
        ${escolher && html`<p class="vde-aviso">Este navegador não codifica áudio (${sonda.motivoAudio}). Com som, a exportação é em tempo real (sem garantia de quadro exato); quadro a quadro, sai sem som.</p>`}
        <p class="vde-dica">Saída ${px.w}×${px.h} · ${timecode(t1 - t0, v.fps)} · MP4 H.264${midia.ix.audio && op.audio ? ' + AAC' : ''}, quadro a quadro (WebCodecs). Sem suporte, cai para gravação em tempo real (WebM/MP4).</p>
        ${estado && estado.fase === 'erro' && html`<p class="vde-erro" role="alert">Falhou: ${estado.erro}</p>`}
        <div class="vde-linha fim"><button class="vde-btn" onClick=${aoFechar}>Fechar</button><button class="vde-btn acento" onClick=${() => aoIniciar({ ...op, escala: escalaDe(op.escala) })}>Exportar</button></div>`}
      ${rodando && html`<${Progresso} estado=${estado} aoCancelar=${aoCancelar} />`}
      ${estado && estado.fase === 'pronto' && estado.res && html`
        <div class="vde-ok">
          <p><b>Pronto:</b> ${estado.res.nome}</p>
          <p class="vde-dica">${estado.res.w}×${estado.res.h} · ${estado.res.quadros} quadros · ${formatarBytes(estado.res.blob.size)} · ${estado.res.codec} · ${estado.res.segundos.toFixed(1)} s
            ${estado.res.exato ? ' · quadro exato' : ' · tempo real'}</p>
          ${estado.res.avisos.map((a) => html`<p class="vde-aviso">${a}</p>`)}
          <div class="vde-linha fim">
            <button class="vde-btn" onClick=${() => aoEditar(estado.res)} title="Abrir o resultado no editor">Abrir no editor</button>
            <button class="vde-btn" onClick=${() => aoUsar(estado.res)} title="Abrir como fonte (arquivo) do iaVision e fechar o editor">Usar como fonte</button>
            <button class="vde-btn acento" onClick=${() => aoBaixar(estado.res)}>Baixar</button>
          </div>
        </div>`}
    <//>`;
}

function DialogoSeguir({ v, clipe, estado, aoIniciar, aoCancelar, aoExportar, aoFechar }) {
  const [op, setOp] = useState(() => {
    let salvo = {};
    try { salvo = JSON.parse(localStorage.getItem('gplansis.video.seguir') || '{}'); } catch (_) { salvo = {}; }
    return { prop: '9:16', alvo: 'clique', motor: 'auto', passo: 1, zoom: 1, ...SUAVIZACAO_PADRAO, ...salvo };
  });
  const [temSam, setTemSam] = useState(null);
  useEffect(() => { let vivo = true; sam2Disponivel().then((x) => { if (vivo) setTemSam(x); }); return () => { vivo = false; }; }, []);
  const mudar = (p) => { const n = { ...op, ...p }; setOp(n); try { localStorage.setItem('gplansis.video.seguir', JSON.stringify(n)); } catch (_) { /* sem storage */ } };
  // mesma proporção da mídia (16:9 de um 16:9): sem zoom não há para onde mover
  const propN = (PROP_SEGUIR.find((x) => x[0] === op.prop) || PROP_SEGUIR[0])[1];
  const mesma = Math.abs(propN / (v.largura / v.altura) - 1) < 0.02;
  const rodando = estado && estado.fase === 'rodando';
  const nq = clipe ? clipe.b - clipe.a : 0;
  const pd = estado && estado.res ? { '9:16': '1080x1920', '1:1': '1080x1080', '4:5': '1080x1350', '16:9': '1920x1080' }[estado.res.prop] : null;
  return html`
    <${Modal} titulo="Seguir sujeito / Reenquadrar" aoFechar=${aoFechar}>
      ${(!estado || estado.fase === 'erro') && html`
        ${!clipe ? html`<p class="vde-aviso">Ponha o playhead sobre um clipe (ou selecione um).</p>` : html`
        <div class="vde-form">
          <label>Proporção
            <span class="vde-linha">${PROP_SEGUIR.map(([id]) => html`<button key=${id} class="vde-chip ${op.prop === id ? 'on' : ''}" onClick=${() => mudar({ prop: id, zoom: Math.abs((PROP_SEGUIR.find((x) => x[0] === id)[1]) / (v.largura / v.altura) - 1) < 0.02 && op.zoom < 1.25 ? 1.5 : op.zoom })}>${id}</button>`)}</span></label>
          <label>Sujeito
            <select value=${op.alvo} onChange=${(e) => mudar({ alvo: e.target.value })}>
              <option value="clique">Clicar no sujeito no visor</option>
              <option value="principal">Pessoa principal (automático)</option>
            </select></label>
          <label>Rastreio
            <select value=${op.motor} onChange=${(e) => mudar({ motor: e.target.value })}>
              <option value="auto">Pessoa (YOLOX + ByteTrack); objeto: aparência</option>
              <option value="aparencia" disabled=${op.alvo !== 'clique'}>Aparência (objeto qualquer, sem modelo)</option>
              <option value="sam2" disabled=${!temSam || op.alvo !== 'clique'}>SAM 2 — máscara (preciso, lento)${temSam === false ? ' · indisponível' : ''}</option>
            </select></label>
          <label>Análise
            <select value=${op.passo} onChange=${(e) => mudar({ passo: parseInt(e.target.value, 10) })}>
              <option value="1">Cada quadro</option><option value="2">1 a cada 2 quadros</option><option value="3">1 a cada 3 quadros</option>
            </select></label>
          <label>Zoom
            <select value=${op.zoom} onChange=${(e) => mudar({ zoom: parseFloat(e.target.value) })}>
              <option value="1">1× (o maior recorte)</option><option value="1.25">1,25×</option><option value="1.5">1,5×</option><option value="2">2×</option>
            </select></label>
          <label>Suavidade
            <input type="range" min="0" max="1" step="0.05" value=${op.suavidade} onInput=${(e) => mudar({ suavidade: parseFloat(e.target.value) })} /></label>
          <label>Zona morta
            <select value=${op.zonaMorta} onChange=${(e) => mudar({ zonaMorta: parseFloat(e.target.value) })}>
              <option value="0">nenhuma</option><option value="0.008">pequena</option><option value="0.015">média</option><option value="0.03">grande</option>
            </select></label>
        </div>
        ${mesma && op.zoom <= 1 && html`<p class="vde-aviso">A proporção é a mesma do vídeo: com zoom 1× o recorte é o quadro inteiro e não tem para onde se mover — use 1,5× ou 2×.</p>`}
        <p class="vde-dica">Clipe ${timecode(v.pts[clipe.a], v.fps)} → ${timecode(v.pts[clipe.b], v.fps)} · ${Math.ceil(nq / Math.max(1, op.passo))} quadro(s) a analisar, pela fila de inferência (a interface segue livre). O recorte vira keyframes no clipe, editáveis na timeline; desfazer (Ctrl/⌘+Z) volta tudo.</p>`}
        ${estado && estado.fase === 'erro' && html`<p class="vde-erro" role="alert">Falhou: ${estado.erro}</p>`}
        <div class="vde-linha fim"><button class="vde-btn" onClick=${aoFechar}>Fechar</button>
          <button class="vde-btn acento" disabled=${!clipe} onClick=${() => aoIniciar(op)}>${op.alvo === 'clique' ? 'Escolher o sujeito…' : 'Analisar'}</button></div>`}
      ${rodando && html`<${Progresso} estado=${estado} aoCancelar=${aoCancelar} />`}
      ${estado && estado.fase === 'pronto' && estado.res && html`
        <div class="vde-ok">
          <p><b>Reenquadrado:</b> ${estado.res.k} keyframes · ${estado.res.prop} · saída ${estado.res.saida.w}×${estado.res.saida.h}</p>
          <p class="vde-dica">${estado.res.nomeMotor} · ${estado.res.analisados} quadros analisados em ${estado.res.segundos.toFixed(1)} s${estado.res.perdidos ? ` · sujeito perdido em ${estado.res.perdidos} (interpolado)` : ''}</p>
          ${estado.res.avisos.map((x) => html`<p class="vde-aviso">${x}</p>`)}
          <p class="vde-dica">Toque (espaço) para ver ao vivo. Na timeline, os losangos amarelos são os keyframes: arraste para mover, ⌥/Alt+clique ou Delete apaga; "Ajustar aqui" no inspetor reposiciona.</p>
          <div class="vde-linha fim">
            <button class="vde-btn" onClick=${aoFechar}>Fechar</button>
            ${pd && html`<button class="vde-btn acento" onClick=${() => aoExportar(pd)}>Exportar ${pd.replace('x', '×')}…</button>`}
          </div>
        </div>`}
    <//>`;
}

function DialogoQuadros({ v, temIO, temSel, estado, faixa, clipes, sel, aoIniciar, aoCancelar, aoFechar }) {
  const [op, setOp] = useState({ faixa: temSel ? 'sel' : temIO ? 'io' : 'tudo', tipo: 'segundos', valor: 1, larguraMax: 0, projeto: true, zip: true });
  let n = 0;
  {
    let dur = 0, quadros = 0;
    if (op.faixa === 'sel') for (const c of clipes) { if (sel.has(c.id)) { dur += durClipe(v, c); quadros += c.b - c.a; } }
    else { const [t0, t1] = faixa(op.faixa); dur = t1 - t0; quadros = Math.round(dur * v.fps / 1e6); }
    n = op.tipo === 'quadros' ? Math.ceil(quadros / Math.max(1, op.valor)) : Math.ceil(dur / 1e6 / Math.max(0.001, op.valor));
  }
  const rodando = estado && estado.fase === 'rodando';
  return html`
    <${Modal} titulo="Exportar quadros do trecho" aoFechar=${aoFechar}>
      ${(!estado || estado.fase === 'erro') && html`
        <div class="vde-form">
          <label>Trecho
            <select value=${op.faixa} onChange=${(e) => setOp({ ...op, faixa: e.target.value })}>
              <option value="sel" disabled=${!temSel}>Clipes selecionados</option>
              <option value="io" disabled=${!temIO}>Entrada → saída (I/O)</option>
              <option value="tudo">Timeline inteira</option>
            </select></label>
          <label>Um a cada
            <span class="vde-linha"><input class="vde-num" type="number" min=${op.tipo === 'quadros' ? 1 : 0.04} step=${op.tipo === 'quadros' ? 1 : 0.1} value=${op.valor}
                   onChange=${(e) => setOp({ ...op, valor: Math.max(op.tipo === 'quadros' ? 1 : 0.04, parseFloat(e.target.value) || 1) })} />
            <select value=${op.tipo} onChange=${(e) => setOp({ ...op, tipo: e.target.value, valor: e.target.value === 'quadros' ? 10 : 1 })}>
              <option value="segundos">segundo(s)</option><option value="quadros">quadro(s)</option>
            </select></span></label>
          <label>Largura máx.
            <select value=${op.larguraMax} onChange=${(e) => setOp({ ...op, larguraMax: parseInt(e.target.value, 10) })}>
              <option value="0">original</option><option value="1920">1920</option><option value="1280">1280</option><option value="640">640</option>
            </select></label>
          <label class="vde-check"><input type="checkbox" checked=${op.projeto} onChange=${(e) => setOp({ ...op, projeto: e.target.checked })} /> Enviar ao +Projeto / Treinar</label>
          <label class="vde-check"><input type="checkbox" checked=${op.zip} onChange=${(e) => setOp({ ...op, zip: e.target.checked })} /> Baixar ZIP (JPEG)</label>
        </div>
        <p class="vde-dica">≈ ${n} imagem(ns), com o recorte e o Ken Burns aplicados.</p>
        ${estado && estado.fase === 'erro' && html`<p class="vde-erro" role="alert">Falhou: ${estado.erro}</p>`}
        <div class="vde-linha fim"><button class="vde-btn" onClick=${aoFechar}>Fechar</button>
          <button class="vde-btn acento" disabled=${!op.projeto && !op.zip} onClick=${() => aoIniciar(op)}>Exportar quadros</button></div>`}
      ${rodando && html`<${Progresso} estado=${estado} aoCancelar=${aoCancelar} />`}
      ${estado && estado.fase === 'pronto' && estado.quadros && html`
        <div class="vde-ok">
          <p><b>${estado.quadros.n} imagem(ns) prontas.</b></p>
          ${estado.quadros.projeto && html`<p class="vde-dica">Enviadas ao +Projeto/Treinar (evento <code>aiv:prints</code>).</p>`}
          ${estado.quadros.zip && html`<p class="vde-dica">ZIP: ${estado.quadros.zip.nome} · ${formatarBytes(estado.quadros.zip.blob.size)}</p>`}
          <div class="vde-linha fim">
            ${estado.quadros.zip && html`<button class="vde-btn" onClick=${() => baixar(estado.quadros.zip)}>Baixar ZIP de novo</button>`}
            <button class="vde-btn acento" onClick=${aoFechar}>Fechar</button>
          </div>
        </div>`}
    <//>`;
}

const ATALHOS = [
  ['Espaço', 'tocar / pausar'], ['J · K · L', 'ré · pausa · avanço (repita J/L para 2× e 4×)'],
  ['← →', 'quadro anterior / próximo'], ['⇧← ⇧→', '10 quadros'], ['↑ ↓', 'ponto de edição anterior / próximo'],
  ['Home · End', 'início · fim'], ['I · O', 'entrada · saída (⌥I, ⌥O, ⌥X limpam)'], ['M', 'marcador no playhead (de novo remove)'],
  ['B · Ctrl/⌘+B', 'cortar no playhead'], ['⇧B', 'ferramenta navalha (clique corta)'], ['A', 'ferramenta seleção'],
  ['Clique · ⇧/Ctrl+clique', 'selecionar · somar à seleção'], ['Arrastar clipe', 'mover (sobre outro clipe: reordena)'],
  ['Arrastar borda', 'aparar (⇧ empurra os seguintes na saída)'], ['Delete', 'apagar seleção (fica a lacuna)'],
  ['⇧Delete', 'apagar e fechar (ripple)'], ['Ctrl/⌘+Z · Ctrl/⌘+Y', 'desfazer · refazer'], ['Ctrl/⌘+A', 'selecionar tudo'],
  ['C', 'recorte do quadro'], ['N', 'encaixe liga/desliga'], ['= · −', 'zoom da timeline'], ['Ctrl/⌘ + roda · pinça', 'zoom no ponteiro'],
  ['⇧Z · Z', 'ajustar à timeline · zoom de quadro'], ['Ctrl/⌘+E', 'exportar'], ['Esc', 'fecha diálogo / sai do recorte / limpa seleção'],
];
function Atalhos() {
  return html`<dl class="vde-atalhos">${ATALHOS.map(([k, d]) => html`<dt key=${k}><kbd>${k}</kbd></dt><dd>${d}</dd>`)}</dl>`;
}

/* ====================================================================== utilidades */

/** Download simples (ZIP de quadros): sem a caixa "salvar como", que exige gesto do usuário. */
function baixar({ blob, nome }) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** fps de um <video> sem índice: intervalos entre quadros apresentados (rVFC), tocando mudo por ~0,6 s. */
async function medirFps(el) {
  if (!('requestVideoFrameCallback' in el)) return 30;
  const mudo = el.muted;
  el.muted = true;
  const tempos = [];
  await new Promise((res) => {
    const to = setTimeout(res, 1500);
    const f = (_, m) => { tempos.push(m.mediaTime); if (tempos.length >= 16) { clearTimeout(to); res(); return; } el.requestVideoFrameCallback(f); };
    el.requestVideoFrameCallback(f);
    el.play().catch(() => res());
  });
  el.pause();
  el.currentTime = 0;
  el.muted = mudo;
  const d = [];
  for (let i = 1; i < tempos.length; i++) { const x = tempos[i] - tempos[i - 1]; if (x > 0.001) d.push(x); }
  if (!d.length) return 30;
  d.sort((a, b) => a - b);
  const f = 1 / d[0];   // o menor intervalo: quadros perdidos na medição só aumentam os outros
  const USUAIS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];
  let melhor = Math.round(f);
  for (const u of USUAIS) if (Math.abs(f - u) < Math.abs(f - melhor)) melhor = u;
  return melhor;
}
