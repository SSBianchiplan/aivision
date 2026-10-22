/**
 * cv/operators/livres-u/sala.js — CV-83 Sala de aula.
 *
 *   educacao.gabarito         correção de folha-resposta (OMR) com a folha-modelo
 *                             imprimível do painel: 4 cantos pretos → homografia →
 *                             cada bolha; a folha entra na lista quando a mesma leitura
 *                             se repete N vezes. Nota e CSV no painel.
 *   educacao.maos_levantadas  quantas mãos levantadas agora (pose RTMO), máximo e série
 *                             por segundo — SEM identificar ninguém (só contagem).
 */
import { clone } from '../../core.js';
import { publicar, tomar, tempoDe, conferirGeracao } from '../../runtime/livres-u/canal.js';
import { layoutGabarito, lerGabarito, corrigir, lerChave, maoLevantada } from '../../runtime/livres-u/sala.js';
import { aplicarH } from '../../runtime/livres-u/imagem.js';
import { pessoasComId } from '../../runtime/livres-oa/nucleo.js';

const G = 'CV-83';

export const gabarito = {
  op: 'educacao.gabarito',
  label: 'Correção de gabarito (OMR)',
  group: G,
  desc: 'Corrige folhas-resposta impressas pelo painel (botão «Folha-modelo»): acha os 4 cantos pretos, lê cada bolha, ' +
        'aponta branco, dupla marcação e marca incerta, lê a matrícula e dá a nota contra a chave. Cada folha entra na ' +
        'lista quando a leitura se repete; CSV no painel. Marque a área «Gabarito · folha» ou use o quadro inteiro.',
  params: {
    questoes: { type: 'int', min: 1, max: 200, step: 1, default: 20, label: 'Questões' },
    alternativas: { type: 'int', min: 2, max: 8, step: 1, default: 5, label: 'Alternativas' },
    colunas: { type: 'int', min: 1, max: 4, step: 1, default: 2, label: 'Colunas na folha' },
    digitos: { type: 'int', min: 0, max: 8, step: 1, default: 4, label: 'Dígitos da matrícula' },
    chave: { type: 'text', default: '', max: 600, label: 'Chave (ABCDE… ou 1A 2C…; * anula)' },
    marca: { type: 'float', min: 0.2, max: 0.9, step: 0.05, default: 0.5, label: 'Bolha cheia a partir de' },
    repeticoes: { type: 'int', min: 1, max: 10, step: 1, default: 3, label: 'Leituras iguais para registrar' },
    intervaloMs: { type: 'int', min: 100, max: 3000, step: 50, default: 350, label: 'Intervalo entre leituras (ms)' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_gabarito', state) || !state.folhas) { state.folhas = []; state.ultReg = null; state.igual = 0; state.antTexto = null; state.semFolha = 0; }
    const cfg = { questoes: p.questoes, alternativas: p.alternativas, colunas: p.colunas, digitos: p.digitos };
    const chaveCfg = JSON.stringify(cfg);
    if (state.cfg !== chaveCfg) { state.cfg = chaveCfg; state.L = layoutGabarito(cfg); }
    const L = state.L;
    let forcar = false;
    for (const c of tomar('u_gabarito')) { if (c.tipo === 'registrar') forcar = true; if (c.tipo === 'apagar') state.folhas.splice(c.i, 1); }
    const agora = performance.now();
    const area = ctx.marcacoes && ctx.marcacoes.itens.find((i) => i.funcao === 'gabarito' && i.caixa);
    if (L.ok && (!state.tLeit || agora - state.tLeit >= p.intervaloMs || forcar)) {
      state.tLeit = agora;
      // resolução plena quando o hospedeiro oferece (as bolhas são pequenas)
      const full = ctx.grabFull ? ctx.grabFull(1800) : null;
      const img = full || src;
      const sx = img.width / ctx.w, sy = img.height / ctx.h;
      const roi = area ? { x: area.caixa.x1 * img.width, y: area.caixa.y1 * img.height, w: (area.caixa.x2 - area.caixa.x1) * img.width, h: (area.caixa.y2 - area.caixa.y1) * img.height } : null;
      const r = lerGabarito(img, roi, L);
      if (r.ok) {
        const c = corrigir(r, lerChave(p.chave), { marca: p.marca, vazio: Math.min(0.3, p.marca * 0.5) });
        const texto = c.matricula + '|' + c.respostas.map((x, i) => x || c.estados[i][0]).join('');
        state.igual = texto === state.antTexto ? state.igual + 1 : 1;
        state.antTexto = texto;
        const ox = roi ? roi.x : 0, oy = roi ? roi.y : 0;
        state.vis = { c, H: r.H, ox, oy, sx, sy };
        if ((state.igual >= p.repeticoes && texto !== state.ultReg) || forcar) {
          state.ultReg = texto;
          const { t, relogio } = tempoDe(ctx);
          state.folhas.push({ n: state.folhas.length + 1, t, relogio, quando: Date.now(), ...c });
        }
        state.motivo = '';
      } else {
        state.motivo = r.motivo; state.vis = null; state.igual = 0;
        // a folha saiu: a mesma folha pode ser registrada de novo depois (2ª via)
        if (state.semFolha++ > 6) state.ultReg = null;
        publicar('u_gabarito', { folhas: state.folhas, atual: null, motivo: state.motivo, erroLayout: L.erro, chave: lerChave(p.chave).length });
        return clone(src);
      }
      state.semFolha = 0;
    }
    const V = state.vis;
    if (V) {
      const chave = lerChave(p.chave);
      for (const b of L.bolhas) {
        const resp = V.c.respostas[b.q], est = V.c.estados[b.q], letra = 'ABCDEFGH'[b.alt];
        if (!(resp === letra || (est !== 'ok' && est !== 'branco'))) continue;
        const [x, y] = aplicarH(V.H, b.x, b.y);
        const cor = est !== 'ok' ? '#FFD84D' : !chave[b.q] ? '#38bdf8' : chave[b.q] === letra ? '#4ade80' : '#f87171';
        ctx.overlay.push({ type: 'point', x: (x + V.ox) / V.sx, y: (y + V.oy) / V.sy, r: 4, color: cor });
      }
      const nota = V.c.nota != null ? ` · nota ${V.c.nota.toFixed(1).replace('.', ',')}` : '';
      ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Gabarito: ${V.c.acertos}/${V.c.total || '—'}${nota} · matr. ${V.c.matricula || '—'}`, color: '#4ade80' });
    } else if (state.motivo) ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Gabarito: ${state.motivo}`, color: '#FFD84D' });
    if (!L.ok) ctx.overlay.push({ type: 'banner', x: 8, y: 32, text: `Gabarito: ${L.erro}`, color: '#f87171' });
    publicar('u_gabarito', { folhas: state.folhas, atual: V ? V.c : null, motivo: state.motivo, erroLayout: L.erro, chave: lerChave(p.chave).length });
    return clone(src);
  },
};

export const maosLevantadas = {
  op: 'educacao.maos_levantadas',
  label: 'Mãos levantadas (sala)',
  group: G,
  desc: 'Conta as mãos levantadas na sala pela pose (punho acima da cabeça, cotovelo alto), com tempo mínimo para ' +
        'confirmar. Só contagem: ninguém é identificado e nada da imagem é guardado. Máximo e série por segundo no painel.',
  params: {
    conf: { type: 'float', min: 0.1, max: 0.9, step: 0.05, default: 0.3, label: 'Confiança dos pontos' },
    segurarS: { type: 'float', min: 0, max: 3, step: 0.1, default: 0.5, label: 'Mão no alto por (s)' },
    mostrar: { type: 'bool', default: true, label: 'Marcar as mãos no vídeo' },
  },
  apply(src, p, state, ctx) {
    if (conferirGeracao('u_maos', state) || !state.serie) { state.serie = []; state.max = 0; state.eventos = 0; state.cima = new Map(); }
    const { t } = tempoDe(ctx);
    const pes = pessoasComId(ctx, state);
    let n = 0;
    const vivos = new Set();
    for (const ps of pes) {
      vivos.add(ps.id);
      const lv = maoLevantada(ps.kp, p.conf, ctx.w / ctx.h);
      const e = state.cima.get(ps.id) || { desde: null, ativa: false, fora: null };
      if (lv) { e.fora = null; if (e.desde == null) e.desde = t; if (!e.ativa && t - e.desde >= p.segurarS) { e.ativa = true; state.eventos++; } }
      else { e.desde = null; if (e.fora == null) e.fora = t; if (e.ativa && t - e.fora >= 0.4) e.ativa = false; }
      state.cima.set(ps.id, e);
      if (e.ativa) {
        n++;
        if (p.mostrar) {
          const k = ps.kp, pts = [9, 10].map((i) => k[i]).filter((q) => q && q.score >= p.conf && (!k[0] || q.y < (k[0].y || 1)));
          for (const q of pts) ctx.overlay.push({ type: 'rect', x: q.x * ctx.w - 14, y: q.y * ctx.h - 14, w: 28, h: 28, color: '#FFD84D', label: '✋' });
        }
      }
    }
    for (const id of [...state.cima.keys()]) if (!vivos.has(id)) state.cima.delete(id);
    state.max = Math.max(state.max, n);
    const seg = Math.floor(t);
    const ult = state.serie[state.serie.length - 1];
    if (!ult || ult.s !== seg) { state.serie.push({ s: seg, n }); if (state.serie.length > 3600) state.serie.shift(); } else ult.n = Math.max(ult.n, n);
    publicar('u_maos', { agora: n, max: state.max, eventos: state.eventos, pessoas: pes.length, serie: state.serie.slice(-600) });
    ctx.metrics['mãos levantadas'] = n;
    ctx.overlay.push({ type: 'banner', x: 8, y: 8, text: `Mãos levantadas: ${n} (máx. ${state.max}) · ${pes.length} pessoa(s)`, color: '#FFD84D' });
    return clone(src);
  },
};

export default [gabarito, maosLevantadas];
