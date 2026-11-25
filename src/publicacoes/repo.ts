import type { Pool } from 'pg';

export interface NovaPublicacao {
  fonte: string;
  tipo: 'noticia' | 'edicao';
  titulo: string;
  resumo?: string | null;
  url: string;
  publicadoEm?: Date | null;
}

export interface Publicacao {
  titulo: string;
  resumo: string | null;
  url: string;
  tipo: 'noticia' | 'edicao';
  publicado_em: Date | null;
}

export interface PublicacaoRepo {
  /** Insere ignorando URLs já coletadas. Retorna quantas eram novas. */
  inserirNovas(itens: NovaPublicacao[]): Promise<number>;
  ultimas(fonte: string, tipo: 'noticia' | 'edicao', limite: number): Promise<Publicacao[]>;
}

export function createPublicacaoRepo(pool: Pool): PublicacaoRepo {
  return {
    async inserirNovas(itens) {
      let novas = 0;
      for (const p of itens) {
        const r = await pool.query(
          `INSERT INTO publicacoes (fonte, tipo, titulo, resumo, url, publicado_em)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (url) DO NOTHING`,
          [p.fonte, p.tipo, p.titulo, p.resumo ?? null, p.url, p.publicadoEm ?? null],
        );
        novas += r.rowCount ?? 0;
      }
      return novas;
    },
    async ultimas(fonte, tipo, limite) {
      const { rows } = await pool.query<Publicacao>(
        `SELECT titulo, resumo, url, tipo, publicado_em FROM publicacoes
          WHERE fonte = $1 AND tipo = $2
          ORDER BY coalesce(publicado_em, coletado_em) DESC LIMIT $3`,
        [fonte, tipo, limite],
      );
      return rows;
    },
  };
}
