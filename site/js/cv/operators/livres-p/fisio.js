/**
 * operators/livres-p/fisio.js — fisio.avaliar (CV-47 Fisio).
 *
 * Goniometria (ADM ativa por articulação e lado, máx/mín), Timed Up and Go
 * com fases e sentar-levantar 5× / 30 s. A pose é o mesmo caminho do Salto
 * (runtime/livres-h/pose.js: YOLOX acha a pessoa, BlazePose 33 pontos seguido
 * pelos auxiliares); a matemática em runtime/livres-p/fisio.js e a sessão do
 * paciente no canal (runtime/livres-p/canal.js), que o painel e o Studio leem.
 *
 * Tempo de cada amostra: o do VÍDEO num arquivo (o cronômetro do teste é o do
 * vídeo, exato ao quadro), o relógio do quadro capturado ao vivo. NÃO É
 * DISPOSITIVO MÉDICO: apoio à avaliação por profissional habilitado.
 */
import { clone } from '../../core.js';
import { ensure, schedule } from '../../runtime/opkit.js';
import { RastreadorPose, resolverEspelho, assinaturaQuadro } from '../../runtime/livres-h/pose.js';
import { quadroRepetido, convergindo } from '../../runtime/parado.js';
import { tempoDaFonte } from '../../runtime/livres-m/canal.js';
import { canalFisio, processar, cfgFisio, OPCOES_TESTE, OPCOES_ART, OPCOES_LADO } from '../../runtime/livres-p/canal.js';
import { ARTICULACOES, TESTES, REF, num } from '../../runtime/livres-p/fisio.js';
import { COR, esqueleto, bannerista } from '../livres-h/comum.js';

const G = 'CV-47';

export const fisioAvaliar = {
  op: 'fisio.avaliar',
  label: 'Fisio — goniometria e testes funcionais',
  group: G,
  model: 'pose',
  needs: ['yolox'],
  overlayOnly: true,
  desc: 'Fisioterapia pela câmera: amplitude articular (goniometria 2D por articulação e lado, máximo e mínimo), ' +
        'Timed Up and Go com as fases (levantar, ida, giro, volta, sentar) e sentar-levantar 5× e 30 s, com o tempo ' +
        'do vídeo exato ao quadro. Pose BlazePose no navegador. Studio Fisio com o perfil do paciente, curvas, ' +
        'tabela e relatório. Não é dispositivo médico.',
  params: {
    teste: { type: 'enum', options: Object.keys(OPCOES_TESTE), default: 'TUG', label: 'Teste' },
    articulacao: { type: 'enum', options: Object.keys(OPCOES_ART), default: ARTICULACOES.joelho_flexao.nome, label: 'Articulação (goniometria)' },
    lado: { type: 'enum', options: Object.keys(OPCOES_LADO), default: 'automático', label: 'Lado' },
    distanciaM: { type: 'float', min: 1, max: 10, step: 0.5, default: 3, label: 'Distância do TUG (m)' },
    fim5: { type: 'enum', options: ['5ª vez em pé', 'sentar após a 5ª'], default: '5ª vez em pé', label: 'Fim do 5×' },
    espelhada: { type: 'enum', options: ['automático', 'sim', 'não'], default: 'automático', label: 'Imagem espelhada (automático = segue a Fonte)' },
    minVis: { type: 'float', min: 0.1, max: 0.95, step: 0.05, default: 0.4, label: 'Visibilidade mín.' },
    detectarMs: { type: 'int', min: 1000, max: 30000, step: 500, default: 4000, label: 'Re-detectar pessoa (ms)' },
    everyMs: { type: 'int', min: 0, max: 1000, step: 10, default: 0, label: 'Intervalo mín. (ms)' },
  },
  apply(src, p, state, ctx) {
    if (!ensure('yolox', state, ctx)) return clone(src);
    if (!ensure('pose', state, ctx)) return clone(src);
    const esp = resolverEspelho(p.espelhada, ctx);
    const cfg = cfgFisio(p);
    if (!state.rast) state.rast = new RastreadorPose();
    if (state.esp !== esp) { state.rast.zerar(); state.esp = esp; }

    schedule(state, p.everyMs,
      () => {
        if (quadroRepetido(state, src, ctx, { forcar: convergindo(state.rast, state.results) })) return null;
        // instante da amostra: o do vídeo (arquivo) ou o do quadro capturado; monotônico (volta do vídeo = tentativa nova)
        const fv = tempoDaFonte();
        let t = fv.video ? fv.t * 1000 : performance.now();
        if (fv.video && fv.pausado && !ctx.fonteParada) return null;
        if (state.tUlt != null && t <= state.tUlt) {
          if (fv.video && t < state.tUlt) { canalFisio.descartar(); state.desloc = (state.desloc || 0) + (state.tUlt - t) + 1000; }
          else return null;   // mesmo quadro do vídeo
        }
        state.tUlt = t;
        const prep = state.rast.preparar(src, performance.now(), { esp, detectarMs: p.detectarMs });
        return { ...prep, tFonte: t + (state.desloc || 0), ass: assinaturaQuadro(src), img: canalFisio.studioAberto() ? clone(src) : null };
      },
      async (prep) => {
        const r = await state.rast.estimar(prep);
        if (r.sem) { canalFisio.publicar({ t: prep.tFonte, P: null, w: prep.w, h: prep.h, cfg, res: canalFisio.instantaneo()?.res || null, sem: true, tWall: performance.now() }); return { sem: true }; }
        if (r.aquecendo) return { P: r.P, w: prep.w, h: prep.h, aquecendo: true };
        const res = processar({ t: prep.tFonte, P: r.P, w: prep.w, h: prep.h, cfg, img: prep.img, vis: r.vis });
        return { P: r.P, w: prep.w, h: prep.h, res };
      });

    if (state.inferMs) ctx.metrics['fisio ms'] = state.inferMs.toFixed(0);
    if (state.error) ctx.metrics['fisio erro'] = state.error;
    const R = state.results;
    const ban = bannerista(ctx.overlay, ctx);
    const desenhar = !canalFisio.studioAberto();
    if (!R || R.sem) {
      ctx.metrics['fisio'] = 'procurando a pessoa';
      if (desenhar) ban('Fisio: procurando a pessoa (corpo inteiro no quadro)…', COR.aviso);
      return clone(src);
    }
    const sx = ctx.w / R.w, sy = ctx.h / R.h;
    if (desenhar) esqueleto(ctx.overlay, R.P, sx, sy, p.minVis);
    const res = R.res;
    ctx.metrics['fisio'] = `${TESTES[cfg.teste].curto}${res ? ' · ' + res.estado : ''}`;
    if (!desenhar || !res) return clone(src);
    if (cfg.teste === 'goniometria') {
      const A = ARTICULACOES[cfg.articulacao];
      ban(`${A.nome} · ${res.lado === 'e' ? 'esquerdo' : res.lado === 'd' ? 'direito' : '—'} · ${num(res.atual, 0)}°`, '#22d3ee');
      ban(`máx ${num(res.max, 0)}° · mín ${num(res.min, 0)}° · amplitude ${num(res.amplitude, 0)}° (ref. ${A.ref[1]}°)`, COR.ok);
      // arco na articulação medida
      const [a, b, c] = A.pontos(res.lado || 'e');
      const B = R.P[b];
      if (B && B.v >= p.minVis) ctx.overlay.push({ type: 'point', x: B.x * sx, y: B.y * sy, r: 7, color: '#FFD84D' });
      for (const k of [a, c]) {
        const Q = R.P[k];
        if (B && Q && B.v >= p.minVis && Q.v >= p.minVis) ctx.overlay.push({ type: 'line', x1: B.x * sx, y1: B.y * sy, x2: Q.x * sx, y2: Q.y * sy, color: '#FFD84D', width: 4 });
      }
      ctx.metrics['ADM'] = `${num(res.atual, 0)}° (máx ${num(res.max, 0)}°)`;
    } else {
      const sg = res.sinais;
      const corr = sg && sg.tInicio != null && res.estado !== 'concluído' ? (R.res && sg.ts.length ? (sg.ts[sg.ts.length - 1] - sg.tInicio) / 1000 : null) : null;
      const nome = TESTES[cfg.teste].nome;
      if (res.total != null) {
        const lim = cfg.teste === 'tug' ? REF.tug : cfg.teste === 'sts5' ? REF.sts5 : null;
        ban(`${nome}: ${cfg.teste === 'sts30' ? `${res.n} vezes em 30 s` : `${num(res.total, 2)} s`}`, lim != null && res.total >= lim ? COR.alerta : COR.ok);
      } else ban(`${nome} · ${res.estado}${corr != null ? ` · ${num(corr, 1)} s` : ''}`, '#22d3ee');
      if (cfg.teste !== 'tug' && res.n != null && res.total == null) ban(`vezes em pé: ${res.n}${res.restante != null ? ` · faltam ${num(res.restante, 0)} s` : ''}`, '#e5e7eb');
      for (const a of (res.avisos || []).slice(0, 1)) ban('⚠ ' + a, COR.alerta);
      const ult = canalFisio.ultimaTentativa;
      if (ult && res.estado !== 'em teste') ban(`último ${TESTES[ult.teste].curto}: ${ult.teste === 'sts30' ? `${ult.nRep} vezes` : `${num(ult.total, 2)} s`}`, '#94a3b8');
    }
    return clone(src);
  },
};

export default [fisioAvaliar];
