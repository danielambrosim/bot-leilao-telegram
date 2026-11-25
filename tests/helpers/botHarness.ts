import type { BotConfig } from 'grammy';
import type { Update } from 'grammy/types';
import { createBot, type BotContext, type BotDeps } from '../../src/bot/createBot';
import type { ArrematanteRepo } from '../../src/arrematantes/repo';
import type { DocStore } from '../../src/docs/store';

export const botInfo = {
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
} as NonNullable<BotConfig<BotContext>['botInfo']>;

export interface Chamada {
  method: string;
  payload: any;
}

export const arrematantesVazio: ArrematanteRepo = {
  buscarPorChat: async () => null,
  emailOuCpfEmUso: async () => null,
  criarComHabilitacao: async () => 1,
  habilitar: async () => ({ criada: true }),
  statusHabilitacao: async () => null,
  listarHabilitacoes: async () => [],
  excluir: async () => [],
};

export const docsFake: DocStore = {
  salvar: async () => ({ chave: 'x/00000000-0000-0000-0000-000000000000.bin', sha256: '0'.repeat(64), tamanhoBytes: 1 }),
  ler: async () => Buffer.alloc(0),
  apagar: async () => undefined,
};

/** Cria bot com a API do Telegram interceptada (nenhuma requisição real). */
export function montarBot(deps: Partial<BotDeps> & Pick<BotDeps, 'leiloeiros'>) {
  const chamadas: Chamada[] = [];
  const bot = createBot({
    token: '1:x',
    arrematantes: arrematantesVazio,
    codigos: { emitir: async () => ({ ok: true, codigo: '000000' }), verificar: async () => ({ ok: false, motivo: 'expirado' }) },
    mailer: { enviarCodigo: async () => undefined },
    docs: docsFake,
    publicacoes: { inserirNovas: async () => 0, ultimas: async () => [] },
    baixarArquivo: async () => Buffer.from('arquivo'),
    botConfig: { botInfo },
    ...deps,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    chamadas.push({ method, payload });
    return { ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 0, chat: { id: 42, type: 'private' } } : true } as any;
  });
  return { bot, chamadas };
}

let updateId = 0;
const chatPrivado = (id: number) => ({ id, type: 'private' as const, first_name: 'A' });

export function texto(text: string, chatId = 42, tipo: 'private' | 'group' = 'private'): Update {
  const entities = text.startsWith('/') ? [{ type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length }] : undefined;
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: tipo === 'private' ? chatPrivado(chatId) : { id: -5, type: 'group', title: 'G' },
      from: { id: chatId, is_bot: false, first_name: 'A' },
      text,
      entities,
    },
  } as Update;
}

export function foto(chatId = 42): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: chatPrivado(chatId),
      from: { id: chatId, is_bot: false, first_name: 'A' },
      photo: [
        { file_id: 'p-small', file_unique_id: 's', width: 90, height: 90, file_size: 1000 },
        { file_id: `p-big-${updateId}`, file_unique_id: 'b', width: 1280, height: 960, file_size: 200_000 },
      ],
    },
  } as Update;
}

export function pdf(chatId = 42, mime = 'application/pdf', tamanho = 50_000): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: chatPrivado(chatId),
      from: { id: chatId, is_bot: false, first_name: 'A' },
      document: { file_id: `d-${updateId}`, file_unique_id: 'd', mime_type: mime, file_size: tamanho, file_name: 'x' },
    },
  } as Update;
}

export function contato(chatId = 42, telefone = '+55 27 99988-7766', donoId = chatId): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: updateId,
      date: 0,
      chat: chatPrivado(chatId),
      from: { id: chatId, is_bot: false, first_name: 'A' },
      contact: { phone_number: telefone, first_name: 'A', user_id: donoId },
    },
  } as Update;
}

export function botao(data: string, chatId = 42): Update {
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(updateId),
      chat_instance: 'ci',
      from: { id: chatId, is_bot: false, first_name: 'A' },
      data,
      message: { message_id: 1, date: 0, chat: chatPrivado(chatId), text: 'x' },
    },
  } as Update;
}

export const textosEnviados = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text as string);
