/**
 * components/ProjetoPanel.js — o painel +Projeto: criar um MODELO NOVO a
 * partir das funções de tela e mouse, num assistente de seis passos.
 *
 *   1 Projeto  criar (nome, tipo) ou trazer do Treinar; classes (nome, cor)
 *   2 Prints   capturar o quadro (botão ou B), a cada N s, colar (Ctrl/⌘+V),
 *              arrastar arquivos; organizar em PASTAS (a raiz é a pasta com o
 *              nome do projeto; subpastas como "turno-A/defeitos-novos")
 *   3 Marcar   editor de rotulagem (projeto-editor.js) e exemplos ao vivo
 *              (ferramenta "+Projeto · exemplo" das Ferramentas de mouse)
 *   4 Dataset  enviar prints + caixas ao Treinar (status por print)
 *   5 Treinar  RF-DETR (detecção) ou PatchCore (anomalia), com progresso e mAP
 *   6 Usar     "Usar no Pipeline" liga o operador do modelo treinado;
 *              "Continuar melhorando" volta aos prints (pré-rotular com ele)
 *
 * Tudo fica no aparelho (IndexedDB, projeto/base.js) até ir para o Treinar
 * (projeto/servico.js). Sem URLs: as imagens são prints.
 *
 * Carregado sob demanda (SobDemanda.js), como os painéis de módulo.
 */

import { html, useState, useEffect, useRef, useCallback } from '../vendor.js';
import { useStore, store, persist } from '../state/store.js';
import { Panel } from './Panel.js';
import {
  projStore, prontoP, ativo, criarProjeto, abrirProjeto, apagarProjeto, mudarProjeto, adicionarClasse, editarClasse,
  apagarClasse, setClasseAtiva, criarPasta, renomearPasta, apagarPasta, setPastaAtiva, adicionarPrint, moverPrint,
  apagarPrint, printsDaPasta, avisar, TIPOS,
} from '../projeto/base.js';
import { capturarQuadro, origemAtual } from '../projeto/captura.js';
import { salvarQuadroComoPrint, exemplosAoVivo } from '../projeto/exemplos.js';
import { marcStore, setFerramenta } from '../cv/marcacoes.js';
import { EditorPrint, useMiniaturas } from './projeto-editor.js';
import { injetarCssProjeto } from './menu-contexto.js';
import { garantirToken, entrarComSenha, lerQuem, lerToken, listarProjetos } from '../auth/treino.js';
import * as sv from '../projeto/servico.js';

const PASSOS = [
  { id: 'projeto', rot: 'Projeto' },
  { id: 'prints', rot: 'Prints' },
  { id: 'marcar', rot: 'Marcar' },
  { id: 'dataset', rot: 'Dataset' },
  { id: 'treinar', rot: 'Treinar' },
  { id: 'usar', rot: 'Usar' },
];
const CHAVE_PASSO = 'aiv.projeto.passo';
const ATIVOS = ['fila', 'preparando', 'treinando', 'extraindo', 'calibrando', 'exportando', 'validando'];
const ESTADO = { local: 'só no aparelho', enviado: 'no Treinar · sem caixas', rotulado: 'no Treinar · rotulado', alterado: 'alterado · reenviar' };

export function ProjetoPanel(props) {
  injetarCssProjeto();
  const st = useStore(projStore, (s) => ({ pronto: s.pronto, projetos: s.projetos, ativo: s.ativo, prints: s.prints, aviso: s.aviso, memoria: s.memoria }));
  const p = st.projetos.find((x) => x.id === st.ativo) || null;
  const [passo, setPassoBruto] = useState(() => { try { return localStorage.getItem(CHAVE_PASSO) || 'projeto'; } catch (_) { return 'projeto'; } });
  const setPasso = (v) => { setPassoBruto(v); try { localStorage.setItem(CHAVE_PASSO, v); } catch (_) { /* segue */ } };
  const [editor, setEditor] = useState(null);   // { id, lista }
  useEffect(() => { prontoP(); }, []);

  const abrirEditor = (id, lista = null) => setEditor({ id, lista });

  return html`
    <${Panel} id="projeto" title="+Projeto" subtitle=${p ? p.nome : 'modelo novo a partir das marcações'}
              onClose=${props.onClose} docked=${props.docked} onUndock=${props.onUndock} onMove=${props.onMove} pos=${props.pos}>
      <div class="pj">
        <nav class="pj-passos" role="tablist" aria-label="Passos do +Projeto">
          ${PASSOS.map((s, i) => html`
            <button key=${s.id} role="tab" aria-selected=${passo === s.id} class=${passo === s.id ? 'on' : ''}
                    disabled=${!p && s.id !== 'projeto'} onClick=${() => setPasso(s.id)}>
              <b>${i + 1}</b><span>${s.rot}</span></button>`)}
        </nav>
        ${st.memoria && html`<p class="hint tight pj-alerta" role="alert">Sem armazenamento no aparelho (aba privada?): os prints ficam só nesta aba até enviar ao Treinar.</p>`}
        ${st.aviso && html`<p class="pj-aviso" role="status">${st.aviso}</p>`}
        ${!st.pronto ? html`<p class="hint tight">carregando…</p>`
          : passo === 'projeto' || !p ? html`<${PassoProjeto} p=${p} projetos=${st.projetos} irPara=${setPasso} />`
          : passo === 'prints' ? html`<${PassoPrints} p=${p} prints=${st.prints} abrirEditor=${abrirEditor} />`
          : passo === 'marcar' ? html`<${PassoMarcar} p=${p} prints=${st.prints} abrirEditor=${abrirEditor} irPara=${setPasso} />`
          : passo === 'dataset' ? html`<${PassoDataset} p=${p} prints=${st.prints} irPara=${setPasso} />`
          : passo === 'treinar' ? html`<${PassoTreinar} p=${p} prints=${st.prints} irPara=${setPasso} />`
          : html`<${PassoUsar} p=${p} irPara=${setPasso} />`}
      </div>
      ${editor && p && html`<${EditorPrint} printId=${editor.id} lista=${editor.lista} onClose=${() => setEditor(null)} />`}
    <//>`;
}

// ------------------------------------------------------------- 1 · projeto

function PassoProjeto({ p, projetos, irPara }) {
  const [novo, setNovo] = useState(!p);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('detector');
  const [cls, setCls] = useState('');
  const [nova, setNova] = useState('');
  const [msg, setMsg] = useState('');
  const [doTreinar, setDoTreinar] = useState(null);   // lista do servidor

  const criar = async () => {
    try {
      const classes = cls.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
      if (tipo === 'detector' && !classes.length) { setMsg('Informe pelo menos uma classe (separadas por vírgula).'); return; }
      await criarProjeto({ nome, tipo, classes });
      setNovo(false); setNome(''); setCls(''); setMsg('');
      irPara('prints');
    } catch (e) { setMsg(e.message); }
  };

  const listarTreinar = async () => {
    setMsg('Entrando no Treinar…');
    if (!await garantirToken()) { setMsg('Entre no Treinar no passo Dataset (conta de administrador ou senha) e volte.'); return; }
    try { setDoTreinar(await listarProjetos()); setMsg(''); } catch (e) { setMsg(e.message); }
  };
  const trazer = async (srv) => {
    try {
      setMsg(`Trazendo «${srv.nome}»…`);
      await sv.trazerDoTreinar(srv, { aoProgredir: (n, t) => setMsg(`Trazendo «${srv.nome}»: imagem ${n} de ${t}…`) });
      setDoTreinar(null); setMsg('Projeto trazido do Treinar.'); setNovo(false);
    } catch (e) { setMsg(e.message); }
  };

  return html`
    <section class="pj-sec" aria-label="Projeto">
      <div class="pj-lin">
        <select value=${p ? p.id : ''} aria-label="Projeto ativo" onChange=${(e) => { abrirProjeto(e.target.value); setNovo(false); }}>
          ${!p && html`<option value="">— nenhum projeto —</option>`}
          ${projetos.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome}${x.pid ? ' · no Treinar' : ''}</option>`)}
        </select>
        <button class=${'btn tiny' + (novo ? ' accent' : '')} onClick=${() => setNovo(!novo)} aria-expanded=${novo}>+ Novo</button>
      </div>
      ${novo && html`
        <div class="pj-caixa">
          <label class="pj-campo">Nome<input value=${nome} maxlength="60" placeholder="ex.: Peças da linha 3" onInput=${(e) => setNome(e.target.value)} /></label>
          <label class="pj-campo">Tipo
            <select value=${tipo} onChange=${(e) => setTipo(e.target.value)}>
              ${TIPOS.map((t) => html`<option key=${t.id} value=${t.id}>${t.nome}</option>`)}
            </select></label>
          ${tipo === 'detector' && html`<label class="pj-campo">Classes<input value=${cls} placeholder="ex.: parafuso, porca, arruela" onInput=${(e) => setCls(e.target.value)} /></label>`}
          ${tipo === 'anomalia' && html`<p class="hint tight">Anomalia: só fotos de peças boas (e algumas ruins para calibrar). Sem classes.</p>`}
          <p class="hint tight">Classificação de imagem ainda não existe no serviço Treinar — só detecção e anomalia.</p>
          <div class="row tight"><button class="btn accent" onClick=${criar}>Criar projeto</button>
            <button class="btn" onClick=${listarTreinar}>Abrir do Treinar…</button></div>
        </div>`}
      ${doTreinar && html`
        <ul class="pj-lista">
          ${!doTreinar.length && html`<li class="hint">Nenhum projeto no Treinar.</li>`}
          ${doTreinar.map((x) => html`<li key=${x.id}><span>${x.nome} <em>${x.tipo} · ${x.imagens} imagens</em></span>
            <button class="btn tiny" onClick=${() => trazer(x)}>Trazer</button></li>`)}
        </ul>`}
      ${p && html`
        <div class="pj-caixa">
          <label class="pj-campo">Nome do projeto (= pasta no Treinar)
            <input key=${p.id + p.nome} defaultValue=${p.nome} maxlength="60"
                   onBlur=${(e) => { const v = e.target.value.trim(); if (v && v !== p.nome) mudarProjeto({ nome: v }); }}
                   onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} /></label>
          <p class="hint tight">${TIPOS.find((t) => t.id === p.tipo).nome}${p.pid ? html` · no Treinar como <code>${p.pid}</code>` : ' · ainda não enviado'}</p>
        </div>
        ${p.tipo === 'detector' && html`
          <h4 class="pj-h">Classes</h4>
          <ul class="pj-classes" aria-label="Classes">
            ${p.classes.map((c, i) => html`
              <li key=${i + c.nome} class=${i === p.classe ? 'on' : ''}>
                <input type="radio" name="pj-cls" checked=${i === p.classe} onChange=${() => setClasseAtiva(i)} aria-label=${`Classe ativa: ${c.nome}`} />
                <input type="color" value=${c.cor} aria-label=${`Cor de ${c.nome}`} onChange=${(e) => editarClasse(i, { cor: e.target.value }).catch((er) => setMsg(er.message))} />
                <input class="pj-cls-nome" defaultValue=${c.nome} maxlength="40" aria-label="Nome da classe"
                       onBlur=${(e) => { const v = e.target.value.trim(); if (v !== c.nome) editarClasse(i, { nome: v }).catch((er) => { setMsg(er.message); e.target.value = c.nome; }); }}
                       onKeyDown=${(e) => { if (e.key === 'Enter') e.target.blur(); }} />
                ${i < 9 && html`<kbd title="atalho no editor">${i + 1}</kbd>`}
                <button class="btn tiny" aria-label=${`Apagar a classe ${c.nome}`} title="Apagar a classe (e as caixas dela)"
                        onClick=${() => { if (window.confirm(`Apagar a classe «${c.nome}» e as caixas dela?`)) apagarClasse(i).catch((er) => setMsg(er.message)); }}>✕</button>
              </li>`)}
          </ul>
          <div class="pj-lin">
            <input value=${nova} placeholder="nova classe" maxlength="40" aria-label="Nova classe" onInput=${(e) => setNova(e.target.value)}
                   onKeyDown=${(e) => { if (e.key === 'Enter') { adicionarClasse(nova).then(() => setNova('')).catch((er) => setMsg(er.message)); } }} />
            <button class="btn tiny accent" onClick=${() => adicionarClasse(nova).then(() => setNova('')).catch((er) => setMsg(er.message))}>+ Classe</button>
          </div>`}
        <div class="row tight">
          <button class="btn accent" onClick=${() => irPara('prints')}>Próximo: prints ›</button>
          <button class="btn danger" onClick=${() => { if (window.confirm(`Apagar o projeto «${p.nome}» e os prints DESTE aparelho? (o que já está no Treinar fica lá)`)) apagarProjeto(p.id); }}>Apagar</button>
        </div>`}
      ${msg && html`<p class="pj-msg" role="status">${msg}</p>`}
    </section>`;
}

// ------------------------------------------------------------- pastas

function ArvorePastas({ p, prints, onSoltar }) {
  const conta = (c) => printsDaPasta(prints, c, false).length;
  const [alvo, setAlvo] = useState(null);
  const no = (c, nivel) => html`
    <li key=${c || '\u0000'} style=${{ paddingLeft: nivel * 12 + 'px' }}>
      <button class=${'pj-pasta' + (p.pasta === c ? ' on' : '') + (alvo === c ? ' alvo' : '')} aria-pressed=${p.pasta === c}
              onClick=${() => setPastaAtiva(c)}
              onDragOver=${(e) => { e.preventDefault(); setAlvo(c); }} onDragLeave=${() => setAlvo(null)}
              onDrop=${(e) => { e.preventDefault(); setAlvo(null); const id = e.dataTransfer.getData('text/x-aiv-print'); if (id) onSoltar(id, c); }}>
        <span aria-hidden="true">${c ? '📁' : '🗂'}</span> ${c ? c.split('/').pop() : p.nome} <em>${conta(c)}</em>
      </button>
    </li>`;
  return html`
    <ul class="pj-arvore" aria-label="Pastas do projeto">
      ${no('', 0)}
      ${p.pastas.map((c) => no(c, c.split('/').length))}
    </ul>`;
}

function AcoesPasta({ p, setMsg }) {
  const nova = async (sub) => {
    const base = sub && p.pasta ? p.pasta + '/' : '';
    const n = window.prompt(sub ? `Nome da subpasta de «${p.pasta || p.nome}»:` : 'Nome da pasta (use / para subpasta):', '');
    if (!n) return;
    try { await criarPasta(base + n); } catch (e) { setMsg(e.message); }
  };
  return html`
    <div class="pj-lin pj-pasta-acoes">
      <button class="btn tiny" onClick=${() => nova(false)}>+ Pasta</button>
      <button class="btn tiny" disabled=${!p.pasta} onClick=${() => nova(true)}>+ Subpasta</button>
      <button class="btn tiny" disabled=${!p.pasta} onClick=${() => { const n = window.prompt('Novo nome da pasta:', p.pasta); if (n) renomearPasta(p.pasta, n).catch((e) => setMsg(e.message)); }}>Renomear</button>
      <button class="btn tiny" disabled=${!p.pasta} onClick=${() => { if (window.confirm(`Apagar a pasta «${p.pasta}»? Os prints sobem para a pasta-mãe.`)) apagarPasta(p.pasta); }}>Apagar</button>
    </div>`;
}

// ------------------------------------------------------------- 2 · prints

/** Captura do quadro (botão, atalho B e "a cada N s"). */
async function capturar(setMsg) {
  const b = await capturarQuadro();
  if (!b) { setMsg('Sem imagem da fonte: ligue a câmera, abra um vídeo, a tela ou o YouTube.'); return null; }
  const pr = await adicionarPrint(b, { origem: origemAtual(store.get()) });
  setMsg(`Print ${pr.w} × ${pr.h} capturado em «${pr.pasta || ativo().nome}».`);
  return pr;
}

function PassoPrints({ p, prints, abrirEditor }) {
  const [msg, setMsg] = useState('');
  const [cada, setCada] = useState(0);         // segundos; 0 = parado
  const [n, setN] = useState(3);
  const [sub, setSub] = useState(false);
  const [sel, setSel] = useState(null);
  const [solta, setSolta] = useState(false);
  const arq = useRef(null);
  const lista = printsDaPasta(prints, p.pasta, sub);
  const urls = useMiniaturas(prints);

  // a cada N s
  useEffect(() => {
    if (!cada) return undefined;
    const t = setInterval(() => capturar(setMsg), cada * 1000);
    return () => clearInterval(t);
  }, [cada]);

  const adicionarArquivos = async (fs, origem) => {
    let k = 0;
    for (const f of fs) { if (!/^image\//.test(f.type)) continue; try { await adicionarPrint(f, { origem }); k++; } catch (e) { setMsg(e.message); break; } }
    if (k) setMsg(`${k} ${k === 1 ? 'imagem adicionada' : 'imagens adicionadas'} em «${p.pasta || p.nome}».`);
  };

  // atalho B e colar (Ctrl/⌘+V) enquanto este passo está aberto
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('.pje')) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); capturar(setMsg); }
    };
    const onPaste = (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
      if (document.querySelector('.via-gaveta:focus-within, .pje')) return;
      const fs = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
      if (!fs.length) return;
      e.preventDefault();
      adicionarArquivos(fs, 'colado');
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('paste', onPaste); };
  }, [p.id, p.pasta]);

  const pr = sel && prints.find((x) => x.id === sel);

  return html`
    <section class=${'pj-sec' + (solta ? ' pj-solta' : '')} aria-label="Prints"
             onDragOver=${(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setSolta(true); } }}
             onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setSolta(false); }}
             onDrop=${(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setSolta(false); adicionarArquivos([...e.dataTransfer.files], 'arquivo'); }}>
      <div class="pj-lin">
        <button class="btn accent" onClick=${() => capturar(setMsg)} title="Capturar o quadro atual (B)">Capturar quadro <kbd>B</kbd></button>
        <button class="btn" onClick=${() => arq.current && arq.current.click()}>Arquivos…</button>
        <input ref=${arq} type="file" accept="image/*" multiple hidden onChange=${(e) => { adicionarArquivos([...e.target.files], 'arquivo'); e.target.value = ''; }} />
      </div>
      <div class="pj-lin">
        <label class="pj-cada"><input type="checkbox" checked=${!!cada} onChange=${(e) => setCada(e.target.checked ? Math.max(1, n) : 0)} />
          capturar a cada</label>
        <input class="pj-num" type="number" min="1" max="600" value=${n} aria-label="Segundos entre capturas"
               onInput=${(e) => { const v = Math.max(1, Math.min(600, +e.target.value || 1)); setN(v); if (cada) setCada(v); }} /> s
        ${cada ? html`<em class="pj-gravando" role="status">● capturando</em>` : null}
      </div>
      <p class="hint tight">Cole uma imagem (Ctrl/⌘+V) ou arraste arquivos para cá. Fica no aparelho até “Salvar no dataset”.</p>

      <h4 class="pj-h">Pastas</h4>
      <${ArvorePastas} p=${p} prints=${prints} onSoltar=${(id, c) => moverPrint(id, c).then(() => setMsg(`Print movido para «${c || p.nome}».`))} />
      <${AcoesPasta} p=${p} setMsg=${setMsg} />

      <div class="pj-lin pj-tira-cab">
        <b>${p.pasta ? p.pasta : p.nome}</b><em>${lista.length} ${lista.length === 1 ? 'print' : 'prints'}</em>
        <label class="pj-sub"><input type="checkbox" checked=${sub} onChange=${(e) => setSub(e.target.checked)} /> subpastas</label>
      </div>
      <div class="pj-tira" role="listbox" aria-label="Prints da pasta">
        ${!lista.length && html`<p class="hint">Nenhum print nesta pasta.</p>`}
        ${lista.map((x) => html`
          <button key=${x.id} role="option" aria-selected=${sel === x.id} class=${'pj-mini' + (sel === x.id ? ' on' : '')}
                  draggable="true" onDragStart=${(e) => e.dataTransfer.setData('text/x-aiv-print', x.id)}
                  onClick=${() => setSel(x.id)} onDoubleClick=${() => abrirEditor(x.id, lista.map((y) => y.id))}
                  title=${`${x.nome} · ${ESTADO[x.estado]} · ${x.origem}`}>
            <img src=${urls.get(x.id)} alt=${x.nome} loading="lazy" />
            <i class=${'pj-dot pj-e-' + x.estado} aria-label=${ESTADO[x.estado]}></i>
            ${p.tipo === 'anomalia' ? html`<b class=${x.grupo === 'ruim' ? 'ruim' : ''}>${x.grupo === 'ruim' ? 'RUIM' : 'BOA'}</b>` : x.caixas.length ? html`<b>${x.caixas.filter((c) => !c.sug).length}</b>` : null}
          </button>`)}
      </div>
      ${pr && html`
        <div class="pj-caixa pj-selp">
          <p class="hint tight"><b>${pr.nome}</b> · ${pr.w}×${pr.h} · ${pr.origem} · ${ESTADO[pr.estado]}</p>
          <div class="pj-lin">
            <button class="btn tiny accent" onClick=${() => abrirEditor(pr.id, lista.map((y) => y.id))}>Marcar</button>
            <select value=${pr.pasta} aria-label="Mover para a pasta" onChange=${(e) => moverPrint(pr.id, e.target.value).then(() => setMsg(`Movido para «${e.target.value || p.nome}».`))}>
              <option value="">${p.nome} (raiz)</option>
              ${p.pastas.map((c) => html`<option key=${c} value=${c}>${c}</option>`)}
            </select>
            <button class="btn tiny danger" onClick=${() => { if (window.confirm('Apagar este print do aparelho?')) { apagarPrint(pr.id); setSel(null); } }}>Apagar</button>
          </div>
        </div>`}
      ${msg && html`<p class="pj-msg" role="status">${msg}</p>`}
    </section>`;
}

// ------------------------------------------------------------- 3 · marcar

function PassoMarcar({ p, prints, abrirEditor, irPara }) {
  const nEx = useStore(marcStore, (s) => ({ n: s.itens.filter((i) => i.funcao === 'projeto_exemplo').length })).n;
  const [msg, setMsg] = useState('');
  const lista = printsDaPasta(prints, p.pasta, true);
  const sem = lista.filter((x) => (p.tipo === 'anomalia' ? false : !x.caixas.some((c) => !c.sug)));
  const ao = async () => {
    const pr = await capturar(setMsg);
    if (pr) abrirEditor(pr.id, [...lista.map((x) => x.id), pr.id]);
  };
  return html`
    <section class="pj-sec" aria-label="Marcar">
      <p class="hint tight">${lista.length} prints em «${p.pasta || p.nome}» e subpastas · ${p.tipo === 'anomalia' ? `${lista.filter((x) => x.grupo === 'ruim').length} ruins` : `${sem.length} sem caixas`}.</p>
      <div class="pj-lin">
        <button class="btn accent" disabled=${!lista.length} onClick=${() => abrirEditor((sem[0] || lista[0]).id, lista.map((x) => x.id))}>Abrir o editor</button>
        <button class="btn" onClick=${ao}>Marcar o quadro ao vivo</button>
      </div>
      <h4 class="pj-h">Exemplos direto no vídeo</h4>
      <p class="hint tight">A ferramenta <b>+Projeto · exemplo</b> (J) das Ferramentas de mouse desenha caixas com a classe ativa sobre o vídeo; continuam editáveis (mover, alças, trocar classe na lista ⇧K). Clique direito numa área: rotular, ler texto, detectar…</p>
      <div class="pj-lin">
        <button class="btn" onClick=${() => { store.set({ ferramentas: true }); persist(); setFerramenta('exemplo'); }}>Desenhar exemplos no vídeo</button>
        <button class="btn accent" disabled=${!nEx} onClick=${async () => {
          try { const pr = await salvarQuadroComoPrint({}); setMsg(`Print salvo com ${pr.caixas.length} exemplos.`); } catch (e) { setMsg(e.message); }
        }}>Salvar estes exemplos (${nEx})</button>
      </div>
      <p class="hint tight">No editor: arraste para a caixa (R), polígono (P), selecionar (V), 1–9 classe, Delete apaga, Ctrl/⌘+Z desfaz, [ ] navega, Pré-rotular propõe caixas tracejadas — você aceita, edita ou rejeita.</p>
      <button class="btn accent" onClick=${() => irPara('dataset')}>Próximo: salvar no dataset ›</button>
      ${msg && html`<p class="pj-msg" role="status">${msg}</p>`}
    </section>`;
}

// ------------------------------------------------------------- entrar no Treinar

function useTreinar() {
  const [token, setToken] = useState(lerToken());
  const [tentou, setTentou] = useState(false);
  useEffect(() => {
    if (token) return;
    garantirToken().then((t) => { setToken(t); setTentou(true); });
  }, []);
  return { token, setToken, tentou };
}

function Entrar({ setToken }) {
  const [senha, setSenha] = useState('');
  const [msg, setMsg] = useState('');
  return html`
    <div class="pj-caixa">
      <p class="hint tight">Para enviar ao Treinar: entre com a conta de administrador do iaVision (automático) ou com a senha do treino.</p>
      <div class="pj-lin">
        <input type="password" value=${senha} placeholder="senha do Treinar" aria-label="Senha do Treinar" onInput=${(e) => setSenha(e.target.value)}
               onKeyDown=${(e) => { if (e.key === 'Enter') e.target.nextElementSibling.click(); }} />
        <button class="btn tiny accent" onClick=${async () => { try { setToken(await entrarComSenha(senha)); setSenha(''); } catch (e) { setMsg(e.message); } }}>Entrar</button>
      </div>
      ${msg && html`<p class="pj-msg" role="alert">${msg}</p>`}
    </div>`;
}

// ------------------------------------------------------------- 4 · dataset

function PassoDataset({ p, prints, irPara }) {
  const { token, setToken, tentou } = useTreinar();
  const [escopo, setEscopo] = useState('tudo');
  const [prog, setProg] = useState('');
  const [res, setRes] = useState(null);
  const alvo = escopo === 'tudo' ? prints : printsDaPasta(prints, p.pasta, true);
  const pend = alvo.filter((x) => x.estado === 'local' || x.estado === 'alterado' || x.renomear);
  const conta = (e) => alvo.filter((x) => x.estado === e).length;
  const enviar = async () => {
    setRes(null);
    try {
      const r = await sv.salvarNoDataset(alvo, (i, n) => setProg(`Enviando ${i} de ${n}…`));
      setRes(r);
    } catch (e) { setRes({ ok: 0, erros: [e.message], total: pend.length }); if (e.status === 401) setToken(''); }
    setProg('');
  };
  return html`
    <section class="pj-sec" aria-label="Salvar no dataset">
      ${!token ? (tentou ? html`<${Entrar} setToken=${setToken} />` : html`<p class="hint tight">entrando no Treinar…</p>`)
        : html`<p class="hint tight">No Treinar${lerQuem() ? ` como ${lerQuem()}` : ''}. Projeto «${p.nome}»${p.pid ? html` = <code>${p.pid}</code>` : ' (será criado no 1º envio)'}.</p>`}
      <div class="pj-lin">
        <label><input type="radio" name="pj-esc" checked=${escopo === 'tudo'} onChange=${() => setEscopo('tudo')} /> todo o projeto</label>
        <label><input type="radio" name="pj-esc" checked=${escopo === 'pasta'} onChange=${() => setEscopo('pasta')} /> pasta «${p.pasta || p.nome}»</label>
      </div>
      <ul class="pj-contas">
        <li><i class="pj-dot pj-e-local"></i> só no aparelho <b>${conta('local')}</b></li>
        <li><i class="pj-dot pj-e-alterado"></i> alterados <b>${conta('alterado')}</b></li>
        <li><i class="pj-dot pj-e-enviado"></i> enviados sem caixas <b>${conta('enviado')}</b></li>
        <li><i class="pj-dot pj-e-rotulado"></i> rotulados no Treinar <b>${conta('rotulado')}</b></li>
      </ul>
      <button class="btn accent" disabled=${!token || !pend.length || !!prog} onClick=${enviar}>Salvar no dataset (${pend.length})</button>
      ${prog && html`<p class="pj-msg" role="status">${prog}</p>`}
      ${res && html`<p class="pj-msg" role="status">${res.ok} de ${res.total} enviados.${res.erros.length ? ' Erros: ' + res.erros.slice(0, 3).join(' · ') : ''}</p>`}
      <p class="hint tight">O Treinar não tem subpastas: a pasta vai no nome do arquivo (ex.: <code>turno-A--defeitos__print-….jpg</code>) e na origem da imagem (“pasta: turno-A/defeitos · …”). Editar depois e salvar de novo substitui as caixas (PUT rótulos); mudar de pasta reenvia a imagem. Imagem idêntica a uma já enviada é recusada como repetida.</p>
      <button class="btn" onClick=${() => irPara('treinar')}>Próximo: treinar ›</button>
    </section>`;
}

// ------------------------------------------------------------- 5 · treinar

function Grafico({ hist }) {
  if (!hist || hist.length < 2) return null;
  const W = 260, H = 46;
  const xs = (i) => (i / (hist.length - 1)) * W;
  const ys = (v) => H - 2 - (Math.max(0, Math.min(1, v || 0)) * (H - 4));
  const d = hist.map((e, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(e.map50).toFixed(1)}`).join(' ');
  return html`<svg class="pj-graf" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="mAP50 por época">
    <path d=${d} fill="none" stroke="currentColor" stroke-width="2" /></svg>`;
}

function PassoTreinar({ p, prints, irPara }) {
  const { token, setToken, tentou } = useTreinar();
  const [epocas, setEpocas] = useState(20);
  const [imgsz, setImgsz] = useState(p.tipo === 'anomalia' ? 256 : 384);
  const [variante, setVariante] = useState('nano');
  const [msg, setMsg] = useState('');
  const t = p.treino;
  const rodando = t && ATIVOS.includes(t.estado);

  // acompanha a fila/progresso enquanto o treino está ativo
  useEffect(() => {
    if (!token || !t || !t.tid) return undefined;
    let vivo = true;
    const passo = async () => { try { const r = await sv.acompanhar(); if (vivo && r && ATIVOS.includes(r.estado)) tm = setTimeout(passo, 2000); } catch (e) { if (vivo) setMsg(e.message); } };
    let tm = setTimeout(passo, rodando ? 1500 : 0);
    return () => { vivo = false; clearTimeout(tm); };
  }, [token, t && t.tid, rodando]);

  const rot = prints.filter((x) => x.estado === 'rotulado').length;
  const iniciar = async () => {
    setMsg('');
    try { await sv.treinar({ epocas, imgsz, variante }); } catch (e) { setMsg(e.message); if (e.status === 401) setToken(''); }
  };
  const m = t && t.metricas;
  return html`
    <section class="pj-sec" aria-label="Treinar">
      ${!token && (tentou ? html`<${Entrar} setToken=${setToken} />` : html`<p class="hint tight">entrando no Treinar…</p>`)}
      <p class="hint tight">${rot} prints rotulados no Treinar${p.tipo === 'detector' ? ' (mínimo 4; o ideal é 50+ por classe)' : ' (mínimo 8 peças boas)'}.</p>
      ${p.tipo === 'detector' ? html`
        <div class="pj-grade">
          <label class="pj-campo">Épocas<input type="number" min="1" max="200" value=${epocas} onInput=${(e) => setEpocas(+e.target.value || 20)} /></label>
          <label class="pj-campo">Tamanho<select value=${imgsz} onChange=${(e) => setImgsz(+e.target.value)}>
            ${[320, 384, 448, 512, 576, 640].map((v) => html`<option key=${v} value=${v}>${v} px</option>`)}</select></label>
          <label class="pj-campo">Variante<select value=${variante} onChange=${(e) => setVariante(e.target.value)}>
            <option value="nano">nano (rápido)</option><option value="small">small</option><option value="medium">medium</option></select></label>
        </div>
        <p class="hint tight">Motor RF-DETR (Apache-2.0). O YOLO26 (AGPL-3.0) fica de fora aqui de propósito.</p>`
      : html`<label class="pj-campo">Tamanho<select value=${imgsz} onChange=${(e) => setImgsz(+e.target.value)}>
            ${[224, 256, 320].map((v) => html`<option key=${v} value=${v}>${v} px</option>`)}</select></label>`}
      <button class="btn accent" disabled=${!token || rodando} onClick=${iniciar}>${rodando ? 'Treinando…' : 'Treinar'}</button>
      ${t && html`
        <div class="pj-caixa pj-treino" aria-live="polite">
          <p><b>${t.nome}</b></p>
          <p>Estado: <b>${t.estado}</b>${t.estado === 'fila' && t.posicao ? ` · posição ${t.posicao} na fila` : ''}</p>
          ${t.total ? html`<div class="pj-barra" role="progressbar" aria-valuemin="0" aria-valuemax=${t.total} aria-valuenow=${t.epoca}>
            <i style=${{ width: Math.round((100 * (t.epoca || 0)) / t.total) + '%' }}></i></div>
            <p class="hint tight">época ${t.epoca || 0} de ${t.total}</p>` : null}
          ${m && html`<p>mAP50 <b>${(m.map50 != null ? m.map50 * 100 : 0).toFixed(1)}%</b> · mAP50-95 <b>${(m.map50_95 != null ? m.map50_95 * 100 : 0).toFixed(1)}%</b>${m.precisao != null ? ` · precisão ${(m.precisao * 100).toFixed(0)}%` : ''}${m.recall != null ? ` · recall ${(m.recall * 100).toFixed(0)}%` : ''}</p>`}
          <${Grafico} hist=${t.historico} />
          ${t.erro && html`<p class="pj-msg" role="alert">⚠ ${t.erro}</p>`}
          ${t.log && t.log.length ? html`<pre class="pj-log">${t.log.join('\n')}</pre>` : null}
          <div class="pj-lin">
            ${rodando && html`<button class="btn tiny danger" onClick=${() => sv.cancelarTreino().catch((e) => setMsg(e.message))}>Cancelar</button>`}
            ${t.estado === 'pronto' && !t.publicado && html`<button class="btn tiny accent" onClick=${() => sv.publicar().catch((e) => setMsg(e.message))}>Publicar</button>`}
            ${t.publicado && html`<button class="btn tiny accent" onClick=${() => irPara('usar')}>Publicado · usar ›</button>`}
          </div>
        </div>`}
      ${msg && html`<p class="pj-msg" role="alert">${msg}</p>`}
    </section>`;
}

// ------------------------------------------------------------- 6 · usar

/** Põe o operador do modelo treinado no Pipeline (no começo: as caixas alimentam os seguintes) e liga. */
async function usarNoPipeline(p) {
  const { registrarTreinadosLivres } = await import('../cv/operators/livres-c.js');
  const { defaultParams } = await import('../cv/registry.js');
  const { newNodeId } = await import('../cv/executor.js');
  await registrarTreinadosLivres();
  const op = p.tipo === 'anomalia' ? 'livres.patchcore' : 'livres.rfdetr';
  const nodes = store.get().nodes.slice();
  const i = nodes.findIndex((n) => n.op === op && n.params && n.params.modelo === p.modelo);
  if (i >= 0) nodes[i] = { ...nodes[i], enabled: true };
  else nodes.unshift({ id: newNodeId(), op, params: { ...defaultParams(op), modelo: p.modelo }, enabled: true });
  store.set({ nodes, running: true });
  persist();
}

function PassoUsar({ p, irPara }) {
  const noPipe = useStore(store, (s) => ({ n: s.nodes.some((n) => n.enabled && (n.op === 'livres.rfdetr' || n.op === 'livres.patchcore') && n.params && n.params.modelo === p.modelo) })).n;
  const [msg, setMsg] = useState('');
  return html`
    <section class="pj-sec" aria-label="Usar o modelo">
      ${!p.modelo ? html`<p class="hint tight">Ainda não há modelo publicado deste projeto. Treine no passo 5.</p>
        <button class="btn" onClick=${() => irPara('treinar')}>‹ Treinar</button>`
      : html`
        <p class="hint tight">Modelo publicado: <code>${p.modelo}</code>${p.treino && p.treino.metricas && p.treino.metricas.map50 != null ? ` · mAP50 ${(p.treino.metricas.map50 * 100).toFixed(1)}%` : ''}.</p>
        <div class="pj-lin">
          <button class="btn accent" onClick=${() => usarNoPipeline(p).then(() => setMsg('No Pipeline e ligado. Abra o Pipeline (p) para ajustar a confiança.')).catch((e) => setMsg(e.message))}>
            ${noPipe ? 'No Pipeline ✓' : 'Usar no Pipeline'}</button>
          <button class="btn" onClick=${() => { avisar('Pré-rotule os prints novos com o modelo do projeto (editor › Pré-rotular).'); irPara('prints'); }}>Continuar melhorando</button>
        </div>
        <p class="hint tight">Continuar melhorando: capture mais prints (sobretudo os erros), pré-rotule com o modelo novo, corrija e treine de novo.</p>`}
      ${msg && html`<p class="pj-msg" role="status">${msg}</p>`}
    </section>`;
}
