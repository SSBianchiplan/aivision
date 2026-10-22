# Saúde e esportes (CV-70 a CV-77)

8 módulos e 17 operadores, todos em JS puro sobre o que já existia: a pose BlazePose (o mesmo caminho do Salto, da Corrida e do Fisio) ou a pose RTMO da cadeia, a Malha do rosto, Mãos e gestos, os motores do Salto, da Corrida e da Academia, e o `seguranca.queda`. **Nenhum modelo novo** (não há `models-livres-t.js`).

Tudo de saúde leva o aviso **"Não é dispositivo médico: medida de apoio ao profissional habilitado, sem diagnóstico"**. Ele fica fixo no vídeo, no painel e no Studio, e sai em todo CSV e relatório. Nenhum operador dá faixa "normal" de sinal vital nem classifica doença ou tipo de tremor. As referências aparecem só com a fonte citada.

## Módulos e operadores

| Módulo | Operador | Ideia | O que mede | Entrada |
|---|---|---|---|---|
| CV-70 Sinais vitais sem contato | `vitais.respiracao` | 81 | respirações/min pelo deslocamento sub-pixel do perfil vertical de uma ROI do tórax + FFT (6–42 rpm), com faixa de confiança, SNR e avisos de luz/movimento/taxa | ROI pela pose, pela área "Vitais · tórax" ou pelo centro |
| | `vitais.cardiaca` | 82 | bpm por rPPG: média RGB de testa e bochechas, POS (Wang 2017), CHROM (de Haan 2013) ou canal verde, pico em 42–180 bpm, faixa e confiança | `rosto.malha` antes, ou a área "Vitais · pele" |
| CV-71 Rosto clínico | `rosto.assimetria` | H4 | olho (EAR), sobrancelha e comissura em repouso e nas expressões guiadas; excursão de cada lado × repouso e índice \|D−E\|/média; registro por expressão | `rosto.malha` antes |
| | `rosto.orofacial` | 85 | abrir a boca, sorriso, bico, lateralizar, bochechas: repetições, amplitude (em distâncias entre os olhos) e tempo sustentado | `rosto.malha` antes |
| CV-72 Movimento clínico | `clinica.tremor` | 83 | frequência (pico 3–12 Hz, limitado pela taxa) e amplitude pico a pico (cm, pelo comprimento da mão informado) | `maos.gestos` antes (senão o punho da pose) |
| | `clinica.postura` | 84 | frontal: ombros, pelve, cabeça, desvio lateral do tronco, ombros − pelve (escoliose **aparente**), prumo; lateral: cabeça anteriorizada, tronco, quadril, joelho, prumo | pose |
| | `clinica.marcha` | 86 | velocidade pelo tempo entre 2 linhas "Marcha · piso" (piso calibrado), cadência, tempo de passo, passada, % de apoio por pé | pose + `extrairCorrida` (motor da Corrida) |
| CV-73 Exercício domiciliar | `casa.exercicio` | H3 | prescrição (também por link `#presc=`), contagem e correção de forma **por voz** (speechSynthesis pt-BR), descanso, relato de dor, registro por série | `academia.treino` antes (o motor que conta e corrige) |
| CV-74 Hospital e ILPI | `hospital.maos` | H5 | sessões de higienização, tempo de fricção × meta OMS (20–30 s álcool / 40–60 s água e sabão), os 6 movimentos por geometria das duas mãos (**indicativo**) | `maos.gestos` (2 mãos) antes |
| | `hospital.queda` | H5 | **importa `queda` de `livres-oa/seguranca.js` sem alterá-lo**; ajustes de quarto e o modo "só esqueleto" (o vídeo vira fundo escuro) | `pose.rtmo` antes |
| CV-75 Comparar com a referência | `referencia.comparar` | E3 | grava a referência e compara cada tentativa: DTW (Sakoe-Chiba) entre as séries de 9 ângulos, nota 0–100 por fase, articulação mais divergente com sinal, ritmo relativo, lado trocado aceito | pose |
| | `yoga.pose` | 91 | pose capturada como referência, semelhança 0–100, articulação mais longe, tempo sustentado (quedas curtas toleradas) | pose |
| CV-76 Esportes de ciclo | `corda.saltos` | 87 | saltos, ritmo, regularidade, paradas, voo, contato, altura: **SessaoSalto** (motor do Salto, "saltos contínuos") | pose |
| | `luta.golpes` | 88 | golpes por mão (extensão ≥ 85 % + pico de velocidade), velocidade do punho em braços/s e m/s (estatura) | pose |
| | `basquete.arremesso` | 89 | soltura (cotovelo estendendo, punho acima da cabeça), ângulo pela parábola da bola (detector na cadeia) ou pelo punho, acerto pela área "Basquete · aro", aproveitamento por "Basquete · zona" | pose + `dnn.detect` (bola) |
| | `natacao.bracadas` | 90 | braçadas por volta completa do braço (crawl/costas) ou ciclo (peito/borboleta), ritmo e regularidade | pose |
| CV-77 PROESP-BR | `proesp.bateria` | D2 | salto horizontal (motor do Salto), 20 m e quadrado (linhas "PROESP · linha"), abdominal 1 min (Academia); por **código** do aluno, sem nome nem rosto; classe pela tabela carregada | pose / academia |

Funções de marcação novas (`registrarFuncao`): `vitais_torax`, `vitais_pele`, `marcha_piso`, `basquete_aro`, `basquete_zona`, `proesp_linha`.

## Interface

- **Painel "Saúde e esportes+"** (id `onda2c`, sob demanda): abas Saúde/Esportes com os 18 presets; o resultado do operador ativo (número com faixa de confiança, linhas, avisos, fonte); ações (Registrar, Iniciar/Parar, Capturar pose, Cesta/Erro, Zerar); prescrição + "Copiar link para o paciente" + dor 0–10; tabela PROESP (CSV); referências salvas; CSV e relatório HTML (imprimir → PDF).
- **Studio GPlanSiS|Vitais** (`studioOnda2c`, FonteStudio na barra): respiração, FC rPPG e tremor (vídeo, número com faixa e barra de confiança, condições, sinal, espectro); referência (bonecos lado a lado seguindo o caminho do DTW, barras de nota por fase). Três temas e celular. Gancho de teste `window.aivOnda2c`.
- **Hub Esportes**: 8 cartões novos (um por módulo); "Abrir" aplica o preset e abre o painel.
- **Presets** em `js/components/presets-onda2c.js` (grupos "Saúde" e "Esportes e biomecânica"), fundidos no Pipeline pelo Panels.js como os da onda 1-a/2-b, com marcações-modelo (linhas do piso, aro e zonas, linhas PROESP).

## PROESP-BR: tabela

Não embutimos números da tabela PROESP-BR, porque não pudemos conferi-los. O professor carrega o CSV do manual (Gaya & Gaya, UFRGS, 2016) neste formato:

    teste;sexo;idade;fraco;razoavel;bom;muito_bom;excelente      (limite de cada classe, da pior à melhor)
    teste;sexo;idade;zona_saudavel                              (ponto de corte de saúde)

`teste` ∈ horizontal, corrida20, quadrado, abdominal. Para os testes de tempo (corrida20 e quadrado), "menor é melhor". Sem a tabela, o resultado bruto fica registrado.

## Fontes citadas

POS (Wang et al. 2017, IEEE TBME 64(7)); CHROM (de Haan & Jeanne 2013, IEEE TBME 60(10)); House-Brackmann 1985 (só para dizer que a gradação é do profissional); arXiv 2103.11059 e MATRIX 2026 (assimetria por pontos); SAPO (Ferreira et al. 2010, Clinics 65(7)); Bohannon & Williams Andrews 2011 (velocidade de marcha); Perry & Burnfield 2010 (apoio ≈ 60 %); OMS 2009 (higiene das mãos); Sakoe & Chiba 1978 (DTW); PROESP-BR 2016; Kaia Health/JMIR 2021 (correção por visão). Os métodos sem fonte numérica aparecem como "método" e não como referência.

## Testes (em /Volumes/Armazena2/zz-staging/onda2-c-tools/)

- `t-vitais.mjs` (node): vídeo sintético quadro a quadro.
  - Respiração: listras que oscilam 0,8–2 px a 10/15/24/32 rpm, a 8–20 quadros/s, com jitter e ruído. Tolerância declarada ±1 rpm; o erro foi ≤ 0,26 rpm. Em todos os casos a verdade caiu dentro da faixa de confiança.
  - rPPG: pele com pulso de 0,25 % no verde, deriva de luz de 3 % e ruído σ = 4, de 55 a 150 bpm, para POS, CHROM e verde. Tolerância declarada ±3 bpm; o erro foi ≤ 0,13 bpm.
- `t-pose.mjs` (node): séries de pose sintéticas.

  | Teste | Resultado | Tolerância |
  |---|---|---|
  | Corda | 50/50 saltos; 150/min; voo 199 ms | — |
  | Golpes | 10/10 da direita, 0 da esquerda | — |
  | Natação | 18 braçadas completas; 60/min | — |
  | Marcha: cadência | 100 | ±5 |
  | Marcha: apoio | 55,6 % (verdade 60 %) | ±8 |
  | Marcha: velocidade | 0,75 m/s | ±0,04 |
  | Marcha: passada | 0,90 m | ±0,08 |
  | Marcha: cronômetro entre as linhas | 4,00 s | ±0,05 |
  | Tremor: frequência | 5,20 Hz | ±0,3 Hz |
  | Tremor: amplitude | 0,89 cm | ±0,2 cm |
  | DTW | a fase com o joelho +30° é a pior (70 contra 96 das outras); articulação apontada: joelho; ritmo 1,27× (verdade 1,3×) | — |
  | Yoga | nota 95 na mesma pose; joelho fora é apontado; sustentado 5,96 s (verdade 6 s) | — |
  | Basquete | ângulo pela parábola da bola 50,0° | ±1° |
  | Postura | ombros 5,00° | ±0,3° |
  | Rosto | assimetria da comissura e do olho detectadas | — |
  | Orofacial | 5/5 repetições | — |
  | Higiene | passos 1 e 4 classificados; sessão de 25 s com os 6 passos | — |
  | Leitura da tabela PROESP | correta | — |

- `r-vitais.mjs` (Chrome headless, câmera falsa `sinais.y4m` de `gera-y4m.py`): tórax a 18 rpm e pele a 75 bpm com 1 % no verde e ruído σ = 3. A medida no app foi **18,01 rpm** (faixa 16,5–19,5) e **75,03 bpm** (faixa 72,7–77,3), a 29,9 amostras/s. O aviso médico aparece no painel e no Studio.
- `r-ops.mjs` (navegador, entradas sintéticas e relógio de vídeo falso): golpes 10/10; postura 5,0°; referência gravada e comparada com nota 99; yoga 99 e 5,0 s; tremor 5,50 Hz; PROESP 20 m 4,00 s; higiene registrada; queda com fundo escuro; natação 18; CSV e HTML com o aviso; o link da prescrição faz ida e volta.
- `r-presets.mjs`: os 18 presets aplicados sem exceção nos operadores e com o retrato publicado. `r-studio.mjs` cobre os temas escuro, light e code e o celular. `r-hub.mjs` confere os 8 cartões e a aplicação do preset.

## Limites

- Aqui não houve modelos (o `models/` local está vazio). Por isso, nos testes de navegador, a pose, a malha e as mãos vieram de entradas sintéticas. A cola com os modelos reais é a mesma do Fisio e da Corrida, mas ainda precisa ser conferida em produção.
- Higiene das mãos: a classificação dos 6 passos é heurística e indicativa.
- PROESP: sem a tabela embutida.
- Tremor: a frequência é limitada a metade da taxa de quadros.
- O Swing não foi usado: a comparação com a referência usa fases por tempo e DTW, não os quadros-chave do swing.
