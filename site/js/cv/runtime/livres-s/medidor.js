/**
 * cv/runtime/livres-s/medidor.js — leitura de HIDRÔMETRO / medidor acumulador
 * (98), sem DOM:
 *
 *   numeroDosTextos  junta as linhas do OCR da ROI (esquerda → direita), fica
 *                    com os dígitos e aplica as casas decimais do mostrador
 *                    (hidrômetro: 5 rolos pretos em m³ + 3 vermelhos em litros
 *                    → digitos 8, decimais 3). Letras parecidas com dígitos
 *                    (O→0, I/l→1, S→5, B→8) são corrigidas.
 *   FiltroAcumulador o medidor só SOBE: leitura menor que a última aceita (rolo
 *                    no meio da troca) ou com salto acima de `maxPorHora` é
 *                    rejeitada; a leitura vale quando se repete `confirmar`
 *                    vezes. Consumo desde o início e vazão média.
 */

const PARECIDOS = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', i: '1', Z: '2', z: '2', S: '5', s: '5', B: '8', G: '6', b: '6', g: '9', q: '9' };

/**
 * textos: [{ text, x1 }] da ROI. o = { digitos (0 = qualquer), decimais }.
 * Devolve { valor, texto (só dígitos), ok }.
 */
export function numeroDosTextos(textos, o = {}) {
  const ord = (textos || []).slice().sort((a, b) => (a.x1 ?? 0) - (b.x1 ?? 0));
  let s = '';
  for (const t of ord) {
    for (const ch of String(t.text || '')) {
      if (/\d/.test(ch)) s += ch;
      else if (PARECIDOS[ch] != null) s += PARECIDOS[ch];
    }
  }
  const dig = o.digitos | 0, dec = Math.max(0, o.decimais | 0);
  if (!s) return { valor: NaN, texto: '', ok: false };
  if (dig > 0) {
    if (s.length < dig) return { valor: NaN, texto: s, ok: false };
    s = s.slice(0, dig);   // texto miúdo à direita (série, ano) fica de fora
  }
  const v = Number(s) / 10 ** dec;
  return { valor: v, texto: s, ok: Number.isFinite(v) };
}

export class FiltroAcumulador {
  constructor(o = {}) { this.o = { confirmar: 2, maxPorHora: Infinity, tolerancia: 0, ...o }; this.zerar(); }
  zerar() { this.ult = null; this.cand = null; this.n = 0; this.inicio = null; this.hist = []; this.rejeitadas = 0; }

  /** Uma leitura (valor) no instante t (s). Devolve { aceita, motivo }. */
  passo(v, t) {
    if (!Number.isFinite(v)) return { aceita: false, motivo: 'ilegível' };
    if (this.ult) {
      if (v < this.ult.v - this.o.tolerancia) { this.rejeitadas++; this.cand = null; return { aceita: false, motivo: 'menor que a anterior' }; }
      const horas = Math.max(1 / 3600, (t - this.ult.t) / 3600);
      if ((v - this.ult.v) / horas > this.o.maxPorHora) { this.rejeitadas++; this.cand = null; return { aceita: false, motivo: 'salto grande demais' }; }
    }
    if (this.cand && this.cand.v === v) this.n++;
    else { this.cand = { v, t }; this.n = 1; }
    if (this.n < this.o.confirmar) return { aceita: false, motivo: 'confirmando' };
    if (!this.ult || v !== this.ult.v) {
      this.ult = { v, t };
      if (!this.inicio) this.inicio = { v, t };
      this.hist.push([t, v]);
      if (this.hist.length > 5000) this.hist.shift();
    } else this.ult.t = t;
    return { aceita: true, motivo: '' };
  }

  /** Consumo desde a 1ª leitura aceita e vazão média (unidade/h). */
  consumo() {
    if (!this.inicio || !this.ult) return { consumo: null, porHora: null, horas: 0 };
    const horas = (this.ult.t - this.inicio.t) / 3600;
    const c = this.ult.v - this.inicio.v;
    return { consumo: c, porHora: horas > 0 ? c / horas : null, horas };
  }
}
