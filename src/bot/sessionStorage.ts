import type { StorageAdapter } from 'grammy';
import type { Pool } from 'pg';

/** Sessões do bot no Postgres com expiração (sobrevivem a restart; somem sozinhas se abandonadas). */
export function createPgSessionStorage<T>(pool: Pool, ttlMinutos = 30): StorageAdapter<T> {
  return {
    async read(chave) {
      const { rows } = await pool.query<{ dados: T }>(
        'SELECT dados FROM sessoes_bot WHERE chave = $1 AND expira_em > now()',
        [chave],
      );
      return rows[0]?.dados;
    },
    async write(chave, valor) {
      await pool.query(
        `INSERT INTO sessoes_bot (chave, dados, expira_em) VALUES ($1, $2, now() + make_interval(mins => $3))
         ON CONFLICT (chave) DO UPDATE SET dados = EXCLUDED.dados, expira_em = EXCLUDED.expira_em`,
        [chave, JSON.stringify(valor), ttlMinutos],
      );
    },
    async delete(chave) {
      await pool.query('DELETE FROM sessoes_bot WHERE chave = $1', [chave]);
    },
  };
}

/** Remove sessões expiradas (chamado periodicamente). */
export async function limparSessoesExpiradas(pool: Pool): Promise<number> {
  const r = await pool.query('DELETE FROM sessoes_bot WHERE expira_em <= now()');
  return r.rowCount ?? 0;
}
