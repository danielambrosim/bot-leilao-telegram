-- 006: configurações do leiloeiro pelo painel, nome dos operadores e histórico de versões do termo
ALTER TABLE leiloeiros
  ADD COLUMN email_contato CITEXT,
  ADD COLUMN matricula     TEXT CHECK (length(matricula) <= 60),
  ADD COLUMN dpo_nome      TEXT CHECK (length(dpo_nome) <= 120),
  ADD COLUMN dpo_email     CITEXT;

ALTER TABLE operadores
  ADD COLUMN nome TEXT CHECK (length(nome) <= 120);

-- Toda versão publicada do termo fica guardada (prova do que cada arrematante aceitou)
CREATE TABLE termos_versoes (
  leiloeiro_id BIGINT NOT NULL REFERENCES leiloeiros(id) ON DELETE CASCADE,
  versao       INT NOT NULL,
  texto        TEXT NOT NULL,
  publicado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  publicado_por BIGINT REFERENCES operadores(id) ON DELETE SET NULL,
  PRIMARY KEY (leiloeiro_id, versao)
);

INSERT INTO termos_versoes (leiloeiro_id, versao, texto, publicado_em)
SELECT id, termo_versao, termo_texto, criado_em FROM leiloeiros
ON CONFLICT DO NOTHING;
