/**
 * components/industrial/BeltScanConfig.js — "Configurar" do GPlanSiS|BeltScan.
 *
 * As abas do BELTSCAN, dirigidas pelo esquema (como o HTML): Extração,
 * Geometria, Bancada, Calibração, Correia, Limite, Análise, Alarmes, Câmera e
 * Arquivo. Todo parâmetro numérico tem controle deslizante e campo numérico.
 * Cada mudança vai direto na configuração do motor (canal) e fica salva no
 * navegador, no perfil ativo; a aba Arquivo exporta/importa o JSON
 * "beltscan/4" — o mesmo do HTML e do beltscan.py --config.
 */
import { confirmar, perguntar } from '../dialogo.js';
import { html, useState, useEffect } from '../../vendor.js';
import { PREDEFINICOES, CAMERAS, normalizarConfig, clonar, PADRAO, predefFeijao } from '../../cv/runtime/livres-k/beltscan.js';
import {
  obterMotor, salvarSeMudou, avisarAgora, trilhaDaCamera, listaPerfis, perfilAtivo, trocarPerfil, criarPerfil, restaurarPerfil,
} from '../../cv/runtime/livres-k/canal.js';
import { fmt, baixar } from './beltscan-comum.js';
import { porImagem } from '../../cv/runtime/livres-k/beltscan-marcas.js';

const F = (p, l, u, min, max, step, hint) => ({ p, l, u, min, max, step, hint });
const B_ = (p, l, hint) => ({ p, l, type: 'bool', hint });
const SEL = (p, l, opts) => ({ p, l, type: 'select', opts });

export const ABAS = {
  'Extração': [
    SEL('extraction.mode', 'Modo de cor', [['red', 'Vermelho (câmera colorida)'], ['mono', 'Mono (câmera com filtro 660 nm)']]),
    F('extraction.thr', 'Limiar do pico', '', 1, 255, 1, 'intensidade mínima da linha'),
    F('extraction.contrast_k', 'Contraste mínimo', '× mediana', 1, 6, 0.1),
    F('extraction.half_win', 'Meia janela do centroide', 'px', 1, 10, 1),
    B_('extraction.tophat', 'Top-hat vertical', 'remove fundo avermelhado largo'),
    F('extraction.tophat_k', 'Altura do top-hat', 'px', 3, 61, 2),
    F('extraction.max_shift_px', 'Faixa de busca em torno da referência', 'px', 5, 600, 1),
    F('extraction.despike_win', 'Janela do despike', 'col.', 3, 31, 2),
    F('extraction.despike_tol', 'Tolerância do despike', 'px', 1, 40, 0.5),
    { p: 'extraction.roi', l: 'Faixa de busca (ROI) x0, y0, x1, y1', type: 'roi' },
    { type: 'excl' },
    SEL('extraction.ref_mode', 'Referência vazia', [['frames', 'Mediana de quadros com a área vazia'], ['fit', 'Envelope + ajuste (aceita material na linha)']]),
    F('extraction.ref_frames', 'Quadros da referência', '', 3, 300, 1),
    F('extraction.env_pct', 'Envelope: percentil do lado vazio', '%', 50, 100, 1),
    F('extraction.fit_order', 'Grau do ajuste', '', 1, 4, 1),
    F('extraction.fit_tol_px', 'Tolerância do ajuste', 'px', 0.3, 10, 0.1),
    B_('extraction.auto_ref', 'Referência automática ao iniciar'),
  ],
  'Geometria': [
    { type: 'cammodel' },
    F('geo.Hc_mm', 'Altura da câmera H_c', 'mm', 50, 3000, 1, 'sobre a superfície de referência'),
    F('geo.b_mm', 'Linha de base b', 'mm', 10, 2000, 1, 'câmera ↔ plano do laser, ao longo do fluxo'),
    F('geo.alpha_deg', 'Inclinação α do eixo óptico', '°', 1, 85, 0.1, 'da vertical'),
    F('geo.hfov_deg', 'Campo de visão horizontal', '°', 10, 150, 0.5, 'usado se f ou pixel = 0'),
    F('geo.f_mm', 'Distância focal f', 'mm', 0, 100, 0.1),
    F('geo.pix_um', 'Tamanho do pixel', 'µm', 0, 20, 0.01),
    SEL('geo.v_sign', 'Sentido de v', [[-1, '− câmera em pé (padrão)'], [1, '+ câmera invertida']]),
    F('geo.roll_deg', 'Giro da câmera', '°', -20, 20, 0.01),
    B_('geo.auto_alpha', 'Estimar α ao capturar a referência', 'usa b, H_c e a linha no centro da faixa'),
    { type: 'geonote' },
  ],
  'Bancada': [
    { type: 'note', t: 'Medição real na bancada, em escala 1:1. A seção vem da triangulação; a velocidade vem do deslocamento da textura (papel e grãos) numa faixa logo abaixo da linha, por correlação de fase, convertido para mm pela geometria. Seção × velocidade dá a vazão, e a integral dá o volume que passou. Pese o material para validar.' },
    SEL('bench.speed_src', 'Velocidade da superfície', [['flow', 'Medida por fluxo óptico abaixo da linha'], ['manual', 'Valor informado']]),
    F('bench.speed_mm_s', 'Velocidade informada', 'mm/s', 0, 2000, 0.5),
    F('bench.flow_near_px', 'Faixa do fluxo: início após a linha', 'px', 5, 300, 1),
    F('bench.flow_far_px', 'Faixa do fluxo: fim após a linha', 'px', 20, 500, 1),
    F('bench.flow_max_px', 'Deslocamento máximo entre quadros', 'px', 4, 120, 2),
    F('bench.flow_min_conf', 'Confiança mínima do fluxo', '', 0, 0.9, 0.01),
    F('bench.flow_tau_s', 'Filtro da velocidade τ', 's', 0, 3, 0.05),
    F('bench.noise_mm', 'Altura mínima contada como material', 'mm', 0, 10, 0.1),
    F('bench.rho_kgm3', 'Densidade aparente do material', 'kg/m³', 50, 1500, 1, 'feijão a granel ~780, a confirmar'),
    B_('bench.reset_on_loop', 'Zerar o volume a cada volta do vídeo', 'guarda o ciclo anterior'),
  ],
  'Calibração': [
    F('cal.height_mm', 'Altura do bloco', 'mm', 0.5, 500, 0.1),
    F('cal.frames', 'Quadros por ponto', '', 3, 100, 1),
    F('cal.min_px', 'Deslocamento mínimo do bloco', 'px', 0.5, 20, 0.1),
    B_('cal.fit_b', 'Ajustar também a linha de base b', 'use dois ou mais blocos'),
    { type: 'calpoints' },
  ],
  'Correia': [
    F('belt.B_mm', 'Largura da correia B', 'mm', 400, 3000, 50),
    F('belt.roll_mm', 'Comprimento dos rolos', 'mm', 100, 1500, 10),
    F('belt.trough_deg', 'Acamamento λ', '°', 0, 60, 0.5),
    F('belt.surcharge_deg', 'Ângulo de sobrecarga β', '°', 0, 35, 0.5),
    F('belt.incline_deg', 'Inclinação no ponto de medição δ', '°', 0, 25, 0.5),
    B_('belt.on_incline', 'Medição na rampa (reduz a sobrecarga, k_δ)'),
    B_('belt.plane_perp', 'Plano do laser perpendicular à correia', 'senão aplica cos δ'),
    F('belt.speed_ms', 'Velocidade da correia', 'm/s', 0, 8, 0.01, 'a confirmar; encoder em campo'),
    F('belt.rho_kgm3', 'Densidade aparente úmida', 'kg/m³', 50, 900, 1),
    F('belt.moisture', 'Umidade (base úmida)', 'fração', 0, 0.9, 0.01),
    F('belt.sp_tsa_h', 'Setpoint de massa seca', 't/h', 0, 1000, 0.5, '0 desliga o FI-104'),
    F('mapping.scale_xy', 'Escala bancada → correia', '× (0 = auto)', 0, 50, 0.01),
    F('mapping.height_gain', 'Ganho de altura', '×', 0.1, 30, 0.1, '≠ 1 só para demonstração'),
  ],
  'Limite': [
    { type: 'note', t: 'Os alarmes marcados com “exige altura” só entram quando o produto passa da altura limite da correia E o valor passa do limite do próprio alarme. O nível usado é o representativo: o maior nível que ocupa pelo menos a largura mínima da calha, para que uma peça isolada não dispare nada.' },
    SEL('limit.ref', 'Referência da altura limite', [['thickness', 'Espessura da camada sobre a correia'], ['z', 'Cota sobre o rolo central']]),
    F('limit.h_mm', 'Altura limite da correia', 'mm', 0, 1500, 1, 'acima dela os alarmes são liberados'),
    F('limit.min_width_pct', 'Largura mínima acima do limite', '% da calha', 0.5, 50, 0.5, 'ignora peça isolada'),
    F('limit.gate_db_mm', 'Histerese do portão', 'mm', 0, 200, 1, 'sai só abaixo do limite menos este valor'),
    F('limit.min_thick_mm', 'Camada mínima considerada produto', 'mm', 0, 200, 1),
    F('ui.trend_window_s', 'Janela da tendência com câmera', 's', 10, 600, 5),
  ],
  'Análise': [
    F('analysis.tau_s', 'Filtro da seção τ', 's', 0, 10, 0.05),
    F('analysis.zero_frac', 'Zerar seção abaixo de', '× A_th', 0, 0.05, 0.0005),
    F('analysis.median_win', 'Mediana do perfil', 'col.', 1, 31, 2),
    F('analysis.reject_mm', 'Rejeitar acima da mediana', 'mm', 5, 500, 1),
    F('analysis.neg_clip_mm', 'Limite negativo', 'mm', 0, 200, 1),
    F('analysis.peak_win', 'Janela do pico local AI-102', 'col.', 3, 101, 2),
    F('analysis.q_good', 'Qualidade boa a partir de', 'cobertura', 0.3, 1, 0.01),
    F('analysis.q_unc', 'Qualidade incerta a partir de', 'cobertura', 0.1, 1, 0.01),
    F('analysis.temporal_alpha', 'Filtro temporal por coluna', 'peso do quadro novo', 0.05, 1, 0.05, '1 = sem filtro'),
  ],
  'Alarmes': [{ type: 'alarms' }],
  'Câmera': [{ type: 'camera' }],
  'Arquivo': [{ type: 'file' }],
};

const obter = (C, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), C);
function definir(C, p, v) { const ks = p.split('.'), u = ks.pop(); ks.reduce((o, k) => o[k], C)[u] = v; }

function Campo({ it, C, mudou }) {
  const v = obter(C, it.p);
  // α calculado vem com 15 casas: o campo mostra até 4 (o valor guardado não muda)
  const mostrar = (x) => (Number.isFinite(x) ? String(Math.round(x * 1e4) / 1e4) : String(x));
  const [txt, setTxt] = useState(mostrar(v));
  useEffect(() => setTxt(mostrar(v)), [v]);
  const aplicar = (x) => { const n = Number(x); if (!Number.isFinite(n)) return; definir(C, it.p, n); mudou(); };
  return html`
    <div class="bsc-campo">
      <label for=${'bsc_' + it.p}>${it.l}${it.u ? html` <em>(${it.u})</em>` : ''}${it.hint ? html`<span>${it.hint}</span>` : ''}</label>
      <input type="range" min=${it.min} max=${it.max} step=${it.step} value=${Number.isFinite(v) ? v : 0} aria-label=${it.l}
             onInput=${(e) => { setTxt(e.target.value); aplicar(e.target.value); }} />
      <input type="number" id=${'bsc_' + it.p} min=${it.min} max=${it.max} step=${it.step} value=${txt}
             onInput=${(e) => setTxt(e.target.value)} onChange=${(e) => aplicar(e.target.value)} />
    </div>`;
}

export function BeltScanConfig({ onFechar, onMsg, aba: abaInicial = 'Extração' }) {
  const motor = obterMotor();
  const [aba, setAba] = useState(abaInicial);
  const [, setV] = useState(0);
  const C = motor.C;
  const mudou = (reiniciar = false) => {
    motor.mudou(); if (reiniciar) motor.reiniciar(false);
    salvarSeMudou(); avisarAgora(); setV((n) => n + 1);
  };
  const msg = (t) => onMsg && onMsg(t);

  const img = porImagem();     // marcações do BeltScan na imagem do app valem sobre estes campos
  const corpo = ABAS[aba].map((it, i) => {
    const k = it.p || it.type + i;
    if (it.type === 'bool') {
      return html`<label key=${k} class="bsc-check"><input type="checkbox" checked=${Boolean(obter(C, it.p))}
        onChange=${(e) => { definir(C, it.p, e.target.checked); mudou(); }} /><span>${it.l}${it.hint ? html` <em>${it.hint}</em>` : ''}</span></label>`;
    }
    if (it.type === 'select') {
      return html`<label key=${k} class="bsc-sel"><span>${it.l}</span>
        <select value=${String(obter(C, it.p))} onChange=${(e) => { const v = e.target.value; definir(C, it.p, Number.isNaN(+v) ? v : +v); mudou(); }}>
          ${it.opts.map(([v, l]) => html`<option key=${v} value=${String(v)}>${l}</option>`)}
        </select></label>`;
    }
    if (it.type === 'note') return html`<p key=${k} class="bsc-nota">${it.t}</p>`;
    if (it.type === 'roi') {
      return html`<div key=${k} class="bsc-campo"><label>${it.l}<span>${img.busca ? 'definido na imagem (marcação “Faixa de busca”)' : 'ou arraste na imagem da câmera'}</span></label>
        <div class="bsc-roi">${[0, 1, 2, 3].map((j) => html`<input key=${j} type="number" aria-label=${'ROI ' + j} value=${C.extraction.roi[j]}
          onChange=${(e) => { C.extraction.roi[j] = Math.round(+e.target.value); mudou(); }} />`)}</div></div>`;
    }
    if (it.type === 'excl') {
      const L = C.extraction.exclude;
      return html`<div key=${k}>
        <p class="bsc-nota">Zonas de exclusão: colunas ignoradas na leitura (mão, suporte, reflexo). Crie com Shift + arrastar na imagem ou com o seletor “Arrastar: exclusão”.${img.exclusao ? ' Definido na imagem: as marcações “Exclusão BS” do vídeo do app.' : ''}</p>
        ${L.length ? L.map(([a, b], j) => html`<div key=${j} class="bsc-excl"><span>colunas ${a} a ${b}</span>
          <button class="bsc-btn" onClick=${() => { L.splice(j, 1); mudou(); }}>Remover</button></div>`) : html`<p class="bsc-nota">Nenhuma zona de exclusão.</p>`}
      </div>`;
    }
    if (it.type === 'cammodel') {
      return html`<label key=${k} class="bsc-sel"><span>Modelo da câmera <em>preenche o campo de visão ou f e pixel</em></span>
        <select value=${C.geo.camera || 'custom'} onChange=${(e) => {
          const c = CAMERAS[e.target.value]; C.geo.camera = e.target.value;
          if (c && e.target.value !== 'custom') for (const q of ['hfov_deg', 'f_mm', 'pix_um']) if (c[q] !== undefined) C.geo[q] = c[q];
          mudou(); msg(`Câmera: ${CAMERAS[e.target.value].label}.`);
        }}>${Object.entries(CAMERAS).map(([v, c]) => html`<option key=${v} value=${v}>${c.label}</option>`)}</select></label>`;
    }
    if (it.type === 'geonote') {
      const r = motor.retrato;
      return html`<p key=${k} class="bsc-nota">BCC950: a Logitech publica o campo de visão (70,42° × 43,3°), que é o que a triangulação usa — f_px = (W/2)/tan(35,21°).
        ${r ? html` Agora: ${r.W}×${r.H}, f_px ${fmt(r.G.fpx, 0)} px.` : ''} Com b e H_c medidos, “Estimar α” resolve α = θ0 − atan((v_ref − c_v)/(s·f_px)), θ0 = atan(b/H_c).</p>`;
    }
    if (it.type === 'calpoints') {
      const pts = C.cal.points;
      return html`<div key=${k}>
        <p class="bsc-nota">Coloque um bloco de altura conhecida sob a linha e use “Calibrar com bloco”. Cada ponto guarda a linha na referência, a linha sobre o bloco e a altura. O ajuste encontra α, o sentido de v e, se ligado, b.</p>
        <pre class="bsc-out">${pts.length ? pts.map((p, j) => `${j + 1}. v_ref ${fmt(p[0], 2)}  v_bloco ${fmt(p[1], 2)}  h ${fmt(p[2], 1)} mm`).join('\n') : 'Nenhum ponto.'}</pre>
        <div class="bsc-acoes">
          <button class="bsc-btn" onClick=${() => { const f = motor.reajustarCalibracao(); if (f) { mudou(); msg(`Reajuste: α ${fmt(f.a, 2)}°, b ${fmt(f.b, 0)} mm, rms ${fmt(f.rms, 2)} mm.`); } }}>Reajustar com os pontos</button>
          <button class="bsc-btn" onClick=${() => { motor.limparCalibracao(); mudou(); msg(motor.status); }}>Limpar calibração</button>
        </div></div>`;
    }
    if (it.type === 'alarms') {
      const z = C.alarms.find((a) => a.tag === 'ZI-103');
      return html`<div key=${k}>
        <p class="bsc-nota">Cada alarme tem limite, banda morta (histerese), retardo para ativar e para normalizar, prioridade e “exige altura” (ISA-18.2). Com “exige altura”, o alarme só entra com o produto acima da altura limite (aba Limite). Nos HI-101 o limite é o excesso em mm sobre a altura limite.</p>
        ${C.alarms.map((a, j) => html`<div key=${a.tag} class="bsc-alarme">
          <div class="bsc-al1"><input type="checkbox" checked=${a.on} aria-label=${'Habilitar ' + a.tag} onChange=${(e) => { a.on = e.target.checked; mudou(); }} />
            <span><b>${a.tag}</b><br /><em>${a.text}</em></span>
            <select aria-label="Prioridade" value=${String(a.prio)} onChange=${(e) => { a.prio = +e.target.value; mudou(); }}>${[1, 2, 3].map((p) => html`<option key=${p} value=${String(p)}>P${p}</option>`)}</select></div>
          <div class="bsc-al2">
            ${[['thr', 'Limite'], ['db', 'Banda morta'], ['delay_s', 'Ativa após s'], ['off_delay_s', 'Normaliza após s']].map(([q, l]) => html`
              <label key=${q}>${l}<input type="number" step="any" value=${a[q]} onChange=${(e) => { a[q] = +e.target.value; mudou(); }} /></label>`)}
            <label class="bsc-g"><input type="checkbox" checked=${a.gate} onChange=${(e) => { a.gate = e.target.checked; mudou(); }} />exige altura</label>
          </div></div>`)}
        ${z && html`<label class="bsc-sel"><span>ZI-103: carga mínima para avaliar <em>% de enchimento</em></span>
          <input type="number" value=${z.min_fill ?? 10} onChange=${(e) => { z.min_fill = +e.target.value; mudou(); }} /></label>`}
      </div>`;
    }
    if (it.type === 'camera') return html`<${AbaCamera} key=${k} msg=${msg} />`;
    if (it.type === 'file') return html`<${AbaArquivo} key=${k} mudou=${mudou} msg=${msg} />`;
    const daImagem = img.velocidade && (it.p === 'bench.flow_near_px' || it.p === 'bench.flow_far_px');
    return html`<${Campo} key=${k} it=${daImagem ? { ...it, hint: 'definido na imagem (marcação “Velocidade”)' } : it} C=${C} mudou=${() => mudou()} />`;
  });

  return html`
    <aside class="bsc-cfg" role="dialog" aria-label="Configurar o BeltScan">
      <div class="bsc-cfg-top"><b>Configurar</b><span>${listaPerfis().find((p) => p.id === perfilAtivo())?.nome || perfilAtivo()}</span>
        <button class="bsc-btn" onClick=${onFechar} aria-label="Fechar a configuração">Fechar</button></div>
      <div class="bsc-abas" role="tablist">
        ${Object.keys(ABAS).map((a) => html`<button key=${a} role="tab" aria-selected=${a === aba} class=${a === aba ? 'on' : ''} onClick=${() => setAba(a)}>${a}</button>`)}
      </div>
      <div class="bsc-form">${corpo}</div>
    </aside>`;
}

/** Controles que o driver da câmera expõe (exposição manual é obrigatória: a linha não pode "respirar"). */
function AbaCamera({ msg }) {
  const tr = trilhaDaCamera();
  const [, setV] = useState(0);
  if (!tr) {
    return html`<p class="bsc-nota">Ligue uma câmera em <b>Fonte</b> (barra do app). Os controles que o driver expõe aparecem aqui (exposição, ganho, foco, balanço de branco). Exposição fixa é obrigatória: com a automática, a linha muda de intensidade a cada quadro. No Python: --exposure.</p>`;
  }
  const cap = tr.getCapabilities ? tr.getCapabilities() : {}, st = tr.getSettings ? tr.getSettings() : {};
  const ctl = [['exposureTime', 'Tempo de exposição'], ['exposureCompensation', 'Compensação de exposição'], ['brightness', 'Brilho'], ['contrast', 'Contraste'],
    ['saturation', 'Saturação'], ['sharpness', 'Nitidez'], ['focusDistance', 'Foco'], ['colorTemperature', 'Temperatura de cor']].filter(([k]) => cap[k] && cap[k].max !== undefined);
  const ap = (c) => tr.applyConstraints({ advanced: [c] }).then(() => setV((n) => n + 1)).catch((e) => msg('A câmera recusou o ajuste: ' + e.message));
  return html`<div>
    <p class="bsc-nota">${st.width}×${st.height} @ ${fmt(st.frameRate || 0, 0)} fps · ${tr.label}</p>
    ${cap.exposureMode && html`<label class="bsc-sel"><span>Modo de exposição</span>
      <select value=${st.exposureMode} onChange=${(e) => ap({ exposureMode: e.target.value })}>${cap.exposureMode.map((m) => html`<option key=${m}>${m}</option>`)}</select></label>`}
    ${ctl.length ? ctl.map(([k, l]) => html`<div key=${k} class="bsc-campo"><label>${l}<span>${cap[k].min}–${cap[k].max}</span></label>
        <input type="range" min=${cap[k].min} max=${cap[k].max} step=${cap[k].step || 1} value=${st[k] ?? cap[k].min}
               onChange=${(e) => ap({ [k]: +e.target.value, ...(k === 'exposureTime' ? { exposureMode: 'manual' } : {}) })} />
        <input type="number" value=${st[k] ?? ''} onChange=${(e) => ap({ [k]: +e.target.value })} /></div>`)
      : html`<p class="bsc-nota">O navegador não expõe controles desta câmera. Fixe a exposição no software do fabricante.</p>`}
  </div>`;
}

function AbaArquivo({ mudou, msg }) {
  const motor = obterMotor();
  const [perfis, setPerfis] = useState(listaPerfis);
  const C = motor.C;
  const resumo = JSON.stringify({ ...motor.exportar(), ref_rows: motor.ref ? `[${motor.ref.length} valores]` : null }, null, 1);
  return html`<div>
    <p class="bsc-nota">O arquivo de configuração é o mesmo do GPlanSiS|BELTSCAN: o HTML importa e o programa de borda usa com <code>python beltscan.py --config arquivo.json</code>. Inclui geometria, calibração, correia, análise, alarmes e a referência vazia. A configuração fica salva neste navegador, por perfil (cada ensaio tem o seu).</p>
    <label class="bsc-sel"><span>Perfil</span>
      <select value=${perfilAtivo()} onChange=${async (e) => { await trocarPerfil(e.target.value); mudou(); msg('Perfil: ' + e.target.selectedOptions[0].text); }}>
        ${perfis.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}
      </select></label>
    <div class="bsc-acoes">
      <button class="bsc-btn" onClick=${async () => { const n = await perguntar('Nome do novo perfil (copia a configuração atual):', { titulo: 'Novo perfil', padrao: 'Linha 1', ok: 'Criar perfil' }); if (!n) return; const atual = motor.exportar(); const id = criarPerfil(n); await trocarPerfil(id, { buscarEnsaio: false }); motor.definirConfig(atual); setPerfis(listaPerfis()); mudou(); msg('Perfil criado: ' + n); }}>Novo perfil</button>
      <button class="bsc-btn" onClick=${async () => { if (!(await confirmar('Voltar este perfil à configuração original?', { titulo: 'Restaurar original', ok: 'Restaurar', perigo: true }))) return; await restaurarPerfil(); mudou(); msg(motor.status); }}>Restaurar original</button>
    </div>
    <label class="bsc-sel"><span>Predefinição</span>
      <select value="" onChange=${(e) => { const f = PREDEFINICOES[e.target.value]; if (!f) return; f(C); motor.reiniciar(false); mudou(); msg('Predefinição aplicada: ' + e.target.value); }}>
        <option value="">Escolher…</option>${Object.keys(PREDEFINICOES).map((k) => html`<option key=${k} value=${k}>${k}</option>`)}
      </select></label>
    <div class="bsc-acoes">
      <button class="bsc-btn" onClick=${() => baixar(JSON.stringify(motor.exportar(), null, 2), 'beltscan_config.json', 'application/json')}>Exportar JSON</button>
      <label class="bsc-btn">Importar JSON<input type="file" accept=".json,application/json" class="bsc-sr" onChange=${async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { motor.definirConfig(normalizarConfig(JSON.parse(await f.text()))); mudou(); msg('Configuração importada (' + f.name + ').'); } catch (err) { msg('JSON inválido: ' + err.message); }
        e.target.value = '';
      }} /></label>
      <button class="bsc-btn" onClick=${() => { const c = clonar(PADRAO); if (perfilAtivo().startsWith('feijao')) predefFeijao(c); motor.definirConfig(c, { manterRef: false }); mudou(); msg('Configuração padrão restaurada (sem referência).'); }}>Padrão</button>
    </div>
    <pre class="bsc-out bsc-json">${resumo}</pre>
  </div>`;
}
