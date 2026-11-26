import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Pool } from 'pg';

const scrypt = promisify(scryptCb) as (s: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSAO_HORAS = 8;
export const MAX_FALHAS = 5;
export const BLOQUEIO_MIN = 15;

/** Hash de senha com scrypt (nativo do Node). Formato: scrypt$N$r$p$salt$hash */
export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(senha, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = armazenado.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const calc = await scrypt(senha, Buffer.from(salt, 'base64'), esperado.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem,
  });
  return calc.length === esperado.length && timingSafeEqual(calc, esperado);
}

/** Política mínima de senha do painel (acesso a CPF e documentos). */
export function senhaForte(senha: string): boolean {
  return senha.length >= 12 && /[a-z]/i.test(senha) && /\d/.test(senha);
}

const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

export interface Operador {
  id: number;
  leiloeiro_id: number;
  leiloeiro_nome: string;
  leiloeiro_slug: string;
  email: string;
  papel: 'dono' | 'operador';
  nome: string | null;
}

export type ResultadoLogin =
  | { ok: true; token: string; operador: Operador }
  | { ok: false; motivo: 'invalido' | 'bloqueado' };

const SELECT_OPERADOR = `
  SELECT o.id::int AS id, o.leiloeiro_id::int AS leiloeiro_id, l.nome AS leiloeiro_nome, l.slug AS leiloeiro_slug,
         o.email::text AS email, o.papel, o.nome
    FROM operadores o JOIN leiloeiros l ON l.id = o.leiloeiro_id`;

export function createAuthPainel(pool: Pool) {
  // Hash fictício para gastar o mesmo tempo quando o e-mail não existe (evita descobrir e-mails pelo tempo de resposta)
  const hashFicticio = hashSenha(randomBytes(16).toString('hex'));

  async function auditar(operadorId: number | null, leiloeiroId: number | null, acao: string, detalhes?: object) {
    await pool.query(
      `INSERT INTO auditoria (ator_tipo, ator_id, leiloeiro_id, acao, detalhes) VALUES ('operador', $1, $2, $3, $4)`,
      [operadorId, leiloeiroId, acao, detalhes ? JSON.stringify(detalhes) : null],
    );
  }

  return {
    auditar,

    async login(email: string, senha: string, ip?: string): Promise<ResultadoLogin> {
      const { rows } = await pool.query<{
        id: number; leiloeiro_id: number; senha_hash: string; tentativas_falhas: number; bloqueado: boolean; ativo: boolean;
      }>(
        `SELECT o.id::int AS id, o.leiloeiro_id::int AS leiloeiro_id, o.senha_hash, o.tentativas_falhas,
                coalesce(o.bloqueado_ate > now(), false) AS bloqueado, (o.ativo AND l.ativo) AS ativo
           FROM operadores o JOIN leiloeiros l ON l.id = o.leiloeiro_id
          WHERE o.email = $1`,
        [email.trim().toLowerCase()],
      );
      const op = rows[0];
      if (!op || !op.ativo) {
        await conferirSenha(senha, await hashFicticio);
        return { ok: false, motivo: 'invalido' };
      }
      if (op.bloqueado) return { ok: false, motivo: 'bloqueado' };

      if (!(await conferirSenha(senha, op.senha_hash))) {
        const falhas = op.tentativas_falhas + 1;
        const bloquear = falhas >= MAX_FALHAS;
        await pool.query(
          `UPDATE operadores SET tentativas_falhas = $2,
             bloqueado_ate = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE bloqueado_ate END
           WHERE id = $1`,
          [op.id, bloquear ? 0 : falhas, bloquear, BLOQUEIO_MIN],
        );
        await auditar(op.id, op.leiloeiro_id, 'painel.login_falhou', { ip, bloqueou: falhas >= MAX_FALHAS });
        return { ok: false, motivo: falhas >= MAX_FALHAS ? 'bloqueado' : 'invalido' };
      }

      await pool.query('UPDATE operadores SET tentativas_falhas = 0, bloqueado_ate = NULL WHERE id = $1', [op.id]);
      const token = randomBytes(32).toString('base64url');
      await pool.query(
        `INSERT INTO sessoes_painel (token_hash, operador_id, expira_em) VALUES ($1, $2, now() + make_interval(hours => $3))`,
        [sha256(token), op.id, SESSAO_HORAS],
      );
      await auditar(op.id, op.leiloeiro_id, 'painel.login', { ip });
      const { rows: me } = await pool.query<Operador>(`${SELECT_OPERADOR} WHERE o.id = $1`, [op.id]);
      return { ok: true, token, operador: me[0]! };
    },

    async operadorDaSessao(token: string | undefined): Promise<Operador | null> {
      if (!token || token.length > 100) return null;
      const { rows } = await pool.query<Operador>(
        `${SELECT_OPERADOR} JOIN sessoes_painel s ON s.operador_id = o.id
          WHERE s.token_hash = $1 AND s.expira_em > now() AND o.ativo AND l.ativo`,
        [sha256(token)],
      );
      return rows[0] ?? null;
    },

    async logout(token: string | undefined) {
      if (token) await pool.query('DELETE FROM sessoes_painel WHERE token_hash = $1', [sha256(token)]);
    },

    async criarOperador(leiloeiroSlug: string, email: string, senha: string, papel: 'dono' | 'operador' = 'dono') {
      if (!senhaForte(senha)) throw new Error('Senha fraca: mínimo 12 caracteres, com letras e números');
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO operadores (leiloeiro_id, email, senha_hash, papel)
         SELECT id, $2, $3, $4 FROM leiloeiros WHERE slug = $1
         ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, tentativas_falhas = 0, bloqueado_ate = NULL, ativo = true
         RETURNING id::int AS id`,
        [leiloeiroSlug, email.trim().toLowerCase(), await hashSenha(senha), papel],
      );
      if (!rows[0]) throw new Error(`Leiloeiro "${leiloeiroSlug}" não encontrado`);
      return rows[0].id;
    },
  };
}

export type AuthPainel = ReturnType<typeof createAuthPainel>;
