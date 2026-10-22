/**
 * components/ConfigPanel.js — Configurações e catálogo de capacidades.
 *
 * Faz duas coisas que normalmente ficam separadas, de propósito:
 *
 *   1. DOCUMENTA o que está instalado — cada módulo do SPEC §4.2, cada
 *      operador, cada modelo, com licença e forma de entrada. A documentação
 *      é gerada do registry, então não tem como divergir do código.
 *   2. CONFIGURA o que dá para ajustar — qualidade, buffer, runtime.
 *
 * Doc que mora longe do código apodrece. Esta é lida do próprio catálogo.
 */

import { html, useState, useEffect } from '../vendor.js';
import { Panel, ParamControl } from './Panel.js';
import { useStore, store, persist } from '../state/store.js';
import { MODULES, operatorsOf, OPERATOR_COUNT } from '../cv/registry.js';
import { ViaChave } from '../via/ViaChave.js';
import {
  MODELS, AGPL_MODELS, modelStates, onModelState, supportsWebGPU, isIsolated,
  agplAccepted, setAgplAccepted, loadModel, unload,
} from '../cv/runtime/onnx.js';

/*
 * Pré-carga ao iniciar: ids de modelos que o usuário marcou em Config ›
 * Modelos livres. Guardado só neste navegador; app.js chama preloadSalvos()
 * depois do login, um modelo por vez para não disputar banda com o vídeo.
 */
const PRELOAD_KEY = 'aiv.preload';
function lerPreload() {
  try { const v = JSON.parse(localStorage.getItem(PRELOAD_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch (_) { return []; }
}
function gravarPreload(ids) {
  try { localStorage.setItem(PRELOAD_KEY, JSON.stringify(ids)); } catch (_) { /* modo privado */ }
}
export async function preloadSalvos() {
  for (const id of lerPreload()) {
    if (!MODELS[id]) continue;                 // AGPL nunca entra pela pré-carga
    try { await loadModel(id); } catch (_) { /* o erro aparece no painel Modelos */ }
  }
}

/** Módulos dos modelos livres adicionados em out/2026 (CV-17 em diante). */
const ehLivre = (m) => !m.agpl && Number(String(m.id).replace('CV-', '')) >= 17;

/**
 * Explicação curada por módulo: o que o módulo RESOLVE, quando usar e o que
 * ele não faz. O registry tem a descrição técnica; aqui está o porquê.
 */
const GUIDE = {
  'CV-01': {
    what: 'Processamento de imagem sem rede neural: filtros, bordas, limiar, ' +
          'morfologia e realce, aplicados pixel a pixel.',
    when: 'Quando o problema tem geometria ou contraste bem definidos — contar ' +
          'peças numa esteira, achar uma borda, isolar uma marca. É determinístico, ' +
          'roda em milissegundos e não precisa de treino nem de GPU.',
    not: 'Não reconhece o QUE é o objeto. Um retângulo escuro é só um retângulo.',
    cost: '2–9 ms por frame a 480 px.',
  },
  'CV-04': {
    what: 'Operadores que mantêm memória entre frames: diferença de quadros, ' +
          'modelo de fundo por média corrente e rastro de movimento.',
    when: 'Detectar que ALGO se moveu, com câmera fixa. É a linha de base honesta ' +
          'contra a qual comparar qualquer detector — se a diferença de frames ' +
          'resolve, não vale o custo de um modelo.',
    not: 'Não separa objetos nem mantém identidade. Câmera tremendo vira ' +
         'movimento falso na cena inteira.',
    cost: '0,6–5 ms por frame.',
  },
  'CV-02': {
    what: 'Classifica a imagem INTEIRA em uma das 1000 categorias do ImageNet.',
    when: 'Quando importa o que a cena é como um todo, não onde estão as coisas.',
    not: 'Não localiza nada e não lida com múltiplos objetos: devolve um rótulo ' +
         'para o quadro todo.',
    cost: '~40–120 ms por inferência, fora do loop de render.',
  },
  'CV-03': {
    what: 'Localiza objetos com caixa, classe e confiança nas 80 categorias COCO.',
    when: 'O caso mais comum: contar pessoas, achar veículos, disparar alerta ' +
          'quando algo entra em cena.',
    not: 'Caixa retangular, não contorno. Objetos muito pequenos ou muito ' +
         'sobrepostos degradam.',
    cost: '300 ms–2 s no WASM; bem mais rápido com WebGPU.',
  },
  'CV-05': {
    what: 'Máscara pessoa/fundo por pixel, com modos de composição (destaque, ' +
          'fundo escuro, croma).',
    when: 'Recorte de pessoa, fundo virtual, ou isolar a região de interesse ' +
          'antes de outro operador.',
    not: 'Só a classe "pessoa". Para instâncias separadas ou 80 classes, é o ' +
         'CV-09.',
    cost: '~30–80 ms.',
  },
  'CV-06': {
    what: 'Esqueleto de 33 pontos, em dois estágios: o detector acha a pessoa, ' +
          'o BlazePose estima os landmarks no recorte.',
    when: 'Postura, ergonomia, gesto, análise de movimento.',
    not: 'Uma pessoa por vez (a maior da cena). Multi-pessoa em um estágio só ' +
         'está no CV-09.',
    cost: '~120–400 ms (dois modelos em série).',
  },
  'CV-07': {
    what: 'Acha regiões de texto e lê o conteúdo, com decodificação CTC.',
    when: 'Placa, etiqueta, número de série, painel.',
    not: 'O modelo de reconhecimento aqui é o EN: alfanumérico latino, sem ' +
         'acentuação. Texto muito inclinado ou pequeno falha.',
    cost: '~200 ms para detectar + ~40 ms por região lida.',
  },
  'CV-08': {
    what: 'Detecta faces com 5 landmarks, alinha pelo template e extrai um ' +
          'vetor de 128 dimensões que identifica a pessoa.',
    when: 'Controle de acesso, conferência de presença.',
    not: 'Não é anti-fraude: webcam RGB cai para uma foto. Por isso o login ' +
         'exige um segundo fator.',
    cost: '~15 ms para detectar + ~50 ms por face reconhecida.',
    sensitive: true,
  },
  'CV-09': {
    what: 'Suíte completa da Ultralytics em oito modelos: detecção, instâncias, ' +
          'pose multi-pessoa, caixas orientadas, classificação, semântica, ' +
          'profundidade e rastreamento por aparência.',
    when: 'Quando é preciso o que os outros módulos não dão — contorno exato de ' +
          'cada objeto, várias pessoas ao mesmo tempo, distância por câmera única ' +
          'ou identidade persistente.',
    not: 'AGPL-3.0. Publicar o sistema na rede com estes modelos ativos obriga a ' +
         'abrir todo o código ou comprar licença comercial.',
    cost: '150 ms–3 s conforme o modelo; o de profundidade e o semântico ' +
          '(entrada 1024²) são os mais pesados.',
    agpl: true,
  },
  'CV-17': {
    what: 'OCR em português (PP-OCRv5 latino, Apache-2.0): detecta as linhas de texto e lê com ' +
          'acentos, ç, R$, datas e números — 836 caracteres.',
    when: 'Etiqueta, lote e validade, placa, painel, nota em português.',
    not: 'Só texto alinhado com a imagem: inclinado ou curvo sai mal.',
    cost: '150–200 ms por imagem.',
  },
  'CV-18': {
    what: 'Pose RTMO (MMPose, Apache-2.0): esqueleto de 17 pontos de TODAS as pessoas da cena ' +
          'em uma passada só.',
    when: 'Várias pessoas ao mesmo tempo: ergonomia em equipe, contagem de postura, quedas.',
    not: 'Sem pés e mãos detalhados (para isso, BlazePose CV-06 e Mãos CV-25).',
    cost: '0,2–0,5 s por quadro.',
  },
  'CV-19': {
    what: 'Re-identificação (OpenCV Zoo, Apache-2.0): reconhece a MESMA pessoa pela aparência ' +
          'mesmo depois de sair e voltar à cena, mantendo o ID.',
    when: 'Contar pessoas únicas, tempo de permanência, seguir alguém entre cenas.',
    not: 'Depende da roupa: uniformes iguais se confundem. Não é biometria facial.',
    cost: '~30 ms por pessoa; precisa de um detector antes (ou usa o YOLOX).',
  },
  'CV-20': {
    what: 'Recorte de fundo BiRefNet (MIT): máscara de alta qualidade do objeto principal — ' +
          'transparente, xadrez, fundo escuro, desfocado ou croma.',
    when: 'Foto de produto, fundo virtual, isolar a peça antes de outra análise.',
    not: 'Lento para vídeo (atualiza a cada ~1,5 s) e perde um pouco de detalhe fino em 512 px.',
    cost: '1,3–3 s por inferência; 51 MB.',
  },
  'CV-21': {
    what: 'Florence-2 (Microsoft, MIT): um modelo de visão e linguagem que descreve a cena em ' +
          'uma frase, lista objetos, lê texto e acha o que você escrever ("a red helmet").',
    when: 'Quando a pergunta é aberta: "o que está acontecendo aqui?", ou para achar algo que ' +
          'não está em nenhuma lista de classes.',
    not: 'Responde em inglês e não é tempo real: uma resposta a cada vários segundos.',
    cost: '230 MB uma vez; 4–14 s por resposta (WASM).',
  },
  'CV-22': {
    what: 'SAM 2.1 tiny (Meta, Apache-2.0): recorta o contorno exato de um objeto e o segue ' +
          'pelo vídeo, usando a máscara anterior como pista.',
    when: 'Medir área, isolar uma peça, acompanhar um objeto que muda de forma.',
    not: 'Não diz o que o objeto é (precisa de um detector antes ou de um ponto) e atualiza ' +
         'a cada inferência, não a cada quadro.',
    cost: '2–6 s por atualização no WASM; 63 MB.',
  },
  'CV-23': {
    what: 'RF-DETR (Roboflow, Apache-2.0): detector moderno das 80 classes do COCO, ' +
          'alternativa livre ao YOLO26.',
    when: 'Detecção de uso geral sem a amarra da AGPL; é também a base do treino livre.',
    not: 'Só as 80 classes do COCO. Para qualquer coisa, YOLOE ou Florence-2.',
    cost: 'nano ~0,2–0,4 s; small ~0,4–0,8 s (WASM).',
  },
  'CV-24': {
    what: 'Os modelos que VOCÊ treinou em Treinar modelos com motores livres: detector RF-DETR ' +
          '(suas classes) e inspeção de anomalia PatchCore (aprende só com peças boas).',
    when: 'Peças, defeitos, EPIs ou produtos específicos da sua operação; inspeção de ' +
          'qualidade com enquadramento fixo.',
    not: 'O PatchCore compara com o "normal" que viu: muda a câmera, a luz ou o enquadramento, ' +
         'treine de novo. O detector só conhece as classes que você rotulou.',
    cost: 'RF-DETR ~34 MB e 0,2–0,5 s; PatchCore ~18–21 MB e ~0,2 s.',
  },
  'CV-28': {
    what: 'Bike Fit: com a câmera de lado, mede joelho, quadril, tronco, ombro, cotovelo e ' +
          'tornozelo a cada pedalada, a cadência e o KOPS; de frente, o alinhamento do joelho.',
    when: 'Ajuste de selim e guidão, prevenção de dor no joelho e lombar, comparar posições.',
    not: 'Não substitui um fit presencial com marcadores: varia ±5–8° entre pedaladas. ' +
         'Filme sem espelho, de lado, ciclista inteiro no quadro e com boa luz.',
    cost: 'BlazePose a 14–26 Hz; YOLOX só quando perde o ciclista.',
  },
  'CV-36': {
    what: 'Volumetria de correia (GPlanSiS|BeltScan): uma linha laser sobre a correia e a câmera ' +
          'inclinada; a altura vem da triangulação, a seção da calha (DIN 22101), a vazão em m³/h, a ' +
          'massa seca em t/h e o nível com altura limite e alarmes ISA-18.2. Na bancada, cm³/s e volume.',
    when: 'Carga de correia (cavaco, minério, grãos), sobrecarga e transbordo, carga descentralizada; ' +
          'ensaio de bancada com material pesado para validar.',
    not: 'A geometria (H_c, b, α, campo de visão) tem de ser medida e calibrada com blocos; velocidade, ' +
         'densidade e umidade são informadas até haver encoder, balança e analisador. Exposição fixa.',
    cost: 'JS puro, sem modelo: ~10–15 ms por quadro a 1280 px (linha + correlação de fase).',
  },
  'CV-25': {
    what: 'Mãos (MediaPipe, Apache-2.0): até 4 mãos com 21 pontos, lado esquerdo/direito e ' +
          'gestos por regras (aberta, punho, polegar, apontar, V, OK, dedos levantados).',
    when: 'Comandos por gesto, contagem de dedos, ergonomia de mão e punho.',
    not: 'Gesto é regra sobre os pontos: mão muito de lado ou cortada fica ambígua.',
    cost: '60–240 ms por quadro.',
  },
  'CV-26': {
    what: 'Malha do rosto (MediaPipe, Apache-2.0): 478 pontos (468 da face + íris) e a ' +
          'orientação da cabeça (virar, inclinar, olhar para cima/baixo).',
    when: 'Atenção do operador, direção da cabeça, base para a análise dos olhos.',
    not: 'Não identifica a pessoa (isso é o CV-08) e erra 5–10° na orientação.',
    cost: '~140 ms para achar o rosto; 15–35 ms por quadro seguindo.',
  },
  'CV-27': {
    what: 'Olhos: abertura (EAR), piscadas por minuto, PERCLOS, direção do olhar e alerta de ' +
          'SONOLÊNCIA quando o olho fica fechado além do tempo configurado.',
    when: 'Fadiga de motorista ou operador de máquina, atenção em tela.',
    not: 'Olhar é aproximado e relativo à cabeça; rosto pequeno no quadro dá EAR baixo.',
    cost: 'Reusa a malha do CV-26 quando ela vem antes na cadeia.',
    sensitive: true,
  },
};

export function ConfigPanel({ onClose, ring, ...layout }) {
  const s = useStore(store, (st) => ({
    procWidth: st.procWidth,
    autoQuality: st.autoQuality,
    targetFps: st.targetFps,
    ringCapacity: st.ringCapacity,
    ringWidth: st.ringWidth,
    mirror: st.mirror,
  }));
  const [states, setStates] = useState(() => modelStates());
  const [tab, setTab] = useState('catalogo');
  const [openMod, setOpenMod] = useState(null);

  useEffect(() => onModelState(setStates), []);

  const set = (patch) => { store.set(patch); persist(); };

  const allWeights = { ...MODELS, ...AGPL_MODELS };
  const totalBytes = Object.values(allWeights).reduce((a, m) => a + m.bytes, 0);
  const readyCount = Object.values(states).filter((x) => x.status === 'ready').length;

  return html`
    <${Panel} id="config" title="Configurações"
              subtitle=${`${MODULES.length} módulos · ${OPERATOR_COUNT} operadores`}
              onClose=${onClose} ...${layout}>

      <div class="tabs cfg-tabs">
        <button class=${tab === 'catalogo' ? 'on' : ''} onClick=${() => setTab('catalogo')}>Catálogo</button>
        <button class=${tab === 'desempenho' ? 'on' : ''} onClick=${() => setTab('desempenho')}>Desempenho</button>
        <button class=${tab === 'livres' ? 'on' : ''} onClick=${() => setTab('livres')}>Modelos livres</button>
        <button class=${tab === 'sistema' ? 'on' : ''} onClick=${() => setTab('sistema')}>Sistema</button>
        <button class=${tab === 'via' ? 'on' : ''} onClick=${() => setTab('via')} title="Via · IA — assistente com a sua chave da Anthropic">✦ Via</button>
      </div>

      ${tab === 'livres' && html`<${LivresTab} states=${states} />`}
      ${tab === 'via' && html`<div class="cfg-sub">Via · IA</div><${ViaChave} />`}

      ${tab === 'catalogo' && html`
        <p class="hint">
          Catálogo de capacidades do <b>SPEC §4.2</b>, gerado do registry — não é
          documentação escrita à parte, então não diverge do código. <b>${OPERATOR_COUNT}</b> operadores em <b>${MODULES.length}</b> módulos,
          apoiados por <b>${Object.keys(allWeights).length}</b> modelos
          (${(totalBytes / 1e6).toFixed(0)} MB).
        </p>

        ${MODULES.map((m) => {
          const g = GUIDE[m.id] || {};
          const ops = operatorsOf(m.id);
          const open = openMod === m.id;
          const blocked = m.agpl && !agplAccepted();
          return html`
            <div key=${m.id} class="cfgmod ${blocked ? 'blocked' : ''} ${g.sensitive ? 'sens' : ''}">
              <button class="cfgmod-head" onClick=${() => setOpenMod(open ? null : m.id)}>
                <span class="mod-id">${m.id}</span>
                <span class="cfgmod-name">${m.name}</span>
                <span class="cfgmod-n">${ops.length}</span>
                <span class="mod-caret">${open ? '−' : '+'}</span>
              </button>

              ${blocked && html`<div class="cfgmod-flag">🔒 AGPL-3.0 — desligado</div>`}
              ${g.sensitive && html`<div class="cfgmod-flag sens">⚠ Dado pessoal sensível (LGPD)</div>`}

              ${open && html`
                <div class="cfgmod-body">
                  <dl class="cfg-dl">
                    <dt>O que é</dt><dd>${g.what || m.desc}</dd>
                    ${g.when && html`<dt>Quando usar</dt><dd>${g.when}</dd>`}
                    ${g.not && html`<dt>O que NÃO faz</dt><dd class="warnish">${g.not}</dd>`}
                    ${g.cost && html`<dt>Custo</dt><dd><code>${g.cost}</code></dd>`}
                  </dl>

                  ${(m.weights || []).length > 0 && html`
                    <div class="cfg-sub">Modelos</div>
                    ${m.weights.map((wid) => {
                      const w = allWeights[wid];
                      if (!w) return null;
                      const st = states[wid] || { status: 'idle' };
                      return html`
                        <div key=${wid} class="cfgw">
                          <b>${w.name}</b>
                          <span class="cfgw-meta">
                            <code>${w.input ? w.input.join('×') : '—'}</code>
                            · ${(w.bytes / 1e6).toFixed(1)} MB
                            · <i class=${w.license.startsWith('AGPL') ? 'lic-agpl' : 'lic-ok'}>${w.license}</i>
                            · ${w.source}
                          </span>
                          <span class="cfgw-st ${st.status}">
                            ${st.status === 'ready' ? `✓ ${st.ep}`
                              : st.status === 'loading' ? `${Math.round((st.progress || 0) * 100)}%`
                              : st.status === 'error' ? '⚠ erro' : 'não carregado'}
                          </span>
                        </div>
                      `;
                    })}
                  `}

                  <div class="cfg-sub">Operadores</div>
                  ${ops.map((o) => html`
                    <div key=${o.op} class="cfgop">
                      <div class="cfgop-h">
                        <b>${o.label}</b>
                        <code>${o.op}</code>
                      </div>
                      <p>${o.desc}</p>
                      ${Object.keys(o.params || {}).length > 0 && html`
                        <div class="cfgop-p">
                          ${Object.entries(o.params).map(([k, sch]) => html`
                            <span key=${k} title=${`${sch.type}${sch.min !== undefined ? ` ${sch.min}–${sch.max}` : ''}`}>
                              ${sch.label || k}
                            </span>
                          `)}
                        </div>
                      `}
                    </div>
                  `)}
                </div>
              `}
            </div>
          `;
        })}
      `}

      ${tab === 'desempenho' && html`
        <p class="hint">
          O custo dos operadores cresce com a <b>área</b>: 960 px custa 4× o que
          custa 480 px. Este é o controle real de fps.
        </p>

        <${ParamControl} name="procWidth"
          schema=${{ type: 'int', min: 160, max: 960, step: 40, label: 'Largura de processamento' }}
          value=${s.procWidth} onChange=${(v) => set({ procWidth: v })} />

        <label class="ctl ctl-bool">
          <input type="checkbox" checked=${s.autoQuality}
                 onChange=${(e) => set({ autoQuality: e.target.checked })} />
          <span>Qualidade adaptativa</span>
        </label>
        <p class="hint tight">
          Ajusta a largura sozinho para segurar o fps alvo. Sobe devagar e desce
          rápido — perder nitidez incomoda menos que engasgar.
        </p>

        <${ParamControl} name="targetFps"
          schema=${{ type: 'int', min: 10, max: 60, step: 5, label: 'FPS alvo' }}
          value=${s.targetFps} onChange=${(v) => set({ targetFps: v })} />

        <div class="sep"></div>
        <div class="cfg-sub">Buffer de frames</div>
        <p class="hint tight">
          Histórico que os controles de vídeo rebobinam. Guardado reduzido: a
          resolução plena custaria 10× a memória.
        </p>

        <${ParamControl} name="ringCapacity"
          schema=${{ type: 'int', min: 10, max: 240, step: 10, label: 'Frames guardados' }}
          value=${s.ringCapacity} onChange=${(v) => set({ ringCapacity: v })} />
        <${ParamControl} name="ringWidth"
          schema=${{ type: 'int', min: 160, max: 640, step: 40, label: 'Largura do buffer' }}
          value=${s.ringWidth} onChange=${(v) => set({ ringWidth: v })} />

        <div class="kpis">
          <div class="kpi">
            <b>${ring && ring.current ? ring.current.length : 0}</b><em>frames</em>
          </div>
          <div class="kpi">
            <b>${ring && ring.current ? ring.current.spanSeconds.toFixed(1) : '0'}</b><em>segundos</em>
          </div>
          <div class="kpi">
            <b>${ring && ring.current ? (ring.current.bytes / 1e6).toFixed(1) : '0'}</b><em>MB</em>
          </div>
        </div>

        ${ring && ring.current && ring.current.info && html`
          <div class="cfg-grid">
            <div><span>Codec do buffer</span><b class="ok">${ring.current.info.codec}</b></div>
            <div><span>Por frame</span><b>${ring.current.info.perFrameKB.toFixed(1)} KB</b></div>
            <div><span>Keyframe a cada</span><b>${ring.current.info.gop} frames</b></div>
          </div>
          <p class="hint tight">
            Frames comprimidos por <b>WebCodecs</b> em hardware. Sem compressão o
            mesmo histórico custaria cerca de <b>40×</b> mais memória — é a
            diferença entre guardar 2 segundos e guardar um minuto.
          </p>
        `}
        ${ring && ring.current && !ring.current.info && html`
          <p class="hint tight">
            Buffer <b>sem compressão</b>: este navegador não expõe WebCodecs.
            Cada frame ocupa largura × altura × 4 bytes, então o histórico fica
            curto de propósito para não estourar a memória.
          </p>
        `}
      `}

      ${tab === 'sistema' && html`
        <div class="cfg-sub">Runtime de inferência</div>
        <div class="cfg-grid">
          <div><span>WebGPU</span><b class=${supportsWebGPU() ? 'ok' : 'no'}>
            ${supportsWebGPU() ? 'disponível' : 'indisponível'}</b></div>
          <div><span>Threads WASM</span><b class=${isIsolated() ? 'ok' : 'no'}>
            ${isIsolated() ? 'ativas' : 'thread única'}</b></div>
          <div><span>Modelos carregados</span><b>${readyCount} / ${Object.keys(allWeights).length}</b></div>
          <div><span>Peso total</span><b>${(totalBytes / 1e6).toFixed(0)} MB</b></div>
          <div><span>Núcleos</span><b>${navigator.hardwareConcurrency || '—'}</b></div>
          <div><span>AGPL habilitado</span><b class=${agplAccepted() ? 'warn' : 'ok'}>
            ${agplAccepted() ? 'sim' : 'não'}</b></div>
        </div>

        ${!isIsolated() && html`
          <p class="hint tight">
            Sem cross-origin isolation o WASM roda em uma thread só. O servidor
            precisa mandar <code>COOP: same-origin</code> e <code>COEP: require-corp</code> — o <code>serve.py</code> já manda.
          </p>
        `}

        <div class="sep"></div>
        <div class="cfg-sub">Privacidade</div>
        <p class="hint tight">
          Captura, processamento e inferência acontecem <b>no dispositivo</b>.
          Nenhum frame é transmitido. O que persiste localmente: pipelines e
          preferências em <code>localStorage</code>, credenciais e vetores
          biométricos em <code>IndexedDB</code>. Nada disso sai do navegador.
        </p>

        <div class="sep"></div>
        <div class="cfg-sub">Licenças em uso</div>
        <div class="cfg-lics">
          ${Object.entries(
            Object.values(allWeights).reduce((acc, m) => {
              acc[m.license] = (acc[m.license] || 0) + 1;
              return acc;
            }, {})
          ).map(([lic, n]) => html`
            <div key=${lic} class=${lic.startsWith('AGPL') ? 'lic-agpl' : 'lic-ok'}>
              <b>${lic}</b><span>${n} modelo(s)</span>
            </div>
          `)}
        </div>
        <p class="hint tight">
          OpenCV 5 é Apache-2.0. Os modelos AGPL-3.0 (Ultralytics) só carregam
          após aceite explícito em <b>Modelos</b>, e ficam desligados por padrão.
        </p>
      `}
    <//>
  `;
}


/**
 * Aba "Modelos livres": os módulos open-source (CV-17+), cada modelo com
 * licença, tamanho, estado, pré-carga e a opção de pré-carregar ao iniciar.
 * O interruptor "só modelos livres" é o mesmo aceite AGPL do painel Modelos,
 * visto pelo lado de quem quer ficar longe dele.
 */
function LivresTab({ states }) {
  const [soLivres, setSoLivres] = useState(() => !agplAccepted());
  const [pre, setPre] = useState(() => lerPreload());
  const livres = MODULES.filter(ehLivre);

  const alternarSoLivres = (v) => {
    if (v) { for (const id of Object.keys(AGPL_MODELS)) unload(id); setAgplAccepted(false); }
    else setAgplAccepted(true);
    setSoLivres(v);
  };
  const alternarPre = (id, v) => {
    const n = v ? [...new Set([...pre, id])] : pre.filter((x) => x !== id);
    gravarPreload(n); setPre(n);
  };
  const pesos = [...new Set(livres.flatMap((m) => m.weights || []))].filter((id) => MODELS[id]);
  const totalMB = pesos.reduce((a, id) => a + (MODELS[id].bytes || 0), 0) / 1e6;

  return html`
    <p class="hint">
      Modelos open-source adicionados ao protótipo: <b>${livres.length}</b> módulos, <b>${pesos.length}</b> modelos (${totalMB.toFixed(0)} MB). Baixam sob demanda no
      primeiro uso e ficam guardados no aparelho. Uso não comercial (protótipo):
      a licença de cada modelo aparece ao lado do nome.
    </p>

    <label class="ctl ctl-bool">
      <input type="checkbox" checked=${soLivres} onChange=${(e) => alternarSoLivres(e.target.checked)} />
      <span>Usar só modelos livres (desliga e descarrega os AGPL)</span>
    </label>
    <p class="hint tight">
      Ligado, os operadores YOLO26 e YOLOE ficam bloqueados e os livres equivalentes
      assumem: RF-DETR na detecção, RTMO na pose, Re-ID por aparência no rastreio.
    </p>

    ${livres.length === 0 && html`<p class="hint">Nenhum módulo livre instalado ainda.</p>`}

    ${livres.map((m) => html`
      <div key=${m.id} class="cfgmod">
        <div class="cfgmod-head" style=${{ cursor: 'default' }}>
          <span class="mod-id">${m.id}</span>
          <span class="cfgmod-name">${m.name}</span>
          <span class="cfgmod-n">${operatorsOf(m.id).length}</span>
        </div>
        <div class="cfgmod-body">
          <p class="hint tight">${m.desc}</p>
          ${(m.weights || []).filter((id) => MODELS[id]).map((id) => {
            const w = MODELS[id];
            const st = states[id] || { status: 'idle' };
            return html`
              <div key=${id} class="cfgw">
                <b>${w.name}</b>
                <span class="cfgw-meta">
                  ${((w.bytes || 0) / 1e6).toFixed(1)} MB
                  · <i class=${/^(Apache|MIT|BSD)/.test(w.license || '') ? 'lic-ok' : 'lic-agpl'}>${w.license}</i>
                  ${w.source ? html` · ${w.source}` : ''}
                </span>
                <span class="cfgw-st ${st.status}">
                  ${st.status === 'ready' ? `✓ ${st.ep}`
                    : st.status === 'loading' ? `${Math.round((st.progress || 0) * 100)}%`
                    : st.status === 'error' ? '⚠ erro' : 'não carregado'}
                </span>
                <div class="row tight">
                  ${st.status === 'ready'
                    ? html`<button class="btn tiny" onClick=${() => unload(id)}>Descarregar</button>`
                    : html`<button class="btn tiny" disabled=${st.status === 'loading'}
                              onClick=${() => loadModel(id).catch(() => {})}>Pré-carregar</button>`}
                  <label class="ctl-bool" style=${{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '11px' }}>
                    <input type="checkbox" checked=${pre.includes(id)} onChange=${(e) => alternarPre(id, e.target.checked)} />
                    <span>ao iniciar</span>
                  </label>
                </div>
              </div>
            `;
          })}
        </div>
      </div>
    `)}

    <div class="sep"></div>
    <div class="cfg-sub">Treinar com modelos livres</div>
    <p class="hint tight">
      Em <b>Treinar modelos</b> dá para criar um detector RF-DETR com as suas fotos ou
      um inspetor de anomalias PatchCore só com fotos de peças boas. Os modelos
      treinados aparecem no módulo CV-24.
    </p>
    <div class="row"><a class="btn" href="/treino/" target="_blank" rel="noopener">Abrir Treinar modelos ↗</a></div>
  `;
}
