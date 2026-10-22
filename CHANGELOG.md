# Histórico de versões

As versões seguem o `VERSION` do service worker (`site/sw.js`).

## v87–v91 — 2026-10-22
- **Página principal no celular:** cartões animam sem mouse, assinatura reage ao toque e passa em onda, mini-animações seguem com "reduzir movimento".
- **Fonte dentro dos Studios (v88):** botão Fonte nos 6 Studios (câmeras, resolução/fps, Wi-Fi/IP, arquivo, tela, YouTube); troca de câmera a quente, reconexão após desconexão, fim dos vazamentos de MediaStream. Ver [docs/fonte-nos-studios.md](docs/fonte-nos-studios.md).
- **Editor de vídeo (v89):** Seguir sujeito / reenquadrar em 9:16, 1:1, 4:5 e 16:9 com keyframes editáveis; exportação gira vídeos de celular em pé. Ver [docs/video-seguir.md](docs/video-seguir.md).
- **Onda 1 das 100 ideias (v90–v91):** 48 módulos e 94 operadores. Tráfego com matriz de giro, leitor de manômetro e display de 7 segmentos, cerca virtual por parte do corpo e pessoa caída, sprint, chave NF-e e pallet por QR, mapa de calor genérico, painel Medições, presets novos; Studios **OEE** e **Fisio**, **Monitor de EPI**. Ver [docs/medicoes.md](docs/medicoes.md) e [docs/oee-fisio-epi.md](docs/oee-fisio-epi.md).

## Repositório — 2026-10-21
- README completo com capa, telas, arquitetura e chamado para colaboradores; `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, modelos de issue e de PR; [roadmap](docs/roadmap.md) com as ideias abertas para contribuição.
- `ferramentas/servir.py` (servidor local com COOP/COEP) e `ferramentas/baixar-wasm.sh` (`.wasm` do ONNX Runtime Web 1.20.1 e 1.29.0).
- Docs atualizadas para a v86 (40 módulos, 80 operadores, 81 presets) e caminhos `servicos/*`.

## v86 — 2026-10-21
- **Página principal** (`site/index.html`) refeita com todas as novidades: Industrial (BeltScan, CounterVision, Takt, Inspect), Via, +Projeto, editor GPlanSiS|Vídeo, Esportes e Studio Bike Fit, números tirados do próprio registro (40 módulos, 80 operadores).
- **CTAs mais fortes** (entrar no sistema, Treinar, código-fonte) e **animações por módulo** nas visualizações dos modelos; continua autocontida, no mesmo tema e design.

## v84–v85 — 2026-10-21
- **Editor de vídeo:** duração certa dos `.mov` do iPhone/Fotos (`ctts` v0 com deslocamento negativo era lido sem sinal: 17 s viravam 39 h) e edit list aplicada por completo; miniaturas e forma de onda em Workers (WebCodecs); linha do tempo em duas camadas. Arrastar o playhead 5,5 → 33 q/s, memória 65 → 10 MB. Safari: exportação com som sem `AudioEncoder`, pinça na timeline.
- **Desempenho geral:** a fonte é lida uma vez por quadro quando todos os operadores pedem o quadro pleno (BeltScan 13 → 28 fps), tamanho do canvas por `ResizeObserver`, formatador de números em cache, fps da barra em componente próprio, redesenhos de ferramentas e Studio CounterVision só com quadro novo, Markdown da Via memorizado, service worker regrava o cache só quando o arquivo muda. Ver [docs/desempenho.md](docs/desempenho.md).

## v82–v83 — 2026-10-21
- **Safari (macOS):** o YouTube abre numa janela própria (`/yt/player.html`, servida sem COEP) comandada pela barra de vídeo; a análise usa o compartilhamento dessa janela com recorte automático e "Ajustar recorte". Também no Safari: Copiar imagem, pinça do trackpad, Whisper com volta para WASM e vidro desfocado com `-webkit-backdrop-filter`.
- **Studio Bike Fit** nos 3 temas, com opção de exportar no tema iaVision escuro.
- Treinar: textos finais do YouTube.

## v80–v81
- **Câmeras** na Fonte e no Treinar: USB e Continuidade, Wi-Fi/IP por WHEP (MediaMTX); Bluetooth explicado. Senhas de câmera não são guardadas.
- Correção: máscara do MobileSAM (CV-13) fora do lugar em proporções diferentes de 3:2 (IoU 0,75 → 0,985 em 4:3).

## v78–v79
- **Grade invisível** com ímã para os widgets, menu de clique direito na tela principal, recolher padronizado ao lado do X, Player e Ferramentas na disposição padrão.
- YouTube tenta de novo pelo outro domínio do player quando não inicia.
- **23 ferramentas novas** de mouse e popover "⋯" no widget Ferramentas.

## v74–v77
- **Treinar:** imagens por print colado/arrastado e quadros do YouTube, sem URLs (serviço de treino 2.2.0 com metadados e origens).
- **+Projeto:** menu de contexto sobre áreas da imagem, pastas de treino com nome, marcações totalmente editáveis.
- **GPlanSiS|Vídeo:** editor com controle de quadros, cut, crop, seleção e zoom da linha do tempo; exportação MP4 quadro a quadro (WebCodecs + mp4-muxer).
- **Tema iaVision** (escuro estilo editor de código) com realce amarelo e secundária turquesa.

## v73 — 2026-10-21
- **Inspect, parte 2:** ferramentas de lote/validade (OCR + regex, datas, GS1/GTIN), código com verificação, serial com controle de sequência, detecção com classes exigidas/proibidas, classificação conformal e anomalia PatchCore com mapa de calor. Correção: o ZXing do CV-10 voltou a tentar as passadas girada e invertida (34/48 → 47/48).

## v72
- **Inspect, parte 1 (CV-40):** presença, contagem, paquímetro em mm, cor ΔE2000, forma e área de defeito em JS puro; programas versionados; gatilhos; veredito OK/NOK/INCERTO; revisão humana; Cpk; Studio GPlanSiS|Inspect.

## v71
- **CounterVision (CV-38):** contagem em esteira por cor ou detector + rastreio, linha/zona, metas por turno, taxa, alarmes, dataset YOLO e envio ao Treinar; Studio GPlanSiS|CounterVision.

## v69–v70
- **Takt (CV-39):** tempo de posto pela pose (produtivo, ocioso, vago, pausa), turnos, piso em metros por homografia, borrão de rostos (LGPD); Studio GPlanSiS|Takt.
- **Organizador de layout:** painéis em colunas sem sobreposição, área mínima do vídeo, widgets que se evitam, sem rolagem horizontal.
- Comparar desligado quando o borrão de rostos está ativo (LGPD).

## v66–v68
- **Via:** anexos de imagem, envio ao Treinar, base de conhecimento em PostgreSQL (serviço aivision-via) com busca e LGPD; Treinar sem senha para admin (SSO pela sessão).
- Widget **Seção da correia** e "Editar na imagem" do BeltScan.
- **Tema claro** revisado (contraste WCAG AA em todas as telas); botão Entrar do login legível.

## v63–v65
- **Industrial / BeltScan (CV-36):** volumetria de correia por triangulação a laser, alarmes ISA-18.2, ensaios de bancada; Studio GPlanSiS|BeltScan.
- Barra do topo em grupos, **avatar** com menu, botão **Player**.
- **Qualidade de vídeo:** câmera até 4K/60, quadro pausado em resolução cheia, gravação até 25 Mbit/s, qualidade do YouTube pelo tamanho do player, fundo claro no tema claro.

## v58–v62
- **Playlists do YouTube** com categorias; seções recolhíveis no painel Fonte; linhas da pose estáveis com o vídeo pausado.
- **Via (v61):** assistente de IA com a chave Anthropic do usuário, comandos para os modelos que aceitam texto e biblioteca de comandos.
- **Ferramentas de mouse (v62, CV-37):** área, polígono, ROI, exclusão, linha de contagem, régua calibrada, ângulo, conta-gotas; zonas e cruzamentos.

## v56–v57 — 2026-10-21
- Barra de vídeo **recolhível**: botão no canto do controle transforma a barra numa faixa fina com todos os botões pequenos e a linha do tempo (no celular, duas linhas finas). A escolha fica guardada no aparelho.

## v55 — 2026-10-21
- **WebGPU de verdade**: o `ort.min.js` não trazia o backend WebGPU e tudo caía em WASM sem aviso. Agora o app testa o adaptador, carrega `ort.webgpu.min.js` e usa a GPU por modelo (lista `EP_WEBGPU`), com queda automática para WASM. Pose 2,6×, YOLOX 4×, RTMO 3,8× mais rápidos.
- **Fila de inferência com prioridade**: modelos lentos não derrubam mais a pose (Bike Fit + profundidade + detecção + rosto: 0,9 → 13,4 poses/s).
- **Abertura sob demanda**: a tela de login carrega 5 módulos em vez de 151 (4G simulado: ~10 s → 1,4 s); o sistema vem em segundo plano e os painéis grandes ao abrir.
- **Studio Bike Fit** redesenha só o que mudou (CPU do Studio 11 % → 5 % tocando, ~0 % pausado).
- Ver [docs/desempenho.md](docs/desempenho.md).

## v54 — 2026-10-21
- **Perfil do atleta** no Studio e no painel Bike Fit: altura, peso, entreperna, idade, flexibilidade, nível, objetivo e dores ajustam as faixas-alvo com regras citadas na literatura; edição manual por alvo; medidas sugeridas (LeMond, Hamley, pedivela); tudo no relatório e no CSV.
- Botão **Pipeline** dentro do Studio (popover; gaveta no celular).
- Pesos dos modelos num cache fixo do service worker (não são mais apagados a cada publicação); primeira visita sem recarga dupla; canvases de leitura com `willReadFrequently`; celular sem vidro desfocado.

## v52–v53 — 2026-10-20
- **Corrida com várias pessoas** (RTMO ou BlazePose por recorte), descarte de poses fundidas, correção de "apoio 198 %" e "contato 180°", detecção de câmera em movimento; presets "Corrida — várias (prova)" e "Corrida — 2–3 corredores (33 pontos)".

## v43–v51 — 2026-10-20
- Hub **Esportes** e seis módulos novos: Ergonomia RULA/REBA (CV-29), Academia (CV-30), Salto (CV-31), Corrida (CV-32), Swing (CV-33), VBT (CV-34) e Quadra para esportes coletivos (CV-35). Ver [docs/esportes.md](docs/esportes.md).
- **Studio Bike Fit** (GPlanSiS|StudioBikeFit) no tema do iaVision: vídeo com ângulos, curvas com faixa-alvo e Ciclo médio, indicadores, tabela, avisos e recomendações, barra de vídeo dentro do Studio.
- **Bike Fit 3D** (protótipo) com especificação de câmeras — ver [docs/bike-fit-3d.md](docs/bike-fit-3d.md).
- **Zoom digital** da fonte (o modelo recebe o recorte) e botão **Repetir** para vídeos.
- **VBT sem marcador** recalibrado (ponto por exercício, escala por segmento ou 2 cliques).

## v42 — 2026-10-20
- Barra de vídeo: com o YouTube "só assistindo", botão **▶ Analisar este vídeo no pipeline**; o Bike Fit avisa quando o vídeo não está alimentando o pipeline.
- CV-16 (treinados YOLO26) marcado como AGPL no catálogo.

## v41
- **Teclas de mídia** do teclado (Windows, macOS, Linux) controlam o player do YouTube (Media Session + áudio silencioso), com título, canal e miniatura no controle de mídia do sistema.

## v40
- Barra de vídeo controla o player do YouTube: ±10 s, tocar/pausar, linha do tempo do vídeo, velocidade e som.

## v39 — versão final das ondas
- **Bike Fit** (CV-28) com widget, presets e relatório.
- **Fonte YouTube** por streaming do player oficial + Element/Region Capture; busca; quadros para o Treinar.
- Regressão completa (5 revisores): Relações e YOLOE por texto deixam de travar após a 1ª inferência; YOLO26 caixas orientadas com saída na ordem certa; OCR/re-ID/pose/SAM com cópia do quadro; telas no celular e no notebook; espaços em textos.
- Correção: Pose (BlazePose), OCR clássico e rastreio YOLO26 não carregavam o 2º modelo.
- Caddy: cache de `.onnx_data` e das páginas de diretório; serviço de busca com validação de ID mais rígida; contêiner de treino com limite de processos; pacote AGPL completo.
- Página inicial e tela de espera com 28 módulos / 58 operadores.

## v38
- Treino livre: RF-DETR e anomalia PatchCore, treinos com nome, fila e comparação; operadores CV-24.

## v37
- Grupo A: OCR em português (PP-OCRv5 latino), pose RTMO, re-identificação, recorte de fundo BiRefNet.

## v36
- Fila única de inferência (o proxy do ONNX Runtime misturava respostas de modelos simultâneos); MobileSAM com vários objetos; espelho automático para mãos; guia dos módulos livres no Config.

## v35
- Grupo B: Florence-2, SAM 2.1, RF-DETR. Grupo D: mãos e gestos, malha do rosto, olhos e sonolência.
- Painel **Coisas** (listas do YOLOE com busca em português). Caixa de rosto (YuNet) no lugar certo. Celular: painéis abaixo da barra; CSS versionado.

## v28–v34
- Slogan "na tela e na palma da sua mão" e nome GPlanSiS|iaVision em todas as páginas; seção de funcionalidades; widget de Modelos (empilhamento, contador, **Carregar todos**); controles de vídeo menores; barra do topo que se ajusta; presets do Pipeline para todos os módulos; Config › Modelos livres.

## Migração — 2026-10-19/20
- iaVision migrado da hospedagem compartilhada para a vps2 (Caddy), login PHP mantido na hospedagem gplansis.com via proxy, módulo **Treinar** (YOLO26) e código-fonte AGPL publicado.
