import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mascararCPF, validarCNPJ, validarCPF, validarEmail } from '../src/util/documentosBr';
import { createLocalDocStore } from '../src/docs/store';
import { coletarImprensaLeiloes, parseArtigo, parseEdicoes, parseHome } from '../src/scraper/imprensaLeiloes';
import type { NovaPublicacao, PublicacaoRepo } from '../src/publicacoes/repo';

describe('documentos BR', () => {
  it.each(['52998224725', '529.982.247-25', '11144477735'])('CPF válido %s', (c) => expect(validarCPF(c)).toBe(true));
  it.each(['11111111111', '52998224724', '123', '', '5299822472a'])('CPF inválido %j', (c) => expect(validarCPF(c)).toBe(false));
  it.each(['11222333000181', '11.222.333/0001-81'])('CNPJ válido %s', (c) => expect(validarCNPJ(c)).toBe(true));
  it.each(['11222333000182', '00000000000000', '123'])('CNPJ inválido %j', (c) => expect(validarCNPJ(c)).toBe(false));
  it('e-mail', () => {
    expect(validarEmail('a@b.com')).toBe(true);
    expect(validarEmail('a@b')).toBe(false);
    expect(validarEmail('a b@c.com')).toBe(false);
  });
  it('máscara de CPF', () => expect(mascararCPF('52998224725')).toBe('***.982.247-**'));
});

describe('DocStore local cifrado', () => {
  const chave = Buffer.alloc(32, 1).toString('base64');

  it('arquivo em disco não contém o conteúdo em claro e decifra corretamente', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sbl-'));
    try {
      const store = createLocalDocStore(dir, chave);
      const original = Buffer.from('RG 12.345.678-9 MARIA DA SILVA');
      const s = await store.salvar('chat-1', original);
      const [arquivo] = await readdir(path.join(dir, 'chat-1'));
      const bruto = await readFile(path.join(dir, 'chat-1', arquivo!));
      expect(bruto.includes(Buffer.from('MARIA'))).toBe(false);
      expect((await store.ler(s.chave)).equals(original)).toBe(true);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      await store.apagar(s.chave);
      expect(await readdir(path.join(dir, 'chat-1'))).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('chave errada não decifra (GCM detecta)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sbl-'));
    try {
      const s = await createLocalDocStore(dir, chave).salvar('chat-1', Buffer.from('x'));
      await expect(createLocalDocStore(dir, Buffer.alloc(32, 2).toString('base64')).ler(s.chave)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('bloqueia path traversal na chave', async () => {
    const store = createLocalDocStore(tmpdir(), chave);
    await expect(store.ler('../../etc/passwd')).rejects.toThrow(/inválida/);
    await expect(store.salvar('../x', Buffer.from('a'))).rejects.toThrow(/inválido/);
  });
});

// HTML sintético que reproduz apenas a estrutura do site (sem conteúdo copiado)
const HOME = `
<section class="destaques-home"><div class="dh-grid">
  <a href="/noticias/caso-um-de-teste" class="dh-card k1"><div class="desc"><h3> Título   um </h3><div class="resumo">Resumo um.</div></div></a>
  <a href="/noticias/caso-dois-de-teste" class="dh-card k2"><div class="desc"><h3>Título dois</h3></div></a>
  <a href="https://outro-site.com/noticias/externo" class="dh-card k3"><h3>Externo</h3></a>
  <a href="/sobre" class="dh-card k4"><h3>Não é notícia</h3></a>
</div></section>
<a href="/noticias/caso-tres-de-teste"><h4>Título três da lista lateral</h4></a>
<a href="javascript:alert(1)">x</a>`;
const ARTIGO = `<h1 class="titulo">Título completo do artigo</h1><time datetime="2026-11-17T13:15:00">17/11/2026</time>`;
const EDICOES = `<div class="txt container box edicoes"><ul>
  <li><a href="/files/vol-1-n-1-set-2026.pdf">Vol. 1, N. 1 (set. 2026)</a></li>
  <li><a href="/files/vol-1-n-2-out-2026.pdf">Vol. 1, N. 2 (out. 2026)</a></li>
  <li><a href="http://imprensaleiloes.com.br/files/inseguro.pdf">http</a></li></ul></div>`;

describe('scraper Imprensa Leilões', () => {
  it('parseHome: só notícias do próprio domínio via https, sem duplicar', () => {
    const itens = parseHome(HOME);
    expect(itens.map((i) => i.url)).toEqual([
      'https://imprensaleiloes.com.br/noticias/caso-um-de-teste',
      'https://imprensaleiloes.com.br/noticias/caso-dois-de-teste',
      'https://imprensaleiloes.com.br/noticias/caso-tres-de-teste',
    ]);
    expect(itens[0]).toMatchObject({ titulo: 'Título um', resumo: 'Resumo um.' });
  });

  it('parseArtigo: título e data em horário de Brasília', () => {
    const a = parseArtigo(ARTIGO);
    expect(a.titulo).toBe('Título completo do artigo');
    expect(a.publicadoEm?.toISOString()).toBe('2026-11-17T16:15:00.000Z');
    expect(parseArtigo('<p>sem nada</p>')).toEqual({ titulo: null, publicadoEm: null });
  });

  it('parseEdicoes: PDFs https', () => {
    expect(parseEdicoes(EDICOES)).toEqual([
      { url: 'https://imprensaleiloes.com.br/files/vol-1-n-1-set-2026.pdf', titulo: 'Edição Vol. 1, N. 1 (set. 2026)' },
      { url: 'https://imprensaleiloes.com.br/files/vol-1-n-2-out-2026.pdf', titulo: 'Edição Vol. 1, N. 2 (out. 2026)' },
    ]);
  });

  it('coleta: busca artigo só das novas, tolera falha em um artigo', async () => {
    const gravadas: NovaPublicacao[] = [];
    const repo: PublicacaoRepo = {
      inserirNovas: async (i) => (gravadas.push(...i), i.length),
      ultimas: async () => [{ url: 'https://imprensaleiloes.com.br/noticias/caso-dois-de-teste' } as any],
    };
    const pedidas: string[] = [];
    const r = await coletarImprensaLeiloes(repo, {
      intervaloMs: 0,
      fetcher: async (u) => {
        pedidas.push(u);
        if (u.endsWith('/')) return HOME;
        if (u.endsWith('/edicoes')) return EDICOES;
        if (u.includes('caso-tres')) throw new Error('HTTP 500');
        return ARTIGO;
      },
    });
    expect(pedidas).not.toContain('https://imprensaleiloes.com.br/noticias/caso-dois-de-teste');
    expect(r.erros).toEqual(['HTTP 500']);
    expect(gravadas.filter((g) => g.tipo === 'noticia').map((g) => g.titulo)).toEqual([
      'Título completo do artigo',
      'Título três da lista lateral',
    ]);
    expect(gravadas.filter((g) => g.tipo === 'edicao')).toHaveLength(2);
  });
});
