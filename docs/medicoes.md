# Medições: tráfego, instrumentos, segurança, sprint e logística (CV-41 a CV-45)

Grupo de código **livres-oa** (`js/cv/operators/livres-oa*`, `js/cv/runtime/livres-oa/`). JS puro, sem modelo novo, nada sai do navegador. Módulos **CV-41 a CV-45**, mais `cena.mapa_calor` no CV-37. O total vai a **45 módulos / 91 operadores**.

## Módulos e operadores

| Módulo | Operador | O que faz |
|---|---|---|
| CV-41 Tráfego (CVC) | `trafego.cvc` | Contagem volumétrica classificada (carro, moto, ônibus, caminhão, bicicleta, pedestre). Conta por **movimento**: a primeira zona em que um ID entra é a origem, a próxima zona diferente é o destino. Conta também cada linha por sentido. Blocos de 15 min (ajustável). A classe de cada ID é a mais votada ao longo da trajetória. Gera a matriz de giro e dois CSV: blocos × movimento × classe, e um registro por veículo. Os IDs que têm origem e somem sem destino contam como "sem destino". Cadeia: `rfdetr.detect` → `track.bytetrack` → `cena.zonas` → `trafego.cvc`. |
| CV-42 Instrumentos | `instrumento.mostrador` | Manômetro e outros mostradores de agulha. A marcação é um **Ângulo de 3 pontos** com a função "Instrumento · mostrador" (zero → centro → fundo de escala). Sentido horário ou anti-horário. A faixa sai do nome da marcação ("Pressão 0-10 bar") ou dos parâmetros. A agulha é achada pelo gradiente Sobel, com votos de Hough só nas retas que passam pelo centro (anel de 0,15R a 0,75R, longe dos traços), em passos de 0,5° com refino parabólico. O valor é a mediana de 5 leituras. Guarda histórico e tem alarmes ISA-18.2 (texto "HH 9; H 8; L 1; LL 0,5", banda morta em %, atrasos de ativação e normalização). |
| | `instrumento.display7` | Display de 7 segmentos numa área com a função "Instrumento · display 7 seg.". Usa o V do HSV com limiar de Otsu e descarta os componentes que tocam a borda (moldura). Separa os dígitos pela projeção de colunas e testa 7 janelas por dígito. Reconhece ponto decimal, sinal "−" e itálico (parâmetro de inclinação). Aceita um valor só depois de 2 leituras iguais seguidas. Tem os mesmos alarmes do mostrador. |
| CV-43 Segurança por pose (indicador de gestão) | `seguranca.cerca_keypoint` | Zona proibida (área "Segurança · zona proibida") para mãos, pés ou cabeça. A mão é o punho prolongado 35% do antebraço. Tem tempo mínimo dentro e tempo fora para encerrar (histerese). Cada combinação zona × pessoa × parte é um alarme ISA-18.2, e os eventos vão para o CSV de cena. |
| | `seguranca.queda` | Detecta três situações: **queda** (o quadril desce mais de 1,8 troncos/s e a pessoa fica deitada em até 1,5 s), **no chão** (deitada por 10 s) e **imobilidade** (os pontos se movem menos de 0,08 tronco em 15 s). Calcula em px para não distorcer pelo formato do quadro. |
| | `seguranca.ponto_encontro` | Na evacuação, mostra quem está nas zonas (ou as chegadas por ID) contra a meta: "faltam N". |
| CV-44 Fotocélula virtual | `esportes.sprint` | Duas ou mais linhas com a função "Esportes · fotocélula". O ponto de corte é o tronco ou o quadril do RTMO. O instante do corte é interpolado entre os quadros pela distância de cada um à linha. Dá parciais e velocidade por trecho: as distâncias vêm do texto "0; 10; 20" ou da régua calibrada. No modo agilidade (ida e volta), a prova fecha ao voltar à 1ª linha ou após N travessias. Se a pose se repete entre inferências, a amostra é ignorada. |
| CV-45 Logística e mídia | `logistica.etiqueta` | Procura a chave de acesso de 44 dígitos (NF-e, NFC-e, CT-e, MDF-e) no código de barras e no OCR. Confere o dígito verificador (módulo 11), a UF IBGE e o CNPJ/CPF do emitente. Abre os campos: série, número e mês. Lê também o rastreio dos Correios com dígito conferido (pesos 8 6 4 2 3 5 9 7) e o CEP. Não consulta a SEFAZ. |
| | `logistica.pallet` | Cada QR, DataMatrix ou SSCC lido é um pallet; a zona onde ele aparece é o local. Gera a tabela de local e "desde", e um evento a cada movimentação. Republica os códigos como objetos com ID. |
| | `midia.tempo_tela` | Soma o tempo em que cada ferramenta `inspect.*` da cadeia deu OK (por exemplo, o molde do LOGO). Conta as exposições acima de uma duração mínima, com tolerância a falhas curtas, e guarda a mais longa. |
| CV-37 (cena) | `cena.mapa_calor` | Versão genérica do mapa de calor da Quadra. Os pontos dos objetos da cadeia (pés ou centro) somam **segundos** numa grade sobre a imagem, com núcleo gaussiano. Tem meia-vida opcional e pode contar só dentro das zonas. Usa a mesma rampa de cor da Quadra. Pinta a imagem, então o calor aparece também na gravação. PNG e CSV no painel. |

**Aviso NR-12:** todos os operadores do CV-43 trazem o aviso no `desc`, numa faixa fixa no vídeo, no painel Medições e no catálogo: são indicadores de gestão, **não** são função de segurança.

## Painel «Medições» (`components/MedicoesPanel.js`, `css/medicoes.css`, sob demanda)

Uma seção aparece para cada operador no Pipeline:

- **Tráfego:** cartões por classe, matriz de giro filtrável por classe, tabela por bloco, CSV de blocos e de eventos, botão Zerar.
- **Instrumentos:** valor, sparkline, alarmes ISA-18.2 com "Reconhecer", CSV de leituras e de alarmes.
- **Segurança:** aviso NR-12, situação do ponto de encontro, cerca, pessoas com estado, alarmes e log, CSV.
- **Fotocélula:** tentativas com parciais e km/h, CSV.
- **Mapa de calor:** miniatura, PNG em resolução cheia, CSV.
- **Etiquetas, pallets e tempo de tela:** uma lista ou tabela de cada um.

O canal fica em `runtime/livres-oa/canal.js`. Ele publica no máximo 4×/s, e "Zerar" funciona por geração. A hora vem de `ctx.tempoS`, quando o hospedeiro ou um teste informa. Sem ela, usa o tempo do vídeo, preso ao quadro, ou o relógio, igual ao cronômetro das Ferramentas de mouse.

## Ferramentas de mouse

Entrou um registro genérico em `cv/marcacoes.js`: `registrarFuncao({ valor, rotulo, tipos, ops, cor, nome })`. Ele define funções novas que só aparecem no seletor quando há um nó correspondente no Pipeline. Funções registradas:

- `mostrador` (ângulo)
- `display7` (áreas)
- `cerca` (áreas)
- `sprint` (linha)

## Presets (`components/presets-onda1a.js`)

Os presets agora têm **descrição** (vira a dica do botão) e **marcações-modelo**. Ao aplicar um preset, as formas de exemplo nascem no lugar típico, mas só para as funções que ainda não têm nenhuma marcação. O preset também abre o painel do módulo. O `Panels.js` junta estes grupos aos que já existem.

| Grupo | Presets |
|---|---|
| Industrial | Rótulo: lote, validade e código (I5, modelo `rotulo` novo no Inspect); Extrusão: diâmetro contínuo (53, modelo `extrusao` com gatilho de intervalo de 1 s, Cpk no Studio Inspect); Mostrador analógico; Display de 7 segmentos; Ovos ou pintinhos em esteira (78) |
| Trânsito (novo) | CVC com matriz de giro (4 zonas N/S/L/O); CVC seção (linha) |
| Varejo (novo) | Fila do caixa, ocupação e mapa de calor (V2/Top 6); Mapa de calor da loja; Entrada e saída de clientes (72); Tempo de atendimento no balcão (73, zonas + Takt) |
| Segurança do trabalho (novo) | Sonolência PERCLOS (S4); Cerca mãos; Cerca pés; Pessoa caída e imobilidade; Ponto de encontro (71) |
| Logística (novo) | Pallet por QR (62); Etiqueta de transporte / chave NF-e (65) |
| Laboratório e educação (novo) | Colônias e células (D3); Quadro branco → texto (93) |
| Mídia e criação (novo) | Croma sem tela verde; Croma BiRefNet; Fundo desfocado (M4); Tempo de tela de logo (97) |
| Esportes e biomecânica | Fotocélula sprint; Fotocélula agilidade |

## Pequenas mudanças em arquivos que já existiam

- `code.scan` publica `ctx.codigos`.
- As ferramentas avulsas `inspect.*` publicam `ctx.inspecao`.
- `inspect.programa` ganhou os modelos `rotulo` e `extrusao`. O `MODELOS` aceita `trigger` e `lote`.
- O ConfigPanel ganhou o guia (o que é / quando usar / limites / custo) do CV-41 ao CV-45.

## Testes (ferramentas em /Volumes/Armazena2/zz-staging/onda1-a-tools)

- `serve.py`: COOP/COEP/CORP, simulação de /api/me e /api/login, pasta /__t/.
- `run.mjs`: CDP.
- `testes/*.mjs`: quadros sintéticos em canvas.
- `video/manometro.y4m`: vídeo para a câmera falsa.

Resultados:

- **Mostrador:** 39 leituras em 3 manômetros (270° horário; 240° anti-horário; pequeno com ruído forte). O pior erro foi **1,07% da escala**. No app real, com câmera falsa e vídeo sintético em degraus, o pior erro foi **0,77–1,01%** e os 6 degraus foram reconhecidos. O alarme H ativou com 1 s de atraso, voltou como "não reconhecido" e ficou NORMAL ao reconhecer.
- **Display 7 seg:** 12/12 casos certos (6 números, com e sem itálico).
- **Sprint:** 25, 30 e 60 fps, com ruído de 0,7 px. Erro máximo de **0,074 quadro (1,8 ms)**. Agilidade com erro de 0 quadro.
- **Cerca:** um toque de 0,2 s foi ignorado; a invasão de 1,5 s ativou em 3,5 s e normalizou em 5,5 s.
- **Queda:** a queda foi detectada em 3,7 s, "no chão" em 13,7 s e imóvel em 18,6 s. Uma pessoa andando não gerou nenhum evento. Uma pessoa deitando devagar não gerou queda.
- **CVC:** 18 movimentos de 6 classes contados exatos, com rastreio e zonas reais e 20% de troca de rótulo carro↔caminhão. 1 ID sem destino. A soma dos blocos bate.
- **Mapa de calor:** total de 19,8 s de presença, igual à soma da grade; pico na posição certa.
- **Chave NF-e:** dígito verificador conferido por uma implementação independente. A chave com um dígito trocado é rejeitada. O OCR em 2 linhas acha a chave sem falsos positivos. Correios: válido/inválido certos.
- **Pallet:** 1 movimentação, com histórico.
- **Tempo de tela:** 5,3 s e 2 exposições; a exposição de 0,3 s não conta.
- **Ponto de encontro:** "faltam 3" passa a "todos presentes".
- **E2E no app:** os 26 presets aplicados, as marcações-modelo criadas, o painel abre, nenhum nó desligado por erro, console sem exceções. Os únicos avisos são 404 de modelos que não estão na cópia local.

## Limites e pendências

- O campo `icone` dos módulos ainda não é exibido em nenhum lugar (landing e módulos).
- O tempo do sprint depende de a pose sair a cada quadro. Com a inferência atrasada, a hora usada é a do quadro em que o resultado chegou.
- A CVC só conta um movimento por ID. Quando o rastreio reaproveita um ID, o veículo não conta.
- O mostrador supõe escala linear.
