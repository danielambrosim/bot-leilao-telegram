import {
  Bot,
  GrammyError,
  HttpError,
  InlineKeyboard,
  Keyboard,
  session,
  type Api,
  type BotConfig,
  type Context,
  type SessionFlavor,
  type StorageAdapter,
} from 'grammy';
import type { LeiloeiroRepo } from '../leiloeiros/repo';
import {
  camposFaltantes,
  ConflitoCadastroError,
  ESTADOS_CIVIS,
  type ArrematanteRepo,
  type EstadoCivil,
  type NovoDocumento,
  type StatusHabilitacao,
  type TipoDocumento,
} from '../arrematantes/repo';
import type { CodigoEmailService } from '../verificacao/codigoEmail';
import type { Mailer } from '../mail/mailer';
import type { DocStore } from '../docs/store';
import type { PublicacaoRepo } from '../publicacoes/repo';
import { FONTE as FONTE_IMPRENSA } from '../scraper/imprensaLeiloes';
import { mascararCPF, parseDataNascimento, somenteDigitos, validarCNPJ, validarCPF, validarEmail } from '../util/documentosBr';
import { escapeHtml, parseStartPayload } from './startPayload';
import {
  createViaCep,
  formatarEndereco,
  normalizarCelular,
  parseCidadeUf,
  parseNumeroComplemento,
  type BuscarCep,
} from '../util/endereco';

// ---------- Sessão ----------

type Etapa =
  | 'termo'
  | 'nome'
  | 'email'
  | 'codigo'
  | 'cpf'
  | 'cnpj_pergunta'
  | 'cnpj'
  | 'razao_social'
  | 'nascimento'
  | 'estado_civil'
  | 'profissao'
  | 'rg_ie'
  | 'celular'
  | 'cep'
  | 'cidade_uf'
  | 'logradouro'
  | 'numero'
  | 'doc_identidade'
  | 'doc_comprovante'
  | 'confirmar'
  | 'excluir';

interface DocPendente {
  fileId: string;
  mime: string;
}

type EtapaComplementar = 'nascimento' | 'estado_civil' | 'profissao' | 'razao_social';
const ORDEM_PF: EtapaComplementar[] = ['nascimento', 'estado_civil', 'profissao'];

export interface Fluxo {
  etapa: Etapa;
  leiloeiro?: { id: number; nome: string; termoVersao: number };
  /** Cadastro antigo completando dados que o leiloeiro passou a exigir */
  complemento?: { arrematanteId: number; faltando: EtapaComplementar[] };
  dados: {
    nome?: string;
    email?: string;
    cpf?: string;
    cnpj?: string;
    nascimento?: string; // AAAA-MM-DD
    estadoCivil?: EstadoCivil;
    profissao?: string;
    razaoSocial?: string;
    rgIe?: string;
    celular?: string;
    cep?: string;
    logradouro?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    numero?: string;
    complemento?: string | null;
    endereco?: string;
    identidade?: DocPendente;
    comprovante?: DocPendente;
  };
}

export interface SessionData {
  fluxo?: Fluxo;
}

export type BotContext = Context & SessionFlavor<SessionData>;

// ---------- Dependências ----------

export type BaixarArquivo = (api: Api, fileId: string) => Promise<Buffer>;

export interface BotDeps {
  token: string;
  leiloeiros: LeiloeiroRepo;
  arrematantes: ArrematanteRepo;
  codigos: CodigoEmailService;
  mailer: Mailer;
  docs: DocStore;
  publicacoes: PublicacaoRepo;
  sessionStorage?: StorageAdapter<SessionData>;
  baixarArquivo?: BaixarArquivo;
  buscarCep?: BuscarCep;
  /** Usado em testes para não chamar getMe na API do Telegram */
  botConfig?: BotConfig<BotContext>;
}

export const MAX_ARQUIVO_BYTES = 10 * 1024 * 1024;
const MIMES_ACEITOS = new Set(['image/jpeg', 'image/png', 'application/pdf']);

function baixarViaTelegram(token: string): BaixarArquivo {
  return async (api, fileId) => {
    const file = await api.getFile(fileId);
    if (!file.file_path) throw new Error('Arquivo indisponível no Telegram');
    if ((file.file_size ?? 0) > MAX_ARQUIVO_BYTES) throw new Error('Arquivo grande demais');
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Falha ao baixar arquivo (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_ARQUIVO_BYTES) throw new Error('Arquivo grande demais');
    return buf;
  };
}

// ---------- Textos ----------

export const BOTOES = {
  habilitar: '🏛️ Escolher leiloeiro',
  status: '📊 Meu status',
  noticias: '📰 Notícias de leilões',
  ajuda: 'ℹ️ Ajuda',
} as const;

export const MENU = new Keyboard()
  .text(BOTOES.habilitar)
  .row()
  .text(BOTOES.status)
  .text(BOTOES.noticias)
  .row()
  .text(BOTOES.ajuda)
  .resized()
  .persistent();

export const MSG = {
  semLeiloeiro:
    'Olá! Este bot faz a habilitação de arrematantes para leiloeiros parceiros.\n\n' +
    `Toque em "${BOTOES.habilitar}" para escolher onde quer se habilitar, ` +
    'ou abra o link enviado pelo seu leiloeiro.',
  escolherLeiloeiro: 'Em qual leiloeiro você quer se habilitar?',
  semLeiloeirosAtivos: 'Nenhum leiloeiro está recebendo habilitações pelo bot no momento.',
  leiloeiroInvalido: 'Não encontrei esse leiloeiro ou o link expirou. Peça um novo link de habilitação ao leiloeiro.',
  ajuda:
    'Como funciona:\n' +
    '1. Abra o link de habilitação do leiloeiro.\n' +
    '2. Aceite o termo e envie seus dados e documentos (só na primeira vez).\n' +
    '3. O leiloeiro analisa e você acompanha em "Meu status".\n\n' +
    'Comandos: /cancelar (interrompe o cadastro), /meusdados, /excluirmeusdados',
  erroInterno: 'Tive um problema ao processar sua mensagem. Tente novamente em instantes.',
  termoRecusado: 'Tudo bem. Sem aceitar o termo não é possível se habilitar. Quando quiser, abra o link novamente.',
  pedirNome: 'Vamos ao seu cadastro (feito só uma vez, vale para todos os leiloeiros parceiros).\n\nQual é o seu nome completo?',
  nomeInvalido: 'Digite seu nome completo (nome e sobrenome).',
  pedirEmail: 'Qual é o seu e-mail? Vou enviar um código de confirmação.',
  emailInvalido: 'E-mail inválido. Digite novamente:',
  emailIndisponivel: 'Este e-mail não pode ser usado. Informe outro ou fale com o leiloeiro.',
  limiteEnvios: 'Muitos códigos enviados na última hora. Aguarde um pouco e tente novamente.',
  falhaEnvioEmail: 'Não consegui enviar o e-mail agora. Confira o endereço e digite-o novamente.',
  codigoEnviado: 'Enviei um código de 6 dígitos para seu e-mail (vale 10 minutos). Digite o código:',
  codigoFormato: 'O código tem 6 dígitos. Digite apenas os números:',
  codigoExpirado: 'Código expirado ou bloqueado por tentativas. Digite seu e-mail novamente para receber outro.',
  pedirCpf: 'E-mail confirmado ✅\n\nAgora informe seu CPF:',
  cpfInvalido: 'CPF inválido. Confira os números e digite novamente:',
  cpfIndisponivel: 'Este CPF já está vinculado a outra conta. Fale com o leiloeiro para regularizar.',
  perguntaCnpj: 'Vai arrematar em nome de empresa (CNPJ)?',
  pedirCnpj: 'Informe o CNPJ:',
  cnpjInvalido: 'CNPJ inválido. Digite novamente:',
  pedirNascimento: 'Qual é a sua data de nascimento? (DD/MM/AAAA)',
  nascimentoFormato: 'Use o formato DD/MM/AAAA (ex.: 25/08/1985):',
  nascimentoInvalido: 'Data inválida. Confira e digite novamente (DD/MM/AAAA):',
  menorDeIdade: 'É preciso ter 18 anos ou mais para se habilitar em leilões. Cadastro interrompido.',
  pedirEstadoCivil: 'Qual é o seu estado civil?',
  pedirProfissao: 'Qual é a sua profissão?',
  profissaoInvalida: 'Informe a profissão (entre 2 e 80 caracteres):',
  pedirRazaoSocial: 'Qual é a razão social da empresa?',
  razaoSocialInvalida: 'Informe a razão social completa (entre 2 e 150 caracteres):',
  complementoIntro: 'Este leiloeiro exige alguns dados a mais. São poucas perguntas.',
  pedirRg: 'Informe o número do seu RG com órgão emissor e UF (ex.: 1234567 SPTC/ES):',
  pedirIe: 'Informe a Inscrição Estadual da empresa (ou digite ISENTO):',
  rgInvalido: 'Informe o número do documento (entre 4 e 30 caracteres):',
  pedirCelular: 'Toque no botão abaixo para compartilhar seu celular (ou digite com DDD, ex.: 27 99999-8888).',
  celularInvalido: 'Celular inválido. Use o botão ou digite com DDD (ex.: 27 99999-8888).',
  celularDeOutro: 'Compartilhe o seu próprio número, não o de um contato.',
  pedirCep: 'Qual é o CEP do seu endereço? (8 números)',
  cepInvalido: 'CEP inválido. Digite os 8 números:',
  cepNaoEncontrado: 'Não encontrei esse CEP automaticamente. Informe a cidade e UF (ex.: Vitória/ES):',
  cidadeUfInvalida: 'Use o formato Cidade/UF (ex.: Vila Velha/ES):',
  pedirLogradouro: 'Informe a rua e o bairro, separados por vírgula (ex.: Rua Sete de Setembro, Centro):',
  logradouroInvalido: 'Informe a rua e o bairro separados por vírgula (ex.: Av. Jerônimo Monteiro, Centro):',
  pedirNumero: 'Informe o número e o complemento, se houver (ex.: 412, apto 301 — ou S/N):',
  numeroInvalido: 'Informe o número (ou S/N) e, se houver, o complemento após a vírgula (ex.: 412, apto 301):',
  pedirIdentidade: 'Envie uma foto (ou PDF) do seu documento de identidade com foto (RG ou CNH).',
  pedirComprovante: 'Documento recebido ✅\n\nAgora envie uma foto (ou PDF) do comprovante de residência.',
  arquivoInvalido: 'Envie uma foto ou um arquivo JPG, PNG ou PDF de até 10 MB.',
  usarBotoes: 'Use os botões da mensagem acima para continuar.',
  cancelado: 'Cadastro interrompido. Seus dados digitados foram descartados.',
  semCadastro: 'Você ainda não tem cadastro. Abra o link de habilitação enviado pelo leiloeiro.',
  semNoticias: 'Nenhuma notícia coletada ainda. Tente mais tarde.',
  exclusaoConfirmar:
    'Isto apaga definitivamente seu cadastro, documentos e habilitações em todos os leiloeiros. Não pode ser desfeito. Confirmar?',
  exclusaoFeita: 'Seus dados e documentos foram excluídos.',
  exclusaoCancelada: 'Exclusão cancelada.',
} as const;

const STATUS_LABEL: Record<StatusHabilitacao, string> = {
  pendente: '⏳ em análise',
  aprovado: '✅ aprovado',
  recusado: '❌ recusado',
  revogado: '🚫 revogado',
};

// ---------- Bot ----------

export function createBot(deps: BotDeps): Bot<BotContext> {
  const bot = new Bot<BotContext>(deps.token, deps.botConfig);
  const baixar = deps.baixarArquivo ?? baixarViaTelegram(deps.token);
  const buscarCep = deps.buscarCep ?? createViaCep();
  const tecladoCelular = new Keyboard().requestContact('📱 Compartilhar meu celular').resized().oneTime();

  // errorBoundary vale para polling E webhook (bot.catch só cobre polling).
  // Sem isso, um erro vira HTTP 500 no webhook e o Telegram reenvia o update em loop.
  const app = bot.errorBoundary(async (err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error('[bot] erro da API Telegram:', e.description);
    else if (e instanceof HttpError) console.error('[bot] falha de rede com o Telegram:', e.message);
    else console.error('[bot] erro não tratado:', e);
    await err.ctx.reply(MSG.erroInterno).catch(() => undefined);
  });

  // Dados pessoais só em conversa privada; grupos/canais são ignorados
  const privado = app.chatType('private');
  privado.use(
    session({
      initial: (): SessionData => ({}),
      storage: deps.sessionStorage,
      getSessionKey: (ctx) => ctx.chat?.id.toString(),
    }),
  );

  const mostrarMenu = (ctx: BotContext, texto: string) => ctx.reply(texto, { reply_markup: MENU });

  // ----- Comandos -----

  /** Início da habilitação em um leiloeiro (link ?start=<slug> ou botão "Escolher leiloeiro"). */
  async function iniciarHabilitacao(ctx: BotContext, slug: string) {
    ctx.session.fluxo = undefined;
    const arrematante = await deps.arrematantes.buscarPorChat(ctx.chat!.id);
    const leiloeiro = await deps.leiloeiros.findAtivoPorSlug(slug);
    if (!leiloeiro) {
      await ctx.reply(MSG.leiloeiroInvalido);
      return;
    }
    if (arrematante) {
      const status = await deps.arrematantes.statusHabilitacao(arrematante.id, leiloeiro.id);
      if (status) {
        await mostrarMenu(ctx, `Sua habilitação com ${leiloeiro.nome} está: ${STATUS_LABEL[status]}.`);
        return;
      }
    }
    ctx.session.fluxo = {
      etapa: 'termo',
      leiloeiro: { id: leiloeiro.id, nome: leiloeiro.nome, termoVersao: leiloeiro.termo_versao },
      dados: {},
    };
    await ctx.reply(
      `<b>Habilitação — ${escapeHtml(leiloeiro.nome)}</b>\n\n${escapeHtml(leiloeiro.termo_texto)}\n\n` +
        `<i>Termo versão ${leiloeiro.termo_versao}. Você pode excluir seus dados a qualquer momento com /excluirmeusdados.</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('✅ Aceito', 'termo:aceito').text('❌ Não aceito', 'termo:recusado'),
      },
    );
  }

  privado.command('start', async (ctx) => {
    // Aceita "/start colodete" digitado à mão ou vindo do link (payload)
    const slug = parseStartPayload(ctx.match);
    if (slug) return void (await iniciarHabilitacao(ctx, slug));
    ctx.session.fluxo = undefined;
    const arrematante = await deps.arrematantes.buscarPorChat(ctx.chat.id);
    await mostrarMenu(ctx, arrematante ? `Olá, ${arrematante.nome.split(' ')[0]}! Escolha uma opção.` : MSG.semLeiloeiro);
  });

  // Botão do menu: lista os leiloeiros ativos como botões
  privado.hears(BOTOES.habilitar, async (ctx, next) => {
    if (ctx.session.fluxo && ctx.session.fluxo.etapa !== 'termo') return next(); // no meio do cadastro: tratado abaixo
    const lista = await deps.leiloeiros.listarAtivos();
    if (!lista.length) return void (await mostrarMenu(ctx, MSG.semLeiloeirosAtivos));
    const teclado = new InlineKeyboard();
    for (const l of lista) teclado.text(l.nome, `lei:${l.slug}`).row();
    await ctx.reply(MSG.escolherLeiloeiro, { reply_markup: teclado });
  });

  privado.callbackQuery(/^lei:([a-z0-9_-]{3,40})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await iniciarHabilitacao(ctx, ctx.match[1]!);
  });

  privado.command('cancelar', async (ctx) => {
    ctx.session.fluxo = undefined;
    await mostrarMenu(ctx, MSG.cancelado);
  });

  privado.command(['ajuda', 'help'], (ctx) => mostrarMenu(ctx, MSG.ajuda));

  privado.command('meusdados', async (ctx) => {
    const a = await deps.arrematantes.buscarPorChat(ctx.chat.id);
    if (!a) return void (await ctx.reply(MSG.semCadastro));
    await ctx.reply(
      `<b>Seus dados</b>\nNome: ${escapeHtml(a.nome)}\nE-mail: ${escapeHtml(a.email)}\nCPF: ${mascararCPF(a.cpf)}\n` +
        `Endereço: ${escapeHtml(a.endereco)}`,
      { parse_mode: 'HTML' },
    );
  });

  privado.command('excluirmeusdados', async (ctx) => {
    const a = await deps.arrematantes.buscarPorChat(ctx.chat.id);
    if (!a) return void (await ctx.reply(MSG.semCadastro));
    ctx.session.fluxo = { etapa: 'excluir', dados: {} };
    await ctx.reply(MSG.exclusaoConfirmar, {
      reply_markup: new InlineKeyboard().text('Excluir tudo', 'excluir:sim').text('Cancelar', 'excluir:nao'),
    });
  });

  // ----- Botões inline -----

  // ----- Dados complementares (PF: nascimento, estado civil, profissão · PJ: razão social) -----

  async function perguntar(ctx: BotContext, etapa: EtapaComplementar) {
    if (etapa === 'estado_civil') {
      const teclado = new InlineKeyboard();
      Object.entries(ESTADOS_CIVIS).forEach(([valor, rotulo], i) => {
        teclado.text(rotulo, `ec:${valor}`);
        if (i % 2 === 1) teclado.row();
      });
      return ctx.reply(MSG.pedirEstadoCivil, { reply_markup: teclado });
    }
    const texto = { nascimento: MSG.pedirNascimento, profissao: MSG.pedirProfissao, razao_social: MSG.pedirRazaoSocial }[etapa];
    return ctx.reply(texto);
  }

  /** Depois de coletar um dado complementar: próxima pergunta, ou fim do complemento, ou segue o cadastro (RG/IE). */
  async function seguirComplementares(ctx: BotContext, fluxo: Fluxo, atual: EtapaComplementar) {
    const sequencia = fluxo.complemento?.faltando ?? (atual === 'razao_social' ? [] : ORDEM_PF);
    const proxima = sequencia[sequencia.indexOf(atual) + 1];
    if (proxima) {
      fluxo.etapa = proxima;
      return void (await perguntar(ctx, proxima));
    }
    if (fluxo.complemento) {
      const d = fluxo.dados;
      const l = fluxo.leiloeiro!;
      await deps.arrematantes.complementar(fluxo.complemento.arrematanteId, {
        dataNascimento: d.nascimento, estadoCivil: d.estadoCivil, profissao: d.profissao, razaoSocial: d.razaoSocial,
      });
      await deps.arrematantes.habilitar(fluxo.complemento.arrematanteId, l.id, l.termoVersao);
      ctx.session.fluxo = undefined;
      return void (await mostrarMenu(ctx, `Pronto! Seu cadastro foi enviado para ${l.nome}. Você será avisado aqui quando houver decisão.`));
    }
    fluxo.etapa = 'rg_ie';
    return void (await ctx.reply(fluxo.dados.cnpj ? MSG.pedirIe : MSG.pedirRg));
  }

  privado.callbackQuery(/^(termo|cnpj|confirmar|excluir|ec):(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, grupo, acao] = ctx.match;
    const fluxo = ctx.session.fluxo;
    const esperado: Record<string, Etapa> = {
      termo: 'termo', cnpj: 'cnpj_pergunta', confirmar: 'confirmar', excluir: 'excluir', ec: 'estado_civil',
    };
    if (!fluxo || fluxo.etapa !== esperado[grupo!]) return; // botão antigo/fora de ordem: ignora

    await ctx.editMessageReplyMarkup().catch(() => undefined); // evita clique duplo

    if (grupo === 'termo') {
      if (acao !== 'aceito') {
        ctx.session.fluxo = undefined;
        return void (await mostrarMenu(ctx, MSG.termoRecusado));
      }
      const arrematante = await deps.arrematantes.buscarPorChat(ctx.chat.id);
      if (arrematante) {
        const l = fluxo.leiloeiro!;
        const faltando = camposFaltantes(arrematante);
        if (faltando.length) {
          // Cadastro feito antes da exigência: completa só o que falta, sem refazer tudo
          fluxo.complemento = { arrematanteId: arrematante.id, faltando: [...faltando] };
          fluxo.etapa = faltando[0]!;
          await ctx.reply(MSG.complementoIntro, { reply_markup: { remove_keyboard: true } });
          return void (await perguntar(ctx, faltando[0]!));
        }
        await deps.arrematantes.habilitar(arrematante.id, l.id, l.termoVersao);
        ctx.session.fluxo = undefined;
        return void (await mostrarMenu(ctx, `Pronto! Seu cadastro foi enviado para ${l.nome}. Você será avisado aqui quando houver decisão.`));
      }
      fluxo.etapa = 'nome';
      return void (await ctx.reply(MSG.pedirNome, { reply_markup: { remove_keyboard: true } }));
    }

    if (grupo === 'cnpj') {
      if (acao === 'sim') {
        fluxo.etapa = 'cnpj';
        return void (await ctx.reply(MSG.pedirCnpj));
      }
      fluxo.etapa = 'nascimento';
      return void (await perguntar(ctx, 'nascimento'));
    }

    if (grupo === 'ec') {
      if (!(acao! in ESTADOS_CIVIS)) return;
      fluxo.dados.estadoCivil = acao as EstadoCivil;
      await ctx.reply(`Estado civil: ${ESTADOS_CIVIS[acao as EstadoCivil]}`);
      return void (await seguirComplementares(ctx, fluxo, 'estado_civil'));
    }

    if (grupo === 'excluir') {
      ctx.session.fluxo = undefined;
      if (acao !== 'sim') return void (await mostrarMenu(ctx, MSG.exclusaoCancelada));
      const a = await deps.arrematantes.buscarPorChat(ctx.chat.id);
      if (a) {
        const chaves = await deps.arrematantes.excluir(a.id);
        await Promise.all(chaves.map((c) => deps.docs.apagar(c).catch((e) => console.error('[docs] apagar', e))));
      }
      return void (await ctx.reply(MSG.exclusaoFeita, { reply_markup: { remove_keyboard: true } }));
    }

    // confirmar
    if (acao === 'refazer') {
      fluxo.etapa = 'nome';
      fluxo.dados = {};
      return void (await ctx.reply(MSG.pedirNome));
    }
    await finalizarCadastro(ctx, fluxo);
  });

  async function finalizarCadastro(ctx: BotContext, fluxo: Fluxo) {
    const d = fluxo.dados;
    const l = fluxo.leiloeiro!;
    const chatId = ctx.chat!.id;
    const salvos: NovoDocumento[] = [];
    try {
      for (const [tipo, doc] of [
        ['identidade', d.identidade],
        ['comprovante_residencia', d.comprovante],
      ] as Array<[TipoDocumento, DocPendente]>) {
        const conteudo = await baixar(ctx.api, doc.fileId);
        const s = await deps.docs.salvar(`chat-${chatId}`, conteudo);
        salvos.push({ tipo, chave: s.chave, sha256: s.sha256, mime: doc.mime, tamanhoBytes: s.tamanhoBytes });
      }
      await deps.arrematantes.criarComHabilitacao(
        {
          telegramChatId: chatId,
          nome: d.nome!,
          email: d.email!,
          cpf: d.cpf!,
          cnpj: d.cnpj,
          rgIe: d.rgIe!,
          celular: d.celular!,
          cep: d.cep!,
          logradouro: d.logradouro!,
          numero: d.numero!,
          complemento: d.complemento,
          bairro: d.bairro!,
          cidade: d.cidade!,
          uf: d.uf!,
          endereco: d.endereco!,
          complementares: d.cnpj
            ? { razaoSocial: d.razaoSocial }
            : { dataNascimento: d.nascimento, estadoCivil: d.estadoCivil, profissao: d.profissao },
        },
        salvos,
        l.id,
        l.termoVersao,
      );
    } catch (err) {
      await Promise.all(salvos.map((s) => deps.docs.apagar(s.chave).catch(() => undefined)));
      if (err instanceof ConflitoCadastroError) {
        ctx.session.fluxo = undefined;
        await mostrarMenu(ctx, err.campo === 'cpf' ? MSG.cpfIndisponivel : MSG.emailIndisponivel);
        return;
      }
      throw err;
    }
    ctx.session.fluxo = undefined;
    await mostrarMenu(
      ctx,
      `✅ Cadastro concluído e enviado para ${l.nome}.\n\nVocê será avisado aqui quando houver decisão. ` +
        'Para se habilitar em outro leiloeiro parceiro, basta abrir o link dele — sem preencher tudo de novo.',
    );
  }

  // ----- Celular via botão "compartilhar contato" (número verificado pelo Telegram) -----

  privado.on('message:contact', async (ctx, next) => {
    const fluxo = ctx.session.fluxo;
    if (fluxo?.etapa !== 'celular') return next();
    const contato = ctx.message.contact;
    if (contato.user_id !== ctx.from.id) {
      return void (await ctx.reply(MSG.celularDeOutro, { reply_markup: tecladoCelular }));
    }
    const celular = normalizarCelular(contato.phone_number);
    if (!celular) return void (await ctx.reply(MSG.celularInvalido, { reply_markup: tecladoCelular }));
    fluxo.dados.celular = celular;
    fluxo.etapa = 'cep';
    await ctx.reply(MSG.pedirCep, { reply_markup: { remove_keyboard: true } });
  });

  // ----- Documentos (foto ou arquivo) -----

  privado.on(['message:photo', 'message:document'], async (ctx, next) => {
    const fluxo = ctx.session.fluxo;
    if (!fluxo || (fluxo.etapa !== 'doc_identidade' && fluxo.etapa !== 'doc_comprovante')) return next();

    let doc: DocPendente | null = null;
    const foto = ctx.message.photo?.at(-1);
    if (foto && (foto.file_size ?? 0) <= MAX_ARQUIVO_BYTES) doc = { fileId: foto.file_id, mime: 'image/jpeg' };
    const arq = ctx.message.document;
    if (arq && MIMES_ACEITOS.has(arq.mime_type ?? '') && (arq.file_size ?? 0) <= MAX_ARQUIVO_BYTES) {
      doc = { fileId: arq.file_id, mime: arq.mime_type! };
    }
    if (!doc) return void (await ctx.reply(MSG.arquivoInvalido));

    if (fluxo.etapa === 'doc_identidade') {
      fluxo.dados.identidade = doc;
      fluxo.etapa = 'doc_comprovante';
      return void (await ctx.reply(MSG.pedirComprovante));
    }
    fluxo.dados.comprovante = doc;
    fluxo.etapa = 'confirmar';
    const d = fluxo.dados;
    await ctx.reply(
      '<b>Confira seus dados</b>\n\n' +
        `Nome: ${escapeHtml(d.nome!)}\nE-mail: ${escapeHtml(d.email!)}\nCPF: ${mascararCPF(d.cpf!)}\n` +
        (d.cnpj ? `CNPJ: ${d.cnpj}\n` : '') +
        (d.cnpj
          ? `Razão social: ${escapeHtml(d.razaoSocial!)}\nRepresentante legal: ${escapeHtml(d.nome!)} (você)\n`
          : `Nascimento: ${d.nascimento!.split('-').reverse().join('/')}\n` +
            `Estado civil: ${ESTADOS_CIVIS[d.estadoCivil!]}\nProfissão: ${escapeHtml(d.profissao!)}\n`) +
        `${d.cnpj ? 'IE' : 'RG'}: ${escapeHtml(d.rgIe!)}\nCelular: +${d.celular}\n` +
        `Endereço:${escapeHtml(d.endereco!)}\nDocumentos: identidade ✅ comprovante ✅\n\n` +
        `Enviar para <b>${escapeHtml(fluxo.leiloeiro!.nome)}</b>?`,
      {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text('✅ Confirmar e enviar', 'confirmar:sim').row().text('✏️ Refazer', 'confirmar:refazer'),
      },
    );
  });

  // ----- Texto durante o cadastro -----

  privado.on('message:text', async (ctx, next) => {
    const fluxo = ctx.session.fluxo;
    if (!fluxo) return next();
    const texto = ctx.message.text.trim();
    const d = fluxo.dados;
    if ((Object.values(BOTOES) as string[]).includes(texto)) {
      return void (await ctx.reply('Você está no meio do cadastro. Responda a pergunta acima ou use /cancelar.'));
    }

    switch (fluxo.etapa) {
      case 'nome': {
        const nome = texto.replace(/\s+/g, ' ');
        if (nome.length < 5 || nome.length > 120 || !nome.includes(' ') || /[<>\d]/.test(nome)) {
          return void (await ctx.reply(MSG.nomeInvalido));
        }
        d.nome = nome;
        fluxo.etapa = 'email';
        return void (await ctx.reply(MSG.pedirEmail));
      }
      case 'email': {
        const email = texto.toLowerCase();
        if (!validarEmail(email)) return void (await ctx.reply(MSG.emailInvalido));
        if ((await deps.arrematantes.emailOuCpfEmUso(email, null, ctx.chat.id)) === 'email') {
          return void (await ctx.reply(MSG.emailIndisponivel));
        }
        const emissao = await deps.codigos.emitir(ctx.chat.id, email);
        if (!emissao.ok) return void (await ctx.reply(MSG.limiteEnvios));
        try {
          await deps.mailer.enviarCodigo(email, emissao.codigo);
        } catch (err) {
          console.error('[mail] falha ao enviar código:', (err as Error).message);
          return void (await ctx.reply(MSG.falhaEnvioEmail));
        }
        d.email = email;
        fluxo.etapa = 'codigo';
        return void (await ctx.reply(MSG.codigoEnviado));
      }
      case 'codigo': {
        if (!/^\d{6}$/.test(texto)) return void (await ctx.reply(MSG.codigoFormato));
        const r = await deps.codigos.verificar(ctx.chat.id, texto);
        if (r.ok) {
          d.email = r.email;
          fluxo.etapa = 'cpf';
          return void (await ctx.reply(MSG.pedirCpf));
        }
        if (r.motivo === 'invalido') {
          return void (await ctx.reply(`Código incorreto. Tentativas restantes: ${r.restantes}.`));
        }
        fluxo.etapa = 'email';
        return void (await ctx.reply(MSG.codigoExpirado));
      }
      case 'cpf': {
        if (!validarCPF(texto)) return void (await ctx.reply(MSG.cpfInvalido));
        const cpf = somenteDigitos(texto);
        if ((await deps.arrematantes.emailOuCpfEmUso('', cpf, ctx.chat.id)) === 'cpf') {
          ctx.session.fluxo = undefined;
          return void (await mostrarMenu(ctx, MSG.cpfIndisponivel));
        }
        d.cpf = cpf;
        fluxo.etapa = 'cnpj_pergunta';
        return void (await ctx.reply(MSG.perguntaCnpj, {
          reply_markup: new InlineKeyboard().text('Sim', 'cnpj:sim').text('Não, pessoa física', 'cnpj:nao'),
        }));
      }
      case 'cnpj': {
        if (!validarCNPJ(texto)) return void (await ctx.reply(MSG.cnpjInvalido));
        d.cnpj = somenteDigitos(texto);
        fluxo.etapa = 'razao_social';
        return void (await perguntar(ctx, 'razao_social'));
      }
      case 'razao_social': {
        const razao = texto.replace(/\s+/g, ' ');
        if (razao.length < 2 || razao.length > 150 || /[<>]/.test(razao)) return void (await ctx.reply(MSG.razaoSocialInvalida));
        d.razaoSocial = razao;
        return void (await seguirComplementares(ctx, fluxo, 'razao_social'));
      }
      case 'nascimento': {
        const r = parseDataNascimento(texto);
        if (!r.ok) {
          if (r.motivo === 'menor') {
            ctx.session.fluxo = undefined;
            return void (await mostrarMenu(ctx, MSG.menorDeIdade));
          }
          return void (await ctx.reply(r.motivo === 'formato' ? MSG.nascimentoFormato : MSG.nascimentoInvalido));
        }
        d.nascimento = r.iso;
        return void (await seguirComplementares(ctx, fluxo, 'nascimento'));
      }
      case 'estado_civil':
        return void (await perguntar(ctx, 'estado_civil'));
      case 'profissao': {
        const profissao = texto.replace(/\s+/g, ' ');
        if (profissao.length < 2 || profissao.length > 80 || /[<>\d]/.test(profissao)) {
          return void (await ctx.reply(MSG.profissaoInvalida));
        }
        d.profissao = profissao;
        return void (await seguirComplementares(ctx, fluxo, 'profissao'));
      }
      case 'rg_ie': {
        const doc = texto.replace(/\s+/g, ' ').toUpperCase();
        if (doc.length < 4 || doc.length > 30 || !/\d|^ISENTO$/.test(doc)) return void (await ctx.reply(MSG.rgInvalido));
        d.rgIe = doc;
        fluxo.etapa = 'celular';
        return void (await ctx.reply(MSG.pedirCelular, { reply_markup: tecladoCelular }));
      }
      case 'celular': {
        const celular = normalizarCelular(texto);
        if (!celular) return void (await ctx.reply(MSG.celularInvalido, { reply_markup: tecladoCelular }));
        d.celular = celular;
        fluxo.etapa = 'cep';
        return void (await ctx.reply(MSG.pedirCep, { reply_markup: { remove_keyboard: true } }));
      }
      case 'cep': {
        const cep = somenteDigitos(texto);
        if (cep.length !== 8) return void (await ctx.reply(MSG.cepInvalido));
        d.cep = cep;
        const end = await buscarCep(cep);
        if (!end) {
          fluxo.etapa = 'cidade_uf';
          return void (await ctx.reply(MSG.cepNaoEncontrado));
        }
        d.cidade = end.cidade;
        d.uf = end.uf;
        if (!end.logradouro || !end.bairro) {
          // CEP geral de cidade pequena: rua e bairro vêm do usuário
          fluxo.etapa = 'logradouro';
          return void (await ctx.reply(`CEP de ${end.cidade}/${end.uf}. ${MSG.pedirLogradouro}`));
        }
        d.logradouro = end.logradouro;
        d.bairro = end.bairro;
        fluxo.etapa = 'numero';
        return void (await ctx.reply(`📍 ${end.logradouro}, ${end.bairro}, ${end.cidade}/${end.uf}\n\n${MSG.pedirNumero}`));
      }
      case 'cidade_uf': {
        const cu = parseCidadeUf(texto);
        if (!cu) return void (await ctx.reply(MSG.cidadeUfInvalida));
        d.cidade = cu.cidade;
        d.uf = cu.uf;
        fluxo.etapa = 'logradouro';
        return void (await ctx.reply(MSG.pedirLogradouro));
      }
      case 'logradouro': {
        const partes = texto.split(',').map((p) => p.replace(/\s+/g, ' ').trim());
        const bairro = partes.length > 1 ? partes.pop()! : '';
        const logradouro = partes.join(', ');
        if (logradouro.length < 4 || logradouro.length > 120 || bairro.length < 2 || bairro.length > 60) {
          return void (await ctx.reply(MSG.logradouroInvalido));
        }
        d.logradouro = logradouro;
        d.bairro = bairro;
        fluxo.etapa = 'numero';
        return void (await ctx.reply(MSG.pedirNumero));
      }
      case 'numero': {
        const nc = parseNumeroComplemento(texto);
        if (!nc) return void (await ctx.reply(MSG.numeroInvalido));
        d.numero = nc.numero;
        d.complemento = nc.complemento;
        d.endereco = formatarEndereco({
          logradouro: d.logradouro!,
          numero: nc.numero,
          complemento: nc.complemento,
          bairro: d.bairro!,
          cidade: d.cidade!,
          uf: d.uf!,
          cep: d.cep!,
        });
        fluxo.etapa = 'doc_identidade';
        return void (await ctx.reply(MSG.pedirIdentidade));
      }
      case 'doc_identidade':
      case 'doc_comprovante':
        return void (await ctx.reply(MSG.arquivoInvalido));
      default:
        return void (await ctx.reply(MSG.usarBotoes));
    }
  });

  // ----- Menu -----

  privado.hears(BOTOES.status, async (ctx) => {
    const a = await deps.arrematantes.buscarPorChat(ctx.chat.id);
    if (!a) return void (await mostrarMenu(ctx, MSG.semCadastro));
    const hab = await deps.arrematantes.listarHabilitacoes(a.id);
    const linhas = hab.map((h) => `• ${escapeHtml(h.leiloeiro)}: ${STATUS_LABEL[h.status]}${h.motivo ? ` — ${escapeHtml(h.motivo)}` : ''}`);
    await ctx.reply(`<b>Suas habilitações</b>\n\n${linhas.join('\n') || 'Nenhuma ainda.'}`, { parse_mode: 'HTML', reply_markup: MENU });
  });

  privado.hears(BOTOES.noticias, async (ctx) => {
    const noticias = await deps.publicacoes.ultimas(FONTE_IMPRENSA, 'noticia', 5);
    const [edicao] = await deps.publicacoes.ultimas(FONTE_IMPRENSA, 'edicao', 1);
    if (!noticias.length && !edicao) return void (await ctx.reply(MSG.semNoticias));
    const fmt = (d: Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' · ' : '');
    const itens = noticias.map((n) => `• ${fmt(n.publicado_em)}<a href="${escapeHtml(n.url)}">${escapeHtml(n.titulo)}</a>`);
    const rodape = edicao ? `\n\n📄 Última edição: <a href="${escapeHtml(edicao.url)}">${escapeHtml(edicao.titulo)}</a>` : '';
    await ctx.reply(`<b>Jornal Imprensa Leilões</b>\n\n${itens.join('\n')}${rodape}`, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: MENU,
    });
  });

  privado.hears(BOTOES.ajuda, (ctx) => mostrarMenu(ctx, MSG.ajuda));

  // Mensagem solta ("Olá"): orienta o caminho em vez de repetir a ajuda
  privado.on('message', async (ctx) => {
    const arrematante = await deps.arrematantes.buscarPorChat(ctx.chat.id);
    await mostrarMenu(
      ctx,
      arrematante
        ? `Olá, ${arrematante.nome.split(' ')[0]}! Use o menu abaixo. Para se habilitar em outro leiloeiro, toque em "${BOTOES.habilitar}".`
        : MSG.semLeiloeiro,
    );
  });

  return bot;
}
