import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    DATABASE_URL: z.string().url(),

    TELEGRAM_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, 'TELEGRAM_TOKEN em formato inválido'),
    BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
    PUBLIC_URL: z.string().url().optional(),
    TELEGRAM_WEBHOOK_SECRET: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,256}$/, 'TELEGRAM_WEBHOOK_SECRET: 32-256 chars [A-Za-z0-9_-]')
      .optional(),

    SUPERADMIN_CHAT_ID: z.coerce.number().int().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.BOT_MODE === 'webhook') {
      if (!env.PUBLIC_URL?.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'webhook exige PUBLIC_URL https://' });
      }
      if (!env.TELEGRAM_WEBHOOK_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['TELEGRAM_WEBHOOK_SECRET'], message: 'webhook exige segredo' });
      }
    }
  });

export type Env = z.infer<typeof schema>;

/** Valida variáveis de ambiente. Nunca inclui valores na mensagem de erro (evita vazar segredos em log). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida no .env:\n${problems}`);
  }
  return result.data;
}
