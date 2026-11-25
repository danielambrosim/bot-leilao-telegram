-- 001_init: modelo B2B multi-leiloeiro (bot compartilhado)
CREATE EXTENSION IF NOT EXISTS citext;

-- Leiloeiro = cliente pagante (controlador dos dados na LGPD)
CREATE TABLE leiloeiros (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9_-]{3,40}$'), -- usado em t.me/Bot?start=<slug>
  nome          TEXT NOT NULL,
  site_url      TEXT,                                -- fonte do scraper (só com autorização)
  termo_texto   TEXT NOT NULL,
  termo_versao  INT  NOT NULL DEFAULT 1 CHECK (termo_versao > 0),
  retencao_dias INT  NOT NULL DEFAULT 180 CHECK (retencao_dias BETWEEN 1 AND 3650),
  plano         TEXT NOT NULL DEFAULT 'piloto',
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Usuários do painel (equipe do leiloeiro)
CREATE TABLE operadores (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leiloeiro_id  BIGINT NOT NULL REFERENCES leiloeiros(id) ON DELETE CASCADE,
  email         CITEXT NOT NULL UNIQUE,
  senha_hash    TEXT NOT NULL,                       -- argon2/bcrypt, nunca texto puro
  papel         TEXT NOT NULL DEFAULT 'operador' CHECK (papel IN ('dono', 'operador')),
  ativo         BOOLEAN NOT NULL DEFAULT TRUE,
  tentativas_falhas INT NOT NULL DEFAULT 0,
  bloqueado_ate TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cadastro único do arrematante (reutilizado entre leiloeiros com consentimento)
CREATE TABLE arrematantes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  telegram_chat_id BIGINT NOT NULL UNIQUE,
  nome             TEXT NOT NULL,
  email            CITEXT NOT NULL UNIQUE,
  email_verificado_em TIMESTAMPTZ,
  cpf              CHAR(11) NOT NULL UNIQUE CHECK (cpf ~ '^\d{11}$'),
  cnpj             CHAR(14) CHECK (cnpj ~ '^\d{14}$'),
  endereco         TEXT NOT NULL,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Documentos: arquivo fica no R2 (criptografado); aqui só metadados
CREATE TABLE documentos (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arrematante_id BIGINT NOT NULL REFERENCES arrematantes(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('identidade', 'comprovante_residencia')),
  r2_key         TEXT NOT NULL UNIQUE,
  sha256         CHAR(64) NOT NULL,
  mime           TEXT NOT NULL,
  tamanho_bytes  INT NOT NULL CHECK (tamanho_bytes > 0),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em      TIMESTAMPTZ NOT NULL
);
CREATE INDEX documentos_expira_idx ON documentos (expira_em);

-- Habilitação = vínculo arrematante x leiloeiro (status independente por leiloeiro)
CREATE TABLE habilitacoes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arrematante_id BIGINT NOT NULL REFERENCES arrematantes(id) ON DELETE CASCADE,
  leiloeiro_id   BIGINT NOT NULL REFERENCES leiloeiros(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'recusado', 'revogado')),
  termo_versao   INT NOT NULL,
  consentido_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  decidido_por   BIGINT REFERENCES operadores(id) ON DELETE SET NULL,
  decidido_em    TIMESTAMPTZ,
  motivo         TEXT,
  UNIQUE (arrematante_id, leiloeiro_id)
);
CREATE INDEX habilitacoes_leiloeiro_status_idx ON habilitacoes (leiloeiro_id, status);

CREATE TABLE editais (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  leiloeiro_id  BIGINT NOT NULL REFERENCES leiloeiros(id) ON DELETE CASCADE,
  titulo        TEXT NOT NULL,
  url           TEXT NOT NULL CHECK (url ~ '^https?://'),
  data_leilao   DATE,
  origem        TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'scraper')),
  notificado_em TIMESTAMPTZ,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leiloeiro_id, url)
);
CREATE INDEX editais_leiloeiro_data_idx ON editais (leiloeiro_id, criado_em DESC);

-- Estado das conversas do bot (sobrevive a restart; expira)
CREATE TABLE sessoes_bot (
  chave      TEXT PRIMARY KEY,
  dados      JSONB NOT NULL,
  expira_em  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessoes_bot_expira_idx ON sessoes_bot (expira_em);

-- Código de verificação de e-mail: só hash, com limite de tentativas e expiração
CREATE TABLE codigos_email (
  telegram_chat_id BIGINT PRIMARY KEY,
  email       CITEXT NOT NULL,
  codigo_hash TEXT NOT NULL,
  tentativas  INT NOT NULL DEFAULT 0,
  envios      INT NOT NULL DEFAULT 1,
  expira_em   TIMESTAMPTZ NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trilha de auditoria (quem fez o quê) — exigência prática da LGPD
CREATE TABLE auditoria (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ator_tipo TEXT NOT NULL CHECK (ator_tipo IN ('operador', 'arrematante', 'sistema')),
  ator_id   BIGINT,
  leiloeiro_id BIGINT REFERENCES leiloeiros(id) ON DELETE SET NULL,
  acao      TEXT NOT NULL,
  alvo      TEXT,
  detalhes  JSONB,
  em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_leiloeiro_em_idx ON auditoria (leiloeiro_id, em DESC);
