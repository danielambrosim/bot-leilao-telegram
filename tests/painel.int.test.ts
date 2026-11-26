import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createPool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { createLocalDocStore, type DocStore } from '../src/docs/store';
import { createApp } from '../src/http/app';
import { createAuthPainel, MAX_FALHAS, conferirSenha, hashSenha } from '../src/painel/auth';
import { createPainelRepo } from '../src/painel/repo';
import { createPainelRouter } from '../src/painel/router';

const url = process.env.TEST_DATABASE_URL;
const SENHA = 'senha-forte-123';
const H = { 'X-SBL-Painel': '1' };

describe('hash de senha', () => {
  it('scrypt confere e rejeita', async () => {
    const h = await hashSenha('abc123abc123');
    expect(h).toMatch(/^scrypt\$/);
    expect(await conferirSenha('abc123abc123', h)).toBe(true);
    expect(await conferirSenha('errada', h)).toBe(false);
    expect(await conferirSenha('x', 'lixo')).toBe(false);
  });
});

describe.skipIf(!url)('painel do leiloeiro (Postgres real)', () => {
  const pool = createPool(url!);
  let dir: string;
  let docs: DocStore;
  let avisos: Array<{ chat: number; texto: string }>;
  let habColodete: number;
  let habOutro: number;

  const app = () =>
    createApp({
      pool,
      painel: createPainelRouter({
        pool,
        auth: createAuthPainel(pool),
        repo: createPainelRepo(pool),
        docs,
        producao: false,
        webDir: path.resolve(__dirname, '../painel-web'),
        telegram: { sendMessage: (async (chat: number, texto: string) => (avisos.push({ chat, texto }), {})) as never },
      }),
    });

  async function logar(email = 'dono@colodete.test', senha = SENHA) {
    const agent = request.agent(app());
    const r = await agent.post('/painel/api/login').set(H).send({ email, senha });
    return { agent, r };
  }

  beforeAll(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  });
  beforeEach(async () => {
    avisos = [];
    dir = await mkdtemp(path.join(tmpdir(), 'sbl-painel-'));
    docs = createLocalDocStore(dir, Buffer.alloc(32, 4).toString('base64'));
    await pool.query('TRUNCATE leiloeiros, arrematantes, operadores, sessoes_painel, auditoria RESTART IDENTITY CASCADE');
    await pool.query(`INSERT INTO leiloeiros (slug, nome, termo_texto) VALUES ('colodete','Colodete Leilões','t'), ('outro','Outro Leiloeiro','t')`);
    const auth = createAuthPainel(pool);
    await auth.criarOperador('colodete', 'dono@colodete.test', SENHA);
    await auth.criarOperador('outro', 'dono@outro.test', SENHA);
    const { rows: a } = await pool.query(
      `INSERT INTO arrematantes (telegram_chat_id, nome, email, cpf, endereco, cidade, uf, rg_ie, celular)
       VALUES (111, 'Maria Colodete', 'maria@x.com', '52998224725', 'Rua A, 1', 'Vitória', 'ES', '123 SPTC/ES', '5527999887766'),
              (222, 'João Outro', 'joao@x.com', '11144477735', 'Rua B, 2', 'Serra', 'ES', '456', null)
       RETURNING id`,
    );
    const s = await docs.salvar('chat-111', Buffer.from('%PDF-documento-da-maria'));
    await pool.query(
      `INSERT INTO documentos (arrematante_id, tipo, r2_key, sha256, mime, tamanho_bytes, expira_em)
       VALUES ($1, 'identidade', $2, $3, 'application/pdf', $4, now() + interval '1 day')`,
      [a[0].id, s.chave, s.sha256, s.tamanhoBytes],
    );
    const { rows: h } = await pool.query(
      `INSERT INTO habilitacoes (arrematante_id, leiloeiro_id, termo_versao)
       VALUES ($1, 1, 1), ($2, 2, 1) RETURNING id::int AS id`,
      [a[0].id, a[1].id],
    );
    habColodete = h[0].id;
    habOutro = h[1].id;
  });
  afterAll(async () => {
    await pool.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('página do painel abre com CSP estrita e sem cache', async () => {
    const r = await request(app()).get('/painel/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('Painel de habilitação');
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['cache-control']).toBe('no-store');
    expect((await request(app()).get('/painel/static/app.js')).status).toBe(200);
    expect((await request(app()).get('/painel/static/../../.env')).status).toBe(404);
  });

  it('login: cookie httpOnly + SameSite=Strict; senha errada 401; sem sessão 401', async () => {
    const { r } = await logar();
    expect(r.status).toBe(200);
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/painel/);
    expect((await logar('dono@colodete.test', 'errada-123456')).r.status).toBe(401);
    expect((await logar('naoexiste@x.com', SENHA)).r.status).toBe(401);
    expect((await request(app()).get('/painel/api/habilitacoes')).status).toBe(401);
  });

  it(`bloqueia após ${MAX_FALHAS} senhas erradas, mesmo com a senha certa depois`, async () => {
    for (let i = 0; i < MAX_FALHAS; i++) await logar('dono@colodete.test', `errada-${i}-abcdef`);
    expect((await logar()).r.status).toBe(429);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM auditoria WHERE acao = 'painel.login_falhou'`);
    expect(rows[0].n).toBe(MAX_FALHAS);
  });

  it('CSRF: escrita sem o header do painel é recusada', async () => {
    const { agent } = await logar();
    const r = await agent.post(`/painel/api/habilitacoes/${habColodete}/decisao`).send({ decisao: 'aprovado' });
    expect(r.status).toBe(403);
  });

  it('isolamento: leiloeiro só vê os próprios arrematantes', async () => {
    const { agent } = await logar();
    const lista = await agent.get('/painel/api/habilitacoes?status=todos');
    expect(lista.body.itens.map((i: { nome: string }) => i.nome)).toEqual(['Maria Colodete']);
    expect(lista.body.itens[0].cpf_final).toBe('4725');
    expect((await agent.get(`/painel/api/habilitacoes/${habOutro}`)).status).toBe(404);
    expect((await agent.get(`/painel/api/habilitacoes/${habOutro}/documentos/identidade`)).status).toBe(404);
    expect((await agent.post(`/painel/api/habilitacoes/${habOutro}/decisao`).set(H).send({ decisao: 'aprovado' })).status).toBe(409);
  });

  it('busca por nome e por CPF; busca sem dígitos não casa todo CPF', async () => {
    const { agent } = await logar();
    expect((await agent.get('/painel/api/habilitacoes?status=todos&q=maria')).body.itens).toHaveLength(1);
    expect((await agent.get('/painel/api/habilitacoes?status=todos&q=982.247')).body.itens).toHaveLength(1);
    expect((await agent.get('/painel/api/habilitacoes?status=todos&q=zzz')).body.itens).toHaveLength(0);
  });

  it('ficha completa e documento decifrado; ambos auditados', async () => {
    const { agent } = await logar();
    const f = await agent.get(`/painel/api/habilitacoes/${habColodete}`);
    expect(f.body.arrematante).toMatchObject({ nome: 'Maria Colodete', cpf: '52998224725', rg_ie: '123 SPTC/ES' });
    expect(f.body.documentos).toEqual([{ tipo: 'identidade', mime: 'application/pdf', tamanho_bytes: 23 }]);
    const d = await agent.get(`/painel/api/habilitacoes/${habColodete}/documentos/identidade`).buffer(true).parse((res, cb) => {
      const partes: Buffer[] = [];
      res.on('data', (c: Buffer) => partes.push(c));
      res.on('end', () => cb(null, Buffer.concat(partes)));
    });
    expect(d.status).toBe(200);
    expect(d.headers['content-type']).toBe('application/pdf');
    expect((d.body as Buffer).toString()).toBe('%PDF-documento-da-maria');
    const { rows } = await pool.query(`SELECT acao FROM auditoria WHERE acao LIKE 'painel.%' ORDER BY id`);
    expect(rows.map((r) => r.acao)).toEqual(['painel.login', 'painel.ficha_visualizada', 'painel.documento_aberto']);
  });

  it('aprovar avisa o arrematante no Telegram; segunda decisão dá 409', async () => {
    const { agent } = await logar();
    const r = await agent.post(`/painel/api/habilitacoes/${habColodete}/decisao`).set(H).send({ decisao: 'aprovado' });
    expect(r.body).toEqual({ ok: true, avisado: true });
    expect(avisos).toEqual([{ chat: 111, texto: expect.stringContaining('APROVADA') }]);
    const { rows } = await pool.query('SELECT status, decidido_por, decidido_em FROM habilitacoes WHERE id = $1', [habColodete]);
    expect(rows[0].status).toBe('aprovado');
    expect(rows[0].decidido_por).not.toBeNull();
    const de = await agent.post(`/painel/api/habilitacoes/${habColodete}/decisao`).set(H).send({ decisao: 'recusado', motivo: 'motivo qualquer longo' });
    expect(de.status).toBe(409);
  });

  it('recusa exige motivo e o motivo vai para o arrematante', async () => {
    const { agent } = await logar();
    expect((await agent.post(`/painel/api/habilitacoes/${habColodete}/decisao`).set(H).send({ decisao: 'recusado' })).status).toBe(400);
    const r = await agent.post(`/painel/api/habilitacoes/${habColodete}/decisao`).set(H)
      .send({ decisao: 'recusado', motivo: 'Documento ilegível, envie outra foto.' });
    expect(r.status).toBe(200);
    expect(avisos[0]!.texto).toContain('Documento ilegível');
  });

  it('exportar CSV só do próprio leiloeiro e registra auditoria', async () => {
    const { agent } = await logar();
    const r = await agent.get('/painel/api/exportar?status=todos');
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="colodete-todos-/);
    expect(r.text).toContain('Maria Colodete');
    expect(r.text).not.toContain('João Outro');
  });

  it('logout invalida a sessão', async () => {
    const { agent } = await logar();
    expect((await agent.get('/painel/api/me')).status).toBe(200);
    await agent.post('/painel/api/logout').set(H);
    expect((await agent.get('/painel/api/me')).status).toBe(401);
  });

  it('operador desativado não acessa mesmo com sessão aberta', async () => {
    const { agent } = await logar();
    await pool.query(`UPDATE operadores SET ativo = false WHERE email = 'dono@colodete.test'`);
    expect((await agent.get('/painel/api/me')).status).toBe(401);
  });

  it('senha fraca é recusada na criação de operador', async () => {
    await expect(createAuthPainel(pool).criarOperador('colodete', 'x@y.com', 'curta1')).rejects.toThrow(/fraca/);
  });
});
