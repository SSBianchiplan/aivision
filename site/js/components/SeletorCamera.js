/**
 * SeletorCamera.js — popover «📷 Abrir câmera» do painel Fonte.
 *
 * Lista as câmeras agrupadas por tipo (integrada, USB, celular-como-webcam,
 * virtual, infravermelha; no celular, frontal e traseira), com prévia ao vivo
 * ao passar o mouse ou tocar, a resolução e os fps que a câmera entregou de
 * fato, e a lembrança da última escolhida. Mais duas entradas que não são
 * «videoinput»: Câmera Wi-Fi / IP (MediaMTX → WHEP) e Bluetooth (explicação —
 * não há botão que finja funcionar).
 *
 * A lógica está em camera/seletor.js, compartilhada com o Treinar.
 *
 * Abre num portal no <body>, preso ao botão que o abriu: dentro do painel ele
 * seria cortado pela rolagem do corpo do painel. Em tela estreita vira folha
 * presa embaixo.
 */

import { html, ReactDOM, useState, useEffect, useRef, useLayoutEffect } from '../vendor.js';
import * as sel from '../camera/seletor.js';

/* folha de estilo própria, injetada uma vez (mesmo ?v= do app.css) */
let cssPosto = false;
function injetarCss() {
  if (cssPosto || typeof document === 'undefined') return;
  cssPosto = true;
  if (document.querySelector('link[data-aiv-camsel]')) return;
  const base = document.querySelector('link[href*="css/app.css"]');
  const v = base ? (/\?v=([^"&]+)/.exec(base.getAttribute('href')) || [])[1] : '';
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = 'css/camera-seletor.css' + (v ? '?v=' + v : ''); l.dataset.aivCamsel = '1';
  document.head.appendChild(l);
}
injetarCss();

/** Ícone + nome do tipo de uma câmera (para mostrar o dispositivo atual no painel). */
export function tipoDaCamera(rotulo) {
  return sel.TIPOS[sel.classificar(rotulo)] || sel.TIPOS.usb;
}

/** Posição do popover: abaixo do botão, sem sair da janela. null = folha embaixo (celular). */
function posicao(ancora) {
  const W = window.innerWidth, H = window.innerHeight;
  if (W < 640 || !ancora) return null;
  const r = ancora.getBoundingClientRect();
  const larg = Math.min(420, W - 16);
  const left = Math.max(8, Math.min(r.left, W - larg - 8));
  let top = r.bottom + 6;
  if (H - top < 380) top = Math.max(8, H - 8 - Math.min(620, H - 16));
  return { left, top, width: larg, maxHeight: H - top - 8 };
}

export function SeletorCamera({ ancora, modoInicial = 'lista', atualId = null, cameraLigada = false,
                                onEscolher, onFacing, onConectarIp, ipAtivo = false, onDesconectarIp, onFechar }) {
  const [modo, setModo] = useState(modoInicial);     // lista | ip | bt
  const [pos, setPos] = useState(() => posicao(ancora && ancora.current));
  const ref = useRef(null);
  const movel = sel.ehAparelhoMovel();

  useLayoutEffect(() => {
    const f = () => setPos(posicao(ancora && ancora.current));
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [ancora]);

  // trocar de modo volta ao topo (o modo Wi-Fi / IP é longo e deixava a lista rolada para baixo)
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [modo]);

  // Esc fecha; clique fora fecha (o próprio botão que abriu não conta: ele alterna)
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onFechar(); } };
    const m = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (ancora && ancora.current && ancora.current.contains(e.target)) return;
      onFechar();
    };
    document.addEventListener('keydown', k, true);
    document.addEventListener('pointerdown', m, true);
    return () => { document.removeEventListener('keydown', k, true); document.removeEventListener('pointerdown', m, true); };
  }, [onFechar, ancora]);

  const estilo = pos ? { left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px', maxHeight: pos.maxHeight + 'px' } : undefined;
  return ReactDOM.createPortal(html`
    <div class="camsel ${pos ? '' : 'folha'}" ref=${ref} style=${estilo} role="dialog" aria-label="Escolher câmera">
      <div class="camsel-cab">
        <b>${modo === 'ip' ? `${sel.ICONE_IP} Câmera Wi-Fi / IP` : modo === 'bt' ? 'Bluetooth' : '📷 Escolher câmera'}</b>
        ${modo !== 'lista' && html`<button class="btn tiny" onClick=${() => setModo('lista')}>← Câmeras</button>`}
        <button class="btn tiny camsel-x" onClick=${onFechar} aria-label="Fechar" title="Fechar (Esc)">✕</button>
      </div>
      ${modo === 'lista' && html`<${ListaCameras} atualId=${atualId} cameraLigada=${cameraLigada} movel=${movel}
          onEscolher=${onEscolher} onFacing=${onFacing} onFechar=${onFechar} onModo=${setModo} />`}
      ${modo === 'ip' && html`<${CameraIp} onConectar=${onConectarIp} ativo=${ipAtivo}
          onDesconectar=${onDesconectarIp} onFechar=${onFechar} />`}
      ${modo === 'bt' && html`<${ExplicaBluetooth} onModo=${setModo} />`}
    </div>
  `, document.body);
}

// =============================================================== lista + prévia

function ListaCameras({ atualId, cameraLigada, movel, onEscolher, onFacing, onFechar, onModo }) {
  const [lista, setLista] = useState({ cameras: [], grupos: [], semPermissao: false, carregando: true });
  const [alvo, setAlvo] = useState(null);           // câmera em prévia
  const [prev, setPrev] = useState(null);           // { settings, caps } da prévia
  const [erros, setErros] = useState({});           // id → mensagem (ex.: em uso por outro app)
  const [msg, setMsg] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const video = useRef(null);
  const stream = useRef(null);
  const pedido = useRef(0);
  const hover = useRef(null);

  const atualizar = async () => {
    const l = await sel.listarCameras();
    setLista({ ...l, carregando: false });
    return l;
  };

  useEffect(() => {
    atualizar().then((l) => {
      // abre com a prévia da câmera em uso, ou da última escolhida
      const c = l.cameras.find((x) => atualId && x.id === atualId) || sel.acharUltima(l.cameras);
      if (c && !l.semPermissao) previa(c);
    });
    const off = sel.ouvirMudancas(async () => {
      const l = await atualizar();
      setMsg({ ok: true, t: `Lista atualizada: ${l.cameras.length} câmera(s).` });
    });
    return () => { off(); clearTimeout(hover.current); fechar(); };
  }, []);

  const fechar = () => {
    pedido.current++;
    sel.fecharStream(stream.current);
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };

  async function previa(c) {
    if (!c || !c.id) return;
    const n = ++pedido.current;
    sel.fecharStream(stream.current); stream.current = null;
    setAlvo(c); setPrev(null);
    try {
      const r = await sel.abrirCamera({ id: c.id }, { width: 640, height: 360 });
      if (n !== pedido.current) { sel.fecharStream(r.stream); return; }
      stream.current = r.stream;
      if (video.current) { video.current.srcObject = r.stream; video.current.play().catch(() => {}); }
      const tr = r.stream.getVideoTracks()[0];
      let caps = null; try { caps = tr.getCapabilities ? tr.getCapabilities() : null; } catch (_) { caps = null; }
      setPrev({ settings: r.settings, caps });
      setErros((e) => { const x = { ...e }; delete x[c.id]; return x; });
    } catch (err) {
      if (n !== pedido.current) return;
      setErros((e) => ({ ...e, [c.id]: err.message }));
    }
  }

  const passar = (c) => { clearTimeout(hover.current); hover.current = setTimeout(() => { if (!alvo || alvo.id !== c.id) previa(c); }, 350); };

  const usar = async (c) => {
    setOcupado(true); setMsg(null);
    fechar();                                   // libera a câmera antes: no Windows, duas aberturas da mesma falham
    const erro = await onEscolher(c);
    setOcupado(false);
    if (erro) { setMsg({ ok: false, t: erro }); setErros((e) => ({ ...e, [c.id]: erro })); return; }
    sel.lembrarCamera({ id: c.id, rotulo: c.rotulo });
    onFechar();
  };

  const permitir = async () => {
    setMsg(null);
    try { await sel.pedirPermissao(); const l = await atualizar(); if (l.cameras[0]) previa(sel.acharUltima(l.cameras) || l.cameras[0]); }
    catch (e) { setMsg({ ok: false, t: e.message }); }
  };

  const facing = async (f) => {
    setOcupado(true); setMsg(null); fechar();
    const erro = await onFacing(f);
    setOcupado(false);
    if (erro) { setMsg({ ok: false, t: erro }); return; }
    sel.lembrarCamera({ facing: f });
    onFechar();
  };

  // no celular, só as câmeras do próprio aparelho (virtuais e IR não existem lá; se aparecerem, confundem)
  const grupos = movel ? lista.grupos.filter((g) => g.tipo !== 'virtual' && g.tipo !== 'ir') : lista.grupos;
  const ultima = sel.ultimaCamera();
  const s = prev && prev.settings;
  const cp = prev && prev.caps;

  return html`
    ${movel && html`
      <div class="camsel-facing">
        <button class="btn accent" disabled=${ocupado} onClick=${() => facing('environment')}>📷 Traseira</button>
        <button class="btn" disabled=${ocupado} onClick=${() => facing('user')}>🤳 Frontal</button>
      </div>
      <p class="hint tight">No celular, «traseira» deixa o sistema escolher a lente principal — é o jeito certo de pedir.</p>
    `}

    <div class="camsel-prev">
      <video ref=${video} muted playsinline autoplay></video>
      ${!prev && html`<span class="camsel-prev-v">${
        alvo && erros[alvo.id] ? '⚠' : alvo ? 'abrindo prévia…' : lista.semPermissao ? 'permita a câmera para ver a prévia' : 'passe o mouse numa câmera'}</span>`}
      ${alvo && html`<div class="camsel-prev-l">
        <b>${(sel.TIPOS[alvo.tipo] || sel.TIPOS.usb).icone} ${alvo.rotulo}</b>
        <span>${s ? 'prévia ' + sel.textoSettings(s) : ''}${cp && cp.width && cp.width.max
          ? ` · máx. ${cp.width.max}×${cp.height.max}${cp.frameRate && cp.frameRate.max ? ' · ' + Math.round(cp.frameRate.max) + ' fps' : ''}` : ''}</span>
      </div>`}
    </div>

    ${lista.semPermissao && html`
      <div class="camsel-aviso">
        O navegador só mostra o nome das câmeras depois da permissão.
        <button class="btn tiny accent" onClick=${permitir}>Permitir câmera</button>
      </div>
    `}
    ${!lista.carregando && !lista.cameras.length && html`
      <div class="camsel-aviso">Nenhuma câmera encontrada. Plugue uma webcam USB, ligue o DroidCam/Camo
        ou aproxime o iPhone do Mac (Continuity Camera) — a lista atualiza sozinha.</div>
    `}

    <div class="camsel-lista" role="listbox" aria-label="Câmeras">
      ${grupos.map((g) => html`
        <div class="camsel-g" key=${g.tipo}>
          <div class="camsel-gt">${g.icone} ${g.nome}</div>
          ${g.itens.map((c) => {
            const em = atualId && c.id === atualId && cameraLigada;
            const ult = !em && ultima && ((ultima.id && ultima.id === c.id) || (!ultima.id && ultima.rotulo === c.rotulo));
            return html`
              <div key=${c.id || c.rotulo} class="camsel-i ${alvo && alvo.id === c.id ? 'sel' : ''} ${erros[c.id] ? 'erro' : ''}"
                   role="option" aria-selected=${Boolean(alvo && alvo.id === c.id)} tabindex="0"
                   onMouseEnter=${() => passar(c)} onFocus=${() => passar(c)}
                   onClick=${() => previa(c)}
                   onDblClick=${() => usar(c)}
                   onKeyDown=${(e) => { if (e.key === 'Enter') usar(c); }}>
                <span class="camsel-ic" aria-hidden="true">${g.icone}</span>
                <span class="camsel-n">
                  <b>${c.rotulo}</b>
                  ${em && html`<em class="camsel-tag ok">em uso aqui</em>`}
                  ${ult && html`<em class="camsel-tag">última usada</em>`}
                  ${c.tipo === 'ir' && html`<em class="camsel-tag warn">imagem preta fora do Windows Hello</em>`}
                  ${erros[c.id] && html`<small class="camsel-err">${erros[c.id]}</small>`}
                </span>
                <button class="btn tiny ${alvo && alvo.id === c.id ? 'accent' : ''}" disabled=${ocupado || !c.id}
                        onClick=${(e) => { e.stopPropagation(); usar(c); }}>${em ? 'Reabrir' : 'Usar'}</button>
              </div>
            `;
          })}
        </div>
      `)}

      <div class="camsel-g">
        <div class="camsel-gt">Outras fontes</div>
        <button class="camsel-i camsel-mais" onClick=${() => onModo('ip')}>
          <span class="camsel-ic" aria-hidden="true">${sel.ICONE_IP}</span>
          <span class="camsel-n"><b>Câmera Wi-Fi / IP</b><small>RTSP / ONVIF pelo MediaMTX na sua máquina</small></span>
          <span class="camsel-seta" aria-hidden="true">›</span>
        </button>
        <button class="camsel-i camsel-mais" onClick=${() => onModo('bt')}>
          <span class="camsel-ic bt" aria-hidden="true">${sel.ICONE_BT}</span>
          <span class="camsel-n"><b>Bluetooth</b><small>por que não existe câmera Bluetooth no navegador</small></span>
          <span class="camsel-seta" aria-hidden="true">›</span>
        </button>
      </div>
    </div>

    ${msg && html`<div class="camsel-msg ${msg.ok ? 'ok' : 'no'}">${msg.t}</div>`}

    <div class="camsel-rodape">
      <button class="btn tiny" onClick=${async () => { const l = await atualizar(); setMsg({ ok: true, t: `${l.cameras.length} câmera(s) encontrada(s).` }); }}>↻ Atualizar lista</button>
      ${!lista.semPermissao && lista.cameras.length > 0 && html`<span class="camsel-dica">Passe o mouse para ver · duplo clique ou «Usar» para ligar</span>`}
    </div>
  `;
}

// =============================================================== Wi-Fi / IP

function CameraIp({ onConectar, ativo, onDesconectar, onFechar }) {
  const [c, setC] = useState(() => sel.lerConfigIp());
  // usuário e senha: só na memória desta janela; nunca vão para o storage
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const mudar = (k, v) => setC((x) => {
    const n = { ...x, [k]: v };
    if (k === 'modelo') {
      const m = sel.MODELOS_RTSP.find((y) => y.id === v);
      if (m) { n.caminho = m.caminho; n.porta = m.porta; }
    }
    if (k === 'nome' && (!x.whep || x.whep === sel.whepPadrao(x.nome))) n.whep = sel.whepPadrao(v);
    sel.salvarConfigIp(n);
    return n;
  });

  const dados = { ...c, usuario, senha };
  const trechoTela = sel.trechoMediamtx(dados, { ocultarSenha: !ver });
  const whep = c.whep || sel.whepPadrao(c.nome);
  const bloqueado = sel.whepBloqueado(whep);
  const modelo = sel.MODELOS_RTSP.find((m) => m.id === c.modelo) || sel.MODELOS_RTSP[0];

  const copiar = () => {
    navigator.clipboard.writeText(sel.trechoMediamtx(dados))
      .then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1400); })
      .catch(() => setMsg({ ok: false, t: 'O navegador não deixou copiar — selecione o texto e copie à mão.' }));
  };
  const baixar = () => {
    const b = new Blob([sel.trechoMediamtx(dados)], { type: 'text/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b); a.download = `mediamtx-trecho-${sel.nomeCaminho(c.nome)}.yml`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const conectar = async () => {
    const w = sel.lerWhep(whep);
    if (!w.ok) { setMsg({ ok: false, t: w.erro }); return; }
    setBusy(true); setMsg({ ok: true, t: 'Conectando ao MediaMTX…' });
    const erro = await onConectar(w.cfg);
    setBusy(false);
    if (erro) { setMsg({ ok: false, t: erro }); return; }
    onFechar();
  };

  return html`
    <div class="camsel-ip">
      <p class="hint tight">
        O navegador não lê RTSP. O <b>MediaMTX</b> (gratuito, um executável só) roda na <b>sua máquina</b>,
        busca o vídeo da câmera e entrega por WebRTC com menos de 1 s de atraso — o mesmo servidor da seção
        «Câmera externa · RTMP».
      </p>

      <div class="cfg-sub">1 · Dados da câmera</div>
      <div class="camsel-grade">
        <label class="ctl"><span class="ctl-label">Marca / tipo</span>
          <select value=${c.modelo} onChange=${(e) => mudar('modelo', e.target.value)}>
            ${sel.MODELOS_RTSP.map((m) => html`<option key=${m.id} value=${m.id}>${m.nome}</option>`)}
          </select></label>
        <label class="ctl"><span class="ctl-label">Nome no MediaMTX</span>
          <input class="txt" value=${c.nome} spellcheck="false" onInput=${(e) => mudar('nome', e.target.value)} /></label>
        <label class="ctl"><span class="ctl-label">IP da câmera</span>
          <input class="txt" value=${c.ip} placeholder="192.168.0.50" inputmode="decimal" spellcheck="false"
                 autocapitalize="off" onInput=${(e) => mudar('ip', e.target.value.trim())} /></label>
        <label class="ctl"><span class="ctl-label">Porta</span>
          <input class="txt" value=${c.porta} inputmode="numeric" onInput=${(e) => mudar('porta', parseInt(e.target.value, 10) || '')} /></label>
        <label class="ctl camsel-larga"><span class="ctl-label">Caminho ${modelo.http ? 'HTTP' : 'RTSP'}</span>
          <input class="txt" value=${c.caminho} spellcheck="false" autocapitalize="off" onInput=${(e) => mudar('caminho', e.target.value)} /></label>
        <label class="ctl"><span class="ctl-label">Usuário</span>
          <input class="txt" value=${usuario} autocomplete="off" spellcheck="false" autocapitalize="off"
                 onInput=${(e) => setUsuario(e.target.value)} /></label>
        <label class="ctl"><span class="ctl-label">Senha</span>
          <input class="txt" type="password" value=${senha} autocomplete="new-password"
                 onInput=${(e) => setSenha(e.target.value)} /></label>
      </div>
      <p class="hint tight camsel-seg">🔒 Usuário e senha só entram no texto abaixo, aqui no navegador: não são enviados
        a nenhum servidor nosso nem guardados. Do resto, só IP, porta e caminho ficam lembrados neste aparelho.</p>
      ${modelo.http && html`<div class="camsel-aviso">${sel.TEXTO_MJPEG}</div>`}

      <div class="cfg-sub">2 · Cole no mediamtx.yml e reinicie o MediaMTX</div>
      <pre class="camsel-yml">${trechoTela}</pre>
      <div class="row">
        <button class="btn tiny" onClick=${copiar}>${copiado ? '✓ copiado' : 'Copiar trecho'}</button>
        <button class="btn tiny" onClick=${baixar}>Baixar .yml</button>
        ${senha && html`<button class="btn tiny" onClick=${() => setVer(!ver)}>${ver ? 'Ocultar senha' : 'Mostrar senha'}</button>`}
      </div>
      <p class="hint tight">
        Baixe o MediaMTX em <code>github.com/bluenviron/mediamtx/releases</code>, rode-o na pasta do
        <code>mediamtx.yml</code> e deixe a janela aberta. Câmera em <b>H.265</b> não toca no WebRTC do navegador:
        use o stream <b>H.264</b> (o «substream» da maioria das câmeras).
      </p>

      <div class="cfg-sub">3 · Conecte</div>
      <label class="ctl"><span class="ctl-label">Endereço WHEP</span>
        <input class="txt" value=${whep} spellcheck="false" autocapitalize="off" inputmode="url"
               onInput=${(e) => mudar('whep', e.target.value.trim())} /></label>
      ${bloqueado && html`<div class="camsel-aviso">${sel.TEXTO_HTTPS}</div>`}
      <div class="row">
        ${ativo
          ? html`<button class="btn danger" onClick=${() => { onDesconectar(); setMsg(null); }}>Desconectar câmera IP</button>`
          : html`<button class="btn accent" disabled=${busy} onClick=${conectar}>${busy ? 'Conectando…' : `${sel.ICONE_IP} Conectar`}</button>`}
      </div>
      ${msg && html`<div class="camsel-msg ${msg.ok ? 'ok' : 'no'}">${msg.t}</div>`}
    </div>
  `;
}

// =============================================================== Bluetooth

function ExplicaBluetooth({ onModo }) {
  return html`
    <div class="camsel-bt">
      <p>${sel.TEXTO_BLUETOOTH}</p>
      <ul>
        <li><b>Vídeo pelo Wi-Fi</b> (câmeras de segurança, action cams, drones): use a entrada Wi-Fi / IP.</li>
        <li><b>Vídeo pelo cabo</b> (UVC, «webcam mode»): plugue no USB — ela entra na lista como câmera USB.</li>
        <li><b>Celular</b>: DroidCam, Camo, Iriun ou Continuity Camera (iPhone + Mac) viram webcam e aparecem na lista.</li>
      </ul>
      <div class="row">
        <button class="btn accent" onClick=${() => onModo('ip')}>${sel.ICONE_IP} Câmera Wi-Fi / IP</button>
        <button class="btn" onClick=${() => onModo('lista')}>Ver a lista de câmeras</button>
      </div>
    </div>
  `;
}
