import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { createLeiloeiroRepo } from '../src/leiloeiros/repo';
import { createArrematanteRepo } from '../src/arrematantes/repo';
import { createCodigoEmailService, LIMITES } from '../src/verificacao/codigoEmail';
import { createLocalDocStore } from '../src/docs/store';
import { createPublicacaoRepo } from '../src/publicacoes/repo';
import { createPgSessionStorage } from '../src/bot/sessionStorage';
import { MSG, type SessionData } from '../src/bot/createBot';
import { botao, foto, montarBot, pdf, texto, textosEnviados } from './helpers/botHarness';

// Fluxo completo do bot contra Postgres real. Requer TEST_DATABASE_URL (ver README).
const url = process.env.TEST_DATABASE_URL;
const CHAVE = Buffer.alloc(32, 7).toString('base64');

describe.skipIf(!url)('fluxo de cadastro e habilitação (Postgres real)', () => {
  const pool = createPool(url!);
  let dirDocs: string;
  let ultimoCodigo = '';

  const montar = () => {
    const docs = createLocalDocStore(dirDocs, CHAVE);
    return {
      docs,
      ...montarBot({
        leiloeiros: createLeiloeiroRepo(pool),
        arrematantes: createArrematanteRepo(pool),
        codigos: createCodigoEmailService(pool, 'segredo-de-teste-com-mais-de-32-caracteres'),
        mailer: { enviarCodigo: async (_e, c) => void (ultimoCodigo = c) },
        docs,
        publicacoes: createPublicacaoRepo(pool),
        sessionStorage: createPgSessionStorage<SessionData>(pool),
        baixarArquivo: async (_api, fileId) => Buffer.from(`conteudo-${fileId}`),
      }),
    };
  };

  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE leiloeiros, arrematantes, sessoes_bot, codigos_email, auditoria, publicacoes RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO leiloeiros (slug, nome, termo_texto) VALUES ('colodete','Colodete Leilões','Termo A'), ('outro','Outro Leiloeiro','Termo B')`);
    dirDocs = await mkdtemp(path.join(tmpdir(), 'sbl-docs-'));
  });
  afterAll(async () => {
    await pool.end();
    if (dirDocs) await rm(dirDocs, { recursive: true, force: true });
  });

  async function cadastroCompleto(bot: ReturnType<typeof montar>['bot'], chat = 42) {
    await bot.handleUpdate(texto('/start colodete', chat));
    await bot.handleUpdate(botao('termo:aceito', chat));
    await bot.handleUpdate(texto('Maria da Silva', chat));
    await bot.handleUpdate(texto('Maria@Exemplo.com', chat));
    await bot.handleUpdate(texto(ultimoCodigo, chat));
    await bot.handleUpdate(texto('529.982.247-25', chat));
    await bot.handleUpdate(botao('cnpj:nao', chat));
    await bot.handleUpdate(texto('Rua das Flores, 100, Centro, Vitória/ES, 29000-000', chat));
    await bot.handleUpdate(foto(chat));
    await bot.handleUpdate(pdf(chat));
    await bot.handleUpdate(botao('confirmar:sim', chat));
  }

  it('CAD-01: cadastro completo grava arrematante, documentos criptografados e habilitação pendente', async () => {
    const { bot, chamadas, docs } = montar();
    await cadastroCompleto(bot);

    expect(textosEnviados(chamadas).at(-1)).toContain('Cadastro concluído e enviado para Colodete Leilões');
    const { rows: [a] } = await pool.query('SELECT * FROM arrematantes');
    expect(a).toMatchObject({ nome: 'Maria da Silva', email: 'maria@exemplo.com', cpf: '52998224725' });
    expect(a.email_verificado_em).not.toBeNull();

    const { rows: d } = await pool.query('SELECT tipo, r2_key, mime FROM documentos ORDER BY tipo');
    expect(d.map((x) => [x.tipo, x.mime])).toEqual([
      ['comprovante_residencia', 'application/pdf'],
      ['identidade', 'image/jpeg'],
    ]);
    // Arquivo em disco é cifrado; decifrado bate com o original
    const bruto = await readdir(path.join(dirDocs, 'chat-42'));
    expect(bruto).toHaveLength(2);
    expect((await docs.ler(d[1].r2_key)).toString()).toMatch(/^conteudo-p-big-/);

    const { rows: h } = await pool.query('SELECT status, termo_versao FROM habilitacoes');
    expect(h).toEqual([{ status: 'pendente', termo_versao: 1 }]);
    expect((await pool.query('SELECT count(*)::int AS n FROM auditoria')).rows[0].n).toBe(2);
    // Sessão limpa ao final
    expect((await pool.query(`SELECT dados FROM sessoes_bot WHERE chave='42'`)).rows[0].dados).toEqual({});
  });

  it('cadastro único: segundo leiloeiro só pede o termo', async () => {
    const { bot, chamadas } = montar();
    await cadastroCompleto(bot);
    chamadas.length = 0;
    await bot.handleUpdate(texto('/start outro'));
    await bot.handleUpdate(botao('termo:aceito'));
    expect(textosEnviados(chamadas).at(-1)).toContain('enviado para Outro Leiloeiro');
    expect((await pool.query('SELECT count(*)::int AS n FROM habilitacoes')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int AS n FROM arrematantes')).rows[0].n).toBe(1);
  });

  it('reabrir link de leiloeiro já solicitado mostra status, sem duplicar', async () => {
    const { bot, chamadas } = montar();
    await cadastroCompleto(bot);
    await pool.query(`UPDATE habilitacoes SET status='aprovado'`);
    chamadas.length = 0;
    await bot.handleUpdate(texto('/start colodete'));
    expect(textosEnviados(chamadas)[0]).toContain('aprovado');
  });

  it('CAD-02: código errado 5x bloqueia; código certo depois não passa', async () => {
    const { bot, chamadas } = montar();
    await bot.handleUpdate(texto('/start colodete'));
    await bot.handleUpdate(botao('termo:aceito'));
    await bot.handleUpdate(texto('Maria da Silva'));
    await bot.handleUpdate(texto('maria@exemplo.com'));
    const certo = ultimoCodigo;
    const errado = certo === '111111' ? '222222' : '111111';
    for (let i = 0; i < LIMITES.maxTentativas; i++) await bot.handleUpdate(texto(errado));
    expect(textosEnviados(chamadas).at(-1)).toBe(MSG.codigoExpirado);
    // voltou para etapa de e-mail: o código certo agora é tratado como e-mail inválido
    await bot.handleUpdate(texto(certo));
    expect(textosEnviados(chamadas).at(-1)).toBe(MSG.emailInvalido);
  });

  it('CAD-03: código expirado é recusado', async () => {
    const { bot, chamadas } = montar();
    await bot.handleUpdate(texto('/start colodete'));
    await bot.handleUpdate(botao('termo:aceito'));
    await bot.handleUpdate(texto('Maria da Silva'));
    await bot.handleUpdate(texto('maria@exemplo.com'));
    await pool.query(`UPDATE codigos_email SET expira_em = now() - interval '1 second'`);
    await bot.handleUpdate(texto(ultimoCodigo));
    expect(textosEnviados(chamadas).at(-1)).toBe(MSG.codigoExpirado);
  });

  it('limite de reenvio de código por hora', async () => {
    const { bot, chamadas } = montar();
    await bot.handleUpdate(texto('/start colodete'));
    await bot.handleUpdate(botao('termo:aceito'));
    await bot.handleUpdate(texto('Maria da Silva'));
    for (let i = 0; i < LIMITES.maxEnviosPorHora; i++) {
      await bot.handleUpdate(texto('maria@exemplo.com'));
      await pool.query(`UPDATE codigos_email SET expira_em = now() - interval '1 second'`);
      await bot.handleUpdate(texto('000000')); // força volta à etapa de e-mail (expirado)
    }
    await bot.handleUpdate(texto('maria@exemplo.com'));
    expect(textosEnviados(chamadas).at(-1)).toBe(MSG.limiteEnvios);
  });

  it('CAD-04: CPF com DV inválido ou repetido é recusado', async () => {
    const { bot, chamadas } = montar();
    await bot.handleUpdate(texto('/start colodete'));
    await bot.handleUpdate(botao('termo:aceito'));
    await bot.handleUpdate(texto('Maria da Silva'));
    await bot.handleUpdate(texto('maria@exemplo.com'));
    await bot.handleUpdate(texto(ultimoCodigo));
    await bot.handleUpdate(texto('11111111111'));
    await bot.handleUpdate(texto('52998224724'));
    expect(textosEnviados(chamadas).slice(-2)).toEqual([MSG.cpfInvalido, MSG.cpfInvalido]);
  });

  it('CPF já usado por outra conta encerra o fluxo sem revelar o dono', async () => {
    const { bot } = montar();
    await cadastroCompleto(bot, 42);
    const outro = montar();
    await outro.bot.handleUpdate(texto('/start colodete', 77));
    await outro.bot.handleUpdate(botao('termo:aceito', 77));
    await outro.bot.handleUpdate(texto('João Souza', 77));
    await outro.bot.handleUpdate(texto('joao@exemplo.com', 77));
    await outro.bot.handleUpdate(texto(ultimoCodigo, 77));
    await outro.bot.handleUpdate(texto('52998224725', 77));
    const ultima = textosEnviados(outro.chamadas).at(-1)!;
    expect(ultima).toBe(MSG.cpfIndisponivel);
    expect(ultima).not.toContain('Maria');
  });

  it('CAD-07: aceita PDF e rejeita tipo/tamanho inválido', async () => {
    const { bot, chamadas } = montar();
    await bot.handleUpdate(texto('/start colodete'));
    await bot.handleUpdate(botao('termo:aceito'));
    await bot.handleUpdate(texto('Maria da Silva'));
    await bot.handleUpdate(texto('maria@exemplo.com'));
    await bot.handleUpdate(texto(ultimoCodigo));
    await bot.handleUpdate(texto('52998224725'));
    await bot.handleUpdate(botao('cnpj:nao'));
    await bot.handleUpdate(texto('Rua das Flores, 100, Centro, Vitória/ES'));
    await bot.handleUpdate(pdf(42, 'application/x-msdownload'));
    await bot.handleUpdate(pdf(42, 'application/pdf', 50 * 1024 * 1024));
    expect(textosEnviados(chamadas).slice(-2)).toEqual([MSG.arquivoInvalido, MSG.arquivoInvalido]);
    await bot.handleUpdate(pdf(42));
    expect(textosEnviados(chamadas).at(-1)).toBe(MSG.pedirComprovante);
  });

  it('CAD-10/11: sessão sobrevive a "restart" (novo bot, mesmo banco)', async () => {
    const a = montar();
    await a.bot.handleUpdate(texto('/start colodete'));
    await a.bot.handleUpdate(botao('termo:aceito'));
    await a.bot.handleUpdate(texto('Maria da Silva'));
    const b = montar(); // simula processo reiniciado
    await b.bot.handleUpdate(texto('maria@exemplo.com'));
    expect(textosEnviados(b.chamadas).at(-1)).toBe(MSG.codigoEnviado);
  });

  it('botão fora de ordem (clique antigo) é ignorado', async () => {
    const { bot, chamadas } = montar();
    await bot.handleUpdate(botao('confirmar:sim'));
    expect(textosEnviados(chamadas)).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM arrematantes')).rows[0].n).toBe(0);
  });

  it('LGPD: /excluirmeusdados apaga cadastro, habilitações e arquivos', async () => {
    const { bot, chamadas } = montar();
    await cadastroCompleto(bot);
    await bot.handleUpdate(texto('/excluirmeusdados'));
    await bot.handleUpdate(botao('excluir:sim'));
    expect(textosEnviados(chamadas).at(-1)).toBe(MSG.exclusaoFeita);
    for (const t of ['arrematantes', 'documentos', 'habilitacoes']) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
    }
    expect(await readdir(path.join(dirDocs, 'chat-42'))).toHaveLength(0);
  });

  it('"Meu status" lista por leiloeiro e "Notícias" mostra coletas', async () => {
    const { bot, chamadas } = montar();
    await cadastroCompleto(bot);
    await pool.query(`INSERT INTO publicacoes (fonte,tipo,titulo,url,publicado_em) VALUES
      ('imprensa-leiloes','noticia','Caixa leiloa <592> imóveis','https://imprensaleiloes.com.br/noticias/a','2026-11-17T13:15:00-03:00'),
      ('imprensa-leiloes','edicao','Edição Vol. 1, N. 3','https://imprensaleiloes.com.br/files/x.pdf',NULL)`);
    chamadas.length = 0;
    await bot.handleUpdate(texto('📊 Meu status'));
    await bot.handleUpdate(texto('📰 Notícias de leilões'));
    const [status, noticias] = textosEnviados(chamadas);
    expect(status).toContain('Colodete Leilões: ⏳ em análise');
    expect(noticias).toContain('17/11/2026');
    expect(noticias).toContain('&lt;592&gt;');
    expect(noticias).toContain('Edição Vol. 1, N. 3');
  });
});
