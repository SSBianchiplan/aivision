# Esportes e biomecânica

O painel **Esportes** (botão de troféu na barra) é a porta de entrada dos módulos de esporte e biomecânica. Cada módulo tem um cartão com **Abrir** (abre o painel do módulo) e **No Pipeline** (põe o operador na cadeia, como os presets fazem). Todos funcionam com câmera, arquivo de vídeo ou YouTube como fonte. Use o **zoom** da barra de vídeo para enquadrar a pessoa: o que fica maior na tela é o que a pose analisa.

Os painéis de esporte, o Studio e o Bike Fit 3D são carregados **sob demanda**, na primeira vez em que são abertos.

| Módulo | Operador | O que mede |
|---|---|---|
| CV-28 Bike Fit | `bikefit.analise` | ângulos do ciclista por pedalada, cadência, KOPS, vista frontal; faixas por modalidade — ver [bike-fit.md](bike-fit.md) |
| Studio Bike Fit | (tela cheia sobre o CV-28) | vídeo com ângulos, curvas por articulação, indicadores, tabela, recomendações, perfil do atleta |
| Bike Fit 3D (protótipo) | (tela própria) | duas ou três câmeras calibradas por 5 cliques: esqueleto 3D, deslocamento lateral do joelho — ver [bike-fit-3d.md](bike-fit-3d.md) |
| CV-29 Ergonomia | `ergonomia.avaliar` | nota RULA/REBA por pessoa, tempo em cada nível de risco, postura crítica, recomendações |
| CV-30 Academia | `academia.treino` | repetições, séries, amplitude e alertas de forma em 9 exercícios (automático ou manual) |
| CV-31 Salto | `salto.teste` | CMJ, squat jump, drop jump (RSI), saltos contínuos e horizontal, com margem de erro |
| CV-32 Corrida | `corrida.marcha` | cadência, contato, voo, pisada, overstriding, oscilação, tronco, simetria; uma ou várias pessoas |
| CV-33 Swing | `swing.analise` | fases, tempo, rotação de quadril e ombros, X-factor e quadros-chave (golfe e raquete) |
| CV-34 VBT | `vbt.barra` | velocidade, potência e perda de velocidade por repetição (marcador impresso ou sem marcador) |
| CV-35 Quadra | `quadra.analise` | jogadores, times, radar, mapa de calor, distância e velocidade (futsal, basquete, vôlei, tênis, padel, futebol) |

Os parâmetros de cada operador estão no [catálogo](modulos.md).

## Studio Bike Fit

Tela cheia no estilo de estúdio de bike fit (nome na tela: **GPlanSiS|StudioBikeFit**), aberta pelo hub ou pelo painel Bike Fit.

- **Vídeo** com os ângulos desenhados, copiado do canvas do app (o que o pipeline vê). A barra de vídeo continua disponível por cima.
- **Curvas** por articulação com a faixa-alvo, marcas de PMS/PMI e o modo **Ciclo médio** (a pedalada média com a dispersão).
- **Indicadores** (rpm, pedaladas, lado, poses/s, perfil), **tabela** das últimas pedaladas com média ± desvio, **avisos** e **recomendações**.
- **Lateral / Frontal**, **Congelar curvas**, **Exportar PNG**, **Gravar vídeo**, **Relatório**.
- Botão **Pipeline**: abre o pipeline num popover (no celular, gaveta inferior), com os presets de esporte primeiro.

### Perfil do atleta e alvos personalizados

Em **Ajustes › Atleta** (ou no painel Bike Fit, seção "Atleta e alvos personalizados") cadastra-se altura, peso, entreperna, idade, sexo, flexibilidade, nível, objetivo e dores. As faixas-alvo se ajustam por regras cumulativas, com limite (tronco no máximo +15°, quadril +10°):

| Regra | Gatilho | Efeito | Fontes |
|---|---|---|---|
| R1 | IMC ≥ 30, flexibilidade baixa, idade ≥ 50, iniciante, objetivo conforto | 1–2 fatores: tronco +5°, quadril +5°; 3 ou mais: tronco +10° | Burt 2014; de Vey Mestdagh 1998; Fonda & Šarabon 2010 |
| R2 | flexibilidade baixa, ≥ 50 anos, iniciante ou conforto | joelho no PMI limitado a mín + 5 | Holmes, Pruitt & Whalen 1994; Bini, Hume & Croft 2011 |
| R3 | competitivo ou aerodinâmica, flexibilidade alta, sem dor lombar e sem fator R1 | tronco −5° | Fintelman et al. 2014 |
| R4 | dor no joelho anterior | PMS mín +5°, PMI mín +3° | Holmes 1994; Bini 2011; Callaghan 2005 |
| R5 | dor lombar | tronco +5°, quadril +5° | Van Hoof et al. 2012; Marsden & Schwellnus 2010 |

Altura e peso sozinhos não mudam ângulos (só pelo IMC); KOPS, ankling, cotovelo e tornozelo ficam na faixa da modalidade. Cada alvo mostra o **porquê**; alvos personalizados aparecem em amarelo com "•", e qualquer alvo pode ser editado à mão (✎, "Voltar ao calculado"). **Medidas sugeridas** (ponto de partida): altura do selim LeMond 0,883 × entreperna e Hamley 1,09 × entreperna, pedivela por faixa de entreperna (Martin & Spirduso 2001); sem entreperna, ela é estimada em 0,46 × altura. Perfil, alvos e medidas vão para o relatório, o JSON e o CSV.

> As regras são julgamento clínico a partir da literatura, não algoritmos validados. Servem de ponto de partida para o profissional.

## Corrida com várias pessoas

`pessoas: 'uma (completo)' | 'várias'`. Em "várias", cada corredor ganha um número fixo e números próprios; a tabela permite escolher qual detalhar. Duas fontes de pose:

- **RTMO (todas)**: uma rede para todos (17 pontos; sem calcanhar/ponta — contato pelo tornozelo). Não funde corredores encostados.
- **BlazePose por recorte**: um recorte por corredor (33 pontos), mais barato até ~3 corredores.

Proteções: pose com proporções impossíveis (corredores fundidos) é descartada e desenhada em cinza; apoio calculado por passo (não passa de 50 % com fase de voo); ângulo de contato só entre 90° e 178°; **câmera em movimento** detectada pelo fundo — oscilação e distâncias ficam em branco, cadência e ângulos continuam. Abaixo de 8 quadros/s de pose os passos não são amostrados: use "Analisar vídeo quadro a quadro".

**Limite conhecido:** em vídeo de frente ou na diagonal a cadência pode sair pela metade; prefira filmar de lado ou de trás.

## VBT sem marcador

Além do marcador ArUco impresso (`site/marcadores/aruco-4x4.html`, erro ≈ 0,8 %), o VBT mede sem marcador pela pose: ponto rastreado por exercício (no hip thrust, o quadril), escala pelo segmento do corpo ou por 2 cliques numa medida conhecida, referência vertical e rejeição de ruído (erro sintético 1,5–1,8 %).
