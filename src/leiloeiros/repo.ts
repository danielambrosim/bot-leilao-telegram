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
  /** Leiloeiros que aceitam habilitação pelo bot (botão "Escolher leiloeiro") */
  listarAtivos(): Promise<Array<Pick<Leiloeiro, 'slug' | 'nome'>>>;
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
    async listarAtivos() {
      const { rows } = await pool.query<{ slug: string; nome: string }>(
        'SELECT slug, nome FROM leiloeiros WHERE ativo ORDER BY nome LIMIT 50',
      );
      return rows;
    },
  };
}
