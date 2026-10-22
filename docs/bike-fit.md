# Bike Fit (CV-28)

Análise biomecânica do ciclista pela câmera, no navegador: ângulos articulares por pedalada, cadência, KOPS e alinhamento frontal do joelho, com faixas por modalidade e sugestões de ajuste. Código próprio sobre YOLOX + BlazePose (33 pontos, com calcanhar e ponta do pé). Nada sai do navegador.

## Como usar

1. Abra o painel **Bike Fit** e clique em **Adicionar ao Pipeline** (ou use o preset *Bike Fit lateral* / *frontal* no Pipeline).
2. Escolha a fonte: câmera, vídeo gravado (arquivo) ou YouTube **como fonte** (no YouTube "só assistindo" o pipeline não vê a imagem — use *Analisar este vídeo no pipeline*).
3. Escolha **perfil** (Estrada, Mountain bike, Contrarrelógio/Triathlon, Urbano/Conforto), **vista** (lateral/frontal) e, se quiser medidas em cm, a **altura** do ciclista.
4. Pedale 1–2 min em cadência constante. A tabela mostra o valor atual, média ± desvio das últimas N pedaladas e a faixa alvo, com recomendações.
5. Exporte **CSV**, **JSON** ou o **relatório HTML** (imprimir/salvar em PDF).

### Como filmar

Câmera de lado, perpendicular à bicicleta, na altura do movimento central, a ~3 m; corpo inteiro no quadro (cabeça ao pedal); celular em paisagem num tripé; roupa justa e contrastante; boa luz, sem contraluz. Para a vista frontal, câmera à frente, alinhada ao eixo da bicicleta, na altura do selim. Prefira gravar sem espelho (o Bike Fit desfaz o espelho da câmera, mas a pose é um pouco melhor sem ele).

## Medidas

Ângulos internos em 2D (180° = reto):

| Medida | Pontos | Momento |
|---|---|---|
| Joelho PMI | quadril–joelho–tornozelo | máximo da pedalada (pé embaixo) |
| Joelho PMS | idem | mínimo (pé em cima) |
| Quadril | ombro–quadril–joelho | fechamento mínimo |
| Tronco | quadril→ombro vs. horizontal | médio |
| Ombro | quadril–ombro–cotovelo | médio |
| Cotovelo | ombro–cotovelo–punho | médio |
| Tornozelo / ankling | joelho–tornozelo–ponta do pé | no PMI / amplitude no ciclo |
| KOPS | joelho vs. eixo do pedal estimado com o pé às 3 h | % da perna (+ = joelho à frente) |
| Frontal | desvio do joelho da linha quadril–tornozelo | % da perna, dentro/fora; simetria |

### Faixas por perfil

| | Estrada | MTB | Contrarrelógio/Tri | Urbano |
|---|---|---|---|---|
| Joelho PMI | 140–150 | 140–150 | 140–150 | 140–155 |
| Joelho PMS | 65–80 | 65–80 | 65–80 | 70–85 |
| Quadril mín. | 45–60 | 50–68 | 40–55 | 60–90 |
| Tronco | 35–50 | 45–60 | 15–30 | 55–80 |
| Ombro | 80–95 | 75–95 | 80–100 | 55–85 |
| Cotovelo | 150–165 | 145–165 | 85–110 | 150–175 |
| KOPS (%) | −7 a 1 | −9 a 0 | −3 a 5 | −12 a 0 |

Referências: Holmes 1994 (25–35° de flexão estática, ~30–40° dinâmica), Bini 2011, Ferrer-Roca 2012 e faixas usuais de Retul/BG Fit. Tornozelo e ankling são indicativos. A sugestão de altura do selim vem da lei dos cossenos (≈3,5° por cm).

## Ciclo de pedalada

Sinal = altura do tornozelo do lado da câmera (suavizada). PMI/PMS confirmados quando o sinal volta 30% da amplitude recente (amplitude mínima 15% da perna); o extremo do ângulo sai de um ajuste quadrático em volta da amostra extrema. Cadência = média dos últimos períodos sem outliers; mudança de ritmo é aceita quando 3 períodos novos concordam; parado > 3 s apaga a cadência. Pedalada exige movimento real na imagem (foto parada não conta).

## Qualidade e avisos

Pouca luz, pose instável (coxa/canela variando > 15%), ciclista pequeno ou cortado, câmera fora da vista escolhida, perna do lado oposto: os avisos aparecem no painel e, se > 30% dos quadros recentes tiverem aviso, as recomendações viram "indicativas".

## Validação

- Testes sintéticos (node): 90/60/110 rpm medidos como 90,3/60,9/111,0; joelho no PMS a 0,6° da verdade.
- Vídeo real em rolo (Commons, CC BY 2.0): ~110–119 rpm (referência independente ~110), joelho PMI 142–145° ± 7 (referência YOLO26-pose 147,8°), tronco 35°. Mesmo resultado como **arquivo** e como **câmera** (simulada).
- YouTube como fonte: o fluxo funciona (captura → pipeline → Bike Fit); a qualidade depende do vídeo (corpo inteiro, de lado, sem desenhos sobrepostos).

## Limitações

Medida sem marcadores: o joelho no PMI varia ±5–8° entre pedaladas e o KOPS é aproximado. Posição aero com pernas borradas pode falhar. A vista frontal ainda não foi validada com vídeo real.
