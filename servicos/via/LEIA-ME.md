# aivision-via — memória da Via (/opt/aivision/via)

Conversas e base de conhecimento (RAG) da Via, a assistente de IA do iaVision. Só texto e metadados:
a chave da Anthropic e as imagens nunca chegam aqui. Documentação completa: `docs/via.md` e `docs/servicos.md`.

## Contêineres
- `aivision-via` — API FastAPI em `127.0.0.1:8989` (Caddy: `handle /api/via/*`, antes do `/api/*`).
- `aivision-via-db` — `pgvector/pgvector:pg16` (pg_trgm, unaccent, vector), sem porta publicada, dados em `./dados`.
- `aivision-via-backup` — `pg_dump` diário em `./backups` (14 mais novos).

## .env (gerado no servidor, 600, nunca no repositório)
    VIA_DB_SENHA=<openssl rand -hex 24>
    AIV_VIA_ADMINS=admin@exemplo.com
    AIV_VIA_EMBEDDINGS=0

## Operação
    docker compose up -d --build          # sobe/atualiza (a migração schema.sql é idempotente)
    docker logs aivision-via --tail 50
    docker exec -i aivision-via python - < testes/teste_api.py   # teste funcional (usuários teste-rag-*, limpa no fim)
    gunzip -c backups/via-AAAAMMDD-HHMM.sql.gz | docker exec -i aivision-via-db psql -U via -d via   # restaurar
