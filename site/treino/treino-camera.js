/* iaVision · Treinar › «📷 Câmera»: fotos da câmera direto para o projeto.
   Webcam integrada, USB, celular como webcam (Continuity Camera, DroidCam, Camo…), as câmeras do próprio celular
   (frontal/traseira) e câmera Wi-Fi / IP pelo MediaMTX (RTSP → WebRTC/WHEP). A lógica de listar, agrupar, lembrar e
   montar o mediamtx.yml é a mesma do painel Fonte do app (js/camera/seletor.js, por import dinâmico); a conexão
   WHEP é o StreamSource do app (js/camera/stream.js).
   Cada foto é reduzida no navegador (≤ 2048 px, JPEG 0,9 — a mesma regra dos prints), sai sem repetidas (sha256) e
   vai pelo upload de sempre, com fonte «print» e origem «câmera <rótulo> · data/hora» (o serviço 2.2 aceita
   print|arquivo|youtube; não foi preciso mexer nele).
   Script clássico, carregado depois de treino.js: usa $, h, S, api, toast, enviarItens, projAtual, carregarProjetos,
   abaImagens, sha256, hashesDoProjeto, carimbo, marcaArquivo, MAX_LADO. */
'use strict';
const CAM = {
  N: null, raiz: null, el: {}, stream: null, ip: null, atual: null, lista: null, offMudancas: null,
  auto: null, timer: null, envio: Promise.resolve(), vistos: new Set(), enviados: 0, repetidos: 0, falhas: 0,
  grupo: 'boa', pid: null, espelhar: false, abrindo: 0, usuario: '', senha: '',
};
const camNucleo = async () => (CAM.N || (CAM.N = await import('/js/camera/seletor.js')));
const camGrupo = () => { const p = projAtual(); return p && p.tipo === 'anomalia' ? CAM.grupo : ''; };
function camMsg(t, tipo) { const e = CAM.el.msg; if (!e) return; e.textContent = t || ''; e.className = 'ytt-st' + (tipo ? ' ' + tipo : ''); }

// ------------------------------------------------------------------ abrir / fechar
/** Botão «📷 Câmera» da barra de imagens. `grupo`: 'boa' | 'ruim' em projeto de anomalia. */
async function abrirCameraTreino(grupo) {
  if (!S.proj) { toast('Escolha um projeto primeiro.'); return; }
  const N = await camNucleo();
  const outroProjeto = CAM.pid !== S.proj;
  CAM.pid = S.proj; CAM.grupo = grupo || S.grupo || 'boa';
  CAM.enviados = CAM.repetidos = CAM.falhas = 0;
  if (!CAM.raiz) camMontar();
  // a tira mostra as fotos DESTE projeto
  if (outroProjeto) { for (const i of CAM.el.tira.querySelectorAll('img')) URL.revokeObjectURL(i.src); CAM.el.tira.replaceChildren(); }
  document.body.append(CAM.raiz); CAM.raiz.hidden = false;
  document.documentElement.classList.add('camt-aberta');
  camDesenharGrupo(); camContar();
  CAM.el.proj.textContent = `«${(projAtual() || {}).nome || ''}»`;
  CAM.vistos = await hashesDoProjeto();
  if (!N.suportado() || !window.isSecureContext) { camMsg('Este navegador (ou esta página sem https) não dá acesso à câmera. A câmera Wi-Fi / IP ainda funciona.', 'no'); }
  CAM.offMudancas = N.ouvirMudancas(async () => { await camListar(); camMsg('Lista de câmeras atualizada.', 'on'); });
  await camListar();
  // abre direto na última câmera usada (ou na primeira colorida; no celular, a traseira)
  if (!CAM.stream && !CAM.ip && N.suportado()) {
    const u = N.ultimaCamera();
    const cams = (CAM.lista && CAM.lista.cameras) || [];
    const ult = N.acharUltima(cams);
    if (N.ehAparelhoMovel()) await camLigar({ facing: (u && u.facing) || 'environment' });
    else if (ult) await camLigar({ id: ult.id, rotulo: ult.rotulo, tipo: ult.tipo });
    else if (cams.length && !CAM.lista.semPermissao) { const c = cams.find((x) => x.tipo !== 'ir') || cams[0]; await camLigar(c); }
    else if (cams.length) await camLigar({});          // sem permissão ainda: pedir abre a padrão
  }
}
function fecharCameraTreino() {
  camPararAuto();
  camSoltar();
  if (CAM.offMudancas) { CAM.offMudancas(); CAM.offMudancas = null; }
  if (CAM.raiz) CAM.raiz.hidden = true;
  document.documentElement.classList.remove('camt-aberta');
  // a grade de imagens só é redesenhada no fim (redesenhar a cada foto piscaria atrás do painel)
  CAM.envio.then(async () => { await carregarProjetos(); if (S.tab === 'imgs' && S.proj === CAM.pid) abaImagens(); });
}
function camSoltar() {
  CAM.N && CAM.N.fecharStream(CAM.stream); CAM.stream = null;
  if (CAM.ip) { CAM.ip.disconnect(); CAM.ip = null; }
  if (CAM.el.video) CAM.el.video.srcObject = null;
  CAM.atual = null; camInfo();
}

// ------------------------------------------------------------------ montagem (uma vez)
function camMontar() {
  const E = CAM.el;
  E.video = h('video', { muted: true, playsinline: true, autoplay: true });
  E.video.muted = true;
  E.vazio = h('div', { class: 'camt-vazio' }, 'Escolha uma câmera ao lado.');
  E.palco = h('div', { class: 'camt-palco' }, E.video, E.vazio);
  E.info = h('div', { class: 'camt-info small' });
  E.proj = h('b', {});
  E.facing = h('div', { class: 'camt-facing', hidden: true },
    h('button', { class: 'btn pri', onclick: () => camLigar({ facing: 'environment' }) }, '📷 Traseira'),
    h('button', { class: 'btn', onclick: () => camLigar({ facing: 'user' }) }, '🤳 Frontal'));
  E.lista = h('div', { class: 'camt-lista', role: 'listbox', 'aria-label': 'Câmeras' });
  E.perm = h('div', { class: 'aviso small', hidden: true }, 'O navegador só mostra o nome das câmeras depois da permissão. ',
    h('button', { class: 'btn sm pri', onclick: camPermitir }, 'Permitir câmera'));
  E.atualizar = h('button', { class: 'btn sm', onclick: async () => { await camListar(); camMsg(`${CAM.lista.cameras.length} câmera(s) encontrada(s).`, 'on'); } }, '↻ Atualizar lista');
  E.res = h('select', { 'aria-label': 'Resolução pedida à câmera', onchange: () => { if (CAM.atual && !CAM.ip) camLigar(CAM.atual); } },
    ...[[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [640, 480]].map(([w, hh]) => h('option', { value: w + 'x' + hh }, `${w}×${hh}`)));
  E.res.value = '1920x1080';
  E.esp = h('input', { type: 'checkbox', onchange: () => { CAM.espelhar = E.esp.checked; E.palco.classList.toggle('esp', CAM.espelhar); } });

  // captura
  E.um = h('button', { class: 'btn pri camt-foto', onclick: () => camCapturar(false), title: 'Capturar foto (tecla espaço)' }, '📸 Capturar foto');
  E.n = h('input', { type: 'number', min: 0.5, max: 600, step: 0.5, value: 2, 'aria-label': 'Intervalo em segundos' });
  E.m = h('input', { type: 'number', min: 1, max: 500, value: 20, 'aria-label': 'Máximo de fotos' });
  E.auto = h('button', { class: 'btn', onclick: () => (CAM.auto ? camPararAuto('Parado.') : camIniciarAuto()) }, '⏱ Capturar a cada N s');
  E.grupo = h('div', { class: 'seg', style: 'margin:0' });
  E.msg = h('div', { class: 'ytt-st' });
  E.cont = h('div', { class: 'small mut' });
  E.tira = h('div', { class: 'ytt-tira' });

  // Wi-Fi / IP
  E.ip = camMontarIp();
  E.bt = h('details', { class: 'camt-det' }, h('summary', {}, h('span', { class: 'camt-ic bt' }, 'ᛒ'), ' Bluetooth'),
    h('p', { class: 'small' }), h('ul', { class: 'small' },
      h('li', {}, h('b', {}, 'Vídeo pelo Wi-Fi'), ' (câmeras de segurança, action cams, drones): use «Câmera Wi-Fi / IP» acima.'),
      h('li', {}, h('b', {}, 'Vídeo pelo cabo'), ' (UVC, «webcam mode»): plugue no USB e clique em ↻ Atualizar lista.'),
      h('li', {}, h('b', {}, 'Celular'), ': DroidCam, Camo, Iriun ou Continuity Camera (iPhone + Mac) viram webcam e aparecem na lista.')));

  CAM.raiz = h('div', { class: 'camt', role: 'dialog', 'aria-label': 'Câmera — fotos para o projeto', hidden: true },
    h('div', { class: 'rbar' },
      h('b', {}, '📷 Câmera'), h('span', { class: 'mut small' }, 'fotos para ', E.proj),
      h('div', { class: 'grow' }),
      h('label', { class: 'chk small' }, E.esp, 'Espelhar'),
      h('label', { class: 'chk small' }, 'Resolução ', E.res),
      h('button', { class: 'btn', onclick: fecharCameraTreino, title: 'Fechar (Esc)' }, 'Fechar câmera')),
    h('div', { class: 'camt-corpo' },
      h('div', { class: 'camt-esq' }, E.palco, E.info,
        h('div', { class: 'camt-acoes' }, E.um,
          h('span', { class: 'ytt-lin' }, h('label', {}, 'a cada', E.n, 's'), h('label', {}, 'até', E.m), E.auto), E.grupo),
        E.msg, E.cont, E.tira),
      h('aside', { class: 'camt-lado' },
        E.facing, E.perm, E.lista,
        h('div', { class: 'bar', style: 'margin:6px 0' }, E.atualizar),
        h('div', { class: 'camt-gt' }, 'Outras fontes'), E.ip, E.bt)));
  E.bt.querySelector('p').textContent = CAM.N ? CAM.N.TEXTO_BLUETOOTH : '';

  // espaço captura; Esc fecha (fora dos campos)
  addEventListener('keydown', (e) => {
    if (!CAM.raiz || CAM.raiz.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); fecharCameraTreino(); return; }
    const t = e.target; if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); camCapturar(false); }
  });
}
function camDesenharGrupo() {
  const p = projAtual(); const E = CAM.el;
  E.grupo.replaceChildren(...(p && p.tipo === 'anomalia'
    ? [h('button', { class: CAM.grupo === 'boa' ? 'on' : '', onclick: () => { CAM.grupo = 'boa'; camDesenharGrupo(); } }, '✔ BOA'),
       h('button', { class: CAM.grupo === 'ruim' ? 'on bad' : '', onclick: () => { CAM.grupo = 'ruim'; camDesenharGrupo(); } }, '✖ RUIM')]
    : []));
  E.grupo.hidden = !(p && p.tipo === 'anomalia');
  E.um.textContent = p && p.tipo === 'anomalia' ? (CAM.grupo === 'ruim' ? '📸 Capturar foto RUIM' : '📸 Capturar foto BOA') : '📸 Capturar foto';
}

// ------------------------------------------------------------------ lista de câmeras
async function camListar() {
  const N = await camNucleo(); const E = CAM.el;
  CAM.lista = await N.listarCameras();
  const movel = N.ehAparelhoMovel();
  E.facing.hidden = !movel;
  E.perm.hidden = !CAM.lista.semPermissao;
  // no celular, só as câmeras do próprio aparelho
  const grupos = movel ? CAM.lista.grupos.filter((g) => !['virtual', 'ir', 'celular'].includes(g.tipo)) : CAM.lista.grupos;
  const ult = N.ultimaCamera();
  E.lista.replaceChildren(...(CAM.lista.cameras.length ? [] : [h('div', { class: 'small mut' }, 'Nenhuma câmera encontrada. Plugue uma webcam USB, ligue o DroidCam/Camo ou aproxime o iPhone do Mac — a lista atualiza sozinha.')]),
    ...grupos.map((g) => h('div', { class: 'camt-g' }, h('div', { class: 'camt-gt' }, g.icone + ' ' + g.nome),
      ...g.itens.map((c) => {
        const em = CAM.atual && CAM.atual.id && CAM.atual.id === c.id && !CAM.ip;
        const eUlt = !em && ult && ult.id && ult.id === c.id;
        return h('button', { class: 'camt-i' + (em ? ' on' : '') + (c.erro ? ' erro' : ''), role: 'option', 'aria-selected': em ? 'true' : 'false', 'data-id': c.id,
          disabled: !c.id && !CAM.lista.semPermissao ? true : null, onclick: () => (c.id ? camLigar(c) : camPermitir()) },
          h('span', { class: 'camt-ic' }, g.icone),
          h('span', { class: 'camt-n' }, h('b', {}, c.rotulo),
            em ? h('em', { class: 'tag ok' }, 'ao vivo') : eUlt ? h('em', { class: 'tag' }, 'última usada') : '',
            c.tipo === 'ir' ? h('small', { class: 'mut' }, 'imagem preta fora do Windows Hello') : '',
            CAM.erros && CAM.erros[c.id] ? h('small', { class: 'camt-err' }, CAM.erros[c.id]) : ''));
      }))));
}
async function camPermitir() {
  const N = await camNucleo();
  try { await N.pedirPermissao(); await camListar(); const c = N.acharUltima(CAM.lista.cameras) || CAM.lista.cameras.find((x) => x.tipo !== 'ir'); if (c) camLigar(c); }
  catch (e) { camMsg(e.message, 'no'); }
}
/** Liga uma câmera: { id } (dispositivo), { facing } (celular) ou {} (a padrão). */
async function camLigar(c) {
  const N = await camNucleo(); const E = CAM.el;
  const n = ++CAM.abrindo;
  camPararAuto();
  N.fecharStream(CAM.stream); CAM.stream = null;
  if (CAM.ip) { CAM.ip.disconnect(); CAM.ip = null; }
  E.video.srcObject = null; E.vazio.hidden = false; E.vazio.textContent = 'Abrindo a câmera…';
  E.um.disabled = E.auto.disabled = true;
  const [w, hh] = E.res.value.split('x').map(Number);
  try {
    const r = await N.abrirCamera(c.id ? { id: c.id } : { facing: c.facing || (N.ehAparelhoMovel() ? 'environment' : 'user') }, { width: w, height: hh, fps: 30 });
    if (n !== CAM.abrindo) { N.fecharStream(r.stream); return; }
    CAM.stream = r.stream;
    const id = r.settings.deviceId || c.id || '';
    const achada = CAM.lista && CAM.lista.cameras.find((x) => x.id === id);
    const rotulo = (achada && achada.rotulo) || r.rotulo || c.rotulo || 'câmera';
    CAM.atual = { id, rotulo, tipo: N.classificar(rotulo), facing: r.settings.facingMode || c.facing || '', settings: r.settings };
    if (CAM.erros) delete CAM.erros[id];
    E.video.srcObject = r.stream; await E.video.play().catch(() => {});
    await camPrimeiroQuadro();
    E.vazio.hidden = true;
    // câmera frontal espelhada por padrão (como selfie); as outras não
    CAM.espelhar = CAM.atual.facing === 'user' || CAM.atual.tipo === 'frontal';
    E.esp.checked = CAM.espelhar; E.palco.classList.toggle('esp', CAM.espelhar);
    N.lembrarCamera(c.facing && !c.id ? { facing: CAM.atual.facing || c.facing } : { id, rotulo });
    r.stream.getVideoTracks()[0].addEventListener('ended', () => { if (CAM.stream === r.stream) { camMsg('A câmera foi desconectada.', 'no'); camSoltar(); camListar(); } });
    camMsg('');
  } catch (e) {
    if (n !== CAM.abrindo) return;
    E.vazio.textContent = e.message; CAM.atual = null;
    if (c.id) { CAM.erros = CAM.erros || {}; CAM.erros[c.id] = e.message; }
    camMsg(e.message, 'no');
  }
  camInfo(); await camListar();
}
/** Algumas câmeras entregam quadros pretos no primeiro instante: espera dois quadros decodificados (teto de 1,5 s). */
function camPrimeiroQuadro() {
  const v = CAM.el.video;
  if (!v.requestVideoFrameCallback) return new Promise((r) => setTimeout(r, 150));
  return new Promise((res) => {
    const t = setTimeout(res, 1500);
    v.requestVideoFrameCallback(() => v.requestVideoFrameCallback(() => { clearTimeout(t); res(); }));
  });
}
function camInfo() {
  const E = CAM.el; if (!E.info) return;
  const a = CAM.atual;
  if (!a) { E.info.textContent = ''; E.um.disabled = E.auto.disabled = true; return; }
  const N = CAM.N; const t = N.TIPOS[a.tipo] || N.TIPOS.usb;
  const s = a.ip ? { width: E.video.videoWidth, height: E.video.videoHeight } : a.settings;
  E.info.replaceChildren(h('span', {}, a.ip ? N.ICONE_IP : t.icone), ' ', h('b', {}, a.rotulo), ' · ', a.ip ? 'Wi-Fi / IP (MediaMTX)' : t.nome,
    s && s.width ? h('span', { class: 'mut' }, ' · entregue: ' + N.textoSettings(s)) : '');
  E.um.disabled = E.auto.disabled = false;
}

// ------------------------------------------------------------------ Wi-Fi / IP
function camMontarIp() {
  const E = CAM.el; let cfg = null;
  const campo = (rot, el) => h('label', {}, h('span', {}, rot), el);
  const ler = () => { if (!cfg && CAM.N) cfg = CAM.N.lerConfigIp(); return cfg || {}; };
  const salvar = () => { CAM.N.salvarConfigIp(cfg); atualizarYml(); };
  E.ipModelo = h('select', { onchange: () => { const m = CAM.N.MODELOS_RTSP.find((x) => x.id === E.ipModelo.value); ler(); cfg.modelo = E.ipModelo.value; if (m) { cfg.caminho = m.caminho; cfg.porta = m.porta; E.ipCaminho.value = m.caminho; E.ipPorta.value = m.porta; } salvar(); } });
  E.ipNome = h('input', { type: 'text', spellcheck: 'false', oninput: () => { ler(); const antigo = cfg.whep; const pad = CAM.N.whepPadrao(cfg.nome); cfg.nome = E.ipNome.value; if (!antigo || antigo === pad) { cfg.whep = CAM.N.whepPadrao(cfg.nome); E.ipWhep.value = cfg.whep; } salvar(); } });
  E.ipIp = h('input', { type: 'text', placeholder: '192.168.0.50', inputmode: 'decimal', spellcheck: 'false', oninput: () => { ler(); cfg.ip = E.ipIp.value.trim(); salvar(); } });
  E.ipPorta = h('input', { type: 'text', inputmode: 'numeric', oninput: () => { ler(); cfg.porta = parseInt(E.ipPorta.value, 10) || ''; salvar(); } });
  E.ipCaminho = h('input', { type: 'text', spellcheck: 'false', oninput: () => { ler(); cfg.caminho = E.ipCaminho.value; salvar(); } });
  // usuário e senha: só na memória desta página; nunca vão para o storage
  E.ipUsuario = h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', oninput: () => { CAM.usuario = E.ipUsuario.value; atualizarYml(); } });
  E.ipSenha = h('input', { type: 'password', autocomplete: 'new-password', oninput: () => { CAM.senha = E.ipSenha.value; atualizarYml(); } });
  E.ipYml = h('pre', { class: 'camt-yml' });
  E.ipWhep = h('input', { type: 'text', spellcheck: 'false', inputmode: 'url', oninput: () => { ler(); cfg.whep = E.ipWhep.value.trim(); salvar(); } });
  E.ipAviso = h('div', { class: 'aviso small', hidden: true });
  E.ipMjpeg = h('div', { class: 'aviso small', hidden: true });
  E.ipBtn = h('button', { class: 'btn pri', onclick: () => (CAM.ip ? camLigarIpParar() : camConectarIp()) }, '📶 Conectar');
  const dados = () => ({ ...ler(), usuario: CAM.usuario, senha: CAM.senha });
  function atualizarYml() {
    if (!CAM.N) return;
    E.ipYml.textContent = CAM.N.trechoMediamtx(dados(), { ocultarSenha: true });
    const w = E.ipWhep.value || CAM.N.whepPadrao(ler().nome);
    E.ipAviso.hidden = !CAM.N.whepBloqueado(w); E.ipAviso.textContent = CAM.N.TEXTO_HTTPS;
    const m = CAM.N.MODELOS_RTSP.find((x) => x.id === ler().modelo); E.ipMjpeg.hidden = !(m && m.http); E.ipMjpeg.textContent = CAM.N.TEXTO_MJPEG;
  }
  const det = h('details', { class: 'camt-det camt-ip', ontoggle: () => {
    if (!det.open || det.dataset.pronto) return; det.dataset.pronto = '1';
    const c = ler(); const N = CAM.N;
    E.ipModelo.replaceChildren(...N.MODELOS_RTSP.map((m) => h('option', { value: m.id }, m.nome))); E.ipModelo.value = c.modelo;
    E.ipNome.value = c.nome; E.ipIp.value = c.ip; E.ipPorta.value = c.porta; E.ipCaminho.value = c.caminho; E.ipWhep.value = c.whep || N.whepPadrao(c.nome);
    atualizarYml();
  } },
    h('summary', {}, h('span', { class: 'camt-ic' }, '📶'), ' Câmera Wi-Fi / IP ', h('span', { class: 'small mut' }, 'RTSP / ONVIF pelo MediaMTX')),
    h('p', { class: 'small mut' }, 'O navegador não lê RTSP. O MediaMTX na sua máquina busca o vídeo da câmera e entrega por WebRTC (menos de 1 s de atraso) — o mesmo servidor da «Câmera externa · RTMP» do app.'),
    h('div', { class: 'form camt-form' }, campo('Marca / tipo', E.ipModelo), campo('Nome no MediaMTX', E.ipNome), campo('IP da câmera', E.ipIp), campo('Porta', E.ipPorta),
      campo('Caminho', E.ipCaminho), campo('Usuário', E.ipUsuario), campo('Senha', E.ipSenha)),
    h('div', { class: 'small mut' }, '🔒 Usuário e senha só entram no trecho abaixo, aqui no navegador: não são enviados a nenhum servidor nem guardados.'),
    E.ipMjpeg,
    h('div', { class: 'small', style: 'margin:8px 0 4px' }, h('b', {}, 'Cole no mediamtx.yml e reinicie o MediaMTX:')),
    E.ipYml,
    h('div', { class: 'bar', style: 'margin:6px 0' },
      h('button', { class: 'btn sm', onclick: (e) => { navigator.clipboard.writeText(CAM.N.trechoMediamtx(dados())).then(() => { e.target.textContent = '✓ copiado'; setTimeout(() => { e.target.textContent = 'Copiar trecho'; }, 1400); }).catch(() => toast('O navegador não deixou copiar.')); } }, 'Copiar trecho')),
    h('div', { class: 'small mut' }, 'Câmera em H.265 (HEVC) não toca no WebRTC do navegador: use o stream H.264 (o «substream» costuma ser).'),
    h('label', { class: 'camt-whep' }, h('span', { class: 'small' }, 'Endereço WHEP'), E.ipWhep), E.ipAviso,
    h('div', { class: 'bar', style: 'margin:6px 0 0' }, E.ipBtn));
  return det;
}
async function camConectarIp() {
  const N = await camNucleo(); const E = CAM.el;
  const w = N.lerWhep(E.ipWhep.value);
  if (!w.ok) { camMsg(w.erro, 'no'); return; }
  camPararAuto(); ++CAM.abrindo;
  N.fecharStream(CAM.stream); CAM.stream = null;
  E.video.srcObject = null; E.vazio.hidden = false; E.vazio.textContent = 'Conectando ao MediaMTX…';
  E.ipBtn.disabled = true; camMsg('Conectando ao MediaMTX…');
  try {
    const { StreamSource } = await import('/js/camera/stream.js');
    const s = new StreamSource();
    await s.connect(w.cfg);
    CAM.ip = s;
    E.video.srcObject = s.video.srcObject; await E.video.play().catch(() => {});
    E.vazio.hidden = true;
    CAM.atual = { ip: true, rotulo: `${w.cfg.path} · ${w.url}`, tipo: 'usb' };
    CAM.espelhar = false; E.esp.checked = false; E.palco.classList.remove('esp');
    camMsg('Câmera Wi-Fi / IP ao vivo.', 'on');
  } catch (e) {
    CAM.atual = null; E.vazio.textContent = 'Sem câmera.';
    camMsg(e.message, 'no');
  } finally {
    E.ipBtn.disabled = false; E.ipBtn.textContent = CAM.ip ? 'Desconectar' : '📶 Conectar';
    camInfo(); camListar();
  }
}
function camLigarIpParar() {
  camSoltar(); CAM.el.ipBtn.textContent = '📶 Conectar'; CAM.el.vazio.hidden = false; CAM.el.vazio.textContent = 'Escolha uma câmera ao lado.'; camListar();
}

// ------------------------------------------------------------------ fotos
/** Quadro atual → JPEG ≤ 2048 px (MAX_LADO, a mesma regra dos prints), qualidade 0,9; espelhado se a tela está. */
function camQuadro() {
  const v = CAM.el.video; const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return Promise.resolve(null);
  const k = Math.min(1, MAX_LADO / Math.max(vw, vh));
  const w = Math.round(vw * k), hh = Math.round(vh * k);
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d');
  if (CAM.espelhar) { x.translate(w, 0); x.scale(-1, 1); }
  x.drawImage(v, 0, 0, w, hh);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.9));
}
async function camCapturar(silencioso) {
  if (!CAM.atual || !CAM.el.vazio.hidden || !CAM.el.video.videoWidth) { if (!silencioso) camMsg('Nenhuma câmera ao vivo.', 'no'); return false; }
  const blob = await camQuadro();
  if (!blob) { camMsg('A câmera ainda não entregou quadro.', 'no'); return false; }
  const sha = await sha256(blob);
  if (sha && CAM.vistos.has(sha)) { CAM.repetidos++; camContar(); if (!silencioso) camMsg('Foto idêntica a uma que já está no projeto — pulada.', 'no'); return false; }
  if (sha) CAM.vistos.add(sha);
  const agora = new Date(); const pid = CAM.pid; const grupo = camGrupo();
  const n = CAM.enviados + CAM.falhas + 1;
  const rot = CAM.atual.rotulo;
  const item = { blob, nome: `camera-${marcaArquivo(agora)}-${n}.jpg`,
    meta: { fonte: 'print', origem: `câmera ${rot} · ${carimbo(agora)}`.slice(0, 200), capturado: agora.toISOString(), arquivo: `camera-${marcaArquivo(agora)}-${n}.jpg`,
      licenca: 'própria — foto tirada pela câmera de quem enviou', sha256_original: sha } };
  const fig = h('figure', { title: item.meta.origem + (grupo ? ` · ${grupo.toUpperCase()}` : '') }, h('img', { src: URL.createObjectURL(blob), alt: '' }),
    h('figcaption', {}, agora.toLocaleTimeString('pt-BR') + (grupo ? (grupo === 'ruim' ? ' ✖' : ' ✔') : '')));
  CAM.el.tira.prepend(fig);
  while (CAM.el.tira.children.length > 60) { const u = CAM.el.tira.lastChild.querySelector('img'); URL.revokeObjectURL(u.src); CAM.el.tira.lastChild.remove(); }
  CAM.el.palco.classList.remove('flash'); void CAM.el.palco.offsetWidth; CAM.el.palco.classList.add('flash');
  // envio em fila, um por vez, para o projeto aberto no momento da captura
  CAM.envio = CAM.envio.then(() => enviarItens([item], grupo, pid)).then((r) => {
    if (r.ok) CAM.enviados++; else if (r.repetidas) { CAM.repetidos++; fig.classList.add('err'); } else { CAM.falhas++; fig.classList.add('err'); fig.title += ' · ' + (r.erros[0] || 'falhou'); }
    camContar();
  });
  if (!silencioso) camMsg('Foto enviada ao projeto' + (grupo ? ` como ${grupo.toUpperCase()}` : '') + '.', 'on');
  return true;
}
function camContar() {
  CAM.el.cont.textContent = `Nesta sessão: ${CAM.enviados} foto(s) no projeto` + (CAM.repetidos ? ` · ${CAM.repetidos} repetida(s)` : '') + (CAM.falhas ? ` · ${CAM.falhas} falha(s)` : '') + '.';
}
function camIniciarAuto() {
  if (!CAM.atual) { camMsg('Nenhuma câmera ao vivo.', 'no'); return; }
  const passo = Math.max(0.5, Math.min(600, +CAM.el.n.value || 2)), max = Math.max(1, Math.min(500, parseInt(CAM.el.m.value, 10) || 20));
  CAM.auto = { feitos: 0, max, passo };
  const tique = async () => {
    const A = CAM.auto; if (!A) return;
    if (await camCapturar(true)) A.feitos++;
    CAM.el.auto.textContent = `⏹ Parar (${A.feitos}/${A.max})`;
    if (A.feitos >= A.max) camPararAuto(`Pronto: ${A.feitos} foto(s).`);
  };
  CAM.el.auto.textContent = `⏹ Parar (0/${max})`;
  camMsg(`Capturando a cada ${String(passo).replace('.', ',')} s, até ${max} foto(s). Mude a peça ou o ângulo entre as fotos.`, 'on');
  clearInterval(CAM.timer);
  CAM.timer = setInterval(tique, passo * 1000);
  tique();
}
function camPararAuto(msg) {
  clearInterval(CAM.timer); CAM.timer = null;
  const tinha = !!CAM.auto; CAM.auto = null;
  if (CAM.el.auto) CAM.el.auto.textContent = '⏱ Capturar a cada N s';
  if (tinha && msg) camMsg(msg, 'on');
}
