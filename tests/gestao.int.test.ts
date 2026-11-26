import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createPool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { createLocalDocStore, type DocStore } from '../src/docs/store';
import { createApp } from '../src/http/app';
import { createAuthPainel } from '../src/painel/auth';
import { createPainelRepo } from '../src/painel/repo';
import { createPainelRouter } from '../src/painel/router';
import { createGestaoRepo } from '../src/painel/gestao';
import { expurgarDocumentosVencidos } from '../src/tarefas/manutencao';
import { gerarQrSvg } from '../src/painel/qrcode';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

const url = process.env.TEST_DATABASE_URL;
const SENHA = 'senha-forte-123';
const H = { 'X-SBL-Painel': '1' };

describe.skipIf(!url)('gestão do painel: visão geral, configuração, equipe (Postgres real)', () => {
  const pool = createPool(url!);
  let dir: string;
  let docs: DocStore;

  const app = () => createApp({
    pool,
    painel: createPainelRouter({
      pool, auth: createAuthPainel(pool), repo: createPainelRepo(pool), docs, producao: false,
      webDir: path.resolve(__dirname, '../painel-web'), gestao: createGestaoRepo(pool),
      botUsername: 'api_leilao_bot', mailFrom: 'Colodete <onboarding@resend.dev>',
    }),
  });
  async function logar(email: string, senha = SENHA) {
    const agent = request.agent(app());
    const r = await agent.post('/painel/api/login').set(H).send({ email, senha });
    expect(r.status).toBe(200);
    return agent;
  }

  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sbl-gestao-'));
    docs = createLocalDocStore(dir, Buffer.alloc(32, 3).toString('base64'));
    await pool.query('TRUNCATE leiloeiros, arrematantes, operadores, sessoes_painel, auditoria, publicacoes RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO leiloeiros (slug, nome, termo_texto) VALUES ('colodete','Colodete Leilões','Termo original v1'), ('outro','Outro','t')`);
    await pool.query(`INSERT INTO termos_versoes (leiloeiro_id, versao, texto) SELECT id, termo_versao, termo_texto FROM leiloeiros`);
    const auth = createAuthPainel(pool);
    await auth.criarOperador('colodete', 'dono@colodete.test', SENHA, 'dono');
    await auth.criarOperador('colodete', 'op@colodete.test', SENHA, 'operador');
    await auth.criarOperador('outro', 'dono@outro.test', SENHA, 'dono');
    const { rows: a } = await pool.query(
      `INSERT INTO arrematantes (telegram_chat_id, nome, email, cpf, endereco) VALUES
         (1,'Maria','m@x.com','52998224725','Rua A'), (2,'João','j@x.com','11144477735','Rua B'), (3,'Ana','a@x.com','39053344705','Rua C')
       RETURNING id`,
    );
    await pool.query(
      `INSERT INTO habilitacoes (arrematante_id, leiloeiro_id, termo_versao, status, consentido_em, decidido_em) VALUES
         ($1, 1, 1, 'pendente', now() - interval '30 hours', NULL),
         ($2, 1, 1, 'aprovado', now() - interval '5 hours', now() - interval '3 hours'),
         ($3, 1, 1, 'recusado', now() - interval '6 hours', now() - interval '5 hours'),
         ($1, 2, 1, 'pendente', now(), NULL)`,
      [a[0].id, a[1].id, a[2].id],
    );
  });
  afterAll(async () => {
    await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('visão geral: indicadores corretos e só do próprio leiloeiro', async () => {
    const ag = await logar('op@colodete.test');
    const r = await ag.get('/painel/api/resumo');
    expect(r.body.indicadores).toEqual({ pendentes: 1, atrasados: 1, aprovados30: 1, tempoMedioMin: 90, taxaRecusa: 50 });
    expect(r.body.fila.map((f: { nome: string }) => f.nome)).toEqual(['Maria']);
  });

  it('operador vê configuração mas não altera (403); responsável altera', async () => {
    const op = await logar('op@colodete.test');
    const cfg = await op.get('/painel/api/config');
    expect(cfg.body.link).toBe('https://t.me/api_leilao_bot?start=colodete');
    expect(cfg.body.podeEditar).toBe(false);
    expect(cfg.body.integracoes.emailDominioProprio).toBe(false);
    expect((await op.put('/painel/api/config/dados').set(H).send({ nome: 'Hack' })).status).toBe(403);
    expect((await op.post('/painel/api/equipe').set(H).send({ nome: 'X', email: 'x@y.com' })).status).toBe(403);

    const dono = await logar('dono@colodete.test');
    const ok = await dono.put('/painel/api/config/dados').set(H).send({ nome: 'Colodete Leilões Oficial', site_url: 'https://colodete.com.br', email_contato: 'contato@colodete.com.br', matricula: 'JUCEES 123' });
    expect(ok.status).toBe(200);
    expect((await pool.query(`SELECT nome, matricula FROM leiloeiros WHERE id = 1`)).rows[0]).toEqual({ nome: 'Colodete Leilões Oficial', matricula: 'JUCEES 123' });
    expect((await pool.query(`SELECT nome FROM leiloeiros WHERE id = 2`)).rows[0].nome).toBe('Outro');
  });

  it('validação: site sem https e e-mail inválido são recusados com mensagem', async () => {
    const dono = await logar('dono@colodete.test');
    const r1 = await dono.put('/painel/api/config/dados').set(H).send({ nome: 'Colodete', site_url: 'javascript:alert(1)' });
    expect(r1.status).toBe(400);
    expect(r1.body.mensagem).toMatch(/https/);
    const r2 = await dono.put('/painel/api/config/privacidade').set(H).send({ dpo_nome: 'Fulano', dpo_email: 'nao-e-email' });
    expect(r2.status).toBe(400);
  });

  it('termo: nova versão guarda a anterior e conta aceites por versão', async () => {
    const dono = await logar('dono@colodete.test');
    expect((await dono.post('/painel/api/config/termo').set(H).send({ texto: 'curto' })).status).toBe(400);
    const novo = 'Ao continuar, você autoriza a Colodete Leilões a tratar seus dados para habilitação. Versão revisada.';
    const r = await dono.post('/painel/api/config/termo').set(H).send({ texto: novo });
    expect(r.body).toEqual({ ok: true, versao: 2 });
    const v = await dono.get('/painel/api/config/termo');
    expect(v.body.versoes.map((x: { versao: number; aceites: number }) => [x.versao, x.aceites])).toEqual([[2, 0], [1, 3]]);
    expect((await pool.query(`SELECT termo_texto, termo_versao FROM leiloeiros WHERE id = 1`)).rows[0]).toEqual({ termo_texto: novo, termo_versao: 2 });
  });

  it('equipe: convidar gera senha que funciona; desativar derruba a sessão; não altera a si mesmo', async () => {
    const dono = await logar('dono@colodete.test');
    const c = await dono.post('/painel/api/equipe').set(H).send({ nome: 'Carlos', email: 'Carlos@Colodete.test', papel: 'operador' });
    expect(c.status).toBe(200);
    expect(c.body.senha.length).toBeGreaterThanOrEqual(12);
    const novo = await logar('carlos@colodete.test', c.body.senha);
    expect((await novo.get('/painel/api/me')).body.operador).toMatchObject({ nome: 'Carlos', papel: 'operador' });

    expect((await dono.post('/painel/api/equipe').set(H).send({ nome: 'Dup', email: 'dono@outro.test' })).body.mensagem).toMatch(/já tem acesso/);
    expect((await dono.patch(`/painel/api/equipe/${c.body.id}`).set(H).send({ ativo: false })).status).toBe(200);
    expect((await novo.get('/painel/api/me')).status).toBe(401);

    const eu = (await dono.get('/painel/api/equipe')).body.eu;
    expect((await dono.patch(`/painel/api/equipe/${eu}`).set(H).send({ papel: 'operador' })).status).toBe(400);
    // membro de outro leiloeiro não pode ser alterado
    const { rows } = await pool.query(`SELECT id FROM operadores WHERE email = 'dono@outro.test'`);
    expect((await dono.patch(`/painel/api/equipe/${rows[0].id}`).set(H).send({ ativo: false })).status).toBe(400);
  });

  it('redefinir senha gera nova senha e desbloqueia', async () => {
    const dono = await logar('dono@colodete.test');
    await pool.query(`UPDATE operadores SET bloqueado_ate = now() + interval '1 hour' WHERE email = 'op@colodete.test'`);
    const { rows } = await pool.query(`SELECT id FROM operadores WHERE email = 'op@colodete.test'`);
    const r = await dono.patch(`/painel/api/equipe/${rows[0].id}`).set(H).send({ redefinirSenha: true });
    await logar('op@colodete.test', r.body.senha);
  });

  it('auditoria e exportações só do próprio leiloeiro', async () => {
    const dono = await logar('dono@colodete.test');
    await logar('dono@outro.test');
    const a = await dono.get('/painel/api/auditoria');
    expect(a.body.itens.every((i: { operador: string | null }) => i.operador !== 'dono@outro.test')).toBe(true);
    expect(a.body.itens.some((i: { acao: string }) => i.acao === 'painel.login')).toBe(true);
  });

  it('QR code: exige login, serve SVG e oferece download', async () => {
    expect((await request(app()).get('/painel/api/config/qrcode.svg')).status).toBe(401);
    const op = await logar('op@colodete.test');
    const r = await op.get('/painel/api/config/qrcode.svg').buffer(true).parse((res, cb) => {
      const p: Buffer[] = []; res.on('data', (c: Buffer) => p.push(c)); res.on('end', () => cb(null, Buffer.concat(p).toString()));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(r.body as string).toMatch(/<svg[\s\S]*<path/);
    const d = await op.get('/painel/api/config/qrcode.svg?baixar=1');
    expect(d.headers['content-disposition']).toBe('attachment; filename="qrcode-habilitacao-colodete.svg"');
  });

  it('expurgo apaga do storage e do banco só documentos vencidos', async () => {
    const vencido = await docs.salvar('chat-1', Buffer.from('velho'));
    const valido = await docs.salvar('chat-1', Buffer.from('novo'));
    await pool.query(
      `INSERT INTO documentos (arrematante_id, tipo, r2_key, sha256, mime, tamanho_bytes, expira_em) VALUES
         (1, 'identidade', $1, $2, 'image/jpeg', 5, now() - interval '1 day'),
         (1, 'comprovante_residencia', $3, $4, 'image/jpeg', 4, now() + interval '1 day')`,
      [vencido.chave, vencido.sha256, valido.chave, valido.sha256],
    );
    expect(await expurgarDocumentosVencidos(pool, docs)).toBe(1);
    expect((await pool.query('SELECT r2_key FROM documentos')).rows).toEqual([{ r2_key: valido.chave }]);
    expect(await readdir(path.join(dir, 'chat-1'))).toHaveLength(1);
    expect((await pool.query(`SELECT detalhes FROM auditoria WHERE acao = 'documentos.expurgados'`)).rows[0].detalhes).toEqual({ quantidade: 1 });
  });
});

describe('QR code do link de habilitação', () => {
  it('decodifica exatamente para o link do leiloeiro', async () => {
    const link = 'https://t.me/api_leilao_bot?start=colodete';
    const q = qrcode(0, 'M');
    q.addData(link, 'Byte');
    q.make();
    // Rasteriza a matriz (4 px por módulo + margem de 4 módulos) e lê como uma câmera leria
    const n = q.getModuleCount(), esc = 4, margem = 4, lado = (n + margem * 2) * esc;
    const px = new Uint8ClampedArray(lado * lado * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) {
      for (let y = 0; y < esc; y++) for (let x = 0; x < esc; x++) {
        const i = (((r + margem) * esc + y) * lado + (c + margem) * esc + x) * 4;
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
    }
    expect(jsQR(px, lado, lado)?.data).toBe(link);
    const svg = gerarQrSvg(link);
    expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain(`viewBox="0 0 ${(n + 8) * 8} ${(n + 8) * 8}"`);
  });
});
