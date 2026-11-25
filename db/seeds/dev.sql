-- Dados de desenvolvimento: leiloeiro fictício para testar t.me/<SeuBot>?start=demo
INSERT INTO leiloeiros (slug, nome, termo_texto)
VALUES (
  'demo',
  'Leiloeiro Demonstração',
  'Ao continuar, você autoriza o Leiloeiro Demonstração a tratar seus dados pessoais e documentos exclusivamente para análise da sua habilitação, pelo prazo de 180 dias após a decisão.'
)
ON CONFLICT (slug) DO NOTHING;

-- Cliente piloto: t.me/<SeuBot>?start=colodete
INSERT INTO leiloeiros (slug, nome, site_url, termo_texto, plano)
VALUES (
  'colodete',
  'Colodete Leilões',
  'https://www.colodeteleiloes.com.br',
  'Ao continuar, você autoriza a Colodete Leilões a tratar seus dados pessoais e documentos exclusivamente para análise da sua habilitação como arrematante, pelo prazo de 180 dias após a decisão. Você pode pedir a exclusão a qualquer momento pelo comando /excluirmeusdados.',
  'piloto'
)
ON CONFLICT (slug) DO NOTHING;
