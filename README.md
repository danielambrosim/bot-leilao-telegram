# SBL — Sistema de Bot para Leiloeiros

[![CI](https://github.com/danielambrosim/bot-leilao-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/danielambrosim/bot-leilao-telegram/actions/workflows/ci.yml)
![Node 22](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)
[![Licença MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue)](LICENSE)

Habilitação digital de arrematantes para leiloeiros. O arrematante abre o link (ou QR code) do leiloeiro
no Telegram, faz um **cadastro único** com documentos e se habilita; a equipe do leiloeiro analisa,
aprova ou recusa num **painel web** e exporta os habilitados (planilha + documentos) para a plataforma
de leilão.

> **Sobre o nome.** SBL nasceu em 2025 como *Sistema Bot Leilão*, quando o projeto era só um bot que
> tentava cadastrar o arrematante em sites de leilão. Na v2 o produto passou a atender o **leiloeiro**
> (B2B) e a sigla ganhou o sentido atual: **Sistema de Bot para Leiloeiros**.

**Produção:** bot `@api_leilao_bot` · painel em `/painel` · cliente piloto: Colodete Leilões.

---

## Sumário

- [Telas](#telas)
- [Como funciona](#como-funciona)
- [Arquitetura](#arquitetura)
- [Mapa do repositório](#mapa-do-repositório)
- [Rodar localmente](#rodar-localmente)
- [Testes](#testes)
- [Como contribuir (fluxo de branches)](#como-contribuir-fluxo-de-branches)
- [Comandos úteis](#comandos-úteis)
- [Deploy](#deploy)
- [Segurança e LGPD](#segurança-e-lgpd)
- [Roadmap](#roadmap)
- [Contato](#contato)

## Telas

Capturas do painel com **dados fictícios**.

| Visão geral | Análise de habilitação |
|---|---|
| ![Visão geral do painel](docs/img/painel-visao-geral.png) | ![Ficha do arrematante com conferência e decisão](docs/img/painel-habilitacao.png) |
| **Link e QR code de habilitação** | **Equipe e acessos** |
| ![Link de habilitação com QR code](docs/img/painel-qrcode.png) | ![Gestão da equipe do leiloeiro](docs/img/painel-equipe.png) |

## Como funciona

```mermaid
flowchart LR
    A([Arrematante]) -->|abre link ou QR code| B[Bot no Telegram]
    B -->|termo do leiloeiro| B
    B -->|dados + e-mail confirmado<br/>+ CPF/CNPJ + documentos| C[(Banco)]
    B -->|documentos cifrados| D[(Bucket S3)]
    E([Equipe do leiloeiro]) -->|login| F[Painel web]
    F -->|ficha + documentos| E
    F -->|aprova ou recusa| B
    B -->|aviso da decisão| A
    F -->|ZIP: planilha + documentos| G[Plataforma de leilão]
```

1. O leiloeiro divulga o **link de habilitação** (`t.me/<bot>?start=<leiloeiro>`) ou o **QR code** gerado no painel.
2. O arrematante aceita o **termo daquele leiloeiro** e faz o cadastro: nome, e-mail confirmado por código, CPF/CNPJ (com dígito verificador), RG/IE, celular verificado pelo Telegram, endereço por CEP, dados exigidos pelo leiloeiro e foto/PDF do documento e do comprovante.
3. O cadastro é **único**: para se habilitar em outro leiloeiro parceiro, basta aceitar o termo dele.
4. A equipe do leiloeiro confere a ficha e os documentos no painel e **aprova ou recusa** (com motivo); o arrematante é avisado na hora no Telegram.
5. Os aprovados saem num **pacote ZIP** (planilha + documentos) para importar na plataforma de leilão.

## Arquitetura

```mermaid
flowchart TB
    TG[Telegram] -->|webhook HTTPS| APP
    subgraph Render
        APP[App Node.js<br/>bot grammY + API Express + painel]
    end
    APP --> PG[(Neon Postgres)]
    APP --> S3[(Neon Object Storage<br/>documentos AES-256-GCM)]
    APP --> MAIL[Resend<br/>código por e-mail]
    APP --> CEP[ViaCEP]
    GH[GitHub Actions] -->|CI em todo PR| APP
    GH -->|2x/dia: coleta e limpeza| APP
    APP -->|coleta| JIL[Jornal Imprensa Leilões]
```

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript (strict), Node.js 22 |
| Bot | grammY (webhook em produção, polling no desenvolvimento) |
| API e painel | Express 5 + HTML/CSS/JS sem dependências, CSP estrita |
| Banco | PostgreSQL 17 (migrações SQL próprias, em ordem) |
| Documentos | Bucket S3-compatível ou disco, sempre cifrados no servidor |
| Testes | Vitest + Supertest, integração com Postgres real |
| Entrega | Docker, Render, GitHub Actions |

## Mapa do repositório

```text
src/                    Código do servidor
  main.ts               Ponto de entrada: liga banco, bot, painel e tarefas
  bot/                  Bot do Telegram (cadastro e habilitação)
  painel/               API do painel: login, fila, ficha, decisões, configuração, equipe, QR code
  arrematantes/         Banco: cadastro do arrematante e habilitações
  leiloeiros/           Banco: leiloeiros
  exportacao/           CSV e pacote ZIP para a plataforma do leiloeiro
  docs/                 Guarda de documentos cifrados (disco ou S3)
  scraper/              Coleta do Jornal Imprensa Leilões
  tarefas/              Manutenção periódica (coleta, limpeza, expurgo LGPD)
  mail/ verificacao/    E-mail e código de confirmação
  config/ db/ http/     Variáveis de ambiente, banco/migrações, servidor HTTP
  scripts/              Comandos de linha (seed, operador, exportação...)
  util/                 Validações (CPF, CNPJ, CEP, datas)
painel-web/             Interface do painel
db/migrations/          Estrutura do banco (aplicada sozinha no deploy)
db/seeds/               Dados iniciais
tests/                  Testes automáticos
docs/                   Guias (deploy, piloto, revisão de PR), capturas e mockups
.github/                CI, agendador, modelo de PR, Dependabot
Dockerfile · render.yaml · docker-compose*.yml   Entrega e ambientes
```

## Rodar localmente

Pré-requisitos: Node 22+ e Docker. Use um **bot de teste** do @BotFather: o bot local se recusa a
iniciar com o token de produção.

```powershell
copy .env.example .env          # preencha TELEGRAM_TOKEN, APP_SECRET, DOCS_ENCRYPTION_KEY
npm install
docker compose -f docker-compose.dev.yml up -d
npm run migrate
npm run seed -- db/seeds/dev.sql
npm run dev
```

Abra `t.me/<seu_bot_de_teste>?start=colodete`. Sem SMTP/Resend configurado, o código de e-mail
aparece no console. Painel: `http://127.0.0.1:3000/painel/` (crie o login com `npm run operador:criar`).

## Testes

```powershell
npm test                        # unitários (sem banco)

docker compose -f docker-compose.dev.yml exec -T db psql -U sbl -d sbl -c "CREATE DATABASE sbl_test"
$env:TEST_DATABASE_URL="postgres://sbl:sbl_dev@127.0.0.1:5432/sbl_test"; npm test   # completo
```

O CI roda tudo isso em cada PR: tipos, testes com Postgres real, `npm audit` e build da imagem Docker.

## Como contribuir (fluxo de branches)

```text
main  ← única branch permanente = produção (deploy automático)
  └─ feat/<assunto>    funcionalidade nova
  └─ fix/<assunto>     correção
  └─ chore/<assunto>   organização e manutenção
```

1. Crie a branch a partir da `main` atualizada.
2. Abra o PR (o modelo já traz os tópicos). O check **testes** precisa ficar verde.
3. Revise com o roteiro [`docs/COMO-REVISAR-PR.md`](docs/COMO-REVISAR-PR.md).
4. **Squash and merge** e apague a branch.

A `main` é protegida: sem push direto, sem force-push, sem exclusão.

## Comandos úteis

| Comando | O que faz |
|---|---|
| `npm run operador:criar -- colodete email@x.com` | Cria login do painel (mostra a senha uma vez) |
| `npm run exportar:habilitados -- colodete aprovado` | Gera CSV de habilitados em `exports/` |
| `npm run coletar:imprensa` | Coleta notícias e edições do Jornal Imprensa Leilões |
| `npm run seed -- db/seeds/piloto.sql` | Migra o banco e cadastra o leiloeiro piloto |

Os comandos usam o `DATABASE_URL` do `.env`: confira se aponta para o banco certo (local ou produção).

## Deploy

Produção: Render (grátis) + Neon (Postgres e documentos) + Resend (e-mail). Cada merge na `main`
publica sozinho. Passo a passo: [`docs/DEPLOY_RENDER.md`](docs/DEPLOY_RENDER.md). Alternativa em VPS:
`docker-compose.yml` (com Caddy e HTTPS automático).

## Segurança e LGPD

- Documentos cifrados com AES-256-GCM antes de sair do servidor; apagados automaticamente após 180 dias.
- Painel com login (scrypt), bloqueio após 5 erros, papéis (responsável/operador), CSP estrita e auditoria de cada ação.
- Cada leiloeiro só enxerga os próprios arrematantes.
- Termo de aceite versionado: fica registrado qual versão cada arrematante aceitou.
- O titular apaga os próprios dados pelo bot com `/excluirmeusdados`.

## Roadmap

- [x] Cadastro único e habilitação por leiloeiro no Telegram
- [x] Painel do leiloeiro com decisão, auditoria, equipe e termo versionado
- [x] Exportação ZIP (planilha + documentos) e QR code do link
- [ ] Domínio próprio para o e-mail de confirmação
- [ ] Notificações por e-mail para a equipe do leiloeiro
- [ ] Layout de exportação no modelo oficial de importação da plataforma de leilão

## Contato

Quer usar o SBL no seu escritório de leilões ou contribuir com o projeto?

- **E-mail:** [dambrosimcolodete@gmail.com](mailto:dambrosimcolodete@gmail.com)
- **LinkedIn:** [Daniel Ambrosim Colodete](https://www.linkedin.com/in/daniel-ambrosim-colodete/)

## Licença

[MIT](LICENSE) © 2025 Daniel Ambrosim Colodete
