import { config } from 'dotenv';
import { loadEnv, type Env } from './config/env';
import { createPool } from './db/pool';
import { createLeiloeiroRepo } from './leiloeiros/repo';
import { createArrematanteRepo } from './arrematantes/repo';
import { createCodigoEmailService } from './verificacao/codigoEmail';
import { createMailer } from './mail/mailer';
import { createLocalDocStore, createS3DocStore, type DocStore } from './docs/store';
import { createPublicacaoRepo } from './publicacoes/repo';
import { createBot, type SessionData } from './bot/createBot';
import { createPgSessionStorage } from './bot/sessionStorage';
import { createApp, WEBHOOK_PATH } from './http/app';
import { executarManutencao } from './tarefas/manutencao';

function criarDocStore(env: Env): DocStore {
  if (env.DOCS_STORAGE === 's3') {
    return createS3DocStore(
      {
        endpoint: env.S3_ENDPOINT!,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET!,
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
      env.DOCS_ENCRYPTION_KEY,
    );
  }
  return createLocalDocStore(env.DOCS_DIR, env.DOCS_ENCRYPTION_KEY);
}

async function main() {
  config({ quiet: true });
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  await pool.query('SELECT 1'); // falha cedo e com mensagem clara se o banco estiver fora

  const publicacoes = createPublicacaoRepo(pool);
  const bot = createBot({
    token: env.TELEGRAM_TOKEN,
    leiloeiros: createLeiloeiroRepo(pool),
    arrematantes: createArrematanteRepo(pool),
    codigos: createCodigoEmailService(pool, env.APP_SECRET),
    mailer: createMailer(env),
    docs: criarDocStore(env),
    publicacoes,
    sessionStorage: createPgSessionStorage<SessionData>(pool),
  });
  const manutencao = () => executarManutencao(pool, publicacoes, { coletar: env.SCRAPER_ENABLED });
  const webhook = env.BOT_MODE === 'webhook';
  const app = createApp({
    pool,
    bot: webhook ? bot : undefined,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
    cronSecret: env.CRON_SECRET,
    manutencao,
  });

  const host = env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  const server = app.listen(env.PORT, host, () =>
    console.log(`HTTP em ${host}:${env.PORT} (bot: ${env.BOT_MODE}, docs: ${env.DOCS_STORAGE})`),
  );

  if (webhook) {
    await bot.init();
    // Registra o webhook sozinho (Render não oferece shell no plano grátis). Só chama a API se mudou.
    const url = new URL(WEBHOOK_PATH, env.PUBLIC_URL).toString();
    const atual = await bot.api.getWebhookInfo();
    if (atual.url !== url) {
      await bot.api.setWebhook(url, {
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message', 'callback_query'],
      });
      console.log(`Webhook registrado em ${url}`);
    }
  } else {
    // Polling: desenvolvimento local ou piloto em máquina própria; remove webhook antigo para não conflitar
    await bot.api.deleteWebhook();
    void bot.start({ onStart: (me) => console.log(`Bot @${me.username} em polling`) });
  }

  // Tarefas periódicas internas só quando não há agendador externo (CRON_SECRET).
  // Em host que dorme (Render grátis) um timer interno rodaria a cada "acordada".
  const timers: NodeJS.Timeout[] = [];
  if (!env.CRON_SECRET) {
    const rodar = () =>
      manutencao()
        .then((r) => console.log('[manutencao]', JSON.stringify(r)))
        .catch((e) => console.error('[manutencao] falhou:', e.message));
    timers.push(setTimeout(rodar, 60_000));
    timers.push(setInterval(rodar, env.SCRAPER_INTERVAL_HOURS * 3_600_000));
  }

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal} recebido, encerrando...`);
    timers.forEach(clearTimeout);
    await bot.stop().catch(() => undefined);
    server.close();
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
