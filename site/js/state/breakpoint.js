/**
 * state/breakpoint.js — o único lugar que define "isto é um celular".
 *
 * Antes o número 820 vivia solto em três arquivos (MenuBar, app.js e o CSS),
 * e o topo das colunas era outra constante, repetida com valores DIFERENTES
 * em app.css (76px) e controls.css (68px). Constante duplicada é constante
 * que sai de sincronia: foi assim que o painel passou a abrir por baixo da
 * barra de menu no iPhone.
 *
 * Aqui ficam as duas verdades:
 *   NARROW    a largura em que o layout vira celular
 *   railTop() onde as colunas podem começar, medido de verdade
 */

const { useState, useEffect } = window.React;

/**
 * Largura em que a barra vira hambúrguer e as colunas viram uma só.
 *
 * Era 820, e o número estava errado — medido: mesmo com todos os rótulos
 * escondidos a barra ocupa 974px (marca, play, 12 painéis, 3 ações, fps,
 * tema e sair). Entre 820 e 974 ela transbordava, e o BOTÃO DE SAIR ficava
 * além da borda direita, sem rolagem e sem jeito de alcançar.
 *
 * 1000px dá a folga de que ela precisa. Acima disso a barra completa cabe;
 * abaixo, o hambúrguer guarda tudo e nada fica inacessível. O CSS usa o
 * mesmo número.
 */
export const NARROW = 1000;

/** Reavalia em resize e em rotação de tela. */
export function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < NARROW);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW - 1}px)`);
    const on = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    // addEventListener em MediaQueryList: Safari < 14 só tem addListener
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener(on);
    };
  }, []);

  return narrow;
}

/**
 * Onde as colunas (e, no celular, os painéis flutuantes) podem começar.
 *
 * Lê --rail-top, que o MenuBar publica medindo a própria base. O valor de
 * reserva cobre o intervalo entre o primeiro render e a primeira medição.
 */
export function railTop() {
  if (typeof window === 'undefined') return 76;
  /*
   * No celular a barra é fixa no topo: mede a base dela AGORA, em vez de
   * confiar só no --rail-top publicado. No iPhone o valor publicado podia
   * ficar velho (barra de endereço recolhendo, rotação, CSS antigo em cache)
   * e o painel abria por baixo da barra.
   */
  try {
    const bar = window.innerWidth < NARROW && document.querySelector('.menubar');
    if (bar) {
      const r = bar.getBoundingClientRect();
      if (r.height && r.top < window.innerHeight / 2) return Math.round(r.bottom + 10);
    }
  } catch (_) { /* sem barra ainda */ }
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--rail-top');
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  } catch (_) { /* documento ainda não pintado */ }
  return 76;
}
