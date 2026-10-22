/**
 * components/motion3d/StudioMotion3D.js — a tela cheia "GPlanSiS|Motion 3D Studio" (CV-88).
 *
 * Um editor de captura de movimento no padrão dos Studios do iaVision (Bike Fit, OEE, Fisio):
 *   barra superior   Salvar · ferramentas (orbitar/mover/girar/escala) · transporte (play, quadro,
 *                    parar, GRAVAR) · Layout · selo ON-DEVICE / GPU REMOTA · Fonte · fechar
 *   painel "Motion"  Live Link / Sources (Actor_Mocap pela Fonte do iaVision, Multicâmera do
 *                    GPlanSiS|ROBO, FreeMoCap, motores de servidor, modelos com estado real) e
 *                    Skeleton (silhueta com juntas, Retarget Profile, Preview Settings)
 *   viewport         vídeo com o esqueleto verde-água ⇄ 3D three.js (órbita, grade, piso), abas
 *                    Perspective / Lit / Show, barra LIVE · REC · transporte · Timecode · Frame ·
 *                    Rate · Buffer · Latency + histograma
 *   painel direito   World Outliner (busca, Label/Type) e Details (General/Animation/Physics/
 *                    Rendering/All)
 *   Content Browser  pastas, cartões das tomadas (A_Take_001…) com miniatura e busca, Add,
 *                    Import (BVH/FreeMoCap/JSON), Save All — tudo no IndexedDB deste navegador.
 * Nos três temas e no celular (painéis em gavetas).
 *
 * LGPD (04-SEGURANCA-LGPD-OPERACAO.md): processamento no aparelho por padrão; a gravação guarda
 * só landmarks (nunca vídeo); borrão de rosto opcional no vídeo e nas miniaturas; enviar vídeo a
 * um motor de servidor exige consentimento explícito e a tela mostra GPU REMOTA enquanto envia.
 * Ângulos e 3D de uma câmera são estimativas educacionais — não é laudo.
 *
 * Créditos: o MoCap (multicâmera, calibração pelo corpo, triangulação, pós-processamento, BVH,
 * cena) vem do GPlanSiS|ROBO (vendor/gplansis-robo-mocap). Gancho de teste: window.aivMotion3D.
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { store, persist } from '../../state/store.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import { estadoFonte, ouvirFonte } from '../../camera/fonte-app.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { modelStates, onModelState } from '../../cv/runtime/onnx.js';
import { canalMotion } from '../../cv/runtime/livres-v/canal.js';
import { processarTomada, exportarRobo, paraJSONStudio, timecode, novoId, ORIGENS, reamostrar } from '../../cv/runtime/livres-v/tomada.js';
import { importarArquivo } from '../../cv/runtime/livres-v/importar.js';
import { angulosQuadro, AVISO_ANGULOS, FONTE_ADM } from '../../cv/runtime/livres-v/angulos.js';
import { TABULEIROS, svgTabuleiro, conferirTabuleiro, GUIA_CALIBRACAO } from '../../cv/runtime/livres-v/charuco.js';
import * as armazem from '../../cv/runtime/livres-v/armazem.js';
import { MOTORES, ROTULO_ESTADO, capacidades, pedirJob, enviarVideo } from '../../cv/runtime/livres-v/conectores.js';
import { paraBVH, lerBVH, baseDeSuporte } from '../../../vendor/gplansis-robo-mocap/mocap-robo.mjs';
import { CenaMotion3D } from './cena3d.js';
import { bvhParaGLB } from './glb.js';
import { MotorMulticam } from './multicam.js';

const OP = 'motion3d.captura';
const PASTAS = [
  ['Content', 'Tudo'], ['Animation', 'Sequências de animação'], ['Characters', 'Personagens'], ['Mannequin', 'Esqueleto padrão'],
  ['Mocap', 'Capturas'], ['Props', 'Objetos'], ['Environment', 'Ambiente'], ['Cinematics', 'Câmeras'],
];
const LIGACOES_2D = [[11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [15, 19], [15, 17], [12, 14], [14, 16], [16, 20], [16, 18],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 2], [0, 5], [2, 7], [5, 8]];
const CABECA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAOS_LIG = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

let cssPosto = false;
function carregarCss() {
  if (cssPosto || document.querySelector('link[data-m3d]')) { cssPosto = true; return; }
  cssPosto = true;
  const ref = document.querySelector('link[href*="controls.css"]');
  const v = ref && ref.getAttribute('href').split('?')[1];
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/motion3d.css' + (v ? '?' + v : ''); l.setAttribute('data-m3d', '');
  document.head.appendChild(l);
}

/** Liga (ou adiciona) o nó motion3d.captura e aplica `patch` nos parâmetros. */
export function ativarMotion3D(patch = {}) {
  let ns = store.get().nodes;
  const i = ns.findIndex((n) => n.op === OP);
  if (i >= 0) ns = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null, params: { ...n.params, ...patch } } : n));
  else ns = [...ns, { id: newNodeId(), op: OP, params: { ...defaultParams(OP), ...patch }, enabled: true }];
  store.set({ nodes: ns });
  persist();
}
const paramsNo = () => { const n = store.get().nodes.find((x) => x.op === OP); return { ...defaultParams(OP), ...(n ? n.params : {}) }; };

function baixar(conteudo, nome, tipo = 'text/plain') {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const numero = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d).replace('.', ','));
const proxNome = (lista) => { let k = lista.length + 1; const nomes = new Set(lista.map((t) => t.nome)); while (nomes.has(`A_Take_${String(k).padStart(3, '0')}`)) k++; return `A_Take_${String(k).padStart(3, '0')}`; };

/** Miniatura do cartão: o esqueleto do quadro do meio, de frente, num canvas 2D (sem WebGL). */
function miniatura(trilha, cor = '#2EF2D0') {
  const c = document.createElement('canvas'); c.width = 160; c.height = 100;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1416'; g.fillRect(0, 0, 160, 100);
  const q = trilha[Math.floor(trilha.length / 2)] || trilha[0];
  if (!q) return c.toDataURL('image/png');
  const pts = q.filter(Boolean);
  if (!pts.length) return c.toDataURL('image/png');
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const esc = 80 / Math.max(0.5, Math.max(...ys) - Math.min(...ys));
  const P = (p) => [80 - (p[0] - cx) * esc, 50 - (p[1] - cy) * esc];   // de frente: a esquerda da pessoa à direita da tela
  g.strokeStyle = cor; g.lineWidth = 2; g.lineCap = 'round';
  for (const [a, b] of LIGACOES_2D) if (q[a] && q[b]) { const A = P(q[a]), B = P(q[b]); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); }
  return c.toDataURL('image/png');
}

/** Altura do chão de uma trilha: o 10º percentil do ponto de pé mais baixo de cada quadro. */
function alturaChao(trilha) {
  const ys = [];
  for (const q of trilha) { let m = Infinity; for (const k of [27, 28, 29, 30, 31, 32]) if (q && q[k] && q[k][1] < m) m = q[k][1]; if (Number.isFinite(m)) ys.push(m); }
  if (!ys.length) return 0;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length * 0.1)];
}
const deslocarQ = (q, dy) => (q && dy ? q.map((p) => (p ? [p[0], p[1] - dy, p[2]] : null)) : q);

/** Pose sintética (testes): projeta o 3D numa imagem 640×480 e publica pelo mesmo canal do operador. */
function injetarPose(W, t, latMs = 8) {
  const P = W.map((p) => (p ? { x: 320 + p[0] * 220, y: 470 - p[1] * 220, v: 0.95 } : { x: 0, y: 0, v: 0 }));   // vista da câmera: a esquerda da pessoa à direita da imagem
  canalMotion.publicar({ t, P, W, w: 640, h: 480, latMs });
}

export function StudioMotion3D({ onClose, displayCanvas }) {
  const raiz = useRef(null), cvVid = useRef(null), host3d = useRef(null), cena = useRef(null), fundo = useRef(null), cvHist = useRef(null);
  const inputImport = useRef(null), inputVideoServ = useRef(null);
  const [vista, setVista] = useState('video');          // video | 3d | ambos
  const [layout, setLayout] = useState('padrao');       // padrao | foco | ambos
  const [ferramenta, setFerramenta] = useState('orbitar');
  const [gaveta, setGaveta] = useState(null);           // celular: 'esq' | 'dir' | null
  const [menu, setMenu] = useState(null);               // 'layout' | 'export:<id>' | 'add' | null
  const [painel, setPainel] = useState(null);           // 'multicam' | 'freemocap' | 'servidor' | null
  const [msg, setMsgBruto] = useState('');
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 8000); }, []);
  const [, setTique] = useState(0);
  const [opc, setOpc] = useState({ esqueleto: true, avatar: 'capsulas', grade: true, piso: true, nomes: false, retarget: false, com: true, cameras: true, luz: 'lit', borrar: false, maos: true, chao: true });
  const [camPreset, setCamPreset] = useState('perspectiva');
  const [aba3d, setAba3d] = useState(null);             // popovers Perspective / Lit / Show
  const [selOutliner, setSelOutliner] = useState('SK_Character');
  const [buscaOut, setBuscaOut] = useState('');
  const [abaDet, setAbaDet] = useState('General');
  const [transf, setTransf] = useState({ pos: [0, 0, 0], rot: [0, 0, 0], escala: 1 });
  const [tomadas, setTomadas] = useState([]);            // metadados (salvas + não salvas)
  const naoSalvas = useRef(new Map());                    // id → tomada completa ainda não gravada no IndexedDB
  const [pasta, setPasta] = useState('Content');
  const [buscaCB, setBuscaCB] = useState('');
  const [cbAberto, setCbAberto] = useState(true);
  const [play, setPlay] = useState(null);                // { tomada, proc, ret (quadros do BVH), quadro, tocando }
  const playRef = useRef(null); playRef.current = play;
  const [selJunta, setSelJunta] = useState(null);
  const [modelos, setModelos] = useState(() => modelStates());
  const [caps, setCaps] = useState({ servidor: 'verificando', motores: Object.fromEntries(Object.keys(MOTORES).map((k) => [k, { estado: 'verificando' }])) });
  const [consent, setConsent] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [mc, setMc] = useState(null);                    // estado do motor multicâmera
  const motorMc = useRef(null);
  const [tab, setTab] = useState({ chave: '5x3', mm: 50, conf: null });
  const ultimoLive = useRef(null);
  const renomeando = useRef(null);
  const [, setFonteV] = useState(0);

  // ------------------------------------------------------------------ montagem
  useEffect(() => {
    carregarCss();
    canalMotion.definirStudio(true, { precisaQuadro: !(displayCanvas && displayCanvas.current) });
    document.body.classList.add('studio-aberto', 'm3d-aberto');
    const n = store.get().nodes.find((x) => x.op === OP);
    if (!n || !n.enabled) ativarMotion3D();
    // como no Studio Bike Fit: a barra de vídeo do app some depois de 3 s sem mexer o mouse
    let tOcioso = 0;
    const acordar = () => { document.body.classList.remove('studio-ocioso'); clearTimeout(tOcioso); tOcioso = setTimeout(() => document.body.classList.add('studio-ocioso'), 3000); };
    window.addEventListener('pointermove', acordar, { passive: true });
    acordar();
    return () => {
      clearTimeout(tOcioso);
      window.removeEventListener('pointermove', acordar);
      canalMotion.definirStudio(false);
      document.body.classList.remove('studio-aberto', 'm3d-aberto', 'studio-ocioso');
      if (cena.current) { cena.current.destruir(); cena.current = null; }
      if (motorMc.current) { motorMc.current.destruir(); motorMc.current = null; }
    };
  }, []);
  useEffect(() => onModelState((s) => setModelos(s)), []);
  useEffect(() => ouvirFonte(() => setFonteV((v) => v + 1)), []);
  useEffect(() => { let vivo = true; capacidades().then((c) => { if (vivo) setCaps(c); }); return () => { vivo = false; }; }, []);
  const recarregarLista = useCallback(async () => {
    let salvas = [];
    try { salvas = await armazem.listar(); } catch (e) { setMsg(`IndexedDB: ${e.message}`); }
    const mem = [...naoSalvas.current.values()].map(({ trilha, trilhaBruta, p2d, ...m }) => ({ ...m, quadros: trilha.length, naoSalva: true }));
    setTomadas([...mem, ...salvas.filter((s) => !naoSalvas.current.has(s.id))]);
  }, [setMsg]);
  useEffect(() => { recarregarLista(); }, [recarregarLista]);

  // ------------------------------------------------------------------ cena 3D (sob demanda)
  const mostra3d = vista !== 'video' || layout === 'ambos';
  useEffect(() => {
    if (!mostra3d || !host3d.current || cena.current) return;
    try {
      cena.current = new CenaMotion3D(host3d.current);
      cena.current.definir(opc);
      cena.current.vista(camPreset);
      cena.current.usarFerramenta(ferramenta, (t) => setTransf(t));
      cena.current.transformar(transf);
      if (play && play.tomada.cameras) cena.current.mostrarCameras(play.tomada.cameras);
    } catch (e) { setMsg(`WebGL indisponível: ${e.message}`); }
  }, [mostra3d]);
  useEffect(() => { if (cena.current) cena.current.definir(opc); }, [opc]);
  useEffect(() => { if (cena.current) cena.current.usarFerramenta(ferramenta, (t) => setTransf(t)); }, [ferramenta]);
  useEffect(() => { if (cena.current) cena.current.transformar(transf); }, [transf]);

  // ------------------------------------------------------------------ laço de desenho
  useEffect(() => {
    let id = 0, ultimaChave = '', ultimaChaveVid = '', ultimaCena = null, tPlay = performance.now(), tHist = 0, tChao = 0, chaoVivo = 0;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const p = playRef.current;
      // reprodução: avança no fps da tomada
      if (p && p.tocando) {
        const agora = performance.now();
        const passo = 1000 / p.tomada.fps;
        if (agora - tPlay >= passo) {
          tPlay = agora;
          const n = p.proc.trilha.length;
          const prox = p.quadro + 1 >= n ? (p.loop ? 0 : n - 1) : p.quadro + 1;
          // atualização funcional: uma tomada carregada entre dois quadros não é sobrescrita
          setPlay((cur) => (!cur || cur.tomada.id !== p.tomada.id ? cur : prox === cur.quadro ? { ...cur, tocando: false } : { ...cur, quadro: prox }));
        }
      }
      const r = canalMotion.instantaneo();
      const tR = r ? r.tWall : -1;
      const cvv = cvVid.current, caixa = cvv && cvv.parentElement ? cvv.parentElement.getBoundingClientRect() : null;
      const tam = caixa ? `${Math.round(caixa.width)}x${Math.round(caixa.height)}` : '';
      // Vídeo e 3D com chaves separadas: o vídeo acompanha cada quadro PINTADO pelo app
      // (display.quadros, como no Studio Bike Fit), o 3D só muda quando chega pose nova.
      const dcq = !p && displayCanvas && displayCanvas.current ? displayCanvas.current.quadros | 0 : 0;
      const chave = (p ? `p${p.tomada.id}:${p.quadro}` : `l${tR}`) + `|${opc.borrar}|${opc.retarget}|${opc.chao}`;
      const chaveVid = chave + `|${tam}|d${dcq}`;
      const cenaNova = cena.current && cena.current !== ultimaCena;
      if (chaveVid !== ultimaChaveVid) { ultimaChaveVid = chaveVid; desenharVideo(r, p); }
      if (cenaNova || chave !== ultimaChave) {
        ultimaChave = chave; ultimaCena = cena.current;
        if (cena.current) {
          // "pés no chão" (só exibição; os dados ficam como foram medidos): o monocular tem o quadril
          // numa altura fixa e flutua; desloca a cena inteira pela altura do chão da tomada/buffer
          if (p) {
            const i = p.quadro, dy = opc.chao ? p.chao || 0 : 0;
            const q = deslocarQ(p.proc.trilha[i], dy), com = p.proc.com[i] ? [p.proc.com[i][0], p.proc.com[i][1] - dy, p.proc.com[i][2]] : null;
            const b = baseDeSuporte(q, com);
            let ret = opc.retarget && p.ret ? p.ret[i] : null;
            if (ret && dy) { const m = new Map(); for (const [k, v] of ret) m.set(k, v.clone().setY(v.y - dy)); ret = m; }
            cena.current.mostrarQuadro(q, com, p.proc.com.slice(Math.max(0, i - p.tomada.fps * 3), i + 1).map((c) => (c ? [c[0], c[1] - dy, c[2]] : null)), b.poligono, b.margem, ret);
          } else if (r) {
            const agora = performance.now();
            if (agora - tChao > 1000) { tChao = agora; chaoVivo = alturaChao(canalMotion.buffer().map((a) => a.Wf || a.W)); }
            const dy = opc.chao ? chaoVivo : 0;
            const W = deslocarQ(r.Wf || r.W, dy);
            let ret = null;
            if (opc.retarget && W) { try { ret = lerBVH(paraBVH({ trilha: [W], com: [null] }, 30)).quadros[0]; } catch (_) { ret = null; } }
            cena.current.mostrarQuadro(W || null, null, [], [], null, ret);
          }
        }
      }
      const agora = performance.now();
      if (agora - tHist > 250) { tHist = agora; desenharHistograma(); setTique((n) => (n + 1) % 1e6); }
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [opc]);

  function desenharVideo(r, p) {
    const cv = cvVid.current;
    if (!cv) return;
    const box = cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(box.width * dpr)), H = Math.max(1, Math.round(box.height * dpr));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const g = cv.getContext('2d');
    const est = getComputedStyle(raiz.current || document.body);
    const acento = est.getPropertyValue('--m3d-esqueleto').trim() || '#2EF2D0';
    g.fillStyle = est.getPropertyValue('--m3d-palco').trim() || '#05090a';
    g.fillRect(0, 0, W, H);
    let iw = 640, ih = 480, P = null, maos = null, temImg = false;
    if (p) {
      const pts = p.tomada.p2d && p.tomada.p2d[p.quadro + ((p.tomada.corte && p.tomada.corte.ini) || 0)];
      if (pts) P = pts.map((q) => (q ? { x: q.x * iw, y: q.y * ih, v: q.v } : null));
    } else if (r) {
      const usaDc = displayCanvas && displayCanvas.current && displayCanvas.current.width > 2;
      const img = usaDc ? null : canalMotion.quadro();
      if (usaDc && r.w) { iw = r.w; ih = r.h; }
      if (img) {
        if (!fundo.current) fundo.current = document.createElement('canvas');
        const f = fundo.current;
        if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
        f.getContext('2d').putImageData(img, 0, 0);
        iw = img.width; ih = img.height; temImg = true;
      } else if (r.w) { iw = r.w; ih = r.h; }
      P = r.P; maos = r.maos;
    }
    const k = Math.min(W / iw, H / ih), ox = (W - iw * k) / 2, oy = (H - ih * k) / 2;
    // Resolução: o quadro publicado pelo operador é o quadro REDUZIDO que vai ao modelo de pose
    // (procWidth). Para exibir, copia o vídeo do canvas de exibição do app em resolução cheia,
    // como o Studio Bike Fit (mesma conta "contém, centrado" do Viewport); o reduzido fica de reserva.
    const dc = r && !p && displayCanvas && displayCanvas.current;
    const temDc = dc && dc.width > 2 && dc.height > 2 && iw > 2 && ih > 2;
    if (temDc) {
      const fit = Math.min(dc.width / iw, dc.height / ih);
      const dw = iw * fit, dh = ih * fit, dx = (dc.width - dw) / 2, dy = (dc.height - dh) / 2;
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      try { g.drawImage(dc, dx, dy, dw, dh, ox, oy, iw * k, ih * k); temImg = true; } catch (_) { /* canvas sumiu: cai no reduzido */ }
    }
    if (temImg && !temDc && fundo.current) {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(fundo.current, ox, oy, iw * k, ih * k);
    }
    if (temImg) {
      if (opc.borrar && P) {
        // borrão de rosto (LGPD): círculo em volta dos pontos da cabeça
        const cab = CABECA.map((i) => P[i]).filter((q) => q && q.v > 0.2);
        if (cab.length >= 3) {
          const xs = cab.map((q) => q.x), ys = cab.map((q) => q.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
          const rr = Math.max(18, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.9);
          g.save(); g.beginPath(); g.arc(ox + cx * k, oy + cy * k, rr * k, 0, 2 * Math.PI); g.clip();
          g.filter = `blur(${Math.max(8, rr * k * 0.25)}px)`;
          if (temDc) {
            const fit = Math.min(dc.width / iw, dc.height / ih);
            g.drawImage(dc, (dc.width - iw * fit) / 2, (dc.height - ih * fit) / 2, iw * fit, ih * fit, ox, oy, iw * k, ih * k);
          } else g.drawImage(fundo.current, ox, oy, iw * k, ih * k);
          g.restore();
        }
      }
    } else {
      g.fillStyle = est.getPropertyValue('--m3d-tinta3').trim() || '#7a9';
      g.font = `${12 * dpr}px Archivo, Arial, sans-serif`;
      g.textAlign = 'center';
      const txt = p ? (P ? 'Reprodução: só os landmarks gravados (o vídeo nunca é guardado)' : 'Tomada 3D sem 2D — veja no viewport 3D')
        : canalMotion.recente(4000) ? 'Sem imagem do quadro' : 'Escolha a Fonte (câmera, arquivo ou YouTube) — o Actor_Mocap começa a transmitir';
      g.fillText(txt, W / 2, 22 * dpr);
    }
    if (P && opc.esqueleto) {
      const minV = 0.35;
      g.lineCap = 'round';
      g.shadowColor = acento; g.shadowBlur = 10 * dpr;
      g.strokeStyle = acento; g.lineWidth = 3.2 * dpr;
      for (const [a, b] of LIGACOES_2D) {
        const A = P[a], B = P[b];
        if (!A || !B || A.v < minV || B.v < minV) continue;
        g.beginPath(); g.moveTo(ox + A.x * k, oy + A.y * k); g.lineTo(ox + B.x * k, oy + B.y * k); g.stroke();
      }
      g.shadowBlur = 0;
      for (let i = 0; i < 33; i++) {
        const A = P[i];
        if (!A || A.v < minV) continue;
        g.fillStyle = i === selJuntaRef.current ? '#FFD84D' : '#E8FFFB';
        g.beginPath(); g.arc(ox + A.x * k, oy + A.y * k, (i === selJuntaRef.current ? 6 : 3.2) * dpr, 0, 2 * Math.PI); g.fill();
      }
      if (opc.maos && Array.isArray(maos)) {
        g.strokeStyle = acento; g.lineWidth = 1.6 * dpr;
        for (const m of maos) {
          const pts = m.pts.map((q) => ({ x: q.x * iw, y: q.y * ih }));
          for (const [a, b] of MAOS_LIG) { g.beginPath(); g.moveTo(ox + pts[a].x * k, oy + pts[a].y * k); g.lineTo(ox + pts[b].x * k, oy + pts[b].y * k); g.stroke(); }
        }
      }
    }
  }
  const selJuntaRef = useRef(null); selJuntaRef.current = selJunta;

  function desenharHistograma() {
    const cv = cvHist.current;
    if (!cv) return;
    const st = canalMotion.estatisticas();
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    const xs = st.historico.slice(-40);
    if (!xs.length) return;
    const max = Math.max(50, ...xs);
    const est = getComputedStyle(raiz.current || document.body);
    const cor = est.getPropertyValue('--m3d-acento').trim() || '#2EF2D0';
    const bw = W / 40;
    xs.forEach((v, i) => { const h = Math.max(1, (v / max) * (H - 2)); g.fillStyle = v > 200 ? '#F2A900' : cor; g.fillRect(i * bw, H - h, Math.max(1, bw - 1), h); });
  }

  // ------------------------------------------------------------------ tomadas
  const estatisticas = canalMotion.estatisticas();
  const gravando = estatisticas.gravando || (mc && mc.etapa === 'gravando');
  const live = !play && canalMotion.recente(1500);
  const fonte = estadoFonte();

  const novaTomada = useCallback((base, origemNome = null) => {
    const t = { id: base.id || novoId('tk'), nome: origemNome || proxNome(tomadas.concat([...naoSalvas.current.values()])), pasta: 'Mocap', criado: new Date().toISOString(),
      corte: { ini: 0, fim: base.trilha.length - 1 }, ...base };
    t.thumb = miniatura(t.trilha);
    naoSalvas.current.set(t.id, t);
    return t;
  }, [tomadas]);

  const carregar = useCallback(async (meta, { tocar = true } = {}) => {
    let t = naoSalvas.current.get(meta.id);
    if (!t) { try { t = await armazem.ler(meta.id); } catch (e) { setMsg(`IndexedDB: ${e.message}`); return null; } }
    if (!t) { setMsg('Tomada não encontrada.'); return null; }
    const proc = processarTomada(t);
    if (!proc) { setMsg('Tomada curta demais.'); return null; }
    let ret = null;
    try { ret = lerBVH(paraBVH(proc, t.fps)).quadros; } catch (_) { ret = null; }
    setPlay({ tomada: t, proc, ret, quadro: 0, tocando: tocar, loop: true, chao: alturaChao(proc.trilha) });
    if (cena.current) cena.current.mostrarCameras(t.cameras || []);
    setSelOutliner('SK_Character');
    setMsg(`${t.nome}: ${proc.trilha.length} quadros a ${t.fps} fps · ${ORIGENS[t.origem] ? ORIGENS[t.origem].rotulo : t.origem}.`);
    return { t, proc };
  }, [setMsg]);

  const salvarTomada = useCallback(async (id) => {
    const t = naoSalvas.current.get(id);
    if (!t) return false;
    await armazem.salvar(t);
    naoSalvas.current.delete(id);
    return true;
  }, []);

  const salvar = useCallback(async () => {
    try {
      if (play) {
        const t = play.tomada;
        if (naoSalvas.current.has(t.id)) await salvarTomada(t.id);
        else await armazem.salvar(t);
        setMsg(`Salva: ${t.nome} (IndexedDB deste navegador; nada é enviado).`);
      } else if (naoSalvas.current.size) {
        const id = [...naoSalvas.current.keys()].pop();
        await salvarTomada(id);
        setMsg('Tomada salva no navegador.');
      } else setMsg('Nada novo para salvar.');
    } catch (e) { setMsg(`Não salvou: ${e.message}`); }
    recarregarLista();
  }, [play, salvarTomada, recarregarLista, setMsg]);

  const salvarTudo = useCallback(async () => {
    let n = 0;
    try { for (const id of [...naoSalvas.current.keys()]) { await salvarTomada(id); n++; } } catch (e) { setMsg(`Não salvou: ${e.message}`); }
    if (play && !naoSalvas.current.has(play.tomada.id)) { try { await armazem.salvar(play.tomada); } catch (_) { /* segue */ } }
    setMsg(n ? `${n} tomada(s) salvas neste navegador.` : 'Tudo já estava salvo.');
    recarregarLista();
  }, [play, salvarTomada, recarregarLista, setMsg]);

  const gravar = useCallback(() => {
    if (mc && motorMc.current && mc.modo && mc.modo !== 'demonstracao' && (mc.etapa === 'calibrado' || mc.etapa === 'cameras' || mc.etapa === 'gravando')) {
      const m = motorMc.current;
      if (mc.etapa === 'gravando') {
        const base = m.pararGravacao(30);
        if (base) { const t = novaTomada(base); recarregarLista(); carregar(t); setMsg(`${t.nome} gravada (${base.trilha.length} quadros, ${ORIGENS[base.origem].rotulo}). Salve para guardar.`); }
      } else { setPlay(null); m.iniciarGravacao(); }
      return;
    }
    if (canalMotion.estatisticas().gravando) {
      const base = canalMotion.parar(30);
      if (!base) { setMsg('Gravação curta demais (menos de 5 poses).'); return; }
      const t = novaTomada(base);
      recarregarLista();
      carregar(t, { tocar: false });
      setMsg(`${t.nome} gravada: ${base.trilha.length} quadros (${base.amostras} poses). Salve para guardar no navegador.`);
    } else {
      setPlay(null);
      if (!store.get().nodes.some((n) => n.op === OP && n.enabled)) ativarMotion3D();
      canalMotion.gravar('Actor_Mocap');
      setMsg('● Gravando o Actor_Mocap (só landmarks; o vídeo não é guardado).');
    }
  }, [mc, novaTomada, recarregarLista, carregar, setMsg]);

  const exportar = useCallback(async (meta, tipo) => {
    setMenu(null);
    let t = naoSalvas.current.get(meta.id) || (play && play.tomada.id === meta.id ? play.tomada : null);
    if (!t) { try { t = await armazem.ler(meta.id); } catch (_) { t = null; } }
    if (!t) { setMsg('Tomada não encontrada.'); return null; }
    try {
      const nome = t.nome.replace(/[^\w.-]+/g, '_');
      if (tipo === 'bvh') { const b = exportarRobo(t, 'bvh'); baixar(b, `${nome}.bvh`, 'text/plain'); setMsg('BVH exportado (Blender: File › Import › Motion Capture (.bvh); escala 0,01 se vier em cm).'); return b; }
      if (tipo === 'glb') { const bvh = exportarRobo(t, 'bvh'); const glb = await bvhParaGLB(bvh, { nomeClipe: t.nome }); baixar(new Blob([glb], { type: 'model/gltf-binary' }), `${nome}.glb`); setMsg('GLB animado exportado (Blender: File › Import › glTF 2.0).'); return glb; }
      if (tipo === 'json') { const j = paraJSONStudio(t, processarTomada(t)); baixar(j, `${nome}.motionai.json`, 'application/json'); setMsg('JSON no contrato motionai.pose.v1, com a proveniência.'); return j; }
      if (tipo === 'json-robo') { const j = exportarRobo(t, 'json-robo'); baixar(j, `${nome}.gplansis-mocap.json`, 'application/json'); setMsg('JSON gplansis-mocap/1 (com as câmeras).'); return j; }
      if (tipo === 'csv') { const c = exportarRobo(t, 'csv'); baixar(c, `${nome}.csv`, 'text/csv'); setMsg('CSV exportado (metros, y para cima).'); return c; }
    } catch (e) { setMsg(`Exportação falhou: ${e.message}`); }
    return null;
  }, [play, setMsg]);

  const importar = useCallback(async (arquivos) => {
    for (const f of arquivos) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const r = importarArquivo(f.name, /\.npy$/i.test(f.name) ? buf : new TextDecoder().decode(buf));
        const t = novaTomada({ trilha: r.trilha, fps: Math.round(r.fps) || 30, origem: r.origem, cameras: r.cameras || [], fonteId: f.name }, (() => { const b = f.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40); return /^A_/i.test(b) ? b : `A_${b}`; })());
        t.pasta = 'Mocap';
        await salvarTomada(t.id);
        setMsg(`${r.nota} Salva como ${t.nome}.`);
        await recarregarLista();
        carregar(t);
      } catch (e) { setMsg(`${f.name}: ${e.message}`); }
    }
  }, [novaTomada, salvarTomada, recarregarLista, carregar, setMsg]);

  const apagar = useCallback(async (meta) => {
    setMenu(null);
    if (!confirm(`Apagar ${meta.nome} deste navegador?`)) return;
    naoSalvas.current.delete(meta.id);
    try { await armazem.apagar(meta.id); } catch (_) { /* não salva */ }
    if (play && play.tomada.id === meta.id) setPlay(null);
    recarregarLista();
  }, [play, recarregarLista]);

  const renomear = useCallback(async (meta, nome) => {
    const n = String(nome || '').trim().slice(0, 60);
    if (!n) return;
    const mem = naoSalvas.current.get(meta.id);
    if (mem) mem.nome = n;
    else { const t = await armazem.ler(meta.id); if (t) await armazem.salvar({ ...t, nome: n }); }
    if (play && play.tomada.id === meta.id) setPlay({ ...play, tomada: { ...play.tomada, nome: n } });
    recarregarLista();
  }, [play, recarregarLista]);

  const aplicarCorte = useCallback((ini, fim) => {
    if (!play) return;
    const t = { ...play.tomada, corte: { ini, fim } };
    if (naoSalvas.current.has(t.id)) naoSalvas.current.set(t.id, t);
    const proc = processarTomada(t);
    if (!proc) return;
    let ret = null;
    try { ret = lerBVH(paraBVH(proc, t.fps)).quadros; } catch (_) { ret = null; }
    setPlay({ ...play, tomada: t, proc, ret, chao: alturaChao(proc.trilha), quadro: Math.min(play.quadro, proc.trilha.length - 1) });
    if (!naoSalvas.current.has(t.id)) naoSalvas.current.set(t.id, { ...t });
    recarregarLista();
    setMsg(`Corte: quadros ${ini}–${fim} (${fim - ini + 1}). Salve para guardar.`);
  }, [play, recarregarLista, setMsg]);

  // transporte
  const tocar = () => { if (play) setPlay({ ...play, tocando: !play.tocando }); else if (tomadas[0]) carregar(tomadas[0]); else setMsg('Nenhuma tomada: grave ou importe uma.'); };
  const avancar = (d) => { if (play) setPlay({ ...play, tocando: false, quadro: Math.max(0, Math.min(play.proc.trilha.length - 1, play.quadro + d)) }); };
  const parar = () => { if (play) setPlay({ ...play, tocando: false, quadro: 0 }); };
  const aoVivo = () => { setPlay(null); if (cena.current) cena.current.mostrarCameras([]); setMsg('Ao vivo: Actor_Mocap.'); };

  // multicâmera
  const abrirMulticam = () => {
    if (!motorMc.current) {
      motorMc.current = new MotorMulticam((s) => setMc(s), (q) => { if (cena.current && !playRef.current) cena.current.mostrarQuadro(q); }, (cs) => { if (cena.current) cena.current.mostrarCameras(cs); });
      setMc(motorMc.current.estado());
    }
    setPainel('multicam');
  };
  const demonstracao = () => {
    abrirMulticam();
    setTimeout(() => {
      const base = motorMc.current.demonstracao(14);
      const t = novaTomada({ ...base }, 'A_Demo_3Cam');
      recarregarLista();
      carregar(t);
      if (vista === 'video') setVista('3d');
      setMsg(`Demonstração do GPlanSiS|ROBO: 3 câmeras virtuais calibradas pelo corpo (reprojeção ${base.erroPx.toFixed(2)} px), ${base.trilha.length} quadros. Dado SINTÉTICO.`);
    }, 0);
  };

  // servidor
  const pedirServidor = async (motor) => {
    if (!consent) { setMsg('Marque o consentimento antes: nada é enviado sem ele.'); return; }
    const est = (caps.motores[motor] || {}).estado;
    if (est !== 'disponivel') {
      // estado honesto vindo de /capabilities: nem pede (o servidor responderia 501) e nada sai do aparelho
      setJobs((j) => [{ id: novoId('job'), motor, estado: ROTULO_ESTADO[est] || est, detalhe: `${(caps.motores[motor] || {}).detalhe || ''} Nenhum vídeo foi enviado; o servidor responde 501 a este motor.`, quando: new Date().toLocaleTimeString('pt-BR') }, ...j].slice(0, 20));
      setMsg(`${MOTORES[motor].nome}: ${ROTULO_ESTADO[est] || est}. Nada foi enviado.`);
      return;
    }
    const arq = inputVideoServ.current && inputVideoServ.current.files[0];
    setEnviando(true);
    try {
      const sessao = novoId('ses');
      const ref = `consent_${new Date().toISOString()}`;
      let artefato = null;
      if (arq && caps.motores[motor] && caps.motores[motor].estado === 'disponivel') {
        const up = await enviarVideo(arq, { consentimento: ref, motor });
        if (up.erro) { setJobs((j) => [{ id: novoId('job'), motor, estado: `recusado (${up.status || 'sem envio'})`, detalhe: up.erro, quando: new Date().toLocaleTimeString('pt-BR') }, ...j].slice(0, 20)); return; }
        artefato = up.artefato && up.artefato.artifact_id;
      }
      const r = await pedirJob({ motor, sessionId: sessao, artefatoId: artefato, consentimento: ref });
      setJobs((j) => [{ id: (r.job && r.job.job_id) || novoId('job'), motor, estado: r.job ? r.job.status : `HTTP ${r.status}`, detalhe: r.job ? `${r.job.percent_complete || 0} %` : r.erro, quando: new Date().toLocaleTimeString('pt-BR') }, ...j].slice(0, 20));
      setMsg(r.job ? `Job ${MOTORES[motor].nome} na fila.` : `${MOTORES[motor].nome}: ${r.erro}`);
    } finally { setEnviando(false); }
  };

  // ChArUco
  const baixarTabuleiro = () => { const T = TABULEIROS[tab.chave]; baixar(svgTabuleiro({ colunas: T.colunas, linhas: T.linhas, quadradoMm: tab.mm }), `charuco_${tab.chave}_${tab.mm}mm.svg`, 'image/svg+xml'); };
  const conferir = () => {
    const img = canalMotion.quadro();
    if (!img) { setMsg('Sem quadro da Fonte: ligue a câmera e aponte para o tabuleiro.'); return; }
    const T = TABULEIROS[tab.chave];
    const r = conferirTabuleiro(img, T.colunas, T.linhas);
    setTab({ ...tab, conf: r });
    setMsg(`Tabuleiro: ${r.ids.length} de ${Math.floor((T.colunas * T.linhas) / 2)} marcadores lidos (${Math.round(r.fracao * 100)} %).`);
  };

  // update rate / filtro → parâmetros do nó
  const p = paramsNo();
  const definirParam = (patch) => { ativarMotion3D(patch); setTique((n) => n + 1); };

  // ------------------------------------------------------------------ teclado
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && fonteStudioAberta()) return;
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'Escape') { e.stopPropagation(); if (menu || aba3d) { setMenu(null); setAba3d(null); } else if (painel) setPainel(null); else if (gaveta) setGaveta(null); else onClose(); }
      else if (e.key === ' ' && play) { e.preventDefault(); setPlay({ ...play, tocando: !play.tocando }); }
      else if (e.key === 'ArrowRight' && play) avancar(1);
      else if (e.key === 'ArrowLeft' && play) avancar(-1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, aba3d, painel, gaveta, play, onClose]);

  // ------------------------------------------------------------------ gancho de teste
  useEffect(() => {
    window.aivMotion3D = {
      canal: canalMotion,
      injetar: injetarPose,
      gravar: () => gravar(),
      estado: () => ({ live: canalMotion.recente(1500), play: playRef.current ? { nome: playRef.current.tomada.nome, quadro: playRef.current.quadro, n: playRef.current.proc.trilha.length, tocando: playRef.current.tocando } : null,
        tomadas: tomadas.map((t) => ({ id: t.id, nome: t.nome, quadros: t.quadros, naoSalva: Boolean(t.naoSalva), origem: t.origem })), stats: canalMotion.estatisticas(), cena: Boolean(cena.current), quadros3d: cena.current ? cena.current.quadrosDesenhados : 0, caps, mc }),
      exportar: (id, tipo) => exportar({ id }, tipo),
      carregar: (id) => carregar({ id }),
      salvarTudo: () => salvarTudo(),
      demonstracao: () => demonstracao(),
      importarTexto: (nome, txt) => importar([new File([txt], nome)]),
      pngViewport: () => (cena.current ? cena.current.png() : null),
      cena: () => cena.current,
      definirVista: (v) => setVista(v),
      pedirServidor: (m) => pedirServidor(m),
      consentir: (v) => setConsent(Boolean(v)),
    };
    return () => { delete window.aivMotion3D; };
  });

  // ------------------------------------------------------------------ dados derivados
  const quadroAtual = play ? play.proc.trilha[play.quadro] : (canalMotion.instantaneo() && (canalMotion.instantaneo().Wf || canalMotion.instantaneo().W)) || null;
  const visAtual = play ? null : (canalMotion.instantaneo() && canalMotion.instantaneo().P ? canalMotion.instantaneo().P.map((q) => (q ? q.v : 0)) : null);
  const angs = quadroAtual ? angulosQuadro(quadroAtual, visAtual) : [];
  const fpsTake = play ? play.tomada.fps : 30;
  const tcMs = play ? (play.quadro * 1000) / play.tomada.fps : estatisticas.gravando ? performance.now() - estatisticas.inicioGravacao : 0;
  const frameNum = play ? play.quadro : estatisticas.gravando ? estatisticas.gravadas : 0;
  const somaDur = play ? (play.proc.trilha.length - 1) : 0;
  const tomadasFiltradas = tomadas.filter((t) => (pasta === 'Content' || pasta === 'Animation' || pasta === 'Mocap' ? true : false) && (!buscaCB || t.nome.toLowerCase().includes(buscaCB.toLowerCase())));
  const ITENS_FIXOS = {
    Characters: [{ id: 'SK_Character', nome: 'SK_Character', tipo: 'Skeletal Mesh', desc: 'Avatar do Studio (cápsulas ou manequim low-poly gerado em código).' }],
    Mannequin: [{ id: 'SK_Mannequin', nome: 'SK_Mannequin_ROBO', tipo: 'Skeleton', desc: 'Esqueleto padrão do BVH do GPlanSiS|ROBO: 15 juntas (Hips, Spine, Neck, braços, pernas).' }],
    Props: [{ id: 'Charuco', nome: 'BP_ChArUco_Board', tipo: 'Prop', desc: 'Tabuleiro de calibração (FreeMoCap): baixe o SVG no painel FreeMoCap.' }],
    Environment: [{ id: 'Piso', nome: 'SM_Floor', tipo: 'Static Mesh', desc: 'Piso e grade de 10 m.' }, { id: 'Luzes', nome: 'Lights', tipo: 'Light', desc: 'Luz hemisférica + direcional.' }],
    Cinematics: [{ id: 'Cams', nome: 'CameraRig', tipo: 'Camera', desc: play && play.tomada.cameras && play.tomada.cameras.length ? `${play.tomada.cameras.length} câmeras calibradas na tomada aberta.` : 'Câmeras calibradas aparecem aqui ao abrir uma tomada multicâmera.' }],
  };
  const OUTLINER = [
    ['Cena', 'World'], ['Luz direcional', 'DirectionalLight'], ['Luz ambiente', 'SkyLight'], ['Câmera do viewport', 'CameraActor'],
    ['SK_Character', 'SkeletalMeshActor'], ['Actor_Mocap', 'LiveLinkSubject'], ['SM_Floor', 'StaticMeshActor'], ['Grade', 'Helper'],
    ['CameraRig', `Cameras (${play && play.tomada.cameras ? play.tomada.cameras.length : 0})`], ['CoM', 'Marker'], ['BP_ChArUco_Board', 'Prop'],
  ].filter(([n, t]) => !buscaOut || (n + t).toLowerCase().includes(buscaOut.toLowerCase()));

  const estadoActor = live ? (estatisticas.gravando ? 'Gravando…' : 'Streaming…') : play ? 'Reproduzindo tomada' : (canalMotion.instantaneo() && canalMotion.instantaneo().sem ? 'Sem pessoa' : 'Parado');
  const rotModelo = (id) => { const s = modelos[id] || {}; return `${s.status === 'ready' ? 'pronto' : s.status === 'loading' ? `baixando ${Math.round((s.progress || 0) * 100)} %` : s.status === 'error' ? 'falhou' : 'na fila'}${s.ep ? ` · ${s.ep === 'webgpu' ? 'GPU' : 'CPU'}` : ''}${s.runMs ? ` · ${s.runMs} ms` : ''}`; };
  const remoto = enviando;

  // ------------------------------------------------------------------ partes da tela
  const Botao = ({ on, titulo, onClick, children, cls = '', dis = false }) => html`<button class=${`m3d-btn ${on ? 'on' : ''} ${cls}`} title=${titulo} aria-label=${titulo} aria-pressed=${on ? 'true' : undefined} disabled=${dis} onClick=${onClick}>${children}</button>`;

  const Fontes = html`
    <section class="m3d-sec" aria-label="Live Link / Sources">
      <h3>Live Link <small>Sources</small></h3>
      <div class=${`m3d-fonte ${live ? 'viva' : ''}`}>
        <span class="m3d-dot" aria-hidden="true"></span>
        <div class="m3d-fonte-t"><b>Actor_Mocap</b><em>${estadoActor}</em><small>${fonte.rotulo || 'sem fonte'}${fonte.detalhe ? ` · ${fonte.detalhe}` : ''} · BlazePose 3D no aparelho</small></div>
        <${FonteStudio} classeBotao="m3d-btn mini" semTexto=${true} />
      </div>
      <div class=${`m3d-fonte ${mc && mc.vistas && mc.vistas.length ? 'viva' : ''}`}>
        <span class="m3d-dot" aria-hidden="true"></span>
        <div class="m3d-fonte-t"><b>Multicâmera</b><em>${mc ? `${mc.etapa}${mc.vistas && mc.vistas.length ? ` · ${mc.vistas.length} vista(s)` : ''}` : '1–4 câmeras · GPlanSiS|ROBO'}</em><small>calibração pelo corpo · triangulação</small></div>
        <button class="m3d-btn mini" onClick=${abrirMulticam}>Abrir</button>
      </div>
      <div class="m3d-fonte">
        <span class="m3d-dot" aria-hidden="true"></span>
        <div class="m3d-fonte-t"><b>FreeMoCap</b><em>importar sessão · ChArUco</em><small>NPY / CSV / JSON · BVH para o Blender</small></div>
        <button class="m3d-btn mini" onClick=${() => setPainel('freemocap')}>Abrir</button>
      </div>
      ${Object.entries(MOTORES).map(([k, m]) => {
        const e = (caps.motores[k] || {}).estado || 'verificando';
        return html`<div key=${k} class=${`m3d-fonte serv est-${e}`}>
          <span class="m3d-dot" aria-hidden="true"></span>
          <div class="m3d-fonte-t"><b>${m.nome}</b><em>${ROTULO_ESTADO[e] || e}</em><small>motor de servidor · vídeo, não tempo real</small></div>
          <button class="m3d-btn mini" onClick=${() => setPainel('servidor')}>Fila</button>
        </div>`;
      })}
      <div class="m3d-modelos" aria-label="Modelos no aparelho">
        <span>YOLOX: <b>${rotModelo('yolox')}</b></span><span>BlazePose 3D: <b>${rotModelo('pose')}</b></span>
      </div>
    </section>`;

  const juntaSvg = [[0, 50, 12], [11, 40, 26], [12, 60, 26], [13, 33, 40], [14, 67, 40], [15, 28, 53], [16, 72, 53], [23, 44, 56], [24, 56, 56], [25, 43, 75], [26, 57, 75], [27, 42, 93], [28, 58, 93]];
  const Esqueleto = html`
    <section class="m3d-sec" aria-label="Skeleton">
      <h3>Skeleton <small>${selJunta != null ? `junta ${selJunta}` : 'toque numa junta'}</small></h3>
      <svg class="m3d-silhueta" viewBox="0 0 100 100" role="img" aria-label="Silhueta com as juntas">
        <path d="M50 4a7 7 0 1 1 0 14a7 7 0 1 1 0-14zM38 22h24l6 4l6 30l-5 1l-6-26l-1 24l2 40h-6l-4-34l-4 34h-6l2-40l-1-24l-6 26l-5-1l6-30z" class="m3d-corpo" />
        ${[[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]].map(([a, b]) => {
          const A = juntaSvg.find((j) => j[0] === a), B = juntaSvg.find((j) => j[0] === b);
          return html`<line key=${a + '-' + b} x1=${A[1]} y1=${A[2]} x2=${B[1]} y2=${B[2]} class="m3d-osso" />`;
        })}
        ${juntaSvg.map(([i, x, y]) => {
          const v = visAtual ? visAtual[i] : quadroAtual && quadroAtual[i] ? 1 : 0;
          return html`<circle key=${i} cx=${x} cy=${y} r=${selJunta === i ? 3.6 : 2.6} class=${`m3d-junta ${v > 0.6 ? 'ok' : v > 0.3 ? 'meia' : 'nao'} ${selJunta === i ? 'sel' : ''}`}
            tabindex="0" role="button" aria-label=${`Junta ${i}`} onClick=${() => setSelJunta(selJunta === i ? null : i)} onKeyDown=${(e) => { if (e.key === 'Enter') setSelJunta(selJunta === i ? null : i); }} />`;
        })}
      </svg>
      <label class="m3d-campo">Retarget Profile
        <select value="robo15" onChange=${() => {}}><option value="robo15">MediaPipe 33 → SK_Mannequin_ROBO (15 juntas, BVH)</option></select>
      </label>
      <div class="m3d-sub">Preview Settings</div>
      <label class="m3d-campo">Target Mesh
        <select value=${opc.avatar} onChange=${(e) => setOpc({ ...opc, avatar: e.target.value })}>
          <option value="capsulas">Cápsulas</option><option value="manequim">Manequim low-poly</option><option value="nenhum">Nenhum</option>
        </select>
      </label>
      ${[['esqueleto', 'Show Skeleton'], ['nomes', 'Show Bone Names'], ['retarget', 'Show Retarget']].map(([k, r]) => html`
        <label key=${k} class="m3d-check"><input type="checkbox" checked=${opc[k]} onChange=${(e) => setOpc({ ...opc, [k]: e.target.checked })} /> ${r}</label>`)}
    </section>`;

  const TransformCampos = html`
    <div class="m3d-transf">
      ${[['Location', 'pos', 0.05, 'm'], ['Rotation', 'rot', 5, '°']].map(([rot, k, passo, un]) => html`
        <div key=${k} class="m3d-vec"><span>${rot}</span>
          ${['X', 'Y', 'Z'].map((ax, i) => html`<label key=${ax}><i class=${`ax ax-${ax}`}>${ax}</i><input type="number" step=${passo} value=${transf[k][i]} aria-label=${`${rot} ${ax} (${un})`}
            onChange=${(e) => { const v = transf[k].slice(); v[i] = +e.target.value || 0; setTransf({ ...transf, [k]: v }); }} /></label>`)}
        </div>`)}
      <div class="m3d-vec"><span>Scale</span><label><i class="ax">U</i><input type="number" step="0.05" min="0.05" value=${transf.escala} aria-label="Escala uniforme"
        onChange=${(e) => setTransf({ ...transf, escala: Math.max(0.05, +e.target.value || 1) })} /></label>
        <button class="m3d-btn mini" onClick=${() => setTransf({ pos: [0, 0, 0], rot: [0, 0, 0], escala: 1 })}>Zerar</button></div>
    </div>`;

  const Angulos = html`
    <div class="m3d-angs">
      <p class="m3d-aviso-mini">⚠ ${AVISO_ANGULOS}</p>
      <table><thead><tr><th>Articulação</th><th>Ângulo</th><th>Ref.</th><th>Qualidade</th></tr></thead>
        <tbody>${angs.length ? angs.map((a) => html`<tr key=${a.nome}><td>${a.nome}</td><td class="num">${a.valor == null ? '—' : numero(a.valor, 0) + '°'}</td><td class="num">${a.ref ? `${a.ref[0]}–${a.ref[1]}°` : ''}</td><td class=${`q-${a.qualidade}`}>${a.qualidade}</td></tr>`)
          : html`<tr><td colspan="4">Sem pose.</td></tr>`}</tbody></table>
      <p class="m3d-fonte-ref">Cálculo 3D do MoCap do GPlanSiS|ROBO; faixas: ${FONTE_ADM} (as da Fisio).</p>
    </div>`;

  const Corte = play && html`
    <div class="m3d-corte">
      <div class="m3d-sub">Trim (corte)</div>
      ${(() => {
        const n = play.tomada.trilha.length;
        const c = play.tomada.corte || { ini: 0, fim: n - 1 };
        return html`
          <label class="m3d-campo">Início <input type="range" min="0" max=${n - 1} value=${c.ini} onChange=${(e) => aplicarCorte(Math.min(+e.target.value, c.fim - 1), c.fim)} /> <b class="num">${c.ini}</b></label>
          <label class="m3d-campo">Fim <input type="range" min="0" max=${n - 1} value=${c.fim} onChange=${(e) => aplicarCorte(c.ini, Math.max(+e.target.value, c.ini + 1))} /> <b class="num">${c.fim}</b></label>
          <button class="m3d-btn mini" onClick=${() => aplicarCorte(0, n - 1)}>Sem corte</button>`;
      })()}
    </div>`;

  const det = {
    General: html`
      <div class="m3d-kv"><span>Selecionado</span><b>${selOutliner}</b></div>
      ${selOutliner === 'SK_Character' || selOutliner === 'Actor_Mocap' ? html`<div class="m3d-sub">Transform</div>${TransformCampos}<div class="m3d-sub">Ângulos das articulações</div>${Angulos}`
        : html`<p class="m3d-dica">${{ 'SM_Floor': 'Piso de 10 m — ligue/desligue em Rendering.', 'Grade': 'Grade de 25 cm.', 'CameraRig': 'Pirâmides das câmeras calibradas (multicâmera).', 'CoM': 'Centro de massa segmentar (Winter) com rastro e base de suporte — do MoCap do robo.' }[selOutliner] || 'Objeto da cena.'}</p>`}`,
    Animation: html`
      <label class="m3d-campo">Animation Mode
        <select value=${play ? 'tomada' : 'live'} onChange=${(e) => { if (e.target.value === 'live') aoVivo(); else if (tomadas[0]) carregar(tomadas[0]); }}>
          <option value="live">Live Link</option><option value="tomada">Animation Sequence (tomada)</option>
        </select></label>
      <label class="m3d-campo">Live Link Subject
        <select value=${play ? play.tomada.id : 'Actor_Mocap'} onChange=${(e) => { if (e.target.value === 'Actor_Mocap') aoVivo(); else carregar({ id: e.target.value }); }}>
          <option value="Actor_Mocap">Actor_Mocap (ao vivo)</option>
          ${tomadas.map((t) => html`<option key=${t.id} value=${t.id}>${t.nome}</option>`)}
        </select></label>
      <label class="m3d-campo">Retarget Profile <select value="robo15" onChange=${() => {}}><option value="robo15">SK_Mannequin_ROBO (BVH, ZXY, cm)</option></select></label>
      <label class="m3d-campo">Update Rate
        <select value=${String(p.everyMs)} onChange=${(e) => definirParam({ everyMs: +e.target.value })}>
          <option value="0">máximo do aparelho</option><option value="33">30 Hz</option><option value="66">15 Hz</option><option value="100">10 Hz</option>
        </select></label>
      ${play && html`<div class="m3d-kv"><span>Tomada</span><b>${play.tomada.nome} · ${play.proc.trilha.length} q · ${play.tomada.fps} fps</b></div>
        <div class="m3d-kv"><span>Proveniência</span><b>${(ORIGENS[play.tomada.origem] || {}).rotulo || play.tomada.origem}</b></div>
        <label class="m3d-check"><input type="checkbox" checked=${play.loop} onChange=${(e) => setPlay({ ...play, loop: e.target.checked })} /> Repetir</label>`}
      ${Corte}`,
    Physics: html`
      <label class="m3d-check"><input type="checkbox" checked=${p.suavizar} onChange=${(e) => definirParam({ suavizar: e.target.checked })} /> Suavização One Euro (ao vivo)</label>
      <label class="m3d-campo">Corte mínimo (Hz) <input type="number" step="0.1" min="0.1" max="10" value=${p.minCorte} onChange=${(e) => definirParam({ minCorte: Math.max(0.1, +e.target.value || 1.2) })} /></label>
      <label class="m3d-campo">Beta <input type="number" step="0.05" min="0" max="5" value=${p.beta} onChange=${(e) => definirParam({ beta: Math.max(0, +e.target.value || 0) })} /></label>
      <p class="m3d-dica">One Euro do GPlanSiS|ROBO (core/filtros.ts). Nas tomadas, o pós-processamento do robo: lacunas ≤ 0,5 s, Butterworth 4ª ordem fase zero (7 Hz), ossos rígidos, CoM de Winter e base de suporte.</p>
      <label class="m3d-check"><input type="checkbox" checked=${opc.com} onChange=${(e) => setOpc({ ...opc, com: e.target.checked })} /> Centro de massa e base de suporte</label>
      <label class="m3d-check"><input type="checkbox" checked=${opc.chao} onChange=${(e) => setOpc({ ...opc, chao: e.target.checked })} /> Pés no chão (só exibição; os dados exportados ficam como medidos)</label>
      ${play && play.proc && html`<div class="m3d-kv"><span>Ossos (antes)</span><b>variavam ${numero(play.proc.relatorio.variacaoOssosAntes * 100, 1)} % → rígidos</b></div>
        <div class="m3d-kv"><span>Lacunas</span><b>${play.proc.relatorio.preenchidos} preenchidas · ${play.proc.relatorio.lacunasRestantes} restantes</b></div>`}`,
    Rendering: html`
      ${[['grade', 'Grade'], ['piso', 'Piso'], ['cameras', 'Câmeras calibradas'], ['maos', 'Mãos (maos.gestos na cadeia)'], ['borrar', 'Borrar rosto no vídeo (LGPD)']].map(([k, r]) => html`
        <label key=${k} class="m3d-check"><input type="checkbox" checked=${opc[k]} onChange=${(e) => setOpc({ ...opc, [k]: e.target.checked })} /> ${r}</label>`)}
      <label class="m3d-campo">Iluminação <select value=${opc.luz} onChange=${(e) => setOpc({ ...opc, luz: e.target.value })}><option value="lit">Lit</option><option value="unlit">Unlit</option><option value="wireframe">Wireframe</option></select></label>`,
  };
  det.All = html`${det.General}${det.Animation}${det.Physics}${det.Rendering}`;

  const Direita = html`
    <aside class=${`m3d-dir ${gaveta === 'dir' ? 'aberta' : ''}`} aria-label="World Outliner e Details">
      <section class="m3d-sec">
        <h3>World Outliner <small>${OUTLINER.length} itens</small></h3>
        <input class="m3d-busca" type="search" placeholder="Buscar…" value=${buscaOut} onInput=${(e) => setBuscaOut(e.target.value)} aria-label="Buscar no Outliner" />
        <div class="m3d-out" role="listbox" aria-label="Objetos da cena">
          <div class="m3d-out-cab"><span>Label</span><span>Type</span></div>
          ${OUTLINER.map(([n, t]) => html`<div key=${n} role="option" tabindex="0" aria-selected=${selOutliner === n} class=${`m3d-out-l ${selOutliner === n ? 'sel' : ''} ${n === 'Actor_Mocap' && live ? 'viva' : ''}`}
            onClick=${() => setSelOutliner(n)} onKeyDown=${(e) => { if (e.key === 'Enter') setSelOutliner(n); }}><span>${n === 'Cena' ? '▾ ' : '  '}${n}</span><span>${t}</span></div>`)}
        </div>
      </section>
      <section class="m3d-sec m3d-det">
        <h3>Details <small>${selOutliner}</small></h3>
        <div class="m3d-abas" role="tablist">
          ${['General', 'Animation', 'Physics', 'Rendering', 'All'].map((a) => html`<button key=${a} role="tab" aria-selected=${abaDet === a} class=${abaDet === a ? 'on' : ''} onClick=${() => setAbaDet(a)}>${a}</button>`)}
        </div>
        <div class="m3d-det-c" role="tabpanel">${det[abaDet]}</div>
      </section>
    </aside>`;

  const ConteudoCB = html`
    <section class=${`m3d-cb ${cbAberto ? '' : 'fechado'}`} aria-label="Content Browser">
      <div class="m3d-cb-barra">
        <button class="m3d-btn mini" aria-expanded=${cbAberto} onClick=${() => setCbAberto(!cbAberto)}>${cbAberto ? '▾' : '▸'} Content Browser</button>
        <span class="m3d-menu-w">
          <button class="m3d-btn mini" onClick=${() => setMenu(menu === 'add' ? null : 'add')}>＋ Add</button>
          ${menu === 'add' && html`<div class="m3d-menu" role="menu">
            <button role="menuitem" onClick=${() => {
              setMenu(null);
              const b = canalMotion.buffer();
              if (b.length < 5) { setMsg('O buffer ao vivo está vazio.'); return; }
              const rs = reamostrar(b.map((a) => ({ t: a.t, W: a.Wf || a.W, P2: a.P2 })), 30);
              const t = novaTomada({ fps: 30, origem: 'monocular', fonteId: 'buffer 10 s', trilha: rs.trilha, p2d: rs.p2d });
              recarregarLista(); carregar(t, { tocar: false });
              setMsg(`${t.nome}: os últimos ${(rs.trilha.length / 30).toFixed(1)} s do buffer.`);
            }}>Tomada dos últimos 10 s (buffer)</button>
            <button role="menuitem" onClick=${() => { setMenu(null); demonstracao(); }}>Demonstração (3 câmeras virtuais, GPlanSiS|ROBO)</button>
          </div>`}
        </span>
        <button class="m3d-btn mini" onClick=${() => inputImport.current && inputImport.current.click()} title="BVH, FreeMoCap (.npy/.csv) ou JSON">⤓ Import</button>
        <input ref=${inputImport} type="file" hidden multiple accept=".bvh,.npy,.csv,.json" onChange=${(e) => { importar([...e.target.files]); e.target.value = ''; }} />
        <button class="m3d-btn mini" onClick=${salvarTudo}>Save All</button>
        <input class="m3d-busca" type="search" placeholder="Buscar tomadas…" value=${buscaCB} onInput=${(e) => setBuscaCB(e.target.value)} aria-label="Buscar no Content Browser" />
        <small class="m3d-cb-nota">IndexedDB deste navegador · só landmarks</small>
      </div>
      ${cbAberto && html`<div class="m3d-cb-corpo">
        <nav class="m3d-pastas" aria-label="Pastas">
          ${PASTAS.map(([k, d]) => html`<button key=${k} class=${pasta === k ? 'on' : ''} title=${d} onClick=${() => setPasta(k)}>📁 ${k}</button>`)}
        </nav>
        <div class="m3d-cartoes">
          ${(ITENS_FIXOS[pasta] || []).map((it) => html`<div key=${it.id} class="m3d-cartao fixo" title=${it.desc}><div class="m3d-mini fixo">${it.tipo}</div><b>${it.nome}</b><small>${it.tipo}</small></div>`)}
          ${(ITENS_FIXOS[pasta] ? [] : tomadasFiltradas).map((t) => html`
            <div key=${t.id} class=${`m3d-cartao ${play && play.tomada.id === t.id ? 'sel' : ''}`} role="button" tabindex="0" aria-label=${`Tomada ${t.nome}`}
              onClick=${() => carregar(t)} onKeyDown=${(e) => { if (e.key === 'Enter') carregar(t); }}>
              <img class="m3d-mini" src=${t.thumb || ''} alt="" />
              <b onDblClick=${(e) => { e.stopPropagation(); const n = prompt('Novo nome da tomada:', t.nome); if (n) renomear(t, n); }}>${t.naoSalva ? '• ' : ''}${t.nome}</b>
              <small>Animation Sequence · ${t.quadros} q · ${numero(t.quadros / (t.fps || 30), 1)} s</small>
              <small class="m3d-orig">${(ORIGENS[t.origem] || {}).source_type || t.origem}</small>
              <span class="m3d-menu-w m3d-cartao-acoes" onClick=${(e) => e.stopPropagation()}>
                <button class="m3d-btn mini" aria-haspopup="menu" aria-label=${`Exportar ${t.nome}`} onClick=${() => setMenu(menu === 'export:' + t.id ? null : 'export:' + t.id)}>⋯</button>
                ${menu === 'export:' + t.id && html`<div class="m3d-menu" role="menu">
                  <button role="menuitem" onClick=${() => exportar(t, 'bvh')}>Exportar BVH (Blender)</button>
                  <button role="menuitem" onClick=${() => exportar(t, 'glb')}>Exportar GLB animado</button>
                  <button role="menuitem" onClick=${() => exportar(t, 'json')}>Exportar JSON (motionai.pose.v1)</button>
                  <button role="menuitem" onClick=${() => exportar(t, 'json-robo')}>Exportar JSON gplansis-mocap/1</button>
                  <button role="menuitem" onClick=${() => exportar(t, 'csv')}>Exportar CSV</button>
                  <button role="menuitem" onClick=${() => { setMenu(null); const n = prompt('Novo nome da tomada:', t.nome); if (n) renomear(t, n); }}>Renomear</button>
                  <button role="menuitem" class="perigo" onClick=${() => apagar(t)}>Apagar</button>
                </div>`}
              </span>
            </div>`)}
          ${!ITENS_FIXOS[pasta] && !tomadasFiltradas.length && html`<p class="m3d-dica">Nenhuma tomada${buscaCB ? ' com esse nome' : ''}. Grave (●), importe (BVH, FreeMoCap, JSON) ou use ＋ Add › Demonstração.</p>`}
        </div>
      </div>`}
    </section>`;

  const PainelFlutuante = painel && html`
    <div class="m3d-pop" role="dialog" aria-modal="false" aria-label=${painel === 'multicam' ? 'Multicâmera' : painel === 'freemocap' ? 'FreeMoCap' : 'Motores de servidor'}>
      <div class="m3d-pop-cab"><b>${painel === 'multicam' ? 'Multicâmera (FreeMoCap no navegador · GPlanSiS|ROBO)' : painel === 'freemocap' ? 'FreeMoCap · calibração ChArUco · importação' : 'Motores de servidor · fila de jobs'}</b>
        <button class="m3d-btn mini" onClick=${() => setPainel(null)} aria-label="Fechar">✕</button></div>
      <div class="m3d-pop-c">
        ${painel === 'multicam' && html`<${PainelMulticam} motor=${motorMc.current} mc=${mc} onGravar=${gravar} onDemo=${demonstracao} setMsg=${setMsg} />`}
        ${painel === 'freemocap' && html`
          <ol class="m3d-guia">${GUIA_CALIBRACAO.map((g, i) => html`<li key=${i}>${g}</li>`)}</ol>
          <div class="m3d-linha">
            <label class="m3d-campo">Tabuleiro <select value=${tab.chave} onChange=${(e) => setTab({ ...tab, chave: e.target.value, conf: null })}>${Object.entries(TABULEIROS).map(([k, t]) => html`<option key=${k} value=${k}>${t.rotulo}</option>`)}</select></label>
            <label class="m3d-campo">Quadrado (mm) <input type="number" min="15" max="200" value=${tab.mm} onChange=${(e) => setTab({ ...tab, mm: Math.max(15, Math.min(200, +e.target.value || 50)) })} /></label>
          </div>
          <div class="m3d-linha">
            <button class="m3d-btn" onClick=${baixarTabuleiro}>Baixar tabuleiro (SVG em mm)</button>
            <button class="m3d-btn" onClick=${conferir}>Conferir tabuleiro na Fonte</button>
            <button class="m3d-btn acento" onClick=${() => inputImport.current && inputImport.current.click()}>Importar sessão (.npy / .csv / .json)</button>
          </div>
          ${tab.conf && html`<p class="m3d-dica">Marcadores lidos: ${tab.conf.ids.length ? tab.conf.ids.join(', ') : 'nenhum'} (${Math.round(tab.conf.fracao * 100)} %) — busque ≥ 60 % em cada câmera.</p>`}
          <p class="m3d-dica">Para calibrar NO FreeMoCap, prefira o tabuleiro oficial dele (mesmo dicionário 4×4). Exportação para o Blender: abra a tomada e use ⋯ › BVH ou GLB.</p>`}
        ${painel === 'servidor' && html`
          <p class="m3d-aviso-mini">Estes motores rodam num SERVIDOR com GPU (serviço aivision-motion). Enviar um vídeo muda a regra do iaVision de que "nenhum quadro sai do aparelho": só com o seu consentimento, e a tela mostra GPU REMOTA durante o envio. Servidor: <b>${caps.servidor === 'ok' ? 'no ar' : ROTULO_ESTADO[caps.servidor] || caps.servidor}</b>.</p>
          <table class="m3d-tab-mot"><thead><tr><th>Motor</th><th>Estado</th><th>Licença</th><th></th></tr></thead><tbody>
            ${Object.entries(MOTORES).map(([k, m]) => { const e = (caps.motores[k] || {}).estado || 'verificando'; return html`<tr key=${k}><td><b>${m.nome}</b><br /><small>${m.papel}</small></td><td class=${`est-${e}`}>${ROTULO_ESTADO[e] || e}${(caps.motores[k] || {}).detalhe ? html`<br /><small>${caps.motores[k].detalhe}</small>` : ''}</td><td><small>${m.licenca}</small></td>
              <td><button class="m3d-btn mini" disabled=${enviando || caps.servidor !== 'ok'} onClick=${() => pedirServidor(k)}>Pedir job</button></td></tr>`; })}
          </tbody></table>
          <label class="m3d-campo">Vídeo (só enviado se o motor estiver disponível) <input ref=${inputVideoServ} type="file" accept="video/*" /></label>
          <label class="m3d-check m3d-consent"><input type="checkbox" checked=${consent} onChange=${(e) => setConsent(e.target.checked)} /> Autorizo enviar este vídeo ao servidor da GPlanSiS para processamento por um motor de GPU, sabendo que ele sai do meu aparelho e é apagado ao fim do job.</label>
          <div class="m3d-sub">Jobs</div>
          <ul class="m3d-jobs">${jobs.length ? jobs.map((j) => html`<li key=${j.id + j.quando}><b>${MOTORES[j.motor].nome}</b> · ${j.estado} · ${j.quando}<br /><small>${j.detalhe}</small></li>`) : html`<li><small>Nenhum job pedido.</small></li>`}</ul>`}
      </div>
    </div>`;

  // ------------------------------------------------------------------ tela
  return html`
    <div class=${`m3d layout-${layout} vista-${vista}`} ref=${raiz} role="dialog" aria-modal="true" aria-label="GPlanSiS|Motion 3D Studio">
      <div class="m3d-barra">
        <b class="m3d-titulo"><span class="m3d-marca">iaVision</span> <span class="m3d-gp">GPlanSiS<i>|</i></span>Motion 3D Studio</b>
        <button class="m3d-btn m3d-so-cel" onClick=${() => setGaveta(gaveta === 'esq' ? null : 'esq')} aria-expanded=${gaveta === 'esq'}>☰ Motion</button>
        ${Botao({ titulo: 'Salvar (IndexedDB)', onClick: salvar, children: '💾' })}
        <span class="m3d-grupo" role="group" aria-label="Ferramentas de transformação">
          ${[['orbitar', 'Selecionar / orbitar', '⤧'], ['mover', 'Mover (arraste no 3D)', '✥'], ['girar', 'Rotacionar (arraste no 3D)', '⟳'], ['escala', 'Escala (arraste no 3D)', '⤢']].map(([k, t, ic]) =>
            html`<${Botao} key=${k} on=${ferramenta === k} titulo=${t} onClick=${() => { setFerramenta(k); if (k !== 'orbitar' && vista === 'video') setVista('3d'); }}>${ic}<//>`)}
        </span>
        <span class="m3d-grupo" role="group" aria-label="Transporte">
          ${Botao({ titulo: play && play.tocando ? 'Pausar' : 'Reproduzir', onClick: tocar, children: play && play.tocando ? '❚❚' : '▶' })}
          ${Botao({ titulo: 'Quadro anterior', onClick: () => avancar(-1), children: '⏮', dis: !play })}
          ${Botao({ titulo: 'Próximo quadro', onClick: () => avancar(1), children: '⏭', dis: !play })}
          ${Botao({ titulo: 'Parar', onClick: parar, children: '■', dis: !play })}
          ${Botao({ titulo: gravando ? 'Parar gravação' : 'Gravar', onClick: gravar, children: gravando ? '■ REC' : '● REC', cls: `m3d-rec ${gravando ? 'gravando' : ''}` })}
        </span>
        <span class="m3d-menu-w">
          <button class=${`m3d-btn ${menu === 'layout' ? 'on' : ''}`} aria-haspopup="menu" aria-expanded=${menu === 'layout'} onClick=${() => setMenu(menu === 'layout' ? null : 'layout')}>Layout ▾</button>
          ${menu === 'layout' && html`<div class="m3d-menu" role="menu">
            ${[['padrao', 'Padrão (painéis + Content Browser)'], ['foco', 'Foco no viewport'], ['ambos', 'Vídeo e 3D lado a lado']].map(([k, r]) => html`<button key=${k} role="menuitem" class=${layout === k ? 'on' : ''} onClick=${() => { setLayout(k); setMenu(null); }}>${r}</button>`)}
          </div>`}
        </span>
        <span class="m3d-msg" role="status" aria-live="polite">${msg}</span>
        <span class=${`m3d-selo ${remoto ? 'remoto' : ''}`} title=${remoto ? 'Enviando vídeo a um motor de servidor (com consentimento)' : 'Tudo processado neste aparelho'}>${remoto ? 'GPU REMOTA' : 'ON-DEVICE'}</span>
        <${FonteStudio} classeBotao="m3d-btn" />
        <button class="m3d-btn m3d-so-cel" onClick=${() => setGaveta(gaveta === 'dir' ? null : 'dir')} aria-expanded=${gaveta === 'dir'}>Detalhes</button>
        <button class="m3d-btn m3d-fechar" onClick=${onClose} aria-label="Fechar o Motion 3D Studio">✕</button>
      </div>
      <div class="m3d-corpo">
        <aside class=${`m3d-esq ${gaveta === 'esq' ? 'aberta' : ''}`} aria-label="Motion">
          <div class="m3d-esq-cab">Motion</div>
          ${Fontes}
          ${Esqueleto}
        </aside>
        <main class="m3d-centro">
          <div class="m3d-vp-abas">
            <span class="m3d-grupo" role="group" aria-label="Viewport">
              <button class=${`m3d-btn mini ${vista === 'video' ? 'on' : ''}`} aria-pressed=${vista === 'video'} onClick=${() => setVista('video')}>Vídeo + esqueleto</button>
              <button class=${`m3d-btn mini ${vista === '3d' ? 'on' : ''}`} aria-pressed=${vista === '3d'} onClick=${() => setVista('3d')}>3D</button>
            </span>
            ${['Perspective', 'Lit', 'Show'].map((a) => html`<span key=${a} class="m3d-menu-w"><button class=${`m3d-btn mini ${aba3d === a ? 'on' : ''}`} aria-haspopup="menu" onClick=${() => setAba3d(aba3d === a ? null : a)}>${a === 'Perspective' ? ({ perspectiva: 'Perspective', frente: 'Front', lado: 'Side', topo: 'Top', atras: 'Back (espelho)' })[camPreset] : a === 'Lit' ? ({ lit: 'Lit', unlit: 'Unlit', wireframe: 'Wireframe' })[opc.luz] : 'Show'} ▾</button>
              ${aba3d === a && html`<div class="m3d-menu" role="menu">
                ${a === 'Perspective' && [['perspectiva', 'Perspective'], ['frente', 'Front'], ['lado', 'Side'], ['topo', 'Top'], ['atras', 'Back (como espelho)']].map(([k, r]) => html`<button key=${k} role="menuitem" class=${camPreset === k ? 'on' : ''} onClick=${() => { setCamPreset(k); if (cena.current) cena.current.vista(k); setAba3d(null); if (vista === 'video') setVista('3d'); }}>${r}</button>`)}
                ${a === 'Lit' && [['lit', 'Lit'], ['unlit', 'Unlit'], ['wireframe', 'Wireframe']].map(([k, r]) => html`<button key=${k} role="menuitem" class=${opc.luz === k ? 'on' : ''} onClick=${() => { setOpc({ ...opc, luz: k }); setAba3d(null); }}>${r}</button>`)}
                ${a === 'Show' && [['esqueleto', 'Esqueleto'], ['grade', 'Grade'], ['piso', 'Piso'], ['nomes', 'Nomes dos ossos'], ['retarget', 'Retarget (BVH)'], ['com', 'CoM e base de suporte'], ['cameras', 'Câmeras']].map(([k, r]) => html`<button key=${k} role="menuitemcheckbox" aria-checked=${opc[k]} class=${opc[k] ? 'on' : ''} onClick=${() => setOpc({ ...opc, [k]: !opc[k] })}>${opc[k] ? '☑' : '☐'} ${r}</button>`)}
              </div>`}</span>`)}
            <span class="m3d-vp-info">${play ? `▶ ${play.tomada.nome}` : live ? 'Actor_Mocap · ao vivo' : 'sem sinal'}</span>
          </div>
          <div class="m3d-vps">
            <div class="m3d-vp m3d-vp-video"><canvas ref=${cvVid} aria-label="Vídeo com o esqueleto sobreposto"></canvas></div>
            <div class="m3d-vp m3d-vp-3d" ref=${host3d}>${!mostra3d && ''}</div>
          </div>
          <div class="m3d-rodape">
            <span class=${`m3d-live ${live ? 'on' : ''}`}>LIVE</span>
            <button class=${`m3d-btn mini m3d-rec ${gravando ? 'gravando' : ''}`} onClick=${gravar} aria-label=${gravando ? 'Parar gravação' : 'Gravar'}>${gravando ? '■' : '●'}</button>
            <button class="m3d-btn mini" onClick=${tocar} aria-label="Reproduzir/pausar">${play && play.tocando ? '❚❚' : '▶'}</button>
            <button class="m3d-btn mini" onClick=${() => avancar(-1)} disabled=${!play} aria-label="Quadro anterior">⏮</button>
            <button class="m3d-btn mini" onClick=${() => avancar(1)} disabled=${!play} aria-label="Próximo quadro">⏭</button>
            ${play && html`<input class="m3d-scrub" type="range" min="0" max=${somaDur} value=${play.quadro} aria-label="Posição na tomada" onInput=${(e) => setPlay({ ...play, tocando: false, quadro: +e.target.value })} />`}
            ${play && html`<button class="m3d-btn mini" onClick=${aoVivo}>Ao vivo</button>`}
            <span class="m3d-met"><em>Timecode</em><b>${timecode(tcMs, fpsTake)}</b></span>
            <span class="m3d-met"><em>Frame</em><b>${frameNum}</b></span>
            <span class="m3d-met"><em>Rate</em><b>${play ? `${play.tomada.fps} fps` : `${numero(estatisticas.fps, 1)} fps`}</b></span>
            <span class="m3d-met"><em>Buffer</em><b>${estatisticas.gravando ? `${estatisticas.gravadas} rec` : estatisticas.buffer}</b></span>
            <span class="m3d-met"><em>Latency</em><b>${estatisticas.latMed == null ? '—' : `${numero(estatisticas.latMed, 0)} ms`}</b></span>
            <canvas class="m3d-hist" ref=${cvHist} width="120" height="22" aria-label="Histograma de latência"></canvas>
          </div>
        </main>
        ${Direita}
      </div>
      ${layout !== 'foco' && ConteudoCB}
      ${PainelFlutuante}
      ${gaveta && html`<div class="m3d-veu" onClick=${() => setGaveta(null)}></div>`}
    </div>`;
}

/** Painel da Multicâmera: escolher câmeras/arquivos, altura, calibrar, gravar, demonstração. */
function PainelMulticam({ motor, mc, onGravar, onDemo, setMsg }) {
  const [lista, setLista] = useState([]);
  const [escolhidas, setEscolhidas] = useState([]);
  const [altura, setAltura] = useState(motor ? motor.alturaM : 1.7);
  const [prog, setProg] = useState(null);
  const arqs = useRef(null);
  useEffect(() => { MotorMulticam.listar().then(setLista); }, []);
  if (!motor) return html`<p class="m3d-dica">carregando…</p>`;
  const etapa = mc ? mc.etapa : 'cameras';
  const abrir = async () => {
    motor.alturaM = altura;
    const sel = lista.filter((c) => escolhidas.includes(c.id));
    if (!sel.length) { setMsg('Escolha de 1 a 4 câmeras.'); return; }
    await motor.abrir(sel);
  };
  const abrirArquivos = async (fs) => {
    motor.alturaM = altura;
    await motor.abrir([...fs].slice(0, 4).map((f) => ({ id: f.name, rotulo: f.name, arquivo: f })));
  };
  const varrer = async () => {
    setProg(0);
    try { await motor.varrerArquivos((x) => setProg(x)); } catch (e) { setMsg(e.message); }
    setProg(null);
  };
  return html`
    <p class="m3d-dica">O fluxo do FreeMoCap no navegador, com o MoCap do GPlanSiS|ROBO: escolha 2–4 câmeras (ou uma gravação por câmera, começando juntas), calibre pelo próprio corpo, grave e processe. Com 1 câmera: modo monocular.</p>
    <div class="m3d-cams">${lista.length ? lista.map((c) => html`<label key=${c.id} class="m3d-check"><input type="checkbox" checked=${escolhidas.includes(c.id)} disabled=${!escolhidas.includes(c.id) && escolhidas.length >= 4}
      onChange=${(e) => setEscolhidas(e.target.checked ? [...escolhidas, c.id] : escolhidas.filter((x) => x !== c.id))} /> ${c.rotulo}</label>`) : html`<small>Nenhuma câmera listada (permita a câmera na Fonte primeiro).</small>`}</div>
    <div class="m3d-linha">
      <label class="m3d-campo">Sua altura (m) <input type="number" step="0.01" min="1" max="2.3" value=${altura} onChange=${(e) => { const v = Math.max(1, Math.min(2.3, +e.target.value || 1.7)); setAltura(v); motor.alturaM = v; }} /></label>
      <label class="m3d-campo">FOV horizontal (°) <input type="number" min="30" max="120" value=${motor.fovGraus} onChange=${(e) => { motor.fovGraus = Math.max(30, Math.min(120, +e.target.value || 62)); }} /></label>
    </div>
    <div class="m3d-linha">
      <button class="m3d-btn" onClick=${abrir}>Abrir câmeras</button>
      <button class="m3d-btn" onClick=${() => arqs.current && arqs.current.click()}>Abrir vídeos (1 por câmera)</button>
      <input ref=${arqs} type="file" accept="video/*" multiple hidden onChange=${(e) => { abrirArquivos(e.target.files); e.target.value = ''; }} />
      <button class="m3d-btn acento" onClick=${onDemo}>Demonstração (3 câmeras virtuais)</button>
    </div>
    ${mc && mc.vistas && mc.vistas.length > 0 && html`
      <div class="m3d-vistas">${mc.vistas.map((v) => html`<span key=${v.id} class=${`m3d-vista ${v.detecta ? 'ok' : ''}`}>${v.detecta ? '●' : '○'} ${v.rotulo}</span>`)}</div>
      <div class="m3d-linha">
        ${mc.modo === 'multi' && (etapa === 'calibrando'
          ? html`<button class="m3d-btn acento" onClick=${() => motor.concluirCalibracao()}>Concluir calibração (${mc.quadrosGravados} quadros)</button>`
          : html`<button class="m3d-btn" onClick=${() => motor.iniciarCalibracao()}>Calibrar pelo corpo</button>`)}
        <button class=${`m3d-btn m3d-rec ${etapa === 'gravando' ? 'gravando' : ''}`} disabled=${mc.modo === 'multi' && !mc.calibracao} onClick=${onGravar}>${etapa === 'gravando' ? `■ Parar (${mc.quadrosGravados})` : '● Gravar'}</button>
        ${mc.vistas.every((v) => v.arquivo) && html`<button class="m3d-btn" onClick=${varrer} disabled=${prog != null}>${prog != null ? `Varrendo ${Math.round(prog * 100)} %` : 'Varrer os vídeos'}</button>`}
        <button class="m3d-btn" onClick=${() => motor.fechar() || motor.avisar('Vistas fechadas.')}>Fechar vistas</button>
      </div>`}
    ${mc && mc.calibracao && html`<p class="m3d-dica">Calibração: reprojeção ${mc.calibracao.erroPx.toFixed(2)} px · inliers ${mc.calibracao.inliers.slice(1).map((v) => Math.round(v * 100) + ' %').join(', ')} · ${mc.calibracao.correspondencias} correspondências.</p>`}
    <p class="m3d-dica">${mc ? mc.mensagem : ''}</p>
    <p class="m3d-aviso-mini">Limites (do robo): calibrar pelo corpo pede movimento com profundidade (andar e girar); sem modelo de distorção de lente; sincronia por software (defasagem ${'<'} 1 quadro com arquivos, maior ao vivo com várias câmeras na fila única do ORT).</p>`;
}

export default StudioMotion3D;
