/**
 * cv/operators/livres-r/doca.js — CV-51 Conferência de doca (L4).
 *
 *   doca.conferencia  volumes e pallets que cruzam a linha da porta de cada
 *                     doca (função "Doca · porta"; a seta da linha aponta
 *                     para DENTRO do armazém = entrada), por ID do rastreio
 *                     e pela classe mais votada do detector. A conferência
 *                     é por PLACA ou ORDEM digitada: líquido (entradas −
 *                     saídas no recebimento; o contrário na expedição)
 *                     contra os volumes e pallets esperados, e os códigos
 *                     (QR/barras/SSCC lidos pelo "Leitor de códigos") contra
 *                     a lista esperada — falta e sobra. Trocar a ordem ou
 *                     "Encerrar" no painel fecha a conferência e guarda o
 *                     registro. Sem detector, conta pelos códigos lidos.
 *
 * Cadeia: detector (RF-DETR/YOLOE/modelo próprio com caixa e palete) →
 * Tracking com IDs → [Leitor de códigos] → doca.conferencia.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';
import { ContadorDoca, conferir, listaClasses, lerCodigos, norm } from '../../runtime/livres-r/sequencia.js';
import { marcas, tomarComandos } from './comum.js';

export const G_DOCA = 'CV-51';

export const conferencia = {
  op: 'doca.conferencia',
  label: 'Conferência de doca (volumes e pallets)',
  group: G_DOCA, overlayOnly: true,
  desc: 'Conta volumes e pallets que entram e saem pela linha "Doca · porta" (seta = para dentro) e confere com a placa ' +
        'ou ordem digitada: volumes e pallets esperados e a lista de códigos (QR/barras/SSCC) — falta e sobra, registro ' +
        'por conferência e CSV. Depois de detector + Tracking com IDs (e do Leitor de códigos, se houver etiqueta).',
  params: {
    ordem: { type: 'text', default: '', max: 60, label: 'Placa ou ordem (troca = nova conferência)' },
    tipo: { type: 'enum', options: ['recebimento', 'expedição'], default: 'recebimento', label: 'Tipo' },
    volumes: { type: 'int', min: -1, max: 99999, step: 1, default: -1, label: 'Volumes esperados (−1 = não conferir)' },
    pallets: { type: 'int', min: -1, max: 9999, step: 1, default: -1, label: 'Pallets esperados (−1 = não conferir)' },
    codigos: { type: 'text', default: '', max: 8000, label: 'Códigos esperados (um por linha ou ; )' },
    classesVolume: { type: 'text', default: 'caixa, box, pacote, volume, suitcase, mala, bolsa', max: 200, label: 'Classes contadas como volume' },
    classesPallet: { type: 'text', default: 'palete, pallet', max: 200, label: 'Classes contadas como pallet' },
    ponto: { type: 'enum', options: ['centro', 'base'], default: 'centro', label: 'Ponto do objeto' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar contagens na linha' },
  },
  apply(src, p, state, ctx) {
    const { t, relogio } = tempoDe(ctx);
    const chave = `${p.ordem}|${p.tipo}`;
    const fechar = (motivo) => {
      if (!state.sessao) return;
      const s = state.sessao;
      const tot = s.ultTot || state.cont.totais(s.inicio);
      const conf = s.ultConf || conferir(s.tipo, esperadoDe(p), tot, [...s.codigos]);
      if (s.eventos || s.codigos.size) {
        state.historico.push({ ordem: s.ordem, tipo: s.tipo, inicio: s.inicio, fim: t, totais: tot, conferencia: conf, codigos: [...s.codigos], motivo });
        if (state.historico.length > 500) state.historico.shift();
      }
      state.sessao = null;
    };
    if (conferirGeracao('r.doca', state) || !state.cont) { state.cont = new ContadorDoca(); state.historico = []; state.sessao = null; }
    for (const c of tomarComandos('r.doca')) if (c.acao === 'encerrar') fechar('encerrada no painel');
    if (state.sessao && state.sessao.chave !== chave) fechar('ordem trocada');
    if (!state.sessao) state.sessao = { chave, ordem: p.ordem || '(sem ordem)', tipo: p.tipo, inicio: t, codigos: new Set(), eventos: 0 };
    const S = state.sessao;
    const { w, h } = ctx;
    const linhas = marcas(ctx, 'doca_porta', ['linha']).map((l) => ({ id: l.id, nome: l.nome, a: l.px[0], b: l.px[1], inverter: Boolean(ctx.marcacoes.espelhado) }));
    const cV = listaClasses(p.classesVolume), cP = listaClasses(p.classesPallet);
    const mapa = (c) => { const n = norm(c); return cP.has(n) ? 'pallet' : cV.has(n) ? 'volume' : null; };
    const dets = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => d.id != null) : [];
    const objs = dets.map((d) => ({ id: d.id, classe: d.name, x: ((d.x1 + d.x2) / 2) * w, y: (p.ponto === 'base' ? d.y2 : (d.y1 + d.y2) / 2) * h }));
    if (!ctx.fonteParada) {
      const novos = state.cont.passo(objs, linhas, t, mapa);
      S.eventos += novos.length;
      if (Array.isArray(ctx.codigos)) for (const c of ctx.codigos) if (c && c.text) S.codigos.add(String(c.text).trim());
    }
    let tot = state.cont.totais(S.inicio);
    // sem detector com ID: cada código distinto lido é um volume (no sentido do tipo)
    const semDetector = !state.cont.eventos.some((e) => e.t >= S.inicio) && !dets.length && S.codigos.size > 0;
    if (semDetector) {
      const n = { volume: S.codigos.size, pallet: 0 }, z = { volume: 0, pallet: 0 };
      tot = { 'códigos lidos': S.tipo === 'expedição' ? { entrada: z, 'saída': n } : { entrada: n, 'saída': z } };
    }
    const conf = conferir(S.tipo, esperadoDe(p), tot, [...S.codigos]);
    S.ultTot = tot; S.ultConf = conf;
    if (p.desenhar) {
      for (const l of linhas) {
        const T = tot[l.nome] || { entrada: { volume: 0, pallet: 0 }, 'saída': { volume: 0, pallet: 0 } };
        const x = Math.min(l.a[0], l.b[0]), y = Math.min(l.a[1], l.b[1]);
        ctx.overlay.push({ type: 'line', x1: l.a[0], y1: l.a[1], x2: l.b[0], y2: l.b[1], color: '#38bdf8', width: 3 });
        ctx.overlay.push({ type: 'rect', x, y, w: Math.max(4, Math.abs(l.b[0] - l.a[0])), h: Math.max(4, Math.abs(l.b[1] - l.a[1])), color: '#38bdf8',
                           label: `${l.nome}: ▼ ${T.entrada.volume} vol ${T.entrada.pallet} pal · ▲ ${T['saída'].volume} vol ${T['saída'].pallet} pal` });
      }
      const st = !conf.conferido ? 'sem esperado' : conf.ok ? 'CONFERE' : 'DIVERGENTE';
      const cor = !conf.conferido ? '#38bdf8' : conf.ok ? '#4ade80' : '#F2A900';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: cor,
        text: `${S.tipo} ${S.ordem}: ${conf.liquido.volume} vol, ${conf.liquido.pallet} pal${S.codigos.size ? `, ${S.codigos.size} códigos` : ''} — ${st}` });
      if (!linhas.length) ctx.overlay.push({ type: 'banner', x: 8, y: 32, color: '#F2A900', text: 'Doca: desenhe a linha da porta (função "Doca · porta"; seta para dentro)' });
      else if (!dets.length && !S.codigos.size) ctx.overlay.push({ type: 'banner', x: 8, y: 32, color: '#F2A900', text: 'Doca: sem objetos com ID — ponha detector + Tracking com IDs antes' });
    }
    ctx.metrics['doca'] = `${conf.liquido.volume} vol · ${conf.liquido.pallet} pal`;
    publicar('r.doca', { sessao: { ordem: S.ordem, tipo: S.tipo, inicio: S.inicio }, totais: tot, conferencia: conf, codigos: [...S.codigos],
                         esperado: esperadoDe(p), historico: state.historico.slice(-200), eventos: state.cont.eventos.filter((e) => e.t >= S.inicio).slice(-400),
                         semDetector, relogio, t });
    return clone(src);
  },
};

function esperadoDe(p) { return { volumes: p.volumes, pallets: p.pallets, codigos: lerCodigos(p.codigos) }; }

export default [conferencia];
