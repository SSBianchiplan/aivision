/**
 * components/CodePanel.js — painel de leituras de código.
 *
 * Abre sozinho na primeira leitura (ver app.js) e acumula o histórico. O
 * conteúdo é INTERPRETADO, não só exibido: um QR com uma URL vira um link,
 * um com WIFI: mostra rede e senha separadas, um EAN-13 é identificado como
 * produto. Jogar o texto cru na tela transferiria esse trabalho ao usuário.
 */

import { html, useState, useEffect } from '../vendor.js';
import { Panel } from './Panel.js';
import { codeLog } from '../cv/operators/code.js';
import { FORMAT_LABEL, backendName } from '../cv/runtime/code.js';

const ICONE = {
  url: '🔗', wifi: '📶', vcard: '👤', email: '✉️', tel: '📞',
  evento: '📅', pix: '💠', produto: '🏷️', texto: '📄',
};

export function CodePanel({ onClose, ...layout }) {
  const [items, setItems] = useState(() => codeLog.items);
  const [copiado, setCopiado] = useState(null);

  useEffect(() => codeLog.subscribe((l) => setItems([...l])), []);

  const copiar = async (t, id) => {
    try {
      await navigator.clipboard.writeText(t);
      setCopiado(id);
      setTimeout(() => setCopiado(null), 1400);
    } catch (_) {
      /*
       * Clipboard bloqueado (contexto inseguro, permissão negada). O
       * fallback do textarea+execCommand ainda funciona em todo lugar.
       */
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopiado(id); setTimeout(() => setCopiado(null), 1400); }
      catch (_) { /* desistir em silêncio é melhor que um alerta */ }
      document.body.removeChild(ta);
    }
  };

  const exportar = () => {
    const linhas = [['quando', 'formato', 'tipo', 'conteudo', 'vezes'].join(';')]
      .concat(items.map((i) => [
        new Date(i.firstAt).toISOString(),
        FORMAT_LABEL[i.format] || i.format,
        i.info.rotulo,
        '"' + String(i.text).replace(/"/g, '""') + '"',
        i.count,
      ].join(';')));
    // BOM: sem ele o Excel abre acento quebrado
    const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `codigos-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return html`
    <${Panel} id="codes" title="Códigos"
              subtitle=${items.length ? `${items.length} leitura(s)` : 'QR e barras'}
              onClose=${onClose} ...${layout}>

      ${items.length === 0 && html`
        <p class="empty">
          Nenhuma leitura ainda.<br />
          Adicione <b>QR / Código de barras</b> ao pipeline e aponte a câmera.
        </p>
        <p class="hint tight">Decodificador: <b>${backendName()}</b></p>
      `}

      ${items.length > 0 && html`
        <div class="row">
          <button class="btn" onClick=${exportar}>Exportar CSV</button>
          <button class="btn" onClick=${() => codeLog.clear()}>Limpar</button>
        </div>
      `}

      ${items.map((i) => html`
        <div key=${i.id} class="code ${i.info.tipo}">
          <div class="code-h">
            <span class="code-ic">${ICONE[i.info.tipo] || '📄'}</span>
            <div class="code-t">
              <b>${i.info.rotulo}</b>
              <em>${FORMAT_LABEL[i.format] || i.format}
                ${i.count > 1 ? ` · ${i.count}×` : ''}
                · ${new Date(i.firstAt).toLocaleTimeString('pt-BR')}</em>
            </div>
            <button class="code-x" onClick=${() => codeLog.remove(i.id)}
                    title="Remover" aria-label="Remover leitura">✕</button>
          </div>

          ${i.info.campos
            ? html`
              <div class="code-fields">
                ${Object.entries(i.info.campos)
                  .filter(([, v]) => v)
                  .map(([k, v]) => html`
                    <div key=${k}><span>${k}</span><code>${v}</code></div>`)}
              </div>`
            : html`<code class="code-val">${i.text}</code>`}

          ${i.info.extra && html`<div class="code-extra">${i.info.extra}</div>`}

          <div class="row tight">
            <button class="btn tiny" onClick=${() => copiar(i.text, i.id)}>
              ${copiado === i.id ? '✓ copiado' : 'Copiar'}
            </button>
            ${i.info.acao === 'abrir' && html`
              <a class="btn tiny" href=${i.text} target="_blank" rel="noopener noreferrer">
                Abrir ↗
              </a>`}
            ${i.info.tipo === 'produto' && html`
              <a class="btn tiny"
                 href=${'https://www.google.com/search?q=' + encodeURIComponent(i.text)}
                 target="_blank" rel="noopener noreferrer">Buscar ↗</a>`}
          </div>
        </div>
      `)}

      ${items.length > 0 && html`
        <p class="hint tight">
          O mesmo código só é registrado de novo depois da janela de silêncio
          configurada no operador — senão apontar a câmera para uma etiqueta
          geraria dezenas de entradas por segundo.
        </p>
      `}
    <//>
  `;
}
