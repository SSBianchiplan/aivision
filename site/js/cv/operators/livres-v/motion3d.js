/**
 * operators/livres-v/motion3d.js — motion3d.captura (CV-88 Motion 3D Studio).
 *
 * Captura de movimento ao vivo de UMA fonte do iaVision (câmera, arquivo, tela, YouTube):
 * YOLOX acha a pessoa, BlazePose segue o recorte e devolve os 33 pontos 2D e os 33 pontos 3D
 * "do mundo" (runtime/livres-v/pose3d.js — o mesmo modelo, nenhuma inferência a mais). Cada
 * pose vai para o canal (runtime/livres-v/canal.js), que suaviza com o One Euro do
 * GPlanSiS|ROBO, mede taxa e latência e grava a tomada que o Studio pede. As mãos da cadeia
 * (maos.gestos antes deste nó) vão junto, para o Studio desenhar os dedos; a malha do rosto
 * (rosto.malha antes deste nó) também, para a cabeça e as expressões do avatar (Studio v2).
 *
 * Fora do Studio o nó desenha o esqueleto verde-água sobre o vídeo; com o Studio aberto quem
 * desenha é o Studio. Processamento NO APARELHO: nenhum quadro sai do navegador. Ângulos e 3D
 * monocular são estimativas educacionais — não é laudo.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { resolverEspelho } from '../../runtime/livres-h/pose.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import { tempoDaFonte } from '../../runtime/livres-m/canal.js';
import { RastreadorMotion } from '../../runtime/livres-v/pose3d.js';
import { canalMotion } from '../../runtime/livres-v/canal.js';
import { bannerista } from '../livres-h/comum.js';
import { MotorMulti } from '../../runtime/livres-h/multi-pose.js';

const G = 'CV-88';
export const COR_MOCAP = '#2EF2D0';   // verde-água do Studio (acento do tema escuro)

/** Ligações do esqueleto desenhado (MediaPipe 33). */
export const LIGACOES = [
  [11, 12], [11, 23], [12, 24], [23, 24], [11, 13], [13, 15], [15, 19], [15, 17], [17, 19], [12, 14], [14, 16], [16, 20], [16, 18], [18, 20],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], [0, 2], [0, 5], [2, 7], [5, 8], [9, 10],
];

/**
 * Várias pessoas: estima todas, dá a cada uma uma VAGA estável (Ator 1…4) e publica, com o
 * Ator de menor número como principal: o principal no canal como sempre (suavização, gravação, retarget) e todos em
 * `atores` = [{ id, W, P, cx (centro do quadril, 0..1 da imagem NÃO espelhada), alt (altura 0..1) }].
 */
async function estimarAtores(state, prep, esp) {
  const lista = (await state.multi.estimar(prep)).filter((a) => a.W && a.P && !a.incoerente);
  const latMs = performance.now() - prep.t0;
  if (!lista.length) {
    canalMotion.publicar({ t: prep.tFonte, tCap: prep.tCap, P: null, W: null, w: prep.w, h: prep.h, latMs, img: prep.img, maos: prep.maos, rosto: prep.rosto, esp, atores: [] });
    return { sem: true };
  }
  // VAGAS estáveis "Ator 1…4": o ID do rastreador muda quando a trilha morre (pose a poucos Hz por
  // pessoa); a vaga fica com quem tem o mesmo ID ou, senão, com quem está mais perto de onde ela foi
  // vista (centro do quadril, tolerância pelo tamanho da pessoa), e sobrevive 6 s sem ser vista.
  const tS = prep.tFonte, vagas = state.vagas || (state.vagas = []);
  for (let k = vagas.length - 1; k >= 0; k--) if (tS - vagas[k].t > 6000 || tS < vagas[k].t - 2000) vagas.splice(k, 1);
  const obs = lista.map((a) => ({ a, x: (a.P[23].x + a.P[24].x) / 2, y: (a.P[23].y + a.P[24].y) / 2, tam: Math.max(20, a.caixa.y2 - a.caixa.y1) }));
  const livres = new Set(vagas);
  for (const o of obs) { const v = vagas.find((g) => g.idMM === o.a.id && livres.has(g)); if (v) { o.vaga = v; livres.delete(v); } }
  const pares = [];
  for (const o of obs) if (!o.vaga) for (const v of livres) { const d = Math.hypot(o.x - v.x, o.y - v.y) / o.tam; if (d < 1.5) pares.push({ o, v, d }); }
  pares.sort((a, b) => a.d - b.d);
  for (const { o, v, d } of pares) if (!o.vaga && livres.has(v)) { o.vaga = v; livres.delete(v); void d; }
  for (const o of obs) {
    if (o.vaga) continue;
    const usados = new Set(vagas.map((g) => g.n));
    let n = 1; while (usados.has(n)) n++;
    if (n > 4) continue;
    o.vaga = { n }; vagas.push(o.vaga);
  }
  for (const o of obs) if (o.vaga) Object.assign(o.vaga, { x: o.x, y: o.y, t: tS, idMM: o.a.id });
  // o Ator 1 (principal) roda em todo ciclo; os outros em rodízio (MotorMulti.alternar)
  const v1 = obs.find((o) => o.vaga && o.vaga.n === 1);
  state.multi.principalId = v1 ? v1.a.id : null;
  const atores = obs.filter((o) => o.vaga).sort((a, b) => a.vaga.n - b.vaga.n).map(({ a, vaga }) => {
    const hx = (a.P[23].x + a.P[24].x) / 2 / prep.w;
    return { id: vaga.n, W: a.W, P: a.P, cx: esp ? 1 - hx : hx, alt: (a.caixa.y2 - a.caixa.y1) / prep.h };
  });
  if (!atores.length) { canalMotion.publicar({ t: prep.tFonte, tCap: prep.tCap, P: null, W: null, w: prep.w, h: prep.h, latMs, img: prep.img, maos: prep.maos, rosto: prep.rosto, esp, atores: [] }); return { sem: true }; }
  const pri = atores[0];
  canalMotion.publicar({ t: prep.tFonte, tCap: prep.tCap, P: pri.P, W: pri.W, w: prep.w, h: prep.h, latMs, img: prep.img, maos: prep.maos, rosto: prep.rosto, esp, atores });
  state.principal = pri.id;
  return { P: pri.P, W: pri.W, w: prep.w, h: prep.h, atores };
}

export const motion3dCaptura = {
  op: 'motion3d.captura',
  label: 'Motion 3D — captura (Live Link)',
  group: G,
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Captura de movimento 3D ao vivo de uma câmera ou vídeo: BlazePose com os 33 pontos 3D do mundo, suavização ' +
        'One Euro (GPlanSiS|ROBO), taxa e latência, gravação de tomadas para o Motion 3D Studio (esqueleto 2D e 3D, ' +
        'retarget, BVH/GLB/JSON/CSV). Tudo no aparelho. 3D de uma câmera é estimado (escala e profundidade aproximadas).',
  params: {
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.4, label: 'Visibilidade mín.' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 4000, label: 'Re-detectar pessoa (ms)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms) — Update Rate' },
    suavizar: { type: 'bool', default: true, label: 'Suavizar (One Euro)' },
    minCorte: { type: 'float', min: 0.1, max: 10, step: 0.1, default: 1.2, label: 'One Euro: corte mín. (Hz)' },
    beta: { type: 'float', min: 0, max: 5, step: 0.05, default: 0.4, label: 'One Euro: beta' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar esqueleto (fora do Studio)' },
    pessoas: { type: 'int', min: 1, max: 4, step: 1, default: 1, label: 'Atores (várias pessoas: YOLOX + um BlazePose por pessoa)' },
    sincronizar: { type: 'enum', options: ['auto', 'sempre', 'nunca'], default: 'auto', label: 'Sincronizar imagem e pose (auto = arquivo e YouTube; câmera: previsão)' },
    maxAtrasoMs: { type: 'int', min: 50, max: 1500, step: 50, default: 500, label: 'Atraso máximo da imagem (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const esp = resolverEspelho(p.espelhada, ctx);
    if (!state.rast) state.rast = new RastreadorMotion();
    if (state.esp !== esp) { state.rast.zerar(); state.esp = esp; }
    const f = canalMotion.filtro();
    if (f.ligado !== p.suavizar || f.minCorte !== p.minCorte || f.beta !== p.beta) canalMotion.configurarFiltro({ ligado: p.suavizar, minCorte: p.minCorte, beta: p.beta });
    state.maos = Array.isArray(ctx.hands) ? ctx.hands : null;
    state.rosto = Array.isArray(ctx.faceMesh) ? ctx.faceMesh : null;   // rosto.malha antes na cadeia: expressões e cabeça do avatar
    // várias pessoas (Studio v2): o MotorMulti da Corrida em modo recorte, um RastreadorMotion por pessoa
    const multi = (p.pessoas | 0) > 1;
    if (multi && !state.multi) state.multi = new MotorMulti({ fonte: 'recorte', maxPessoas: p.pessoas | 0, detectarMs: 2500, alternar: true, fabrica: () => new RastreadorMotion() });
    if (multi) state.multi.configurar({ maxPessoas: p.pessoas | 0 });
    else if (state.multi) { state.multi = null; state.principal = null; }

    // instante do quadro (relógio da página, o mesmo do Viewport): a pose é desenhada no quadro dela
    const tCap = Number.isFinite(ctx.tQuadro) ? ctx.tQuadro : performance.now();
    schedule(state, p.everyMs,
      () => {
        if (quadroRepetido(state, src, ctx, { forcar: convergindo(state.rast, state.results) })) return null;
        const fv = tempoDaFonte();
        if (fv.video && fv.pausado && !ctx.fonteParada) return null;
        const t = fv.video ? fv.t * 1000 : performance.now();
        if (fv.video && state.tUlt != null && t === state.tUlt) return null;   // mesmo quadro do vídeo
        state.tUlt = t;
        // várias pessoas: o relógio é o da FONTE (vídeo em câmera lenta ou pausado não "envelhece" as trilhas)
        // vídeo voltou (laço, busca para trás): o rastreio multipessoa recomeça
        if (multi && state.tMulti != null && t < state.tMulti - 500) { state.multi.zerar(); state.vagas = []; }
        if (multi) state.tMulti = t;
        const prep = multi ? { ...state.multi.preparar(src, t, { esp }), multi: true } : state.rast.preparar(src, performance.now(), { esp, detectarMs: p.detectarMs });
        return { ...prep, tFonte: t, tCap, t0: performance.now(), maos: state.maos, rosto: state.rosto, img: canalMotion.precisaQuadro() ? clone(src) : null };
      },
      async (prep) => {
        if (prep.multi && state.multi) return estimarAtores(state, prep, esp);
        const r = await state.rast.estimar(prep);
        const latMs = performance.now() - prep.t0;
        const et = state.rast.etapas;
        if (et) { if (prep.det) canalMotion.etapa('det', et.det); canalMotion.etapa('recorte', et.recorte); canalMotion.etapa('pose', et.pose); }
        if (r.sem) {
          canalMotion.publicar({ t: prep.tFonte, tCap: prep.tCap, P: null, W: null, w: prep.w, h: prep.h, latMs, img: prep.img, maos: prep.maos, rosto: prep.rosto, esp });
          return { sem: true };
        }
        canalMotion.publicar({ t: prep.tFonte, tCap: prep.tCap, P: r.P, W: r.W, w: prep.w, h: prep.h, vis: r.vis, latMs, img: prep.img, maos: prep.maos, rosto: prep.rosto, esp, aquecendo: Boolean(r.aquecendo) });
        return { P: r.P, W: r.W, w: prep.w, h: prep.h };
      });

    // sincronia (components/video/sincronia.js no Viewport): a imagem de arquivo/YouTube é exibida
    // atrasada pela latência da pose + um período, e a pose desenhada é a DAQUELE quadro
    const sc = canalMotion.sincronizacao();
    // (nós salvos antes destes parâmetros não os têm: valem os padrões)
    const modoSinc = p.sincronizar || 'auto', maxAtraso = Number.isFinite(p.maxAtrasoMs) ? p.maxAtrasoMs : 500;
    if (modoSinc !== 'nunca' && sc.latMs != null) {
      // atraso com histerese (só muda quando a diferença passa de ~2/3 de quadro): atraso que oscila
      // a cada quadro faz o anel repetir/pular quadros e o vídeo do Studio tremer
      const alvo = Math.min(maxAtraso, sc.latMs + (sc.perMs || 0) + 8);
      if (state.atrasoSinc == null || alvo > state.atrasoSinc || state.atrasoSinc - alvo > 25) state.atrasoSinc = alvo;
      ctx.sincronia = { modo: modoSinc, atrasoMs: state.atrasoSinc };
    }
    if (state.inferMs) ctx.metrics['motion3d ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['motion3d erro'] = state.error;
    const R = state.results;
    const desenhar = p.desenhar && !canalMotion.studioAberto();
    const ban = bannerista(ctx.overlay, ctx);
    if (!R || R.sem) {
      ctx.metrics['motion3d'] = 'procurando a pessoa';
      if (desenhar) ban('Motion 3D: procurando a pessoa (corpo inteiro no quadro)…', '#FFD84D');
      return clone(src);
    }
    ctx.metrics['motion3d'] = R.W ? '3D ok' : '2D (sem 3D)';
    const st = canalMotion.estatisticas();
    if (st.gravando) ctx.metrics['motion3d ● REC'] = `${st.gravadas} poses`;
    if (!desenhar) return clone(src);
    // a pose do quadro EXIBIDO (interpolada com a sincronia; prevista na câmera ao vivo)
    const tEx = Number.isFinite(ctx.tExibir) ? ctx.tExibir : tCap;
    const D = (canalMotion.poseEm(tEx, { prever: !ctx.fonteParada }) || null);
    const PD = D && D.P && D.w ? D : R;
    const sx = ctx.w / PD.w, sy = ctx.h / PD.h;
    // visibilidade baixa (perna sob a saia, braço atrás do corpo): tracejado e esmaecido, nunca "certo"
    const VIS_MIN = 0.15;
    for (const [a, b] of LIGACOES) {
      const A = PD.P[a], B = PD.P[b];
      if (!A || !B || A.v < VIS_MIN || B.v < VIS_MIN) continue;
      const certo = A.v >= p.minVis && B.v >= p.minVis;
      ctx.overlay.push({ type: 'line', x1: A.x * sx, y1: A.y * sy, x2: B.x * sx, y2: B.y * sy, color: COR_MOCAP, width: certo ? 3 : 2, ...(certo ? {} : { dash: true, alpha: 0.45 }) });
    }
    for (let i = 0; i < 33; i++) {
      const A = PD.P[i];
      if (A && A.v >= VIS_MIN) ctx.overlay.push({ type: 'point', x: A.x * sx, y: A.y * sy, r: A.v >= p.minVis ? 3 : 2, color: '#E8FFFB', ...(A.v >= p.minVis ? {} : { alpha: 0.45 }) });
    }
    if (st.gravando) ban(`● REC Motion 3D · ${st.gravadas} poses`, '#f87171');
    return clone(src);
  },
};

export default [motion3dCaptura];
