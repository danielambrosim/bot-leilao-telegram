import type { Pool, PoolClient } from 'pg';

export type TipoDocumento = 'identidade' | 'comprovante_residencia';
export type StatusHabilitacao = 'pendente' | 'aprovado' | 'recusado' | 'revogado';

export interface Arrematante {
  id: number;
  telegram_chat_id: number;
  nome: string;
  email: string;
  cpf: string;
  cnpj: string | null;
  endereco: string;
}

export interface NovoArrematante {
  telegramChatId: number;
  nome: string;
  email: string;
  cpf: string;
  cnpj?: string;
  rgIe: string;
  celular: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  /** Endereço completo em uma linha (exibição) */
  endereco: string;
}

export interface NovoDocumento {
  tipo: TipoDocumento;
  chave: string;
  sha256: string;
  mime: string;
  tamanhoBytes: number;
}

export interface HabilitacaoResumo {
  leiloeiro: string;
  status: StatusHabilitacao;
  consentido_em: Date;
  motivo: string | null;
}

export type ResultadoHabilitacao = { criada: true } | { criada: false; status: StatusHabilitacao };

export class ConflitoCadastroError extends Error {
  constructor(public campo: 'email' | 'cpf' | 'chat') {
    super(`Conflito de cadastro: ${campo}`);
  }
}

export const RETENCAO_DOCUMENTOS_DIAS = 180;

export interface ArrematanteRepo {
  buscarPorChat(chatId: number): Promise<Arrematante | null>;
  emailOuCpfEmUso(email: string, cpf: string | null, excetoChatId: number): Promise<'email' | 'cpf' | null>;
  /** Cria arrematante + documentos + habilitação em uma única transação. */
  criarComHabilitacao(
    dados: NovoArrematante,
    documentos: NovoDocumento[],
    leiloeiroId: number,
    termoVersao: number,
  ): Promise<number>;
  habilitar(arrematanteId: number, leiloeiroId: number, termoVersao: number): Promise<ResultadoHabilitacao>;
  statusHabilitacao(arrematanteId: number, leiloeiroId: number): Promise<StatusHabilitacao | null>;
  listarHabilitacoes(arrematanteId: number): Promise<HabilitacaoResumo[]>;
  /** Exclusão a pedido do titular (LGPD art. 18). Retorna as chaves dos documentos para apagar do storage. */
  excluir(arrematanteId: number): Promise<string[]>;
}

async function auditar(c: PoolClient | Pool, acao: string, atorId: number, leiloeiroId: number | null, alvo?: string) {
  await c.query(
    `INSERT INTO auditoria (ator_tipo, ator_id, leiloeiro_id, acao, alvo) VALUES ('arrematante', $1, $2, $3, $4)`,
    [atorId, leiloeiroId, acao, alvo ?? null],
  );
}

export function createArrematanteRepo(pool: Pool): ArrematanteRepo {
  return {
    async buscarPorChat(chatId) {
      const { rows } = await pool.query<Arrematante>(
        `SELECT id::int AS id, telegram_chat_id::float8 AS telegram_chat_id, nome, email, cpf, cnpj, endereco
           FROM arrematantes WHERE telegram_chat_id = $1`,
        [chatId],
      );
      return rows[0] ?? null;
    },

    async emailOuCpfEmUso(email, cpf, excetoChatId) {
      const { rows } = await pool.query<{ email_uso: boolean; cpf_uso: boolean }>(
        `SELECT bool_or(email = $1) AS email_uso, bool_or(cpf = $2) AS cpf_uso
           FROM arrematantes WHERE telegram_chat_id <> $3 AND (email = $1 OR cpf = $2)`,
        [email, cpf, excetoChatId],
      );
      if (rows[0]?.email_uso) return 'email';
      if (rows[0]?.cpf_uso) return 'cpf';
      return null;
    },

    async criarComHabilitacao(dados, documentos, leiloeiroId, termoVersao) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO arrematantes (telegram_chat_id, nome, email, email_verificado_em, cpf, cnpj, endereco,
                                     rg_ie, celular, cep, logradouro, numero, complemento, bairro, cidade, uf)
           VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id::int AS id`,
          [
            dados.telegramChatId, dados.nome, dados.email, dados.cpf, dados.cnpj ?? null, dados.endereco,
            dados.rgIe, dados.celular, dados.cep, dados.logradouro, dados.numero, dados.complemento ?? null,
            dados.bairro, dados.cidade, dados.uf,
          ],
        );
        const id = rows[0]!.id;
        for (const d of documentos) {
          await client.query(
            `INSERT INTO documentos (arrematante_id, tipo, r2_key, sha256, mime, tamanho_bytes, expira_em)
             VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))`,
            [id, d.tipo, d.chave, d.sha256, d.mime, d.tamanhoBytes, RETENCAO_DOCUMENTOS_DIAS],
          );
        }
        await client.query(
          `INSERT INTO habilitacoes (arrematante_id, leiloeiro_id, termo_versao) VALUES ($1, $2, $3)`,
          [id, leiloeiroId, termoVersao],
        );
        await auditar(client, 'arrematante.criado', id, leiloeiroId);
        await auditar(client, 'habilitacao.solicitada', id, leiloeiroId);
        await client.query('COMMIT');
        return id;
      } catch (err) {
        await client.query('ROLLBACK');
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23505') {
          throw new ConflitoCadastroError(
            e.constraint?.includes('email') ? 'email' : e.constraint?.includes('cpf') ? 'cpf' : 'chat',
          );
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async habilitar(arrematanteId, leiloeiroId, termoVersao) {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO habilitacoes (arrematante_id, leiloeiro_id, termo_versao) VALUES ($1, $2, $3)
         ON CONFLICT (arrematante_id, leiloeiro_id) DO NOTHING RETURNING id`,
        [arrematanteId, leiloeiroId, termoVersao],
      );
      if (rows.length) {
        await auditar(pool, 'habilitacao.solicitada', arrematanteId, leiloeiroId);
        return { criada: true };
      }
      const atual = await pool.query<{ status: StatusHabilitacao }>(
        'SELECT status FROM habilitacoes WHERE arrematante_id = $1 AND leiloeiro_id = $2',
        [arrematanteId, leiloeiroId],
      );
      return { criada: false, status: atual.rows[0]!.status };
    },

    async statusHabilitacao(arrematanteId, leiloeiroId) {
      const { rows } = await pool.query<{ status: StatusHabilitacao }>(
        'SELECT status FROM habilitacoes WHERE arrematante_id = $1 AND leiloeiro_id = $2',
        [arrematanteId, leiloeiroId],
      );
      return rows[0]?.status ?? null;
    },

    async listarHabilitacoes(arrematanteId) {
      const { rows } = await pool.query<HabilitacaoResumo>(
        `SELECT l.nome AS leiloeiro, h.status, h.consentido_em, h.motivo
           FROM habilitacoes h JOIN leiloeiros l ON l.id = h.leiloeiro_id
          WHERE h.arrematante_id = $1 ORDER BY h.consentido_em DESC`,
        [arrematanteId],
      );
      return rows;
    },

    async excluir(arrematanteId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const docs = await client.query<{ r2_key: string }>('SELECT r2_key FROM documentos WHERE arrematante_id = $1', [
          arrematanteId,
        ]);
        await client.query('DELETE FROM arrematantes WHERE id = $1', [arrematanteId]);
        await auditar(client, 'arrematante.excluido_pelo_titular', arrematanteId, null);
        await client.query('COMMIT');
        return docs.rows.map((d) => d.r2_key);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
