# Piloto — Colodete Leilões

## Subir (sem domínio, sem HTTPS)

Funciona em qualquer máquina ligada 24h com Docker (VPS ou PC). O bot usa polling.

```bash
# .env precisa de: TELEGRAM_TOKEN, APP_SECRET, DOCS_ENCRYPTION_KEY, POSTGRES_PASSWORD, SMTP_*, MAIL_FROM
docker compose -f docker-compose.piloto.yml up -d --build
docker compose -f docker-compose.piloto.yml exec -T db psql -U sbl -d sbl < db/seeds/dev.sql   # cadastra 'colodete'
```

Teste interno sem e-mail real: acrescente `-f docker-compose.mailpit.yml` e leia os códigos em http://127.0.0.1:8025.

> Só **uma** instância por token pode fazer polling. Pare o `npm run dev` antes de subir o piloto (ou vice-versa).

## Roteiro de teste (equipe Colodete)

| # | Cenário | Esperado |
|---|---|---|
| 1 | Abrir `t.me/api_leilao_bot?start=colodete` | Termo da Colodete com botões |
| 2 | Cadastro completo PF (CPF real da pessoa, CEP real) | Endereço preenchido pelo CEP; "Cadastro concluído" |
| 3 | Cadastro PJ (CNPJ + IE ou ISENTO) | Pede CNPJ e IE |
| 4 | Errar o código de e-mail 5x | Bloqueia e pede e-mail de novo |
| 5 | Mandar PDF do documento | Aceito |
| 6 | Mandar arquivo .exe / > 10 MB | Recusado |
| 7 | Fechar o Telegram no meio e voltar em até 30 min | Continua de onde parou |
| 8 | "📊 Meu status" | Colodete: em análise |
| 9 | "📰 Notícias de leilões" | Notícias do Jornal Imprensa Leilões |
| 10 | `/excluirmeusdados` | Apaga tudo |
| 11 | Exportar e importar na plataforma da Colodete | Ver seção abaixo |

## Exportação para a plataforma da Colodete

```bash
docker compose -f docker-compose.piloto.yml exec app node dist/scripts/exportarHabilitados.js colodete aprovado
docker compose -f docker-compose.piloto.yml cp app:/app/data/exports/ ./exports/
```

CSV: separador `;`, UTF-8 com BOM, fórmulas neutralizadas. **Layout provisório** — colunas:
ID, Nome, Pessoa, CPF/CNPJ, RG/IE, E-mail, Celular, CEP, Logradouro, Número, Complemento, Bairro, Cidade, UF, Status, Criado em, Concluído em.

### Pendente com a Colodete
- [ ] Modelo do botão **Importar** (planilha de exemplo, só cabeçalho ou dados fictícios)
- [ ] Significado de **Tipo**, **Usuário** e **Habilitação Sucata**
- [ ] Se a importação cria login/senha para o arrematante na plataforma
- [ ] Quanto tempo precisam guardar dados de quem participou (antes de liberar `/excluirmeusdados` a clientes)
