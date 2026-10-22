/**
 * projeto/exemplos.js — "Salvar estes exemplos": as marcações de exemplo
 * desenhadas sobre o vídeo ao vivo (função projeto_exemplo, cv/marcacoes.js)
 * viram um PRINT ROTULADO no projeto ativo — o quadro atual da fonte e as
 * caixas/polígonos com as classes.
 *
 * As marcações e o print usam o mesmo espaço (0–1 da fonte inteira, sem
 * espelho e sem zoom), então a caixa vai como está; com um recorte, as
 * coordenadas passam para 0–1 do recorte. As marcações continuam no vídeo
 * (editáveis) depois de salvar; o print tem a sua cópia, editável no
 * editor do +Projeto.
 */

import { store } from '../state/store.js';
import { marcStore, AREAS } from '../cv/marcacoes.js';
import { quadroCanvas, paraBlob, origemAtual } from './captura.js';
import { ativo, adicionarPrint, classePorNome } from './base.js';

/** Marcações de exemplo visíveis no vídeo. */
export function exemplosAoVivo() {
  return marcStore.get().itens.filter((i) => i.funcao === 'projeto_exemplo' && AREAS.has(i.tipo) && i.visivel !== false);
}

/** Exemplos → caixas do print, recortadas para `area` (0–1 da fonte). */
export function caixasDosExemplos(area = null, itens = exemplosAoVivo()) {
  const p = ativo();
  const a = area || { x1: 0, y1: 0, x2: 1, y2: 1 };
  const aw = a.x2 - a.x1, ah = a.y2 - a.y1;
  const out = [];
  for (const it of itens) {
    let x1 = 1, y1 = 1, x2 = 0, y2 = 0;
    for (const [u, v] of it.pts) { x1 = Math.min(x1, u); y1 = Math.min(y1, v); x2 = Math.max(x2, u); y2 = Math.max(y2, v); }
    // fica se o centro está dentro do recorte
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    if (cx < a.x1 || cx > a.x2 || cy < a.y1 || cy > a.y2) continue;
    const conv = ([u, v]) => [Math.min(1, Math.max(0, (u - a.x1) / aw)), Math.min(1, Math.max(0, (v - a.y1) / ah))];
    let cls = classePorNome(it.classe);
    if (cls < 0) cls = p ? p.classe : 0;
    out.push(it.tipo === 'poligono'
      ? { cls, tipo: 'poligono', pts: it.pts.map(conv) }
      : { cls, tipo: 'retangulo', pts: [conv([x1, y1]), conv([x2, y2])] });
  }
  return out;
}

/**
 * Salva o quadro atual (ou o recorte `area`) como print, com os exemplos
 * que caem dentro. Devolve o print.
 */
export async function salvarQuadroComoPrint({ area = null, pasta = null, origem = null, itens = undefined } = {}) {
  const c = quadroCanvas(area);
  if (!c) throw new Error('Sem imagem da fonte: ligue a câmera, abra um vídeo, a tela ou o YouTube.');
  const blob = await paraBlob(c);
  return adicionarPrint(blob, { origem: origem || (area ? 'recorte' : origemAtual(store.get())), pasta, caixas: caixasDosExemplos(area, itens) });
}
