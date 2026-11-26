import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { createPool } from '../db/pool';
import { migrate } from '../db/migrate';
import { createAuthPainel } from '../painel/auth';

// Uso: npm run operador:criar -- <slug-leiloeiro> <email> [dono|operador]
// Senha: variável SENHA_OPERADOR (mín. 12, letras e números) ou gerada aleatoriamente e exibida UMA vez.
// Rodar de novo com o mesmo e-mail redefine a senha e desbloqueia o acesso.
(async () => {
  config({ quiet: true });
  const [slug, email, papelArg = 'dono'] = process.argv.slice(2);
  if (!slug || !email || !email.includes('@')) {
    throw new Error('Uso: npm run operador:criar -- colodete pessoa@exemplo.com [dono|operador]');
  }
  if (papelArg !== 'dono' && papelArg !== 'operador') throw new Error('Papel deve ser dono ou operador');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');

  const geradaAqui = !process.env.SENHA_OPERADOR;
  const senha = process.env.SENHA_OPERADOR ?? `${randomBytes(9).toString('base64url')}-${randomBytes(3).readUIntBE(0, 3) % 1000}`;
  const pool = createPool(url);
  try {
    await migrate(pool);
    await createAuthPainel(pool).criarOperador(slug, email, senha, papelArg);
    console.log(`Operador ${email} (${papelArg}) pronto para o leiloeiro "${slug}".`);
    if (geradaAqui) {
      console.log(`Senha inicial: ${senha}`);
      console.log('Anote agora em local seguro: ela não será exibida de novo.');
    }
  } finally {
    await pool.end();
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
