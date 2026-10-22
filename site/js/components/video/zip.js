/**
 * components/video/zip.js — ZIP mínimo, sem compressão (método STORE).
 *
 * Os quadros exportados já são JPEG: comprimir de novo não ganha nada e
 * custaria CPU. STORE é lido por qualquer descompactador (Windows, macOS,
 * Linux, celular). Nomes em UTF-8 (bit 11).
 */

let TABELA = null;
function crc32(bytes) {
  if (!TABELA) {
    TABELA = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      TABELA[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = TABELA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** @param {{nome: string, blob: Blob}[]} arquivos  @returns {Promise<Blob>} */
export async function montarZip(arquivos) {
  const partes = [];
  const central = [];
  let pos = 0;
  const agora = new Date();
  const hora = (agora.getHours() << 11) | (agora.getMinutes() << 5) | (agora.getSeconds() >> 1);
  const data = ((agora.getFullYear() - 1980) << 9) | ((agora.getMonth() + 1) << 5) | agora.getDate();
  const enc = new TextEncoder();
  for (const a of arquivos) {
    const bytes = new Uint8Array(await a.blob.arrayBuffer());
    const nome = enc.encode(a.nome);
    const crc = crc32(bytes);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(8, 0, true); loc.setUint16(10, hora, true); loc.setUint16(12, data, true);
    loc.setUint32(14, crc, true); loc.setUint32(18, bytes.length, true); loc.setUint32(22, bytes.length, true);
    loc.setUint16(26, nome.length, true); loc.setUint16(28, 0, true);
    partes.push(loc.buffer, nome, bytes);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, hora, true); cen.setUint16(14, data, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, bytes.length, true); cen.setUint32(24, bytes.length, true);
    cen.setUint16(28, nome.length, true); cen.setUint32(42, pos, true);
    central.push(cen.buffer, nome);
    pos += 30 + nome.length + bytes.length;
  }
  let tamCentral = 0;
  for (const c of central) tamCentral += c.byteLength;
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, pos, true);
  return new Blob([...partes, ...central, fim.buffer], { type: 'application/zip' });
}
