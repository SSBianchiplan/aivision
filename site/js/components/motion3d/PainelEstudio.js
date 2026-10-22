/**
 * components/motion3d/PainelEstudio.js — o painel "Estúdio" do Motion 3D Studio v2:
 *   Câmera virtual   livre · seguir o ator · close no rosto · plano americano · plano geral ·
 *                    travelling lateral · órbita automática
 *   Fundo            tema · cor · gradiente (céu) · imagem (2:1 vira panorama) · HDRI (.hdr) · chroma
 *   Gravar           o viewport 3D em vídeo (MP4/WebM pelo MediaRecorder) e PNG do quadro
 *   OBS              janela limpa: só o viewport, sem interface (Esc volta) — capture a janela no
 *                    OBS; com fundo chroma, aplique o Chroma Key do OBS
 *   VMC / OSC        saída ao vivo para Unity, Unreal, Blender, VSeeFace… por uma ponte
 *                    WebSocket → UDP (local: ponte_vmc.py; remota: pelo aivision-motion)
 *   Várias pessoas   até 4 atores, cada um com o seu avatar
 */
import { html, useState, useEffect, useRef } from '../../vendor.js';
import { gravarAoVivo } from './gravador.js';
import { PORTA_PONTE, PORTA_VMC, criarCanalRemoto } from './vmc.js';

const SEGUIR = [['livre', 'Livre (órbita)'], ['seguir', 'Seguir o ator'], ['rosto', 'Close no rosto'], ['americano', 'Plano americano'], ['geral', 'Plano geral'], ['lateral', 'Travelling lateral'], ['orbita', 'Órbita automática']];
const baixar = (blob, nome) => { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 3000); };

export function PainelEstudio({ ctl }) {
  const [fundo, setFundo] = useState({ tipo: 'tema', cor: '#202830' });
  const [grav, setGrav] = useState(null);
  const [vmcUrl, setVmcUrl] = useState(`ws://127.0.0.1:${PORTA_PONTE}`);
  const [remoto, setRemoto] = useState(null);
  const [, setT] = useState(0);
  const inImg = useRef(null), inHdr = useRef(null);
  useEffect(() => { const v = ctl.vmc; const f = () => setT((n) => n + 1); v.aoMudar = f; const id = setInterval(f, 1000); return () => { clearInterval(id); v.aoMudar = () => {}; }; }, [ctl.vmc]);

  const aplicarFundo = async (cfg) => {
    setFundo(cfg);
    const c = ctl.cena();
    if (!c) { ctl.setMsg('Abra a vista 3D primeiro.'); return; }
    try { await c.definirFundo(cfg); } catch (e) { ctl.setMsg(`Fundo: ${e.message}`); }
    if (cfg.tipo === 'chroma') ctl.setOpc({ grade: false, piso: false, com: false, cameras: false });
  };
  const gravar = (preferir) => {
    const c = ctl.cena();
    if (!c) { ctl.setMsg('Abra a vista 3D para gravar o viewport.'); return; }
    if (grav) {
      grav.parar().then((r) => { c.continuo = false; baixar(r.blob, `viewport3d_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${r.ext}`); ctl.setMsg(`Viewport gravado: ${r.segundos.toFixed(1)} s · ${r.ext.toUpperCase()} · ${(r.blob.size / 1e6).toFixed(1)} MB.`); });
      setGrav(null); return;
    }
    try { c.continuo = true; setGrav(gravarAoVivo(c.canvas, 30, 10e6, preferir)); ctl.setMsg('● Gravando o viewport 3D (o que aparece nele: avatar, câmera virtual, fundo).'); } catch (e) { c.continuo = false; ctl.setMsg(e.message); }
  };
  const v = ctl.vmc;
  const pedirRemoto = async () => {
    try { const r = await criarCanalRemoto(); setRemoto(r); setVmcUrl(r.urlEmissor); ctl.setMsg('Canal de repasse criado: rode a ponte em modo --remoto no computador do 3D (comando abaixo).'); }
    catch (e) { ctl.setMsg(`Repasse remoto: ${e.message}`); }
  };
  return html`
    <div class="m3d-estudio">
      <div class="m3d-sub">Câmera virtual</div>
      <div class="m3d-chips" role="group" aria-label="Câmera virtual">
        ${SEGUIR.map(([k, r]) => html`<button key=${k} class=${`m3d-btn mini ${ctl.seguir === k ? 'on' : ''}`} aria-pressed=${ctl.seguir === k} onClick=${() => ctl.setSeguir(k)}>${r}</button>`)}
      </div>
      <div class="m3d-sub">Fundo e cenário</div>
      <div class="m3d-linha">
        <label class="m3d-campo">Tipo <select value=${fundo.tipo} onChange=${(e) => { const t = e.target.value; if (t === 'imagem') inImg.current.click(); else if (t === 'hdri') inHdr.current.click(); else aplicarFundo({ ...fundo, tipo: t, cor: t === 'chroma' ? '#00b140' : fundo.cor }); }}>
          <option value="tema">Do tema</option><option value="cor">Cor sólida</option><option value="gradiente">Gradiente (céu)</option><option value="imagem">Imagem…</option><option value="hdri">HDRI (.hdr)…</option><option value="chroma">Chroma (verde/azul)</option>
        </select></label>
        ${(fundo.tipo === 'cor' || fundo.tipo === 'chroma' || fundo.tipo === 'gradiente') && html`<label class="m3d-campo">Cor <input type="color" value=${fundo.cor} onChange=${(e) => aplicarFundo({ ...fundo, cor: e.target.value })} /></label>`}
        ${fundo.tipo === 'chroma' && html`<button class="m3d-btn mini" onClick=${() => aplicarFundo({ tipo: 'chroma', cor: fundo.cor === '#0047bb' ? '#00b140' : '#0047bb' })}>${fundo.cor === '#0047bb' ? 'Verde' : 'Azul'}</button>`}
        <input ref=${inImg} type="file" hidden accept="image/*" onChange=${async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const b = await createImageBitmap(f, { imageOrientation: 'flipY' }); aplicarFundo({ tipo: 'imagem', imagem: b, nome: f.name }); } catch (er) { ctl.setMsg(er.message); } }} />
        <input ref=${inHdr} type="file" hidden accept=".hdr" onChange=${async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; aplicarFundo({ tipo: 'hdri', hdr: await f.arrayBuffer(), nome: f.name }); }} />
      </div>
      <p class="m3d-dica">Imagem 2:1 vira panorama 360° e ilumina o modelo; HDRI .hdr (ex.: Poly Haven, CC0) idem. Nada é enviado.</p>
      <div class="m3d-sub">Gravar o viewport 3D</div>
      <div class="m3d-linha">
        <button class=${`m3d-btn m3d-rec ${grav ? 'gravando' : ''}`} onClick=${() => gravar(null)}>${grav ? '■ Parar e baixar' : '● Gravar (MP4/WebM)'}</button>
        ${!grav && html`<button class="m3d-btn" onClick=${() => gravar('webm')}>● WebM</button>`}
        <button class="m3d-btn" onClick=${() => { const c = ctl.cena(); if (!c) return; fetch(c.png()).then((r) => r.blob()).then((b) => baixar(b, 'viewport3d.png')); }}>PNG do quadro</button>
      </div>
      <div class="m3d-sub">Transmissão (OBS)</div>
      <div class="m3d-linha">
        <button class="m3d-btn acento" onClick=${() => ctl.setLimpo(true)}>Janela limpa</button>
        <span class="m3d-dica">Só o viewport, sem interface; Esc volta. No OBS: Captura de janela (ou de tela) + Chroma Key se o fundo for chroma.</span>
      </div>
      <div class="m3d-sub">Saída VMC / OSC (Unity · Unreal · Blender · VSeeFace)</div>
      <div class="m3d-linha">
        <label class="m3d-campo grow">Ponte <input type="text" value=${vmcUrl} onChange=${(e) => setVmcUrl(e.target.value)} aria-label="Endereço WebSocket da ponte VMC" /></label>
        ${v.estado === 'ligado' || v.estado === 'conectando'
          ? html`<button class="m3d-btn" onClick=${() => v.desconectar()}>Desligar</button>`
          : html`<button class="m3d-btn acento" onClick=${() => v.conectar(vmcUrl)}>Ligar</button>`}
        <label class="m3d-campo">Hz <select value=${String(v.hz)} onChange=${(e) => { v.hz = +e.target.value; setT((n) => n + 1); }}><option value="15">15</option><option value="30">30</option><option value="60">60</option></select></label>
      </div>
      <p class="m3d-dica">Estado: <b>${{ desligado: 'desligado', conectando: 'conectando…', ligado: 'enviando', erro: 'erro' }[v.estado]}</b>${v.enviados ? ` · ${v.enviados} quadros · ${(v.bytes / 1024).toFixed(0)} KB` : ''}${v.erro ? ` · ${v.erro}` : ''}</p>
      <details class="m3d-det-vmc"><summary>Como ligar</summary>
        <ol class="m3d-guia">
          <li>Neste computador, rode a ponte (Python 3, sem instalar nada): <code>python3 ponte_vmc.py</code> — <a href="codigo-fonte/ponte_vmc.py" download>baixar ponte_vmc.py</a>. Ela escuta <code>ws://127.0.0.1:${PORTA_PONTE}</code> e solta UDP em <code>127.0.0.1:${PORTA_VMC}</code> (porta padrão do receptor VMC).</li>
          <li>No 3D: Unity com EVMC4U, Unreal com VMC4UE, Blender com VMC Link, ou VSeeFace/VNyan recebendo VMC na porta ${PORTA_VMC}.</li>
          <li>Ligar aqui. O Chrome pode pedir permissão de "rede local": aceite (o pacote só vai para este computador).</li>
          <li>Studio em OUTRO aparelho (celular): <button class="m3d-btn mini" onClick=${pedirRemoto}>criar canal de repasse</button> e rode no computador do 3D: ${remoto ? html`<code class="m3d-cmd">python3 ponte_vmc.py --remoto ${remoto.urlPonte} --token ${remoto.token}</code>` : html`<em>(o comando aparece aqui)</em>`}. O servidor só repassa os pacotes, com a sua sessão; o canal expira em ${remoto ? remoto.expira_em_h : 12} h.</li>
        </ol>
        <p class="m3d-dica">Ossos no padrão HumanBodyBones (pose local normalizada, repouso em T) e BlendShapes do VRM 0.x (Blink_L/R, A, I, U, E, O, Joy). Coordenadas convertidas para o Unity (posição (−x, y, z), rotação (x, −y, −z, w)).</p>
      </details>
      <div class="m3d-sub">Várias pessoas</div>
      <div class="m3d-linha">
        <label class="m3d-campo">Atores <select value=${String(ctl.pessoas)} onChange=${(e) => ctl.setPessoas(+e.target.value)}>${[1, 2, 3, 4].map((n) => html`<option key=${n} value=${n}>${n}</option>`)}</select></label>
        <span class="m3d-dica">Cada pessoa a mais custa uma passada do BlazePose por quadro (YOLOX acha, um rastreador por pessoa). Gravação e VMC usam o ator principal (o maior).</span>
      </div>
    </div>`;
}

export default PainelEstudio;
