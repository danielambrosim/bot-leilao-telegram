import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createApp, MANUTENCAO_PATH, WEBHOOK_PATH } from '../src/http/app';
import { loadEnv } from '../src/config/env';
import { createS3DocStore } from '../src/docs/store';
import { montarBot, texto } from './helpers/botHarness';

const poolOk = { query: async () => ({ rows: [] }) } as unknown as Pool;
const SEGREDO = 'c'.repeat(40);

describe('rota de manutenção (agendador externo)', () => {
  const app = (manutencao: () => Promise<unknown> = async () => ({ feito: true })) => createApp({ pool: poolOk, cronSecret: SEGREDO, manutencao });

  it('sem segredo ou com segredo errado: 401 e não executa', async () => {
    let rodou = false;
    const a = app(async () => ((rodou = true), {}));
    expect((await request(a).post(MANUTENCAO_PATH)).status).toBe(401);
    expect((await request(a).post(MANUTENCAO_PATH).set('Authorization', 'Bearer errado')).status).toBe(401);
    expect(rodou).toBe(false);
  });

  it('com segredo correto executa e devolve resultado', async () => {
    const res = await request(app()).post(MANUTENCAO_PATH).set('Authorization', `Bearer ${SEGREDO}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, resultado: { feito: true } });
  });

  it('não existe se CRON_SECRET não estiver configurado', async () => {
    const res = await request(createApp({ pool: poolOk, manutencao: async () => ({}) })).post(MANUTENCAO_PATH);
    expect(res.status).toBe(404);
  });

  it('falha interna não vaza detalhes', async () => {
    const res = await request(
      app(async () => {
        throw new Error('senha do banco=xyz');
      }),
    )
      .post(MANUTENCAO_PATH)
      .set('Authorization', `Bearer ${SEGREDO}`);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('xyz');
  });
});

describe('webhook do Telegram', () => {
  const update = texto('/start');
  const montar = () => {
    const { bot, chamadas } = montarBot({ leiloeiros: { findAtivoPorSlug: async () => null } });
    return { app: createApp({ pool: poolOk, bot, webhookSecret: 'w'.repeat(40) }), chamadas };
  };

  it('rejeita sem o header secreto do Telegram', async () => {
    const { app, chamadas } = montar();
    const res = await request(app).post(WEBHOOK_PATH).send(update);
    expect(res.status).toBe(401);
    expect(chamadas).toHaveLength(0);
  });

  it('processa com o header correto', async () => {
    const { app, chamadas } = montar();
    const res = await request(app).post(WEBHOOK_PATH).set('X-Telegram-Bot-Api-Secret-Token', 'w'.repeat(40)).send(update);
    expect(res.status).toBe(200);
    expect(chamadas.some((c) => c.method === 'sendMessage')).toBe(true);
  });
});

describe('env no Render', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@ep-x.us-east-1.aws.neon.tech/db?sslmode=require',
    TELEGRAM_TOKEN: '123456789:AAEexampleexampleexampleexample_-12',
    APP_SECRET: 's'.repeat(40),
    DOCS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    NODE_ENV: 'production',
    SMTP_HOST: 'smtp.x',
    MAIL_FROM: 'a@b.com',
    BOT_MODE: 'webhook',
    TELEGRAM_WEBHOOK_SECRET: 'w'.repeat(40),
  };

  it('usa RENDER_EXTERNAL_URL como PUBLIC_URL', () => {
    expect(loadEnv({ ...base, RENDER_EXTERNAL_URL: 'https://sbl-bot.onrender.com' }).PUBLIC_URL).toBe('https://sbl-bot.onrender.com');
  });

  it('DOCS_STORAGE=s3 exige credenciais do bucket', () => {
    expect(() => loadEnv({ ...base, RENDER_EXTERNAL_URL: 'https://x.onrender.com', DOCS_STORAGE: 's3' })).toThrow(
      /S3_ENDPOINT[\s\S]*S3_BUCKET[\s\S]*S3_ACCESS_KEY_ID[\s\S]*S3_SECRET_ACCESS_KEY/,
    );
  });
});

// Integração com bucket S3 real (MinIO). Ex.:
//   docker run -d --name sbl-s3 -p 127.0.0.1:9000:9090 -e initialBuckets=sbl-teste adobe/s3mock:4.2.0
//   TEST_S3_ENDPOINT=http://127.0.0.1:9000 npm test
const s3url = process.env.TEST_S3_ENDPOINT;
describe.skipIf(!s3url)('DocStore S3 (servidor S3 local)', () => {
  const cfg = { endpoint: s3url!, region: 'us-east-1', bucket: 'sbl-teste', accessKeyId: 'sbltest', secretAccessKey: 'sbltest123' };
  const chave = Buffer.alloc(32, 9).toString('base64');

  it('salva cifrado no bucket, lê decifrado e apaga', async () => {
    const s3 = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
    await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket })).catch(() => undefined);
    const store = createS3DocStore(cfg, chave);
    const original = Buffer.from('RG 12.345.678-9 MARIA DA SILVA');
    const s = await store.salvar('chat-42', original);

    const bruto = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: s.chave }))).Body!.transformToByteArray());
    expect(bruto.includes(Buffer.from('MARIA'))).toBe(false); // provedor nunca vê o conteúdo
    expect((await store.ler(s.chave)).equals(original)).toBe(true);

    await store.apagar(s.chave);
    await expect(store.ler(s.chave)).rejects.toThrow();
    await expect(store.ler('../segredo')).rejects.toThrow(/inválida/);
  });
});

describe('env tolerante a valores colados com aspas/espaços (erro real do Render)', () => {
  it('remove aspas e espaços das pontas', () => {
    const env = loadEnv({
      DATABASE_URL: ' "postgres://u:p@h/db" ',
      TELEGRAM_TOKEN: '123456789:AAEexampleexampleexampleexample_-12',
      APP_SECRET: "'" + 's'.repeat(40) + "'",
      DOCS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      DOCS_STORAGE: 's3',
      S3_ENDPOINT: '"https://br-x.storage.c-15.us-east-1.aws.neon.tech"',
      S3_REGION: '"us-east-1"',
      S3_BUCKET: 'sbl-docs',
      S3_ACCESS_KEY_ID: '"nak_x"',
      S3_SECRET_ACCESS_KEY: '"nsk_y"',
    });
    expect(env.S3_ENDPOINT).toBe('https://br-x.storage.c-15.us-east-1.aws.neon.tech');
    expect(env.S3_REGION).toBe('us-east-1');
    expect(env.S3_ACCESS_KEY_ID).toBe('nak_x');
  });

  it('produção aceita Resend por API sem SMTP_HOST', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@h/db',
      TELEGRAM_TOKEN: '123456789:AAEexampleexampleexampleexample_-12',
      APP_SECRET: 's'.repeat(40),
      DOCS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
      NODE_ENV: 'production',
      MAIL_FROM: 'a@b.com',
    };
    expect(() => loadEnv(base)).toThrow(/SMTP_HOST ou RESEND_API_KEY/);
    expect(loadEnv({ ...base, RESEND_API_KEY: 're_abc' }).RESEND_API_KEY).toBe('re_abc');
  });
});
