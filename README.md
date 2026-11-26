# SBL — Habilitação digital de arrematantes

Bot do Telegram + painel web para **leiloeiros**. O arrematante abre o link (ou QR code) do leiloeiro,
faz um **cadastro único** com documentos e se habilita; o leiloeiro analisa, aprova ou recusa no painel
e exporta os habilitados (planilha + documentos) para a plataforma de leilão.

**Produção:** bot `@api_leilao_bot` · painel `https://sbl-bot-mj6r.onrender.com/painel/` · cliente piloto: Colodete Leilões.

## Mapa do repositório

```text
src/                    Código do servidor (TypeScript)
  main.ts               Ponto de entrada: liga banco, bot, painel e tarefas
  bot/                  Bot do Telegram (fluxo de cadastro e habilitação)
  painel/               API do painel: login, fila, ficha, decisões, configuração, equipe, QR code
  arrematantes/         Acesso ao banco: cadastro do arrematante e habilitações
  leiloeiros/           Acesso ao banco: leiloeiros
  exportacao/           CSV e pacote ZIP para a plataforma do leiloeiro
  docs/                 Guarda de documentos criptografados (disco ou bucket S3)
  scraper/              Coleta do Jornal Imprensa Leilões
  tarefas/              Manutenção periódica (coleta, limpeza, expurgo LGPD)
  mail/ verificacao/    E-mail e código de confirmação
  config/ db/ http/     Variáveis de ambiente, conexão/migrações, servidor HTTP
  scripts/              Comandos de linha (seed, criar operador, exportar...)
  util/                 Validações (CPF, CNPJ, CEP, datas)
painel-web/             Interface do painel (HTML/CSS/JS sem dependências)
db/migrations/          Estrutura do banco, em ordem (aplicadas sozinhas no deploy)
db/seeds/               Dados iniciais (leiloeiros)
tests/                  Testes automáticos (unitários + integração com Postgres)
docs/                   Guias: deploy, piloto, revisão de PR, mockups
.github/workflows/      CI (testes em todo PR) e agendador de manutenção
Dockerfile              Imagem de produção
render.yaml             Configuração do Render (produção atual)
docker-compose.yml      Produção alternativa em VPS (com Caddy/HTTPS)
docker-compose.dev.yml  Só o Postgres para desenvolvimento local
docker-compose.piloto.yml / .mailpit.yml   Piloto local com caixa de e-mail falsa
```

## Como trabalhar (fluxo de branches)

```text
main  ← única branch permanente; é o que está (ou vai) para produção
  └─ feat/<assunto>   funcionalidade nova     ─┐
  └─ fix/<assunto>    correção                 ├─ PR para main → CI verde → revisão → merge
  └─ chore/<assunto>  organização/manutenção  ─┘
```

1. Crie a branch a partir da `main` atualizada.
2. Abra PR para `main`. O check **testes** precisa ficar verde.
3. Revise com o roteiro [`docs/COMO-REVISAR-PR.md`](docs/COMO-REVISAR-PR.md) e faça o merge (*Squash and merge*).
4. Apague a branch do PR depois do merge (botão no próprio PR).

A `main` é protegida: sem push direto, sem force-push, sem exclusão.

## Rodar localmente

Pré-requisitos: Node 22+, Docker.

```powershell
copy .env.example .env      # preencha TELEGRAM_TOKEN, APP_SECRET, DOCS_ENCRYPTION_KEY
npm install
docker compose -f docker-compose.dev.yml up -d
npm run migrate
npm run seed -- db/seeds/dev.sql
npm run dev
```

> O bot local usa polling e se recusa a iniciar se o mesmo token estiver em produção (webhook). Use um **bot de teste** do @BotFather para desenvolver.

## Testes

```powershell
npm test   # sem banco: só unitários
docker compose -f docker-compose.dev.yml exec -T db psql -U sbl -d sbl -c "CREATE DATABASE sbl_test"
$env:TEST_DATABASE_URL="postgres://sbl:sbl_dev@127.0.0.1:5432/sbl_test"; npm test
```

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run operador:criar -- colodete email@x.com` | Cria login do painel (mostra a senha uma vez) |
| `npm run exportar:habilitados -- colodete aprovado` | Gera CSV de habilitados em `exports/` |
| `npm run coletar:imprensa` | Coleta notícias/edições do Jornal Imprensa Leilões |
| `npm run seed -- db/seeds/piloto.sql` | Migra o banco e cadastra o leiloeiro piloto |

Os comandos usam o `DATABASE_URL` do `.env` — confira se aponta para o banco certo (local ou produção).

## Deploy

Produção atual: Render (grátis) + Neon (Postgres e documentos) + Resend (e-mail). Passo a passo em
[`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md). Cada merge na `main` publica sozinho.

## Segurança e LGPD

- Documentos criptografados (AES-256-GCM) antes de sair do servidor; apagados após 180 dias.
- Painel com login, bloqueio após 5 erros, permissões (responsável / operador) e auditoria de tudo.
- O titular apaga os próprios dados pelo bot com `/excluirmeusdados`.

## Licença

MIT
