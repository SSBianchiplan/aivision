/**
 * cv/runtime/livres-i/canal.js — pontes entre os operadores (swing.analise,
 * vbt.barra) e os painéis Swing e VBT.
 *
 * O executor não expõe o ctx do quadro fora da cadeia: o operador publica
 * aqui um retrato do que mediu e o painel assina (no máximo 4×/s). A SESSÃO
 * mora no canal e não no estado do nó — "Nova sessão" no painel precisa
 * zerá-la, e apagar/recriar o nó no Pipeline não deve perder o que foi gravado.
 */
import { SessaoSwing } from './swing.js';
import { SessaoVbt } from './vbt.js';

function criarCanal(Sessao) {
  const sessao = new Sessao();
  const ouvintes = new Set();
  let retrato = null, gravando = true, geracao = 0, timer = null, ultimoAviso = 0;
  const agora = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function avisar(ja = false) {
    if (ja) {
      if (timer) { clearTimeout(timer); timer = null; }
      ultimoAviso = agora();
      for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } }
      return;
    }
    if (timer) return;
    const espera = Math.max(0, 250 - (agora() - ultimoAviso));
    timer = setTimeout(() => {
      timer = null; ultimoAviso = agora();
      for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } }
    }, espera);
  }

  return {
    obterSessao: () => sessao,
    estaGravando: () => gravando,
    geracaoSessao: () => geracao,
    instantaneo: () => retrato,
    /** O operador chama a cada medida; `ja` avisa na hora (evento importante). */
    publicar(r, ja = false) { retrato = r; avisar(ja); },
    assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    zerarSessao() {
      sessao.zerar();
      geracao++;
      gravando = true;
      retrato = retrato ? { ...retrato, zerado: true } : null;
      avisar(true);
    },
    definirGravando(v) { gravando = Boolean(v); avisar(true); },
    /** Mudança feita pelo painel (ex.: nova série) que os outros assinantes devem ver. */
    tocar() { avisar(true); },
  };
}

export const canalSwing = criarCanal(SessaoSwing);
export const canalVbt = criarCanal(SessaoVbt);
