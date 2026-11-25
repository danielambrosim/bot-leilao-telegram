import type { Pool } from 'pg';
import { limparSessoesExpiradas } from '../bot/sessionStorage';
import type { PublicacaoRepo } from '../publicacoes/repo';
import { coletarImprensaLeiloes } from '../scraper/imprensaLeiloes';

export interface ResultadoManutencao {
  sessoesRemovidas: number;
  codigosRemovidos: number;
  coleta?: { inseridas: number; erros: number } | { falhou: string };
}

/**
 * Tarefas periódicas. Em VPS rodam por timer; em hosts que "dormem" (Render grátis)
 * são disparadas por agendador externo via POST /tarefas/manutencao.
 */
export async function executarManutencao(
  pool: Pool,
  publicacoes: PublicacaoRepo,
  opcoes: { coletar: boolean },
): Promise<ResultadoManutencao> {
  const sessoesRemovidas = await limparSessoesExpiradas(pool);
  const r = await pool.query(`DELETE FROM codigos_email WHERE expira_em < now() - interval '1 hour'`);
  const resultado: ResultadoManutencao = { sessoesRemovidas, codigosRemovidos: r.rowCount ?? 0 };
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
