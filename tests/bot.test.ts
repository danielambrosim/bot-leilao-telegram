import { beforeEach, describe, expect, it } from 'vitest';
import type { BotConfig, Context } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot, MSG } from '../src/bot/createBot';
import type { Leiloeiro, LeiloeiroRepo } from '../src/leiloeiros/repo';

const botInfo = {
  id: 1,
  is_bot: true,
  first_name: 'Teste',
  username: 'teste_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
} as NonNullable<BotConfig<Context>['botInfo']>;

const demo: Leiloeiro = { id: 1, slug: 'demo', nome: 'Leilões <Demo> & Cia', termo_texto: 't', termo_versao: 1 };
const repo: LeiloeiroRepo = { findAtivoPorSlug: async (s) => (s === 'demo' ? demo : null) };

let sent: Array<{ method: string; payload: any }>;

function makeBot() {
  const bot = createBot({ token: '1:x', leiloeiros: repo, botConfig: { botInfo } });
  // Intercepta chamadas à API do Telegram (nenhuma requisição real)
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload });
    return { ok: true, result: true } as any;
  });
  return bot;
}

let updateId = 0;
function msg(text: string, chatType: 'private' | 'group' = 'private'): Update {
  const entities = text.startsWith('/')
    ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }]
    : undefined;
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: chatType === 'private' ? { id: 42, type: 'private', first_name: 'A' } : { id: -5, type: 'group', title: 'G' },
      from: { id: 42, is_bot: false, first_name: 'A' },
      text,
      entities,
    },
  } as Update;
}

describe('bot /start', () => {
  beforeEach(() => {
    sent = [];
  });

  it('sem payload orienta a usar o link do leiloeiro', async () => {
    await makeBot().handleUpdate(msg('/start'));
    expect(sent[0]?.payload.text).toBe(MSG.semLeiloeiro);
  });

  it('slug desconhecido informa link inválido', async () => {
    await makeBot().handleUpdate(msg('/start naoexiste'));
    expect(sent[0]?.payload.text).toBe(MSG.leiloeiroInvalido);
  });

  it('payload malicioso não chega ao banco', async () => {
    let chamado = false;
    const bot = createBot({
      token: '1:x',
      botConfig: { botInfo },
      leiloeiros: { findAtivoPorSlug: async () => ((chamado = true), null) },
    });
    bot.api.config.use(async (_p, method, payload) => (sent.push({ method, payload }), { ok: true, result: true } as any));
    await bot.handleUpdate(msg("/start x';DROP--"));
    expect(chamado).toBe(false);
    expect(sent[0]?.payload.text).toBe(MSG.semLeiloeiro);
  });

  it('slug válido saúda com nome escapado (CAD-09: sem injeção de formatação)', async () => {
    await makeBot().handleUpdate(msg('/start demo'));
    expect(sent[0]?.payload.parse_mode).toBe('HTML');
    expect(sent[0]?.payload.text).toContain('Leilões &lt;Demo&gt; &amp; Cia');
  });

  it('ignora mensagens em grupos (dados pessoais só no privado)', async () => {
    await makeBot().handleUpdate(msg('/start demo', 'group'));
    expect(sent).toHaveLength(0);
  });

  it('erro no repositório responde mensagem genérica', async () => {
    const bot = createBot({
      token: '1:x',
      botConfig: { botInfo },
      leiloeiros: { findAtivoPorSlug: async () => { throw new Error('db down: senha=xyz'); } },
    });
    bot.api.config.use(async (_p, method, payload) => (sent.push({ method, payload }), { ok: true, result: true } as any));
    await bot.handleUpdate(msg('/start demo'));
    expect(sent[0]?.payload.text).toBe(MSG.erroInterno);
  });
});
