/**
 * via/anexos.js — imagens anexadas à conversa da Via (📎, arrastar e soltar,
 * Ctrl+V).
 *
 * Cada imagem é reduzida AQUI, antes de sair do aparelho: no máximo 1568 px no
 * maior lado (o tamanho que a API da Anthropic usa sem redimensionar de novo)
 * e JPEG ~0,85. A mesma versão reduzida é a que vai para a Via e, se o usuário
 * clicar, para o Treinar. Para o servidor da GPlanSiS só vão os metadados
 * (sha256, largura, altura) — nunca a imagem.
 *
 * Os anexos da conversa ficam na memória da página (somem ao recarregar) e têm
 * ids curtos (A1, A2…) que a Via usa para se referir a eles nas ferramentas.
 */

export const MAX_LADO = 1568;
export const QUALIDADE = 0.85;
export const MAX_POR_MENSAGEM = 8;
export const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function base64DeBlob(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const u = String(fr.result); res(u.slice(u.indexOf(',') + 1)); };
    fr.onerror = () => rej(fr.error || new Error('não consegui ler a imagem'));
    fr.readAsDataURL(blob);
  });
}

async function decodificar(arquivo) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(arquivo, { imageOrientation: 'from-image' }); } catch (_) { /* cai no <img> */ }
  }
  const url = URL.createObjectURL(arquivo);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/**
 * Reduz um File/Blob de imagem. Devolve { nome, blob, url, base64, largura,
 * altura, sha256, bytes }. Lança Error com mensagem em português se não der.
 */
export async function prepararImagem(arquivo) {
  if (!arquivo || !TIPOS.includes(arquivo.type)) throw new Error(`${(arquivo && arquivo.name) || 'arquivo'}: use JPG, PNG ou WebP.`);
  if (arquivo.size > 40e6) throw new Error(`${arquivo.name}: maior que 40 MB.`);
  const img = await decodificar(arquivo);
  const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
  if (!w0 || !h0) throw new Error(`${arquivo.name || 'imagem'}: não consegui abrir.`);
  const k = Math.min(1, MAX_LADO / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';                 // PNG transparente vira fundo branco no JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  if (img.close) img.close();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', QUALIDADE));
  if (!blob) throw new Error(`${arquivo.name || 'imagem'}: não consegui converter.`);
  const [base64, dig] = await Promise.all([base64DeBlob(blob), crypto.subtle.digest('SHA-256', await blob.arrayBuffer())]);
  const base = String(arquivo.name || 'imagem').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 50) || 'imagem';
  return { nome: `${base}.jpg`, blob, url: URL.createObjectURL(blob), base64, largura: w, altura: h, sha256: hex(dig), bytes: blob.size };
}

/** Imagens de um DataTransfer (drop) ou ClipboardData (paste). */
export function imagensDe(dt) {
  if (!dt) return [];
  const out = [];
  for (const f of dt.files || []) if (TIPOS.includes(f.type)) out.push(f);
  if (!out.length && dt.items) {
    for (const it of dt.items) if (it.kind === 'file' && TIPOS.includes(it.type)) { const f = it.getAsFile(); if (f) out.push(f); }
  }
  return out;
}
