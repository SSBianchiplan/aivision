/**
 * cv/operators/livres-s/ocupacao.js — CV-64 Ocupação por zona.
 *
 *   ocupacao.mesas  Mesa livre / ocupada / suja (75): por área "Ocupação · mesa",
 *                   pessoa da detecção COCO junto da mesa = ocupada; sem pessoa
 *                   mas com copo, taça, garrafa, tigela, talheres ou comida
 *                   sobre ela = suja (aguardando limpeza); nada = livre. Troca
 *                   de estado só depois de N s (histerese). Giro, tempo médio
 *                   de ocupação e espera pela limpeza.
 *   ocupacao.zona   Vagas e lixeiras (99, T2): área "Ocupação · vaga" conta os
 *                   objetos das classes pedidas (bicicleta, moto, carro…) até a
 *                   capacidade do nome ("Bicicletário (8)"), ou — sem detector,
 *                   para patinete e o que o COCO não tem — pela DIFERENÇA da cena
 *                   vazia; área "Ocupação · lixeira" (a boca/topo da lixeira):
 *                   nível pela diferença da cena vazia e alerta de cheia.
 */
import { clone } from '../../core.js';
import { dentro } from '../../marcacoes.js';
import { publicar, conferirGeracao } from '../../runtime/livres-oa/canal.js';
import { Alarmes } from '../../runtime/livres-oa/alarmes.js';
import { listaTexto } from '../../runtime/opkit.js';
import { ReferenciaCena, miniCinza, mascaraPessoas } from '../../runtime/livres-s/cena-ref.js';
import { passoTempo, capacidadeDoNome } from '../../runtime/livres-s/comum.js';
import { contorno, pedidoCaptura } from './predial.js';

export const G_OCUPACAO = 'CV-64';
const AREAS = new Set(['retangulo', 'poligono', 'elipse', 'mascara']);
export const FUNCAO_MESA = 'mesa', FUNCAO_VAGA = 'vaga', FUNCAO_LIXEIRA = 'lixeira';
const ITENS_MESA = 'copo, taça, garrafa, tigela, garfo, faca, colher, sanduíche, pizza, bolo, rosquinha, banana, maçã, laranja, cachorro-quente, brócolis, cenoura';

/** A caixa (0–1) de uma pessoa está "na mesa"? Centro da pessoa dentro da mesa expandida por `margem` (fração do tamanho da mesa). */
export function pessoaNaMesa(d, caixa, margem = 0.35) {
  const mw = (caixa.x2 - caixa.x1) * margem, mh = (caixa.y2 - caixa.y1) * margem;
  const cx = (d.x1 + d.x2) / 2, cy = (d.y1 + d.y2) / 2;
  if (cx >= caixa.x1 - mw && cx <= caixa.x2 + mw && cy >= caixa.y1 - mh && cy <= caixa.y2 + mh) return true;
  // pessoa sentada encobre a mesa: interseção ≥ 25 % da mesa
  const ix = Math.max(0, Math.min(d.x2, caixa.x2) - Math.max(d.x1, caixa.x1)), iy = Math.max(0, Math.min(d.y2, caixa.y2) - Math.max(d.y1, caixa.y1));
  return ix * iy >= 0.25 * (caixa.x2 - caixa.x1) * (caixa.y2 - caixa.y1);
}

/**
 * Máquina de estados com histerese: o estado bruto precisa durar
 * `espera[estado]` s para valer. Devolve true quando trocou.
 */
export function passoEstado(e, bruto, t, espera) {
  if (e.estado == null) { e.estado = bruto; e.desde = t; e.cand = null; return true; }
  if (bruto === e.estado) { e.cand = null; return false; }
  if (e.cand !== bruto) { e.cand = bruto; e.candDesde = t; }
  if (t - e.candDesde >= (espera[bruto] ?? 0)) {
    e.anterior = e.estado; e.estado = bruto; e.desde = e.candDesde; e.cand = null;
    return true;
  }
  return false;
}

const COR_MESA = { livre: '#4ade80', ocupada: '#38bdf8', suja: '#F2A900' };

export const mesas = {
  op: 'ocupacao.mesas',
  label: 'Mesas: livre, ocupada ou suja',
  group: G_OCUPACAO, overlayOnly: true,
  desc: 'Por área "Ocupação · mesa": pessoa (detecção COCO) junto da mesa = OCUPADA; sem pessoa e com copo, taça, ' +
        'garrafa, tigela, talheres ou comida sobre ela = SUJA (aguardando limpeza); nada = LIVRE. Troca só após N s. ' +
        'Giro, tempo médio de ocupação e espera pela limpeza, CSV no Medições. Coloque depois de um detector COCO.',
  params: {
    itens: { type: 'text', default: ITENS_MESA, max: 300, label: 'Objetos que sujam a mesa (classes)' },
    margem: { type: 'float', min: 0, max: 1.5, step: 0.05, default: 0.35, label: 'Pessoa "na mesa": margem em volta (× mesa)' },
    esperaOcupada: { type: 'float', min: 0, max: 120, step: 0.5, default: 3, label: 'Ocupada após (s)' },
    esperaLivre: { type: 'float', min: 0, max: 600, step: 1, default: 8, label: 'Livre/suja após a saída (s)' },
    confMin: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0.3, label: 'Confiança mínima' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar as mesas' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('mesas', state) || !state.m) state.m = new Map();
    const { t } = passoTempo(state, ctx);
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const zonas = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_MESA && AREAS.has(i.tipo)) : [];
    const dets = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => d.score == null || d.score >= p.confMin) : null;
    if (!zonas.length || !dets) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: !dets ? 'Mesas: coloque um detector COCO (RF-DETR/YOLOX) antes' : 'Mesas: desenhe uma área por mesa com a função "Ocupação · mesa"' });
      publicar('mesas', { mesas: [] });
      return clone(src);
    }
    const itens = listaTexto(p.itens);
    const pessoas = dets.filter((d) => /^(pessoa|person)$/i.test(String(d.name)));
    const objs = dets.filter((d) => itens.includes(String(d.name).toLowerCase()));
    const espera = { ocupada: p.esperaOcupada, livre: p.esperaLivre, suja: p.esperaLivre };
    const out = [];
    for (const z of zonas) {
      let e = state.m.get(z.id);
      if (!e) state.m.set(z.id, (e = { estado: null, ocupacoes: 0, durOcup: [], esperas: [], limpezas: 0 }));
      const nP = pessoas.filter((d) => pessoaNaMesa(d, z.caixa, p.margem)).length;
      const nO = objs.filter((d) => dentro(z, (d.x1 + d.x2) / 2, (d.y1 + d.y2) / 2)).length;
      const bruto = nP > 0 ? 'ocupada' : nO > 0 ? 'suja' : 'livre';
      if (!ctx.fonteParada && passoEstado(e, bruto, t, espera) && e.anterior) {
        const dur = e.desde - (e.desdeAnt ?? e.desde);
        if (e.anterior === 'ocupada') { e.durOcup.push(dur); if (e.durOcup.length > 500) e.durOcup.shift(); }
        if (e.anterior === 'suja' && e.estado === 'livre') { e.esperas.push(dur); e.limpezas++; if (e.esperas.length > 500) e.esperas.shift(); }
        if (e.estado === 'ocupada') e.ocupacoes++;
      }
      if (e.desdeAnt !== e.desde) e.desdeAnt = e.desde;
      const media = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
      const r = { id: z.id, nome: z.nome, estado: e.estado, desde: e.desde, ha: t - e.desde, pessoas: nP, objetos: nO, ocupacoes: e.ocupacoes,
        ocupMediaS: media(e.durOcup), esperaMediaS: media(e.esperas), limpezas: e.limpezas };
      out.push(r);
      if (p.desenhar) {
        const cor = COR_MESA[e.estado] || '#94a3b8';
        contorno(ctx, z, cor, w, h);
        const min = Math.floor(r.ha / 60), s = Math.floor(r.ha % 60);
        ctx.overlay.push({ type: 'banner', x: z.caixa.x1 * w + 4, y: z.caixa.y1 * h + 4, color: cor, text: `${z.nome}: ${e.estado} ${min}:${String(s).padStart(2, '0')}` });
      }
    }
    const n = (k) => out.filter((x) => x.estado === k).length;
    ctx.metrics['mesas'] = `${n('livre')} livres · ${n('ocupada')} ocupadas · ${n('suja')} sujas`;
    publicar('mesas', { mesas: out, t });
    return clone(src);
  },
};

// ======================================================================= vagas e lixeiras

const alarmesOcup = new Alarmes();
export function alarmesOcupacao() { return alarmesOcup; }

export const zona = {
  op: 'ocupacao.zona',
  label: 'Vagas e lixeiras (ocupação por zona)',
  group: G_OCUPACAO, overlayOnly: true,
  desc: 'Área "Ocupação · vaga": conta bicicletas, motos, carros (classes) com o ponto de referência dentro, até a ' +
        'capacidade do nome ("Bicicletário (8)"); sem detector (patinete e o que o COCO não tem), estima pela diferença ' +
        'da cena vazia. Área "Ocupação · lixeira" (boca/topo): nível pela diferença da cena vazia e alerta de cheia. ' +
        '% de ocupação, tempo ocupado, giro, CSV no Medições.',
  params: {
    classes: { type: 'text', default: 'bicicleta, moto', max: 200, label: 'Classes que ocupam a vaga' },
    modo: { type: 'enum', options: ['automático', 'detecções', 'diferença da cena'], default: 'automático', label: 'Vagas por' },
    ponto: { type: 'enum', options: ['base', 'centro'], default: 'centro', label: 'Ponto de referência do objeto' },
    confMin: { type: 'float', min: 0, max: 0.95, step: 0.05, default: 0.3, label: 'Confiança mínima' },
    limiar: { type: 'int', min: 5, max: 80, step: 1, default: 24, label: 'Diferença de brilho (níveis)' },
    fracCheia: { type: 'float', min: 0.1, max: 1, step: 0.05, default: 0.6, label: 'Fração diferente = 100 % (diferença)' },
    cheiaPct: { type: 'int', min: 30, max: 100, step: 5, default: 80, label: 'Lixeira cheia a partir de (%)' },
    cheiaS: { type: 'int', min: 0, max: 3600, step: 5, default: 60, label: 'Alerta de lixeira cheia após (s)' },
    auto: { type: 'bool', default: true, label: 'Capturar a cena vazia sozinha (cena parada 3 s)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar as áreas' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('vagas', state) || !state.z) { state.z = new Map(); state.ref = new ReferenciaCena(); }
    const { t, dt } = passoTempo(state, ctx);
    const { w, h } = ctx;
    const mq = ctx.marcacoes;
    const vagas = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_VAGA && AREAS.has(i.tipo)) : [];
    const lixeiras = mq ? mq.itens.filter((i) => i.funcao === FUNCAO_LIXEIRA && AREAS.has(i.tipo)) : [];
    if (!vagas.length && !lixeiras.length) {
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#F2A900', text: 'Ocupação: desenhe áreas "Ocupação · vaga" ou "Ocupação · lixeira"' });
      publicar('vagas', { zonas: [] });
      return clone(src);
    }
    const dets = Array.isArray(ctx.detections) ? ctx.detections.filter((d) => d.score == null || d.score >= p.confMin) : null;
    const porDet = p.modo === 'detecções' || (p.modo === 'automático' && dets);
    const precisaRef = lixeiras.length > 0 || !porDet;
    const ref = state.ref;
    let mc = null, ganho = 1, pes = null;
    if (precisaRef) {
      mc = miniCinza(src);
      if (pedidoCaptura('vagas_ref', state)) ref.capturar(mc, t);
      if (!ctx.fonteParada) ref.quadro(mc, t, { estavelS: 3, auto: p.auto });
      if (ref.ref) {
        const fora = new Uint8Array(ref.w * ref.h);
        for (const z of [...lixeiras, ...(porDet ? [] : vagas)]) { const m = ref.mascara(z).m; for (let i = 0; i < m.length; i++) if (m[i]) fora[i] = 1; }
        ganho = ref.ganho(mc.g, fora);
        pes = mascaraPessoas(dets, ref.w, ref.h);
      }
    }
    const classes = listaTexto(p.classes);
    const objs = porDet && dets ? dets.filter((d) => !classes.length || classes.includes(String(d.name).toLowerCase())) : [];
    const out = [];
    const reg = (z, tipo) => {
      let e = state.z.get(z.id);
      if (!e) state.z.set(z.id, (e = { tempoOcup: 0, tempo: 0, giro: 0, antOcup: 0, serie: [], somaPct: 0 }));
      return e;
    };
    for (const z of vagas) {
      const e = reg(z);
      const cap = capacidadeDoNome(z.nome, 1);
      let n = 0, pct = null, fonte;
      if (porDet) {
        fonte = 'detecções';
        n = objs.filter((d) => dentro(z, (d.x1 + d.x2) / 2, p.ponto === 'base' ? d.y2 : (d.y1 + d.y2) / 2)).length;
        pct = Math.min(1, n / cap);
      } else if (ref.ref) {
        fonte = 'diferença';
        const m = ref.medir(z, mc, { limiar: p.limiar, ganho, excluir: pes ? (i) => pes[i] === 1 : null });
        pct = Math.min(1, m.dif / p.fracCheia);
        n = Math.round(pct * cap);
      }
      const ocupadas = Math.min(cap, n);
      if (pct != null && dt > 0) {
        e.tempo += dt; e.somaPct += pct * dt;
        if (ocupadas > 0) e.tempoOcup += dt;
        if (ocupadas > e.antOcup) e.giro += ocupadas - e.antOcup;
        e.antOcup = ocupadas;
        const ult = e.serie[e.serie.length - 1];
        if (!ult || t - ult[0] >= 5) { e.serie.push([t, pct]); if (e.serie.length > 2000) e.serie.shift(); }
      }
      out.push({ id: z.id, nome: z.nome, tipo: 'vaga', capacidade: cap, ocupadas, livres: pct == null ? null : cap - ocupadas, pct, fonte: fonte || 'aguardando cena vazia',
        mediaPct: e.tempo ? e.somaPct / e.tempo : null, tempoOcupS: e.tempoOcup, tempoS: e.tempo, giro: e.giro, serie: e.serie.slice(-300) });
      if (p.desenhar) {
        const cor = pct == null ? '#94a3b8' : ocupadas >= cap ? '#FF4D4D' : ocupadas > 0 ? '#F2A900' : '#4ade80';
        contorno(ctx, z, cor, w, h);
        ctx.overlay.push({ type: 'banner', x: z.caixa.x1 * w + 4, y: z.caixa.y1 * h + 4, color: cor,
          text: pct == null ? `${z.nome}: aguardando cena vazia` : cap > 1 ? `${z.nome}: ${ocupadas}/${cap} (${cap - ocupadas} livres)` : `${z.nome}: ${ocupadas ? 'ocupada' : 'livre'}` });
      }
    }
    for (const z of lixeiras) {
      const e = reg(z);
      let pct = null;
      if (ref.ref) {
        const m = ref.medir(z, mc, { limiar: p.limiar, ganho, excluir: pes ? (i) => pes[i] === 1 : null });
        pct = Math.min(1, m.dif / p.fracCheia);
        if (dt > 0) {
          e.tempo += dt; e.somaPct += pct * dt;
          const ult = e.serie[e.serie.length - 1];
          if (!ult || t - ult[0] >= 5) { e.serie.push([t, pct]); if (e.serie.length > 2000) e.serie.shift(); }
        }
      }
      const cheiaBruta = pct != null && pct * 100 >= p.cheiaPct;
      const est = alarmesOcup.passo(`${z.nome} cheia`, { prio: 3, texto: `${z.nome}: lixeira cheia — esvaziar`, atrasoOn: p.cheiaS, atrasoOff: 10 },
        cheiaBruta, pct != null && pct * 100 < p.cheiaPct - 10, pct, t);
      const cheia = est === 'ATIVO_NR' || est === 'ATIVO_R';
      out.push({ id: z.id, nome: z.nome, tipo: 'lixeira', pct, cheia, estado: est, serie: e.serie.slice(-300) });
      if (p.desenhar) {
        const cor = pct == null ? '#94a3b8' : cheia ? '#FF4D4D' : cheiaBruta ? '#F2A900' : '#4ade80';
        contorno(ctx, z, cor, w, h);
        ctx.overlay.push({ type: 'banner', x: z.caixa.x1 * w + 4, y: z.caixa.y1 * h + 4, color: cor,
          text: pct == null ? `${z.nome}: aguardando cena vazia` : `${z.nome}: ${Math.round(pct * 100)} %${cheia ? ' — CHEIA' : ''}` });
      }
    }
    alarmesOcup.limpar(t, 3600);
    const vs = out.filter((x) => x.tipo === 'vaga' && x.pct != null);
    if (vs.length) {
      const cap = vs.reduce((s, x) => s + x.capacidade, 0), oc = vs.reduce((s, x) => s + x.ocupadas, 0);
      ctx.metrics['vagas'] = `${oc}/${cap} ocupadas (${Math.round((100 * oc) / cap)} %)`;
    }
    publicar('vagas', { zonas: out, pronta: Boolean(ref.ref), precisaRef, alarmes: alarmesOcup.resumo(), t });
    return clone(src);
  },
};

export default [mesas, zona];
