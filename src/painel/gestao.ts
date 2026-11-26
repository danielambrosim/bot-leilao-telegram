import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { hashSenha } from './auth';

/**
 * Consultas e alterações das telas de Visão geral, Auditoria, Editais e Configuração.
 * Todas recebem o leiloeiro_id do operador logado: nada cruza de um leiloeiro para outro.
 */

const ACOES_RUIDO = ['painel.login', 'painel.login_falhou', 'painel.ficha_visualizada', 'painel.documento_aberto'];

const SQL_ATIVIDADE = `
  SELECT au.em, au.acao, au.detalhes, coalesce(o.nome, o.email::text) AS operador,
         coalesce(a1.nome, a2.nome) AS arrematante
    FROM auditoria au
    LEFT JOIN operadores o ON au.ator_tipo = 'operador' AND o.id = au.ator_id
    LEFT JOIN arrematantes a1 ON au.ator_tipo = 'arrematante' AND a1.id = au.ator_id
    LEFT JOIN habilitacoes h ON au.alvo = 'habilitacao:' || h.id
    LEFT JOIN arrematantes a2 ON a2.id = h.arrematante_id
   WHERE au.leiloeiro_id = $1`;

export interface DadosLeiloeiro {
  nome: string;
  slug: string;
  site_url: string | null;
  email_contato: string | null;
  matricula: string | null;
  dpo_nome: string | null;
  dpo_email: string | null;
  retencao_dias: number;
  termo_texto: string;
  termo_versao: number;
}

export class ValidacaoError extends Error {}

const emailValido = (v: string) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
function texto(v: unknown, campo: string, min: number, max: number, opcional = false): string | null {
  if (v === undefined || v === null || v === '') {
    if (opcional) return null;
    throw new ValidacaoError(`${campo} é obrigatório`);
  }
  if (typeof v !== 'string') throw new ValidacaoError(`${campo} inválido`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < min || t.length > max || /[<>]/.test(t)) throw new ValidacaoError(`${campo} deve ter entre ${min} e ${max} caracteres`);
  return t;
}
function email(v: unknown, campo: string, opcional = true): string | null {
  const t = texto(v, campo, 5, 254, opcional);
  if (t && !emailValido(t)) throw new ValidacaoError(`${campo} inválido`);
  return t?.toLowerCase() ?? null;
}

export function createGestaoRepo(pool: Pool) {
  return {
    async resumo(leiloeiroId: number) {
      const { rows: [k] } = await pool.query(
        `SELECT
           count(*) FILTER (WHERE status = 'pendente')::int AS pendentes,
           count(*) FILTER (WHERE status = 'pendente' AND consentido_em < now() - interval '24 hours')::int AS atrasados,
           count(*) FILTER (WHERE status = 'aprovado' AND decidido_em > now() - interval '30 days')::int AS aprovados30,
           count(*) FILTER (WHERE status = 'recusado' AND decidido_em > now() - interval '30 days')::int AS recusados30,
           round(extract(epoch FROM avg(decidido_em - consentido_em)
                 FILTER (WHERE decidido_em > now() - interval '30 days' AND status IN ('aprovado','recusado'))) / 60)::int AS tempo_medio_min
           FROM habilitacoes WHERE leiloeiro_id = $1`,
        [leiloeiroId],
      );
      const { rows: fila } = await pool.query(
        `SELECT h.id::int AS id, a.nome, a.cnpj IS NOT NULL AS pj, a.cidade, a.uf, h.consentido_em
           FROM habilitacoes h JOIN arrematantes a ON a.id = h.arrematante_id
          WHERE h.leiloeiro_id = $1 AND h.status = 'pendente'
          ORDER BY h.consentido_em ASC LIMIT 6`,
        [leiloeiroId],
      );
      const { rows: atividade } = await pool.query(
        `${SQL_ATIVIDADE} AND au.acao <> ALL($2::text[]) ORDER BY au.em DESC LIMIT 8`,
        [leiloeiroId, ACOES_RUIDO],
      );
      const { rows: [exp] } = await pool.query(
        `SELECT au.em, au.acao, au.detalhes, coalesce(o.nome, o.email::text) AS operador
           FROM auditoria au LEFT JOIN operadores o ON o.id = au.ator_id AND au.ator_tipo = 'operador'
          WHERE au.leiloeiro_id = $1 AND au.acao LIKE 'exportacao.%' ORDER BY au.em DESC LIMIT 1`,
        [leiloeiroId],
      );
      const decididos = k.aprovados30 + k.recusados30;
      return {
        indicadores: {
          pendentes: k.pendentes,
          atrasados: k.atrasados,
          aprovados30: k.aprovados30,
          tempoMedioMin: k.tempo_medio_min,
          taxaRecusa: decididos ? Math.round((k.recusados30 / decididos) * 100) : null,
        },
        fila,
        atividade,
        ultimaExportacao: exp ?? null,
        publicacoes: await this.publicacoes(4),
      };
    },

    async auditoria(leiloeiroId: number, limite = 200) {
      const { rows } = await pool.query(`${SQL_ATIVIDADE} ORDER BY au.em DESC LIMIT $2`, [leiloeiroId, Math.min(limite, 500)]);
      return rows;
    },

    async exportacoes(leiloeiroId: number) {
      const { rows } = await pool.query(
        `SELECT au.em, au.acao, au.detalhes, coalesce(o.nome, o.email::text) AS operador
           FROM auditoria au LEFT JOIN operadores o ON o.id = au.ator_id AND au.ator_tipo = 'operador'
          WHERE au.leiloeiro_id = $1 AND au.acao LIKE 'exportacao.%' ORDER BY au.em DESC LIMIT 50`,
        [leiloeiroId],
      );
      return rows;
    },

    async publicacoes(limite = 30) {
      const { rows } = await pool.query(
        `SELECT tipo, titulo, resumo, url, publicado_em, coletado_em FROM publicacoes
          WHERE fonte = 'imprensa-leiloes'
          ORDER BY (tipo = 'edicao') DESC, coalesce(publicado_em, coletado_em) DESC LIMIT $1`,
        [limite],
      );
      return rows;
    },

    async leiloeiro(leiloeiroId: number): Promise<DadosLeiloeiro> {
      const { rows } = await pool.query<DadosLeiloeiro>(
        `SELECT nome, slug, site_url, email_contato::text, matricula, dpo_nome, dpo_email::text, retencao_dias,
                termo_texto, termo_versao FROM leiloeiros WHERE id = $1`,
        [leiloeiroId],
      );
      return rows[0]!;
    },

    async salvarDados(leiloeiroId: number, operadorId: number, body: Record<string, unknown>) {
      const nome = texto(body.nome, 'Nome', 2, 80)!;
      const site = texto(body.site_url, 'Site', 8, 200, true);
      if (site && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(site)) throw new ValidacaoError('Site deve começar com https://');
      await pool.query(
        `UPDATE leiloeiros SET nome = $2, site_url = $3, email_contato = $4, matricula = $5 WHERE id = $1`,
        [leiloeiroId, nome, site, email(body.email_contato, 'E-mail de contato'), texto(body.matricula, 'Matrícula', 1, 60, true)],
      );
      await auditar(pool, operadorId, leiloeiroId, 'config.dados_alterados');
    },

    async salvarPrivacidade(leiloeiroId: number, operadorId: number, body: Record<string, unknown>) {
      await pool.query(`UPDATE leiloeiros SET dpo_nome = $2, dpo_email = $3 WHERE id = $1`, [
        leiloeiroId, texto(body.dpo_nome, 'Nome do encarregado', 2, 120, true), email(body.dpo_email, 'E-mail do encarregado'),
      ]);
      await auditar(pool, operadorId, leiloeiroId, 'config.privacidade_alterada');
    },

    async versoesTermo(leiloeiroId: number) {
      const { rows } = await pool.query(
        `SELECT tv.versao, tv.texto, tv.publicado_em, coalesce(o.nome, o.email::text) AS publicado_por,
                (SELECT count(*)::int FROM habilitacoes h WHERE h.leiloeiro_id = tv.leiloeiro_id AND h.termo_versao = tv.versao) AS aceites
           FROM termos_versoes tv LEFT JOIN operadores o ON o.id = tv.publicado_por
          WHERE tv.leiloeiro_id = $1 ORDER BY tv.versao DESC`,
        [leiloeiroId],
      );
      return rows;
    },

    /** Publica nova versão do termo: a anterior continua guardada com quem a aceitou. */
    async publicarTermo(leiloeiroId: number, operadorId: number, novo: unknown) {
      const t = typeof novo === 'string' ? novo.trim() : '';
      if (t.length < 50 || t.length > 5000) throw new ValidacaoError('O termo deve ter entre 50 e 5000 caracteres');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ versao: number }>(
          `UPDATE leiloeiros SET termo_texto = $2, termo_versao = termo_versao + 1 WHERE id = $1 RETURNING termo_versao AS versao`,
          [leiloeiroId, t],
        );
        const versao = rows[0]!.versao;
        await client.query(
          `INSERT INTO termos_versoes (leiloeiro_id, versao, texto, publicado_por) VALUES ($1, $2, $3, $4)`,
          [leiloeiroId, versao, t, operadorId],
        );
        await auditar(client, operadorId, leiloeiroId, 'config.termo_publicado', { versao });
        await client.query('COMMIT');
        return versao;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    async equipe(leiloeiroId: number) {
      const { rows } = await pool.query(
        `SELECT o.id::int AS id, o.nome, o.email::text AS email, o.papel, o.ativo,
                coalesce(o.bloqueado_ate > now(), false) AS bloqueado,
                (SELECT max(em) FROM auditoria au WHERE au.ator_tipo = 'operador' AND au.ator_id = o.id AND au.acao = 'painel.login') AS ultimo_acesso
           FROM operadores o WHERE o.leiloeiro_id = $1 ORDER BY o.ativo DESC, o.papel, o.email`,
        [leiloeiroId],
      );
      return rows;
    },

    /** Convida pessoa: cria login com senha temporária (mostrada uma única vez para quem convidou). */
    async convidar(leiloeiroId: number, operadorId: number, body: Record<string, unknown>) {
      const nome = texto(body.nome, 'Nome', 2, 120)!;
      const e = email(body.email, 'E-mail', false)!;
      const papel = body.papel === 'dono' ? 'dono' : 'operador';
      const senha = `${randomBytes(9).toString('base64url')}-${(randomBytes(2).readUInt16BE(0) % 900) + 100}`;
      const { rows } = await pool.query(
        `INSERT INTO operadores (leiloeiro_id, nome, email, senha_hash, papel) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING RETURNING id::int AS id`,
        [leiloeiroId, nome, e, await hashSenha(senha), papel],
      );
      if (!rows[0]) throw new ValidacaoError('Este e-mail já tem acesso a um painel');
      await auditar(pool, operadorId, leiloeiroId, 'equipe.convidado', { email: e, papel });
      return { id: rows[0].id, senha };
    },

    async alterarMembro(leiloeiroId: number, operadorId: number, alvoId: number, body: Record<string, unknown>) {
      if (alvoId === operadorId) throw new ValidacaoError('Você não pode alterar o próprio acesso');
      const papel = body.papel === 'dono' || body.papel === 'operador' ? body.papel : null;
      const ativo = typeof body.ativo === 'boolean' ? body.ativo : null;
      const redefinir = body.redefinirSenha === true;
      const senha = redefinir ? `${randomBytes(9).toString('base64url')}-${(randomBytes(2).readUInt16BE(0) % 900) + 100}` : null;
      const { rowCount } = await pool.query(
        `UPDATE operadores SET papel = coalesce($3, papel), ativo = coalesce($4, ativo),
                senha_hash = coalesce($5, senha_hash),
                tentativas_falhas = CASE WHEN $5 IS NULL THEN tentativas_falhas ELSE 0 END,
                bloqueado_ate = CASE WHEN $5 IS NULL THEN bloqueado_ate ELSE NULL END
          WHERE id = $2 AND leiloeiro_id = $1`,
        [leiloeiroId, alvoId, papel, ativo, senha ? await hashSenha(senha) : null],
      );
      if (!rowCount) throw new ValidacaoError('Pessoa não encontrada');
      if (ativo === false) await pool.query('DELETE FROM sessoes_painel WHERE operador_id = $1', [alvoId]);
      await auditar(pool, operadorId, leiloeiroId, 'equipe.alterado', { alvo: alvoId, papel, ativo, redefiniuSenha: redefinir });
      return { senha };
    },

    async ultimaColeta() {
      const { rows } = await pool.query(`SELECT max(coletado_em) AS em FROM publicacoes WHERE fonte = 'imprensa-leiloes'`);
      return rows[0]?.em ?? null;
    },
  };
}

async function auditar(c: { query: Pool['query'] }, operadorId: number, leiloeiroId: number, acao: string, detalhes?: object) {
  await c.query(
    `INSERT INTO auditoria (ator_tipo, ator_id, leiloeiro_id, acao, detalhes) VALUES ('operador', $1, $2, $3, $4)`,
    [operadorId, leiloeiroId, acao, detalhes ? JSON.stringify(detalhes) : null],
  );
}

export type GestaoRepo = ReturnType<typeof createGestaoRepo>;
