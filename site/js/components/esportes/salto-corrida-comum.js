/**
 * components/esportes/salto-corrida-comum.js — o que os painéis Salto
 * (CV-31) e Corrida (CV-32) dividem: estilos, download, relatório numa aba,
 * nó do Pipeline (parâmetros + "Adicionar ao Pipeline") e o bloco "Analisar
 * vídeo quadro a quadro".
 */
import { html, useState, useEffect, useRef } from '../../vendor.js';
import { store, persist } from '../../state/store.js';
import { defaultParams } from '../../cv/registry.js';
import { newNodeId } from '../../cv/executor.js';
import { analisarArquivo } from '../../cv/runtime/livres-h/arquivo.js';

export const css = {
  tab: { width: '100%', borderCollapse: 'collapse', fontSize: '11px', fontVariantNumeric: 'tabular-nums' },
  th: { textAlign: 'left', fontWeight: 500, color: 'var(--ink-3)', fontSize: '9.5px', padding: '3px 3px', borderBottom: '1px solid var(--line-2)' },
  thn: { textAlign: 'right', fontWeight: 500, color: 'var(--ink-3)', fontSize: '9.5px', padding: '3px 3px', borderBottom: '1px solid var(--line-2)' },
  td: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', whiteSpace: 'nowrap' },
  num: { padding: '4px 3px', borderBottom: '1px solid var(--line-2)', textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' },
  sel: { width: '100%', padding: '6px 7px', borderRadius: '7px', border: '1px solid var(--line)', background: 'rgba(0,0,0,.25)', color: 'var(--ink)', font: 'inherit', fontSize: '12px' },
  grade: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 8px', marginBottom: '8px' },
  dot: (c) => ({ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: c, verticalAlign: 'middle', flex: 'none' }),
  alerta: { display: 'flex', gap: '7px', alignItems: 'flex-start', fontSize: '11.5px', lineHeight: 1.5, margin: '0 0 6px' },
  barra: { height: '8px', borderRadius: '3px', background: 'var(--accent)', minWidth: '2px' },
  trilho: { width: '100%', background: 'rgba(255,255,255,.06)', borderRadius: '3px' },
};
export const COR = { ok: '#4ade80', atencao: '#f87171', info: '#94a3b8', e: '#22d3ee', d: '#fb923c' };

export function baixar(nome, texto, tipo) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = document.createElement('a');
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

/** Abre o relatório HTML numa aba (com bloqueio de pop-up, baixa o arquivo). */
export function abrirRelatorio(h, nome) {
  const url = URL.createObjectURL(new Blob([h], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (!w) baixar(nome, h, 'text/html;charset=utf-8');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

const lerPrefs = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { return {}; } };
const gravarPrefs = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* modo privado */ } };

/**
 * Parâmetros do nó `op` no Pipeline (ou preferências locais, sem nó) e as
 * ações de alterar e de adicionar/ligar o nó.
 */
export function useNo(op, prefsKey, nodes) {
  const no = nodes.find((n) => n.op === op);
  const [prefs, setPrefs] = useState(() => ({ ...defaultParams(op), ...lerPrefs(prefsKey) }));
  const cfg = no ? { ...defaultParams(op), ...no.params } : prefs;
  function definir(k, v) {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === op);
    const np = { ...prefs, [k]: v };
    setPrefs(np); gravarPrefs(prefsKey, np);
    if (i >= 0) {
      store.set({ nodes: ns.map((n, j) => (j === i ? { ...n, params: { ...n.params, [k]: v } } : n)) });
      persist();
    }
  }
  function adicionar() {
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === op);
    const novos = i >= 0 ? ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null } : n))
      : [...ns, { id: newNodeId(), op, params: { ...defaultParams(op), ...prefs }, enabled: true }];
    store.set({ nodes: novos, panels: { ...store.get().panels, pipeline: true } });
    persist();
    return i >= 0 ? 'ligado' : 'adicionado';
  }
  return { no, cfg, definir, adicionar };
}

/** Assina um canal e devolve o retrato atual (re-renderiza a cada aviso). */
export function useCanal(canal) {
  const [snap, setSnap] = useState(() => canal.instantaneo());
  const [, setTick] = useState(0);
  useEffect(() => canal.assinar((s) => { setSnap(s); setTick((t) => t + 1); }), [canal]);
  return snap;
}

/**
 * "Analisar vídeo quadro a quadro": escolhe um arquivo, zera a sessão e
 * alimenta-a com cada quadro (tempo exato da mídia ÷ fator de câmera lenta).
 */
/**
 * Props extras (Corrida): coerencia (descarta pose de duas pessoas fundidas),
 * aoAmostra(t, P, info) no lugar de canal.sessao.adicionar, e processador /
 * preparar (várias pessoas: o painel processa cada quadro).
 */
export function AnaliseArquivo({ canal, lenta, inverter, minVis, rotulo, coerencia, aoAmostra, processador, preparar, aoIniciar }) {
  const [prog, setProg] = useState(null);
  const [erro, setErro] = useState('');
  const sinal = useRef(null);
  const input = useRef(null);
  async function rodar(file) {
    if (!file) return;
    setErro('');
    canal.zerar();
    if (aoIniciar) aoIniciar();
    canal.origem = { tipo: 'arquivo', nome: file.name };
    sinal.current = { cancelado: false };
    setProg({ f: 0, fase: 'abrindo o vídeo' });
    try {
      let ultimoAviso = 0;
      const avisar = () => { const agora = performance.now(); if (agora - ultimoAviso > 700) { ultimoAviso = agora; canal.avisarJa(); } };
      const r = await analisarArquivo(file, (t, P, info) => {
        if (aoAmostra) aoAmostra(t, P, info); else canal.sessao.adicionar(t, P, minVis);
        avisar();
      }, {
        lenta, inverter, sinal: sinal.current, coerencia,
        processador: processador ? async (img, t, info) => { const n = await processador(img, t, info); avisar(); return n; } : undefined,
        preparar,
        onProgresso: (f, info) => setProg({ f, ...info }),
      });
      canal.origem = { tipo: 'arquivo', nome: file.name, fps: r.fps, quadros: r.quadros, comPose: r.comPose, incoerentes: r.incoerentes, cancelado: r.cancelado };
      setProg(null);
    } catch (e) {
      setErro(String(e && e.message ? e.message : e));
      setProg(null);
    }
    canal.avisarJa();
  }
  const o = canal.origem;
  return html`
    <div style=${{ margin: '6px 0 4px' }}>
      <input ref=${input} type="file" accept="video/*" style=${{ display: 'none' }}
             onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; rodar(f); }} />
      ${!prog && html`<button class="btn" style=${{ width: '100%' }} onClick=${() => input.current && input.current.click()}
          title="Abre um vídeo e analisa todos os quadros com o tempo exato do arquivo (mais preciso que ao vivo)">
          ${rotulo || 'Analisar vídeo quadro a quadro…'}</button>`}
      ${prog && html`
        <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style=${{ ...css.trilho, flex: 1, height: '8px' }}><div style=${{ ...css.barra, width: `${Math.round((prog.f || 0) * 100)}%` }}></div></div>
          <button class="btn tiny" onClick=${() => { if (sinal.current) sinal.current.cancelado = true; }}>Parar</button>
        </div>
        <p class="hint tight" style=${{ margin: '4px 0 0' }}>${prog.fase}${prog.quadro ? ` · quadro ${prog.quadro}${prog.total ? '/' + prog.total : ''}${prog.fps ? ` a ${String(prog.fps).replace('.', ',')} fps` : ''}` : ''}${prog.restante != null ? ` · faltam ~${Math.ceil(prog.restante)} s` : ''}</p>`}
      ${erro && html`<p class="hint tight" style=${{ color: 'var(--err)' }}>Não deu para analisar: ${erro}</p>`}
      ${o && o.tipo === 'arquivo' && !prog && html`<p class="hint tight" style=${{ margin: '4px 0 0' }}>Dados de <b>${o.nome}</b>${o.fps ? ` · ${o.quadros} quadros a ${String(o.fps).replace('.', ',')} fps${lenta > 1 ? ` (câmera lenta ${lenta}×)` : ''} · pose em ${o.comPose}${o.incoerentes ? ` · ${o.incoerentes} poses incoerentes descartadas` : ''}` : ''}${o.cancelado ? ' · interrompido' : ''}. "Nova sessão" volta ao ao vivo.</p>`}
    </div>`;
}
