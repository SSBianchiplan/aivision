/**
 * components/YouTubeSource.js — seção «YouTube» do painel Fonte.
 *
 * Escolher o vídeo (colar link/ID ou buscar), tocar no player oficial,
 * usar como fonte (captura da própria aba recortada no player — ver
 * camera/youtube.js) e coletar quadros para o Treinar.
 *
 * A busca e as miniaturas vêm do serviço aivision-yt (/api/yt/*, só para
 * quem está logado). O vídeo nunca passa pelo servidor.
 */

import { confirmar } from './dialogo.js';
import { html, useState, useEffect, useRef } from '../vendor.js';
import { store } from '../state/store.js';
import {
  suporte, extrairId, ASPECTOS, QUALIDADES, rotuloReal, quadros, MAX_QUADROS, zipStore, baixarBlob,
} from '../camera/youtube.js';
import { SalvarNaPlaylist, PlaylistsModal, FilaBarra, usePlaylists } from './YouTubePlaylists.js';
import * as pl from '../youtube/playlists.js';
import { fila } from '../youtube/fila.js';
import { entrarPorSessao } from '../auth/treino.js';

const fmtDur = (s) => {
  if (s == null || !isFinite(s)) return '';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};

async function apiYt(caminho) {
  let r;
  try {
    r = await fetch('/api/yt' + caminho, { credentials: 'same-origin' });
  } catch (_) {
    throw new Error('Sem conexão com o servidor.');   // rede fora (TypeError do fetch)
  }
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { /* sem corpo ou HTML do proxy */ }
  if (!r.ok) {
    // só usa o detail do serviço quando é texto (o 422 do FastAPI traz uma lista)
    const detalhe = corpo && typeof corpo.detail === 'string' ? corpo.detail : '';
    const e = new Error(detalhe
      || (r.status >= 502 && r.status <= 504 ? 'Serviço de busca do YouTube indisponível agora.'
        : r.status === 401 ? 'Entre no iaVision para usar a busca do YouTube.'
          : 'A busca do YouTube falhou (erro ' + r.status + ').'));
    e.status = r.status;
    throw e;
  }
  return corpo;
}

/** Re-renderiza quando a fonte avisa (estado do player, erro, captura). */
function useYoutube(yt) {
  const [, set] = useState(0);
  useEffect(() => yt.ouvir(() => set((n) => n + 1)), [yt]);
  // tempo e velocidade do player não geram evento: um pulso leve enquanto há player
  useEffect(() => {
    const t = setInterval(() => { if (yt.carregado) set((n) => n + 1); }, 500);
    return () => clearInterval(t);
  }, [yt]);
}

function useQuadros() {
  const [lista, setLista] = useState(quadros.lista);
  useEffect(() => quadros.ouvir(setLista), []);
  return lista;
}

export function YouTubeSection({ youtube, ativo: tipoAtivo, onStart, onStop, aplicarPreset, semTitulo = false }) {
  const yt = youtube.current;
  useYoutube(yt);
  // sourceKind 'youtube' com a captura de pé (parar pela barra de vídeo deixa o tipo para trás)
  const ativo = tipoAtivo && yt.isRunning;
  const sup = useRef(null);
  if (!sup.current) sup.current = suporte();
  const { captura, assistir, motivo, janela, explica } = sup.current;

  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(null);
  const [info, setInfo] = useState(null);       // { id, titulo, canal }
  const [busy, setBusy] = useState(false);
  // playlists: caixa «Salvar», modal, aviso de salvo e oferta de preset do módulo
  const dadosPl = usePlaylists();
  const [salvando, setSalvando] = useState(false);
  const [modal, setModal] = useState(false);
  const [salvoMsg, setSalvoMsg] = useState(null);
  const [oferta, setOferta] = useState(null);   // categoria com preset, ao abrir um vídeo salvo

  const escolher = async (item, shorts) => {
    setErro(null);
    setInfo(item);
    setSalvando(false);
    setSalvoMsg(null);
    if (!assistir) return;                      // Safari/Firefox: só o link para o YouTube
    try {
      setBusy(true);
      await yt.carregar(item.id, { aspecto: shorts ? '9:16' : (item.aspecto || undefined) });
      // só assistir (celular): o painel Fonte cobre o player — fecha para o vídeo aparecer
      if (!captura && window.innerWidth < 760) {
        store.set({ panels: { ...store.get().panels, camera: false } });
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setBusy(false);
    }
  };

  const buscarOuAbrir = async (e) => {
    if (e) e.preventDefault();
    const t = texto.trim();
    if (!t) return;
    setErro(null);
    setOferta(null);
    const link = extrairId(t);
    let semVideo = false;
    // modo janela (Safari/Firefox): o window.open precisa do clique — abre ANTES de esperar o oEmbed
    if (link && janela && !link.solto) escolher({ id: link.id, titulo: link.id, canal: '' }, link.shorts);
    if (link) {
      // link ou ID: título/canal pelo oEmbed (falhar aqui não impede de tocar)
      let item = { id: link.id, titulo: link.id, canal: '' };
      try {
        item = await apiYt('/info?v=' + encodeURIComponent(link.id));
      } catch (err) {
        if (err.status === 404 || /incorporad|não encontrado/i.test(err.message)) {
          // texto solto que parecia id mas não é vídeo: vira busca
          if (link.solto && !/incorporad/i.test(err.message)) semVideo = true;
          else { setErro(err.message); return; }
        } else if (link.solto) {
          semVideo = true;                     // não deu para confirmar o id: busca em vez de tocar às cegas
        }
      }
      if (!semVideo) {
        setResultados(null);
        // modo janela: a janela já abriu no clique (ver abaixo); só atualiza título/canal
        if (janela && !link.solto && yt.videoId === link.id) setInfo(item);
        else escolher(item, link.shorts);
        return;
      }
    }
    setBuscando(true);
    try {
      setResultados(await apiYt('/busca?n=12&q=' + encodeURIComponent(t)));
    } catch (err) {
      setErro(err.message);
    } finally {
      setBuscando(false);
    }
  };

  /** Vídeo salvo aberto pelo modal: o mesmo fluxo de colar o link. */
  const abrirSalvo = (item) => {
    setModal(false);
    setResultados(null);
    const c = pl.obterCategoria(item.categoria);
    setOferta(c && c.preset && aplicarPreset ? c : null);
    if (fila.plId && fila.videoId !== item.id) fila.parar();   // abrir por fora encerra a sequência
    escolher(item);
  };
  const tocarPlaylist = (plId, indice) => {
    const item = fila.iniciar(plId, indice, { carregar: false });
    if (!item) return;
    setModal(false);
    setResultados(null);
    const c = pl.obterCategoria(item.categoria);
    setOferta(c && c.preset && aplicarPreset ? c : null);
    escolher(item);
  };

  const usar = async () => {
    setErro(null);
    setBusy(true);
    try { await onStart(); } catch (e) { setErro(e.message); } finally { setBusy(false); }
  };

  const carregado = yt.carregado;
  const tocando = yt.estado === 1;
  // o vídeo no player pode ter vindo da fila da playlist: título e canal do que foi salvo
  const salvoNoPlayer = yt.videoId && !(info && info.id === yt.videoId) ? pl.ondeEsta(yt.videoId)[0] : null;
  const atual = info && yt.videoId === info.id ? info
    : salvoNoPlayer ? salvoNoPlayer.item
      : (yt.videoId ? { id: yt.videoId, titulo: yt.titulo || yt.videoId, canal: '' } : info);
  const ondeSalvo = atual ? pl.ondeEsta(atual.id) : [];
  const totalSalvos = dadosPl.playlists.reduce((n, p) => n + p.itens.length, 0);
  // dados para salvar: duração e formato do player, se já se sabem
  const paraSalvar = atual && {
    id: atual.id, titulo: atual.titulo || yt.titulo || atual.id, canal: atual.canal || '',
    duracao: atual.duracao || (yt.videoId === atual.id && yt.duracao) || null,
    aspecto: yt.videoId === atual.id ? yt.aspecto : (atual.aspecto || null),
  };

  return html`
    <div class="yt-sec">
      <div class="ytpl-topo">
        ${!semTitulo && html`<div class="cfg-sub">YouTube</div>`}
        <button class="btn tiny" onClick=${() => setModal(true)} aria-haspopup="dialog"
                title="Vídeos salvos: playlists e categorias">☰ Playlists <b>${totalSalvos}</b></button>
      </div>

      ${!captura && html`
        <div class="notice yt-aviso" role="note">
          ${motivo}${assistir ? ' Aqui dá para assistir e escolher o vídeo.' : ''}
        </div>
      `}
      ${janela && html`<div class="notice yt-aviso yt-janela" role="note">${explica}</div>`}

      <form class="yt-busca" onSubmit=${buscarOuAbrir}>
        <input type="search" placeholder="Buscar ou colar link / ID do vídeo" maxlength="200"
               value=${texto} onInput=${(e) => setTexto(e.target.value)}
               aria-label="Buscar no YouTube ou colar link" />
        <button class="btn" type="submit" disabled=${buscando || !texto.trim()}>
          ${buscando ? '…' : (extrairId(texto) ? 'Abrir' : 'Buscar')}
        </button>
      </form>

      ${erro && html`<div class="notice">${erro}</div>`}
      ${yt.erro && html`<div class="notice">${yt.erro}</div>`}

      ${resultados && html`
        <ul class="yt-lista" aria-label="Resultados da busca">
          ${resultados.length === 0 && html`<li class="yt-vazio">Nada encontrado.</li>`}
          ${resultados.map((r) => html`
            <li key=${r.id}>
              <button class="yt-item ${atual && atual.id === r.id ? 'on' : ''}"
                      onClick=${() => { setOferta(null); escolher(r); }} title=${r.titulo}>
                <span class="yt-mini">
                  <img src=${'/api/yt/miniatura/' + r.id} alt="" loading="lazy" />
                  ${r.duracao != null && html`<em>${fmtDur(r.duracao)}</em>`}
                </span>
                <span class="yt-txt">
                  <b>${r.titulo}</b>
                  <small>${r.canal}</small>
                </span>
              </button>
            </li>
          `)}
        </ul>
      `}

      ${atual && html`
        <div class="yt-atual">
          <div class="yt-atual-tit">
            <b>${atual.titulo}</b>
            ${atual.canal && html`<small>${atual.canal}</small>`}
          </div>
          <div class="ytpl-atual-acts">
            <a class="yt-link" href=${'https://www.youtube.com/watch?v=' + atual.id}
               target="_blank" rel="noopener noreferrer">Abrir no YouTube ↗</a>
            <button class="btn tiny ${ondeSalvo.length ? 'ytpl-salvo' : ''}" aria-expanded=${salvando}
                    title=${ondeSalvo.length ? 'Salvo em: ' + ondeSalvo.map((x) => x.playlist.nome).join(', ') : 'Guardar este vídeo numa playlist'}
                    onClick=${() => { setSalvando(!salvando); setSalvoMsg(null); }}>
              ${ondeSalvo.length ? `★ Salvo (${ondeSalvo.length})` : '☆ Salvar na playlist'}
            </button>
          </div>
        </div>
      `}
      ${atual && salvando && html`
        <${SalvarNaPlaylist} key=${atual.id} video=${paraSalvar}
                             onFechar=${() => setSalvando(false)} onSalvo=${setSalvoMsg} />
      `}
      ${salvoMsg && html`
        <p class="hint tight ytpl-ok" role="status">${salvoMsg}
          <button class="ytpl-link" onClick=${() => setModal(true)}>Ver playlists</button></p>
      `}
      ${oferta && atual && html`
        <div class="ytpl-oferta" role="note">
          <span>Vídeo de <b>${oferta.nome}</b>.</span>
          <button class="btn tiny accent" onClick=${() => {
            const ok = aplicarPreset(oferta.preset, oferta.painel);
            setOferta(null);
            setSalvoMsg(ok ? `Preset «${oferta.preset}» aplicado ao Pipeline.` : `O preset «${oferta.preset}» não está disponível agora.`);
          }}>Aplicar preset «${oferta.preset}»</button>
          <button class="yt-x" aria-label="Dispensar" onClick=${() => setOferta(null)}>×</button>
        </div>
      `}
      <${FilaBarra} yt=${yt} />

      ${carregado && html`
        <div class="yt-ctl" role="group" aria-label="Controles do player">
          <button class="btn" title=${tocando ? 'Pausar o vídeo' : 'Tocar o vídeo'}
                  onClick=${() => {
                    if (tocando) yt.pause(); else yt.play();
                    // fonte ativa: pausado, o player desenha botões por cima — congela o pipeline como a barra de vídeo
                    if (ativo) store.set({ running: !tocando });
                  }}>${tocando ? '❚❚' : '▶'}</button>
          <button class="btn" title="Voltar 10 s" onClick=${() => yt.avancar(-10)}>−10s</button>
          <button class="btn" title="Avançar 10 s" onClick=${() => yt.avancar(10)}>+10s</button>
          <select title="Velocidade" value=${String(yt.taxa)}
                  onChange=${(e) => yt.velocidade(parseFloat(e.target.value))}>
            ${yt.velocidades.map((v) => html`<option key=${v} value=${String(v)}>${v}×</option>`)}
          </select>
          <button class="btn" title=${yt.mudo ? 'Ligar o som' : 'Silenciar'}
                  onClick=${() => yt.som(yt.mudo)}>${yt.mudo ? '🔇' : '🔊'}</button>
          <span class="yt-tempo">${fmtDur(yt.tempo)} / ${fmtDur(yt.duracao)}</span>
        </div>

        <label class="ctl">
          <span class="ctl-label">Formato do player</span>
          <select value=${yt.aspecto} disabled=${ativo}
                  onChange=${(e) => yt.setAspecto(e.target.value)}>
            ${Object.keys(ASPECTOS).map((a) => html`<option key=${a} value=${a}>${a}${a === '9:16' ? ' (Shorts)' : ''}</option>`)}
          </select>
        </label>

        ${captura && captura !== 'janela' && html`
          <label class="ctl">
            <span class="ctl-label">Qualidade<b>${rotuloReal(yt)}</b></span>
            <select value=${yt.qualidade} onChange=${(e) => yt.setQualidade(e.target.value)}>
              ${Object.entries(QUALIDADES).map(([k, q]) => html`<option key=${k} value=${k}>${q.rotulo}</option>`)}
            </select>
          </label>
          ${yt.avisoQualidade && html`<p class="hint tight" role="status">${yt.avisoQualidade}</p>`}
          <p class="hint tight">
            Quem decide a qualidade é o YouTube (e a sua conexão). Pedimos desenhando o player no
            tamanho da qualidade escolhida e capturando nesse tamanho. Acima de 720p o processamento
            e a captura ficam mais pesados; «Máxima» pede até 4K.
          </p>
        `}

        ${janela && !yt.janelaAberta && html`
          <div class="row">
            <button class="btn accent" onClick=${() => yt.abrirJanela()}
                    title="Abre o player oficial numa janela própria">Abrir a janela do player</button>
          </div>
        `}
        <div class="row">
          ${captura && html`
            <button class="btn ${ativo ? 'danger' : 'accent'}" disabled=${busy || (janela && !ativo && !yt.janelaAberta)}
                    title=${janela && !ativo ? 'O navegador pergunta o que compartilhar: escolha a janela «Player do YouTube — iaVision»' : ''}
                    onClick=${() => (ativo ? onStop() : usar())}>
              ${ativo ? 'Parar fonte YouTube' : busy ? 'Aguardando…' : janela ? 'Usar como fonte (compartilhar a janela)' : 'Usar como fonte'}
            </button>
          `}
          ${ativo && yt.modo === 'janela' && html`
            <button class="btn" onClick=${() => yt.ajustarRecorte()}
                    title="Marcar à mão o retângulo do vídeo na captura">Ajustar recorte</button>
          `}
          ${ativo && yt.modo === 'element' && html`
            <button class="btn" onClick=${() => yt.mostrarOriginal(!yt.original)}
                    title="O pipeline continua recebendo o quadro limpo nos dois casos">
              ${yt.original ? 'Ver processado' : 'Ver original'}
            </button>
          `}
          ${!ativo && html`<button class="btn" onClick=${() => { yt.fechar(); fila.parar(); setInfo(null); setOferta(null); setSalvando(false); }}>Fechar player</button>`}
        </div>
        <p class="hint tight">
          ${ativo && yt.modo === 'janela'
            ? html`Capturando a <b>janela do player</b>, recortada no vídeo
                   (${yt.recorte ? yt.recorte.rotulo : '…'}).
                   ${yt.recorte && !yt.recorte.confiavel ? html` <b>Confira o recorte</b> em «Ajustar recorte».` : ''}
                   Deixe a janela do player visível (pode ficar ao lado); se ela for coberta, a captura
                   mostra o que estiver por cima. Se o som não ligar, clique uma vez no vídeo da janela.`
            : ativo
            ? (yt.modo === 'element'
                ? html`Capturando só o <b>player</b> (Element Capture): o pipeline recebe o quadro
                       limpo, mesmo com o resultado processado e os painéis por cima.`
                : html`Modo <b>tela dividida</b> (Region Capture): o player fica à esquerda e o
                       processado à direita. Não arraste painéis para cima do player — eles
                       entrariam na captura.`)
            : captura === 'janela'
              ? html`O vídeo toca na janela <b>«Player do YouTube — iaVision»</b>. «Usar como fonte»
                     pede para compartilhar uma janela: escolha <b>essa</b>. Barra de título e faixas pretas
                     são cortadas sozinhas. A qualidade acompanha o tamanho da janela: aumente-a para o
                     YouTube subir a resolução. Nada é baixado: o vídeo toca no player oficial do YouTube.`
            : captura
              ? html`«Usar como fonte» pede para compartilhar <b>esta aba</b>; só o player é
                     capturado. Nada é baixado: o vídeo toca no player oficial do YouTube.`
              : html`Neste navegador o player serve só para assistir.`}
        </p>
      `}

      ${!assistir && atual && html`
        <p class="hint tight">Este navegador não embute o player do YouTube nesta página
          (isolamento entre origens). Use o link acima para assistir.</p>
      `}

      ${captura && html`<${Quadros} yt=${yt} ativo=${ativo} />`}

      ${modal && html`
        <${PlaylistsModal} onFechar=${() => setModal(false)} onAbrir=${abrirSalvo} onTocar=${tocarPlaylist}
                           aplicarPreset=${aplicarPreset} podeTocar=${assistir} videoAtual=${yt.videoId} />
      `}
    </div>
  `;
}

// =============================================================== quadros

function Quadros({ yt, ativo }) {
  const lista = useQuadros();
  const [intervalo, setIntervalo] = useState(2);
  const [limite, setLimite] = useState(30);
  const [auto, setAuto] = useState(false);
  const [msg, setMsg] = useState(null);
  const [enviar, setEnviar] = useState(false);
  const autoRef = useRef({ feitos: 0 });

  const capturar = async () => {
    // fim do vídeo (tela final do YouTube), carregando, pausado ou logo depois de tocar/pular:
    // o player desenha a própria interface por cima e o quadro não seria só do vídeo
    if (yt.estado === 0) { setMsg('O vídeo terminou. Volte um pouco (−10s) e toque antes de capturar.'); return false; }
    if (yt.estado === 3 || yt.estado === -1 || yt.estado === 5) {
      setMsg('O vídeo ainda está carregando. Tente de novo em um instante.');
      return false;
    }
    if (yt.estado === 2) { setMsg('Toque o vídeo para capturar: pausado, o YouTube desenha os botões por cima da imagem.'); return false; }
    if (!yt.limpo) { setMsg('O YouTube mostra título e botões por alguns segundos depois de tocar ou pular. Tente de novo em instantes.'); return false; }
    const q = await yt.quadroJpeg();
    if (!q) { setMsg('A fonte YouTube ainda não entregou quadro.'); return false; }
    if (!quadros.adicionar(q)) { setMsg(`Limite de ${MAX_QUADROS} quadros. Remova alguns ou baixe o ZIP.`); return false; }
    setMsg(null);
    return true;
  };

  // captura automática: a cada N s, até o limite; para sozinha se a fonte cair
  useEffect(() => {
    if (!auto) return;
    if (!ativo) { setAuto(false); return; }
    autoRef.current.feitos = 0;
    const passo = async () => {
      if (!yt.limpo) return;                    // pausado, carregando ou com a interface do YouTube na tela
      const ok = await capturar();
      if (!ok || ++autoRef.current.feitos >= limite) setAuto(false);
    };
    passo();
    const t = setInterval(passo, Math.max(0.5, intervalo) * 1000);
    return () => clearInterval(t);
  }, [auto, ativo, intervalo, limite]);

  const baixarZip = async () => {
    if (!lista.length) return;
    const z = await zipStore(lista.map((q) => ({ nome: q.nome, blob: q.blob })));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    baixarBlob(z, `iavision-youtube-quadros-${stamp}.zip`);
  };

  return html`
    <div class="yt-quadros">
      <div class="cfg-sub">Quadros para treinar <b>${lista.length}</b></div>
      <div class="row">
        <button class="btn" disabled=${!ativo} onClick=${capturar}
                title="Quadro limpo da fonte, sem caixas nem overlay">Capturar quadro</button>
        <button class="btn ${auto ? 'danger' : ''}" disabled=${!ativo && !auto}
                onClick=${() => setAuto(!auto)}>
          ${auto ? `Parar (${autoRef.current.feitos}/${limite})` : 'Capturar a cada N s'}
        </button>
      </div>
      <div class="yt-auto">
        <label>a cada <input type="number" min="0.5" max="60" step="0.5" value=${intervalo}
               disabled=${auto} onInput=${(e) => setIntervalo(parseFloat(e.target.value) || 2)} /> s</label>
        <label>até <input type="number" min="1" max=${MAX_QUADROS} step="1" value=${limite}
               disabled=${auto} onInput=${(e) => setLimite(Math.min(MAX_QUADROS, parseInt(e.target.value, 10) || 30))} /> quadros</label>
      </div>
      ${!ativo && html`<p class="hint tight">Use o vídeo como fonte para capturar quadros.</p>`}
      ${msg && html`<div class="notice">${msg}</div>`}

      ${lista.length > 0 && html`
        <div class="yt-grade">
          ${lista.map((q) => html`
            <figure key=${q.id} title=${q.nome + ' · ' + q.w + '×' + q.h}>
              <img src=${q.url} alt=${'Quadro em ' + fmtDur(q.t)} />
              <figcaption>${fmtDur(q.t)}</figcaption>
              <button class="yt-x" aria-label="Remover quadro" onClick=${() => quadros.remover(q.id)}>×</button>
            </figure>
          `)}
        </div>
        <div class="row">
          <button class="btn" onClick=${baixarZip} title="ZIP com os JPEGs dos quadros">Baixar ZIP</button>
          <button class="btn accent" onClick=${() => setEnviar(!enviar)}>Enviar ao Treinar</button>
          <button class="btn" onClick=${async () => { if (await confirmar('Descartar os ' + lista.length + ' quadros?', { titulo: 'Descartar quadros', ok: 'Descartar', cancelar: 'Manter', perigo: true })) quadros.limpar(); }}>Limpar</button>
        </div>
      `}
      ${enviar && lista.length > 0 && html`<${EnviarTreino} lista=${lista} onFechar=${() => setEnviar(false)} />`}
    </div>
  `;
}

// =============================================================== Treinar

const TOKEN_KEY = 'aivTreinoYT';

function lerToken() {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}
function gravarToken(t) {
  try { if (t) sessionStorage.setItem(TOKEN_KEY, t); else sessionStorage.removeItem(TOKEN_KEY); } catch (_) { /* bloqueado */ }
}

async function apiTreino(caminho, token, opt = {}) {
  const headers = { ...(opt.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (opt.body && !(opt.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api/treino' + caminho, { ...opt, headers });
  let corpo = null;
  try { corpo = await r.json(); } catch (_) { /* sem corpo */ }
  if (!r.ok) {
    const e = new Error((corpo && corpo.detail) || ('Erro ' + r.status));
    e.status = r.status;
    throw e;
  }
  return corpo;
}

function EnviarTreino({ lista, onFechar }) {
  const [token, setToken] = useState(lerToken);
  const [senha, setSenha] = useState('');
  const [projetos, setProjetos] = useState(null);
  const [pid, setPid] = useState('');
  const [grupo, setGrupo] = useState('boa');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const sair = (m) => { gravarToken(''); setToken(''); setProjetos(null); setMsg(m || null); };

  // sem token: tenta a conta do iaVision (SSO de admin, decidido no servidor) antes de pedir a senha
  const [sso, setSso] = useState(!token);
  useEffect(() => {
    if (token) { setSso(false); return; }
    let vivo = true;
    entrarPorSessao().then((r) => {
      if (!vivo) return;
      setSso(false);
      if (r) { gravarToken(r.token); setToken(r.token); setMsg(`Entrou como ${r.email} · admin`); }
    });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    apiTreino('/projetos', token).then((ps) => {
      if (!vivo) return;
      setProjetos(ps || []);
      if (ps && ps.length && !ps.some((p) => p.id === pid)) setPid(ps[0].id);
    }).catch((e) => { if (vivo) (e.status === 401 ? sair('Sessão do Treinar expirou. Entre de novo.') : setMsg(e.message)); });
    return () => { vivo = false; };
  }, [token]);

  const entrar = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiTreino('/entrar', '', { method: 'POST', body: JSON.stringify({ senha }) });
      gravarToken(r.token);
      setToken(r.token);
      setSenha('');
    } catch (err) {
      setMsg(err.status === 401 ? 'Senha incorreta.' : err.message);
    } finally {
      setBusy(false);
    }
  };

  const proj = projetos && projetos.find((p) => p.id === pid);
  const anomalia = proj && proj.tipo === 'anomalia';

  const enviarTudo = async () => {
    if (!proj) return;
    setBusy(true);
    setMsg(null);
    let ok = 0;
    const erros = [];
    try {
      // lotes de 8, como a página do Treinar
      for (let i = 0; i < lista.length; i += 8) {
        const fd = new FormData();
        for (const q of lista.slice(i, i + 8)) fd.append('arquivos', new File([q.blob], q.nome, { type: 'image/jpeg' }));
        // origem de cada quadro (serviço de treino 2.2+; o antigo ignora o campo): «YouTube <id> @ mm:ss»
        fd.append('meta', JSON.stringify(lista.slice(i, i + 8).map((q) => ({ fonte: 'youtube', video: q.videoId, t: q.t }))));
        setMsg(`Enviando ${Math.min(i + 8, lista.length)} de ${lista.length}…`);
        const r = await apiTreino(`/projetos/${encodeURIComponent(proj.id)}/imagens` + (anomalia ? '?grupo=' + grupo : ''),
                                  token, { method: 'POST', body: fd });
        ok += (r && r.enviadas ? r.enviadas.length : 0);
        if (r && r.erros) erros.push(...r.erros);
      }
      setMsg(`${ok} quadro(s) enviados para «${proj.nome}»` +
             (anomalia ? ` como ${grupo === 'boa' ? 'BOAS' : 'RUINS'}` : '') +
             (erros.length ? `. Erros: ${erros.slice(0, 3).join('; ')}` : '.') +
             (!anomalia ? ' Rotule as caixas no Treinar.' : ''));
    } catch (err) {
      if (err.status === 401) sair('Sessão do Treinar expirou. Entre de novo.');
      else setMsg(`Falhou depois de ${ok} enviados: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="yt-treino">
      <div class="yt-treino-cab">
        <b>Enviar ${lista.length} quadro(s) ao Treinar</b>
        <button class="yt-x" aria-label="Fechar" onClick=${onFechar}>×</button>
      </div>
      ${!token && sso ? html`<p class="hint tight">Conferindo a sua conta…</p>`
        : !token ? html`
        <form class="yt-busca" onSubmit=${entrar}>
          <input type="password" placeholder="Senha do Treinar" value=${senha}
                 autocomplete="current-password" aria-label="Senha do Treinar"
                 onInput=${(e) => setSenha(e.target.value)} />
          <button class="btn accent" type="submit" disabled=${busy || !senha}>Entrar</button>
        </form>
      ` : !projetos ? html`<p class="hint tight">Carregando projetos…</p>`
        : projetos.length === 0 ? html`<p class="hint tight">Nenhum projeto. Crie um no menu <b>Treinar</b>.</p>`
        : html`
          <label class="ctl">
            <span class="ctl-label">Projeto</span>
            <select value=${pid} onChange=${(e) => setPid(e.target.value)}>
              ${projetos.map((p) => html`<option key=${p.id} value=${p.id}>${p.nome} — ${p.tipo === 'anomalia' ? 'anomalia' : 'detector'}</option>`)}
            </select>
          </label>
          ${anomalia && html`
            <div class="yt-grupo" role="radiogroup" aria-label="Grupo">
              <label><input type="radio" name="yt-grupo" checked=${grupo === 'boa'} onChange=${() => setGrupo('boa')} /> peças boas</label>
              <label><input type="radio" name="yt-grupo" checked=${grupo === 'ruim'} onChange=${() => setGrupo('ruim')} /> peças ruins</label>
            </div>
          `}
          <div class="row">
            <button class="btn accent" disabled=${busy || !proj} onClick=${enviarTudo}>
              ${busy ? 'Enviando…' : 'Enviar'}
            </button>
            <button class="btn" disabled=${busy} onClick=${() => sair()}>Sair do Treinar</button>
          </div>
        `}
      ${msg && html`<p class="hint tight yt-msg" role="status">${msg}</p>`}
    </div>
  `;
}
