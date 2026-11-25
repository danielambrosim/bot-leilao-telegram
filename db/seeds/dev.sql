-- Dados de desenvolvimento: leiloeiro fictício para testar t.me/<SeuBot>?start=demo
INSERT INTO leiloeiros (slug, nome, termo_texto)
VALUES (
  'demo',
  'Leiloeiro Demonstração',
  'Ao continuar, você autoriza o Leiloeiro Demonstração a tratar seus dados pessoais e documentos exclusivamente para análise da sua habilitação, pelo prazo de 180 dias após a decisão.'
)
ON CONFLICT (slug) DO NOTHING;
