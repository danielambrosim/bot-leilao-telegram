-- 003: campos exigidos pelo cadastro de arrematantes das plataformas de leilão
-- (RG/IE, celular, endereço estruturado). Nulos para cadastros anteriores.
ALTER TABLE arrematantes
  ADD COLUMN rg_ie       TEXT CHECK (length(rg_ie) BETWEEN 2 AND 30),
  ADD COLUMN celular     TEXT CHECK (celular ~ '^55\d{10,11}$'),
  ADD COLUMN cep         CHAR(8) CHECK (cep ~ '^\d{8}$'),
  ADD COLUMN logradouro  TEXT,
  ADD COLUMN numero      TEXT,
  ADD COLUMN complemento TEXT,
  ADD COLUMN bairro      TEXT,
  ADD COLUMN cidade      TEXT,
  ADD COLUMN uf          CHAR(2) CHECK (uf ~ '^[A-Z]{2}$');

CREATE INDEX arrematantes_uf_cidade_idx ON arrematantes (uf, cidade);

-- Registro de exportações (quem exportou dados pessoais, quando e quantos)
-- fica na tabela auditoria com acao = 'exportacao.habilitados'.
