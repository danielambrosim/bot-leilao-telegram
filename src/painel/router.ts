import express, { Router, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import type { Api } from 'grammy';
import type { DocStore } from '../docs/store';
import type { StatusHabilitacao, TipoDocumento } from '../arrematantes/repo';
import { gerarCsv, buscarHabilitados } from '../exportacao/habilitados';
import { montarPacoteZip, PacoteGrandeDemaisError } from '../exportacao/pacoteZip';
import type { Pool } from 'pg';
import { SESSAO_HORAS, type AuthPainel, type Operador } from './auth';
import type { Decisao, PainelRepo } from './repo';
import { ValidacaoError, type GestaoRepo } from './gestao';
import { gerarQrSvg } from './qrcode';

export const PAINEL_PATH = '/painel';
const COOKIE = 'sbl_sessao';
const STATUS: Array<StatusHabilitacao | 'todos'> = ['pendente', 'aprovado', 'recusado', 'revogado', 'todos'];
const DECISOES: Decisao[] = ['aprovado', 'recusado', 'revogado'];
const TIPOS: TipoDocumento[] = ['identidade', 'comprovante_residencia'];

export interface PainelDeps {
  pool: Pool;
  auth: AuthPainel;
  repo: PainelRepo;
  docs: DocStore;
  /** API do Telegram para avisar o arrematante da decisão */
  telegram?: Pick<Api, 'sendMessage'>;
  producao: boolean;
  /** Pasta com index.html/app.js/app.css */
  webDir?: string;
  /** Telas de gestão (visão geral, auditoria, configuração, equipe) */
  gestao?: GestaoRepo;
  /** Para montar o link de habilitação (t.me/<bot>?start=<slug>) */
  botUsername?: string;
  /** Remetente dos e-mails (mostra se o domínio próprio já foi configurado) */
  mailFrom?: string;
}

type ReqOp = Request & { operador?: Operador };

function lerCookie(req: Request, nome: string): string | undefined {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function mensagemDecisao(decisao: Decisao, leiloeiro: string, motivo: string | null): string {
  if (decisao === 'aprovado') return `✅ Sua habilitação com ${leiloeiro} foi APROVADA. Você já pode participar dos leilões.`;
  if (decisao === 'recusado') {
    return `❌ Sua habilitação com ${leiloeiro} foi recusada.\nMotivo: ${motivo}\n\nCorrija e solicite novamente com o leiloeiro.`;
  }
  return `🚫 Sua habilitação com ${leiloeiro} foi revogada.\nMotivo: ${motivo}`;
}

export function createPainelRouter(deps: PainelDeps): Router {
  const r = Router();
  const webDir = deps.webDir ?? path.resolve(process.cwd(), 'painel-web');

  // CSP estrita só no painel: nada de script/estilo de fora, nada inline
  r.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' blob: data:; object-src 'self' blob:; frame-src 'self' blob:; " +
        "style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  r.use('/static', express.static(webDir, { index: false, fallthrough: false, maxAge: 0 }));
  r.get('/', (_req, res) => res.sendFile(path.join(webDir, 'index.html')));

  const api = Router();
  api.use(express.json({ limit: '20kb' }));

  // CSRF: cookie SameSite=Strict + header customizado obrigatório em qualquer escrita
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('x-sbl-painel') !== '1') {
      res.status(403).json({ erro: 'requisicao_invalida' });
      return;
    }
    next();
  });

  api.post(
    '/login',
    rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }),
    async (req, res) => {
      const { email, senha } = req.body ?? {};
      if (typeof email !== 'string' || typeof senha !== 'string' || email.length > 254 || senha.length > 200) {
        res.status(400).json({ erro: 'dados_invalidos' });
        return;
      }
      const r1 = await deps.auth.login(email, senha, req.ip);
      if (!r1.ok) {
        res.status(r1.motivo === 'bloqueado' ? 429 : 401).json({ erro: r1.motivo });
        return;
      }
      res.cookie(COOKIE, r1.token, {
        httpOnly: true,
        secure: deps.producao,
        sameSite: 'strict',
        path: PAINEL_PATH,
        maxAge: SESSAO_HORAS * 3_600_000,
      });
      res.json({ operador: r1.operador });
    },
  );

  const exigirLogin = async (req: ReqOp, res: Response, next: NextFunction) => {
    const op = await deps.auth.operadorDaSessao(lerCookie(req, COOKIE));
    if (!op) {
      res.status(401).json({ erro: 'nao_autenticado' });
      return;
    }
    req.operador = op;
    next();
  };

  api.post('/logout', async (req, res) => {
    await deps.auth.logout(lerCookie(req, COOKIE));
    res.clearCookie(COOKIE, { path: PAINEL_PATH });
    res.json({ ok: true });
  });

  api.get('/me', exigirLogin, async (req: ReqOp, res) => {
    res.json({ operador: req.operador, contagem: await deps.repo.contagem(req.operador!.leiloeiro_id) });
  });

  api.get('/habilitacoes', exigirLogin, async (req: ReqOp, res) => {
    const status = STATUS.includes(req.query.status as never) ? (req.query.status as StatusHabilitacao) : 'pendente';
    const busca = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({
      itens: await deps.repo.fila(req.operador!.leiloeiro_id, status, busca),
      contagem: await deps.repo.contagem(req.operador!.leiloeiro_id),
    });
  });

  api.get('/habilitacoes/:id', exigirLogin, async (req: ReqOp, res) => {
    const id = Number(req.params.id);
    const ficha = Number.isInteger(id) ? await deps.repo.ficha(req.operador!.leiloeiro_id, id) : null;
    if (!ficha) {
      res.status(404).json({ erro: 'nao_encontrado' });
      return;
    }
    await deps.auth.auditar(req.operador!.id, req.operador!.leiloeiro_id, 'painel.ficha_visualizada', { habilitacao: id });
    res.json(ficha);
  });

  api.get('/habilitacoes/:id/documentos/:tipo', exigirLogin, async (req: ReqOp, res) => {
    const id = Number(req.params.id);
    const tipo = req.params.tipo as TipoDocumento;
    if (!Number.isInteger(id) || !TIPOS.includes(tipo)) {
      res.status(404).end();
      return;
    }
    const doc = await deps.repo.documento(req.operador!.leiloeiro_id, id, tipo);
    if (!doc) {
      res.status(404).end();
      return;
    }
    const conteudo = await deps.docs.ler(doc.r2_key);
    await deps.auth.auditar(req.operador!.id, req.operador!.leiloeiro_id, 'painel.documento_aberto', { habilitacao: id, tipo });
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Content-Disposition', `inline; filename="${tipo}-${id}.${doc.mime === 'application/pdf' ? 'pdf' : 'jpg'}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(conteudo);
  });

  api.post('/habilitacoes/:id/decisao', exigirLogin, async (req: ReqOp, res) => {
    const id = Number(req.params.id);
    const { decisao, motivo } = req.body ?? {};
    const motivoLimpo = typeof motivo === 'string' ? motivo.trim().slice(0, 500) : '';
    if (!Number.isInteger(id) || !DECISOES.includes(decisao)) {
      res.status(400).json({ erro: 'decisao_invalida' });
      return;
    }
    if (decisao !== 'aprovado' && motivoLimpo.length < 10) {
      res.status(400).json({ erro: 'motivo_obrigatorio' });
      return;
    }
    const op = req.operador!;
    const r2 = await deps.repo.decidir(op.leiloeiro_id, id, op.id, decisao, decisao === 'aprovado' ? null : motivoLimpo);
    if (!r2) {
      res.status(409).json({ erro: 'status_mudou_ou_nao_encontrado' });
      return;
    }
    let avisado = false;
    try {
      await deps.telegram?.sendMessage(r2.chatId, mensagemDecisao(decisao, r2.leiloeiro, motivoLimpo || null));
      avisado = !!deps.telegram;
    } catch (e) {
      console.error('[painel] falha ao avisar arrematante:', (e as Error).message);
    }
    res.json({ ok: true, avisado });
  });

  api.get('/exportar', exigirLogin, async (req: ReqOp, res) => {
    const status = STATUS.includes(req.query.status as never) ? (req.query.status as StatusHabilitacao) : 'aprovado';
    const op = req.operador!;
    const { linhas } = await buscarHabilitados(deps.pool, op.leiloeiro_slug, status);
    await deps.auth.auditar(op.id, op.leiloeiro_id, 'exportacao.habilitados', { status, quantidade: linhas.length, via: 'painel' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${op.leiloeiro_slug}-${status}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(gerarCsv(linhas));
  });

  // ---------- Gestão: visão geral, auditoria, editais e configuração ----------
  const g = deps.gestao;
  if (g) {
    const exigirDono = (req: ReqOp, res: Response, next: NextFunction) => {
      if (req.operador?.papel !== 'dono') {
        res.status(403).json({ erro: 'somente_responsavel', mensagem: 'Somente o responsável pode alterar configurações.' });
        return;
      }
      next();
    };
    const tratar = (fn: (req: ReqOp, res: Response) => Promise<unknown>) => async (req: ReqOp, res: Response) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (e instanceof ValidacaoError) {
          res.status(400).json({ erro: 'validacao', mensagem: e.message });
          return;
        }
        throw e;
      }
    };
    const op = (req: ReqOp) => req.operador!;

    api.get('/resumo', exigirLogin, async (req: ReqOp, res) => res.json(await g.resumo(op(req).leiloeiro_id)));
    api.get('/auditoria', exigirLogin, async (req: ReqOp, res) => res.json({ itens: await g.auditoria(op(req).leiloeiro_id) }));
    api.get('/exportacoes', exigirLogin, async (req: ReqOp, res) => res.json({ itens: await g.exportacoes(op(req).leiloeiro_id) }));
    api.get('/publicacoes', exigirLogin, async (_req, res) => res.json({ itens: await g.publicacoes(40) }));

    api.get('/config', exigirLogin, async (req: ReqOp, res) => {
      const dados = await g.leiloeiro(op(req).leiloeiro_id);
      res.json({
        dados,
        link: deps.botUsername ? `https://t.me/${deps.botUsername}?start=${dados.slug}` : null,
        podeEditar: op(req).papel === 'dono',
        integracoes: {
          bot: deps.botUsername ? `@${deps.botUsername}` : null,
          emailDominioProprio: !!deps.mailFrom && !/resend\.dev/i.test(deps.mailFrom),
          ultimaColeta: await g.ultimaColeta(),
        },
      });
    });
    // QR code do link de habilitação (para editais impressos, cartazes, WhatsApp)
    api.get('/config/qrcode.svg', exigirLogin, async (req: ReqOp, res) => {
      if (!deps.botUsername) {
        res.status(404).json({ erro: 'link_indisponivel' });
        return;
      }
      const link = `https://t.me/${deps.botUsername}?start=${op(req).leiloeiro_slug}`;
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      if (req.query.baixar === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="qrcode-habilitacao-${op(req).leiloeiro_slug}.svg"`);
      }
      res.send(`<?xml version="1.0" encoding="UTF-8"?>\n${gerarQrSvg(link)}`);
    });

    api.put('/config/dados', exigirLogin, exigirDono, tratar(async (req: ReqOp, res) => {
      await g.salvarDados(op(req).leiloeiro_id, op(req).id, req.body ?? {});
      res.json({ ok: true });
    }));
    api.put('/config/privacidade', exigirLogin, exigirDono, tratar(async (req: ReqOp, res) => {
      await g.salvarPrivacidade(op(req).leiloeiro_id, op(req).id, req.body ?? {});
      res.json({ ok: true });
    }));
    api.get('/config/termo', exigirLogin, async (req: ReqOp, res) => res.json({ versoes: await g.versoesTermo(op(req).leiloeiro_id) }));
    api.post('/config/termo', exigirLogin, exigirDono, tratar(async (req: ReqOp, res) => {
      res.json({ ok: true, versao: await g.publicarTermo(op(req).leiloeiro_id, op(req).id, req.body?.texto) });
    }));

    api.get('/equipe', exigirLogin, async (req: ReqOp, res) => res.json({ itens: await g.equipe(op(req).leiloeiro_id), eu: op(req).id }));
    api.post('/equipe', exigirLogin, exigirDono, tratar(async (req: ReqOp, res) => {
      res.json(await g.convidar(op(req).leiloeiro_id, op(req).id, req.body ?? {}));
    }));
    api.patch('/equipe/:id', exigirLogin, exigirDono, tratar(async (req: ReqOp, res) => {
      const alvo = Number(req.params.id);
      if (!Number.isInteger(alvo)) throw new ValidacaoError('Pessoa inválida');
      res.json(await g.alterarMembro(op(req).leiloeiro_id, op(req).id, alvo, req.body ?? {}));
    }));
  }

  // Pacote ZIP: CSV + documentos de cada arrematante (para importar na plataforma do leiloeiro)
  api.get(
    '/exportar-pacote',
    rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false }),
    exigirLogin,
    async (req: ReqOp, res) => {
      const status = STATUS.includes(req.query.status as never) ? (req.query.status as StatusHabilitacao) : 'aprovado';
      const op = req.operador!;
      let pacote;
      try {
        pacote = await montarPacoteZip(deps.pool, deps.docs, op.leiloeiro_slug, status);
      } catch (e) {
        if (e instanceof PacoteGrandeDemaisError) {
          res.status(413).json({ erro: 'pacote_grande', mensagem: e.message });
          return;
        }
        throw e;
      }
      await deps.auth.auditar(op.id, op.leiloeiro_id, 'exportacao.pacote', {
        status, quantidade: pacote.quantidade, documentos: pacote.documentos, via: 'painel',
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${op.leiloeiro_slug}-${status}-${new Date().toISOString().slice(0, 10)}.zip"`,
      );
      pacote.stream.on('error', (err) => {
        console.error('[painel] falha ao gerar pacote:', err.message);
        res.destroy(err);
      });
      pacote.stream.pipe(res);
    },
  );

  api.use((_req, res) => {
    res.status(404).json({ erro: 'nao_encontrado' });
  });

  r.use('/api', api);
  return r;
}
