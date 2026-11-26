import type { Pool } from 'pg';
import { limparSessoesExpiradas } from '../bot/sessionStorage';
import type { DocStore } from '../docs/store';
import type { PublicacaoRepo } from '../publicacoes/repo';
import { coletarImprensaLeiloes } from '../scraper/imprensaLeiloes';

export interface ResultadoManutencao {
  sessoesRemovidas: number;
  codigosRemovidos: number;
  documentosExpurgados: number;
  coleta?: { inseridas: number; erros: number } | { falhou: string };
}

/**
 * Apaga documentos cujo prazo de guarda venceu (LGPD: não guardar além do necessário).
 * Remove primeiro do storage; o registro só sai do banco se o arquivo saiu (ou já não existia).
 */
export async function expurgarDocumentosVencidos(pool: Pool, docs: DocStore, lote = 200): Promise<number> {
  const { rows } = await pool.query<{ id: number; r2_key: string }>(
    `SELECT id::int AS id, r2_key FROM documentos WHERE expira_em < now() ORDER BY expira_em LIMIT $1`,
    [lote],
  );
  let apagados = 0;
  for (const d of rows) {
    try {
      await docs.apagar(d.r2_key);
      await pool.query('DELETE FROM documentos WHERE id = $1', [d.id]);
      apagados++;
    } catch (e) {
      console.error('[manutencao] falha ao expurgar documento', d.id, (e as Error).message);
    }
  }
  if (apagados) {
    await pool.query(
      `INSERT INTO auditoria (ator_tipo, acao, detalhes) VALUES ('sistema', 'documentos.expurgados', $1)`,
      [JSON.stringify({ quantidade: apagados })],
    );
  }
  return apagados;
}

/**
 * Tarefas periódicas. Em VPS rodam por timer; em hosts que "dormem" (Render grátis)
 * são disparadas por agendador externo via POST /tarefas/manutencao.
 */
export async function executarManutencao(
  pool: Pool,
  publicacoes: PublicacaoRepo,
  opcoes: { coletar: boolean; docs?: DocStore },
): Promise<ResultadoManutencao> {
  const sessoesRemovidas = await limparSessoesExpiradas(pool);
  const r = await pool.query(`DELETE FROM codigos_email WHERE expira_em < now() - interval '1 hour'`);
  const documentosExpurgados = opcoes.docs ? await expurgarDocumentosVencidos(pool, opcoes.docs) : 0;
  const resultado: ResultadoManutencao = { sessoesRemovidas, codigosRemovidos: r.rowCount ?? 0, documentosExpurgados };
  if (opcoes.coletar) {
    try {
      const c = await coletarImprensaLeiloes(publicacoes);
      resultado.coleta = { inseridas: c.inseridas, erros: c.erros.length };
    } catch (e) {
      resultado.coleta = { falhou: (e as Error).message };
    }
  }
  return resultado;
}
