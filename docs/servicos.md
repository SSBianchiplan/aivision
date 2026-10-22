# Servidor e serviços

Produção: **https://aivision.gplansis.com** na vps2, servido por Caddy (`/etc/caddy/aivision.caddy`) a partir de `/opt/aivision/site`.

## Rotas do Caddy

| Rota | Destino |
|---|---|
| `/api/yt/*` | `aivision-yt` (127.0.0.1:8994) |
| `/api/treino/*` | `aivision-treino` (127.0.0.1:8996), até 450 MB por envio |
| `/api/via/*` | `aivision-via` (127.0.0.1:8989; 8992 é do papo), até 20 MB, resposta em 30 s |
| `/api/*` | API PHP de login na hospedagem gplansis.com (`rewrite /aivision-api{uri}`, Host/SNI `gplansis.com`) |
| resto | arquivos estáticos de `/opt/aivision/site` |

Cabeçalhos: COOP `same-origin`, COEP `require-corp`, CORP `same-origin` (menos em `/yt/*`, abaixo); app (`/`, `*/`, `.html/.js/.mjs/.css/.webmanifest`) com `no-cache, must-revalidate`; pesos (`.onnx`, `.onnx_data`, `.data*`, `.wasm`, `.bin`) com `max-age=31536000, immutable`; `sw.js` com `no-store`.

### `/yt/*` sem isolamento (janela do player do YouTube)

`/yt/player.html` e `/yt/player.js` são a janela do player do YouTube usada no Safari e no Firefox ([fontes.md](fontes.md#youtube-no-safari-e-no-firefox)). Elas vão **sem** COOP/COEP/CORP (o embed comum do YouTube não carrega numa página isolada) e com `Referrer-Policy: strict-origin-when-cross-origin` (o YouTube recusa o embed sem Referer, erro 153). O trecho fica logo depois do bloco `header { Cross-Origin-Opener-Policy … }`; a remoção com `-` é diferida, então vale mesmo vindo depois:

```
@ytplayer path /yt/*
header @ytplayer {
	-Cross-Origin-Opener-Policy
	-Cross-Origin-Embedder-Policy
	-Cross-Origin-Resource-Policy
	Referrer-Policy "strict-origin-when-cross-origin"
}
```

Conferir: `curl -sI https://aivision.gplansis.com/yt/player.html` sem `Cross-Origin-*`; `/app.html` com os três.

## Login

API PHP (`aivision-api/api/index.php`) na hospedagem gplansis.com, com banco SQLite e chaves em `domains/gplansis.com/aivision-private/` (fora do `public_html`, permissões 700/600). Usa a base de pessoas do ONDA e o SMTP da hospedagem. Sessão por cookie; o IP vem de `X-Real-IP`/`X-Forwarded-For`. **Não está neste repositório** (contém dados de usuários e chaves).

## aivision-treino (`servicos/treino/`)

FastAPI + Ultralytics + rfdetr + PyTorch CPU. Contêiner com 3 CPUs, 6 GB, `pids_limit: 512`; volumes `./dados:/data` (projetos, imagens, treinos) e `site/models/custom:/custom` (publicação). Senha em `.env` (`AIV_TREINO_SENHA`), token HMAC de 12 h. Fila persistente, um treino por vez. Ver [treinar.md](treinar.md) e `servicos/treino/LEIA-ME.md`.

**Entrada sem senha (SSO de admin)**: `POST /api/treino/sessao` repassa o cookie para `/aivision-api/api/me` (mesmo padrão do aivision-yt: cache 60 s / 10 s, 30 consultas novas/min por IP, 503 se o login cair) e, se o e-mail (minúsculo, sem espaços) estiver em `AIV_TREINO_ADMINS` (`.env`, vírgulas; hoje `admin@exemplo.com`), devolve o **mesmo** token HMAC da senha (`{token, expira, email, admin}`). Sem sessão ou fora da lista → 403; a senha continua igual. O contêiner tem `extra_hosts: gplansis.com:45.132.157.26` (a API de login mora na hospedagem). Imagem `gplansis/aivision-treino:2.1.0` (a 2.0.0 fica para voltar).

**2.2.0 (origem das imagens)**: o upload aceita o campo `meta` (JSON, um item por arquivo: `fonte` `print|arquivo|youtube`, `origem`, `titulo`, `autor`, `licenca`, `capturado`, `arquivo`, `video`, `t`, `sha256_original`), validado e limpo no servidor (texto truncado, sem caracteres de controle; para `youtube` o id precisa ser válido e o link `https://www.youtube.com/watch?v=<id>&t=<s>s` é montado no servidor, nunca copiado do navegador). Guarda em `dados/projetos/<p>/origens.json` (+ `sha256` do arquivo recebido e `importado`), **pula repetidas** (sha256 do recebido ou `sha256_original`) e devolve `repetidas`. `GET /projetos/{p}/imagens` traz `origem`; `GET /projetos/{p}/origens?fmt=json|csv|md` lista atribuições (CSV com proteção contra fórmula); o ZIP exportado leva `ORIGENS.csv`; apagar a imagem apaga a origem. **O serviço não baixa nada da internet** (decisão: sem importação por URL). Imagem `gplansis/aivision-treino:2.2.0`; a 2.1.0 fica para voltar.

## aivision-via (`servicos/via/`)

Memória da Via: conversas e base de conhecimento (RAG). Três contêineres na mesma rede interna (`internal: true`, sem saída):

| Contêiner | O quê | Limites |
|---|---|---|
| `aivision-via` | FastAPI + psycopg 3 (API em `127.0.0.1:8989`), também na rede `saida` para falar com a API de login | 256 MB, 1 CPU, 64 pids, sistema de arquivos só-leitura |
| `aivision-via-db` | `pgvector/pgvector:pg16` com `pg_trgm`, `unaccent`, `vector`; **sem porta publicada**; dados em `./dados` | 384 MB, 1 CPU, 128 pids |
| `aivision-via-backup` | `pg_dump` diário comprimido em `./backups`, mantém os 14 mais novos (laço de 24 h no próprio compose; o primeiro sai 2 min após a partida) | 128 MB, 32 pids |

Segredo do banco (`VIA_DB_SENHA`) e admins da base (`AIV_VIA_ADMINS`) no `.env` gerado no servidor (600, fora do repositório). A migração (`schema.sql`) é idempotente e roda a cada partida da API sob trava consultiva. Por que o backup é um serviço do compose e não cron do host: fica junto do resto (sobe, para e se documenta com o `docker compose`), não depende do crontab do root e não precisa de porta nem de senha no host. Restaurar: `gunzip -c backups/via-AAAAMMDD-HHMM.sql.gz | docker exec -i aivision-via-db psql -U via -d via`.

Autenticação igual ao aivision-yt (cookie → `/api/me`; usuário e e-mail vêm SEMPRE de lá, nunca do corpo); qualquer campo com `sk-ant-…` é recusado (400). Contrato completo em [via.md](via.md#memória-no-servidor-aivision-via).

## aivision-yt (`servicos/youtube/`)

FastAPI + yt-dlp, **só busca**: nunca baixa mídia (o vídeo toca no player oficial no navegador).

| Endpoint | O quê |
|---|---|
| `GET /api/yt/busca?q=&n=` | resultados (id, título, canal, duração) via `yt-dlp --flat-playlist`; cache 1 h; 20 buscas/min por IP |
| `GET /api/yt/info?v=` | título/canal via oEmbed (aceita URL ou ID de 11 caracteres) |
| `GET /api/yt/miniatura/{id}` | proxy da miniatura `i.ytimg.com` com CORP same-origin (cache 24 h) |

Autenticação: repassa o cookie para `/aivision-api/api/me` e exige sessão válida (cache 60 s); cookies desconhecidos limitados a 30/min por IP; login fora do ar → 503. `pids_limit: 128`, timeouts de espera (20 s) e de resposta no Caddy (45 s). As VPS são bloqueadas pelo YouTube na página do vídeo — por isso a solução é streaming no navegador + captura do elemento.

## Código-fonte AGPL

`/codigo-fonte/` serve `aivision-fonte.tar.gz` (site + serviço de treino + serviço de busca + memória da Via, sem pesos, `.env` e dados), regenerado na vps2 a cada publicação. Ver [deploy-e-testes.md](deploy-e-testes.md).
