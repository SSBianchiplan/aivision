/**
 * components/video/ponte.js — a porta de entrada do GPlanSiS|Vídeo para o
 * resto do app. Pequeno de propósito: é importado pela barra de vídeo
 * (VideoControls.js) e não pode puxar o editor (que é carregado sob demanda).
 *
 * ABRIR O EDITOR
 *   abrirEditorVideo()                       tela inicial (abrir arquivo, fonte, gravação…)
 *   abrirEditorVideo({ blob, nome })         já abre esta mídia
 *   abrirEditorVideo({ url, nome })          idem, a partir de um object URL (blob:)
 *   window.dispatchEvent(new CustomEvent('aiv:editar-video', { detail: { blob, nome } }))
 *                                            o mesmo, sem importar nada
 *
 * GRAVAÇÕES. A barra de vídeo entrega cada gravação concluída a
 * `guardarGravacao(out)`; o editor oferece "Editar a última gravação".
 *
 * QUADROS PARA O +PROJETO / TREINAR. "Exportar quadros" do editor emite
 *   window.dispatchEvent(new CustomEvent('aiv:prints', { detail: {
 *     imagens: Blob[],              // JPEG, na ordem da timeline
 *     origem: 'video',              // texto curto (o +Projeto usa como etiqueta do print)
 *     nomes: string[],              // nome sugerido de cada imagem
 *     detalhes: { midia, trecho: {t0, t1}, quadros: number[], tempos: number[] }   // µs / quadros da mídia
 *   } }))
 * O +Projeto (js/projeto/base.js) escuta esse evento e guarda as imagens
 * como prints; o Treinar as recebe por lá. O editor também oferece o ZIP
 * com os mesmos JPEG.
 */
import { store } from '../../state/store.js';

let pedido = null;
let gravacao = null;

export function abrirEditorVideo(midia) {
  pedido = midia || null;
  store.set({ studioVideo: true });
}

/** O editor pega (uma vez) a mídia pedida na abertura. */
export function tomarPedido() {
  const p = pedido;
  pedido = null;
  return p;
}

/** Última gravação feita pela barra de vídeo ({ blob, nome, segundos, ... } de cv/recorder.js). */
export function guardarGravacao(out) {
  if (out && out.blob && out.blob.size) gravacao = { blob: out.blob, nome: out.nome, segundos: out.segundos, quando: Date.now() };
}

export function ultimaGravacao() { return gravacao; }

/** Entrega quadros ao +Projeto/Treinar (evento aiv:prints) e devolve o detalhe emitido. */
export function emitirPrints(imagens, nomes, detalhes, origem = 'video') {
  const detail = { imagens, origem, nomes, detalhes };
  window.dispatchEvent(new CustomEvent('aiv:prints', { detail }));
  return detail;
}

window.addEventListener('aiv:editar-video', (e) => {
  const d = e && e.detail;
  abrirEditorVideo(d && (d.blob || d.url) ? d : null);
});
