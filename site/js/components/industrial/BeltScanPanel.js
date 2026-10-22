/**
 * components/industrial/BeltScanPanel.js — painel "BeltScan" (CV-36).
 *
 * O operador beltscan.volumetria mede; este painel conduz e resume: perfil
 * (ensaio ou linha), ensaios gravados, pôr no Pipeline, referência,
 * calibração, os números principais (bancada e correia), a seção da calha em
 * miniatura e os alarmes ativos com reconhecer. A configuração completa e os
 * gráficos estão na tela cheia GPlanSiS|BeltScan (StudioBeltScan.js).
 */
import { html, useState, useEffect, useRef } from '../../vendor.js';
import { Panel } from '../Panel.js';
import { useStore, store } from '../../state/store.js';
import { ENSAIOS } from '../../cv/runtime/livres-k/beltscan.js';
import {
  obterMotor, assinar, avisarAgora, recente, salvarSeMudou, listaPerfis, perfilAtivo, trocarPerfil, studioAberto, instantaneo,
} from '../../cv/runtime/livres-k/canal.js';
import {
  OP, fmt, COR_Q, corPrio, ativarBeltScan, abrirEnsaioNoApp, desenharCorreia, abrirStudioBeltScan, mostrarSecaoCorreia, editarNaImagem,
} from './beltscan-comum.js';
import { marcStore } from '../../cv/marcacoes.js';
import { editando as editandoNaImagem, concluirEdicao } from '../../cv/runtime/livres-k/beltscan-marcas.js';

export function BeltScanPanel({ onClose, onPickFile, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const naImagem = useStore(marcStore, (st) => editandoNaImagem(st));
  const motor = obterMotor();
  const [r, setR] = useState(() => instantaneo());
  const [aviso, setAviso] = useState('');
  const [carregando, setCarregando] = useState('');
  const [, setV] = useState(0);
  const cv = useRef(null);
  // com a tela cheia aberta por cima, o painel não se redesenha
  useEffect(() => assinar((x) => { if (!studioAberto()) setR(x); }), []);
  useEffect(() => { if (cv.current) desenharCorreia(cv.current, r, motor); }, [r, motor.alteracoes]);

  const msg = (t) => { setAviso(t); setTimeout(() => setAviso(''), 5000); };
  const acao = (fn) => () => { const x = fn(); salvarSeMudou(); avisarAgora(); setV((n) => n + 1); msg(typeof x === 'string' ? x : motor.status); };
  const abrir = async (id) => {
    setCarregando(id);
    try { await abrirEnsaioNoApp(id, onPickFile); msg(motor.status); } catch (e) { msg('Não consegui abrir o ensaio: ' + e.message); }
    setCarregando('');
  };
  const b = (r && r.bench) || {};
  const q = r ? r.q : 'SEM REF';
  const vivo = recente(3000);
  const C = motor.C;
  const ativos = C.alarms.filter((a) => motor.alarm[a.tag] && motor.alarm[a.tag].state !== 'NORMAL').sort((x, y) => x.prio - y.prio);

  return html`
    <${Panel} id="beltscan" title="BeltScan" subtitle=${vivo ? `${q} · ${fmt(b.Q_b, 1)} cm³/s · ${fmt(r && r.Q, 0)} m³/h` : 'volumetria de correia'}
              onClose=${onClose} ...${layout}>
      ${!no && html`<p class="hint tight">A medição roda no operador <b>BeltScan</b> do Pipeline, em JS puro no seu aparelho
        (linha laser + triangulação; nenhum modelo, nada é enviado).</p>`}
      ${no && !no.enabled && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>O nó BeltScan está desligado no Pipeline.</p>`}
      <button class="btn accent bsp-studio" onClick=${() => abrirStudioBeltScan()}
        title="Tela cheia GPlanSiS|BeltScan: câmera, seção, perfil, tendência, indicadores, alarmes e Configurar">⛶ Abrir Studio BeltScan</button>
      <div class="row tight" style=${{ gap: '6px', flexWrap: 'wrap' }}>
        <button class="btn ${no && no.enabled ? '' : 'accent'}" onClick=${() => { const c = ativarBeltScan({ abrirPipeline: true }); msg(c ? 'BeltScan adicionado ao Pipeline.' : 'BeltScan ligado no Pipeline.'); }}>
          ${no ? (no.enabled ? 'No Pipeline ✓' : 'Ligar no Pipeline') : 'Adicionar ao Pipeline'}</button>
        <button class="btn" onClick=${() => { ativarBeltScan(); mostrarSecaoCorreia(); msg('Seção da correia aberta sobre o vídeo.'); }}
          title="Widget flutuante sobre o vídeo: seção da calha, LI-101, alarme e os números principais">Seção da correia</button>
        ${naImagem
          ? html`<button class="btn accent" onClick=${() => { concluirEdicao(); msg('Edição na imagem concluída.'); }} title="Concluir a edição na imagem (Enter)">✓ Concluir edição</button>`
          : html`<button class="btn" onClick=${() => msg(editarNaImagem())}
              title="Faixa de busca (azul), exclusões (hachurado vermelho) e faixa de velocidade (verde) como marcações sobre o vídeo, com alças">Editar na imagem</button>`}
      </div>

      <label style=${{ display: 'block', margin: '10px 0 6px' }}><span class="ctl-label">Perfil (configuração salva neste navegador)</span>
        <select class="bsp-sel" value=${perfilAtivo()} onChange=${async (e) => { await trocarPerfil(e.target.value); setV((n) => n + 1); msg('Perfil: ' + e.target.selectedOptions[0].text); }}>
          ${listaPerfis().map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
        </select></label>
      <div class="cfg-sub">Abrir ensaio gravado (vídeo + configuração)</div>
      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
        ${Object.entries(ENSAIOS).map(([id, e]) => html`<button key=${id} class="btn tiny" disabled=${Boolean(carregando)} title=${e.rotulo}
          onClick=${() => abrir(id)}>${carregando === id ? 'abrindo…' : id === 'bancada' ? 'Bancada' : 'Feijão ' + id.slice(-1)}</button>`)}
      </div>

      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}
      ${!vivo && no && no.enabled && html`<p class="hint tight">Aguardando imagem: abra um ensaio acima ou escolha a câmera, um arquivo ou o YouTube em <b>Fonte</b>.</p>`}

      <div class="kpis">
        <div class="kpi"><b>${fmt(b.A_b, 0)}</b><em>mm² seção</em></div>
        <div class="kpi"><b>${fmt(b.Q_b, 1)}</b><em>cm³/s</em></div>
        <div class="kpi"><b>${fmt(b.vol_b, 0)}</b><em>cm³ no ciclo</em></div>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${fmt(r && r.Q, 1)}</b><em>m³/h correia</em></div>
        <div class="kpi"><b>${fmt(r && r.mdry, 2)}</b><em>t/h seca</em></div>
        <div class="kpi"><b style=${{ color: COR_Q[q] }}>${q}</b><em>cob. ${r ? fmt(r.cov * 100, 0) : '—'} %</em></div>
      </div>
      <canvas ref=${cv} class="bsp-cv" aria-label="Seção da correia"></canvas>

      <div class="cfg-sub" style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span>Alarmes ${r && r.gate ? '· acima da altura limite' : ''}</span>
        <button class="btn tiny" onClick=${acao(() => { motor.reconhecer(); return 'Alarmes reconhecidos.'; })}>Reconhecer</button>
      </div>
      ${ativos.length ? html`<ul class="bsp-al">${ativos.map((a) => html`<li key=${a.tag} class=${motor.alarm[a.tag].state === 'ATIVO_NR' ? 'nr' : ''}>
          <b style=${{ color: corPrio(a.prio) }}>P${a.prio}</b> <b>${a.tag}</b> ${fmt(motor.alarm[a.tag].val, 1)} <em>${a.act}</em></li>`)}</ul>`
        : html`<p class="hint tight">Nenhum alarme ativo.</p>`}

      <div class="row tight" style=${{ gap: '5px', flexWrap: 'wrap' }}>
        <button class="btn tiny" onClick=${acao(() => motor.capturarReferencia())}>Capturar referência</button>
        <button class="btn tiny" onClick=${acao(() => (motor.calibrar() ? `Calibrando com bloco de ${C.cal.height_mm} mm…` : motor.status))}>Calibrar com bloco</button>
        <button class="btn tiny" onClick=${acao(() => motor.zerarTotais())}>Zerar totais</button>
      </div>
      <p class="hint tight">α ${fmt(C.geo.alpha_deg, 2)}° · b ${fmt(C.geo.b_mm, 0)} mm · H_c ${fmt(C.geo.Hc_mm, 0)} mm · limite ${fmt(C.limit.h_mm, 0)} mm
        ${C.mapping.height_gain !== 1 ? html` · <b style=${{ color: 'var(--warn)' }}>ganho ${fmt(C.mapping.height_gain, 1)}× (demonstração)</b>` : ''}</p>
    <//>
  `;
}
