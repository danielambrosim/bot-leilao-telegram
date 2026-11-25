import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';
import { config } from 'dotenv';
import { createPool } from './pool';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');
const LOCK_ID = 7_310_001; // advisory lock: evita duas instâncias migrando ao mesmo tempo

/** Aplica, em ordem e em transação, os .sql ainda não registrados em schema_migrations. */
export async function migrate(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (nome TEXT PRIMARY KEY, aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ nome: string }>('SELECT nome FROM schema_migrations');
    const done = new Set(rows.map((r) => r.nome));
    const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migração ${file}: ${(err as Error).message}`);
      }
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

// Execução via CLI: npm run migrate
if (require.main === module) {
  (async () => {
    config({ quiet: true });
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL não definido');
    const pool = createPool(url);
    try {
      const applied = await migrate(pool);
      console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Banco já está atualizado.');
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
