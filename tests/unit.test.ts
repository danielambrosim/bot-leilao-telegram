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
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db', TELEGRAM_TOKEN: TOKEN };

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
