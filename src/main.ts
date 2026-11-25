import { config } from 'dotenv';
import { loadEnv } from './config/env';
import { createPool } from './db/pool';
import { createLeiloeiroRepo } from './leiloeiros/repo';
import { createArrematanteRepo } from './arrematantes/repo';
import { createCodigoEmailService } from './verificacao/codigoEmail';
import { createMailer } from './mail/mailer';
import { createLocalDocStore } from './docs/store';
import { createPublicacaoRepo } from './publicacoes/repo';
import { coletarImprensaLeiloes } from './scraper/imprensaLeiloes';
import { createBot, type SessionData } from './bot/createBot';
import { createPgSessionStorage, limparSessoesExpiradas } from './bot/sessionStorage';
import { createApp } from './http/app';

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
    docs: createLocalDocStore(env.DOCS_DIR, env.DOCS_ENCRYPTION_KEY),
    publicacoes,
    sessionStorage: createPgSessionStorage<SessionData>(pool),
  });
  const webhook = env.BOT_MODE === 'webhook';
  const app = createApp({ pool, bot: webhook ? bot : undefined, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET });

  const host = env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
  const server = app.listen(env.PORT, host, () => console.log(`HTTP em ${host}:${env.PORT} (bot: ${env.BOT_MODE})`));

  if (webhook) {
    await bot.init();
  } else {
    // Polling só para desenvolvimento local; remove webhook antigo para não conflitar
    await bot.api.deleteWebhook();
    void bot.start({ onStart: (me) => console.log(`Bot @${me.username} em polling`) });
  }

  // Tarefas periódicas
  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => void limparSessoesExpiradas(pool).catch(() => undefined), 15 * 60_000));
  if (env.SCRAPER_ENABLED) {
    const coletar = () =>
      coletarImprensaLeiloes(publicacoes)
        .then((r) => console.log(`[scraper] imprensa-leiloes: ${r.inseridas} novas, ${r.erros.length} erros`))
        .catch((e) => console.error('[scraper] falhou:', e.message));
    timers.push(setTimeout(coletar, 60_000));
    timers.push(setInterval(coletar, env.SCRAPER_INTERVAL_HOURS * 3_600_000));
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
