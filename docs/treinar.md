# Treinar modelos (`/treino/`)

Módulo para criar detectores e inspetores de anomalia com as suas imagens. O treino roda no servidor (contêiner `aivision-treino`); o modelo pronto é publicado em `site/models/custom/` e aparece no iaVision como operador. Acesso por senha (`AIV_TREINO_SENHA`).

## Três caminhos

| Tipo | Motor | Quando usar | Licença |
|---|---|---|---|
| **Detector livre** (recomendado) | RF-DETR (nano/small/medium/base) | Achar e contar objetos seus (peças, EPIs, defeitos, produtos) | Apache-2.0 |
| Detector YOLO26 | Ultralytics YOLO26 | Compatibilidade / modelo menor | AGPL-3.0 |
| **Anomalia** | PatchCore (implementação própria, ResNet-18) | Inspeção de qualidade com enquadramento fixo, aprendendo **só com peças boas** | Apache-2.0 / BSD |

## Passo a passo

1. **Novo projeto**: nome, tipo e (detector) as classes.
2. **Imagens**: «＋ Adicionar imagens», arrastar arquivos, **colar prints** (`Ctrl/⌘+V` em qualquer lugar da página ou «📋 Colar print»), um ZIP no formato YOLO, a aba **▶ Do YouTube** (quadros de vídeo) ou os quadros mandados pela Fonte YouTube do app. Anomalia: abas *Boas* e, opcionalmente, *Ruins* (para calibrar e validar).
3. **Rotular** (detector): desenhe caixas; `1–9` escolhe a classe, `Delete` apaga, `←/→` troca de imagem (salva sozinho), "Sem objetos" marca exemplo negativo.
4. **Treinar**: escolha motor, tamanho, épocas, imagem; dê um **nome** ao treino (sugestão automática "projeto · motor · épocas · data") e uma nota. Treinos entram numa **fila** e rodam um por vez; a posição aparece na lista.
5. **Acompanhar**: gráfico de mAP por época / separação das notas, log, cancelar.
6. **Comparar**: escolha 2+ treinos do projeto — tabela de métricas e mAP sobreposto.
7. **Publicar / despublicar**: o modelo entra (ou sai) do iaVision com o nome do treino. Renomear um treino publicado atualiza o nome no app.
8. **No iaVision**: Pipeline › Modelos livres › *Detector treinado livre* ou *Inspeção de anomalia* (CV-24), ou *Treinado (YOLO26)* (CV-16, AGPL).

## Prints e quadros do YouTube (v4 da página, serviço 2.2.0)

**Nada é baixado da internet pelo servidor** (nem URLs, nem vídeos): toda imagem sai do navegador.

- **Prints e arquivos**: o navegador aplica a orientação EXIF, reduz para no máximo **2048 px** no lado maior, converte para **JPEG 0,9** (transparência vira branco; SVG é recusado) e calcula o **sha256 do arquivo original**. Repetidas (já no projeto ou no mesmo lote) são puladas no navegador e, de novo, no servidor. A origem fica registrada: `print · dd/mm/aaaa hh:mm:ss` (licença “desconhecida”) ou `arquivo «nome» · …`. O serviço continua guardando no máximo 1280 px (regra antiga do `_gravar_imagem`).
- **▶ Do YouTube** (`treino/treino-youtube.js`): cole o link ou busque (`/api/yt/busca`, miniaturas por `/api/yt/miniatura/{id}`, título/canal por `/api/yt/info` = oEmbed). O vídeo toca no **player oficial** (IFrame API, youtube-nocookie, iframe `credentialless`); «Compartilhar esta aba» chama `getDisplayMedia` com `preferCurrentTab` e recorta a trilha no elemento do player (**Element Capture**; Region Capture como reserva) — o mesmo núcleo do app, `js/camera/youtube-nucleo.js`. «📸 Capturar quadro» ou «⏱ Capturar no trecho» (a cada N s **de vídeo**, até M quadros, entre início e fim; começa ~5,5 s antes porque o YouTube desenha título/botões por ~5 s depois de pular). Quadros com a interface do YouTube (pausado, carregando, logo após pular) são recusados, e também quadros com o player cortado (fora da tela). Cada quadro vai **direto** para o projeto com a origem `YouTube <id> @ mm:ss`, título, canal e o link `watch?v=<id>&t=<s>s` (montado no servidor). Sair da aba solta a captura e pausa o vídeo. No **Safari e no Firefox** (sem iframe `credentialless`) o vídeo toca na janela «Player do YouTube — iaVision» (`/yt/player.html`, comandada por BroadcastChannel), o botão vira «Compartilhar a janela do player» e o recorte é automático (barra de título e faixas pretas), com «Ajustar recorte» à mão — ver [fontes.md](fontes.md#youtube-no-safari-e-no-firefox). Celular não captura.
- **📷 Câmera** (`treino/treino-camera.js`, v6 da página): botão na barra de imagens (detector e anomalia). Abre um painel de tela cheia com o **vídeo ao vivo grande** e, ao lado, a lista de câmeras agrupada por tipo (mesma lógica do painel Fonte: `js/camera/seletor.js`, por import dinâmico), «Permitir câmera», «Atualizar lista», atualização em `devicechange`, aviso de câmera em uso e a última câmera lembrada (abre direto nela). No celular: botões **Traseira / Frontal** (`facingMode`) e só as câmeras do aparelho. Resolução pedida (padrão 1920×1080) e **Espelhar** (a foto sai como a tela mostra; a frontal começa espelhada). **📸 Capturar foto** (tecla **espaço**) e **⏱ Capturar a cada N s (até M)**, com contagem. Na anomalia, **✔ BOA / ✖ RUIM** antes de capturar. Cada foto: quadro do vídeo → canvas reduzido a **≤ 2048 px**, **JPEG 0,9** (mesma regra dos prints), **sha256** contra as imagens do projeto (repetidas puladas), upload pelo mesmo `POST …/imagens` em fila, com `meta = { fonte: 'print', origem: 'câmera <rótulo> · dd/mm/aaaa hh:mm:ss', licenca: 'própria — foto tirada pela câmera de quem enviou', capturado, arquivo, sha256_original }` — o serviço 2.2 só aceita `print|arquivo|youtube` e não foi alterado. Os cartões mostram o selo «📷 câmera». **Câmera Wi-Fi / IP** no mesmo painel: gera o trecho do `mediamtx.yml` (usuário/senha não saem do navegador nem são guardados) e conecta pelo WHEP com o `StreamSource` do app (`js/camera/stream.js`). **Bluetooth**: explicação (sem vídeo por BT no navegador). Esc fecha e solta a câmera; a grade de imagens é redesenhada ao fechar.
- **Origem no rotulador**: a linha abaixo da barra mostra origem, título, autor/canal e licença (com link para o trecho no YouTube); os cartões têm o selo «📋 print» / «📷 câmera» / «▶ YouTube».
- **Atribuições**: «Origens CSV / MD» (aba Imagens) e `ORIGENS.csv` dentro do «Exportar dataset».
- **Direitos**: a interface avisa que prints e quadros de vídeo podem ter direito autoral de terceiros; para uso comercial, prefira imagens próprias ou com permissão.
- **Próximo passo (não feito)**: «pré-rotular com o detector» — o rotulador já aceita caixas pré-preenchidas (`caixas` no formato YOLO normalizado, gravadas por `PUT …/rotulos`), mas a página do Treinar não carrega o ONNX Runtime nem os detectores do app; falta mapear as classes do detector (COCO) para as do projeto e marcar as caixas como “a revisar”.

## Tema

A página segue o tema do iaVision (`localStorage['gplansis.theme']`, aplicado antes de pintar), com botão ☀/☾ no topo; trocar numa aba reflete na outra (evento `storage`). Os gráficos (canvas) ficam sobre fundo escuro nos dois temas.

## Dicas

- Detector: 30+ imagens por classe para testar, 100–300 para valer; varie fundo, luz, ângulo e distância; inclua imagens sem o objeto.
- Anomalia: 50+ fotos boas, sempre com o mesmo enquadramento e luz; algumas ruins ajudam a calibrar o limiar. Mudou câmera, luz ou enquadramento → treine de novo.
- CPU do servidor: RF-DETR nano leva ~1 min por época com ~30 imagens; PatchCore treina em segundos.

## Formato publicado (`models/custom/index.json`)

Campos comuns: `id, nome, projeto, treino, arquivo, bytes, imgsz, classes, metricas, licenca, criado, base`. Sem `arquitetura` = YOLO26 (saída `[1,300,6]`). `arquitetura: 'rfdetr'` acrescenta `entrada`, `saida` (`dets` cxcywh normalizado + `labels` logits, fundo na última fatia), `conf_sugerida`. `arquitetura: 'patchcore'` acrescenta `limiar`, `entrada`, `saida` (`mapa`, `nota`) e métricas (AUROC, acerto de boas/ruins).

## Acesso

Ao abrir `/treino/`, a página tenta primeiro **entrar pela conta do iaVision** (`POST /api/treino/sessao`, com o cookie da sessão): se o servidor reconhecer o e-mail como administrador (`AIV_TREINO_ADMINS`), entra direto e mostra «Entrou como <e-mail> · admin». Senão, aparece o formulário de senha como antes, com o botão «Entrar com a minha conta (admin)» para tentar de novo. A decisão é só do servidor; o token é o mesmo HMAC de 12 h da senha e fica no `sessionStorage` (`aivTreino`), compartilhado com a Via (anexos → Treinar) e com a fonte YouTube («Enviar ao Treinar»), que também tentam o SSO antes de pedir a senha.

## API (resumo)

`POST /api/treino/sessao` (sessão de admin → token 12 h; 403 fora da lista) · `POST /api/treino/entrar` (senha → token 12 h) · `GET/POST/PATCH/DELETE /api/treino/projetos[...]` · `POST .../imagens` (multipart `arquivos`, `?grupo=boa|ruim`, campo opcional `meta` = JSON com a origem de cada arquivo, na mesma ordem; resposta `{enviadas, erros, repetidas}`) · `GET .../imagens` (cada item traz `origem` quando há) · `GET .../origens?fmt=json|csv|md` · `POST .../treinar` (com `nome`) · `GET .../treinos` · `PATCH/DELETE .../treinos/{tid}` · `.../cancelar` · `.../publicar` · `.../despublicar` · `GET /api/treino/saude`. Detalhes em `servicos/treino/LEIA-ME.md`.
