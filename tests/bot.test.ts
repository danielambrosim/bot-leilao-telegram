import { describe, expect, it } from 'vitest';
import { MSG } from '../src/bot/createBot';
import type { Leiloeiro, LeiloeiroRepo } from '../src/leiloeiros/repo';
import { botao, montarBot, texto, textosEnviados } from './helpers/botHarness';
import { createResendApiMailer } from '../src/mail/mailer';

const demo: Leiloeiro = { id: 1, slug: 'demo', nome: 'Leilões <Demo> & Cia', termo_texto: 'Termo <b>x</b>', termo_versao: 2 };
const repo: LeiloeiroRepo = {
  findAtivoPorSlug: async (s) => (s === 'demo' ? demo : null),
  listarAtivos: async () => [{ slug: 'demo', nome: demo.nome }, { slug: 'outro-lei', nome: 'Outro' }],
};

describe('bot /start (sem banco)', () => {
  it('sem payload orienta a usar o link do leiloeiro', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('/start'));
    expect(textosEnviados(chamadas)[0]).toBe(MSG.semLeiloeiro);
  });

  it('slug desconhecido informa link inválido', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('/start naoexiste'));
    expect(textosEnviados(chamadas)[0]).toBe(MSG.leiloeiroInvalido);
  });

  it('payload malicioso não chega ao banco', async () => {
    let chamado = false;
    const { bot, chamadas } = montarBot({ leiloeiros: { findAtivoPorSlug: async () => ((chamado = true), null) } });
    await bot.handleUpdate(texto("/start x';DROP--"));
    expect(chamado).toBe(false);
    expect(textosEnviados(chamadas)[0]).toBe(MSG.semLeiloeiro);
  });

  it('slug válido mostra termo do leiloeiro escapado, com versão e botões', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('/start demo'));
    const msg = chamadas.find((c) => c.method === 'sendMessage')!.payload;
    expect(msg.parse_mode).toBe('HTML');
    expect(msg.text).toContain('Leilões &lt;Demo&gt; &amp; Cia');
    expect(msg.text).toContain('Termo &lt;b&gt;x&lt;/b&gt;');
    expect(msg.text).toContain('versão 2');
    expect(JSON.stringify(msg.reply_markup)).toContain('termo:aceito');
  });

  it('ignora mensagens em grupos (dados pessoais só no privado)', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('/start demo', 42, 'group'));
    expect(chamadas).toHaveLength(0);
  });

  it('erro no repositório responde mensagem genérica sem vazar detalhe', async () => {
    const { bot, chamadas } = montarBot({
      leiloeiros: {
        findAtivoPorSlug: async () => {
          throw new Error('db down: senha=xyz');
        },
      },
    });
    await bot.handleUpdate(texto('/start demo'));
    expect(textosEnviados(chamadas)).toEqual([MSG.erroInterno]);
  });
});

describe('botão "Escolher leiloeiro"', () => {
  it('menu tem o botão e mensagem solta orienta a usá-lo', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('Olá'));
    const msg = chamadas.find((c) => c.method === 'sendMessage')!.payload;
    expect(msg.text).toBe(MSG.semLeiloeiro);
    expect(JSON.stringify(msg.reply_markup)).toContain('Escolher leiloeiro');
  });

  it('lista leiloeiros ativos como botões e o clique abre o termo', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('🏛️ Escolher leiloeiro'));
    const lista = chamadas.find((c) => c.method === 'sendMessage')!.payload;
    expect(lista.text).toBe(MSG.escolherLeiloeiro);
    expect(JSON.stringify(lista.reply_markup)).toContain('lei:demo');
    expect(JSON.stringify(lista.reply_markup)).toContain('lei:outro-lei');
    chamadas.length = 0;
    await bot.handleUpdate(botao('lei:demo'));
    expect(textosEnviados(chamadas)[0]).toContain('Habilitação — Leilões &lt;Demo&gt;');
  });

  it('"/start Colodete" digitado com maiúscula funciona', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(texto('/start Demo'));
    expect(textosEnviados(chamadas)[0]).toContain('Habilitação —');
  });

  it('sem leiloeiros ativos avisa', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: { findAtivoPorSlug: async () => null, listarAtivos: async () => [] } });
    await bot.handleUpdate(texto('🏛️ Escolher leiloeiro'));
    expect(textosEnviados(chamadas)[0]).toBe(MSG.semLeiloeirosAtivos);
  });

  it('clique em slug inválido/inexistente não quebra', async () => {
    const { bot, chamadas } = montarBot({ leiloeiros: repo });
    await bot.handleUpdate(botao('lei:naoexiste'));
    expect(textosEnviados(chamadas)[0]).toBe(MSG.leiloeiroInvalido);
  });
});

describe('Resend via API HTTPS', () => {
  it('envia com Bearer, from/to/subject e falha com detalhe do Resend', async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = [];
    const ok = createResendApiMailer('re_teste', 'Colodete <a@b.com>', (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return new Response('{"id":"1"}', { status: 200 });
    }) as typeof fetch);
    await ok.enviarCodigo('x@y.com', '123456');
    expect(pedidos[0]!.url).toBe('https://api.resend.com/emails');
    expect((pedidos[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_teste');
    expect(JSON.parse(String(pedidos[0]!.init.body))).toMatchObject({ to: ['x@y.com'], subject: 'Seu código de verificação: 123456' });

    const falha = createResendApiMailer('re_teste', 'a@b.com', (async () =>
      new Response('{"message":"You can only send testing emails to your own email address"}', { status: 403 })) as typeof fetch);
    await expect(falha.enviarCodigo('x@y.com', '1')).rejects.toThrow(/403.*own email/);
  });
});
