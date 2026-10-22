/**
 * components/CoisasPanel.js — "Coisas": o que o YOLOE deve procurar.
 *
 * O YOLOE tem dois jeitos de ser configurado, e os dois eram um campo de
 * texto solto dentro do nó do Pipeline:
 *
 *   QUALQUER COISA (yoloe.detect)  4.585 classes embutidas (LVIS + Objects365);
 *                                  a lista aqui vira o FILTRO — só estas aparecem.
 *   POR TEXTO      (yoloe.prompt)  qualquer palavra vira classe, re-parametrizada
 *                                  ao vivo pelo codificador de texto.
 *
 * Este painel monta a lista com busca no vocabulário do modelo (aceita termos
 * em português pelo dicionário abaixo), listas prontas e listas salvas pelo
 * usuário, e aplica no nó certo do Pipeline — criando o nó se ele não existir.
 */

import { html, useState, useEffect, useMemo } from '../vendor.js';
import { Panel } from './Panel.js';
import { useStore, store, persist } from '../state/store.js';
import { defaultParams } from '../cv/registry.js';
import { newNodeId } from '../cv/executor.js';
import { AGPL_MODELS, agplAccepted } from '../cv/runtime/onnx.js';
import { pedirVia } from '../via/base.js';
import { listarComandos, salvarComando, ouvir as ouvirComandos } from '../via/comandos.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const separar = (txt) => String(txt || '').split(',').map((x) => x.trim()).filter(Boolean);

/*
 * Português → nome do vocabulário (inglês). Não é tradutor: é o atalho para
 * quem procura "capacete" achar "helmet". Termos fora daqui ainda funcionam
 * no modo POR TEXTO, que aceita qualquer palavra (melhor em inglês).
 */
const PT = {
  pessoa: 'person', homem: 'man', mulher: 'woman', crianca: 'child', capacete: 'helmet',
  oculos: 'glasses', 'oculos de protecao': 'goggles', luva: 'glove', luvas: 'glove', colete: 'safety vest',
  mascara: 'mask', bota: 'boot', botas: 'boot', uniforme: 'uniform', jaleco: 'lab coat',
  empilhadeira: 'forklift', palete: 'pallet', pallet: 'pallet', caixa: 'box', 'caixa de papelao': 'cardboard box',
  caminhao: 'truck', carro: 'car', moto: 'motorcycle', bicicleta: 'bicycle', onibus: 'bus', van: 'van',
  escada: 'ladder', cone: 'traffic cone', extintor: 'extinguisher', mangueira: 'hose', corda: 'rope',
  ferramenta: 'tool', martelo: 'hammer', chave: 'wrench', 'chave de fenda': 'screwdriver', alicate: 'plier',
  furadeira: 'drill', serra: 'saw', faca: 'knife', tesoura: 'scissors', fita: 'tape', parafuso: 'screw',
  porca: 'nut', prego: 'nail', cabo: 'cable', fio: 'wire', tubo: 'pipe', valvula: 'valve', manometro: 'gauge',
  painel: 'panel', maquina: 'machine', motor: 'engine', roda: 'wheel', pneu: 'tire', barril: 'barrel',
  tambor: 'drum', balde: 'bucket', garrafa: 'bottle', lata: 'can', saco: 'bag', sacola: 'bag', etiqueta: 'label',
  computador: 'computer', notebook: 'laptop', monitor: 'monitor', teclado: 'keyboard', mouse: 'mouse',
  celular: 'smartphone', telefone: 'corded phone', impressora: 'printer', cadeira: 'chair', mesa: 'office desk',
  porta: 'door', janela: 'window', armario: 'cabinet', prateleira: 'shelf', estante: 'shelf', lixeira: 'bin',
  copo: 'cup', xicara: 'mug', prato: 'plate', garfo: 'fork', colher: 'spoon', panela: 'pot', fogao: 'stove',
  geladeira: 'fridge', microondas: 'microwave', pia: 'sink', torneira: 'faucet',
  cachorro: 'dog', gato: 'cat', passaro: 'bird', cavalo: 'horse', vaca: 'cow', boi: 'cow', ovelha: 'sheep',
  galinha: 'chicken', porco: 'pig', arvore: 'tree', planta: 'plant', flor: 'flower', fruta: 'fruit',
  maca: 'apple', banana: 'banana', laranja: 'orange', tomate: 'tomato', soja: 'soybean', milho: 'corn',
  livro: 'book', papel: 'paper', caneta: 'pen', relogio: 'clock', bolsa: 'handbag', mochila: 'backpack',
  guarda: 'umbrella', 'guarda-chuva': 'umbrella', sapato: 'shoe', chapeu: 'hat', bone: 'cap', camisa: 'shirt',
  placa: 'sign', 'placa de transito': 'traffic sign', semaforo: 'traffic light', poste: 'pole', fogo: 'fire',
  fumaca: 'smoke', 'carrinho': 'cart', 'carrinho de mao': 'wheelbarrow', container: 'container', drone: 'drone',
};

const PRONTAS = {
  'EPI e segurança': 'person, helmet, safety vest, glove, goggles, mask, boot, extinguisher, traffic cone',
  'Logística e armazém': 'person, forklift, cardboard box, box, shelf, cart, handcart, truck, ladder',
  'Chão de fábrica': 'person, machine, tool, wrench, hammer, screwdriver, drill, pipe, valve, gauge',
  'Escritório': 'person, laptop, computer, monitor, keyboard, mouse, smartphone, chair, office desk, cup',
  'Cozinha': 'cup, mug, plate, bowl, knife, fork, spoon, pot, bottle, fridge, microwave, sink',
  'Trânsito': 'person, car, truck, bus, motorcycle, bicycle, traffic light, traffic sign, traffic cone',
  'Agro e animais': 'cow, horse, sheep, pig, chicken, dog, tractor, fruit, plant, tree',
};

const SALVAS_KEY = 'aiv.coisas.listas';
function lerSalvas() {
  try { const v = JSON.parse(localStorage.getItem(SALVAS_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; }
  catch (_) { return {}; }
}
function gravarSalvas(v) { try { localStorage.setItem(SALVAS_KEY, JSON.stringify(v)); } catch (_) { /* modo privado */ } }

let vocabP = null;
function carregarVocab() {
  if (!vocabP) {
    const url = AGPL_MODELS['yoloe-pf'] && AGPL_MODELS['yoloe-pf'].classes;
    vocabP = url ? fetch(url).then((r) => r.json()).catch(() => []) : Promise.resolve([]);
  }
  return vocabP;
}

const MODOS = {
  detect: { op: 'yoloe.detect', campo: 'filtro', nome: 'Qualquer coisa', dica: 'Vocabulário fixo de 4.585 classes' },
  prompt: { op: 'yoloe.prompt', campo: 'classes', nome: 'Por texto', dica: 'Qualquer palavra vira classe, sem treino' },
};

export function CoisasPanel({ onClose, ...layout }) {
  const nodes = useStore(store, (st) => st.nodes);
  const [modo, setModo] = useState(() => (nodes.some((n) => n.op === 'yoloe.prompt') && !nodes.some((n) => n.op === 'yoloe.detect') ? 'prompt' : 'detect'));
  const M = MODOS[modo];
  const noAtual = nodes.find((n) => n.op === M.op);

  // a lista começa pelo que já está no nó, se houver
  const [lista, setLista] = useState(() => separar(noAtual && noAtual.params[M.campo]));
  useEffect(() => { setLista(separar(noAtual && noAtual.params[M.campo])); }, [modo]);   // eslint-disable-line

  const [vocab, setVocab] = useState([]);
  useEffect(() => { carregarVocab().then((v) => setVocab(Array.isArray(v) ? v : [])); }, []);
  const noVocab = useMemo(() => new Set(vocab.map(norm)), [vocab]);

  const [busca, setBusca] = useState('');
  const resultados = useMemo(() => {
    const q = norm(busca);
    if (q.length < 2 || !vocab.length) return [];
    const alvo = PT[q] ? norm(PT[q]) : null;
    const achados = vocab.filter((n) => { const k = norm(n); return k.includes(q) || (alvo && k.includes(alvo)); });
    achados.sort((a, b) => (norm(a) === (alvo || q) ? -1 : 0) - (norm(b) === (alvo || q) ? -1 : 0) || a.length - b.length);
    return achados.slice(0, 40);
  }, [busca, vocab]);
  const traducao = PT[norm(busca)];

  const [salvas, setSalvas] = useState(() => lerSalvas());
  // comandos da biblioteca da Via para o campo deste modo (yoloe.detect › filtro, yoloe.prompt › classes)
  const [, setVersaoCmd] = useState(0);
  useEffect(() => ouvirComandos(() => setVersaoCmd((n) => n + 1)), []);
  const daVia = listarComandos({ op: M.op, parametro: M.campo });
  const [nomeLista, setNomeLista] = useState('');
  const [aviso, setAviso] = useState('');

  const add = (c) => { const k = norm(c); if (k && !lista.some((x) => norm(x) === k)) setLista([...lista, c.trim()]); };
  const tirar = (c) => setLista(lista.filter((x) => x !== c));

  function aplicar() {
    const valor = lista.join(', ');
    const ns = store.get().nodes;
    const i = ns.findIndex((n) => n.op === M.op);
    let novos;
    if (i >= 0) {
      novos = ns.map((n, j) => (j === i ? { ...n, enabled: true, error: null, params: { ...n.params, [M.campo]: valor } } : n));
    } else {
      novos = [...ns, { id: newNodeId(), op: M.op, params: { ...defaultParams(M.op), [M.campo]: valor }, enabled: true }];
    }
    store.set({ nodes: novos, panels: { ...store.get().panels, pipeline: true } });
    persist();
    setAviso(i >= 0 ? 'Lista aplicada ao nó do Pipeline.' : 'Nó adicionado ao Pipeline com esta lista.');
    setTimeout(() => setAviso(''), 3500);
  }
  function salvar() {
    const nome = nomeLista.trim();
    if (!nome || !lista.length) return;
    const n = { ...salvas, [nome]: lista.join(', ') };
    gravarSalvas(n); setSalvas(n); setNomeLista('');
  }
  /** Guarda a lista também na biblioteca de comandos (aparece no ★ do Pipeline e para a Via). */
  function salvarNaBiblioteca() {
    const nome = nomeLista.trim();
    if (!nome || !lista.length) return;
    try {
      salvarComando({ nome, op: M.op, parametro: M.campo, valor: lista.join(', '), categoria: 'vocabulario', origem: 'coisas' });
      setAviso('Lista salva na biblioteca de comandos.');
    } catch (e) { setAviso(e.message); }
    setTimeout(() => setAviso(''), 3500);
  }
  function apagar(nome) {
    const n = { ...salvas }; delete n[nome]; gravarSalvas(n); setSalvas(n);
  }

  const fora = modo === 'detect' && vocab.length ? lista.filter((c) => !noVocab.has(norm(c))) : [];

  return html`
    <${Panel} id="coisas" title="Coisas" subtitle=${`${lista.length} na lista · YOLOE`}
              onClose=${onClose} ...${layout}>
      ${!agplAccepted() && html`
        <p class="hint tight" style=${{ color: 'var(--warn)' }}>
          O YOLOE é AGPL-3.0 e está desligado. Libere em <b>Modelos</b> para ele rodar;
          dá para montar a lista antes.
        </p>`}

      <div class="tabs">
        ${Object.entries(MODOS).map(([k, m]) => html`
          <button key=${k} class=${modo === k ? 'on' : ''} title=${m.dica} onClick=${() => setModo(k)}>${m.nome}</button>`)}
      </div>
      <p class="hint tight">
        ${modo === 'detect'
          ? html`O modelo já conhece 4.585 coisas. A lista funciona como <b>filtro</b>: só elas aparecem. Lista vazia = mostra tudo.`
          : html`Cada palavra vira uma classe na hora, sem treino. Funciona melhor em <b>inglês</b> e com nomes concretos ("red helmet", "open door").`}
      </p>

      <label class="ctl">
        <span class="ctl-label">Procurar ${modo === 'detect' ? 'no vocabulário' : 'ou digitar e Enter'}</span>
        <input class="txt" value=${busca} placeholder="ex.: capacete, forklift, caixa…"
               onInput=${(e) => setBusca(e.target.value)}
               onKeyDown=${(e) => {
                 if (e.key !== 'Enter') return;
                 const q = busca.trim(); if (!q) return;
                 if (modo === 'prompt') add(PT[norm(q)] || q);
                 else if (resultados[0]) add(resultados[0]);
                 setBusca('');
               }} />
      </label>
      ${traducao && html`<p class="hint tight">“${busca.trim()}” no modelo é <b>${traducao}</b>.</p>`}
      ${resultados.length > 0 && html`
        <div class="coisas-chips">
          ${resultados.map((c) => html`<button key=${c} class="coisa add" onClick=${() => add(c)} title="Adicionar">＋ ${c}</button>`)}
        </div>`}
      ${modo === 'detect' && busca.trim().length >= 2 && vocab.length > 0 && resultados.length === 0 && html`
        <p class="hint tight">Nada no vocabulário. Tente em inglês, ou use o modo <b>Por texto</b>.</p>`}

      <div class="cfg-sub">Na lista</div>
      ${lista.length === 0
        ? html`<p class="hint tight">${modo === 'detect' ? 'Vazia: o YOLOE mostra tudo o que reconhecer.' : 'Vazia: adicione pelo menos uma palavra.'}</p>`
        : html`<div class="coisas-chips">
            ${lista.map((c) => html`
              <span key=${c} class="coisa ${fora.includes(c) ? 'fora' : ''}" title=${fora.includes(c) ? 'Fora do vocabulário: no modo Qualquer coisa ela não aparece' : ''}>
                ${c}<button onClick=${() => tirar(c)} aria-label=${'Tirar ' + c}>✕</button>
              </span>`)}
          </div>`}
      ${fora.length > 0 && html`<p class="hint tight" style=${{ color: 'var(--warn)' }}>
        ${fora.length} fora do vocabulário (${fora.join(', ')}): use o modo Por texto para elas.</p>`}

      <div class="row tight" style=${{ gap: '6px', marginTop: '8px' }}>
        <button class="btn accent" onClick=${aplicar} disabled=${modo === 'prompt' && lista.length === 0}>
          ${noAtual ? 'Aplicar no Pipeline' : 'Adicionar ao Pipeline'}
        </button>
        <button class="btn" onClick=${() => setLista([])} disabled=${!lista.length}>Limpar</button>
      </div>
      ${aviso && html`<p class="hint tight" style=${{ color: 'var(--ok)' }}>✓ ${aviso}</p>`}

      <div class="sep"></div>
      <div class="cfg-sub">Listas prontas</div>
      <div class="coisas-chips">
        ${Object.entries(PRONTAS).map(([nome, txt]) => html`
          <button key=${nome} class="btn tiny" title=${txt} onClick=${() => setLista(separar(txt))}>${nome}</button>`)}
      </div>

      <div class="cfg-sub">Minhas listas</div>
      ${Object.keys(salvas).length === 0 && html`<p class="hint tight">Nenhuma ainda. Monte uma lista e salve com um nome.</p>`}
      <div class="coisas-chips">
        ${Object.entries(salvas).map(([nome, txt]) => html`
          <span key=${nome} class="coisa salva">
            <button class="coisa-nome" title=${txt} onClick=${() => setLista(separar(txt))}>${nome}</button>
            <button onClick=${() => apagar(nome)} aria-label=${'Apagar ' + nome}>✕</button>
          </span>`)}
      </div>
      <div class="row tight" style=${{ gap: '6px', marginTop: '6px' }}>
        <input class="txt" style=${{ flex: 1 }} value=${nomeLista} placeholder="Nome da lista (ex.: Linha 3)"
               onInput=${(e) => setNomeLista(e.target.value)}
               onKeyDown=${(e) => { if (e.key === 'Enter') salvar(); }} />
        <button class="btn" onClick=${salvar} disabled=${!nomeLista.trim() || !lista.length}>Salvar</button>
      </div>

      <div class="cfg-sub">Da Via e da biblioteca</div>
      ${daVia.length === 0 && html`<p class="hint tight">Nenhum comando salvo para «${M.nome}». Peça uma lista à Via.</p>`}
      <div class="coisas-chips">
        ${daVia.map((c) => html`
          <button key=${c.id} class="btn tiny" title=${c.valor} onClick=${() => setLista(separar(c.valor))}>★ ${c.nome}</button>`)}
      </div>
      <div class="coisas-via">
        <button class="btn tiny" onClick=${() => pedirVia({ op: M.op, parametro: M.campo, valor: lista.join(', '), rotulo: M.op === 'yoloe.detect' ? 'Só estas classes' : 'Classes', nodeId: noAtual ? noAtual.id : null })}>✨ Pedir lista à Via</button>
        <button class="btn tiny" onClick=${salvarNaBiblioteca} disabled=${!nomeLista.trim() || !lista.length}
                title="Usa o nome digitado acima">★ Salvar na biblioteca</button>
      </div>
    <//>
  `;
}
