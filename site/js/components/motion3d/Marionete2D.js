/**
 * components/motion3d/Marionete2D.js — a vista "Marionete 2D" do Motion 3D Studio v2: imagem →
 * recorte (BiRefNet, ajustável a pincel) → esqueleto (pose do iaVision ou padrão, arrastável)
 * → malha + pesos geodésicos → a figura se move com a captura ao vivo (câmera, YouTube,
 * dispositivo, vídeo) ou com a tomada aberta. Exporta vídeo (WebM/MP4 ao vivo; MP4 exato da
 * tomada) e sequência PNG com alfa (.zip). As marionetes ficam no IndexedDB (Characters).
 * Tudo no aparelho: a imagem não sai do navegador.
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { JUNTAS_2D, OSSOS_2D, esqueletoPadrao, caixaMascara, montarMalha, pesosGeodesicos, cortarCosturas, poseMarionete, deformar, conferirMalha, canvasRecortado, PalcoMarionete } from './marionete.js';
import { lerImagem, alfaDaImagem, recorteAutomatico, poseAutomatica } from './marionete-analise.js';
import { gravarAoVivo, exportarMP4, exportarPNGzip } from './gravador.js';
import * as armazem from '../../cv/runtime/livres-v/armazem.js';
import { novoId } from '../../cv/runtime/livres-v/tomada.js';

const baixar = (blob, nome) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000); };
const FUNDOS = [['transp', 'Transparente'], ['#00b140', 'Chroma verde'], ['#0047bb', 'Chroma azul'], ['#111417', 'Escuro'], ['#ffffff', 'Branco']];

/**
 * obterPose() → { W (33 pontos), chave } da fonte atual (ao vivo ou tomada); quadrosTomada() →
 * { n, fps, W(i), nome } | null. `abrir` = { id } de uma marionete salva para carregar.
 */
export function Marionete2D({ obterPose, quadrosTomada, setMsg, abrir = null, arquivo = null, aoSalvar = () => {} }) {
  const host = useRef(null), sobre = useRef(null), palco = useRef(null), inputImg = useRef(null);
  const [fig, setFig] = useState(null);          // { id, nome, w, h, img (canvas), alfa (Float32Array), juntas, temAlfa }
  const [modo, setModo] = useState('animar');    // recorte | esqueleto | animar
  const [pincel, setPincel] = useState({ tipo: 'tirar', raio: 18 });
  const [ocupado, setOcupado] = useState('');
  const [fundo, setFundo] = useState('transp');
  const [seguirPos, setSeguirPos] = useState(true);
  const [conf, setConf] = useState(null);
  const [grav, setGrav] = useState(null);
  const [prog, setProg] = useState(null);
  const malhaRef = useRef(null);                  // { malha, pesos, P (deformados), dirs }
  const figRef = useRef(null); figRef.current = fig;
  const modoRef = useRef(modo); modoRef.current = modo;
  const arrasto = useRef(null);
  const raiz0 = useRef(null);

  // palco three.js
  useEffect(() => {
    if (!host.current) return undefined;
    try { palco.current = new PalcoMarionete(host.current); } catch (e) { setMsg(`WebGL indisponível: ${e.message}`); }
    return () => { if (palco.current) palco.current.destruir(); palco.current = null; };
  }, []);
  useEffect(() => { if (palco.current) palco.current.definirFundo(fundo === 'transp' ? null : fundo); }, [fundo]);

  /** Recria textura, malha e pesos (depois de mudar recorte ou juntas). */
  const remontar = useCallback((f = figRef.current) => {
    if (!f || !palco.current) return;
    const t0 = performance.now();
    const tex = canvasRecortado(f.img, f.alfa, f.w, f.h);
    const passo = Math.max(5, Math.round(Math.max(f.w, f.h) / 110));
    const malha0 = montarMalha(f.alfa, f.w, f.h, passo);
    if (!malha0.n) { setMsg('O recorte ficou vazio: ajuste o limiar ou pinte a figura.'); return; }
    const pesos = pesosGeodesicos(malha0, f.juntas);
    const malha = cortarCosturas(malha0, pesos);
    malhaRef.current = { malha, pesos, P: new Float32Array(malha.V), dirs: null };
    palco.current.montar(tex, malha, f.w, f.h);
    raiz0.current = null;
    setConf({ vertices: malha.n, triangulos: malha.T.length / 3, ms: Math.round(performance.now() - t0) });
    desenharSobre();
  }, [setMsg]);

  const carregarFigura = useCallback((f) => { setFig(f); figRef.current = f; remontar(f); }, [remontar]);

  // abrir uma marionete salva
  useEffect(() => {
    if (!abrir || !abrir.id) return;
    (async () => {
      const m = await armazem.lerModelo(abrir.id);
      if (!m || m.tipo !== 'marionete') { setMsg('Marionete não encontrada.'); return; }
      const im = await lerImagem(m.imagem);
      const alfa = new Float32Array(m.alfa.length); for (let i = 0; i < alfa.length; i++) alfa[i] = m.alfa[i] / 255;
      carregarFigura({ id: m.id, nome: m.nome, w: im.w, h: im.h, img: im.img, alfa, juntas: m.juntas, temAlfa: true, blob: m.imagem });
      setModo('animar');
      setMsg(`Marionete ${m.nome} aberta.`);
    })().catch((e) => setMsg(`Não abriu: ${e.message}`));
  }, [abrir && abrir.id]);

  /** Nova imagem: lê, recorta (alfa próprio ou BiRefNet), acha o esqueleto, monta. */
  const novaImagem = useCallback(async (arq) => {
    if (!arq) return;
    try {
      setOcupado('lendo a imagem…');
      const im = await lerImagem(arq);
      let alfa;
      if (im.temAlfa) { alfa = alfaDaImagem(im.dados); setMsg('A imagem já tem transparência: usei o alfa dela (refaça com o BiRefNet se quiser).'); }
      else alfa = await recorteAutomatico(im.dados, setOcupado);
      const cx = caixaMascara(alfa, im.w, im.h) || { x1: 0, y1: 0, x2: im.w - 1, y2: im.h - 1 };
      let juntas = esqueletoPadrao(cx.x1, cx.y1, cx.x2, cx.y2), origem = 'padrão';
      try {
        const p = await poseAutomatica(im.dados, setOcupado);
        if (p && p.confianca > 0.45) { juntas = p.juntas; origem = `pose do iaVision (confiança ${Math.round(p.confianca * 100)} %)`; }
      } catch (e) { /* sem pose: padrão */ }
      const nome = String(arq.name || 'Marionete').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40);
      carregarFigura({ id: null, nome: `PUP_${nome}`, w: im.w, h: im.h, img: im.img, alfa, juntas, temAlfa: im.temAlfa, blob: arq });
      setModo('esqueleto');
      setMsg(`Imagem ${im.w}×${im.h}: recorte pronto, esqueleto pela ${origem}. Confira as juntas (arraste) e depois Animar.`);
    } catch (e) { setMsg(`Imagem: ${e.message}`); }
    setOcupado('');
  }, [carregarFigura, setMsg]);

  // imagem vinda do Import do Content Browser
  useEffect(() => { if (arquivo && arquivo.f) novaImagem(arquivo.f); }, [arquivo && arquivo.t]);

  const refazerRecorte = useCallback(async () => {
    const f = figRef.current; if (!f) return;
    setOcupado('recortando…');
    try {
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h; const g = c.getContext('2d'); g.drawImage(f.img, 0, 0);
      const alfa = await recorteAutomatico(g.getImageData(0, 0, f.w, f.h), setOcupado);
      carregarFigura({ ...f, alfa });
    } catch (e) { setMsg(`Recorte: ${e.message}`); }
    setOcupado('');
  }, [carregarFigura, setMsg]);

  const limiarRecorte = useCallback((lim) => {
    const f = figRef.current; if (!f) return;
    const a = f.alfa.map((v) => Math.min(1, Math.max(0, (v - lim) * 6 + 0.5)));
    carregarFigura({ ...f, alfa: a });
  }, [carregarFigura]);

  // ------------------------------------------------------------------ sobreposição (edição)
  const paraTela = () => {
    const p = palco.current, c = sobre.current;
    if (!p || !c || !figRef.current) return null;
    const cam = p.camera, W = c.width, H = c.height;
    const sx = W / (cam.right - cam.left), sy = H / (cam.top - cam.bottom);
    return { de: (x, y) => [(x - cam.left) * sx, (cam.top + y) * sy], para: (X, Y) => [X / sx + cam.left, Y / sy - cam.top], k: sx };
  };
  function desenharSobre() {
    const c = sobre.current, f = figRef.current;
    if (!c) return;
    const box = c.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(box.clientWidth * dpr), H = Math.round(box.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    if (!f || modoRef.current === 'animar') return;
    const T = paraTela(); if (!T) return;
    if (modoRef.current === 'recorte') {
      // a imagem original esmaecida mostra o que ficou de fora do recorte
      const [x0, y0] = T.de(0, 0), [x1, y1] = T.de(f.w, f.h);
      g.globalAlpha = 0.3; g.drawImage(f.img, x0, y0, x1 - x0, y1 - y0); g.globalAlpha = 1;
      return;
    }
    const J = f.juntas;
    const pt = (k) => (k === 'Q' ? J[23] && J[24] && [(J[23][0] + J[24][0]) / 2, (J[23][1] + J[24][1]) / 2] : k === 'O' ? J[11] && J[12] && [(J[11][0] + J[12][0]) / 2, (J[11][1] + J[12][1]) / 2] : J[k]);
    g.lineWidth = 3 * dpr; g.strokeStyle = '#2EF2D0'; g.lineCap = 'round';
    for (const [, de, para] of OSSOS_2D) { const a = pt(de), b = pt(para); if (!a || !b) continue; const A = T.de(a[0], a[1]), B = T.de(b[0], b[1]); g.beginPath(); g.moveTo(A[0], A[1]); g.lineTo(B[0], B[1]); g.stroke(); }
    g.font = `${11 * dpr}px Archivo, Arial, sans-serif`;
    for (const [i, rot] of JUNTAS_2D) {
      const p = J[i]; if (!p) continue;
      const [X, Y] = T.de(p[0], p[1]);
      const sel = arrasto.current && arrasto.current.i === i;
      g.fillStyle = sel ? '#FFD84D' : i % 2 ? '#7dd3fc' : '#fda4af';   // esquerda (ímpar) azul, direita (par) rosa
      if (i === 0) g.fillStyle = sel ? '#FFD84D' : '#E8FFFB';
      g.beginPath(); g.arc(X, Y, (sel ? 8 : 6) * dpr, 0, 2 * Math.PI); g.fill();
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillText(rot, X + 9 * dpr, Y - 7 * dpr);
    }
  }
  useEffect(() => {
    const ro = new ResizeObserver(() => desenharSobre());
    if (sobre.current) ro.observe(sobre.current.parentElement);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { desenharSobre(); if (modo !== 'animar' && palco.current && malhaRef.current) { palco.current.atualizar(malhaRef.current.malha.V); } }, [modo, fig]);

  const evento = (e) => {
    const c = sobre.current, T = paraTela(), f = figRef.current;
    if (!c || !T || !f) return null;
    const r = c.getBoundingClientRect(), dpr = c.width / r.width;
    const [x, y] = T.para((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    return { x, y, dpr, T };
  };
  const pincelar = (p) => {
    const f = figRef.current, R = pincel.raio * (f.w / 600), v = pincel.tipo === 'por' ? 1 : 0;
    for (let y = Math.max(0, Math.floor(p.y - R)); y <= Math.min(f.h - 1, Math.ceil(p.y + R)); y++)
      for (let x = Math.max(0, Math.floor(p.x - R)); x <= Math.min(f.w - 1, Math.ceil(p.x + R)); x++)
        if ((x - p.x) ** 2 + (y - p.y) ** 2 <= R * R) f.alfa[y * f.w + x] = v;
    const g = sobre.current.getContext('2d'), [X, Y] = p.T.de(p.x, p.y);
    g.fillStyle = v ? 'rgba(46,242,208,.35)' : 'rgba(248,113,113,.45)';
    g.beginPath(); g.arc(X, Y, R * p.T.k, 0, 2 * Math.PI); g.fill();
  };
  const onDown = (e) => {
    const p = evento(e); if (!p) return;
    if (modo === 'esqueleto') {
      let melhor = null, dm = 22 * p.dpr / p.T.k;
      for (const [i] of JUNTAS_2D) { const q = fig.juntas[i]; if (!q) continue; const d = Math.hypot(q[0] - p.x, q[1] - p.y); if (d < dm) { dm = d; melhor = i; } }
      if (melhor != null) { arrasto.current = { i: melhor }; e.currentTarget.setPointerCapture(e.pointerId); desenharSobre(); }
    } else if (modo === 'recorte') { arrasto.current = { pincel: true }; e.currentTarget.setPointerCapture(e.pointerId); pincelar(p); }
  };
  const onMove = (e) => {
    if (!arrasto.current) return;
    const p = evento(e); if (!p) return;
    if (arrasto.current.pincel) pincelar(p);
    else { fig.juntas[arrasto.current.i] = [Math.max(0, Math.min(fig.w, p.x)), Math.max(0, Math.min(fig.h, p.y))]; desenharSobre(); }
  };
  const onUp = () => {
    if (!arrasto.current) return;
    const era = arrasto.current; arrasto.current = null;
    if (era.pincel) carregarFigura({ ...fig, alfa: fig.alfa });
    else remontar({ ...fig });
  };

  // ------------------------------------------------------------------ animação
  /** Deforma para a pose W; devolve a conferência da malha. */
  const posar = useCallback((W, P2hip = null) => {
    const m = malhaRef.current, f = figRef.current;
    if (!m || !f) return null;
    let desl = [0, 0];
    if (seguirPos && W && W[23] && W[24]) {
      // o quadril anda na captura (metros) → px da marionete (escala pela altura do tronco)
      const hx = (W[23][0] + W[24][0]) / 2, hz = (W[23][1] + W[24][1]) / 2;
      if (!raiz0.current) raiz0.current = [hx, hz];
      const J = f.juntas, tronco = J[11] && J[23] ? Math.hypot((J[11][0] + J[12][0] - J[23][0] - J[24][0]) / 2, (J[11][1] + J[12][1] - J[23][1] - J[24][1]) / 2) : f.h / 3;
      const k = tronco / 0.5;
      desl = [(hx - raiz0.current[0]) * k, -(hz - raiz0.current[1]) * k];
    }
    void P2hip;
    const pose = poseMarionete(f.juntas, W, desl, m.dirs);
    m.dirs = pose.dirs;
    deformar(m.malha, m.pesos, pose.tr, m.P);
    palco.current.atualizar(m.P);
    return m.P;
  }, [seguirPos]);

  useEffect(() => {
    if (modo !== 'animar') return undefined;
    let id = 0, chaveAnt = null;
    const laco = () => {
      id = requestAnimationFrame(laco);
      const o = obterPose();
      if (!o || !o.W || o.chave === chaveAnt) return;
      chaveAnt = o.chave;
      posar(o.W);
    };
    id = requestAnimationFrame(laco);
    return () => cancelAnimationFrame(id);
  }, [modo, posar, obterPose]);

  // ------------------------------------------------------------------ salvar e exportar
  const salvar = async () => {
    const f = figRef.current; if (!f) return;
    try {
      const alfa = new Uint8Array(f.alfa.length); for (let i = 0; i < alfa.length; i++) alfa[i] = Math.round(f.alfa[i] * 255);
      const c = document.createElement('canvas'); c.width = f.w; c.height = f.h; c.getContext('2d').drawImage(f.img, 0, 0);
      const imagem = await new Promise((ok) => c.toBlob(ok, 'image/png'));
      const th = document.createElement('canvas'); th.width = 160; th.height = 100;
      const tg = th.getContext('2d'); tg.fillStyle = '#0b1416'; tg.fillRect(0, 0, 160, 100);
      const rc = canvasRecortado(f.img, f.alfa, f.w, f.h), k = Math.min(150 / f.w, 92 / f.h);
      tg.drawImage(rc, (160 - f.w * k) / 2, (100 - f.h * k) / 2, f.w * k, f.h * k);
      const id = f.id || novoId('pup');
      await armazem.salvarModelo({ id, tipo: 'marionete', nome: f.nome, formato: 'png', imagem, alfa, juntas: f.juntas, w: f.w, h: f.h, thumb: th.toDataURL('image/png'), criado: new Date().toISOString() });
      setFig({ ...f, id }); figRef.current = { ...f, id };
      setMsg(`${f.nome} salva neste navegador (Characters).`);
      aoSalvar();
    } catch (e) { setMsg(`Não salvou: ${e.message}`); }
  };
  const gravarVivo = async (preferir) => {
    if (!palco.current) return;
    if (grav) { const r = await grav.parar(); setGrav(null); baixar(r.blob, `${(fig && fig.nome) || 'marionete'}.${r.ext}`); setMsg(`Vídeo ${r.ext.toUpperCase()} (${r.segundos.toFixed(1)} s, ${(r.blob.size / 1e6).toFixed(1)} MB).`); return; }
    try { setGrav(gravarAoVivo(palco.current.canvas, 30, 8e6, preferir)); setModo('animar'); setMsg('● Gravando a marionete…'); } catch (e) { setMsg(e.message); }
  };
  const exportarTomada = async (tipo) => {
    const q = quadrosTomada();
    if (!q) { setMsg('Abra uma tomada (Content Browser) para exportar quadro a quadro.'); return; }
    const p = palco.current; if (!p || !malhaRef.current) return;
    const f = figRef.current;
    const k = Math.min(1, 1280 / (f.w * 1.25), 1280 / (f.h * 1.25));
    const W = Math.round(f.w * 1.25 * k / 2) * 2, H = Math.round(f.h * 1.25 * k / 2) * 2;
    const voltar = p.tamanhoFixo(W, H);
    const fundoAntes = fundo;
    raiz0.current = null; malhaRef.current.dirs = null;
    setProg(0);
    try {
      const desenhar = (i) => { posar(q.W(i)); };
      if (tipo === 'png') {
        if (fundoAntes !== 'transp') p.definirFundo(null);
        const z = await exportarPNGzip({ canvas: p.canvas, n: q.n, desenhar, prefixo: f.nome, aoProgresso: setProg });
        baixar(z, `${f.nome}_${q.nome}_png.zip`);
        setMsg(`${q.n} PNG com alfa (${(z.size / 1e6).toFixed(1)} MB, .zip).`);
      } else {
        if (fundoAntes === 'transp') p.definirFundo('#111417');   // MP4 não tem alfa
        const b = await exportarMP4({ canvas: p.canvas, n: q.n, fps: q.fps, desenhar, aoProgresso: setProg });
        baixar(b, `${f.nome}_${q.nome}.mp4`);
        setMsg(`MP4 ${W}×${H}, ${q.n} quadros a ${q.fps} fps (${(b.size / 1e6).toFixed(1)} MB).`);
      }
    } catch (e) { setMsg(`Exportação: ${e.message}`); }
    p.definirFundo(fundoAntes === 'transp' ? null : fundoAntes);
    voltar(); setProg(null);
  };

  // gancho de teste
  useEffect(() => {
    window.aivMarionete = {
      novaImagem, posar: (W) => posar(W), estado: () => ({ fig: fig ? { nome: fig.nome, w: fig.w, h: fig.h, juntas: fig.juntas } : null, conf, modo }),
      conferir: (W) => { const m = malhaRef.current; if (!m) return null; posar(W); return conferirMalha(m.malha, m.P); },
      definirModo: setModo, salvar, exportarTomada, png: () => palco.current && palco.current.canvas.toDataURL('image/png'),
    };
    return () => { delete window.aivMarionete; };
  });

  return html`
    <div class="m3d-pup">
      <div class="m3d-pup-barra">
        <button class="m3d-btn mini acento" onClick=${() => inputImg.current && inputImg.current.click()}>🖼 Imagem…</button>
        <input ref=${inputImg} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" onChange=${(e) => { novaImagem(e.target.files[0]); e.target.value = ''; }} />
        <span class="m3d-grupo" role="group" aria-label="Etapa da marionete">
          ${[['recorte', '1 Recorte'], ['esqueleto', '2 Esqueleto'], ['animar', '3 Animar']].map(([k, r]) => html`<button key=${k} class=${`m3d-btn mini ${modo === k ? 'on' : ''}`} aria-pressed=${modo === k} disabled=${!fig} onClick=${() => setModo(k)}>${r}</button>`)}
        </span>
        ${modo === 'recorte' && fig && html`
          <button class="m3d-btn mini" onClick=${refazerRecorte}>BiRefNet de novo</button>
          <label class="m3d-campo mini">Pincel <select value=${pincel.tipo} onChange=${(e) => setPincel({ ...pincel, tipo: e.target.value })}><option value="tirar">tirar</option><option value="por">pôr</option></select></label>
          <label class="m3d-campo mini">Raio <input type="range" min="4" max="60" value=${pincel.raio} onInput=${(e) => setPincel({ ...pincel, raio: +e.target.value })} /></label>
          <label class="m3d-campo mini">Limiar <input type="range" min="0.1" max="0.9" step="0.05" defaultValue="0.5" onChange=${(e) => limiarRecorte(+e.target.value)} /></label>`}
        ${modo === 'esqueleto' && fig && html`
          <button class="m3d-btn mini" onClick=${async () => { setOcupado('procurando o corpo…'); try { const c = document.createElement('canvas'); c.width = fig.w; c.height = fig.h; const g = c.getContext('2d'); g.drawImage(fig.img, 0, 0); const p = await poseAutomatica(g.getImageData(0, 0, fig.w, fig.h), setOcupado); if (p) { carregarFigura({ ...fig, juntas: p.juntas }); setMsg(`Pose: confiança ${Math.round(p.confianca * 100)} %.`); } else setMsg('A pose não achou um corpo: use o esqueleto padrão e arraste.'); } catch (e) { setMsg(e.message); } setOcupado(''); }}>Detectar pose</button>
          <button class="m3d-btn mini" onClick=${() => { const c = caixaMascara(fig.alfa, fig.w, fig.h) || { x1: 0, y1: 0, x2: fig.w, y2: fig.h }; carregarFigura({ ...fig, juntas: esqueletoPadrao(c.x1, c.y1, c.x2, c.y2) }); }}>Esqueleto padrão</button>
          <small class="m3d-dica">Arraste as juntas. Azul = lado ESQUERDO da figura (à direita da imagem, como quem olha de frente).</small>`}
        ${modo === 'animar' && fig && html`
          <label class="m3d-check mini"><input type="checkbox" checked=${seguirPos} onChange=${(e) => { setSeguirPos(e.target.checked); raiz0.current = null; }} /> seguir a posição</label>
          <label class="m3d-campo mini">Fundo <select value=${fundo} onChange=${(e) => setFundo(e.target.value)}>${FUNDOS.map(([k, r]) => html`<option key=${k} value=${k}>${r}</option>`)}</select></label>
          <button class=${`m3d-btn mini m3d-rec ${grav ? 'gravando' : ''}`} onClick=${() => gravarVivo('webm')}>${grav ? '■ Parar' : '● WebM ao vivo'}</button>
          ${!grav && html`<button class="m3d-btn mini" onClick=${() => gravarVivo(null)}>● MP4/ao vivo</button>`}
          <button class="m3d-btn mini" disabled=${prog != null} onClick=${() => exportarTomada('mp4')}>MP4 da tomada</button>
          <button class="m3d-btn mini" disabled=${prog != null} onClick=${() => exportarTomada('png')}>PNG+alfa (.zip)</button>`}
        ${fig && html`<button class="m3d-btn mini" onClick=${salvar}>💾 Salvar</button>`}
        <span class="m3d-pup-info">${ocupado ? `⏳ ${ocupado}` : prog != null ? `exportando ${Math.round(prog * 100)} %` : fig ? `${fig.nome} · ${fig.w}×${fig.h}${conf ? ` · malha ${conf.vertices} v / ${conf.triangulos} t (${conf.ms} ms)` : ''}` : ''}</span>
      </div>
      <div class=${`m3d-pup-palco ${fundo === 'transp' ? 'xadrez' : ''}`}>
        <div class="m3d-pup-gl" ref=${host}></div>
        <canvas class=${`m3d-pup-sobre modo-${modo}`} ref=${sobre} onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp} aria-label="Edição da marionete"></canvas>
        ${!fig && html`<div class="m3d-pup-vazio"><b>Imagem → movimento 2D</b><p>Coloque uma foto de pessoa, um desenho ou um personagem (PNG, JPG, WebP). O iaVision recorta o fundo (BiRefNet), acha as juntas (pose) e a figura passa a se mover com a Fonte — câmera, YouTube, dispositivo ou vídeo — ou com a tomada aberta. Tudo neste aparelho.</p>
          <button class="m3d-btn acento" onClick=${() => inputImg.current && inputImg.current.click()}>Escolher imagem…</button></div>`}
      </div>
    </div>`;
}

export default Marionete2D;
