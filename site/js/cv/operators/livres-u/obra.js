/**
 * cv/operators/livres-u/obra.js — obra.diario (CV-87, C1 Diário de obra automático).
 *
 * Câmera de canteiro: por hora do dia, o máximo simultâneo de pessoas,
 * caminhões, betoneiras… (detector + Tracking com IDs da cadeia) e as entradas
 * pela área «Obra · portão». Uma foto a cada N minutos (com os rostos já
 * borrados se o «Borrar rostos» vier antes na cadeia) fica no IndexedDB deste
 * navegador. O painel monta o RDO em HTML (imprimir → PDF) e, SÓ se o usuário
 * marcar, pede à Via (chave da Anthropic do próprio usuário) um texto-resumo.
 * Hora de parede: é um diário, mesmo com vídeo gravado na fonte.
 */
import { clone } from '../../core.js';
import { publicar, tomar } from '../../runtime/livres-u/canal.js';
import { DiarioObra, chaveDia } from '../../runtime/livres-u/obra.js';
import { reduzir, jpeg } from '../../runtime/livres-u/imagem.js';
import { ler, gravar } from '../../runtime/livres-u/db.js';
import { listaTexto } from '../../runtime/opkit.js';

const G = 'CV-87';

export const diario = {
  op: 'obra.diario',
  label: 'Diário de obra (RDO)',
  group: G,
  desc: 'Conta por hora as pessoas e os equipamentos do canteiro (máximo ao mesmo tempo e entradas pela área ' +
        '«Obra · portão»), guarda uma foto a cada N minutos neste navegador e monta o RDO do dia no painel ' +
        '(HTML para imprimir/PDF). Opcional e só com o seu aceite: a Via redige o resumo com a SUA chave. ' +
        'Ninguém é identificado; use «Borrar rostos» antes na cadeia.',
  params: {
    classes: { type: 'text', default: 'pessoa, caminhão, betoneira, escavadeira, carro', max: 200, label: 'O que contar (classes)' },
    fotoMin: { type: 'int', min: 0, max: 240, step: 1, default: 30, label: 'Foto a cada (min; 0 = só pelo botão)' },
    intervaloMs: { type: 'int', min: 100, max: 10000, step: 100, default: 500, label: 'Contar a cada (ms)' },
  },
  apply(src, p, state, ctx) {
    const agora = Date.now();
    if (!state.d) {
      state.d = new DiarioObra();
      state.fotos = 0;
      state.carregando = true;
      ler('obra', 'estado:' + chaveDia(agora)).then((j) => { if (j) state.d.carregar(j); }).catch(() => {}).finally(() => { state.carregando = false; });
      ler('obra', 'fotos:' + chaveDia(agora)).then((l) => { state.fotos = (l || []).length; }).catch(() => {});
    }
    state.d.configurar({ classes: listaTexto(p.classes) });
    let foto = false;
    for (const c of tomar('u_obra')) if (c.tipo === 'foto') foto = true;
    const portoes = ctx.marcacoes ? ctx.marcacoes.itens.filter((i) => i.funcao === 'portao' && i.caixa) : [];
    const noPortao = portoes.length ? (d) => {
      const x = (d.x1 + d.x2) / 2, y = d.y2;
      return portoes.some((z) => x >= z.caixa.x1 && x <= z.caixa.x2 && y >= z.caixa.y1 && y <= z.caixa.y2);
    } : null;
    if (!state.carregando && (!state.tCont || agora - state.tCont >= p.intervaloMs)) {
      state.tCont = agora;
      state.agora = state.d.passo(agora, ctx.detections || [], noPortao);
    }
    // persiste a cada minuto
    if (!state.tSalvo || agora - state.tSalvo > 60000) {
      state.tSalvo = agora;
      const dia = chaveDia(agora), j = state.d.json(dia);
      if (j) gravar('obra', 'estado:' + dia, j).catch(() => {});
    }
    if (p.fotoMin > 0 && (!state.tFoto || agora - state.tFoto >= p.fotoMin * 60000)) foto = true;
    if (foto && !state.salvandoFoto) {
      state.tFoto = agora; state.salvandoFoto = true;
      const img = reduzir(src, 960), dia = chaveDia(agora);
      jpeg(img, 0.8).then(async (blob) => {
        const id = 'foto:' + agora;
        await gravar('obra', id, blob);
        const l = (await ler('obra', 'fotos:' + dia)) || [];
        l.push({ id, quando: agora });
        await gravar('obra', 'fotos:' + dia, l);
        state.fotos = l.length;
      }).catch((e) => { state.erro = String(e && e.message || e); }).finally(() => { state.salvandoFoto = false; });
    }
    const dia = chaveDia(agora);
    publicar('u_obra', { dia, tabela: state.d.tabela(dia), agora: state.agora || {}, fotos: state.fotos, classes: state.d.o.classes, erro: state.erro || '', portao: portoes.length > 0 });
    const resumo = Object.entries(state.agora || {}).map(([c, n]) => `${n} ${c}`).join(' · ');
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Diário de obra: ${resumo || 'nada contado agora'} · ${state.fotos} foto(s)`, color: '#fb923c' });
    return clone(src);
  },
};

export default [diario];
