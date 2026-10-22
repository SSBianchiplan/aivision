# Educação, acessibilidade, mídia, agro e construção (CV-80 a CV-87)

Grupo de código **livres-u**:

- `js/cv/operators/livres-u*`
- `js/cv/runtime/livres-u/`
- `js/components/livres-u/`

Não há modelo novo: tudo é JS puro sobre o que a cadeia já produz (detector + rastreio, pose RTMO, mãos, malha do rosto, OCR, códigos, SAM 2), mais MobileCLIP2 e Whisper, que já existiam. Entram **8 módulos (CV-80 a CV-87) e 14 operadores**. Na fonte, depois do merge com as ondas 2-a/b/c, o total ficou em **83 módulos / 150 operadores**.

## Módulos e operadores

| Módulo | Operador / ferramenta | O que faz |
|---|---|---|
| CV-80 Laboratório de física (D1) | `fisica.trajetoria` | Segue um objeto de três formas: pelo SAM 2 (`ctx.track`), pela melhor detecção de uma classe (a mais perto da posição anterior) ou por uma cor HSV. Converte px → m pela régua calibrada (`ctx.marcacoes.escala.mmPorPxQuadro`) ou por mm/px manual. Usa o tempo do **vídeo** (preso ao quadro) e aceita fator de câmera lenta. Experimentos: queda/lançamento (ajuste de parábola por mínimos quadrados com t centrado → g, v₀y, vx, R²), pêndulo (período pelos cruzamentos interpolados → g = 4π²L/T²) e plano inclinado (a ao longo da direção principal, ângulo). v e a por parábola local em janela. No painel: tabela, 2 gráficos e CSV. |
| CV-81 Acessibilidade | `acessivel.falar` (X1) | Junta detecções, textos do OCR, códigos e a legenda do Florence (se houver) numa frase em pt-BR, com plural, gênero, posição (esquerda/frente/direita) e "bem perto". Fala pela `speechSynthesis` do navegador, dando preferência a uma voz com `localService`. Três modos: ao mudar a cena (a cena tem de ficar estável por N s), a cada intervalo, ou pelo botão grande do painel. |
| | `acessivel.mouse_cabeca` (X2) | Lê o yaw/pitch do `rosto.malha` e move um cursor DOM na página. A piscada longa dos dois olhos (EAR < 0,6 × EAR aberto, entre 0,4 e 1,2 s) clica no elemento sob o cursor. Olhos fechados por 2 s pausam ou retomam. Calibração de 5 posições (centro, esquerda, direita, cima, baixo), guardada no localStorage. Cursor suavizado por One Euro. Funciona só dentro da página. |
| CV-82 Libras — soletração (X3) | `libras.soletrar` | Normaliza os 21 pontos da mão (pulso na origem, escala pulso→base do médio, eixo para cima, mão esquerda espelhada) num vetor de 40 números. Regras para 13 letras estáticas (A B C D E I L O S U V W Y) e kNN (k = 3) com os **exemplos que o próprio usuário grava** no painel: 5 por clique, exportar/importar em JSON. A letra que fica estável por 0,7 s entra no texto. Para repetir a letra, é preciso trocar ou baixar a mão. Sem mão por 1,5 s, entra um espaço. **Limite declarado em toda parte:** só soletração; não reconhece sinais nem as letras com movimento (H, J, K, X, Z, Ç); não substitui intérprete. |
| CV-83 Sala de aula | `educacao.gabarito` (92) | OMR com folha-modelo própria: A4, 4 marcos pretos, matrícula de 0 a 8 dígitos, até 200 questões, de 2 a 8 alternativas, em 1 a 4 colunas. A **mesma** função de layout gera a folha (SVG/HTML imprimível) e é usada pelo leitor. Passos da leitura: acha os marcos (blobs quadrados e cheios), monta a homografia DLT folha→imagem, compara o escurecimento de cada bolha com um limiar entre o papel e o preto dos marcos, e decide (ok/branco/dupla/incerta). A folha só é registrada quando a leitura se repete N vezes. Calcula nota pela chave ("ABCDE…" ou "1A 2C…"; "*" anula a questão). CSV no painel. Usa `grabFull` (1800 px) quando há. |
| | `educacao.maos_levantadas` (94) | Mão levantada = punho acima do nariz, cotovelo alto, segurando por 0,5 s. Dá a contagem atual, o máximo, quantas vezes alguém levantou a mão e uma série por segundo. **Não identifica ninguém.** O preset borra os rostos. |
| CV-84 Mídia | `midia.corte_cena` (95) | Detecta corte de cena por histograma HSV 8×4×4 (Bhattacharyya) somado à miniatura cinza, com limiar adaptativo (k × mediana recente) e cena mínima. No painel há também uma varredura offline do arquivo, de 1/8 em 1/8 s. Os cortes vão como **marcadores para o editor**. |
| | `midia.miniatura` (96) | Nota de cada quadro = nitidez (variância do Laplaciano, normalizada pela maior já vista; as notas guardadas são **refeitas** contra a referência atual) + rosto (tamanho, regra dos terços, olhos abertos pelo `rosto.malha`) + exposição. Guarda os N melhores, a pelo menos 1 s um do outro. No painel: JPEG em resolução plena (o quadro do arquivo nesse instante) ou "No editor" (vai ao instante). |
| | Busca em vídeo (K4), painel | Extrai 1 quadro/s com um `<video>` oculto, gera o vetor do MobileCLIP2 (`mclip2-visual`, fila única do ORT) e grava o índice no IndexedDB (`gplansis-livres-u`/`indices`, chave nome+tamanho). Se houver transcrição, ela entra junto. A busca combina o cosseno imagem×texto (z-score dentro do vídeo) com as palavras da fala (sem acento). Clicar num resultado abre o editor no instante. |
| | Cortes por fala (M2), painel | O Whisper local (transformers.js vendorizado, mesmo ambiente do `engine-whisper`) roda sobre o **arquivo**: decodeAudioData → 16 kHz → janelas de 30 s com marcas de tempo. Se a saída do WebGPU vier com lixo (tempos vazios ou além do fim, texto demais para a duração, escrita não latina), refaz automaticamente no WASM. Saídas: SRT/VTT; capítulos por pausas + mudança de vocabulário (TextTiling simples) → marcadores no editor e texto no formato do YouTube; melhores trechos (densidade de fala + palavras-chave) → "Melhores trechos → timeline" (desfaz com Ctrl+Z). Também importa .srt/.vtt. |
| CV-85 Agro e pecuária | `agro.verde` (76) | ExG ou ExG−ExR nas cromáticas, por área "Agro · área de verde" (retângulo ou polígono). Limiar fixo ou Otsu. Dá a cobertura em %, pinta a máscara e guarda uma série. |
| | `agro.armadilha` (77) | Conta insetos dentro da área "Agro · armadilha". O fundo do cartão sai por blocos (percentil 70), o escuro passa por uma abertura morfológica (remove a grade impressa) e vira componentes. Insetos grudados são contados pela área típica. O mínimo pode ser em mm² (com a régua). Histórico por cartão. |
| | `agro.locomocao` (80) | Para cada ID de "vaca" que atravessa a cena, mede velocidade em corpos/s, CV do passo, paradas e balanço vertical do topo da caixa, e dá um escore de 1 a 5 com os motivos. **É indicador de triagem.** |
| | `agro.peso_dorsal` (A3) | Área dorsal na área "Agro · pesagem": Otsu com polaridade automática (fica a maior região que não toca a borda) ou a máscara do BiRefNet. Converte para m² pela régua e estima kg = a·A^b. A fórmula é manual ou calibrada com 3 ou mais pesagens reais (ajuste log–log). Aviso de **estimativa** no vídeo, no painel e no catálogo. |
| CV-86 Câmera de jogo (E1) | `jogo.camera` | O centro da jogada é 0,65 × bola + 0,35 × mediana dos jogadores, com memória da bola por 1 s. O zoom abre quando os jogadores se espalham. A suavização é a **`suavizarTrajetoria` do `components/video/seguir.js`, importada sob demanda** e aplicada numa janela deslizante de 4 s; o editor não foi alterado para isso. Sai o quadro reenquadrado (bilinear), que pode ser gravado. Com arquivo, o painel "Aplicar no editor" usa `keyframesDaAnalise` (seguir.js) e põe os keyframes do Seguir sujeito em cada clipe, na proporção pedida (16:9, 9:16, 1:1, 4:5). |
| CV-87 Diário de obra (C1) | `obra.diario` | Por hora do dia: máximo simultâneo de cada classe e entradas pela área "Obra · portão" (cada ID conta uma vez por dia). Foto a cada N minutos, ou pelo botão, em JPEG no IndexedDB; o preset borra rostos antes. O estado é salvo a cada minuto. No painel, o RDO em HTML pode ser aberto ou baixado; para PDF, usa-se a impressão do navegador. A **Via é opcional, com opt-in explícito** em duas caixas: o resumo numérico + campos; e, separadamente, até 3 fotos. A chamada vai direto do navegador para api.anthropic.com com a chave do próprio usuário (`via/base.js`), no modelo das preferências da Via. |

## Painel «Aplicações» (`components/livres-u/AplicacoesPanel.js`, `css/livres-u.css`, sob demanda)

- Id `aplicacoes`, na coluna direita.
- Reaproveita as classes `.med-*` de `css/medicoes.css` e o canal da onda 1-a: `cv/runtime/livres-u/canal.js` reexporta `publicar/ler/assinar/zerar…`, com chaves `u_*`, e acrescenta comandos painel→operador (`pedir`/`tomar`).
- Mostra uma seção por operador presente no Pipeline.
- Tem sempre, no fim, o bloco recolhível **"Ferramentas de vídeo — busca (K4) e cortes por fala (M2)"**, que usa o vídeo da Fonte ou um arquivo escolhido.
- Todos os presets abrem este painel.

## Ferramentas de mouse (registrarFuncao)

As funções novas aparecem só com o nó correspondente:

- `gabarito`
- `verde`
- `armadilha`
- `pesagem`
- `portao`

## Presets (`components/presets-onda2-d.js`)

Todos têm descrição; alguns têm marcações-modelo.

| Grupo | Presets |
|---|---|
| Laboratório e educação | Física: queda livre e lançamento (D1); Física: pêndulo (cor); Física: objeto marcado (SAM 2); Correção de gabarito (OMR); Mãos levantadas na sala |
| Acessibilidade (novo) | O que tem na minha frente? (voz); Mouse por cabeça e piscada; Libras — soletração |
| Mídia e criação | Corte de cena → marcadores no editor (95); Melhor quadro para miniatura (96) |
| Agro e pecuária (novo) | Índice de verde (76); Insetos em armadilha adesiva (77); Escore de locomoção de bovinos (80); Peso estimado pela área dorsal (A3) |
| Esportes e biomecânica | Câmera de jogo (segue a jogada) |
| Construção (novo) | Diário de obra automático (RDO) |

## Editor GPlanSiS|Vídeo — mudança mínima (documentada no cabeçalho de `ponte.js`)

**`components/video/ponte.js`:**

- `abrirEditorVideo()` agora também dispara `window` `aiv:video-pedido`, para que o editor já aberto atenda o pedido.
- O pedido pode trazer `depois({ v, clipes, marcadores, recorte, novoId }) → { marcadores?, clipes?, recorte?, irPara?, rotulo? }`, com tempos em µs da timeline.

**`components/video/StudioVideo.js`:**

- O efeito do pedido virou `atender()`, chamado na montagem e no evento.
- Se a mídia pedida é a mesma já aberta (mesmo Blob, ou tamanho + nome), não reabre.
- O `depois` é aplicado por `aplicar` (com desfazer).
- `novoId` passou a ser importado de `edl.js`.
- Foi preservado o 4º argumento `marcadores` de `abrir` (onda 2-b, CV-66). Com a mídia já aberta, esses marcadores também são somados.

O Viewport.js não foi tocado. O `seguir.js` e o `edl.js` não foram alterados, só importados.

Os helpers do lado do painel ficam em `components/livres-u/editor.js`:

- `arquivoDaFonte` (usa o nome `video-da-fonte`, o mesmo do editor, e reencontra a edição salva)
- `marcadoresNoEditor`
- `irNoEditor`
- `trechosNoEditor`
- `seguirNoEditor`
- `varrerVideo`
- `quadroEm`

## Testes — ferramentas em `/Volumes/Armazena2/zz-staging/onda2-d-tools`

- `serve.py`: COOP/COEP/CORP, mock de login e proxy com cache dos pesos.
- `run.mjs`: CDP.
- `testes/*.mjs`.
- `media/`: vídeo sintético de 24 s com 3 cenas e 3 falas em pt-BR (`say -v Luciana`), harness `ops.js`/`video.js`, gerador de mão `mao.js`.

### Node (núcleos sem DOM): 46/46

- **D1:**
  - g por queda a 30 fps com ruído de 2 mm: **erro de 0,11%** (tolerância 2%).
  - Pêndulo: T com erro < 0,01%, g = 9,811 (tolerâncias 1% / 2%).
  - Rampa a 20°: a = 3,355, ângulo 20,08° (tolerâncias 3% / 1°).
  - Derivadas locais conferidas.
- **X1:** frase exata, plurais, assinatura estável.
- **X2:**
  - Mapeamento calibrado com erro ≤ 0,005 da tela (tolerância 0,03).
  - Piscada de 0,15 s: ignorada. Piscada de 0,6 s: clica. Olhos fechados 2,5 s: pausa; na pausa, nenhum clique.
  - Calibração sem virar a cabeça: recusada.
- **X3:**
  - Regras: 13 letras × 20 mãos sintéticas (rotação ±17°, ruído 2%), **96,2%** de acerto.
  - kNN com 3 exemplos/letra, 20 letras: **97,3%** (a confusão é U↔R, esperada).
  - Mão esquerda espelhada dá o mesmo vetor.
  - O soletrador monta "AAB BA".
- **92:**
  - Folha de 30 questões com perspectiva, gradiente de luz e ruído: 27/27 respostas certas, 2 brancos e 1 dupla detectados, matrícula lida.
  - SVG com 190 bolhas e 4 marcos; parser da chave.
- **94:** mão abaixada, direita, ambas e "mão no rosto" (não conta).
- **76:** cobertura de 50,00% / 50,01% (tolerância 1 p.p.); círculo 26,7% contra 26,2%.
- **77:** 37/37 insetos com grade impressa e luz desigual (tolerância ±1).
- **80:** animal regular = escore 1; irregular + parada + balanço = 4.
- **A3:** área com erro de 0,07% (tolerância 2%); calibração recupera a e b (a com erro de 3,9%, b = 1,375; tolerâncias 5% e 0,05).
- **95:** cortes nos quadros **exatos** 75/125/185, sem falso positivo com panorâmica e flash.
- **96:** a nitidez ordena corretamente; rosto, olhos fechados e estouro pesam como devem.
- **K4:** busca por imagem, por fala e "ambos".
- **M2:**
  - 3 capítulos nas trocas de assunto (tolerância 5 s); melhores trechos com palavra-chave.
  - SRT com 2 linhas ≤ 42 caracteres e ida e volta SRT → `lerLegenda`; VTT.
  - Mídia → timeline e trechos → clipes.
- **C1:** tabela por hora, entradas sem dupla contagem, salvar/carregar, HTML escapado, resumo.

### Navegador, operadores com quadros de canvas e ctx sintético: 13/13

- **D1:** bola laranja desenhada, 2 mm/px: g = **9,808** (tolerância 3%), v₀y = 0,300.
- **92:** **SVG real da folha** desenhado no canvas, girado 3°: 19/20, branco e matrícula 2026 certos.
- **94:** uma mão (a de 0,3 s não conta).
- **76:** 50,00% na área marcada.
- **77:** 24/24 sobre a grade.
- **A3:** m² exato; após calibrar, kg com erro < 0,1%.
- **80:** escore 1.
- **C1:** pico 2, 2 entradas, foto no IndexedDB.
- **X1:** `speechSynthesis` interceptado: falou ao estabilizar e pelo botão.
- **X2:** calibração de 5 posições, cursor em (0,10; 0,10), piscada longa clicou num botão real da página.
- **X3:** "VLF " (V e L por regra; F com 5 exemplos gravados pelo comando do painel).
- **96:** melhor = o quadro sem borrão.
- **E1:** reenquadra com a suavização do Seguir sujeito (centro 0,795, esperado 0,79).

### Navegador, editor + modelos reais: 13/13

- **95:**
  - Varredura do mp4: cortes em **8,000 e 16,000 s**.
  - Abre o editor com 2 marcadores.
  - Pedir de novo com o editor aberto não duplica nem reabre.
- **K4/96:** "ir ao instante" chega a 12,5 s exatos.
- **M2:** 2 trechos montados (9,000 s) e Ctrl+Z desfaz.
- **E1:** keyframes do Seguir sujeito e recorte 9:16 no editor.
- **K4 com MobileCLIP2 real:**
  - 24 vetores em ~1,5 s, persistidos no IndexedDB.
  - O top-1 de cada cor e o maior cosseno médio caem no trecho certo.
- **M2 com Whisper base real:**
  - As 3 falas foram transcritas literalmente, com início em 0/8/16 s.
  - 3 capítulos em 0/8/16 s.
  - O melhor trecho com "capacete" é a 2ª fala.
  - A busca "capacete" na fala dá 8 s.
  - No Chrome headless (SwiftShader), o WebGPU devolveu lixo; o **fallback automático para WASM** entrou e acertou.

### App real

- Smoke da cópia e da **fonte depois da cópia**: registry carrega, sem IDs duplicados, os 16 presets aplicam sem nó desligado, o painel abre com as 13 seções, console limpo.
- Câmera falsa no laço real do Viewport: 12 presets rodando, todos publicam, sem erro.

## Limites e pendências

- **Libras:** só soletração estática. As regras são uma prévia validada com mãos **sintéticas**. Para uso real é preciso gravar exemplos, e o ideal é coletar com pessoas surdas.
- **Gabarito:** exige a folha-modelo do próprio sistema, com os 4 cantos visíveis, e a configuração da folha igual à do operador. Folha de terceiros não é lida.
- **Câmera de jogo:** só o reenquadramento. Os "lances com hora" (gols, rally) não foram feitos; dá para encadear a Quadra (CV-35).
- **M2:** legenda em SRT/VTT. O editor ainda **não queima legenda** no vídeo. A Via não escolhe trechos (a escolha é heurística local).
- **K4:** o CLIP responde melhor a frases em inglês. O índice é por mídia (nome + tamanho). Busca em vários vídeos ao mesmo tempo não foi feita.
- **X2:** só dentro da página do iaVision; o navegador não move o mouse do sistema.
- **X1:** "tudo local" depende de o sistema ter uma voz pt-BR local. Sem voz local, o Chrome pode usar uma voz de rede; o painel mostra "(local)" ou "(rede)".
- **95:** só cortes secos; fusões lentas não contam.
- **C1:** contagem por máximo simultâneo. A soma de IDs distintos por hora fica fora do RDO (troca de ID inflaria o número).
- **Agro:** o ExG em RGB não é NDVI; a locomoção é triagem; o peso é estimativa.
- O guia do ConfigPanel (o que é / quando usar / limites / custo) **não** foi escrito para CV-80..87, para não conflitar com outros agentes. As descrições ficam nos módulos e operadores.
- Avisos de console vistos só durante a transcrição: "Unable to determine content-length" (transformers.js baixando do Hugging Face) e "VerifyEachNodeIsAssignedToAnEp" (ORT). Os dois já existem com o motor Whisper atual.
