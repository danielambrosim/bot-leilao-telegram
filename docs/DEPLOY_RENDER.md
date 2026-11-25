# Deploy no Render (plano grátis)

Arquitetura: **Render** (app, webhook) + **Neon** (Postgres) + **bucket S3** (documentos cifrados) + **SMTP** + **GitHub Actions** (agendador).
Custo: R$ 0. Limite: o serviço dorme após 15 min sem tráfego e leva ~1 min para acordar
(a mensagem do arrematante não se perde: o Telegram reenvia até o bot responder).

## 1. Contas (feitas por você)

| Serviço | O que criar | Anotar |
|---|---|---|
| [Neon](https://neon.tech) | Projeto na região **AWS us-east-1** | Connection string (`postgresql://...?sslmode=require`) |
| [Cloudflare R2](https://developers.cloudflare.com/r2/) *(pede cartão, 10 GB grátis)* ou [Backblaze B2](https://www.backblaze.com/cloud-storage) | Bucket **privado** `sbl-docs` + chave de API só para esse bucket | Endpoint S3, região, bucket, access key, secret |
| [Resend](https://resend.com) ou [Brevo](https://www.brevo.com) | Conta + SMTP | Host, porta, usuário, senha, remetente |
| [Render](https://render.com) | Conta conectada ao GitHub | — |

Endpoints S3 comuns:
- R2: `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`
- B2: `S3_ENDPOINT=https://s3.<região>.backblazeb2.com`, `S3_REGION=<região>`

## 2. Gerar segredos (no seu PC)

```powershell
node -e "console.log('TELEGRAM_WEBHOOK_SECRET=' + require('crypto').randomBytes(32).toString('base64url'))"
node -e "console.log('DOCS_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

> **Guarde a `DOCS_ENCRYPTION_KEY` em local seguro (gerenciador de senhas).** Sem ela, os documentos no bucket são ilegíveis para sempre.
> Não reutilize a chave do `.env` local.

## 3. Banco (uma vez, do seu PC)

```powershell
$env:DATABASE_URL="<connection string do Neon>"; npm run seed -- db/seeds/piloto.sql
```
Cria as tabelas e o leiloeiro `colodete`.

## 4. Render

1. Faça push da branch para o GitHub.
2. Render > **New > Blueprint** > escolha o repositório e a branch. O `render.yaml` cria o serviço `sbl-bot`.
3. Preencha as variáveis marcadas como *sync: false* (token, webhook secret, DATABASE_URL, DOCS_ENCRYPTION_KEY, S3_*, SMTP_*, MAIL_FROM).
4. Deploy. No log deve aparecer: `Webhook registrado em https://sbl-bot.onrender.com/telegram/webhook`.

> **Pare o piloto local antes** (`docker compose -f docker-compose.piloto.yml down`). O mesmo token não funciona em polling e webhook ao mesmo tempo: o deploy no Render passa a receber as mensagens.

## 5. Agendador (GitHub Actions)

Repositório > Settings > Secrets and variables > Actions:
- `SBL_URL` = `https://sbl-bot.onrender.com`
- `SBL_CRON_SECRET` = valor de `CRON_SECRET` (Render > Environment)

O workflow `.github/workflows/manutencao.yml` roda às 06:17 e 18:17: coleta o Imprensa Leilões e limpa sessões/códigos vencidos. Teste em Actions > manutencao > Run workflow.

## 6. Verificar

```powershell
curl https://sbl-bot.onrender.com/healthz
```
Depois: `t.me/api_leilao_bot?start=colodete` e siga `docs/PILOTO.md`.

## Exportar habilitados (sem shell no Render)

Roda do seu PC, direto no Neon:
```powershell
$env:DATABASE_URL="<connection string do Neon>"; npm run exportar:habilitados -- colodete aprovado
```

## Quando sair do grátis
- Render Starter (sem dormir) ou VPS: nenhuma mudança de código.
- Neon e bucket continuam os mesmos.
