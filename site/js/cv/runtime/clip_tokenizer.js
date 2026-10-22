/* CLIP byte-level BPE tokenizer (OpenAI CLIP / HF CLIPTokenizer), ported to plain JS.
 * Pipeline mirrors tokenizer.json: NFC -> collapse whitespace -> lowercase -> regex split
 * -> bytes-to-unicode -> BPE with the "</w>" end-of-word suffix. Verified against both
 * transformers' CLIPTokenizer (predicate encoder, max_len 32) and openai/CLIP's
 * clip.tokenize (MobileCLIP, context 77) on a fixture of odd strings.
 * Works in window and worker scope (no DOM). */
(function (root) {
  'use strict';
  const BOS = 49406, EOS = 49407;

  function bytesToUnicode() {
    const bs = [];
    for (let b = 33; b <= 126; b++) bs.push(b);
    for (let b = 161; b <= 172; b++) bs.push(b);
    for (let b = 174; b <= 255; b++) bs.push(b);
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) {
      if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
    }
    const map = new Array(256);
    for (let i = 0; i < bs.length; i++) map[bs[i]] = String.fromCodePoint(cs[i]);
    return map;
  }

  class ClipTokenizer {
    /** @param vocab  object token->id (vocab.json)
     *  @param merges  merges.txt text ("#version" header line optional) */
    constructor(vocab, merges) {
      this.encoder = vocab;
      const lines = merges.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      this.ranks = new Map();
      lines.forEach((l, i) => this.ranks.set(l, i));
      this.byteEncoder = bytesToUnicode();
      this.cache = new Map();
      this.pat = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|\p{L}+|\p{N}|[^\s\p{L}\p{N}]+/giu;
      this.utf8 = new TextEncoder();
    }

    static async load(baseUrl) {
      const [v, m] = await Promise.all([
        fetch(baseUrl + 'vocab.json').then(r => { if (!r.ok) throw new Error('vocab.json ' + r.status); return r.json(); }),
        fetch(baseUrl + 'merges.txt').then(r => { if (!r.ok) throw new Error('merges.txt ' + r.status); return r.text(); }),
      ]);
      return new ClipTokenizer(v, m);
    }

    bpe(token) {
      const cached = this.cache.get(token);
      if (cached !== undefined) return cached;
      const chars = Array.from(token);
      let word = chars.slice(0, -1).concat([chars[chars.length - 1] + '</w>']);
      if (word.length === 1) { this.cache.set(token, word[0]); return word[0]; }
      for (;;) {
        // lowest-rank adjacent pair
        let best = null, bestRank = Infinity;
        for (let i = 0; i < word.length - 1; i++) {
          const r = this.ranks.get(word[i] + ' ' + word[i + 1]);
          if (r !== undefined && r < bestRank) { bestRank = r; best = [word[i], word[i + 1]]; }
        }
        if (best === null) break;
        const [a, b] = best, out = [];
        let i = 0;
        while (i < word.length) {
          const j = word.indexOf(a, i);
          if (j === -1) { for (; i < word.length; i++) out.push(word[i]); break; }
          for (; i < j; i++) out.push(word[i]);
          if (word[i] === a && i < word.length - 1 && word[i + 1] === b) { out.push(a + b); i += 2; }
          else { out.push(word[i]); i += 1; }
        }
        word = out;
        if (word.length === 1) break;
      }
      const res = word.join(' ');
      this.cache.set(token, res);
      return res;
    }

    /** text -> BPE ids, no special tokens */
    encode(text) {
      text = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
      const ids = [];
      for (const m of text.matchAll(this.pat)) {
        const tok = m[0];
        if (tok === '<|startoftext|>') { ids.push(BOS); continue; }
        if (tok === '<|endoftext|>') { ids.push(EOS); continue; }
        let s = '';
        for (const b of this.utf8.encode(tok)) s += this.byteEncoder[b];
        for (const piece of this.bpe(s).split(' ')) {
          const id = this.encoder[piece];
          ids.push(id === undefined ? EOS : id);       // unk = <|endoftext|>, unreachable with byte-level
        }
      }
      return ids;
    }

    /** transformers-style: [BOS] + ids + [EOS], truncated to maxLen (EOS kept last), NO padding */
    encodeHF(text, maxLen) {
      let ids = this.encode(text);
      if (ids.length > maxLen - 2) ids = ids.slice(0, maxLen - 2);
      return [BOS, ...ids, EOS];
    }

    /** openai/CLIP clip.tokenize: [BOS]+ids+[EOS] truncated to ctx (EOS forced last), zero-padded to ctx */
    encodeClip(text, ctx = 77) {
      let ids = [BOS, ...this.encode(text), EOS];
      if (ids.length > ctx) { ids = ids.slice(0, ctx); ids[ctx - 1] = EOS; }
      const out = new Int32Array(ctx);
      out.set(ids);
      return out;
    }
  }
  ClipTokenizer.BOS = BOS; ClipTokenizer.EOS = EOS;
  root.ClipTokenizer = ClipTokenizer;
})(typeof self !== 'undefined' ? self : globalThis);

// ---- casca ES do hub: o arquivo acima é o do demo, sem alteração ----
export const ClipTokenizer = globalThis.ClipTokenizer;
let _tok = null;
/** Vocabulário/merges do CLIP (BPE 49408) — os mesmos arquivos de /relacoes/. */
export function loadClipTokenizer() {
  if (!_tok) _tok = ClipTokenizer.load(new URL('relacoes/assets/tokenizer/', document.baseURI).href);
  return _tok;
}
