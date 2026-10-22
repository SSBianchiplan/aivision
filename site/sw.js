/**
 * sw.js — service worker do GPlanSiS|iaVision.
 *
 * ============== O QUE ESTE ARQUIVO PODE E NÃO PODE CACHEAR ==============
 *
 * A app tem três classes de recurso, e tratá-las igual daria problema:
 *
 *   CASCA (html, js, css, ícones) — ~600 KB, muda a cada deploy.
 *     Estratégia: rede primeiro, cache como reserva. Assim um deploy chega
 *     na hora, e ficar sem rede ainda abre a aplicação.
 *
 *   PESOS (.onnx, .wasm) — 130 MB, imutáveis. Um modelo nunca muda de
 *     conteúdo sem mudar de nome.
 *     Estratégia: cache primeiro. Baixar 35 MB de novo a cada abertura seria
 *     inaceitável em rede móvel. NÃO são pré-cacheados na instalação: só
 *     entram no cache quando alguém realmente usa aquele modelo — pré-cachear
 *     130 MB na instalação estouraria a cota do navegador e gastaria o plano
 *     de dados de quem só queria abrir o app.
 *
 *   API (/api/*) — sessão, biometria, permissão.
 *     Estratégia: NUNCA cachear. Resposta de autenticação servida do cache é
 *     um usuário entrando com sessão morta, ou pior, vendo dado de outro.
 *     Estas requisições nem passam pelo worker.
 * ========================================================================
 */

const VERSION = 'iav-v94-vps';   // 22/10/2026: onda 2-d — CV-80..87: física, acessibilidade, Libras, sala de aula, mídia, agro, câmera de jogo, diário de obra; página 83/150
const SHELL = `${VERSION}-shell`;
/*
 * Pesos dos modelos num cache de nome FIXO: sobrevivem às publicações. Antes o
 * nome levava a versão e cada deploy apagava dezenas de MB já baixados.
 * O runtime (.wasm) e os modelos treinados pelo usuário (podem ser republicados
 * com o mesmo nome) ficam num cache da versão, que é renovado a cada deploy.
 */
const HEAVY = 'iav-models-v1';
const RUNTIME = `${VERSION}-runtime`;

/** A casca mínima para a aplicação abrir sem rede. */
const SHELL_FILES = [
  '/',                 // landing
  '/index.html',
  '/app.html',         // o sistema
  '/manifest.webmanifest',
  '/css/app.css',
  '/css/gate.css',
  '/css/controls.css',
  '/css/theme.css',
  '/vendor/react.js',
  '/vendor/react-dom.js',
  '/vendor/htm.js',
  '/icons/favicon.svg',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    /*
     * addAll é tudo-ou-nada: um 404 em qualquer arquivo aborta a instalação
     * inteira e o worker nunca ativa. Individualmente, um recurso que faltou
     * apenas não fica disponível offline.
     */
    await Promise.all(SHELL_FILES.map((u) =>
      c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes
      .filter((n) => !n.startsWith(VERSION) && n !== HEAVY)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/** O cliente pode pedir a ativação imediata de uma versão nova. */
self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

const pesoFixo = (p) => !p.includes('/models/custom/') && (p.endsWith('.onnx') || p.includes('/models/'));
const ehModelo = (p) => !p.endsWith('/index.json') && (/\.(onnx|wasm)$/.test(p) || p.includes('/models/'));   // a lista de modelos treinados muda: rede

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // só GET e só a própria origem
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // autenticação e dados nunca vêm do cache
  if (url.pathname.startsWith('/api/')) return;

  if (ehModelo(url.pathname)) {
    e.respondWith(cachePrimeiro(req, pesoFixo(url.pathname) ? HEAVY : RUNTIME));
    return;
  }
  e.respondWith(redePrimeiro(req));
});

/**
 * Pesos e runtime: cache primeiro.
 * São imutáveis, então servir do cache não corre risco de estar velho.
 */
async function cachePrimeiro(req, nome) {
  const c = await caches.open(nome);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  /*
   * Resposta parcial (206) não pode ir para o cache — o navegador rejeita, e
   * guardar meio modelo daria um arquivo corrompido no próximo uso.
   */
  if (res.ok && res.status === 200) c.put(req, res.clone()).catch(() => {});
  return res;
}

/*
 * Vídeo e áudio (ensaios do BeltScan, esteira de exemplo do CounterVision…)
 * não são casca: guardá-los duplicava megabytes no Cache Storage a cada
 * abertura de exemplo, e o app abre sem eles.
 */
const MIDIA = /\.(mp4|m4v|webm|mov|ogv|ogg|mp3|wav|m4a)$/i;
const guardavel = (req) => !MIDIA.test(new URL(req.url).pathname);

/** Mesma versão do arquivo: ETag igual ou (sem ETag) Last-Modified e tamanho iguais. */
function mesmaVersao(a, b) {
  const ea = a.headers.get('etag'), eb = b.headers.get('etag');
  if (ea && eb) return ea === eb;
  const la = a.headers.get('last-modified'), lb = b.headers.get('last-modified');
  return Boolean(la && lb && la === lb && a.headers.get('content-length') === b.headers.get('content-length'));
}

/*
 * Grava no cache só o que MUDOU. Antes, cada abertura regravava as ~200
 * respostas da casca (≈2–3 MB de escrita em disco a cada visita), mesmo
 * quando a rede só confirmava (304) o que já estava guardado.
 */
async function guardarSeMudou(c, req, res) {
  try {
    const velho = await c.match(req);
    if (velho && mesmaVersao(velho, res)) { if (res.body) res.body.cancel().catch(() => {}); return; }
    await c.put(req, res);
  } catch (_) { /* cota ou disco: segue sem reserva offline deste arquivo */ }
}

/**
 * Casca: rede primeiro, cache como reserva.
 * Um deploy aparece na primeira abertura com rede; sem rede, abre do cache.
 */
async function redePrimeiro(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200 && guardavel(req)) guardarSeMudou(c, req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    /*
     * Navegação sem rede e sem cache do caminho: entrega o SISTEMA, não a
     * landing. Quem está offline e abriu o app instalado quer o app; a
     * landing é vitrine e não funciona sem rede de qualquer jeito (fontes,
     * animações — nada essencial).
     */
    if (req.mode === 'navigate') {
      const app = await c.match('/app.html') || await c.match('/index.html') || await c.match('/');
      if (app) return app;
    }
    throw err;
  }
}
