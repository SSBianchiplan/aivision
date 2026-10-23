/**
 * components/Panels.js — os cinco painéis do protótipo.
 *
 * Módulos · Modelos · Pipeline · Fonte · Telemetria · Exportar.
 * Todos leem e escrevem no store; nenhum conhece o loop de render.
 */

import { html, useState, useRef, useEffect, Fragment } from '../vendor.js';
import { Panel, ParamControl } from './Panel.js';
import { setZoom } from './Viewport.js';
import { registrarTreinados } from '../cv/operators/custom.js';
import { registrarTreinadosLivres } from '../cv/operators/livres-c.js';
import { useStore, store, persist } from '../state/store.js';
import { MODULES, operatorsOf, getOperator, defaultParams, OPERATOR_COUNT } from '../cv/registry.js';
import { toGraph, fromGraph, newNodeId } from '../cv/executor.js';
import { RESOLUTIONS, FPS_OPCOES, fpsPreferido, definirFps, cameraAtual } from '../camera/device.js';
import { disponivel as telaDisponivel } from '../camera/screen.js';
import { YouTubeSection } from './YouTubeSource.js';
import { SeletorCamera, tipoDaCamera } from './SeletorCamera.js';
import { acharUltima, textoSettings, ICONE_IP, ICONE_BT } from '../camera/seletor.js';
import { PRESETS_ONDA1A, criarMarcacoesModelo } from './presets-onda1a.js';
import { PRESETS_ONDA2B, criarMarcacoesModeloOnda2b } from './presets-onda2b.js';   // onda 2-b (CV-60..67)
import { PRESETS_ONDA2A, criarMarcacoesModeloOnda2a } from './presets-onda2a.js';   // onda 2-a (CV-49..59)
import { PRESETS_ONDA2C, criarMarcacoesOnda2c } from './presets-onda2c.js';
import { PRESETS_ONDA2D, criarMarcacoesModeloOnda2d } from './presets-onda2-d.js';
import { PRESETS_MOTION3D } from './presets-motion3d.js';   // CV-88 Motion 3D Studio
import {
  PADRAO as STREAM_PADRAO, urlRtmp, conteudoMisto, diagnosticar, ehRedeLocal, baseHttps,
} from '../camera/stream.js';
import {
  MODELS as ORT_MODELS, AGPL_MODELS, modelStates, onModelState, loadModel,
  unload as unloadModel, supportsWebGPU, isIsolated, agplAccepted, setAgplAccepted,
} from '../cv/runtime/onnx.js';

// =============================================================== Módulos

export function ModulesPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (s) => s.nodes);

  const addOp = (op) => {
    store.set((s) => ({
      nodes: [...s.nodes, { id: newNodeId(), op, params: defaultParams(op), enabled: true }],
      panels: { ...s.panels, pipeline: true },
    }));
    persist();
  };

  return html`
    <${Panel} id="modules" title="Módulos" subtitle=${`${OPERATOR_COUNT} operadores`}
              onClose=${onClose} ...${layout}>
      <p class="hint">
        Catálogo de capacidades do SPEC §4.2. Clique num operador para
        acrescentá-lo ao fim do pipeline.
      </p>

      ${MODULES.map((m) => html`<${ModuleCard} key=${m.id} mod=${m} nodes=${nodes} onAdd=${addOp} />`)}
    <//>
  `;
}

function ModuleCard({ mod, nodes, onAdd }) {
  const ready = mod.status === 'ready';
  const [open, setOpen] = useState(ready && mod.id === 'CV-01');
  const ops = ready ? operatorsOf(mod.id) : [];

  return html`
    <div class="mod ${mod.status}">
      <button class="mod-head" onClick=${() => ready && setOpen((o) => !o)}
              disabled=${!ready} aria-expanded=${open}>
        <span class="mod-id">${mod.id}</span>
        <span class="mod-name">${mod.name}</span>
        <span class="mod-tag ${mod.status}">
          ${mod.status === 'ready' ? `${ops.length} ops`
            : mod.status === 'locked' ? '🔒 travado' : 'planejado'}
        </span>
        ${ready && html`<span class="mod-caret">${open ? '−' : '+'}</span>`}
      </button>

      ${!ready && html`
        <div class="mod-note">
          ${mod.desc}
          ${mod.blockedBy && html`<b class="blocked">⚠ ${mod.blockedBy}</b>`}
        </div>
      `}

      ${open && html`
        <div class="mod-ops">
          ${ops.map((o) => {
            const used = nodes.filter((n) => n.op === o.op).length;
            return html`
              <button key=${o.op} class="op" onClick=${() => onAdd(o.op)} title=${o.desc}>
                <span class="op-label">${o.label}</span>
                <code>${o.op}</code>
                ${used > 0 && html`<i class="op-used">${used}×</i>`}
              </button>
            `;
          })}
        </div>
      `}
    </div>
  `;
}

// =============================================================== Pipeline

export function PipelinePanel({ onClose, onResetState, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  return html`
    <${Panel} id="pipeline" title="Pipeline"
              subtitle=${`${nodes.filter((n) => n.enabled).length}/${nodes.length} ativos`}
              onClose=${onClose} ...${layout}>
      <${PipelineConteudo} onResetState=${onResetState} />
    <//>
  `;
}

/**
 * Corpo do Pipeline (nós com ↑/↓, ◉/○, ✕, parâmetros do selecionado e
 * presets). Usado pelo painel acima e pelo popover "Pipeline" do Studio Bike
 * Fit (components/esportes/StudioBikeFit.js). `presetsPrimeiro`: grupos de
 * preset que aparecem antes dos outros.
 */
export function PipelineConteudo({ onResetState, presetsPrimeiro = null }) {
  const s = useStore(store, (st) => ({ nodes: st.nodes, selected: st.selectedNode }));

  const update = (fn) => {
    store.set((st) => ({ nodes: fn(st.nodes) }));
    persist();
  };

  const move = (i, dir) => {
    const j = i + dir;
    update((ns) => {
      if (j < 0 || j >= ns.length) return ns;
      const copy = [...ns];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const remove = (id) => {
    update((ns) => ns.filter((n) => n.id !== id));
    onResetState(id);
  };

  const setParam = (id, key, value) => {
    update((ns) => ns.map((n) => (n.id === id ? { ...n, params: { ...n.params, [key]: value } } : n)));
  };

  const toggleNode = (id) => {
    update((ns) => ns.map((n) => (n.id === id ? { ...n, enabled: !n.enabled, error: null } : n)));
  };

  return html`
    <${Fragment}>
      ${s.nodes.length === 0 && html`
        <p class="empty">
          Pipeline vazio — a câmera passa direto.<br />
          Abra <b>Módulos</b> e escolha um operador, ou carregue um preset:
        </p>
        <${PresetPicker} primeiro=${presetsPrimeiro} />
      `}

      ${s.nodes.map((n, i) => {
        const def = getOperator(n.op);
        const isSel = s.selected === n.id;
        return html`
          <div key=${n.id} class="node ${n.enabled ? '' : 'off'} ${n.error ? 'err' : ''}">
            <div class="node-head">
              <span class="node-i">${i + 1}</span>
              <button class="node-name" onClick=${() =>
                store.set({ selectedNode: isSel ? null : n.id })}>
                ${def ? def.label : n.op}
              </button>
              <div class="node-acts">
                <button onClick=${() => move(i, -1)} disabled=${i === 0} title="Subir">↑</button>
                <button onClick=${() => move(i, 1)} disabled=${i === s.nodes.length - 1} title="Descer">↓</button>
                <button class=${n.enabled ? 'on' : ''} onClick=${() => toggleNode(n.id)}
                        title=${n.enabled ? 'Desativar' : 'Ativar'}>${n.enabled ? '◉' : '○'}</button>
                <button onClick=${() => remove(n.id)} title="Remover">✕</button>
              </div>
            </div>

            ${n.error && html`<div class="node-err">⚠ ${n.error} — nó desligado</div>`}

            ${isSel && def && html`
              <div class="node-params">
                <p class="node-desc">${def.desc}</p>
                ${Object.entries(def.params || {}).length === 0
                  ? html`<em class="no-params">Sem parâmetros.</em>`
                  : Object.entries(def.params).map(([k, sch]) => html`
                      <${ParamControl} key=${k} name=${k} schema=${sch} op=${n.op} nodeId=${n.id}
                        value=${n.params[k]} onChange=${(v) => setParam(n.id, k, v)} />
                    `)}
                <code class="node-op">${n.op}</code>
              </div>
            `}
          </div>
        `;
      })}

      ${s.nodes.length > 0 && html`
        <div class="row">
          <button class="btn" onClick=${() => { store.set({ nodes: [] }); onResetState(); persist(); }}>
            Limpar
          </button>
          <button class="btn" onClick=${() => { onResetState(); }} title="Zera buffers temporais (motion)">
            Resetar estado
          </button>
        </div>
        <details class="presets-mais">
          <summary>Presets: trocar ou somar</summary>
          <${PresetPicker} primeiro=${presetsPrimeiro} />
        </details>
      `}
    <//>
  `;
}

/**
 * Presets por grupo: uma receita pronta para cada módulo, para o encadeamento
 * aparecer funcionando de imediato. Um preset cujo operador não está no
 * registry some sozinho (os livres novos entram quando são instalados), e o
 * que usa modelo AGPL ganha a etiqueta — ele só roda depois do aceite.
 */
const PRESET_GROUPS = [
  ['Clássicos', {
    'Bordas': [['imgproc.gaussian_blur', { ksize: 5 }], ['imgproc.canny', { low: 40, high: 120 }]],
    'Blobs': [['imgproc.gaussian_blur', { ksize: 7 }], ['imgproc.threshold', { otsu: true, inv: true }],
              ['imgproc.morphology_ex', { mode: 'close', ksize: 5 }], ['imgproc.find_contours', { minArea: 500, showArea: true }]],
    'Cantos': [['imgproc.clahe', {}], ['features.good_features_to_track', { quality: 0.06 }]],
    'Térmico': [['imgproc.clahe', { tiles: 8, clip: 3 }], ['imgproc.apply_color_map', { map: 'jet' }]],
    'Realce': [['imgproc.clahe', {}], ['photo.convert_scale_abs', {}]],
  }],
  ['Movimento', {
    'Movimento': [['video.background_subtractor', { rate: 0.03, thresh: 25 }]],
    'Diferença': [['video.frame_diff', {}]],
    'Rastros': [['video.motion_trails', {}]],
    'Contar na linha': [['dnn.detect', { conf: 0.35 }], ['track.bytetrack', { linha: 'horizontal' }]],
  }],
  // CV-37: zonas e linhas desenhadas com as Ferramentas de mouse (widget à esquerda do vídeo)
  ['Ferramentas de cena', {
    'Contagem por zona e linha': [['dnn.detect', { conf: 0.35 }], ['track.bytetrack', {}], ['cena.zonas', {}]],
    'Zonas — RF-DETR + rastreio': [['rfdetr.detect', {}], ['track.bytetrack', {}], ['cena.zonas', {}]],
    'Zonas com pose (RTMO)': [['pose.rtmo', {}], ['cena.zonas', { fonte: 'poses' }]],
  }],
  ['Detectar e ler', {
    'Detecção': [['dnn.detect', { conf: 0.35 }]],
    'OCR': [['dnn.ocr', {}]],
    'QR e códigos': [['code.scan', {}]],
    'Classificar': [['dnn.classify', {}]],
    'Rostos': [['objdetect.face_detect', {}]],
    'Reconhecer rostos': [['objdetect.face_recognize', {}]],
    'Treinado (YOLO26)': [['custom.detect', {}]],
  }],
  ['Entender a cena', {
    'Pose': [['dnn.pose', {}]],
    'Recorte de pessoa': [['dnn.segment_person', { mode: 'fundo escuro' }]],
    'Máscaras (SAM)': [['dnn.detect', { conf: 0.35 }], ['sam.mascaras', {}]],
    'Profundidade': [['depth.map', {}]],
    'Perto ou longe': [['dnn.detect', { conf: 0.35 }], ['depth.map', { modo: 'só objetos' }]],
    'Zero-shot (CLIP)': [['clip.classify', {}]],
    'Zero-shot por objeto': [['dnn.detect', { conf: 0.35 }], ['clip.classify', { porObjeto: true }]],
    'Relações': [['dnn.detect', { conf: 0.35 }], ['relate.graph', {}]],
  }],
  ['Vocabulário aberto e YOLO26', {
    'YOLOE — tudo': [['yoloe.detect', {}]],
    'YOLOE — por texto': [['yoloe.prompt', {}]],
    'YOLO26 detecção': [['yolo26.detect', {}]],
    'YOLO26 + rastreio': [['yolo26.detect', {}], ['track.bytetrack', { linha: 'horizontal' }]],
    'YOLO26 instâncias': [['yolo26.segment', {}]],
    'YOLO26 pose': [['yolo26.pose', {}]],
    'YOLO26 orientadas': [['yolo26.obb', {}]],
    'YOLO26 semântica': [['yolo26.semantic', {}]],
    'YOLO26 profundidade': [['yolo26.depth', {}]],
    'YOLO26 classificar': [['yolo26.classify', {}]],
  }],
  ['Mãos, rosto e olhos', {
    'Mãos e gestos': [['maos.gestos', {}]],
    'Malha do rosto': [['rosto.malha', {}]],
    'Olhos e sonolência': [['olhos.iris', {}]],
    'Rosto + olhos': [['rosto.malha', {}], ['olhos.iris', {}]],
    'Mãos + rosto + olhos': [['maos.gestos', {}], ['rosto.malha', {}], ['olhos.iris', {}]],
  }],
  ['Bike Fit', {
    'Bike Fit lateral': [['bikefit.analise', { vista: 'lateral' }]],
    'Bike Fit frontal': [['bikefit.analise', { vista: 'frontal' }]],
  }],
  ['Esportes e biomecânica', {
    'Ergonomia RULA': [['ergonomia.avaliar', { metodo: 'RULA' }]],
    'Ergonomia REBA': [['ergonomia.avaliar', { metodo: 'REBA' }]],
    'Ergonomia com punho': [['maos.gestos', {}], ['ergonomia.avaliar', { metodo: 'RULA', maos: 'da cadeia' }]],
    'Academia (automático)': [['academia.treino', {}]],
    'Agachamento': [['academia.treino', { exercicio: 'Agachamento' }]],
    'Flexão': [['academia.treino', { exercicio: 'Flexão de braço' }]],
    'Prancha': [['academia.treino', { exercicio: 'Prancha' }]],
    'Salto CMJ': [['salto.teste', { teste: 'CMJ', vista: 'lateral' }]],
    'Drop jump': [['salto.teste', { teste: 'drop jump' }]],
    'Corrida lateral': [['corrida.marcha', { vista: 'lateral' }]],
    'Corrida de trás': [['corrida.marcha', { vista: 'trás/frente' }]],
    'Corrida — várias (prova)': [['corrida.marcha', { pessoas: 'várias', fonteMulti: 'RTMO (todas)', maxPessoas: 8 }]],
    'Corrida — 2–3 corredores (33 pontos)': [['corrida.marcha', { pessoas: 'várias', fonteMulti: 'BlazePose por recorte', maxPessoas: 3 }]],
    'Swing de golfe': [['swing.analise', { perfil: 'Golfe · Drive' }]],
    'Swing de tênis': [['swing.analise', { perfil: 'Tênis · Forehand' }]],
    'VBT com marcador': [['vbt.barra', { modo: 'marcador' }]],
    'VBT hip thrust (sem marcador)': [['vbt.barra', { modo: 'punho (aproximado)', exercicio: 'Hip thrust', escala: 'segmento', segmento: 'coxa' }]],
    'Quadra — futsal': [['quadra.analise', { esporte: 'futsal' }]],
    'Quadra — RF-DETR + rastreio': [['rfdetr.detect', {}], ['track.bytetrack', {}], ['quadra.analise', {}]],
    // CV-47 Fisio (onda 1-b)
    'Fisio — goniometria': [['fisio.avaliar', { teste: 'goniometria (ADM)' }]],
    'Fisio — TUG': [['fisio.avaliar', { teste: 'TUG' }]],
    'Fisio — sentar-levantar 5×': [['fisio.avaliar', { teste: 'sentar-levantar 5×' }]],
    'Fisio — sentar-levantar 30 s': [['fisio.avaliar', { teste: 'sentar-levantar 30 s' }]],
  }],
  ['Industrial', {
    'Volumetria de correia (BeltScan)': [['beltscan.volumetria', {}]],
    // CV-38 CounterVision: detector → Zonas e linhas (centro, cada ID uma vez) → produção
    'Contagem por cor': [['contagem.cor', {}], ['cena.zonas', { fonte: 'detecções', ponto: 'centro', umaVez: true }], ['contagem.esteira', {}]],
    'Contagem com detector + rastreio': [['dnn.detect', { conf: 0.35 }], ['contagem.rastreio', {}],
                                         ['cena.zonas', { fonte: 'detecções', ponto: 'centro', umaVez: true }], ['contagem.esteira', {}]],
    'Tempo de posto (pose + postos)': [['pose.rtmo', { caixa: false }], ['takt.posto', {}]],
    'Tempo de posto + rastreio (IDs)': [['pose.rtmo', { caixa: false }], ['track.bytetrack', { rastro: 0, mostrarNome: false }], ['takt.posto', {}]],
    // CV-40 Inspeção visual: o operador cria/ativa o programa do modelo (ROIs nas marcações «Inspect · …»)
    'Inspeção — presença e contagem': [['inspect.programa', { modelo: 'presenca' }]],
    'Inspeção — dimensional (paquímetro)': [['inspect.programa', { modelo: 'dimensional' }]],
    'Inspeção — cor e defeito': [['inspect.programa', { modelo: 'cor_defeito' }]],
    // CV-46 OEE e CV-48 EPI (onda 1-b)
    'OEE — máquina sem CLP': [['maquina.estado', {}]],
    'OEE + contagem (CounterVision)': [['contagem.cor', {}], ['cena.zonas', { fonte: 'detecções', ponto: 'centro', umaVez: true }], ['contagem.esteira', {}], ['maquina.estado', {}]],
    'Monitor de EPI (capacete e colete)': [['pose.rtmo', { caixa: false }], ['epi.monitor', {}]],
  }],
  ['Modelos livres', {
    'RF-DETR': [['rfdetr.detect', {}]],
    'RF-DETR + rastreio': [['rfdetr.detect', {}], ['track.bytetrack', { linha: 'horizontal' }]],
    'OCR PT-BR': [['ocr.ptbr', {}]],
    'Pose RTMO': [['pose.rtmo', {}]],
    'Re-ID de pessoas': [['dnn.detect', { conf: 0.35 }], ['reid.pessoas', {}]],
    'Recorte de fundo': [['seg.birefnet', {}]],
    'Florence-2': [['florence2.tarefa', {}]],
    'SAM 2 seguir': [['dnn.detect', { conf: 0.35 }], ['sam2.seguir', {}]],
    'Detector treinado livre': [['livres.rfdetr', {}]],
    'Inspeção de anomalia': [['livres.patchcore', {}]],
  }],
];

/** Grupo de preset que também abre o painel do módulo (o preset Industrial abre o BeltScan). */
const PAINEL_DO_GRUPO = { Industrial: 'beltscan' };
/** Preset que abre um painel diferente do do grupo (o Tempo de posto abre o painel do Takt). */
const PAINEL_DO_PRESET = { 'Contagem por cor': 'contador', 'Contagem com detector + rastreio': 'contador', 'Tempo de posto (pose + postos)': 'takt', 'Tempo de posto + rastreio (IDs)': 'takt' };
// CV-46/47/48 (onda 1-b): os presets abrem o painel do módulo
Object.assign(PAINEL_DO_PRESET, { 'OEE — máquina sem CLP': 'oee', 'OEE + contagem (CounterVision)': 'oee', 'Monitor de EPI (capacete e colete)': 'epi',
  'Fisio — goniometria': 'fisio', 'Fisio — TUG': 'fisio', 'Fisio — sentar-levantar 5×': 'fisio', 'Fisio — sentar-levantar 30 s': 'fisio' });
// CV-40: os presets da Inspeção visual abrem o painel dela
Object.assign(PAINEL_DO_PRESET, { 'Inspeção — presença e contagem': 'inspecao', 'Inspeção — dimensional (paquímetro)': 'inspecao', 'Inspeção — cor e defeito': 'inspecao' });

/*
 * Onda 1-a (components/presets-onda1a.js): presets com descrição e
 * marcações-modelo. Grupo existente ganha os itens; grupo novo entra no fim.
 */
const DESC_PRESET = {};
for (const pr of [...PRESETS_ONDA1A, ...PRESETS_ONDA2B, ...PRESETS_ONDA2A, ...PRESETS_ONDA2C, ...PRESETS_ONDA2D, ...PRESETS_MOTION3D]) {
  let g = PRESET_GROUPS.find(([nome]) => nome === pr.grupo);
  if (!g) PRESET_GROUPS.push((g = [pr.grupo, {}]));
  g[1][pr.nome] = pr.specs;
  if (pr.painel) PAINEL_DO_PRESET[pr.nome] = pr.painel;
  DESC_PRESET[pr.nome] = pr.desc;
}

/** Preset disponível só se todos os operadores existem; marca os que usam AGPL. */
function presetsVisiveis() {
  return PRESET_GROUPS.map(([g, ps]) => [g, Object.entries(ps)
    .filter(([, specs]) => specs.every(([op]) => getOperator(op)))
    .map(([nome, specs]) => ({ nome, specs, agpl: specs.some(([op]) => getOperator(op).agpl), desc: DESC_PRESET[nome] || '' }))])
    .filter(([, l]) => l.length > 0);
}

/*
 * Somar um preset ao Pipeline (em vez de trocar): os nós do preset que já existem na cadeia
 * (mesmo operador — detector, rastreio, pose…) são REAPROVEITADOS com os parâmetros atuais;
 * os que faltam entram no fim, na ordem do preset (consumidores depois de quem produz).
 */
// operadores que fazem o MESMO papel na cadeia: somar não põe um segundo (ex.: Quadra com RF-DETR
// + Contagem com YOLOX ficaria com dois detectores de caixas brigando pelas mesmas detecções)
const FAMILIA_OP = { 'dnn.detect': 'det', 'rfdetr.detect': 'det', 'yolo26.detect': 'det' };
const papel = (op) => FAMILIA_OP[op] || op;
function somarSpecs(nodes, specs) {
  const tem = new Set(nodes.map((n) => papel(n.op)));
  const novos = [], reaproveitados = [];
  for (const sp of specs) { if (tem.has(papel(sp[0]))) reaproveitados.push(sp[0]); else { novos.push(sp); tem.add(papel(sp[0])); } }
  return { nodes: [...nodes, ...chain(novos)], novos: novos.map(([op]) => op), reaproveitados };
}

function aplicarNoPipeline(p, g, somar) {
  const st = store.get();
  const painel = PAINEL_DO_PRESET[p.nome] || PAINEL_DO_GRUPO[g];
  let nodes, aviso = null;
  if (somar && st.nodes.length) {
    const r = somarSpecs(st.nodes, p.specs);
    nodes = r.nodes;
    const rot = (op) => (getOperator(op) ? getOperator(op).label : op);
    aviso = r.novos.length
      ? `«${p.nome}» somado: +${r.novos.length} nó(s) (${r.novos.map(rot).join(', ')})${r.reaproveitados.length ? ` · reaproveitados: ${r.reaproveitados.map(rot).join(', ')}` : ''}.`
      : `«${p.nome}» já está todo no Pipeline (nada a somar).`;
  } else nodes = chain(p.specs);
  store.set({ nodes, ...(painel ? { panels: { ...st.panels, [painel]: true } } : {}), ...(aviso ? { notice: aviso } : {}) });
  persist();
  criarMarcacoesModelo(p.nome); criarMarcacoesModeloOnda2b(p.nome); criarMarcacoesOnda2c(p.nome); criarMarcacoesModeloOnda2a(p.nome); criarMarcacoesModeloOnda2d(p.nome);
}

function lerModoPreset() { try { return localStorage.getItem('iav.presets.modo') === 'somar' ? 'somar' : 'trocar'; } catch (_) { return 'trocar'; } }

function PresetPicker({ primeiro = null }) {
  const [modo, setModoBruto] = useState(lerModoPreset);
  const setModo = (m) => { setModoBruto(m); try { localStorage.setItem('iav.presets.modo', m); } catch (_) { /* sem armazenamento */ } };
  const temNos = store.get().nodes.length > 0;
  let grupos = presetsVisiveis();
  if (primeiro) {
    const ordem = (g) => { const i = primeiro.indexOf(g); return i < 0 ? primeiro.length : i; };
    grupos = grupos.map((x, i) => [x, i]).sort((a, b) => ordem(a[0][0]) - ordem(b[0][0]) || a[1] - b[1]).map(([x]) => x);
  }
  return html`
    <div class="presets-grp">
      ${temNos && html`
        <div class="presets-modo" role="radiogroup" aria-label="Ao escolher um preset">
          <button class=${`btn tiny ${modo === 'trocar' ? 'on' : ''}`} role="radio" aria-checked=${modo === 'trocar'} onClick=${() => setModo('trocar')} title="O preset substitui o Pipeline atual">Trocar</button>
          <button class=${`btn tiny ${modo === 'somar' ? 'on' : ''}`} role="radio" aria-checked=${modo === 'somar'} onClick=${() => setModo('somar')} title="O preset entra junto com o que já está (detector, rastreio e pose em comum são reaproveitados)">＋ Somar ao Pipeline</button>
          <small>Shift+clique também soma.</small>
        </div>`}
      ${grupos.map(([g, lista]) => html`
        <div key=${g} class="presets-g">
          <div class="presets-t">${g}</div>
          <span class="presets">
            ${lista.map((p) => html`
              <button key=${p.nome} class="btn tiny" title=${(p.desc ? p.desc + '\n\n' : '') + p.specs.map(([op]) => getOperator(op).label).join(' → ')}
                onClick=${(e) => aplicarNoPipeline(p, g, modo === 'somar' || e.shiftKey)}>
                ${p.nome}${p.agpl ? html` <i class="presets-agpl">AGPL</i>` : ''}
              </button>
            `)}
          </span>
        </div>
      `)}
    </div>
  `;
}

/**
 * Aplica um preset pelo nome (playlists do YouTube: categoria → módulo) e abre
 * o Pipeline e o painel do módulo. false se o preset não existe ou falta operador.
 */
export function aplicarPreset(nome, painel = null, opc = {}) {
  for (const [, lista] of presetsVisiveis()) {
    const p = lista.find((x) => x.nome === nome);
    if (!p) continue;
    const st = store.get();
    const nodes = opc.somar && st.nodes.length ? somarSpecs(st.nodes, p.specs).nodes : chain(p.specs);
    store.set({ nodes, panels: { ...st.panels, pipeline: true, ...(painel ? { [painel]: true } : {}) } });
    persist();
    criarMarcacoesModelo(nome); criarMarcacoesModeloOnda2b(nome); criarMarcacoesOnda2c(nome); criarMarcacoesModeloOnda2a(nome); criarMarcacoesModeloOnda2d(nome);
    return true;
  }
  return false;
}

function chain(specs) {
  return specs.map(([op, over]) => ({
    id: newNodeId(),
    op,
    params: { ...defaultParams(op), ...over },
    enabled: true,
  }));
}

// =============================================================== Fonte

// =============================================================== seções recolhíveis

/*
 * O painel Fonte junta seis tipos de fonte e ficou longo — no celular, achar
 * o YouTube exigia rolar a câmera, o arquivo e a tela inteiros. Cada tipo é
 * uma seção que recolhe pelo título; o que fica aberto ou fechado é guardado
 * neste aparelho. A fonte em uso ganha um ponto verde no título, mesmo recolhida.
 */
const SECOES_KEY = 'gplansis.fonte.secoes';
const SECOES_FONTE = ['camera', 'imagem', 'arquivo', 'tela', 'youtube', 'rtmp'];
let secoesEstado = (() => {
  try { return JSON.parse(localStorage.getItem(SECOES_KEY) || '{}') || {}; } catch (_) { return {}; }
})();
const secoesOuvintes = new Set();
function definirSecoes(parcial) {
  secoesEstado = { ...secoesEstado, ...parcial };
  try { localStorage.setItem(SECOES_KEY, JSON.stringify(secoesEstado)); } catch (_) { /* storage bloqueado */ }
  for (const fn of secoesOuvintes) fn(secoesEstado);
}
function useSecoes() {
  const [v, setV] = useState(secoesEstado);
  useEffect(() => { secoesOuvintes.add(setV); return () => secoesOuvintes.delete(setV); }, []);
  return v;
}

function Secao({ id, titulo, ativo = false, children }) {
  const secoes = useSecoes();
  const aberta = secoes[id] !== false;          // padrão: aberta
  return html`
    <section class="fonte-sec ${aberta ? 'aberta' : ''} ${ativo ? 'ativa' : ''}">
      <button class="fonte-sec-h" aria-expanded=${aberta} onClick=${() => definirSecoes({ [id]: !aberta })}
              title=${aberta ? 'Recolher' : 'Abrir'}>
        <span class="fonte-sec-seta" aria-hidden="true">${aberta ? '▾' : '▸'}</span>
        <span class="fonte-sec-t">${titulo}</span>
        ${ativo && html`<span class="fonte-sec-ativa" title="Fonte em uso">● em uso</span>`}
      </button>
      ${aberta && html`<div class="fonte-sec-c">${children}</div>`}
    </section>
  `;
}

export function SourcePanel({ onClose, onStartCamera, onStopCamera, onPickFile,
                             onStartScreen, onStopScreen,
                             onStartYouTube, onStopYouTube, youtube,
                             onConnectStream, onDisconnectStream, stream, ...layout }) {
  const s = useStore(store, (st) => ({
    cameraOn: st.cameraOn,
    devices: st.devices,
    deviceId: st.deviceId,
    resolution: st.resolution,
    mirror: st.mirror,
    procWidth: st.procWidth,
    zoom: st.zoom,
    sourceKind: st.sourceKind,
    notice: st.notice,
  }));
  const fileRef = useRef(null);
  const [fpsCam, setFpsCam] = useState(fpsPreferido);
  // seletor «📷 Abrir câmera»: null = fechado; senão o modo em que abre (lista | ip | bt)
  const [seletor, setSeletor] = useState(null);
  const abrirRef = useRef(null);
  // câmera Wi-Fi / IP usa o mesmo StreamSource do RTMP, marcado com origem 'ip'
  const ipAtivo = s.sourceKind === 'stream' && Boolean(stream && stream.current && stream.current.cfg && stream.current.cfg.origem === 'ip');
  const camAtual = s.cameraOn ? s.devices.find((d) => d.id === s.deviceId) : null;
  const tipoAtual = camAtual ? tipoDaCamera(camAtual.label) : null;

  /*
   * Ações do seletor. Devolvem a mensagem de erro (ou null): o startCamera do
   * workspace não lança — põe o erro em `notice` —, e o seletor quer mostrar o
   * erro ao lado da câmera que falhou (ex.: «em uso por outro app»).
   */
  // vindo da câmera IP: encerra a sessão WebRTC antes (o startCamera não mexe no stream) sem pausar o pipeline
  const soltarIp = () => {
    const st = store.get();
    if (st.sourceKind !== 'stream') return;
    const rodando = st.running;
    onDisconnectStream();
    store.set({ running: rodando });
  };
  const escolherCamera = async (c) => {
    soltarIp();
    await onStartCamera(c.id);
    const st = store.get();
    if (!st.cameraOn) return st.notice || 'A câmera não abriu.';
    return null;
  };
  const escolherFacing = async (facing) => {
    soltarIp();
    await onStartCamera(null, { ...store.get().resolution, facing });
    const st = store.get();
    if (!st.cameraOn) return st.notice || 'A câmera não abriu.';
    // a traseira não é selfie: espelhar inverteria texto e placas (como o botão de virar)
    store.set({ facing, mirror: facing !== 'environment' });
    persist();
    return null;
  };
  const conectarIp = async (cfg) => {
    try { await onConnectStream(cfg); return null; } catch (e) { return (e && e.message) || 'Não conectou.'; }
  };
  // «Ligar câmera» sem escolha nesta sessão: tenta a última usada neste aparelho
  const ligar = () => {
    if (s.deviceId) return onStartCamera(s.deviceId);
    const u = acharUltima(s.devices.map((d) => ({ id: d.id, rotulo: d.label })));
    return onStartCamera(u ? u.id : undefined);
  };

  const secoes = useSecoes();
  const algumaAberta = SECOES_FONTE.some((id) => secoes[id] !== false);
  const abrirTodas = (v) => definirSecoes(Object.fromEntries(SECOES_FONTE.map((id) => [id, v])));

  return html`
    <${Panel} id="camera" title="Fonte"
              subtitle=${s.sourceKind === 'screen' ? 'tela ativa'
                       : s.sourceKind === 'youtube' ? 'YouTube ativo'
                       : s.sourceKind === 'stream' ? (ipAtivo ? 'câmera IP ativa' : 'RTMP ativo')
                       : s.cameraOn ? 'câmera ativa' : 'parada'}
              onClose=${onClose} ...${layout}>

      ${s.notice && html`<div class="notice">${s.notice}</div>`}

      <div class="fonte-topo">
        <button class="btn tiny" onClick=${() => abrirTodas(!algumaAberta)}>
          ${algumaAberta ? 'Recolher todas' : 'Abrir todas'}</button>
      </div>

      <${Secao} id="camera" titulo="Câmera" ativo=${(s.cameraOn && s.sourceKind === 'camera') || ipAtivo}>
        <div class="row cam-abrir">
          <button class="btn accent" ref=${abrirRef} aria-haspopup="dialog" aria-expanded=${Boolean(seletor)}
                  title="Escolher a câmera: integrada, USB, celular como webcam, Wi-Fi / IP"
                  onClick=${() => setSeletor(seletor ? null : 'lista')}>📷 Abrir câmera</button>
          <button class="btn"
                  onClick=${() => (s.cameraOn ? onStopCamera() : ligar())}>
            ${s.cameraOn ? 'Parar câmera' : 'Ligar câmera'}
          </button>
        </div>
        ${seletor && html`
          <${SeletorCamera} key=${seletor} ancora=${abrirRef} modoInicial=${seletor}
            atualId=${s.deviceId} cameraLigada=${s.cameraOn}
            onEscolher=${escolherCamera} onFacing=${escolherFacing}
            onConectarIp=${conectarIp} ipAtivo=${ipAtivo} onDesconectarIp=${onDisconnectStream}
            onFechar=${() => setSeletor(null)} />
        `}
        ${camAtual && html`
          <div class="cam-atual" title=${tipoAtual.nome}>
            <span class="cam-atual-ic" aria-hidden="true">${tipoAtual.icone}</span>
            <span class="cam-atual-t"><b>${camAtual.label}</b>
              <span>${tipoAtual.nome}${cameraAtual.settings ? ' · ' + textoSettings(cameraAtual.settings) : ''}</span></span>
          </div>
        `}
        ${ipAtivo && html`
          <div class="cam-atual">
            <span class="cam-atual-ic" aria-hidden="true">${ICONE_IP}</span>
            <span class="cam-atual-t"><b>Câmera Wi-Fi / IP · ${stream.current.cfg.path}</b>
              <span>${stream.current.cfg.whep}</span></span>
            <button class="btn tiny danger" onClick=${onDisconnectStream}>Desconectar</button>
          </div>
        `}

        <label class="ctl">
          <span class="ctl-label">Dispositivo</span>
          <select value=${s.deviceId || ''}
                  onChange=${(e) => onStartCamera(e.target.value || null)}
                  disabled=${s.devices.length === 0}>
            ${s.devices.length === 0
              ? html`<option value="">— ligue a câmera para listar —</option>`
              : s.devices.map((d) => html`
                  <option key=${d.id} value=${d.id}>
                    ${tipoDaCamera(d.label).icone} ${d.label}${d.ir ? '  ⚠ infravermelha' : ''}
                  </option>
                `)}
          </select>
        </label>
        ${s.devices.some((d) => d.ir) && html`
          <p class="hint tight">
            Este notebook tem câmera <b>infravermelha</b> (Windows Hello) além da
            colorida. A IR entrega imagem preta fora de uma autenticação do Hello —
            a app já evita ela sozinha, mas se selecionar na mão, é isso que acontece.
          </p>
        `}

        <label class="ctl">
          <span class="ctl-label">Resolução de captura</span>
          <select value=${s.resolution.width + 'x' + s.resolution.height}
                  onChange=${(e) => {
                    const [w, h] = e.target.value.split('x').map(Number);
                    store.set({ resolution: { width: w, height: h } });
                    persist();
                    if (s.cameraOn) onStartCamera(s.deviceId, { width: w, height: h });
                  }}>
            ${RESOLUTIONS.map((r) => {
              // com a câmera ligada, o que ela não alcança fica marcado (ainda dá para pedir: vem a mais próxima)
              const cw = cameraAtual.caps && cameraAtual.caps.width && cameraAtual.caps.width.max;
              const alem = s.cameraOn && cw && r.width > cw;
              return html`<option key=${r.label} value=${r.width + 'x' + r.height}>${r.label}${alem ? ' — acima da câmera' : ''}</option>`;
            })}
          </select>
        </label>
        <label class="ctl">
          <span class="ctl-label">Quadros por segundo</span>
          <select value=${String(fpsCam)}
                  onChange=${(e) => {
                    const f = parseInt(e.target.value, 10);
                    definirFps(f); setFpsCam(f);
                    if (s.cameraOn) onStartCamera(s.deviceId);
                  }}>
            ${FPS_OPCOES.map((f) => html`<option key=${f} value=${String(f)}>${f} fps${f > 30 ? ' (dobra o trabalho do pipeline)' : ''}</option>`)}
          </select>
        </label>
        ${s.cameraOn && cameraAtual.settings && cameraAtual.settings.width && html`
          <p class="hint tight">
            Entregue pela câmera: <b>${cameraAtual.settings.width}×${cameraAtual.settings.height}</b>
            ${cameraAtual.settings.frameRate ? html` · <b>${Math.round(cameraAtual.settings.frameRate)} fps</b>` : ''}
            ${cameraAtual.caps && cameraAtual.caps.width && cameraAtual.caps.width.max
              ? html` (máximo da câmera: ${cameraAtual.caps.width.max}×${cameraAtual.caps.height.max}${cameraAtual.caps.frameRate && cameraAtual.caps.frameRate.max ? ' · ' + Math.round(cameraAtual.caps.frameRate.max) + ' fps' : ''})` : ''}.
            Acima de 1280×720 a imagem fica mais nítida na tela e na gravação; o processamento
            continua na largura de trabalho abaixo, então o custo extra é pequeno — exceto em
            câmeras USB que só entregam alta resolução comprimida (MJPEG).
          </p>
        `}
        <div class="cam-outras">
          <button class="btn" onClick=${() => setSeletor('ip')}
                  title="Câmera de segurança, IP ou Wi-Fi (RTSP / ONVIF) pelo MediaMTX">${ICONE_IP} Câmera Wi-Fi / IP</button>
          <button class="btn" onClick=${() => setSeletor('bt')}
                  title="Por que câmera Bluetooth não aparece no navegador">${ICONE_BT} Bluetooth</button>
        </div>
      <//>

      <${Secao} id="imagem" titulo="Imagem e processamento">
        <label class="ctl">
          <span class="ctl-label">Largura de processamento<b>${s.procWidth}px</b></span>
          <input type="range" min="160" max="960" step="40" value=${s.procWidth}
                 onInput=${(e) => { store.set({ procWidth: parseInt(e.target.value, 10) }); persist(); }} />
        </label>
        <p class="hint tight">
          Este slider é o botão de FPS: o custo dos operadores cresce com a área.
          Reduza aqui antes de culpar o operador.
        </p>

        <label class="ctl">
          <span class="ctl-label">Zoom da imagem<b>${String(Math.round(((s.zoom && s.zoom.z) || 1) * 10) / 10).replace('.', ',')}×</b></span>
          <input type="range" min="1" max="6" step="0.1" value=${(s.zoom && s.zoom.z) || 1}
                 onInput=${(e) => setZoom({ ...(s.zoom || {}), z: parseFloat(e.target.value) })} />
        </label>
        <p class="hint tight">
          Amplia a câmera, o vídeo ou o YouTube <b>antes</b> dos modelos: o que fica maior na tela é o
          que eles analisam — enquadre a pessoa para melhorar pose e ângulos. Arraste a imagem para
          mover; Ctrl/⌘ + roda ou pinça amplia no ponto; duplo clique alterna 1× ↔ 2×; teclas + − 0.
          ${s.zoom && s.zoom.z > 1 && html` <button class="btn tiny" onClick=${() => setZoom({ z: 1 })}>Quadro inteiro</button>`}
        </p>

        <label class="ctl ctl-bool">
          <input type="checkbox" checked=${s.mirror}
                 onChange=${(e) => { store.set({ mirror: e.target.checked }); persist(); }} />
          <span>Espelhar (selfie)</span>
        </label>
      <//>

      <${Secao} id="arquivo" titulo="Arquivo · imagem ou vídeo" ativo=${s.sourceKind === 'file'}>
        <div class="row">
          <button class="btn" onClick=${() => fileRef.current.click()}>Abrir imagem / vídeo</button>
        </div>
        <input ref=${fileRef} type="file" accept="image/*,video/*" hidden
               onChange=${(e) => {
                 const f = e.target.files && e.target.files[0];
                 if (f) onPickFile(f);
                 e.target.value = '';
               }} />
        <p class="hint tight">
          Fonte por arquivo usa o mesmo caminho de processamento da câmera —
          útil para comparar pipelines com entrada fixa e repetível.
        </p>
      <//>

      <${Secao} id="tela" titulo="Captura de tela" ativo=${s.sourceKind === 'screen'}>
        <div class="row">
          <button class="btn ${s.sourceKind === 'screen' ? 'danger' : 'accent'}"
                  disabled=${!telaDisponivel()}
                  onClick=${() => (s.sourceKind === 'screen' ? onStopScreen() : onStartScreen())}>
            ${s.sourceKind === 'screen' ? 'Parar captura de tela' : 'Capturar tela'}
          </button>
        </div>
        <p class="hint tight">
          ${telaDisponivel()
            ? html`Escolha uma <b>aba</b>, uma <b>janela</b> ou o <b>monitor</b>. A tela
                   entra no mesmo pipeline da câmera: detecção, OCR e o módulo <b>Contexto</b> (LER, CONTAR, DESCREVER, ANALISAR e <b>TRANSCREVER</b>) trabalham sobre ela. Compartilhando uma aba
                   com som, a gravação captura o áudio da própria aba.`
            : html`Captura de tela só existe em navegadores de <b>computador</b> (Chrome, Edge, Firefox, Safari). Celulares não expõem o recurso.`}
        </p>
      <//>

      ${youtube && html`
        <${Secao} id="youtube" titulo="YouTube" ativo=${s.sourceKind === 'youtube'}>
          <${YouTubeSection} youtube=${youtube} ativo=${s.sourceKind === 'youtube'} semTitulo=${true}
                             onStart=${onStartYouTube} onStop=${onStopYouTube}
                             aplicarPreset=${aplicarPreset} />
        <//>
      `}

      <${Secao} id="rtmp" titulo="Câmera externa · RTMP" ativo=${s.sourceKind === 'stream' && !ipAtivo}>
        <${RtmpSection} onConnect=${onConnectStream} onDisconnect=${onDisconnectStream}
                        stream=${stream} ativo=${s.sourceKind === 'stream' && !ipAtivo} semTitulo=${true} />
      <//>
    <//>
  `;
}

// =============================================================== RTMP

const RTMP_KEY = 'gplansis.rtmp';

/**
 * Câmera externa por RTMP — DJI Osmo Pocket 3, Action, drone, OBS.
 *
 * O aparelho transmite RTMP; o navegador não sabe ler RTMP. O MediaMTX no
 * meio converte para WebRTC, que chega em menos de um segundo. Esta seção
 * monta os endereços dos dois lados: o que se digita no app da câmera e o
 * que o navegador consome.
 */
function RtmpSection({ onConnect, onDisconnect, stream, ativo, semTitulo = false }) {
  const [cfg, setCfg] = useState(() => {
    try {
      const raw = localStorage.getItem(RTMP_KEY);
      if (raw) {
        const salvo = { ...STREAM_PADRAO, ...JSON.parse(raw) };
        /*
         * Quem já tinha salvado a configuração antes do VPS existir ficou com
         * `base` vazio e um host de rede local — e o padrão novo só vale para
         * quem nunca abriu o painel. Aqui a migração: no site publicado, uma
         * configuração salva SEM servidor HTTPS recebe o VPS.
         */
        if (location.hostname === 'aivision.gplansis.com' && !salvo.base) {
          salvo.base = 'https://rtmp.gplansis.com';
          if (!salvo.host || ehRedeLocal(salvo.host)) salvo.host = 'rtmp.gplansis.com';
        }
        return salvo;
      }
    } catch (_) { /* storage bloqueado */ }
    /*
     * O padrão só herda o hostname da página quando ele JÁ É de rede local
     * — que é o caso de quem abriu por http://192.168.0.114:8001, o caminho
     * certo. Abrindo pelo site publicado, herdar daria
     * "aivision.gplansis.com", e foi exatamente isso que apareceu no campo
     * e virou `rtmp://aivision.gplansis.com:1935` no app da câmera. Nesse
     * caso é melhor deixar vazio: campo em branco com placeholder ensina,
     * campo preenchido errado engana.
     */
    const h = location.hostname;
    /*
     * No site publicado o padrão é o VPS de mídia. É uma «conexão limpa»:
     * abrir o painel e clicar em Conectar, sem digitar host nem colar URL.
     * Só vale para o site — na instalação local o servidor é a própria
     * máquina, e o IP dela continua sendo o padrão.
     */
    if (h === 'aivision.gplansis.com') {
      return { ...STREAM_PADRAO, host: 'rtmp.gplansis.com', base: 'https://rtmp.gplansis.com' };
    }
    return { ...STREAM_PADRAO, host: ehRedeLocal(h) ? h : '' };
  });
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState(null);
  const [stats, setStats] = useState(null);
  const [diag, setDiag] = useState(null);
  const [testando, setTestando] = useState(false);

  const set = (k) => (e) => {
    const v = (k === 'host' || k === 'path' || k === 'base')
      ? e.target.value : (parseInt(e.target.value, 10) || 0);
    setCfg((c) => {
      const n = { ...c, [k]: v };
      try { localStorage.setItem(RTMP_KEY, JSON.stringify(n)); } catch (_) { /* ignora */ }
      return n;
    });
  };

  useEffect(() => {
    if (!ativo || !stream || !stream.current) return;
    const t = setInterval(async () => setStats(await stream.current.stats()), 1000);
    return () => clearInterval(t);
  }, [ativo, stream]);

  const rtmp = urlRtmp(cfg);
  const tunel = baseHttps(cfg);
  const bloqueado = conteudoMisto(cfg.host, cfg);
  const hostRuim = Boolean(cfg.host) && !ehRedeLocal(cfg.host);
  // com túnel, o IP local só serve para o app da câmera; sem ele, é tudo
  const podeConectar = tunel ? Boolean(cfg.path) : Boolean(cfg.host) && !hostRuim && !bloqueado;

  const copiar = (t, id) => {
    navigator.clipboard.writeText(t)
      .then(() => { setCopiado(id); setTimeout(() => setCopiado(null), 1400); })
      .catch(() => {});
  };

  return html`
    ${!semTitulo && html`<div class="cfg-sub">Câmera externa · RTMP</div>`}

    <p class="hint tight">
      Para DJI Osmo Pocket 3, Action ou qualquer app que transmita RTMP.
      O navegador não lê RTMP direto — o <b>MediaMTX</b> na sua máquina
      converte para WebRTC, que chega com menos de 1 s de atraso.
    </p>

    ${location.protocol === 'https:' && !tunel && html`
      <div class="notice">
        <b>Você está no site publicado (HTTPS).</b> Ele não fala com um
        servidor de mídia em HTTP na sua rede — o navegador bloqueia,
        localhost inclusive. A saída é um <b>túnel HTTPS</b>: rode <code>tools/tunel.cmd</code> na máquina do MediaMTX e cole aqui a URL
        que ele mostra (algo como <code>https://…trycloudflare.com</code>).
        Sem conta, sem DNS, sem abrir porta no roteador.
      </div>
    `}

    <label class="ctl">
      <span class="ctl-label">Servidor de mídia por HTTPS (túnel)</span>
      <input class="txt" value=${cfg.base || ''} onInput=${set('base')}
             placeholder="https://xxxx.trycloudflare.com" spellcheck="false"
             autocapitalize="off" autocorrect="off" inputmode="url" />
    </label>
    ${tunel && html`
      <p class="hint tight">
        Túnel ativo: <code>${tunel}</code>. A negociação e o HLS passam por
        ele. Na mesma Wi-Fi do PC o vídeo vai por WebRTC (sub-segundo); de
        fora, cai para HLS pelo túnel (1–3 s). A URL muda a cada execução do <code>tunel.cmd</code>.
      </p>
    `}

    <label class="ctl">
      <span class="ctl-label">${tunel ? 'IP da máquina na rede (para o app da câmera)' : 'IP da máquina na rede'}</span>
      <input class="txt" value=${cfg.host} onInput=${set('host')}
             placeholder="192.168.0.114" spellcheck="false"
             inputmode="decimal" autocapitalize="off" autocorrect="off" />
    </label>

    ${hostRuim && !tunel && html`
      <div class="mdl-err">
        <b>${cfg.host}</b> não é um endereço de rede local. O MediaMTX roda na <b>sua máquina</b>, então aqui vai o IP dela na Wi-Fi — algo como <code>192.168.0.114</code> —, nunca o domínio do site.
        O <code>tools/rtmp.cmd</code> mostra o IP certo na tela.
      </div>
    `}
    <label class="ctl">
      <span class="ctl-label">Caminho / chave</span>
      <input class="txt" value=${cfg.path} onInput=${set('path')}
             placeholder="live/stream" spellcheck="false" />
    </label>

    <div class="rtmp-box">
      <div class="cfg-sub">No app DJI Mimo → RTMP Personalizado</div>
      <div class="rtmp-f">
        <span>Servidor</span>
        <code>${rtmp.servidor}</code>
        <button class="btn tiny" onClick=${() => copiar(rtmp.servidor, 'srv')}>
          ${copiado === 'srv' ? '✓' : 'copiar'}
        </button>
      </div>
      <div class="rtmp-f">
        <span>Chave</span>
        <code>${tunel ? rtmp.chave + '?user=osmo&pass=SENHA' : rtmp.chave}</code>
        <button class="btn tiny" onClick=${() => copiar(tunel ? rtmp.chave + '?user=osmo&pass=' : rtmp.chave, 'key')}>
          ${copiado === 'key' ? '✓' : 'copiar'}
        </button>
      </div>
      ${tunel && html`
        <p class="hint tight">
          No servidor público, <b>publicar exige senha</b> — sem ela qualquer
          pessoa transmitiria no seu canal. Troque <code>SENHA</code> pela senha
          do publicador, que está em <code>/etc/mediamtx/publicador.env</code> no VPS (o instalador a mostrou uma vez). Assistir não precisa de senha.
        </p>
      `}
      <p class="hint tight">
        Alguns apps pedem tudo num campo só: <code>${rtmp.servidor}/${tunel ? rtmp.chave + '?user=osmo&pass=SENHA' : rtmp.chave}</code>
      </p>
    </div>

    ${ativo && stats && stats.modo && html`<p class="hint tight">${stats.modo}</p>`}
    ${ativo && stats && html`
      <div class="kpis">
        <div class="kpi"><b>${stats.fps}</b><em>fps recebidos</em></div>
        <div class="kpi"><b>${stats.kbps}</b><em>kbit/s</em></div>
        <div class="kpi"><b class=${stats.perdidos > 0 ? 'warn' : ''}>${stats.perdidos}</b><em>perdidos</em></div>
      </div>
    `}

    ${diag && html`
      <div class="diag">
        ${diag.passos.map((p) => html`
          <div key=${p.nome} class="diag-l ${p.estado}">
            <b>${p.estado === 'ok' ? '✓' : '✕'} ${p.nome}</b>
            <span>${p.detalhe}</span>
          </div>
        `)}
        ${diag.ok && html`
          <div class="diag-l ok"><b>✓ Tudo pronto</b>
            <span>Clique em Conectar ao stream.</span></div>
        `}
      </div>
    `}

    <div class="row">
      ${ativo
        ? html`<button class="btn danger" onClick=${onDisconnect}>Desconectar</button>`
        : html`<button class="btn accent" disabled=${busy || !podeConectar}
                 onClick=${async () => {
                   setBusy(true);
                   try { await onConnect(cfg); } catch (_) { /* o aviso já apareceu */ }
                   finally { setBusy(false); }
                 }}>${busy ? 'Conectando…' : 'Conectar ao stream'}</button>`}
      ${!ativo && html`
        <button class="btn" disabled=${testando || !(cfg.host || tunel)}
          onClick=${async () => {
            setTestando(true);
            setDiag(null);
            try { setDiag(await diagnosticar(cfg)); }
            finally { setTestando(false); }
          }}>${testando ? 'Testando…' : 'Testar conexão'}</button>
      `}
    </div>

    <p class="hint tight">
      <b>Pelo site publicado:</b> rode <code>tools/tunel.cmd</code> (primeira
      vez como administrador, para o firewall) → cole a URL do túnel no campo
      acima → no Mimo, <b>Transmissão ao vivo › RTMP Personalizado</b> com o
      servidor <code>rtmp://IP-DA-MÁQUINA:1935/live</code> e chave <code>stream</code> → inicie → <b>Testar conexão</b>.
      <br /><b>Pela instalação local</b> (http://IP:8001): <code>tools/local.cmd</code>,
      sem túnel, e o IP da máquina no campo de cima.
    </p>
    <p class="hint tight">
      Se não conectar, o culpado quase sempre é o Firewall do Windows na porta
      1935 — o servidor sobe normalmente e o celular simplesmente não chega
      nele. O <b>Testar conexão</b> distingue os dois casos.
    </p>
  `;
}

// =============================================================== Telemetria

export function StatsPanel({ onClose, ...layout }) {
  const s = useStore(store, (st) => ({
    fps: st.fps, procMs: st.procMs, metrics: st.metrics,
    timings: st.timings, procWidth: st.procWidth, resolution: st.resolution,
  }));

  const total = s.timings.reduce((a, t) => a + t.ms, 0);

  return html`
    <${Panel} id="stats" title="Telemetria" subtitle="por frame"
              onClose=${onClose} ...${layout}>
      <div class="kpis">
        <div class="kpi"><b class=${s.fps < 15 ? 'warn' : ''}>${s.fps || '—'}</b><em>fps</em></div>
        <div class="kpi"><b>${s.procMs.toFixed(1)}</b><em>ms/frame</em></div>
        <div class="kpi"><b>${s.procWidth}</b><em>px trabalho</em></div>
      </div>

      ${Object.keys(s.metrics).length > 0 && html`
        <div class="metrics">
          ${Object.entries(s.metrics).map(([k, v]) => html`
            <div key=${k} class="metric"><span>${k}</span><b>${v}</b></div>
          `)}
        </div>
      `}

      <div class="sep"></div>
      <p class="hint tight">Custo por operador — onde o frame está sendo gasto.</p>

      ${s.timings.length === 0
        ? html`<em class="no-params">Nenhum operador ativo.</em>`
        : s.timings.map((t) => html`
            <div key=${t.id} class="timing ${t.error ? 'err' : ''}">
              <div class="timing-top">
                <code>${t.op.split('.')[1] || t.op}</code>
                <b>${t.ms.toFixed(1)}ms</b>
              </div>
              <div class="bar"><i style=${{ width: (total ? (t.ms / total) * 100 : 0) + '%' }}></i></div>
            </div>
          `)}
    <//>
  `;
}

// =============================================================== Exportar

export function ExportPanel({ onClose, onSnapshot, ...layout }) {
  const nodes = useStore(store, (s) => s.nodes);
  const [copied, setCopied] = useState(false);
  const importRef = useRef(null);

  const graph = toGraph(nodes);
  const json = JSON.stringify(graph, null, 2);

  const download = (name, text, mime = 'application/json') => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (file) => {
    try {
      const parsed = JSON.parse(await file.text());
      const { nodes: loaded, rejected } = fromGraph(parsed);
      store.set({
        nodes: loaded,
        notice: rejected.length
          ? `${rejected.length} operador(es) fora da whitelist foram descartados: ${rejected.join(', ')}`
          : null,
      });
      persist();
    } catch (err) {
      store.set({ notice: 'Falha ao importar: ' + err.message });
    }
  };

  return html`
    <${Panel} id="export" title="Exportar" subtitle="grafo SPEC §5.2"
              onClose=${onClose} ...${layout}>
      <p class="hint">
        O pipeline serializa no <b>mesmo formato de grafo</b> que <code>POST /pipelines/{id}/versions</code> vai aceitar. O que você monta
        aqui roda no backend sem tradução.
      </p>

      <div class="row">
        <button class="btn accent" onClick=${onSnapshot}>Capturar PNG</button>
        <button class="btn" onClick=${() => download('pipeline.json', json)}>Baixar JSON</button>
      </div>

      <div class="row">
        <button class="btn" onClick=${async () => {
          try {
            await navigator.clipboard.writeText(json);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch (_) {
            store.set({ notice: 'Clipboard bloqueado pelo browser.' });
          }
        }}>${copied ? '✓ Copiado' : 'Copiar JSON'}</button>
        <button class="btn" onClick=${() => importRef.current.click()}>Importar</button>
      </div>
      <input ref=${importRef} type="file" accept="application/json,.json" hidden
             onChange=${(e) => {
               const f = e.target.files && e.target.files[0];
               if (f) doImport(f);
               e.target.value = '';
             }} />

      <pre class="json">${json}</pre>
    <//>
  `;
}

// =============================================================== Modelos

/**
 * Painel de modelos: estado de carga, provider em uso e licença.
 *
 * Existe porque baixar 94 MB em silêncio parece travamento, e porque a
 * licença de cada peso é informação de projeto, não curiosidade — é o
 * campo `models.license` do SPEC §5.1 aparecendo na UI.
 */
export function ModelsPanel({ onClose, ...layout }) {
  const [states, setStates] = useState(() => modelStates());

  useEffect(() => onModelState(setStates), []);

  // modelos treinados livres (RF-DETR, PatchCore) entram em MODELS como livre:<id> — lista antes do 1º uso
  const [, setLivres] = useState(0);
  useEffect(() => { registrarTreinadosLivres().then((l) => setLivres((l && l.length) || 0)).catch(() => {}); }, []);
  const totalMB = (Object.values(ORT_MODELS).reduce((a, m) => a + (m.bytes || 0), 0) / 1e6).toFixed(0);
  const loaded = Object.keys(ORT_MODELS).filter((id) => states[id] && states[id].status === 'ready').length;
  const agplProntos = Object.keys(AGPL_MODELS).filter((id) => states[id] && states[id].status === 'ready').length;
  const [lote, setLote] = useState(null);      // { i, n, atual } enquanto "Carregar todos" roda
  const [erros, setErros] = useState([]);

  // um por vez: em paralelo os downloads disputam banda e a memória do WASM estoura
  async function carregarTodos() {
    const ids = [...Object.keys(ORT_MODELS), ...(agplAccepted() ? Object.keys(AGPL_MODELS) : [])]
      .filter((id) => id !== 'yolo26n-reid' && !(states[id] && states[id].status === 'ready'));
    const falhas = [];
    for (let i = 0; i < ids.length; i++) {
      const m = ORT_MODELS[ids[i]] || AGPL_MODELS[ids[i]];
      setLote({ i: i + 1, n: ids.length, atual: m ? m.name : ids[i] });
      try { await loadModel(ids[i]); } catch (_) { falhas.push(m ? m.name : ids[i]); }
    }
    setErros(falhas);
    setLote(null);
  }
  function descarregarTodos() {
    for (const id of [...Object.keys(ORT_MODELS), ...Object.keys(AGPL_MODELS)]) unloadModel(id);
    setErros([]);
  }

  return html`
    <${Panel} id="models" title="Modelos" subtitle=${`${loaded}/${Object.keys(ORT_MODELS).length} carregados`}
              onClose=${onClose} ...${layout}>
      <p class="hint">
        Pesos ONNX de vários projetos (OpenCV Zoo, YOLOX, MobileSAM, Depth
        Anything, MobileCLIP…), com a licença de cada um ao lado do nome. Baixam
        sob demanda no primeiro uso do operador e ficam guardados no aparelho — ${totalMB} MB no total se você usar tudo.
      </p>

      <div class="ep-row">
        <span class=${supportsWebGPU() ? 'ep on' : 'ep'}>
          ${supportsWebGPU() ? '✓' : '✕'} WebGPU
        </span>
        <span class=${isIsolated() ? 'ep on' : 'ep'}>
          ${isIsolated() ? '✓' : '✕'} threads WASM
        </span>
      </div>
      <div class="row tight" style=${{ marginBottom: '12px', gap: '6px' }}>
        <button class="btn accent" disabled=${!!lote} onClick=${carregarTodos}
                title="Baixa e carrega um modelo por vez (os AGPL só se estiverem liberados)">
          ${lote ? `Carregando ${lote.i}/${lote.n}…` : 'Carregar todos'}
        </button>
        <button class="btn" disabled=${!!lote || loaded + agplProntos === 0} onClick=${descarregarTodos}>
          Descarregar todos
        </button>
      </div>
      ${lote && lote.atual && html`<p class="hint tight">Agora: <b>${lote.atual}</b></p>`}
      ${erros.length > 0 && !lote && html`<p class="hint tight" style=${{ color: 'var(--err)' }}>
        ${erros.length} não carregaram: ${erros.join(', ')}</p>`}

      ${!isIsolated() && html`
        <p class="hint tight">
          Sem cross-origin isolation o WASM roda em 1 thread. O serve.py já manda
          COOP/COEP — se este selo está apagado, recarregue com Ctrl+Shift+R.
        </p>
      `}

      <${AgplSection} states=${states} />

      ${Object.entries(ORT_MODELS).map(([id, m]) => {
        const st = states[id] || { status: 'idle', progress: 0 };
        return html`
          <div key=${id} class="mdl ${st.status}">
            <div class="mdl-head">
              <b>${m.name}</b>
              <span class="mdl-size">${(m.bytes / 1e6).toFixed(1)} MB</span>
            </div>
            <div class="mdl-meta">
              <code>${m.task}</code>
              <span class="mdl-lic">${m.license}</span>
            </div>

            ${st.status === 'loading' && html`
              <div class="mdl-bar"><i style=${{ width: (st.progress * 100).toFixed(0) + '%' }}></i></div>
            `}
            ${st.status === 'ready' && html`
              <div class="mdl-ok">
                ✓ pronto · <b>${st.ep}</b>${st.ms ? ` · ${(st.ms / 1000).toFixed(1)}s para carregar` : ''}
              </div>
            `}
            ${st.status === 'error' && html`<div class="mdl-err">⚠ ${st.error}</div>`}

            <div class="row tight">
              ${st.status === 'ready'
                ? html`<button class="btn tiny" onClick=${() => unloadModel(id)}>Descarregar</button>`
                : html`<button class="btn tiny" disabled=${st.status === 'loading'}
                          onClick=${() => loadModel(id).catch(() => {})}>
                         ${st.status === 'loading' ? 'Baixando…' : 'Pré-carregar'}
                       </button>`}
            </div>
          </div>
        `;
      })}
    <//>
  `;
}


/**
 * Bloco dos modelos AGPL. Fica visualmente separado e travado até o aceite,
 * porque a consequência de ligar não é técnica — é jurídica.
 */
function AgplSection({ states }) {
  const [accepted, setAccepted] = useState(() => agplAccepted());
  // aberto quando já liberado: os YOLO ficavam escondidos atrás do cabeçalho fechado
  const [open, setOpen] = useState(() => agplAccepted());
  const [, setN] = useState(0);
  useEffect(() => { registrarTreinados().then((l) => setN(l.length)).catch(() => {}); }, []);

  const ids = Object.keys(AGPL_MODELS);
  const total = Object.values(AGPL_MODELS).reduce((a, m) => a + (m.bytes || 0), 0);
  const loaded = ids.filter((id) => states[id] && states[id].status === 'ready').length;

  return html`
    <div class="agpl ${accepted ? 'on' : ''}">
      <button class="agpl-head" onClick=${() => setOpen((o) => !o)}>
        <span class="agpl-tag">AGPL-3.0</span>
        <b>Ultralytics · YOLO26, YOLOE e treinados</b>
        <span class="agpl-n">${accepted ? `${loaded}/${ids.length} ${open ? '▾' : '▸'}` : '🔒'}</span>
      </button>

      ${open && html`
        <div class="agpl-body">
          <p>
            ${ids.length} modelos (${(total / 1e6).toFixed(0)} MB): YOLO26 (detecção,
            instâncias, pose multi-pessoa, caixas orientadas, classificação,
            semântica, profundidade e re-ID), YOLOE de vocabulário aberto e os
            detectores treinados em Treinar modelos.
          </p>
          <div class="agpl-warn">
            <b>⚠ Obrigação da AGPL-3.0</b> Distribuir este sistema ou expô-lo <b>na rede</b> com estes modelos
            ativos obriga a publicar <b>todo</b> o código-fonte sob AGPL-3.0, ou a
            adquirir uma Ultralytics Enterprise License.
            Rodar localmente, só para você, <b>não</b> dispara a obrigação.
          </div>
          <p class="agpl-alt">
            Alternativa sem amarra: o <b>YOLOX-S</b> (Apache-2.0) já está ativo e
            cobre detecção nas mesmas 80 classes. O que só o YOLO26 traz é
            segmentação de instâncias, OBB, profundidade e re-ID.
          </p>

          ${accepted
            ? html`
              <div class="row">
                <button class="btn tiny danger" onClick=${() => {
                  for (const id of Object.keys(AGPL_MODELS)) unloadModel(id);
                  setAgplAccepted(false);
                  setAccepted(false);
                }}>Desativar e descarregar</button>
              </div>
              ${Object.entries(AGPL_MODELS).map(([id, m]) => {
                const st = states[id] || { status: 'idle', progress: 0 };
                return html`
                  <div key=${id} class="mdl ${st.status} sm">
                    <div class="mdl-head">
                      <b>${m.name}</b>
                      <span class="mdl-size">${id === 'yolo26n-reid' ? 'indisponível' : ((m.bytes || 0) / 1e6).toFixed(1) + ' MB'}</span>
                    </div>
                    ${id === 'yolo26n-reid' && st.status !== 'ready' && html`
                      <div class="mdl-err">Ainda não exportável na versão atual do Ultralytics.</div>`}
                    ${st.status === 'loading' && html`
                      <div class="mdl-bar"><i style=${{ width: (st.progress * 100).toFixed(0) + '%' }}></i></div>`}
                    ${st.status === 'ready' && html`<div class="mdl-ok">✓ pronto · <b>${st.ep}</b></div>`}
                    ${st.status === 'error' && id !== 'yolo26n-reid' && html`<div class="mdl-err">⚠ ${st.error}</div>`}
                    ${id !== 'yolo26n-reid' && html`
                      <div class="row tight">
                        ${st.status === 'ready'
                          ? html`<button class="btn tiny" onClick=${() => unloadModel(id)}>Descarregar</button>`
                          : html`<button class="btn tiny" disabled=${st.status === 'loading'}
                                    onClick=${() => loadModel(id).catch(() => {})}>
                                   ${st.status === 'loading' ? 'Baixando…' : 'Pré-carregar'}
                                 </button>`}
                      </div>`}
                  </div>
                `;
              })}
            `
            : html`
              <button class="btn danger" onClick=${() => {
                setAgplAccepted(true);
                setAccepted(true);
              }}>
                Aceito as obrigações da AGPL-3.0 e quero habilitar
              </button>
            `}
        </div>
      `}
    </div>
  `;
}
