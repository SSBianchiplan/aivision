# Industrial — volumetria de correia (GPlanSiS|BeltScan, CV-36)

O módulo **Industrial** reúne as medições industriais do iaVision. O primeiro é a **volumetria de correia transportadora**, portada do **GPlanSiS|BELTSCAN v4** (HTML standalone + programa de borda em Python/OpenCV, SPEC-GPS-BSC-001). Uma linha laser é projetada transversalmente sobre a correia; a câmera, inclinada, vê a linha subir onde há produto. Pela triangulação com a geometria da câmera, cada coluna da imagem vira uma altura em mm; o perfil vira seção, a seção vira vazão, massa e alarmes.

Tudo roda no navegador, em JS puro sobre `ImageData` (runtime `client`, sem modelo ONNX). Nada da imagem sai do aparelho.

| Peça | Arquivo |
|---|---|
| Núcleo numérico (extração, geometria, DIN 22101, análise, bancada, alarmes, motor) | `js/cv/runtime/livres-k/beltscan.js` |
| Ponte operador ↔ telas, perfis, tempo da fonte, ensaios | `js/cv/runtime/livres-k/canal.js` |
| Operador `beltscan.volumetria` (grupo CV-36) | `js/cv/operators/livres-k/beltscan.js`, registro em `js/cv/operators/livres-k.js` |
| Hub **Industrial** (cartões) | `js/components/industrial/IndustrialPanel.js` |
| Painel **BeltScan** | `js/components/industrial/BeltScanPanel.js` |
| Tela cheia **GPlanSiS\|BeltScan** | `js/components/industrial/StudioBeltScan.js` |
| Configurar (abas) | `js/components/industrial/BeltScanConfig.js` |
| Desenhos e ações comuns | `js/components/industrial/beltscan-comum.js` |
| Estilo (tema claro e escuro) | `css/industrial-beltscan.css` |
| Ensaios gravados (vídeo + configuração) | `amostras/beltscan/` (`feijao1..3.mp4/.json`, `ensaio_bancada.mp4`) |

Painéis e tela cheia são carregados sob demanda (`SobDemanda.js`), como os de Esportes. Entradas: botão **Industrial** da barra (painel `industrial`), preset **Industrial › Volumetria de correia (BeltScan)** do Pipeline.

## 1. Modelo

Referencial da correia: origem no topo do rolo central, no plano do laser; câmera em (0; −b; H_c) com o eixo óptico inclinado α em relação à vertical.

```
φ = atan(s·(v − c_v) / f_px)         desvio do raio em relação ao eixo óptico (s = ±1, sentido de v)
θ = α + φ                            ângulo do raio em relação à vertical
z = H_c − b / tan θ                  altura do ponto no plano do laser
x = (u − c_u)·b·cos φ / (f_px·sen θ) posição transversal
dz/dv = b·cos²φ / (f_px·sen²θ)       resolução em altura (mm por pixel)
mira α = atan(b/H_c)                 sombra = h·tan θ
f_px = f·1000/pixel  ou  (W/2)/tan(HFOV/2)
```

A altura de cada coluna é `h = z(v_linha) − z(v_referência)`, com o giro da câmera corrigido (`v − (u − c_u)·tan(giro)`).

**Calha (DIN 22101):** b útil = 0,9·B − 0,05; `A1 = (l3 + (b − l3)·cos λ)²·tan β / 6`; `A2 = (l3 + (b − l3)/2·cos λ)·((b − l3)/2·sen λ)`; na rampa, `k_δ = √((cos²δ − cos²β)/(1 − cos²β))`; `A_th = k_δ·A1 + A2` (0,299 m² para B 1600, rolos 600, λ 45°, β 20°, δ 15°).

**Correia:** `Q = A·v·3600` (m³/h, × cos δ se o plano do laser não for perpendicular), `ṁ_seca = Q·ρ·(1 − U)/1000` (t/h). O perfil medido na bancada é levado à calha pela escala `λ = largura da calha / largura medida` (ou fixa) e pelo ganho de altura (≠ 1 só para demonstração — a tela avisa).

**Bancada (medição real, 1:1):** seção em mm² pela triangulação × velocidade do papel medida por **correlação de fase** (o mesmo algoritmo do `cv2.phaseCorrelate`) numa faixa logo abaixo da linha, convertida para mm por `d(v) = H_c·tan θ(v)`; vazão em cm³/s; volume integrado por ciclo do vídeo (a volta do vídeo fecha o ciclo e guarda o anterior).

### Cadeia por quadro

1. **Extração** (nucleo.py): excesso de vermelho `r − ⌊(g + b)/2⌋` (ou cinza), desfoque gaussiano 3×3 bit-exato em uint8, top-hat vertical (abertura 1×k, van Herk/Gil-Werman), pico por coluna — com referência, só em ±`max_shift_px` dela —, centroide subpixel com meia janela e limiar/2 subtraído, validade por limiar e contraste (`pico ≥ k·mediana + 5`, mediana por histograma), despike por mediana móvel.
2. **Alturas** (beltscan.py › heights): exclusões, rejeição fora da faixa, filtro temporal opcional por coluna, cobertura (QI-105).
3. **Análise** (correia.py › LevelAnalyzer): mediana de 7 colunas e rejeição > 50 mm, corte negativo, seção com dx mediano, zeragem abaixo de 0,3 % de A_th, filtro de 1ª ordem τ, enchimento LI-101, centralização ZI-103, pico AI-102, vazão, massa, totais.
4. **Nível representativo e portão:** o maior nível que ocupa pelo menos a largura mínima da calha (4 %); o portão "acima da altura limite" entra com excesso > 0 e sai abaixo de −histerese.
5. **Alarmes ISA-18.2** (seção 4) e **bancada** (fluxo e volume).

Quadros: o operador pede o quadro em resolução plena (`ctx.grabFull`, até 1280 px por padrão), porque ROI, referência e calibração estão em pixels da câmera. Com arquivo, o tempo é o do **vídeo** (`currentTime`): quadro repetido não é processado de novo e vídeo pausado não acumula vazão nem volume. Com YouTube pausado ou histórico parado, `ctx.fonteParada` (cv/runtime/parado.js) trava o processamento. Espelho: as colunas são lidas desespelhadas.

Desempenho medido (Node 24, M-series): ~11 ms por quadro a 1280×720 (extração ~6 ms, correlação de fase ~4 ms, resto < 1 ms), sem alocação por quadro (typed arrays reaproveitados). No Chrome, isolado: ~13 ms.

## 2. Configuração ("beltscan/4")

O JSON é o mesmo do HTML e do Python (`python beltscan.py --config arquivo.json`): importar/exportar na aba **Arquivo**.

| Bloco | Conteúdo |
|---|---|
| `extraction` | modo de cor, limiar, contraste, centroide, top-hat, faixa de busca, despike, ROI, quadros e modo da referência (mediana de quadros, ou envelope + ajuste), exclusões |
| `geo` | H_c, b, α, campo de visão, f, pixel, sentido de v, giro, modelo da câmera, α automático |
| `cal` | altura do bloco, quadros, deslocamento mínimo, ajuste de b, pontos |
| `belt` | B, rolos, acamamento, sobrecarga, rampa, plano perpendicular, velocidade, densidade, umidade, setpoint |
| `mapping` | escala bancada → correia (0 = automática), ganho de altura |
| `analysis` | τ, zeragem, mediana, rejeição, limite negativo, janela do pico, faixas de qualidade, filtro temporal |
| `bench` | fonte da velocidade, faixa do fluxo óptico, ruído, densidade, zerar por ciclo |
| `limit` | referência (camada ou cota), altura limite, largura mínima, histerese, camada mínima |
| `alarms` | por tag: tipo, habilitado, exige altura, prioridade, limite, banda morta, retardos, texto, ação |
| `ui` | tema, janela da tendência; o iaVision acrescenta `frame_w`/`frame_h` (resolução da configuração; o Python ignora) |
| `ref_rows` | linha da referência vazia por coluna |

**Perfis.** Cada ensaio (Feijão 1, 2, 3, Bancada), a "Minha linha" e os perfis criados pelo usuário têm a sua configuração salva neste navegador (`localStorage aiv.beltscan.cfg:<perfil>`). Os ensaios partem do JSON de `amostras/beltscan/` (os de `python/configs`, com a referência já capturada); "Restaurar original" volta a ele.

**Resolução.** Se a fonte tiver outra resolução que a da configuração, ROI, exclusões, referência, pontos de calibração e faixa de busca são reescalados (e a tela avisa).

**Predefinições:** bancada com ganho 8× (demonstração, limite 250 mm); bancada em escala geométrica (1×, limite 30 mm); ensaio com feijão (BCC950, b 250, H_c 210, envelope + ajuste); geometria de campo da SPEC (H_c 950, b 350, α 20,2°, f 4 mm, pixel 5,86 µm, mono, limite por cota 424 mm); alarmes de diagnóstico sem exigir altura.

**Câmeras:** Logitech BCC950 (HFOV 70,42°: f_px = 640/tan 35,21° = 907 px em 1280×720) e Daheng IMX249 + 4 mm (campo). A aba **Câmera** mostra os controles que o driver expõe (exposição manual é obrigatória).

## 3. Calibração

1. **Referência vazia** (botão): mediana de N quadros com a área vazia, ou **envelope + ajuste** — o lado vazio da linha ao longo de 30 quadros e uma reta (ou polinômio) ajustada só nos pontos da superfície, descartando o material (aceita produto na linha). Com "α automático", α = θ0 − atan((v_ref − c_v)/(s·f_px)), θ0 = atan(b/H_c), v_ref no centro da faixa.
2. **Blocos**: com um bloco de altura conhecida sob a linha, "Calibrar com bloco" guarda (v_ref, v_bloco, h). O ajuste varre α de 2° a 85° (0,25°) nos dois sentidos de v — e b de 0,4× a 2,5× se ligado, com 2+ blocos — e refina α a 0,005°. Mostra o erro rms e máximo.
3. **Giro**: "Aplicar giro" estima o giro da câmera pela inclinação da referência.
4. **Limiar automático**: 40 % da mediana dos picos da linha.
5. **Faixa de busca e exclusões**: arraste sobre a imagem da câmera na tela cheia (Shift + arrastar = zona de exclusão), ou digite na aba Extração.

## 4. Alarmes ISA-18.2

| Tag | Tipo | Valor | Padrão (feijão) |
|---|---|---|---|
| HI-101 HH / H | excess | excesso do nível representativo sobre a altura limite (mm) | 80 / 25 (40 / 15) |
| LI-101 HH / H | fill | enchimento da seção (%) | 95 / 85 |
| AI-102 | peak | pico local sobre a média de 21 colunas (mm) | 90 (60) |
| ZI-103 | center | carga descentralizada (% de B), só com enchimento > mínimo | 4 |
| FI-104 | mdry_dev | massa seca fora do setpoint (±%) | 10 |
| QI-105 | coverage_low | cobertura de colunas abaixo de (%) | 85 |

Cada alarme tem **limite, banda morta, retardo para ativar, retardo para normalizar, prioridade (P1–P3), "exige altura"** e pode ser desligado. Estados: NORMAL → ATIVO_NR (pisca) → ATIVO_R (reconhecido) → NORMAL, ou ATIVO_NR → RTN_NR (voltou sem reconhecer) → NORMAL ao reconhecer. Com "exige altura", o alarme só entra com o produto acima da altura limite **e** o valor acima do limite do alarme, e normaliza na hora quando o nível volta abaixo do limite. **Shelving**: suprimir por 10 min tira o alarme do anúncio (lista e faixa da tendência) sem parar a avaliação; o histórico registra. **Reconhecer**: botão na lista de alarmes ou no painel. O **histórico** (hora, tempo do vídeo, prioridade, tag, evento, valor, nível) é exportável em CSV. **Gravar CSV** grava as tags por quadro (mesmas colunas do HTML); **Salvar imagem** baixa a imagem da câmera com a linha e o limite.

## 5. Tela cheia GPlanSiS|BeltScan

Barra: perfil, ensaios (Feijão 1/2/3, Bancada — abrem o vídeo como arquivo na fonte do app, com a configuração), qualidade (BOM/INCERTO/RUIM/SEM REF), mensagens, **Configurar** (abas Extração, Geometria, Bancada, Calibração, Correia, Limite, Análise, Alarmes, Câmera, Arquivo). Corpo: câmera com a linha laser e a altura limite projetada; seção da correia (rolos, acamamento, contorno teórico, excesso em vermelho, barra LI-101, portão); indicadores (bancada: mm², mm/s, cm³/s, cm³, g; correia: m², %, m³/h, t/h seca, m/s, nível, qualidade) e as tags; perfil de altura; tendência com alarmes no topo (clique = ir ao instante); alarmes ativos e histórico; triangulação (vista lateral, f_px, dz/dv, faixa z, sombra e a referência de campo da SPEC). A barra de vídeo do app continua sendo o controle de reprodução (fica por cima).

## 6. Validação

### Teste sintético (porte do `test_sintetico.py`)

Linha renderizada pela própria triangulação (α 30°, b 260, H_c 420), começando com α 24° e sentido errado, dois blocos (10 e 25 mm):

| | Python | JS |
|---|---|---|
| α ajustado / sentido | 30,06° / −1 (rms 0,025 mm) | 30,06° / −1 (rms 0,02 mm) |
| bloco de 18 mm | 17,98 mm, cobertura 1,00 | 17,99 mm, cobertura 1,00 |
| A_th DIN 22101 | 0,2988 m², k 0,654 | 0,2988 m², k 0,654 |
| campo SPEC | mira 20,2°, dz/dv 4,26 mm/px | mira 20,2°, dz/dv 4,26 mm/px |
| faixa 1000 × 200 mm | A 0,1998 m², LI-101 66,9 % | A 0,1998 m², LI-101 66,9 % |

A correlação de fase foi comparada com o `cv2.phaseCorrelate` (OpenCV 5.0) em 5 bandas aleatórias: deslocamento e resposta idênticos em 4 casas (inclusive o detalhe do OpenCV de não aplicar a janela de Hanning quando não há preenchimento).

### Ensaios (volume da bancada no vídeo inteiro)

`beltscan.py --video ... --config configs/feijaoN.json --headless` (OpenCV 5.0, numpy 2.5) contra o núcleo JS no Node, quadro a quadro, com os mesmos quadros decodificados pelo ffmpeg, e no Chrome (vídeo decodificado pelo navegador, 0,25× para analisar todos os quadros, volume do ciclo FQ-202):

| Ensaio | Python | JS (Node) | Δ | JS (Chrome) | Δ |
|---|---|---|---|---|---|
| Feijão 1 (354 quadros) | 618 cm³ | 618,1 cm³ | +0,0 % | 625,3 cm³ | +1,2 % |
| Feijão 2 (499 quadros) | 494 cm³ | 498,0 cm³ | +0,7 % | 499,7 cm³ | +1,2 % |
| Feijão 3 (441 quadros) | 305 cm³ | 302,3 cm³ | −0,8 % | 306,5 cm³ | +0,5 % |
| Bancada (626 quadros, padrão ganho 8×) | −133 cm³ | −134 cm³ | +0,5 % | −132,2 cm³ | −0,9 % |

Por quadro (Node × Python), feijão 1–3: seção na correia AI-101 com diferença média de 0,0–0,3 %; seção da bancada 0,02–0,4 %; velocidade do fluxo 0,1–0,8 %; cobertura QI-105 < 0,2 %. O LEIAME cita ≈ 600, 490 e 290 cm³ (versões anteriores do Python); os valores acima são do Python do pacote rodado aqui.

**Por que não é idêntico.** O núcleo reproduz o Python passo a passo (inclusive os arredondamentos de uint8 do OpenCV), mas o vídeo decodificado não é bit a bit o mesmo: OpenCV, ffmpeg e Chrome convertem YUV → RGB com caminhos diferentes (matriz, faixa, arredondamento). Uma diferença de 1 nível no vermelho muda o centroide da linha em centésimos de pixel e, perto do limiar, a validade de algumas colunas; a velocidade do papel (correlação de fase) é a grandeza mais sensível, e o volume é a integral de seção × velocidade. Na bancada (ganho 8×, referência capturada nos primeiros quadros, vídeo BT.709 em faixa limitada), a diferença da seção chega a ~3 % porque a própria referência é capturada da imagem decodificada; o volume é negativo nos dois porque o objeto vai e volta sob a linha.

**Pese o material para validar** (feijão a granel ~780 kg/m³, a confirmar).

## 7. Cuidados

- Geometria nominal até medir e calibrar com blocos. A resolução na correia de campo é 4,26 mm/px com α 25° (mira real 20,2°).
- Velocidade, densidade e umidade da correia são provisórias até encoder, balança e analisador.
- Ganho de altura ≠ 1 é demonstração (faixa âmbar na tela).
- Zoom digital da fonte recorta o quadro e muda c_u/c_v: use zoom 1× (abrir um ensaio já zera).
- A velocidade por fluxo óptico precisa de textura (papel, grãos) na faixa abaixo da linha; sem textura a confiança cai e o último valor é mantido (como no Python).

## 8. Widget "Seção da correia" (sobre o vídeo do app)

`components/industrial/WidgetSecaoCorreia.js` (+ `.bss*` em `css/industrial-beltscan.css`), montado
pelo workspace sob demanda só quando há um nó `beltscan.volumetria` **ligado** no Pipeline.

- Conteúdo: o mesmo desenho da tela cheia (`desenharCorreia` em `beltscan-comum.js`: rolos,
  acamamento DIN 22101, perfil do material, altura limite com H/HH, excesso em vermelho, barra
  LI-101), a faixa do portão (vermelha acima da altura limite, com os alarmes ativos) e seis
  indicadores: seção m², vazão m³/h, massa seca t/h, nível rep. mm, qualidade (cobertura) e m/s.
- Redesenha só quando o canal publica (≤ 4×/s) ou o tamanho muda (ResizeObserver) — sem rAF.
  Com a tela cheia aberta ele some (e não redesenha).
- Punho ••• (arrastar; duplo clique devolve ao lugar), botão recolher (faixa fina com m², m³/h,
  mm, selo de qualidade e de alarme), ✕ (fica fechado até o nó ser removido/readicionado, ou o
  botão "Seção da correia" do painel BeltScan reabrir), canto para redimensionar (mín. 260×180).
  Posição/tamanho/estado em `localStorage` (`aiv.beltscan.secao.*`). Nunca acima da barra do
  topo; no celular (≤ 480 px) nasce recolhido e ocupa a largura útil.
- Qualidade RUIM (cobertura de colunas baixa = sem linha laser) mostra a dica "Sem linha de laser
  detectada — …".
- Botões: "Editar na imagem" (abaixo), "Abrir Studio" e "Configurar" (abre a tela cheia já na aba
  Extração: `abrirStudioBeltScan({ configurar })` → `tomarPedidoConfigurar()` na StudioBeltScan).
- O Studio também tem destaque: "⛶ Abrir Studio BeltScan" no painel BeltScan e no cartão do hub
  Industrial; o preset "Industrial" do Pipeline abre o painel BeltScan.

## 9. Editar faixa de busca, exclusões e velocidade na imagem do app

As três regiões viram marcações das ferramentas de mouse (`cv/marcacoes.js`) com funções próprias,
oferecidas no seletor da lista de marcações só com um nó BeltScan no Pipeline:

| Função | Forma | Configuração |
|---|---|---|
| `bs_busca` "BeltScan · faixa de busca" (azul tracejado) | retângulo | `extraction.roi` |
| `bs_exclusao` "BeltScan · exclusão" (hachurado vermelho) | retângulo/polígono | `extraction.exclude` (só a extensão horizontal: a exclusão é por coluna) |
| `bs_velocidade` "BeltScan · faixa de velocidade" (verde) | retângulo | `bench.flow_near_px`/`flow_far_px` (bordas de cima/baixo a partir da linha de referência; a largura segue os 70 % centrais da faixa de busca, como no `_fluxo`) |

Essas funções **não mascaram** a imagem (o executor só mascara `roi`/`exclusao`).
"Editar na imagem" (widget e painel) cria ou atualiza as marcações a partir da configuração,
seleciona a faixa de busca, liga Selecionar/editar e mostra no vídeo "arraste as alças · solta =
aplica · Enter ou ✓ conclui".

Sincronia (`cv/runtime/livres-k/beltscan-marcas.js`): o operador chama `sincronizar` a cada quadro
— configuração mudou por fora (tela cheia, campos, perfil, importar JSON) → as marcações seguem;
uma marcação mudou e nenhuma alça está sendo arrastada (`rt.arrastando`) → a configuração recebe
só o que mudou (mexer na faixa de busca não arrasta a de velocidade). Com o vídeo pausado (o
pipeline não roda), uma assinatura das marcações aplica e reprocessa o último quadro, e uma
assinatura do canal leva mudanças da configuração para as marcações. Os campos da aba Extração/
Bancada mostram "definido na imagem". O JSON "beltscan/4" não muda: as marcações viram os campos
normais (salvar no perfil, exportar e importar seguem compatíveis). Linha de referência e altura
limite **não** viraram marcações: a referência é capturada (não desenhada) e a altura limite é em
mm na correia, não uma posição fixa na imagem.

---

## 10. Tempo de posto — GPlanSiS|Takt (CV-39)

Porte do GPlanSiS|Takt (takt.gplansis.com, worker de visão em `/opt/takt/vision/worker/`) para o
navegador, no hub Industrial. Grupo **livres-m**, módulo **CV-39 "Industrial — tempo de posto
(Takt)"**, operadores `takt.posto` e `privacidade.borrar_rostos`. Nenhum modelo novo: usa a pose
multi-pessoa que o app já tem (RTMO, CV-18) — por isso não há `models-livres-m.js` nem mudança em
`onnx.js`.

### 10.1 O que veio do Takt

| Takt (Python) | iaVision (JS) | Observação |
|---|---|---|
| `pose_features.py::ActivityScorer` | `runtime/livres-m/takt-nucleo.js · ActivityScorer` | porte fiel: 0,55·mãos na ROI + 0,35·movimento dos punhos (÷ torso, satura em 0,18/quadro) ·(0,4+0,6·mãos) + 0,10·orientação; janela de 10 amostras |
| `event_manager.py::EventManager`, `contabilizar` | `EventManager`, `contabilizar`, `kpiJanela` | porte fiel: histerese 0,55/0,35, confirmações 4/45/20/3 s que **retroagem** ao início do candidato, pose ilegível → não observado, watchdog; + `definirPostos` (postos mudam com a sessão andando) |
| `bancada.py::PARAMS_BANCADA` | tempos "Bancada de teste" (2/8/5/2 s) | escolha em Configurar |
| `turnos.py::Agenda` | `Agenda` (Intl, fuso da planta) | turno que cruza a meia-noite pertence ao dia em que começa; pausa da madrugada no dia seguinte; sem turnos = mede sempre |
| `geometry.py` (`Homography.from_points`, `point_in_polygon`, `distance_to_polygon`) e `calibracao.py` | `homografia`, `paraPiso`, `pontoNoPoligono`, `distanciaAoPoligono` | DLT por SVD (Jacobi de um lado, sem AᵀA), erro RMS de reprojeção; recusa < 4 pares, repetidos, colineares; aceite ≤ 0,30 m |
| `privacy.py::borrar_rostos` | `regioesRosto` + `borrarRegioes` | mesma região (keypoints da cabeça, r = max(18 px, 1,8·Δx, 2,2·Δy), topo de 22 % das caixas) e a mesma receita (6×6 → vizinho → gaussiano k = max(15, w/3)) |
| `main.py` (laço por câmera) | `operators/livres-m/takt.js` | pé = tornozelos visíveis (> 0,4) ou base da caixa; posto mais próximo dá a ROI; `amostra_hz` → "Amostras por segundo"; fora de turno fecha tudo |
| `domain/kpi.py` (publicável ≥ 85 % de cobertura) e Cockpit/Relatórios/Timeline/FloorMap do front | `kpiJanela`, Studio GPlanSiS\|Takt | produtividade = produtivo ÷ (produtivo + improdutivo); não observado e pausa fora do denominador |

**Ficou de fora** (e por quê): detector RF-DETR/YOLO26 e o rastreador OC-SORT do worker (no
navegador a pose RTMO já entrega caixa + keypoints; ID vem do Tracking com IDs da cadeia ou do
rastreio por caixa da Ergonomia); banco PostgreSQL/Timescale, Redis, API, usuários/papéis,
auditoria e a **revisão humana** de intervalos (o iaVision não tem servidor para isso — tudo fica
no aparelho e sai em CSV/relatório); estado SETUP (no Takt é atribuído na revisão, não pela visão);
mapa de calor por dia (Relatórios, precisa de histórico de vários dias); MediaMTX/RTSP (a câmera IP
entra pelo "Stream" do app); evidência em MinIO.

### 10.2 Como usar

1. Hub **Industrial** › cartão **Tempo de posto (Takt)** › **Abrir Studio Takt** (ou o preset do
   Pipeline "Tempo de posto (pose + postos)" = Pose RTMO → `takt.posto`; "+ rastreio (IDs)" põe o
   ByteTrack no meio).
2. **Postos**: marque cada posto com as Ferramentas de mouse (retângulo, polígono ou elipse) e escolha
   a função **Takt · posto** (só aparece com o nó no Pipeline), ou use **+ Novo posto** (painel/Studio).
   O polígono é a ROI das mãos e, na presença "no plano da imagem" (padrão), a zona de presença com
   raio de 0,2 da altura do quadro.
3. **Piso** (opcional): Studio › **Calibrar piso** › clique ≥ 4 marcos no chão e digite x, y em metros.
   A grade de 1 m aparece projetada no vídeo; a homografia passa a dar posição, deslocamento (com zona
   morta de 25 cm) e a planta em metros. "Presença no piso" (Configurar) usa os metros como o worker
   (polígono projetado no chão + raio em m) — aí o posto deve ser desenhado sobre o CHÃO da área.
4. **Turnos e pausas**: Configurar › Turnos (ou "Modelo 3 turnos"), fuso da planta. Vídeo gravado:
   "Início do 1º quadro" ancora o tempo do vídeo no relógio para a agenda valer.
5. Ler: KPIs da janela (turno vigente ou sessão), ranking, Gantt (cor + padrão), planta, alarmes
   (vago > N min, ocioso > X %, cobertura < Y %). **Exportar**: intervalos, KPIs e eventos (CSV com
   BOM e `;`), relatório HTML com Gantt e planta, PNG, configuração JSON. Os eventos também entram no
   CSV das marcações (CV-37).

Para outros operadores: `ctx.takt.postos[nome] = { estado, desde, pessoas, atividade }` e
`ctx.piso = { calibrado, erro, H, unidade: 'm', paraPiso(x, y) }` (x, y em 0–1 do quadro → metros).

### 10.3 Tempo, fonte parada e quadro parado

- Arquivo de vídeo: tempo do **vídeo** (`currentTime`) ancorado num relógio; pausado não acumula; a
  volta do loop continua a linha do tempo (monotônica). Câmera, tela, stream, YouTube: relógio.
- **Fonte pausada** (`ctx.fonteParada`: YouTube pausado/carregando, quadro do histórico repetido) =
  câmera sem quadro → **NAO_OBSERVADO** depois de `stale_s` — nunca ocioso (INV-TAKT-003).
- **Não** se usa a comparação de imagem (`runtime/parado.js` com `imagem: true`): numa câmera ao vivo,
  pessoa parada é dado real (ocioso).
- Pipeline parado (aba oculta, Rodando desligado): o buraco vira NAO_OBSERVADO desde o último quadro
  (watchdog do worker).
- A cadência segue "Amostras por segundo" (5, como o worker) e só mede pose **nova** (o mesmo
  esqueleto duas vezes zeraria o movimento); com a inferência lenta (> 1,5 s) mede assim mesmo para o
  relógio dos estados não parar.

### 10.4 Validação (JS × Python original)

Números do Takt gerados com o próprio worker (`python3 -I`, venv no scratchpad com numpy e
opencv-headless; o código do Takt só foi lido): `takt-teste/ref_takt.py` → `ref.json`;
`node takt-teste/teste_takt.mjs <site> ref.json` compara:

| Grupo | Casos | Diferença máx. JS × Python | OK |
|---|---:|---|---|
| geometria · point_in_polygon | 418 | 0 divergências | sim |
| geometria · distance_to_polygon | 418 | 0 | sim |
| homografia · H (dif. relativa por termo) | 16 | 2.9e-7 | sim |
| homografia · erro RMS de reprojeção (m) | 16 | 1.4e-11 | sim |
| homografia · to_floor de pontos novos (m) | 80 | 1.6e-11 | sim |
| homografia · recusas (colinear, repetido, < 4) | 3 | 0 divergências | sim |
| ActivityScorer · atividade 0..1 | 240 | 5.6e-17 | sim |
| ActivityScorer · qualidade da pose | 240 | 0 | sim |
| EventManager · trabalho contínuo | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · micro-pausa | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · ociosidade sustentada | 4 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · histerese | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · saída rápida | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · ausência longa | 4 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · dentro do raio | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · fora do raio | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · câmera caída | 6 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · pose ilegível | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · detecção fraca | 2 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · pausa programada | 6 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · watchdog | 3 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · cobertura total | 10 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · dois postos | 4 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · bancada (tempos curtos) | 8 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| EventManager · aleatório longo | 82 | estados 0 · t 0 ms · conf 0 · KPI 0 | sim |
| turnos · janela, em_turno, em_pausa | 770 | 0 divergências | sim |
| privacidade · borrar_rostos | 11966 | caixa da área ±0 px · 99.89 % px iguais (±6) · dif. média 1.4/255 | sim |
| privacidade · borrar_rostos + topo das caixas | 16872 | caixa da área ±0 px · 99.81 % px iguais (±6) · dif. média 1.5/255 | sim |
| testes pytest do Takt portados | 6 | 0 falhas | sim |

Motor no Node (`teste_motor.mjs`, 15 verificações): fonte pausada → não observado com cobertura
caindo e produtividade intacta; pessoa parada = ocioso; buraco de 30 s → não observado; vídeo
ancorado, quadro repetido ignorado, loop monotônico; pausa programada e "fora de turno" sem VAGO;
alarme de vago; CSV; calibração (erro 3e-15 m) e recusa acima de 0,30 m.

Ponta a ponta no Chrome (`e2e-takt.js`, vídeo sintético `posto_sintetico.webm`: duas pessoas reais
recortadas sobre um piso com 8 marcos em posições conhecidas; A trabalha 0–24 s e 38–70 s, B fica
parada de 8 a 52 s com as mãos fora do posto; tempos da bancada): Bancada 1 = produtivo → vago
(24,4 s) → produtivo (38,3 s); Bancada 2 = vago → ocioso no posto (8,2 s) → vago (52,1 s) — as
transições caem nos instantes do roteiro porque retroagem; homografia com erro 0,0004 m; alarmes de
vago e de ocioso; CSVs, relatório e Studio. Regressão do app (`barra-tools/regressao.js`) sem falhas.

### 10.5 Cuidados e riscos

- **LGPD**: o borrão é ligado por padrão (Configurar › Privacidade) e muda os pixels: vídeo do app,
  gravação e PNG saem borrados. Não cobre: (a) o modo **Comparar** do app — a metade "ORIGINAL" é o
  vídeo cru; (b) o **histórico** (buffer de quadros) guarda os quadros crus em memória (só o que é
  exibido é borrado); (c) um rosto que a pose não achou e fora da caixa de pessoa; (d) com a pose
  própria (sem RTMO na cadeia), o borrão usa a última inferência — em movimento rápido pode atrasar
  alguns quadros (o "topo das caixas" reduz o risco). Desligar o borrão mostra aviso vermelho no
  Studio e no painel. Medir tempo de trabalho de pessoas exige base legal e comunicação aos
  trabalhadores; os IDs são da sessão (não identificam ninguém) e nada sai do aparelho.
- Com o borrão, `takt.posto` não é "só overlay": o Viewport mostra o quadro processado (resolução de
  trabalho), não o vídeo nítido.
- O ActivityScorer é linha de base determinística (pesos do Takt, não "verdade"); com a câmera longe,
  punhos com confiança < 0,35 viram atividade 0 → ocioso. Ajuste o enquadramento ou os tempos.
- A presença "no plano da imagem" depende da perspectiva (raio em fração da altura do quadro); para
  postos em profundidade, calibre o piso e use a presença no piso.
- A pose RTMO às vezes devolve a mesma pessoa duas vezes: o operador fica com a de maior score
  (IoU > 0,6), como a Ergonomia.
- Sessão e configuração ficam no navegador (localStorage `aiv.takt.cfg`); exporte antes de "Nova sessão".

## 11. Contagem em esteira — GPlanSiS|CounterVision (CV-38)

Porte do **GPlanSiS|CounterVision** (countervision.gplansis.com; fonte React/FastAPI em `contador-visao/`) para o hub
Industrial. Tudo roda no navegador; nada da imagem sai do aparelho. Grupo de operadores **livres-l**
(`js/cv/operators/livres-l.js`, `operators/livres-l/contagem.js`, `runtime/livres-l/{cor,esteira,onnx-local}.js`;
`models-livres-l.js` vazio de propósito), painel `components/industrial/CounterPanel.js`, tela cheia
`StudioCounter.js`, comum `counter-comum.js` e estilo `css/industrial-counter.css` (injetado pelo módulo).

### 11.1 O que veio do CounterVision

| CounterVision | iaVision (CV-38) |
|---|---|
| Motor **Cor e forma** (`colorCore.ts`, worker): HSV + tolerância, abertura, componentes conexos, k-means para peças encostadas | `contagem.cor` (JS puro, buffers reaproveitados, classe por cor `cor:<nome>`) |
| Amostrar cor por toque (crescimento de região = papel do SAM) | Studio › **Calibrar cor** (clique na peça) ou seletor de cor; amostras no navegador (`aiv.contador.cores`) |
| Rastreador por centroide (`tracker.ts`) | dentro do `contagem.cor` e como `contagem.rastreio` para detectores |
| Motor **YOLO11** com o `best.onnx` cadastrado | `contagem.onnx`: o `.onnx` do usuário guardado em IndexedDB (saída `[1,N,6]` ou `[1,4+C,N]`); ou os detectores livres YOLOX / RF-DETR |
| Zonas (3–64 vértices) e linhas (2 pontos) com direção | **as marcações das Ferramentas de mouse** + CV-37 `cena.zonas` (sem segundo editor); o CV-37 ganhou `umaVez` (cada ID conta uma vez por linha, INV-EVT-001) e publica `ctx.cena.eventos` |
| Eventos (track, direção, confiança), totais, WebSocket | `contagem.esteira`: eventos com hora, tempo da fonte, turno, marcação, ID, sentido, classe e confiança; retrato 4×/s para as telas |
| Fila store-and-forward (`uplink.ts`) | fila em IndexedDB (`aiv-contador` › `eventos`, reserva em localStorage), CSV e "Esvaziar fila" |
| Captura de quadro + caixas → dataset YOLO | "Capturar quadro com caixas" → ZIP YOLO (`images/`, `labels/`, `data.yaml`, `classes.txt`) ou **Enviar ao Treinar** (mesma API do Fonte › YouTube; acrescenta classes, envia e grava os rótulos em `PUT …/rotulos`) |
| Tela Operação | Studio **GPlanSiS|CounterVision** |

**Acrescentado** (não existia no CounterVision): metas por turno com projeção, turnos configuráveis, taxa peças/min
e peças/h, gráfico por minuto, alarmes de **parada** (nenhuma peça em N s, só depois da primeira) e de **taxa
baixa/alta**, com reconhecimento e histórico (estados ISA-18.2), base de contagem (linhas/zonas) e sentido
(ida, volta, soma, líquido).

**Ficou de fora**: servidor (FastAPI/PostgreSQL), login e papéis, invariantes no banco, WebSocket entre aparelhos,
revisão humana de rótulos (o Treinar já tem rotulador) e a esteira simulada em canvas (no lugar, **Abrir exemplo**:
vídeo sintético `amostras/contador/esteira-cores.mp4`, 180 KB). O modelo demo do CounterVision (`a75f….onnx`) é o
**YOLO11n oficial** (Ultralytics, AGPL-3.0): não foi copiado.

### 11.2 Como usar

1. Industrial › **Contagem em esteira** › *Abrir Studio CounterVision* (põe a cadeia `contagem.cor → cena.zonas
   (centro, cada ID uma vez) → contagem.esteira` no Pipeline), ou o preset *Contagem por cor* / *Contagem com
   detector + rastreio* (YOLOX → `contagem.rastreio`).
2. Fonte do app (câmera, arquivo, YouTube) ou **Abrir exemplo**.
3. **Calibrar cor**: clique no centro de peças isoladas (repita sob luz diferente). A amostra dá a faixa HSV e
   a área típica (separa peças encostadas). Nomes iguais = mesma classe.
4. Linha: **Linha no meio** (vertical: esquerda → direita = *ida*), **Desenhar linha** (2 cliques) ou as
   Ferramentas de mouse (a seta no meio da linha é o sentido *ida*; inverter troca o sentido). Zonas: as áreas de
   contagem das Ferramentas.
5. Ajustes: meta por turno, turnos (`T1 06:00-14:00; T2 14:00-22:00; T3 22:00-06:00`), janela da taxa, parada,
   taxa mínima/máxima, base e sentido.

**Tempo**: arquivo = tempo do vídeo (pausar não conta nem dispara parada; laço/volta do vídeo não soma); ao vivo =
relógio, parado com a fonte parada (`ctx.fonteParada`, `runtime/parado.js`). O mesmo instante do vídeo não é
reprocessado.

### 11.3 Validação (vídeos sintéticos, Chrome headless, pipeline 480 px)

Peças coloridas (raio 22–26 px em 960×540, 30 fps) numa esteira com listras e ruído; 15–20 % em grupos
encostados (gap 0); verdade = centro cruzando x = W/2. Gerador `cv-teste/gera.py`.

| Vídeo | Motor | Verdade | Medido | Por sentido | Taxa média verdade × medida (peças/min) |
|---|---|---|---|---|---|
| uma faixa, 180 px/s, 60 s (24 encostadas) | COR, cor por seletor | 70 | **70** | 70 ida | 70,0 × 68,7* |
| uma faixa | COR, calibrada por clique | 70 | **70** | 70 ida | 70,0 × 70,1 |
| duas faixas opostas, 160 e 260 px/s, 60 s | COR, seletor | 153 | **153** | 65/65 ida, 88/88 volta | 153 × 150,3* |
| duas faixas, vídeo a 2× (metade dos quadros) | COR, clique | 153 | **153** | 65 / 88 | 153 × 152,5 |
| rápida, 480 px/s, luz desigual, trios encostados, 45 s | COR, seletor | 123 | **123** | 123 ida | 164 × 163,7 |
| rápida | COR, clique | 123 | **123** | 123 ida | 164 × 163,8 |
| rápida a 4× (limite: ~64 px por quadro analisado) | COR, clique | 123 | 113 | 111 ida + 2 volta falsas | 164 × 150,8 |
| placas PARE (COCO) em duas faixas opostas, 40 s | YOLOX + `contagem.rastreio` | 47 | **46** | 20/20 ida, 26/27 volta | 70,5 × 69,1 |
| placas PARE | YOLOX + ByteTrack (IoU) | 47 | 39 | 18 / 21 | 70,5 × 58,6 |

\* tempo da sessão contava ~1 s a mais do laço do vídeo no fim do teste (corrigido no roteiro). A peça que falta
no YOLOX cruza a 0,07 s do fim do vídeo (latência média de inferência 0,16–0,25 s). Atraso médio do evento em
relação à verdade: 0,03–0,08 s (COR). Antes da correção da área típica automática (mediana → 30º percentil do
anel longo) dois pares encostados eram perdidos no vídeo de uma faixa; antes da margem de brilho maior
(0,12 → 0,25), 3 de 123 no vídeo com luz desigual.

O carregador ONNX foi validado com dois modelos mínimos de saída constante (`[1,2,6]` fim a fim e `[1,6,3]`
estilo YOLO com NMS): caixas recuperadas em coordenadas do quadro (erro ≤ 0,001). Alarmes: parada só com o
vídeo andando (pausa de 6 s: tempo ativo +0 s), reconhecimento e retorno ao normal, meta do turno no histórico,
fila em IndexedDB = eventos da sessão.

### 11.4 Cuidados e riscos

- Motor COR: bom para peça de cor saturada sobre fundo neutro (o próprio CounterVision avisa). Peça sem cor
  distinta → detector. Calibre sob a luz da linha; luz que muda muito pede várias amostras.
- Velocidade: acima de ~1,4 diâmetro de peça por quadro analisado o rastreio perde peças (medido a 4×). Suba a
  taxa de quadros do pipeline (baixe a largura de processamento) ou ponha a linha onde a peça anda menos.
- Peças encostadas se separam pela área típica: peças de tamanhos muito diferentes na mesma cor confundem a
  contagem do grupo (ajuste "Tamanho típico" ou use o detector).
- ByteTrack (IoU) perde ID quando a peça anda mais que ~meio tamanho entre inferências: na esteira use
  `contagem.rastreio`.
- O quadro do pipeline segue o **Espelhar** do app: a imagem e as caixas capturadas para o dataset saem
  espelhadas quando ele está ligado (caixas coerentes com a imagem).
- Modelo `.onnx` do usuário: a licença é dele (YOLOv8/11/26 são AGPL-3.0). Fica só neste navegador.
- A fila guardada não tem servidor: exporte o CSV e esvazie. Total por turno em `aiv.contador.turnos` (90 turnos).


## 12. Inspeção visual — GPlanSiS|Inspect (CV-40), partes 1 e 2

Porte das ferramentas clássicas e do "studio" do GPlanSiS|Inspect (FastAPI + OpenCV, inspect.gplansis.com) para o
navegador, em JS puro sobre ImageData — sem OpenCV.js, sem modelo. Grupo **livres-n**: `js/cv/operators/livres-n.js`,
`js/cv/operators/livres-n/inspect.js`, `js/cv/runtime/livres-n/` (visao, ferramentas, veredito, programa, gatilhos,
canal), `js/components/industrial/` (InspectPanel, StudioInspect, InspectEditor, inspect-comum) e
`css/industrial-inspect.css` (injetada na primeira montagem, como a do CounterVision).

### 12.1 O que veio do Inspect

| Inspect (Python) | iaVision (JS) |
|---|---|
| `classic.presence` (matchTemplate TM_CCOEFF_NORMED) | `presence` — NCC com o mesmo tratamento de janela lisa; exaustivo até 10⁷ multiplicações, acima disso pirâmide (5 picos refinados em resolução plena) |
| `classic.blob_count` (Otsu + componentes) | `blob_count` — desfoque 5×5 bit-exato, Otsu igual ao do OpenCV, limiar fixo ou **adaptativo** (novo), componentes 8 (Wu, duas passadas) |
| `classic.caliper` (perfil + gradiente + sub-pixel) | `caliper` — remap bilinear com coordenada em 1/32 px, `np.gradient`, subida ao pico e parábola |
| `classic.color` + `delta_e2000` | `color` — BGR2LAB de 8 bits bit-exato (tabelas do OpenCV), mediana como o numpy, CIEDE2000 |
| `objects.shape` (object_mask + contorno) | `shape` — Otsu, polaridade pela borda, abertura/fechamento com a elipse 5×5, furos tapados, seguimento de borda de Suzuki, casco (cadeia monótona), menor retângulo (calipers) |
| `objects.defect_area` (inRange HSV no objeto) | `defect_area` — BGR2HSV de 8 bits bit-exato, faixas prontas (queimado, ferrugem, mofo, azul, metal) |
| `preprocess.align` (ORB+homografia / phaseCorrelate) | alinhamento por **translação** (NCC em pirâmide do miolo da golden reduzida a 320 px); falhou → todas as críticas INCERTO, como no `engine.run` |
| `cameras/trigger.py` + `presence.ts` | `gatilhos.js` — presença (fundo + histerese), linha, intervalo, manual |
| `domain/verdict.py` | `veredito.js` — `judge_range` (com `scale`), `aggregate` (só críticas decidem; ERRO conta como INCERTO) |
| `domain/program.py` | `programa.js` — mesmos tipos e campos; validação; versões; JSON do iaVision e ProgramSpec do Inspect (export/import) |
| telas Live/Review/Programs | `StudioInspect` + `InspectEditor` + `InspectPanel` |

Cada ferramenta é também um operador avulso (`inspect.presenca`, `.blobs`, `.paquimetro`, `.cor`, `.forma`,
`.defeito_area`) que roda ao vivo nas marcações com a função "Inspect · …" (régua = px→mm), para ajustar limites; o
`inspect.programa` roda o programa com gatilho.

### 12.2 Como usar

1. Hub **Industrial › Inspeção visual › Abrir Studio Inspect** (ou um dos presets "Inspeção — …" do Pipeline, que cria
   o programa do modelo e abre o painel).
2. **Programa**: escolha um modelo ou um exemplo do Inspect (P-BISC55, P-TAMPA38), ou importe um ProgramSpec. Em cada
   ferramenta, **Desenhar ROI** e arraste no quadro ao vivo: vira uma marcação "Inspect · …" (nome = código), editável
   depois com as Ferramentas de mouse. Presença: **Capturar molde** com a peça boa; cor: **Capturar cor**; alinhamento:
   **Capturar golden**. px/mm: régua calibrada ou fixo no programa. **Testar no quadro atual** roda o rascunho sem
   registrar. **Salvar versão** grava a versão nova (as 10 anteriores ficam, com Restaurar).
3. **Gatilho**: presença com a ROI onde a peça PARA (melhor uma faixa estreita na borda de chegada: peça em movimento
   que cobre toda a ROI parece "assentada"), linha (esteira contínua), intervalo, manual. **Rearmar** reaprende o fundo.
4. A tela mostra o veredito grande, medidas, histórico com miniaturas (filtro, CSV), estatística (refugo, rendimento,
   sequência, Cpk do paquímetro e do Ø), alarmes (NOK seguidos, % de INCERTO) e a **fila de revisão**: confirmar OK/NOK,
   classe do defeito e motivo (≥ 5 letras) — "a máquina propõe, o humano confirma". **Enviar ao Treinar** manda os JPEG
   das peças (NOK como RUINS e OK como BOAS em projetos de anomalia) por `auth/treino.js`.

Programas e histórico (resumo, 500 peças) ficam no navegador **por usuário** (`aiv.inspect.*:<usuário>`); miniatura e
JPEG só em memória (60 peças).

### 12.3 Validação — JS × Python (OpenCV 4.12 do venv de teste)

25 imagens sintéticas (casos dos testes do Inspect, imagens do `demo_data.py` com ruído e JPEG, cena 1280×720 a 5 px/mm),
73 execuções de ferramenta: **status igual em 73/73**.

| ferramenta | casos | status iguais | maior Δ de valor |
|---|---|---|---|
| blob_count | 15 | 15/15 | 0 |
| caliper | 12 | 12/12 | 0.0025 |
| color | 14 | 14/14 | 0 |
| presence | 4 | 4/4 | 0 |
| shape | 12 | 12/12 | 0 |
| defect_area | 16 | 16/16 | 0 |

Diferenças: só o paquímetro (≤ 0,0025 mm, remap); cor, contagem, presença, forma e defeito saem idênticos. Na
conversão de cor, 3 em 4000 pixels aleatórios diferem de 1 nível de L (Lab) e 1 em 12000 valores de HSV (S) —
arredondamento das tabelas, sem efeito nas medianas dos casos. Os testes do Inspect (`test_cameras.py`,
`test_domain.py`) foram portados (28 verificações, todas passam). Ponta a ponta no Chrome headless: vídeo VP8 de esteira
com 8 placas (OK, OK, falta furo, cor, ferrugem, larga, limite, OK) → 8 disparos, vereditos = gabarito, fila, CSV, Cpk,
alarme de NOK seguidos, export/import ProgramSpec (30 verificações).

### 12.4 Desempenho (Node 24, Apple Silicon, mediana de 9)

| ferramenta | ROI típica | ms (ROI típica) | ms (ROI = quadro 1280×720) |
|---|---|---|---|
| blob_count (FUROS) | 520×120 | 1.1 | 12.9 |
| caliper (LARGURA) | linha 680 px | 0.1 | 0.3 (linha 1279 px) |
| color (COR) | 80×60 | 0.1 | 6.2 |
| shape (FORMA) | 680×480 | 9.5 | 27.5 |
| defect_area (FERRUGEM) | 680×480 | 11.7 | 34.8 |
| presence (FURO1) | 200×120 | 3.0 | 18.0 |

### 12.5 Parte 2 — leitura e modelos (ocr, code, serial, detect, classify, anomaly)

Os seis tipos do Inspect que a parte 1 guardava desativados agora rodam. A **decisão** é porte fiel
(`runtime/livres-n/marcacao.js` ← `ocr/postprocess.py` + `vision/tools/marking.py`; `aprendidas.js` ←
`vision/tools/learned.py` + `vision/detectors.py` + `scripts/calibrate.py`), em JS puro e testada contra o Python. A
**leitura** reusa o que o iaVision já tem (`modelos.js`, carregado por import dinâmico só por quem usa):

| tipo | leitura no iaVision | decisão (igual ao Inspect) |
|---|---|---|
| `ocr` (lote/validade) | PP-OCRv5 det + reconhecedor latino do CV-17, com os parâmetros do PaddleOCR 3 (lado menor ≥ 64, thresh 0,3, box 0,6, unclip 1,5) e 8 px de margem | `normalize` por campo (O→0, I→1…), padrão (fullmatch), esperado com `expand_expected` (`{LOT}`, `{TODAY}`, `{TODAY:+180\|%d/%m/%y}`), `parse_date` (formato + reservas) e validade ≥ hoje + N; leitura fraca → INCERTO |
| `code` | BarcodeDetector nativo ou ZXing do CV-10; sem leitura, nova tentativa ampliada 2× com zona quieta | formatos aceitos (nomes do zxing-cpp: QRCode, DataMatrix, EAN13, Code128…), padrão, GS1 (`gs1_parse`: AI 01/10/17/21…, HRI ou cru com GS) com `gtin_check_ok`, GTIN do produto e lote do código = lote da ordem; nenhum legível → NOK |
| `serial` | OCR (como o Inspect) ou código (`source: 'code'`) | padrão com `(?P<n>\d+)` (search), `sequence_status`: igual → NOK, fora de ordem ou salto > `max_gap` → INCERTO; o **registro de seriais** do canal (por programa, 5000 últimos, por usuário) faz o papel do PK `insp.serial_registry`: repetido → NOK "duplicado — já registrado em …" |
| `detect` | YOLOX-S (COCO), RF-DETR nano/small (COCO), RF-DETR treinado no Treinar (`livre:<id>`) | decodificadores do Inspect (`decode_yolox` com NMS por classe, `decode_detr`, `decode_ultralytics`), classes exigidas (mín–máx) e proibidas; passou com detecção colada no limiar → INCERTO. Classes COCO em inglês (programa do Inspect) valem como as em português do iaVision |
| `classify` | MobileNetV2 (ImageNet) ou classificador publicado no catálogo (`arquitetura: 'classificador'`) | softmax com temperatura e **conjunto conformal** {y : p ≥ 1 − q̂}; conjunto vazio ou com > 1 classe → INCERTO. **Calibrar** no editor: amostras rotuladas pelo humano no quadro atual (logits guardados em centésimos, até 40) → `calibrate.classify` (T por NLL, q̂ do split conformal com o α da ferramenta) |
| `anomaly` | PatchCore treinado no Treinar (CV-24, `/models/custom`) | nota normalizada pelo conjunto de calibração (`calibrate.anomaly` rodado nas notas boas × ruins da ficha do treino: percentil 1 das boas, 99,5 de todas, limiar por F1), `judge_range` contra o limiar, **mapa de calor** no quadro e as 5 maiores regiões acima do limiar |

As ferramentas com leitura/modelo são **assíncronas**: a região é copiada na hora do disparo, a inferência passa pela
fila do ORT fora do laço de quadros, e o veredito **espera** por elas (prazo do programa, padrão 20 s; estourou →
INCERTO "sem resposta do modelo"). As peças fecham na ordem em que foram disparadas; enquanto isso o Studio mostra
"lendo / rodando os modelos…". Os modelos começam a carregar ao ativar/salvar o programa. Campos novos do programa:
**lote da ordem/turno** (`{LOT}` e AI 10) e **espera pelos modelos**. Marcações novas: "Inspect · OCR (lote/validade)",
"· código", "· número de série", "· detector", "· classificação", "· anomalia".

Studio: a tabela de medidas mostra o que foi lido (texto, código, classe, contagem, nota) e uma linha de detalhe (texto
lido × esperado, dias de validade, AIs do GS1, nº e anterior do serial, contagem por classe, conjunto conformal, nota
bruta × limiar); o quadro inspecionado desenha as linhas do OCR com o texto, o contorno do código, as caixas do
detector e o mapa de calor da anomalia. **Treinar anomalia com as BOAS** (aparece quando o programa tem anomalia) manda
as peças OK, recortadas na ROI da ferramenta, a um projeto de anomalia do Treinar (cria o projeto se preciso); o modelo
publicado entra na ferramenta (modelo vazio = o mais recente). Exemplos novos: **P-ROTULO-LOTE** (OCR do lote e da
validade, DataMatrix GS1, EAN-13) e **P-ANOMALIA** (arruela, PatchCore + forma).

Export/import: os campos são os do Inspect; ficam só aqui `modelo`, `source`, `gtin_check`, `alpha`, `calib_amostras`
(além de `marcacao`, `ativo`, `folga`). `model_id` (inteiro do registro do Inspect) vai e volta intacto (0 quando o
programa nasceu aqui — ajuste no Inspect) e `calibration` vai junto (o Inspect a ignora; lá ela mora no modelo).

Diferenças de propósito: regex do Python convertida (`(?P<n>…)` → `(?<n>…)`); "hoje" = data local do navegador (o
Inspect usa o fuso da planta); `code` com dois códigos **diferentes** aceitos na ROI → INCERTO (ambíguo; o Inspect pega
o primeiro) e `expected` (igual) e `gtin_check` (EAN/UPC sem GS1) são extensões; o texto cru do leitor com FNC1
(`\x1d`, `]d2`…) é limpo antes do `gs1_parse`; OCR com 8 px de margem na ROI; as caixas da anomalia vêm de
componentes conexos (o Inspect usa contornos externos — iguais nos testes). Correção junto: o ZXing minificado do CV-10
lançava "No MultiFormat Readers…" em quadro sem código em vez de seguir para as passadas girada e invertida (Safari e
Firefox) — `runtime/code.js` agora reconhece essa mensagem.

### 12.6 Parte 2 — validação JS × Python e acurácia

Sem imagem (`casos2.py` roda o código do Inspect; `testes2.mjs` o JS): **388/388** iguais — testes do backend portados
(`test_domain`: normalize, expand, GS1, GTIN; `test_objects`: sequência; `test_detectors`: DETR e YOLO26-HF) 13/13,
`normalize` 65, `expand_expected` 33, `parse_date` 175, `gs1_parse` 12, `gtin_check_ok` 13, `sequence_status` 8,
decisões de ocr 15, code 10, serial 11, classify 7, detect 6, anomaly 6 (com leitores/modelos simulados), calibração
(classify 5, anomaly 4) e decodificadores 5.

Com imagem, no Chrome (WebGPU; PatchCore em wasm), contra gabarito e Python (zxing-cpp 3, onnxruntime com o pré do Inspect):

| ferramenta | conjunto | iaVision (JS) | Python |
|---|---|---|---|
| ocr | 60 recortes sintéticos (30 lotes, 30 validades; 5 fontes, 18–44 px, desfoque, ruído) | 60/60 exatos | — (PaddleOCR não instalado no teste) |
| code | 48 (QR, DataMatrix GS1, EAN-13, Code128; escala 2–6, giro 0/7/90°, ruído) | 48/48 (BarcodeDetector) · 47/48 (ZXing) | 46/48 (zxing-cpp) |
| P-ROTULO-LOTE | 6 rótulos (ok, lote errado, validade curta, GTIN errado, lote do DMX, sem DMX) | 6/6 vereditos | — |
| detect | 4 fotos (cachorro do teste do Inspect + COCO), 27 objetos, YOLOX-S | contagem por classe = Python 4/4 | referência |
| classify | as mesmas 4 fotos, MobileNetV2 | top-1 = Python 4/4 | referência |
| anomaly | 58 arruelas: 30 boas + 12 ruins do treino, 12 defeitos NOVOS desenhados e 4 boas com luz/posição mudadas | 57/58 (a erro é 1 boa da validação → INCERTO); novos 16/16 | nota bruta Δ ≤ 0,043 |

Desempenho (Chrome, Apple Silicon, mediana por ROI): ocr 22 ms, code 8 ms, detect 56 ms, classify 5 ms, anomaly 86 ms
(wasm); P-ROTULO-LOTE inteiro (4 ferramentas) 75–90 ms; 1º uso do OCR ≈ 1,7 s (abrir os modelos). Ponta a ponta no app
(Studio, fonte imagem): rótulos, serial com duplicado, anomalia com mapa de calor, teste do rascunho esperando o
modelo — 17 verificações; a regressão da barra (33) e o e2e da parte 1 (30) seguem passando.

### 12.7 O que ficou de fora

- **ORB + homografia** não foi portado (peso e fragilidade em JS): o alinhamento é só translação; peça que gira pede o
  Inspect no servidor. A cadeia SHA-256 e o banco (auditoria; o registro de seriais aqui é por navegador e usuário,
  não entre estações) também ficam no Inspect.
- **YOLO26/Ultralytics** (AGPL) não entra no `detect`: o decodificador está portado e testado, mas os detectores
  oferecidos são os de licença livre.
- **Classificador treinado no Treinar**: o Treinar ainda não publica classificadores; o catálogo já aceita
  `arquitetura: 'classificador'` (com `classes` e `calibracao`) para quando publicar. Até lá, MobileNetV2 (ImageNet).
- **Calibração de anomalia própria** (peças da linha): usa as notas de validação do treino; recalibrar com peças da
  linha é no Treinar (novo treino com BOAS e RUINS).

### 12.8 Cuidados e riscos

- O pipeline do app sobe a resolução sozinho nos primeiros segundos; o gatilho trabalha numa grade fixa (até 64×64
  células) da ROI para não depender disso, mas trocar de fonte com uma peça na ROI ensina um fundo errado — use
  **Rearmar** com a ROI vazia.
- Fonte de vídeo comprimido muda a cor (ΔE ≈ 4,6 no teste com VP8): capture a referência de cor na própria fonte.
- Programa com molde/golden grandes ocupa o localStorage (golden ≈ 77 KB, molde ≤ 256×256).
- OCR e código dependem de foco e resolução: use a largura de inspeção do operador (padrão 1280) e ROI justa no texto;
  "leitura fraca" vira INCERTO, não OK. Datas no formato do programa (`%d/%m/%Y` etc.) — impressão "12/27" cai nos
  formatos reservas (`%m/%y`).
- O prazo dos modelos protege a linha, mas a 1ª peça após abrir o app pode sair INCERTO se o download dos modelos
  (OCR 13 MB, YOLOX 36 MB, PatchCore 19–22 MB) passar do prazo.
- O registro de seriais fica no navegador (por usuário): duas estações não se enxergam; zere ao trocar de série.
- Conformal sem calibração usa T = 1 e q̂ = 0,9 (o padrão do Inspect): quase tudo vira INCERTO num modelo de 1000
  classes — calibre com amostras.
