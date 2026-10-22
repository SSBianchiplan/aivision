/**
 * components/saude/StudioFisio.js — a tela cheia "GPlanSiS|Fisio" (CV-47), no
 * padrão do Studio Bike Fit: barra com o teste, faixa vermelha com o paciente,
 * vídeo com a pose e o ângulo, resultado com a referência e a FONTE, curva
 * (ângulo × tempo, ou subida do quadril × tempo com as fases), tabela das
 * medidas e tentativas, perfil do paciente e relatório (HTML → imprimir/PDF),
 * PNG e CSV. Nos três temas e no celular.
 *
 * NÃO É DISPOSITIVO MÉDICO — o aviso fica fixo na tela e sai em todo arquivo.
 * O perfil do paciente fica só neste navegador (runtime/livres-p/canal.js).
 * Fonte: o botão Fonte da barra (components/studio/FonteStudio.js) troca
 * câmera, arquivo, tela ou YouTube sem fechar a tela. Gancho de teste:
 * window.aivFisio (injetar(P, t) põe uma pose sintética pelo mesmo caminho do operador).
 */
import { html, useState, useEffect, useRef, useCallback } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import {
  canalFisio, processar, cfgFisio, pacienteAtivo, listaPacientes, novoPaciente, atualizarPaciente, trocarPaciente, removerPaciente,
  assinarPaciente, OPCOES_ART,
} from '../../cv/runtime/livres-p/canal.js';
import { defaultParams } from '../../cv/registry.js';
import { normaSTS30 } from '../../cv/runtime/livres-p/fisio.js';
import {
  OP, AVISO_MEDICO, ROTULO_PARAM, LADO_PARAM, carregarCss, ativarFisio, carimbo, baixar, desenharVideo, desenharCurva,
  medidasCSV, tentativasCSV, relatorioHTML, num, TESTES, ARTICULACOES, REF, FONTES,
} from './fisio-comum.js';
import { BotaoVia } from '../../via/BotaoVia.js';   // [VIA] botão «✦ Via» da barra (js/via/)

export function StudioFisio({ onClose }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = nodes.find((n) => n.op === OP);
  const ativo = Boolean(no && no.enabled);
  const params = { ...defaultParams(OP), ...(no ? no.params : {}) };
  const cfg = cfgFisio(params);

  const [r, setR] = useState(() => canalFisio.instantaneo());
  const [, setVp] = useState(0);
  const [pacAberto, setPacAberto] = useState(false);
  const [exp, setExp] = useState(false);
  const [msg, setMsgBruto] = useState('');
  const msgT = useRef(null);
  const setMsg = useCallback((t) => { setMsgBruto(t); clearTimeout(msgT.current); if (t) msgT.current = setTimeout(() => setMsgBruto(''), 7000); }, []);
  const raiz = useRef(null), cvVid = useRef(null), cvCurva = useRef(null), fundo = useRef(null), ultimo = useRef('');

  useEffect(() => {
    carregarCss();
    canalFisio.definirStudio(true);
    document.body.classList.add('studio-aberto', 'fis-aberto');
    return () => { canalFisio.definirStudio(false); document.body.classList.remove('studio-aberto', 'fis-aberto', 'studio-ocioso'); };
  }, []);
  useEffect(() => canalFisio.assinar((x) => setR(x)), []);
  useEffect(() => assinarPaciente(() => setVp((n) => n + 1)), []);

  // tentativa selecionada na tabela (curva arquivada) — null = a ao vivo
  const [selT, setSelT] = useState(null);
  const sessao = canalFisio.sessao;
  const res = r && r.res;
  const mostrada = selT != null ? sessao.tentativas.find((t) => t.n === selT) : null;

  useEffect(() => {
    let id = 0;
    const pintar = () => {
      id = requestAnimationFrame(pintar);
      const rr = canalFisio.instantaneo();
      const chave = `${rr ? rr.t : ''}|${selT}|${sessao.tentativas.length}|${sessao.medidas.length}|${window.innerWidth}x${window.innerHeight}|${document.documentElement.getAttribute('data-theme')}|${pacAberto}`;
      if (chave === ultimo.current) return;
      ultimo.current = chave;
      const img = canalFisio.quadro();
      if (img) {
        if (!fundo.current) fundo.current = document.createElement('canvas');
        const f = fundo.current;
        if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
        f.getContext('2d').putImageData(img, 0, 0);
      }
      if (cvVid.current) desenharVideo(cvVid.current, img ? fundo.current : null, rr);
      const sel = selT != null ? sessao.tentativas.find((t) => t.n === selT) : null;
      // sem tentativa em curso, mostra a última concluída do mesmo teste
      const vivo = rr && rr.res;
      const emCurso = vivo && (vivo.teste === 'goniometria' || (vivo.sinais && vivo.sinais.tInicio != null));
      const ult = canalFisio.ultimaTentativa;
      const fb = !emCurso && ult && vivo && ult.teste === vivo.teste ? ult : null;
      if (cvCurva.current) desenharCurva(cvCurva.current, sel || fb || vivo, raiz.current);
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [selT, pacAberto]);

  useEffect(() => {
    window.aivFisio = {
      canal: canalFisio,
      injetar: (P, t, w = 640, h = 480) => processar({ t, P, w, h, cfg: cfgFisio({ ...defaultParams(OP), ...((store.get().nodes.find((n) => n.op === OP) || {}).params || {}) }) }),
      relatorio: () => relatorioHTML(canalFisio.sessao, pacienteAtivo()),
    };
    return () => { delete window.aivFisio; };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && fonteStudioAberta()) return;   // o popover da Fonte fecha primeiro
      const t = e.target;
      if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
      if (e.key === 'Escape') { e.stopPropagation(); if (exp) setExp(false); else if (pacAberto) setPacAberto(false); else onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [exp, pacAberto, onClose]);

  const pac = pacienteAtivo();
  const mudarTeste = (k) => { ativarFisio({ teste: ROTULO_PARAM[k] }); setSelT(null); setMsg(`${TESTES[k].nome}: ${k === 'goniometria' ? 'mova a articulação e toque em «Registrar medida».' : 'sente-se, fique parado ~1 s e levante — o cronômetro começa sozinho.'}`); };
  const imgDe = (c) => { try { return c ? c.toDataURL('image/png') : null; } catch (_) { return null; } };
  const relatorio = () => {
    if (!sessao.medidas.length && !sessao.tentativas.length) { setMsg('Ainda não há medidas nem tentativas para o relatório.'); return; }
    const h = relatorioHTML(sessao, pac, { curva: imgDe(cvCurva.current), video: imgDe(cvVid.current) });
    const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
    const w = window.open(url, '_blank');
    if (!w) { const a = document.createElement('a'); a.href = url; a.download = `fisio-relatorio-${carimbo()}.html`; a.click(); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setMsg('Relatório aberto: use Imprimir → Salvar como PDF.');
  };
  const exportar = (tipo) => {
    setExp(false);
    const nome = `fisio_${carimbo()}`;
    if (tipo === 'medidas') baixar(medidasCSV(sessao, pac), `${nome}_adm.csv`, 'text/csv');
    else if (tipo === 'tentativas') baixar(tentativasCSV(sessao, pac), `${nome}_testes.csv`, 'text/csv');
    else if (tipo === 'curva' && cvCurva.current) cvCurva.current.toBlob((b) => b && baixar(b, `${nome}_curva.png`, 'image/png'), 'image/png');
    else if (tipo === 'video' && cvVid.current) cvVid.current.toBlob((b) => b && baixar(b, `${nome}_quadro.png`, 'image/png'), 'image/png');
    else if (tipo === 'relatorio') { relatorio(); return; }
    setMsg('Arquivo gerado no aparelho (nada é enviado).');
  };
  const registrar = () => { const m = canalFisio.registrar(); setMsg(m ? `Registrado: ${m.nome} ${m.lado === 'e' ? 'esq.' : 'dir.'} máx ${num(m.max, 0)}°, mín ${num(m.min, 0)}°.` : 'Sem ângulo para registrar.'); };

  // ---------------------------------------------------------- resultado
  const A = ARTICULACOES[cfg.articulacao];
  const norma = pac ? normaSTS30(pac.idade, pac.sexo) : null;
  const ult = canalFisio.ultimaTentativa;
  let principal = '—', sub = '', alto = false, fonte = '', risco = null;
  if (cfg.teste === 'goniometria') {
    principal = res && res.teste === 'goniometria' && res.max != null ? `${num(res.max, 0)}°` : '—';
    sub = res && res.max != null ? `máximo · atual ${num(res.atual, 0)}° · mín ${num(res.min, 0)}° · amplitude ${num(res.amplitude, 0)}°` : `${A.nome}: aguardando o movimento`;
    fonte = `Referência ${A.ref[0]}–${A.ref[1]}° (${A.movimento}) — ${FONTES.adm}.`;
  } else {
    const t = mostrada || (res && res.estado === 'concluído' ? res : null) || (ult && ult.teste === cfg.teste ? ult : null);
    if (cfg.teste === 'sts30') {
      const n = t ? (t.nRep ?? t.n) : res ? res.n : null;
      principal = n != null ? `${n}` : '—';
      sub = t ? `vezes em pé em 30 s${t.meia ? ' (com meia subida no fim)' : ''}` : res && res.restante != null ? `faltam ${num(res.restante, 0)} s` : 'vezes em pé em 30 s';
      if (norma && n != null && t) { risco = n < norma[0] ? 'alto' : 'baixo'; alto = risco === 'alto'; }
      fonte = `${norma ? `Faixa normal para ${pac.idade} anos, ${pac.sexo === 'F' ? 'mulheres' : 'homens'}: ${norma[0]}–${norma[1]} vezes. ` : 'Informe idade e sexo do paciente para a faixa normal. '}${FONTES.sts30}`;
    } else {
      principal = t && t.total != null ? `${num(t.total, 2)} s` : res && res.sinais && res.sinais.tInicio != null && res.estado !== 'concluído'
        ? `${num((res.sinais.ts[res.sinais.ts.length - 1] - res.sinais.tInicio) / 1000, 1)} s` : '—';
      sub = t ? `${TESTES[cfg.teste].nome}${t.n ? ` · tentativa ${t.n}` : ''}` : TESTES[cfg.teste].nome;
      risco = t && t.risco; alto = risco === 'alto';
      fonte = cfg.teste === 'tug' ? `${FONTES.tugProto} ${FONTES.tug}` : FONTES.sts5;
    }
  }
  const fases = (mostrada || (res && res.estado === 'concluído' ? res : null) || (ult && ult.teste === 'tug' ? ult : null));
  const f = cfg.teste === 'tug' && fases && fases.fases;

  const testes = ['goniometria', 'tug', 'sts5', 'sts30'];
  const pacList = listaPacientes();

  return html`
    <div class="fis" ref=${raiz} role="dialog" aria-modal="true" aria-label="iaVision GPlanSiS|Fisio">
      <div class="fis-barra">
        <b class="fis-titulo"><span class="fis-marca">iaVision</span> <span class="fis-gp">GPlanSiS<i>|</i></span>Fisio</b>
        <${FonteStudio} classeBotao="fis-btn" />
        <span class="fis-seg" role="group" aria-label="Teste">
          ${testes.map((k) => html`<button key=${k} class=${cfg.teste === k ? 'on' : ''} aria-pressed=${cfg.teste === k} onClick=${() => mudarTeste(k)}>${TESTES[k].curto}</button>`)}
        </span>
        ${cfg.teste === 'goniometria' && html`
          <select class="fis-btn" aria-label="Articulação" value=${params.articulacao} onChange=${(e) => ativarFisio({ articulacao: e.target.value })}>
            ${Object.keys(OPCOES_ART).map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select>
          <select class="fis-btn" aria-label="Lado" value=${params.lado} onChange=${(e) => ativarFisio({ lado: e.target.value })}>
            ${Object.values(LADO_PARAM).map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
          </select>`}
        <span class="fis-msg" role="status" aria-live="polite">${msg}</span>
        <button class=${`fis-btn ${pacAberto ? 'on' : ''}`} onClick=${() => setPacAberto(!pacAberto)}>Paciente</button>
        <button class="fis-btn" onClick=${relatorio} title="Abre o relatório para imprimir ou salvar em PDF">Relatório</button>
        <span class="fis-menu-w">
          <button class=${`fis-btn ${exp ? 'on' : ''}`} aria-haspopup="menu" aria-expanded=${exp} onClick=${() => setExp(!exp)}>Exportar ▾</button>
          ${exp && html`<div class="fis-menu" role="menu">
            <button role="menuitem" onClick=${() => exportar('relatorio')}>Relatório (HTML → PDF)</button>
            <button role="menuitem" onClick=${() => exportar('medidas')}>Goniometria (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('tentativas')}>Testes funcionais (CSV)</button>
            <button role="menuitem" onClick=${() => exportar('curva')}>Curva (PNG)</button>
            <button role="menuitem" onClick=${() => exportar('video')}>Quadro com a pose (PNG)</button>
          </div>`}
        </span>
        <button class="fis-btn" onClick=${() => { if (confirm('Nova sessão? Medidas e tentativas desta sessão serão apagadas (o cadastro do paciente fica). Exporte antes, se precisar.')) { canalFisio.zerar(); setSelT(null); setMsg('Sessão nova.'); } }}>Nova sessão</button>
        <${BotaoVia} modulo="fisio" classe="fis-btn" />
        <button class="fis-btn fis-fechar" onClick=${onClose} aria-label="Fechar o Studio Fisio">✕</button>
      </div>
      <div class="fis-faixa"><b>${TESTES[cfg.teste].nome}</b><span>${pac ? `${pac.nome}${pac.idade ? ` · ${pac.idade} anos` : ''}${pac.sexo ? ` · ${pac.sexo}` : ''}${pac.ladoAcometido ? ` · lado acometido: ${pac.ladoAcometido}` : ''}` : 'sem paciente cadastrado — toque em «Paciente»'}</span></div>
      <div class="fis-aviso" role="note">⚠ ${AVISO_MEDICO}</div>
      ${!ativo && html`<div class="fis-aviso amb">O operador Fisio não está ativo no Pipeline. <button class="fis-btn mini" onClick=${() => { ativarFisio({}, {}); setMsg('Fisio ligado no Pipeline.'); }}>Ligar no Pipeline</button></div>`}

      <div class="fis-grade">
        <section class="fis-p fis-vid">
          <h2>Vídeo <small>${cfg.teste === 'goniometria' ? `vista ${A.vista} · lado ${cfg.lado === 'auto' ? 'automático' : LADO_PARAM[cfg.lado]}` : 'câmera DE LADO para o percurso, corpo inteiro'}</small></h2>
          <canvas ref=${cvVid} class="fis-cv-vid" aria-label="Vídeo com a pose e o ângulo medido"></canvas>
          <div class="fis-acoes">
            ${cfg.teste === 'goniometria'
              ? html`<button class="fis-btn acento" onClick=${registrar}>Registrar medida</button>`
              : html`<button class="fis-btn" onClick=${() => { canalFisio.descartar(); setMsg('Tentativa descartada: sente-se e recomece.'); }}>Descartar tentativa</button>`}
            <button class="fis-btn" onClick=${() => exportar('video')}>Salvar quadro</button>
          </div>
          <p class="fis-dica">${cfg.teste === 'goniometria'
            ? `Posicione a câmera ${A.vista === 'lateral' ? 'de lado' : 'de frente'} para a articulação, a ~2–3 m; faça o movimento completo e devagar; registre ao terminar.`
            : cfg.teste === 'tug' ? `Cadeira com braços, marca no chão a ${num(cfg.distanciaM, 1)} m. O tempo começa no primeiro movimento e termina quando a pessoa senta.`
            : 'Cadeira sem braços, braços cruzados no peito. O tempo começa no primeiro movimento.'}</p>
        </section>

        <section class="fis-p fis-res">
          <h2>Resultado <small>${res ? res.estado || '' : 'sem pose'}</small></h2>
          <div class="fis-num"><b class=${alto ? 'alto' : ''}>${principal}</b><span>${sub}</span></div>
          ${cfg.teste !== 'goniometria' && res && res.estado !== 'concluído' && html`<div class="fis-estado">${res.estado}${(res.avisos || [])[0] ? ` · ${res.avisos[0]}` : ''}</div>`}
          ${f && html`<div class="fis-mini">
            ${[['levantar', f.levantar], ['ida', f.ida], ['giro', f.giro], ['volta', f.volta], ['sentar', f.sentar]].map(([n, v]) => html`<div key=${n}><b>${num(v, 2)} s</b><em>${n}</em></div>`)}
            ${fases.velocidade && html`<div><b>${num(fases.velocidade, 2)}</b><em>m/s marcha (aprox.)</em></div>`}
          </div>`}
          ${risco && html`<span class=${`fis-risco ${risco}`}>${cfg.teste === 'tug' ? (risco === 'alto' ? `≥ ${num(REF.tug, 1)} s: risco aumentado de queda` : `< ${num(REF.tug, 1)} s`) : cfg.teste === 'sts5' ? (risco === 'alto' ? `≥ ${REF.sts5} s: risco de queda` : `< ${REF.sts5} s`) : risco === 'alto' ? 'abaixo da faixa normal' : 'na faixa normal ou acima'}</span>`}
          <p class="fis-fonte">${fonte}</p>
        </section>

        <section class="fis-p fis-pac">
          <h2>Paciente <small>só neste aparelho</small><button class="fis-btn mini" style=${{ marginLeft: 'auto' }} onClick=${() => setPacAberto(!pacAberto)}>${pacAberto ? 'Fechar' : 'Editar'}</button></h2>
          ${pacAberto ? html`<${EditorPaciente} pac=${pac} lista=${pacList} onMsg=${setMsg} />` : pac ? html`<dl>
            <dt>Nome / código</dt><dd>${pac.nome}</dd><dt>Idade</dt><dd>${pac.idade || '—'}</dd><dt>Sexo</dt><dd>${pac.sexo === 'F' ? 'feminino' : pac.sexo === 'M' ? 'masculino' : '—'}</dd>
            <dt>Altura</dt><dd>${pac.alturaCm ? `${pac.alturaCm} cm` : '—'}</dd><dt>Lado acometido</dt><dd>${pac.ladoAcometido || '—'}</dd><dt>Queixa</dt><dd>${pac.diagnostico || '—'}</dd>
          </dl>` : html`<p class="fis-dica">Sem paciente: cadastre (nome ou um código, idade e sexo dão a faixa normal do sentar-levantar 30 s).</p>
            <button class="fis-btn acento" onClick=${() => { novoPaciente(); setPacAberto(true); }}>Novo paciente</button>`}
        </section>

        <section class="fis-p fis-curva">
          <h2>Curva <small>${mostrada ? `tentativa ${mostrada.n} (arquivada) · ` : 'ao vivo · '}${cfg.teste === 'goniometria' ? 'ângulo × tempo, faixa de referência' : 'subida do quadril × tempo, fases'}</small>
            ${mostrada && html`<button class="fis-btn mini" onClick=${() => setSelT(null)}>Ao vivo</button>`}</h2>
          <canvas ref=${cvCurva} class="fis-cv-curva" aria-label="Curva do teste"></canvas>
        </section>

        <section class="fis-p fis-tab">
          <h2>${cfg.teste === 'goniometria' ? 'Medidas (ADM)' : 'Tentativas'} <small>${cfg.teste === 'goniometria' ? `${sessao.medidas.length} registradas` : 'clique para ver a curva'}</small></h2>
          <div class="fis-jt"><table>
            ${cfg.teste === 'goniometria' ? html`
              <thead><tr><th>#</th><th>Articulação</th><th>Lado</th><th>Mín.</th><th>Máx.</th><th>Amplit.</th><th>% ref.</th></tr></thead>
              <tbody>${sessao.medidas.length ? sessao.medidas.map((m) => html`<tr key=${m.n}><td>${m.n}</td><td>${m.nome}</td><td>${m.lado === 'e' ? 'esq.' : 'dir.'}</td>
                <td class="num">${num(m.min, 0)}°</td><td class="num"><b>${num(m.max, 0)}°</b></td><td class="num">${num(m.amplitude, 0)}°</td><td class="num">${m.pctRef != null ? num(m.pctRef * 100, 0) + ' %' : '—'}</td></tr>`)
                : html`<tr><td colspan="7">Nenhuma medida registrada.</td></tr>`}</tbody>`
            : html`
              <thead><tr><th>#</th><th>Teste</th><th>Resultado</th><th>Situação</th><th>Hora</th></tr></thead>
              <tbody>${sessao.tentativas.length ? sessao.tentativas.slice().reverse().map((t) => html`<tr key=${t.n} onClick=${() => setSelT(t.n === selT ? null : t.n)} style=${{ cursor: 'pointer', background: t.n === selT ? 'rgba(255,216,77,.12)' : '' }}>
                <td>${t.n}</td><td>${TESTES[t.teste].curto}</td><td class="num"><b>${t.teste === 'sts30' ? `${t.nRep}×` : `${num(t.total, 2)} s`}</b></td>
                <td>${t.risco === 'alto' ? 'acima da ref.' : t.risco ? 'abaixo da ref.' : '—'}</td><td>${new Date(t.quando).toLocaleTimeString('pt-BR')}</td></tr>`)
                : html`<tr><td colspan="5">Nenhuma tentativa concluída.</td></tr>`}</tbody>`}
          </table></div>
        </section>

        <section class="fis-p fis-ref">
          <h2>Referências <small>valores citados só com a fonte</small></h2>
          <ul class="fis-refs">
            <li>${FONTES.tugProto}</li><li>${FONTES.tug}</li><li>${FONTES.sts5}</li><li>${FONTES.sts30}</li><li>ADM: ${FONTES.adm}</li>
          </ul>
        </section>
      </div>
    </div>
  `;
}

function EditorPaciente({ pac, lista, onMsg }) {
  const p = pac || {};
  const campo = (k, v) => { atualizarPaciente({ [k]: v }); };
  return html`
    <div>
      <div class="fis-acoes" style=${{ marginTop: 0, marginBottom: '8px' }}>
        <select class="fis-btn" aria-label="Paciente" value=${pac ? pac.id : ''} onChange=${(e) => trocarPaciente(e.target.value)}>
          ${!pac && html`<option value="">—</option>`}
          ${lista.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome}</option>`)}
        </select>
        <button class="fis-btn" onClick=${() => { novoPaciente(); onMsg('Paciente novo.'); }}>+ Novo</button>
        ${pac && html`<button class="fis-btn" onClick=${() => { if (confirm(`Apagar o cadastro de ${pac.nome} deste aparelho?`)) removerPaciente(pac.id); }}>Apagar</button>`}
      </div>
      ${pac && html`<div class="fis-form">
        <label class="largo">Nome ou código (prefira um código ao compartilhar)<input type="text" value=${p.nome} onChange=${(e) => campo('nome', e.target.value)} /></label>
        <label>Idade (anos)<input type="number" min="0" max="120" inputmode="numeric" value=${p.idade ?? ''} onChange=${(e) => campo('idade', e.target.value === '' ? null : +e.target.value)} /></label>
        <label>Sexo<select value=${p.sexo || ''} onChange=${(e) => campo('sexo', e.target.value)}><option value="">—</option><option value="F">feminino</option><option value="M">masculino</option></select></label>
        <label>Altura (cm)<input type="number" min="50" max="230" inputmode="numeric" value=${p.alturaCm ?? ''} onChange=${(e) => campo('alturaCm', e.target.value === '' ? null : +e.target.value)} /></label>
        <label>Lado acometido<select value=${p.ladoAcometido || ''} onChange=${(e) => campo('ladoAcometido', e.target.value)}><option value="">—</option><option>esquerdo</option><option>direito</option><option>bilateral</option></select></label>
        <label class="largo">Diagnóstico / queixa<input type="text" value=${p.diagnostico || ''} onChange=${(e) => campo('diagnostico', e.target.value)} /></label>
        <label class="largo">Observações<textarea rows="2" key=${p.id} defaultValue=${p.observacoes || ''} onChange=${(e) => campo('observacoes', e.target.value)}></textarea></label>
      </div>`}
      <p class="fis-dica">Dados de saúde são sensíveis (LGPD art. 5º, II): ficam só neste navegador, nesta conta; nada é enviado.</p>
    </div>
  `;
}

export default StudioFisio;
