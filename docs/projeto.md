# +Projeto — modelo novo a partir das marcações

O **+Projeto** (botão `+Projeto` na barra do topo, grupo de assistência, ao lado de Ferramentas) transforma as funções de tela e mouse em um **modelo novo**: prints → marcações com classe → dataset no Treinar → treino → modelo publicado → Pipeline. Não há URL de imagem em lugar nenhum: tudo são prints (quadros capturados, imagens coladas ou arrastadas), guardados no aparelho até ir para o Treinar.

## Fluxo (assistente de 6 passos no painel)

| Passo | O que faz |
|---|---|
| 1 Projeto | Criar (nome, tipo: **Detecção de objetos — RF-DETR, Apache-2.0** ou **Anomalia — PatchCore, Apache-2.0**) ou *Abrir do Treinar…* (traz classes, imagens, caixas e pastas). Classes: nome, cor, ativa (rádio), renomear, apagar. Classificação de imagem não existe no serviço Treinar. |
| 2 Prints | *Capturar quadro* (botão ou tecla **B**), *capturar a cada N s*, colar (**Ctrl/⌘+V**), arrastar arquivos, *Arquivos…*. Árvore de **pastas** (a raiz é a pasta com o nome do projeto; `+ Pasta`, `+ Subpasta`, renomear, apagar — os prints sobem para a mãe). Tira de miniaturas com estado; mover entre pastas pelo seletor ou arrastando a miniatura para a pasta. |
| 3 Marcar | *Abrir o editor* (primeiro print sem caixas), *Marcar o quadro ao vivo*, *Desenhar exemplos no vídeo* (ferramenta J), *Salvar estes exemplos*. |
| 4 Dataset | Entrada no Treinar (SSO de admin ou senha). *Salvar no dataset (N)* — todo o projeto ou a pasta ativa. Contagem por estado. |
| 5 Treinar | Épocas, tamanho, variante (nano/small/medium). Fila, estado, barra de época, mAP50/mAP50-95/precisão/recall, gráfico do mAP50, log, cancelar, publicar. |
| 6 Usar | *Usar no Pipeline* põe `livres.rfdetr` (ou `livres.patchcore`) com o id do modelo no começo do Pipeline e liga. *Continuar melhorando* volta aos prints; o editor passa a oferecer “Modelo do projeto” na pré-rotulagem. |

Estados do print: **local** (só no aparelho, cinza) · **enviado** (no Treinar, sem caixas, azul) · **rotulado** (no Treinar com caixas, verde) · **alterado** (mudou depois de enviado, laranja — o próximo envio reenvia; `PUT …/rotulos` substitui as caixas). Mudar de pasta um print já enviado apaga a imagem antiga no Treinar e envia de novo com o nome novo.

Imagem idêntica (mesmo sha256 do JPEG) a um print do projeto não vira um segundo print: as caixas novas são juntadas ao print existente (o Treinar 2.2 recusaria a cópia como *repetida*).

## Editor de rotulagem (tela cheia)

Mesmos gestos das Ferramentas de mouse: arrastar ou clique-clique faz a caixa; polígono ponto a ponto (duplo clique, Enter ou clique no 1º ponto fecha; Backspace tira o último); Selecionar move a forma e as alças dos cantos/vértices redimensionam. Coordenadas 0–1 da imagem, presas a ela com zoom (roda, + / − / 0) e pan (Mover, H, espaço+arrastar, botão do meio, ou arrastar no vazio com Selecionar).

| Tecla | Ação |
|---|---|
| 1–9 | classe ativa (e da caixa selecionada); anomalia: 1 = BOA, 2 = RUIM |
| V / R / P / H | selecionar · caixa · polígono · mover |
| Delete / Backspace | apaga a caixa (ou o último ponto do polígono) |
| Ctrl/⌘+Z, Ctrl/⌘+Y (⇧Z) | desfazer / refazer |
| Ctrl/⌘+D | duplicar |
| Enter | aceita a sugestão selecionada / fecha o polígono |
| [ ] (PageUp/PageDown) | print anterior / próximo |
| Shift+F10, tecla Menu | menu de contexto da caixa selecionada |
| Esc | cancela rascunho → limpa seleção → fecha o editor |

**Pré-rotular** (“a máquina propõe, o humano confirma”): YOLOX·COCO, RF-DETR nano·COCO ou o modelo do próprio projeto depois do 1º treino. As caixas sugeridas aparecem tracejadas com o nome e a confiança do detector (o nome COCO é casado com a classe do projeto pelo nome; senão vai a classe ativa). Não vão para o Treinar até serem aceitas (✓, Enter, ou trocar a classe/editar); “Aceitar todas”/“Rejeitar todas”. Sugestões repetidas (IoU > 0,6 com uma caixa existente) são descartadas.

Cada mudança grava o print no IndexedDB (250 ms depois); reabrir e fechar sem mexer não muda o estado.

## Exemplos ao vivo (Ferramentas de mouse)

- Ferramenta **+Projeto · exemplo** (tecla **J**): caixa com a classe ativa sobre o vídeo (cor da classe). Polígonos também podem virar exemplo pela função **+Projeto · exemplo** na lista de marcações (⇧K), que ganha um seletor de classe.
- **Salvar estes exemplos** (botão no widget com o número de exemplos, na lista ⇧K e no passo 3): o quadro atual da fonte (sem marcações, sem espelho, resolução da fonte) + as caixas → print rotulado na pasta ativa. As marcações continuam no vídeo, editáveis; o print tem a sua cópia, editável no editor.
- Renomear/recolorir uma classe atualiza os exemplos ao vivo daquela classe.

## Menu de contexto (clique direito)

`js/components/menu-contexto.js` — registro extensível: `registrarAcao({ id, rotulo, grupo, ordem, quando(ctx), itens(ctx), executar(ctx, sub) })`. Grupos: `projeto`, `sistema`, `processamento`, `marcacao`.

- **Vídeo ao vivo**: arrastar com o botão direito seleciona uma área (retângulo tracejado azul); sem arrastar, vale a marcação sob o cursor (ou o quadro inteiro). Toque longo (550 ms) no celular; Shift+F10/tecla Menu com uma marcação selecionada. Só o canvas do vídeo (e o do editor) troca o menu do navegador.
- **Editor**: o mesmo, sobre a imagem do print.
- Itens: Rotular como ▸ classes · Trocar classe ▸ · Salvar recorte como print no projeto · Salvar quadro inteiro como print (vídeo) · Enviar à pasta ▸ pastas (+ Nova pasta…; no editor, move o print) · Enviar ao Treinar (pasta …) · Pré-rotular aqui · Detectar objetos aqui · Ler texto (OCR) aqui · Ler código aqui · Perguntar à Via sobre esta área (abre a Via com o recorte anexado) · Copiar imagem · Usar como ROI · Excluir área do processamento · Zona de contagem · Medir (régua) · Adicionar ao programa Inspect ▸ (com nó Inspect no Pipeline) · Duplicar · Apagar marcação.
- Resultados (texto, objetos, códigos) num **balão** junto da área, com “Copiar”, “Marcar como caixas” e “Usar como rótulo” (cria/usa a classe com aquele nome e rotula a área).
- Teclado: setas, Home/End, → abre submenu, ← volta, Enter/Espaço executa, Esc fecha e devolve o foco. Em telas ≤ 600 px o submenu entra no lugar do menu com “‹ Voltar”.
- As leituras usam `cv/runtime/livres-n/modelos.js` (PP-OCRv5, leitor de códigos, YOLOX/RF-DETR e os RF-DETR publicados), carregado sob demanda.

## Persistência

IndexedDB `aiv-projeto` (stores `projetos` — índice `usuario` — e `prints` — índice `projeto`, com o Blob JPEG dentro). Chave por usuário: `definirUsuario(id)` chamado pelo workspace com o id de `/api/me` (como as playlists e a Via). Projeto ativo em `localStorage aiv.projeto.ativo:<usuario>`; passo do assistente em `aiv.projeto.passo`. Sem IndexedDB (aba privada) funciona só na memória da aba, com aviso. Miniaturas: object URLs locais (revogados quando o print some).

## Outros módulos → prints

`window.dispatchEvent(new CustomEvent('aiv:prints', { detail: { imagens: [Blob…], origem, pasta? } }))` põe as imagens na tira do projeto ativo (pasta ativa, ou `pasta`) com a origem, e abre o painel. Sem projeto, cria “Novo projeto”. Usado pelo editor GPlanSiS|Vídeo.

## Contrato com o Treinar (aivision-treino 2.2)

| Chamada | Uso |
|---|---|
| `POST /api/treino/sessao` / `POST /entrar` | token (SSO de admin ou senha) — `js/auth/treino.js` |
| `POST /projetos` `{nome, tipo: detector\|anomalia, motor: rfdetr, classes}` | 1º envio |
| `PATCH /projetos/{pid}` `{nome, classes}` | a cada envio (só acrescenta/renomeia classes) |
| `POST /projetos/{pid}/imagens[?grupo=boa\|ruim]` multipart `arquivos` + `meta` | um print por vez; resposta `{enviadas, erros, repetidas}` |
| `PUT …/imagens/{nome}/rotulos` `{caixas: [[cls,cx,cy,w,h]…]}` | caixas (polígono → retângulo envolvente; sugestões não vão) |
| `PUT …/imagens/{nome}/grupo` | anomalia |
| `DELETE …/imagens/{nome}` | mudar de pasta (reenvio) |
| `GET …/imagens` (com `origem`), `GET …/imagens/{nome}` | Abrir do Treinar |
| `POST …/treinar` `{nome, motor: rfdetr, variante, epocas, imgsz, publicar: true}` | treino (PatchCore: `{nome, imgsz}`) |
| `GET …/treinos/{tid}` (a cada 2 s enquanto ativo), `POST …/publicar`, `POST …/cancelar` | progresso e publicação |
| `/models/custom/index.json` | o operador do Pipeline lê o modelo publicado (`registrarTreinadosLivres`, CV-24) |

**Pastas.** O serviço não tem pasta nem subpasta. A pasta vai (1) no nome do arquivo: `turno-A--defeitos-novos__quadro-arquivo-20261021-….jpg` (segmentos com `--`, separador `__`) e (2) no metadado `meta` (v2.2): `fonte` = `arquivo` (arquivo de imagem) ou `print` (captura, colado, recorte), `origem` = `"pasta: turno-A/defeitos-novos · quadro de um vídeo do aparelho"`, `titulo` = `"+Projeto «nome» · pasta nome/turno-A/defeitos-novos"`, `capturado` (ISO), `arquivo`. Ao trazer do Treinar, a pasta é lida de `origem.origem` (com acentos) e, sem ela, do nome do arquivo.

## Arquivos

- `js/projeto/base.js` — modelo, IndexedDB, classes, pastas, prints, evento `aiv:prints`.
- `js/projeto/servico.js` — conversa com o Treinar.
- `js/projeto/captura.js` — quadro atual da fonte (sem marcações/espelho).
- `js/projeto/exemplos.js` — “Salvar estes exemplos”.
- `js/projeto/acoes.js` — itens do +Projeto no menu de contexto.
- `js/components/ProjetoPanel.js` — painel (sob demanda), `js/components/projeto-editor.js` — editor, `js/components/menu-contexto.js` — registro + menu + balão, `css/projeto.css`.
- Mudanças mínimas: `js/cv/marcacoes.js` (função `projeto_exemplo`, ferramenta `exemplo`/J, `rt.selecao`), `js/components/marcacoes-vista.js` (clique direito/toque longo/Shift+F10, ações de vídeo), `js/components/FerramentasMouse.js` (botão Salvar exemplos, classe do exemplo na lista, Shift+F10, teclas cedidas ao editor), `js/components/MenuBar.js` (botão +Projeto), `js/workspace.js` (painel sob demanda, coluna, usuário), `js/via/ViaPainel.js` (pedido com anexos).

## Testes

Servidor de teste com `/api/treino/*` mockado (`scratchpad/projeto-mock/srv.py`, imita o contrato 2.2 com dedupe por sha256 e `meta`; publicar aponta para um RF-DETR pequeno real). Ponta a ponta (`projeto-mock/t2.js`, 58 verificações): criar projeto e classes (renomear/adicionar/apagar), prints (B, colar, arrastar, vídeo), pastas e subpasta, mover entre pastas, exemplo J no vídeo, clique direito → Rotular como / Ler texto / Salvar recorte / Enviar à pasta, Salvar estes exemplos, editor (caixa, pré-rotular, aceitar/rejeitar, mover, alça, classe 2, Delete, desfazer/refazer, Rotular como e OCR pelo menu), dataset no Treinar (caixas, pasta no nome e no meta), editar e reenviar (PUT substitui), mover e reenviar, treinar → publicar, Usar no Pipeline (operador roda), pré-rotular com o modelo do projeto, `aiv:prints`, Shift+F10 e teclado no menu, menu do navegador livre fora do vídeo, repetida, Abrir do Treinar (pastas de volta), Perguntar à Via. Regressão da barra (`barra-tools/regressao.js`) passa com o botão novo.

## Limitações

- O Treinar treina detector com **caixas**: polígonos vão como o retângulo que os envolve. Anomalia ignora a área do defeito (só documenta).
- Remover classe só antes do 1º envio (o serviço não deixa).
- O catálogo de modelos publicados é relido a cada 30 s pelo operador: um modelo recém-publicado pode levar até isso para aparecer se o catálogo já tinha sido lido na sessão.
- Exemplos ao vivo usam o quadro atual da fonte no instante do clique; com vídeo rodando, a caixa pode não coincidir com o objeto se ele se moveu desde o desenho (pause antes de salvar).
- O editor desenha a própria geometria (mesmos gestos e aparência das Ferramentas de mouse), porque o desenho do vídeo está preso ao `vista` global.
