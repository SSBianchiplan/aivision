# Segurança predial, NR-17, varejo, ocupação, medidores e resumo de vídeo (CV-60 a CV-67)

Grupo novo `livres-s`: 8 módulos, 12 operadores. Nenhum modelo novo (reaproveita RTMO, RF-DETR/YOLOX, PP-OCRv5,
leitor de códigos, MobileCLIP2 e BiRefNet). Total do app: 56 módulos / 106 operadores.
Os resultados ficam no painel **Medições** (seções novas em `js/components/medicoes-livres-s.js`); os presets novos
estão em `js/components/presets-onda2b.js` (grupos Segurança do trabalho, Varejo, Cidade e casa, Trânsito).
Nada sai do navegador. As tabelas e as referências ficam no localStorage, só como números; não há imagem.

## Módulos e operadores

| Módulo | Operador | Ideia | Marcação (função) | O que faz |
|---|---|---|---|---|
| CV-60 Ergonomia aplicada (NR-17) | `aep.posto` | S5 | `takt_posto` (existente) | Junta por posto a Ergonomia RULA/REBA (CV-29), o tempo em cada nível de risco, a pior postura (miniatura com rosto borrado), os alertas (faixa alta por ≥ N s), os KPIs do Takt e o IL do NIOSH. Calcula a prioridade sugerida e gera um relatório HTML para imprimir ou salvar em PDF, além de um CSV. **É um rascunho de apoio ao ergonomista e não substitui a AEP nem a AET.** |
| | `ergonomia.niosh` | 69 | régua calibrada (opcional) | Usa a equação revisada do NIOSH (Waters 1993). H e V vêm da pose, com a escala da régua ou da estatura. O nó detecta o levantamento por zigue-zague com histerese (origem → destino, D). A carga, a pega, a duração, a assimetria e a frequência (opcional) são entradas manuais. Dá LPR e IL na origem e no destino; o IL da tarefa é o maior dos dois. |
| CV-61 Segurança predial (indicativo) | `seguranca.saida_obstruida` | 67 | `saida_emergencia` | Detecta objeto PARADO na área: diferente da cena vazia e igual ao quadro de ~1 s atrás, ocupando ≥ X % da área por N s. O ganho de luz global é compensado e as caixas de pessoa são excluídas. A cena vazia é capturada sozinha com 3 s de cena parada ou pelo botão no Medições. Alarme ISA-18.2. |
| | `seguranca.fogo` | 68 | — (ROI/exclusão padrão) | Junta a cor de chama (regra de Chen 2004) com a cintilação (EMA de \|ΔR\|). Alarma só se a fração da cor que tremula e a área passarem dos limites por N s. **É indicativo e não substitui detector certificado nem a NBR 17240.** |
| CV-62 Varejo | `varejo.preco` | V3 | `gondola_etiquetas` | Lê cada área em resolução plena com o OCR PT-BR e o leitor de EAN. Sem área, usa `ctx.textos`/`ctx.codigos` da cadeia. Cada preço vira a âncora de uma etiqueta: a descrição e o EAN são os mais próximos, e o preço/kg pequeno é descartado. A etiqueta é conferida com a tabela CSV importada no Medições, pelo EAN ou por Dice da descrição. Saída: lista de divergências e CSV. |
| | `varejo.planograma` | 74 | `planograma` | Divide a área numa grade de L×C células. Compara cada célula com a referência pelo cosseno do MobileCLIP2. A célula diferente vira "trocado" ou, se a frase do vazio passar de 0,9, "vazio (ruptura)". A decisão usa votos e a referência fica no localStorage. |
| CV-63 Foto de produto | `produto.foto` | V4 | — | Recorta o fundo com o BiRefNet. Enquadra em 1:1, 4:5, 3:4 ou 16:9, com margem fixa, produto centralizado ou apoiado na base. O fundo pode ser branco, cor ou transparente, com sombra de contato. No Medições: exportar a foto em resolução plena e processar um LOTE de fotos num ZIP (`video/zip.js`). |
| CV-64 Ocupação por zona | `ocupacao.mesas` | 75 | `mesa` | Pessoa junto da mesa = ocupada. Só copo, taça, prato, talher ou comida = suja. Nada = livre. A troca de estado tem histerese. Dá giro, ocupação média e espera pela limpeza. |
| | `ocupacao.zona` | 99, T2 | `vaga`, `lixeira` | Vagas: a capacidade vem do nome (ex.: "(8)"). Conta por detecções das classes pedidas ou pela diferença da cena vazia (patinete e o que o COCO não tem). Lixeira: nível da boca pela diferença e alarme de cheia. Dá % agora, média ponderada no tempo e giro. |
| CV-65 Medidor | `medidor.leitura` | 98 | `medidor` | Lê por OCR (rolos) ou por 7 segmentos (`lerDisplay7` importado de `runtime/livres-oa/nucleo.js`, sem alterar o `instrumento.display7`). Usa dígitos e decimais fixos. O filtro de acumulador só aceita leitura que sobe e se repete, e rejeita saltos implausíveis. Dá consumo e vazão média. |
| CV-66 Resumo de vídeo | `video.resumo` | 100 | `resumo_area` (opcional) | Faz subtração de fundo e monta eventos (limiar, duração mínima, quietude), com miniatura e a região do movimento borrada. No Medições: linha do tempo SVG clicável (leva o vídeo ao instante), lista, CSV e "Abrir no editor", que abre o GPlanSiS\|Vídeo com um marcador por evento. |
| CV-67 Velocidade | `transito.velocidade` | T2 | `velocidade` (2 linhas, A/B) | v = distância / Δt, com o instante de cada cruzamento interpolado (`cruzamento` do nucleo.js). Dá média, mediana, V85 (percentil do Excel), máxima e excessos por classe e sentido. **Não toca no `trafego.js`.** |

## LGPD
- Toda cadeia de preset com pessoas termina em `privacidade.borrar_rostos`; a AEP usa o `takt.posto`, que já borra.
- As miniaturas da AEP (pior postura) borram o rosto pela pose. Sem pose, borram o topo da caixa.
- As miniaturas do resumo de vídeo pixelam e desfocam a região do movimento.
- Nenhum reconhecimento facial.

## Integração com o GPlanSiS|Vídeo
`abrirEditorVideo({ url, nome, marcadores })` passou a aceitar `marcadores` em µs da mídia. Mudanças:
- `StudioVideo.abrir(blob, nome, origem, marcExtra)`: soma os marcadores pedidos aos salvos.
- `ponte.js`: documentação atualizada.

## Testes (`/Volumes/Armazena2/zz-staging/onda2-b-tools/testes/`)
- `t-s1.mjs`: 62 verificações numéricas sem modelo, todas OK. Tolerâncias:
  - NIOSH:
    - LPR ideal 23 kg (±1e-9);
    - caso calculado à mão H40/V30/D50/A30/F3/2h/razoável (±1e-6);
    - tabela FM e interpolação (±0,001);
    - H/V pela pose sintética (±0,5 cm);
    - 4 levantamentos e frequência 12/min (±1,5);
    - origem/destino (±2 cm).
  - AEP: % por faixa (±0,5 p.p.), média ponderada (±0,01), prioridade, alerta, atribuição ao posto (±0,15 s).
  - Saída: luz +18 % e passante não alarmam; caixa parada alarma em 70–72,5 s (30 s + 1 s do "parado").
  - Fogo: chama sintética ≤ 3 s; laranja parado e laranja em movimento não alarmam.
  - Preço: CSV com BOM, aspas, inglês e pt-BR; agrupamento de 3 etiquetas; ok/divergente (+0,50)/não cadastrado.
  - Produto: margem e centralização (±1 px), fundo branco puro, sombra, alfa, 4:5 apoiado.
  - Mesas: sequência de estados com histerese; ocupação de 50 s e espera de 30 s (±0,5).
  - Vagas: capacidade, média de 75 % (±1 p.p.), giro.
  - Lixeira: nível e alarme na janela esperada.
  - Medidor: filtro e consumo/h (±0,001); 7 segmentos sintético subindo, com um quadro corrompido rejeitado.
  - Resumo: 3 eventos, início e fim (±0,5 s), piscada de 0,3 s ignorada.
  - Velocidade: 36/54/72 km/h com erro ≤ 0,5 %, sentidos e excesso.
- `t-s2.mjs`: modelos reais, cena desenhada em canvas, todas OK.
  - Planograma (MobileCLIP2): 12/12 conformes na própria referência; só as células trocada e vazia saem, classificadas certo.
  - Produto (BiRefNet): caixa do recorte ±20 px da garrafa real, enquadramento ±2 px.
  - Preço (PP-OCRv5): 3 etiquetas lidas; o feijão sai divergente pelo EAN impresso.
  - Hidrômetro (OCR): 00123|456 → 123,456 m³.
- `e2e-app.js` / `e2e-cam.js`: no app com login falso e câmera falsa, os 14 presets aplicam, as marcações-modelo nascem, as seções aparecem no Medições, todos os operadores publicam sem erro de nó e o console fica limpo.

## Limitações conhecidas
- A AEP e o NIOSH dependem da pose 2D (câmera de lado). A assimetria e a pega não são medidas. Uma pausa no meio da subida pode confirmar um destino cedo demais (estabilidade de 1 s).
- Fogo: pele clara passa na regra de cor (quem separa é a cintilação). LED piscando ou tela podem enganar; use exclusão.
- Saída, vaga por diferença e lixeira precisam de uma "cena vazia" boa. Com a câmera tremendo ou a cena sempre em movimento, a captura automática não acontece e é preciso capturar no Medições.
- Planograma: "trocado" × "vazio" depende das frases CLIP (limiar ajustável `vazioMin`, padrão 0,9).
- Velocidade: a distância entre as linhas deve ser medida no local. Com `distancia = 0` usa a régua entre os centros das linhas, o que é só uma aproximação em perspectiva.
- Marcadores no editor: correspondem ao tempo da mídia; com a timeline já editada (clipes movidos), podem não cair no lugar.
