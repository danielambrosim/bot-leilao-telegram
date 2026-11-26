-- 004: sessões do painel do leiloeiro (cookie httpOnly; só o hash do token fica no banco)
CREATE TABLE sessoes_painel (
  token_hash  CHAR(64) PRIMARY KEY,
  operador_id BIGINT NOT NULL REFERENCES operadores(id) ON DELETE CASCADE,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em   TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessoes_painel_expira_idx ON sessoes_painel (expira_em);
