/**
 * cv/runtime/livres-k/canal.js — ponte entre o operador BeltScan e as telas.
 *
 * O executor não expõe o ctx do quadro fora da cadeia: o operador
 * (operators/livres-k/beltscan.js) processa e publica aqui o retrato do
 * quadro; o painel e a tela cheia (components/industrial/) assinam. O MOTOR
 * (configuração, referência, totais, alarmes, histórico) mora aqui e não no
 * estado do nó: apagar e recriar o nó no Pipeline não pode jogar fora a
 * referência capturada nem o histórico de alarmes, e os botões das telas
 * (capturar referência, calibrar, reconhecer…) precisam alcançá-lo.
 *
 * CONFIGURAÇÃO POR PERFIL: cada ensaio (feijão 1/2/3, bancada) ou perfil
 * criado pelo usuário tem o seu JSON "beltscan/4" guardado neste navegador
 * (localStorage 'aiv.beltscan.cfg:<perfil>'), como o HTML fazia por ensaio.
 *
 * TEMPO: com arquivo de vídeo, o tempo é o do VÍDEO (currentTime) — vazão e
 * volume integram o tempo do ensaio, não o do relógio, e a volta do vídeo
 * fecha o ciclo da bancada. O workspace registra a fonte com definirFonte().
 */
import { MotorBeltScan, ENSAIOS, normalizarConfig, PADRAO, clonar, predefFeijao } from './beltscan.js';

const CHAVE_CFG = 'aiv.beltscan.cfg:';
const CHAVE_ATIVO = 'aiv.beltscan.perfil';
const CHAVE_PERFIS = 'aiv.beltscan.perfis';

const ler = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const gravar = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } };

/** Perfis = ensaios embutidos + os criados pelo usuário. */
export function listaPerfis() {
  let extras = [];
  try { extras = JSON.parse(ler(CHAVE_PERFIS) || '[]') || []; } catch (_) { extras = []; }
  return [
    ...Object.entries(ENSAIOS).map(([id, e]) => ({ id, nome: e.rotulo, ensaio: true })),
    { id: 'campo', nome: 'Minha linha (câmera / campo)', ensaio: false },
    ...extras.filter((p) => p && p.id && !ENSAIOS[p.id] && p.id !== 'campo'),
  ];
}
export function criarPerfil(nome) {
  const id = 'p' + Date.now().toString(36);
  let extras = [];
  try { extras = JSON.parse(ler(CHAVE_PERFIS) || '[]') || []; } catch (_) { extras = []; }
  extras.push({ id, nome: String(nome || 'Perfil').slice(0, 60) });
  gravar(CHAVE_PERFIS, JSON.stringify(extras));
  return id;
}

let perfil = ler(CHAVE_ATIVO) || 'feijao1';
const motor = new MotorBeltScan(configGuardada(perfil) || configPadraoDoPerfil(perfil));
let salvas = motor.alteracoes;
/*
 * `pronto` = a configuração do perfil já é a dele (guardada, ou o JSON do
 * ensaio já buscado). Antes disso nada é gravado: senão o padrão provisório
 * de um ensaio ainda não buscado tomaria o lugar do JSON com a referência.
 */
let pronto = Boolean(configGuardada(perfil)) || !(ENSAIOS[perfil] && ENSAIOS[perfil].config);
let carregando = null;

/** Configuração inicial de um perfil sem nada guardado (antes de buscar o JSON do ensaio). */
function configPadraoDoPerfil(id) {
  const c = clonar(PADRAO);
  if (id && id.startsWith('feijao')) predefFeijao(c);
  return c;
}
function configGuardada(id) {
  const s = ler(CHAVE_CFG + id);
  if (!s) return null;
  try { return normalizarConfig(JSON.parse(s)); } catch (_) { return null; }
}

export function obterMotor() { return motor; }
export function perfilAtivo() { return perfil; }

/** Grava a configuração do perfil ativo se ela mudou (chamado a cada quadro e pelas telas). */
export function salvarSeMudou(forcar = false) {
  if (!pronto || carregando) return;
  if (!forcar && motor.alteracoes === salvas) return;
  salvas = motor.alteracoes;
  gravar(CHAVE_CFG + perfil, JSON.stringify(motor.exportar()));
}

/** Troca de perfil: grava o atual e carrega o outro (guardado, ou o padrão dele). */
export async function trocarPerfil(id, { buscarEnsaio = true } = {}) {
  if (id !== perfil) salvarSeMudou(true);      // o perfil que sai fica gravado
  const vez = (carregando = {});
  perfil = id;
  gravar(CHAVE_ATIVO, id);
  let c = configGuardada(id);
  if (!c && buscarEnsaio && ENSAIOS[id] && ENSAIOS[id].config) {
    try { c = await (await fetch(ENSAIOS[id].config)).json(); } catch (_) { c = null; }
  }
  if (carregando !== vez) return;               // outra troca começou depois desta
  carregando = null;
  motor.definirConfig(c || configPadraoDoPerfil(id));
  motor.journal.length = 0;
  pronto = true;
  salvas = -1; salvarSeMudou();
  avisar(true);
}

/** Volta o perfil ao original (o JSON do ensaio, ou o padrão), apagando o que foi guardado. */
export async function restaurarPerfil() {
  try { localStorage.removeItem(CHAVE_CFG + perfil); } catch (_) { /* segue */ }
  await trocarPerfil(perfil);
  motor.status = 'Configuração original do perfil restaurada.';
}

// ------------------------------------------------------------------ fonte e tempo

let fonte = null;
/** O workspace registra o ref da fonte do app (câmera, arquivo, tela, YouTube, stream). */
export function definirFonte(ref) { fonte = ref; }
/** { t (s), video } — tempo do vídeo para arquivo; do relógio para o resto. */
export function tempoDaFonte() {
  const s = fonte && fonte.current;
  if (s && s.kind === 'video' && s.video && s.video.readyState >= 2) {
    return { t: s.video.currentTime, video: true, duracao: s.video.duration || 0, pausado: s.video.paused };
  }
  if (s && s.kind === 'image') return { t: 0, video: false, imagem: true };
  return { t: performance.now() / 1000, video: false };
}
/** O vídeo do arquivo (para ir a um instante pela tendência), ou null. */
export function videoDaFonte() {
  const s = fonte && fonte.current;
  return s && s.kind === 'video' && s.video ? s.video : null;
}

// ------------------------------------------------------------------ retrato e assinantes

let retrato = null;
let quadro = null;          // último ImageData analisado (a tela cheia desenha dele)
let studio = false;
let ultimoMs = 0;
const ouvintes = new Set();
let timer = null, ultimoAviso = 0;

/** O operador chama a cada quadro analisado. */
export function publicar(r, img) {
  retrato = r; quadro = img; ultimoMs = performance.now();
  salvarSeMudou();
  avisar();
}
export function instantaneo() { return retrato; }
export function ultimoQuadro() { return quadro; }
/** Há quadro analisado nos últimos `ms` milissegundos? */
export function recente(ms = 3000) { return Boolean(retrato) && performance.now() - ultimoMs < ms; }

/** Tela cheia aberta: o operador não desenha o overlay no vídeo do app. */
export function definirStudio(v) { studio = Boolean(v); }
export function studioAberto() { return studio; }

function avisar(ja = false) {
  if (ja) { ultimoAviso = performance.now(); for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } } return; }
  if (timer) return;
  const espera = Math.max(0, 250 - (performance.now() - ultimoAviso));
  timer = setTimeout(() => {
    timer = null; ultimoAviso = performance.now();
    for (const f of ouvintes) { try { f(retrato); } catch (_) { /* desmontando */ } }
  }, espera);
}
/** Assina o retrato (no máximo 4×/s). Devolve a função que cancela. */
export function assinar(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
/** Avisa já (depois de um comando das telas). */
export function avisarAgora() { avisar(true); }

// ------------------------------------------------------------------ ensaios (amostras)

/**
 * Abre um ensaio gravado: troca para o perfil dele (configuração do
 * python/configs, com a referência vazia já capturada) e carrega o vídeo
 * como ARQUIVO na fonte do app — a barra de vídeo do app passa a controlá-lo.
 * `abrirArquivo` = o pickFile do workspace.
 */
export async function abrirEnsaio(id, abrirArquivo) {
  const e = ENSAIOS[id];
  if (!e) throw new Error('ensaio desconhecido');
  await trocarPerfil(id);
  motor.reiniciar(false);
  const resp = await fetch(e.video);
  if (!resp.ok) throw new Error(`vídeo do ensaio não encontrado (${resp.status})`);
  const blob = await resp.blob();
  const arq = new File([blob], e.video.split('/').pop(), { type: 'video/mp4' });
  if (abrirArquivo) await abrirArquivo(arq);
  motor.status = `Ensaio: ${e.rotulo}. ${motor.ref ? 'Referência salva carregada.' : 'A referência vazia será capturada automaticamente.'}`;
  avisar(true);
}

let garantido = false;
/**
 * Primeiro quadro: se o perfil ativo é um ensaio e nada foi guardado ainda,
 * busca o JSON dele (com a referência vazia) em vez de capturar uma nova.
 */
export function garantirPerfil() {
  if (garantido) return;
  garantido = true;
  if (!configGuardada(perfil) && ENSAIOS[perfil] && ENSAIOS[perfil].config) trocarPerfil(perfil).catch(() => {});
}

/** Trilha de vídeo da câmera em uso (para os controles da aba Câmera), ou null. */
export function trilhaDaCamera() {
  const s = fonte && fonte.current;
  if (!s) return null;
  const st = s.stream || (s.video && s.video.srcObject) || null;
  const tr = st && st.getVideoTracks ? st.getVideoTracks()[0] : null;
  return tr && tr.readyState === 'live' ? tr : null;
}
