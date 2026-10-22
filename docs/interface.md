# Interface: barra, painéis e atalhos

## Barra do topo

Da esquerda para a direita, em grupos separados por um traço — o caminho do dado:

| Grupo | Botões |
|---|---|
| — | **⏸ Rodando** (pausar/retomar, `espaço`) |
| **Núcleo** | Fonte `f` · Pipeline `p` (com o número de nós ligados) · Módulos `m` · Modelos `d` |
| **Domínios** | Coisas · Esportes · Bike Fit · Industrial |
| **Análise** | Telemetria `t` · Contexto `x` · Códigos `q` · Legendas `l` |
| **Ferramentas** | **Player** `⇧B` (mostra/esconde a [barra de vídeo](#barra-de-vídeo)) · **Ferramentas** de mouse · **Via** `⌘/Ctrl+K` |
| — | fps · **avatar** |

Botão amarelo = painel aberto / widget ligado. O atalho de cada botão aparece no tooltip.

**Avatar** (iniciais, ou a foto quando a conta tiver): o tooltip mostra nome e papel; o clique abre o menu da conta — no celular, uma folha que desce do topo. No menu: nome, e-mail e papel; **Configurações** `g`, **Acesso** `a`, **Exportar** `e`, **Treinar** (abre `/treino/` numa aba nova); **Comparar** `c` (marcado quando ligado), **Capturar PNG** `s`, **Organizar painéis** `o` (só habilitado com painel solto); **Tema** — seletor de três opções: **Escuro** (iaVision) · **Claro** · **Code Dark** (ver [Temas](#temas)); **Sair**. O item de um painel aberto fica amarelo com um ponto, e o avatar ganha um ponto amarelo enquanto algo do menu estiver aberto/ligado. Teclado: setas/Home/End percorrem, Enter/espaço escolhem, Esc fecha e volta ao avatar; clicar fora também fecha.

A barra se mede: se não couber, primeiro tira os rótulos de Análise e Ferramentas, depois todos, depois o "ops" da marca; no limite (e sempre abaixo de 1000 px) vira **☰**, que mostra os mesmos grupos (Núcleo, Domínios, Análise, Ferramentas + Relações) — o que está no menu do avatar não se repete ali. No celular a barra fica com marca, ⏸, fps, ☰ e avatar.

## Painéis

| Painel | Tecla | Para que serve |
|---|---|---|
| **Módulos** | `m` | Catálogo dos 28 módulos; clique num operador para acrescentá-lo ao fim do Pipeline. |
| **Modelos** | `d` | Todos os modelos com licença, tamanho e estado; **Carregar todos / Descarregar todos** (um por vez); bloco AGPL (YOLO26, YOLOE, treinados YOLO26) com aceite explícito. |
| **Coisas** | — | O que o YOLOE procura: busca em português nas 4.585 classes ("capacete" → helmet), modo *Qualquer coisa* (filtro) ou *Por texto* (qualquer palavra), listas prontas (EPI, logística, escritório, cozinha, trânsito, agro) e listas salvas com nome; **Aplicar no Pipeline**. |
| **Pipeline** | `p` | A cadeia de operadores: ordem, ligar/desligar, parâmetros. Presets por grupo (51) — clássicos, movimento, detectar e ler, entender a cena, YOLO26/YOLOE, mãos/rosto/olhos, Bike Fit, modelos livres. |
| **Fonte** | `f` | Câmera, arquivo, tela, YouTube, RTMP — ver [fontes.md](fontes.md). |
| **Telemetria** | `t` | fps, tempo por operador. |
| **Exportar** | `e` | *(menu do avatar)* Grafo da cadeia (JSON) e captura. |
| **Acesso** | `a` | *(menu do avatar)* Conta, papéis, biometria facial (consentimento LGPD). |
| **Contexto** | `x` | LER, CONTAR, DESCREVER, ANALISAR e TRANSCREVER a cena (cruzamento de OCR, detecção e classificação, por regras). |
| **Códigos** | `q` | Leituras de QR e 12 formatos de código de barras. |
| **Legendas** | `l` | Legendas e transcrição (Whisper local, reconhecimento do sistema ou servidor). |
| **Config** | `g` | *(menu do avatar, "Configurações")* Catálogo com guia de cada módulo (o que é, quando usar, o que não faz, custo), Desempenho, **Modelos livres** (só modelos livres, pré-carregar e "ao iniciar") e Sistema. |
| **Bike Fit** | — | Ver [bike-fit.md](bike-fit.md). |
| **Treinar** | — | *(menu do avatar)* Abre `/treino/` — ver [treinar.md](treinar.md). |

Painéis podem ser arrastados para fora da coluna (viram flutuantes), redimensionados pela alça e reorganizados com **Organizar** (`o`).

### Disposição padrão

Na primeira vez (e no **Organizar** `o`, ou com duplo clique no punho de cada widget): **Ferramentas de mouse** colada na borda esquerda, 8 px abaixo da barra do topo; **Player** em faixa fina centrado embaixo, acima da linha de atalhos; colunas de painéis nos lados. As Ferramentas e o Player são **áreas reservadas** para o organizador (`layout/organizador.js`): a coluna da esquerda começa à direita das Ferramentas, as colunas contornam as Ferramentas onde quer que elas estejam (levadas para a direita, as colunas da direita passam para o lado de dentro e a da esquerda volta à borda), e terminam acima do Player se ele cruzar uma coluna (ou começam abaixo, se ele foi levado para a metade de cima). A Seção da correia, sem posição guardada, procura lugar livre ao lado/acima deles. Tudo é recalculado quando um widget é solto, recolhido ou devolvido ao lugar. A faixa fina automática nunca passa da área livre do vídeo: estreita, a linha do tempo desce para uma segunda linha.

Quem tinha posições guardadas da disposição antiga recebe esta **uma vez** (marca `localStorage['aiv.layout.widgets'] = '2'`: apaga `gplansis.ferramentas.pos` e `gplansis.videoctl.pos`, põe o Player em faixa fina e, fora do celular, abre as Ferramentas); depois vale o que a pessoa mover.

### Grade invisível e ímã

Arrastar e redimensionar painéis soltos, Player, Ferramentas e Seção da correia encaixa numa **grade de 8 px** e, a até 10 px, **gruda** nas bordas da tela (margem de 8 px), na base da barra do topo, no centro da área do vídeo, acima da linha de atalhos e nas bordas dos outros widgets e colunas — alinhado (borda com borda) ou encostado (lado a lado, a 8 px). Guias finas na cor de destaque aparecem só durante o arrasto. **Alt/⌥** apertado durante o arrasto desliga o encaixe (pixel a pixel). Um módulo só: `layout/grade.js`.

### Recolher (▾/▸)

Todo painel e widget tem o mesmo botão de recolher, 20×20, no canto superior direito — ao lado do ✕ quando há: ▾ **Recolher**, ▸ **Abrir**. Painel na coluna ou solto: fica só o cabeçalho, no mesmo lugar (clique no cabeçalho também abre); Via: só o cabeçalho, no canto de sempre; Player: faixa fina; Ferramentas: só a ferramenta ativa; Seção da correia: faixa com seção, vazão e nível. O estado fica guardado (painéis no estado do layout; Via em `aiv.via.recolhida`; widgets nas chaves de cada um).

### Menu da tela (clique direito)

Clique direito no **fundo da tela** ou no **cartão inicial** (sem fonte) abre o menu da tela — o mesmo componente do menu do vídeo, contexto `tela` (`layout/menu-tela.js`): **Ligar câmera** · **Abrir imagem ou vídeo…** · **Capturar tela…** · **YouTube…** (abre a Fonte já no campo do link) · **Colar print no +Projeto** · **Abrir painel ▸** (Fonte, Pipeline, Módulos, Modelos, Coisas, Esportes, Industrial, Telemetria, Contexto, Códigos, Legendas, +Projeto, Via; ✓ nos abertos, clicar alterna) · **Mostrar/Ocultar o Player** · **Mostrar/Ocultar as Ferramentas** · **Organizar** · **Recolher todos os painéis** · **Abrir todos os painéis** · **Tema ▸** (os mesmos do menu do avatar) · **Comparar** · **Capturar PNG** · **Atalhos de teclado**. Com vídeo na tela, o clique direito no vídeo continua com as ações de área e ganha no fim o submenu **Tela ▸** com essas mesmas funções. Teclado: `Shift+F10` ou a tecla Menu com o foco no fundo. Campos, links, texto selecionado e o conteúdo dos painéis mantêm o menu do navegador.

## Barra de vídeo

Mostra/esconde pelo botão **Player** da barra do topo (ou `⇧B`; no celular, ☰ › Ferramentas). Escondida ela não para nada: gravação em curso e player do YouTube continuam; a escolha fica guardada no aparelho. Abre em **faixa fina** centrada embaixo, acima da linha de atalhos ([disposição padrão](#disposição-padrão)); arrastável pelos três pontos, com a [grade e o ímã](#grade-invisível-e-ímã) (duplo clique devolve ao rodapé, em faixa fina). O botão ▸ no canto direito **abre** a barra completa; ▾ recolhe de novo numa faixa fina com todos os botões pequenos e a linha do tempo (a escolha fica guardada no aparelho). **Zoom** − 🔍 + amplia a fonte antes do processamento (o que os modelos recebem é o recorte); também arrastando a imagem, pinça, Ctrl/⌘ + roda, duplo clique e as teclas + − 0. **⟲ Repetir** recomeça o vídeo ao terminar (arquivo e YouTube). Em câmera/tela/RTMP opera sobre o buffer dos últimos segundos (voltar/avançar quadro, congelar, linha do tempo do buffer); em arquivo, sobre o vídeo; com o YouTube aberto, sobre o player (ver [fontes.md](fontes.md#controles-do-player)). Grava em vídeo (MP4/WebM conforme o navegador) com ou sem áudio.

## Ferramentas de mouse

Widget vertical colado na borda esquerda, logo abaixo da barra do topo — as colunas de painéis da esquerda começam à direita dele ([disposição padrão](#disposição-padrão)); não desce sobre a barra de vídeo nem sobre a linha de atalhos (se a altura não der, os botões quebram em duas colunas). Arrastável pelos três pontos, com a [grade e o ímã](#grade-invisível-e-ímã) (duplo clique devolve à borda esquerda), **recolhível** pelo ▾ no canto superior direito (fica só a ferramenta ativa; a escolha é guardada no aparelho). Liga/desliga pelo botão **Ferramentas** da barra do topo (no celular, ☰ › Ferramentas). Funciona com mouse e toque; no celular os botões ficam menores e nada rola na horizontal.

As marcações ficam em coordenadas normalizadas da **fonte inteira**: continuam presas ao mesmo ponto da imagem ao dar zoom, arrastar o enquadramento ou ligar o espelho. Elas são desenhadas no próprio canvas — entram na captura PNG e na gravação.

| Ferramenta | Tecla | O que faz |
|---|---|---|
| Mover / navegar | `v` | Padrão. Arrastar, pinça, duplo clique e Ctrl/⌘ + roda continuam fazendo o zoom de sempre (só nesta ferramenta). |
| Selecionar e editar | `⇧V` | Seleciona, arrasta a forma, arrasta vértices pelas alças; `Delete` apaga; na linha selecionada, clique na seta do meio inverte o sentido; duplo clique num texto edita. |
| Área retangular | `r` | Arraste (ou clique e clique). Nasce como **Zona de contagem**. |
| Polígono | `⇧P` | Clique ponto a ponto; duplo clique, `Enter` ou clique no 1º ponto fecha; `Backspace` tira o último; `Esc` cancela. |
| Círculo / elipse | `⇧O` | Arraste a caixa da elipse. |
| ROI | `⇧R` | Retângulo com função **Processar só aqui**. |
| Exclusão | `⇧E` | Retângulo hachurado com função **Exclusão (ignorar)**. |
| Linha de contagem | `⇧L` | De A para B; a seta no meio mostra o sentido "ida". Função **Cruzamento**. |
| Régua | `⇧M` | Distância em px da fonte; com calibração, em mm/cm/m. |
| Ângulo | `⇧A` | Três cliques; o do meio é o vértice. |
| Ponto / marcador | `n` | Marca um ponto com nome. |
| Texto / anotação | `⇧T` | Clique e escreva (`Enter` confirma). |
| Conta-gotas | `i` | RGB, HEX, HSV, cinza do pixel da **fonte** (sem os desenhos por cima) e média 11×11; clique fixa e copia. |
| Borracha | `⇧X` | Clique ou arraste sobre as marcações. |

Ações: **Desfazer** `Ctrl/⌘+Z` · **Refazer** `Ctrl/⌘+Y` ou `Ctrl/⌘+⇧Z` · **Mostrar/ocultar** `⇧H` · **Limpar tudo** (com confirmação; dá para desfazer) · **Lista de marcações** `⇧K` · **Capturar PNG** com as marcações (`s`). `Esc` cancela o desenho em andamento.

Os atalhos das ferramentas não conflitam com os do sistema: só letras livres vão sem Shift (`v r n i j w k h y u z`); as demais usam Shift porque `p o l m a t e x` já são painéis e ações. Valem com o widget ligado, fora de campos de texto e com o editor do +Projeto e o editor de vídeo fechados (com eles abertos, as teclas são deles).

### Mais ferramentas (popover ⋯)

O botão **⋯** no fim da barra (tecla `.`) abre o popover **Mais ferramentas** com o catálogo inteiro em grade, agrupado por categoria — **Desenhar · Inteligentes · Medir/Analisar · Exibição · Organizar** — cada item com ícone, nome, atalho e descrição curta, e **busca** por nome ou descrição (sem acento: "regua" acha Régua). O **alfinete** de cada item **fixa/tira da barra**: a barra vertical mostra só o que foi fixado (padrão: o conjunto de sempre), na ordem do usuário — arrastar as fichas em "Na barra", ou `Alt+←/→` com a ficha em foco, `Delete` tira; **Restaurar** volta à barra de fábrica. Fica no aparelho (`localStorage['gplansis.ferramentas.barra']`). Uma ferramenta escolhida no popover que não está fixada aparece num lugar **provisório** (contorno tracejado) antes do ⋯ enquanto estiver ativa. Teclado: foco na busca ao abrir, `↓` entra na grade, setas andam, `Enter` escolhe, `Esc` fecha e devolve o foco ao ⋯. Abre ao lado do widget no **lado livre** — testa direita e esquerda (afastado a folga do ímã da grade) e fica com o que menos cobre o que o organizador marca como ocupado (colunas, barra de vídeo, Seção da correia, Via); colado na esquerda, abre à direita. Sem lado que caiba (celular), abre como folha de baixo. O ⋯ aparece também com o widget **recolhido** (no celular ele nasce recolhido): o catálogo inteiro fica a um toque.

Ferramentas novas (out/2026), escolhidas depois de olhar CVAT, Label Studio, Roboflow Annotate, Fiji/ImageJ, Kinovea, Photoshop e Figma:

| Ferramenta | Tecla | O que faz |
|---|---|---|
| Polilinha | `⇧U` | Linha aberta de vários segmentos (CVAT polyline); `Enter`/duplo clique conclui; mede o comprimento total. |
| Seta | `⇧W` | Anotação apontando algo. |
| Círculo por 3 pontos | `⇧C` | Três pontos da borda → círculo (vira elipse editável, função **Medida**: área, perímetro e ⌀). |
| Pincel de máscara | `⇧D` | Pinta pixels (raio na faixa de opções): **máscara binária** guardada em RLE na caixa dela, editável (mover/redimensionar), com função ROI/exclusão/zona como qualquer área, **Máscara PNG** na lista (resolução da fonte). Com uma máscara selecionada, pinta nela. |
| Borracha de máscara | `⇧Y` | Apaga pixels da máscara selecionada (ou da que está sob o cursor). |
| Pontos-chave | `⇧Q` | Esqueleto COCO-17 (nariz, olhos, orelhas, ombros…): clique na ordem, a dica diz o próximo; `Enter` conclui antes; exportado no JSON. |
| Varinha mágica | `w` | Clique → região de cor parecida (Photoshop: tolerância por canal 0–255, padrão 32; **contígua** → polígono do contorno externo; **não contígua** → máscara com todos os pedaços). Com +Projeto ativo nasce como exemplo da classe ativa. |
| Segmentar com um clique (SAM) | `⇧S` | MobileSAM (o mesmo do CV-13, pela fila do ONNX): clique = ponto positivo, `⇧`+clique = negativo; cada clique só roda o decodificador (o codificador uma vez por quadro); `Enter` vira polígono editável, `Esc` cancela. |
| Encaixar na borda | `⇧N` | Alternância: vértices novos (polígono, polilinha, régua, ângulo, pontos…) e vértices arrastados vão para o gradiente (Sobel) mais forte num raio de ~9 px de tela. |
| Área e perímetro | `⇧G` | Polígono com função **Medida**: rótulo com área e perímetro (px², ou mm²/cm² com a régua calibrada). Qualquer área pode virar **Medida** na lista. |
| Perfil de intensidade | `⇧F` | Linha → cartão com R, G, B e cinza ao longo dela (Fiji: Plot Profile), CSV. Régua, linha e polilinha também têm **Perfil**. |
| Histograma da região | `⇧I` | Área → cartão com histograma RGB / HSV / cinza, média, desvio, mín e máx (matiz por média circular), CSV. Qualquer área tem **Histograma** na lista. |
| Distância entre objetos | `⇧J` | Dois cliques; clicar num objeto liga a ponta ao **centroide** dele e a medida segue quando ele muda. |
| Contador por clique | `k` | Cada clique conta 1 na classe ativa (Fiji: multi-point/cell counter); `1`–`9` trocam a classe, `⇧`+clique tira; **CSV do contador** na lista. |
| Cronômetro | `h` | Clique põe um cronômetro no instante atual — tempo do **quadro** do vídeo (arquivo) ou relógio de parede (ao vivo); clique nele para parar e de novo recomeça; **Volta** na lista (Kinovea: stopwatch). |
| Trajetória | `y` | Clique num ponto bem marcado: ele é seguido por correlação normalizada (modelo 17×17, busca ±28 px, sub-pixel) a cada quadro apresentado e o rastro mostra a velocidade (px/s ou m/s calibrado); clique de novo pausa; **CSV** com t, x, y. Pausa sozinho se perder o alvo (o motivo aparece na lista). |
| Grade de perspectiva | — | Quatro cantos de um plano → grade N×N em perspectiva (homografia), divisões na lista (Kinovea: perspective grid). |

Exibição (camada própria sobre o vídeo — **não** entra na captura PNG nem na gravação): **Grade/terços** `u` (terços → N×N → desligada; divisões na lista), **Lupa** `z` (pixels da fonte ampliados 2–8× junto do cursor), **Mira** `⇧Z` (cruz com x, y em px e mm), **Réguas nas bordas** (px ou mm da fonte, seguem o zoom e o espelho).

Organizar: `⇧`+clique com **Selecionar** soma à seleção (arrastar uma delas move todas); **alinhar/distribuir** como no Figma — `Alt+A` esquerda, `Alt+H` centro horizontal, `Alt+D` direita, `Alt+W` topo, `Alt+V` centro vertical, `Alt+S` base, `Alt+⇧H`/`Alt+⇧V` distribuir (3+); **cadeado** por marcação (🔒 na lista, `Alt+L`): travada não move, não edita e a borracha não apaga; **camadas** (`Alt+G` agrupa): a lista mostra os grupos com mostrar/ocultar e travar o grupo inteiro.

Clique direito (menu da marcação/área, [menu de contexto](#menu-da-tela-clique-direito)): **Histograma desta área**, **Perfil de intensidade**, **Área e perímetro** (balão com área, perímetro, centroide, caixa e circularidade), **Varinha mágica aqui** e **Segmentar o objeto aqui / da área (SAM)** (a área arrastada vira o prompt de caixa).

### Funções das marcações

Cada forma tem uma **função** (escolhida na lista) que controla o processamento:

- **Processar só aqui (ROI)** — o pipeline recebe o quadro com tudo o que está fora das ROIs pintado de preto (as coordenadas não mudam, então caixas e overlays seguem no lugar); o vídeo mostra o lado de fora escurecido e o selo **ROI ATIVA**. **Exclusão** faz o contrário (hachurada). A máscara é rasterizada só quando as marcações ou o zoom mudam; no quadro é um preenchimento por trecho de linha. Desligável em "Aplicar ROI e exclusão ao processamento".
- **Zona de contagem** — com o operador **Zonas e linhas** (`cena.zonas`, módulo **CV-37 Ferramentas de cena**) no Pipeline, conta os objetos da cadeia (caixas do detector, poses, mãos, rostos ou as caixas desenhadas) cujo ponto de referência (base da caixa ou centro) está dentro: ocupação atual e máxima, entradas e saídas e, com rastreio, tempo de permanência por ID. Filtro de classes por zona ("pessoa, carro") e no operador.
- **Cruzamento** — conta quem cruza a linha em cada sentido ("ida" = sentido da seta), por classe. Precisa de ID de rastreio: sem ele a lista avisa e oferece **Adicionar rastreio (ByteTrack)**.
- **Medida** — régua e ângulo ao vivo. Na lista, "esta régua mede X mm/cm/m" + **Calibrar** cria a escala px→mm usada pela régua, pelas áreas e por `ctx.marcacoes`.

Se houver zona ou linha e o operador não estiver no Pipeline, a lista oferece **Adicionar contagem ao Pipeline** (põe um detector, o rastreio quando há linha, e `cena.zonas`). Há também o grupo de presets **Ferramentas de cena** (*Contagem por zona e linha*, *Zonas — RF-DETR + rastreio*, *Zonas com pose (RTMO)*).

Os resultados aparecem no rótulo da própria marcação, na lista e na Telemetria. **CSV de eventos** exporta hora, marcação, evento (entrou / saiu com tempo / cruzou ida ou volta), classe e id; **Zerar contagens** recomeça.

### Lista de marcações

Nome, cor, função, visível, cadeado e apagar por forma; camadas (grupos) e a barra de alinhar quando há 2+ selecionadas; Histograma/Perfil, Máscara PNG, cronômetro (parar, recomeçar, voltas), trajetória (seguir/pausar, CSV) por tipo; ampliação da lupa e divisões da grade; filtro de classes nas zonas e linhas; inverter sentido na linha; calibração na régua. **Exportar/Importar JSON** (`formato: "gplansis.marcacoes"`) e **conjuntos** nomeados (um seletor no alto: o conjunto atual é salvo antes de trocar). Tudo é guardado no aparelho (`localStorage`, chave `gplansis.marcacoes.v1`).

### Para operadores (`ctx.marcacoes`)

O executor entrega a todo operador `ctx.marcacoes` (ou `null` sem marcações), já no espaço do quadro do pipeline:

```
{ itens: [{ id, nome, tipo, funcao, cor, classes, texto,
            pts: [[x,y]…] 0–1 do quadro, px: [[x,y]…] px do quadro,
            fonte: [[u,v]…] 0–1 da fonte inteira, caixa: {x1,y1,x2,y2} (áreas) }],
  roi, espelhado,
  escala: { mmPorPxFonte, pxFontePorPxQuadro, mmPorPxQuadro } }
```

Tipos novos em `itens`: `polilinha`, `seta`, `mascara` (área; `caixa` + a grade em `mq`: `{ bits, w, h }` cobrindo pts[0]→pts[1]; `dentro()` lê os bits; ROI/exclusão de máscara entram na máscara do quadro), `esqueleto`, `perfil`, `distancia`, `contador`, `cronometro`, `trajetoria`, `perspectiva`. A análise de pixels (histograma, perfil, varinha, SAM, encaixe, rastreio) mora em `js/cv/marcacoes-analise.js`.

`ctx.roiAtiva` diz se a máscara foi aplicada e `ctx.cena` traz os resultados de zonas e linhas para os nós seguintes. Os utilitários `dentro`, `lado` e `cruza` estão em `js/cv/marcacoes.js`.

## Temas

Três temas, escolhidos no menu do avatar (seletor **Tema**: Escuro · Claro · Code Dark, itens `menuitemradio` percorridos pelas setas como o resto do menu) e guardados em `localStorage['gplansis.theme']` = `dark` | `light` | `code`. O `app.html` aplica `<html data-theme>` antes de pintar (valor desconhecido vira `dark`); `color-scheme` é `light` só no claro. A página do **Treinar** (`/treino/`) usa a mesma chave: o botão do topo alterna em ciclo Escuro → Claro → Code Dark e mostra o tema atual (☾ / ☀ / `{ }`). Sem atalho de teclado: as letras com Shift livres ficam reservadas para as Ferramentas de mouse.

- **Escuro (iaVision)** — o padrão: verde-petróleo `#02302C`/`#04413C`, tinta `#FFFFFF`/`#CFEBE4`, sinal amarelo `#FFD84D`. Tokens em `css/app.css` (`:root`).
- **Claro** — para luz forte. `:root[data-theme="light"]` em `css/theme.css`; o sinal de interface vira o verde, o amarelo fica como preenchimento (botão primário).
- **Code Dark** — os cinzas do Visual Studio Code (Dark Modern / Dark+) com a identidade do iaVision: `:root[data-theme="code"]` no fim de `css/theme.css`.

| Token | Code Dark | Uso |
|---|---|---|
| `--bg` / `--bg-2` | `#1F1F1F` / `#181818` | página (editor e barra lateral do Dark Modern) |
| `--stage-bg` | `#1E1E1E` | palco do vídeo (o Viewport relê a variável quando `data-theme` muda) |
| `--panel` / `--panel-solid` | `rgba(37,37,38,.97)` / `#252526` | painéis, menus, cartões |
| barra do topo / Ferramentas | `#2C2C2C` / `#333333` | barra de título / barra de atividade |
| campos | `#313131`, borda `#3C3C3C`, foco amarelo | inputs e selects |
| `--line` / `--line-2` | `#3C3C3C` / `#2B2B2B` | bordas e separadores |
| `--ink` / `--ink-2` / `--ink-3` | `#CCCCCC` / `#BBBBBB` / `#ABABAB` | texto (o `--ink-3` passa 4,5:1 até sobre o campo `#3C3C3C`) |
| `--accent` / `--accent-ink` | `#FFD84D` / `#1E1E1E` | realce: estado ativo, foco, botão primário (texto escuro sobre o amarelo) |
| `--cyan` | `#4EC9B0` | secundária turquesa: links, em uso, ao vivo, info |
| `--warn` / `--err` / `--ok` | `#CCA700` / `#F48771` / `#89D185` | aviso âmbar (distinto do amarelo de realce), erro, sucesso |
| `--warn-bg/-line/-ink` | `#352A05` · âmbar .55 · `#E2C08D` | caixas de aviso |
| `--err-bg/-line/-ink` | `#3A1D1D` · `#F14C4C` .55 · `#F48771` | caixas de erro |
| `--ok-*` / `--info-*` | `#1E3320` · `#89D185` / `#14302B` · `#4EC9B0` | ok e informação |
| seleção / item selecionado | `#4A4430` / `#3A3520` + borda amarela | `::selection`, item de lista, opção do seletor |
| `--rolagem` / `--rolagem-2` | `rgba(121,121,121,.40)` / `rgba(100,100,100,.70)` | barra de rolagem do VS Code |

Estado ativo no Code Dark: botão da barra do topo e aba com fundo `#37373D` e filete amarelo embaixo (a aba ativa do editor); ferramenta ativa com fundo `#37373D`, ícone amarelo e o indicador lateral da barra de atividade; cantos mais secos (8 px nos painéis, 4 px nos botões — só o raio muda). Nada de azul como destaque.

As regras semânticas do claro (avisos, erro, ok, info, botão primário, tela de acesso, placeholder) valem também para o code — o seletor é `:root:is([data-theme="light"], [data-theme="code"])`, com a mesma especificidade de antes, então o claro não muda. Os Studios (BeltScan, CounterVision, Takt, Inspect, Vídeo, Bike Fit) e o Bike Fit 3D trocam a paleta pelos tokens próprios (`--bsc-*`, `--cvs-*`, `--tkt-*`, `--ins-*`, `--vde-*`, `--b3-*`, e os de `.sbf`); o palco dos canvases de BeltScan, CounterVision, Takt e Inspect vira `#1E1E1E` no code (nos outros temas continua `#02302C`). O canvas do Studio Bike Fit (o que vai para o PNG e para o vídeo gravado) mantém a identidade verde-petróleo em todos os temas.

Contraste (auditoria WCAG em 49 telas, 1440 e 390 px): **0** textos abaixo de AA no Code Dark.

## Atalhos de teclado

`Shift+F10`/tecla Menu menu da tela · `Alt/⌥` ao arrastar: sem grade nem ímã · `espaço` pausar · `c` comparar original/processado · `s` capturar PNG · `o` organizar painéis · `e` exportar · `⇧B` player (barra de vídeo) · `⌘/Ctrl+K` Via · `m` módulos · `d` modelos · `p` pipeline · `f` fonte · `t` telemetria · `a` acesso · `g` config · `x` contexto · `q` códigos · `l` legendas · `+`/`−`/`0` zoom · `←`/`→` quadro anterior/próximo · teclas de mídia do teclado → player do YouTube · ferramentas de mouse: `v` mover, `⇧V` selecionar, `r` retângulo, `⇧P` polígono, `⇧O` elipse, `⇧R` ROI, `⇧E` exclusão, `⇧L` linha, `⇧M` régua, `⇧A` ângulo, `n` ponto, `⇧T` texto, `i` conta-gotas, `⇧X` borracha, `⇧U` polilinha, `⇧W` seta, `⇧C` círculo 3 pts, `⇧D` pincel, `⇧Y` borracha de máscara, `⇧Q` pontos-chave, `w` varinha, `⇧S` SAM, `⇧N` encaixar, `⇧G` área e perímetro, `⇧F` perfil, `⇧I` histograma, `⇧J` distância, `k` contador, `h` cronômetro, `y` trajetória, `u` grade, `z` lupa, `⇧Z` mira, `.` mais ferramentas, `Alt+A/H/D/W/V/S` alinhar, `Alt+L` travar, `Alt+G` agrupar, `⇧H` mostrar/ocultar, `⇧K` lista, `Delete` apagar, `Ctrl/⌘+Z`/`Y` desfazer/refazer (ver [Ferramentas de mouse](#ferramentas-de-mouse)).

## Celular

Uma coluna de painéis abaixo da barra, menu ☰ (painéis e ferramentas) e menu do avatar (conta, ações, tema, sair), controles maiores para o toque. Fontes disponíveis: câmera (frontal/traseira), arquivo, RTMP; YouTube só para assistir.
