/**
 * components/ContextPanel.js — módulo Contexto.
 *
 * Congela um frame e pergunta quatro coisas sobre ele: LER, CONTAR,
 * DESCREVER, ANALISAR. Cada observação percorre o ciclo de vida
 * CAPTURED → RESOLVED → BOUND → IN_PROCESS ⇄ EXCEPTION → COMPLETED → ARCHIVED,
 * e o painel mostra em qual estado ela está — para a pergunta «por que a
 * descrição não saiu?» ter resposta em vez de silêncio.
 */

import { html, useState, useEffect, useRef } from '../vendor.js';
import { Panel } from './Panel.js';
import { store } from '../state/store.js';
import { ContextEngine, TASKS, modelsFor } from '../cv/context/engine.js';
import {
  novaTranscricao, acumular, exportarTexto, exportarCorrido,
} from '../cv/context/transcript.js';
import { STATE, STATE_META } from '../cv/context/lifecycle.js';
import { modelStates, onModelState, agplAccepted } from '../cv/runtime/onnx.js';

const ORDER = [STATE.CAPTURED, STATE.RESOLVED, STATE.BOUND,
               STATE.IN_PROCESS, STATE.COMPLETED, STATE.ARCHIVED];

export function ContextPanel({ onClose, getFrame, ...layout }) {
  const engine = useRef(null);
  if (!engine.current) engine.current = new ContextEngine();

  const [obs, setObs] = useState([]);
  const [tasks, setTasks] = useState(['read', 'count', 'describe', 'analyze']);
  const [detector, setDetector] = useState('yolox');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(null);
  const [mstates, setMstates] = useState(() => modelStates());
  const [live, setLive] = useState(false);
  const [intervalS, setIntervalS] = useState(3);
  const loop = useRef({ on: false, timer: null, intervalS: 3 });

  /*
   * TRANSCREVER: o texto lido, acumulado entre observações.
   *
   * Vive num ref E num estado. O ref é o que a volta do laço atualiza (uma
   * closure já em andamento leria um estado congelado); o estado é só para
   * a tela redesenhar. `transOn` também mora no ref pelo mesmo motivo.
   */
  const trans = useRef(novaTranscricao());
  const [transView, setTransView] = useState(trans.current);
  const [transOn, setTransOn] = useState(false);
  const transOnRef = useRef(false);
  useEffect(() => { transOnRef.current = transOn; }, [transOn]);

  // o laço lê o intervalo do ref: mexer no slider durante a execução
  // tem efeito na próxima volta, sem precisar parar e recomeçar
  useEffect(() => { loop.current.intervalS = intervalS; }, [intervalS]);

  useEffect(() => engine.current.onChange((l) => setObs([...l])), []);
  useEffect(() => onModelState(setMstates), []);

  const needed = modelsFor(tasks);
  const missing = needed.filter((m) => !mstates[m] || mstates[m].status !== 'ready');

  const toggle = (t) => setTasks((cur) =>
    cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);

  /** Uma observação. Devolve true se conseguiu rodar. */
  const observeOnce = async (abrir = true) => {
    if (!tasks.length) { setErr('Escolha ao menos uma tarefa.'); return false; }
    const frame = getFrame();
    if (!frame) { setErr('Sem imagem — ligue a câmera ou abra um arquivo.'); return false; }
    setBusy(true);
    try {
      /*
       * Transcrever exige LER, mesmo que a pessoa tenha desmarcado LER nas
       * tarefas: sem OCR não há o que acumular. Acrescenta em silêncio.
       */
      const lista = transOnRef.current && !tasks.includes('read') ? [...tasks, 'read'] : tasks;
      const o = await engine.current.observe(frame, { tasks: lista, detector });
      if (transOnRef.current && o.result && o.result.read) {
        trans.current = acumular(trans.current, o.result.read.items, Date.now(), { minChars: 2 });
        setTransView(trans.current);
      }
      if (abrir) setOpen(o.id);
      setErr(null);
      return true;
    } catch (e) {
      setErr(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const observe = () => observeOnce(true);

  /*
   * OBSERVAÇÃO CONTÍNUA.
   *
   * O laço é encadeado (setTimeout ao FIM de cada volta), não periódico
   * (setInterval). Com intervalo fixo, uma observação que demore mais que o
   * período empilharia chamadas até afogar o navegador — e a de OCR + detecção
   * chega a alguns segundos. Assim o intervalo é o descanso ENTRE leituras, e
   * o ritmo se adapta sozinho ao que o aparelho aguenta.
   *
   * O laço vive num ref, não no estado: `loop.current.on` é lido dentro de uma
   * closure que já começou, e um valor de estado ali estaria congelado no
   * render em que a volta nasceu — o botão Parar não teria efeito até a
   * próxima montagem.
   */
  const runLoop = async () => {
    if (!loop.current.on) return;
    await observeOnce(false);
    if (!loop.current.on) return;
    loop.current.timer = setTimeout(runLoop, Math.max(0, loop.current.intervalS * 1000));
  };

  const toggleLive = () => {
    if (loop.current.on) {
      loop.current.on = false;
      clearTimeout(loop.current.timer);
      loop.current.timer = null;
      setLive(false);
      return;
    }
    loop.current.on = true;
    setLive(true);
    runLoop();
  };

  // desmontar o painel não pode deixar o laço rodando em segundo plano
  useEffect(() => () => {
    loop.current.on = false;
    clearTimeout(loop.current.timer);
  }, []);

  return html`
    <${Panel} id="context" title="Contexto"
              subtitle=${obs.length ? `${obs.length} observação(ões)` : 'visão descritiva'}
              onClose=${onClose} ...${layout}>

      <p class="hint">
        Congela o frame e o interpreta com os modelos instalados. A narrativa é
        montada por <b>regras</b>, não por modelo de linguagem — o que garante
        que nada seja afirmado sem que um detector tenha visto.
      </p>

      <div class="ctx-tasks">
        ${Object.entries(TASKS).map(([k, t]) => html`
          <button key=${k} class="ctx-task ${tasks.includes(k) ? 'on' : ''}"
                  onClick=${() => toggle(k)}>
            <b>${t.label}</b>
            <em>${TASK_HINT[k]}</em>
          </button>
        `)}
        <button class="ctx-task trans ${transOn ? 'on' : ''}"
                onClick=${() => setTransOn((v) => !v)}
                title="Acumula o texto lido ao longo das observações, sem repetir">
          <b>TRANSCREVER</b>
          <em>texto corrido no tempo</em>
        </button>
      </div>

      ${agplAccepted() && html`
        <label class="ctl">
          <span class="ctl-label">Detector</span>
          <select value=${detector} onChange=${(e) => setDetector(e.target.value)}>
            <option value="yolox">YOLOX-S — Apache-2.0</option>
            <option value="yolo26">YOLO26n — AGPL-3.0</option>
          </select>
        </label>
      `}

      ${missing.length > 0 && html`
        <p class="hint tight">
          Primeira execução baixa ${missing.length} modelo(s): <b>${missing.join(', ')}</b>. Depois fica em cache.
        </p>
      `}

      ${err && html`<div class="mdl-err">${err}</div>`}

      <div class="row">
        <button class="btn accent" disabled=${busy || live} onClick=${observe}>
          ${busy && !live ? 'Observando…' : 'Observar uma vez'}
        </button>
        <button class="btn ${live ? 'danger' : ''}" onClick=${toggleLive}>
          ${live ? '■ Parar' : '▶ Contínuo'}
        </button>
      </div>

      ${live && html`
        <div class="ctx-live">
          <i></i>
          <span>observando a cada ${intervalS}s · ${obs.length} leitura(s)</span>
        </div>
      `}

      <label class="ctl">
        <span class="ctl-label">Intervalo entre leituras<b>${intervalS}s</b></span>
        <input type="range" min="0" max="30" step="1" value=${intervalS}
               onInput=${(e) => setIntervalS(parseInt(e.target.value, 10))} />
      </label>
      <p class="hint tight">
        Descanso <b>entre</b> leituras, não período fixo: a próxima só começa
        quando a anterior termina, então observações lentas não se empilham.
        Em <b>0s</b> o sistema lê o mais rápido que conseguir.
      </p>

      ${transOn && html`
        <${Transcricao} estado=${transView} live=${live}
          onLimpar=${() => { trans.current = novaTranscricao(); setTransView(trans.current); }} />
      `}

      ${obs.length > 0 && html`
        <div class="row">
          <button class="btn" onClick=${() => { engine.current.clear(); setOpen(null); }}>
            Limpar histórico
          </button>
        </div>
      `}

      ${obs.map((o) => html`
        <${ObsCard} key=${o.id} obs=${o}
          open=${open === o.id}
          onToggle=${() => setOpen(open === o.id ? null : o.id)}
          onRetry=${() => engine.current.retry(o.id)}
          onArchive=${() => engine.current.archive(o.id)} />
      `)}
    <//>
  `;
}

const TASK_HINT = {
  read: 'texto na imagem',
  count: 'quantos e de quê',
  describe: 'a cena em uma frase',
  analyze: 'o que isso significa',
};

// =============================================================== transcrição

/**
 * O texto acumulado. Mostra as últimas linhas (as novas embaixo, como um
 * terminal) e exporta o todo. O arquivo sai com hora de aparição por linha —
 * numa reunião, saber QUANDO o slide mudou vale tanto quanto o que dizia.
 */
function Transcricao({ estado, live, onLimpar }) {
  const [copiado, setCopiado] = useState(false);
  const linhas = estado.linhas;
  const ultimas = linhas.slice(-40);

  const baixar = () => {
    const blob = new Blob([exportarTexto(estado)], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date(estado.inicio || Date.now());
    a.download = `transcricao-${d.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  const copiar = () => {
    navigator.clipboard.writeText(exportarCorrido(estado))
      .then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1400); })
      .catch(() => {});
  };

  return html`
    <div class="ctx-trans">
      <div class="ctx-trans-h">
        <b>Transcrição</b>
        <em>${linhas.length} linha(s)${estado.novasNaUltima ? ` · +${estado.novasNaUltima} na última leitura` : ''}</em>
      </div>

      ${linhas.length === 0
        ? html`<p class="empty">
            ${live ? 'Lendo… o texto aparece aqui conforme surge na tela.'
                   : 'Nada ainda. Clique em Observar ou ligue o modo Contínuo com uma tela ou vídeo com texto.'}
          </p>`
        : html`
          <div class="ctx-trans-body" role="log" aria-live="polite">
            ${/*
               * A caixa usa flex column-reverse para o FIM ficar ancorado à
               * vista sem JavaScript de rolagem. Isso inverte a ordem visual
               * dos filhos — então o DOM vai do mais novo ao mais antigo, e a
               * tela mostra do mais antigo (em cima) ao mais novo (embaixo).
               * O aviso "anteriores" fica por último no DOM para aparecer no topo.
               */
              [...ultimas].reverse().map((l) => html`
              <div key=${l.chave} class="ctx-trans-l">
                <time>${new Date(l.primeira).toLocaleTimeString('pt-BR')}</time>
                <span>${l.texto}</span>
                ${l.vezes > 1 && html`<i title="vista em ${l.vezes} leituras">×${l.vezes}</i>`}
              </div>
            `)}
            ${linhas.length > ultimas.length && html`
              <div class="ctx-trans-mais">… ${linhas.length - ultimas.length} linha(s) anteriores no arquivo</div>`}
          </div>
        `}

      <div class="row">
        <button class="btn tiny" disabled=${!linhas.length} onClick=${baixar}>Exportar .txt</button>
        <button class="btn tiny" disabled=${!linhas.length} onClick=${copiar}>${copiado ? '✓ copiado' : 'Copiar texto'}</button>
        <button class="btn tiny" disabled=${!linhas.length} onClick=${onLimpar}>Limpar</button>
      </div>
      <p class="hint tight">
        Só entra o que é <b>novo</b>: a mesma linha lida várias vezes conta uma
        vez (×N). Caixa, acento e pontuação não separam. Funciona melhor com <b>Contínuo</b> e uma fonte que muda — tela, vídeo, slides.
      </p>
    </div>
  `;
}

// =============================================================== cartão

function ObsCard({ obs, open, onToggle, onRetry, onArchive }) {
  const meta = STATE_META[obs.state];
  const r = obs.result;

  return html`
    <div class="ctxobs ${obs.state.toLowerCase()}">
      <button class="ctxobs-head" onClick=${onToggle}>
        <span class="ctxobs-state" style=${{ color: meta.color, borderColor: meta.color + '55' }}>
          ${meta.short}
        </span>
        <span class="ctxobs-title">
          ${r && r.describe ? truncate(r.describe.narrative, 52)
            : r && r.count ? truncate(r.count.narrative, 52)
            : meta.desc}
        </span>
        <span class="ctxobs-time">${(obs.elapsedMs / 1000).toFixed(1)}s</span>
      </button>

      <${Track} obs=${obs} />

      ${open && html`
        <div class="ctxobs-body">
          ${obs.problems.length > 0 && html`
            <div class="ctx-prob">
              ${obs.problems.map((p, i) => html`
                <div key=${i}>⚠ <b>${p.task}</b>: ${p.message}</div>`)}
              ${obs.state === STATE.EXCEPTION && html`
                <button class="btn tiny" onClick=${onRetry}>
                  Retomar com o que já temos
                </button>`}
            </div>
          `}

          ${r && r.read && html`
            <${Section} titulo="LER" texto=${r.read.narrative}>
              ${r.read.items.length > 0 && html`
                <div class="ctx-items">
                  ${r.read.items.map((t, i) => html`
                    <div key=${i} class="ctx-item">
                      <code>${t.text}</code>
                      <span>${t.confianca}%${t.sobre ? ` · sobre ${t.sobre}` : ''}</span>
                    </div>
                  `)}
                </div>`}
            <//>
          `}

          ${r && r.count && html`
            <${Section} titulo="CONTAR" texto=${r.count.narrative}>
              ${Object.keys(r.count.byClass).length > 0 && html`
                <div class="ctx-bars">
                  ${Object.entries(r.count.byClass).map(([k, v]) => html`
                    <div key=${k} class="ctx-bar">
                      <span>${k}</span>
                      <i style=${{ width: Math.min(100, (v / r.count.total) * 100) + '%' }}></i>
                      <b>${v}</b>
                    </div>
                  `)}
                </div>`}
            <//>
          `}

          ${r && r.describe && html`
            <${Section} titulo="DESCREVER" texto=${r.describe.narrative}>
              <div class="ctx-meta">
                ${r.describe.scene.map((s, i) => html`
                  <span key=${i}>${s.label} ${(s.score * 100) | 0}%</span>`)}
                <span>ocupação ${r.describe.occupancy}%</span>
                ${r.describe.faces !== null && r.describe.faces !== undefined
                  && html`<span>${r.describe.faces} rosto(s)</span>`}
              </div>
            <//>
          `}

          ${r && r.analyze && html`
            <${Section} titulo="ANALISAR" texto=${null}>
              <div class="ctx-conf ${r.analyze.confianca.rotulo}">
                confiança <b>${r.analyze.confianca.valor}%</b> (${r.analyze.confianca.rotulo}) ${r.analyze.confianca.razoes.length > 0
                  && html`<em>${r.analyze.confianca.razoes.join(' · ')}</em>`}
              </div>
              ${r.analyze.achados.map((a, i) => html`
                <div key=${i} class="ctx-find ${a.nivel}">
                  <span>${a.tipo}</span>${a.texto}
                </div>
              `)}
            <//>
          `}

          <div class="row tight">
            <button class="btn tiny" onClick=${() => {
              const blob = new Blob([JSON.stringify(obs.toJSON(), null, 2)],
                                    { type: 'application/json' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `contexto-${obs.id}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            }}>Exportar JSON</button>
            ${obs.state === STATE.COMPLETED && html`
              <button class="btn tiny" onClick=${onArchive}>Arquivar</button>`}
          </div>
        </div>
      `}
    </div>
  `;
}

/** A trilha do ciclo de vida, com o tempo gasto em cada etapa. */
function Track({ obs }) {
  const done = new Set(obs.history.map((h) => h.state));
  const times = Object.fromEntries(obs.timings().map((t) => [t.state, t.ms]));
  const exc = obs.state === STATE.EXCEPTION;

  return html`
    <div class="ctx-track ${exc ? 'exc' : ''}">
      ${ORDER.map((st, i) => {
        const m = STATE_META[st];
        const reached = done.has(st);
        const atual = obs.state === st;
        return html`
          <div key=${st} class="ctx-step ${reached ? 'done' : ''} ${atual ? 'now' : ''}"
               title=${`${m.label} — ${m.desc}`}>
            <i style=${reached ? { background: m.color } : null}></i>
            <span>${m.short}</span>
            ${times[st] > 0 && html`<em>${fmtMs(times[st])}</em>`}
            ${i < ORDER.length - 1 && html`<u class=${reached ? 'done' : ''}></u>`}
          </div>
        `;
      })}
      ${exc && html`
        <div class="ctx-step exc now" title=${STATE_META.EXCEPTION.desc}>
          <i style=${{ background: STATE_META.EXCEPTION.color }}></i>
          <span>EXC</span>
        </div>`}
    </div>
  `;
}

function Section({ titulo, texto, children }) {
  return html`
    <div class="ctx-sec">
      <div class="ctx-sec-t">${titulo}</div>
      ${texto && html`<p>${texto}</p>`}
      ${children}
    </div>
  `;
}

const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');
const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms');
