import type { Pool } from 'pg';
import { ESTADOS_CIVIS, type EstadoCivil, type StatusHabilitacao, type TipoDocumento } from '../arrematantes/repo';

/** Consultas do painel. TODAS filtram por leiloeiro_id do operador logado (isolamento entre leiloeiros). */

export interface ItemFila {
  id: number;
  nome: string;
  cpf_final: string;
  cnpj: boolean;
  cidade: string | null;
  uf: string | null;
  status: StatusHabilitacao;
  consentido_em: Date;
}

export interface Ficha {
  id: number;
  status: StatusHabilitacao;
  termo_versao: number;
  consentido_em: Date;
  decidido_em: Date | null;
  decidido_por: string | null;
  motivo: string | null;
  arrematante: {
    nome: string;
    email: string;
    cpf: string;
    cnpj: string | null;
    rg_ie: string | null;
    celular: string | null;
    endereco: string;
    cidade: string | null;
    uf: string | null;
    email_verificado_em: Date | null;
    data_nascimento: string | null;
    estado_civil: string | null;
    profissao: string | null;
    razao_social: string | null;
  };
  documentos: Array<{ tipo: TipoDocumento; mime: string; tamanho_bytes: number }>;
  historico: Array<{ em: Date; acao: string; quem: string | null }>;
}

export type Decisao = 'aprovado' | 'recusado' | 'revogado';
const TRANSICOES: Record<Decisao, StatusHabilitacao[]> = {
  aprovado: ['pendente'],
  recusado: ['pendente'],
  revogado: ['aprovado'],
};

export function createPainelRepo(pool: Pool) {
  return {
    async contagem(leiloeiroId: number) {
      const { rows } = await pool.query<{ status: StatusHabilitacao; n: number }>(
        'SELECT status, count(*)::int AS n FROM habilitacoes WHERE leiloeiro_id = $1 GROUP BY status',
        [leiloeiroId],
      );
      return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<StatusHabilitacao, number>>;
    },

    async fila(leiloeiroId: number, status: StatusHabilitacao | 'todos', busca: string): Promise<ItemFila[]> {
      const q = busca.trim().slice(0, 80);
      const { rows } = await pool.query<ItemFila>(
        `SELECT h.id::int AS id, a.nome, right(a.cpf, 4) AS cpf_final, a.cnpj IS NOT NULL AS cnpj,
                a.cidade, a.uf, h.status, h.consentido_em
           FROM habilitacoes h JOIN arrematantes a ON a.id = h.arrematante_id
          WHERE h.leiloeiro_id = $1
            AND ($2 = 'todos' OR h.status = $2)
            AND ($3 = '' OR a.nome ILIKE '%' || $3 || '%' OR a.email ILIKE '%' || $3 || '%'
                 OR (length(regexp_replace($3, '\\D', '', 'g')) >= 3 AND a.cpf LIKE '%' || regexp_replace($3, '\\D', '', 'g') || '%'))
          ORDER BY (h.status = 'pendente') DESC, h.consentido_em DESC
          LIMIT 200`,
        [leiloeiroId, status, q],
      );
      return rows;
    },

    async ficha(leiloeiroId: number, habilitacaoId: number): Promise<Ficha | null> {
      const { rows } = await pool.query(
        `SELECT h.id::int AS id, h.status, h.termo_versao, h.consentido_em, h.decidido_em, h.motivo,
                o.email::text AS decidido_por, a.id::int AS arrematante_id,
                a.nome, a.email::text AS email, a.cpf, a.cnpj, a.rg_ie, a.celular, a.endereco, a.cidade, a.uf, a.email_verificado_em,
                to_char(a.data_nascimento, 'DD/MM/YYYY') AS data_nascimento, a.estado_civil, a.profissao, a.razao_social
           FROM habilitacoes h JOIN arrematantes a ON a.id = h.arrematante_id
           LEFT JOIN operadores o ON o.id = h.decidido_por
          WHERE h.leiloeiro_id = $1 AND h.id = $2`,
        [leiloeiroId, habilitacaoId],
      );
      const r = rows[0];
      if (!r) return null;
      const docs = await pool.query(
        `SELECT DISTINCT ON (tipo) tipo, mime, tamanho_bytes FROM documentos
          WHERE arrematante_id = $1 ORDER BY tipo, criado_em DESC`,
        [r.arrematante_id],
      );
      const hist = await pool.query(
        `SELECT au.em, au.acao, o.email::text AS quem FROM auditoria au
           LEFT JOIN operadores o ON au.ator_tipo = 'operador' AND o.id = au.ator_id
          WHERE au.leiloeiro_id = $1 AND (au.alvo = $2 OR (au.ator_tipo = 'arrematante' AND au.ator_id = $3))
          ORDER BY au.em DESC LIMIT 30`,
        [leiloeiroId, `habilitacao:${habilitacaoId}`, r.arrematante_id],
      );
      return {
        id: r.id, status: r.status, termo_versao: r.termo_versao, consentido_em: r.consentido_em,
        decidido_em: r.decidido_em, decidido_por: r.decidido_por, motivo: r.motivo,
        arrematante: {
          nome: r.nome, email: r.email, cpf: r.cpf, cnpj: r.cnpj, rg_ie: r.rg_ie, celular: r.celular,
          endereco: r.endereco, cidade: r.cidade, uf: r.uf, email_verificado_em: r.email_verificado_em,
          data_nascimento: r.data_nascimento,
          estado_civil: r.estado_civil ? ESTADOS_CIVIS[r.estado_civil as EstadoCivil] : null,
          profissao: r.profissao, razao_social: r.razao_social,
        },
        documentos: docs.rows,
        historico: hist.rows,
      };
    },

    async documento(leiloeiroId: number, habilitacaoId: number, tipo: TipoDocumento) {
      const { rows } = await pool.query<{ r2_key: string; mime: string }>(
        `SELECT d.r2_key, d.mime FROM documentos d
           JOIN habilitacoes h ON h.arrematante_id = d.arrematante_id
          WHERE h.leiloeiro_id = $1 AND h.id = $2 AND d.tipo = $3
          ORDER BY d.criado_em DESC LIMIT 1`,
        [leiloeiroId, habilitacaoId, tipo],
      );
      return rows[0] ?? null;
    },

    /** Muda o status respeitando as transições permitidas. Retorna o chat do arrematante para avisá-lo. */
    async decidir(leiloeiroId: number, habilitacaoId: number, operadorId: number, decisao: Decisao, motivo: string | null) {
      const { rows } = await pool.query<{ chat: string; leiloeiro: string }>(
        `UPDATE habilitacoes h SET status = $4, decidido_por = $3, decidido_em = now(), motivo = $5
           FROM arrematantes a, leiloeiros l
          WHERE h.id = $2 AND h.leiloeiro_id = $1 AND a.id = h.arrematante_id AND l.id = h.leiloeiro_id
            AND h.status = ANY($6::text[])
          RETURNING a.telegram_chat_id::text AS chat, l.nome AS leiloeiro`,
        [leiloeiroId, habilitacaoId, operadorId, decisao, motivo, TRANSICOES[decisao]],
      );
      if (!rows[0]) return null;
      await pool.query(
        `INSERT INTO auditoria (ator_tipo, ator_id, leiloeiro_id, acao, alvo, detalhes)
         VALUES ('operador', $1, $2, $3, $4, $5)`,
        [operadorId, leiloeiroId, `habilitacao.${decisao}`, `habilitacao:${habilitacaoId}`, JSON.stringify({ motivo })],
      );
      return { chatId: Number(rows[0].chat), leiloeiro: rows[0].leiloeiro };
    },
  };
}

export type PainelRepo = ReturnType<typeof createPainelRepo>;
