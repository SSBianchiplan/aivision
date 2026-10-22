# aivision-motion — conectores de servidor do Motion 3D Studio (CV-88)

Motores pesados de reconstrução 3D a partir de VÍDEO (GPU, Python), com estado honesto. A captura
ao vivo do Studio roda no navegador (BlazePose 3D no ORT-web); este serviço só existe para o que não
cabe no aparelho. **Nada de terceiros vem instalado**: sem motor, a API responde 501 e nada é simulado.

| Motor | Papel | Estado padrão | Licença (o que pode e o que não pode) |
|---|---|---|---|
| GVHMR | corpo 3D e trajetória global, vídeo monocular | não instalado | Código: a licença do repositório na versão instalada (verificar). SMPL/SMPL-X (MPI): **não comercial**, cadastro obrigatório, não redistribuível — não entram na imagem nem no pacote AGPL. |
| ExMR | refinamento de mãos, dedos, braços e pés | **não verificado** | Sem repositório/versão/licença confirmados na especificação. Fica desligado até confirmar (`AIV_MOTION_EXMR_VERIFICADO=1`). |
| FlowHMR | movimento fisicamente plausível | não instalado | Pesos e modelos de corpo com acesso restrito; pesquisa / não comercial. Não redistribuir. |
| FreeMoCap | multicâmera | só importação | Roda como aplicativo próprio (AGPL-3.0 no upstream); o Studio importa as sessões (NPY/CSV/JSON). |

## Rotas (`/api/v1/motion/*`, contrato `contracts/openapi.yaml` da especificação MotionAI)

| Rota | Resposta |
|---|---|
| `GET /health` | `{status, version, real_inference, engines_available}` sem autenticação |
| `GET /capabilities` | estado de cada motor, licença, limites |
| `POST /sessions` · `GET/DELETE /sessions/{id}` | sessão de metadados; DELETE apaga uploads e artefatos (LGPD) |
| `POST /uploads?engine=` | vídeo em multipart `video` + cabeçalho `X-Motion-Consent`; **501 antes de ler o corpo** se o motor não estiver disponível; 400 sem consentimento; 413 acima de `AIV_MOTION_MAX_MB`; 415 se não for MP4/MOV, WebM/MKV ou AVI (assinatura do arquivo) |
| `POST /jobs` | 202 na fila; 501 motor ausente/licença pendente/não verificado; 422 motor fora da lista; 404 vídeo alheio; 409 vídeo de outro motor; 429 cota |
| `GET /jobs/{id}` · `POST /jobs/{id}/cancel` · `GET /jobs/{id}/artifacts[/{art}]` | estado, cancelamento, artefatos (JSON `motionai.pose.v1`) |

Diferenças do contrato, de propósito: autenticação pelo cookie de sessão do iaVision (mesma origem,
HttpOnly — o que o documento 04 prefere) em vez de bearer; `exmr` aceito na lista de motores; upload
explícito em `/uploads` (o contrato só cita `input_artifact_id`).

## Autenticação e limites
Igual ao `aivision-via`/`aivision-yt`: o `Cookie` vai para `AIV_ME_URL` (API PHP de login) e exige
`{"authenticated": true}`; usuário sempre de `/api/me`; cache de 60 s por hash do cookie; 503 se o login
cair. Limites por IP (login 30/min, leitura 240/min, escrita 60/min, upload 6/min), JSON ≤ 64 KB, vídeo ≤
`AIV_MOTION_MAX_MB` (300), até `AIV_MOTION_MAX_JOBS` (2) jobs ativos por usuário, um trabalhador (uma GPU).
Logs só com ids e pseudônimo (sha256 do id): nunca e-mail, quadro ou vídeo.

## Retenção (LGPD)
Vídeo apagado assim que o job termina (sucesso, falha ou cancelamento); artefatos e sessões em até
`AIV_MOTION_RETER_H` (24) horas; DELETE da sessão apaga tudo na hora. Diretórios por pseudônimo, modo 700.

## Instalar um motor (fora desta imagem, decisão do administrador)
1. Repositório e pesos num diretório próprio (ex.: `/opt/motores/gvhmr`), com venv/CUDA dele, aceitando as licenças.
2. Um `iavision-adaptador.json` nesse diretório com o comando FIXO e a conversão para o JSON do Studio
   (formato em `motores.py`). O cliente nunca manda comando, caminho ou argumento.
3. No compose: montar `/opt/motores:/motores:ro`, `AIV_MOTION_GVHMR_DIR=/motores/gvhmr` e
   `AIV_MOTION_GVHMR_LICENCA=aceita`. Uma GPU exige `deploy.resources.reservations.devices` (nvidia) — a vps2 não tem GPU.

## Implantação (vps2) — NÃO FEITA
```
/opt/aivision/motion/  app.py motores.py Dockerfile docker-compose.yml requirements.txt
cd /opt/aivision/motion && docker compose up -d --build        # 127.0.0.1:8988 (confirme que está livre)
```
No Caddy, antes de `handle /api/*`: `handle /api/v1/motion/* { request_body { max_size 320MB } reverse_proxy 127.0.0.1:8988 }`.

## Testes
```
python -m venv .venv && .venv/bin/pip install -r requirements.txt
AIV_MOTION_DADOS=$(mktemp -d) .venv/bin/python testes/teste_api.py      # 36 verificações
```
Exercita: 401 sem cookie, 501 honesto de cada motor (e upload recusado antes de ler o corpo), 422/400/413/415,
isolamento entre usuários, licença pendente, e — com um ADAPTADOR FALSO só do teste — fila, idempotência,
artefato, apagamento do vídeo ao fim do job e DELETE da sessão.
