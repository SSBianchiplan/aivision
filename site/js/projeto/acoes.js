/**
 * projeto/acoes.js — os itens do +Projeto no menu de contexto
 * (components/menu-contexto.js), no vídeo ao vivo e no editor de prints:
 *
 *   Rotular como ▸ <classes>      · Trocar classe ▸ <classes>
 *   Salvar recorte como print      · Enviar à pasta ▸ <pastas>
 *   Enviar ao Treinar (pasta do projeto) · Pré-rotular aqui (detector)
 *
 * Quem abre o menu oferece os adaptadores (rotular, trocarClasse,
 * salvarComoPrint, moverParaPasta, enviarAtual, adicionarCaixas); a ação só
 * aparece se o adaptador existe e há um projeto ativo.
 */

import { registrarAcao, mostrarBalao, dadosDe, areaDe } from '../components/menu-contexto.js';
import { ativo, criarPasta, classePorNome, abrirPainel, avisar } from './base.js';

const comProjeto = () => Boolean(ativo());
const classesItens = () => (ativo() ? ativo().classes.map((c, i) => ({ id: i, rotulo: `${i < 9 ? i + 1 + ' · ' : ''}${c.nome}`, cor: c.cor })) : []);

/** Pastas do projeto como itens de submenu (a raiz tem o nome do projeto). */
function pastasItens() {
  const p = ativo();
  if (!p) return [];
  return [
    { id: '', rotulo: `${p.nome} (raiz)${p.pasta === '' ? ' ✓' : ''}` },
    ...p.pastas.map((c) => ({ id: c, rotulo: `${'· '.repeat(c.split('/').length - 1)}${c.split('/').pop()}${p.pasta === c ? ' ✓' : ''}` })),
    { id: '\u0000nova', rotulo: '+ Nova pasta…' },
  ];
}

async function escolherPasta(sub) {
  if (sub !== '\u0000nova') return sub;
  const n = window.prompt('Nome da pasta (use / para subpasta, ex.: turno-A/defeitos-novos):', ativo().pasta ? ativo().pasta + '/' : '');
  if (!n) return null;
  return criarPasta(n);
}

registrarAcao({
  id: 'pj.rotular', grupo: 'projeto', ordem: 10, rotulo: 'Rotular como',
  quando: (ctx) => comProjeto() && ativo().tipo === 'detector' && ctx.rotular && !ctx.item,
  itens: classesItens,
  executar: (ctx, cls) => ctx.rotular(+cls),
});

registrarAcao({
  id: 'pj.trocar', grupo: 'projeto', ordem: 12, rotulo: 'Trocar classe',
  quando: (ctx) => comProjeto() && ativo().tipo === 'detector' && ctx.item && ctx.trocarClasse,
  itens: classesItens,
  executar: (ctx, cls) => ctx.trocarClasse(+cls),
});

registrarAcao({
  id: 'pj.recorte', grupo: 'projeto', ordem: 20, rotulo: 'Salvar recorte como print no projeto',
  quando: (ctx) => ctx.salvarComoPrint && (ctx.area || ctx.item),
  async executar(ctx) {
    const pr = await ctx.salvarComoPrint({ recorte: true });
    if (pr) mostrarBalao(ctx, { titulo: 'Print salvo', linhas: [`${pr.w} × ${pr.h} px em «${pr.pasta || ativo().nome}» (${pr.caixas.length} ${pr.caixas.length === 1 ? 'caixa' : 'caixas'}).`], acoes: [{ rotulo: 'Abrir o +Projeto', fazer: abrirPainel }] });
  },
});

registrarAcao({
  id: 'pj.quadro', grupo: 'projeto', ordem: 22, rotulo: 'Salvar quadro inteiro como print (com os exemplos)',
  quando: (ctx) => ctx.origem === 'video' && ctx.salvarComoPrint,
  async executar(ctx) {
    const pr = await ctx.salvarComoPrint({ recorte: false });
    if (pr) mostrarBalao(ctx, { titulo: 'Print salvo', linhas: [`Quadro ${pr.w} × ${pr.h} px com ${pr.caixas.length} ${pr.caixas.length === 1 ? 'exemplo' : 'exemplos'}.`], acoes: [{ rotulo: 'Abrir o +Projeto', fazer: abrirPainel }] });
  },
});

registrarAcao({
  id: 'pj.pasta', grupo: 'projeto', ordem: 30, rotulo: 'Enviar à pasta',
  quando: (ctx) => comProjeto() && (ctx.moverParaPasta || ctx.salvarComoPrint),
  itens: pastasItens,
  async executar(ctx, sub) {
    const pasta = await escolherPasta(sub);
    if (pasta == null) return;
    if (ctx.moverParaPasta) { await ctx.moverParaPasta(pasta); avisar(`Print movido para «${pasta || ativo().nome}».`); return; }
    const pr = await ctx.salvarComoPrint({ recorte: Boolean(ctx.area || ctx.item), pasta });
    if (pr) mostrarBalao(ctx, { titulo: 'Print salvo', linhas: [`Na pasta «${pasta || ativo().nome}».`] });
  },
});

registrarAcao({
  id: 'pj.treinar', grupo: 'projeto', ordem: 40, rotulo: () => `Enviar ao Treinar (pasta «${ativo() ? ativo().pasta || ativo().nome : ''}»)`,
  quando: (ctx) => comProjeto() && (ctx.enviarAtual || ctx.salvarComoPrint),
  async executar(ctx) {
    const h = mostrarBalao(ctx, { titulo: 'Enviar ao Treinar', carregando: 'entrando no Treinar…' });
    const { garantirToken } = await import('../auth/treino.js');
    if (!await garantirToken()) {
      abrirPainel();
      h.atualizar({ titulo: 'Enviar ao Treinar', linhas: ['Entre no Treinar pelo painel +Projeto (conta de administrador ou senha do treino).'] });
      return;
    }
    const sv = await import('./servico.js');
    let pr = ctx.enviarAtual ? await ctx.enviarAtual() : await ctx.salvarComoPrint({ recorte: Boolean(ctx.area || ctx.item) });
    if (!pr) throw new Error('nada para enviar');
    h.atualizar({ titulo: 'Enviar ao Treinar', carregando: 'enviando…' });
    pr = await sv.enviarPrint(pr);
    h.atualizar({ titulo: 'Enviado ao Treinar', linhas: [`${pr.servidor} · ${pr.estado === 'rotulado' ? `${pr.caixas.length} caixas` : 'sem caixas'}`] });
  },
});

registrarAcao({
  id: 'pj.prerotular', grupo: 'projeto', ordem: 50, rotulo: () => (ativo() && ativo().modelo ? 'Pré-rotular aqui (modelo do projeto)' : 'Pré-rotular aqui (detector)'),
  quando: (ctx) => comProjeto() && ativo().tipo === 'detector' && ctx.adicionarCaixas && ativo().classes.length,
  async executar(ctx) {
    const p = ativo();
    const modelo = p.modelo ? 'livre:' + p.modelo : 'yolox';
    const h = mostrarBalao(ctx, { titulo: 'Pré-rotular', carregando: `a máquina propõe (${p.modelo ? 'modelo do projeto' : 'YOLOX · COCO'})…` });
    const c = await ctx.recorte();
    if (!c) throw new Error('sem imagem');
    const m = await import('../cv/runtime/livres-n/modelos.js');
    const r = await m.detectar(dadosDe(c), { modelo, conf: 0.35 });
    const a = areaDe(ctx), aw = a.x2 - a.x1, ah = a.y2 - a.y1;
    const objs = r.dets.slice(0, 50).map((d) => {
      const nome = r.rotulos[d[5]] || `#${d[5]}`;
      const k = p.modelo ? d[5] : classePorNome(nome);
      return { x1: a.x1 + (d[0] / c.width) * aw, y1: a.y1 + (d[1] / c.height) * ah, x2: a.x1 + (d[2] / c.width) * aw, y2: a.y1 + (d[3] / c.height) * ah,
               score: d[4], nome, cls: k >= 0 && k < p.classes.length ? k : p.classe, sugerida: true };
    });
    if (objs.length) ctx.adicionarCaixas(objs);
    h.atualizar({ titulo: `Pré-rotular · ${objs.length} ${objs.length === 1 ? 'sugestão' : 'sugestões'}`,
      linhas: objs.length ? ['A máquina propõe, o humano confirma: aceite, edite ou rejeite cada caixa.', ...objs.slice(0, 8).map((o) => `${o.nome} → ${p.classes[o.cls].nome} · ${Math.round(o.score * 100)}%`)] : ['nada encontrado com confiança ≥ 35%'] });
  },
});
