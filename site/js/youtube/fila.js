/**
 * youtube/fila.js — tocar uma playlist em sequência no player do YouTube.
 *
 * Fica no módulo (e não no painel): o painel Fonte pode fechar — no celular
 * ele fecha sozinho para o vídeo aparecer — e a fila tem de continuar.
 *
 * Ao terminar um vídeo (camera/youtube.js, estado 0):
 *   1. Repetir (botão ⟲ da barra de vídeo) ligado → repete o MESMO vídeo
 *      (isso é decidido lá, antes de perguntar à fila);
 *   2. senão, a fila carrega o próximo da playlist;
 *   3. no último: com «repetir a playlist» volta ao primeiro, senão a fila
 *      acaba e o fim segue o caminho normal (congela no último quadro).
 *
 * A fila segue o vídeo pelo ID, não pela posição: reordenar ou remover
 * vídeos com a playlist tocando não faz pular para o vídeo errado. Se a
 * pessoa abrir outro vídeo por fora, a fila se desliga sozinha.
 */

import { obterPlaylist } from './playlists.js';
import { store, persist } from '../state/store.js';

const subs = new Set();

export const fila = {
  yt: null,
  plId: null,
  videoId: null,          // vídeo da fila que está (ou deveria estar) no player
  repetirLista: false,

  ouvir(fn) { subs.add(fn); return () => subs.delete(fn); },
  _avisar() { for (const fn of subs) { try { fn(this); } catch (_) { /* ouvinte ruim */ } } },

  /** Liga a fila à instância única de YouTubeSource (workspace.js). */
  ligar(yt) {
    this.yt = yt;
    yt.fila = this;
    yt.aoTerminar = () => this._terminou();
  },

  get playlist() { return this.plId ? obterPlaylist(this.plId) : null; },

  /** Ativa só enquanto o player mostra o vídeo da fila. */
  get ativa() {
    const p = this.playlist;
    return Boolean(p && p.itens.length && this.yt && this.yt.videoId === this.videoId);
  },

  /** { indice, total } do vídeo atual na playlist. */
  get posicao() {
    const p = this.playlist;
    if (!p) return { indice: -1, total: 0 };
    return { indice: p.itens.findIndex((i) => i.id === this.videoId), total: p.itens.length };
  },

  /**
   * Começa a playlist no índice dado. `carregar: false` quando quem chama já
   * abriu o vídeo pelo fluxo normal do painel.
   */
  iniciar(plId, indice = 0, { carregar = true } = {}) {
    const p = obterPlaylist(plId);
    if (!p || !p.itens.length) return null;
    const i = Math.min(Math.max(0, indice), p.itens.length - 1);
    this.plId = plId;
    this.videoId = p.itens[i].id;
    /*
     * Quem manda tocar a playlist quer que ela ANDE: o Repetir (⟲) de vídeo
     * único vem ligado de fábrica e prenderia a fila no primeiro vídeo. Desliga
     * aqui; se a pessoa religar depois, a barra da playlist avisa.
     */
    if (store.get().loop !== false) { store.set({ loop: false }); persist(); }
    this._avisar();
    if (carregar) return this._carregar(p.itens[i]);
    return p.itens[i];
  },

  _carregar(item) {
    this.videoId = item.id;
    this._avisar();
    if (!this.yt) return item;
    this.yt.carregar(item.id, { aspecto: item.aspecto || undefined }).catch((e) => {
      this.yt.erro = e.message;
      this.yt._avisar();
    });
    return item;
  },

  /** Vai `passo` vídeos para a frente (+1) ou para trás (−1). false se não há para onde ir. */
  pular(passo) {
    const p = this.playlist;
    if (!p || !p.itens.length) return false;
    let i = p.itens.findIndex((x) => x.id === this.videoId);
    if (i < 0) i = passo > 0 ? -1 : 0;   // o vídeo saiu da playlist: recomeça das pontas
    let j = i + passo;
    if (j >= p.itens.length) { if (!this.repetirLista) return false; j = 0; }
    if (j < 0) { if (!this.repetirLista) return false; j = p.itens.length - 1; }
    this._carregar(p.itens[j]);
    return true;
  },
  proximo() { return this.pular(1); },
  anterior() { return this.pular(-1); },

  parar() {
    this.plId = null;
    this.videoId = null;
    this._avisar();
  },

  alternarRepetir() {
    this.repetirLista = !this.repetirLista;
    this._avisar();
  },

  /** Chamado pelo player no fim do vídeo (sem o Repetir ligado). true = a fila tratou. */
  _terminou() {
    if (!this.ativa) { if (this.plId) this.parar(); return false; }
    if (this.proximo()) return true;
    this.parar();                         // acabou a playlist
    return false;
  },
};
