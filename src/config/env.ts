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

    // Segredo da aplicação (HMAC dos códigos de e-mail). Gere: openssl rand -base64 48
    APP_SECRET: z.string().min(32, 'APP_SECRET precisa de ao menos 32 caracteres'),

    // Documentos: armazenamento criptografado (AES-256-GCM). Chave = 32 bytes em base64.
    DOCS_DIR: z.string().default('./data/docs'),
    DOCS_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DOCS_ENCRYPTION_KEY deve ter 32 bytes em base64'),

    // E-mail (SMTP). Sem SMTP_HOST em desenvolvimento, o código é exibido no console.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    // Coleta do Jornal Imprensa Leilões
    SCRAPER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SCRAPER_INTERVAL_HOURS: z.coerce.number().min(1).max(168).default(12),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && (!env.SMTP_HOST || !env.MAIL_FROM)) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'produção exige SMTP_HOST e MAIL_FROM' });
    }
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
