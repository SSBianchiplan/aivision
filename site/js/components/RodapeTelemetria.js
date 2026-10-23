/**
 * components/RodapeTelemetria.js — rodapé de monitoramento (linha fina, mono).
 *
 * Mostra as métricas ligadas no painel Telemetria (cv/runtime/telemetria.js),
 * com cor de atenção/erro fora da faixa saudável. Clicar numa métrica abre o
 * painel Telemetria. No celular (≤ 600 px) só aparece se a pessoa pedir
 * («também no celular»); escondido, não assina — o coletor fica parado.
 *
 * Também exporta os hooks que o painel usa: `usePrefsTelemetria` e
 * `useAmostraTelemetria(ligado)`.
 */

import { html, useState, useEffect, Fragment } from '../vendor.js';
import { store, persist } from '../state/store.js';
import {
  METRICAS, lerPrefsTelemetria, onPrefsTelemetria, assinarTelemetria, ultimaAmostra,
} from '../cv/runtime/telemetria.js';

export function usePrefsTelemetria() {
  const [p, setP] = useState(lerPrefsTelemetria);
  useEffect(() => onPrefsTelemetria(setP), []);
  return p;
}

/** Amostra atual (4 Hz) enquanto `ligado`; desligado = sem assinatura (custo zero). */
export function useAmostraTelemetria(ligado) {
  const [a, setA] = useState(() => (ligado ? ultimaAmostra() : null));
  useEffect(() => {
    if (!ligado) { setA(null); return undefined; }
    return assinarTelemetria(setA);
  }, [ligado]);
  return a;
}

function useCelular() {
  const q = '(max-width: 600px)';
  const [cel, setCel] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mq = matchMedia(q);
    const f = () => setCel(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f));
  }, []);
  return cel;
}

export function abrirTelemetria() {
  store.set((s) => ({
    panels: { ...s.panels, stats: true },
    recolhidos: { ...(s.recolhidos || {}), stats: false },
  }));
  persist();
}

export function RodapeTelemetria() {
  const prefs = usePrefsTelemetria();
  const cel = useCelular();
  const ligado = prefs.rodape && (!cel || prefs.celular);
  const a = useAmostraTelemetria(ligado);

  // o CSS abre espaço para o rodapé (barra de vídeo e atalhos sobem) só enquanto ele existe
  useEffect(() => {
    document.body.classList.toggle('com-rodape-tel', ligado);
    return () => document.body.classList.remove('com-rodape-tel');
  }, [ligado]);

  if (!ligado) return null;
  const itens = [];
  if (a) {
    for (const m of METRICAS) {
      if (!prefs.mostrar[m.id]) continue;
      let f = null;
      try { f = m.fmt(a); } catch (_) { f = null; }
      if (f) itens.push({ id: m.id, t: f.t, n: f.n, desc: m.desc });
    }
  }
  return html`
    <div class="rodape-tel" role="status" aria-live="off" aria-label="Monitoramento de desempenho">
      ${!a ? html`<span class="rt-i">telemetria…</span>`
        : itens.length === 0 ? html`<button class="rt-i" onClick=${abrirTelemetria}>nenhuma métrica ligada — escolher na Telemetria</button>`
        : itens.map((it, i) => html`<${Fragment} key=${it.id}>
          ${i > 0 && html`<span class="rt-sep" aria-hidden="true">·</span>`}
          <button class=${'rt-i' + (it.n ? ' ' + it.n : '')} title=${it.desc + ' — clique para abrir a Telemetria'}
                  onClick=${abrirTelemetria}>${it.t}</button><//>`)}
    </div>
  `;
}
