-- Produção/piloto: somente o cliente piloto (sem leiloeiro de demonstração)
INSERT INTO leiloeiros (slug, nome, site_url, termo_texto, plano)
VALUES (
  'colodete',
  'Colodete Leilões',
  'https://www.colodeteleiloes.com.br',
  'Ao continuar, você autoriza a Colodete Leilões a tratar seus dados pessoais e documentos exclusivamente para análise da sua habilitação como arrematante, pelo prazo de 180 dias após a decisão. Você pode pedir a exclusão a qualquer momento pelo comando /excluirmeusdados.',
  'piloto'
)
ON CONFLICT (slug) DO NOTHING;
