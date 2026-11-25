import { describe, expect, it } from 'vitest';
import { escapeHtml, parseStartPayload } from '../src/bot/startPayload';
import { loadEnv } from '../src/config/env';

const TOKEN = '123456789:AAEexampleexampleexampleexample_-12';

describe('parseStartPayload', () => {
  it.each([
    ['colodete', 'colodete'],
    ['  Demo_1 ', 'demo_1'],
    ['leiloeiro-sp', 'leiloeiro-sp'],
  ])('aceita %j', (input, out) => expect(parseStartPayload(input)).toBe(out));

  it.each([undefined, null, '', 'ab', 'a'.repeat(41), 'drop table', '../x', 'x;y', '<b>'])(
    'rejeita %j',
    (input) => expect(parseStartPayload(input as string)).toBeNull(),
  );
});

describe('escapeHtml', () => {
  it('neutraliza tags e entidades', () => {
    expect(escapeHtml('<b>A&B</b>')).toBe('&lt;b&gt;A&amp;B&lt;/b&gt;');
  });
});

describe('loadEnv', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    TELEGRAM_TOKEN: TOKEN,
    APP_SECRET: 's'.repeat(40),
    DOCS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };

  it('aplica padrões', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.BOT_MODE).toBe('polling');
  });

  it('INF-01: falha clara sem token e sem vazar valores', () => {
    expect(() => loadEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/TELEGRAM_TOKEN/);
    try {
      loadEnv({ ...base, TELEGRAM_TOKEN: 'segredo-invalido' });
    } catch (e) {
      expect((e as Error).message).not.toContain('segredo-invalido');
    }
  });

  it('webhook exige https e segredo forte', () => {
    expect(() => loadEnv({ ...base, BOT_MODE: 'webhook', PUBLIC_URL: 'http://x.com' })).toThrow(
      /PUBLIC_URL[\s\S]*TELEGRAM_WEBHOOK_SECRET/,
    );
    expect(() =>
      loadEnv({ ...base, BOT_MODE: 'webhook', PUBLIC_URL: 'https://x.com', TELEGRAM_WEBHOOK_SECRET: 'curto' }),
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    const ok = loadEnv({
      ...base,
      BOT_MODE: 'webhook',
      PUBLIC_URL: 'https://x.com',
      TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(40),
    });
    expect(ok.BOT_MODE).toBe('webhook');
  });

  it('variável vazia conta como ausente', () => {
    expect(loadEnv({ ...base, PORT: '' }).PORT).toBe(3000);
  });
});

describe('loadEnv (fase 2)', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    TELEGRAM_TOKEN: TOKEN,
    APP_SECRET: 's'.repeat(40),
    DOCS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  };
  it('exige chave de documentos de 32 bytes e APP_SECRET forte', () => {
    expect(() => loadEnv({ ...base, DOCS_ENCRYPTION_KEY: 'curta' })).toThrow(/DOCS_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...base, APP_SECRET: 'curto' })).toThrow(/APP_SECRET/);
  });
  it('produção exige SMTP (nunca mostrar código no console)', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/SMTP_HOST/);
    expect(loadEnv({ ...base, NODE_ENV: 'production', SMTP_HOST: 'smtp.x', MAIL_FROM: 'a@b.com' }).NODE_ENV).toBe('production');
  });
  it('SCRAPER_ENABLED vira boolean', () => {
    expect(loadEnv(base).SCRAPER_ENABLED).toBe(false);
    expect(loadEnv({ ...base, SCRAPER_ENABLED: 'true' }).SCRAPER_ENABLED).toBe(true);
  });
});
