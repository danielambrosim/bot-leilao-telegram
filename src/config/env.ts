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
    // local = disco (dev/VPS) · s3 = bucket S3-compatível (R2, Supabase Storage, B2) para hosts sem disco
    DOCS_STORAGE: z.enum(['local', 's3']).default('local'),
    DOCS_DIR: z.string().default('./data/docs'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),

    // Render injeta automaticamente; usado como PUBLIC_URL quando esta não for definida
    RENDER_EXTERNAL_URL: z.string().url().optional(),

    // Protege POST /tarefas/manutencao (chamado por agendador externo, ex.: GitHub Actions)
    CRON_SECRET: z.string().min(32, 'CRON_SECRET precisa de ao menos 32 caracteres').optional(),
    DOCS_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'DOCS_ENCRYPTION_KEY deve ter 32 bytes em base64'),

    // E-mail (SMTP). Sem SMTP_HOST em desenvolvimento, o código é exibido no console.
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),

    // Resend via API HTTPS (recomendado em hosts que bloqueiam SMTP, como o Render grátis).
    // Se ausente e SMTP_HOST=smtp.resend.com, a chave de SMTP_PASS é usada na API.
    RESEND_API_KEY: z.string().regex(/^re_[A-Za-z0-9_]+$/, 'RESEND_API_KEY deve começar com re_').optional(),

    // Coleta do Jornal Imprensa Leilões
    SCRAPER_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    SCRAPER_INTERVAL_HOURS: z.coerce.number().min(1).max(168).default(12),
  })
  .transform((env) => ({ ...env, PUBLIC_URL: env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL }))
  .superRefine((env, ctx) => {
    if (env.DOCS_STORAGE === 's3') {
      for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
        if (!env[k]) ctx.addIssue({ code: 'custom', path: [k], message: `DOCS_STORAGE=s3 exige ${k}` });
      }
    }
    if (env.NODE_ENV === 'production' && ((!env.SMTP_HOST && !env.RESEND_API_KEY) || !env.MAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'produção exige MAIL_FROM e um meio de envio (SMTP_HOST ou RESEND_API_KEY)',
      });
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
  // Painéis de hospedagem guardam o valor literal: remove espaços e aspas coladas por engano ("valor")
  const limpar = (v: string) => v.trim().replace(/^(["'])(.*)\1$/, '$2');
  const cleaned = Object.fromEntries(
    Object.entries(source)
      .filter((e): e is [string, string] => typeof e[1] === 'string')
      .map(([k, v]) => [k, limpar(v)] as const)
      .filter(([, v]) => v !== ''),
  );
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida no .env:\n${problems}`);
  }
  return result.data;
}
