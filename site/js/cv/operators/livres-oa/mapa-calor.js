/**
 * cv/operators/livres-oa/mapa-calor.js — cena.mapa_calor (CV-37, Ferramentas de
 * cena): o mapa de calor da Quadra (CV-35) generalizado para qualquer cena.
 *
 * A Quadra acumula o tempo de cada jogador numa grade do PISO (depois da
 * homografia); aqui a grade é a da IMAGEM e os objetos são os da cadeia —
 * caixas do detector (pessoas na loja, empilhadeiras), poses ou rostos —
 * pelo ponto da base (pés) ou o centro. Cada célula soma os SEGUNDOS de
 * presença (como na Quadra) e a cor vai de transparente a amarelo e
 * vermelho com a raiz do valor normalizado (a mesma escala da Quadra).
 * Opcional: meia-vida (o calor antigo esfria) e só dentro das zonas.
 *
 * Diferente dos outros operadores de cena, este PINTA a imagem (o calor
 * vai junto na gravação e no PNG); "Borrar rostos" pode vir depois.
 */
import { clone, camadaNova, camadaPor, usarCamada } from '../../core.js';
import { publicar, conferirGeracao, tempoDe } from '../../runtime/livres-oa/canal.js';

const G = 'CV-37';

/** Cor do calor (0..1): transparente → amarelo → vermelho (a mesma rampa do relatório da Quadra). */
export function corCalor(v) {
  const a = Math.min(1, v * 1.4);
  const g = Math.round(216 * (1 - Math.max(0, v - 0.35) / 0.65));
  return [255, Math.max(40, g), 40, a];
}

/** Objetos da cadeia como pontos { x, y } normalizados. */
function pontos(ctx, p) {
  const out = [];
  const add = (b) => {
    if (!b || !Number.isFinite(b.x1)) return;
    out.push({ x: (b.x1 + b.x2) / 2, y: p.ponto === 'centro' ? (b.y1 + b.y2) / 2 : b.y2, name: String(b.name || '').toLowerCase() });
  };
  const f = p.fonte, auto = f === 'automático';
  if ((auto || f === 'detecções') && Array.isArray(ctx.detections) && ctx.detections.length) { ctx.detections.forEach(add); return out; }
  if ((auto || f === 'poses') && Array.isArray(ctx.poses) && ctx.poses.length) { ctx.poses.forEach((q) => add(q.box)); return out; }
  if ((auto || f === 'rostos') && Array.isArray(ctx.faceMesh) && ctx.faceMesh.length) { ctx.faceMesh.forEach((r) => add(r.box)); return out; }
  return out;
}

export const mapaCalor = {
  op: 'cena.mapa_calor',
  label: 'Mapa de calor (permanência)',
  group: G,
  overlayOnly: true,   // o calor vai numa camada do tamanho da grade, esticada pela GPU sobre o vídeo nítido
  desc: 'Acumula onde os objetos da cadeia (pessoas do detector, poses…) passam o tempo, numa grade sobre a imagem, ' +
        'e pinta o calor por cima do vídeo — o mapa de calor da Quadra fora da quadra (loja, fila, corredor, galpão). ' +
        'Segundos de presença por célula, meia-vida opcional, PNG e CSV no painel Medições.',
  params: {
    fonte: { type: 'enum', options: ['automático', 'detecções', 'poses', 'rostos'], default: 'automático', label: 'Objetos de' },
    ponto: { type: 'enum', options: ['base (pés)', 'centro'], default: 'base (pés)', label: 'Ponto de referência' },
    classes: { type: 'text', default: '', max: 200, label: 'Só estas classes (vírgula; vazio = todas)' },
    grade: { type: 'int', min: 8, max: 96, step: 4, default: 40, label: 'Células na largura' },
    raio: { type: 'int', min: 0, max: 4, step: 1, default: 1, label: 'Espalhar (células vizinhas)' },
    meiaVidaS: { type: 'int', min: 0, max: 86400, step: 30, default: 0, label: 'Meia-vida do calor (s; 0 = acumula tudo)' },
    soZonas: { type: 'bool', default: false, label: 'Só dentro das zonas desenhadas' },
    opacidade: { type: 'float', min: 0, max: 1, step: 0.05, default: 0.55, label: 'Opacidade' },
    mostrar: { type: 'bool', default: true, label: 'Pintar o calor no vídeo' },
  },
  apply(src, p, state, ctx) {
    const { w, h } = ctx;
    const gx = p.grade, gy = Math.max(4, Math.round((p.grade * h) / w));
    if (conferirGeracao('mapa_calor', state) || !state.m || state.gx !== gx || state.gy !== gy) {
      state.m = new Float32Array(gx * gy); state.gx = gx; state.gy = gy; state.tAnt = null; state.total = 0;
    }
    const { t } = tempoDe(ctx);
    let dt = state.tAnt == null ? 0 : t - state.tAnt;
    if (!(dt > 0) || dt > 1) dt = dt > 1 ? 1 / 30 : 0;   // pausa, salto no vídeo: não conta o buraco
    state.tAnt = t;
    if (ctx.fonteParada) dt = 0;
    const m = state.m;
    if (p.meiaVidaS > 0 && dt > 0) {
      const k = Math.pow(0.5, dt / p.meiaVidaS);
      for (let i = 0; i < m.length; i++) m[i] *= k;
    }
    const filtro = String(p.classes || '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    const zonas = p.soZonas && ctx.marcacoes ? ctx.marcacoes.itens.filter((i) => i.funcao === 'zona' && i.caixa) : null;
    let pts = pontos(ctx, p);
    if (filtro.length) pts = pts.filter((o) => filtro.some((c) => o.name.includes(c)));
    if (zonas) pts = pts.filter((o) => zonas.some((z) => o.x >= z.caixa.x1 && o.x <= z.caixa.x2 && o.y >= z.caixa.y1 && o.y <= z.caixa.y2));
    if (dt > 0) {
      const R = p.raio;
      for (const o of pts) {
        const cx = Math.min(gx - 1, Math.max(0, Math.floor(o.x * gx))), cy = Math.min(gy - 1, Math.max(0, Math.floor(o.y * gy)));
        // núcleo gaussiano pequeno: soma 1 × dt
        let soma = 0;
        for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) soma += Math.exp(-(xx * xx + yy * yy) / (2 * Math.max(0.5, R / 1.5) ** 2));
        for (let yy = -R; yy <= R; yy++) {
          const y = cy + yy; if (y < 0 || y >= gy) continue;
          for (let xx = -R; xx <= R; xx++) {
            const x = cx + xx; if (x < 0 || x >= gx) continue;
            m[y * gx + x] += (dt * Math.exp(-(xx * xx + yy * yy) / (2 * Math.max(0.5, R / 1.5) ** 2))) / soma;
          }
        }
        state.total += dt;
      }
    }
    let max = 0;
    for (let i = 0; i < m.length; i++) if (m[i] > max) max = m[i];
    ctx.metrics['calor máx. (s)'] = max.toFixed(1);
    publicar('mapa_calor', { gx, gy, m, max, total: state.total, w, h });
    if (!p.mostrar || max <= 0 || p.opacidade <= 0) return clone(src);
    /*
     * Camada do tamanho da GRADE (40×23 por padrão), não do quadro: a GPU a
     * estica com interpolação bilinear — a mesma que era feita aqui pixel a
     * pixel. Remontada só quando o calor muda (há objetos ou meia-vida).
     */
    if (dt > 0 || !state.versao) state.versao = (state.versao | 0) + 1;
    const prim = camadaPor(state, [state.versao, m, max, p.opacidade, w, h], () => {
      const L = camadaNova(gx, gy), cd = L.data;
      for (let i = 0; i < m.length; i++) {
        const c = corCalor(Math.sqrt(m[i] / max));
        cd[i * 4] = c[0]; cd[i * 4 + 1] = c[1]; cd[i * 4 + 2] = c[2]; cd[i * 4 + 3] = c[3] * p.opacidade * 255;
      }
      return L;
    });
    if (prim) { prim.w = w; prim.h = h; }
    return usarCamada(src, ctx, prim);
  },
};

export default [mapaCalor];
