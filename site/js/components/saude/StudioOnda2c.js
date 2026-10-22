/**
 * components/saude/StudioOnda2c.js — a tela cheia "GPlanSiS|Vitais" (onda
 * 2-c): sinais vitais sem contato (vídeo, número com a faixa de confiança,
 * sinal, espectro e as condições) e a comparação com a referência (bonecos
 * lado a lado seguindo o alinhamento DTW, nota por fase). Fonte pelo botão
 * Fonte da barra (FonteStudio). Aviso "não é dispositivo médico" fixo.
 * Gancho de teste: window.aivOnda2c.
 */
import { html, useState, useEffect, useRef } from '../../vendor.js';
import { useStore, store } from '../../state/store.js';
import { FonteStudio, fonteStudioAberta } from '../studio/FonteStudio.js';
import { instantaneo, assinar, definirStudio, ultimoQuadro, pedir } from '../../cv/runtime/livres-t/canal.js';
import {
  PRESETS_ONDA2C, AVISO_SAUDE, carregarCss, aplicarPresetOnda2c, opAtivo, relatorioHTML, abrirRelatorio, carimbo, textoPrincipal,
  desenharSerie, desenharEspectro, desenharBoneco, prepararCanvas, cores,
} from './onda2c-comum.js';

const MODOS = [['Respiração sem contato', 'vitais.respiracao', '🫁 Respiração'], ['Frequência cardíaca rPPG', 'vitais.cardiaca', '❤ FC rPPG'],
  ['Tremor de mão', 'clinica.tremor', '✋ Tremor'], ['Comparar com a referência', 'referencia.comparar', '🎯 Referência']];
const fmt = (v, c = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(c).replace('.', ','));

export function StudioOnda2c({ onClose }) {
  const nodes = useStore(store, (st) => st.nodes);
  const no = opAtivo(nodes);
  const op = no ? no.op : null;
  const [, setV] = useState(0);
  const raiz = useRef(null), cvVid = useRef(null), cvSerie = useRef(null), cvEsp = useRef(null), cvRef = useRef(null), fundo = useRef(null);
  useEffect(() => {
    carregarCss(); definirStudio(true);
    document.body.classList.add('studio-aberto', 'o2s-aberto');
    return () => { definirStudio(false); document.body.classList.remove('studio-aberto', 'o2s-aberto', 'studio-ocioso'); };
  }, []);
  useEffect(() => assinar(() => setV((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && fonteStudioAberta()) return;
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  useEffect(() => {
    window.aivOnda2c = { retrato: () => (op ? instantaneo(op) : null), op: () => op };
    return () => { delete window.aivOnda2c; };
  }, [op]);

  // pintura: vídeo, série, espectro ou bonecos
  useEffect(() => {
    let id = 0, quadroT = 0;
    const pintar = (agora) => {
      id = requestAnimationFrame(pintar);
      const r = op ? instantaneo(op) : null;
      const img = ultimoQuadro();
      if (cvVid.current) {
        const { g, W, H } = prepararCanvas(cvVid.current);
        g.fillStyle = '#02302C'; g.fillRect(0, 0, W, H);
        if (img) {
          if (!fundo.current) fundo.current = document.createElement('canvas');
          const f = fundo.current;
          if (f.width !== img.width || f.height !== img.height) { f.width = img.width; f.height = img.height; }
          f.getContext('2d').putImageData(img, 0, 0);
          const k = Math.min(W / img.width, H / img.height);
          g.drawImage(f, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
        }
      }
      if (!r) return;
      if (r.comparacao && cvRef.current) desenharComparacao(cvRef.current, r, raiz.current, agora);
      if (agora - quadroT < 250) return;
      quadroT = agora;
      if (cvSerie.current) desenharSerie(cvSerie.current, r.serie, raiz.current);
      if (cvEsp.current) desenharEspectro(cvEsp.current, r.espectro, raiz.current, r.principal && r.principal.unidade === 'Hz' ? r.principal.valor : r.principal && r.principal.valor,
        r.principal && r.principal.faixa, r.principal && r.principal.unidade === 'Hz' ? 'Hz' : '/min');
    };
    id = requestAnimationFrame(pintar);
    return () => cancelAnimationFrame(id);
  }, [op]);

  const r = op ? instantaneo(op) : null;
  const pr = r && r.principal;
  const est = r && r.estimativa;
  const relatorio = () => {
    if (!r) return;
    let img = null; try { img = cvSerie.current ? cvSerie.current.toDataURL('image/png') : null; } catch (_) { /* canvas */ }
    abrirRelatorio(relatorioHTML(r, { imagem: img }), `${op}_${carimbo()}.html`);
  };
  const ir = (nome) => { const pz = PRESETS_ONDA2C.find((p) => p.nome === nome); if (pz) aplicarPresetOnda2c(pz, { studio: true }); };
  const comparacao = r && r.comparacao;

  return html`
    <div class="o2s" ref=${raiz} role="dialog" aria-modal="true" aria-label="GPlanSiS|Vitais">
      <div class="o2s-barra">
        <span class="o2s-titulo">GPlanSiS|Vitais</span>
        ${MODOS.map(([nome, o, rot]) => html`<button key=${o} class="o2s-btn ${op === o ? 'on' : ''}" onClick=${() => ir(nome)}>${rot}</button>`)}
        <${FonteStudio} classeBotao="o2s-btn" />
        <span class="o2s-mola"></span>
        ${comparacao && html`<button class="o2s-btn" onClick=${() => pedir(op, 'iniciar')}>● Iniciar</button><button class="o2s-btn" onClick=${() => pedir(op, 'parar')}>■ Parar</button>`}
        <button class="o2s-btn" onClick=${relatorio} disabled=${!r}>Relatório</button>
        <button class="o2s-btn" onClick=${onClose} aria-label="Fechar">✕</button>
      </div>
      <div class="o2s-faixa">${r ? r.titulo : 'Escolha a medida na barra'}</div>
      <div class="o2s-corpo">
        <div class="o2s-video"><canvas ref=${cvVid}></canvas>
          ${!ultimoQuadro() && html`<p class="o2s-vazio">Aguardando o quadro do operador (fonte ligada?).</p>`}</div>
        <div class="o2s-lado">
          <div class="o2s-num"><b data-o2s-valor="">${textoPrincipal(pr)}</b>
            ${pr && pr.faixa && html`<span>faixa de confiança ${fmt(pr.faixa[0], pr.unidade === 'Hz' ? 1 : 0)}–${fmt(pr.faixa[1], pr.unidade === 'Hz' ? 1 : 0)} ${pr.unidade}</span>`}
            <i>${pr ? pr.rotulo : ''}</i>
            ${est && est.confianca != null && html`<div class="o2s-conf" title="confiança"><div style=${{ width: `${Math.round(est.confianca * 100)}%` }}></div></div>`}
          </div>
          ${r && html`<table class="o2s-tab"><tbody>${(r.linhas || []).map(([a, b], i) => html`<tr key=${i}><th>${a}</th><td>${b}</td></tr>`)}</tbody></table>`}
          <div class="o2s-cond"><b>Condições</b>
            ${(r && r.avisos && r.avisos.length ? r.avisos : ['sem alerta agora']).map((a, i) => html`<p key=${i}>${a}</p>`)}
            ${r && r.vitais && html`<p class="o2s-dica">Iluminação contínua e de frente, sem luz piscando; pessoa parada e apoiada; câmera fixa.</p>`}
          </div>
          ${comparacao ? html`<canvas class="o2s-ref" ref=${cvRef}></canvas>` : html`
            <canvas class="o2s-serie" ref=${cvSerie}></canvas>
            <canvas class="o2s-esp" ref=${cvEsp}></canvas>`}
          ${r && r.fonte && html`<p class="o2s-fonte">Fonte: ${r.fonte}</p>`}
        </div>
      </div>
      <div class="o2s-medico" data-aviso-medico="">⚠ ${AVISO_SAUDE}</div>
    </div>
  `;
}

/** Referência × tentativa lado a lado, seguindo o caminho do DTW em loop; barras de nota por fase. */
function desenharComparacao(cv, r, el, agora) {
  const C = cores(el), { g, W, H, dpr } = prepararCanvas(cv);
  g.fillStyle = C.fundo; g.fillRect(0, 0, W, H);
  const x = r.extra || {};
  g.font = `${11 * dpr}px Archivo, sans-serif`; g.fillStyle = C.tinta;
  const esc = Math.min(W / 6, H / 4.2);
  const cy = H * 0.42;
  if (x.ref && x.tent && x.caminho && x.caminho.length) {
    const k = Math.floor(((agora / 1000) % 3) / 3 * x.caminho.length);
    const [i, j] = x.caminho[Math.min(k, x.caminho.length - 1)];
    desenharBoneco(g, x.ref[i].pose, W * 0.27, cy, esc, '#22d3ee', 3 * dpr);
    desenharBoneco(g, x.tent[j].pose, W * 0.73, cy, esc, C.acento, 3 * dpr);
    g.fillText('referência', W * 0.2, 14 * dpr); g.fillText('tentativa', W * 0.66, 14 * dpr);
  } else if (x.ref && x.ref.length) {
    const k = Math.floor(((agora / 1000) % 3) / 3 * x.ref.length);
    desenharBoneco(g, x.ref[k].pose, W * 0.27, cy, esc, '#22d3ee', 3 * dpr);
    desenharBoneco(g, x.poseAgora, W * 0.73, cy, esc, C.acento, 3 * dpr);
    g.fillText('referência', W * 0.2, 14 * dpr); g.fillText(x.gravando ? 'gravando…' : 'agora', W * 0.66, 14 * dpr);
  } else g.fillText('Grave a referência (modo "gravar referência").', 10 * dpr, 20 * dpr);
  // fases
  const fases = (r.linhas || []).filter(([a]) => /^Fase \d/.test(a));
  const bw = (W - 20 * dpr) / Math.max(1, fases.length);
  fases.forEach(([a, b], n) => {
    const nota = parseFloat(String(b).replace(',', '.'));
    const h = Number.isFinite(nota) ? (nota / 100) * H * 0.18 : 0;
    g.fillStyle = nota >= 80 ? C.ok : nota >= 60 ? C.acento : '#FF8A80';
    g.fillRect(10 * dpr + n * bw + 4, H - 18 * dpr - h, bw - 8, h);
    g.fillStyle = C.tinta; g.fillText(`${a}: ${String(b).split(' · ')[0]}`, 10 * dpr + n * bw + 4, H - 5 * dpr);
  });
}

export default StudioOnda2c;
