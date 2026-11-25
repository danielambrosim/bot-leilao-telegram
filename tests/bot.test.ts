import { describe, expect, it } from 'vitest';
import { MSG } from '../src/bot/createBot';
import type { Leiloeiro, LeiloeiroRepo } from '../src/leiloeiros/repo';
import { montarBot, texto, textosEnviados } from './helpers/botHarness';

const demo: Leiloeiro = { id: 1, slug: 'demo', nome: 'Leilões <Demo> & Cia', termo_texto: 'Termo <b>x</b>', termo_versao: 2 };
const repo: LeiloeiroRepo = { findAtivoPorSlug: async (s) => (s === 'demo' ? demo : null) };

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
