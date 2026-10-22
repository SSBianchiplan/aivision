/**
 * components/industrial/StudioTakt.js — a tela cheia "GPlanSiS|Takt": o tempo
 * de posto (CV-39) no formato das telas do Takt (Cockpit, Régua do turno,
 * Relatórios), no tema do iaVision (claro e escuro; o vídeo fica no palco
 * escuro, Gantt e planta seguem o tema).
 *
 *   Vídeo      o último quadro medido (rostos já borrados), postos na cor do
 *              estado com o tempo no estado, pessoas com esqueleto, ID e
 *              atividade. Em "Calibrar piso", o clique marca os pontos do
 *              chão (x, y em metros na lista) e a grade de 1 m aparece
 *              projetada pela homografia.
 *   KPIs       do turno vigente (agenda) ou da sessão: % produtivo, ocioso,
 *              vago, ocupação, cobertura (publicável ≥ 85 %), tempos.
 *   Postos     estado atual e ranking por produtividade, com a barra de estados.
 *   Gantt      a régua do turno: uma faixa por posto, cor + padrão por estado.
 *   Planta     vista de cima em metros (homografia): postos, raio de presença,
 *              pessoas com rastro e deslocamento, calor de ocupação.
 *   Alarmes    posto vago por mais de N min, ocioso acima de X %, cobertura
 *              baixa; reconhecer; histórico de eventos.
 *   Configurar tempos (produção/bancada/personalizado), raio, turnos e pausas,
 *              alarmes, privacidade, início do vídeo, importar/exportar.
 *   Exportar   intervalos, KPIs e eventos em CSV; relatório HTML; PNG.
 *
 * A fonte é a do app e a barra de vídeo do app continua por cima desta tela
 * (como no Studio BeltScan). Gancho de teste: window.aivTakt.
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { marcStore, vistaParaFonte, vista } from '../../cv/marcacoes.js';
import {
  obterMotor, instantaneo, ultimoQuadro, assinar, avisarAgora, definirStudio, recente, novaSessao,
  TEMPOS, TURNOS_EXEMPLO, normalizar, ERRO_MAX_CALIBRACAO_M,
} from '../../cv/runtime/livres-m/canal.js';
import {
  OP, carregarCss, fmt, pct, hm, relogio, horaSeg, hora, carimbo, baixar, ativarTakt, novoPosto, postosMarcados,
  desenharVideo, desenharGantt, desenharPlanta, relatorioHTML, COR_ESTADO, ROTULO, ESTADOS,
} from './takt-comum.js';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function StudioTakt({ onClose }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const temPose = nodes.some((n) => n.op === 'pose.rtmo' && n.enabled);
  const ativo = Boolean(no && no.enabled);
  const nPostos = useStore(marcStore, (st) => postosMarcados(st).length);
  const motor = obterMotor();

  const [r, setR] = useState(() => instantaneo());
  const [cfg, setCfg] = useState(false);
  const [calibrando, setCalibrando] = useState(false);
  const [sel, setSel] = useState(-1);
  const [abaAl, setAbaAl] = useState('ativos');
  const [calor, setCalor] = useState(false);
  const [exp, setExp] = useState(false);
  const [dica, setDica] = useState('');
  const [msg, setMsgBruto] = useState('');
  const [, setV] = useState(0);
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 7000); }, []);

  const raiz = useRef(null);
  const cvVid = useRef(null), cvGantt = useRef(null), cvPlanta = useRef(null);
  const fundo = useRef(null);
  const tf = useRef(null);
  const faixas = useRef([]);
  const ultimo = useRef('');

  useEffect(() => {
    carregarCss();
    definirStudio(true);
    document.body.classList.add('studio-aberto', 'tkt-aberto');
    return () => { definirStudio(false); document.body.classList.remove('studio-aberto', 'tkt-aberto', 'studio-ocioso'); };
  }, []);

  useEffect(() => assinar((x) => setR(x)), []);
  useEffect(() => { const t = setInterval(() => setV((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // redesenho sob demanda: só quando o retrato, a sessão, o modo, o tamanho ou o tema mudam
  useEffect(() => {
    let id = 0;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const rr = instantaneo();
      const chave = `${rr ? rr.t : ''}|${rr && rr.postos ? rr.postos.map((p) => p.estado).join(',') : ''}|${motor.alteracoes}|${calibrando}|${sel}|${calor}|`
        + `${window.innerWidth}x${window.innerHeight}|${document.documentElement.getAttribute('data-theme')}|${cfg}|${JSON.stringify(motor.cfg.piso.pts)}`;
      if (chave === ultimo.current) return;
      ultimo.current = chave;
      const img = ultimoQuadro();
      if (img) {
        if (!fundo.current) fundo.current = document.createElement('canvas');
        const f = fundo.current;
        if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
        f.getContext('2d').putImageData(img, 0, 0);
      }
      if (cvVid.current) tf.current = desenharVideo(cvVid.current, img ? fundo.current : null, rr, motor, { calibrando, selPonto: sel });
      const kp = motor.kpis();
      if (cvGantt.current) faixas.current = desenharGantt(cvGantt.current, motor, kp, raiz.current);
      if (cvPlanta.current) desenharPlanta(cvPlanta.current, motor, rr, raiz.current, { calor });
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [calibrando, sel, calor, cfg]);

  // gancho de teste (CDP)
  useEffect(() => {
    window.aivTakt = {
      motor, retrato: () => instantaneo(), novoPosto, configurar: (v) => setCfg(Boolean(v)), calibrar: setCalibrando,
      relatorio: () => relatorioHTML(motor), exportarAlarmes: setAbaAl,
    };
    return () => { if (window.aivTakt && window.aivTakt.motor === motor) delete window.aivTakt; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (exp) setExp(false); else if (cfg) setCfg(false); else if (calibrando) setCalibrando(false); else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cfg, calibrando, exp, onClose]);

  // ---------------------------------------------------------- calibração do piso (clique no vídeo)
  const pts = motor.cfg.piso.pts;
  const mudarPiso = (novos) => {
    const W = vista.W || motor.cfg.piso.W || 1, H = vista.H || motor.cfg.piso.H || 1;
    motor.definir({ piso: { pts: novos, W, H } });
    avisarAgora(); setV((n) => n + 1);
  };
  const cliqueVideo = (e) => {
    const T = tf.current, cv = cvVid.current;
    if (!calibrando || !T || !cv || !r) return;
    const rc = cv.getBoundingClientRect();
    const px = (e.clientX - rc.left) * T.dpr, py = (e.clientY - rc.top) * T.dpr;
    const xn = (px - T.ox) / (T.w * T.k), yn = (py - T.oy) / (T.h * T.k);
    if (xn < 0 || xn > 1 || yn < 0 || yn > 1) return;
    // perto de um ponto existente: seleciona
    let melhor = -1, dmin = 14 * T.dpr;
    const f = vistaParaFonte(xn, yn);
    pts.forEach((p, i) => {
      const d = Math.hypot((f[0] - p.u) * T.w * T.k, (f[1] - p.v) * T.h * T.k);
      if (d < dmin) { dmin = d; melhor = i; }
    });
    if (melhor >= 0) { setSel(melhor); return; }
    mudarPiso([...pts, { u: f[0], v: f[1], x: null, y: null }]);
    setSel(pts.length);
    setMsg(`Ponto P${pts.length + 1} marcado: informe x e y em metros na lista.`);
  };
  const editarPonto = (i, campo, valor) => {
    const v = valor === '' ? null : Number(String(valor).replace(',', '.'));
    mudarPiso(pts.map((p, j) => (j === i ? { ...p, [campo]: Number.isFinite(v) ? v : null } : p)));
  };

  // ---------------------------------------------------------- exportar
  const imgDe = (c) => { try { return c ? c.toDataURL('image/png') : null; } catch (_) { return null; } };
  const exportar = (tipo) => {
    setExp(false);
    const nome = `takt_${carimbo()}`;
    if (tipo === 'intervalos') baixar(motor.intervalosCSV(), `${nome}_intervalos.csv`, 'text/csv');
    else if (tipo === 'kpi') baixar(motor.kpiCSV(), `${nome}_kpi.csv`, 'text/csv');
    else if (tipo === 'eventos') baixar(motor.eventosCSV(), `${nome}_eventos.csv`, 'text/csv');
    else if (tipo === 'relatorio') baixar(relatorioHTML(motor, { gantt: imgDe(cvGantt.current), planta: motor.piso.H ? imgDe(cvPlanta.current) : null }), `${nome}_relatorio.html`, 'text/html');
    else if (tipo === 'png' && cvVid.current) cvVid.current.toBlob((b) => b && baixar(b, `${nome}.png`, 'image/png'), 'image/png');
    else if (tipo === 'config') baixar(motor.exportarConfig(), 'takt-config.json', 'application/json');
    setMsg('Arquivo gerado no aparelho (nada é enviado).');
  };

  const dicaGantt = (e) => {
    const rc = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    const f = faixas.current.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
    setDica(f ? `${f.nome} · ${ROTULO[f.iv.estado]} · ${horaSeg(f.iv.inicio)}–${f.iv.fim != null ? horaSeg(f.iv.fim) : 'agora'} · ${hm(((f.iv.fim != null ? f.iv.fim : motor.ultTs) - f.iv.inicio) / 1000)} · confiança ${pct(f.iv.confianca, 0)}` : '');
  };

  // ---------------------------------------------------------- dados da tela
  const kp = motor.kpis();
  const G = kp ? kp.geral : null;
  const vivo = recente(3000);
  const ativos = motor.alarmesAtivos();
  const hist = motor.eventos.filter((e) => /ALARME|normalizou/.test(e.evento)).slice(-150).reverse();
  const janelaTxt = kp ? `${kp.janela.nome} · ${hora(kp.janela.de)}–${kp.janela.turno ? hora(kp.janela.ate) : 'agora'}` : 'sem medição';
  const piso = motor.piso;
  const estadoAtual = new Map((r && r.postos ? r.postos : []).map((p) => [p.id, p]));

  return html`
    <div class="tkt" ref=${raiz} role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|Takt">
      <div class="tkt-barra">
        <b class="tkt-titulo"><span class="tkt-marca">iaVision</span> <span class="tkt-gp">GPlanSiS<i>|</i></span>Takt</b>
        <span class="tkt-chip" title="Janela dos KPIs">${janelaTxt}</span>
        <span class=${`tkt-chip ${piso.calibrado ? 'ok' : piso.H ? 'amb' : ''}`} title=${piso.msg}>${piso.calibrado ? `piso ±${fmt(piso.erro, 2)} m` : piso.H ? 'piso: erro alto' : 'piso sem calibração'}</span>
        <span class=${`tkt-chip ${r && r.borrado ? 'ok' : 'erro'}`}>${r && r.borrado ? 'rostos borrados' : 'borrão desligado'}</span>
        <span class="tkt-msg" role="status" aria-live="polite">${msg}</span>
        <button class=${`tkt-btn ${calibrando ? 'on' : ''}`} aria-pressed=${calibrando} onClick=${() => { setCalibrando(!calibrando); setSel(-1); }}>Calibrar piso</button>
        <button class=${`tkt-btn ${cfg ? 'on' : ''}`} onClick=${() => setCfg(!cfg)}>Configurar</button>
        <span class="tkt-menu-w">
          <button class=${`tkt-btn ${exp ? 'on' : ''}`} aria-haspopup="menu" aria-expanded=${exp} onClick=${() => setExp(!exp)}>Exportar ▾</button>
          ${exp && html`<div class="tkt-menu" role="menu">
            <button role="menuitem" onClick=${() => exportar('intervalos')}>Intervalos de estado (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('kpi')}>KPIs por posto (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('eventos')}>Eventos e alarmes (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('relatorio')}>Relatório do turno (HTML)</button>
            <button role="menuitem" onClick=${() => exportar('png')}>Imagem do vídeo (PNG)</button>
            <button role="menuitem" onClick=${() => exportar('config')}>Configuração (JSON)</button>
          </div>`}
        </span>
        <button class="tkt-btn" onClick=${() => { if (confirm('Começar uma sessão nova? Os intervalos, eventos e alarmes desta sessão serão apagados (exporte antes, se precisar).')) { novaSessao(); setMsg('Sessão nova.'); } }}>Nova sessão</button>
        <button class="tkt-btn tkt-fechar" onClick=${onClose} aria-label="Fechar a tela Takt">✕</button>
      </div>

      ${(!ativo || !temPose || !nPostos || (ativo && !vivo) || (r && !r.borrado) || (r && r.foraDeTurno) || (r && r.fonteParada)) && html`
        <div class="tkt-avisos">
          ${!ativo && html`<div class="tkt-aviso">O operador Takt não está ativo no Pipeline.
            <button class="tkt-btn" onClick=${() => { ativarTakt(); setMsg('Pose RTMO + Takt ligados no Pipeline.'); }}>Ligar no Pipeline</button></div>`}
          ${ativo && !temPose && html`<div class="tkt-aviso amb">Sem a Pose multi-pessoa (RTMO) antes na cadeia, o Takt roda a própria pose.
            <button class="tkt-btn" onClick=${() => { ativarTakt(); }}>Pôr a Pose RTMO antes</button></div>`}
          ${ativo && !nPostos && html`<div class="tkt-aviso">Nenhum posto marcado: crie um e ajuste as alças sobre a bancada e o lugar do operador.
            <button class="tkt-btn acento" onClick=${() => setMsg(novoPosto())}>Novo posto</button></div>`}
          ${ativo && nPostos > 0 && !vivo && html`<div class="tkt-aviso">Aguardando imagem: escolha a câmera, um arquivo ou o YouTube na barra do app.</div>`}
          ${r && r.fonteParada && html`<div class="tkt-aviso amb">Fonte pausada: o tempo corre como NÃO OBSERVADO (não conta como ocioso).</div>`}
          ${r && r.foraDeTurno && html`<div class="tkt-aviso amb">Fora de turno: a medição está suspensa (agenda em Configurar).</div>`}
          ${r && !r.borrado && html`<div class="tkt-aviso erro">Borrão de rostos DESLIGADO: o vídeo, a gravação e o PNG mostram rostos (LGPD — use só com base legal).</div>`}
        </div>`}

      <div class="tkt-grade">
        <section class="tkt-p tkt-vid">
          <h2>Postos e pessoas <small>${r ? `${r.w}×${r.h} · pose ${r.fontePose}${r.unidade === 'm' ? ' · piso em m' : ' · plano da imagem'}` : ''}</small></h2>
          <canvas ref=${cvVid} class=${`tkt-cv-vid ${calibrando ? 'cal' : ''}`} onClick=${cliqueVideo}
            aria-label="Vídeo com os postos na cor do estado e as pessoas com o ID e a atividade"></canvas>
          <div class="tkt-acoes">
            <button class="tkt-btn acento" onClick=${() => setMsg(novoPosto())}>Novo posto</button>
            <button class=${`tkt-btn ${calibrando ? 'on' : ''}`} onClick=${() => { setCalibrando(!calibrando); setSel(-1); }}>${calibrando ? 'Concluir calibração' : 'Calibrar piso'}</button>
            <button class="tkt-btn" onClick=${() => exportar('png')}>Salvar imagem</button>
          </div>
          ${calibrando && html`
            <div class="tkt-cal">
              <p class="tkt-dica">Clique em ≥ 4 marcos no CHÃO do vídeo (cantos de faixas, pés de bancada, marcas de fita), espalhados e não
                em linha, e informe a posição de cada um em metros (x, y no piso). Erro de reprojeção aceito: ≤ ${fmt(ERRO_MAX_CALIBRACAO_M, 2)} m.</p>
              <table class="tkt-tab">
                <thead><tr><th>Ponto</th><th>x (m)</th><th>y (m)</th><th></th></tr></thead>
                <tbody>
                  ${pts.length ? pts.map((p, i) => html`<tr key=${i} class=${i === sel ? 'sel' : ''} onClick=${() => setSel(i)}>
                    <td><b>P${i + 1}</b></td>
                    <td><input type="number" step="0.01" inputmode="decimal" aria-label=${`x do ponto ${i + 1} em metros`} value=${p.x == null ? '' : p.x}
                      onChange=${(e) => editarPonto(i, 'x', e.target.value)} /></td>
                    <td><input type="number" step="0.01" inputmode="decimal" aria-label=${`y do ponto ${i + 1} em metros`} value=${p.y == null ? '' : p.y}
                      onChange=${(e) => editarPonto(i, 'y', e.target.value)} /></td>
                    <td><button class="tkt-btn mini" aria-label=${`Remover o ponto ${i + 1}`} onClick=${(e) => { e.stopPropagation(); mudarPiso(pts.filter((_, j) => j !== i)); setSel(-1); }}>✕</button></td>
                  </tr>`) : html`<tr><td colspan="4" class="vazio">Nenhum ponto ainda: clique no chão do vídeo.</td></tr>`}
                </tbody>
              </table>
              <p class=${`tkt-cal-st ${piso.calibrado ? 'ok' : piso.H ? 'amb' : ''}`}>${piso.calibrado ? `Calibrado: ${piso.msg}. Distâncias e a planta em metros.` : piso.msg}</p>
              ${pts.length > 0 && html`<button class="tkt-btn" onClick=${() => { mudarPiso([]); setSel(-1); }}>Limpar pontos</button>`}
            </div>`}
        </section>

        <section class="tkt-p tkt-kpi">
          <h2>${kp ? kp.janela.nome : 'Turno'} <small>${G ? `produtivo ÷ (produtivo + improdutivo)` : ''}</small></h2>
          <div class="tkt-kpi-prin">
            <b>${pct(G && G.produtividade)}</b>
            <span>tempo produtivo${G && !G.publicavel && G.total > 0 ? html` · <em class="erro">cobertura ${pct(G.cobertura, 0)} — não publicável</em>` : ''}</span>
          </div>
          <div class="tkt-kpis">
            <div class="tkt-k"><b style=${{ color: COR_ESTADO.OCIOSO_NO_POSTO }}>${pct(G && G.ociosidade)}</b><em>ocioso no posto</em></div>
            <div class="tkt-k"><b style=${{ color: COR_ESTADO.VAGO }}>${pct(G && G.vacancia)}</b><em>posto vago</em></div>
            <div class="tkt-k"><b>${pct(G && G.ocupacao)}</b><em>ocupação</em></div>
            <div class="tkt-k"><b>${pct(G && G.cobertura)}</b><em>cobertura</em></div>
          </div>
          <dl class="tkt-tempos">
            ${G && [['Produtivo', G.produtivo, 'PRODUTIVO'], ['Ocioso no posto', G.ocioso, 'OCIOSO_NO_POSTO'], ['Vago', G.vago, 'VAGO'],
                    ['Pausa programada', G.planejado, 'PAUSA_PROGRAMADA'], ['Não observado', G.sem_dado, 'NAO_OBSERVADO']].map(([t, v, e]) => html`
              <div key=${e}><dt><i class=${`tkt-sw st-${e}`}></i>${t}</dt><dd>${hm(v)}</dd></div>`)}
          </dl>
        </section>

        <section class="tkt-p tkt-post">
          <h2>Postos <small>agora · ranking por produtividade</small></h2>
          <ul class="tkt-postos">
            ${kp && kp.postos.length ? kp.postos.map((p, i) => {
              const a = estadoAtual.get(p.id);
              const e = a && a.estado;
              const base = Math.max(1, p.total);
              return html`<li key=${p.id}>
                <span class="tkt-rank">${i + 1}</span>
                <span class="tkt-pn"><b>${p.nome}</b><small><i class=${`tkt-sw st-${e || 'NAO_OBSERVADO'}`}></i>${e ? `${ROTULO[e]} · ${relogio((motor.ultTs - a.desde) / 1000)}` : 'sem estado agora'}${a && a.pessoas ? ` · ${a.pessoas} pessoa(s)` : ''}</small></span>
                <span class="tkt-barra-est" title=${ESTADOS.map((x) => `${ROTULO[x]} ${hm(p.seg[x])}`).join(' · ')}>
                  ${ESTADOS.map((x) => (p.seg[x] > 0 ? html`<span key=${x} class=${`st-${x}`} style=${{ width: `${(p.seg[x] / base) * 100}%` }}></span>` : null))}
                </span>
                <span class="tkt-pp">${pct(p.produtividade, 0)}</span>
              </li>`;
            }) : html`<li class="vazio">${nPostos ? 'Aguardando a primeira medição…' : 'Nenhum posto marcado.'}</li>`}
          </ul>
        </section>

        <section class="tkt-p tkt-gantt">
          <h2>Linha do tempo por posto <small>${dica || 'cor e padrão por estado · traço = agora'}</small></h2>
          <canvas ref=${cvGantt} class="tkt-cv-gantt" onPointerMove=${dicaGantt} onPointerLeave=${() => setDica('')}
            aria-label="Gantt dos estados de cada posto no turno"></canvas>
          <ul class="tkt-legenda">${ESTADOS.map((e) => html`<li key=${e}><i class=${`tkt-sw st-${e}`}></i>${ROTULO[e]}</li>`)}</ul>
        </section>

        <section class="tkt-p tkt-planta">
          <h2>Planta do piso <small>vista de cima, em metros</small>
            <label class="tkt-ck"><input type="checkbox" checked=${calor} onChange=${(e) => setCalor(e.target.checked)} /> calor</label></h2>
          <canvas ref=${cvPlanta} class="tkt-cv-planta" aria-label="Planta do piso com os postos e as pessoas"></canvas>
        </section>

        <section class="tkt-p tkt-al">
          <h2>Alarmes
            <span class="tkt-seg">
              <button class=${abaAl === 'ativos' ? 'on' : ''} aria-pressed=${abaAl === 'ativos'} onClick=${() => setAbaAl('ativos')}>Ativos${ativos.length ? ` (${ativos.length})` : ''}</button>
              <button class=${abaAl === 'hist' ? 'on' : ''} aria-pressed=${abaAl === 'hist'} onClick=${() => setAbaAl('hist')}>Histórico</button>
            </span>
            <button class="tkt-btn mini" onClick=${() => { motor.reconhecer(); setV((n) => n + 1); setMsg('Alarmes reconhecidos.'); }}>Reconhecer</button>
          </h2>
          ${abaAl === 'ativos' ? html`<ul class="tkt-alarmes">
            ${ativos.length ? ativos.map((a) => html`<li key=${a.chave} class=${`${a.tipo === 'VAGO' ? 'p1' : 'p2'} ${a.reconhecido ? '' : 'nr'}`}>
              <b>${a.tipo}</b><span>${a.texto}</span><small>desde ${horaSeg(a.desde)}${a.reconhecido ? ' · reconhecido' : ''}</small></li>`)
              : html`<li class="vazio">${`Nenhum alarme ativo. Limites: vago acima de ${motor.cfg.alarmes.vagoMin} min · ocioso acima de ${motor.cfg.alarmes.ociosoPct} % · cobertura abaixo de ${motor.cfg.alarmes.coberturaMin} %.`}</li>`}
          </ul>` : html`<div class="tkt-jt"><table><thead><tr><th>Hora</th><th>Posto</th><th>Evento</th><th>Detalhe</th></tr></thead><tbody>
            ${hist.length ? hist.map((e, i) => html`<tr key=${i}><td>${horaSeg(e.ts)}</td><td>${e.posto}</td><td><b>${e.evento}</b></td><td>${e.detalhe}</td></tr>`)
              : html`<tr><td colspan="4">Nenhum alarme registrado.</td></tr>`}
          </tbody></table></div>`}
        </section>
      </div>

      ${cfg && html`<${ConfigTakt} motor=${motor} onFechar=${() => setCfg(false)} onMsg=${setMsg} />`}
    </div>
  `;
}

// ===================================================================== Configurar

function ConfigTakt({ motor, onFechar, onMsg }) {
  const [, setV] = useState(0);
  const C = motor.cfg;
  const def = (patch, txt) => { motor.definir(patch); avisarAgora(); setV((n) => n + 1); if (txt) onMsg(txt); };
  const num = (v) => Number(String(v).replace(',', '.'));
  const turno = (i, patch) => def({ turnos: C.turnos.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const pausasTxt = (t) => t.pausas.map(([a, b]) => `${a}-${b}`).join('; ');
  const lerPausas = (s) => String(s).split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s*[-–]\s*/)).filter((p) => p.length === 2);
  const importar = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    f.text().then((t) => { def(normalizar(JSON.parse(t)), 'Configuração importada.'); motor.calibrar(); }).catch((err) => onMsg('JSON inválido: ' + err.message));
    e.target.value = '';
  };
  return html`
    <aside class="tkt-cfg" aria-label="Configurar o Takt">
      <div class="tkt-cfg-h"><b>Configurar</b><button class="tkt-btn mini" onClick=${onFechar} aria-label="Fechar a configuração">✕</button></div>
      <div class="tkt-cfg-c">
        <h3>Máquina de estados</h3>
        <label class="tkt-campo"><span>Tempos</span>
          <select class="tkt-btn" value=${C.tempos} onChange=${(e) => def({ tempos: e.target.value }, 'Tempos: ' + e.target.selectedOptions[0].text)}>
            ${Object.entries(TEMPOS).map(([k, t]) => html`<option key=${k} value=${k}>${t.rotulo}</option>`)}
            <option value="personalizado">Personalizado</option>
          </select></label>
        ${[['act_on', 'Entra em produtivo com atividade ≥', 0.05], ['act_off', 'Sai de produtivo abaixo de', 0.05], ['enter_confirm_s', 'Confirmar produtivo (s)', 0.5],
           ['idle_confirm_s', 'Confirmar ocioso (s)', 1], ['vacant_confirm_s', 'Confirmar vago (s)', 1], ['stale_s', 'Sem quadro → não observado (s)', 0.5],
           ['min_conf_det', 'Confiança mín. da pessoa', 0.05], ['min_qual_pose', 'Qualidade mín. da pose', 0.01]].map(([k, t, passo]) => html`
          <label class="tkt-campo" key=${k}><span>${t}</span><input type="number" step=${passo} value=${C.params[k]}
            onChange=${(e) => def({ tempos: 'personalizado', params: { ...C.params, [k]: num(e.target.value) } })} /></label>`)}
        <p class="tkt-dica">Histerese e tempos que RETROAGEM: o estado novo começa quando o candidato surgiu. Micro-pausa é trabalho; sair para pegar peça não é vago.</p>

        <h3>Presença e amostragem</h3>
        <label class="tkt-campo"><span>Presença no posto medida</span>
          <select class="tkt-btn" value=${C.presenca} onChange=${(e) => def({ presenca: e.target.value }, e.target.value === 'piso' && !motor.piso.calibrado ? 'Presença no piso só vale com o piso calibrado.' : '')}>
            <option value="imagem">no plano da imagem (bancada do Takt)</option>
            <option value="piso">no piso, em metros (worker do Takt; exige calibração)</option>
          </select></label>
        <label class="tkt-campo"><span>Raio de presença no piso (m)</span><input type="number" step="0.1" value=${C.raio_m} onChange=${(e) => def({ raio_m: num(e.target.value) })} /></label>
        <label class="tkt-campo"><span>Raio na imagem (fração da altura)</span><input type="number" step="0.01" value=${C.raio_img} onChange=${(e) => def({ raio_img: num(e.target.value) })} /></label>
        <label class="tkt-campo"><span>Amostras por segundo</span><input type="number" step="1" min="1" max="15" value=${C.amostrasHz} onChange=${(e) => def({ amostrasHz: num(e.target.value) })} /></label>

        <h3>Turnos e pausas programadas</h3>
        <label class="tkt-campo"><span>Fuso da planta</span><input type="text" value=${C.fuso} onChange=${(e) => {
          try { new Intl.DateTimeFormat('pt-BR', { timeZone: e.target.value }); def({ fuso: e.target.value }); } catch (_) { onMsg('Fuso inválido (ex.: America/Sao_Paulo).'); }
        }} /></label>
        ${C.turnos.length ? '' : html`<p class="tkt-dica">Sem turnos cadastrados o posto é medido sempre (como no Takt).</p>`}
        ${C.turnos.map((t, i) => html`<div class="tkt-turno" key=${i}>
          <div class="tkt-turno-l">
            <input type="text" aria-label="Nome do turno" value=${t.nome} onChange=${(e) => turno(i, { nome: e.target.value })} />
            <input type="time" aria-label="Início" value=${t.inicio} onChange=${(e) => turno(i, { inicio: e.target.value })} />
            <input type="time" aria-label="Fim" value=${t.fim} onChange=${(e) => turno(i, { fim: e.target.value })} />
            <button class="tkt-btn mini" aria-label=${`Remover o turno ${t.nome}`} onClick=${() => def({ turnos: C.turnos.filter((_, j) => j !== i) })}>✕</button>
          </div>
          <div class="tkt-dias">${DIAS.map((d, k) => html`<label key=${k}><input type="checkbox" checked=${t.dias.includes(k)}
            onChange=${(e) => turno(i, { dias: e.target.checked ? [...t.dias, k].sort() : t.dias.filter((x) => x !== k) })} />${d}</label>`)}</div>
          <label class="tkt-campo"><span>Pausas (09:00-09:10; 12:00-13:00)</span><input type="text" value=${pausasTxt(t)} onChange=${(e) => turno(i, { pausas: lerPausas(e.target.value) })} /></label>
        </div>`)}
        <div class="tkt-acoes">
          <button class="tkt-btn" onClick=${() => def({ turnos: [...C.turnos, { nome: String.fromCharCode(65 + C.turnos.length), inicio: '08:00', fim: '17:00', dias: [1, 2, 3, 4, 5], pausas: [['12:00', '13:00']] }] })}>+ Turno</button>
          <button class="tkt-btn" onClick=${() => def({ turnos: TURNOS_EXEMPLO }, 'Modelo de 3 turnos aplicado.')}>Modelo 3 turnos</button>
          ${C.turnos.length > 0 && html`<button class="tkt-btn" onClick=${() => def({ turnos: [] }, 'Sem turnos: mede sempre.')}>Sem turnos</button>`}
        </div>

        <h3>Alarmes</h3>
        <label class="tkt-campo"><span>Posto vago por mais de (min)</span><input type="number" step="1" value=${C.alarmes.vagoMin} onChange=${(e) => def({ alarmes: { ...C.alarmes, vagoMin: num(e.target.value) } })} /></label>
        <label class="tkt-campo"><span>Ocioso acima de (% do observado)</span><input type="number" step="1" value=${C.alarmes.ociosoPct} onChange=${(e) => def({ alarmes: { ...C.alarmes, ociosoPct: num(e.target.value) } })} /></label>
        <label class="tkt-campo"><span>Cobertura abaixo de (%)</span><input type="number" step="1" value=${C.alarmes.coberturaMin} onChange=${(e) => def({ alarmes: { ...C.alarmes, coberturaMin: num(e.target.value) } })} /></label>

        <h3>Privacidade (LGPD)</h3>
        <label class="tkt-ck"><input type="checkbox" checked=${C.privacidade.borrar} onChange=${(e) => def({ privacidade: { ...C.privacidade, borrar: e.target.checked } }, e.target.checked ? 'Rostos borrados.' : 'Borrão desligado: use só com base legal.')} /> Borrar rostos (vídeo, gravação, PNG e esta tela)</label>
        <label class="tkt-ck"><input type="checkbox" checked=${C.privacidade.caixas} onChange=${(e) => def({ privacidade: { ...C.privacidade, caixas: e.target.checked } })} /> Também o topo da caixa de cada pessoa (conservador)</label>
        <p class="tkt-dica">Sem reconhecimento facial e sem embedding: o rosto é achado pelos pontos da cabeça da pose. Os IDs são da sessão e não identificam ninguém; nada da imagem sai do aparelho.</p>

        <h3>Vídeo gravado</h3>
        <label class="tkt-campo"><span>Início do 1º quadro (para turnos e pausas)</span><input type="datetime-local" step="1" value=${C.videoInicio}
          onChange=${(e) => def({ videoInicio: e.target.value }, 'Vale para o próximo vídeo aberto (ou Nova sessão).')} /></label>

        <h3>Arquivo</h3>
        <div class="tkt-acoes">
          <button class="tkt-btn" onClick=${() => baixar(motor.exportarConfig(), 'takt-config.json', 'application/json')}>Exportar configuração</button>
          <label class="tkt-btn">Importar…<input type="file" accept="application/json,.json" class="tkt-sr" onChange=${importar} /></label>
          <button class="tkt-btn" onClick=${() => { if (confirm('Voltar a configuração do Takt ao padrão? A calibração do piso também é apagada.')) def(normalizar({}), 'Configuração padrão.'); }}>Padrão</button>
        </div>
      </div>
    </aside>
  `;
}

export default StudioTakt;
