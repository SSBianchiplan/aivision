/**
 * components/industrial/StudioInspect.js — a tela cheia "GPlanSiS|Inspect":
 * a inspeção visual (CV-40) no formato das telas Live/Review do
 * GPlanSiS|Inspect, no tema do iaVision (claro e escuro; os quadros ficam no
 * palco escuro, como o vídeo).
 *
 *   Ao vivo        o quadro do pipeline com a ROI do gatilho (cor do estado,
 *                  barra de ocupação com os limiares) e as ROIs das ferramentas.
 *                  Com o editor aberto, ARRASTAR desenha a ROI da ferramenta
 *                  escolhida (vira uma marcação "Inspect · …" das Ferramentas de mouse).
 *   Inspecionada   o último quadro congelado (ou o escolhido no histórico, ou o
 *                  teste do rascunho) com o overlay de cada ferramenta; passar o
 *                  mouse na tabela destaca a ferramenta.
 *   Veredito       OK verde / NOK vermelho / INCERTO âmbar, grande.
 *   Medidas        valor, critério, estado e tempo de cada ferramenta.
 *   Estatística    contadores, refugo, rendimento, sequência, Cpk, alarmes.
 *   Histórico      miniaturas com veredito (filtro), CSV.
 *   Revisão        a fila NOK/INCERTO: confirmar OK/NOK, classe, motivo —
 *                  "a máquina propõe, o humano confirma".
 *   Programa       o editor (InspectEditor.js).
 *   Treinar        envia as peças (JPEG) a um projeto do Treinar (auth/treino.js);
 *                  "Treinar anomalia com as BOAS" manda as peças OK (recortadas na ROI
 *                  da ferramenta de anomalia) a um projeto de anomalia (PatchCore).
 *   Parte 2        texto lido, código, classe, contagem e nota por ferramenta na
 *                  tabela de medidas; mapa de calor da anomalia no quadro; peça
 *                  "lendo modelos…" enquanto as ferramentas com modelo respondem.
 *
 * A fonte é a do app; a barra de vídeo do app fica por cima desta tela.
 * Gancho de teste: window.aivInspect.
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import * as canal from '../../cv/runtime/livres-n/canal.js';
import { FERRAMENTAS } from '../../cv/runtime/livres-n/ferramentas.js';
import { garantirToken, entrarComSenha, listarProjetos, enviarImagens, lerQuem, apiTreino } from '../../auth/treino.js';
import {
  OP, fmt, pct, hora, dataHora, ROT, COR, injetarCSS, ativarInspect, baixar, carimbo,
  desenharVivo, desenharInspecao, pintarFundo, marcarFerramenta, marcarGatilho,
} from './inspect-comum.js';
import { InspectEditor } from './InspectEditor.js';

const clonar = (o) => JSON.parse(JSON.stringify(o));
const CLS = { OK: 'ok', NOK: 'nok', INCERTO: 'inc' };
const ST = { PASS: 'ok', FAIL: 'nok', UNCERTAIN: 'inc', ERROR: 'inc' };

/** Uma linha de detalhe por ferramenta da parte 2 (o que foi lido / decidido). */
export function detalheDe(r) {
  const d = r.detail || {};
  const j = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
  switch (r.type) {
    case 'ocr': return [d.lines && d.lines.length ? `lido «${d.lines.join(' ')}»` : '', d.expanded != null ? `esperado «${d.expanded}»` : '',
      d.days_valid != null ? `validade ${d.days_valid} d` : '', r.confidence != null ? `conf ${fmt(r.confidence, 3)}` : '', (d.reasons || []).join('; ')].filter(Boolean).join(' · ');
    case 'code': return [d.format, d.gs1 ? 'GS1 ' + Object.entries(d.gs1).map(([k, v]) => `(${k})${v}`).join('') : '', (d.reasons || []).join('; ')].filter(Boolean).join(' · ');
    case 'serial': return [d.num != null ? `nº ${d.num}` : '', d.last != null ? `anterior ${d.last}` : '', d.reason].filter(Boolean).join(' · ');
    case 'detect': return [j(d.counts) || 'nada detectado', (d.reasons || []).join('; ')].filter(Boolean).join(' · ');
    case 'classify': return [`conjunto {${(d.set || []).join(', ')}}`, `p ${fmt(r.confidence, 3)}`, d.qhat != null ? `T ${d.temperature} · q̂ ${d.qhat}` : ''].filter(Boolean).join(' · ');
    case 'anomaly': return d.raw != null ? `nota bruta ${fmt(d.raw, 3)} · limiar ${fmt(d.threshold, 3)}${d.regioes ? ` · ${d.regioes} região(ões)` : ''}` : '';
    default: return '';
  }
}

function CartaoRevisao({ r, onMsg, onVer }) {
  const [dec, setDec] = useState(null);
  const [classe, setClasse] = useState('');
  const [motivo, setMotivo] = useState('');
  const valido = dec && motivo.trim().length >= 5 && (dec === 'OK' || classe);
  const falhas = r.resultados.filter((x) => x.status !== 'PASS');
  const registrar = () => {
    try { canal.revisar(r.id, { decisao: dec, classe, motivo }); onMsg(`#${r.id} revisada: ${dec}.`); } catch (e) { onMsg('⚠ ' + e.message); }
  };
  return html`
    <li class="ins-rev">
      <button class="ins-rev-mini" onClick=${() => onVer(r.id)} title="Ver esta peça">
        ${r.mini ? html`<img src=${r.mini} alt=${'Peça #' + r.id} />` : html`<span>#${r.id}</span>`}
      </button>
      <div class="ins-rev-c">
        <div><b class=${'ins-v ' + CLS[r.veredito]}>${r.veredito}</b> <b>#${r.id}</b> · ${hora(r.t)} · ${r.programa.codigo} v${r.programa.versao}</div>
        <div class="ins-rev-f">${falhas.map((x) => html`<span key=${x.code} class=${'ins-st ' + ST[x.status]}>${x.code} ${ROT[x.status]}${x.value != null ? ' ' + fmt(x.value) : ''}</span>`)}</div>
        <div class="ins-rev-d" role="radiogroup" aria-label="Decisão">
          <button class="ins-btn ${dec === 'OK' ? 'ok on' : ''}" aria-pressed=${dec === 'OK'} onClick=${() => setDec('OK')}>Confirmar OK</button>
          <button class="ins-btn ${dec === 'NOK' ? 'nok on' : ''}" aria-pressed=${dec === 'NOK'} onClick=${() => setDec('NOK')}>Confirmar NOK</button>
          <select class="ins-btn" value=${classe} disabled=${dec !== 'NOK'} onChange=${(e) => setClasse(e.target.value)} aria-label="Classe do defeito">
            <option value="">Classe do defeito</option>${canal.CLASSES_DEFEITO.map((c) => html`<option key=${c}>${c}</option>`)}
          </select>
          <input class="ins-motivo" placeholder="Motivo (vai para o dataset)" value=${motivo} onInput=${(e) => setMotivo(e.target.value)} />
          <button class="ins-btn acento" disabled=${!valido} onClick=${registrar}>Registrar</button>
        </div>
      </div>
    </li>`;
}

/** Recorta o JPEG de cada peça na ROI (px do quadro inspecionado) da ferramenta `code`. */
async function recortarNaRoi(pecas, code) {
  const out = [];
  for (const p of pecas) {
    const r = p.rec.resultados.find((x) => x.code === code);
    const roi = r && (r.overlays || []).find((o) => o.kind === 'roi');
    if (!roi || typeof createImageBitmap !== 'function') { out.push(p); continue; }
    try {
      const bm = await createImageBitmap(p.blob, Math.round(roi.x), Math.round(roi.y), Math.round(roi.w), Math.round(roi.h));
      const c = document.createElement('canvas');
      c.width = bm.width; c.height = bm.height;
      c.getContext('2d').drawImage(bm, 0, 0);
      const b = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
      out.push({ ...p, blob: b || p.blob, nome: p.nome.replace(/\.jpg$/, `_${code}.jpg`) });
    } catch (_) { out.push(p); }
  }
  return out;
}

function JanelaTreinar({ onFechar, onMsg, modo = '' }) {
  const anomModo = modo === 'anomalia';
  const prog = canal.programaAtivo();
  const fAnom = anomModo && prog ? prog.tools.find((t) => t.type === 'anomaly' && t.ativo) : null;
  const [token, setToken] = useState('');
  const [senha, setSenha] = useState('');
  const [projetos, setProjetos] = useState(null);
  const [pid, setPid] = useState('');
  const [filtro, setFiltro] = useState(anomModo ? 'ok' : 'nok');
  const [recortar, setRecortar] = useState(true);
  const [estado, setEstado] = useState('');
  useEffect(() => { garantirToken().then((t) => setToken(t || '')).catch(() => setToken('')); }, []);
  useEffect(() => {
    if (!token) return;
    listarProjetos().then((ps) => {
      const l = (ps || []).filter((p) => !anomModo || p.tipo === 'anomalia');
      setProjetos(l); if (l[0]) setPid(String(l[0].id));
    }).catch((e) => setEstado('⚠ ' + e.message));
  }, [token]);
  const proj = projetos && projetos.find((p) => String(p.id) === pid);
  const anomalia = proj && proj.tipo === 'anomalia';
  const pecas = canal.pecasParaTreino(filtro);
  const novoProjeto = async () => {
    try {
      const nome = `Inspect ${prog ? prog.codigo : ''} ${fAnom ? fAnom.code : ''}`.trim();
      const p = await apiTreino('/projetos', { method: 'POST', body: JSON.stringify({ nome, tipo: 'anomalia', classes: [] }) });
      setProjetos([p, ...(projetos || [])]); setPid(String(p.id));
      setEstado(`Projeto de anomalia «${p.nome}» criado.`);
    } catch (e) { setEstado('⚠ ' + e.message); }
  };
  const enviar = async () => {
    if (!proj || !pecas.length) return;
    setEstado('Enviando…');
    try {
      const grupo = anomalia ? (filtro === 'ok' ? 'boa' : 'ruim') : '';
      const itens = fAnom && recortar ? await recortarNaRoi(pecas, fAnom.code) : pecas;
      const r = await enviarImagens(proj.id, itens.map((p) => ({ blob: p.blob, nome: p.nome })), { grupo, aoProgredir: (n, t) => setEstado(`Enviando ${n} de ${t}…`) });
      setEstado(`✓ ${r.enviadas.length} enviada(s) para «${proj.nome}»${anomalia ? ` como ${grupo === 'boa' ? 'BOAS' : 'RUINS'}` : ''}${r.erros.length ? ` · ${r.erros.length} erro(s)` : ''}.`);
      onMsg(`${r.enviadas.length} peça(s) enviadas ao Treinar.`);
    } catch (e) { setEstado('⚠ ' + e.message); }
  };
  return html`
    <div class="ins-modal" role="dialog" aria-modal="true" aria-label=${anomModo ? 'Treinar anomalia com as BOAS' : 'Enviar ao Treinar'}>
      <div class="ins-modal-c">
        <header><b>${anomModo ? 'Treinar anomalia com as BOAS' : 'Enviar ao Treinar'}</b><button class="ins-btn" onClick=${onFechar} aria-label="Fechar">✕</button></header>
        ${anomModo ? html`<p class="ins-dica">O PatchCore aprende o NORMAL: mande as peças OK (de preferência 30 a 200, com a luz e o enquadramento
          da linha) a um projeto de anomalia; depois, no Treinar, inclua algumas RUINS para calibrar o limiar e clique em Treinar. O modelo
          publicado aparece na ferramenta de anomalia (modelo vazio = o mais recente).${fAnom ? '' : ' O programa ativo não tem ferramenta de anomalia: as peças vão inteiras.'}</p>`
        : html`<p class="ins-dica">As peças (JPEG do quadro inspecionado) viram imagens de um projeto do Treinar: NOK confirmadas para
          treinar defeito (detector) ou anomalia (como RUINS); OK como BOAS. Só as ${'60'} mais recentes ficam em memória.</p>`}
        ${!token ? html`
          <form class="ins-acoes" onSubmit=${async (e) => { e.preventDefault(); try { setToken(await entrarComSenha(senha)); setSenha(''); } catch (err) { setEstado('⚠ ' + err.message); } }}>
            <input type="password" class="ins-motivo" placeholder="Senha do Treinar" value=${senha} onInput=${(e) => setSenha(e.target.value)} autocomplete="current-password" />
            <button class="ins-btn acento" type="submit" disabled=${!senha}>Entrar</button>
          </form>` : html`
          <p class="ins-dica">${lerQuem() ? `Entrou como ${lerQuem()}.` : 'Sessão do Treinar ativa.'}</p>
          <div class="ins-campos">
            <label class="ins-campo larga"><span>Projeto</span><select value=${pid} onChange=${(e) => setPid(e.target.value)}>
              ${(projetos || []).map((p) => html`<option key=${p.id} value=${String(p.id)}>${p.nome} — ${p.tipo === 'anomalia' ? 'anomalia' : 'detector'}</option>`)}</select></label>
            <label class="ins-campo larga"><span>Peças</span><select value=${filtro} onChange=${(e) => setFiltro(e.target.value)}>
              <option value="nok">NOK (confirmadas e não revisadas)</option><option value="ok">OK (peças boas)</option><option value="fila">fila de revisão (pendentes)</option></select></label>
            ${fAnom && html`<label class="ins-campo ins-chk larga"><input type="checkbox" checked=${recortar} onChange=${(e) => setRecortar(e.target.checked)} />
              <span>Recortar na ROI de ${fAnom.code} (o modelo vê só a ROI)</span></label>`}
          </div>
          ${anomModo && projetos && !projetos.length && html`<p class="ins-dica">Nenhum projeto de anomalia ainda.</p>`}
          ${anomModo && html`<div class="ins-acoes"><button class="ins-btn" onClick=${novoProjeto}>+ Novo projeto de anomalia</button>
            <a class="ins-btn" href="/treino/" target="_blank" rel="noopener">Abrir o Treinar</a></div>`}
          <div class="ins-acoes"><button class="ins-btn acento" disabled=${!proj || !pecas.length} onClick=${enviar}>Enviar ${pecas.length} imagem(ns)</button></div>`}
        ${estado && html`<p class="ins-dica" role="status">${estado}</p>`}
      </div>
    </div>`;
}

export function StudioInspect({ onClose }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const ativo = Boolean(no && no.enabled);
  const [, setV] = useState(0);
  const [msg, setMsgBruto] = useState('');
  const [rascunho, setRascunho] = useState(null);
  const [desenhando, setDesenhando] = useState(null);
  const [foco, setFoco] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [treinar, setTreinar] = useState(false);   // false | true | 'anomalia'
  const [teste, setTeste] = useState(null);
  const [aba, setAba] = useState('medidas');
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 7000); }, []);
  const cvVivo = useRef(null), cvInsp = useRef(null);
  const fVivo = useRef(null), fInsp = useRef(null);
  const tf = useRef(null);
  const arrasto = useRef({ a: null, b: null });
  const bitmaps = useRef(new Map());
  const pintado = useRef({ vivo: -1, insp: '' });
  const rascRef = useRef(null);

  injetarCSS();
  useEffect(() => {
    canal.definirStudio(true);
    document.body.classList.add('studio-aberto', 'ins-aberto');
    return () => { canal.definirStudio(false); document.body.classList.remove('studio-aberto', 'ins-aberto', 'studio-ocioso'); };
  }, []);
  useEffect(() => canal.assinar(() => setV((n) => n + 1)), []);
  useEffect(() => { const t = setInterval(() => setV((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const prog = canal.programaAtivo();
  rascRef.current = rascunho;
  const rec = teste ? teste.rec : canal.selecionado();

  // imagem do registro mostrado: a última (ImageData), o teste, ou o JPEG guardado
  const imagemDe = (r) => {
    if (!r) return null;
    if (teste && r === teste.rec) return pintarFundo(fInsp, teste.img);
    if (r === canal.ultimo() && canal.ultimaImagem()) return pintarFundo(fInsp, canal.ultimaImagem());
    const b = bitmaps.current.get(r.id);
    if (b) return b === 'carregando' ? null : b;
    if (r.blob && typeof createImageBitmap === 'function') {
      bitmaps.current.set(r.id, 'carregando');
      createImageBitmap(r.blob).then((bm) => { bitmaps.current.set(r.id, bm); pintado.current.insp = ''; setV((n) => n + 1); }).catch(() => bitmaps.current.delete(r.id));
    }
    return null;
  };

  // canvases no rAF: o ao vivo segue o pipeline; o inspecionado só repinta quando muda
  useEffect(() => {
    let id = 0;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const vivo = canal.quadroVivo();
      const chaveVivo = `${vivo ? vivo.width : 0}|${(canal.programaAtivo() || {}).versao}|${canal.recente(800) ? Math.floor(performance.now() / 66) : 'p'}|${arrasto.current.b}|${foco}|${desenhando}|${document.documentElement.getAttribute('data-theme')}|${window.innerWidth}`;
      if (cvVivo.current && chaveVivo !== pintado.current.vivo) {
        pintado.current.vivo = chaveVivo;
        const fundo = vivo ? pintarFundo(fVivo, vivo) : null;
        tf.current = desenharVivo(cvVivo.current, fundo, vivo, canal.infoGatilho(), rascRef.current || canal.programaAtivo(), arrasto.current, foco);
      }
      const r = teste ? teste.rec : canal.selecionado();
      const chaveInsp = `${r ? r.id + (teste ? 't' : '') + ':' + (r.v || 0) : 'x'}|${foco}|${bitmaps.current.size}|${window.innerWidth}x${window.innerHeight}|${document.documentElement.getAttribute('data-theme')}`;
      if (cvInsp.current && chaveInsp !== pintado.current.insp) {
        const fundo = imagemDe(r);
        if (!r || fundo || !r.blob || bitmaps.current.get(r.id) !== 'carregando') pintado.current.insp = chaveInsp;
        desenharInspecao(cvInsp.current, fundo, r, foco);
      }
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [foco, desenhando, rascunho, teste]);

  // gancho de teste (CDP)
  useEffect(() => {
    window.aivInspect = {
      canal, abrirEditor: () => abrirEditor(), rascunho: () => rascunho, setFiltro, setAba,
      testar: (p) => fazerTeste(p || rascunho || prog), fecharTeste: () => setTeste(null), treinar: setTreinar, teste: () => teste,
    };
    return () => { if (window.aivInspect && window.aivInspect.canal === canal) delete window.aivInspect; };
  });

  // Esc: fecha o desenho, o editor/janela e depois a tela
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (desenhando) setDesenhando(null);
      else if (treinar) setTreinar(false);
      else if (rascunho) setRascunho(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [desenhando, treinar, rascunho, onClose]);

  const abrirEditor = () => {
    const p = canal.programaAtivo() || canal.criar('presenca');
    setRascunho(clonar(p));
  };
  const fazerTeste = (p) => {
    try {
      const t = canal.testar(p); setTeste(t);
      if (t.rec.pronto) {
        setMsg('Teste: lendo / rodando os modelos…');
        t.rec.pronto.then((r) => { setMsg(`Teste: ${r.veredito} em ${r.ms} ms (não registrado).`); setV((n) => n + 1); }).catch((e) => setMsg('⚠ ' + e.message));
      } else setMsg(`Teste: ${t.rec.veredito} em ${t.rec.ms} ms (não registrado).`);
    } catch (e) { setMsg('⚠ ' + e.message); }
  };

  // ---------------------------------------------------- desenho de ROI no quadro ao vivo
  const xy = (e) => {
    const T = tf.current, cv = cvVivo.current;
    if (!T || !cv) return null;
    const rc = cv.getBoundingClientRect();
    const px = (e.clientX - rc.left) * T.dpr, py = (e.clientY - rc.top) * T.dpr;
    return [Math.max(0, Math.min(T.W, (px - T.ox) / T.k)), Math.max(0, Math.min(T.H, (py - T.oy) / T.k))];
  };
  const ferrDesenho = () => (rascunho && desenhando && desenhando !== '#gatilho' ? rascunho.tools.find((t) => t.code === desenhando) : null);
  const onDown = (e) => {
    if (!desenhando) return;
    const p = xy(e); if (!p) return;
    const t = ferrDesenho();
    arrasto.current = { a: p, b: p, linha: Boolean(t && FERRAMENTAS[t.type] && FERRAMENTAS[t.type].roi === 'linha') };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => { if (arrasto.current.a) { const p = xy(e); if (p) arrasto.current = { ...arrasto.current, b: p }; } };
  const onUp = () => {
    const A = arrasto.current, T = tf.current;
    arrasto.current = { a: null, b: null };
    if (!A.a || !T) return;
    const dx = Math.abs(A.b[0] - A.a[0]), dy = Math.abs(A.b[1] - A.a[1]);
    if ((A.linha ? Math.hypot(dx, dy) : Math.min(dx, dy)) < 4) { setMsg('Arraste um pouco mais.'); return; }
    const a = A.linha ? A.a : [Math.min(A.a[0], A.b[0]), Math.min(A.a[1], A.b[1])];
    const b = A.linha ? A.b : [Math.max(A.a[0], A.b[0]), Math.max(A.a[1], A.b[1])];
    if (desenhando === '#gatilho') { marcarGatilho(rascunho, a, b, T.W, T.H); setMsg('ROI do gatilho desenhada (marcação «Gatilho»).'); canal.rearmarGatilho(); }
    else {
      const t = ferrDesenho();
      if (t) { marcarFerramenta(t, a, b, T.W, T.H); setMsg(`${t.code}: ROI desenhada (marcação «${t.code}»). ${t.type === 'presence' ? 'Agora capture o molde.' : t.type === 'color' ? 'Agora capture a cor.' : ''}`); }
    }
    setDesenhando(null);
  };

  // ---------------------------------------------------- dados
  const e = canal.estatisticas();
  const hist = canal.historico();
  const fila = canal.filaRevisao();
  const gi = canal.infoGatilho();
  const alarmes = canal.alarmes().filter((a) => !a.reconhecido);
  const vivo = canal.recente(2500);
  const ult = canal.ultimo();
  const listaHist = hist.filter((r) => filtro === 'todos' || (filtro === 'revisados' ? r.revisao : r.final === filtro)).slice(0, 120);
  const progs = canal.programas();
  const v = rec ? rec.final : null;

  return html`
    <div class="ins" role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|Inspect">
      <div class="ins-barra">
        <b class="ins-titulo"><span class="ins-marca">iaVision</span> <span class="ins-gp">GPlanSiS<i>|</i></span>Inspect</b>
        <select class="ins-btn" aria-label="Programa ativo" value=${prog ? prog.id : ''} onChange=${(ev) => { canal.ativar(ev.target.value); setTeste(null); }}>
          ${!prog && html`<option value="">— nenhum programa —</option>`}
          ${progs.map((p) => html`<option key=${p.id} value=${p.id}>${p.codigo} · v${p.versao} — ${p.nome}</option>`)}
        </select>
        <button class="ins-btn ${rascunho ? 'on' : ''}" onClick=${() => (rascunho ? setRascunho(null) : abrirEditor())}>Programa</button>
        <span class="ins-gat" title="Gatilho">${gi ? `${gi.modo} · ${gi.estado}${gi.modo !== 'manual' ? ` · ${Math.round(gi.ocupacao * 100)} %` : ''}` : 'gatilho —'}</span>
        <button class="ins-btn acento" onClick=${() => { setTeste(null); const r = canal.inspecionarAgora(); setMsg(r ? (r.pendente ? `#${r.id}: lendo / rodando os modelos…` : `#${r.id} ${r.veredito}`) : canal.status() || 'Inspecionando no próximo quadro…'); }}
          disabled=${!prog} title="Gatilho manual: congela o quadro atual e roda o programa">Inspecionar agora</button>
        <span class="ins-msg" role="status" aria-live="polite">${msg || canal.status()}</span>
        <button class="ins-btn" onClick=${() => baixar(canal.historicoCSV(), `inspect_${carimbo()}.csv`, 'text/csv')} disabled=${!hist.length}>CSV</button>
        <button class="ins-btn" onClick=${() => setTreinar(true)} title="Enviar as peças (JPEG) a um projeto do Treinar">Enviar ao Treinar</button>
        ${prog && prog.tools.some((t) => t.type === 'anomaly') && html`<button class="ins-btn" onClick=${() => setTreinar('anomalia')}
          title="Manda as peças OK (recortadas na ROI da anomalia) a um projeto de anomalia do Treinar">Treinar anomalia com as BOAS</button>`}
        <button class="ins-btn" onClick=${() => { if (confirm('Zerar o histórico, a fila de revisão e os contadores?')) canal.zerar(); }}>Zerar</button>
        <button class="ins-btn ins-fechar" onClick=${onClose} aria-label="Fechar a tela Inspect">✕</button>
      </div>

      ${(!ativo || !prog || (ativo && !vivo) || alarmes.length > 0) && html`
        <div class="ins-avisos">
          ${!ativo && html`<div class="ins-aviso">O operador Inspeção visual não está ativo no Pipeline.
            <button class="ins-btn" onClick=${() => ativarInspect()}>Ligar no Pipeline</button></div>`}
          ${!prog && html`<div class="ins-aviso">Nenhum programa: crie um (modelo de presença, dimensional, cor e defeito, ou um exemplo do Inspect).
            <button class="ins-btn" onClick=${abrirEditor}>Criar programa</button></div>`}
          ${ativo && !vivo && html`<div class="ins-aviso">Aguardando imagem: escolha a fonte (câmera, arquivo, YouTube) na barra do app.</div>`}
          ${alarmes.map((a) => html`<div key=${a.id} class="ins-aviso alarme" role="alert"><b>ALARME</b> ${a.texto} · ${hora(a.em)}
            <button class="ins-btn" onClick=${() => canal.reconhecerAlarmes()}>Reconhecer</button></div>`)}
        </div>`}

      <div class="ins-grade ${rascunho ? 'com-editor' : ''}">
        <section class="ins-p ins-vivo">
          <h2>Ao vivo <small>${desenhando ? (desenhando === '#gatilho' ? 'arraste a ROI do gatilho' : `arraste a ROI de ${desenhando}`) : gi ? `${gi.W}×${gi.H} · disparos ${gi.disparos || 0}` : ''}</small></h2>
          <canvas ref=${cvVivo} class=${'ins-cv' + (desenhando ? ' desenhando' : '')} aria-label="Quadro ao vivo com o gatilho e as ROIs das ferramentas"
            onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}></canvas>
        </section>

        <section class="ins-p ins-insp">
          <h2>${teste ? 'Teste do rascunho' : rec && rec !== ult ? `Peça #${rec.id}` : 'Última inspeção'}
            <small>${rec ? `${rec.W}×${rec.H} · ${rec.ms} ms${rec.pxPorMm ? ` · ${fmt(rec.pxPorMm, 2)} px/mm` : ''}${rec.alinhamento && rec.alinhamento.metodo !== 'nenhum' ? ` · alinh. ${rec.alinhamento.ok ? 'ok' : 'FALHOU'} (${fmt(rec.alinhamento.score, 2)})` : ''}` : ''}</small>
            ${(teste || (rec && rec !== ult)) && html`<button class="ins-btn mini" onClick=${() => { setTeste(null); canal.selecionar(null); }}>voltar à última</button>`}
          </h2>
          <canvas ref=${cvInsp} class="ins-cv" aria-label="Quadro inspecionado com o resultado de cada ferramenta"></canvas>
        </section>

        <section class=${'ins-p ins-ver ' + (v ? CLS[v] : '')} aria-live="polite">
          <div class="ins-ver-v">${rec && rec.pendente ? '…' : v || '—'}</div>
          ${canal.emAndamento() && html`<div class="ins-ver-d"><b>#${canal.emAndamento().id}: lendo / rodando os modelos…</b></div>`}
          <div class="ins-ver-d">${rec ? html`${rec.id ? `#${rec.id} · ` : ''}${dataHora(rec.t)} · ${rec.programa.codigo} v${rec.programa.versao} · ${rec.origem}
            ${rec.revisao ? html`<br />máquina: <b>${rec.veredito}</b> · revisado por ${rec.revisao.por}${rec.revisao.classe ? ` · ${rec.revisao.classe}` : ''}` : ''}
            ${!rec.revisao && rec.veredito !== 'OK' && rec.id ? html`<br /><b>aguardando revisão humana</b>` : ''}` : 'Nenhuma peça nesta sessão'}</div>
          <div class="ins-kpis">
            <div><b>${e.n}</b><em>peças</em></div>
            <div class="ok"><b>${e.fin.OK}</b><em>OK</em></div>
            <div class="nok"><b>${e.fin.NOK}</b><em>NOK</em></div>
            <div class="inc"><b>${e.fin.INCERTO}</b><em>INCERTO</em></div>
          </div>
        </section>

        <section class="ins-p ins-med">
          <h2><span class="ins-seg">
            <button class=${aba === 'medidas' ? 'on' : ''} aria-pressed=${aba === 'medidas'} onClick=${() => setAba('medidas')}>Medidas</button>
            <button class=${aba === 'estat' ? 'on' : ''} aria-pressed=${aba === 'estat'} onClick=${() => setAba('estat')}>Estatística</button>
          </span></h2>
          ${aba === 'medidas' ? html`
            <div class="ins-tab"><table><thead><tr><th>Ferramenta</th><th>Medido</th><th>Critério</th><th>Estado</th></tr></thead><tbody>
              ${rec ? rec.resultados.map((r) => { const det = detalheDe(r); const lin = { class: foco === r.code ? 'foco' : '', onMouseEnter: () => setFoco(r.code), onMouseLeave: () => setFoco(null), onClick: () => setFoco(foco === r.code ? null : r.code) };
                return [html`<tr key=${r.code} ...${lin} class=${(foco === r.code ? 'foco' : '') + (det ? ' com-det' : '')}>
                <td><b>${r.code}</b>${!r.critical ? html` <i class="ins-info">info</i>` : ''}</td>
                <td class="v">${typeof r.value === 'string' ? html`<span class="ins-lido" title=${r.value}>${r.value || '—'}</span>` : fmt(r.value)}</td>
                <td class="c">${r.expected || (r.detail && (r.detail.error || r.detail.reason)) || ''}</td>
                <td title=${`${fmt(r.ms, 1)} ms`}><span class=${'ins-st ' + (r.pendente ? 'pend' : ST[r.status])}>${r.pendente ? 'lendo…' : ROT[r.status]}</span></td></tr>`,
                det && html`<tr key=${r.code + '-d'} ...${lin} class=${'ins-det-l' + (foco === r.code ? ' foco' : '')}><td colspan="4">${det}</td></tr>`]; })
                : html`<tr><td colspan="4">Sem resultado.</td></tr>`}
            </tbody></table></div>
            ${rec && rec.resultados.some((r) => r.detail && (r.detail.error || r.detail.reason)) && html`<ul class="ins-erros">
              ${rec.resultados.filter((r) => r.detail && (r.detail.error || r.detail.reason)).map((r) => html`<li key=${r.code}><b>${r.code}</b>: ${r.detail.error || r.detail.reason}</li>`)}</ul>`}
          ` : html`
            <div class="ins-kpis">
              <div><b>${pct(e.refugo)}</b><em>refugo (NOK final)</em></div>
              <div><b>${pct(e.rendimento)}</b><em>rendimento</em></div>
              <div><b>${e.pendentes}</b><em>a revisar</em></div>
              <div><b>${fmt(e.cicloMedio, 0)}</b><em>ms ciclo médio</em></div>
            </div>
            <div class="ins-seq" aria-label="Últimas peças">${[...e.seq].reverse().map((s, i) => html`<i key=${i} class=${CLS[s]} title=${s}></i>`)}</div>
            <div class="ins-tab"><table><thead><tr><th>Medida (mm)</th><th>n</th><th>média</th><th>σ</th><th>Cpk</th></tr></thead><tbody>
              ${e.cpk.length ? e.cpk.map((c) => html`<tr key=${c.code}><td><b>${c.code}</b></td><td class="v">${c.n}</td><td class="v">${fmt(c.media, 4)}</td><td class="v">${fmt(c.sd, 4)}</td>
                <td title=${c.lsl != null ? `LIE–LSE ${fmt(c.lsl, 3)}–${fmt(c.usl, 3)} · Cp ${fmt(c.cp, 2)}` : ''} class=${'v ' + (c.cpk == null ? '' : c.cpk >= 1.33 ? 'ok' : c.cpk >= 1 ? 'inc' : 'nok')}>${fmt(c.cpk, 2)}${c.n && c.n < 30 ? html` <i class="ins-info">${'n < 30'}</i>` : ''}</td></tr>`)
                : html`<tr><td colspan="5">Sem medidas em mm no programa ativo (paquímetro ou Ø da forma).</td></tr>`}
            </tbody></table></div>
            ${canal.alarmes().length > 0 && html`<ul class="ins-erros">${canal.alarmes().slice(0, 8).map((a) => html`<li key=${a.id}>${hora(a.em)} · ${a.texto}${a.reconhecido ? ' · reconhecido' : ''}</li>`)}</ul>`}
          `}
        </section>

        <section class="ins-p ins-hist">
          <h2>Histórico <small>${hist.length}</small>
            <span class="ins-seg">${[['todos', 'Todos'], ['NOK', 'NOK'], ['INCERTO', 'INCERTO'], ['revisados', 'Revisados']].map(([k, r]) => html`
              <button key=${k} class=${filtro === k ? 'on' : ''} aria-pressed=${filtro === k} onClick=${() => setFiltro(k)}>${r}</button>`)}</span></h2>
          <ul class="ins-lista">
            ${listaHist.length ? listaHist.map((r) => html`<li key=${r.id}><button class=${'ins-item ' + CLS[r.final] + (rec === r ? ' sel' : '')} onClick=${() => { setTeste(null); canal.selecionar(r.id); }}>
              ${r.mini ? html`<img src=${r.mini} alt="" />` : html`<span class="ins-semimg">#${r.id}</span>`}
              <span><b>#${r.id}</b> ${hora(r.t)}<br /><b class=${'ins-v ' + CLS[r.final]}>${r.final}</b>${r.revisao && r.final !== r.veredito ? html` <s>${r.veredito}</s>` : ''} · ${r.ms} ms</span>
            </button></li>`) : html`<li class="ins-vazio">Nenhuma peça${filtro !== 'todos' ? ' neste filtro' : ''}.</li>`}
          </ul>
        </section>

        <section class="ins-p ins-fila">
          <h2>Revisão humana <small>${fila.length} aguardando · a máquina propõe, o humano confirma</small></h2>
          <ul class="ins-revs">
            ${fila.length ? fila.slice(0, 12).map((r) => html`<${CartaoRevisao} key=${r.id} r=${r} onMsg=${setMsg} onVer=${(id) => { setTeste(null); canal.selecionar(id); }} />`)
              : html`<li class="ins-vazio">Fila vazia. Peças INCERTAS e NOK aparecem aqui para confirmação.</li>`}
          </ul>
        </section>
      </div>

      ${rascunho && html`<${InspectEditor} rascunho=${rascunho} mudou=${() => setV((n) => n + 1)} onMsg=${setMsg}
        onFechar=${(p) => { setRascunho(null); setDesenhando(null); if (p) setTeste(null); }} pedirDesenho=${setDesenhando} desenhando=${desenhando}
        foco=${foco} setFoco=${setFoco} onTestar=${fazerTeste} />`}
      ${treinar && html`<${JanelaTreinar} onFechar=${() => setTreinar(false)} onMsg=${setMsg} modo=${treinar === 'anomalia' ? 'anomalia' : ''} />`}
    </div>
  `;
}

export default StudioInspect;
