# Roadmap — ideias abertas para contribuição

Ideias do que dá para construir **com os operadores que já existem** no iaVision (40 módulos, 80 operadores, v86). Cada linha diz o que a ideia combina e quanto falta. Quer pegar uma? Abra uma issue com o modelo **Ideia de módulo/operador** citando o número (ex.: `roadmap #I1`) para combinarmos o desenho antes do código. O passo a passo para criar um operador está no [CONTRIBUTING](../CONTRIBUTING.md#como-criar-um-operador-novo).

**Esforço**

| Sigla | Significa | Ordem de grandeza |
|---|---|---|
| **P** | *preset*: só encadear operadores existentes e salvar como preset (`PRESET_GROUPS` em `site/js/components/Panels.js`) | horas |
| **C** | código pequeno: um operador ou painel novo sobre um motor que já existe | dias |
| **T** | treino próprio: dataset rotulado no +Projeto e treino de RF-DETR ou PatchCore no Treinar | 100–300 imagens por classe |
| **M** | médio: componente novo de interface ou de dados | semanas |

**Boa para começar** (coluna ✓): não precisa de modelo novo nem de servidor, mexe em pouco arquivo e dá para testar com um vídeo comum. Ver também as issues com o rótulo `boa primeira issue`.

> Avisos que valem para várias ideias: indicadores de segurança por câmera **não são** função de segurança de máquina (são indicadores de gestão); medidas de saúde são apoio ao profissional, não diagnóstico; ideias que observam pessoas devem borrar rostos por padrão (`privacidade.borrar_rostos`) e relatar por posto/turno, não por nome (LGPD). Antes de uso comercial, confira a licença de cada modelo em [licencas.md](licencas.md).

## Indústria e qualidade

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| I1 | Leitor de manômetro e mostrador analógico (ângulo da agulha → valor, alarme fora da faixa) | `imgproc.canny`, `imgproc.find_contours`, ferramenta Ângulo, calibração de 2 pontos | C | ✓ |
| I2 | Poka-yoke de montagem manual (conferir a sequência de pegas) | `maos.gestos`, `cena.zonas`, `takt.posto`, `inspect.presenca` | C | |
| I3 | OEE por câmera para máquina sem CLP (rodando / parada / setup) | `video.frame_diff` na ROI, `contagem.esteira`, `takt.posto`, `inspect.programa` | C | |
| I4 | Defeito de superfície pixel a pixel, em mm² | `sam.mascaras` ou `seg.birefnet` + `livres.patchcore` + `inspect.defeito_area` | T | |
| I5 | Pacote "rótulo, lote e validade": receita de exemplo e guia de iluminação | `inspect.programa` (OCR de lote/validade, código, serial) | P | ✓ |
| I6 | Contagem de itens empilhados (pontas de barras, tubos, bobinas) | `inspect.blobs` ou `imgproc.find_contours` | P | ✓ |
| 53 | Diâmetro contínuo em extrusão com SPC/Cpk | paquímetro do Inspect + Cpk | P | ✓ |
| 54 | Nível de silo ou tanque pelo visor | ROI + Canny + régua calibrada + alarmes | C | ✓ |
| 55 | Gotejamento e vazamento | `video.frame_diff` na ROI + blobs + alarme | C | ✓ |
| 56 | Desalinhamento lateral de correia | bordas da correia (BeltScan) + tendência | C | |
| 57 | Marca de torque (tinta) desalinhada | ferramenta Ângulo + cor ΔE | C | |
| 58 | Cor de chama ou de forno | histograma + ΔE2000 + faixa | C | ✓ |
| 59 | Contagem de pontos de solda | `inspect.blobs` + presença por posição | C | |
| 60 | Desgaste de ferramenta de corte | paquímetro + PatchCore | T | |
| 61 | Opacidade de fumaça em chaminé (escala Ringelmann) | ROI + luminância + histórico | C | ✓ |
| 62 | Rastreio de pallet por QR | `code.scan` + `track.bytetrack` + zonas | P | ✓ |

## Logística

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| L1 | Cubagem de caixas na esteira (laser + câmera, como o BeltScan) | `beltscan.volumetria` + `contagem.rastreio` + `code.scan` | C | |
| L2 | Portaria: placa Mercosul, contêiner e lacre | `livres.rfdetr` (placa) + `ocr.ptbr` + regex + `cena.zonas` | T | |
| L3 | Empilhadeira × pedestre: quase-acidentes por zona | `rfdetr.detect` + detector treinado + `track.bytetrack` + piso calibrado | T | |
| L4 | Conferência de doca (volumes lidos × nota) | detector + `cena.zonas` + `contagem.esteira` + `code.scan` | C | |
| 63 | Cubagem estática por foto com régua | régua calibrada + máscara do SAM + 2 vistas | C | |
| 64 | Ocupação do baú do caminhão | profundidade relativa + área livre | C | |
| 65 | Leitura de etiqueta de transporte / chave de NF-e | `code.scan` + `ocr.ptbr` | P | ✓ |
| 66 | Contagem de caixas no pallet | RF-DETR treinado + faces visíveis | T | |

## Segurança do trabalho

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| S1 | Monitor de EPI por pessoa (MVP sem treino: recorte por keypoint + CLIP) | `pose.rtmo` → recortes → `clip.classify`; depois RF-DETR treinado | C/T | |
| S2 | Cerca virtual por parte do corpo (punho na zona, não a caixa inteira) | `pose.rtmo` ou `maos.gestos` + `cena.zonas` + histerese | C | ✓ |
| S3 | Pessoa caída ou imóvel | `pose.rtmo` + regra temporal + `privacidade.borrar_rostos` | C | ✓ |
| S4 | Sonolência (PERCLOS, piscadas, cabeça caindo) com histórico por turno | `olhos.iris` + `rosto.malha` | P | ✓ |
| S5 | Rascunho de avaliação ergonômica (NR-17) pela Via | `ergonomia.avaliar` + `takt.posto` + Via | C | |
| 67 | Corredor ou saída de emergência obstruída | zona + objeto parado por tempo | C | ✓ |
| 68 | Fogo por cor e cintilação, sem treino | cor HSV + `video.frame_diff` temporal | C | ✓ |
| 69 | Levantamento de carga (NIOSH) | pose + Ergonomia + régua | C | |
| 70 | Trabalho em altura sem linha de vida | `pose.rtmo` + zona de altura + detector | T | |
| 71 | Contagem no ponto de encontro (evacuação) | detecção de pessoas + zona + meta | P | ✓ |

## Varejo

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| V1 | Ruptura de gôndola e frentes por produto | detector treinado (ou Florence/CLIP no MVP) + zonas + `ocr.ptbr` | T | |
| V2 | Fila do caixa, ocupação e mapa de calor | `rfdetr.detect` + `track.bytetrack` + `cena.zonas` + `privacidade.borrar_rostos` | P | ✓ |
| V3 | Auditoria de preço (etiqueta × tabela CSV) | `code.scan` + `ocr.ptbr` + CSV | C | |
| V4 | Foto de produto para e-commerce, em lote | `seg.birefnet` + editor de vídeo | P/C | ✓ |
| 72 | Entrada e saída de clientes | detecção + rastreio + linha | P | ✓ |
| 73 | Tempo de atendimento no balcão | zonas + Takt | P | ✓ |
| 74 | Vitrine × planograma de referência | similaridade do CLIP por célula | C | |
| 75 | Mesa livre / ocupada / suja em restaurante | zonas + detecção COCO (cup, bowl) | C | |

## Agro e meio ambiente

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| A1 | Classificação de grãos e frutas por cor, tamanho e defeito | `contagem.cor` + `inspect.cor` + `inspect.forma` + `inspect.defeito_area` | P/T | |
| A2 | Contagem de gado no brete ou corredor | `rfdetr.detect` (cow, sheep, horse) + `contagem.rastreio` + linha | P | ✓ |
| A3 | Peso estimado pela área dorsal | máscara + régua calibrada + regressão calibrada com balança | C | |
| A4 | Vigia de fumaça (alerta para um humano confirmar) | `video.background_subtractor` + `clip.classify` + `florence2.tarefa` | P/T | |
| A5 | Composição de resíduos na esteira de triagem | detector treinado + `clip.classify` + `contagem.esteira` | T | |
| A6 | Contagem de peixes em escada ou tanque | detector treinado + `contagem.rastreio` + linha nos dois sentidos | T | |
| 76 | Índice de verde (ExG) de pasto ou lavoura pelo celular | cor por pixel + área | C | ✓ |
| 77 | Insetos em armadilha adesiva | blobs + contagem + histórico | C | ✓ |
| 78 | Contagem de ovos ou pintinhos em esteira | CounterVision por cor | P | ✓ |
| 79 | Contagem de frutos na planta | YOLOE/Florence por texto → RF-DETR | T | |
| 80 | Escore de locomoção de bovinos | rastreio + trajetória + ritmo | C | |

## Saúde e reabilitação

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| H1 | Goniometria (amplitude de movimento) com protocolos guiados | `dnn.pose` ou `pose.rtmo` + ferramenta Ângulo + relatório no padrão do Bike Fit | C | |
| H2 | Testes funcionais do idoso (TUG, sentar e levantar) | `dnn.pose` + lógica de fases do Salto e da Corrida + linha de 3 m | C | |
| H3 | Exercício em casa com correção por voz | `academia.treino` + síntese de voz do navegador | C | |
| H4 | Assimetria facial (expressões guiadas) | `rosto.malha` + `olhos.iris` | C | |
| H5 | Higiene das mãos e queda, só com esqueleto | `maos.gestos` + zonas + regra de queda (S3) | C | |
| 81 | Frequência respiratória pelo movimento do tórax | ROI + sinal de movimento + FFT | C | ✓ |
| 82 | Frequência cardíaca sem contato (rPPG) | `rosto.malha` + canal verde + FFT | C | |
| 83 | Tremor de mão (frequência e amplitude) | `maos.gestos` + FFT | C | ✓ |
| 84 | Postura estática (ombros, pelve) | pose + linhas de referência + relatório | C | |
| 85 | Exercícios orofaciais (fonoaudiologia) | `rosto.malha` + amplitude | C | |
| 86 | Marcha clínica (velocidade, passada, apoio) | motor da Corrida + piso calibrado | C | |

## Esportes

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| E1 | Câmera de jogo amador com recorte que segue a bola | `quadra.analise` + editor (recorte e Ken Burns) | M | |
| E2 | Fotocélula virtual (sprint 10/20/30 m, agilidade) | `cena.zonas` + quadril do `pose.rtmo` + interpolação entre quadros | C | ✓ |
| E3 | Comparar com o movimento de referência (alinhamento DTW) | `dnn.pose` + quadros-chave do `swing.analise` + editor | C | |
| 87 | Pular corda: saltos e ritmo | pose + motor do Salto | C | ✓ |
| 88 | Golpes de boxe e luta: contagem e velocidade | pose + punhos + régua | C | |
| 89 | Arremesso de basquete: ângulo de soltura e acerto | pose + rastreio da bola + zona do aro | C | |
| 90 | Natação: braçadas e ritmo | pose + ciclo (Academia) | C | |
| 91 | Yoga: pose de referência e tempo sustentado | pose + comparação com referência | C | |

## Educação

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| D1 | Laboratório de física por vídeo (posição × tempo, CSV e gráfico) | `sam2.seguir` ou `track.bytetrack` + régua + editor | C | |
| D2 | Bateria de testes físicos escolares | `salto.teste` + E2 + `academia.treino` | C | |
| D3 | Contagem de colônias e células | `imgproc.clahe` + `inspect.blobs` + `contagem.cor` | P | ✓ |
| 92 | Correção de gabarito (OMR) | ROI + blobs por alternativa + CSV | C | ✓ |
| 93 | Quadro branco → texto e resumo | `ocr.ptbr` + Florence + Via | P | ✓ |
| 94 | Mãos levantadas em sala, sem identificação | `pose.rtmo` + contagem | C | |

## Mobilidade, construção e cidade

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| T1 | Contagem volumétrica classificada (carro, moto, ônibus…) por 15 min | `rfdetr.detect` + `track.bytetrack` + `cena.zonas` + `contagem.esteira` | P | ✓ |
| T2 | Velocidade média entre linhas e ocupação de vagas | `cena.zonas` + homografia da Quadra + rastreio | C | |
| T3 | Buracos e trincas em vídeo rodado | detector treinado em dataset público + rastreio | T | |
| T4 | Vistoria de dano em veículo (entrada × saída) | detector treinado + `sam.mascaras` + Via | T | |
| C1 | Diário de obra rascunhado pela Via | `rfdetr.detect` + zonas + `florence2.tarefa` + timelapse + Via | M | |
| C2 | Medição de fissuras em mm | `sam.mascaras` + Canny + régua ou ArUco | C | |
| C3 | EPI e zonas no canteiro | S1 + S2 + `relate.graph` | T | |
| 98 | Leitura de hidrômetro ou display de 7 segmentos | ROI + `ocr.ptbr` / leitor de 7 segmentos | C | ✓ |
| 99 | Lixeira cheia, vaga de bicicleta ou patinete | zonas + ocupação | C | ✓ |
| 100 | Resumo de vídeo por eventos (linha do tempo de movimento) | `video.background_subtractor` + editor | C | |

## Acessibilidade e mídia

| # | Ideia | Combina | Esf. | ✓ |
|---|---|---|---|---|
| X1 | "O que tem na minha frente?" falado | `florence2.tarefa` + `ocr.ptbr` + `code.scan` + síntese de voz | C | |
| X2 | Mouse por cabeça e piscada (dentro da página) | `rosto.malha` + `olhos.iris` | C | |
| X3 | Sinais isolados de Libras (vocabulário fechado) | `maos.gestos` + `rosto.malha` + classificador leve | C | |
| M1 | Auto-reframe 9:16 seguindo o sujeito | `sam2.seguir` ou `reid.pessoas` + editor (Ken Burns) | C | |
| M2 | Cortes por fala: legenda, capítulos, melhores trechos | Whisper local + Via + editor | M | |
| M3 | Anonimização para publicar (rostos e placas) | `privacidade.borrar_rostos` + detector de placa | P/T | ✓ |
| M4 | Croma sem tela verde e fundo desfocado | `seg.birefnet` ou `dnn.segment_person` | P | ✓ |
| 95 | Corte de cena automático (marcadores no editor) | `video.frame_diff` + histograma → editor | C | ✓ |
| 96 | Melhor quadro para miniatura (nitidez + rosto) | Laplaciano + YuNet → editor | C | ✓ |
| 97 | Tempo de tela de um logo no vídeo | presença NCC do Inspect + cronômetro | P | ✓ |

## Combinações criativas

| # | Combinação | Para quê | Esf. |
|---|---|---|---|
| K1 | Via + Florence-2 + OCR + contagens → relatório de turno automático | passagem de turno, diário de obra | M |
| K2 | Florence-2 ou YOLOE pré-rotula → +Projeto → RF-DETR livre ("destilação") | detector novo em horas, Apache-2.0 no runtime | C |
| K3 | SAM + PatchCore → defeito em mm² só dentro da peça | inspeção de superfície com laudo | C/T |
| K4 | CLIP + Whisper → busca semântica em vídeos gravados | "caminhão no portão", "quando falaram de vazamento" | M |
| K5 | Mãos + zonas + Takt → poka-yoke de sequência | montagem manual com tempo-padrão | C |
| K6 | Detector + Relações → regras ("pessoa sob carga") | segurança sem treinar uma classe por situação | C |
| K7 | Whisper + pose → coaching por voz | academia em casa, reabilitação | C |
| K8 | Pose + piso calibrado → medidas reais em metros | distância pessoa–máquina, passada | C |
| K9 | Quadra + editor + Whisper → lances narrados | escolinhas e quadras | M |
| K10 | `code.scan` + OCR + Via → documento × físico | recebimento em CD, devoluções | C |
| K11 | Malha do rosto + olhos + mãos → interface sem toque | acessibilidade, ambientes estéreis | C |
| K12 | SAM 2 + régua + editor → trajetória para física e ensaios | ensino, ensaios de queda e impacto | C |

## Plataforma (não é ideia de operador, mas ajuda muito)

| Tema | O que fazer | ✓ |
|---|---|---|
| Testes em GPUs e celulares | Medir e validar a lista `EP_WEBGPU` (`site/js/cv/runtime/onnx.js`) em GPUs Intel, AMD, NVIDIA, Android e iPhone; relatar com o modelo de issue de bug | ✓ |
| Testes automatizados | Página de teste que roda cada operador numa imagem fixa e compara a saída (ver [deploy-e-testes.md](deploy-e-testes.md)) | |
| Tradução | Interface e docs em inglês e espanhol (hoje os textos estão no código, em português) | |
| Documentação | Guias passo a passo por Studio, vídeos curtos, exemplos de preset | ✓ |
| Acessibilidade da interface | Navegação por teclado e leitores de tela nos painéis | |
