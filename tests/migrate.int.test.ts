import { afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { createLeiloeiroRepo } from '../src/leiloeiros/repo';

// Integração: requer Postgres. Ex.: docker compose -f docker-compose.dev.yml up -d
//   TEST_DATABASE_URL=postgres://sbl:sbl_dev@127.0.0.1:5432/sbl_test npm test
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('migrações + repositório (Postgres real)', () => {
  const pool = createPool(url!);
  afterAll(() => pool.end());

  it('aplica do zero e é idempotente', async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    expect(await migrate(pool)).toEqual(['001_init.sql', '002_publicacoes.sql', '003_dados_cadastrais.sql', '004_painel.sql', '005_dados_complementares.sql']);
    expect(await migrate(pool)).toEqual([]);
  });

  it('seed + busca por slug (só ativos)', async () => {
    await pool.query(await readFile(path.resolve(__dirname, '../db/seeds/dev.sql'), 'utf8'));
    const repo = createLeiloeiroRepo(pool);
    expect((await repo.findAtivoPorSlug('demo'))?.nome).toBe('Leiloeiro Demonstração');
    await pool.query(`UPDATE leiloeiros SET ativo = false WHERE slug = 'demo'`);
    expect(await repo.findAtivoPorSlug('demo')).toBeNull();
  });

  it('ADM-05: status é independente por leiloeiro', async () => {
    const { rows: l } = await pool.query(
      `INSERT INTO leiloeiros (slug, nome, termo_texto) VALUES ('aaa','A','t'),('bbb','B','t') RETURNING id`,
    );
    const { rows: a } = await pool.query(
      `INSERT INTO arrematantes (telegram_chat_id, nome, email, cpf, endereco)
       VALUES (1,'X','x@x.com','52998224725','Rua 1, 100') RETURNING id`,
    );
    for (const lei of l) {
      await pool.query(`INSERT INTO habilitacoes (arrematante_id, leiloeiro_id, termo_versao) VALUES ($1,$2,1)`, [
        a[0].id,
        lei.id,
      ]);
    }
    await pool.query(`UPDATE habilitacoes SET status='aprovado' WHERE arrematante_id=$1 AND leiloeiro_id=$2`, [
      a[0].id,
      l[0].id,
    ]);
    const { rows } = await pool.query(`SELECT status FROM habilitacoes WHERE arrematante_id=$1 ORDER BY leiloeiro_id`, [
      a[0].id,
    ]);
    expect(rows.map((r) => r.status)).toEqual(['aprovado', 'pendente']);
  });

  it('restrições do banco barram dados inválidos', async () => {
    await expect(
      pool.query(`INSERT INTO leiloeiros (slug, nome, termo_texto) VALUES ('X;drop','n','t')`),
    ).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO arrematantes (telegram_chat_id,nome,email,cpf,endereco) VALUES (2,'n','n@n.com','123','e')`),
    ).rejects.toThrow();
    await expect(
      pool.query(`INSERT INTO editais (leiloeiro_id,titulo,url) SELECT id,'t','javascript:alert(1)' FROM leiloeiros LIMIT 1`),
    ).rejects.toThrow();
  });
});
