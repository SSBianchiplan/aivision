# Via — assistente de IA

A **Via** é a assistente de IA do iaVision. Ela gera **comandos prontos** — listas de classes, frases e prompts — para os parâmetros de texto dos operadores que aceitam comando (YOLOE, Florence-2, MobileCLIP, RF-DETR, SAM 2, Quadra…), explica módulos e sugere encadeamentos no Pipeline. Roda com o modelo Claude da Anthropic, usando a **chave do próprio usuário**.

Regra de ouro: **a IA propõe, o humano decide.** A Via nunca altera o Pipeline nem a biblioteca sozinha: tudo o que ela sugere chega como um cartão com botões, e só o clique do usuário aplica.

## Como abrir

| Onde | O quê |
|---|---|
| Barra de cima › **Via** (ícone ✦) | abre/fecha a gaveta à direita (no celular, pelo menu ☰) |
| **Ctrl + K** (⌘ + K no Mac) | abre/fecha de qualquer lugar, inclusive com o foco num campo |
| Pipeline › parâmetro de texto › **✨ Via** | abre já com o contexto do campo («gere um comando para este campo») |
| Coisas › **✨ Pedir lista à Via** | idem, para o filtro/classes do YOLOE |
| Config › **✦ Via** | chave, modelo e esforço |

O atalho é Ctrl/⌘ + K porque as letras soltas abrem painéis e Shift + letra fica com as ferramentas do mouse. Esc fecha a gaveta (quando não há resposta em andamento e o foco não está na caixa de texto).

A gaveta (`js/via/ViaPainel.js`), o cliente e o SDK carregam **sob demanda**: nada disso baixa antes de alguém abrir a Via.

## Chave e privacidade

- A chave é **do usuário** (crie em [console.anthropic.com](https://console.anthropic.com/settings/keys); a cobrança é na conta dele).
- Fica **só no navegador**: `localStorage` («lembrar neste aparelho») ou `sessionStorage` («só nesta sessão» — some ao fechar a aba). É separada por conta do iaVision (id de `/api/me`), como as playlists.
- Vai **direto do navegador para `api.anthropic.com`** pelo SDK oficial (`dangerouslyAllowBrowser: true`). Nunca passa pelos servidores do iaVision, não é registrada em log/console e não entra em exportação.
- **Quem usar o mesmo navegador com a mesma conta pode usá-la** — a interface avisa. Em computador compartilhado: «só nesta sessão» e **Apagar chave** ao terminar.
- **Testar** faz `GET /v1/models/{modelo}`: prova que a chave vale e enxerga o modelo, sem gerar tokens.
- O vídeo continua local. A única exceção é quando o usuário **permite** mandar um quadro (ver abaixo).
- Funciona sob COOP `same-origin` + COEP `require-corp`: a chamada é CORS e a resposta (inclusive o 401 de chave inválida) chega ao JS. Se um dia o servidor ganhar uma CSP, `connect-src` precisa incluir `https://api.anthropic.com`.

## Modelos, esforço e custo aproximado

| Modelo | ID | Preço (por milhão de tokens, entrada / saída) | Quando |
|---|---|---|---|
| Opus 5.5 (**padrão**) | `claude-opus-5-5` | US$ 4 / 20 | o mais capaz |
| Sonnet 5.5 | `claude-sonnet-5-5` | US$ 2 / 10 | mais rápido e barato |
| Haiku 5.5 | `claude-haiku-5-5` | US$ 0,10 / 0,50 | o mais rápido e barato |

A escolha é do usuário (Config › Via ou aba «Chave e modelo» da gaveta). **Esforço**: baixo, médio (padrão) ou alto — vai sempre explícito em `output_config.effort`.

Ordem de grandeza: o prompt de sistema (regras + catálogo dos 94 operadores) tem ~9 mil tokens e fica em **cache** depois da primeira mensagem (leitura de cache custa uma fração da entrada). Uma pergunta típica com uma ou duas idas e vindas de ferramentas fica na casa de **centavos de dólar no Opus 5.5**, cerca de metade no Sonnet 5.5 e frações de centavo no Haiku 5.5. Cada quadro do vídeo acrescenta cerca de mil tokens. A gaveta mostra os tokens da conversa (entrada, cache lido, saída).

## Como a chamada é feita

- SDK oficial `@anthropic-ai/sdk` **0.137.0**, bundle ESM de arquivo único em `vendor/anthropic/sdk-0.137.0.mjs` (gerado pelo esm.sh a partir do pacote do npm; sem build), importado com `import()` só quando a Via precisa.
- `client.beta.messages.stream(...)`, `stream.on('text', …)` para o streaming e `await stream.finalMessage()` para a mensagem completa.
- `thinking: {type: "adaptive"}` (no Opus 5.5 o thinking não pode ser desligado), `max_tokens: 16000`, `tool_choice: {type: "auto"}` (`any`/`tool` forçado dá 400 no Opus 5.5 e no Sonnet 5.5 — a escolha da ferramenta é instruída no prompt).
- **Fallback de recusa** no servidor: `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"` no Opus 5.5 e no Sonnet 5.5 (o Haiku 5.5 não tem). Se a API recusar o parâmetro (400 citando *fallback*), a Via desliga o fallback naquela página, anota o motivo no console (`[Via] fallback de recusa desligado…`) e repete sem ele.
- **Prompt caching**: ferramentas (sempre na mesma ordem) → sistema (texto fixo + catálogo do registry, sem data/hora nem pipeline) com `cache_control: {type: "ephemeral"}` no último bloco. O que muda a cada pedido entra pelas ferramentas.
- **Ciclo de ferramentas** manual: enquanto `stop_reason === "tool_use"`, executa todas as ferramentas do turno e devolve **todos** os `tool_result` numa única mensagem. `end_turn` encerra; `refusal` descarta o parcial e mostra a recusa (com a categoria de `stop_details`); `max_tokens` com ferramenta no meio **não executa** a ferramenta truncada.
- Histórico **só-acréscimo**: um turno que falha ou é recusado é cortado inteiro do fim (o prefixo, com os blocos de thinking, nunca é editado). Depois de um fallback no meio da resposta, os blocos anteriores ao marcador `fallback` (exceto texto) não voltam no histórico.
- Erros tratados pela **classe** do SDK: `AuthenticationError` → «chave inválida»; `PermissionDeniedError`; `NotFoundError` (modelo); `RateLimitError` → «aguarde N s» (`retry-after`); `APIConnectionError`/`APIConnectionTimeoutError` → rede; `BadRequestError`; `InternalServerError`.

## Ferramentas da Via

Executadas no navegador (`js/via/ferramentas.js`). Todas vão com `eager_input_streaming: true`; por isso **cada uma valida o input** antes de executar (operador existe, parâmetro existe e aceita comando, tamanho máximo do campo, tipos). Input inválido volta para a Via como `tool_result` com `is_error`, sem executar nada.

| Ferramenta | O que faz |
|---|---|
| `listar_operadores_com_comando` | operadores com campos que aceitam comando (formato, idioma, padrão, máximo, dica) + listas do painel Coisas |
| `obter_pipeline` | nós atuais: op, rótulo, ligado, erro, params (textos longos resumidos) |
| `propor_comando` | **cartão** com o valor (editável) e os botões **Aplicar no Pipeline**, **Salvar**, **Copiar** |
| `salvar_comando` | **cartão** de salvar na biblioteca (categoria escolhível; cria categoria nova se a Via sugerir) — grava só com confirmação |
| `adicionar_operador` | **cartão** com o operador e os params alterados; botão **Adicionar ao Pipeline** |
| `ver_quadro_atual` | pede permissão (**Permitir uma vez** / **Nesta conversa** / **Agora não**) e devolve o quadro da fonte em JPEG ≤ 768 px |
| `listar_comandos_salvos` | o que já está na biblioteca |
| `buscar_conhecimento` | consulta a base de conhecimento (`GET /api/via/busca`: itens do usuário + compartilhados) e devolve trechos com id/título/origem; o prompt manda consultar antes de perguntas técnicas de visão e citar como (base: «título») |
| `listar_projetos_treinar` | projetos do Treinar (id, nome, tipo, classes, nº de imagens); usa o token do Treinar ou tenta o SSO de admin |
| `enviar_ao_treinar` | **cartão** com as miniaturas (ids `A1`, `A2`…), o projeto e o grupo (anomalia); só envia com o clique; se faltar acesso, o cartão tenta o SSO e depois pede a senha |

As três novas ficam **no fim** da lista de ferramentas: o prefixo das anteriores não muda (cache).

## Imagens anexadas

📎, arrastar e soltar sobre a gaveta ou **Ctrl+V** na caixa de texto. JPG, PNG ou WebP, até **8 por mensagem**. Antes de sair do aparelho cada imagem é reduzida a no máximo **1568 px** no maior lado e regravada em **JPEG 0,85** (`js/via/anexos.js`); as miniaturas aparecem acima da caixa e saem com ✕. Na mensagem, cada imagem vira um bloco `image` (base64) e um bloco de texto lista os ids (`A1 (nome, L×A)`), que a Via usa nas ferramentas. Na bolha enviada, «Mandar estas imagens para o Treinar» abre o mesmo cartão do `enviar_ao_treinar` (escolher projeto, marcar quais imagens). O envio usa `POST /api/treino/projetos/{id}/imagens` (multipart `arquivos`, lotes de 8, `?grupo=` em anomalia). Os anexos vivem só na memória da página.

## Memória no servidor (aivision-via)

Opção em **Chave e modelo**: «Salvar conversas no servidor da GPlanSiS» (ligada por padrão). Depois de cada turno concluído a Via grava, ligado à conta do iaVision, a pergunta, a resposta, os comandos dos cartões e os **metadados** das imagens (sha256, largura, altura). **Não vão** a chave da Anthropic (o cliente e o servidor recusam qualquer `sk-ant-…`) nem as imagens. Falha no servidor não atrapalha a conversa: aparece um aviso discreto embaixo do campo. Aplicar/salvar um comando marca `aplicado`/`salvo`; mandar imagens ao Treinar anota o projeto no anexo.

**Salvar na base**: botão nas respostas e nos cartões de comando; abre título (a pergunta do turno), texto, etiquetas e — só para admin (`AIV_VIA_ADMINS`) — «Compartilhar com toda a equipe».

**Aba Base**: busca (RAG) e lista dos itens visíveis (meus + equipe), apagar os próprios, admin compartilha/descompartilha e apaga compartilhados; «Minhas conversas no servidor» lista as conversas com Apagar e **Apagar todas as minhas conversas** (LGPD). Os itens da base sobrevivem às conversas apagadas (a origem vira nula).

| Endpoint (`/api/via/…`) | Corpo / resposta |
|---|---|
| `POST registro` | `{conversa_id?, pergunta, resposta, modelo, tokens_in, tokens_out, comandos:[{op, parametro, valor}], anexos:[{sha256, largura, altura}]}` → `{conversa_id, mensagem_usuario_id, mensagem_via_id, comandos:[ids], anexos:[ids]}` |
| `PATCH comandos/{id}` | `{aplicado?, salvo?}` |
| `POST anexos/treinar` | `{sha256:[…], projeto}` → `{atualizados}` |
| `POST conhecimento` | `{titulo, texto, tags[], compartilhado, origem_mensagem_id?}`; `compartilhado: true` só admin (403) |
| `GET conhecimento?escopo=meus\|todos` | itens visíveis, com `meu` |
| `PATCH conhecimento/{id}` | `{compartilhado}` — só admin |
| `DELETE conhecimento/{id}` | o dono; admin também apaga compartilhados |
| `GET busca?q=&n=` | `{q, modo, trechos:[{id, titulo, trecho, tags, compartilhado, meu, criado_em, score}]}` |
| `GET historico` · `GET historico/{id}` · `DELETE historico/{id}` · `DELETE historico` | conversas do próprio usuário |
| `GET eu` | `{email, admin, embeddings}` |
| `GET saude` | sem autenticação |

Sem sessão ou cookie inválido → 401; login fora → 503; corpo > 2 MB → 413; limites por IP (escrita 90/min, leitura 240/min, consultas novas ao login 30/min).

**Busca**: `via_busca()` no Postgres — `websearch_to_tsquery('portuguese', f_unaccent(q))` com os termos soltos em OU (quem tem todos ganha bônus) + `ts_rank_cd` (título e etiquetas peso A, texto peso B) + `word_similarity` de trigramas (tolera erro de digitação, limiar 0,45), sempre filtrado por «meus ou compartilhados». Índices GIN no `tsvector` gerado e trigram em título/texto.

**Embeddings (próximo passo, desligado)**: a coluna `conhecimento.embedding vector(384)` e a função `via_busca_vetor()` já existem; `AIV_VIA_EMBEDDINGS=0`. Para ligar: um modelo multilíngue pequeno de 384 dimensões em ONNX (ex.: multilingual-e5-small, ~120 MB, ~300 MB de RAM no CPU) num contêiner separado que preencha `embedding` ao salvar e à busca, mais um índice HNSW quando houver volume. Não entrou agora para não somar memória e uma dependência de modelo à vps2 com uma base que ainda começa vazia — a busca textual + trigram cobre bem o português técnico curto.

**Imagem do vídeo**: só sai do aparelho se o usuário marcar **Incluir imagem do vídeo** na mensagem ou aceitar o pedido da ferramenta. Vai o quadro da *fonte* (sem as caixas desenhadas), reduzido.

«Aplicar no Pipeline» usa o nó do contexto (quando a Via foi aberta pelo ✨ de um campo), senão o primeiro nó daquele operador; se não houver, cria o nó com os padrões e o valor.

## Campos que aceitam comando

Tabela explícita em `js/via/comandos.js` (`CAMPOS_COMANDO`), para não oferecer IA em campos técnicos (calibração da Quadra, identificador de modelo treinado, pontos do VBT):

| Operador | Parâmetro | Formato |
|---|---|---|
| `yoloe.prompt` | `classes` | lista em inglês, termos concretos («red helmet», «open door») |
| `yoloe.detect` | `filtro` | lista em inglês, só nomes do vocabulário fixo (4.585 classes) |
| `florence2.tarefa` | `texto` | uma expressão em inglês (tarefa «achar o que eu escrever») |
| `clip.classify` | `classes`, `modelo` | rótulos em inglês; molde com `{}` («a photo of {}») |
| `rfdetr.detect` | `classes` | nomes do COCO em português (pessoa, carro, caminhão…) |
| `sam2.seguir` | `classe` | uma classe (trecho do nome da detecção) |
| `quadra.analise` | `classesJogador`, `classesBola` | lista pt + en |

Operadores novos com um parâmetro de texto cujo nome indique classe/filtro/texto/prompt entram pela heurística `infoCampo()` (e nunca os que parecem calibração, ponto, id, url…). Para garantir, acrescente-os à tabela.

## Biblioteca de comandos

`js/via/comandos.js` — mesmo padrão de `youtube/playlists.js`: `localStorage` por usuário (`aivViaComandos:<id>`), leitura por `estado()`/`ouvir()`.

- Cada comando: nome, operador, parâmetro, valor, **categoria**, descrição, origem (via / manual / coisas) e data.
- Categorias padrão: Detecção, Vocabulário aberto, Bike Fit, Corrida, Industrial, Quadra, Esportes, Outros — e as criadas pelo usuário.
- Mesmo nome + operador + parâmetro substitui em vez de duplicar. Limite de 500 comandos.
- **Exportar/Importar JSON** (aba «Comandos» da gaveta): exporta só comandos e categorias — nunca a chave nem a conversa. Importar junta à biblioteca atual.

Nos campos:

- **★** ao lado de cada parâmetro que aceita comando (Pipeline › nó selecionado): lista os comandos salvos daquele operador/parâmetro — um clique aplica — e **☆ Salvar atual** guarda o valor do campo.
- **✨ Via**: abre a Via com o campo como contexto e o pedido pré-escrito (o usuário completa o objetivo e envia).
- **Coisas**: «Da Via e da biblioteca» mostra os comandos do modo atual (filtro do YOLOE ou classes por texto); **★ Salvar na biblioteca** guarda a lista montada.

## Arquivos

| Arquivo | Carrega | Papel |
|---|---|---|
| `js/via/base.js` | sempre (leve) | chave, preferências, dono, pedido de abertura |
| `js/via/comandos.js` | sempre (leve) | biblioteca + tabela de campos |
| `js/via/CampoComando.js` | sempre (leve) | ★ / ✨ ao lado do campo |
| `js/via/ViaChave.js` | sempre (leve) | formulário de chave/modelo/esforço (Config e gaveta) |
| `js/via/ViaPainel.js` | ao abrir | gaveta, chat, cartões, biblioteca |
| `js/via/cliente.js` | ao abrir / Testar | SDK, ciclo de ferramentas, erros |
| `js/via/ferramentas.js`, `js/via/prompt.js` | ao abrir | ferramentas e prompt de sistema |
| `vendor/anthropic/sdk-0.137.0.mjs` | no primeiro pedido | SDK oficial (MIT) |
| `css/via.css` | sempre | gaveta, cartões, ★/✨, anexos, Base (claro e escuro) |
| `js/via/servidor.js` | ao abrir | cliente do `/api/via/*` (registro, base, histórico) |
| `js/via/anexos.js` | ao abrir | redução das imagens (1568 px, JPEG 0,85, sha256) |
| `js/auth/treino.js` | ao abrir / fonte YouTube | token do Treinar, SSO de admin, projetos e envio de imagens |

## Testes

Sem chave real. `definirClienteTeste(fabrica)` (em `js/via/cliente.js`) injeta um cliente falso que emite texto em streaming e blocos `tool_use` — cobre os cartões, a validação (op inexistente → `is_error`), os `tool_result` juntos numa mensagem, o pedido de imagem, recusa, `max_tokens` com ferramenta, 401/429/rede e a estabilidade do prefixo (ferramentas e sistema idênticos entre chamadas). O caminho de chave inválida também é testado contra a **API real** com uma chave falsa: 401 → `AuthenticationError` → «chave inválida», sem custo.

Anexos, Treinar e memória: servidor de teste com `/api/me` simulado e mocks de `/api/via/*` e `/api/treino/*` (admin e não-admin) — cobre 📎/colar/arrastar, redução a 1568 px, os blocos `image`, `buscar_conhecimento` no ciclo, anexo inexistente → `is_error`, o registro (sem imagem e sem chave), o cartão do Treinar (SSO ou senha, upload em lote), «Salvar na base», a aba Base e a opção de privacidade. O serviço `aivision-via` tem `servicos/via/testes/teste_api.py` (roda dentro do contêiner contra o banco real, com usuários de teste que apaga no fim).
