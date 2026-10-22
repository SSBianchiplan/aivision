/**
 * camera/fonte-app.js — as AÇÕES de fonte do app, para quem não é o workspace.
 *
 * As fontes (câmera, arquivo, tela, YouTube, stream) moram no workspace.js e
 * as ações que trocam uma pela outra também (zeram estado, limpam o buffer,
 * soltam a anterior). Os Studios são telas cheias montadas pelo workspace e
 * antes não recebiam nada disso: diziam «escolha a fonte na barra do app» —
 * barra que fica POR BAIXO deles. O workspace registra aqui as ações uma vez
 * (registrarFonteApp) e o seletor compartilhado dos Studios
 * (components/studio/FonteStudio.js) usa daqui, sem prop em cadeia.
 *
 * Também vigia a câmera:
 *   - caiu por fora (desplugada, celular que se afastou, permissão revogada):
 *     CameraSource.onEnded → aviso claro e a câmera fica marcada «perdida»;
 *   - devicechange: a lista do store é atualizada e, se a perdida voltar
 *     (mesmo id ou mesmo rótulo), ela reabre sozinha com a mesma resolução.
 *
 * Sem interface: a UI é do FonteStudio (Studios) e do painel Fonte.
 */

import { store } from '../state/store.js';
import * as sel from './seletor.js';

let acoes = null;
const ouvintes = new Set();
let perdida = null;          // { id, rotulo } da câmera que caiu por fora
let desligarVigia = null;

/**
 * Chamado UMA vez pelo workspace.js, depois de criar as fontes.
 *
 * acoes = {
 *   source, camera, youtube, stream, screen,          // refs (useRef) do workspace
 *   ligarCamera(deviceId?, res?) → Promise,          // startCamera (não lança; erro vai para store.notice)
 *   pararCamera(), abrirArquivo(file), ligarTela(), pararTela(),
 *   ligarYouTube() → Promise (lança), pararYouTube(), desconectarStream(),
 *   conectarStream(cfg) → Promise (lança),
 * }
 */
export function registrarFonteApp(a) {
  acoes = a || null;
  if (desligarVigia) { desligarVigia(); desligarVigia = null; }
  if (!acoes) return;
  const cam = acoes.camera && acoes.camera.current;
  if (cam) {
    cam.onEnded = ({ id, rotulo }) => {
      perdida = { id, rotulo };
      const st = store.get();
      if (st.sourceKind === 'camera') {
        store.set({
          cameraOn: false,
          notice: `A câmera${rotulo ? ' «' + rotulo + '»' : ''} foi desconectada (cabo, celular que se afastou ou permissão retirada). ` +
                  'Ela volta sozinha quando reaparecer — ou escolha outra em «Fonte».',
        });
      }
      avisar();
    };
  }
  desligarVigia = sel.ouvirMudancas(aoMudarDispositivos);
}

async function aoMudarDispositivos() {
  if (!acoes) return;
  const cam = acoes.camera && acoes.camera.current;
  let lista = [];
  try { lista = cam ? await cam.listDevices() : []; } catch (_) { lista = []; }
  store.set({ devices: lista });
  const st = store.get();
  // a perdida voltou e ninguém escolheu outra fonte nesse meio-tempo: reabre
  if (perdida && st.sourceKind === 'camera' && !st.cameraOn) {
    const volta = lista.find((d) => perdida.id && d.id === perdida.id)
      || lista.find((d) => perdida.rotulo && d.label === perdida.rotulo);
    if (volta) {
      const rot = perdida.rotulo;
      perdida = null;
      await acoes.ligarCamera(volta.id);
      if (store.get().cameraOn) store.set({ notice: `Câmera${rot ? ' «' + rot + '»' : ''} reconectada.` });
    }
  }
  // a câmera em uso sumiu da lista sem «ended» (alguns drivers): trata como queda
  if (st.cameraOn && st.sourceKind === 'camera' && lista.length && st.deviceId && !lista.some((d) => d.id === st.deviceId) && cam && !cam.isRunning) {
    cam.stop();
    store.set({ cameraOn: false, notice: 'A câmera em uso foi desconectada. Escolha outra em «Fonte».' });
  }
  avisar();
}

export function acoesFonte() { return acoes; }

/** Câmera que caiu e está sendo esperada de volta (ou null). */
export function cameraPerdida() { return perdida; }
export function esquecerPerdida() { perdida = null; avisar(); }

/** Re-render dos seletores quando algo fora do store muda (queda, lista). */
export function ouvirFonte(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
function avisar() { for (const fn of ouvintes) { try { fn(); } catch (_) { /* ouvinte ruim */ } } }

/**
 * O que está entrando no pipeline agora, para o indicador:
 * { tipo: 'camera'|'arquivo'|'tela'|'youtube'|'ip'|'rtmp'|'nenhuma', vivo, rotulo, detalhe, erro }
 */
export function estadoFonte() {
  const st = store.get();
  const a = acoes;
  const src = a && a.source && a.source.current;
  const vivo = Boolean(src && src.element && (src.isRunning !== false));
  if (st.sourceKind === 'file') {
    const f = a && a.source && a.source.current;
    return { tipo: 'arquivo', vivo: Boolean(f && f.element), rotulo: 'Arquivo', detalhe: f && f.kind === 'image' ? 'imagem' : 'vídeo' };
  }
  if (st.sourceKind === 'screen') return { tipo: 'tela', vivo, rotulo: 'Tela', detalhe: (a && a.screen && a.screen.current && a.screen.current.rotulo) || '' };
  if (st.sourceKind === 'youtube') {
    const yt = a && a.youtube && a.youtube.current;
    return { tipo: 'youtube', vivo, rotulo: 'YouTube', detalhe: (yt && yt.titulo) || '' };
  }
  if (st.sourceKind === 'stream') {
    const cfg = a && a.stream && a.stream.current && a.stream.current.cfg;
    const ip = Boolean(cfg && cfg.origem === 'ip');
    return { tipo: ip ? 'ip' : 'rtmp', vivo, rotulo: ip ? 'Câmera Wi-Fi / IP' : 'RTMP', detalhe: (cfg && (cfg.path || cfg.whep)) || '' };
  }
  if (st.cameraOn) {
    const d = (st.devices || []).find((x) => x.id === st.deviceId);
    const cam = a && a.camera && a.camera.current;
    return { tipo: 'camera', vivo, rotulo: (d && d.label) || 'Câmera', detalhe: sel.textoSettings(cam && cam.settings) };
  }
  if (perdida) return { tipo: 'nenhuma', vivo: false, rotulo: 'Câmera desconectada', detalhe: perdida.rotulo || '', erro: true };
  return { tipo: 'nenhuma', vivo: false, rotulo: 'Sem fonte', detalhe: '' };
}

/**
 * Liga uma câmera pelo id (ou facing no celular) e devolve a mensagem de erro
 * ou null — o startCamera do workspace não lança. Vindo de câmera IP, solta a
 * sessão WebRTC antes sem pausar o pipeline (como o painel Fonte).
 */
export async function usarCamera({ id = null, facing = null, res = null } = {}) {
  if (!acoes) return 'O app ainda não terminou de abrir.';
  const st = store.get();
  if (st.sourceKind === 'stream' && acoes.desconectarStream) {
    const rodando = st.running;
    acoes.desconectarStream();
    store.set({ running: rodando });
  }
  perdida = null;
  if (facing) await acoes.ligarCamera(null, { ...(res || store.get().resolution), facing });
  else await acoes.ligarCamera(id || undefined, res || undefined);
  const depois = store.get();
  avisar();
  if (!depois.cameraOn || depois.sourceKind !== 'camera') return depois.notice || 'A câmera não abriu.';
  // a câmera que abriu de fato é a pedida? (alguns drivers devolvem outra)
  // troca a quente que falhou: a anterior segue ligada e o motivo está no notice
  if (id && depois.deviceId && depois.deviceId !== id) return depois.notice || 'O navegador abriu outra câmera no lugar da pedida.';
  if (facing) store.set({ facing, mirror: facing !== 'environment' });
  sel.lembrarCamera(facing ? { facing } : { id: depois.deviceId, rotulo: ((depois.devices || []).find((d) => d.id === depois.deviceId) || {}).label || '' });
  return null;
}
