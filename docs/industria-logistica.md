# Indústria e logística (CV-49 a CV-59)

Grupo de código **livres-r** (`js/cv/operators/livres-r*`, `js/cv/runtime/livres-r/`). JS puro, sem modelo novo, nada sai do navegador. Módulos **CV-49 a CV-59**, 13 operadores novos. Sobre a v91 só esta onda dá 59 módulos / 107 operadores; na fonte, junto com a onda 2-b (CV-60..67), ficou **67 módulos / 119 operadores**.

## Módulos e operadores

| Módulo | Operador | O que faz |
|---|---|---|
| CV-49 Poka-yoke de montagem (I2) | `pokayoke.sequencia` | As mãos (`maos.gestos`; reserva: punho prolongado da pose RTMO) entram nas áreas **Poka-yoke · caixa**. Ficar ≥ 0,3 s = pegou (histerese de saída 0,4 s). A ordem vem do texto (`Base; Placa; Parafuso x4; Tampa`, aceita `x4`, `×4`, `4x`, prefixo único do nome) ou da ordem dos nomes. Área opcional **Poka-yoke · conclusão** (gabarito). Desvios: fora de ordem, peça a mais, caixa errada, pulou (modo "seguir"), incompleto (concluiu sem um passo), abandonado (ciclo parado > 120 s). Aviso na hora (faixa vermelha + alarme ISA-18.2 "POKA desvio") e registro por ciclo: tempo, tempos de cada passo, OK/NOK, FPY. |
| CV-50 Cubagem (L1, 63) | `cubagem.esteira` | Laser de linha + câmera inclinada, com o **Extrator** e a triangulação do BeltScan (`zDeV`, `xDeUV`). Os primeiros N quadros (esteira vazia) são a referência por coluna. Por quadro: alturas, e o trecho mais largo acima de 15 mm dá altura (mediana dos 60% centrais) e largura (x no topo medido, não no plano da correia). Caixa a caixa: borda = meio entre o último quadro sem e o primeiro com perfil; comprimento = velocidade × tempo, ou pela silhueta na área **Cubagem · vista de cima** (fundo aprendido, menor retângulo girado, régua calibrada). m³, peso cubado (fator kg/m³), código lido (`ctx.codigos`). |
| | `cubagem.foto` | Cubagem estática: cada área **Cubagem · face** (retângulo, polígono, elipse, máscara ou o polígono do clique SAM) vira o menor retângulo girado em mm. No painel, grava-se a vista **Topo** (C × L) e a **Lateral**; a altura é o lado da lateral que não casa com o topo (o outro serve de conferência). Cada vista pode ter a sua régua. |
| CV-51 Conferência de doca (L4) | `doca.conferencia` | Linhas **Doca · porta** (seta para dentro = entrada; mesma convenção do "ida" do CV-37, inverte com o espelho). IDs do rastreio; classe mais votada por ID; cada ID conta uma vez por sentido por linha (vai-e-volta não infla). Classes de volume e de pallet configuráveis. Conferência por **placa/ordem**: líquido (entradas − saídas no recebimento; o inverso na expedição) × volumes e pallets esperados, códigos lidos × lista (falta/sobra). Trocar a ordem ou "Encerrar" fecha e guarda o registro. Sem detector: cada código distinto é um volume. |
| CV-52 Nível e gotejamento (54, 55) | `processo.nivel` | Área **Processo · visor de nível** do fundo ao topo. Perfil vertical da faixa central (luz ou saturação), degrau mais forte com refino parabólico, nitidez mínima, mediana de 5. Faixa pelo nome ("Tanque 0-5000 L") ou parâmetros. Alarmes ISA-18.2. |
| | `processo.gotejamento` | Área **Processo · gotejamento**. Gota = mancha pequena contra um fundo móvel que só aprende fora das manchas, seguida por vizinho mais próximo; conta quando dura ≥ 2 quadros e desce. Poça = fração da área diferente do fundo inicial em ≥ 3 quadros seguidos, com tendência (%/min) e área em cm² com régua. Alarmes de gotas/min e de poça. |
| CV-53 Correia (56) | `correia.alinhamento` | Área **Correia · faixa** atravessando a correia. Perfil transversal médio ao longo do movimento, as duas bordas por gradiente com subpixel. Referência = mediana das primeiras leituras ("Zerar referência"). Escala mm pela largura nominal (ou régua). Desvio em mm e %, lado, tendência por mínimos quadrados (mm/min), alarmes do desvio (% da largura) e da tendência. |
| CV-54 Torque (57) | `inspecao.torque` | Círculo **Inspeção · marca de torque** por parafuso. Tinta pela cor (ΔE2000 ≤ tolerância, Lab em cache por cor). Cabeça (r < 0,55 R): eixo da tinta por PCA; base: direção centro → centroide da tinta. Giro = ângulo entre os dois (marca radial) ou rotação relativa desde a referência gravada. NOK acima de 8°. |
| CV-55 Chama/forno (58) | `processo.cor_chama` | Área **Processo · chama/forno**. Média em RGB linear dos pixels acima do percentil de luz, Lab D65, ΔE2000 contra a referência (hex, 1ª leitura ou "Gravar"), CCT por McCamy (aproximada). Alarmes de faixa no ΔE. |
| CV-56 Solda (59) | `inspecao.solda` | **Pontos** "Inspeção · posição de solda" = posições nominais. Em cada uma, busca a mancha do diâmetro nominal (disco × anel quadrado por imagem integral) no raio de busca, subpixel por parábola. Presente / faltando / deslocado (tolerância em mm). Área **Inspeção · peça (solda)** opcional: manchas longe das posições = sobrando. Registro a cada mudança de resultado. |
| CV-57 Fumaça (61) | `ambiente.ringelmann` | Áreas **Fumaça · pluma** e **Fumaça · céu**. Medianas de luminância linear; opacidade = 1 − (Y_pluma − Y_fumaça)/(Y_céu − Y_fumaça); Ringelmann = 5 × opacidade. Pluma mais clara que o céu = vapor (não avalia). % do tempo acima do limite na janela e alarme. **Indicativo, não é laudo ambiental** (aviso no desc, no vídeo e no painel). |
| CV-58 Baú (64) | `logistica.ocupacao_bau` | Precisa de `depth.map` antes. Retângulos **Baú · porta** e **Baú · fundo**. A razão de tamanhos dá k = z_fundo/z_porta; a disparidade afim d = a/z + b é resolvida com a faixa junto da moldura (porta) e o fundo (referência do baú vazio gravada no painel, ou percentil 5). Cada raio do retângulo do fundo dá o enchimento (k − z)/(k − 1); ocupação = média. **Estimativa** (aviso no desc, vídeo e painel). |
| CV-59 Fissuras (C2) | `civil.fissuras` | Área **Civil · fissuras** (ou o quadro). Fundo por média larga em 2 passadas (a 2ª sem os pixels escuros), histerese em múltiplos do ruído (MAD), componentes alongados, esqueleto Zhang-Suen com poda das quinas de escada. Comprimento: cada pixel do esqueleto vale 1/max(|cos θ|,|sen θ|) na direção local. Abertura: perfil normal ao eixo, área do vale ÷ contraste "cheio" (subpixel) ou largura a meia altura no vale largo; mediana espacial de 5 px. Em mm com régua. Classe: capilar < 0,2; fissura ≤ 0,5; trinca ≤ 1,5; rachadura ≤ 5; fenda > 5 mm. Mapa (SVG/PNG), CSV e relatório HTML no painel. Parâmetro "Congelar" para foto e "Medir agora". |

## Painel «Medições»

`components/medicoes-onda2a.js` exporta `secoesOnda2a(tem)`; o `MedicoesPanel.js` só a importa e espalha na lista de seções (2 linhas). Cada seção aparece quando o operador está no Pipeline ou já publicou. Canal = o da onda 1-a (`runtime/livres-oa/canal.js`, chaves `r.*`). Comandos do painel para o operador (gravar referência, encerrar conferência, medir agora…) por `comandar()/tomarComandos()` em `operators/livres-r/comum.js`.

- **Poka-yoke:** KPIs (ciclos, OK, NOK, FPY, ciclo mediano, desvios), passos com o atual marcado, últimos desvios, alarmes, CSV de ciclos e de desvios, Reiniciar ciclo, Zerar.
- **Cubagem esteira:** status da referência, caixa sob o laser, total m³/kg, tabela, CSV, Refazer referência.
- **Cubagem por foto:** faces com botões Topo/Lateral, vistas gravadas, resultado C × L × A, m³, kg e conferência.
- **Doca:** formulário (placa/ordem, tipo, volumes, pallets, códigos) que escreve nos parâmetros do nó; situação CONFERE/DIVERGENTE, falta/sobra, totais por linha, histórico, CSV de eventos e de conferências, Encerrar.
- **Nível, gotejamento, correia, chama, fumaça:** valor, sparkline, alarmes ISA-18.2 com Reconhecer, CSV.
- **Torque e solda:** lista OK/NOK com o desvio, registro em CSV; Gravar referência (torque).
- **Baú:** ocupação estimada, Gravar baú vazio / Esquecer.
- **Fissuras:** KPIs, mapa SVG colorido por classe, tabela, CSV, PNG do mapa, relatório HTML.

CSS novo no fim de `css/medicoes.css` (só tokens do tema): `.med-doca-form`, `.med-amostra`.

## Ferramentas de mouse (registrarFuncao)

`pk_caixa`, `pk_fim`, `cub_laser`, `cub_vista`, `cub_face`, `doca_porta` (linha), `nivel_visor`, `gotejamento`, `correia_faixa`, `torque` (elipse/retângulo), `chama`, `solda_pos` (ponto), `solda_peca`, `fumaca_pluma`, `fumaca_ceu`, `bau_porta`, `bau_fundo`, `fissura_area`. Cada uma só aparece no seletor com o nó correspondente no Pipeline.

## Presets (`components/presets-onda2a.js`)

Mesmo formato do onda1a (descrição + marcações-modelo; abrem o painel Medições). Panels.js funde `[...PRESETS_ONDA1A, ...PRESETS_ONDA2A]` e chama também `criarMarcacoesModeloOnda2a()`.

| Grupo | Presets |
|---|---|
| Industrial | Poka-yoke de montagem (sequência); Nível pelo visor; Gotejamento e vazamento; Desalinhamento de correia; Marca de torque; Cor de chama / forno (ΔE); Pontos de solda por posição; Opacidade de fumaça (Ringelmann) |
| Logística | Cubagem de caixas na esteira (laser); Cubagem na esteira + vista de cima; Cubagem por foto com régua; Conferência de doca (caixa e palete — YOLOE por texto, AGPL); Conferência de doca por etiqueta (QR); Ocupação do baú (estimativa) |
| Construção civil (novo) | Medição de fissuras |

## Catálogo

`GUIA_R` (o que é / quando usar / limites / custo de CV-49..59) fica em `operators/livres-r.js`; o ConfigPanel faz `Object.assign(GUIDE, GUIA_R)`.

## Testes (`/Volumes/Armazena2/zz-staging/onda2-a-tools`)

- `testes/unit.mjs` (Node, núcleo): 40 verificações, todas OK. Destaques: cubagem por laser em 3 caixas sintéticas renderizadas pela triangulação (altura 0,0%, largura ≤ 0,41%, comprimento ≤ 1,33%; tol. 2/2/3%); vista de cima girada 23° (≤ 0,8%); nível 5 alturas com menisco e reflexo (pior 0,155% da escala; tol. 0,5%); gotas 30/30 e 50,0/min (tol. ±1 e 8%), tendência da poça 14,255 × 14,250 %/min; correia centro 0,008 px, tendência 30,00 px/min; torque 0–70° (pior 0,1°; tol. 1,5°); CIEDE2000 × 9 pares de Sharma (4e-5; tol. 1e-4); CCT D65 6505 K; solda 6/8 + 1 sobrando, posição 0,09 px; Ringelmann 0–80% (pior 0,4 p.p.; tol. 2); baú 4 cenários (≤ 1,5 p.p. do raio; tol. 3); fissura senoidal 0,8→4 px: comprimento 0,34%, abertura erro médio 0,12 px e máx 0,30 px (tol. 0,25/0,8 px); doca 8 entradas / 2 saídas com vai-e-volta e ponto exatamente sobre a linha; poka-yoke 4 ciclos com fora de ordem, a mais, incompleto, abandonado e o modo "seguir".
- `testes/t-ops.mjs` (navegador, `apply()` de cada operador com ctx sintético): 14/14 OK, console limpo — inclusive faixa pelo nome no nível (pior 15,6 L em 5000 L), doca com troca de ordem fechando o registro, correia 48,00 mm e 120,0 mm/min, fissura 34,24 mm × 0,296 mm (classe fissura).
- `testes/e2e.js` (app real, câmera falsa): os 15 presets aplicam, nenhum nó desliga com erro, as marcações-modelo nascem e a seção de cada operador aparece no painel Medições. Console: só 404 de modelos ausentes da cópia local (palm detection, YOLOE-texto, Depth Anything) e de `models/custom/index.json` — já existentes antes.

## Limites e pendências

- Studio do poka-yoke **não** foi feito (opcional no pedido); o painel Medições cobre ciclos, desvios e CSV.
- Os modelos de mãos, YOLOE e profundidade não estão na cópia local da fonte: poka-yoke com mãos reais, doca com detector e baú foram testados só com dados sintéticos de entrada (`ctx.hands`, `ctx.detections`, `ctx.depth`).
- A doca com YOLOE é AGPL; para produção, treinar caixa/palete no +Projeto.
- `index.html` (contagens 48/94) e `sw.js` (versão) ficam com o agente principal.
