import { config } from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createPool } from '../db/pool';
import { buscarHabilitados, gerarCsv } from '../exportacao/habilitados';

// Uso: npm run exportar:habilitados -- <slug-leiloeiro> [aprovado|pendente|recusado|todos]
// Gera exports/<slug>-<status>-<data>.csv (pasta fora do git). Cada exportação fica na auditoria.
(async () => {
  config({ quiet: true });
  const [slug, statusArg = 'aprovado'] = process.argv.slice(2);
  if (!slug) throw new Error('Informe o slug do leiloeiro. Ex.: npm run exportar:habilitados -- colodete aprovado');
  if (!['aprovado', 'pendente', 'recusado', 'revogado', 'todos'].includes(statusArg)) throw new Error(`Status inválido: ${statusArg}`);
  const status = statusArg as 'aprovado';

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  const pool = createPool(url);
  try {
    const { leiloeiroId, linhas } = await buscarHabilitados(pool, slug, status);
    const dir = path.resolve(process.env.EXPORTS_DIR ?? 'exports');
    await mkdir(dir, { recursive: true });
    const arquivo = path.join(dir, `${slug}-${status}-${new Date().toISOString().slice(0, 10)}.csv`);
    await writeFile(arquivo, gerarCsv(linhas), { encoding: 'utf8', mode: 0o600 });
    await pool.query(
      `INSERT INTO auditoria (ator_tipo, leiloeiro_id, acao, detalhes) VALUES ('sistema', $1, 'exportacao.habilitados', $2)`,
      [leiloeiroId, JSON.stringify({ status, quantidade: linhas.length, via: 'cli' })],
    );
    console.log(`${linhas.length} registro(s) exportado(s) para ${arquivo}`);
    console.log('Atenção: arquivo contém dados pessoais. Envie por canal seguro e apague após importar.');
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
