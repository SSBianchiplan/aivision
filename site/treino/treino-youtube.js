/* iaVision · Treinar › «Do YouTube»: quadros de um vídeo do YouTube direto para o projeto.
   Mesmo mecanismo da fonte YouTube do app (js/camera/youtube-nucleo.js): o vídeo toca no player OFICIAL
   (IFrame API, youtube-nocookie, iframe credentialless) e o navegador captura a PRÓPRIA ABA, recortada no
   elemento do player (Element Capture; Region Capture como reserva). Nada é baixado do YouTube — nem pelo
   servidor (a vps2 é bloqueada pelo YouTube) nem pelo navegador: os quadros são fotos da tela, tiradas aqui.
   Busca, título/canal (oEmbed) e miniaturas vêm do serviço aivision-yt (/api/yt/*, sessão do iaVision).
   Safari/Firefox (sem iframe credentialless): o player toca numa JANELA PRÓPRIA (/yt/player.html, sem
   isolamento), comandada por BroadcastChannel com a mesma interface do YT.Player (PlayerJanela), e a
   captura é da janela, recortada no vídeo (Recortador; «Ajustar recorte» à mão) — js/camera/youtube-janela.js.
   Script clássico (como treino.js), carregado depois dele: usa $, h, S, api, toast, enviarItens, projAtual. */
'use strict';
const Y = {
  N: null, raiz: null, host: null, player: null, id: '', info: null, estado: -1, mudouEm: 0,
  stream: null, video: null, ini: 0, fim: 0, auto: null, timer: null, ocupado: false, envio: Promise.resolve(),
  tira: [], el: {}, enviados: 0, repetidos: 0, falhas: 0, rec: null, modo: null,
};
/** Modo janela (Safari/Firefox): player em janela própria. Síncrono depois que o núcleo carregou (abaYouTube). */
const ytJanela = () => Boolean(Y.N && Y.N.suporte().janela);
const ytNucleo = async () => (Y.N || (Y.N = await import('/js/camera/youtube-nucleo.js')));
const mmss = (s) => { s = Math.max(0, Math.floor(s || 0)); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (hh ? hh + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(x).padStart(2, '0'); };
/** «1:23», «83», «1:02:03» → segundos (NaN se não der). */
const lerTempo = (t) => { t = String(t || '').trim(); if (!t) return NaN; if (/^\d+(\.\d+)?$/.test(t)) return +t; if (!/^\d+(:\d{1,2}){1,2}$/.test(t)) return NaN; return t.split(':').reduce((a, v) => a * 60 + +v, 0); };
const ytCmd = (nome, ...a) => { const p = Y.player; if (!p || typeof p[nome] !== 'function') return undefined; try { return p[nome](...a); } catch (_) { return undefined; } };
const ytTempo = () => ytCmd('getCurrentTime') || 0;
const ytDur = () => ytCmd('getDuration') || 0;
/** Tocando há mais de 5 s desde a última mudança: o quadro não tem a interface do YouTube. */
const ytLimpo = () => Y.estado === 1 && performance.now() - Y.mudouEm > (Y.N ? Y.N.JANELA_UI_MS : 5000);

async function apiYt(caminho) {
  let r; try { r = await fetch('/api/yt' + caminho, { credentials: 'same-origin' }); } catch (_) { throw new Error('Sem conexão com o servidor.'); }
  let b = null; try { b = await r.json(); } catch (_) { /* sem corpo */ }
  if (!r.ok) {
    const e = new Error(b && typeof b.detail === 'string' ? b.detail : r.status === 401 ? 'Para BUSCAR, entre no iaVision neste navegador. Colar o link do vídeo funciona sem entrar.' : r.status >= 502 ? 'Serviço de busca do YouTube indisponível agora.' : 'A busca do YouTube falhou (erro ' + r.status + ').');
    e.status = r.status; throw e;
  }
  return b;
}
function ytMsg(t, tipo) { const e = Y.el.msg; if (!e) return; e.textContent = t || ''; e.className = 'ytt-st' + (tipo ? ' ' + tipo : ''); }

// ------------------------------------------------------------------ montagem (uma vez; a aba só mostra/esconde)
function montarYouTube() {
  const E = Y.el;
  E.q = h('input', { type: 'text', placeholder: 'Cole o link do vídeo (youtube.com/watch?v=…, youtu.be/…) ou digite para buscar', 'aria-label': 'Link ou busca no YouTube', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarOuAbrir(); } } });
  E.res = h('div', { class: 'ytt-res' });
  Y.host = h('div', { class: 'ytt-host vazio' }, 'Cole um link ou busque um vídeo. Ele toca aqui, no player oficial do YouTube.');
  E.info = h('div', { class: 'ytt-info small' });
  E.play = h('button', { class: 'btn sm', title: 'Tocar / pausar', onclick: () => (Y.estado === 1 ? ytCmd('pauseVideo') : ytCmd('playVideo')) }, '▶');
  E.seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Posição do vídeo', oninput: () => { E.arrastando = true; }, onchange: () => { E.arrastando = false; pular(E.seek.value / 1000 * ytDur()); } });
  E.tempo = h('span', { class: 'ytt-t' }, '00:00 / 00:00');
  const ctl = h('div', { class: 'ytt-ctl' }, E.play,
    h('button', { class: 'btn sm', onclick: () => pular(ytTempo() - 10) }, '−10 s'), h('button', { class: 'btn sm', onclick: () => pular(ytTempo() + 10) }, '+10 s'), E.seek, E.tempo);

  // 1 · captura da aba
  E.cap = h('button', { class: 'btn pri', onclick: () => (Y.stream ? pararCaptura() : comecarCaptura()) }, 'Compartilhar esta aba');
  E.ajuste = h('button', { class: 'btn', hidden: true, title: 'Marcar à mão o retângulo do vídeo na captura', onclick: async () => { if (Y.rec) { await Y.N.ajustarRecorte(Y.rec); estadoCaptura(); } } }, 'Ajustar recorte');
  E.capDica = h('div', { class: 'small mut' }, 'O navegador mostra “Compartilhar esta aba?”. Aceite: a captura fica só neste player e para quando você sair desta aba do Treinar ou clicar em Parar. Deixe o player inteiro visível na tela.');
  E.capSt = h('div', { class: 'ytt-st' }, '');
  // 2 · trecho
  E.ini = h('input', { type: 'text', value: '00:00', inputmode: 'numeric', 'aria-label': 'Início do trecho (mm:ss)', onchange: () => lerTrecho() });
  E.fim = h('input', { type: 'text', value: '', placeholder: 'fim', inputmode: 'numeric', 'aria-label': 'Fim do trecho (mm:ss)', onchange: () => lerTrecho() });
  // 3 · quadros
  E.um = h('button', { class: 'btn pri', onclick: () => capturarUm(false) }, '📸 Capturar quadro');
  E.n = h('input', { type: 'number', min: 0.5, max: 60, step: 0.5, value: 2, 'aria-label': 'Intervalo em segundos de vídeo' });
  E.m = h('input', { type: 'number', min: 1, max: 300, value: 30, 'aria-label': 'Máximo de quadros' });
  E.auto = h('button', { class: 'btn', onclick: () => (Y.auto ? pararAuto('Parado.') : iniciarAuto()) }, '⏱ Capturar no trecho');
  E.grupo = h('div', { class: 'seg', style: 'margin:6px 0 0' });
  E.msg = h('div', { class: 'ytt-st' });
  E.cont = h('div', { class: 'small mut' });
  E.tira = h('div', { class: 'ytt-tira' });
  E.proj = h('b', {});

  E.dicaTopo = h('div', { class: 'dica small' }, 'Quadros de vídeos do YouTube como imagens do projeto. O vídeo toca no ', h('b', {}, 'player oficial'), ' aqui na página; para tirar os quadros, o navegador pede para ', h('b', {}, 'compartilhar esta aba'), ' (escolha «esta aba») e recorta só o player. ', h('b', {}, 'Nada é baixado do YouTube'), ': cada quadro é uma foto da tela, feita no seu navegador, e vai direto para o projeto com a origem “YouTube <id> @ mm:ss”, o título e o canal.');
  Y.raiz = h('div', {},
    E.dicaTopo,
    h('div', { class: 'ytt' },
      h('div', {},
        h('div', { class: 'ytt-busca' }, E.q, h('button', { class: 'btn pri', onclick: buscarOuAbrir }, 'Abrir / buscar')),
        E.res, Y.host, E.info, ctl),
      h('div', { class: 'ytt-lado' },
        h('div', { class: 'ytt-card' }, h('h4', {}, '1 · Permitir a captura'),
          E.capDica,
          h('div', { class: 'ytt-lin' }, E.cap, E.ajuste), E.capSt),
        h('div', { class: 'ytt-card' }, h('h4', {}, '2 · Trecho (opcional)'),
          h('div', { class: 'ytt-lin' }, h('label', {}, 'início', E.ini), h('button', { class: 'btn sm', onclick: () => { E.ini.value = mmss(ytTempo()); lerTrecho(); } }, '← agora'),
            h('label', {}, 'fim', E.fim), h('button', { class: 'btn sm', onclick: () => { E.fim.value = mmss(ytTempo()); lerTrecho(); } }, '← agora')),
          h('div', { class: 'small mut' }, 'Vazio = até o fim do vídeo. “Capturar no trecho” começa um pouco antes do início, porque o YouTube mostra título e botões por ~5 s depois de pular.')),
        h('div', { class: 'ytt-card' }, h('h4', {}, '3 · Quadros para ', E.proj),
          h('div', { class: 'ytt-lin' }, E.um),
          h('div', { class: 'ytt-lin' }, h('label', {}, 'a cada', E.n, 's de vídeo'), h('label', {}, 'até', E.m, 'quadros'), E.auto),
          E.grupo, E.msg, E.cont, E.tira),
        h('div', { class: 'aviso small' }, 'Direitos: os quadros pertencem ao dono do vídeo. Para uso comercial do modelo, prefira vídeos seus ou com permissão. A origem de cada quadro sai em “Origens” (aba Imagens).'),
        h('div', { class: 'small mut', id: 'ytSuporte' }))));
  setInterval(atualizarPlayer, 400);
}

function atualizarPlayer() {
  const E = Y.el; if (!E.tempo || !Y.player) return;
  const t = ytTempo(), d = ytDur();
  E.tempo.textContent = `${mmss(t)} / ${mmss(d)}`;
  if (!E.arrastando && d) E.seek.value = Math.round(t / d * 1000);
  E.play.textContent = Y.estado === 1 ? '⏸' : '▶';
  // modo janela: a pessoa pode fechar a janela do player a qualquer hora — o cartão acompanha
  if (Y.player.janela && !Y.stream) { const a = Boolean(Y.player.aberta || Y.player.esperando); if (a !== Y.jaAberta) { Y.jaAberta = a; mostrarJanela(); } }
  if (Y.player && !Y.info.titulo) { const v = ytCmd('getVideoData'); if (v && v.title) { Y.info.titulo = v.title; Y.info.canal = Y.info.canal || v.author || ''; mostrarInfo(); } }
}
function pular(s) { const d = ytDur(); ytCmd('seekTo', Math.max(0, d ? Math.min(d - 0.5, s) : s), true); Y.mudouEm = performance.now(); }
function lerTrecho() {
  const a = lerTempo(Y.el.ini.value), b = lerTempo(Y.el.fim.value);
  Y.ini = isNaN(a) ? 0 : a; Y.fim = isNaN(b) ? 0 : b;
  if (Y.fim && Y.fim <= Y.ini) { ytMsg('O fim precisa vir depois do início.', 'no'); Y.fim = 0; } else ytMsg('');
}
function mostrarInfo() {
  const i = Y.info || {};
  Y.el.info.replaceChildren(h('b', {}, i.titulo || Y.id), h('span', { class: 'mut' }, (i.canal ? i.canal + ' · ' : '') + 'YouTube ' + Y.id));
}

// ------------------------------------------------------------------ abrir / buscar
async function buscarOuAbrir() {
  const N = Y.N || await ytNucleo(); const t = Y.el.q.value.trim(); if (!t) return;
  const link = N.extrairId(t);
  if (link) { abrirVideo(link.id); return; }
  if (t.length < 2) return;
  Y.el.res.replaceChildren(h('div', { class: 'mut small' }, 'Buscando…'));
  try {
    const lst = await apiYt('/busca?n=12&q=' + encodeURIComponent(t));
    Y.el.res.replaceChildren(...(lst.length ? lst.map((r) => h('button', { type: 'button', title: r.titulo, onclick: () => { Y.el.res.replaceChildren(); abrirVideo(r.id, r); } },
      h('img', { src: '/api/yt/miniatura/' + r.id, alt: '', loading: 'lazy' }), h('b', {}, r.titulo), h('span', {}, [r.canal, r.duracao ? mmss(r.duracao) : ''].filter(Boolean).join(' · '))))
      : [h('div', { class: 'mut small' }, 'Nada encontrado.')]));
  } catch (e) { Y.el.res.replaceChildren(h('div', { class: 'err small' }, e.message)); }
}

async function abrirVideo(id, info, tentativa = 0) {
  // sem await quando o núcleo já carregou: no Safari o window.open (modo janela) precisa do clique
  const N = Y.N || await ytNucleo();
  pararAuto(); Y.el.res.replaceChildren(); Y.id = id; Y.info = { titulo: (info && info.titulo) || '', canal: (info && info.canal) || '' };
  mostrarInfo(); ytMsg('');
  if (!info) apiYt('/info?v=' + id).then((r) => { if (Y.id === id) { Y.info = { titulo: r.titulo || Y.info.titulo, canal: r.canal || Y.info.canal }; mostrarInfo(); } })
    .catch((e) => { if (e.status === 404) ytMsg(e.message, 'no'); });
  if (N.suporte().janela) { abrirNaJanela(N, id, info); return; }
  let YT;
  try { YT = await N.carregarApi(); } catch (e) { ytMsg(e.message, 'no'); return; }
  if (Y.player) { try { Y.player.destroy(); } catch (_) { /* já destruído */ } }
  Y.player = null; Y.estado = -1;
  clearTimeout(Y.vigia);
  const ifr = N.criarIframe(id, { controles: !N.suporte().captura, host: N.HOSTS_PLAYER[tentativa % N.HOSTS_PLAYER.length] });
  // o YouTube às vezes recusa a reprodução sem avisar: sem começar em ~12 s, tenta pelo outro domínio (2 vezes)
  const recusou = (motivo) => {
    if (Y.id !== id) return;
    clearTimeout(Y.vigia);
    if (tentativa < 2) { ytMsg('O YouTube não começou a tocar; tentando de novo' + (motivo ? ' (' + motivo + ')' : '') + '…'); abrirVideo(id, info, tentativa + 1); return; }
    ytMsg('O YouTube recusou tocar este vídeo agora. Tente de novo em instantes (ou outro vídeo); às vezes é verificação do YouTube para players incorporados.', 'no');
    if (Y.el.msg) Y.el.msg.append(' ', h('button', { type: 'button', class: 'btn', onclick: () => abrirVideo(id, info, 0) }, 'Tentar de novo'),
      ' ', h('a', { href: 'https://www.youtube.com/watch?v=' + id, target: '_blank', rel: 'noopener' }, 'Abrir no YouTube ↗'));
  };
  Y.host.classList.remove('vazio'); Y.host.replaceChildren(ifr);
  Y.player = new YT.Player(ifr, { events: {
    onReady: () => { N.semLegenda(Y.player); ytCmd('playVideo'); Y.vigia = setTimeout(() => { if (Y.id === id && ![1, 2, 3].includes(Y.estado)) recusou(); }, N.ESPERA_INICIO_MS); },
    onStateChange: (e) => { Y.estado = e.data; Y.mudouEm = performance.now(); if (e.data === 1) { clearTimeout(Y.vigia); ytMsg(''); } if (e.data === 1) N.semLegenda(Y.player); if (e.data === 0 && Y.auto) pararAuto('O vídeo terminou.'); },
    onError: (e) => { if (N.ERROS_DEFINITIVOS.has(e.data)) { clearTimeout(Y.vigia); ytMsg(N.ERROS_PLAYER[e.data], 'no'); } else recusou('código ' + e.data); },
  } });
}

// ------------------------------------------------------------------ modo janela (Safari/Firefox)
/** O vídeo toca na janela «Player do YouTube — iaVision»; aqui fica o aviso (e, capturando, a prévia do recorte). */
function abrirNaJanela(N, id, info) {
  const eventos = {
    onStateChange: (e) => { Y.estado = e.data; Y.mudouEm = performance.now(); if (e.data === 1) ytMsg(''); if (e.data === 0 && Y.auto) pararAuto('O vídeo terminou.'); },
    onError: (e) => { ytMsg(N.ERROS_PLAYER[e.data] || e.texto || 'O player do YouTube falhou.', 'no'); },
  };
  Y.estado = -1; Y.mudouEm = performance.now();
  if (Y.player && Y.player.janela) Y.player.loadVideoById(id);      // reaproveita (ou reabre) a janela
  else {
    if (Y.player) { try { Y.player.destroy(); } catch (_) { /* já destruído */ } }
    Y.player = new N.PlayerJanela(id, { events: eventos });
  }
  mostrarJanela();
  Y.player.pronta().then(() => mostrarJanela(), (e) => { ytMsg(e.message, 'no'); mostrarJanela(); });
}
function mostrarJanela() {
  if (!ytJanela()) return;
  const aberta = Y.player && (Y.player.aberta || Y.player.esperando);
  Y.host.classList.remove('vazio'); Y.host.classList.add('janela');
  if (Y.stream && Y.video) { if (!Y.host.contains(Y.video)) Y.host.replaceChildren(Y.video); return; }
  Y.host.replaceChildren(h('div', { class: 'ytt-janela' },
    h('b', {}, aberta ? 'O vídeo toca na janela «' + Y.N.TITULO_JANELA + '».' : 'A janela do player está fechada.'),
    h('span', {}, 'Neste navegador o player do YouTube não pode ficar dentro desta página (isolamento entre origens), então ele abre numa janela própria. Comande por aqui (▶, ±10 s, linha do tempo) e, para tirar quadros, compartilhe essa janela no passo 1. Nada é baixado do YouTube.'),
    Y.player && !aberta ? h('button', { class: 'btn pri', onclick: () => { Y.player.abrir(); Y.player.pronta().then(mostrarJanela, (e) => ytMsg(e.message, 'no')); setTimeout(mostrarJanela, 300); } }, 'Abrir a janela do player') : ''));
}

// ------------------------------------------------------------------ captura da aba
async function comecarCaptura() {
  // sem await antes do getDisplayMedia: o Safari exige o clique
  const N = Y.N || await ytNucleo(); const sup = N.suporte();
  if (!sup.captura) { Y.el.capSt.textContent = sup.motivo; Y.el.capSt.className = 'ytt-st no'; return; }
  if (!Y.player) { ytMsg('Abra um vídeo antes de compartilhar a aba.', 'no'); return; }
  if (sup.captura === 'janela') { comecarCapturaJanela(N); return; }
  Y.el.cap.disabled = true;
  Y.host.scrollIntoView({ block: 'center' });   // a captura só vê o que está na tela
  try {
    // o tamanho pedido fixa a escala da captura: player de ~800 px rende quadros de até 1920×1080
    const s = await N.capturarAba(Y.host, sup.captura, { frameRate: { ideal: 30, max: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } });
    Y.stream = s; Y.modo = sup.captura;
    Y.video = Y.video || Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    Y.video.srcObject = s; Y.video.play().catch(() => {});
    s.getVideoTracks()[0].addEventListener('ended', () => pararCaptura());
  } catch (e) { Y.el.capSt.textContent = e.message; Y.el.capSt.className = 'ytt-st no'; }
  finally { Y.el.cap.disabled = false; estadoCaptura(); }
}
/** Modo janela: compartilhar a janela do player; o Recortador tira barra de título e faixas pretas. */
async function comecarCapturaJanela(N) {
  Y.el.cap.disabled = true;
  let rec = null;
  try {
    const bruto = await N.capturarJanela();
    Y.el.capSt.textContent = 'Procurando o vídeo na captura…'; Y.el.capSt.className = 'ytt-st';
    rec = new N.Recortador(bruto, { dica: () => Y.player && Y.player.geometria });
    await rec.iniciar();
    Y.rec = rec; Y.stream = rec.saida; Y.modo = 'janela';
    rec.ouvir(() => estadoCaptura());
    Y.video = Y.video || Object.assign(document.createElement('video'), { muted: true, playsInline: true, autoplay: true });
    Y.video.srcObject = rec.saida; Y.video.play().catch(() => {});
    bruto.getVideoTracks()[0].addEventListener('ended', () => pararCaptura());
  } catch (e) {
    if (rec) rec.parar();
    Y.el.capSt.textContent = e.message; Y.el.capSt.className = 'ytt-st no';
  } finally { Y.el.cap.disabled = false; estadoCaptura(); mostrarJanela(); }
}
function pararCaptura() {
  pararAuto();
  if (Y.rec) { Y.rec.parar(); Y.rec = null; }
  if (Y.stream) for (const t of Y.stream.getTracks()) t.stop();
  Y.stream = null; if (Y.video) Y.video.srcObject = null; estadoCaptura(); mostrarJanela();
}
function estadoCaptura() {
  const E = Y.el; if (!E.cap) return;
  const jan = ytJanela();
  E.cap.textContent = Y.stream ? '⏹ Parar captura' : jan ? 'Compartilhar a janela do player' : 'Compartilhar esta aba';
  E.cap.className = 'btn ' + (Y.stream ? '' : 'pri');
  E.ajuste.hidden = !(Y.stream && Y.rec);
  if (Y.stream && Y.modo === 'janela') { E.capSt.textContent = '● Capturando a janela do player, recortada no vídeo' + (Y.rec ? ' (' + Y.rec.rotulo + ')' : '') + '.' + (Y.rec && !Y.rec.confiavel ? ' Confira o recorte em «Ajustar recorte».' : ' Deixe a janela visível (pode ficar ao lado desta).'); E.capSt.className = 'ytt-st on'; }
  else if (Y.stream) { E.capSt.textContent = Y.modo === 'element' ? '● Capturando só o player (Element Capture).' : '● Capturando o retângulo do player (Region Capture): não role a página nem ponha nada por cima dele.'; E.capSt.className = 'ytt-st on'; }
  else if (!/não|precisa|cancel|Escolha/i.test(E.capSt.textContent)) { E.capSt.textContent = 'Sem captura.'; E.capSt.className = 'ytt-st'; }
  E.um.disabled = E.auto.disabled = !Y.stream;
}

// ------------------------------------------------------------------ quadros
function grupoAtual() { const p = projAtual(); return p && p.tipo === 'anomalia' ? (Y.grupo || 'boa') : ''; }
async function capturarUm(silencioso) {
  if (!Y.stream) { ytMsg('Primeiro clique em «Compartilhar esta aba».', 'no'); return false; }
  if (Y.estado === 0) { if (!silencioso) ytMsg('O vídeo terminou. Volte um pouco e toque antes de capturar.', 'no'); return false; }
  if (Y.estado === 2) { if (!silencioso) ytMsg('Toque o vídeo para capturar: pausado, o YouTube desenha os botões por cima da imagem.', 'no'); return false; }
  if (Y.estado !== 1) { if (!silencioso) ytMsg('O vídeo ainda está carregando. Tente de novo em instantes.', 'no'); return false; }
  if (!ytLimpo()) { if (!silencioso) ytMsg('O YouTube mostra título e botões por alguns segundos depois de tocar ou pular. Tente de novo em instantes.', 'no'); return false; }
  // a captura só entrega a parte do player que está NA TELA: cortado = proporção errada
  const vw = Y.video.videoWidth, vh = Y.video.videoHeight;
  // no modo janela o recorte é do Recortador (pode ser 4:3, manual…): não há «fora da tela» a checar
  if (!vw || (Y.modo !== 'janela' && Math.abs(vw / vh - 16 / 9) > 0.04)) {
    ytMsg('Parte do player está fora da tela (ou coberta). Role a página até ver o player inteiro e tente de novo.', 'no');
    if (!silencioso) Y.host.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return false;
  }
  const q = await Y.N.quadroJpegDe(Y.video, 1920, 0.92);
  if (!q) { ytMsg('A captura ainda não entregou quadro.', 'no'); return false; }
  const t = ytTempo(), id = Y.id, pid = S.proj, grupo = grupoAtual(), agora = new Date();
  const mm = Math.floor(t / 60), ss = Math.floor(t % 60);
  const item = { blob: q.blob, nome: `yt-${id}-${String(mm).padStart(2, '0')}m${String(ss).padStart(2, '0')}s.jpg`,
    meta: { fonte: 'youtube', video: id, t: Math.round(t * 100) / 100, titulo: Y.info.titulo || '', autor: Y.info.canal || '', capturado: agora.toISOString(), origem: `YouTube ${id} @ ${mmss(t)}` } };
  const fig = h('figure', { title: `${Y.info.titulo || id} @ ${mmss(t)}` }, h('img', { src: URL.createObjectURL(q.blob), alt: '' }), h('figcaption', {}, mmss(t)));
  Y.el.tira.prepend(fig);
  while (Y.el.tira.children.length > 60) { const u = Y.el.tira.lastChild.querySelector('img'); URL.revokeObjectURL(u.src); Y.el.tira.lastChild.remove(); }
  // envio em fila (um de cada vez), direto para o projeto escolhido no momento da captura
  Y.envio = Y.envio.then(() => enviarItens([item], grupo, pid)).then((r) => {
    if (r.ok) Y.enviados++; else if (r.repetidas) { Y.repetidos++; fig.classList.add('err'); } else { Y.falhas++; fig.classList.add('err'); fig.title += ' · ' + (r.erros[0] || 'falhou'); }
    contar();
  });
  if (!silencioso) ytMsg('Quadro de ' + mmss(t) + ' enviado ao projeto.', 'on');
  return true;
}
function contar() {
  Y.el.cont.textContent = `Nesta sessão: ${Y.enviados} quadro(s) no projeto` + (Y.repetidos ? ` · ${Y.repetidos} repetido(s)` : '') + (Y.falhas ? ` · ${Y.falhas} falha(s)` : '') + '.';
  if (Y.enviados && !contar.t) contar.t = setTimeout(() => { contar.t = null; carregarProjetos(); }, 2500);
}
function iniciarAuto() {
  if (!Y.stream) { ytMsg('Primeiro clique em «Compartilhar esta aba».', 'no'); return; }
  lerTrecho();
  const passo = Math.max(0.5, Math.min(60, +Y.el.n.value || 2)), max = Math.max(1, Math.min(300, parseInt(Y.el.m.value, 10) || 30));
  const fim = Y.fim || ytDur() || Infinity, ini = Y.ini;
  Y.auto = { feitos: 0, ultimo: -Infinity, fim, ini, passo, max };
  // começa ~5,5 s antes: quando a interface do YouTube some, o vídeo está no início do trecho
  pular(Math.max(0, ini - 5.5)); ytCmd('playVideo');
  Y.el.auto.textContent = `⏹ Parar (0/${max})`;
  ytMsg(`Capturando a cada ${passo} s de vídeo, de ${mmss(ini)} a ${fim === Infinity ? 'o fim' : mmss(fim)}…`, 'on');
  clearInterval(Y.timer);
  Y.timer = setInterval(async () => {
    const A = Y.auto; if (!A || Y.ocupado) return;
    const t = ytTempo();
    if (Y.estado === 0 || t >= A.fim) { pararAuto(`Trecho concluído: ${A.feitos} quadro(s).`); return; }
    if (!ytLimpo() || t < A.ini - 0.05 || t - A.ultimo < A.passo) return;
    Y.ocupado = true;
    try { if (await capturarUm(true)) { A.ultimo = t; A.feitos++; Y.el.auto.textContent = `⏹ Parar (${A.feitos}/${A.max})`; if (A.feitos >= A.max) pararAuto(`Pronto: ${A.feitos} quadro(s).`); } }
    finally { Y.ocupado = false; }
  }, 200);
}
function pararAuto(msg) {
  clearInterval(Y.timer); Y.timer = null;
  const tinha = !!Y.auto; Y.auto = null;
  if (Y.el.auto) Y.el.auto.textContent = '⏱ Capturar no trecho';
  if (tinha) { ytCmd('pauseVideo'); if (msg) ytMsg(msg, 'on'); }
}

// ------------------------------------------------------------------ ganchos usados por treino.js
/** render() chama ao abrir a aba: monta uma vez e atualiza o que depende do projeto. */
async function abaYouTube() {
  if (!Y.raiz) montarYouTube();
  const T = $('#t-yt'); if (!T.contains(Y.raiz)) T.replaceChildren(Y.raiz);
  const p = projAtual(); Y.el.proj.textContent = p ? `«${p.nome}»` : '';
  Y.el.grupo.replaceChildren(...(p && p.tipo === 'anomalia'
    ? [h('button', { class: (Y.grupo || 'boa') === 'boa' ? 'on' : '', onclick: () => { Y.grupo = 'boa'; abaYouTube(); } }, '✔ como BOAS'), h('button', { class: Y.grupo === 'ruim' ? 'on bad' : '', onclick: () => { Y.grupo = 'ruim'; abaYouTube(); } }, '✖ como RUINS')]
    : []));
  Y.el.grupo.hidden = !(p && p.tipo === 'anomalia');
  const N = await ytNucleo(); const sup = N.suporte();
  if (sup.janela) {
    Y.el.dicaTopo.replaceChildren('Quadros de vídeos do YouTube como imagens do projeto. Neste navegador o vídeo toca no ', h('b', {}, 'player oficial'), ', numa ', h('b', {}, 'janela própria'), ' («' + N.TITULO_JANELA + '»); para tirar os quadros, o navegador pede para compartilhar uma janela: escolha essa. ', h('b', {}, 'Nada é baixado do YouTube'), ': cada quadro é uma foto da tela, feita no seu navegador, e vai direto para o projeto com a origem “YouTube <id> @ mm:ss”, o título e o canal.');
    Y.el.capDica.textContent = 'O navegador pergunta o que compartilhar: escolha a janela «' + N.TITULO_JANELA + '». O iaVision corta sozinho a barra de título e as faixas pretas (confira em «Ajustar recorte»). Deixe a janela do player visível, ao lado desta.';
    if (!Y.player) Y.host.textContent = 'Cole um link ou busque um vídeo. Ele toca numa janela própria, no player oficial do YouTube.';
    mostrarJanela();
  }
  $('#ytSuporte').textContent = sup.janela ? sup.explica : sup.captura ? (sup.captura === 'element' ? 'Este navegador recorta a captura no player (Element Capture).' : 'Este navegador recorta a captura no retângulo do player (Region Capture).') : sup.motivo;
  estadoCaptura(); contar();
}
/** Saindo da aba: para a captura automática, solta a captura da aba e pausa o vídeo. */
function ytSair() { if (!Y.raiz) return; pararAuto(); if (Y.stream) pararCaptura(); ytCmd('pauseVideo'); }
