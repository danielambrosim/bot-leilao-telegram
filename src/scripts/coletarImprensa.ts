import { config } from 'dotenv';
import { createPool } from '../db/pool';
import { createPublicacaoRepo } from '../publicacoes/repo';
import { coletarImprensaLeiloes } from '../scraper/imprensaLeiloes';

// Uso: npm run coletar:imprensa
(async () => {
  config({ quiet: true });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  const pool = createPool(url);
  try {
    const r = await coletarImprensaLeiloes(createPublicacaoRepo(pool));
    console.log(`Notícias na home: ${r.encontradas} · novas gravadas: ${r.inseridas} · erros: ${r.erros.length}`);
    r.erros.forEach((e) => console.warn(' -', e));
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
