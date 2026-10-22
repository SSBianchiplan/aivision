/**
 * camera/seletor.js — a lógica do seletor de câmera, sem interface.
 *
 * Usado pelo painel Fonte (components/SeletorCamera.js, React) e pelo Treinar
 * (treino/treino-camera.js, DOM puro, carregado por import dinâmico). Aqui só
 * mora o que é igual nos dois: listar e agrupar as câmeras, abrir uma prévia,
 * lembrar a última escolha, traduzir erros e montar a configuração da câmera
 * Wi-Fi / IP. Cada página desenha do seu jeito.
 *
 * ===================== O QUE O NAVEGADOR ENXERGA DE FATO =====================
 *
 *   USB, integrada, celular-como-webcam (Continuity Camera, DroidCam, Camo,
 *   Iriun), virtuais (OBS, NDI) e capturadoras HDMI-USB: TODAS aparecem em
 *   enumerateDevices() como «videoinput». O navegador não diz o tipo — só o
 *   rótulo, e o rótulo só vem DEPOIS da permissão. O tipo aqui é heurística
 *   pelo rótulo, e por isso é só um ícone: nada depende dele.
 *
 *   Wi-Fi / câmera IP (RTSP, ONVIF): o navegador não lê RTSP. O caminho é o
 *   MediaMTX na máquina da pessoa convertendo RTSP → WebRTC (WHEP), o mesmo
 *   servidor da seção «Câmera externa · RTMP» (camera/stream.js).
 *
 *   Bluetooth: nenhum navegador recebe vídeo por Bluetooth. Câmera vendida
 *   como «Bluetooth» usa o BT só para parear e controlar; o vídeo sai por
 *   Wi-Fi (→ Wi-Fi / IP) ou pelo cabo, como webcam USB (→ já está na lista).
 * ===========================================================================
 */

import { isInfrared } from './device.js';

// --------------------------------------------------------------- tipos

/** Tipos de câmera, na ordem em que os grupos aparecem. */
export const TIPOS = {
  traseira:  { id: 'traseira',  nome: 'Traseira do aparelho',      icone: '📷', ordem: 0 },
  frontal:   { id: 'frontal',   nome: 'Frontal do aparelho',       icone: '🤳', ordem: 1 },
  integrada: { id: 'integrada', nome: 'Integrada',                 icone: '💻', ordem: 2 },
  usb:       { id: 'usb',       nome: 'USB / externa',             icone: '🔌', ordem: 3 },
  celular:   { id: 'celular',   nome: 'Celular como webcam',       icone: '📱', ordem: 4 },
  virtual:   { id: 'virtual',   nome: 'Virtual (OBS, NDI…)',       icone: '🎛', ordem: 5 },
  ir:        { id: 'ir',        nome: 'Infravermelha (Windows Hello)', icone: '🌡', ordem: 6 },
};
/** Entradas que não são «videoinput»: aparecem no seletor com explicação. */
export const ICONE_IP = '📶';
export const ICONE_BT = 'ᛒ';

/**
 * Tipo pelo rótulo. A ordem dos testes importa: «iPhone Desk View Camera» é
 * celular antes de ser «Desk»; «OBS Virtual Camera» é virtual antes de ser
 * «Camera»; e a infravermelha vem primeiro porque a IR do Windows Hello tem
 * rótulo de integrada («Integrated IR Camera»).
 */
export function classificar(rotulo) {
  const r = String(rotulo || '');
  if (isInfrared(r)) return 'ir';
  if (/iphone|ipad|continuity|desk view|droidcam|\bcamo\b|iriun|epoc ?cam|ivcam|ip ?webcam|android|galaxy|pixel|xiaomi|motorola/i.test(r)) return 'celular';
  if (/\bobs\b|virtual|\bndi\b|snap ?camera|manycam|xsplit|mmhmm|ecamm|nvidia broadcast|vcam|camtwist/i.test(r)) return 'virtual';
  // câmeras do próprio celular/tablet (Android: «camera2 1, facing front»; iOS: «Câmera Frontal»)
  if (/facing front|front camera|c[âa]mera frontal|frontal|\bfront\b|\buser\b/i.test(r)) return 'frontal';
  if (/facing back|back camera|rear|c[âa]mera traseira|traseira|ultra ?wide|telephoto|teleobjetiva|grande-angular|\bback\b|environment/i.test(r)) return 'traseira';
  if (/facetime|integrated|integrad|built-?in|internal|embutid|truevision|easycamera|hp hd camera|hd user facing/i.test(r)) return 'integrada';
  // o resto: webcams USB, capturadoras HDMI-USB (Cam Link, «USB Video»), UVC em geral
  return 'usb';
}

/** Celular ou tablet: a escolha certa é frontal/traseira (facingMode), não deviceId. */
export function ehAparelhoMovel() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS se apresenta como Mac; o toque denuncia
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

// --------------------------------------------------------------- lista

export function suportado() {
  return Boolean(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Câmeras disponíveis, agrupadas por tipo.
 *
 * Devolve { cameras, grupos, semPermissao }. `semPermissao` é o caso em que o
 * navegador devolve as câmeras sem rótulo (e às vezes sem id) porque a página
 * ainda não recebeu permissão: aí a interface oferece «Permitir câmera».
 */
export async function listarCameras() {
  if (!suportado()) return { cameras: [], grupos: [], semPermissao: false };
  let todos = [];
  try { todos = await navigator.mediaDevices.enumerateDevices(); } catch (_) { todos = []; }
  const vids = todos.filter((d) => d.kind === 'videoinput');
  const cameras = vids.map((d, i) => {
    const rotulo = d.label || `Câmera ${i + 1}`;
    const tipo = classificar(d.label);
    return { id: d.deviceId || '', grupo: d.groupId || '', rotulo, semRotulo: !d.label, tipo, ir: tipo === 'ir' };
  });
  const semPermissao = cameras.length > 0 && cameras.every((c) => c.semRotulo);
  return { cameras, grupos: agrupar(cameras), semPermissao };
}

export function agrupar(cameras) {
  const mapa = new Map();
  for (const c of cameras) {
    if (!mapa.has(c.tipo)) mapa.set(c.tipo, []);
    mapa.get(c.tipo).push(c);
  }
  return [...mapa.entries()]
    .map(([tipo, itens]) => ({ tipo, ...TIPOS[tipo], itens }))
    .sort((a, b) => a.ordem - b.ordem);
}

/**
 * Plugou ou tirou uma câmera USB (ou o iPhone chegou perto do Mac): o
 * navegador avisa com «devicechange». Devolve a função que desliga o ouvinte.
 */
export function ouvirMudancas(fn) {
  const md = navigator.mediaDevices;
  if (!md || !md.addEventListener) return () => {};
  // vários eventos chegam juntos ao plugar um hub: um aviso só
  let t = null;
  const h = () => { clearTimeout(t); t = setTimeout(fn, 250); };
  md.addEventListener('devicechange', h);
  return () => { clearTimeout(t); md.removeEventListener('devicechange', h); };
}

/**
 * Pede a permissão sem ficar com a câmera: abre e fecha na hora. Depois disso
 * enumerateDevices() devolve os rótulos.
 */
export async function pedirPermissao() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: true }).catch((e) => { throw traduzirErro(e); });
  for (const t of s.getTracks()) t.stop();
  return true;
}

// --------------------------------------------------------------- prévia e captura

/**
 * Abre uma câmera e devolve { stream, settings, rotulo }.
 *
 * `alvo` é { id } para um dispositivo ou { facing: 'user'|'environment' } no
 * celular. Resolução e fps são «ideal»: a câmera entrega o que conseguir, e
 * `settings` (track.getSettings) diz o que veio DE FATO.
 */
export async function abrirCamera(alvo = {}, { width = 1280, height = 720, fps = 30 } = {}) {
  if (!suportado()) throw new Error('Este navegador não dá acesso à câmera.');
  if (!window.isSecureContext) throw new Error('A câmera exige página segura (https:// ou http://localhost).');
  const video = { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } };
  if (alvo.id) video.deviceId = { exact: alvo.id };
  else video.facingMode = { ideal: alvo.facing || 'environment' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (err) {
    // sem resolução pedida, antes de desistir (mesma tática do device.js)
    if (err && err.name === 'OverconstrainedError' && alvo.id) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: alvo.id } } }); }
      catch (e2) { throw traduzirErro(e2); }
    } else {
      throw traduzirErro(err);
    }
  }
  const track = stream.getVideoTracks()[0];
  const settings = track && track.getSettings ? track.getSettings() : {};
  return { stream, settings, rotulo: (track && track.label) || '' };
}

export function fecharStream(stream) {
  if (stream) for (const t of stream.getTracks()) t.stop();
}

/** «1280×720 · 30 fps» a partir de track.getSettings(). */
export function textoSettings(s) {
  if (!s || !s.width) return '';
  return `${s.width}×${s.height}` + (s.frameRate ? ` · ${Math.round(s.frameRate)} fps` : '');
}

export function traduzirErro(err) {
  const nome = (err && err.name) || '';
  if (nome === 'OverconstrainedError' && err.constraint === 'deviceId') {
    return Object.assign(new Error('Esta câmera não está mais conectada. Plugue de novo e clique em Atualizar lista.'), { code: 'NotFoundError', emUso: false });
  }
  const MAPA = {
    NotAllowedError: 'Permissão de câmera negada. Libere no ícone de câmera da barra de endereço e tente de novo.',
    SecurityError: 'O navegador bloqueou a câmera nesta página (precisa de https:// ou http://localhost).',
    NotFoundError: 'Nenhuma câmera encontrada. Plugue uma webcam USB ou aproxime o celular (Continuity Camera) e clique em Atualizar lista.',
    NotReadableError: 'Esta câmera está em uso por outro app (Teams, Zoom, Meet, OBS?) ou travou. Feche o outro app e tente de novo.',
    TrackStartError: 'Esta câmera está em uso por outro app. Feche o outro app e tente de novo.',
    OverconstrainedError: 'Esta câmera não aceitou a configuração pedida — tente outra resolução.',
    AbortError: 'A câmera não iniciou (o sistema abortou). Desplugue e plugue de novo, ou tente outra.',
  };
  const msg = MAPA[nome] || `Não consegui abrir a câmera${nome ? ' (' + nome + ')' : ''}.`;
  return Object.assign(new Error(msg), { code: nome, emUso: nome === 'NotReadableError' || nome === 'TrackStartError' });
}

// --------------------------------------------------------------- memória

const ULTIMA_KEY = 'gplansis.camera.ultima';

/** Última câmera escolhida neste aparelho: { id, rotulo } ou { facing }. */
export function ultimaCamera() {
  try { return JSON.parse(localStorage.getItem(ULTIMA_KEY) || 'null'); } catch (_) { return null; }
}
export function lembrarCamera(v) {
  try { v ? localStorage.setItem(ULTIMA_KEY, JSON.stringify(v)) : localStorage.removeItem(ULTIMA_KEY); } catch (_) { /* storage bloqueado */ }
}
/**
 * Acha a última câmera na lista atual. O id costuma ser estável por site
 * enquanto a permissão vale; quando muda (permissão revogada, outro perfil),
 * o rótulo ainda acerta.
 */
export function acharUltima(cameras) {
  const u = ultimaCamera();
  if (!u || !cameras || !cameras.length) return null;
  return cameras.find((c) => u.id && c.id === u.id) || cameras.find((c) => u.rotulo && c.rotulo === u.rotulo) || null;
}

// --------------------------------------------------------------- Wi-Fi / IP

/*
 * Câmera Wi-Fi / IP pelo MediaMTX.
 *
 *   câmera IP ──RTSP──▶ MediaMTX (sua máquina) ──WebRTC/WHEP──▶ navegador
 *
 * O iaVision só gera o TRECHO do mediamtx.yml e conecta no endereço WHEP. O
 * usuário e a senha da câmera vão para o texto gerado AQUI, no navegador, e
 * dele para o arquivo da pessoa — não são enviados a servidor nenhum e não
 * ficam guardados (só o IP, a porta, o caminho e o nome são lembrados).
 */
export const IP_KEY = 'gplansis.camera.ip';

/** Caminhos RTSP comuns por fabricante — ponto de partida, o manual da câmera manda. */
export const MODELOS_RTSP = [
  { id: 'generico', nome: 'Genérica / ONVIF', caminho: '/stream1', porta: 554 },
  { id: 'hikvision', nome: 'Hikvision', caminho: '/Streaming/Channels/101', porta: 554 },
  { id: 'dahua', nome: 'Dahua / Intelbras', caminho: '/cam/realmonitor?channel=1&subtype=0', porta: 554 },
  { id: 'reolink', nome: 'Reolink', caminho: '/h264Preview_01_main', porta: 554 },
  { id: 'tapo', nome: 'TP-Link Tapo', caminho: '/stream1', porta: 554 },
  { id: 'ipwebcam', nome: 'App IP Webcam (Android)', caminho: '/h264_ulaw.sdp', porta: 8080 },
  { id: 'mjpeg', nome: 'Só MJPEG por HTTP (via ffmpeg)', caminho: '/video', porta: 8080, http: true },
];

export const IP_PADRAO = { nome: 'cam1', ip: '', porta: 554, caminho: '/stream1', modelo: 'generico', whep: '' };

export function lerConfigIp() {
  try { return { ...IP_PADRAO, ...(JSON.parse(localStorage.getItem(IP_KEY) || '{}') || {}) }; } catch (_) { return { ...IP_PADRAO }; }
}
/** Guarda SÓ o que não é segredo. */
export function salvarConfigIp(c) {
  const { nome, ip, porta, caminho, modelo, whep } = c || {};
  try { localStorage.setItem(IP_KEY, JSON.stringify({ nome, ip, porta, caminho, modelo, whep })); } catch (_) { /* storage bloqueado */ }
}

/** Nome do caminho no MediaMTX: letras, números, - e _. */
export function nomeCaminho(n) {
  return String(n || '').trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'cam1';
}

/** URL da câmera (rtsp:// ou http:// para MJPEG), com usuário e senha codificados. */
export function urlCamera({ ip, porta, caminho, usuario = '', senha = '', modelo }, { mascara = false } = {}) {
  const m = MODELOS_RTSP.find((x) => x.id === modelo) || MODELOS_RTSP[0];
  const proto = m.http ? 'http' : 'rtsp';
  const host = String(ip || '').trim() || 'IP-DA-CAMERA';
  const sen = senha ? ':' + (mascara ? '●●●●' : encodeURIComponent(senha)) : '';
  const cred = usuario ? `${encodeURIComponent(usuario)}${sen}@` : '';
  let c = String(caminho || '').trim();
  if (c && !c.startsWith('/')) c = '/' + c;
  return `${proto}://${cred}${host}:${parseInt(porta, 10) || (m.http ? 8080 : 554)}${c}`;
}

/** Endereço WHEP padrão do MediaMTX nesta máquina para o caminho dado. */
export function whepPadrao(nome) {
  return `http://localhost:8889/${nomeCaminho(nome)}/whep`;
}

/** O trecho do mediamtx.yml. `ocultarSenha` troca a senha por ●●●● (para mostrar na tela). */
export function trechoMediamtx(c, { ocultarSenha = false } = {}) {
  const nome = nomeCaminho(c.nome);
  const m = MODELOS_RTSP.find((x) => x.id === c.modelo) || MODELOS_RTSP[0];
  const url = urlCamera(c, { mascara: ocultarSenha });
  const L = [
    '# ── trecho do mediamtx.yml · câmera Wi-Fi / IP (gerado pelo GPlanSiS|iaVision)',
    '# Cole dentro de «paths:» no mediamtx.yml (ou acrescente o bloco «paths:» se não houver)',
    '# e reinicie o MediaMTX. A senha fica SÓ neste arquivo, na sua máquina.',
    'paths:',
    `  ${nome}:`,
  ];
  if (m.http) {
    // MJPEG por HTTP: o MediaMTX não lê; o ffmpeg converte para H.264 e publica no próprio MediaMTX
    L.push(
      '    # MJPEG por HTTP → H.264: precisa do ffmpeg instalado (ffmpeg.org)',
      `    runOnInit: ffmpeg -fflags nobuffer -i ${url} -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -an -f rtsp rtsp://localhost:$RTSP_PORT/$MTX_PATH`,
      '    runOnInitRestart: yes',
    );
  } else {
    L.push(
      `    source: ${url}`,
      '    # liga a câmera só quando alguém assiste',
      '    sourceOnDemand: yes',
      '    # imagem cortada ou cinza? force TCP (versões antigas do MediaMTX: sourceProtocol: tcp)',
      '    # rtspTransport: tcp',
    );
  }
  L.push(
    '',
    `# No iaVision, conecte em: ${whepPadrao(nome)}`,
  );
  return L.join('\n') + '\n';
}

/**
 * Lê o endereço WHEP digitado e devolve a configuração para o StreamSource.
 * Aceita «http://localhost:8889/cam1/whep», sem o /whep final, ou só
 * «localhost:8889/cam1».
 */
export function lerWhep(texto) {
  let t = String(texto || '').trim();
  if (!t) return { ok: false, erro: 'Informe o endereço WHEP (ex.: http://localhost:8889/cam1/whep).' };
  if (!/^https?:\/\//i.test(t)) t = 'http://' + t;
  let u;
  try { u = new URL(t); } catch (_) { return { ok: false, erro: 'Endereço inválido.' }; }
  if (u.username || u.password) return { ok: false, erro: 'O endereço WHEP não leva usuário nem senha — eles ficam no mediamtx.yml.' };
  let caminho = u.pathname.replace(/\/+$/, '');
  if (!/\/whep$/i.test(caminho)) caminho += '/whep';
  const path = caminho.replace(/^\/+/, '').replace(/\/whep$/i, '');
  if (!path) return { ok: false, erro: 'Falta o nome do caminho (ex.: /cam1/whep).' };
  const url = `${u.protocol}//${u.host}${caminho}`;
  const porta = parseInt(u.port, 10) || (u.protocol === 'https:' ? 443 : 80);
  return { ok: true, url, cfg: { whep: url, host: u.hostname, webrtcPort: porta, path, base: '', origem: 'ip' } };
}

/** Página em HTTPS e WHEP em HTTP: o navegador bloqueia (medido em camera/stream.js). */
export function whepBloqueado(url) {
  return location.protocol === 'https:' && /^http:/i.test(String(url || ''));
}

// --------------------------------------------------------------- textos explicativos

export const TEXTO_BLUETOOTH =
  'Nenhum navegador recebe vídeo por Bluetooth — o Web Bluetooth não transporta vídeo, e o Bluetooth ' +
  'não tem banda para isso. Câmeras vendidas como «Bluetooth» usam o BT só para parear e controlar: o ' +
  'vídeo sai por Wi-Fi (use «Câmera Wi-Fi / IP») ou pelo cabo USB, como webcam comum (aí ela já aparece ' +
  'nesta lista — clique em Atualizar lista).';

export const TEXTO_MJPEG =
  'Endereços http://…/video (MJPEG) de câmeras e de apps como o IP Webcam não abrem aqui: o iaVision roda ' +
  'isolado (COEP) para usar os modelos em várias threads, e esse isolamento recusa imagem de outro endereço ' +
  'que não se declare liberada — e câmera nenhuma faz isso. Use o RTSP da câmera (quase todas têm) ou ' +
  'escolha «Só MJPEG por HTTP» abaixo: o MediaMTX, com o ffmpeg, converte para WebRTC.';

export const TEXTO_HTTPS =
  'Esta página está em HTTPS e o MediaMTX responde em http:// — o navegador bloqueia, inclusive para ' +
  'localhost. Use o túnel HTTPS (tools/tunel.cmd, o mesmo do RTMP: https://<túnel>/media/whep/cam1/whep) ' +
  'ou abra o iaVision pela instalação local (http://localhost:8001).';
