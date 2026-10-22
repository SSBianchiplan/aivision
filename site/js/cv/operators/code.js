/**
 * cv/operators/code.js — CV-10 leitura de QR Code e código de barras.
 *
 * O operador desenha o contorno do código sobre o vídeo e ABRE o painel de
 * leituras quando encontra algo novo. Esse "novo" é a parte que importa:
 * apontar a câmera para uma etiqueta produz o mesmo código 30 vezes por
 * segundo, e abrir um painel a cada frame seria inutilizável.
 *
 * A deduplicação é por texto, com uma janela de silêncio: o mesmo conteúdo
 * só volta a notificar depois de `repeatMs` sem aparecer. Assim, varrer uma
 * prateleira lê cada produto uma vez, e voltar a um código já lido depois de
 * um tempo registra de novo — que é o comportamento esperado numa conferência.
 */

import { clone } from '../core.js';
import { readCodes, ensureReader, backendName, FORMAT_LABEL, interpretar } from '../runtime/code.js';

/**
 * Histórico compartilhado entre o operador e o painel.
 *
 * Vive fora do React porque quem escreve é o loop de render, a até 60 Hz —
 * empurrar isso pelo estado do React faria a árvore inteira reconciliar a
 * cada frame. O painel se inscreve e é avisado só quando algo muda.
 */
class CodeLog {
  constructor() {
    this.items = [];
    this.max = 100;
    this.listeners = new Set();
    this.onNew = null;      // callback para abrir o painel
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.items);
  }

  /** Registra se for novo. Devolve o item quando notifica, senão null. */
  push(text, format, repeatMs) {
    const agora = Date.now();
    const igual = this.items.find((i) => i.text === text);
    if (igual) {
      igual.lastAt = agora;
      igual.count++;
      if (agora - igual.notifiedAt < repeatMs) {
        this.emit();
        return null;                 // dentro da janela de silêncio
      }
      igual.notifiedAt = agora;
      this.emit();
      return igual;
    }
    const item = {
      id: 'cod_' + agora.toString(36) + Math.random().toString(36).slice(2, 6),
      text, format,
      info: interpretar(text),
      firstAt: agora, lastAt: agora, notifiedAt: agora,
      count: 1,
    };
    this.items.unshift(item);
    if (this.items.length > this.max) this.items.length = this.max;
    this.emit();
    if (this.onNew) this.onNew(item);
    return item;
  }

  clear() {
    this.items = [];
    this.emit();
  }

  remove(id) {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit();
  }
}

export const codeLog = new CodeLog();

// ------------------------------------------------------------ operador

export const scanCode = {
  op: 'code.scan',
  label: 'QR / Código de barras',
  group: 'CV-10',
  overlayOnly: true,
  desc: 'Lê QR Code, EAN, Code 128, Data Matrix, PDF417 e mais 7 formatos. ' +
        'Usa o decodificador nativo do navegador quando existe e cai no ZXing ' +
        'vendorizado no Safari e Firefox, que não o têm. Cada leitura nova abre ' +
        'o painel de Códigos.',
  params: {
    everyMs: { type: 'int', min: 0, max: 2000, step: 50, default: 150, label: 'Intervalo (ms)' },
    repeatMs: { type: 'int', min: 500, max: 30000, step: 500, default: 4000, label: 'Repetir o mesmo após (ms)' },
    showText: { type: 'bool', default: true, label: 'Mostrar o conteúdo' },
    beep: { type: 'bool', default: true, label: 'Bipe na leitura' },
    /*
     * Resolução SÓ da leitura, independente do procWidth do pipeline.
     *
     * 960 px é o piso para código de barras funcionar de verdade: um EAN-13
     * tem 95 barras, e abaixo disso sobram menos de 3 pixels por barra
     * quando a etiqueta ocupa metade do quadro — com o desfoque de uma
     * câmera de celular a decodificação não fecha. Baixar isto acelera e
     * derruba a taxa de leitura; subir custa memória e tempo de cópia.
     */
    scanWidth: { type: 'enum', options: [480, 720, 960, 1280, 1600], default: 960,
                 label: 'Resolução da leitura' },
  },

  apply(src, p, state, ctx) {
    if (!state.ready) {
      if (!state.requested) {
        state.requested = true;
        ensureReader()
          .then(() => { state.ready = true; })
          .catch((e) => { state.error = String(e.message || e); });
      }
      ctx.metrics['leitor'] = state.error ? 'erro: ' + state.error : 'preparando…';
      return clone(src);
    }

    const agora = performance.now();
    if (!state.busy && (!state.lastRun || agora - state.lastRun >= p.everyMs)) {
      state.busy = true;
      state.lastRun = agora;
      /*
       * A leitura NÃO usa o quadro do pipeline.
       *
       * O pipeline roda em procWidth para segurar o fps, e o modo automático
       * baixa mais ainda num celular. Isso não atrapalha caixa de detecção
       * nem segmentação, mas destrói código de barras: a 480 px cada barra
       * de um EAN-13 fica com ~2 pixels, e com desfoque real não decodifica.
       * Era exatamente esta a falha — QR passava porque tem alvo de
       * enquadramento grande e correção de erro; barras não têm nem um nem
       * outro.
       *
       * `grabFull` devolve o quadro original. Quando não existe (teste fora
       * do navegador), cai para `src`, e o operador continua funcionando.
       */
      const cheio = ctx.grabFull ? ctx.grabFull(p.scanWidth) : null;
      const base = cheio || src;
      const img = cheio || copyOf(src);
      const w = base.width, h = base.height;
      state.scanPx = `${w}×${h}` + (cheio ? '' : ' (pipeline)');

      readCodes(img)
        .then((found) => {
          state.results = found.map((f) => ({
            text: f.text,
            format: f.format,
            corners: (f.corners || []).map((c) => ({ x: c.x / w, y: c.y / h })),
            box: f.box
              ? { x: f.box.x / w, y: f.box.y / h, w: f.box.w / w, h: f.box.h / h }
              : null,
          }));
          for (const f of found) {
            const novo = codeLog.push(f.text, f.format, p.repeatMs);
            if (novo && p.beep) bip();
          }
          state.error = null;
        })
        .catch((e) => { state.error = String(e && e.message ? e.message : e); })
        .finally(() => { state.busy = false; });
    }

    for (const r of state.results || []) {
      // contorno pelos cantos quando o decodificador os dá: um QR torto tem
      // quatro cantos, e a caixa alinhada aos eixos mentiria sobre a posição
      if (r.corners.length >= 3) {
        for (let i = 0; i < r.corners.length; i++) {
          const a = r.corners[i], b = r.corners[(i + 1) % r.corners.length];
          ctx.overlay.push({
            type: 'line',
            x1: a.x * ctx.w, y1: a.y * ctx.h,
            x2: b.x * ctx.w, y2: b.y * ctx.h,
            color: '#4ade80', width: 2.5,
          });
        }
      }
      if (r.box) {
        ctx.overlay.push({
          type: 'rect',
          x: r.box.x * ctx.w, y: r.box.y * ctx.h,
          w: r.box.w * ctx.w, h: r.box.h * ctx.h,
          color: r.corners.length >= 3 ? 'rgba(74,222,128,.35)' : '#4ade80',
          label: p.showText
            ? `${FORMAT_LABEL[r.format] || r.format}: ${corta(r.text, 26)}`
            : (FORMAT_LABEL[r.format] || r.format),
        });
      }
    }

    // para os operadores seguintes (logistica.etiqueta, logistica.pallet): { text, format, box, corners } em 0–1
    ctx.codigos = state.results || [];
    ctx.metrics['códigos'] = (state.results || []).length;
    ctx.metrics['lidos'] = codeLog.items.length;
    ctx.metrics['leitor'] = backendName();
    // mostrar a resolução real da varredura evita a suspeita silenciosa de
    // que "não lê" quando na verdade está lendo num quadro pequeno demais
    if (state.scanPx) ctx.metrics['varredura'] = state.scanPx;
    if (state.error) ctx.metrics['leitor erro'] = state.error;
    return clone(src);
  },
};

const corta = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

function copyOf(src) {
  const out = new ImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

/**
 * Bipe da leitura, sintetizado.
 *
 * Um arquivo de áudio custaria um download e uma decisão de licença por um
 * som de 80 ms. O oscilador do WebAudio resolve com uma dúzia de linhas e
 * zero bytes de rede.
 */
let audioCtx = null;
function bip() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, t);
    // envelope curto: sem o fade o corte abrupto vira um clique audível
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch (_) {
    // som é enfeite: nunca pode derrubar a leitura
  }
}

export default [scanCode];
