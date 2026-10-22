/**
 * camera/youtube-nucleo.js — o núcleo da fonte YouTube, SEM dependências.
 *
 * Separado de camera/youtube.js para que páginas sem React nem store (o
 * Treinar, /treino/) usem o MESMO mecanismo: player oficial (IFrame API,
 * youtube-nocookie, iframe credentialless) e captura da própria aba recortada
 * no elemento do player (Element Capture; Region Capture como reserva).
 * Nada é baixado do YouTube: os quadros saem da captura, no navegador.
 *
 * camera/youtube.js importa daqui e reexporta YT_ID, extrairId e suporte —
 * quem já importava de lá continua igual.
 *
 * Safari, Firefox (e todo navegador sem iframe credentialless): o player toca
 * numa JANELA PRÓPRIA (/yt/player.html, sem isolamento) e a captura é da
 * janela, recortada no vídeo — camera/youtube-janela.js, reexportado aqui.
 */

export {
  PlayerJanela, capturarJanela, Recortador, detectarRecorte, ajustarRecorte,
  TITULO_JANELA, ERRO_BLOQUEADA,
} from './youtube-janela.js';

export const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Depois de começar, pausar, retomar ou pular, o player oficial desenha por ~4 s
 * o título, o ícone de play/pausa, «Mais vídeos» e o logo — mesmo com controls=0
 * (medido: limpo a partir de 5 s). Quadros para treino só depois dessa janela.
 */
export const JANELA_UI_MS = 5000;

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
                  'youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com'];

/**
 * Texto solto de 11 caracteres que PARECE um id: tem dígito, «-» ou «_», ou mistura
 * maiúsculas no meio da palavra. Uma palavra comum («trabalhando», «Consultoria»)
 * não parece — vira busca. Ids só de letras ainda abrem pelo link.
 */
function pareceId(t) {
  return /[0-9_-]/.test(t) || (/[a-z]/.test(t) && /[A-Z]/.test(t.slice(1)));
}

/**
 * Id de 11 caracteres a partir de um id ou de um link (watch, youtu.be, shorts, live, embed).
 * `solto: true` quando veio de texto solto (não de link): se o vídeo não existir, quem chama
 * pode cair na busca.
 */
export function extrairId(texto) {
  let t = String(texto || '').trim();
  if (YT_ID.test(t)) return pareceId(t) ? { id: t, shorts: false, solto: true } : null;
  if (!/[./]/.test(t)) return null;            // sem ponto nem barra não é link
  if (!/^https?:\/\//i.test(t)) t = 'https://' + t;
  let u;
  try { u = new URL(t); } catch (_) { return null; }
  if (!YT_HOSTS.includes(u.hostname.toLowerCase())) return null;
  const partes = u.pathname.split('/');
  let id = u.hostname === 'youtu.be' ? partes[1] : u.searchParams.get('v');
  if (!id && ['shorts', 'live', 'embed', 'v'].includes(partes[1])) id = partes[2];
  return id && YT_ID.test(id) ? { id, shorts: partes[1] === 'shorts' } : null;
}

function ehCelular() {
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent || '');
}

/**
 * O que este navegador consegue fazer com a fonte YouTube.
 *   captura   'element' | 'region' | 'janela' | null
 *             'janela': Safari/Firefox no computador — player em janela própria
 *             e captura da janela (camera/youtube-janela.js)
 *   assistir  true quando dá para tocar o vídeo (embutido aqui ou na janela)
 *   janela    true quando o player vai para a janela própria
 *   motivo    texto para a pessoa quando captura === null
 *   explica   o que vai acontecer no modo janela (texto para a pessoa)
 * Tudo por detecção de recurso; o user agent só separa celular de computador.
 */
export function suporte() {
  const credentialless = typeof HTMLIFrameElement !== 'undefined'
    && 'credentialless' in HTMLIFrameElement.prototype;
  const tela = Boolean(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const celular = ehCelular();
  let captura = null;
  if (!celular && tela && credentialless) {
    if (typeof window.RestrictionTarget === 'function') captura = 'element';
    else if (typeof window.CropTarget === 'function') captura = 'region';
  }
  // sem embutir aqui (ou sem recortar a aba): janela própria, se der para conversar com ela e capturá-la
  const janela = !captura && !celular && tela && typeof BroadcastChannel === 'function'
    && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (janela) captura = 'janela';
  let motivo = '';
  if (!captura) {
    motivo = celular
      ? 'Usar um vídeo do YouTube como fonte precisa do Chrome ou do Edge no computador: ' +
        'o celular não deixa a página capturar a própria aba.'
      : 'Usar um vídeo do YouTube como fonte precisa de um navegador de computador que capture ' +
        'janelas (Chrome, Edge, Safari ou Firefox atualizados).';
  }
  const explica = janela
    ? 'Neste navegador o vídeo toca numa janela própria («' + 'Player do YouTube — iaVision' + '»), no ' +
      'player oficial. Para usar como fonte, compartilhe ESSA janela quando o navegador perguntar: ' +
      'o iaVision recorta só o vídeo. Nada é baixado do YouTube.'
    : '';
  return { captura, assistir: credentialless || janela, janela, motivo, explica };
}

// ---------------------------------------------------------------- IFrame API

let apiPromessa = null;

/** Carrega https://www.youtube.com/iframe_api uma vez só. */
export function carregarApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromessa) return apiPromessa;
  apiPromessa = new Promise((resolve, reject) => {
    const anterior = window.onYouTubeIframeAPIReady;
    const t = setTimeout(() => {
      apiPromessa = null;
      reject(new Error('O player do YouTube não carregou (rede ou bloqueador de conteúdo?).'));
    }, 15000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(t);
      if (typeof anterior === 'function') { try { anterior(); } catch (_) { /* de outro código */ } }
      resolve(window.YT);
    };
    // uma nova tentativa: de vez em quando a resposta vem sem o cabeçalho CORP e o COEP a bloqueia
    const pedir = (tentativa) => {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api' + (tentativa ? '?t=' + Date.now() : '');
      s.async = true;
      s.onerror = () => {
        s.remove();
        if (!tentativa) { setTimeout(() => pedir(1), 1500); return; }
        clearTimeout(t); apiPromessa = null; reject(new Error('Não foi possível carregar o player do YouTube.'));
      };
      document.head.appendChild(s);
    };
    pedir(0);
  });
  return apiPromessa;
}

export const ERROS_PLAYER = {
  2: 'Identificador de vídeo inválido.',
  5: 'O player do YouTube não conseguiu tocar este vídeo.',
  100: 'Vídeo não encontrado (removido ou privado).',
  101: 'O dono deste vídeo não permite que ele toque fora do YouTube.',
  150: 'O dono deste vídeo não permite que ele toque fora do YouTube.',
  153: 'O YouTube recusou tocar este vídeo incorporado.',
};

/**
 * <iframe> do player oficial, pronto para o YT.Player. credentialless ANTES do
 * src (decide como a navegação é feita; é o que deixa o embed carregar com
 * COEP require-corp). controls 0 onde a página captura: a interface do
 * YouTube não entra nos quadros; quem comanda são os botões da página.
 */
/**
 * Domínios do player oficial. O YouTube às vezes recusa uma reprodução embutida
 * («Ocorreu um erro… ID de reprodução») — verificação anti-robô para player sem
 * cookies, rede instável — e quase sempre sem avisar a página (onError não vem).
 * Quem cria o player tenta de novo pelo outro domínio quando o vídeo não começa.
 */
export const HOSTS_PLAYER = ['www.youtube-nocookie.com', 'www.youtube.com'];
/** Códigos de erro definitivos (vídeo removido/privado ou dono proíbe embed): não adianta tentar de novo. */
export const ERROS_DEFINITIVOS = new Set([100, 101, 150]);
/** Sem começar a tocar em tanto tempo depois de pronto = tratar como recusa e tentar de novo. */
export const ESPERA_INICIO_MS = 12000;

export function criarIframe(id, { controles, host } = {}) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('credentialless', '');
  iframe.credentialless = true;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.title = 'Player do YouTube';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  const ctl = controles != null ? controles : !suporte().captura;
  const q = new URLSearchParams({
    enablejsapi: '1', origin: location.origin, playsinline: '1', rel: '0',
    iv_load_policy: '3', modestbranding: '1', autoplay: '1', mute: '1',
    controls: ctl ? '1' : '0', cc_load_policy: '0', disablekb: '1',
  });
  iframe.src = `https://${HOSTS_PLAYER.includes(host) ? host : HOSTS_PLAYER[0]}/embed/${id}?${q}`;
  return iframe;
}

/** Desliga a legenda (automática ou não) no player: o texto entraria nos quadros capturados. */
export function semLegenda(player) {
  for (const [nome, ...args] of [['setOption', 'captions', 'track', {}], ['unloadModule', 'captions'], ['unloadModule', 'cc']]) {
    try { if (player && typeof player[nome] === 'function') player[nome](...args); } catch (_) { /* módulo ausente */ }
  }
}

// ---------------------------------------------------------------- captura da aba

/**
 * Captura a PRÓPRIA aba e recorta a trilha no elemento `alvo` (o host do
 * player). Precisa de gesto do usuário: o navegador pergunta se pode
 * compartilhar a aba. Devolve o MediaStream (só vídeo, já recortado).
 *   modo        'element' (RestrictionTarget) | 'region' (CropTarget)
 *   restricoes  constraints de vídeo do getDisplayMedia
 * O alvo do Element Capture precisa formar contexto de empilhamento e ser 2D
 * (isolation: isolate; transform-style: flat).
 */
export async function capturarAba(alvo, modo, restricoes) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: restricoes || { frameRate: { ideal: 30, max: 30 } },
      audio: false,                       // o som continua saindo do player
      preferCurrentTab: true,             // Chrome: oferece só/primeiro ESTA aba
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    });
  } catch (err) {
    const e = new Error(err && (err.name === 'NotAllowedError' || err.name === 'AbortError')
      ? 'Captura cancelada. Para usar o YouTube como fonte, permita compartilhar ESTA aba.'
      : 'Não foi possível capturar a aba: ' + ((err && (err.message || err.name)) || 'erro'));
    e.cancelada = Boolean(err && (err.name === 'NotAllowedError' || err.name === 'AbortError'));
    throw e;
  }
  const trilha = stream.getVideoTracks()[0];
  // vídeo, não texto: se precisar degradar, o navegador mantém a fluidez
  try { trilha.contentHint = 'motion'; } catch (_) { /* navegador antigo */ }
  try {
    if (modo === 'element') {
      await trilha.restrictTo(await window.RestrictionTarget.fromElement(alvo));
    } else {
      await trilha.cropTo(await window.CropTarget.fromElement(alvo));
    }
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    // restrictTo/cropTo só aceitam a captura da PRÓPRIA aba
    throw new Error('Escolha «esta aba» no diálogo do navegador (não outra aba, janela ou tela). ' +
                    '(' + (err.message || err.name) + ')');
  }
  return stream;
}

/** Um quadro de um <video> (a trilha capturada) em JPEG: { blob, w, h } ou null. */
export async function quadroJpegDe(video, maxW = 1920, qualidade = 0.92) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  const w = Math.min(maxW, video.videoWidth), h = Math.round((w * video.videoHeight) / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', qualidade));
  return blob ? { blob, w, h } : null;
}
