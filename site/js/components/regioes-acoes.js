/**
 * components/regioes-acoes.js — o menu de contexto (clique direito) das REGIÕES DOS OPERADORES
 * (cv/regioes.js): redefinir, travar, apagar e «redesenhar com a ferramenta X». O resto do menu
 * (Via, copiar, recortes) segue o de sempre (components/menu-contexto.js).
 */
import { registrarAcao } from './menu-contexto.js';
import { marcStore, travar, setFerramenta, selecionar, FERRAMENTAS, rt } from '../cv/marcacoes.js';
import { regiaoDoItem, redefinir, redesenharCom } from '../cv/regioes.js';

const itemDe = (ctx) => ctx && ctx.regiao && marcStore.get().itens.find((i) => i.id === ctx.regiao);
const nomeFerr = (id) => { const f = FERRAMENTAS.find((x) => x.id === id); return f ? f.nome.replace(/\s*\(.*\)\s*$/, '') : id; };

registrarAcao({
  id: 'rg.titulo', grupo: 'processamento', ordem: 1, contextos: ['video'],
  rotulo: (ctx) => { const it = itemDe(ctx); return it ? `Região: ${it.vinc.rotulo || ''} · ${it.nome}` : 'Região'; },
  quando: (ctx) => Boolean(itemDe(ctx)),
  // só identifica a região (e a seleciona); as ações vêm abaixo
  executar: (ctx) => { selecionar(ctx.regiao); },
});
registrarAcao({
  id: 'rg.redefinir', grupo: 'processamento', ordem: 2, contextos: ['video'], rotulo: 'Redefinir (geometria padrão)',
  quando: (ctx) => Boolean(itemDe(ctx)),
  executar: (ctx) => { const it = itemDe(ctx); if (it && !redefinir(it)) throw new Error('esta região não tem geometria padrão'); },
});
registrarAcao({
  id: 'rg.travar', grupo: 'processamento', ordem: 3, contextos: ['video'],
  rotulo: (ctx) => (itemDe(ctx) && itemDe(ctx).travado ? 'Destravar' : 'Travar (não move com o mouse)'),
  quando: (ctx) => Boolean(itemDe(ctx)),
  executar: (ctx) => { const it = itemDe(ctx); if (it) travar([it.id], !it.travado); },
});
registrarAcao({
  id: 'rg.redesenhar', grupo: 'processamento', ordem: 4, contextos: ['video'], rotulo: 'Redesenhar com a ferramenta',
  quando: (ctx) => { const it = itemDe(ctx); const r = it && regiaoDoItem(it); return Boolean(r && r.def.ferramentas && r.def.ferramentas.length); },
  itens: (ctx) => { const r = regiaoDoItem(itemDe(ctx)); return (r ? r.def.ferramentas : []).map((f) => ({ id: f, rotulo: nomeFerr(f) })); },
  executar: (ctx, f) => {
    const it = itemDe(ctx);
    if (!it || !f) return;
    if (redesenharCom(it, f)) { setFerramenta(f); rt.redesenhar(); }
  },
});
