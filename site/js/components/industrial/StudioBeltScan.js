/**
 * components/industrial/StudioBeltScan.js — a tela cheia "GPlanSiS|BeltScan":
 * a volumetria de correia (CV-36) no formato do GPlanSiS|BELTSCAN, no tema do
 * iaVision (claro e escuro; os gráficos ficam no palco escuro, como o vídeo).
 *
 *   Câmera      o quadro analisado (resolução plena, desespelhado) com a faixa
 *               de busca, a referência vazia, a linha laser detectada (vermelha
 *               acima do limite) e a altura limite projetada. ARRASTAR define a
 *               faixa de busca; Shift + arrastar (ou o seletor) cria uma zona de
 *               exclusão — a interação mora aqui, no canvas próprio.
 *   Seção       a calha (rolos, acamamento DIN 22101, contorno teórico), o
 *               produto, a altura limite com H/HH, o excesso em vermelho e a
 *               barra LI-101.
 *   Perfil      altura na bancada (mm) com o limite equivalente tracejado.
 *   Tendência   nível representativo/máximo, limite, H, HH, vazão da bancada e
 *               a faixa de alarmes no topo. Clique = ir ao instante (arquivo).
 *   Indicadores bancada (mm², mm/s, cm³/s, cm³, g) e correia (m², %, m³/h,
 *               t/h seca, m/s, nível, qualidade…).
 *   Alarmes     ativos (reconhecer, suprimir 10 min) e histórico (CSV).
 *   Configurar  as abas do BeltScan (BeltScanConfig.js).
 *
 * A fonte é a do app (câmera, arquivo, YouTube, tela, stream) e a barra de
 * vídeo do app continua sendo o controle de reprodução (fica por cima desta
 * tela, como no Studio Bike Fit). Os ensaios gravados entram como ARQUIVO.
 *
 * Gancho de teste: window.aivBeltScan (motor, retrato, abrirEnsaio…).
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { ENSAIOS } from '../../cv/runtime/livres-k/beltscan.js';
import {
  obterMotor, instantaneo, ultimoQuadro, assinar, avisarAgora, definirStudio, recente, salvarSeMudou,
  listaPerfis, perfilAtivo, trocarPerfil, videoDaFonte, tempoDaFonte,
} from '../../cv/runtime/livres-k/canal.js';
import {
  OP, fmt, COR_Q, corPrio, ativarBeltScan, abrirEnsaioNoApp, baixar, carimbo, indicadores, tomarPedidoConfigurar,
  desenharCamera, desenharPerfil, desenharCorreia, desenharTendencia, desenharTriangulacao,
} from './beltscan-comum.js';
import { BeltScanConfig } from './BeltScanConfig.js';

const ROT_ESTADO = { ATIVO_NR: 'ativo, não reconhecido', ATIVO_R: 'ativo, reconhecido', RTN_NR: 'voltou ao normal' };

export function StudioBeltScan({ onClose, onPickFile, onResetState }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const ativo = Boolean(no && no.enabled);
  const motor = obterMotor();

  const [r, setR] = useState(() => instantaneo());
  // aberta pelo "Configurar" do widget Seção da correia: já entra na aba pedida
  const [cfg, setCfg] = useState(() => tomarPedidoConfigurar() || false);
  const [abaAlarmes, setAbaAlarmes] = useState('ativos');
  const [msg, setMsgBruto] = useState('');
  const [modoArrasto, setModoArrasto] = useState('roi');
  const [gravando, setGravando] = useState(Boolean(motor.csv));
  const [carregando, setCarregando] = useState('');
  const [, setV] = useState(0);
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 7000); }, []);

  const cvCam = useRef(null), cvSec = useRef(null), cvPerf = useRef(null), cvTend = useRef(null), cvTri = useRef(null);
  const fundo = useRef(null);
  const tf = useRef(null);
  const arrasto = useRef({ a: null, b: null, modo: 'roi' });
  const ultimoDesenho = useRef({ q: -1, chave: '' });

  // o overlay do operador sai do vídeo do app; a barra de vídeo fica por cima desta tela
  useEffect(() => {
    definirStudio(true);
    document.body.classList.add('studio-aberto', 'bsc-aberto');
    return () => { definirStudio(false); document.body.classList.remove('studio-aberto', 'bsc-aberto', 'studio-ocioso'); };
  }, []);

  // React 4×/s (indicadores, alarmes); os canvases andam no rAF
  useEffect(() => assinar((x) => setR(x)), []);
  useEffect(() => { const t = setInterval(() => setV((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let id = 0;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const rr = instantaneo();
      const chave = `${rr ? rr.t : ''}|${motor.alteracoes}|${cfg}|${window.innerWidth}x${window.innerHeight}|${document.documentElement.getAttribute('data-theme')}`;
      const q = motor.quadros;
      if (q === ultimoDesenho.current.q && chave === ultimoDesenho.current.chave && !arrasto.current.a) return;
      ultimoDesenho.current = { q, chave };
      const img = ultimoQuadro();
      if (img) {
        if (!fundo.current) fundo.current = document.createElement('canvas');
        const f = fundo.current;
        if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
        f.getContext('2d').putImageData(img, 0, 0);
      }
      if (cvCam.current) tf.current = desenharCamera(cvCam.current, img ? fundo.current : null, rr, motor, arrasto.current);
      if (cvSec.current) desenharCorreia(cvSec.current, rr, motor);
      if (cvPerf.current) desenharPerfil(cvPerf.current, rr, motor);
      if (cvTri.current) desenharTriangulacao(cvTri.current, rr, motor);
      if (cvTend.current) {
        const fv = tempoDaFonte();
        const tUlt = rr ? rr.t : 0;
        const span = fv.video && fv.duracao ? [0, fv.duracao] : [tUlt - (motor.C.ui.trend_window_s || 60), tUlt];
        desenharTendencia(cvTend.current, motor, span, tUlt);
      }
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [cfg]);

  // gancho de teste (CDP)
  useEffect(() => {
    window.aivBeltScan = {
      motor, retrato: () => instantaneo(), abrirEnsaio: (id) => abrirEnsaioNoApp(id, onPickFile),
      configurar: (v, aba) => { setCfg(v ? aba || 'Extração' : false); }, abaAlarmes: setAbaAlarmes,
    };
    return () => { if (window.aivBeltScan && window.aivBeltScan.motor === motor) delete window.aivBeltScan; };
  }, [onPickFile]);

  // Esc fecha a configuração e depois a tela
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      // só Esc: as letras são das ferramentas de mouse do app (R, A…)
      if (e.key === 'Escape') { e.stopPropagation(); if (cfg) setCfg(false); else onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cfg, onClose]);

  // ---------------------------------------------------- arraste na imagem
  const xy = (e) => {
    const T = tf.current, cv = cvCam.current;
    if (!T || !cv) return null;
    const rc = cv.getBoundingClientRect(), dpr = T.dpr;
    const px = (e.clientX - rc.left) * dpr, py = (e.clientY - rc.top) * dpr;
    return [Math.round(Math.max(0, Math.min(T.W, (px - T.ox) / T.k))), Math.round(Math.max(0, Math.min(T.H, (py - T.oy) / T.k)))];
  };
  const onDown = (e) => {
    const p = xy(e); if (!p) return;
    arrasto.current = { a: p, b: p, modo: e.shiftKey || modoArrasto === 'excl' ? 'excl' : 'roi' };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => { if (arrasto.current.a) { const p = xy(e); if (p) arrasto.current.b = p; } };
  const onUp = () => {
    const A = arrasto.current;
    if (!A.a) return;
    const [xa, ya] = A.a, [xb, yb] = A.b;
    if (A.modo === 'excl') { if (Math.abs(xb - xa) > 4) { motor.adicionarExclusao(xa, xb); setMsg(motor.status); } }
    else if (Math.abs(xb - xa) > 20 && Math.abs(yb - ya) > 10) {
      motor.definirROI([Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb)]);
      setMsg(motor.status);
    }
    arrasto.current = { a: null, b: null, modo: A.modo };
    salvarSeMudou(); avisarAgora();
  };

  // ---------------------------------------------------- ações
  const acao = (fn) => () => { const x = fn(); salvarSeMudou(); avisarAgora(); setV((n) => n + 1); if (typeof x === 'string') setMsg(x); else if (motor.status) setMsg(motor.status); };
  const abrirEnsaio = async (id) => {
    setCarregando(id);
    try { await abrirEnsaioNoApp(id, onPickFile); setMsg(motor.status); } catch (e) { setMsg('Não consegui abrir o ensaio: ' + e.message); }
    setCarregando('');
  };
  const csv = () => {
    if (!motor.csv) { motor.iniciarCSV(); setGravando(true); setMsg('Gravando as tags a cada quadro. Clique de novo para baixar o CSV.'); }
    else { baixar(motor.pararCSV(), `beltscan_tags_${carimbo()}.csv`, 'text/csv'); setGravando(false); }
  };
  const salvarImagem = () => { const cv = cvCam.current; if (cv) cv.toBlob((b) => b && baixar(b, `beltscan_${carimbo()}.png`, 'image/png'), 'image/png'); };
  const irPara = (e) => {
    const v = videoDaFonte(); if (!v || !v.duration) return;
    const rc = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(v.duration - 0.01, ((e.clientX - rc.left) / rc.width) * v.duration));
  };

  const ind = indicadores(r, motor);
  const q = r ? r.q : 'SEM REF';
  const vivo = recente(3000);
  const C = motor.C;
  const agora = Date.now();
  const ativos = C.alarms.filter((a) => motor.alarm[a.tag] && motor.alarm[a.tag].state !== 'NORMAL').sort((a, b) => a.prio - b.prio);
  const perfis = listaPerfis();

  return html`
    <div class="bsc" role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|BeltScan">
      <div class="bsc-barra">
        <b class="bsc-titulo"><span class="bsc-marca">iaVision</span> <span class="bsc-gp">GPlanSiS<i>|</i></span>BeltScan</b>
        <select class="bsc-btn" aria-label="Perfil" value=${perfilAtivo()} onChange=${async (e) => { await trocarPerfil(e.target.value); setMsg('Perfil: ' + e.target.selectedOptions[0].text); setV((n) => n + 1); }}>
          ${perfis.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
        </select>
        <span class="bsc-ensaios" role="group" aria-label="Abrir ensaio gravado">
          ${Object.entries(ENSAIOS).map(([id, e]) => html`<button key=${id} class="bsc-btn ${perfilAtivo() === id ? 'on' : ''}" disabled=${Boolean(carregando)}
            title=${'Abrir o ensaio como arquivo: ' + e.rotulo} onClick=${() => abrirEnsaio(id)}>${carregando === id ? '…' : id === 'bancada' ? 'Bancada' : 'Feijão ' + id.slice(-1)}</button>`)}
        </span>
        <span class="bsc-q" style=${{ '--q': COR_Q[q] || '#888' }}>${q}</span>
        <span class="bsc-msg" role="status" aria-live="polite">${msg || (r && r.status) || ''}</span>
        <button class="bsc-btn ${cfg ? 'on' : ''}" onClick=${() => setCfg(cfg ? false : 'Extração')}>Configurar</button>
        <button class="bsc-btn bsc-fechar" onClick=${onClose} aria-label="Fechar a tela BeltScan">✕</button>
      </div>

      ${(!ativo || (C.mapping.height_gain !== 1) || (!vivo && ativo)) && html`
        <div class="bsc-avisos">
          ${!ativo && html`<div class="bsc-aviso">O operador BeltScan não está ativo no Pipeline.
            <button class="bsc-btn" onClick=${() => { ativarBeltScan(); onResetState && onResetState(); }}>Ligar no Pipeline</button></div>`}
          ${ativo && !vivo && html`<div class="bsc-aviso">Aguardando imagem: abra um ensaio acima ou escolha a fonte (câmera, arquivo, YouTube) na barra do app.</div>`}
          ${C.mapping.height_gain !== 1 && html`<div class="bsc-aviso amb">Ganho de altura ${fmt(C.mapping.height_gain, 1)}× ativo: os níveis da correia são demonstração, não medição (Configurar › Correia).</div>`}
        </div>`}

      <div class="bsc-grade">
        <section class="bsc-p bsc-cam">
          <h2>Câmera <small>${r ? `${r.W}×${r.H} · cobertura ${fmt(r.cov * 100, 0)} %${r.espelhado ? ' · espelhada (desfeito)' : ''}` : ''}</small></h2>
          <canvas ref=${cvCam} class="bsc-cv-cam" aria-label="Imagem da câmera com a linha laser detectada e a altura limite projetada"
            onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}></canvas>
          <div class="bsc-acoes">
            <button class="bsc-btn acento" onClick=${acao(() => motor.capturarReferencia())}>Capturar referência vazia</button>
            <button class="bsc-btn" onClick=${acao(() => { if (!motor.calibrar()) return motor.status; return `Calibrando com bloco de ${fmt(C.cal.height_mm, 1)} mm…`; })}>Calibrar com bloco</button>
            <button class="bsc-btn" onClick=${acao(() => { motor.limiarAutomatico(); })}>Limiar automático</button>
            <button class="bsc-btn" onClick=${acao(() => { const a = motor.estimarAlfa(); return a == null ? motor.status : `α = ${fmt(a, 2)}° a partir de b = ${fmt(C.geo.b_mm, 0)} mm, H_c = ${fmt(C.geo.Hc_mm, 0)} mm e da referência no centro da faixa.`; })}>Estimar α</button>
            <button class="bsc-btn" onClick=${acao(() => motor.aplicarGiro())}>Aplicar giro</button>
            <button class="bsc-btn" onClick=${acao(() => motor.inverterV())}>Inverter v</button>
            <button class="bsc-btn" onClick=${acao(() => motor.limparCalibracao())}>Limpar calibração</button>
            <button class="bsc-btn" onClick=${acao(() => motor.zerarTotais())}>Zerar totais</button>
            <select class="bsc-btn" aria-label="O que o arraste define" value=${modoArrasto} onChange=${(e) => setModoArrasto(e.target.value)}>
              <option value="roi">Arrastar: faixa de busca</option><option value="excl">Arrastar: exclusão</option>
            </select>
            <button class="bsc-btn" onClick=${acao(() => motor.limparExclusoes())}>Limpar exclusões</button>
            <button class="bsc-btn ${gravando ? 'rec' : ''}" onClick=${csv}>${gravando ? 'Parar e baixar CSV' : 'Gravar CSV'}</button>
            <button class="bsc-btn" onClick=${salvarImagem}>Salvar imagem</button>
          </div>
          <p class="bsc-dica">Arraste sobre a imagem para a faixa de busca; Shift + arrastar cria uma zona de exclusão. Esc fecha a configuração e a tela.</p>
        </section>

        <section class="bsc-p bsc-ind">
          <h2>Indicadores <small>${r ? `t ${fmt(r.t, 2)} s` : ''}</small></h2>
          <div class="bsc-kpis">
            <div class="bsc-kpi"><b>${ind ? ind.bancada[0][2] : '—'}</b><em>mm² seção bancada</em></div>
            <div class="bsc-kpi"><b>${ind ? ind.bancada[2][2] : '—'}</b><em>cm³/s vazão bancada</em></div>
            <div class="bsc-kpi"><b>${ind ? ind.bancada[3][2] : '—'}</b><em>cm³ no ciclo</em></div>
            <div class="bsc-kpi"><b>${r ? fmt(r.A * 1e6, 0) : '—'}</b><em>mm² seção correia</em></div>
            <div class="bsc-kpi"><b>${r ? fmt(r.Q, 1) : '—'}</b><em>m³/h vazão</em></div>
            <div class="bsc-kpi"><b>${r ? fmt(r.mdry, 2) : '—'}</b><em>t/h massa seca</em></div>
            <div class="bsc-kpi"><b>${fmt(C.belt.speed_ms, 2)}</b><em>m/s velocidade</em></div>
            <div class="bsc-kpi"><b>${r ? fmt(r.lvlRep, 0) : '—'}</b><em>mm nível rep.</em></div>
            <div class="bsc-kpi"><b style=${{ color: COR_Q[q] }}>${q}</b><em>qualidade · ${r ? fmt(r.cov * 100, 0) : '—'} %</em></div>
          </div>
          ${ind && html`<details class="bsc-tags">
            <summary>Tags (bancada e correia)</summary>
            <table><tbody>
              ${[...ind.bancada, ...ind.correia].map((t, i) => html`<tr key=${i}><td>${t[0]}</td><td>${t[1]}</td><td class="v">${t[2]}</td><td class="u">${t[3]}</td></tr>`)}
            </tbody></table></details>`}
        </section>

        <section class="bsc-p bsc-sec">
          <h2>Seção da correia <small>B ${C.belt.B_mm} · ${C.belt.trough_deg}° · rampa ${C.belt.incline_deg}°</small></h2>
          <div class="bsc-portao ${r && r.gate ? 'acima' : ''}">${r && r.gate
            ? `Acima da altura limite: nível ${fmt(r.lvlRep, 0)} mm, excesso ${fmt(r.exRep, 0)} mm em ${fmt(r.exWidth, 1)} % da largura. Alarmes liberados.`
            : `Abaixo da altura limite (${fmt(C.limit.h_mm, 0)} mm). Nível representativo ${fmt(r ? r.lvlRep : NaN, 0)} mm. Alarmes de processo retidos.`}</div>
          <canvas ref=${cvSec} class="bsc-cv-sec" aria-label="Seção da calha com o produto, a altura limite e o excesso"></canvas>
        </section>

        <section class="bsc-p bsc-perf">
          <h2>Perfil da seção <small>altura na bancada, mm · tracejado = limite equivalente</small></h2>
          <canvas ref=${cvPerf} class="bsc-cv-perf" aria-label="Perfil de altura medido"></canvas>
        </section>

        <section class="bsc-p bsc-tend">
          <h2>Tendência <small>clique para ir ao instante (arquivo)</small></h2>
          <canvas ref=${cvTend} class="bsc-cv-tend" onClick=${irPara} aria-label="Tendência do nível, da altura limite e dos alarmes"></canvas>
        </section>

        <section class="bsc-p bsc-al">
          <h2>Alarmes ISA-18.2
            <span class="bsc-seg">
              <button class=${abaAlarmes === 'ativos' ? 'on' : ''} aria-pressed=${abaAlarmes === 'ativos'} onClick=${() => setAbaAlarmes('ativos')}>Ativos${ativos.length ? ` (${ativos.length})` : ''}</button>
              <button class=${abaAlarmes === 'hist' ? 'on' : ''} aria-pressed=${abaAlarmes === 'hist'} onClick=${() => setAbaAlarmes('hist')}>Histórico</button>
            </span>
            <button class="bsc-btn" onClick=${acao(() => { motor.reconhecer(); return 'Alarmes reconhecidos.'; })}>Reconhecer</button>
          </h2>
          ${abaAlarmes === 'ativos' ? html`
            <ul class="bsc-alarmes">
              ${ativos.length ? ativos.map((a) => {
                const st = motor.alarm[a.tag], sh = (motor.shelf[a.tag] || 0) > agora;
                return html`<li key=${a.tag} class=${`p${a.prio} ${st.state === 'ATIVO_NR' && !sh ? 'nr' : ''} ${st.state === 'RTN_NR' ? 'rtn' : ''} ${sh ? 'sup' : ''}`}>
                  <b style=${{ color: corPrio(a.prio) }}>P${a.prio}</b><b>${a.tag}</b>
                  <span>${a.text}: ${fmt(st.val, 1)} (limite ${a.thr}) · ${sh ? `suprimido por mais ${Math.ceil(((motor.shelf[a.tag] || 0) - agora) / 60000)} min` : ROT_ESTADO[st.state]}</span>
                  <span class="bsc-act">${a.act}</span>
                  <button class="bsc-btn" onClick=${acao(() => { motor.suprimir(a.tag); })}>${sh ? 'Retirar supressão' : 'Suprimir 10 min'}</button>
                </li>`;
              }) : html`<li class="vazio">${r && r.gate ? 'Acima da altura limite, sem limite de alarme excedido.' : 'Nenhum alarme ativo. Os alarmes de processo só entram com o produto acima da altura limite.'}</li>`}
            </ul>` : html`
            <div class="bsc-acoes">
              <button class="bsc-btn" onClick=${() => baixar(motor.csvHistorico(), `beltscan_alarmes_${carimbo()}.csv`, 'text/csv')}>Baixar histórico CSV</button>
              <button class="bsc-btn" onClick=${acao(() => { motor.journal.length = 0; return 'Histórico limpo.'; })}>Limpar</button>
            </div>
            <div class="bsc-jt"><table><thead><tr><th>Hora</th><th>t vídeo</th><th>P</th><th>Tag</th><th>Evento</th><th>Valor</th></tr></thead><tbody>
              ${motor.journal.length ? motor.journal.slice(0, 150).map((e, i) => html`<tr key=${i}><td>${e.wall}</td><td>${fmt(e.vt, 2)} s</td><td>P${e.prio}</td><td><b>${e.tag}</b></td><td>${e.ev}</td><td>${fmt(e.v, 1)}</td></tr>`)
                : html`<tr><td colspan="6">Nenhum evento registrado.</td></tr>`}
            </tbody></table></div>`}
        </section>

        <section class="bsc-p bsc-tri">
          <h2>Triangulação <small>vista lateral · α ${fmt(C.geo.alpha_deg, 2)}° · b ${fmt(C.geo.b_mm, 0)} · H_c ${fmt(C.geo.Hc_mm, 0)}</small></h2>
          <canvas ref=${cvTri} class="bsc-cv-tri" aria-label="Geometria câmera e laser"></canvas>
        </section>
      </div>

      ${cfg && html`<${BeltScanConfig} aba=${cfg} onFechar=${() => setCfg(false)} onMsg=${setMsg} />`}
    </div>
  `;
}

export default StudioBeltScan;
