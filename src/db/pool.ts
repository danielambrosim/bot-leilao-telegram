import { Pool } from 'pg';

export function createPool(databaseUrl: string): Pool {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  // Erro em conexão ociosa não deve derrubar o processo
  pool.on('error', (err) => console.error('[pg] erro em conexão ociosa:', err.message));
  return pool;
}
