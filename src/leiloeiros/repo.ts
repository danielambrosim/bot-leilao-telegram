import type { Pool } from 'pg';

export interface Leiloeiro {
  id: number;
  slug: string;
  nome: string;
  termo_texto: string;
  termo_versao: number;
}

export interface LeiloeiroRepo {
  findAtivoPorSlug(slug: string): Promise<Leiloeiro | null>;
}

export function createLeiloeiroRepo(pool: Pool): LeiloeiroRepo {
  return {
    async findAtivoPorSlug(slug) {
      const { rows } = await pool.query<Leiloeiro>(
        `SELECT id::int AS id, slug, nome, termo_texto, termo_versao
           FROM leiloeiros WHERE slug = $1 AND ativo LIMIT 1`,
        [slug],
      );
      return rows[0] ?? null;
    },
  };
}
