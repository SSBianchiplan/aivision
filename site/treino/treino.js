/* iaVision · Treinar modelos. Fala com /api/treino (serviço na vps2). Sem dependências.
   Três caminhos: detector RF-DETR (Apache-2.0, recomendado), detector YOLO26 (AGPL-3.0) e anomalia PatchCore
   (Apache-2.0, só peças boas). Cada projeto tem vários treinos com nome, que entram numa fila.
   Entrada: primeiro tenta a conta do iaVision (POST /api/treino/sessao — o SERVIDOR confere se o e-mail é de
   admin e emite o mesmo token da senha); se não der, mostra a senha como sempre.
   v4: prints (Ctrl/⌘+V, arrastar, «Adicionar imagens») reduzidos no navegador (≤ 2048 px, JPEG 0,9), sem repetidas
   (sha256) e com a origem guardada no serviço; aba «Do YouTube» (treino-youtube.js); tema claro/escuro do iaVision.
   Nada é baixado da internet pelo servidor: toda imagem sai do navegador. */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
/* modais do sistema (js/components/dialogo.js) no lugar de confirm/prompt do navegador; import() porque este é script clássico */
const modais = () => import('/js/components/dialogo.js');
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
};
const S = { token: sessionStorage.getItem('aivTreino') || '', proj: null, projs: [], tab: 'guia', imgs: [], poll: null, urls: new Map(),
  aberto: null, comparar: new Set(), grupo: 'boa', form: null, estado: null, lista: [] };
const COR = ['#FFD84D', '#22d3ee', '#4ade80', '#f472b6', '#a78bfa', '#fb923c', '#38bdf8', '#f87171', '#a3e635', '#e879f9'];
const cor = (i) => COR[i % COR.length];
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
const num = (v, d = 3) => (v == null ? '—' : Number(v).toFixed(d));
const dataHora = (t) => { const d = new Date(t * 1000); return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const duracao = (s) => (s == null ? '—' : s < 90 ? Math.round(s) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h');
function toast(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { e.hidden = true; }, 3500); }

const MOTOR = {
  rfdetr: { nome: 'RF-DETR', lic: 'Apache-2.0', livre: true },
  yolo26: { nome: 'YOLO26', lic: 'AGPL-3.0', livre: false },
  patchcore: { nome: 'PatchCore', lic: 'Apache-2.0', livre: true },
};
const ATIVOS = ['fila', 'preparando', 'treinando', 'extraindo', 'calibrando', 'exportando', 'validando'];
const ESTADO = { fila: '⏳ Na fila', preparando: '🧰 Preparando os dados', treinando: '🏋 Treinando', extraindo: '🔎 Lendo as fotos boas',
  calibrando: '🎯 Calibrando o limiar', exportando: '📦 Exportando para ONNX', validando: '🧪 Conferindo o ONNX', pronto: '✅ Pronto',
  erro: '❌ Erro', cancelado: '⏹ Cancelado', interrompido: '⚠️ Interrompido' };

async function api(path, opt = {}) {
  const r = await fetch('/api/treino' + path, { ...opt, headers: { ...(opt.body && !(opt.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + S.token, ...(opt.headers || {}) } });
  if (r.status === 401 && path !== '/entrar') { sair(); throw new Error('Sessão expirada'); }
  if (!r.ok) { let m = 'Erro ' + r.status; try { m = (await r.json()).detail || m; } catch (_) {} throw new Error(m); }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}
async function imgURL(nome) {
  const k = S.proj + '/' + nome; if (S.urls.has(k)) return S.urls.get(k);
  const r = await fetch(`/api/treino/projetos/${S.proj}/imagens/${encodeURIComponent(nome)}`, { headers: { Authorization: 'Bearer ' + S.token } });
  const u = URL.createObjectURL(await r.blob()); S.urls.set(k, u); return u;
}

// ------------------------------------------------------------------ janela (diálogo)
function dialogo(titulo, corpo, botoes) {
  return new Promise((res) => {
    const fechar = (v) => { fundo.remove(); res(v); };
    const fundo = h('div', { class: 'modal', onclick: (e) => { if (e.target === fundo) fechar(null); } },
      h('div', { class: 'mcard', role: 'dialog', 'aria-label': titulo }, h('h3', {}, titulo), corpo,
        h('div', { class: 'bar end' }, ...botoes.map((b) => h('button', { class: 'btn ' + (b.cls || ''), onclick: async () => { const v = b.valor ? await b.valor() : b.v; if (v !== false) fechar(v); } }, b.t)))));
    document.body.append(fundo);
    const f = fundo.querySelector('input[type=text],textarea'); if (f) setTimeout(() => f.focus(), 30);
    fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(null); });
  });
}

// ------------------------------------------------------------------ acesso
function sair() { S.token = ''; sessionStorage.removeItem('aivTreino'); sessionStorage.removeItem('aivTreinoQuem'); clearInterval(S.poll); $('#app').hidden = true; $('#sair').hidden = true; $('#quem').hidden = true; $('#login').hidden = false; $('#lsso').hidden = false; }
/** SSO de admin: a sessão do iaVision (cookie) vai junto; o servidor decide. null = segue para a senha. */
async function entrarPorConta(manual) {
  $('#lerr').textContent = ''; $('#lsso').disabled = true;
  if (manual) $('#lsso').textContent = 'Conferindo a sua conta…';
  try {
    const r = await fetch('/api/treino/sessao', { method: 'POST', credentials: 'same-origin' });
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.token) {
      S.token = b.token; sessionStorage.setItem('aivTreino', b.token); sessionStorage.setItem('aivTreinoQuem', b.email || '');
      return iniciar();
    }
    if (manual) $('#lerr').textContent = b.detail || 'Esta conta não entra sem senha.';
  } catch (_) { if (manual) $('#lerr').textContent = 'Não consegui conferir a sua conta agora.'; }
  finally { $('#lsso').disabled = false; $('#lsso').textContent = 'Entrar com a minha conta (admin)'; }
  $('#login').hidden = false;
  return null;
}
$('#lsso').onclick = () => entrarPorConta(true);
function mostrarQuem() {
  const q = sessionStorage.getItem('aivTreinoQuem') || '';
  $('#quem').textContent = q ? `Entrou como ${q} · admin` : 'Entrou com a senha do treino';
  $('#quem').hidden = false;
}
$('#fLogin').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#lerr').textContent = '';
  try { const r = await api('/entrar', { method: 'POST', body: JSON.stringify({ senha: $('#senha').value }) }); S.token = r.token; sessionStorage.setItem('aivTreino', r.token); sessionStorage.removeItem('aivTreinoQuem'); iniciar(); }
  catch (err) { $('#lerr').textContent = err.message; }
});
$('#sair').onclick = sair;

async function lerEstado() {
  try {
    const st = await api('/estado'); S.estado = st;
    $('#estado').textContent = `RF-DETR ${st.rfdetr || '—'} · Ultralytics ${st.ultralytics || '—'} · ${st.cpus} CPUs · ${st.livre_gb} GB livres` +
      (st.treinando ? ' · treinando' : '') + (st.fila && st.fila.length ? ` · ${st.fila.length} na fila` : '');
    return true;
  } catch (_) { return false; }
}
async function iniciar() {
  if (!(await lerEstado()) && !S.token) return;
  $('#login').hidden = true; $('#app').hidden = false; $('#sair').hidden = false; mostrarQuem();
  await carregarProjetos(); render();
}

// ------------------------------------------------------------------ projetos
async function carregarProjetos() { S.projs = await api('/projetos'); if (S.proj && !S.projs.some((p) => p.id === S.proj)) S.proj = null; desenharProjetos(); }
const tipoTag = (p) => (p.tipo === 'anomalia' ? h('span', { class: 'tag ok' }, 'Anomalia · PatchCore')
  : p.motor === 'yolo26' ? h('span', { class: 'tag agpl' }, 'YOLO26 · AGPL') : h('span', { class: 'tag ok' }, 'RF-DETR · livre'));
function desenharProjetos() {
  $('#projetos').replaceChildren(...S.projs.map((p) => h('div', { class: 'pj' + (p.id === S.proj ? ' on' : ''), onclick: () => { S.proj = p.id; S.aberto = null; S.comparar.clear(); S.form = null; S.formAberto = null; S.grupo = 'boa'; if (S.tab === 'guia') S.tab = 'imgs'; desenharProjetos(); render(); } },
    h('b', {}, p.nome), tipoTag(p), h('span', { class: 'mut small' }, p.tipo === 'anomalia' ? ` ${p.boas} boas · ${p.ruins} ruins` : ` ${p.classes.length} classes · ${p.rotuladas}/${p.imagens} rotuladas`))),
  S.projs.length ? '' : h('div', { class: 'mut small pad' }, 'Nenhum projeto ainda.'));
}
$('#novo').onclick = novoProjeto;
async function novoProjeto() {
  let tipo = 'rfdetr';
  const nome = h('input', { type: 'text', placeholder: 'ex.: EPI na obra · Tampas com defeito', maxlength: 60 });
  const classes = h('input', { type: 'text', placeholder: 'ex.: capacete, sem capacete, colete' });
  const lblCl = h('label', {}, h('span', {}, 'Classes (separadas por vírgula) — o que o detector deve achar'), classes);
  const op = (v, titulo, lic, txt, quando) => h('label', { class: 'tipo' + (v === tipo ? ' on' : '') },
    h('input', { type: 'radio', name: 'tipo', value: v, checked: v === tipo, onchange: () => { tipo = v; corpo.querySelectorAll('.tipo').forEach((e) => e.classList.toggle('on', e.querySelector('input').checked)); lblCl.hidden = v === 'patchcore'; } }),
    h('div', {}, h('b', {}, titulo, ' ', h('span', { class: 'tag ' + (lic === 'AGPL-3.0' ? 'agpl' : 'ok') }, lic)), h('div', { class: 'small' }, txt), h('div', { class: 'small mut' }, 'Quando usar: ', quando)));
  const corpo = h('div', { class: 'novo' },
    h('label', {}, h('span', {}, 'Nome do projeto'), nome),
    h('div', { class: 'tipos' },
      op('rfdetr', 'Detector livre (RF-DETR) — recomendado', 'Apache-2.0', 'Encontra e conta objetos desenhando caixas: você rotula exemplos de cada classe.', 'achar peças, EPIs, produtos, defeitos visíveis que você consegue marcar com uma caixa. Pode usar em produto sem abrir o código.'),
      op('yolo26', 'Detector YOLO26', 'AGPL-3.0', 'Mesmo trabalho de rotular; treina mais rápido na CPU e roda leve no navegador.', 'protótipos internos. Para oferecer a clientes, a AGPL obriga a abrir o código (ou licença paga da Ultralytics).'),
      op('patchcore', 'Anomalia (PatchCore) — só peças boas', 'Apache-2.0', 'Aprende como é uma peça BOA e aponta o que foge do normal, com mapa de calor e nota. Não precisa rotular.', 'inspeção de qualidade quando os defeitos são raros ou variados demais para rotular (riscos, manchas, falhas, peça faltando).')),
    lblCl);
  const r = await dialogo('Novo projeto', corpo, [{ t: 'Cancelar', cls: 'ghost', v: null }, { t: 'Criar projeto', cls: 'pri', valor: () => {
    if (!nome.value.trim()) { toast('Dê um nome ao projeto.'); return false; }
    const cl = classes.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (tipo !== 'patchcore' && !cl.length) { toast('Escreva pelo menos uma classe.'); return false; }
    return { nome: nome.value.trim(), tipo: tipo === 'patchcore' ? 'anomalia' : 'detector', motor: tipo === 'patchcore' ? undefined : tipo, classes: cl };
  } }]);
  if (!r) return;
  try { const p = await api('/projetos', { method: 'POST', body: JSON.stringify(r) }); S.proj = p.id; S.tab = 'imgs'; S.aberto = null; S.form = null; await carregarProjetos(); render(); toast(p.tipo === 'anomalia' ? 'Projeto criado. Agora envie as fotos de peças BOAS.' : 'Projeto criado. Agora envie as imagens.'); }
  catch (e) { toast(e.message); }
}
const projAtual = () => S.projs.find((p) => p.id === S.proj);

// ------------------------------------------------------------------ abas
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; S.tab = b.dataset.t; render(); });
function render() {
  const p = projAtual();
  document.querySelector('#tabs button[data-t="imgs"]').textContent = p && p.tipo === 'anomalia' ? '🖼 Fotos boas e ruins' : '🖼 Imagens e rótulos';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === S.tab));
  for (const t of ['guia', 'imgs', 'yt', 'treinar', 'modelos']) $('#t-' + t).hidden = t !== S.tab;
  // saindo do YouTube: pausa o vídeo e solta a captura da aba (treino-youtube.js)
  if (S.tab !== 'yt' && typeof ytSair === 'function') ytSair();
  const precisa = S.tab !== 'guia' && !S.proj; $('#vazio').hidden = !precisa; if (precisa) { $('#t-' + S.tab).hidden = true; return; }
  clearInterval(S.poll);
  if (S.tab === 'guia') guia(); if (S.tab === 'imgs') abaImagens(); if (S.tab === 'treinar') abaTreinar(); if (S.tab === 'modelos') abaModelos();
  if (S.tab === 'yt') { if (typeof abaYouTube === 'function') abaYouTube(); else $('#t-yt').replaceChildren(h('div', { class: 'err' }, 'Não carregou o módulo do YouTube. Recarregue a página.')); }
}

// ------------------------------------------------------------------ guia
function guia() {
  const passo = (n, t, ...c) => h('div', { class: 'passo' }, h('div', { class: 'n' }, n), h('div', {}, h('b', {}, t), ...c));
  const caminho = (t, lic, txt) => h('div', { class: 'cam' }, h('b', {}, t), ' ', h('span', { class: 'tag ' + (lic.startsWith('AGPL') ? 'agpl' : 'ok') }, lic), h('div', { class: 'small' }, txt));
  const tabela = (...linhas) => h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Ajuste'), h('th', {}, 'O que é'), h('th', {}, 'Comece com')), ...linhas.map((l) => h('tr', {}, ...l.map((c) => h('td', {}, c)))));
  $('#t-guia').replaceChildren(h('div', { class: 'guia' },
    h('h2', {}, 'Como criar e treinar um modelo'),
    h('p', { class: 'mut' }, 'Aqui você ensina um modelo com as SUAS fotos. O treino roda no servidor; quando termina, o modelo é publicado e aparece no iaVision para usar na câmera. Primeiro escolha o caminho:'),
    h('div', { class: 'cams' },
      caminho('1 · Detector livre (RF-DETR)', 'Apache-2.0', 'Acha e conta objetos com caixas. Você desenha caixas nas fotos. Recomendado: licença livre e boa precisão com poucas fotos.'),
      caminho('2 · Detector YOLO26', 'AGPL-3.0', 'O mesmo trabalho de rotular. Treina mais rápido e é leve, mas a AGPL obriga a abrir o código se for oferecido a terceiros.'),
      caminho('3 · Anomalia (PatchCore)', 'Apache-2.0', 'Inspeção de qualidade: só fotos de peças BOAS (e, se tiver, algumas ruins para conferir). Sem rotular. Mostra onde a peça foge do normal.')),
    h('div', { class: 'dica' }, 'Na dúvida: se você consegue apontar “é isto aqui” desenhando uma caixa, use um detector. Se o problema é “qualquer coisa diferente do normal” (risco, mancha, amassado, peça faltando) e você tem poucas fotos de defeito, use Anomalia.'),

    h('h3', {}, 'Caminhos 1 e 2 · Detector (RF-DETR ou YOLO26)'),
    passo(1, 'Crie o projeto e defina as classes', h('p', {}, 'Em ', h('b', {}, '＋ Novo'), ', escolha “Detector livre (RF-DETR)” e escreva uma classe por tipo de objeto: “capacete”, “sem capacete”, “colete”. Nomes curtos; comece com 1 a 5 classes (dá para acrescentar depois).'),
      h('div', { class: 'dica' }, 'Classes muito parecidas (ex.: dois parafusos quase iguais) pedem mais exemplos de cada uma.')),
    passo(2, 'Junte as imagens', h('ul', {},
      h('li', {}, h('b', {}, 'Quantidade: '), 'para testar, 20–30 por classe; para algo confiável, 100 a 300+ por classe. O RF-DETR costuma ir bem com menos fotos que o YOLO.'),
      h('li', {}, h('b', {}, 'Variedade: '), 'ângulos, distâncias, luzes e fundos diferentes — do jeito que a câmera vai ver no uso real.'),
      h('li', {}, h('b', {}, 'Negativos: '), 'inclua ~10% de imagens SEM os objetos e marque “Sem objetos”: reduz alarmes falsos.'),
      h('li', {}, h('b', {}, 'Origem: '), 'celular, prints da câmera (iaVision: Exportar › foto) ou um ZIP no formato YOLO (Roboflow, CVAT, Label Studio).'))),
    passo(3, 'Rotule (desenhe as caixas)', h('ul', {},
      h('li', {}, 'Em ', h('b', {}, 'Imagens e rótulos'), ', clique numa imagem, escolha a classe (teclas 1–9) e arraste para desenhar a caixa.'),
      h('li', {}, 'Caixa ', h('b', {}, 'justa'), ' no objeto; marque ', h('b', {}, 'todos'), ' os objetos que aparecem — um esquecido ensina o modelo a ignorá-lo.'),
      h('li', {}, '←/→ vai para a próxima e salva sozinho. Contorno vermelho = imagem ainda sem rótulo.'))),
    passo(4, 'Treine (RF-DETR)', tabela(
      ['Variante', '“nano” é a mais leve para CPU e navegador; small/medium/base são mais precisas e bem mais lentas (todas Apache-2.0).', 'nano'],
      ['Épocas', 'Quantas vezes o modelo vê todas as fotos. O RF-DETR aprende rápido: 10–30 costumam bastar.', '20 (teste: 8)'],
      ['Tamanho da imagem', 'Resolução do treino (múltiplo de 32). Objetos pequenos pedem 512; maior = mais lento e mais memória.', '384'],
      ['Lote × acumular', 'Fotos por passo e quantos passos somar antes de ajustar os pesos. No servidor (CPU, 6 GB): 2 × 4 (= 8).', '2 × 4'],
      ['Paciência', 'Para cedo se o mAP não melhorar por N épocas.', '10'],
      ['Validação', 'Parte das fotos separada só para medir (o modelo não treina com elas).', '20%']),
      h('div', { class: 'aviso' }, 'Tempo no servidor (CPU): o RF-DETR nano a 384 px leva ~3–4 s por foto por época (40 fotos × 20 épocas ≈ 45–60 min). O YOLO26n é ~3× mais rápido. No fim, o serviço confere o ONNX nas fotos de validação e, se não piorar, publica uma versão int8 (~3× menor) para o navegador.')),
    passo(5, 'Leia o resultado', h('ul', {},
      h('li', {}, h('b', {}, 'mAP50: '), 'nota geral de 0 a 100% (caixas que coincidem ≥ 50% com as suas). Acima de 70% já é útil; acima de 90%, muito bom.'),
      h('li', {}, h('b', {}, 'mAP50-95: '), 'a mesma nota com exigência maior de encaixe; costuma ser bem menor.'),
      h('li', {}, h('b', {}, 'Precisão / Recall: '), 'precisão baixa = alarmes falsos; recall baixo = deixa passar objetos.'),
      h('li', {}, h('b', {}, 'Validação do ONNX: '), 'precisão e recall medidos no arquivo final, do jeito que o navegador vai rodar.')),
      h('div', { class: 'dica' }, 'Nota baixa? Quase sempre resolve com mais fotos variadas e rótulos caprichados, não com mais épocas.')),

    h('h3', {}, 'Caminho 3 · Anomalia (PatchCore) — só peças boas'),
    passo(1, 'Crie o projeto de anomalia', h('p', {}, 'Em ', h('b', {}, '＋ Novo'), ', escolha “Anomalia (PatchCore)”. Não há classes nem caixas: o modelo aprende o “normal”.')),
    passo(2, 'Tire as fotos boas (o mais importante)', h('ul', {},
      h('li', {}, h('b', {}, 'Quantidade: '), 'mínimo 8; bom: 30 a 200 fotos de peças BOAS diferentes.'),
      h('li', {}, h('b', {}, 'Mesmo enquadramento: '), 'câmera fixa, peça sempre no mesmo lugar e tamanho, mesmo fundo. O PatchCore compara “pedacinho por pedacinho”: se o enquadramento muda muito, tudo parece anomalia.'),
      h('li', {}, h('b', {}, 'Iluminação: '), 'luz constante e difusa (sem sol entrando, sem reflexo estourado). Se a luz da linha varia ao longo do dia, fotografe as boas nessas variações.'),
      h('li', {}, h('b', {}, 'Variação normal: '), 'inclua as diferenças aceitáveis (pequena rotação, tom do material, sujeira leve que não reprova) — senão elas viram “defeito”.'))),
    passo(3, 'Algumas ruins (opcional, recomendado)', h('p', {}, 'Na aba ', h('b', {}, 'Fotos boas e ruins'), ', envie 5 a 20 fotos de peças com defeito em “Ruins”. Elas NÃO ensinam o modelo; servem para calibrar o limiar e medir se ele separa boas de ruins.'),
      h('div', { class: 'dica' }, 'Dá para importar um ZIP com as pastas boas/ e ruins/ (também aceita good/ e bad/, como no dataset MVTec AD).')),
    passo(4, 'Treine (é rápido)', tabela(
      ['Tamanho da imagem', 'Resolução da análise. Defeitos pequenos pedem 320; 256 é o equilíbrio.', '256'],
      ['Banco de memória', 'Quantos “pedacinhos de peça boa” o modelo guarda. Mais = mais fiel e arquivo maior (10.000 ≈ 26 MB).', '10.000'],
      ['Margem do limiar', 'Só sem fotos ruins: o limiar fica X% acima da pior peça boa de validação.', '10%'],
      ['Boas para calibrar', 'Parte das boas guardada fora do banco, para medir e calibrar.', '20%']),
      h('div', { class: 'aviso' }, 'Não há épocas: leva de segundos a poucos minutos (60 fotos ≈ 20 s).')),
    passo(5, 'Leia o resultado', h('ul', {},
      h('li', {}, h('b', {}, 'Gráfico de notas: '), 'cada ponto é uma foto de validação (verde = boa, vermelho = ruim); a linha amarela é o limiar. Bom modelo: verdes à esquerda, vermelhos à direita, sem misturar.'),
      h('li', {}, h('b', {}, 'AUROC: '), 'chance de uma ruim ter nota maior que uma boa (100% = separa perfeitamente).'),
      h('li', {}, h('b', {}, 'Acerto boas / ruins: '), 'quantas de cada grupo ficaram do lado certo do limiar.')),
      h('div', { class: 'dica' }, 'Boas com nota alta? Veja quais são (aparecem abaixo do gráfico): geralmente luz ou enquadramento diferente. Tire mais fotos boas nessa condição e treine de novo.')),

    h('h3', {}, 'Vários treinos, fila e comparação'),
    h('ul', {},
      h('li', {}, 'Cada projeto pode ter ', h('b', {}, 'vários treinos com nome'), ' (ex.: “nano 20 épocas — fotos de outubro”). O nome é o que aparece no iaVision; dá para renomear depois.'),
      h('li', {}, 'O servidor treina ', h('b', {}, 'um de cada vez'), '. Se já houver um rodando (de qualquer projeto), o novo entra na ', h('b', {}, 'fila'), ' e começa sozinho; a lista mostra a posição.'),
      h('li', {}, h('b', {}, 'Duplicar ajustes'), ' copia a configuração de um treino para um novo — bom para mudar uma coisa por vez.'),
      h('li', {}, 'Marque 2 ou mais treinos e clique em ', h('b', {}, 'Comparar'), ': tabela de métricas e curvas de mAP sobrepostas.'),
      h('li', {}, 'Cada treino pode ser ', h('b', {}, 'publicado ou despublicado'), ' à parte; apagar um treino publicado pergunta se o modelo também sai do iaVision.')),

    h('h3', {}, 'Use no iaVision'),
    h('ul', {},
      h('li', {}, h('b', {}, 'RF-DETR e PatchCore: '), 'Módulos › ', h('b', {}, 'CV-24 · Modelos treinados livres'), ' › “Detector treinado (RF-DETR, livre)” ou “Inspeção de anomalia (PatchCore)”.'),
      h('li', {}, h('b', {}, 'YOLO26: '), 'Módulos › ', h('b', {}, 'CV-16 · Modelos treinados'), ' › “Modelo treinado (GPlanSiS)”.'),
      h('li', {}, 'Campo “Modelo” vazio = usa o mais recente daquele tipo; para escolher, cole o identificador da aba Modelos.')),
    h('h3', {}, 'Prints e vídeos do YouTube'),
    h('ul', {},
      h('li', {}, h('b', {}, 'Print: '), 'tire um print (Win+Shift+S no Windows, ⌘+Ctrl+Shift+4 no Mac) e cole nesta página com ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'V'), ' (', h('kbd', {}, '⌘'), '+', h('kbd', {}, 'V'), '). Também vale arrastar arquivos ou usar “＋ Adicionar imagens”. O navegador reduz para até 2048 px, pula repetidas e guarda a origem (“print · data/hora”).'),
      h('li', {}, h('b', {}, 'Câmera: '), 'em ', h('b', {}, '📷 Câmera'), ' escolha a webcam (integrada, USB, celular como webcam) ou a câmera Wi-Fi / IP e tire fotos com ', h('kbd', {}, 'espaço'), ' ou a cada N segundos. Cada foto vai direto para o projeto, reduzida e sem repetidas, com a origem «câmera · data/hora». Na anomalia, escolha BOA ou RUIM antes.'),
      h('li', {}, h('b', {}, 'Do YouTube: '), 'na aba ', h('b', {}, '▶ Do YouTube'), ', cole o link (ou busque), escolha o trecho e capture quadros. O vídeo toca no player oficial; o navegador pede para compartilhar ESTA aba e recorta só o player. Nada é baixado do YouTube.'),
      h('li', {}, h('b', {}, 'Direitos: '), 'prints e quadros de vídeo podem ser de terceiros. Para uso comercial, prefira imagens suas ou com permissão. A lista de origens (CSV/MD) sai em “Origens”.')),
    h('h3', {}, 'Formato YOLO (detector: importar/exportar)'),
    h('p', {}, 'ZIP com ', h('code', {}, 'images/'), ' e ', h('code', {}, 'labels/'), '. Cada imagem tem um .txt de mesmo nome, uma linha por caixa: ', h('code', {}, 'classe cx cy largura altura'), ' (0 a 1). Classes em ', h('code', {}, 'classes.txt'), ' ou ', h('code', {}, 'data.yaml'), '. Para o RF-DETR o serviço converte para COCO sozinho.'),
    h('h3', {}, 'Licenças'),
    h('ul', { class: 'mut' },
      h('li', {}, 'RF-DETR: código e pesos nano/small/medium/base sob Apache-2.0 (Roboflow); backbone DINOv2 Apache-2.0. Uso comercial livre, mantendo o aviso de licença.'),
      h('li', {}, 'PatchCore: implementação própria (Apache-2.0) do método de Roth et al. (2022); ResNet-18 do torchvision (BSD-3-Clause), pesos ImageNet.'),
      h('li', {}, 'YOLO26: Ultralytics, AGPL-3.0 — para oferecer a clientes, publique o código-fonte (já em /codigo-fonte/) ou compre a licença Enterprise.'))));
}

// ------------------------------------------------------------------ imagens
async function abaImagens() {
  const p = projAtual(); const T = $('#t-imgs');
  T.replaceChildren(h('div', { class: 'mut' }, 'Carregando…'));
  S.imgs = await api(`/projetos/${S.proj}/imagens`);
  if (p.tipo === 'anomalia') return abaFotosAnomalia(p, T);
  const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => enviar([...e.target.files]) });
  const zip = h('input', { type: 'file', accept: '.zip', hidden: true, onchange: (e) => importar(e.target.files[0]) });
  const cont = p.caixas_por_classe || [];
  const grid = h('div', { class: 'grid' }, ...S.imgs.map((im, i) => cartaoImagem(im, () => abrirRotulador(i),
    h('span', { class: 'bd' + (im.caixas.length || im.rotulada ? '' : ' no') }, im.caixas.length ? im.caixas.length + ' caixa(s)' : im.rotulada ? 'sem objetos' : 'sem rótulo'))));
  T.replaceChildren(
    h('div', { class: 'stats' }, st('imagens', S.imgs.length), st('rotuladas', p.rotuladas),
      ...p.classes.map((c, i) => h('div', { class: 'stat', style: `border-color:${cor(i)}` }, h('b', {}, cont[i] || 0), c))),
    h('div', { class: 'bar' }, h('button', { class: 'btn pri', onclick: () => inp.click() }, '＋ Adicionar imagens'), h('button', { class: 'btn', onclick: () => colarPrint(''), title: 'Cola a imagem da área de transferência (ou use Ctrl/⌘+V)' }, '📋 Colar print'),
      botaoCamera(''),
      h('button', { class: 'btn', onclick: () => { S.tab = 'yt'; render(); } }, '▶ Do YouTube'), h('button', { class: 'btn', onclick: () => zip.click() }, 'Importar ZIP (YOLO)'),
      h('a', { class: 'btn', href: '#', onclick: (e) => { e.preventDefault(); baixar(`/projetos/${S.proj}/exportar`, S.proj + '-dataset.zip'); } }, 'Exportar dataset'),
      botoesOrigens(), h('button', { class: 'btn', onclick: editarClasses }, 'Classes…'), S.imgs.length ? h('button', { class: 'btn', onclick: () => abrirRotulador(Math.max(0, S.imgs.findIndex((i) => !i.rotulada))) }, '✏️ Rotular') : '', inp, zip),
    zonaSoltar((fs) => enviar(fs), inp, null), avisoDireitos(), S.imgs.length ? grid : h('div', { class: 'empty' }, 'Nenhuma imagem ainda. Veja no guia quantas e quais fotos usar.'));
}
function zonaSoltar(fn, inp, texto) {
  const drop = h('div', { class: 'drop' }, texto || 'Arraste fotos para cá ou ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); inp.click(); } }, 'escolha no computador/celular'), '. ',
    h('span', { class: 'small' }, 'Prints: cole com ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'V'), ' / ', h('kbd', {}, '⌘'), '+', h('kbd', {}, 'V'), ' em qualquer lugar da página.'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('on'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('on'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('on'); fn([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); });
  return drop;
}
function cartaoImagem(im, onclick, ...extra) {
  const img = h('img', { alt: im.nome, loading: 'lazy' });
  const o = im.origem; const selo = o && o.fonte === 'print' ? (/^câmera /.test(o.origem || '') ? '📷 câmera' : '📋 print') : o && o.fonte === 'youtube' ? '▶ YouTube' : '';
  const card = h('div', { class: 'im' + (onclick ? '' : ' nc'), onclick, title: o ? textoOrigem(o) : null }, img, ...extra, selo ? h('span', { class: 'fo' }, selo) : '',
    h('button', { class: 'x', title: 'Apagar imagem', onclick: async (e) => { e.stopPropagation(); if (!(await (await modais()).confirmar('Apagar ' + im.nome + '?', { titulo: 'Apagar imagem', ok: 'Apagar imagem', cancelar: 'Manter', perigo: true }))) return; await api(`/projetos/${S.proj}/imagens/${encodeURIComponent(im.nome)}`, { method: 'DELETE' }); await carregarProjetos(); abaImagens(); } }, '×'));
  new IntersectionObserver((en, ob) => { if (en[0].isIntersecting) { ob.disconnect(); imgURL(im.nome).then((u) => { img.src = u; }); } }).observe(card);
  return card;
}
function abaFotosAnomalia(p, T) {
  const g = S.grupo;
  const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => enviar([...e.target.files], g) });
  const zip = h('input', { type: 'file', accept: '.zip', hidden: true, onchange: (e) => importar(e.target.files[0]) });
  const lista = S.imgs.filter((i) => i.grupo === g);
  const outro = g === 'boa' ? 'ruim' : 'boa';
  const grid = h('div', { class: 'grid' }, ...lista.map((im) => cartaoImagem(im, null,
    h('button', { class: 'bd mv', title: g === 'boa' ? 'Mover para Ruins' : 'Mover para Boas', onclick: async (e) => { e.stopPropagation(); await api(`/projetos/${S.proj}/imagens/${encodeURIComponent(im.nome)}/grupo`, { method: 'PUT', body: JSON.stringify({ grupo: outro }) }); await carregarProjetos(); abaImagens(); } }, g === 'boa' ? 'é ruim →' : 'é boa →'))));
  T.replaceChildren(
    h('div', { class: 'stats' }, h('div', { class: 'stat', style: 'border-color:#4ade80' }, h('b', {}, p.boas), 'fotos boas (ensinam o normal)'), h('div', { class: 'stat', style: 'border-color:#f87171' }, h('b', {}, p.ruins), 'fotos ruins (só para calibrar)')),
    h('div', { class: 'seg' }, h('button', { class: g === 'boa' ? 'on' : '', onclick: () => { S.grupo = 'boa'; abaImagens(); } }, `✔ Boas (${p.boas})`), h('button', { class: g === 'ruim' ? 'on bad' : '', onclick: () => { S.grupo = 'ruim'; abaImagens(); } }, `✖ Ruins (${p.ruins})`)),
    h('div', { class: g === 'boa' ? 'dica' : 'aviso' }, g === 'boa'
      ? 'Peças BOAS, todas com o mesmo enquadramento, fundo e luz da câmera de inspeção. Inclua as variações aceitáveis. Mínimo 8; ideal 30 a 200.'
      : 'Peças com DEFEITO (opcional). Não ensinam o modelo: servem para escolher o limiar e medir se ele separa boas de ruins. 5 a 20 já ajudam.'),
    h('div', { class: 'bar' }, h('button', { class: 'btn pri', onclick: () => inp.click() }, g === 'boa' ? '＋ Adicionar fotos BOAS' : '＋ Adicionar fotos RUINS'), h('button', { class: 'btn', onclick: () => colarPrint(g) }, g === 'boa' ? '📋 Colar print (boa)' : '📋 Colar print (ruim)'),
      botaoCamera(g),
      h('button', { class: 'btn', onclick: () => { S.tab = 'yt'; render(); } }, '▶ Do YouTube'), h('button', { class: 'btn', onclick: () => zip.click() }, 'Importar ZIP (pastas boas/ e ruins/)'),
      h('a', { class: 'btn', href: '#', onclick: (e) => { e.preventDefault(); baixar(`/projetos/${S.proj}/exportar`, S.proj + '-fotos.zip'); } }, 'Exportar fotos'), botoesOrigens(), inp, zip),
    zonaSoltar((fs) => enviar(fs, g), inp, g === 'boa' ? 'Arraste fotos de peças BOAS para cá ou ' : 'Arraste fotos de peças RUINS para cá ou '), avisoDireitos(),
    lista.length ? grid : h('div', { class: 'empty' }, g === 'boa' ? 'Nenhuma foto boa ainda.' : 'Nenhuma foto ruim (opcional).'));
}
// ------------------------------------------------------------------ prints, arquivos e origem (v4)
const MAX_LADO = 2048;
const FONTE = { print: 'Print', arquivo: 'Arquivo', youtube: 'YouTube', zip: 'ZIP' };
const dois = (n) => String(n).padStart(2, '0');
const carimbo = (d) => d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
const marcaArquivo = (d) => `${d.getFullYear()}${dois(d.getMonth() + 1)}${dois(d.getDate())}-${dois(d.getHours())}${dois(d.getMinutes())}${dois(d.getSeconds())}`;
async function sha256(blob) {
  try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((b) => b.toString(16).padStart(2, '0')).join(''); } catch (_) { return ''; }
}
/** Reduz no navegador (lado maior ≤ 2048 px, orientação EXIF aplicada) e devolve JPEG 0,9. Transparência vira branco. */
async function reduzirJpeg(blob, maxLado = MAX_LADO) {
  // Safari antigo recusa a opção (só aceitava 'none'/'flipY'): sem ela, o WebKit já aplica o EXIF
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { bmp = await createImageBitmap(blob); }
  const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(bmp, 0, 0, w, hh); bmp.close();
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('não deu para converter'))), 'image/jpeg', 0.9));
}
function textoOrigem(o) {
  return [o.origem || FONTE[o.fonte] || o.fonte, o.titulo ? `“${o.titulo}”` : '', o.autor || '', o.licenca ? 'licença: ' + o.licenca : ''].filter(Boolean).join(' · ');
}
/** «📷 Câmera»: fotos da webcam, do celular ou da câmera Wi-Fi / IP direto para o projeto (treino-camera.js). */
const botaoCamera = (g) => h('button', { class: 'btn', title: 'Tirar fotos com a câmera (integrada, USB, celular, Wi-Fi / IP) direto para o projeto',
  onclick: () => (typeof abrirCameraTreino === 'function' ? abrirCameraTreino(g) : toast('Não carregou o módulo da câmera. Recarregue a página.')) }, '📷 Câmera');
const avisoDireitos = () => h('div', { class: 'aviso small' }, 'Direitos: prints e quadros de vídeo podem ter direito autoral de terceiros (sites, fotógrafos, canais). Para uso comercial, prefira imagens suas ou com permissão. Cada imagem guarda a origem; a lista sai em “Origens”.');
const botoesOrigens = () => h('span', { class: 'seg', style: 'margin:0' },
  h('button', { title: 'Origem, autor e licença de cada imagem (planilha)', onclick: () => baixar(`/projetos/${S.proj}/origens?fmt=csv`, S.proj + '-origens.csv') }, 'Origens CSV'),
  h('button', { title: 'A mesma lista em Markdown (atribuições)', onclick: () => baixar(`/projetos/${S.proj}/origens?fmt=md`, S.proj + '-origens.md') }, 'MD'));
async function hashesDoProjeto() {
  try { S.imgs = await api(`/projetos/${S.proj}/imagens`); } catch (_) { /* fica a lista que já havia */ }
  const hs = new Set();
  for (const i of S.imgs) for (const k of ['sha256', 'sha256_original']) if (i.origem && i.origem[k]) hs.add(i.origem[k]);
  return hs;
}
/**
 * Envia imagens já prontas: itens = [{ blob, nome, meta }]. Lotes de 8 pelo upload de sempre; `meta` (lista na
 * ordem dos arquivos) leva a origem. O servidor também pula repetidas (sha256). Devolve { ok, repetidas, erros }.
 */
async function enviarItens(itens, grupo, pid = S.proj) {
  const R = { ok: 0, repetidas: 0, erros: [] };
  for (let i = 0; i < itens.length; i += 8) {
    const lote = itens.slice(i, i + 8); const fd = new FormData();
    lote.forEach((it) => fd.append('arquivos', it.blob, it.nome));
    fd.append('meta', JSON.stringify(lote.map((it) => it.meta || {})));
    if (itens.length > 8) toast(`Enviando ${Math.min(i + 8, itens.length)} de ${itens.length}…`);
    try { const r = await api(`/projetos/${pid}/imagens` + (grupo ? '?grupo=' + grupo : ''), { method: 'POST', body: fd }); R.ok += r.enviadas.length; R.repetidas += (r.repetidas || []).length; R.erros.push(...r.erros); }
    catch (e) { R.erros.push(e.message); break; }
  }
  return R;
}
/** Arquivos ou prints → reduz, tira repetidas e envia com a origem. fonte: 'arquivo' | 'print'. */
async function enviar(files, grupo, fonte = 'arquivo') {
  files = (files || []).filter((f) => f && /^image\//.test(f.type || ''));
  if (!files.length) { toast('Nenhuma imagem para enviar.'); return; }
  toast(files.length > 1 ? `Preparando ${files.length} imagens…` : 'Preparando a imagem…');
  const vistos = await hashesDoProjeto(); const agora = new Date(); const itens = []; let rep = 0; const erros = [];
  for (const [i, f] of files.entries()) {
    if (f.type === 'image/svg+xml') { erros.push(`${f.name || 'imagem'}: SVG não é aceito (use PNG ou JPEG)`); continue; }
    const sha = await sha256(f);
    if (sha && vistos.has(sha)) { rep++; continue; }
    if (sha) vistos.add(sha);
    try {
      const jpg = await reduzirJpeg(f);
      const nome = fonte === 'print' ? `print-${marcaArquivo(agora)}${files.length > 1 ? '-' + (i + 1) : ''}.jpg` : (f.name || 'imagem').replace(/\.[^.]*$/, '') + '.jpg';
      itens.push({ blob: jpg, nome, meta: { fonte, sha256_original: sha, capturado: agora.toISOString(), arquivo: f.name || '',
        origem: fonte === 'print' ? `print · ${carimbo(agora)}` : `arquivo «${f.name || 'imagem'}» · ${carimbo(agora)}` } });
    } catch (e) { erros.push(`${f.name || 'imagem'}: não abriu como imagem`); }
  }
  const r = itens.length ? await enviarItens(itens, grupo) : { ok: 0, repetidas: 0, erros: [] };
  rep += r.repetidas; erros.push(...r.erros);
  toast(`${r.ok} imagem(ns) adicionada(s)` + (rep ? ` · ${rep} repetida(s) pulada(s)` : '') + (erros.length ? ` · ${erros[0]}` : '') + '.');
  await carregarProjetos(); if (S.tab === 'imgs') abaImagens();
  return r;
}
/** Botão «Colar print»: lê a área de transferência (o navegador pode pedir permissão). */
async function colarPrint(grupo) {
  if (!navigator.clipboard || !navigator.clipboard.read) { toast('Use Ctrl+V (⌘+V no Mac) nesta página para colar o print.'); return; }
  try {
    const fs = [];
    for (const it of await navigator.clipboard.read()) {
      const tp = it.types.find((t) => t.startsWith('image/'));
      if (tp) fs.push(new File([await it.getType(tp)], 'print.' + tp.split('/')[1], { type: tp }));
    }
    if (!fs.length) { toast('Não há imagem na área de transferência. Tire um print (Win+Shift+S ou ⌘+Ctrl+Shift+4) e tente de novo.'); return; }
    await enviar(fs, grupo, 'print');
  } catch (_) { toast('O navegador não deixou ler a área de transferência. Use Ctrl+V (⌘+V no Mac).'); }
}
// Ctrl/⌘+V em qualquer lugar da página (fora do rotulador): imagens da área de transferência viram prints do projeto
document.addEventListener('paste', (e) => {
  if ($('#app').hidden || !S.proj || !$('#rotulador').hidden || document.querySelector('.modal')) return;
  const dt = e.clipboardData; if (!dt) return;
  const fs = [...(dt.files || [])].filter((f) => /^image\//.test(f.type));
  if (!fs.length) return;                                   // texto: deixa colar normalmente
  const alvo = e.target; if (alvo && /^(INPUT|TEXTAREA)$/.test(alvo.tagName) && dt.getData('text/plain')) return;
  e.preventDefault();
  const p = projAtual(); if (S.tab !== 'imgs' && S.tab !== 'yt') { S.tab = 'imgs'; render(); }
  enviar(fs, p && p.tipo === 'anomalia' ? S.grupo : '', 'print');
});
async function importar(f) {
  if (!f) return; const fd = new FormData(); fd.append('arquivo', f); toast('Importando ZIP…');
  try { const r = await api(`/projetos/${S.proj}/importar`, { method: 'POST', body: fd }); toast(r.boas != null ? `Importadas ${r.boas} boas e ${r.ruins} ruins.` : `Importadas ${r.imagens} imagens e ${r.caixas} caixas.`); } catch (e) { toast(e.message); }
  await carregarProjetos(); abaImagens();
}
async function baixar(path, nome) { const r = await api(path); const b = await r.blob(); const a = h('a', { href: URL.createObjectURL(b), download: nome }); document.body.append(a); a.click(); a.remove(); }
async function editarClasses() {
  const p = projAtual(); const v = await (await modais()).perguntar('Classes (separe por vírgula). Você pode renomear ou acrescentar no fim; remover não é permitido para não bagunçar os rótulos.', { titulo: 'Editar classes', padrao: p.classes.join(', '), ok: 'Salvar classes' });
  if (!v) return; try { await api(`/projetos/${S.proj}`, { method: 'PATCH', body: JSON.stringify({ classes: v.split(',').map((s) => s.trim()).filter(Boolean) }) }); await carregarProjetos(); render(); } catch (e) { toast(e.message); }
}

// ------------------------------------------------------------------ rotulador
const R = { i: 0, im: null, caixas: [], sel: -1, cls: 0, drag: null, sujo: false };
async function abrirRotulador(i) {
  R.i = i; $('#rotulador').hidden = false; desenharClasses(); await carregarImagem();
}
function desenharClasses() {
  const p = projAtual();
  $('#rClasses').replaceChildren(...p.classes.map((c, i) => h('button', { class: i === R.cls ? 'on' : '', style: `background:${cor(i)}`, title: 'Tecla ' + (i + 1), onclick: () => { R.cls = i; if (R.sel >= 0) { R.caixas[R.sel][0] = i; R.sujo = true; } desenharClasses(); pintar(); } }, (i < 9 ? (i + 1) + ' · ' : '') + c)));
}
async function carregarImagem() {
  const it = S.imgs[R.i]; $('#rNome').textContent = `${R.i + 1}/${S.imgs.length} · ${it.nome}`;
  const o = it.origem;
  $('#rOrigem').replaceChildren(...(o ? ['Origem: ', textoOrigem(o), o.url ? h('span', {}, ' · ', h('a', { href: o.url, target: '_blank', rel: 'noopener noreferrer' }, 'abrir no YouTube')) : ''] : []));
  R.caixas = it.caixas.map((c) => c.slice()); R.sel = -1; R.sujo = false;
  const im = new Image(); im.src = await imgURL(it.nome); await im.decode(); R.im = im;
  const cv = $('#rCanvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; pintar();
}
function pintar() {
  const cv = $('#rCanvas'), x = cv.getContext('2d'), W = cv.width, H = cv.height, p = projAtual();
  x.drawImage(R.im, 0, 0); const lw = Math.max(2, W / 400);
  R.caixas.forEach(([c, cx, cy, w, hh], i) => {
    const X = (cx - w / 2) * W, Y = (cy - hh / 2) * H; x.lineWidth = i === R.sel ? lw * 2 : lw; x.strokeStyle = cor(c); x.strokeRect(X, Y, w * W, hh * H);
    if (i === R.sel) { x.fillStyle = cor(c) + '33'; x.fillRect(X, Y, w * W, hh * H); }
    const t = p.classes[c] || '#' + c; x.font = `600 ${Math.max(12, W / 70)}px system-ui`; const tw = x.measureText(t).width + 8, th = Math.max(16, W / 55);
    x.fillStyle = cor(c); x.fillRect(X, Math.max(0, Y - th), tw, th); x.fillStyle = '#012'; x.fillText(t, X + 4, Math.max(th - 4, Y - 4));
  });
  if (R.drag && R.drag.novo) { const d = R.drag; x.setLineDash([6, 4]); x.strokeStyle = cor(R.cls); x.lineWidth = lw; x.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); x.setLineDash([]); }
}
function ponto(e) { const cv = $('#rCanvas'), r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * cv.width, y: (e.clientY - r.top) / r.height * cv.height }; }
$('#rCanvas').addEventListener('pointerdown', (e) => {
  const cv = $('#rCanvas'); cv.setPointerCapture(e.pointerId); const p = ponto(e), W = cv.width, H = cv.height;
  const hit = R.caixas.map((c, i) => ({ c, i })).reverse().find(({ c }) => Math.abs(p.x / W - c[1]) <= c[3] / 2 && Math.abs(p.y / H - c[2]) <= c[4] / 2);
  if (hit) { R.sel = hit.i; R.cls = hit.c[0]; R.drag = { mover: true, ox: p.x / W - hit.c[1], oy: p.y / H - hit.c[2] }; desenharClasses(); }
  else { R.sel = -1; R.drag = { novo: true, x0: p.x, y0: p.y, x1: p.x, y1: p.y }; }
  pintar();
});
$('#rCanvas').addEventListener('pointermove', (e) => {
  if (!R.drag) return; const cv = $('#rCanvas'), p = ponto(e);
  if (R.drag.novo) { R.drag.x1 = p.x; R.drag.y1 = p.y; }
  else if (R.drag.mover && R.sel >= 0) { const c = R.caixas[R.sel]; c[1] = Math.min(1 - c[3] / 2, Math.max(c[3] / 2, p.x / cv.width - R.drag.ox)); c[2] = Math.min(1 - c[4] / 2, Math.max(c[4] / 2, p.y / cv.height - R.drag.oy)); R.sujo = true; }
  pintar();
});
$('#rCanvas').addEventListener('pointerup', () => {
  const d = R.drag; R.drag = null; if (!d) return; const cv = $('#rCanvas');
  if (d.novo) { const W = cv.width, H = cv.height; const x0 = Math.max(0, Math.min(d.x0, d.x1)), x1 = Math.min(W, Math.max(d.x0, d.x1)), y0 = Math.max(0, Math.min(d.y0, d.y1)), y1 = Math.min(H, Math.max(d.y0, d.y1));
    if ((x1 - x0) > W * 0.006 && (y1 - y0) > H * 0.006) { R.caixas.push([R.cls, (x0 + x1) / 2 / W, (y0 + y1) / 2 / H, (x1 - x0) / W, (y1 - y0) / H]); R.sel = R.caixas.length - 1; R.sujo = true; } }
  pintar();
});
async function salvarRotulos(forcar) {
  if (!R.sujo && !forcar) return; const it = S.imgs[R.i];
  await api(`/projetos/${S.proj}/imagens/${encodeURIComponent(it.nome)}/rotulos`, { method: 'PUT', body: JSON.stringify({ caixas: R.caixas }) });
  it.caixas = R.caixas.map((c) => c.slice()); it.rotulada = true; R.sujo = false;
}
async function irPara(d) { try { await salvarRotulos(); } catch (e) { toast(e.message); return; } R.i = (R.i + d + S.imgs.length) % S.imgs.length; await carregarImagem(); }
$('#rPrev').onclick = () => irPara(-1); $('#rNext').onclick = () => irPara(1);
$('#rDel').onclick = () => { if (R.sel >= 0) { R.caixas.splice(R.sel, 1); R.sel = -1; R.sujo = true; pintar(); } };
$('#rVazio').onclick = async () => { R.caixas = []; R.sel = -1; await salvarRotulos(true); toast('Marcada como “sem objetos” (exemplo negativo).'); irPara(1); };
async function fecharRotulador() { try { await salvarRotulos(); } catch (e) { toast(e.message); } $('#rotulador').hidden = true; await carregarProjetos(); abaImagens(); }
$('#rFechar').onclick = fecharRotulador;
addEventListener('keydown', (e) => {
  if ($('#rotulador').hidden || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); irPara(1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); irPara(-1); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); $('#rDel').click(); } else if (e.key === 'Escape') fecharRotulador();
  else if (/^[1-9]$/.test(e.key)) { const i = +e.key - 1; if (i < projAtual().classes.length) { R.cls = i; if (R.sel >= 0) { R.caixas[R.sel][0] = i; R.sujo = true; } desenharClasses(); pintar(); } }
});

// ------------------------------------------------------------------ treinar: formulário
const PADRAO = {
  rfdetr: { variante: 'nano', epocas: 20, imgsz: 384, lote: 2, acumular: 4, paciencia: 10, val: 0.2 },
  yolo26: { base: 'yolo26n', epocas: 50, imgsz: 640, lote: 8, paciencia: 20, val: 0.2 },
  patchcore: { imgsz: 256, banco: 10000, margem: 0.1, val: 0.2 },
};
function descCfg(c) {
  if (!c) return '';
  if (c.motor === 'patchcore') return `PatchCore ${c.backbone || 'resnet18'} · ${c.imgsz}px · banco ${c.banco}`;
  if (c.motor === 'rfdetr') return `RF-DETR ${c.variante} · ${c.epocas} épocas · ${c.imgsz}px · lote ${c.lote}×${c.acumular}`;
  return `${c.base || 'yolo26n'} · ${c.epocas} épocas · ${c.imgsz}px · lote ${c.lote}`;
}
function nomeSugerido(p, c) {
  const agora = new Date(); const d = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const m = c.motor === 'patchcore' ? `PatchCore ${c.imgsz}px` : c.motor === 'rfdetr' ? `RF-DETR ${c.variante} · ${c.epocas} épocas` : `YOLO26${String(c.base || 'yolo26n').slice(6)} · ${c.epocas} épocas`;
  return `${p.nome} · ${m} · ${d}`;
}
function formTreino(p) {
  const motorIni = S.form ? S.form.cfg.motor : p.tipo === 'anomalia' ? 'patchcore' : p.motor;
  const cfg = { ...PADRAO[motorIni], ...(S.form ? S.form.cfg : {}), motor: motorIni };
  const est = { nomeEditado: !!(S.form && S.form.nome) };
  const nome = h('input', { type: 'text', maxlength: 100, value: S.form && S.form.nome ? S.form.nome : nomeSugerido(p, cfg), oninput: () => { est.nomeEditado = true; } });
  const nota = h('textarea', { rows: 2, maxlength: 500, placeholder: 'Opcional: o que muda neste treino (ex.: “fotos novas da linha 2”, “testando 512 px”)' }, S.form ? S.form.nota || '' : '');
  const publicar = h('input', { type: 'checkbox', checked: true });
  const campos = h('div', { class: 'form' });
  const aviso = h('div', {});
  const sel = (opts, v) => h('select', {}, ...opts.map(([val, t]) => h('option', { value: val, selected: String(val) === String(v) }, t)));
  const campo = (rot, el, dica) => h('label', {}, h('span', {}, rot), el, dica ? h('span', {}, dica) : '');
  const pcts = (lst) => lst.map((v) => [v, Math.round(v * 100) + '%']);
  let f = {};
  const ler = () => { for (const [k, el] of Object.entries(f)) cfg[k] = isNaN(+el.value) ? el.value : +el.value; };
  const sugerir = () => { if (!est.nomeEditado) nome.value = nomeSugerido(p, cfg); };
  const montar = () => {
    const c = cfg;
    if (c.motor === 'patchcore') {
      f = { imgsz: sel([[224, '224 px'], [256, '256 px (recomendado)'], [320, '320 px — defeitos pequenos']], c.imgsz),
        banco: sel([[4000, '4.000 (~17 MB)'], [7000, '7.000 (~21 MB)'], [10000, '10.000 (~26 MB, recomendado)'], [16000, '16.000 (~35 MB)']], c.banco),
        margem: sel(pcts([0, 0.05, 0.1, 0.2, 0.3]), c.margem), val: sel(pcts([0.1, 0.15, 0.2, 0.3]), c.val) };
      campos.replaceChildren(campo('Tamanho da imagem', f.imgsz, 'maior para defeitos pequenos'), campo('Banco de memória', f.banco, 'mais = mais fiel e arquivo maior'),
        campo('Margem do limiar', f.margem, 'só usada se não houver fotos ruins'), campo('Boas para calibrar', f.val, 'ficam fora do banco'));
    } else if (c.motor === 'rfdetr') {
      const tam = c.variante === 'base' ? [448, 504, 560] : [320, 384, 448, 512, 576];
      if (!tam.includes(+c.imgsz)) c.imgsz = c.variante === 'base' ? 448 : 384;
      f = { variante: sel([['nano', 'nano — leve (recomendado)'], ['small', 'small — mais preciso, ~2× mais lento'], ['medium', 'medium — ~3× mais lento'], ['base', 'base — pesado (múltiplos de 56)']], c.variante),
        epocas: h('input', { type: 'number', min: 1, max: 200, value: c.epocas }), imgsz: sel(tam.map((v) => [v, v + ' px']), c.imgsz),
        lote: h('input', { type: 'number', min: 1, max: 8, value: c.lote }), acumular: h('input', { type: 'number', min: 1, max: 16, value: c.acumular }),
        paciencia: h('input', { type: 'number', min: 0, max: 100, value: c.paciencia }), val: sel(pcts([0.1, 0.15, 0.2, 0.25, 0.3]), c.val) };
      f.variante.addEventListener('change', () => { ler(); montar(); sugerir(); });
      campos.replaceChildren(campo('Variante', f.variante, 'todas Apache-2.0'), campo('Épocas', f.epocas, '8 para testar, 20–30 para valer'), campo('Tamanho da imagem', f.imgsz, '384 é o equilíbrio na CPU'),
        campo('Lote', f.lote, '2 no servidor (6 GB)'), campo('Acumular passos', f.acumular, 'lote efetivo = lote × acumular'), campo('Paciência', f.paciencia, '0 = não para cedo'), campo('Validação', f.val, 'imagens só para medir'));
    } else {
      f = { base: sel([['yolo26n', 'yolo26n — leve (recomendado)'], ['yolo26s', 'yolo26s — mais preciso, mais lento']], c.base),
        epocas: h('input', { type: 'number', min: 1, max: 300, value: c.epocas }), imgsz: sel([416, 512, 640, 800, 960].map((v) => [v, v + ' px']), c.imgsz),
        lote: h('input', { type: 'number', min: 1, max: 32, value: c.lote }), paciencia: h('input', { type: 'number', min: 0, max: 100, value: c.paciencia }),
        val: sel(pcts([0.1, 0.15, 0.2, 0.25, 0.3]), c.val) };
      campos.replaceChildren(campo('Modelo base', f.base, 'n roda melhor no navegador'), campo('Épocas', f.epocas, '20 para testar, 50–100 para valer'), campo('Tamanho da imagem', f.imgsz, 'maior para objetos pequenos'),
        campo('Lote', f.lote, '8 no servidor'), campo('Paciência', f.paciencia, 'para cedo se não melhorar'), campo('Validação', f.val, 'imagens só para medir'));
    }
    for (const el of Object.values(f)) el.addEventListener('change', () => { ler(); sugerir(); });
    aviso.replaceChildren(c.motor === 'yolo26' ? h('div', { class: 'aviso' }, 'YOLO26 é AGPL-3.0: ok para protótipos internos; para oferecer a clientes prefira o RF-DETR (Apache-2.0).') : '');
  };
  const motores = p.tipo === 'anomalia' ? null : h('div', { class: 'seg' }, ...['rfdetr', 'yolo26'].map((m) => h('button', { class: cfg.motor === m ? 'on' : '', onclick: (e) => {
    Object.assign(cfg, PADRAO[m], { motor: m }); motores.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); montar(); sugerir();
  } }, m === 'rfdetr' ? 'RF-DETR · Apache-2.0 (recomendado)' : 'YOLO26 · AGPL-3.0')));
  montar();
  const pronto = p.tipo === 'anomalia' ? p.boas >= 8 : p.rotuladas >= 4;
  const ocupado = !!(S.estado && (S.estado.treinando || (S.estado.fila || []).length)) || S.lista.some((t) => ATIVOS.includes(t.estado));
  const botao = h('button', { class: 'btn pri', disabled: !pronto, onclick: async () => {
    ler(); if (!nome.value.trim()) { toast('Dê um nome ao treino.'); nome.focus(); return; }
    botao.disabled = true;
    try {
      const t = await api(`/projetos/${S.proj}/treinar`, { method: 'POST', body: JSON.stringify({ ...cfg, nome: nome.value.trim(), nota: nota.value, publicar: publicar.checked }) });
      toast(t.na_frente ? `Na fila: posição ${t.posicao} (${t.na_frente} na frente). Começa sozinho.` : 'Treino iniciado.');
      S.form = null; S.formAberto = false; S.aberto = t.id; abaTreinar();
    } catch (e) { toast(e.message); botao.disabled = false; }
  } }, ocupado ? '⏳ Colocar na fila' : '▶ Iniciar treino');
  const det = h('details', { class: 'novoT', open: S.formAberto != null ? S.formAberto : !!S.form || !S.lista.length, ontoggle: () => { S.formAberto = det.open; } },
    h('summary', {}, h('b', {}, S.form && S.form.dup ? `＋ Novo treino (ajustes copiados de “${S.form.dup}”)` : '＋ Novo treino')),
    pronto ? '' : h('div', { class: 'aviso' }, p.tipo === 'anomalia' ? 'Envie pelo menos 8 fotos de peças boas (o ideal é 30 a 200).' : 'Rotule pelo menos 4 imagens para testar (o recomendado é 50+ por classe).'),
    h('div', { class: 'form wide' }, h('label', {}, h('span', {}, 'Nome do treino (aparece no iaVision)'), nome), h('label', {}, h('span', {}, 'Nota (opcional)'), nota)),
    motores || '', aviso, campos,
    h('div', { class: 'bar' }, botao, h('label', { class: 'chk' }, publicar, ' publicar no iaVision quando terminar'),
      ocupado ? h('span', { class: 'mut small' }, 'O servidor já está treinando: este entra na fila e começa sozinho.') : ''));
  return det;
}

// ------------------------------------------------------------------ treinar: lista, detalhe, comparação
async function abaTreinar() {
  const p = projAtual(); const T = $('#t-treinar');
  if (!p) return;
  let L; try { L = await api(`/projetos/${S.proj}/treinos`); } catch (e) { T.replaceChildren(h('div', { class: 'err' }, e.message)); return; }
  S.lista = L; await lerEstado();
  const resumo = p.tipo === 'anomalia' ? `${p.boas} fotos boas e ${p.ruins} ruins` : `${p.rotuladas} de ${p.imagens} imagens rotuladas · ${p.classes.length} classes`;
  const cmp = L.filter((t) => S.comparar.has(t.id));
  const aberto = L.find((x) => x.id === S.aberto);
  T.replaceChildren(
    h('p', { class: 'mut' }, `${resumo}. Dúvidas sobre os ajustes? Veja o guia.`),
    formTreino(p),
    h('div', { class: 'bar between' }, h('h3', {}, `Treinos deste projeto (${L.length})`),
      h('button', { class: 'btn', disabled: cmp.length < 2, title: 'Marque 2 ou mais treinos na lista', onclick: () => { S.aberto = 'comparar'; abaTreinar(); } }, `⚖ Comparar (${cmp.length})`)),
    L.length ? tabelaTreinos(L) : h('div', { class: 'empty' }, 'Nenhum treino ainda. Preencha o formulário acima.'),
    S.aberto === 'comparar' && cmp.length >= 2 ? comparacao(cmp) : '',
    aberto ? detalhe(aberto) : '');
  clearInterval(S.poll);
  if (L.some((t) => ATIVOS.includes(t.estado))) {
    S.poll = setInterval(() => {
      const foco = document.activeElement;
      if (S.tab === 'treinar' && !document.querySelector('.modal') && !(foco && foco.closest && foco.closest('.novoT'))) abaTreinar();
    }, 5000);
  }
}
function progresso(t) {
  if (t.estado === 'pronto') return 1;
  if (t.cfg.motor === 'patchcore') return t.progresso || 0;
  const tot = t.total || 1, ep = t.epoca || 0;
  const dentro = t.passos && t.epoca_atual > ep ? (t.passo || 0) / t.passos : 0;
  return Math.min(1, (ep + dentro) / tot);
}
const metr = (t) => t.melhor || t.metricas || {};
const metricaPrincipal = (t) => { const m = metr(t); return t.cfg.motor === 'patchcore' ? (m.auroc != null ? 'AUROC ' + pct(m.auroc) : m.acuracia != null ? 'acerto ' + pct(m.acuracia) : '—') : (m.map50 != null ? 'mAP50 ' + pct(m.map50) : '—'); };
function tempo(t) {
  if (t.duracao_s) return t.duracao_s;
  if (ATIVOS.includes(t.estado) && t.estado !== 'fila' && t.inicio) return Date.now() / 1000 - t.inicio;
  return t.fim && (t.inicio_real || t.inicio) ? t.fim - (t.inicio_real || t.inicio) : null;
}
function tabelaTreinos(L) {
  return h('div', { class: 'tlist' }, ...L.map((t) => {
    const ativo = ATIVOS.includes(t.estado); const mo = MOTOR[t.cfg.motor] || MOTOR.yolo26;
    const chk = h('input', { type: 'checkbox', title: 'Marcar para comparar', checked: S.comparar.has(t.id), onclick: (e) => e.stopPropagation(), onchange: (e) => { if (e.target.checked) S.comparar.add(t.id); else S.comparar.delete(t.id); abaTreinar(); } });
    return h('div', { class: 'tr' + (S.aberto === t.id ? ' on' : ''), onclick: () => { S.aberto = S.aberto === t.id ? null : t.id; abaTreinar(); } },
      chk,
      h('div', { class: 'tn' }, h('b', {}, t.nome), t.nome_gerado ? h('span', { class: 'mut small' }, ' (nome automático)') : '',
        h('div', { class: 'mut small' }, h('span', { class: 'tag ' + (mo.livre ? 'ok' : 'agpl') }, `${mo.nome} · ${mo.lic}`), ' ', descCfg(t.cfg))),
      h('div', { class: 'te' }, ESTADO[t.estado] || t.estado, t.estado === 'fila' && t.posicao ? h('div', { class: 'small mut' }, `posição ${t.posicao} · ${t.na_frente} na frente`) : '',
        ativo && t.estado !== 'fila' ? h('div', { class: 'prog sm' }, h('i', { style: `width:${Math.round(progresso(t) * 100)}%` })) : ''),
      h('div', { class: 'tm small' }, (t.criado || t.inicio) ? dataHora(t.criado || t.inicio) : t.id, h('div', { class: 'mut' }, duracao(tempo(t)))),
      h('div', { class: 'tk' }, metricaPrincipal(t), t.publicado ? h('div', {}, h('span', { class: 'tag ok' }, 'publicado')) : ''));
  }));
}
const st = (rot, v) => h('div', { class: 'stat' }, h('b', {}, v), rot);
function detalhe(t) {
  const m = metr(t); const ativo = ATIVOS.includes(t.estado); const pc = t.cfg.motor === 'patchcore';
  const res = t.resultado || {};
  const vo = res.validacao_onnx;
  const el = h('div', { class: 'mod det' },
    h('div', { class: 'bar between' }, h('h3', {}, t.nome), h('button', { class: 'btn ghost sm', onclick: () => { S.aberto = null; abaTreinar(); } }, 'Fechar ✕')),
    t.nota ? h('p', { class: 'mut' }, t.nota) : '',
    h('div', { class: 'mut small' }, `${ESTADO[t.estado] || t.estado} · ${descCfg(t.cfg)}`, t.imagens_treino ? ` · ${t.imagens_treino} ${pc ? 'boas no banco' : 'de treino'} / ${t.imagens_val} ${pc ? 'para calibrar' : 'de validação'}` : '', ` · licença: ${t.licenca || ''}`, t.publicado ? ` · identificador: ${t.modelo}` : ''),
    ativo && t.estado !== 'fila' ? h('div', { class: 'prog' }, h('i', { style: `width:${Math.round(progresso(t) * 100)}%` })) : '',
    t.estado === 'fila' ? h('div', { class: 'aviso' }, `Na fila: posição ${t.posicao || '?'}, ${t.na_frente || 0} treino(s) na frente. Começa sozinho.`) : '',
    ativo && pc && t.etapa ? h('div', { class: 'small mut' }, t.etapa) : '',
    ativo && t.passos && !pc ? h('div', { class: 'small mut' }, `Época ${t.epoca_atual || 1} de ${t.total}: lote ${t.passo || 0}/${t.passos}`) : '',
    pc ? h('div', { class: 'stats' }, st('AUROC', pct(m.auroc)), st('acerto boas', pct(m.acerto_boas)), st('acerto ruins', pct(m.acerto_ruins)), st('limiar', num(res.limiar)), st('banco', m.banco || '—'))
      : h('div', { class: 'stats' }, st('épocas', `${t.epoca || 0}/${t.total || '?'}`), st('mAP50', pct(m.map50)), st('mAP50-95', pct(m.map50_95)), st('precisão', pct(m.precisao)), st('recall', pct(m.recall))),
    vo && !pc && vo.precisao != null ? h('div', { class: 'small mut' }, `Validação do ONNX publicado (${res.precisao_pesos || 'fp32'}): com confiança ≥ ${vo.conf} (a sugerida para o operador) precisão ${pct(vo.precisao)} · recall ${pct(vo.recall)} · ${vo.ms_por_imagem} ms/imagem no servidor`) : '',
    vo && pc ? h('div', { class: 'small mut' }, `ONNX conferido com o PyTorch: diferença máx. ${vo.dif_relativa_max} · ${vo.ms_por_imagem} ms/imagem no servidor`) : '',
    t.erro ? h('div', { class: 'err' }, t.erro) : '');
  if (pc && res.notas) {
    const c = h('canvas', { class: 'chart', width: 900, height: 200 });
    el.append(h('h4', {}, 'Notas das fotos de validação'), c, h('div', { class: 'small mut' }, 'Verde = boas, vermelho = ruins; a linha amarela é o limiar. Acima dele = REPROVADO.'));
    setTimeout(() => graficoNotas(c, res.notas, res.limiar), 0);
    const erradas = [...res.notas.boas.filter((b) => b[1] >= res.limiar).map((b) => b[0] + ' (boa acima do limiar)'), ...res.notas.ruins.filter((b) => b[1] < res.limiar).map((b) => b[0] + ' (ruim abaixo do limiar)')];
    el.append(erradas.length ? h('div', { class: 'aviso' }, 'Fotos do lado errado do limiar: ', erradas.join(', ')) : h('div', { class: 'dica' }, 'Todas as fotos de validação ficaram do lado certo do limiar.'));
  }
  if (!pc && (t.historico || []).length > 1) { const c = h('canvas', { class: 'chart', width: 900, height: 200 }); el.append(c); setTimeout(() => grafico(c, [{ h: t.historico, cor: null }]), 0); }
  const bar = h('div', { class: 'bar' });
  bar.append(h('button', { class: 'btn', onclick: () => renomear(t) }, '✏️ Renomear / nota'),
    h('button', { class: 'btn', onclick: () => { S.form = { cfg: { ...t.cfg }, nome: t.nome + ' (cópia)', nota: t.nota, dup: t.nome }; S.formAberto = true; S.aberto = null; abaTreinar().then(() => { const d = $('.novoT'); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth' }); } }); } }, '⧉ Duplicar ajustes'));
  if (ativo) bar.append(h('button', { class: 'btn danger', onclick: async () => { if (!(await (await modais()).confirmar(t.estado === 'fila' ? 'Tirar este treino da fila?' : 'Cancelar este treino?', { titulo: t.estado === 'fila' ? 'Tirar da fila' : 'Cancelar treino', ok: t.estado === 'fila' ? 'Tirar da fila' : 'Cancelar treino', cancelar: 'Continuar', perigo: true }))) return; try { await api(`/projetos/${S.proj}/treinos/${t.id}/cancelar`, { method: 'POST' }); toast('Cancelando…'); setTimeout(abaTreinar, 1500); } catch (e) { toast(e.message); } } }, t.estado === 'fila' ? '⏹ Tirar da fila' : '⏹ Cancelar'));
  if (t.tem_modelo) {
    bar.append(t.publicado
      ? h('button', { class: 'btn', onclick: async () => { if (!(await (await modais()).confirmar('Despublicar? O modelo some do iaVision (o treino continua aqui).', { titulo: 'Despublicar', ok: 'Despublicar', cancelar: 'Manter publicado', perigo: true }))) return; await api(`/projetos/${S.proj}/treinos/${t.id}/despublicar`, { method: 'POST' }); toast('Despublicado.'); abaTreinar(); } }, '⊘ Despublicar')
      : h('button', { class: 'btn pri', onclick: async () => { try { await api(`/projetos/${S.proj}/treinos/${t.id}/publicar`, { method: 'POST' }); toast('Publicado no iaVision.'); abaTreinar(); } catch (e) { toast(e.message); } } }, '⬆ Publicar no iaVision'),
    h('button', { class: 'btn', onclick: () => baixar(`/projetos/${S.proj}/treinos/${t.id}/modelo?fmt=onnx`, `${t.modelo}.onnx`) }, '⬇ ONNX'));
    if (!pc) bar.append(h('button', { class: 'btn', onclick: () => baixar(`/projetos/${S.proj}/treinos/${t.id}/modelo?fmt=pt`, `${t.modelo}${t.cfg.motor === 'rfdetr' ? '.pth' : '.pt'}`) }, '⬇ PyTorch'));
    if (t.publicado) bar.append(h('a', { class: 'btn', href: '/' }, 'Usar no iaVision →'));
  }
  if (!ativo) bar.append(h('button', { class: 'btn danger', onclick: () => apagarTreino(t) }, '🗑 Apagar'));
  el.append(bar);
  if (t.log && (ativo || t.estado === 'erro')) el.append(h('details', { open: t.estado === 'erro' }, h('summary', { class: 'mut small' }, 'Registro do treino'), h('div', { class: 'log' }, t.log.join('\n'))));
  return el;
}
async function renomear(t) {
  const nome = h('input', { type: 'text', maxlength: 100, value: t.nome }); const nota = h('textarea', { rows: 3, maxlength: 500 }, t.nota || '');
  const r = await dialogo('Renomear treino', h('div', { class: 'novo' }, h('label', {}, h('span', {}, 'Nome (é o que aparece no iaVision)'), nome), h('label', {}, h('span', {}, 'Nota'), nota)),
    [{ t: 'Cancelar', cls: 'ghost', v: null }, { t: 'Salvar', cls: 'pri', valor: () => (nome.value.trim() ? { nome: nome.value.trim(), nota: nota.value } : (toast('O nome não pode ficar vazio.'), false)) }]);
  if (!r) return;
  try { await api(`/projetos/${S.proj}/treinos/${t.id}`, { method: 'PATCH', body: JSON.stringify(r) }); toast('Salvo.'); abaTreinar(); } catch (e) { toast(e.message); }
}
async function apagarTreino(t) {
  let desp = false;
  if (t.publicado) {
    const r = await dialogo('Apagar treino publicado', h('p', {}, `“${t.nome}” está publicado no iaVision. Quer despublicar o modelo também?`),
      [{ t: 'Cancelar', cls: 'ghost', v: null }, { t: 'Apagar e manter publicado', v: 'manter' }, { t: 'Apagar e despublicar', cls: 'danger', v: 'desp' }]);
    if (!r) return; desp = r === 'desp';
  } else if (!(await (await modais()).confirmar(`Apagar o treino “${t.nome}”? Não dá para desfazer.`, { titulo: 'Apagar treino', ok: 'Apagar treino', cancelar: 'Manter', perigo: true }))) return;
  try { await api(`/projetos/${S.proj}/treinos/${t.id}?despublicar=${desp}`, { method: 'DELETE' }); S.comparar.delete(t.id); if (S.aberto === t.id) S.aberto = null; toast('Treino apagado.'); abaTreinar(); } catch (e) { toast(e.message); }
}
function comparacao(L) {
  const pc = L.every((t) => t.cfg.motor === 'patchcore');
  const mb = (t) => (t.bytes ? (t.bytes / 1048576).toFixed(1) + ' MB' : '—');
  const linhas = pc
    ? [['Ajustes', (t) => descCfg(t.cfg)], ['AUROC', (t) => pct(metr(t).auroc)], ['Acerto boas', (t) => pct(metr(t).acerto_boas)], ['Acerto ruins', (t) => pct(metr(t).acerto_ruins)], ['Limiar', (t) => num((t.resultado || {}).limiar)], ['Banco', (t) => metr(t).banco || '—'], ['Tamanho', mb], ['Duração', (t) => duracao(tempo(t))]]
    : [['Ajustes', (t) => descCfg(t.cfg)], ['Licença', (t) => (MOTOR[t.cfg.motor] || MOTOR.yolo26).lic], ['mAP50', (t) => pct(metr(t).map50)], ['mAP50-95', (t) => pct(metr(t).map50_95)], ['Precisão', (t) => pct(metr(t).precisao)], ['Recall', (t) => pct(metr(t).recall)],
      ['ONNX: precisão / recall', (t) => { const v = (t.resultado || {}).validacao_onnx; return v && v.precisao != null ? `${pct(v.precisao)} / ${pct(v.recall)}` : '—'; }], ['Épocas', (t) => `${t.epoca || 0}/${t.total || '?'}`], ['Tamanho', mb], ['Duração', (t) => duracao(tempo(t))]];
  const el = h('div', { class: 'mod det' }, h('div', { class: 'bar between' }, h('h3', {}, 'Comparação'), h('button', { class: 'btn ghost sm', onclick: () => { S.aberto = null; abaTreinar(); } }, 'Fechar ✕')),
    h('div', { class: 'scroll' }, h('table', { class: 't cmp' }, h('tr', {}, h('th', {}, ''), ...L.map((t, i) => h('th', {}, h('span', { class: 'dot', style: `background:${cor(i)}` }), t.nome))),
      ...linhas.map(([r, f]) => h('tr', {}, h('td', { class: 'mut' }, r), ...L.map((t) => h('td', {}, f(t))))))));
  if (!pc) { const c = h('canvas', { class: 'chart', width: 900, height: 220 }); el.append(h('h4', {}, 'mAP50 por época'), c); setTimeout(() => grafico(c, L.map((t, i) => ({ h: t.historico || [], cor: cor(i), nome: t.nome }))), 0); }
  return el;
}
function grafico(c, series) {
  const x = c.getContext('2d'), W = c.width, Hh = c.height, pad = 30; x.clearRect(0, 0, W, Hh); x.strokeStyle = 'rgba(255,255,255,.12)'; x.fillStyle = 'rgba(255,255,255,.55)'; x.font = '11px system-ui';
  for (let v = 0; v <= 1; v += 0.25) { const y = Hh - pad - v * (Hh - 2 * pad); x.beginPath(); x.moveTo(pad, y); x.lineTo(W - 10, y); x.stroke(); x.fillText((v * 100) + '%', 2, y + 4); }
  const maxE = Math.max(2, ...series.map((s) => (s.h.length ? s.h[s.h.length - 1].epoca : 0)));
  const serie = (H, k, col) => { x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); H.forEach((e, i) => { const X = pad + (e.epoca - 1) / Math.max(1, maxE - 1) * (W - pad - 10), Y = Hh - pad - (e[k] || 0) * (Hh - 2 * pad); if (i) x.lineTo(X, Y); else x.moveTo(X, Y); }); x.stroke(); };
  if (series.length === 1 && !series[0].cor) {
    const H = series[0].h; serie(H, 'map50', '#FFD84D'); serie(H, 'map50_95', '#8CE0C8'); serie(H, 'recall', '#a78bfa');
    x.fillStyle = '#FFD84D'; x.fillText('mAP50', W - 190, 16); x.fillStyle = '#8CE0C8'; x.fillText('mAP50-95', W - 140, 16); x.fillStyle = '#a78bfa'; x.fillText('recall', W - 70, 16);
  } else series.forEach((s, i) => { serie(s.h, 'map50', s.cor); x.fillStyle = s.cor; x.fillText(String(s.nome).slice(0, 48), W - 300, 16 + i * 14); });
  x.fillStyle = 'rgba(255,255,255,.55)'; x.fillText('época →', W - 60, Hh - 8);
}
function graficoNotas(c, notas, lim) {
  const x = c.getContext('2d'), W = c.width, Hh = c.height, pad = 40;
  const todas = [...notas.boas, ...notas.ruins].map((n) => n[1]).concat([lim]);
  const lo = Math.min(...todas) * 0.95, hi = Math.max(...todas) * 1.05; const X = (v) => pad + (v - lo) / (hi - lo) * (W - 2 * pad);
  x.clearRect(0, 0, W, Hh); x.font = '12px system-ui';
  const faixa = (lst, y, col, rot) => { x.fillStyle = 'rgba(255,255,255,.6)'; x.fillText(rot, 4, y - 16); lst.forEach(([, v], i) => { x.fillStyle = col; x.beginPath(); x.arc(X(v), y + ((i % 3) - 1) * 7, 5, 0, 7); x.fill(); }); };
  x.strokeStyle = 'rgba(255,255,255,.12)'; x.beginPath(); x.moveTo(pad, Hh - 24); x.lineTo(W - pad, Hh - 24); x.stroke();
  faixa(notas.boas, 62, '#4ade80', `boas (${notas.boas.length})`); faixa(notas.ruins, 134, '#f87171', `ruins (${notas.ruins.length})`);
  x.strokeStyle = '#FFD84D'; x.lineWidth = 2; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(X(lim), 22); x.lineTo(X(lim), Hh - 24); x.stroke(); x.setLineDash([]);
  x.fillStyle = '#FFD84D'; x.fillText('limiar ' + lim.toFixed(2), X(lim) + 6, 16);
  x.fillStyle = 'rgba(255,255,255,.55)'; x.fillText(lo.toFixed(2), pad, Hh - 8); x.fillText(hi.toFixed(2), W - pad - 30, Hh - 8); x.fillText('nota de anomalia →', W / 2 - 50, Hh - 8);
}

// ------------------------------------------------------------------ modelos
async function abaModelos() {
  const T = $('#t-modelos'); let L = [];
  try { L = await (await fetch('/models/custom/index.json', { cache: 'no-store' })).json(); } catch (_) {}
  const meus = L.filter((m) => m.projeto === S.proj).sort((a, b) => b.criado - a.criado);
  const onde = (m) => (m.arquitetura === 'rfdetr' ? 'CV-24 › “Detector treinado (RF-DETR, livre)”' : m.arquitetura === 'patchcore' ? 'CV-24 › “Inspeção de anomalia (PatchCore)”' : 'CV-16 › “Modelo treinado (GPlanSiS)”');
  T.replaceChildren(
    h('p', { class: 'mut' }, 'Modelos publicados deste projeto. No iaVision, em Módulos, use o operador indicado em cada um. Campo “Modelo” vazio = o mais recente daquele tipo; para escolher, cole o identificador.'),
    ...meus.map((m) => {
      const arq = m.arquitetura || 'yolo26'; const mo = MOTOR[arq] || MOTOR.yolo26; const mt = m.metricas || {};
      return h('div', { class: 'mod' }, h('b', {}, m.nome), ' ', h('span', { class: 'tag ' + (mo.livre ? 'ok' : 'agpl') }, mo.nome),
        h('div', { class: 'small' }, 'Licença: ', h('b', {}, m.licenca || mo.lic)),
        h('div', { class: 'mut small' }, 'identificador: ', h('code', {}, m.id), ` · ${(m.bytes / 1048576).toFixed(1)} MB · ${m.imgsz}px`, arq === 'patchcore' ? ` · limiar ${num(m.limiar)}` : ` · classes: ${m.classes.join(', ')}`, m.precisao_pesos ? ` · pesos ${m.precisao_pesos}` : ''),
        h('div', { class: 'mut small' }, 'No iaVision: ', onde(m)),
        arq === 'patchcore'
          ? h('div', { class: 'stats' }, st('AUROC', pct(mt.auroc)), st('acerto boas', pct(mt.acerto_boas)), st('acerto ruins', pct(mt.acerto_ruins)))
          : h('div', { class: 'stats' }, st('mAP50', pct(mt.map50)), st('mAP50-95', pct(mt.map50_95)), m.validacao_onnx ? st('recall no ONNX', pct(m.validacao_onnx.recall)) : ''),
        h('div', { class: 'bar' }, h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(m.id).then(() => toast('Identificador copiado.'), () => toast('O navegador não deixou copiar: ' + m.id)); } }, 'Copiar identificador'), h('a', { class: 'btn', href: '/' + m.arquivo, download: m.id + '.onnx' }, '⬇ ONNX'),
          h('button', { class: 'btn danger', onclick: async () => { if (!(await (await modais()).confirmar('Despublicar ' + m.nome + '? Ele some do iaVision (o treino continua guardado).', { titulo: 'Despublicar', ok: 'Despublicar', cancelar: 'Manter publicado', perigo: true }))) return; await api('/modelos/' + m.id, { method: 'DELETE' }); abaModelos(); } }, 'Despublicar')));
    }),
    meus.length ? '' : h('div', { class: 'empty' }, 'Nenhum modelo publicado ainda. Treine na aba Treinar.'));
}

// ------------------------------------------------------------------ tema (o mesmo do iaVision: localStorage «gplansis.theme»)
// três temas: Escuro (iaVision) → Claro → Code Dark → Escuro… O botão mostra o tema ATUAL e diz qual vem a seguir.
const TEMAS = { dark: { ic: '☾', nome: 'Escuro (iaVision)' }, light: { ic: '☀', nome: 'Claro' }, code: { ic: '{ }', nome: 'Code Dark' } };
const ORDEM = ['dark', 'light', 'code'];
const temaValido = (t) => (TEMAS[t] ? t : 'dark');
function aplicarTema(t) {
  t = temaValido(t);
  document.documentElement.setAttribute('data-theme', t); document.documentElement.style.colorScheme = t === 'light' ? 'light' : 'dark';
  const prox = ORDEM[(ORDEM.indexOf(t) + 1) % ORDEM.length];
  $('#tema').textContent = TEMAS[t].ic;
  $('#tema').title = `Tema: ${TEMAS[t].nome} — clique para ${TEMAS[prox].nome}`;
  $('#tema').setAttribute('aria-label', `Tema ${TEMAS[t].nome}; mudar para ${TEMAS[prox].nome}`);
}
$('#tema').onclick = () => {
  const atual = temaValido(document.documentElement.getAttribute('data-theme'));
  const t = ORDEM[(ORDEM.indexOf(atual) + 1) % ORDEM.length];
  try { localStorage.setItem('gplansis.theme', t); } catch (_) { /* só nesta tela */ }
  aplicarTema(t);
};
addEventListener('storage', (e) => { if (e.key === 'gplansis.theme' && e.newValue) aplicarTema(e.newValue); });
aplicarTema(document.documentElement.getAttribute('data-theme'));

if (S.token) iniciar(); else entrarPorConta(false);
guia();
