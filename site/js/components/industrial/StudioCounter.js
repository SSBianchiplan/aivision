/**
 * components/industrial/StudioCounter.js — a tela cheia "GPlanSiS|CounterVision"
 * (CV-38): a tela de operação do CounterVision no tema do iaVision (claro e
 * escuro; vídeo e gráfico no palco escuro, como o app).
 *
 *   Vídeo        o quadro que o pipeline recebe (recorte do zoom, espelho),
 *                nítido, com as linhas (seta = sentido "ida") e zonas das
 *                Ferramentas de mouse, peças, IDs e a máscara de cor. Clique =
 *                Calibrar cor (amostra a peça) ou Desenhar linha (dois cliques).
 *   Contagem     total grande, ida/volta, peças/min e /h, última peça, turno
 *                com meta, progresso e projeção para o fim do turno.
 *   Por minuto   barras dos últimos 30 minutos com a taxa da meta tracejada.
 *   Detector     motor (COR, YOLOX, RF-DETR, o seu .onnx), as cores amostradas
 *                (nome editável), tolerância e tamanho típico.
 *   Eventos      os recentes (hora, ID, sentido, classe, confiança), alarmes
 *                (reconhecer) e turnos; CSV e a fila guardada no navegador.
 *   Dataset      "Capturar quadro com caixas" → ZIP YOLO ou Treinar.
 *   Ajustes      meta, turnos, alarmes, sentido e base da contagem (os
 *                parâmetros do nó no Pipeline).
 *
 * A fonte é a do app; a barra de vídeo do app fica por cima desta tela.
 * Gancho de teste: window.aivCounter.
 */
import { confirmar } from '../dialogo.js';
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { getOperator, defaultParams } from '../../cv/registry.js';
import { zerarContagens, vista } from '../../cv/marcacoes.js';
import {
  instantaneo, assinar, definirStudio, recente, motorCor, motorEsteira, avisarAgora, csvEventos, csvJornal, csvTurnos,
} from '../../cv/runtime/livres-l/esteira.js';
import { amostraDeHex, hexDaAmostra } from '../../cv/runtime/livres-l/cor.js';
import { modeloGuardado, infoModelo, assinarModelo, esquecerModelo } from '../../cv/runtime/livres-l/onnx-local.js';
import {
  OP, fmt, carimbo, injetarCSS, CADEIAS, cadeiaAtual, ativarContador, paramsEsteira, definirParam, linhasDeContagem, criarLinha,
  criarLinhaPorPontos, desenharVideo, desenharMinutos, capturarQuadro, assinarDataset, listaDataset, limparDataset,
  removerDoDataset, zipYolo, baixarTexto, baixarBlob, abrirExemplo,
} from './counter-comum.js';
import { EnviarTreinoContador, EscolherOnnx } from './CounterPanel.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import { FerramentasStudio } from '../studio/FerramentasStudio.js';
import { BotaoVia } from '../../via/BotaoVia.js';   // [VIA] botão «✦ Via» da barra (js/via/)

const ROT_ESTADO = { ATIVO_NR: 'ativo, não reconhecido', ATIVO_R: 'ativo, reconhecido', RTN_NR: 'voltou ao normal' };
const corPrio = (p) => (p === 1 ? 'var(--cvs-p1)' : 'var(--cvs-p2)');

export function StudioCounter({ onClose, onResetState, onPickFile }) {
  injetarCSS();
  const nodes = useStore(store, (st) => st.nodes);
  const cadeia = cadeiaAtual(nodes);
  const no = nodes.find((n) => n.op === OP);
  const ativo = Boolean(no && no.enabled);
  const P = paramsEsteira(nodes);
  const noCor = nodes.find((n) => n.op === 'contagem.cor');
  const pCor = { ...defaultParams('contagem.cor'), ...(noCor ? noCor.params : {}) };
  const cor = motorCor();
  const M = motorEsteira();

  const [r, setR] = useState(() => instantaneo());
  const [modo, setModo] = useState('ver');
  const [mascara, setMascara] = useState(false);
  const [aba, setAba] = useState('eventos');
  const [msg, setMsgBruto] = useState('');
  const [nDs, setNDs] = useState(listaDataset().length);
  const [enviar, setEnviar] = useState(false);
  const [modelo, setModelo] = useState(infoModelo());
  const [, setV] = useState(0);
  const cvVid = useRef(null), cvMin = useRef(null);
  const tf = useRef(null);
  const rasc = useRef([]);
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 7000); }, []);

  useEffect(() => {
    definirStudio(true);
    document.body.classList.add('studio-aberto', 'cvs-aberto');
    return () => { definirStudio(false); document.body.classList.remove('studio-aberto', 'cvs-aberto', 'studio-ocioso'); };
  }, []);
  useEffect(() => assinar((x) => setR(x)), []);
  useEffect(() => assinarDataset((n) => setNDs(n)), []);
  useEffect(() => { modeloGuardado().then(() => setModelo(infoModelo())); return assinarModelo((i) => setModelo(i)); }, []);
  useEffect(() => { const t = setInterval(() => setV((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  /*
   * Vídeo só quando há QUADRO NOVO do app (contador do Viewport), retrato novo,
   * clique de calibração, tamanho ou tema — antes repintava a cada rAF (60/s)
   * com o vídeo a 30 q/s, e também com ele pausado. Gráfico só quando o retrato muda.
   */
  useEffect(() => {
    let id = 0, ultMin = '', ultVid = '', ultRet = null;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const cv = cvVid.current;
      if (cv) {
        const ret = instantaneo();
        const chaveVid = `${vista.canvas ? vista.canvas.quadros | 0 : -1}|${vista.el ? 1 : 0}|${rasc.current.length}|${cv.clientWidth}x${cv.clientHeight}|${document.documentElement.getAttribute('data-theme')}`;
        if (chaveVid !== ultVid || ret !== ultRet) {
          ultVid = chaveVid; ultRet = ret;
          tf.current = desenharVideo(cv, { mascara, rascunho: rasc.current });
        }
      }
      const rr = instantaneo();
      const res = rr && rr.resumo;
      const chave = `${res ? res.minutos.length + ':' + (res.minutos.length ? res.minutos[res.minutos.length - 1].n : 0) : ''}|${P.meta}|${window.innerWidth}|${document.documentElement.getAttribute('data-theme')}`;
      if (cvMin.current && chave !== ultMin) {
        ultMin = chave;
        const turnoMin = res && res.turno ? (res.turno.fim - res.turno.inicio) / 60000 : 480;
        desenharMinutos(cvMin.current, res ? res.minutos : [], P.meta > 0 ? P.meta / turnoMin : 0);
      }
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [mascara, P.meta]);

  useEffect(() => {
    window.aivCounter = {
      cor, esteira: M, retrato: () => instantaneo(), ativar: (m) => ativarContador({ motor: m }), criarLinha,
      modo: setModo, capturar: () => capturarQuadro(), dataset: listaDataset, zip: zipYolo,
      abrirArquivo: (f) => onPickFile && onPickFile(f), abrirExemplo: () => abrirExemplo(onPickFile),
    };
    return () => { if (window.aivCounter && window.aivCounter.esteira === M) delete window.aivCounter; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'Escape' && fonteStudioAberta()) return;   // o popover da Fonte fecha primeiro
      if (e.key === 'Escape') { e.stopPropagation(); if (modo !== 'ver') { setModo('ver'); rasc.current = []; } else onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [modo, onClose]);

  // ---------------------------------------------------- clique no vídeo
  const noQuadro = (e) => {
    const T = tf.current, cv = cvVid.current;
    if (!T || !cv) return null;
    const rc = cv.getBoundingClientRect();
    const x = ((e.clientX - rc.left) * T.dpr - T.ox) / T.dw, y = ((e.clientY - rc.top) * T.dpr - T.oy) / T.dh;
    return x < 0 || y < 0 || x > 1 || y > 1 ? null : [x, y];
  };
  const clique = (e) => {
    const p = noQuadro(e);
    if (!p) return;
    if (modo === 'cor') {
      if (cadeia !== 'cor') { setMsg('Calibrar cor vale para o motor COR: escolha "Motor COR" em Detector.'); return; }
      const a = cor.amostrar(p[0], p[1]);
      if (typeof a === 'string') { setMsg(a); return; }
      cor.adicionar(a); setV((n) => n + 1);
      setMsg(`Amostra "${a.nome}": matiz ${Math.round(a.h)}° ± ${Math.round(a.hs)}°, saturação ≥ ${a.smin.toFixed(2)}. Clique em outras peças (luz diferente) para cobrir a variação.`);
    } else if (modo === 'linha') {
      if (!rasc.current.length) { rasc.current = [p]; setMsg('Agora o segundo ponto da linha.'); return; }
      criarLinhaPorPontos(rasc.current[0], p); rasc.current = []; setModo('ver');
      setMsg('Linha criada. A seta mostra o sentido "ida"; inverta pelas Ferramentas de mouse se precisar.');
    }
  };

  const res = r && r.resumo;
  const vivo = recente(3000);
  const linhas = linhasDeContagem();
  const ativos = res ? res.alarmes : [];
  const semPeca = res && res.tUltima != null ? res.tb - res.tUltima : null;
  const csvFila = async () => {
    try { const l = await M.fila.todos(); baixarTexto(`contagem_eventos_${carimbo()}.csv`, csvEventos(l), 'text/csv'); setMsg(`${l.length} eventos exportados.`); }
    catch (e) { setMsg('Não consegui ler a fila: ' + e.message); }
  };
  const capturar = async () => {
    try { const q = await capturarQuadro(); setMsg(`Quadro capturado com ${q.caixas.length} caixa(s) (formato YOLO). ${listaDataset().length} no dataset.`); }
    catch (e) { setMsg(e.message); }
  };
  const motorSel = (m) => { const x = ativarContador({ motor: m, painel: false }); onResetState && onResetState(); setMsg(`${CADEIAS[m].rotulo}: cadeia ${x} no Pipeline.`); };
  const param = (k) => (e) => {
    const s = getOperator(OP).params[k];
    const v = s.type === 'text' ? e.target.value : s.type === 'enum' ? e.target.value : Number(e.target.value);
    definirParam(OP, k, v);
  };

  return html`
    <div class="cvs" role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|CounterVision">
      <div class="cvs-barra">
        <b class="cvs-titulo"><span class="cvs-marca">iaVision</span> <span class="cvs-gp">GPlanSiS<i>|</i></span>CounterVision</b>
        <${FonteStudio} classeBotao="cvs-btn" />
        <${FerramentasStudio} classeBotao="cvs-btn" alvo=${cvVid} transformacao=${() => tf.current} />
        <select class="cvs-btn" aria-label="Detector" value=${cadeia && cadeia !== 'outro' ? cadeia : ''} onChange=${(e) => motorSel(e.target.value)}>
          ${!cadeia && html`<option value="">Escolha o detector…</option>`}
          ${cadeia === 'outro' && html`<option value="">Cadeia própria</option>`}
          ${Object.entries(CADEIAS).map(([k, c]) => html`<option key=${k} value=${k}>${c.rotulo}</option>`)}
        </select>
        <span class="cvs-estado ${ativos.some((a) => a.estado === 'ATIVO_NR' || a.estado === 'ATIVO_R') ? 'al' : vivo ? 'on' : ''}">${!ativo ? 'FORA DO PIPELINE' : !vivo ? 'SEM IMAGEM' : ativos.some((a) => a.estado !== 'RTN_NR') ? ativos.find((a) => a.estado !== 'RTN_NR').tag : 'CONTANDO'}</span>
        <button class="cvs-btn" title="Vídeo sintético de esteira com peças coloridas, motor COR e linha no meio" onClick=${async () => {
          try { await abrirExemplo(onPickFile); onResetState && onResetState(); setMsg('Exemplo aberto: motor COR com vermelho, verde e azul; linha vertical no meio.'); } catch (e) { setMsg(e.message); } }}>Abrir exemplo</button>
        <span class="cvs-msg" role="status" aria-live="polite">${msg}</span>
        <${BotaoVia} modulo="contador" classe="cvs-btn" />
        <button class="cvs-btn cvs-fechar" onClick=${onClose} aria-label="Fechar a tela CounterVision">✕</button>
      </div>

      ${(!ativo || (ativo && !linhas.length && !(r && r.temZona))) && html`
        <div class="cvs-avisos">
          ${!ativo && html`<div class="cvs-aviso">A contagem não está no Pipeline.
            <button class="cvs-btn" onClick=${() => motorSel('cor')}>Motor COR</button>
            <button class="cvs-btn" onClick=${() => motorSel('yolox')}>Detector YOLOX + rastreio</button></div>`}
          ${ativo && !linhas.length && !(r && r.temZona) && html`<div class="cvs-aviso">Falta a linha de contagem.
            <button class="cvs-btn" onClick=${() => { criarLinha('vertical'); setMsg('Linha vertical criada: peças da esquerda para a direita contam como "ida".'); }}>Linha vertical no meio</button>
            <button class="cvs-btn" onClick=${() => { criarLinha('horizontal'); setMsg('Linha horizontal criada: de cima para baixo = "ida".'); }}>Linha horizontal</button>
            <button class="cvs-btn" onClick=${() => { setModo('linha'); rasc.current = []; setMsg('Clique no primeiro ponto da linha.'); }}>Desenhar (2 cliques)</button></div>`}
        </div>`}

      <div class="cvs-grade">
        <section class="cvs-p cvs-vid">
          <h2>Esteira <small>${r ? `${r.W}×${r.H} no pipeline` : ''}${modo === 'cor' ? ' · clique numa peça para amostrar a cor' : modo === 'linha' ? ' · clique nos dois pontos da linha' : ''}</small></h2>
          <canvas ref=${cvVid} class="cvs-cv-vid ${modo !== 'ver' ? 'mira' : ''}" onPointerDown=${clique}
            aria-label="Vídeo com a linha de contagem, as zonas, as peças e os IDs"></canvas>
          <div class="cvs-acoes">
            <span class="cvs-seg" role="group" aria-label="O clique no vídeo">
              ${[['ver', 'Ver'], ['cor', 'Calibrar cor'], ['linha', 'Desenhar linha']].map(([k, t]) => html`<button key=${k} class=${modo === k ? 'on' : ''} aria-pressed=${modo === k}
                onClick=${() => { setModo(k); rasc.current = []; if (k === 'cor') setMsg('Clique no centro de uma peça isolada.'); }}>${t}</button>`)}
            </span>
            <button class="cvs-btn" onClick=${() => { criarLinha('vertical'); setMsg('Linha vertical no meio criada.'); }}>Linha no meio</button>
            <button class="cvs-btn ${mascara ? 'on' : ''}" aria-pressed=${mascara} onClick=${() => setMascara(!mascara)}>Máscara de cor</button>
            <button class="cvs-btn acento" onClick=${capturar} disabled=${!vivo}>Capturar quadro com caixas</button>
            <button class="cvs-btn" onClick=${async () => { if (await confirmar('Zerar a contagem desta sessão? (o total por turno e a fila guardada ficam)', { titulo: 'Zerar contagem', ok: 'Zerar', perigo: true })) { M.zerar(); zerarContagens(); avisarAgora(); setMsg('Contagem zerada.'); } }}>Zerar</button>
          </div>
        </section>

        <section class="cvs-p cvs-tot">
          <h2>Contagem <small>${res ? `por ${P.base === 'automático' ? (r.temLinha ? 'linha' : 'zona') : P.base} · ${P.sentido}` : ''}</small></h2>
          <div class="cvs-grande" aria-live="polite"><b>${res ? res.total : 0}</b><em>peças</em></div>
          <div class="cvs-kpis">
            <div class="cvs-kpi"><b>${res ? res.ida : 0}</b><em>ida →</em></div>
            <div class="cvs-kpi"><b>${res ? res.volta : 0}</b><em>← volta</em></div>
            <div class="cvs-kpi"><b>${res ? fmt(res.taxa, 1) : '—'}</b><em>peças/min (${P.janelaS} s)</em></div>
            <div class="cvs-kpi"><b>${res ? fmt(res.taxaH, 0) : '—'}</b><em>peças/h</em></div>
            <div class="cvs-kpi"><b>${semPeca == null ? '—' : fmt(semPeca, 0) + ' s'}</b><em>desde a última</em></div>
            <div class="cvs-kpi"><b>${res ? Object.keys(res.porClasse).length : 0}</b><em>classes</em></div>
          </div>
          ${res && Object.keys(res.porClasse).length > 0 && html`<div class="cvs-classes">
            ${Object.entries(res.porClasse).sort((a, b) => b[1] - a[1]).map(([c, n]) => html`<span key=${c}><i>${c}</i> <b>${n}</b></span>`)}
          </div>`}
          <div class="cvs-turno">
            <div class="cvs-turno-l"><b>Turno ${res ? res.turno.rotulo : '—'}</b>
              <span>${res ? res.totalTurno : 0}${P.meta ? ` de ${P.meta}` : ''} peças${res && res.projecao != null && P.meta ? ` · projeção ${res.projecao}` : ''}${res ? ` · faltam ${fmt(res.restanteMin, 0)} min` : ''}</span></div>
            ${P.meta > 0 && html`<div class="cvs-barra-meta" role="progressbar" aria-valuemin="0" aria-valuemax=${P.meta} aria-valuenow=${res ? res.totalTurno : 0}>
              <span style=${{ width: `${Math.min(100, (res ? res.pctMeta : 0) * 100)}%` }} class=${res && res.projecao != null && res.projecao < P.meta ? 'abaixo' : ''}></span>
              <em>${fmt((res ? res.pctMeta : 0) * 100, 0)} %</em></div>`}
            ${!P.meta && html`<p class="cvs-dica">Sem meta: defina em Ajustes (peças por turno).</p>`}
          </div>
        </section>

        <section class="cvs-p cvs-min">
          <h2>Peças por minuto <small>${P.meta ? 'tracejado = ritmo da meta' : 'últimos 30 min'}</small></h2>
          <canvas ref=${cvMin} class="cvs-cv-min" aria-label="Gráfico de peças por minuto"></canvas>
        </section>

        <section class="cvs-p cvs-ev">
          <h2>
            <span class="cvs-seg">
              ${[['eventos', 'Eventos'], ['alarmes', `Alarmes${ativos.length ? ` (${ativos.length})` : ''}`], ['turnos', 'Turnos']].map(([k, t]) => html`<button key=${k}
                class=${aba === k ? 'on' : ''} aria-pressed=${aba === k} onClick=${() => setAba(k)}>${t}</button>`)}
            </span>
            ${aba === 'alarmes' && html`<button class="cvs-btn" onClick=${() => { M.reconhecer(); avisarAgora(); setV((n) => n + 1); setMsg('Alarmes reconhecidos.'); }}>Reconhecer</button>`}
          </h2>
          ${aba === 'eventos' && html`
            <div class="cvs-acoes">
              <button class="cvs-btn" onClick=${csvFila}>CSV (fila: ${res ? res.guardados : M.fila.guardados})</button>
              <button class="cvs-btn" onClick=${() => baixarTexto(`contagem_sessao_${carimbo()}.csv`, csvEventos(M.eventos), 'text/csv')}>CSV da sessão</button>
              <button class="cvs-btn" onClick=${async () => { if (!(await confirmar('Esvaziar a fila guardada neste navegador? Exporte antes.', { titulo: 'Esvaziar fila', ok: 'Esvaziar fila', perigo: true }))) return; await M.fila.esvaziar(); setV((n) => n + 1); setMsg('Fila esvaziada.'); }}>Esvaziar fila</button>
            </div>
            ${res && res.erroFila && html`<p class="cvs-dica" style=${{ color: 'var(--cvs-p1)' }}>Fila: ${res.erroFila}</p>`}
            <div class="cvs-tab"><table><thead><tr><th>#</th><th>Hora</th><th>t (s)</th><th>Marcação</th><th>ID</th><th>Sentido</th><th>Classe</th><th>Conf.</th></tr></thead><tbody>
              ${res && res.eventos.length ? res.eventos.slice(-60).reverse().map((e) => html`<tr key=${e.n} class=${e.delta < 0 ? 'neg' : ''}>
                <td>${e.n}</td><td>${e.hora.slice(11, 19)}</td><td>${fmt(e.t, 1)}</td><td>${e.marcacao}</td><td>${e.id === '' ? '—' : '#' + e.id}</td>
                <td>${e.sentido}</td><td>${e.classe}</td><td>${e.confianca === '' ? '—' : fmt(e.confianca, 2)}</td></tr>`)
                : html`<tr><td colspan="8">Nenhuma peça contada ainda.</td></tr>`}
            </tbody></table></div>`}
          ${aba === 'alarmes' && html`
            <ul class="cvs-alarmes">
              ${ativos.length ? ativos.map((a) => html`<li key=${a.tag} class=${`p${a.prio} ${a.estado === 'ATIVO_NR' ? 'nr' : ''} ${a.estado === 'RTN_NR' ? 'rtn' : ''}`}>
                <b style=${{ color: corPrio(a.prio) }}>P${a.prio}</b><b>${a.tag}</b>
                <span>${a.texto}${a.valor != null ? `: ${fmt(a.valor, 1)}${a.tag === 'PARADA' ? ' s' : ' /min'}` : ''} · ${ROT_ESTADO[a.estado]}</span>
                <span class="cvs-act">${a.acao}</span></li>`)
                : html`<li class="vazio">Nenhum alarme ativo. Parada após ${P.paradaS || '—'} s sem peça${P.taxaMin ? ` · taxa mínima ${P.taxaMin}/min` : ''}${P.taxaMax ? ` · máxima ${P.taxaMax}/min` : ''}.</li>`}
            </ul>
            <div class="cvs-acoes"><button class="cvs-btn" onClick=${() => baixarTexto(`contagem_alarmes_${carimbo()}.csv`, csvJornal(M.jornal), 'text/csv')}>Histórico CSV</button></div>
            <div class="cvs-tab"><table><thead><tr><th>Hora</th><th>Tag</th><th>Evento</th><th>Valor</th></tr></thead><tbody>
              ${M.jornal.length ? M.jornal.slice(0, 80).map((e, i) => html`<tr key=${i}><td>${e.hora.slice(11, 19)}</td><td><b>${e.tag}</b></td><td>${e.ev}</td><td>${e.valor == null ? '' : fmt(e.valor, 1)}</td></tr>`)
                : html`<tr><td colspan="4">Nenhum evento de alarme.</td></tr>`}
            </tbody></table></div>`}
          ${aba === 'turnos' && html`
            <div class="cvs-acoes"><button class="cvs-btn" onClick=${() => baixarTexto(`contagem_turnos_${carimbo()}.csv`, csvTurnos(M.historicoTurnos(), P.meta), 'text/csv')}>Turnos CSV</button></div>
            <div class="cvs-tab"><table><thead><tr><th>Turno</th><th>Total</th><th>Ida</th><th>Volta</th><th>Meta</th></tr></thead><tbody>
              ${M.historicoTurnos().length ? M.historicoTurnos().slice(0, 40).map((t) => html`<tr key=${t.chave}><td>${t.chave}</td><td><b>${t.total}</b></td><td>${t.ida || 0}</td><td>${t.volta || 0}</td>
                <td>${P.meta ? fmt((t.total / P.meta) * 100, 0) + ' %' : '—'}</td></tr>`) : html`<tr><td colspan="5">Nenhum turno registrado.</td></tr>`}
            </tbody></table></div>`}
        </section>

        <section class="cvs-p cvs-det">
          <h2>Detector <small>${cadeia ? (CADEIAS[cadeia] ? CADEIAS[cadeia].rotulo : 'cadeia própria') : 'fora do Pipeline'}</small></h2>
          ${cadeia === 'cor' && html`
            <ul class="cvs-cores">
              ${cor.amostras.map((a, i) => html`<li key=${i}>
                <span class="cvs-sw" style=${{ background: hexDaAmostra(a) }}></span>
                <input class="cvs-nome" aria-label="Nome da cor" value=${a.nome} onChange=${(e) => { cor.renomear(i, e.target.value); setV((n) => n + 1); }} />
                <span class="cvs-dica">${Math.round(a.h)}° ± ${Math.round(a.hs)}° · sat ≥ ${a.smin.toFixed(2)}${a.area ? ' · tamanho ✓' : ''}</span>
                <button class="cvs-btn" aria-label=${'Apagar a amostra ' + a.nome} onClick=${() => { cor.remover(i); setV((n) => n + 1); }}>✕</button></li>`)}
              ${!cor.amostras.length && html`<li class="vazio">Nenhuma cor. Use <b>Calibrar cor</b> e clique numa peça, ou escolha abaixo.</li>`}
            </ul>
            <div class="cvs-acoes">
              <label class="cvs-btn">Adicionar cor… <input type="color" class="cvs-sr" onChange=${(e) => { const a = amostraDeHex(e.target.value); if (typeof a === 'string') setMsg(a); else { cor.adicionar(a); setV((n) => n + 1); setMsg(`Cor "${a.nome}" adicionada (sem tamanho típico: o tamanho sai das peças vistas).`); } }} /></label>
              <button class="cvs-btn" onClick=${async () => { if (await confirmar('Apagar todas as cores?', { titulo: 'Limpar cores', ok: 'Apagar cores', cancelar: 'Manter', perigo: true })) { cor.limpar(); setV((n) => n + 1); } }} disabled=${!cor.amostras.length}>Limpar cores</button>
            </div>
            <label class="cvs-campo"><span>Tolerância de cor <em>+${pCor.tol}°</em></span>
              <input type="range" min="0" max="40" step="1" value=${pCor.tol} onInput=${(e) => definirParam('contagem.cor', 'tol', Number(e.target.value))} /></label>
            <label class="cvs-campo"><span>Tamanho típico <em>${Math.round(pCor.tamMul * 100)} %</em></span>
              <input type="range" min="0.4" max="2.5" step="0.05" value=${pCor.tamMul} onInput=${(e) => definirParam('contagem.cor', 'tamMul', Number(e.target.value))} /></label>
            <label class="cvs-check"><input type="checkbox" checked=${pCor.separar} onChange=${(e) => definirParam('contagem.cor', 'separar', e.target.checked)} /> Separar peças encostadas (k-means pela área típica)</label>`}
          ${cadeia === 'onnx' && html`
            <p class="cvs-dica">${modelo ? `Modelo: ${modelo.nome} · ${modelo.imgsz} px · ${modelo.classes.length || '?'} classes · ${fmt(modelo.bytes / 1e6, 1)} MB (neste navegador)` : 'Nenhum .onnx escolhido.'}</p>
            <${EscolherOnnx} onMsg=${setMsg} />
            ${modelo && html`<button class="cvs-btn" onClick=${() => esquecerModelo()}>Esquecer o modelo</button>`}`}
          ${(cadeia === 'yolox' || cadeia === 'rfdetr') && html`<p class="cvs-dica">Detector livre do iaVision + Tracking com IDs (ByteTrack). Ajuste a confiança e as classes no Pipeline;
            para contar só uma classe, escreva-a em Zonas e linhas › Só estas classes.</p>`}
          ${!cadeia && html`<p class="cvs-dica">Escolha o detector na barra acima.</p>`}
        </section>

        <section class="cvs-p cvs-ds">
          <h2>Dataset <small>${nDs} quadro(s) com caixas YOLO</small></h2>
          <p class="cvs-dica">"Capturar quadro com caixas" guarda o quadro com as caixas atuais (as do motor COR ou do detector) para treinar um detector próprio no <b>Treinar</b>.</p>
          ${nDs > 0 && html`<div class="cvs-grade-ds">
            ${listaDataset().slice(-12).map((q) => html`<figure key=${q.id} title=${q.nome}><img src=${q.url} alt="" /><figcaption>${q.caixas.length} cx</figcaption>
              <button class="cvs-x" aria-label="Remover quadro" onClick=${() => removerDoDataset(q.id)}>×</button></figure>`)}
          </div>`}
          <div class="cvs-acoes">
            <button class="cvs-btn" disabled=${!nDs} onClick=${async () => baixarBlob(await zipYolo(), `contagem_dataset_yolo_${carimbo()}.zip`)}>Baixar ZIP YOLO</button>
            <button class="cvs-btn acento" disabled=${!nDs} onClick=${() => setEnviar(!enviar)}>Enviar ao Treinar</button>
            <button class="cvs-btn" disabled=${!nDs} onClick=${async () => { if (await confirmar('Descartar os quadros capturados?', { titulo: 'Descartar quadros', ok: 'Descartar', cancelar: 'Manter', perigo: true })) limparDataset(); }}>Limpar</button>
          </div>
          ${enviar && nDs > 0 && html`<${EnviarTreinoContador} onFechar=${() => setEnviar(false)} />`}
        </section>

        <section class="cvs-p cvs-aj">
          <h2>Ajustes <small>parâmetros do nó no Pipeline</small></h2>
          ${!no ? html`<p class="cvs-dica">Ponha a contagem no Pipeline para ajustar.</p>` : html`
            <div class="cvs-form">
              <label>Meta por turno (peças)<input type="number" min="0" step="10" value=${P.meta} onChange=${param('meta')} /></label>
              <label>Janela da taxa (s)<input type="number" min="10" max="600" step="10" value=${P.janelaS} onChange=${param('janelaS')} /></label>
              <label>Parada após (s sem peça)<input type="number" min="0" max="3600" step="5" value=${P.paradaS} onChange=${param('paradaS')} /></label>
              <label>Taxa mínima (/min)<input type="number" min="0" step="1" value=${P.taxaMin} onChange=${param('taxaMin')} /></label>
              <label>Taxa máxima (/min)<input type="number" min="0" step="1" value=${P.taxaMax} onChange=${param('taxaMax')} /></label>
              <label>Contar por<select value=${P.base} onChange=${param('base')}>${getOperator(OP).params.base.options.map((o) => html`<option key=${o}>${o}</option>`)}</select></label>
              <label>Sentido (linhas)<select value=${P.sentido} onChange=${param('sentido')}>${getOperator(OP).params.sentido.options.map((o) => html`<option key=${o}>${o}</option>`)}</select></label>
              <label class="larga">Turnos<input type="text" value=${P.turnos} onChange=${param('turnos')} /></label>
            </div>`}
        </section>
      </div>
    </div>
  `;
}

export default StudioCounter;
