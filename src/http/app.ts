import { timingSafeEqual } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { webhookCallback, type Bot } from 'grammy';
import type { Pool } from 'pg';

export interface AppDeps {
  pool: Pool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot?: Bot<any>;
  webhookSecret?: string;
  /** Segredo do agendador externo; sem ele a rota de manutenção não existe */
  cronSecret?: string;
  manutencao?: () => Promise<unknown>;
  /** Painel do leiloeiro, montado em /painel */
  painel?: express.Router;
}

export const WEBHOOK_PATH = '/telegram/webhook';
export const MANUTENCAO_PATH = '/tarefas/manutencao';

function segredoConfere(header: string | undefined, esperado: string): boolean {
  const recebido = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const alvo = Buffer.from(esperado);
  return recebido.length === alvo.length && timingSafeEqual(recebido, alvo);
}

export function createApp({ pool, bot, webhookSecret, cronSecret, manutencao, painel }: AppDeps) {
  const app = express();
  app.set('trust proxy', 1); // atrás de proxy (Caddy / Render)
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
    // O Telegram envia o segredo no header X-Telegram-Bot-Api-Secret-Token; o grammY rejeita (401) se não bater.
    // onTimeout 'return': em etapa lenta (upload de documentos, cold start) responde 200 e continua processando,
    // evitando que o Telegram reenvie o mesmo update e duplique o cadastro.
    app.post(
      WEBHOOK_PATH,
      rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }),
      webhookCallback(bot, 'express', { secretToken: webhookSecret, timeoutMilliseconds: 25_000, onTimeout: 'return' }),
    );
  }

  if (cronSecret && manutencao) {
    app.post(
      MANUTENCAO_PATH,
      rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }),
      async (req, res, next) => {
        if (!segredoConfere(req.get('authorization'), cronSecret)) {
          res.status(401).json({ error: 'unauthorized' });
          return;
        }
        try {
          res.json({ ok: true, resultado: await manutencao() });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  if (painel) {
    app.get('/', (_req, res) => res.redirect(302, '/painel/'));
    app.use('/painel', painel);
  }

  // Tudo que não foi declarado acima não existe (sem rotas admin abertas)
  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // Nunca devolver stack trace ou mensagem interna ao cliente
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    // Erros do cliente (ex.: 403/404 do express.static em path traversal) mantêm o status, sem detalhes
    const status = Number(err?.status ?? err?.statusCode);
    if (status >= 400 && status < 500) {
      res.status(status === 403 ? 404 : status).json({ error: 'not_found' });
      return;
    }
    console.error('[http]', err);
    res.status(500).json({ error: 'internal_error' });
  };
  app.use(onError);

  return app;
}
