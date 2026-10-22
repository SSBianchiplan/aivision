/**
 * components/video/midia.js — índice de quadros de um arquivo de vídeo, sem
 * carregar o arquivo inteiro na memória (GPlanSiS|Vídeo).
 *
 * O editor precisa saber EXATAMENTE quais quadros existem e onde estão os
 * bytes de cada um: é isso que permite parar no quadro N, cortar entre dois
 * quadros e exportar sem perder nem duplicar nenhum. O <video> do navegador
 * não diz isso (só um currentTime em segundos), então lemos o contêiner:
 *
 *   MP4/MOV  caixas moov/trak/stbl (stts, ctts, stss, stsz, stsc, stco/co64)
 *            e, nos MP4 FRAGMENTADOS (o que o MediaRecorder do Chrome grava),
 *            moof/traf/trun. Edit list (elst) aplicada: o tempo de
 *            apresentação começa onde o player começa.
 *   WebM/MKV EBML: Tracks, Cluster/SimpleBlock/BlockGroup. Tamanho
 *            desconhecido (MediaRecorder) é tratado.
 *
 * Só os CABEÇALHOS são lidos (Blob.slice): um MP4 de 1 GB com moov no começo
 * abre lendo alguns MB. Os bytes das amostras são lidos depois, sob demanda,
 * pelo exportador (`lerAmostras`).
 *
 * Tempos em MICROSSEGUNDOS inteiros (o relógio do WebCodecs), já no tempo de
 * apresentação. Nada aqui depende de React.
 */

const JANELA = 4 << 20;   // 4 MB por leitura

/** Leitura aleatória de um Blob com uma janela em cache. */
export class LeitorBlob {
  constructor(blob) { this.blob = blob; this.ini = 0; this.buf = null; }
  get tamanho() { return this.blob.size; }
  async ler(pos, n) {
    if (pos < 0) pos = 0;
    if (pos + n > this.blob.size) n = Math.max(0, this.blob.size - pos);
    if (this.buf && pos >= this.ini && pos + n <= this.ini + this.buf.length) {
      return this.buf.subarray(pos - this.ini, pos - this.ini + n);
    }
    const fim = Math.min(this.blob.size, pos + Math.max(n, JANELA));
    this.buf = new Uint8Array(await this.blob.slice(pos, fim).arrayBuffer());
    this.ini = pos;
    return this.buf.subarray(0, n);
  }
  /** Leitura direta, sem passar pela janela (blocos grandes). */
  async lerDireto(pos, n) {
    return new Uint8Array(await this.blob.slice(pos, pos + n).arrayBuffer());
  }
}

const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const tipo4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const hex2 = (n) => n.toString(16).padStart(2, '0');

/**
 * Abre o arquivo e devolve o índice:
 * {
 *   formato: 'mp4'|'webm', duracaoUs,
 *   video: { codec, descricao, largura, altura, n, fps,
 *            dec: { pos, tam, pts, chave }   (ordem de DECODIFICAÇÃO)
 *            pts: Float64Array(n+1)          (início de cada quadro em ordem de APRESENTAÇÃO; pts[n] = fim)
 *            decDe: Uint32Array(n)           (quadro de apresentação → índice de decodificação)
 *            presDe: Uint32Array(n) },
 *   audio: null | { codec, descricao, taxa, canais, n, dec: { pos, tam, pts, dur } }
 * }
 * Lança erro se não reconhecer o contêiner.
 */
export async function indexar(blob, { aoProgresso } = {}) {
  const r = new LeitorBlob(blob);
  const cab = await r.ler(0, 64);
  if (cab.length >= 4 && u32(cab, 0) === 0x1A45DFA3) return indexarWebm(r, aoProgresso);
  if (cab.length >= 8 && /^(ftyp|moov|mdat|free|skip|wide|styp|moof)$/.test(tipo4(cab, 4))) return indexarMp4(r, aoProgresso);
  throw new Error('contêiner não reconhecido (esperado MP4, MOV ou WebM)');
}

/* ====================================================================== MP4 */

function filhos(b, ini, fim) {
  const out = [];
  let o = ini;
  while (o + 8 <= fim) {
    let tam = u32(b, o);
    const t = tipo4(b, o + 4);
    let h = 8;
    if (tam === 1) { tam = u64(b, o + 8); h = 16; } else if (tam === 0) tam = fim - o;
    if (tam < h || o + tam > fim) break;
    out.push({ t, ini: o, cab: o + h, fim: o + tam });
    o += tam;
  }
  return out;
}
const acha = (b, cx, t) => filhos(b, cx.cab, cx.fim).find((c) => c.t === t);

async function indexarMp4(r, aoProgresso) {
  // varre as caixas do nível de cima lendo só os cabeçalhos
  let moov = null;
  const moofs = [];
  let o = 0;
  const total = r.tamanho;
  while (o + 8 <= total) {
    const h = await r.ler(o, 16);
    let tam = u32(h, 0);
    const t = tipo4(h, 4);
    let hl = 8;
    if (tam === 1) { tam = u64(h, 8); hl = 16; } else if (tam === 0) tam = total - o;
    if (tam < hl) break;
    if (t === 'moov') moov = { pos: o, dados: await r.lerDireto(o, tam) };
    else if (t === 'moof') moofs.push({ pos: o, dados: tam < JANELA ? (await r.ler(o, tam)).slice() : await r.lerDireto(o, tam) });
    o += tam;
    if (aoProgresso && moofs.length % 200 === 1) aoProgresso(o / total);
  }
  if (!moov) throw new Error('MP4 sem caixa moov');
  const b = moov.dados;
  const raiz = { cab: 8, fim: b.length };
  const mvhd = acha(b, raiz, 'mvhd');
  const escalaFilme = mvhd ? (b[mvhd.cab] === 1 ? u32(b, mvhd.cab + 20) : u32(b, mvhd.cab + 12)) : 1000;
  const trex = {};
  const mvex = acha(b, raiz, 'mvex');
  if (mvex) for (const c of filhos(b, mvex.cab, mvex.fim)) if (c.t === 'trex') {
    const id = u32(b, c.cab + 4);
    trex[id] = { dur: u32(b, c.cab + 12), tam: u32(b, c.cab + 16), flags: u32(b, c.cab + 20) };
  }
  const trilhas = [];
  for (const tk of filhos(b, raiz.cab, raiz.fim)) {
    if (tk.t !== 'trak') continue;
    const tr = lerTrak(b, tk, escalaFilme);
    if (tr) trilhas.push(tr);
  }
  // fragmentos: amostras de moof/traf/trun
  for (const mf of moofs) {
    const d = mf.dados;
    for (const tf of filhos(d, 8, d.length)) {
      if (tf.t !== 'traf') continue;
      const tfhd = acha(d, tf, 'tfhd');
      if (!tfhd) continue;
      const fl = u32(d, tfhd.cab) & 0xffffff;
      const id = u32(d, tfhd.cab + 4);
      const tr = trilhas.find((x) => x.id === id);
      if (!tr) continue;
      let p = tfhd.cab + 8;
      let base = mf.pos;
      if (fl & 0x1) { base = u64(d, p); p += 8; }
      if (fl & 0x2) p += 4;
      const dx = trex[id] || { dur: 0, tam: 0, flags: 0 };
      let durP = dx.dur, tamP = dx.tam, flagsP = dx.flags;
      if (fl & 0x8) { durP = u32(d, p); p += 4; }
      if (fl & 0x10) { tamP = u32(d, p); p += 4; }
      if (fl & 0x20) { flagsP = u32(d, p); p += 4; }
      const tfdt = acha(d, tf, 'tfdt');
      let t = tfdt ? (d[tfdt.cab] === 1 ? u64(d, tfdt.cab + 4) : u32(d, tfdt.cab + 4)) : tr.proxDts;
      let fimDados = base;
      for (const tn of filhos(d, tf.cab, tf.fim)) {
        if (tn.t !== 'trun') continue;
        const ver = d[tn.cab];
        const tf2 = u32(d, tn.cab) & 0xffffff;
        const n = u32(d, tn.cab + 4);
        let q = tn.cab + 8;
        let pos = fimDados;
        if (tf2 & 0x1) { pos = base + i32(d, q); q += 4; }
        let flagsPrimeiro = null;
        if (tf2 & 0x4) { flagsPrimeiro = u32(d, q); q += 4; }
        for (let i = 0; i < n; i++) {
          let du = durP, ta = tamP, fla = i === 0 && flagsPrimeiro !== null ? flagsPrimeiro : flagsP, cto = 0;
          if (tf2 & 0x100) { du = u32(d, q); q += 4; }
          if (tf2 & 0x200) { ta = u32(d, q); q += 4; }
          if (tf2 & 0x400) { fla = u32(d, q); q += 4; }
          if (tf2 & 0x800) { cto = ver === 0 ? u32(d, q) : i32(d, q); q += 4; }
          tr.am.push([pos, ta, t, t + cto, !(fla & 0x10000), du]);
          pos += ta; t += du;
        }
        fimDados = pos;
      }
      tr.proxDts = t;
    }
  }
  const v = trilhas.find((x) => x.tipo === 'vide' && x.am.length);
  const a = trilhas.find((x) => x.tipo === 'soun' && x.am.length);
  if (!v) throw new Error('MP4 sem trilha de vídeo');
  const avisos = [];
  if (v.avisoEdl) avisos.push(v.avisoEdl);
  const video = montarVideo(v, avisos);
  const audio = a ? montarAudio(a) : null;
  const duracaoUs = video.pts[video.n];
  // defesa: o cabeçalho (tkhd do vídeo, ou mvhd) diverge muito do índice?
  // Vale o índice (é dele que saem quadros, timeline e exportação); avisa.
  const durMvhd = mvhd ? (b[mvhd.cab] === 1 ? u64(b, mvhd.cab + 24) : u32(b, mvhd.cab + 16)) : 0;
  const cab = v.durCabecalhoUs || (durMvhd > 0 && durMvhd < 0xffffffff ? Math.round(durMvhd * 1e6 / escalaFilme) : 0);
  if (cab > 0 && !moofs.length && Math.abs(cab - duracaoUs) > Math.max(1e6, cab * 0.1)) {
    avisos.push(`duração do cabeçalho ${(cab / 1e6).toFixed(3)} s ≠ índice ${(duracaoUs / 1e6).toFixed(3)} s: vale o índice`);
  }
  for (const t of avisos) console.warn('[vídeo] índice MP4:', t);
  return { formato: 'mp4', video, audio, duracaoUs, duracaoCabecalhoUs: cab, avisos };
}

function lerTrak(b, tk, escalaFilme) {
  const tkhd = acha(b, tk, 'tkhd');
  const mdia = acha(b, tk, 'mdia');
  if (!tkhd || !mdia) return null;
  const id = u32(b, tkhd.cab + (b[tkhd.cab] === 1 ? 20 : 12));
  const mdhd = acha(b, mdia, 'mdhd');
  const hdlr = acha(b, mdia, 'hdlr');
  const escala = b[mdhd.cab] === 1 ? u32(b, mdhd.cab + 20) : u32(b, mdhd.cab + 12);
  const tipo = tipo4(b, hdlr.cab + 8);
  if (tipo !== 'vide' && tipo !== 'soun') return null;
  // duração declarada no cabeçalho (tkhd, na escala do filme): só para conferir o índice
  const durTkhd = b[tkhd.cab] === 1 ? u64(b, tkhd.cab + 28) : u32(b, tkhd.cab + 20);
  // rotação da matriz do tkhd (vídeo de celular em pé): o <video> aplica, o WebCodecs não
  const mx = tkhd.cab + (b[tkhd.cab] === 1 ? 52 : 40);
  const ma = i32(b, mx), mb = i32(b, mx + 4);
  const rotacao = ma === 0 && mb > 0 ? 90 : ma < 0 && mb === 0 ? 180 : ma === 0 && mb < 0 ? 270 : 0;
  /*
   * Edit list (elst). Cada entrada: duração (escala do FILME), media_time
   * (escala da MÍDIA; −1 = edição vazia) e taxa. O que interessa ao editor:
   *   atraso     soma das edições vazias antes do primeiro trecho;
   *   janela     [media_time, media_time + duração) — só as amostras com
   *              tempo de composição DENTRO dela são apresentadas (as de fora
   *              existem só para decodificar: um corte "sem reencode" do
   *              QuickTime/Fotos/ffmpeg -ss -c copy guarda o GOP inteiro e
   *              esconde o começo e o fim pela edit list).
   * Trechos seguintes contíguos na mídia são somados; trechos não contíguos
   * (montagem dentro do contêiner) não são suportados: fica só o primeiro.
   */
  let atraso = 0, janela = null, avisoEdl = null;
  const edts = acha(b, tk, 'edts');
  const elst = edts && acha(b, edts, 'elst');
  if (elst) {
    const ver = b[elst.cab];
    const n = u32(b, elst.cab + 4);
    let p = elst.cab + 8;
    for (let i = 0; i < n; i++) {
      const dur = ver === 1 ? u64(b, p) : u32(b, p);
      const mt = ver === 1 ? i32(b, p + 8) * 4294967296 + u32(b, p + 12) : i32(b, p + 4);
      const taxa = ver === 1 ? i32(b, p + 16) : i32(b, p + 8);
      p += ver === 1 ? 20 : 12;
      if (mt === -1) { if (!janela) atraso += dur; continue; }
      if (taxa !== 0x10000 && !avisoEdl) avisoEdl = 'edit list com taxa diferente de 1× (ignorada)';
      // duração 0 (MP4 fragmentado): o trecho vai até o fim da mídia
      const durMidia = dur > 0 ? dur * escala / escalaFilme : Infinity;
      if (!janela) { janela = { ini: mt, fim: mt + durMidia }; continue; }
      if (Math.abs(mt - janela.fim) <= 1) { janela.fim = mt + durMidia; continue; }
      avisoEdl = `edit list com ${n} trechos não contíguos: só o primeiro é usado`;
      break;
    }
  }
  const minf = acha(b, mdia, 'minf');
  const stbl = minf && acha(b, minf, 'stbl');
  if (!stbl) return null;
  const tr = {
    id, tipo, escala, escalaFilme, deslocUs: Math.round(atraso * 1e6 / escalaFilme), janela, avisoEdl, rotacao,
    durCabecalhoUs: durTkhd > 0 && durTkhd < 0xffffffff ? Math.round(durTkhd * 1e6 / escalaFilme) : 0,
    am: [], proxDts: 0,
  };
  const stsd = acha(b, stbl, 'stsd');
  lerStsd(b, stsd, tr);
  // tabelas (vazias num MP4 fragmentado)
  const stsz = acha(b, stbl, 'stsz');
  const stz2 = acha(b, stbl, 'stz2');
  const tamanhos = [];
  if (stsz) {
    const fixo = u32(b, stsz.cab + 4);
    const n = u32(b, stsz.cab + 8);
    for (let i = 0; i < n; i++) tamanhos.push(fixo || u32(b, stsz.cab + 12 + i * 4));
  } else if (stz2) {
    const bits = b[stz2.cab + 7];
    const n = u32(b, stz2.cab + 8);
    for (let i = 0; i < n; i++) {
      if (bits === 16) tamanhos.push(u16(b, stz2.cab + 12 + i * 2));
      else if (bits === 8) tamanhos.push(b[stz2.cab + 12 + i]);
      else tamanhos.push((b[stz2.cab + 12 + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15);
    }
  }
  const n = tamanhos.length;
  if (!n) return tr;
  const stco = acha(b, stbl, 'stco');
  const co64 = acha(b, stbl, 'co64');
  const offs = [];
  if (stco) { const k = u32(b, stco.cab + 4); for (let i = 0; i < k; i++) offs.push(u32(b, stco.cab + 8 + i * 4)); }
  if (co64) { const k = u32(b, co64.cab + 4); for (let i = 0; i < k; i++) offs.push(u64(b, co64.cab + 8 + i * 8)); }
  const stsc = acha(b, stbl, 'stsc');
  const sc = [];
  { const k = u32(b, stsc.cab + 4); for (let i = 0; i < k; i++) sc.push([u32(b, stsc.cab + 8 + i * 12), u32(b, stsc.cab + 12 + i * 12)]); }
  const pos = new Array(n);
  {
    let s = 0;
    // stsc em ordem crescente de chunk: um ponteiro que só avança (antes era
    // uma busca por chunk — O(chunks × entradas), segundos num MP4 longo)
    let j = 0;
    for (let c = 0; c < offs.length && s < n; c++) {
      while (j + 1 < sc.length && c + 1 >= sc[j + 1][0]) j++;
      const porChunk = sc.length && c + 1 >= sc[j][0] ? sc[j][1] : 0;
      let p = offs[c];
      for (let k = 0; k < porChunk && s < n; k++, s++) { pos[s] = p; p += tamanhos[s]; }
    }
  }
  const stts = acha(b, stbl, 'stts');
  const dts = new Array(n);
  const durs = new Array(n);
  {
    const k = u32(b, stts.cab + 4);
    let s = 0, t = 0;
    for (let i = 0; i < k; i++) {
      const cnt = u32(b, stts.cab + 8 + i * 8), d = u32(b, stts.cab + 12 + i * 8);
      for (let j = 0; j < cnt && s < n; j++, s++) { dts[s] = t; durs[s] = d; t += d; }
    }
    for (; s < n; s++) { dts[s] = t; durs[s] = 0; }
  }
  const ctts = acha(b, stbl, 'ctts');
  const cto = new Array(n).fill(0);
  if (ctts) {
    const k = u32(b, ctts.cab + 4);
    let s = 0;
    for (let i = 0; i < k; i++) {
      const cnt = u32(b, ctts.cab + 8 + i * 8);
      // SEMPRE com sinal, também na versão 0 (como o ffmpeg e os players): o
      // QuickTime/Fotos do macOS e do iPhone gravam ctts v0 com deslocamentos
      // NEGATIVOS (com cslg). Lido sem sinal, −1000 vira 4 294 966 296 ticks
      // = +39 h 46 min a 30000/s — era a "duração de quase 40 horas".
      const off = i32(b, ctts.cab + 12 + i * 8);
      for (let j = 0; j < cnt && s < n; j++, s++) cto[s] = off;
    }
  }
  const stss = acha(b, stbl, 'stss');
  let chave = null;
  if (stss) {
    chave = new Uint8Array(n);
    const k = u32(b, stss.cab + 4);
    for (let i = 0; i < k; i++) { const s = u32(b, stss.cab + 8 + i * 4) - 1; if (s < n) chave[s] = 1; }
  }
  for (let s = 0; s < n; s++) tr.am.push([pos[s], tamanhos[s], dts[s], dts[s] + cto[s], chave ? chave[s] === 1 : true, durs[s]]);
  tr.proxDts = n ? dts[n - 1] + durs[n - 1] : 0;
  return tr;
}

function lerStsd(b, stsd, tr) {
  const ent = filhos(b, stsd.cab + 8, stsd.fim)[0];
  if (!ent) return;
  tr.fourcc = ent.t;
  if (tr.tipo === 'vide') {
    const c = ent.cab;
    tr.largura = u16(b, c + 24); tr.altura = u16(b, c + 26);
    const sub = filhos(b, c + 78, ent.fim);
    const cfg = (t) => sub.find((x) => x.t === t);
    const avcC = cfg('avcC'), hvcC = cfg('hvcC'), vpcC = cfg('vpcC'), av1C = cfg('av1C');
    if (avcC) {
      tr.descricao = b.slice(avcC.cab, avcC.fim);
      tr.codec = (ent.t === 'avc3' ? 'avc3.' : 'avc1.') + hex2(b[avcC.cab + 1]) + hex2(b[avcC.cab + 2]) + hex2(b[avcC.cab + 3]);
    } else if (hvcC) {
      tr.descricao = b.slice(hvcC.cab, hvcC.fim);
      tr.codec = codecHevc(ent.t, b, hvcC.cab);
    } else if (vpcC) {
      const p = vpcC.cab + 4;
      tr.codec = `vp09.${String(b[p]).padStart(2, '0')}.${String(b[p + 1]).padStart(2, '0')}.${String(b[p + 2] >> 4).padStart(2, '0')}`;
    } else if (av1C) {
      const p = av1C.cab;
      const perfil = b[p + 1] >> 5, nivel = b[p + 1] & 31, tier = b[p + 2] >> 7;
      const hbd = (b[p + 2] >> 6) & 1, twelve = (b[p + 2] >> 5) & 1;
      const prof = hbd ? (perfil === 2 && twelve ? 12 : 10) : 8;
      tr.codec = `av01.${perfil}.${String(nivel).padStart(2, '0')}${tier ? 'H' : 'M'}.${String(prof).padStart(2, '0')}`;
      tr.descricao = b.slice(av1C.cab, av1C.fim);
    } else if (ent.t === 'vp08') tr.codec = 'vp8';
  } else {
    const c = ent.cab;
    tr.canais = u16(b, c + 16);
    tr.taxa = u32(b, c + 24) >>> 16;
    let ini = c + 28;
    const ver = u16(b, c + 8);
    if (ver === 1) ini += 16; else if (ver === 2) ini += 36;
    const sub = filhos(b, ini, ent.fim);
    const esds = sub.find((x) => x.t === 'esds');
    // MOV antigo: esds dentro de 'wave'
    const wave = sub.find((x) => x.t === 'wave');
    const esds2 = esds || (wave && filhos(b, wave.cab, wave.fim).find((x) => x.t === 'esds'));
    if (ent.t === 'mp4a' && esds2) {
      const asc = acharAsc(b, esds2.cab + 4, esds2.fim);
      if (asc) {
        tr.descricao = asc;
        const aot = asc[0] >> 3;
        tr.codec = 'mp4a.40.' + (aot || 2);
        // taxa real do ASC (o campo da entrada pode vir 0 ou errado)
        const idx = ((asc[0] & 7) << 1) | (asc[1] >> 7);
        const TAXAS = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        if (TAXAS[idx]) tr.taxa = TAXAS[idx];
        const ch = (asc[1] >> 3) & 15;
        if (ch) tr.canais = ch;
      } else tr.codec = 'mp4a.40.2';
    } else if (ent.t === 'Opus') {
      tr.codec = 'opus';
      const dops = sub.find((x) => x.t === 'dOps');
      if (dops) tr.preSkip = u16(b, dops.cab + 2);
    }
  }
}

/** Procura o DecoderSpecificInfo (tag 5) dentro do ES_Descriptor. */
function acharAsc(b, ini, fim) {
  let p = ini;
  const tamDesc = () => { let n = 0; for (let i = 0; i < 4; i++) { const c = b[p++]; n = (n << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return n; };
  while (p < fim) {
    const tag = b[p++];
    const n = tamDesc();
    if (tag === 3) { p += 2; const fl = b[p++]; if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + b[p]; if (fl & 0x20) p += 2; continue; }
    if (tag === 4) { p += 13; continue; }
    if (tag === 5) return b.slice(p, p + n);
    p += n;
  }
  return null;
}

function codecHevc(fourcc, b, p) {
  const c1 = b[p + 1];
  const espaco = ['', 'A', 'B', 'C'][c1 >> 6];
  const tier = (c1 >> 5) & 1 ? 'H' : 'L';
  const perfil = c1 & 31;
  let compat = u32(b, p + 2);
  let rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const nivel = b[p + 12];
  const restr = [];
  for (let i = 6; i < 12; i++) restr.push(b[p + i]);
  while (restr.length && restr[restr.length - 1] === 0) restr.pop();
  return `${fourcc}.${espaco}${perfil}.${(rev >>> 0).toString(16)}.${tier}${nivel}${restr.map((x) => '.' + x.toString(16)).join('')}`;
}

/* ============================================================ montagem */

/**
 * amostras: [pos, tam, dts, cts, chave, dur] na escala da trilha.
 *
 * PONTO ÚNICO DE VERDADE da duração: o índice. Quadros apresentados = as
 * amostras com cts dentro da janela da edit list (mesma regra do ffmpeg,
 * que é o demuxer do Chrome: cts ≥ início e cts < fim); o primeiro
 * apresentado fica em 0 (+ edição vazia). A duração da mídia é o pts do
 * último quadro + a duração dele. As amostras de fora continuam no índice de
 * DECODIFICAÇÃO (o exportador precisa delas para decodificar o GOP).
 */
function montarVideo(tr, avisos) {
  const am = tr.am;
  const nDec = am.length;
  const k = 1e6 / tr.escala;
  const jan = tr.janela;
  // quais amostras são apresentadas
  let mostrar = null;
  let base = 0;
  if (jan) {
    mostrar = new Uint8Array(nDec);
    let m = 0, menor = Infinity;
    for (let i = 0; i < nDec; i++) {
      const c = am[i][3];
      if (c >= jan.ini && c < jan.fim) { mostrar[i] = 1; m++; if (c < menor) menor = c; }
    }
    if (!m) {
      // edit list que não cobre nenhuma amostra (arquivo estranho): mostra tudo
      avisos.push('edit list fora das amostras de vídeo: ignorada');
      mostrar = null;
      base = jan.ini;
    } else base = menor;
  }
  const dec = { pos: new Float64Array(nDec), tam: new Uint32Array(nDec), pts: new Float64Array(nDec), chave: new Uint8Array(nDec) };
  for (let i = 0; i < nDec; i++) {
    const a = am[i];
    dec.pos[i] = a[0]; dec.tam[i] = a[1];
    dec.pts[i] = Math.round((a[3] - base) * k) + tr.deslocUs;
    dec.chave[i] = a[4] ? 1 : 0;
  }
  // a primeira amostra é sempre ponto de entrada do decodificador
  if (nDec) dec.chave[0] = 1;
  const ordem = [];
  for (let i = 0; i < nDec; i++) if (!mostrar || mostrar[i]) ordem.push(i);
  ordem.sort((x, y) => dec.pts[x] - dec.pts[y]);
  const n = ordem.length;
  const pts = new Float64Array(n + 1);
  const decDe = new Uint32Array(n);
  const presDe = new Int32Array(nDec).fill(-1);   // −1: amostra só de decodificação (fora da edit list)
  for (let i = 0; i < n; i++) { pts[i] = dec.pts[ordem[i]]; decDe[i] = ordem[i]; presDe[ordem[i]] = i; }
  // fim do último quadro: a duração dele (stts) ou a mediana dos últimos intervalos
  const ult = am[ordem[n - 1]];
  let durUlt = ult[5] ? Math.round(ult[5] * k) : 0;
  if (!durUlt) {
    const d = [];
    for (let i = Math.max(1, n - 9); i < n; i++) d.push(pts[i] - pts[i - 1]);
    d.sort((x, y) => x - y);
    durUlt = Math.round(d[d.length >> 1] || 33333);
  }
  pts[n] = pts[n - 1] + durUlt;
  const v = finalizarVideo({ codec: tr.codec, descricao: tr.descricao || null, largura: tr.largura, altura: tr.altura, n, dec, pts, decDe, presDe });
  // Safari/QuickTime (AVFoundation) começam a apresentação em media_time, não
  // no primeiro quadro inteiro: o relógio do <video> lá fica adiantado deste
  // tanto. O reprodutor escolhe entre 0 e este valor na calibração.
  v.deslocAlt = jan && mostrar ? (base - jan.ini) * k / 1e6 : 0;
  v.rotacao = tr.rotacao || 0;
  return v;
}

function finalizarVideo(v) {
  v.fps = estimarFps(v.pts, v.n);
  v.cfr = ehCfr(v.pts, v.n);
  return v;
}

function montarAudio(tr) {
  const am = tr.am;
  const n = am.length;
  const k = 1e6 / tr.escala;
  const dec = { pos: new Float64Array(n), tam: new Uint32Array(n), pts: new Float64Array(n), dur: new Float64Array(n) };
  // o áudio começa exatamente em media_time (o pacote de priming do AAC fica com pts negativo)
  const ini = tr.janela ? tr.janela.ini : 0;
  for (let i = 0; i < n; i++) {
    const a = am[i];
    dec.pos[i] = a[0]; dec.tam[i] = a[1];
    dec.pts[i] = Math.round((a[3] - ini) * k) + tr.deslocUs;
    dec.dur[i] = Math.round(a[5] * k);
  }
  return { codec: tr.codec || null, descricao: tr.descricao || null, taxa: tr.taxa || 48000, canais: tr.canais || 2, n, dec };
}

/** fps nominal: mediana dos intervalos, arredondada aos valores usuais. */
export function estimarFps(pts, n) {
  if (n < 2) return 30;
  const amostra = [];
  const passo = Math.max(1, Math.floor(n / 400));
  for (let i = 1; i < n; i += passo) amostra.push(pts[i] - pts[i - 1]);
  amostra.sort((a, b) => a - b);
  const med = amostra[amostra.length >> 1] || 33333;
  const f = 1e6 / med;
  const USUAIS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240];
  let melhor = null;
  for (const u of USUAIS) if (Math.abs(f - u) / u < 0.004 && (melhor === null || Math.abs(f - u) < Math.abs(f - melhor))) melhor = u;
  return melhor !== null ? melhor : Math.round(f * 100) / 100;
}

function ehCfr(pts, n) {
  if (n < 3) return true;
  const d0 = (pts[n] - pts[0]) / n;
  for (let i = 1; i <= n; i++) if (Math.abs(pts[i] - pts[i - 1] - d0) > d0 * 0.25) return false;
  return true;
}

/* ===================================================================== WebM */

const ID = {
  EBML: 0x1A45DFA3, SEGMENT: 0x18538067, INFO: 0x1549A966, ESCALA: 0x2AD7B1, DURACAO: 0x4489,
  TRACKS: 0x1654AE6B, ENTRY: 0xAE, NUM: 0xD7, TIPO: 0x83, CODEC: 0x86, PRIV: 0x63A2, ATRASO: 0x56AA,
  VIDEO: 0xE0, LARG: 0xB0, ALT: 0xBA, AUDIO: 0xE1, TAXA: 0xB5, CANAIS: 0x9F,
  CLUSTER: 0x1F43B675, TC: 0xE7, SIMPLE: 0xA3, GRUPO: 0xA0, BLOCO: 0xA1, BDUR: 0x9B, REF: 0xFB,
};
// elementos de nível 1: encerram um Cluster de tamanho desconhecido
const NIVEL1 = new Set([0x114D9B74, ID.INFO, ID.TRACKS, ID.CLUSTER, 0x1C53BB6B, 0x1941A469, 0x1043A770, 0x1254C367]);

function lerId(b, p) {
  const c = b[p];
  const n = c & 0x80 ? 1 : c & 0x40 ? 2 : c & 0x20 ? 3 : c & 0x10 ? 4 : 0;
  if (!n) return null;
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + b[p + i];
  return { v, n };
}
function lerTam(b, p) {
  const c = b[p];
  let n = 1, m = 0x80;
  while (n <= 8 && !(c & m)) { n++; m >>= 1; }
  if (n > 8) return null;
  let v = c & (m - 1);
  let tudo1 = v === m - 1;
  for (let i = 1; i < n; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) tudo1 = false; }
  return { v: tudo1 ? -1 : v, n };
}
const uint = (b, p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; };
const flt = (b, p, n) => { const dv = new DataView(b.buffer, b.byteOffset + p, n); return n === 4 ? dv.getFloat32(0) : dv.getFloat64(0); };

async function indexarWebm(r, aoProgresso) {
  const total = r.tamanho;
  let escala = 1e6;   // ns por unidade de timecode
  const trilhas = {};
  const blocos = {};
  // cabeçalho de elemento na posição p (lê até 12 bytes)
  const cabecalho = async (p) => {
    const h = await r.ler(p, 12);
    const id = lerId(h, 0);
    if (!id) return null;
    const t = lerTam(h, id.n);
    if (!t) return null;
    return { id: id.v, dados: p + id.n + t.n, tam: t.v };
  };
  let p = 0;
  const e0 = await cabecalho(0);
  p = e0.dados + e0.tam;   // pula o cabeçalho EBML
  const seg = await cabecalho(p);
  if (!seg || seg.id !== ID.SEGMENT) throw new Error('WebM sem Segment');
  const fimSeg = seg.tam < 0 ? total : Math.min(total, seg.dados + seg.tam);
  p = seg.dados;
  let clusterTc = 0;
  let fimCluster = -1;   // -1: fora de cluster; -2: cluster de tamanho desconhecido
  let conta = 0;
  while (p < fimSeg) {
    const e = await cabecalho(p);
    if (!e) break;
    if (fimCluster !== -1 && (NIVEL1.has(e.id) || (fimCluster >= 0 && p >= fimCluster))) fimCluster = -1;
    if (e.id === ID.CLUSTER) {
      fimCluster = e.tam < 0 ? -2 : e.dados + e.tam;
      p = e.dados;
      if (aoProgresso && (++conta % 50 === 0)) aoProgresso(p / total);
      continue;
    }
    const tam = e.tam < 0 ? 0 : e.tam;
    if (e.id === ID.INFO || e.id === ID.TRACKS) {
      const d = (await r.ler(e.dados, tam)).slice();
      if (e.id === ID.INFO) lerInfo(d, (k, v) => { if (k === 'escala') escala = v; });
      else lerTracks(d, trilhas);
    } else if (e.id === ID.TC) {
      clusterTc = uint(await r.ler(e.dados, tam), 0, tam);
    } else if (e.id === ID.SIMPLE) {
      const h = await r.ler(e.dados, 12);
      const tn = lerTam(h, 0);
      const tc = (h[tn.n] << 8 | h[tn.n + 1]) << 16 >> 16;
      const fl = h[tn.n + 2];
      const ini = e.dados + tn.n + 3;
      (blocos[tn.v] || (blocos[tn.v] = [])).push([ini, e.dados + tam - ini, clusterTc + tc, (fl & 0x80) !== 0, 0, (fl >> 1) & 3]);
    } else if (e.id === ID.GRUPO) {
      const d = (await r.ler(e.dados, Math.min(tam, 64 << 10))).slice();
      let q = 0, bloco = null, dur = 0, ref = false;
      while (q < d.length) {
        const i2 = lerId(d, q); if (!i2) break;
        const t2 = lerTam(d, q + i2.n); if (!t2) break;
        const dd = q + i2.n + t2.n;
        if (i2.v === ID.BLOCO) bloco = { ini: dd, tam: t2.v };
        else if (i2.v === ID.BDUR) dur = uint(d, dd, t2.v);
        else if (i2.v === ID.REF) ref = true;
        q = dd + t2.v;
      }
      if (bloco) {
        const tn = lerTam(d, bloco.ini);
        const tc = (d[bloco.ini + tn.n] << 8 | d[bloco.ini + tn.n + 1]) << 16 >> 16;
        const fl = d[bloco.ini + tn.n + 2];
        const ini = e.dados + bloco.ini + tn.n + 3;
        (blocos[tn.v] || (blocos[tn.v] = [])).push([ini, bloco.tam - tn.n - 3, clusterTc + tc, !ref, dur, (fl >> 1) & 3]);
      }
    }
    p = e.dados + tam;
  }
  const kUs = escala / 1000;
  const tv = Object.values(trilhas).find((t) => t.tipo === 1 && blocos[t.num]);
  const ta = Object.values(trilhas).find((t) => t.tipo === 2 && blocos[t.num]);
  if (!tv) throw new Error('WebM sem trilha de vídeo');
  const bv = blocos[tv.num];
  if (bv.some((x) => x[5])) throw new Error('WebM com lacing no vídeo não suportado');
  const n = bv.length;
  const dec = { pos: new Float64Array(n), tam: new Uint32Array(n), pts: new Float64Array(n), chave: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    dec.pos[i] = bv[i][0]; dec.tam[i] = bv[i][1];
    dec.pts[i] = Math.round(bv[i][2] * kUs); dec.chave[i] = bv[i][3] ? 1 : 0;
  }
  dec.chave[0] = 1;
  // começa no zero, como o <video> mostra
  const t0 = Math.min(...dec.pts.subarray(0, Math.min(n, 16)));
  const ordem = Array.from({ length: n }, (_, i) => i).sort((x, y) => dec.pts[x] - dec.pts[y]);
  const pts = new Float64Array(n + 1);
  const decDe = new Uint32Array(n), presDe = new Uint32Array(n);
  for (let i = 0; i < n; i++) { pts[i] = dec.pts[ordem[i]] - t0; decDe[i] = ordem[i]; presDe[ordem[i]] = i; }
  for (let i = 0; i < n; i++) dec.pts[i] -= t0;
  const durUlt = bv[ordem[n - 1]][4] ? Math.round(bv[ordem[n - 1]][4] * kUs) : (n > 1 ? Math.round((pts[n - 1] - pts[0]) / (n - 1)) : 33333);
  pts[n] = pts[n - 1] + durUlt;
  const video = finalizarVideo({
    codec: codecWebm(tv), descricao: tv.codec === 'V_MPEG4/ISO/AVC' ? tv.priv : (tv.codec === 'V_AV1' && tv.priv ? tv.priv : null),
    largura: tv.largura, altura: tv.altura, n, dec, pts, decDe, presDe,
  });
  let audio = null;
  if (ta && !blocos[ta.num].some((x) => x[5])) {
    const ba = blocos[ta.num];
    const m = ba.length;
    const da = { pos: new Float64Array(m), tam: new Uint32Array(m), pts: new Float64Array(m), dur: new Float64Array(m) };
    const atrasoUs = Math.round((ta.atraso || 0) / 1000);
    for (let i = 0; i < m; i++) {
      da.pos[i] = ba[i][0]; da.tam[i] = ba[i][1];
      da.pts[i] = Math.round(ba[i][2] * kUs) - t0 - atrasoUs;
    }
    for (let i = 0; i < m; i++) da.dur[i] = i + 1 < m ? da.pts[i + 1] - da.pts[i] : (m > 1 ? da.dur[i - 1] : 20000);
    const ca = ta.codec === 'A_OPUS' ? 'opus' : ta.codec === 'A_VORBIS' ? 'vorbis' : ta.codec === 'A_AAC' ? 'mp4a.40.2' : null;
    audio = { codec: ca, descricao: ta.priv || null, taxa: ta.taxa || 48000, canais: ta.canais || 2, n: m, dec: da };
  }
  return { formato: 'webm', video, audio, duracaoUs: video.pts[video.n] };
}

function lerInfo(d, cb) {
  let q = 0;
  while (q < d.length) {
    const i = lerId(d, q); if (!i) break;
    const t = lerTam(d, q + i.n); if (!t) break;
    const dd = q + i.n + t.n;
    if (i.v === ID.ESCALA) cb('escala', uint(d, dd, t.v));
    q = dd + t.v;
  }
}

function lerTracks(d, trilhas) {
  let q = 0;
  while (q < d.length) {
    const i = lerId(d, q); if (!i) break;
    const t = lerTam(d, q + i.n); if (!t) break;
    const dd = q + i.n + t.n;
    if (i.v === ID.ENTRY) {
      const tr = {};
      const percorre = (ini, fim) => {
        let s = ini;
        while (s < fim) {
          const i2 = lerId(d, s); if (!i2) break;
          const t2 = lerTam(d, s + i2.n); if (!t2) break;
          const d2 = s + i2.n + t2.n;
          switch (i2.v) {
            case ID.NUM: tr.num = uint(d, d2, t2.v); break;
            case ID.TIPO: tr.tipo = uint(d, d2, t2.v); break;
            case ID.CODEC: tr.codec = new TextDecoder().decode(d.subarray(d2, d2 + t2.v)).replace(/\0+$/, ''); break;
            case ID.PRIV: tr.priv = d.slice(d2, d2 + t2.v); break;
            case ID.ATRASO: tr.atraso = uint(d, d2, t2.v); break;
            case ID.LARG: tr.largura = uint(d, d2, t2.v); break;
            case ID.ALT: tr.altura = uint(d, d2, t2.v); break;
            case ID.TAXA: tr.taxa = flt(d, d2, t2.v); break;
            case ID.CANAIS: tr.canais = uint(d, d2, t2.v); break;
            case ID.VIDEO: case ID.AUDIO: percorre(d2, d2 + t2.v); break;
            default: break;
          }
          s = d2 + t2.v;
        }
      };
      percorre(dd, dd + t.v);
      if (tr.num) trilhas[tr.num] = tr;
    }
    q = dd + t.v;
  }
}

function codecWebm(tr) {
  switch (tr.codec) {
    case 'V_VP8': return 'vp8';
    case 'V_VP9': return 'vp09.00.41.08';
    case 'V_AV1': return 'av01.0.08M.08';
    case 'V_MPEG4/ISO/AVC': return tr.priv ? 'avc1.' + hex2(tr.priv[1]) + hex2(tr.priv[2]) + hex2(tr.priv[3]) : 'avc1.640028';
    default: return null;
  }
}

/* ======================================================= leitura de bytes */

/**
 * Lê os bytes das amostras [i0, i1) (ordem de decodificação) em blocos
 * contíguos de até `maxBloco` bytes, chamando `cada(i, bytes)` em ordem.
 * Interrompível: `cancelado()` verdadeiro para no próximo bloco.
 */
export async function lerAmostras(blob, dec, i0, i1, cada, { maxBloco = 8 << 20, cancelado } = {}) {
  let i = i0;
  while (i < i1) {
    if (cancelado && cancelado()) return;
    let j = i;
    let ini = dec.pos[i], fim = dec.pos[i] + dec.tam[i];
    while (j + 1 < i1) {
      const p = dec.pos[j + 1], f = p + dec.tam[j + 1];
      const novoIni = Math.min(ini, p), novoFim = Math.max(fim, f);
      if (novoFim - novoIni > maxBloco) break;
      ini = novoIni; fim = novoFim; j++;
    }
    const buf = new Uint8Array(await blob.slice(ini, fim).arrayBuffer());
    for (let k = i; k <= j; k++) {
      const o = dec.pos[k] - ini;
      await cada(k, buf.subarray(o, o + dec.tam[k]));
    }
    i = j + 1;
  }
}

/** Índice do quadro (apresentação) que contém o instante t (µs): o último com pts ≤ t. */
export function quadroEm(pts, n, t) {
  if (t <= pts[0]) return 0;
  if (t >= pts[n]) return n - 1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (pts[m] <= t) lo = m; else hi = m - 1;
  }
  return lo;
}

/**
 * Primeira amostra (ordem de decodificação) por onde começar para obter o
 * quadro de apresentação `q`: o último quadro-chave antes dele cujo pts não
 * passe do pts de `q` (quadros "à frente" de um I aberto pedem o GOP anterior).
 */
export function chaveAntes(video, q) {
  const { dec, decDe } = video;
  const alvo = decDe[q];
  const tq = video.pts[q];
  for (let i = alvo; i >= 0; i--) {
    if (dec.chave[i] && dec.pts[i] <= tq) return i;
  }
  return 0;
}

/** Índice de quadros sintético quando o contêiner não pôde ser lido (só o <video>). */
export function indiceSintetico(duracaoS, fps) {
  const n = Math.max(1, Math.round(duracaoS * fps));
  const pts = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) pts[i] = Math.round(i * 1e6 / fps);
  return { n, pts, fps, cfr: true, sintetico: true, largura: 0, altura: 0, dec: null };
}
