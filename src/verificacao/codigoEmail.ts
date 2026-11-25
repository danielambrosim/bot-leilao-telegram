import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

export const LIMITES = {
  validadeMin: 10,
  maxTentativas: 5,
  maxEnviosPorHora: 3,
} as const;

export type ResultadoEmissao = { ok: true; codigo: string } | { ok: false; motivo: 'limite_envios' };
export type ResultadoVerificacao =
  | { ok: true; email: string }
  | { ok: false; motivo: 'expirado' | 'bloqueado' }
  | { ok: false; motivo: 'invalido'; restantes: number };

export interface CodigoEmailService {
  emitir(chatId: number, email: string): Promise<ResultadoEmissao>;
  verificar(chatId: number, codigo: string): Promise<ResultadoVerificacao>;
}

/** Códigos de 6 dígitos: CSPRNG, HMAC no banco, expiração, limite de tentativas e de reenvios. */
export function createCodigoEmailService(pool: Pool, segredo: string): CodigoEmailService {
  const hash = (chatId: number, codigo: string) =>
    createHmac('sha256', segredo).update(`${chatId}:${codigo}`).digest('hex');

  return {
    async emitir(chatId, email) {
      const { rows } = await pool.query<{ envios: number; recente: boolean }>(
        `SELECT envios, criado_em > now() - interval '1 hour' AS recente
           FROM codigos_email WHERE telegram_chat_id = $1`,
        [chatId],
      );
      const atual = rows[0];
      if (atual?.recente && atual.envios >= LIMITES.maxEnviosPorHora) return { ok: false, motivo: 'limite_envios' };

      const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
      await pool.query(
        `INSERT INTO codigos_email (telegram_chat_id, email, codigo_hash, expira_em)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))
         ON CONFLICT (telegram_chat_id) DO UPDATE SET
           email = EXCLUDED.email,
           codigo_hash = EXCLUDED.codigo_hash,
           expira_em = EXCLUDED.expira_em,
           tentativas = 0,
           envios = CASE WHEN codigos_email.criado_em > now() - interval '1 hour'
                         THEN codigos_email.envios + 1 ELSE 1 END,
           criado_em = CASE WHEN codigos_email.criado_em > now() - interval '1 hour'
                            THEN codigos_email.criado_em ELSE now() END`,
        [chatId, email, hash(chatId, codigo), LIMITES.validadeMin],
      );
      return { ok: true, codigo };
    },

    async verificar(chatId, codigo) {
      const { rows } = await pool.query<{ email: string; codigo_hash: string; tentativas: number; expirado: boolean }>(
        `SELECT email, codigo_hash, tentativas, expira_em < now() AS expirado
           FROM codigos_email WHERE telegram_chat_id = $1`,
        [chatId],
      );
      const reg = rows[0];
      if (!reg || reg.expirado) return { ok: false, motivo: 'expirado' };
      if (reg.tentativas >= LIMITES.maxTentativas) return { ok: false, motivo: 'bloqueado' };

      const esperado = Buffer.from(reg.codigo_hash, 'hex');
      const recebido = Buffer.from(hash(chatId, codigo.trim()), 'hex');
      if (!timingSafeEqual(esperado, recebido)) {
        const tentativas = reg.tentativas + 1;
        await pool.query('UPDATE codigos_email SET tentativas = $2 WHERE telegram_chat_id = $1', [chatId, tentativas]);
        if (tentativas >= LIMITES.maxTentativas) return { ok: false, motivo: 'bloqueado' };
        return { ok: false, motivo: 'invalido', restantes: LIMITES.maxTentativas - tentativas };
      }
      await pool.query('DELETE FROM codigos_email WHERE telegram_chat_id = $1', [chatId]);
      return { ok: true, email: reg.email };
    },
  };
}
