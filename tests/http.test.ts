import { describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Pool } from 'pg';
import { createApp } from '../src/http/app';

const poolOk = { query: async () => ({ rows: [{ '?column?': 1 }] }) } as unknown as Pool;
const poolDown = {
  query: async () => {
    throw new Error('ECONNREFUSED 127.0.0.1:5432');
  },
} as unknown as Pool;

describe('HTTP', () => {
  it('healthz ok com banco no ar', async () => {
    const res = await request(createApp({ pool: poolOk })).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('healthz 503 sem vazar erro interno', async () => {
    const res = await request(createApp({ pool: poolDown })).get('/healthz');
    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  it.each([
    ['get', '/api/admin/admin/usuarios'],
    ['get', '/api/admin/usuarios/handlers/cadastrar'],
    ['post', '/admin/usuarios/cadastrar'],
    ['post', '/api/admin/admin/usuarios/exportar-csv'],
    ['get', '/pdfs/../.env'],
  ] as const)('ADM: rota antiga %s %s não existe mais (404)', async (method, path) => {
    const res = await request(createApp({ pool: poolOk }))[method](path);
    expect(res.status).toBe(404);
  });

  it('cabeçalhos de segurança (helmet) e sem x-powered-by', async () => {
    const res = await request(createApp({ pool: poolOk })).get('/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('webhook só existe quando configurado', async () => {
    const res = await request(createApp({ pool: poolOk })).post('/telegram/webhook').send({});
    expect(res.status).toBe(404);
  });
});
