-- GPlanSiS|iaVision · aivision-via — esquema do banco (PostgreSQL 16 + pg_trgm + unaccent + pgvector).
-- Migração IDEMPOTENTE: roda a cada partida da API (sob trava consultiva); pode rodar de novo sem estragar nada.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;

-- unaccent() não é IMMUTABLE (depende do dicionário): o invólucro com o dicionário fixo pode ir em
-- coluna gerada e em índice.
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- array_to_string é STABLE no catálogo; para text[] o resultado não muda, então o invólucro pode ser IMMUTABLE
CREATE OR REPLACE FUNCTION f_tags(text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;

CREATE TABLE IF NOT EXISTS conversas (
  id          bigserial PRIMARY KEY,
  usuario_id  text NOT NULL,                       -- id de /api/me (nunca vem do cliente)
  email       text NOT NULL DEFAULT '',
  criada_em   timestamptz NOT NULL DEFAULT now(),
  titulo      text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS conversas_usuario ON conversas (usuario_id, criada_em DESC);

CREATE TABLE IF NOT EXISTS mensagens (
  id           bigserial PRIMARY KEY,
  conversa_id  bigint NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  papel        text NOT NULL CHECK (papel IN ('user', 'assistant')),
  texto        text NOT NULL DEFAULT '',
  modelo       text,
  tokens_in    integer,
  tokens_out   integer,
  criada_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mensagens_conversa ON mensagens (conversa_id, id);

CREATE TABLE IF NOT EXISTS comandos (
  id           bigserial PRIMARY KEY,
  mensagem_id  bigint NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  op           text NOT NULL,
  parametro    text,
  valor        text NOT NULL DEFAULT '',
  aplicado     boolean NOT NULL DEFAULT false,
  salvo        boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS comandos_mensagem ON comandos (mensagem_id);

-- só os METADADOS da imagem: a imagem em si nunca vem para cá
CREATE TABLE IF NOT EXISTS anexos (
  id                       bigserial PRIMARY KEY,
  mensagem_id              bigint NOT NULL REFERENCES mensagens(id) ON DELETE CASCADE,
  sha256                   char(64) NOT NULL,
  largura                  integer,
  altura                   integer,
  enviado_treinar_projeto  text
);
CREATE INDEX IF NOT EXISTS anexos_mensagem ON anexos (mensagem_id);
CREATE INDEX IF NOT EXISTS anexos_sha ON anexos (sha256);

CREATE TABLE IF NOT EXISTS conhecimento (
  id                  bigserial PRIMARY KEY,
  usuario_id          text NOT NULL,
  email               text NOT NULL DEFAULT '',
  origem_mensagem_id  bigint REFERENCES mensagens(id) ON DELETE SET NULL,
  titulo              text NOT NULL,
  texto               text NOT NULL,
  tags                text[] NOT NULL DEFAULT '{}',
  compartilhado       boolean NOT NULL DEFAULT false,
  aprovado_por        text,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  tsv                 tsvector GENERATED ALWAYS AS (
                        setweight(to_tsvector('portuguese', f_unaccent(coalesce(titulo, ''))), 'A') ||
                        setweight(to_tsvector('portuguese', f_unaccent(f_tags(tags))), 'A') ||
                        setweight(to_tsvector('portuguese', f_unaccent(coalesce(texto, ''))), 'B')) STORED,
  embedding           vector(384)                  -- caminho de embeddings: pronto, desligado (AIV_VIA_EMBEDDINGS)
);
CREATE INDEX IF NOT EXISTS conhecimento_tsv ON conhecimento USING gin (tsv);
CREATE INDEX IF NOT EXISTS conhecimento_titulo_trgm ON conhecimento USING gin (f_unaccent(lower(titulo)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS conhecimento_texto_trgm ON conhecimento USING gin (f_unaccent(lower(texto)) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS conhecimento_dono ON conhecimento (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS conhecimento_comp ON conhecimento (criado_em DESC) WHERE compartilhado;

-- Busca híbrida (RAG): full-text português sem acento + trigram; só o que o usuário pode ver
-- (os itens dele e os compartilhados). websearch_to_tsquery entende "frase", -exclusão e OR; para recuperar
-- trechos, os termos soltos viram OU (tq_ou) e quem tem TODOS os termos ganha o rank de tq de bônus.
-- score = ts_rank_cd(tq_ou) + ts_rank_cd(tq) + 0,6 × similaridade de palavra (trigram, tolera erro de digitação).
CREATE OR REPLACE FUNCTION via_busca(p_q text, p_usuario text, p_n integer)
RETURNS TABLE (id bigint, titulo text, trecho text, tags text[], compartilhado boolean, meu boolean,
               criado_em timestamptz, score real)
LANGUAGE sql STABLE
SET pg_trgm.word_similarity_threshold = 0.45
AS $$
  WITH q0 AS (
    SELECT websearch_to_tsquery('portuguese', f_unaccent(p_q)) AS tq, f_unaccent(lower(p_q)) AS qt
  ), q AS (
    SELECT tq, replace(tq::text, ' & ', ' | ')::tsquery AS tq_ou, qt FROM q0
  )
  SELECT c.id, c.titulo, left(c.texto, 700), c.tags, c.compartilhado, c.usuario_id = p_usuario, c.criado_em,
         (ts_rank_cd(c.tsv, q.tq_ou, 32) + ts_rank_cd(c.tsv, q.tq, 32)
          + 0.6 * greatest(word_similarity(q.qt, f_unaccent(lower(c.titulo))),
                           word_similarity(q.qt, f_unaccent(lower(c.texto)))))::real AS score
    FROM conhecimento c, q
   WHERE (c.usuario_id = p_usuario OR c.compartilhado)
     AND (c.tsv @@ q.tq_ou OR q.qt <% f_unaccent(lower(c.titulo)) OR q.qt <% f_unaccent(lower(c.texto)))
   ORDER BY score DESC, c.criado_em DESC
   LIMIT greatest(1, least(p_n, 20))
$$;

-- Próximo passo (desligado): busca por embeddings. Com um modelo local de 384 dimensões gravando
-- conhecimento.embedding, a busca semântica é esta; o índice HNSW entra quando houver dados.
CREATE OR REPLACE FUNCTION via_busca_vetor(p_emb vector(384), p_usuario text, p_n integer)
RETURNS TABLE (id bigint, titulo text, trecho text, score real)
LANGUAGE sql STABLE AS $$
  SELECT c.id, c.titulo, left(c.texto, 700), (1 - (c.embedding <=> p_emb))::real
    FROM conhecimento c
   WHERE c.embedding IS NOT NULL AND (c.usuario_id = p_usuario OR c.compartilhado)
   ORDER BY c.embedding <=> p_emb
   LIMIT greatest(1, least(p_n, 20))
$$;
