import { config } from 'dotenv';
import { Bot } from 'grammy';
import { loadEnv } from '../config/env';
import { WEBHOOK_PATH } from '../http/app';

// Uso (produção): BOT_MODE=webhook npm run webhook:set
(async () => {
  config({ quiet: true });
  const env = loadEnv();
  if (env.BOT_MODE !== 'webhook') throw new Error('Defina BOT_MODE=webhook antes de registrar o webhook.');
  const bot = new Bot(env.TELEGRAM_TOKEN);
  const url = new URL(WEBHOOK_PATH, env.PUBLIC_URL).toString();
  await bot.api.setWebhook(url, {
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  console.log(`Webhook registrado em ${url}`);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
