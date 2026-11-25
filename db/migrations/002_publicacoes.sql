-- 002: publicações coletadas de fontes externas (ex.: Jornal Imprensa Leilões)
CREATE TABLE publicacoes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fonte        TEXT NOT NULL CHECK (fonte ~ '^[a-z0-9-]{3,40}$'),
  tipo         TEXT NOT NULL CHECK (tipo IN ('noticia', 'edicao')),
  titulo       TEXT NOT NULL,
  resumo       TEXT,
  url          TEXT NOT NULL UNIQUE CHECK (url ~ '^https://'),
  publicado_em TIMESTAMPTZ,
  coletado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX publicacoes_fonte_tipo_idx ON publicacoes (fonte, tipo, coalesce(publicado_em, coletado_em) DESC);
