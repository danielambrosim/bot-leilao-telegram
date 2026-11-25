# SBL — Habilitação digital de arrematantes via Telegram

Bot compartilhado para **leiloeiros (B2B)**. O arrematante abre o link do leiloeiro
(`t.me/<SeuBot>?start=<slug>`), faz um **cadastro único** e se habilita em cada leiloeiro com
consentimento próprio. O leiloeiro aprova ou recusa no painel.

> **Status: v2 em reescrita (fase 2 de 6).** O código da v1 está em `legacy/src-v1` apenas como referência.
> A auditoria de segurança da v1 está em [`audit/RELATORIO_ATAQUE.md`](audit/RELATORIO_ATAQUE.md).

## Roadmap

| Fase | Conteúdo | Status |
|---|---|---|
| 1 | Schema Postgres, env validado, grammY + webhook, Docker/Caddy, remoção de rotas abertas e Puppeteer | ✅ |
| 2 | Cadastro único, habilitação por leiloeiro, código de e-mail com limite, docs cifrados, /excluirmeusdados, coleta do Jornal Imprensa Leilões | ✅ |
| 3 | Rate limit, código de e-mail com expiração, sessões persistentes, auditoria | ⏳ |
| 4 | Painel do leiloeiro (Vite + React, login) — substitui `dashboard-admin/` | ⏳ |
| 5 | Documentos criptografados no R2 com retenção; scraper e avisos de editais | ⏳ |
| 6 | Deploy, capturas e site comercial | ⏳ |

## Stack

Node 22 · TypeScript · grammY · Express 5 · PostgreSQL 17 · Docker Compose · Caddy (HTTPS automático) · Vitest

## Desenvolvimento

Pré-requisitos: Node 22+, Docker.

```bash
cp .env.example .env            # preencha TELEGRAM_TOKEN
npm install
docker compose -f docker-compose.dev.yml up -d
npm run migrate
docker compose -f docker-compose.dev.yml exec -T db psql -U sbl -d sbl < db/seeds/dev.sql
npm run coletar:imprensa        # opcional: coleta notícias/edições do Jornal Imprensa Leilões
npm run dev                     # bot em polling
```

Teste no Telegram: `t.me/<SeuBot>?start=colodete` (ou `demo`). Sem SMTP configurado, o código de e-mail aparece no console.

### Testes

```bash
npm test                                         # unitários + HTTP
# integração com Postgres real:
docker compose -f docker-compose.dev.yml exec -T db psql -U sbl -d sbl -c "CREATE DATABASE sbl_test"
TEST_DATABASE_URL=postgres://sbl:sbl_dev@127.0.0.1:5432/sbl_test npm test
```

## Produção (VPS)

```bash
# .env com: TELEGRAM_TOKEN, DOMAIN, POSTGRES_PASSWORD, PUBLIC_URL=https://$DOMAIN, TELEGRAM_WEBHOOK_SECRET
docker compose up -d --build
docker compose exec app node dist/scripts/setWebhook.js
```

Só o Caddy expõe portas (80/443). Rotas públicas: `/telegram/webhook` (exige o header secreto do Telegram) e `/healthz`.

## Variáveis de ambiente

Ver [`.env.example`](.env.example). A aplicação valida tudo no boot e não imprime valores de segredos.

## Licença

MIT
