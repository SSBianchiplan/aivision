/**
 * cv/runtime/code.js — leitura de QR Code e códigos de barras.
 *
 * ================== DOIS CAMINHOS, E POR QUE OS DOIS ==================
 *
 * 1. BarcodeDetector, quando existe. É nativo do navegador, decodifica em
 *    código de máquina e no Android costuma usar o mesmo motor da câmera do
 *    sistema. Não custa download nenhum.
 *
 * 2. ZXing vendorizado, quando não existe. É o caso do Safari (iOS e macOS)
 *    e do Firefox, que não implementam BarcodeDetector — ou seja, metade dos
 *    aparelhos em que este sistema vai rodar. Sem o segundo caminho, o
 *    módulo simplesmente não funcionaria em iPhone.
 *
 * O carregamento do ZXing é preguiçoso: 336 KB só descem se o navegador
 * precisar deles.
 * ======================================================================
 */

/** Formatos pedidos ao decodificador, em ordem de utilidade prática. */
export const FORMATS = [
  'qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8',
  'upc_a', 'upc_e', 'itf', 'codabar', 'data_matrix', 'pdf417', 'aztec',
];

/** Rótulos legíveis, para a interface não mostrar `ean_13`. */
export const FORMAT_LABEL = {
  qr_code: 'QR Code',
  code_128: 'Code 128',
  code_39: 'Code 39',
  ean_13: 'EAN-13',
  ean_8: 'EAN-8',
  upc_a: 'UPC-A',
  upc_e: 'UPC-E',
  itf: 'ITF',
  codabar: 'Codabar',
  data_matrix: 'Data Matrix',
  pdf417: 'PDF417',
  aztec: 'Aztec',
  unknown: 'desconhecido',
};

let backend = null;      // 'native' | 'zxing'
let detector = null;
let zxingPromise = null;

export function backendName() {
  return backend === 'native' ? 'BarcodeDetector (nativo)'
       : backend === 'zxing' ? 'ZXing (vendorizado)'
       : 'não iniciado';
}

/** Prepara o decodificador. Idempotente. */
export async function ensureReader() {
  if (detector) return backend;

  if ('BarcodeDetector' in window) {
    try {
      /*
       * getSupportedFormats() importa: em algumas plataformas o
       * BarcodeDetector existe mas só decodifica QR. Pedir um formato não
       * suportado faz o construtor lançar, então filtramos antes.
       */
      const disp = await window.BarcodeDetector.getSupportedFormats();
      const uso = FORMATS.filter((f) => disp.includes(f));
      if (uso.length) {
        detector = new window.BarcodeDetector({ formats: uso });
        backend = 'native';
        return backend;
      }
    } catch (_) {
      // cai para o ZXing
    }
  }

  await loadZxing();
  const hints = new Map();
  const Z = window.ZXing;
  hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [
    Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39,
    Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A,
    Z.BarcodeFormat.UPC_E, Z.BarcodeFormat.ITF, Z.BarcodeFormat.CODABAR,
    Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.PDF_417, Z.BarcodeFormat.AZTEC,
  ]);
  // TRY_HARDER custa tempo mas acha código torto, pequeno ou de lado —
  // que é a situação real de quem aponta o celular para uma etiqueta
  hints.set(Z.DecodeHintType.TRY_HARDER, true);
  detector = new Z.MultiFormatReader();
  detector.setHints(hints);
  backend = 'zxing';
  return backend;
}

function loadZxing() {
  if (zxingPromise) return zxingPromise;
  zxingPromise = new Promise((resolve, reject) => {
    if (window.ZXing) return resolve();
    const s = document.createElement('script');
    s.src = 'vendor/zxing.js';
    s.async = true;
    s.onload = () => (window.ZXing ? resolve()
      : reject(new Error('zxing.js carregou mas não expôs window.ZXing')));
    s.onerror = () => reject(new Error('Falha ao carregar vendor/zxing.js'));
    document.head.appendChild(s);
  });
  return zxingPromise;
}

const scratch = {};

function canvasOf(w, h) {
  if (!scratch.c) scratch.c = document.createElement('canvas');
  const c = scratch.c;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/**
 * Lê códigos num ImageData.
 * Devolve [{ text, format, corners }] — corners em coordenadas da imagem,
 * para o overlay desenhar o contorno onde o código realmente está.
 */
export async function readCodes(image) {
  await ensureReader();

  if (backend === 'native') {
    const c = canvasOf(image.width, image.height);
    c.getContext('2d').putImageData(image, 0, 0);
    const found = await detector.detect(c);
    return found.map((b) => ({
      text: b.rawValue,
      format: b.format || 'unknown',
      corners: (b.cornerPoints || []).map((p) => ({ x: p.x, y: p.y })),
      box: b.boundingBox
        ? { x: b.boundingBox.x, y: b.boundingBox.y, w: b.boundingBox.width, h: b.boundingBox.height }
        : null,
    }));
  }

  // ---- ZXing
  const { width: w, height: h } = image;
  /*
   * O ZXing quer luminância de 1 canal. Converter aqui evita que ele faça a
   * própria conversão a partir de RGBA — e usamos a mesma constante Rec.601
   * do resto do sistema, para o operador de leitura enxergar exatamente o
   * que o pipeline enxerga.
   */
  const lum = new Uint8ClampedArray(w * h);
  const d = image.data;
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
  }

  /*
   * ================== AS TRÊS PASSADAS, E POR QUE ==================
   *
   * O leitor 1D do ZXing varre LINHAS HORIZONTAIS. Um código de barras
   * deitado no quadro — o caso normal de quem segura o celular em pé
   * diante de uma etiqueta de prateleira — não cruza linha nenhuma, e
   * nunca é encontrado.
   *
   * O ZXing resolveria isso sozinho girando o bitmap, mas só quando a
   * fonte de luminância aceita rotação, e RGBLuminanceSource responde
   * `isRotateSupported() === false`. Ou seja: com esta fonte, a tentativa
   * girada NUNCA acontece. É exatamente por isso que o QR funcionava e o
   * código de barras não — QR é lido por um detector 2D, que não depende
   * da orientação.
   *
   * Então giramos nós mesmos. Três passadas, na ordem do que é mais
   * provável, e a primeira que achar encerra:
   *
   *   1. direto     código deitado (cobre inclinação de ~±20°)
   *   2. girado 90° código em pé
   *   3. invertido  claro sobre escuro — etiqueta em tela, painel de LED,
   *                 impressão em negativo
   *
   * Custo: uma transposição de array por passada, sub-milissegundo mesmo
   * a 1280 px, e só quando as anteriores falharam. Quadro com código
   * legível paga só a primeira.
   * ================================================================
   */
  const direto = tentarZxing(lum, w, h, false);
  if (direto) return [direto];

  const girado = tentarZxing(transpor(lum, w, h), h, w, true);
  if (girado) return [ajustarGiro(girado, w, h)];

  const inv = new Uint8ClampedArray(lum.length);
  for (let i = 0; i < lum.length; i++) inv[i] = 255 - lum[i];
  const invertido = tentarZxing(inv, w, h, false);
  if (invertido) return [invertido];

  return [];
}

/** Uma tentativa de decodificação. Devolve o achado ou null. */
function tentarZxing(lum, w, h) {
  const Z = window.ZXing;
  const source = new Z.RGBLuminanceSource(lum, w, h);
  const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(source));
  try {
    const r = detector.decode(bitmap);
    const pts = (r.getResultPoints() || []).map((p) => ({ x: p.getX(), y: p.getY() }));
    return {
      text: r.getText(),
      format: formatoZxing(r.getBarcodeFormat()),
      corners: pts,
      box: pts.length ? caixaDe(pts) : null,
    };
  } catch (err) {
    // NotFoundException é o caso normal: não há código neste frame
    if (err && err.name === 'NotFoundException') return null;
    if (String(err).includes('NotFound')) return null;
    // o bundle minificado do ZXing perde o nome da classe: o NotFound chega só com a mensagem
    if (/No MultiFormat Readers were able/.test(String(err && err.message))) return null;
    if (err && err.name === 'FormatException') return null;
    if (err && err.name === 'ChecksumException') return null;
    throw err;
  } finally {
    // sem isto o leitor guarda estado do frame anterior e passa a errar
    detector.reset();
  }
}

/**
 * Transpõe a luminância em 90° no sentido horário.
 * O pixel (x,y) da origem vai para (h-1-y, x) no destino h×w.
 */
export function transpor(lum, w, h) {
  const out = new Uint8ClampedArray(lum.length);
  for (let y = 0; y < h; y++) {
    const linha = y * w;
    const col = h - 1 - y;
    for (let x = 0; x < w; x++) out[x * h + col] = lum[linha + x];
  }
  return out;
}

/**
 * Leva os pontos achados no quadro girado de volta ao quadro original.
 * Sem isto o contorno verde apareceria trocado de eixo — desenhado em
 * cima de nada, o que faria parecer que a leitura está errada.
 */
function ajustarGiro(achado, w, h) {
  // inversa de (x,y) -> (h-1-y, x): (u,v) do girado -> (v, h-1-u)
  const pts = (achado.corners || []).map((p) => ({ x: p.y, y: h - 1 - p.x }));
  return {
    ...achado,
    corners: pts,
    box: pts.length ? caixaDe(pts) : null,
  };
}

function caixaDe(pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function formatoZxing(f) {
  const Z = window.ZXing;
  const mapa = {
    [Z.BarcodeFormat.QR_CODE]: 'qr_code',
    [Z.BarcodeFormat.CODE_128]: 'code_128',
    [Z.BarcodeFormat.CODE_39]: 'code_39',
    [Z.BarcodeFormat.EAN_13]: 'ean_13',
    [Z.BarcodeFormat.EAN_8]: 'ean_8',
    [Z.BarcodeFormat.UPC_A]: 'upc_a',
    [Z.BarcodeFormat.UPC_E]: 'upc_e',
    [Z.BarcodeFormat.ITF]: 'itf',
    [Z.BarcodeFormat.CODABAR]: 'codabar',
    [Z.BarcodeFormat.DATA_MATRIX]: 'data_matrix',
    [Z.BarcodeFormat.PDF_417]: 'pdf417',
    [Z.BarcodeFormat.AZTEC]: 'aztec',
  };
  return mapa[f] || 'unknown';
}

// ------------------------------------------------------------ conteúdo

/**
 * Classifica o que o código carrega, para a interface oferecer a ação certa.
 *
 * Um QR com uma URL merece um link; um com WIFI: merece as credenciais
 * separadas; um EAN-13 é um produto. Mostrar tudo como texto cru joga esse
 * trabalho para o usuário.
 */
export function interpretar(texto) {
  const t = String(texto || '').trim();

  if (/^https?:\/\//i.test(t)) {
    let host = '';
    try { host = new URL(t).host; } catch (_) { /* url torta */ }
    return { tipo: 'url', rotulo: 'Endereço web', valor: t, extra: host, acao: 'abrir' };
  }
  if (/^WIFI:/i.test(t)) {
    const g = (k) => (t.match(new RegExp(k + ':([^;]*)', 'i')) || [])[1] || '';
    return {
      tipo: 'wifi', rotulo: 'Rede Wi-Fi', valor: g('S'),
      campos: { Rede: g('S'), Segurança: g('T') || 'nenhuma', Senha: g('P') },
    };
  }
  if (/^BEGIN:VCARD/i.test(t)) {
    const nome = (t.match(/\bFN:([^\r\n]*)/i) || [])[1] || '';
    const tel = (t.match(/\bTEL[^:]*:([^\r\n]*)/i) || [])[1] || '';
    const mail = (t.match(/\bEMAIL[^:]*:([^\r\n]*)/i) || [])[1] || '';
    return { tipo: 'vcard', rotulo: 'Contato', valor: nome,
             campos: { Nome: nome, Telefone: tel, 'E-mail': mail } };
  }
  if (/^mailto:/i.test(t)) {
    return { tipo: 'email', rotulo: 'E-mail', valor: t.slice(7), acao: 'abrir' };
  }
  if (/^tel:/i.test(t)) {
    return { tipo: 'tel', rotulo: 'Telefone', valor: t.slice(4), acao: 'abrir' };
  }
  if (/^BEGIN:VEVENT/i.test(t)) {
    return { tipo: 'evento', rotulo: 'Evento de agenda', valor: (t.match(/SUMMARY:([^\r\n]*)/i) || [])[1] || '' };
  }
  // PIX (BR Code) começa com o payload EMV 000201
  if (/^000201/.test(t) && /BR\.GOV\.BCB\.PIX/i.test(t)) {
    return { tipo: 'pix', rotulo: 'PIX (BR Code)', valor: t,
             extra: 'copia e cola' };
  }
  if (/^\d{8}$|^\d{12,14}$/.test(t)) {
    return { tipo: 'produto', rotulo: 'Código de produto', valor: t,
             extra: t.length === 13 ? 'EAN-13' : t.length === 8 ? 'EAN-8' : 'GTIN' };
  }
  return { tipo: 'texto', rotulo: 'Texto', valor: t };
}
