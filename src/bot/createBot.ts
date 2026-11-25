import { Bot, GrammyError, HttpError, type BotConfig, type Context } from 'grammy';
import type { LeiloeiroRepo } from '../leiloeiros/repo';
import { escapeHtml, parseStartPayload } from './startPayload';

export interface BotDeps {
  token: string;
  leiloeiros: LeiloeiroRepo;
  /** Usado em testes para não chamar getMe na API do Telegram */
  botConfig?: BotConfig<Context>;
}

export const MSG = {
  semLeiloeiro:
    'Olá! Este bot faz a habilitação de arrematantes para leiloeiros parceiros.\n\n' +
    'Para começar, abra o link de habilitação enviado pelo seu leiloeiro.',
  leiloeiroInvalido:
    'Não encontrei esse leiloeiro ou o link expirou. Peça um novo link de habilitação ao leiloeiro.',
  ajuda:
    'Como funciona:\n' +
    '1. Abra o link de habilitação do leiloeiro.\n' +
    '2. Aceite o termo e envie seus dados e documentos (uma única vez).\n' +
    '3. O leiloeiro analisa e você recebe o resultado aqui.\n\n' +
    'Comandos: /start, /ajuda',
  erroInterno: 'Tive um problema ao processar sua mensagem. Tente novamente em instantes.',
} as const;

export function createBot({ token, leiloeiros, botConfig }: BotDeps): Bot {
  const bot = new Bot(token, botConfig);

  // errorBoundary vale para polling E webhook (bot.catch só cobre polling).
  // Sem isso, um erro vira HTTP 500 no webhook e o Telegram reenvia o update em loop.
  const app = bot.errorBoundary(async (err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('[bot] erro da API Telegram:', e.description);
    else if (e instanceof HttpError) console.error('[bot] falha de rede com o Telegram:', e.message);
    else console.error('[bot] erro não tratado:', e);
    await err.ctx.reply(MSG.erroInterno).catch(() => undefined);
  });

  // Bot só atende conversas privadas (dados pessoais nunca em grupos)
  const privado = app.chatType('private');

  privado.command('start', async (ctx) => {
    const slug = parseStartPayload(ctx.match);
    if (!slug) {
      await ctx.reply(MSG.semLeiloeiro);
      return;
    }
    const leiloeiro = await leiloeiros.findAtivoPorSlug(slug);
    if (!leiloeiro) {
      await ctx.reply(MSG.leiloeiroInvalido);
      return;
    }
    // Fase 2: iniciar fluxo de cadastro único / habilitação aqui
    await ctx.reply(
      `Você está iniciando sua habilitação com <b>${escapeHtml(leiloeiro.nome)}</b>.\n\n` +
        'O cadastro guiado será liberado em breve.',
      { parse_mode: 'HTML' },
    );
  });

  privado.command(['ajuda', 'help'], (ctx) => ctx.reply(MSG.ajuda));

  privado.on('message', (ctx) => ctx.reply(MSG.ajuda));

  return bot;
}
