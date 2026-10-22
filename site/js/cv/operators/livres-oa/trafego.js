/**
 * cv/operators/livres-oa/trafego.js — CV-41 Contagem volumétrica classificada
 * (CVC) com matriz de giro (origem × destino), em blocos de 15 min.
 *
 * Cadeia: detector (RF-DETR/YOLOX) → Tracking com IDs → Zonas e linhas
 * (cena.zonas) → ESTE. Cada ZONA desenhada é um braço da interseção (Norte,
 * Sul…): o primeiro braço em que um ID entra é a ORIGEM, o próximo braço
 * diferente é o DESTINO — o movimento conta uma vez, no bloco do instante em
 * que o veículo chega ao destino. Cada LINHA de contagem conta a seção
 * transversal por sentido. A classe do ID é a mais votada ao longo da
 * trajetória (o detector oscila entre carro e caminhão; o voto estabiliza).
 *
 * Classes: carro, moto, ônibus, caminhão, bicicleta, pedestre (pessoa do
 * COCO). O resto vira "outros" (ou é ignorado). Exporta CSV por bloco ×
 * movimento × classe e a matriz. Painel: Medições › Tráfego.
 */
import { clone } from '../../core.js';
import { publicar, conferirGeracao, tempoDe, hora } from '../../runtime/livres-oa/canal.js';

export const G_TRAFEGO = 'CV-41';
export const CLASSES_CVC = ['carro', 'moto', 'ônibus', 'caminhão', 'bicicleta', 'pedestre'];
const MAPA = { pessoa: 'pedestre', carro: 'carro', moto: 'moto', 'ônibus': 'ônibus', onibus: 'ônibus', 'caminhão': 'caminhão',
  caminhao: 'caminhão', bicicleta: 'bicicleta', car: 'carro', motorcycle: 'moto', bus: 'ônibus', truck: 'caminhão', bicycle: 'bicicleta', person: 'pedestre' };

export function classeCvc(nome) {
  const n = String(nome || '').toLowerCase().trim();
  return MAPA[n] || 'outros';
}

function votar(votos) {
  let m = null, mv = -1;
  for (const k in votos) if (votos[k] > mv) { mv = votos[k]; m = k; }
  return m;
}

export const trafegoCvc = {
  op: 'trafego.cvc',
  label: 'Contagem classificada (CVC) e matriz de giro',
  group: G_TRAFEGO, overlayOnly: true,
  desc: 'Contagem volumétrica classificada: carro, moto, ônibus, caminhão, bicicleta e pedestre por movimento ' +
        '(zona de origem → zona de destino) e por linha, em blocos de 15 min, com matriz de giro e CSV. ' +
        'Coloque depois de detector → Tracking com IDs → Zonas e linhas; desenhe uma ZONA por braço da interseção.',
  params: {
    blocoMin: { type: 'int', min: 1, max: 60, step: 1, default: 15, label: 'Bloco (min)' },
    outros: { type: 'bool', default: false, label: 'Contar também "outros" (classes fora da CVC)' },
    esquecerS: { type: 'int', min: 2, max: 600, step: 1, default: 30, label: 'Esquecer ID sem destino após (s)' },
    faixa: { type: 'bool', default: true, label: 'Faixa com os totais no vídeo' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('trafego', state) || !state.ids) {
      state.ids = new Map();          // id → { votos, origem, tO, destino, visto }
      state.mov = [];                 // { t, bloco, origem, destino, classe, id }
      state.lin = [];                 // { t, bloco, linha, sentido, classe, id }
      state.incompletos = 0;
      state.relogio = null; state.t0 = null;
    }
    const { t, relogio } = tempoDe(ctx);
    if (state.t0 == null) { state.t0 = t; state.relogio = relogio; }
    const blocoS = p.blocoMin * 60;
    // vídeo: blocos a partir do 0 do arquivo; relógio de parede: alinhados ao relógio (hh:00, hh:15…)
    const bloco = Math.floor((relogio === 'real' ? t - new Date().getTimezoneOffset() * 60 : t) / blocoS);

    // votos de classe dos IDs vistos neste quadro
    for (const d of Array.isArray(ctx.detections) ? ctx.detections : []) {
      if (d.id == null) continue;
      const c = classeCvc(d.name);
      let e = state.ids.get(d.id);
      if (!e) state.ids.set(d.id, (e = { votos: {}, origem: null, tO: null, destino: null, visto: t }));
      e.votos[c] = (e.votos[c] || 0) + (d.score || 0.5);
      e.visto = t;
    }
    const cena = ctx.cena;
    if (!cena) {
      ctx.metrics['CVC'] = 'coloque Zonas e linhas (cena.zonas) antes deste operador';
    } else {
      for (const ev of cena.eventos || []) {
        if (ev.id == null) continue;
        let e = state.ids.get(ev.id);
        if (!e) state.ids.set(ev.id, (e = { votos: {}, origem: null, tO: null, destino: null, visto: t }));
        if (ev.classe) { const c = classeCvc(ev.classe); e.votos[c] = (e.votos[c] || 0) + 0.01; }
        e.visto = t;
        const classe = votar(e.votos) || 'outros';
        if (ev.tipo === 'linha') {
          if (classe !== 'outros' || p.outros) state.lin.push({ t, bloco, linha: ev.nome, sentido: ev.sentido, classe, id: ev.id });
          continue;
        }
        if (ev.tipo !== 'zona' || ev.sentido !== 'entrada') continue;
        if (!e.origem) { e.origem = ev.nome; e.tO = t; continue; }
        if (e.destino || ev.nome === e.origem) continue;
        e.destino = ev.nome;
        if (classe !== 'outros' || p.outros) state.mov.push({ t, bloco, origem: e.origem, destino: e.destino, classe, id: ev.id });
      }
    }
    // IDs sumidos: com origem e sem destino contam como incompletos
    for (const [id, e] of state.ids) {
      if (t - e.visto <= p.esquecerS) continue;
      if (e.origem && !e.destino) state.incompletos++;
      state.ids.delete(id);
    }

    // instantâneo para o painel (sem a imagem: só números)
    const porClasse = Object.fromEntries(CLASSES_CVC.map((c) => [c, 0]));
    if (p.outros) porClasse.outros = 0;
    for (const m of state.mov) porClasse[m.classe] = (porClasse[m.classe] || 0) + 1;
    const zonasNomes = cena ? Object.keys(cena.zonas || {}).length : 0;
    publicar('trafego', {
      relogio: state.relogio, blocoMin: p.blocoMin, t0: state.t0, t,
      movimentos: state.mov, linhas: state.lin,
      incompletos: state.incompletos, emCurso: [...state.ids.values()].filter((e) => e.origem && !e.destino).length,
      porClasse, zonas: zonasNomes,
    });
    const tot = state.mov.length;
    ctx.metrics['CVC movimentos'] = tot;
    ctx.metrics['CVC bloco'] = `${hora(bloco * blocoS, 'video')}`;
    if (p.faixa) {
      const txt = CLASSES_CVC.map((c) => `${c} ${porClasse[c]}`).join(' · ');
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, color: '#38bdf8', text: `CVC · ${tot} movimentos · ${txt}` });
    }
    return clone(src);
  },
};

// ------------------------------------------------------------------ agregação (painel e CSV)

/** Matriz origem × destino (por classe ou todas). */
export function matrizGiro(movimentos, classe = null) {
  const origens = new Set(), destinos = new Set(), m = {};
  for (const x of movimentos) {
    if (classe && x.classe !== classe) continue;
    origens.add(x.origem); destinos.add(x.destino);
    const k = x.origem + '→' + x.destino;
    m[k] = (m[k] || 0) + 1;
  }
  return { origens: [...origens].sort(), destinos: [...destinos].sort(), m };
}

/** Linhas do CSV por bloco × movimento × classe. */
export function tabelaBlocos(d) {
  const blocoS = d.blocoMin * 60;
  const agg = new Map();
  for (const x of d.movimentos) {
    const k = `${x.bloco}|${x.origem}|${x.destino}`;
    let r = agg.get(k);
    if (!r) agg.set(k, (r = { bloco: x.bloco, origem: x.origem, destino: x.destino, c: {} }));
    r.c[x.classe] = (r.c[x.classe] || 0) + 1;
  }
  const lin = new Map();
  for (const x of d.linhas) {
    const k = `${x.bloco}|${x.linha}|${x.sentido}`;
    let r = lin.get(k);
    if (!r) lin.set(k, (r = { bloco: x.bloco, origem: x.linha, destino: x.sentido, linha: true, c: {} }));
    r.c[x.classe] = (r.c[x.classe] || 0) + 1;
  }
  const rotulo = (b) => {
    if (d.relogio === 'real') {
      const off = new Date().getTimezoneOffset() * 60;
      return [hora(b * blocoS + off, 'real'), hora((b + 1) * blocoS + off, 'real')];
    }
    return [hora(b * blocoS, 'video'), hora((b + 1) * blocoS, 'video')];
  };
  return [...agg.values(), ...lin.values()].sort((a, b) => a.bloco - b.bloco || a.origem.localeCompare(b.origem))
    .map((r) => ({ ...r, ini: rotulo(r.bloco)[0], fim: rotulo(r.bloco)[1] }));
}

export default [trafegoCvc];
