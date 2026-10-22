/**
 * components/industrial/StudioOEE.js — a tela cheia "GPlanSiS|OEE": OEE pela
 * câmera de máquina sem CLP (CV-46), no mesmo desenho dos Studios industriais
 * (Takt, BeltScan, CounterVision), nos três temas e no celular.
 *
 *   Vídeo       o último quadro medido, as ROIs (máquina na cor do estado,
 *               setup tracejada) com o tempo no estado e o movimento.
 *   OEE         disponibilidade × desempenho × qualidade da janela (turno da
 *               agenda ou sessão), tempos e o apontamento manual (peças e
 *               refugo) quando não há CounterVision/Inspect no Pipeline.
 *   Máquinas    estado atual, movimento com as marcas on/off da histerese.
 *   Linha do tempo  uma faixa por máquina; clicar numa parada a seleciona.
 *   Paradas     lista (mais recente primeiro): CLIQUE num motivo classifica a
 *               parada (ou o setup); sugestões do Takt (falta de operador).
 *   Pareto      tempo por motivo, com o acumulado.
 *   Turnos      OEE de cada turno visto na sessão.
 *   Alarmes     parada sem motivo há mais de N min; eventos.
 *   Configurar  histerese e tempos, ciclo ideal, máquina de produção, motivos
 *               (planejado ou não), turnos e pausas, alarme, importar/exportar.
 *   Exportar    estados, paradas, OEE por turno e eventos em CSV; PNG do vídeo
 *               e da linha do tempo; relatório HTML (imprimir → PDF).
 *
 * A fonte é a do app: o botão Fonte da barra (components/studio/FonteStudio.js)
 * troca câmera, arquivo, tela ou YouTube sem fechar a tela. Gancho de teste:
 * window.aivOEE.
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { marcStore } from '../../cv/marcacoes.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import {
  obterMotor, instantaneo, ultimoQuadro, assinar, avisarAgora, definirStudio, recente, novaSessao, normalizar, MOTIVOS_PADRAO,
} from '../../cv/runtime/livres-o/canal.js';
import { TURNOS_EXEMPLO } from '../../cv/runtime/livres-m/canal.js';
import {
  OP, carregarCss, fmt, pct, hm, relogio, hora, horaSeg, carimbo, baixar, ativarOEE, novaArea, maquinasMarcadas,
  desenharVideo, desenharGantt, desenharPareto, relatorioHTML, imgDe, COR, ROTULO, ESTADOS, SEM_MOTIVO,
} from './oee-comum.js';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function StudioOEE({ onClose }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const ativo = Boolean(no && no.enabled);
  const nMaq = useStore(marcStore, (st) => maquinasMarcadas(st).length);
  const motor = obterMotor();

  const [r, setR] = useState(() => instantaneo());
  const [cfg, setCfg] = useState(false);
  const [exp, setExp] = useState(false);
  const [sel, setSel] = useState(null);       // id do intervalo selecionado (parada/setup)
  const [aba, setAba] = useState('alarmes');
  const [dica, setDica] = useState('');
  const [msg, setMsgBruto] = useState('');
  const [apP, setApP] = useState('');
  const [apR, setApR] = useState('');
  const [, setV] = useState(0);
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 7000); }, []);

  const raiz = useRef(null);
  const cvVid = useRef(null), cvGantt = useRef(null), cvPareto = useRef(null);
  const fundo = useRef(null);
  const faixas = useRef([]);
  const ultimo = useRef('');

  useEffect(() => {
    carregarCss();
    definirStudio(true);
    document.body.classList.add('studio-aberto', 'oee-aberto');
    return () => { definirStudio(false); document.body.classList.remove('studio-aberto', 'oee-aberto', 'studio-ocioso'); };
  }, []);
  useEffect(() => assinar((x) => setR(x)), []);
  useEffect(() => { const t = setInterval(() => setV((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  // redesenho sob demanda: retrato, sessão, seleção, tamanho ou tema
  useEffect(() => {
    let id = 0;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const rr = instantaneo();
      const chave = `${rr ? rr.t : ''}|${motor.alteracoes}|${sel}|${window.innerWidth}x${window.innerHeight}|${document.documentElement.getAttribute('data-theme')}|${cfg}`;
      if (chave === ultimo.current) return;
      ultimo.current = chave;
      const img = ultimoQuadro();
      if (img) {
        if (!fundo.current) fundo.current = document.createElement('canvas');
        const f = fundo.current;
        if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
        f.getContext('2d').putImageData(img, 0, 0);
      }
      if (cvVid.current) desenharVideo(cvVid.current, img ? fundo.current : null, rr);
      const kp = motor.kpis();
      if (cvGantt.current) faixas.current = desenharGantt(cvGantt.current, motor, kp, raiz.current, sel);
      if (cvPareto.current) desenharPareto(cvPareto.current, kp && kp.geral ? kp.geral.motivos : [], raiz.current);
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [sel, cfg]);

  useEffect(() => {
    window.aivOEE = { motor, retrato: () => instantaneo(), novaArea, configurar: (v) => setCfg(Boolean(v)), relatorio: () => relatorioHTML(motor), selecionar: setSel };
    return () => { if (window.aivOEE && window.aivOEE.motor === motor) delete window.aivOEE; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && fonteStudioAberta()) return;   // o popover da Fonte fecha primeiro
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (exp) setExp(false); else if (cfg) setCfg(false); else if (sel != null) setSel(null); else onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cfg, exp, sel, onClose]);

  // ---------------------------------------------------------- ações
  const classificar = (id, motivo) => {
    motor.classificar(id, motivo);
    avisarAgora(); setV((n) => n + 1);
    setMsg(motivo ? `Classificada: ${motivo}.` : 'Classificação removida.');
  };
  const apontar = () => {
    const p = Math.max(0, Math.round(Number(String(apP).replace(',', '.')) || 0)), rf = Math.max(0, Math.round(Number(String(apR).replace(',', '.')) || 0));
    if (!p && !rf) { setMsg('Informe peças e/ou refugo.'); return; }
    motor.apontar({ pecas: p, refugo: rf });
    avisarAgora(); setApP(''); setApR(''); setV((n) => n + 1);
    setMsg(`Apontado: ${p} peça(s), ${rf} refugo.`);
  };
  const exportar = (tipo) => {
    setExp(false);
    const nome = `oee_${carimbo()}`;
    if (tipo === 'estados') baixar(motor.intervalosCSV(), `${nome}_estados.csv`, 'text/csv');
    else if (tipo === 'paradas') baixar(motor.paradasCSV(), `${nome}_paradas.csv`, 'text/csv');
    else if (tipo === 'turnos') baixar(motor.turnosCSV(), `${nome}_turnos.csv`, 'text/csv');
    else if (tipo === 'eventos') baixar(motor.eventosCSV(), `${nome}_eventos.csv`, 'text/csv');
    else if (tipo === 'relatorio') baixar(relatorioHTML(motor, { gantt: imgDe(cvGantt.current), pareto: imgDe(cvPareto.current) }), `${nome}_relatorio.html`, 'text/html');
    else if (tipo === 'png' && cvVid.current) cvVid.current.toBlob((b) => b && baixar(b, `${nome}_video.png`, 'image/png'), 'image/png');
    else if (tipo === 'pngTempo' && cvGantt.current) cvGantt.current.toBlob((b) => b && baixar(b, `${nome}_linha-do-tempo.png`, 'image/png'), 'image/png');
    else if (tipo === 'config') baixar(motor.exportarConfig(), 'oee-config.json', 'application/json');
    setMsg('Arquivo gerado no aparelho (nada é enviado).');
  };
  const pontoGantt = (e) => {
    const rc = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rc.left, y = e.clientY - rc.top;
    return faixas.current.find((q) => x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1);
  };
  const dicaGantt = (e) => {
    const f = pontoGantt(e);
    setDica(f ? `${f.nome} · ${ROTULO[f.iv.estado]} · ${horaSeg(f.iv.inicio)}–${f.iv.fim != null ? horaSeg(f.iv.fim) : 'agora'} · ${hm(((f.iv.fim != null ? f.iv.fim : motor.ultTs) - f.iv.inicio) / 1000)}${f.iv.motivo ? ' · ' + f.iv.motivo : ''}` : '');
  };
  const cliqueGantt = (e) => {
    const f = pontoGantt(e);
    if (f && (f.iv.estado === 'PARADA' || f.iv.estado === 'SETUP')) { setSel(f.iv.id); setMsg('Parada selecionada: escolha o motivo na lista «Paradas».'); }
  };

  // ---------------------------------------------------------- dados
  const kp = motor.kpis();
  const G = kp ? kp.geral : null;
  const vivo = recente(3000);
  const paradas = motor.paradas().slice(0, 80);
  const ativos = motor.alarmesAtivos();
  const hist = motor.eventos.slice(-150).reverse();
  const turnos = motor.porTurno();
  const janelaTxt = kp ? `${kp.janela.nome} · ${hora(kp.janela.de)}–${kp.janela.turno ? hora(kp.janela.ate) : 'agora'}` : 'sem medição';
  const f = motor.fontes || {};
  const fontePecas = G && G.prod ? G.prod.fontePecas : null;
  const motivos = motor.cfg.motivos;
  const P = motor.cfg.params;
  const baixo = G && G.oee != null && G.oee < 0.6;

  const fatorEl = (v, nome, extra = '') => html`<div class="oee-f"><b>${pct(v)}</b><em>${nome}${extra}</em><i><span style=${{ width: `${Math.max(0, Math.min(1, v || 0)) * 100}%` }}></span></i></div>`;

  return html`
    <div class="oee" ref=${raiz} role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|OEE">
      <div class="oee-barra">
        <b class="oee-titulo"><span class="oee-marca">iaVision</span> <span class="oee-gp">GPlanSiS<i>|</i></span>OEE</b>
        <${FonteStudio} classeBotao="oee-btn" />
        <span class="oee-chip" title="Janela do OEE">${janelaTxt}</span>
        <span class=${`oee-chip ${fontePecas ? 'ok' : 'amb'}`} title="De onde vêm as peças">${fontePecas ? `peças: ${fontePecas}` : 'sem fonte de peças'}</span>
        <span class=${`oee-chip ${motor.cfg.cicloIdeal_s > 0 ? 'ok' : 'amb'}`} title="Ciclo ideal (desempenho)">${motor.cfg.cicloIdeal_s > 0 ? `ciclo ${fmt(motor.cfg.cicloIdeal_s, 1)} s` : 'sem ciclo ideal'}</span>
        ${f.takt && html`<span class="oee-chip ok" title="Operador no posto pelo Takt">Takt</span>`}
        ${f.inspect && html`<span class="oee-chip ok" title="Qualidade pelo Inspect">Inspect</span>`}
        <span class="oee-msg" role="status" aria-live="polite">${msg}</span>
        <button class="oee-btn" onClick=${() => setMsg(novaArea('maquina'))}>Marcar máquina</button>
        <button class=${`oee-btn ${cfg ? 'on' : ''}`} onClick=${() => setCfg(!cfg)}>Configurar</button>
        <span class="oee-menu-w">
          <button class=${`oee-btn ${exp ? 'on' : ''}`} aria-haspopup="menu" aria-expanded=${exp} onClick=${() => setExp(!exp)}>Exportar ▾</button>
          ${exp && html`<div class="oee-menu" role="menu">
            <button role="menuitem" onClick=${() => exportar('estados')}>Estados por máquina (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('paradas')}>Paradas e motivos (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('turnos')}>OEE por turno (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('eventos')}>Eventos e alarmes (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('relatorio')}>Relatório (HTML → imprimir / PDF)</button>
            <button role="menuitem" onClick=${() => exportar('png')}>Imagem do vídeo (PNG)</button>
            <button role="menuitem" onClick=${() => exportar('pngTempo')}>Linha do tempo (PNG)</button>
            <button role="menuitem" onClick=${() => exportar('config')}>Configuração (JSON)</button>
          </div>`}
        </span>
        <button class="oee-btn" onClick=${() => { if (confirm('Começar uma sessão nova? Estados, paradas, motivos e produção desta sessão serão apagados (exporte antes, se precisar).')) { novaSessao(); setSel(null); setMsg('Sessão nova.'); } }}>Nova sessão</button>
        <button class="oee-btn oee-fechar" onClick=${onClose} aria-label="Fechar a tela OEE">✕</button>
      </div>

      ${(!ativo || !nMaq || (ativo && nMaq > 0 && !vivo) || (r && r.foraDeTurno) || (r && r.fonteParada)) && html`
        <div class="oee-avisos">
          ${!ativo && html`<div class="oee-aviso">O operador OEE (estado da máquina) não está ativo no Pipeline.
            <button class="oee-btn" onClick=${() => { ativarOEE(); setMsg('OEE ligado no Pipeline.'); }}>Ligar no Pipeline</button></div>`}
          ${ativo && !nMaq && html`<div class="oee-aviso">Nenhuma máquina marcada: marque a área que se MOVE quando a máquina trabalha.
            <button class="oee-btn acento" onClick=${() => setMsg(novaArea('maquina'))}>Marcar máquina</button></div>`}
          ${ativo && nMaq > 0 && !vivo && html`<div class="oee-aviso">Aguardando imagem: escolha a câmera, um arquivo ou o YouTube no botão Fonte.</div>`}
          ${r && r.fonteParada && html`<div class="oee-aviso amb">Fonte pausada: o tempo corre como NÃO OBSERVADO (não conta como parada).</div>`}
          ${r && r.foraDeTurno && html`<div class="oee-aviso amb">Fora de turno: a medição está suspensa (agenda em Configurar).</div>`}
        </div>`}

      <div class="oee-grade">
        <section class="oee-p oee-vid">
          <h2>Máquina <small>${r ? `${r.w}×${r.h} · movimento por ${no && no.params && no.params.metodo === 'fundo adaptativo' ? 'fundo adaptativo' : 'diferença de quadros'}` : ''}</small></h2>
          <canvas ref=${cvVid} class="oee-cv-vid" aria-label="Vídeo com a área da máquina na cor do estado e o movimento medido"></canvas>
          <div class="oee-acoes">
            <button class="oee-btn acento" onClick=${() => setMsg(novaArea('maquina'))}>+ Máquina</button>
            <button class="oee-btn" onClick=${() => setMsg(novaArea('setup'))}>+ Área de setup</button>
            <button class="oee-btn" onClick=${() => exportar('png')}>Salvar imagem</button>
          </div>
          <p class="oee-dica">As áreas são marcações das Ferramentas de mouse (função «OEE · máquina» / «OEE · setup»): ajuste com as alças no vídeo do app.</p>
        </section>

        <section class="oee-p oee-kpi">
          <h2>${kp ? kp.janela.nome : 'OEE'} <small>disponibilidade × desempenho × qualidade</small></h2>
          <div class="oee-kpi-prin">
            <b class=${baixo ? 'baixo' : ''}>${pct(G && G.oee)}</b>
            <span>OEE${G && G.parcial ? html` · <em>parcial: falta ${G.faltam.join(' e ')}</em>` : ''}</span>
          </div>
          <div class="oee-fatores">
            ${fatorEl(G && G.disponibilidade, 'disponibilidade')}
            ${fatorEl(G && G.desempenho, 'desempenho', G && G.pecas != null ? ` · ${G.pecas} pç` : '')}
            ${fatorEl(G && G.qualidade, 'qualidade', G && G.boas != null ? ` · ${G.boas} boas` : '')}
          </div>
          <dl class="oee-tempos">
            ${G && [['Planejado', G.planejado, null], ['Operando', G.operando, 'RODANDO'], ['Parada', G.seg.PARADA, 'PARADA'], ['Setup', G.seg.SETUP, 'SETUP'],
                    ['Pausa programada', G.seg.PAUSA_PROGRAMADA, 'PAUSA_PROGRAMADA'], ['Não observado', G.seg.NAO_OBSERVADO, 'NAO_OBSERVADO']].map(([t, v, e]) => html`
              <div key=${t}><dt>${e ? html`<i class=${`oee-sw est-${e}`}></i>` : ''}${t}</dt><dd>${hm(v)}</dd></div>`)}
          </dl>
          <div class="oee-apont">
            <label>Peças (apontar)<input type="number" min="0" step="1" inputmode="numeric" value=${apP} onInput=${(e) => setApP(e.target.value)} /></label>
            <label>Refugo (apontar)<input type="number" min="0" step="1" inputmode="numeric" value=${apR} onInput=${(e) => setApR(e.target.value)} /></label>
            <button class="oee-btn" onClick=${apontar}>Apontar</button>
          </div>
          ${!f.contador && !f.inspect && html`<p class="oee-dica">Sem CounterVision nem Inspect no Pipeline: aponte as peças e o refugo à mão (ficam no instante do apontamento).</p>`}
        </section>

        <section class="oee-p oee-maq">
          <h2>Máquinas <small>agora · movimento (marcas: off | on)</small></h2>
          <ul class="oee-maqs">
            ${r && r.maquinas && r.maquinas.length ? r.maquinas.map((m) => {
              const km = kp && kp.maquinas.find((x) => x.id === m.id);
              const esc = (v) => `${Math.min(100, (v || 0) / Math.max(P.on * 2.5, 1e-6) * 100)}%`;
              return html`<li key=${m.id}>
                <span><b>${m.nome}</b><small><i class=${`oee-sw est-${m.estado || 'NAO_OBSERVADO'}`}></i>${m.estado ? `${ROTULO[m.estado]} · ${relogio((r.t - m.desde) / 1000)}` : 'aguardando confirmação'}${m.cand && m.cand !== m.estado ? ` · → ${ROTULO[m.cand].toLowerCase()}?` : ''}</small></span>
                <span class="oee-mov" title=${`movimento ${pct(m.mov)}`}><span style=${{ width: esc(m.mov), background: m.estado ? COR[m.estado] : '#94a3b8' }}></span>
                  <i class="off" style=${{ left: esc(P.off) }}></i><i style=${{ left: esc(P.on) }}></i></span>
                <em title="disponibilidade">${pct(km && km.disponibilidade, 0)}</em>
              </li>`;
            }) : html`<li class="vazio">${nMaq ? 'Aguardando a primeira medição…' : 'Nenhuma máquina marcada.'}</li>`}
          </ul>
          <ul class="oee-legenda">${ESTADOS.map((e) => html`<li key=${e}><i class=${`oee-sw est-${e}`}></i>${ROTULO[e]}</li>`)}</ul>
        </section>

        <section class="oee-p oee-gantt">
          <h2>Linha do tempo <small>${dica || 'clique numa parada para classificar · traço = agora'}</small></h2>
          <canvas ref=${cvGantt} class="oee-cv-gantt" onPointerMove=${dicaGantt} onPointerLeave=${() => setDica('')} onClick=${cliqueGantt}
            aria-label="Estados de cada máquina na janela; clique numa parada para selecioná-la"></canvas>
        </section>

        <section class="oee-p oee-par">
          <h2>Paradas e setups <small>${paradas.filter((p) => !p.motivo).length} sem motivo · clique num motivo para classificar</small></h2>
          <ul class="oee-paradas">
            ${paradas.length ? paradas.map((p) => {
              const dur = ((p.fim != null ? p.fim : motor.ultTs) - p.inicio) / 1000;
              const aberta = sel === p.id;
              return html`<li key=${p.id} class=${aberta ? 'sel' : ''}>
                <button class="oee-pl" aria-expanded=${aberta} onClick=${() => setSel(aberta ? null : p.id)}>
                  <i class=${`oee-sw est-${p.estado}`}></i><b>${horaSeg(p.inicio)}</b><span>${p.nome} · ${ROTULO[p.estado].toLowerCase()} · ${hm(dur)}${p.fim == null ? ' (em curso)' : ''}</span>
                  <span class=${`motivo ${p.motivo ? '' : 'sem'}`}>${p.motivo || (p.sugestao ? `sugestão: ${p.sugestao}` : SEM_MOTIVO)}</span>
                </button>
                ${aberta && html`<div class="oee-chips" role="group" aria-label="Motivo da parada">
                  ${motivos.map((m) => html`<button key=${m.nome} class=${`${p.motivo === m.nome ? 'on' : ''} ${m.planejada ? 'plan' : ''} ${p.sugestao === m.nome && !p.motivo ? 'sug' : ''}`}
                    aria-pressed=${p.motivo === m.nome} title=${m.planejada ? 'parada planejada: sai do tempo planejado' : 'perda de disponibilidade'}
                    onClick=${() => classificar(p.id, m.nome)}>${m.nome}${m.planejada ? ' ·P' : ''}</button>`)}
                  ${p.motivo && html`<button onClick=${() => classificar(p.id, '')}>✕ limpar</button>`}
                </div>`}
              </li>`;
            }) : html`<li class="vazio">Nenhuma parada na sessão.</li>`}
          </ul>
          <p class="oee-dica">·P = motivo planejado (sai do tempo planejado e não pesa na disponibilidade). Edite a lista em Configurar.</p>
        </section>

        <section class="oee-p oee-pareto">
          <h2>Pareto dos motivos <small>tempo parado por motivo · linha = acumulado</small></h2>
          <canvas ref=${cvPareto} class="oee-cv-pareto" aria-label="Pareto do tempo de parada por motivo"></canvas>
        </section>

        <section class="oee-p oee-turnos">
          <h2>OEE por turno <small>${motor.cfg.turnos.length ? 'turnos da agenda' : 'sem agenda: a sessão inteira'}</small></h2>
          <div class="oee-jt"><table>
            <thead><tr><th>Janela</th><th>Início</th><th>D</th><th>P</th><th>Q</th><th>OEE</th><th>Peças</th></tr></thead>
            <tbody>${turnos.length ? turnos.map(({ janela: j, k }, i) => html`<tr key=${i}><td>${j.nome}</td><td>${hora(j.de)}</td>
              <td class="num">${pct(k && k.disponibilidade, 0)}</td><td class="num">${pct(k && k.desempenho, 0)}</td><td class="num">${pct(k && k.qualidade, 0)}</td>
              <td class="num"><b>${pct(k && k.oee, 1)}</b></td><td class="num">${k && k.pecas != null ? k.pecas : '—'}</td></tr>`)
              : html`<tr><td colspan="7">Sem medição.</td></tr>`}</tbody>
          </table></div>
        </section>

        <section class="oee-p oee-al">
          <h2>
            <span class="oee-seg">
              <button class=${aba === 'alarmes' ? 'on' : ''} aria-pressed=${aba === 'alarmes'} onClick=${() => setAba('alarmes')}>Alarmes${ativos.length ? ` (${ativos.length})` : ''}</button>
              <button class=${aba === 'eventos' ? 'on' : ''} aria-pressed=${aba === 'eventos'} onClick=${() => setAba('eventos')}>Eventos</button>
            </span>
            <button class="oee-btn mini" onClick=${() => { motor.reconhecer(); setV((n) => n + 1); setMsg('Alarmes reconhecidos.'); }}>Reconhecer</button>
          </h2>
          ${aba === 'alarmes' ? html`<ul class="oee-alarmes">
            ${ativos.length ? ativos.map((a) => html`<li key=${a.chave} class=${a.reconhecido ? '' : 'nr'}><b>${a.tipo}</b> ${a.texto}<br /><small>desde ${horaSeg(a.desde)}</small></li>`)
              : html`<li class="vazio">Nenhum alarme ativo. Limite: parada sem motivo por mais de ${motor.cfg.alarmes.paradaMin} min.</li>`}
          </ul>` : html`<div class="oee-jt"><table><thead><tr><th>Hora</th><th>Máquina</th><th>Evento</th><th>Detalhe</th></tr></thead><tbody>
            ${hist.length ? hist.map((e, i) => html`<tr key=${i}><td>${horaSeg(e.ts)}</td><td>${e.maquina}</td><td><b>${e.evento}</b></td><td>${e.detalhe}</td></tr>`)
              : html`<tr><td colspan="4">Nenhum evento.</td></tr>`}
          </tbody></table></div>`}
        </section>
      </div>

      ${cfg && html`<${ConfigOEE} motor=${motor} onFechar=${() => setCfg(false)} onMsg=${setMsg} />`}
    </div>
  `;
}

// ===================================================================== Configurar

function ConfigOEE({ motor, onFechar, onMsg }) {
  const [, setV] = useState(0);
  const [novoMotivo, setNovoMotivo] = useState('');
  const C = motor.cfg;
  const def = (patch, txt) => { motor.definir(patch); avisarAgora(); setV((n) => n + 1); if (txt) onMsg(txt); };
  const num = (v) => Number(String(v).replace(',', '.'));
  const par = (k, v) => def({ params: { ...C.params, [k]: v } });
  const turno = (i, patch) => def({ turnos: C.turnos.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const pausasTxt = (t) => t.pausas.map(([a, b]) => `${a}-${b}`).join('; ');
  const lerPausas = (s) => String(s).split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s*[-–]\s*/)).filter((p) => p.length === 2);
  const maqs = [...motor.maq.values()];
  const importar = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    f.text().then((t) => def(normalizar(JSON.parse(t)), 'Configuração importada.')).catch((err) => onMsg('JSON inválido: ' + err.message));
    e.target.value = '';
  };
  return html`
    <aside class="oee-cfg" aria-label="Configurar o OEE">
      <div class="oee-cfg-h"><b>Configurar</b><button class="oee-btn mini" onClick=${onFechar} aria-label="Fechar a configuração">✕</button></div>
      <div class="oee-cfg-c">
        <h3>Estado pela imagem (histerese)</h3>
        ${[['on', 'Rodando com movimento ≥ (% dos pixels)', 100], ['off', 'Quieta com movimento ≤ (%)', 100], ['setupOn', 'Setup com movimento na área de setup ≥ (%)', 100]].map(([k, t, mul]) => html`
          <label class="oee-campo" key=${k}><span>${t}</span><input type="number" step="0.1" min="0" value=${+(C.params[k] * mul).toFixed(2)}
            onChange=${(e) => par(k, num(e.target.value) / mul)} /></label>`)}
        ${[['confRodando_s', 'Confirmar rodando (s)'], ['confParada_s', 'Confirmar parada (s)'], ['confSetup_s', 'Confirmar setup (s)'],
           ['microParada_s', 'Microparada: abaixo de (s; 0 = desligado)'], ['stale_s', 'Sem quadro → não observado (s)']].map(([k, t]) => html`
          <label class="oee-campo" key=${k}><span>${t}</span><input type="number" step="0.5" min="0" value=${C.params[k]} onChange=${(e) => par(k, num(e.target.value))} /></label>`)}
        <p class="oee-dica">Os tempos RETROAGEM: o estado novo começa quando o candidato surgiu — a duração sai exata. A pausa entre ciclos de uma máquina intermitente deve ser menor que «confirmar parada».</p>

        <h3>Desempenho e produção</h3>
        <label class="oee-campo"><span>Ciclo ideal (s por peça; 0 = sem desempenho)</span><input type="number" step="0.1" min="0" value=${C.cicloIdeal_s}
          onChange=${(e) => def({ cicloIdeal_s: num(e.target.value) })} /></label>
        <label class="oee-campo"><span>ou capacidade nominal (peças/min)</span><input type="number" step="1" min="0" value=${C.cicloIdeal_s > 0 ? +(60 / C.cicloIdeal_s).toFixed(2) : ''}
          onChange=${(e) => { const v = num(e.target.value); def({ cicloIdeal_s: v > 0 ? 60 / v : 0 }); }} /></label>
        <label class="oee-campo"><span>Máquina que recebe peças e qualidade</span>
          <select class="oee-btn" value=${C.maquinaProducao} onChange=${(e) => def({ maquinaProducao: e.target.value })}>
            <option value="">a primeira marcada</option>
            ${maqs.map((m) => html`<option key=${m.id} value=${m.id}>${m.nome}</option>`)}
          </select></label>
        <label class="oee-ck"><input type="checkbox" checked=${C.setupPeloTakt} onChange=${(e) => def({ setupPeloTakt: e.target.checked })} /> Operador ATIVO no posto do Takt com a máquina quieta = setup</label>

        <h3>Motivos de parada</h3>
        ${C.motivos.map((m, i) => html`<div class="oee-motivo" key=${i}>
          <input type="text" aria-label="Motivo" value=${m.nome} onChange=${(e) => def({ motivos: C.motivos.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)) })} />
          <label class="oee-ck" title="Parada planejada: sai do tempo planejado"><input type="checkbox" checked=${m.planejada}
            onChange=${(e) => def({ motivos: C.motivos.map((x, j) => (j === i ? { ...x, planejada: e.target.checked } : x)) })} />planejada</label>
          <button class="oee-btn mini" aria-label=${`Remover ${m.nome}`} onClick=${() => def({ motivos: C.motivos.filter((_, j) => j !== i) })}>✕</button>
        </div>`)}
        <div class="oee-motivo">
          <input type="text" placeholder="novo motivo" aria-label="Novo motivo" value=${novoMotivo} onInput=${(e) => setNovoMotivo(e.target.value)} />
          <span></span>
          <button class="oee-btn mini" onClick=${() => { if (novoMotivo.trim()) { def({ motivos: [...C.motivos, { nome: novoMotivo.trim(), planejada: false }] }); setNovoMotivo(''); } }}>+</button>
        </div>
        <div class="oee-acoes"><button class="oee-btn" onClick=${() => def({ motivos: MOTIVOS_PADRAO.map((m) => ({ ...m })) }, 'Motivos padrão.')}>Motivos padrão</button></div>

        <h3>Turnos e pausas programadas</h3>
        <label class="oee-campo"><span>Fuso da planta</span><input type="text" value=${C.fuso} onChange=${(e) => {
          try { new Intl.DateTimeFormat('pt-BR', { timeZone: e.target.value }); def({ fuso: e.target.value }); } catch (_) { onMsg('Fuso inválido (ex.: America/Sao_Paulo).'); }
        }} /></label>
        ${C.turnos.length ? '' : html`<p class="oee-dica">Sem turnos cadastrados a máquina é medida sempre e o OEE é o da sessão.</p>`}
        ${C.turnos.map((t, i) => html`<div class="oee-turno" key=${i}>
          <div class="oee-turno-l">
            <input type="text" aria-label="Nome do turno" value=${t.nome} onChange=${(e) => turno(i, { nome: e.target.value })} />
            <input type="time" aria-label="Início" value=${t.inicio} onChange=${(e) => turno(i, { inicio: e.target.value })} />
            <input type="time" aria-label="Fim" value=${t.fim} onChange=${(e) => turno(i, { fim: e.target.value })} />
            <button class="oee-btn mini" aria-label=${`Remover o turno ${t.nome}`} onClick=${() => def({ turnos: C.turnos.filter((_, j) => j !== i) })}>✕</button>
          </div>
          <div class="oee-dias">${DIAS.map((d, k) => html`<label key=${k}><input type="checkbox" checked=${t.dias.includes(k)}
            onChange=${(e) => turno(i, { dias: e.target.checked ? [...t.dias, k].sort() : t.dias.filter((x) => x !== k) })} />${d}</label>`)}</div>
          <label class="oee-campo"><span>Pausas (09:00-09:10; 12:00-13:00)</span><input type="text" value=${pausasTxt(t)} onChange=${(e) => turno(i, { pausas: lerPausas(e.target.value) })} /></label>
        </div>`)}
        <div class="oee-acoes">
          <button class="oee-btn" onClick=${() => def({ turnos: [...C.turnos, { nome: String.fromCharCode(65 + C.turnos.length), inicio: '08:00', fim: '17:00', dias: [1, 2, 3, 4, 5], pausas: [['12:00', '13:00']] }] })}>+ Turno</button>
          <button class="oee-btn" onClick=${() => def({ turnos: TURNOS_EXEMPLO }, 'Modelo de 3 turnos aplicado.')}>Modelo 3 turnos</button>
          ${C.turnos.length > 0 && html`<button class="oee-btn" onClick=${() => def({ turnos: [] }, 'Sem turnos: mede sempre.')}>Sem turnos</button>`}
        </div>

        <h3>Alarme</h3>
        <label class="oee-campo"><span>Parada sem motivo por mais de (min; 0 = desligado)</span><input type="number" step="1" min="0" value=${C.alarmes.paradaMin}
          onChange=${(e) => def({ alarmes: { paradaMin: num(e.target.value) } })} /></label>

        <h3>Vídeo gravado</h3>
        <label class="oee-campo"><span>Início do 1º quadro (para turnos e pausas)</span><input type="datetime-local" step="1" value=${C.videoInicio}
          onChange=${(e) => def({ videoInicio: e.target.value }, 'Vale para o próximo vídeo aberto (ou Nova sessão).')} /></label>

        <h3>Arquivo</h3>
        <div class="oee-acoes">
          <button class="oee-btn" onClick=${() => baixar(motor.exportarConfig(), 'oee-config.json', 'application/json')}>Exportar configuração</button>
          <label class="oee-btn">Importar…<input type="file" accept="application/json,.json" class="oee-sr" onChange=${importar} /></label>
          <button class="oee-btn" onClick=${() => { if (confirm('Voltar a configuração do OEE ao padrão?')) def(normalizar({}), 'Configuração padrão.'); }}>Padrão</button>
        </div>
      </div>
    </aside>
  `;
}

export default StudioOEE;
