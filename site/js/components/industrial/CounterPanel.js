/**
 * components/industrial/CounterPanel.js — painel "Contagem em esteira" (CV-38).
 *
 * Conduz e resume a contagem do GPlanSiS|CounterVision: põe a cadeia no
 * Pipeline (motor COR, YOLOX/RF-DETR + rastreio ou o seu .onnx), cria a linha
 * de contagem, mostra total, taxa e o turno com a meta, as cores amostradas,
 * os alarmes, exporta CSV e captura quadros com caixas para o Treinar. A
 * operação completa está na tela cheia GPlanSiS|CounterVision (StudioCounter.js).
 */
import { html, useState, useEffect } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { instantaneo, assinar, recente, motorCor, motorEsteira, avisarAgora, studioAberto, csvEventos } from '../../cv/runtime/livres-l/esteira.js';
import { amostraDeHex, hexDaAmostra } from '../../cv/runtime/livres-l/cor.js';
import { guardarModelo, modeloGuardado, infoModelo, assinarModelo } from '../../cv/runtime/livres-l/onnx-local.js';
import {
  OP, fmt, carimbo, injetarCSS, CADEIAS, cadeiaAtual, ativarContador, paramsEsteira, linhasDeContagem, criarLinha,
  capturarQuadro, assinarDataset, listaDataset, apiTreino, lerToken, gravarToken, enviarAoTreinar, classesDoDataset, baixarTexto, abrirExemplo,
} from './counter-comum.js';

export function CounterPanel({ onClose, onPickFile, ...layout }) {
  injetarCSS();
  const nodes = useStore(store, (st) => st.nodes);
  const cadeia = cadeiaAtual(nodes);
  const no = nodes.find((n) => n.op === OP);
  const P = paramsEsteira(nodes);
  const cor = motorCor();
  const M = motorEsteira();
  const [r, setR] = useState(() => instantaneo());
  const [aviso, setAviso] = useState('');
  const [nDs, setNDs] = useState(listaDataset().length);
  const [enviar, setEnviar] = useState(false);
  const [modelo, setModelo] = useState(infoModelo());
  const [, setV] = useState(0);
  // com a tela cheia aberta por cima, o painel não se redesenha
  useEffect(() => assinar((x) => { if (!studioAberto()) setR(x); }), []);
  useEffect(() => assinarDataset((n) => setNDs(n)), []);
  useEffect(() => { modeloGuardado().then(() => setModelo(infoModelo())); return assinarModelo((i) => setModelo(i)); }, []);

  const msg = (t) => { setAviso(t); setTimeout(() => setAviso(''), 6000); };
  const res = r && r.resumo;
  const vivo = recente(3000);
  const linhas = linhasDeContagem();
  const ativos = res ? res.alarmes : [];

  return html`
    <${Panel} id="contador" title="Contagem em esteira" subtitle=${vivo && res ? `${res.total} peças · ${fmt(res.taxa, 1)}/min` : 'CounterVision'}
              onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">Conta peças na esteira pela câmera, no seu aparelho: motor <b>COR</b> (sem modelo — clique numa peça
        para amostrar a cor) ou um <b>detector</b> + rastreio. A contagem usa a linha das Ferramentas de mouse.</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó de contagem está desligado no Pipeline.</p>`}
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn accent" onClick=${() => { ativarContador(); store.set({ studioCounter: true }); }}
          title="Tela cheia: vídeo com a contagem, totais, taxa, gráfico por minuto, metas, eventos, alarmes e dataset">Abrir Studio CounterVision</button>
        <button class="btn" title="Vídeo sintético de esteira com peças coloridas, motor COR e linha no meio"
          onClick=${async () => { try { await abrirExemplo(onPickFile); msg('Exemplo aberto: motor COR, três cores, linha no meio.'); } catch (e) { msg(e.message); } }}>Abrir exemplo</button>
      </div>
      <label style=${{ display: 'block', margin: '10px 0 6px' }}><span class="ctl-label">Detector (cadeia no Pipeline)</span>
        <select class="cvp-sel" value=${cadeia && cadeia !== 'outro' ? cadeia : ''}
          onChange=${(e) => { const x = ativarContador({ motor: e.target.value, abrirPipeline: true }); msg(`${CADEIAS[e.target.value].rotulo}: cadeia ${x}.`); }}>
          <option value="" disabled>${cadeia === 'outro' ? 'cadeia própria' : 'escolha para pôr no Pipeline…'}</option>
          ${Object.entries(CADEIAS).map(([k, c]) => html`<option key=${k} value=${k}>${c.rotulo}</option>`)}
        </select></label>

      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      ${no && !linhas.length && !(r && r.temZona) && html`<div class="hint tight">Falta a linha de contagem.
        <div class="row tight" style=${{ gap: '5px', marginTop: '4px' }}>
          <button class="btn tiny" onClick=${() => { criarLinha('vertical'); msg('Linha vertical no meio: esquerda → direita = ida.'); }}>Linha vertical</button>
          <button class="btn tiny" onClick=${() => { criarLinha('horizontal'); msg('Linha horizontal no meio: cima → baixo = ida.'); }}>Linha horizontal</button>
        </div></div>`}
      ${no && !vivo && no.enabled && html`<p class="hint tight">Aguardando imagem: escolha a câmera, um arquivo ou o YouTube em <b>Fonte</b>.</p>`}

      <div class="kpis">
        <div class="kpi"><b>${res ? res.total : 0}</b><em>peças</em></div>
        <div class="kpi"><b>${res ? fmt(res.taxa, 1) : '—'}</b><em>peças/min</em></div>
        <div class="kpi"><b>${res ? res.totalTurno : 0}${P.meta ? '/' + P.meta : ''}</b><em>turno ${res ? res.turno.nome : ''}</em></div>
      </div>
      <p class="hint tight">ida ${res ? res.ida : 0} · volta ${res ? res.volta : 0} · ${res ? fmt(res.taxaH, 0) : '—'} peças/h${res && res.projecao != null && P.meta ? ` · projeção do turno ${res.projecao}` : ''}</p>

      ${cadeia === 'cor' && html`
        <div class="cfg-sub">Cores (motor COR)</div>
        <ul class="cvp-cores">
          ${cor.amostras.map((a, i) => html`<li key=${i}><span class="cvp-sw" style=${{ background: hexDaAmostra(a) }}></span>${a.nome}
            <em>${Math.round(a.h)}° ± ${Math.round(a.hs)}°</em><button class="btn tiny" aria-label=${'Apagar ' + a.nome} onClick=${() => { cor.remover(i); setV((n) => n + 1); }}>✕</button></li>`)}
          ${!cor.amostras.length && html`<li class="hint tight">Nenhuma cor: no Studio, <b>Calibrar cor</b> e clique numa peça; ou escolha a cor.</li>`}
        </ul>
        <label class="btn tiny">Adicionar cor… <input type="color" class="cvs-sr" onChange=${(e) => { const a = amostraDeHex(e.target.value); if (typeof a === 'string') msg(a); else { cor.adicionar(a); setV((n) => n + 1); msg(`Cor "${a.nome}" adicionada.`); } }} /></label>`}
      ${cadeia === 'onnx' && html`
        <div class="cfg-sub">Modelo ONNX</div>
        <p class="hint tight">${modelo ? `${modelo.nome} · ${modelo.imgsz} px · ${modelo.classes.length || '?'} classes` : 'Nenhum .onnx escolhido.'}</p>
        <${EscolherOnnx} onMsg=${msg} />`}

      <div class="cfg-sub" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Alarmes</span>
        <button class="btn tiny" onClick=${() => { M.reconhecer(); avisarAgora(); setV((n) => n + 1); }}>Reconhecer</button>
      </div>
      ${ativos.length ? html`<ul class="bsp-al">${ativos.map((a) => html`<li key=${a.tag} class=${a.estado === 'ATIVO_NR' ? 'nr' : ''}>
          <b style=${{ color: a.prio === 1 ? 'var(--danger, #ef4444)' : 'var(--warn)' }}>P${a.prio}</b> <b>${a.tag}</b> ${a.valor != null ? fmt(a.valor, 1) : ''} <em>${a.acao}</em></li>`)}</ul>`
        : html`<p class="hint tight">Nenhum alarme ativo.</p>`}

      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap', marginTop: '6px' }}>
        <button class="btn tiny" onClick=${async () => { const l = await M.fila.todos(); baixarTexto(`contagem_eventos_${carimbo()}.csv`, csvEventos(l), 'text/csv'); msg(`${l.length} eventos exportados.`); }}>CSV de eventos</button>
        <button class="btn tiny" disabled=${!vivo} onClick=${async () => { try { const q = await capturarQuadro(); msg(`Quadro com ${q.caixas.length} caixa(s) capturado.`); } catch (e) { msg(e.message); } }}>Capturar quadro com caixas</button>
        <button class="btn tiny" disabled=${!nDs} onClick=${() => setEnviar(!enviar)}>Enviar ${nDs} ao Treinar</button>
      </div>
      ${enviar && nDs > 0 && html`<${EnviarTreinoContador} onFechar=${() => setEnviar(false)} />`}
      <p class="hint tight">Fila guardada neste navegador: ${res ? res.guardados : M.fila.guardados} eventos.</p>
    <//>
  `;
}

/** Escolher o .onnx do usuário (fica neste navegador). */
export function EscolherOnnx({ onMsg }) {
  const [imgsz, setImgsz] = useState(640);
  const [classes, setClasses] = useState('');
  const [busy, setBusy] = useState(false);
  return html`
    <div class="cvs-onnx">
      <label>Entrada (px)<input type="number" min="160" max="1280" step="32" value=${imgsz} onInput=${(e) => setImgsz(Number(e.target.value) || 640)} /></label>
      <label>Classes (vírgula)<input type="text" placeholder="peça, defeito" value=${classes} onInput=${(e) => setClasses(e.target.value)} /></label>
      <label class="btn tiny ${busy ? '' : 'accent'}">${busy ? 'Guardando…' : 'Escolher .onnx'}
        <input type="file" accept=".onnx" class="cvs-sr" disabled=${busy} onChange=${async (e) => {
          const f = e.target.files && e.target.files[0]; e.target.value = '';
          if (!f) return;
          setBusy(true);
          try { const i = await guardarModelo(f, { imgsz, classes }); onMsg && onMsg(`Modelo "${i.nome}" guardado neste navegador (${(i.bytes / 1e6).toFixed(1)} MB).`); }
          catch (err) { onMsg && onMsg('Não consegui guardar: ' + err.message); }
          setBusy(false);
        }} /></label>
      <p class="hint tight">Saída [1,N,6] fim a fim ou [1,4+C,N] estilo YOLO. Pesos derivados do Ultralytics são AGPL-3.0: a licença do modelo é sua.</p>
    </div>
  `;
}

/** Enviar os quadros capturados (com caixas) a um projeto detector do Treinar. */
export function EnviarTreinoContador({ onFechar }) {
  const [token, setToken] = useState(lerToken);
  const [senha, setSenha] = useState('');
  const [projetos, setProjetos] = useState(null);
  const [pid, setPid] = useState('');
  const [msgT, setMsgT] = useState(null);
  const [busy, setBusy] = useState(false);
  const lista = listaDataset();
  const sair = (m) => { gravarToken(''); setToken(''); setProjetos(null); setMsgT(m || null); };

  useEffect(() => {
    if (!token) return undefined;
    let vivo = true;
    apiTreino('/projetos', token).then((ps) => {
      if (!vivo) return;
      const det = (ps || []).filter((p) => p.tipo !== 'anomalia');
      setProjetos(det);
      if (det.length && !det.some((p) => p.id === pid)) setPid(det[0].id);
    }).catch((e) => { if (vivo) (e.status === 401 ? sair('Sessão do Treinar expirou. Entre de novo.') : setMsgT(e.message)); });
    return () => { vivo = false; };
  }, [token]);

  const entrar = async (e) => {
    e.preventDefault(); setBusy(true); setMsgT(null);
    try { const r = await apiTreino('/entrar', '', { method: 'POST', body: JSON.stringify({ senha }) }); gravarToken(r.token); setToken(r.token); setSenha(''); }
    catch (err) { setMsgT(err.status === 401 ? 'Senha incorreta.' : err.message); }
    finally { setBusy(false); }
  };
  const proj = projetos && projetos.find((p) => p.id === pid);
  const enviarTudo = async () => {
    if (!proj) return;
    setBusy(true); setMsgT(null);
    try {
      const r = await enviarAoTreinar(proj, token, lista, (i, n) => setMsgT(`Enviando ${i} de ${n}…`));
      setMsgT(`${r.ok} quadro(s) e ${r.caixas} caixa(s) enviados para «${proj.nome}»` +
        (r.novasClasses.length ? `; classes novas: ${r.novasClasses.join(', ')}` : '') +
        (r.erros.length ? `. Erros: ${r.erros.slice(0, 2).join('; ')}` : '. Revise as caixas no Treinar antes de treinar.'));
    } catch (err) {
      if (err.status === 401) sair('Sessão do Treinar expirou. Entre de novo.'); else setMsgT('Falhou: ' + err.message);
    } finally { setBusy(false); }
  };

  return html`
    <div class="yt-treino cvp-treino">
      <div class="yt-treino-cab">
        <b>Enviar ${lista.length} quadro(s) com caixas ao Treinar</b>
        <button class="yt-x" aria-label="Fechar" onClick=${onFechar}>×</button>
      </div>
      <p class="hint tight">Classes: ${classesDoDataset(lista).join(', ') || '(sem caixas: exemplos negativos)'}</p>
      ${!token ? html`
        <form class="yt-busca" onSubmit=${entrar}>
          <input type="password" placeholder="Senha do Treinar" value=${senha} autocomplete="current-password" aria-label="Senha do Treinar"
                 onInput=${(e) => setSenha(e.target.value)} />
          <button class="btn accent" type="submit" disabled=${busy || !senha}>Entrar</button>
        </form>`
        : !projetos ? html`<p class="hint tight">Carregando projetos…</p>`
        : projetos.length === 0 ? html`<p class="hint tight">Nenhum projeto detector. Crie um no menu <b>Treinar</b>.</p>`
        : html`
          <label class="ctl"><span class="ctl-label">Projeto (detector)</span>
            <select value=${pid} onChange=${(e) => setPid(e.target.value)}>
              ${projetos.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome} — ${(p.classes || []).length} classes</option>`)}
            </select></label>
          <div class="row">
            <button class="btn accent" disabled=${busy || !proj} onClick=${enviarTudo}>${busy ? 'Enviando…' : 'Enviar com as caixas'}</button>
            <button class="btn" disabled=${busy} onClick=${() => sair()}>Sair do Treinar</button>
          </div>`}
      ${msgT && html`<p class="hint tight yt-msg" role="status">${msgT}</p>`}
    </div>
  `;
}

export default CounterPanel;
