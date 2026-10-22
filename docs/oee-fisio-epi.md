# Onda 1-b — OEE pela câmera, Fisio e Monitor de EPI

Três módulos novos (CV-46, CV-47, CV-48 — renumerados depois da onda 1-a, que ocupou CV-41..45).
Grupos de código `livres-o`, `livres-p`, `livres-q` (sem conflito com `livres-oa`).
Total no catálogo depois do merge: 48 módulos / 94 operadores.

## CV-46 · OEE pela câmera (máquina sem CLP) — `maquina.estado`

- **Entrada**: áreas das Ferramentas de mouse com a função **OEE · máquina** (a parte que se move quando a máquina
  trabalha) e, opcional, **OEE · setup** (bancada do ajuste). As funções são registradas por `registrarFuncao()`
  em `operators/livres-o/maquina.js` (aparecem com o nó no Pipeline; não mascaram a imagem).
- **Movimento**: fração dos pixels da ROI que mudaram mais que `limiar` níveis de cinza, numa grade de até 96 px,
  a `amostrasHz` (5/s) pelo tempo da FONTE (vídeo = tempo do vídeo). Método diferença de quadros (padrão) ou fundo
  adaptativo.
- **Estados** (`runtime/livres-o/oee.js › DetectorMaquina`): RODANDO (mov ≥ on 2 %), PARADA (mov ≤ off 0,8 %),
  SETUP (máquina quieta + movimento na área de setup, ou operador ATIVO no Takt — opção), PAUSA_PROGRAMADA (agenda),
  NAO_OBSERVADO (fonte pausada / sem quadro > 3 s). Histerese (banda morta entre off e on, e também no setup),
  tempos mínimos de confirmação (rodando 2 s, parada 10 s, setup 5 s) que RETROAGEM ao início do candidato,
  tolerância a amostra contrária isolada (≤ 1 s, e só se for minoria). Movimento contrário da máquina move o início
  da parada para depois dele (a duração continua exata).
- **OEE** (Nakajima; ISO 22400-2): planejado = observado − pausa programada − não observado − paradas com motivo
  planejado; D = operando ÷ planejado; P = ciclo ideal × peças ÷ operando; Q = OK ÷ inspecionadas (Inspect; INCERTO
  conta como não boa até a revisão) ou (peças − refugo) ÷ peças (apontamento manual). Fator sem dado → OEE "parcial"
  com o que falta escrito. Microparadas (< `microParada_s`, padrão desligado) contam como desempenho.
- **Integrações** (quando o nó está no Pipeline, em qualquer ordem): CounterVision (`contagem.esteira`, incremento do
  total), Inspect (`inspect.*`, peças novas do histórico por id), Takt (`takt.posto`: ATIVO com máquina quieta = setup;
  VAGO na parada = sugestão "Falta de operador"). Sem eles, apontamento manual de peças/refugo.
- **Studio GPlanSiS|OEE** (`components/industrial/StudioOEE.js`, CSS `css/industrial-oee.css`): vídeo com as ROIs na
  cor do estado, OEE e D×P×Q, tempos, apontamento, máquinas com o medidor de movimento (marcas on/off), linha do tempo
  (clique numa parada seleciona), **paradas e setups com classificação por clique** (motivos configuráveis, planejado ou
  não, sugestões), Pareto, OEE por turno, alarme "parada sem motivo > N min", eventos. Configurar: histerese, tempos,
  ciclo ideal (s/peça ou peças/min), máquina de produção, motivos, turnos e pausas (mesmo formato do Takt), início do
  vídeo, importar/exportar JSON. Exportar: estados, paradas, OEE por turno, eventos (CSV), relatório HTML (imprimir →
  PDF), PNG do vídeo e da linha do tempo. Painel lateral `OEEPanel.js`. Gancho de teste `window.aivOEE`.
- Configuração em `localStorage['aiv.oee.cfg']`; sessão só na memória (como o Takt).

## CV-47 · Fisio — `fisio.avaliar`

- Pose: o mesmo caminho do Salto (`runtime/livres-h/pose.js`: YOLOX + BlazePose 33 pontos seguido pelos auxiliares).
  Tempo da amostra = tempo do VÍDEO num arquivo (exato ao quadro); relógio do quadro ao vivo.
- **Goniometria** (ADM ativa 2D, neutro = 0°): joelho, quadril (flexão; abdução frontal), ombro (flexão lateral;
  abdução frontal), cotovelo, tornozelo (dorsi +/plantar −). Lado automático pela visibilidade. Mediana de 5, máx/mín,
  amplitude, % da referência AAOS (Greene & Heckman 1994). "Registrar medida" guarda na tabela.
- **Sentar↔levantar**: subida do quadril em comprimentos de coxa (coxa = p90 quadril–joelho); base sentada = ≥ 0,6 s
  parado com a coxa perto da horizontal; início = reta de d = max(subida, deslocamento do tronco) entre 0,05 e 0,25
  estendida a 0; em pé/sentado = rampa estendida até o patamar (janela de 1 s).
- **TUG** (Podsiadlo & Richardson 1991): total início → sentado; fases levantar, ida, giro, volta, girar+sentar pela
  velocidade horizontal do quadril (câmera DE LADO); velocidade de marcha aproximada. Referência ≥ 13,5 s (Shumway-Cook,
  Brauer & Woollacott 2000).
- **Sentar-levantar 5×** (fim na 5ª vez em pé ou ao sentar depois dela) — ≥ 12 s (Tiedemann et al. 2008).
  **30 s** (Jones, Rikli & Beam 1999) com a meia subida no fim e a faixa normal p25–p75 por idade/sexo (Rikli & Jones
  1999).
- Tentativa concluída é arquivada sozinha 1,5 s depois de sentar e o teste rearma.
- **Studio GPlanSiS|Fisio** (`components/saude/StudioFisio.js`, CSS `css/saude-fisio.css`): padrão Bike Fit — barra
  com o teste (ADM/TUG/5×/30 s), faixa vermelha com o paciente, aviso fixo "não é dispositivo médico", vídeo com pose
  e arco do ângulo, resultado com referência + FONTE, curva (ângulo×tempo com faixa AAOS; subida do quadril×tempo com
  fases e |vx|), tabela de medidas/tentativas (clique mostra a curva arquivada), perfil do paciente (nome ou código,
  idade, sexo, altura, lado acometido, queixa, observações — só neste navegador, por conta: `aiv.fisio.pacientes:<usuário>`),
  referências. Relatório HTML (abre para imprimir/salvar PDF), PNG da curva e do quadro, CSV de ADM e de testes.
  Painel `FisioPanel.js`. Hub: cartões no **Esportes** (Fisio e Studio Fisio) — sem hub "Saúde" novo para não mexer
  na barra. Gancho de teste `window.aivFisio.injetar(P, t)` (mesmo caminho do operador: `canal.processar`).

## CV-48 · Monitor de EPI (estágio 1, sem treino) — `epi.monitor`

- Pose RTMO (da cadeia ou própria) → recortes de **cabeça** (sobe ~1,5 cabeça acima dos olhos para pegar o capacete)
  e **tronco** (ombros→quadris com folga) → MobileCLIP2 contra o par de frases "COM | SEM" (configurável por item) →
  p(com) vira VOTO da pessoa rastreada (ID da sessão). Decisão pela fração de votos na janela (9, limiar 0,65):
  conforme / não conforme / incerto / verificando. Rodízio de pessoas por passada (3) na fila única do ONNX (~50 ms
  por recorte no M-series).
- Zonas = áreas "Zona de contagem"; o pé decide a zona. Conformidade = pessoa-tempo conforme ÷ decidido, por zona.
  Eventos de não conformidade e regularização; CSV.
- Borrão (padrão ligado): só o ROSTO (olhos → queixo, pelos pontos da pose), topo da cabeça visível (capacete); o
  CLIP vê o quadro original; Comparar fica desligado (Viewport) como no Takt.
- **Estágio 2**: "Coletar amostra" guarda o quadro (borrado) + caixas de cabeça/tronco rotuladas pela votação;
  "Enviar ao +Projeto" cria/usa o projeto **«EPI — estágio 2»** (classes capacete, sem capacete, colete, sem colete) e
  manda os prints pré-rotulados (`adicionarPrint` com caixas) → revisar → dataset → treinar RF-DETR → trocar por
  "Detector treinado livre".
- Painel `components/industrial/EPIPanel.js` (sem Studio, como pedido). Hub Industrial.

## Presets (Pipeline)

Industrial: "OEE — máquina sem CLP", "OEE + contagem (CounterVision)", "Monitor de EPI (capacete e colete)".
Esportes e biomecânica: "Fisio — goniometria", "Fisio — TUG", "Fisio — sentar-levantar 5×", "Fisio — sentar-levantar 30 s".
Cada um abre o painel do módulo.

## Fonte dentro dos Studios

OEE e Fisio usam `components/studio/FonteStudio.js` na barra (`classeBotao` oee-btn / fis-btn) e respeitam
`fonteStudioAberta()` no Esc.

## Testes (em /Volumes/Armazena2/zz-staging/onda1-b-tools/)

- `testes/t-oee.mjs` (node): 480 s a 30 q/s com prensa intermitente (golpe 2,2 s + 0,8 s quieta), parada 140 s, setup
  60 s com amostras sem movimento a cada 7 quadros, fonte parada 20 s → intervalos exatos (± 1 quadro), D = 260/460,
  P, parada planejada, refugo manual. `testes/t-oee-turno.mjs`: turno 09:00–09:30 com pausa 09:10–09:20 → RODANDO
  0–600, PAUSA 600–1200, RODANDO 1200–1800 s exatos.
- `testes/t-fisio.mjs` (node, pose sintética 30 q/s com ruído de 1 px): TUG 10,40 s medido 10,390 s (−9,7 ms; início
  +15,8 ms, fim +6,1 ms), fases dentro de 52 ms, marcha 0,985 m/s (verdade 1,0); 5× 12,585 (−15 ms) e até sentar
  14,014 (+14 ms); 30 s: 10, 11, 12 e 11 + meia subida; joelho sentado 90° → 91,7°.
- Navegador (Chrome headless, `run.mjs`): `r-oee.mjs` vídeo sintético (VP9) pelo painel Fonte → RODANDO/PARADA/SETUP/
  RODANDO com fronteiras dentro de 1 amostra (o headless processa ~2,5 q/s); `r-fisio.mjs` mesma pose do TUG injetada
  no Studio → 10,390 s; `r-epi.mjs` operador com quadro sintético + pose injetada: CLIP real, votos, zona, borrão, amostra
  e envio ao +Projeto (1 print, 2 caixas, 4 classes); `r-cam.mjs` câmera falsa com os 4 nós e os painéis; `r-hub.mjs`
  cartões dos hubs, abrir Studios, Esc, preset. Temas escuro/claro/Code e 390×844: `r-oee-temas.mjs`, `r-fisio*.mjs`.
  Console sem erros em todos.

## Limitações conhecidas

- Exatidão "ao quadro" vale quando o pipeline processa todos os quadros; com pipeline lento, ± 1 amostra.
- EPI: a acurácia do CLIP em cena real não foi medida (sem vídeo de obra/fábrica com pessoas na bancada de teste);
  em desenho sintético o colete saiu conforme e o capacete desenhado não — o estágio 2 existe para isso.
- Fisio: TUG em vista frontal não separa ida/giro/volta (avisa); ângulos 2D dependem do plano da câmera.
