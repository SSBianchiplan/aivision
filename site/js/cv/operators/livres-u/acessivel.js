/**
 * cv/operators/livres-u/acessivel.js — CV-81 Acessibilidade.
 *
 *   acessivel.falar        X1 «O que tem na minha frente?»: junta as detecções, os
 *                          textos do OCR, os códigos e a legenda (se houver) numa frase
 *                          em português e fala com a síntese de voz do NAVEGADOR
 *                          (vozes locais têm preferência). Ao mudar a cena, a cada N s
 *                          ou só pelo botão grande do painel.
 *   acessivel.mouse_cabeca X2 cursor pela cabeça (yaw/pitch do rosto.malha) e clique
 *                          por piscada longa, dentro da página; calibração de 5 pontos.
 *
 * Nada sai do navegador (a voz escolhida é local quando o sistema tem uma).
 */
import { clone } from '../../core.js';
import { publicar, tomar, lerLocal, gravarLocal } from '../../runtime/livres-u/canal.js';
import { descreverCena, assinaturaCena, earMedio, MouseCabeca, montarCalibracao } from '../../runtime/livres-u/acess.js';
import { moverCursor, esconderCursor, mostrarAviso, clicarEm } from '../../runtime/livres-u/cursor.js';

const G = 'CV-81';

// ------------------------------------------------------------------ voz

let vozCache = null;
/** Voz pt-BR, local de preferência (localService). */
export function vozPtBr() {
  if (typeof speechSynthesis === 'undefined') return null;
  const vs = speechSynthesis.getVoices() || [];
  const pt = vs.filter((v) => /^pt(-|_)?BR/i.test(v.lang)), pt2 = pt.length ? pt : vs.filter((v) => /^pt/i.test(v.lang));
  vozCache = pt2.find((v) => v.localService) || pt2[0] || null;
  return vozCache;
}

/** Fala `texto` (interrompe a fala anterior). Devolve false sem síntese de voz. */
export function falar(texto, taxa = 1) {
  if (typeof speechSynthesis === 'undefined' || !texto) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = 'pt-BR'; u.rate = taxa;
  const v = vozCache || vozPtBr();
  if (v) u.voice = v;
  speechSynthesis.speak(u);
  return true;
}

export const falarOp = {
  op: 'acessivel.falar',
  label: 'O que tem na minha frente? (voz)',
  group: G,
  desc: 'Descreve em voz alta, em português, o que a cadeia vê: objetos agrupados e a posição (à esquerda, à frente, ' +
        'à direita, bem perto), os textos lidos pelo OCR e os códigos. Fala ao mudar a cena, a cada N segundos ou pelo ' +
        'botão grande do painel. Síntese de voz do próprio navegador (voz local quando existe).',
  params: {
    modo: { type: 'enum', options: ['ao mudar a cena', 'a cada intervalo', 'só pelo botão'], default: 'ao mudar a cena', label: 'Quando falar' },
    intervaloS: { type: 'int', min: 2, max: 120, step: 1, default: 8, label: 'Intervalo (s)' },
    estavelS: { type: 'float', min: 0.2, max: 5, step: 0.1, default: 1.2, label: 'Cena parada antes de falar (s)' },
    taxa: { type: 'float', min: 0.5, max: 2, step: 0.1, default: 1, label: 'Velocidade da fala' },
    minScore: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.45, label: 'Confiança mínima' },
    textos: { type: 'bool', default: true, label: 'Ler textos (OCR)' },
    codigos: { type: 'bool', default: true, label: 'Ler códigos' },
    legenda: { type: 'bool', default: true, label: 'Usar a legenda (Florence-2), se houver' },
  },
  apply(src, p, state, ctx) {
    const agora = performance.now() / 1000;
    const cena = {
      dets: ctx.detections || [], textos: p.textos ? ctx.textos || [] : [], codigos: p.codigos ? ctx.codigos || [] : [],
      legenda: p.legenda && ctx.caption && ctx.caption.text ? ctx.caption.text : '',
    };
    const o = { minScore: p.minScore, textos: p.textos, codigos: p.codigos };
    const frase = descreverCena(cena, o);
    const ass = assinaturaCena(cena, o);
    if (ass !== state.ass) { state.ass = ass; state.desde = agora; }
    let dizer = false;
    for (const c of tomar('u_falar')) if (c.tipo === 'falar') dizer = true;
    if (p.modo === 'ao mudar a cena' && ass !== state.falada && agora - state.desde >= p.estavelS && agora - (state.ult || 0) >= 2.5) dizer = true;
    if (p.modo === 'a cada intervalo' && agora - (state.ult || 0) >= p.intervaloS) dizer = true;
    if (dizer && frase) {
      state.ok = falar(frase, p.taxa);
      state.falada = ass; state.ult = agora; state.ultimaFrase = frase;
    }
    publicar('u_falar', { frase, ultimaFrase: state.ultimaFrase || '', semVoz: state.ok === false, voz: vozCache ? `${vozCache.name}${vozCache.localService ? ' (local)' : ' (rede)'}` : '' });
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: (frase || '…').slice(0, 90), color: '#4ade80' });
    return clone(src);
  },
};

// ------------------------------------------------------------------ mouse por cabeça

const CHAVE_CAL = 'gplansis.mouse-cabeca.cal.v1';
const PASSOS = [['centro', 'Olhe para o CENTRO da tela'], ['esquerda', 'Vire a cabeça para a ESQUERDA'], ['direita', 'Vire a cabeça para a DIREITA'],
  ['cima', 'Levante a cabeça (olhe para CIMA)'], ['baixo', 'Abaixe a cabeça (olhe para BAIXO)']];

export const mouseCabeca = {
  op: 'acessivel.mouse_cabeca',
  label: 'Mouse por cabeça e piscada',
  group: G,
  desc: 'Move um cursor dentro do iaVision com a cabeça (orientação do rosto.malha) e clica com uma piscada longa dos ' +
        'dois olhos; olhos fechados por 2 s pausam/retomam. Calibração de 5 posições no painel. Precisa do «Malha do ' +
        'rosto» antes na cadeia. Só funciona nesta página (fora dela precisa de app nativo).',
  params: {
    ligado: { type: 'bool', default: true, label: 'Cursor ligado' },
    suavidade: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.5, label: 'Suavidade' },
    ganhoGraus: { type: 'float', min: 5, max: 45, step: 1, default: 18, label: 'Sem calibração: graus até a borda' },
    piscaMin: { type: 'float', min: 0.2, max: 1.5, step: 0.05, default: 0.4, label: 'Piscada longa: mínimo (s)' },
    piscaMax: { type: 'float', min: 0.5, max: 3, step: 0.1, default: 1.2, label: 'Piscada longa: máximo (s)' },
    pausaS: { type: 'float', min: 1, max: 6, step: 0.5, default: 2, label: 'Olhos fechados para pausar (s)' },
    inverterX: { type: 'bool', default: false, label: 'Inverter horizontal (sem calibração)' },
  },
  apply(src, p, state, ctx) {
    if (!state.m) {
      state.m = new MouseCabeca();
      const cal = lerLocal(CHAVE_CAL);
      if (cal) state.m.calibrar(cal);
      state.cliques = 0;
    }
    const m = state.m;
    m.configurar({ suavidade: p.suavidade, ganhoGraus: p.ganhoGraus, piscaMin: p.piscaMin, piscaMax: Math.max(p.piscaMax, p.piscaMin + 0.1), pausaS: p.pausaS });
    const t = performance.now() / 1000;
    for (const c of tomar('u_mouse')) {
      if (c.tipo === 'calibrar') state.cal = { passo: 0, ini: t, am: {} };
      if (c.tipo === 'esquecer') { m.cal = null; m.centroLivre = null; gravarLocal(CHAVE_CAL, null); }
      if (c.tipo === 'centrar') m.centroLivre = null;
    }
    const f = Array.isArray(ctx.faceMesh) && ctx.faceMesh[0];
    let r = null;
    if (f) {
      const yaw = (p.inverterX && !m.cal ? -1 : 1) * (ctx.mirrored && !m.cal ? -1 : 1) * f.pose.yaw;
      const earV = earMedio(f.pts, ctx.w / ctx.h);
      // calibração em andamento: 1,6 s por posição, os primeiros 0,6 s descartados
      if (state.cal) {
        const C = state.cal, [nome, texto] = PASSOS[C.passo], dt = t - C.ini;
        mostrarAviso(`${texto} (${C.passo + 1}/5)`);
        if (dt > 0.6) (C.am[nome] ||= []).push([yaw, f.pose.pitch]);
        if (dt > 1.6) {
          C.passo++; C.ini = t;
          if (C.passo >= PASSOS.length) {
            const cal = montarCalibracao(C.am);
            state.cal = null;
            if (cal) { m.calibrar(cal); gravarLocal(CHAVE_CAL, cal); state.msg = 'calibrado'; mostrarAviso('Calibrado ✓'); setTimeout(() => mostrarAviso(''), 1200); }
            else { state.msg = 'calibração falhou: vire mais a cabeça'; mostrarAviso('Não deu: vire mais a cabeça e tente de novo'); setTimeout(() => mostrarAviso(''), 2500); }
          }
        }
      } else {
        r = m.passo(t, yaw, f.pose.pitch, earV);
        if (p.ligado && typeof window !== 'undefined') {
          moverCursor(r.x, r.y, r.pausado ? 'pausado' : r.olhosFechados ? 'fechado' : 'normal');
          if (r.clique) { const alvo = clicarEm(r.x, r.y); state.cliques++; state.ultimoAlvo = alvo ? (alvo.getAttribute('aria-label') || alvo.textContent || alvo.tagName).trim().slice(0, 40) : '—'; }
        }
      }
      state.ultYaw = yaw; state.ultPitch = f.pose.pitch; state.ultEar = earV;
    }
    if (!p.ligado) esconderCursor();
    publicar('u_mouse', {
      rosto: Boolean(f), x: m.x, y: m.y, pausado: m.pausado, cliques: state.cliques, ultimoAlvo: state.ultimoAlvo || '',
      calibrado: Boolean(m.cal), calibrando: state.cal ? state.cal.passo + 1 : 0, msg: state.msg || '',
      yaw: state.ultYaw, pitch: state.ultPitch, ear: state.ultEar,
    });
    if (!f) ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: 'Mouse por cabeça: nenhum rosto (precisa do «Malha do rosto» antes)', color: '#f472b6' });
    if (!state.descarga) {
      // nó removido ou pipeline trocado: o cursor some sozinho se o operador parar de rodar
      state.descarga = setInterval(() => { if (performance.now() / 1000 - (state.vivoEm || 0) > 1.5) { esconderCursor(); clearInterval(state.descarga); state.descarga = null; } }, 700);
    }
    state.vivoEm = performance.now() / 1000;
    return clone(src);
  },
};

export default [falarOp, mouseCabeca];
