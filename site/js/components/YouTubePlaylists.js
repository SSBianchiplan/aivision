/**
 * components/YouTubePlaylists.js — playlists do YouTube no painel Fonte.
 *
 *   SalvarNaPlaylist  caixa «Salvar na playlist» do cartão do vídeo atual:
 *                     escolhe (ou cria) a playlist e a categoria.
 *   PlaylistsModal    os vídeos salvos: filtro por playlist, categoria e
 *                     título; abrir, mover, copiar, trocar categoria,
 *                     remover, reordenar, tocar em sequência, backup JSON.
 *   FilaBarra         a playlist que está tocando: anterior/próximo,
 *                     repetir a playlist, parar.
 *
 * Os dados são de youtube/playlists.js (API assíncrona, pronta para ir ao
 * servidor) e a sequência é de youtube/fila.js. Miniaturas pelo proxy
 * /api/yt/miniatura/{id}: a página é COEP e só aceita imagem da mesma origem.
 */

import { confirmar } from './dialogo.js';
import { html, ReactDOM, useState, useEffect, useRef, useMemo } from '../vendor.js';
import { store, useStore } from '../state/store.js';
import { baixarBlob } from '../camera/youtube.js';
import * as pl from '../youtube/playlists.js';
import { fila } from '../youtube/fila.js';

const NOVA = '__nova__';
const TODAS = '__todas__';

export const fmtDur = (s) => {
  if (s == null || !isFinite(s) || s <= 0) return '';
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};

/** Re-renderiza a cada mudança nas playlists; devolve o retrato atual. */
export function usePlaylists() {
  const [d, set] = useState(pl.estado);
  useEffect(() => { set(pl.estado()); return pl.ouvir(() => set(pl.estado())); }, []);
  return d;
}

/** Re-renderiza com a fila (e com o player, para saber se ela segue ativa). */
export function useFila(yt) {
  const [, set] = useState(0);
  useEffect(() => fila.ouvir(() => set((n) => n + 1)), []);
  useEffect(() => (yt ? yt.ouvir(() => set((n) => n + 1)) : undefined), [yt]);
  return fila;
}

// lembra a última escolha entre aberturas da caixa (salvar vários vídeos seguidos)
let ultimaPl = null;
let ultimaCat = pl.CATEGORIA_PADRAO;

// =============================================================== salvar

export function SalvarNaPlaylist({ video, onFechar, onSalvo }) {
  const d = usePlaylists();
  const cats = pl.listarCategorias();
  const inicialPl = d.playlists.some((p) => p.id === ultimaPl) ? ultimaPl : (d.playlists[0] ? d.playlists[0].id : NOVA);
  const [plId, setPlId] = useState(inicialPl);
  const [nomePl, setNomePl] = useState('');
  const [cat, setCat] = useState(() => {
    const ja = pl.ondeEsta(video.id)[0];
    if (ja) return ja.item.categoria;
    return cats.some((c) => c.id === ultimaCat) ? ultimaCat : pl.CATEGORIA_PADRAO;
  });
  const [nomeCat, setNomeCat] = useState('');
  const [erro, setErro] = useState(null);
  const [busy, setBusy] = useState(false);
  const ja = pl.ondeEsta(video.id);
  const primeiro = useRef(null);

  useEffect(() => { if (primeiro.current) primeiro.current.focus(); }, []);

  const salvar = async (e) => {
    e.preventDefault();
    setErro(null);
    setBusy(true);
    try {
      let id = plId;
      if (id === NOVA) id = (await pl.criarPlaylist(nomePl)).id;
      let c = cat;
      if (c === NOVA) c = (await pl.criarCategoria(nomeCat)).id;
      const { novo } = await pl.salvarVideo(id, video, c);
      ultimaPl = id;
      ultimaCat = c;
      const p = pl.obterPlaylist(id);
      onSalvo && onSalvo(novo ? `Salvo em «${p.nome}» (${pl.obterCategoria(c).nome}).`
        : `Atualizado em «${p.nome}» (${pl.obterCategoria(c).nome}).`);
      onFechar();
    } catch (err) {
      setErro(err.message);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <form class="ytpl-salvar" onSubmit=${salvar} aria-label="Salvar na playlist"
          onKeyDown=${(e) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar(); } }}>
      <div class="ytpl-salvar-cab">
        <b>Salvar na playlist</b>
        <button type="button" class="yt-x" aria-label="Fechar" onClick=${onFechar}>×</button>
      </div>
      <label class="ctl">
        <span class="ctl-label">Playlist</span>
        <select ref=${primeiro} value=${plId} onChange=${(e) => setPlId(e.target.value)}>
          ${d.playlists.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome} (${p.itens.length})</option>`)}
          <option value=${NOVA}>+ Nova playlist…</option>
        </select>
      </label>
      ${plId === NOVA && html`
        <input class="ytpl-txt" type="text" placeholder="Nome da nova playlist" maxlength="80" required
               aria-label="Nome da nova playlist" value=${nomePl} onInput=${(e) => setNomePl(e.target.value)} />
      `}
      <label class="ctl">
        <span class="ctl-label">Categoria <small>tipo de modelo / análise</small></span>
        <select value=${cat} onChange=${(e) => setCat(e.target.value)}>
          ${cats.map((c) => html`<option key=${c.id} value=${c.id}>${c.nome}${c.propria ? ' ·' : ''}</option>`)}
          <option value=${NOVA}>+ Nova categoria…</option>
        </select>
      </label>
      ${cat === NOVA && html`
        <input class="ytpl-txt" type="text" placeholder="Nome da nova categoria (ex.: Natação)" maxlength="80" required
               aria-label="Nome da nova categoria" value=${nomeCat} onInput=${(e) => setNomeCat(e.target.value)} />
      `}
      ${ja.length > 0 && html`
        <p class="hint tight">Já está em: ${ja.map((x, i) => html`<b key=${x.playlist.id}>${i ? ', ' : ''}${x.playlist.nome}</b>`)}.
          Salvar de novo na mesma playlist só troca a categoria.</p>
      `}
      ${erro && html`<div class="notice" role="alert">${erro}</div>`}
      <div class="row">
        <button class="btn accent" type="submit" disabled=${busy}>${busy ? 'Salvando…' : 'Salvar'}</button>
        <button class="btn" type="button" onClick=${onFechar}>Cancelar</button>
      </div>
    </form>
  `;
}

// =============================================================== fila

export function FilaBarra({ yt }) {
  const f = useFila(yt);
  const loop = useStore(store, (st) => st.loop !== false);
  if (!f.ativa) return null;
  const p = f.playlist;
  const { indice, total } = f.posicao;
  return html`
    <div class="ytpl-fila" role="group" aria-label="Playlist tocando">
      <div class="ytpl-fila-l">
        <span class="ytpl-fila-t" title=${p.nome}>▶ <b>${p.nome}</b></span>
        <span class="ytpl-fila-n">${indice + 1}/${total}</span>
        <button class="btn tiny" title="Vídeo anterior" aria-label="Vídeo anterior"
                disabled=${indice <= 0 && !f.repetirLista} onClick=${() => f.anterior()}>⏮</button>
        <button class="btn tiny" title="Próximo vídeo" aria-label="Próximo vídeo"
                disabled=${indice >= total - 1 && !f.repetirLista} onClick=${() => f.proximo()}>⏭</button>
        <button class="btn tiny ${f.repetirLista ? 'on' : ''}" aria-pressed=${f.repetirLista}
                title=${f.repetirLista ? 'Repetir a playlist: ligado (volta ao primeiro no fim)' : 'Repetir a playlist: desligado'}
                onClick=${() => f.alternarRepetir()}>🔁</button>
        <button class="btn tiny" title="Parar a sequência (o vídeo atual continua)" aria-label="Parar a sequência"
                onClick=${() => f.parar()}>✕</button>
      </div>
      ${loop && html`
        <p class="hint tight">
          <b>Repetir (⟲)</b> foi religado: o vídeo atual recomeça ao terminar, em vez de seguir a playlist.
          <button class="ytpl-link" onClick=${() => store.set({ loop: false })}>Desligar</button>
          para seguir a playlist sozinho.
        </p>
      `}
    </div>
  `;
}

// =============================================================== modal

/**
 * Diálogo acessível: fundo escuro, foco preso, Esc fecha, devolve o foco a
 * quem abriu. Vai para o <body> por portal (painéis arrastáveis têm
 * transform, e position: fixed dentro deles não cobriria a tela).
 * As teclas não escapam para os atalhos do app (espaço, letras, + e −).
 */
function Modal({ rotulo, onFechar, children }) {
  const ref = useRef(null);
  const fechar = useRef(onFechar);
  fechar.current = onFechar;

  useEffect(() => {
    const el = ref.current;
    const antes = document.activeElement;
    const focaveis = () => [...el.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((x) => x.getClientRects().length > 0);
    const ini = el.querySelector('[data-autofoco]') || focaveis()[0] || el;
    ini.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar.current(); return; }
      if (e.key === 'Tab') {
        const l = focaveis();
        if (!l.length) { e.preventDefault(); return; }
        const a = l[0], z = l[l.length - 1];
        if (e.shiftKey && (document.activeElement === a || document.activeElement === el)) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
      e.stopPropagation();
    };
    // o foco não sai do diálogo (clique fora, Tab vindo do navegador)
    const onFoco = (e) => { if (!el.contains(e.target)) (focaveis()[0] || el).focus(); };
    el.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFoco);
    return () => {
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFoco);
      if (antes && typeof antes.focus === 'function' && document.contains(antes)) antes.focus();
    };
  }, []);

  return ReactDOM.createPortal(html`
    <div class="ytpl-fundo" onMouseDown=${(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div class="ytpl" ref=${ref} role="dialog" aria-modal="true" aria-label=${rotulo} tabindex="-1">
        ${children}
      </div>
    </div>
  `, document.body);
}

export function PlaylistsModal({ onFechar, onAbrir, onTocar, aplicarPreset, podeTocar = true, videoAtual = null }) {
  const d = usePlaylists();
  const cats = pl.listarCategorias();
  const [sel, setSel] = useState(() => {
    // abre na playlist que está tocando, ou na última usada para salvar
    if (fila.plId && pl.obterPlaylist(fila.plId)) return fila.plId;
    return ultimaPl && pl.obterPlaylist(ultimaPl) ? ultimaPl : TODAS;
  });
  const [catFiltro, setCatFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState(null);       // chave do vídeo com o menu «⋯» aberto
  const [nomeNova, setNomeNova] = useState('');
  const [nomeCat, setNomeCat] = useState('');
  const [renomear, setRenomear] = useState(null);   // texto do nome em edição
  const [msg, setMsg] = useState(null);
  const arquivo = useRef(null);
  useFila(null);

  const playlist = sel === TODAS ? null : d.playlists.find((p) => p.id === sel) || null;
  useEffect(() => { if (sel !== TODAS && !playlist) setSel(TODAS); }, [sel, playlist]);

  const fazer = async (fn, ok) => {
    setMsg(null);
    try {
      const r = await fn();
      if (ok) setMsg({ ok: true, t: typeof ok === 'function' ? ok(r) : ok });
      return r;
    } catch (e) {
      setMsg({ ok: false, t: e.message });
      return undefined;
    }
  };

  // entradas: (playlist, item); em «Todas» um vídeo em duas playlists aparece duas vezes
  const entradas = useMemo(() => {
    const fonte = playlist ? [playlist] : d.playlists;
    const q = busca.trim().toLowerCase();
    const r = [];
    for (const p of fonte) {
      p.itens.forEach((it, i) => {
        if (catFiltro && it.categoria !== catFiltro) return;
        if (q && !(it.titulo.toLowerCase().includes(q) || it.canal.toLowerCase().includes(q))) return;
        r.push({ p, it, i });
      });
    }
    return r;
  }, [d, playlist, busca, catFiltro]);

  const filtrado = Boolean(busca.trim() || catFiltro);
  const total = d.playlists.reduce((n, p) => n + p.itens.length, 0);
  const contaCat = useMemo(() => {
    const m = new Map();
    for (const p of (playlist ? [playlist] : d.playlists)) for (const it of p.itens) m.set(it.categoria, (m.get(it.categoria) || 0) + 1);
    return m;
  }, [d, playlist]);

  const criar = async (e) => {
    e.preventDefault();
    const p = await fazer(() => pl.criarPlaylist(nomeNova), (r) => `Playlist «${r.nome}» criada.`);
    if (p) { setNomeNova(''); setSel(p.id); }
  };
  const criarCat = async (e) => {
    e.preventDefault();
    const c = await fazer(() => pl.criarCategoria(nomeCat), (r) => `Categoria «${r.nome}» criada.`);
    if (c) setNomeCat('');
  };
  const apagarCat = async (c) => {
    const n = d.playlists.reduce((k, p) => k + p.itens.filter((x) => x.categoria === c.id).length, 0);
    if (!(await confirmar(`Apagar a categoria «${c.nome}»?` + (n ? ` ${n} vídeo(s) passam para «Outros».` : ''), { titulo: 'Apagar categoria', ok: 'Apagar categoria', cancelar: 'Manter', perigo: true }))) return;
    if (catFiltro === c.id) setCatFiltro('');
    fazer(() => pl.apagarCategoria(c.id), `Categoria «${c.nome}» apagada.`);
  };
  const apagar = async () => {
    if (!playlist) return;
    if (!(await confirmar(`Apagar a playlist «${playlist.nome}» com ${playlist.itens.length} vídeo(s)?`, { titulo: 'Apagar playlist', ok: 'Apagar playlist', cancelar: 'Manter', perigo: true }))) return;
    if (fila.plId === playlist.id) fila.parar();
    fazer(() => pl.apagarPlaylist(playlist.id), `Playlist «${playlist.nome}» apagada.`);
    setSel(TODAS);
  };
  const salvarNome = async (e) => {
    e.preventDefault();
    const r = await fazer(() => pl.renomearPlaylist(playlist.id, renomear), 'Playlist renomeada.');
    if (r) setRenomear(null);
  };

  const exportar = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    baixarBlob(new Blob([pl.exportarJson()], { type: 'application/json' }), `iavision-playlists-${stamp}.json`);
    setMsg({ ok: true, t: `Exportadas ${d.playlists.length} playlist(s) com ${total} vídeo(s).` });
  };
  const importar = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { setMsg({ ok: false, t: 'Arquivo grande demais (máx. 5 MB).' }); return; }
    const t = await f.text();
    fazer(() => pl.importarJson(t), (r) => `Importado: ${r.playlists} playlist(s) nova(s), ${r.videos} vídeo(s), ${r.categorias} categoria(s).`);
  };

  const categoriaDe = (id) => pl.obterCategoria(id);

  return html`
    <${Modal} rotulo="Playlists do YouTube" onFechar=${onFechar}>
      <header class="ytpl-cab">
        <h2>Playlists <small>${d.playlists.length} · ${total} vídeo(s)</small></h2>
        <button class="yt-x ytpl-fechar" aria-label="Fechar" onClick=${onFechar}>×</button>
      </header>

      <div class="ytpl-corpo">
        <aside class="ytpl-lado">
          <nav class="ytpl-pls" aria-label="Playlists">
            <button class="ytpl-pl ${sel === TODAS ? 'on' : ''}" aria-current=${sel === TODAS ? 'true' : undefined}
                    onClick=${() => { setSel(TODAS); setRenomear(null); }}>
              <span>Todas</span><em>${total}</em>
            </button>
            ${d.playlists.map((p) => html`
              <button key=${p.id} class="ytpl-pl ${sel === p.id ? 'on' : ''}" aria-current=${sel === p.id ? 'true' : undefined}
                      onClick=${() => { setSel(p.id); setRenomear(null); }} title=${p.nome}>
                <span>${fila.ativa && fila.plId === p.id ? '▶ ' : ''}${p.nome}</span><em>${p.itens.length}</em>
              </button>
            `)}
          </nav>
          <form class="ytpl-form" onSubmit=${criar}>
            <input class="ytpl-txt" type="text" placeholder="Nova playlist" maxlength="80"
                   aria-label="Nome da nova playlist" value=${nomeNova} onInput=${(e) => setNomeNova(e.target.value)} />
            <button class="btn tiny" type="submit" disabled=${!nomeNova.trim()}>Criar</button>
          </form>

          <details class="ytpl-cats">
            <summary>Categorias <small>${cats.length}</small></summary>
            <p class="hint tight">O tipo de modelo ou análise a que o vídeo se destina. As suas podem ser apagadas.</p>
            <ul>
              ${cats.map((c) => html`
                <li key=${c.id}>
                  <span>${c.nome}${c.preset ? html` <small title="Preset do Pipeline">· ${c.preset}</small>` : ''}</span>
                  ${c.propria && html`<button class="ytpl-mini-x" aria-label=${'Apagar a categoria ' + c.nome}
                                              title="Apagar categoria" onClick=${() => apagarCat(c)}>×</button>`}
                </li>
              `)}
            </ul>
            <form class="ytpl-form" onSubmit=${criarCat}>
              <input class="ytpl-txt" type="text" placeholder="Nova categoria" maxlength="80"
                     aria-label="Nome da nova categoria" value=${nomeCat} onInput=${(e) => setNomeCat(e.target.value)} />
              <button class="btn tiny" type="submit" disabled=${!nomeCat.trim()}>Criar</button>
            </form>
          </details>

          <div class="ytpl-backup">
            <button class="btn tiny" onClick=${exportar} disabled=${!d.playlists.length}
                    title="Baixa um JSON com as playlists e categorias">Exportar JSON</button>
            <button class="btn tiny" onClick=${() => arquivo.current && arquivo.current.click()}
                    title="Mescla um JSON exportado (de outro aparelho ou backup)">Importar JSON</button>
            <input ref=${arquivo} type="file" accept="application/json,.json" hidden onChange=${importar} />
          </div>
        </aside>

        <section class="ytpl-main" aria-label="Vídeos">
          <div class="ytpl-main-cab">
            ${playlist && renomear != null ? html`
              <form class="ytpl-form ytpl-renomear" onSubmit=${salvarNome}>
                <input class="ytpl-txt" type="text" maxlength="80" aria-label="Novo nome da playlist" data-autofoco
                       value=${renomear} onInput=${(e) => setRenomear(e.target.value)}
                       onKeyDown=${(e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setRenomear(null); } }} />
                <button class="btn tiny accent" type="submit" disabled=${!renomear.trim()}>Salvar</button>
                <button class="btn tiny" type="button" onClick=${() => setRenomear(null)}>Cancelar</button>
              </form>
            ` : html`<h3>${playlist ? playlist.nome : 'Todas as playlists'}</h3>`}
            ${playlist && renomear == null && html`
              <div class="ytpl-acts">
                ${podeTocar && html`
                  <button class="btn tiny accent" disabled=${!playlist.itens.length}
                          onClick=${() => onTocar(playlist.id, 0)}>▶ Tocar playlist</button>
                  <button class="btn tiny ${fila.repetirLista ? 'on' : ''}" aria-pressed=${fila.repetirLista}
                          title="No fim do último vídeo, volta ao primeiro" onClick=${() => fila.alternarRepetir()}>
                    🔁 Repetir playlist</button>
                `}
                <button class="btn tiny" onClick=${() => setRenomear(playlist.nome)}>Renomear</button>
                <button class="btn tiny ytpl-perigo" onClick=${apagar}>Apagar</button>
              </div>
            `}
          </div>

          <div class="ytpl-filtros">
            <input class="ytpl-txt" type="search" placeholder="Buscar por título ou canal" maxlength="100"
                   aria-label="Buscar por título ou canal" value=${busca} onInput=${(e) => setBusca(e.target.value)} />
            <select aria-label="Filtrar por categoria" value=${catFiltro} onChange=${(e) => setCatFiltro(e.target.value)}>
              <option value="">Todas as categorias</option>
              ${cats.map((c) => html`<option key=${c.id} value=${c.id}>${c.nome} (${contaCat.get(c.id) || 0})</option>`)}
            </select>
          </div>

          ${msg && html`<div class=${'ytpl-msg ' + (msg.ok ? 'ok' : 'erro')} role=${msg.ok ? 'status' : 'alert'}>${msg.t}</div>`}

          ${d.playlists.length === 0 ? html`
            <p class="empty">Nenhuma playlist ainda. Crie uma ao lado, ou abra um vídeo no painel Fonte ›
              YouTube e use <b>☆ Salvar na playlist</b>.</p>
          ` : entradas.length === 0 ? html`
            <p class="empty">${filtrado ? 'Nenhum vídeo com esses filtros.' : 'Playlist vazia. Abra um vídeo e use ☆ Salvar na playlist.'}</p>
          ` : html`
            <ul class="ytpl-lista">
              ${entradas.map(({ p, it, i }) => {
                const k = p.id + '|' + it.id;
                const c = categoriaDe(it.categoria);
                const outras = d.playlists.filter((x) => x.id !== p.id);
                const tocando = videoAtual === it.id;
                return html`
                  <li key=${k} class="ytpl-v ${tocando ? 'atual' : ''}">
                    <div class="ytpl-v-lin">
                      <span class="yt-mini ytpl-mini">
                        <img src=${'/api/yt/miniatura/' + it.id} alt="" loading="lazy" />
                        ${it.duracao && html`<em>${fmtDur(it.duracao)}</em>`}
                      </span>
                      <div class="ytpl-v-txt">
                        <b title=${it.titulo}>${tocando ? '▶ ' : ''}${it.titulo}</b>
                        <small>
                          ${it.canal && html`<span>${it.canal}</span>`}
                          <span class="ytpl-chip">${c.nome}</span>
                          ${!playlist && html`<span class="ytpl-de">em ${p.nome}</span>`}
                        </small>
                      </div>
                      <div class="ytpl-v-acts">
                        <button class="btn tiny accent" onClick=${() => onAbrir(it)}
                                title="Carregar no player">Abrir</button>
                        ${playlist && html`
                          <button class="btn tiny" aria-label="Subir" title=${filtrado ? 'Limpe os filtros para reordenar' : 'Subir'}
                                  disabled=${filtrado || i === 0} onClick=${() => fazer(() => pl.reordenar(p.id, it.id, -1))}>↑</button>
                          <button class="btn tiny" aria-label="Descer" title=${filtrado ? 'Limpe os filtros para reordenar' : 'Descer'}
                                  disabled=${filtrado || i === p.itens.length - 1} onClick=${() => fazer(() => pl.reordenar(p.id, it.id, 1))}>↓</button>
                        `}
                        <button class="btn tiny" aria-expanded=${aberto === k} aria-label="Mais ações"
                                title="Categoria, mover, copiar, remover" onClick=${() => setAberto(aberto === k ? null : k)}>⋯</button>
                      </div>
                    </div>
                    ${aberto === k && html`
                      <div class="ytpl-v-mais">
                        <label>Categoria
                          <select value=${it.categoria}
                                  onChange=${(e) => fazer(() => pl.definirCategoria(p.id, it.id, e.target.value), 'Categoria trocada.')}>
                            ${cats.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome}</option>`)}
                          </select>
                        </label>
                        ${outras.length > 0 && html`
                          <label>Mover para
                            <select value="" onChange=${(e) => { const para = e.target.value; if (!para) return;
                              setAberto(null);
                              fazer(() => pl.moverVideo(p.id, para, it.id), `Movido para «${pl.obterPlaylist(para).nome}».`); }}>
                              <option value="">—</option>
                              ${outras.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome}</option>`)}
                            </select>
                          </label>
                          <label>Copiar para
                            <select value="" onChange=${(e) => { const para = e.target.value; if (!para) return;
                              fazer(() => pl.moverVideo(p.id, para, it.id, { copiar: true }), `Copiado para «${pl.obterPlaylist(para).nome}».`); }}>
                              <option value="">—</option>
                              ${outras.map((x) => html`<option key=${x.id} value=${x.id}>${x.nome}</option>`)}
                            </select>
                          </label>
                        `}
                        <div class="ytpl-v-mais-bt">
                          ${podeTocar && html`<button class="btn tiny" onClick=${() => onTocar(p.id, i)}
                                                       title="Toca a playlist a partir deste vídeo">▶ Tocar daqui</button>`}
                          ${c.preset && aplicarPreset && html`
                            <button class="btn tiny" title="Troca o Pipeline pelo preset do módulo"
                                    onClick=${() => setMsg(aplicarPreset(c.preset, c.painel)
                                      ? { ok: true, t: `Preset «${c.preset}» aplicado ao Pipeline.` }
                                      : { ok: false, t: `O preset «${c.preset}» não está disponível agora.` })}>
                              Aplicar preset «${c.preset}»</button>
                          `}
                          <a class="btn tiny" href=${'https://www.youtube.com/watch?v=' + it.id} target="_blank"
                             rel="noopener noreferrer">YouTube ↗</a>
                          <button class="btn tiny ytpl-perigo"
                                  onClick=${() => { setAberto(null); fazer(() => pl.removerVideo(p.id, it.id), `Removido de «${p.nome}».`); }}>
                            Remover</button>
                        </div>
                      </div>
                    `}
                  </li>
                `;
              })}
            </ul>
          `}
        </section>
      </div>
    <//>
  `;
}
