import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../db/pool';
import { migrate } from '../db/migrate';

// Uso: npm run seed -- db/seeds/piloto.sql
// Roda de qualquer máquina com acesso ao banco (ex.: Neon), sem precisar de psql.
(async () => {
  config({ quiet: true });
  const arquivo = process.argv[2];
  if (!arquivo || !/^db[\\/]seeds[\\/][a-z0-9_-]+\.sql$/.test(arquivo)) {
    throw new Error('Informe um arquivo de db/seeds. Ex.: npm run seed -- db/seeds/piloto.sql');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  const pool = createPool(url);
  try {
    const aplicadas = await migrate(pool);
    if (aplicadas.length) console.log(`Migrações aplicadas: ${aplicadas.join(', ')}`);
    await pool.query(await readFile(path.resolve(arquivo), 'utf8'));
    const { rows } = await pool.query('SELECT slug, nome FROM leiloeiros ORDER BY id');
    console.log('Leiloeiros:', rows.map((r) => `${r.slug} (${r.nome})`).join(', '));
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
