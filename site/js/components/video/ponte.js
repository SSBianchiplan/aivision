/**
 * components/video/ponte.js — a porta de entrada do GPlanSiS|Vídeo para o
 * resto do app. Pequeno de propósito: é importado pela barra de vídeo
 * (VideoControls.js) e não pode puxar o editor (que é carregado sob demanda).
 *
 * ABRIR O EDITOR
 *   abrirEditorVideo()                       tela inicial (abrir arquivo, fonte, gravação…)
 *   abrirEditorVideo({ blob, nome })         já abre esta mídia
 *   abrirEditorVideo({ url, nome })          idem, a partir de um object URL (blob:)
 *   abrirEditorVideo({ url, nome, marcadores })  idem, com marcadores (µs da mídia) já postos —
 *                                            o Resumo de vídeo por eventos (CV-66) usa
 *   window.dispatchEvent(new CustomEvent('aiv:editar-video', { detail: { blob, nome } }))
 *                                            o mesmo, sem importar nada
 *
 * DEPOIS DE ABRIR (onda 2-d, painel Aplicações). O pedido pode trazer
 *   depois({ v, clipes, marcadores, recorte, novoId }) → { marcadores?, clipes?, recorte?, irPara?, rotulo? }
 * (tempos em µs da TIMELINE): marcadores de corte de cena/capítulos, clipes dos
 * melhores trechos, reenquadramento da câmera de jogo, ou ir ao instante de uma
 * busca. Com o editor já aberto e a MESMA mídia, nada é reaberto: só o `depois`
 * é aplicado (com desfazer). O evento 'aiv:video-pedido' avisa o editor aberto.
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
  // editor já aberto: ele atende o pedido na hora (onda 2-d)
  window.dispatchEvent(new CustomEvent('aiv:video-pedido'));
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
