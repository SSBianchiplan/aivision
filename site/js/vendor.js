/**
 * vendor.js — ponte entre os UMD vendorizados e os ES modules do app.
 *
 * React/ReactDOM/htm são builds UMD carregados por <script> no index.html e
 * reexportados daqui como import normal. Assim nenhum outro arquivo toca em
 * `window`, e trocar por `npm install react` depois é só apagar este arquivo.
 *
 * ===================== POR QUE ISTO CARREGA SOZINHO =====================
 *
 * A versão anterior só CONFERIA se os globais existiam e lançava se não.
 * Bastava uma das três requisições falhar — servidor reiniciando, conexão
 * caindo, aba restaurada offline — para a página inteira morrer com
 * "Vendor não carregou", sem recuperação possível a não ser recarregar.
 *
 * Agora este módulo é AUTOSSUFICIENTE: se um global faltar, ele injeta o
 * script e espera, com uma tentativa de repetição. As tags no index.html
 * continuam existindo como caminho rápido (carregam em paralelo com o HTML);
 * quando funcionam, o await abaixo não custa nada.
 *
 * Top-level await exige module — que é exatamente como este arquivo é usado.
 * ========================================================================
 */

const VENDOR = [
  { global: 'React', src: 'vendor/react.js' },
  { global: 'ReactDOM', src: 'vendor/react-dom.js' },
  { global: 'htm', src: 'vendor/htm.js' },
];

/** Injeta um <script> clássico e resolve quando ele executa. */
function inject(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // cache-bust só na repetição: a primeira tentativa deve poder usar cache
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('falha ao carregar ' + src));
    document.head.appendChild(s);
  });
}

async function ensure({ global, src }) {
  if (window[global]) return;

  try {
    await inject(src);
  } catch (_) {
    // segunda tentativa furando cache: cobre resposta parcial ou 5xx transitório
    await new Promise((r) => setTimeout(r, 250));
    await inject(src + '?retry=' + Date.now());
  }

  if (!window[global]) {
    throw new Error(
      `${src} carregou mas não expôs window.${global}. ` +
      'O arquivo pode estar corrompido — baixe de novo o vendor.'
    );
  }
}

/*
 * Sequencial de propósito: ReactDOM depende de React já estar definido, e
 * são três arquivos pequenos (144 KB somados). Paralelizar aqui não ganharia
 * nada e arriscaria ordem.
 */
for (const v of VENDOR) {
  if (!window[v.global]) {
    try {
      await ensure(v);
    } catch (err) {
      const detail = location.protocol === 'file:'
        ? 'A página está sendo aberta por file://, que bloqueia ES modules e a ' +
          'câmera. Sirva a pasta: python serve.py'
        : `${err.message}. Confira se frontend/${v.src} existe e se o servidor ` +
          'está no ar.';
      throw new Error('Vendor indisponível — ' + detail);
    }
  }
}

export const React = window.React;
export const ReactDOM = window.ReactDOM;
export const html = window.htm.bind(React.createElement);

export const {
  useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect, Fragment,
} = React;
