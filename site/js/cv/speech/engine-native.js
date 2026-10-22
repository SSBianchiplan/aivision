/**
 * cv/speech/engine-native.js — reconhecimento de fala do próprio navegador.
 *
 * ================= O QUE ELE É, E O QUE NÃO É =================
 *
 * A Web Speech API (`SpeechRecognition`) entrega legenda quase instantânea,
 * com resultados provisórios enquanto a pessoa ainda fala, e entende
 * português do Brasil bem. Mas tem dois limites que decidem quando usá-la:
 *
 *   1. SÓ OUVE O MICROFONE. Não há como entregar um MediaStream a ela. Para
 *      legendar o áudio de uma aba capturada ou do Osmo, é o motor local
 *      (engine-whisper.js) — a menos que esse som esteja saindo pelos
 *      alto-falantes, e aí o microfone o pega, com a qualidade que isso tem.
 *
 *   2. NO CHROME, O ÁUDIO VAI PARA OS SERVIDORES DO GOOGLE. É assim que ele
 *      reconhece. A interface diz isso com todas as letras antes de ligar,
 *      porque num sistema que trata dado sensível a pessoa precisa saber o
 *      que sai da máquina. Safari processa no aparelho (Siri).
 *
 * Firefox não implementa a API: `disponivel()` responde false e o painel
 * oferece só o motor local.
 *
 * ================= O REINÍCIO =================
 *
 * O Chrome encerra o reconhecimento sozinho depois de alguns segundos de
 * silêncio, ou a cada ~60 s, disparando `end` sem erro. Uma legenda «ao
 * vivo» que morre no primeiro silêncio não serve — então religamos
 * automaticamente enquanto o usuário não mandar parar. Com recuo curto, para
 * uma falha real (microfone removido) não virar laço a 100% de CPU.
 * ================================================
 */

const SR = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition)
  : null;

export function disponivel() {
  return Boolean(SR);
}

export function nome() { return 'nativo (navegador)'; }

/** Onde o áudio é processado — para a interface avisar antes de ligar. */
export function ondeProcessa() {
  const ua = navigator.userAgent || '';
  if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return 'no aparelho (Apple)';
  return 'nos servidores do fornecedor do navegador (Google)';
}

export class MotorNativo {
  constructor({ idioma = 'pt-BR', onResultado, onEstado } = {}) {
    this.idioma = idioma;
    this.onResultado = onResultado;   // ({ texto, final, inicio, fim, confianca })
    this.onEstado = onEstado;         // ('ouvindo' | 'parado' | 'erro', detalhe)
    this.rec = null;
    this.ativo = false;
    this.inicioTrecho = 0;
    this.tentativas = 0;
  }

  start() {
    if (!SR) throw new Error('Este navegador não tem reconhecimento de fala nativo.');
    if (this.ativo) return;
    this.ativo = true;
    this.tentativas = 0;
    this.#ligar();
  }

  #ligar() {
    this.comecou = false;
    const r = new SR();
    r.lang = this.idioma;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    this.rec = r;

    r.onstart = () => {
      this.comecou = true;
      clearTimeout(this.vigia);
      this.inicioTrecho = Date.now();
      this.tentativas = 0;
      this.onEstado && this.onEstado('ouvindo');
    };

    r.onresult = (ev) => {
      const agora = Date.now();
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const alt = res[0];
        if (!alt) continue;
        if (res.isFinal) {
          this.onResultado && this.onResultado({
            texto: alt.transcript, final: true,
            inicio: this.inicioTrecho, fim: agora,
            confianca: typeof alt.confidence === 'number' ? alt.confidence : null,
          });
          this.inicioTrecho = agora;
        } else {
          interim += alt.transcript;
        }
      }
      if (interim) {
        this.onResultado && this.onResultado({ texto: interim, final: false, inicio: this.inicioTrecho, fim: agora });
      }
    };

    r.onerror = (ev) => {
      /*
       * 'no-speech' e 'aborted' são normais e vêm seguidos de `end`, que
       * religa. Todo o resto PARA e diz o que foi — a primeira versão só
       * tratava dois códigos e deixava os outros religarem em silêncio: o
       * botão «não ativava» e ninguém sabia por quê.
       */
      const e = ev.error || 'desconhecido';
      if (e === 'no-speech' || e === 'aborted') return;
      const msg = {
        'not-allowed': 'Microfone negado. Permita o acesso ao site e tente de novo.',
        'service-not-allowed': 'O reconhecimento de fala está desativado neste aparelho (no iPhone: Ajustes › Siri e Ditado).',
        'audio-capture': 'Nenhum microfone encontrado.',
        'network': 'Sem rede: o reconhecimento nativo depende do servidor do navegador.',
        'language-not-supported': 'Este navegador não reconhece o idioma escolhido.',
        'bad-grammar': 'Configuração de idioma inválida.',
      }[e] || `O reconhecimento falhou (${e}).`;
      this.ativo = false;
      this.onEstado && this.onEstado('erro', msg + ' Alternativa: o motor LOCAL ou o SERVIDOR.');
    };

    r.onend = () => {
      this.rec = null;
      if (!this.ativo) { this.onEstado && this.onEstado('parado'); return; }
      // recuo: 250 ms, 500, 1000, … até 5 s — silêncio normal religa quase na hora
      const espera = Math.min(5000, 250 * 2 ** Math.min(this.tentativas++, 4));
      setTimeout(() => { if (this.ativo) this.#ligar(); }, espera);
    };

    /*
     * Alguns navegadores (Safari no iPhone, por exemplo) lançam AQUI em vez de
     * disparar onerror — e um catch vazio transformava isso em «cliquei e
     * nada aconteceu». Agora vira erro visível.
     */
    try {
      r.start();
    } catch (e) {
      this.ativo = false;
      this.onEstado && this.onEstado('erro',
        'O navegador não iniciou o reconhecimento (' + (e && e.name || 'erro') + '). ' +
        'Use o motor LOCAL ou o SERVIDOR.');
      return;
    }
    // sem onstart em 4 s, o navegador travou em silêncio: dizer é melhor que esperar
    this.vigia = setTimeout(() => {
      if (this.ativo && this.rec === r && !this.comecou) {
        this.onEstado && this.onEstado('erro',
          'O reconhecimento não começou em 4 s. Confira a permissão do microfone ou use outro motor.');
        this.stop();
      }
    }, 4000);
  }

  stop() {
    this.ativo = false;
    clearTimeout(this.vigia);
    if (this.rec) {
      try { this.rec.stop(); } catch (_) { /* já parado */ }
    }
  }
}
