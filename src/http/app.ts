import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { webhookCallback, type Bot } from 'grammy';
import type { Pool } from 'pg';

export interface AppDeps {
  pool: Pool;
  bot?: Bot;
  webhookSecret?: string;
}

export const WEBHOOK_PATH = '/telegram/webhook';

export function createApp({ pool, bot, webhookSecret }: AppDeps) {
  const app = express();
  app.set('trust proxy', 1); // atrás do Caddy
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  if (bot && webhookSecret) {
    // O Telegram envia o segredo no header X-Telegram-Bot-Api-Secret-Token; o grammY rejeita (401) se não bater
    app.post(
      WEBHOOK_PATH,
      rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }),
      webhookCallback(bot, 'express', { secretToken: webhookSecret }),
    );
  }

  // Tudo que não foi declarado acima não existe (sem rotas admin abertas)
  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Nunca devolver stack trace ou mensagem interna ao cliente
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error('[http]', err);
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);

  return app;
}
