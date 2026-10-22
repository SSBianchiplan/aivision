/**
 * operators/livres-k/beltscan.js — CV-36 Volumetria de correia (BeltScan).
 *
 * Lê a linha laser projetada sobre a correia, triangula a altura do produto
 * com a geometria da câmera e calcula seção, vazão, massa e os alarmes
 * ISA-18.2 (porte do GPlanSiS|BELTSCAN v4; a matemática está em
 * runtime/livres-k/beltscan.js). JS puro sobre ImageData: nenhum modelo.
 *
 *   - RESOLUÇÃO: a triangulação usa os pixels da câmera (ROI, referência e
 *     calibração estão em pixels do quadro). O pipeline roda em procWidth
 *     (480 por padrão), então o operador pede o quadro em resolução plena
 *     (ctx.grabFull, até `largura` px) e cai para o `src` sem ele.
 *   - TEMPO: arquivo de vídeo = tempo do vídeo (canal.tempoDaFonte); quadro
 *     repetido (o laço do app roda mais rápido que o vídeo) não é processado
 *     de novo, e vídeo pausado não acumula vazão nem volume.
 *   - FONTE PARADA (YouTube pausado, histórico repetido — ctx.fonteParada,
 *     ver runtime/parado.js): processa uma vez e trava, sem integrar.
 *   - ESPELHO: o quadro chega espelhado quando "Espelhar" está ligado; o
 *     núcleo lê as colunas desespelhadas e o overlay volta espelhado.
 *
 * EDITAR NA IMAGEM: a faixa de busca, as exclusões e a faixa de velocidade
 * podem ser marcações das ferramentas de mouse (funções bs_*, em
 * ctx.marcacoes); a sincronia com a configuração está em
 * runtime/livres-k/beltscan-marcas.js e roda aqui, a cada quadro.
 *
 * O overlay no vídeo do app mostra a faixa de busca, a referência vazia
 * (azul), a linha detectada (amarela; vermelha acima da altura limite) e a
 * altura limite projetada na imagem (âmbar). Com a tela cheia GPlanSiS|BeltScan
 * aberta, ele sai do vídeo do app (a tela cheia desenha o seu).
 */
import { clone } from '../../core.js';
import { quadroRepetido } from '../../runtime/parado.js';
import {
  obterMotor, publicar, tempoDaFonte, studioAberto, garantirPerfil, instantaneo,
} from '../../runtime/livres-k/canal.js';
import { sincronizar as sincronizarMarcas, porImagem } from '../../runtime/livres-k/beltscan-marcas.js';
import { numBR } from '../../numfmt.js';

const G = 'CV-36';
const fin = Number.isFinite;

function desenhar(ctx, r, esc, espelhado, W, banner, motor) {
  const ov = ctx.overlay;
  const X = (u) => (espelhado ? W - 1 - u : u) * esc;
  const Y = (v) => v * esc;
  const [x0, y0, x1, y1] = motor.roi;
  // com a faixa de busca marcada na imagem, quem a desenha (com alças) são as ferramentas de mouse
  if (!porImagem().busca) ov.push({ type: 'rect', x: Math.min(X(x0), X(x1 - 1)), y: Y(y0), w: Math.abs(X(x1 - 1) - X(x0)), h: Y(y1) - Y(y0), color: '#7FB2FF' });
  const passo = Math.max(2, Math.round(3 / Math.max(esc, 0.25)));
  // referência vazia (azul) e altura limite projetada (âmbar), em traços
  const linha = (arr, cor, larg, cond) => {
    let ant = -1;
    for (let u = x0; u < x1; u += passo) {
      const v = arr[u];
      if (!fin(v) || (cond && !cond(u))) { ant = -1; continue; }
      if (ant >= 0 && fin(arr[ant])) ov.push({ type: 'line', x1: X(ant), y1: Y(arr[ant]), x2: X(u), y2: Y(v), color: cor, width: larg });
      ant = u;
    }
  };
  if (r.ref) linha(r.ref, 'rgba(79,139,255,.85)', 1.2);
  if (r.limV) linha(r.limV, '#F2A900', 1.6);
  // linha laser detectada: amarela; vermelha onde o nível passa da altura limite
  const L = motor.C.limit;
  const acima = (u) => r.lvl && fin(r.lvl[u]) && r.lvl[u] > L.h_mm;
  linha(r.rows, '#FFE14D', 1.8, (u) => !acima(u));
  linha(r.rows, '#FF3B3B', 2.6, acima);
  if (banner) ov.push({ type: 'banner', x: 8, y: 8, text: banner, color: r.pr === 1 ? '#FF5A5A' : r.pr === 2 ? '#F2A900' : r.q === 'BOM' ? '#8CE0C8' : '#FFD84D' });
}

function textoBanner(r) {
  const f = (v, d) => (fin(v) ? numBR(v, d, d) : '—');
  if (r.q === 'SEM REF') return `BeltScan · ${r.modo === 'ref' ? 'capturando a referência vazia…' : 'sem referência: capture com a área vazia'}`;
  const b = r.bench || {};
  return `BeltScan · ${r.q} · seção ${f(b.A_b, 0)} mm² · v ${f(b.v_b, 1)} mm/s · ${f(b.Q_b, 1)} cm³/s · vol ${f(b.vol_b, 0)} cm³ · correia ${f(r.Q, 0)} m³/h${r.gate ? ' · ACIMA DO LIMITE' : ''}`;
}

export const volumetria = {
  op: 'beltscan.volumetria',
  label: 'BeltScan — volumetria de correia',
  group: G,
  overlayOnly: true,
  // entrada = ctx.grabFull; o quadro em procWidth só dá o tamanho (o Viewport lê a fonte uma vez só)
  quadroPleno: true,
  desc: 'Volumetria de correia transportadora por triangulação laser–câmera (porte do GPlanSiS|BELTSCAN): ' +
        'linha laser subpixel, altura pela geometria da câmera, seção DIN 22101, vazão, massa seca, ' +
        'nível representativo com altura limite e alarmes ISA-18.2; na bancada, seção × velocidade por ' +
        'correlação de fase. Configuração "beltscan/4" (a mesma do HTML e do Python). Abra a tela ' +
        'GPlanSiS|BeltScan para configurar, calibrar e acompanhar.',
  params: {
    largura: { type: 'int', min: 320, max: 1920, step: 160, default: 1280, label: 'Largura de análise (px; a configuração se reescala)' },
    desenhar: { type: 'bool', default: true, label: 'Desenhar no vídeo (linha, referência, limite)' },
    faixa: { type: 'bool', default: true, label: 'Faixa com seção, vazão e volume' },
  },
  apply(src, p, state, ctx) {
    const motor = obterMotor();
    garantirPerfil();
    const fonte = tempoDaFonte();
    // mesmo quadro do vídeo (laço mais rápido que o vídeo, ou pausado): não reprocessa
    const repetidoVideo = fonte.video && state.tVideo === fonte.t;
    const repetidoImagem = fonte.imagem && state.imagemFeita;
    const parado = quadroRepetido(state, src, ctx);    // YouTube pausado, histórico parado
    let r = instantaneo();
    if (!(repetidoVideo || repetidoImagem || parado) || !r) {
      const full = ctx.grabFull ? ctx.grabFull(p.largura) : null;
      const img = full && full.width >= src.width ? full : src;
      const t = fonte.imagem ? 0 : fonte.t;
      try {
        r = motor.processar(img, t, { espelhado: Boolean(ctx.mirrored), video: fonte.video });
      } catch (e) {
        ctx.metrics['BeltScan'] = 'erro: ' + (e && e.message ? e.message : e);
        return clone(src);
      }
      state.tVideo = fonte.video ? fonte.t : null;
      state.imagemFeita = Boolean(fonte.imagem);
      publicar(r, img);
    }
    if (!r) return clone(src);
    // faixa de busca, exclusões e faixa de velocidade editadas NA IMAGEM (ferramentas de mouse) ↔ configuração
    sincronizarMarcas(motor, ctx, r.W, r.H, Boolean(ctx.mirrored));
    const esc = src.width / r.W;
    if (p.desenhar && !studioAberto()) desenhar(ctx, r, esc, Boolean(ctx.mirrored), r.W, p.faixa ? textoBanner(r) : null, motor);
    const f1 = (v, d = 1) => (fin(v) ? v.toFixed(d) : '—');
    ctx.metrics['BeltScan'] = `${r.q} · cob ${f1(r.cov * 100, 0)} % · ${r.W}×${r.H}`;
    ctx.metrics['Seção bancada (mm²)'] = f1(r.bench && r.bench.A_b, 0);
    ctx.metrics['Vazão correia (m³/h)'] = f1(r.Q, 1);
    return clone(src);
  },
};

export default [volumetria];
