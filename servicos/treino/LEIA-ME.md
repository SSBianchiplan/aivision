# iaVision · treino de modelos

Serviço que treina modelos a partir das fotos enviadas em https://aivision.gplansis.com/treino/ e publica o ONNX
em `/opt/aivision/site/models/custom/` (+ `index.json`), de onde os operadores do iaVision carregam no navegador.

| Tipo de projeto | Motor | Licença | Operador no iaVision |
|---|---|---|---|
| detector | **RF-DETR** nano/small/medium/base (`rfdetr` 1.11.2, Roboflow) — padrão | Apache-2.0 (pesos e código; backbone DINOv2 Apache-2.0) | CV-24 · “Detector treinado (RF-DETR, livre)” (`js/cv/operators/livres-c.js`) |
| detector | YOLO26 (Ultralytics) — compatibilidade | AGPL-3.0 | CV-16 · “Modelo treinado (GPlanSiS)” (`js/cv/operators/custom.js`) |
| anomalia | **PatchCore** (implementação própria, `treino_patchcore.py`) | Apache-2.0; ResNet-18 torchvision BSD-3-Clause, pesos ImageNet | CV-24 · “Inspeção de anomalia (PatchCore)” |

Projetos antigos sem `tipo`/`motor` são detectores YOLO26; treinos antigos sem `nome` ganham um nome gerado.
As variantes RF-DETR XL/2XL (licença PML) e de segmentação não são oferecidas.

| O quê | Onde |
|---|---|
| Código do serviço | esta pasta (`app.py` API + fila, `job.py` um treino, `comum.py` publicação, `treino_rfdetr.py`, `treino_patchcore.py`, `Dockerfile`, `docker-compose.yml`) → `/opt/aivision/treino/` |
| Senha do treino | `/opt/aivision/treino/.env` (`AIV_TREINO_SENHA`) |
| Dados | `/opt/aivision/treino/dados/projetos/<projeto>/` (`projeto.json`, `imagens/`, `rotulos/` YOLO, `grupos.json` boa/ruim, `origens.json`, `treinos/<id>/`) |
| Pesos-base em cache | `dados/pesos/` (yolo26n.pt, rf-detr-*.pth, `torch/` ResNet-18, `hf/`) |
| Modelos publicados | `/opt/aivision/site/models/custom/<projeto>-<treino>.onnx` + `index.json` |
| Interface | `../aivision-site/treino/` → `/opt/aivision/site/treino/` |
| Caddy | `/etc/caddy/aivision.caddy` (`/api/treino/*` → 127.0.0.1:8996) |

Atualizar: `scp *.py Dockerfile docker-compose.yml $HOST:/opt/aivision/treino/ && ssh $HOST 'cd /opt/aivision/treino && docker compose up -d --build'`.

## Origem das imagens (2.2.0)
Prints, arquivos e quadros do YouTube chegam pelo upload de sempre (`POST /projetos/{p}/imagens`), feitos no
NAVEGADOR — o serviço não baixa nada da internet. Campo opcional `meta` (JSON, um item por arquivo, mesma ordem):
`fonte` (`print|arquivo|youtube`), `origem`, `titulo`, `autor`, `licenca`, `capturado`, `arquivo`, `video` (id),
`t` (s), `sha256_original`. O servidor limpa (trunca, tira caracteres de controle; para `youtube` monta ele mesmo o
link `watch?v=<id>&t=<s>s`), grava em `origens.json` do projeto com `sha256` e `importado`, e pula repetidas
(sha256 do recebido ou `sha256_original`) → resposta `{enviadas, erros, repetidas}`. `GET /projetos/{p}/imagens`
traz `origem`; `GET /projetos/{p}/origens?fmt=json|csv|md` lista atribuições; o ZIP exportado leva `ORIGENS.csv`.

## Treinos com nome e fila
Cada treino tem `nome` (obrigatório, aparece no iaVision) e `nota`. `POST /projetos/{p}/treinar` só cria o treino
em estado `fila`; uma thread do `app.py` dispara o mais antigo da fila quando nada está rodando (um por vez:
3 CPUs / 6 GB). Treinos na fila sobrevivem a reinício do contêiner; um que estava rodando vira `interrompido`.
Rotas: `GET/PATCH/DELETE /projetos/{p}/treinos/{t}` (`?despublicar=true`), `.../cancelar` (rodando ou na fila),
`.../publicar`, `.../despublicar`, `.../modelo?fmt=onnx|pt`. O id do modelo publicado é estável
(`<projeto>-<treino>`); renomear o treino renomeia a ficha no `index.json`.

## Como cada treino funciona
- **RF-DETR**: YOLO → COCO (`train/valid/test/_annotations.coco.json`, categorias 0..n-1); `model.train(...)` em CPU
  com lote 2 × acumular 4, `num_workers=0`, sem multiescala (cabe em 6 GB); progresso por um callback Lightning
  injetado em `rfdetr.training.build_trainer`. Export ONNX (`input` [1,3,S,S] → `dets` [1,300,4] cxcywh
  normalizado, `labels` [1,300,C+1] logits, última fatia = fundo). Quantização int8 dinâmica só dos MatMul/Gemm;
  a versão int8 é publicada se o F1 no ONNX (IoU 0,5, conf 0,5, imagens de validação, mesmo pré-processo do
  navegador) não cair mais de 0,02 em relação ao fp32.
- **PatchCore**: ResNet-18 ImageNet congelada; features layer2+layer3 com média 3×3, layer3 ampliada → 384-d por
  patch; banco = coreset k-center guloso (projeção aleatória 128-d) até 10.000 vetores; ONNX único com a busca
  do vizinho mais próximo (‖a‖²+‖b‖²−2ab, min), mapa [1,1,S,S] suavizado (σ=4) e nota = máximo do mapa. Limiar:
  com fotos ruins, maximiza a acurácia balanceada (separação total → meio do vão); sem ruins, maior nota das boas
  de validação + margem. O ONNX é conferido contra o PyTorch.
- **YOLO26**: como antes (Ultralytics, export `[1,300,6]`).

## index.json (uma ficha por modelo publicado)
Comuns: `id, nome, projeto, treino, arquivo, bytes, imgsz, classes, metricas, licenca, criado, base`.
Sem `arquitetura` = YOLO26. `arquitetura: "rfdetr"` traz `entrada` (forma, `redimensionar: "esticar"`,
`media/desvio` ImageNet), `saida` (`formato: "rfdetr"`, nomes `dets`/`labels`, fundo = última fatia),
`validacao_onnx` e `precisao_pesos`. `arquitetura: "patchcore"` traz `limiar`, `mapa_lo`, `entrada`, `saida`
(`mapa`, `nota`), `metricas` (`auroc`, `acerto_boas`, `acerto_ruins`, `banco`) e as `notas` de validação.

Limites: 3 CPUs e 6 GB de RAM (`docker-compose.yml`), um treino por vez, até 3.000 imagens por projeto.
A memória do HOST (16 GB, compartilhada com dezenas de contêineres) é o gargalo real: o RF-DETR usa ~3 GB.
RF-DETR nano a 384 px em CPU: ~1 min por época com 32 imagens. PatchCore: segundos.
Licença: o YOLO26 (Ultralytics) é AGPL-3.0 — o código-fonte (site + este serviço) é publicado em `/codigo-fonte/`.
