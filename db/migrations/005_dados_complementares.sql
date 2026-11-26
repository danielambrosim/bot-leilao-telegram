-- 005: dados exigidos pela Colodete Leilões
-- PF: data de nascimento (18+), estado civil, profissão · PJ: razão social
-- Representante legal (PJ) = a própria pessoa que cadastra (nome + cpf já existentes)
ALTER TABLE arrematantes
  ADD COLUMN data_nascimento DATE CHECK (data_nascimento > DATE '1900-01-01'),
  ADD COLUMN estado_civil    TEXT CHECK (estado_civil IN ('solteiro', 'casado', 'divorciado', 'viuvo', 'uniao_estavel')),
  ADD COLUMN profissao       TEXT CHECK (length(profissao) BETWEEN 2 AND 80),
  ADD COLUMN razao_social    TEXT CHECK (length(razao_social) BETWEEN 2 AND 150);
