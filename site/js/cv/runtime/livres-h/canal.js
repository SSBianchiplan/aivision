/**
 * cv/runtime/livres-h/canal.js — ponte entre os operadores (salto.teste,
 * corrida.marcha) e os painéis Salto e Corrida.
 *
 * O executor não expõe o ctx do quadro fora da cadeia: o operador publica
 * aqui um retrato a cada inferência e o painel assina (no máximo 4×/s). A
 * SESSÃO mora aqui, e não no estado do nó: "Nova sessão" no painel precisa
 * zerá-la, a análise quadro a quadro de um arquivo escreve nela, e apagar ou
 * recriar o nó no Pipeline não joga fora as tentativas gravadas.
 */
import { SessaoSalto } from './salto.js';
import { SessaoCorrida } from './corrida.js';
import { GrupoCorrida } from './multi.js';

function criarCanal(sessao, aoZerar = null) {
  const ouvintes = new Set();
  let retrato = null, gravando = true, geracao = 0, timer = null, ultimo = 0;
  const avisar = (ja = false) => {
    const disparar = () => { ultimo = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* painel desmontando */ } } };
    if (ja) { if (timer) { clearTimeout(timer); timer = null; } disparar(); return; }
    if (timer) return;
    timer = setTimeout(() => { timer = null; disparar(); }, Math.max(0, 250 - (performance.now() - ultimo)));
  };
  const canal = {
    sessao,
    publicar(r) { retrato = r; avisar(); },
    instantaneo: () => retrato,
    assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    geracao: () => geracao,
    gravando: () => gravando,
    definirGravando(v) { gravando = Boolean(v); avisar(true); },
    /** Nova sessão: some tudo, inclusive o retrato da pessoa anterior. */
    zerar() {
      sessao.zerar(); geracao++; gravando = true;
      if (aoZerar) aoZerar(canal);
      canal.origem = { tipo: 'ao vivo', nome: '' };
      retrato = retrato ? { ...retrato, res: null, r: null, estado: null, avisos: [], alertas: [], P: null } : null;
      avisar(true);
    },
    /** Avisa os painéis já (depois de uma análise de arquivo, por exemplo). */
    avisarJa() { avisar(true); },
    /** Origem dos dados atuais: 'ao vivo' ou o nome do arquivo analisado quadro a quadro. */
    origem: { tipo: 'ao vivo', nome: '' },
  };
  return canal;
}

export const canalSalto = criarCanal(new SessaoSalto());
/**
 * Corrida: além da sessão de UMA pessoa, o grupo de VÁRIAS (uma sessão por
 * ID) e a escolha do painel — `selecionado` (ID mostrado em detalhe) e
 * `soSelecionado` (o operador segue só esse corredor). `alvoCaixa` (0..1 do
 * quadro) é a caixa do selecionado: no modo de uma pessoa, o rastreador
 * prefere quem estiver nela quando há gente sobreposta.
 */
export const canalCorrida = criarCanal(new SessaoCorrida(), (c) => {
  c.grupo.zerar(); c.selecionado = null; c.soSelecionado = false; c.alvoCaixa = null; c.zerarMotor = true;
});
canalCorrida.grupo = new GrupoCorrida();
canalCorrida.selecionado = null;
canalCorrida.soSelecionado = false;
canalCorrida.alvoCaixa = null;
canalCorrida.zerarMotor = false;
/** Escolhe o corredor (ID) mostrado em detalhe; `so` = o operador passa a seguir só ele. */
canalCorrida.selecionar = (id, so) => {
  canalCorrida.selecionado = id;
  if (so != null) canalCorrida.soSelecionado = Boolean(so);
  const c = id != null ? canalCorrida.grupo.get(id) : null;
  // normalizada (0..1): o quadro da análise de arquivo e o do Pipeline podem ter larguras diferentes
  const q = c && c.quadro;
  canalCorrida.alvoCaixa = c && c.caixa && q ? { x1: c.caixa.x1 / q.w, y1: c.caixa.y1 / q.h, x2: c.caixa.x2 / q.w, y2: c.caixa.y2 / q.h } : null;
  canalCorrida.avisarJa();
};
